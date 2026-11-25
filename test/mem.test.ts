// npm run mem's comparison (scripts/mem.ts): 10% over its budget allowed, past it fails, a missing budget asks for --write
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { median, memCheck } from '../scripts/mem.ts'

test('memCheck: within 10% passes, over fails, a missing budget is named', () => {
  const budget = { daemon: 100, renderer: 200, ptyhost: 50 }
  assert.deepEqual(memCheck({ daemon: 110, renderer: 150, ptyhost: 55 }, budget), { over: [], missing: [] }, 'exactly 10% over: in')
  assert.deepEqual(memCheck({ daemon: 110.1, renderer: 221, ptyhost: 50 }, budget), { over: ['daemon', 'renderer'], missing: [] })
  assert.deepEqual(memCheck({ daemon: 1, renderer: 1, ptyhost: 1 }, undefined), { over: [], missing: ['daemon', 'renderer', 'ptyhost'] })
  assert.deepEqual(memCheck({ daemon: 999, renderer: 1, ptyhost: 1 }, { renderer: 2, ptyhost: 0 }), { over: [], missing: ['daemon', 'ptyhost'] }, "no budget isn't over it")
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([4, 1, 3, 2]), 2.5)
})
