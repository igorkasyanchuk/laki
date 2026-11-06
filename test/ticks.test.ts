import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loops, register, setIdle, SLOW, stopAll } from '../src/daemon/ticks.ts'

// H4.5: while idle, 'pause' skips, 'slow' runs every SLOW-th tick, 'keep' runs as ever; back at full speed at once
test('ticks: idle pauses, slows or keeps each loop; a throw is logged, never stops it', async t => {
  t.after(() => (stopAll(), setIdle(() => false)))
  const logged = t.mock.method(console, 'log', () => {})
  let idle = true
  setIdle(() => idle)
  const n = { pause: 0, slow: 0, keep: 0, thrown: 0 }
  for (const k of ['pause', 'slow', 'keep'] as const) register(k, 10, () => n[k]++, { idle: k })
  register('thrown', 10, () => {
    n.thrown++
    throw new Error('boom')
  })
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  await wait(500)
  assert.equal(n.pause, 0)
  assert.ok(n.keep >= 20, `keep: ${n.keep}`)
  assert.ok(n.slow >= 2 && n.slow <= Math.ceil(n.keep / SLOW) + 1, `slow: ${n.slow} of ${n.keep}`)
  assert.ok(n.thrown >= 20 && logged.mock.calls.some(c => c.arguments[1] === 'thrown'), 'it goes on after a throw, logged by name')
  idle = false
  const was = { ...n }
  await wait(200)
  assert.ok(n.pause - was.pause >= 5 && n.slow - was.slow >= 5, 'full speed again')
  assert.equal(loops.length, 4)
  stopAll()
  assert.equal(loops.length, 0)
})
