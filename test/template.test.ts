import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillTemplate, MAIL_OK, nameOf, parseMails, shortPath, templated, templatesFor, youtubeEmbed, parseDuration, clock } from '../src/renderer/src/text.ts'

test('prompt templates: variables, unknown ones kept, a template without {{prompt}} gets it after', () => {
  assert.equal(fillTemplate('Fix {{ prompt }} in {{project}} from {{base}}; {{who}}', { prompt: 'login', project: 'app', base: 'main' }), 'Fix login in app from main; {{who}}')
  assert.equal(fillTemplate('{{constructor}}', {}), '{{constructor}}')
  const fix = { name: 'fix', text: 'Investigate and fix: {{prompt}}\nAdd a test.' }
  assert.equal(templated(fix, 'the redirect'), 'Investigate and fix: the redirect\nAdd a test.')
  assert.equal(templated({ name: 'tests', text: 'Write tests first.' }, 'for parse()'), 'Write tests first.\n\nfor parse()')
  assert.equal(templated(undefined, 'as typed'), 'as typed')
  assert.equal(nameOf('  the cart total rounding is off '), 'the cart total rounding')
  assert.equal(nameOf(' '), undefined)
})

test("prompt templates: a project's first, replacing a global one of its name", () => {
  const global = [{ name: 'fix', text: 'g fix {{prompt}}' }, { name: 'review', text: 'g review' }]
  assert.deepEqual(templatesFor(global, [{ name: ' fix', text: 'p fix' }, { name: 'ship', text: 'p ship' }]).map(t => t.text), ['p fix', 'p ship', 'g review'])
  assert.deepEqual(templatesFor(global), global)
  assert.deepEqual(templatesFor(undefined, global), global)
})

test('short paths for the status bar', () => {
  assert.equal(shortPath('/Users/igor/projects/app'), '~/projects/app')
  assert.equal(shortPath('/Users/igor/.laki/worktrees/app/fix-login'), '~/…/app/fix-login')
  assert.equal(shortPath('/opt/src/a/b/c'), '/…/b/c')
  assert.equal(shortPath('/Users/igor'), '~')
})

test('tunnel emails: whole domains by *@, @ or a bare name; what the daemons take', async () => {
  assert.deepEqual(parseMails(' me@x.dev, *@gmail.com;@team.dev  corp.io me@x.dev'), ['me@x.dev', '*@gmail.com', '*@team.dev', '*@corp.io'])
  for (const m of ['me@x.dev', '*@gmail.com', 'a.b+c@sub.team.dev']) assert.ok(MAIL_OK.test(m), m)
  for (const m of ['me*@x.dev', '*@*.x.dev', '*@localhost', 'a@b.dev,c@d.dev', '@x.dev', 'nope']) assert.ok(!MAIL_OK.test(m), m)
  // the daemon's own check is the same pattern
  const core = (await import('node:fs')).readFileSync(new URL('../src/daemon/core.ts', import.meta.url), 'utf8')
  assert.ok(core.includes(`const MAIL = /${MAIL_OK.source}/`), 'core.ts MAIL differs from text.ts MAIL_OK')
})

test('themes: unique ids, and every look has rules in look.css', async () => {
  const { THEMES } = await import('../src/renderer/src/themes.ts')
  const css = (await import('node:fs')).readFileSync(new URL('../src/renderer/src/look.css', import.meta.url), 'utf8')
  assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length)
  for (const t of THEMES) if (t.look) assert.ok(css.includes(`[data-look='${t.look}']`), t.look)
})

// themes.ts paints <html>: a stand-in with a style of CSS variables, and the stylesheet's :root (the default theme)
function fakeDom(root: Record<string, string>) {
  const props = new Map<string, string>()
  const style = {
    setProperty: (k: string, v: string) => void props.set(k, v),
    removeProperty: (k: string) => void props.delete(k),
    getPropertyValue: (k: string) => props.get(k) ?? '',
    colorScheme: '',
    [Symbol.iterator]: () => props.keys(),
  }
  const classes = new Set<string>()
  const html = { style, dataset: {} as Record<string, string>, classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) } }
  class CSSStyleRule {
    selectorText = ':root'
    style = { getPropertyValue: (k: string) => root[k] ?? '' }
  }
  Object.assign(globalThis, { CSSStyleRule, document: { documentElement: html, styleSheets: [{ cssRules: [new CSSStyleRule()] }] }, getComputedStyle: () => style })
  return { props, style, html, classes }
}

