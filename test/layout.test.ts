import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupsOf, keep, move, place, resize, tabsOf } from '../src/renderer/src/layout.ts'

test('tabs of panes: sessions in no tab get one, moving splits and merges, nothing nests', () => {
  let g = groupsOf(undefined, ['a', 'b', 'c'])
  assert.deepEqual(g, [{ tab: 'a' }, { tab: 'b' }, { tab: 'c' }])
  g = move(g, 'b', true, { pane: 'a', edge: 'right' }) // tab b into tab a, on the right
  assert.deepEqual(g, [{ dir: 'row', a: { tab: 'a' }, b: { tab: 'b' }, at: 0.5 }, { tab: 'c' }])
  g = move(g, 'c', true, { pane: 'a', edge: 'bottom' })
  assert.equal(g.length, 1)
  assert.deepEqual(tabsOf(g[0]), ['a', 'c', 'b'])
  assert.equal(move(g, 'a', true, { pane: 'b', edge: 'left' }), g) // a tab onto its own pane: nothing
  const moved = move(g, 'b', false, { pane: 'c', edge: 'top' }) // one pane within its tab
  assert.deepEqual(tabsOf(moved[0]), ['a', 'b', 'c'])
  const out = move(g, 'c', false, 'bar') // a pane out into its own tab, right after
  assert.deepEqual(out.map(tabsOf), [['a', 'b'], ['c']])
  assert.equal(move(out, 'c', false, 'bar'), out) // already alone
  // ended sessions drop out; new ones get their own tab; a session is never in two tabs
  assert.deepEqual(groupsOf([g[0], { tab: 'a' }], ['a', 'c', 'd']).map(tabsOf), [['a', 'c'], ['d']])
  assert.equal(keep(g[0], () => false), null)
  assert.equal((resize(g[0], '', 2) as { at: number }).at, 0.9) // clamped
  const { panes, bars } = place(resize(g[0], 'a', 0.25))
  assert.deepEqual(panes.find(p => p.tab === 'c')!.box, { x: 0, y: 0.25, w: 0.5, h: 0.75 })
  assert.equal(bars.length, 2)
})
