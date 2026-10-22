// claude's and codex's transcripts, read as they grow: a tab's context and usage meters, and today's spend. core.ts
// re-exports it.

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, readJson, writeAtomic } from '../shared/conn.ts'
import { type Tab, type TabView, type Today } from '../shared/types.ts'
import { accountNamed, homeDir } from './accounts.ts'
import { changed, presetOf, state } from './core.ts'
import { dayOf, type Meter, meterNew, meterOf, transcriptOf } from './share.ts'

// ---------- transcripts: a claude or codex tab's (share.ts' transcriptOf), read as it grows, by shared tabs and the meters

export type Tail = { file?: string; looked?: number; for?: string; since?: number; pos?: number } // for: the chat it looked for, since when
const SHARE_READ = 32 << 20 // a transcript's most read at once: a longer one starts there (ponytail: its start is left out)
// what was written to the tab's transcript since t's last read, whole lines only (the last may be half written); ''
// nothing new; undefined none (another agent, a host's, not found yet, empty); fresh: it's read from its start again
// (this chat's file found, or written anew)
export function tailOf(tab: Tab, t: Tail, fresh: () => void): string | undefined {
  const agent = tab.preset
  if ((agent !== 'claude' && agent !== 'codex') || !tab.resumeId || state.workspaces.find(w => w.id === tab.workspace)?.host) return
  // a chat's looked for again every 10 s at most (codex's: a walk of every session, here on the daemon's thread), every 2
  // minutes once it's been missing for one (a chat gone, another account's folder): a new chat's is written at its first
  // turn, whose end looks again at once (meterRead's look)
  const now = Date.now()
  if (t.for !== tab.resumeId) (t.for = tab.resumeId), (t.since = now), (t.looked = 0)
  if (!t.file?.endsWith(`${tab.resumeId}.jsonl`) && now - (t.looked ?? 0) > (now - t.since! < 60000 ? 10000 : 120000)) (t.looked = now), (t.file = transcriptOf(agent, accountNamed(tab.account)?.dir ?? homeDir(agent), tab.resumeId)), (t.pos = 0), fresh()
  if (!t.file?.endsWith(`${tab.resumeId}.jsonl`)) return void (t.file = undefined) // another chat's: none until this one's is found
  const size = statSync(t.file, { throwIfNoEntry: false })?.size ?? 0
  if (!size) return
  if (size < t.pos!) (t.pos = 0), fresh() // written anew
  if (size - t.pos! > SHARE_READ) t.pos = size - SHARE_READ // the line it lands in is cut off: JSON.parse skips it
  if (size === t.pos) return ''
  const buf = Buffer.alloc(size - t.pos!)
  const fd = openSync(t.file, 'r')
  try {
    readSync(fd, buf, 0, buf.length, t.pos!)
  } finally {
    closeSync(fd)
  }
  const cut = buf.lastIndexOf(10) + 1
  t.pos! += cut
  return buf.subarray(0, cut).toString('utf8')
}

// the meters (share.ts' meterOf): each claude and codex tab's context and what its chat used, its transcript read on
// every 10 s (main.ts' meterTick) and as a turn ends. Today's by chat in <data>/usage-today.json: a closed tab's stays,
// and a restart reading each chat anew counts it once (the more of the two)
type MeterRun = Tail & { m: Meter }
const meters = new Map<string, MeterRun>()
const todayPath = join(dataDir(), 'usage-today.json') // dataDir(), not core's dir: meters.ts loads before core does
let spent: { day: string; chats: Record<string, { ws: string; tokens: number; cost: number }> } | undefined
function spentNow() {
  const day = dayOf(Date.now())
  if (!spent) spent = readJson(todayPath)
  if (spent?.day !== day || typeof spent.chats !== 'object') spent = { day, chats: {} }
  return spent
}
// true: it read something new
export function meterRead(tab: Tab, look = false) { // look: a turn's end, its transcript looked for now
  const r = meters.get(tab.id) ?? { m: meterNew() }
  meters.set(tab.id, r)
  if (look) r.looked = 0
  const text = tailOf(tab, r, () => (r.m = meterNew()))
  if (!text) return false
  meterOf(tab.preset!, text, r.m)
  const s = spentNow()
  if (r.m.today.tokens > (s.chats[tab.resumeId!]?.tokens ?? 0)) {
    s.chats[tab.resumeId!] = { ws: tab.workspace, tokens: r.m.today.tokens, cost: r.m.today.cost }
    writeAtomic(todayPath, JSON.stringify(s))
  }
  return true
}
export function meterTick() {
  if (state.settings?.contextMeter === false && state.settings?.costs === false) return
  let any = false
  const archived = new Set(state.workspaces.filter(w => w.archived).map(w => w.id)) // nothing to read until it's back
  for (const t of state.tabs) if (t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex') && !archived.has(t.workspace)) any = meterRead(t) || any
  for (const id of meters.keys()) if (!state.tabs.some(t => t.id === id)) meters.delete(id)
  if (any) changed()
}
const WINDOW = 200e3 // claude's context unless its model says [1m] (its transcript doesn't say)
export function meterView(t: Tab): Pick<TabView, 'context' | 'usage'> {
  const r = meters.get(t.id)
  if (!r?.file?.endsWith(`${t.resumeId}.jsonl`)) return {} // another chat's (a /clear): until this one's is read
  const { m } = r
  const pr = t.preset === 'claude' ? presetOf(t) : undefined
  // ponytail: a model made [1m] elsewhere (claude's own settings) shows against 200K until it holds more
  const max = m.max ?? (t.preset === 'claude' ? (/\[1m\]/i.test(`${t.model || pr?.model || ''} ${pr?.args ?? ''}`) || (m.used ?? 0) > WINDOW ? 1e6 : WINDOW) : undefined)
  return { ...(m.used !== undefined && max && { context: { used: m.used, max } }), ...(m.tokens > 0 && { usage: { tokens: m.tokens, ...(m.priced && { cost: Math.round(m.cost * 1e4) / 1e4 }) } }) }
}
// today's, the workspaces that used most first (5)
export function todayView(): Today | undefined {
  const chats = Object.values(spentNow().chats)
  if (!chats.length) return
  const ws = new Map<string, { ws: string; tokens: number; cost: number }>()
  for (const c of chats) {
    const w = ws.get(c.ws) ?? { ws: c.ws, tokens: 0, cost: 0 }
    ws.set(c.ws, w)
    w.tokens += c.tokens
    w.cost += c.cost
  }
  const sum = (k: 'tokens' | 'cost') => chats.reduce((n, c) => n + c[k], 0)
  return { tokens: sum('tokens'), cost: Math.round(sum('cost') * 100) / 100, ws: [...ws.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, 5).map(w => ({ ...w, cost: Math.round(w.cost * 100) / 100 })) }
}
