import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test("send into the running turn: the user's own follow-up types in now, Laki's own and a queue's wait; a profile turns it off", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const w = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'slow one', noSetup: true })
  const tab = await until(async () => ((x: any) => x?.status === 'running' && x)(await rig.tab(w.id, 'claude')), 'at work')
  // steer (the app's Send later, Reader, reply): typed into the running turn, no queue
  assert.deepEqual(await rig.rpc('send', { target: tab.id, text: 'also check the footer', whenIdle: true, steer: true }), { tab: tab.id, sent: true, steered: true })
  await until(async () => (await rig.screen(tab.id)).includes('also check the footer'), 'typed in')
  // without it (PR fixes, workflows, laki ask): queued, as before; then a steer waits behind it, in order
  assert.deepEqual(await rig.rpc('send', { target: tab.id, text: 'next task', whenIdle: true }), { tab: tab.id, queued: 1 })
  assert.deepEqual(await rig.rpc('send', { target: tab.id, text: 'and this', whenIdle: true, steer: true }), { tab: tab.id, queued: 2 })
  await rig.rpc('queueClear', { target: tab.id })
  // the profile's switch off: queued
  const presets = (await rig.rpc('state')).settings.presets ?? [{ name: 'claude', agent: 'claude' }, { name: 'codex', agent: 'codex' }]
  await rig.rpc('settingsSet', { presets: presets.map((x: any) => (x.name === 'claude' ? { ...x, steer: false } : x)) })
  assert.deepEqual(await rig.rpc('send', { target: tab.id, text: 'later', whenIdle: true, steer: true }), { tab: tab.id, queued: 1 })
})

test('Applicable for Workflows: a project setting the app keeps, off unless true', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.equal((await rig.rpc('projectSet', { id: p.id, config: { workflows: true } })).config.workflows, true)
  assert.equal((await rig.rpc('projectSet', { id: p.id, config: { workflows: 'yes' } })).config.workflows, undefined, 'only true')
  assert.equal((await rig.rpc('projectSet', { id: p.id, config: {} })).config.workflows, undefined)
})
