// claude's and codex's transcripts, read as they grow: a tab's context and usage meters, and today's spend. core.ts
// imports it, and its users import it directly.

import { closeSync, createReadStream, existsSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { planDone } from '../shared/todos.ts'
import { type ChatHit, type Goal, HOME_ACCOUNT, type Parts, partsAdd, priceOf, type Tab, type TabView, type Today, type UsageWindow, type Workspace } from '../shared/types.ts'
import { accountNamed, homeDir } from './accounts.ts'
import { changed, chatFile, findWs, keptChat, keptOnly, openPath, presetOf, state } from './core.ts'
import { type Spend, type SpendEntry, spendBreakdown, spendEntries } from '../shared/spend.ts'
import { dir } from './dir.ts'
import { type BgRead, bgOf, type BgTask, type ByModel, chatOf, dayOf, daysRows, isOld, type McpCall, type Meter, meterCost, meterNew, meterOf, num, type Owns, type Row, rowCost, rowTokens, partsMax, type Said, transcriptOf, type UseRec } from './share.ts'
export type { McpCall }
import { claudeWindows } from './usage.ts'
import { acpChat } from './acp.ts'
import { agentDays, agentDaysTidy } from './agentUsage.ts'

// ---------- transcripts: a claude or codex tab's (share.ts' transcriptOf), read as it grows, by shared tabs and the meters

export type Tail = { file?: string; looked?: number; for?: string; since?: number; pos?: number; kept?: true } // kept: file is Laki's copy (core's chatFile) // for: the chat it looked for, since when
const SHARE_READ = 32 << 20 // a transcript's most read at once: a longer one starts there (ponytail: its start is left out)
// what was written to the tab's transcript since t's last read, whole lines only (the last may be half written); ''
// nothing new; undefined none (another agent, a host's, not found yet, empty); fresh: it's read from its start again
// (this chat's file found, or written anew)
export function tailOf(tab: Tab, t: Tail, fresh: (was?: true) => void): string | undefined { // was: the file before was Laki's copy
  const agent = tab.preset
  if ((agent !== 'claude' && agent !== 'codex') || !tab.resumeId || state.workspaces.find(w => w.id === tab.workspace)?.host) return
  // a chat's looked for again every 10 s at most (codex's: a walk of every session, here on the daemon's thread), every 2
  // minutes once it's been missing for one (a chat gone, another account's folder): a new chat's is written at its first
  // turn, whose end looks again at once (meterRead's look)
  const now = Date.now()
  if (t.for !== tab.resumeId) (t.for = tab.resumeId), (t.since = now), (t.looked = 0)
  const ours = (f?: string): f is string => !!f && (f.endsWith(`${tab.resumeId}.jsonl`) || (tab.kept === tab.resumeId && f === keptChat(state.workspaces.find(w => w.id === tab.workspace), tab.id))) // its own, or Laki's copy of it
  if (t.file && !existsSync(t.file)) (t.file = undefined), (t.looked = 0) // gone (an agent deleted its old chat): looked for at once, Laki's copy if it kept one
  if ((!ours(t.file) || t.kept) && now - (t.looked ?? 0) > (now - t.since! < 60000 ? 10000 : 120000)) {
    t.looked = now
    const c = chatFile(tab) // reading a copy: the agent's own may come back (a restore's)
    if (c?.file !== t.file || !ours(t.file)) {
      const was = t.kept
      ;(t.file = c?.file), (t.kept = c?.kept), (t.pos = 0), fresh(was)
    }
  }
  const file = t.file
  if (!ours(file)) return void (t.file = undefined) // another chat's: none until this one's is found
  return readOn(file, t, fresh)
}
// what a file has past t.pos, whole lines only (the last may be half written); '' nothing new; undefined empty or gone;
// fresh: it's read from its start again (written anew)
function readOn(file: string, t: { pos?: number }, fresh: () => void): string | undefined {
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
  if (!size) return
  t.pos ??= 0
  if (size < t.pos) (t.pos = 0), fresh() // written anew
  if (size - t.pos > SHARE_READ) t.pos = size - SHARE_READ // the line it lands in is cut off: JSON.parse skips it
  if (size === t.pos) return ''
  const buf = Buffer.alloc(size - t.pos)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, buf.length, t.pos)
  } finally {
    closeSync(fd)
  }
  const cut = buf.lastIndexOf(10) + 1
  t.pos += cut
  return buf.subarray(0, cut).toString('utf8')
}

