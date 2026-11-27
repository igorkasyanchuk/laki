// What Grok's, Antigravity's and OpenCode's chats used, by day and model, for the Usage page and Today (meters.ts' keepDays,
// spentNow): read only, from their own files; nothing written there.
// - Grok: ~/.grok/sessions/<its folder>/<chat id>/usage.json (the chat id Laki picks, --session-id): each turn's
//   endedAt, and per model its totalTokens and costUsdTicks (xAI's ticks: 1e-10 USD, Grok's own price).
// - Antigravity: ~/.gemini/antigravity-cli/conversations/<id>.db (the id it printed as it exited, else its
//   cache/last_conversations.json's for the worktree), SQLite with protobuf rows: each `steps` row's metadata, field 1
//   its time (seconds), field 9 its usage (2 input, 3 output, 4 cache write, 5 cache read; 1 the model's number), the
//   model's name from `gen_metadata` (1.3 → 1.19). Cloned to a temp folder first (agy keeps it open, its WAL beside it;
//   APFS: no bytes copied, else a copy), read with node's own sqlite: only the steps past the last one counted, each
//   tab's days kept (agyNext); past AGY_BIG in a worker (agyWorker.ts). No price: tokens only.
// - OpenCode: its own SQLite database (opencode.db in the data folder `opencode debug paths` names, OPENCODE_DB when
//   set), cloned with its WAL as agy's: the tab's session and every one under it (session.parent_id: its subagents),
//   each assistant message's data (modelID; tokens: input, output, reasoning, cache read and write; cost: OpenCode's
//   own, USD), by day and model; only the rows past the last counted (one still answering, no time.completed, read
//   again for an hour from its start), every 30 s at most, past AGY_BIG in the worker.
// ponytail: agy's field numbers read off its files (Nov 2026, agy 1.x); OpenCode's schema read off this Mac's
// opencode.db (2026-11-27, OpenCode 1.19.5: message.data JSON, session.parent_id); a release that moves them reads as nothing
import { execFile } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { Tab } from '../shared/types.ts'
import { dayOf } from './share.ts'

export type Days = Record<string, Record<string, { tokens: number; cost: number }>> // a day's, by the model that answered
const ID = /^[\w-]{1,80}$/
const AGY_EVERY = Number(process.env.LAKI_AGY_EVERY_MS) || 30_000 // at most this often per tab (agy and OpenCode write their DB at every step); the env: tests'
const AGY_BIG = 32 << 20 // a DB and its WAL past this: read in a worker (a first read whole, or a copy where the clone falls back, would stall the daemon)
const AGY_MAX = 256 << 20 // past this: not read
const AGY_MS = 20_000 // a worker's read at most
// by tab: its file's key, the days read; agy's: its DB (another conversation starts over), the rowid read up to, a worker's read under way
const seen = new Map<string, { key: string; days?: Days; at: number; id?: string; db?: string; rowid?: number; reading?: boolean }>()

const add = (days: Days, at: number, model: string, tokens: number, cost: number, day = Number.isFinite(at) ? dayOf(at) : '') => {
  if (!day || !(tokens > 0)) return
  const m = ((days[day] ??= {})[model || 'unknown'] ??= { tokens: 0, cost: 0 })
  m.tokens += tokens
  m.cost += cost
}
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const stamp = (f: string) => (s => (s ? `${s.mtimeMs}:${s.size}` : ''))(statSync(f, { throwIfNoEntry: false }))

// Grok's usage.json: each turn's own (not running totals), by the model that answered
export function grokParse(text: string): Days {
  const days: Days = {}
  let u: { turns?: unknown }
  try {
    u = JSON.parse(text)
  } catch {
    return days
  }
  for (const t of Array.isArray(u?.turns) ? (u.turns as Record<string, unknown>[]) : []) {
    const at = Date.parse(String(t?.endedAt ?? ''))
    const by = t?.modelUsage && typeof t.modelUsage === 'object' ? (t.modelUsage as Record<string, Record<string, unknown>>) : {}
    for (const [model, v] of Object.entries(by)) add(days, at, model, n(v?.totalTokens), n(v?.costUsdTicks) / 1e10)
  }
  return days
}
function grokFile(tab: Tab, cwd: string): string | undefined {
  const id = tab.resumeId
  if (!id || !ID.test(id)) return
  const root = join(homedir(), '.grok', 'sessions')
  const f = join(root, encodeURIComponent(cwd), id, 'usage.json')
  if (existsSync(f)) return f
  // its folder as Grok wrote it (a real path, another encoding): any folder holding this chat
  for (const d of (() => { try { return readdirSync(root) } catch { return [] } })()) if (existsSync(join(root, d, id, 'usage.json'))) return join(root, d, id, 'usage.json')
}

