import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { agyRead, base, claudeWindows, codexAppWindows, codexWindows, grokCred, grokWindows, waitOf } from '../src/daemon/usage.ts'
import { tools } from '../src/shared/tools.ts'
import { fresh, until } from './helpers.ts'

test('usage: the windows of Claude and Codex answers', () => {
  assert.deepEqual(
    claudeWindows({
      five_hour: { utilization: 41.4, resets_at: '2026-10-03T15:00:00Z' },
      seven_day: { utilization: 6, resets_at: null },
      seven_day_opus: null,
      limits: [{ kind: 'weekly_scoped', percent: 12, scope: { model: { display_name: 'Fable' } } }, { kind: 'other', percent: 99 }],
      extra_usage: { is_enabled: true, used_credits: 1230, monthly_limit: 5000 },
    }),
    [
      { label: '5-hour', used: 41, resets: Date.parse('2026-10-03T15:00:00Z'), note: undefined },
      { label: 'Weekly', used: 6, resets: undefined, note: undefined },
      { label: 'Weekly · Fable', used: 12, resets: undefined, note: undefined },
      { label: 'Extra usage', used: 25, resets: undefined, note: '$12.30 of $50/mo' },
    ],
  )
  assert.deepEqual(claudeWindows({}), [])
  assert.deepEqual(claudeWindows(null), [])
  // codex app-server's account/rateLimits/read (0.171.0's): its main limit, then each other one by its name
  const main = { limitId: 'codex', primary: { usedPercent: 13, windowDurationMins: 43200, resetsAt: 1796416139 }, secondary: null, planType: 'free' }
  assert.deepEqual(codexAppWindows({ rateLimits: main, rateLimitsByLimitId: { codex: main, spark: { limitId: 'spark', limitName: 'GPT-5.3-Codex-Spark', primary: { usedPercent: 2.6, windowDurationMins: 300 } }, other: { primary: { usedPercent: 1, windowDurationMins: 10080 } } } }), [
    { label: '30-day', used: 13, resets: 1796416139000 },
    { label: '5-hour · GPT-5.3-Codex-Spark', used: 3, resets: undefined },
    { label: 'Weekly · other', used: 1, resets: undefined },
  ])
  assert.deepEqual([codexAppWindows({}), codexAppWindows(null)], [[], []])
  assert.deepEqual(
    codexWindows(
      {
        rate_limit: { primary_window: { used_percent: 41, limit_window_seconds: 18000, reset_at: 1000 }, secondary_window: { used_percent: 6, limit_window_seconds: 604800, reset_after_seconds: 60 } },
        additional_rate_limits: [{ limit_name: 'codex-spark', rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 172800 } } }],
      },
      5000,
    ),
    [
      { label: '5-hour', used: 41, resets: 1_000_000 },
      { label: 'Weekly', used: 6, resets: 65_000 },
      { label: '2-day · codex-spark', used: 3, resets: undefined },
    ],
  )
})

test('usage: only a local fake server stands in for the endpoints (a session env can’t send tokens elsewhere)', t => {
  const was = process.env.LAKI_USAGE_API
  t.after(() => (was === undefined ? delete process.env.LAKI_USAGE_API : (process.env.LAKI_USAGE_API = was)))
  for (const [v, want] of [
    ['', 'https://real'],
    ['http://127.0.0.1:5288', 'http://127.0.0.1:5288'],
    ['http://localhost', 'http://localhost'],
    ['https://evil.example', 'https://real'],
    ['http://127.0.0.1.evil.example', 'https://real'],
    ['http://localhost@evil.example', 'https://real'],
  ]) {
    process.env.LAKI_USAGE_API = v
    assert.equal(base('https://real'), want, v)
  }
})

