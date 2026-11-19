import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { describe, describeHours, inHours, minutesOn, nextRun, parseAfter, parseCron, parseHours, parseWhen, type Rule, stamp, wsTitle } from '../src/shared/when.ts'
import { fresh, sleep, until } from './helpers.ts'

const SUN = new Date(2026, 9, 4, 10, 0).getTime() // Sunday 4 October 2026, 10:00
const rule = (t: string) => {
  const r = parseWhen(t, SUN)
  if ('error' in r) assert.fail(`${t}: ${r.error}`)
  return r
}
const error = (t: string) => (parseWhen(t, SUN) as { error?: string }).error
const day = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()

test('widget hours: a line of English to days and a span; in it or not', () => {
  const h = (t: string) => {
    const r = parseHours(t)
    return 'error' in r ? r.error : describeHours(r)
  }
  assert.equal(h('9am-9pm'), 'Every day, 09:00–21:00')
  assert.equal(h('weekdays 8:00 to 18:30'), 'Weekdays, 08:00–18:30')
  assert.equal(h('from 9 till 5pm, mon-thu'), 'Mon, Tue, Wed, Thu, 09:00–17:00')
  assert.equal(h('1-5pm except weekends'), 'Weekdays, 13:00–17:00')
  assert.equal(h('9-5'), 'Every day, 09:00–17:00')
  assert.equal(h('9am-5'), 'Every day, 09:00–17:00')
  assert.equal(h('noon-6'), 'Every day, 12:00–18:00')
  assert.equal(h('9am-6pm, no weekends'), 'Weekdays, 09:00–18:00')
  assert.equal(h('9-5 not fri'), 'Sun, Mon, Tue, Wed, Thu, Sat, 09:00–17:00')
  assert.equal(h('10pm to 6am'), 'Every day, 22:00–06:00 (the next day)')
  assert.match(h('sometimes'), /From when to when/)
  assert.match(h('9am-9am'), /From when to when/)
  const r = parseHours('9am-9pm weekdays') as Exclude<ReturnType<typeof parseHours>, { error: string }>
  const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, 4 + day, hh, mm).getTime() // Oct 4 2026: a Sunday
  assert.ok(inHours(r, at(1, 9)) && inHours(r, at(5, 20, 59)))
  assert.ok(!inHours(r, at(1, 21)) && !inHours(r, at(1, 8, 59)) && !inHours(r, at(6, 12)), 'after, before, a Saturday')
  const night = parseHours('10pm-6am fri') as typeof r
  assert.ok(inHours(night, at(5, 23)) && inHours(night, at(6, 5)), 'Friday night into Saturday')
  assert.ok(!inHours(night, at(5, 5)), 'Friday morning is Thursday night')
})

test('when: a line of English to days and times; the next run; in words', () => {
  const WEEK = [1, 2, 3, 4, 5]
  assert.deepEqual(rule('every day at 2am except weekends'), { days: WEEK, times: [120] })
  assert.deepEqual(rule('Weekdays at 9:00'), { days: WEEK, times: [540] })
  assert.deepEqual(rule('monday to friday at 8.30am'), { days: WEEK, times: [510] })
  assert.deepEqual(rule('mon, wed and fri at 18:30'), { days: [1, 3, 5], times: [1110] })
  assert.deepEqual(rule('sat-sun at 10'), { days: [0, 6], times: [600] })
  assert.deepEqual(rule('fri to mon at noon'), { days: [0, 1, 5, 6], times: [720] }) // a range across the weekend
  assert.deepEqual(rule('at 9 and 17:30 on weekdays'), { days: WEEK, times: [540, 1050] })
  assert.deepEqual(rule('daily at 12 a.m., 12pm'), { days: [0, 1, 2, 3, 4, 5, 6], times: [0, 720] })
  assert.deepEqual(rule('every weekday at midnight but not friday'), { days: [1, 2, 3, 4], times: [0] })
  assert.deepEqual(rule('every day except weekends at 2am'), { days: WEEK, times: [120] }) // what follows the days still counts
  assert.deepEqual(rule('every 2 hours but not on sat-sun from 9 to 13'), { days: WEEK, times: [540, 660, 780] })
  assert.deepEqual(rule('daily except mon, wed and fri at 3 in the afternoon'), { days: [0, 2, 4, 6], times: [900] })
  assert.deepEqual(rule('once a day at 9 in the morning'), { days: [0, 1, 2, 3, 4, 5, 6], times: [540] }) // not once
  assert.deepEqual(rule('every 2 hours from 9am to 6pm').times, [540, 660, 780, 900, 1020])
  assert.equal(rule('every 30 minutes').times.length, 48)
  assert.deepEqual(rule('hourly on weekends').days, [0, 6])
  assert.deepEqual(rule('every half an hour between 9 and 10').times, [540, 570, 600])
  assert.deepEqual(rule('every hour from noon to 3pm').times, [720, 780, 840, 900])
  assert.deepEqual(rule('tomorrow at 7am'), { days: [1], times: [420], once: true })
  assert.deepEqual(rule('once at 23:00'), { days: [0, 1, 2, 3, 4, 5, 6], times: [1380], once: true })
  // a bare number is a time only after at / and / a comma: "every 2 hours" has none
  assert.match(error('every 2 hours from 6pm to 9am')!, /From when to when/)
  assert.match(error('every 30 minutes until 5pm')!, /From when to when/)
  assert.match(error('whenever')!, /At what time/)
  assert.match(error('every day at 9 except holidays')!, /Except which days/)
  assert.match(error('every day')!, /At what time/)
  assert.match(error('every minute')!, /At most every 5 minutes/)
  assert.match(error('every 2 days at 9')!, /name the days/)
  assert.match(error('monthly at 9')!, /name the days/)
  assert.match(error('at 25:00')!, /isn’t a time/)
  assert.match(error('at 13pm')!, /isn’t a time/)
  assert.match(error('weekends except saturday and sunday at 9')!, /no days/)

  // the next run: later today, the next day it allows, across the week's end
  const r = (t: string) => rule(t) as Rule
  assert.equal(nextRun(r('every day at 2am except weekends'), SUN), day(5, 2))
  assert.equal(nextRun(r('at 9am and 5pm'), SUN), day(4, 17))
  assert.equal(nextRun(r('at 9am and 5pm'), day(4, 17)), day(5, 9)) // strictly after
  assert.equal(nextRun(r('sun at 9'), SUN), day(11, 9)) // a week on
  assert.equal(nextRun({ days: [], times: [60] }, SUN), undefined)

  assert.equal(describe(r('every day at 2am except weekends')), 'Weekdays at 02:00')
  assert.equal(describe(r('mon, wed and fri at 18:30')), 'Mon, Wed, Fri at 18:30')
  assert.equal(describe(r('every 30 minutes')), 'Every day every 30 min from 00:00 to 23:30')
  assert.equal(describe(r('hourly on weekends')), 'Weekends every hour from 00:00 to 23:00')
  assert.equal(describe(r('every 2 hours from 9am to 6pm')), 'Every day every 2 hours from 09:00 to 17:00')
  assert.equal(describe(r('tomorrow at 7am')), 'Once, Mon at 07:00')
  assert.equal(describe(r('once at 23:00')), 'Once, at 23:00')

  // a run's date in names and prompts; other braces stay
  const at = day(5, 7, 5) // Monday 5 October 2026, 07:05
  assert.equal(stamp('deps {{DD-MM-YY}} at {{HH:mm}}', at), 'deps 05-10-26 at 07:05')
  assert.equal(stamp('{{YYYY-MM-DD}} · {{ddd D MMM}} · {{H}}h', at), '2026-10-05 · Mon 5 Oct · 7h')
  assert.equal(stamp('{{project}} {{comment}} {{ - }} {{DD}', at), '{{project}} {{comment}} {{ - }} {{DD}')
  // any token, any order; MM right after an hour is the minutes
  assert.equal(stamp('{{DDMMYY HH-MM}} {{HH:MM}} {{MM}}', at), '051026 07-05 07:05 10')
  assert.equal(stamp('{{dddd, D MMMM YYYY hh:mm:ss A}}', at), 'Monday, 5 October 2026 07:05:00 AM')
  assert.equal(stamp('{{hh A}}', at + 12 * 3600_000), '07 PM')
  assert.equal(wsTitle({ prompt: ' update the deps and run the tests' }, at), '05-10 07:05 update the deps and')
  assert.equal(wsTitle({ name: 'Nightly {{DD.MM}}', prompt: 'x' }, at), 'Nightly 05.10')
})

