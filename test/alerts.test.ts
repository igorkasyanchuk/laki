import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('laki alert: a card for the app (none open: refused); with choices it waits for the pick, a closed one says so', async t => {
  const rig = await fresh(t)
  await assert.rejects(rig.rpc('alertShow', { text: 'hi' }), /app isn't open/)
  const ws = await rig.connect()
  t.after(() => ws.close())
  await assert.rejects(rig.rpc('alertShow', { text: '  ' }), /what should it say/)
  await assert.rejects(rig.rpc('alertShow', { text: 'x', choices: ['1', '2', '3', '4', '5', '6', '7'] }), /6 choices/)

  // a notice: shown, nothing waits
  const shown = await rig.rpc('alertShow', { text: 'Tests pass', title: 'Ready' })
  assert.equal(shown.shown, true)
  const ev = await until(() => ws.events.find(e => e.ev === 'alert' && e.id === shown.id), 'the alert event')
  assert.deepEqual([ev.title, ev.text, ev.choices], ['Ready', 'Tests pass', []])
  assert.deepEqual(await rig.rpc('alertAnswer', { id: shown.id }), { gone: true })

  // a question through the CLI: it waits for the pick and prints it; only one of its choices counts
  const cli = rig.cli('alert', 'Deploy', 'now?', '--choice', 'Deploy', '--choice', 'Not yet')
  const q = await until(() => ws.events.find(e => e.ev === 'alert' && e.text === 'Deploy now?'), 'the question')
  assert.deepEqual(q.choices, ['Deploy', 'Not yet'])
  await assert.rejects(rig.rpc('alertAnswer', { id: q.id, choice: 'Maybe' }), /not one of its choices/)
  await rig.rpc('alertAnswer', { id: q.id, choice: 'Not yet' })
  const r = await cli
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out.trim(), 'Not yet')
  await until(() => ws.events.some(e => e.ev === 'alertDone' && e.id === q.id), 'its card goes')

  // closed without a choice (its ×): the caller hears it, exit 1
  const cli2 = rig.cli('alert', 'Merge it?', '--choice', 'Yes')
  const q2 = await until(() => ws.events.find(e => e.ev === 'alert' && e.text === 'Merge it?'), 'the second')
  await rig.rpc('alertAnswer', { id: q2.id })
  const r2 = await cli2
  assert.equal(r2.code, 1)
  assert.match(r2.err, /closed it without a choice/)
})

test('laki alert: none from a workspace Recording mode hides (its words would be on screen)', async t => {
  const rig = await fresh(t)
  const ws = await rig.connect()
  t.after(() => ws.close())
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'secret-work' })
  const tab = (await rig.rpc('tabNew', { ws: w.id })).id
  await rig.rpc('wsSet', { id: w.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  await assert.rejects(rig.rpc('alertShow', { text: 'Rotate the key?', choices: ['Yes'], from: { tab } }), /Recording mode hides/)
  await rig.rpc('settingsSet', { recording: false })
  assert.equal((await rig.rpc('alertShow', { text: 'Rotate the key?', from: { tab } })).shown, true)
})

test("laki alert: what you'd not see goes from its words; a few a minute from each tab", async t => {
  const rig = await fresh(t)
  const ws = await rig.connect()
  t.after(() => ws.close())
  // a right-to-left override and a zero-width space would make a choice read as another
  const a = await rig.rpc('alertShow', { text: 'Ship\u202Eit\u200B now?', title: 'Re\u00A0lease' })
  const ev = await until(() => ws.events.find(e => e.ev === 'alert' && e.id === a.id), 'the alert')
  assert.deepEqual([ev.text, ev.title], ['Ship it now?', 'Re lease'])
  for (let i = 0; i < 4; i++) await rig.rpc('alertShow', { text: `n${i}` })
  await assert.rejects(rig.rpc('alertShow', { text: 'one too many' }), /5 alerts a minute/)
  // another tab's are its own
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const tab = (await rig.rpc('tabNew', { ws: w.id })).id
  assert.equal((await rig.rpc('alertShow', { text: 'from a tab', from: { tab } })).shown, true)
})
