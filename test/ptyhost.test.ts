// R6: the pty host (src/ptyhost): its protocol over the socket, a host of another version started again only when it
// holds no live terminal, and a daemon killed mid-command that finds its terminals still running when it starts again
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { frame, PTY_PROTO, reader } from '../src/ptyhost/proto.ts'
import { fresh, until } from './helpers.ts'

const hostTs = fileURLToPath(new URL('../src/ptyhost/main.ts', import.meta.url))
const running = (pid: number) => {
  try {
    return process.kill(pid, 0)
  } catch {
    return false
  }
}
// a host in a data folder of its own, and a client of it: what it sent, and ask (a reply by its `re`)
function host(home: string, env: Record<string, string> = {}) {
  return spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', hostTs], { env: { ...process.env, LAKI_HOME: home, LAKI_TEST_PARENT: String(process.pid), ...env }, stdio: 'ignore' })
}
async function client(home: string) {
  const path = join(home, 'pty.sock')
  await until(() => existsSync(path), 'the socket')
  const s = (await until(() => new Promise<Socket | false>(r => (c => (c.once('connect', () => r(c)), c.once('error', () => r(false))))(connect(path))), 'a connection')) as Socket
  const got: any[] = []
  s.on('data', reader(m => got.push(m)))
  let seq = 0
  const post = (m: object) => void s.write(frame(m))
  const ask = async (m: object) => (re => (post({ ...m, re }), until(() => got.find(x => x.re === re), `a reply to ${JSON.stringify(m)}`)))(++seq)
  const text = (id: string) => got.filter(x => x.ev === 'data' && x.id === id).map(x => x.d).join('')
  return { s, got, post, ask, text }
}
// a client once the host takes it: the host may not have seen the last one go yet (it takes one at a time), and a
// connection it closes is tried again at once, not waited on
const own = async (home: string) =>
  (await until(() => client(home).then(c => Promise.race([c.ask({ op: 'hello' }).then(() => c, () => false as const), new Promise<false>(r => c.s.once('close', () => r(false)))])), 'a connection of its own')) as Awaited<ReturnType<typeof client>>

test('the pty host: a socket of the user alone; spawn, write, resize, attach from an offset, kill, list, forget; ops it has no name for are nothing; quit', async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-pty-'))
  const h = host(home)
  t.after(() => (h.kill('SIGKILL'), rmSync(home, { recursive: true, force: true })))
  const a = await client(home)
  assert.equal(statSync(join(home, 'pty.sock')).mode & 0o777, 0o600)
  assert.deepEqual((({ version, pid }) => ({ version, pid }))(await a.ask({ op: 'hello' })), { version: PTY_PROTO, pid: h.pid })
  a.post({ op: 'spawn', id: 'one', file: '/bin/sh', args: ['-c', 'echo hello; read x; echo "got $x"; stty size; sleep 30'], cwd: home, env: { PATH: process.env.PATH ?? '' }, cols: 90, rows: 20 })
  const pid = (await until(() => a.got.find(x => x.ev === 'spawned' && x.id === 'one'), 'spawned')).pid
  assert.ok(running(pid))
  await until(() => a.text('one').includes('hello'), 'its first line')
  a.post({ op: 'resize', id: 'one', cols: 100, rows: 30 })
  a.post({ op: 'write', id: 'one', data: 'abc\r' })
  await until(() => a.text('one').includes('30 100'), 'what it read and its new size')
  assert.match(a.text('one'), /got abc/)
  // each data frame says where it starts: together they're the output, gapless
  const frames = a.got.filter(x => x.ev === 'data')
  assert.deepEqual(frames.map(x => x.at), frames.map((_, i) => frames.slice(0, i).reduce((n, x) => n + x.d.length, 0)))
  // one daemon at a time: a second connection is closed at once
  const no = connect(join(home, 'pty.sock'))
  await new Promise(r => no.once('close', r))
  // another connection once that one is gone (a daemon that started again): all of it, or from an offset; then what
  // it prints next
  const was = a.text('one')
  a.s.destroy()
  const b = await own(home)
  const all = await b.ask({ op: 'attach', id: 'one', from: 0 })
  assert.equal(all.d, was)
  assert.deepEqual([all.pid, all.cols, all.rows, all.exit, all.cut], [pid, 100, 30, undefined, false])
  assert.equal((await b.ask({ op: 'attach', id: 'one', from: 5 })).d, was.slice(5))
  assert.equal((await b.ask({ op: 'attach', id: 'none' })).gone, true)
  assert.deepEqual((await b.ask({ op: 'list' })).ptys.map((p: any) => [p.id, p.pid, p.cols, p.rows, p.exit, p.start, p.end]), [['one', pid, 100, 30, undefined, 0, all.d.length]])
  // an id taken, a spawn that can't be, an op with no name: an exit with its why, or nothing
  b.post({ op: 'spawn', id: 'one', file: '/bin/sh', args: [], cwd: home, env: {} })
  assert.match((await until(() => b.got.find(x => x.ev === 'exit' && x.id === 'one'), 'refused')).error, /there already/)
  for (const op of ['constructor', 'toString', 'readFile', undefined]) b.post({ op, id: 'one', path: '/etc/passwd' })
  assert.equal((await b.ask({ op: 'list' })).ptys.length, 1)
  // killed: its whole job, an exit of 128 + the signal; kept in the list until forgotten
  b.post({ op: 'kill', id: 'one', signal: 'SIGKILL' })
  assert.equal((await until(() => b.got.find(x => x.ev === 'exit' && x.id === 'one' && !x.error), 'its exit')).code, 137)
  await until(() => !running(pid), 'the process gone')
  assert.equal((await b.ask({ op: 'list' })).ptys[0].exit, 137)
  b.post({ op: 'forget', id: 'one' })
  assert.deepEqual((await b.ask({ op: 'list' })).ptys, [])
  // quit ends what still runs, the socket file with it
  b.post({ op: 'spawn', id: 'two', file: '/bin/sleep', args: ['30'], cwd: home, env: {} })
  const two = (await until(() => b.got.find(x => x.ev === 'spawned' && x.id === 'two'), 'spawned')).pid
  b.post({ op: 'quit' })
  await until(() => !running(h.pid!) && !running(two) && !existsSync(join(home, 'pty.sock')), 'the host and its terminal gone')
})

