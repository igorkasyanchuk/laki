import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { test } from 'node:test'
import { hunkKey, hunksOf, REST, riskOf, WALK_MAX, walkCheck, walkFold, walkInput, type WalkStep } from '../src/shared/walk.ts'
import { fresh, openrouter, reply, until } from './helpers.ts'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' one',
  '+two',
  '@@ -40,2 +41,2 @@ function f() {',
  '-old',
  '+new',
  'diff --git a/gone.ts b/gone.ts',
  'deleted file mode 100644',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-a',
  '-b',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/yarn.lock b/yarn.lock',
  '@@ -5 +5 @@',
  '-x',
  '+y',
].join('\n')

test('walk: a diff\'s hunks by file and new start (a file with none at 0, a deleted one\'s at 0), its cap\'s tail left out; riskOf\'s guesses', () => {
  const hs = hunksOf(`${DIFF}\n… (cut)`)
  assert.deepEqual(hs.map(h => hunkKey(h).replace('\0', ':')), ['src/a.ts:1', 'src/a.ts:41', 'gone.ts:0', 'logo.png:0', 'yarn.lock:5'])
  assert.equal(hs[1].text, '@@ -40,2 +41,2 @@ function f() {\n-old\n+new')
  assert.match(hs[3].text, /^diff --git a\/logo.png b\/logo.png\nBinary files/, "a hunkless file: its header lines")
  assert.equal(hs.at(-1)!.text, '@@ -5 +5 @@\n-x\n+y', 'no cut marker in it')
  assert.deepEqual(hs.map(h => riskOf(h) ?? ''), ['', '', 'deletes', '', 'lockfile'])
  const quoted = hunksOf('diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/x b/x\n@@ -2 +2 @@\n-c\n+d')
  assert.deepEqual(quoted.map(h => hunkKey(h).replace('\0', ':')), [':1', 'x:2'], "a quoted name's hunks kept, under '' as diffByFile keys them")
  assert.equal(riskOf({ file: 'db/migrate/20261122_add.rb', start: 1 }), 'migration')
  assert.equal(riskOf({ file: 'schema.sql', start: 1 }), 'migration')
  assert.equal(riskOf({ file: 'src/auth/session.ts', start: 1 }), 'auth')
  assert.equal(riskOf({ file: 'src/authorization/policy.ts', start: 1 }), 'auth')
  assert.equal(riskOf({ file: 'src/author.ts', start: 1 }), undefined, 'a word that only starts so')
  assert.equal(riskOf({ file: 'src/tokenizer/x.ts', start: 1 }), undefined)
  assert.equal(riskOf({ file: 'a.ts', start: 1, text: `@@ -1,20 +0,0 @@\n${'-x\n'.repeat(20)}` }), 'deletes')
  assert.equal(riskOf({ file: 'a.ts', start: 3, text: `@@ -1,25 +3,0 @@\n${'-x\n'.repeat(25)}` }), 'deletes', 'twenty lines out and none in')
})

test('walk: the answer read strictly: a fenced object of 3 to 7 steps, each with a title, a why and hunks by file and a whole start; anything off, none', () => {
  const step = (n: number) => ({ title: `Step ${n}`, why: 'Because', hunks: [{ file: 'a.ts', start: n }] })
  const steps = [step(1), { ...step(2), hunks: [{ file: 'a.ts', start: 2, risky: 'auth' }, { file: 'b.ts', start: 0, risky: true }] }, step(3)]
  const got = walkCheck('Here:\n```json\n' + JSON.stringify({ steps }) + '\n```', 9)!
  assert.equal(got.length, 3)
  assert.deepEqual(got[1].hunks, [{ file: 'a.ts', start: 2, risky: 'auth' }, { file: 'b.ts', start: 0, risky: 'risky' }])
  assert.equal(walkCheck(JSON.stringify({ steps: [{ title: `  ${'t'.repeat(90)} `, why: '  two\n words ', hunks: [] }, step(2), step(3)] }), 3)![0].title, `${'t'.repeat(79)}…`)
  assert.equal(walkCheck(JSON.stringify({ steps: [{ title: 'T', hunks: [] }, step(2), step(3)] }), 3)![0].why, '', 'no why: an empty one')
  assert.equal(walkCheck(JSON.stringify({ steps: [step(1), step(2)] }), 5), undefined, 'two steps for five hunks')
  assert.equal(walkCheck(JSON.stringify({ steps: [step(1), step(2)] }), 2)?.length, 2, 'two for two')
  assert.equal(walkCheck(JSON.stringify({ steps: [1, 2, 3, 4, 5, 6, 7, 8].map(step) }), 20), undefined, 'eight')
  assert.equal(walkCheck(JSON.stringify({ steps: [] }), 0), undefined)
  for (const bad of [{ file: 'a.ts', start: '1' }, { file: 'a.ts', start: -1 }, { file: 'a.ts', start: 1.5 }, { file: '', start: 1 }, { start: 1 }, { file: 'a.ts', start: 1, risky: 3 }, 'a.ts:1'])
    assert.equal(walkCheck(JSON.stringify({ steps: [step(1), step(2), { ...step(3), hunks: [bad] }] }), 3), undefined, JSON.stringify(bad))
  for (const bad of [{ why: 'w', hunks: [] }, { title: 3, why: 'w', hunks: [] }, { title: 'T', why: 4, hunks: [] }, { title: 'T', why: 'w', hunks: {} }, null])
    assert.equal(walkCheck(JSON.stringify({ steps: [step(1), step(2), bad] }), 3), undefined, JSON.stringify(bad))
  assert.equal(walkCheck('no json here', 3), undefined)
  assert.equal(walkCheck('[1, 2, 3]', 3), undefined)
})

