import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

test('notes: on unless turned off; made, saved, searched, colored, pinned, a file kept, deleted with its files', async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { notes: false })
  await assert.rejects(rig.rpc('noteList'), /Notes are off/)
  await rig.rpc('settingsSet', { notes: true })
  assert.deepEqual(await rig.rpc('noteList'), [])
  const a = await rig.rpc('noteNew', { title: '  Deploy   steps ', color: 'teal' })
  assert.equal(a.title, 'Deploy steps')
  assert.equal(a.color, 'teal')
  const b = await rig.rpc('noteNew', {})
  // its text: the list's preview, Markdown's marks out; a title or text change moves it up, a pin or a color doesn't
  await rig.rpc('noteSave', { id: b.id, title: 'Ideas', blocks: [{ type: 'paragraph' }], md: '## Cache\n\n- [ ] try **redis** for [sessions](https://x.dev)\n' })
  let l = await rig.rpc('noteList')
  assert.deepEqual(l.map((n: any) => n.title), ['Ideas', 'Deploy steps'])
  assert.equal(l[0].preview, 'Cache try redis for sessions')
  await rig.rpc('noteSave', { id: a.id, pinned: true, color: null })
  l = await rig.rpc('noteList')
  assert.deepEqual(l.map((n: any) => [n.title, !!n.pinned, n.color ?? '']), [['Deploy steps', true, ''], ['Ideas', false, '']])
  assert.equal(l[0].at, a.at, 'a pin keeps its place in time')
  // search: every word, in its title or text, any case
  assert.deepEqual((await rig.rpc('noteList', { q: 'REDIS sessions' })).map((n: any) => n.id), [b.id])
  assert.deepEqual((await rig.rpc('noteList', { q: 'deploy' })).map((n: any) => n.id), [a.id])
  assert.deepEqual(await rig.rpc('noteList', { q: 'redis nope' }), [])
  const got = await rig.rpc('noteGet', { id: b.id })
  assert.deepEqual(got.blocks, [{ type: 'paragraph' }])
  // a pasted image: kept beside it, shown as a data URL; a name taken gets -2; nothing outside its folder
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
  assert.deepEqual(await rig.rpc('noteUpload', { id: b.id, name: 'shot.png', data: png }), { path: 'files/shot.png' })
  assert.deepEqual(await rig.rpc('noteUpload', { id: b.id, name: '../shot.png', data: png }), { path: 'files/shot-2.png' })
  assert.match((await rig.rpc('noteFile', { id: b.id, path: 'files/shot.png' })).image, /^data:image\/png;base64,/)
  assert.deepEqual(await rig.rpc('noteFile', { id: b.id, path: 'files/../../state.json' }), {})
  await assert.rejects(rig.rpc('noteGet', { id: '../state' }), /no such note/)
  // deleted: the note and its files
  await rig.rpc('noteRm', { id: b.id })
  assert.ok(!existsSync(join(rig.data, 'notes', b.id)))
  assert.deepEqual((await rig.rpc('noteList')).map((n: any) => n.id), [a.id])
  await assert.rejects(rig.rpc('noteGet', { id: b.id }), /no such note/)
})

test('to-dos: on unless turned off; one list, saved and read back, kept in a file of its own', async t => {
  const rig = await fresh(t)
  assert.deepEqual(await rig.rpc('todoListGet'), { blocks: [], md: '', at: 0 }, 'on by default')
  await rig.rpc('settingsSet', { todoList: false })
  await assert.rejects(rig.rpc('todoListGet'), /To-dos are off/)
  await rig.rpc('settingsSet', { todoList: true })
  assert.deepEqual(await rig.rpc('todoListGet'), { blocks: [], md: '', at: 0 }, 'none yet')
  const blocks = [{ type: 'heading', content: 'Today' }, { type: 'checkListItem', props: { checked: true }, content: 'ship it', children: [{ type: 'checkListItem', content: 'tests' }] }]
  const { at } = await rig.rpc('todoListSave', { blocks, md: '## Today\n\n- [x] ship it\n  - [ ] tests\n' })
  assert.deepEqual(await rig.rpc('todoListGet'), { blocks, md: '## Today\n\n- [x] ship it\n  - [ ] tests\n', at })
  await assert.rejects(rig.rpc('todoListSave', { blocks: 'nope' }), /blocks: a list/)
  await rig.rpc('settingsSet', { todoList: false })
  await assert.rejects(rig.rpc('todoListSave', { blocks: [] }), /To-dos are off/, 'off: nothing written')
  await rig.rpc('settingsSet', { todoList: true })
  assert.equal((await rig.rpc('todoListGet')).at, at, 'kept while it was off')
})

test("to-dos: a file that doesn't read is never saved over with an empty list", async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { todoList: true })
  writeFileSync(join(rig.data, 'todo-list.json'), '{"blocks": [')
  await assert.rejects(rig.rpc('todoListGet'), /doesn't read as JSON/)
  writeFileSync(join(rig.data, 'todo-list.json'), '{}') // JSON, but no list
  await assert.rejects(rig.rpc('todoListGet'), /doesn't read as JSON/)
})
