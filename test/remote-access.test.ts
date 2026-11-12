// remote access that stays: My domain's stable address (D1), started again when its tunnel ends or the daemon
// restarts (D2). remote.ts; api.test.ts has the rest of remote access
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import { connect, fresh, until, tokenOf, farFetch, FarWs } from './helpers.ts'

const kids = (data: string) => (f => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { pid: number }[]) : []))(join(data, 'children.json'))
const saved = (data: string) => JSON.parse(readFileSync(join(data, 'state.json'), 'utf8')).remote

// cloudflared (the fake), signed in, with its named tunnel laki on example.dev
async function named(rig: Awaited<ReturnType<typeof fresh>>) {
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const cfHome = join(rig.home, '.cloudflared')
  mkdirSync(cfHome, { recursive: true })
  writeFileSync(join(cfHome, 'cert.pem'), 'a certificate')
  writeFileSync(join(cfHome, '6f1e0c1a-0000-4000-8000-000000000001.json'), '{}')
  await rig.rpc('settingsSet', { tunnel: { name: 'laki', domain: 'example.dev' } })
}
const pinAt = (port: number, origin: string, body: object) => fetch(`http://127.0.0.1:${port}/pin`, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }).then(r => r.json())
const ping = (port: number, token: string, origin?: string) => farFetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(origin && { origin }) }, body: '{"method":"ping"}' }).then(r => r.status)

test('D1: My domain, a stable address on your named tunnel: the same origin each start, a PIN always, the connector shared; refusals', async t => {
  const rig = await fresh(t)
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  const ingress = () => readFileSync(join(rig.data, 'cloudflared/ingress.yml'), 'utf8')
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, host: '' }), /My domain: set your named tunnel and its domain in Settings › Tunnels first/)
  await named(rig)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, via: 'tailscale', host: 'x' }), /My domain is through cloudflare/)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, host: 'a.b' }), /one word: letters, digits and dashes/)
  const { port } = rig.info()

  const on = await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev', host: '' }) // laki.<domain>; an email gives way to the PIN
  const url = 'https://laki.example.dev'
  assert.deepEqual([on.url, on.host, on.mail], [url, 'laki.example.dev', ''])
  assert.match(on.pin, /^\d{6}$/)
  assert.match(on.link, new RegExp(`^${url}/#t=[0-9a-f]{64}&k=[\\w-]{43}$`))
  assert.match(log(), /cloudflared tunnel route dns laki laki\.example\.dev\n/)
  assert.match(ingress(), new RegExp(`- hostname: laki\\.example\\.dev\\n {4}service: http://127\\.0\\.0\\.1:${port}\\n`))
  // its page: the PIN, then it's paired (D3: a cookie of its own), from that origin only
  const key = tokenOf(on.link)
  assert.deepEqual(await pinAt(port, url, { token: key }), { need: true, left: 2 })
  const jar = (await pinRaw(port, url, { token: key, pin: on.pin })).cookie!.split(';')[0]
  assert.equal(await rpcAt(port, url, jar), 200)
  assert.equal(await rpcAt(port, 'https://evil.example', jar), 403)
  assert.equal(await rpcAt(port, 'https://other.example.dev', jar), 403)
  const c = devSock(port, url, jar)
  await c.open
  assert.equal(await c.call('ping'), 'pong')
  c.ws.close()
  // its name is taken for Expose meanwhile
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'perm' })
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 3000, host: 'laki' }), /laki\.example\.dev is taken: remote access's/)
  // a permanent tunnel beside it: one connector with both
  await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, host: 'shop' })
  assert.match(ingress(), /shop\.example\.dev[^]*laki\.example\.dev/)
  assert.equal((await rig.rpc('state')).remote.url, url)
  await rig.rpc('tunnelStop', { ws: ws.id, port: 3000 })

  // stopped: the connector with it (nothing else on it), its origin refused; started again: the same address (a bookmark works), a new link
  await rig.rpc('remoteStop')
  await until(() => spawnSync('pgrep', ['-f', join(rig.data, 'cloudflared/ingress.yml')]).status !== 0, 'none left on the connector: it stops')
  assert.equal(await rpcAt(port, url, jar), 403)
  const again = await rig.rpc('remoteStart', { hours: 2, host: 'laki' })
  assert.equal(again.url, url)
  assert.notEqual(again.link, on.link)
  tokenOf(again.link) // S14: a new secret with the new start (a paired page's own key works too: D2, D3's test)
  assert.equal(await rpcAt(port, url, jar), 200) // the same device, paired still: a bookmark works
  assert.equal(await ping(port, 'f'.repeat(64), url), 401)
  assert.equal(await rpcAt(port, 'https://fake.trycloudflare.com', jar), 403)
  await rig.rpc('remoteStop')
})

