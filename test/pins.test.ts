// #P1: the remote page's service worker swaps in a new list only when every file it fetched matches (shared/pins.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pinDecide } from '../src/shared/pins.ts'

test('pinDecide: the same hashes swap; one differs or is missing: keep the old cache and report it', () => {
  const want = { '/': 'aaa=', '/assets/index-1.js': 'bbb=', '/assets/index-1.css': 'ccc=' }
  assert.deepEqual(pinDecide(want, { ...want }), { swap: true, bad: [] })
  assert.deepEqual(pinDecide(want, { ...want, '/assets/index-1.js': 'evil=' }), { swap: false, bad: ['/assets/index-1.js'] })
  assert.deepEqual(pinDecide(want, { '/': 'aaa=', '/assets/index-1.css': 'ccc=' }), { swap: false, bad: ['/assets/index-1.js'] }, "one that didn't come")
  assert.deepEqual(pinDecide({}, {}), { swap: true, bad: [] })
  // as the worker gets it: its source alone, nothing from outside
  const inWorker = new Function(`return (${pinDecide.toString()})`)() as typeof pinDecide
  assert.deepEqual(inWorker(want, { ...want, '/': 'x' }), { swap: false, bad: ['/'] })
})
