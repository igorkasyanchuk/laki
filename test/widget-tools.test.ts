// Extensions' actions as tools for agents (an action's tool): listed, called, asked first, per workspace
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

const make = (rig: any, id: string, m: object, files: Record<string, string> = {}) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
  for (const [n, t] of Object.entries(files)) writeFileSync(join(rig.data, 'widgets', id, n), t)
}
const tools = (rig: any) => {
  make(rig, 'dep', {
    name: 'Deploys',
    scope: 'workspace',
    ui: { type: 'button', label: 'Deploy', run: 'preview' },
    actions: {
      preview: {
        run: 'printf "deployed %s to %s" "$WIDGET_INPUT_SERVICE" "$LAKI_BRANCH"',
        tool: { description: "Deploy this workspace's branch to a preview URL", input: { service: { type: 'string', description: 'web or api', enum: ['web', 'api'] }, dry: 'boolean' }, required: ['service'] },
      },
    },
  }, { 'AGENTS.md': 'Use preview after the tests pass. Never for main.\n' })
  make(rig, 'g', {
    name: 'Greeter',
    actions: {
      hi: { run: 'echo "hi $WIDGET_INPUT_WHO"; echo "$WIDGET_ARG" >&2', tool: { description: 'Say hi', input: { who: 'string' }, ask: 'always' } },
      echo: { run: 'echo "echo $WIDGET_INPUT_TEXT"', tool: { description: 'Echo it', input: { text: 'string', tags: 'string[]' }, ask: 'never' } },
      nope: { run: 'echo partial; echo it broke >&2; exit 3', tool: { description: 'Fails', ask: 'never' } },
      stdin: { run: 'cat', tool: { description: 'Its input back', input: { a: 'string' }, ask: 'never' } },
      plain: 'echo a button',
    },
  })
}
const on = async (rig: any, ...ids: string[]) => {
  await rig.rpc('widgetReload')
  for (const id of ids) await rig.rpc('widgetSet', { id, on: true })
}
// the app's window: each toolAsk answered as told (null: left alone)
const asks = (app: any) => (n: number) => until(() => app.events.filter((e: any) => e.ev === 'toolAsk')[n], `ask ${n}`)

