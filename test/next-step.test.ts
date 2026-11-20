// One next step (shared/nextStep.ts): the one thing a workspace needs from you, in order: an ask, its plan, a check over
// to you, a closed PR, conflicts, CI, a review, the radar, merge, look, ship; busy while an agent or CI works.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextStep, boardCol, needsTab, overUsual, reviewQueue, usual, usualText, waitsElsewhere } from '../src/shared/nextStep.ts'
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
  assert.equal(id(ws({ pr: pr({ checks: 'pending' }) })), 'wait')
  assert.equal(id(ws({ pr: pr({ checks: 'cancelled' }) })), 'wait') // never Merge: they didn't pass
  assert.equal(id(ws({ pr: pr() })), 'merge')
  assert.equal(id(ws({ pr: pr() }), [], { merge: false }), 'wait') // the project doesn't let the app merge
  assert.equal(id(ws({ pr: pr({ review: 'REVIEW_REQUIRED' }) })), 'wait')
  assert.equal(id(ws({ stat: { add: 3, del: 0, files: 1, dirty: 1 } }), [tab({ done: true })]), 'look')
  assert.equal(id(ws({ stat: { add: 3, del: 0, files: 1, dirty: 1 } }), [tab({})]), 'ship')
  assert.equal(id(ws({ kind: 'local', stat: { add: 3, del: 0, files: 1, dirty: 1 } })), undefined) // no ship from a folder
  assert.equal(id(ws({ stat: { add: 0, del: 0, files: 0, dirty: 0 } })), undefined)
  assert.equal(id(ws({ archived: true, pr: pr({ checks: 'fail' }) })), undefined)
})

test('One next step: Continue for a turn that ended on an API error, after an ask and what works', () => {
  const failed = { id: 't', workspace: 'w', kind: 'agent', status: 'idle', name: 'claude', failed: 'API Error: 500' } as unknown as TabView
  assert.equal(id({ id: 'w', kind: 'worktree' } as WorkspaceView, [failed]), 'continue')
  assert.equal(id({ id: 'w', kind: 'worktree' } as WorkspaceView, [failed, { ...failed, id: 'u', failed: undefined, status: 'waiting' } as TabView]), 'answer')
})

test("U5: the Board's columns follow the next step, and hold what the sidebar's Needs you counts", () => {
  const col = (w: WorkspaceView, tabs: TabView[] = []) => boardCol(w, tabs, { merge: true })
  assert.equal(col(ws({ pr: pr({ checks: 'fail' }) })), 'fix')
  assert.equal(col(ws({ pr: pr({ conflict: true }) })), 'fix')
  assert.equal(col(ws(), [tab({ status: 'waiting', ask: { options: [] } })]), 'answer')
  assert.equal(col(ws({ pr: pr() }), [tab({ status: 'waiting' })]), 'answer') // an ask first, whatever its PR
  assert.equal(col(ws(), [tab({ status: 'running' })]), 'working')
  assert.equal(col(ws({ setup: true })), 'working')
  assert.equal(col(ws(), [tab({ done: true })]), 'review')
  assert.equal(col(ws({ pr: pr() })), 'merge')
  assert.equal(col(ws({ pr: pr({ checks: 'pending' }) })), 'merge')
  assert.equal(col(ws({ pr: pr({ state: 'MERGED' }) })), 'done')
  assert.equal(col(ws()), 'done')
  // every workspace the sidebar counts is in Answer, Review or Fix: never in Working, Merge or Done
  const cases: [WorkspaceView, TabView[]][] = [
    [ws(), [tab({ status: 'waiting' })]],
    [ws(), [tab({ failed: 'API error' }), tab({ id: 'u', status: 'running' })]],
    [ws(), [tab({ done: true }), tab({ id: 'u', status: 'running' })]],
    [ws({ pr: pr() }), [tab({ done: true })]],
    [ws({ pr: pr({ state: 'MERGED' }) }), [tab({ done: true })]],
    [ws({ pr: pr({ checks: 'fail' }) }), [tab({ done: true })]],
    [ws(), [tab({ secret: { what: 'a token' } })]],
    [ws(), [tab({})]],
    [ws({ pr: pr() }), [tab({ status: 'running' })]],
  ]
  const needs = cases.filter(([, tabs]) => tabs.some(needsTab))
  assert.equal(needs.length, 7)
  for (const [w, tabs] of cases) assert.equal(['answer', 'review', 'fix'].includes(col(w, tabs)), tabs.some(needsTab), JSON.stringify([w, tabs]))
})

