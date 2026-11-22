// P2: a view's change as a patch (shared/viewPatch.ts): the keys and items whose JSON changed, the ids' order when it
// did; applied, what didn't come keeps its object. No daemon: test:fast (api.test.ts has a daemon's patch)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { viewDiff, viewPatch } from '../src/shared/viewPatch.ts'

const tab = (id: string, status = 'idle') => ({ id, workspace: 'w1', name: id, status })
const base = () => ({ settings: { theme: 'dark' }, presets: [{ name: 'claude' }], caps: ['a'], dnd: { until: 9 }, workspaces: [{ id: 'w1', name: 'one' }], tabs: [tab('t1'), tab('t2'), tab('t3')] })

test('viewDiff: the whole view first; then only what changed: a key, a tab by id, the order, a key gone; nothing: no message', () => {
  const first = viewDiff(undefined, base())
  assert.deepEqual(first.msg, { ev: 'state', view: base() })
  assert.equal(viewDiff(first.sent, base()).msg, undefined, 'the same: nothing sent')
  const v = base()
  v.tabs[1] = tab('t2', 'running')
  const one = viewDiff(first.sent, v)
  assert.deepEqual(one.msg, { ev: 'state', patch: {}, items: { tabs: { set: [tab('t2', 'running')] } } }, 'that tab only, no order')
  assert.ok(JSON.stringify(one.msg).length < 200)
  const w = { ...v, settings: { theme: 'light' }, tabs: [v.tabs[2], v.tabs[0]] } as Record<string, unknown>
  delete w.dnd
  assert.deepEqual(viewDiff(one.sent, w).msg, { ev: 'state', patch: { settings: { theme: 'light' } }, gone: ['dnd'], items: { tabs: { set: [], order: ['t3', 't1'] } } })
})

test("viewPatch: a patch onto the last view; what didn't come keeps its object; the order as sent, a tab gone with it", () => {
  const prev = base()
  const v = base()
  v.tabs = [v.tabs[0], tab('t2', 'waiting'), tab('t4')]
  v.settings = { theme: 'light' }
  const d = viewDiff(viewDiff(undefined, prev).sent, v)
  const next = viewPatch(prev, d.msg!)
  assert.deepEqual(next, v)
  assert.equal(next.tabs[0], prev.tabs[0], 'an unchanged tab: its old object')
  assert.equal(next.workspaces, prev.workspaces, 'an unchanged list: its old array')
  assert.equal(next.presets, prev.presets)
  assert.notEqual(next.settings, prev.settings)
  assert.deepEqual(viewPatch(prev, { ev: 'state', gone: ['dnd'] }).dnd, undefined)
})
