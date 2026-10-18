// core.ts from the ports on: port kills, tunnels and remote access, PR scans and their switches, phone pushes and
// taps, sleep and resources, diff and files (here and on an SSH host), the agent browser, scheduled tasks. Stand-ins a
// test writes into its own $HOME/bin (first on PATH) answer for ps, lsof, gh and cloudflared where the fakes can't.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fresh, type Rig, sleep, until } from './helpers.ts'

const fakes = fileURLToPath(new URL('fakes', import.meta.url))
const script = (path: string, body: string) => (writeFileSync(path, body), chmodSync(path, 0o755))
const state = (rig: Rig) => rig.rpc('state')
const wsOf = async (rig: Rig, id: string) => (await state(rig)).workspaces.find((w: any) => w.id === id)
const logged = async (rig: Rig, ws: string, re: RegExp, since = 0) => (await rig.rpc('logs', { key: `ws:${ws}` })).some((l: any) => re.test(l.text) && l.at >= since)
const fakeLog = (rig: Rig) => readFileSync(rig.env.FAKE_LOG, 'utf8')
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

test('ports: a kill refused (gone, not yours), one already ended; sleep skips a tab whose port is in its tree; limits; resources', async t => {
  const rig = await fresh(t)
  const d = join(rig.home, 'fake')
  mkdirSync(d)
  // ps and lsof as the files in $HOME/fake say, else the real ones
  script(
    join(rig.home, 'bin/ps'),
    `#!/bin/sh
d="$HOME/fake"
case "$*" in
  *uid=,lstart=*) [ -f "$d/uid" ] && { echo "$(cat "$d/uid") Mon Oct  6 10:00:00 2026"; exit 0; } ;;
  *rss=*) [ -f "$d/ps-none" ] && exit 0; /bin/ps "$@"; [ -f "$d/ps-rows" ] && cat "$d/ps-rows"; exit 0 ;;
  *pid=,ppid=*) /bin/ps "$@"; [ -f "$d/ps-kids" ] && cat "$d/ps-kids"; exit 0 ;;
esac
exec /bin/ps "$@"
`,
  )
  script(
    join(rig.home, 'bin/lsof'),
    `#!/bin/sh
d="$HOME/fake"
case "$*" in
  *-Fpcn*) [ -f "$d/lsof-scan" ] && { cat "$d/lsof-scan"; exit 0; } ;;
  *" -t"*) [ -f "$d/lsof-scan" ] && { [ -f "$d/gone" ] && exit 1; echo 1; exit 0; } ;;
esac
exec /usr/sbin/lsof "$@"
`,
  )
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', local: true })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.resumeId && x.status === 'idle' && x
  }, 'first turn')
  const pty = (await rig.rpc('resources')).tabs.find((x: any) => x.tab === tab.id).procs[0].pid

  // resources: a ps row that is its own parent doesn't loop; ps saying nothing leaves the tabs empty and the daemon its own
  writeFileSync(join(d, 'ps-rows'), `${pty} ${pty} 1 0.0 loop-row\n`)
  const looped = (await rig.rpc('resources')).tabs.find((x: any) => x.tab === tab.id)
  assert.equal(looped.procs.filter((x: any) => x.cmd === 'loop-row').length, 1)
  rmSync(join(d, 'ps-rows'))
  writeFileSync(join(d, 'ps-none'), '')
  const none = await rig.rpc('resources')
  assert.deepEqual(none.tabs.find((x: any) => x.tab === tab.id), { tab: tab.id, rss: 0, cpu: 0, procs: [] })
  assert.match(none.daemon.cmd, /src\/daemon\/main\.ts/)
  assert.equal(none.daemon.cpu, 0)
  assert.ok(none.daemon.rss > 0 && none.daemon.heap > 0)
  rmSync(join(d, 'ps-none'))

  // a port of the agent itself and a browser's (theirs, not in ports), and a ghost its shell tool started: a pid in the
  // tree that's no process (Linux's and macOS's pids stay below it)
  const ghost = 4194304
  writeFileSync(join(d, 'ps-kids'), `${ghost} ${pty} -zsh\n${ghost + 1} ${ghost} node\n`)
  writeFileSync(join(d, 'lsof-scan'), `p${pty}\ncclaude\nn*:5555\np${ghost}\ncghost\nn127.0.0.1:4567\np${ghost + 1}\ncGoogle Chrome\nn127.0.0.1:9222\n`)
  await until(async () => (await wsOf(rig, ws.id)).procs?.[9222], 'ports scanned')
  assert.deepEqual((await wsOf(rig, ws.id)).ports, [4567])
  assert.deepEqual((await wsOf(rig, ws.id)).procs, { 4567: { pid: ghost, cmd: 'ghost' }, 5555: { pid: pty, cmd: 'claude', own: true }, 9222: { pid: ghost + 1, cmd: 'Google Chrome', own: true } })
  await assert.rejects(rig.rpc('portKill', { ws: ws.id, port: 1234 }), new RegExp(`nothing of ${ws.id}'s listens on :1234`))
  writeFileSync(join(d, 'gone'), '')
  await assert.rejects(rig.rpc('portKill', { ws: ws.id, port: 4567 }), new RegExp(`ghost \\(pid ${ghost}\\) no longer listens on :4567`))
  rmSync(join(d, 'gone'))
  const uid = process.getuid!()
  writeFileSync(join(d, 'uid'), String(uid + 1))
  await assert.rejects(rig.rpc('portKill', { ws: ws.id, port: 4567 }), /ghost \(pid 4194304\) isn't yours to stop/)
  writeFileSync(join(d, 'uid'), String(uid))
  // it ended as it was asked to (ESRCH): no error, and SIGKILL's check 3 s later finds it gone too
  const killedAt = Date.now()
  assert.deepEqual(await rig.rpc('portKill', { ws: ws.id, port: 4567 }), { pid: ghost, cmd: 'ghost' })

  // usage limits: a reset a minute ago has just come (now); ten minutes ago, it's the next day's (dated: any time of day)
  const at = (ms: number) => {
    const x = new Date(ms)
    const h = x.getHours()
    return `${'JanFebMarAprMayJunJulAugSepOctNovDec'.slice(x.getMonth() * 3, x.getMonth() * 3 + 3)} ${x.getDate()} ${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
  }
  const before = Date.now()
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: { last_assistant_message: `You've hit your limit · resets ${at(Date.now() - 60e3)}` } })
  const lim = (await rig.tab(ws.id)).limit
  assert.ok(lim >= before && lim <= Date.now(), `limit ${lim} is now`)
  await assert.rejects(rig.rpc('tabSleep', { tab: tab.id }), /claude is busy: it can sleep once its turn ends and its usage limit resets/)
  const ten = new Date(Date.now() - 10 * 60e3)
  ten.setSeconds(0, 0)
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: { last_assistant_message: `You've hit your limit · resets ${at(ten.getTime())}` } })
  assert.equal((await rig.tab(ws.id)).limit, ten.getTime() + 86400000)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  assert.equal((await rig.tab(ws.id)).limit, undefined)
  await rig.rpc('hook', { tab: tab.id, state: 'running' })
  await assert.rejects(rig.rpc('tabSleep', { tab: tab.id }), /claude is busy: it can sleep once its turn ends$/)

  // sleep: a turn that just ended (no view since) isn't quiet yet; a port of its own keeps it up; then it sleeps, once
  await rig.rpc('settingsSet', { sleepAfter: 1 })
  const later = () => Date.now() + 3 * 3600e3
  await sleep(80) // a view sees it running
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  assert.deepEqual(await rig.rpc('sleepTick', { now: Date.now() + 30e3 }), [])
  await sleep(80)
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), []) // :5555 is the agent's
  rmSync(join(d, 'lsof-scan'))
  await until(async () => !(await wsOf(rig, ws.id)).ports.length, 'ports gone')
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), [tab.id])
  assert.equal(await rig.rpc('tabSleep', { tab: tab.id }), false) // asleep already
  assert.equal((await rig.tab(ws.id)).asleep, true)

  await sleep(Math.max(0, killedAt + 3300 - Date.now())) // the SIGKILL check ran, and the daemon is fine
  assert.equal(await rig.rpc('ping'), 'pong')
})

