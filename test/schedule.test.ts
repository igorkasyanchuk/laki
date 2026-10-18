import assert from 'node:assert/strict'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { describe, describeHours, inHours, nextRun, parseHours, parseWhen, type Rule, stamp, wsTitle } from '../src/shared/when.ts'
import { fresh, until } from './helpers.ts'

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

test('scheduled tasks: a new workspace each run, or the workspace’s agent; once, missed, the log', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
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
  assert.equal(v.schedules[0].next, s.next + 86400e3)
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
  const into = await task({ ws: first.ws, prompt: 'follow up {{YYYY}}', when: 'weekdays at 9' })
  const sent = await rig.rpc('scheduleRun', { id: into.id })
  assert.equal(sent.tab, first.tab)
  assert.match(sent.what, /^(sent to|queued for) its tab, claude/)
  await until(async () => (await rig.tab(first.ws)).last === `answer: follow up ${new Date().getFullYear()}`, 'the prompt, dated, reached the same agent')

  // long overdue (the Mac asleep): logged as missed, not run, and on to the next time
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
  assert.ok((await rig.rpc('state')).widgets.find((w: any) => w.id === 'disk').at >= was.at, 'fetched again')
  const act = await rig.rpc('scheduleSet', { project: p.id, widget: 'disk', action: 'note', prompt: 'hello', when: 'weekdays at 9am' })
  const r = await rig.rpc('scheduleRun', { id: act.id })
  assert.deepEqual([r.ok, r.what], [true, "ran Disk's note: got hello"])
  const back = await rig.rpc('scheduleSet', { id: act.id, widget: '', prompt: 'do it', preset: 'claude' })
  assert.deepEqual([back.widget, back.action], [undefined, undefined], "'' makes it an agent's again")
})
