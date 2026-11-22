// The daemon's API, remote access and tunnels: the remote page, its token, origin and Host, paired devices' levels,
// its app manifest and outbox, Touch ID's tickets, cloudflared's tunnels, refused WebSockets (split from api.test.ts)
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import { REMOTE_NO, REMOTE_OK } from '../src/daemon/gates.ts'
import { connect, farKey, fresh, until, tokenOf, farFetch } from './helpers.ts'
import { channel, keyOf, PAGE } from '../src/daemon/e2e.ts'

test('a tunnel a killed daemon left running is stopped as the next daemon starts (L14)', async t => {
  const rig = await fresh(t)
  const log = () => (existsSync(rig.env.FAKE_LOG) ? readFileSync(rig.env.FAKE_LOG, 'utf8') : '')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const { port, pid } = rig.info()
  await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev' })
  const kids = join(rig.data, 'children.json')
  await until(() => existsSync(kids) && JSON.parse(readFileSync(kids, 'utf8')).length === 1, 'its cloudflared noted')
  const cf = JSON.parse(readFileSync(kids, 'utf8'))[0].pid
  process.kill(pid, 'SIGKILL') // no shutdown: cloudflared lives on
  await until(() => { try { process.kill(pid, 0); return false } catch { return true } }, 'the daemon gone')
  process.kill(cf, 0) // still there
  assert.doesNotMatch(log(), new RegExp(`cloudflared ${port} stopped`))
  await rig.start()
  await until(() => log().includes(`cloudflared ${port} stopped`), 'the old cloudflared stopped')
  // D2: remote access then starts again (a cloudflared of its own): the old one's gone from the list
  await until(() => !existsSync(kids) || !JSON.parse(readFileSync(kids, 'utf8')).some((k: { pid: number }) => k.pid === cf), 'the old one off the list')
})

test('refused WebSockets: the first logged, the rest counted, not a line each (L15)', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  for (let i = 0; i < 100; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=nope`)
    await new Promise(r => (ws.once('error', r), ws.once('open', r)))
  }
  await rig.rpc('ping')
  const lines = rig.out.split('\n').filter(l => l.includes('refused websocket'))
  assert.ok(lines.length >= 1 && lines.length <= 2, lines.join('\n'))
})

test('the Host a request names: the daemon\'s own address, or remote access\'s while it runs; another (DNS rebinding) is turned away', async t => {
  const rig = await fresh(t)
  const { port, token } = rig.info()
  const at = (host: string, method = 'POST', path = '/rpc') =>
    new Promise<number>((res, rej) => {
      const r = request({ host: '127.0.0.1', port, path, method, headers: { host, authorization: `Bearer ${token}` } }, x => (x.resume(), res(x.statusCode!)))
      r.on('error', rej).end(method === 'POST' ? JSON.stringify({ method: 'ping' }) : undefined)
    })
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`]) assert.equal(await at(h), 200, h)
  for (const h of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, `fake-${port}.trycloudflare.com`]) {
    assert.equal(await at(h), 421, h)
    assert.equal(await at(h, 'GET', '/'), 421, h) // the page, a widget's, an artifact: every route
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { headers: { host: 'evil.example' } })
  await assert.rejects(new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej))))
  // remote access: its own host too, until it stops
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev' })
  assert.equal(await at(`fake-${port}.trycloudflare.com`), 200)
  await rig.rpc('remoteStop')
  assert.equal(await at(`fake-${port}.trycloudflare.com`), 421)
})

