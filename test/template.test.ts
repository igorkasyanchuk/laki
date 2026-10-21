import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webmail, browserUrl, csvSep, fillTemplate, importable, initials, parseCsv, toCsv, MAIL_OK, nameOf, parseMails, shortPath, templated, templatesFor, youtubeEmbed, parseDuration, parseLater, laterText, clock, prRef, previewUrl, previewAddr, parseSize, wavOf } from '../src/renderer/src/text.ts'

test('prompt templates: variables, unknown ones kept, a template without {{prompt}} gets it after', () => {
  assert.equal(fillTemplate('Fix {{ prompt }} in {{project}} from {{base}}; {{who}}', { prompt: 'login', project: 'app', base: 'main' }), 'Fix login in app from main; {{who}}')
  assert.equal(fillTemplate('{{constructor}}', {}), '{{constructor}}')
  // the template's dates are now's; a typed prompt's braces stay
  const at = new Date(2026, 9, 5, 7, 5).getTime()
  assert.equal(fillTemplate('{{YYYY-MM-DD HH:MM}} {{prompt}}', { prompt: 'keep {{HH}}' }, at), '2026-10-05 07:05 keep {{HH}}')
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
  // a webmail domain: anyone can get an address there (the popup warns)
  assert.deepEqual(['*@gmail.com', '*@GoogleMail.com', '*@outlook.com', '*@proton.me', '*@gmx.de', '*@gmx.co.uk', '*@yandex.ru', '*@mail.ru', '*@icloud.com', '*@me.com'].map(webmail), ['gmail.com', 'googlemail.com', 'outlook.com', 'proton.me', 'gmx.de', 'gmx.co.uk', 'yandex.ru', 'mail.ru', 'icloud.com', 'me.com'])
  for (const m of ['me@gmail.com', '*@team.dev', '*@notgmail.com', '*@gmail.com.evil.dev', '*@mail.ru.dev']) assert.equal(webmail(m), undefined, m)
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
  const { THEMES, applyTheme, blurred, preview, paintOf, paintKey, termTheme, transparent, UI_FALLBACK } = await import('../src/renderer/src/themes.ts')
  const { props, style, html, classes } = fakeDom({ '--bg': '#0e1014', '--side': '#12151b', '--fg': '#d5d9e3' })
  const kraft = THEMES.find(t => t.id === 'kraft')!

  applyTheme('kraft')
  assert.deepEqual([props.get('--bg'), props.get('--ansi-15'), props.get('--tc-purple'), html.dataset.look, style.colorScheme], ['#dcc39a', kraft.ansi![15], kraft.c!.purple, 'kraft', 'light'])
  assert.equal(transparent(), false)
  const term = termTheme()
  assert.deepEqual([term.background, term.red, term.brightWhite, term.cursor], ['#dcc39a', kraft.ansi![1], kraft.ansi![15], kraft.c!.accent])
  assert.equal(props.get('--rail-bg'), `color-mix(in srgb, color-mix(in srgb, ${kraft.c!.side} 94%, #000) 100%, transparent)`) // a light theme's rail: a shade darker, not grey

  // glass: the window at 100 - 50%, the sidebar at 100 - 60% (its default), solid terminals; no glow
  applyTheme({ theme: 'circuit', glass: true, glassWindow: 50, glassTerm: 0, glassGlow: false, uiFont: 'Futura' })
  assert.deepEqual([props.get('--app-bg'), props.get('--side'), props.get('--term-bg'), props.get('--bg')], ['linear-gradient(#06261c80 0 0)', '#05201766', '#06261cff', '#06261c'])
  assert.equal(props.get('--ui-font'), `"Futura", ${UI_FALLBACK}`)
  assert.ok(classes.has('glass'))
  assert.equal(transparent(), false) // nothing shows through the terminals
  assert.equal(html.dataset.motion, 'low') // Animations unset: the usual
  applyTheme({ theme: 'circuit', motion: 'none' })
  assert.equal(html.dataset.motion, 'none')

  // the default theme under glass: the stylesheet's colors, with the glow; see-through terminals
  applyTheme({ glass: true, uiFont: 'system' })
  assert.match(props.get('--app-bg')!, /^radial-gradient.*linear-gradient\(#0e10148c 0 0\)$/)
  assert.deepEqual([props.get('--term-bg'), props.get('--ui-font'), props.get('--bg'), html.dataset.look], ['#0e101400', UI_FALLBACK, undefined, ''])
  assert.equal(transparent(), true)
  // part see-through terminals: .term-wrap paints it once, xterm its color at alpha 0 (inverse text: made opaque)
  applyTheme({ glass: true, glassTerm: 35 })
  assert.deepEqual([props.get('--term-bg'), termTheme().background], ['#0e1014a6', '#0e101400'])

  // a gradient theme: see-through terminals without glass; an unknown id is the default, every variable gone
  applyTheme('aurora')
  assert.deepEqual([props.get('--term-bg'), transparent()], ['#00000000', true])

  // Appearance's accent (text on it black or white, whichever reads) and corners, over the theme's; a bad color is skipped
  applyTheme({ theme: 'kraft', accent: '#ffe066', radius: '0px' })
  assert.deepEqual([props.get('--accent'), props.get('--accent-fg'), props.get('--radius'), props.get('--rs'), props.get('--bg')], ['#ffe066', '#000000', '0px', '0px', '#dcc39a'])
  applyTheme({ accent: '#1a237e' })
  assert.equal(props.get('--rs'), undefined) // the theme's corners: each fixed radius its own
  assert.deepEqual([props.get('--accent'), props.get('--accent-fg')], ['#1a237e', '#ffffff'])
  applyTheme({ theme: 'kraft', accent: 'red;x' })
  assert.equal(props.get('--accent'), kraft.c!.accent)
  applyTheme('nope')
  assert.deepEqual([[...props.keys()], style.colorScheme, classes.has('glass'), transparent()], [[], '', false, false])

  // Sidebar see-through without glass: only in the app (window.laki: a browser has no blur behind the page), the
  // sidebar and the rail at 100 - 60%, the rest solid; glass has its own sidebar slider
  applyTheme({ sideClear: 60 })
  assert.deepEqual([classes.has('side-clear'), props.get('--side')], [false, undefined])
  const g = globalThis as { laki?: unknown }
  g.laki = {}
  try {
    applyTheme({ sideClear: 60 })
    assert.deepEqual([classes.has('side-clear'), props.get('--side'), transparent()], [true, '#12151b66', false])
    assert.match(props.get('--rail-bg')!, /^color-mix\(in srgb, color-mix\(in srgb, #12151b 82%, #000\) 40%, transparent\)$/)
    applyTheme({ glass: true, sideClear: 60, glassSide: 100 })
    assert.deepEqual([classes.has('side-clear'), props.get('--side')], [true, '#12151b00']) // glass in the app: the sidebar over the blur, by glass's own slider
  } finally {
    delete g.laki
  }
  assert.deepEqual([blurred({ sideClear: 5 }), blurred({ glass: true }), blurred({ sideClear: 0 })], [true, true, false]) // the window's blur

  // Settings' cards and what the terminals watch
  assert.deepEqual(preview(kraft), [kraft.c!.bg, kraft.c!.panel, kraft.c!.fg, kraft.c!.accent, ...kraft.ansi!.slice(1, 6)])
  assert.match(preview(THEMES.find(t => t.id === 'aurora')!)[0], /^linear-gradient\(135deg/)
  assert.equal(preview(THEMES[0])[0], '#0e1014')
  assert.deepEqual(paintOf({ theme: 'riso', fontSize: 14 } as any), { theme: 'riso', uiFont: undefined, accent: undefined, radius: undefined, glass: undefined, glassWindow: undefined, glassSide: undefined, glassTerm: undefined, glassGlow: undefined, sideClear: undefined, motion: undefined })
  assert.equal(paintKey({ theme: 'riso' }), '["riso",null,null,null,null,null,null,null,null,null,null]')
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

test('Send later: in a length, or at a time of day (today, tomorrow once past)', () => {
  const m = 60000
  const now = new Date(2026, 9, 7, 14, 10).getTime()
  for (const [typed, ms] of [['10m', 10 * m], ['in 2h', 120 * m], ['1h 30m', 90 * m], ['45', 45 * m], ['at 15:30', 80 * m], ['15:30', 80 * m], ['3pm', 50 * m], ['at 3 PM', 50 * m], ['at 15', 50 * m], ['14:00', 24 * 60 * m - 10 * m], ['12am', (24 - 14) * 60 * m - 10 * m], ['at 9:05am', (24 - 14 + 9) * 60 * m - 5 * m]] as const)
    assert.equal(parseLater(typed, now), ms, typed)
  for (const bad of ['', 'later', 'at', 'at noon', '25:00', '13pm', '0am', 'at 7:75', '25h']) assert.equal(parseLater(bad, now), null, bad)
})

test("Send later's edit: its time again, read back to the same minute (ASCII digits in any locale); 1m once that minute began", () => {
  const now = new Date(2026, 9, 7, 22, 40, 30).getTime()
  for (const ahead of [5 * 60000, 3 * 3600000 + 17 * 60000, 23 * 3600000]) {
    const at = now + ahead
    assert.match(laterText(at, now), /^at \d{1,2}:\d{2}$/)
    const back = parseLater(laterText(at, now), now)!
    assert.ok(Math.abs(back - ahead) < 60000, `${ahead}: ${back}`) // past midnight too: tomorrow's
  }
  assert.equal(laterText(now + 90000, now), '1m')
  assert.equal(laterText(now - 5000, now), '1m')
})

test("a settings file from another version: fields of the wrong kind left out, the rest (unknown ones too) in, this Mac's env kept", () => {
  assert.deepEqual(importable({ theme: 'starship', fontSize: '14', actions: {}, presets: null, gone: 1, env: { A: '1' } }), {
    ok: { theme: 'starship', presets: null, gone: 1 },
    bad: ['fontSize', 'actions'],
  })
})

test("{{pr}}: the PR field, else a PR link in the prompt, else a prompt of only #n; a prompt it took isn't added again", () => {
  assert.equal(prRef('#5', 'https://github.com/o/r/pull/7'), '#5')
  assert.equal(prRef(' https://github.com/o/r/pull/5 ', ''), 'https://github.com/o/r/pull/5')
  assert.equal(prRef('', 'look at https://github.com/o/r/pull/7 please'), 'https://github.com/o/r/pull/7')
  assert.equal(prRef('', ' 77 '), '#77')
  assert.equal(prRef('', 'fix 77 things'), undefined)
  const t = { name: 'review', text: 'Review {{pr}} closely' }
  assert.equal(templated(t, '#77', { pr: prRef('', '#77') }), 'Review #77 closely')
  assert.equal(templated(t, '77', { pr: prRef('', '77') }), 'Review #77 closely')
  assert.equal(templated(t, 'and its tests', { pr: '#5' }), 'Review #5 closely\n\nand its tests')
  assert.equal(templated(t, 'x', {}), 'Review {{pr}} closely\n\nx') // none: left as it is
})

test("the preview's address bar: a path on the port, another port, this Mac's, any site, a whole URL; sizes typed", () => {
  assert.equal(previewUrl('/a?b', 3000), 'http://localhost:3000/a?b')
  assert.equal(previewUrl('a', 3000), 'http://localhost:3000/a')
  assert.equal(previewUrl('', 3000), 'http://localhost:3000/')
  assert.equal(previewUrl(':5173/x', 3000), 'http://localhost:5173/x')
  assert.equal(previewUrl('localhost:8080', 3000), 'http://localhost:8080')
  assert.equal(previewUrl('127.0.0.1:9/x', 3000), 'http://127.0.0.1:9/x')
  assert.equal(previewUrl('example.com/docs', 3000), 'https://example.com/docs')
  assert.equal(previewUrl(' https://github.com/o ', 3000), 'https://github.com/o')
  assert.equal(previewUrl('http://example.com', 3000), 'http://example.com')
  assert.equal(previewUrl('HTTPS://Example.com', 3000), 'https://Example.com')
  assert.equal(previewAddr('http://localhost:3000/a'), 'localhost:3000/a')
  assert.equal(previewAddr('https://example.com/'), 'https://example.com/')
  assert.equal(previewAddr('http://localhost.evil.com/'), 'http://localhost.evil.com/')
  assert.deepEqual(parseSize('1440x900'), [1440, 900])
  assert.deepEqual(parseSize(' 375 × 667 '), [375, 667])
  assert.equal(parseSize('100x100'), null)
  assert.equal(parseSize('wide'), null)
})

test('csv: parsed and written back as it was; quotes, newlines, separators', () => {
  const t = 'name,note\n"Doe, J","said ""hi""\nthen left"\nx,\n'
  const { rows, quoted } = parseCsv(t)
  assert.deepEqual(rows, [['name', 'note'], ['Doe, J', 'said "hi"\nthen left'], ['x', '']])
  assert.deepEqual(quoted, [[false, false], [true, true], [false, false]])
  assert.equal(toCsv(rows), t, 'round trip')
  const all = '"a","b"\n"1","2"'
  assert.equal(toCsv(parseCsv(all).rows, ',', parseCsv(all).quoted, false), all, 'all quoted, no last newline: kept')
  const mixed = parseCsv('"name",price\n"Coffee",12.5\n')
  mixed.rows[1][1] = '13'
  assert.equal(toCsv(mixed.rows, ',', mixed.quoted), '"name",price\n"Coffee",13\n', 'quoted text, bare numbers: only the cell edited changes')
  assert.equal(toCsv([...mixed.rows, ['Tea', '4'], ['Mug', '9']].map(r => [...r, 'x']), ',', mixed.quoted), '"name",price,x\n"Coffee",13,x\n"Tea",4,x\n"Mug",9,x\n', 'new rows like the one above, a new column like the cell before')
  assert.deepEqual(parseCsv('a;b\r\n1;2\r\n', ';').rows, [['a', 'b'], ['1', '2']], 'CRLF')
  assert.deepEqual(parseCsv('').rows, [])
  assert.deepEqual(parseCsv('"",x').rows, [['', 'x']])
  assert.equal(csvSep('a.csv', 'a;b;c\n1;2;3'), ';')
  assert.equal(csvSep('a.csv', '"x,y";b\n'), ';', 'commas in quotes do not count')
  assert.equal(csvSep('a.tsv', 'a,b'), '\t')
  assert.equal(csvSep('a.csv', 'single'), ',')
})

test("the bubbles' initials: words without pr, issue and numbers, none the same", () => {
  assert.deepEqual(initials(['fix-cart-total']), ['FC'])
  assert.deepEqual(initials(['pr-14162-app-3888-buy-tickets', 'pr-14176-web-1608-bound-renderer', 'pr-14075-app-3865-resume-the-blog']), ['AB', 'WB', 'AR'])
  assert.deepEqual(initials(['dark-mode', 'dark-mode', 'dark-mode']), ['DM', 'DA', 'MO'])
  assert.deepEqual(initials(['x', 'x', 'x']), ['X', 'X2', 'X3'])
  assert.deepEqual(initials(['pr-42', '']), ['P4', '?']) // only those: all its words
})

test("a Browsers page's address bar: URLs, sites, else a search", () => {
  assert.equal(browserUrl(' https://a.com/x '), 'https://a.com/x')
  assert.equal(browserUrl('example.com/docs?q=1'), 'https://example.com/docs?q=1')
  assert.equal(browserUrl('localhost:3000/x'), 'http://localhost:3000/x')
  assert.equal(browserUrl('192.168.1.1'), 'http://192.168.1.1')
  assert.equal(browserUrl('how to tar'), 'https://duckduckgo.com/?q=how%20to%20tar')
  assert.equal(browserUrl('javascript:alert(1)'), 'https://duckduckgo.com/?q=javascript%3Aalert(1)')
  assert.equal(browserUrl(''), '')
})

test("Voice's recording as WAV: a 44-byte header, then 16-bit samples, clipped", () => {
  const w = wavOf(new Float32Array([0, 1, -1, 2]), 16000)
  const d = new DataView(w.buffer)
  const str = (at: number, n: number) => String.fromCharCode(...w.subarray(at, at + n))
  assert.equal(w.length, 44 + 8)
  assert.equal(str(0, 4), 'RIFF')
  assert.equal(d.getUint32(4, true), 36 + 8)
  assert.equal(str(8, 8), 'WAVEfmt ')
  assert.deepEqual([d.getUint16(20, true), d.getUint16(22, true), d.getUint32(24, true), d.getUint32(28, true), d.getUint16(34, true)], [1, 1, 16000, 32000, 16])
  assert.equal(str(36, 4), 'data')
  assert.equal(d.getUint32(40, true), 8)
  assert.deepEqual([0, 1, 2, 3].map(i => d.getInt16(44 + i * 2, true)), [0, 32767, -32767, 32767])
  assert.deepEqual(importable({ voice: 'cloud' }).bad, ['voice'])
})
