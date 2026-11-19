// V7b: a status mark's one-shot effect (src/renderer/src/glyphFx.ts): only as its state changes while drawn
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fxOf } from '../src/renderer/src/glyphFx.ts'

test('fxOf: done, ask and err as the state changes while drawn; none as first drawn, for the same state or end to end', () => {
  assert.equal(fxOf('running', 'done', true), 'done')
  assert.equal(fxOf('running', 'ok', true), 'done')
  assert.equal(fxOf('running', 'waiting', true), 'ask')
  assert.equal(fxOf('idle', 'exited', true), 'err')
  assert.equal(fxOf(undefined, 'done', true), undefined) // first drawn
  assert.equal(fxOf('running', 'done', false), undefined) // not mounted
  assert.equal(fxOf('done', 'done', true), undefined)
  assert.equal(fxOf('ok', 'finished', true), undefined) // one end to another
  assert.equal(fxOf('waiting', 'running', true), undefined)
  assert.equal(fxOf('done', 'idle', true), undefined)
  assert.equal(fxOf('running', 'limit', true), undefined)
})
