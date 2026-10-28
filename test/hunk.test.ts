// Changes' Revert: a hunk, picked lines of one, a whole file back to the base, and each one's Undo (hunkRedo)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, type Rig } from './helpers.ts'

// files committed to the repo's main, then a worktree off it
async function setup(rig: Rig, files: Record<string, string | Buffer>, host = '') {
  for (const [f, text] of Object.entries(files)) writeFileSync(join(rig.repo, f), text)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: rig.repo, env: rig.env })
  git('add', '-A')
  git('commit', '-qm', 'base')
  const p = await rig.rpc('projectAdd', { path: host ? `${host}:${rig.repo}` : rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  return ws as { id: string; path: string }
}
const gitIn = (rig: Rig, ws: { path: string }, ...a: string[]) => execFileSync('git', a, { cwd: ws.path, env: rig.env, encoding: 'utf8' })
// a file's hunks as Changes reads them: the @@ line and its body up to the next @@ or file
async function hunks(rig: Rig, ws: { id: string }, path: string) {
  const all = (await rig.rpc('diff', { ws: ws.id })).diff.split('\n') as string[]
  const s = all.findIndex(l => l.startsWith('diff --git a/') && l.endsWith(` b/${path}`))
  assert.ok(s >= 0, `${path} in the diff`)
  const out: string[][] = []
  for (const l of all.slice(s + 1)) {
    if (l.startsWith('diff --git ')) break
    if (l.startsWith('@@')) out.push([l])
    else if (out.length) out.at(-1)!.push(l)
  }
  return out.map(h => h.join('\n'))
}
const read = (ws: { path: string }, f: string) => readFileSync(join(ws.path, f), 'utf8')
const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'

test('a whole hunk reverts, the others stay, and Undo puts it back', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'a.txt': lines(30) })
  const now = lines(30, i => (i === 3 ? 'three!' : i === 25 ? 'twenty-five!' : `line ${i}`))
  writeFileSync(join(ws.path, 'a.txt'), now)
  const [h1, h2] = await hunks(rig, ws, 'a.txt')
  assert.ok(h1 && h2, 'two hunks')
  const { id } = await rig.rpc('hunkUndo', { ws: ws.id, path: 'a.txt', hunk: h1 })
  assert.equal(read(ws, 'a.txt'), lines(30, i => (i === 25 ? 'twenty-five!' : `line ${i}`)))
  assert.deepEqual(await hunks(rig, ws, 'a.txt'), [h2])
  await rig.rpc('hunkRedo', { ws: ws.id, id })
  assert.equal(read(ws, 'a.txt'), now)
  await assert.rejects(rig.rpc('hunkRedo', { ws: ws.id, id }), /nothing to undo/)
  assert.equal(gitIn(rig, ws, 'diff', '--cached', '--name-only'), '', 'nothing staged')
})

test('picked lines revert alone; a hunk with no context lines (a count of 0)', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'b.txt': '1\n2\n3\n', 'empty.txt': '', 'one.txt': 'x\n' })
  writeFileSync(join(ws.path, 'b.txt'), '1\nA\nB\n3\n')
  const [h] = await hunks(rig, ws, 'b.txt')
  assert.deepEqual(h.split('\n').slice(1), [' 1', '-2', '+A', '+B', ' 3'])
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'b.txt', hunk: h, lines: [1, 3] }) // -2 and +B
  assert.equal(read(ws, 'b.txt'), '1\n2\nA\n3\n')
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: 'b.txt', hunk: (await hunks(rig, ws, 'b.txt'))[0], lines: [0] }), /pick a line the agent added or took out/)
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: 'b.txt', hunk: (await hunks(rig, ws, 'b.txt'))[0], lines: [99] }), /indexes into the hunk/)

  // a file that was empty: @@ -0,0 +1 @@, its undo @@ -1,1 +0,0 @@
  writeFileSync(join(ws.path, 'empty.txt'), 'x\n')
  const [e] = await hunks(rig, ws, 'empty.txt')
  assert.match(e, /^@@ -0,0 \+1 @@/)
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'empty.txt', hunk: e })
  assert.equal(read(ws, 'empty.txt'), '')
  // and one emptied: @@ -1 +0,0 @@, its undo @@ -0,0 +1,1 @@
  writeFileSync(join(ws.path, 'one.txt'), '')
  const [o] = await hunks(rig, ws, 'one.txt')
  assert.match(o, /^@@ -1 \+0,0 @@/)
  const { id } = await rig.rpc('hunkUndo', { ws: ws.id, path: 'one.txt', hunk: o })
  assert.equal(read(ws, 'one.txt'), 'x\n')
  await rig.rpc('hunkRedo', { ws: ws.id, id })
  assert.equal(read(ws, 'one.txt'), '')
})

