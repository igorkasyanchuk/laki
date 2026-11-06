// Reader view: a claude tab's chat from its transcript (meters.ts chatRead), read on as it grows; the same v: nothing new;
// no transcript: none; an agent's call refused.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const line = (o: object) => JSON.stringify(o) + '\n'

test("chatRead: a tab's chat as what was said, read on as it grows", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  assert.deepEqual(await rig.rpc('chatRead', { tab: tab.id }), { none: true }) // nothing written yet
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-r.jsonl')
  writeFileSync(file, line({ type: 'user', message: { content: 'Fix the total' } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'cart.ts' } }] } }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-r' } })
  const a = await until(async () => (r => r.said && r)(await rig.rpc('chatRead', { tab: tab.id })), 'its chat')
  assert.deepEqual(a.said, [{ who: 'you', text: 'Fix the total' }, { who: 'agent', text: 'Looking.' }, { who: 'tool', text: 'Read: cart.ts' }])
  assert.deepEqual(await rig.rpc('chatRead', { tab: tab.id, v: a.v }), { v: a.v }) // nothing new
  appendFileSync(file, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed: **rounding**.' }] } }))
  const b = await rig.rpc('chatRead', { tab: tab.id, v: a.v })
  assert.equal(b.said.at(-1).text, 'Fixed: **rounding**.')
  // from an agent's tab: refused
  await assert.rejects(rig.rpc('chatRead', { tab: tab.id, from: { tab: tab.id } }), /read a tab's chat/)
})

