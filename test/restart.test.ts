// A daemon that starts again: one at a time, agents resumed, shells brought back, archive and restore, a broken state.json;
// a test's daemon gone with its test process.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { INSTALL, notInstalled, tabAgent } from '../src/shared/install.ts'
import { API } from '../src/shared/types.ts'
import { fresh, running, sleep, until } from './helpers.ts'

test('single instance: a second daemon exits', async t => {
  const rig = await fresh(t)
  const pid = JSON.parse(readFileSync(join(rig.data, 'daemon.json'), 'utf8')).pid
  const r = await rig.cli('daemon')
  assert.match(r.out, /already running/)
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'daemon.json'), 'utf8')).pid, pid)
  assert.equal((await rig.rpc('state')).api, API) // or the app offers to restart it
})

test("a test's daemon goes with its test process (LAKI_TEST_PARENT): a run killed midway leaves none behind", async t => {
  const rig = await fresh(t)
  await rig.stop()
  const parent = spawn('sleep', ['60']) // stands in for the test process
  const daemon = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../src/daemon/main.ts', import.meta.url))], {
    env: { ...rig.env, LAKI_TEST_PARENT: String(parent.pid) },
    stdio: 'ignore',
  })
  t.after(() => (parent.kill(), daemon.kill()))
  await until(() => rig.rpc('ping').then(r => r === 'pong'), 'the daemon up')
  await sleep(2500) // a check or more while its parent lives
  assert.ok(running(daemon.pid!), 'stays while its parent runs')
  parent.kill()
  await until(() => !running(daemon.pid!), 'gone with its parent')
  assert.ok(!existsSync(join(rig.data, 'daemon.json')), 'shut down, not killed: its daemon.json removed')
})

test('resume after a daemon restart: agents get --resume <id>, shells start fresh', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'remember me' })
  await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await rig.rpc('tabNew', { ws: ws.id })
  const tab = await until(async () => {
    const t = await rig.tab(ws.id, 'claude')
    return t.resumeId && t
  }, 'session id')
  const codex = await rig.tab(ws.id, 'codex')
  await rig.rpc('send', { target: codex.id, text: 'hi' })
  const thread = (await until(async () => (await rig.tab(ws.id, 'codex')).resumeId, 'thread id')) as string
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'claude').length === 2, 'claude restarted')
  const again = rig.fakeLog().filter(l => l.bin === 'claude')[1]
  assert.deepEqual(again.args.slice(4, 6), ['--resume', tab.resumeId]) // then the note about Laki
  await until(() => rig.fakeLog().filter(l => l.bin === 'codex').length === 2, 'codex restarted')
  const cx = rig.fakeLog().filter(l => l.bin === 'codex')[1]
  assert.deepEqual(cx.args.slice(0, 2), ['resume', thread])
  const v = await rig.rpc('state')
  assert.deepEqual(v.tabs.map((t: any) => [t.name, t.status === 'exited']), [['claude', false], ['codex', false], ['shell', false]])
})

test("a restart's tabs start in turn: the rest wait as asleep, a look, a message or a shown workspace starts one now", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const wss = []
  for (const name of ['one', 'two', 'three']) wss.push(await rig.rpc('wsNew', { project: p.id, name, preset: 'claude', prompt: `hi ${name}` }))
  const ids = []
  for (const ws of wss) ids.push((await until(async () => (t => t?.resumeId && t)(await rig.tab(ws.id, 'claude')), 'session id')).id)
  await rig.stop()
  rig.env.LAKI_RESTORE_GAP = '60000' // the first now, the next a minute later: past this test
  await rig.start()
  const claudes = () => rig.fakeLog().filter(l => l.bin === 'claude').length
  const asleep = async () => (await rig.rpc('state')).tabs.filter((x: any) => x.asleep && x.queued).map((x: any) => x.id) // queued: its tooltip says so
  await until(() => claudes() === 4, 'the oldest resumed')
  assert.deepEqual(await asleep(), [ids[1], ids[2]]) // live (not exited), waiting their turn
  await rig.rpc('tabWake', { tab: ids[2] }) // a look
  await until(() => claudes() === 5, 'the one looked at')
  assert.deepEqual(await asleep(), [ids[1]])
  const app = await rig.connect()
  await app.call('view', { tab: null, ws: wss[1].id, focused: true }) // a window shows its workspace
  await until(async () => claudes() === 6 && (await asleep()).length === 0, 'the shown workspace')
  await sleep(500)
  assert.equal(claudes(), 6, 'each once')
})

