// The daemon's API beyond the happy paths: errors, projects, tabs, workspaces, files, open in, ship, start.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { basename, dirname, extname, join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
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
  assert.deepEqual(await rig.rpc('branches', { project: p.id }), { current: 'main', branches: ['main'], main: 'main' })
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

test("tabs: named by their task: a prompt's words, the first prompt typed, a command's words; never over a name you gave", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'Please fix the cart total rounding' })
  const first = await rig.tab(ws.id)
  assert.equal(first.name, 'claude') // the workspace's name says its task
  await rig.rpc('hook', { tab: first.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'and the tax too' } })
  assert.equal((await rig.tab(ws.id)).name, 'claude')
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'Please check the totals' })).name, 'claude: check the totals')
  // started without a prompt: its first prompt names it (claude's UserPromptSubmit, codex's first turn), once
  const cl = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  assert.equal(cl.name, 'claude 2')
  const prompt = (text: string) => rig.rpc('hook', { tab: cl.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: text } })
  await prompt('/clear') // a bare command says nothing
  assert.equal((await rig.tab(ws.id, 'claude 2')).id, cl.id)
  await prompt('can you add dark mode to the settings page')
  assert.ok(await rig.tab(ws.id, 'claude: add dark mode to the settings'))
  await prompt('now something else')
  assert.ok(await rig.tab(ws.id, 'claude: add dark mode to the settings'))
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await rig.rpc('hook', { tab: cx.id, state: 'done', payload: { type: 'agent-turn-complete', 'input-messages': ['review what claude did, focus on tests'] } })
  assert.ok(await rig.tab(ws.id, 'codex: review what claude did, focus'))
  // a name you gave stays
  const mine = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await rig.rpc('tabSet', { id: mine.id, name: 'claude 3' })
  await rig.rpc('hook', { tab: mine.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'write the docs' } })
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === mine.id).name, 'claude 3')
  const named = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'write tests', name: 'tests' })
  assert.equal(named.name, 'tests')
  // a command: its first words
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, cmd: '/usr/bin/env npm run dev --port 3000' })).name, 'env npm run')
  // a given name is trimmed; a workspace made without a prompt: its first agent takes its first prompt's words
  assert.equal((await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'x', name: '  docs  ' })).name, 'docs')
  const bare = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const b1 = await rig.tab(bare.id)
  await rig.rpc('hook', { tab: b1.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix the login page' } })
  assert.equal((await rig.tab(bare.id)).name, 'claude: fix the login page')
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
  await until(async () => (await rig.tab(ws.id, 'claude: ask me')).status === 'waiting', 'waiting')
  await rig.rpc('send', { target: cl.id, text: 'later', whenIdle: true })
  await rig.rpc('queueClear', { target: cl.id })
  assert.equal((await rig.tab(ws.id, 'claude: ask me')).queue, undefined)
  await rig.rpc('hook', { tab: cl.id, state: 'interrupted' })
  assert.equal((await rig.tab(ws.id, 'claude: ask me')).status, 'idle')

  // codex reports only a turn's end: Enter starts one
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  await until(async () => (await rig.screen(cx.id)).includes('fake codex'), 'codex up')
  await rig.rpc('input', { tab: cx.id, data: 'hi\r' })
  assert.equal((await rig.tab(ws.id, 'codex')).status, 'running')
  await until(async () => (await rig.tab(ws.id, 'codex')).last === 'answer: hi', 'its turn ended')

  // an agent that ends cleanly keeps its tab and last screen; Enter resumes its chat
  const chat = (await rig.tab(ws.id, 'claude: ask me')).resumeId
  await rig.rpc('input', { tab: cl.id, data: 'exit\r' })
  await until(async () => (await rig.tab(ws.id, 'claude: ask me')).status === 'exited', 'claude ended')
  assert.equal((await rig.tab(ws.id, 'claude: ask me')).code, 0)
  await until(async () => (await rig.screen(cl.id)).includes('press Enter to start it again'), 'its note')
  await rig.rpc('input', { tab: cl.id, data: '\r' })
  await until(async () => (await rig.tab(ws.id, 'claude: ask me')).status !== 'exited', 'claude again')
  await until(async () => (await rig.screen(cl.id)).includes(`--resume ${chat}`), 'resumed')

  // the folder is gone: no tab
  rmSync(ws.path, { recursive: true, force: true })
  await assert.rejects(rig.rpc('tabNew', { ws: ws.id }), /is gone/)
  assert.equal((await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id).length, 4)
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
  // L11: a file that would run, by default: shown in Finder, not opened
  writeFileSync(join(ws.path, 'go.command'), 'echo hi')
  writeFileSync(join(ws.path, 'build'), '#!/bin/sh\necho hi', { mode: 0o755 })
  for (const f of ['go.command', 'build']) await rig.rpc('openIn', { ws: ws.id, app: 'default', file: f })
  assert.deepEqual(readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('open ')).slice(-2), [`open -R ${join(ws.path, 'go.command')}`, `open -R ${join(ws.path, 'build')}`])
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
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'opt', base: '--orphan' }), /base --orphan\? a branch, not an option/)
  assert.ok(!(await rig.rpc('state')).workspaces.some((w: any) => w.name === 'opt'), 'nothing made')
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

test('files: any kind, its name kept (its last part, readable, never out of its folder), 25 MB at most, old ones cleaned up', async t => {
  const rig = await fresh(t)
  const files = join(rig.data, 'files')
  const old = join(files, `${Date.now() - 31 * 86400e3}-old`)
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'a.pdf'), 'x')
  const b64 = (s: string) => Buffer.from(s).toString('base64')
  const path = await rig.rpc('fileSave', { name: 'Q3 report.pdf', data: b64('pdf!') })
  assert.equal(path, join(files, basename(dirname(path)), 'Q3 report.pdf'))
  assert.equal(readFileSync(path, 'utf8'), 'pdf!')
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700)
  assert.deepEqual(readdirSync(files), [basename(dirname(path))]) // the month-old one went
  const named = async (name: unknown) => {
    const p = await rig.rpc('fileSave', { name, data: '' })
    assert.equal(dirname(dirname(p)), files)
    return basename(p)
  }
  assert.equal(await named('../../state.json'), 'state.json')
  assert.equal(await named('a/b\\c.txt'), 'c.txt')
  for (const n of ['..', '.', '', ' ', undefined]) assert.equal(await named(n), 'file')
  assert.equal(await named('bad\x00\x1b[31m\u202ename\n.sh'), 'bad[31mname.sh')
  for (const n of [`${'x'.repeat(300)}.txt`, `${'日本'.repeat(100)}.md`]) {
    const cut = await named(n)
    assert.ok(Buffer.byteLength(cut) <= 200 && cut.endsWith(extname(n)) && n.startsWith(cut.slice(0, 20)), cut)
  }
  await assert.rejects(rig.rpc('fileSave', { name: 'x' }), /a file up to 25 MB/)
  // the app's go over the socket: 25 MB, in base64, fits
  const c = await rig.connect()
  assert.equal(statSync(await c.call('fileSave', { name: 'big.bin', data: Buffer.alloc(25 << 20).toString('base64') })).size, 25 << 20)
  await assert.rejects(c.call('fileSave', { name: 'big.bin', data: Buffer.alloc((25 << 20) + 1).toString('base64') }), /a file up to 25 MB/)
  c.close()
})