test('usage: read with the agents’ own sign-in, kept 5 minutes, per agent, never with an expired token', async t => {
  const hits: { url: string; auth?: string; beta?: string; account?: string }[] = []
  let claudeCode = 200
  const srv = createServer((q, r) => {
    hits.push({ url: q.url!, auth: q.headers.authorization, beta: q.headers['anthropic-beta'] as string, account: q.headers['chatgpt-account-id'] as string })
    if (q.url === '/api/oauth/usage') {
      r.writeHead(claudeCode, { 'content-type': 'application/json' })
      return r.end(JSON.stringify({ five_hour: { utilization: 41, resets_at: '2026-10-03T15:00:00Z' }, seven_day: { utilization: 6 } }))
    }
    if (q.url === '/backend-api/wham/usage') {
      r.writeHead(200, { 'content-type': 'application/json' })
      return r.end(JSON.stringify({ plan_type: 'team', rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000 } } }))
    }
    r.writeHead(404).end()
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, FAKE_CODEX_LIMITS: 'unknown' } }) // a codex too old to say: chatgpt.com, asked for
  await rig.rpc('settingsSet', { usage: { claude: true, codex: true } }) // R4: the endpoints, asked for

  // no sign-ins: nothing asked
  let u = await rig.rpc('usage')
  assert.deepEqual(
    u.map((x: any) => [x.agent, x.error]),
    [
      ['claude', 'Not signed in to a Claude plan: run claude, then /login'],
      ['codex', 'Not signed in: run codex login'],
    ],
  )
  assert.equal(hits.length, 0)
  await rig.stop()
  await rig.start() // a fresh cache

  // the Keychain item (fake security) beats an older credentials file; Codex's auth.json
  const cred = (token: string, expiresAt: number) => JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt, subscriptionType: 'max' } })
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, '.claude', '.credentials.json'), cred('file-token', Date.now() + 1000))
  writeFileSync(join(rig.home, 'keychain'), cred('keychain-token', Date.now() + 3_600_000))
  mkdirSync(join(rig.home, '.codex'))
  writeFileSync(join(rig.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'codex-token', account_id: 'acc-1' } }))
  u = await rig.rpc('usage')
  assert.deepEqual(u[0].windows.map((w: any) => [w.label, w.used]), [['5-hour', 41], ['Weekly', 6]])
  assert.equal(u[0].plan, 'max')
  assert.deepEqual(u[1].windows.map((w: any) => [w.label, w.used]), [['5-hour', 12]])
  assert.equal(u[1].plan, 'team')
  assert.deepEqual([...hits].sort((a, b) => a.url.localeCompare(b.url)), [
    { url: '/api/oauth/usage', auth: 'Bearer keychain-token', beta: 'oauth-2025-04-20', account: undefined },
    { url: '/backend-api/wham/usage', auth: 'Bearer codex-token', beta: undefined, account: 'acc-1' },
  ])

  // kept: asking again (or many at once) doesn't ask the servers
  await Promise.all([rig.rpc('usage'), rig.rpc('usage')])
  assert.equal(hits.length, 2)

  // R4: one turned off isn't asked: its own numbers instead (none here)
  await rig.rpc('settingsSet', { usage: { claude: false, codex: true } })
  assert.deepEqual((await rig.rpc('usage')).map((x: any) => [x.agent, x.source, x.error]), [['claude', 'own', "No numbers yet: they come with Claude Code's status line, as a tab works (Settings › Layout › Read Claude's status line)"], ['codex', 'endpoint', undefined]])
  assert.equal(hits.length, 2)
  await rig.stop()
  await rig.start()

  // an expired token isn't sent (nor refreshed); a 401 says to sign in again
  writeFileSync(join(rig.home, 'keychain'), cred('old', Date.now() - 1000))
  writeFileSync(join(rig.home, '.claude', '.credentials.json'), cred('older', Date.now() - 2000))
  await rig.rpc('settingsSet', { usage: { claude: true } })
  u = await rig.rpc('usage')
  assert.deepEqual([u.length, u[0].error, u[0].plan, u[1].source, u[1].error], [2, 'Sign-in expired: Claude Code renews it on its next run', 'max', 'endpoint', 'This Codex doesn’t say its limits: update it, or ask chatgpt.com with your sign-in'], 'codex asked, not chatgpt.com: it isn’t on')
  assert.equal(hits.length, 2)
  await rig.stop()
  await rig.start()
  writeFileSync(join(rig.home, 'keychain'), cred('revoked', Date.now() + 3_600_000))
  claudeCode = 401
  u = await rig.rpc('usage')
  assert.equal(u[0].error, 'Sign-in expired: Claude Code renews it on its next run')
  assert.equal(hits.at(-1)?.auth, 'Bearer revoked')
})

