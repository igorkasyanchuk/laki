// The machine scan's worker (usageScan.ts: Settings › Usage › Count every agent chat on this Mac): every agent chat on
// this Mac that changed in the last USAGE_KEEP days, read only and parsed into records (share.ts UseRec), handed to the
// main thread a batch at a time; meters.ts' ledger there decides what counts (its owners) and keeps it. Nothing here
// writes anything. Its own build entry (out/main/usageScanWorker.js); imported outside a worker (tests, load order) it
// does nothing but export scan.
// - Claude: <config>/projects/<folder>/<session>.jsonl and <session>/subagents/*.jsonl (the session's: its chat).
// - Codex: <home>/sessions/**/rollout-*.jsonl, its chat the session_meta id, a spawned thread's its root parent's.
// - Grok: ~/.grok/sessions/<its folder, encoded>/<id>/usage.json, whole. Antigravity: each conversations/<id>.db, OpenCode:
//   its opencode.db, only the rows past the last one counted (agentUsage.ts agyRead, ocRead).
// Each file's { size, mtime, ctime, ino, pos } (usage-scan-v1.json): unchanged, skipped; the same inode and bigger, read on
// from pos (a codex rollout with its running totals and model as they were there); any other change read again from 0
// (the ledger's keys count a record seen again nowhere). 4 files at a time, paced to RATE on average (Orca's: a cold scan
// must not take the disk an agent works on; a small one never waits).
import { realpathSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { agyRead, grokParse, ocRead } from './agentUsage.ts'
import { meterNew, meterOf, type UseRec } from './share.ts'

// pos: bytes read (whole lines), a DB's last rowid; chat, cwd: whose and where, as last read; id, parent: a codex
// rollout's session_meta (its thread, the one that spawned it); total, model: a codex rollout's running totals and model
// at pos (its next token_count counts what grew since)
export type FileState = { size: number; mtime: number; ctime: number; ino: number; pos: number; chat?: string; cwd?: string; id?: string; parent?: string; total?: Record<string, number>; model?: string }
export type ScanIn = { claude: string[]; codex: string[]; grok?: string; agy?: string; agyCwd?: Record<string, string>; oc?: string; files: Record<string, FileState>; since: number; rate?: number }
export type ScanOut = { recs: UseRec[]; files: Record<string, FileState | null> } // null: gone (not seen this scan)
export const RATE = 32 << 20 // bytes a second, on average
const BATCH = 4
const CHUNK = 8 << 20
const LINE_MAX = 128 << 20 // ponytail: a line past this (a pasted video?) is skipped whole

// Orca's pacing: the bytes read so far at rate, paused for what's ahead; a debt past 5 s forgiven, under 50 ms not waited
export type Budget = { take: (n: number) => Promise<void> }
export function budgetOf(rate = RATE): Budget {
  let at = Date.now()
  let bytes = 0
  return {
    async take(n) {
      bytes += n
      const due = (bytes / rate) * 1000 - (Date.now() - at)
      if (due > 5000) at -= due - 5000
      const wait = Math.min(due, 5000)
      if (wait >= 50) await new Promise(r => setTimeout(r, wait))
    },
  }
}

type Job = { file: string; agent: 'claude' | 'codex' | 'grok' | 'gemini' | 'opencode'; chat?: string; cwd?: string }
const ls = async (d: string) => readdir(d, { withFileTypes: true }).catch(() => [])
const real = new Map<string, string>()
const realOf = (p: string) => {
  if (!real.has(p)) {
    let r = p
    try {
      r = realpathSync(p)
    } catch {} // gone: as said
    real.set(p, r)
  }
  return real.get(p)!
}
const CWD = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/g
// the last cwd a chunk names (claude's every line, codex's session_meta and turn_context)
function cwdIn(text: string): string | undefined {
  let last: string | undefined
  for (const m of text.matchAll(CWD)) last = m[1]
  if (last === undefined) return
  try {
    return realOf(JSON.parse(`"${last}"`))
  } catch {}
}

async function jobs(i: ScanIn): Promise<Job[]> {
  const out: Job[] = []
  for (const root of i.claude) {
    const projects = join(root, 'projects')
    for (const d of await ls(projects)) {
      if (!d.isDirectory()) continue
      for (const e of await ls(join(projects, d.name))) {
        if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ file: join(projects, d.name, e.name), agent: 'claude', chat: e.name.slice(0, -6) })
        else if (e.isDirectory()) for (const s of await ls(join(projects, d.name, e.name, 'subagents'))) if (s.isFile() && s.name.endsWith('.jsonl')) out.push({ file: join(projects, d.name, e.name, 'subagents', s.name), agent: 'claude', chat: e.name })
      }
    }
  }
  for (const root of i.codex) {
    const walk = async (d: string, depth: number): Promise<void> => {
      for (const e of await ls(d)) {
        if (e.isDirectory() && depth < 3) await walk(join(d, e.name), depth + 1)
        else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push({ file: join(d, e.name), agent: 'codex' })
      }
    }
    const at = out.length
    await walk(join(root, 'sessions'), 0)
    out.splice(at, out.length - at, ...out.slice(at).sort((a, b) => (a.file < b.file ? -1 : 1))) // by name (its time): a thread before the ones it spawned
  }
  if (i.grok)
    for (const d of await ls(i.grok)) {
      if (!d.isDirectory()) continue
      let cwd: string | undefined
      try {
        cwd = realOf(decodeURIComponent(d.name))
      } catch {}
      for (const e of await ls(join(i.grok, d.name))) if (e.isDirectory()) out.push({ file: join(i.grok, d.name, e.name, 'usage.json'), agent: 'grok', chat: e.name, cwd })
    }
  if (i.agy) for (const e of await ls(i.agy)) if (e.isFile() && e.name.endsWith('.db')) (id => out.push({ file: join(i.agy!, e.name), agent: 'gemini', chat: id, cwd: i.agyCwd?.[id] && realOf(i.agyCwd[id]) }))(e.name.slice(0, -3))
  if (i.oc) out.push({ file: i.oc, agent: 'opencode' })
  return out
}

