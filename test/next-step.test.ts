// One next step (shared/nextStep.ts): the one thing a workspace needs from you, in order: an ask, its plan, a check over
// to you, a closed PR, conflicts, CI, a review, the radar, merge, look, ship; busy while an agent or CI works.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextStep } from '../src/shared/nextStep.ts'
import type { TabView, WorkspaceView } from '../src/shared/types.ts'

const ws = (o: object = {}) => ({ id: 'w', kind: 'worktree', ...o }) as unknown as WorkspaceView
const tab = (o: object) => ({ id: 't', workspace: 'w', name: 'claude', kind: 'agent', status: 'idle', done: false, ...o }) as unknown as TabView
const pr = (o: object = {}) => ({ number: 7, state: 'OPEN', url: 'u', checks: 'pass', ...o })
const id = (w: WorkspaceView, tabs: TabView[] = [], o = {}) => nextStep(w, tabs, { merge: true, ...o })?.id

test('nextStep: what waits for you comes first, then what broke, then what moves it on', () => {
  assert.equal(id(ws({ pr: pr({ checks: 'fail' }) }), [tab({ status: 'waiting', ask: { options: [{ n: 1, label: 'Yes' }], at: 1 } })]), 'answer')
  assert.equal(id(ws(), [tab({ status: 'waiting', planAsk: '1. a' })]), 'plan')
  const working = nextStep(ws(), [tab({ status: 'running', plan: { items: [{ text: 'Fix the total', state: 'now' }] } })])!
  assert.deepEqual([working.id, working.label, working.busy], ['working', 'Fix the total', true])
  assert.equal(id(ws({ check: { status: 'over', tries: 3, steps: [{ name: 'test', state: 'fail' }] } })), 'check')
  assert.equal(id(ws({ pr: pr({ state: 'MERGED' }) })), 'archive')
  assert.equal(id(ws({ pr: pr({ conflict: true, checks: 'fail' }) })), 'conflict')
  assert.equal(id(ws({ pr: pr({ checks: 'fail' }) })), 'ci')
  assert.equal(id(ws({ pr: pr({ review: 'CHANGES_REQUESTED' }) })), 'review')
  assert.equal(id(ws({ pr: pr() }), [], { overlaps: 1 }), 'collide')
  assert.equal(id(ws({ pr: pr({ checks: 'pending' }) })), 'wait')
  assert.equal(id(ws({ pr: pr() })), 'merge')
  assert.equal(id(ws({ pr: pr() }), [], { merge: false }), 'wait') // the project doesn't let the app merge
  assert.equal(id(ws({ pr: pr({ review: 'REVIEW_REQUIRED' }) })), 'wait')
  assert.equal(id(ws({ stat: { add: 3, del: 0, files: 1, dirty: 1 } }), [tab({ done: true })]), 'look')
  assert.equal(id(ws({ stat: { add: 3, del: 0, files: 1, dirty: 1 } }), [tab({})]), 'ship')
  assert.equal(id(ws({ kind: 'local', stat: { add: 3, del: 0, files: 1, dirty: 1 } })), undefined) // no ship from a folder
  assert.equal(id(ws({ stat: { add: 0, del: 0, files: 0, dirty: 0 } })), undefined)
  assert.equal(id(ws({ archived: true, pr: pr({ checks: 'fail' }) })), undefined)
})