test('when: several times in one line, a part each; a time two parts share runs once', () => {
  const wed = new Date(2026, 10, 4, 8, 0).getTime() // a Wednesday, 08:00
  const r = parseWhen('weekdays at 9am; fri at 4pm', wed) as Rule
  assert.deepEqual([r.days, r.times, r.also], [[1, 2, 3, 4, 5], [540], [{ days: [5], times: [960] }]])
  assert.equal(describe(r), 'Weekdays at 09:00; Fri at 16:00')
  assert.deepEqual(parseWhen('weekdays at 9am and fridays at 16:00', wed), r) // " and " before days splits too
  const fri = new Date(2026, 10, 6, 10, 0).getTime()
  assert.equal(nextRun(r, fri), new Date(2026, 10, 6, 16, 0).getTime()) // Friday: the later part's time
  // " and " between times or days stays one rule
  assert.deepEqual(parseWhen('weekdays at 9 and 17:30', wed), { days: [1, 2, 3, 4, 5], times: [540, 1050] })
  assert.deepEqual(parseWhen('mon and thu at 9am', wed), { days: [1, 4], times: [540] })
  assert.deepEqual(parseWhen('at 9am on mondays and fridays', wed), { days: [1, 5], times: [540] }) // "fridays" alone has no time: read whole
  // the same time twice: one run
  const twice = parseWhen('every day at 9am; weekdays at 9am', wed) as Rule
  assert.equal(nextRun(twice, new Date(2026, 10, 4, 9, 0).getTime()), new Date(2026, 10, 5, 9, 0).getTime())
  // a part that doesn't read says which
  assert.deepEqual(parseWhen('weekdays at 9am; sometimes', wed), { error: 'sometimes: At what time? (every day at 9am)' })
})

