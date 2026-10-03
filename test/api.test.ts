// The daemon's API beyond the happy paths: errors, projects, tabs, workspaces, files, open in, ship, start.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

test('errors name what is wrong: methods, lookups, the WebSocket', async t => {
  const rig = await fresh(t)
  await assert.rejects(rig.rpc('frob'), /unknown method frob/)
  await assert.rejects(rig.rpc('constructor'), /unknown method constructor/) // not an inherited key
  assert.equal((await fetch(`http://127.0.0.1:${rig.info().port}/`)).status, 404)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'feat a' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'feat b' })
  await assert.rejects(rig.rpc('send', { target: 'feat', text: 'x' }), /feat matches 2 workspaces/)
  await assert.rejects(rig.rpc('send', { target: 'nope', text: 'x' }), /no workspace nope/)
  await assert.rejects(rig.rpc('send', { target: 'feat-a', text: 'x' }), /no tab \(agent\) in feat-a/)
  await assert.rejects(rig.rpc('send', { target: 'feat-b/9', text: 'x' }), /no tab 9 in feat-b/)
  await assert.rejects(rig.rpc('tabSet', { id: 'nope' }), /no tab nope/)
  await assert.rejects(rig.rpc('wsNew', { project: 'nope' }), /no project nope/)
  assert.equal(await rig.rpc('input', { tab: 'nope', data: 'x' }), null)
  assert.equal(await rig.rpc('hook', { tab: 'nope', state: 'idle' }), null)
  const shell = await rig.tab(b.id, 'shell')
  assert.equal((await rig.rpc('send', { target: 'feat-b/1', text: 'echo by-number' })).tab, shell.id) // a tab by its number
  // over the WebSocket: errors come back as replies; junk is ignored
  const c = await rig.connect()
  c.ws.send('not json')
  await assert.rejects(c.call('frob'), /unknown method frob/)
  await assert.rejects(c.call('attach', { tab: 'nope' }), /no session nope/)
  const first = c.call('attach', { tab: shell.id })
  const second = c.call('attach', { tab: shell.id, cols: 80, rows: 20 })
  // the older one is superseded, unless its snapshot went out before the newer one arrived
  await first.then(() => {}, e => assert.match(e.message, /superseded by a newer attach/))
  assert.equal((await second).cols, 80)
  assert.equal(await c.call('ping'), 'pong')
  c.close()
})

test('projects: a second folder of the same name, branches, removal takes local and archived workspaces', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  mkdirSync(join(rig.repo, 'sub'))
  assert.deepEqual(await rig.rpc('projectAdd', { path: join(rig.repo, 'sub') }), p) // inside the repo: the same project
  const other = join(rig.home, 'b', 'repo')
  mkdirSync(other, { recursive: true })
  assert.equal((await rig.rpc('projectAdd', { path: other })).id, 'repo-2')
  assert.deepEqual(await rig.rpc('branches', { project: p.id }), { current: 'main', branches: ['main'] })
  assert.deepEqual(await rig.rpc('projectFile', { id: p.id }), {}) // no .laki.json
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const local = await rig.rpc('wsNew', { project: p.id, preset: 'shell', local: true })
  assert.equal((await rig.rpc('wsNew', { project: p.id, local: true })).id, local.id) // one local workspace per project
  await assert.rejects(rig.rpc('projectRm', { id: p.id }), new RegExp(`repo has workspaces: delete them first \\(${ws.id}\\)`))
  await rig.rpc('wsArchive', { id: ws.id })
  await rig.rpc('projectRm', { id: p.path })
  const v = await rig.rpc('state')
  assert.deepEqual(v.projects.map((x: any) => x.id), ['repo-2'])
  assert.deepEqual([v.workspaces, v.tabs], [[], []])
})

