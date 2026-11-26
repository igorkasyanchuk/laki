// A row's swipe (renderer swipe.ts), its state machine with made-up deltas: below the first threshold nothing, past it
// the first action, past the second the second (left only), an up-and-down move ignored, a drag cancelling it
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Swipe, swipeAct, swipeMove, swipeShown, SWIPE_ARM, SWIPE_ARM2 } from '../src/renderer/src/swipe.ts'

const all = { left: () => {}, left2: () => {}, right: () => {} }
const go = (...d: [number, number][]) => d.reduce<Swipe>((s, [x, y]) => swipeMove(s, x, y), { dx: 0, dy: 0 })

test('swipe: below, first and second threshold', () => {
  assert.equal(swipeAct(go([-30, 0], [-30, 0]), all), undefined, '60px: short of the first')
  assert.equal(swipeAct(go([-30, 0], [-40, 0]), all), 'left', `${SWIPE_ARM}px left: Snooze`)
  assert.equal(swipeAct(go([-100, 0], [-70, 0]), all), 'left2', `${SWIPE_ARM2}px left: Archive`)
  assert.equal(swipeAct(go([40, 0], [40, 0]), all), 'right', 'right: Seen')
  assert.equal(swipeAct(go([100, 0], [100, 0]), all), 'right', 'no second on the right')
  assert.equal(swipeAct(go([-200, 0]), { left2: all.left2 }), 'left2', 'only Archive: past the second')
  assert.equal(swipeAct(go([-100, 0]), { left2: all.left2 }), undefined, 'only Archive: the first arms nothing')
  assert.equal(swipeAct(go([-100, 0]), { right: all.right }), undefined, 'no left action: nothing')
})

test('swipe: an up-and-down move is ignored', () => {
  const s = go([2, 8], [3, 12])
  assert.equal(s.lock, 'y')
  assert.equal(swipeAct(go([2, 8], [3, 12], [-200, 0]), all), undefined, 'settled as a scroll: no swipe after')
  assert.equal(go([4, 3]).lock, undefined, 'under 10px: not settled yet')
})

test('swipe: a drag in progress cancels it', () => {
  assert.equal(swipeAct(go([-100, 0]), all, true), undefined)
})

test('swipe: drawn as far as its actions, a little past', () => {
  assert.equal(swipeShown(-500, all), -(SWIPE_ARM2 + 40))
  assert.equal(swipeShown(-500, { left: all.left }), -(SWIPE_ARM + 40))
  assert.equal(swipeShown(500, { left: all.left }), 0)
  assert.equal(swipeShown(-30, all), -30)
})
