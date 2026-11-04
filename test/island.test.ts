// The bubbles' island (floaterAt notch) and replies from the bubbles: shared/island.ts' pure parts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardQueue, cardRect, DONE_FOLD, dotsText, fullScreen, hasNotch, islandDisplay, lifeStep, NOTCH, pillRect, plainLines, replyOf, tookText, WING } from '../src/shared/island.ts'

// a MacBook's built-in screen (a 38-point menu bar around its notch), an external one (24), one with a full-screen app
const macbook = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 }, internal: true }
const external = { bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 24, width: 2560, height: 1416 }, internal: false }
const fullApp = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 0, width: 1512, height: 982 }, internal: true }

test('island: a notch from the menu bar, the pill in it or under the menu bar, the card under the pill', () => {
  assert.equal(hasNotch(macbook), true)
  assert.equal(hasNotch(external), false)
  assert.equal(hasNotch({ ...macbook, internal: false }), false) // only the built-in screen has one
  assert.equal(hasNotch({ ...macbook, workArea: { ...macbook.workArea, y: 24 } }), false) // an older MacBook: a plain menu bar
  assert.equal(fullScreen(fullApp), true)
  assert.equal(fullScreen(macbook), false)
  assert.equal(islandDisplay([external, macbook], external), macbook) // the built-in one first
  assert.equal(islandDisplay([external], external), external) // else the main one
  const p = pillRect(macbook)
  assert.deepEqual(p, { x: Math.round(756 - (NOTCH + 2 * WING) / 2), y: 0, width: NOTCH + 2 * WING, height: 38 })
  const q = pillRect(external)
  assert.equal(q.y, 24) // under the menu bar
  assert.equal(q.x + q.width / 2, 1512 + 1280) // centered
  const c = cardRect(p, 180)
  assert.equal(c.width, 400)
  assert.equal(c.x + c.width / 2, p.x + p.width / 2)
  assert.equal(c.y, p.y + p.height + 4)
})

test('island: asks first, then finished ones, each newest first; the dots', () => {
  const items = [
    { tab: 'a', status: 'done', at: 1 },
    { tab: 'b', status: 'waiting', at: 2 },
    { tab: 'c', status: 'running' },
    { tab: 'd', status: 'done', at: 5 },
    { tab: 'e', status: 'waiting', at: 4 },
    { tab: 'f', status: 'idle', at: 9 },
  ]
  assert.deepEqual(cardQueue(items).map(x => x.tab), ['e', 'b', 'd', 'a'])
  assert.equal(dotsText(0, 3), '1 of 3')
  assert.equal(dotsText(0, 1), '')
})

test('island: an ask never folds by time; a finished one at 6 s, held while the pointer is on it, folded as it leaves', () => {
  const ask = { kind: 'ask' as const, shownAt: 0, over: false, touched: false }
  assert.equal(lifeStep(ask, 'tick', 3600e3).fold, false)
  assert.equal(lifeStep(lifeStep(ask, 'enter', 1).life, 'leave', 2).fold, false) // stays until you answer
  assert.equal(lifeStep(ask, 'esc', 1).fold, true)
  const done = { kind: 'done' as const, shownAt: 0, over: false, touched: false }
  assert.equal(lifeStep(done, 'tick', DONE_FOLD - 1).fold, false)
  assert.equal(lifeStep(done, 'tick', DONE_FOLD).fold, true)
  const held = lifeStep(done, 'enter', 100).life
  assert.equal(lifeStep(held, 'tick', 60e3).fold, false) // hover holds it
  assert.equal(lifeStep(held, 'leave', 60e3).fold, true) // leaving after a hover folds it
  assert.equal(lifeStep(done, 'leave', 10).fold, false) // never on it: its time decides
})

test("a reply's words: the answer's first lines as plain text, how long the turn took, options or text", () => {
  const md = '## Done\n\nAdded **14 tests** for `/auth`, all green.\n- Opened [PR #212](https://github.com/o/r/pull/212).\n```ts\ncode()\n```\nMore'
  assert.deepEqual(plainLines(md, 3), ['Done', 'Added 14 tests for /auth, all green.', 'Opened PR #212.'])
  assert.deepEqual(plainLines(undefined), [])
  // emphasis goes; underscores inside a word stay
  assert.deepEqual(plainLines('Fixed parse_line_end in test_utils.py, _really_ **now**'), ['Fixed parse_line_end in test_utils.py, really now'])
  assert.equal(plainLines('x'.repeat(400), 1)[0].length, 160)
  assert.equal(tookText(252e3), '4m 12s')
  assert.equal(tookText(9e3), '9s')
  assert.equal(tookText(3700e3), '1h 1m')
  assert.equal(tookText(undefined), '')
  assert.equal(replyOf({ status: 'waiting', ask: { options: [{}, {}] } }), 'options') // typed keys would pick one
  assert.equal(replyOf({ status: 'waiting' }), 'text')
  assert.equal(replyOf({ status: 'done' }), 'text')
})
