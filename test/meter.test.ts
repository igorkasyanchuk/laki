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
  assert.ok(JSON.parse(readFileSync(join(rig.data, 'usage-days.json'), 'utf8')).chats['chat-1'].days)
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
