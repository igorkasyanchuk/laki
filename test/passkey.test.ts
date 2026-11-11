// D6: passkeys for remote access's paired devices: passkey.ts' checks with a software authenticator (a P-256 pair made
// here), then the daemon's flow at a stable address (My domain): set up just after pairing, each page locked until a
// signature (or the PIN), a replayed challenge, a wrong origin and a counter going back refused
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import { AT, authData, register, UP, UV, verifyGet } from '../src/daemon/passkey.ts'
import { fresh, sleep, until } from './helpers.ts'

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest()
// a software authenticator: one P-256 credential, its counter (stays: 0 always, as Apple's keep it)
function authenticator(rpId: string, o: { counts?: boolean } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const id = randomBytes(16)
  let count = 0
  const head = (flags: number, n: number) => Buffer.concat([sha(rpId), Buffer.from([flags]), Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])])
  return {
    id: b64u(id),
    // navigator.credentials.create's answer as the page sends it (attestation none: getPublicKey's SPKI)
    create(challenge: string, origin: string, flags = UP | UV | AT, alg = -7) {
      const cd = JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false })
      const ad = Buffer.concat([head(flags, 0), Buffer.alloc(16), Buffer.from([0, id.length]), id, Buffer.from([0xa0])])
      return { id: b64u(id), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), publicKey: b64u(publicKey.export({ format: 'der', type: 'spki' })), alg }
    },
    // navigator.credentials.get's
    get(challenge: string, origin: string, o2: { flags?: number; key?: KeyObject; count?: number } = {}) {
      if (o.counts) count++
      const cd = JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false })
      const ad = head(o2.flags ?? UP | UV, o2.count ?? count)
      const sig = sign('sha256', Buffer.concat([ad, sha(cd)]), { key: o2.key ?? privateKey, dsaEncoding: 'der' })
      return { id: b64u(id), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig) }
    },
  }
}