test('a tunnel a killed daemon left running is stopped as the next daemon starts (L14)', async t => {
  const rig = await fresh(t)
  const log = () => (existsSync(rig.env.FAKE_LOG) ? readFileSync(rig.env.FAKE_LOG, 'utf8') : '')
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  const { port, pid } = rig.info()
  await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev' })
  const kids = join(rig.data, 'children.json')
  await until(() => existsSync(kids) && JSON.parse(readFileSync(kids, 'utf8')).length === 1, 'its cloudflared noted')
  const cf = JSON.parse(readFileSync(kids, 'utf8'))[0].pid
  process.kill(pid, 'SIGKILL') // no shutdown: cloudflared lives on
  await until(() => { try { process.kill(pid, 0); return false } catch { return true } }, 'the daemon gone')
  process.kill(cf, 0) // still there
  assert.doesNotMatch(log(), new RegExp(`cloudflared ${port} stopped`))
  await rig.start()
  await until(() => log().includes(`cloudflared ${port} stopped`), 'the old cloudflared stopped')
  assert.ok(!existsSync(kids) || JSON.parse(readFileSync(kids, 'utf8')).length === 0)
})

test('refused WebSockets: the first logged, the rest counted, not a line each (L15)', async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  for (let i = 0; i < 100; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=nope`)
    await new Promise(r => (ws.once('error', r), ws.once('open', r)))
  }
  await rig.rpc('ping')
  const lines = rig.out.split('\n').filter(l => l.includes('refused websocket'))
  assert.ok(lines.length >= 1 && lines.length <= 2, lines.join('\n'))
})

test('the Host a request names: the daemon\'s own address, or remote access\'s while it runs; another (DNS rebinding) is turned away', async t => {
  const rig = await fresh(t)
  const { port, token } = rig.info()
  const at = (host: string, method = 'POST', path = '/rpc') =>
    new Promise<number>((res, rej) => {
      const r = request({ host: '127.0.0.1', port, path, method, headers: { host, authorization: `Bearer ${token}` } }, x => (x.resume(), res(x.statusCode!)))
      r.on('error', rej).end(method === 'POST' ? JSON.stringify({ method: 'ping' }) : undefined)
    })
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`]) assert.equal(await at(h), 200, h)
  for (const h of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, `fake-${port}.trycloudflare.com`]) {
    assert.equal(await at(h), 421, h)
    assert.equal(await at(h, 'GET', '/'), 421, h) // the page, a widget's, an artifact: every route
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { headers: { host: 'evil.example' } })
  await assert.rejects(new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej))))
  // remote access: its own host too, until it stops
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev' })
  assert.equal(await at(`fake-${port}.trycloudflare.com`), 200)
  await rig.rpc('remoteStop')
  assert.equal(await at(`fake-${port}.trycloudflare.com`), 421)
})

