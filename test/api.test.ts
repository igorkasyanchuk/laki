// The daemon's API beyond the happy paths: errors, projects, tabs, workspaces, files, open in, ship, start.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  await rig.rpc('openIn', { ws: ws.id, app: 'antigravity' })
  await rig.rpc('openIn', { ws: ws.id, app: 'editor' }) // Cursor, unless Settings say otherwise
  // a file: its default app, a browser, revealed in Finder, its folder in a terminal
  for (const app of ['default', 'safari', 'finder', 'terminal']) await rig.rpc('openIn', { ws: ws.id, app, file: 'README.md' })
  mkdirSync(join(ws.path, 'docs'))
  await rig.rpc('openIn', { ws: ws.id, app: 'terminal', file: 'docs' }) // a folder: itself
  const opened = readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open '))
  const readme = join(ws.path, 'README.md')
  assert.deepEqual(opened, [`open ${p.path}`, `open -a Zed ${readme}`, `open -a Antigravity ${ws.path}`, `open -a Cursor ${ws.path}`, `open ${readme}`, `open -a Safari ${readme}`, `open -R ${readme}`, `open -a Terminal ${ws.path}`, `open -a Terminal ${join(ws.path, 'docs')}`])
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
  Object.assign(rig.env, { SHELL: sh, LAKI_FROM_APP: '1', LAKI_DEV_ORIGIN: 'http://127.0.0.1:5199' })
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

test('tunnels: cloudflared missing, a protected tunnel, a public one, refusals, cloudflared failing, stop while starting, gone with the workspace and the daemon', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'tun' })
  const log = () => readFileSync(rig.env.FAKE_LOG, 'utf8')
  assert.deepEqual(await rig.rpc('cloudflared'), { mails: [] }) // no version: not installed; no git user.email
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173 }), /cloudflared isn't installed: brew install cloudflared/)
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  assert.equal((await rig.rpc('cloudflared')).version, '2026.9.3')
  // the project's default for the popup: its .laki.json, its own setting over that (trimmed; blank: the file's)
  const expose = async () => (await rig.rpc('cloudflared', { ws: ws.id })).expose
  assert.equal(await expose(), undefined)
  writeFileSync(join(ws.path, '.laki.json'), JSON.stringify({ expose: '*@file.dev' }))
  assert.equal(await expose(), '*@file.dev')
  await rig.rpc('projectSet', { id: p.id, config: { expose: ' me@x.dev, *@team.dev ' } })
  assert.equal(await expose(), 'me@x.dev, *@team.dev')
  await rig.rpc('projectSet', { id: p.id, config: { expose: ' ' } })
  assert.equal(await expose(), '*@file.dev')
  rmSync(join(ws.path, '.laki.json'))
  assert.equal(await expose(), undefined)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: ['nope'] }), /not an email address or \*@domain: nope/)
  for (const m of ['me*@x.dev', '*@*.x.dev', 'a@b.dev,c@d.dev', '*@localhost'])
    await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: [m] }), /not an email address or \*@domain/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 70000 }), /not a port: 70000/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: 'nope', port: 5173 }), /no workspace nope/)

  // protected: the login page's URL isn't the tunnel's; the list is remembered
  const tn = await rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: [' me@x.dev', '*@team.dev', 'me@x.dev', ''] })
  assert.deepEqual(tn, { port: 5173, url: 'https://fake-5173.trycloudflare.com', mails: ['me@x.dev', '*@team.dev'] })
  assert.match(log(), /cloudflared tunnel --url http:\/\/localhost:5173 --allowed-mail=me@x\.dev --allowed-mail=\*@team\.dev\n/)
  assert.deepEqual((await rig.rpc('cloudflared')).mails, ['me@x.dev', '*@team.dev'])
  assert.deepEqual(await rig.rpc('tunnelStart', { ws: ws.id, port: 5173 }), tn) // running already: that one
  const pub = await rig.rpc('tunnelStart', { ws: ws.id, port: 3000 })
  assert.deepEqual(pub, { port: 3000, url: 'https://fake-3000.trycloudflare.com', mails: [] })
  assert.deepEqual((await rig.rpc('state')).workspaces[0].tunnels, [tn, pub])

  writeFileSync(join(rig.home, 'cf-version'), '2025.1.0')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000, mails: ['me@x.dev'] }), /cloudflared 2025\.1\.0 can't limit who opens a tunnel \(that needs 2026\.9\.3\): brew upgrade cloudflared/)
  rmSync(join(rig.home, 'cf-version'))
  writeFileSync(join(rig.home, 'cf-fail'), 'failed to request quick Tunnel: 429 Too Many Requests')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4000 }), /cloudflared ended \(exit 1\):\n.*Requesting new quick Tunnel[^]*429 Too Many Requests/)
  rmSync(join(rig.home, 'cf-fail'))
  writeFileSync(join(rig.home, 'cf-silent'), '')
  const starting = rig.rpc('tunnelStart', { ws: ws.id, port: 4000 })
  await until(async () => (await rig.rpc('state')).workspaces[0].tunnels.some((x: any) => x.port === 4000 && !x.url), 'a starting tunnel')
  await rig.rpc('tunnelStop', { ws: ws.id, port: 4000 })
  assert.deepEqual(await starting, { port: 4000, mails: [] }) // stopped: no URL, no error
  rmSync(join(rig.home, 'cf-silent'))

  await rig.rpc('tunnelStop', { ws: ws.id, port: 3000 })
  await until(() => log().includes('cloudflared 3000 stopped'), 'the public tunnel stopped')
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => log().includes('cloudflared 5173 stopped'), 'the workspace takes its tunnel')
  const other = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'tun2' })
  await rig.rpc('tunnelStart', { ws: other.id, port: 8080 })
  await rig.stop()
  await until(() => log().includes('cloudflared 8080 stopped'), 'the daemon takes its tunnels')
})