test("a new file's hunk takes the file away, a deleted file's brings it back, whole only", async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'gone.txt': 'one\ntwo\n' })
  writeFileSync(join(ws.path, 'new.txt'), 'hello\nworld\n')
  const [n] = await hunks(rig, ws, 'new.txt')
  const { id } = await rig.rpc('hunkUndo', { ws: ws.id, path: 'new.txt', hunk: n })
  assert.ok(!existsSync(join(ws.path, 'new.txt')))
  await rig.rpc('hunkRedo', { ws: ws.id, id })
  assert.equal(read(ws, 'new.txt'), 'hello\nworld\n')
  // some lines of a new file: it stays, without them
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'new.txt', hunk: (await hunks(rig, ws, 'new.txt'))[0], lines: [1] })
  assert.equal(read(ws, 'new.txt'), 'hello\n')

  unlinkSync(join(ws.path, 'gone.txt'))
  const [d] = await hunks(rig, ws, 'gone.txt')
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: 'gone.txt', hunk: d, lines: [0] }), /whole or not at all/)
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'gone.txt', hunk: d })
  assert.equal(read(ws, 'gone.txt'), 'one\ntwo\n')
})

test('a hunk changed since the diff was read is refused; a path outside too', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'c.txt': '1\n2\n3\n' })
  writeFileSync(join(ws.path, 'c.txt'), '1\nB\n3\n')
  const [h] = await hunks(rig, ws, 'c.txt')
  writeFileSync(join(ws.path, 'c.txt'), '1\nC\n3\n') // the agent again
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: 'c.txt', hunk: h }), /c\.txt changed since you looked: refresh Changes/)
  assert.equal(read(ws, 'c.txt'), '1\nC\n3\n')
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: '../x', hunk: h }), /not a path inside the workspace/)
  await assert.rejects(rig.rpc('fileUndo', { ws: ws.id, path: 'README.md' }), /no changes to revert/)
})

test('a committed hunk reverts in the worktree, the commit stays', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'd.txt': '1\n2\n3\n' })
  writeFileSync(join(ws.path, 'd.txt'), '1\ntwo\n3\n')
  gitIn(rig, ws, 'commit', '-qam', 'agent')
  const head = gitIn(rig, ws, 'rev-parse', 'HEAD')
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'd.txt', hunk: (await hunks(rig, ws, 'd.txt'))[0] })
  assert.equal(read(ws, 'd.txt'), '1\n2\n3\n')
  assert.equal(gitIn(rig, ws, 'rev-parse', 'HEAD'), head)
  assert.equal(gitIn(rig, ws, 'status', '--porcelain'), ' M d.txt\n', 'changed in the worktree only')
})

