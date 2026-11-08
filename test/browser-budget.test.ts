// Settings › Resources' memory budget (shared/browserBudget.ts): which hidden Browsers page goes, and which never do.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unloadStep } from '../src/shared/browserBudget.ts'

const rig = (o: { kb?: number; current?: string; held?: Record<string, string>; pages?: string[] } = {}) => {
  const pages = o.pages ?? ['a', 'b', 'c', 'd', 'e'] // a, oldest
  const asked: string[] = []
  const names = new Map(pages.map((p, i) => [i + 1, p]))
  return {
    asked,
    args: { budgetMb: 2048, guests: new Map(pages.map((p, i) => [p, i + 1])), used: new Map(pages.map((p, i) => [p, i * 1000])), current: () => o.current ?? 'e', mem: async () => ({ kb: o.kb ?? 3 << 20 }), guard: async (id: number) => (asked.push(names.get(id)!), o.held?.[names.get(id)!]) },
  }
}

test('under budget: nothing goes, nothing is asked', async () => {
  const r = rig({ kb: 1 << 20 })
  assert.deepEqual(await unloadStep(r.args), { kb: 1 << 20, over: false, held: [] })
  assert.deepEqual(r.asked, [])
})

test('over budget: the oldest hidden page goes, one a step', async () => {
  const r = rig()
  const u = await unloadStep(r.args)
  assert.equal(u.unload, 'a')
  assert.deepEqual(r.asked, ['a'])
})

test('never the page you are on, nor the last used', async () => {
  const r = rig({ pages: ['a', 'b'], current: 'a' })
  const u = await unloadStep(r.args)
  assert.equal(u.unload, undefined)
  assert.deepEqual(r.asked, [])
  const on = rig({ current: 'a' }) // you went back to the oldest: it stays, and the next one goes
  assert.equal((await unloadStep(on.args)).unload, 'b')
})

test('a held page is passed over and said; every one held: none goes', async () => {
  const one = rig({ held: { a: 'is playing' } })
  const u = await unloadStep(one.args)
  assert.equal(u.unload, 'b')
  assert.deepEqual(u.held, [{ ws: 'a', why: 'is playing' }])
  const all = await unloadStep(rig({ held: { a: 'is playing', b: 'has form edits', c: 'is downloading' } }).args)
  assert.equal(all.unload, undefined)
  assert.equal(all.over, true)
  assert.equal(all.held.length, 3)
})

test('a guard that fails holds the page; you moving to it during the check saves it', async () => {
  const r = rig()
  const bad = await unloadStep({ ...r.args, guard: async () => { throw new Error('gone') } })
  assert.equal(bad.unload, undefined)
  assert.equal(bad.held.length, 3)
  let now = 'e'
  const moved = rig()
  const u = await unloadStep({ ...moved.args, current: () => now, guard: async () => ((now = 'a'), undefined) })
  assert.notEqual(u.unload, 'a')
})

test('no answer from main: nothing goes', async () => {
  const r = rig()
  assert.equal((await unloadStep({ ...r.args, mem: async () => null })).unload, undefined)
})
