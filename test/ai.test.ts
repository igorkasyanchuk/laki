import assert from 'node:assert/strict'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { aiTotals } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

// a fake OpenRouter: each request to `answers`' next, recorded
async function openrouter(t: { after: (f: () => void) => void }, answers: object[]) {
  const hits: { auth?: string; body: any }[] = []
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    hits.push({ auth: q.headers.authorization, body: JSON.parse(body) })
    const a = answers[hits.length - 1] ?? { error: { message: 'no more answers' } }
    if ('slow' in a) return // never answers: a stop ends it
    r.writeHead('error' in a ? 400 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(a))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  return { hits, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }
}
const reply = (message: object, usage = { prompt_tokens: 100, completion_tokens: 10, cost: 0.002 }) => ({ model: 'anthropic/claude-sonnet-5.5', choices: [{ message }], usage })

test('ai: OpenRouter runs the laki tools until it answers; the key stays in its 0600 file; each ask is logged', async t => {
  const or = await openrouter(t, [
    reply({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'laki_state', arguments: '{}' } }] }),
    reply({ content: 'One project, no workspaces.' }),
    reply({ content: 'Still one.' }),
  ])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('projectAdd', { path: rig.repo })

  await assert.rejects(rig.rpc('aiAsk', { text: 'hi' }), /Laki AI is off/)
  await rig.rpc('settingsSet', { ai: { on: true } })
  await assert.rejects(rig.rpc('aiAsk', { text: 'hi' }), /no OpenRouter API key/)
  await assert.rejects(rig.rpc('aiKey', { key: 'two words' }), /does not look like an API key/)
  assert.deepEqual(await rig.rpc('aiKey', { key: ' sk-or-v1-abc123 ' }), { key: true })
  assert.equal(statSync(join(rig.data, 'ai-key')).mode & 0o777, 0o600)
  assert.ok(!JSON.stringify(await rig.rpc('state')).includes('sk-or-v1'), 'never in the view')

  const ws = await rig.connect()
  t.after(() => ws.close())
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'what are my agents doing?' }), { text: 'One project, no workspaces.' })
  assert.equal(or.hits[0].auth, 'Bearer sk-or-v1-abc123')
  const first = or.hits[0].body
  assert.equal(first.model, 'anthropic/claude-sonnet-5.5')
  assert.deepEqual(first.usage, { include: true })
  const names = first.tools.map((x: any) => x.function.name)
  for (const n of ['laki_state', 'laki_new_workspace', 'laki_send', 'laki_new_tab', 'laki_attach_pr', 'laki_screen', 'laki_diff']) assert.ok(names.includes(n), n)
  assert.ok(!names.includes('laki_progress') && names.includes('laki_schedule_add'))
  assert.equal(first.messages[0].role, 'system')
  assert.deepEqual(first.messages.at(-1), { role: 'user', content: 'what are my agents doing?' })
  // the tool's result went back to the model
  const tool = or.hits[1].body.messages.at(-1)
  assert.equal(tool.role, 'tool')
  assert.equal(tool.tool_call_id, 'c1')
  assert.equal(JSON.parse(tool.content).projects[0].path, realpathSync(rig.repo))

  let a = await rig.rpc('aiState')
  assert.deepEqual(a.chat.map((m: any) => [m.role, m.text]), [['user', 'what are my agents doing?'], ['tool', 'laki_state {}'], ['ai', 'One project, no workspaces.']])
  assert.equal(a.key, true)
  assert.equal(a.calls.length, 1)
  assert.deepEqual({ ...a.calls[0], at: 0, ms: 0 }, { at: 0, ms: 0, backend: 'openrouter', model: 'anthropic/claude-sonnet-5.5', in: 200, out: 20, cost: 0.004, tools: 1, ok: true, ask: 'what are my agents doing?' })
  assert.deepEqual(a.totals.today, { calls: 1, in: 200, out: 20, cost: 0.004 })
  await until(() => ws.events.some(e => e.ev === 'ai' && !e.busy && e.chat.length === 3), 'an ai event')

  // the next ask carries the conversation so far (asks and answers, not the tools)
  await rig.rpc('aiAsk', { text: 'and now?' })
  assert.deepEqual(or.hits[2].body.messages.slice(1).map((m: any) => [m.role, m.content]), [['user', 'what are my agents doing?'], ['assistant', 'One project, no workspaces.'], ['user', 'and now?']])

  // a failure is said in the chat and logged
  await assert.rejects(rig.rpc('aiAsk', { text: 'again' }), /OpenRouter: no more answers/)
  a = await rig.rpc('aiState')
  assert.deepEqual(a.chat.at(-1).role, 'error')
  assert.equal(a.calls[0].ok, false)
  assert.equal(a.totals.today.calls, 3)

  // the CLI: the log, the conversation, a new one; the key removed
  const log = await rig.cli('ai', 'log')
  assert.match(log.out, /today: 3 calls, 300 in \/ 30 out, \$0\.0060/)
  assert.match((await rig.cli('ai')).out, /> and now\?\nStill one\./)
  await rig.cli('ai', 'new')
  assert.deepEqual((await rig.rpc('aiState')).chat, [])
  assert.deepEqual(await rig.rpc('aiKey', { key: '' }), { key: false })
  assert.equal((await rig.rpc('aiState')).key, false)
})

