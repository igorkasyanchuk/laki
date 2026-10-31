// core.ts beyond the happy paths: state that won't load, SSH hosts that fail, answers, interrupts, races, issues,
// copied ignored files, forks, progress and dev mode's logs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fresh, type Rig, sleep, until } from './helpers.ts'

const FAKE_SSH = fileURLToPath(new URL('./fakes/ssh', import.meta.url))
const b64 = (s: string) => Buffer.from(s).toString('base64')

// an ssh in $HOME/bin (first on PATH) over the fake one: some hosts fail as real ones do
function sshOver(rig: Rig) {
  const script = `#!/bin/bash
a=" $* "
ctl= p=; for x in "$@"; do [ "$p" = -S ] && ctl=$x; p=$x; done
case "$a" in
  *" keyhost "*) printf '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\\nHost key verification failed.\\n' >&2; exit 255 ;;
  *" denyhost "*) printf 'Warning: Permanently added denyhost\\nme@denyhost: Permission denied (publickey).\\n' >&2; exit 255 ;;
  *" mutehost "*) exit 255 ;;
  *" nohome "*'printf %s "$HOME"'*) printf nope; exit 0 ;;
  *" quiet "*"rev-parse --show-toplevel"*) exit 3 ;;
  *" weird "*"rev-parse --show-toplevel"*) printf '\\nrelative\\n'; exit 0 ;;
  *" nologin "*__LAKI__*) exit 1 ;;
  *" nocfg "*"cat .laki.json"*) exit 255 ;;
  *" -O check slowhost "*) [ -e "$ctl.once" ] || { : > "$ctl.once"; exit 255; } ;;
  *" dying sh -s "*) kill "$(cat "$ctl")"; sleep 0.5; cat >/dev/null; exit 0 ;;
esac
exec ${FAKE_SSH} "$@"
`
  writeFileSync(join(rig.home, 'bin/ssh'), script, { mode: 0o755 })
}

test('state.json and its backup unreadable: an empty start, the file kept; no gh on PATH says so; a backup that fails', async t => {
  const rig = await fresh(t)
  await rig.stop()
  writeFileSync(join(rig.data, 'state.json'), '[]') // JSON, but not an object
  writeFileSync(join(rig.data, 'state.json.bak'), '{nope')
  // no PATH at all (no gh, no gemini…); the app's start, whose login shell fails
  delete rig.env.PATH
  rig.env.LAKI_FROM_APP = '1'
  rig.env.SHELL = join(rig.home, 'no-such-shell')
  await rig.start()
  const v = await rig.rpc('state')
  assert.deepEqual([v.projects, v.workspaces, v.tabs], [[], [], []])
  const broken = readdirSync(rig.data).find(f => f.startsWith('state.json.broken-'))
  assert.equal(readFileSync(join(rig.data, broken!), 'utf8'), '[]')
  assert.deepEqual(v.presets.map((x: any) => x.name), ['claude', 'codex']) // the others aren't on PATH
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', pr: '5' }), /gh isn't installed: (brew|sudo apt) install gh, then gh auth login/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', issue: '7' }), /gh issue view 7: spawn gh ENOENT/)
  assert.deepEqual((await rig.rpc('state')).workspaces, [])
  // a good state.json whose backup can't be written (a folder there): it loads all the same
  await rig.stop()
  rmSync(join(rig.data, 'state.json.bak'))
  mkdirSync(join(rig.data, 'state.json.bak'))
  await rig.start()
  assert.deepEqual((await rig.rpc('state')).projects.map((x: any) => x.id), [p.id])
})

