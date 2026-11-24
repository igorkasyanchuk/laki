// every theme stays readable: text, hints, button labels, status marks and terminal colors against what they sit on
// (WCAG contrast ratios)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { GLASS_LEVELS, MATERIAL, SEL_A, SEL_A_LIGHT, SURFACE, THEMES, accentFits, glassLevelOf, glassOf, onAccent, contrast as ratio, materialInk, pickTint, readable, selAlpha, surfaceAlpha } from '../src/renderer/src/themes.ts'

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
const WS_MIX = 0.08 // styles.css' --ws-mix: the workspace's color in the glass
const WS_HINT = 0.35 // and how far a tinted capsule's hints go toward its text
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
    // a diff's word marks (styles.css mark.wd): the page's text on its line's tint and the mark's (15% of --add or --del)
    for (const [k, i] of [['add', 2], ['del', 1]] as const) {
      const ink = t.c ? readable(ansi[i], [...bg, c.panel, c.raised]) : v(k)
      const line = over(ansi[i].slice(0, 7) + '1f', c.panel)
      need(`word mark (${k})`, c.fg, over(ink.slice(0, 7) + '26', line), 4.5)
      // Diff style Quiet (html[data-diff='quiet']): the code's own color on 9% of --add or --del, over a diff's page, a
      // panel or an ask's card, as plain text needs; its word marks (15%, as Filled's) over that, on a panel as Filled's
      for (const under of [...bg, c.panel, c.raised]) need(`Quiet diff row (${k})`, c.fg, over(ink.slice(0, 7) + '17', under), 4.5)
      need(`Quiet word mark (${k})`, c.fg, over(ink.slice(0, 7) + '26', over(ink.slice(0, 7) + '17', c.panel)), 4.5)
    }
    // Needs you's choices (styles.css, the default look and Frosted): the text on a fill of it (7%, its hover 11%) or of
    // the accent (22%, 30%) over the card (raised)
    // (themes.ts pickTint, its hover's; the rest 6 less, 22% at most)
    const mix = (a: string, b: string, k: number) => hex(rgb(a).map((x, i) => x * k + rgb(b)[i] * (1 - k)))
    const pick = pickTint(c.accent, c.raised, c.fg)
    if (pick - 6 < 8) bad.push(`${t.name}: a Needs you choice's accent tint is ${pick - 6}%: too faint to tell it`)
    for (const [k, what] of [[0.07, 'fg'], [0.11, 'fg'], [(pick - 6) / 100, 'accent'], [pick / 100, 'accent']] as const) need(`a Needs you choice (${what} ${Math.round(k * 100)}%)`, c.fg, mix(c[what].slice(0, 7), c.raised.slice(0, 7), k), 4.5)
    // the accent as text: applyTheme's --accent-ink
    for (const b of [...bg, c.panel, ...side]) need('accent text', readable(c.accent, [...bg, c.panel, ...side]), b, 4.5)
    // V5's translucent sidebar: its tint of the sidebar's color over the brightest and the darkest wallpaper, the worst
    // the material can be; the sidebar's text and hints there (materialInk) still pass AA
    const ink = materialInk(c.side, c.fg, c.muted)!
    const a = Math.round((MATERIAL / 100) * 255).toString(16).padStart(2, '0') // its own alpha dropped (applyTheme)
    for (const w of ['#ffffff', '#000000']) on(`material over ${w}: fg`, ink.fg, [over(c.side.slice(0, 7) + a, w)], 4.5), on(`material over ${w}: muted`, ink.muted, [over(c.side.slice(0, 7) + a, w)], 4.5)
    need('material: hints under the text', ink.fg, ink.muted, 1.1) // both made to read: less apart than on a solid sidebar
    // V8's floating surface: the panel at its strength over the window, the sidebar and a blurred busy terminal (a
    // quarter of its text over its background); the text and hints on it pass AA
    // at each of Glass › Strength's levels (Clear, Regular, Tinted: themes.ts GLASS_LEVELS), from where it starts
    const under = [c.bg, over(c.side, c.bg), ...[c.bg, c.side, c.fg].map(x => over(x.slice(0, 7) + '40', c.bg))]
    for (const [level, from] of Object.entries(GLASS_LEVELS)) {
      const la = surfaceAlpha(c.panel, c.bg, c.side, c.fg, c.muted, from)
      assert.ok(la >= from && la <= 100, `${t.name} ${level}: ${la}`)
      const lt = c.panel.slice(0, 7) + Math.round((la / 100) * 255).toString(16).padStart(2, '0')
      on(`surface (${level}): fg`, c.fg, under.map(u => over(lt, u)), 4.5)
      on(`surface (${level}): muted`, c.muted, under.map(u => over(lt, u)), 4.5)
    }
    const sa = surfaceAlpha(c.panel, c.bg, c.side, c.fg, c.muted)
    assert.ok(sa >= SURFACE && sa <= 100)
    const top = c.panel.slice(0, 7) + Math.round((sa / 100) * 255).toString(16).padStart(2, '0')
    // V11's capsules (the tab bar's buttons, the Reader's composer, the status bar's groups) are the same fill: covered above
    // the open workspace's color in the glass (styles.css: --ws-mix, 8%): the selected tab's label on its tinted fill,
    // a capsule's text and hints on its tinted surface, for each workspace color (themes.ts' --tc-*; lime, brown and
    // gray are mixes of these)
    const tc: Record<string, string | undefined> = t.c ? { red: ansi[1], orange: c.orange, yellow: ansi[3], green: ansi[2], teal: ansi[6], blue: ansi[4], purple: c.purple, pink: c.pink } : Object.fromEntries(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].map(k => [k, v(`tc-${k}`)]))
    const tint = (col: string, base: string) => hex(rgb(col).map((x, i) => x * WS_MIX + rgb(base)[i] * (1 - WS_MIX)))
    for (const [name, col] of Object.entries(tc)) {
      if (!col) continue
      for (const b of bg) need(`selected tab on its ${name} tint`, c.fg, tint(col, b), 4.5)
      // a tinted capsule's hints a step toward the text (styles.css: --muted mixed with --fg by WS_HINT there)
      const hint = hex(rgb(c.muted).map((x, i) => x * (1 - WS_HINT) + rgb(c.fg)[i] * WS_HINT))
      for (const u of under.map(u => over(top, u))) need(`capsule text on its ${name} tint`, c.fg, tint(col, u), 4.5), need(`capsule hints on its ${name} tint`, hint, tint(col, u), 4.5)
    }
  }
  assert.deepEqual(bad, [])
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /--cap-bg: color-mix\(in srgb, var\(--panel\) var\(--surface-a\), transparent\)/, "V11: a capsule's fill is the floating surface's, whose text the pairs above check")
  assert.match(css, new RegExp(`\\.main\\.ws-tint \\{ --ws-mix: ${WS_MIX * 100}%;`), "the workspace's tint is the mix checked above")
  assert.match(css, new RegExp(`\\.main\\.ws-tint \\.capsule \\{ --muted: color-mix\\(in srgb, var\\(--muted\\) ${Math.round((1 - WS_HINT) * 100)}%, var\\(--fg\\)\\); \\}`), "and its hints' step is the one checked above")
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

