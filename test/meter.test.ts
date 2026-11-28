// The meters (meters.ts' meterTick, share.ts' meterOf): each claude and codex tab's context, from its transcript read on as
// it grows, and what its chat used, tokens and ≈ cost by shared/types.ts' costOf (prices.json, PRICE_OWN); today's kept in
// usage-today.json, each day's in usage-days.json as token parts, priced as they're read.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { dayOf, type Meter, meterCost, meterNew, meterOf } from '../src/daemon/share.ts'
import { costOf, PRICE_OWN, partsOf, partsTokens, pricesDate, priceOf } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

const line = (o: object) => `${JSON.stringify(o)}\n`
const now = Date.parse('2026-10-21T12:00:00Z')
const at = (h: number) => new Date(now - h * 3600e3).toISOString()
// a claude answer: its id, model, usage; more: isSidechain…
const said = (id: string, model: string, u: object, h = 0, more = {}) => line({ type: 'assistant', timestamp: at(h), message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: u }, ...more })
const tokenCount = (total: object, last: object, h = 0) => line({ type: 'event_msg', timestamp: at(h), payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last, model_context_window: 272000 } } })

const near = (a: number | undefined, b: number, what = '') => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${what} ${a} ≠ ${b}`)
const todayOf = (m: Meter, t = now) => Object.values(m.days?.[dayOf(t)] ?? {}).reduce((n, p) => n + partsTokens(p), 0)

test('prices: exact model ids (prices.json, then PRICE_OWN); a model with no row has none, never a family guess', () => {
  const all = { in: 1e6, out: 1e6, rd: 1e6, w5: 1e6, w1: 1e6 }
  near(costOf('claude-fable-5-2', all), 8 + 40 + 0.2 + 10 + 16, 'fable 5.2')
  near(costOf('claude-mythos-5-2', all), 8 + 40 + 0.2 + 10 + 16, 'mythos 5.2')
  near(costOf('claude-opus-5-5', all), 4 + 20 + 0.2 + 5 + 8, 'opus 5.5')
  near(costOf('claude-sonnet-5-5', { rd: 1e6 }), 0.1, "sonnet 5.5's cache reads")
  near(costOf('claude-fable-5-1', { in: 1e6, out: 1e6, rd: 1e6 }), 10 + 50 + 0.25)
  near(costOf('claude-opus-4-6', { out: 1e6 }), 25)
  near(costOf('claude-haiku-4-5-20251001', { out: 1e6 }), 5)
  near(costOf('claude-opus-4-1-20250805', { in: 1e6 }), 15, "a retired id, Laki's own row")
  near(costOf('claude-sonnet-4-5-20250929', { in: 1e6, rd: 1e6 }), 3.3)
  for (const [m, i, o, r] of [['gpt-5.3-codex', 1.75, 14, 0.175], ['gpt-5.4', 2.5, 15, 0.25], ['gpt-5.4-mini', 0.75, 4.5, 0.075], ['gpt-5.4-nano', 0.2, 1.25, 0.02], ['gpt-5.5', 5, 30, 0.5], ['gpt-5.6-sol', 4, 20, 0.4], ['gpt-5.6-terra', 2, 12, 0.2]] as const) {
    near(costOf(m, { in: 1e6 }), i, m)
    near(costOf(m, { out: 1e6 }), o, m)
    near(costOf(m, { rd: 1e6 }), r, m)
  }
  near(costOf('gpt-5-codex', { in: 1e6, out: 1e6, rd: 1e6 }), 1.25 + 10 + 0.125)
  near(costOf('gpt-5.4', { w1: 1e6 }), 5, 'a 1-hour write a row says nothing of: 2x input')
  for (const m of ['claude-opus-5-5-20990101', 'claude-sonnet-9', 'gpt-5.4-codex-turbo', 'some-new-model', '__proto__', 'constructor']) assert.equal(costOf(m, { in: 1e6 }), undefined, m)
  assert.equal(costOf(undefined, { in: 1 }), undefined)
  assert.match(pricesDate(), /^\d{4}-\d\d-\d\d$/)
})

test('prices: a long prompt at its own rates, by each request’s whole input; fast mode at 2x where the model has it', () => {
  assert.deepEqual(partsOf('claude-haiku-5-5', { in: 100_000, out: 1000 }), { in: 100_000, out: 1000 }, 'at the line: not past it')
  const big = partsOf('claude-haiku-5-5', { in: 50_000, rd: 60_000, out: 1000 }) // 110K with its cache
  assert.deepEqual(big, { inL: 50_000, rdL: 60_000, outL: 1000 })
  near(costOf('claude-haiku-5-5', big), (0.5 * 50_000 + 0.05 * 60_000 + 2.5 * 1000) / 1e6, 'haiku 5.5 past 100K')
  for (const [m, i, o] of [['gpt-5.4', 5, 22.5], ['gpt-5.5', 10, 45], ['gpt-5.6-sol', 8, 30], ['gpt-5.6-terra', 4, 18]] as const) near(costOf(m, partsOf(m, { in: 300_000, out: 1e6 })), i * 0.3 + o, `${m} past 272K`)
  near(costOf('gpt-5.4', partsOf('gpt-5.4', { in: 272_000, out: 1e6 })), 2.5 * 0.272 + 15, 'gpt-5.4 at 272K')
  near(costOf('claude-sonnet-4-5', partsOf('claude-sonnet-4-5', { in: 150_000, w5: 60_000, out: 1e6 })), 6 * 0.15 + 7.5 * 0.06 + 22.5, 'sonnet 4.5 past 200K')
  near(costOf('claude-sonnet-4-20250514', partsOf('claude-sonnet-4-20250514', { in: 250_000 })), 6 * 0.25, 'sonnet 4 past 200K')
  near(costOf('claude-sonnet-4-5', partsOf('claude-sonnet-4-5', { in: 200_000 })), 3 * 0.2, 'sonnet 4.5 at 200K')
  near(costOf('claude-opus-5-5', partsOf('claude-opus-5-5', { in: 1e6, out: 1e6 }, true)), 2 * (4 + 20), 'opus 5.5 fast')
  near(costOf('claude-fable-5-2', partsOf('claude-fable-5-2', { out: 1e6, w1: 1e6 }, true)), 2 * (40 + 16), 'fable 5.2 fast')
  assert.deepEqual(partsOf('claude-sonnet-5-5', { in: 5 }, true), { in: 5 }, 'no fast mode: as usual')
})

test("meter: claude's cache writes split by how long they're kept; fast mode by usage.speed", () => {
  const w = (c?: object, speed?: string) => meterCost(meterOf('claude', said('h', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1e6, ...(c && { cache_creation: c }), ...(speed && { speed }) }), meterNew(), now).by).cost
  near(w({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1e6 }), 8, 'only 1-hour writes: 2x input')
  near(w({ ephemeral_5m_input_tokens: 4e5, ephemeral_1h_input_tokens: 6e5 }), 0.4 * 5 + 0.6 * 8, 'both')
  near(w(), 5, 'no split said: all 5 minutes')
  near(w({ ephemeral_1h_input_tokens: 1e6 }, 'fast'), 16, 'fast')
  near(w(undefined, 'standard'), 5)
})

test("meter: claude's context is the last answer's prompt; tokens summed once per answer, today's apart", () => {
  const m = meterNew()
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
  assert.equal(todayOf(m), m.tokens - 2000)
  const c = meterCost(m.by)
  near(c.cost, (3 * 1000 + 15 * 1000 + 3 * 10 + 3.75 * 2000 + 15 * 300 + 1 * 50000 + 5 * 100 + 3 * 20 + 3.75 * 500 + 0.3 * 140000 + 15 * 400) / 1e6)
  assert.ok(c.priced)
  assert.equal(m.max, undefined, "claude's transcript doesn't say its window")
  // a subagent's lines between two blocks of one answer: that answer still counted once (H8.2 #5)
  const sub = meterOf('claude', said('a', 'claude-sonnet-4-5', u(10, 0, 0, 5)) + said('s2', 'claude-haiku-4-5', u(7, 0, 0, 3), 0, { isSidechain: true }) + said('a', 'claude-sonnet-4-5', u(10, 0, 0, 300)), meterNew(), now)
  assert.equal(sub.tokens, 10 + 300 + (7 + 3))
  near(meterCost(sub.by).cost, (3 * 10 + 15 * 300 + 1 * 7 + 5 * 3) / 1e6)
  // an unknown model: tokens, no price
  const n = meterCost(meterOf('claude', said('x', 'claude-next-1', u(1, 0, 0, 1)), meterNew(), now).by)
  assert.deepEqual([n.cost, n.priced, n.none], [0, false, { 'claude-next-1': 2 }])
  // a new day: today's starts over, the chat's goes on
  meterOf('claude', said('m4', 'claude-sonnet-4-5', u(1, 0, 0, 1), -24), m, now + 24 * 3600e3)
  assert.equal(todayOf(m, now + 24 * 3600e3), 2)
})

test("meter: codex's context is its last token_count against its window; tokens what its totals grew by", () => {
  const m = meterNew()
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
  assert.deepEqual([m.used, m.max, m.tokens, todayOf(m)], [20400, 272000, 30900, 30900])
  near(meterCost(m.by).cost, (1.25 * (30000 - 9000) + 0.125 * 9000 + 10 * 900) / 1e6)
})

test("meter: R4: codex's plan limits from its token_count's rate_limits, the newest kept", () => {
  const m = meterNew()
  const rl = (used: number, h: number) => line({ type: 'event_msg', timestamp: at(h), payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_in_seconds: 600 }, secondary: { used_percent: 4, window_minutes: 10080, resets_at: 1794326400 } } } })
  meterOf('codex', rl(30, 1) + rl(12, 2), m, now)
  assert.deepEqual(m.limits, { at: now - 3600e3, windows: [{ label: '5-hour', used: 30, resets: now - 3600e3 + 600e3 }, { label: 'Weekly', used: 4, resets: 1794326400e3 }] })
  meterOf('codex', line({ type: 'event_msg', timestamp: at(0), payload: { type: 'token_count', info: null, rate_limits: {} } }), m, now)
  assert.equal(m.limits?.windows[0].used, 30, 'none said: the last kept')
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
  assert.equal(today.ws[0].name, ws.id, 'its name kept with it: Today names a workspace removed since')

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
  // the Usage page's: by day, agent and model, kept in usage-days.json, counted once over the restart too
  const d = await rig.rpc('usageDays')
  const d0 = new Date()
  const key = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`
  assert.equal(d.keep, 90)
  assert.deepEqual(d.rows.map((r: any) => [r.day, r.agent, r.model, r.tokens]).sort(), [[key, 'claude', 'claude-opus-4-6', 447000], [key, 'codex', 'gpt-5-codex', 51000]])
  assert.ok(d.rows.every((r: any) => r.cost > 0))
  assert.ok(d.rows.every((r: any) => r.ws === ws.id), JSON.stringify(d.rows)) // Where it went: each row's workspace
  assert.deepEqual(d.ai, []) // no Laki AI calls
  await until(async () => JSON.parse(readFileSync(join(rig.data, 'usage-days.json'), 'utf8')).chats['chat-1']?.days, 'usage-days.json written')
  // removed: Today still names it, as it was
  await rig.rpc('wsRm', { id: ws.id, force: true })
  assert.deepEqual((await rig.rpc('state')).today.ws.map((x: any) => [x.ws, x.name]), [[ws.id, ws.id]])
})