test('daemon start: a stale lock is taken over; from the app, the login shell\'s PATH; a dev origin when configured', async t => {
  const rig = await fresh(t)
  await rig.stop()
  writeFileSync(join(rig.data, 'daemon.lock'), String(spawnSync('true').pid)) // that process is gone
  // a login shell whose profile adds /login/bin (only the PATH probe sees it: tabs show what the daemon took)
  const sh = join(rig.home, 'login-sh')
  writeFileSync(sh, `#!/bin/sh\ncase "$2" in *__LAKI__*) PATH="$PATH:/login/bin" ;; esac\nexec '${rig.env.SHELL}' "$@"\n`, { mode: 0o755 })
  Object.assign(rig.env, { SHELL: sh, LAKI_FROM_APP: '1', LAKI_DEV_ORIGIN: 'http://127.0.0.1:5199,https://evil.example' })
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
  await assert.rejects(connect(rig, 'https://evil.example')) // only this Mac's: a site in the env isn't let in
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
  // a worktree's own .laki.json never counts (its branch could bring its own setup, env, ports): the main checkout's
  writeFileSync(join(ws.path, '.laki.json'), JSON.stringify({ expose: '*@branch.dev', setup: 'touch pwned' }))
  assert.equal(await expose(), undefined)
  writeFileSync(join(rig.repo, '.laki.json'), JSON.stringify({ expose: '*@file.dev' }))
  assert.equal(await expose(), undefined) // not trusted yet
  await rig.trust(p.id)
  assert.equal(await expose(), '*@file.dev')
  await rig.rpc('projectSet', { id: p.id, config: { expose: ' me@x.dev, *@team.dev ' } })
  assert.equal(await expose(), 'me@x.dev, *@team.dev')
  await rig.rpc('projectSet', { id: p.id, config: { expose: ' ' } })
  assert.equal(await expose(), '*@file.dev')
  rmSync(join(rig.repo, '.laki.json'))
  assert.equal(await expose(), undefined)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: ['nope'] }), /not an email address or \*@domain: nope/)
  for (const m of ['me*@x.dev', '*@*.x.dev', 'a@b.dev,c@d.dev', '*@localhost'])
    await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: [m] }), /not an email address or \*@domain/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 70000 }), /not a port: 70000/)
  await assert.rejects(rig.rpc('tunnelStart', { ws: 'nope', port: 5173 }), /no workspace nope/)

  // protected: the login page's URL isn't the tunnel's; the list is remembered
  const t0 = Date.now()
  const tn = await rig.rpc('tunnelStart', { ws: ws.id, port: 5173, mails: [' me@x.dev', '*@team.dev', 'me@x.dev', ''] })
  assert.deepEqual({ ...tn, until: undefined }, { port: 5173, url: 'https://fake-5173.trycloudflare.com', mails: ['me@x.dev', '*@team.dev'], until: undefined })
  assert.ok(Math.abs(tn.until - (t0 + 8 * 3600e3)) < 5000) // 8 hours unless asked
  assert.match(log(), /cloudflared tunnel --url http:\/\/localhost:5173 --allowed-mail=me@x\.dev --allowed-mail=\*@team\.dev\n/)
  assert.deepEqual((await rig.rpc('cloudflared')).mails, ['me@x.dev', '*@team.dev'])
  assert.deepEqual(await rig.rpc('tunnelStart', { ws: ws.id, port: 5173 }), tn) // running already: that one
  const pub = await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, hours: 1 })
  assert.deepEqual({ ...pub, until: undefined }, { port: 3000, url: 'https://fake-3000.trycloudflare.com', mails: [], until: undefined })
  assert.ok(Math.abs(pub.until - (t0 + 3600e3)) < 5000)
  assert.deepEqual((await rig.rpc('state')).workspaces[0].tunnels, [tn, pub])
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 3001, hours: 3 }), /for how long: 1, 8, 24 hours, or 0 \(until stopped\)/)
  // past its hours: stopped (the 8-hour one stays)
  await rig.rpc('tunnelTick', { now: pub.until + 1 })
  await until(() => log().includes('cloudflared 3000 stopped'), 'the hour is up')
  assert.deepEqual((await rig.rpc('state')).workspaces[0].tunnels, [tn])
  assert.equal((await rig.rpc('tunnelStart', { ws: ws.id, port: 3000, hours: 0 })).until, undefined) // until stopped: none

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
  await until(() => log().split('cloudflared 3000 stopped').length === 3, 'the public tunnel stopped (again)')
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
  // the page never from the cache (back through Cloudflare's sign-in), its files revalidated
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(`${at}/assets/app.js`)).headers.get('cache-control'), 'no-cache')
  for (const path of ['/..%2fsecret', '/assets/..%2f..%2fsecret', '/%E0%A4%A'])
    assert.equal((await fetch(at + path)).status, 404, path)

  // refusals; the email is kept (the global setting) once it is one
  await assert.rejects(rig.rpc('remoteStart', { hours: 1 }), /the email that may open it: Settings › Remote access/)
  for (const hours of [3, null, '', '0', false]) await assert.rejects(rig.rpc('remoteStart', { hours, mail: 'me@x.dev' }), /for how long: 1, 2, 4, 8, 12, 24, 48, 72 hours, or 0 \(until stopped\)/)
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

  // the link's key, once, from its page's origin: the page's own token for it, then the link is dead (L3)
  const key = on.link.split('?token=')[1]
  const ping = (token: string, origin?: string) =>
    fetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...(origin && { origin }) }, body: JSON.stringify({ method: 'ping' }) }).then(r => r.status)
  const pinAt = (body: object, origin = url) => fetch(`${at}/pin`, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }).then(r => r.json())
  assert.equal(await ping(key, url), 401) // the link's key isn't a token
  assert.equal((await fetch(`${at}/pin`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ token: key }) })).status, 403)
  const own = await pinAt({ token: key })
  assert.equal(own.need, false)
  assert.match(own.token, /^[0-9a-f]{64}$/)
  assert.deepEqual(await pinAt({ token: key }), { need: false }) // once: a second tab or device gets nothing
  assert.equal((await rig.rpc('state')).remote.used, true)
  const tok = own.token
  assert.equal(await ping(key, url), 401)
  assert.equal(await ping(tok, url), 200)
  assert.equal(await ping(tok, 'https://evil.example'), 403)
  assert.equal(await ping(tok), 401) // no Origin: not its page
  assert.equal(await ping(rig.info().token, url), 401) // ours with its Origin: it'd skip the caller check as the phone's page (M5)
  await assert.rejects(connect(rig, undefined, tok))
  const c = await connect(rig, url, tok)
  assert.equal(await c.call('ping'), 'pong')
  // a phone has what it needs, not what outlives its session or opens Laki wider (M4)
  const far = (method: string, params = {}) =>
    fetch(`${at}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, origin: url }, body: JSON.stringify({ method, params }) }).then(r => r.json())
  for (const [m, p] of [['shutdown', {}], ['remoteStart', { hours: 1 }], ['cliInstall', {}], ['aiKey', { key: 'k' }], ['skillSet', { agent: 'claude', on: true }], ['accountAdd', { agent: 'claude' }], ['widgetSet', { id: 'links', on: true }], ['widgetSet', { id: 'links', net: true }], ['settingsSet', { remoteMail: 'them@x.dev' }], ['settingsSet', { webhook: { url: 'https://evil.example' } }], ['settingsSet', { env: { A: '1' } }]] as const)
    assert.match((await far(m, p)).error ?? '', /not over remote access: do that on the Mac itself/, m)
  await assert.rejects(c.call('shutdown'), /not over remote access/)
  assert.equal((await far('settingsSet', { remoteMail: 'me@x.dev', notify: false })).result.notify, false) // Settings sends them all back: unchanged is fine
  assert.equal(await rig.rpc('ping'), 'pong') // still up
  c.close()
  await assert.rejects(connect(rig, 'https://evil.example', tok))

  // stopped: the token and the origin go with it
  await rig.rpc('remoteStop')
  await until(() => stops() === 1, 'cloudflared stopped')
  assert.equal((await rig.rpc('state')).remote, undefined)
  assert.equal(await ping(tok, url), 403)
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

  // no email: only asked for (open), cloudflared with no --allowed-mail, the token still the lock, the saved email kept
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: '' }), /the email that may open it/)
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: '', open: 'yes' }), /the email that may open it/)
  for (const hours of [0, 48]) await assert.rejects(rig.rpc('remoteStart', { hours, mail: '', open: true }), /without an email, 24 hours at most/)
  const pub = await rig.rpc('remoteStart', { hours: 1, mail: '', open: true })
  assert.deepEqual([pub.mail, pub.open], ['', true])
  assert.match(log(), new RegExp(`cloudflared tunnel --url http://127\\.0\\.0\\.1:${port}\n`))
  assert.equal((await rig.rpc('state')).settings.remoteMail, 'me@x.dev')
  assert.equal(await ping((await pinAt({ token: pub.link.split('?token=')[1] })).token, url), 200)
  assert.equal(await ping('nope', url), 401)
  await rig.rpc('remoteStop')
  await until(() => stops() === 4, 'cloudflared stopped')
  // an email given wins over open
  const mailed = await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev', open: true })
  assert.deepEqual([mailed.mail, mailed.open], ['me@x.dev', undefined])
  await rig.rpc('remoteStop')
  await until(() => stops() === 5, 'cloudflared stopped')

  // Laki's PIN (no email, the saved one kept; pin wins over an email): the link's key alone only asks for it, the PIN
  // gives the page its token; a wrong one counts down (settings' remoteTries), the last stops remote access
  await rig.rpc('settingsSet', { remoteTries: 3 })
  const pinned = await rig.rpc('remoteStart', { hours: 1, mail: 'me@x.dev', pin: true })
  assert.deepEqual([pinned.mail, pinned.open, pinned.tries], ['', undefined, 3])
  assert.match(pinned.pin, /^\d{6}$/)
  assert.equal(log().split(`cloudflared tunnel --url http://127.0.0.1:${port}\n`).length - 1, 2) // open's, and this one: no --allowed-mail
  const link = pinned.link.split('?token=')[1]
  assert.equal(await ping(link, url), 401) // the link's key alone isn't in
  assert.deepEqual(await pinAt({ token: link }), { need: true, left: 3 })
  assert.deepEqual(await pinAt({ token: 'nope', pin: pinned.pin }), { need: false })
  assert.equal((await fetch(`${at}/pin`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status, 403)
  assert.equal((await fetch(`${at}/pin`, { method: 'POST', body: JSON.stringify({ token: link, pin: pinned.pin }) })).status, 403) // not from its page
  const wrong = pinned.pin === '000000' ? '111111' : '000000'
  assert.deepEqual(await pinAt({ token: link, pin: wrong }), { error: 'Wrong PIN: 2 more tries, then remote access stops' })
  assert.equal((await rig.rpc('state')).remote.tries, 2)
  assert.deepEqual(await pinAt({ token: '\u00e9'.repeat(64), pin: pinned.pin }), { need: false }) // as long as the key in characters, not in bytes
  const wide = [...pinned.pin].map(d => String.fromCharCode(0xff10 + Number(d))).join('') // a phone keyboard's fullwidth digits
  const got = await pinAt({ token: link, pin: ` ${wide.slice(0, 3)} ${wide.slice(3)} ` })
  assert.match(got.token, /^[0-9a-f]{64}$/)
  assert.equal(await ping(got.token, url), 200)
  assert.deepEqual(await pinAt({ token: got.token }), { need: false }) // in already
  // the link is dead now: no PIN on it again, right or wrong
  assert.deepEqual(await pinAt({ token: link, pin: pinned.pin }), { need: false })
  assert.deepEqual(await pinAt({ token: link, pin: wrong }), { need: false })
  assert.equal((await rig.rpc('state')).remote.tries, 2)
  await rig.rpc('remoteStop')
  await until(() => stops() === 6, 'cloudflared stopped')
  assert.equal(await ping(got.token, url), 403)
  // the last wrong PIN stops it
  const again2 = await rig.rpc('remoteStart', { hours: 1, pin: true })
  const link2 = again2.link.split('?token=')[1]
  const wrong2 = again2.pin === '000000' ? '111111' : '000000'
  const app = await connect(rig)
  assert.deepEqual(await pinAt({ token: link2, pin: wrong2 }), { error: 'Wrong PIN: 2 more tries, then remote access stops' })
  assert.deepEqual(await pinAt({ token: link2, pin: wrong2 }), { error: 'Wrong PIN: 1 more try, then remote access stops' })
  assert.deepEqual(await pinAt({ token: link2, pin: wrong2 }), { error: 'Wrong PIN: remote access stopped. Start it again on your Mac for a new link and PIN.' })
  assert.match((await until(async () => app.events.find(m => m.ev === 'remote'), 'the app told')).text, /Remote access stopped: a wrong PIN/)
  app.close()
  assert.equal((await rig.rpc('state')).remote, undefined)
  await until(() => stops() === 7, 'cloudflared stopped')
  assert.equal((await rig.rpc('state')).settings.remoteMail, 'me@x.dev')

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
  assert.deepEqual(await rig.rpc('wsPeek', { id: ws.id }), { dirty: 3, ahead: 0, unpushed: 0 }) // what Delete's question says
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived, undefined)
  execFileSync('git', ['add', '-A'], { cwd: ws.path })
  execFileSync('git', ['commit', '-qm', 'work'], { cwd: ws.path, env: rig.env }) // its author: Linux has no user@host.local to fall back on
  await until(async () => (await stat())?.dirty === 0, 'committed') // still +4 against the base
  assert.deepEqual(await stat(), { add: 4, del: 0, files: 3, dirty: 0 })
  assert.deepEqual(await rig.rpc('wsPeek', { id: ws.id }), { dirty: 0, ahead: 1, unpushed: 1 }) // a commit of its own, on no remote
  assert.equal(await rig.rpc('wsArchive', { id: ws.id, ifClean: true }), null)
  assert.deepEqual(await rig.rpc('wsPeek', { id: ws.id }), {}) // archived: no folder to ask
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

test('the view goes out only when it changed: tool calls that keep a tab running send none', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  const app = await connect(rig)
  t.after(() => app.close())
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PreToolUse' } })
  await until(() => app.events.some((m: any) => m.ev === 'state' && m.view.tabs.find((x: any) => x.id === tab.id)?.status === 'running' && m.view.workspaces[0].pr), 'running, its PR scanned')
  await new Promise(r => setTimeout(r, 300)) // anything else under way goes out
  app.events.splice(0)
  for (const h of ['PostToolUse', 'PreToolUse', 'PostToolUse']) await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: h } })
  await new Promise(r => setTimeout(r, 200))
  assert.equal(app.events.filter((m: any) => m.ev === 'state').length, 0)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'done' } })
  await until(() => app.events.some((m: any) => m.ev === 'state' && m.view.tabs.find((x: any) => x.id === tab.id)?.status === 'idle'), 'idle goes out')
})

