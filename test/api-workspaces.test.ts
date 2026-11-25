// The daemon's API, workspaces and projects: a project's folders, notes, color, memory and tickets, workspaces'
// bases, restart, ship, diff size, menus and the agent browser, new worktrees, storage and artifacts, a managed
// policy (split from api.test.ts)
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, sleep, until } from './helpers.ts'

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

test('workspaces: a bad base, what only worktrees do, a failed restore, a gone base branch, a fork without claude', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', base: 'no-such-branch' }), /base no-such-branch not found in /)
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
  // Changes' Since: only what changed after a commit of the branch, what isn't committed too; its newest: only that;
  // never a flag, another ref's name or a commit that isn't behind HEAD
  const gitIn = (...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env, encoding: 'utf8' }).trim()
  const was = gitIn('rev-parse', 'HEAD')
  gitIn('commit', '-qam', 'one')
  const one = gitIn('rev-parse', 'HEAD')
  writeFileSync(join(ws.path, 'b.txt'), 'b\n')
  gitIn('add', 'b.txt')
  gitIn('commit', '-qm', 'two')
  writeFileSync(join(ws.path, 'README.md'), 'changed again\n')
  const since = await rig.rpc('diff', { ws: ws.id, since: one })
  assert.deepEqual([since.from, since.files.map((f: any) => f.path).sort()], [one, ['README.md', 'b.txt']])
  assert.equal(since.base, d.base, 'the base branch still: Change base and Open on remote read it')
  assert.deepEqual((await rig.rpc('diff', { ws: ws.id, since: gitIn('rev-parse', 'HEAD') })).files.map((f: any) => f.path), ['README.md'])
  for (const bad of ['--output=x', 'main', 'f'.repeat(40)]) await assert.rejects(rig.rpc('diff', { ws: ws.id, since: bad }), /isn't a commit of this branch/, bad)
  gitIn('reset', '-q', '--hard', was)
  writeFileSync(join(ws.path, 'README.md'), 'changed\n')

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
  await assert.rejects(rig.rpc('ship', { ws: ws.id, message: 'x' }), /nothing to ship/) // nothing changed, nothing committed
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

test('diff size, archive only when clean, the first-run checks', async t => {
  const rig = await fresh(t, { env: { LAKI_STAT_SCAN_MS: '150' } }) // diff sizes scanned every 0.15 s
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const stat = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.stat
  await sleep(400) // 2 scans
  assert.equal(await stat(), undefined) // the Review tab's, on by default: only for a workspace a window shows
  assert.deepEqual(await rig.rpc('wsStat', { ws: ws.id }), { add: 0, del: 0, files: 0, dirty: 0, made: 0, gone: 0 }) // a row's hover card: asked for, now
  const app = await connect(rig)
  await app.call('view', { tab: null, ws: ws.id, focused: true })
  await until(async () => (await stat())?.files === 0, 'a clean stat for the workspace on screen')
  await rig.rpc('settingsSet', { fullReview: false })
  await until(async () => (await stat()) === undefined, 'none with the Review tab off')
  app.close()
  await rig.rpc('settingsSet', { diffStat: true })
  await until(async () => (await stat())?.files === 0, 'a clean stat')
  writeFileSync(join(ws.path, 'README.md'), 'hello\nmore\n') // +1 against the base
  writeFileSync(join(ws.path, 'new.txt'), 'a\nb\nc') // a new file: 3 lines
  writeFileSync(join(ws.path, 'blob.bin'), Buffer.from([0, 1, 2, 10, 10])) // binary: no lines
  assert.deepEqual(await until(async () => ((s => s?.files === 3 && s)(await stat())), 'the stat'), { add: 4, del: 0, files: 3, dirty: 3, made: 2, gone: 0 }) // 2 new files
  assert.deepEqual(await rig.rpc('wsArchive', { id: ws.id, ifClean: true }), { dirty: 3 }) // not archived: it'd lose them
  assert.deepEqual(await rig.rpc('wsPeek', { id: ws.id }), { dirty: 3, ahead: 0, unpushed: 0, files: ['README.md', 'blob.bin', 'new.txt'] }) // what Delete's question says, the files named
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).archived, undefined)
  execFileSync('git', ['add', '-A'], { cwd: ws.path })
  execFileSync('git', ['commit', '-qm', 'work'], { cwd: ws.path, env: rig.env }) // its author: Linux has no user@host.local to fall back on
  await until(async () => (await stat())?.dirty === 0, 'committed') // still +4 against the base
  assert.deepEqual(await stat(), { add: 4, del: 0, files: 3, dirty: 0, made: 2, gone: 0 })
  assert.deepEqual(await rig.rpc('wsPeek', { id: ws.id }), { dirty: 0, ahead: 1, unpushed: 1 }) // a commit of its own, on no remote
  assert.equal(await rig.rpc('wsArchive', { id: ws.id, ifClean: true }), null)
  assert.deepEqual(await rig.rpc('wsPeek', { id: ws.id }), {}) // archived: no folder to ask
  await until(async () => (await stat()) === undefined, 'no stat once archived')
  await rig.rpc('settingsSet', { diffStat: false })
  await rig.rpc('wsRestore', { id: ws.id })
  await sleep(400)
  assert.equal(await stat(), undefined) // turned off
  // an agent switches the worktree to a branch of its own: the workspace follows it, and its PR is that branch's
  execFileSync('git', ['checkout', '-qb', 'agent-made'], { cwd: ws.path })
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.branch === 'agent-made', 'the new branch')
  await until(() => /gh pr view agent-made /.test(readFileSync(join(rig.home, 'fake.log'), 'utf8')), "its PR looked up")
  // doctor: git and the fake agents on PATH, gh signed out until it says otherwise
  let d = await rig.rpc('doctor')
  assert.deepEqual([d.git, d.gh, d.agents.find((a: any) => a.id === 'claude').found], [true, 'out', true])
  mkdirSync(join(rig.home, 'gh'), { recursive: true })
  writeFileSync(join(rig.home, 'gh', 'auth'), "Logged in to github.com\n  - Token scopes: 'gist', 'repo'\n")
  d = await rig.rpc('doctor')
  assert.deepEqual([d.gh, d.ghCodespace], ['in', false]) // cloud workspaces' scope: the optional line
  writeFileSync(join(rig.home, 'gh', 'auth'), "Logged in to github.com\n  - Token scopes: 'codespace', 'gist', 'repo'\n")
  assert.equal((await rig.rpc('doctor')).ghCodespace, true)
  // U4: an agent signed in: its sign-in's file there (never read)
  const signed = (d: any) => ['claude', 'codex'].map(id => d.agents.find((a: any) => a.id === id)?.signedIn)
  assert.deepEqual(signed(d), [false, false])
  mkdirSync(join(rig.home, '.claude'), { recursive: true })
  writeFileSync(join(rig.home, '.claude', '.credentials.json'), '{"never":"read"}')
  mkdirSync(join(rig.home, '.codex'), { recursive: true })
  writeFileSync(join(rig.home, '.codex', 'auth.json'), '{}')
  assert.deepEqual(signed(await rig.rpc('doctor')), [true, true])
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
  assert.equal(asked.question, 'Do you want to proceed?') // the Needs you list's card
  assert.ok((await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)?.needAt <= Date.now()) // waiting since
  const first = rig.rpc('answer', { tab: tab.id, n: 3 })
  await sleep(100) // it holds the tab for a second after its Enter
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1 }), /being answered/) // a double click answers once
  assert.deepEqual(await first, { picked: 'No, and tell Claude what to do differently (esc)' })
  await until(async () => /picked: No, and tell Claude/.test(await rig.rpc('screen', { target: tab.id })), 'two down arrows then Enter')
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 9 }), /isn't asking anything now|being answered/)
  // unread: ● again
  await rig.rpc('unread', { tab: tab.id })
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)?.done, true)
  // seen: the ● gone without a look
  await rig.rpc('seen', { tab: tab.id })
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id)?.done, false)
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
  for (const op of ['hover', 'select', 'check', 'drag']) await assert.rejects(rig.rpc('browse', { ws: ws.id, op }), /a CSS selector/, op)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'drag', selector: '.card' }), /a second CSS selector/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'press' }), /which key/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'press', key: 'Hyper+K' }), /Hyper\? Meta/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'select', selector: '#plan' }), /which option/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'scroll', edge: 'middle' }), /top or bottom/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'tabs', act: 'select' }), /its number/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'viewport', text: 'huge' }), /browser viewport: desktop, laptop, tablet, phone, or a width×height/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'tabs', act: 'new', url: 'https://example.com' }), /localhost only/)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'text' }), /needs Laki's window/)
  // with an app window that can: the op goes to it, its answer comes back (a path: on the workspace's port)
  const app = await connect(rig)
  t.after(() => app.close())
  app.notify('view', { tab: null, tabs: [], focused: false, browse: true })
  // through the client's events, as the renderer's: a message with an id would be a reply
  const relay = setInterval(() => {
    for (const m of app.events.splice(0)) if (m.ev === 'browse') app.call('browseDone', m.op === 'viewport' ? { id: m.req, ok: true, result: { url: m.home, title: '', viewport: `${m.size.w}×${m.size.h}` } } : m.op === 'text' ? { id: m.req, ok: true, result: { url: m.url ?? m.home, text: 'Hello' } } : ['drag', 'tabs', 'press'].includes(m.op) ? { id: m.req, ok: true, result: { got: [m.selector, m.to, m.key, m.act, m.n, m.url] } } : { id: m.req, ok: false, error: `no element matches ${m.selector}` })
  }, 20)
  t.after(() => clearInterval(relay))
  await until(async () => (await rig.rpc('browse', { ws: ws.id, op: 'text', url: '/about' }).catch(() => null))?.text === 'Hello', 'the app answers')
  assert.equal((await rig.rpc('browse', { ws: ws.id, op: 'text', url: '/about' })).url, `http://localhost:${ws.port}/about`)
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'click', selector: '#nope' }), /no element matches #nope/)
  // the new verbs' words reach the app as given (tabs new: its path on the workspace's port)
  assert.deepEqual((await rig.rpc('browse', { ws: ws.id, op: 'drag', selector: '.card', to: '#done' })).got, ['.card', '#done', null, null, null, null])
  assert.deepEqual((await rig.rpc('browse', { ws: ws.id, op: 'press', key: 'Meta+K' })).got, [null, null, 'Meta+K', null, null, null])
  assert.deepEqual((await rig.rpc('browse', { ws: ws.id, op: 'tabs', act: 'new', url: '/admin' })).got, [null, null, null, 'new', null, `http://localhost:${ws.port}/admin`])
  assert.deepEqual((await rig.rpc('browse', { ws: ws.id, op: 'tabs' })).got, [null, null, null, 'list', null, null])
  // #2: viewport: a name or a width×height, as a size the app lays its tabs out at
  assert.equal((await rig.rpc('browse', { ws: ws.id, op: 'viewport', text: 'Phone' })).viewport, '390×844')
  assert.equal((await rig.cli('browser', ws.id, 'viewport', '1024x768')).out, `http://localhost:${ws.port}/\nviewport: 1024×768\n`)
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
  assert.ok(mine.some((l: string) => l.startsWith('claude: ') && l.includes('-lic LAKI_ARG_0= LAKI_ARG_1= claude --settings ') /* S12: its arguments' variables emptied first */ && l.includes('--plugin-dir') && l.endsWith('/notes)')), mine.join('\n'))
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
  assert.equal((await rig.rpc('state')).projects[0].name, 'App')
  await rig.rpc('projectSet', { id: p.id, name: '  ' }) // empty: its folder's name again
  assert.equal((await rig.rpc('state')).projects[0].name, p.name)
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
  // one hidden file, .laki-links.json, not .url files: the agent's own is moved into it
  const urls = async () => (existsSync(join(dir, '.laki-links.json')) ? Object.fromEntries(JSON.parse(readFileSync(join(dir, '.laki-links.json'), 'utf8')).map((l: any) => [l.title, l.url])) : {})
  await until(async () => Object.keys(await urls()).length === 5, 'five links')
  assert.deepEqual(await urls(), { 'site-notes': 'https://claude.ai/artifact/SyQ5g1JA', notes: 'https://claude.ai/artifact/Dot123', 'Q3 report': 'https://artifacto.example/p/9f', Mine: 'https://gist.github.com/me/abc/', 'the shop is live': 'https://shop.vercel.app/' })
  assert.ok(!readdirSync(dir).some(f => f.endsWith('.url')), 'no .url file left')
  // the same link again, another turn: nothing new
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { last_assistant_message: 'Still at https://shop.vercel.app' } })
  await sleep(300)
  assert.equal(Object.keys(await urls()).length, 5)
  await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).links?.length === 5, 'in the view')
  // taken off: the gallery's right click
  await rig.rpc('linkRm', { ws: w.id, url: 'https://shop.vercel.app/' })
  assert.equal(Object.keys(await urls()).length, 4)
  assert.equal((await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).links.length, 4)
})

