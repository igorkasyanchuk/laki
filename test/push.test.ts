// Phone pushes (Settings › Phone pushes): each format's request, and a fake agent's turns against a local server.
import assert from 'node:assert/strict'
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto'
import { PAYLOAD_MAX, pushRequest, subOk, tapOf, tapSig, vapidNew, webPushPayload, webPushRequest } from '../src/daemon/push.ts'
import { connect, fresh, sleep, until } from './helpers.ts'

const p = { event: 'waiting', workspace: 'fix-login', tab: 't1', agent: 'claude', question: 'Run rm -rf build?' } as const

test('push formats: ntfy text with a Title, Slack text, generic JSON (Telegram: telegram.test.ts)', () => {
  const ntfy = pushRequest({ format: 'ntfy' }, p)
  assert.deepEqual(ntfy.headers, { title: 'claude in fix-login is waiting for you' })
  assert.equal(ntfy.body, 'Run rm -rf build?')
  assert.match((pushRequest({}, { ...p, workspace: 'café ☕' }).headers as Record<string, string>).title, /^=\?UTF-8\?B\?.+\?=$/) // ntfy by default; past ASCII: RFC 2047
  assert.deepEqual(JSON.parse(String(pushRequest({ format: 'slack' }, p).body)), { text: 'claude in fix-login is waiting for you\nRun rm -rf build?' })
  assert.equal(JSON.parse(String(pushRequest({ format: 'slack' }, { ...p, question: 'Overwrite <dir> & <!channel>?' }).body)).text.split('\n')[1], 'Overwrite &lt;dir&gt; &amp; &lt;!channel&gt;?')
  assert.deepEqual(JSON.parse(String(pushRequest({ format: 'json' }, { ...p, event: 'done', question: undefined }, 5).body)), {
    event: 'done',
    workspace: 'fix-login',
    tab: 't1',
    agent: 'claude',
    message: 'claude in fix-login is done',
    ts: 5,
  })
})

test('push detail titles: who needs you only, no question, choices or buttons in any format (L8)', () => {
  const opts = { ...p, options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], nonce: '00112233aabbccdd' }
  for (const format of ['ntfy', 'slack', 'json'] as const) {
    const r = pushRequest({ format, detail: 'titles', url: 'https://ntfy.example/x', replyTopic: 'x' }, opts)
    const all = `${JSON.stringify(r.headers)}${r.body}`
    assert.match(all, /claude in fix-login is waiting for you/, format)
    assert.doesNotMatch(all, /rm -rf|Yes|actions|reply_markup|options/, format)
  }
})

test('push choices: as text in every format; with a nonce, ntfy actions (JSON, the first 3) to the reply topic', () => {
  const options = [1, 2, 3, 4].map(n => ({ n, label: `pick ${n}` }))
  const q = { ...p, options }
  assert.equal(pushRequest({ format: 'ntfy' }, q).body, 'Run rm -rf build?\n1. pick 1\n2. pick 2\n3. pick 3\n4. pick 4')
  assert.deepEqual(JSON.parse(String(pushRequest({ format: 'json' }, q, 5).body)).options, options)
  const nt = JSON.parse(String(pushRequest({ format: 'ntfy', url: 'https://ntfy.sh/mine', replyTopic: 'xyz' }, { ...q, nonce: '00112233aabbccdd', key: 'k' }).body))
  assert.equal(nt.topic, 'mine')
  assert.equal(nt.actions.length, 3)
  // each tap signed: nonce:n:<hmac of the key>
  assert.deepEqual(nt.actions[0], { action: 'http', label: '1. pick 1', url: 'https://ntfy.sh/mine-xyz', method: 'POST', body: `00112233aabbccdd:1:${tapSig('k', '00112233aabbccdd', 1)}`, clear: true })
  assert.match(nt.actions[0].body, /^00112233aabbccdd:1:[0-9a-f]{16}$/)
  assert.equal(typeof pushRequest({ format: 'ntfy', url: 'https://ntfy.sh/mine' }, { ...q, nonce: '00112233aabbccdd' }).body, 'string') // no reply topic: text
  const auth = JSON.parse(String(pushRequest({ format: 'ntfy', url: 'https://ntfy.example/mine?auth=XYZ', replyTopic: 'xyz' }, { ...q, nonce: '00112233aabbccdd' }).body))
  assert.equal(auth.actions[0].url, 'https://ntfy.example/mine-xyz?auth=XYZ') // the topic's auth goes with the tap
})