test('tunnels: cloudflared missing, a protected tunnel, a public one, refusals, cloudflared failing, stop while starting, gone with the workspace and the daemon', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'tun' })
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  assert.deepEqual(await rig.rpc('cloudflared'), { mails: [] }) // no version: not installed; no git user.email
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173 }), /cloudflared isn't installed: brew install cloudflared/)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  assert.equal((await rig.rpc('cloudflared')).version, '2026.9.3')
  // the project's default for the popup: its .laki.json, its own setting over that (trimmed; blank: the file's)
  const expose = async () => (await rig.rpc('cloudflared', { ws: ws.id })).expose
  assert.equal(await expose(), undefined)
  // a worktree's own .laki.json never counts (its branch could bring its own setup, env, ports): the main checkout's
  writeFileSync(join(ws.path, '.laki.json'), JSON.stringify({ expose: '*@branch.dev', setup: 'touch pwned' }))
  assert.equal(await expose(), undefined)
  writeFileSync(join(rig.repo, '.laki.json'), JSON.stringify({ expose: '*@file.dev' }))
  assert.equal(await expose(), undefined) // not trusted yet
  await rig.trust(p.id)
  assert.equal(await expose(), '*@file.dev')
  await rig.rpc('projectSet', { id: p.id, config: { expose: ' me@x.dev, *@team.dev ' } })
  assert.equal(await expose(), 'me@x.dev, *@team.dev')
  await rig.rpc('projectSet', { id: p.id, config: { expose: ' ' } })
  assert.equal(await expose(), '*@file.dev')
  rmSync(join(rig.repo, '.laki.json'))
  assert.equal(await expose(), undefined)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: ['nope'] }), /not an email address or \*@domain: nope/)
  for (const m of ['me*@x.dev', '*@*.x.dev', 'a@b.dev,c@d.dev', '*@localhost'])
    await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: [m] }), /not an email address or \*@domain/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 70000 }), /not a port: 70000/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: 'nope', port: 5173 }), /no workspace nope/)

  // protected: the login page's URL isn't the tunnel's; the list is remembered
  const t0 = Date.now()
  const tn = await rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: [' me@x.dev', '*@team.dev', 'me@x.dev', ''] })
  assert.deepEqual({ ...tn, until: undefined }, { port: 5173, url: 'https://fake-5173.trycloudflare.com', mails: ['me@x.dev', '*@team.dev'], until: undefined })
  assert.ok(Math.abs(tn.until - (t0 + 8 * 3600e3)) < 5000) // 8 hours unless asked
  assert.match(log(), /cloudflared tunnel --no-autoupdate --url http:\/\/localhost:5173 --allowed-mail=me@x\.dev --allowed-mail=\*@team\.dev\n/)
  assert.deepEqual((await rig.rpc('cloudflared')).mails, ['me@x.dev', '*@team.dev'])
  assert.deepEqual(await rig.rpc('tunnelStart', { ws: ws.id, port: 5173 }), tn) // running already: that one
  const pub = await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, hours: 1 })
  assert.deepEqual({ ...pub, until: undefined }, { port: 3000, url: 'https://fake-3000.trycloudflare.com', mails: [], until: undefined })
  assert.ok(Math.abs(pub.until - (t0 + 3600e3)) < 5000)
  assert.deepEqual((await rig.rpc('state')).workspaces[0].tunnels, [tn, pub])
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 3001, hours: 3 }), /for how long: 1, 8, 24 hours, or 0 \(until stopped\)/)
  // past its hours: stopped (the 8-hour one stays)
  await rig.rpc('tunnelTick', { now: pub.until + 1 })
  await until(() => log().includes('cloudflared 3000 stopped'), 'the hour is up')
  assert.deepEqual((await rig.rpc('state')).workspaces[0].tunnels, [tn])
  assert.equal((await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, hours: 0 })).until, undefined) // until stopped: none

  writeFileSync(join(rig.home, 'cf-version'), '2025.1.0')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000, mails: ['me@x.dev'] }), /cloudflared 2025\.1\.0 can't limit who opens a tunnel \(that needs 2026\.9\.3\): brew upgrade cloudflared/)
  rmSync(join(rig.home, 'cf-version'))
  writeFileSync(join(rig.home, 'cf-fail'), 'failed to request quick Tunnel: 429 Too Many Requests')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000 }), /cloudflared ended \(exit 1\):\n.*Requesting new quick Tunnel[^]*429 Too Many Requests/)
  rmSync(join(rig.home, 'cf-fail'))
  writeFileSync(join(rig.home, 'cf-silent'), '')
  const starting = rig.rpc('tunnelStart', { ws: ws.id, port: 4000 })
  await until(async () => (await rig.rpc('state')).workspaces[0].tunnels.some((x: any) => x.port === 4000 && !x.url), 'a starting tunnel')
  await rig.rpc('tunnelStop', { ws: ws.id, port: 4000 })
  assert.deepEqual(await starting, { port: 4000, mails: [] }) // stopped: no URL, no error
  rmSync(join(rig.home, 'cf-silent'))

  await rig.rpc('tunnelStop', { ws: ws.id, port: 3000 })
  await until(() => log().split('cloudflared 3000 stopped').length === 3, 'the public tunnel stopped (again)')
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => log().includes('cloudflared 5173 stopped'), 'the workspace takes its tunnel')
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'tun2' })
  await rig.rpc('tunnelStart', { ws: other.id, port: 8080 })
  await rig.stop()
  await until(() => log().includes('cloudflared 8080 stopped'), 'the daemon takes its tunnels')
})

