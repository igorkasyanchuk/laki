// Worktrees and their files: ignored files copied, .laki.json's trust, setup, diff, the side panel's files, a folder without git.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

test('a new worktree gets the ignored files .worktreeinclude and .laki.json copy name, with their modes, before setup', async t => {
  const rig = await fresh(t, { config: { setup: 'cat .env .env.local secrets/key > seen.txt', copy: ['secrets/'] } })
  const put = (f: string, s: string) => (mkdirSync(dirname(join(rig.repo, f)), { recursive: true }), writeFileSync(join(rig.repo, f), s))
  put('.env', 'A=1\n')
  chmodSync(join(rig.repo, '.env'), 0o600)
  put('.env.local', 'B=2\n')
  put('secrets/key', 'k\n')
  put('sub/.env', 'not this\n') // /.env: the root's only
  put('.env.prod', 'nor this\n')
  symlinkSync('/etc/hosts', join(rig.repo, '.env.link')) // out of the repo: never
  put('.worktreeinclude', '# what new worktrees get\n/.env\n.env.local\n.env.link\n')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const seen = join(ws.path, 'seen.txt')
  await until(() => existsSync(seen) && readFileSync(seen, 'utf8').length >= 8, 'setup read them')
  assert.equal(readFileSync(seen, 'utf8'), 'A=1\nB=2\nk\n')
  assert.equal(statSync(join(ws.path, '.env')).mode & 0o777, 0o600)
  for (const f of ['sub/.env', '.env.prod', '.env.link']) assert.ok(!existsSync(join(ws.path, f)), f)
})

test(".laki.json's trust: untrusted, its setup and env wait; trusting runs them; an edit stops them; ZDOTDIR refused; older projects trusted", async t => {
  const rig = await fresh(t, { config: { setup: 'echo "$FOO-$ZDOTDIR" > env.txt', env: { FOO: 'bar', ZDOTDIR: '/tmp/evil' }, ports: { 3000: 'web' } } })
  const p = await rig.rpc('projectAdd', { path: rig.repo, untrusted: true })
  const proj = async () => (await rig.rpc('state')).projects.find((x: { id: string }) => x.id === p.id)
  assert.ok((await proj()).cfgWait)
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const skip = await rig.rpc('wsNew', { project: p.id, preset: 'none', noSetup: true }) // its copy waits too, its setup never runs
  await sleep(1500)
  assert.ok(!existsSync(join(a.path, 'env.txt')), "an untrusted file's setup doesn't run")
  const ws = async (id: string) => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === id)
  assert.equal((await ws(a.id)).setupWait, true)
  assert.deepEqual((await ws(a.id)).portNames, { 3000: 'web' }) // names only: those stay
  // the sheet: its text and hash; a hash it isn't is refused
  const look = await rig.rpc('projectTrust', { id: p.id })
  assert.equal(look.trusted, false)
  assert.match(look.text, /"setup": "echo/)
  await assert.rejects(rig.rpc('projectTrust', { id: p.id, hash: 'nope' }), /changed since you looked/)
  await rig.rpc('projectTrust', { id: p.id, hash: look.hash })
  assert.equal((await proj()).cfgWait, undefined)
  // trusting runs the setup that waited, with its env, ZDOTDIR refused (and said once)
  // its line, not just the file: the shell's > makes it empty first, echo writes it a moment later
  await until(() => existsSync(join(a.path, 'env.txt')) && readFileSync(join(a.path, 'env.txt'), 'utf8').endsWith('\n'), 'the waiting setup runs')
  assert.equal(readFileSync(join(a.path, 'env.txt'), 'utf8'), 'bar-\n')
  assert.equal((await ws(a.id)).setupWait, undefined)
  assert.equal((await ws(skip.id)).setupWait, undefined)
  await sleep(1000)
  assert.ok(!existsSync(join(skip.path, 'env.txt')), 'skipped: trusting runs no setup')
  assert.equal(rig.out.split(".laki.json's env ZDOTDIR refused").length, 2) // said once
  // an edit: untrusted again, a new workspace's setup waits
  writeFileSync(join(rig.repo, '.laki.json'), JSON.stringify({ setup: 'touch edited' }))
  assert.ok((await proj()).cfgWait)
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await sleep(1500)
  assert.ok(!existsSync(join(b.path, 'edited')), "an edited file's setup doesn't run")
  // a project from before trust (no cfgTrust in state.json): trusted as its file is
  await rig.stop()
  const sp = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(sp, 'utf8'))
  delete st.cfgTrust
  writeFileSync(sp, JSON.stringify(st))
  await rig.start()
  assert.equal((await proj()).cfgWait, undefined)
})