test('tunnels and remote access: versions cloudflared gives, its failures and ends, a workspace gone meanwhile, two starts at once; doctor', async t => {
  const rig = await fresh(t)
  const cf = join(rig.home, 'cf')
  mkdirSync(cf)
  // gh signed out, then in
  mkdirSync(rig.env.FAKE_GH)
  assert.equal((await rig.rpc('doctor')).gh, 'out')
  writeFileSync(join(rig.env.FAKE_GH, 'auth'), 'Logged in')
  const doc = await rig.rpc('doctor')
  assert.equal(doc.gh, 'in')
  assert.equal(doc.cloudflared, false)

  script(
    join(rig.home, 'bin/cloudflared'),
    `#!/bin/sh
d="$HOME/cf"
if [ "$1" = --version ]; then [ -f "$d/slow" ] && sleep 1; echo "cloudflared version $(cat "$d/version" 2>/dev/null || echo 2026.9.3)"; exit 0; fi
echo "cloudflared $*" >> "$FAKE_LOG"
port=$(printf '%s\\n' "$*" | sed -nE 's/.*(localhost|127\\.0\\.0\\.1):([0-9]+).*/\\2/p')
case "$port" in
  1111) exit 2 ;;
  1112) echo "ERR boom" >&2; exit 1 ;;
  2222) echo "INF https://quick-gone.trycloudflare.com" >&2; sleep 0.3; exit 3 ;;
esac
echo "INF https://fake-$port.trycloudflare.com" >&2
exec sleep 600
`,
  )
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  assert.equal((await rig.rpc('doctor')).cloudflared, true)

  // a version it can't read: '?', and emails are tried anyway
  writeFileSync(join(cf, 'version'), 'dev')
  assert.equal((await rig.rpc('cloudflared', {})).version, '?')
  assert.deepEqual(await rig.rpc('tunnelStart', { ws: ws.id, port: 4000, mails: ['a@b.co'] }), { port: 4000, url: 'https://fake-4000.trycloudflare.com', mails: ['a@b.co'] })
  await rig.rpc('tunnelStop', { ws: ws.id, port: 4000 })
  assert.equal(await rig.rpc('tunnelStop', { ws: ws.id, port: 4000 }), null) // none: nothing to do
  // a version with zeros, older than the one with --allowed-mail
  writeFileSync(join(cf, 'version'), '2026.0.1')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 4001, mails: ['a@b.co'] }), /cloudflared 2026\.0\.1 can't limit who opens a tunnel \(that needs 2026\.9\.3\)/)
  rmSync(join(cf, 'version'))

  // it ends saying nothing: the error is only that
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 1111 }), (e: Error) => e.message === 'cloudflared ended (exit 2)')
  await assert.rejects(rig.rpc('tunnelStart', { ws: ws.id, port: 1112 }), (e: Error) => e.message === 'cloudflared ended (exit 1):\nERR boom')
  // it gives a URL, then ends on its own: the tunnel goes from the view
  assert.equal((await rig.rpc('tunnelStart', { ws: ws.id, port: 2222 })).url, 'https://quick-gone.trycloudflare.com')
  await until(async () => !(await wsOf(rig, ws.id)).tunnels.length, 'the ended tunnel dropped')

  // the workspace goes while cloudflared says its version
  writeFileSync(join(cf, 'slow'), '')
  const going = rig.rpc('tunnelStart', { ws: ws.id, port: 4002 })
  await sleep(200)
  await rig.rpc('wsRm', { id: ws.id })
  await assert.rejects(going, new RegExp(`no workspace ${ws.id}`))

  // remote access asked twice at once: one cloudflared
  const both = await Promise.all([rig.rpc('remoteStart', { hours: 1, mail: 'me@x.co' }), rig.rpc('remoteStart', { hours: 1, mail: 'me@x.co' })])
  assert.ok(both.every(r => r.mail === 'me@x.co'))
  assert.equal(fakeLog(rig).split('\n').filter(l => /^cloudflared tunnel --url http:\/\/127\.0\.0\.1:/.test(l)).length, 1)
  await until(async () => (await state(rig)).remote?.url, 'remote access up')
  await rig.rpc('remoteStop')
})