test('usage: R4: by default no server is asked, signed in or not (codex says its own); an install from before hears it once', async t => {
  let hits = 0
  const srv = createServer((_q, r) => (hits++, r.writeHead(500).end()))
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 } }))
  mkdirSync(join(rig.home, '.codex'))
  writeFileSync(join(rig.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'codex-token', account_id: 'acc-1' } }))
  assert.deepEqual((await rig.rpc('usage')).map((x: any) => [x.agent, x.source, x.windows.length]), [['claude', 'own', 0], ['codex', 'endpoint', 3]])
  assert.equal(hits, 0)
  assert.equal((await rig.rpc('state')).settings.usageNote, false, 'a new install: no note')
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  delete st.settings.usageNote
  writeFileSync(file, JSON.stringify(st))
  await rig.start()
  assert.equal((await rig.rpc('state')).settings.usageNote, true, 'from before: the note')
  await rig.rpc('settingsSet', { usageNote: false })
  await rig.stop()
  await rig.start()
  assert.equal((await rig.rpc('state')).settings.usageNote, false, 'once')
})

test('usage: Claude asked every 7.5 minutes; told to wait, its Retry-After or longer each time, the last numbers kept', async t => {
  assert.deepEqual([waitOf('120'), waitOf(null), waitOf('soon'), waitOf(new Date(Date.now() + 60_000).toUTCString()) > 50_000], [120_000, 0, 0, true])
  let code = 200
  let retry: string | undefined
  let hits = 0
  const srv = createServer((_q, r) => {
    hits++
    r.writeHead(code, { 'content-type': 'application/json', ...(retry && { 'retry-after': retry }) })
    r.end(code === 200 ? JSON.stringify({ five_hour: { utilization: 41 } }) : '{}')
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await rig.rpc('settingsSet', { usage: { claude: true } }) // R4: Claude's endpoint asked for; Codex's own numbers (none yet)
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 86_400_000 } }))
  const min = 60_000
  const t0 = Date.now()
  const at = async (m: number) => (await rig.rpc('usage', { now: t0 + m * min }))[0]
  assert.equal((await at(0)).windows[0].used, 41)
  assert.equal((await at(7)).windows[0].used, 41)
  assert.equal(hits, 1) // 7 minutes on: kept

  code = 429
  retry = '1800'
  let u = await at(8)
  assert.deepEqual([hits, u.windows[0].used, u.error, u.next], [2, 41, 'Anthropic asked Laki to check less often', t0 + 38 * min]) // its Retry-After
  await at(37)
  assert.equal(hits, 2)
  retry = undefined
  u = await at(39)
  assert.deepEqual([hits, u.windows[0].used, u.next], [3, 41, t0 + 59 * min]) // the second time in a row: 20 minutes
  await at(58)
  assert.equal(hits, 3)

  code = 200
  u = await at(60)
  assert.deepEqual([hits, u.error, u.next], [4, undefined, undefined])
  code = 429
  assert.equal((await at(67)).next, undefined) // 7 minutes on: kept
  assert.equal((await at(68)).next, t0 + 78 * min) // back to 10 after an answer
})

test('laki limits: each agent read or its own error, --agent, --json; the policy, and Recording mode without account names; laki_limits', async t => {
  const srv = createServer((q, r) => {
    if (q.url === '/api/oauth/usage') {
      r.writeHead(200, { 'content-type': 'application/json' })
      return r.end(JSON.stringify({ five_hour: { utilization: 62, resets_at: new Date(Date.now() + 3600e3).toISOString() }, seven_day: { utilization: 41 } }))
    }
    r.writeHead(500).end() // codex's reader fails
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const policy = join(mkdtempSync(join(tmpdir(), 'laki-policy-')), 'policy.json')
  t.after(() => rmSync(dirname(policy), { recursive: true, force: true }))
  writeFileSync(policy, '{}')
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, LAKI_POLICY: policy, FAKE_CODEX_LIMITS: 'unknown' } })
  await rig.rpc('settingsSet', { usage: { claude: true, codex: true } }) // R4: the endpoints, asked for
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token', expiresAt: Date.now() + 3_600_000, subscriptionType: 'max' } }))
  mkdirSync(join(rig.home, '.codex'))
  writeFileSync(join(rig.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'fake-token', account_id: 'acc-1' } }))

  const { code, out } = await rig.cli('limits')
  assert.equal(code, 0)
  const [claude, codex] = out.trim().split('\n')
  assert.match(claude, /^claude\s+Default\s+5-hour 62% used · resets (\d\d:\d\d|[A-Z][a-z]{2})\s+Weekly 41% used$/) // in an hour: tomorrow's weekday after 23:00
  assert.match(codex, /^codex\s+Default\s+error: HTTP 500$/)

  const one = JSON.parse((await rig.cli('limits', '--agent', 'claude', '--json')).out)
  assert.deepEqual([one.length, one[0].agent, one[0].name, one[0].plan], [1, 'claude', 'Default', 'max'])
  assert.deepEqual(JSON.parse((await rig.cli('limits', '--agent', 'grok', '--json')).out), [])
  assert.match((await rig.cli('limits', '--agent', 'grok')).out, /no plan limits to show/)

  await rig.rpc('settingsSet', { recording: true })
  assert.deepEqual((await rig.rpc('limits')).map((u: any) => [u.agent, u.name, u.account]), [['claude', undefined, undefined], ['codex', undefined, undefined]])
  await rig.rpc('settingsSet', { recording: false })

  writeFileSync(policy, JSON.stringify({ agents: ['codex'] }))
  await rig.stop()
  await rig.start()
  assert.deepEqual((await rig.rpc('limits')).map((u: any) => u.agent), ['codex'], 'only what the policy allows')

  // the same for agents and Laki AI
  const tool = tools(rig.rpc as any).find(x => x.name === 'laki_limits')!
  assert.deepEqual((await tool.run({}) as any[]).map(u => u.agent), ['codex'])
})