test('remote access: the page, one email for some hours, a token of its own; gone when stopped, past its time or with the daemon', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  const at = `http://127.0.0.1:${port}`
  const log = () => (existsSync(rig.env.FAKE_LOG) ? readFileSync(rig.env.FAKE_LOG, 'utf8') : '')
  const stops = () => log().split(`cloudflared ${port} stopped`).length - 1

  // the page: its files to any origin (no secrets in them), nothing outside its folder
  assert.equal((await fetch(`${at}/`)).status, 404)
  const page = rig.env.LAKI_PAGE
  mkdirSync(join(page, 'assets'), { recursive: true })
  writeFileSync(join(page, 'index.html'), '<title>Laki</title>')
  writeFileSync(join(page, 'assets/app.js'), 'x')
  writeFileSync(join(page, 'assets/index-B3x_k9aZ.js'), 'x')
  writeFileSync(join(rig.home, 'secret'), 'no')
  const r = await fetch(`${at}/`, { headers: { origin: 'https://evil.example' } })
  assert.deepEqual([r.status, r.headers.get('content-type'), await r.text()], [200, 'text/html; charset=utf-8', '<title>Laki</title>'])
  assert.equal((await fetch(`${at}/assets/app.js`)).headers.get('content-type'), 'text/javascript')
  // the page never from the cache (back through Cloudflare's sign-in), its files revalidated; a hashed one kept a year
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(`${at}/assets/app.js`)).headers.get('cache-control'), 'no-cache')
  assert.equal((await fetch(`${at}/assets/index-B3x_k9aZ.js`)).headers.get('cache-control'), 'public, max-age=31536000, immutable')
  for (const path of ['/..%2fsecret', '/assets/..%2f..%2fsecret', '/%E0%A4%A'])
    assert.equal((await fetch(at + path)).status, 404, path)

  // refusals; the email is kept (the global setting) once it is one
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /the email that may open it: Settings › Remote access/)
  for (const hours of [3, null, '', '0', false]) await assert.rejects(rig.rpc('remoteStart', { hours, mail: 'me@x.dev' }), /for how long: 1, 2, 4, 8, 12, 24, 48, 72 hours, or 0 \(until stopped\)/)
  for (const m of ['*@x.dev', 'a@b.dev,c@d.dev', 'nope'])
    await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: m }), /not an email address/)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: ' me@x.dev ' }), /cloudflared isn't installed: brew install cloudflared/)
  assert.equal((await rig.rpc('state')).settings.remoteMail, 'me@x.dev')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  writeFileSync(join(rig.home, 'cf-version'), '2025.1.0')
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /can't limit who opens a tunnel/)
  rmSync(join(rig.home, 'cf-version'))

  // on: cloudflared in front of the daemon itself, for that email only
  const t0 = Date.now()
  const on = await rig.rpc('remoteStart', { hours: 2 })
  const url = `https://fake-${port}.trycloudflare.com`
  assert.deepEqual([on.mail, on.url], ['me@x.dev', url])
  assert.match(on.link, new RegExp(`^${url}/#t=[0-9a-f]{64}&k=[\\w-]{43}$`)) // S11: in the hash; S14: its end-to-end secret too
  assert.ok(Math.abs(on.until - (t0 + 2 * 3600e3)) < 5000)
  assert.match(log(), new RegExp(`cloudflared tunnel --no-autoupdate --url http://127\\.0\\.0\\.1:${port} --allowed-mail=me@x\\.dev\n`))
  assert.deepEqual((await rig.rpc('stateOwn')).remote, on)
  assert.deepEqual(await rig.rpc('remoteStart', { hours: 8 }), on) // running already: that one

  // the link's key, once, from its page's origin: the page's own token for it, then the link is dead (L3)
  const key = tokenOf(on.link)
  const ping = (token: string, origin?: string) =>
    farFetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(origin && { origin }) }, body: JSON.stringify({ method: 'ping' }) }).then(r => r.status)
  const pinAt = (body: object, origin = url) => fetch(`${at}/pin`, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }).then(r => r.json())
  assert.equal(await ping(key, url), 401) // the link's key isn't a token
  assert.equal((await fetch(`${at}/pin`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ token: key }) })).status, 403)
  const own = await pinAt({ token: key })
  assert.equal(own.need, false)
  assert.match(own.token, /^[0-9a-f]{64}$/)
  assert.deepEqual(await pinAt({ token: key }), { need: false }) // once: a second tab or device gets nothing
  assert.equal((await rig.rpc('state')).remote.used, true)
  const tok = own.token
  assert.equal(await ping(key, url), 401)
  assert.equal(await ping(tok, url), 200)
  assert.equal(await ping(tok, 'https://evil.example'), 403)
  assert.equal(await ping(tok), 401) // no Origin: not its page
  assert.equal(await ping(rig.info().token, url), 401) // ours with its Origin: it'd skip the caller check as the phone's page (M5)
  await assert.rejects(connect(rig, undefined, tok))
  const c = await connect(rig, url, tok, true) // S11: its token in its first message
  assert.equal(await c.call('ping'), 'pong')
  // P2: a phone that asks for patches: its whole view first, masked, then patches of its masked view
  await rig.rpc('settingsSet', { env: { API_TOKEN: 'fake-secret-1' } })
  const pc = await connect(rig, url, tok, true, true)
  const whole = await until(() => pc.events.find(e => e.ev === 'state' && e.view), 'its whole view')
  assert.notEqual(whole.view.settings.env?.API_TOKEN, 'fake-secret-1', 'masked')
  await rig.rpc('settingsSet', { env: { API_TOKEN: 'fake-secret-2', OTHER_KEY: 'fake-secret-3' } }) // a new value under the mask alone: no patch (the masked view is the same)
  const p2 = await until(() => pc.events.find(e => e.ev === 'state' && e.patch?.settings?.env?.OTHER_KEY), 'a patch of its settings')
  assert.equal(p2.view, undefined)
  assert.ok(!JSON.stringify(pc.events).includes('fake-secret'), 'masked in every patch too')
  pc.close()
  // S14: end to end: a sealed /rpc and its sealed answer; a clear one, a salt again and a wrong tag refused
  const secret = farKey(url)!
  const rpcSealed = (body: Uint8Array, salt: Buffer) => fetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, origin: url, 'x-laki-e2e': salt.toString('base64') }, body: body as BodyInit })
  assert.equal((await fetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, origin: url }, body: '{"method":"ping"}' })).status, 426, 'a clear call')
  const salt = randomBytes(16)
  const ping1 = () => JSON.stringify({ method: 'ping', at: Date.now() })
  const sealed = new Uint8Array(channel(keyOf(secret, salt), PAGE).seal(ping1()))
  const back = await rpcSealed(sealed, salt)
  assert.equal(back.headers.get('content-type'), 'application/octet-stream')
  const backBuf = Buffer.from(await back.arrayBuffer())
  assert.ok(!backBuf.includes('pong'), 'the answer sealed')
  assert.deepEqual(JSON.parse(String(channel(keyOf(secret, salt), PAGE).open(backBuf))), { result: 'pong' })
  assert.equal((await rpcSealed(sealed, salt)).status, 400, 'its salt again: a replay')
  const salt2 = randomBytes(16)
  const torn = new Uint8Array(channel(keyOf(secret, salt2), PAGE).seal(ping1()))
  torn[torn.length - 1] ^= 1
  assert.equal((await rpcSealed(torn, salt2)).status, 400, 'a wrong tag')
  const salt3 = randomBytes(16)
  const stale = await rpcSealed(new Uint8Array(channel(keyOf(secret, salt3), PAGE).seal(JSON.stringify({ method: 'ping', at: Date.now() - 6 * 60e3 }))), salt3)
  assert.equal(stale.status, 400, 'sealed 6 minutes ago: past its salt being kept, refused by its time')
  assert.match(String(channel(keyOf(secret, salt3), PAGE).open(Buffer.from(await stale.arrayBuffer()))), /more than 5 minutes ago/)
  // the socket: its salt in clear, then sealed both ways; a frame again, a wrong tag, a clear page, another key: closed
  const sock = async (first: (ch: ReturnType<typeof channel>, ws: WebSocket) => void, key = secret) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: url })
    const got: any[] = []
    const shut = new Promise<[number, string]>(r => ws.once('close', (code, why) => r([code, String(why)])))
    let ch: ReturnType<typeof channel> | undefined
    ws.on('message', (m, binary) => {
      if (!binary) {
        const j = JSON.parse(String(m))
        assert.deepEqual([j.e2e, Buffer.from(j.salt, 'base64').length], [1, 16])
        const mine = randomBytes(16)
        ch = channel(keyOf(key, Buffer.concat([Buffer.from(j.salt, 'base64'), mine])), PAGE)
        const raw = ws.send.bind(ws)
        let firstOne = true
        return first(ch, Object.assign(Object.create(ws), { send: (d: any) => (firstOne && Buffer.isBuffer(d) ? ((firstOne = false), raw(Buffer.concat([mine, d]))) : raw(d)) }))
      }
      got.push(JSON.parse(String(ch!.open(m as Buffer))))
    })
    return { ws, got, shut }
  }
  const one = await sock((ch, ws) => (ws.send(ch.seal(JSON.stringify({ auth: tok }))), ws.send(ch.seal('{"id":1,"method":"ping"}'))))
  await until(() => one.got.some(m => m.id === 1 && m.result === 'pong'), 'a sealed answer')
  assert.ok(one.got.some(m => m.ev === 'state'), 'its state, sealed')
  const elsewhere = channel(keyOf(secret, randomBytes(16)), PAGE) // a frame sealed under another connection's salt: no tag fits
  one.ws.send(elsewhere.seal('{"id":2,"method":"ping"}'))
  assert.equal((await one.shut)[0], 4400)
  let kept: Buffer | undefined
  const two = await sock((ch, ws) => (ws.send(ch.seal(JSON.stringify({ auth: tok }))), (kept = ch.seal('{"id":1,"method":"ping"}')), ws.send(kept), setTimeout(() => ws.send(kept!), 200)))
  assert.deepEqual(await two.shut, [4400, 'a replayed frame'])
  const old = await sock((_, ws) => ws.send(JSON.stringify({ auth: tok })))
  assert.equal((await old.shut)[0], 4426, 'a page from before S14')
  const other = await sock((ch, ws) => ws.send(ch.seal(JSON.stringify({ auth: tok }))), randomBytes(32))
  assert.deepEqual(await other.shut, [4401, 'bad key'])
  // a phone has what it needs, not what outlives its session or opens Laki wider (M4)
  const far = (method: string, params = {}) =>
    farFetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, origin: url }, body: JSON.stringify({ method, params }) }).then(r => r.json())
  for (const [m, p] of [['shutdown', {}], ['remoteStart', { hours: 1 }], ['hookAdd', { name: 'far' }], ['hookRm', { name: 'far' }], ['cliInstall', {}], ['aiKey', { key: 'k' }], ['aiEndpointKey', { key: 'k' }], ['aiEndpointTest', {}], ['settingsSet', { aiEndpoint: { url: 'https://evil.example/v1', model: 'm' } }], ['skillSet', { agent: 'claude', on: true }], ['accountAdd', { agent: 'claude' }], ['widgetSet', { id: 'links', on: true }], ['widgetSet', { id: 'links', net: true }], ['settingsSet', { remoteMail: 'them@x.dev' }], ['settingsSet', { webhook: { url: 'https://evil.example' } }], ['settingsSet', { env: { A: '1' } }], ['settingsSet', { customCss: '.ws { display: none }' }], ['settingsSet', { editorCmd: 'sh -c evil' }], ['settingsSet', { allowOn: true }], ['settingsSet', { allowKey: '⌘C' }], ['settingsSet', { talkOn: true }]] as const)
    assert.match((await far(m, p)).error ?? '', /not over remote access: do that on the Mac itself/, m)
  await assert.rejects(c.call('shutdown'), /not over remote access/)
  // what nobody had listed (gates.ts' REMOTE_NO): the clock, accounts, a reset of every setting, extensions' files, a clone
  for (const [m, p] of [['archivedTidy', { now: 9e15 }], ['accountSet', { id: 'x', name: 'y' }], ['accountRm', { id: 'x' }], ['uiReset', {}], ['webhookTest', { url: 'https://example.com/x' }], ['widgetFileSave', { id: 'links', path: 'widget.json', text: '{}' }], ['widgetNew', { kind: 'number', name: 'Far' }], ['projectClone', { url: 'https://example.com/x.git' }], ['device', { op: 'shot' }], ['termList', {}], ['termRevoke', { key: 'x' }]] as const)
    assert.match((await far(m, p)).error ?? '', /not over remote access: do that on the Mac itself/, m)
  // S11: nor what goes on the internet, runs later or in every new workspace; a shell tab still opens (the phone's own)
  const pr = await rig.rpc('projectAdd', { path: rig.repo })
  const pws = await rig.rpc('wsNew', { project: pr.id, kind: 'local', name: 'far' })
  const ptab = (await rig.rpc('tabNew', { ws: pws.id, kind: 'shell' })).id
  for (const [m, p] of [['tunnelStart', { ws: pws.id, port: 3000 }], ['scheduleSet', { name: 'x', prompt: 'y' }], ['shareStart', { tab: ptab }], ['shareStart', { tab: ptab, hours: 0 }], ['projectSet', { id: pr.id, config: { setup: 'touch pwned' } }]] as const)
    assert.match((await far(m, p)).error ?? '', /not over remote access/, `${m} ${JSON.stringify(p)}`)
  assert.equal((await far('projectSet', { id: pr.id, notes: 'from the phone', config: {} })).error, undefined, 'its notes, and a config with no script changed')
  assert.equal((await far('tabNew', { ws: pws.id, kind: 'shell' })).error, undefined, 'a shell tab: yes')
  // S11: the socket: its token in its first message within 5 s, else closed; ?token= in the URL counts for nothing
  const shut = (sock: { once(e: 'close', f: (code: number) => void): unknown }) => new Promise<number>(r => sock.once('close', code => r(code)))
  const bad = await connect(rig, url, 'f'.repeat(64), true)
  assert.equal(await shut(bad.ws), 4401)
  const quiet = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${tok}`, { origin: url })
  const t5 = Date.now()
  assert.equal(await shut(quiet), 4401)
  assert.ok(Date.now() - t5 >= 4000, 'after its 5 s')
  assert.equal((await far('settingsSet', { remoteMail: 'me@x.dev', notify: false })).result.notify, false) // Settings sends them all back: unchanged is fine
  assert.equal(await rig.rpc('ping'), 'pong') // still up
  c.close()
  await assert.rejects(connect(rig, 'https://evil.example', tok))

  // stopped: the token and the origin go with it
  await rig.rpc('remoteStop')
  await until(() => stops() >= 1, 'cloudflared stopped', 30000)
  assert.equal((await rig.rpc('state')).remote, undefined)
  assert.equal(await ping(tok, url), 403)
  assert.equal(await ping(rig.info().token, url), 403)

  // past its time; a new start has a new token
  const again = await rig.rpc('remoteStart', { hours: 1 })
  assert.notEqual(again.link, on.link)
  await rig.rpc('remoteTick', { now: again.until - 1000 })
  assert.ok((await rig.rpc('state')).remote)
  await rig.rpc('remoteTick', { now: again.until })
  assert.equal((await rig.rpc('state')).remote, undefined)
  await until(() => stops() >= 2, 'cloudflared stopped at its time', 30000)

  // forever: no until, the clock never ends it (nor, with one email and Never, its time without a device: T10)
  await rig.rpc('settingsSet', { remoteIdleOff: 'never' })
  const ever = await rig.rpc('remoteStart', { hours: 0 })
  assert.equal(ever.until, undefined)
  await rig.rpc('remoteTick', { now: Date.now() + 3650 * 86400e3 })
  assert.equal((await rig.rpc('stateOwn')).remote.link, ever.link)
  assert.equal((await rig.rpc('state')).remote.link, undefined) // S3: not in the view the CLI and agents read
  await rig.rpc('remoteStop')
  await until(() => stops() >= 3, 'cloudflared stopped', 30000)

  // no email: only asked for (open), cloudflared with no --allowed-mail, the token still the lock, the saved email kept
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: '' }), /the email that may open it/)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: '', open: 'yes' }), /the email that may open it/)
  for (const hours of [0, 48]) await assert.rejects(rig.rpc('remoteStart', { hours, mail: '', open: true }), /without an email, 24 hours at most/)
  const pub = await rig.rpc('remoteStart', { hours: 1, mail: '', open: true })
  assert.deepEqual([pub.mail, pub.open], ['', true])
  assert.match(log(), new RegExp(`cloudflared tunnel --no-autoupdate --url http://127\\.0\\.0\\.1:${port}\n`))
  assert.equal((await rig.rpc('state')).settings.remoteMail, 'me@x.dev')
  assert.equal(await ping((await pinAt({ token: tokenOf(pub.link) })).token, url), 200)
  assert.equal(await ping('nope', url), 401)
  await rig.rpc('remoteStop')
  await until(() => stops() >= 4, 'cloudflared stopped', 30000)
  // an email given wins over open
  const mailed = await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev', open: true })
  assert.deepEqual([mailed.mail, mailed.open], ['me@x.dev', undefined])
  await rig.rpc('remoteStop')
  await until(() => stops() >= 5, 'cloudflared stopped', 30000)

  // Laki's PIN (no email, the saved one kept; pin wins over an email): the link's key alone only asks for it, the PIN
  // gives the page its token; a wrong one counts down (settings' remoteTries), the last stops remote access
  await rig.rpc('settingsSet', { remoteTries: 3, remoteWrong: 'stop' }) // D5's Stop: as before (Wait is remote-access.test's)
  const pinned = await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev', pin: true })
  assert.deepEqual([pinned.mail, pinned.open, pinned.tries], ['', undefined, 3])
  assert.match(pinned.pin, /^\d{6}$/)
  assert.equal(log().split(`cloudflared tunnel --no-autoupdate --url http://127.0.0.1:${port}\n`).length - 1, 2) // open's, and this one: no --allowed-mail
  const link = tokenOf(pinned.link)
  assert.equal(await ping(link, url), 401) // the link's key alone isn't in
  assert.deepEqual(await pinAt({ token: link }), { need: true, left: 3 })
  assert.deepEqual(await pinAt({ token: 'nope', pin: pinned.pin }), { need: false })
  assert.equal((await fetch(`${at}/pin`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status, 403)
  assert.equal((await fetch(`${at}/pin`, { method: 'POST', body: JSON.stringify({ token: link, pin: pinned.pin }) })).status, 403) // not from its page
  const wrong = pinned.pin === '000000' ? '111111' : '000000'
  assert.deepEqual(await pinAt({ token: link, pin: wrong }), { error: 'Wrong PIN: 2 more tries, then remote access stops' })
  assert.equal((await rig.rpc('state')).remote.tries, 2)
  assert.deepEqual(await pinAt({ token: '\u00e9'.repeat(64), pin: pinned.pin }), { need: false }) // as long as the key in characters, not in bytes
  const wide = [...pinned.pin].map(d => String.fromCharCode(0xff10 + Number(d))).join('') // a phone keyboard's fullwidth digits
  const got = await pinAt({ token: link, pin: ` ${wide.slice(0, 3)} ${wide.slice(3)} ` })
  assert.match(got.token, /^[0-9a-f]{64}$/)
  assert.equal(await ping(got.token, url), 200)
  assert.deepEqual(await pinAt({ token: got.token }), { need: false }) // in already
  // the link is dead now: no PIN on it again, right or wrong
  assert.deepEqual(await pinAt({ token: link, pin: pinned.pin }), { need: false })
  assert.deepEqual(await pinAt({ token: link, pin: wrong }), { need: false })
  assert.equal((await rig.rpc('state')).remote.tries, 2)
  await rig.rpc('remoteStop')
  await until(() => stops() >= 6, 'cloudflared stopped', 30000)
  assert.equal(await ping(got.token, url), 403)
  // the last wrong PIN stops it
  const again2 = await rig.rpc('remoteStart', { hours: 1, pin: true })
  const link2 = tokenOf(again2.link)
  const wrong2 = again2.pin === '000000' ? '111111' : '000000'
  const app = await connect(rig)
  assert.deepEqual(await pinAt({ token: link2, pin: wrong2 }), { error: 'Wrong PIN: 2 more tries, then remote access stops' })
  assert.deepEqual(await pinAt({ token: link2, pin: wrong2 }), { error: 'Wrong PIN: 1 more try, then remote access stops' })
  assert.deepEqual(await pinAt({ token: link2, pin: wrong2 }), { error: 'Wrong PIN: remote access stopped. Start it again on your Mac for a new link and PIN.' })
  assert.match((await until(async () => app.events.find(m => m.ev === 'remote' && /stopped/.test(m.text)), 'the app told')).text, /Remote access stopped: a wrong PIN/)
  app.close()
  assert.equal((await rig.rpc('state')).remote, undefined)
  await until(() => stops() >= 7, 'cloudflared stopped', 30000)
  assert.equal((await rig.rpc('state')).settings.remoteMail, 'me@x.dev')

  // cloudflared failing; stopped while starting
  writeFileSync(join(rig.home, 'cf-fail'), '429 Too Many Requests')
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /cloudflared ended \(exit 1\)[^]*429 Too Many Requests/)
  assert.equal((await rig.rpc('state')).remote, undefined)
  rmSync(join(rig.home, 'cf-fail'))
  writeFileSync(join(rig.home, 'cf-silent'), '')
  const starting = rig.rpc('remoteStart', { hours: 1 })
  await until(async () => (r => r && !r.url && !r.link)((await rig.rpc('state')).remote), 'starting')
  await rig.rpc('remoteStop')
  assert.equal(await starting, null)
  rmSync(join(rig.home, 'cf-silent'))

  // the daemon takes it
  await rig.rpc('remoteStart', { hours: 24 })
  const n = stops()
  await rig.stop()
  await until(() => stops() >= n + 1, 'the daemon takes remote access', 30000)
})