test('ai: a pasted image goes to OpenRouter as a data URL; one from elsewhere never does; Stop ends an ask', async t => {
  const or = await openrouter(t, [reply({ content: 'Three PRs.' }), { slow: true }])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('settingsSet', { ai: { on: true, models: { openrouter: 'openai/gpt-5.6-sol' } } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const png = Buffer.from('fake png').toString('base64')
  const path = await rig.rpc('imageSave', { data: png })
  await rig.rpc('aiAsk', { text: 'review these', images: [path, join(rig.home, 'repo', 'README.md')] })
  const body = or.hits[0].body
  assert.equal(body.model, 'openai/gpt-5.6-sol')
  assert.deepEqual(body.messages.at(-1).content, [
    { type: 'text', text: 'review these' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
  ])
  assert.deepEqual((await rig.rpc('aiState')).chat[0].images, [path])

  const asking = rig.rpc('aiAsk', { text: 'hang' })
  await until(() => or.hits.length === 2, 'the second request')
  await assert.rejects(rig.rpc('aiAsk', { text: 'meanwhile' }), /still on the last ask/)
  await assert.rejects(rig.rpc('aiNew'), /at work/)
  assert.deepEqual(await rig.rpc('aiStop'), { stopped: true })
  await assert.rejects(asking, /stopped/)
  assert.equal((await rig.rpc('aiState')).busy, false)
})

test('ai: claude -p and codex exec reach Laki through `laki mcp`, and go on with their session', async t => {
  const rig = await fresh(t)
  await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'claude', models: { claude: 'haiku' } } })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'how many?' }), { text: '0 workspaces, asked: how many?' })
  await rig.rpc('aiAsk', { text: 'again' })
  const runs = rig.fakeLog().filter(l => l.bin === 'claude' && l.args[0] === '-p')
  assert.equal(runs.length, 2)
  const args: string[] = runs[0].args
  assert.equal(args[args.indexOf('--tools') + 1], 'Read')
  assert.ok(!args.includes('--add-dir'), 'no screenshot: no folder (it may not exist)')
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__laki')
  assert.equal(args[args.indexOf('--model') + 1], 'haiku')
  assert.ok(args.includes('--strict-mcp-config') && !args.includes('--resume'))
  assert.equal(runs[1].args[runs[1].args.indexOf('--resume') + 1], 'sess-p1')
  let a = await rig.rpc('aiState')
  assert.deepEqual(a.chat.slice(0, 3).map((m: any) => [m.role, m.text]), [['user', 'how many?'], ['tool', 'laki_state {}'], ['ai', '0 workspaces, asked: how many?']])
  assert.deepEqual({ ...a.calls[0], at: 0, ms: 0 }, { at: 0, ms: 0, backend: 'claude', model: 'fake-sonnet', in: 150, out: 20, cost: 0.0123, tools: 1, ok: true, ask: 'again' })
  await assert.rejects(rig.rpc('aiAsk', { text: 'fail now' }), /it broke/)
  // a preset of claude (Settings › AI): its env, over Settings' own, and a session of its own (another account's)
  await rig.rpc('settingsSet', { env: { TEST_GLOBAL: 'g', TEST_ACCOUNT: 'mine' }, presets: [{ name: 'claude', agent: 'claude' }, { name: 'work', agent: 'claude', env: { TEST_ACCOUNT: 'work' } }], ai: { on: true, backend: 'claude', preset: 'work' } })
  await rig.rpc('aiAsk', { text: 'at work' })
  const w = rig.fakeLog().filter(l => l.bin === 'claude' && l.args[0] === '-p').at(-1)
  assert.deepEqual(w.env, { TEST_GLOBAL: 'g', TEST_ACCOUNT: 'work' })
  assert.ok(!w.args.includes('--resume'), "the plain claude's session isn't the preset's")

  await rig.rpc('aiNew')
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'codex' } })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'projects?' }), { text: '1 projects, asked: projects?' })
  await rig.rpc('aiAsk', { text: 'more' })
  const cx = rig.fakeLog().filter(l => l.bin === 'codex' && l.args[0] === 'exec')
  assert.ok(cx[0].args.includes('sandbox_mode="read-only"') && cx[0].args[1] === '--json')
  assert.ok(cx[0].args.includes('--ignore-user-config'), "not the user's MCP servers")
  assert.deepEqual(cx[1].args.slice(0, 3), ['exec', 'resume', 'thread-x1'])
  a = await rig.rpc('aiState')
  assert.deepEqual({ ...a.calls[0], at: 0, ms: 0 }, { at: 0, ms: 0, backend: 'codex', model: 'codex', in: 300, out: 30, tools: 1, ok: true, ask: 'more' })
  await assert.rejects(rig.rpc('aiAsk', { text: 'fail' }), /it broke/)
  // the conversation is kept across a restart
  await rig.stop()
  await rig.start()
  assert.equal((await rig.rpc('aiState')).chat.length, 8) // 2 asks of 3, the failed one's ask and error
  assert.ok(readFileSync(join(rig.data, 'ai-calls.jsonl'), 'utf8').split('\n').filter(Boolean).length >= 6)
})