test("a restart leaves agents unused past sleepAfter asleep, not queued, until something wants them", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const wss = []
  for (const name of ['old', 'new']) wss.push(await rig.rpc('wsNew', { project: p.id, name, preset: 'claude', prompt: `hi ${name}` }))
  const ids: string[] = []
  for (const ws of wss) ids.push((await until(async () => (t => t?.resumeId && t)(await rig.tab(ws.id, 'claude')), 'session id')).id)
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  const old = st.tabs.find((x: any) => x.id === ids[0])
  assert.ok(Date.now() - old.usedAt < 60_000, 'its turns kept usedAt')
  old.usedAt = Date.now() - 9 * 3600_000 // past the default 8 hours
  writeFileSync(file, JSON.stringify(st))
  await rig.start()
  const claudes = () => rig.fakeLog().filter(l => l.bin === 'claude').length
  await until(() => claudes() === 3, 'the one used lately resumed')
  await sleep(500)
  assert.equal(claudes(), 3, 'the old one waits')
  const tab = (await rig.rpc('state')).tabs.find((x: any) => x.id === ids[0])
  assert.equal(tab.asleep, true)
  assert.equal(tab.queued, undefined, 'its tooltip: asleep, not waiting its turn')
  await rig.rpc('tabWake', { tab: ids[0] }) // a look
  await until(() => claudes() === 4, 'resumed as it was wanted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'claude')[3].args.slice(4, 6), ['--resume', old.resumeId])
})

test('Check for updates saved off before 0.33 is on again, once: off after that stays off', async t => {
  const rig = await fresh(t)
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  st.settings = { ...st.settings, updateCheck: false }
  delete st.updatesOn
  writeFileSync(file, JSON.stringify(st))
  await rig.start()
  assert.equal((await rig.rpc('state')).settings.updateCheck, undefined, 'on: unset')
  await rig.rpc('settingsSet', { updateCheck: false })
  await rig.stop()
  await rig.start()
  assert.equal((await rig.rpc('state')).settings.updateCheck, false, 'your off now stays')
})

