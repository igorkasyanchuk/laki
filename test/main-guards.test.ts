// E3: Electron main's checks (src/main/guards.ts), on plain node: who may send IPC, which URLs get through
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appPage, BROWSER, externalOf, fromApp, local, pageIs, PREVIEW, webviewOk } from '../src/main/guards.ts'

test('main guards: only the app window’s main frame on the app’s own page is the app', () => {
  const page = 'file:///Applications/Laki.app/Contents/Resources/app/out/renderer/index.html'
  assert.equal(fromApp({ type: 'window', main: true, url: page }), true)
  assert.equal(fromApp({ type: 'window', main: true, url: `${page}?window=ai` }), true)
  for (const [s, why] of [
    [{ type: 'webview', main: true, url: page }, 'a webview'],
    [{ type: 'window', main: false, url: page }, 'a frame inside'],
    [{ type: 'window', main: true, url: 'https://evil.example/' }, 'a site'],
    [{ type: 'window', main: true, url: 'http://localhost:5199/' }, 'a dev origin, built'],
    [{ type: 'window', main: true }, 'no URL'],
    [{ type: 'browserView', main: true, url: page }, 'another kind'],
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
