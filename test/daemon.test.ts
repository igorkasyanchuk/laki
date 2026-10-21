// The daemon end to end: real PTYs, git worktrees, hooks via the CLI, fake agents.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

test('a new worktree gets the ignored files .worktreeinclude and .laki.json copy name, with their modes, before setup', async t => {
  const rig = await fresh(t, { config: { setup: 'cat .env .env.local secrets/key > seen.txt', copy: ['secrets/'] } })
  const put = (f: string, s: string) => (mkdirSync(dirname(join(rig.repo, f)), { recursive: true }), writeFileSync(join(rig.repo, f), s))
  put('.env', 'A=1\n')
  chmodSync(join(rig.repo, '.env'), 0o600)
  put('.env.local', 'B=2\n')
  put('secrets/key', 'k\n')
  put('sub/.env', 'not this\n') // /.env: the root's only
  put('.env.prod', 'nor this\n')
  symlinkSync('/etc/hosts', join(rig.repo, '.env.link')) // out of the repo: never
  put('.worktreeinclude', '# what new worktrees get\n/.env\n.env.local\n.env.link\n')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const seen = join(ws.path, 'seen.txt')
  await until(() => existsSync(seen) && readFileSync(seen, 'utf8').length >= 8, 'setup read them')
  assert.equal(readFileSync(seen, 'utf8'), 'A=1\nB=2\nk\n')
  assert.equal(statSync(join(ws.path, '.env')).mode & 0o777, 0o600)
  for (const f of ['sub/.env', '.env.prod', '.env.link']) assert.ok(!existsSync(join(ws.path, f)), f)
})

