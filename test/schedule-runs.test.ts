// scheduled tasks' runs: how each ended (T1), a run the Mac slept through (T2), a run condition (T3). schedule.ts;
// schedule.test.ts has the rest
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

type Rig = Awaited<ReturnType<typeof fresh>>
const runsOf = async (rig: Rig, id: string) => ((await rig.rpc('state')).runs as any[]).filter(r => r.schedule === id)
const at = (base: number, d: number, h: number, m = 0) => (x => (x.setDate(x.getDate() + d), x.setHours(h, m, 0, 0), x.getTime()))(new Date(base))

test('T1: a run says how it ended (done, waiting, failed) as its turns end; Tell me: needs, always, never; laki schedule log --json', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const app = await rig.connect()
  const told = () => app.events.filter(e => e.ev === 'scheduled')
  const task = (prompt: string, o: object = {}) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt, when: 'every day at 2am', ...o })
  await assert.rejects(task('x', { notify: 'sometimes' }), /tell you\? never, needs/)
  // done: its agent's last line; Tell me's default (needs) says nothing for it
  const done = await task('nightly deps')
  assert.equal(done.notify, undefined)
  const r1 = await rig.rpc('scheduleRun', { id: done.id })
  assert.equal(r1.state, 'running')
  await until(async () => (await runsOf(rig, done.id))[0].state === 'done', 'its end recorded')
  const e1 = (await runsOf(rig, done.id))[0]
  assert.equal(e1.said, 'answer: nightly deps')
  assert.ok(e1.endedAt >= e1.at)
  assert.deepEqual(e1.diff, { add: 0, del: 0, files: 0 })
  assert.equal(told().length, 0)
  // waiting: told (a notification and a toast in the app)
  const waits = await task('ask me first')
  await rig.rpc('scheduleRun', { id: waits.id })
  await until(async () => (await runsOf(rig, waits.id))[0].state === 'waiting', 'waiting recorded')
  await until(() => told().some(e => e.state === 'waiting'), 'told it needs you')
  assert.match(told().find(e => e.state === 'waiting').text, /needs you: needs permission/)
  // failed (an API error's end): told
  const fails = await task('apierror please')
  await rig.rpc('scheduleRun', { id: fails.id })
  await until(async () => (await runsOf(rig, fails.id))[0].state === 'failed', 'failed recorded')
  await until(() => told().some(e => e.state === 'failed'), 'told it failed')
  // Tell me: never (a wait isn't told); always (done is)
  const quiet = await task('ask again', { notify: 'never' })
  await rig.rpc('scheduleRun', { id: quiet.id })
  await until(async () => (await runsOf(rig, quiet.id))[0].state === 'waiting', 'waiting recorded')
  const loud = await task('all good', { notify: 'always' })
  await rig.rpc('scheduleRun', { id: loud.id })
  await until(() => told().some(e => e.state === 'done'), 'told it was done')
  assert.equal(told().filter(e => e.state === 'waiting').length, 1, 'never: not told')
  assert.equal(told().filter(e => e.state === 'done').length, 1)
  // the CLI: its glyphs and words; --json: the fields
  const log = await rig.cli('schedule', 'log')
  assert.match(log.out, /✓ {2}[^\n]*→ done: answer: nightly deps/)
  assert.match(log.out, /◆ {2}[^\n]*→ waiting/)
  const json = JSON.parse((await rig.cli('schedule', 'log', '--json')).out)
  assert.deepEqual(['state', 'said', 'endedAt'].map(k => k in json.find((r: any) => r.schedule === done.id)), [true, true, true])
  app.close()
})