test('shells come back after a daemon restart: their folder, an agent resumed, a command typed back, a Run tab again', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { run: 'sleep 300' } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  mkdirSync(join(ws.path, 'sub'))
  const agent = await until(() => rig.tab(ws.id, 'shell'), 'a shell')
  const cmd = await rig.rpc('tabNew', { ws: ws.id })
  const idle = await rig.rpc('tabNew', { ws: ws.id })
  await rig.rpc('run', { ws: ws.id })
  for (const s of [agent, cmd, idle]) await until(async () => (await rig.screen(s.id)).includes('$'), 'a prompt')
  // claude typed in a shell: it keeps its chat id in ~/.claude/sessions/<pid>.json
  const bin = join(rig.home, 'agent')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs'), dir = process.env.HOME + '/.claude/sessions'
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(dir + '/' + process.pid + '.json', JSON.stringify({ pid: process.pid, sessionId: 'chat-in-a-shell' }))
setTimeout(() => {}, 300000)
`, { mode: 0o755 })
  await rig.rpc('input', { tab: agent.id, data: `cd sub && ${join(bin, 'claude')}\r` })
  writeFileSync(join(bin, 'serve'), "#!/usr/bin/env node\nconsole.log('serving')\nsetTimeout(() => {}, 300000)\n", { mode: 0o755 }) // ps: node /…/serve --port 3000
  await rig.rpc('input', { tab: cmd.id, data: `${join(bin, 'serve')} --port 3000\r` })
  await rig.rpc('input', { tab: idle.id, data: 'cd sub\r' })
  await until(() => existsSync(join(rig.home, '.claude/sessions')) && readdirSync(join(rig.home, '.claude/sessions')).length > 0, "claude's session file")
  await until(async () => (await rig.screen(cmd.id)).includes('\nserving'), 'the command running')
  await sleep(300)
  await rig.stop()
  await rig.start()
  // the agent resumes its chat, in its folder (the fake claude on PATH logs it)
  await until(() => rig.fakeLog().some(l => l.bin === 'claude' && l.args.join(' ') === '--resume chat-in-a-shell'), 'claude --resume, run', 15000)
  assert.match(await rig.screen(agent.id), /Laki restarted · resuming it/)
  // another program is typed back by its name, not run
  await until(async () => /\$ serve --port 3000\s*$/.test(await rig.screen(cmd.id)), 'serve typed', 15000)
  assert.match(await rig.screen(cmd.id), /⏎ runs it again/)
  // an idle shell starts where it was
  await rig.rpc('input', { tab: idle.id, data: 'pwd\r' })
  await until(async () => (await rig.screen(idle.id)).includes(join(realpathSync(ws.path), 'sub')), 'in sub')
  const dev = await rig.tab(ws.id, 'dev')
  assert.equal(dev?.status, 'idle', 'the Run tab started again')
  assert.equal(dev.again, undefined)
})

test('archive keeps the branch and resume ids; restore brings them back', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'keep' })
  const id = await until(async () => (await rig.tab(ws.id)).resumeId, 'session id')
  await rig.rpc('wsArchive', { id: ws.id })
  let v = await rig.rpc('state')
  assert.equal(v.workspaces[0].archived, true)
  assert.ok(!existsSync(ws.path))
  await rig.rpc('wsRestore', { id: ws.id })
  await until(() => rig.fakeLog().filter(l => l.bin === 'claude').length === 2, 'claude resumed')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'claude')[1].args.slice(4, 6), ['--resume', id])
  v = await rig.rpc('state')
  assert.equal(v.workspaces[0].archived, false)
  assert.ok(existsSync(join(ws.path, 'README.md')))
  // fork: a new worktree from this branch, the chat forked
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.equal(fork.base, 'laki/keep')
  await until(() => rig.fakeLog().some(l => l.bin === 'claude' && l.args.includes('--fork-session')), 'forked claude')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'claude' && l.args.includes('--fork-session')).args.slice(4, 7), ['--resume', id, '--fork-session'])
})

test('an unreadable state.json is kept aside and the last good one loads: nothing is written over', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.stop()
  await rig.start() // loads it: state.json.bak
  await rig.stop()
  const statePath = join(rig.data, 'state.json')
  writeFileSync(statePath, readFileSync(statePath, 'utf8').slice(0, 40)) // a crash mid-write
  await rig.start()
  assert.ok((await rig.rpc('state')).projects.some((x: any) => x.id === p.id))
  assert.ok(readdirSync(rig.data).some(f => f.startsWith('state.json.broken-')))
})

test('a chat that cannot be resumed is dropped: Enter starts a new one', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  await until(async () => (await rig.tab(ws.id, 'claude')).resumeId, 'session id')
  await rig.stop()
  // the chat was never saved (no message sent): claude can't resume it
  const statePath = join(rig.data, 'state.json')
  writeFileSync(statePath, readFileSync(statePath, 'utf8').replace(/"resumeId": *"[^"]*"/, '"resumeId": "gone-1"'))
  await rig.start()
  const tab = await until(async () => {
    const t = await rig.tab(ws.id, 'claude')
    return t.status === 'exited' && !t.resumeId && t
  }, 'the dead id dropped')
  await until(async () => (await rig.screen(tab.id)).includes('press Enter to start a new one'), 'the hint')
  await rig.rpc('input', { tab: tab.id, data: '\r' })
  await until(() => rig.fakeLog().filter(l => l.bin === 'claude').length === 3, 'a new claude')
  assert.ok(!rig.fakeLog().filter(l => l.bin === 'claude')[2].args.includes('--resume'))
})

test("a restart stopped a claude chat's background commands: the resumed tab is told once, by name; one whose task ended is told nothing", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '300' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const chat = async (name: string) => {
    const ws = await rig.rpc('wsNew', { project: p.id, name, preset: 'claude', prompt: `hi ${name}` })
    return until(async () => (x => x?.last && x.resumeId && x)(await rig.tab(ws.id, 'claude')), 'its first turn')
  }
  const live = await chat('live')
  const ended = await chat('ended')
  // their transcripts (as reader.test's): a dev server and a background subagent left running; a migration that ended
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const at = new Date().toISOString()
  const lines = (...o: object[]) => o.map(x => JSON.stringify({ timestamp: at, ...x })).join('\n') + '\n'
  const bash = (id: string, cmd: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd, description: 'run it', run_in_background: true } }] } })
  const started = (id: string, task: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${task}.` }] }, toolUseResult: { backgroundTaskId: task } })
  writeFileSync(join(dir, `${live.resumeId}.jsonl`), lines(
    bash('toolu_1', 'npm run dev'), started('toolu_1', 'b1'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { description: 'Scan deps', run_in_background: true } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'launched' }] }, toolUseResult: { isAsync: true, agentId: 'ag1' } },
  ))
  writeFileSync(join(dir, `${ended.resumeId}.jsonl`), lines(bash('toolu_3', './migrate.sh'), started('toolu_3', 'b3'), { type: 'user', message: { content: '<task-notification>\n<task-id>b3</task-id>\n<status>completed</status>\n</task-notification>' } }))
  await rig.stop()
  await rig.start()
  const told = 'Laki restarted and stopped the background commands you had running: `npm run dev`. Start again the ones you still need. It also stopped your background subagents: Scan deps. Start them again if you still need them.'
  await until(async () => (await rig.tab(live.workspace, 'claude')).last === `answer: ${told}`, 'told')
  // nor shown as running in the status bar's Background chip (their ends never come)
  await sleep(800)
  assert.deepEqual((await rig.rpc('state')).tabs.find((x: any) => x.id === live.id).background?.now ?? [], [])
  await sleep(1500)
  assert.ok(!(await rig.screen(ended.id)).includes('Laki restarted'), 'its task ended: nothing said')
  // again: those were named already (their ends never come), nothing new to say
  await rig.stop()
  await rig.start()
  await until(async () => (await rig.screen(live.id)).includes('fake claude'), 'resumed again')
  await sleep(1500)
  assert.ok(!(await rig.screen(live.id)).includes('Laki restarted'), 'not named twice')
})