// D7: remote access's answer level, the session's (a quick tunnel's tab) and a paired device's: each family refused at
// answer (typing, a shell's send, deleting, archiving, merging, shipping, a command, a mode that never asks, settings,
// a workspace's other switches), allowed at full; reading, answering, an agent's message and a new agent go through
// M4: remote access at Full is classified as the answer level is: a method nobody listed is refused as the daemon loads
test('M4: every api method is in REMOTE_OK or REMOTE_NO, once', () => {
  const s = readFileSync(new URL('../src/daemon/main.ts', import.meta.url), 'utf8')
  const at = s.indexOf('const api = {') // T14: satisfies Record<string, Handler>
  const keys = [...s.slice(at, s.indexOf('\n} satisfies', at)).matchAll(/^ {2}(\w+): /gm)].map(m => m[1])
  assert.ok(keys.length > 250, 'the api table read')
  assert.deepEqual(keys.filter(k => REMOTE_OK.has(k) === REMOTE_NO.has(k)), [], 'each in exactly one')
  assert.deepEqual([...REMOTE_OK, ...REMOTE_NO].filter(k => !keys.includes(k)), [], 'every name listed is a method')
})

test('D7: answer only: what a phone may do at each level, set on the Mac only, in its view as remote.level', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  const at = `http://127.0.0.1:${port}`
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const pr = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: pr.id, kind: 'local', name: 'far' })
  const shell = (await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })).id
  const agent = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id
  await rig.rpc('settingsSet', { remoteMail: 'me@x.dev', remoteLevel: 'answer' })
  const on = await rig.rpc('remoteStart', { hours: 1 })
  const url = `https://fake-${port}.trycloudflare.com`
  const tok = (await fetch(`${at}/pin`, { method: 'POST', headers: { origin: url }, body: JSON.stringify({ token: tokenOf(on.link) }) }).then(r => r.json())).token
  const far = (method: string, params = {}) => farFetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, origin: url }, body: JSON.stringify({ method, params }) }).then(r => r.json())
  const c = await connect(rig, url, tok, true)
  t.after(() => c.close())
  await until(() => c.events.some(e => e.ev === 'state'), 'its view')
  assert.equal(c.events.findLast(e => e.ev === 'state').view.remote.level, 'answer')
  assert.equal((await rig.rpc('state')).remote.level, undefined, "the Mac's own view has none")

  const refused: [string, object][] = [
    ['input', { tab: shell, data: 'x' }],
    ['send', { target: shell, text: 'rm -rf ~' }],
    ['wsRm', { id: 'nope' }],
    ['wsArchive', { id: 'nope' }],
    ['prAct', { ws: 'nope', act: 'merge' }],
    ['ship', { ws: 'nope' }],
    ['run', { ws: 'nope' }],
    ['tabClose', { tab: 'nope' }],
    ['fileWrite', { ws: 'nope', path: 'a', text: 'b' }],
    ['tabNew', { ws: ws.id, kind: 'shell' }],
    ['tabNew', { ws: ws.id }], // no profile: tabNew's default is a shell
    ['send', { target: agent, text: '!rm -rf ~' }], // the agent's shell mode
    ['send', { target: agent, text: '!', enter: false }], // keys without Enter: a command in pieces
    ['tabNew', { ws: ws.id, preset: 'custom', cmd: 'touch pwned' }],
    ['wsNew', { project: pr.id, cmd: 'touch pwned' }],
    ['wsNew', { project: pr.id, preset: 'claude', perm: 'bypassPermissions' }],
    ['wsSet', { id: ws.id, muted: true }],
    ['settingsSet', { notify: false }],
    ['projectSet', { id: pr.id, notes: 'x' }],
  ]
  for (const [m, p] of refused) assert.match((await far(m, p)).error ?? '', /answer only from here[^]*give this device full access there/, `${m} ${JSON.stringify(p)}`)
  await assert.rejects(c.call('input', { tab: shell, data: 'x' }), /answer only from here/, 'the socket too')
  // what it may: read, an agent's message, a new agent, a name and a pin, a reminder
  for (const [m, p] of [['state', {}], ['screen', { target: agent }], ['diff', { ws: ws.id }], ['send', { target: agent, text: 'hi', whenIdle: true }], ['wsSet', { id: ws.id, name: 'from the phone', pinned: true }], ['reminderAdd', { text: 'look', at: Date.now() + 3600e3 }]] as const)
    assert.doesNotMatch((await far(m, p)).error ?? '', /answer only/, m)
  const made = await far('wsNew', { project: pr.id, preset: 'claude', prompt: 'a task', place: 'top' })
  assert.ok(made.result?.id, `a new agent: ${made.error}`)
  // its level is the Mac's to set
  assert.match((await far('settingsSet', { remoteLevel: 'full' })).error ?? '', /not over remote access/)

  // full: today's rules (each refused one gets past the level: what's left is its own error, or done)
  await rig.rpc('settingsSet', { remoteLevel: 'full' })
  for (const [m, p] of refused) assert.doesNotMatch((await far(m, p)).error ?? '', /answer only/, `${m} at full`)
  await until(() => c.events.findLast(e => e.ev === 'state')?.view.remote.level === 'full', 'its view says full')
})