test(".laki.json's trust: untrusted, its setup and env wait; trusting runs them; an edit stops them; ZDOTDIR refused; older projects trusted", async t => {
  const rig = await fresh(t, { config: { setup: 'echo "$FOO-$ZDOTDIR" > env.txt', env: { FOO: 'bar', ZDOTDIR: '/tmp/evil' }, ports: { 3000: 'web' } } })
  const p = await rig.rpc('projectAdd', { path: rig.repo, untrusted: true })
  const proj = async () => (await rig.rpc('state')).projects.find((x: { id: string }) => x.id === p.id)
  assert.ok((await proj()).cfgWait)
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await sleep(1500)
  assert.ok(!existsSync(join(a.path, 'env.txt')), "an untrusted file's setup doesn't run")
  const ws = async (id: string) => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === id)
  assert.equal((await ws(a.id)).setupWait, true)
  assert.deepEqual((await ws(a.id)).portNames, { 3000: 'web' }) // names only: those stay
  // the sheet: its text and hash; a hash it isn't is refused
  const look = await rig.rpc('projectTrust', { id: p.id })
  assert.equal(look.trusted, false)
  assert.match(look.text, /"setup": "echo/)
  await assert.rejects(rig.rpc('projectTrust', { id: p.id, hash: 'nope' }), /changed since you looked/)
  await rig.rpc('projectTrust', { id: p.id, hash: look.hash })
  assert.equal((await proj()).cfgWait, undefined)
  // trusting runs the setup that waited, with its env, ZDOTDIR refused (and said once)
  await until(() => existsSync(join(a.path, 'env.txt')), 'the waiting setup runs')
  assert.equal(readFileSync(join(a.path, 'env.txt'), 'utf8'), 'bar-\n')
  assert.equal((await ws(a.id)).setupWait, undefined)
  assert.equal(rig.out.split(".laki.json's env ZDOTDIR refused").length, 2) // said once
  // an edit: untrusted again, a new workspace's setup waits
  writeFileSync(join(rig.repo, '.laki.json'), JSON.stringify({ setup: 'touch edited' }))
  assert.ok((await proj()).cfgWait)
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await sleep(1500)
  assert.ok(!existsSync(join(b.path, 'edited')), "an edited file's setup doesn't run")
  // a project from before trust (no cfgTrust in state.json): trusted as its file is
  await rig.stop()
  const sp = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(sp, 'utf8'))
  delete st.cfgTrust
  writeFileSync(sp, JSON.stringify(st))
  await rig.start()
  assert.equal((await proj()).cfgWait, undefined)
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
  assert.match(again.id, /^feat-one-[a-z0-9]{4}$/)
  assert.equal(again.branch, `laki/${again.id}`)
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
  // typing from b gives the PTY b's size back (a Mac after a phone); c resizing takes it again
  b.notify('input', { tab: tab.id, data: 'stty size\r' })
  await until(() => c.data(tab.id).split('30 100')[1]?.includes('20 90'), "b's size")
  c.notify('resize', { tab: tab.id, cols: 70, rows: 25 })
  c.notify('input', { tab: tab.id, data: 'stty size\r' })
  await until(() => b.data(tab.id).includes('25 70'), "c's new size")
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

test('agent variables: {{branch}}, {{tab}}… filled where asked (vars: a template, an action, a schedule), a message as typed', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'on {{ branch }} at {{port}}', vars: true })
  await until(async () => (await rig.tab(ws.id)).last === `answer: on ${ws.branch} at ${ws.port}`, 'first prompt filled')
  const tab = await rig.tab(ws.id) // named by its first prompt by now
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.pr, 'its PR scanned')
  // an action's: the fake gh has PR 42 for every branch; an unknown {{name}} and a date token stay
  await rig.rpc('send', { target: ws.id, text: '{{tab}}/{{agent}} in {{project}} ({{workspace}}), {{pr}}, {{nope}} {{DD}}', vars: true })
  await until(async () => /^answer: .+\/claude in repo \(.+\), https:\/\/\S+\/42, \{\{nope\}\} \{\{DD\}\}$/.test((await rig.tab(ws.id)).last), 'action filled')
  assert.ok((await rig.tab(ws.id)).last.startsWith(`answer: ${tab.name}/claude in repo (${ws.name ?? ws.id})`))
  // a message as typed: left alone
  await rig.rpc('send', { target: ws.id, text: 'keep {{branch}}' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: keep {{branch}}', 'message kept')
  // a shell's: a value it would read as code goes in quoted, a plain one as it is
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  await rig.rpc('tabSet', { id: sh.id, name: 'x;echo PWNED' })
  await new Promise(r => setTimeout(r, 800)) // its prompt
  await rig.rpc('send', { target: sh.id, text: 'echo {{tab}} > {{path}}/vars.txt', vars: true })
  await until(() => existsSync(join(ws.path, 'vars.txt')) && readFileSync(join(ws.path, 'vars.txt'), 'utf8') === 'x;echo PWNED\n', 'quoted for the shell')
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

test("codex: a sub-agent's turn end leaves the chat's own turn running", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'codex' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('fake codex'), 'codex up')
  await rig.rpc('send', { target: ws.id, text: 'sub task' })
  await new Promise(r => setTimeout(r, 2500)) // the sub-agent's notify came, and the wait after it
  let tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'running')
  assert.equal(tv.resumeId, undefined) // not the sub-agent's thread
  await until(async () => (await rig.tab(ws.id)).last === 'answer: sub task', 'its own end')
  tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.match(tv.resumeId, /^thread-(?!sub)/)
  // the chat's own end comes while the screen still says Working: it, not the sub-agent's before it, ends the turn
  await rig.rpc('send', { target: ws.id, text: 'near task' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: near task', 'its own end, late')
  await new Promise(r => setTimeout(r, 1700)) // past both waits
  tv = await rig.tab(ws.id)
  assert.equal(tv.last, 'answer: near task')
  assert.match(tv.resumeId, /^thread-(?!sub)/)
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

test("file preview edits: saved with the file's mode, refused over a change unless forced, only whole UTF-8 text inside", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const file = join(ws.path, 'run.sh')
  writeFileSync(file, 'echo hi\n', { mode: 0o755 })
  const save = (o: object) => rig.rpc('fileWrite', { ws: ws.id, path: 'run.sh', ...o })
  assert.deepEqual(await save({ text: 'echo hello\n', was: 'echo hi\n' }), { size: 11 })
  assert.equal(readFileSync(file, 'utf8'), 'echo hello\n')
  assert.equal(statSync(file).mode & 0o777, 0o755)
  // an agent changed it meanwhile: refused, unless asked to save over it
  writeFileSync(file, 'echo agent\n')
  await assert.rejects(save({ text: 'mine\n', was: 'echo hello\n' }), /run\.sh changed since you opened it/)
  assert.equal(readFileSync(file, 'utf8'), 'echo agent\n')
  await save({ text: 'mine\n', was: 'echo hello\n', force: true })
  assert.equal(readFileSync(file, 'utf8'), 'mine\n')
  // what the preview can't show whole, or as its bytes, isn't saved over
  writeFileSync(join(ws.path, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'latin1.txt' })).lossy, true)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'latin1.txt', text: 'x', force: true }), /can't be edited here/)
  writeFileSync(join(ws.path, 'big.txt'), 'x'.repeat((512 << 10) + 1))
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'big.txt', text: 'x', force: true }), /can't be edited here/)
  await assert.rejects(save({ text: 'x'.repeat((512 << 10) + 1), force: true }), /over 512 KB/)
  writeFileSync(join(ws.path, 'bin'), Buffer.from([0, 1, 2]))
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'bin', text: 'x', force: true }), /can't be edited here/)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: '../escape.txt', text: 'x', force: true }), /inside the workspace/)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'nope.txt', text: 'x', force: true }), /isn't a file|ENOENT/)
  assert.ok(!existsSync(join(ws.path, 'nope.txt')))
})

