// A brainstorm with long files nearly stuck the app: every DOM change restyled every element in the window (90 ms a
// change). A :has() on a frame that styles a * (or a :not()) under it, beside a :has() Blink can't follow by class
// (:only-child, :nth-child, :disabled: BlockNote's, Mantine's, ours), does that. BlockNote's suggested edits' rules
// are left out by src/renderer/postcss.config.mjs; ours never style a * under a :has().
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import postcss from 'postcss'

test("BlockNote's suggested edits left out; its slash menu and what's grouped with them stay", async () => {
  const file: string = '../src/renderer/postcss.config.mjs' // a string: no types for it
  const { default: config } = await import(file)
  const css = '.a,.bn-suggestion-node>.b{color:red}.bn-suggestion-node:has(.x)>*{color:blue}.bn-suggestion-mark--delete{color:gray}.bn-block-content:not(.bn-suggestion-node *) .p:has(.q){color:green}.bn-suggestion-menu-item{color:pink}'
  const out = (await postcss(config.plugins).process(css, { from: undefined })).css
  assert.equal(out, '.a{color:red}.bn-block-content .p:has(.q){color:green}.bn-suggestion-menu-item{color:pink}')
})

test('no * or :not() under a :has() in our stylesheets', () => {
  const under = /:has\((?:[^()]|\([^()]*\))*\)\)?[^,{]*?[ >~+]\s*(\*|:not\()/ // ponytail: commas inside :is() split too, harmless here
  for (const f of ['styles.css', 'fonts.css', 'components.css', 'looks.css', 'plans.css', 'workflows.css', 'floater.css']) {
    const css = readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const sel of css.match(/[^{};]+(?=\{)/g) ?? []) for (const s of sel.split(',')) assert.ok(!under.test(s), `${f}: ${s.trim()}`)
  }
  // the two that did it would be caught
  assert.ok(under.test(".app[data-dz~='chrome'] .main:has(> .settings-page) > :not(.settings-page"))
  assert.ok(under.test('.page-body:has(.bn-container) :is(.notes-side > *'))
})

// B1: the type scale. A size in px is one of --fs-1…5; its own only under 10px (badges) or over 22px (display numbers);
// em, rem, inherit, a setting's variable and a calc() are relative to something else
test('every font-size is a step of the type scale', () => {
  for (const f of ['styles.css', 'fonts.css', 'components.css', 'looks.css', 'plans.css', 'workflows.css']) {
    const css = readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, v] of css.matchAll(/font-size:\s*([^;}]+)/g)) {
      const px = /^(\d+(?:\.\d+)?)px( !important)?$/.exec(v.trim())
      assert.ok(!px || +px[1] < 10 || +px[1] > 22, `${f}: font-size: ${v.trim()} (use var(--fs-1…5))`)
    }
  }
})

// themes.ts gateRules: a rule only for another look or motion than <html>'s gets a selector nothing has
test("a look's or motion's rules are told apart by their selectors", async () => {
  const { selectorsOf, gateOf } = await import('../src/renderer/src/themes.ts')
  assert.deepEqual(selectorsOf('a, :is(.b, .c) d, [x="1,2"] e'), ['a', ':is(.b, .c) d', '[x="1,2"] e'])
  assert.deepEqual(gateOf('[data-look="aqua"] :is(.menu, .modal)'), { attr: 'look', values: ['aqua'] })
  assert.deepEqual(gateOf('html[data-look="aqua"] .tab, [data-look="neon"] .tab'), { attr: 'look', values: ['aqua', 'neon'] })
  assert.deepEqual(gateOf('html[data-motion="high"] .menu'), { attr: 'motion', values: ['high'] })
  assert.deepEqual(gateOf(':where([data-look="aqua"]) button, :where([data-look="aqua"]) select'), { attr: 'look', values: ['aqua'] })
  assert.equal(gateOf(':where([data-look="aqua"], .x) button'), undefined) // not only for it
  assert.equal(gateOf('[data-look="aqua"] .tab, .tab'), undefined) // one of them for every look
  assert.equal(gateOf('html:not(.theme-font)[data-look] .tab'), undefined)
  assert.equal(gateOf('[data-look="aqua"] .tab, html[data-motion="high"] .tab'), undefined)
})

// V2: styles.css on the design tokens (its :root): space (--sp-*: a raw px only 0, a 1px hairline or a layout-sized 20px
// and up), corners (--r-*), elevation (--lift-*: no raw black drop shadow; rings, insets and glows of a color stay),
// stacking (--z-*: a raw z-index only within a part, under 10), type (a font: shorthand's size a --fs-* step, display
// sizes over 22px aside; no font-size under 11px). looks.css follows later
test("V2: styles.css' spacing, corners, shadows, stacking and type are tokens", () => {
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^:root \{[\s\S]*?\n\}/, '')
  const inner = (v: string) => { let s = v; for (let i = 0; i < 4; i++) s = s.replace(/\b(calc|clamp|min|max|env|var)\([^()]*\)/g, ''); return s }
  const bad: string[] = []
  for (const [, p, v] of css.matchAll(/(?<![-\w])(gap|row-gap|column-gap|padding(?:-[a-z-]+)?)\s*:\s*([^;}]+)/g))
    for (const [, n] of inner(v).matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)) if (+n !== 1 && +n < 20) bad.push(`${p}: ${v.trim()}`)
  for (const [, v] of css.matchAll(/(?<![-\w])border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) if (/\d+(\.\d+)?px/.test(inner(v))) bad.push(`border-radius: ${v.trim()}`)
  for (const [, v] of css.matchAll(/(?<![-\w])box-shadow\s*:\s*([^;}]+)/g))
    for (const part of v.split(/,(?![^(]*\))/)) if (/^\s*-?[\d.]+(px)?\s+[1-9][\d.]*px\s+[\d.]+px(\s+-?[\d.]+px)?\s+(rgba\(0,\s*0,\s*0|rgb\(0 0 0|color-mix\(in srgb, #000)/.test(part)) bad.push(`box-shadow: ${part.trim()}`)
  for (const [, v] of css.matchAll(/(?<![-\w])z-index\s*:\s*(-?\d+)\s*[;}!]/g)) if (+v > 9) bad.push(`z-index: ${v}`)
  for (const [, v] of css.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)) for (const [, n] of v.matchAll(/(?<![\w./-])(\d+(?:\.\d+)?)px(?!\s*\))/g)) if (+n <= 22 && !new RegExp(`/${n}px`).test(v)) bad.push(`font: ${v.trim()}`)
  for (const [, n] of css.matchAll(/(?<![-\w])font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) if (+n < 11) bad.push(`font-size: ${n}px`)
  for (const [, w] of css.matchAll(/(?<![-\w])font-weight\s*:\s*(\d+)/g)) if (!['400', '600', '700'].includes(w)) bad.push(`font-weight: ${w}`)
  assert.deepEqual(bad, [])
})
