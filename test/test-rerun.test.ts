// npm run test:release (scripts/test-rerun.ts): which files of a run go again alone, from .test-history.jsonl's lines,
// and test:report counting a rerun that passed as flaky. No daemon: test:fast
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toRerun } from '../scripts/test-rerun.ts'
import { parse, report, reportText } from '../scripts/test-report.ts'

const line = (o: object) => JSON.stringify({ ms: 1000, slow: 1, load: 1, ...o })
const history = [
  line({ date: '2026-11-19T09:00:00.000Z', sha: 'abc', file: 'test/pr.test.ts', pass: false }), // before this run
  line({ date: '2026-11-19T10:00:01.000Z', sha: 'old', file: 'test/api.test.ts', pass: false }), // another sha
  line({ date: '2026-11-19T10:00:02.000Z', sha: 'abc', file: 'test/cli.test.ts', pass: true }),
  line({ date: '2026-11-19T10:00:03.000Z', sha: 'abc', file: 'test/widget-events.test.ts', pass: false, failed: ['a PR checks wait'] }),
  'not json',
  line({ date: '2026-11-19T10:00:04.000Z', sha: 'abc', file: 'test/core-b.test.ts', pass: false }),
  line({ date: '2026-11-19T10:00:05.000Z', sha: 'abc', file: 'test/widget-events.test.ts', pass: false }), // twice: once in the list
  line({ date: '2026-11-19T10:00:06.000Z', sha: 'abc', file: 'test/shells.test.ts', pass: false, rerun: true }), // a rerun's own
].join('\n')

test("toRerun: this run's failed files (its sha, since it began), each once, not a rerun's", () => {
  assert.deepEqual(toRerun(parse(history), 'abc', '2026-11-19T10:00:00.000Z'), ['test/widget-events.test.ts', 'test/core-b.test.ts'])
  assert.deepEqual(toRerun(parse(history), 'abc', '2026-11-19T11:00:00.000Z'), [], 'none since then')
  assert.deepEqual(toRerun([], 'abc', ''), [])
})

test("test:report: a file a release's rerun passed is flaky, with how often", () => {
  const runs = parse([history, line({ date: '2026-11-19T10:01:00.000Z', sha: 'abc', file: 'test/core-b.test.ts', pass: true, rerun: true })].join('\n'))
  const f = report(runs).flaky.find(x => x.file === 'test/core-b.test.ts')
  assert.equal(f?.reruns, 1)
  assert.match(reportText(report(runs)), /core-b\.test\.ts: .*passed alone after a release's run 1×/)
})
