import assert from 'node:assert/strict'
import { test } from 'node:test'
import { skillTools, state, tools } from '../src/shared/tools.ts'
import { describe, groupsOf, keep, move, place, resize, tabsOf } from '../src/shared/layout.ts'
import { fresh, until } from './helpers.ts'

test('tabs of panes: sessions in no tab get one, moving splits and merges, nothing nests', () => {
  let g = groupsOf(undefined, ['a', 'b', 'c'])
  assert.deepEqual(g, [{ tab: 'a' }, { tab: 'b' }, { tab: 'c' }])
  g = move(g, 'b', true, { pane: 'a', edge: 'right' }) // tab b into tab a, on the right
  assert.deepEqual(g, [{ dir: 'row', a: { tab: 'a' }, b: { tab: 'b' }, at: 0.5 }, { tab: 'c' }])
  g = move(g, 'c', true, { pane: 'a', edge: 'bottom' })
  assert.equal(g.length, 1)
  assert.deepEqual(tabsOf(g[0]), ['a', 'c', 'b'])
  assert.equal(move(g, 'a', true, { pane: 'b', edge: 'left' }), g) // a tab onto its own pane: nothing
  const moved = move(g, 'b', false, { pane: 'c', edge: 'top' }) // one pane within its tab
  assert.deepEqual(tabsOf(moved[0]), ['a', 'b', 'c'])
  const out = move(g, 'c', false, 'bar') // a pane out into its own tab, right after
  assert.deepEqual(out.map(tabsOf), [['a', 'b'], ['c']])
  assert.equal(move(out, 'c', false, 'bar'), out) // already alone
  // ended sessions drop out; new ones get their own tab; a session is never in two tabs
  assert.deepEqual(groupsOf([g[0], { tab: 'a' }], ['a', 'c', 'd']).map(tabsOf), [['a', 'c'], ['d']])
  // a session twice in one tab (a client's layoutSet): once
  assert.deepEqual(groupsOf([{ dir: 'row', a: { tab: 'a' }, b: { tab: 'a' }, at: 0.5 }], ['a']), [{ tab: 'a' }])
  assert.equal(keep(g[0], () => false), null)
  assert.equal((resize(g[0], '', 2) as { at: number }).at, 0.9) // clamped
  const { panes, bars } = place(resize(g[0], 'a', 0.25))
  assert.deepEqual(panes.find(p => p.tab === 'c')!.box, { x: 0, y: 0.25, w: 0.5, h: 0.75 })
  assert.equal(bars.length, 2)
})

test('dragging: tabs reordered in the bar, a pane out at an index, center trades places, no-ops return groups', () => {
  const g = groupsOf(undefined, ['a', 'b', 'c'])
  assert.deepEqual(move(g, 'c', true, { bar: 0 }).map(tabsOf), [['c'], ['a'], ['b']])
  assert.deepEqual(move(g, 'a', true, { bar: 3 }).map(tabsOf), [['b'], ['c'], ['a']])
  assert.equal(move(g, 'b', true, { bar: 1 }), g) // before itself
  assert.equal(move(g, 'b', false, { bar: 2 }), g) // after itself: a pane alone moves its tab
  const s = move(g, 'b', true, { pane: 'a', edge: 'right' }) // [a|b], [c]
  assert.deepEqual(move(s, 'b', false, { bar: 0 }).map(tabsOf), [['b'], ['a'], ['c']])
  assert.deepEqual(move(s, 'b', false, { bar: 2 }).map(tabsOf), [['a'], ['c'], ['b']])
  assert.deepEqual(move(s, 'a', false, { pane: 'b', edge: 'center' }), [{ dir: 'row', a: { tab: 'b' }, b: { tab: 'a' }, at: 0.5 }, { tab: 'c' }])
  assert.deepEqual(move(s, 'c', true, { pane: 'a', edge: 'center' }), [{ dir: 'row', a: { tab: 'c' }, b: { tab: 'b' }, at: 0.5 }, { tab: 'a' }])
  assert.equal(move(s, 'a', false, { pane: 'a', edge: 'center' }), s) // onto itself
  assert.equal(move(s, 'a', true, { pane: 'b', edge: 'left' }), s) // its tab onto its own pane
})