test('side panel: files with their changes, new files and folders, only inside the workspace', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.deepEqual(await rig.rpc('prThreads', { ws: ws.id }), []) // no PR yet: the fake gh gives every branch one at the first scan, 2 s after the daemon starts
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
  // links: one pointing out (a file, a folder, nothing) is out; one pointing in is fine
  symlinkSync('/etc/hosts', join(ws.path, 'hosts'))
  symlinkSync(rig.home, join(ws.path, 'home'))
  symlinkSync(join(rig.home, 'nope'), join(ws.path, 'gone'))
  symlinkSync('README.md', join(ws.path, 'readme'))
  await assert.rejects(rig.rpc('fileRead', { ws: ws.id, path: 'hosts' }), /inside the workspace/)
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'home/escape.txt' }), /inside the workspace/)
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'gone' }), /inside the workspace/)
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'finder', file: 'home' }), /inside the workspace/)
  assert.ok(!existsSync(join(rig.home, 'escape.txt')))
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'readme' })).text, 'changed\n')
  f = await rig.rpc('files', { ws: ws.id })
  assert.ok(f.files.includes('src/lib/a.ts'))
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

test('agent skill: installed in HOME for each agent, its launcher drives the daemon, removed again', async t => {
  const rig = await fresh(t)
  await rig.rpc('projectAdd', { path: rig.repo })
  const states = (s: { state: string }[]) => s.map(x => x.state)
  assert.deepEqual(states(await rig.rpc('skills')), Array(10).fill('missing')) // laki's, then laki-widget's
  assert.deepEqual(states((await rig.rpc('skillSet', { agent: 'claude', on: true })).slice(0, 2)), ['installed', 'missing'])
  const at = join(rig.home, '.claude/skills/laki')
  assert.match(readFileSync(join(at, 'SKILL.md'), 'utf8'), /^---\nname: laki\ndescription: /)
  // the launcher finds this daemon from a bare environment, as an agent's shell would
  const ls = JSON.parse(execFileSync(join(at, 'laki'), ['ls', '--json'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' }))
  assert.equal(ls.projects.length, 1)
  writeFileSync(join(at, 'SKILL.md'), 'edited')
  assert.deepEqual(states((await rig.rpc('skills')).slice(0, 2)), ['outdated', 'missing'])
  assert.deepEqual(states((await rig.rpc('skillSet', { agent: 'codex', on: true })).slice(0, 2)), ['outdated', 'installed'])
  assert.ok(existsSync(join(rig.home, '.codex/skills/laki/SKILL.md')))
  writeFileSync(join(at, 'notes.md'), 'the user’s')
  assert.deepEqual(states((await rig.rpc('skillSet', { agent: 'claude', on: false })).slice(0, 2)), ['missing', 'installed'])
  assert.ok(existsSync(join(at, 'notes.md')) && !existsSync(join(at, 'SKILL.md'))) // only its own files go
  await rig.rpc('skillSet', { agent: 'codex', on: false })
  assert.ok(!existsSync(join(rig.home, '.codex/skills/laki'))) // an emptied folder goes too
  // the others' folders, and how each adds Laki's MCP server (opencode: lines for its config)
  const all = await rig.rpc('skillSet', { agent: 'opencode', on: true })
  assert.ok(existsSync(join(rig.home, '.config/opencode/skills/laki/SKILL.md')))
  assert.deepEqual(all.map((x: { path: string }) => x.path.slice(rig.home.length)).slice(0, 6), ['/.claude/skills/laki', '/.codex/skills/laki', '/.gemini/skills/laki', '/.grok/skills/laki', '/.config/opencode/skills/laki', '/.claude/skills/laki-widget'])
  const mcp = Object.fromEntries(all.filter((x: { skill: string }) => x.skill === 'laki').map((x: { agent: string; mcp: string }) => [x.agent, x.mcp]))
  assert.match(mcp.gemini, /^gemini mcp add -s user laki '\/usr\/bin\/env' /)
  assert.match(mcp.grok, /^grok mcp add -s user laki -- '\/usr\/bin\/env' /)
  assert.equal(JSON.parse(mcp.opencode).mcp.laki.command.at(-1), 'mcp')
  assert.equal(all[4].mcpIn, '~/.config/opencode/opencode.json')
  await rig.rpc('skillSet', { agent: 'opencode', on: false })
  // the widget creator: a skill of its own, its own launcher, no MCP
  const wid = (await rig.rpc('skillSet', { agent: 'claude', on: true, skill: 'laki-widget' })).find((x: { skill: string; agent: string }) => x.skill === 'laki-widget' && x.agent === 'claude')
  assert.deepEqual([wid.state, wid.mcp], ['installed', ''])
  assert.match(readFileSync(join(rig.home, '.claude/skills/laki-widget/SKILL.md'), 'utf8'), /^---\nname: laki-widget\n[\s\S]*laki widget reload/)
  assert.ok(!existsSync(join(rig.home, '.claude/skills/laki/SKILL.md')), 'laki stays out')
  await assert.rejects(rig.rpc('skillSet', { agent: 'claude', on: true, skill: 'nope' }), /no skill/)
  await assert.rejects(rig.rpc('skillSet', { agent: 'aider', on: true }), /no agent/)
  await assert.rejects(rig.rpc('skillSet', { agent: 'constructor', on: true }), /no agent/) // not an inherited key
  // a daemon start writes an outdated one again (a Laki update), never one of another data dir
  const wsk = join(rig.home, '.claude/skills/laki-widget/SKILL.md')
  writeFileSync(wsk, 'old')
  await rig.rpc('skillSet', { agent: 'codex', on: true })
  const other = join(rig.home, '.codex/skills/laki')
  writeFileSync(join(other, 'laki'), readFileSync(join(other, 'laki'), 'utf8').replace(`LAKI_HOME=${rig.data}`, 'LAKI_HOME=/elsewhere'))
  writeFileSync(join(other, 'SKILL.md'), 'old')
  await rig.stop()
  await rig.start()
  assert.match(readFileSync(wsk, 'utf8'), /^---\nname: laki-widget/)
  assert.equal(readFileSync(join(other, 'SKILL.md'), 'utf8'), 'old')
  // the app's bar leaves another Laki's out (foreign); one of this data dir's edited is only outdated
  writeFileSync(wsk, 'edited')
  const rows = await rig.rpc('skills')
  const of = (agent: string, skill: string) => rows.find((x: { agent: string; skill: string }) => x.agent === agent && x.skill === skill)
  assert.deepEqual([of('codex', 'laki').state, of('codex', 'laki').foreign], ['outdated', true])
  assert.deepEqual([of('claude', 'laki-widget').state, of('claude', 'laki-widget').foreign], ['outdated', undefined])
})

test('ports of the workspace process tree, their names, stopping one; PR from gh, dev server', async t => {
  // listens on a free port (3100+ may be taken on this machine) and says which, and what $PORT was; shrugs off SIGTERM
  const rig = await fresh(t, {
    config: {
      run: `exec node -e 'process.on("SIGTERM", () => {}); const s = require("http").createServer().listen(0, "127.0.0.1", () => console.log("listening " + s.address().port + " PORT=" + process.env.PORT))'`,
      ports: { '3100': 'web', '3200': { name: 'api' } }, // not a string: left out
    },
  })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const dev = await rig.rpc('run', { ws: ws.id })
  assert.equal(dev.name, 'dev')
  const m = (await until(async () => (await rig.screen(dev.id)).match(/listening (\d+) PORT=(\d+)/), "dev server up"))!
  assert.equal(Number(m[2]), ws.port)
  await until(async () => (await rig.rpc('state')).workspaces[0].ports.includes(Number(m[1])), 'port scanned')
  const pr = await until(async () => (await rig.rpc('state')).workspaces[0].pr, 'PR scanned')
  assert.deepEqual({ ...pr, list: undefined }, { number: 42, state: 'OPEN', url: 'https://example.invalid/pr/42', checks: 'pending', list: undefined })
  // what listens, by name; the ✕: SIGTERM, then SIGKILL as it's ignored
  const w = (await rig.rpc('state')).workspaces[0]
  assert.deepEqual(w.portNames, { '3100': 'web' })
  assert.equal(w.procs[m[1]].cmd, 'node')
  await assert.rejects(rig.rpc('portKill', { ws: ws.id, port: 1 }), /nothing of \S+ listens on :1/)
  assert.equal((await rig.rpc('portKill', { ws: ws.id, port: Number(m[1]) })).pid, w.procs[m[1]].pid)
  await sleep(1500)
  assert.ok((await rig.rpc('state')).workspaces[0].ports.includes(Number(m[1])), 'SIGTERM shrugged off')
  await until(async () => !(await rig.rpc('state')).workspaces[0].ports.includes(Number(m[1])), 'killed, gone from the list', 6000)
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
  assert.deepEqual(await rig.rpc('branches', { project: np.id }), { current: '', branches: [], main: '' })
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
  const templates = [{ name: 'fix', text: 'Fix {{prompt}}', extra: 1 }, { name: 'bad' }, { text: 'no name' }]
  const withActions = await rig.rpc('projectSet', { id: p.id, config: { run: 'echo from-app', actions, templates } })
  assert.deepEqual(withActions.config.actions, [actions[0], actions[1], actions[2], actions[4]].map((a, i) => ({ ...a, slug: ['review', 'migrate', 'action', 'y'][i] }))) // each with a slug
  assert.deepEqual(withActions.config.templates, [{ name: 'fix', text: 'Fix {{prompt}}' }])
  // and the run script still comes from the config with them in it
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  const dev = await rig.rpc('run', { ws: ws.id })
  await until(async () => (await rig.screen(dev.id)).includes('from-app'), 'the app config wins over .laki.json')
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

test('presets: args and env on top of the project env; Esc ends a turn; reorder; workspace color and pin', async t => {
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
  await rig.rpc('wsSet', { id: ws2.id, color: 'pink', pinned: true })
  const v = await rig.rpc('state')
  assert.deepEqual(v.workspaces.map((w: any) => w.id), [ws2.id, ws.id])
  assert.equal(v.workspaces[0].color, 'pink')
  assert.equal(v.workspaces[0].pinned, true)
  assert.equal(v.workspaces[0].run, false)
  await rig.rpc('wsSet', { id: ws2.id, pinned: false }) // unpinned: the field goes
  assert.equal((await rig.rpc('state')).workspaces[0].pinned, undefined)

  // seps: named lines between a project's workspaces; a bad one is dropped, a drag keeps the whole order
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: '  Later  ' }, { id: 'bad id', name: 'x' }, { id: 'sep-b2', name: ' ' }, { id: 'sep-a1', name: 'again' }], rows: [ws2.id, 'sep-a1', ws.id, 7] })
  let pr = (await rig.rpc('state')).projects[0]
  assert.deepEqual(pr.seps, [{ id: 'sep-a1', name: 'Later' }])
  // a sep's color: a color's name, kept; none or a bad one, none
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', color: 'teal' }] })
  assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later', color: 'teal' }])
  for (const color of ['none', 'url(x)', 7]) {
    await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', color }] })
    assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later' }])
  }
  // its default prompt template: a name, kept trimmed; empty or not a string, none
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', template: ' Bugfix ' }] })
  assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later', template: 'Bugfix' }])
  for (const template of ['', '  ', 7, null]) {
    await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', template }] })
    assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later' }])
  }
  // a sep's sort (manual too: over the project's); the project's own, manual or a bad one: none
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later', sort: 'name' }, { id: 'sep-b1', name: 'B', sort: 'manual' }, { id: 'sep-c1', name: 'C', sort: 'size' }] })
  assert.deepEqual((await rig.rpc('state')).projects[0].seps, [{ id: 'sep-a1', name: 'Later', sort: 'name' }, { id: 'sep-b1', name: 'B', sort: 'manual' }, { id: 'sep-c1', name: 'C' }])
  await rig.rpc('projectSet', { id: p.id, sort: 'activity' })
  assert.equal((await rig.rpc('state')).projects[0].sort, 'activity')
  for (const sort of ['manual', 'size']) {
    await rig.rpc('projectSet', { id: p.id, sort })
    assert.equal((await rig.rpc('state')).projects[0].sort, undefined)
  }
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a1', name: 'Later' }] })
  assert.deepEqual(pr.rows, [ws2.id, 'sep-a1', ws.id])
  await rig.rpc('reorder', { workspaces: ['sep-a1', ws.id, ws2.id] })
  const v2 = await rig.rpc('state')
  assert.deepEqual(v2.projects[0].rows, ['sep-a1', ws.id, ws2.id])
  assert.deepEqual(v2.workspaces.map((w: any) => w.id), [ws.id, ws2.id])
  // a new workspace's place: first under a sep, first in the project, or last
  const under = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'under', place: 'sep-a1' })
  const top = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'top', place: 'top' })
  const last = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'last' })
  assert.deepEqual((await rig.rpc('state')).projects[0].rows, [top.id, 'sep-a1', under.id, ws.id, ws2.id])
  const order = () => rig.rpc('state').then((v: any) => v.workspaces.map((w: any) => w.id))
  assert.equal((await order()).at(-1), last.id)
  await rig.rpc('projectSet', { id: p.id, seps: [] }) // the last one gone: so is the order
  pr = (await rig.rpc('state')).projects[0]
  assert.equal(pr.seps, undefined)
  assert.equal(pr.rows, undefined)
  const first = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'first', place: 'top' }) // no seps: the workspaces' order
  assert.equal((await order())[0], first.id)
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

