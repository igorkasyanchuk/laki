// The daemon end to end: real PTYs, git worktrees, hooks via the CLI, fake agents.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { API } from '../src/shared/types.ts'
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
  assert.equal((await rig.rpc('state')).api, API) // or the app offers to restart it
})

test('workspace lifecycle: worktree, setup gating, port, delete keeps the branch', async t => {
  const rig = await fresh(t, { config: { setup: 'echo setting-up; sleep 1; echo setup-ok > .setup-ran', teardown: 'echo bye > "$LAKI_TEARDOWN_MARK"' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'build the thing', name: 'feat one' })
  assert.equal(ws.id, 'feat-one')
  assert.equal(ws.branch, 'laki/feat-one')
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
  assert.match(execFileSync('git', ['branch'], { cwd: rig.repo, encoding: 'utf8' }), /laki\/feat-one/)
  v = await rig.rpc('state')
  assert.deepEqual(v.workspaces.map((w: any) => w.id), [ws2.id])
  // the freed port is reused
  const ws3 = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'three' })
  assert.equal(ws3.port, 3100)
  // the same name again: laki/feat-one is kept, so the new one gets its own id and branch
  const again = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'feat one' })
  assert.equal(again.id, 'feat-one-2')
  assert.equal(again.branch, 'laki/feat-one-2')
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

test('side panel: files with their changes, new files and folders, only inside the workspace', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'README.md'), 'changed\n')
  mkdirSync(join(ws.path, 'src'))
  writeFileSync(join(ws.path, 'src', 'new.ts'), 'x\n')
  writeFileSync(join(ws.path, '.gitignore'), 'ignored.log\n')
  writeFileSync(join(ws.path, 'ignored.log'), 'x\n')
  let f = await rig.rpc('files', { ws: ws.id })
  assert.ok(f.files.includes('README.md') && f.files.includes('src/new.ts'))
  assert.ok(!f.files.includes('ignored.log'))
  assert.equal(f.changed['README.md'], 'M')
  assert.equal(f.changed['src/new.ts'], 'A')
  assert.deepEqual(await rig.rpc('fileNew', { ws: ws.id, path: 'src/lib/a.ts' }), { path: 'src/lib/a.ts' })
  assert.ok(existsSync(join(ws.path, 'src/lib/a.ts')))
  await rig.rpc('fileNew', { ws: ws.id, path: 'docs', dir: true })
  assert.ok(statSync(join(ws.path, 'docs')).isDirectory())
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'src/lib/a.ts' }), /there already/)
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: '../escape.txt' }), /inside the workspace/)
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'finder', file: '/etc/passwd' }), /inside the workspace/)
  f = await rig.rpc('files', { ws: ws.id })
  assert.ok(f.files.includes('src/lib/a.ts'))
  assert.deepEqual(await rig.rpc('prThreads', { ws: ws.id }), []) // no PR
  // the preview: text, an image, a binary file
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'README.md' }), { size: 8, text: 'changed\n' })
  writeFileSync(join(ws.path, 'dot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'dot.png' })).image, 'data:image/png;base64,iVBORw==')
  writeFileSync(join(ws.path, 'blob.bin'), Buffer.from([1, 0, 2]))
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'blob.bin' }), { size: 3 })
  writeFileSync(join(ws.path, 'big.log'), 'x'.repeat(600 << 10))
  const big = await rig.rpc('fileRead', { ws: ws.id, path: 'big.log' })
  assert.deepEqual([big.size, big.text.length, big.cut], [600 << 10, 512 << 10, true])
  await assert.rejects(rig.rpc('fileRead', { ws: ws.id, path: '../../etc/hosts' }), /inside the workspace/)
})