test('scheduled tasks: a new workspace each run, or the workspace’s agent; once, missed, the log', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { scheduleAtOnce: 0 }) // T8's cap: schedule-runs.test
  const task = (o: object) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'nightly deps', when: 'every day at 2am', ...o })
  await assert.rejects(task({ when: 'whenever' }), /At what time/)
  await assert.rejects(task({ preset: 'shell' }), /pick an agent/)
  await assert.rejects(task({ prompt: '  ' }), /prompt is empty/)
  await assert.rejects(task({ project: 'nope' }), /no project/)
  await assert.rejects(task({ ws: 'nope' }), /nope/)

  // made: its rule from the text, its next run; a client can't set those itself
  const s = await task({ name: 'Deps {{YYYY-MM-DD}}', rule: { days: [3], times: [1] }, next: 1 })
  assert.deepEqual(s.rule, { days: [0, 1, 2, 3, 4, 5, 6], times: [120] })
  assert.equal(s.on, true)
  assert.ok(s.next > Date.now() && s.next - Date.now() <= 86400e3)
  assert.equal(new Date(s.next).getHours(), 2)

  // due: a new workspace with claude and the prompt, named with the run's date; the next run is a day on
  await rig.rpc('scheduleTick', { now: s.next })
  let v = await rig.rpc('state')
  const first = v.runs[0]
  const date = stamp('{{YYYY-MM-DD}}', s.next)
  assert.equal(first.ok, true, first.what)
  assert.equal(first.name, `Deps ${date}`)
  assert.equal(first.what, `started in a new workspace, deps-${date}`)
  const made = v.workspaces.find((w: any) => w.id === first.ws)
  assert.deepEqual([made?.kind, made?.name, made?.schedule], ['worktree', `Deps ${date}`, s.id])
  assert.equal(first.tab, (await rig.tab(first.ws)).id)
  await until(async () => (await rig.tab(first.ws)).last === 'answer: nightly deps', 'the agent got the prompt')
  assert.equal(v.schedules[0].next, (d => d.setDate(d.getDate() + 1))(new Date(s.next))) // the next day's same time: a DST night isn't 24 hours
  assert.equal(v.schedules[0].last, s.next)
  await rig.rpc('scheduleTick', { now: s.next + 1000 }) // not due again
  assert.equal((await rig.rpc('state')).runs.length, 1)
  // two runs the same day (Run now): the second has its own name too
  const today = stamp('{{YYYY-MM-DD}}', Date.now())
  const runs = [await rig.rpc('scheduleRun', { id: s.id }), await rig.rpc('scheduleRun', { id: s.id })]
  const twins = (await rig.rpc('state')).workspaces.filter((w: any) => runs.some(r => r.ws === w.id)).map((w: any) => [w.id, w.name])
  const [[, a], [id2, b]] = twins // a: "Deps <today>", or with a tail when the tick's run was today too (before 2am)
  assert.ok(a.startsWith(`Deps ${today}`) && b !== a, String(twins))
  assert.match(id2, new RegExp(`^deps-${today}-[a-z0-9]{4}$`))
  assert.equal(b, `Deps ${today}${id2.slice(-5)}`) // the id's tail
  for (const r of runs) await rig.rpc('wsRm', { id: r.ws })

  // into that workspace: its running claude gets the prompt (Run now); off, it doesn't run
  await rig.rpc('scheduleSet', { id: s.id, on: false })
  const into = await task({ ws: first.ws, prompt: 'follow up {{YYYY}}', when: 'weekdays at 9', missed: 'skip' }) // T2's catch-up: schedule-runs.test
  const sent = await rig.rpc('scheduleRun', { id: into.id })
  assert.equal(sent.tab, first.tab)
  assert.match(sent.what, /^(sent to|queued for) its tab, claude/)
  await until(async () => (await rig.tab(first.ws)).last === `answer: follow up ${new Date().getFullYear()}`, 'the prompt, dated, reached the same agent')

  // long overdue (the Mac asleep), a task that skips: logged as missed, not run, and on to the next time
  await rig.rpc('scheduleTick', { now: into.next + 31 * 60e3 })
  v = await rig.rpc('state')
  assert.deepEqual([v.runs[0].schedule, v.runs[0].ok, v.runs[0].at], [into.id, false, into.next])
  assert.match(v.runs[0].what, /missed/)
  assert.ok(v.schedules.find((x: any) => x.id === into.id).next > into.next)

  // once: one run, then off; with no agent of its preset running, a new tab
  const once = await task({ ws: first.ws, preset: 'codex', prompt: 'just once', when: 'once at 23:00' })
  await rig.rpc('scheduleTick', { now: once.next })
  v = await rig.rpc('state')
  assert.match(v.runs[0].what, /^started in a new tab, codex/)
  assert.deepEqual([v.schedules.find((x: any) => x.id === once.id).on, v.schedules.find((x: any) => x.id === once.id).next], [false, undefined])

  // the workspace gone: the run says why; it can still be turned off, not on
  await rig.rpc('wsRm', { id: first.ws })
  const gone = await rig.rpc('scheduleRun', { id: into.id })
  assert.equal(gone.ok, false)
  assert.match(gone.what, new RegExp(first.ws))
  const off = await rig.rpc('scheduleSet', { id: into.id, on: false })
  assert.deepEqual([off.on, off.next], [false, undefined])
  await assert.rejects(rig.rpc('scheduleSet', { id: into.id, on: true }), new RegExp(first.ws))

  // a folder without git has no new workspaces; removing a project removes its tasks
  const plain = join(rig.home, 'notes')
  mkdirSync(plain)
  const np = await rig.rpc('projectAdd', { path: plain })
  await assert.rejects(task({ project: np.id }), /isn't a git repository/)
  await rig.rpc('scheduleRm', { id: once.id })
  assert.deepEqual((await rig.rpc('state')).schedules.map((x: any) => x.id), [s.id, into.id])
  await rig.rpc('projectRm', { id: p.id })
  assert.deepEqual((await rig.rpc('state')).schedules, [])
  await assert.rejects(rig.rpc('scheduleRun', { id: s.id }), /no scheduled task/)

  // in a folder, no worktree: its local workspace, made by the first run; then its agent gets the next ones
  const local = await task({ project: np.id, ws: 'local', prompt: 'tidy the notes', when: 'every day at 8pm' })
  const one = await rig.rpc('scheduleRun', { id: local.id })
  assert.deepEqual([one.ok, one.what, one.project], [true, 'started in a new tab, claude', np.id])
  const folder = (await rig.rpc('state')).workspaces.find((w: any) => w.id === one.ws)
  assert.deepEqual([folder.kind, folder.path, folder.project], ['local', realpathSync(plain), np.id])
  await until(async () => (await rig.tab(one.ws)).last === 'answer: tidy the notes', 'the agent in the folder got it')
  const two = await rig.rpc('scheduleRun', { id: local.id })
  assert.deepEqual([two.ws, two.tab], [one.ws, one.tab])

  // in the folder, a new session each run: a local workspace (a sidebar row) and agent per run, beside that one
  const each = await task({ project: np.id, ws: 'local-new', name: 'Notes {{DD-MM}}', prompt: 'sum up', when: 'every day at 9pm' })
  const [r1, r2] = [await rig.rpc('scheduleRun', { id: each.id }), await rig.rpc('scheduleRun', { id: each.id })]
  assert.match(r1.what, /^started in a new session in its folder, notes-/)
  const rows = (await rig.rpc('state')).workspaces.filter((w: any) => [r1.ws, r2.ws, one.ws].includes(w.id))
  assert.equal(new Set(rows.map((w: any) => w.id)).size, 3)
  assert.deepEqual(rows.map((w: any) => [w.kind, w.path]), Array(3).fill(['local', realpathSync(plain)]))
  const day = stamp('{{DD-MM}}', Date.now())
  const [n1, n2] = rows.filter((w: any) => w.id !== one.ws)
  assert.deepEqual([n1.name, n1.schedule, n2.schedule], [`Notes ${day}`, each.id, each.id])
  assert.match(n2.name, new RegExp(`^Notes ${day}-[a-z0-9]{4}$`))
  assert.notEqual(r1.tab, r2.tab)
  await until(async () => (await rig.tab(r2.ws)).last === 'answer: sum up', 'the second session got the prompt')
  // the folder's own workspace stays its own, whatever the order: not a run's session
  await rig.rpc('reorder', { workspaces: [r2.ws, r1.ws, one.ws] })
  assert.equal((await rig.rpc('wsNew', { project: np.id, local: true, preset: 'none' })).id, one.ws)
  // deleting a session leaves the folder, and its teardown isn't run there
  await rig.rpc('projectSet', { id: np.id, config: { teardown: 'touch torn-down' } })
  assert.equal((await rig.rpc('state')).projects.find((x: any) => x.id === np.id).config.teardown, 'touch torn-down')
  await rig.rpc('wsRm', { id: r1.ws })
  assert.ok(existsSync(plain) && !existsSync(join(plain, 'torn-down')))
  // the sessions left keep the project: delete them first
  await assert.rejects(rig.rpc('projectRm', { id: np.id }), new RegExp(`has workspaces: delete them first \\(${r2.ws}\\)`))
})

