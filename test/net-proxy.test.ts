// The wrapper sandbox's network proxy (daemon/netProxy.ts) alone: a tab's CONNECT and plain http only to its list's
// hosts, by its own user:pass; another host refused (403, its card), a wrong password asked again (407); its port and
// passwords kept across a restart. No daemon: test:fast (presets.test.ts: a wrapped tab gets it as HTTPS_PROXY)
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer as httpServer } from 'node:http'
import { connect, createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hostOn, proxyDown, proxyDrop, proxyFor, proxyUp } from '../src/daemon/netProxy.ts'

// a raw request through the proxy: its status line and what came after. then: once tunneled, sent through it; done
// at its echo (then!), else as the proxy ends the connection
function ask(proxy: string, lines: string, then?: string) {
  return new Promise<{ status: string; rest: string }>((ok, fail) => {
    const s = connect(Number(new URL(proxy).port), '127.0.0.1', () => s.write(lines))
    let got = ''
    const done = () => (s.destroy(), ok({ status: got.split('\r\n')[0], rest: got.split('\r\n\r\n').slice(1).join('\r\n\r\n') }))
    s.on('data', d => {
      const was = got
      got += d
      if (then && got.startsWith('HTTP/1.1 200') && !was.includes('\r\n\r\n') && got.includes('\r\n\r\n')) s.write(then)
      if (then && got.includes(`${then}!`)) done()
    })
    s.on('end', done)
    s.on('error', fail)
  })
}
const auth = (proxy: string, user?: string, pw?: string) => {
  const u = new URL(proxy)
  return Buffer.from(`${user ?? u.username}:${pw ?? u.password}`).toString('base64')
}

test("hostOn: the name itself or a *. one's subdomain, any case", () => {
  const list = ['github.com', '*.npmjs.org', 'localhost']
  for (const h of ['github.com', 'GitHub.com.', 'registry.npmjs.org', 'a.b.npmjs.org', 'localhost']) assert.ok(hostOn(h, list), h)
  for (const h of ['api.github.com', 'npmjs.org', 'evilgithub.com', 'github.com.evil.example', '', '127.0.0.1']) assert.ok(!hostOn(h, list), h)
})

test("the proxy: a tab's listed hosts only, by its own password; a refused host is told; a restart keeps the port and passwords", async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-proxy-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const file = join(home, 'net-proxy.json')
  // the upstream: an echo on this Mac (listed as localhost), and a plain http one
  const echo = createServer(s => s.on('data', d => s.write(`${d}!`)))
  const web = httpServer((q, r) => r.end(`got ${q.url} ${q.headers['proxy-authorization'] ?? 'no auth'}`))
  await Promise.all([new Promise<void>(r => echo.listen(0, '127.0.0.1', r)), new Promise<void>(r => web.listen(0, '127.0.0.1', r))])
  t.after(() => (echo.close(), web.close()))
  const port = (echo.address() as AddressInfo).port
  const webPort = (web.address() as AddressInfo).port
  const refused: string[] = []
  const lists: Record<string, string[]> = { tab1: ['localhost', 'github.com'], tab2: ['localhost'] }
  const hooks = { list: (tab: string) => lists[tab], refused: (tab: string, host: string) => void refused.push(`${tab} ${host}`) }
  await proxyUp(file, hooks)
  t.after(proxyDown)
  const one = proxyFor('tab1')
  const two = proxyFor('tab2')
  assert.match(one, /^http:\/\/tab1:[0-9a-f]{36}@127\.0\.0\.1:\d+$/)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const CONNECT = (target: string, a?: string) => `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${a ? `Proxy-Authorization: Basic ${a}\r\n` : ''}\r\n`
  // listed: tunneled to it
  let r = await ask(one, CONNECT(`localhost:${port}`, auth(one)), 'hi')
  assert.equal(r.status, 'HTTP/1.1 200 Connection Established')
  assert.equal(r.rest, 'hi!')
  // not listed: 403, and its card
  r = await ask(one, CONNECT('evil.example:443', auth(one)))
  assert.match(r.status, /^HTTP\/1\.1 403/)
  assert.deepEqual(refused, ['tab1 evil.example'])
  // no password, a wrong one, another tab's: 407
  for (const a of [undefined, auth(one, 'tab1', 'f'.repeat(36)), auth(one, 'tab2'), auth(two, 'tab1'), Buffer.from('nonsense').toString('base64')]) assert.match((await ask(one, CONNECT(`localhost:${port}`, a))).status, /^HTTP\/1\.1 407/, String(a))
  // plain http: listed fetched (its Proxy-Authorization not passed on), else 403
  r = await ask(one, `GET http://localhost:${webPort}/x HTTP/1.1\r\nHost: localhost:${webPort}\r\nProxy-Authorization: Basic ${auth(one)}\r\nConnection: close\r\n\r\n`)
  assert.match(r.status, /^HTTP\/1\.1 200/)
  assert.match(r.rest, /got \/x no auth/)
  assert.match((await ask(one, `GET http://evil.example/ HTTP/1.1\r\nHost: evil.example\r\nProxy-Authorization: Basic ${auth(one)}\r\n\r\n`)).status, /^HTTP\/1\.1 403/)
  // a tab no longer on a list (closed, or its profile changed): refused though its password was right
  delete lists.tab2
  assert.match((await ask(two, CONNECT(`localhost:${port}`, auth(two)))).status, /^HTTP\/1\.1 407/)
  // a restart: the same port, tab1's password still good; a dropped tab's gone
  await proxyDown()
  await proxyUp(file, hooks)
  assert.equal((await ask(one, CONNECT(`localhost:${port}`, auth(one)), 'again')).rest, 'again!')
  proxyDrop('tab1')
  assert.match((await ask(one, CONNECT(`localhost:${port}`, auth(one)))).status, /^HTTP\/1\.1 407/)
})