test('SSH hosts that fail say why: a host key, a password, nothing, no home, no folder, a dropped connection', async t => {
  const rig = await fresh(t)
  sshOver(rig)
  const add = (path: string) => rig.rpc('projectAdd', { path })
  await assert.rejects(add('keyhost:/srv'), /^Error: ssh keyhost: its host key isn't known \(or changed\): ssh keyhost once in a terminal$/)
  await assert.rejects(add('denyhost:/srv'), /ssh denyhost: me@denyhost: Permission denied \(publickey\)\. Laki signs in with your SSH keys or agent, never a password/)
  await assert.rejects(add('mutehost:/srv'), /ssh mutehost: can't connect/)
  await assert.rejects(add('nohome:/srv'), /ssh nohome: no home folder there/)
  await assert.rejects(add('quiet:/srv'), /quiet:\/srv: Command failed: ssh /) // no word from it: the command that failed
  await assert.rejects(add('weird:/srv'), /weird:\/srv is not a folder/)
  await assert.rejects(add('dying:/srv'), /ssh dying: disconnected/) // the connection went while it was set up
  assert.deepEqual((await rig.rpc('state')).projects, [])
  // one whose connection isn't up at the first check: asked again
  assert.equal((await add(`slowhost:${rig.repo}`)).id, 'repo-slowhost')
})

test('SSH hosts: a path from home, a plain folder, .laki.json there, 8 at a time, open in, a shell and its hooks, teardown, archive, removal', async t => {
  const rig = await fresh(t, { config: { run: 'echo hi' } })
  sshOver(rig)
  // the fake host's home is this rig's: repo is in it
  const p = await rig.rpc('projectAdd', { path: 'devbox:repo' })
  assert.deepEqual([p.id, p.path, p.git], ['repo-devbox', realpathSync(rig.repo), true])
  assert.equal((await rig.rpc('projectAdd', { path: 'devbox:~/repo' })).id, p.id)
  assert.deepEqual(await rig.rpc('projectFile', { id: p.id }), { run: 'echo hi' }) // read there
  const here = await rig.rpc('projectAdd', { path: rig.repo })
  assert.notEqual(here.id, p.id)
  assert.deepEqual(await rig.rpc('projectFile', { id: here.id }), { run: 'echo hi' }) // and here
  // a folder that isn't a repository, whose .laki.json isn't JSON
  mkdirSync(join(rig.home, 'plain'))
  writeFileSync(join(rig.home, 'plain/.laki.json'), '{not json')
  const plain = await rig.rpc('projectAdd', { path: `devbox:${rig.home}/plain` })
  assert.deepEqual([plain.git, plain.path], [false, realpathSync(join(rig.home, 'plain'))])
  assert.deepEqual(await rig.rpc('projectFile', { id: plain.id }), {})
  // a host where reading it fails: nothing read, though the file is there
  const nc = await rig.rpc('projectAdd', { path: `nocfg:${rig.repo}` })
  assert.deepEqual(await rig.rpc('projectFile', { id: nc.id }), {})
  // a host whose login shell says no PATH: the default one, without gh
  const nl = await rig.rpc('projectAdd', { path: `nologin:${rig.repo}` })
  await assert.rejects(rig.rpc('wsNew', { project: nl.id, preset: 'none', pr: '5' }), /gh isn't installed on the SSH host: install it there, then gh auth login/)

  // more commands at once than the connection's 8: the rest wait their turn, none fail
  const all = await Promise.all(Array.from({ length: 12 }, () => rig.rpc('branches', { project: p.id })))
  assert.ok(all.every(b => b.current === 'main' && b.branches.join() === 'main'), JSON.stringify(all))

  // open in: the editors with Remote - SSH only
  await assert.rejects(rig.rpc('openIn', { project: p.id, app: 'zed' }), /Zed can't open a folder on devbox: Cursor, VS Code or Windsurf can \(Remote - SSH\)/)
  await assert.rejects(rig.rpc('openIn', { project: p.id, app: 'frob' }), /That app can't open a folder on devbox/)
  // the fake open has no such file: what it was given says where it went
  await assert.rejects(rig.rpc('openIn', { project: p.id, app: 'cursor' }), /The file cursor:\/\/vscode-remote\/ssh-remote\+devbox\/.*\/repo does not exist/)

  // a shell there; dev mode logs what it runs, and where
  await rig.rpc('settingsSet', { devMode: true })
  await rig.rpc('projectSet', { id: p.id, config: { teardown: 'touch "$LAKI_PROJECT_PATH/torn-down"' } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'there' })
  assert.ok((await rig.rpc('logs', { key: `ws:${ws.id}` })).some((l: any) => l.text.startsWith('shell: /bin/sh -c ') && l.text.endsWith(`(in devbox:${ws.path})`)))
  const sh = await rig.tab(ws.id, 'shell')
  await until(async () => (await rig.screen(sh.id)).includes('$'), 'a prompt there')
  // hooks as escape codes: its own key only, a state needed, a payload that isn't JSON is none
  const c = await rig.connect()
  const osc = (rest: string, arg = '"$LAKI_HOOK"') => rig.rpc('input', { tab: sh.id, data: `printf '\\033]7717;${rest}\\007' ${arg}\r` })
  await osc('%s;waiting')
  await osc(`%s;waiting;${b64('not json')}`)
  await osc(`wrongkey;waiting;${b64('{"message":"wrong"}')}`, '')
  await osc('%s')
  await osc(`%s;waiting;${b64('{"message":"right"}')}`)
  const waits = () => c.events.filter(e => e.ev === 'turn' && e.tab === sh.id && e.kind === 'waiting').map(e => e.text)
  await until(() => waits().includes('right'), 'the last hook')
  assert.deepEqual(waits(), ['', '', 'right'])
  c.close()
  // a shell there that ends with 255 (a lost connection) stays; Enter starts it again
  await rig.rpc('input', { tab: sh.id, data: 'exit 255\r' })
  await until(async () => (await rig.tab(ws.id, 'shell'))?.status === 'exited', 'ended, its tab kept')
  await rig.rpc('input', { tab: sh.id, data: '\r' })
  await until(async () => (await rig.tab(ws.id, 'shell')).status !== 'exited' && (await rig.screen(sh.id)).includes('$'), 'a shell again')

  // archive: the teardown runs there; restore reads its .laki.json again
  await rig.rpc('wsArchive', { id: ws.id })
  assert.ok(!existsSync(ws.path))
  assert.ok(existsSync(join(rig.repo, 'torn-down')))
  await rig.rpc('wsRestore', { id: ws.id })
  assert.ok(existsSync(ws.path))
  await rig.rpc('wsRm', { id: ws.id })

  // the host's connection goes with its last project
  const ctl = join(rig.data, 'ssh', createHash('sha1').update('devbox').digest('hex').slice(0, 16))
  assert.ok(existsSync(ctl))
  await rig.rpc('projectRm', { id: plain.id })
  await sleep(300)
  assert.ok(existsSync(ctl), 'another project is on it')
  await rig.rpc('projectRm', { id: p.id })
  await until(() => !existsSync(ctl), 'the connection closed')
})

test('answer: not running, no menu, no such choice, the last one; a TUI in application cursor mode gets ESC O', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'ask first', local: true })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.status === 'waiting' && x
  }, 'waiting')
  await sleep(300) // the fake reads keys (raw mode) once its first turn's hooks are done
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 1 }), /claude isn't asking anything with choices now/)
  // a menu now; keys move its ❯, and the screen is read again
  await rig.rpc('input', { tab: tab.id, data: 'menu\r' })
  assert.equal((await until(async () => (await rig.tab(ws.id))?.ask, 'the menu')).at, 1)
  await assert.rejects(rig.rpc('answer', { tab: tab.id, n: 9 }), /claude has no choice 9/)
  await rig.rpc('input', { tab: tab.id, data: '\x1b[B' })
  await until(async () => (await rig.tab(ws.id))?.ask?.at === 2, 'the ❯ moved')
  await sleep(400) // its ask read again off the screen
  assert.deepEqual(await rig.rpc('answer', { tab: tab.id, pick: 'last' }), { picked: 'No, and tell Claude what to do differently (esc)' })
  await until(async () => (await rig.screen(tab.id)).includes('picked: No, and tell Claude'), 'the last one picked')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'its turn over')
  await rig.rpc('input', { tab: tab.id, data: '\x03' })
  await until(async () => (await rig.tab(ws.id)).status === 'exited', 'ended')
  await assert.rejects(rig.rpc('answer', { tab: tab.id }), /claude isn't running/)

  // a program that asked for application cursor keys (DECCKM): ↑ is ESC O A
  const cmd = `printf '\\033[?1hPick one\\r\\n  1. Alpha\\r\\n> 2. Beta\\r\\n'; exec cat -v`
  const cu = await rig.rpc('tabNew', { ws: ws.id, cmd })
  await until(async () => (await rig.screen(cu.id)).includes('2. Beta'), 'its menu')
  await rig.rpc('hook', { tab: cu.id, state: 'waiting' })
  assert.deepEqual(await rig.rpc('answer', { tab: cu.id }), { picked: 'Alpha' }) // the first, by default
  await until(async () => (await rig.screen(cu.id)).includes('^[OA'), 'ESC O A, then Enter')
})

