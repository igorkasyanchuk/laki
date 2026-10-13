// Phone pushes (Settings › Phone pushes): each format's request, and a fake agent's turns against a local server.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { pushRequest, replies } from '../src/daemon/push.ts'
import { fresh, sleep, until } from './helpers.ts'

const p = { event: 'waiting', workspace: 'fix-login', tab: 't1', agent: 'claude', question: 'Run rm -rf build?' } as const

test('push formats: ntfy text with a Title, Slack and Telegram text, generic JSON', () => {
  const ntfy = pushRequest({ format: 'ntfy' }, p)
  assert.deepEqual(ntfy.headers, { title: 'claude in fix-login is waiting for you' })
  assert.equal(ntfy.body, 'Run rm -rf build?')
  assert.match((pushRequest({}, { ...p, workspace: 'café ☕' }).headers as Record<string, string>).title, /^=\?UTF-8\?B\?.+\?=$/) // ntfy by default; past ASCII: RFC 2047
  for (const format of ['slack', 'telegram'] as const) assert.deepEqual(JSON.parse(String(pushRequest({ format }, p).body)), { text: 'claude in fix-login is waiting for you\nRun rm -rf build?' })
  assert.equal(JSON.parse(String(pushRequest({ format: 'slack' }, { ...p, question: 'Overwrite <dir> & <!channel>?' }).body)).text.split('\n')[1], 'Overwrite &lt;dir&gt; &amp; &lt;!channel&gt;?')
  assert.equal(JSON.parse(String(pushRequest({ format: 'telegram', url: 'https://api.telegram.org/botT/sendMessage?chat_id=42' }, p).body)).chat_id, '42')
  assert.deepEqual(JSON.parse(String(pushRequest({ format: 'json' }, { ...p, event: 'done', question: undefined }, 5).body)), {
    event: 'done',
    workspace: 'fix-login',
    tab: 't1',
    agent: 'claude',
    message: 'claude in fix-login is done',
    ts: 5,
  })
})

test('push choices: as text in every format; with a nonce, Telegram buttons and ntfy actions (JSON, the first 3) to the reply topic', () => {
  const options = [1, 2, 3, 4].map(n => ({ n, label: `pick ${n}` }))
  const q = { ...p, options }
  assert.equal(pushRequest({ format: 'ntfy' }, q).body, 'Run rm -rf build?\n1. pick 1\n2. pick 2\n3. pick 3\n4. pick 4')
  assert.deepEqual(JSON.parse(String(pushRequest({ format: 'json' }, q, 5).body)).options, options)
  const tg = (nonce?: string) => JSON.parse(String(pushRequest({ format: 'telegram', url: 'https://api.telegram.org/botT/sendMessage?chat_id=42' }, { ...q, nonce }).body))
  assert.equal(tg().reply_markup, undefined)
  assert.deepEqual(tg('00112233aabbccdd').reply_markup.inline_keyboard[1], [{ text: '2. pick 2', callback_data: '00112233aabbccdd:2' }])
  const nt = JSON.parse(String(pushRequest({ format: 'ntfy', url: 'https://ntfy.sh/mine', replyTopic: 'xyz' }, { ...q, nonce: '00112233aabbccdd' }).body))
  assert.equal(nt.topic, 'mine')
  assert.equal(nt.actions.length, 3)
  assert.deepEqual(nt.actions[0], { action: 'http', label: '1. pick 1', url: 'https://ntfy.sh/mine-xyz', method: 'POST', body: '00112233aabbccdd:1', clear: true })
  assert.equal(typeof pushRequest({ format: 'ntfy', url: 'https://ntfy.sh/mine' }, { ...q, nonce: '00112233aabbccdd' }).body, 'string') // no reply topic: text
  const auth = JSON.parse(String(pushRequest({ format: 'ntfy', url: 'https://ntfy.example/mine?auth=XYZ', replyTopic: 'xyz' }, { ...q, nonce: '00112233aabbccdd' }).body))
  assert.equal(auth.actions[0].url, 'https://ntfy.example/mine-xyz?auth=XYZ') // the topic's auth goes with the tap
})

