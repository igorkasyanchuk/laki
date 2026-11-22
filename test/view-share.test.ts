// the state event's view, sharing the last one's objects where nothing changed (renderer/src/viewShare.ts). No daemon
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { viewShare } from '../src/renderer/src/viewShare.ts'

const view = (status: string) => JSON.parse(JSON.stringify({
  api: 1,
  settings: { theme: 'laki' },
  projects: [{ id: 'p1', name: 'shop' }],
  workspaces: [{ id: 'w1', project: 'p1', name: 'a' }, { id: 'w2', project: 'p1', name: 'b' }],
  tabs: [{ id: 't1', workspace: 'w1', status }, { id: 't2', workspace: 'w2', status: 'idle' }],
  widgets: [{ id: 'x1', html: '<b>1</b>' }],
  today: { tokens: 5 },
}))

test("viewShare: one tab's change keeps every other object and list; a list that changed is new, its kept items old", () => {
  const a = viewShare(null, view('idle'))
  const b = viewShare(a, view('running'))
  assert.notEqual(b, a)
  assert.notEqual(b.tabs, a.tabs, 'a tab changed: a new list')
  assert.notEqual(b.tabs[0], a.tabs[0], 'that tab new')
  assert.equal(b.tabs[0].status, 'running')
  assert.equal(b.tabs[1], a.tabs[1], 'the other tab kept')
  for (const k of ['workspaces', 'projects', 'widgets', 'settings', 'today'] as const) assert.equal(b[k], a[k], k)
  assert.equal(b.workspaces[0], a.workspaces[0])
  // nothing changed: every list and field the old one
  const c = viewShare(b, view('running'))
  for (const k of ['tabs', 'workspaces', 'projects', 'widgets', 'settings', 'today'] as const) assert.equal(c[k], b[k], k)
  // one gone, one new, the order changed: the kept ones old, the list new
  const d0 = view('running')
  d0.workspaces = [d0.workspaces[1], { id: 'w3', project: 'p1', name: 'c' }]
  const d = viewShare(c, d0)
  assert.notEqual(d.workspaces, c.workspaces)
  assert.equal(d.workspaces[0], c.workspaces[1], 'w2 kept, moved')
  assert.deepEqual(d.workspaces.map(w => w.id), ['w2', 'w3'])
  // a field that's new or gone: as the new view has it
  const e0 = view('running') as Record<string, unknown>
  delete e0.today
  e0.ptyHostOff = 'why'
  const e = viewShare(d, e0 as never) as Record<string, unknown>
  assert.equal('today' in e, false)
  assert.equal(e.ptyHostOff, 'why')
})
