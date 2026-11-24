// R10: the Review tab's unsent comments, kept by the daemon per workspace: set, read, through a restart and an archive,
// gone with the workspace, capped, and the user's alone (not an agent's). Sent ones (shared/reviewNotes.ts): what the
// agent's next turn did to their lines (noteStates), set by the daemon as that turn ends
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'
import { hunksOf, noteStates } from '../src/shared/reviewNotes.ts'

const note = (n: number, body = `comment ${n}`) => ({ id: `n${n}`, path: 'README.md', line: n + 1, side: 'RIGHT', body, quote: 'a line' })

test("R10: review notes: set, get, survive a restart and an archive, gone with the workspace; oversize and an agent's refused", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  assert.deepEqual(await rig.rpc('reviewNotesGet', { ws: ws.id }), { notes: [] }, 'none yet, never set')
  const { at } = await rig.rpc('reviewNotesSet', { ws: ws.id, notes: [note(1), { ...note(2), startLine: 1, extra: 'dropped' }] })
  assert.ok(at > 0)
  const got = await rig.rpc('reviewNotesGet', { ws: ws.id })
  assert.deepEqual(got.notes, [note(1), { ...note(2), startLine: 1 }])
  assert.equal(got.at, at)
  // a restart: still there
  await rig.stop()
  await rig.start()
  assert.equal((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes.length, 2)
  // an archive keeps them, Restore brings them back with it
  await rig.rpc('wsArchive', { id: ws.id })
  assert.equal((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes.length, 2)
  await rig.rpc('wsRestore', { id: ws.id })
  // capped: 200 comments, 4 KB each; a bad one says which
  await assert.rejects(rig.rpc('reviewNotesSet', { ws: ws.id, notes: Array.from({ length: 201 }, (_, i) => note(i)) }), /200 comments at most/)
  await assert.rejects(rig.rpc('reviewNotesSet', { ws: ws.id, notes: [note(1, 'x'.repeat(5000))] }), /comment 1: 4 KB at most/)
  await assert.rejects(rig.rpc('reviewNotesSet', { ws: ws.id, notes: [{ ...note(1), side: 'UP' }] }), /comment 1: id, path, line, side, body and quote/)
  await assert.rejects(rig.rpc('reviewNotesSet', { ws: ws.id, notes: 'x' }), /notes: a list/)
  assert.equal((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes.length, 2, 'unchanged by a refusal')
  // not an agent's: neither read nor set
  const tab = (await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })).id
  const from = { ws: ws.id, tab }
  await assert.rejects(rig.rpc('reviewNotesGet', { ws: ws.id, from }), /an agent can't read or change the user's unsent review comments/)
  await assert.rejects(rig.rpc('reviewNotesSet', { ws: ws.id, notes: [], from }), /an agent can't/)
  // cleared: an empty list, kept as set (the window's copy doesn't move in again)
  await rig.rpc('reviewNotesSet', { ws: ws.id, notes: [] })
  assert.deepEqual((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes, [])
  // deleted: the file goes with it
  await rig.rpc('reviewNotesSet', { ws: ws.id, notes: [note(3)] })
  const file = join(rig.data, 'review-notes', `${ws.id}.json`)
  assert.ok(existsSync(file))
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => !existsSync(file), 'its comments gone with it')
  await assert.rejects(rig.rpc('reviewNotesGet', { ws: ws.id }), /no workspace/)
})

// a -U0 diff as git prints it for a turn
const diffOf = (path: string, ...hunks: string[]) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}\n`
const at = (id: string, line: number, more: object = {}) => ({ id, path: 'src/cart.js', line, side: 'RIGHT' as const, ...more })

test('noteStates: a turn that edits the commented line changes it; one elsewhere in the file, or another file, leaves it; a deleted file changes all of its', () => {
  const edit = diffOf('src/cart.js', '@@ -10 +10 @@', '-  return total', '+  return Math.round(total * 100) / 100')
  assert.deepEqual(noteStates([at('a', 10)], edit).get('a'), { state: 'changed', hunk: [10, 10] })
  // within 3 lines of context: changed; 4 away: not
  assert.equal(noteStates([at('b', 13)], edit).get('b')?.state, 'changed')
  assert.equal(noteStates([at('c', 14)], edit).get('c')?.state, 'unchanged')
  // far off in the same file
  const far = diffOf('src/cart.js', '@@ -80,2 +80,3 @@', '-a', '-b', '+a', '+b', '+c')
  assert.deepEqual(noteStates([at('d', 10)], far).get('d'), { state: 'unchanged' })
  // a range (startLine..line) met by a hunk past its end; lines only added after line 20 meet a comment on 22
  assert.equal(noteStates([at('e', 8, { startLine: 5 })], diffOf('src/cart.js', '@@ -11,2 +11,0 @@', '-x', '-y')).get('e')?.state, 'changed')
  assert.deepEqual(noteStates([at('f', 22)], diffOf('src/cart.js', '@@ -20,0 +21,2 @@', '+p', '+q')).get('f'), { state: 'changed', hunk: [21, 22] })
  // another file's change, an empty diff (the turn changed nothing)
  assert.equal(noteStates([at('g', 10)], diffOf('README.md', '@@ -10 +10 @@', '-a', '+b')).get('g')?.state, 'unchanged')
  assert.equal(noteStates([at('h', 10)], '').get('h')?.state, 'unchanged')
  // deleted: every comment on it changed, no hunk to show
  const gone = 'diff --git a/src/cart.js b/src/cart.js\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/src/cart.js\n+++ /dev/null\n@@ -1,40 +0,0 @@\n-x\n'
  assert.deepEqual([...noteStates([at('i', 2), at('j', 39)], gone).values()], [{ state: 'changed' }, { state: 'changed' }])
  // a line taken out (LEFT): any hunk of its file
  assert.equal(noteStates([{ ...at('k', 300), side: 'LEFT' }], far).get('k')?.state, 'changed')
  // a C-quoted path, as git prints one with a non-ASCII name
  const q = 'diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"\n--- "a/caf\\303\\251.js"\n+++ "b/caf\\303\\251.js"\n@@ -3 +3 @@\n-a\n+b\n'
  assert.deepEqual([...hunksOf(q).keys()], ['café.js'])
  assert.equal(noteStates([{ ...at('l', 3), path: 'café.js' }], q).get('l')?.state, 'changed')
})

test("sent comments: the daemon marks each by the agent's next turn (changed here, not changed), the view says so; a window's older copy doesn't undo it; fields checked", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x.status === 'idle' && x)(await rig.tab(ws.id)), 'claude up')
  const file = join(ws.path, 'cart.js')
  writeFileSync(file, Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  // a turn that makes cart.js part of the tree the next turn starts from
  const turn = async (prompt: string, edit: () => void) => {
    await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt } })
    await sleep(300) // its snapshot first, as claude's first tool call comes after the hook
    edit()
    await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done.' } })
  }
  await turn('start', () => {})
  const sentAt = Date.now()
  const base = { path: 'cart.js', side: 'RIGHT', body: 'round it', quote: '+line', sentAt, tab: tab.id, state: 'sent' }
  await rig.rpc('reviewNotesSet', { ws: ws.id, notes: [{ ...base, id: 'near', line: 5 }, { ...base, id: 'far', line: 25 }, { id: 'unsent', path: 'cart.js', line: 5, side: 'RIGHT', body: 'later', quote: '+line' }] })
  await assert.rejects(rig.rpc('reviewNotesSet', { ws: ws.id, notes: [{ ...base, id: 'x', line: 1, state: 'odd' }] }), /comment 1: sentAt, tab, state, turn, hunk or done/)
  const before = (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).notesAt
  await sleep(50)
  // the agent's turn edits line 5
  await turn('fix the review', () => writeFileSync(file, readFileSync(file, 'utf8').replace('line 5\n', 'line five\n')))
  const seen = await until(async () => (x => x.notesAt && x.notesAt !== before && x)((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)), 'notesAt in the view')
  assert.ok(seen.notesAt >= sentAt)
  const got = new Map<string, any>((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes.map((n: any) => [n.id, n]))
  const kept = (await rig.rpc('turnList', { ws: ws.id })).at(-1)
  assert.deepEqual([got.get('near').state, got.get('near').turn, got.get('near').hunk], ['changed', kept.n, [5, 5]])
  assert.equal(got.get('far').state, 'unchanged')
  assert.equal(got.get('unsent').state, undefined, 'one never sent: as it was')
  // a window's copy from before the turn (still sent) keeps what the turn found
  await rig.rpc('reviewNotesSet', { ws: ws.id, notes: [{ ...base, id: 'near', line: 5, body: 'round it, please' }] })
  assert.equal((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes[0].state, 'changed')
  // Accept: done kept
  await rig.rpc('reviewNotesSet', { ws: ws.id, notes: [{ ...base, id: 'near', line: 5, state: 'changed', done: true }] })
  assert.equal((await rig.rpc('reviewNotesGet', { ws: ws.id })).notes[0].done, true)
})

test('attachments: a comment\'s pictures and files as 📎 lines; GitHub gets the words and how many stayed', async () => {
  const { attachments, forGitHub } = await import('../src/shared/reviewNotes.ts')
  const body = 'This button looks wrong\n📎 /data/images/a.png\n📎 /data/files/1/spec.pdf\n📎 '
  assert.deepEqual(attachments(body), ['/data/images/a.png', '/data/files/1/spec.pdf'])
  assert.equal(forGitHub(body), 'This button looks wrong\n\n_(2 attachments with this comment went to the agent only)_')
  assert.equal(forGitHub('just words'), 'just words')
})
