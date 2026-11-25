// E3: Electron main's checks (src/main/guards.ts), on plain node: who may send IPC, which URLs get through
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { backAsk, titleOf, appFile, appPage, BROWSER, confirmAsk, dockAgents, dockMenu, dragOk, recentOk, showAtLaunch, externalOf, fromApp, handoffUrl, fromTokenPage, local, MENU_DEPTH, MENU_ITEMS, menuModelOk, pageIs, PREVIEW, tokenPage, webviewOk } from '../src/main/guards.ts'

test('main guards: only the app window’s main frame on the app’s own page is the app', () => {
  const page = 'app://laki/index.html'
  assert.equal(fromApp({ type: 'window', main: true, url: page }), true)
  assert.equal(fromApp({ type: 'window', main: true, url: `${page}?window=ai` }), true)
  for (const [s, why] of [
    [{ type: 'webview', main: true, url: page }, 'a webview'],
    [{ type: 'window', main: false, url: page }, 'a frame inside'],
    [{ type: 'window', main: true, url: 'https://evil.example/' }, 'a site'],
    [{ type: 'window', main: true, url: 'http://localhost:5199/' }, 'a dev origin, built'],
    [{ type: 'window', main: true }, 'no URL'],
    [{ type: 'browserView', main: true, url: page }, 'another kind'],
    [{ type: 'window', main: true, url: 'file:///Applications/Laki.app/Contents/Resources/app/out/renderer/index.html' }, 'S9: a file:// page (any file on the disk)'],
    [{ type: 'window', main: true, url: 'app://laki.evil/index.html' }, 'another app: host'],
    [{ type: 'window', main: true, url: 'app://lakix/index.html' }, 'a look-alike host'],
  ] as const)
    assert.equal(fromApp(s), false, why)
  // a dev build: its dev server's origin only, not a look-alike
  assert.equal(fromApp({ type: 'window', main: true, url: 'http://localhost:5199/?window=new' }, 'http://localhost:5199'), true)
  for (const u of ['http://localhost:5199.evil.example/', 'http://localhost:5198/', 'http://evil@localhost:5199x/', 'file:///x.html', 'not a url'])
    assert.equal(appPage(u, 'http://localhost:5199'), false, u)
  // pages by name: their ?window= exactly
  assert.equal(pageIs(`${page}?window=new`, 'new'), true)
  assert.equal(pageIs(`${page}?window=newer`, 'new'), false)
  assert.equal(pageIs(`${page}#window=new`, 'new'), false)
  assert.equal(pageIs(undefined, 'new'), false)
  assert.equal(pageIs('app://laki/ask.html?window=inbox', 'inbox'), true, "the menu bar's Inbox")
  assert.equal(pageIs('app://laki/ask.html', 'inbox'), false, 'the cards on screen are not the Inbox')
  // the side panel's own window (shots.ts' capture: its Preview's screenshot): its page by name, nothing else
  assert.equal(pageIs(`${page}?window=panel`, 'panel'), true)
  for (const u of [`${page}?window=panels`, `${page}?window=new`, 'https://example.com/?window=panel']) assert.equal(pageIs(u, 'panel') && fromApp({ type: 'window', main: true, url: u }), false, u)
})

