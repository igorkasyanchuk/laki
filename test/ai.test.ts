import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { skillTools, tools } from '../src/cli/mcp.ts'
import { aiTotals } from '../src/shared/types.ts'
import { connect, fresh, until } from './helpers.ts'

// a fake OpenRouter: each request to `answers`' next, recorded
async function openrouter(t: { after: (f: () => void) => void }, answers: object[]) {
  const hits: { auth?: string; body: any }[] = []
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    hits.push({ auth: q.headers.authorization, body: JSON.parse(body) })
    const a = answers[hits.length - 1] ?? { error: { message: 'no more answers' } }
    if ('slow' in a) return // never answers: a stop ends it
    r.writeHead('status' in a ? Number(a.status) : 'error' in a ? 400 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(a))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  return { hits, answers, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } // answers: a test adds to it as it goes
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

test("voice: the cloud's recording goes to OpenRouter's speech-to-text with the AI's key; Settings › Voice picks the model", async t => {
  const busy = { status: 429, error: { code: 429, message: 'Provider returned error', metadata: { raw: 'rate-limited upstream' } } }
  const down = { status: 502, error: { code: 502, message: 'Provider returned error', metadata: { raw: { error: 'quota' } } } } // raw: the provider's JSON
  const or = await openrouter(t, [{ text: ' make the button blue ' }, { text: 'hi' }, { text: 'hi' }, { error: { message: 'model not found' } }, busy, { text: 'again' }, busy, busy, busy, ...Array(3).fill(down)])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url, LAKI_VOICE_AGAIN: '10,20' } }) // the waits before trying again, short
  const wav = Buffer.from('RIFF fake wav').toString('base64')
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /Voice is off: turn it on in Settings › General › Experimental/)
  await rig.rpc('settingsSet', { voice: { on: true } })
  await assert.rejects(rig.rpc('voiceText', {}), /no audio/)
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /no OpenRouter API key: Settings › Voice/)
  await rig.rpc('aiKey', { key: 'sk-or-v1-voice' })
  assert.deepEqual(await rig.rpc('voiceText', { audio: wav }), { text: 'make the button blue' })
  assert.equal(or.hits[0].auth, 'Bearer sk-or-v1-voice')
  assert.deepEqual(or.hits[0].body, { model: 'microsoft/mai-transcribe-2', input_audio: { data: wav, format: 'wav' } })
  await rig.rpc('settingsSet', { voice: { on: true, engine: 'cloud', model: 'openai/whisper-large-v3-turbo' } })
  await rig.rpc('voiceText', { audio: wav })
  assert.equal(or.hits[1].body.model, 'openai/whisper-large-v3-turbo')
  await rig.rpc('settingsSet', { voice: { on: true, engine: 'cloud', model: 5 } }) // not a string (an odd import): the default
  await rig.rpc('voiceText', { audio: wav })
  assert.equal(or.hits[2].body.model, 'microsoft/mai-transcribe-2')
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /OpenRouter 400: model not found$/)
  assert.deepEqual(await rig.rpc('voiceText', { audio: wav }), { text: 'again' }) // a 429, then tried again
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /OpenRouter 429: Provider returned error: rate-limited upstream \(microsoft\/mai-transcribe-2 is busy: try again in a moment, or another model in Settings › Voice\)/)
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /OpenRouter 502: Provider returned error: \{"error":"quota"\} \(/)
  const ws = await rig.connect() // the app's way: the socket takes 32 MB, HTTP 16
  t.after(() => ws.close())
  await assert.rejects(ws.call('voiceText', { audio: 'x'.repeat(25 << 20) }), /up to 9 minutes/)
  assert.equal(or.hits.length, 12) // 3 tries at most
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

