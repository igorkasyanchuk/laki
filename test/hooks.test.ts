// React's rules of hooks, the one that crashed a fresh install (0.49: NewWorkspace's model list came after its "no
// project yet" return, and the sample project arriving added a hook: "Rendered more hooks than during the previous
// render"): no component of the renderer calls a hook after one of its early returns. ponytail: by the source's
// shape (a component's top level is two spaces in, as prettier writes it), not a parser
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../src/renderer/src/', import.meta.url)

test('hooks: no component calls a hook after an early return', () => {
  const bad: string[] = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.tsx'))) {
    const lines = readFileSync(new URL(f, dir), 'utf8').split('\n')
    let name = ''
    let early = 0
    lines.forEach((l, i) => {
      const m = /^(?:export )?function ([A-Z]\w*)\(/.exec(l)
      if (m) (name = m[1]), (early = 0)
      else if (/^}/.test(l)) name = ''
      if (!name) return
      if (/^ {2}if \(.*\)/.test(l) && (/\breturn\b/.test(l) || /^\s*return\b/.test(lines[i + 1] ?? ''))) early ||= i + 1
      else if (early && /^ {2}(?:const [^=]+= )?use[A-Z]\w*[<(]/.test(l)) bad.push(`${f}:${i + 1} ${name}: a hook after the return at line ${early}`)
    })
  }
  assert.deepEqual(bad, [])
})