test('S9: the token only to index.html’s pages; app:// requests stay in out/renderer', () => {
  for (const u of ['app://laki/index.html', 'app://laki/', 'app://laki/index.html?window=new', 'app://laki/index.html?window=sim&id=x'])
    assert.equal(tokenPage(u), true, u)
  for (const u of ['app://laki/ask.html', 'app://laki/floater.html#bar', 'app://laki/floater.html#voice', 'app://laki/annotate.html', 'app://laki/icon-192.png', 'file:///x/index.html', undefined])
    assert.equal(tokenPage(u), false, String(u))
  assert.equal(fromTokenPage({ type: 'window', main: true, url: 'app://laki/index.html?window=ai' }), true)
  assert.equal(fromTokenPage({ type: 'window', main: false, url: 'app://laki/index.html' }), false, 'a frame')
  assert.equal(fromTokenPage({ type: 'window', main: true, url: 'app://laki/ask.html' }), false, 'a card')
  // dev: the dev server's root and ?window= pages, not its other pages
  assert.equal(tokenPage('http://localhost:5199/?window=new', 'http://localhost:5199'), true)
  assert.equal(tokenPage('http://localhost:5199/floater.html#bar', 'http://localhost:5199'), false)
  const root = '/A/out/renderer/'
  assert.equal(appFile('app://laki/index.html', root), '/A/out/renderer/index.html')
  assert.equal(appFile('app://laki/assets/x.js?v=1#h', root), '/A/out/renderer/assets/x.js')
  for (const u of ['app://laki/', 'app://laki/assets/..%2f..%2fx', 'app://laki/a%5c..%5c..%5cx', 'app://laki/x%00.js', 'app://laki/%E0%A4%A', 'app://other/index.html', 'file:///etc/passwd', 'not a url'])
    assert.equal(appFile(u, root), undefined, u)
  // dot segments the URL parser resolves itself: still inside
  for (const u of ['app://laki/%2e%2e/%2e%2e/etc/passwd', 'app://laki/../../etc/passwd', 'app://laki/a/../../b'])
    assert.ok(appFile(u, root)?.startsWith(root), u)
})

test('main guards: localhost is this Mac’s, over http; userinfo, look-alikes and other schemes refused', () => {
  for (const u of ['http://localhost', 'http://localhost/', 'http://localhost:3000/x?y', 'http://127.0.0.1:8080'])
    assert.equal(local(u), true, u)
  for (const u of [
    'http://localhost@evil.example/',
    'http://localhost:80@evil.example/',
    'http://127.0.0.1.evil.example/',
    'http://localhost.evil.example/',
    'https://localhost/',
    'http://evil.example/?http://localhost/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://0.0.0.0/',
    'http://[::1]/',
    ' http://localhost/',
  ])
    assert.equal(local(u), false, u)
})

test('main guards: webviews by partition; open-external sites and laki: links only', () => {
  assert.equal(webviewOk(PREVIEW, 'http://localhost:3000/'), true)
  assert.equal(webviewOk(PREVIEW, 'https://example.com/'), false, 'the Preview starts on localhost')
  assert.equal(webviewOk(PREVIEW, 'http://localhost@evil.example/'), false)
  assert.equal(webviewOk(BROWSER, 'https://example.com/'), true)
  assert.equal(webviewOk(BROWSER, 'about:blank'), true)
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:srcdoc', 'chrome://gpu'])
    assert.equal(webviewOk(BROWSER, u), false, u)
  for (const p of [undefined, '', 'persist:other', 'agent-browser']) assert.equal(webviewOk(p, 'http://localhost/'), false, `partition ${p}`)
  assert.equal(externalOf('https://example.com/'), 'web')
  assert.equal(externalOf('http://user:pass@example.com/'), 'web', 'the browser shows where it goes')
  assert.equal(externalOf('laki://ws/x'), 'laki')
  for (const u of ['file:///Applications/Calculator.app', 'javascript:alert(1)', 'vscode://x', 'smb://host/share', 'HTTPS://example.com', 42, undefined])
    assert.equal(externalOf(u), undefined, String(u))
})