test('answer from the phone: an ntfy tap on a waiting menu picks that choice once, only while the same menu waits', async t => {
  const posts: any[] = []
  const queue: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.startsWith('/topic-r1/json?poll=1')) return void res.writeHead(200).end(queue.splice(0).join('\n'))
      posts.push({ url: req.url, body })
      res.writeHead(200).end()
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`
  const rig = await fresh(t, { env: { LAKI_ANSWER_HOLD_MS: '200' } }) // an answer's hold 0.2 s, not 1
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url, format: 'ntfy', answer: true, replyTopic: 'r1' } })
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const push = await until(() => posts.find(x => x.url === '/'), 'the push, as JSON to the root')
  const j = JSON.parse(push.body)
  assert.deepEqual(j.actions.map((a: any) => a.label), ['1. Yes', "2. Yes, and don't ask again for rm comm…", '3. No, and tell Claude what to do diffe…'])
  const nonce = j.actions[2].body.split(':')[0]
  // a tap without its signature, or with a made-up one: ignored
  queue.push(JSON.stringify({ event: 'open', id: 'o' }), JSON.stringify({ event: 'message', id: 'm0', message: `${nonce}:3` }), JSON.stringify({ event: 'message', id: 'm00', message: `${nonce}:3:0000000000000000` }))
  await rig.rpc('phoneTick')
  await sleep(500)
  assert.doesNotMatch(await rig.screen(tab.id), /picked:/)
  queue.push(JSON.stringify({ event: 'message', id: 'm1', message: 'ffffffffffffffff:1' }), JSON.stringify({ event: 'message', id: 'm2', message: j.actions[2].body }))
  await rig.rpc('phoneTick')
  await until(async () => /picked: No, and tell Claude/.test(await rig.screen(tab.id)), 'the tap picked 3')
  // the same menu again: the old tap's nonce is spent
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting again')
  queue.push(JSON.stringify({ event: 'message', id: 'm3', message: j.actions[0].body }))
  await rig.rpc('phoneTick')
  await sleep(500) // and answer holds a tab a moment after its Enter (0.2 s here): no pick comes
  assert.doesNotMatch(await rig.screen(tab.id), /picked: Yes/)
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1, label: 'No' }), /asks something else now/)
})

test('answer from the phone over ntfy needs a topic only you read: ntfy.sh without ?auth= refused, turned off as Laki updates', async t => {
  const rig = await fresh(t)
  await assert.rejects(rig.rpc('settingsSet', { webhook: { url: 'https://ntfy.sh/my-topic', format: 'ntfy', answer: true, replyTopic: 'r1' } }), /ntfy\.sh's topics are public/)
  await assert.rejects(rig.rpc('settingsSet', { webhook: { url: 'ntfy.sh/my-topic', answer: true } }), /ntfy\.sh's topics are public/) // ntfy by default; not even a URL
  await rig.rpc('settingsSet', { webhook: { url: 'https://ntfy.sh/my-topic?auth=tk_123', format: 'ntfy', answer: true, replyTopic: 'r1' } })
  await rig.rpc('settingsSet', { webhook: { url: 'https://ntfy.example/my-topic', format: 'ntfy', answer: true, replyTopic: 'r1' } }) // your own server
  await rig.rpc('settingsSet', { webhook: { url: 'https://ntfy.sh/my-topic', format: 'ntfy' } }) // answers off: fine
  // one from before: off as it loads, and Settings says why
  await rig.stop()
  const sp = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(sp, 'utf8'))
  st.settings.webhook = { url: 'https://ntfy.sh/my-topic', format: 'ntfy', answer: true, replyTopic: 'r1' }
  writeFileSync(sp, JSON.stringify(st))
  await rig.start()
  const w = (await rig.rpc('state')).settings.webhook
  assert.deepEqual([w.answer, w.answerOff], [false, true])
})

test('pushes: one per state change of a tab, done only when on, none when muted; Send test answers', async t => {
  const got: { title?: string; body: string }[] = []
  let status = 200
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => (got.push({ title: req.headers.title as string | undefined, body }), res.writeHead(status).end()))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`
  const rig = await fresh(t, { env: { LAKI_PUSH_WAIT_MS: '150' } }) // a wait's push 0.15 s on, not 0.8
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url, format: 'json' } }) // waiting on, done off: the defaults
  // until this turn's own words are on screen and the status says so: the tab is idle before a 'hi' starts, and a line
  // typed while the last turn goes on lands in it (its Stop after this one's wait)
  const say = async (text: string, status: string) => {
    const mark = text === 'ask' ? 'allow? (y/n)' : `answer: ${text}`
    const seen = async () => (await rig.screen(tab.id)).split(mark).length
    const was = await seen()
    await rig.rpc('input', { tab: tab.id, data: `${text}\r` })
    await until(async () => (await seen()) > was && (await rig.tab(ws.id)).status === status, status, 15000) // two hooks, each a node start (the fake waits 3 s for one)
  }
  const pushed = (n: number) => until(() => got.length >= n, `push ${n}`)
  const none = () => sleep(350) // for a push that mustn't come: it would be in by now (a wait's goes 150 ms later here, with its menu)
  const events = () => got.map(g => JSON.parse(g.body).event + ':' + JSON.parse(g.body).message)

  await say('hi', 'idle')
  await none()
  assert.deepEqual(events(), []) // done: off
  await say('ask', 'waiting')
  await pushed(1)
  await rig.rpc('hook', { tab: tab.id, state: 'waiting', payload: { message: 'needs permission' } }) // again: the same wait
  await none()
  assert.deepEqual(events(), [`waiting:claude in ${ws.id} is waiting for you\nneeds permission`])

  await rig.rpc('settingsSet', { webhook: { url, format: 'json', done: true } })
  await say('hi', 'idle')
  await pushed(2)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'answer: hi' } })
  await none()
  assert.deepEqual(events().slice(1), [`done:claude in ${ws.id} is done`])

  await rig.rpc('tabSet', { id: tab.id, muted: true })
  await say('ask', 'waiting')
  await none()
  assert.equal(got.length, 2) // muted: nothing

  assert.equal(await rig.rpc('webhookTest', { url, format: 'ntfy' }), true)
  assert.deepEqual(got.at(-1), { title: 'Laki: pushes reach you', body: 'Laki: pushes reach you' })
  status = 500
  await assert.rejects(rig.rpc('webhookTest', { url }), /the webhook answered 500/)
  await assert.rejects(rig.rpc('webhookTest', { url: 'ftp://example.com/x' }), /must start with https/)
  await assert.rejects(rig.rpc('webhookTest', { url: 'http://example.com/x' }), /must start with https/) // the question in the clear
  await assert.rejects(rig.rpc('webhookTest', {}), /needs a URL/)
})

