// T12: what each trusted client did, for Settings › Security › Trusted clients and laki client log: when, the method,
// the workspace or tab it named (ids and names only: never a message's text, a prompt or a screen), ok or the refusal's
// reason. A read (CLIENT_READ: state, screen, diff…) is one line per method and target per FOLD (5 minutes) with a
// count, so a client polling doesn't flood it. The newest CLIENT_LOG_MAX per client in memory and in
// <data>/client-log/<id>.jsonl (0600; appended, rewritten whole as it's cut back or a folded line grows, at most every
// few seconds). Gone with the client. Also: calls with a client token Laki doesn't know (revoked, rotated away, made up),
// counted per day with the last one's time and caller (its process, when the peer lookup names one); never the token.
// No core import: tested through the daemon. It never fails a call
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from '../shared/conn.ts'
import { dir } from './dir.ts'

export type ClientDid = { at: number; method: string; target?: string; ok: boolean; why?: string; n?: number; last?: number } // n, last: a folded read's count and its newest
export const CLIENT_LOG_MAX = 2000
const FOLD = 5 * 60_000
const kept = new Map<string, ClientDid[]>()
const lines = new Map<string, number>()
const dirty = new Set<string>()
let flushing: NodeJS.Timeout | undefined
const fileOf = (id: string) => (/^[\w.-]+$/.test(id) ? join(dir, 'client-log', `${id}.jsonl`) : undefined)
function load(id: string): ClientDid[] {
  let l = kept.get(id)
  if (l) return l
  const f = fileOf(id)
  const all = f && existsSync(f) ? readFileSync(f, 'utf8').split('\n').flatMap(x => { try { return x ? [JSON.parse(x) as ClientDid] : [] } catch { return [] } }) : []
  lines.set(id, all.length)
  kept.set(id, (l = all.slice(-CLIENT_LOG_MAX)))
  return l
}
const rewrite = (id: string) => {
  const f = fileOf(id)
  if (!f) return
  const l = load(id)
  mkdirSync(join(dir, 'client-log'), { recursive: true, mode: 0o700 })
  writeAtomic(f, l.map(x => `${JSON.stringify(x)}\n`).join(''), 0o600)
  lines.set(id, l.length)
  dirty.delete(id)
}
const later = () => (flushing ??= setTimeout(() => ((flushing = undefined), [...dirty].forEach(id => { try { rewrite(id) } catch {} })), 5000).unref())
// read: a read's call (folded); what's logged is the caller's to pick: ids and names only
export function clientDid(id: string, e: Omit<ClientDid, 'at'>, read = false, now = Date.now()) {
  try {
    const f = fileOf(id)
    if (!f) return
    const l = load(id)
    if (read && e.ok) {
      const same = l.findLast(x => x.method === e.method && x.target === e.target && x.ok && x.n !== undefined && now - x.at < FOLD)
      if (same) return void ((same.n = (same.n ?? 1) + 1), (same.last = now), dirty.add(id), later())
    }
    const line: ClientDid = { at: now, ...e, ...(read && e.ok && { n: 1 }) }
    l.push(line)
    if (l.length > CLIENT_LOG_MAX) l.splice(0, l.length - CLIENT_LOG_MAX)
    mkdirSync(join(dir, 'client-log'), { recursive: true, mode: 0o700 })
    const n = (lines.get(id) ?? 0) + 1
    if (n > CLIENT_LOG_MAX + 100 || dirty.has(id)) rewrite(id)
    else appendFileSync(f, `${JSON.stringify(line)}\n`, { mode: 0o600 }), lines.set(id, n)
  } catch {}
}
// newest first; refused: only refusals
export const clientLogOf = (id: string, refused = false) => [...load(id)].reverse().filter(x => !refused || !x.ok)
// calls today (a folded read counts each)
export const callsToday = (id: string, now = Date.now()) => {
  const day = new Date(now).toDateString()
  return load(id).reduce((s, x) => s + (new Date(x.last ?? x.at).toDateString() === day ? (x.n ?? 1) : 0), 0)
}
export function clientLogDrop(id: string) {
  kept.delete(id)
  lines.delete(id)
  dirty.delete(id)
  const f = fileOf(id)
  if (f) rmSync(f, { force: true })
}
// a client token nobody has (revoked, rotated, made up): today's count, the last one's time and caller
let unknown: { day: string; n: number; last: number; by?: string } | undefined
export function unknownToken(now = Date.now()) {
  const day = new Date(now).toDateString()
  if (unknown?.day !== day) unknown = { day, n: 0, last: now }
  unknown.n++
  unknown.last = now
}
// its caller, once the peer lookup says (after the 401 went)
export const unknownBy = (by?: string) => void (by && unknown && (unknown.by = by.slice(0, 120)))
export const unknownTokens = (now = Date.now()) => (unknown && unknown.day === new Date(now).toDateString() ? { n: unknown.n, last: unknown.last, ...(unknown.by && { by: unknown.by }) } : { n: 0 })
