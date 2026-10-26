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
    curl('prReview', { ws: 'x', comments: [] }),
    curl('prComment', { ws: 'x', path: 'a', line: 1, body: 'b' }),
    curl('prAct', { ws: 'x', act: 'approve' }),
    curl('prAct', { ws: 'x', act: 'close' }),
    curl('prThreads', { ws: 'x', all: true }),
    curl('prTalk', { ws: 'x' }),
  )
  for (const [i, what] of ['answer what Laki asks', "answer Laki AI's questions", "answer an agent's question", "edit an extension's files", 'start remote access', 'change that setting', 'compact memories (they go to a model)'].entries())
    assert.equal(said[i].error, `an agent can't ${what}: it's the user's (ask them)`)
  assert.equal(said[7].error, undefined)
  assert.equal(said[8].error, "an agent can't post a PR review as you: it's the user's (ask them)")
  assert.equal(said[9].error, "an agent can't comment on a PR as you: it's the user's (ask them)")
  assert.equal(said[10].error, "an agent can't approve a PR as you: it's the user's (ask them)")
  assert.equal(said[11].error, "an agent can't close a PR as you: it's the user's (ask them)")
  assert.equal(said[12].error, "an agent can't read everyone's PR comments (only trusted reviewers' go to agents): it's the user's (ask them)")
  assert.equal(said[13].error, "an agent can't read everyone's PR conversation (only trusted reviewers' go to agents): it's the user's (ask them)")
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

