// npm run audit:deps (docs/release.md): npm audit of what ships (production dependencies: the app's and the daemon's),
// a line per advisory; a high or critical one fails unless scripts/audit-allow.json allows it (each entry until a
// date: past it, it no longer does and is named). Then the build tools' (the dev dependencies): high and critical ones
// as warnings only. The network or the registry failing: a warning, exit 0, unless LAKI_AUDIT_STRICT=1 (release.sh).
// No dependency: npm's own JSON, parsed here. auditOf is pure (test/release.test.ts).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type Allow = { id: string; package: string; reason: string; until: string }
export type Finding = { id: string; package: string; installed?: string; severity: string; title?: string; fixed: string }
type Via = { source?: number; name?: string; title?: string; url?: string; severity?: string } | string
type Vuln = { name?: string; severity?: string; via?: Via[]; nodes?: string[]; fixAvailable?: boolean | { name: string; version: string } }
export type NpmAudit = { vulnerabilities?: Record<string, Vuln>; message?: string; error?: { code?: string; summary?: string; detail?: string } }

const BAD = new Set(['high', 'critical'])
// each advisory npm names (a via that's an object: the package itself is vulnerable; a string is a dependency's, listed
// under its own name), with its GHSA id when it has one
export function findings(j: NpmAudit, installed: (node: string) => string | undefined = () => undefined): Finding[] {
  const out: Finding[] = []
  for (const [name, v] of Object.entries(j.vulnerabilities ?? {}))
    for (const a of v.via ?? []) {
      if (typeof a === 'string') continue
      const fix = v.fixAvailable
      out.push({
        id: /GHSA-[\w-]+/.exec(a.url ?? '')?.[0] ?? String(a.source ?? '?'),
        package: a.name ?? name,
        installed: v.nodes?.[0] ? installed(v.nodes[0]) : undefined,
        severity: a.severity ?? v.severity ?? 'unknown',
        title: a.title,
        fixed: fix === true ? 'npm audit fix' : fix ? `${fix.name}@${fix.version}${fix.name === name ? '' : ` (${name} with it)`}` : 'none yet',
      })
    }
  return out
}

// what fails a release: a high or critical production finding no current entry allows; an entry past its date allows
// nothing and is named (expired); the rest warn
export function auditOf(prod: NpmAudit, allow: Allow[], now = Date.now(), installed?: (node: string) => string | undefined) {
  const expired = allow.filter(a => !(Date.parse(a.until) >= now)) // a date that doesn't parse: expired too
  const ok = allow.filter(a => !expired.includes(a))
  const fail: Finding[] = []
  const warn: Finding[] = []
  for (const f of findings(prod, installed)) (BAD.has(f.severity) && !ok.some(a => a.id === f.id && a.package === f.package) ? fail : warn).push(f)
  return { fail, warn, expired }
}

export const lineOf = (f: Finding) => `${f.package}@${f.installed ?? '?'}  ${f.severity}  ${f.id}${f.title ? ` (${f.title})` : ''}  fixed in: ${f.fixed}`

function npmAudit(root: string, prodOnly: boolean): NpmAudit | string {
  const r = spawnSync('npm', ['audit', '--json', ...(prodOnly ? ['--omit=dev'] : [])], { cwd: root, encoding: 'utf8', timeout: 120000 })
  try {
    const j = JSON.parse(r.stdout) as NpmAudit
    return j.error ? [j.error.code, j.error.summary, j.message].filter(Boolean).join(': ') || 'npm audit failed' : j // exit 1 with a report: findings, not an error
  } catch {
    return (r.error?.message ?? r.stderr.trim().split('\n').pop()) || `npm audit exited ${r.status}`
  }
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const strict = process.env.LAKI_AUDIT_STRICT === '1'
  const installed = (node: string) => {
    try {
      return (JSON.parse(readFileSync(join(root, node, 'package.json'), 'utf8')) as { version?: string }).version
    } catch {
      return undefined
    }
  }
  const allowFile = join(root, 'scripts', 'audit-allow.json')
  const allow = existsSync(allowFile) ? (JSON.parse(readFileSync(allowFile, 'utf8')) as Allow[]) : []
  const prod = npmAudit(root, true)
  if (typeof prod === 'string') {
    console.log(`\n!!! npm audit couldn't reach the registry (${prod}): production dependencies NOT checked${strict ? '' : ' (LAKI_AUDIT_STRICT=1 makes this fail)'}\n`)
    process.exit(strict ? 1 : 0)
  }
  const { fail, warn, expired } = auditOf(prod, allow, Date.now(), installed)
  for (const a of expired) console.log(`expired allowance: ${a.package} ${a.id} (until ${a.until}: ${a.reason})`)
  for (const f of fail) console.log(`FAIL  ${lineOf(f)}`)
  for (const f of warn) console.log(`warn  ${lineOf(f)}`)
  if (!fail.length && !warn.length) console.log('production dependencies: no advisories')
  // the build tools': they don't ship, so a warning only
  const all = npmAudit(root, false)
  if (typeof all === 'string') console.log(`warn  build tools not checked: ${all}`)
  else {
    const shipped = new Set(findings(prod).map(f => `${f.id} ${f.package}`))
    for (const f of findings(all, installed)) if (BAD.has(f.severity) && !shipped.has(`${f.id} ${f.package}`)) console.log(`warn  build tool: ${lineOf(f)}`)
  }
  if (fail.length) console.log(`\n${fail.length} high or critical advisor${fail.length === 1 ? 'y' : 'ies'} in what ships: update, or allow it in scripts/audit-allow.json with a reason and an until date`)
  process.exit(fail.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
