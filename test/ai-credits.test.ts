// Usage's OpenRouter part (ai.ts aiCredits): the account's credits (/credits) and the key's spend (/key), each shown when
// the other is refused, low under $1 or 10% left; kept until the key changes; laki limits' line; an agent's call refused
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

test('aiCredits: credits and the key spend, each on its own, low, kept, the CLI line; no key: null; an agent may not', async t => {
  let mode = 'both'
  const asked: string[] = []
  const srv = createServer((q, r) => {
    asked.push(`${q.url} ${q.headers.authorization}`)
    const json = (code: number, data: unknown) => r.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data))
    if (mode === 'none') return json(401, { error: { message: 'no' } })
    if (q.url === '/key') return json(200, { data: { label: 'sk-or-v1-abc…', usage: 9.5, usage_daily: 0.42, usage_weekly: 3.1, usage_monthly: 9.5, limit: mode === 'limit' ? 10 : null, limit_remaining: mode === 'limit' ? 0.5 : null } })
    if (q.url === '/credits') return mode === 'both' ? json(200, { data: { total_credits: 20, total_usage: 9.5 } }) : json(403, { error: { message: 'a provisioning key only' } })
    json(404, {})
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  assert.equal(await rig.rpc('aiCredits'), null, 'no key: nothing asked')
  assert.equal(asked.length, 0)

  await rig.rpc('aiKey', { key: 'sk-or-v1-fake-one' })
  const both = await rig.rpc('aiCredits')
  assert.deepEqual(both.credits, { total: 20, used: 9.5 })
  assert.deepEqual(both.key, { day: 0.42, week: 3.1, month: 9.5 }, 'no limit of its own')
  assert.equal(both.low, false)
  assert.ok(asked.every(a => a.endsWith('Bearer sk-or-v1-fake-one')), 'with the key')
  const n = asked.length
  assert.deepEqual(await rig.rpc('aiCredits'), both, 'kept: not asked again')
  assert.equal(asked.length, n)
  const cli = await rig.cli('limits')
  assert.match(cli.out, /openrouter\s+Laki AI\s+credits \$10\.50 left of \$20\.00\s+this key \$0\.42 today, \$3\.10 this week, \$9\.50 this month/)

  // credits refused (an ordinary key), the key's own limit nearly spent: its spend alone, low
  mode = 'limit'
  await rig.rpc('aiKey', { key: 'sk-or-v1-fake-two' }) // a new key: asked again
  const lim = await rig.rpc('aiCredits')
  assert.equal(lim.credits, undefined)
  assert.deepEqual(lim.key, { day: 0.42, week: 3.1, month: 9.5, limit: 10, left: 0.5 })
  assert.equal(lim.low, true)
  assert.equal(lim.error, undefined)
  assert.match((await rig.cli('limits')).out, /\$0\.50 of its \$10\.00 limit left\s+running low/)

  // neither answered: why
  mode = 'none'
  await rig.rpc('aiKey', { key: 'sk-or-v1-fake-three' })
  const none = await rig.rpc('aiCredits')
  assert.equal(none.error, 'OpenRouter refused the key')
  assert.equal(none.key, undefined)

  // an agent's: refused (Laki AI's spend is the user's); its laki limits has no OpenRouter line
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id).id
  await assert.rejects(rig.rpc('aiCredits', { from: { ws: ws.id, tab } }), /OpenRouter credits and spend/)
})