test('D2: remote access started again when cloudflared ends (a quick one: a new address and link, said) and after a daemon restart (its until kept); a stop is final', async t => {
  const rig = await fresh(t)
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const remote = async () => (await rig.rpc('stateOwn')).remote
  const on = await rig.rpc('remoteStart', { hours: 2, mail: 'me@x.dev' })
  const { port } = rig.info()
  assert.equal(on.url, `https://fake-${port}.trycloudflare.com`)
  assert.deepEqual(saved(rig.data), { mail: 'me@x.dev', until: on.until, url: on.url }) // no token, no PIN
  const app = await connect(rig)

  // killed: down a moment, then back at a new address with a new link, its time as it was
  await until(() => kids(rig.data).length === 1, 'its cloudflared noted')
  writeFileSync(join(rig.home, 'cf-gen'), '-2')
  process.kill(kids(rig.data)[0].pid, 'SIGTERM')
  await until(async () => (await remote())?.url === `https://fake-${port}-2.trycloudflare.com`, 'back at a new address')
  const back = await remote()
  assert.deepEqual([back.was, back.until, back.mail, back.down], [on.url, on.until, 'me@x.dev', undefined])
  assert.notEqual(back.link, on.link)
  assert.match(rig.out, /remote access: cloudflared ended \(exit 0\); starting it again|remote access: cloudflared ended/)
  assert.match((await until(async () => app.events.find(e => e.ev === 'remote'), 'the app told')).text, /back at a new address/)
  app.close()
  assert.equal(saved(rig.data).url, back.url)

  // a daemon restart: back, with the same until
  await rig.stop()
  writeFileSync(join(rig.home, 'cf-gen'), '-3')
  await rig.start()
  const p2 = rig.info().port
  await until(async () => (await remote())?.url === `https://fake-${p2}-3.trycloudflare.com`, 'back after the restart')
  assert.equal((await remote()).until, on.until)
  assert.match(log(), new RegExp(`--url http://127\\.0\\.0\\.1:${p2} --allowed-mail=me@x\\.dev\n`))

  // past its time: not back after a restart
  await rig.stop()
  const s = saved(rig.data)
  writeFileSync(join(rig.data, 'state.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8')), remote: { ...s, until: Date.now() - 1000 } }))
  await rig.start()
  await new Promise(r => setTimeout(r, 1500))
  assert.equal(await remote(), undefined)
  assert.equal(saved(rig.data), undefined)

  // stopped by you: final, not back after a restart
  await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev' })
  await rig.rpc('remoteStop')
  assert.equal(saved(rig.data), undefined)
  await rig.stop()
  await rig.start()
  await new Promise(r => setTimeout(r, 1500))
  assert.equal(await remote(), undefined)
})