test('usage: Grok’s sign-in and billing view; agy’s /usage reply, a turn it took, an error', () => {
  const later = new Date(Date.now() + 3600e3).toISOString()
  const past = new Date(Date.now() - 1000).toISOString()
  assert.equal(grokCred({ 'https://other.example': { key: 'o' }, 'https://auth.x.ai::cli': { key: 'old', expires_at: past }, 'https://auth.x.ai': { key: 'new', expires_at: later } })?.key, 'new')
  assert.equal(grokCred({ 'https://auth.x.ai': { key: 'old', expires_at: past }, 'https://other.example': { key: 'o' } })?.key, 'old', "xAI's own, expired, over another issuer's")
  assert.equal(grokCred({ 'https://other.example': { key: 'o' } })?.key, 'o')
  assert.equal(grokCred({ 'https://auth.x.ai': { key: '' } }), undefined)
  assert.equal(grokCred(null), undefined)
  assert.deepEqual(grokWindows({ config: { creditUsagePercent: 41.6, currentPeriod: { end: '2026-11-29T00:00:00Z' } } }), [{ label: 'Weekly', used: 42, resets: Date.parse('2026-11-29T00:00:00Z') }])
  assert.deepEqual(grokWindows({ monthlyLimit: { val: '50' }, used: { val: 12.5 }, billingPeriodEnd: '2026-12-01T00:00:00Z' }), [{ label: 'Monthly', used: 25, resets: Date.parse('2026-12-01T00:00:00Z') }])
  assert.deepEqual(grokWindows({ config: { monthlyLimit: { val: '0' }, used: { val: '3' } } }), [], 'no limit: no percent')
  assert.deepEqual(grokWindows({}), [])

  // agy 1.5.14's reply, shortened: the 5-hour windows first (the ring's), a disabled bucket left out
  const groups = [
    { name: 'Gemini Models', buckets: [{ window: 'weekly', remaining_fraction: 0.9542791843414307, reset_time: '2026-11-28T21:44:50Z' }, { window: '5h', remaining_fraction: 1, reset_time: '2026-11-22T13:27:41Z' }] },
    { name: 'Claude and GPT models', buckets: [{ window: 'weekly', remaining_fraction: 1 }, { window: '5h', remaining_fraction: 0.5 }] },
    { name: 'Gemini 4 Argon', buckets: [{ name: 'Gemini 4 Argon Weekly Limit', window: 'weekly', remaining_fraction: 1 }, { window: '5h', disabled: true, remaining_fraction: 1 }] },
  ]
  const real = { conversation_id: '', status: 'SUCCESS', num_turns: 0, command: { name: 'usage', data: { groups } } }
  const r = agyRead(`agy: a log line\n${JSON.stringify(real)}\n`)
  assert.deepEqual(r.windows?.map(w => [w.label, w.used]), [['5-hour · Gemini', 0], ['5-hour · Claude and GPT', 50], ['Weekly · Gemini', 5], ['Weekly · Claude and GPT', 0], ['Weekly · Gemini 4 Argon', 0]])
  assert.equal(r.windows?.[0].resets, Date.parse('2026-11-22T13:27:41Z'))
  assert.deepEqual(agyRead(JSON.stringify({ ...real, num_turns: 1 })), { billed: true }, 'a turn: billed, never asked again')
  assert.deepEqual(agyRead(JSON.stringify({ ...real, conversation_id: 'c1' })), { billed: true })
  assert.deepEqual(agyRead(JSON.stringify({ status: 'ERROR', error: 'not logged in' })), { error: 'not logged in' })
  assert.deepEqual(agyRead('{"status":"SUCCESS","response":"hi"}\nnot json'), {})
})

