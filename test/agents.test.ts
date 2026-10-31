// Each agent in the daemon: claude's hooks, codex's notify, grok's quiet screen, gemini's hooks, opencode's plugin.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, until } from './helpers.ts'

test('hooks drive status; queue delivered on Stop; done until viewed', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first task' })
  const tab = await rig.tab(ws.id)
  const watcher = await connect(rig)
  // the prompt runs a turn: running → idle (Stop), with its last answer, and ● since nobody looks
  await until(async () => (await rig.tab(ws.id)).last === 'answer: first task', 'Stop hook')
  let tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.equal(tv.done, true)
  assert.match(tv.resumeId, /^sess-/)
  assert.ok(watcher.events.some(e => e.ev === 'turn' && e.kind === 'done' && e.tab === tab.id))
  // viewing it clears ●
  await watcher.call('view', { tab: tab.id, focused: true })
  await until(async () => !(await rig.tab(ws.id)).done, 'done cleared')
  await watcher.call('view', { tab: null, focused: true })
  // waiting (permission prompt)
  await rig.rpc('send', { target: ws.id, text: 'ask me' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting')
  assert.ok(watcher.events.some(e => e.ev === 'turn' && e.kind === 'waiting'))
  // queue: sent when the agent is busy waits for the next Stop
  writeFileSync(join(rig.home, 'x'), '')
  const q1 = await rig.rpc('send', { target: ws.id, text: 'second', whenIdle: true })
  assert.equal(q1.queued, 1)
  const q2 = await rig.cli('send', `${ws.id}/claude`, '--when-idle', 'third')
  assert.match(q2.out, /queued \(2 waiting\)/)
  tv = await rig.tab(ws.id)
  assert.deepEqual(tv.queue, ['second', 'third'])
  // answer the prompt: a turn ends → "second" goes in, its Stop → "third"
  await rig.rpc('send', { target: ws.id, text: 'y' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: third', 'queue drained', 15000)
  tv = await rig.tab(ws.id)
  assert.equal(tv.queue, undefined)
  const s = await rig.screen(tab.id)
  assert.ok(s.indexOf('answer: second') < s.indexOf('answer: third'))
  // idle and empty queue: --when-idle sends right away
  const now = await rig.rpc('send', { target: ws.id, text: 'fourth', whenIdle: true })
  assert.equal(now.sent, true)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: fourth', 'fourth answered')
  // enter: false types into the prompt and leaves it there (the preview's picked element); an escape in the text
  // (one that would end the paste) is dropped
  await rig.rpc('send', { target: ws.id, text: 'the button main > a.cta \x1b[201~x\x03\x04', enter: false })
  await until(async () => (await rig.screen(tab.id)).includes('the button main > a.cta x'), 'in the prompt')
  await new Promise(r => setTimeout(r, 600))
  tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.equal(tv.last, 'answer: fourth') // no Enter, no turn
  watcher.close()
})

test("claude's Stop while its background subagents work: still running, no ●, no done notice, until its real Stop", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'first task' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.tab(ws.id)).last === 'answer: first task', 'its first turn')
  const watcher = await connect(rig)
  await watcher.call('view', { tab: tab.id, focused: true }) // its first turn's ● seen
  await until(async () => !(await rig.tab(ws.id)).done, 'seen')
  await watcher.call('view', { tab: null, focused: true })
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'review it' } })
  const bg = [{ type: 'subagent', status: 'running' }, { type: 'shell', status: 'running' }]
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Started 2 reviewers.', background_tasks: bg } })
  await new Promise(r => setTimeout(r, 300))
  let tv = await rig.tab(ws.id)
  assert.deepEqual([tv.status, tv.done, tv.last], ['running', false, 'answer: first task'])
  assert.ok(!watcher.events.some(e => e.ev === 'turn' && e.kind === 'done'))
  // a background shell alone (a dev server) doesn't hold it: done
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'reviewer reports' } })
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'All reviewed.', background_tasks: [{ type: 'shell', status: 'running' }, { type: 'subagent', status: 'completed' }] } })
  tv = await until(async () => (x => x.status === 'idle' && x)(await rig.tab(ws.id)), 'its real Stop')
  assert.deepEqual([tv.done, tv.last], [true, 'All reviewed.'])
  assert.ok(watcher.events.some(e => e.ev === 'turn' && e.kind === 'done' && e.text === 'All reviewed.'))
  watcher.close()
})