test('usual: the median of the turns that ran 20 s or more, once there are 5; its words; past twice it and 5 minutes', () => {
  assert.equal(usual([60, 120, 180, 240]), undefined) // 4: too few
  assert.equal(usual([60, 120, 180, 240, 10, 19]), undefined) // the short ones don't count
  assert.equal(usual([300, 60, 180, 120, 240]), 180) // odd: the middle one
  assert.equal(usual([60, 120, 180, 240, 300, 301]), 210) // even: the two middle ones' mean
  assert.equal(usual([20, 20, 20, 20, 21]), 20) // 20 s counts
  assert.equal(usualText(240, 360), '4 min · usually 6')
  assert.equal(usualText(10, 25), '1 min · usually 1') // never 0 min
  assert.equal(overUsual(719, 360), false)
  assert.equal(overUsual(720, 360), true)
  assert.equal(overUsual(200, 60), false) // under 5 minutes
  assert.equal(overUsual(300, 60), true)
})

test('waitsElsewhere: the edge glow, for an ask waiting in a tab that is not the focused one, the window in use', () => {
  const v = (o: object = {}) => ({ projects: [{ id: 'p' }], settings: {}, workspaces: [ws({ id: 'a', project: 'p' }), ws({ id: 'b', project: 'p' })], tabs: [tab({ id: 't1', workspace: 'a' }), tab({ id: 't2', workspace: 'b', status: 'waiting' })], ...o }) as never
  assert.equal(waitsElsewhere(v(), 't1', true), true, 'waiting in another tab')
  assert.equal(waitsElsewhere(v(), 't2', true), false, 'only in the focused tab')
  assert.equal(waitsElsewhere(v(), 't1', false), false, 'the window not in use')
  assert.equal(waitsElsewhere(v({ dnd: { until: 9 } }), 't1', true), false, 'Do not disturb')
  assert.equal(waitsElsewhere(v({ tabs: [tab({ id: 't2', workspace: 'b', secret: { name: 'KEY' } })] }), 't1', true), true, 'a secret request')
  const hidden = v({ settings: { recording: true }, workspaces: [ws({ id: 'a', project: 'p' }), ws({ id: 'b', project: 'p', private: true })] })
  assert.equal(waitsElsewhere(hidden, 't1', true), false, "Recording mode's hidden workspace")
  assert.equal(waitsElsewhere(v({ settings: { recording: true } }), 't1', true), true, 'Recording mode, not private: still')
  assert.equal(waitsElsewhere(v({ workspaces: [ws({ id: 'b', project: 'p', muted: true })] }), 't1', true), false, 'muted')
  assert.equal(waitsElsewhere(v({ workspaces: [ws({ id: 'b', project: 'p', archived: true })] }), 't1', true), false, 'archived')
  assert.equal(waitsElsewhere(v({ tabs: [tab({ id: 't2', workspace: 'b', status: 'running' })] }), 't1', true), false, 'none waits')
})

test("reviewQueue: the other workspaces to review, a green PR first, then the oldest change; none archived, hidden or busy", () => {
  const stat = { add: 1, del: 0, files: 2, dirty: 0 }
  const w = (id: string, o: object = {}) => ({ id, kind: 'worktree', project: 'p', created: 100, stat, ...o }) as unknown as WorkspaceView
  const done = (ws: string, needAt: number) => tab({ id: `t-${ws}`, workspace: ws, done: true, needAt })
  const v = {
    projects: [{ id: 'p' }, { id: 'q', private: true }, { id: 'f', git: false }],
    settings: { recording: true },
    workspaces: [w('cur'), w('old'), w('new'), w('green', { pr: pr() }), w('red', { pr: pr({ checks: 'fail' }) }), w('waits', { created: 7, pr: pr({ review: 'REVIEW_REQUIRED', checks: undefined }) }), w('ci', { pr: pr({ checks: 'pending' }) }), w('draft', { pr: pr({ draft: true }) }), w('gone', { archived: true }), w('hid', { private: true }), w('hidp', { project: 'q' }), w('folder', { project: 'f' }), w('busy'), w('unscanned', { stat: undefined }), w('nothing', { stat: { add: 0, del: 0, files: 0, dirty: 0 } })],
    tabs: [done('cur', 1), done('old', 5), done('new', 9), done('gone', 1), done('hid', 1), done('hidp', 1), done('folder', 1), done('unscanned', 1), done('nothing', 1), tab({ id: 't-busy', workspace: 'busy', status: 'running' })], // unscanned, nothing: no Review tab
  } as any
  assert.deepEqual(reviewQueue(v, 'cur').map(x => x.id), ['green', 'old', 'waits', 'new']) // waits: no finish, by when it was made
  // Recording mode off: the private ones are back
  assert.deepEqual(reviewQueue({ ...v, settings: {} }, 'cur').map(x => x.id).sort(), ['green', 'hid', 'hidp', 'new', 'old', 'waits'])
})
