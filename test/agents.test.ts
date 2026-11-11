// Each agent in the daemon: claude's hooks, codex's notify, grok's quiet screen, gemini's hooks, opencode's plugin.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

test('hooks drive status; queue delivered on Stop; done until viewed', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first task' })
  const tab = await rig.tab(ws.id)
  const watcher = await connect(rig)
  // the prompt runs a turn: running → idle (Stop), with its last answer, and ● since nobody looks
  await until(async () => (await rig.tab(ws.id)).last === 'answer: first task', 'Stop hook')
  let tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.equal(tv.done, true)
  assert.match(tv.resumeId, /^sess-/)
  assert.ok(watcher.events.some(e => e.ev === 'turn' && e.kind === 'done' && e.tab === tab.id))
  // viewing it clears ●
  await watcher.call('view', { tab: tab.id, focused: true })
  await until(async () => !(await rig.tab(ws.id)).done, 'done cleared')
  await watcher.call('view', { tab: null, focused: true })
  // waiting (permission prompt)
  await rig.rpc('send', { target: ws.id, text: 'ask me' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting')
  assert.ok(watcher.events.some(e => e.ev === 'turn' && e.kind === 'waiting'))
  // queue: sent when the agent is busy waits for the next Stop
  writeFileSync(join(rig.home, 'x'), '')
  const q1 = await rig.rpc('send', { target: ws.id, text: 'second', whenIdle: true })
  assert.equal(q1.queued, 1)
  const q2 = await rig.cli('send', `${ws.id}/claude`, '--when-idle', 'third')
  assert.match(q2.out, /queued \(2 waiting\)/)
  tv = await rig.tab(ws.id)
  assert.deepEqual(tv.queue, ['second', 'third'])
  // answer the prompt: a turn ends → "second" goes in, its Stop → "third"
  await rig.rpc('send', { target: ws.id, text: 'y' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: third', 'queue drained', 15000)
  tv = await rig.tab(ws.id)
  assert.equal(tv.queue, undefined)
  const s = await rig.screen(tab.id)
  assert.ok(s.indexOf('answer: second') < s.indexOf('answer: third'))
  // idle and empty queue: --when-idle sends right away
  const now = await rig.rpc('send', { target: ws.id, text: 'fourth', whenIdle: true })
  assert.equal(now.sent, true)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: fourth', 'fourth answered')
  // enter: false types into the prompt and leaves it there (the preview's picked element); an escape in the text
  // (one that would end the paste) is dropped
  await rig.rpc('send', { target: ws.id, text: 'the button main > a.cta \x1b[201~x\x03\x04', enter: false })
  await until(async () => (await rig.screen(tab.id)).includes('the button main > a.cta x'), 'in the prompt')
  await new Promise(r => setTimeout(r, 600))
  tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.equal(tv.last, 'answer: fourth') // no Enter, no turn
  watcher.close()
})

test("claude's Stop while its background subagents work: still running, no ●, no done notice, until its real Stop", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first task' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: first task', 'its first turn')
  const watcher = await connect(rig)
  await watcher.call('view', { tab: tab.id, focused: true }) // its first turn's ● seen
  await until(async () => !(await rig.tab(ws.id)).done, 'seen')
  await watcher.call('view', { tab: null, focused: true })
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'review it' } })
  const bg = [{ type: 'subagent', status: 'running' }, { type: 'shell', status: 'running' }]
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Started 2 reviewers.', background_tasks: bg } })
  await new Promise(r => setTimeout(r, 300))
  let tv = await rig.tab(ws.id)
  assert.deepEqual([tv.status, tv.done, tv.last], ['running', false, 'answer: first task'])
  assert.ok(!watcher.events.some(e => e.ev === 'turn' && e.kind === 'done'))
  // a background shell alone (a dev server) doesn't hold it: done
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'reviewer reports' } })
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'All reviewed.', background_tasks: [{ type: 'shell', status: 'running' }, { type: 'subagent', status: 'completed' }] } })
  tv = await until(async () => (x => x.status === 'idle' && x)(await rig.tab(ws.id)), 'its real Stop')
  assert.deepEqual([tv.done, tv.last], [true, 'All reviewed.'])
  assert.ok(watcher.events.some(e => e.ev === 'turn' && e.kind === 'done' && e.text === 'All reviewed.'))
  watcher.close()
})

