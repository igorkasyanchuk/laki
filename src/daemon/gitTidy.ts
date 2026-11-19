// B8: a project's git kept tidy, weekly (gitTidyTick, hourly: one project a tick, settings.gitTidy unless false) or as
// you press Tidy now (Settings › Resources › Disk: gitTidy, the user's only). In its main checkout (on its host, an SSH
// project's): git worktree prune (the records of worktrees whose folder is gone; never while one of Laki's live
// worktrees is missing, a volume unplugged, and never an existing one), then git maintenance run --auto (git decides:
// gc, the commit-graph, loose objects), under nice, 10 minutes at most, its output kept unless it fails. Never a branch,
// tag, stash or Laki's refs (kept turns, archives): gc's own grace periods as they are (no --prune=now), and its reflogs
// kept (gc.reflogExpire never: a stash is one). Not while an agent of the project works or a workspace is being made or
// set up; skipped, with why, where the user's git says maintenance.auto=false or `git maintenance start` registered it.
// Its last run is the project's `tidied` (when, skipped or failed): a failure is logged once and tried again a week on,
// an error only to a press of Tidy now
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { GitFacts, Project } from '../shared/types.ts'
import { changed, exec, git, log, projectArchived, save, settingUp, state, tabStatus } from './core.ts'
import { making } from './hosts.ts'
import { du } from './resources.ts'

export const TIDY_DAYS = 7
export const LOOSE_MANY = 20000 // laki doctor says so past this many loose objects
const TIDY_MS = 10 * 60e3
const going = new Set<string>()

const tidyable = (p: Project) => p.git !== false && !p.kind && !projectArchived(p.id)
// an agent of the project at work, a workspace of it being made or set up, or a tidy of it already going
function busy(p: Project) {
  const mine = state.workspaces.filter(w => w.project === p.id)
  if (going.has(p.id)) return 'it is being tidied now'
  if (mine.some(w => making.has(w.id) || (!w.archived && !w.host && settingUp(w)))) return 'a workspace of it is being made'
  if (state.tabs.some(t => t.kind === 'agent' && tabStatus(t.id) === 'running' && mine.some(w => w.id === t.workspace))) return 'an agent is working in it'
}
// the user's own say: maintenance.auto=false, or git maintenance start registered the repo (its scheduler runs it)
async function userSays(p: Project) {
  if ((await git(p, 'config', '--get', 'maintenance.auto').catch(() => '')).toLowerCase() === 'false') return 'its git config says maintenance.auto=false'
  const top = await git(p, 'rev-parse', '--show-toplevel').catch(() => p.path)
  const repos = (await git(p, 'config', '--get-all', 'maintenance.repo').catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean)
  if (repos.some(r => r === top || r === p.path)) return 'git maintenance runs it already (git maintenance start)'
}
const nice = (p: Project, args: string[]) => exec(p, 'nice', ['-n', '10', 'git', ...args], { timeout: TIDY_MS })

export async function gitTidy(o: { project: string; asked?: boolean }) {
  const p = state.projects.find(x => x.id === o.project)
  if (!p) throw new Error(`no project ${o.project}`)
  if (!tidyable(p)) throw new Error(`${p.name} has no git of its own to tidy`)
  const held = busy(p)
  if (held) {
    if (o.asked) throw new Error(`not now: ${held}`)
    return { skipped: held }
  }
  going.add(p.id)
  try {
    const no = await userSays(p)
    if (no) {
      p.tidied = { at: Date.now(), skipped: no }
      log(`git tidy ${p.id}: skipped, ${no}`)
      return { skipped: no }
    }
    // a live worktree of Laki's whose folder isn't there (an external volume unplugged): no prune, its record stays
    const gone = state.workspaces.find(w => w.project === p.id && !w.archived && w.kind === 'worktree' && !p.host && !existsSync(w.path))
    if (!gone) await nice(p, ['worktree', 'prune'])
    await nice(p, ['-c', 'gc.reflogExpire=never', '-c', 'gc.reflogExpireUnreachable=never', 'maintenance', 'run', '--auto'])
    p.tidied = { at: Date.now(), ...(gone && { skipped: `worktree prune: ${gone.name ?? gone.id}'s folder isn't there` }) }
    log(`git tidy ${p.id}: done${gone ? ` (no prune: ${gone.path} is missing)` : ''}`)
    return { ok: true }
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').pop()!.slice(0, 300)
    if (!p.tidied?.failed) log(`git tidy ${p.id}: failed, tried again in ${TIDY_DAYS} days: ${why}`) // once, not each week
    p.tidied = { at: Date.now(), failed: why }
    if (o.asked) throw new Error(`git maintenance failed: ${why}`)
    return { failed: why }
  } finally {
    going.delete(p.id)
    save()
    changed()
  }
}

// hourly: the first project due (a week since its last run, or never), not busy; one a tick
export async function gitTidyTick(now = Date.now()) {
  if (state.settings?.gitTidy === false) return
  const due = state.projects.find(p => tidyable(p) && now - (p.tidied?.at ?? 0) >= TIDY_DAYS * 86400e3 && !busy(p))
  if (due) await gitTidy({ project: due.id })
}

const counts = async (p: Project) => Object.fromEntries((await git(p, 'count-objects', '-v')).split('\n').map(l => l.split(':').map(s => s.trim())))
// laki doctor's: its loose objects (0: none, or no git of its own here)
export const gitLoose = (p: Project) => (!tidyable(p) || p.host ? Promise.resolve(0) : counts(p).then(kv => Number(kv.count) || 0, () => 0))
// the Disk page's: its .git's size, git count-objects -v (loose objects, packs), when tidied
export async function gitFacts(p: Project): Promise<GitFacts | undefined> {
  if (!tidyable(p) || p.host) return undefined
  try {
    const kv = await counts(p)
    const common = await git(p, 'rev-parse', '--git-common-dir')
    const bytes = await du(isAbsolute(common) ? common : join(p.path, common))
    return { loose: Number(kv.count) || 0, packs: Number(kv.packs) || 0, ...(bytes !== undefined && { bytes }), ...(p.tidied && { tidied: p.tidied }) }
  } catch {
    return undefined
  }
}
