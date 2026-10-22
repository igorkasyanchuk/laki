// M5: who calls is the tab its process runs in, whatever Origin it sends (any tab can read daemon.json's token and say
// it's the app); a caller that can't be found is refused, never taken for you; the asks, keys and settings that are the
// user's alone; Linux's lookup through /proc
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { connect as net } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { procParent, procPeer } from '../src/daemon/peer.ts'
import { connect, fresh, until } from './helpers.ts'

test("M5: an agent's call is its tab's with Origin: file:// too; answers, keys into an ask and remote access aren't an agent's; another workspace's terminal asks; one that can't be found is refused", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const { id } = await rig.rpc('widgetNew', { kind: 'number', name: 'Probe' })
  await rig.rpc('widgetSet', { id, on: false })
  const { port, token } = rig.info()
  const out = join(rig.home, 'agent-out')
  // its Bash tool: curl with the daemon's token, saying it's the app
  const curl = (method: string, params: object, origin = true) =>
    `curl -s ${origin ? "-H 'Origin: file://' " : ''}-H 'Authorization: Bearer ${token}' --data '${JSON.stringify({ method, params })}' http://127.0.0.1:${port}/rpc >> ${out}; echo >> ${out}`
  const agent = async (...cmds: string[]) => {
    rmSync(out, { force: true })
    await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${cmds.join('; ')}; echo done >> ${out}` })
    await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'the agent ran it', 60000)
    return readFileSync(out, 'utf8').trim().split('\n').slice(0, -1).map(l => JSON.parse(l))
  }
  const [on, ship, sched] = await agent(curl('widgetSet', { id, on: true }), curl('ship', { ws: ws.id, message: 'x', force: true }), curl('scheduleRun', { id: 'nope' }))
  assert.match(on.error, /only you can turn an extension on/)
  assert.match(ship.error, /an agent never overrides a gate/)
  assert.match(sched.error, /an agent can't run a scheduled task now/)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id).on, false)
  // the same from outside any tab, the app's Origin and token: yours
  const app = async (method: string, params: object) => (await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { origin: 'file://', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params }) })).json()
  assert.equal((await app('widgetSet', { id, on: true })).error, undefined)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id).on, true)

  // the user's alone: answers (Laki's ask, Laki AI's, an agent's menu), an extension's files, remote access, the settings
  // remote access can't change; a plain setting goes
  const said = await agent(
    curl('widgetToolAnswer', { req: 'x', allow: 'always' }, false),
    curl('aiAnswer', { id: 'x', n: 0 }),
    curl('answer', { tab, n: 1 }),
    curl('widgetFileSave', { id, path: 'widget.json', text: '{}' }),
    curl('remoteStart', { hours: 1, open: true }),
    curl('settingsSet', { env: { A: '1' } }),
    curl('memoryCompact', { project: p.id }),
    curl('settingsSet', { prScan: 5 }),
  )
  for (const [i, what] of ['answer what Laki asks', "answer Laki AI's questions", "answer an agent's question", "edit an extension's files", 'start remote access', 'change that setting', 'compact memories (they go to a model)'].entries())
    assert.equal(said[i].error, `an agent can't ${what}: it's the user's (ask them)`)
  assert.equal(said[7].error, undefined)
  assert.equal((await rig.rpc('state')).settings.env, undefined)

  // keys: into its own tab while it asks something, refused; another workspace's tab asks first, as a send does
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'other' })
  const shell = (await rig.rpc('tabNew', { ws: other.id })).id
  const win = await connect(rig)
  t.after(() => win.close())
  const keys = agent(curl('input', { tab: shell, data: 'echo hi\r' }))
  const ask = await until(() => win.events.find(m => m.ev === 'toolAsk' && m.cross === 'send'), 'asked in the app', 30000)
  assert.deepEqual([ask.to, ask.target, ask.text], ['other', 'shell', 'echo hi\r'])
  await rig.rpc('widgetToolAnswer', { req: ask.req, allow: 'deny' })
  assert.match((await keys)[0].error, /another workspace: the user said no/)
  const second = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id // its workspace's other agent, asking
  await rig.rpc('hook', { tab: second, state: 'waiting', payload: { message: 'Claude needs your permission' } })
  assert.match((await agent(curl('input', { tab: second, data: '1' })))[0].error, /an agent can't type into a tab that asks something/)

  // a caller gone before it's looked up (the request sent, its socket closed): refused, never yours
  const half = await new Promise<string>((ok, bad) => {
    const body = JSON.stringify({ method: 'widgetSet', params: { id, on: false } })
    const s = net(port, '127.0.0.1', () => s.end(`POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`))
    let got = ''
    s.on('data', d => (got += d))
    s.on('end', () => ok(got))
    s.on('error', bad)
  })
  assert.ok(!half.includes('"result"'), half)
  await new Promise(ok => setTimeout(ok, 300))
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id).on, true, 'nothing done')
  await until(() => rig.out.includes("widgetSet refused: couldn't tell who's calling"), 'said in its log')
})

