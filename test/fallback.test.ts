// Auto fallback (core.ts fallback, settings.limitFallback): a tab at its plan limit goes on on the next account in your
// order; none left, it waits for the reset. A model the installed claude is too old for (accounts.ts modelRefused):
// kept from the API's error, said in words, out of the model list until an update.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { older, tooOld } from '../src/daemon/limits.ts'
import { fresh, until } from './helpers.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const limit = (h: number) => ({ last_assistant_message: `You've hit your limit · resets in ${h} hours` })

test('auto fallback: at its plan limit a tab goes on on the next account in the order; with none left it waits', async t => {
  const rig = await fresh(t)
  mkdirSync(join(rig.home, '.claude'))
  const work = await rig.rpc('accountAdd', { agent: 'claude', name: 'Work' })
  const spare = await rig.rpc('accountAdd', { agent: 'claude', name: 'Spare' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi' })
  const tab = await until(async () => (x => x?.last === 'answer: hi' && x)(await rig.tab(ws.id)), 'its first turn') // over: its end would clear a limit
  const runs = () => rig.fakeLog().filter(l => l.bin === 'claude' && l.tab === tab.id)
  // off (no order): it waits for the reset, as before
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: limit(2) })
  await sleep(1500)
  assert.equal(runs().length, 1)
  assert.ok((await rig.tab(ws.id)).limit)
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })

  await rig.rpc('settingsSet', { limitFallback: { claude: ['home', work.id, spare.id] } })
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: limit(3) })
  await until(() => runs().length === 2, 'restarted on Work')
  assert.equal(runs()[1].env.CLAUDE_CONFIG_DIR, work.dir)
  assert.match(runs()[1].args.join(' '), new RegExp(`--resume ${tab.resumeId}`)) // the same chat
  const on = await until(async () => (x => x.last === 'answer: continue' && x)(await rig.tab(ws.id)), 'it went on')
  assert.deepEqual([on.limit, on.account], [undefined, work.id])
  // Work at its limit too (its reset at the default's time: another account's, so fresh): Spare; then Spare's: the
  // default and Work are still at theirs, so it waits
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: limit(3) })
  await until(() => runs().length === 3, 'restarted on Spare')
  assert.equal(runs()[2].env.CLAUDE_CONFIG_DIR, spare.dir)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: continue', 'it went on again')
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: limit(5) })
  await sleep(1500)
  assert.equal(runs().length, 3)
  assert.ok((await rig.tab(ws.id)).limit, 'it waits for the reset')
  // Reset the interface keeps the order (yours)
  await rig.rpc('uiReset', {})
  assert.deepEqual((await rig.rpc('state')).settings.limitFallback, { claude: ['home', work.id, spare.id] })
  // an account removed leaves the order
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: {} })
  await rig.rpc('accountRm', { id: work.id })
  assert.deepEqual((await rig.rpc('state')).settings.limitFallback, { claude: ['home', spare.id] })
})

test("a model too new for the installed claude: the API's error kept and said, the model out of the list until an update", async t => {
  // the words: the version it needs (the higher), the one it has, the model it names
  assert.deepEqual(tooOld('API Error: 400 {"error":{"error_code":"claude_code_version_too_old","message":"claude-opus-9-1 needs Claude Code 2.1.280 or newer; this is 2.1.99"}}'), { need: '2.1.280', have: '2.1.99', model: 'claude-opus-9-1' })
  assert.equal(tooOld('API Error: 400 invalid model'), undefined)
  assert.deepEqual([older('2.1.99', '2.1.280'), older('2.1.280', '2.1.280'), older('2.2.0', '2.1.999')], [true, false, false])

  const rig = await fresh(t, { env: { LAKI_MODELS_RETRY_MS: '1000' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', model: 'claude-opus-9-1' })
  const tab = await until(async () => (x => x?.last === 'answer: hi' && x)(await rig.tab(ws.id)), 'its first turn')
  await rig.rpc('hook', { tab: tab.id, state: 'failed', payload: { last_assistant_message: 'API Error: 400', error: '{"error_code":"claude_code_version_too_old","message":"requires Claude Code 2.1.280 or newer"}' } })
  const tv = await rig.tab(ws.id)
  assert.equal(tv.last, "This Claude Code can't run claude-opus-9-1: it needs 2.1.280 or newer. Update it (claude update), or pick another model.")
  let v = await until(async () => (x => x.claudeHas && x)(await rig.rpc('state')), 'its version known')
  assert.deepEqual([v.modelNeeds, v.claudeHas], [{ 'claude-opus-9-1': '2.1.280' }, '2.1.200']) // the fake's
  // updated: it goes once the version is looked at again
  writeFileSync(join(rig.home, 'claude-version'), '2.1.300')
  await sleep(1100)
  await rig.rpc('agentModels', { agent: 'claude' })
  v = await until(async () => (x => !x.modelNeeds && x)(await rig.rpc('state')), 'dropped after the update')
  assert.equal(v.claudeHas, undefined) // the view says it only with a model to warn about
  // Update Claude Code: a terminal typing claude's update; not an agent's to do
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'claude', from: { tab: tab.id } }), /update Claude Code/)
  await assert.rejects(rig.rpc('agentUpdate', { agent: 'codex' }), /only Claude Code/)
  const up = await rig.rpc('agentUpdate', { agent: 'claude' })
  assert.equal(up.name, 'update Claude Code')
  await until(async () => (await rig.screen((await rig.tab(up.id, 'shell'))?.id ?? (await rig.rpc('state')).tabs.find((t: any) => t.workspace === up.id).id)).includes('claude update'), 'typed')
})