test('prices: every model the test fixtures’ transcripts name has a price', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.jsonl') ? [join(d, e.name)] : []))
  const models = new Set<string>()
  for (const f of walk(join(import.meta.dirname, 'fixtures')))
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      let j: any
      try {
        j = JSON.parse(l)
      } catch {
        continue
      }
      const m = j?.message?.model ?? (j?.type === 'turn_context' ? j.payload?.model : undefined)
      if (typeof m === 'string' && m !== '<synthetic>') models.add(m)
    }
  assert.ok(models.size >= 5, [...models].join())
  assert.deepEqual([...models].filter(m => !priceOf(m)), [], 'a model with no price: add it to PRICE_OWN or run npm run prices')
})

test('usage days: kept as token parts and priced as read (a new price re-prices a kept day); old rows keep their cost; no price says so', async t => {
  const { daysRows, partsMax } = await import('../src/daemon/share.ts')
  const day = '2026-11-20'
  const chats = {
    c1: { ws: 'w', agent: 'claude', days: { [day]: { 'claude-opus-5-5': { p: { in: 1e6, w1: 1e6 } }, 'claude-next-9': { p: { in: 1000, rd: 3000 } } } } },
    c2: { ws: 'w', agent: 'claude', days: { [day]: { 'claude-opus-5-5': { tokens: 500, cost: 1.5 } } } }, // kept before parts
    g: { ws: 'w', agent: 'grok', days: { [day]: { 'grok-4.7-build': { tokens: 10, cost: 0.5, own: true as const } } } },
    a: { ws: 'w', agent: 'gemini', days: { [day]: { 'gemini-4-neon': { tokens: 7, own: true as const } } } },
  }
  const row = (model: string) => daysRows(chats).find(r => r.model === model)!
  assert.deepEqual(row('claude-opus-5-5'), { day, agent: 'claude', model: 'claude-opus-5-5', ws: 'w', tokens: 2e6 + 500, cost: 4 + 8 + 1.5, priced: true, old: true, input: 2e6 })
  assert.deepEqual(row('claude-next-9'), { day, agent: 'claude', model: 'claude-next-9', ws: 'w', tokens: 4000, cost: 0, priced: false, read: 3000, input: 4000 })
  assert.deepEqual([row('grok-4.7-build').cost, row('grok-4.7-build').priced, row('gemini-4-neon').priced], [0.5, true, false])
  const was = PRICE_OWN['claude-opus-5-5']
  t.after(() => (PRICE_OWN['claude-opus-5-5'] = was))
  PRICE_OWN['claude-opus-5-5'] = { in: 40 }
  assert.equal(row('claude-opus-5-5').cost, 40 + 8 + 1.5, 'the same kept day at the new price; the old row at its own')
  assert.deepEqual(partsMax({ in: 5, out: 9 }, { in: 7, out: 2, rd: 1 }), { in: 7, out: 9, rd: 1 }, 'the more of each part')
})

