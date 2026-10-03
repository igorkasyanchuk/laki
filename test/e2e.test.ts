// E2E smoke: a client renders the stream into its own emulator; after it disconnects, a new client
// rebuilt from the snapshot alone shows the identical screen.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import headless from '@xterm/headless'
import { connect, fresh, until } from './helpers.ts'

type Term = InstanceType<typeof headless.Terminal>
const screen = (t: Term) => ({
  lines: Array.from({ length: t.buffer.active.length }, (_, i) => t.buffer.active.getLine(i)!.translateToString(true)),
  cursor: [t.buffer.active.cursorX, t.buffer.active.cursorY],
  type: t.buffer.active.type,
  modes: { ...t.modes },
})
const flush = (t: Term) => new Promise<void>(r => t.write('', r))

// a renderer stand-in: an emulator fed by attach (snapshot) and the data events after it
async function client(rig: Parameters<typeof connect>[0], tab: string) {
  const c = await connect(rig)
  const term = new headless.Terminal({ cols: 100, rows: 30, scrollback: 5000, allowProposedApi: true })
  const r = await c.call('attach', { tab, cols: 100, rows: 30 })
  term.write(r.snapshot)
  c.ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.ev === 'data' && m.tab === tab) term.write(m.d)
  })
  return { c, term }
}

test('e2e: workspace with a fake agent, send, disconnect, reattach: same screen', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'plan the work' })
  const tab = await rig.tab(ws.id)
  const a = await client(rig, tab.id)
  await until(async () => (await flush(a.term), screen(a.term).lines.join('\n').includes('answer: plan the work')), 'first turn')
  await rig.rpc('send', { target: ws.id, text: 'now build it' })
  await until(async () => (await flush(a.term), screen(a.term).lines.join('\n').includes('answer: now build it')), 'sent text answered')
  await until(async () => (await rig.tab(ws.id)).status === 'idle', 'idle')
  const before = screen(a.term)
  assert.equal(before.modes.bracketedPasteMode, true)
  a.c.close()
  const b = await client(rig, tab.id)
  await flush(b.term)
  assert.deepEqual(screen(b.term), before)
  b.c.close()
})
