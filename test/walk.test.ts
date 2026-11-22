import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileRisk, hunkKey, hunksOf, REST, riskOf, risksOf, WALK_MAX, walkCheck, walkFold, walkInput, walkPrompt, type WalkStep } from '../src/shared/walk.ts'
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

test("walk: fileRisk: a file's riskOf words once each, from its hunks; risksOf: every file of a diff that has one, no model", () => {
  const big = `@@ -10,22 +10,0 @@\n${'-gone\n'.repeat(22)}`
  const auth = [{ file: 'src/auth/session.ts', start: 1, text: '@@ -1 +1 @@\n-a\n+b' }, { file: 'src/auth/session.ts', start: 10, text: big }, { file: 'src/auth/session.ts', start: 40, text: '@@ -40 +40 @@\n-c\n+d' }]
  assert.deepEqual(fileRisk(auth), ['auth', 'deletes'], 'an auth path with a big delete: both, once each')
  assert.deepEqual(fileRisk([{ file: 'src/a.ts', start: 1, text: '@@ -1 +1 @@\n-a\n+b' }, { file: 'src/a.ts', start: 10, text: big }, { file: 'src/a.ts', start: 50, text: big }]), ['deletes'])
  assert.deepEqual(fileRisk([{ file: 'src/a.ts', start: 1, text: '@@ -1 +1 @@\n-a\n+b' }]), [], 'a clean file: none')
  assert.deepEqual(fileRisk([{ file: 'db/migrate/1_add.rb', start: 1, text: '@@ -0,0 +1 @@\n+x' }, { file: 'db/migrate/1_add.rb', start: 9, text: big }]), ['migration', 'deletes'], 'both, each once')
  assert.deepEqual([...risksOf(DIFF)], [['gone.ts', ['deletes']], ['yarn.lock', ['lockfile']]])
  assert.equal(risksOf('').size, 0)
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

test('walk: a hunk too big is skipped, not the end: the smaller ones after it still read, the big ones last, the skipped named by file and left to Everything else', () => {
  const file = (name: string, body: string) => `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n${body}`
  const lock = `+${'x'.repeat(99)}\n`.repeat(6000) // 586 KB, one hunk
  const diff = [file('docs/a.md', '+hi\n'), file('package-lock.json', lock), file('src/auth/login.ts', '+export const login = 1\n'), file('test/login.test.ts', '+test()\n')].join('')
  const w = walkInput(diff)
  assert.deepEqual(w.hunks.map(h => h.file), ['docs/a.md', 'src/auth/login.ts', 'test/login.test.ts'], 'the code and the test past the lockfile')
  assert.deepEqual(w.skipped.map(h => h.file), ['package-lock.json'])
  assert.equal(w.cut, true)
  assert.match(w.text, /login = 1[\s\S]*test\(\)/)
  assert.ok(!w.text.includes('xxxx'))
  const p = walkPrompt(w)
  assert.match(p, /package-lock\.json: 6001 lines, not shown/)
  assert.ok(!/^package-lock\.json 1$/m.test(p), 'not among the hunks it reads')
  // the model names what it read, and the lockfile too (it can't have seen it): that one goes to Everything else
  const steps: WalkStep[] = [
    { title: 'Add login', why: '', hunks: [{ file: 'src/auth/login.ts', start: 1 }, { file: 'package-lock.json', start: 1 }] },
    { title: 'Test it', why: '', hunks: [{ file: 'test/login.test.ts', start: 1 }] },
    { title: 'Say so', why: '', hunks: [{ file: 'docs/a.md', start: 1 }] },
  ]
  const out = walkFold(steps, hunksOf(diff), w.skipped)
  assert.deepEqual(out.map(s => [s.title, s.hunks.map(h => `${h.file}${h.risky ? ` ${h.risky}` : ''}`)]), [
    ['Add login', ['src/auth/login.ts auth']],
    ['Test it', ['test/login.test.ts auth']],
    ['Say so', ['docs/a.md']],
    [REST, ['package-lock.json lockfile']],
  ])
  // a small lockfile and a hunk over a quarter of 200 KB are read, last
  const mid = `+${'y'.repeat(99)}\n`.repeat(600) // 60 KB
  const w2 = walkInput([file('big.ts', mid), file('yarn.lock', '+a\n'), file('a.ts', '+b\n')].join(''))
  assert.deepEqual(w2.hunks.map(h => h.file), ['a.ts', 'big.ts', 'yarn.lock'])
  assert.equal(w2.cut, false)
  assert.equal(walkPrompt(w2).includes('Too big'), false)
  // every hunk too big: nothing read, cut, Everything else alone
  const huge = `+${'z'.repeat(99)}\n`.repeat(2100) // 210 KB
  const w3 = walkInput([file('a.ts', huge), file('b.ts', huge)].join(''))
  assert.deepEqual([w3.text, w3.hunks.length, w3.skipped.length, w3.cut], ['', 0, 2, true])
  assert.deepEqual(walkFold([], hunksOf([file('a.ts', huge), file('b.ts', huge)].join('')), w3.skipped).map(s => [s.title, s.hunks.length]), [[REST, 2]])
  // a big one that doesn't fit, then small ones filling the rest: 200 KB never passed
  const small = `+${'s'.repeat(99)}\n`.repeat(30) // 3 KB a hunk
  const w4 = walkInput([file('a.ts', huge), ...Array.from({ length: 80 }, (_, i) => file(`f${i}.ts`, small))].join(''))
  assert.ok(w4.text.length <= WALK_MAX && w4.text.length > WALK_MAX - 4000, `${w4.text.length}`)
  assert.equal(w4.hunks.length + w4.skipped.length, 81)
})

test("walk: reviewSteps: the diff to Laki AI as data, every hunk in one step, kept by the diff's hash in the data folder, not the agent's storage folder (kept: no call), a new diff asks anew; strict; never an agent's; off with Laki AI", async t => {
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
  const keptFile = join(rig.data, 'review-walks', `${ws.id}.json`)
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
  // kept: the same diff again, and kept: true, no call; the data folder has it, the storage folder (its agents') not
  assert.deepEqual(await rig.rpc('reviewSteps', { ws: ws.id }), w)
  assert.deepEqual(await rig.rpc('reviewSteps', { ws: ws.id, kept: true }), w)
  assert.equal(or.hits.length, 1)
  assert.ok(existsSync(keptFile) && JSON.parse(readFileSync(keptFile, 'utf8'))[w.hash], 'kept by its hash')
  assert.ok(!existsSync(join(store, '.laki-walk.json')), 'not where its agent writes')
  // a new diff: nothing kept for it; asked, an answer that isn't one is refused and not kept
  writeFileSync(join(ws.path, 'src/app.ts'), 'export const n = 2\n')
  assert.equal(await rig.rpc('reviewSteps', { ws: ws.id, kept: true }), null)
  // a kept one is checked and folded on the diff again; a broken one is none
  const h2 = createHash('sha256').update(`walk 2\0${(await rig.rpc('diff', { ws: ws.id })).diff}`).digest('hex').slice(0, 32)
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
