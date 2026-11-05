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
  await assert.rejects(rig.rpc('alertShow', { text: 'one too many' }), /5 alerts or notices a minute/)
  // another tab's are its own
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const tab = (await rig.rpc('tabNew', { ws: w.id })).id
  assert.equal((await rig.rpc('alertShow', { text: 'from a tab', from: { tab } })).shown, true)
})

test("laki notice: a card in Laki's window, kept for one that opens later; --to names the session; closed, it goes everywhere", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'fix-login' })
  const tab = (await rig.rpc('tabNew', { ws: w.id })).id
  // no window open: kept, and the first one that connects shows it
  const n = await rig.rpc('noticeShow', { text: 'Ready for review', to: w.id })
  assert.equal(n.shown, true)
  const ws = await rig.connect()
  t.after(() => ws.close())
  const ev = await until(() => ws.events.find(e => e.ev === 'notice' && e.id === n.id), 'the notice, sent as the window connects')
  // a workspace without an agent: the workspace, Open going to it as you left it
  assert.deepEqual([ev.text, ev.title, ev.choices, ev.to], ['Ready for review', 'Laki', [], { ws: w.id, name: 'fix-login' }])
  assert.ok(!ws.events.some(e => e.ev === 'alert'), 'not an alert: no card over every app')
  await assert.rejects(rig.rpc('noticeShow', { text: 'x', to: 'nope' }), /no workspace|nope/)
  // its ×: gone in every window, and not sent to the next
  assert.deepEqual(await rig.rpc('alertAnswer', { id: n.id }), { ok: true })
  await until(() => ws.events.some(e => e.ev === 'alertDone' && e.id === n.id), 'its card goes')
  const ws2 = await rig.connect()
  t.after(() => ws2.close())
  await rig.rpc('state') // the connect's own messages are in by then
  assert.ok(!ws2.events.some(e => e.ev === 'notice'), 'a closed notice is not sent again')
  assert.deepEqual(await rig.rpc('alertAnswer', { id: n.id }), { gone: true })

  // through the CLI with choices: it waits for the pick and prints it; a window that connects meanwhile shows it too
  const cli = rig.cli('notice', 'Merge', 'fix-login?', '--choice', 'Merge', '--choice', 'Later', '--to', `${w.id}/1`, '--title', 'From review')
  const q = await until(() => ws.events.find(e => e.ev === 'notice' && e.text === 'Merge fix-login?'), 'the question')
  assert.deepEqual([q.title, q.choices, q.to.tab, q.to.ws], ['From review', ['Merge', 'Later'], tab, w.id])
  const ws3 = await rig.connect()
  t.after(() => ws3.close())
  await until(() => ws3.events.some(e => e.ev === 'notice' && e.id === q.id), 'the waiting one, to a new window')
  await rig.rpc('alertAnswer', { id: q.id, choice: 'Later' })
  const r = await cli
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out.trim(), 'Later')
  await until(() => ws3.events.some(e => e.ev === 'alertDone' && e.id === q.id), 'its card goes')
})

test('laki notice: past 20 the oldest that only tell go, never one that waits; none sent again about a workspace Recording mode hides', async t => {
  const rig = await fresh(t)
  const ws = await rig.connect()
  t.after(() => ws.close())
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'quiet' })
  const tabs: string[] = []
  for (let i = 0; i < 5; i++) tabs.push((await rig.rpc('tabNew', { ws: w.id })).id) // 5 a minute from each
  const asked = rig.rpc('noticeShow', { text: 'Merge it?', choices: ['Yes'], from: { tab: tabs[0] } }) // the oldest, and it waits
  const first = await until(() => ws.events.find(e => e.ev === 'notice' && e.text === 'Merge it?'), 'the question')
  const told: string[] = []
  for (let i = 0; i < 20; i++) told.push((await rig.rpc('noticeShow', { text: `n${i}`, from: { tab: tabs[1 + Math.floor(i / 5)] } })).id)
  // 21 up: one went, the oldest that only told (n0), not the question
  await until(() => ws.events.some(e => e.ev === 'alertDone' && e.id === told[0]), 'n0 goes')
  assert.ok(!ws.events.some(e => e.ev === 'alertDone' && e.id === first.id), 'the question stays')
  await rig.rpc('alertAnswer', { id: first.id, choice: 'Yes' })
  assert.equal((await asked).choice, 'Yes')

  // Recording mode on a workspace: a window that connects gets none about it (its words would be on screen)
  await rig.rpc('noticeShow', { text: 'about it', to: w.id })
  await rig.rpc('noticeShow', { text: 'from outside' })
  await rig.rpc('wsSet', { id: w.id, private: true })
  await rig.rpc('settingsSet', { recording: true })
  const ws2 = await rig.connect()
  t.after(() => ws2.close())
  await rig.rpc('state')
  assert.ok(!ws2.events.some(e => e.ev === 'notice' && ['about it', 'n19'].includes(e.text)), 'none about it, none from it')
  assert.ok(ws2.events.some(e => e.ev === 'notice' && e.text === 'from outside'), 'the rest still')
})
