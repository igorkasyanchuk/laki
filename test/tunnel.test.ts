// tunnels that stay up: a quick one started again when cloudflared ends (a new address, the tunnel event) and after a
// daemon restart; a permanent one on your named tunnel (settings.tunnel): its DNS record, one cloudflared for all of
// them, its address kept (remote.ts)
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const kids = (data: string) => (f => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { pid: number }[]) : []))(join(data, 'children.json'))

test('a quick tunnel: started again when cloudflared ends (a new address, said), back after a daemon restart, gone with its workspace', async t => {
  const rig = await fresh(t)
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'tun' })
  const tunnels = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).tunnels
  const tn = await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, hours: 24 })
  assert.equal(tn.url, 'https://fake-3000.trycloudflare.com')
  assert.match(log(), /cloudflared tunnel --no-autoupdate --url http:\/\/localhost:3000\n/) // its own updater would restart it
  const kept = () => JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8')).tunnels
  assert.deepEqual(kept(), [{ ws: ws.id, port: 3000, until: tn.until, url: tn.url }])

  // cloudflared ends on its own: down a moment, then again at a new address, and the app's window is told
  const c = await rig.connect()
  await until(() => kids(rig.data).length === 1, 'its cloudflared noted')
  writeFileSync(join(rig.home, 'cf-gen'), '-2')
  process.kill(kids(rig.data)[0].pid, 'SIGTERM')
  await until(async () => /cloudflared ended/.test((await tunnels())[0].down ?? ''), 'down, starting again')
  await until(async () => (await tunnels())[0].url === 'https://fake-3000-2.trycloudflare.com', 'back at a new address')
  assert.equal((await tunnels())[0].down, undefined)
  assert.equal((await tunnels())[0].until, tn.until) // its time as it was
  assert.ok(c.events.some(e => e.ev === 'tunnel' && e.port === 3000 && e.url === 'https://fake-3000-2.trycloudflare.com' && e.was === tn.url))
  c.close()

  // a daemon restart: stopped with it, kept, and started again
  await rig.stop()
  await until(() => log().split('cloudflared 3000 stopped').length === 3, 'the daemon stopped it')
  writeFileSync(join(rig.home, 'cf-gen'), '-3')
  await rig.start()
  await until(async () => (await tunnels())?.[0]?.url === 'https://fake-3000-3.trycloudflare.com', 'back after the restart')
  // one past its time doesn't come back; its workspace gone: none left to keep
  await rig.rpc('tunnelTick', { now: tn.until + 1 })
  assert.deepEqual(await tunnels(), [])
  assert.equal(kept(), undefined)
  await rig.rpc('tunnelStart', { ws: ws.id, port: 3001 })
  await rig.rpc('wsRm', { id: ws.id })
  assert.equal(kept(), undefined)
})

