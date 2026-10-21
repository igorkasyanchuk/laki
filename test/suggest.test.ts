// Review's Apply: a comment's ```suggestion block, what the review saw, and the lines put in the file (text.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applySuggestions, linesAt, reviewedLines, suggestionOf } from '../src/renderer/src/text.ts'

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