test('main guards: menu-popup takes a plain menu only', () => {
  const ok = [{ id: '1', label: 'Rename', sublabel: 'R' }, { separator: true }, { label: 'Color', sub: [{ id: '2', label: 'Red', checked: true }] }, { label: 'Head', enabled: false }]
  assert.deepEqual(menuModelOk(ok), ok)
  const deep = (n: number): unknown => (n ? [{ label: 'x', sub: deep(n - 1) }] : [{ id: '1', label: 'y' }])
  assert.ok(menuModelOk(deep(MENU_DEPTH - 1)))
  for (const [m, why] of [
    ['x', 'not a list'],
    [[{ label: 'a', click: 'rm -rf' }], 'a key of its own'],
    [[{ label: 'a', role: 'quit' }], 'a role'],
    [[{ id: '1' }], 'no label'],
    [[{ label: 7 }], 'a label not a string'],
    [[{ label: 'x'.repeat(201) }], 'a long label'],
    [[{ id: 'x'.repeat(41), label: 'a' }], 'a long id'],
    [[{ label: 'a', enabled: 'yes' }], 'enabled not a boolean'],
    [[{ separator: 1 }], 'a separator not true'],
    [[{ label: 'a', sub: 'b' }], 'a submenu not a list'],
    [[null], 'a null'],
    [[[{ label: 'a' }]], 'a list in a list'],
    [deep(MENU_DEPTH), 'too deep'],
    [Array.from({ length: MENU_ITEMS + 1 }, (_, i) => ({ id: String(i), label: 'a' })), 'too many'],
  ] as [unknown, string][])
    assert.equal(menuModelOk(m), undefined, why)
})

test('main guards: Handoff offers only a lasting https address, with no # secret or query', () => {
  assert.equal(handoffUrl({ url: 'https://calm-fox.trycloudflare.com/' }), undefined, 'a quick tunnel: none')
  assert.equal(handoffUrl({ url: 'https://mac.tail1234.ts.net/#t=secret&pin=1234', via: 'tailscale' }), 'https://mac.tail1234.ts.net/', 'the hash stripped')
  assert.equal(handoffUrl({ url: 'https://laki.example.com/app?token=x#y', host: 'laki' }), 'https://laki.example.com/app', 'My domain, its query stripped')
  assert.equal(handoffUrl({ url: 'http://mac.tail1234.ts.net/', via: 'tailscale' }), undefined, 'http refused')
  assert.equal(handoffUrl({ url: 'https://a:b@mac.tail1234.ts.net/', via: 'tailscale' }), undefined, 'no credentials')
  for (const r of [null, undefined, 'https://x/', { via: 'tailscale' }, { url: 'not a url', via: 'tailscale' }, { url: 'javascript:alert(1)', host: 'x' }]) assert.equal(handoffUrl(r), undefined)
})

test("Touch ID's confirm IPC: the app window's own page, for one of CONFIRM's actions only", () => {
  const win = { type: 'window', main: true, url: 'app://laki/index.html' }
  assert.equal(confirmAsk(win, true, 'remoteStart'), true)
  assert.equal(confirmAsk(win, true, 'touchIdOff'), true)
  assert.equal(confirmAsk(win, false, 'remoteStart'), false, 'another of the app\'s windows (new, ai, a floated tab)')
  assert.equal(confirmAsk({ ...win, url: 'app://laki/index.html?window=ai' }, false, 'remoteStart'), false)
  assert.equal(confirmAsk({ ...win, type: 'webview' }, true, 'remoteStart'), false, 'a webview')
  assert.equal(confirmAsk({ ...win, main: false }, true, 'remoteStart'), false, 'a frame inside')
  assert.equal(confirmAsk({ ...win, url: 'https://evil.example/' }, true, 'remoteStart'), false, 'a site')
  for (const w of ['wsRm', 'constructor', '', undefined, 42, { what: 'remoteStart' }]) assert.equal(confirmAsk(win, true, w), false, String(w))
})