test('without gh or cloudflared: doctor says missing; diff against a base that is gone, binary and cut diffs; files and fileRead/fileWrite limits', async t => {
  const rig = await fresh(t, { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LAKI_STAT_SCAN_MS: '20' } })
  const doc = await rig.rpc('doctor')
  assert.equal(doc.gh, 'missing')
  assert.equal(doc.git, true)
  assert.deepEqual(await rig.rpc('cloudflared', {}), { mails: [] }) // no version: not installed
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const local = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  await assert.rejects(rig.rpc('tunnelStart', { ws: local.id, port: 3000 }), /cloudflared isn't installed/)

  // a worktree on a branch made from 'side', which then goes: diff falls back to HEAD
  git(rig.repo, 'branch', 'side')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', base: 'side' })
  git(rig.repo, 'branch', '-D', 'side')
  writeFileSync(join(ws.path, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]))
  writeFileSync(join(ws.path, 'README.md'), 'hello\nworld\n')
  git(ws.path, 'add', 'bin.dat')
  const d1 = await rig.rpc('diff', { ws: ws.id })
  assert.equal(d1.from, 'HEAD')
  assert.deepEqual(d1.files, [
    { path: 'README.md', add: 1, del: 0, status: 'M' },
    { path: 'bin.dat', add: 0, del: 0, status: 'M' },
  ])
  // a new file of over 4 MB: the diff is cut
  writeFileSync(join(ws.path, 'big.txt'), 'x'.repeat(99) + '\n'.repeat(1) + ('y'.repeat(99) + '\n').repeat(45000))
  const d2 = await rig.rpc('diff', { ws: ws.id })
  assert.ok(d2.diff.endsWith('\n… (cut)'))
  assert.equal(d2.diff.length, (4 << 20) + '\n… (cut)'.length)
  assert.deepEqual(d2.files.find((f: any) => f.path === 'big.txt'), { path: 'big.txt', add: 45001, del: 0, status: 'A' })
  rmSync(join(ws.path, 'big.txt'))

  // the sidebar's stat, asked for every 20 ms here: one scan at a time, one asked for meanwhile runs after it
  writeFileSync(join(ws.path, 'u.txt'), 'a\nb\n')
  await rig.rpc('settingsSet', { diffStat: true })
  assert.deepEqual(await until(async () => (await wsOf(rig, ws.id)).stat, 'stat'), { add: 3, del: 0, files: 3, dirty: 3 })
  await rig.rpc('settingsSet', { diffStat: false })
  rmSync(join(ws.path, 'u.txt'))

  // fileRead's base image: one not there, one over 10 MB; fileWrite without text
  writeFileSync(join(ws.path, 'new.png'), 'png')
  await assert.rejects(rig.rpc('fileRead', { ws: ws.id, path: 'new.png', base: true }), /not in side/)
  writeFileSync(join(rig.repo, 'huge.png'), Buffer.alloc((10 << 20) + 10))
  git(rig.repo, 'add', 'huge.png')
  git(rig.repo, 'commit', '-qm', 'huge')
  await assert.rejects(rig.rpc('fileRead', { ws: local.id, path: 'huge.png', base: true }), /over 10 MB/)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'README.md', was: 'hello\n' }), /no text to save/)
  await assert.rejects(rig.rpc('fileWrite', { ws: ws.id, path: 'README.md', text: 'x'.repeat((512 << 10) + 1) }), /over 512 KB: edit it in your editor/)
  assert.deepEqual(await rig.rpc('fileWrite', { ws: ws.id, path: 'README.md', text: 'hi\n', was: 'hello\nworld\n' }), { size: 3 })
  assert.equal(readFileSync(join(ws.path, 'README.md'), 'utf8'), 'hi\n')

  // a folder project: an unreadable folder is left out
  const plain = join(rig.home, 'plain')
  mkdirSync(join(plain, 'locked'), { recursive: true })
  mkdirSync(join(plain, 'node_modules'))
  writeFileSync(join(plain, 'a.txt'), 'a')
  writeFileSync(join(plain, 'locked/b.txt'), 'b')
  writeFileSync(join(plain, 'node_modules/c.js'), 'c')
  const fp = await rig.rpc('projectAdd', { path: plain })
  const fw = await rig.rpc('wsNew', { project: fp.id, preset: 'none' })
  chmodSync(join(plain, 'locked'), 0)
  const fl = await rig.rpc('files', { ws: fw.id }).finally(() => chmodSync(join(plain, 'locked'), 0o755))
  assert.deepEqual(fl, { files: ['a.txt'], changed: {}, cut: false })
})