test("Laki AI's timers: checked here, done by the app's window, its answer back", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('timer', { act: 'nap' }), /one of timer, remind/)
  await assert.rejects(rig.rpc('timer', { act: 'timer' }), /for how long/)
  await assert.rejects(rig.rpc('timer', { act: 'remind', minutes: 5, ws: 'nope' }), /nope/)
  await assert.rejects(rig.rpc('timer', { act: 'send', minutes: 5, tab: 'nope', text: 'hi' }), /an agent tab's id/)
  await assert.rejects(rig.rpc('timer', { act: 'timer', minutes: 5 }), /open the app/)
  const app = await connect(rig)
  t.after(() => app.close())
  app.notify('view', { tab: null, tabs: [], focused: false, browse: true })
  const got: any[] = []
  const relay = setInterval(() => {
    for (const m of app.events.splice(0)) if (m.ev === 'timer') (got.push(m), app.call('browseDone', m.act === 'stop' ? { id: m.req, ok: false, error: `no timer or stopwatch ${m.which}` } : { id: m.req, ok: true, result: { id: 'x1' } }))
  }, 20)
  t.after(() => clearInterval(relay))
  await until(async () => (await rig.rpc('timer', { act: 'remind', minutes: 0.5, ws: ws.id, note: ' stand up ' }).catch(() => null))?.id === 'x1', 'the app answers')
  assert.deepEqual([got.at(-1).act, got.at(-1).ms, got.at(-1).ws, got.at(-1).note], ['remind', 30000, ws.id, 'stand up'])
  await assert.rejects(rig.rpc('timer', { act: 'stop', id: 'zz' }), /no timer or stopwatch zz/)
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

test('a folder: Create with an agent makes another session beside its own (none: its own back); the creation log in development mode', async t => {
  const rig = await fresh(t)
  const folder = join(rig.home, 'notes')
  mkdirSync(folder)
  const p = await rig.rpc('projectAdd', { path: folder })
  assert.equal(p.git, false)
  await rig.rpc('settingsSet', { devMode: true })
  const own = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  assert.equal((await rig.rpc('wsNew', { project: p.id, preset: 'none' })).id, own.id, 'none: the folder’s own, as it is')
  // the new-workspace page's Create: an agent and a prompt, a session of their own beside it, in the same folder
  const next = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'from which app are you running' })
  assert.notEqual(next.id, own.id)
  assert.deepEqual([next.id, next.kind, next.path], ['from-which-app-are', 'local', own.path])
  const tab = await until(() => rig.tab(next.id), 'its claude tab')
  assert.equal(tab.preset, 'claude')
  await until(() => rig.fakeLog().some(l => l.bin === 'claude' && l.args.at(-1) === 'from which app are you running'), 'claude started on the prompt')
  // what making it ran, step by step (Settings › General › Creation log), and the tab's command in its own log
  const said = (await rig.rpc('logs', { key: 'new' })).map((l: { text: string }) => l.text)
  assert.ok(said.some((l: string) => l.startsWith(`${p.id}: asked: {`) && l.includes('"preset":"claude"')), said.join('\n'))
  assert.ok(said.includes(`${p.id}: ${own.id} is the folder's own workspace: another one beside it`), said.join('\n'))
  assert.ok(said.some((l: string) => l.startsWith(`${p.id}: agent: claude`)), said.join('\n'))
  const mine = (await rig.rpc('logs', { key: `ws:${next.id}` })).map((l: { text: string }) => l.text)
  assert.ok(mine.some((l: string) => l.startsWith('claude: ') && l.includes('-lic claude --settings ') && l.includes('--plugin-dir') && l.endsWith('/notes)')), mine.join('\n'))
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'nope' }))
  assert.ok((await rig.rpc('logs', { key: 'new' })).some((l: { text: string }) => l.text.startsWith(`${p.id}: failed: `)), 'a failure says why')
})