test('storage: its size, and files not changed for storageDays go (only the folders Laki made; 0: never)', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const dir: string = await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).storage, 'its storage folder')
  const old = Date.now() / 1000 - 40 * 86400
  mkdirSync(join(dir, 'shots'))
  for (const f of ['old.png', 'shots/old.png']) writeFileSync(join(dir, f), 'x'), utimesSync(join(dir, f), old, old)
  writeFileSync(join(dir, 'new.md'), 'fresh')
  mkdirSync(join(dir, 'empty-now')) // an agent's, its files still to come
  writeFileSync(join(dir, '.laki-links.json'), '[]\n'), utimesSync(join(dir, '.laki-links.json'), old, old)
  const other = join(dirname(dir), 'not-lakis')
  mkdirSync(other)
  writeFileSync(join(other, 'old.txt'), 'x'), utimesSync(join(other, 'old.txt'), old, old)
  const info = await rig.rpc('storageInfo')
  assert.equal(info.dir, dirname(dir))
  assert.ok(info.bytes > 0 && info.folders === 2, JSON.stringify(info))
  await rig.rpc('settingsSet', { storageDays: 0 })
  assert.equal(await rig.rpc('storageTidy', {}), 0)
  await rig.rpc('settingsSet', { storageDays: 30 })
  assert.equal(await rig.rpc('storageTidy', {}), 2)
  assert.deepEqual(readdirSync(dir).sort(), ['.laki-links.json', 'empty-now', 'new.md']) // the emptied folder too; its links and a folder just made stay
  assert.ok(existsSync(join(other, 'old.txt')), 'another folder of storageDir: never')
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
  assert.match(page.headers.get('content-security-policy')!, new RegExp(`^sandbox allow-scripts; default-src 'none'.*; connect-src 127\\.0\\.0\\.1:${port}/artifact/${widgetKey}/${w.id}/site/$`)) // its fetch('data.json'): its own folder only
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
  // S18: scripts from three CDNs, pictures from its own folder; another host once allowed (this report, or always), and
  // the viewer told what was blocked
  writeFileSync(join(dir, 'site', 'chart.html'), '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script src="https://evil.example/x.js?d=secret"></script><img src="https://i.imgur.com/a.png"><img srcset="https://i.imgur.com/b.png 2x">')
  const cspOf = async (f = 'chart.html', at = port, key = widgetKey) => (await fetch(`http://127.0.0.1:${at}/artifact/${key}/${w.id}/site/${f}`)).headers.get('content-security-policy')!
  let csp = await cspOf()
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com;/)
  assert.match(csp, /img-src 'self' data: blob:;/)
  assert.doesNotMatch(csp, /evil\.example|imgur| https:;| https: /, 'no other host, no https: at large')
  assert.deepEqual(await rig.rpc('artifactHosts', { ws: w.id, path: 'site/chart.html' }), { blocked: [{ host: 'evil.example', loads: { script: 1 } }, { host: 'i.imgur.com', loads: { image: 2 } }], allowed: [] }, "jsDelivr's script isn't blocked")
  await assert.rejects(rig.rpc('artifactAllow', { ws: w.id, path: 'site/chart.html', hosts: ['127.0.0.1'] }), /names on the internet/)
  await assert.rejects(rig.rpc('artifactAllow', { ws: w.id, path: 'site/chart.html', hosts: ['evil.example; script-src *'] }), /names on the internet/)
  await rig.rpc('artifactAllow', { ws: w.id, path: 'site/chart.html', hosts: ['evil.example'] })
  csp = await cspOf()
  assert.match(csp, /script-src [^;]*https:\/\/evil\.example;/)
  assert.doesNotMatch(await cspOf('index.html'), /evil/, 'for that report alone')
  assert.deepEqual((await rig.rpc('artifactHosts', { ws: w.id, path: 'site/chart.html' })).blocked.map((b: any) => b.host), ['i.imgur.com'])
  const tab0 = await rig.rpc('tabNew', { ws: w.id, preset: 'claude' }) // an agent's call: refused
  await assert.rejects(rig.rpc('artifactAllow', { ws: w.id, path: 'site/chart.html', hosts: ['x.example'], from: { ws: w.id, tab: tab0.id } }), /let a report's page load from another host/)
  // workspace B's key opens neither A's artifacts nor a plan page
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'other' })
  const bKey = (await rig.rpc('state')).workspaces.find((x: any) => x.id === b.id).artKey
  assert.notEqual(bKey, widgetKey)
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${bKey}/${w.id}/site/index.html`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${port}/plan/${p.id}/spec/x/p.html?key=${bKey}`)).status, 401)
  // View as page: GET /worktree/<its own key>/<ws>/<path>, the worktree's file and what's beside it; no fetch at all
  // (no connect-src), nothing of .git, nothing outside, not with the artifacts' key
  const wv = (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id)
  assert.notEqual(wv.wtKey, widgetKey)
  mkdirSync(join(wv.path, 'docs'))
  writeFileSync(join(wv.path, 'docs', 'mail.html'), '<link rel="stylesheet" href="m.css"><p>hello</p>')
  writeFileSync(join(wv.path, 'docs', 'm.css'), 'p { color: blue }')
  const wt = `http://127.0.0.1:${port}/worktree/${wv.wtKey}/${w.id}`
  const mail = await fetch(`${wt}/docs/mail.html`)
  assert.equal(mail.status, 200)
  assert.equal(await mail.text(), '<link rel="stylesheet" href="m.css"><p>hello</p>')
  assert.match(mail.headers.get('content-security-policy')!, /^sandbox allow-scripts; default-src 'none'/)
  assert.doesNotMatch(mail.headers.get('content-security-policy')!, /connect-src/)
  assert.equal((await fetch(`${wt}/docs/m.css`)).headers.get('content-type'), 'text/css')
  assert.equal((await fetch(`${wt}/.git/HEAD`)).status, 404)
  assert.equal((await fetch(`${wt}/.GIT/HEAD`)).status, 404)
  // its page's module scripts and styles load (CORS for its opaque origin); never its JSON: a JSON module would read any
  writeFileSync(join(wv.path, 'docs', 'keys.json'), '{"token":"fake-secret"}')
  assert.equal((await fetch(`${wt}/docs/m.css`, { headers: { origin: 'null' } })).headers.get('access-control-allow-origin'), 'null')
  assert.equal((await fetch(`${wt}/docs/keys.json`, { headers: { origin: 'null' } })).headers.get('access-control-allow-origin'), null)
  assert.equal((await fetch(`${wt}/..%2f..%2fstate.json`)).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${port}/worktree/${widgetKey}/${w.id}/docs/mail.html`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${port}/artifact/${wv.wtKey}/${w.id}/site/index.html`)).status, 401)
  rmSync(join(wv.path, 'docs'), { recursive: true })
  // a Terminals workspace's folder is your home: no key for it, no page of it
  const term = await rig.rpc('quickNew', { kind: 'shells' })
  assert.equal((await rig.rpc('state')).workspaces.find((x: any) => x.id === term.id).wtKey, undefined)
  assert.equal((await fetch(`http://127.0.0.1:${port}/worktree/${wv.wtKey}/${term.id}/x.html`)).status, 401)
  await rig.rpc('wsRm', { id: term.id }).catch(() => {})
  rmSync(join(dir, 'site'), { recursive: true })
  // a link an agent kept (a .url file): moved into the links file, in the view for the info panel, first in the
  // gallery (the app's: not a file); only http(s); one that isn't a link stays a file
  writeFileSync(join(dir, 'Project page.url'), '[InternetShortcut]\r\nURL=https://claude.ai/artifact/SyQ5\r\n')
  writeFileSync(join(dir, 'bad.url'), '[InternetShortcut]\nURL=javascript:alert(1)\n')
  const links = await until(async () => (await ws()).links, 'its link')
  assert.deepEqual(links.map((l: any) => [l.title, l.url]), [['Project page', 'https://claude.ai/artifact/SyQ5']])
  assert.ok(!existsSync(join(dir, 'Project page.url')))
  assert.deepEqual((await rig.rpc('artifactList', { ws: w.id })).map((f: any) => f.path).sort(), ['bad.url', 'report.md', 'shots/home.png'])
  // a local page's (file:///, as codex keeps its own artifacts; a space in its path too): a link too; a file:// with a host isn't
  mkdirSync(join(dir, 'reviews'))
  writeFileSync(join(dir, 'reviews', 'Review 14438.url'), '[InternetShortcut]\nURL=file:///Users/me/Library/Application Support/codex/14438/review.html\n')
  writeFileSync(join(dir, 'host.url'), '[InternetShortcut]\nURL=file://evil/share/x.html\n')
  await until(async () => (await ws()).links?.length === 2, 'the local link')
  assert.deepEqual((await ws()).links.map((l: any) => [l.title, l.url]).sort(), [['Project page', 'https://claude.ai/artifact/SyQ5'], ['Review 14438', 'file:///Users/me/Library/Application Support/codex/14438/review.html']])
  assert.equal((await ws()).artifacts, 6) // 4 files (bad.url, host.url, report.md, shots/home.png) and 2 links
  rmSync(join(dir, 'reviews'), { recursive: true })
  rmSync(join(dir, 'host.url'))
  rmSync(join(dir, 'bad.url'))
  rmSync(join(dir, 'shots'), { recursive: true })
  rmSync(join(dir, 'report.md'))
  rmSync(join(dir, '.laki-links.json'))
  await until(async () => (await ws()).artifacts === undefined, 'none again')
  // always: a setting, every report's, kept through a restart
  await rig.rpc('settingsSet', { artifactHosts: ['i.imgur.com', 'localhost', '10.0.0.1', 'I.IMGUR.com'] })
  assert.deepEqual((await rig.rpc('state')).settings.artifactHosts, ['i.imgur.com'], 'names on the internet only, once')
  await rig.stop()
  await rig.start()
  const at = rig.info().port
  const key2 = (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).artKey
  mkdirSync(join(dir, 'site'), { recursive: true })
  writeFileSync(join(dir, 'site', 'later.html'), '<img src="https://i.imgur.com/a.png">')
  csp = await cspOf('later.html', at, key2)
  assert.match(csp, /img-src 'self' data: blob: https:\/\/i\.imgur\.com;/)
  writeFileSync(join(dir, 'site', 'chart.html'), '<script src="https://evil.example/x.js"></script>')
  assert.doesNotMatch(await cspOf('chart.html', at, key2), /evil/, 'Allow for this report: until the daemon restarts')
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