test("ai: Laki's skill asks with options, writes memory, and removes only on the user's Yes", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [
    call('c1', 'laki_ask', { question: 'Which one?', options: ['alpha', 'beta'] }),
    reply({ content: 'Alpha it is.' }),
  ]) // more below: the project's id isn't known yet
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, memory: [{ id: 'm1', text: 'old note', at: 1 }] })
  await rig.rpc('settingsSet', { ai: { on: true, context: 'Our staging is on fly.io.' } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  await assert.rejects(rig.rpc('aiQuestion', { text: 'x', options: ['a', 'b'] }), /only while Laki AI works/)

  // a question: its options in the chat, the turn ends there; a pick goes on as the next ask
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'do the thing' }), { text: '' })
  const names = or.hits[0].body.tools.map((x: any) => x.function.name)
  for (const n of ['laki_ask', 'laki_remove', 'laki_prs', 'laki_project', 'laki_memory_write', 'laki_notes_write', 'laki_run_action', 'laki_templates', 'laki_shell', 'laki_run']) assert.ok(names.includes(n), n)
  assert.match(or.hits[0].body.messages[0].content, /laki_ask/, "the skill's words in its instructions")
  assert.match(or.hits[0].body.messages[0].content, /own instructions for you[^\n]*\nOur staging is on fly\.io\.$/, 'Your instructions, last')
  assert.equal(or.hits.length, 1, 'no round after the question')
  let a = await rig.rpc('aiState')
  const q = a.chat.at(-1)
  assert.deepEqual([q.role, q.text, q.ask.options], ['ai', 'Which one?', ['alpha', 'beta']])
  await assert.rejects(rig.rpc('aiAnswer', { id: q.ask.id, n: 5 }), /no such option/)
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 0 }), { text: 'Alpha it is.' })
  a = await rig.rpc('aiState')
  assert.equal(a.chat.find((m: any) => m.ask)?.ask.picked, 'alpha')
  assert.deepEqual(a.chat.slice(-2).map((m: any) => [m.role, m.text]), [['user', 'alpha'], ['ai', 'Alpha it is.']])
  await assert.rejects(rig.rpc('aiAnswer', { id: q.ask.id, n: 1 }), /answered already/)

  // memory written by a tool; a removal only asks, and Laki removes it on Yes
  or.answers.push(
    call('c2', 'laki_memory_write', { project: p.id, text: 'staging is on fly' }),
    reply({ content: 'Noted.' }),
    call('c3', 'laki_remove', { kind: 'memory', id: 'm1', project: p.id, label: 'the old note' }),
    call('c4', 'laki_remove', { kind: 'memory', id: 'm1', project: p.id, label: 'the old note' }),
  )
  await rig.rpc('aiAsk', { text: 'remember: staging is on fly' })
  const mem = () => rig.rpc('state').then((v: any) => v.projects[0].memory.map((m: any) => m.text))
  assert.deepEqual(await mem(), ['old note', 'staging is on fly'])
  await rig.rpc('aiAsk', { text: 'forget the old note' })
  a = await rig.rpc('aiState')
  const rm = a.chat.at(-1).ask
  assert.deepEqual(rm.options, ['Yes, remove the memory “old note”', 'No, keep it'])
  assert.deepEqual(await mem(), ['old note', 'staging is on fly'], 'not removed by the AI')
  assert.deepEqual(await rig.rpc('aiAnswer', { id: rm.id, n: 1 }), { kept: true })
  assert.deepEqual(await mem(), ['old note', 'staging is on fly'])
  await rig.rpc('aiAsk', { text: 'forget it, really' })
  const rm2 = (await rig.rpc('aiState')).chat.at(-1).ask
  assert.deepEqual(await rig.rpc('aiAnswer', { id: rm2.id, n: 0 }), { removed: true })
  assert.deepEqual(await mem(), ['staging is on fly'])
  assert.equal((await rig.rpc('aiState')).chat.at(-1).text, 'Removed the memory “old note”.')

  // a question left unanswered closes once you ask something else: its pick would come out of context
  or.answers.push(call('c5', 'laki_ask', { question: 'Which?', options: ['x', 'y'] }), reply({ content: 'ok' }))
  await rig.rpc('aiAsk', { text: 'pick one' })
  const q3 = (await rig.rpc('aiState')).chat.at(-1).ask
  await rig.rpc('aiAsk', { text: 'never mind' })
  await assert.rejects(rig.rpc('aiAnswer', { id: q3.id, n: 0 }), /a newer ask came since/)

  // the skill turned off: its tools go
  await rig.rpc('settingsSet', { ai: { on: true, skill: false } })
  or.answers.push(reply({ content: 'ok' }))
  await rig.rpc('aiAsk', { text: 'hi' })
  const off = or.hits.at(-1)!.body.tools.map((x: any) => x.function.name)
  assert.ok(!off.includes('laki_ask') && off.includes('laki_state'))
})