test('scheduled tasks: the same workspace each run (its first run makes it), Continue or Start fresh', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const s = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'same', name: 'Nightly', prompt: 'nightly', when: 'every day at 2am' })
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', fresh: true, prompt: 'x', when: 'every day at 2am' }), /start fresh is for runs that share a workspace/)
  const [first, twin] = await Promise.all([rig.rpc('scheduleRun', { id: s.id }), rig.rpc('scheduleRun', { id: s.id })]) // Run now twice at once: one workspace
  assert.equal(first.ok, true, first.what)
  assert.match(first.what, /^started in a new workspace, nightly.*: its next runs go there too$/)
  assert.deepEqual([twin.ok, twin.what], [false, 'skipped: its first run is still making its workspace'])
  assert.equal((await rig.rpc('state')).schedules[0].sameWs, first.ws)
  await until(async () => (await rig.tab(first.ws)).last === 'answer: nightly', 'its agent got the prompt')
  // Continue (unset): the next run tells the agent there
  const again = await rig.rpc('scheduleRun', { id: s.id })
  assert.deepEqual([again.ws, again.tab], [first.ws, first.tab])
  assert.match(again.what, /^(sent to|queued for) its tab, claude/)
  // Start fresh: a new agent tab there each run
  await rig.rpc('scheduleSet', { id: s.id, fresh: true })
  const fresh1 = await rig.rpc('scheduleRun', { id: s.id })
  assert.equal(fresh1.ws, first.ws)
  assert.notEqual(fresh1.tab, first.tab)
  assert.match(fresh1.what, /^started fresh in a new tab, claude/)
  // its workspace gone: the next run makes another, and the runs after go there; the task edited while that run makes
  // it (scheduleSet replaces it): the edited one keeps it
  await rig.rpc('wsRm', { id: first.ws })
  const [remade] = await Promise.all([rig.rpc('scheduleRun', { id: s.id }), rig.rpc('scheduleSet', { id: s.id, prompt: 'nightly too' })])
  assert.equal(remade.ok, true, remade.what)
  assert.notEqual(remade.ws, first.ws)
  assert.equal((await rig.rpc('state')).schedules[0].sameWs, remade.ws)
  // another where drops it, and Start fresh with it
  const moved = await rig.rpc('scheduleSet', { id: s.id, ws: 'new', fresh: false })
  assert.deepEqual([moved.sameWs, moved.fresh], [undefined, undefined])
})

test("scheduled tasks: a new workspace each run off the branch picked; that branch gone, the run fails and says so", async t => {
  const rig = await fresh(t)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: rig.repo, env: rig.env })
  git('checkout', '-qb', 'release/2.0')
  writeFileSync(join(rig.repo, 'rel.txt'), 'rel\n')
  git('add', '-A')
  git('commit', '-qm', 'rel')
  git('checkout', '-q', 'main')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const task = (o: object) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'backport', when: 'fridays at 5pm', ...o })
  await assert.rejects(task({ base: '-x' }), /a branch, not an option/)
  await assert.rejects(task({ ws: 'local', base: 'release/2.0' }), /for a new workspace each run/)
  const s = await task({ base: ' release/2.0 ' })
  assert.equal(s.base, 'release/2.0')
  const r = await rig.rpc('scheduleRun', { id: s.id })
  assert.equal(r.ok, true, r.what)
  assert.match(r.what, /, off release\/2\.0$/)
  const ws = (await rig.rpc('state')).workspaces.find((w: any) => w.id === r.ws)
  assert.equal(ws.base, 'release/2.0')
  assert.ok(existsSync(join(ws.path, 'rel.txt')), 'off the release branch')
  // gone: a failed run that names it, no workspace off main instead
  await rig.rpc('wsRm', { id: r.ws })
  git('branch', '-D', 'release/2.0')
  const gone = await rig.rpc('scheduleRun', { id: s.id })
  assert.deepEqual([gone.ok, gone.what, gone.ws], [false, `base release/2.0 not found in ${p.name}`, undefined])
  assert.equal((await rig.rpc('state')).workspaces.length, 0)
  // only on origin: off origin's, not tracking it
  git('update-ref', 'refs/remotes/origin/release/2.0', 'HEAD')
  const remote = await rig.rpc('scheduleRun', { id: s.id })
  assert.equal(remote.ok, true, remote.what)
  const rw = (await rig.rpc('state')).workspaces.find((w: any) => w.id === remote.ws)
  assert.equal(rw.base, 'origin/release/2.0')
  assert.throws(() => git('config', '--get', `branch.${rw.branch}.remote`), 'no upstream') // unset: git exits 1
  await rig.rpc('wsRm', { id: remote.ws })
  // '' clears it, null too; moved into a workspace, it's dropped
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, base: '' })).base, undefined)
  await rig.rpc('scheduleSet', { id: s.id, base: 'main' })
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, base: null })).base, undefined)
  await rig.rpc('scheduleSet', { id: s.id, base: 'main' })
  const into = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, ws: into.id })).base, undefined)
  // the CLI's --base
  const cli = await rig.cli('schedule', 'add', p.id, '--when', 'weekdays at 9am', '--base', 'main', 'triage')
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, /claude · new off main/)
})