test('usage: Grok asked with its own sign-in only when turned on; Antigravity from agy’s own /usage unless turned off', async t => {
  const hits: { url: string; auth?: string; cli?: string; user?: string }[] = []
  const srv = createServer((q, r) => {
    hits.push({ url: q.url!, auth: q.headers.authorization, cli: q.headers['x-xai-token-auth'] as string, user: q.headers['x-userid'] as string })
    if (q.url === '/v1/billing?format=credits') return r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ config: { creditUsagePercent: 30, subscriptionTier: 'SuperGrok', currentPeriod: { end: '2099-01-01T00:00:00Z' } } }))
    r.writeHead(404).end()
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  assert.deepEqual((await rig.rpc('usage')).map((x: any) => x.agent), ['claude', 'codex'], 'neither signed in on this Mac: no rows (agy on PATH alone isn’t enough)')
  writeFileSync(join(rig.home, 'fake.log'), '', { flag: 'a' }) // none yet: nothing ran
  assert.equal(rig.fakeLog().filter(l => l.bin === 'agy').length, 0)

  mkdirSync(join(rig.home, '.grok'))
  writeFileSync(join(rig.home, '.grok', 'auth.json'), JSON.stringify({ 'https://auth.x.ai': { key: 'fake-grok-token', user_id: 'u-1', expires_at: new Date(Date.now() + 3600e3).toISOString() } }))
  mkdirSync(join(rig.home, '.gemini', 'antigravity-cli'), { recursive: true })
  let u = await rig.rpc('usage')
  const row = (a: string) => u.find((x: any) => x.agent === a)
  assert.deepEqual(u.map((x: any) => x.agent), ['claude', 'codex', 'grok', 'gemini'])
  assert.equal(row('grok').error, 'Laki asks grok.com for these only when you say so: Settings › Layout › Ask grok.com')
  assert.equal(hits.length, 0, "Grok's server: not asked by default")
  assert.deepEqual([row('gemini').source, row('gemini').error, row('gemini').windows.map((w: any) => [w.label, w.used])], ['endpoint', undefined, [['5-hour · Gemini', 60], ['Weekly · Gemini', 25]]])
  const agy = rig.fakeLog().filter(l => l.bin === 'agy')
  assert.deepEqual(agy.map(l => l.args), [['--version'], ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s']])
  assert.ok(agy.every(l => l.noUpdate === 'true'), 'agy never updates itself mid-check')

  await rig.rpc('settingsSet', { usage: { grok: true, gemini: false } })
  u = await rig.rpc('usage')
  assert.deepEqual(u.map((x: any) => x.agent), ['claude', 'codex', 'grok'], 'agy turned off: no row')
  assert.deepEqual([row('grok').source, row('grok').plan, row('grok').windows.map((w: any) => [w.label, w.used, w.resets])], ['endpoint', 'SuperGrok', [['Weekly', 30, Date.parse('2099-01-01T00:00:00Z')]]])
  assert.deepEqual(hits, [{ url: '/v1/billing?format=credits', auth: 'Bearer fake-grok-token', cli: 'xai-grok-cli', user: 'u-1' }])
  assert.equal(rig.fakeLog().filter(l => l.bin === 'agy').length, 2, 'not run again')
})

test('usage: Codex asked through its own app server (the account’s CODEX_HOME), kept 5 minutes; an older one: chatgpt.com only when asked for; no answer in 15 s: killed', async t => {
  const hits: string[] = []
  const srv = createServer((q, r) => (hits.push(q.url!), r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000 } } }))))
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const env = (lim?: string) => ({ LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, LAKI_CODEX_APP_MS: '1500', ...(lim && { FAKE_CODEX_LIMITS: lim }) })
  const rig = await fresh(t, { env: env() })
  const codex = async () => (await rig.rpc('usage')).find((x: any) => x.agent === 'codex')
  const asks = () => rig.fakeLog().filter((l: any) => l.bin === 'codex' && l.args[0] === 'app-server')
  let u = await codex()
  assert.deepEqual([u.source, u.plan, u.error, u.windows.map((w: any) => [w.label, w.used])], ['endpoint', 'plus', undefined, [['5-hour', 21], ['Weekly', 8], ['Weekly · GPT-X', 50]]])
  assert.ok(u.windows[0].resets > Date.now())
  assert.deepEqual([asks().length, asks()[0].env.CODEX_HOME, hits], [1, undefined, []], 'the agent’s own home; no server')
  await codex()
  assert.equal(asks().length, 1, 'kept 5 minutes')
  // an account: its own folder as CODEX_HOME
  const acct = await rig.rpc('accountAdd', { agent: 'codex', name: 'Work' })
  await until(async () => (await rig.rpc('usage')).filter((x: any) => x.agent === 'codex').length === 2, 'its row')
  assert.ok(asks().some((l: any) => l.env.CODEX_HOME === acct.dir), JSON.stringify(asks().map((l: any) => l.env)))
  // off: not asked
  await rig.rpc('settingsSet', { usage: { codex: false } })
  const n = asks().length
  assert.equal((await codex()).source, 'own')
  assert.equal(asks().length, n)
  await rig.stop()

  // a codex that doesn't know account/rateLimits/read: said so, chatgpt.com not asked; asked once it's on
  Object.assign(rig.env, env('unknown')) // the rig's own env object: its next start's
  await rig.start()
  await rig.rpc('settingsSet', { usage: {} })
  u = await codex()
  assert.deepEqual([u.error, hits], ['This Codex doesn’t say its limits: update it, or ask chatgpt.com with your sign-in', []])
  await rig.stop()
  await rig.start()
  mkdirSync(join(rig.home, '.codex'), { recursive: true })
  writeFileSync(join(rig.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'fake-codex-token' } }))
  await rig.rpc('settingsSet', { usage: { codex: true } })
  u = await codex()
  assert.deepEqual([u.error, u.windows.map((w: any) => [w.label, w.used]), hits], [undefined, [['5-hour', 12]], ['/backend-api/wham/usage']])
  await rig.stop()

  // no answer: killed at its time, asked again a minute later; its own error said
  Object.assign(rig.env, env('slow')) // the rig's own env object: its next start's
  await rig.start()
  await rig.rpc('settingsSet', { usage: {} })
  u = await codex()
  assert.equal(u.error, "codex didn't say its limits in 1.5 seconds")
  await rig.stop()
  Object.assign(rig.env, env('fail')) // the rig's own env object: its next start's
  await rig.start()
  assert.equal((await codex()).error, 'Codex: not signed in')
})