test("project notes: projectSet keeps them, blank drops them; ls --json leaves them out", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, notes: '# Links\n- Staging: https://staging.example\n' })
  assert.equal((await rig.rpc('state')).projects[0].notes, '# Links\n- Staging: https://staging.example\n')
  await rig.rpc('projectSet', { id: p.id, name: 'App' }) // another field: the notes stay
  assert.match((await rig.rpc('state')).projects[0].notes, /^# Links/)
  const ls = await rig.cli('ls', '--json')
  assert.equal(ls.code, 0, ls.err)
  assert.ok(!ls.out.includes('staging.example'), 'agents never see them')
  await rig.rpc('projectSet', { id: p.id, notes: '  \n ' })
  assert.equal((await rig.rpc('state')).projects[0].notes, undefined)
})

test("a project's color and icon: projectSet keeps them, '' clears them, anything else is refused", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const proj = async () => (await rig.rpc('state')).projects[0]
  await rig.rpc('projectSet', { id: p.id, color: 'teal', icon: 'star' })
  assert.equal((await proj()).color, 'teal')
  assert.equal((await proj()).icon, 'star')
  await rig.rpc('projectSet', { id: p.id, icon: ' 🛒 ' }) // an emoji, typed or pasted; the color stays
  assert.deepEqual([(await proj()).color, (await proj()).icon], ['teal', '🛒'])
  await assert.rejects(rig.rpc('projectSet', { id: p.id, name: 'App', color: 'chartreuse' }), /chartreuse isn't a color/)
  await assert.rejects(rig.rpc('projectSet', { id: p.id, name: 'App', icon: 'hello there' }), /an icon's name or an emoji/)
  await assert.rejects(rig.rpc('projectSet', { id: p.id, icon: '🛒'.repeat(20) }), /an emoji/) // short only
  assert.deepEqual([(await proj()).name, (await proj()).icon], [p.name, '🛒'], 'a refusal changes nothing')
  await rig.rpc('projectSet', { id: p.id, color: 'none', icon: '' })
  assert.deepEqual([(await proj()).color, (await proj()).icon], [undefined, undefined])
})

test("project memory: projectSet keeps the list, drops bad items, an empty one clears it; ls --json leaves it out", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, memory: [{ id: 'm-1', text: 'Deploys go through staging first', at: 5 }, { id: 'm-1', text: 'a twin' }, { id: 'bad id!', text: 'x' }, { id: 'm-2', text: '  ' }, { id: 'm-3', text: 'Ask Ann about billing', at: 6, edited: 7 }] })
  const kept = (await rig.rpc('state')).projects[0].memory
  assert.deepEqual(kept, [{ id: 'm-1', text: 'Deploys go through staging first', at: 5 }, { id: 'm-3', text: 'Ask Ann about billing', at: 6, edited: 7 }])
  await rig.rpc('projectSet', { id: p.id, name: 'App' }) // another field: the list stays
  assert.equal((await rig.rpc('state')).projects[0].memory.length, 2)
  const ls = await rig.cli('ls', '--json')
  assert.ok(!ls.out.includes('staging first'), 'agents never see it')
  await rig.rpc('projectSet', { id: p.id, memory: [] })
  assert.equal((await rig.rpc('state')).projects[0].memory, undefined)
})