test('scheduled tasks: an extension fetched, or one of its actions run; only one that is on', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const d = join(rig.data, 'widgets', 'disk')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Disk', every: 60, fetch: 'echo "{\\"n\\": $(date +%s)}"', actions: { note: 'echo "got $WIDGET_ARG"' } }))
  await rig.rpc('widgetReload')
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, widget: 'nope', when: 'every day at 9am' }), /no widget nope/)
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, widget: 'disk', action: 'nope', when: 'every day at 9am' }), /has no action nope/)
  await rig.rpc('settingsSet', { workflows: true })
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, widget: 'disk', workflow: 'x', when: 'every day at 9am' }), /not both/)
  const fetch = await rig.rpc('scheduleSet', { project: p.id, widget: 'disk', when: 'every day at 9am' })
  assert.equal(fetch.prompt, '', 'no prompt needed')
  const off = await rig.rpc('scheduleRun', { id: fetch.id })
  assert.deepEqual([off.ok, off.what, off.name], [false, 'Disk is off: turn it on first', 'Disk: fetch'])
  await rig.rpc('widgetSet', { id: 'disk', on: true })
  await until(async () => (await rig.rpc('state')).widgets.find((w: any) => w.id === 'disk')?.at, 'its first fetch')
  const was = (await rig.rpc('state')).widgets.find((w: any) => w.id === 'disk')
  assert.deepEqual(was.actions, ['note'])
  const ran = await rig.rpc('scheduleRun', { id: fetch.id })
  assert.deepEqual([ran.ok, ran.what], [true, 'fetched Disk'])
  assert.ok((await rig.rpc('state')).widgets.find((w: any) => w.id === 'disk').at > was.at, 'fetched again')
  const act = await rig.rpc('scheduleSet', { project: p.id, widget: 'disk', action: 'note', prompt: 'hello', when: 'weekdays at 9am' })
  const r = await rig.rpc('scheduleRun', { id: act.id })
  assert.deepEqual([r.ok, r.what], [true, "ran Disk's note: got hello"])
  const back = await rig.rpc('scheduleSet', { id: act.id, widget: '', prompt: 'do it', preset: 'claude' })
  assert.deepEqual([back.widget, back.action], [undefined, undefined], "'' makes it an agent's again")
})

test("scheduled tasks: a new workspace each run without the project's setup script", async t => {
  const rig = await fresh(t, { config: { setup: 'touch .setup-ran' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const task = (o: object) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'look', when: 'fridays at 5pm', ...o })
  await assert.rejects(task({ ws: 'local', noSetup: true }), /for a new workspace each run/)
  await assert.rejects(task({ noSetup: 'yes' }), /true or false/)
  const s = await task({ noSetup: true })
  assert.equal(s.noSetup, true)
  const r = await rig.rpc('scheduleRun', { id: s.id })
  assert.equal(r.ok, true, r.what)
  const v = await rig.rpc('state')
  assert.equal(v.workspaces.find((w: any) => w.id === r.ws).noSetup, true)
  assert.deepEqual(v.tabs.filter((x: any) => x.workspace === r.ws).map((x: any) => x.kind), ['agent'], 'no setup tab')
  // false clears it, null too; moved into a workspace, it's dropped
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, noSetup: false })).noSetup, undefined)
  await rig.rpc('scheduleSet', { id: s.id, noSetup: true })
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, noSetup: null })).noSetup, undefined)
  await rig.rpc('scheduleSet', { id: s.id, noSetup: true })
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, ws: r.ws })).noSetup, undefined)
  // the CLI's --no-setup
  const cli = await rig.cli('schedule', 'add', p.id, '--when', 'weekdays at 9am', '--no-setup', 'triage')
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, /claude · new, no setup/)
})

test('scheduled tasks: Archive takes one off the list and its runs, Restore brings it back as it was, the CLI too', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const s = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'nightly deps', when: 'every day at 2am' })
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, archived: true }), /archive which task/)
  await assert.rejects(rig.rpc('scheduleSet', { id: s.id, archived: 'yes' }), /archived\? true or false/)
  const a = await rig.rpc('scheduleSet', { id: s.id, archived: true })
  assert.ok(a.archived > 0 && a.next === undefined && a.on, 'archived, no next run, its switch kept')
  await assert.rejects(rig.rpc('scheduleRun', { id: s.id }), /archived: restore it/) // not by Run now either
  await rig.rpc('scheduleTick', { now: s.next })
  assert.equal((await rig.rpc('state')).runs?.length ?? 0, 0) // never runs
  // an edit keeps it archived; Restore: its next run again
  assert.ok((await rig.rpc('scheduleSet', { id: s.id, prompt: 'weekly deps' })).archived)
  const r = await rig.rpc('scheduleSet', { id: s.id, archived: false })
  assert.equal(r.archived, undefined)
  assert.ok(r.next > Date.now())
  // the CLI: archive, ls says so, restore; rm deletes it for good
  assert.equal((await rig.cli('schedule', 'archive', s.id)).out.trim(), `${s.id} archived`)
  assert.match((await rig.cli('schedule', 'ls')).out, new RegExp(`^${s.id}  archived  `))
  assert.equal((await rig.cli('schedule', 'restore', s.id)).out.trim(), `${s.id} restored`)
  await rig.rpc('scheduleRm', { id: s.id })
  assert.deepEqual((await rig.rpc('state')).schedules, [])
})