test('the pty host: with no terminal and no daemon it ends by itself; one of another version is started again only when it holds no live terminal', async t => {
  const home = mkdtempSync(join(tmpdir(), 'laki-pty-'))
  process.env.LAKI_HOME = home // ptyHost.ts' data folder, read as it loads
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const idle = host(home, { LAKI_PTY_IDLE_MS: '300' })
  const c = await client(home)
  c.s.destroy()
  await until(() => !running(idle.pid!), 'the idle host gone')
  // one whose daemon never comes back ends too, whatever it still runs
  const lone = host(home, { LAKI_PTY_ORPHAN_MS: '400' })
  const lc = await client(home)
  lc.post({ op: 'spawn', id: 'left', file: '/bin/sleep', args: ['30'], cwd: home, env: {} })
  const left = (await until(() => lc.got.find(x => x.ev === 'spawned'), 'its terminal')).pid
  assert.ok(running(lone.pid!) && running(left))
  lc.s.destroy()
  await until(() => !running(lone.pid!) && !running(left), 'the orphaned host and its terminal gone')
  const old = host(home, { LAKI_PTY_VERSION: '7' })
  t.after(() => void old.kill('SIGKILL'))
  const raw = await client(home)
  raw.post({ op: 'spawn', id: 'busy', file: '/bin/sleep', args: ['30'], cwd: home, env: {} })
  await until(() => raw.got.find(x => x.ev === 'spawned'), 'its terminal')
  raw.s.destroy()
  const pty = await import('../src/daemon/ptyHost.ts')
  await until(() => pty.ptyUp().then(() => true, () => false), 'the host takes this daemon')
  assert.equal(pty.ptyOn(), true)
  assert.deepEqual((await pty.ptyList()).map(p => p.id), ['busy']) // kept: a turn isn't ended for an update
  assert.ok(running(old.pid!))
  pty.ptyClose()
  await until(() => !pty.ptyOn(), 'the connection closed')
  assert.equal(pty.ptyPid(), old.pid)
  const raw2 = await own(home)
  raw2.post({ op: 'forget', id: 'busy' })
  await raw2.ask({ op: 'list' })
  raw2.s.destroy()
  await until(() => pty.ptyUp().then(() => pty.ptyPid() !== old.pid, () => false), 'none live now: quit, and one of this version started')
  await until(() => !running(old.pid!), 'the old host gone')
  assert.deepEqual(await pty.ptyList(), [])
  const hello = { pid: pty.ptyPid() }
  t.after(() => void (running(hello.pid) && process.kill(hello.pid, 'SIGKILL')))
  // a HostPty as Session uses it: output, exit, and a host that goes takes its terminals with a line saying so
  const p = new pty.HostPty('t1', { file: '/bin/sh', args: ['-c', 'echo up; sleep 30'], cwd: home, env: {}, cols: 80, rows: 24 })
  let out = ''
  let exit: number | undefined
  p.onData(d => (out += d))
  p.onExit(e => (exit = e.exitCode))
  assert.equal(p.pid, -1) // never 0 before the host says
  await until(() => out.includes('up') && p.pid > 0, 'its output and pid')
  process.kill(hello.pid, 'SIGKILL')
  await until(() => exit === 1, 'its exit')
  assert.match(out, /the pty host is gone/)
  assert.equal(pty.ptyOn(), false)
  pty.ptyClose() // and no new one started for this test
})

