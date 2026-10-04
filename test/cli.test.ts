// The laki CLI against a daemon in a temp home.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { dataDir } from '../src/shared/conn.ts'
import { fresh, running, until } from './helpers.ts'

test('data folder: ~/.laki, or the ~/.laki-electron a Mac already has; LAKI_HOME over both', t => {
  const was = process.env.LAKI_HOME
  t.after(() => (was === undefined ? delete process.env.LAKI_HOME : (process.env.LAKI_HOME = was)))
  delete process.env.LAKI_HOME
  const home = mkdtempSync('/tmp/laki-home-')
  assert.equal(dataDir(home), join(home, '.laki'))
  mkdirSync(join(home, '.laki-electron'))
  assert.equal(dataDir(home), join(home, '.laki-electron'))
  mkdirSync(join(home, '.laki'))
  assert.equal(dataDir(home), join(home, '.laki'))
  process.env.LAKI_HOME = '/x'
  assert.equal(dataDir(home), '/x')
})

test('cli: project add, new, ls, send, screen, rm (--json)', async t => {
  const rig = await fresh(t)
  let r = await rig.cli('project', 'add', rig.repo, '--json')
  assert.equal(r.code, 0, r.err)
  const proj = JSON.parse(r.out)
  r = await rig.cli('new', proj.id, '--preset', 'shell', '--name', 'cli-ws', '--json')
  assert.equal(r.code, 0, r.err)
  const ws = JSON.parse(r.out)
  assert.equal(ws.branch, 'laki/cli-ws')
  r = await rig.cli('ls', '--json')
  const v = JSON.parse(r.out)
  assert.deepEqual(v.workspaces.map((w: any) => w.id), ['cli-ws'])
  r = await rig.cli('ls')
  assert.match(r.out, /cli-ws {2}laki\/cli-ws {2}:3100/)
  r = await rig.cli('send', 'cli-ws/shell', 'echo', 'from-the-cli')
  assert.match(r.out, /sent/)
  await until(async () => (await rig.cli('screen', 'cli-ws/shell')).out.includes('from-the-cli\n'), 'echoed')
  r = await rig.cli('send', 'cli-ws/shell', '--when-idle', 'x')
  assert.equal(r.code, 1)
  assert.match(r.err, /doesn't report when it's done/)
  r = await rig.cli('new', 'nope')
  assert.equal(r.code, 1)
  assert.match(r.err, /no project nope/)
  r = await rig.cli('rm', 'cli-ws')
  assert.equal(r.code, 0, r.err)
  r = await rig.cli('ls', '--json')
  assert.deepEqual(JSON.parse(r.out).workspaces, [])
})

test('cli: hook never fails, even without a daemon', async t => {
  const rig = await fresh(t)
  await rig.stop()
  const started = Date.now()
  rig.env.LAKI_TAB = 'nope'
  const r = await rig.cli('hook', 'idle')
  assert.equal(r.code, 0)
  assert.ok(Date.now() - started < 1500)
})

test('cli: help, usage errors, open', async t => {
  const rig = await fresh(t)
  for (const a of [[], ['help']]) {
    const r = await rig.cli(...a)
    assert.equal(r.code, 0)
    assert.match(r.out, /^laki: coding agents/)
  }
  let r = await rig.cli('frob')
  assert.equal(r.code, 1)
  assert.match(r.err, /unknown command frob/)
  r = await rig.cli('new')
  assert.match(r.err, /usage: laki new <project>/)
  // open: this checkout's build when there is one, else the app by its bundle id (the fake open only records it)
  r = await rig.cli('open')
  assert.equal(r.code, 0, r.err)
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /^open (-b dev\.laki\.app|\S.*\/Laki\.app)$/m)
  rig.env.FAKE_OPEN_MISSING = 'Laki'
  r = await rig.cli('open')
  assert.equal(r.code, 1)
  assert.match(r.err, /Laki\.app not found: build it with `npm run pack`/)
})

// a dev server on two ports
const LISTEN = `exec node -e 'const h = require("http"); h.createServer().listen(0, "127.0.0.1"); h.createServer().listen(0, "127.0.0.1")'`