test('interrupts: a turn again or its end first, a waiting agent; dev mode logs turns; a queue through Enter on an ended agent; asleep', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { devMode: true })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'slow one', local: true })
  const working = (name: string) =>
    until(async () => {
      const x = await rig.tab(ws.id, name)
      return x?.status === 'running' && (await rig.screen(x.id)).includes('esc to interrupt') && x
    }, `${name} at work`).then(async x => (await sleep(200), x)) // its keys read (raw mode)
  const tab = await working('claude')
  const status = async (id: string) => (await rig.rpc('state')).tabs.find((x: any) => x.id === id)?.status
  // Esc, then a turn starts again before the screen is read: that Esc is forgotten
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  await sleep(1300)
  assert.equal(await status(tab.id), 'running')
  await rig.rpc('hook', { tab: tab.id, state: 'idle' })

  // Esc, and its hook ends the turn first (done, with a message queued): it goes, the log says so
  await rig.rpc('send', { target: tab.id, text: 'slow two' })
  await until(async () => (await rig.screen(tab.id)).split('esc to interrupt').length === 3, 'at work again')
  assert.deepEqual(await rig.rpc('send', { target: tab.id, text: 'queued one', whenIdle: true }), { tab: tab.id, queued: 1 })
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await rig.rpc('hook', { tab: tab.id, state: 'done' })
  await until(async () => (await rig.tab(ws.id, 'claude')).last === 'answer: queued one', 'the queued one delivered')
  const log = (await rig.rpc('logs', { key: `ws:${ws.id}` })).map((l: any) => l.text)
  assert.ok(log.includes('claude: running → idle (done), 1 queued'), log.join('\n'))
  assert.ok(log.includes('claude: running → idle'), log.join('\n')) // the Stop hook's: idle, as it says

  // asleep: no typing into its prompt
  await until(async () => (await rig.tab(ws.id, 'claude')).status === 'idle', 'idle')
  assert.equal(await rig.rpc('tabSleep', { tab: tab.id }), true)
  await assert.rejects(rig.rpc('send', { target: tab.id, text: 'x', enter: false }), /claude is asleep: look at it to wake it, then send again/)

  // Esc while it asks: no "Interrupted" on its screen, so it still asks
  const asker = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'ask me' })
  await until(async () => (await status(asker.id)) === 'waiting', 'it asks')
  await rig.rpc('input', { tab: asker.id, data: '\x1b' })
  await sleep(1200)
  assert.equal(await status(asker.id), 'waiting')

  // a queue on an agent that ended: Enter starts it again, running until what waits goes in
  const third = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'slow three' })
  await working(third.name)
  assert.equal((await rig.rpc('send', { target: third.id, text: 'after', whenIdle: true })).queued, 1)
  // a plain Esc: idle once its screen says Interrupted
  await rig.rpc('input', { tab: third.id, data: '\x1b' })
  await until(async () => (await status(third.id)) === 'idle', 'interrupted')
  await rig.rpc('input', { tab: third.id, data: '\x03' })
  await until(async () => (await status(third.id)) === 'exited', 'it ended')
  await rig.rpc('input', { tab: third.id, data: '\r' })
  const back = (await rig.rpc('state')).tabs.find((x: any) => x.id === third.id)
  assert.deepEqual([back.status, back.queue], ['running', ['after']])
})

