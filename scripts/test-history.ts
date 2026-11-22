// node --test's reporter beside spec (npm test, npm run test:one): as each test file ends, a JSON line in
// .test-history.jsonl (gitignored): date, the git sha, the file, its time, pass or fail, its failed tests' names, the
// SLOW multiplier (test/helpers.ts' way) and the load average as it began; the newest HISTORY_MAX lines kept. At the
// run's end two lines: its slowest file, and any that failed now but passed on this sha before (likely flaky).
// npm run test:report reads it (scripts/test-report.ts)
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { join, relative } from 'node:path'
import { capped, HISTORY, parse, type Run, runEnd } from './test-report.ts'

type Ev = { type: string; data: { file?: string; name?: string; nesting?: number; duration_ms?: number; success?: boolean } }
const at = join(process.cwd(), HISTORY)
const read = () => {
  try {
    return readFileSync(at, 'utf8')
  } catch {
    return ''
  }
}
const cap = () => {
  const lines = read().split('\n').filter(Boolean)
  if (lines.length > capped(lines).length) writeFileSync(at, `${capped(lines).join('\n')}\n`)
}
// a run of some tests only (a name pattern, --test-only): not the file's time, so not kept
const part = process.argv.some(a => /^--test-(name-pattern|skip-pattern|only)\b/.test(a)) || process.execArgv.some(a => /^--test-(name-pattern|skip-pattern|only)\b/.test(a))
export default async function* history(source: AsyncIterable<Ev>) {
  const sha = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    } catch {
      return '?'
    }
  })()
  cap()
  // uncommitted changes (a tracked file's, a new file under src, test or scripts): the sha isn't what ran (test-report.ts
  // leaves such runs out of the flaky list)
  const dirty = (() => {
    try {
      return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).split('\n').some(l => (l && !l.startsWith('??')) || /^\?\? "?(src|test|scripts)\//.test(l))
    } catch {
      return false
    }
  })()
  const before = parse(read())
  const slow = () => Number(process.env.LAKI_TEST_SLOW) || Math.max(1, Math.min(3, Math.round(loadavg()[0] / cpus().length)))
  const began = new Map<string, { load: number; slow: number }>()
  const failed = new Map<string, Set<string>>()
  const now: Run[] = []
  for await (const e of source) {
    const f = e.data?.file
    if (!f) {
      if (e.type === 'test:summary') yield `${runEnd(now, before).join('\n')}${now.length ? '\n' : ''}`
      continue
    }
    const file = relative(process.cwd(), f)
    if (!began.has(file)) began.set(file, { load: Math.round(loadavg()[0] * 100) / 100, slow: slow() })
    if (e.type === 'test:fail' && e.data.name) (failed.get(file) ?? failed.set(file, new Set()).get(file)!).add(e.data.name)
    if (e.type !== 'test:summary') continue
    const r: Run = { date: new Date().toISOString(), sha, ...(dirty && { dirty: true }), file, ms: Math.round(e.data.duration_ms ?? 0), pass: e.data.success === true, ...(failed.get(file)?.size && { failed: [...failed.get(file)!] }), slow: began.get(file)!.slow, load: began.get(file)!.load, ...(process.env.LAKI_TEST_RERUN === '1' && { rerun: true }) } // rerun: test-rerun.ts' second try of a file
    now.push(r)
    if (!part)
      try {
        appendFileSync(at, `${JSON.stringify(r)}\n`)
      } catch {}
  }
  cap()
}
