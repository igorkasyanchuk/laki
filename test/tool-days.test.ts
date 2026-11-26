// What agents call (toolDays.ts, main.ts' call): an agent's calls counted per method, a gate's refusal and a method's
// error apart, its last error redacted; your own calls not counted; agentCalls is yours, with the tools none called
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('agentCalls: an agent\'s calls, refusals and errors per method, the last error redacted; yours not counted', async t => {
  const rig = await fresh(t, { env: { LAKI_TOOL_SAVE_MS: '100' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const one = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(one.id))).id
  const from = { ws: one.id, tab }
  // two good ones, one refused by its gate, one whose method fails (a token-shaped name in its error)
  await rig.rpc('files', { ws: one.id, from })
  await rig.rpc('files', { ws: one.id, from })
  await assert.rejects(rig.rpc('shareStart', { tab, from }), /an agent can't share/)
  const token = `ghp_${'a1'.repeat(15)}`
  await assert.rejects(rig.rpc('wsStat', { ws: token, from }), /no workspace/)
  // yours: not counted
  await rig.rpc('files', { ws: one.id })
  await assert.rejects(rig.rpc('wsStat', { ws: 'nope' }))
  // an agent can't read them
  await assert.rejects(rig.rpc('agentCalls', { from }), /it's the user's/)
  const r = await rig.rpc('agentCalls')
  const row = (m: string) => r.rows.find((x: any) => x.method === m)
  assert.deepEqual([row('files').calls, row('files').refused, row('files').errors], [2, 0, 0])
  assert.deepEqual([row('shareStart').calls, row('shareStart').refused, row('shareStart').errors], [1, 1, 0])
  assert.deepEqual([row('wsStat').calls, row('wsStat').refused, row('wsStat').errors], [1, 0, 1])
  assert.match(row('wsStat').last.text, /^no workspace ghp_•+$|^no workspace •+$/, 'the token masked')
  assert.ok(row('wsStat').last.text.length <= 120)
  assert.match(row('shareStart').last.text, /share/)
  assert.deepEqual([row('agentCalls').calls, row('agentCalls').refused], [1, 1], "the agent's refused one; yours not")
  assert.equal(r.rows[0].method === 'files', false, 'the failing ones first')
  assert.ok(r.unused.includes('laki_state'), 'a tool none called')
  assert.ok(!r.unused.some((n: string) => n === 'laki_status'), 'only real tools')
  // kept: written within the save's wait, the params never in it
  await until(() => readFileSync(join(rig.data, 'tool-days.json'), 'utf8').includes('wsStat'), 'tool-days.json written')
  const kept = readFileSync(join(rig.data, 'tool-days.json'), 'utf8')
  assert.ok(!kept.includes(token) && !kept.includes(tab), 'no secrets, no params')
})
