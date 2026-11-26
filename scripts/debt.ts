// npm run debt: the deliberate shortcuts (AGENTS.md: a `ponytail:` comment names its limit), every one in src with its
// file, line and words to the end of its comment (a // comment's next // lines too, a /* … */ to its end, a
// "(ponytail: …)" to its paren), by file, the most first. --json for tools. --old: every one by its age, the oldest first
// (one git blame per file), the security files' marked security (scripts/dmg.sh prints the three oldest of those)
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type Debt = { line: number; text: string }
// the files whose shortcuts are security's: the daemon's gates and remote access, its secrets, main's checks
export const SECURITY = new Set(['src/daemon/envKeys.ts', 'src/daemon/main.ts', 'src/daemon/gates.ts', 'src/daemon/e2e.ts', 'src/daemon/remote.ts', 'src/daemon/clients.ts', 'src/daemon/secrets.ts', 'src/daemon/netProxy.ts', 'src/daemon/netAddr.ts', 'src/shared/wrap.ts', 'src/main/guards.ts', 'src/daemon/keychain.ts', 'src/daemon/inbound.ts', 'src/daemon/widgetTrust.ts', 'src/daemon/dataBackup.ts', 'src/ptyhost/main.ts', 'src/daemon/telegram.ts', 'src/shared/artHosts.ts', 'src/shared/pins.ts', 'src/main/back.ts', 'src/shared/artPick.ts', 'src/daemon/cap.ts'])

// git blame --line-porcelain's output: each line's author time (s), by its line in the file now. Pure
export function blameTimes(porcelain: string): Map<number, number> {
  const at = new Map<number, number>()
  let line = 0
  for (const l of porcelain.split('\n')) {
    const head = /^[0-9a-f]{40} \d+ (\d+)/.exec(l)
    if (head) line = Number(head[1])
    else if (l.startsWith('author-time ') && line) at.set(line, Number(l.slice(12)))
  }
  return at
}

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
  if (process.argv.includes('--old')) return old(root, byFile)
  if (process.argv.includes('--json')) return console.log(JSON.stringify(byFile.map(f => ({ ...f, ...(SECURITY.has(f.file) && { security: true }) })), null, 2))
  const n = byFile.reduce((s, f) => s + f.debts.length, 0)
  console.log(`${n} ponytail: shortcuts in ${byFile.length} files\n`)
  for (const f of byFile) {
    console.log(`${f.file} (${f.debts.length})`)
    for (const d of f.debts) console.log(`  ${String(d.line).padStart(5)}  ${d.text}`)
  }
}

// --old: each with its age in days (an uncommitted line: 0), the oldest first
function old(root: string, byFile: { file: string; debts: Debt[] }[]) {
  const now = Date.now() / 1000
  const all = byFile.flatMap(f => {
    let times = new Map<number, number>()
    try {
      times = blameTimes(execFileSync('git', ['blame', '--line-porcelain', '--', f.file], { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 }))
    } catch {}
    return f.debts.map(d => ({ file: f.file, ...d, days: Math.max(0, Math.floor((now - (times.get(d.line) ?? now)) / 86400)), ...(SECURITY.has(f.file) && { security: true }) }))
  })
  all.sort((a, b) => b.days - a.days || a.file.localeCompare(b.file) || a.line - b.line)
  if (process.argv.includes('--json')) return console.log(JSON.stringify(all, null, 2))
  for (const d of all) console.log(`${`${d.days}d`.padStart(6)}  ${`${d.file}:${d.line}`}${d.security ? '  security' : ''}  ${d.text.slice(0, 100)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