// Reader view: a claude or codex tab's chat as what was said (share.ts' chatOf), read on as it grows; v moves with it
// (the renderer asks every 1.5 s with the v it has: the same, no said back); none: no transcript (another agent, a
// host's, not written yet). ponytail: the newest 400 sent whole at each change
// bg: what a claude chat runs in the background now (share.ts bgOf: the chips over the Reader's box). past: the tab's
// earlier chats (a /clear, codex's /new: its session changed), each ending in a New session line; chat: the one read now
type Reader = Tail & { said: Said[]; v: number; bg: BgRead; calls: Map<string, McpCall>; ids: Map<string, number>; past?: Said[]; chat?: string; old?: true } // old: past is Laki's copy of a chat the agent deleted (keptOnly)
const readers = new Map<string, Reader>()
const bgNew = (): BgRead => ({ bg: new Map(), wait: new Map() })
const bgDone = (): BgRead => ({ ...bgNew(), done: { n: 0, last: [] } })
export function chatRead(p: { tab: string; v?: number }): { none?: boolean; v?: number; said?: Said[]; bg?: BgTask[]; from?: number; kept?: true } {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab) throw new Error('no such tab')
  for (const id of readers.keys()) if (!state.tabs.some(t => t.id === id)) readers.delete(id) // closed tabs'
  const acp = acpChat(tab.id) // an ACP tab's: what acp.ts kept as it came
  if (acp) return p.v === acp.v ? { v: acp.v } : { v: acp.v, said: acp.said.slice(-400) }
  const r = readers.get(tab.id) ?? (readers.set(tab.id, { said: [], v: 0, bg: bgNew(), calls: new Map(), ids: new Map(), ...(k => k && { past: [...keptSaid(tab.preset!, k), { who: 'new', text: '' } as Said], old: true })(keptOnly(tab)) }), readers.get(tab.id)!)
  const text = tailOf(tab, r, was => {
    if (r.chat && r.chat !== tab.resumeId && r.said.length) (r.past = [...(r.past ?? []), ...r.said, { who: 'new', text: '' } as Said].slice(-400)), was && (r.old = true) // the chat read from Laki's copy, now above a new one
    r.chat = tab.resumeId
    ;(r.said = []), (r.bg = bgNew()), (r.calls = new Map()), (r.ids = new Map()), r.v++
  })
  if (text === undefined && !r.past) return { none: true } // a /clear's chat not written yet: the earlier ones and the line
  if (text) chatOf(tab.preset!, text, r.said, tab.preset === 'claude' ? r.calls : undefined, tab.preset === 'claude' ? r.ids : undefined), tab.preset === 'claude' && bgOf(text, r.bg), r.v++
  if (r.calls.size > 300) for (const k of [...r.calls.keys()].slice(0, r.calls.size - 200)) r.calls.delete(k) // the newest 200 (callsOf's)
  if (r.ids.size > 3000) for (const k of [...r.ids.keys()].slice(0, r.ids.size - 2000)) r.ids.delete(k) // a result comes soon after its call
  if (p.v === r.v) return { v: r.v }
  const all = r.past ? [...r.past, ...r.said] : r.said
  const cut = Math.max(0, all.length - 400)
  const from = cut - (r.past?.length ?? 0) // said[k] is what's sent's [k - from]: MCP Apps' at (mcpApps.ts)
  return { v: r.v, said: all.slice(cut), ...(from !== 0 && { from }), ...(r.bg.bg.size > 0 && { bg: [...r.bg.bg.values()] }), ...((r.kept || r.old) && { kept: true }) }
}
// a kept copy's chat, whole (its newest SHARE_READ): what a restored tab's agent deleted, above its New session line
function keptSaid(agent: string, file: string): Said[] {
  try {
    const size = statSync(file).size
    const n = Math.min(size, SHARE_READ)
    const buf = Buffer.alloc(n)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, n, size - n)
    } finally {
      closeSync(fd)
    }
    const said: Said[] = []
    chatOf(agent, buf.toString('utf8'), said)
    return said.slice(-400)
  } catch {
    return []
  }
}