test('codex: notify ends a turn and records the thread id', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'codex' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('fake codex'), 'codex up')
  const run = rig.fakeLog().find(l => l.bin === 'codex')
  assert.ok(run.args.some((a: string) => a.startsWith('notify=[')), 'notify passed with -c')
  await rig.rpc('send', { target: ws.id, text: 'hello codex' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: hello codex', 'notify hook')
  const tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.match(tv.resumeId, /^thread-/)
})

test('grok: Laki picks its chat id, a quiet screen ends its turn, a restart resumes the chat', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.ok((await rig.rpc('state')).presets.some((x: any) => x.name === 'grok'), 'an agent on PATH is a default preset')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'grok', prompt: 'hello grok' })
  const tab = await rig.tab(ws.id)
  assert.equal(tab.status, 'running')
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'grok'), 'grok up')
  assert.equal(run.args[0], '--session-id')
  assert.equal(run.args[1], tab.resumeId)
  assert.match(tab.resumeId, /^[0-9a-f-]{36}$/)
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle once its screen is quiet', 10000)
  // its title says when it asks, and when it's answered
  await rig.rpc('input', { tab: tab.id, data: 'ask to edit\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting: Action Required in its title', 6000)
  await rig.rpc('input', { tab: tab.id, data: 'y\r' })
  await until(async () => (await rig.tab(ws.id)).status !== 'waiting', 'answered', 6000)
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'grok').length === 2, 'grok restarted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'grok')[1].args, ['--resume', tab.resumeId])
})

test('gemini: its hooks (from Laki\'s system settings) give the session and the answer; a restart resumes it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'gemini', prompt: 'hello gemini' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'gemini'), 'gemini up')
  assert.deepEqual(run.args, ['-i', 'hello gemini']) // interactive: a bare prompt would answer and exit
  await until(async () => (await rig.tab(ws.id)).last === 'answer: hello gemini', 'AfterAgent hook')
  const tab = await rig.tab(ws.id)
  assert.equal(tab.status, 'idle')
  assert.match(tab.resumeId, /^gem-/)
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'gemini').length === 2, 'gemini restarted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'gemini')[1].args, ['--resume', tab.resumeId])
})

test('opencode: Laki\'s plugin reports its session and turns (not a subagent\'s), a restart resumes the session', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'opencode', prompt: 'hello opencode' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'opencode'), 'opencode up')
  assert.deepEqual(run.args, ['--prompt', 'hello opencode'])
  const id = (await until(async () => (await rig.tab(ws.id)).resumeId, 'session id from the plugin')) as string
  assert.match(id, /^ses_/)
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle from the plugin')
  const tab = await rig.tab(ws.id)
  assert.equal(tab.last, 'answer: hello opencode') // read from its session by the plugin
  // an error, then the idle after it: one end of turn, so the limit it set stays
  await rig.rpc('input', { tab: tab.id, data: 'hit the limit\r' })
  const hit = await until(async () => (await rig.tab(ws.id)).limit && (await rig.tab(ws.id)), 'limit from the error')
  await new Promise(r => setTimeout(r, 1500))
  assert.equal((await rig.tab(ws.id)).limit, hit.limit, 'the idle after the error keeps the limit')
  await rig.rpc('input', { tab: tab.id, data: 'ask first\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting on a permission')
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'opencode').length === 2, 'opencode restarted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'opencode')[1].args, ['--session', id])
})

