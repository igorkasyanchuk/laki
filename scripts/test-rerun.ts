// npm run test:release (scripts/release.sh's): npm test, then each test file that failed in it run once more, alone
// (npm run test:one, one after another): a file that fails under a full run's load and passes alone doesn't stop a
// release. Exit 0 only when every rerun passes, with "flaky: <file>" for each; the ones that failed twice are listed and
// it exits 1. A rerun's line in .test-history.jsonl says rerun: true (test-history.ts), which test:report counts
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HISTORY, parse, type Run } from './test-report.ts'

// the files to run again: this run's that failed (its sha, ended since it began; not a rerun's), each once
export const toRerun = (runs: Run[], sha: string, since: string) => [...new Set(runs.filter(r => r.sha === sha && r.date >= since && !r.pass && !r.rerun).map(r => r.file))]

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() // test-history.ts' own
    } catch {
      return '?'
    }
  })()
  const since = new Date().toISOString()
  if (spawnSync('npm', ['test'], { stdio: 'inherit' }).status === 0) process.exit(0)
  let text = ''
  try {
    text = readFileSync(join(process.cwd(), HISTORY), 'utf8')
  } catch {}
  const files = toRerun(parse(text), sha, since)
  if (!files.length) {
    console.error('\nnpm test failed, and no test file in .test-history.jsonl says it did: nothing to run again')
    process.exit(1)
  }
  const flaky: string[] = []
  const twice: string[] = []
  for (const f of files) {
    console.log(`\n${f} failed: once more, alone`)
    const ok = spawnSync('npm', ['run', 'test:one', '--', f], { stdio: 'inherit', env: { ...process.env, LAKI_TEST_RERUN: '1' } }).status === 0
    ;(ok ? flaky : twice).push(f)
  }
  console.log('')
  for (const f of flaky) console.log(`flaky: ${f}`)
  if (twice.length) console.error(`failed twice: ${twice.join(' ')}`)
  process.exit(twice.length ? 1 : 0)
}