// 9c: the selection is the accent at --sel-a (themes.ts selAlpha) over the background, the panels and the sidebar: its
// text reads (4.5:1) in every theme, at SEL_A (a light one's SEL_A_LIGHT) where that's enough
test('contrast: selected text reads over the accent selection in every theme', () => {
  const root = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8').match(/:root\s*{([^}]*)}/)![1]
  const v = (k: string) => root.match(new RegExp(`--${k}:\\s*(#[0-9a-fA-F]+)`))![1]
  const pct = (a: number) => Math.round((a / 100) * 255).toString(16).padStart(2, '0')
  const bad: string[] = []
  let full = 0
  for (const t of THEMES) {
    const c = (t.c ?? { bg: v('bg'), panel: v('panel'), side: v('side'), fg: v('fg'), accent: v('accent') }) as Record<string, string>
    const ends = t.grad ? [...t.grad] : [c.bg]
    const bgs = [...ends, c.panel, ...ends.map(e => over(c.side, e))]
    const a = selAlpha(c.accent, bgs, c.fg, 4.5, t.light ? SEL_A_LIGHT : SEL_A)
    if (a === (t.light ? SEL_A_LIGHT : SEL_A)) full++
    for (const b of bgs) {
      const r = ratio(c.fg, over(c.accent + pct(a), b))
      if (r < 4.5) bad.push(`${t.name}: selected text on ${b} at ${a}% is ${r.toFixed(2)}`)
    }
  }
  assert.deepEqual(bad, [])
  assert.ok(full > THEMES.length / 2, 'most themes keep the full strength')
  assert.equal(selAlpha('#ffffff', ['#000000'], '#000000'), 8, 'none reads: the least')
  assert.equal(selAlpha('var(--x)', ['#000000'], '#ffffff'), SEL_A, 'not hex: as the stylesheet says')
})

// macOS's accent colors (System Settings › Appearance; light and dark appearances' controlAccentColor) on Laki's theme
// pair, a new Mac install's: one that fits is a fill with a readable label and a focus ring that shows (3:1); one that
// doesn't (yellow, graphite on Laki Light) falls back to the theme's own, which the test above checks
test("contrast: macOS's accent on Laki and Laki Light: its label reads and its ring shows, else the theme's accent", () => {
  const MAC = { blue: ['#007aff', '#0a84ff'], purple: ['#953d96', '#a550a7'], pink: ['#e3407f', '#f74f9e'], red: ['#e0383e', '#ff5257'], orange: ['#f7821b', '#fc8a2b'], yellow: ['#ffc600', '#ffd60a'], green: ['#62ba46', '#32d74b'], graphite: ['#8c8c8c', '#989898'] }
  const fell: string[] = []
  for (const id of ['laki', 'laki-light']) {
    const t = THEMES.find(x => x.id === id)!
    const bgs = [t.c!.bg, t.c!.panel]
    for (const [name, [light, dark]] of Object.entries(MAC)) {
      const c = t.light ? light : dark
      if (!accentFits(c, bgs)) {
        fell.push(`${id} ${name}`)
        continue
      }
      assert.ok(ratio(onAccent(c), c) >= 4.5, `${id} ${name}: its label`)
      for (const b of bgs) assert.ok(ratio(c, b) >= 3, `${id} ${name}: its ring on ${b}`)
    }
  }
  assert.ok(fell.includes('laki-light yellow'), `yellow falls back on Laki Light (fell back: ${fell.join(', ')})`)
  assert.ok(!fell.includes('laki blue') && !fell.includes('laki-light blue'), 'blue fits both')
})

