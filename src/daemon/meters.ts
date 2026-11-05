// claude's and codex's transcripts, read as they grow: a tab's context and usage meters, and today's spend. core.ts
// imports it, and its users import it directly.

import { closeSync, existsSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { planDone } from '../shared/todos.ts'
import { HOME_ACCOUNT, type Tab, type TabView, type Today, type UsageWindow, type Workspace } from '../shared/types.ts'
import { accountNamed, homeDir } from './accounts.ts'
import { changed, presetOf, state } from './core.ts'
import { dir } from './dir.ts'
import { type BgRead, bgOf, type BgTask, type ByModel, chatOf, dayOf, type McpCall, type Meter, meterNew, meterOf, type Said, transcriptOf } from './share.ts'
export type { McpCall }
import { claudeWindows } from './usage.ts'

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

// Reader view: a claude or codex tab's chat as what was said (share.ts' chatOf), read on as it grows; v moves with it
// (the renderer asks every 1.5 s with the v it has: the same, no said back); none: no transcript (another agent, a
// host's, not written yet). ponytail: the newest 400 sent whole at each change
// bg: what a claude chat runs in the background now (share.ts bgOf: the chips over the Reader's box)
type Reader = Tail & { said: Said[]; v: number; bg: BgRead; calls: Map<string, McpCall> }
const readers = new Map<string, Reader>()
const bgNew = (): BgRead => ({ bg: new Map(), wait: new Map() })
const bgDone = (): BgRead => ({ ...bgNew(), done: { n: 0, last: [] } })
export function chatRead(p: { tab: string; v?: number }): { none?: boolean; v?: number; said?: Said[]; bg?: BgTask[]; from?: number } {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab) throw new Error('no such tab')
  for (const id of readers.keys()) if (!state.tabs.some(t => t.id === id)) readers.delete(id) // closed tabs'
  const r = readers.get(tab.id) ?? (readers.set(tab.id, { said: [], v: 0, bg: bgNew(), calls: new Map() }), readers.get(tab.id)!)
  const text = tailOf(tab, r, () => ((r.said = []), (r.bg = bgNew()), (r.calls = new Map()), r.v++))
  if (text === undefined) return { none: true }
  if (text) chatOf(tab.preset!, text, r.said, tab.preset === 'claude' ? r.calls : undefined), tab.preset === 'claude' && bgOf(text, r.bg), r.v++
  if (r.calls.size > 300) for (const k of [...r.calls.keys()].slice(0, r.calls.size - 200)) r.calls.delete(k) // the newest 200 (callsOf's)
  return p.v === r.v ? { v: r.v } : { v: r.v, said: r.said.slice(-400), ...(r.said.length > 400 && { from: r.said.length - 400 }), ...(r.bg.bg.size > 0 && { bg: [...r.bg.bg.values()] }) }
}

// what a claude tab's chat left running in the background as its process ended (its transcript read now, its last
// SHARE_READ: bgOf; a task started before that is missed): a restart's restoreNow tells the resumed agent they're gone.
// None: another agent, a host's, no chat or transcript
export function bgLeft(tab: Tab): BgTask[] {
  if (tab.preset !== 'claude' || !tab.resumeId || state.workspaces.find(w => w.id === tab.workspace)?.host) return []
  const file = transcriptOf('claude', accountNamed(tab.account)?.dir ?? homeDir('claude'), tab.resumeId)
  const size = file ? (statSync(file, { throwIfNoEntry: false })?.size ?? 0) : 0
  if (!size) return []
  const n = Math.min(size, SHARE_READ)
  const buf = Buffer.alloc(n)
  const fd = openSync(file!, 'r')
  try {
    readSync(fd, buf, 0, n, size - n)
  } finally {
    closeSync(fd)
  }
  return [...bgOf(buf.toString('utf8'), bgNew()).bg.values()]
}

// the Reader's MCP calls (mcpApps.ts); the newest 200. bumpReader: something to draw came in (a server's apps)
export const callsOf = (tab: string) => [...(readers.get(tab)?.calls.values() ?? [])].slice(-200)
export const bumpReader = (tab: string) => void (readers.get(tab) && readers.get(tab)!.v++)

