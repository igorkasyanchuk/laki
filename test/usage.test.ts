import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { base, claudeWindows, codexWindows, waitOf } from '../src/daemon/usage.ts'
import { tools } from '../src/shared/tools.ts'
import { fresh } from './helpers.ts'

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
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
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
  assert.deepEqual((await rig.rpc('usage')).map((x: any) => [x.agent, x.source, x.error]), [['claude', 'own', "No numbers yet: they come with Claude Code's status line, as a tab works (Settings › Appearance › Read Claude's status line)"], ['codex', 'endpoint', undefined]])
  assert.equal(hits.length, 2)
  await rig.stop()
  await rig.start()

  // an expired token isn't sent (nor refreshed); a 401 says to sign in again
  writeFileSync(join(rig.home, 'keychain'), cred('old', Date.now() - 1000))
  writeFileSync(join(rig.home, '.claude', '.credentials.json'), cred('older', Date.now() - 2000))
  await rig.rpc('settingsSet', { usage: { claude: true } })
  u = await rig.rpc('usage')
  assert.deepEqual([u.length, u[0].error, u[0].plan, u[1].source], [2, 'Sign-in expired: Claude Code renews it on its next run', 'max', 'own'])
  assert.equal(hits.length, 2)
  await rig.stop()
  await rig.start()
  writeFileSync(join(rig.home, 'keychain'), cred('revoked', Date.now() + 3_600_000))
  claudeCode = 401
  u = await rig.rpc('usage')
  assert.equal(u[0].error, 'Sign-in expired: Claude Code renews it on its next run')
  assert.equal(hits.at(-1)?.auth, 'Bearer revoked')
})

test('usage: R4: by default no server is asked, signed in or not; an install from before hears it once', async t => {
  let hits = 0
  const srv = createServer((_q, r) => (hits++, r.writeHead(500).end()))
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  mkdirSync(join(rig.home, '.claude'))
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 } }))
  mkdirSync(join(rig.home, '.codex'))
  writeFileSync(join(rig.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'codex-token', account_id: 'acc-1' } }))
  assert.deepEqual((await rig.rpc('usage')).map((x: any) => [x.agent, x.source]), [['claude', 'own'], ['codex', 'own']])
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