test('tabHandover: a codex tab beside the claude one, told to read a handover of the chat and the changes', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'chat-h.jsonl'), line({ type: 'user', message: { content: 'Fix the total' } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Rounded it in cart.ts.' }] } }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-h' } })
  await until(async () => (await rig.rpc('chatRead', { tab: tab.id })).said, 'its chat')
  writeFileSync(join(ws.path, 'cart.ts'), 'export const total = 1\n')
  await assert.rejects(rig.rpc('tabHandover', { tab: tab.id, to: 'claude' }), /the other one/)
  await assert.rejects(rig.rpc('tabHandover', { tab: tab.id, from: { tab: tab.id } }), /hand its chat to another agent/) // an agent's: the user's to do
  const r = await rig.rpc('tabHandover', { tab: tab.id })
  assert.equal(r.name, 'codex: continued')
  const md = readFileSync(r.file, 'utf8')
  assert.match(md, /^# Handover from Claude Code/)
  assert.match(md, /### The user\n\nFix the total/)
  assert.match(md, /### Claude Code\n\nRounded it in cart\.ts\./)
  assert.match(md, /- cart\.ts \(\+1 −0\)/)
  const tabs = (await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id)
  assert.deepEqual(tabs.map((x: any) => x.preset), ['claude', 'codex']) // the old one stays
  const prompt = await until(() => (f => existsSync(f) && (l => l.includes('"bin":"codex"') && l)(readFileSync(f, 'utf8')))(join(rig.home, 'fake.log')), 'codex started')
  assert.ok(String(prompt).includes(r.file), 'its prompt names the handover')
})

// a claude chat's lines: its transcript, read as the Reader does (its first turn over, so its end doesn't race)
async function chatTab(rig: any, session: string) {
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${session}.jsonl`)
  writeFileSync(file, '')
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: session } })
  return { tab, ws, add: (...o: object[]) => appendFileSync(file, o.map(line).join('')) }
}
const said = (rig: any, tab: string) => until(async () => (r => r.said?.length && r)(await rig.rpc('chatRead', { tab })), 'its chat')

test('Reader chips: subagents and background shells a claude chat started, until they end; a shell\'s output; its notices not yours; the status bar\'s Background', async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '300' } })
  const bgView = async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id).background
  const { tab, add } = await chatTab(rig, 'chat-bg')
  const out = join(rig.home, 'bx1.output')
  writeFileSync(out, 'listening on :3000\n')
  add(
    { type: 'user', message: { content: 'Review and run it' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { description: 'Review the diff', subagent_type: 'reviewer' } }, { type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'npm run dev', description: 'dev server', run_in_background: true } }, { type: 'tool_use', id: 'toolu_c', name: 'Agent', input: { description: 'Scan deps', run_in_background: true } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: `Command running in background with ID: bx1. Output is being written to: ${out}. You will be notified.` }] }, toolUseResult: { backgroundTaskId: 'bx1' } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_c', content: 'Async agent launched' }] }, toolUseResult: { isAsync: true, agentId: 'ag9', outputFile: join(rig.home, 'ag9.output') } },
  )
  let r = await said(rig, tab.id)
  assert.deepEqual(r.bg, [
    { id: 'toolu_a', kind: 'agent', name: 'Review the diff' },
    { id: 'bx1', kind: 'shell', name: 'dev server', cmd: 'npm run dev', out },
    { id: 'ag9', kind: 'agent', name: 'Scan deps', out: join(rig.home, 'ag9.output') },
  ])
  assert.deepEqual(await rig.rpc('bgOutput', { tab: tab.id, id: 'bx1' }), { text: 'listening on :3000\n', size: 19, cut: false })
  await assert.rejects(rig.rpc('bgOutput', { tab: tab.id, id: 'toolu_a' }), /no output/) // none said
  await assert.rejects(rig.rpc('bgOutput', { tab: tab.id, id: 'bx1', from: { tab: tab.id } }), /read a background task's output/)
  // the status bar's Background: read with the meters, Reader or not
  assert.deepEqual((await until(async () => (b => b?.now.length === 3 && b)(await bgView()), 'running in the view')).now.map((x: any) => x.id), ['toolu_a', 'bx1', 'ag9'])
  // the reviewer answered; the shell stopped; the background agent's notice says it's done: none left
  add(
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'Looks fine' }] } },
    { type: 'user', message: { content: '<task-notification>\n<task-id>bx1</task-id>\n<status>killed</status>\n</task-notification>' }, origin: { kind: 'task-notification' } },
    { type: 'queue-operation', content: '<task-notification>\n<task-id>ag9</task-id>\n<tool-use-id>toolu_c</tool-use-id>\n<status>completed</status>\n</task-notification>' },
  )
  r = await until(async () => (x => x.said && !x.bg && x)(await rig.rpc('chatRead', { tab: tab.id, v: r.v })), 'none left')
  const b = await until(async () => (x => x?.now.length === 0 && x)(await bgView()), 'ended in the view')
  assert.deepEqual([b.done, b.last.map((x: any) => x.name)], [3, ['Scan deps', 'dev server', 'Review the diff']])
  assert.ok(!r.said.some((x: any) => x.who === 'you' && x.text.includes('task-notification')), 'claude\'s notice isn\'t yours')
})

test("laki-ui: the skill's example is UI kit JSON the Reader draws (no errors)", async () => {
  const { uiCheck } = await import('../src/shared/widgetUi.ts')
  const src = readFileSync(new URL('../src/daemon/skill.ts', import.meta.url), 'utf8')
  const json = /\\`\\`\\`laki-ui\n([\s\S]*?)\n\\`\\`\\`/.exec(src)?.[1]
  assert.ok(json, 'the skill has an example')
  assert.deepEqual(uiCheck(JSON.parse(json!)).filter(x => x.level === 'error'), [])
})

test('MCP Apps: a call whose tool has an app shows it, its page with the CSP it declares, its own tool calls; off: none', async t => {
  const rig = await fresh(t)
  // a stdio MCP server in your Claude config: a tool with an app, one without
  const srv = join(rig.home, 'mcp-ui.cjs')
  writeFileSync(
    srv,
    `const out = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
require('readline').createInterface({ input: process.stdin }).on('line', l => {
  const m = JSON.parse(l)
  if (m.id === undefined || !m.method) return // a notice, or Laki's answer to its ask
  if (m.method === 'initialize') out({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'ui', version: '1' } } })
  else if (m.method === 'tools/list') out({ id: m.id, method: 'roots/list' }), out({ id: m.id, result: { tools: [{ name: 'chart', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: 'ui://ui/chart.html' } } }, { name: 'plain', inputSchema: { type: 'object' } }] } })
  else if (m.method === 'resources/read') out({ id: m.id, result: { contents: [{ uri: m.params.uri, mimeType: 'text/html;profile=mcp-app', text: '<p id=app>chart</p>', _meta: { ui: { csp: { connectDomains: ['https://api.example.com'], resourceDomains: ['https://cdn.example.com', 'javascript:alert(1)'] } } } }] } })
  else if (m.method === 'tools/call') out({ id: m.id, result: { content: [{ type: 'text', text: 'called ' + m.params.name + ' ' + JSON.stringify(m.params.arguments) }] } })
  else out({ id: m.id, error: { code: -32601, message: 'no' } })
})
`,
  )
  writeFileSync(join(rig.home, '.claude.json'), JSON.stringify({ mcpServers: { 'ui srv': { command: process.execPath, args: [srv] } } }))
  const { tab, ws, add } = await chatTab(rig, 'chat-mcp')
  add(
    { type: 'user', message: { content: 'Chart it' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__ui_srv__chart', input: { n: 3 } }, { type: 'tool_use', id: 'toolu_2', name: 'mcp__ui_srv__plain', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '3 bars' }] }, { type: 'tool_result', tool_use_id: 'toolu_2', content: 'plain' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Here it is.' }] } },
  )
  const r = await until(async () => (x => x.apps && x)(await rig.rpc('chatRead', { tab: tab.id })), 'its app')
  assert.equal(r.apps.length, 1)
  const a = r.apps[0]
  assert.deepEqual([a.id, a.at, a.server, a.tool, a.input, a.result], ['toolu_1', 1, 'ui_srv', 'chart', { n: 3 }, { content: [{ type: 'text', text: '3 bars' }] }])
  assert.equal(r.said[a.at].who, 'tool') // under its call's line
  const { port } = rig.info()
  const page = await fetch(`http://127.0.0.1:${port}${a.src}`)
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '<p id=app>chart</p>')
  const csp = page.headers.get('content-security-policy')!
  assert.match(csp, /^sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https:\/\/cdn\.example\.com;/)
  assert.match(csp, /connect-src https:\/\/api\.example\.com$/)
  assert.ok(!csp.includes('javascript'), 'only https origins')
  assert.equal((await fetch(`http://127.0.0.1:${port}${a.src.replace(/key=\w+/, 'key=x')}`)).status, 401)
  // its tool call (the Reader asks you first): to its server
  assert.deepEqual(await rig.rpc('mcpAppCall', { tab: tab.id, id: 'toolu_1', name: 'chart', arguments: { n: 4 } }), { content: [{ type: 'text', text: 'called chart {"n":4}' }] })
  await assert.rejects(rig.rpc('mcpAppCall', { tab: tab.id, id: 'toolu_1', name: 'chart', from: { tab: tab.id } }), /run an MCP App's tool/)
  await assert.rejects(rig.rpc('mcpAppCall', { tab: tab.id, id: 'nope', name: 'chart' }), /no such app/)
  // a server you turned off in Claude for this folder (its /mcp: disabledMcpServers): no app, no page
  writeFileSync(join(rig.home, '.claude.json'), JSON.stringify({ mcpServers: { 'ui srv': { command: process.execPath, args: [srv] } }, projects: { [ws.path]: { disabledMcpServers: ['ui srv'] } } }))
  assert.equal((await rig.rpc('chatRead', { tab: tab.id })).apps, undefined)
  assert.equal((await fetch(`http://127.0.0.1:${port}${a.src}`)).status, 404)
  writeFileSync(join(rig.home, '.claude.json'), JSON.stringify({ mcpServers: { 'ui srv': { command: process.execPath, args: [srv] } } }))
  // off: none
  await rig.rpc('settingsSet', { mcpApps: false })
  assert.equal((await rig.rpc('chatRead', { tab: tab.id })).apps, undefined)
  assert.equal((await fetch(`http://127.0.0.1:${port}${a.src}`)).status, 404) // an address it had: no page either
  await assert.rejects(rig.rpc('mcpAppCall', { tab: tab.id, id: 'toolu_1', name: 'chart' }), /no such app/)
})