// Read-only (usage.ts' head): asked with every reader on and turned away, Laki asks no token endpoint and leaves each
// sign-in it read byte for byte as it was
test('usage: guard: turned away (401) with Claude and Codex asked for, no token refresh is tried and no sign-in file changes', async t => {
  const urls: string[] = []
  const srv = createServer((q, r) => (urls.push(q.url!), r.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"invalid_token"}')))
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, FAKE_CODEX_LIMITS: 'unknown' } })
  const cred = JSON.stringify({ claudeAiOauth: { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: Date.now() + 3_600_000, subscriptionType: 'max' } })
  mkdirSync(join(rig.home, '.claude'))
  mkdirSync(join(rig.home, '.codex'))
  const files = [join(rig.home, 'keychain'), join(rig.home, '.claude', '.credentials.json'), join(rig.home, '.codex', 'auth.json')]
  writeFileSync(files[0], cred)
  writeFileSync(files[1], cred)
  writeFileSync(files[2], JSON.stringify({ tokens: { access_token: 'fake-codex-access', refresh_token: 'fake-codex-refresh', account_id: 'acc-1' }, last_refresh: '2026-11-01T00:00:00Z' }))
  const before = files.map(f => readFileSync(f))
  await rig.rpc('settingsSet', { usage: { claude: true, codex: true } })
  const u = await rig.rpc('usage')
  assert.deepEqual(u.map((x: any) => [x.agent, x.error]), [['claude', 'Sign-in expired: Claude Code renews it on its next run'], ['codex', 'Sign-in expired: Codex renews it on its next run']])
  assert.deepEqual(urls.sort(), ['/api/oauth/usage', '/backend-api/wham/usage'], 'the usage endpoints, once each')
  assert.equal(urls.filter(x => /oauth\/token|\/token/.test(x)).length, 0, 'no token endpoint')
  files.forEach((f, i) => assert.ok(readFileSync(f).equals(before[i]), `${f}: as it was`))
})
