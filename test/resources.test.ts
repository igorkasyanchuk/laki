// Resources: memory by tab; idle agents put to sleep (settings.sleepAfter) and resumed by a message or a look.
import assert from 'node:assert/strict'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, running, sleep, until } from './helpers.ts'

test('resources lists each tab and its processes; an idle agent sleeps, and a message or a look resumes its chat', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', local: true })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.resumeId && x.status === 'idle' && x
  }, 'first turn')
  const r = await rig.rpc('resources')
  const mine = r.tabs.find((x: any) => x.tab === tab.id)
  const agent = mine?.procs.find((x: any) => /fakes\/claude/.test(x.cmd))
  assert.ok(agent && mine.rss >= agent.rss && agent.rss > 0, JSON.stringify(mine))
  assert.ok(r.daemon.rss > 0 && r.daemon.heap > 0)

  const later = () => Date.now() + 3 * 3600e3
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), []) // unset: 8 hours
  await rig.rpc('settingsSet', { sleepAfter: 0 })
  assert.deepEqual(await rig.rpc('sleepTick', { now: Date.now() + 9 * 3600e3 }), []) // Never
  await rig.rpc('settingsSet', { sleepAfter: 60 })
  assert.deepEqual(await rig.rpc('sleepTick', { now: Date.now() }), []) // not quiet for an hour yet
  await rig.rpc('wsSet', { id: ws.id, autoFix: true })
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), []) // PR feedback goes to it: it stays
  await rig.rpc('wsSet', { id: ws.id, autoFix: false })
  const sh = await rig.rpc('tabNew', { ws: ws.id })
  await assert.rejects(rig.rpc('tabSleep', { tab: sh.id }), /can't resume a chat/) // a shell has none
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), [tab.id])
  await until(() => !running(agent.pid), 'its claude ended')
  const v = await rig.tab(ws.id)
  assert.equal(v.asleep, true)
  assert.equal(v.status, 'idle')
  assert.match(await rig.screen(tab.id), /answer: hi[\s\S]*asleep/) // its screen stays
  assert.ok(!(await rig.rpc('resources')).tabs.some((x: any) => x.tab === tab.id))

  // a message: it resumes the chat, and gets the message once it's up
  assert.equal((await rig.rpc('send', { target: tab.id, text: 'again' })).queued, 1)
  await until(async () => (await rig.screen(tab.id)).includes('answer: again'), 'resumed, then answered', 15000)
  const starts = () => rig.fakeLog().filter(l => l.bin === 'claude' && l.tab === tab.id)
  assert.deepEqual(starts().at(-1).args.slice(-4, -2), ['--resume', tab.resumeId]) // then the note about Laki
  assert.equal((await rig.tab(ws.id)).asleep, undefined)

  // a look (attach) wakes it too
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle again')
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), [tab.id])
  const n = starts().length
  const c = await rig.connect()
  await c.call('attach', { tab: tab.id, cols: 80, rows: 24 })
  await until(() => starts().length === n + 1, 'resumed on a look')
  assert.equal((await rig.tab(ws.id)).asleep, undefined)
  assert.deepEqual(await rig.rpc('sleepTick', { now: later() }), []) // looked at: it stays

  // Sleep now, while on screen: a key wakes it, and the pane hears its session was replaced (exit -1: attach again)
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle after the look', 15000)
  assert.equal(await c.call('tabSleep', { tab: tab.id }), true)
  await until(() => c.data(tab.id).includes('asleep'), 'the pane says so')
  c.notify('input', { tab: tab.id, data: '\x1b[I' }) // the pane's focus report (a mode claude left on): not a key
  await sleep(300)
  assert.equal((await rig.tab(ws.id)).asleep, true)
  c.notify('input', { tab: tab.id, data: 'x' })
  await until(() => c.events.some(e => e.ev === 'exit' && e.tab === tab.id && e.code === -1), 'told to attach again')
  await until(() => starts().length === n + 2, 'resumed on a key')
  c.close()
})

test("resources lists what the daemon runs besides tabs, named, and Stop ends a tunnel", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', local: true })
  symlinkSync(join(import.meta.dirname, 'cloudflared'), join(rig.home, 'bin/cloudflared'))
  await rig.rpc('tunnelStart', { ws: ws.id, port: 5173 })
  const row = (r: any) => r.others?.find((o: any) => o.stop === `tunnel:${ws.id}:5173`)
  const tn = row(await rig.rpc('resources'))
  assert.ok(tn && /^Expose to the world · .* :5173$/.test(tn.name) && tn.procs.some((x: any) => /cloudflared/.test(x.cmd)), JSON.stringify(tn))
  assert.ok(!(await rig.rpc('resources')).app.some((x: any) => x.pid === tn.procs[0].pid)) // not Laki itself's too
  await assert.rejects(rig.rpc('resourceStop', { key: 'nope' }), /nothing to stop called nope/)
  await rig.rpc('resourceStop', { key: tn.stop })
  assert.deepEqual((await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).tunnels ?? [], [])
  await until(async () => !row(await rig.rpc('resources')), 'its cloudflared gone')
})