const FX = join(import.meta.dirname, 'fixtures/transcripts')
const SESSION = '3b0e8a52-5f6c-4d8a-9c1e-2a7b6d4f9e01'
const PARENT = '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
// a fixture into the rig's home, its lines' times now (today's)
const place = (from: string, to: string, more = '') => (mkdirSync(dirname(to), { recursive: true }), writeFileSync(to, readFileSync(from, 'utf8').replace(/"timestamp":"[^"]+"/g, `"timestamp":"${new Date().toISOString()}"`) + more))

test("meter: a claude chat's subagents and a codex chat's spawned threads count to its spend, today's and the Usage page's, never its context", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  place(join(FX, 'claude', `${SESSION}.jsonl`), join(dir, `${SESSION}.jsonl`))
  place(join(FX, 'claude', SESSION, 'subagents/agent-a1.jsonl'), join(dir, SESSION, 'subagents/agent-a1.jsonl'))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: SESSION } })
  // main: 20310 + 21520; its subagent: 30205 + 30105 (claude-haiku-5-5); the context the main chat's last prompt
  const v = await until(async () => (x => x?.usage?.tokens === 102140 && x)(await rig.tab(ws.id)), 'the chat and its subagent')
  assert.deepEqual(v.context, { used: 21020, max: 200000 })
  assert.equal(v.usage.cost, Math.round(((10 * 4 + 20000 * 8 + 300 * 20) + (20 * 4 + 1000 * 5 + 20000 * 0.2 + 500 * 20) + (5 * 0.1 + 30000 * 0.125 + 200 * 0.5) + (5 * 0.1 + 30000 * 0.01 + 100 * 0.5)) / 1e6 * 1e4) / 1e4)
  // one more subagent, later, its model with no price: tokens, said so
  writeFileSync(join(dir, SESSION, 'subagents/agent-b2.jsonl'), line({ isSidechain: true, type: 'assistant', timestamp: new Date().toISOString(), requestId: 'req_b2', message: { id: 'msg_b2', model: 'claude-next-9', usage: { input_tokens: 10, output_tokens: 5 } } }))
  const w = await until(async () => (x => x?.usage?.tokens === 102155 && x)(await rig.tab(ws.id)), 'the later subagent')
  assert.deepEqual([w.usage.cost, w.usage.unpriced, w.context.used], [v.usage.cost, ['claude-next-9'], 21020])

  // codex: the parent, the thread it spawned (its copy of the parent's turn counted once) and that one's own; another chat's not
  const cx = await rig.rpc('tabNew', { ws: ws.id, preset: 'codex' })
  for (const f of readdirSync(join(FX, 'codex/2026/11/20'))) place(join(FX, 'codex/2026/11/20', f), join(rig.home, '.codex/sessions/2026/11/20', f))
  await rig.rpc('hook', { tab: cx.id, state: 'start', payload: { session_id: PARENT } })
  const c = await until(async () => (x => x?.usage?.tokens === 13650 && x)((await rig.rpc('state')).tabs.find((x: any) => x.id === cx.id)), 'codex and its threads', 15000)
  assert.deepEqual(c.context, { used: 10500, max: 272000 })
  assert.equal(c.usage.cost, Math.round((6000 * 2.5 + 4000 * 0.25 + 500 * 15 + 2000 * 0.75 + 100 * 4.5 + 1000 * 0.2 + 50 * 1.25) / 1e6 * 1e4) / 1e4)

  // today's and the Usage page's, each once; the unpriced said; the cap's tip too
  const today = await until(async () => (x => x?.tokens === 102155 + 13650 && x)((await rig.rpc('state')).today), 'today’s')
  assert.deepEqual(today.unpriced, [{ model: 'claude-next-9', tokens: 15 }])
  const rows = (await rig.rpc('usageDays')).rows
  assert.deepEqual(rows.map((r: any) => [r.model, r.tokens, r.priced]).sort(), [['claude-haiku-5-5', 60310, true], ['claude-next-9', 15, false], ['claude-opus-5-5', 41830, true], ['gpt-5.4', 10500, true], ['gpt-5.4-mini', 2100, true], ['gpt-5.4-nano', 1050, true]])
  await rig.rpc('wsSet', { id: ws.id, cap: 5 })
  const spend = await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === ws.id)?.spend, 'its cap')
  assert.deepEqual([Math.abs(spend.usd - (v.usage.cost + c.usage.cost)) < 0.011, spend.unpriced], [true, ['claude-next-9']])
  // Where it went: the subagent's and the threads' requests too, the copy once
  const sp = await rig.rpc('wsSpend', { ws: ws.id })
  assert.equal(sp.input.total, (10 + 20000) + (20 + 1000 + 20000) + (5 + 30000) * 2 + 10 + 10000 + 2000 + 1000)
})