test("answer from the phone: a workflow's Ask you pushed with its choices, a tap answers it and the run goes on; not once the app answered; no buttons without Answer from the phone", async t => {
  const posts: any[] = []
  const queue: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.startsWith('/topic-r1/json?poll=1')) return void res.writeHead(200).end(queue.splice(0).join('\n'))
      posts.push({ url: req.url, body, title: req.headers.title })
      res.writeHead(200).end()
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`
  const rig = await fresh(t)
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { webhook: { url, format: 'ntfy', answer: true, replyTopic: 'r1' } })
  await rig.rpc('flowSave', { id: 'pick', text: '# Pick\nruns in: main\n\n## start\ninput: task\nnext: q\n\n## q\nask: Ship it?\nshow: {{task}}\n- Yes → y\n- No → n\n\n## y\nend: success\n\n## n\nend: stopped\n' })
  const status = async (id: string) => (await rig.rpc('flowGet', { id })).status
  const pushes = () => posts.filter(x => x.url === '/').map(x => JSON.parse(x.body))

  const run = await rig.rpc('flowStart', { workflow: 'pick', project: proj.id, task: 'the CSV export' })
  const j = await until(() => pushes()[0], 'the push, as JSON to the root')
  assert.equal(j.title, 'Workflow Pick in repo asks you')
  assert.equal(j.message, 'Ship it?\nthe CSV export\n1. Yes\n2. No')
  assert.deepEqual(j.actions.map((a: any) => a.label), ['1. Yes', '2. No'])
  queue.push(JSON.stringify({ event: 'message', id: 'm1', message: j.actions[0].body }))
  await rig.rpc('phoneTick')
  await until(async () => (await status(run.id)) === 'done', 'the tap answered Yes, the run went on')
  assert.equal((await rig.rpc('flowGet', { id: run.id })).vars.answer, 'Yes')

  // answered in the app first: the tap after it does nothing, though the next question has the same choices
  await rig.rpc('flowSave', { id: 'two', text: '# Two\nruns in: main\n\n## start\ninput: task\nnext: q\n\n## q\nask: Ship it?\n- Yes → q2\n- No → n\n\n## q2\nask: Merge it?\n- Yes → y\n- No → n\n\n## y\nend: success\n\n## n\nend: stopped\n' })
  const two = await rig.rpc('flowStart', { workflow: 'two', project: proj.id, task: 'again' })
  const k = await until(() => pushes()[1], 'its push')
  await rig.rpc('flowAnswer', { id: two.id, n: 0 })
  const k2 = await until(() => pushes()[2], 'the next question’s push')
  assert.match(k2.message, /^Merge it\?/)
  queue.push(JSON.stringify({ event: 'message', id: 'm2', message: k.actions[1].body }))
  await rig.rpc('phoneTick')
  await sleep(300)
  assert.equal((await rig.rpc('flowGet', { id: two.id })).cur, 'q2', 'the old push’s No answered nothing')
  queue.push(JSON.stringify({ event: 'message', id: 'm3', message: k2.actions[0].body }))
  await rig.rpc('phoneTick')
  await until(async () => (await status(two.id)) === 'done', 'its own push’s Yes did')

  // without Answer from the phone: the choices as text, no buttons
  await rig.rpc('settingsSet', { webhook: { url, format: 'ntfy' } })
  await rig.rpc('flowStart', { workflow: 'pick', project: proj.id, task: 'plain' })
  const plain = await until(() => posts.find(x => x.url === '/topic' && x.body.includes('plain')), 'a text push')
  assert.equal(plain.title, 'Workflow Pick in repo asks you')
  assert.equal(plain.body, 'Ship it?\nplain\n1. Yes\n2. No')
  assert.equal(pushes().length, 3, 'no JSON with actions')
})

test('U8: Quiet (was Do not disturb): laki quiet; no push for a finish or an ask; ended, one notice says what waits and what finished; Stop all agents holds a queue', async t => {
  const got: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => (got.push(body), res.writeHead(200).end()))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const rig = await fresh(t, { env: { LAKI_PUSH_WAIT_MS: '150' } }) // a wait's push 0.15 s on, not 0.8
  // laki quiet: on for a length (Settings' default without one), off; nothing happened: no digest, so no card and no notification
  await rig.rpc('settingsSet', { quietMinutes: 120 })
  const q1 = await rig.cli('quiet')
  assert.equal(q1.code, 0, q1.err)
  assert.ok(Math.abs((await rig.rpc('state')).dnd.until - Date.now() - 120 * 60e3) < 60e3, 'the default: 2 hours')
  const q2 = await rig.cli('quiet', '30m')
  assert.match(q2.out, /^quiet until /)
  assert.ok(Math.abs((await rig.rpc('state')).dnd.until - Date.now() - 30 * 60e3) < 60e3, '30 minutes')
  assert.equal((await rig.cli('quiet', 'soon')).code, 1)
  assert.equal((await rig.cli('quiet', '0m')).code, 1, 'no length of 0')
  const q3 = await rig.cli('quiet', 'off')
  assert.match(q3.out, /nothing happened/)
  const v0 = await rig.rpc('state')
  assert.equal(v0.dnd, undefined)
  assert.equal(v0.digest, undefined, 'nothing happened: no summary')
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude', name: 'quiet' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`, format: 'json', done: true } })
  await connect(rig)
  const say = async (text: string, status: string) => {
    await rig.rpc('input', { tab: tab.id, data: `${text}\r` })
    await until(async () => (await rig.tab(ws.id)).status === status, status, 15000)
  }
  // Stop all agents: the turn under way gets Esc, what was queued for it waits for Resume queue
  await say('slow one', 'running')
  const sent = await rig.rpc('send', { target: tab.id, text: 'hi', whenIdle: true })
  assert.deepEqual((await rig.tab(ws.id)).queue, ['hi'], JSON.stringify([sent, (await rig.tab(ws.id)).status, await rig.screen(tab.id)]))
  await assert.rejects(rig.rpc('stopAll', { from: { ws: ws.id, tab: tab.id } }), /stop every agent's turn/)
  assert.deepEqual((await rig.rpc('stopAll', {})).stopped, [tab.id])
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'stopped')
  await sleep(500)
  const held = await rig.tab(ws.id)
  assert.deepEqual([held.queue, held.queueHeld], [['hi'], true])

  await assert.rejects(rig.rpc('dndSet', { minutes: 30, from: { ws: ws.id, tab: tab.id } }), /silence the user's notifications/)
  const { until: end } = await rig.rpc('dndSet', { minutes: 30 })
  assert.equal((await rig.rpc('state')).dnd.until, end)
  await sleep(500) // the stop's own push, if any, is in
  got.length = 0
  await rig.rpc('queueResume', { tab: tab.id }) // hi: a turn that ends meanwhile
  await until(async () => (t => !t.queue && !t.queueHeld && t.status === 'idle' && t.done)(await rig.tab(ws.id)), 'the queued one ran', 15000)
  await say('ask', 'waiting')
  await sleep(500) // a wait's push goes 150 ms later here: none comes while quiet
  assert.deepEqual(got, [])
  const r = await rig.rpc('dndSet', { off: true })
  assert.equal(r.ended, true)
  assert.ok(r.lines.some((l: string) => l.startsWith('Waits: quiet · claude')), r.lines.join(' | '))
  assert.ok(r.lines.some((l: string) => l.startsWith('Finished: quiet · claude')), r.lines.join(' | '))
  // the digest: kept in the view until its card is closed
  const d = (await rig.rpc('state')).digest
  assert.deepEqual(d.rows.map((x: any) => [x.kind, x.name, x.ws, x.tab]), [['wait', 'quiet · claude', ws.id, tab.id], ['done', 'quiet · claude', ws.id, tab.id]])
  assert.ok(d.since <= d.until)
  assert.equal((await rig.rpc('state')).dnd, undefined)
  assert.deepEqual(await rig.rpc('dndSet', { seen: true }), { seen: true })
  assert.equal((await rig.rpc('state')).digest, undefined)
  assert.deepEqual(await rig.rpc('dndSet', { off: true }), { ended: false })
})

