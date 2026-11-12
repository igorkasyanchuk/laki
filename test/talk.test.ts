// Q2: the talk key's pill: who a recording goes to by default, Tab's next, the time it shows (shared/talk.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AI_TO, routeOf, type RouteTab, talkDefault, talkName, talkNext, talkShot, talkTime, type TalkTo } from '../src/shared/talk.ts'
import { voicePrice } from '../src/shared/types.ts'
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
  assert.equal(talkName(list, AI_TO), 'Laki AI')
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
  const short = [{ tab: 'u', name: 'ui', status: 'idle' }]
  assert.deepEqual(routeOf('Hi, rename the button', { tabs: short, projects }).target, { kind: 'default' }, 'a short name only as it is')
  assert.deepEqual(routeOf('UI, rename the button', { tabs: short, projects }).target, { kind: 'tab', tab: 'u' })
  assert.deepEqual(route('Lucky, how is it going', { fixes: 'lucky → Laki', fix: voiceFix }).target, { kind: 'ai' }, 'word fixes first')
  assert.deepEqual(route('Checkout flow.'), { target: { kind: 'tab', tab: 't1' }, rest: '', how: 'checkout-flow' }, 'nothing after it: the caller says so')
  assert.deepEqual(route('').target, { kind: 'default' })
})

// Q10: the talk key to Laki AI: Tab reaches it, words that ask for the screen take it along; "Laki AI" as heard
test('Q10: Tab goes on to Laki AI while it is on; screen words in a few languages; Laki AI said or misheard', () => {
  const list: TalkTo[] = [{ tab: 'a', name: 'one', status: 'idle' }]
  assert.deepEqual([talkNext(list, '', false, true), talkNext(list, AI_TO, false, true), talkNext(list, 'a', true, true)], [AI_TO, 'a', AI_TO], 'after a new task; then round; back from the first')
  assert.equal(talkNext(list, '', false, false), 'a', 'off: never Laki AI')
  for (const s of ['take a screenshot of this', 'what is on my screen?', 'Look at the screen shot', 'зроби скріншот', 'що на екрані', 'сделай скриншот', 'was ist auf dem Bildschirm', 'zrób zrzut ekranu'])
    assert.equal(talkShot(s), true, s)
  for (const s of ['make the button blue', 'start a task in shop', 'скажи привіт', 'fix the fullscreen button', 'add a screening step', 'додай екранування лапок', 'the screens folder', 'turn on the screen reader', 'check the screen recording permission', 'add a скрининг step'])
    assert.equal(talkShot(s), false, s)
  for (const said of ['Laki AI, start a task', 'Lucky AI, start a task', 'Lucky, start a task', 'Лакі, start a task', 'Laki A.I., start a task', 'Lackey AI: start a task'])
    assert.deepEqual(route(said), { target: { kind: 'ai' }, rest: 'start a task', how: 'Laki AI' }, said)
  assert.deepEqual(route('Lucky AI, hi', { aiWord: 'Jarvis' }).target, { kind: 'default' }, 'another word set: only it')
  assert.deepEqual(route('Jarvis AI, hi', { aiWord: 'Jarvis' }).target, { kind: 'ai' }, 'its word with AI after it')
  assert.deepEqual(route('Lucky AI, hi', { aiOn: false }).target, { kind: 'default' })
})

// Q11: a speech-to-text model's price from OpenRouter's pricing
test("Q11: prices: per second as an hour's, Microsoft's per hour as it is, by the token, free; junk none", () => {
  assert.equal(voicePrice({ prompt: '0.0000166667', completion: '0' }), '$0.06/h')
  assert.equal(voicePrice({ prompt: '0.00000333', completion: '0' }), '$0.012/h')
  assert.equal(voicePrice({ prompt: '0.0000716666666667' }), '$0.26/h')
  assert.equal(voicePrice({ prompt: '0.1', completion: '0' }), '$0.10/h', "MAI's: an hour's already")
  assert.equal(voicePrice({ prompt: '0.36', completion: '0' }), '$0.36/h')
  assert.equal(voicePrice({ prompt: '0.0000025', completion: '0.00001' }), '$2.50 / $10 per M tokens')
  assert.equal(voicePrice({ prompt: '0.00000125', completion: '0.000005' }), '$1.25 / $5 per M tokens', 'whole dollars plain; floats rounded first')
  assert.equal(voicePrice({ prompt: '0.000002', completion: '0.0000125' }), '$2 / $12.50 per M tokens')
  assert.equal(voicePrice({ prompt: '0', completion: '0' }), 'free')
  for (const p of [undefined, {}, { prompt: '' }, { prompt: 'x' }, { prompt: '-1' }, { prompt: '0.1', completion: 'NaN' }]) assert.equal(voicePrice(p), undefined, JSON.stringify(p))
})

