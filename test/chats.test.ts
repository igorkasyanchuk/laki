import assert from 'node:assert/strict'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('Import chats: Claude Code and Codex sessions run in the project outside Laki, each a tab that resumes it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const dir = realpathSync(rig.repo)
  // claude's: its folder's name every other character a dash; the first prompt you typed (not a command's noise)
  const cd = join(rig.home, '.claude', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(cd, { recursive: true })
  const line = (o: object) => JSON.stringify(o) + '\n'
  writeFileSync(join(cd, 'c1aude-0001.jsonl'), line({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } }) + line({ type: 'user', message: { role: 'user', content: 'fix the flaky login test' }, cwd: dir }))
  writeFileSync(join(cd, 'empty-0002.jsonl'), '') // nothing said: not listed
  // codex's: its first line names the folder; another repo's left out
  const sd = join(rig.home, '.codex', 'sessions', '2026', '11', '02')
  mkdirSync(sd, { recursive: true })
  writeFileSync(join(sd, 'rollout-2026-11-02T10-00-00-c0dex-0003.jsonl'), line({ type: 'session_meta', payload: { id: 'c0dex-0003', cwd: dir } }) + line({ type: 'event_msg', payload: { type: 'user_message', message: 'add a dark mode' } }))
  writeFileSync(join(sd, 'rollout-2026-11-02T11-00-00-other-0004.jsonl'), line({ type: 'session_meta', payload: { id: 'other-0004', cwd: '/elsewhere' } }) + line({ type: 'event_msg', payload: { type: 'user_message', message: 'not ours' } }))
  const list = await rig.rpc('chatList', { project: p.id })
  assert.deepEqual(list.map((c: any) => [c.agent, c.id, c.title]).sort(), [['claude', 'c1aude-0001', 'fix the flaky login test'], ['codex', 'c0dex-0003', 'add a dark mode']])
  await assert.rejects(rig.rpc('chatImport', { project: p.id, ids: ['other-0004'] }), /none of those chats/)
  const tabs = await rig.rpc('chatImport', { project: p.id, ids: ['c1aude-0001', 'c0dex-0003'] })
  assert.equal(tabs.length, 2)
  const v = await rig.rpc('state')
  const ws = v.workspaces.find((w: any) => w.id === tabs[0].workspace)
  assert.equal(realpathSync(ws.path), dir, "the project's own folder")
  assert.deepEqual(v.tabs.filter((x: any) => tabs.some((y: any) => y.id === x.id)).map((x: any) => x.name).sort(), ['claude: fix the flaky login test', 'codex: add a dark mode'])
  await until(() => rig.fakeLog().some((l: any) => JSON.stringify(l).includes('c1aude-0001')), 'claude resumed')
  assert.deepEqual(await rig.rpc('chatList', { project: p.id }), [], 'in Laki now: listed no more')
})

test("Side chat: a Claude Code tab's chat forked once, then that fork goes on; its own chat untouched", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'fix the cart total' })
  const tab = await until(async () => (x => x?.resumeId && x)((await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id && x.kind === 'agent')), 'its chat id')
  await assert.rejects(rig.rpc('sideAsk', { tab: tab.id, text: ' ' }), /what do you want to ask/)
  const a = await rig.rpc('sideAsk', { tab: tab.id, text: 'side: why a new hook?' })
  assert.equal(a.text.split(' in ')[0], `Answer from fork-of-${tab.resumeId}`)
  assert.equal(realpathSync(a.text.split(' in ')[1]), realpathSync(ws.path), 'in its workspace')
  const b = await rig.rpc('sideAsk', { tab: tab.id, text: 'side: and the test?' })
  assert.equal(b.text.split(' in ')[0], `Answer from fork-of-${tab.resumeId}`, 'the fork again, not a new one')
  const s = await rig.rpc('sideState', { tab: tab.id })
  assert.deepEqual(s.said.map((x: any) => x.who), ['you', 'agent', 'you', 'agent'])
  assert.equal(s.forks, true)
  const calls = rig.fakeLog().filter((l: any) => l.bin === 'claude' && l.args[0] === '-p')
  assert.equal(calls.filter((l: any) => l.args.includes('--fork-session')).length, 1)
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === tab.id).resumeId, tab.resumeId, 'the main chat stays its own')
  assert.deepEqual(await rig.rpc('sideNew', { tab: tab.id }), { said: [] })
})