test('meter: a forked chat’s copied answers count once, to the chat that reported them first; a restart keeps who owns them', async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const ta = await until(async () => (x => x?.resumeId && x)(await rig.tab(a.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  place(join(FX, 'claude', `${SESSION}.jsonl`), join(dir, 'fork-a.jsonl'))
  await rig.rpc('hook', { tab: ta.id, state: 'start', payload: { session_id: 'fork-a' } })
  await until(async () => (await rig.tab(a.id))?.usage?.tokens === 41830, 'the first chat')
  // the fork: the first one's lines, then an answer of its own
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tb = await until(async () => (x => x?.resumeId && x)(await rig.tab(b.id)), 'its chat')
  const own = line({ type: 'assistant', timestamp: new Date().toISOString(), requestId: 'req_fork_1', message: { id: 'msg_fork_1', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50 } } })
  place(join(FX, 'claude', `${SESSION}.jsonl`), join(dir, 'fork-b.jsonl'), own)
  await rig.rpc('hook', { tab: tb.id, state: 'start', payload: { session_id: 'fork-b' } })
  const vb = await until(async () => (x => x?.usage && x)(await rig.tab(b.id)), 'the fork')
  assert.deepEqual([vb.usage.tokens, vb.context.used], [150, 100], 'its own answer only; its context its last prompt')
  const total = async () => (await rig.rpc('usageDays')).rows.reduce((n: number, r: any) => n + r.tokens, 0)
  await until(async () => (await total()) === 41830 + 150, 'the Usage page')
  await until(async () => (await rig.rpc('state')).today?.tokens === 41830 + 150, 'today’s')
  await rig.stop()
  await rig.start()
  await until(async () => (await rig.tab(b.id))?.usage?.tokens === 150, 'the fork again')
  await until(async () => (await rig.tab(a.id))?.usage?.tokens === 41830, 'the first again')
  assert.equal(await total(), 41830 + 150)
  assert.equal((await rig.rpc('state')).today.tokens, 41830 + 150)
})

test('ledger: an answer’s lines count the largest of each part, over a restart too; 0.68.0’s rows no key backs are replaced as the chat is read again, kept where it isn’t', async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(join(dir, 'grow-1/subagents'), { recursive: true })
  const ans = (id: string, model: string, i: number, o: number, more = {}) => line({ type: 'assistant', timestamp: new Date().toISOString(), requestId: `r_${id}`, message: { id, model, usage: { input_tokens: i, output_tokens: o } }, ...more })
  writeFileSync(join(dir, 'grow-1.jsonl'), ans('msg_m', 'claude-opus-5-5', 100, 10))
  const sub = join(dir, 'grow-1/subagents/agent-g.jsonl')
  writeFileSync(sub, ans('msg_g', 'claude-haiku-5-5', 7, 2, { isSidechain: true }) + ans('msg_g', 'claude-haiku-5-5', 5, 40, { isSidechain: true })) // its output as it streams; a later line's input no bigger
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'grow-1' } })
  const total = async () => (await rig.rpc('usageDays')).rows.reduce((n: number, r: any) => n + r.tokens, 0)
  await until(async () => (await total()) === 110 + 7 + 40, 'the largest of each part')
  await rig.stop()
  appendFileSync(sub, ans('msg_g', 'claude-haiku-5-5', 7, 300, { isSidechain: true })) // its last line, written as the daemon was down
  // the ledger as 0.68.0 left it: no version, a row from before parts for this chat and one for a chat whose transcript is gone
  const f = join(rig.data, 'usage-days.json')
  const k = JSON.parse(readFileSync(f, 'utf8'))
  delete k.v
  const y = dayOf(Date.now() - 864e5)
  k.chats['grow-1'].days[y] = { 'claude-opus-5-5': { tokens: 999, cost: 2 } }
  k.chats['gone-1'] = { ws: ws.id, agent: 'claude', days: { [y]: { 'claude-opus-5-5': { tokens: 500, cost: 1 } } } }
  writeFileSync(f, JSON.stringify(k))
  await rig.start()
  await until(async () => (await total()) === 110 + 7 + 300 + 500, 'what grew once; grow-1’s old row recounted (it has none that day), gone-1’s kept')
  assert.equal((await rig.rpc('state')).today.tokens, 110 + 7 + 300)
})