test('tools: listed and called, asked first per workspace or always, denied, timed out, nobody to ask', async t => {
  const rig = await fresh(t, { env: { LAKI_TOOL_WAIT: '700' } })
  tools(rig)
  await on(rig, 'dep', 'g')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'two' })

  // the list: each tool with its description, input and the extension's AGENTS.md
  const list = await rig.cli('widget', 'tools')
  assert.equal(list.code, 0, list.err)
  assert.match(list.out, /dep\.preview .*Deploy this workspace's branch/)
  assert.match(list.out, /service: string \(web\|api\), required/)
  assert.match(list.out, /Use preview after the tests pass/)
  assert.doesNotMatch(list.out, /g\.plain/, 'a plain action is no tool')
  const json = JSON.parse((await rig.cli('widget', 'tools', '--json')).out)
  const dep = json.find((x: any) => x.tool === 'dep.preview')
  assert.deepEqual(dep.input, { type: 'object', properties: { service: { type: 'string', description: 'web or api', enum: ['web', 'api'] }, dry: { type: 'boolean' } }, required: ['service'] })
  assert.equal(dep.ask, 'first')

  // nobody to ask; a tool that never asks runs anyway, its stdout back, stderr's last line on a failure
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'g', action: 'hi', input: { who: 'x' } }), /Laki's window isn't open: nobody to approve it/)
  const echo = await rig.cli('widget', 'tool', 'g', 'echo', '{"text": "yo"}')
  assert.equal(echo.out.trim(), 'echo yo')
  assert.deepEqual(await rig.rpc('widgetToolCall', { id: 'g', action: 'stdin', input: { a: 'x' } }), { ok: true, output: '{"a":"x"}' }, 'the input as JSON on stdin')
  const nope = await rig.cli('widget', 'tool', 'g', 'nope')
  assert.equal(nope.code, 1)
  assert.match(nope.out, /partial/)
  assert.match(nope.err, /it broke/)

  // input checked before anything runs or asks
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'db' }, from: { ws: a.id } }), /service: one of web, api/)
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: {}, from: { ws: a.id } }), /service is required/)
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web', dry: 'yes' }, from: { ws: a.id } }), /dry: true or false/)
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'g', action: 'echo', input: { tags: 'a' } }), /tags: a list of text/)
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web' } }), /per workspace: which one/)
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'g', action: 'plain', input: {} }), /no tool plain/)

  const app = await rig.connect()
  t.after(() => app.ws.close())
  const ask = asks(app)
  const answer = (req: string, allow: string) => rig.rpc('widgetToolAnswer', { req, allow })

  // first: asked once per workspace (Always), then not; another workspace asks again
  let call = rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web' }, from: { ws: a.id, tab: 'tab1' } })
  let q = await ask(0)
  assert.deepEqual([q.widget, q.action, q.name, q.ws, q.tab, q.input], ['dep', 'preview', 'Deploys', a.id, 'tab1', { service: 'web' }])
  assert.match(q.command, /printf "deployed/)
  await answer(q.req, 'always')
  assert.deepEqual(await call, { ok: true, output: `deployed web to ${a.branch}` })
  assert.deepEqual(await rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'api' }, from: { ws: a.id } }), { ok: true, output: `deployed api to ${a.branch}` })
  assert.equal(app.events.filter((e: any) => e.ev === 'toolAsk').length, 1, 'remembered in a')
  const run = (await rig.rpc('widgetRuns', { id: 'dep', ws: a.id })).runs[0]
  assert.equal(run.reason, 'tool:preview')
  assert.match(run.why, /allowed always/)
  assert.deepEqual((await rig.rpc('state')).widgets.find((w: any) => w.id === 'dep').tools, [{ action: 'preview', description: "Deploy this workspace's branch to a preview URL", ask: 'first', grants: [a.id] }])
  call = rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web' }, from: { ws: b.id } })
  await answer((await ask(1)).req, 'once')
  assert.equal((await call).output, `deployed web to ${b.branch}`)

  // always: every call; deny and no answer refuse
  call = rig.rpc('widgetToolCall', { id: 'g', action: 'hi', input: { who: 'bob' } })
  await answer((await ask(2)).req, 'once')
  assert.deepEqual(await call, { ok: true, output: 'hi bob\n' })
  call = rig.rpc('widgetToolCall', { id: 'g', action: 'hi', input: { who: 'bob' } })
  await answer((await ask(3)).req, 'deny')
  await assert.rejects(call, /denied/)
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'g', action: 'hi', input: { who: 'bob' } }), /no answer: not run/)

  // a grant revoked; off: no tools, its grants gone
  await rig.rpc('widgetGrantRm', { id: 'dep', action: 'preview', ws: a.id })
  assert.deepEqual((await rig.rpc('state')).widgets.find((w: any) => w.id === 'dep').tools[0].grants, [])
  call = rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web' }, from: { ws: a.id } })
  await answer((await ask(5)).req, 'always')
  await call
  await rig.rpc('widgetSet', { id: 'dep', on: false })
  assert.ok(!(await rig.rpc('widgetTools')).some((x: any) => x.id === 'dep'))
  await assert.rejects(rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web' }, from: { ws: a.id } }), /is off/)
  await rig.rpc('widgetSet', { id: 'dep', on: true })
  call = rig.rpc('widgetToolCall', { id: 'dep', action: 'preview', input: { service: 'web' }, from: { ws: a.id } })
  await ask(6) // asked again: its grants went with it
  await answer(app.events.filter((e: any) => e.ev === 'toolAsk')[6].req, 'once')
  await call

  // the starter: an add tool, asked first, its note in the data after
  assert.equal((await rig.cli('widget', 'new', 'Notes', '--kind', 'tool')).code, 0)
  assert.equal((await rig.cli('widget', 'check', 'notes')).code, 0)
  call = rig.cli('widget', 'tool', 'notes', 'add', '{"text": "say \\"hi\\""}', '--ws', a.id)
  await answer((await ask(7)).req, 'once')
  assert.equal((await call).out.trim(), 'Added. 1 notes now.')
  await until(async () => /say &quot;hi&quot;/.test(await rig.rpc('widgetRender', { id: 'notes' })), 'the note shown')

  // check: a tool's description, input, required, ask; AGENTS.md; never with an outward command
  make(rig, 'bad', { name: 'Bad', actions: { go: { run: 'git push origin HEAD', tool: { input: { n: 'integer' }, required: ['m'], ask: 'sometimes' } }, ship: { run: 'gh pr merge', tool: { description: 'Ship it', ask: 'never' } } } })
  await rig.rpc('widgetReload')
  const ps = (await rig.rpc('widgetCheck', { id: 'bad' })).problems.map((x: any) => `${x.level} ${x.where}: ${x.text}`).join('\n')
  for (const re of [/error widget\.json actions\.go\.tool: a description/, /error widget\.json actions\.go\.tool\.input\.n: string, number, boolean or string\[\]/, /error widget\.json actions\.go\.tool\.required: m isn't one of its input/, /error widget\.json actions\.go\.tool\.ask: always, first or never/, /warn widget\.json actions\.ship\.tool: ask never, but its command looks outward/, /warn AGENTS\.md: none/])
    assert.match(ps, re)
})

test('tools: laki mcp lists ext_ tools only with a daemon running, and routes calls; Laki AI calls one, asked first', async t => {
  const answers: object[] = []
  const hits: any[] = []
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    hits.push(JSON.parse(body))
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answers[hits.length - 1] ?? { error: { message: 'no more' } }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  tools(rig)
  await on(rig, 'g')
  const msgs = (...m: object[]) => m.map((x, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...x })).join('\n') + '\n'
  const mcp = async (...m: object[]) => (await rig.cliIn(msgs(...m), 'mcp')).out.trim().split('\n').map(l => JSON.parse(l)).sort((a, b) => a.id - b.id) // tool calls answer as they end
  let got = await mcp({ method: 'tools/list' }, { method: 'tools/call', params: { name: 'ext_g_echo', arguments: { text: 'yo' } } }, { method: 'tools/call', params: { name: 'laki_extension_call', arguments: { tool: 'g.echo', input: { text: 'there' } } } }, { method: 'tools/call', params: { name: 'laki_extension_tools', arguments: {} } })
  const names = got[0].result.tools.map((x: any) => x.name)
  assert.ok(names.includes('ext_g_echo') && names.includes('ext_g_hi') && names.includes('laki_extension_call'), names.join())
  assert.deepEqual(got[0].result.tools.find((x: any) => x.name === 'ext_g_echo').inputSchema, { type: 'object', properties: { text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: [] })
  assert.equal(got[1].result.content[0].text.trim(), 'echo yo')
  assert.equal(got[2].result.content[0].text.trim(), 'echo there')
  assert.match(got[3].result.content[0].text, /g\.hi/)
  await rig.stop()
  got = await mcp({ method: 'tools/list' })
  assert.ok(!got[0].result.tools.some((x: any) => x.name.startsWith('ext_')), 'no daemon: none, and none started')
  await rig.start()

  // Laki AI: laki_extension_call, the user asked first
  const reply = (message: object) => ({ model: 'm', choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })
  answers.push(reply({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'laki_extension_call', arguments: JSON.stringify({ tool: 'g.hi', input: { who: 'ai' } }) } }] }), reply({ content: 'Said hi.' }))
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const asked = rig.rpc('aiAsk', { text: 'say hi' })
  const q = await asks(app)(0)
  assert.equal(q.agent, 'Laki AI')
  await rig.rpc('widgetToolAnswer', { req: q.req, allow: 'once' })
  assert.deepEqual(await asked, { text: 'Said hi.' })
  assert.match(hits[1].messages.at(-1).content, /hi ai/)
  assert.match(hits[0].messages[0].content, /laki_extension_tools/, 'its instructions say so')
  await sleep(10)
})