test('a model and effort go into the agent\'s flags (a wrong one makes nothing); a turn\'s start; the board\'s to-dos', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', model: 'opus; rm -rf ~' }), /model opus; rm -rf ~\?/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', effort: 'huge' }), /effort huge\? low, medium, high, xhigh, max/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', effort: 'high' }), /gemini takes no effort/)
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/m'], { cwd: rig.repo, encoding: 'utf8' }), '')

  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', model: ' opus ', effort: 'high' })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.model, tab.effort, tab.runAt], ['opus', 'high', undefined])
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'claude').args.slice(-4), ['--model', 'opus', '--effort', 'high'])
  // runAt: while a turn goes, from its start
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'settled') // the fake's first turn (an Enter at start)
  const before = Date.now()
  await rig.rpc('input', { tab: tab.id, data: 'slow work\r' })
  const at = await until(async () => (await rig.tab(ws.id)).runAt, 'a turn started')
  assert.ok(at >= before && at <= Date.now())
  await new Promise(r => setTimeout(r, 100))
  assert.equal((await rig.tab(ws.id)).runAt, at) // the same turn: the same start
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle after Esc')
  assert.equal((await rig.tab(ws.id)).runAt, undefined)
  // a fork keeps them
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.deepEqual([(await rig.tab(fork.id)).model, (await rig.tab(fork.id)).effort], ['opus', 'high'])

  const cx = await rig.rpc('wsNew', { project: p.id, preset: 'codex', model: 'gpt-x', effort: 'low' })
  await until(() => rig.fakeLog().some(l => l.bin === 'codex'), 'codex')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'codex').args.slice(-4), ['-m', 'gpt-x', '-c', 'model_reasoning_effort="low"'])
  assert.equal((await rig.tab(cx.id)).effort, 'low')

  // to-dos: a project's prompts, waiting
  await assert.rejects(rig.rpc('todoAdd', { project: p.id, text: ' ' }), /needs its text/)
  await assert.rejects(rig.rpc('todoAdd', { project: 'nope', text: 'x' }))
  const todo = await rig.rpc('todoAdd', { project: p.id, text: ' fix the footer ' })
  assert.deepEqual((await rig.rpc('state')).todos, [{ ...todo, text: 'fix the footer' }])
  await rig.rpc('todoRm', { id: todo.id })
  assert.deepEqual((await rig.rpc('state')).todos, [])
  // a to-do's pasted images: imageSave's only, the image alone is enough
  const img = await rig.rpc('imageSave', { data: Buffer.from('png').toString('base64'), ext: 'png' })
  const shot = await rig.rpc('todoAdd', { project: p.id, text: '', images: [img, '/etc/passwd', `${img}/../../state.json`, 7] })
  assert.deepEqual(shot.images, [img])
  // a waiting to-do's image outlives imageDays (the tidy at each imageSave); one no to-do holds goes
  const then = Date.now() - 400 * 86400e3
  const old = (n: string) => join(rig.data, 'images', `${then}-${n}.png`)
  writeFileSync(old('held'), 'png')
  writeFileSync(old('loose'), 'png')
  const held = await rig.rpc('todoAdd', { project: p.id, text: 'look', images: [old('held')] })
  await rig.rpc('imageSave', { data: Buffer.from('png').toString('base64'), ext: 'png' })
  assert.equal(existsSync(old('held')), true)
  assert.equal(existsSync(old('loose')), false)
  await rig.rpc('todoRm', { id: held.id })
  await rig.rpc('todoRm', { id: shot.id })

  // a model isn't a flag; one picked comes after a preset's own args, so it wins
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id, preset: 'claude', model: '-p' }), /model -p\?/)
  await rig.rpc('settingsSet', { presets: [{ name: 'fast', agent: 'claude', args: '--model sonnet' }] })
  const n = rig.fakeLog().filter(l => l.bin === 'claude').length
  await rig.rpc('tabNew', { ws: ws.id, preset: 'fast', model: 'haiku' })
  await until(() => rig.fakeLog().filter(l => l.bin === 'claude').length > n, 'the preset\'s claude')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'claude')[n].args.slice(-4), ['--model', 'sonnet', '--model', 'haiku'])
})