test('T5: keep 2 of 6 runs: the older ones archived (oldest first), a dirty and a pinned one kept and counted; an empty run archived as it ends', async t => {
  const rig = await fresh(t)
  mkdirSync(rig.env.FAKE_GH, { recursive: true })
  writeFileSync(join(rig.env.FAKE_GH, 'pr.json'), 'no pull requests found') // the fake's PR for every branch: none (an open one is kept)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'x', when: 'every day at 2am', keep: -1 }), /keep how many/)
  const s = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'hello', when: 'every day at 2am', keep: 2, emptyGone: false })
  const ws = async () => (await rig.rpc('state')).workspaces.filter((w: any) => w.schedule === s.id)
  const run = async () => {
    const r = await rig.rpc('scheduleRun', { id: s.id })
    await until(async () => (await rig.tab(r.ws))?.last === 'answer: hello', 'its agent done')
    return r.ws as string
  }
  const ids = [await run(), await run(), await run()]
  ids.push(await run()) // the 4th: the 2 oldest go
  await until(async () => (await ws()).filter((w: any) => w.archived).length === 2, 'two archived')
  assert.deepEqual((await ws()).filter((w: any) => w.archived).map((w: any) => w.id).sort(), ids.slice(0, 2).sort())
  // the 3rd dirty, the 4th pinned: kept as the 6th starts, counted
  const path3 = (await ws()).find((w: any) => w.id === ids[2]).path
  writeFileSync(join(path3, 'work.txt'), 'mine')
  await rig.rpc('wsSet', { id: ids[3], pinned: true })
  ids.push(await run(), await run())
  await until(async () => (await rig.rpc('state')).schedules.find((x: any) => x.id === s.id).kept === 2, '2 kept')
  assert.deepEqual((await ws()).filter((w: any) => !w.archived).map((w: any) => w.id).sort(), ids.slice(2).sort())
  // keep 0: all; emptyGone (unset: on): a run that changed nothing archived as it ends, said in its log entry
  const e = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'nothing to do', when: 'every day at 3am', keep: 0 })
  assert.equal(e.keep, 0)
  const r = await rig.rpc('scheduleRun', { id: e.id })
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === r.ws).archived, 'the empty run archived')
  await until(async () => /archived: it changed nothing$/.test((await rig.rpc('state')).runs.find((x: any) => x.id === r.id).what), 'said so')
})

