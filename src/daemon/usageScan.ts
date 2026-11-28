// The machine scan (settings.usageAll, on unless false: Settings › Usage › Count every agent chat on this Mac): every
// agent chat on this Mac, Laki's tabs' or not, read in a worker (usageScanWorker.ts: it only reads and parses) and
// applied here through meters.ts' ledger, the only owner map and the only writer; nothing leaves the Mac. When the Usage
// page asks for its days (main.ts usageDays: the last scan ended over AGAIN ago, or Laki's projects or worktrees changed
// since) and every 15 minutes (main.ts' tick); the page answers at once with what's kept and changed() goes out as the
// scan ends. Its files' state in <data>/usage-scan-v1.json (the version in the name: an older Laki never writes a newer
// one's), saved every SAVE_MS and as the daemon stops (the ledger first): a quit mid-scan picks up where it stopped.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { accounts, homeDir } from './accounts.ts'
import { AGY, grokRoot, ocDb } from './agentUsage.ts'
import { changed, log, state } from './core.ts'
import { dir } from './dir.ts'
import { daysWrite, ledger, USAGE_KEEP } from './meters.ts'
import { piDir } from './share.ts'
import type { FileState, ScanIn, ScanOut } from './usageScanWorker.ts'

const scanPath = join(dir, 'usage-scan-v1.json')
const AGAIN = Number(process.env.LAKI_SCAN_AGAIN_MS) || 5 * 60_000 // the env: tests'
const SAVE_MS = 30_000
const MS = 10 * 60_000 // a scan's longest (a first one of a few GB at 32 MB/s: a few minutes); ended there, saved as far as it got
export const scanNow: { at: number; running: boolean; files: number } = { at: 0, running: false, files: 0 } // at: when the last one ended
let files: Record<string, FileState> | undefined
let worker: Worker | undefined
let places = ''
export const usageAllOn = () => state.settings?.usageAll !== false
// Laki's project and worktree folders: a change there names chats anew (where they show)
const placesNow = () => [...state.projects.map(p => p.path), ...state.workspaces.map(w => w.path)].sort().join('\n')
// the folders to read, each once (an account's folder may link the agent's own)
function roots(agent: 'claude' | 'codex', sub: string) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of [homeDir(agent), ...accounts(agent).map(a => a.dir)]) {
    let r: string
    try {
      r = realpathSync(join(d, sub))
    } catch {
      continue
    }
    if (!seen.has(r)) seen.add(r), out.push(d)
  }
  return out
}
function save() {
  if (!files) return
  daysWrite() // the ledger first: a state past what it has would skip records it never kept
  writeAtomic(scanPath, JSON.stringify({ v: 1, files }))
}
// ask: the Usage page's (a scan only when the last ended AGAIN ago or Laki's places changed); else the tick's
export function usageScan(ask = false) {
  if (!usageAllOn() || worker) return
  const now = placesNow()
  if (ask && Date.now() - scanNow.at < AGAIN && now === places) return
  places = now
  files ??= readJson<{ files?: Record<string, FileState> }>(scanPath)?.files ?? {}
  const here = dirname(fileURLToPath(import.meta.url))
  const file = [join(here, 'usageScanWorker.js'), join(here, '../usageScanWorker.js'), join(here, 'usageScanWorker.ts')].find(p => existsSync(p))
  if (!file) return
  const agy = join(AGY(), 'conversations')
  let agyCwd: Record<string, string> | undefined
  try {
    agyCwd = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(AGY(), 'cache', 'last_conversations.json'), 'utf8')) as Record<string, unknown>).flatMap(([cwd, id]) => (typeof id === 'string' ? [[id, cwd]] : [])))
  } catch {}
  const input: ScanIn = { claude: roots('claude', 'projects'), codex: roots('codex', 'sessions'), pi: join(piDir({ ...process.env, ...state.settings?.env }), 'sessions'), grok: grokRoot(), agy, agyCwd, oc: ocDb(), files, since: Date.now() - USAGE_KEEP * 864e5 }
  const w = (worker = new Worker(file, { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 512 } }))
  scanNow.running = true
  let saved = Date.now()
  const t = setTimeout(() => void w.terminate(), MS)
  t.unref?.()
  w.on('message', (m: ScanOut & { done?: true; error?: string }) => {
    if (m.error) log('usage scan:', m.error)
    for (const r of m.recs ?? []) ledger(r)
    for (const [f, s] of Object.entries(m.files ?? {})) s ? (files![f] = s) : delete files![f]
    if (Date.now() - saved > SAVE_MS) (saved = Date.now()), save()
  })
  w.once('error', e => log('usage scan:', e))
  w.once('exit', () => {
    clearTimeout(t)
    if (worker === w) worker = undefined
    scanNow.running = false
    scanNow.at = Date.now()
    scanNow.files = Object.keys(files ?? {}).length
    save()
    changed()
  })
}
// as the daemon stops: what it applied saved, the worker ended
export function usageScanStop() {
  const w = worker
  worker = undefined
  save()
  void w?.terminate()
}
