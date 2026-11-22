// npm run test:report: what .test-history.jsonl says (scripts/test-history.ts writes it, a line per test file run by
// npm test and npm run test:one): the ten slowest files by their median over the last 20 runs (over 60 s flagged), and
// the flaky ones: a file (and its tests) that both passed and failed on one git sha, or failed in fewer than a third of
// its last 20 runs, with counts. --json for tools. Local only: no CI
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type Run = { date: string; sha: string; file: string; ms: number; pass: boolean; failed?: string[]; slow?: number; load?: number; rerun?: boolean; dirty?: boolean } // rerun: npm run test:release's second try, alone (test-rerun.ts)
export const HISTORY = '.test-history.jsonl'
export const HISTORY_MAX = 5000
const LAST = 20
export const parse = (text: string): Run[] =>
  text.split('\n').flatMap(l => {
    try {
      const j = l.trim() ? JSON.parse(l) : null
      return j && typeof j.file === 'string' && typeof j.ms === 'number' && typeof j.pass === 'boolean' ? [j as Run] : []
    } catch {
      return []
    }
  })
// the newest max lines of the history
export const capped = (lines: string[], max = HISTORY_MAX) => (lines.length > max ? lines.slice(-max) : lines)
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return !n ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}
export type Report = {
  slow: { file: string; median: number; runs: number; over: boolean }[]
  flaky: { file: string; runs: number; fails: number; shas?: string[]; reruns?: number; tests: { name: string; fails: number; sameSha?: boolean }[] }[] // reruns: how often a release's rerun (test:release) passed it
}
export function report(runs: Run[], last = LAST): Report {
  const by = new Map<string, Run[]>()
  for (const r of runs) (by.get(r.file) ?? by.set(r.file, []).get(r.file)!).push(r)
  const slow = [...by]
    .map(([file, rs]) => (recent => ({ file, median: Math.round(median(recent.map(r => r.ms))), runs: recent.length, over: median(recent.map(r => r.ms)) > 60_000 }))(rs.slice(-last)))
    .sort((a, b) => b.median - a.median || a.file.localeCompare(b.file))
    .slice(0, 10)
  const flaky: Report['flaky'] = []
  for (const [file, all] of by) {
    const rs = all.filter(r => !r.dirty) // a run on uncommitted changes: its sha isn't the code that ran, so it says nothing of flakiness
    const recent = rs.slice(-last)
    const fails = recent.filter(r => !r.pass).length
    const reruns = recent.filter(r => r.rerun && r.pass).length
    const onSha = (sha: string) => rs.filter(r => r.sha === sha)
    const shas = [...new Set(rs.map(r => r.sha))].filter(sha => onSha(sha).some(r => r.pass) && onSha(sha).some(r => !r.pass))
    if (!shas.length && !reruns && !(fails > 0 && fails < recent.length / 3)) continue
    const names = new Map<string, number>()
    for (const r of recent) for (const n of new Set(r.failed ?? [])) names.set(n, (names.get(n) ?? 0) + 1)
    // a test that failed in one run of a sha and not in another of it
    const sameSha = (name: string) => [...new Set(rs.map(r => r.sha))].some(sha => onSha(sha).some(r => r.failed?.includes(name)) && onSha(sha).some(r => !r.failed?.includes(name)))
    flaky.push({ file, runs: recent.length, fails, ...(shas.length && { shas }), ...(reruns && { reruns }), tests: [...names].map(([name, n]) => ({ name, fails: n, ...(sameSha(name) && { sameSha: true }) })).sort((a, b) => b.fails - a.fails || a.name.localeCompare(b.name)) })
  }
  return { slow, flaky: flaky.sort((a, b) => b.fails - a.fails || a.file.localeCompare(b.file)) }
}
// the two lines npm test ends with: this run's slowest file, and each that failed now but passed on this sha before
export function runEnd(now: Run[], before: Run[]) {
  const top = [...now].sort((a, b) => b.ms - a.ms)[0]
  const flaky = now.filter(r => !r.pass && before.some(b => b.file === r.file && b.sha === r.sha && b.pass)).map(r => r.file)
  return [...(top ? [`slowest file: ${top.file} (${(top.ms / 1000).toFixed(1)} s)`] : []), ...(flaky.length ? [`likely flaky: re-run with npm run test:one -- ${flaky.join(' ')}`] : [])]
}
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`
export function reportText(r: Report) {
  return [
    'Slowest files (median of the last 20 runs):',
    ...(r.slow.length ? r.slow.map(x => `  ${s(x.median).padStart(8)}  ${x.file}${x.over ? '  over 60 s: split it by topic' : ''}  (${x.runs} run${x.runs === 1 ? '' : 's'})`) : ['  none yet: npm test writes the history']),
    '',
    'Flaky:',
    ...(r.flaky.length ? r.flaky.flatMap(f => [`  ${f.file}: failed ${f.fails} of its last ${f.runs}${f.shas ? `; passed and failed on ${f.shas.join(', ')}` : ''}${f.reruns ? `; passed alone after a release's run ${f.reruns}×` : ''}`, ...f.tests.map(t => `    ${t.fails}×  ${t.name}${t.sameSha ? '  (passed and failed on one sha)' : ''}`)]) : ['  none']),
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let text = ''
  try {
    text = readFileSync(join(process.cwd(), HISTORY), 'utf8')
  } catch {}
  const r = report(parse(text))
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) : reportText(r))
}
