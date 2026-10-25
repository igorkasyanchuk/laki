// Review's Apply: a comment's ```suggestion block, what the review saw, and the lines put in the file (text.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applySuggestions, gapsOf, linesAt, reviewedLines, suggestionOf } from '../src/renderer/src/text.ts'

test('suggestion fences: backticks or tildes, 3 or more, CRLF, empty, unclosed, the text around it', () => {
  assert.deepEqual(suggestionOf('Rename it:\r\n```suggestion\r\nconst total = 1\r\n```\r\nthanks'), { lines: ['const total = 1'], rest: 'Rename it:\nthanks' })
  assert.deepEqual(suggestionOf('~~~~ suggestion\na\n~~~\n  b\n~~~~'), { lines: ['a', '~~~', '  b'], rest: '' }) // a shorter fence is a line of it
  assert.deepEqual(suggestionOf('```suggestion\n```'), { lines: [], rest: '' }) // deletes the lines
  assert.deepEqual(suggestionOf('```suggestion\n\n```'), { lines: [''], rest: '' }) // one empty line
  assert.deepEqual(suggestionOf('  ```suggestion\n    x\n  ```'), { lines: ['  x'], rest: '' }) // the fence's indent off
  assert.deepEqual(suggestionOf('```suggestion\na\nb'), { lines: ['a', 'b'], rest: '' })
  assert.equal(suggestionOf('```ts\nx\n```'), null)
  assert.equal(suggestionOf('```suggestions\nx\n```'), null)
  assert.equal(suggestionOf('> ```suggestion\n> x\n> ```'), null) // a quote of one
  assert.equal(suggestionOf('    ```suggestion\nx\n```'), null) // indented code
  assert.equal(suggestionOf('``suggestion\nx\n``'), null)
})

test('what the review saw: the new side of the hunk, ending at the line', () => {
  const hunk = '@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\r\n\\ No newline at end of file\n'
  assert.deepEqual(reviewedLines(hunk, 1), ['c'])
  assert.deepEqual(reviewedLines(hunk, 3), ['a', 'B', 'c'])
  assert.equal(reviewedLines(hunk, 4), null)
  assert.equal(reviewedLines(hunk, 0), null)
})

test('suggestions put in: bottom-up, the line endings kept, refused when the lines moved', () => {
  const s = (start: number, end: number, seen: string[], lines: string[]) => ({ start, end, seen, lines })
  assert.equal(applySuggestions('a\nb\nc\n', [s(2, 2, ['b'], ['B1', 'B2'])]), 'a\nB1\nB2\nc\n')
  assert.equal(applySuggestions('a\r\nb\r\nc\r\n', [s(1, 2, ['a', 'b'], ['x'])]), 'x\r\nc\r\n')
  assert.equal(applySuggestions('a\r\nb', [s(2, 2, ['b'], ['y', 'z'])]), 'a\r\ny\r\nz') // the last line had no newline: still none
  assert.equal(applySuggestions('a\nb', [s(2, 2, ['b'], [])]), 'a') // deleted, and no newline at the end as before
  assert.equal(applySuggestions('a\nb\nc\n', [s(2, 2, ['b'], [])]), 'a\nc\n')
  assert.equal(applySuggestions('a\nb\n', [s(1, 2, ['a', 'b'], [])]), '')
  // two at once, either order: the lower one first, so the upper one's numbers hold
  assert.equal(applySuggestions('1\n2\n3\n4\n', [s(1, 1, ['1'], ['one', 'uno']), s(3, 4, ['3', '4'], ['34'])]), 'one\nuno\n2\n34\n')
  assert.throws(() => applySuggestions('a\nb\n', [s(1, 2, ['a', 'b'], ['x']), s(2, 2, ['b'], ['y'])]), /same lines/)
  assert.throws(() => applySuggestions('a\nB\n', [s(2, 2, ['b'], ['x'])]), /changed since the review/)
  assert.throws(() => applySuggestions('a\n', [s(2, 2, ['b'], ['x'])]), /changed since the review/)
  assert.throws(() => applySuggestions('a\n', [s(1, 1, ['a', ''], ['x'])]), /changed since the review/)
  assert.deepEqual(linesAt('a\r\nb\nc', 2, 3), ['b', 'c'])
})

test("the full review's expand: the unchanged lines before each hunk and after the last, with the old file's numbers", () => {
  // a change at 15 (+2), a line taken out after 40, a new file's whole
  assert.deepEqual(gapsOf(['@@ -15,6 +15,8 @@ Rails.application.routes.draw do', '@@ -40,2 +42,1 @@'], 60), [
    { from: 1, to: 14, shift: 0 },
    { from: 23, to: 41, shift: -2 },
    { from: 43, to: 60, shift: -1 },
  ])
  assert.deepEqual(gapsOf(['@@ -5,2 +4,0 @@'], 10), [{ from: 1, to: 4, shift: 0 }, { from: 5, to: 10, shift: 2 }]) // only taken out: after line 4
  assert.deepEqual(gapsOf(['@@ -3,0 +4,2 @@'], 8), [{ from: 1, to: 3, shift: 0 }, { from: 6, to: 8, shift: -2 }]) // only added
  assert.deepEqual(gapsOf(['@@ -0,0 +1,6 @@'], 6), [{ from: 1, to: 0, shift: 0 }, { from: 7, to: 6, shift: -6 }]) // a new file: nothing around
  assert.deepEqual(gapsOf(['@@ -1 +1 @@'], Infinity), [{ from: 1, to: 0, shift: 0 }, { from: 2, to: Infinity, shift: 0 }])
})
