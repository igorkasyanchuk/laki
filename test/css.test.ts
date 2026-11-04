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
  for (const f of ['styles.css', 'look.css', 'plans.css', 'workflows.css', 'floater.css']) {
    const css = readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const sel of css.match(/[^{};]+(?=\{)/g) ?? []) for (const s of sel.split(',')) assert.ok(!under.test(s), `${f}: ${s.trim()}`)
  }
  // the two that did it would be caught
  assert.ok(under.test(".app[data-dz~='chrome'] .main:has(> .settings-page) > :not(.settings-page"))
  assert.ok(under.test('.page-body:has(.bn-container) :is(.notes-side > *'))
})

// themes.ts gateRules: a rule only for another look or motion than <html>'s gets a selector nothing has
test("a look's or motion's rules are told apart by their selectors", async () => {
  const { selectorsOf, gateOf } = await import('../src/renderer/src/themes.ts')
  assert.deepEqual(selectorsOf('a, :is(.b, .c) d, [x="1,2"] e'), ['a', ':is(.b, .c) d', '[x="1,2"] e'])
  assert.deepEqual(gateOf('[data-look="aqua"] :is(.menu, .modal)'), { attr: 'look', values: ['aqua'] })
  assert.deepEqual(gateOf('html[data-look="aqua"] .tab, [data-look="neon"] .tab'), { attr: 'look', values: ['aqua', 'neon'] })
  assert.deepEqual(gateOf('html[data-motion="high"] .menu'), { attr: 'motion', values: ['high'] })
  assert.equal(gateOf('[data-look="aqua"] .tab, .tab'), undefined) // one of them for every look
  assert.equal(gateOf('html:not(.theme-font)[data-look] .tab'), undefined)
  assert.equal(gateOf('[data-look="aqua"] .tab, html[data-motion="high"] .tab'), undefined)
})