test('a renamed file, a CRLF file, a file with no newline at its end', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'r.txt': lines(10), 'crlf.txt': 'a\r\nb\r\nc\r\n', 'nl.txt': 'a\nb' })
  gitIn(rig, ws, 'mv', 'r.txt', 's.txt')
  writeFileSync(join(ws.path, 's.txt'), lines(10, i => (i === 5 ? 'five!' : `line ${i}`)))
  gitIn(rig, ws, 'commit', '-qam', 'renamed')
  const d = (await rig.rpc('diff', { ws: ws.id })).diff
  assert.match(d, /rename from r\.txt\nrename to s\.txt/)
  await rig.rpc('hunkUndo', { ws: ws.id, path: 's.txt', hunk: (await hunks(rig, ws, 's.txt'))[0] })
  assert.equal(read(ws, 's.txt'), lines(10))
  assert.ok(!existsSync(join(ws.path, 'r.txt')), 'it stays renamed')

  writeFileSync(join(ws.path, 'crlf.txt'), 'a\r\nB\r\nc\r\n')
  const [c] = await hunks(rig, ws, 'crlf.txt')
  assert.ok(c.includes('+B\r'), '\\r kept')
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'crlf.txt', hunk: c })
  assert.equal(read(ws, 'crlf.txt'), 'a\r\nb\r\nc\r\n')

  writeFileSync(join(ws.path, 'nl.txt'), 'a\nc')
  const [n] = await hunks(rig, ws, 'nl.txt')
  assert.match(n, /\\ No newline at end of file/)
  const { id } = await rig.rpc('hunkUndo', { ws: ws.id, path: 'nl.txt', hunk: n })
  assert.equal(read(ws, 'nl.txt'), 'a\nb')
  await rig.rpc('hunkRedo', { ws: ws.id, id })
  assert.equal(read(ws, 'nl.txt'), 'a\nc')
  // only the + line: the - line stays out, so the file ends at a
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'nl.txt', hunk: n, lines: [n.split('\n').slice(1).findIndex(l => l === '+c')] })
  assert.equal(read(ws, 'nl.txt'), 'a\n')
})

test('fileUndo: modified, added, deleted and binary files, each with Undo; nothing staged', async t => {
  const rig = await fresh(t)
  const bin = Buffer.from([0, 1, 2, 3, 255, 0, 7])
  const ws = await setup(rig, { 'm.txt': '1\n2\n', 'del.txt': 'bye\n', 'img.bin': bin })
  writeFileSync(join(ws.path, 'm.txt'), '1\ntwo\n')
  writeFileSync(join(ws.path, 'add.txt'), 'new\n')
  unlinkSync(join(ws.path, 'del.txt'))
  const bin2 = Buffer.from([9, 0, 9, 0])
  writeFileSync(join(ws.path, 'img.bin'), bin2)
  gitIn(rig, ws, 'add', 'm.txt') // staged before: it stays staged as it was
  const index = gitIn(rig, ws, 'ls-files', '--stage')
  const cached = gitIn(rig, ws, 'diff', '--cached', '--name-only')

  const m = await rig.rpc('fileUndo', { ws: ws.id, path: 'm.txt' })
  assert.equal(read(ws, 'm.txt'), '1\n2\n')
  const a = await rig.rpc('fileUndo', { ws: ws.id, path: 'add.txt' })
  assert.ok(!existsSync(join(ws.path, 'add.txt')))
  const d = await rig.rpc('fileUndo', { ws: ws.id, path: 'del.txt' })
  assert.equal(read(ws, 'del.txt'), 'bye\n')
  const b = await rig.rpc('fileUndo', { ws: ws.id, path: 'img.bin' })
  assert.deepEqual(readFileSync(join(ws.path, 'img.bin')), bin)
  assert.equal(gitIn(rig, ws, 'ls-files', '--stage'), index, 'the index as it was')
  assert.equal(gitIn(rig, ws, 'diff', '--cached', '--name-only'), cached)

  for (const u of [m, a, d, b]) await rig.rpc('hunkRedo', { ws: ws.id, id: u.id })
  assert.equal(read(ws, 'm.txt'), '1\ntwo\n')
  assert.equal(read(ws, 'add.txt'), 'new\n')
  assert.ok(!existsSync(join(ws.path, 'del.txt')))
  assert.deepEqual(readFileSync(join(ws.path, 'img.bin')), bin2)
  assert.equal(gitIn(rig, ws, 'ls-files', '--stage'), index)
})

test('a renamed file reverts whole: back to its old name', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'old.txt': lines(10) })
  gitIn(rig, ws, 'mv', 'old.txt', 'new.txt')
  gitIn(rig, ws, 'commit', '-qm', 'renamed')
  const u = await rig.rpc('fileUndo', { ws: ws.id, path: 'new.txt' })
  assert.equal(read(ws, 'old.txt'), lines(10))
  assert.ok(!existsSync(join(ws.path, 'new.txt')))
  await rig.rpc('hunkRedo', { ws: ws.id, id: u.id })
  assert.equal(read(ws, 'new.txt'), lines(10))
  assert.ok(!existsSync(join(ws.path, 'old.txt')))
})

