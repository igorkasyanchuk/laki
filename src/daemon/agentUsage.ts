// What Grok's and Antigravity's chats used, by day and model, for the Usage page and Today (meters.ts' keepDays,
// spentNow): read only, from their own files; nothing written there.
// - Grok: ~/.grok/sessions/<its folder>/<chat id>/usage.json (the chat id Laki picks, --session-id): each turn's
//   endedAt, and per model its totalTokens and costUsdTicks (xAI's ticks: 1e-10 USD, Grok's own price).
// - Antigravity: ~/.gemini/antigravity-cli/conversations/<id>.db (the id it printed as it exited, else its
//   cache/last_conversations.json's for the worktree), SQLite with protobuf rows: each `steps` row's metadata, field 1
//   its time (seconds), field 9 its usage (2 input, 3 output, 4 cache write, 5 cache read; 1 the model's number), the
//   model's name from `gen_metadata` (1.3 → 1.19). Cloned to a temp folder first (agy keeps it open, its WAL beside it;
//   APFS: no bytes copied, else a copy), read with node's own sqlite: only the steps past the last one counted, each
//   tab's days kept (agyNext); past AGY_BIG in a worker (agyWorker.ts). No price: tokens only.
// ponytail: agy's field numbers read off its files (Nov 2026, agy 1.x); a release that moves them reads as nothing
import { constants, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { Tab } from '../shared/types.ts'
import { type ByModel, dayOf } from './share.ts'

export type Days = Record<string, ByModel>
const ID = /^[\w-]{1,80}$/
const AGY_EVERY = 30_000 // at most this often per tab (agy writes its DB at every step)
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
export function agyRead(db: string, from = 0): AgyRead | undefined {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as Sqlite | undefined // loaded only here: its warning only for an agy user
  if (!sqlite) return
  const tmp = mkdtempSync(join(tmpdir(), 'laki-agy-'))
  try {
    const copy = join(tmp, 'c.db')
    copyFileSync(db, copy, constants.COPYFILE_FICLONE) // APFS: a clone, no bytes copied (temp and home: one volume on a Mac); elsewhere node copies
    if (existsSync(`${db}-wal`)) copyFileSync(`${db}-wal`, `${copy}-wal`, constants.COPYFILE_FICLONE)
    const d = new sqlite.DatabaseSync(copy)
    try {
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
    } finally {
      d.close()
    }
  } catch {
    return
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
// the days kept and a read's: added to them, or instead of them (again)
export function agyNext(kept: Days | undefined, r: AgyRead): Days {
  const days: Days = r.again || !kept ? {} : structuredClone(kept)
  for (const [day, byModel] of Object.entries(r.days)) for (const [model, m] of Object.entries(byModel)) add(days, 0, model, m.tokens, m.cost, day)
  return days
}
// past AGY_BIG: agyRead in a worker of its own (its build entry: out/main/agyWorker.js), ended at AGY_MS
function agyWorker(db: string, from: number): Promise<AgyRead | undefined> {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = [join(here, 'agyWorker.js'), join(here, '../agyWorker.js'), join(here, 'agyWorker.ts')].find(p => existsSync(p))
  if (!file) return Promise.resolve(undefined)
  return new Promise(res => {
    const w = new Worker(file, { workerData: { db, from }, resourceLimits: { maxOldGenerationSizeMb: 512 } })
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

// a grok or gemini tab's chat (id: its own, as its file names it) and days, read again only when its file changed
// (agy's: at most every AGY_EVERY, unless now)
export function agentDays(tab: Tab, cwd: string, now = false): { id: string; days: Days } | undefined {
  const c = seen.get(tab.id)
  const was = () => (c?.days && c.id ? { id: c.id, days: c.days } : undefined)
  if (tab.preset === 'gemini' && !now && c && Date.now() - c.at < AGY_EVERY) return was()
  const f = tab.preset === 'grok' ? grokFile(tab, cwd) : tab.preset === 'gemini' ? agyFile(tab, cwd) : undefined
  if (!f) return was()
  const id = tab.preset === 'grok' ? tab.resumeId! : basename(f, '.db')
  const key = `${f}|${stamp(f)}|${tab.preset === 'gemini' ? stamp(`${f}-wal`) : ''}`
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
  const same = c?.db === f // the same conversation: only its new steps
  const from = same ? (c.rowid ?? 0) : 0
  const keep = (r: AgyRead | undefined) => {
    const now = seen.get(tab.id)
    if (!r) return now ? ((now.at = Date.now()), (now.reading = false), undefined) : undefined
    const days = agyNext(same ? now?.days : undefined, r)
    seen.set(tab.id, { key, days, at: Date.now(), id, db: f, rowid: r.last })
    return days
  }
  if (size < AGY_BIG) return (days => (days ? { id, days } : was()))(keep(agyRead(f, from)))
  seen.set(tab.id, { ...(c ?? { key: '' }), at: Date.now(), reading: true })
  void agyWorker(f, from).then(keep)
  return was()
}
export const agentDaysTidy = (live: (id: string) => boolean) => { for (const id of seen.keys()) if (!live(id)) seen.delete(id) }