test('remote access: the page, one email for some hours, a token of its own; gone when stopped, past its time or with the daemon', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  const at = `http://127.0.0.1:${port}`
  const log = () => (existsSync(rig.env.FAKE_LOG) ? readFileSync(rig.env.FAKE_LOG, 'utf8') : '')
  const stops = () => log().split(`cloudflared ${port} stopped`).length - 1

  // the page: its files to any origin (no secrets in them), nothing outside its folder
  assert.equal((await fetch(`${at}/`)).status, 404)
  const page = rig.env.LAKI_PAGE
  mkdirSync(join(page, 'assets'), { recursive: true })
  writeFileSync(join(page, 'index.html'), '<title>Laki</title>')
  writeFileSync(join(page, 'assets/app.js'), 'x')
  writeFileSync(join(rig.home, 'secret'), 'no')
  const r = await fetch(`${at}/`, { headers: { origin: 'https://evil.example' } })
  assert.deepEqual([r.status, r.headers.get('content-type'), await r.text()], [200, 'text/html; charset=utf-8', '<title>Laki</title>'])
  assert.equal((await fetch(`${at}/assets/app.js`)).headers.get('content-type'), 'text/javascript')
  for (const path of ['/..%2fsecret', '/assets/..%2f..%2fsecret', '/%E0%A4%A'])
    assert.equal((await fetch(at + path)).status, 404, path)

  // refusals; the email is kept (the global setting) once it is one
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /the email that may open it: Settings › Remote access/)
  for (const hours of [3, null, '', '0', false]) await assert.rejects(rig.rpc('remoteStart', { hours, mail: 'me@x.dev' }), /for how long: 1, 2, 4, 8, 24 hours, or 0 \(until stopped\)/)
  for (const m of ['*@x.dev', 'a@b.dev,c@d.dev', 'nope'])
    await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: m }), /not an email address/)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: ' me@x.dev ' }), /cloudflared isn't installed: brew install cloudflared/)
  assert.equal((await rig.rpc('state')).settings.remoteMail, 'me@x.dev')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  writeFileSync(join(rig.home, 'cf-version'), '2025.1.0')
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /can't limit who opens a tunnel/)
  rmSync(join(rig.home, 'cf-version'))

  // on: cloudflared in front of the daemon itself, for that email only
  const t0 = Date.now()
  const on = await rig.rpc('remoteStart', { hours: 2 })
  const url = `https://fake-${port}.trycloudflare.com`
  assert.deepEqual([on.mail, on.url], ['me@x.dev', url])
  assert.match(on.link, new RegExp(`^${url}/\\?token=[0-9a-f]{64}$`))
  assert.ok(Math.abs(on.until - (t0 + 2 * 3600e3)) < 5000)
  assert.match(log(), new RegExp(`cloudflared tunnel --url http://127\\.0\\.0\\.1:${port} --allowed-mail=me@x\\.dev\n`))
  assert.deepEqual((await rig.rpc('state')).remote, on)
  assert.deepEqual(await rig.rpc('remoteStart', { hours: 8 }), on) // running already: that one

  // its token, from its page's origin; no other origin
  const key = on.link.split('?token=')[1]
  const ping = (token: string, origin?: string) =>
    fetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(origin && { origin }) }, body: JSON.stringify({ method: 'ping' }) }).then(r => r.status)
  assert.equal(await ping(key, url), 200)
  assert.equal(await ping(key, 'https://evil.example'), 403)
  assert.equal(await ping(key), 401) // no Origin: not its page
  await assert.rejects(connect(rig, undefined, key))
  const c = await connect(rig, url, key)
  assert.equal(await c.call('ping'), 'pong')
  c.close()
  await assert.rejects(connect(rig, 'https://evil.example', key))

  // stopped: the token and the origin go with it
  await rig.rpc('remoteStop')
  await until(() => stops() === 1, 'cloudflared stopped')
  assert.equal((await rig.rpc('state')).remote, undefined)
  assert.equal(await ping(key), 401)
  assert.equal(await ping(rig.info().token, url), 403)

  // past its time; a new start has a new token
  const again = await rig.rpc('remoteStart', { hours: 1 })
  assert.notEqual(again.link, on.link)
  await rig.rpc('remoteTick', { now: again.until - 1000 })
  assert.ok((await rig.rpc('state')).remote)
  await rig.rpc('remoteTick', { now: again.until })
  assert.equal((await rig.rpc('state')).remote, undefined)
  await until(() => stops() === 2, 'cloudflared stopped at its time')

  // forever: no until, the clock never ends it
  const ever = await rig.rpc('remoteStart', { hours: 0 })
  assert.equal(ever.until, undefined)
  await rig.rpc('remoteTick', { now: Date.now() + 3650 * 86400e3 })
  assert.equal((await rig.rpc('state')).remote?.link, ever.link)
  await rig.rpc('remoteStop')
  await until(() => stops() === 3, 'cloudflared stopped')

  // cloudflared failing; stopped while starting
  writeFileSync(join(rig.home, 'cf-fail'), '429 Too Many Requests')
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /cloudflared ended \(exit 1\)[^]*429 Too Many Requests/)
  assert.equal((await rig.rpc('state')).remote, undefined)
  rmSync(join(rig.home, 'cf-fail'))
  writeFileSync(join(rig.home, 'cf-silent'), '')
  const starting = rig.rpc('remoteStart', { hours: 1 })
  await until(async () => (r => r && !r.url && !r.link)((await rig.rpc('state')).remote), 'starting')
  await rig.rpc('remoteStop')
  assert.equal(await starting, null)
  rmSync(join(rig.home, 'cf-silent'))

  // the daemon takes it
  await rig.rpc('remoteStart', { hours: 24 })
  const n = stops()
  await rig.stop()
  await until(() => stops() === n + 1, 'the daemon takes remote access')
})

