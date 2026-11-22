// npm test's order (scripts/test-order.ts) and test-report.ts' flaky list without runs on a dirty tree; pure
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { order } from '../scripts/test-order.ts'
import { report, type Run } from '../scripts/test-report.ts'

const run = (file: string, ms: number, o: Partial<Run> = {}): Run => ({ date: '', sha: 'a', file, ms, pass: true, ...o })

test('order: a file with no history first, then the longest median first, ties by name', () => {
  const runs = [run('b', 10), run('b', 30), run('b', 20), run('c', 5), run('d', 20), run('e', 20)]
  assert.deepEqual(order(['e', 'd', 'c', 'b', 'a', 'z'], runs), ['a', 'z', 'b', 'd', 'e', 'c'])
  assert.deepEqual(order(['b', 'a'], []), ['a', 'b'], 'no history: name order')
  assert.deepEqual(order(['x', 'y'], [run('x', 1), run('x', 1), run('x', 100), run('y', 50)], 2), ['x', 'y'], 'the last runs only')
})

test('report: runs on uncommitted changes say nothing of flakiness', () => {
  const runs = [run('f', 1), run('f', 1, { pass: false, failed: ['t'], dirty: true }), run('f', 1)]
  assert.deepEqual(report(runs).flaky, [])
  assert.equal(report(runs.map(r => ({ ...r, dirty: undefined }))).flaky.length, 1, 'the same runs, committed: flaky')
})
