// Safe mode (daemon/safe.ts): three starts in a row that died young turn it on: the view says so with the suspects, a
// due scheduled task doesn't run, Turn everything on runs it; two don't; a clean stop is no death; only you leave it
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const seed = (data: string, starts: object[]) => writeFileSync(join(data, 'starts.json'), JSON.stringify({ starts }))
const runs = async (rig: { rpc: (m: string, p?: object) => Promise<any> }, id: string) => ((await rig.rpc('state')).runs ?? []).filter((r: any) => r.schedule === id)

test('safe mode: three young deaths; a due task waits; Turn everything on runs it; it lasts until you leave it', async t => {
  const rig = await fresh(t, { env: { LAKI_SAFE_TEST: '1' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', name: 'Nightly', prompt: 'nightly', when: 'every day at 2am' })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const from = { ws: one.id, tab: (await until(() => rig.tab(one.id))).id }
  assert.equal((await rig.rpc('state')).safe, undefined)
  await rig.stop()
  const kept = JSON.parse(readFileSync(join(rig.data, 'starts.json'), 'utf8'))
  assert.equal(kept.starts.at(-1).clean, true, 'a clean stop is no death')
  seed(rig.data, [{ at: 1, alive: true }, { at: 2 }, { at: 3, suspects: [{ kind: 'task', id: a.id, name: 'Nightly' }] }, { at: 4 }])
  await rig.start()
  const safe = (await rig.rpc('state')).safe
  assert.deepEqual(safe?.suspects, [{ kind: 'task', id: a.id, name: 'Nightly' }])
  await rig.rpc('scheduleTick', { now: a.next })
  assert.equal((await runs(rig, a.id)).length, 0, "safe mode: a due task doesn't run")
  await assert.rejects(rig.rpc('safeOff', { from }), /it's the user's/)
  // a restart doesn't end it
  await rig.stop()
  await rig.start()
  assert.ok((await rig.rpc('state')).safe, 'still safe after a restart')
  await rig.rpc('safeOff', { now: a.next })
  assert.equal((await rig.rpc('state')).safe, undefined)
  await until(async () => (await runs(rig, a.id)).length === 1, 'Turn everything on: the due task ran')
})

test("safe mode: two young deaths don't turn it on; Turn on without turns the suspect off", async t => {
  const rig = await fresh(t, { env: { LAKI_SAFE_TEST: '1' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('scheduleSet', { project: p.id, preset: 'claude', ws: 'new', name: 'Nightly', prompt: 'nightly', when: 'every day at 2am' })
  await rig.stop()
  seed(rig.data, [{ at: 1, alive: true }, { at: 2 }, { at: 3 }])
  await rig.start()
  assert.equal((await rig.rpc('state')).safe, undefined, 'two young deaths: not safe')
  await rig.stop()
  seed(rig.data, [{ at: 2 }, { at: 3 }, { at: 4 }])
  await rig.start()
  assert.ok((await rig.rpc('state')).safe)
  await rig.rpc('safeOff', { without: { kind: 'task', id: a.id }, now: a.next })
  const v = await rig.rpc('state')
  assert.equal(v.safe, undefined)
  assert.equal(v.schedules.find((s: any) => s.id === a.id).on, false, 'the suspect off')
  assert.equal((await runs(rig, a.id)).length, 0, 'so it never ran')
})