test('workspace lifecycle: worktree, setup gating, port, delete keeps the branch', async t => {
  const rig = await fresh(t, { config: { setup: 'echo setting-up; sleep 1; echo setup-ok > .setup-ran', teardown: 'echo bye > "$LAKI_TEARDOWN_MARK"' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'build the thing', name: 'feat one' })
  assert.equal(ws.id, 'feat-one')
  assert.equal(ws.branch, 'laki/feat-one')
  assert.equal(ws.port, 3100)
  assert.ok(existsSync(join(ws.path, 'README.md')))
  // the agent waits for setup: claude hasn't started while the marker exists
  let v = await rig.rpc('state')
  assert.equal(v.workspaces[0].setup, true)
  assert.deepEqual(v.tabs.map((t: any) => t.name), ['setup', 'claude'])
  assert.ok(!existsSync(rig.env.FAKE_LOG) || !rig.fakeLog().some(l => l.bin === 'claude'))
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude after setup')
  assert.ok(existsSync(join(ws.path, '.setup-ran')), 'setup ran before the agent')
  const run = rig.fakeLog().find(l => l.bin === 'claude')
  assert.equal(run.port, '3100')
  assert.deepEqual(run.args.slice(0, 1), ['--settings'])
  assert.equal(run.args.at(-1), 'build the thing')
  v = await rig.rpc('state')
  assert.equal(v.workspaces[0].setup, false)
  // a second workspace gets the next port
  const ws2 = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  assert.equal(ws2.port, 3110)
  // delete: tabs die, worktree goes, branch stays
  await rig.rpc('wsRm', { id: ws.id })
  assert.ok(!existsSync(ws.path))
  const { execFileSync } = await import('node:child_process')
  assert.match(execFileSync('git', ['branch'], { cwd: rig.repo, encoding: 'utf8' }), /laki\/feat-one/)
  v = await rig.rpc('state')
  assert.deepEqual(v.workspaces.map((w: any) => w.id), [ws2.id])
  // the freed port is reused
  const ws3 = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'three' })
  assert.equal(ws3.port, 3100)
  // the same name again: laki/feat-one is kept, so the new one gets its own id and branch
  const again = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'feat one' })
  assert.match(again.id, /^feat-one-[a-z0-9]{4}$/)
  assert.equal(again.branch, `laki/${again.id}`)
  // a local workspace is the repo root itself
  const local = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'shell' })
  assert.equal(local.path, p.path)
  assert.equal(local.kind, 'local')
  await rig.rpc('wsRm', { id: local.id })
  assert.ok(existsSync(join(p.path, 'README.md')), 'deleting a local workspace keeps the repo')
})

test("noSetup: a worktree without its setup script, its agent at once, .worktreeinclude's files still copied; run setup later", async t => {
  const rig = await fresh(t, { config: { setup: 'touch .setup-ran; sleep 60' } }) // ran: claude would wait a minute
  writeFileSync(join(rig.repo, '.env'), 'A=1\n')
  writeFileSync(join(rig.repo, '.worktreeinclude'), '/.env\n')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.equal((await rig.rpc('state')).projects[0].hasSetup, true) // the new-workspace page shows Skip the setup script
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'go', noSetup: true })
  assert.equal(ws.noSetup, true)
  assert.equal(readFileSync(join(ws.path, '.env'), 'utf8'), 'A=1\n')
  let v = await rig.rpc('state')
  assert.deepEqual(v.tabs.map((t: any) => t.name), ['claude'])
  assert.equal(v.workspaces[0].setup, false)
  await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().some(l => l.bin === 'claude'), 'claude at once')
  assert.ok(!existsSync(join(ws.path, '.setup-ran')))
  // Run ▾'s Run the setup script: run's setup, in a setup tab; the mark goes
  const tab = await rig.rpc('run', { ws: ws.id, script: 'setup' })
  assert.equal(tab.kind, 'setup')
  await until(() => existsSync(join(ws.path, '.setup-ran')), 'setup ran')
  v = await rig.rpc('state')
  assert.equal(v.workspaces[0].noSetup, undefined)
  assert.equal(v.workspaces[0].setup, true)
  const local = await rig.rpc('wsNew', { project: p.id, local: true, preset: 'none' })
  await assert.rejects(rig.rpc('run', { ws: local.id, script: 'setup' }), /worktrees/)
})

test('diff: committed and uncommitted changes since the base, new files too', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const { execFileSync } = await import('node:child_process')
  writeFileSync(join(ws.path, 'README.md'), 'hello\nworld\n')
  execFileSync('git', ['commit', '-qam', 'more'], { cwd: ws.path, env: rig.env })
  writeFileSync(join(ws.path, 'README.md'), 'hello\nworld\nagain\n')
  writeFileSync(join(ws.path, 'new.txt'), 'brand new\n')
  const d = await rig.rpc('diff', { ws: ws.id })
  assert.deepEqual(d.files.map((f: any) => [f.path, f.add, f.del, f.status]), [['README.md', 2, 0, 'M'], ['new.txt', 1, 0, 'A']])
  assert.match(d.diff, /\+world/)
  assert.match(d.diff, /\+again/)
  assert.match(d.diff, /\+brand new/)
})