// #1: an agent's laki send into a terminal it opened ran as you (the terminal's process isn't an agent's): its own
// workspace's terminal is now the agent's for what runs there, another workspace's is refused; yours works and gives it back
test("#1: a command an agent sends into a terminal is the agent's, another workspace's terminal is refused; yours runs as you", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const { id } = await rig.rpc('widgetNew', { kind: 'number', name: 'Probe' })
  await rig.rpc('widgetSet', { id, on: false })
  const { hash } = await rig.rpc('widgetWhat', { id })
  const laki = [process.execPath, '--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))].join(' ')
  const out = join(rig.home, 'agent-out')
  const agent = async (cmd: string) => {
    rmSync(out, { force: true })
    await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${cmd} > ${out} 2>&1; echo done >> ${out}` })
    await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'the agent ran it', 60000)
    return readFileSync(out, 'utf8')
  }
  await agent(`${laki} tab ${ws.id} --preset shell`)
  const shell = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id && x.kind === 'shell'), 'its terminal')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${shell}` })).includes('$ '), 'the shell prompt')
  const ran = join(rig.home, 'shell-out')
  assert.match(await agent(`${laki} send ${ws.id}/${shell} '${laki} widget on ${id} --seen ${hash} > ${ran} 2>&1'`), /sent/)
  await until(() => existsSync(ran) && readFileSync(ran, 'utf8').length > 0, 'the terminal ran it', 30000)
  assert.match(readFileSync(ran, 'utf8'), /only you can turn an extension on/)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id).on, false)
  // another workspace's terminal: refused, nobody asked
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'other' })
  const there = (await rig.rpc('tabNew', { ws: other.id })).id
  assert.match(await agent(`${laki} send ${other.id}/${there} 'echo hi'`), /another workspace: an agent's messages go to agents only \(ask the user to run it there\)/)
  // yours, into the same terminal: you again
  rmSync(ran)
  await rig.rpc('send', { target: `${ws.id}/${shell}`, text: `${laki} widget on ${id} --seen ${hash} > ${ran} 2>&1` })
  await until(() => existsSync(ran) && readFileSync(ran, 'utf8').length > 0, 'the terminal ran yours', 30000)
  assert.equal(readFileSync(ran, 'utf8'), `${id} on\n`)
})

test("M5 on Linux: the caller's process by /proc (its socket's inode among a process's fds), none when no socket matches", async () => {
  const proc = mkdtempSync(join(tmpdir(), 'proc-'))
  mkdirSync(join(proc, 'net'))
  const row = (local: string, rem: string, st: string, inode: string) => `   1: ${local} ${rem} ${st} 00000000:00000000 00:00000000 00000000   501        0 ${inode} 1 0000000000000000 20 4 30 10 -1`
  writeFileSync(join(proc, 'net', 'tcp'), ['  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode', row('0100007F:C350', '0100007F:1F90', '01', '4242'), row('0100007F:1F90', '0100007F:C350', '01', '4243'), row('0100007F:C351', '0100007F:1F90', '06', '4244')].join('\n'))
  for (const [pid, links] of [['10', ['/dev/null', 'socket:[4243]']], ['77', ['pipe:[9]', 'socket:[4242]']], ['self', []]] as const) {
    mkdirSync(join(proc, pid, 'fd'), { recursive: true })
    links.forEach((l, i) => symlinkSync(l, join(proc, pid, 'fd', String(i))))
  }
  assert.equal(await procPeer(0xc350, 0x1f90, proc), 77, "the client's end, not the daemon's")
  writeFileSync(join(proc, '77', 'stat'), '77 (a (b) c) S 10 77 77 0 -1 4194560')
  assert.equal(await procParent(77, proc), 10, 'its parent, past a name with spaces and parentheses')
  assert.equal(await procParent(78, proc), 0)
  assert.equal(await procPeer(0xc351, 0x1f90, proc), undefined, 'not established (TIME_WAIT)')
  assert.equal(await procPeer(0xc352, 0x1f90, proc), undefined, 'no such socket')
  rmSync(proc, { recursive: true, force: true })
})