test('themes: applyTheme paints a theme, glass at its sliders, then the default again; termTheme reads it back', async () => {
  const { THEMES, applyTheme, preview, paintOf, paintKey, termTheme, transparent, UI_FALLBACK } = await import('../src/renderer/src/themes.ts')
  const { props, style, html, classes } = fakeDom({ '--bg': '#0e1014', '--side': '#12151b', '--fg': '#d5d9e3' })
  const kraft = THEMES.find(t => t.id === 'kraft')!

  applyTheme('kraft')
  assert.deepEqual([props.get('--bg'), props.get('--ansi-15'), props.get('--tc-purple'), html.dataset.look, style.colorScheme], ['#dcc39a', kraft.ansi![15], kraft.c!.purple, 'kraft', 'light'])
  assert.equal(transparent(), false)
  const term = termTheme()
  assert.deepEqual([term.background, term.red, term.brightWhite, term.cursor], ['#dcc39a', kraft.ansi![1], kraft.ansi![15], kraft.c!.accent])

  // glass: the window at 100 - 50%, the sidebar at 100 - 60% (its default), solid terminals; no glow
  applyTheme({ theme: 'circuit', glass: true, glassWindow: 50, glassTerm: 0, glassGlow: false, uiFont: 'Futura' })
  assert.deepEqual([props.get('--app-bg'), props.get('--side'), props.get('--term-bg'), props.get('--bg')], ['linear-gradient(#06261c80 0 0)', '#05201766', '#06261cff', '#06261c'])
  assert.equal(props.get('--ui-font'), `"Futura", ${UI_FALLBACK}`)
  assert.ok(classes.has('glass'))
  assert.equal(transparent(), false) // nothing shows through the terminals

  // the default theme under glass: the stylesheet's colors, with the glow; see-through terminals
  applyTheme({ glass: true, uiFont: 'system' })
  assert.match(props.get('--app-bg')!, /^radial-gradient.*linear-gradient\(#0e10148c 0 0\)$/)
  assert.deepEqual([props.get('--term-bg'), props.get('--ui-font'), props.get('--bg'), html.dataset.look], ['#0e101400', UI_FALLBACK, undefined, ''])
  assert.equal(transparent(), true)

  // a gradient theme: see-through terminals without glass; an unknown id is the default, every variable gone
  applyTheme('aurora')
  assert.deepEqual([props.get('--term-bg'), transparent()], ['#00000000', true])

  // Appearance's accent (text on it black or white, whichever reads) and corners, over the theme's; a bad color is skipped
  applyTheme({ theme: 'kraft', accent: '#ffe066', radius: '0px' })
  assert.deepEqual([props.get('--accent'), props.get('--accent-fg'), props.get('--radius'), props.get('--bg')], ['#ffe066', '#000000', '0px', '#dcc39a'])
  applyTheme({ accent: '#1a237e' })
  assert.deepEqual([props.get('--accent'), props.get('--accent-fg')], ['#1a237e', '#ffffff'])
  applyTheme({ theme: 'kraft', accent: 'red;x' })
  assert.equal(props.get('--accent'), kraft.c!.accent)
  applyTheme('nope')
  assert.deepEqual([[...props.keys()], style.colorScheme, classes.has('glass'), transparent()], [[], '', false, false])

  // Settings' cards and what the terminals watch
  assert.deepEqual(preview(kraft), [kraft.c!.bg, kraft.c!.panel, kraft.c!.fg, kraft.c!.accent, ...kraft.ansi!.slice(1, 6)])
  assert.match(preview(THEMES.find(t => t.id === 'aurora')!)[0], /^linear-gradient\(135deg/)
  assert.equal(preview(THEMES[0])[0], '#0e1014')
  assert.deepEqual(paintOf({ theme: 'riso', fontSize: 14 } as any), { theme: 'riso', uiFont: undefined, accent: undefined, radius: undefined, glass: undefined, glassWindow: undefined, glassSide: undefined, glassTerm: undefined, glassGlow: undefined })
  assert.equal(paintKey({ theme: 'riso' }), '["riso",null,null,null,null,null,null,null,null]')
})

test("the sidebar's video: YouTube links as embeds, anything else refused", () => {
  const e = 'https://www.youtube-nocookie.com/embed/'
  assert.equal(youtubeEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), `${e}dQw4w9WgXcQ?start=90`)
  assert.equal(youtubeEmbed(' youtu.be/dQw4w9WgXcQ?t=42 '), `${e}dQw4w9WgXcQ?start=42`)
  assert.equal(youtubeEmbed('https://m.youtube.com/shorts/dQw4w9WgXcQ'), `${e}dQw4w9WgXcQ`)
  assert.equal(youtubeEmbed('https://www.youtube.com/live/dQw4w9WgXcQ?si=x'), `${e}dQw4w9WgXcQ`)
  assert.equal(youtubeEmbed('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1-x_y'), `${e}dQw4w9WgXcQ?list=PL1-x_y`)
  assert.equal(youtubeEmbed('https://www.youtube.com/playlist?list=PL1-x_y'), `${e}videoseries?list=PL1-x_y`)
  assert.equal(youtubeEmbed('dQw4w9WgXcQ'), `${e}dQw4w9WgXcQ`)
  for (const bad of ['https://vimeo.com/123', 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=short', 'javascript:alert(1)', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ', ''])
    assert.equal(youtubeEmbed(bad), null, bad)
})

test("the sidebar's timer: lengths as typed, its clock", () => {
  const m = 60000
  assert.equal(parseDuration('25'), 25 * m)
  assert.equal(parseDuration(' 2.5 '), 150000)
  assert.equal(parseDuration('1h 30m'), 90 * m)
  assert.equal(parseDuration('1h30m'), 90 * m)
  assert.equal(parseDuration('90s'), 90000)
  assert.equal(parseDuration('45 min'), 45 * m)
  assert.equal(parseDuration('2 hours'), 120 * m)
  assert.equal(parseDuration('1 hour 5 minutes 10 seconds'), 65 * m + 10000)
  for (const bad of ['', 'soon', '0', '25 x', '25 parsecs', '-5', '25h', 'm', '1h 2'])
    assert.equal(parseDuration(bad), null, bad)
  assert.deepEqual([clock(0), clock(999), clock(65000), clock(3723000), clock(-5)], ['0:00', '0:01', '1:05', '1:02:03', '0:00'])
})