// /pin as the page sends it: its JSON and the cookie the daemon sets (a paired device's)
async function pinRaw(port: number, origin: string, body: object, headers: Record<string, string> = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/pin`, { method: 'POST', headers: { origin, ...headers }, body: JSON.stringify(body) })
  return { json: await r.json(), cookie: r.headers.get('set-cookie') ?? undefined }
}
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }
// a paired device's socket: its cookie, its origin, any word as its auth; closed: its code
function devSock(port: number, origin: string, cookie: string, secret?: Buffer) {
  const ws = new FarWs(port, origin, { cookie }, 'device', secret)
  const shut = new Promise<number>(r => ws.once('close', code => r(code)))
  const open = new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)))
  let seq = 0
  const call = (method: string, params: object = {}) =>
    new Promise<any>((res, rej) => {
      const id = ++seq
      ws.on('message', raw => (m => m.id === id && (m.error ? rej(new Error(m.error)) : res(m.result)))(JSON.parse(String(raw))))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, shut, open, call }
}
// S14: a paired device's own key, as its page's first sealed socket gets it (the link's secret seals that one)
async function keyOfDevice(port: number, origin: string, cookie: string) {
  const d = devSock(port, origin, cookie)
  const given = new Promise<string>(r => d.ws.on('message', raw => (m => m.ev === 'e2e-device' && r(m.key))(JSON.parse(String(raw)))))
  await d.open
  const k = Buffer.from(await given, 'base64')
  d.ws.close()
  return k
}
const rpcAt = (port: number, origin: string | undefined, cookie?: string) => farFetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: 'Bearer device', ...(origin && { origin }), ...(cookie && { cookie }) }, body: '{"method":"ping"}' }).then(r => r.status)

test('D2, D3: a stable address (My domain) comes back as it was after a restart: the paired page gets in again by its cookie', async t => {
  const rig = await fresh(t)
  await named(rig)
  const url = 'https://laki.example.dev'
  const on = await rig.rpc('remoteStart', { hours: 4, host: '' })
  const { json, cookie } = await pinRaw(rig.info().port, url, { token: tokenOf(on.link), pin: on.pin }, UA)
  assert.deepEqual(json, { need: false, device: true })
  const jar = cookie!.split(';')[0]
  // S14: its first sealed socket (with the link's secret) gets the device's own key; at rest only wrapped
  const pre = devSock(rig.info().port, url, jar)
  const given = new Promise<string>(r => pre.ws.on('message', raw => (m => m.ev === 'e2e-device' && r(m.key))(JSON.parse(String(raw)))))
  await pre.open
  const devKey = await given
  pre.ws.close()
  assert.equal(Buffer.from(devKey, 'base64').length, 32)
  assert.ok(!readFileSync(join(rig.data, 'state.json'), 'utf8').includes(devKey), 'kept wrapped')
  await rig.stop()
  await rig.start()
  const { port } = rig.info()
  await until(async () => (r => r?.url === url && !r.down)((await rig.rpc('stateOwn')).remote), 'back at its address')
  const mine = devSock(port, url, jar, Buffer.from(devKey, 'base64')) // S14: no link this time: the device's own key
  await mine.open
  assert.equal(await mine.call('ping'), 'pong')
  mine.ws.close()
  const stranger = devSock(port, url, jar, Buffer.alloc(32, 7))
  assert.equal(await stranger.shut, 4401, 'another key')
  const r = (await rig.rpc('stateOwn')).remote
  assert.deepEqual([r.until, r.was], [on.until, undefined])
  assert.equal(await rpcAt(port, url, jar), 200) // the same page, reconnected
  const d = devSock(port, url, jar)
  await d.open
  assert.equal(await d.call('ping'), 'pong')
  d.ws.close()
  assert.equal(await rpcAt(port, url, '__Host-laki-device=' + 'f'.repeat(64)), 401) // another cookie isn't
})

test('D3: trusted devices at a stable address: paired by the link (and PIN), a cookie of its own, reconnects, a second one, revoked at once, expired, forgotten', async t => {
  const rig = await fresh(t)
  await named(rig)
  const url = 'https://laki.example.dev'
  const app = await connect(rig)
  const on = await rig.rpc('remoteStart', { hours: 0, host: 'laki' })
  const { port } = rig.info()
  // paired: an HttpOnly, Secure, SameSite=Strict cookie on its origin; its token only there, the daemon keeps its hash
  const first = await pinRaw(port, url, { token: tokenOf(on.link), pin: on.pin }, UA)
  assert.deepEqual(first.json, { need: false, device: true })
  assert.match(first.cookie!, /^__Host-laki-device=[0-9a-f]{64}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Strict$/)
  const jar = first.cookie!.split(';')[0]
  const token = jar.split('=')[1]
  assert.ok(Math.abs(Number(/Max-Age=(\d+)/.exec(first.cookie!)![1]) - 30 * 86400) < 10) // 30 days by default
  const devices = async () => (await rig.rpc('state')).remoteDevices
  const [dev] = await devices()
  assert.deepEqual([dev.name, dev.hash, Object.keys(dev).sort()], ['iPhone · Safari', undefined, ['addedAt', 'id', 'name', 'seenAt', 'until']])
  const disk = readFileSync(join(rig.data, 'state.json'), 'utf8')
  assert.ok(!disk.includes(token) && !rig.out.includes(token), 'never its token, only its hash')
  assert.match((await until(async () => app.events.find(e => e.ev === 'remote' && /new device/.test(e.text)), 'the Mac told')).text, /A new device joined remote access: iPhone · Safari/)
  // the link is used: nothing more from it; the cookie alone gets the page in (a closed tab, a new one)
  assert.deepEqual((await pinRaw(port, url, { token: tokenOf(on.link), pin: on.pin })).json, { need: false })
  assert.deepEqual((await pinRaw(port, url, {}, { cookie: jar })).json, { need: false, device: true })
  assert.equal(await rpcAt(port, url, jar), 200)
  assert.equal(await rpcAt(port, 'https://evil.example', jar), 403) // CSRF: its origin only
  assert.equal(await rpcAt(port, undefined, jar), 401) // no Origin: not its page
  const a = devSock(port, url, jar)
  await a.open
  assert.equal(await a.call('ping'), 'pong')
  // not from the phone, nor an agent: pairing or revoking
  const far = (method: string, params = {}) => farFetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: 'Bearer device', origin: url, cookie: jar }, body: JSON.stringify({ method, params }) }).then(r => r.json())
  for (const m of ['remotePair', 'remoteDeviceRm']) assert.match((await far(m, { all: true })).error ?? '', /not over remote access/, m)

  // a second device: Add a device's link (10 minutes, once), its own cookie; both in at once
  const more = await rig.rpc('remotePair')
  assert.notEqual(more.link, on.link)
  assert.ok(more.pairUntil > Date.now() + 9 * 60e3 && more.pairUntil <= Date.now() + 10 * 60e3)
  const second = await pinRaw(port, url, { token: tokenOf(more.link), pin: more.pin }, { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' })
  const jar2 = second.cookie!.split(';')[0]
  assert.notEqual(jar2, jar)
  assert.deepEqual((await devices()).map((d: any) => d.name), ['iPhone · Safari', 'Mac · Chrome'])
  const b = devSock(port, url, jar2)
  await b.open
  assert.equal(await b.call('ping'), 'pong')

  // revoked: its socket closed at once, its cookie refused; the other stays
  await rig.rpc('remoteDeviceRm', { id: dev.id })
  assert.equal(await a.shut, 4401)
  assert.equal(await rpcAt(port, url, jar), 401)
  assert.equal(await b.call('ping'), 'pong')
  await assert.rejects(rig.rpc('remoteDeviceRm', { id: dev.id }), /no device/)

  // past its time: off the list, its socket closed, refused
  await rig.rpc('remoteTick', { now: Date.now() + 31 * 86400e3 })
  assert.equal(await b.shut, 4401)
  assert.equal(await devices(), undefined)
  assert.equal(await rpcAt(port, url, jar2), 401)

  // a stop keeps the devices, but nothing connects; Forget devices clears them
  await rig.rpc('settingsSet', { remoteDeviceDays: 1 })
  const p3 = await rig.rpc('remotePair')
  const third = await pinRaw(port, url, { token: tokenOf(p3.link), pin: p3.pin })
  assert.ok(Math.abs(Number(/Max-Age=(\d+)/.exec(third.cookie!)![1]) - 86400) < 10)
  const jar3 = third.cookie!.split(';')[0]
  await rig.rpc('remoteStop')
  assert.equal((await devices()).length, 1)
  assert.equal(await rpcAt(port, url, jar3), 403)
  await rig.rpc('remoteDeviceRm', { all: true })
  assert.equal(await devices(), undefined)
  // a quick tunnel: no devices, the one tab's token as before
  await assert.rejects(rig.rpc('remotePair'), /isn't running/)
  const quick = await rig.rpc('remoteStart', { hours: 1, pin: true })
  await assert.rejects(rig.rpc('remotePair'), /devices need a stable address/)
  const q = await pinRaw(port, quick.url, { token: tokenOf(quick.link), pin: quick.pin })
  assert.equal(q.cookie, undefined)
  assert.match(q.json.token, /^[0-9a-f]{64}$/)
  app.close()
})

test('D5: wrong PINs wait 1, 5, then 30 minutes instead of stopping; a right one during the wait is refused, after it taken; 20 in a day stop it; paired devices stay in', async t => {
  const rig = await fresh(t)
  await named(rig)
  const url = 'https://laki.example.dev'
  const app = await connect(rig)
  const on = await rig.rpc('remoteStart', { hours: 0, host: '' })
  const { port } = rig.info()
  const paired = (await pinRaw(port, url, { token: tokenOf(on.link), pin: on.pin })).cookie!.split(';')[0]
  const link = await rig.rpc('remotePair')
  const key = tokenOf(link.link)
  const wrongOf = (pin: string) => (pin === '000000' ? '111111' : '000000')
  const ip = { 'cf-connecting-ip': '203.0.113.9' }
  const view = async () => (await rig.rpc('stateOwn')).remote
  // 2 wrong (the default): no PIN for a minute; told on the Mac with the address the tunnel gives
  assert.deepEqual((await pinRaw(port, url, { token: key, pin: wrongOf(link.pin) }, ip)).json, { error: 'Wrong PIN: 1 more try, then no PIN is taken for 1 minute' })
  assert.deepEqual((await pinRaw(port, url, { token: key, pin: wrongOf(link.pin) }, ip)).json, { error: 'Wrong PIN: no PIN is taken for 1 minute, then try again' })
  const told = await until(async () => (e => (e.length >= 2 ? e : undefined))(app.events.filter(e => e.ev === 'remote' && /wrong PIN|takes no PIN/.test(e.text))), 'each told')
  assert.match(told![0].text, /A wrong PIN was typed on remote access's page from 203\.0\.113\.9 at \d/)
  assert.match(told!.at(-1).text, /takes no PIN for 1 minute: 2 wrong PINs on its page from 203\.0\.113\.9/)
  const v = await view()
  assert.ok(v.locked > Date.now() + 50e3 && v.locked <= Date.now() + 60e3, 'locked a minute')
  assert.equal(v.wrong, 2)
  // the right PIN while it waits: refused; the page is told how long
  assert.deepEqual((await pinRaw(port, url, { token: key, pin: link.pin })).json, { error: 'Too many wrong PINs: try again in 1 minute' })
  assert.equal((await pinRaw(port, url, { token: key })).json.wait, v.locked)
  // a paired device isn't affected
  assert.deepEqual((await pinRaw(port, url, {}, { cookie: paired })).json, { need: false, device: true })
  assert.equal(await rpcAt(port, url, paired), 200)
  // the minute passes (the test clock): the right PIN is taken
  await rig.rpc('remoteTick', { now: v.locked + 1 })
  assert.equal((await view()).locked, undefined)
  assert.deepEqual((await pinRaw(port, url, { token: key, pin: link.pin })).json, { need: false, device: true })
  assert.ok(await view(), 'still running: wrong PINs never stopped it')

  // the waits grow, 1, 5, 30, 30 minutes, and 20 wrong in a day stop it
  await rig.rpc('settingsSet', { remoteTries: 3 })
  const l2 = await rig.rpc('remotePair')
  const k2 = tokenOf(l2.link)
  const w2 = wrongOf(l2.pin)
  const waits: string[] = []
  let last = ''
  for (let n = 3; n <= 20; n++) { // 2 wrong already today
    last = (await pinRaw(port, url, { token: k2, pin: w2 })).json.error
    const m = /no PIN is taken for (\d+ minutes?), then try again/.exec(last)
    if (m) waits.push(m[1]), await rig.rpc('remoteTick', { now: (await view()).locked + 1 })
  }
  assert.deepEqual(waits, ['5 minutes', '30 minutes', '30 minutes', '30 minutes', '30 minutes'])
  assert.equal(last, 'Too many wrong PINs today: remote access stopped. Start it again on your Mac.')
  assert.equal(await view(), undefined)
  assert.match((await until(async () => app.events.find(e => e.ev === 'remote' && /20 wrong PINs today/.test(e.text)), 'told')).text, /Remote access stopped: 20 wrong PINs today on its page/)
  app.close()
})

test('M4: at a stable address the page is an app: its manifest and service worker; a paired device turns on Web Push (its subscription kept, never in the view), taps refused unsigned', async t => {
  const rig = await fresh(t)
  await named(rig)
  const url = 'https://laki.example.dev'
  const page = rig.env.LAKI_PAGE
  mkdirSync(join(page, 'assets'), { recursive: true })
  writeFileSync(join(page, 'index.html'), '<title>Laki</title>')
  const on = await rig.rpc('remoteStart', { hours: 1, host: '' })
  const { port } = rig.info()
  const at = `http://127.0.0.1:${port}`
  const m = await fetch(`${at}/manifest.webmanifest`)
  assert.equal(m.headers.get('content-type'), 'application/manifest+json')
  const man = await m.json()
  assert.deepEqual([man.name, man.display, man.start_url, man.background_color, man.icons.length], ['Laki', 'standalone', '/', '#171412', 2])
  const sw = await fetch(`${at}/sw.js`)
  assert.equal(sw.headers.get('content-type'), 'text/javascript; charset=utf-8')
  const js = await sw.text()
  assert.doesNotThrow(() => new Function(js), 'it parses')
  assert.match(js, /Offline: your Mac is not reachable/)
  assert.match(js, /fetch\('\/tap'/)
  assert.ok(!/\/rpc|\/pin|token/.test(js.replace(/OFFLINE = .*/, '')), 'it caches no API and holds no token')
  // a paired device: the key to subscribe with, its subscription (a browser vendor's service only)
  const { cookie } = await pinRaw(port, url, { token: tokenOf(on.link), pin: on.pin }, UA)
  const jar = cookie!.split(';')[0]
  const push = (body: object, c = jar) => fetch(`${at}/push`, { method: 'POST', headers: { origin: url, cookie: c }, body: JSON.stringify(body) }).then(async r => [r.status, await r.json()])
  const [code, { key }] = await push({})
  assert.equal(code, 200)
  assert.match(key, /^[\w-]{87}$/)
  assert.equal((statSync(join(rig.data, 'vapid.json')).mode & 0o777).toString(8), '600')
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) }
  assert.equal((await push({ sub: { ...sub, endpoint: 'https://127.0.0.1:9/x' } }))[0], 400)
  assert.equal((await push({ sub }, '__Host-laki-device=' + 'f'.repeat(64)))[0], 401)
  assert.deepEqual(await push({ sub }), [200, { ok: true }])
  const [dev] = (await rig.rpc('state')).remoteDevices
  assert.deepEqual([dev.notify, dev.push], [true, undefined], 'the view says it takes them, never its keys')
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8')).remoteDevices[0].push.endpoint, sub.endpoint)
  const tap = (body: string) => fetch(`${at}/tap`, { method: 'POST', headers: { origin: url, cookie: jar }, body }).then(r => r.status)
  assert.equal(await tap('0123456789abcdef:1:0123456789abcdef'), 400, 'a signature this Mac never made')
  assert.deepEqual(await push({ off: true }), [200, { ok: true }])
  assert.equal((await rig.rpc('state')).remoteDevices[0].notify, undefined)
})

