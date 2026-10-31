// Reader view: a claude tab's chat from its transcript (meters.ts chatRead), read on as it grows; the same v: nothing new;
// no transcript: none; an agent's call refused.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const line = (o: object) => JSON.stringify(o) + '\n'

test("chatRead: a tab's chat as what was said, read on as it grows", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  assert.deepEqual(await rig.rpc('chatRead', { tab: tab.id }), { none: true }) // nothing written yet
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-r.jsonl')
  writeFileSync(file, line({ type: 'user', message: { content: 'Fix the total' } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'cart.ts' } }] } }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-r' } })
  const a = await until(async () => (r => r.said && r)(await rig.rpc('chatRead', { tab: tab.id })), 'its chat')
  assert.deepEqual(a.said, [{ who: 'you', text: 'Fix the total' }, { who: 'agent', text: 'Looking.' }, { who: 'tool', text: 'Read: cart.ts' }])
  assert.deepEqual(await rig.rpc('chatRead', { tab: tab.id, v: a.v }), { v: a.v }) // nothing new
  appendFileSync(file, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed: **rounding**.' }] } }))
  const b = await rig.rpc('chatRead', { tab: tab.id, v: a.v })
  assert.equal(b.said.at(-1).text, 'Fixed: **rounding**.')
  // from an agent's tab: refused
  await assert.rejects(rig.rpc('chatRead', { tab: tab.id, from: { tab: tab.id } }), /read a tab's chat/)
})
