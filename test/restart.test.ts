// A daemon that starts again: one at a time, agents resumed, shells brought back, archive and restore, a broken state.json;
// a test's daemon gone with its test process.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
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
  assert.deepEqual(rig.fakeLog().find(l => l.args.includes('--fork-session')).args.slice(4, 7), ['--resume', id, '--fork-session'])
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
