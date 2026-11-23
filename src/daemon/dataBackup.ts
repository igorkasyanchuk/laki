// laki backup / laki restore (Settings › General › Backup): the user's data in one .tgz, by the system's tar (macOS's
// bsdtar, Linux's GNU tar). In it: manifest.json first (the Laki that made it, the state's schema, counts), then
// state.json (the view's state as it is in memory, without this Mac's remote access: MACHINE), notes and To-dos, specs
// and brainstorms, workflows, extensions' folders, Laki AI's chats, the prompt history and the Review tab's unsent comments: KEEP, an allowlist, so the
// rest of the data folder (daemon.json's token, pty.json, tap-key, Laki AI's keys, accounts, logs, temp files, the
// trash: core.ts' DATA_SECRETS and the like) never goes in. Restore takes only KEEP's names back (anything else in the
// archive, a link or a path out of it, is refused or dropped), refuses one from a newer state schema and, unless
// forced, while agents work; it sets the data it replaces aside in <data>/backup-before-restore-<time>, then the daemon
// restarts (main.ts shutdown calls apply as it stops: nothing else writes the folder by then). The user's alone:
// gates.ts' AGENT_NO, REMOTE_NO and main.ts' ANSWER_NO
import { spawn } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { VERSION } from '../shared/version.ts'
import { agentsBusy, log, state, STATE_V, view } from './core.ts'
import { BACKUP_KEEP as KEEP, dir } from './dir.ts'
import { envJson, envKept } from './envKeys.ts'

const MACHINE = ['remote', 'remoteDevices', 'tunnels'] as const // this Mac's remote access and tunnels: their keys stay here
const SKIP = ['*.tmp', '*.broken-*', '._*'] // writeAtomic's temp files, a store set aside, macOS's AppleDouble copies
export type Counts = Record<'projects' | 'workspaces' | 'notes' | 'specs' | 'workflows' | 'extensions' | 'aiChats' | 'prompts' | 'reviewComments', number>
// secrets: the names whose values stay in this Mac's Keychain (envKeys.ts), never in the archive
export type Manifest = { laki: string; stateV: number; made: number; counts: Counts; secrets?: { names: string[]; note: string } }

const entries = (d: string) => {
  try {
    return readdirSync(d).filter(n => !n.startsWith('.'))
  } catch {
    return []
  }
}
const json = (f: string) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return undefined
  }
}
// what a data folder holds (root: the data folder or a restore's staging), with its state
export function countsOf(root: string, s: { projects?: unknown[]; workspaces?: unknown[] }): Counts {
  return {
    projects: s.projects?.length ?? 0,
    workspaces: s.workspaces?.length ?? 0,
    notes: entries(join(root, 'notes')).filter(n => n.endsWith('.json')).length,
    specs: entries(join(root, 'plans')).reduce((n, p) => n + entries(join(root, 'plans', p)).length, 0),
    workflows: entries(join(root, 'workflows')).filter(n => n.endsWith('.md')).length,
    extensions: entries(join(root, 'widgets')).length,
    aiChats: entries(join(root, 'ai-chats')).length + (existsSync(join(root, 'ai-chat.json')) ? 1 : 0),
    prompts: (a => (Array.isArray(a) ? a.length : 0))(json(join(root, 'prompts.json'))),
    reviewComments: entries(join(root, 'review-notes')).filter(n => n.endsWith('.json')).reduce((n, f) => n + (a => (Array.isArray(a) ? a.length : 0))(json(join(root, 'review-notes', f))?.notes), 0),
  }
}