// what a claude tab's chat left running in the background as its process ended (its transcript read now, its last
// BG_READ: bgOf; ponytail: a task started before that is missed): a restart's restoreNow and a wake from sleep tell the
// resumed agent they're gone. None: another agent, a host's, no chat or transcript
const BG_READ = 8 << 20 // read as each tab is restored, in the way of everything else: the meters' SHARE_READ is 32 MB
export function bgLeft(tab: Tab): BgTask[] {
  if (tab.preset !== 'claude' || !tab.resumeId || state.workspaces.find(w => w.id === tab.workspace)?.host) return []
  try {
    const file = transcriptOf('claude', accountNamed(tab.account)?.dir ?? homeDir('claude'), tab.resumeId)
    const size = file ? (statSync(file, { throwIfNoEntry: false })?.size ?? 0) : 0
    if (!size) return []
    const n = Math.min(size, BG_READ)
    const buf = Buffer.alloc(n)
    const fd = openSync(file!, 'r')
    try {
      readSync(fd, buf, 0, n, size - n)
    } finally {
      closeSync(fd)
    }
    return [...bgOf(buf.toString('utf8'), bgNew()).bg.values()]
  } catch {
    return [] // gone or unreadable meanwhile: the tab resumes all the same, nothing said
  }
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
// every 10 s (main.ts' meterTick) and as a turn ends, with its chat's other transcripts (extraFiles: claude's
// subagents, codex's threads it spawned), whose spend is the tab's and never its context. Today's by chat in
// <data>/usage-today.json: a closed tab's stays, and a restart reading each chat anew counts it once (the more of the two)
// bg: a claude chat's background tasks (share.ts bgOf), running and ended: the status bar's Background chip. ponytail:
// read with the meters, so none while both the context meter and costs are off
// subs: the other transcripts' meters, by path; sum: its spend and theirs together; keyFile: the file each answer key
// counted in (a codex thread's copy of its parent's turns counts once); kids: codex's spawned threads, looked for now and then
type Sub = { pos?: number; m: Meter }
type Sum = Pick<Meter, 'tokens' | 'by' | 'days'>
type MeterRun = Tail & { m: Meter; big?: boolean; bg: BgRead; subs: Map<string, Sub>; sum?: Sum; keyFile: Map<string, string>; kids?: { at: number; files: string[] } } // big: claude's own settings run it on a 1M window
const meters = new Map<string, MeterRun>()
const todayPath = join(dir, 'usage-today.json')
// name: its workspace's as it was, so one removed since is still named in Today; models: today's rows, the ledger's (the
// old one under '': a chat kept before parts, its tokens and cost, until the chat's read again)
type TodayChat = { ws: string; name?: string; tokens: number; models: Record<string, Row> }
let spent: { day: string; chats: Record<string, TodayChat> } | undefined
// (none for a private one, or one of a private project: Recording mode hides them, never named here)
const nameOf = (ws: string) => (w => (w && !w.private && !state.projects.find(p => p.id === w.project)?.private ? w.name || w.id : undefined))(state.workspaces.find(x => x.id === ws))
function spentNow() {
  const day = dayOf(Date.now())
  if (!spent) spent = readJson(todayPath)
  if (spent?.day !== day || typeof spent.chats !== 'object') spent = { day, chats: {} }
  for (const c of Object.values(spent.chats)) if (!c.models || typeof c.models !== 'object') c.models = { '': { tokens: num(c.tokens) ?? 0, cost: num((c as { cost?: unknown }).cost) ?? 0 } }
  return spent
}
// today's of the chats the ledger moved (todo), from it: their rows of today as it has them, their workspace's name
const todo = new Set<string>()
function todayFlush() {
  if (!todo.size) return
  const s = spentNow()
  const day = s.day
  for (const id of todo) {
    const c = keptNow().chats[id]
    const models = { ...c?.pre?.[day], ...c?.days[day] }
    if (!c || !Object.keys(models).length) continue
    s.chats[id] = { ws: c.ws, name: nameOf(c.ws) ?? s.chats[id]?.name, tokens: Object.values(models).reduce((n, r) => n + rowTokens(r), 0), models }
  }
  todo.clear()
  writeAtomic(todayPath, JSON.stringify(s))
}
// true: it read something new
export function meterRead(tab: Tab, look = false) { // look: a turn's end, its transcript looked for now
  const r: MeterRun = meters.get(tab.id) ?? { m: meterNew(), bg: bgDone(), subs: new Map(), keyFile: new Map() }
  meters.set(tab.id, r)
  if (look) r.looked = 0
  const big = tab.preset === 'claude' && state.settings?.contextMeter !== false && claudeBig(tab) // read each time: settings change without the transcript
  const was = lines.get(tab.id)
  const moved = big !== r.big || statusOf(tab) !== was // its status line written since
  r.big = big
  const text = tailOf(tab, r, () => ((r.m = meterNew()), (r.bg = bgDone()), (r.subs = new Map()), (r.keyFile = new Map()), (r.sum = r.kids = undefined)))
  if (text === undefined) return moved
  const now = Date.now()
  let read = false
  if (text) {
    meterOf(tab.preset!, text, r.m, now, ownsOf(tab, r, r.file!))
    if (tab.preset === 'claude') bgOf(text, r.bg)
    read = true
  }
  for (const f of extraFiles(tab, r)) {
    const sub = r.subs.get(f) ?? (r.subs.set(f, { m: meterNew() }), r.subs.get(f)!)
    const t = readOn(f, sub, () => (sub.m = meterNew()))
    if (t) meterOf(tab.preset!, t, sub.m, now, ownsOf(tab, r, f)), (read = true)
  }
  if (!read) return moved
  r.sum = r.subs.size ? meterSum([r.m, ...[...r.subs.values()].map(x => x.m)]) : r.m // the ledger has each answer as it was read (ownsOf)
  return true
}
function meterSum(ms: Meter[]): Sum {
  const sum: Sum = { tokens: 0, by: {}, days: {} }
  const add = (to: ByModel, by: ByModel) => {
    for (const [model, p] of Object.entries(by)) for (const [k, v] of Object.entries(p)) ((x => (x[k] = (x[k] ?? 0) + v))((to[model] ??= {})))
  }
  for (const m of ms) {
    sum.tokens += m.tokens
    add(sum.by, m.by)
    for (const [d, by] of Object.entries(m.days ?? {})) add((sum.days![d] ??= {}), by)
  }
  return sum
}
// a chat's other transcripts: claude's subagents (<its file without .jsonl>/subagents/*.jsonl, each read on as it
// grows), codex's threads it spawned (codexKids, looked for every 30 s). None for Laki's copy of a chat
const KIDS_LOOK = 30_000
function extraFiles(tab: Tab, r: Pick<MeterRun, 'file' | 'kept' | 'kids'>): string[] {
  const f = r.file
  if (!f || r.kept || !f.endsWith(`${tab.resumeId}.jsonl`)) return []
  if (tab.preset === 'claude') {
    const d = join(f.slice(0, -'.jsonl'.length), 'subagents')
    try {
      return readdirSync(d).filter(x => x.endsWith('.jsonl')).sort().map(x => join(d, x))
    } catch {
      return []
    }
  }
  if (!r.kids || Date.now() - r.kids.at > KIDS_LOOK) r.kids = { at: Date.now(), files: codexKids(f, tab.resumeId!) }
  return r.kids.files
}
// codex's threads a chat spawned (spawn_agent): a rollout whose session_meta names a parent (its source's
// parent_thread_id) in the chat or one of its threads, each once; looked for in the day folders from the chat's own on
// (sessions/<y>/<m>/<d>), each file's first line read once (parents)
const parents = new Map<string, string | null>() // a rollout's parent thread; null: none
const THREAD = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
const head = Buffer.alloc(1 << 20)
function parentOf(f: string): string | null | undefined {
  if (parents.has(f)) return parents.get(f)
  let fd: number | undefined
  try {
    fd = openSync(f, 'r')
    const n = readSync(fd, head, 0, head.length, 0)
    const end = head.subarray(0, n).indexOf(10)
    if (end < 0 && n < head.length) return // its first line not written whole yet: looked at again
    const line = head.subarray(0, end < 0 ? 0 : end).toString('utf8')
    const p = /"type"\s*:\s*"session_meta"/.test(line) ? (/"parent_thread_id"\s*:\s*"([0-9a-f-]{36})"/i.exec(line)?.[1]?.toLowerCase() ?? null) : null
    if (parents.size > 20000) parents.clear()
    parents.set(f, p)
    return p
  } catch {
    return
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
export function codexKids(file: string, id: string): string[] {
  const day = dirname(file)
  const root = dirname(dirname(dirname(day)))
  const from = relative(root, day).split(sep).join('/') // 2026/11/27
  const ls = (d: string) => {
    try {
      return readdirSync(d).sort()
    } catch {
      return []
    }
  }
  const files: string[] = []
  for (const y of ls(root))
    if (/^\d{4}$/.test(y) && y >= from.slice(0, 4))
      for (const mo of ls(join(root, y)))
        if (`${y}/${mo}` >= from.slice(0, 7)) for (const d of ls(join(root, y, mo))) if (`${y}/${mo}/${d}` >= from) for (const x of ls(join(root, y, mo, d))) if (x.startsWith('rollout-') && x.endsWith('.jsonl')) files.push(join(root, y, mo, d, x))
  const ids = new Set([id.toLowerCase()])
  const out: string[] = []
  for (let grew = true; grew; ) {
    grew = false
    for (const f of files) {
      if (f === file || out.includes(f)) continue
      const p = parentOf(f)
      if (!p || !ids.has(p)) continue
      out.push(f)
      const t = THREAD.exec(f)?.[1]
      if (t) ids.add(t.toLowerCase())
      grew = true
    }
  }
  return out
}

// A1: its /goal as its transcript says now (read on at once); a claude or codex tab's. A1b: another agent's is the one
// Laki runs (tab.goalRun: verify.ts), with its turns and what the chat spent since it was set
export function goalOf(tab: Tab): Goal | undefined {
  if (tab.goalRun) return meterView(tab).goal
  if (tab.preset !== 'claude' && tab.preset !== 'codex') return
  meterRead(tab, true)
  const r = meters.get(tab.id)
  return r?.file?.endsWith(`${tab.resumeId}.jsonl`) ? r.m.goal : undefined
}
// a reached or failed goal leaves the banner as you send the next prompt (a working or paused one stays)
export const ownGoal = (t: Tab, cost?: number): Goal => {
  const g = t.goalRun!
  const spent = cost === undefined ? undefined : Math.max(0, cost - (g.cost0 ?? 0))
  return { text: g.text, state: g.state, at: g.at, own: true, check: g.check, turns: g.turns, maxTurns: g.maxTurns, ...(spent !== undefined && { spent: Math.round(spent * 100) / 100 }), ...(g.maxUsd && { maxUsd: g.maxUsd }), ...(g.why && { why: g.why }) }
}
export function goalSeen(tab: Tab) {
  const m = meters.get(tab.id)?.m
  if (m?.goal && (m.goal.state === 'reached' || m.goal.state === 'failed')) m.goal = undefined
}

// W2: what a tab's chat cost so far at API prices (its meter, read on now: look, its transcript looked for at once), the
// workflows' agent turns; undefined: unknown (not claude or codex, a host's, no transcript yet, no price for its model)
export function chatCost(tab: Tab, look = false): number | undefined {
  if (meterRead(tab, look)) changed()
  const r = meters.get(tab.id)
  const c = r?.file?.endsWith(`${tab.resumeId}.jsonl`) ? meterCost((r.sum ?? r.m).by) : undefined
  return c?.priced ? c.cost : undefined
}
// what the chat's lines from before since cost (a forked chat's parent's, copied in; a tab whose transcript wasn't found
// as its turn began), so a turn counts only its own; its other transcripts' too, and the answers it owns only, as its
// meter counts. ponytail: the whole transcripts read, once per such turn; by each line's timestamp
export function chatCostBefore(tab: Tab, since: number): number | undefined {
  const r = meters.get(tab.id)
  const f = r?.file
  if (!f?.endsWith(`${tab.resumeId}.jsonl`) || !tab.preset) return
  const o = ownersNow()
  const once = new Set<string>() // a key counted in one of its files only, as keyFile does (a codex thread's copy of its parent's turns)
  const owns: Owns = key => (o.get(key) ?? tab.resumeId) === tab.resumeId && !once.has(key) && !!once.add(key)
  let cost = 0
  for (const file of [f, ...r!.subs.keys()]) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      if (file === f) return
      continue
    }
    const old = text.split('\n').filter(l => (t => Number.isFinite(t) && t < since)(Date.parse(/"timestamp":"([^"]+)"/.exec(l)?.[1] ?? '')))
    cost += meterCost(meterOf(tab.preset, old.join('\n'), meterNew(), Date.now(), owns).by).cost
  }
  return cost
}

// ---------- the ledger: <data>/usage-days.json, the only one (the Usage page's days, Today's), by chat (its session id),
// USAGE_KEEP days back. Each answer an agent's API call was billed for counts once: its key (share.ts answerKey; Grok's,
// agy's and OpenCode's: agentUsage.ts) is owned by the first chat to report it, kept with its day (keys, gone with it),
// and its parts added to that chat's day and model as it's claimed. Every reader goes through ledger(): a Laki tab's
// live read (meterRead's ownsOf, otherRead) and the machine scan (usageScan.ts). A copy of an answer in a forked or
// resumed chat counts nowhere else. grow: an answer claimed in the last GROW_MS and its parts so far: a later line of it
// (a subagent's output grows as it streams) adds what grew, the larger of each part, over a restart too. pre: what was
// kept before every row had keys (0.68.0's rows from before parts, Grok's, agy's and OpenCode's totals), shown as it is
// until the chat's read again (its first record): the recount replaces it outright; a chat whose transcript is gone keeps
// it. skip: chats Laki's own runs made (Laki AI's call log counts them: usageSkip)
export const USAGE_KEEP = 90
const LEDGER_V = 2
const GROW_MS = 10 * 60_000 // ponytail: an answer whose lines are further apart than this counts its earlier ones only
const daysPath = join(dir, 'usage-days.json')
type Days = Record<string, Record<string, Row>> // by day, then model
// ws: its workspace ('' run outside Laki: dir, the folder it ran in, its newest line's)
type KeptChat = { ws: string; agent: string; days: Days; keys?: Record<string, string>; pre?: Days; dir?: string; made?: number } // made: usageWs's, kept empty until the scan finds it
type Kept = { v?: number; chats: Record<string, KeptChat>; grow?: Record<string, [chat: string, at: number, day: string, model: string, p: Parts]>; skip?: Record<string, number> }
let kept: Kept | undefined
let owners: Map<string, string> | undefined // an answer's key: the chat that owns it
let daysT: ReturnType<typeof setTimeout> | undefined
function keptNow() {
  if (kept) return kept
  const k = readJson<Kept>(daysPath)
  kept = k && typeof k.chats === 'object' ? k : { v: LEDGER_V, chats: {} }
  if (kept.v !== LEDGER_V) { // 0.68.0's: its rows no key backs (all but parts) are pre
    for (const c of Object.values(kept.chats))
      for (const [d, models] of Object.entries(c.days ?? {})) {
        for (const [m, r] of Object.entries(models)) if (!('p' in r)) (((c.pre ??= {})[d] ??= {})[m] = r), delete models[m]
        if (!Object.keys(models).length) delete c.days[d]
      }
    kept.v = LEDGER_V
  }
  return kept
}
function ownersNow() {
  if (owners) return owners
  owners = new Map()
  for (const [id, c] of Object.entries(keptNow().chats)) for (const s of Object.values(c.keys ?? {})) for (let i = 0; i + 11 <= s.length; i += 11) owners.set(s.slice(i, i + 11), id)
  return owners
}
// one answer into the ledger: false when another chat owns it (or Laki's own run made the chat). ws: a Laki tab's
// workspace (the chat's rows move there: an outside chat resumed in a tab); none: the scan's (the chat's folder kept
// while no tab claimed it)
export function ledger(r: UseRec, ws?: string): boolean {
  const k = keptNow()
  if (k.skip?.[r.chat]) return false
  const c = (k.chats[r.chat] ??= { ws: ws ?? '', agent: r.agent, days: {} })
  if (ws !== undefined && c.ws !== ws) (c.ws = ws), delete c.dir, todo.add(r.chat), daysLater()
  else if (ws === undefined && !c.ws && r.cwd && c.dir !== r.cwd) (c.dir = r.cwd), daysLater()
  if (c.pre) delete c.pre, todo.add(r.chat), daysLater() // read again: the recount replaces what was kept before keys
  const o = ownersNow()
  const by = o.get(r.key)
  if (by !== undefined && by !== r.chat) return false
  if (by === undefined) {
    o.set(r.key, r.chat)
    ;(c.keys ??= {})[r.day] = (c.keys[r.day] ?? '') + r.key
    rowAdd(r.chat, c, r.day, r.model, r)
    if (r.p) (k.grow ??= {})[r.key] = [r.chat, Date.now(), r.day, r.model, r.p]
    return true
  }
  const g = k.grow?.[r.key]
  if (!g || !r.p) return true
  const d: Parts = {}
  for (const [x, v] of Object.entries(r.p)) if (v > (g[4][x] ?? 0)) d[x] = v - (g[4][x] ?? 0)
  if (Object.keys(d).length) rowAdd(r.chat, c, g[2], g[3], { p: d }), (g[4] = partsMax(g[4], r.p))
  return true
}
function rowAdd(id: string, c: KeptChat, day: string, model: string, r: Pick<UseRec, 'p' | 'own'>) {
  const d = (c.days[day] ??= {})
  const was = d[model]
  if (r.p) d[model] = { p: partsAdd(was && 'p' in was ? { ...was.p } : {}, r.p) }
  else if (r.own) {
    const w = was && !('p' in was) ? was : undefined
    const cost = r.own.cost === undefined && w?.cost === undefined ? undefined : (w?.cost ?? 0) + (r.own.cost ?? 0)
    d[model] = { tokens: (w?.tokens ?? 0) + r.own.tokens, ...(cost !== undefined && { cost }), own: true }
  }
  if (day === dayOf(Date.now())) todo.add(id)
  daysLater()
}
// Laki's own runs' chats (Laki AI's, a side chat's fork): never counted here, its call log has them
export function usageSkip(id: string | undefined) {
  if (!id) return
  ;(keptNow().skip ??= {})[id] = Date.now()
  daysLater()
}
// a chat Laki ran outside a tab (a side chat's fork): its workspace's, wherever the scan finds it
export function usageWs(id: string | undefined, ws: string, agent: string) {
  if (!id) return
  const c = (keptNow().chats[id] ??= { ws, agent, days: {}, made: Date.now() })
  if (c.ws !== ws) (c.ws = ws), delete c.dir, todo.add(id)
  daysLater()
}
// a tab's file's answers: one counts if no other chat reported it first (a forked or resumed chat's copied lines are
// the first one's) and no other file of this tab counted it (a codex thread's copy of its parent's turns)
const ownsOf = (tab: Tab, r: MeterRun, file: string): Owns => (key, day, model, p) => {
  const was = r.keyFile.get(key)
  if (was !== undefined && was !== file) return false
  if (!ledger({ chat: tab.resumeId!, agent: tab.preset!, key, day, model, p }, tab.workspace)) return false
  r.keyFile.set(key, file)
  return true
}
const timeOf = (day: string) => (([y, m, d]) => new Date(y, m - 1, d).getTime())(day.split('-').map(Number))
// written a moment later, once for every tab a tick read (and as the daemon stops: main.ts' shutdown)
function daysLater() {
  if (daysT) return
  daysT = setTimeout(daysWrite, 2000)
  daysT.unref?.()
}
export function daysWrite() {
  clearTimeout(daysT)
  daysT = undefined
  todayFlush()
  const k = kept
  if (!k) return
  const from = Date.now() - USAGE_KEEP * 864e5
  let gone = false
  for (const [id, x] of Object.entries(k.chats)) {
    for (const d of Object.keys(x.days)) if (timeOf(d) < from) delete x.days[d]
    for (const d of Object.keys(x.pre ?? {})) if (timeOf(d) < from) delete x.pre![d]
    if (x.pre && !Object.keys(x.pre).length) delete x.pre
    for (const d of Object.keys(x.keys ?? {})) if (timeOf(d) < from) delete x.keys![d], (gone = true)
    if (!Object.keys(x.days).length && !x.pre && !((x.made ?? 0) > from)) delete k.chats[id], (gone = true)
  }
  for (const [key, g] of Object.entries(k.grow ?? {})) if (Date.now() - g[1] > GROW_MS) delete k.grow![key]
  for (const [id, at] of Object.entries(k.skip ?? {})) if (at < from) delete k.skip![id]
  if (gone) owners = undefined // read again from what's kept
  writeAtomic(daysPath, JSON.stringify(k))
}
// usageDays: the Usage page's rows, a day, agent and model each (YYYY-MM-DD, this Mac's day), every chat's added up
// and its workspace's id (ws: the Usage page's Where it went names it, or says it's gone), priced by today's table
// (costOf). priced: false, tokens with no price (none for its model; agy's); old: some kept before parts, at their cost
// then; read and input: its cache reads of all its input (the cache's share), parts' only
export const usageDays = () => ({ keep: USAGE_KEEP, rows: daysRows(Object.fromEntries(Object.entries(keptNow().chats).map(([id, c]) => [id, c.pre ? { ...c, days: daysJoin(c.days, c.pre) } : c]))) })
const daysJoin = (a: Days, b: Days): Days => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(d => [d, { ...b[d], ...a[d] }]))
// ponytail: claude's API retries (meterOf's retry: the Reader's line, the tab's Retrying…) come with this read too; both
// meters off, none show
export function meterTick() {
  if (state.settings?.contextMeter === false && state.settings?.costs === false) return
  let any = false
  const archived = new Set(state.workspaces.filter(w => w.archived).map(w => w.id)) // nothing to read until it's back
  for (const t of state.tabs) if (t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex') && !archived.has(t.workspace)) any = meterRead(t) || any
  for (const t of state.tabs) if (t.kind === 'agent' && (t.preset === 'grok' || t.preset === 'gemini' || t.preset === 'opencode') && !archived.has(t.workspace)) any = otherRead(t) || any
  for (const id of meters.keys()) if (!state.tabs.some(t => t.id === id)) meters.delete(id)
  agentDaysTidy(id => state.tabs.some(t => t.id === id)) // grok's and agy's, closed
  for (const id of lines.keys()) if (!state.tabs.some(t => t.id === id)) lines.delete(id)
  if (any) changed()
}
// Grok's, Antigravity's and OpenCode's chats (agentUsage.ts): each answer into the ledger, under the tab's workspace
// (Grok's and OpenCode's at their own price, agy's tokens only). This Mac's only
function otherRead(t: Tab) {
  const ws = state.workspaces.find(w => w.id === t.workspace)
  if (!ws || ws.host) return false
  return agentDays(t, ws.path, recs => {
    for (const x of recs) ledger(x, t.workspace)
    changed()
  })
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
// B7: a skill the tab's chat loaded, its SKILL.md in your editor (the context meter's menu): by its name, from the
// folder the transcript said, else the workspace's .claude/skills or .codex/skills, else the agent's own skills folder
export async function skillOpen(p: { tab?: unknown; name?: unknown }) {
  const t = state.tabs.find(x => x.id === p.tab)
  const s = t && meters.get(t.id)?.m.skills?.find(x => x.name === p.name)
  if (!t || !s) throw new Error('not a skill its chat loaded')
  const ws = state.workspaces.find(w => w.id === t.workspace)
  const short = s.name.split(':').pop()!
  const dirs = [s.path?.replace(/^~(?=\/)/, homedir()), ws && join(ws.path, `.${t.preset}`, 'skills', short), join(accountNamed(t.account)?.dir ?? homeDir(t.preset as 'claude' | 'codex'), 'skills', short)]
  const f = dirs.flatMap(d => (d ? [join(d, 'SKILL.md')] : [])).find(f => statSync(f, { throwIfNoEntry: false })?.isFile())
  if (!f) throw new Error(`${s.name}'s SKILL.md isn't where its chat said${s.path ? ` (${s.path})` : ''}`)
  await openPath(f, 'editor', ws?.project)
  return { path: f }
}
export function meterView(t: Tab): Pick<TabView, 'context' | 'usage' | 'plan' | 'background' | 'retry' | 'skills' | 'goal'> {
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
  const now = bg ? [...bg.bg.values()].filter(x => !t.bgTold?.includes(x.id)) : [] // not the ones a restart stopped (restoreNow told it)
  const sum = m && (r!.sum ?? m) // its subagents' and spawned threads' spend too
  const c = sum && sum.tokens > 0 ? meterCost(sum.by) : undefined
  const cost = c?.priced ? Math.round(c.cost * 1e4) / 1e4 : undefined
  const none = c && Object.keys(c.none)
  const goal = t.goalRun ? ownGoal(t, cost) : m?.goal // A1b: Laki's
  return { ...(goal && { goal }), ...(m?.skills?.length && { skills: m.skills }), ...(m?.retry && { retry: m.retry }), ...(bg && (now.length || bg.done?.n) && { background: { now, done: bg.done?.n ?? 0, last: bg.done?.last ?? [], ...(bg.done?.at && { at: bg.done.at }) } }), ...(m?.plan && !(m.plan.stale && planDone(m.plan)) && state.settings?.livePlan !== false && { plan: m.plan }), ...(used !== undefined && max && { context: { used, max } }), ...(sum && sum.tokens > 0 && { usage: { tokens: sum.tokens, ...(cost !== undefined && { cost }), ...(none?.length && { unpriced: none }) } }) }
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
// usage.ts' own: an account's limits from its tabs' status lines (claude's) or transcripts' rate_limits (codex's, R4),
// chosen window by window: an idle claude rewrites its status line with the numbers it had, so the newest file can be
// behind. Of a label's readings the one with the later reset wins (a newer window); with the same reset, the higher
// percent (usage never falls inside a window), then the newer. One past its reset counts as 0, as the window shows it
// (Usage.tsx live). Fresh readings only, unless any (the endpoint isn't asked: of any age); at: the oldest reading chosen
export function statusLimits(w: { agent: string; account: string }, now = Date.now(), any = false) {
  const best = new Map<string, { w: UsageWindow; at: number }>()
  const take = (windows: UsageWindow[], at: number) => {
    if (!any && now - at >= STATUS_FRESH) return
    for (const x of windows) {
      const b = best.get(x.label)
      const [r, rb] = [x.resets ?? 0, b?.w.resets ?? 0]
      if (!b || r > rb || (r === rb && (x.used > b.w.used || (x.used === b.w.used && at > b.at)))) best.set(x.label, { w: x, at })
    }
  }
  for (const t of state.tabs)
    if (t.preset === w.agent && (t.account ?? HOME_ACCOUNT) === w.account) {
      if (w.agent === 'claude') (s => s?.limits.length && take(s.limits, s.mtime))(statusOf(t))
      else if (w.agent === 'codex') (l => l && take(l.windows, l.at))(meters.get(t.id)?.m.limits)
    }
  if (!best.size) return
  return { windows: [...best.values()].map(x => x.w), at: Math.min(...[...best.values()].map(x => x.at)) }
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

// today's, the workspaces that used most first (5); unpriced: the models with no price, their tokens
export function todayView(): Today | undefined {
  todayFlush()
  const chats = Object.values(spentNow().chats)
  if (!chats.length) return
  const ws = new Map<string, { ws: string; name?: string; tokens: number; cost: number }>()
  const none = new Map<string, number>()
  let tokens = 0
  let cost = 0
  for (const c of chats) {
    const w = ws.get(c.ws) ?? { ws: c.ws, tokens: 0, cost: 0 }
    ws.set(c.ws, w)
    w.name = state.workspaces.some(x => x.id === c.ws) ? nameOf(c.ws) : (c.name ?? w.name) // its name now (none if private), a removed one's as it was kept
    for (const [model, r] of Object.entries(c.models)) {
      const n = rowTokens(r)
      const usd = rowCost(model, r)
      ;(w.tokens += n), (tokens += n)
      if (usd === undefined || (model && isOld(r) && !usd && !priceOf(model))) none.set(model, (none.get(model) ?? 0) + n)
      else (w.cost += usd), (cost += usd)
    }
  }
  return { tokens, cost: Math.round(cost * 100) / 100, ws: [...ws.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, 5).map(w => ({ ...w, cost: Math.round(w.cost * 100) / 100 })), ...(none.size && { unpriced: [...none].map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens) }) }
}

// Search chats (⇧⌘F, ⌘K): every claude and codex chat Laki knows: its workspaces' agent tabs (an archived one's too) and
// the tabs closed there that ⇧⌘T keeps, newest file first, each read a line at a time (never whole). What you and the
// agent said, case-insensitively, spaces as one (tools: the tools' calls and output too); newest first, limit hits (50)
// or what SEARCH_MS found, then more. Recording mode: no private workspace's. A host's (SSH) chats are there: left out
const SEARCH_MS = 3000
let searchN = 0 // the newest search: an older one still reading stops (the window asked again as you typed)
export async function chatSearch(p: { q?: unknown; limit?: unknown; tools?: unknown }): Promise<{ hits: ChatHit[]; more?: true }> {
  const q = String(p?.q ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!q) throw new Error('search for what?')
  const limit = Math.max(1, Math.min(200, Math.floor(Number(p.limit) || 50)))
  const tools = p.tools === true
  const end = Date.now() + SEARCH_MS
  const mine = ++searchN
  const veil = !!state.settings?.recording
  const hid = new Set(veil ? state.projects.filter(x => x.private).map(x => x.id) : [])
  const files = new Map<string, Omit<ChatHit, 'at' | 'who' | 'text' | 'id'> & { mtime: number }>()
  const add = (ws: Workspace, agent: string | undefined, id: string | undefined, account: string | undefined, name: string, tab?: string) => {
    if ((agent !== 'claude' && agent !== 'codex') || !id) return
    const live = tab ? state.tabs.find(t => t.id === tab) : undefined
    const file = live ? chatFile(live)?.file : transcriptOf(agent, accountNamed(account)?.dir ?? homeDir(agent), id) // a tab's: Laki's copy when its own is gone
    const st = file && !files.has(file) ? statSync(file, { throwIfNoEntry: false }) : undefined
    if (st) files.set(file!, { ws: ws.id, ...(tab && { tab }), name, agent, mtime: st.mtimeMs })
  }
  for (const w of state.workspaces) {
    if (w.host || (veil && (w.private || hid.has(w.project)))) continue
    for (const t of state.tabs)
      if (t.workspace === w.id && t.kind === 'agent') {
        add(w, t.preset, t.resumeId, t.account, t.name, t.id)
        const k = keptOnly(t) // a restored tab's old chat, Laki's copy
        const st = k && !files.has(k) ? statSync(k, { throwIfNoEntry: false }) : undefined
        if (st && (t.preset === 'claude' || t.preset === 'codex')) files.set(k!, { ws: w.id, tab: t.id, name: t.name, agent: t.preset, mtime: st.mtimeMs })
      }
    for (const c of w.closed ?? []) add(w, c.preset, c.resumeId, c.account, c.name)
  }
  // a word of q as the JSON line has it (no quote, backslash or other escape): lines without it aren't parsed
  const pre = q.split(' ').filter(w => /^[\x20-\x7e]+$/.test(w) && !/["\\]/.test(w)).sort((a, b) => b.length - a.length)[0]
  const hits: ChatHit[] = []
  let more = false
  for (const [file, f] of [...files].sort((a, b) => b[1].mtime - a[1].mtime)) {
    if (hits.length >= limit || Date.now() > end || mine !== searchN) {
      more = true
      break
    }
    const room = limit - hits.length
    const found: ChatHit[] = [] // this file's newest room, oldest first
    const input = createReadStream(file, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let n = 0
    try {
      for await (const line of lines) {
        n++
        if (Date.now() > end || mine !== searchN) {
          more = true
          break
        }
        if (pre && !line.toLowerCase().includes(pre)) continue
        for (const s of saidIn(f.agent, line, tools)) {
          const flat = s.text.replace(/\s+/g, ' ').trim()
          const i = flat.toLowerCase().indexOf(q)
          if (i < 0) continue
          const from = Math.max(0, Math.min(i - 50, flat.length - 160))
          found.push({ ws: f.ws, ...(f.tab && { tab: f.tab }), name: f.name, agent: f.agent, ...(s.at && { at: s.at }), who: s.who, text: `${from > 0 ? '…' : ''}${flat.slice(from, from + 160)}${from + 160 < flat.length ? '…' : ''}`, id: s.id ?? `L${n}` })
          if (found.length > room) (found.shift(), (more = true))
        }
      }
    } catch {} // a file gone meanwhile: what it had
    lines.close()
    input.destroy()
    hits.push(...found.reverse())
  }
  return { hits, ...(more && { more: true as const }) }
}

// one transcript line's messages for chatSearch (share.ts' chatOf: what you and the agent said, the tools' calls), with
// the tools' output when asked (claude's tool_result, codex's function_call_output) and the line's id (claude's uuid)
function saidIn(agent: string, line: string, tools: boolean): { who: 'you' | 'agent' | 'tool'; text: string; at?: number; id?: string }[] {
  let j: { uuid?: unknown; timestamp?: string; type?: string; message?: { content?: unknown }; payload?: { type?: unknown; output?: unknown } }
  try {
    j = JSON.parse(line) ?? {}
  } catch {
    return []
  }
  const id = typeof j.uuid === 'string' ? j.uuid : undefined
  const out: { who: 'you' | 'agent' | 'tool'; text: string; at?: number; id?: string }[] = chatOf(agent, line)
    .filter(s => s.who === 'you' || s.who === 'agent' || (tools && s.who === 'tool'))
    .map(s => ({ who: s.who as 'you' | 'agent' | 'tool', text: s.text, at: s.at, id }))
  if (!tools) return out
  const at = (t => (Number.isFinite(t) ? t : undefined))(Date.parse(String(j.timestamp)))
  const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (typeof x?.text === 'string' ? x.text : '')).join('\n') : '')
  const content = j.message?.content
  if (agent === 'claude' && j.type === 'user' && Array.isArray(content)) for (const x of content) x?.type === 'tool_result' && out.push({ who: 'tool', text: text(x.content), at, id })
  if (agent === 'codex' && j.type === 'response_item' && /_output$/.test(String(j.payload?.type))) out.push({ who: 'tool', text: text(j.payload?.output), at })
  return out.filter(s => s.text)
}

// ---------- where a workspace's tokens went (shared/spend.ts): its claude and codex tabs' transcripts as entries (their
// subagents' and spawned threads' too: extraFiles), kept by file and size (a transcript read again only once it grew), then one breakdown over them all. wsSpend: the user's, an
// agent's for its own workspace (main.ts' agentNo); laki spend, Info's and the Proof card's Where it went
const spendKept = new Map<string, { size: number; at: number; entries: SpendEntry[] }>()
const SPEND_AGAIN = 30_000 // a transcript that grew (an agent at work) read again at most this often: an estimate needn't be live
const SPEND_READ = 64 << 20 // ponytail: a transcript's last 64 MB; its start left out past that (a cut line is skipped)
export function wsSpend(p: { ws?: unknown }): Spend & { tabs: number } {
  const ws = findWs(String(p?.ws ?? ''))
  const entries: SpendEntry[] = []
  let tabs = 0
  for (const t of state.tabs.filter(t => t.workspace === ws.id && (t.preset === 'claude' || t.preset === 'codex'))) {
    const c = !ws.host && t.resumeId ? chatFile(t) : undefined
    if (!c?.file || !statSync(c.file, { throwIfNoEntry: false })?.size) continue
    for (const f of [c.file, ...extraFiles(t, { file: c.file, kept: c.kept, kids: meters.get(t.id)?.kids })]) entries.push(...spendOf(t, f, ws.path))
    tabs++
  }
  return { ...spendBreakdown(entries), tabs }
}
function spendOf(t: Tab, f: string, cwd: string): SpendEntry[] {
  const size = statSync(f, { throwIfNoEntry: false })?.size ?? 0
  if (!size) return []
  let kept = spendKept.get(f)
  if (kept?.size !== size && !(kept && Date.now() - kept.at < SPEND_AGAIN)) {
    const fd = openSync(f, 'r')
    const buf = Buffer.alloc(Math.min(size, SPEND_READ))
    try {
      readSync(fd, buf, 0, buf.length, size - buf.length)
    } finally {
      closeSync(fd)
    }
    kept = { size, at: Date.now(), entries: spendEntries(t.preset!, buf.toString('utf8'), cwd) }
    spendKept.delete(f)
    spendKept.set(f, kept)
    if (spendKept.size > 200) spendKept.delete(spendKept.keys().next().value!)
  }
  return kept.entries
}