test('diff size, archive only when clean, the first-run checks', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const stat = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.stat
  await new Promise(r => setTimeout(r, 700))
  assert.equal(await stat(), undefined) // off by default
  await rig.rpc('settingsSet', { diffStat: true })
  await until(async () => (await stat())?.files === 0, 'a clean stat')
  writeFileSync(join(ws.path, 'README.md'), 'hello\nmore\n') // +1 against the base
  writeFileSync(join(ws.path, 'new.txt'), 'a\nb\nc') // a new file: 3 lines
  writeFileSync(join(ws.path, 'blob.bin'), Buffer.from([0, 1, 2, 10, 10])) // binary: no lines
  assert.deepEqual(await until(async () => ((s => s?.files === 3 && s)(await stat())), 'the stat'), { add: 4, del: 0, files: 3, dirty: 3 })
  assert.deepEqual(await rig.rpc('wsArchive', { id: ws.id, ifClean: true }), { dirty: 3 }) // not archived: it'd lose them
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived, undefined)
  execFileSync('git', ['add', '-A'], { cwd: ws.path })
  execFileSync('git', ['commit', '-qm', 'work'], { cwd: ws.path })
  await until(async () => (await stat())?.dirty === 0, 'committed') // still +4 against the base
  assert.deepEqual(await stat(), { add: 4, del: 0, files: 3, dirty: 0 })
  assert.equal(await rig.rpc('wsArchive', { id: ws.id, ifClean: true }), null)
  await until(async () => (await stat()) === undefined, 'no stat once archived')
  await rig.rpc('settingsSet', { diffStat: false })
  await rig.rpc('wsRestore', { id: ws.id })
  await new Promise(r => setTimeout(r, 700))
  assert.equal(await stat(), undefined) // turned off
  // an agent switches the worktree to a branch of its own: the workspace follows it, and its PR is that branch's
  execFileSync('git', ['checkout', '-qb', 'agent-made'], { cwd: ws.path })
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.branch === 'agent-made', 'the new branch')
  await until(() => /gh pr view agent-made /.test(readFileSync(join(rig.home, 'fake.log'), 'utf8')), "its PR looked up")
  // doctor: git and the fake agents on PATH, gh signed out until it says otherwise
  let d = await rig.rpc('doctor')
  assert.deepEqual([d.git, d.gh, d.agents.find((a: any) => a.id === 'claude').found], [true, 'out', true])
  mkdirSync(join(rig.home, 'gh'), { recursive: true })
  writeFileSync(join(rig.home, 'gh', 'auth'), 'Logged in to github.com\n')
  d = await rig.rpc('doctor')
  assert.equal(d.gh, 'in')
})