test('tabs: a command preset, numbered names, close, resize, detach, queue, codex Enter, interrupt, a gone folder', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { presets: [{ name: 'tests', agent: 'command', cmd: 'echo preset-ran; exec cat' }, { name: 'claude', agent: 'claude' }, { name: 'codex', agent: 'codex' }] })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'tests' })
  const tab = await rig.tab(ws.id)
  assert.deepEqual([tab.name, tab.preset, tab.profile, tab.cmd], ['tests', 'custom', 'tests', 'echo preset-ran; exec cat'])
  await until(async () => (await rig.screen(tab.id)).includes('preset-ran'), 'the preset command')
  const t2 = await rig.rpc('tabNew', { ws: ws.id, preset: 'tests' })
  assert.equal(t2.name, 'tests 2')
  await rig.rpc('tabClose', { id: t2.id })
  assert.ok(!(await rig.rpc('state')).tabs.some((x: any) => x.id === t2.id))

  // resize reaches the program; a client that detaches hands the queries back
  const sh = await rig.rpc('tabNew', { ws: ws.id })
  await rig.rpc('resize', { tab: sh.id, cols: 100, rows: 40 })
  await rig.rpc('send', { target: sh.id, text: 'stty size' })
  await until(async () => (await rig.screen(sh.id)).includes('40 100'), 'the new size')
  const a = await rig.connect()
  const b = await rig.connect()
  await a.call('attach', { tab: sh.id })
  await b.call('attach', { tab: sh.id })
  await b.call('detach', { tab: sh.id })
  await until(() => a.events.filter(e => e.ev === 'responder' && e.on).length === 2, 'a answers again')
  a.close()
  b.close()

  // claude: the queue can be cleared; a hook nobody sends (interrupted) still sets idle
  const cl = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'ask me' })
  await until(async () => (await rig.tab(ws.id, 'claude')).status === 'waiting', 'waiting')
  await rig.rpc('send', { target: cl.id, text: 'later', whenIdle: true })
  await rig.rpc('queueClear', { target: cl.id })
  assert.equal((await rig.tab(ws.id, 'claude')).queue, undefined)
  await rig.rpc('hook', { tab: cl.id, state: 'interrupted' })
  assert.equal((await rig.tab(ws.id, 'claude')).status, 'idle')

  // codex reports only a turn's end: Enter starts one
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await until(async () => (await rig.screen(cx.id)).includes('fake codex'), 'codex up')
  await rig.rpc('input', { tab: cx.id, data: 'hi\r' })
  assert.equal((await rig.tab(ws.id, 'codex')).status, 'running')
  await until(async () => (await rig.tab(ws.id, 'codex')).last === 'answer: hi', 'its turn ended')

  // an agent that ends cleanly closes its tab
  await rig.rpc('input', { tab: cl.id, data: 'exit\r' })
  await until(async () => !(await rig.rpc('state')).tabs.some((x: any) => x.id === cl.id), 'claude tab closed')

  // the folder is gone: no tab
  rmSync(ws.path, { recursive: true, force: true })
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id }), /is gone/)
  assert.equal((await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id).length, 3)
})

test('claude StopFailure on a usage limit: ◷ until it resets; a time gone by is tomorrow\'s', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x.resumeId && x
  }, 'claude up')
  const c = await rig.connect()
  const ago = new Date(Date.now() - 3600e3) // an hour ago, in UTC
  const at = `${ago.getUTCHours() % 12 || 12}:${String(ago.getUTCMinutes()).padStart(2, '0')}${ago.getUTCHours() < 12 ? 'am' : 'pm'}`
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: { error: 'rate_limit', last_assistant_message: `You've hit your limit · resets ${at} (UTC)` } })
  const limit = (await rig.tab(ws.id)).limit
  const hours = (limit - Date.now()) / 3600e3
  assert.ok(hours > 22.9 && hours < 23.1, `resets in 23h, got ${hours}`)
  await until(() => c.events.some(e => e.ev === 'turn' && e.kind === 'limit' && e.tab === tab.id), 'limit event')
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  assert.equal((await rig.tab(ws.id)).limit, undefined)
  c.close()
})