test('10c: protectedKind keeps the floating windows out of screen recording: yes for a new install, Recording mode forces it, never the app', async () => {
  const { FLOAT_KINDS, protectedKind } = await import('../src/main/guards.ts')
  // a new install's settings have hideFloats: true (core.ts NEW_DEFAULTS); one from before has it unset
  const core = readFileSync(new URL('../src/daemon/core.ts', import.meta.url), 'utf8')
  assert.match(/const NEW_DEFAULTS = \{[^\n]*\}/.exec(core)![0], /hideFloats: true/)
  for (const k of FLOAT_KINDS) {
    assert.equal(protectedKind(k, { hideFloats: true }, false), true, `${k}: a new install`)
    assert.equal(protectedKind(k, {}, false), false, `${k}: an install from before`)
    assert.equal(protectedKind(k, { hideFloats: false }, true), true, `${k}: Recording mode, whatever the setting`)
  }
  assert.deepEqual([...FLOAT_KINDS].sort(), ['ask', 'bar', 'card', 'inbox', 'menu', 'quick', 'talk', 'voice'])
  for (const k of ['app', 'main', 'annotate', 'tab', 'new', '']) assert.equal(protectedKind(k, { hideFloats: true }, true), false, `${k || '(none)'}: never`)
  assert.equal(protectedKind('bar', { hideFloats: 'yes' } as never, false), false, 'only true')
})

test('C10: a file dragged out: inside its root (a workspace, a storage folder), never the root itself, / or home as one', () => {
  const home = '/Users/me'
  assert.equal(dragOk('/Users/me/app/src/a.ts', ['/Users/me/app'], home), true)
  assert.equal(dragOk('/Users/me/app/src/a.ts', ['/Users/me/app/'], home), true)
  assert.equal(dragOk('/Users/me/app', ['/Users/me/app'], home), false) // the root itself
  assert.equal(dragOk('/Users/me/app-old/a.ts', ['/Users/me/app'], home), false) // a sibling that starts the same
  assert.equal(dragOk('/Users/me/.ssh/id_rsa', ['/Users/me'], home), false) // home as a root
  assert.equal(dragOk('/etc/passwd', ['/'], home), false)
  assert.equal(dragOk('relative/a.ts', ['relative'], home), false)
  assert.equal(dragOk('/Users/me/app/a\0b', ['/Users/me/app'], home), false)
  assert.equal(dragOk('/Users/me/app/a.ts', [], home), false)
})

test('showAtLaunch: the window shows, but not when macOS opened Laki at login (a smoke run or a capture still shows it)', () => {
  assert.equal(showAtLaunch({ mac: true, atLogin: false }), true)
  assert.equal(showAtLaunch({ mac: true, atLogin: true }), false)
  assert.equal(showAtLaunch({ mac: true, atLogin: true, check: true }), true)
  assert.equal(showAtLaunch({ mac: false, atLogin: true }), true)
})

test("the Dock's menu: five agents at most, ids and names checked; New Task…, the agents, Quiet or End Quiet", () => {
  const list = [...Array(7)].map((_, i) => ({ ws: `w${i}`, tab: `t${i}`, name: `  agent\n${i} `.repeat(i === 6 ? 20 : 1) }))
  assert.deepEqual(dockAgents(list).map(a => a.tab), ['t0', 't1', 't2', 't3', 't4'])
  assert.equal(dockAgents(list)[0].name, 'agent 0')
  assert.deepEqual(dockAgents([{ ws: 'w', tab: 'x y', name: 'n' }, { ws: 'w', tab: 't', name: '' }, { ws: 1, tab: 't', name: 'n' }, null, 'x']), [])
  assert.deepEqual(dockAgents('nope'), [])
  assert.equal(dockAgents([{ ws: 'w', tab: 't', name: 'x'.repeat(200) }])[0].name.length, 60)
  assert.deepEqual(dockMenu([], false), [{ id: 'new', label: 'New Task…' }, { type: 'separator' }, { id: 'quiet', label: 'Quiet for an Hour' }])
  assert.deepEqual(dockMenu([{ ws: 'w', tab: 't', name: 'api' }], true), [{ id: 'new', label: 'New Task…' }, { type: 'separator' }, { id: 'tab:t', label: 'api — waiting' }, { type: 'separator' }, { id: 'quiet-off', label: 'End Quiet' }])
  for (const p of ['/Users/me/repo', '/a']) assert.ok(recentOk(p), p)
  for (const p of ['repo', '/', '', 3, '/x\0y', `/${'a'.repeat(1100)}`]) assert.ok(!recentOk(p), String(p))
})