test('a tab in words: | side by side, / stacked, nested in parentheses', () => {
  const l = { dir: 'row' as const, a: { tab: 'a' }, b: { dir: 'col' as const, a: { tab: 'b' }, b: { tab: 'c' }, at: 0.5 }, at: 0.5 }
  assert.equal(describe(l), 'a | (b / c)')
  assert.equal(describe({ dir: 'row', a: l, b: { tab: 'd' }, at: 0.5 }, t => t.toUpperCase()), 'A | (B / C) | D')
})

test('layouts in the daemon: a new tab beside a pane or the one you are on, checked, moved, focused, listed for Laki AI', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi' })
  const agent = await rig.tab(ws.id)
  const layout = async () => (await rig.rpc('state')).layouts?.[ws.id]
  // beside a pane: a split in its tab
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell', beside: agent.id, edge: 'bottom' })
  assert.deepEqual(await layout(), [{ dir: 'col', a: { tab: agent.id }, b: { tab: sh.id }, at: 0.5 }])
  // a plain new tab: its own, unless settings.splitNew, then beside the pane the focused window is on
  const own = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  assert.equal((await layout()).length, 1) // stored as it was; the view adds own as a tab (groupsOf)
  const c = await rig.connect()
  await c.call('view', { tab: sh.id, focused: true })
  await rig.rpc('settingsSet', { splitNew: true })
  const next = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  assert.deepEqual(await layout(), [{ dir: 'col', a: { tab: agent.id }, b: { dir: 'row', a: { tab: sh.id }, b: { tab: next.id }, at: 0.5 }, at: 0.5 }, { tab: own.id }])
  // beside: null, a tab of its own anyway
  const apart = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell', beside: null })
  assert.equal((await layout()).length, 2)
  // what a client sends is checked: bad shapes dropped, another workspace's and gone sessions out, a split's size in range
  await rig.rpc('layoutSet', { ws: ws.id, groups: [{ dir: 'row', a: { tab: agent.id }, b: { tab: 'nope' }, at: 5 }, { dir: 'diag', a: 1 }, 'x', { dir: 'row', a: { tab: own.id }, b: { tab: apart.id }, at: 0.95 }] })
  assert.deepEqual(await layout(), [{ tab: agent.id }, { dir: 'row', a: { tab: own.id }, b: { tab: apart.id }, at: 0.9 }, { tab: sh.id }, { tab: next.id }])
  await assert.rejects(rig.rpc('layoutSet', { ws: ws.id, groups: 'x' }), /a list/)

  // Laki AI's laki_panes: split, separate, list, focus (the window selects it)
  const tool = (name: string): ((a: object) => Promise<any>) => [...tools(rig.rpc), ...skillTools(rig.rpc)].find(x => x.name === name)!.run
  let r = await tool('laki_panes')({ act: 'split', tab: sh.id, beside: agent.id, edge: 'left' })
  assert.equal(r.tabs[0].split, `${sh.name} | ${agent.name}`)
  r = await tool('laki_panes')({ act: 'separate', tab: own.id })
  assert.deepEqual(r.tabs.map((x: any) => x.split), [`${sh.name} | ${agent.name}`, apart.name, own.name, next.name]) // right after the tab it left
  assert.deepEqual(r.tabs[0].panes.map((x: any) => [x.id, x.kind, x.agent]), [[sh.id, 'shell', undefined], [agent.id, 'agent', 'claude']])
  await assert.rejects(tool('laki_panes')({ act: 'split', tab: sh.id, beside: sh.id }), /beside itself/)
  await tool('laki_panes')({ act: 'focus', tab: next.id })
  await until(() => c.events.some((e: any) => e.ev === 'focus' && e.tab === next.id), 'focus event')
  // laki_new_tab beside one; laki_state says how its tabs are split
  const made = await tool('laki_shell')({ ws: ws.id, beside: apart.id, edge: 'right' })
  assert.ok((await state(rig.rpc)).workspaces[0].tabs?.includes(`${apart.name} | ${(await rig.rpc('state')).tabs.find((x: any) => x.id === made.tab).name}`))
  // a closed tab leaves the layout; a deleted workspace takes its layouts with it
  await rig.rpc('tabClose', { id: sh.id })
  r = await tool('laki_panes')({ ws: ws.id })
  assert.equal(r.tabs[0].split, agent.name)
  await rig.rpc('wsRm', { id: ws.id })
  assert.equal(await layout(), undefined)
  c.close()
})