// M4: Web Push, as a phone's browser would read it: RFC 8291 (aes128gcm) decrypted with the subscription's own key,
// RFC 8292's VAPID JWT checked against the key it names
test('push format webpush: encrypted for the subscription, a VAPID JWT for its service, the first and last choice as signed taps', () => {
  const ua = createECDH('prime256v1')
  ua.generateKeys()
  const auth = Buffer.from('0123456789abcdef')
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def', p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }
  assert.ok(subOk(sub))
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x']) assert.equal(subOk({ ...sub, endpoint }), false, endpoint)
  assert.ok(subOk({ ...sub, endpoint: 'https://web.push.apple.com/QGx' }) && subOk({ ...sub, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x' }))
  const v = vapidNew()
  const now = Date.parse('2026-11-11T12:00:00Z')
  const opts = [{ n: 1, label: 'Yes' }, { n: 2, label: "Yes, and don't ask again" }, { n: 3, label: 'No' }]
  const r = webPushRequest({ format: 'webpush' }, sub, { ...p, options: opts, nonce: '0123456789abcdef', key: 'k3y' }, v, now)
  assert.equal(r.url, sub.endpoint)
  const h = r.init.headers as Record<string, string>
  assert.deepEqual([h['content-encoding'], h['content-type'], h.ttl, h.urgency], ['aes128gcm', 'application/octet-stream', '86400', 'high'])
  // VAPID: t=<header.claims.sig>, k=<our public key>; signed by it, for the push service's origin, 12 hours
  const [, jwt, k] = /^vapid t=([^,]+), k=(\S+)$/.exec(h.authorization)!
  assert.equal(k, v.pub)
  const [head, claims, sig] = jwt.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' })
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://laki.sh' })
  const raw = Buffer.from(k, 'base64url')
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' })
  assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')))
  // the body: salt, record size, the sender's key, then one record only this subscription's key opens
  const body = r.init.body as Buffer
  const salt = body.subarray(0, 16)
  assert.equal(body.readUInt32BE(16), 4096)
  const as = body.subarray(21, 21 + body[20])
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32))
  const key = (info: string, n: number) => Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(`Content-Encoding: ${info}\0`), n))
  const rec = body.subarray(21 + body[20])
  const d = createDecipheriv('aes-128-gcm', key('aes128gcm', 16), key('nonce', 12))
  d.setAuthTag(rec.subarray(-16))
  const plain = Buffer.concat([d.update(rec.subarray(0, -16)), d.final()])
  assert.equal(plain.at(-1), 2, 'the last record')
  const msg = JSON.parse(plain.subarray(0, -1).toString())
  assert.equal(msg.title, 'claude in fix-login is waiting for you')
  assert.match(msg.body, /^Run rm -rf build\?\n1\. Yes\n/)
  assert.equal(msg.tag, 't1')
  assert.deepEqual(msg.actions.map((a: any) => a.title), ['Yes', 'No'], 'the first and the last')
  assert.deepEqual(tapOf(msg.actions[1].tap, 'k3y'), { nonce: '0123456789abcdef', n: 3 }, 'signed as ntfy\'s taps are')
  assert.equal(tapOf(msg.actions[1].tap, 'another key'), undefined)
  assert.equal(tapOf('0123456789abcdef:3', 'k3y'), undefined, 'unsigned: not a tap')
  // titles only: nothing off the screen, no buttons
  const t = webPushRequest({ format: 'webpush', detail: 'titles' }, sub, { ...p, options: opts, nonce: '0123456789abcdef', key: 'k3y' }, v, now)
  assert.notDeepEqual(t.init.body, r.init.body)
  // a long question in Chinese (3 bytes a character): cut by bytes, to what a push service takes (4096 encrypted)
  const long = webPushPayload({ format: 'webpush' }, { ...p, question: '允许运行这个命令吗？'.repeat(200), options: opts, nonce: '0123456789abcdef', key: 'k3y' })
  assert.ok(Buffer.byteLength(JSON.stringify(long)) <= PAYLOAD_MAX && long.body.length > 500, `${Buffer.byteLength(JSON.stringify(long))} bytes, ${long.body.length} characters`)
  assert.equal(long.actions.length, 2)
})

