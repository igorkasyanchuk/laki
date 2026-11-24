// The meters (meters.ts' meterTick, share.ts' meterOf): each claude and codex tab's context, from its transcript read on as
// it grows, and what its chat used, tokens and ≈ cost by shared/types.ts' PRICES; today's kept in usage-today.json.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  // a subagent's lines between two blocks of one answer: that answer still counted once (H8.2 #5)
  const sub = meterOf('claude', said('a', 'claude-sonnet-4-5', u(10, 0, 0, 5)) + said('s2', 'claude-haiku-4-5', u(7, 0, 0, 3), 0, { isSidechain: true }) + said('a', 'claude-sonnet-4-5', u(10, 0, 0, 300)), meterNew(now), now)
  assert.equal(sub.tokens, 10 + 300 + (7 + 3))
  assert.ok(Math.abs(sub.cost - (3 * 10 + 15 * 300 + 1 * 7 + 5 * 3) / 1e6) < 1e-12, String(sub.cost))
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

test("meter: R4: codex's plan limits from its token_count's rate_limits, the newest kept", () => {
  const m = meterNew(now)
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
  assert.ok(JSON.parse(readFileSync(join(rig.data, 'usage-days.json'), 'utf8')).chats['chat-1'].days)
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
  const { agyNext, agyRead, agyRows } = await import('../src/daemon/agentUsage.ts')
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
  const total = (d: Record<string, Record<string, { tokens: number }>>) => Object.values(d).flatMap(Object.values).reduce((n, m) => n + m.tokens, 0)
  const f = join(dir, 'conv.db')
  make(f, 100, 200)
  let n = agyRows.n
  const r1 = agyRead(f)!
  assert.deepEqual([total(r1.days), r1.last, r1.again, agyRows.n - n], [300, 2, false, 2])
  let kept = agyNext(undefined, r1)
  make(f, 50, undefined) // one more step, and one under way (no usage yet)
  n = agyRows.n
  const r2 = agyRead(f, r1.last)!
  assert.deepEqual([total(r2.days), r2.last, agyRows.n - n], [50, 3, 2], 'the two new rows only')
  kept = agyNext(kept, r2)
  assert.equal(total(kept), 350)
  n = agyRows.n
  assert.equal(agyRead(f, r2.last)!.last, 3)
  assert.equal(agyRows.n - n, 1, 'the step under way read again')
  // replaced by a smaller one (another conversation): read whole, the kept days dropped
  rmSync(f)
  make(f, 70)
  const r3 = agyRead(f, 3)!
  assert.deepEqual([r3.again, total(agyNext(kept, r3))], [true, 70])
  // not a DB: nothing, and its temp folder gone
  writeFileSync(join(dir, 'bad.db'), 'not sqlite')
  assert.equal(agyRead(join(dir, 'bad.db')), undefined)
  assert.deepEqual(readdirSync(process.env.TMPDIR), [])
})

test('meter: each day by model, for the Usage page; a day past and a model of its own each', () => {
  const m = meterNew(now)
  const u = (output: number) => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output })
  meterOf('claude', said('a', 'claude-opus-4-6', u(100), 48) + said('b', 'claude-sonnet-4-5', u(10)) + said('b', 'claude-sonnet-4-5', u(30)) + said('c', 'claude-opus-4-6', u(5)), m, now)
  assert.deepEqual(Object.fromEntries(Object.entries(m.days!).map(([d, x]) => [d, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v.tokens]))])), {
    [dayOf(now - 48 * 3600e3)]: { 'claude-opus-4-6': 100 },
    [dayOf(now)]: { 'claude-sonnet-4-5': 30, 'claude-opus-4-6': 5 }, // b's last block only
  })
  const c = meterOf('codex', line({ type: 'turn_context', timestamp: at(0), payload: { model: 'gpt-5-codex' } }) + tokenCount({ total_tokens: 900 }, { total_tokens: 900 }), meterNew(now), now)
  assert.deepEqual(c.days, { [dayOf(now)]: { 'gpt-5-codex': { tokens: 900, cost: c.cost } } })
})

test("meter: claude waiting out an API error (its api_error line) until it answers", () => {
  const m = meterNew(now)
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
