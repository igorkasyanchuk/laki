import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drop, keep, place, resize, show, tabsOf } from '../src/renderer/src/layout.ts'

test('panes: drop splits or replaces, close collapses, show swaps the focused pane', () => {
  let l = drop({ tab: 'a' }, 'b', 'a', 'right')!
  assert.deepEqual(l, { dir: 'row', a: { tab: 'a' }, b: { tab: 'b' }, at: 0.5 })
  l = drop(l, 'c', 'a', 'bottom')! // c under a
  assert.deepEqual(tabsOf(l), ['a', 'c', 'b'])
  assert.deepEqual(drop(l, 'b', 'c', 'top'), { dir: 'col', a: { tab: 'a' }, b: { dir: 'col', a: { tab: 'b' }, b: { tab: 'c' }, at: 0.5 }, at: 0.5 }) // moved, not copied
  assert.deepEqual(tabsOf(drop(l, 'd', 'b', 'center')), ['a', 'c', 'd'])
  assert.equal(drop(l, 'a', 'a', 'left'), l) // onto itself: nothing
  assert.deepEqual(keep(l, t => t !== 'a'), { dir: 'row', a: { tab: 'c' }, b: { tab: 'b' }, at: 0.5 })
  assert.equal(keep(l, () => false), null)
  assert.deepEqual(tabsOf(show(l, 'x', 'c')), ['a', 'x', 'b'])
  assert.equal(show(l, 'b', 'c'), l) // already on screen
  assert.deepEqual(show(null, 'x'), { tab: 'x' })
  assert.equal((resize(l, '', 2) as { at: number }).at, 0.9) // clamped
  const { panes, bars } = place(resize(l, 'a', 0.25))
  assert.deepEqual(panes.find(p => p.tab === 'c')!.box, { x: 0, y: 0.25, w: 0.5, h: 0.75 })
  assert.equal(bars.length, 2)
})
