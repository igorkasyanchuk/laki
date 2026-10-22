// The laki CLI against a daemon in a temp home.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { dataDir } from '../src/shared/conn.ts'
import { fresh, running, until } from './helpers.ts'

// a dev server on two ports
const LISTEN = `exec node -e 'const h = require("http"); h.createServer().listen(0, "127.0.0.1"); h.createServer().listen(0, "127.0.0.1")'`

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
  r = await rig.cli('new', proj.id, '--preset', 'shell', '--name', 'cli-ws', '--no-setup', '--json')
  assert.equal(r.code, 0, r.err)
  const ws = JSON.parse(r.out)
  assert.equal(ws.branch, 'laki/cli-ws')
  assert.equal(ws.noSetup, true)
  // agents read it: no settings, env or project config in it
  await rig.rpc('settingsSet', { env: { SECRET: 'from-settings' }, webhook: { url: 'https://hook.example/bot-token' } })
  await rig.rpc('projectSet', { id: proj.id, config: { env: { SECRET: 'from-project' } } })
  r = await rig.cli('ls', '--json')
  assert.doesNotMatch(r.out, /from-settings|from-project|bot-token/)
  const v = JSON.parse(r.out)
  assert.deepEqual(v.workspaces.map((w: any) => w.id), ['cli-ws'])
  assert.doesNotMatch((await rig.cli('project', '--json')).out + (await rig.cli('project', 'add', rig.repo, '--json')).out, /from-project/)
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

test('cli: laki progress, an agent\'s estimate on its tab until its turn ends; LAKI_PROGRESS with the setting', async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { progress: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'slow work' })
  const tab = await until(async () => (await rig.rpc('state')).tabs.find((t: any) => t.workspace === ws.id && t.status === 'running'), 'claude at work')
  const started = await until(() => existsSync(rig.env.FAKE_LOG) && rig.fakeLog().find((l: any) => l.bin === 'claude'), 'claude started')
  assert.equal(started.env.LAKI_PROGRESS, '1')
  // told at start (the skill loads only for Laki's tasks), and allowed to report without asking
  const note = started.args[started.args.indexOf('--append-system-prompt') + 1]
  assert.match(note, /' progress <0-100>/)
  const allow = JSON.parse(readFileSync(started.args[started.args.indexOf('--settings') + 1], 'utf8')).permissions.allow[0]
  assert.ok(note.includes(allow.slice(5, -3)), allow)
  await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  const codex = await until(() => rig.fakeLog().find((l: any) => l.bin === 'codex'), 'codex started')
  assert.ok(codex.args.includes(`developer_instructions=${JSON.stringify(note)}`), 'codex is told the same')
  let r = await rig.cli('progress', '40', 'reading', 'the', 'code', '--tab', tab.id)
  assert.equal(r.out, '40%\n', r.err)
  const cur = async () => (await rig.rpc('state')).tabs.find((t: any) => t.id === tab.id).progress
  assert.deepEqual(await cur(), { pct: 40, note: 'reading the code' })
  assert.equal((await rig.cli('progress', '140%', '--tab', tab.id)).out, '100%\n', 'what the tab shows')
  assert.deepEqual(await cur(), { pct: 100 })
  r = await rig.cli('progress', 'lots', '--tab', tab.id)
  assert.match(r.err, /a percentage/)
  assert.match((await rig.cli('progress', '5')).err, /which tab/)
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.rpc('state')).tabs.find((t: any) => t.id === tab.id).status === 'idle', 'interrupted')
  assert.equal(await cur(), undefined, 'gone with the turn')
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
  for (const a of [[], ['help'], ['--help'], ['-h']]) {
    const r = await rig.cli(...a)
    assert.equal(r.code, 0)
    assert.match(r.out, /^laki: coding agents/)
  }
  // one command's lines and its details: help <command>, <command> --help, <command> <sub> -h; no daemon for any
  for (const a of [['help', 'new'], ['new', '--help']]) {
    const r = await rig.cli(...a)
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /^  laki new <project\|\.>[\s\S]*--fan claude,codex[\s\S]*laki new \. --prompt/)
    assert.doesNotMatch(r.out, /laki ai /) // not a command where new is an alternative
  }
  let h = await rig.cli('widget', 'new', '-h')
  assert.match(h.out, /^  laki widget new <name>/)
  assert.doesNotMatch(h.out, /laki widget dev/)
  h = await rig.cli('help', 'archive') // an alternative on another command's line
  assert.match(h.out, /^  laki rm <ws> \| archive <ws>/)
  h = await rig.cli('help', 'stop')
  assert.equal(h.out.trim().split('\n').length, 1, 'not the lines whose words say "stop it"')
  h = await rig.cli('send', 'nope', '--', '--help') // after --: text to send, not a help request
  assert.match(h.err, /no workspace nope/)
  assert.doesNotMatch(h.out, /laki send /)
  h = await rig.cli('help', 'constructor') // not an inherited key
  assert.equal(h.code, 1)
  h = await rig.cli('help', 'nope')
  assert.equal(h.code, 1)
  assert.match(h.err, /no command nope/)
  const was = rig.env.LAKI_HOME
  rig.env.LAKI_HOME = join(rig.home, 'none') // a data dir with no daemon: help doesn't start one
  h = await rig.cli('send', '--help')
  rig.env.LAKI_HOME = was
  assert.match(h.out, /^  laki send /)
  assert.ok(!existsSync(join(rig.home, 'none/daemon.json')), 'help starts no daemon')
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

