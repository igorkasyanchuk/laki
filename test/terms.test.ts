// U9: one word per thing (docs/glossary.md): Help's and Settings' words carry none of the retired ones
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { FIND, HELP, SECTIONS } from '../src/shared/settingsMap.ts'

// the retired words, each with what replaced it; a CLI flag (--preset) is the CLI's, not a word
const RETIRED: [RegExp, string][] = [
  [/rail['’]s Flows/, 'Workflows'],
  [/\bplugins?\b/i, 'Extension'],
  [/(?<!--)\bpresets?\b/i, 'Agent or Profile'],
  [/\b(right|info) panel\b/i, 'Side panel'],
  [/\bthe Desk\b/, 'My Desk'],
]
const said = (where: string, text: string) => {
  for (const [re, use] of RETIRED) assert.ok(!re.test(text), `${where}: ${JSON.stringify(text.match(re)?.[0])}, say ${use} (docs/glossary.md)`)
}

test("terms: Settings' sections, titles and help say none of the retired words", () => {
  for (const s of SECTIONS) said(`section ${s.id}`, s.label)
  for (const f of FIND) said(`setting ${f[0]} › ${f[1]}`, f[1])
  for (const [k, h] of Object.entries(HELP)) for (const v of Object.values(h)) said(`help ${k}`, v)
})

test('terms: Help says none of them either', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/renderer/src/Help.tsx'), 'utf8')
  for (const [i, l] of src.split('\n').entries()) if (!/^\s*\/\//.test(l)) said(`Help.tsx:${i + 1}`, l)
})

test('terms: laki ext is laki widget, --race is --fan', () => {
  const run = (...a: string[]) => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(import.meta.dirname, '../src/cli/main.ts'), ...a], { encoding: 'utf8', env: { ...process.env, LAKI_HOME: '/nonexistent-laki-home' } })
  assert.equal(run('help', 'ext'), run('help', 'widget'))
  assert.match(run('help', 'new'), /--race claude,codex/)
})
