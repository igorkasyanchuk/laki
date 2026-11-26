// An agent failing the same command, end to end (core.ts loopCount): claude's hooks as they come, one mark on its tab,
// one Needs you entry, told once a spell; Let it work clears it for the turn, the turn's end for good
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsTab } from '../src/shared/nextStep.ts'
import { connect, fresh, sleep, until } from './helpers.ts'

test('loop: a claude tab failing the same command gets one mark and one Needs you entry', async t => {
  const rig = await fresh(t)
  const app = await connect(rig)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(() => rig.tab(ws.id), 'its tab')
  const hook = (event: string, extra: object = {}, state = 'running') => rig.rpc('hook', { tab: tab.id, state, payload: { hook_event_name: event, ...extra } })
  const failed = () => hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'cd /x && npm  test' }, error: 'Exit code 1\n2 failing' })
  const loop = async () => (await sleep(50), (await rig.tab(ws.id)).loop)
  await hook('UserPromptSubmit', { prompt: 'fix the tests' })
  await failed()
  await hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } }) // another tool between: still in a row
  await failed()
  assert.equal(await loop(), undefined, 'two: not yet')
  await failed()
  await until(async () => (await rig.tab(ws.id)).loop?.n === 3, 'the loop mark')
  await failed()
  await until(async () => (await rig.tab(ws.id)).loop?.n === 4, 'its count kept up')
  const v = await rig.rpc('state')
  assert.equal(v.tabs.filter((x: any) => x.loop).length, 1)
  assert.deepEqual(v.tabs.filter(needsTab).map((x: any) => x.id), [tab.id], 'one Needs you entry')
  assert.equal(v.tabs.find((x: any) => x.id === tab.id).loop.cmd, 'npm test')
  assert.equal(app.events.filter(e => e.ev === 'loop').length, 1, 'told once')
  // Let it work: none again this turn
  await rig.rpc('failDismiss', { tab: tab.id })
  await failed()
  assert.equal(await loop(), undefined, 'let it work')
  // a new turn counts anew; the command working again clears it
  await hook('Stop', {}, 'idle')
  await hook('UserPromptSubmit', { prompt: 'again' })
  for (let i = 0; i < 3; i++) await failed()
  await until(async () => (await rig.tab(ws.id)).loop?.n === 3, 'a new spell')
  await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } })
  assert.equal(await loop(), undefined, 'it works now')
  assert.equal(app.events.filter(e => e.ev === 'loop').length, 2)
})
