// docs/trust.md (M3) lists every https host Laki's source names: one added to src/ without a line there fails here,
// so the page can't go stale without anyone noticing.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..')
const HOST = /https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi

function hostsIn(dir: string, out = new Map<string, string>()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) hostsIn(p, out)
    else {
      const text = readFileSync(p)
      if (text.includes(0)) continue // a font, a picture: not text
      for (const m of text.toString('utf8').matchAll(HOST)) if (!out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), p.slice(root.length + 1))
    }
  }
  return out
}

test('trust: every https host in src/ is on docs/trust.md', () => {
  const page = readFileSync(join(root, 'docs/trust.md'), 'utf8').toLowerCase()
  const found = hostsIn(join(root, 'src'))
  assert.ok(found.size > 20, `${found.size} hosts? the scan found too few`)
  const missing = [...found].filter(([h]) => !page.includes(`\`${h}\``)).map(([h, f]) => `${h} (${f})`)
  assert.deepEqual(missing, [], 'add each to docs/trust.md: where it goes, what is sent, when, how to turn it off (or that Laki never contacts it)')
})

test('trust: README, SECURITY.md and About link to it', () => {
  for (const [f, link] of [['README.md', '(docs/trust.md)'], ['SECURITY.md', '(docs/trust.md)'], ['src/renderer/src/panels.tsx', 'docs/trust.md']]) assert.ok(readFileSync(join(root, f), 'utf8').includes(link), `${f} links to docs/trust.md`)
})