// glass (Frosted, Settings › Appearance › Glass): the worst the desktop can be under a surface, pure white under a
// dark theme and pure black under a light one. Each glass surface (the floating one, the sidebar and rail, the window's
// tint the tab bar sits on) at the strength applyTheme gives it (themes.ts glassOf) over that: the text, the hints
// (--muted: muted text, inactive tabs' labels, the rail's) 4.5:1, the faintest hint and an icon (--muted at 80%) 3:1
test('contrast: on glass, text, hints and inactive tabs read over a white desktop (dark themes) or a black one (light)', () => {
  const root = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8').match(/:root\s*{([^}]*)}/)![1]
  const v = (k: string) => root.match(new RegExp(`--${k}:\\s*(#[0-9a-fA-F]+)`))![1]
  const pct = (a: number) => Math.round((a / 100) * 255).toString(16).padStart(2, '0')
  const bad: string[] = []
  for (const t of THEMES) {
    const c = (t.c ?? { panel: v('panel'), side: v('side'), bg: v('bg'), fg: v('fg'), muted: v('muted') }) as Record<string, string>
    for (const glassLevel of Object.keys(GLASS_LEVELS)) {
    const g = glassOf({ panel: c.panel, side: c.side, bg: c.bg, fg: c.fg, muted: c.muted }, !!t.light, { glassLevel })
    const desk = t.light ? '#000000' : '#ffffff'
    for (const [what, col, a] of [['surface', c.panel, g.surface], ['sidebar', c.side, g.side], ['window', c.bg, g.window]] as const) {
      const on = over(col.slice(0, 7) + pct(a), desk)
      for (const [k, ink, min] of [['text', c.fg.slice(0, 7), 4.5], ['hints and inactive tabs', g.muted, 4.5], ['the faintest hint, an icon', over(g.muted + pct(80), on), 3]] as const) {
        const r = ratio(ink, on)
        if (r < min) bad.push(`${t.name} (${glassLevel}): ${k} on its ${what} at ${a}% over ${desk} is ${r.toFixed(2)}, needs ${min}`)
      }
    }
    assert.ok(ratio(c.fg.slice(0, 7), g.muted) >= 1.1 || c.fg.slice(0, 7) === g.muted, `${t.name}: the hints a step below the text`)
    }
  }
  assert.deepEqual(bad, [])
})

test("Glass › Strength: clear, regular and tinted start at 56, 72 and 88%; anything else is regular", () => {
  assert.deepEqual(GLASS_LEVELS, { clear: 56, regular: 72, tinted: 88 })
  assert.equal(SURFACE, GLASS_LEVELS.regular)
  for (const x of [undefined, '', 'Clear', 'frosted', 3, null, {}]) assert.equal(glassLevelOf(x), 'regular', String(x))
  assert.equal(glassLevelOf('clear'), 'clear')
  assert.equal(glassLevelOf('tinted'), 'tinted')
  // the glass floor starts from it: a clearer level is never stronger than a more tinted one
  const t = THEMES.find(x => x.id === 'laki')!.c!
  const [c, r, k] = (['clear', 'regular', 'tinted'] as const).map(glassLevel => glassOf({ panel: t.panel, side: t.side, bg: t.bg, fg: t.fg, muted: t.muted }, false, { glassLevel }).surface)
  assert.ok(c <= r && r <= k && k >= 88, `${c} ${r} ${k}`)
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /html\.glass-full \{ --cap-bg: color-mix\(in srgb, var\(--panel\) min\(100%, calc\(var\(--surface-a\) \+ 18%\)\), transparent\);/, "full glass's capsules by --surface-a, no alpha of their own")
  // glass with an opaque main area (Window at 0) keeps the floats' blur: only full glass turns it off
  for (const rule of ['html:is(.opaque, .glass-full) { --surface-bg: var(--panel); --surface-blur: none; }', 'html:is(.opaque, .glass-full) .edge-blur::before, html:is(.opaque, .glass-full) .edge-blur::after { display: none; }']) assert.ok(css.includes(rule), rule)
  assert.doesNotMatch(css, /html:is\(\.opaque, \.glass\)|html\.lens:not\(\.opaque, \.glass,/, 'no blur off for every glass')
  assert.match(css, /\.term-wrap \.capsule \{ --cap-blur: none;/, 'never a blur over a terminal')
})
