// npm run test:changed: the tests for what changed (against origin/main, plus what isn't committed), run as
// npm run test:one runs them; none maps: test:fast. Picked: a changed test file; for a changed source file, every test
// that imports it, directly or through one source file it imports (never through test/helpers.ts: it reaches it all),
// and the tests whose name holds its basename. Not a CI: a local shortcut
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const isTest = (f: string) => /^test\/[^/]+\.test\.ts$/.test(f)
// a name's words (camelCase and kebab-case alike): widgetEvents.ts and widget-events.test.ts are both widget, events
const words = (f: string) => basename(f).replace(/\.(test\.)?tsx?$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[-_.]/)
const named = (test: string, f: string) => {
  const [t, w] = [words(test), words(f)]
  return t.some((_, i) => w.every((x, j) => t[i + j] === x))
}

// imports: a file's local imports (repo paths: test/x.test.ts, src/…) for each test and source file. Returns each test
// picked with why, in name order
export function pickTests(changed: string[], imports: Record<string, string[]>): { test: string; why: string[] }[] {
  const tests = Object.keys(imports).filter(isTest)
  const why = new Map<string, string[]>()
  const add = (t: string, w: string) => (why.get(t) ?? why.set(t, []).get(t)!).push(w)
  for (const f of changed) {
    if (isTest(f)) {
      if (f in imports) add(f, 'changed')
      continue
    }
    if (!/\.tsx?$/.test(f) || f.startsWith('test/')) continue
    for (const t of tests) {
      const direct = imports[t] ?? []
      if (direct.includes(f)) add(t, `imports ${f}`)
      else {
        const via = direct.find(d => !d.startsWith('test/') && imports[d]?.includes(f))
        if (via) add(t, `imports ${via}, which imports ${f}`)
      }
      if (named(t, f) && !why.get(t)?.some(w => w.endsWith(` ${f}`))) add(t, `named for ${f}`)
    }
  }
  return [...why].sort(([a], [b]) => a.localeCompare(b)).map(([test, w]) => ({ test, why: w }))
}

const IMPORT = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm

function importMap(root: string): Record<string, string[]> {
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(join(root, d))) {
      const p = join(d, f)
      if (statSync(join(root, p)).isDirectory()) f !== 'node_modules' && walk(p)
      else if (/\.tsx?$/.test(f)) files.push(p)
    }
  }
  walk('src')
  for (const f of readdirSync(join(root, 'test'))) if (/\.test\.ts$/.test(f)) files.push(`test/${f}`)
  const map: Record<string, string[]> = {}
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8')
    map[f] = [...text.matchAll(IMPORT)]
      .map(m => m[1] ?? m[2])
      .filter(s => s.startsWith('.'))
      .map(s => normalize(join(dirname(f), s)))
      .filter(p => existsSync(join(root, p)))
  }
  return map
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const git = (...a: string[]) => {
    try {
      return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return ''
    }
  }
  const base = git('rev-parse', '--verify', '-q', 'origin/main').trim() ? 'origin/main' : 'main'
  const changed = [...new Set([...git('diff', '--name-only', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(f => f && existsSync(join(root, f))))]
  const picks = pickTests(changed, importMap(root))
  if (!picks.length) {
    console.log(`${changed.length} changed against ${base}; no test maps to them: npm run test:fast`)
    process.exitCode = spawnSync('npm', ['run', 'test:fast'], { cwd: root, stdio: 'inherit' }).status ?? 1
    return
  }
  console.log(`${changed.length} changed against ${base}; ${picks.length} test file${picks.length === 1 ? '' : 's'}:`)
  for (const p of picks) console.log(`  ${p.test}: ${p.why.slice(0, 3).join('; ')}${p.why.length > 3 ? ` (+${p.why.length - 3})` : ''}`)
  process.exitCode = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', ...process.argv.slice(2), ...picks.map(p => p.test)], { cwd: root, stdio: 'inherit' }).status ?? 1 // test:one's runner; more args (--test-name-pattern=…) go to it
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