test("opencode's model: in its inline config, not -m (some TUIs refuse it), over a profile's own config", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, name: 'glm', preset: 'opencode', model: 'openrouter/z-ai/glm-5.3', prompt: 'hi' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'opencode'), 'opencode up')
  assert.deepEqual([run.args, JSON.parse(run.config)], [['--prompt', 'hi'], { model: 'openrouter/z-ai/glm-5.3' }])
  await rig.rpc('settingsSet', { presets: [{ name: 'kimi', agent: 'opencode', model: 'openrouter/moonshotai/kimi-k3', env: { OPENCODE_CONFIG_CONTENT: '{"theme":"x","model":"old"}' } }] })
  await rig.rpc('wsNew', { project: p.id, name: 'kimi', preset: 'kimi', prompt: 'hi' })
  const two = await until(() => rig.fakeLog().filter(l => l.bin === 'opencode')[1], 'the profile one')
  assert.deepEqual(JSON.parse(two.config), { theme: 'x', model: 'openrouter/moonshotai/kimi-k3' })
  // one opencode doesn't know (it would start on its last used one, saying nothing): refused before anything is made, the close ones named
  const before = (await rig.rpc('state')).workspaces.length
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'guess', preset: 'opencode', model: 'openrouter/mistralai/mistral-large-4', prompt: 'hi' }), /opencode doesn't know the model openrouter\/mistralai\/mistral-large-4: [^]*close: openrouter\/mistralai\/mistral-large-4-0, openrouter\/mistralai\/mistral-large-2512/)
  assert.equal((await rig.rpc('state')).workspaces.length, before)
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'opencode', model: 'openrouter/nope/x' }), /doesn't know the model/)
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, preset: 'opencode', model: 'opencode/beam-free' })).model, 'opencode/beam-free')
  // its list is read as the tab would run it: a provider only Settings' env (a key) brings is known
  await rig.rpc('settingsSet', { env: { FAKE_OC_MORE: 'mine/own-model' } })
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, preset: 'opencode', model: 'mine/own-model' })).model, 'mine/own-model')
})

test("claude's PreToolUse and PostToolUse run in the background (async); a late one changes no state; a tool gate's tabs wait on PreToolUse", async t => {
  const rig = await fresh(t, { env: { FAKE_HOOK_DELAY: '400', FAKE_TURN_MS: '50' } })
  const hooks = (f: string) => JSON.parse(readFileSync(join(rig.data, f), 'utf8')).hooks
  const bg = (h: any) => ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit', 'PermissionRequest'].map(k => h[k][0].hooks[0].async ?? false)
  assert.deepEqual(bg(hooks('claude-settings.json')), [true, true, false, false, false])
  assert.deepEqual(bg(hooks('claude-settings-fast.json')), [true, true, false, false, false])
  assert.deepEqual(bg(hooks('claude-settings-gated.json')), [false, true, false, false, false]) // its PreToolUse may answer
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'claude-settings-fast-gated.json'), 'utf8')).fastMode, true)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  // a turn whose tool hooks come after its Stop (their input 400 ms late): idle it stays
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'tools 2' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: tools 2', 'Stop')
  assert.match(rig.fakeLog().find((l: any) => l.tab === tab.id).args.join(' '), /--settings \S+\/claude-settings\.json/) // no gate on
  await new Promise(r => setTimeout(r, 1200)) // the late ones in by now
  assert.equal((await rig.tab(ws.id)).status, 'idle')
  // by when each started: an older one is late, a newer one counts
  const at = Date.now() + 60_000
  await rig.rpc('hook', { tab: tab.id, state: 'waiting', payload: { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }, at })
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, at: at - 5 })
  assert.equal((await rig.tab(ws.id)).status, 'waiting', 'its PreToolUse, come after the ask it started before')
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, at: at + 100 })
  assert.equal((await rig.tab(ws.id)).status, 'waiting', 'started with the ask (its node a little later): still waiting')
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, at: at + 1000 })
  assert.equal((await rig.tab(ws.id)).status, 'running', 'answered: its tool ran')
})