test('D8: a self-check of its address at start, every 5 minutes (test clock) and on Check; two failures in a row: the why in the view, the app told, its tunnel started again; caffeinate held with no agent, on power unless always', async t => {
  let status = 200 // its public address's stand-in: a local server (LAKI_CHECK_URL: the rig never reaches the internet)
  const srv = createServer((_q, r) => (r.writeHead(status), r.end())).listen(0, '127.0.0.1')
  await new Promise(r => srv.once('listening', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_CHECK_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, LAKI_CHECK_MS: '1500' } })
  const pm = join(rig.home, 'bin/pmset') // the Mac's power: AC unless $HOME/power says otherwise
  writeFileSync(pm, `#!/bin/sh\ncat "$HOME/power" 2>/dev/null || echo "Now drawing from 'AC Power'"\n`)
  chmodSync(pm, 0o755)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const caf = () => (existsSync(rig.env.FAKE_LOG) ? readFileSync(rig.env.FAKE_LOG, 'utf8') : '').split('\n').filter(l => l.startsWith('caffeinate'))
  const remote = async () => (await rig.rpc('stateOwn')).remote
  const on = await rig.rpc('remoteStart', { hours: 2, mail: 'me@x.dev' })
  const { port } = rig.info()
  const first = await until(async () => (await remote())?.check, 'checked as it started')
  assert.deepEqual([first.ok, first.what, typeof first.ms], [true, 'its public address', 'number'])
  await until(() => caf().length === 1, 'caffeinate held for remote access: no agent works')
  assert.match(caf()[0], /^caffeinate -i -w \d+$/)
  // on battery: let go, unless Always
  writeFileSync(join(rig.home, 'power'), "Now drawing from 'Battery Power'\n")
  await rig.rpc('remoteTick', { now: Date.now() })
  await until(() => caf().at(-1) === 'caffeinate stopped', 'let go on battery')
  await rig.rpc('settingsSet', { remoteAwake: 'always' })
  await until(() => caf().filter(l => l.startsWith('caffeinate -i')).length === 2, 'held again: Always')
  // failing: once is said in the view only; twice, the app is told and its tunnel starts again
  status = 502
  const app = await connect(rig)
  t.after(() => app.close())
  const t0 = Date.now()
  await rig.rpc('remoteTick', { now: t0 + 6 * 60_000 })
  const bad = await until(async () => (c => c?.ok === false && c)((await remote()).check), 'the first failure')
  assert.equal(bad.why, 'it answered 502')
  assert.ok(!app.events.some(e => e.ev === 'remote'), 'one failure: not told yet')
  writeFileSync(join(rig.home, 'cf-gen'), '-2')
  await rig.rpc('remoteTick', { now: t0 + 12 * 60_000 })
  assert.match((await until(async () => app.events.find(e => e.ev === 'remote'), 'the app told')).text, /isn't reachable \(it answered 502\): starting its tunnel again/)
  status = 200
  await until(async () => (await remote())?.url === `https://fake-${port}-2.trycloudflare.com`, 'its tunnel started again')
  assert.match(rig.out, /remote access: not reachable: it answered 502; starting its tunnel again/)
  assert.equal((await rig.rpc('remoteCheck')).ok, true, 'Check: reachable again')
  assert.equal((await remote()).check.ok, true)
  assert.equal(on.mail, 'me@x.dev')
  await rig.rpc('remoteStop')
  await until(() => caf().at(-1) === 'caffeinate stopped', 'let go as it stops')
})

