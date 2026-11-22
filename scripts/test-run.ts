// npm test: every test file, 4 at a time, the longest first (test-order.ts), through node:test's run(), which keeps
// the order it's given (node --test sorts its files by name); the spec reporter and test-history.ts' on stdout, as
// the CLI's flags gave them. Files named: those only, in that order. Exit 1 on a failure
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { run } from 'node:test'
import { spec } from 'node:test/reporters'
import history from './test-history.ts'
import { order } from './test-order.ts'
import { HISTORY, parse } from './test-report.ts'

const named = process.argv.slice(2)
const all = readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`)
const files = named.length ? named : order(all, existsSync(HISTORY) ? parse(readFileSync(HISTORY, 'utf8')) : [])
const s = run({ files: files.map(f => resolve(f)), concurrency: 4, execArgv: ['--experimental-strip-types', '--no-warnings'] })
s.on('test:fail', () => (process.exitCode = 1))
s.compose(spec).pipe(process.stdout)
s.compose(history).pipe(process.stdout)