// a background task's output, the Reader's chip's Show output: the end of its file (64 KB), only for a task its chat
// started (chatRead's list, read just now), never another path
export function bgOutput(p: { tab: string; id: string }) {
  chatRead({ tab: p.tab })
  const t = readers.get(p.tab)?.bg.bg.get(p.id)
  if (!t?.out) throw new Error('no output for that task (it ended, or it says none)')
  const size = statSync(t.out, { throwIfNoEntry: false })?.size
  if (size === undefined) return { text: '', size: 0 }
  const n = Math.min(size, 64 << 10)
  const buf = Buffer.alloc(n)
  const fd = openSync(t.out, 'r')
  try {
    readSync(fd, buf, 0, n, size - n)
  } finally {
    closeSync(fd)
  }
  return { text: buf.toString('utf8'), size, cut: size > n }
}

// the meters (share.ts' meterOf): each claude and codex tab's context and what its chat used, its transcript read on
// every 10 s (main.ts' meterTick) and as a turn ends. Today's by chat in <data>/usage-today.json: a closed tab's stays,
// and a restart reading each chat anew counts it once (the more of the two)
// bg: a claude chat's background tasks (share.ts bgOf), running and ended: the status bar's Background chip. ponytail:
// read with the meters, so none while both the context meter and costs are off
type MeterRun = Tail & { m: Meter; big?: boolean; bg: BgRead } // big: claude's own settings run it on a 1M window
const meters = new Map<string, MeterRun>()
const todayPath = join(dir, 'usage-today.json')
let spent: { day: string; chats: Record<string, { ws: string; tokens: number; cost: number }> } | undefined
function spentNow() {
  const day = dayOf(Date.now())
  if (!spent) spent = readJson(todayPath)
  if (spent?.day !== day || typeof spent.chats !== 'object') spent = { day, chats: {} }
  return spent
}
// true: it read something new
export function meterRead(tab: Tab, look = false) { // look: a turn's end, its transcript looked for now
  const r = meters.get(tab.id) ?? { m: meterNew(), bg: bgDone() }
  meters.set(tab.id, r)
  if (look) r.looked = 0
  const big = tab.preset === 'claude' && state.settings?.contextMeter !== false && claudeBig(tab) // read each time: settings change without the transcript
  const was = lines.get(tab.id)
  const moved = big !== r.big || statusOf(tab) !== was // its status line written since
  r.big = big
  const text = tailOf(tab, r, () => ((r.m = meterNew()), (r.bg = bgDone())))
  if (!text) return moved
  meterOf(tab.preset!, text, r.m)
  if (tab.preset === 'claude') bgOf(text, r.bg)
  const s = spentNow()
  if (r.m.today.tokens > (s.chats[tab.resumeId!]?.tokens ?? 0)) {
    s.chats[tab.resumeId!] = { ws: tab.workspace, tokens: r.m.today.tokens, cost: r.m.today.cost }
    writeAtomic(todayPath, JSON.stringify(s))
  }
  keepDays(tab, r.m)
  return true
}