test('D7: a paired device keeps its own level (the session\'s as it paired), changed on the Mac only', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  mkdirSync(join(rig.home, '.cloudflared'), { recursive: true })
  writeFileSync(join(rig.home, '.cloudflared/cert.pem'), 'a certificate')
  writeFileSync(join(rig.home, '.cloudflared/6f1e0c1a-0000-4000-8000-000000000001.json'), '{}')
  await rig.rpc('settingsSet', { tunnel: { name: 'laki', domain: 'example.dev' }, remoteLevel: 'answer', remotePasskey: false })
  const origin = 'https://laki.example.dev'
  const on = await rig.rpc('remoteStart', { hours: 0, host: 'laki' })
  const r = await fetch(`http://127.0.0.1:${port}/pin`, { method: 'POST', headers: { origin }, body: JSON.stringify({ token: tokenOf(on.link), pin: on.pin }) })
  const cookie = r.headers.get('set-cookie')!.split(';')[0]
  const far = (method: string, params = {}) => farFetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: 'Bearer device', origin, cookie }, body: JSON.stringify({ method, params }) }).then(r => r.json())
  const [d] = (await rig.rpc('state')).remoteDevices
  assert.equal(d.level, 'answer', 'the session\'s as it paired')
  await rig.rpc('settingsSet', { remoteLevel: 'full' })
  assert.match((await far('wsRm', { id: 'nope' })).error, /answer only from here/, "its own, not the session's now")
  assert.match((await far('remoteDeviceSet', { id: d.id, level: 'full' })).error, /not over remote access/)
  await assert.rejects(rig.rpc('remoteDeviceSet', { id: d.id, level: 'root' }), /answer or full/)
  await assert.rejects(rig.rpc('remoteDeviceSet', { id: 'nope', level: 'full' }), /no paired device/)
  assert.equal((await rig.rpc('remoteDeviceSet', { id: d.id, level: 'full' }))[0].level, 'full')
  assert.doesNotMatch((await far('wsRm', { id: 'nope' })).error ?? '', /answer only/)
})