test('worktrees go to Settings’ folder (~: home), a folder per project, or the project’s own (relative: to the repo); made ones stay', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const home = rig.env.HOME
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal(a.path, join(rig.env.LAKI_HOME, 'worktrees', p.id, a.id))
  mkdirSync(join(home, 'mine'), { mode: 0o755 })
  await rig.rpc('settingsSet', { worktrees: '~/mine/trees' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal(b.path, join(home, 'mine', 'trees', p.id, b.id))
  assert.ok(existsSync(join(b.path, '.git')))
  // the folders Laki made are yours alone; the one you had stays as it was
  assert.deepEqual([join(home, 'mine', 'trees'), join(home, 'mine', 'trees', p.id), join(home, 'mine')].map(d => statSync(d).mode & 0o777), [0o700, 0o700, 0o755])
  await rig.rpc('projectSet', { id: p.id, config: { worktrees: '../wt' } })
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal(c.path, join(realpathSync(home), 'wt', c.id)) // the repo's real path
  const ws = (await rig.rpc('state')).workspaces
  assert.deepEqual(ws.map((w: any) => w.path), [a.path, b.path, c.path])
})

test("a permission mode and fast mode go into the agent's flags, kept for restarts and forks", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'claude', perm: 'yolo' }), /permission mode yolo\? auto, acceptEdits, plan, bypassPermissions/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', perm: 'auto' }), /gemini has no permission modes/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'm', preset: 'gemini', fast: true }), /gemini has no fast mode/)
  assert.equal(execFileSync('git', ['branch', '--list', 'laki/m'], { cwd: rig.repo, encoding: 'utf8' }), '')

  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', perm: 'plan', fast: true })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.perm, tab.fast], ['plan', true])
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude')
  const args = rig.fakeLog().find(l => l.bin === 'claude').args
  assert.deepEqual(args.slice(-2), ['--permission-mode', 'plan'])
  const settings = args[args.indexOf('--settings') + 1]
  assert.match(settings, /claude-settings-fast\.json$/)
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).fastMode, true)
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'prompt')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'settled') // its chat's id: a fork resumes it
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.deepEqual([(await rig.tab(fork.id)).perm, (await rig.tab(fork.id)).fast], ['plan', true])

  const cx = await rig.rpc('wsNew', { project: p.id, preset: 'codex', perm: 'acceptEdits', fast: true })
  await until(() => rig.fakeLog().some(l => l.bin === 'codex'), 'codex')
  assert.deepEqual(rig.fakeLog().find(l => l.bin === 'codex').args.slice(-6), ['-s', 'workspace-write', '-a', 'never', '-c', 'service_tier="fast"'])
  assert.equal((await rig.tab(cx.id)).perm, 'acceptEdits')
})
