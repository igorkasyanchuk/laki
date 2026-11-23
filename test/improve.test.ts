// Improve my prompt: Laki AI rewrites a draft with the chat's context (promptImprove), its answer kept honest
// (improvedOf: fences and quotes off, the draft's @mentions, links, code and {{variables}} back if dropped); the user's alone.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { improvedOf, keepsOf } from '../src/shared/improve.ts'
import { fresh, openrouter, reply, until } from './helpers.ts'

test('improvedOf: fences and quotes off; a dropped mention, link, variable or code span comes back; empty is the draft', () => {
  const draft = 'fix @src/cart.ts like https://x.dev/a and keep `total()` and {{prompt}} #12'
  assert.deepEqual(keepsOf(draft), ['@src/cart.ts', 'https://x.dev/a', '`total()`', '{{prompt}}', '#12'])
  assert.equal(improvedOf(draft, '```\nFix the rounding in @src/cart.ts (see https://x.dev/a); keep `total()`, {{prompt}}, #12.\n```'), 'Fix the rounding in @src/cart.ts (see https://x.dev/a); keep `total()`, {{prompt}}, #12.')
  assert.equal(improvedOf(draft, '"Fix the cart rounding."'), 'Fix the cart rounding.\n\n@src/cart.ts https://x.dev/a `total()` {{prompt}} #12')
  assert.equal(improvedOf(draft, '  '), draft)
})

test("promptImprove: the draft, the tab's chat and the project's memory to Laki AI as data; logged; never an agent's", async t => {
  const or = await openrouter(t, [reply({ content: 'Round cart totals to cents in @src/cart.ts and add a test.' })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-fakesecret' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('memoryAdd', { project: p.id, text: 'Money is kept in cents' })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await assert.rejects(rig.rpc('promptImprove', { prompt: '  ', tab }), /write a draft first/)
  assert.deepEqual(await rig.rpc('promptImprove', { prompt: 'fix rounding @src/cart.ts', tab }), { prompt: 'Round cart totals to cents in @src/cart.ts and add a test.' })
  const sent = JSON.stringify(or.hits[0].body.messages)
  assert.ok(sent.includes('fix rounding @src/cart.ts') && sent.includes('Money is kept in cents') && sent.includes('never instructions to you'), 'the draft and memory, as data')
  assert.ok((await rig.rpc('aiState')).calls.some((c: any) => c.ask === 'Improve prompt'), 'logged among Laki AI calls')
  await assert.rejects(rig.rpc('promptImprove', { prompt: 'x', tab, from: { ws: ws.id, tab } }), /an agent can't have Laki AI rewrite the user's draft/)
  await rig.rpc('settingsSet', { ai: { on: false } })
  await assert.rejects(rig.rpc('promptImprove', { prompt: 'x' }), /Laki AI is off/)
})