// each day's by agent and model, the Usage page's: <data>/usage-days.json by chat, its days USAGE_KEEP back. A chat's
// day and model: the more of what was kept and what's read now (a restart reads each chat anew), as today's is
export const USAGE_KEEP = 90
const daysPath = join(dir, 'usage-days.json')
type Kept = { chats: Record<string, { ws: string; agent: string; days: Record<string, ByModel> }> }
let kept: Kept | undefined
const keptNow = () => (kept ??= (k => (k && typeof k.chats === 'object' ? k : { chats: {} }))(readJson<Kept>(daysPath)))
const timeOf = (day: string) => (([y, m, d]) => new Date(y, m - 1, d).getTime())(day.split('-').map(Number))
function keepDays(tab: Tab, m: Meter) {
  if (!tab.resumeId || !m.days) return
  const k = keptNow()
  const c = (k.chats[tab.resumeId] ??= { ws: tab.workspace, agent: tab.preset!, days: {} })
  let moved = false
  for (const [day, models] of Object.entries(m.days))
    for (const [model, v] of Object.entries(models)) {
      const was = c.days[day]?.[model]
      if (v.tokens > (was?.tokens ?? 0)) ((c.days[day] ??= {})[model] = { tokens: v.tokens, cost: v.cost }), (moved = true)
    }
  if (!moved) return
  const from = Date.now() - USAGE_KEEP * 864e5
  for (const [id, x] of Object.entries(k.chats)) {
    for (const d of Object.keys(x.days)) if (timeOf(d) < from) delete x.days[d]
    if (!Object.keys(x.days).length) delete k.chats[id]
  }
  writeAtomic(daysPath, JSON.stringify(k))
}
// usageDays: the Usage page's rows, a day, agent and model each (YYYY-MM-DD, this Mac's day), every chat's added up
export function usageDays() {
  const sum = new Map<string, { day: string; agent: string; model: string; tokens: number; cost: number }>()
  for (const c of Object.values(keptNow().chats))
    for (const [d, models] of Object.entries(c.days))
      for (const [model, v] of Object.entries(models)) {
        const day = (([y, m, dd]) => `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)(d.split('-'))
        const key = `${day}|${c.agent}|${model}`
        const x = sum.get(key) ?? (sum.set(key, { day, agent: c.agent, model, tokens: 0, cost: 0 }), sum.get(key)!)
        x.tokens += v.tokens
        x.cost += v.cost
      }
  return { keep: USAGE_KEEP, rows: [...sum.values()].map(r => ({ ...r, cost: Math.round(r.cost * 1e4) / 1e4 })).sort((a, b) => a.day.localeCompare(b.day)) }
}
export function meterTick() {
  if (state.settings?.contextMeter === false && state.settings?.costs === false) return
  let any = false
  const archived = new Set(state.workspaces.filter(w => w.archived).map(w => w.id)) // nothing to read until it's back
  for (const t of state.tabs) if (t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex') && !archived.has(t.workspace)) any = meterRead(t) || any
  for (const id of meters.keys()) if (!state.tabs.some(t => t.id === id)) meters.delete(id)
  for (const id of lines.keys()) if (!state.tabs.some(t => t.id === id)) lines.delete(id)
  if (any) changed()
}
const WINDOW = 200e3 // claude's context unless its model says [1m] (its transcript doesn't say)
// claude's own settings, as it reads them (the workspace's local, then its project's, then yours: its account's folder):
// a model made [1m] there (opus[1m]) runs a 1M window. ponytail: not ANTHROPIC_MODEL in an env
function claudeBig(tab: Tab) {
  const path = state.workspaces.find(w => w.id === tab.workspace)?.path
  const files = [...(path ? ['settings.local.json', 'settings.json'].map(f => join(path, '.claude', f)) : []), join(accountNamed(tab.account)?.dir ?? homeDir('claude'), 'settings.json')]
  for (const f of files) {
    const m = readJson<{ model?: unknown }>(f)?.model
    if (typeof m === 'string' && m) return /\[1m\]/i.test(m)
  }
  return false
}
export function meterView(t: Tab): Pick<TabView, 'context' | 'usage' | 'plan' | 'background'> {
  const r = meters.get(t.id)
  const m = r?.file?.endsWith(`${t.resumeId}.jsonl`) ? r.m : undefined // another chat's (a /clear): until this one's is read
  const s = (x => (x?.session === t.resumeId ? x : undefined))(statusOn() ? lines.get(t.id) : undefined) // its status line's, this chat's
  const pr = t.preset === 'claude' ? presetOf(t) : undefined
  const said = t.model || pr?.model || (/--model\b/.test(pr?.args ?? '') ? pr!.args : '') // a model the tab or its profile names wins over claude's settings
  // the window claude said (the chat's, kept once the line is old), else a guess
  const max = s?.max ?? m?.max ?? (t.preset === 'claude' ? ((said ? /\[1m\]/i.test(said) : r?.big) || (m?.used ?? 0) > WINDOW ? 1e6 : WINDOW) : undefined)
  const live = s && Date.now() - s.mtime < STATUS_FRESH ? (s.used ?? (s.pct !== undefined && max ? Math.round((s.pct * max) / 100) : undefined)) : undefined
  const used = live ?? m?.used
  const bg = m && r!.bg
  return { ...(bg && (bg.bg.size || bg.done?.n) && { background: { now: [...bg.bg.values()], done: bg.done?.n ?? 0, last: bg.done?.last ?? [], ...(bg.done?.at && { at: bg.done.at }) } }), ...(m?.plan && !(m.plan.stale && planDone(m.plan)) && state.settings?.livePlan !== false && { plan: m.plan }), ...(used !== undefined && max && { context: { used, max } }), ...(m && m.tokens > 0 && { usage: { tokens: m.tokens, ...(m.priced && { cost: Math.round(m.cost * 1e4) / 1e4 }) } }) }
}

// ---------- Claude's status line (settings.statusBridge, on unless false): claude pipes a JSON of its own numbers to
// its status line command at each redraw; Laki's (core's statusLineSh, in its --settings file) keeps it per tab in
// <data>/statusline/<tab>.json, then runs yours with the same input. Its context (the window it really has) and its plan
// limits win over the transcript's guess and the usage endpoint while fresh. This Mac's claude tabs only
export const statusDir = join(dir, 'statusline')
export const statusSh = join(dir, 'statusline.sh')
export const STATUS_FRESH = 10 * 60_000
export const statusOn = () => state.settings?.statusBridge !== false
type Line = { mtime: number; session?: string; used?: number; pct?: number; max?: number; limits: UsageWindow[] }
const lines = new Map<string, Line>()
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
// a tab's, read again only when it changed (an mtime of its own); none: not written, or the setting off
export function statusOf(t: Tab): Line | undefined {
  if (!statusOn() || t.preset !== 'claude') return
  const f = join(statusDir, `${t.id}.json`)
  const mtime = statSync(f, { throwIfNoEntry: false })?.mtimeMs
  if (mtime === undefined) return void lines.delete(t.id)
  const had = lines.get(t.id)
  if (had?.mtime === mtime) return had
  const j = readJson<any>(f)
  const cw = j?.context_window
  const u = cw?.current_usage // null before its first answer
  const rl = j?.rate_limits // none before it, and with an API key
  const w = (x: any) => num(x?.used_percentage) !== undefined && { utilization: x.used_percentage, resets_at: num(x.resets_at) && new Date(x.resets_at * 1000).toISOString() } // seconds
  const line: Line = {
    mtime,
    session: typeof j?.session_id === 'string' ? j.session_id : undefined,
    used: u && typeof u === 'object' ? (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) : undefined,
    pct: num(cw?.used_percentage),
    max: num(cw?.context_window_size) || undefined,
    limits: claudeWindows({ five_hour: w(rl?.five_hour), seven_day: w(rl?.seven_day) }), // the endpoint's labels
  }
  lines.set(t.id, line)
  return line
}
// usage.ts' own: an account's limits from its tabs' newest fresh status line; none: ask the endpoint
export function statusLimits(w: { agent: string; account: string }, now = Date.now()) {
  if (w.agent !== 'claude') return
  let best: Line | undefined
  for (const t of state.tabs)
    if (t.preset === 'claude' && (t.account ?? HOME_ACCOUNT) === w.account) {
      const s = statusOf(t)
      if (s?.limits.length && now - s.mtime < STATUS_FRESH && s.mtime > (best?.mtime ?? 0)) best = s
    }
  return best && { windows: best.limits, at: best.mtime }
}
// your own status line, as claude reads it (the project's local settings, its committed ones, the account's, yours): the
// first command, resolved at the tab's start (a change waits for its restart). Never Laki's own: it would run itself.
// The project's from its own folder only, as .laki.json (core's cfgRead): never a worktree's, whose branch (a PR's
// checkout, an agent's edit) would pick the command Laki runs. ponytail: not managed settings, nor its padding (Laki's is 0)
export function ownStatusLine(ws: Workspace, t: Tab): string | undefined {
  const a = accountNamed(t.account)?.dir
  const root = state.projects.find(p => p.id === ws.project)?.path
  for (const f of [...(root ? [join(root, '.claude/settings.local.json'), join(root, '.claude/settings.json')] : []), ...(a ? [join(a, 'settings.json')] : []), join(homeDir('claude'), 'settings.json')]) {
    const s = readJson<any>(f)?.statusLine
    if (s?.type === 'command' && typeof s.command === 'string' && s.command.trim()) return s.command.includes(statusSh) ? undefined : s.command
  }
}
// a closed tab's (core's closeTab), and hourly every gone tab's
export const statusGone = (id: string) => rmSync(join(statusDir, `${id}.json`), { force: true })
export function statusTidy() {
  const live = new Set(state.tabs.map(t => t.id))
  for (const f of existsSync(statusDir) ? readdirSync(statusDir) : []) if (!live.has(f.replace(/(\.\d+)?\.(json|tmp)$/, ''))) rmSync(join(statusDir, f), { force: true })
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