test("ai: prList, laki_prs's: a project's open PRs, yours or others', each with the workspace that has it", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const pr = (number: number, login: string) => ({ number, title: `PR ${number}`, author: { login }, url: `https://github.com/o/r/pull/${number}`, headRefName: `b${number}`, baseRefName: 'main', isDraft: false, reviewDecision: '', updatedAt: '2026-10-11T00:00:00Z' })
  mkdirSync(rig.env.FAKE_GH, { recursive: true })
  writeFileSync(join(rig.env.FAKE_GH, 'prlist.json'), JSON.stringify([pr(1, 'me'), pr(2, 'bob')]))
  const all = await rig.rpc('prList', { project: p.id })
  assert.deepEqual(all.map((x: any) => [x.number, x.author, x.mine, x.branch]), [[1, 'me', true, 'b1'], [2, 'bob', false, 'b2']])
  assert.deepEqual((await rig.rpc('prList', { project: p.id, who: 'others' })).map((x: any) => x.number), [2])
  await assert.rejects(rig.rpc('prList', { project: 'nope' }), /no project nope/)
})

test("ai: the skill's tools: templates and actions start workspaces, a shell gets a command typed, actions run, notes and renames", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', {
    templates: [{ name: 'careful', text: 'Be careful. {{prompt}}' }],
    actions: [{ name: 'review', target: 'claude', text: 'Review the code' }, { name: 'lint', target: 'shell', text: 'echo linted' }],
  })
  await rig.rpc('projectSet', { id: p.id, config: { templates: [{ name: 'careful', text: 'Project care: {{prompt}}' }] } })
  const [ask] = skillTools(rig.rpc)
  const tool = (name: string): ((a: object) => Promise<any>) => [...tools(rig.rpc), ...skillTools(rig.rpc)].find(x => x.name === name)!.run
  assert.equal(ask.name, 'laki_ask')
  assert.deepEqual((await tool('laki_templates')({ project: p.id })).map((x: any) => x.text), ['Project care: {{prompt}}'], "the project's replaces the global one of its name")
  assert.deepEqual((await tool('laki_actions')({ project: p.id })).map((x: any) => x.name), ['review', 'lint'])

  // a workspace from an action, through a template: the action's words, then what was asked
  const w = await tool('laki_new_workspace')({ project: p.id, action: 'review', template: 'careful', prompt: 'mind the auth', name: 'rv', local: true })
  await until(() => rig.fakeLog().some((l: any) => l.bin === 'claude' && l.args.includes('Project care: Review the code\n\nmind the auth')), 'the prompt')
  await assert.rejects(tool('laki_new_workspace')({ project: p.id, action: 'nope', prompt: 'x' }), /no agent action nope: review/)
  await assert.rejects(tool('laki_new_workspace')({ project: p.id, action: 'lint', prompt: 'x' }), /no agent action lint/, "a terminal's isn't an agent's")

  // a group: by its name (any case), first under it; laki_state names each project's groups and each workspace's
  await assert.rejects(tool('laki_new_workspace')({ project: p.id, prompt: 'x', group: 'Reviews' }), /no group Reviews in .*: it has none \(leave group out\)/)
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-rv', name: 'Reviews' }, { id: 'sep-ft', name: 'Features' }], rows: [w.id, 'sep-ft', 'sep-rv'] }) // w above both: in no group
  await assert.rejects(tool('laki_new_workspace')({ project: p.path, prompt: 'x', group: 'Bugs' }), /no group Bugs in .*: its groups are Reviews, Features/) // by its path too, as findProject
  const g = await tool('laki_new_workspace')({ project: p.id, prompt: 'review PR 7', name: 'rv7', group: 'reviews' })
  const st = await tool('laki_state')({})
  assert.deepEqual(st.projects.find((x: any) => x.id === p.id).groups, ['Reviews', 'Features'])
  assert.equal(st.workspaces.find((x: any) => x.id === g.id).group, 'Reviews')
  assert.equal(st.workspaces.find((x: any) => x.id === w.id).group, undefined)
  // an agent's laki mcp (its $LAKI_WORKSPACE): what it starts came from there, the prompt's PRs only related
  const spun: any = await tools(rig.rpc, g.id).find(x => x.name === 'laki_new_workspace')!.run({ project: p.id, prompt: 'fix what https://github.com/o/r/pull/7 broke', name: 'fx' })
  assert.deepEqual([spun.from, spun.prUrl, spun.related], [g.id, undefined, ['https://github.com/o/r/pull/7']])
  const st2 = await tool('laki_state')({})
  assert.deepEqual([st2.workspaces.find((x: any) => x.id === spun.id).from, st2.workspaces.find((x: any) => x.id === spun.id).related], [g.id, ['https://github.com/o/r/pull/7']])

  // a shell action runs in a new shell tab; an agent's goes to the agent there
  const tabs0 = (await rig.rpc('state')).tabs.length
  await tool('laki_run_action')({ ws: w.id, name: 'lint' })
  assert.equal((await rig.rpc('state')).tabs.length, tabs0 + 1)

  // a shell with a command typed, not run (Enter is the user's)
  const sh = await tool('laki_shell')({ ws: w.id, command: 'echo typed-not-run' })
  assert.deepEqual([sh.workspace, sh.typed], [w.id, true])
  const screen = await until(() => rig.rpc('screen', { target: `${w.id}/${sh.tab}`, lines: 10 }).then((x: any) => (JSON.stringify(x).includes('echo typed-not-run') ? x : null)), 'the command typed')
  assert.doesNotMatch(JSON.stringify(screen), /\\ntyped-not-run/, 'not run')
  // run when asked: in a new shell, then again in that same tab; an agent's tab gets it as a message
  const sh2 = await tool('laki_shell')({ ws: w.id, command: 'echo ran-$((40+2))', run: true })
  assert.equal(sh2.ran, true)
  await until(() => rig.rpc('screen', { target: sh2.tab, lines: 10 }).then((x: string) => x.includes('ran-42')), 'run in a new shell')
  const again = await tool('laki_run')({ tab: sh2.tab, text: 'echo again-$((1+1))' })
  assert.equal(again.sent, true)
  await until(() => rig.rpc('screen', { target: sh2.tab, lines: 10 }).then((x: string) => x.includes('again-2')), 'run in the same tab')
  const agentTab = (await rig.rpc('state')).tabs.find((t: any) => t.workspace === w.id && t.kind === 'agent')
  const msg = await tool('laki_run')({ tab: `${w.id}/${agentTab.id}`, text: 'look again' })
  assert.ok(msg.sent || msg.queued, 'sent, or queued until its turn ends')
  await assert.rejects(tool('laki_run')({ tab: 'nope', text: 'x' }), /no tab nope/)
  await assert.rejects(tool('laki_run')({ tab: sh2.tab, text: '  ' }), /the text is empty/)
  // a half-typed line is cleared first; a shell busy with a command takes nothing (it would go to that program)
  await rig.rpc('send', { target: sh2.tab, text: 'echo half', enter: false })
  await rig.rpc('input', { tab: sh2.tab, data: '\x1b[D\x1b[D' }) // the cursor back into the line: all of it goes all the same
  await tool('laki_run')({ tab: `${w.id}/${(await rig.rpc('state')).tabs.find((t: any) => t.id === sh2.tab).name}`, text: 'echo clean-$((2+3))' }) // by its name
  const cleaned = (await until(() => rig.rpc('screen', { target: sh2.tab, lines: 10 }).then((x: string) => (x.includes('clean-5') ? x : null)), 'run on a cleared line')) as string
  assert.doesNotMatch(cleaned, /halfecho|ececho|lfecho|5lf/, 'the half-typed words went, both sides of the cursor')
  const app = await connect(rig) // shells are scanned for a running command while the app is open
  await tool('laki_run')({ tab: sh2.tab, text: 'sleep 30' })
  await until(() => rig.rpc('state').then((v: any) => v.tabs.find((t: any) => t.id === sh2.tab).status === 'running'), 'the shell busy')
  await assert.rejects(tool('laki_run')({ tab: sh2.tab, text: 'ls' }), /is running something/)
  app.ws.close()

  // notes: added to the end, or replaced; a workspace renamed
  await tool('laki_notes_write')({ project: p.id, text: 'one' })
  await tool('laki_notes_write')({ project: p.id, text: 'two' })
  assert.equal((await rig.rpc('state')).projects[0].notes, 'one\n\ntwo')
  await tool('laki_notes_write')({ project: p.id, text: 'only', replace: true })
  assert.equal((await rig.rpc('state')).projects[0].notes, 'only')
  await tool('laki_rename')({ ws: w.id, name: 'review auth', pinned: true })
  const ws = (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id)
  assert.deepEqual([ws.name, ws.pinned], ['review auth', true])
  await assert.rejects(tool('laki_memory_write')({ project: p.id, text: 'x', id: 'nope' }), /no memory item nope/)
})