test('new workspaces: race checks, a race with no name, a PR on Local, a bad base, issues, placed first, the creation log', async t => {
  const rig = await fresh(t)
  mkdirSync(rig.env.FAKE_GH, { recursive: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', {
    devMode: true,
    presets: [{ name: 'a', agent: 'command', cmd: 'exec cat' }, { name: 'b', agent: 'command', cmd: 'exec cat' }, { name: 'claude', agent: 'claude' }, { name: 'codex', agent: 'codex' }],
  })
  const fan = (o: object) => rig.rpc('wsFan', { project: p.id, ...o })
  await assert.rejects(fan({ presets: 'claude' }), /a race needs two agents or more/)
  await assert.rejects(fan({ presets: ['claude', 'codex', 'gemini', 'grok', 'opencode', 'a', 'b'] }), /six agents at most/)
  await assert.rejects(fan({ presets: ['claude', 'shell'] }), /shell isn't an agent/)
  await assert.rejects(fan({ presets: ['gemini', 'claude'], model: '--evil' }), /model --evil\? a name like opus, or provider\/model/)
  // commands take no model; no name and no prompt: race-<preset>
  const race = await fan({ presets: ['a', 'b'] })
  assert.deepEqual(race.map((w: any) => w.id), ['race-a', 'race-b'])
  assert.equal(race[0].race, race[1].race)

  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', local: true, pr: '12' }), /a PR needs a worktree: a git project, not Local/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', pr: '99' }), /^Error: PR 99 not found$/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', base: 'nope', name: 'bad base' }), /base nope not found in /)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', issue: '9' }), /gh issue view 9: GraphQL: Could not resolve to an issue/)
  // an issue's long body is cut; the prompt given follows it
  writeFileSync(join(rig.env.FAKE_GH, 'issue.json'), JSON.stringify({ number: 12, title: 'Big one!', url: 'https://github.com/o/r/issues/12', body: 'x'.repeat(9000) }))
  const iw = await rig.rpc('wsNew', { project: p.id, preset: 'claude', issue: '12', prompt: 'be quick' })
  assert.deepEqual([iw.id, iw.issue], ['issue-12-big-one', { number: 12, url: 'https://github.com/o/r/issues/12', title: 'Big one!' }])
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'claude' && l.args.some((a: string) => a.startsWith('Work on GitHub issue #12'))), 'claude started')
  const prompt = run.args.find((a: string) => a.startsWith('Work on GitHub issue #12'))
  assert.equal(prompt, `Work on GitHub issue #12: Big one!\n\nhttps://github.com/o/r/issues/12\n\n${'x'.repeat(8000)}\n… (cut: the rest is on GitHub)\n\nbe quick`)

  // a short one with no body and no prompt: its title and link
  writeFileSync(join(rig.env.FAKE_GH, 'issue.json'), JSON.stringify({ number: 13, title: 'Small', url: 'https://github.com/o/r/issues/13' }))
  const small = await rig.rpc('wsNew', { project: p.id, preset: 'claude', issue: '13' })
  assert.equal(small.id, 'issue-13-small')
  await until(() => rig.fakeLog().some(l => l.bin === 'claude' && l.args.at(-1) === 'Work on GitHub issue #13: Small\n\nhttps://github.com/o/r/issues/13'), 'its prompt')

  // dev mode's creation log: a long prompt cut, a failure's message
  await rig.rpc('wsNew', { project: p.id, preset: 'none', prompt: 'long '.repeat(60) })
  const made = (await rig.rpc('logs', { key: 'new' })).map((l: any) => l.text)
  assert.ok(made.some((l: string) => l.includes(`"prompt":"${'long '.repeat(40)}…"`)), made.join('\n'))
  assert.ok(made.some((l: string) => /^repo: failed: base nope not found in repo/.test(l)), made.join('\n'))

  // placed first in a project with no workspaces yet: last in the list, as it's its only one
  mkdirSync(join(rig.home, 'other'))
  const p2 = await rig.rpc('projectAdd', { path: join(rig.home, 'other') })
  const lw = await rig.rpc('wsNew', { project: p2.id, preset: 'none', place: 'top' })
  assert.equal((await rig.rpc('state')).workspaces.at(-1).id, lw.id)
  // and in one that has some: before them
  const top = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'on top', place: 'top' })
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.project === p.id).id, top.id)
  // projects reordered by a part of the list: the rest keep their order after it
  mkdirSync(join(rig.home, '!!!'))
  const odd = await rig.rpc('projectAdd', { path: join(rig.home, '!!!') })
  assert.equal(odd.id, 'project') // a name with nothing to slug
  await rig.rpc('reorder', { projects: [p2.id] })
  assert.deepEqual((await rig.rpc('state')).projects.map((x: any) => x.id), [p2.id, p.id, 'project'])
})