test('remote access as an app (M4): its manifest, service worker and icons closed while remote access is off; at a quick tunnel only the icons (no stable address to install); /push and /tap only for a paired device', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  const at = `http://127.0.0.1:${port}`
  const page = rig.env.LAKI_PAGE
  mkdirSync(join(page, 'assets'), { recursive: true })
  writeFileSync(join(page, 'index.html'), '<title>Laki</title>')
  writeFileSync(join(page, 'icon-192.png'), 'png')
  const status = (path: string) => fetch(at + path).then(r => r.status)
  for (const path of ['/manifest.webmanifest', '/sw.js', '/icon-192.png']) assert.equal(await status(path), 404, `${path}: remote access is off`)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const on = await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev' })
  assert.equal(await status('/icon-192.png'), 200)
  assert.deepEqual([await status('/manifest.webmanifest'), await status('/sw.js')], [404, 404], 'a quick tunnel: its address is new each start')
  const post = (path: string, origin: string, body = '{}') => fetch(at + path, { method: 'POST', headers: { origin }, body }).then(r => r.status)
  assert.deepEqual([await post('/push', 'https://evil.example'), await post('/push', on.url), await post('/tap', on.url, '0123456789abcdef:1:0123456789abcdef')], [403, 401, 401])
  await rig.rpc('remoteStop')
  assert.equal(await status('/icon-192.png'), 404)
})