test("file preview edits: saved with the file's mode, refused over a change unless forced, only whole UTF-8 text inside", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const file = join(ws.path, 'run.sh')
  writeFileSync(file, 'echo hi\n', { mode: 0o755 })
  const save = (o: object) => rig.rpc('fileWrite', { ws: ws.id, path: 'run.sh', ...o })
  assert.deepEqual(await save({ text: 'echo hello\n', was: 'echo hi\n' }), { size: 11 })
  assert.equal(readFileSync(file, 'utf8'), 'echo hello\n')
  assert.equal(statSync(file).mode & 0o777, 0o755)
  // an agent changed it meanwhile: refused, unless asked to save over it
  writeFileSync(file, 'echo agent\n')
  await assert.rejects(save({ text: 'mine\n', was: 'echo hello\n' }), /run\.sh changed since you opened it/)
  assert.equal(readFileSync(file, 'utf8'), 'echo agent\n')
  await save({ text: 'mine\n', was: 'echo hello\n', force: true })
  assert.equal(readFileSync(file, 'utf8'), 'mine\n')
  // what the preview can't show whole, or as its bytes, isn't saved over
  writeFileSync(join(ws.path, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'latin1.txt' })).lossy, true)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'latin1.txt', text: 'x', force: true }), /can't be edited here/)
  writeFileSync(join(ws.path, 'big.txt'), 'x'.repeat((512 << 10) + 1))
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'big.txt', text: 'x', force: true }), /can't be edited here/)
  await assert.rejects(save({ text: 'x'.repeat((512 << 10) + 1), force: true }), /over 512 KB/)
  writeFileSync(join(ws.path, 'bin'), Buffer.from([0, 1, 2]))
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'bin', text: 'x', force: true }), /can't be edited here/)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: '../escape.txt', text: 'x', force: true }), /inside the workspace/)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'nope.txt', text: 'x', force: true }), /isn't a file|ENOENT/)
  assert.ok(!existsSync(join(ws.path, 'nope.txt')))
})

test('side panel: files with their changes, new files and folders, only inside the workspace', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.deepEqual(await rig.rpc('prThreads', { ws: ws.id }), []) // no PR yet: the fake gh gives every branch one at the first scan, 2 s after the daemon starts
  writeFileSync(join(ws.path, 'README.md'), 'changed\n')
  mkdirSync(join(ws.path, 'src'))
  writeFileSync(join(ws.path, 'src', 'new.ts'), 'x\n')
  writeFileSync(join(ws.path, '.gitignore'), 'ignored.log\n')
  writeFileSync(join(ws.path, 'ignored.log'), 'x\n')
  let f = await rig.rpc('files', { ws: ws.id })
  assert.ok(f.files.includes('README.md') && f.files.includes('src/new.ts'))
  assert.ok(!f.files.includes('ignored.log'))
  assert.equal(f.changed['README.md'], 'M')
  assert.equal(f.changed['src/new.ts'], 'A')
  assert.deepEqual(await rig.rpc('fileNew', { ws: ws.id, path: 'src/lib/a.ts' }), { path: 'src/lib/a.ts' })
  assert.ok(existsSync(join(ws.path, 'src/lib/a.ts')))
  await rig.rpc('fileNew', { ws: ws.id, path: 'docs', dir: true })
  assert.ok(statSync(join(ws.path, 'docs')).isDirectory())
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'src/lib/a.ts' }), /there already/)
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: '../escape.txt' }), /inside the workspace/)
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'finder', file: '/etc/passwd' }), /inside the workspace/)
  // links: one pointing out (a file, a folder, nothing) is out; one pointing in is fine
  symlinkSync('/etc/hosts', join(ws.path, 'hosts'))
  symlinkSync(rig.home, join(ws.path, 'home'))
  symlinkSync(join(rig.home, 'nope'), join(ws.path, 'gone'))
  symlinkSync('README.md', join(ws.path, 'readme'))
  await assert.rejects(rig.rpc('fileRead', { ws: ws.id, path: 'hosts' }), /inside the workspace/)
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'home/escape.txt' }), /inside the workspace/)
  await assert.rejects(rig.rpc('fileNew', { ws: ws.id, path: 'gone' }), /inside the workspace/)
  await assert.rejects(rig.rpc('openIn', { ws: ws.id, app: 'finder', file: 'home' }), /inside the workspace/)
  assert.ok(!existsSync(join(rig.home, 'escape.txt')))
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'readme' })).text, 'changed\n')
  f = await rig.rpc('files', { ws: ws.id })
  assert.ok(f.files.includes('src/lib/a.ts'))
  // the preview: text, an image, a binary file
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'README.md' }), { size: 8, text: 'changed\n' })
  writeFileSync(join(ws.path, 'dot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'dot.png' })).image, 'data:image/png;base64,iVBORw==')
  writeFileSync(join(ws.path, 'blob.bin'), Buffer.from([1, 0, 2]))
  assert.deepEqual(await rig.rpc('fileRead', { ws: ws.id, path: 'blob.bin' }), { size: 3 })
  writeFileSync(join(ws.path, 'big.log'), 'x'.repeat(600 << 10))
  const big = await rig.rpc('fileRead', { ws: ws.id, path: 'big.log' })
  assert.deepEqual([big.size, big.text.length, big.cut], [600 << 10, 512 << 10, true])
  await assert.rejects(rig.rpc('fileRead', { ws: ws.id, path: '../../etc/hosts' }), /inside the workspace/)
})

