// The daemon end to end: real PTYs, git worktrees, hooks via the CLI, fake agents.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, sleep, until } from './helpers.ts'

test('rejects a wrong token and a foreign Origin', async t => {
  const rig = await fresh(t)
  const { port, token } = rig.info()
  assert.equal((statSync(join(rig.data, 'daemon.json')).mode & 0o777).toString(8), '600')
  const post = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers, body: '{"method":"ping"}' })
  assert.equal((await post({})).status, 401)
  assert.equal((await post({ authorization: 'Bearer nope' })).status, 401)
  assert.equal((await post({ authorization: `Bearer ${token}`, origin: 'https://evil.example' })).status, 403)
  assert.equal((await post({ authorization: `Bearer ${token}` })).status, 200)
  await assert.rejects(connect(rig, undefined, 'bad'))
  await assert.rejects(connect(rig, 'http://evil.example'))
  const ok = await connect(rig, 'file://')
  assert.equal(await ok.call('ping'), 'pong')
  ok.close()
})

test('single instance: a second daemon exits', async t => {
  const rig = await fresh(t)
  const pid = JSON.parse(readFileSync(join(rig.data, 'daemon.json'), 'utf8')).pid
  const r = await rig.cli('daemon')
  assert.match(r.out, /already running/)
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'daemon.json'), 'utf8')).pid, pid)
})

test('workspace lifecycle: worktree, setup gating, port, delete keeps the branch', async t => {
  const rig = await fresh(t, { config: { setup: 'echo setting-up; sleep 1; echo setup-ok > .setup-ran', teardown: 'echo bye > "$WBS_TEARDOWN_MARK"' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'build the thing', name: 'feat one' })
  assert.equal(ws.id, 'feat-one')
  assert.equal(ws.branch, 'wb/feat-one')
  assert.equal(ws.port, 3100)
  assert.ok(existsSync(join(ws.path, 'README.md')))
  // the agent waits for setup: claude hasn't started while the marker exists
  let v = await rig.rpc('state')
  assert.equal(v.workspaces[0].setup, true)
  assert.deepEqual(v.tabs.map((t: any) => t.name), ['setup', 'claude'])
  assert.ok(!existsSync(rig.env.FAKE_LOG) || !rig.fakeLog().some(l => l.bin === 'claude'))
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude after setup')
  assert.ok(existsSync(join(ws.path, '.setup-ran')), 'setup ran before the agent')
  const run = rig.fakeLog().find(l => l.bin === 'claude')
  assert.equal(run.port, '3100')
  assert.deepEqual(run.args.slice(0, 1), ['--settings'])
  assert.equal(run.args.at(-1), 'build the thing')
  v = await rig.rpc('state')
  assert.equal(v.workspaces[0].setup, false)
  // a second workspace gets the next port
  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  assert.equal(ws2.port, 3110)
  // delete: tabs die, worktree goes, branch stays
  await rig.rpc('wsRm', { id: ws.id })
  assert.ok(!existsSync(ws.path))
  const { execFileSync } = await import('node:child_process')
  assert.match(execFileSync('git', ['branch'], { cwd: rig.repo, encoding: 'utf8' }), /wb\/feat-one/)
  v = await rig.rpc('state')
  assert.deepEqual(v.workspaces.map((w: any) => w.id), [ws2.id])
  // the freed port is reused
  const ws3 = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'three' })
  assert.equal(ws3.port, 3100)
  // the same name again: wb/feat-one is kept, so the new one gets its own id and branch
  const again = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'feat one' })
  assert.equal(again.id, 'feat-one-2')
  assert.equal(again.branch, 'wb/feat-one-2')
  // a local workspace is the repo root itself
  const local = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'shell' })
  assert.equal(local.path, p.path)
  assert.equal(local.kind, 'local')
  await rig.rpc('wsRm', { id: local.id })
  assert.ok(existsSync(join(p.path, 'README.md')), 'deleting a local workspace keeps the repo')
})

test('attach, reattach, resize, multiple clients', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const tab = await rig.tab(ws.id, 'shell')
  const a = await connect(rig)
  const first = await a.call('attach', { tab: tab.id, cols: 90, rows: 20 })
  assert.equal(first.cols, 90)
  a.notify('input', { tab: tab.id, data: 'echo "$((6*7))-ok"; stty size\r' })
  await until(() => a.data(tab.id).includes('42-ok'), 'output on the attached client')
  await until(() => a.data(tab.id).includes('20 90'), 'pty got the size')
  await sleep(200)
  const screen1 = await rig.screen(tab.id)
  a.close()
  // a new client gets the same screen back from the snapshot
  const b = await connect(rig)
  const snap = await b.call('attach', { tab: tab.id, cols: 90, rows: 20 })
  assert.ok(snap.snapshot.includes('42-ok'))
  assert.equal(await rig.screen(tab.id), screen1)
  // a second client at the same time: both get the stream; the newest answers queries
  const c = await connect(rig)
  await c.call('attach', { tab: tab.id, cols: 100, rows: 30 })
  await until(() => c.events.some(e => e.ev === 'responder' && e.on), 'c is responder')
  await until(() => b.events.some(e => e.ev === 'responder' && !e.on), 'b is not')
  c.notify('input', { tab: tab.id, data: 'stty size\r' })
  await until(() => b.data(tab.id).includes('30 100') && c.data(tab.id).includes('30 100'), 'both clients see output')
  c.close()
  await until(() => b.events.filter(e => e.ev === 'responder' && e.on).length === 2, 'b answers again after c left')
  b.close()
})

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
  assert.deepEqual(again.args.slice(2), ['--resume', tab.resumeId])
  await until(() => rig.fakeLog().filter(l => l.bin === 'codex').length === 2, 'codex restarted')
  const cx = rig.fakeLog().filter(l => l.bin === 'codex')[1]
  assert.deepEqual(cx.args.slice(0, 2), ['resume', thread])
  const v = await rig.rpc('state')
  assert.deepEqual(v.tabs.map((t: any) => [t.name, t.status === 'exited']), [['claude', false], ['codex', false], ['shell', false]])
})

