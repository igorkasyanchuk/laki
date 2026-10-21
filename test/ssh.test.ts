// Projects on SSH hosts, through fakes/ssh: the host is this machine, so its files can be checked; nothing reaches it
// but ssh (a host's env has none of the daemon's LAKI_ or TEST_ vars), and hooks come back on the tab's terminal.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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
  // an attached file too, by its folder: its name (a space in it, quoted) the same there
  const doc = await rig.rpc('fileSave', { name: 'my notes.txt', data: Buffer.from('notes!').toString('base64') })
  await rig.rpc('send', { target: tab.id, text: `read ${JSON.stringify(doc)}` })
  const away = await until(async () => (await rig.tab(ws.id)).last?.match(/read "(.+)"/)?.[1], 'the file answer')
  assert.match(away, /\/\.laki-host\/[^/]+\/files\/[\w-]+\/my notes\.txt$/)
  assert.equal(readFileSync(away, 'utf8'), 'notes!')

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

// cloud workspaces: fakes/gh makes a codespace by cloning the project into $LAKI_CS_ROOT/<repo> (its /workspaces), and
// fakes/ssh reaches it here, as any host
async function cloudRig(t: any) {
  const root = mkdtempSync('/tmp/laki-cs-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const rig = await fresh(t, { env: { LAKI_CS_ROOT: root }, config: { setup: 'echo set > from-setup' } })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/repo.git'], { cwd: rig.repo })
  mkdirSync(join(rig.home, 'gh'), { recursive: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ghSaid = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => /^gh (codespace|api -X)/.test(l))
  const cloud = async (id: string) => (await rig.rpc('state')).workspaces.find((w: any) => w.id === id)
  return { root, rig, p, ghSaid, cloud }
}

test('a cloud workspace: a codespace made in the background, an SSH host of its own; stopped, started again, deleted', async t => {
  const { root, rig, p, ghSaid, cloud } = await cloudRig(t)
  const ask = { project: p.id, codespace: '', name: 'cloudy', preset: 'claude', prompt: 'hello' }
  await assert.rejects(rig.rpc('wsNew', ask), /Cloud workspaces are off: Settings › General › Experimental/)
  await rig.rpc('settingsSet', { cloud: true })
  // a token without the codespace scope: said so, nothing made
  writeFileSync(join(rig.home, 'gh', 'cs-noscope'), '')
  await assert.rejects(rig.rpc('csMachines', { project: p.id }), /gh needs the codespace scope: run gh auth refresh -s codespace/)
  await assert.rejects(rig.rpc('wsNew', ask), /run gh auth refresh -s codespace/)
  unlinkSync(join(rig.home, 'gh', 'cs-noscope'))
  assert.deepEqual((await rig.rpc('csMachines', { project: p.id })).machines.map((m: any) => m.name), ['basicLinux32gb', 'standardLinux32gb'])
  await assert.rejects(rig.rpc('wsNew', { ...ask, codespace: 'huge' }), /no machine type huge for o\/repo/)
  await assert.rejects(rig.rpc('wsNew', { ...ask, local: true }), /not Local/)
  assert.equal((await rig.rpc('state')).workspaces.length, 0)

  // wsNew answers at once; its tabs wait for the codespace
  const ws = await rig.rpc('wsNew', { ...ask, codespace: 'standardLinux32gb' })
  assert.deepEqual([ws.host, ws.path, ws.branch, ws.kind], ['laki-cs-cloudy', join(root, 'repo'), 'laki/cloudy', 'worktree'])
  const up = await until(async () => (w => w?.csState === 'Available' && w)(await cloud(ws.id)), 'the codespace up')
  const name = up.codespace
  assert.match(name, /^fake-repo-/)
  assert.ok(ghSaid().includes('gh codespace create -R o/repo -b main -m standardLinux32gb --default-permissions'))
  // its Host entry under Laki's name, in the config Laki's ssh reads before yours (ssh takes an option's first value)
  const cfg = join(rig.data, 'ssh', 'config')
  assert.match(readFileSync(cfg, 'utf8'), /^# .*\nInclude ".*\/ssh\/codespaces\/\*"\nInclude ~\/\.ssh\/config\n/)
  assert.match(readFileSync(join(rig.data, 'ssh', 'codespaces', ws.host), 'utf8'), new RegExp(`^Host laki-cs-cloudy\n\tUser codespace\n\tProxyCommand gh cs ssh -c ${name} --stdio`))
  // its branch, setup and agent there
  await until(() => existsSync(join(ws.path, 'from-setup')), 'setup ran there')
  assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws.path, encoding: 'utf8' }).trim(), 'laki/cloudy')
  await until(async () => (await rig.tab(ws.id))?.last === 'answer: hello' && (await rig.tab(ws.id)).status === 'idle', 'the turn, its hooks through the terminal')
  const tab = await until(async () => (await rig.tab(ws.id))?.resumeId && rig.tab(ws.id), 'its chat')
  const ssh = rig.fakeLog().filter(l => l.bin === 'ssh' && l.host === ws.host && !l.op)
  assert.ok(ssh.length >= 3 && ssh.every(l => l.cfg === cfg), "every connection with -F")

  // archived: stopped; restored: started again, its agent back on its chat
  await rig.rpc('wsArchive', { id: ws.id, ifClean: true })
  assert.ok(ghSaid().includes(`gh codespace stop -c ${name}`))
  assert.deepEqual((w => [w.archived, w.csState])(await cloud(ws.id)), [true, 'Shutdown'])
  await rig.rpc('wsRestore', { id: ws.id })
  await until(async () => (await cloud(ws.id)).csState === 'Available', 'started again')
  assert.ok(ghSaid().includes(`gh api -X POST user/codespaces/${name}/start`))
  await until(async () => (await rig.screen(tab.id)).includes(`--resume ${tab.resumeId}`), 'its agent resumed there')

  // deleted: the codespace too, and its Host entry
  await rig.rpc('wsRm', { id: ws.id })
  assert.ok(ghSaid().includes(`gh codespace delete -c ${name} --force`))
  assert.ok(!existsSync(join(rig.data, 'ssh', 'codespaces', ws.host)))
  assert.equal((await rig.rpc('state')).workspaces.length, 0)
})

test("a codespace gh can't make: the workspace and its tab say why; deleting it deletes nothing on GitHub", async t => {
  const { rig, p, ghSaid, cloud } = await cloudRig(t)
  await rig.rpc('settingsSet', { cloud: true })
  writeFileSync(join(rig.home, 'gh', 'cs-fail'), 'error creating codespace: HTTP 402: You have reached your spending limit\n')
  const ws = await rig.rpc('wsNew', { project: p.id, codespace: '', preset: 'claude', prompt: 'hi' })
  const w = await until(async () => (x => x?.csState === 'Failed' && x)(await cloud(ws.id)), 'it failed')
  assert.equal(w.csError, 'gh codespace create: error creating codespace: HTTP 402: You have reached your spending limit')
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('spending limit'), 'its tab says why')
  await assert.rejects(rig.rpc('wsArchive', { id: ws.id }), /no codespace \(making it failed\): delete it/)
  await rig.rpc('wsRm', { id: ws.id })
  assert.ok(!ghSaid().some(l => l.startsWith('gh codespace delete')))
})