test("a workspace's rail icon (wsSet icon): an icon's name or an emoji, '' none, anything else refused", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  const icon = async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === w.id).icon
  await rig.rpc('wsSet', { id: w.id, icon: 'terminal' })
  assert.equal(await icon(), 'terminal')
  await rig.rpc('wsSet', { id: w.id, icon: '🚀' })
  assert.equal(await icon(), '🚀')
  await assert.rejects(rig.rpc('wsSet', { id: w.id, icon: '<img src=x>' }), /an icon's name or an emoji/)
  await rig.rpc('wsSet', { id: w.id, icon: '' })
  assert.equal(await icon(), undefined)
})

test('update when idle: asked, in the view (the agent that asked as by), cancelled; the CLI says it', async t => {
  const rig = await fresh(t)
  assert.equal((await rig.rpc('state')).updateIdle, undefined)
  const r = await rig.rpc('updateIdle', { on: true })
  assert.ok(r.at > 0 && !r.by) // not from an agent's tab: no one's turn to spare
  assert.deepEqual((await rig.rpc('state')).updateIdle, r)
  assert.equal(await rig.rpc('updateIdle', { on: false }), null)
  assert.equal((await rig.rpc('state')).updateIdle, undefined)
  assert.match((await rig.cli('update', '--when-idle')).out, /once no agent works or asks/)
  assert.ok((await rig.rpc('state')).updateIdle)
  assert.match((await rig.cli('update', '--when-idle', '--off')).out, /off/)
  assert.equal((await rig.rpc('state')).updateIdle, undefined)
})