test('PR scans: fields and the dev log, autoFix waiting, merge when green step by step, archive on merge not now, attach, comments, diff, threads', async t => {
  const rig = await fresh(t, { env: { LAKI_PR_SCAN_MS: '3600000' } }) // scans when asked only
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  script(join(rig.home, 'bin/gh'), `#!/bin/sh\n[ -f "$HOME/gh-quiet" ] && case "$*" in "api repos/"*) exit 1 ;; esac\nexec "${fakes}/gh" "$@"\n`)
  await rig.rpc('settingsSet', { devMode: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const url = 'https://github.com/o/r/pull/5'
  const pr = (o: object = {}) => writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 5, state: 'OPEN', url, ...o }))
  const check = (name: string, conclusion: string) => ({ __typename: 'CheckRun', name, status: conclusion ? 'COMPLETED' : 'IN_PROGRESS', conclusion })
  let since = 0 // the last scan's start: what it logged is dated from then
  const scan = () => ((since = Date.now()), rig.rpc('prRefresh'))
  const saw = async (re: RegExp) => assert.ok(await logged(rig, ws.id, re, since), `logged ${re}`)
  const prOf = async () => (await wsOf(rig, ws.id)).pr

  // the scan's line in the dev log: a draft with nothing known; then checks, conflicts and a review
  pr({ isDraft: true, body: 'b'.repeat(5000) })
  await scan()
  await saw(/^PR #5 OPEN draft, head \?: checks none \(0 failing, 0 running, 0 passing\), conflicts unknown, review none$/)
  assert.equal((await prOf()).body.length, 4000)
  assert.deepEqual((await prOf()).list, [])
  pr({ headRefOid: 'abcdef123456', statusCheckRollup: [check('test', 'FAILURE'), check('lint', '')], mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED', body: 7 })
  await scan()
  await saw(/^PR #5 OPEN, head abcdef1: checks fail \(1 failing: test, 1 running, 0 passing\), conflicts yes, review CHANGES_REQUESTED$/)
  assert.equal((await prOf()).body, undefined)
  pr({ headRefOid: 'abcdef123456', mergeable: 'MERGEABLE' })
  await scan()
  await saw(/conflicts no, review none$/)

  // autoFix with nothing to send: no head commit known yet, checks running, none yet
  await rig.rpc('wsSet', { id: ws.id, autoFix: true })
  pr({ statusCheckRollup: [check('test', 'FAILURE')] })
  await scan()
  await saw(/^fix CI: failing, its head commit not known yet: waiting$/)
  pr({ headRefOid: 'h1', statusCheckRollup: [check('test', '')] })
  await scan()
  await saw(/^fix CI: checks pending: waiting$/)
  pr({ headRefOid: 'h1' })
  await scan()
  await saw(/^fix CI: checks none yet: waiting$/)
  await rig.rpc('wsSet', { id: ws.id, autoFix: false })

  // merge when green: each reason it waits, a merge gh refuses (over to you, no agent to mark), the same head again
  await rig.rpc('projectSet', { id: p.id, config: { pr: { land: true } } })
  await rig.rpc('wsSet', { id: ws.id, autoLand: true })
  const green = { headRefOid: 'g1aaaaaaaa', statusCheckRollup: [check('test', 'SUCCESS')], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }
  const waits: [object, string][] = [
    [{ isDraft: true }, 'a draft'],
    [{ statusCheckRollup: [check('test', '')] }, 'checks pending'],
    [{ statusCheckRollup: [] }, 'checks none yet'],
    [{ mergeable: 'CONFLICTING' }, 'conflicts'],
    [{ mergeable: 'UNKNOWN' }, 'GitHub is still working out whether it merges'],
    [{ reviewDecision: 'CHANGES_REQUESTED' }, 'review CHANGES_REQUESTED'],
    [{ reviewDecision: 'APPROVED', mergeStateStatus: 'BLOCKED' }, 'GitHub blocks it still (a required check or review to come, or behind its base)'],
  ]
  for (const [o, why] of waits) {
    pr({ ...green, ...o })
    await scan()
    await saw(new RegExp(`^merge when green: not yet, ${why.replace(/[()]/g, '\\$&')}$`))
  }
  writeFileSync(join(gh, 'refuse'), 'GraphQL: Pull request is not mergeable')
  pr(green)
  await scan()
  await saw(/^merge when green: failed: gh: GraphQL: Pull request is not mergeable$/)
  await saw(/^over to you: Merge when green failed: gh: GraphQL: Pull request is not mergeable \(no live agent to mark\)$/)
  await scan()
  await saw(/^merge when green: not yet, tried g1aaaaa already$/)
  // turned on again: that head goes again, and merges
  rmSync(join(gh, 'refuse'))
  const t0 = Date.now()
  await rig.rpc('wsSet', { id: ws.id, autoLand: false })
  await rig.rpc('wsSet', { id: ws.id, autoLand: true })
  await scan()
  await until(() => fakeLog(rig).includes(`gh pr merge --squash --delete-branch -R github.com/o/r -- ${url}`), 'merged')
  assert.ok(await logged(rig, ws.id, /^merge when green: merged \(squash\)$/, t0))

  // with an agent: a failed merge is over to it (waiting); while it works, nothing merges and nothing is archived
  const tab = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await until(async () => (await rig.screen(tab.id)).includes('>'), 'claude up')
  writeFileSync(join(gh, 'refuse'), 'GraphQL: Base branch was modified')
  pr({ ...green, headRefOid: 'g2bbbbbbbb' })
  await scan()
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'over to the agent')
  rmSync(join(gh, 'refuse'))
  // a message queued for it: it counts as working, and a merged PR isn't archived under it
  assert.equal((await rig.rpc('send', { target: tab.id, text: 'later', whenIdle: true })).queued, 1)
  pr({ ...green, headRefOid: 'g3cccccccc' })
  await scan()
  await saw(/^merge when green: not yet, its agent is working: a push may come$/)
  await rig.rpc('settingsSet', { archiveMerged: true })
  pr({ ...green, state: 'MERGED', headRefOid: 'g3cccccccc' })
  await scan()
  await saw(/^archive on merge: not now, an agent is at work$/)
  // its turn over (the queue delivered): on to the commits check, which a head git doesn't know fails
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  await until(async () => {
    const x = await rig.tab(ws.id)
    return x.last === 'answer: later' && x.status === 'idle' && !x.queue?.length
  }, 'the queued message answered')
  await scan()
  await saw(/^archive on merge: no, commits past the PR's head$/)
  assert.ok(!(await wsOf(rig, ws.id)).archived)
  await rig.rpc('settingsSet', { archiveMerged: false })

  // fixing CI by hand: gh's checks empty, or none failing
  pr({ headRefOid: 'h2', statusCheckRollup: [check('test', 'FAILURE')] })
  await scan()
  writeFileSync(join(gh, 'checks.json'), '')
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'ci' }), /no failing checks on PR #5/)
  writeFileSync(join(gh, 'checks.json'), JSON.stringify([{ name: 'lint', bucket: 'pass', link: '' }]))
  await assert.rejects(rig.rpc('prFix', { ws: ws.id, what: 'ci' }), /no failing checks on PR #5/)

  // review threads: a bot's and an owner's count, a stranger's (no author, no association) doesn't
  writeFileSync(
    join(gh, 'graphql.json'),
    JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [{ id: 't1', isResolved: false, isOutdated: false, path: 'a.ts', line: 3, comments: { nodes: [
      { author: { login: 'lint', __typename: 'Bot' }, authorAssociation: 'NONE', body: 'unused' },
      { author: { login: 'ann', __typename: 'User' }, authorAssociation: 'OWNER', body: 'rename' },
      { author: null, body: 'spam' },
    ] } }] } } } } }),
  )
  assert.deepEqual((await rig.rpc('prThreads', { ws: ws.id }))[0].comments.map((c: any) => c.author), ['lint', 'ann'])

  // comments on a line: gh's 422, gh failing silently, no URL back, then one
  const comment = { ws: ws.id, path: 'README.md', line: 1, body: 'why?' }
  await assert.rejects(rig.rpc('prComment', comment), /that line isn't in the PR's diff: commit and push it first/)
  writeFileSync(join(rig.home, 'gh-quiet'), '')
  await assert.rejects(rig.rpc('prComment', comment), (e: Error) => e.message === "gh couldn't comment: it failed")
  rmSync(join(rig.home, 'gh-quiet'))
  writeFileSync(join(gh, 'comment.json'), '')
  assert.deepEqual(await rig.rpc('prComment', comment), {})
  writeFileSync(join(gh, 'comment.json'), JSON.stringify({ html_url: 'https://github.com/o/r/pull/5#c1' }))
  assert.deepEqual(await rig.rpc('prComment', comment), { url: 'https://github.com/o/r/pull/5#c1' })
  pr({ statusCheckRollup: [] }) // no head commit known
  await scan()
  await assert.rejects(rig.rpc('prComment', comment), /PR #5's head commit isn't known yet: try again in a minute/)

  // the PR's diff: a line before any file is skipped, no base known; a huge one is cut
  const patch = 'From gh\ndiff --git a/x.txt b/x.txt\nnew file mode 100644\n--- /dev/null\n+++ b/x.txt\n@@ -0,0 +1 @@\n+hi\n'
  writeFileSync(join(gh, 'pr.diff'), patch)
  assert.deepEqual(await rig.rpc('prDiff', { ws: ws.id }), { base: 'its base', from: 'PR #5', files: [{ path: 'x.txt', status: 'A', add: 1, del: 0 }], diff: patch })
  writeFileSync(join(gh, 'pr.diff'), patch + '+more\n'.repeat(800000))
  const big = await rig.rpc('prDiff', { ws: ws.id })
  assert.ok(big.diff.endsWith('\n… (cut)') && big.diff.length === (4 << 20) + '\n… (cut)'.length)
  assert.equal(big.files[0].add, 800001)

  // attach a fork's PR: only linked (its head is <owner>/<branch>); one with no owner given counts by its branch
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 8, title: 'x', url: 'https://github.com/o/r/pull/8', headRefName: 'feat', baseRefName: 'main', isCrossRepository: true, headRepositoryOwner: { login: 'alice' } }))
  assert.deepEqual(await rig.rpc('prAttach', { ws: ws.id, pr: '8' }), { number: 8, url: 'https://github.com/o/r/pull/8', linked: true })
  await saw(/^PR: #8 attached, only linked \(its branch is alice\/feat\)$/)
  writeFileSync(join(gh, 'prhead.json'), JSON.stringify({ number: 9, title: 'x', url: 'https://github.com/o/r/pull/9', headRefName: ws.branch, baseRefName: 'main', isCrossRepository: true }))
  assert.deepEqual(await rig.rpc('prAttach', { ws: ws.id, pr: '9' }), { number: 9, url: 'https://github.com/o/r/pull/9', linked: false })

  // merge when green left on in a state.json whose project no longer allows it (an older one): it says so
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const s = JSON.parse(readFileSync(file, 'utf8'))
  s.projects.find((x: any) => x.id === p.id).config = {}
  Object.assign(s.workspaces.find((x: any) => x.id === ws.id), { autoLand: true, prUrl: undefined, prLinked: undefined })
  writeFileSync(file, JSON.stringify(s))
  await rig.start()
  pr(green)
  await scan()
  await saw(/^merge when green: not yet, off in the project's settings$/)
})

