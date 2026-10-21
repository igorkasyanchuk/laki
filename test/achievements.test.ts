// Achievements (shared/achievements.ts): 54, each one action; what earns each: a call, a page, the view moving
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACH_GROUPS, ACHIEVEMENTS, earnedBy, pageEarns, upsOf, wentUp } from '../src/shared/achievements.ts'
import { ICONS } from '../src/shared/icons.ts'
import type { View } from '../src/shared/types.ts'

test('achievements: 54, unique, grouped, each with a way to earn it', () => {
  assert.equal(ACHIEVEMENTS.length, 54)
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, 54)
  for (const a of ACHIEVEMENTS) {
    assert.ok(ACH_GROUPS.includes(a.group), a.id)
    assert.ok(a.icon in ICONS, `${a.id}: icon ${a.icon}`)
    assert.ok(a.title && a.how, a.id)
  }
  for (const g of ACH_GROUPS) assert.ok(ACHIEVEMENTS.some(a => a.group === g), g)
})

test('achievements: a call earns by its method and params', () => {
  assert.deepEqual(earnedBy('wsNew', { project: 'p' }), ['workspace'])
  assert.deepEqual(earnedBy('fileUndo', {}), ['revert'])
  assert.deepEqual(earnedBy('quickNew', { kind: 'shells' }), ['terminal'])
  assert.deepEqual(earnedBy('quickNew', { kind: 'browsers' }), ['browser'])
  assert.deepEqual(earnedBy('wsSet', { id: 'w', autoFix: true }), ['autofix'])
  assert.deepEqual(earnedBy('wsSet', { id: 'w', autoFix: false }), [])
  assert.deepEqual(earnedBy('wsSet', { id: 'w', name: 'login' }), ['rename'])
  assert.deepEqual(earnedBy('wsSet', { id: 'w', name: 'Example', browser: 'https://example.com' }), []) // a page's title, not you
  assert.deepEqual(earnedBy('wsSet', { id: 'w', pinned: true }), ['pin'])
  assert.deepEqual(earnedBy('wsSet', { id: 'w', pinned: false }), [])
  assert.deepEqual(earnedBy('prAct', { act: 'close' }), [])
  assert.deepEqual(earnedBy('scheduleSet', { id: 's1', on: false }), []) // a change, not a new one
  assert.deepEqual(earnedBy('widgetSet', { id: 'x', on: true }), ['extension'])
  assert.deepEqual(earnedBy('settingsSet', { theme: 'x' }), []) // the view's move earns that one
  assert.deepEqual(earnedBy('sim', { op: 'tap' }), ['simulator'])
  assert.deepEqual(earnedBy('sim', { op: 'frame' }), []) // the panel drawing it isn't you
  assert.deepEqual(earnedBy('screen', {}), [])
  assert.deepEqual(earnedBy('ship', { ws: 'w' }, { id: 't' }), ['ship'])
  assert.deepEqual(earnedBy('ship', { ws: 'w' }, { held: [{ why: 'no' }] }), []) // a gate held it: not shipped
  assert.deepEqual(earnedBy('wsArchive', { id: 'w', ifClean: true }, { dirty: 2 }), []) // asks first: not archived yet
  assert.deepEqual(earnedBy('wsArchive', { id: 'w' }, null), ['archive'])
  assert.deepEqual(earnedBy('prViewed', { path: 'a', viewed: true }), ['viewed'])
  assert.deepEqual(earnedBy('prViewed', { path: 'a', viewed: false }), []) // unticked
  assert.deepEqual(earnedBy('fileWrite', { ws: 'w', path: 'a', text: '' }), ['edit'])
  assert.deepEqual(earnedBy('meme', {}), ['meme'])
  assert.deepEqual(pageEarns('board'), ['board'])
  assert.deepEqual(pageEarns('about'), [])
})

test("achievements: the view's numbers going up and values changing earn, never the first view", () => {
  const view = (o: Partial<View> = {}): View => ({ projects: [], workspaces: [], tabs: [], presets: [], settings: {}, ...o })
  const a = upsOf(view())
  assert.deepEqual(wentUp({}, a), []) // nothing to compare with yet
  const split = { dir: 'row', a: { tab: 't1' }, b: { tab: 't2' }, at: 50 } as const
  const b = upsOf(view({ settings: { theme: 'dawn', templates: [{ name: 'x', text: '' }], presets: [{ name: 'c', agent: 'claude' }] }, layouts: { w: [split] }, presets: [{ name: 'c', agent: 'claude' }] }))
  assert.deepEqual(wentUp(a, b).sort(), ['split', 'template', 'theme']) // a profile: App's Settings save, not the view
  assert.deepEqual(wentUp(b, a), []) // one taken away earns nothing, nor the theme back to unset (Reset the interface)
  assert.deepEqual(wentUp(b, upsOf(view({ settings: { theme: 'default' } }))), ['theme']) // Default picked is a pick
  const mem = upsOf(view({ projects: [{ id: 'p', name: 'p', path: '/p', memory: [{ id: 'm', text: 'x', at: 1, auto: true }] }] }))
  assert.deepEqual(wentUp(a, mem), []) // an agent's memory isn't yours
  const own = upsOf(view({ projects: [{ id: 'p', name: 'p', path: '/p', config: { templates: [{ name: 't', text: 'x' }], actions: [{ name: 'a', text: 'x', target: 'claude' }] } }] }))
  assert.deepEqual(wentUp(a, own).sort(), ['projectAction', 'projectTemplate']) // a project's own, not the global ones
  assert.deepEqual(wentUp(a, upsOf(view({ settings: { actions: [{ name: 'a', text: 'x', target: 'shell' }], workflows: true, specs: false } }))).sort(), ['action', 'experimental'])
})