test('a shell tab running a command is running until its prompt is back', async t => {
  const rig = await fresh(t)
  const c = await rig.connect() // shells are checked only while someone looks
  t.after(() => c.ws.close())
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'sh' })
  const shell = await until(() => rig.tab(w.id, 'shell'), 'the shell tab')
  await until(async () => (await rig.screen(shell.id)).includes('$'), 'its prompt')
  assert.equal((await rig.tab(w.id, 'shell')).status, 'idle')
  await rig.rpc('input', { tab: shell.id, data: 'sleep 3\r' })
  await until(async () => (await rig.tab(w.id, 'shell')).status === 'running', 'running while sleep runs', 5000)
  await until(async () => (await rig.tab(w.id, 'shell')).status === 'idle', 'idle once it ends', 8000)

  // an agent typed there (node …/claude): its status off its screen, as an agent tab's; no spinner while it sits idle
  const bin = join(rig.home, 'agent')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'claude'),
    `#!/usr/bin/env node
const say = (s, ms) => setTimeout(() => process.stdout.write('\\x1b[2J\\x1b[H' + s), ms)
say('✻ Working… (esc to interrupt)\\r\\n', 0)
say('> \\r\\n', 5000)
say('Do it?\\r\\n❯ 1. Yes\\r\\n  2. No\\r\\n', 10000)
setTimeout(() => {}, 60000)
`,
    { mode: 0o755 },
  )
  await rig.rpc('input', { tab: shell.id, data: `${join(bin, 'claude')}\r` })
  const sh = () => rig.tab(w.id, 'shell')
  await until(async () => (await sh()).runs === 'claude' && (await sh()).status === 'running', 'working', 5000)
  await until(async () => (await sh()).status === 'idle', 'idle: no spinner', 7000)
  assert.equal((await sh()).done, true, 'done: no one was looking')
  await until(async () => (await sh()).status === 'waiting', 'its menu', 8000)
  assert.deepEqual((await sh()).ask.options.map((o: any) => o.label), ['Yes', 'No'])
  await rig.rpc('input', { tab: shell.id, data: '\x03' })
  await until(async () => !(await sh()).runs && (await sh()).status === 'idle', 'the agent gone', 5000)
})

test('what an agent publishes is kept as a link: its publish tool, the hosts its last answer names; once each', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const tab = await until(() => rig.tab(w.id, 'shell'), 'its tab')
  const dir = await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).storage, 'its storage folder')
  const used = (tool_name: string, tool_input: object, tool_response: unknown) => rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response } })
  await used('Artifact', { file_path: '/tmp/site-notes.html' }, 'Published https://claude.ai/artifact/SyQ5g1JA · subscribed')
  await used('Artifact', { action: 'list' }, 'https://claude.ai/artifact/Other1') // a listing publishes nothing
  await used('mcp__artifacto__publish_page', { title: 'Q3 report' }, [{ type: 'text', text: 'ok: https://artifacto.example/p/9f.' }])
  await used('Read', {}, 'see https://old.vercel.app') // a file read isn't a publish
  await used('Artifact', { file_path: '/tmp/.notes.html', title: { not: 'a string' } }, 'https://claude.ai/artifact/Dot123') // no hidden file, no [object Object]
  writeFileSync(join(dir, 'Mine.url'), '[InternetShortcut]\nURL=https://gist.github.com/me/abc/\n') // the agent saved this one itself
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'Done. I published [the notes](https://claude.ai/artifact/SyQ5g1JA), the gist is https://gist.github.com/me/abc and the shop is live at https://shop.vercel.app/. Docs: https://docs.example.com' } })
  const urls = async () => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.url')).map(f => [f, /URL=(\S+)/.exec(readFileSync(join(dir, f), 'utf8'))![1]]))
  await until(async () => Object.keys(await urls()).length === 5, 'five links')
  assert.deepEqual(await urls(), { 'site-notes.url': 'https://claude.ai/artifact/SyQ5g1JA', 'notes.url': 'https://claude.ai/artifact/Dot123', 'Q3 report.url': 'https://artifacto.example/p/9f', 'Mine.url': 'https://gist.github.com/me/abc/', 'the shop is live.url': 'https://shop.vercel.app/' })
  // the same link again, another turn: nothing new
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'Still at https://shop.vercel.app' } })
  await new Promise(r => setTimeout(r, 300))
  assert.equal(Object.keys(await urls()).length, 5)
  await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).links?.length === 5, 'in the view')
})

