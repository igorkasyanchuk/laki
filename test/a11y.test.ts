// R13: every <button> in the renderer has a name a screen reader can say: its text, or aria-label / title /
// aria-labelledby when it holds only an icon (data-tip is the pointer's, not a name). IconButton takes a title by its type.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const dir = join(import.meta.dirname, '../src/renderer/src')

// the opening tag that starts at `from` ("<button"): where it ends (after its >), and whether it closes itself
function tagEnd(s: string, from: number) {
  let depth = 0
  let quote = ''
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (quote) quote = c === quote ? '' : quote
    else if (depth === 0 && (c === '"' || c === "'")) quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0 && s[i - 1] !== '=') return { end: i + 1, self: s[i - 1] === '/' }
  }
  throw new Error('no end of tag')
}
export function unnamed(src: string) {
  const out: number[] = []
  for (const m of src.matchAll(/<button\b/g)) {
    const { end, self } = tagEnd(src, m.index)
    const attrs = src.slice(m.index, end)
    if (/\b(aria-label|aria-labelledby|title)=/.test(attrs) || /\{\.\.\./.test(attrs)) continue // named, or its props spread in
    const close = self ? end : src.indexOf('</button>', end)
    const inner = self ? '' : src.slice(end, close).replace(/<(Icon|Glyph|ProjectMark)\b[^>]*\/>/g, '').replace(/<span className="(btn-spin|glyph[^"]*)"[^>]*\/>/g, '')
    if (!/\balt=/.test(inner) && !/[A-Za-z{]/.test(inner.replace(/<\/?[a-z][^>]*>/g, ''))) out.push(src.slice(0, m.index).split('\n').length)
  }
  return out
}

test('unnamed: an icon-only button is found, a named or worded one is not', () => {
  assert.deepEqual(unnamed('<button onClick={() => a > b}><Icon name="x" /></button>'), [1])
  assert.deepEqual(unnamed('<button data-tip="Close"><Icon name="x" /></button>'), [1])
  assert.deepEqual(unnamed('<button aria-label="Close"><Icon name="x" /></button>\n<button>Save</button>\n<button>{label}</button>\n<button className="dot" />'), [4])
})

test('every button in the renderer has a name', () => {
  const bad = readdirSync(dir).filter(f => f.endsWith('.tsx')).flatMap(f => unnamed(readFileSync(join(dir, f), 'utf8')).map(l => `${f}:${l}`))
  assert.deepEqual(bad, [])
})

// U11: a click on something that isn't a control (a div, a span, a row, a cell, a picture): a role of its own, or ui.tsx'
// act (a button to the keyboard and a screen reader); a handler that only stops the click going on doesn't count
export function mute(src: string) {
  const out: number[] = []
  for (const m of src.matchAll(/<(div|span|li|section|b|p|img|label|td|tr|svg|aside|h\d)\b/g)) {
    const { end } = tagEnd(src, m.index)
    const attrs = src.slice(m.index, end)
    const on = attrs.match(/\bonClick=\{([\s\S]{0,60})/)
    if (!on || /\brole=|\{\.\.\.(act|press)\(/.test(attrs)) continue
    if (/^\s*\(?e\)?\s*=>\s*\(?e\.stopPropagation\(\)\)?\s*\}/.test(on[1]) || /^\s*stop\s*\}/.test(on[1])) continue
    out.push(src.slice(0, m.index).split('\n').length)
  }
  return out
}

test('mute: a clicked div is found; one with a role, act, or a stopPropagation only is not', () => {
  assert.deepEqual(mute('<div onClick={() => go()}>x</div>\n<div role="button" onClick={go}>x</div>\n<div {...act(go)}>x</div>\n<span onClick={e => e.stopPropagation()}>x</span>'), [1])
})

test('every clicked element in the renderer is a control to the keyboard too', () => {
  const bad = readdirSync(dir).filter(f => f.endsWith('.tsx')).flatMap(f => mute(readFileSync(join(dir, f), 'utf8')).map(l => `${f}:${l}`))
  assert.deepEqual(bad, [])
})
