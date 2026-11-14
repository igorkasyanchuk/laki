// ACP tabs (Labs, daemon/acp.ts): a profile that speaks the Agent Client Protocol on its stdio, with a fake agent
// (test/fakes/acp-agent): its words in the Reader, its permission an ask answered the usual way, one turn end, Stop
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

const FAKE = join(import.meta.dirname, 'fakes', 'acp-agent')

test('ACP tab: the Reader shows its words, its permission is an ask answered back to it, its turn ends once, Stop is session/cancel', async t => {
  const rig = await fresh(t)
  const log = join(rig.data, 'acp.log')
  const got = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('presetSave', { name: 'fake-acp', add: true, set: { agent: 'command', cmd: `node ${FAKE}`, acp: true, env: { FAKE_ACP_LOG: log } } })
  const watcher = await connect(rig)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'fake-acp', prompt: 'add tests' })
  const tab = await rig.tab(ws.id)
  assert.equal(tab.preset, 'acp')

  // initialize (no client capabilities), a session in the worktree, the prompt; then its permission: an ask
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'its permission ask')
  const [init, made, prompt] = got()
  assert.deepEqual([init.method, init.params.protocolVersion, init.params.clientCapabilities], ['initialize', 1, { fs: { readTextFile: false, writeTextFile: false }, terminal: false }])
  assert.deepEqual([made.method, made.params.cwd, made.params.mcpServers], ['session/new', ws.path, []])
  assert.deepEqual([prompt.method, prompt.params], ['session/prompt', { sessionId: 'sess-acp-1', prompt: [{ type: 'text', text: 'add tests' }] }])
  let chat = await rig.rpc('chatRead', { tab: tab.id })
  assert.deepEqual(chat.said.map((s: any) => [s.who, s.text]), [['you', 'add tests'], ['agent', 'answer: add tests'], ['tool', 'npm test']])
  assert.equal((await rig.rpc('chatRead', { tab: tab.id, v: chat.v })).said, undefined, 'the same v: nothing new')
  const screen = await rig.rpc('screen', { target: tab.id })
  assert.match(screen, /❯ 1\. Allow once\n {2}2\. Reject/)

  // answered as any ask: its option goes back to the agent, which ends the turn
  assert.deepEqual(await rig.rpc('answer', { tab: tab.id, n: 1 }), { picked: 'Allow once' })
  await until(() => got().some(m => m.result?.outcome?.optionId === 'allow-once'), 'the pick reaches it')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'its turn ends')
  chat = await rig.rpc('chatRead', { tab: tab.id })
  assert.equal(chat.said.at(-1).text, ' (picked allow-once)')
  assert.equal((await rig.tab(ws.id)).last, 'answer: add tests\n\n (picked allow-once)')
  await new Promise(r => setTimeout(r, 300))
  assert.equal(watcher.events.filter((e: any) => e.ev === 'turn' && e.kind === 'done' && e.tab === tab.id).length, 1, 'one turn end')

  // a turn it works on until Stop: session/cancel, then no turn end
  await rig.rpc('send', { target: tab.id, text: 'wait for me' })
  await until(async () => (await rig.tab(ws.id)).status === 'running' && got().some(m => m.params?.prompt?.[0]?.text === 'wait for me'), 'the second prompt')
  await rig.rpc('input', { tab: tab.id, data: '\x1b' })
  await until(() => got().some(m => m.method === 'session/cancel' && m.params.sessionId === 'sess-acp-1'), 'session/cancel')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'stopped')
  assert.equal(watcher.events.filter((e: any) => e.ev === 'turn' && e.kind === 'done' && e.tab === tab.id).length, 1, 'a stopped turn is no turn end')
})