const sqlite = (j: Job) => j.agent === 'gemini' || j.agent === 'opencode'
// a file's (a DB's: with its WAL) size, times and inode; none: gone
async function statOf(j: Job) {
  const s = await stat(j.file).catch(() => undefined)
  if (!s) return
  const w = sqlite(j) ? await stat(`${j.file}-wal`).catch(() => undefined) : undefined
  return { size: s.size + (w?.size ?? 0), mtime: Math.max(s.mtimeMs, w?.mtimeMs ?? 0), ctime: Math.max(s.ctimeMs, w?.ctimeMs ?? 0), ino: s.ino }
}

// a claude or codex transcript from pos on, whole lines, through share.ts' meterOf (each answer's key and parts as the
// tab's meter has them), its records onto out
async function jsonl(j: Job, st: { size: number }, from: number, was: FileState | undefined, budget: Budget, out: UseRec[]): Promise<Partial<FileState>> {
  const fh = await open(j.file, 'r')
  const m = meterNew()
  if (from && was) (m.total = was.total), (m.model = was.model)
  let pos = from
  let cwd = from ? was?.cwd : undefined
  let id = was?.id
  let parent = was?.parent
  const chat = j.chat ?? id ?? ''
  const owns = (key: string, day: string, model: string, p: Record<string, number>) => (out.push({ chat, agent: j.agent, key, day, model, p, ...(cwd && { cwd }) }), true)
  try {
    let n = CHUNK
    while (pos < st.size) {
      const want = Math.min(n, st.size - pos)
      const buf = Buffer.alloc(want)
      const { bytesRead } = await fh.read(buf, 0, want, pos)
      if (!bytesRead) break
      await budget.take(bytesRead)
      const cut = buf.subarray(0, bytesRead).lastIndexOf(10) + 1
      if (!cut) {
        if (pos + bytesRead >= st.size) break // the last line, half written: next time
        if (n < LINE_MAX) n *= 2 // a long line: a bigger read
        else pos += bytesRead // past LINE_MAX: skipped (the rest of it is cut off, its next line's start then)
        continue
      }
      n = CHUNK
      const text = buf.subarray(0, cut).toString('utf8')
      if (j.agent === 'codex' && pos === 0) {
        try {
          const p = JSON.parse(text.slice(0, text.indexOf('\n')))?.payload
          if (typeof p?.id === 'string') id = p.id
          const pt = p?.source?.subagent?.thread_spawn?.parent_thread_id
          if (typeof pt === 'string') parent = pt
        } catch {}
      }
      cwd = cwdIn(text) ?? cwd
      const before = out.length
      meterOf(j.agent, text, m, Date.now(), owns)
      if (j.agent === 'codex' && !j.chat) for (let k = before; k < out.length; k++) out[k].chat = id ?? '' // its own id; a spawned thread's root: scan's
      if (cwd) for (let k = before; k < out.length; k++) out[k].cwd = cwd
      pos += cut
    }
  } finally {
    await fh.close()
  }
  return { pos, chat: j.chat ?? id, cwd, id, parent, ...(j.agent === 'codex' && { total: m.total, model: m.model }) }
}