test('Q6: Fn: held opens and its release inserts; two quick taps lock, the next press stops; a slow second tap, another key, a blur', async () => {
  const { fnStep, FN0, HOLD_MS, TAP2_MS } = await import('../src/shared/talk.ts')
  type Ev = Parameters<typeof fnStep>[1]
  // events at fake times; each step's action, '' left out
  const run = (evs: [Ev, number][], lock = true, other = false) => {
    let s = FN0
    const out: string[] = []
    for (const [e, t] of evs) {
      const [n, d] = fnStep(s, e, t, lock, other)
      s = n
      if (d) out.push(`${d}@${t}`)
    }
    return { out, s }
  }
  // hold: down, the timer, up
  assert.deepEqual(run([['down', 0], ['held', HOLD_MS], ['up', 900]]).out, ['open@200', 'insert@900'])
  // a single tap: nothing
  assert.deepEqual(run([['down', 0], ['up', 80]]).out, [])
  // double tap: locked (the second press within TAP2_MS of the first's release), recording on after the release
  const two = run([['down', 0], ['up', 80], ['down', 80 + TAP2_MS], ['up', 80 + TAP2_MS + 60]])
  assert.deepEqual(two.out, [`lock@${80 + TAP2_MS + 60}`])
  assert.equal(two.s.locked, true)
  // locked: another key and a blur keep it; the next press stops it, its release does nothing more
  const stop = run([['down', 0], ['up', 80], ['down', 200], ['up', 260], ['key', 1000], ['blur', 2000], ['down', 5000], ['held', 5200], ['up', 5600]])
  assert.deepEqual(stop.out, ['lock@260', 'insert@5000'])
  assert.equal(stop.s.locked, false)
  // too slow a second tap: no lock
  assert.deepEqual(run([['down', 0], ['up', 80], ['down', 80 + TAP2_MS + 1], ['up', 80 + TAP2_MS + 50]]).out, [])
  // a second press held long: a hold, not a lock
  assert.deepEqual(run([['down', 0], ['up', 80], ['down', 200], ['held', 400], ['up', 1500]]).out, ['open@400', 'insert@1500'])
  // a tap then a hold-length press whose timer is late: nothing
  assert.deepEqual(run([['down', 0], ['up', 80], ['down', 200], ['up', 200 + HOLD_MS]]).out, [])
  // Lock by double tap off: two taps are two taps
  assert.deepEqual(run([['down', 0], ['up', 80], ['down', 200], ['up', 260]], false).out, [])
  // another key while held drops it; a blur while held inserts
  assert.deepEqual(run([['down', 0], ['held', 200], ['key', 300], ['up', 400]]).out, ['open@200', 'drop@300'])
  assert.deepEqual(run([['down', 0], ['held', 200], ['blur', 300]]).out, ['open@200', 'insert@300'])
  // a locked one ended by itself (Esc, the cap): Fn after starts afresh, a tap after doesn't stop anything
  assert.deepEqual(run([['down', 0], ['up', 80], ['down', 200], ['up', 260], ['end', 3000], ['down', 4000], ['up', 4050]]).out, ['lock@260'])
  // the recording ended while Fn is held (the mic button): its release does nothing
  assert.deepEqual(run([['down', 0], ['held', 200], ['end', 300], ['up', 400]]).out, ['open@200'])
  // a recording the mic button or a screenshot started: a Fn press stops it and inserts, its hold and release nothing more
  assert.deepEqual(run([['down', 1000], ['held', 1200], ['up', 1600]], true, true).out, ['insert@1000'])
  assert.deepEqual(run([['down', 1000], ['up', 1050]], false, true).out, ['insert@1000'])
})

test('Q6: the level meter: silence 0, a tone in between, clipped at 1; the line when it hears nothing', async () => {
  const { levelOf, FLAT, quietSay } = await import('../src/shared/talk.ts')
  assert.equal(levelOf(new Uint8Array(512).fill(128)), 0)
  const tone = Uint8Array.from({ length: 512 }, (_, i) => 128 + Math.round(10 * Math.sin(i / 4)))
  assert.ok(levelOf(tone) > FLAT && levelOf(tone) < 1)
  assert.equal(levelOf(Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 0 : 255))), 1)
  assert.equal(quietSay('MacBook Pro Microphone'), "I can't hear you: check the input (MacBook Pro Microphone)")
})