test('phone: a wait over before its push, one without a menu, taps while polls are held or failing, a tab that moved on', async t => {
  const posts: { url: string; body: string }[] = []
  let replies: string[] = []
  let held: ServerResponse[] | null = null
  let fail = false
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.startsWith('/topic-r1/json?poll=1')) {
        if (fail) return void res.writeHead(500).end()
        if (held) return void held.push(res)
        return void res.writeHead(200).end(replies.splice(0).join('\n'))
      }
      posts.push({ url: req.url!, body })
      res.writeHead(200).end()
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const a = await rig.tab(ws.id)
  const b = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  const statusOf = async (id: string) => (await state(rig)).tabs.find((x: any) => x.id === id).status
  for (const x of [a, b]) await until(async () => /> $/m.test(await rig.screen(x.id)), 'claude up')
  await rig.rpc('settingsSet', { webhook: { url, answer: true, replyTopic: 'r1' } }) // ntfy, the default

  // a wait that's over within the 800 ms before its push: none goes
  await rig.rpc('hook', { tab: a.id, state: 'waiting', payload: { message: 'quick one' } })
  await rig.rpc('hook', { tab: a.id, state: 'running' })
  await sleep(1000)
  assert.equal(posts.length, 0)
  await state(rig) // seen running: its next wait pushes
  await rig.rpc('hook', { tab: a.id, state: 'idle', payload: {} })

  // a question without a menu: a push without buttons
  await rig.rpc('input', { tab: a.id, data: 'ask\r' })
  const plain = await until(() => posts.find(x => x.body.includes('needs permission')), 'the plain push')
  assert.equal(plain!.url, '/topic')
  await rig.rpc('input', { tab: a.id, data: 'y\r' })
  await until(async () => (await statusOf(a.id)) === 'idle', 'a idle')

  // two menus waiting: a push each, with buttons; the second finds the poll timer running
  const menu = async (id: string) => {
    const n = posts.length
    await rig.rpc('send', { target: id, text: 'menu' })
    const push = await until(() => posts.slice(n).find(x => x.url === '/'), 'a push with buttons')
    return JSON.parse(push!.body).actions[0].body.split(':')[0] as string
  }
  const na = await menu(a.id)
  const nb = await menu(b.id)
  assert.notEqual(na, nb)

  // polls held: a second tick meanwhile does nothing; a answered here meanwhile, so the tap for it moved on
  held = []
  const first = rig.rpc('phoneTick')
  await until(() => held!.length, 'a poll held')
  assert.equal(await rig.rpc('phoneTick'), null)
  await rig.rpc('answer', { tab: a.id, n: 1 })
  await until(async () => (await statusOf(a.id)) === 'idle', 'a answered here')
  for (const r of held) r.writeHead(200).end(JSON.stringify({ event: 'message', id: 'm1', message: `${na}:3` }))
  held = null
  await first
  await sleep(300)
  assert.match(await rig.screen(a.id), /picked: Yes/)
  assert.doesNotMatch(await rig.screen(a.id), /picked: No/)

  // a's next menu answered here before any tick: the tick lets its nonce go, b's stays
  const na2 = await menu(a.id)
  await rig.rpc('answer', { tab: a.id, n: 1 })
  await until(async () => (await statusOf(a.id)) === 'idle', 'a answered again')
  await sleep(1100) // answer holds a tab a second after its Enter
  replies.push(JSON.stringify({ event: 'message', id: 'm2', message: `${na2}:3` }))
  await rig.rpc('phoneTick')
  await sleep(300)
  assert.doesNotMatch(await rig.screen(a.id), /picked: No/)

  // the poll failing: the tick still ends well; then b's tap answers it
  fail = true
  assert.equal(await rig.rpc('phoneTick'), null)
  assert.equal(await rig.rpc('phoneTick'), null)
  fail = false
  replies = [JSON.stringify({ event: 'message', id: 'm3', message: `${nb}:3` })]
  await rig.rpc('phoneTick')
  await until(async () => /picked: No, and tell Claude/.test(await rig.screen(b.id)), 'b picked 3 from the phone')
})