test('copying ignored files: one the branch has stays, nothing through a link out of the worktree, a dangling link, a bad include file', async t => {
  const rig = await fresh(t)
  const g = (...a: string[]) => execFileSync('git', a, { cwd: rig.repo, env: rig.env })
  const outside = join(rig.home, 'outside')
  mkdirSync(outside)
  // a branch that has .env, and sub as a link out of the repo
  g('checkout', '-q', '-b', 'other')
  writeFileSync(join(rig.repo, '.env'), 'from the branch\n')
  symlinkSync(outside, join(rig.repo, 'sub'))
  g('add', '.env', 'sub')
  g('commit', '-qm', 'other')
  g('checkout', '-q', 'main')
  // main's ignored files
  writeFileSync(join(rig.repo, '.env'), 'from main\n')
  mkdirSync(join(rig.repo, 'sub'))
  writeFileSync(join(rig.repo, 'sub/secret'), 'shh\n')
  symlinkSync('/nonexistent/laki', join(rig.repo, 'dangling'))
  writeFileSync(join(rig.repo, '.worktreeinclude'), '.env\nsub/\ndangling\n')
  const p = await rig.rpc('projectAdd', { path: rig.repo })

  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'from main' })
  assert.equal(readFileSync(join(a.path, '.env'), 'utf8'), 'from main\n')
  assert.equal(readFileSync(join(a.path, 'sub/secret'), 'utf8'), 'shh\n')
  assert.equal(lstatSync(join(a.path, 'dangling'), { throwIfNoEntry: false }), undefined)

  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'from other', base: 'other' })
  assert.equal(readFileSync(join(b.path, '.env'), 'utf8'), 'from the branch\n') // there already: it stays
  assert.ok(lstatSync(join(b.path, 'sub')).isSymbolicLink())
  assert.ok(!existsSync(join(outside, 'secret')), 'nothing written through the link')

  // archiving takes them with the worktree; restoring copies them again
  await rig.rpc('wsArchive', { id: a.id })
  assert.ok(!existsSync(a.path))
  await rig.rpc('wsRestore', { id: a.id })
  assert.equal(readFileSync(join(a.path, '.env'), 'utf8'), 'from main\n')

  // an include file git can't read: nothing copied, the workspace made
  rmSync(join(rig.repo, '.worktreeinclude'))
  mkdirSync(join(rig.repo, '.worktreeinclude'))
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'no list' })
  assert.ok(existsSync(c.path) && !existsSync(join(c.path, '.env')))
})

