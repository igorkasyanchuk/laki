// #5: laki suggest (daemon/suggest.ts): an agent's suggested task is a card the user answers; nothing starts without them
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

test("suggest: an agent's card; the same title is the same card; withdraw an open one; dismissed stays dismissed; Start makes a workspace", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await rig.tab(ws.id)
  const from = { tab: tab.id }
  const list = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).suggests ?? []
  await assert.rejects(rig.rpc('suggest', { title: 'Fix it', from }), /usage: laki suggest/)
  const a = await rig.rpc('suggest', { title: 'Fix the flaky checkout test', why: 'it failed twice', prompt: 'make test/checkout reliable', from })
  assert.deepEqual(await rig.rpc('suggest', { title: 'fix the  flaky checkout test', prompt: 'x', from }), { id: a.id, again: true })
  const [s] = await list()
  assert.deepEqual([s.title, s.why, s.prompt, s.tab, s.answered], ['Fix the flaky checkout test', 'it failed twice', 'make test/checkout reliable', tab.id, undefined])
  // its agent takes one back; never yours to start or dismiss
  const b = await rig.rpc('suggest', { title: 'Bump the lockfile', prompt: 'npm update', from })
  assert.deepEqual(await rig.rpc('suggest', { withdraw: b.id, from }), { withdrawn: b.id })
  await assert.rejects(rig.rpc('suggestAnswer', { ws: ws.id, id: a.id, act: 'start', from }), /start or dismiss a suggested task/)
  // dismissed: it can't come back or be withdrawn
  await rig.rpc('suggestAnswer', { ws: ws.id, id: a.id, act: 'dismiss' })
  await assert.rejects(rig.rpc('suggest', { withdraw: a.id, from }), /dismissed it already/)
  await assert.rejects(rig.rpc('suggest', { title: 'Fix the flaky checkout test', prompt: 'again', from }), /dismissed "Fix the flaky checkout test" already/)
  await assert.rejects(rig.rpc('suggestAnswer', { ws: ws.id, id: a.id, act: 'start' }), /gone/)
  // Start: a workspace of its own in that project, with the prompt; the card answered
  const c = await rig.rpc('suggest', { title: 'Add a README', prompt: 'write a README for it', from })
  const r = await rig.rpc('suggestAnswer', { ws: ws.id, id: c.id, act: 'start' })
  const made = (await rig.rpc('state')).workspaces.find((w: any) => w.id === r.made)
  assert.equal(made.project, p.id)
  assert.equal(made.fromTab, undefined, 'yours, not a worker of that tab')
  assert.deepEqual((await list()).map((x: any) => [x.title, x.answered, x.ws]), [['Fix the flaky checkout test', 'dismissed', undefined], ['Add a README', 'started', r.made]])
  // the CLI, in the agent's tab
  assert.match((await rig.cli('suggest', 'Tidy the logs', '--prompt', 'cut the debug lines')).err, /in an agent's tab, or --ws <ws>/)
  assert.match((await rig.cli('suggest', 'Tidy the logs', '--why', 'noisy', '--prompt', 'cut the debug lines', '--ws', ws.id)).out, /^suggested \(\w+\): a card in Laki/)
})
