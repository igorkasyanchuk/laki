// Reader view: a claude tab's chat from its transcript (meters.ts chatRead), read on as it grows; the same v: nothing new;
// no transcript: none; an agent's call refused.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('tabHandover: a codex tab beside the claude one, told to read a handover of the chat and the changes', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'chat-h.jsonl'), line({ type: 'user', message: { content: 'Fix the total' } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Rounded it in cart.ts.' }] } }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-h' } })
  await until(async () => (await rig.rpc('chatRead', { tab: tab.id })).said, 'its chat')
  writeFileSync(join(ws.path, 'cart.ts'), 'export const total = 1\n')
  await assert.rejects(rig.rpc('tabHandover', { tab: tab.id, to: 'claude' }), /the other one/)
  await assert.rejects(rig.rpc('tabHandover', { tab: tab.id, from: { tab: tab.id } }), /hand its chat to another agent/) // an agent's: the user's to do
  const r = await rig.rpc('tabHandover', { tab: tab.id })
  assert.equal(r.name, 'codex: continued')
  const md = readFileSync(r.file, 'utf8')
  assert.match(md, /^# Handover from Claude Code/)
  assert.match(md, /### The user\n\nFix the total/)
  assert.match(md, /### Claude Code\n\nRounded it in cart\.ts\./)
  assert.match(md, /- cart\.ts \(\+1 −0\)/)
  const tabs = (await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id)
  assert.deepEqual(tabs.map((x: any) => x.preset), ['claude', 'codex']) // the old one stays
  const prompt = await until(() => (f => existsSync(f) && (l => l.includes('"bin":"codex"') && l)(readFileSync(f, 'utf8')))(join(rig.home, 'fake.log')), 'codex started')
  assert.ok(String(prompt).includes(r.file), 'its prompt names the handover')
})