test('codex: notify ends a turn and records the thread id', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'codex' })
  const tab = await rig.tab(ws.id)
  await until(async () => (await rig.screen(tab.id)).includes('fake codex'), 'codex up')
  const run = rig.fakeLog().find(l => l.bin === 'codex')
  assert.ok(run.args.some((a: string) => a.startsWith('notify=[')), 'notify passed with -c')
  await rig.rpc('send', { target: ws.id, text: 'hello codex' })
  await until(async () => (await rig.tab(ws.id)).last === 'answer: hello codex', 'notify hook')
  const tv = await rig.tab(ws.id)
  assert.equal(tv.status, 'idle')
  assert.match(tv.resumeId, /^thread-/)
})

test('grok: Laki picks its chat id, a quiet screen ends its turn, a restart resumes the chat', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  assert.ok((await rig.rpc('state')).presets.some((x: any) => x.name === 'grok'), 'an agent on PATH is a default preset')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'grok', prompt: 'hello grok' })
  const tab = await rig.tab(ws.id)
  assert.equal(tab.status, 'running')
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'grok'), 'grok up')
  assert.equal(run.args[0], '--session-id')
  assert.equal(run.args[1], tab.resumeId)
  assert.match(tab.resumeId, /^[0-9a-f-]{36}$/)
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle once its screen is quiet', 10000)
  // its title says when it asks, and when it's answered
  await rig.rpc('input', { tab: tab.id, data: 'ask to edit\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting: Action Required in its title', 6000)
  await rig.rpc('input', { tab: tab.id, data: 'y\r' })
  await until(async () => (await rig.tab(ws.id)).status !== 'waiting', 'answered', 6000)
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'grok').length === 2, 'grok restarted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'grok')[1].args, ['--resume', tab.resumeId])
})

test('gemini: its hooks (from Laki\'s system settings) give the session and the answer; a restart resumes it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'gemini', prompt: 'hello gemini' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'gemini'), 'gemini up')
  assert.deepEqual(run.args, ['-i', 'hello gemini']) // interactive: a bare prompt would answer and exit
  await until(async () => (await rig.tab(ws.id)).last === 'answer: hello gemini', 'AfterAgent hook')
  const tab = await rig.tab(ws.id)
  assert.equal(tab.status, 'idle')
  assert.match(tab.resumeId, /^gem-/)
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'gemini').length === 2, 'gemini restarted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'gemini')[1].args, ['--resume', tab.resumeId])
})

test('opencode: Laki\'s plugin reports its session and turns (not a subagent\'s), a restart resumes the session', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'opencode', prompt: 'hello opencode' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'opencode'), 'opencode up')
  assert.deepEqual(run.args, ['--prompt', 'hello opencode'])
  const id = (await until(async () => (await rig.tab(ws.id)).resumeId, 'session id from the plugin')) as string
  assert.match(id, /^ses_/)
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle from the plugin')
  const tab = await rig.tab(ws.id)
  assert.equal(tab.last, 'answer: hello opencode') // read from its session by the plugin
  // an error, then the idle after it: one end of turn, so the limit it set stays
  await rig.rpc('input', { tab: tab.id, data: 'hit the limit\r' })
  const hit = await until(async () => (await rig.tab(ws.id)).limit && (await rig.tab(ws.id)), 'limit from the error')
  await new Promise(r => setTimeout(r, 1500))
  assert.equal((await rig.tab(ws.id)).limit, hit.limit, 'the idle after the error keeps the limit')
  await rig.rpc('input', { tab: tab.id, data: 'ask first\r' })
  await until(async () => (await rig.tab(ws.id)).status === 'waiting', 'waiting on a permission')
  await rig.stop()
  await rig.start()
  await until(() => rig.fakeLog().filter(l => l.bin === 'opencode').length === 2, 'opencode restarted')
  assert.deepEqual(rig.fakeLog().filter(l => l.bin === 'opencode')[1].args, ['--session', id])
})

test("opencode's model: in its inline config, not -m (some TUIs refuse it), over a profile's own config", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('wsNew', { project: p.id, name: 'glm', preset: 'opencode', model: 'openrouter/z-ai/glm-5.3', prompt: 'hi' })
  const run = await until(() => rig.fakeLog().find(l => l.bin === 'opencode'), 'opencode up')
  assert.deepEqual([run.args, JSON.parse(run.config)], [['--prompt', 'hi'], { model: 'openrouter/z-ai/glm-5.3' }])
  await rig.rpc('settingsSet', { presets: [{ name: 'kimi', agent: 'opencode', model: 'openrouter/moonshotai/kimi-k3', env: { OPENCODE_CONFIG_CONTENT: '{"theme":"x","model":"old"}' } }] })
  await rig.rpc('wsNew', { project: p.id, name: 'kimi', preset: 'kimi', prompt: 'hi' })
  const two = await until(() => rig.fakeLog().filter(l => l.bin === 'opencode')[1], 'the profile one')
  assert.deepEqual(JSON.parse(two.config), { theme: 'x', model: 'openrouter/moonshotai/kimi-k3' })
})
