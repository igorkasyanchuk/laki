// A brainstorm with long files nearly stuck the app: every DOM change restyled every element in the window (90 ms a
// change). A :has() on a frame that styles a * (or a :not()) under it, beside a :has() Blink can't follow by class
// (:only-child, :nth-child, :disabled: BlockNote's, Mantine's, ours), does that. BlockNote's suggested edits' rules
// are left out by src/renderer/postcss.config.mjs; ours never style a * under a :has().
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import postcss from 'postcss'

// styles.css' rules only a lazy page uses, in a file it imports: they load with it, out of the first load (npm run size)
const PAGES = ['ai.css', 'board.css', 'extension.css', 'review.css', 'schedules.css', 'uikit.css']

// looks-base.css and every look's own file (looks/<look>.css: themes.ts lookCss)
const LOOKS = ['looks-base.css', ...readdirSync(new URL('../src/renderer/src/looks/', import.meta.url)).map(f => `looks/${f}`)]
test("BlockNote's suggested edits left out; its slash menu and what's grouped with them stay", async () => {
  const file: string = '../src/renderer/postcss.config.mjs' // a string: no types for it
  const { default: config } = await import(file)
  const css = '.a,.bn-suggestion-node>.b{color:red}.bn-suggestion-node:has(.x)>*{color:blue}.bn-suggestion-mark--delete{color:gray}.bn-block-content:not(.bn-suggestion-node *) .p:has(.q){color:green}.bn-suggestion-menu-item{color:pink}'
  const out = (await postcss(config.plugins).process(css, { from: undefined })).css
  assert.equal(out, '.a{color:red}.bn-block-content .p:has(.q){color:green}.bn-suggestion-menu-item{color:pink}')
})

test('no * or :not() under a :has() in our stylesheets', () => {
  const under = /:has\((?:[^()]|\([^()]*\))*\)\)?[^,{]*?[ >~+]\s*(\*|:not\()/ // ponytail: commas inside :is() split too, harmless here
  for (const f of ['styles.css', 'fonts.css', 'components.css', ...LOOKS, 'plans.css', 'workflows.css', 'floater.css', ...PAGES]) {
    const css = readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const sel of css.match(/[^{};]+(?=\{)/g) ?? []) for (const s of sel.split(',')) assert.ok(!under.test(s), `${f}: ${s.trim()}`)
  }
  // the two that did it would be caught
  assert.ok(under.test(".app[data-dz~='chrome'] .main:has(> .settings-page) > :not(.settings-page"))
  assert.ok(under.test('.page-body:has(.bn-container) :is(.notes-side > *'))
})

// a pseudo-element inherits its element's drag and, last in tree order, drags over its no-drag buttons: Grain's ::after
// made the rail's buttons a window drag in Electron (no click, no pointer)
test('no pseudo-element is a drag region', () => {
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /^::before, ::after \{ -webkit-app-region: none; \}$/m)
})