// a protobuf message's fields, by number: varints as numbers (past 2^53 rounded), bytes as bytes; a wire type it
// doesn't know ends it (what it read so far stands)
export function pbFields(b: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const out = new Map<number, (number | Uint8Array)[]>()
  let i = 0
  const varint = () => {
    let r = 0
    for (let s = 0; i < b.length && s < 70; s += 7) {
      const x = b[i++]
      r += (x & 0x7f) * 2 ** s
      if (!(x & 0x80)) return r
    }
    throw new Error('cut')
  }
  try {
    while (i < b.length) {
      const k = varint()
      const f = Math.floor(k / 8)
      const w = k % 8
      let v: number | Uint8Array
      if (w === 0) v = varint()
      else if (w === 2) {
        const len = varint()
        if (i + len > b.length) break
        v = b.subarray(i, (i += len))
      } else if (w === 1 || w === 5) {
        i += w === 1 ? 8 : 4
        continue
      } else break
      ;(out.get(f) ?? (out.set(f, []), out.get(f)!)).push(v)
    }
  } catch {}
  return out
}
const msg = (m: Map<number, (number | Uint8Array)[]>, f: number) => (v => (v instanceof Uint8Array ? pbFields(v) : undefined))(m.get(f)?.[0])
const int = (m: Map<number, (number | Uint8Array)[]> | undefined, f: number) => (v => (typeof v === 'number' ? v : 0))(m?.get(f)?.[0])

