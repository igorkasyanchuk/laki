// The agent's plan, live (shared/todos.ts): claude's to-do tools as its hooks report them, codex's update_plan from its
// transcript, on the tab's view; a plan it asks you to approve; all done: gone as the turn ends; off: none.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planCount, planDone, planFrom, planNow } from '../src/shared/todos.ts'
import { meterNew, meterOf } from '../src/daemon/share.ts'
import { fresh, until } from './helpers.ts'

test('planFrom: TodoWrite and update_plan whole, TaskCreate and TaskUpdate a task at a time, a stale list started over', () => {
  let p = planFrom(undefined, { tool: 'TodoWrite', post: false, input: { todos: [{ content: 'Read', status: 'completed' }, { content: 'Fix', status: 'in_progress' }, { content: 'Test', status: 'pending' }] } })!
  assert.equal(planCount(p), '1/3')
  assert.equal(planNow(p), 'Fix')
  assert.equal(planFrom(p, { tool: 'TodoWrite', post: true, input: {} }), undefined) // its after: nothing new
  assert.equal(planFrom(p, { tool: 'Bash', post: false, input: { command: 'ls' } }), undefined)
  p = planFrom(undefined, { tool: 'update_plan', post: false, input: { plan: [{ step: 'A', status: 'completed' }, { step: 'B', status: 'completed' }] } })!
  assert.ok(planDone(p))
  p = planFrom(undefined, { tool: 'TaskCreate', post: true, input: { subject: 'One' }, result: { task: { id: '1' } } })!
  p = planFrom(p, { tool: 'TaskCreate', post: true, input: { subject: 'Two' }, result: 'Task #2 created successfully' })!
  p = planFrom(p, { tool: 'TaskUpdate', post: false, input: { taskId: '1', status: 'in_progress' } })!
  assert.deepEqual(p.items, [{ id: '1', text: 'One', state: 'now' }, { id: '2', text: 'Two', state: 'todo' }])
  assert.equal(planFrom(p, { tool: 'TaskUpdate', post: false, input: { taskId: '9', status: 'completed' } }), undefined) // not one of its
  assert.deepEqual(planFrom(p, { tool: 'TaskUpdate', post: false, input: { taskId: '2', status: 'deleted' } })!.items.map(t => t.text), ['One'])
  const fresh = planFrom({ ...p, stale: true }, { tool: 'TaskCreate', post: true, input: { subject: 'Three' }, result: { id: 3 } })!
  assert.deepEqual(fresh.items, [{ id: '3', text: 'Three', state: 'todo' }])
})

test("codex's update_plan from its transcript; a new ask marks it stale", () => {
  const line = (o: object) => JSON.stringify({ timestamp: new Date().toISOString(), ...o })
  const m = meterOf('codex', [line({ type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Look', status: 'in_progress' }, { step: 'Change', status: 'pending' }] }) } })].join('\n'), meterNew())
  assert.equal(m.plan && planCount(m.plan), '0/2')
  meterOf('codex', line({ type: 'event_msg', payload: { type: 'user_message', message: 'and more' } }), m)
  assert.equal(m.plan?.stale, true)
})

test("an agent's to-do list on its tab, gone once all done; a plan to approve while it waits; off: none", async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '600' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'todo Read;Fix;Test' })
  const tab = async () => (await rig.rpc('state')).tabs.find((x: { workspace: string; kind: string }) => x.workspace === ws.id && x.kind === 'agent')
  const plan = await until(async () => (await tab())?.plan, 'its list')
  assert.deepEqual(plan.items.map((i: { text: string; state: string }) => [i.text, i.state]), [['Read', 'now'], ['Fix', 'todo'], ['Test', 'todo']])
  await until(async () => (await tab()).status === 'idle', 'its turn ends')
  assert.ok((await tab()).plan, 'not done: it stays')
  const id = (await tab()).id
  await rig.rpc('send', { target: id, text: 'todo! Read;Fix;Test' })
  await until(async () => (await tab()).status === 'idle' && !(await tab()).plan, 'all done: gone as the turn ends')
  await rig.rpc('send', { target: id, text: 'planmode' })
  assert.match(await until(async () => (await tab()).planAsk, 'the plan to approve'), /Fix the total/)
  await rig.rpc('answer', { tab: id, n: 1 })
  await until(async () => !(await tab()).planAsk, 'answered: no card')
  await rig.rpc('settingsSet', { livePlan: false })
  await rig.rpc('send', { target: id, text: 'todo One;Two' })
  await until(async () => (await tab()).status === 'running', 'its turn')
  await new Promise(r => setTimeout(r, 300))
  assert.equal((await tab()).plan, undefined)
})
