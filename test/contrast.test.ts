// every theme stays readable: text, hints, button labels, status marks and terminal colors against what they sit on
// (WCAG contrast ratios)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { THEMES, contrast as ratio, readable } from '../src/renderer/src/themes.ts'

// what sits on what, and how much it needs: 4.5 for text, hints and status words alike (3.5 for a hint on the selection;
// 2.5 for a status mark there: its shape tells it too); a selection, a hovered row and a line need only to show
const PAIRS: [string, string, number][] = [
  ['fg', 'panel', 4.5],
  ['fg', 'raised', 4.5],
  ['fg', 'sel', 4.5],
  ['muted', 'panel', 4.5],
  ['muted', 'raised', 4.5],
  ['muted', 'sel', 3.5],
  ['accentFg', 'accent', 4.5],
  ...['running', 'waiting', 'done', 'error'].flatMap(k => [[k, 'panel', 4.5], [k, 'raised', 4.5], [k, 'sel', 2.5]] as [string, string, number][]),
  ['sel', 'bg', 1.2],
  ['line', 'bg', 1.15],
]
const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
// a see-through color (#rrggbbaa) over a solid one
const over = (top: string, under: string) => {
  const a = top.length > 7 ? parseInt(top.slice(7, 9), 16) / 255 : 1
  return hex(rgb(top).map((v, i) => v * a + rgb(under)[i] * (1 - a)))
}

test('contrast: every theme is readable', () => {
  assert.ok(Math.abs(ratio('#000000', '#ffffff') - 21) < 0.01)
  // Midnight (default) is the stylesheet's :root
  const root = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8').match(/:root\s*{([^}]*)}/)![1]
  const v = (k: string) => root.match(new RegExp(`--${k}:\\s*(#[0-9a-fA-F]+)`))![1]
  const midnight = { bg: v('bg'), side: v('side'), panel: v('panel'), raised: v('hover'), line: v('line'), fg: v('fg'), muted: v('muted'), accent: v('accent'), accentFg: v('accent-fg'), sel: v('sel'), running: v('running'), waiting: v('waiting'), done: v('done'), error: v('error') }
  const bad: string[] = []
  for (const t of THEMES) {
    const c = (t.c ?? midnight) as Record<string, string>
    const ansi = t.ansi ?? Array.from({ length: 16 }, (_, i) => v(`ansi-${i}`))
    const need = (what: string, a: string, b: string, min: number) => {
      const r = ratio(a, b)
      if (r < min) bad.push(`${t.name}: ${what} ${a} on ${b} is ${r.toFixed(2)}, needs ${min}`)
    }
    for (const [a, b, min] of PAIRS) need(`${a} on ${b}`, c[a], c[b], min)
    // the main area and the sidebar: a gradient theme's are its gradient's ends (the sidebar see-through over them);
    // the rail is the sidebar a shade darker (applyTheme's rail)
    const bg = t.grad ? [...t.grad] : [c.bg]
    const side = bg.map(g => over(c.side, g))
    const rail = side.map(x => hex(rgb(x).map(v => v * (t.light ? 0.94 : 0.82))))
    const on = (what: string, color: string, bgs: string[], min: number) => bgs.forEach(b => need(what, color, b, min))
    on('fg', c.fg, [...bg, ...side], 4.5)
    on('muted', c.muted, [...bg, ...side, ...rail], 4.5)
    for (const k of ['running', 'waiting', 'done', 'error']) on(k, c[k], [...bg, ...side], 4.5)
    // the text a step above its hints
    need('fg over muted', c.fg, c.muted, 1.3)
    if (!t.grad) need('raised on side', c.raised, c.side, 1.07)
    // the terminal: its colors as text (black and white aside: a light theme's are the background's), its dim grey;
    // 1-6 are the diff's, the tab colors' and the PR marks' too: in the sidebar and on panels
    for (const i of [9, 10, 11, 12, 13, 14]) on(`ansi ${i}`, ansi[i], bg, 3)
    for (const i of [1, 2, 3, 4, 5, 6]) on(`ansi ${i}`, ansi[i], [...bg, ...side, c.panel], 3)
    on('ansi 8', ansi[8], bg, 2.5)
    // the accent as text: applyTheme's --accent-ink
    for (const b of [...bg, c.panel, ...side]) need('accent text', readable(c.accent, [...bg, c.panel, ...side]), b, 4.5)
  }
  assert.deepEqual(bad, [])
})

test("contrast: readable keeps a color that reads, else darkens it on light (lightens on dark), the hue kept", () => {
  assert.equal(readable('#7aa2f7', ['#0e1014']), '#7aa2f7')
  const ink = readable('#ffd400', ['#ffffff'])
  assert.ok(ratio(ink, '#ffffff') >= 4.5)
  const [r, g, b] = [1, 3, 5].map(i => parseInt(ink.slice(i, i + 2), 16))
  assert.ok(r > g && b < 8, `still a yellow: ${ink}`)
  assert.ok(ratio(readable('#202040', ['#000000']), '#000000') >= 4.5)
  const across = readable('#808080', ['#202020', '#f0f0f0'], 3) // a gradient over both sides of it
  assert.ok(ratio(across, '#202020') >= 3 && ratio(across, '#f0f0f0') >= 3, across)
})
