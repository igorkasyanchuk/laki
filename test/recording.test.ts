import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { veiled, type View } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

test('prompts: yours through Laki, newest first, the same text moved up, a /command left out', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'fix the cart total' })
  const tab = await until(() => rig.tab(ws.id), 'agent tab')
  await rig.rpc('send', { target: tab.id, text: 'now add a test', whenIdle: true })
  await rig.rpc('send', { target: tab.id, text: '/compact', whenIdle: true })
  await rig.rpc('send', { target: tab.id, text: 'fix the cart total', whenIdle: true })
  const list = await rig.rpc('prompts')
  assert.deepEqual(list.map((x: any) => x.text), ['fix the cart total', 'now add a test'])
  assert.equal(list[1].ws, ws.id)
  await rig.rpc('send', { target: tab.id, text: 'an insert, no Enter', enter: false })
  await rig.rpc('send', { target: tab.id, text: 'what Laki AI sends', whenIdle: true, by: 'ai' }) // aiRpc's
  await rig.rpc('send', { target: tab.id, text: 'From a side question: …', whenIdle: true, by: 'side' }) // Side chat's Send to main chat
  assert.deepEqual((await rig.rpc('prompts')).map((x: any) => x.text), ['fix the cart total', 'now add a test'], "an insert, Laki AI's and a side chat's aren't yours")
})

test('background image: kept in its folder, read back as a data URL, the one before gone; none clears it', async t => {
  const rig = await fresh(t)
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
  await assert.rejects(rig.rpc('bgSet', { data: png, ext: 'exe' }), /PNG, JPEG, GIF or WebP/)
  const a = await rig.rpc('bgSet', { data: png, ext: 'png' })
  assert.equal((await rig.rpc('state')).settings.background.file, a.file)
  assert.match(await rig.rpc('bgGet'), /^data:image\/png;base64,/)
  await new Promise(r => setTimeout(r, 5)) // a new name: its ms
  const b = await rig.rpc('bgSet', { data: png, ext: 'jpg' })
  assert.deepEqual(readdirSync(join(rig.data, 'background')), [b.file])
  assert.match(await rig.rpc('bgGet'), /^data:image\/jpeg;base64,/)
  await rig.rpc('settingsSet', { background: { ...(await rig.rpc('state')).settings.background, dim: 40 } })
  await rig.rpc('bgSet', {})
  assert.equal((await rig.rpc('state')).settings.background.file, undefined)
  assert.equal((await rig.rpc('state')).settings.background.dim, 40, 'its sliders stay')
  assert.equal(await rig.rpc('bgGet'), null)
  assert.equal(existsSync(join(rig.data, 'background', b.file)), false)
})

test('Recording mode: private workspaces and projects kept by the daemon, out of a window\'s view while it is on', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'open-work' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'secret-work' })
  await rig.rpc('wsSet', { id: b.id, private: true })
  let v: View = await rig.rpc('state')
  assert.equal(v.workspaces.find(w => w.id === b.id)?.private, true)
  assert.equal(veiled(v), v, 'off: everything')
  await rig.rpc('settingsSet', { recording: true })
  v = await rig.rpc('state')
  assert.deepEqual(veiled(v).workspaces.map(w => w.id).sort(), v.workspaces.filter(w => w.id !== b.id).map(w => w.id).sort())
  assert.ok(veiled(v).workspaces.some(w => w.id === a.id))
  await rig.rpc('projectSet', { id: p.id, private: true })
  v = await rig.rpc('state')
  assert.deepEqual(veiled(v).projects.filter(x => x.id === p.id), [])
  assert.deepEqual(veiled(v).workspaces.filter(w => w.project === p.id), [])
  await rig.rpc('projectSet', { id: p.id, private: false })
  await rig.rpc('wsSet', { id: b.id, private: false })
  v = await rig.rpc('state')
  assert.equal(v.projects.find(x => x.id === p.id)?.private, undefined)
  assert.equal(veiled(v).workspaces.length, v.workspaces.length)
})

test("a group's defaults for new workspaces: where, permission mode, model, effort, base kept; bad ones dropped", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, seps: [{ id: 'sep-a', name: 'Fast lane', where: 'local', perm: 'acceptEdits', model: 'opus', effort: 'high', base: 'release/2.0' }, { id: 'sep-b', name: 'Odd', where: 'cloud', model: 'a b; rm -rf', base: '  ' }] })
  const seps = (await rig.rpc('state')).projects.find((x: any) => x.id === p.id).seps
  assert.deepEqual(seps[0], { id: 'sep-a', name: 'Fast lane', where: 'local', perm: 'acceptEdits', model: 'opus', effort: 'high', base: 'release/2.0' })
  assert.deepEqual(seps[1], { id: 'sep-b', name: 'Odd' })
})