// Antigravity's conversation rows: steps' metadata (time, usage) and gen_metadata (each model's number → its name)
export function agyParse(steps: Uint8Array[], gens: Uint8Array[]): Days {
  const names = new Map<number, string>()
  for (const g of gens) {
    const m = msg(pbFields(g), 1)
    const name = m?.get(19)?.[0]
    if (m && name instanceof Uint8Array) names.set(int(m, 3), new TextDecoder().decode(name))
  }
  const days: Days = {}
  for (const s of steps) {
    const m = pbFields(s)
    const u = msg(m, 9)
    if (!u) continue
    const at = int(msg(m, 1), 1) * 1000
    const model = names.get(int(u, 1)) ?? `model ${int(u, 1)}`
    add(days, at || NaN, model, int(u, 2) + int(u, 3) + int(u, 4) + int(u, 5), 0)
  }
  return days
}
type Sqlite = typeof import('node:sqlite')
export const agyRows = { n: 0 } // steps' rows read, all reads (tests: only the new ones are)
export type AgyRead = { days: Days; last: number; again: boolean }
// agy's steps past from (a rowid: what was counted before) and their days; last: the newest row with usage now (one with
// none yet, a step under way, is read again next time); again: its newest rowid went below from (another conversation in
// that file): read whole. ponytail: a step's usage, once there, is taken as final (a row rewritten later isn't read again)
// a DB read on a clone of it and its WAL in a temp folder of its own (gone after, even when it throws); undefined: no
// node:sqlite, or it couldn't be read
function withClone<T>(db: string, read: (d: InstanceType<Sqlite['DatabaseSync']>) => T): T | undefined {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as Sqlite | undefined // loaded only here: its warning only for an agy or OpenCode user
  if (!sqlite) return
  const tmp = mkdtempSync(join(tmpdir(), 'laki-agy-'))
  try {
    const copy = join(tmp, 'c.db')
    copyFileSync(db, copy, constants.COPYFILE_FICLONE) // APFS: a clone, no bytes copied (temp and home: one volume on a Mac); elsewhere node copies
    if (existsSync(`${db}-wal`)) copyFileSync(`${db}-wal`, `${copy}-wal`, constants.COPYFILE_FICLONE)
    const d = new sqlite.DatabaseSync(copy)
    try {
      return read(d)
    } finally {
      d.close()
    }
  } catch {
    return
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
export function agyRead(db: string, from = 0): AgyRead | undefined {
  return withClone(db, d => {
    const top = Number((d.prepare('SELECT max(rowid) AS m FROM steps').get() as { m?: unknown } | undefined)?.m ?? 0)
    const again = top < from
    const since = again ? 0 : from
    const steps = d.prepare('SELECT rowid AS id, metadata FROM steps WHERE rowid > ? ORDER BY rowid').all(since) as { id: number | bigint; metadata: unknown }[]
    agyRows.n += steps.length
    let last = since
    const blobs: Uint8Array[] = []
    for (const r of steps) if (r.metadata instanceof Uint8Array) (blobs.push(r.metadata), msg(pbFields(r.metadata), 9) && (last = Number(r.id)))
    const gens = (d.prepare('SELECT data FROM gen_metadata').all() as { data: unknown }[]).flatMap(r => (r.data instanceof Uint8Array ? [r.data] : []))
    return { days: agyParse(blobs, gens), last, again }
  })
}
// OpenCode's: the session's and its subagents' assistant messages past from (a rowid), their days; last: the row read
// up to (before the first of theirs still answering); again: the table's newest went below from (another database)
export const ocRows = { n: 0 } // its message rows read, all reads (tests: only the new ones are)
export function ocRead(db: string, session: string, from = 0): AgyRead | undefined {
  return withClone(db, d => {
    const top = Number((d.prepare('SELECT max(rowid) AS m FROM message').get() as { m?: unknown } | undefined)?.m ?? 0)
    const again = top < from
    const since = again ? 0 : from
    const rows = d.prepare('WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT s.id FROM session s JOIN t ON s.parent_id = t.id) SELECT rowid AS id, data FROM message WHERE rowid > ? AND session_id IN (SELECT id FROM t) ORDER BY rowid').all(session, since) as { id: number | bigint; data: unknown }[]
    ocRows.n += rows.length
    const days: Days = {}
    let last = top
    for (const r of rows) {
      let m: { role?: unknown; modelID?: unknown; cost?: unknown; error?: unknown; time?: { created?: unknown; completed?: unknown }; tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } } }
      try {
        m = JSON.parse(String(r.data))
      } catch {
        continue
      }
      if (m?.role !== 'assistant') continue
      // still answering: from here next time; one begun over an hour ago never will (its opencode was killed): as it is
      if (!m.time?.completed && !m.error && Date.now() - n(m.time?.created) < 3_600_000) {
        last = Number(r.id) - 1
        break
      }
      const k = m.tokens
      add(days, n(m.time?.completed) || n(m.time?.created) || NaN, typeof m.modelID === 'string' ? m.modelID : '', n(k?.input) + n(k?.output) + n(k?.reasoning) + n(k?.cache?.read) + n(k?.cache?.write), n(m.cost))
    }
    return { days, last, again }
  })
}
// OpenCode's data folder, as the installed opencode says (`opencode debug paths`: asked once, again every 10 minutes
// while it hasn't said), else its default (XDG_DATA_HOME or ~/.local/share, then opencode); its DB: OPENCODE_DB, else
// opencode.db there, else the newest opencode-<channel>.db
let ocData: { at: number; dir?: string } | undefined
export function ocDb(): string | undefined {
  if (!ocData || (!ocData.dir && Date.now() - ocData.at > 600_000)) {
    const asked = (ocData = { at: Date.now() })
    execFile('opencode', ['debug', 'paths'], { timeout: 10_000 }, (_e, out) => (d => d && asked === ocData && (ocData.dir = d))(/^data\s+(\S.*)$/m.exec(String(out ?? ''))?.[1]?.trim()))
  }
  const dir = ocData.dir ?? join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode')
  const env = process.env.OPENCODE_DB
  if (env && env !== ':memory:') return isAbsolute(env) ? env : join(dir, env)
  const f = join(dir, 'opencode.db')
  if (existsSync(f)) return f
  try {
    return readdirSync(dir).filter(x => /^opencode-[\w.-]+\.db$/.test(x)).map(x => join(dir, x)).sort((a, b) => (statSync(b, { throwIfNoEntry: false })?.mtimeMs ?? 0) - (statSync(a, { throwIfNoEntry: false })?.mtimeMs ?? 0))[0]
  } catch {}
}
// the days kept and a read's: added to them, or instead of them (again)
export function agyNext(kept: Days | undefined, r: AgyRead): Days {
  const days: Days = r.again || !kept ? {} : structuredClone(kept)
  for (const [day, byModel] of Object.entries(r.days)) for (const [model, m] of Object.entries(byModel)) add(days, 0, model, m.tokens, m.cost, day)
  return days
}
// past AGY_BIG: agyRead in a worker of its own (its build entry: out/main/agyWorker.js), ended at AGY_MS
function agyWorker(db: string, from: number, session?: string): Promise<AgyRead | undefined> {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = [join(here, 'agyWorker.js'), join(here, '../agyWorker.js'), join(here, 'agyWorker.ts')].find(p => existsSync(p))
  if (!file) return Promise.resolve(undefined)
  return new Promise(res => {
    const w = new Worker(file, { workerData: { db, from, session }, resourceLimits: { maxOldGenerationSizeMb: 512 } })
    const t = setTimeout(() => void w.terminate(), AGY_MS)
    w.once('message', (m: { r?: AgyRead }) => res(m.r))
    w.once('error', () => res(undefined))
    w.once('exit', () => (clearTimeout(t), res(undefined))) // a settled promise ignores it
  })
}
const AGY = () => join(homedir(), '.gemini', 'antigravity-cli')
// agy's latest conversation in a folder (its cache/last_conversations.json), before it printed the id itself
export function agyChat(cwd: string): string | undefined {
  try {
    const id = (JSON.parse(readFileSync(join(AGY(), 'cache', 'last_conversations.json'), 'utf8')) as Record<string, unknown>)[cwd]
    return typeof id === 'string' && ID.test(id) ? id : undefined
  } catch {}
}
function agyFile(tab: Tab, cwd: string): string | undefined {
  const id = tab.resumeId ?? agyChat(cwd)
  return id && ID.test(id) ? join(AGY(), 'conversations', `${id}.db`) : undefined
}