test('D6 passkey.ts: a registration and an assertion checked in full; each wrong part refused', () => {
  const rpId = 'laki.example.dev'
  const origin = `https://${rpId}`
  const a = authenticator(rpId, { counts: true })
  const c = b64u(randomBytes(32))
  const key = register(a.create(c, origin), { challenge: c, origin, rpId })
  assert.deepEqual([key.id, key.count, key.jwk.kty, key.jwk.crv], [a.id, 0, 'EC', 'P-256'])
  for (const [r, why] of [
    [a.create('other', origin), /not the challenge/],
    [a.create(c, 'https://evil.example'), /from https:\/\/evil\.example/],
    [a.create(c, origin, UP | AT), /wasn't verified/],
    [a.create(c, origin, UP | UV | AT, -257), /ES256/],
    [authenticator('evil.example').create(c, origin), /not for laki\.example\.dev/],
    [{ ...a.create(c, origin), id: b64u(randomBytes(16)) }, /isn't the authenticator's/],
    [{ ...a.create(c, origin), publicKey: b64u('nope') }, /doesn't read/],
  ] as const)
    assert.throws(() => register(r, { challenge: c, origin, rpId }), why)
  // an unlock: the signature by its key, the counter up
  const g = b64u(randomBytes(32))
  assert.equal(verifyGet(a.get(g, origin), { challenge: g, origin, rpId, key }), 1)
  const k1 = { ...key, count: 1 }
  for (const [r, why] of [
    [a.get(g, 'https://evil.example'), /from https:\/\/evil\.example/],
    [a.get('other', origin), /not the challenge/],
    [a.get(g, origin, { flags: UP }), /wasn't verified/],
    [a.get(g, origin, { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }), /isn't its key's/],
    [a.get(g, origin, { count: 1 }), /counter went back/],
    [{ ...a.get(g, origin), id: 'someone-else' }, /not this device's/],
  ] as const)
    assert.throws(() => verifyGet(r, { challenge: g, origin, rpId, key: k1 }), why)
  // an authenticator that keeps no counter: 0 and 0 pass
  const apple = authenticator(rpId)
  const ak = register(apple.create(c, origin), { challenge: c, origin, rpId })
  assert.equal(verifyGet(apple.get(g, origin), { challenge: g, origin, rpId, key: ak }), 0)
  // authenticatorData's bounds
  assert.throws(() => authData(Buffer.alloc(36)), /too short/)
  assert.throws(() => authData(Buffer.concat([Buffer.alloc(32), Buffer.from([AT, 0, 0, 0, 0]), Buffer.alloc(18), Buffer.from([0xff, 0xff])])), /bad credential id/)
})

// cloudflared (the fake), signed in, with its named tunnel laki on example.dev: My domain's stable address
async function named(rig: Awaited<ReturnType<typeof fresh>>) {
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const cfHome = join(rig.home, '.cloudflared')
  mkdirSync(cfHome, { recursive: true })
  writeFileSync(join(cfHome, 'cert.pem'), 'a certificate')
  writeFileSync(join(cfHome, '6f1e0c1a-0000-4000-8000-000000000001.json'), '{}')
  await rig.rpc('settingsSet', { tunnel: { name: 'laki', domain: 'example.dev' } })
}
// a paired device's page: its socket by its cookie, its events, its calls
async function page(port: number, origin: string, cookie: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers: { cookie } })
  const events: any[] = []
  const waiting = new Map<number, (m: any) => void>()
  ws.on('message', raw => (m => (m.id !== undefined && !m.ev ? waiting.get(m.id)?.(m) : events.push(m)))(JSON.parse(String(raw))))
  await new Promise<void>((res, rej) => (ws.once('open', () => (ws.send(JSON.stringify({ auth: 'device' })), res())), ws.once('error', rej)))
  let seq = 0
  const call = (method: string, params: object = {}) =>
    new Promise<any>((res, rej) => {
      const id = ++seq
      waiting.set(id, m => (m.error ? rej(new Error(m.error)) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, events, call, close: () => ws.close() }
}

test('D6: a paired device sets a passkey up, then each page is locked until its signature or the PIN; replays, a wrong origin and a counter going back refused', async t => {
  const rig = await fresh(t)
  await named(rig)
  const origin = 'https://laki.example.dev'
  const rpId = 'laki.example.dev'
  const on = await rig.rpc('remoteStart', { hours: 0, host: 'laki' })
  const { port } = rig.info()
  const r = await fetch(`http://127.0.0.1:${port}/pin`, { method: 'POST', headers: { origin }, body: JSON.stringify({ token: on.link.split('#t=')[1], pin: on.pin }) })
  const cookie = r.headers.get('set-cookie')!.split(';')[0]

  // just paired: its page is open (the state), offered a passkey
  const a = authenticator(rpId, { counts: true })
  const first = await page(port, origin, cookie)
  t.after(() => first.close())
  await until(() => first.events.some(e => e.ev === 'state') && first.events.some(e => e.ev === 'passkey' && e.offer), 'the state and the offer')
  const opts = await first.call('passkeyOptions')
  assert.equal(opts.rpId, rpId)
  await assert.rejects(first.call('passkeyRegister', a.create(opts.challenge, 'https://evil.example')), /from https:\/\/evil\.example/)
  await assert.rejects(first.call('passkeyRegister', a.create(opts.challenge, origin)), /challenge is used/, 'a challenge is good once, a failed check too')
  const o2 = await first.call('passkeyOptions')
  assert.deepEqual(await first.call('passkeyRegister', a.create(o2.challenge, origin)), { ok: true })
  assert.equal((await rig.rpc('state')).remoteDevices[0].passkey, true)
  assert.ok(!JSON.stringify(await rig.rpc('state')).includes(a.id), 'never its key in the view')
  await assert.rejects(first.call('passkeyOptions'), /just after pairing/, 'once')

  // a new page: locked, nothing sent but how to unlock; every other call refused, HTTP too
  const p = await page(port, origin, cookie)
  t.after(() => p.close())
  await until(() => p.events.some(e => e.ev === 'locked'), 'locked')
  assert.deepEqual(p.events.find(e => e.ev === 'locked'), { ev: 'locked', pin: true })
  await assert.rejects(p.call('state'), /locked/)
  await assert.rejects(p.call('wsNew', { project: 'x' }), /locked/)
  assert.equal(await p.call('ping'), 'pong')
  await rig.rpc('settingsSet', { remoteMail: 'x@y.dev' }) // a change: broadcast to every client
  await sleep(200)
  assert.ok(!p.events.some(e => e.ev === 'state'), 'no state while locked')
  const http = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: 'Bearer device', origin, cookie }, body: '{"method":"state"}' })
  assert.equal(http.status, 423)

  // its signature: unlocked, the state comes
  const ch = await p.call('passkeyChallenge')
  assert.deepEqual([ch.rpId, ch.id, ch.pin], [rpId, a.id, true])
  const signed = a.get(ch.challenge, origin)
  assert.equal(await p.call('passkeyUnlock', signed), true)
  await until(() => p.events.some(e => e.ev === 'state'), 'the state once unlocked')
  assert.ok(Array.isArray((await p.call('state')).projects), 'its calls go through')

  // another page: a replay of that signature, a wrong origin, a counter going back: refused
  const q = await page(port, origin, cookie)
  t.after(() => q.close())
  await until(() => q.events.some(e => e.ev === 'locked'), 'locked again')
  await assert.rejects(q.call('passkeyUnlock', signed), /challenge is used/)
  let c2 = await q.call('passkeyChallenge')
  await assert.rejects(q.call('passkeyUnlock', a.get(c2.challenge, 'https://evil.example')), /from https:\/\/evil\.example/)
  c2 = await q.call('passkeyChallenge')
  await assert.rejects(q.call('passkeyUnlock', a.get(c2.challenge, origin, { count: 1 })), /counter went back/)
  assert.ok(!q.events.some(e => e.ev === 'state'))
  // Use PIN instead: a wrong one counted, the right one opens it
  await assert.rejects(q.call('passkeyPin', { pin: '000000' === on.pin ? '111111' : '000000' }), /Wrong PIN/)
  assert.equal(await q.call('passkeyPin', { pin: on.pin }), true)
  await until(() => q.events.some(e => e.ev === 'state'), 'the state once the PIN opened it')
  // the PIN turned off: the passkey only
  await rig.rpc('settingsSet', { remotePinFallback: false })
  const z = await page(port, origin, cookie)
  t.after(() => z.close())
  await until(() => z.events.some(e => e.ev === 'locked'), 'locked')
  assert.deepEqual(z.events.find(e => e.ev === 'locked'), { ev: 'locked', pin: false })
  await assert.rejects(z.call('passkeyPin', { pin: on.pin }), /PIN is off/)

  // idle (remoteIdle's minutes, 0.3 s here): the unlocked page locks again at its next call, told so
  await rig.rpc('settingsSet', { remoteIdle: 0.005 })
  await sleep(500)
  const n = q.events.length
  await assert.rejects(q.call('state'), /locked/)
  assert.ok(q.events.slice(n).some(e => e.ev === 'locked'), 'told it locked')
  // passkeys turned off on the Mac: a locked page opens at its next call (the state comes), not stuck on its lock
  await rig.rpc('settingsSet', { remotePasskey: false })
  const m = z.events.length
  assert.equal(await z.call('ping'), 'pong')
  await until(() => z.events.slice(m).some(e => e.ev === 'state'), 'the state once passkeys are off')
  assert.ok(Array.isArray((await z.call('state')).projects))
})