test('apps and open in: Finder, an app, a file, the editor; errors', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.ok((await rig.rpc('apps')).some((a: any) => a.id === 'finder' && a.name === 'Finder'))
  await rig.rpc('openIn', { project: p.id, app: 'finder' })
  await rig.rpc('openIn', { ws: ws.id, app: 'zed', file: 'README.md' })
  await rig.rpc('openIn', { ws: ws.id, app: 'editor' }) // Cursor, unless Settings say otherwise
  const opened = readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open '))
  assert.deepEqual(opened, [`open ${p.path}`, `open -a Zed ${join(ws.path, 'README.md')}`, `open -a Cursor ${ws.path}`])
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'zed', file: 'gone.txt' }), /The file \S+gone\.txt does not exist\./)
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'emacs' }), /no app emacs/)
  await rig.rpc('settingsSet', { editor: 'custom' })
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'editor' }), /set the editor command in Settings/)
})

test('files: a plain folder\'s (no dependencies), git\'s renamed, deleted and added; not a file', async t => {
  const rig = await fresh(t)
  const plain = join(rig.home, 'notes')
  mkdirSync(join(plain, 'node_modules/x'), { recursive: true })
  mkdirSync(join(plain, 'docs'))
  writeFileSync(join(plain, 'a.md'), 'a')
  writeFileSync(join(plain, 'docs/b.md'), 'b')
  writeFileSync(join(plain, 'node_modules/x/i.js'), '')
  const np = await rig.rpc('projectAdd', { path: plain })
  const nw = await rig.rpc('wsNew', { project: np.id, preset: 'none' })
  const f = await rig.rpc('files', { ws: nw.id })
  assert.deepEqual({ ...f, files: f.files.sort() }, { files: ['a.md', 'docs/b.md'], changed: {}, cut: false })
  await assert.rejects(rig.rpc('fileRead', { ws: nw.id, path: 'docs' }), /docs isn't a file/)

  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env })
  writeFileSync(join(ws.path, 'gone.txt'), 'old\n')
  writeFileSync(join(ws.path, 'added.txt'), 'new\n')
  git('add', 'gone.txt')
  git('commit', '-qm', 'gone')
  git('mv', 'README.md', 'README2.md')
  git('rm', '-q', 'gone.txt')
  git('add', 'added.txt')
  assert.deepEqual((await rig.rpc('files', { ws: ws.id })).changed, { 'README2.md': 'R', 'gone.txt': 'D', 'added.txt': 'A' })
})

test('workspaces: a bad base, what only worktrees do, a failed restore, a gone base branch, a fork without claude', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', base: 'no-such-branch' }), /git worktree add failed: fatal: invalid reference: no-such-branch/)
  const local = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'none' })
  await assert.rejects(rig.rpc('wsArchive', { id: local.id }), /only worktree workspaces can be archived/)
  await assert.rejects(rig.rpc('ship', { ws: local.id, message: 'x' }), /ship works on worktree workspaces/)
  await assert.rejects(rig.rpc('run', { ws: local.id }), /no "run" command/)

  execFileSync('git', ['branch', 'topic'], { cwd: rig.repo, env: rig.env })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'w', base: 'topic' })
  await assert.rejects(rig.rpc('ship', { ws: ws.id, message: ' ' }), /a commit message is needed/)
  // its base branch deleted: the diff is against HEAD
  execFileSync('git', ['branch', '-D', 'topic'], { cwd: rig.repo, env: rig.env })
  writeFileSync(join(ws.path, 'README.md'), 'changed\n')
  const d = await rig.rpc('diff', { ws: ws.id })
  assert.deepEqual([d.from, d.files.map((f: any) => f.path)], ['HEAD', ['README.md']])

  assert.equal((await rig.rpc('wsRestore', { id: ws.id })).archived, undefined) // not archived: as it is
  await rig.rpc('wsArchive', { id: ws.id })
  mkdirSync(ws.path)
  writeFileSync(join(ws.path, 'squatter'), '')
  await assert.rejects(rig.rpc('wsRestore', { id: ws.id }), /git worktree add failed: [\s\S]*already exists/)
  rmSync(ws.path, { recursive: true })
  await rig.rpc('wsRestore', { id: ws.id })
  const fork = await rig.rpc('wsFork', { id: ws.id })
  assert.deepEqual((await rig.rpc('state')).tabs.filter((x: any) => x.workspace === fork.id).map((x: any) => x.kind), ['shell'])
})