test('cli: every command, as text', async t => {
  const rig = await fresh(t, { config: { setup: 'true', run: LISTEN } })
  let r = await rig.cli('project', 'add', rig.repo)
  assert.equal(r.out, `added ${rig.repo}\n`)
  await rig.trust('repo')
  const plain = join(rig.home, 'notes')
  mkdirSync(plain)
  await rig.cli('project', 'add', plain)
  r = await rig.cli('project')
  assert.match(r.out, /^repo {2}\S+\/repo\nnotes {2}\S+\/notes\n$/)
  r = await rig.cli('new', 'repo', '--name', 'one', '--model', 'opus', '--effort', 'high', 'first', 'task')
  assert.match(r.out, /^one {2}\S+\/one {2}\(branch laki\/one, PORT 3100\)\n$/)
  assert.deepEqual([(await rig.tab('one')).model, (await rig.tab('one')).effort], ['opus', 'high'])
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

test('cli: schedule add, ls, run, log, off, rm; the defaults a new one takes', async t => {
  const rig = await fresh(t)
  const proj = JSON.parse((await rig.cli('project', 'add', rig.repo, '--json')).out)
  let r = await rig.cli('schedule')
  assert.equal(r.out.trim(), 'no scheduled tasks')
  r = await rig.cli('schedule', 'add', proj.id, '--when', 'weekdays at 9am', '--json', 'check', 'the', 'build')
  assert.equal(r.code, 0, r.err)
  const s = JSON.parse(r.out)
  assert.deepEqual([s.prompt, s.preset, s.ws, s.on], ['check the build', 'claude', 'new', true])
  r = await rig.cli('schedule', 'add', proj.id, 'no', 'when')
  assert.match(r.err, /when\? laki schedule add <project> --when/)
  r = await rig.cli('schedule', 'add', proj.id, '--when', 'whenever', 'x')
  assert.deepEqual([r.code, r.err.trim()], [1, 'laki: At what time? (every day at 9am)'])
  r = await rig.cli('schedule', 'add', proj.id, '--when', 'daily at 8pm', '--where', 'folder', '--preset', 'codex', '--name', 'Notes {{DD-MM}}', 'tidy')
  assert.match(r.out, / on {3}Every day at 20:00, next .+ · codex · folder {2}Notes \{\{DD-MM\}\}$/m)
  r = await rig.cli('schedule', 'add', proj.id, '--when', 'daily at 9pm', '--where', 'folder-new', 'sum', 'up')
  assert.match(r.out, / · claude · folder-new {2}sum up$/m)
  r = await rig.cli('schedule', 'ls')
  assert.match(r.out, new RegExp(`^${s.id} {2}on {3}Weekdays at 09:00, next .+ {2}${proj.id} · claude · new {2}check the build$`, 'm'))
  r = await rig.cli('schedule', 'run', s.id)
  assert.match(r.out, /^✓ started in a new workspace, /)
  r = await rig.cli('schedule', 'log')
  assert.match(r.out, /✓ {2}check the build {2}started in a new workspace/)
  assert.equal((await rig.cli('schedule', 'off', s.id)).out.trim(), `${s.id} off`)
  assert.equal(JSON.parse((await rig.cli('schedule', '--json')).out).find((x: any) => x.id === s.id).on, false)
  assert.equal((await rig.cli('schedule', 'rm', s.id)).out.trim(), `removed ${s.id}`)
  r = await rig.cli('schedule', 'nope')
  assert.match(r.err, /usage: laki schedule/)
})

test('cli: new --fan, --issue, browser', async t => {
  const rig = await fresh(t)
  const proj = JSON.parse((await rig.cli('project', 'add', rig.repo, '--json')).out)
  let r = await rig.cli('new', proj.id, '--fan', 'claude,codex', '--name', 'race', 'make', 'it', 'fast')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^race-claude .*\nrace-codex /)
  mkdirSync(join(rig.home, 'gh'), { recursive: true })
  writeFileSync(join(rig.home, 'gh', 'issue.json'), JSON.stringify({ number: 12, title: 'Dark mode', url: 'https://github.com/o/r/issues/12' }))
  r = await rig.cli('new', proj.id, '--issue', '12', '--preset', 'shell')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^issue-12-dark-mode /)
  r = await rig.cli('browser', 'race-claude', 'text')
  assert.equal(r.code, 1)
  assert.match(r.err, /needs Laki's window/)
  rig.env.LAKI_WORKSPACE = 'race-codex' // in a tab: its workspace
  r = await rig.cli('browser', 'open', 'https://example.com')
  assert.match(r.err, /localhost only/)
  r = await rig.cli('browser', 'race-codex', 'nope')
  assert.match(r.err, /usage: laki browser/)
})

test('laki mcp: initialize, tools, a call, errors', async t => {
  const rig = await fresh(t)
  const proj = JSON.parse((await rig.cli('project', 'add', rig.repo, '--json')).out)
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'laki_new_workspace', arguments: { project: proj.id, prompt: 'hi', preset: 'shell', name: 'mcp-ws', no_setup: true } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'laki_screen', arguments: { target: 'nope' } } },
    { jsonrpc: '2.0', id: 5, method: 'resources/list' },
  ]
  const r = await rig.cliIn(msgs.map(m => JSON.stringify(m)).join('\n') + '\n', 'mcp')
  assert.equal(r.code, 0, r.err)
  const got = Object.fromEntries(r.out.trim().split('\n').map(l => JSON.parse(l)).map(m => [m.id, m]))
  assert.deepEqual(Object.keys(got).sort(), ['1', '2', '3', '4', '5']) // the notification gets no answer
  assert.equal(got[1].result.protocolVersion, '2025-03-26')
  assert.equal(got[1].result.serverInfo.name, 'laki')
  const names = got[2].result.tools.map((t: any) => t.name)
  assert.ok(names.includes('laki_state') && names.includes('laki_send') && names.includes('laki_browser') && names.includes('laki_progress'))
  assert.ok(!names.some((n: string) => /rm|archive|ship/.test(n)))
  assert.ok(names.includes('laki_extension_write') && got[2].result.tools.every((t: any) => !('max' in t)), 'extension tools; max is Laki AI’s, not listed')
  assert.ok(!got[3].result.isError, got[3].result.content[0].text)
  assert.equal(JSON.parse(got[3].result.content[0].text).id, 'mcp-ws')
  assert.equal(JSON.parse(got[3].result.content[0].text).noSetup, true)
  assert.equal(got[4].result.isError, true)
  assert.equal(got[5].error.code, -32601)
  const v = JSON.parse((await rig.cli('ls', '--json')).out)
  assert.ok(v.workspaces.some((w: any) => w.id === 'mcp-ws'))
})