test('an SSH host: hostSync follows the branch, sleep refused, diff and stats, a folder project\'s files, fileNew and fileRead there', async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { diffStat: true })
  const p = await rig.rpc('projectAdd', { path: `devbox:${rig.repo}` })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hello' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.resumeId && x.status === 'idle' && x
  }, 'its first turn there', 15000)
  await assert.rejects(rig.rpc('tabSleep', { tab: tab.id }), /claude runs on an SSH host: its memory is there/)

  // diff there: nothing new, then a new file; the sidebar's stat counts it, not its lines
  assert.deepEqual((await rig.rpc('diff', { ws: ws.id })).files, [])
  writeFileSync(join(ws.path, 'new.txt'), 'one\ntwo\n')
  assert.deepEqual((await rig.rpc('diff', { ws: ws.id })).files, [{ path: 'new.txt', add: 2, del: 0, status: 'A' }])
  // a scan under way as the file came may see it in ls-files, not yet in status: the next one has both
  const want = JSON.stringify({ add: 0, del: 0, files: 1, dirty: 1 })
  await until(async () => JSON.stringify((await wsOf(rig, ws.id)).stat) === want, `stat scanned as ${want}`)

  // the PR scan reads its branch there: the same, then another one
  await until(() => fakeLog(rig).includes(`gh pr view ${ws.branch}`), 'a PR scan there')
  git(ws.path, 'checkout', '-q', '-b', 'moved')
  await until(async () => (await wsOf(rig, ws.id)).branch === 'moved', 'the branch followed')

  // a folder (no git) there
  const plain = join(rig.home, 'plain')
  mkdirSync(join(plain, 'sub'), { recursive: true })
  mkdirSync(join(plain, 'node_modules'))
  writeFileSync(join(plain, 'a.txt'), 'a\n')
  writeFileSync(join(plain, 'sub/b.txt'), 'b')
  writeFileSync(join(plain, 'node_modules/c.js'), 'c')
  writeFileSync(join(plain, 'img.png'), 'png!')
  writeFileSync(join(plain, 'huge.png'), Buffer.alloc((10 << 20) + 1))
  writeFileSync(join(plain, 'bin.dat'), Buffer.from([1, 0, 2]))
  const fp = await rig.rpc('projectAdd', { path: `devbox:${plain}` })
  assert.equal(fp.git, false)
  const fw = await rig.rpc('wsNew', { project: fp.id, preset: 'none' })
  const fl = await rig.rpc('files', { ws: fw.id })
  assert.deepEqual([fl.files.sort(), fl.changed, fl.cut], [['a.txt', 'bin.dat', 'huge.png', 'img.png', 'sub/b.txt'], {}, false])
  await assert.rejects(rig.rpc('fileNew', { ws: fw.id, path: 'a.txt' }), (e: Error) => e.message === 'a.txt is there already')
  assert.deepEqual(await rig.rpc('fileNew', { ws: fw.id, path: 'sub/new.txt' }), { path: 'sub/new.txt' })
  assert.deepEqual(await rig.rpc('fileNew', { ws: fw.id, path: 'made/deep', dir: true }), { path: 'made/deep' })
  assert.ok(statSync(join(plain, 'made/deep')).isDirectory())
  assert.deepEqual(await rig.rpc('fileRead', { ws: fw.id, path: 'img.png' }), { size: 4, image: `data:image/png;base64,${Buffer.from('png!').toString('base64')}` })
  assert.deepEqual(await rig.rpc('fileRead', { ws: fw.id, path: 'huge.png' }), { size: (10 << 20) + 1 })
  assert.deepEqual(await rig.rpc('fileRead', { ws: fw.id, path: 'bin.dat' }), { size: 3 })
  assert.deepEqual(await rig.rpc('fileRead', { ws: fw.id, path: 'a.txt' }), { size: 2, text: 'a\n' })
  await assert.rejects(rig.rpc('fileRead', { ws: fw.id, path: 'nope.png' }), /nope\.png isn't a file/)

  // the host gone: its connection ends and can't be made again, and the side panel says so
  script(join(rig.home, 'bin/ssh'), `#!/bin/sh\n[ -f "$HOME/ssh-down" ] && { echo "Connection refused" >&2; exit 255; }\nexec "${fakes}/ssh" "$@"\n`)
  writeFileSync(join(rig.home, 'ssh-down'), '')
  const ctl = readdirSync(join(rig.data, 'ssh')).filter(f => /^[0-9a-f]{16}$/.test(f))
  for (const f of ctl) process.kill(Number(readFileSync(join(rig.data, 'ssh', f), 'utf8')), 'SIGTERM')
  const down = 'ssh devbox: Connection refused'
  await until(() => rig.rpc('fileNew', { ws: fw.id, path: 'x.txt' }).then(() => false, e => e.message === down), 'the connection dropped')
  await assert.rejects(rig.rpc('fileRead', { ws: fw.id, path: 'a.txt' }), (e: Error) => e.message === down)
})

