// Projects on SSH hosts, through fakes/ssh: the host is this machine, so its files can be checked; nothing reaches it
// but ssh (a host's env has none of the daemon's LAKI_ or TEST_ vars), and hooks come back on the tab's terminal.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('a project over SSH: a worktree, setup, the agent and its hooks, files and diff on the host', async t => {
  const rig = await fresh(t, { config: { setup: 'echo "$TEST_FROM" > from-setup', env: { TEST_FROM: 'the project' } } })
  const p = await rig.rpc('projectAdd', { path: `devbox:${rig.repo}` })
  assert.deepEqual([p.id, p.name, p.host, p.git, p.path], ['repo-devbox', 'repo (devbox)', 'devbox', true, realpathSync(rig.repo)])
  assert.equal((await rig.rpc('projectAdd', { path: `devbox:${rig.repo}` })).id, p.id) // once
  const local = await rig.rpc('projectAdd', { path: rig.repo })
  assert.notEqual(local.id, p.id) // the same folder here is another project

  const ws = await rig.rpc('wsNew', { project: p.id, name: 'over there', preset: 'claude', prompt: 'hello' })
  assert.equal(ws.host, 'devbox')
  assert.match(ws.path, /\/\.laki-host\/[^/]+\/worktrees\/repo-devbox\/over-there$/)
  assert.equal(ws.branch, 'laki/over-there')
  await until(() => existsSync(join(ws.path, 'from-setup')) && readFileSync(join(ws.path, 'from-setup'), 'utf8') === 'the project\n', 'setup ran there, with the env')

  // the hooks' escape codes, read off the terminal: a turn that ends with its answer
  const done = async (text: string) => until(async () => (await rig.tab(ws.id))?.last === `answer: ${text}` && (await rig.tab(ws.id)).status === 'idle', `the turn "${text}"`)
  await done('hello')
  const tab = await rig.tab(ws.id)
  assert.ok(tab.resumeId, 'SessionStart reported the chat')
  const run = rig.fakeLog().find(l => l.bin === 'claude' && l.tab === tab.id)
  assert.match(run.args[run.args.indexOf('--settings') + 1], /\/\.laki-host\/[^/]+\/claude-settings\.json$/)
  assert.equal(run.env.TEST_FROM, 'the project')
  assert.equal(run.port, String(ws.port))
  const hook = join(rig.home, '.laki-host')
  assert.equal(statSync(hook).mode & 0o777, 0o700)
  assert.ok((await rig.screen(tab.id)).includes('fake claude'))
  assert.ok(!(await rig.screen(tab.id)).includes('7717'), 'hooks never show')

  // a pasted image goes to the host, by its path there
  const img = await rig.rpc('imageSave', { data: Buffer.from('png!').toString('base64') })
  await rig.rpc('send', { target: tab.id, text: `look at ${img}` })
  const there = await until(async () => (await rig.tab(ws.id)).last?.match(/look at (\S+)/)?.[1], 'the image answer')
  assert.match(there, /\/\.laki-host\/[^/]+\/images\//)
  assert.equal(readFileSync(there, 'utf8'), 'png!')

  // files, a preview and the diff, read there
  writeFileSync(join(ws.path, 'new.txt'), 'one\ntwo\n')
  writeFileSync(join(ws.path, 'more.txt'), 'three\n')
  const fl = await rig.rpc('files', { ws: ws.id })
  assert.ok(fl.files.includes('new.txt') && fl.changed['new.txt'] === 'A')
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'new.txt' }), { size: 8, text: 'one\ntwo\n' })
  await assert.rejects(rig.rpc('fileRead', { ws: ws.id, path: 'nope.txt' }), /nope\.txt isn't a file/)
  // an edit saved there; one made over a changed file is refused
  await rig.rpc('fileWrite', { ws: ws.id, path: 'new.txt', text: 'one\n2\n', was: 'one\ntwo\n' })
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'new.txt' })).text, 'one\n2\n')
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'new.txt', text: 'x', was: 'one\ntwo\n' }), /changed since you opened it/)
  await rig.rpc('fileWrite', { ws: ws.id, path: 'new.txt', text: 'one\ntwo\n', was: 'one\n2\n' })
  // a link out of the workspace: read through, never written through
  writeFileSync(join(rig.home, 'outside.txt'), 'mine\n')
  symlinkSync(join(rig.home, 'outside.txt'), join(ws.path, 'out.txt'))
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'out.txt', text: 'theirs\n', was: 'mine\n' }), /not a file inside the workspace/)
  assert.equal(readFileSync(join(rig.home, 'outside.txt'), 'utf8'), 'mine\n')
  unlinkSync(join(ws.path, 'out.txt'))
  await rig.rpc('fileNew', { ws: ws.id, path: 'sub/made.txt' })
  assert.ok(existsSync(join(ws.path, 'sub/made.txt')))
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'new.txt' }), /new\.txt is there already/)
  const d = await rig.rpc('diff', { ws: ws.id })
  assert.deepEqual(d.files.filter((f: any) => f.status === 'A').map((f: any) => [f.path, f.add]).sort(), [['from-setup', 1], ['more.txt', 1], ['new.txt', 2], ['sub/made.txt', 0]]) // in one ssh call

  // a shell there: exit closes it
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  await until(async () => (await rig.screen(sh.id)).includes('$'), 'a prompt')
  await rig.rpc('input', { tab: sh.id, data: 'echo "tab=$LAKI_TAB"\r' })
  await until(async () => (await rig.screen(sh.id)).includes(`tab=${sh.id}`), 'its env')
  await rig.rpc('input', { tab: sh.id, data: 'exit\r' })
  await until(async () => !(await rig.rpc('state')).tabs.some((x: any) => x.id === sh.id), 'the tab closed')

  // deleting it removes the worktree there; the branch stays
  await rig.rpc('wsRm', { id: ws.id })
  assert.ok(!existsSync(ws.path))
})

