// Phone pushes (Settings › Notifications webhook): each format's request, and a fake agent's turns against a local server.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { pushRequest } from '../src/daemon/push.ts'
import { fresh, sleep, until } from './helpers.ts'

const p = { event: 'waiting', workspace: 'fix-login', tab: 't1', agent: 'claude', question: 'Run rm -rf build?' } as const

test('push formats: ntfy text with a Title, Slack and Telegram text, generic JSON', () => {
  const ntfy = pushRequest({ format: 'ntfy' }, p)
  assert.deepEqual(ntfy.headers, { title: 'claude in fix-login is waiting for you' })
  assert.equal(ntfy.body, 'Run rm -rf build?')
  assert.match((pushRequest({}, { ...p, workspace: 'café ☕' }).headers as Record<string, string>).title, /^=\?UTF-8\?B\?.+\?=$/) // ntfy by default; past ASCII: RFC 2047
  for (const format of ['slack', 'telegram'] as const) assert.deepEqual(JSON.parse(String(pushRequest({ format }, p).body)), { text: 'claude in fix-login is waiting for you\nRun rm -rf build?' })
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
    await sleep(300) // a push would be in by now
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
  await assert.rejects(rig.rpc('webhookTest', {}), /needs a URL/)
})
