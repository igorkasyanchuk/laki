// A scheduled task's Duplicate (schedule.ts scheduleCopy, laki schedule copy): its settings and schedule under a new id,
// named … (copy), its group kept, no runs, off; an agent's call is refused
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

test('schedule copy: same settings, a new id, (copy), off, no runs; the CLI says so; an agent may not', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const s = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', prompt: 'nightly deps\nand more', when: 'every day at 2am', group: 'Nightly', base: 'main', noSetup: true, keep: 3 })
  await rig.rpc('scheduleRun', { id: s.id }) // a run of its own: the copy has none
  const c = await rig.rpc('scheduleCopy', { id: s.id })
  assert.notEqual(c.id, s.id)
  assert.equal(c.name, 'nightly deps (copy)')
  assert.equal(c.on, false)
  assert.equal(c.next, undefined, 'off: no next run')
  for (const k of ['project', 'preset', 'ws', 'prompt', 'when', 'group', 'base', 'noSetup', 'keep']) assert.deepEqual(c[k], s[k], k)
  assert.deepEqual(c.rule, s.rule)
  const v = await rig.rpc('state')
  assert.ok(v.schedules.find((x: any) => x.id === s.id).on, 'the original stays on')
  assert.ok(!(v.runs ?? []).some((r: any) => r.task === c.id || r.id === c.id), 'no runs of its own')
  // a named one keeps its name; the CLI prints the copy and how to turn it on
  await rig.rpc('scheduleSet', { id: s.id, name: 'Deps' })
  const out = await rig.cli('schedule', 'copy', s.id)
  assert.equal(out.code, 0, out.err)
  assert.match(out.out, /off .*\n\(a copy of \w+: off until laki schedule on \w+\)/)
  assert.ok((await rig.rpc('state')).schedules.some((x: any) => x.name === 'Deps (copy)'))
  await assert.rejects(rig.rpc('scheduleCopy', { id: 'nope' }), /no scheduled task nope/)
  // an agent's: refused
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id).id
  await assert.rejects(rig.rpc('scheduleCopy', { id: s.id, from: { ws: ws.id, tab } }), /duplicate a scheduled task/)
})