test("sleep stopped a claude chat's background command: the woken tab is told so, once", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, name: 'watch', preset: 'claude', prompt: 'hi' })
  const tab = await until(async () => (x => x?.last && x.resumeId && x)(await rig.tab(ws.id, 'claude')), 'its first turn')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const at = new Date().toISOString()
  writeFileSync(join(dir, `${tab.resumeId}.jsonl`), [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_w', name: 'Bash', input: { command: 'npm run watch', run_in_background: true } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_w', content: 'Command running in background with ID: w1.' }] }, toolUseResult: { backgroundTaskId: 'w1' } },
  ].map(x => JSON.stringify({ timestamp: at, ...x })).join('\n') + '\n')
  assert.equal(await rig.rpc('tabSleep', { tab: tab.id }), true)
  assert.equal(await rig.rpc('tabWake', { tab: tab.id }), true)
  const told = 'Laki put this tab to sleep to free memory, which stopped the background commands you had running: `npm run watch`. Start again the ones you still need.'
  await until(async () => (await rig.tab(ws.id, 'claude')).last === `answer: ${told}`, 'told', 15000)
  assert.ok(rig.fakeLog().filter((l: any) => l.tab === tab.id && l.args).at(-1).args.includes('--resume'), 'its chat resumed')
  assert.deepEqual((await rig.tab(ws.id, 'claude')).bgTold, undefined, "the daemon's own, not in the view")
  await until(() => JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8')).tabs.find((x: any) => x.id === tab.id).bgTold?.includes('w1'), 'kept: never named again')
})

test('R4: a full disk: the state stays in memory and the view says so; saved once there is room; no worktree made meanwhile', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const flag = join(rig.data, 'test-disk-full')
  const saved = () => JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8'))
  writeFileSync(flag, '')
  await rig.rpc('settingsSet', { prScan: 7 }) // a save: it fails, nothing thrown
  const v = await rig.rpc('state')
  assert.equal(typeof v.diskFull?.free, 'number')
  assert.equal(v.settings.prScan, 7, 'in memory')
  assert.notEqual(saved().settings?.prScan, 7, 'not on disk')
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'no-room' }), /MB free: not enough to make a worktree/)
  rmSync(flag)
  await rig.rpc('settingsSet', { prScan: 8 }) // the next save
  assert.equal((await rig.rpc('state')).diskFull, undefined)
  assert.equal(saved().settings.prScan, 8)
})

test("R12: an agent that isn't installed ends its tab with 127 (the strip's sign); installed, Enter starts it", async t => {
  assert.equal(notInstalled({ kind: 'agent', status: 'exited', code: 127 }), true)
  assert.equal(notInstalled({ kind: 'agent', status: 'exited', code: 1 }), false)
  assert.equal(notInstalled({ kind: 'shell', status: 'exited', code: 127 }), false)
  assert.deepEqual([tabAgent({ preset: 'codex' }), tabAgent({ preset: 'fast' }, [{ name: 'fast', agent: 'claude' }]), tabAgent({ preset: 'nope' })], ['codex', 'claude', undefined])
  for (const a of Object.values(INSTALL)) assert.ok(!a.cmd || /^(curl -fsSL https:\/\/\S+ \| bash|npm install -g @[\w-]+\/[\w-]+)$/.test(a.cmd), a.cmd)

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.stop()
  const fakes = fileURLToPath(new URL('./fakes', import.meta.url))
  rig.env.PATH = rig.env.PATH.split(':').filter((d: string) => d !== fakes).join(':') // no agent anywhere
  await rig.start()
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'none' })
  const gone = await until(async () => (x => x?.status === 'exited' && x)(await rig.tab(ws.id)), 'its tab ended', 20000)
  assert.equal(gone.code, 127)
  assert.equal(notInstalled(gone), true)
  mkdirSync(join(rig.home, 'bin'), { recursive: true })
  symlinkSync(join(fakes, 'claude'), join(rig.home, 'bin', 'claude')) // installed
  await rig.rpc('input', { tab: gone.id, data: '\r' }) // Check again
  await until(async () => (await rig.tab(ws.id)).status !== 'exited', 'it runs', 20000)
})
