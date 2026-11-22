// The laki CLI against a daemon in a temp home: laki mcp, flow check, unknown options, laki wait, doctor and its
// bundle, --version, completion, events, skills audit (split from cli.test.ts)
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { completionWords } from '../src/shared/usage.ts'
import { fresh, until } from './helpers.ts'

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
    { jsonrpc: '2.0', id: 6, method: 'sampling/createMessage' },
  ]
  const r = await rig.cliIn(msgs.map(m => JSON.stringify(m)).join('\n') + '\n', 'mcp', '--all') // every tool listed (laki_more's groups: cli-more)
  assert.equal(r.code, 0, r.err)
  const got = Object.fromEntries(r.out.trim().split('\n').map(l => JSON.parse(l)).map(m => [m.id, m]))
  assert.deepEqual(Object.keys(got).sort(), ['1', '2', '3', '4', '5', '6']) // the notification gets no answer
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
  assert.ok(Array.isArray(got[5].result.resources), 'resources: a list (answered as they come: mcp-ws may not be made yet)')
  assert.equal(got[6].error.code, -32601) // a method it doesn't have
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

// A4: an option the command doesn't have is refused before any daemon call, with the nearest it has; a free-text
// command's options go before its text, and after -- every word is text
test("A4: an unknown option fails with a hint before any daemon call; after -- it's text", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  let r = await rig.cli('new', p.id, '--promt', 'fix it')
  assert.equal(r.code, 1)
  assert.match(r.err, /^laki: unknown option --promt \(did you mean --prompt\?\)/)
  assert.equal((await rig.rpc('state')).workspaces.length, 0, 'nothing made')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = await until(() => rig.tab(ws.id))
  await until(async () => /> $/m.test(await rig.screen(tab.id)), 'claude up')
  r = await rig.cli('send', ws.id, '--when-idel', 'x')
  assert.equal(r.code, 1)
  assert.match(r.err, /unknown option --when-idel \(did you mean --when-idle\?\)\. A text that starts with -- goes after --/)
  assert.doesNotMatch(await rig.screen(tab.id), /when-idel/)
  r = await rig.cli('send', ws.id, '--', '--when-idle', 'is', 'a', 'flag')
  assert.equal(r.code, 0, r.err)
  await until(async () => /answer: --when-idle is a flag/.test(await rig.screen(tab.id)), 'the text sent as it is')
  r = await rig.cli('send', ws.id, 'a', 'word', '--then', 'more') // past its text's start: words
  assert.equal(r.code, 0, r.err)
  await until(async () => /answer: a word --then more/.test(await rig.screen(tab.id)), 'its words')
  assert.match((await rig.cli('ls', '--jsn')).err, /unknown option --jsn \(did you mean --json\?\)/)
})

// A5: laki wait returns as the turn ends (0, a line each), says what one asks (2), and gives up at --timeout (3)
test('A5: laki wait: idle when the turn ends, waiting when it asks, 3 on timeout', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one', prompt: 'hello there' })
  let r = await rig.cli('wait', ws.id, '--timeout', '60s')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, new RegExp(`^${ws.id}/claude  idle: answer: hello there\\n$`))
  const tab = await rig.tab(ws.id)
  await rig.rpc('send', { target: tab.id, text: 'slow work' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'at work')
  const t0 = Date.now()
  r = await rig.cli('wait', ws.id, '--timeout', '4s', '--json')
  assert.equal(r.code, 3, r.err)
  assert.ok(Date.now() - t0 < 15000)
  assert.deepEqual([JSON.parse(r.out).timedOut, JSON.parse(r.out).tabs[0].status], [true, 'running'])
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'stopped')
  await rig.rpc('send', { target: tab.id, text: 'perm bash :: npm test' })
  r = await rig.cli('wait', `${ws.id}/claude`, '--timeout', '60s')
  assert.equal(r.code, 2, r.err)
  assert.match(r.out, /waiting: Bash: npm test/)
  assert.match((await rig.cli('wait', ws.id, '--timeout', 'soon')).err, /a length like 90s/)
})