// a grok, gemini or opencode tab's chat (id: its own, as its file names it; OpenCode's session) and days, read again only
// when its file changed (agy's and OpenCode's: at most every AGY_EVERY, unless now)
export function agentDays(tab: Tab, cwd: string, now = false): { id: string; days: Days } | undefined {
  const c = seen.get(tab.id)
  const was = () => (c?.days && c.id ? { id: c.id, days: c.days } : undefined)
  const oc = tab.preset === 'opencode'
  if ((tab.preset === 'gemini' || oc) && !now && c && Date.now() - c.at < AGY_EVERY) return was()
  if (oc && !(tab.resumeId && ID.test(tab.resumeId))) return was()
  const f = tab.preset === 'grok' ? grokFile(tab, cwd) : tab.preset === 'gemini' ? agyFile(tab, cwd) : oc ? ocDb() : undefined
  if (!f || !existsSync(f)) return was()
  const id = tab.preset === 'grok' || oc ? tab.resumeId! : basename(f, '.db')
  const key = `${f}|${id}|${stamp(f)}|${tab.preset !== 'grok' ? stamp(`${f}-wal`) : ''}`
  if (c?.key === key) return (c.at = Date.now()), was()
  if (tab.preset === 'grok') {
    const s = statSync(f, { throwIfNoEntry: false })
    const days = s && s.size < 8 << 20 ? grokParse(readFileSync(f, 'utf8')) : undefined
    if (days) seen.set(tab.id, { key, days, at: Date.now(), id })
    else if (c) c.at = Date.now()
    return days ? { id, days } : was()
  }
  if (c?.reading) return was() // a worker's read under way: its days next time
  const size = (statSync(f, { throwIfNoEntry: false })?.size ?? Infinity) + (statSync(`${f}-wal`, { throwIfNoEntry: false })?.size ?? 0)
  if (size >= AGY_MAX) return c && (c.at = Date.now()), was() // past AGY_MAX: not read
  const same = c?.db === f && c.id === id // the same conversation (OpenCode's: the same session): only its new rows
  const from = same ? (c.rowid ?? 0) : 0
  const keep = (r: AgyRead | undefined) => {
    const now = seen.get(tab.id)
    if (!r) return now ? ((now.at = Date.now()), (now.reading = false), undefined) : undefined
    const days = agyNext(same ? now?.days : undefined, r)
    seen.set(tab.id, { key, days, at: Date.now(), id, db: f, rowid: r.last })
    return days
  }
  if (size < AGY_BIG) return (days => (days ? { id, days } : was()))(keep(oc ? ocRead(f, id, from) : agyRead(f, from)))
  seen.set(tab.id, { ...(c ?? { key: '' }), at: Date.now(), reading: true })
  void agyWorker(f, from, oc ? id : undefined).then(r => seen.has(tab.id) && keep(r)) // the tab closed meanwhile (agentDaysTidy): not kept
  return was()
}
export const agentDaysTidy = (live: (id: string) => boolean) => { for (const id of seen.keys()) if (!live(id)) seen.delete(id) }