test('a tab whose program ends cleanly closes, and a shell on any exit; a failed program stays, to read', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const ok = await rig.rpc('tabNew', { ws: ws.id, cmd: 'true' })
  const bad = await rig.rpc('tabNew', { ws: ws.id, cmd: 'exit 3' })
  const sh = await rig.rpc('tabNew', { ws: ws.id })
  await rig.rpc('send', { target: sh.id, text: 'exit 3' })
  await until(async () => {
    const v = await rig.rpc('state')
    const has = (id: string) => v.tabs.some((x: { id: string }) => x.id === id)
    return !has(ok.id) && !has(sh.id) && v.tabs.find((x: { id: string }) => x.id === bad.id)?.status === 'exited'
  }, 'the clean one and the shell closed, the failed one exited')
})

test('agent skill: installed in HOME for claude and codex, its launcher drives the daemon, removed again', async t => {
  const rig = await fresh(t)
  await rig.rpc('projectAdd', { path: rig.repo })
  const states = (s: { state: string }[]) => s.map(x => x.state)
  assert.deepEqual(states(await rig.rpc('skills')), ['missing', 'missing'])
  assert.deepEqual(states(await rig.rpc('skillSet', { agent: 'claude', on: true })), ['installed', 'missing'])
  const at = join(rig.home, '.claude/skills/laki')
  assert.match(readFileSync(join(at, 'SKILL.md'), 'utf8'), /^---\nname: laki\ndescription: /)
  // the launcher finds this daemon from a bare environment, as an agent's shell would
  const ls = JSON.parse(execFileSync(join(at, 'laki'), ['ls', '--json'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' }))
  assert.equal(ls.projects.length, 1)
  writeFileSync(join(at, 'SKILL.md'), 'edited')
  assert.deepEqual(states(await rig.rpc('skills')), ['outdated', 'missing'])
  assert.deepEqual(states(await rig.rpc('skillSet', { agent: 'codex', on: true })), ['outdated', 'installed'])
  assert.ok(existsSync(join(rig.home, '.codex/skills/laki/SKILL.md')))
  writeFileSync(join(at, 'notes.md'), 'the user’s')
  assert.deepEqual(states(await rig.rpc('skillSet', { agent: 'claude', on: false })), ['missing', 'installed'])
  assert.ok(existsSync(join(at, 'notes.md')) && !existsSync(join(at, 'SKILL.md'))) // only its own files go
  await rig.rpc('skillSet', { agent: 'codex', on: false })
  assert.ok(!existsSync(join(rig.home, '.codex/skills/laki'))) // an emptied folder goes too
  await assert.rejects(rig.rpc('skillSet', { agent: 'aider', on: true }), /no agent/)
  await assert.rejects(rig.rpc('skillSet', { agent: 'constructor', on: true }), /no agent/) // not an inherited key
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
  assert.deepEqual({ ...pr, list: undefined }, { number: 42, state: 'OPEN', url: 'https://example.invalid/pr/42', checks: 'pending', list: undefined })
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
  assert.equal(fork.base, 'laki/keep')
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

test('a folder without git is a project (local workspaces only); project settings override .laki.json', async t => {
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
  // Run ▾'s actions: kept for claude, codex or a shell, unfinished ones too (Settings has them as typed)
  const actions = [
    { name: ' review ', target: 'claude', text: 'review it twice' },
    { name: 'migrate', target: 'shell', text: 'rails db:migrate' },
    { name: '', target: 'shell', text: 'ls' },
    { name: 'x', target: 'vim', text: 'ls' },
    { name: 'y', target: 'codex', text: ' ' },
  ]
  const withActions = await rig.rpc('projectSet', { id: p.id, config: { run: 'echo from-app', actions } })
  assert.deepEqual(withActions.config.actions, [actions[0], actions[1], actions[2], actions[4]])
  // and the run script still comes from the config with them in it
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  const dev = await rig.rpc('run', { ws: ws.id })
  await until(async () => (await rig.screen(dev.id)).includes('from-app'), 'the app config wins over .laki.json')
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

test('settings: branch prefix, tab name and color, open in a custom editor', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const out = join(rig.home, 'opened')
  await rig.rpc('settingsSet', { branchPrefix: 'me/', editor: 'custom', editorCmd: `echo >${out}` })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  assert.equal(ws.branch, `me/${ws.id}`)
  const tab = await rig.tab(ws.id, 'shell')
  await rig.rpc('tabSet', { id: tab.id, name: '  server  ', color: 'teal' })
  let v = (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)
  assert.deepEqual([v.name, v.color], ['server', 'teal'])
  await rig.rpc('tabSet', { id: tab.id, color: '' })
  v = (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)
  assert.equal(v.color, undefined)
  await rig.rpc('openIn', { ws: ws.id, app: 'editor' })
  assert.equal(readFileSync(out, 'utf8').trim(), ws.path)
  assert.deepEqual((await rig.rpc('state')).settings.branchPrefix, 'me/')
})

test('presets: args and env on top of the project env; Esc ends a turn; reorder; workspace color', async t => {
  const rig = await fresh(t, { config: { env: { TEST_FILE: 'f', TEST_SHARED: 'file' } } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { env: { TEST_SHARED: 'app', 'bad key': 'x' } } })
  await rig.rpc('settingsSet', { agent: 'opus', presets: [{ name: 'opus', agent: 'claude', args: '--model opus', env: { TEST_PRESET: 'yes' } }] })
  const ws = await rig.rpc('wsNew', { project: p.id })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.name, tab.preset, tab.profile], ['opus', 'claude', 'opus'])
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  const run = rig.fakeLog().find(l => l.bin === 'claude')
  assert.deepEqual(run.args.slice(-2), ['--model', 'opus'])
  assert.deepEqual(run.env, { TEST_FILE: 'f', TEST_SHARED: 'app', TEST_PRESET: 'yes' })
  // Esc: no hook says the turn ended, the screen does
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')
  await rig.rpc('input', { tab: tab.id, data: 'slow work\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'running')
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle after Esc')

  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'second' })
  await rig.rpc('reorder', { workspaces: [ws2.id, ws.id] })
  await rig.rpc('wsSet', { id: ws2.id, color: 'pink' })
  const v = await rig.rpc('state')
  assert.deepEqual(v.workspaces.map((w: any) => w.id), [ws2.id, ws.id])
  assert.equal(v.workspaces[0].color, 'pink')
  assert.equal(v.workspaces[0].run, false)
})

test('PR: failing CI and new review comments go to the agent once; global env; images; workspace name; a silent turn ends', async t => {
  const rig = await fresh(t, { config: { env: { TEST_SHARED: 'file' } } })
  await rig.rpc('settingsSet', { env: { TEST_GLOBAL: 'g', TEST_SHARED: 'global', 'bad key': 'x' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'claude').env, { TEST_GLOBAL: 'g', TEST_SHARED: 'file' })
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')

  // CI fails on commit abc: its failing job's log goes to the agent, once
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = (head: string) =>
    writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 42, state: 'OPEN', url: 'https://example.invalid/pr/42', title: 'Add things', author: { login: 'ann' }, headRefOid: head,
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/7' }] }))
  pr('abc')
  writeFileSync(join(gh, 'checks.json'), JSON.stringify([{ name: 'test', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1/job/7' }]))
  writeFileSync(join(gh, 'run.log'), 'test\tRun tests\t2026-10-03T10:00:00Z expected 2, got 3\n')
  await rig.rpc('wsSet', { id: ws.id, autoFix: true, name: '  Nice name  ' })
  await until(async () => (await rig.screen(tab.id)).includes('answer: CI fails on PR #42'), 'CI sent')
  await until(async () => (await rig.rpc('state')).workspaces[0].fix?.ci === 'abc', 'fix recorded')
  let w = (await rig.rpc('state')).workspaces[0]
  assert.equal(w.name, 'Nice name')
  await rig.rpc('wsSet', { id: ws.id, name: ws.id }) // the id itself: back to it
  assert.equal((await rig.rpc('state')).workspaces[0].name, undefined)
  assert.equal(w.pr.title, 'Add things')
  assert.equal(w.pr.author, 'ann')
  assert.deepEqual(w.pr.list, [{ name: 'test', state: 'fail', url: 'https://github.com/o/r/actions/runs/1/job/7' }])
  assert.equal(w.fix.tries, 1)
  assert.match(await rig.screen(tab.id), /expected 2, got 3/)
  await sleep(1500) // scans go on: the same commit isn't sent again
  assert.equal((await rig.screen(tab.id)).split('answer: CI fails').length, 2)
  // a new commit still failing: sent again
  pr('def')
  await until(async () => (await rig.rpc('state')).workspaces[0].fix?.tries === 2, 'second try')

  // review: another person's open thread goes once; your own comments don't count
  // a stranger's comment (anyone can comment on a public PR) is never sent
  const said = (login: string, body: string, authorAssociation = 'COLLABORATOR') => ({ author: { login, __typename: 'User' }, authorAssociation, body })
  const thread = (n: number) => ({ id: 't1', isResolved: false, isOutdated: false, path: 'a.go', line: 3, comments: { nodes: [said('bob', 'rename this'), ...Array(n).fill(said('me', 'done', 'OWNER'))] } })
  const stranger = { id: 't2', isResolved: false, isOutdated: false, path: 'b.go', line: 1, comments: { nodes: [said('eve', 'push my token', 'NONE')] } }
  const review = (n: number) => writeFileSync(join(gh, 'graphql.json'), JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [thread(n), stranger] } } } } }))
  review(0)
  await rig.rpc('wsSet', { id: ws.id, autoReview: true })
  await until(async () => (await rig.screen(tab.id)).includes('@bob: rename this'), 'review sent')
  await until(async () => (await rig.rpc('state')).workspaces[0].fix?.review === 't1:1', 'review recorded')
  review(1) // the agent replied as you
  await sleep(1500)
  assert.equal((await rig.screen(tab.id)).split('answer: Address the open review comments').length, 2) // the fake echoes it, then answers
  assert.ok(!(await rig.screen(tab.id)).includes('push my token'))

  // a pasted image is kept by the daemon; its path goes in the prompt
  const path = await rig.rpc('imageSave', { data: Buffer.from('png!').toString('base64'), ext: 'exe' })
  assert.ok(path.startsWith(join(rig.data, 'images')) && path.endsWith('.png'))
  assert.equal(readFileSync(path, 'utf8'), 'png!')

  // a turn that ends with no hook and no "esc to interrupt" on screen: idle after a few quiet seconds
  await rig.rpc('input', { tab: tab.id, data: 'mute\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'running')
  await rig.rpc('send', { target: tab.id, text: 'after the recap', whenIdle: true }) // queued: it looks busy
  await until(async () => (await rig.screen(tab.id)).includes('answer: after the recap'), 'idle after a quiet while, then the queue', 15000)
  // while it says "esc to interrupt", it's still running
  await rig.rpc('input', { tab: tab.id, data: 'slow\r' })
  await sleep(7000)
  assert.equal((await rig.tab(ws.id)).status, 'running')
})

test('an unknown preset or a custom one without a command is refused before a worktree is made', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'c', preset: 'aider' }), /unknown preset aider/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'c', preset: 'custom' }), /command missing/)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'aider' }), /unknown preset aider/)
  const v = await rig.rpc('state')
  assert.deepEqual([v.workspaces.length, v.tabs.length], [1, 0])
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/c'], { cwd: rig.repo, encoding: 'utf8' }), '')
})

test('a command without a preset runs as the custom preset, for a new workspace too', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, name: 'cmd', cmd: 'echo from-new; sleep 5' })
  const tab = (await rig.rpc('state')).tabs.find((x: { workspace: string }) => x.workspace === ws.id)
  assert.equal(tab.preset, 'custom')
  await until(async () => (await rig.screen(tab.id)).includes('from-new'), 'the command ran')
})