// R6: laki doctor --bundle: versions, the doctor, counts and the logs' ends, with no home path, token, key, env value,
// remote password or prompt; --out a 0600 file
test('R6: laki doctor --bundle', async t => {
  const rig = await fresh(t)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  await rig.cli('project', 'add', rig.repo)
  const secrets = ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'hunter2pass', 'e'.repeat(64), 'my-env-value', 'the secret plan']
  appendFileSync(join(rig.data, 'daemon.log'), `${new Date().toISOString()} opened ${rig.home}/code/app with ${secrets[0]} and ${secrets[1]}\n${new Date().toISOString()} clone https://me:${secrets[2]}@github.com/x/y.git token ${secrets[3]}\n${new Date().toISOString()} env MY_VAR=${secrets[4]} {"prompt":"${secrets[5]}"}\n`)
  writeFileSync(join(rig.data, 'app.log'), `${new Date().toISOString()} uncaught: Error at ${rig.home}/x.js\n`)
  const r = await rig.cli('doctor', '--bundle')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, new RegExp(`^Laki ${pkg.replace(/\./g, '\\.')}.*, API \\d+$`, 'm'))
  assert.match(r.out, /node \d+\.\d+/)
  assert.match(r.out, /^claude 2\.1\.200$/m, "each agent's version")
  assert.match(r.out, /^1 projects, 0 workspaces/m)
  assert.match(r.out, /^## Doctor\n✓ git$/m)
  assert.match(r.out, /opened ~\/code\/app/, 'the home folder as ~')
  assert.match(r.out, /at ~\/x\.js/, "app.log's too")
  for (const x of [rig.home, realpathSync(rig.home), ...secrets]) assert.ok(!r.out.includes(x), `no ${x} in:\n${r.out}`)
  const out = join(rig.home, 'diag.txt')
  assert.equal((await rig.cli('doctor', '--bundle', '--out', out)).code, 0)
  assert.equal(statSync(out).mode & 0o777, 0o600)
  assert.match(readFileSync(out, 'utf8'), /^## daemon\.log/m)
})

// A9: laki --version needs no daemon; with one, its version and API; laki doctor's lines, exit 1 on a ✗
test('A9: laki --version and laki doctor', async t => {
  const rig = await fresh(t)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  let r = await rig.cli('--version')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, new RegExp(`^laki ${pkg.replace(/\./g, '\\.')} \\(API \\d+\\)\\ndaemon ${pkg.replace(/\./g, '\\.')} \\(API \\d+\\)\\n$`))
  r = await rig.cli('version', '--json')
  assert.deepEqual(Object.keys(JSON.parse(r.out)), ['cli', 'api', 'daemon', 'daemonApi'])
  r = await rig.cli('doctor')
  assert.match(r.out, /^✓ git$/m)
  assert.match(r.out, /claude/)
  assert.ok(r.code === 0 || /^✗/m.test(r.out), r.out)
  for (const l of r.out.split('\n').filter(x => /^[●✗]/.test(x))) assert.ok(r.out.includes(`${l}\n    fix: `), `a fix for ${l}`)
  assert.equal(JSON.parse((await rig.cli('doctor', '--json')).out).git, true)
  await rig.stop()
  r = await rig.cli('--version')
  assert.match(r.out, /\nno daemon running\n$/)
})

test('laki completion: words from USAGE, a script per shell; laki _complete names a running daemon\'s workspaces, never starts one', async t => {
  const w = completionWords()
  assert.ok(w.commands.includes('send') && w.options.send.includes('--when-idle'), 'send and --when-idle')
  assert.ok(w.subs.widget.includes('on') && w.names.send === 'ws' && w.names.new === 'project')
  assert.deepEqual(completionWords('  laki zap <ws> [--hard]   x\n  laki zap undo   y').subs.zap, ['undo'], 'a new command, no edit')
  const rig = await fresh(t)
  const zsh = await rig.cli('completion', 'zsh')
  assert.equal(zsh.code, 0, zsh.err)
  assert.match(zsh.out, /compdef _laki laki/)
  assert.match(zsh.out, /--when-idle/)
  assert.match((await rig.cli('completion', 'bash')).out, /complete -F _laki laki/)
  assert.match((await rig.cli('completion', 'fish')).out, /laki _complete ws/)
  assert.equal((await rig.cli('completion', 'tcsh')).code, 1)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'fix-login' })
  delete rig.env.LAKI_TAB
  delete rig.env.LAKI_TAB_TOKEN
  const got = await rig.cli('_complete', 'ws', 'fix')
  assert.deepEqual([got.code, got.out], [0, 'fix-login\n'])
  assert.match((await rig.cli('_complete', 'profile', 'cl')).out, /^claude$/m)
  rig.env.LAKI_TAB = 'x'
  assert.deepEqual((await rig.cli('_complete', 'ws', 'fix')).out, '', "an agent's tab: nothing")
  delete rig.env.LAKI_TAB
  await rig.stop()
  const none = await rig.cli('_complete', 'ws', 'fix')
  assert.deepEqual([none.code, none.out], [0, ''], 'no daemon: nothing')
  assert.equal(JSON.parse((await rig.cli('version', '--json')).out).daemon, undefined, 'and none started')
})

