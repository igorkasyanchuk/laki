// npm run debt -- --old (scripts/debt.ts): git blame --line-porcelain's output read into each line's author time, from a
// fixture (no git, no daemon: test:fast)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blameTimes, SECURITY } from '../scripts/debt.ts'

const block = (sha: string, orig: number, final: number, time: number, text: string, group = '') =>
  [`${sha} ${orig} ${final}${group}`, 'author A Tester', 'author-mail <a@example.com>', `author-time ${time}`, 'author-tz +0000', 'committer A Tester', `committer-time ${time + 5}`, 'committer-tz +0000', 'summary a commit', 'filename src/x.ts', `\t${text}`].join('\n')

test("blameTimes: each line's author time by its line now; an uncommitted one too; contents never read as a head", () => {
  const a = 'a'.repeat(40)
  const zero = '0'.repeat(40)
  const porcelain = [
    block(a, 10, 1, 1_700_000_000, '// ponytail: old', ' 2'),
    block(a, 11, 2, 1_700_000_000, `${'b'.repeat(40)} 1 9 author-time 5`), // a line that looks like a head, after its tab
    block(zero, 3, 3, 1_800_000_000, 'const x = 1 // ponytail: new'),
  ].join('\n')
  assert.deepEqual([...blameTimes(porcelain)], [[1, 1_700_000_000], [2, 1_700_000_000], [3, 1_800_000_000]])
  assert.deepEqual([...blameTimes('')], [])
  for (const f of ['src/daemon/main.ts', 'src/daemon/gates.ts', 'src/main/guards.ts']) assert.ok(SECURITY.has(f), f)
})