// B1: the type scale. A size in px is one of --fs-1…5; its own only under 10px (badges) or over 22px (display numbers);
// em, rem, inherit, a setting's variable and a calc() are relative to something else
test('every font-size is a step of the type scale', () => {
  for (const f of ['styles.css', 'fonts.css', 'components.css', ...LOOKS, 'plans.css', 'workflows.css', ...PAGES]) {
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
  const css = ['styles.css', ...PAGES].map(f => readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^:root \{[\s\S]*?\n\}/, '')
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

// V6: the other style sheets' corners are tokens too (0, 50% and the pill allowed); looks/ keeps each look's own shapes
test("V6: no raw border-radius outside the looks' files", () => {
  const bad: string[] = []
  for (const f of ['styles', 'components', 'plans', 'workflows', 'floater']) {
    const css = readFileSync(new URL(`../src/renderer/src/${f}.css`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^:root \{[\s\S]*?\n\}/m, '')
    const inner = (v: string) => { let s = v; for (let i = 0; i < 4; i++) s = s.replace(/\b(calc|clamp|min|max|var)\([^()]*\)/g, ''); return s }
    for (const [, v] of css.matchAll(/(?<![\w])-?-?(?:bn-)?border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) if (/\d+(\.\d+)?(px|rem|em)/.test(inner(v)) && !/^999px$/.test(v.trim())) bad.push(`${f}.css: ${v.trim()}`)
  }
  assert.deepEqual(bad, [])
})

// concentric corners (styles.css --r-out, --pad, --r-in): what sits at a container's edge inside takes --r-in, not a
// raw radius token, so it follows the container's own and its padding (Square: square through --rs)
test('concentric corners: the inner pieces of capsules, menus, ⌘K, dialogs and Needs you cards take --r-in', () => {
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
  for (const sel of ['.menu-item', '.palette-item', '.actions.capsule .ib', '.reader-switch.capsule button', '.ship-banner', '.need-opts button, .need-acts button', '.status .sb-group > button']) {
    const rule = css.split('\n').find(l => l.startsWith(`${sel} {`))
    assert.ok(rule, `a rule for ${sel}`)
    assert.match(rule!, /border-radius: var\(--r-in\);/, sel)
  }
  assert.match(css, /--r-in: max\(var\(--r-xs\), calc\(var\(--r-out\) - var\(--pad\)\)\)/)
})

// Density scales space and control heights only: type, hairlines and corners stay
test('no rule multiplies a type size (--fs-*) by --density', () => {
  for (const f of ['styles.css', 'components.css', ...LOOKS, 'plans.css', ...PAGES]) {
    const css = readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const decl of css.split(/[;{}]/)) assert.ok(!(/var\(--fs-\d/.test(decl) && /--density/.test(decl)), `${f}: ${decl.trim()}`)
  }
})

// the arrow over controls (--cur-act with Pointing hand over buttons off, macOS's habit): with no hand to say a thing is clickable, each control that sets
// it has a :hover of its own, an element's base one (button:hover), or a reason it needs none
const NO_HOVER: Record<string, string> = {
  '.sim-screen img': "the simulator's screen: a click is a tap on it",
  'input.color-pick': "a native color well: macOS's own look",
  ".cal-when > input[type='datetime-local']": "a native date field: macOS's own look",
  '.sp-viewed input': 'a native checkbox',
  '.ach-toast': 'a toast that fades by itself; a click opens Achievements',
  '.cmap': "a picture's map: the pointer's position is what's picked",
}
test('every control with the arrow (--cur-act) has a hover state', () => {
  const split = (sel: string) => {
    const out: string[] = []
    let depth = 0, cur = ''
    for (const c of sel) {
      if (c === '(') depth++
      if (c === ')') depth--
      if (c === ',' && !depth) out.push(cur.trim()), (cur = '')
      else cur += c
    }
    return [...out, cur.trim()].filter(Boolean)
  }
  const sels: string[] = []
  const acts: string[] = []
  for (const f of ['styles.css', 'components.css', 'plans.css', ...PAGES]) {
    const root = postcss.parse(readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8'))
    root.walkRules(r => {
      const parts = split(r.selector)
      sels.push(...parts)
      if (r.nodes.some(n => n.type === 'decl' && n.prop === 'cursor' && n.value.includes('--cur-act'))) acts.push(...parts)
    })
  }
  const hovers = sels.filter(s => s.includes(':hover')).flatMap(h => (m => (m ? split(m[1]).map(x => `${x}:hover${m[2]}`) : [h]))(/^:is\((.*)\):hover(.*)$/.exec(h)))
  const tagHover = (s: string) => (t => !!t && hovers.some(h => h === `${t}:hover` || h.startsWith(`${t}:hover`) || h.startsWith(`${t}:not(`)))(/(?:^|[\s>+~])([a-z]+)(?:[.[:][^\s>+~]*)?$/.exec(s)?.[1])
  const missing = acts.filter(s => !s.includes(':hover') && !NO_HOVER[s] && !hovers.some(h => h.includes(`${s}:hover`) || h.includes(`${s}:is(:hover`) || h.includes(`${s}:not(`) && h.includes(':hover')) && !tagHover(s))
  assert.deepEqual(missing, [])
})

// iOS Safari inflates text in landscape unless the root says not to; the prefixed one is the one it reads
test('the root rule keeps text at its size on a phone (text-size-adjust, both forms)', () => {
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
  const root = /^:root \{([^}]*)\}/m.exec(css)?.[1] ?? ''
  assert.match(root, /(^|\s)-webkit-text-size-adjust: 100%;/)
  assert.match(root, /(^|\s)text-size-adjust: 100%;/)
})

test("the Review tab's file head: its secondary buttons quiet by opacity, never display (their room stays, Tab reaches them)", () => {
  const root = postcss.parse(readFileSync(new URL('../src/renderer/src/review.css', import.meta.url), 'utf8'))
  const decls = (sel: string) => {
    const out: Record<string, string> = {}
    root.walkRules(r => {
      if (r.parent?.type === 'atrule') return // the touch screen's swap (⋯) is its own
      if (r.selectors.includes(sel)) r.walkDecls(d => void (out[d.prop] = d.value))
    })
    return out
  }
  const rest = decls('.fr-file-acts')
  assert.equal(rest.opacity, '0')
  assert.equal(rest['pointer-events'], 'none')
  assert.notEqual(rest.display, 'none')
  assert.match(rest.transition ?? '', /var\(--t-[a-z]+\)/, 'its fade on the motion tokens')
  const shown = decls('.fr-file-acts[data-show]')
  assert.equal(shown.opacity, '1')
  assert.equal(shown.display, undefined)
  // shown on the row's hover and keyboard focus
  let lit = false
  root.walkRules(r => void (r.selectors.some(s => /\.sp-row:is\(:hover, :focus-within\) \.fr-file-acts/.test(s)) && (lit = true)))
  assert.ok(lit, 'on :hover and :focus-within')
})

test("a Needs you card's morph (::view-transition-*(*.need)) runs on the motion tokens, no raw durations", () => {
  const root = postcss.parse(readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8'))
  let n = 0
  root.walkRules(r => {
    if (!r.selectors.some(s => s.includes('(*.need)'))) return
    n++
    r.walkDecls(/^animation-(duration|timing-function)$/, d => {
      assert.doesNotMatch(d.value, /\d+m?s\b(?![^(]*\))/, `${d.prop}: ${d.value}`)
      assert.match(d.value, /var\(--(t-|spring)/, `${d.prop} on a token: ${d.value}`)
    })
  })
  assert.ok(n >= 2, 'the group and its snapshots')
})
