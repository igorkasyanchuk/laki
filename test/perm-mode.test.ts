// A running claude's permission mode (tabMode): by its own shift-tab, read back from its footer; what's refused.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { claudeMode } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

test('claudeMode: the footer as claude draws it, an answer that mentions a mode is no footer', () => {
  assert.equal(claudeMode('  ? for shortcuts'), 'default')
  assert.equal(claudeMode('╰───╯\n  ⏵⏵ accept edits on (shift+tab to cycle)'), 'acceptEdits')
  assert.equal(claudeMode('  ⏸ plan mode on'), 'plan')
  assert.equal(claudeMode('  ⏵⏵ auto mode on'), 'auto')
  assert.equal(claudeMode('  ⏵⏵ bypass permissions on'), 'bypassPermissions')
  assert.equal(claudeMode('I turned plan mode on for you'), 'default')
  assert.equal(claudeMode('> plan mode on'), 'default', 'typed in its prompt')
  assert.equal(claudeMode('plan mode on'), 'default')
  assert.equal(claudeMode("  ⏵⏵ don't ask on"), 'dontAsk')
})

const started = async (rig: any, o: object = {}) => {
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true, ...o })
  await until(async () => /> /.test(await rig.screen((await rig.tab(ws.id)).id)), 'claude up')
  const tab = (await rig.tab(ws.id)).id
  await until(async () => (await rig.tab(ws.id)).mode, 'its mode read')
  return { ws, tab }
}

test('tabMode: goes to the mode asked by shift-tab, mid-turn too, and the view says what is on; Bypass only where it can be had', async t => {
  const rig = await fresh(t)
  const { ws, tab } = await started(rig)
  const view = () => rig.tab(ws.id)
  assert.equal((await view()).mode, 'default')
  assert.match((await view()).bypassNo, /started with Bypass/)
  assert.deepEqual(await rig.rpc('tabMode', { tab, mode: 'plan' }), { mode: 'plan' })
  assert.equal((await view()).mode, 'plan')
  assert.match(await rig.screen(tab), /plan mode on/)
  await rig.rpc('tabMode', { tab, mode: 'plan' }) // already there: nothing pressed
  assert.deepEqual(await rig.rpc('tabMode', { tab, mode: 'default' }), { mode: 'default' })

  // a press in its terminal is seen too
  await rig.rpc('input', { tab, data: '\x1b[Z' })
  await until(async () => (await view()).mode === 'acceptEdits', 'read off the screen', 10000)
  await rig.rpc('tabMode', { tab, mode: 'default' })

  await assert.rejects(rig.rpc('tabMode', { tab, mode: 'bypassPermissions' }), /Only a tab started with Bypass/)
  assert.equal((await view()).mode, 'default', 'nothing pressed')
  await assert.rejects(rig.rpc('tabMode', { tab, mode: 'nope' }), /no permission mode called nope/)

  // two picks at once: one presses, the other is told
  const both = await Promise.allSettled([rig.rpc('tabMode', { tab, mode: 'plan' }), rig.rpc('tabMode', { tab, mode: 'plan' })])
  assert.deepEqual(both.map(x => x.status).sort(), ['fulfilled', 'rejected'])
  assert.equal((await view()).mode, 'plan', 'not past it')
  await rig.rpc('tabMode', { tab, mode: 'default' })

  // mid-turn
  await rig.rpc('send', { target: tab, text: 'slow one' })
  await until(async () => (await view()).status === 'running', 'its turn')
  assert.deepEqual(await rig.rpc('tabMode', { tab, mode: 'acceptEdits' }), { mode: 'acceptEdits' })

  // it asks: answer first
  await rig.rpc('hook', { tab, state: 'waiting', payload: { message: 'Claude needs your permission' } })
  await assert.rejects(rig.rpc('tabMode', { tab, mode: 'plan' }), /asking you something/)

  const shell = await rig.rpc('tabNew', { ws: ws.id })
  await assert.rejects(rig.rpc('tabMode', { tab: shell.id, mode: 'plan' }), /only a running Claude Code tab/)
})

test('tabMode: a tab started with Bypass can come back to it; a mode its build never shows is said, not assumed; the policy refuses', async t => {
  const policy = join(mkdtempSync(join(tmpdir(), 'laki-policy-')), 'policy.json')
  t.after(() => rmSync(dirname(policy), { recursive: true, force: true }))
  writeFileSync(policy, '{}')
  const rig = await fresh(t, { env: { LAKI_POLICY: policy, FAKE_MODE_LINE: '1' } })
  const { ws, tab } = await started(rig, { perm: 'bypassPermissions' })
  assert.equal((await rig.tab(ws.id)).mode, 'bypassPermissions')
  assert.equal((await rig.tab(ws.id)).bypassNo, undefined)
  await rig.rpc('tabMode', { tab, mode: 'default' })
  assert.deepEqual(await rig.rpc('tabMode', { tab, mode: 'bypassPermissions' }), { mode: 'bypassPermissions' })
  await rig.rpc('tabMode', { tab, mode: 'plan' })

  // its sandbox rules Bypass out
  const boxed = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', sandbox: true, perm: '' })
  await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.id === boxed.id)?.mode, 'read')
  assert.match((await rig.rpc('state')).tabs.find((x: any) => x.id === boxed.id).bypassNo, /sandbox/)
  await assert.rejects(rig.rpc('tabMode', { tab: boxed.id, mode: 'bypassPermissions' }), /sandbox/)

  writeFileSync(policy, JSON.stringify({ bypass: false }))
  await rig.stop()
  await rig.start()
  const plain = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', perm: '' })
  const seen = await until(async () => (x => x?.mode && x)((await rig.rpc('state')).tabs.find((x: any) => x.id === plain.id)), 'read')
  assert.match(seen.bypassNo, /managed policy/)
  await assert.rejects(rig.rpc('tabMode', { tab: plain.id, mode: 'bypassPermissions' }), /managed policy/)
})

test('tabMode: a build whose footer never changes is told, nothing is assumed', async t => {
  const rig = await fresh(t, { env: { FAKE_NO_MODES: '1' } })
  const { ws, tab } = await started(rig)
  await assert.rejects(rig.rpc('tabMode', { tab, mode: 'plan' }), /didn't change mode/)
  assert.equal((await rig.tab(ws.id)).mode, 'default')
})