test('a folder without git is a project (local workspaces only); project settings override .laki.json', async t => {
  const rig = await fresh(t, { config: { run: 'echo from-file', teardown: 'echo bye' } })
  const plain = join(rig.home, 'notes')
  mkdirSync(plain)
  const np = await rig.rpc('projectAdd', { path: plain })
  assert.equal(np.git, false)
  assert.deepEqual(await rig.rpc('branches', { project: np.id }), { current: '', branches: [], main: '' })
  const nw = await rig.rpc('wsNew', { project: np.id, preset: 'shell' }) // no local flag: forced
  assert.equal(nw.kind, 'local')
  assert.equal(nw.path, realpathSync(plain))
  await assert.rejects(rig.rpc('projectAdd', { path: join(plain, 'missing') }), /not a folder/)

  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.equal(p.git, true)
  assert.deepEqual(await rig.rpc('projectFile', { id: p.id }), { run: 'echo from-file', teardown: 'echo bye' })
  await rig.rpc('projectSet', { id: p.id, name: 'Shop', config: { run: 'echo from-app', setup: '  ' } })
  const saved = (await rig.rpc('state')).projects.find((x: any) => x.id === p.id)
  assert.equal(saved.name, 'Shop')
  assert.deepEqual(saved.config, { run: 'echo from-app' }) // blanks dropped
  // Run ▾'s actions: kept for claude, codex or a shell, unfinished ones too (Settings has them as typed)
  const actions = [
    { name: ' review ', target: 'claude', text: 'review it twice' },
    { name: 'migrate', target: 'shell', text: 'rails db:migrate' },
    { name: '', target: 'shell', text: 'ls' },
    { name: 'x', target: 'vim', text: 'ls' },
    { name: 'y', target: 'codex', text: ' ' },
  ]
  const templates = [{ name: 'fix', text: 'Fix {{prompt}}', extra: 1 }, { name: 'bad' }, { text: 'no name' }]
  const withActions = await rig.rpc('projectSet', { id: p.id, config: { run: 'echo from-app', actions, templates } })
  assert.deepEqual(withActions.config.actions, [actions[0], actions[1], actions[2], actions[4]].map((a, i) => ({ ...a, slug: ['review', 'migrate', 'action', 'y'][i] }))) // each with a slug
  assert.deepEqual(withActions.config.templates, [{ name: 'fix', text: 'Fix {{prompt}}' }])
  // and the run script still comes from the config with them in it
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  const dev = await rig.rpc('run', { ws: ws.id })
  await until(async () => (await rig.screen(dev.id)).includes('from-app'), 'the app config wins over .laki.json')
})

test('worktrees go to Settings’ folder (~: home), a folder per project, or the project’s own (relative: to the repo); made ones stay', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const home = rig.env.HOME
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal(a.path, join(rig.env.LAKI_HOME, 'worktrees', p.id, a.id))
  mkdirSync(join(home, 'mine'), { mode: 0o755 })
  await rig.rpc('settingsSet', { worktrees: '~/mine/trees' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal(b.path, join(home, 'mine', 'trees', p.id, b.id))
  assert.ok(existsSync(join(b.path, '.git')))
  // the folders Laki made are yours alone; the one you had stays as it was
  assert.deepEqual([join(home, 'mine', 'trees'), join(home, 'mine', 'trees', p.id), join(home, 'mine')].map(d => statSync(d).mode & 0o777), [0o700, 0o700, 0o755])
  await rig.rpc('projectSet', { id: p.id, config: { worktrees: '../wt' } })
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal(c.path, join(realpathSync(home), 'wt', c.id)) // the repo's real path
  const ws = (await rig.rpc('state')).workspaces
  assert.deepEqual(ws.map((w: any) => w.path), [a.path, b.path, c.path])
})