test('laki project add host:path', async t => {
  const rig = await fresh(t)
  const r = await rig.cli('project', 'add', `devbox:${rig.repo}`)
  assert.equal(r.code, 0, r.err)
  assert.match((await rig.cli('project', 'ls')).out, /^repo-devbox {2}devbox:\/.*\/repo$/m)
})

test('a host that refuses says so, and makes nothing', async t => {
  const rig = await fresh(t)
  await assert.rejects(rig.rpc('projectAdd', { path: 'nohost:/srv/app' }), /ssh nohost: .*Connection refused/)
  await assert.rejects(rig.rpc('projectAdd', { path: `devbox:${rig.home}/missing` }), /no folder/)
  assert.equal((await rig.rpc('state')).projects.length, 0)
})

test('a dropped connection leaves the tabs to start again; Enter does', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: `devbox:${rig.repo}` })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const tab = await until(() => rig.tab(ws.id), 'the agent')
  await until(async () => (await rig.tab(ws.id)).resumeId, 'its chat, from SessionStart')
  // the master goes (a network drop): its pid is in the control file
  const ctl = join(rig.data, 'ssh')
  const pid = Number(readFileSync(join(ctl, readdirSync(ctl)[0]), 'utf8'))
  process.kill(pid, 'SIGTERM')
  // tabs have connections of their own (a drop ends those too): the agent ends by hand here
  await rig.rpc('input', { tab: tab.id, data: '\x03' })
  await until(async () => (await rig.tab(ws.id)).status === 'exited', 'the agent ended')
  await rig.rpc('input', { tab: tab.id, data: '\r' })
  await until(async () => (await rig.tab(ws.id)).status !== 'exited' && (await rig.screen(tab.id)).includes(`--resume ${(await rig.tab(ws.id)).resumeId}`), 'started again (its chat), on a new connection')
  assert.ok(rig.fakeLog().filter(l => l.bin === 'ssh' && l.master === '1').length >= 2, 'reconnected')
})
