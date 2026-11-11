// E3: Electron main's checks (src/main/guards.ts), on plain node: who may send IPC, which URLs get through
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appFile, appPage, BROWSER, externalOf, fromApp, fromTokenPage, local, pageIs, PREVIEW, tokenPage, webviewOk } from '../src/main/guards.ts'

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