test('the agent browser: ops and urls checked, an answer, a screenshot, failures with and without words', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'open', url: '/' }), /the agent browser needs Laki's window/)
  const c = await rig.connect()
  t.after(() => c.close())
  await c.call('view', { tab: null, focused: true, browse: true })
  const asked: any[] = []
  let reply: (m: any) => object = () => ({ ok: true, result: 'fine' })
  c.ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.ev !== 'browse') return
    asked.push(m)
    c.notify('browseDone', { id: m.req, ...reply(m) })
  })
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'scroll' }), /browser: scroll\? one of open, screenshot, click, fill, text/)
  for (const [u, want] of [
    ['/x', `http://localhost:${ws.port}/x`],
    ['localhost:3000/y', 'http://localhost:3000/y'],
    ['http://127.0.0.1:4000', 'http://127.0.0.1:4000'],
    [undefined, undefined],
  ]) {
    assert.equal(await rig.rpc('browse', { ws: ws.id, op: 'open', url: u }), 'fine')
    assert.equal(asked.at(-1).url, want)
  }
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'open', url: 'example.com' }), /opens this Mac's localhost only, not http:\/\/example\.com/)
  reply = () => ({ ok: true, result: { url: 'http://localhost:1/', png: Buffer.from('png!').toString('base64') } })
  const shot = await rig.rpc('browse', { ws: ws.id, op: 'screenshot' })
  assert.equal(shot.url, 'http://localhost:1/')
  assert.equal(readFileSync(shot.path, 'utf8'), 'png!')
  reply = () => ({ ok: false, error: 'no such element' })
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'click', selector: '#x' }), /no such element/)
  reply = () => ({ ok: false })
  await assert.rejects(rig.rpc('browse', { ws: ws.id, op: 'text' }), /the agent browser failed/)
})

