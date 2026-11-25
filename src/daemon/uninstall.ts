// B3: Uninstall Laki (Settings › General › Developer, laki uninstall): the pieces Laki put outside its app, each a row,
// removed in one go: the laki command on PATH, the agent skills in each agent's folder, the background daemon (and the
// terminals it kept), and with `data` the data folder (projects, notes, settings, kept chats, artifacts) and Laki AI's
// keys in the Keychain, with `worktrees` every worktree Laki made (their uncommitted changes with them). Only this
// Laki's: a launcher or a skill that drives another data folder's daemon (another build, a dev one) is kept, said so.
// Repos are never touched; worktrees only when picked (the data folder's own worktrees/ stays without it). The
// daemon, the worktrees and the data go last, as the daemon stops (main.ts shutdown calls wipe); `stop` (the CLI's)
// stops it now and tells an open app to quit
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UninstallRow } from '../shared/types.ts'
import { broadcast, cliRemove, cliState, log, q, state } from './core.ts'
import { dir } from './dir.ts'
import { envKept } from './envKeys.ts'
import { kcRm, keychainOn } from './keychain.ts'
import { skills, skillSet } from './skill.ts'

const tilde = (p: string) => (p.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p)
const ours = (text: string) => text.includes(q(`LAKI_HOME=${dir}`)) // a launcher that drives this data folder's daemon
const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}
const CASKS = ['/opt/homebrew/Caskroom/laki', '/usr/local/Caskroom/laki']
let wiping: { data: boolean; worktrees: string[]; repos: string[] } | undefined

