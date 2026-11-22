// A1: a tab's /goal: read from claude's and codex's transcripts (share.ts goalIn), the tab held running across its turns
// while the goal works (core's goalHold), its end told as the goal's (Goal reached…)
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { meterNew, meterOf } from '../src/daemon/share.ts'
import { connect, fresh, seen, until, sleep } from './helpers.ts'

const line = (o: object) => `${JSON.stringify(o)}\n`
const stamp = () => new Date().toISOString()
const goal = (o: object) => line({ type: 'attachment', timestamp: stamp(), attachment: { type: 'goal_status', ...o } })

test("A1: a goal's state from the transcript: claude's goal_status, codex's thread_goal_updated", () => {
  const c = (s: string) => meterOf('claude', s, meterNew()).goal
  assert.deepEqual((({ text, state }) => ({ text, state }))(c(goal({ met: false, sentinel: true, condition: 'every e2e test passes' }))!), { text: 'every e2e test passes', state: 'working' })
  assert.equal(c(goal({ met: false, sentinel: true, condition: 'x' }) + goal({ met: false, condition: 'x', reason: 'not yet' }))?.state, 'working')
  assert.equal(c(goal({ met: false, sentinel: true, condition: 'x' }) + goal({ met: true, condition: 'x', iterations: 3 }))?.state, 'reached')
  assert.equal(c(goal({ met: false, failed: true, condition: 'x' }))?.state, 'failed')
  assert.equal(c(goal({ met: false, sentinel: true, condition: 'x' }) + goal({ met: true, sentinel: true, condition: 'x' })), undefined, 'cleared')
  assert.equal(c(line({ type: 'attachment', isSidechain: true, attachment: { type: 'goal_status', met: false, condition: 'a subagent’s' } })), undefined)
  const x = (s: string) => meterOf('codex', s, meterNew()).goal
  const ev = (p: object) => line({ type: 'event_msg', timestamp: stamp(), payload: { type: 'thread_goal_updated', ...p } })
  assert.deepEqual((({ text, state }) => ({ text, state }))(x(ev({ goal: { objective: 'ship checkout', status: 'active' } }))!), { text: 'ship checkout', state: 'working' })
  assert.equal(x(ev({ goal: { objective: 'g', status: 'paused' } }))?.state, 'paused')
  assert.equal(x(ev({ goal: { objective: 'g', status: 'budget_limited' } }))?.state, 'budget')
  assert.equal(x(ev({ goal: { objective: 'g', status: 'budgetLimited' } }))?.state, 'budget')
  assert.equal(x(ev({ goal: { objective: 'g', status: 'complete' } }))?.state, 'reached')
  assert.equal(x(ev({ goal: { objective: 'g', status: 'active' } }) + ev({ goal: null })), undefined, 'cleared')
})

test('A1: while its goal works a tab stays running across turn ends, nothing told; the goal reached: one end, Goal reached', async t => {
  const rig = await fresh(t, { env: { LAKI_METER_MS: '200', LAKI_GOAL_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const app = await connect(rig)
  t.after(() => app.close())
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => (x => x?.resumeId && x)(await rig.tab(ws.id)), 'its chat')
  const dir = join(rig.home, '.claude/projects/-tmp-repo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-g.jsonl')
  writeFileSync(file, goal({ met: false, sentinel: true, condition: 'Make every e2e test in checkout/ pass without retries' }))
  await rig.rpc('hook', { tab: tab.id, state: 'start', payload: { session_id: 'chat-g' } })
  await until(async () => (await rig.tab(ws.id))?.goal?.state === 'working', 'the goal in the view')

  // a turn ends while the goal works: held, running, no turn event
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: '/goal Make every e2e test pass' } })
  appendFileSync(file, goal({ met: false, condition: 'Make every e2e test in checkout/ pass without retries', reason: '2 still flaky' }))
  await rig.rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'fixed one' } })
  await sleep(600)
  assert.equal((await rig.tab(ws.id)).status, 'running')
  assert.ok(!app.events.some((e: any) => e.ev === 'turn' && e.tab === tab.id && e.kind === 'done'), 'no done yet')

  // reached: the held end told once, as the goal's
  appendFileSync(file, goal({ met: true, condition: 'Make every e2e test in checkout/ pass without retries', iterations: 2 }))
  const done = await seen(app, (e: any) => e.ev === 'turn' && e.tab === tab.id && e.kind === 'done', 'its end')
  assert.equal(done.text, 'Goal reached: Make every e2e test in checkout/ pass without retries')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle')
  assert.equal((await rig.tab(ws.id)).goal.state, 'reached')
  // the next prompt of yours: the reached goal leaves the banner
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'thanks' } })
  await until(async () => !(await rig.tab(ws.id)).goal, 'gone')
})
