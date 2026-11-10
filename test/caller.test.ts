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
    await until(() => existsSync(out) && /done\s*$/.test(readFileSync(out, 'utf8')), 'the agent ran it', 60000)
    return readFileSync(out, 'utf8').trim().split('\n').slice(0, -1).map(l => JSON.parse(l))
  }
  writeFileSync(join(ws.path, 'feature.txt'), 'done\n') // something to ship: its force is what's refused
  const [on, ship, sched] = await agent(curl('widgetSet', { id, on: true }), curl('ship', { ws: ws.id, message: 'x', force: true }), curl('scheduleRun', { id: 'nope' }))
  assert.match(on.error, /only you can turn an extension on/)
  assert.match(ship.error, /an agent never overrides a gate/)
  assert.match(sched.error, /an agent can't run a scheduled task now/)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id).on, false)
  // S2, S7: a delete, a share and (in Recording mode) the state are its process's too, with no from said
  const hid = await rig.rpc('wsNew', { project: p.id, kind: 'local', name: 'hidden-two' })
  await rig.rpc('wsSet', { id: hid.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  const [rm, share, seen] = await agent(curl('wsRm', { id: ws.id }), curl('shareStart', { tab }), curl('state', {}))
  assert.match(rm.error, /says yes in Laki's window, and it isn't open/)
  assert.match(share.error, /an agent can't share a tab's page/)
  assert.ok(seen.result.workspaces.some((w: any) => w.id === ws.id) && !JSON.stringify(seen).includes('hidden-two'), 'its state: no private workspace')
  await rig.rpc('settingsSet', { recording: false })
  await rig.rpc('wsRm', { id: hid.id })
  // the same from outside any tab, the app's Origin and token (S1: its own, not daemon.json's): yours
  const app = async (method: string, params: object) => (await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { origin: 'file://', authorization: `Bearer ${rig.app}` }, body: JSON.stringify({ method, params }) })).json()
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
    curl('alertAnswer', { id: 'x', choice: 'Yes' }),
    curl('flowHold', { id: 'x', on: false }),
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
  assert.equal(said[14].error, "an agent can't answer the user's alert (they pick on its card): it's the user's (ask them)") // else it could pick its own alert's answer
  assert.equal(said[15].error, "an agent can't resume a workflow run the user paused: it's the user's (ask them)") // its pause holds what comes next
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
  await rig.rpc('tabDraft', { tab, text: 'my half-written thought' })
  const [read, wrote] = await agent(curl('tabDraft', { tab }), curl('tabDraft', { tab, text: 'x' }))
  assert.match(read.error, /an agent can't read or change what the user is typing/)
  assert.match(wrote.error, /an agent can't read or change/)
  await rig.rpc('tabDraft', { tab, text: '' })
  assert.match((await agent(curl('tabMode', { tab, mode: 'plan' })))[0].error, /an agent can't change a permission mode/)
  assert.match((await agent(curl('longStop', { tab })))[0].error, /an agent can't stop a turn/)

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
  await until(() => existsSync(out) && /done\s*$/.test(readFileSync(out, 'utf8')), 'the agent ran it', 60000)
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
    await until(() => existsSync(out) && /done\s*$/.test(readFileSync(out, 'utf8')), 'the agent ran it', 60000)
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

// 0.43's review: what would sleep, lock or shut the Mac down, the Done check, Recording mode, the next prompt and keep
// awake are the user's settings; 0.45's: Run ▾'s actions, templates, PR prompts and bots, the files copied into new
// worktrees too, and an update when idle while the user's Update delay holds it; importing worktrees too (a delete removes their folder); a tab's state comes from its
// own agent: with its start's key (LAKI_HOOK), else from that tab's process or none (yours, this test's)
test("an agent can't set When everything is done or its like, import worktrees, or report another tab's state", async t => {
  const rig = await fresh(t)
  // a regression mustn't sleep this Mac: the rig's own pmset and osascript first on PATH
  for (const b of ['pmset', 'osascript']) writeFileSync(join(rig.home, 'bin', b), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  const other = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${other}` })).includes('> '), "the other's prompt")
  const { port, token } = rig.info()
  const out = join(rig.home, 'agent-out')
  const curl = (method: string, params: object) =>
    `curl -s -H 'Origin: file://' -H 'Authorization: Bearer ${token}' --data '${JSON.stringify({ method, params })}' http://127.0.0.1:${port}/rpc >> ${out}; echo >> ${out}`
  // its own tab's state with its own key, as its hooks send it (the env's, so in a script of its own)
  const own = join(rig.home, 'own-hook.sh')
  writeFileSync(own, `curl -s -H 'Authorization: Bearer ${token}' --data "{\\"method\\":\\"hook\\",\\"params\\":{\\"tab\\":\\"$LAKI_TAB\\",\\"state\\":\\"running\\",\\"key\\":\\"$LAKI_HOOK\\"}}" http://127.0.0.1:${port}/rpc >> ${out}; echo >> ${out}\n`)
  await rig.rpc('settingsSet', { prBots: ['coderabbitai'], updateDelay: 3 })
  await rig.rpc('send', {
    target: `${ws.id}/${tab}`,
    text: `run ${[
      curl('settingsSet', { whenDone: 'shutdown' }),
      curl('settingsSet', { doneCheck: false }),
      curl('settingsSet', { recording: false }),
      curl('settingsSet', { nextPrompt: true }),
      curl('settingsSet', { keepAwake: true }),
      curl('settingsSet', { storageDays: 0.001 }),
      curl('settingsSet', { updateCheck: false }),
      curl('worktreeImport', { project: p.id, paths: [rig.home] }),
      curl('hook', { tab: other, state: 'waiting', payload: { message: 'Claude needs your permission' } }),
      curl('hook', { tab: other, state: 'waiting', key: 'a guess' }),
      curl('hook', { tab, state: 'running' }),
      `sh ${own}`,
      curl('wsSet', { ws: ws.id, private: false }),
      curl('projectSet', { id: p.id, private: true }),
      curl('bgSet', { data: 'x' }),
      curl('sideNew', { tab }),
      curl('uiReset', {}),
      curl('settingsSet', { actions: [{ name: 'x', command: 'rm -rf ~' }] }),
      curl('settingsSet', { templates: [{ name: 'x', text: 'x' }] }),
      curl('settingsSet', { prPrompts: { ci: 'x' } }),
      curl('settingsSet', { prBots: ['evil-bot'] }),
      curl('settingsSet', { copyIgnored: true }),
      curl('settingsSet', { copyUntracked: true }),
      curl('settingsSet', { prBots: ['coderabbitai'] }), // sent back unchanged: fine
      curl('updateIdle', { on: true }), // an Update delay is set
      curl('wsSet', { id: ws.id, important: true }),
    ].join('; ')}; echo done >> ${out}`,
  })
  await until(() => existsSync(out) && /done\s*$/.test(readFileSync(out, 'utf8')), 'the agent ran it', 60000)
  const said = readFileSync(out, 'utf8').trim().split('\n').slice(0, -1).map(l => JSON.parse(l))
  for (const i of [0, 1, 2, 3, 4, 5, 6]) assert.equal(said[i].error, "an agent can't change that setting: it's the user's (ask them)")
  assert.match(said[7].error, /an agent can't import worktrees as workspaces/)
  assert.equal(said[8].error, "a tab's state comes from its own agent")
  assert.equal(said[9].error, "not this tab's start: a tab's state comes from its own agent")
  assert.equal(said[10].error, undefined) // its own tab, no key: found by its process
  assert.equal(said[11].error, undefined) // its own key
  for (const i of [12, 13]) assert.equal(said[i].error, "an agent can't change what Recording mode hides: it's the user's (ask them)")
  assert.match(said[14].error, /an agent can't set the app's background picture/)
  assert.match(said[15].error, /an agent can't start the user's side chat over/)
  assert.match(said[16].error, /an agent can't reset the user's settings/)
  for (const i of [17, 18, 19, 20, 21, 22]) assert.equal(said[i].error, "an agent can't change that setting: it's the user's (ask them)", String(i))
  assert.equal(said[23].error, undefined)
  assert.match(said[24].error, /an agent can't update Laki while Check for updates is off or an Update delay is set/)
  assert.match(said[25].error, /an agent can't mark a workspace important/)
  const st = await rig.rpc('state')
  for (const k of ['whenDone', 'doneCheck', 'recording', 'nextPrompt', 'keepAwake', 'storageDays', 'updateCheck', 'actions', 'templates', 'prPrompts', 'copyIgnored', 'copyUntracked']) assert.equal(st.settings[k], undefined, k)
  assert.deepEqual(st.settings.prBots, ['coderabbitai'])
  assert.equal(st.updateIdle, undefined)
  assert.equal(st.workspaces.find((x: any) => x.id === ws.id).important, undefined)
  assert.ok(await rig.rpc('updateIdle', { on: true })) // yours
  await rig.rpc('updateIdle', { on: false })
  assert.notEqual(st.tabs.find((x: any) => x.id === other).status, 'waiting')
  await until(() => rig.out.includes(`hook refused: ${tab} reported ${other}'s state`), 'said in its log')

  // yours (no tab): any of them, and a When everything is done it knows; one it doesn't is refused, never kept
  await assert.rejects(rig.rpc('settingsSet', { whenDone: 'reboot' }), /sleep, lock, shutdown or off, not "reboot"/)
  assert.equal((await rig.rpc('settingsSet', { whenDone: 'off', doneCheck: false })).doneCheck, false)
  await rig.rpc('hook', { tab: other, state: 'idle' })
})

test("S12: an agent tab's token says who calls, from any process; the daemon's own from no tab is you; a start that ended is refused; a sandboxed claude can't read daemon.json", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const { port, token } = rig.info()
  const said = join(rig.home, 'tab-token')
  const laki = [process.execPath, '--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))].join(' ')
  const ls = join(rig.home, 'stale-ls')
  // its own token, and the CLI with one of a start that ended: the daemon's own instead, as before
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run printenv LAKI_TAB_TOKEN > ${said}; LAKI_TAB_TOKEN=${'0'.repeat(64)} ${laki} ls > ${ls} 2>&1` })
  const mine = (await until(() => existsSync(ls) && readFileSync(ls, 'utf8').length > 0 && readFileSync(said, 'utf8').trim(), 'its token', 60000)) as string
  assert.match(mine, /^[0-9a-f]{64}$/)
  assert.match(readFileSync(ls, 'utf8'), /\w/)
  assert.doesNotMatch(readFileSync(ls, 'utf8'), /bad token/)
  assert.ok(!readFileSync(join(rig.data, 'state.json'), 'utf8').includes(mine), 'in memory only')
  assert.ok(!JSON.stringify(await rig.rpc('state')).includes(mine), 'never in the view')
  const post = async (bearer: string, method: string, params: object) => {
    const r = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, params }) })
    return { code: r.status, ...((await r.json()) as { result?: any; error?: string }) }
  }
  // this process is in no tab: with the tab's token it's that agent all the same (a detached child's, a launchd job's)
  assert.match((await post(mine, 'settingsSet', { nextPrompt: true })).error ?? '', /an agent can't change that setting/)
  assert.match((await post(mine, 'hook', { tab: 'another', state: 'waiting' })).error ?? '', /comes from its own agent/)
  assert.equal((await post(mine, 'ping', {})).result, 'pong')
  // the app's, from no tab: you (S1: daemon.json's needs a terminal of its own: agent-gates.test.ts)
  assert.equal((await post(rig.app, 'settingsSet', { nextPrompt: true })).error, undefined)
  // another tab's token in this tab's process (read out of its environment): still this tab, which can't report the other's state
  const other = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id
  await until(async () => (await rig.screen(`${ws.id}/${other}`)).includes('> '), "the other's prompt")
  const said2 = join(rig.home, 'tab-token-2')
  await rig.rpc('send', { target: `${ws.id}/${other}`, text: `run printenv LAKI_TAB_TOKEN > ${said2}` })
  const theirs = (await until(() => existsSync(said2) && readFileSync(said2, 'utf8').trim(), "the other's token")) as string
  assert.equal((await post(theirs, 'hook', { tab: other, state: 'running' })).error, undefined) // from no tab: the other's own
  const stolen = join(rig.home, 'stolen-out')
  await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run curl -s -H 'Authorization: Bearer ${theirs}' --data '${JSON.stringify({ method: 'hook', params: { tab: other, state: 'waiting' } })}' http://127.0.0.1:${port}/rpc > ${stolen}` })
  await until(() => existsSync(stolen) && readFileSync(stolen, 'utf8').length > 0, 'its call answered', 60000)
  assert.match(readFileSync(stolen, 'utf8'), /comes from its own agent/)
  // a wrong one, and remote access's page with a tab's
  assert.equal((await post('f'.repeat(64), 'ping', {})).code, 401)
  // a sandboxed claude's settings: daemon.json out of its Bash commands' reach and its Read tool's
  const box = JSON.parse(readFileSync(join(rig.data, 'claude-settings-sandbox.json'), 'utf8'))
  const secret = [join(rig.data, 'daemon.json'), join(rig.data, 'pty.json'), join(rig.data, 'pty.sock')] // R6: the pty host's too
  assert.deepEqual(box.sandbox.filesystem.denyRead, secret)
  assert.deepEqual(box.permissions.deny, secret.map(f => `Read(/${f})`))
  assert.ok(box.permissions.allow.length > 0, 'its allow rules kept')
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'claude-settings.json'), 'utf8')).permissions.deny, undefined)
  // the start ends: its token with it
  await rig.rpc('tabClose', { id: tab })
  await until(async () => (await post(mine, 'ping', {})).code === 401, 'its token refused')
})