test('T2: a run the Mac slept through runs once it wakes (the latest, until catchUntil or its next time); every 30 minutes is skipped; two wake 30 s apart', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const task = (o: object) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'nightly', when: 'every day at 2am', ...o })
  await assert.rejects(task({ missed: 'maybe' }), /skip or catchup/)
  await assert.rejects(task({ catchUntil: 2000 }), /minutes after midnight/)
  // slept through one: it runs as the Mac wakes (the first tick), said so
  const one = await task({})
  const wake = one.next + 3 * 3600e3 // 05:00
  await rig.rpc('scheduleTick', { now: wake })
  let r = await runsOf(rig, one.id)
  assert.equal(r.length, 1)
  assert.match(r[0].what, /^after wake \(due 02:00\): started in a new workspace/)
  // slept through three: one catch-up, the latest's
  await rig.rpc('scheduleSet', { id: one.id, on: false })
  const three = await task({ name: 'Three' })
  await rig.rpc('scheduleTick', { now: at(three.next, 2, 6) })
  r = await runsOf(rig, three.id)
  assert.equal(r.length, 1)
  assert.match(r[0].what, /^after wake \(due 02:00\)/)
  await rig.rpc('scheduleTick', { now: at(three.next, 2, 6) + 30000 })
  assert.equal((await runsOf(rig, three.id)).length, 1, 'once per wake')
  await rig.rpc('scheduleSet', { id: three.id, on: false })
  // woke after catchUntil (10:00): missed, logged
  const late = await task({ name: 'Late', catchUntil: 600 })
  await rig.rpc('scheduleTick', { now: at(late.next, 0, 11) })
  r = await runsOf(rig, late.id)
  assert.deepEqual([r.length, r[0].ok], [1, false])
  assert.match(r[0].what, /^missed: the Mac woke after 10:00/)
  await rig.rpc('scheduleSet', { id: late.id, on: false })
  // every 30 minutes: skipped as before (missed, logged)
  const often = await task({ name: 'Often', when: 'every 30 minutes' })
  await rig.rpc('scheduleTick', { now: often.next + 3 * 3600e3 })
  r = await runsOf(rig, often.id)
  assert.equal(r.length, 1)
  assert.match(r[0].what, /^missed: the Mac was asleep/)
  await rig.rpc('scheduleSet', { id: often.id, on: false })
  // two that wake together: one a tick (30 s apart)
  const a = await task({ name: 'A' })
  const b = await task({ name: 'B', when: 'every day at 3am' })
  const now = at(a.next, 0, 7)
  await rig.rpc('scheduleTick', { now })
  assert.deepEqual([(await runsOf(rig, a.id)).length, (await runsOf(rig, b.id)).length], [1, 0])
  assert.ok((await rig.rpc('state')).schedules.find((x: any) => x.id === b.id).catchup)
  await rig.rpc('scheduleTick', { now: now + 30000 })
  assert.equal((await runsOf(rig, b.id)).length, 1)
  assert.match((await runsOf(rig, b.id))[0].what, /^after wake \(due 03:00\)/)
})

