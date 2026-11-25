// #P1: the remote page's service worker swaps in a new list only when every file it fetched matches (shared/pins.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pinDecide } from '../src/shared/pins.ts'

test("pinDecide: the same hashes swap; one that differs: keep the old cache and report it; one that didn't come: keep it, no report", () => {
  const want = { '/': 'aaa=', '/assets/index-1.js': 'bbb=', '/assets/index-1.css': 'ccc=' }
  assert.deepEqual(pinDecide(want, { ...want }), { swap: true, bad: [], missing: [] })
  assert.deepEqual(pinDecide(want, { ...want, '/assets/index-1.js': 'evil=' }), { swap: false, bad: ['/assets/index-1.js'], missing: [] })
  assert.deepEqual(pinDecide(want, { '/': 'aaa=', '/assets/index-1.css': 'ccc=' }), { swap: false, bad: [], missing: ['/assets/index-1.js'] }, "one that didn't come: kept, not reported")
  assert.deepEqual(pinDecide({}, {}), { swap: true, bad: [], missing: [] })
  // as the worker gets it: its source alone, nothing from outside
  const inWorker = new Function(`return (${pinDecide.toString()})`)() as typeof pinDecide
  assert.deepEqual(inWorker(want, { ...want, '/': 'x' }), { swap: false, bad: ['/'], missing: [] })
})