test('fork, muting, open in a custom editor, restore when the branch is gone', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { presets: [{ name: 'opus', agent: 'claude' }, { name: 'claude', agent: 'claude' }] })
  // a workspace with no claude chat forks with a shell
  const plain = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'plain' })
  const f1 = await rig.rpc('wsFork', { id: plain.id })
  assert.deepEqual([f1.id, f1.base], ['plain-fork', plain.branch])
  assert.deepEqual((await rig.rpc('state')).tabs.filter((x: any) => x.workspace === f1.id).map((x: any) => x.kind), ['shell'])
  // a claude chat: its preset, or claude once that preset is gone
  const cw = await rig.rpc('wsNew', { project: p.id, preset: 'opus', name: 'chat' })
  const ct = await until(async () => {
    const x = await rig.tab(cw.id)
    return x?.resumeId && x
  }, 'its chat')
  const f2 = await rig.rpc('wsFork', { id: cw.id })
  const t2 = await rig.tab(f2.id)
  assert.deepEqual([t2.profile, t2.forkOf], ['opus', ct.resumeId])
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }] })
  const t3 = await rig.tab((await rig.rpc('wsFork', { id: cw.id })).id)
  assert.deepEqual([t3.name, t3.profile, t3.forkOf], ['claude', 'claude', ct.resumeId])

  // muted and back
  assert.equal((await rig.rpc('tabSet', { id: ct.id, muted: true })).muted, true)
  assert.equal((await rig.rpc('tabSet', { id: ct.id, muted: false })).muted, undefined)
  assert.equal((await rig.rpc('wsSet', { id: cw.id, muted: true })).muted, true)
  assert.equal((await rig.rpc('wsSet', { id: cw.id, muted: false })).muted, undefined)

  // a custom editor command that fails quietly: the command that failed
  await rig.rpc('settingsSet', { editorCmd: 'false' })
  await assert.rejects(rig.rpc('openIn', { ws: cw.id, app: 'custom' }), /Command failed: .*-lc false "\$1" editor /)

  // restore with its branch deleted meanwhile
  await rig.rpc('wsArchive', { id: plain.id })
  execFileSync('git', ['branch', '-D', plain.branch], { cwd: rig.repo, env: rig.env })
  await assert.rejects(rig.rpc('wsRestore', { id: plain.id }), new RegExp(`git worktree add failed: .*${plain.branch}`))
})