test('D4: remote access link in each format: the tap opens it (ntfy Click, Slack link, JSON url, Web Push data)', () => {
  const r = { event: 'remote', workspace: '', tab: '', agent: 'Laki', title: 'Laki: remote access is on: tap to open it', url: 'https://fake.trycloudflare.com/#t=abc' } as const
  assert.deepEqual(pushRequest({ format: 'ntfy' }, r).headers, { title: r.title, click: r.url })
  assert.match(JSON.parse(String(pushRequest({ format: 'slack' }, r).body)).text, /\n<https:\/\/fake\.trycloudflare\.com\/#t=abc\|Open it>$/)
  assert.equal(JSON.parse(String(pushRequest({ format: 'json' }, r).body)).url, r.url)
  assert.equal(webPushPayload({ format: 'webpush' }, r).url, r.url)
})

test("10a: Web Push carries the remote page's icon count (badge), 0 too; none given, none sent; the service worker sets it", async () => {
  assert.equal(webPushPayload({ format: 'webpush' }, { ...p, badge: 3 }).badge, 3)
  assert.equal(webPushPayload({ format: 'webpush' }, { ...p, badge: 0 }).badge, 0, 'cleared')
  assert.ok(!('badge' in webPushPayload({ format: 'webpush' }, p)))
  const main = readFileSync(new URL('../src/daemon/main.ts', import.meta.url), 'utf8')
  assert.match(main, /navigator\.setAppBadge\(d\.badge\) : navigator\.clearAppBadge\(\)/)
})

test('D4: remote access pushes its link to the phone when asked (off by default), never its PIN, never with anyone-with-the-link', async t => {
  const got: { head: string; body: string }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => (got.push({ head: JSON.stringify(req.headers), body }), res.writeHead(200).end()))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const rig = await fresh(t)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  await rig.rpc('settingsSet', { webhook: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`, format: 'json' } })
  const stop = () => rig.rpc('remoteStop')

  // off by default: nothing goes
  await rig.rpc('remoteStart', { hours: 1, pin: true })
  await sleep(300)
  assert.equal(got.length, 0)
  await stop()

  // on: the link as its url, a short text, no PIN anywhere in the request
  await rig.rpc('settingsSet', { remotePush: true })
  const on = (await rig.rpc('remoteStart', { hours: 1, pin: true })) as { link: string }
  const own = (await rig.rpc('stateOwn')).remote as { pin: string; link: string }
  await until(() => got.length === 1, 'the push')
  const b = JSON.parse(got[0].body)
  assert.equal(b.event, 'remote')
  assert.equal(b.url, on.link)
  assert.match(b.message, /^Laki: remote access is on \(its PIN is on your Mac\): tap to open it$/)
  assert.ok(!`${got[0].head}${got[0].body}`.includes(own.pin), 'never the PIN')
  // stopped by you: no push; stopped on its own (its time is up): one, with no link
  await stop()
  await sleep(200)
  assert.equal(got.length, 1)
  await rig.rpc('remoteStart', { hours: 1, pin: true })
  await until(() => got.length === 2, 'the second start')
  await rig.rpc('remoteTick', { now: Date.now() + 2 * 3600e3 })
  await until(() => got.length === 3, 'the stop')
  assert.deepEqual([JSON.parse(got[2].body).message, JSON.parse(got[2].body).url], ['Laki: remote access stopped: its time is up', undefined])

  // anyone with the link: never, the switch on or not
  await rig.rpc('remoteStart', { hours: 1, open: true })
  await sleep(300)
  assert.equal(got.length, 3)
  await stop()
})

test("#1: at the Mac a turn's end isn't pushed and an ask only if it still waits after a while; locked or Push anyway: at once", async t => {
  const got: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => (got.push(JSON.parse(body).event), res.writeHead(200).end()))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`
  const rig = await fresh(t, { env: { LAKI_PUSH_WAIT_MS: '150', LAKI_PUSH_HOLD_MS: '1200' } })
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url, format: 'json', done: true } })
  const turn = async (state: 'waiting' | 'idle') => {
    await rig.rpc('hook', { tab: tab.id, state: 'running' })
    await sleep(300) // a view between: a new turn, not the last one again (phone.ts pushed), under load too
    await rig.rpc('hook', { tab: tab.id, state, payload: state === 'waiting' ? { message: 'needs permission' } : { last_assistant_message: 'done' } })
  }
  assert.deepEqual(await rig.rpc('presence', { idle: 3, locked: false }), { atMac: true })
  await turn('idle')
  await sleep(500)
  assert.deepEqual(got, [], 'a turn that ends while you are here: the Mac only')
  await turn('waiting')
  await sleep(500)
  assert.deepEqual(got, [], 'an ask: held a while')
  await until(() => got.length === 1, 'still waiting after the hold: pushed', 5000)
  assert.deepEqual(got, ['waiting'])
  await turn('waiting')
  await sleep(300)
  await rig.rpc('hook', { tab: tab.id, state: 'running' }) // answered here meanwhile
  await sleep(1500)
  assert.equal(got.length, 1, 'answered on the Mac: dropped, never sent late')
  await turn('waiting')
  await sleep(300)
  await rig.rpc('dndSet', { minutes: 30 }) // Quiet while it's held
  await sleep(1500)
  assert.equal(got.length, 1, 'Quiet since the ask: not pushed when the hold ends')
  await rig.rpc('dndSet', { off: true })
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  await turn('waiting') // answered, then a new ask before the first one's hold ends: pushed once, after its own hold
  await sleep(200)
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  await sleep(150)
  await turn('waiting')
  await sleep(900)
  assert.equal(got.length, 1, "the first ask's hold doesn't push the second one early")
  await until(() => got.length === 2, 'the second ask, after its own hold', 5000)
  await sleep(1500)
  assert.equal(got.length, 2, 'once')
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  await rig.rpc('presence', { idle: 3, locked: true })
  await turn('idle')
  await until(() => got.length === 3, 'locked: away, pushed at once')
  await rig.rpc('presence', { idle: 500, locked: false })
  await turn('idle')
  await until(() => got.length === 4, 'idle past 2 minutes: away')
  await rig.rpc('presence', { idle: 1, locked: false })
  await rig.rpc('settingsSet', { pushAtMac: 'push' })
  await turn('idle')
  await until(() => got.length === 5, 'Push anyway')
  await assert.rejects(rig.rpc('settingsSet', { pushAfter: 1 }), /whole seconds, 10 to 3600/)
})