// N14: a from the RPC says ('' too) never covers the caller found by its process: an agent's new workspace is still an
// agent's (no command of its own, none that never asks). N15: a project's config, trust and memory list are yours
test("N14, N15: an agent's from: '' starts nothing that never asks; a project's scripts, trust and memory list aren't an agent's to change", async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'yolo', agent: 'claude', perm: 'bypassPermissions' }] })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const { port, token } = rig.info()
  const out = join(rig.home, 'agent-out')
  const curl = (method: string, params: object) =>
    `curl -s -H 'Origin: file://' -H 'Authorization: Bearer ${token}' --data '${JSON.stringify({ method, params })}' http://127.0.0.1:${port}/rpc >> ${out}; echo >> ${out}`
  await rig.rpc('send', {
    target: `${ws.id}/${tab}`,
    text: `run ${[
      curl('wsNew', { project: p.id, preset: 'yolo', name: 'y', from: '' }),
      curl('wsNew', { project: p.id, cmd: 'echo hi', name: 'c', from: '' }),
      curl('wsFan', { project: p.id, presets: ['claude', 'yolo'], name: 'r', from: '' }),
      curl('projectSet', { id: p.id, config: { setup: 'touch pwned' } }),
      curl('projectSet', { id: p.id, memory: [] }),
      curl('projectTrust', { id: p.id, hash: 'x' }),
      curl('projectSet', { id: p.id, notes: 'from the agent' }),
      curl('memoryAdd', { project: p.id, text: 'as yours', auto: false }),
      curl('memoryAdd', { project: p.id, text: 'learned', tab: 'someone-else' }),
      curl('projectTrust', { id: p.id }),
    ].join('; ')}; echo done >> ${out}`,
  })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('done'), 'the agent ran it', 60000)
  const [yolo, cmd, fan, setup, memory, trust, notes, mine, learned, look] = readFileSync(out, 'utf8').trim().split('\n').slice(0, -1).map(l => JSON.parse(l))
  assert.match(yolo.error, /an agent can't start an agent that never asks/)
  assert.match(cmd.error, /an agent can't start a command of its own/)
  assert.match(fan.error, /an agent can't start an agent that never asks/)
  assert.equal(setup.error, "an agent can't change a project's scripts, env and settings: it's the user's (ask them)")
  assert.equal(memory.error, "an agent can't change a project's memory list (laki memory add adds to it): it's the user's (ask them)")
  assert.equal(trust.error, "an agent can't trust a project's .laki.json: it's the user's (ask them)")
  assert.equal(notes.error, undefined)
  assert.equal(mine.error, "an agent can't add to a project's memory as the user's (laki memory add without --mine keeps it as learned): it's the user's (ask them)")
  assert.equal(learned.result.auto, true)
  assert.match(learned.result.by, /in one$/) // its own tab, not the one it named
  assert.equal(look.error, undefined) // a read: what you'd be shown
  const s = await rig.rpc('state')
  assert.deepEqual(s.workspaces.filter((w: any) => ['y', 'c'].includes(w.name ?? w.id) || (w.name ?? w.id).startsWith('r-')), [])
  const proj = s.projects.find((x: any) => x.id === p.id)
  assert.equal(proj.config?.setup, undefined)
  assert.equal(proj.notes, 'from the agent')
  // yours, from outside any tab: the same config goes
  await rig.rpc('projectSet', { id: p.id, config: { setup: 'true' } })
  assert.equal((await rig.rpc('state')).projects.find((x: any) => x.id === p.id).config.setup, 'true')
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

// #14: a CLI that double-forks out of its tab (and drops its env) was yours; an agent under a wrapper in a shell tab
// counted only if the 2 s scan saw it in front, with a window; an agent's flowRevert, rm and restore trusted it as yours
test("#14: a double fork is its tab's by its terminal; a shell tab's agent under a wrapper, no window, is an agent; an agent's revert, rm and restore of a workflow are its own", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const { id } = await rig.rpc('widgetNew', { kind: 'number', name: 'Probe' })
  await rig.rpc('widgetSet', { id, on: false })
  const { hash } = await rig.rpc('widgetWhat', { id })
  const laki = [process.execPath, '--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))].join(' ')
  const on = `${laki} widget on ${id} --seen ${hash}`
  const isOn = async () => (await rig.rpc('state')).widgets.find((w: any) => w.id === id).on
  // its Bash tool: ( … & ) with no LAKI_TAB, its parent gone (launchd's)
  const ran = join(rig.home, 'fork-out')
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ( env -u LAKI_TAB -u LAKI_WORKSPACE ${on} > ${ran} 2>&1 < /dev/null & )` })
  await until(() => existsSync(ran) && readFileSync(ran, 'utf8').length > 0, 'the fork ran', 60000)
  assert.match(readFileSync(ran, 'utf8'), /only you can turn an extension on/)
  assert.equal(await isOn(), false)

  // a shell tab, no window: an agent under a wrapper (sh, then node <…>/claude), the wrapper in front
  const shell = (await rig.rpc('tabNew', { ws: ws.id })).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${shell}` })).includes('$ '), 'the shell prompt')
  const bin = join(rig.home, 'w')
  mkdirSync(bin)
  const out = join(rig.home, 'wrapped-out')
  writeFileSync(join(bin, 'claude'), `require('child_process').execSync(${JSON.stringify(`${on} > ${out} 2>&1`)})\n`)
  writeFileSync(join(bin, 'wrap.sh'), `${process.execPath} ${join(bin, 'claude')}\n`)
  await rig.rpc('send', { target: `${ws.id}/${shell}`, text: `sh ${join(bin, 'wrap.sh')}` })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').length > 0, 'the wrapped agent ran it', 30000)
  assert.match(readFileSync(out, 'utf8'), /only you can turn an extension on/)
  assert.equal(await isOn(), false)
  // the same in that shell, typed by you with nothing under it: yours
  rmSync(out)
  await rig.rpc('send', { target: `${ws.id}/${shell}`, text: `${on} > ${out} 2>&1` })
  await until(() => existsSync(out) && readFileSync(out, 'utf8').length > 0, 'yours ran', 30000)
  assert.equal(readFileSync(out, 'utf8'), `${id} on\n`)

  // a repo's workflow: v1, then v2, both saved by you (trusted); an agent's revert to v1 is its save: not trusted
  const caller = { ws: ws.id, tab }
  const v1 = '# Repo flow\n\n## start\nstart\nnext: end\n\n## end\nend\n'
  await rig.rpc('flowSave', { id: 'rf', source: 'project', project: p.id, text: v1 })
  await rig.rpc('flowSave', { id: 'rf', source: 'project', project: p.id, text: v1.replace('Repo flow', 'Repo flow 2') })
  const [old] = await rig.rpc('flowHistory', { id: 'rf', source: 'project', project: p.id })
  const back = await rig.rpc('flowRevert', { id: 'rf', source: 'project', project: p.id, at: old.at, caller })
  assert.deepEqual([back.name, back.untrusted, back.byAgent], ['Repo flow', true, true])
  // rm and restore: what an agent deletes or brings back is its own
  await rig.rpc('flowSave', { id: 'rf', source: 'project', project: p.id, text: v1 })
  const gone = await rig.rpc('flowRm', { id: 'rf', source: 'project', project: p.id, caller })
  const again = await rig.rpc('flowRestore', { trash: gone.trash })
  assert.equal(again.byAgent, true, 'an agent deleted it')
  await rig.rpc('flowSave', { id: 'rf', source: 'project', project: p.id, text: v1 })
  const mine = await rig.rpc('flowRm', { id: 'rf', source: 'project', project: p.id })
  assert.equal((await rig.rpc('flowRestore', { trash: mine.trash, caller })).byAgent, true, 'an agent brought it back')
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