test('over SSH: a hunk, a file and their Undo on the host', async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'h.txt': '1\n2\n3\n' }, 'devbox')
  writeFileSync(join(ws.path, 'h.txt'), '1\nB\n3\n')
  writeFileSync(join(ws.path, 'n.txt'), 'new\n')
  const { id } = await rig.rpc('hunkUndo', { ws: ws.id, path: 'h.txt', hunk: (await hunks(rig, ws, 'h.txt'))[0] })
  assert.equal(read(ws, 'h.txt'), '1\n2\n3\n')
  await rig.rpc('hunkRedo', { ws: ws.id, id })
  assert.equal(read(ws, 'h.txt'), '1\nB\n3\n')
  const f = await rig.rpc('fileUndo', { ws: ws.id, path: 'h.txt' })
  assert.equal(read(ws, 'h.txt'), '1\n2\n3\n')
  await rig.rpc('hunkRedo', { ws: ws.id, id: f.id })
  assert.equal(read(ws, 'h.txt'), '1\nB\n3\n')
  await rig.rpc('fileUndo', { ws: ws.id, path: 'n.txt' })
  assert.ok(!existsSync(join(ws.path, 'n.txt')))
})

test("a folder without git can't revert", async t => {
  const rig = await fresh(t)
  const dir = mkdtempSync(join(rig.home, 'plain-'))
  writeFileSync(join(dir, 'f.txt'), 'x\n')
  const p = await rig.rpc('projectAdd', { path: dir })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: 'f.txt', hunk: '@@ -1 +1 @@' }), /not a git repo/)
  await assert.rejects(rig.rpc('fileUndo', { ws: ws.id, path: 'f.txt' }), /not a git repo/)
})

test("Uncommitted: only what isn't committed (against HEAD), its hunks and files revert to the last commit", async t => {
  const rig = await fresh(t)
  const ws = await setup(rig, { 'a.txt': lines(30), 'b.txt': 'b\n' })
  // a commit on the branch, then an edit over it and a new file
  writeFileSync(join(ws.path, 'a.txt'), lines(30, i => (i === 3 ? 'three!' : `line ${i}`)))
  gitIn(rig, ws, 'commit', '-qam', 'on the branch')
  writeFileSync(join(ws.path, 'a.txt'), lines(30, i => (i === 3 ? 'three!' : i === 5 ? 'five!' : `line ${i}`)))
  writeFileSync(join(ws.path, 'b.txt'), 'b!\n')
  const all = await rig.rpc('diff', { ws: ws.id })
  const now = await rig.rpc('diff', { ws: ws.id, uncommitted: true })
  assert.match(all.diff, /\+three!\n.*\n\+five!/s, 'the branch: its commit and what is not committed, one hunk')
  assert.equal(now.from, 'HEAD')
  assert.deepEqual([now.diff.includes('+three!'), now.diff.includes(' three!'), now.diff.includes('+five!')], [false, true, true])
  const h = now.diff.split('\n').slice(now.diff.split('\n').findIndex((l: string) => l.startsWith('@@'))).join('\n').split('\ndiff --git')[0]
  // a hunk of Uncommitted isn't one of the branch's view: refused there, reverted here to HEAD (the commit stays)
  await assert.rejects(rig.rpc('hunkUndo', { ws: ws.id, path: 'a.txt', hunk: h }), /changed since you looked/)
  await rig.rpc('hunkUndo', { ws: ws.id, path: 'a.txt', hunk: h, uncommitted: true })
  assert.equal(read(ws, 'a.txt'), lines(30, i => (i === 3 ? 'three!' : `line ${i}`)))
  await rig.rpc('fileUndo', { ws: ws.id, path: 'b.txt', uncommitted: true })
  assert.equal(read(ws, 'b.txt'), 'b\n')
  assert.deepEqual((await rig.rpc('diff', { ws: ws.id, uncommitted: true })).files, [])
})
