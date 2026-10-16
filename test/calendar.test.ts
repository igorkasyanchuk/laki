import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAt } from '../src/shared/when.ts'
import { fresh, until } from './helpers.ts'

test('parseAt: lengths from now, dates, a day and time; nonsense says how', () => {
  const now = new Date(2026, 9, 16, 18, 0).getTime() // a Friday, 6pm
  assert.equal(parseAt('in 2h', now), now + 2 * 3600000)
  assert.equal(parseAt('in 30 minutes', now), now + 30 * 60000)
  assert.equal(parseAt('in 3 days', now), now + 3 * 86400000)
  assert.equal(parseAt('2026-10-20', now), new Date(2026, 9, 20, 9, 0).getTime()) // a date: 9am
  assert.equal(parseAt('2026-10-20 14:30', now), new Date(2026, 9, 20, 14, 30).getTime())
  assert.equal(parseAt('tomorrow at 10am', now), new Date(2026, 9, 17, 10, 0).getTime())
  assert.equal(parseAt('mon at 9am', now), new Date(2026, 9, 19, 9, 0).getTime())
  assert.equal(parseAt('at 5pm', now), new Date(2026, 9, 17, 17, 0).getTime()) // past today: tomorrow's
  assert.equal(parseAt(12345, now), 12345)
  for (const bad of ['2026-02-31', '2026-10-20 25:00', 'whenever', '']) assert.ok('error' in (parseAt(bad, now) as object), bad)
})

test('reminders: off until Calendar is on; added, moved, ticked off, rung once while the app is open, removed', async t => {
  const rig = await fresh(t)
  await assert.rejects(rig.rpc('reminderAdd', { at: 'in 1h', text: 'x' }), /turn Calendar on/)
  assert.equal((await rig.rpc('state')).reminders, undefined, 'none in the view while off')
  await rig.rpc('settingsSet', { calendar: true })
  await assert.rejects(rig.rpc('reminderAdd', { at: 'in 1h', text: '  ' }), /needs its text/)
  await assert.rejects(rig.rpc('reminderAdd', { at: 'someday', text: 'x' }), /in 2h/) // says how
  const later = await rig.rpc('reminderAdd', { at: 'in 2h', text: 'Check CI', by: 'Laki AI' })
  const due = await rig.rpc('reminderAdd', { at: Date.now() - 1000, text: 'Standup notes' })
  assert.equal(later.by, 'Laki AI')
  let v = await rig.rpc('state')
  assert.deepEqual(v.reminders.map((r: any) => r.text), ['Standup notes', 'Check CI'], 'in time order')

  // nobody connected: nothing rings, it waits
  assert.deepEqual(await rig.rpc('reminderTick', { now: Date.now() }), [])
  const ws = await rig.connect()
  t.after(() => ws.close())
  await until(() => ws.events.some(e => e.ev === 'reminder' && e.reminder === due.id), 'the due one rings as the app connects')
  assert.deepEqual(await rig.rpc('reminderTick', { now: Date.now() }), [], 'once')
  assert.equal(ws.events.filter(e => e.ev === 'reminder').length, 1)

  // moved later: it rings again then; done: never
  await rig.rpc('reminderSet', { id: due.id, at: 'in 1h' })
  assert.equal((await rig.rpc('state')).reminders.find((r: any) => r.id === due.id).fired, undefined)
  await rig.rpc('reminderSet', { id: later.id, done: true })
  const rung = await rig.rpc('reminderTick', { now: Date.now() + 3 * 3600000 })
  assert.deepEqual(rung.map((r: any) => r.id), [due.id], 'the moved one, not the done one')
  await rig.rpc('reminderRm', { id: later.id })
  v = await rig.rpc('state')
  assert.deepEqual(v.reminders.map((r: any) => r.id), [due.id])
  await assert.rejects(rig.rpc('reminderRm', { id: 'nope' }), /no reminder nope/)

  // the CLI's laki remind and laki reminders
  const r = await rig.cli('remind', 'tomorrow at 9am', 'Release', 'notes')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^reminder \w+ at /)
  const ls = await rig.cli('reminders')
  assert.match(ls.out, /Release notes/)
})

test("reminders: a tab's names who added one (its agent and workspace); done ones leave the view after a few months", async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { calendar: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  const mine = await rig.rpc('reminderAdd', { at: 'in 1h', text: 'Ship it', tab: tab.id })
  assert.equal(mine.by, `claude in ${ws.name ?? ws.id}`)
  assert.equal((await rig.rpc('reminderAdd', { at: 'in 1h', text: 'Said', by: 'Laki AI', tab: tab.id })).by, 'Laki AI', 'a by said wins')
  assert.equal((await rig.rpc('reminderAdd', { at: 'in 1h', text: 'Nobody', tab: 'nope' })).by, undefined)

  const day = 86400000
  const old = await rig.rpc('reminderAdd', { at: Date.now() - 100 * day, text: 'Old and done' })
  const recent = await rig.rpc('reminderAdd', { at: Date.now() - 10 * day, text: 'Recent and done' })
  const open = await rig.rpc('reminderAdd', { at: Date.now() - 200 * day, text: 'Old, never ticked' })
  for (const r of [old, recent]) await rig.rpc('reminderSet', { id: r.id, done: true })
  const ids = (await rig.rpc('state')).reminders.map((r: any) => r.id)
  assert.ok(!ids.includes(old.id), 'done long ago: out of the view')
  assert.ok(ids.includes(recent.id) && ids.includes(open.id), 'done lately, or not done: in it')
})