test("chatRead: a failed call counts on its run, a stop marks what it stopped, a /clear's chat comes under a New session line", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input })
  writeFileSync(
    join(dir, 'chat-f.jsonl'),
    line({ type: 'user', message: { content: 'Run the tests' } }) +
      line({ type: 'assistant', message: { content: [use('t1', 'Bash', { command: 'npm test' }), use('t2', 'Read', { file_path: 'a.ts' })] } }) +
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'exit 1' }, { type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }) +
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'One fails.' }] } }) +
      line({ type: 'user', message: { content: 'Now deploy it' } }) +
      line({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
  )
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-f' } })
  const a = await until(async () => (r => r.said && r)(await rig.rpc('chatRead', { tab: tab.id })), 'its chat')
  assert.deepEqual(a.said, [
    { who: 'you', text: 'Run the tests' },
    { who: 'tool', text: 'Bash: npm test\nRead: a.ts', fail: 1 },
    { who: 'agent', text: 'One fails.' },
    { who: 'you', text: 'Now deploy it', stopped: true }, // no answer: the Reader's Edit and resend
  ])
  // /clear: the next chat's file, the earlier one kept above a New session line (none written yet: the line alone)
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-g' } })
  const b = await until(async () => (r => r.said?.at(-1)?.who === 'new' && r)(await rig.rpc('chatRead', { tab: tab.id })), 'the line')
  assert.equal(b.said.length, 5)
  writeFileSync(join(dir, 'chat-g.jsonl'), line({ type: 'user', message: { content: 'Start over' } }))
  const c = await until(async () => (r => r.said?.at(-1)?.text === 'Start over' && r)(await rig.rpc('chatRead', { tab: tab.id })), 'the new chat')
  assert.deepEqual(c.said.slice(3).map((x: any) => x.who), ['you', 'new', 'you'])
  // a handover (and a side chat) take the chat the agent has now, not the one before the /clear
  const md = readFileSync((await rig.rpc('tabHandover', { tab: tab.id })).file, 'utf8')
  assert.match(md, /### The user\n\nStart over/)
  assert.doesNotMatch(md, /Run the tests|Now deploy it/)
  await assert.rejects(rig.rpc('imageRead', { path: join(dir, 'a.png'), from: { tab: tab.id } }), /read a picture anywhere/) // the user's hover card's
})