test('a managed policy: its settings locked, remote access off, approvals required, only some agents', async t => {
  const file = join(mkdtempSync('/tmp/laki-policy-'), 'policy.json')
  writeFileSync(file, JSON.stringify({ settings: { updateCheck: true, keepAwake: false, webhook: null }, remote: false, bypass: false, agents: ['claude'] }))
  const rig = await fresh(t, { env: { LAKI_POLICY: file } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const v = await rig.rpc('state')
  assert.deepEqual(v.managed, { from: file, keys: ['updateCheck', 'keepAwake', 'webhook'], remote: false, bypass: false, agents: ['claude'] })
  assert.equal(v.settings.updateCheck, true)
  await assert.rejects(rig.rpc('settingsSet', { keepAwake: true }), /keepAwake is managed by your organization/)
  await assert.rejects(rig.rpc('settingsSet', { webhook: { url: 'https://ntfy.sh/x', format: 'ntfy' } }), /webhook is managed/) // null: kept unset
  await rig.rpc('settingsSet', { keepAwake: false, fontSize: 14 }) // the same value back: fine
  await assert.rejects(rig.rpc('remoteStart', { hours: 1, mail: 'a@b.co' }), /remote access is turned off by your organization/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'c', preset: 'codex' }), /codex is turned off by your organization/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, name: 'b', preset: 'claude', perm: 'bypassPermissions' }), /requires approvals/)
  const a = await rig.rpc('wsNew', { project: p.id, name: 'a', preset: 'claude' })
  assert.equal(a.id, 'a')
  // a command tab that starts an agent is that agent; any other command, and a shell, start
  await assert.rejects(rig.rpc('tabNew', { ws: a.id, cmd: '/usr/local/bin/codex --full-auto' }), /codex is turned off by your organization/)
  await assert.rejects(rig.rpc('tabNew', { ws: a.id, cmd: 'claude --dangerously-skip-permissions' }), /requires approvals/)
  assert.ok((await rig.rpc('tabNew', { ws: a.id, cmd: 'claude' })).id)
  assert.ok((await rig.rpc('tabNew', { ws: a.id, cmd: 'echo hi' })).id)
  // remote: false is anything on the internet: a tunnel, a shared tab
  await assert.rejects(rig.rpc('tunnelStart', { ws: a.id, port: 3000 }), /a public address \(Expose to the world\) is turned off by your organization/)
  const tab = (await rig.rpc('state')).tabs.find((x: { workspace: string }) => x.workspace === a.id).id
  await assert.rejects(rig.rpc('shareStart', { tab }), /sharing a tab is turned off by your organization/)
})