// the system's tar; COPYFILE_DISABLE: macOS's tar adds no ._ copies of extended attributes
function tar(args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn('tar', args, { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 })
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => rej(new Error(`tar: ${e.message}`)))
    p.on('close', code => (code === 0 ? res(out) : rej(new Error(`tar: ${err.trim().split('\n')[0] || `exit ${code}`}`))))
  })
}
const fileIn = (file: unknown) => {
  if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('give the archive as a full path (laki backup resolves it)')
  return file
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

export async function dataBackup(p: { file?: unknown }) {
  const file = fileIn(p.file)
  if (existsSync(file)) throw new Error(`${file} is already there: pick another name`)
  const stage = mkdtempSync(join(dir, '.backup-'))
  const part = `${file}.${process.pid}.part`
  try {
    const s: Record<string, unknown> = JSON.parse(envJson({ ...state, v: STATE_V })) // secret values null: the Keychain has them (manifest's secrets)
    for (const k of MACHINE) delete s[k]
    const counts = countsOf(dir, state)
    const names = envKept()
    const manifest: Manifest = { laki: VERSION, stateV: STATE_V, made: Date.now(), counts, ...(names.length && { secrets: { names, note: "Their values aren't in this archive: they stay in this Mac's Keychain (or its data folder's env-keys). Restored on this Mac, they're read back from there; on another Mac, set each one again in Settings (its env, a profile's or a project's, the phone push)." } }) }
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
    writeFileSync(join(stage, 'state.json'), JSON.stringify(s, null, 2), { mode: 0o600 })
    const rest = KEEP.filter(n => n !== 'state.json' && existsSync(join(dir, n)))
    closeSync(openSync(part, 'wx', 0o600)) // its mode before tar writes: state.json has your settings' env, the webhook
    await tar(['-czf', part, ...SKIP.flatMap(x => ['--exclude', x]), '-C', stage, 'manifest.json', 'state.json', ...(rest.length ? ['-C', dir, ...rest] : [])])
    renameSync(part, file)
    log(`backup: ${file}`)
    return { file, bytes: statSync(file).size, manifest }
  } catch (e) {
    rmSync(part, { force: true })
    throw e
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

let pending: { stage: string; aside: string } | undefined
export const restoring = () => !!pending

// a restore: dryRun says what changes (counts here and in the archive); else it's staged and the daemon restarts
// (stop), apply moving it in as it stops
export async function dataRestore(p: { file?: unknown; dryRun?: boolean; force?: boolean }, stop: () => void) {
  const file = fileIn(p.file)
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`no such file: ${file}`)
  if (pending) throw new Error('a restore is already under way: Laki is restarting')
  if (!p.dryRun && !p.force && agentsBusy(view())) throw new Error('agents are working: stop them first, or restore with --force (their turns end)')
  // its names: only KEEP's and the manifest, none absolute or with ..
  for (const raw of (await tar(['-tzf', file])).split('\n').filter(Boolean)) {
    const n = raw.replace(/^\.\//, '')
    const parts = n.split('/')
    if (!n || parts.at(-1)?.startsWith('._')) continue
    if (isAbsolute(raw) || parts.includes('..') || !['manifest.json', ...KEEP].includes(parts[0])) throw new Error(`not a Laki backup: it has ${raw}`)
  }
  const stage = mkdtempSync(join(dir, '.restore-'))
  try {
    await tar(['-xzf', file, '-C', stage, ...SKIP.flatMap(x => ['--exclude', x])])
    const manifest = json(join(stage, 'manifest.json')) as Manifest | undefined
    if (!manifest || typeof manifest.stateV !== 'number') throw new Error('not a Laki backup: no manifest.json')
    if (manifest.stateV > STATE_V) throw new Error(`this backup is from a newer Laki (${manifest.laki}, state v${manifest.stateV}; this one reads v${STATE_V}): update Laki first`)
    const s = json(join(stage, 'state.json'))
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('not a Laki backup: its state.json is unreadable')
    const dropped = drop(stage)
    const [here, there] = [countsOf(dir, state), countsOf(stage, s)]
    const rows = (Object.keys(manifest.counts ?? {}) as (keyof Counts)[]).map(what => ({ what, now: here[what], backup: there[what] }))
    const aside = join(dir, `backup-before-restore-${stamp()}`)
    if (p.dryRun) return { dryRun: true, manifest, rows, dropped, aside }
    if (pending) throw new Error('a restore is already under way: Laki is restarting') // one started while this was read
    pending = { stage, aside }
    log(`restore: ${file} (made by Laki ${manifest.laki}); the data now goes to ${aside} as the daemon restarts`)
    setTimeout(stop, 200) // after this answer
    return { manifest, rows, dropped, aside }
  } catch (e) {
    rmSync(stage, { recursive: true, force: true })
    throw e
  } finally {
    if (p.dryRun) rmSync(stage, { recursive: true, force: true })
  }
}

// what isn't a plain file or folder (a link could point out of the data folder): dropped, counted
function drop(at: string): number {
  let n = 0
  for (const e of readdirSync(at)) {
    const f = join(at, e)
    const st = lstatSync(f)
    if (st.isDirectory()) n += drop(f)
    else if (!st.isFile()) rmSync(f, { force: true }), n++
  }
  return n
}

// main.ts' shutdown, last: the data now aside, the backup's in its place, this Mac's remote access kept
export function apply() {
  if (!pending) return
  const { stage, aside } = pending
  pending = undefined
  try {
    mkdirSync(aside, { recursive: true, mode: 0o700 })
    for (const n of KEEP) {
      if (existsSync(join(dir, n))) renameSync(join(dir, n), join(aside, n))
      if (existsSync(join(stage, n))) renameSync(join(stage, n), join(dir, n))
    }
    const was = json(join(aside, 'state.json'))
    const now = json(join(dir, 'state.json'))
    if (was && now) {
      for (const k of MACHINE) if (was[k] !== undefined) now[k] = was[k]
      writeFileSync(join(dir, 'state.json'), JSON.stringify(now, null, 2), { mode: 0o600 })
    }
    log(`restore: done; what was here is in ${aside}`)
  } catch (e) {
    log(`restore failed: ${(e as Error).message} (what was here is in ${aside})`)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