test('T3: only if: new commits, failing PRs, new issues, a command; a skip is logged with no workspace; {{check}}; an agent can’t set a command', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const gh = rig.env.FAKE_GH
  mkdirSync(gh, { recursive: true })
  const task = (o: object) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'local', prompt: 'look: {{check}}', when: 'every day at 2am', ...o })
  await assert.rejects(task({ onlyIf: { kind: 'prs', what: 'some' } }), /failing, review or any/)
  await assert.rejects(task({ onlyIf: { kind: 'cmd', cmd: ' ' } }), /a command/)
  await assert.rejects(task({ onlyIf: { kind: 'when-i-say' } }), /commits, prs, issues or cmd/)
  const tick = async (s: any, n: number) => (await rig.rpc('scheduleTick', { now: at(s.next, n, 2) }), (await runsOf(rig, s.id))[0])

  // commits: the first runs, then none until the base has a new one
  const c = await task({ onlyIf: { kind: 'commits' } })
  const c1 = await tick(c, 0)
  assert.equal(c1.skipped, undefined, c1.what)
  assert.ok(c1.tab)
  const c2 = await tick(c, 1)
  assert.deepEqual([c2.ok, c2.skipped, c2.ws], [true, true, undefined])
  assert.equal(c2.what, 'skipped: no new commits on main')
  execFileSync('git', ['-C', rig.repo, 'commit', '-q', '--allow-empty', '-m', 'new'], { env: rig.env })
  const c3 = await tick(c, 2)
  assert.equal(c3.skipped, undefined, c3.what)
  await rig.rpc('scheduleSet', { id: c.id, on: false })

  // PRs: one with failing checks runs it, {{check}} its number; none: skipped
  const pr = await task({ onlyIf: { kind: 'prs', what: 'failing' } })
  writeFileSync(join(gh, 'prlist.json'), JSON.stringify([{ number: 5, isDraft: false, statusCheckRollup: [{ conclusion: 'SUCCESS' }] }]))
  assert.equal((await tick(pr, 0)).what, 'skipped: no PR with failing checks')
  writeFileSync(join(gh, 'prlist.json'), JSON.stringify([{ number: 5, isDraft: false, statusCheckRollup: [{ conclusion: 'FAILURE' }] }, { number: 6, statusCheckRollup: [] }]))
  const ran = await tick(pr, 1)
  assert.equal(ran.skipped, undefined, ran.what)
  await until(async () => (await rig.tab(ran.ws)).last === 'answer: look: #5', '{{check}} in the prompt')
  await rig.rpc('scheduleSet', { id: pr.id, on: false })

  // issues: new since its last run that started an agent
  const iss = await task({ onlyIf: { kind: 'issues', label: 'bug' } })
  writeFileSync(join(gh, 'issues.json'), JSON.stringify([{ number: 9, createdAt: '2020-01-01T00:00:00Z' }]))
  const i1 = await tick(iss, 0) // never ran: every open one is new
  assert.equal(i1.skipped, undefined, i1.what)
  assert.equal((await tick(iss, 1)).what, 'skipped: no new issues labeled bug')
  writeFileSync(join(gh, 'issues.json'), JSON.stringify([{ number: 9, createdAt: '2020-01-01T00:00:00Z' }, { number: 10, createdAt: new Date(at(iss.next, 1, 3)).toISOString() }]))
  assert.equal((await tick(iss, 2)).skipped, undefined)
  await rig.rpc('scheduleSet', { id: iss.id, on: false })

  // a command: exit 0 runs it, its first line is {{check}}; another exit skips it
  const no = await task({ onlyIf: { kind: 'cmd', cmd: 'echo nothing; exit 3' } })
  assert.equal((await tick(no, 0)).what, 'skipped: its check said no (exit 3): nothing')
  await rig.rpc('scheduleSet', { id: no.id, on: false })
  const yes = await task({ onlyIf: { kind: 'cmd', cmd: 'echo 3 new files' } })
  const y = await tick(yes, 0)
  assert.equal(y.skipped, undefined, y.what)
  await until(async () => (await rig.tab(y.ws)).last === 'answer: look: 3 new files', "the command's line as {{check}}")
  // Run now: no check (you asked)
  const now = await rig.rpc('scheduleRun', { id: no.id })
  assert.equal(now.skipped, undefined)
  // not for a workflow or an extension; an agent can't set a command (the built-in ones it can)
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, widget: 'clock', prompt: '', when: 'every day at 2am', onlyIf: { kind: 'commits' } }), /run condition is for an agent's task|no extension|clock/)
  const tab = (await rig.tab(y.ws)).id
  await assert.rejects(task({ onlyIf: { kind: 'cmd', cmd: 'true' }, from: { ws: y.ws, tab } }), /an agent can't set a command/)
  const mine = await task({ onlyIf: { kind: 'commits' }, from: { ws: y.ws, tab } })
  assert.deepEqual([mine.on, mine.onlyIf], [false, { kind: 'commits' }])
})