test('scheduled tasks: the default agent, empty prompts and times, edits that keep the rule, a custom tab passed over, one deleted mid-tick', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { agent: 'codex' })
  const s1 = await rig.rpc('scheduleSet', { project: p.id, prompt: 'check the build', when: 'every day at 9am' })
  assert.deepEqual([s1.preset, s1.ws, s1.on], ['codex', 'new', true])
  await rig.rpc('settingsSet', { agent: '' })
  const s2 = await rig.rpc('scheduleSet', { project: p.id, prompt: 'tidy up', when: 'every day at 9am' })
  assert.equal(s2.preset, 'claude')
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, prompt: null, when: 'every day at 9am' }), /the prompt is empty/)
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, prompt: 'x', when: null }), /./)
  assert.equal((await state(rig)).schedules.length, 2)

  // an edit without when keeps the rule; off with another change has no next run
  const e1 = await rig.rpc('scheduleSet', { id: s2.id, prompt: 'tidy up more' })
  assert.deepEqual([e1.prompt, e1.when, e1.rule, e1.next], ['tidy up more', s2.when, s2.rule, s2.next])
  const e2 = await rig.rpc('scheduleSet', { id: s2.id, on: false, name: 'tidy' })
  assert.deepEqual([e2.on, e2.next, e2.name], [false, undefined, 'tidy'])
  assert.deepEqual((await state(rig)).schedules.map((x: any) => x.id), [s1.id, s2.id])

  // a run into a workspace whose agent tab is a custom command: passed over, a new claude tab gets it
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  await rig.rpc('tabNew', { ws: ws.id, cmd: 'cat' })
  const s3 = await rig.rpc('scheduleSet', { project: p.id, prompt: 'hello there', when: 'every day at 9am', ws: ws.id, preset: 'claude' })
  const run = await rig.rpc('scheduleRun', { id: s3.id })
  assert.deepEqual([run.ok, run.what, run.ws], [true, 'started in a new tab, claude: hello there', ws.id])
  assert.equal((await state(rig)).runs[0].id, run.id)
  // again: its claude tab is live now, and gets the prompt
  const again = await rig.rpc('scheduleRun', { id: s3.id })
  assert.equal(again.tab, run.tab)
  assert.match(again.what, /^(sent to its tab, claude: hello there|queued for its tab, claude: hello there \(it was working\))$/)
  await rig.rpc('scheduleRm', { id: s3.id })

  // two due at once: the second deleted while the first makes its worktree
  const due = (await state(rig)).schedules.find((x: any) => x.id === s1.id).next
  await rig.rpc('scheduleSet', { id: s2.id, on: true })
  writeFileSync(join(rig.repo, '.git/hooks/post-checkout'), '#!/bin/sh\nsleep 0.3\n', { mode: 0o755 }) // a worktree that takes a while (Linux makes one in under 30 ms)
  const tick = rig.rpc('scheduleTick', { now: due + 1000 })
  await sleep(30)
  await rig.rpc('scheduleRm', { id: s2.id })
  await tick
  const runs = (await state(rig)).runs
  assert.deepEqual(runs.filter((r: any) => r.schedule === s2.id), [])
  assert.equal(runs.filter((r: any) => r.schedule === s1.id).length, 1)
})