export function uninstall(p: { data?: boolean; worktrees?: boolean; run?: boolean; stop?: boolean } = {}, stopNow?: () => void): { rows: UninstallRow[] } {
  const rows: UninstallRow[] = []
  // the laki command: Laki's launcher (its mark), this data folder's
  const cli = cliState().path
  if (!cli) rows.push({ id: 'cli', label: 'laki command', detail: 'not installed', state: 'none' })
  else if (!ours(read(cli))) rows.push({ id: 'cli', label: 'laki command', detail: tilde(cli), state: 'kept', why: "another Laki's (it drives another data folder)" })
  else if (!p.run) rows.push({ id: 'cli', label: 'laki command', detail: tilde(cli), state: 'todo' })
  else
    try {
      cliRemove()
      rows.push({ id: 'cli', label: 'laki command', detail: tilde(cli), state: 'done' })
    } catch (e) {
      rows.push({ id: 'cli', label: 'laki command', detail: tilde(cli), state: 'failed', why: (e as Error).message, cmd: `rm ${q(cli)}` })
    }
  // the agent skills: each one installed whose launcher is this data folder's
  const all = skills().filter(s => s.state !== 'missing')
  const mine = all.filter(s => ours(read(join(s.path, 'laki'))))
  const names = (l: typeof all) => [...new Set(l.map(s => s.name))].join(', ')
  const kept = all.length > mine.length ? `; ${names(all.filter(s => !mine.includes(s)))}: another Laki's, kept` : ''
  if (!mine.length) rows.push({ id: 'skills', label: 'Agent skills', detail: all.length ? `another Laki's, kept (${names(all)})` : 'none installed', state: all.length ? 'kept' : 'none' })
  else if (!p.run) rows.push({ id: 'skills', label: 'Agent skills', detail: `${names(mine)}${kept}`, state: 'todo' })
  else {
    const bad: string[] = []
    for (const s of mine)
      try {
        skillSet({ agent: s.agent, on: false, skill: s.skill })
      } catch (e) {
        bad.push(s.path)
        log(`uninstall: ${s.path}: ${(e as Error).message}`)
      }
    rows.push({ id: 'skills', label: 'Agent skills', detail: `${names(mine)}${kept}`, ...(bad.length ? { state: 'failed', why: `${bad.length} not removed`, cmd: `rm -r ${bad.map(q).join(' ')}` } : { state: 'done' }) })
  }
  // the daemon and its terminals: as it stops (the app's Quit Laki, or now: stop)
  const agents = state.tabs.filter(t => t.kind === 'agent').length
  rows.push({ id: 'daemon', label: 'Background daemon', detail: `and the terminals it kept${agents ? ` (${agents} agent tab${agents === 1 ? '' : 's'} end)` : ''}`, state: p.run ? (p.stop ? 'done' : 'later') : 'todo' })
  // the worktrees Laki made (live and archived workspaces'), on this Mac
  const trees = state.workspaces.filter(w => w.kind === 'worktree' && !w.host && !w.imported && existsSync(w.path)).map(w => w.path) // an imported one is yours (Laki never removes it)
  rows.push({ id: 'worktrees', label: 'Worktrees', detail: trees.length ? `${trees.length} worktree${trees.length === 1 ? '' : 's'} Laki made: their uncommitted changes go too` : 'none', state: !trees.length ? 'none' : !p.worktrees ? 'kept' : p.run ? (p.stop ? 'done' : 'later') : 'todo' })
  const storage = typeof state.settings?.storageDir === 'string' && state.settings.storageDir.trim() ? state.settings.storageDir.trim() : ''
  rows.push({ id: 'data', label: 'My data', detail: `${tilde(dir)} (projects, notes, settings, kept chats, shell tabs' last screens${storage ? '' : ', artifacts'})${keychainOn() ? " and Laki AI's keys, the Telegram bot's token and your secret env values in the Keychain" : ''}${storage ? `; artifacts in ${storage} stay` : ''}${!p.worktrees && existsSync(join(dir, 'worktrees')) ? `; ${tilde(join(dir, 'worktrees'))} stays` : ''}`, state: !p.data ? 'kept' : p.run ? (p.stop ? 'done' : 'later') : 'todo' })
  const cask = CASKS.some(c => existsSync(c))
  rows.push({ id: 'next', label: 'Then', detail: cask ? 'brew uninstall --cask laki (it was installed with Homebrew)' : 'Quit Laki and move it to the Trash', state: 'todo', ...(cask && { cmd: 'brew uninstall --cask laki' }) })
  if (p.run) {
    const repos = [...new Set(state.workspaces.filter(w => w.kind === 'worktree' && !w.host && !w.imported).map(w => state.projects.find(x => x.id === w.project)?.path).filter((x): x is string => !!x))]
    wiping = { data: !!p.data, worktrees: p.worktrees ? trees : [], repos }
    log(`uninstall: ${rows.map(r => `${r.id} ${r.state}`).join(', ')}`)
    if (p.stop && stopNow) setTimeout(() => (broadcast({ ev: 'uninstalled', cask }), setTimeout(stopNow, 300)), 200) // after the answer; an open app quits (main's uninstalled)
  }
  return { rows }
}

// as the daemon stops (main.ts shutdown, its sessions ended): the data folder, only when uninstall said so and only a
// folder that is Laki's (its state.json there; never home or /), and Laki AI's Keychain items
export function wipe() {
  if (!wiping) return
  // the worktrees picked: each folder, then its repo's git forgets it (worktree prune)
  for (const w of wiping.worktrees) rmSync(w, { recursive: true, force: true })
  if (wiping.worktrees.length) for (const r of wiping.repos) try { execFileSync('git', ['-C', r, 'worktree', 'prune'], { timeout: 10000, stdio: 'ignore' }) } catch {}
  if (!wiping.data) return
  for (const k of ['openrouter', 'endpoint', 'telegram', 'widget-secrets', ...envKept()]) if (keychainOn()) kcRm(k) // Laki AI's keys, the Telegram bot's token, extensions' secrets, your secret env values (envKeys.ts)
  if (dir === '/' || dir === homedir() || !existsSync(join(dir, 'state.json'))) return log(`uninstall: ${dir} doesn't look like Laki's data folder: kept`)
  // its own worktrees/ stays unless they were picked (they hold your branches' work)
  const keep = !wiping.worktrees.length && existsSync(join(dir, 'worktrees'))
  if (!keep) return rmSync(dir, { recursive: true, force: true })
  for (const f of readdirSync(dir)) if (f !== 'worktrees') rmSync(join(dir, f), { recursive: true, force: true })
}