// Gemini CLI: its oauth_creds.json read only; an expired token refreshed once, in memory; the project from
// loadCodeAssist; each model's bucket a window; an API-key user unknown; a 429 waits as waitOf says
test('usage: Gemini CLI per model, its expired token refreshed once in memory, nothing written under ~/.gemini', async t => {
  const hits: { url: string; auth?: string; body: string }[] = []
  let quota = 200
  const srv = createServer((q, r) => {
    let body = ''
    q.on('data', c => (body += c))
    q.on('end', () => {
      hits.push({ url: q.url!, auth: q.headers.authorization, body })
      const json = (o: object, code = 200, h: Record<string, string> = {}) => (r.writeHead(code, { 'content-type': 'application/json', ...h }), r.end(JSON.stringify(o)))
      if (q.url === '/token') return json({ access_token: 'fresh-token', expires_in: 3600, refresh_token: 'never-kept' })
      if (q.url === '/v1internal:loadCodeAssist') return json({ cloudaicompanionProject: 'proj-1' })
      if (q.url === '/v1internal:retrieveUserQuota') return quota === 429 ? json({}, 429, { 'retry-after': '120' }) : json({ buckets: [{ modelId: 'gemini-2.5-pro', tokenType: 'REQUESTS', remainingFraction: 0.75, resetTime: '2026-11-07T00:00:00Z' }, { modelId: 'models/gemini-2.5-flash', remainingFraction: 0.1 }] })
      r.writeHead(404).end()
    })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await rig.rpc('settingsSet', { usage: { gemini: true } }) // R4: asked for; Claude's and Codex's own numbers (none here) left out below
  const gem = async (p?: object) => (await rig.rpc('usage', p)).filter((x: any) => x.agent === 'gemini')
  assert.deepEqual(await gem(), [], 'no Gemini sign-in: not listed')
  const g = join(rig.home, '.gemini')
  mkdirSync(g)
  // Gemini CLI's own client, read from its install: the gemini on PATH ($HOME/bin, first), its core's oauth2.js
  const pkg = join(rig.home, 'gemini-cli')
  const core = join(pkg, 'node_modules/@google/gemini-cli-core/dist/src/code_assist')
  mkdirSync(core, { recursive: true })
  mkdirSync(join(pkg, 'dist'))
  writeFileSync(join(pkg, 'package.json'), '{"name":"@google/gemini-cli"}')
  writeFileSync(join(pkg, 'dist/index.js'), '#!/usr/bin/env node\n')
  writeFileSync(join(core, 'oauth2.js'), "const OAUTH_CLIENT_ID = 'fake-id.apps.googleusercontent.com';\nconst OAUTH_CLIENT_SECRET = 'fake-secret';\n")
  mkdirSync(join(rig.home, 'bin'), { recursive: true })
  symlinkSync(join(pkg, 'dist/index.js'), join(rig.home, 'bin/gemini'))
  const creds = JSON.stringify({ access_token: 'old-token', refresh_token: 'refresh-1', expiry_date: Date.now() - 1000 })
  writeFileSync(join(g, 'oauth_creds.json'), creds)
  const u = await gem()
  assert.deepEqual(u.map((x: any) => [x.agent, x.error, x.windows.map((w: any) => [w.label, w.used, w.resets])]), [['gemini', undefined, [['gemini-2.5-pro', 25, Date.parse('2026-11-07T00:00:00Z')], ['gemini-2.5-flash', 90, undefined]]]])
  assert.deepEqual(hits.map(h => h.url), ['/token', '/v1internal:loadCodeAssist', '/v1internal:retrieveUserQuota'])
  const form = new URLSearchParams(hits[0].body)
  assert.deepEqual([form.get('grant_type'), form.get('refresh_token'), form.get('client_id'), form.get('client_secret')], ['refresh_token', 'refresh-1', 'fake-id.apps.googleusercontent.com', 'fake-secret'])
  assert.equal(hits[2].auth, 'Bearer fresh-token')
  assert.deepEqual(JSON.parse(hits[2].body), { project: 'proj-1' })
  assert.equal(readFileSync(join(g, 'oauth_creds.json'), 'utf8'), creds, 'its sign-in untouched')
  assert.deepEqual(readdirSync(g), ['oauth_creds.json'], 'nothing written under ~/.gemini')
  // kept 5 minutes; then the token in memory is used, not refreshed again
  await gem({ now: Date.now() + 6 * 60_000 })
  assert.deepEqual(hits.map(h => h.url).filter(x => x === '/token').length, 1, 'refreshed once')
  // told to wait: Retry-After, the last numbers kept
  quota = 429
  const w = await gem({ now: Date.now() + 12 * 60_000 })
  assert.match(w[0].error, /asked Laki to check less often/)
  assert.equal(w[0].windows.length, 2)
  assert.ok(w[0].next >= Date.now() + 10 * 60_000, 'waits its back-off at least')
  // no Gemini CLI to read its client from: unknown, Google not asked
  await rig.stop()
  rmSync(join(rig.home, 'bin/gemini'))
  await rig.start()
  const m = hits.length
  assert.match((await gem())[0].error, /^Unknown: the sign-in expired/)
  assert.equal(hits.length, m)
  // an API-key user: unknown, nothing asked
  await rig.stop()
  writeFileSync(join(g, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } }))
  await rig.start()
  const n = hits.length
  const k = await gem()
  assert.match(k[0].error, /^Unknown: signed in with an API key/)
  assert.equal(hits.length, n)
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
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, LAKI_POLICY: policy } })
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