test('cli: flow check reads workflow files with no daemon: ✓ a good one, ✗ a bad one with its problems and exit 1, a folder each *.md, --json', async t => {
  const rig = await fresh(t)
  await rig.stop()
  rmSync(join(rig.data, 'daemon.json'), { force: true })
  const dir = join(rig.repo, '.laki', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'good.md'), '# Good\n\n## start\nnext: ask\n\n## ask\nagent: claude\n> Say hi\nnext: end\n\n## end\nend: success\n')
  writeFileSync(join(dir, 'bad.md'), '# Bad\n\n## start\nnext: nowhere\n\n## ask\nagent: claude\nperm: yolo\n> Say hi\nnext: start\n')
  writeFileSync(join(dir, 'notes.txt'), 'not a workflow')
  writeFileSync(join(dir, 'kindless.md'), '# Kindless\n\n## start\nnext: x\n\n## x\n> hi\n') // a block with no kind: named, not a crash
  const good = await rig.cli('flow', 'check', join(dir, 'good.md'))
  assert.equal(good.code, 0, good.err)
  assert.equal(good.out.trim(), `✓ Good  ${join(dir, 'good.md')}`)
  const bad = await rig.cli('flow', 'check', join(dir, 'bad.md'))
  assert.equal(bad.code, 1)
  assert.match(bad.out, /^✗ Bad /m)
  assert.match(bad.out, /^ {2}Start: next goes to nowhere, which isn't a block$/m)
  assert.match(bad.out, /^ {2}ask: permission mode yolo\? auto, acceptEdits, plan, bypassPermissions$/m)
  const all = await rig.cli('flow', 'check', dir, '--json')
  assert.equal(all.code, 1)
  assert.deepEqual(JSON.parse(all.out).map((x: any) => [x.name, x.problems.length > 0]), [['Bad', true], ['Good', false], ['Kindless', true]])
  assert.match(all.out, /x: what kind of block\?/)
  assert.match((await rig.cli('flow', 'check', join(dir, 'gone.md'))).err, /no .*gone\.md/)
  assert.equal(existsSync(join(rig.data, 'daemon.json')), false, 'no daemon started')
})