test('answer a menu, unread, a race, an issue, the agent browser', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  // a permission menu (the fake claude's), highlighted on 1: choice 3 is two ↓ and Enter; the view has it as ask
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1 }), /isn't asking anything now/)
  await until(async () => /> $/m.test(await rig.rpc('screen', { target: tab.id })), 'the fake claude up') // before it, the tty makes ⏎ a newline
  await rig.rpc('send', { target: tab.id, text: 'menu' })
  const asked = await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)?.ask, 'the ask')
  assert.deepEqual(asked.options.map((o: any) => o.n), [1, 2, 3])
  const first = rig.rpc('answer', { tab: tab.id, n: 3 })
  await new Promise(r => setTimeout(r, 100)) // it holds the tab for a second after its Enter
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1 }), /being answered/) // a double click answers once
  assert.deepEqual(await first, { picked: 'No, and tell Claude what to do differently (esc)' })
  await until(async () => /picked: No, and tell Claude/.test(await rig.rpc('screen', { target: tab.id })), 'two down arrows then Enter')
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 9 }), /isn't asking anything now|being answered/)
  // unread: ● again
  await rig.rpc('unread', { tab: tab.id })
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)?.done, true)
  // a race: one workspace per agent, named for it, one race id
  await assert.rejects(rig.rpc('wsFan', { project: p.id, presets: ['claude'], prompt: 'x' }), /two agents or more/)
  await assert.rejects(rig.rpc('wsFan', { project: p.id, presets: ['claude', 'codex'], prompt: 'x', local: true }), /needs worktrees/)
  const race = await rig.rpc('wsFan', { project: p.id, presets: ['claude', 'codex'], prompt: 'add a footer' })
  assert.deepEqual(race.map((w: any) => w.id), ['add-a-footer-claude', 'add-a-footer-codex'])
  assert.equal(new Set(race.map((w: any) => w.race)).size, 1)
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === race[0].id)?.stat, "a race's diff size, for Compare")
  // an issue: its title and body ahead of the prompt, the name from it
  await assert.rejects(rig.rpc('wsNew', { project: p.id, issue: '7', preset: 'none' }), /gh issue view 7: GraphQL: Could not resolve/)
  mkdirSync(join(rig.home, 'gh'), { recursive: true })
  writeFileSync(join(rig.home, 'gh', 'issue.json'), JSON.stringify({ number: 7, title: 'Login redirect loops', body: 'Steps: sign in twice.', url: 'https://github.com/o/r/issues/7' }))
  const iw = await rig.rpc('wsNew', { project: p.id, issue: 'https://github.com/o/r/issues/7', prompt: 'keep it small' })
  assert.equal(iw.id, 'issue-7-login-redirect-loops')
  assert.deepEqual(iw.issue, { number: 7, url: 'https://github.com/o/r/issues/7', title: 'Login redirect loops' })
  const agent = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === iw.id && x.kind === 'agent')
  // the fake claude says its argv: the prompt, its lines joined
  await until(async () => /Work on GitHub issue #7: Login redirect loops\s+https:\/\/github.com\/o\/r\/issues\/7\s+Steps: sign in twice\.\s+keep it small/.test((await rig.rpc('screen', { target: agent.id, lines: 60 })).replace(/\n/g, ' ')), 'the issue in the prompt')
  // the agent browser: only localhost, and only with the app's window
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'open', url: 'https://example.com' }), /localhost only/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'click' }), /a CSS selector/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'text' }), /needs Laki's window/)
  // with an app window that can: the op goes to it, its answer comes back (a path: on the workspace's port)
  const app = await connect(rig)
  t.after(() => app.close())
  app.notify('view', { tab: null, tabs: [], focused: false, browse: true })
  // through the client's events, as the renderer's: a message with an id would be a reply
  const relay = setInterval(() => {
    for (const m of app.events.splice(0)) if (m.ev === 'browse') app.call('browseDone', m.op === 'text' ? { id: m.req, ok: true, result: { url: m.url ?? m.home, text: 'Hello' } } : { id: m.req, ok: false, error: `no element matches ${m.selector}` })
  }, 20)
  t.after(() => clearInterval(relay))
  await until(async () => (await rig.rpc('browse', { ws: ws.id, op: 'text', url: '/about' }).catch(() => null))?.text === 'Hello', 'the app answers')
  assert.equal((await rig.rpc('browse', { ws: ws.id, op: 'text', url: '/about' })).url, `http://localhost:${ws.port}/about`)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'click', selector: '#nope' }), /no element matches #nope/)
})

