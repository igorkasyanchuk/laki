// Safe mode: after three starts in a row that died young (none reached a minute alive, none stopped cleanly), this run
// keeps what Laki starts on its own off: extensions' fetches and handlers, scheduled tasks and later starts, workflow
// runs, the PR and port scans and the weekly git tidy. Terminals, agents, hooks, the window and remote access work as
// ever. <data>/starts.json (writeAtomic): the last START_KEEP starts, each with its time, whether it reached a minute
// (alive) or stopped through shutdown (clean: a quit, Settings' restart, an update's), and suspects: the extensions,
// workflows and tasks that ran in the SEEN_MS before an uncaught error (main.ts' handlers). Safe mode is kept there too
// (safe) until the user leaves it (safeOff, the banner's): a restart doesn't end it. A test's daemon (inRig) is
// exempt, unless LAKI_SAFE_TEST=1. No core import: the modules it gates import it
import { join } from 'node:path'
import { readJson, writeAtomic } from '../shared/conn.ts'
import type { SafeSuspect } from '../shared/types.ts'
import { dir, inRig } from './dir.ts'

export const START_KEEP = 5
export const YOUNG_N = 3 // young deaths in a row that turn it on
const ALIVE_MS = () => (inRig() && Number(process.env.LAKI_SAFE_ALIVE_MS)) || 60_000
const SEEN_MS = 10_000
export type Suspect = SafeSuspect
type Start = { at: number; alive?: true; clean?: true; suspects?: Suspect[] }
type Kept = { starts: Start[]; safe?: { since: number; suspects: Suspect[] } }
const path = () => join(dir, 'starts.json')
let kept: Kept | undefined
let me: Start | undefined
const seen = new Map<string, { s: Suspect; at: number }>()
const keyOf = (s: Pick<Suspect, 'kind' | 'id'>) => `${s.kind}:${s.id}`
const write = () => {
  try {
    if (kept) writeAtomic(path(), JSON.stringify(kept))
  } catch {}
}
const on = () => !inRig() || process.env.LAKI_SAFE_TEST === '1'

// the start (main.ts, right after the lock): safe if it was and you didn't leave it, or the last YOUNG_N died young;
// this one added, alive after a minute
export function safeStart(now = Date.now()) {
  if (!on()) return
  const k = readJson<Kept>(path())
  kept = { starts: Array.isArray(k?.starts) ? k.starts.filter(s => s && typeof s.at === 'number') : [], ...(k?.safe && Array.isArray(k.safe.suspects) && { safe: k.safe }) }
  const last = kept.starts.slice(-YOUNG_N)
  if (!kept.safe && last.length === YOUNG_N && last.every(s => !s.alive && !s.clean)) {
    const by = new Map(last.flatMap(s => s.suspects ?? []).map(s => [keyOf(s), s]))
    kept.safe = { since: now, suspects: [...by.values()].slice(0, 5) }
  }
  me = { at: now }
  kept.starts = [...kept.starts, me].slice(-START_KEEP)
  write()
  setTimeout(() => me && ((me.alive = true), write()), ALIVE_MS()).unref()
}
// shutdown's: a clean stop is no crash
export function safeStop() {
  if (me) (me.clean = true), write()
}
export const safeOn = () => !!kept?.safe
export const safeView = () => kept?.safe && { since: kept.safe.since, suspects: kept.safe.suspects }

// what ran just now: an extension's fetch or handler, a workflow run's block, a task's start
export function safeSeen(s: Suspect) {
  if (!me) return
  seen.set(keyOf(s), { s, at: Date.now() })
  if (seen.size > 50) seen.delete(seen.keys().next().value!)
}
// an uncaught error (main.ts): what ran in the SEEN_MS before it is this start's suspects
export function safeCrash(now = Date.now()) {
  try {
    if (!me) return
    const near = [...seen.values()].filter(x => now - x.at <= SEEN_MS).map(x => x.s)
    if (!near.length) return
    const by = new Map([...(me.suspects ?? []), ...near].map(s => [keyOf(s), s]))
    me.suspects = [...by.values()].slice(-5)
    write()
  } catch {}
}
// the user leaves it (safeOff): back to normal; the suspect turned off by the caller first
export function safeLeave() {
  if (!kept?.safe) return false
  delete kept.safe
  write()
  return true
}