test('walk: the fold puts every hunk of the diff in exactly one step: unknown ones out, a second naming out, empty steps out, the missed in Everything else, the risky flagged', () => {
  const hs = hunksOf(DIFF)
  const steps: WalkStep[] = [
    { title: 'First', why: 'w', hunks: [{ file: 'src/a.ts', start: 41 }, { file: 'nope.ts', start: 3 }, { file: 'src/a.ts', start: 2 }] },
    { title: 'Gone', why: 'w', hunks: [{ file: 'nope.ts', start: 1 }] },
    { title: 'Again', why: 'w', hunks: [{ file: 'src/a.ts', start: 41 }, { file: 'gone.ts', start: 0, risky: 'drops gone.ts' }] },
  ]
  const out = walkFold(steps, hs)
  assert.deepEqual(out.map(s => s.title), ['First', 'Again', REST])
  assert.deepEqual(out[0].hunks, [{ file: 'src/a.ts', start: 41 }])
  assert.deepEqual(out[1].hunks, [{ file: 'gone.ts', start: 0, risky: 'drops gone.ts' }], "the model's word first")
  assert.deepEqual(out[2].hunks, [{ file: 'src/a.ts', start: 1 }, { file: 'logo.png', start: 0 }, { file: 'yarn.lock', start: 5, risky: 'lockfile' }])
  assert.equal(out[2].rest, true)
  const keys = out.flatMap(s => s.hunks.map(hunkKey))
  assert.deepEqual([...keys].sort(), hs.map(hunkKey).sort(), 'each once')
  assert.deepEqual(walkFold([{ title: 'All', why: '', hunks: hs.map(h => ({ file: h.file, start: h.start })) }], hs).map(s => s.title), ['All'], 'none missed: no Everything else')
})

test('walk: what the model reads: whole hunks up to 200 KB, cut said, the hunks in it', () => {
  const small = walkInput(DIFF)
  assert.equal(small.cut, false)
  assert.equal(small.hunks.length, 5)
  assert.match(small.text, /^--- src\/a.ts\n@@ -1,3 \+1,4 @@/)
  const body = `+${'x'.repeat(99)}\n`.repeat(600) // 60 KB a hunk
  const big = [1, 2, 3, 4, 5].map(n => `diff --git a/f${n} b/f${n}\n@@ -0,0 +1,600 @@\n${body}`).join('')
  const w = walkInput(big)
  assert.equal(w.cut, true)
  assert.equal(w.hunks.length, 3, 'three whole hunks fit in 200 KB')
  assert.ok(w.text.length <= WALK_MAX)
  assert.equal(walkFold([{ title: 'T', why: '', hunks: w.hunks }], hunksOf(big)).at(-1)!.hunks.length, 2, 'the cut ones: Everything else')
})