test('an image as it was where the changes start (Changes before and after), and as it is now', async t => {
  const rig = await fresh(t)
  const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n])
  writeFileSync(join(rig.repo, 'logo.png'), png(1))
  writeFileSync(join(rig.repo, 'notes.txt'), 'x\n')
  execFileSync('git', ['add', '-A'], { cwd: rig.repo, env: rig.env })
  execFileSync('git', ['commit', '-qm', 'logo'], { cwd: rig.repo, env: rig.env })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'logo.png'), png(2))
  execFileSync('git', ['commit', '-qam', 'new logo'], { cwd: ws.path, env: rig.env }) // committed: still against the base
  writeFileSync(join(ws.path, 'added.png'), png(3))
  const read = (path: string, base?: boolean) => rig.rpc('fileRead', { ws: ws.id, path, base })
  assert.deepEqual(await read('logo.png', true), { size: 5, image: `data:image/png;base64,${png(1).toString('base64')}` })
  assert.deepEqual(await read('logo.png'), { size: 5, image: `data:image/png;base64,${png(2).toString('base64')}` })
  await assert.rejects(read('added.png', true), /not in main/)
  await assert.rejects(read('notes.txt', true), /isn't an image/)
  await assert.rejects(read('../x.png', true), /not a path inside/)
})