test('restart: a worktree gone meanwhile leaves its tabs ended, the rest start; a stale setup marker goes', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const gone = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'gone' })
  const kept = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'kept' })
  await rig.stop()
  rmSync(gone.path, { recursive: true, force: true })
  writeFileSync(join(rig.data, 'run', `${kept.id}.setup`), '') // a setup the restart cut off
  await rig.start()
  const v = await rig.rpc('state')
  assert.deepEqual(v.tabs.map((x: any) => [x.workspace, x.status]), [['gone', 'exited'], ['kept', 'idle']])
  assert.equal(await rig.rpc('screen', { target: 'gone/shell' }), '')
  await assert.rejects(rig.rpc('send', { target: 'gone/shell', text: 'x' }), /shell isn't running/)
  assert.ok(!readdirSync(join(rig.data, 'run')).some(f => f.endsWith('.setup')))
})

test('ship: commits everything, pushes the branch, opens the PR; again replaces its tab', async t => {
  const rig = await fresh(t)
  const remote = join(rig.home, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', remote], { env: rig.env })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: rig.repo, env: rig.env })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'feature.txt'), 'done\n')
  const tab = await rig.rpc('ship', { ws: ws.id, message: 'Add the feature' })
  assert.equal(tab.name, 'ship')
  const ended = await until(async () => {
    const x = (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)
    return x.status === 'exited' && x
  }, 'ship done', 15000)
  assert.equal(ended.code, 0, await rig.screen(tab.id))
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s', ws.branch], { cwd: remote, encoding: 'utf8' }).trim(), 'Add the feature')
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), new RegExp(`^gh pr view ${ws.branch} --json url -q \\.url$`, 'm'))
  const again = await rig.rpc('ship', { ws: ws.id, message: 'More' })
  assert.deepEqual((await rig.rpc('state')).tabs.map((x: any) => x.id), [again.id])
})

test('images: the kind kept, empty ones refused, month-old ones cleaned up', async t => {
  const rig = await fresh(t)
  const images = join(rig.data, 'images')
  mkdirSync(images)
  writeFileSync(join(images, `${Date.now() - 31 * 86400e3}-old.png`), 'x')
  const path = await rig.rpc('imageSave', { data: Buffer.from('jpeg!').toString('base64'), ext: 'jpg' })
  assert.match(path, /\.jpg$/)
  assert.deepEqual(readdirSync(images), [path.slice(images.length + 1)])
  await assert.rejects(rig.rpc('imageSave', { data: '' }), /an image up to 20 MB/)
})

test('daemon start: a stale lock is taken over; from the app, the login shell\'s PATH; a dev origin when configured', async t => {
  const rig = await fresh(t)
  await rig.stop()
  writeFileSync(join(rig.data, 'daemon.lock'), String(spawnSync('true').pid)) // that process is gone
  // a login shell whose profile adds /login/bin (only the PATH probe sees it: tabs show what the daemon took)
  const sh = join(rig.home, 'login-sh')
  writeFileSync(sh, `#!/bin/sh\ncase "$2" in *__LAKI__*) PATH="$PATH:/login/bin" ;; esac\nexec '${rig.env.SHELL}' "$@"\n`, { mode: 0o755 })
  Object.assign(rig.env, { SHELL: sh, LAKI_ELECTRON_FROM_APP: '1', LAKI_ELECTRON_DEV_ORIGIN: 'http://127.0.0.1:5199' })
  await rig.start()
  assert.equal(readFileSync(join(rig.data, 'daemon.lock'), 'utf8'), String(rig.info().pid))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const tab = await rig.rpc('tabNew', { ws: ws.id, cmd: 'case ":$PATH:" in *:/login/bin:*) echo login-path: yes ;; *) echo login-path: no ;; esac; exec cat' })
  await until(async () => /login-path: \w+/.test(await rig.screen(tab.id)), 'the PATH checked')
  assert.match(await rig.screen(tab.id), /login-path: yes/)
  const c = await connect(rig, 'http://127.0.0.1:5199')
  assert.equal(await c.call('ping'), 'pong')
  c.close()
  await assert.rejects(connect(rig, 'http://localhost:5199'))
})
