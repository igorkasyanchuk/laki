// a new workspace's agent started later (wsNew startAt, schedule.ts pendingTick): at a time, or as the plan limit resets
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { resetOf } from '../src/shared/types.ts'
import { fresh, until } from './helpers.ts'

test("a delayed start: the workspace now, its agent at its time (a tick), after a restart too; moved, started now, cancelled", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const at = Date.now() + 3_600_000
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'none', startAt: at }), /nothing starts later: pick an agent/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'claude', startAt: Date.now() - 3_600_000 }), /has passed/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'claude', startAt: 'soon' }), /a time \(ms\) or 'limit'/)
  await assert.rejects(rig.rpc('wsNew', { project: p.id, preset: 'gemini', startAt: 'limit' }), /claude and codex only, not gemini/)
  await assert.rejects(rig.rpc('wsFan', { project: p.id, presets: ['claude', 'gemini'], prompt: 'x', startAt: 'limit' }), /claude and codex only, not gemini/) // a race: every one checked before any worktree
  assert.equal((await rig.rpc('state')).workspaces.length, 0)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'fix the cart\nand more', startAt: at })
  const view = async (id = ws.id) => ((s: any) => ({ w: s.workspaces.find((w: any) => w.id === id), tabs: s.tabs.filter((t: any) => t.workspace === id) }))(await rig.rpc('state'))
  assert.ok(existsSync(ws.path)) // made now: only its agent waits
  assert.deepEqual((await view()).w.pending, { at, prompt: 'fix the cart', agent: 'claude' })
  assert.equal((await view()).tabs.length, 0)
  await rig.rpc('pendingTick', { now: at - 1000 })
  assert.equal((await view()).tabs.length, 0)

  // kept over a restart, then started by a tick past its time: late, and its log says so
  await rig.stop()
  await rig.start()
  assert.equal((await view()).w.pending.at, at)
  await rig.rpc('settingsSet', { devMode: true })
  await rig.rpc('pendingTick', { now: at + 600_000 })
  const v = await view()
  assert.equal(v.w.pending, undefined)
  assert.deepEqual(v.tabs.map((x: any) => [x.preset, x.kind]), [['claude', 'agent']])
  assert.ok((await rig.rpc('logs', { key: `ws:${ws.id}` })).some((l: any) => /claude started late, was due/.test(l.text)))
  await until(async () => /fix the cart/.test(await rig.rpc('screen', { target: v.tabs[0].id })), 'its prompt went in')

  // moved and its prompt changed, then started now; a second start has nothing to start
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'later', startAt: at })
  await assert.rejects(rig.rpc('wsSet', { id: b.id, pending: { at: Date.now() - 3_600_000 } }), /has passed/)
  await rig.rpc('wsSet', { id: b.id, pending: { at: at + 60_000, prompt: 'changed' } })
  assert.deepEqual((await view(b.id)).w.pending, { at: at + 60_000, prompt: 'changed', agent: 'claude' })
  await rig.rpc('wsSet', { id: b.id, start: true })
  assert.equal((await view(b.id)).tabs.length, 1)
  await assert.rejects(rig.rpc('wsSet', { id: b.id, start: true }), /has no agent waiting to start/)
  await until(async () => /changed/.test(await rig.rpc('screen', { target: (await view(b.id)).tabs[0].id })), 'the changed prompt went in')

  // the CLI's: --at in words, --after-limit, a time it can't read
  const cli = JSON.parse((await rig.cli('new', p.id, '--preset', 'claude', '--name', 'cli-later', '--at', 'tomorrow at 9am', '--prompt', 'x', '--json')).out)
  assert.equal(new Date(cli.pending.at).getHours(), 9)
  assert.equal(JSON.parse((await rig.cli('new', p.id, '--name', 'cli-limit', '--after-limit', '--prompt', 'x', '--json')).out).pending.limit, true)
  assert.match((await rig.cli('new', p.id, '--at', 'whenever', '--prompt', 'x')).err, /At what time\?/)

  // cancelled: the workspace stays, with no agent, and no tick starts one
  const c = await rig.rpc('wsNew', { project: p.id, preset: 'claude', startAt: at })
  await rig.rpc('wsSet', { id: c.id, pending: null })
  await rig.rpc('pendingTick', { now: at + 1000 })
  assert.deepEqual([(await view(c.id)).w.pending, (await view(c.id)).tabs.length], [undefined, 0])
})

test('a delayed start after the plan limit resets: the soonest reset at or past usageAt, read from usage, then started', async t => {
  assert.equal(resetOf([{ label: '5-hour', used: 40, resets: 5 }, { label: 'Weekly', used: 95, resets: 9 }, { label: 'Extra usage', used: 99, resets: 1, note: '$1' }], 90), 9)
  assert.equal(resetOf([{ label: '5-hour', used: 40, resets: 5 }, { label: 'Weekly', used: 60, resets: 9 }], 90), 5) // none that high: the 5-hour's
  assert.equal(resetOf([{ label: 'Weekly', used: 60 }], 90), undefined)
  const reset = new Date(Date.now() + 7_200_000)
  reset.setMilliseconds(0)
  const srv = createServer((q, r) => {
    if (q.url !== '/api/oauth/usage') return void r.writeHead(404).end()
    r.writeHead(200, { 'content-type': 'application/json' })
    r.end(JSON.stringify({ five_hour: { utilization: 96, resets_at: reset.toISOString() }, seven_day: { utilization: 20, resets_at: new Date(Date.now() + 86_400_000).toISOString() } }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const rig = await fresh(t, { env: { LAKI_USAGE_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  mkdirSync(join(rig.home, '.claude'), { recursive: true })
  writeFileSync(join(rig.home, 'keychain'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000, subscriptionType: 'max' } }))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'when there is room', startAt: 'limit' })
  const view = async () => ((s: any) => ({ w: s.workspaces.find((w: any) => w.id === ws.id), tabs: s.tabs.filter((t: any) => t.workspace === ws.id) }))(await rig.rpc('state'))
  await until(async () => (await view()).w.pending?.at === reset.getTime(), 'its reset read')
  assert.equal((await view()).w.pending.limit, true)
  await rig.rpc('pendingTick', { now: reset.getTime() - 1000 })
  assert.equal((await view()).tabs.length, 0)
  await rig.rpc('pendingTick', { now: reset.getTime() + 1000 })
  assert.equal((await view()).w.pending, undefined)
  assert.equal((await view()).tabs.length, 1)
})
