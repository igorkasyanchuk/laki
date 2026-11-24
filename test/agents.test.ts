// Each agent in the daemon: claude's hooks, codex's notify, grok's quiet screen, agy's OSC 7501, opencode's plugin.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { agentRuns, agyResume } from '../src/daemon/core.ts'
import { connect, fresh, sleep, until } from './helpers.ts'

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
  await sleep(600)
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
  await sleep(300)
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
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'grok')[1].args.slice(0, 3), ['--resume', tab.resumeId, '--rules']) // Laki's note each start: memory test below
})

test('grok, agy and opencode: a scheduled task, a workflow agent block and sleep each work as for claude', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true, scheduleAtOnce: 0, sleepAfter: 60 })
  for (const [a, bin] of [['grok', 'grok'], ['gemini', 'agy'], ['opencode', 'opencode']]) {
    // a scheduled task: a new workspace with this agent and the prompt
    const s = await rig.rpc('scheduleSet', { project: p.id, preset: a, ws: 'new', prompt: `nightly ${a}`, when: 'every day at 2am' })
    const r = await rig.rpc('scheduleRun', { id: s.id })
    const tab = await until(async () => (x => x?.preset === a && x)(await rig.tab(r.ws)), `${a}'s scheduled tab`)
    await until(async () => (await rig.screen(tab.id)).includes(`answer: nightly ${a}`), `${a} got the scheduled prompt`)
    // asleep once idle and unlooked at; a message resumes its chat (agy, its workspace's only one, by -c until it says its id)
    await until(async () => (await rig.tab(r.ws)).status === 'idle', `${a} idle`, 15000)
    const id = (await rig.tab(r.ws)).resumeId
    assert.ok((await rig.rpc('sleepTick', { now: Date.now() + 2 * 3600e3 })).includes(tab.id), `${a} asleep`) // the last agent's workflow tab too
    const starts = () => rig.fakeLog().filter(l => l.bin === bin && l.tab === tab.id)
    const n = starts().length
    await rig.rpc('send', { target: tab.id, text: 'again' })
    await until(() => starts().length === n + 1, `${a} resumed`)
    assert.deepEqual(starts().at(-1).args.slice(0, 2), a === 'grok' ? ['--resume', id] : a === 'opencode' ? ['--session', id] : id ? [`--conversation=${id}`] : ['-c'])
    // a workflow's agent block: its turn's end goes on to the next block
    await rig.rpc('flowSave', { id: `w-${a}`, text: `# W\nruns in: main\n\n## start\ninput: task\nnext: one\n\n## one\nagent: ${a}\n> do {{task}}\nnext: e\n\n## e\nend: success\n` })
    const run = await rig.rpc('flowStart', { workflow: `w-${a}`, project: p.id, task: 'x' })
    const done = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: run.id })), `${a}'s workflow done`, 20000)
    assert.ok(done.log.some((l: string) => l.includes(`one: a new ${a} tab`)) && done.log.some((l: string) => /one → next: /.test(l)), done.log.join('\n'))
  }
})

test("agy's exit line: the last conversation id on screen is its chat; agy typed in a shell is the gemini agent", () => {
  assert.equal(agyResume('Bye\r\nResume with -c (or command below): agy --conversation=4f1c2b9e-77aa-4d0e-9c1d-2b6f0e5a1c33\r\n'), '4f1c2b9e-77aa-4d0e-9c1d-2b6f0e5a1c33')
  assert.equal(agyResume('agy --conversation=old-one-1\nagy --conversation=new-one-2\n'), 'new-one-2')
  assert.equal(agyResume('agy --conversation=x\nno id here'), undefined) // under 6 characters: not one
  assert.equal(agyResume('Goodbye'), undefined)
  assert.equal(agentRuns('/Users/me/.local/bin/agy -c'), 'gemini')
  assert.equal(agentRuns('gemini -i hi'), 'gemini')
})