test('D9: remote access while the Mac is locked: started by the lock (My domain, a paired device), refused a minute after the unlock (test clock), the device kept; its activity log has a remote send and answer with the device, not a read, and the session', async t => {
  const rig = await fresh(t)
  await named(rig)
  const url = 'https://laki.example.dev'
  const remote = async () => (await rig.rpc('stateOwn')).remote
  // a device paired once, by hand
  const first = await rig.rpc('remoteStart', { hours: 1, host: '' })
  const jar = (await pinRaw(rig.info().port, url, { token: tokenOf(first.link), pin: first.pin }, UA)).cookie!.split(';')[0]
  const devKey = await keyOfDevice(rig.info().port, url, jar) // S14: its page's first socket gets its own key: the lock's start has a new link
  await rig.rpc('remoteStop')
  await rig.rpc('screenLock', { locked: true })
  assert.equal(await remote(), undefined, 'not asked for: a lock starts nothing')
  await rig.rpc('screenLock', { locked: false })
  await rig.rpc('settingsSet', { remoteAuth: 'domain', remoteWhen: 'locked' })
  await rig.rpc('screenLock', { locked: true })
  await until(async () => (await remote())?.url === url, 'started by the lock')
  const { port } = rig.info()
  const dev = devSock(port, url, jar, devKey)
  await dev.open
  t.after(() => dev.ws.close())
  // from the phone: a read, a message, an answer
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'phone' })
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => /> $/m.test(await rig.rpc('screen', { target: tab.id })), 'the fake claude up')
  await dev.call('state')
  await dev.call('send', { target: tab.id, text: 'menu' })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)?.ask, 'its ask')
  await dev.call('answer', { tab: tab.id, n: 1 })
  const log = async () => (await rig.rpc('remoteLog')) as { at: number; device?: string; method?: string; line: string }[]
  const mine = (await log()).filter(e => e.method)
  assert.deepEqual(mine.map(e => e.method).reverse(), ['send', 'answer'], 'a read is not in it')
  assert.ok(mine.every(e => e.device && e.device !== 'the link’s page'), 'each with its device')
  assert.match(mine[1].line, /^to phone · claude: "menu"$/)
  assert.match(mine[0].line, /^answered phone · claude: /)
  assert.match((await log()).map(e => e.line).join('\n'), /started: My domain \(laki\.example\.dev\), as the Mac locked/)
  assert.equal(statSync(join(rig.data, 'remote-log.jsonl')).mode & 0o777, 0o600)
  // unlocked: a minute's grace, then it stops; the device stays paired
  const t0 = Date.now()
  await rig.rpc('screenLock', { locked: false })
  await rig.rpc('remoteTick', { now: t0 + 30_000 })
  assert.equal((await remote())?.url, url, 'within the grace')
  await rig.rpc('remoteTick', { now: t0 + 61_000 })
  await until(async () => !(await remote()), 'stopped after the grace')
  assert.notEqual(await rpcAt(port, url, jar), 200, 'refused now')
  assert.equal((await rig.rpc('stateOwn')).remoteDevices?.length, 1, 'still paired')
  const lines = (await log()).map(e => e.line)
  assert.deepEqual(lines.slice(0, 2), ['stopped: you came back to the Mac', 'the Mac unlocked: remote access stops in a minute'])
  // the CLI prints it
  assert.match((await rig.cli('remote', 'log')).out, /stopped: you came back to the Mac/)
})