test('a permanent tunnel: set up in Settings, its DNS record, one cloudflared for all, refusals; started again and after a restart, its address kept', async t => {
  const rig = await fresh(t)
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'perm' })
  const tunnels = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).tunnels
  const ingress = () => readFileSync(join(rig.data, 'cloudflared/ingress.yml'), 'utf8')
  const own = JSON.parse(readFileSync(join(rig.data, 'daemon.json'), 'utf8')).port // Laki's API: never through a tunnel
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: own }), /Laki's own port/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 3000, host: 'shop' }), /set your named tunnel and its domain in Settings › Tunnels first/)

  // the check: each step as it stands
  const cfHome = join(rig.home, '.cloudflared')
  assert.deepEqual(await rig.rpc('tunnelCheck'), { version: '2026.9.3', cert: false, creds: false, ok: false })
  await rig.rpc('settingsSet', { tunnel: { name: 'laki', domain: 'Example.com.' } })
  mkdirSync(cfHome, { recursive: true })
  writeFileSync(join(cfHome, 'cert.pem'), 'a certificate')
  const id = '6f1e0c1a-0000-4000-8000-000000000001'
  assert.deepEqual(await rig.rpc('tunnelCheck'), { version: '2026.9.3', cert: true, tunnel: { id, name: 'laki' }, creds: false, ok: false })
  writeFileSync(join(cfHome, `${id}.json`), '{}')
  assert.equal((await rig.rpc('tunnelCheck')).ok, true)
  // the form's values as typed, before Settings saves them
  assert.deepEqual(await rig.rpc('tunnelCheck', { name: 'nope', domain: 'example.com' }), { version: '2026.9.3', cert: true, creds: false, ok: false })
  assert.deepEqual((await rig.rpc('cloudflared')).named, { name: 'laki', domain: 'example.com' })

  // one: its record, then the connector with it in its ingress
  const shop = await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, host: 'Shop' })
  assert.deepEqual(shop, { port: 3000, url: 'https://shop.example.com', mails: [], host: 'shop.example.com' })
  assert.match(log(), /cloudflared tunnel route dns laki shop\.example\.com\n/)
  assert.match(log(), new RegExp(`cloudflared tunnel --no-autoupdate --config ${join(rig.data, 'cloudflared/ingress.yml')} run laki\n`))
  assert.match(ingress(), /- hostname: shop\.example\.com\n {4}service: http:\/\/localhost:3000\n {2}- service: http_status:404\n/)
  assert.deepEqual(await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, host: 'shop.example.com' }), shop) // the same: that one
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 3000, host: 'other' }), /:3000 is exposed already at shop\.example\.com: stop that first/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 3000 }), /:3000 is exposed already at shop\.example\.com: stop that first/) // a random one there: no
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000, host: 'shop' }), /shop\.example\.com is taken/)
  for (const bad of ['a.b', '-x', 'x_y', ''])
    await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000, host: bad }), /one word: letters, digits and dashes/)
  writeFileSync(join(rig.home, 'cf-dns-taken'), 'blog.example.com\n')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000, host: 'blog' }), /blog\.example\.com has a DNS record already that isn't this tunnel's/)

  // a second: one cloudflared still, started again with both
  const api = await rig.rpc('tunnelStart', { ws: ws.id, port: 4000, host: 'api' })
  assert.equal(api.url, 'https://api.example.com')
  assert.match(ingress(), /api\.example\.com[^]*shop\.example\.com/)
  await until(() => log().split('cloudflared named stopped').length === 2, 'the first connector stopped for the second')
  assert.deepEqual((await tunnels()).map((x: any) => [x.port, x.url, x.host]), [[3000, 'https://shop.example.com', 'shop.example.com'], [4000, 'https://api.example.com', 'api.example.com']])
  await rig.rpc('tunnelStop', { ws: ws.id, port: 3000 })
  await until(() => !/shop/.test(ingress()), 'shop taken off')

  // cloudflared ends on its own: down, then up again at the same address
  await until(() => log().split('cloudflared named stopped').length === 3 && kids(rig.data).length === 1, 'the new connector noted, the old one gone')
  process.kill(kids(rig.data)[0].pid, 'SIGTERM')
  // down lasts AGAIN's first 2 s: a busy Mac's view may miss it, so its log line (connDown says it as it sets down)
  await until(async () => /cloudflared ended/.test((await tunnels())[0].down ?? '') || /permanent tunnels: cloudflared ended/.test(readFileSync(join(rig.data, 'daemon.log'), 'utf8')), 'down')
  await until(async () => !(await tunnels())[0].down, 'up again')
  assert.equal((await tunnels())[0].url, 'https://api.example.com')

  // after a daemon restart: back, its record not made again
  const routes = () => log().split('tunnel route dns').length
  const was = routes()
  await rig.stop()
  await rig.start()
  await until(async () => (await tunnels())?.[0]?.url === 'https://api.example.com' && !(await tunnels())[0].down, 'back after the restart')
  assert.equal(routes(), was)
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8')).tunnels[0].via, 'laki')

  // another named tunnel in Settings: api's record still goes to laki, so the new connector leaves it out, down
  await rig.rpc('settingsSet', { tunnel: { name: 'laki2', domain: 'example.com' } })
  await rig.rpc('tunnelStart', { ws: ws.id, port: 5000, host: 'web' })
  assert.match((await tunnels())[0].down, /goes to your tunnel laki, not laki2/)
  assert.doesNotMatch(ingress(), /api/)
  await rig.rpc('tunnelStop', { ws: ws.id, port: 5000 })
  await rig.rpc('tunnelStop', { ws: ws.id, port: 4000 })
  await until(() => log().split(/ run laki2?\n/).length === log().split('cloudflared named stopped').length, 'none left: the connector stops').catch(e => assert.fail(`${e.message}\n${log()}`))
})
