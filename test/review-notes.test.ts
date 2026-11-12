// R10: the Review tab's unsent comments, kept by the daemon per workspace: set, read, through a restart and an archive,
// gone with the workspace, capped, and the user's alone (not an agent's)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

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