test('agy (the gemini agent): no hooks, its OSC 7501 says each turn and ask; the chat it printed as it exited resumes', async t => {
  const rig = await fresh(t, { env: { LAKI_SWEEP_MS: '300' } }) // the screen sweep every 0.3 s, not 2
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.ok((await rig.rpc('state')).presets.some((x: any) => x.name === 'gemini'), 'agy on PATH: a default preset')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'gemini', prompt: 'hello agy' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'agy'), 'agy up')
  assert.deepEqual([run.args.length, run.args[0]], [2, '-i']) // interactive: -p would answer and exit
  assert.match(run.args[1], /^Background rules from Laki[^]*\n```\n\nhello agy$/) // Laki's note in front of a new chat's first message
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('answer: hello agy'), 'its answer')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle: state=done', 3000) // not 8 s of a quiet screen
  // blocked: waiting, and it stays so while the screen sweep (2 s) would read a quiet title as answered
  await rig.rpc('input', { tab: tab.id, data: 'ask to edit\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting: state=blocked')
  await sleep(1000) // three sweeps (every 0.3 s here): still waiting
  assert.equal((await rig.tab(ws.id)).status, 'waiting')
  await rig.rpc('input', { tab: tab.id, data: '1\r' })
  await until(async () => (await rig.screen(tab.id)).includes('answer: allowed ask to edit'), 'answered')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle again')
  // state=error: a failed turn, said on the tab
  await rig.rpc('send', { target: tab.id, text: 'fail please' })
  await until(async () => /Antigravity said its turn failed/.test((await rig.tab(ws.id)).failed ?? ''), 'failed: state=error')
  // a send it takes no turn for (a /command: no report): running, then idle once its screen is quiet
  await rig.rpc('send', { target: tab.id, text: '/help' })
  assert.equal((await rig.tab(ws.id)).status, 'running')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle: a quiet screen, its last report done', 10000)
  // it exits: the id on its last line is the tab's chat, and a restart opens it
  await rig.rpc('input', { tab: tab.id, data: 'exit\r' })
  await until(async () => /^agy-/.test((await rig.tab(ws.id)).resumeId ?? ''), 'its conversation id')
  const id = (await rig.tab(ws.id)).resumeId
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id).status === 'exited', 'exited')
  await rig.rpc('input', { tab: tab.id, data: '\r' }) // Enter on an ended agent starts it again
  await until(() => rig.fakeLog().filter(l => l.bin === 'agy').length === 2, 'agy again')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'agy')[1].args, [`--conversation=${id}`])
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
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'the idle after it')
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
  assert.deepEqual([run.args, JSON.parse(run.config).model, JSON.parse(run.config).instructions.length], [['--prompt', 'hi'], 'openrouter/z-ai/glm-5.3', 1]) // and Laki's note as its instructions
  await rig.rpc('settingsSet', { presets: [{ name: 'kimi', agent: 'opencode', model: 'openrouter/moonshotai/kimi-k3', env: { OPENCODE_CONFIG_CONTENT: '{"theme":"x","model":"old"}' } }] })
  await rig.rpc('wsNew', { project: p.id, name: 'kimi', preset: 'kimi', prompt: 'hi' })
  const two = await until(() => rig.fakeLog().filter(l => l.bin === 'opencode')[1], 'the profile one')
  assert.deepEqual((({ instructions, ...o }) => [o, instructions.length])(JSON.parse(two.config)), [{ theme: 'x', model: 'openrouter/moonshotai/kimi-k3' }, 1])
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
  await sleep(700) // the late ones in by now (FAKE_HOOK_DELAY: 0.4 s)
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

// How long a turn usually takes: each clean end's working time (an ask's wait out) by its hooks' at, per project and
// profile; a running tab carries the median once 5 turns of 20 s or more ended
test("usual: after 5 turns a running claude tab's view carries the median of their working time, asks' waits out", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(() => rig.tab(ws.id), 'its tab')
  const base = Date.now() + 60_000
  const hook = (state: string, hook_event_name: string, at: number) => rig.rpc('hook', { tab: tab.id, state, payload: { hook_event_name, ...(hook_event_name === 'UserPromptSubmit' && { prompt: 'go' }) }, at })
  // worked: 60, 90, 120, 150, 180 s, each after a 60 s wait on an ask; then a 10 s one, too short to count
  const turn = async (n: number, worked: number) => {
    const at = base + n * 600_000
    await hook('running', 'UserPromptSubmit', at)
    await hook('waiting', 'PermissionRequest', at + 5_000)
    await hook('running', 'PostToolUse', at + 65_000)
    await hook('idle', 'Stop', at + 60_000 + worked * 1000)
  }
  for (const [n, worked] of [60, 90, 120, 150].entries()) await turn(n, worked)
  await hook('running', 'UserPromptSubmit', base + 4 * 600_000)
  assert.equal((await rig.tab(ws.id)).usual, undefined, '4 turns: too few')
  await hook('idle', 'Stop', base + 4 * 600_000 + 180_000) // the 5th: 180 s, no ask
  await turn(5, 10)
  await hook('running', 'UserPromptSubmit', base + 6 * 600_000)
  const now = await rig.tab(ws.id)
  assert.equal(now.status, 'running')
  assert.equal(now.usual, 120)
  await hook('idle', 'Stop', base + 6 * 600_000 + 1000)
  assert.equal((await rig.tab(ws.id)).usual, undefined, 'idle: none')
})

// the fakes echo their arguments and the prompt unless FAKE_SCRIPT (the demo's, for the README's stills) is set:
// then the real one's look and the file's summary, the same hooks. No other test may lean on the scripted mode
test('the fakes echo; FAKE_SCRIPT is the demo only', async t => {
  const plain = await fresh(t)
  const p = await plain.rpc('projectAdd', { path: plain.repo })
  const ws = await plain.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'say hi' })
  await until(async () => (await plain.tab(ws.id)).last === 'answer: say hi', 'its echo')
  assert.match(await plain.screen((await plain.tab(ws.id)).id), /fake claude/)
  const file = join(plain.home, 'scripts.json')
  writeFileSync(file, JSON.stringify({ '*': { lines: ['⏺ Read(src/cart.js)'], summary: 'Totals round to cents.' } }))
  const demo = await fresh(t, { env: { FAKE_SCRIPT: file } })
  const q = await demo.rpc('projectAdd', { path: demo.repo })
  const w = await demo.rpc('wsNew', { project: q.id, preset: 'claude', prompt: 'say hi' })
  await until(async () => (await demo.tab(w.id)).last === 'Totals round to cents.', 'its summary')
  const screen = await demo.screen((await demo.tab(w.id)).id)
  assert.match(screen, /Welcome to Claude Code[\s\S]*> say hi[\s\S]*Read\(src\/cart\.js\)[\s\S]*⏺ Totals round to cents\./)
  assert.doesNotMatch(screen, /fake|answer:/)
})

// No, and say why (answer's say): claude's own tell-why choice gets the words typed into its box; a plain No sends
// them as its next message once it took the answer; never with a yes, never an agent's
test("No, and say why: the tell-why choice, then the words as its next prompt; a plain No, the words after it; a yes can't", async t => {
  const rig = await fresh(t, { env: { LAKI_ANSWER_HOLD_MS: '200' } }) // an answer's hold 0.2 s, not 1
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const tab = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id
  const screen = () => rig.rpc('screen', { target: tab }) as Promise<string>
  const ask = () => until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab)?.ask, 'its ask')
  await until(async () => /> $/m.test(await screen()), 'the fake claude up')
  await rig.rpc('send', { target: tab, text: 'menu' })
  await ask()
  await assert.rejects(rig.rpc('answer', { tab, n: 1, say: 'go on' }), /say goes with a no/)
  await assert.rejects(rig.rpc('answer', { tab, n: 3, say: 'x', from: { ws: ws.id, tab } }), /an agent can't answer an agent's question/)
  assert.deepEqual(await rig.rpc('answer', { tab, n: 3, say: 'use the trash, not rm' }), { picked: 'No, and tell Claude what to do differently (esc)' })
  await until(async () => /picked: No, and tell Claude[\s\S]*answer: use the trash, not rm/.test(await screen()), 'its answer, then the words as its prompt')
  // a menu with a plain No (another agent's): the words wait for it to take the answer, then go
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab)?.status === 'idle', 'its turn done')
  await rig.rpc('send', { target: tab, text: 'menuno' })
  await until(async () => (await ask()).options.length === 2, 'the Yes / No menu')
  await sleep(300) // answer's hold (core's answering: 0.2 s after the last one here)
  assert.deepEqual(await rig.rpc('answer', { tab, n: 2, say: 'build it first' }), { picked: 'No' })
  await until(async () => /picked: No\r?\n[\s\S]*answer: build it first/.test(await screen()), 'the No, then the words')
})

// a project's memory reaches every agent at start: claude by --append-system-prompt, codex by developer_instructions,
// grok by --rules, opencode by its config's instructions (a 0600 file of the tab's), agy in front of its new chat's
// first message (fenced, as background rules); once each, and a resumed agy chat isn't told again
test("a project's memory: every agent gets it once at start, by flag or in a new chat's first message; not again on a resume", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const LINE = 'Prices are in cents, never floats'
  await rig.rpc('memoryAdd', { project: p.id, text: LINE, auto: false })
  const count = (s: string) => s.split(LINE).length - 1
  const runs: Record<string, any> = {}
  for (const preset of ['grok', 'opencode', 'gemini', 'claude', 'codex']) {
    const ws = await rig.rpc('wsNew', { project: p.id, preset, name: `m-${preset}`, prompt: 'start here' })
    const bin = preset === 'gemini' ? 'agy' : preset
    runs[preset] = { ws, run: await until(() => rig.fakeLog().find(l => l.bin === bin && l.args.join(' ').length && (preset !== 'claude' || l.args.includes('--append-system-prompt'))), `${preset} up`) }
  }
  const all = (r: any) => [...r.args, r.config ?? ''].join('\n')
  // by flag: in its args once (grok's --rules)
  const g = runs.grok.run
  assert.equal(count(g.args[g.args.indexOf('--rules') + 1]), 1, "grok's --rules has it")
  assert.equal(count(all(g)), 1)
  // opencode: its config names a file that has it; its args don't
  const oc = runs.opencode.run
  const cfg = JSON.parse(oc.config)
  assert.equal(cfg.instructions.length, 1)
  assert.equal(count(readFileSync(cfg.instructions[0], 'utf8')), 1)
  assert.equal((statSync(cfg.instructions[0]).mode & 0o777).toString(8), '600')
  assert.equal(count(oc.args.join(' ')), 0)
  // agy: the first message (-i), fenced, then the prompt
  const ag = runs.gemini.run
  const first = ag.args[ag.args.indexOf('-i') + 1]
  assert.equal(count(first), 1)
  assert.match(first, /^Background rules from Laki for this project[^]*```text\n[^]*\n```\n\nstart here$/)
  // claude and codex as before: once each
  assert.equal(count(all(runs.claude.run)), 1)
  assert.equal(count(all(runs.codex.run)), 1)
  // resumed after a restart: agy's chat isn't told again; the flags are each start's (not in the chat), once
  const before = rig.fakeLog().length
  await rig.stop()
  await rig.start()
  const again = (bin: string) => until(() => rig.fakeLog().slice(before).find(l => l.bin === bin), `${bin} resumed`, 15000)
  const ag2 = await again('agy')
  assert.equal(count(all(ag2)), 0, "agy's resumed chat: not again")
  assert.equal(count(all(await again('grok'))), 1)
  // an agy chat started with no prompt: the first message Laki types into it carries the note, the next doesn't
  const quiet = await rig.rpc('wsNew', { project: p.id, preset: 'gemini', name: 'm-quiet' })
  const qt = await until(async () => (x => x?.status === 'idle' && x)(await rig.tab(quiet.id)), 'agy idle', 15000)
  assert.equal(count(all(await until(() => rig.fakeLog().filter(l => l.bin === 'agy').at(-1), 'its run'))), 0, 'no prompt: nothing in its args')
  await rig.rpc('send', { target: qt.id, text: 'first words' })
  await until(async () => (await rig.rpc('screen', { target: qt.id, lines: 80 })).includes('first words'), 'typed')
  const scr = await rig.rpc('screen', { target: qt.id, lines: 200 })
  assert.equal(count(scr.replace(/\s+/g, ' ')), 1, 'the first message has it')
})
