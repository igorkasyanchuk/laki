// OSC 52 (shared/osc52.ts): a program's copy, parsed: a valid payload, a read request, an oversized one, bad base64,
// an empty target (the default: the clipboard)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OSC52_MAX, osc52 } from '../src/shared/osc52.ts'

const b64 = (s: string) => Buffer.from(s).toString('base64')

test('osc52: a valid payload', () => {
  assert.deepEqual(osc52(`c;${b64('hi there')}`), { text: 'hi there' })
  assert.deepEqual(osc52(`c;${b64('héllo ✓\n  two\r\n')}`), { text: 'héllo ✓\n  two\r\n' }, 'UTF-8, whitespace and line ends as they are')
  assert.deepEqual(osc52(`s;${b64('sel')}`), { text: 'sel' })
  assert.deepEqual(osc52(`pc;${b64('both')}`), { text: 'both' })
  assert.deepEqual(osc52(`c;${b64('ab').replace(/=+$/, '')}`), { text: 'ab' }, 'padding left out (tmux)')
})

test('osc52: an empty target is the clipboard', () => {
  assert.deepEqual(osc52(`;${b64('x')}`), { text: 'x' })
})

test('osc52: a read request is refused', () => {
  assert.equal(osc52('c;?'), undefined)
  assert.equal(osc52(';?'), undefined)
})

test('osc52: oversized is dropped', () => {
  assert.deepEqual(osc52(`c;${b64('a'.repeat(OSC52_MAX))}`), { text: 'a'.repeat(OSC52_MAX) })
  assert.equal(osc52(`c;${b64('a'.repeat(OSC52_MAX + 1))}`), undefined)
  assert.equal(osc52(`c;${'A'.repeat(1 << 20)}`), undefined)
})

test('osc52: bad base64, other targets and nothing are dropped', () => {
  assert.equal(osc52('c;not base64!'), undefined)
  assert.equal(osc52('c;A'), undefined)
  assert.equal(osc52('c;'), undefined)
  assert.equal(osc52(b64('no targets')), undefined)
  assert.equal(osc52(`p;${b64('primary only')}`), undefined)
  assert.equal(osc52(`x;${b64('?')}`), undefined)
})
