// Q2: the talk key's pill: who a recording goes to by default, Tab's next, the time it shows (shared/talk.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { routeOf, type RouteTab, talkDefault, talkName, talkNext, talkTime, type TalkTo } from '../src/shared/talk.ts'
import { voiceFix } from '../src/shared/types.ts'

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

// Q5: a dictation routed by its first words
const tabs: RouteTab[] = [
  { tab: 't1', name: 'checkout-flow', status: 'running', project: 'shop', alias: 'pay' },
  { tab: 't2', name: 'dark-mode', status: 'idle', project: 'site' },
  { tab: 't3', name: 'оплата', status: 'idle', project: 'shop' },
]
const projects = [{ id: 'shop', name: 'Shop' }, { id: 'site', name: 'Landing site' }]
const route = (text: string, more = {}) => routeOf(text, { tabs, projects, aiOn: true, ...more })

test('Q5: each rule: Laki AI, a new task (in a project), a workspace, an @name; the address left out', () => {
  assert.deepEqual(route('Laki, what are my agents doing?'), { target: { kind: 'ai' }, rest: 'what are my agents doing?', how: 'Laki AI' })
  assert.deepEqual(route('Jarvis: stop them', { aiWord: 'Jarvis' }).target, { kind: 'ai' }, 'the word set for it')
  assert.deepEqual(route('Laki, hi', { aiOn: false }).target, { kind: 'default' }, 'Laki AI off: no route')
  assert.deepEqual(route('New task: add a dark mode toggle'), { target: { kind: 'new' }, rest: 'add a dark mode toggle', how: 'a new task' })
  assert.deepEqual(route('New task in landing site, fix the header').target, { kind: 'new', project: 'site' })
  assert.deepEqual(route('new task in nowhere, fix it').target, { kind: 'default' }, 'no such project: not a guess')
  assert.deepEqual(route('Checkout flow, fix the button'), { target: { kind: 'tab', tab: 't1' }, rest: 'fix the button', how: 'checkout-flow' })
  assert.deepEqual(route('Check out flow — fix the button').target, { kind: 'tab', tab: 't1' }, 'spaces left out')
  assert.deepEqual(route('Checkot flow. Fix the button').target, { kind: 'tab', tab: 't1' }, 'a letter off; a sentence end is a pause')
  assert.deepEqual(route('Dark mod... make it darker').target, { kind: 'tab', tab: 't2' })
  assert.deepEqual(route('at pay, retry the charge').target, { kind: 'tab', tab: 't1' }, 'its @name said aloud')
  assert.deepEqual(route('@pay: retry').target, { kind: 'tab', tab: 't1' })
  assert.deepEqual(route('Оплата, додай кнопку').target, { kind: 'tab', tab: 't3' }, 'a name in another script, as written')
  assert.deepEqual(route('oplata, add a button').target, { kind: 'tab', tab: 't3' }, 'and transliterated')
})

test('Q5: near misses and limits: no pause after it, more than 4 words, two it could be; word fixes first; empty rest', () => {
  assert.deepEqual(route('check out the cart and fix the total'), { target: { kind: 'default' }, rest: 'check out the cart and fix the total', how: '' })
  assert.deepEqual(route('Check out the cart.').target, { kind: 'default' }, 'not its name')
  assert.deepEqual(route('Checkout flow fix the button').target, { kind: 'default' }, 'no pause after the name')
  assert.deepEqual(route('please could you check the checkout flow, then fix it').target, { kind: 'default' }, 'past the first 4 words')
  const twins = [...tabs, { tab: 't4', name: 'checkout-flow', status: 'idle', project: 'site' }]
  assert.deepEqual(routeOf('Checkout flow, fix it', { tabs: twins, projects }).target, { kind: 'default' }, 'two of that name: not a guess')
  assert.deepEqual(route('Lucky, how is it going', { fixes: 'lucky → Laki', fix: voiceFix }).target, { kind: 'ai' }, 'word fixes first')
  assert.deepEqual(route('Checkout flow.'), { target: { kind: 'tab', tab: 't1' }, rest: '', how: 'checkout-flow' }, 'nothing after it: the caller says so')
  assert.deepEqual(route('').target, { kind: 'default' })
})