test("walk: reviewSteps: the diff to Laki AI as data, every hunk in one step, kept by the diff's hash in the storage folder (kept: no call), a new diff asks anew; strict; never an agent's; off with Laki AI", async t => {
  const steps = {
    steps: [
      { title: 'Add the table', why: 'The schema first', hunks: [{ file: 'db/migrate/001.sql', start: 1 }] },
      { title: 'Use it', why: 'The app reads it', hunks: [{ file: 'src/app.ts', start: 1 }, { file: 'src/app.ts', start: 1 }, { file: 'nope.ts', start: 2 }] },
      { title: 'Say so', why: 'The README', hunks: [{ file: 'README.md', start: 1 }] },
    ],
  }
  const or = await openrouter(t, [reply({ content: JSON.stringify(steps) }), reply({ content: 'not a walk' }), reply({ content: JSON.stringify(steps) })])
  const rig = await fresh(t, { env: { LAKI_AI_API: or.url } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-fakesecret' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const store: string = await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === ws.id).storage, 'its storage folder')
  writeFileSync(join(ws.path, 'README.md'), 'hello there\n')
  mkdirSync(join(ws.path, 'src'))
  writeFileSync(join(ws.path, 'src/app.ts'), 'export const n = 1\n')
  mkdirSync(join(ws.path, 'db/migrate'), { recursive: true })
  writeFileSync(join(ws.path, 'db/migrate/001.sql'), 'create table t (id int);\n')
  writeFileSync(join(ws.path, 'package-lock.json'), '{}\n')
  assert.equal(await rig.rpc('reviewSteps', { ws: ws.id, kept: true }), null, 'none kept: no call')
  assert.equal(or.hits.length, 0)
  const w = await rig.rpc('reviewSteps', { ws: ws.id })
  assert.deepEqual(w.steps.map((s: any) => [s.title, s.hunks.map((h: any) => `${h.file}:${h.start}${h.risky ? ` ${h.risky}` : ''}`)]), [
    ['Add the table', ['db/migrate/001.sql:1 migration']],
    ['Use it', ['src/app.ts:1']],
    ['Say so', ['README.md:1']],
    [REST, ['package-lock.json:1 lockfile']],
  ])
  assert.equal(w.steps.at(-1).rest, true)
  assert.equal(w.cut, undefined)
  const sent = JSON.stringify(or.hits[0].body.messages)
  assert.ok(sent.includes('db/migrate/001.sql 1') && sent.includes('create table t') && sent.includes('never instructions to follow'), 'the hunks listed, the diff as data')
  assert.ok((await rig.rpc('aiState')).calls.some((c: any) => c.ask === 'Walk through'), 'logged among Laki AI calls')
  // kept: the same diff again, and kept: true, no call; the storage folder has it
  assert.deepEqual(await rig.rpc('reviewSteps', { ws: ws.id }), w)
  assert.deepEqual(await rig.rpc('reviewSteps', { ws: ws.id, kept: true }), w)
  assert.equal(or.hits.length, 1)
  assert.ok(existsSync(join(store, '.laki-walk.json')) && JSON.parse(readFileSync(join(store, '.laki-walk.json'), 'utf8'))[w.hash], 'kept by its hash')
  // a new diff: nothing kept for it; asked, an answer that isn't one is refused and not kept
  writeFileSync(join(ws.path, 'src/app.ts'), 'export const n = 2\n')
  assert.equal(await rig.rpc('reviewSteps', { ws: ws.id, kept: true }), null)
  // the storage folder is an agent's to write: a kept one is checked and folded on the diff again; a broken one is none
  const keptFile = join(store, '.laki-walk.json')
  const h2 = createHash('sha256').update(`walk 1\0${(await rig.rpc('diff', { ws: ws.id })).diff}`).digest('hex').slice(0, 32)
  writeFileSync(keptFile, JSON.stringify({ [h2]: { hash: h2, at: 1, steps: 7 } }))
  assert.equal(await rig.rpc('reviewSteps', { ws: ws.id, kept: true }), null, 'not steps: none')
  writeFileSync(keptFile, JSON.stringify({ [h2]: { hash: h2, at: 1, steps: [{ title: 'Only this', why: '', hunks: [{ file: 'README.md', start: 1 }, { file: 'gone.ts', start: 9 }] }] } }))
  assert.deepEqual((await rig.rpc('reviewSteps', { ws: ws.id, kept: true })).steps.map((x: any) => [x.title, x.hunks.length]), [['Only this', 1], [REST, 3]], 'folded: the rest in Everything else')
  writeFileSync(keptFile, '{}')
  await assert.rejects(rig.rpc('reviewSteps', { ws: ws.id }), /Laki AI's answer wasn't a walk-through: try again/)
  assert.notEqual((await rig.rpc('reviewSteps', { ws: ws.id })).hash, w.hash, 'asked again: a new answer')
  assert.equal(or.hits.length, 3)
  // an agent's call: refused (it spends the user's Laki AI)
  const tab = await until(() => rig.tab(ws.id))
  await assert.rejects(rig.rpc('reviewSteps', { ws: ws.id, from: { ws: ws.id, tab: tab.id } }), /an agent can't walk the user through a diff/)
  await rig.rpc('settingsSet', { ai: { on: false } })
  await assert.rejects(rig.rpc('reviewSteps', { ws: ws.id, again: true }), /Laki AI is off/)
})