test("a working bubble's turn: started and usual checked as main takes the list; the ring's share and words", async () => {
  const { floatTimes } = await import('../src/main/guards.ts')
  const { turnRing } = await import('../src/shared/island.ts')
  const now = 1_800_000_000_000
  assert.deepEqual(floatTimes({ started: now - 60_000, usual: 240_000 }, now), { started: now - 60_000, usual: 240_000 })
  for (const bad of [{ started: now - 1, usual: 500 }, { started: now + 120_000, usual: 60_000 }, { started: 'x', usual: 60_000 }, { started: now, usual: Infinity }, { started: now, usual: 2 * 86_400_000 }, null, { usual: 60_000 }]) assert.deepEqual(floatTimes(bad, now), {}, JSON.stringify(bad))
  assert.deepEqual(turnRing(now - 60_000, 240_000, now), { p: 0.25, long: false, words: 'about 3 min left' })
  assert.deepEqual(turnRing(now - 230_000, 240_000, now), { p: 230 / 240, long: false, words: 'almost done' })
  assert.deepEqual(turnRing(now - 500_000, 240_000, now), { p: 1, long: true, words: 'running long' }) // past 2 × usual and 5 min
  assert.equal(turnRing(now - 250_000, 100_000, now)?.long, false) // past 2 × usual, under 5 min: not yet
  assert.equal(turnRing(now, undefined, now), undefined) // no usual: no ring
})

test("dblClickAction: a title bar's double click as macOS's setting says (Minimize, None, else zoom)", async () => {
  const { dblClickAction } = await import('../src/main/guards.ts')
  assert.equal(dblClickAction('Minimize'), 'minimize')
  assert.equal(dblClickAction('None'), 'none')
  for (const v of ['Maximize', 'Fill', '', undefined, 42]) assert.equal(dblClickAction(v), 'zoom', String(v))
})

test("a window's title: control characters out, 120 at most, Laki when empty; Recording mode's private names as Laki", () => {
  assert.equal(titleOf('fix-login — web'), 'fix-login — web')
  assert.equal(titleOf('a\nb\tc\u0007d\u202eevil'), 'a b c d evil', 'control and direction characters out')
  assert.equal(titleOf('x'.repeat(300)).length, 120)
  assert.equal([...titleOf('🛒'.repeat(200))].length, 120, 'by character, an emoji whole')
  for (const empty of ['', '   ', undefined, null, '\n\t']) assert.equal(titleOf(empty), 'Laki')
  assert.equal(titleOf('launch-plan — stealth', ['launch-plan', 'stealth']), 'Laki — Laki')
  assert.equal(titleOf('launch-plan', ['launch-plan']), 'Laki')
  assert.equal(titleOf('shell — fix-login', ['', '  ']), 'shell — fix-login', 'a blank name hides nothing')
})

test("#G1 Go back's IPC: the app window's own page only, and main's handler checks it", () => {
  const win = { type: 'window', main: true, url: 'app://laki/index.html' }
  assert.equal(backAsk(win, true), true)
  assert.equal(backAsk(win, false), false, "another of the app's windows")
  assert.equal(backAsk({ ...win, type: 'webview' }, true), false, 'a webview')
  assert.equal(backAsk({ ...win, main: false }, true), false, 'a frame inside')
  assert.equal(backAsk({ ...win, url: 'https://evil.example/' }, true), false, 'a site')
  assert.equal(backAsk({ ...win, url: 'http://localhost:5199/' }, true), false, 'a dev origin, built')
  const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.match(main, /ipcMain\.handle\('update-back', async e => \(backAsk\(sender\(e\), !!win && e\.sender === win\.webContents, devOrigin\)/)
})