// cron expressions: parsed when the English doesn't read (parseWhen), kept whole, the next run day by day
const cron = (t: string) => {
  const r = parseWhen(t)
  if ('error' in r) throw new Error(r.error)
  assert.ok(r.cron, `${t}: a cron rule`)
  return r
}
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
test('cron: each field form parses (numbers, lists, ranges, steps, names, 7 as Sunday, @ shortcuts)', () => {
  const c = cron('5,35 9-11/2 1,15 jan-mar,dec mon-fri').cron!
  assert.deepEqual([c.minute, c.hour, c.day, c.month, c.weekday], [[5, 35], [9, 11], [1, 15], [1, 2, 3, 12], [1, 2, 3, 4, 5]])
  assert.deepEqual(cron('0 12 * * 7').cron!.weekday, [0])
  assert.deepEqual(cron('0 12 * * 5-7').cron!.weekday, [0, 5, 6])
  assert.deepEqual(cron('10/20 * * * *').cron!.minute, [10, 30, 50])
  assert.deepEqual(cron('@hourly').cron!.minute, [0])
  assert.equal(cron('@daily').cron!.expr, '0 0 * * *')
  assert.equal(cron('@weekly').cron!.expr, '0 0 * * 0')
  assert.equal(cron('@monthly').cron!.expr, '0 0 1 * *')
  // an English rule reads as before
  const en = parseWhen('weekdays at 9am') as Rule
  assert.equal(en.cron, undefined)
  assert.equal(describe(en), 'Weekdays at 09:00')
})
test('cron: */20 9-17 * * 1-5 from a Friday 17:50 runs Monday 9:00; quarter starts; the words', () => {
  const r = cron('*/20 9-17 * * 1-5')
  assert.equal(nextRun(r, at(2026, 11, 20, 17, 50)), at(2026, 11, 23, 9, 0)) // Fri 20 Nov 2026
  assert.equal(nextRun(r, at(2026, 11, 23, 9, 0)), at(2026, 11, 23, 9, 20))
  assert.equal(describe(r), 'Weekdays every 20 min from 09:00 to 17:40')
  const q = cron('30 7 1 */3 *')
  assert.deepEqual(q.cron!.month, [1, 4, 7, 10])
  let t = at(2026, 2, 10)
  const runs: number[] = []
  for (let i = 0; i < 4; i++) runs.push((t = nextRun(q, t)!))
  assert.deepEqual(runs, [at(2026, 4, 1, 7, 30), at(2026, 7, 1, 7, 30), at(2026, 10, 1, 7, 30), at(2027, 1, 1, 7, 30)])
  assert.equal(describe(q), 'Day 1 of Jan, Apr, Jul, Oct at 07:30')
})
test("cron: day of month and day of week both set run on either (cron's OR); one * : the other alone", () => {
  const r = cron('0 9 13 * fri')
  // Nov 2026: Fri 6, Fri 13, Fri 20; the 13th a Friday too, once
  const runs: number[] = []
  for (let t = at(2026, 11, 1), i = 0; i < 4; i++) runs.push((t = nextRun(r, t)!))
  assert.deepEqual(runs, [at(2026, 11, 6, 9), at(2026, 11, 13, 9), at(2026, 11, 20, 9), at(2026, 11, 27, 9)])
  assert.deepEqual(minutesOn(r, at(2026, 12, 13)), [540]) // a Sunday, the 13th
  assert.deepEqual(minutesOn(cron('0 9 13 * *'), at(2026, 11, 6)), []) // a Friday, not the 13th
  assert.equal(describe(r), 'Day 13 or Fri at 09:00')
  // a step in either field starts with *, as Vixie cron reads it: both hold (not every day)
  const odd = cron('0 9 */2 * *')
  assert.deepEqual([1, 2, 3].map(d => minutesOn(odd, at(2026, 11, d)).length), [1, 0, 1])
  assert.equal(nextRun(odd, at(2026, 11, 1, 10)), at(2026, 11, 3, 9))
  const alt = cron('0 9 * * */2') // Sun, Tue, Thu, Sat
  assert.deepEqual(alt.days, [0, 2, 4, 6])
  assert.deepEqual([1, 2, 3].map(d => minutesOn(alt, at(2026, 11, d)).length), [1, 0, 1]) // Sun 1, Mon 2, Tue 3
  assert.equal(describe(alt), 'Sun, Tue, Thu, Sat at 09:00')
  assert.equal(describe(cron('0 9 1-31 * mon')), 'Every day at 09:00') // cron's OR with every day of the month
})
test('cron: a DST start day runs a skipped hour once after the gap; an end day runs a repeated hour once', () => {
  const tz = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const r = cron('30 2 * * *')
    const start = nextRun(r, at(2026, 3, 8, 0, 0))! // 8 Mar 2026: 2:00 → 3:00
    assert.equal(new Date(start).getHours(), 3)
    assert.equal(nextRun(r, start), at(2026, 3, 9, 2, 30))
    const e = cron('30 1 * * *')
    const first = nextRun(e, at(2026, 11, 1, 0, 0))! // 1 Nov 2026: 1:00-2:00 twice
    assert.equal(nextRun(e, first), at(2026, 11, 2, 1, 30))
    // every 20 min through the end night: no time twice in a row, none missing
    const every = cron('*/20 * * * *')
    const seen: number[] = []
    for (let t = at(2026, 11, 1, 0, 30), i = 0; i < 10; i++) seen.push((t = nextRun(every, t)!))
    assert.ok(seen.every((x, i) => !i || x > seen[i - 1]))
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
})
test('cron: what it refuses names the field', () => {
  const err = (t: string) => ((r => ('error' in r ? r.error : ''))(parseCron(t)))
  assert.match(err('0 0 9 * * *'), /seconds/)
  assert.match(err('0 9 ? * mon'), /day of month field/)
  assert.match(err('0 9 L * *'), /day of month field/)
  assert.match(err('0 9 * * 5#2'), /day of week field/)
  assert.match(err('0 9 15W * *'), /day of month field/)
  assert.match(err('61 9 * * *'), /minute field/)
  assert.match(err('0 24 * * *'), /hour field/)
  assert.match(err('0 9 * 13 *'), /month field/)
  assert.match(err('0 9 * * foo'), /day of week field/)
  assert.match(err('* * * * *'), /every 5 minutes/)
  assert.match(err('0 0 31 2 *'), /never runs/)
  assert.match(err('@yearly'), /@hourly/)
  // through parseWhen: a cron-looking line says cron's error, words say the English one
  assert.match((parseWhen('0 9 ? * mon') as { error: string }).error, /day of month/)
  assert.match((parseWhen('sometime soon') as { error: string }).error, /time/i)
})