test("a send or an answer with a client's id (the remote page's outbox) is applied once: a repeat gets the first one's answer", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'outbox' })
  const tab = await rig.rpc('tabNew', { ws: w.id, preset: 'custom', cmd: 'cat' })
  const first = await rig.rpc('send', { target: tab.id, text: 'once-only', cid: 'c-1' })
  assert.deepEqual(await rig.rpc('send', { target: tab.id, text: 'once-only', cid: 'c-1' }), first, 'the same answer')
  await rig.rpc('send', { target: tab.id, text: 'next-one', cid: 'c-2' })
  await until(async () => (await rig.screen(tab.id)).includes('next-one'), 'the next one typed')
  assert.equal((await rig.screen(tab.id)).match(/once-only/g)?.length, 2, 'typed once: cat echoes it once')
  // one that failed isn't kept: its retry runs
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1, cid: 'c-3' }), /isn't asking anything now/)
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1, cid: 'c-3' }), /isn't asking anything now/)
})

test("Touch ID: with it on, remoteStart takes a fresh ticket of its own, once; a reused, expired or another action's is refused; turning it off takes one too", async t => {
  const rig = await fresh(t)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  await rig.rpc('settingsSet', { touchId: true })
  const ticket = async (what: string, now?: number) => (await rig.rpc('ticketMint', { what, ...(now && { now }) })).ticket as string
  const start = (touchTicket?: string) => rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev', ...(touchTicket && { touchTicket }) })
  await assert.rejects(start(), /to start remote access, Laki asks for Touch ID first \(Settings › General\): do it in Laki's window/)
  await assert.rejects(start(await ticket('remotePair')), /asks for Touch ID first/, "another action's")
  await assert.rejects(start(await ticket('remoteStart', Date.now() - 60_000)), /asks for Touch ID first/, 'expired')
  const t1 = await ticket('remoteStart')
  await start(t1)
  await rig.rpc('remoteStop')
  await assert.rejects(start(t1), /asks for Touch ID first/, 'used once')
  // the laki command is told to use the window (a profile turned to Bypass); an agent and daemon.json's token can't make one
  const cli = await rig.cli('preset', 'set', 'claude', '--perm', 'bypassPermissions')
  assert.equal(cli.code, 1)
  assert.match(cli.err, /to turn on Bypass permissions, Laki asks for Touch ID first \(Settings › General\): do it in Laki's window/)
  await rig.cli('preset', 'set', 'claude', '--perm', 'auto') // one that asks: as before
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  // a workspace, a tab or a race that starts with Bypass on (the call's perm, or a profile's): a ticket of its own; a shell none
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'claude', perm: 'bypassPermissions' }), /to start an agent with Bypass permissions, Laki asks for Touch ID first/)
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'claude', perm: 'bypassPermissions' }), /to start an agent with Bypass permissions/)
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'claude', perm: 'bypassPermissions', touchTicket: await ticket('bypass') }), /Touch ID first/, "a mode switch's ticket")
  await rig.rpc('tabNew', { ws: ws.id, kind: 'shell' })
  await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', perm: 'bypassPermissions', touchTicket: await ticket('bypassNew') })
  await rig.rpc('presetSave', { name: 'yolo', add: true, set: { agent: 'claude', perm: 'bypassPermissions' }, touchTicket: await ticket('bypass') })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'yolo' }), /to start an agent with Bypass/)
  await assert.rejects(rig.rpc('wsFan', { project: p.id, presets: ['claude', 'yolo'] }), /to start an agent with Bypass/)
  await assert.rejects(rig.rpc('ticketMint', { what: 'remoteStart', from: { tab: tab.id } }), /an agent can't make a Touch ID ticket/)
  const { port, token } = rig.info()
  const plain = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ method: 'ticketMint', params: { what: 'remoteStart' } }) }).then(r => r.json())
  assert.ok(plain.error && !plain.result, "daemon.json's token: not the app's")
  // the other actions, and a ticket never reaches a handler's params (settingsSet keeps none)
  await assert.rejects(rig.rpc('uiReset'), /to reset the interface/)
  await assert.rejects(rig.rpc('settingsSet', { touchId: false }), /to stop asking for Touch ID/)
  await rig.rpc('settingsSet', { notify: true, touchTicket: await ticket('uiReset') }) // not one of them: a ticket is dropped
  assert.equal('touchTicket' in (await rig.rpc('state')).settings, false)
  await rig.rpc('settingsSet', { touchId: false, touchTicket: await ticket('touchIdOff') })
  await start() // off: no ticket needed
})

test("10b, remote access: the remote page's manifest has three shortcuts, each a plain fragment on its own origin with an icon", async () => {
  const { manifestOf } = await import('../src/shared/pwa.ts')
  const m = manifestOf()
  assert.deepEqual(m.shortcuts.map(s => [s.name, s.url]), [['New task', '/#new'], ['Needs you', '/#needs'], ['Last workspace', '/#last']])
  // fragment-only, on the page's own origin: a path of its own, a plain #name, no query or secret
  for (const s of m.shortcuts) assert.match(s.url, /^\/#[a-z]+$/)
  assert.equal(new URL(m.shortcuts[0].url, 'https://laki.example.com/').origin, 'https://laki.example.com')
  for (const s of m.shortcuts) {
    assert.ok(s.url.startsWith(m.scope), `${s.url} is in the scope`)
    assert.ok(s.name && s.short_name.length <= 12, `${s.name}: a short name`)
    assert.equal(s.icons[0].src, '/icon-192.png')
  }
  assert.deepEqual([m.id, m.start_url, m.display], ['/', '/', 'standalone'])
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(m)))
})