test('Telegram taps: callback queries from the webhook\'s chat only, each acknowledged, the offset moved past all', async t => {
  const asked: string[] = []
  const server = createServer((req, res) => {
    asked.push(req.url!)
    const updates = [
      { update_id: 7, callback_query: { id: 'q1', data: '00112233aabbccdd:2', message: { chat: { id: 42 } } } },
      { update_id: 8, callback_query: { id: 'q2', data: '00112233aabbccdd:1', message: { chat: { id: 99 } } } }, // someone else's chat
      { update_id: 9, message: { text: 'hi', chat: { id: 42 } } },
      { update_id: 10, callback_query: { id: 'q3', data: 'not a tap', message: { chat: { id: 42 } } } },
    ]
    res.writeHead(200).end(JSON.stringify({ ok: true, result: req.url!.includes('getUpdates') ? updates : true }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const w = { format: 'telegram' as const, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/botT0K/sendMessage?chat_id=42` }
  const r = await replies(w, '5')
  assert.deepEqual(r, { taps: [{ nonce: '00112233aabbccdd', n: 2 }], cursor: '11' })
  assert.match(asked[0], /^\/botT0K\/getUpdates\?offset=5&/)
  await until(() => asked.some(u => u === '/botT0K/answerCallbackQuery?callback_query_id=q1'), 'q1 acknowledged')
  assert.ok(!asked.some(u => u.includes('q2')), "another chat's tap isn't")
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
  const rig = await fresh(t)
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
  queue.push(JSON.stringify({ event: 'open', id: 'o' }), JSON.stringify({ event: 'message', id: 'm1', message: 'ffffffffffffffff:1' }), JSON.stringify({ event: 'message', id: 'm2', message: `${nonce}:3` }))
  await rig.rpc('phoneTick')
  await until(async () => /picked: No, and tell Claude/.test(await rig.screen(tab.id)), 'the tap picked 3')
  // the same menu again: the old tap's nonce is spent
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting again')
  queue.push(JSON.stringify({ event: 'message', id: 'm3', message: `${nonce}:1` }))
  await rig.rpc('phoneTick')
  await sleep(1200) // and answer holds a tab for a second after its Enter
  assert.doesNotMatch(await rig.screen(tab.id), /picked: Yes/)
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1, label: 'No' }), /asks something else now/)
})

test('answer from the phone: the webhook changed while a question waits (ntfy to Telegram), taps are read from the new one from its start', async t => {
  const asked: string[] = []
  let push = ''
  const updates: object[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => {
      asked.push(req.url!)
      if (req.method === 'POST' && req.url === '/') push = body
      const tg = req.url!.startsWith('/botT0K/')
      res.writeHead(200).end(tg ? JSON.stringify({ ok: true, result: req.url!.includes('getUpdates') ? updates.splice(0) : true }) : '')
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const rig = await fresh(t)
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url: `${base}/topic`, format: 'ntfy', answer: true, replyTopic: 'r1' } })
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  await until(() => push, 'the push with buttons')
  const nonce = JSON.parse(push).actions[0].body.split(':')[0]
  await rig.rpc('phoneTick')
  assert.ok(asked.some(u => u.startsWith('/topic-r1/json?poll=1&since=')), 'ntfy asked')
  // now Telegram: its updates from the start (offset 0), not from ntfy's place (a unix time); the old push's tap counts
  await rig.rpc('settingsSet', { webhook: { url: `${base}/botT0K/sendMessage?chat_id=42`, format: 'telegram', answer: true } })
  updates.push({ update_id: 7, callback_query: { id: 'q1', data: `${nonce}:2`, message: { chat: { id: 42 } } } })
  await rig.rpc('phoneTick')
  assert.match(asked.find(u => u.startsWith('/botT0K/getUpdates'))!, /offset=0&/)
  await until(async () => /picked: Yes, and don't ask/.test(await rig.screen(tab.id)), 'the tap picked 2')
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
  const rig = await fresh(t)
  const proj = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: proj.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url, format: 'json' } }) // waiting on, done off: the defaults
  const say = async (text: string, status: string) => {
    await rig.rpc('input', { tab: tab.id, data: `${text}\r` })
    await until(async () => (await rig.tab(ws.id)).status === status, status)
    await sleep(1000) // a push would be in by now (a wait's goes 800 ms later, with its menu)
  }
  const events = () => got.map(g => JSON.parse(g.body).event + ':' + JSON.parse(g.body).message)

  await say('hi', 'idle')
  assert.deepEqual(events(), []) // done: off
  await say('ask', 'waiting')
  await rig.rpc('hook', { tab: tab.id, state: 'waiting', payload: { message: 'needs permission' } }) // again: the same wait
  await sleep(300)
  assert.deepEqual(events(), [`waiting:claude in ${ws.id} is waiting for you\nneeds permission`])

  await rig.rpc('settingsSet', { webhook: { url, format: 'json', done: true } })
  await say('hi', 'idle')
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'answer: hi' } })
  await sleep(300)
  assert.deepEqual(events().slice(1), [`done:claude in ${ws.id} is done`])

  await rig.rpc('tabSet', { id: tab.id, muted: true })
  await say('ask', 'waiting')
  assert.equal(got.length, 2) // muted: nothing

  assert.equal(await rig.rpc('webhookTest', { url, format: 'ntfy' }), true)
  assert.deepEqual(got.at(-1), { title: 'Laki: pushes reach you', body: 'Laki: pushes reach you' })
  status = 500
  await assert.rejects(rig.rpc('webhookTest', { url }), /the webhook answered 500/)
  await assert.rejects(rig.rpc('webhookTest', { url: 'ftp://example.com/x' }), /must start with https/)
  await assert.rejects(rig.rpc('webhookTest', { url: 'http://example.com/x' }), /must start with https/) // the question in the clear
  await assert.rejects(rig.rpc('webhookTest', {}), /needs a URL/)
})
