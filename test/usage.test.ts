import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { base, claudeWindows, codexWindows } from '../src/daemon/usage.ts'
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

  // an agent turned off isn't listed
  await rig.rpc('settingsSet', { usage: { claude: false } })
  assert.deepEqual((await rig.rpc('usage')).map((x: any) => x.agent), ['codex'])
  await rig.stop()
  await rig.start()

  // an expired token isn't sent (nor refreshed); a 401 says to sign in again
  writeFileSync(join(rig.home, 'keychain'), cred('old', Date.now() - 1000))
  writeFileSync(join(rig.home, '.claude', '.credentials.json'), cred('older', Date.now() - 2000))
  await rig.rpc('settingsSet', { usage: { codex: false } })
  u = await rig.rpc('usage')
  assert.deepEqual([u.length, u[0].error, u[0].plan], [1, 'Sign-in expired: Claude Code renews it on its next run', 'max'])
  assert.equal(hits.length, 2)
  await rig.stop()
  await rig.start()
  writeFileSync(join(rig.home, 'keychain'), cred('revoked', Date.now() + 3_600_000))
  claudeCode = 401
  u = await rig.rpc('usage')
  assert.equal(u[0].error, 'Sign-in expired: Claude Code renews it on its next run')
  assert.equal(hits.at(-1)?.auth, 'Bearer revoked')
})
