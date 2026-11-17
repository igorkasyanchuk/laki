// The numbers the docs state, kept true: AGENTS.md's API range and achievements count, docs/api-history.md's last entry,
// and the themes count in docs/features.md and docs/guide.md (no daemon: in test:fast)
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { THEMES } from '../src/renderer/src/themes.ts'
import { ACHIEVEMENTS } from '../src/shared/achievements.ts'
import { API } from '../src/shared/types.ts'

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test("the docs' numbers: API's range and last entry, the achievements, the themes", () => {
  const agents = read('AGENTS.md')
  assert.equal(Number(/what each `API` number added, 1 to (\d+)/.exec(agents)?.[1]), API, 'AGENTS.md: "1 to N" is src/shared/types.ts API')
  const last = read('docs/api-history.md').trimEnd().split('\n').reverse().find(l => /^\d+: /.test(l))
  assert.equal(Number(last?.split(':')[0]), API, "docs/api-history.md's last entry is API")
  assert.equal(Number(/the achievements \((\d+)\)/.exec(agents)?.[1]), ACHIEVEMENTS.length, 'AGENTS.md: achievements (N)')
  const looks = THEMES.filter(t => t.look).length
  assert.match(read('docs/features.md'), new RegExp(`\\b${THEMES.length} themes, ${looks} of which`), 'docs/features.md: N themes, M of which change shapes')
  assert.match(read('docs/guide.md'), new RegExp(`\\b${THEMES.length} themes\\b`), 'docs/guide.md: N themes')
})

// type holes: ": any" and "as any" in src, counted with one regex, never above test/any-baseline.txt
test('no more any in src than test/any-baseline.txt', () => {
  const src = new URL('../src/', import.meta.url).pathname
  let n = 0
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f)) n += readFileSync(p, 'utf8').match(/:\s*any\b|\bas\s+any\b/g)?.length ?? 0
    }
  }
  walk(src)
  const base = Number(read('test/any-baseline.txt').trim())
  assert.ok(n <= base, `${n} ": any" or "as any" in src, the baseline ${base}: remove the any you added (a real type, unknown, a narrower one), or raise test/any-baseline.txt to ${n} on purpose in the same commit`)
})

// T14: a daemon call by a name made at run time (conn.ts rpcAny, the window's callAny) skips the typecheck's name and
// params: kept to the few that must, never above this ceiling (lower it as they go; raise it only on purpose)
const RPC_ANY_MAX = 10
test(`rpcAny and callAny: ${RPC_ANY_MAX} uses at most`, () => {
  const src = new URL('../src/', import.meta.url).pathname
  const own = new Set(['shared/conn.ts', 'renderer/src/api.ts', 'shared/api.ts']) // where they're made and said
  let n = 0
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f) && !own.has(p.slice(src.length))) n += readFileSync(p, 'utf8').match(/\b(rpcAny|callAny)\b/g)?.length ?? 0
    }
  }
  walk(src)
  assert.ok(n <= RPC_ANY_MAX, `${n} uses of rpcAny or callAny in src, the ceiling ${RPC_ANY_MAX}: call rpc or call by a name the typecheck knows, or raise RPC_ANY_MAX on purpose`)
})
