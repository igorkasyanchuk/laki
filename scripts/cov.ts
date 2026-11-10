// npm run test:cov [-- test/x.test.ts …]: the tests (all, or the files named) with node's coverage of src/daemon and
// src/shared, then the 10 least-covered files. The daemons the tests start count too: NODE_V8_COVERAGE, which the
// runner sets, reaches them, and each writes its coverage as it exits (one killed doesn't). Not a gate (E3).
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

const named = process.argv.slice(2)
const files = named.length ? named : readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`)
mkdirSync('dist', { recursive: true })
const lcov = 'dist/coverage.lcov'
const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', '--test-concurrency=4', '--experimental-test-coverage', '--test-coverage-include=src/daemon/**', '--test-coverage-include=src/shared/**', '--test-reporter=dot', '--test-reporter-destination=stdout', '--test-reporter=lcov', `--test-reporter-destination=${lcov}`, ...files], { stdio: 'inherit' })
const rows = readFileSync(lcov, 'utf8')
  .split('end_of_record')
  .map(rec => ({ file: /^SF:(.+)$/m.exec(rec)?.[1], found: Number(/^LF:(\d+)$/m.exec(rec)?.[1] ?? 0), hit: Number(/^LH:(\d+)$/m.exec(rec)?.[1] ?? 0) }))
  .filter(x => x.file && x.found)
const all = rows.reduce((a, x) => ({ found: a.found + x.found, hit: a.hit + x.hit }), { found: 0, hit: 0 })
console.log(`\nlines covered: ${((100 * all.hit) / all.found).toFixed(1)}% of ${all.found} in ${rows.length} files (${lcov})\nleast covered:`)
for (const x of rows.sort((a, b) => a.hit / a.found - b.hit / b.found).slice(0, 10)) console.log(`  ${((100 * x.hit) / x.found).toFixed(1).padStart(5)}%  ${String(x.found - x.hit).padStart(5)} lines not run  ${relative(process.cwd(), x.file!)}`)
process.exit(r.status ?? 1)
