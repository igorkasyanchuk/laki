// Collision radar: a -U0 diff's base lines, where two diffs meet, and the daemon's marks on both worktrees and for a
// base that moved under one.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { overlaps, rangesOf, spanText } from '../src/shared/overlap.ts'
import { fresh, until } from './helpers.ts'

const DIFF = `diff --git cart.ts cart.ts
index 1..2 100644
--- cart.ts
+++ cart.ts
@@ -3,2 +3,3 @@ x
-a
-b
+c
+d
+e
@@ -10,0 +12 @@ y
+f
@@ -0,0 +1,1 @@
+top
diff --git new.ts new.ts
new file mode 100644
--- /dev/null
+++ new.ts
@@ -0,0 +1,2 @@
+1
+2
diff --git gone.ts gone.ts
deleted file mode 100644
--- gone.ts
+++ /dev/null
@@ -1,4 +0,0 @@
-x
diff --git package-lock.json package-lock.json
--- package-lock.json
+++ package-lock.json
@@ -1 +1 @@
-a
+b`

test('rangesOf: the base lines each hunk changes; a new file whole; lockfiles left out', () => {
  assert.deepEqual(rangesOf(DIFF), { 'cart.ts': [[3, 4], [10, 10], [1, 1]], 'new.ts': [[0, 0]], 'gone.ts': [[1, 4]] })
})

test('overlaps: lines that meet or sit side by side, a new file both make, nothing apart', () => {
  const mine = { 'cart.ts': [[3, 4], [40, 50]] as [number, number][], 'a.ts': [[1, 2]] as [number, number][], 'new.ts': [[0, 0]] as [number, number][] }
  assert.deepEqual(overlaps(mine, { 'cart.ts': [[5, 6], [48, 60]], 'a.ts': [[4, 9]], 'new.ts': [[0, 0]] }), [
    { file: 'cart.ts', mine: [3, 50], theirs: [5, 60] },
    { file: 'new.ts', mine: [0, 0], theirs: [0, 0] },
  ])
  assert.deepEqual(overlaps(mine, { 'b.ts': [[1, 9]] }), [])
  assert.equal(spanText([40, 62]), 'lines 40–62')
  assert.equal(spanText([7, 7]), 'line 7')
  assert.equal(spanText([0, 0]), 'a new file')
})

test('the daemon marks two worktrees that change the same lines, and one whose base changed them since; off: none', async t => {
  const rig = await fresh(t, { env: { LAKI_OVERLAP_MS: '300' } })
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: rig.env })
  const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'
  writeFileSync(join(rig.repo, 'cart.ts'), lines(30))
  writeFileSync(join(rig.repo, 'other.ts'), lines(30))
  git(rig.repo, 'add', '-A')
  git(rig.repo, 'commit', '-qm', 'cart')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(a.path, 'cart.ts'), lines(30, i => (i >= 10 && i <= 12 ? `a ${i}` : `line ${i}`)))
  writeFileSync(join(b.path, 'cart.ts'), lines(30, i => (i === 13 ? 'b 13' : `line ${i}`))) // right after a's: they'd conflict
  writeFileSync(join(c.path, 'other.ts'), lines(30, i => (i === 2 ? 'c 2' : `line ${i}`))) // apart from both
  const view = async (id: string) => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === id)
  const got = await until(async () => (await view(a.id)).overlaps, 'a marked')
  assert.deepEqual(got, [{ file: 'cart.ts', mine: [10, 12], theirs: [13, 13], ws: b.id }])
  assert.deepEqual((await view(b.id)).overlaps, [{ file: 'cart.ts', mine: [13, 13], theirs: [10, 12], ws: a.id }])
  assert.equal((await view(c.id)).overlaps, undefined)
  // main moves under c: other.ts line 2 changed there too
  writeFileSync(join(rig.repo, 'other.ts'), lines(30, i => (i === 2 ? 'main 2' : `line ${i}`)))
  git(rig.repo, 'commit', '-qam', 'main moves')
  assert.deepEqual(await until(async () => (await view(c.id)).overlaps, 'c marked'), [{ file: 'other.ts', mine: [2, 2], theirs: [2, 2], base: 'main' }])
  await rig.rpc('settingsSet', { radar: false })
  await until(async () => !(await view(a.id)).overlaps && !(await view(c.id)).overlaps, 'off: none')
})
