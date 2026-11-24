// Improve my prompt: Laki AI rewrites a draft with the chat's context (promptImprove), its answer kept honest
// (improvedOf: fences and quotes off, the draft's @mentions, links, code and {{variables}} back if dropped); the user's alone.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { improvedOf, keepsOf, treeOf } from '../src/shared/improve.ts'
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

test('treeOf: a small list whole; 5,000 paths in 4,000 characters with every top-level entry and the rule files; folders with their counts', () => {
  const small = ['README.md', 'src/a.ts', 'src/lib/b.ts', 'package.json']
  assert.equal(treeOf(small, 4000), ['README.md', 'package.json', 'src/ (2 files)', 'src/a.ts', 'src/lib/ (1 file)', 'src/lib/b.ts'].join('\n'))
  const big = [
    'README.md', 'AGENTS.md', 'package.json', 'Makefile', '.gitignore',
    ...Array.from({ length: 5000 }, (_, i) => `packages/p${i % 40}/src/deep/dir${i % 7}/file-${i}.ts`),
    'packages/p3/package.json', 'docs/guide.md', 'docs/dev/CLAUDE.md',
  ]
  const t = treeOf(big, 4000)
  assert.ok(t.length <= 4000, `${t.length} characters`)
  const lines = t.split('\n')
  for (const top of ['README.md', 'AGENTS.md', 'package.json', 'Makefile', '.gitignore', 'packages/ (5001 files)', 'docs/ (2 files)']) assert.ok(lines.includes(top), top)
  for (const rule of ['packages/p3/package.json', 'docs/dev/CLAUDE.md']) assert.ok(lines.includes(rule), `${rule} named`)
  assert.ok(lines.includes('packages/p0/ (125 files)') && lines.includes('packages/p3/ (126 files)'), 'a folder below the top with its count')
  assert.deepEqual([...lines].sort(), lines, 'sorted: a folder before what is in it')
  assert.equal(treeOf([], 4000), '')
})

test("promptImprove: a new task's request carries the project's files (git ls-files); a tab's doesn't; git failing: none", async t => {
  const or = await openrouter(t, [reply({ content: 'one' }), reply({ content: 'two' }), reply({ content: 'three' })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-fakesecret' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('promptImprove', { prompt: 'fix the readme', project: p.id })
  const first = or.hits[0].body.messages.at(-1).content as string
  assert.match(first, /The chat so far \(data\):\n<<<\n\(none: a new task\)/)
  assert.match(first, /The project's files \(data\):\n<<<\nREADME\.md\n>>>$/, 'the repo\'s files, after the memory')
  assert.match(JSON.stringify(or.hits[0].body.messages), /name only paths that appear in the chat, the memory or the files block/i)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await rig.rpc('promptImprove', { prompt: 'fix the readme', tab })
  assert.doesNotMatch(or.hits[1].body.messages.at(-1).content, /The project's files/, 'a tab: its chat names what matters')
  rmSync(join(rig.repo, '.git'), { recursive: true, force: true })
  await rig.rpc('promptImprove', { prompt: 'fix the readme', project: p.id })
  assert.doesNotMatch(or.hits[2].body.messages.at(-1).content, /The project's files/, 'git failed: the request without it')
})