test('Artifacts: the files in a workspace storage folder, hidden ones not counted', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const ws = async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id)
  const dir = await until(async () => (await ws()).storage, 'its storage folder')
  // yours alone: the storage folder, and state.json (settings' env, the webhook's URL)
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(join(rig.data, 'state.json')).mode & 0o777, 0o600)
  assert.equal((await ws()).artifacts, undefined)
  mkdirSync(join(dir, 'shots', '.cache'), { recursive: true })
  mkdirSync(join(dir, '.git'))
  for (const f of ['report.md', 'shots/home.png', 'shots/.cache/x', '.git/HEAD', '.DS_Store']) writeFileSync(join(dir, f), 'x')
  await until(async () => (await ws()).artifacts === 2, 'two files')
  // the gallery's: its files newest first, each read as the side panel reads one; nothing outside the folder
  writeFileSync(join(dir, 'report.md'), '# ok')
  assert.deepEqual((await rig.rpc('artifactList', { ws: w.id })).map((f: any) => f.path), ['report.md', 'shots/home.png'])
  assert.equal((await rig.rpc('fileRead', { ws: w.id, path: 'report.md', storage: true })).text, '# ok')
  await assert.rejects(rig.rpc('fileRead', { ws: w.id, path: '../../state.json', storage: true }), /not a path inside/)
  // the app's viewer: GET /artifact/<key>/<ws>/<path>, sandboxed, its files beside it too; the key, nothing outside
  const { port } = rig.info()
  const v0 = await rig.rpc('state')
  const widgetKey = v0.workspaces.find((x: any) => x.id === w.id).artKey // this workspace's key, never the master
  assert.equal(v0.widgetKey, undefined)
  mkdirSync(join(dir, 'site'))
  writeFileSync(join(dir, 'site', 'index.html'), '<link rel="stylesheet" href="a.css"><h1>hi</h1>')
  writeFileSync(join(dir, 'site', 'a.css'), 'h1 { color: red }')
  const page = await fetch(`http://127.0.0.1:${port}/artifact/${widgetKey}/${w.id}/site/index.html`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy')!, /^sandbox allow-scripts; default-src 'none'/)
  assert.equal(await page.text(), '<link rel="stylesheet" href="a.css"><h1>hi</h1>')
  const css = await fetch(`http://127.0.0.1:${port}/artifact/${widgetKey}/${w.id}/site/a.css`)
  assert.equal(css.headers.get('content-type'), 'text/css')
  assert.equal(css.headers.get('access-control-allow-origin'), null) // CORS only for its sandboxed page (Origin null)
  const fromPage = await fetch(`http://127.0.0.1:${port}/artifact/${widgetKey}/${w.id}/site/a.css`, { headers: { origin: 'null' } })
  assert.equal(fromPage.headers.get('access-control-allow-origin'), 'null')
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${widgetKey}/${w.id}/site/a.css`, { headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null)
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${'0'.repeat(widgetKey.length)}/${w.id}/site/index.html`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${widgetKey}/${w.id}/..%2f..%2fstate.json`)).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${widgetKey}/nope/site/index.html`)).status, 401) // another workspace: not with this key
  // workspace B's key opens neither A's artifacts nor a plan page
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'other' })
  const bKey = (await rig.rpc('state')).workspaces.find((x: any) => x.id === b.id).artKey
  assert.notEqual(bKey, widgetKey)
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${bKey}/${w.id}/site/index.html`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${port}/plan/${p.id}/spec/x/p.html?key=${bKey}`)).status, 401)
  rmSync(join(dir, 'site'), { recursive: true })
  // a link an agent kept (a .url file): in the view for the info panel, first in the gallery; only http(s)
  writeFileSync(join(dir, 'Project page.url'), '[InternetShortcut]\r\nURL=https://claude.ai/artifact/SyQ5\r\n')
  writeFileSync(join(dir, 'bad.url'), '[InternetShortcut]\nURL=javascript:alert(1)\n')
  const links = await until(async () => (await ws()).links, 'its link')
  assert.deepEqual(links.map((l: any) => [l.title, l.url]), [['Project page', 'https://claude.ai/artifact/SyQ5']])
  assert.deepEqual((await rig.rpc('artifactList', { ws: w.id })).slice(0, 2).map((f: any) => f.path).sort(), ['Project page.url', 'bad.url']) // .url files first
  // a local page's (file:///, as codex keeps its own artifacts; a space in its path too): a link too; a file:// with a host isn't
  mkdirSync(join(dir, 'reviews'))
  writeFileSync(join(dir, 'reviews', 'Review 14438.url'), '[InternetShortcut]\nURL=file:///Users/me/Library/Application Support/codex/14438/review.html\n')
  writeFileSync(join(dir, 'host.url'), '[InternetShortcut]\nURL=file://evil/share/x.html\n')
  await until(async () => (await ws()).links?.length === 2, 'the local link')
  assert.deepEqual((await ws()).links.map((l: any) => [l.path, l.url]).sort(), [['Project page.url', 'https://claude.ai/artifact/SyQ5'], ['reviews/Review 14438.url', 'file:///Users/me/Library/Application Support/codex/14438/review.html']])
  rmSync(join(dir, 'reviews'), { recursive: true })
  rmSync(join(dir, 'host.url'))
  rmSync(join(dir, 'bad.url'))
  rmSync(join(dir, 'shots'), { recursive: true })
  rmSync(join(dir, 'report.md'))
  rmSync(join(dir, 'Project page.url'))
  await until(async () => (await ws()).artifacts === undefined, 'none again')
})

test('Terminals and Browsers: a project each in the home folder, a workspace per terminal or page', async t => {
  const rig = await fresh(t)
  const [a, b] = await Promise.all([rig.rpc('quickNew', { kind: 'shells' }), rig.rpc('quickNew', { kind: 'shells' })]) // at once: one after the other
  const web = await rig.rpc('quickNew', { kind: 'browsers', url: 'https://example.com/' })
  await assert.rejects(rig.rpc('quickNew', { kind: 'browsers', url: 'file:///etc/passwd' }), /http\(s\) only/)
  await assert.rejects(rig.rpc('quickNew', { kind: 'nope' }), /shells or browsers/)
  const v = await rig.rpc('state')
  const shells = v.projects.find((p: any) => p.kind === 'shells')
  assert.deepEqual([shells.name, shells.path, shells.git], ['Terminals', rig.home, false])
  assert.deepEqual([a.name, b.name, a.kind, a.path, a.project, b.project], ['terminal 1', 'terminal 2', 'local', rig.home, shells.id, shells.id])
  assert.equal(v.tabs.filter((x: any) => x.workspace === a.id && x.kind === 'shell').length, 1)
  assert.deepEqual([web.name, web.browser, v.tabs.some((x: any) => x.workspace === web.id)], ['example.com', 'https://example.com/', false]) // the site, until its title
  assert.equal((await rig.rpc('quickNew', { kind: 'browsers' })).name, 'browser 1')
  await rig.rpc('wsSet', { id: web.id, browser: 'https://example.org/a', name: 'Example' })
  await assert.rejects(rig.rpc('wsSet', { id: web.id, browser: 'javascript:alert(1)' }), /http\(s\) page/)
  await assert.rejects(rig.rpc('wsSet', { id: a.id, browser: 'https://example.com/' }), /Browsers workspace/)
  await assert.rejects(rig.rpc('tabNew', { ws: web.id }), /a browser page: it has no tabs/)
  const w = (await rig.rpc('state')).workspaces.find((x: any) => x.id === web.id)
  assert.deepEqual([w.browser, w.name], ['https://example.org/a', 'Example'])
  assert.deepEqual((await rig.rpc('files', { ws: a.id })).files, []) // the home folder isn't walked
  // agents see which projects are Terminals and Browsers (the skill tells them to keep out)
  const ls = JSON.parse((await rig.cli('ls', '--json')).out)
  assert.deepEqual(ls.projects.map((p: any) => p.kind).sort(), ['browsers', 'shells'])
  // the home folder added as a project of its own isn't Terminals
  const home = await rig.rpc('projectAdd', { path: rig.home })
  assert.notEqual(home.id, shells.id)
  // a Shells project from 0.7 is Terminals after a restart; one you named stays
  await rig.rpc('projectSet', { id: shells.id, name: 'Shells' })
  await rig.rpc('projectSet', { id: (v.projects.find((p: any) => p.kind === 'browsers')).id, name: 'Shells' })
  await rig.stop()
  await rig.start()
  const names = (await rig.rpc('state')).projects.map((p: any) => `${p.kind}:${p.name}`).sort()
  assert.deepEqual(names.filter((x: string) => !x.startsWith('undefined')), ['browsers:Shells', 'shells:Terminals'])
})