test('T9: after another task: B runs as A ends done, not when A fails; any runs both ways; loops, long chains and another project refused', async t => {
  assert.deepEqual(parseAfter('after Nightly deps'), { name: 'Nightly deps', when: 'done' })
  assert.deepEqual(parseAfter('after "Build" ends'), { name: 'Build', when: 'any' })
  assert.deepEqual(parseAfter('after build, any'), { name: 'build', when: 'any' })
  assert.deepEqual(parseAfter('after build any'), { name: 'build', when: 'any' })
  assert.deepEqual(parseAfter('after Company'), { name: 'Company', when: 'done' }) // any as a word of its own only
  assert.equal(parseAfter('afternoon at 3'), undefined)
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { scheduleAtOnce: 0 }) // T8's cap: schedule-runs.test
  const task = (o: object) => rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', when: 'every day at 2am', ...o })
  const runsOf = async (id: string) => ((await rig.rpc('state')).runs as any[]).filter(r => r.schedule === id)
  const ended = (id: string, st: string) => until(async () => (await runsOf(id))[0]?.state === st, `${id}'s run ${st}`)
  const a = await task({ name: 'Nightly deps', prompt: 'nightly deps' })
  const f = await task({ name: 'Breaks', prompt: 'apierror please' })
  // the English line, or the field: no times, no next; one trigger a task
  const b = await task({ prompt: 'after deps', when: 'after nightly deps' })
  assert.deepEqual([b.after, b.when, b.next, b.rule.times], [{ task: a.id, when: 'done' }, '', undefined, []])
  const e = await task({ prompt: 'after deps either way', when: '', after: { task: a.id, when: 'any' } })
  const c = await task({ prompt: 'after breaks', when: 'after Breaks' })
  const d = await task({ prompt: 'after breaks either way', when: 'after Breaks, any' })
  await assert.rejects(task({ prompt: 'x', when: 'after nobody' }), /none in .* is named nobody/)
  await assert.rejects(task({ prompt: 'x', after: { task: a.id }, trigger: { event: 'push' } }), /one trigger a task/)
  await assert.rejects(task({ prompt: 'x', ws: 'parent' }), /that's for a task that runs after another/)
  await assert.rejects(rig.rpc('scheduleSet', { id: a.id, after: { task: a.id } }), /can't run after itself/)
  // a loop refused; a chain of 5 at most (a, b, x1, x2, x3)
  await assert.rejects(rig.rpc('scheduleSet', { id: a.id, when: 'after ' + b.id }), /a loop: Nightly deps → after deps → Nightly deps/)
  const x1 = await task({ name: 'x1', prompt: 'x1', after: { task: b.id }, when: '' })
  const x2 = await task({ name: 'x2', prompt: 'x2', after: { task: x1.id }, when: '' })
  const x3 = await task({ name: 'x3', prompt: 'x3', after: { task: x2.id }, when: '' })
  await assert.rejects(task({ prompt: 'x4', after: { task: x3.id }, when: '' }), /a chain of 5 tasks at most: this one would make 6/)
  for (const x of [x3, x2, x1]) await rig.rpc('scheduleRm', { id: x.id })
  // another project's task: refused
  const plain = join(rig.home, 'other')
  mkdirSync(plain)
  execFileSync('git', ['init', '-q', plain])
  const q = await rig.rpc('projectAdd', { path: plain })
  await assert.rejects(rig.rpc('scheduleSet', { project: q.id, preset: 'claude', ws: 'local', prompt: 'x', after: { task: a.id }, when: '' }), /is in another project/)

  // A done: B (done) and E (any) run, once each; F failed: C (done) doesn't, D (any) does
  await rig.rpc('scheduleRun', { id: a.id })
  await rig.rpc('scheduleRun', { id: f.id })
  await ended(a.id, 'done')
  await ended(f.id, 'failed')
  await until(async () => (await runsOf(b.id)).length && (await runsOf(e.id)).length && (await runsOf(d.id)).length, 'b, e and d ran')
  const [rb] = await runsOf(b.id)
  assert.match(rb.what, /^after Nightly deps \(done\): started in a new workspace/)
  assert.equal(rb.after, (await runsOf(a.id))[0].id)
  assert.match((await runsOf(d.id))[0].what, /^after Breaks \(failed\): started/)
  assert.equal((await runsOf(c.id)).length, 0)
  assert.equal((await rig.rpc('state')).schedules.find((x: any) => x.id === c.id).afterRun, undefined)
  await until(async () => (await rig.tab(rb.ws)).last === 'answer: after deps', 'b got its prompt')
  await ended(b.id, 'done')
  assert.equal((await runsOf(b.id)).length, 1, 'once per run of a')
  // A's next run: B again; then a turn of yours in A's first run's tab is no run's end (B's afterRun is the newer one)
  const [ra1] = await runsOf(a.id)
  await rig.rpc('scheduleRun', { id: a.id })
  await until(async () => (await runsOf(b.id)).length === 2, 'b after a second run of a')
  await rig.rpc('send', { target: ra1.tab, text: 'one more thing', whenIdle: true })
  await until(async () => (await rig.tab(ra1.ws)).last === 'answer: one more thing', 'your turn in its tab')
  await sleep(2500) // runEnded's 1.5 s after a turn's end
  assert.equal((await runsOf(b.id)).length, 2, 'a later turn in a run tab starts nothing')

  // deleting or archiving a task others wait on: asked, then they're off with why
  await assert.rejects(rig.rpc('scheduleRm', { id: f.id }), /after breaks, after breaks either way wait on it: deleting it turns them off/)
  const no = await rig.cli('schedule', 'archive', f.id)
  assert.ok(no.code !== 0 && /wait on it: archiving it turns them off/.test(no.err), no.err)
  assert.equal((await rig.cli('schedule', 'archive', f.id, '--force')).out.trim(), `${f.id} archived`)
  const off = (await rig.rpc('state')).schedules.find((x: any) => x.id === d.id)
  assert.deepEqual([off.on, off.pausedWhy, off.pausedField], [false, 'it runs after Breaks, which was archived', 'after'])
})

test('T9: in the same workspace as its run: B goes on in A\'s worktree, its agent; the runs a day at most still hold', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { scheduleAtOnce: 0 })
  const runsOf = async (id: string) => ((await rig.rpc('state')).runs as any[]).filter(r => r.schedule === id)
  const a = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', name: 'Fix', prompt: 'fix it', when: 'every day at 2am' })
  // the CLI: --after (its name or id), --where parent, the line says so
  const add = await rig.cli('schedule', 'add', p.id, '--after', 'Fix', '--where', 'parent', '--name', 'Review', 'review it')
  assert.match(add.out, / {2}after Fix \(done\) {2}/, add.err)
  const b = (await rig.rpc('state')).schedules.find((x: any) => x.name === 'Review')
  await rig.rpc('scheduleSet', { id: b.id, after: { task: a.id, when: 'done', perDay: 1 } })
  const r1 = await rig.rpc('scheduleRun', { id: a.id })
  await until(async () => (await runsOf(b.id)).length > 0, 'b ran')
  const [rb] = await runsOf(b.id)
  assert.equal(rb.ws, r1.ws, "a's run's workspace")
  assert.equal(rb.tab, r1.tab, 'its agent there got it')
  assert.match(rb.what, /^after Fix \(done\): (sent to|queued for) its tab/)
  await until(async () => (await rig.tab(r1.ws)).last === 'answer: review it', 'the same agent answered')
  // a second run of a today: b's one a day is used, its run skipped and logged
  await rig.rpc('scheduleRun', { id: a.id })
  await until(async () => (await runsOf(b.id)).length === 2, "b's second, skipped")
  const [skip] = await runsOf(b.id)
  assert.equal(skip.skipped, true)
  assert.match(skip.what, /^skipped: after Fix \(done\), 1 today already \(its most\)/)
})
