// test:sheet's picture comparison (src/shared/pixelDiff.ts) on tiny buffers. No daemon: test:fast
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pixelDiff } from '../src/shared/pixelDiff.ts'

const img = (w: number, h: number, px: number[] = [10, 20, 30, 255]) => Uint8Array.from({ length: w * h * 4 }, (_, i) => px[i % 4])

test('pixelDiff: the share of pixels with a channel moved by more than 8; another size is all of it', () => {
  const a = img(2, 2)
  assert.equal(pixelDiff(a, 2, 2, img(2, 2), 2, 2), 0, 'the same')
  const b = img(2, 2)
  b[0] += 8 // within the tolerance
  b[5] += 9 // the second pixel's green: past it
  assert.equal(pixelDiff(a, 2, 2, b, 2, 2), 0.25)
  b[15] = 0 // the fourth's alpha
  assert.equal(pixelDiff(a, 2, 2, b, 2, 2), 0.5)
  assert.equal(pixelDiff(a, 2, 2, img(4, 1), 4, 1), 1, 'another shape')
  assert.equal(pixelDiff(a, 2, 2, img(2, 3), 2, 3), 1, 'another size')
  assert.equal(pixelDiff(a, 2, 2, a.subarray(0, 8), 2, 2), 1, 'a short buffer')
  assert.equal(pixelDiff(new Uint8Array(), 0, 0, new Uint8Array(), 0, 0), 0)
  assert.equal(pixelDiff(a, 2, 2, b, 2, 2, 255), 0, 'tol: nothing moves past 255')
})
