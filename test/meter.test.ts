// The meters (meters.ts' meterTick, share.ts' meterOf): each claude and codex tab's context, from its transcript read on as
// it grows, and what its chat used, tokens and ≈ cost by shared/types.ts' PRICES; today's kept in usage-today.json.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { dayOf, meterNew, meterOf } from '../src/daemon/share.ts'
import { costOf } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

const line = (o: object) => `${JSON.stringify(o)}\n`
const now = Date.parse('2026-10-21T12:00:00Z')
const at = (h: number) => new Date(now - h * 3600e3).toISOString()
// a claude answer: its id, model, usage; more: isSidechain…
const said = (id: string, model: string, u: object, h = 0, more = {}) => line({ type: 'assistant', timestamp: at(h), message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: u }, ...more })
const tokenCount = (total: object, last: object, h = 0) => line({ type: 'event_msg', timestamp: at(h), payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last, model_context_window: 272000 } } })

test('meter: prices by model family; an unknown model has none', () => {
  assert.equal(costOf('claude-opus-4-1-20250805', { input: 1e6, output: 0 }), 15)
  assert.equal(costOf('claude-opus-4-6', { input: 0, output: 1e6 }), 25)
  assert.equal(costOf('claude-opus-5-5', { input: 1e6, output: 1e6, write: 1e6, read: 1e6 }), 4 + 20 + 5 + 0.2)
  assert.equal(costOf('claude-sonnet-4-5-20250929', { input: 1e6, output: 0, read: 1e6 }), 3.3)
  assert.equal(costOf('claude-sonnet-5-5', { input: 1e6, output: 0 }), 2)
  assert.equal(costOf('claude-haiku-4-5-20251001', { input: 0, output: 1e6 }), 5)
  assert.equal(costOf('gpt-5-codex', { input: 1e6, output: 1e6, read: 1e6 }), 1.25 + 10 + 0.125)
  assert.equal(costOf('gpt-5.1-codex-mini', { input: 1e6, output: 0 }), 0.25)
  assert.equal(costOf('some-new-model', { input: 1e6, output: 1e6 }), undefined)
  assert.equal(costOf(undefined, { input: 1, output: 1 }), undefined)
})

test("meter: claude's context is the last answer's prompt; tokens summed once per answer, today's apart", () => {
  const m = meterNew(now)
  const u = (input: number, write: number, read: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output })
  meterOf(
    'claude',
    line({ type: 'user', timestamp: at(0), message: { role: 'user', content: 'go' } }) +
      said('m0', 'claude-sonnet-4-5', u(1000, 0, 0, 1000), 48) + // two days ago: in the chat's, not today's
      said('m1', 'claude-sonnet-4-5', u(10, 2000, 0, 5)) + // an answer's first block…
      said('m1', 'claude-sonnet-4-5', u(10, 2000, 0, 300)) + // …and its last, with all of its output: counted once
      said('s1', 'claude-haiku-4-5', u(50000, 0, 0, 100), 0, { isSidechain: true }) + // a subagent's: tokens, not this context
      said('m2', '<synthetic>', u(0, 0, 0, 0)) +
      'not json\n',
    m,
    now,
  )
  meterOf('claude', said('m3', 'claude-sonnet-4-5', u(20, 500, 140000, 400)), m, now) // read on: the next part
  assert.equal(m.used, 20 + 500 + 140000)
  assert.equal(m.tokens, 2000 + (10 + 2000 + 300) + 50100 + (20 + 500 + 140000 + 400))
  assert.deepEqual(m.today.tokens, m.tokens - 2000)
  const cost = (3 * 1000 + 15 * 1000 + 3 * 10 + 3.75 * 2000 + 15 * 300 + 1 * 50000 + 5 * 100 + 3 * 20 + 3.75 * 500 + 0.3 * 140000 + 15 * 400) / 1e6
  assert.ok(Math.abs(m.cost - cost) < 1e-9, `${m.cost} ≠ ${cost}`)
  assert.ok(m.priced)
  assert.equal(m.max, undefined, "claude's transcript doesn't say its window")
  // an unknown model: tokens, no price
  const n = meterOf('claude', said('x', 'claude-next-1', u(1, 0, 0, 1)), meterNew(now), now)
  assert.deepEqual([n.tokens, n.cost, n.priced], [2, 0, undefined])
  // a new day: today's starts over, the chat's goes on
  meterOf('claude', said('m4', 'claude-sonnet-4-5', u(1, 0, 0, 1), -24), m, now + 24 * 3600e3)
  assert.deepEqual([m.today.tokens, m.day], [2, dayOf(now + 24 * 3600e3)])
})