// a protobuf message: [field, varint or bytes]…
const pb = (...fs: [number, number | Uint8Array][]) => {
  const vi = (n: number) => { const b: number[] = []; do { const x = n % 128; n = Math.floor(n / 128); b.push(n ? x | 128 : x) } while (n); return b }
  return new Uint8Array(fs.flatMap(([f, v]) => (typeof v === 'number' ? [...vi(f * 8), ...vi(v)] : [...vi(f * 8 + 2), ...vi(v.length), ...v])))
}
test("meter: Grok's and Antigravity's chats by day and model for the Usage page and Today, from their own files", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'grok' })
  const g = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat id')
  // Grok's usage.json, in a folder of its own naming: each turn's, its cost in xAI's ticks (1e-10 USD)
  const gd = join(rig.home, '.grok/sessions/some-folder', g.resumeId)
  mkdirSync(gd, { recursive: true })
  const turn = (ago: number, tokens: number, ticks: number) => ({ endedAt: new Date(Date.now() - ago).toISOString(), modelUsage: { 'grok-4.7-build': { totalTokens: tokens, costUsdTicks: ticks } } })
  writeFileSync(join(gd, 'usage.json'), JSON.stringify({ turns: [turn(2 * 864e5, 1000, 1e9), turn(0, 5000, 3e10)] }))
  // Antigravity: its conversation (named by cache/last_conversations.json for the worktree), steps' time and usage
  const ag = await rig.rpc('tabNew', { ws: ws.id, preset: 'gemini' })
  const wsPath = (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).path
  const root = join(rig.home, '.gemini/antigravity-cli')
  mkdirSync(join(root, 'cache'), { recursive: true })
  mkdirSync(join(root, 'conversations'))
  writeFileSync(join(root, 'cache/last_conversations.json'), JSON.stringify({ [wsPath]: 'conv-1' }))
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(root, 'conversations/conv-1.db'))
  db.exec('CREATE TABLE steps (idx integer, metadata blob); CREATE TABLE gen_metadata (idx integer, data blob)')
  const sec = Math.floor(Date.now() / 1000)
  const step = (usage?: Uint8Array) => pb([1, pb([1, sec])], ...(usage ? [[9, usage] as [number, Uint8Array]] : []))
  db.prepare('INSERT INTO steps VALUES (?, ?)').run(0, step()) // a step with no model call
  db.prepare('INSERT INTO steps VALUES (?, ?)').run(1, step(pb([1, 1532], [2, 600], [3, 100], [5, 300])))
  db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(0, pb([1, pb([3, 1532], [19, new TextEncoder().encode('gemini-4-neon')])]))
  db.close()
  const d0 = new Date()
  const key = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`
  const rows = await until(async () => (r => (r.some((x: any) => x.agent === 'gemini') && r.filter((x: any) => x.agent === 'grok').length === 2 ? r : undefined))((await rig.rpc('usageDays')).rows), 'their days')
  const mine = rows.filter((r: any) => r.day === key).map((r: any) => [r.agent, r.model, r.tokens, r.cost, r.ws]).sort()
  assert.deepEqual(mine, [['gemini', 'gemini-4-neon', 1000, 0, ws.id], ['grok', 'grok-4.7-build', 5000, 3, ws.id]])
  assert.equal(rows.find((r: any) => r.agent === 'grok' && r.day !== key).tokens, 1000) // two days ago, its own day
  const today = await until(async () => (x => x?.tokens === 6000 && x)((await rig.rpc('state')).today), 'today’s')
  assert.deepEqual([today.cost, today.ws.map((w: any) => w.ws)], [3, [ws.id]])
  assert.ok(ag.id)
})

// Antigravity's DB read again: only the steps past the last one with usage (a step under way is read again), added to
// the days kept; a DB whose rows went back (another conversation) starts over; the temp folder goes even when it throws
test('agyRead: only the new steps; a smaller DB starts over; no temp folder left', async t => {
  const { agyRead, agyRows } = await import('../src/daemon/agentUsage.ts')
  const { DatabaseSync } = await import('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'laki-agy-test-'))
  const was = process.env.TMPDIR
  process.env.TMPDIR = join(dir, 'tmp') // agyRead's clone goes here: os.tmpdir() reads it at each call
  mkdirSync(process.env.TMPDIR)
  t.after(() => (was === undefined ? delete process.env.TMPDIR : (process.env.TMPDIR = was), rmSync(dir, { recursive: true, force: true }))) // unset again, not the string 'undefined'
  const sec = Math.floor(Date.now() / 1000)
  const step = (tokens?: number) => pb([1, pb([1, sec])], ...(tokens ? [[9, pb([1, 7], [2, tokens])] as [number, Uint8Array]] : []))
  const make = (f: string, ...steps: (number | undefined)[]) => {
    const db = new DatabaseSync(f)
    db.exec('CREATE TABLE IF NOT EXISTS steps (idx integer, metadata blob); CREATE TABLE IF NOT EXISTS gen_metadata (idx integer, data blob)')
    for (const n of steps) db.prepare('INSERT INTO steps VALUES (0, ?)').run(step(n))
    db.close()
  }
  const total = (r: { recs: { own?: { tokens: number } }[] }) => r.recs.reduce((n, x) => n + (x.own?.tokens ?? 0), 0)
  const f = join(dir, 'conv.db')
  make(f, 100, 200)
  let n = agyRows.n
  const r1 = agyRead(f)!
  assert.deepEqual([total(r1), r1.last, r1.again, agyRows.n - n], [300, 2, false, 2])
  assert.deepEqual([new Set(r1.recs.map(x => x.key)).size, r1.recs[0].chat], [2, 'conv'], 'a key a step, the conversation its chat')
  make(f, 50, undefined) // one more step, and one under way (no usage yet)
  n = agyRows.n
  const r2 = agyRead(f, r1.last)!
  assert.deepEqual([total(r2), r2.last, agyRows.n - n], [50, 3, 2], 'the two new rows only')
  n = agyRows.n
  assert.equal(agyRead(f, r2.last)!.last, 3)
  assert.equal(agyRows.n - n, 1, 'the step under way read again')
  // replaced by a smaller one (another conversation): read whole
  rmSync(f)
  make(f, 70)
  const r3 = agyRead(f, 3)!
  assert.deepEqual([r3.again, total(r3)], [true, 70])
  // not a DB: nothing, and its temp folder gone
  writeFileSync(join(dir, 'bad.db'), 'not sqlite')
  assert.equal(agyRead(join(dir, 'bad.db')), undefined)
  assert.deepEqual(readdirSync(process.env.TMPDIR), [])
})

// an OpenCode database as 1.19.5 keeps it (the columns read): sessions with their parents, messages with their data
const ocMake = async (f: string) => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(f)
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, project_id text NOT NULL DEFAULT 'p', parent_id text, directory text NOT NULL DEFAULT '/tmp'); CREATE TABLE IF NOT EXISTS message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)")
  return db
}
const ocSaid = (db: any, id: string, session: string, model: string, t: [number, number, number, number, number], cost: number, done = true, ago = 0) => {
  const at = Date.now() - ago
  const data = JSON.stringify({ role: 'assistant', modelID: model, providerID: 'openrouter', cost, tokens: { total: t.reduce((a, b) => a + b), input: t[0], output: t[1], reasoning: t[2], cache: { read: t[3], write: t[4] } }, time: { created: at, ...(done && { completed: at + 1 }) }, mode: 'build', parentID: 'msg_user' })
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET time_updated = excluded.time_updated, data = excluded.data').run(id, session, at, at, data) // updated in place, as OpenCode does: its rowid kept
}
const ocSessions = (db: any, main: string) => {
  for (const [id, parent] of [[main, null], ['ses_sub', main], ['ses_subsub', 'ses_sub'], ['ses_other', null]]) db.prepare('INSERT OR IGNORE INTO session (id, parent_id) VALUES (?, ?)').run(id, parent)
  db.prepare("INSERT OR IGNORE INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_user', ?, 0, 0, ?)").run(main, JSON.stringify({ role: 'user', time: { created: Date.now() } }))
}

test('ocRead: a session and its subagents’ messages, OpenCode’s own cost; one still answering read again; only the new rows', async t => {
  const { ocRead, ocRows } = await import('../src/daemon/agentUsage.ts')
  const dir = mkdtempSync(join(tmpdir(), 'laki-oc-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const f = join(dir, 'opencode.db')
  const db = await ocMake(f)
  ocSessions(db, 'ses_main')
  ocSaid(db, 'm1', 'ses_main', 'z-ai/glm-5.1', [1000, 50, 10, 200, 0], 0.01)
  ocSaid(db, 'm2', 'ses_sub', 'beam-free', [500, 20, 0, 0, 0], 0)
  ocSaid(db, 'm3', 'ses_other', 'z-ai/glm-5.1', [9999, 0, 0, 0, 0], 9)
  ocSaid(db, 'm4', 'ses_subsub', 'z-ai/glm-5.1', [100, 10, 0, 0, 0], 0.001)
  ocSaid(db, 'm5', 'ses_main', 'z-ai/glm-5.1', [700, 77, 0, 0, 0], 0.002, false) // still answering
  const by = (r: any) => {
    const m: Record<string, { tokens: number; cost: number }> = {} // a model's records summed: m6, two hours back, is yesterday's before 2 am
    for (const x of r.recs) m[x.model] = { tokens: (m[x.model]?.tokens ?? 0) + x.own.tokens, cost: (m[x.model]?.cost ?? 0) + x.own.cost }
    return Object.entries(m).map(([k, v]) => [k, v.tokens, Math.round(v.cost * 1e6) / 1e6]).sort()
  }
  let n = ocRows.n
  const r1 = ocRead(f, 'ses_main')!
  assert.deepEqual([by(r1), r1.last, r1.again, ocRows.n - n], [[['beam-free', 520, 0], ['z-ai/glm-5.1', 1260 + 110, 0.011]], 5, false, 5], 'its rows to the one still answering (the user’s and the other session’s not counted)')
  ocSaid(db, 'm5', 'ses_main', 'z-ai/glm-5.1', [700, 77, 0, 0, 0], 0.002) // done: the same row, its usage final
  n = ocRows.n
  const r2 = ocRead(f, 'ses_main', r1.last)!
  assert.deepEqual([by(r2), r2.last, ocRows.n - n], [[['z-ai/glm-5.1', 777, 0.002]], 6, 1], 'only that row')
  assert.equal(ocRead(f, 'ses_main', 99)!.again, true, 'another database: read whole')
  // begun two hours ago and never ended (its opencode killed): counted as it is, the rows after it too
  ocSaid(db, 'm6', 'ses_main', 'z-ai/glm-5.1', [40, 4, 0, 0, 0], 0, false, 2 * 3_600_000)
  ocSaid(db, 'm7', 'ses_main', 'z-ai/glm-5.1', [6, 0, 0, 0, 0], 0)
  const r3 = ocRead(f, 'ses_main', r2.last)!
  assert.deepEqual([by(r3), r3.last], [[['z-ai/glm-5.1', 50, 0]], 8])
  db.close()
  assert.equal(ocRead(join(dir, 'none.db'), 'ses_main'), undefined)
  // every session (the machine scan's): each under the one it hangs from, in that one's folder
  const all = ocRead(f, undefined)!
  assert.deepEqual([...new Set(all.recs.map(x => `${x.chat} ${x.cwd}`))].sort(), ['ses_main /tmp', 'ses_other /tmp'])
})

test("meter: OpenCode's sessions from its own database, for the Usage page and Today, at OpenCode's own price", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200', LAKI_AGY_EVERY_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'opencode' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its session')
  mkdirSync(join(rig.home, '.local/share/opencode'), { recursive: true })
  const db = await ocMake(join(rig.home, '.local/share/opencode/opencode.db'))
  t.after(() => db.close())
  ocSessions(db, tab.resumeId)
  ocSaid(db, 'm1', tab.resumeId, 'z-ai/glm-5.1', [1000, 50, 10, 200, 0], 0.01)
  ocSaid(db, 'm2', 'ses_sub', 'beam-free', [500, 20, 0, 0, 0], 0)
  ocSaid(db, 'm3', 'ses_other', 'z-ai/glm-5.1', [9999, 0, 0, 0, 0], 9)
  ocSaid(db, 'm4', tab.resumeId, 'z-ai/glm-5.1', [700, 77, 0, 0, 0], 0.002, false)
  const rows = async () => (await rig.rpc('usageDays')).rows.filter((r: any) => r.agent === 'opencode').map((r: any) => [r.model, r.tokens, r.cost, r.priced, r.ws]).sort()
  await until(async () => (await rows()).length === 2, 'its days')
  assert.deepEqual(await rows(), [['beam-free', 520, 0, true, ws.id], ['z-ai/glm-5.1', 1260, 0.01, true, ws.id]])
  ocSaid(db, 'm4', tab.resumeId, 'z-ai/glm-5.1', [700, 77, 0, 0, 0], 0.002)
  await until(async () => (await rows())[1]?.[1] === 1260 + 777, 'the answer once it ended')
  assert.deepEqual((await rows())[1], ['z-ai/glm-5.1', 2037, 0.012, true, ws.id])
  const today = await until(async () => (x => x?.tokens === 2557 && x)((await rig.rpc('state')).today), 'today’s')
  assert.deepEqual([today.cost, today.unpriced], [0.01, undefined])
  assert.ok(rig.fakeLog().some((l: any) => l.bin === 'opencode' && l.args[0] === 'debug'), 'its data folder asked of opencode')
})

test('meter: each day by model, for the Usage page; a day past and a model of its own each', () => {
  const m = meterNew()
  const u = (output: number) => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output })
  meterOf('claude', said('a', 'claude-opus-4-6', u(100), 48) + said('b', 'claude-sonnet-4-5', u(10)) + said('b', 'claude-sonnet-4-5', u(30)) + said('c', 'claude-opus-4-6', u(5)), m, now)
  assert.deepEqual(Object.fromEntries(Object.entries(m.days!).map(([d, x]) => [d, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, partsTokens(v)]))])), {
    [dayOf(now - 48 * 3600e3)]: { 'claude-opus-4-6': 100 },
    [dayOf(now)]: { 'claude-sonnet-4-5': 30, 'claude-opus-4-6': 5 }, // b's last block only
  })
  const c = meterOf('codex', line({ type: 'turn_context', timestamp: at(0), payload: { model: 'gpt-5-codex' } }) + tokenCount({ input_tokens: 800, cached_input_tokens: 0, output_tokens: 100, total_tokens: 900 }, { total_tokens: 900 }), meterNew(), now)
  assert.deepEqual(c.days, { [dayOf(now)]: { 'gpt-5-codex': { in: 800, out: 100 } } })
})

test("meter: claude waiting out an API error (its api_error line) until it answers", () => {
  const m = meterNew()
  const err = (n: number, ms: number) => line({ type: 'system', subtype: 'api_error', level: 'error', timestamp: at(0), error: { message: 'Overloaded', formatted: 'Rate limited' }, retryInMs: ms, retryAttempt: n, maxRetries: 10 })
  meterOf('claude', err(1, 5000), m, now)
  assert.deepEqual(m.retry, { n: 1, max: 10, at: Date.parse(at(0)), until: Date.parse(at(0)) + 5000, why: 'Rate limited' })
  meterOf('claude', err(2, 30000), m, now) // the next try's replaces it
  assert.equal(m.retry?.n, 2)
  meterOf('claude', said('m9', 'claude-sonnet-4-5', { input_tokens: 1, output_tokens: 1 }), m, now)
  assert.equal(m.retry, undefined) // it answered
})

// where a task's tokens went (shared/spend.ts): a claude transcript as entries, then its breakdown
const spendChat = (o: { usage?: boolean } = {}) => {
  const u = (input: number, output: number, read = 0) => (o.usage === false ? {} : { usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: 0 } })
  let s = line({ type: 'user', timestamp: at(1), message: { role: 'user', content: 'fix the cart total' } })
  const big = 'x'.repeat(20000)
  for (let i = 0; i < 6; i++) {
    s += line({ type: 'assistant', timestamp: at(1), message: { id: `m${i}`, model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: [{ type: 'tool_use', id: `r${i}`, name: 'Read', input: { file_path: '/w/src/cart.ts' } }], ...u(100 + i, 50, 8000 + i * 5000) } })
    s += line({ type: 'user', timestamp: at(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `r${i}`, content: big }] } })
  }
  s += line({ type: 'assistant', timestamp: at(1), message: { id: 'b', model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'cd /w && npm test -- --reporter dot' } }], ...u(100, 40, 40000) } })
  s += line({ type: 'user', timestamp: at(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok\nok\nok' }] } })
  s += line({ type: 'assistant', timestamp: at(1), message: { id: 'e', model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/w/src/cart.ts', old_string: 'a', new_string: 'b'.repeat(400) } }], ...u(100, 300, 41000) } })
  s += line({ type: 'assistant', timestamp: at(1), message: { id: 'e', model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: [{ type: 'text', text: 'Fixed the total.' }], ...u(100, 320, 41000) } }) // the same answer's next block: its usage so far
  return s
}

test('spend: a file read six times found with its share and its hint; totals as the meter has them; paths from the worktree', async () => {
  const { spendBreakdown, spendEntries } = await import('../src/shared/spend.ts')
  const jsonl = spendChat()
  const r = spendBreakdown(spendEntries('claude', jsonl, '/w'))
  assert.equal(r.exact, true)
  assert.equal(r.estimate, true)
  const cart = r.input.parts.find(p => p.kind === 'file' && p.label === 'src/cart.ts')!
  assert.equal(cart.reads, 6)
  assert.ok(cart.share > 0.5, `its share: ${cart.share}`)
  assert.match(r.hints.join('\n'), /^src\/cart\.ts was read 6 times, 100% of file reads: consider excluding it in the project rules or asking for line ranges$/m)
  assert.ok(r.input.parts.some(p => p.kind === 'command' && p.label === 'npm test' && p.reads === 1)) // its head, past cd … &&
  assert.ok(r.input.parts.some(p => p.kind === 'system'), 'the first request less the message: the system prompt and rules')
  assert.deepEqual(r.output.parts.map(p => p.kind).sort(), ['edits', 'messages', 'tools'])
  // the meter's tokens: input and output together, within rounding
  const m = meterOf('claude', jsonl, meterNew(), now)
  assert.ok(Math.abs(r.input.total + r.output.total - m.tokens) <= 2, `${r.input.total + r.output.total} vs ${m.tokens}`)
  assert.ok(Math.abs(r.input.parts.reduce((s, p) => s + p.tokens, 0) - r.input.total) <= r.input.parts.length, 'the parts add up')
})

test('spend: a transcript without usage still gives shares by size; a loud command and a long carried chat get their hints', async () => {
  const { spendBreakdown, spendEntries } = await import('../src/shared/spend.ts')
  const r = spendBreakdown(spendEntries('claude', spendChat({ usage: false }), '/w'))
  assert.equal(r.exact, false)
  assert.ok(r.input.total > 0)
  assert.ok(Math.abs(r.input.parts.reduce((s, p) => s + p.share, 0) - 1) < 0.01, 'shares of the whole')
  assert.ok(r.input.parts.find(p => p.label === 'src/cart.ts')!.share > 0.9)
  assert.ok(!r.input.parts.some(p => p.kind === 'carried' || p.kind === 'system'), 'no usage: nothing to tell those by')
  // a command whose output is most of the input, over turns that carry a long conversation
  type E = import('../src/shared/spend.ts').SpendEntry
  const loud: E[] = [{ kind: 'user', chars: 40 }, { kind: 'request', input: 2000, output: 100 }]
  for (let k = 1; k <= 6; k++) loud.push({ kind: 'tool', source: 'command', key: 'npm test', chars: 16000, lines: 4000 }, { kind: 'request', input: 2000 + k * 4000, output: 50 })
  assert.deepEqual(spendBreakdown(loud).hints.map(h => h.replace(/\d+%/, 'n%')), ['npm test printed 4,000 lines each run, n% of the input: use a quieter reporter'])
  const long: E[] = []
  for (let t = 0; t < 8; t++) long.push({ kind: 'user', chars: 40 }, { kind: 'request', input: 2000 + t * 30000, output: 100 }, { kind: 'tool', source: 'file', key: `f${t}.ts`, chars: 400 }, { kind: 'request', input: 2100 + t * 30000, output: 50 })
  assert.deepEqual(spendBreakdown(long).hints.map(h => h.replace(/\d+%/, 'n%')), ['The conversation carried into each turn is n% of the input over 8 turns: compact earlier'])
  assert.deepEqual(spendBreakdown(long.slice(0, 16)).hints, [], 'four turns: not a long task yet')
  // nothing over a line: no hint
  assert.deepEqual(spendBreakdown([{ kind: 'user', chars: 10 }, { kind: 'request', input: 1000, output: 10 }, { kind: 'tool', source: 'file', key: 'a.ts', chars: 400 }]).hints, [])
  // codex: its token_count totals and its shell's file reads
  const cx = line({ type: 'event_msg', timestamp: at(0), payload: { type: 'user_message', message: 'go' } }) + line({ type: 'response_item', timestamp: at(0), payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', "sed -n '1,200p' src/app.ts"] }) } }) + line({ type: 'response_item', timestamp: at(0), payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'y'.repeat(4000) }) } }) + tokenCount({ input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 200, total_tokens: 5200 }, { total_tokens: 5200 })
  const c = spendBreakdown(spendEntries('codex', cx))
  assert.equal(c.input.total + c.output.total, meterOf('codex', cx, meterNew(), now).tokens)
  assert.ok(c.input.parts.some(p => p.kind === 'file' && p.label === 'src/app.ts'))
})

test("spend: wsSpend reads a workspace's transcripts; an agent can't read another workspace's", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const two = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'two' })
  const tab = (await until(() => rig.tab(one.id))).id
  await until(() => rig.tab(two.id))
  const r = await rig.rpc('wsSpend', { ws: one.id })
  assert.equal(r.estimate, true)
  assert.equal(typeof r.tabs, 'number')
  const from = { ws: one.id, tab }
  assert.equal((await rig.rpc('wsSpend', { ws: one.id, from })).estimate, true, 'its own')
  await assert.rejects(rig.rpc('wsSpend', { ws: two.id, from }), /an agent can read its own workspace's spend only/)
})

test('B7: the skills a chat loaded, in that order: claude\'s Skill calls and base directories, a SKILL.md read; codex\'s shell', () => {
  const l = (o: object) => `${JSON.stringify({ timestamp: '2026-11-18T10:00:00Z', ...o })}\n`
  const tool = (name: string, input: object, extra = {}) => l({ type: 'assistant', message: { content: [{ type: 'tool_use', id: name, name, input }] }, ...extra })
  const m = meterOf(
    'claude',
    tool('Skill', { skill: 'release-notes' }) +
      l({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill: /repo/.claude/skills/release-notes\n\n# Release notes' }] } }) +
      tool('Skill', { skill: 'caveman:caveman' }) +
      l({ type: 'user', message: { content: 'Base directory for this skill: /plugins/caveman/skills/caveman\n\nbody' } }) +
      tool('Read', { file_path: '/Users/me/.claude/skills/laki/SKILL.md' }) +
      tool('Skill', { skill: 'release-notes' }) + // again: once
      tool('Skill', { skill: 'sub' }, { isSidechain: true }) + // a subagent's: not the chat's
      l({ type: 'user', message: { content: 'Base directory for this skill: /Users/me/.claude/skills/specdrop' } }), // typed as /specdrop: no Skill call
    meterNew(),
  )
  assert.deepEqual(m.skills, [
    { name: 'release-notes', path: '/repo/.claude/skills/release-notes' },
    { name: 'caveman:caveman', path: '/plugins/caveman/skills/caveman' },
    { name: 'laki', path: '/Users/me/.claude/skills/laki' },
    { name: 'specdrop', path: '/Users/me/.claude/skills/specdrop' },
  ])
  const c = meterOf('codex', l({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'cat ~/.codex/skills/laki/SKILL.md'] }) } }), meterNew())
  assert.deepEqual(c.skills, [{ name: 'laki', path: '~/.codex/skills/laki' }])
  assert.equal(meterOf('claude', tool('Bash', { command: 'ls' }), meterNew()).skills, undefined, 'none: no list')
})

test("cap: a workspace's spend cap: 80% one notice; 100% stops its turn and asks; what you send waits; Add again lets it through", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', cap: '$1' })
  assert.deepEqual(ws.cap, { usd: 1 })
  await assert.rejects(rig.rpc('wsSet', { id: ws.id, cap: 'lots' }), /a spend cap of lots\? \$5, or 2M tokens/)
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const app = await rig.connect()
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-1.jsonl')
  // opus 4.6: $25 a million output tokens; 34k: $0.85
  const answer = (id: string, output: number) => line({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'claude-opus-4-6', usage: { input_tokens: 0, output_tokens: output } } })
  writeFileSync(file, answer('a', 34000))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-1' } })
  const notices = () => app.events.filter(e => e.ev === 'notice')
  await until(() => notices().length === 1, 'the 80% notice')
  assert.match(notices()[0].text, /has spent \$0\.85 of its \$1 spend cap/)
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).spend.share, 0.85)
  // a running turn crosses it: stopped as its tool call ends (Esc), over, asked once
  await rig.rpc('send', { target: tab.id, text: 'slow work' })
  await until(async () => /esc to interrupt/.test(await rig.rpc('screen', { target: tab.id })), 'its turn')
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } } })
  appendFileSync(file, answer('b', 8000))
  const ask = await until(() => notices().find(e => e.choices?.length), 'the ask')
  assert.deepEqual(ask.choices, ['Add $1 again', 'Leave it stopped', 'Remove the cap'])
  assert.equal(notices().length, 2, 'one 80% notice, one ask')
  assert.ok((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).capOver)
  assert.doesNotMatch(await rig.rpc('screen', { target: tab.id }), /Interrupted/, 'its tool call first')
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } } })
  await until(async () => /Interrupted/.test(await rig.rpc('screen', { target: tab.id })), 'its Esc')
  // over: a message waits in its queue
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle')
  const q = await rig.rpc('send', { target: tab.id, text: 'one more' })
  assert.deepEqual([q.queued, q.over], [1, true])
  // Add again: the cap doubles, the queue goes
  await rig.rpc('alertAnswer', { id: ask.id, choice: 'Add $1 again' })
  await until(async () => !(await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).capOver, 'under again')
  assert.deepEqual((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).cap, { usd: 2 })
  await until(async () => !(await rig.tab(ws.id)).queue?.length, 'its queue sent')
})

test("cap: a closed tab's cost stays in its workspace's spend; reopened, its chat counts it again, not twice", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', cap: '$1' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  // opus 4.6: $25 a million output tokens; 20k: $0.5
  writeFileSync(join(dir, 'chat-3.jsonl'), line({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'a', model: 'claude-opus-4-6', usage: { input_tokens: 0, output_tokens: 20000 } } }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-3' } })
  const w = async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === ws.id)
  await until(async () => (await w()).spend?.usd === 0.5, 'its chat priced')
  await rig.rpc('tabClose', { id: tab.id })
  assert.deepEqual([(await w()).spentClosed, (await w()).spend.usd, (await w()).spend.share], [0.5, 0.5, 0.5], 'closed: still spent')
  await rig.rpc('wsSet', { id: ws.id, spentClosed: 0 })
  assert.equal((await w()).spentClosed, 0.5, "a call can't set it")
  await rig.rpc('tabReopen', { ws: ws.id })
  assert.equal((await w()).spentClosed, 0, 'its chat resumed: its meter has it')
})

test("cost warning: a workspace past yellow, then red: colored, told once each; a raised amount tells again; a project's own off", async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('settingsSet', { costWarn: { on: true, yellow: -1 } }), /a cost warning's yellow: dollars/)
  await rig.rpc('settingsSet', { costWarn: { on: true, yellow: 0.5, red: 1 } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const app = await rig.connect()
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-2.jsonl')
  // opus 4.6: $25 a million output tokens
  const answer = (id: string, output: number) => line({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'claude-opus-4-6', usage: { input_tokens: 0, output_tokens: output } } })
  const cost = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).cost
  const notices = () => app.events.filter(e => e.ev === 'notice')
  // priced at $0 first, seen by a tick: a cost the meters' first read finds is from before (marked, not told), and that
  // read can come late (no window connected: a slow tick)
  writeFileSync(file, answer('z', 1)) // $0.000025: priced, $0 to the cent
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-2' } })
  await until(async () => (await cost())?.usd === 0, 'its chat priced at $0')
  appendFileSync(file, answer('a', 34000)) // $0.85
  await until(() => notices().length === 1, 'yellow told')
  assert.match(notices()[0].text, /has cost \$0\.85 so far, past your yellow amount of \$0\.5/)
  assert.deepEqual(await cost(), { usd: 0.85, level: 'yellow', warn: { yellow: 0.5, red: 1 } })
  appendFileSync(file, answer('b', 8000)) // $1.05
  await until(async () => (await cost()).level === 'red', 'red')
  await until(() => notices().length === 2, 'red told')
  assert.match(notices()[1].text, /past your red amount of \$1\./)
  await new Promise(ok => setTimeout(ok, 600))
  assert.equal(notices().length, 2, 'each told once')
  // a raised red: yellow again, told as it passes the new one
  await rig.rpc('settingsSet', { costWarn: { on: true, yellow: 0.5, red: 2 } })
  await until(async () => (await cost()).level === 'yellow', 'under the new red')
  appendFileSync(file, answer('c', 40000)) // $2.05
  await until(() => notices().length === 3, 'the new red told')
  assert.match(notices()[2].text, /past your red amount of \$2\./)
  // its project's own: off there
  await rig.rpc('projectSet', { id: p.id, costWarn: { on: false } })
  assert.deepEqual(await cost(), { usd: 2.05 })
})
