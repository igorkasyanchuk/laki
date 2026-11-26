// An agent failing the same command (shared/loop.ts): 3 in a row or 5 in a turn, with the same error; a success of it
// forgets; another error is another failure; the command and error normalized
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loopCmd, loopFeed, loopNew } from '../src/shared/loop.ts'

const fail = (command: string, error = 'Exit code 1\n2 failing') => ({ tool: 'Bash', command, ok: false, error })
const ok = (command: string) => ({ tool: 'Bash', command, ok: true })

test('loop: three in a row', () => {
  const s = loopNew()
  assert.equal(loopFeed(s, fail('npm test')), undefined)
  assert.equal(loopFeed(s, fail('npm test')), undefined)
  assert.deepEqual(loopFeed(s, fail('npm test')), { cmd: 'npm test', n: 3 })
  assert.deepEqual(loopFeed(s, fail('npm test')), { cmd: 'npm test', n: 4 }, 'it goes on counting')
})

test('loop: five scattered in one turn', () => {
  const s = loopNew()
  for (let i = 1; i <= 4; i++) {
    assert.equal(loopFeed(s, fail('npm test')), undefined, `failure ${i}`)
    assert.equal(loopFeed(s, ok('git status')), undefined) // another command between: not in a row
  }
  assert.deepEqual(loopFeed(s, fail('npm test')), { cmd: 'npm test', n: 5 })
})

test('loop: a success of that command forgets its failures', () => {
  const s = loopNew()
  loopFeed(s, fail('npm test'))
  loopFeed(s, fail('npm test'))
  loopFeed(s, ok('npm test'))
  assert.equal(loopFeed(s, fail('npm test')), undefined)
  assert.equal(loopFeed(s, fail('npm test')), undefined)
  assert.deepEqual(loopFeed(s, fail('npm test')), { cmd: 'npm test', n: 3 })
})

test('loop: a different error is a different failure', () => {
  const s = loopNew()
  loopFeed(s, fail('npm test', 'Exit code 1\n3 failing'))
  loopFeed(s, fail('npm test', 'Exit code 1\n2 failing'))
  assert.equal(loopFeed(s, fail('npm test', 'Exit code 1\n1 failing')), undefined, 'progress: not a loop')
  // only the first 200 characters of the error count
  const long = (tail: string) => `${'x'.repeat(200)}${tail}`
  const t = loopNew()
  loopFeed(t, fail('make', long('a')))
  loopFeed(t, fail('make', long('b')))
  assert.deepEqual(loopFeed(t, fail('make', long('c'))), { cmd: 'make', n: 3 })
})

test('loop: the command normalized', () => {
  assert.equal(loopCmd('  npm   test\n  -- --watch=false '), 'npm test -- --watch=false')
  assert.equal(loopCmd('cd /Users/me/app && npm test'), 'npm test')
  assert.equal(loopCmd(`cd '/Users/me/my app' && npm test`), 'npm test')
  assert.equal(loopCmd('cat /tmp/out-4821.log /var/folders/ab/T/x12/y'), 'cat /tmp/out-#.log /var/folders/ab/T/x#/y')
  assert.equal(loopCmd('sleep 30'), 'sleep 30', 'numbers outside temp paths stay')
  const s = loopNew()
  loopFeed(s, fail('cd /a && npm  test', 'in /tmp/t-1/x'))
  loopFeed(s, fail('npm test', 'in /tmp/t-22/x'))
  assert.deepEqual(loopFeed(s, fail('cd /b && npm test', 'in /tmp/t-333/x')), { cmd: 'npm test', n: 3 })
})