// every file that changed, a batch at a time: its records and its new state handed to post (a throw there stops the
// scan: what was posted stands, the rest is read next time)
export async function scan(i: ScanIn, post: (o: ScanOut) => void | Promise<void>, budget = budgetOf(i.rate)) {
  const all = await jobs(i)
  const seen = new Set(all.map(j => j.file))
  const gone: Record<string, null> = {}
  for (const f of Object.keys(i.files)) if (!seen.has(f)) gone[f] = null
  if (Object.keys(gone).length) await post({ recs: [], files: gone })
  // a codex thread's chat: its root's (the thread that spawned it, up), by every rollout's id seen
  const byId = new Map<string, FileState>()
  for (const s of Object.values(i.files)) if (s.id) byId.set(s.id, s)
  const root = (id: string) => {
    let at = id
    for (let k = 0; k < 20 && byId.get(at)?.parent; k++) at = byId.get(at)!.parent!
    return at
  }
  // the oldest first (birth time, else mtime): a chat before its forks and resumes, whose copies of its answers are its
  const born = new Map<string, number>()
  await Promise.all(all.map(async j => born.set(j.file, (s => (s ? s.birthtimeMs || s.mtimeMs : 0))(await stat(j.file).catch(() => undefined)))))
  all.sort((a, b) => born.get(a.file)! - born.get(b.file)!)
  for (let b = 0; b < all.length; b += BATCH) {
    const recs: UseRec[] = []
    const files: Record<string, FileState> = {}
    await Promise.all(
      all.slice(b, b + BATCH).map(async j => {
        const st = await statOf(j)
        const was = i.files[j.file]
        if (!st || (!was && st.mtime < i.since)) return // gone, or untouched since before the days kept
        if (was && was.ino === st.ino && was.size === st.size && was.mtime === st.mtime && was.ctime === st.ctime) return // unchanged
        const on = !!was && was.ino === st.ino && st.size > was.size // grown: read on
        const from = on ? was!.pos : 0
        const mine: UseRec[] = []
        let got: Partial<FileState> | undefined
        try {
          if (j.agent === 'claude' || j.agent === 'codex') got = await jsonl(j, st, from, on ? was : undefined, budget, mine)
          else if (j.agent === 'grok') {
            await budget.take(st.size)
            if (st.size < 8 << 20) mine.push(...grokParse(await readFile(j.file, 'utf8'), j.chat!, j.cwd))
            got = { pos: st.size, chat: j.chat, cwd: j.cwd }
          } else {
            const r = j.agent === 'gemini' ? agyRead(j.file, on ? was!.pos : 0, j.chat, j.cwd) : ocRead(j.file, undefined, on ? was!.pos : 0)
            if (!r) return
            mine.push(...r.recs)
            got = { pos: r.last, chat: j.chat, cwd: j.cwd }
          }
        } catch {
          return // unreadable now: next time
        }
        const s: FileState = { ...st, ...got } as FileState
        if (s.id) byId.set(s.id, s)
        files[j.file] = s
        recs.push(...mine)
      }),
    )
    for (const r of recs) if (r.agent === 'codex') r.chat = root(r.chat)
    for (const s of Object.values(files)) if (s.id && s.parent) s.chat = root(s.id)
    if (recs.length || Object.keys(files).length) await post({ recs, files })
  }
}

if (parentPort) {
  const port = parentPort
  void scan(workerData as ScanIn, o => port.postMessage(o)).then(
    () => port.postMessage({ done: true }),
    e => port.postMessage({ done: true, error: String(e?.message ?? e) }),
  )
}