test("meter: codex's context is its last token_count against its window; tokens what its totals grew by", () => {
  const m = meterNew(now)
  const t = (input: number, cached: number, output: number) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output })
  meterOf(
    'codex',
    line({ type: 'session_meta', timestamp: at(0), payload: { id: 'th' } }) +
      line({ type: 'turn_context', timestamp: at(0), payload: { model: 'gpt-5-codex' } }) +
      tokenCount(t(10000, 0, 500), t(10000, 0, 500)) +
      tokenCount(t(10000, 0, 500), t(10000, 0, 500)) + // a rate limit's update: the same totals
      line({ type: 'event_msg', timestamp: at(0), payload: { type: 'token_count', info: null } }),
    m,
    now,
  )
  meterOf('codex', tokenCount(t(30000, 9000, 900), t(20000, 9000, 400)), m, now)
  assert.deepEqual([m.used, m.max, m.tokens, m.today.tokens], [20400, 272000, 30900, 30900])
  const cost = (1.25 * (30000 - 9000) + 0.125 * 9000 + 10 * 900) / 1e6
  assert.ok(Math.abs(m.cost - cost) < 1e-9, `${m.cost} ≠ ${cost}`)
})

test("meter: a tab's view has its context and usage, read on as the transcript grows; today's kept for a restart", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  // its chat's transcript where claude keeps it ($HOME/.claude: the rig's), then the chat (a /clear's SessionStart)
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-1.jsonl')
  const u = (read: number, output: number) => ({ input_tokens: 100, cache_creation_input_tokens: 1900, cache_read_input_tokens: read, output_tokens: output })
  const stamp = () => new Date().toISOString()
  writeFileSync(file, line({ type: 'assistant', timestamp: stamp(), message: { id: 'a', model: 'claude-opus-4-6', usage: u(140000, 1000) } }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-1' } })
  const v = await until(async () => (x => x?.context && x)(await rig.tab(ws.id)), 'the meter')
  assert.deepEqual(v.context, { used: 142000, max: 200000 })
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4 // the view's cost: to a hundredth of a cent
  assert.deepEqual(v.usage, { tokens: 143000, cost: r4((5 * 100 + 6.25 * 1900 + 0.5 * 140000 + 25 * 1000) / 1e6) })
  // claude's own settings make it opus[1m]: a 1M window (its transcript says only claude-opus-…)
  const own = join(rig.home, '.claude/settings.json')
  writeFileSync(own, JSON.stringify({ model: 'opus[1m]' }))
  await until(async () => (await rig.tab(ws.id))?.context?.max === 1e6, 'the 1M window')
  rmSync(own)
  // read on (a half-written line waits for its end); past 200K the window is 1M
  appendFileSync(file, line({ type: 'assistant', timestamp: stamp(), message: { id: 'b', model: 'claude-opus-4-6', usage: u(300000, 2000) } }) + '{"type":"assistant","mess')
  const w = await until(async () => (x => x?.context?.used > 142000 && x)(await rig.tab(ws.id)), 'the next answer')
  assert.deepEqual(w.context, { used: 302000, max: 1e6 })
  assert.equal(w.usage.tokens, 143000 + 304000)
  const today = (await rig.rpc('state')).today
  assert.deepEqual([today.tokens, today.ws.map((x: any) => x.ws)], [447000, [ws.id]])
  assert.deepEqual(JSON.parse(readFileSync(join(rig.data, 'usage-today.json'), 'utf8')).chats['chat-1'].tokens, 447000)

  // codex: its rollout under $HOME/.codex/sessions, the window its own
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  const day = join(rig.home, '.codex/sessions/2026/10/21')
  mkdirSync(day, { recursive: true })
  const total = { input_tokens: 50000, cached_input_tokens: 40000, output_tokens: 1000, total_tokens: 51000 }
  writeFileSync(join(day, 'rollout-2026-10-21T12-00-00-thread-9.jsonl'), line({ type: 'turn_context', timestamp: stamp(), payload: { model: 'gpt-5-codex' } }) + line({ type: 'event_msg', timestamp: stamp(), payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: total, model_context_window: 272000 } } }))
  await rig.rpc('hook', { tab: cx.id, state: 'start', payload: { session_id: 'thread-9' } })
  const c = await until(async () => (x => x?.context && x)((await rig.rpc('state')).tabs.find((x: any) => x.id === cx.id)), 'codex’s meter')
  assert.deepEqual(c.context, { used: 51000, max: 272000 })
  assert.deepEqual(c.usage, { tokens: 51000, cost: r4((1.25 * 10000 + 0.125 * 40000 + 10 * 1000) / 1e6) })

  // a shell: none
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  const s = (await rig.rpc('state')).tabs.find((x: any) => x.id === sh.id)
  assert.deepEqual([s.context, s.usage], [undefined, undefined])

  // a restart reads each chat anew: today's counts it once
  await rig.stop()
  await rig.start()
  await until(async () => (x => x?.context && x)(await rig.tab(ws.id)), 'the meter again')
  await until(async () => (await rig.rpc('state')).today?.tokens === 447000 + 51000, 'today’s, once')
})