test("new worktrees: the page's base is the repo's main branch; Sync the base branch fetches origin's first; the rail holds 5 pins", async t => {
  const rig = await fresh(t)
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: rig.env }).toString().trim()
  // origin a commit ahead of main; the repo itself on another branch
  const origin = join(rig.home, 'origin.git')
  git(rig.home, 'clone', '-q', '--bare', rig.repo, origin)
  git(rig.repo, 'remote', 'add', 'origin', origin)
  git(rig.repo, 'fetch', '-q', 'origin')
  git(rig.repo, 'remote', 'set-head', 'origin', 'main')
  git(rig.repo, 'checkout', '-q', '-b', 'old')
  const up = join(rig.home, 'up')
  git(rig.home, 'clone', '-q', origin, up)
  writeFileSync(join(up, 'NEW.md'), 'new\n')
  git(up, 'add', 'NEW.md')
  git(up, 'commit', '-qm', 'newer')
  git(up, 'push', '-q', 'origin', 'main')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.deepEqual(await rig.rpc('branches', { project: p.id }), { current: 'old', branches: ['main', 'old'], main: 'main' })

  // off: main as it is here, no fetch
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'a', base: 'main' })
  assert.equal(existsSync(join(a.path, 'NEW.md')), false)
  // origin's: off origin/main, main here as it was, no upstream (a push never goes to main)
  await rig.rpc('settingsSet', { syncBase: 'origin' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'b', base: 'main' })
  assert.equal(b.base, 'origin/main')
  assert.ok(existsSync(join(b.path, 'NEW.md')))
  assert.notEqual(git(rig.repo, 'rev-parse', 'main'), git(rig.repo, 'rev-parse', 'origin/main'))
  assert.notEqual(spawnSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: b.path }).status, 0)
  // fast-forward: main itself moved up (checked out nowhere)
  await rig.rpc('settingsSet', { syncBase: 'ff' })
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'c', base: 'main' })
  assert.equal(c.base, 'main')
  assert.ok(existsSync(join(c.path, 'NEW.md')))
  assert.equal(git(rig.repo, 'rev-parse', 'main'), git(rig.repo, 'rev-parse', 'origin/main'))
  // a fetch that fails (origin gone): the base as it is, the workspace made all the same
  git(rig.repo, 'remote', 'set-url', 'origin', join(rig.home, 'gone.git'))
  const d = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'd', base: 'old' })
  assert.equal(d.base, 'old')

  // the rail's quick access: 5 at most, in the order pinned; unpinning makes room
  const e = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'e' })
  const f = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'f' })
  for (const w of [a, b, c, d, e]) await rig.rpc('wsSet', { id: w.id, railPin: true })
  await assert.rejects(rig.rpc('wsSet', { id: f.id, railPin: true }), /the rail holds 5: unpin one first/)
  const at = (await rig.rpc('state')).workspaces.find((w: any) => w.id === a.id).railPin
  await rig.rpc('wsSet', { id: a.id, railPin: true }) // pinned again: its place kept
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === a.id).railPin, at)
  await rig.rpc('wsSet', { id: b.id, railPin: false })
  await rig.rpc('wsSet', { id: f.id, railPin: true })
  const pins = (await rig.rpc('state')).workspaces.filter((w: any) => w.railPin).sort((x: any, y: any) => x.railPin - y.railPin)
  assert.deepEqual(pins.map((w: any) => w.id), [a.id, c.id, d.id, e.id, f.id])
  // one restored after the rail filled up meanwhile: off it
  await rig.rpc('wsArchive', { id: a.id })
  await rig.rpc('wsSet', { id: b.id, railPin: true })
  assert.equal((await rig.rpc('wsRestore', { id: a.id })).railPin, undefined)

  // a local base with commits origin hasn't: it stays the base (origin's would leave them out)
  git(rig.repo, 'remote', 'set-url', 'origin', origin)
  await rig.rpc('settingsSet', { syncBase: 'origin' })
  git(rig.repo, 'push', '-q', 'origin', 'old')
  git(rig.repo, 'checkout', '-q', 'main')
  git(rig.repo, 'commit', '-q', '--allow-empty', '-m', 'mine only') // on main: ahead of origin/main
  const g = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'g', base: 'main' })
  assert.equal(g.base, 'main')
  const og = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'og', base: 'old' }) // pushed as it is: origin's
  assert.equal(og.base, 'origin/old')
  // a base that looks like an option never reaches git fetch
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'h', base: '--upload-pack=touch x' }), /a branch, not an option/)
  assert.equal(existsSync(join(rig.repo, 'x')), false)
})

test("an extension's https picture comes through the daemon's /img, behind its own key: never the app window's fetch (L7)", async t => {
  const rig = await fresh(t)
  const { port } = rig.info()
  const v = await rig.rpc('state')
  assert.match(v.imgKey, /\w{16,}/)
  const img = (k: string, u: string) => fetch(`http://127.0.0.1:${port}/img?k=${k}&u=${encodeURIComponent(u)}`)
  assert.equal((await img('nope', 'https://example.com/a.png')).status, 401)
  assert.equal((await img(v.imgKey, 'http://example.com/a.png')).status, 400) // https only
  assert.equal((await img(v.imgKey, 'file:///etc/passwd')).status, 400)
  for (const u of ['https://127.0.0.1:1/a.png', 'https://localhost/a.png', 'https://192.168.1.1/a.png', 'https://[::1]/a.png']) assert.equal((await img(v.imgKey, u)).status, 400, u) // never this Mac's or the LAN's
})