test('a managed policy that comes after a tab: the tab made in bypass permissions doesn\'t start again in it', async t => {
  const file = join(mkdtempSync('/tmp/laki-policy-'), 'policy.json')
  t.after(() => rmSync(dirname(file), { recursive: true, force: true }))
  writeFileSync(file, '{}')
  const rig = await fresh(t, { env: { LAKI_POLICY: file } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const free = await rig.rpc('wsNew', { project: p.id, name: 'free', preset: 'claude', perm: 'bypassPermissions', prompt: 'hi' })
  const asks = await rig.rpc('wsNew', { project: p.id, name: 'asks', preset: 'claude', prompt: 'hi' })
  for (const w of [free, asks]) await until(async () => (await rig.tab(w.id, 'claude'))?.resumeId, 'its chat')
  writeFileSync(file, JSON.stringify({ bypass: false })) // deployed meanwhile: read as the daemon starts
  await rig.stop()
  await rig.start()
  await until(async () => (await rig.screen((await rig.tab(asks.id, 'claude')).id)).includes('fake claude'), 'the one that asks resumes')
  await sleep(400) // its start refused in the same pass that resumed the other
  const tab = await rig.tab(free.id, 'claude')
  assert.equal(tab.status, 'exited')
  const ws = await rig.connect() // the notice waits for the window: sent as it connects
  const n = await until(() => ws.events.find(e => e.ev === 'notice' && e.title === 'Not started'), 'a notice says why')
  assert.match(n.text, /requires approvals/)
  ws.ws.close()
  assert.ok(!rig.fakeLog().some((l: { args?: string[] }) => l.args?.includes('--resume') && l.args.includes('bypassPermissions')), 'not resumed in bypass permissions')
})

test("linked tickets: a project's Ticket script, run per workspace, its JSON or KEY title line in the view", async t => {
  const { ticketFrom } = await import('../src/daemon/tickets.ts')
  assert.deepEqual(ticketFrom('{"key":"ENG-12","title":"Fix cart","status":{"name":"In Progress"},"url":"https://linear.app/x/ENG-12"}'), { key: 'ENG-12', title: 'Fix cart', status: 'In Progress', url: 'https://linear.app/x/ENG-12' })
  assert.deepEqual(ticketFrom('PROJ-7 Totals round wrong\nmore'), { key: 'PROJ-7', title: 'Totals round wrong' })
  assert.deepEqual(ticketFrom('{"key":"A-1","url":"javascript:alert(1)"}'), { key: 'A-1' }) // a link only http(s)
  assert.equal(ticketFrom('  '), undefined)
  const rig = await fresh(t, { env: { LAKI_TICKET_TICK_MS: '300' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { ticket: 'printf \'{"key":"ENG-%s","title":"On %s","status":"Todo"}\' 42 "$LAKI_BRANCH"' } })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'tk' })
  const ws = await until(async () => (await rig.rpc('state')).workspaces.find((x: { id: string; ticket?: unknown }) => x.id === w.id && x.ticket), 'its ticket', 8000)
  assert.deepEqual(ws.ticket, { key: 'ENG-42', title: `On ${w.branch}`, status: 'Todo' })
  assert.deepEqual(ticketFrom('A-1\u001b[31m red'), { key: 'A-1 [31m', title: 'red' }) // a line's control characters out
})