test("a daemon killed mid-command starts again: the terminal still runs, its output whole, its start's token and keys still its own; laki stop ends them, --keep doesn't", async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { ptyHost: true })
  await until(() => existsSync(join(rig.data, 'pty.sock')), 'the pty host')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'sh' })
  const shell = await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === w.id), 'its shell')
  const target = `${w.id}/${shell.id}`
  const said = join(rig.home, 'said')
  const aw = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'ag' })
  const agent = await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === aw.id && x.kind === 'agent'), 'an agent')
  await until(async () => (await rig.screen(`${aw.id}/${agent.id}`)).includes('> '), 'its prompt')
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === shell.id)?.status !== undefined, 'the shell up')
  await rig.rpc('input', { tab: shell.id, data: `echo "$$ $LAKI_TAB_TOKEN" > ${said}; for i in 1 2 3 4 5 6 7 8; do echo line-$i; sleep 0.4; done\r` })
  await until(async () => (await rig.screen(target)).includes('line-2'), 'its first lines')
  const [pid, token] = readFileSync(said, 'utf8').trim().split(' ')
  const kept = JSON.parse(readFileSync(join(rig.data, 'pty.json'), 'utf8'))
  assert.equal(kept[shell.id].token, token)
  assert.equal(statSync(join(rig.data, 'pty.json')).mode & 0o777, 0o600)
  const post = async (bearer: string) => (await fetch(`http://127.0.0.1:${rig.info().port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method: 'ping', params: {} }) })).status
  assert.equal(await post(token), 200)
  // the daemon dies as a crash does: no shutdown, nothing saved
  const daemon = rig.info().pid
  process.kill(daemon, 'SIGKILL')
  await until(() => !running(daemon), 'the daemon gone')
  assert.ok(running(Number(pid)), 'its shell lives on')
  await rig.start()
  const tab = (await rig.rpc('state')).tabs.find((x: any) => x.id === shell.id)
  assert.ok(tab && !tab.asleep, 'the tab is there, not waiting to start')
  // every line, the ones printed while no daemon ran too, once each
  const screen = (await until(async () => (s => s.includes('line-8') && s)(await rig.screen(target)), 'the rest of its output')) as string
  for (let i = 1; i <= 8; i++) assert.equal(screen.split(`\nline-${i}`).length - 1, 1, `line-${i} once in:\n${screen}`)
  // the agent too: its screen as it was, and its hooks (this start's key, kept) still its own
  assert.match(await rig.screen(`${aw.id}/${agent.id}`), /> /)
  await rig.rpc('send', { target: `${aw.id}/${agent.id}`, text: 'ask' })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === agent.id)?.status === 'waiting', "the agent's hook heard")
  // the same process, typed into as before; its start's token still says who
  await rig.rpc('input', { tab: shell.id, data: 'echo "still $$"\r' })
  await until(async () => (await rig.screen(target)).includes(`still ${pid}`), 'the same shell answers')
  assert.equal(await post(token), 200)
  // stopped with --keep, started again: still there
  assert.equal((await rig.cli('stop', '--keep')).code, 0)
  await until(() => !existsSync(join(rig.data, 'daemon.json')), 'the daemon stopped')
  assert.ok(running(Number(pid)))
  await rig.start()
  await rig.rpc('input', { tab: shell.id, data: 'echo "third $$"\r' })
  await until(async () => (await rig.screen(target)).includes(`third ${pid}`), 'the same shell again')
  // a plain stop ends the terminals and the host
  await rig.stop()
  await until(() => !running(Number(pid)) && !existsSync(join(rig.data, 'pty.sock')), 'the shell and the host gone')
  // the setting turned off, then a crash: the host left behind is ended as the next daemon starts, nothing runs unseen
  await rig.start()
  const again = await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === shell.id && !x.asleep), 'the shell started again')
  const out2 = join(rig.home, 'said2')
  await rig.rpc('input', { tab: again.id, data: `echo $$ > ${out2}\r` })
  const pid2 = Number(await until(() => existsSync(out2) && readFileSync(out2, 'utf8').trim(), 'its pid'))
  await rig.rpc('settingsSet', { ptyHost: false })
  const d2 = rig.info().pid
  process.kill(d2, 'SIGKILL')
  await until(() => !running(d2), 'the daemon gone')
  assert.ok(running(pid2))
  await rig.start()
  await until(() => !running(pid2) && !existsSync(join(rig.data, 'pty.sock')), 'the host and its shell ended')
})
