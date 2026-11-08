// The notification inbox (daemon/inbox.ts): events kept across a restart, read and cleared, no duplicates on a reconnect,
// private workspaces out of it in Recording mode.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

test("inbox: a finished turn and an ask are kept with no buttons, read, cleared; a reconnect adds none; a restart keeps them", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first task' })
  const tab = await rig.tab(ws.id)
  const done = await until(async () => (await rig.rpc('inboxList')).find((e: any) => e.kind === 'done'), 'the finished turn')
  assert.equal(done.text, 'answer: first task')
  assert.deepEqual([done.ws, done.tab, done.read], [ws.id, tab.id, undefined])
  assert.equal((await rig.rpc('state')).inbox.unread, 1)

  const c = await connect(rig) // a client coming doesn't add it again
  t.after(() => c.close())
  assert.deepEqual((await rig.rpc('inboxList')).map((e: any) => e.id), [done.id])

  await rig.rpc('send', { target: ws.id, text: 'ask me' })
  const ask = await until(async () => (await rig.rpc('inboxList')).find((e: any) => e.kind === 'waiting'), 'the ask')
  assert.deepEqual(Object.keys(ask).filter(k => /option|perm|answer|ask/.test(k)), [], 'no buttons kept')
  assert.equal((await rig.rpc('inboxList'))[0].id, ask.id, 'the newest first')

  assert.deepEqual(await rig.rpc('inboxRead', { ids: [done.id] }), { read: 1 })
  assert.equal((await rig.rpc('state')).inbox.unread, 1)

  await rig.stop()
  await rig.start()
  const kept = await rig.rpc('inboxList')
  assert.deepEqual(kept.map((e: any) => [e.id, !!e.read]), [[ask.id, false], [done.id, true]])

  assert.deepEqual(await rig.rpc('inboxRead', {}), { read: 1 })
  assert.equal((await rig.rpc('state')).inbox.unread, 0)
  assert.deepEqual(await rig.rpc('inboxClear'), { cleared: 2 })
  assert.deepEqual(await rig.rpc('inboxList'), [])
})

test('inbox: a turn on screen in a focused window is read already; a muted tab adds nothing', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'one' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.rpc('inboxList')).length === 1, 'the first turn')
  const c = await connect(rig)
  t.after(() => c.close())
  await c.call('view', { tab: tab.id, focused: true })
  await rig.rpc('send', { target: ws.id, text: 'two' })
  await until(async () => (await rig.rpc('inboxList')).length === 2, 'the second turn')
  assert.equal((await rig.rpc('inboxList'))[0].read, true)
  await rig.rpc('tabSet', { id: tab.id, muted: true })
  await rig.rpc('send', { target: ws.id, text: 'three' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: three', 'the third turn')
  assert.equal((await rig.rpc('inboxList')).length, 2)
})

test('inbox: Recording mode hides a private workspace from the list, the count, Mark all read and Clear; those stay', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'secret' })
  await until(async () => (await rig.rpc('inboxList')).length === 1, 'the turn')
  await rig.rpc('wsSet', { id: ws.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  assert.deepEqual(await rig.rpc('inboxList'), [])
  assert.equal((await rig.rpc('state')).inbox.unread, 0)
  assert.deepEqual(await rig.rpc('inboxRead', {}), { read: 0 })
  assert.deepEqual(await rig.rpc('inboxClear'), { cleared: 0 })
  await rig.rpc('settingsSet', { recording: false })
  const back = await rig.rpc('inboxList')
  assert.equal(back.length, 1)
  assert.equal(back[0].read, undefined)
})

test('inbox: the newest 200 and short text; a bad file starts empty; a reminder lands', async t => {
  const rig = await fresh(t)
  await rig.stop()
  const file = join(rig.data, 'inbox.json')
  writeFileSync(file, JSON.stringify(Array.from({ length: 205 }, (_, i) => ({ id: `e${i}`, at: i, kind: 'done', title: 't', text: 'x' }))))
  await rig.start()
  const list = await rig.rpc('inboxList')
  assert.equal(list.length, 200)
  assert.equal(list[0].id, 'e0')

  const c = await connect(rig)
  t.after(() => c.close())
  const long = 'word '.repeat(200)
  const at = Date.now() + 3_600_000
  await rig.rpc('reminderAdd', { at: 'in 1h', text: long })
  await rig.rpc('reminderTick', { now: at + 60_000 })
  const now = await rig.rpc('inboxList')
  assert.equal(now.length, 200)
  assert.equal(now[0].kind, 'reminder')
  assert.ok(now[0].text.length <= 300)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 200)

  await rig.stop()
  writeFileSync(file, 'not json')
  await rig.start()
  assert.deepEqual(await rig.rpc('inboxList'), [])
})

test('inbox: ids that are no list mark nothing; a repeated ask is one row', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'one' })
  await until(async () => (await rig.rpc('inboxList')).length === 1, 'the turn')
  assert.deepEqual(await rig.rpc('inboxRead', { ids: 'x' }), { read: 0 })
  const tab = await rig.tab(ws.id)
  const ask = (message: unknown) => rig.rpc('hook', { tab: tab.id, state: 'waiting', payload: { message } })
  const asks = async () => (await rig.rpc('inboxList')).filter((e: any) => e.kind === 'waiting')
  await ask('waiting for your input')
  await ask('waiting for your input')
  await until(async () => (await asks()).length === 1, 'the ask, a moment later')
  await new Promise(r => setTimeout(r, 1000))
  assert.equal((await asks()).length, 1, 'said again: one row')
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  await ask(42) // not text: it still lands, and the hook isn't broken by it
  await until(async () => (await asks())[0].text === '42', 'a number as text')
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  await ask('over at once')
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  await new Promise(r => setTimeout(r, 1200))
  assert.ok(!(await asks()).some((e: any) => e.text === 'over at once'), 'one over at once needed nobody')
})