// F6: what an agent sees, from fake config files under the test's HOME: claude's CLAUDE.md files and @imports in load
// order, its .claude.json's and .mcp.json's servers; codex's AGENTS.md files and config.toml's; env values, headers and
// tokens masked; refused for an agent
test("F6: agentContext lists an agent's rule files and MCP servers, masked; an agent can't read it", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = (f: string, text: string) => (mkdirSync(join(f, '..'), { recursive: true }), writeFileSync(f, text))
  w(join(rig.home, '.claude', 'CLAUDE.md'), 'Be brief.\n@~/.claude/style.md\n`@not/this.md`\n')
  w(join(rig.home, '.claude', 'style.md'), 'Short words.\n')
  w(join(rig.repo, 'CLAUDE.md'), '# Repo\n@docs/notes.md\n')
  w(join(rig.repo, 'docs', 'notes.md'), 'notes\n')
  w(join(rig.repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'npx', args: ['db-mcp', '--token', 'tok-xyz-123'], env: { DB_PASSWORD: 'sekret-1' } } } }))
  w(join(rig.home, '.claude.json'), JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://me:pw-999@mcp.example/x?api_key=plain777&page=2&sig=sig-888', headers: { Authorization: 'Bearer zzz-555' } } }, projects: { [realpathSync(rig.repo)]: { mcpServers: { mine: { command: 'node', args: ['srv.js', '--api-key=key-444', '-e', 'GITHUB_TOKEN=plain333'] } } } } }))
  w(join(rig.home, '.codex', 'AGENTS.md'), 'codex rules\n')
  w(join(rig.repo, 'AGENTS.md'), 'repo rules\n')
  w(join(rig.home, '.codex', 'config.toml'), 'model = "gpt-5"\n\n[mcp_servers.docs]\ncommand = "npx" # the runner\nargs = [\n  "-y",\n  "docs-mcp",\n]\n\n[mcp_servers.docs.env]\nDOCS_KEY = "sekret-2"\n\n[mcp_servers."web search"]\nurl = "https://search.example/mcp"\nenabled = false\n')

  const c = await rig.rpc('agentContext', { agent: 'claude', project: p.id })
  const repo = (x?: string) => x?.replace(realpathSync(rig.repo), '<repo>')
  const size = (f: string) => readFileSync(f).length
  assert.deepEqual(c.rules.map((r: any) => [repo(r.at), r.scope, r.size, repo(r.from)]), [
    ['~/.claude/CLAUDE.md', 'user', size(join(rig.home, '.claude', 'CLAUDE.md')), undefined],
    ['~/.claude/style.md', 'user', size(join(rig.home, '.claude', 'style.md')), '~/.claude/CLAUDE.md'],
    ['<repo>/CLAUDE.md', 'project', size(join(rig.repo, 'CLAUDE.md')), undefined],
    ['<repo>/docs/notes.md', 'project', 6, '<repo>/CLAUDE.md'],
  ])
  assert.deepEqual(c.servers.map((s: any) => [s.name, s.scope, s.transport]), [['mine', 'local', 'stdio'], ['db', 'project', 'stdio'], ['remote', 'user', 'http']])
  const db = c.servers.find((s: any) => s.name === 'db')
  assert.deepEqual([db.command, db.args, db.env], ['npx', ['db-mcp', '--token', '••••'], ['DB_PASSWORD']])
  assert.deepEqual(c.servers.find((s: any) => s.name === 'mine').args, ['srv.js', '--api-key=••••', '-e', 'GITHUB_TOKEN=••••'])
  assert.equal(c.servers.find((s: any) => s.name === 'remote').url, 'https://••••@mcp.example/x?api_key=••••&page=2&sig=••••') // by name: values that look like nothing
  assert.deepEqual(c.servers.find((s: any) => s.name === 'remote').headers, ['Authorization'])
  assert.equal(c.memory.global, 0)
  for (const x of ['tok-xyz-123', 'sekret-1', 'pw-999', 'plain777', 'sig-888', 'zzz-555', 'key-444', 'plain333']) assert.ok(!JSON.stringify(c).includes(x), x)

  const x = await rig.rpc('agentContext', { agent: 'codex', project: p.id })
  assert.deepEqual(x.rules.map((r: any) => [repo(r.at), r.scope]), [['~/.codex/AGENTS.md', 'user'], ['<repo>/AGENTS.md', 'project']])
  assert.deepEqual(x.servers, [
    { name: 'docs', scope: 'user', file: '~/.codex/config.toml', transport: 'stdio', command: 'npx', args: ['-y', 'docs-mcp'], env: ['DOCS_KEY'] },
    { name: 'web search', scope: 'user', file: '~/.codex/config.toml', transport: 'http', url: 'https://search.example/mcp', off: true },
  ])
  assert.ok(!JSON.stringify(x).includes('sekret-2'))

  // an agent's call: refused (its user's files, not its own); a path not on the list isn't opened
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'peek' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await assert.rejects(rig.rpc('agentContext', { agent: 'claude', project: p.id, from: { ws: ws.id, tab } }), /an agent can't read what an agent sees/)
  await assert.rejects(rig.rpc('agentContextOpen', { agent: 'claude', project: p.id, path: '/etc/hosts' }), /not one of its rule files/)
  await assert.rejects(rig.rpc('agentContext', { agent: 'gemini' }), /claude or codex/)
})