// laki events: Laki's events as extensions get them, long-polled from the daemon; --type, --once, --timeout (exit 3);
// an agent's tab hears only its own workspace's
test('laki events: a turn done as a JSON line, --once exits after it; --type keeps others out (--timeout: exit 3); an agent hears only its workspace', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'aa' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'bb' })
  const ta = await until(() => rig.tab(a.id), 'its tab')
  const tb = await until(() => rig.tab(b.id), 'its tab')
  const done = async (tab: any, last: string) => {
    await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'go' } })
    await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: last } })
  }
  // --once: the first turn.done, then exit 0 (turns again and again until it has heard one: it starts listening first)
  const once = rig.cli('events', '--json', '--type', 'turn.done', '--once', '--timeout', '30')
  let ended = false
  void once.then(() => (ended = true))
  for (let i = 0; !ended && i < 40; i++) await done(ta, `all done ${i}`), await new Promise(r => setTimeout(r, 300))
  const r = await once
  assert.equal(r.code, 0, r.err)
  const lines = r.out.trim().split('\n')
  assert.equal(lines.length, 1)
  const e = JSON.parse(lines[0])
  assert.equal(e.event, 'turn.done')
  assert.equal(e.ws.id, a.id)
  assert.equal(e.tab.id, ta.id)
  assert.match(e.last, /^all done \d+$/)
  // --type: a turn.done isn't a workspace.archived; none by --timeout: exit 3, nothing printed
  const none = rig.cli('events', '--type', 'workspace.archived', '--timeout', '2')
  await done(ta, 'again')
  const n = await none
  assert.equal(n.code, 3, n.err)
  assert.equal(n.out, '')
  // an agent's tab: its own workspace's only
  const from = { ws: a.id, tab: ta.id }
  const { next } = await rig.rpc('events', { from })
  await done(tb, 'theirs')
  await done(ta, 'mine')
  const got = await rig.rpc('events', { from, after: next, wait: 2, type: 'turn.done' })
  assert.deepEqual(got.events.map((x: any) => x.last), ['mine'])
  const yours = await rig.rpc('events', { after: next, type: ['turn.done'] })
  assert.deepEqual(yours.events.map((x: any) => x.last), ['theirs', 'mine'])
})

test('laki skills audit: every agent\'s skills read only (size, ~tokens), large ones and ones only one agent has; a linked SKILL.md skipped; a project\'s too', async t => {
  const { symlinkSync } = await import('node:fs')
  const rig = await fresh(t)
  const skill = (dir: string, name: string, body: string) => (mkdirSync(join(dir, name), { recursive: true }), writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n${body}`))
  const claude = join(rig.home, '.claude', 'skills')
  const codex = join(rig.home, '.codex', 'skills')
  skill(claude, 'shared', 'hi')
  skill(codex, 'shared', 'hi')
  skill(claude, 'huge', 'x'.repeat(9000))
  mkdirSync(join(claude, 'linked'), { recursive: true })
  writeFileSync(join(rig.home, 'secret.md'), 'fake-secret')
  symlinkSync(join(rig.home, 'secret.md'), join(claude, 'linked', 'SKILL.md'))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  skill(join(rig.repo, '.codex', 'skills'), 'repo-only', 'hello')
  const r = await rig.cli('skills', 'audit', '--project', p.id, '--json')
  assert.equal(r.code, 0, r.err)
  const list = JSON.parse(r.out)
  const by = (agent: string, name: string) => list.find((s: any) => s.agent === agent && s.name === name)
  assert.ok(by('claude', 'shared') && by('codex', 'shared'))
  assert.deepEqual(by('claude', 'huge').notes, ['large', 'only Claude Code'])
  assert.equal(by('claude', 'huge').approxTokens, Math.ceil(by('claude', 'huge').bytes / 4))
  assert.ok(by('claude', 'huge').frontmatterBytes > 0)
  assert.deepEqual(by('claude', 'shared').notes, [])
  assert.equal(by('codex', 'repo-only').scope, 'project')
  assert.ok(!list.some((s: any) => s.name === 'linked'), 'a link: skipped')
  assert.ok(!r.out.includes('fake-secret'))
  const text = await rig.cli('skills', 'audit')
  assert.match(text.out, /claude\s+huge\s+[\d.]+ KB\s+~\s*\d+ tokens .*\(large, only Claude Code\)/)
  assert.equal((await rig.cli('skills')).code, 1, 'skills alone: its usage')
})
