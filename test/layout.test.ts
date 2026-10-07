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

test('dragging: tabs reordered in the bar, a pane out at an index, center trades places, no-ops return groups', () => {
  const g = groupsOf(undefined, ['a', 'b', 'c'])
  assert.deepEqual(move(g, 'c', true, { bar: 0 }).map(tabsOf), [['c'], ['a'], ['b']])
  assert.deepEqual(move(g, 'a', true, { bar: 3 }).map(tabsOf), [['b'], ['c'], ['a']])
  assert.equal(move(g, 'b', true, { bar: 1 }), g) // before itself
  assert.equal(move(g, 'b', false, { bar: 2 }), g) // after itself: a pane alone moves its tab
  const s = move(g, 'b', true, { pane: 'a', edge: 'right' }) // [a|b], [c]
  assert.deepEqual(move(s, 'b', false, { bar: 0 }).map(tabsOf), [['b'], ['a'], ['c']])
  assert.deepEqual(move(s, 'b', false, { bar: 2 }).map(tabsOf), [['a'], ['c'], ['b']])
  assert.deepEqual(move(s, 'a', false, { pane: 'b', edge: 'center' }), [{ dir: 'row', a: { tab: 'b' }, b: { tab: 'a' }, at: 0.5 }, { tab: 'c' }])
  assert.deepEqual(move(s, 'c', true, { pane: 'a', edge: 'center' }), [{ dir: 'row', a: { tab: 'c' }, b: { tab: 'b' }, at: 0.5 }, { tab: 'a' }])
  assert.equal(move(s, 'a', false, { pane: 'a', edge: 'center' }), s) // onto itself
  assert.equal(move(s, 'a', true, { pane: 'b', edge: 'left' }), s) // its tab onto its own pane
})
