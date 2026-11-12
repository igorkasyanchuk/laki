// The numbers the docs state, kept true: AGENTS.md's API range and achievements count, docs/api-history.md's last entry,
// and the themes count in docs/features.md and docs/guide.md (no daemon: in test:fast)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