test('ai: totals by day and month', () => {
  const now = new Date(2026, 9, 10, 15)
  const c = (at: Date, cost?: number) => ({ at: at.getTime(), backend: 'openrouter' as const, model: 'm', in: 10, out: 1, cost, ms: 1, tools: 0, ok: true, ask: '' })
  const calls = [c(new Date(2026, 8, 30), 1), c(new Date(2026, 9, 1), 0.5), c(new Date(2026, 9, 10, 9), 0.25), c(new Date(2026, 9, 10, 10))]
  assert.deepEqual(aiTotals(calls, now), { today: { calls: 2, in: 20, out: 2, cost: 0.25 }, month: { calls: 3, in: 30, out: 3, cost: 0.75 } })
})

test('ai: laki_send reaches agents only, and never types into a question they ask', async t => {
  const rig = await fresh(t)
  await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: (await rig.rpc('state')).projects[0].id, prompt: 'hi', name: 'one' })
  const shell = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  await assert.rejects(rig.rpc('send', { target: `${ws.id}/${shell.id}`, text: 'echo pwned', agent: true }), /isn't an agent/)
  const agent = await rig.tab(ws.id)
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === agent.id).status === 'idle', 'the agent idle')
  await rig.rpc('send', { target: ws.id, text: 'menu', agent: true }) // the fake asks a permission
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === agent.id).status === 'waiting', 'the agent waiting')
  await assert.rejects(rig.rpc('send', { target: ws.id, text: '1', agent: true }), /asking the user something/)
  assert.deepEqual(await rig.rpc('send', { target: ws.id, text: 'later', agent: true, whenIdle: true }), { tab: agent.id, queued: 1 })
})
