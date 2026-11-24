// GitHub Copilot CLI's ready-made profile (shared/install.ts COPILOT: copilot --acp, on daemon/acp.ts), with the fake
// in test/fakes/copilot: a fresh install has it, a prompt, an ask answered as Needs you answers it, a finished turn,
// its chat resumed (session/load) after a daemon restart
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

test('Copilot: a fresh install has its profile; a prompt, an ask answered, a finished turn, the chat resumed after a restart', async t => {
  const rig = await fresh(t)
  const log = join(rig.data, 'acp.log')
  const got = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])
  assert.deepEqual((await rig.rpc('state')).presets.find((x: any) => x.name === 'copilot'), { name: 'copilot', agent: 'command', cmd: 'copilot --acp', acp: true }, 'copilot on PATH: its profile')
  await rig.rpc('presetSave', { name: 'copilot', set: { env: { FAKE_ACP_LOG: log } } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const app = await connect(rig)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'copilot', prompt: 'add tests' })
  const tab = await rig.tab(ws.id)
  assert.equal(tab.preset, 'acp')
  // its prompt, its answer, one finished turn
  await until(() => app.events.some(e => e.ev === 'turn' && e.kind === 'done' && e.tab === tab.id), 'its turn ends')
  const said = async (): Promise<[string, string][]> => (await rig.rpc('chatRead', { tab: tab.id })).said.map((s: any) => [s.who, s.text])
  assert.deepEqual(await said(), [['you', 'add tests'], ['agent', 'copilot: add tests']])
  const made = got().find(m => m.method === 'session/new')
  assert.equal(made.params.cwd, ws.path)
  // an ask (a shell command), answered as Needs you's button does: back to it, the turn ends with it
  await rig.rpc('send', { target: tab.id, text: 'perm run the tests' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'its ask')
  assert.equal((await rig.tab(ws.id)).ask?.options[0].label, 'Allow once')
  assert.deepEqual(await rig.rpc('answer', { tab: tab.id, n: 1 }), { picked: 'Allow once' })
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'answered')
  await until(async () => (await said()).at(-1)?.[1] === 'copilot: perm run the tests (picked allow-once)', 'its answer')
  // a restart: the same chat loaded again (session/load of its id), its words back in the Reader
  const id = (await rig.tab(ws.id)).resumeId
  assert.match(id, /^cop-/, 'its session id kept')
  await rig.stop()
  await rig.start()
  await until(() => got().some(m => m.method === 'session/load'), 'session/load')
  const load = got().find(m => m.method === 'session/load')
  assert.equal(load.params.sessionId, id)
  await until(async () => (await said()).some(([, s]) => s === 'copilot: add tests'), 'its chat back')
})