test('progress: which tab, a number as text, none; dev mode keeps the last 500 lines', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'slow', local: true })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.status === 'running' && x
  }, 'at work')
  await assert.rejects(rig.rpc('progress', { pct: 5 }), /which tab\? \(run it in a Laki tab: \$LAKI_TAB\)/)
  await assert.rejects(rig.rpc('progress', { tab: 'nope', pct: 5 }), /no tab nope/)
  assert.deepEqual(await rig.rpc('progress', { tab: tab.id, pct: '42.6', note: '  half \n way ' }), { ok: true, pct: 43, note: 'half way' })
  await assert.rejects(rig.rpc('progress', { tab: tab.id, pct: '  ' }), /a percentage: 0 to 100/)
  await assert.rejects(rig.rpc('progress', { tab: tab.id, pct: null }), /a percentage: 0 to 100/)
  assert.deepEqual(await rig.rpc('progress', { tab: tab.id, pct: 140 }), { ok: true, pct: 100 })
  assert.deepEqual((await rig.tab(ws.id)).progress, { pct: 100 })
  // dev mode: each line kept, the oldest go past 500
  await rig.rpc('settingsSet', { devMode: true })
  for (let i = 0; i < 510; i++) await rig.rpc('progress', { tab: tab.id, pct: 50, note: `step ${i}` })
  const lines = (await rig.rpc('logs', { key: `ws:${ws.id}` })).map((l: any) => l.text)
  assert.equal(lines.length, 500)
  assert.equal(lines.at(-1), 'claude: 50% · step 509')
  assert.ok(!lines.includes('claude: 50% · step 9'))
})
