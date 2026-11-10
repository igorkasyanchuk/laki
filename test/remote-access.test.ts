// remote access that stays: My domain's stable address (D1), started again when its tunnel ends or the daemon
// restarts (D2). remote.ts; api.test.ts has the rest of remote access
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

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
const ping = (port: number, token: string, origin?: string) => fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(origin && { origin }) }, body: '{"method":"ping"}' }).then(r => r.status)

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
  assert.match(on.link, new RegExp(`^${url}/#t=[0-9a-f]{64}$`))
  assert.match(log(), /cloudflared tunnel route dns laki laki\.example\.dev\n/)
  assert.match(ingress(), new RegExp(`- hostname: laki\\.example\\.dev\\n {4}service: http://127\\.0\\.0\\.1:${port}\\n`))
  // its page: the PIN, then its own token, from that origin only
  const key = on.link.split('#t=')[1]
  assert.deepEqual(await pinAt(port, url, { token: key }), { need: true, left: 2 })
  const tok = (await pinAt(port, url, { token: key, pin: on.pin })).token
  assert.equal(await ping(port, tok, url), 200)
  assert.equal(await ping(port, tok, 'https://evil.example'), 403)
  assert.equal(await ping(port, tok, 'https://other.example.dev'), 403)
  const c = await connect(rig, url, tok, true)
  assert.equal(await c.call('ping'), 'pong')
  c.close()
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
  assert.equal(await ping(port, tok, url), 403)
  const again = await rig.rpc('remoteStart', { hours: 2, host: 'laki' })
  assert.equal(again.url, url)
  assert.notEqual(again.link, on.link)
  assert.equal(await ping(port, tok, url), 401) // the old page's token went with the stop
  assert.equal(await ping(port, tok, 'https://fake.trycloudflare.com'), 403)
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

test('D2: a stable address (My domain) comes back as it was after a restart: the page reconnects with its own token', async t => {
  const rig = await fresh(t)
  await named(rig)
  const url = 'https://laki.example.dev'
  const on = await rig.rpc('remoteStart', { hours: 4, host: '' })
  const tok = (await pinAt(rig.info().port, url, { token: on.link.split('#t=')[1], pin: on.pin })).token
  assert.match(tok, /^[0-9a-f]{64}$/)
  assert.equal(saved(rig.data).access?.length, 64) // its hash, never the token
  assert.ok(!readFileSync(join(rig.data, 'state.json'), 'utf8').includes(tok))
  await rig.stop()
  await rig.start()
  const { port } = rig.info()
  await until(async () => (r => r?.url === url && !r.down)((await rig.rpc('stateOwn')).remote), 'back at its address')
  const r = (await rig.rpc('stateOwn')).remote
  assert.deepEqual([r.until, r.used, r.was], [on.until, true, undefined])
  assert.equal(await ping(port, tok, url), 200) // the same page, reconnected
  const c = await connect(rig, url, tok, true)
  assert.equal(await c.call('ping'), 'pong')
  c.close()
  // a wrong page token still isn't
  assert.equal(await ping(port, 'f'.repeat(64), url), 401)
})
