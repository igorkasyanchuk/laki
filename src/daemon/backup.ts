// Laki's worktrees out of Time Machine and Spotlight (macOS; settings.tmExclude, settings.spotlightExclude). Time
// Machine: `tmutil addexclusion <path>` on each worktree, the sticky per-item form (an attribute on the folder: no root,
// it moves with the folder); never `-p`, a system-wide path rule that needs root. Spotlight: an empty
// `.metadata_never_index` in the folder that holds a project's worktrees, only when that folder is Laki's own (nothing
// in it but Laki's worktrees and its spare), never the project's folder or a folder that holds it. Turned off: tmutil
// removeexclusion and the marker removed. The main checkout, SSH hosts' and codespaces' workspaces are never touched.
// Nothing here throws: a failure is logged (log) and the workspace goes on. No core import: core calls it
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { sep } from 'node:path'

export const MARKER = '.metadata_never_index'
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
const inside = (a: string, b: string) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)

// tmutil by name (PATH: a test's fake first), its first line of stderr on a failure
export function tmutil(args: string[]): Promise<string | undefined> {
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  return new Promise(res => execFile('tmutil', args, { timeout: 15000 }, (e, _out, err) => res(e ? String(err || e.message).trim().split('\n')[0] || 'failed' : undefined)))
}

// a worktree in or out of Time Machine's backups; log: why it failed
export async function tmSet(path: string, on: boolean, log: (s: string) => void) {
  if (!existsSync(path)) return
  const why = await tmutil([on ? 'addexclusion' : 'removeexclusion', path])
  if (why) log(`Time Machine: ${on ? 'add' : 'remove'}exclusion ${path}: ${why}`)
  return !why
}

// the marker in root (the folder of a project's worktrees) on or off: on only when root holds nothing but Laki's own
// worktrees (theirs: the paths of Laki's workspaces there; its spare, .spare) and is neither the project's folder nor
// holds it. Returns why it was skipped, else undefined
export function spotlightSet(root: string, on: boolean, o: { theirs: string[]; project: string }): string | undefined {
  const marker = `${root}${sep}${MARKER}`
  if (!on) {
    if (existsSync(marker)) rmSync(marker, { force: true })
    return
  }
  if (!existsSync(root)) return 'no worktrees folder yet'
  const r = real(root)
  const p = real(o.project)
  if (inside(r, p) || inside(p, r)) return `${root} is the project's folder or holds it`
  const ours = new Set(o.theirs.map(real))
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch (e) {
    return (e as Error).message
  }
  const foreign = names.filter(n => n !== MARKER && n !== '.DS_Store' && n !== '.spare' && !ours.has(real(`${root}${sep}${n}`)))
  if (foreign.length) return `${root} has other things in it too (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? '…' : ''}): not marked`
  if (!existsSync(marker)) writeFileSync(marker, '')
}
