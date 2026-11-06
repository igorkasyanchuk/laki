import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CAPS, hasCap, oldName } from '../src/shared/caps.ts'
import { rpc } from '../src/shared/conn.ts'
import { API } from '../src/shared/types.ts'
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

test('note.* (H6.3): the namespaced names reach the same handlers and checks; caps in the view and from ping', async t => {
  const rig = await fresh(t)
  await rig.rpc('settingsSet', { notes: false })
  await assert.rejects(rig.rpc('note.list'), /Notes are off/) // the handler's own check, as noteList's
  await rig.rpc('settingsSet', { notes: true })
  const n = await rig.rpc('note.new', { title: 'Pilot' })
  await rig.rpc('note.save', { id: n.id, blocks: [{ type: 'paragraph' }], md: 'aliases work' })
  assert.equal((await rig.rpc('noteGet', { id: n.id })).title, 'Pilot') // old and new names: one note
  assert.deepEqual((await rig.rpc('note.list', { q: 'aliases' })).map((x: any) => x.id), [n.id])
  await assert.rejects(rig.rpc('note.nope'), /^Error: unknown method note\.nope$/)
  await assert.rejects(rig.rpc('constructor'), /^Error: unknown method constructor$/) // not the table's prototype
  assert.equal(await rig.rpc('ping'), 'pong') // what every CLI's alive() checks
  assert.deepEqual(await rig.rpc('ping', { caps: true }), { pong: true, api: API, caps: CAPS })
  assert.deepEqual((await rig.rpc('state')).caps, CAPS)
  assert.ok(CAPS.includes('ns:note') && CAPS.includes('ws.peek'))
})

test('caps against an older daemon: hasCap by its API number; the CLI sends a name it refuses once more by the old one, then that one', async t => {
  assert.equal(hasCap({ api: 94 }, 'ws.peek'), true) // no caps: the API number it came with
  assert.equal(hasCap({ api: 93 }, 'ws.peek'), false)
  assert.equal(hasCap({ api: 149 }, 'ns:note'), false) // no number for it: only a daemon that lists it
  assert.equal(hasCap({ api: 200, caps: ['ns:note'] }, 'ws.peek'), false) // caps listed: those only
  assert.equal(hasCap(null, 'layouts'), false)
  assert.equal(oldName('note.list'), 'noteList')
  assert.equal(oldName('constructor'), 'constructor')
  const seen: string[] = []
  const srv = createServer(async (req, res) => {
    let b = ''
    for await (const c of req) b += c
    const { method } = JSON.parse(b)
    seen.push(method)
    res.end(JSON.stringify(method === 'noteList' ? { result: ['old'] } : { error: `unknown method ${method}` })) // API 149's
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const home = mkdtempSync(join(tmpdir(), 'laki-old-'))
  writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: (srv.address() as { port: number }).port, token: 'x' }))
  const was = process.env.LAKI_HOME
  process.env.LAKI_HOME = home
  t.after(() => (was === undefined ? delete process.env.LAKI_HOME : (process.env.LAKI_HOME = was)))
  assert.deepEqual(await rpc('note.list'), ['old'])
  assert.deepEqual(await rpc('note.list'), ['old'])
  await assert.rejects(rpc('note.nope'), /^Error: unknown method note\.nope$/) // not an alias: refused as it is
  assert.deepEqual(seen, ['note.list', 'noteList', 'noteList', 'note.nope'])
})