test('cli: every command, as text', async t => {
  const rig = await fresh(t, { config: { setup: 'true', run: LISTEN } })
  let r = await rig.cli('project', 'add', rig.repo)
  assert.equal(r.out, `added ${rig.repo}\n`)
  const plain = join(rig.home, 'notes')
  mkdirSync(plain)
  await rig.cli('project', 'add', plain)
  r = await rig.cli('project')
  assert.match(r.out, /^repo {2}\S+\/repo\nnotes {2}\S+\/notes\n$/)
  r = await rig.cli('new', 'repo', '--name', 'one', 'first', 'task')
  assert.match(r.out, /^one {2}\S+\/one {2}\(branch laki\/one, PORT 3100\)\n$/)
  const path = r.out.split('  ')[1]
  r = await rig.cli('new', 'notes', '--preset', 'none')
  assert.match(r.out, /^notes {2}\S+\/notes {2}\(folder, PORT 3110\)\n$/)
  await until(async () => (await rig.tab('one')).last === 'answer: first task', 'the prompt answered')
  r = await rig.cli('run', 'one')
  assert.match(r.out, /^started dev \(\w+\)\n$/)
  await until(async () => (await rig.rpc('state')).workspaces[0].ports.length === 2 && (await rig.rpc('state')).workspaces[0].pr, 'ports and PR scanned')
  // the agent asks for a permission; a follow-up waits for its turn to end
  assert.equal((await rig.cli('send', 'one', 'ask', 'me')).out, 'sent\n')
  await until(async () => (await rig.tab('one')).status === 'waiting', 'waiting')
  await rig.cli('send', 'one', '--when-idle', 'later')
  r = await rig.cli('ls')
  assert.match(r.out, /^repo {2}\S+\/repo$/m)
  assert.match(r.out, /^ {2}one {2}laki\/one {2}:3100 {2}PR #42 OPEN {2}listening \d+,\d+$/m)
  assert.match(r.out, /^ {4}✓ {2}setup \(\w+\)$/m) // ended cleanly
  assert.match(r.out, /^ {4}◆● claude \(\w+\) \+1 queued$/m) // waiting, a turn ended unseen, one queued
  assert.match(r.out, /^ {4}○ {2}dev \(\w+\)$/m)
  assert.match(r.out, /^ {2}notes {2}folder {2}:3110$/m)
  // after "--" everything is text, flags too
  r = await rig.cli('tab', 'one', '--cmd', 'cat')
  assert.match(r.out, /^cat \(\w+\)\n$/)
  assert.equal((await rig.cli('send', 'one/cat', '--', '--json', '-m')).out, 'sent\n')
  await until(async () => (await rig.cli('screen', 'one/cat', '--lines', '1')).out === '--json -m\n', 'the text echoed')
  writeFileSync(join(path, 'new.txt'), 'brand new\n')
  r = await rig.cli('diff', 'one')
  assert.match(r.out, /^\+brand new$/m)
  r = await rig.cli('ship', 'one', '--message', 'Ship it')
  assert.match(r.out, /^shipping in tab ship \(\w+\)\n$/)
  assert.equal((await rig.cli('archive', 'one')).out, 'ok\n')
  await until(async () => /^ {2}one {2}laki\/one {2}archived {2}PR #42 OPEN$/m.test((await rig.cli('ls')).out), 'archived, its ports gone')
  assert.equal((await rig.cli('restore', 'one')).out, `one  ${path}\n`)
  r = await rig.cli('fork', 'one')
  assert.match(r.out, /^one-fork {2}\S+\/one-fork\n$/)
  assert.deepEqual(JSON.parse((await rig.cli('rm', 'one-fork', '--json')).out), { ok: true })
  r = await rig.cli('project', 'rm', 'repo')
  assert.equal(r.code, 1)
  assert.match(r.err, /repo has workspaces: delete them first \(one\)/)
  await rig.cli('rm', 'one')
  assert.equal((await rig.cli('project', 'rm', 'repo')).out, 'removed repo\n')
})

test('cli: starts the daemon when none runs; stop ends it', async t => {
  const rig = await fresh(t)
  await rig.stop()
  delete rig.env.LAKI_PORT_SCAN_MS // its own scan intervals
  delete rig.env.LAKI_PR_SCAN_MS
  let r = await rig.cli('ls', '--json')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(JSON.parse(r.out).projects, [])
  const { pid } = rig.info()
  assert.match(readFileSync(join(rig.data, 'daemon.log'), 'utf8'), new RegExp(`laki daemon on 127\\.0\\.0\\.1:\\d+ \\(pid ${pid}`))
  r = await rig.cli('stop')
  assert.equal(r.code, 0)
  await until(() => !running(pid), 'daemon gone')
  assert.ok(!existsSync(join(rig.data, 'daemon.json')))
  r = await rig.cli('stop') // none running: nothing to do
  assert.equal(r.code, 0)
  rig.env.LAKI_TAB = 'x' // a hook with no daemon returns at once
  assert.equal((await rig.cli('hook', 'done', '{"thread-id":"t"}')).code, 0)
})