test('diff: committed and uncommitted changes since the base, new files too', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const { execFileSync } = await import('node:child_process')
  writeFileSync(join(ws.path, 'README.md'), 'hello\nworld\n')
  execFileSync('git', ['commit', '-qam', 'more'], { cwd: ws.path, env: rig.env })
  writeFileSync(join(ws.path, 'README.md'), 'hello\nworld\nagain\n')
  writeFileSync(join(ws.path, 'new.txt'), 'brand new\n')
  const d = await rig.rpc('diff', { ws: ws.id })
  assert.deepEqual(d.files.map((f: any) => [f.path, f.add, f.del, f.status]), [['README.md', 2, 0, 'M'], ['new.txt', 1, 0, 'A']])
  assert.match(d.diff, /\+world/)
  assert.match(d.diff, /\+again/)
  assert.match(d.diff, /\+brand new/)
})

test('ports of the workspace process tree, PR from gh, dev server', async t => {
  // listens on a free port (3100+ may be taken on this machine) and says which, and what $PORT was
  const rig = await fresh(t, { config: { run: `exec node -e 'const s = require("http").createServer().listen(0, "127.0.0.1", () => console.log("listening " + s.address().port + " PORT=" + process.env.PORT))'` } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const dev = await rig.rpc('run', { ws: ws.id })
  assert.equal(dev.name, 'dev')
  const m = (await until(async () => (await rig.screen(dev.id)).match(/listening (\d+) PORT=(\d+)/), "dev server up"))!
  assert.equal(Number(m[2]), ws.port)
  await until(async () => (await rig.rpc('state')).workspaces[0].ports.includes(Number(m[1])), 'port scanned')
  const pr = await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  assert.deepEqual(pr, { number: 42, state: 'OPEN', url: 'https://example.invalid/pr/42', checks: 'pending' })
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
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'claude')[1].args.slice(2), ['--resume', id])
  v = await rig.rpc('state')
  assert.equal(v.workspaces[0].archived, false)
  assert.ok(existsSync(join(ws.path, 'README.md')))
  // fork: a new worktree from this branch, the chat forked
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.equal(fork.base, 'wb/keep')
  await until(() => rig.fakeLog().some(l => l.bin === 'claude' && l.args.includes('--fork-session')), 'forked claude')
  assert.deepEqual(rig.fakeLog().find(l => l.args.includes('--fork-session')).args.slice(2), ['--resume', id, '--fork-session'])
})

test('usage limit from codex screen: ◷ until reset, then "continue"', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'codex' })
  await until(async () => (await rig.screen(ws.id)).includes('fake codex'), 'codex up')
  await rig.rpc('send', { target: ws.id, text: 'hit the limit' })
  const tv = await until(async () => {
    const t = await rig.tab(ws.id)
    return t.limit && t
  }, 'limit')
  const hours = (tv.limit - Date.now()) / 3600e3
  assert.ok(hours > 1.9 && hours <= 2, `resets in 2h, got ${hours}`)
  // queued messages wait for the reset
  const q = await rig.rpc('send', { target: ws.id, text: 'later', whenIdle: true })
  assert.equal(q.queued, 1)
  await rig.rpc('watchLimits', { now: tv.limit - 1000 })
  assert.ok((await rig.tab(ws.id)).limit, 'still limited before the reset')
  // after the reset: "continue" goes in, then the queue
  await rig.rpc('watchLimits', { now: tv.limit + 61_000 })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: later', 'continued, then the queue')
  assert.match(await rig.screen(ws.id), /answer: continue[\s\S]*answer: later/)
})

test('a folder without git is a project (local workspaces only); project settings override .wb.json', async t => {
  const rig = await fresh(t, { config: { run: 'echo from-file', teardown: 'echo bye' } })
  const plain = join(rig.home, 'notes')
  mkdirSync(plain)
  const np = await rig.rpc('projectAdd', { path: plain })
  assert.equal(np.git, false)
  assert.deepEqual(await rig.rpc('branches', { project: np.id }), { current: '', branches: [] })
  const nw = await rig.rpc('wsNew', { project: np.id, preset: 'shell' }) // no local flag: forced
  assert.equal(nw.kind, 'local')
  assert.equal(nw.path, realpathSync(plain))
  await assert.rejects(rig.rpc('projectAdd', { path: join(plain, 'missing') }), /not a folder/)

  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.equal(p.git, true)
  assert.deepEqual(await rig.rpc('projectFile', { id: p.id }), { run: 'echo from-file', teardown: 'echo bye' })
  await rig.rpc('projectSet', { id: p.id, name: 'Shop', config: { run: 'echo from-app', setup: '  ' } })
  const saved = (await rig.rpc('state')).projects.find((x: any) => x.id === p.id)
  assert.equal(saved.name, 'Shop')
  assert.deepEqual(saved.config, { run: 'echo from-app' }) // blanks dropped
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  const dev = await rig.rpc('run', { ws: ws.id })
  await until(async () => (await rig.screen(dev.id)).includes('from-app'), 'the app config wins over .wb.json')
})
