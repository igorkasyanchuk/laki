// Q2: the talk key's pill: who a recording goes to by default, Tab's next, the time it shows (shared/talk.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { talkDefault, talkName, talkNext, talkTime, type TalkTo } from '../src/shared/talk.ts'

const list: TalkTo[] = [
  { tab: 'a', name: 'checkout-flow', status: 'running' },
  { tab: 'b', name: 'fix-cart', status: 'waiting', at: 100 },
  { tab: 'c', name: 'dark-mode', status: 'waiting', at: 300 },
  { tab: 'd', name: 'docs', status: 'idle' },
]

test('Q2: the default: the agent that asked last, else the one last sent to while it is there, else a new task', () => {
  assert.equal(talkDefault(list, 'a'), 'c', 'the newest ask, over the last sent')
  const none = list.map(f => ({ ...f, status: 'running' }))
  assert.equal(talkDefault(none, 'd'), 'd')
  assert.equal(talkDefault(none, 'gone'), '', 'one gone since: a new task')
  assert.equal(talkDefault(none), '')
  assert.equal(talkDefault([]), '')
})

test("Q2: Tab goes round the agents, then a new task; ⇧Tab back; a name and the time", () => {
  assert.equal(talkNext(list, 'a'), 'b')
  assert.equal(talkNext(list, 'd'), '', 'a new task after the last')
  assert.equal(talkNext(list, ''), 'a', 'round')
  assert.equal(talkNext(list, 'a', true), '')
  assert.equal(talkNext(list, 'gone'), 'b', 'one gone: from the first')
  assert.equal(talkName(list, 'c'), 'dark-mode')
  assert.equal(talkName(list, ''), 'new task')
  assert.deepEqual([0, 7000, 62000, 600500].map(talkTime), ['0:00', '0:07', '1:02', '10:00'])
})
