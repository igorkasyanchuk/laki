// npm test's file order: the longest first, so the slow ones don't start last and become the run's tail. A file with
// no history (new, renamed) goes first of all, as it may be long; the rest by their median over the last 20 runs in
// .test-history.jsonl (scripts/test-report.ts' parse and median), longest first, ties by name. No history at all: name
// order. Run alone, it prints the paths, one a line. npm test (test-run.ts) runs them through node:test's run(), which
// keeps that order; node --test sorts its files by name (test/test-order.test.ts tests order())
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { HISTORY, median, parse, type Run } from './test-report.ts'

export function order(files: string[], runs: Run[], last = 20): string[] {
  const by = new Map<string, number[]>()
  for (const r of runs) (by.get(r.file) ?? by.set(r.file, []).get(r.file)!).push(r.ms)
  const med = (f: string) => (ms => (ms ? median(ms.slice(-last)) : undefined))(by.get(f))
  return [...files].sort((a, b) => {
    const [x, y] = [med(a), med(b)]
    if (x === undefined || y === undefined) return x === y ? a.localeCompare(b) : x === undefined ? -1 : 1
    return y - x || a.localeCompare(b)
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`)
  const runs = existsSync(HISTORY) ? parse(readFileSync(HISTORY, 'utf8')) : []
  console.log(order(files, runs).join('\n'))
}
