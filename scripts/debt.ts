// npm run debt: the deliberate shortcuts (AGENTS.md: a `ponytail:` comment names its limit), every one in src with its
// file, line and words to the end of its comment (a // comment's next // lines too, a /* … */ to its end, a
// "(ponytail: …)" to its paren), by file, the most first. --json for tools
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type Debt = { line: number; text: string }

// a file's ponytail: comments, pure
export function debtOf(text: string): Debt[] {
  const lines = text.split('\n')
  const out: Debt[] = []
  lines.forEach((l, i) => {
    const at = l.indexOf('ponytail:')
    if (at < 0) return
    let t = l.slice(at + 'ponytail:'.length)
    const block = l.lastIndexOf('/*', at) > l.lastIndexOf('//', at)
    if (l[at - 1] === '(') {
      let depth = 1
      const end = [...t].findIndex(c => (c === '(' ? (depth++, false) : c === ')' ? --depth === 0 : false))
      if (end >= 0) t = t.slice(0, end)
    } else if (block) {
      for (let j = i + 1; !t.includes('*/') && j < lines.length; j++) t += ` ${lines[j].trim().replace(/^\*\s?/, '')}`
      t = t.slice(0, t.includes('*/') ? t.indexOf('*/') : undefined)
    } else for (let j = i + 1; j < lines.length && /^\s*\/\/(?!\s*ponytail:)/.test(lines[j]); j++) t += ` ${lines[j].trim().replace(/^\/\/\s?/, '')}`
    out.push({ line: i + 1, text: t.replace(/\s+/g, ' ').replace(/\s*\}?$/, '').trim() })
  })
  return out
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const byFile: { file: string; debts: Debt[] }[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|css|html|cjs|mjs|js)$/.test(f)) (debts => debts.length && byFile.push({ file: relative(root, p), debts }))(debtOf(readFileSync(p, 'utf8')))
    }
  }
  walk(join(root, 'src'))
  byFile.sort((a, b) => b.debts.length - a.debts.length || a.file.localeCompare(b.file))
  if (process.argv.includes('--json')) return console.log(JSON.stringify(byFile, null, 2))
  const n = byFile.reduce((s, f) => s + f.debts.length, 0)
  console.log(`${n} ponytail: shortcuts in ${byFile.length} files\n`)
  for (const f of byFile) {
    console.log(`${f.file} (${f.debts.length})`)
    for (const d of f.debts) console.log(`  ${String(d.line).padStart(5)}  ${d.text}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
