// A workspace's spend cap (Workspace.cap; unset: its first agent's profile's, else its project's): its agent tabs'
// meters summed, the status bar's numbers (meters.ts meterView: dollars of a priced chat, tokens of an unpriced one). At
// 80% one notice; at 100% its running turns get Stop's Esc as each tool call ends (claude's PostToolUse; another agent's
// at the next tick), Workspace.capOver, one push and one notice with three choices; sends wait in its tabs' queues while
// it's over (core's send and deliver). Only you raise or remove one: an agent may lower it (main.ts' agentNo), remote
// access at Answer only can't change it (wsSet's keys) nor pick a choice that raises it (alerts.ts' mac). A workflow's
// own budget holds in its runs too: whichever ends first stops it. core.ts imports it; capTick runs after meterTick.
// A closed tab's cost stays in the sum (Workspace.spentClosed, core.ts closeTab; tokens of an unpriced one don't).
// ponytail: a host's tabs aren't metered
import { type Cap, type CapView, capSpent, capText, COST_WARN, type CostLevel, type CostWarn, type Tab, type Workspace } from '../shared/types.ts'
import { alertShow } from './alerts.ts'
import { changed, findWs, input, log, presetOf, queueResume, rtOf, save, sessions, state, wsLog } from './core.ts'
import { meterView } from './meters.ts'
import { flowPhone } from './phone.ts'

const WARN = 0.8
const TOOL_WAIT = 60e3 // a tool call under way that long: stopped anyway
const agents = (w: { id: string }) => state.tabs.filter(t => t.workspace === w.id && t.kind === 'agent')
const some = (c?: Cap) => !!c && !!(c.usd || c.tokens)

// what a call says: a number or "$5" (dollars), "2M tokens" / "500k tokens", { usd, tokens }; null, '', 'none': no cap
export function capParse(v: unknown): Cap {
  if (v == null || v === '' || v === 'none') return {}
  const usd = (n: number) => {
    if (!(n >= 0.01 && n <= 100000)) throw new Error('a spend cap? dollars, 0.01 to 100000 ($5), or tokens (2M tokens)')
    return Math.round(n * 100) / 100
  }
  const tokens = (n: number) => {
    if (!(n >= 1000 && n <= 1e11)) throw new Error('a token cap? 1k to 100000M tokens')
    return Math.round(n)
  }
  if (typeof v === 'number') return { usd: usd(v) }
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    const d = /^\$?\s*(\d+(?:\.\d+)?)$/.exec(t)
    if (d) return { usd: usd(Number(d[1])) }
    const k = /^(\d+(?:\.\d+)?)\s*([km])?\s*tokens?$/.exec(t)
    if (k) return { tokens: tokens(Number(k[1]) * (k[2] === 'm' ? 1e6 : k[2] === 'k' ? 1e3 : 1)) }
    throw new Error(`a spend cap of ${v.slice(0, 40)}? $5, or 2M tokens`)
  }
  if (typeof v === 'object') {
    const o = v as { usd?: unknown; tokens?: unknown }
    return { ...(o.usd != null && { usd: usd(Number(o.usd)) }), ...(o.tokens != null && { tokens: tokens(Number(o.tokens)) }) }
  }
  throw new Error('a spend cap? $5, or 2M tokens')
}

// the cap that holds: its own ({}: none), its first agent's profile's, its project's
export function capOf(w: Workspace): Cap | undefined {
  const c = w.cap ?? agents(w).map(t => presetOf(t)?.cap).find(some) ?? state.projects.find(p => p.id === w.project)?.cap
  return some(c) ? c : undefined
}
// what its agents spent against it; share: the larger part of it spent (none: nothing measured against it)
export function capView(w: Workspace): CapView | undefined {
  const cap = capOf(w)
  if (!cap) return
  let usd = w.spentClosed ?? 0
  let tokens = 0
  let priced = usd > 0
  let counted = false
  for (const t of agents(w)) {
    const u = meterView(t).usage
    if (u?.cost !== undefined) (usd += u.cost), (priced = true)
    else if (u?.tokens) (tokens += u.tokens), (counted = true)
  }
  const parts = [cap.usd && priced ? usd / cap.usd : undefined, cap.tokens && counted ? tokens / cap.tokens : undefined].filter((x): x is number => x !== undefined)
  return { cap, ...(priced && { usd: Math.round(usd * 100) / 100 }), ...(counted && { tokens }), measured: parts.length > 0, ...(parts.length && { share: Math.max(...parts) }) }
}
export const capOver = (ws?: string) => !!ws && !!state.workspaces.find(w => w.id === ws)?.capOver

const nameOf = (w: Workspace) => w.name || w.id
// Laki's own notice in its window (alerts.ts; Recording mode hiding the workspace refuses it: logged)
const tell = (w: Workspace, text: string, choices?: string[], mac?: string[]) => {
  try {
    return Promise.resolve(alertShow({ text, to: w.id, ...(choices && { choices }) }, 'notice', 'Laki', undefined, mac))
  } catch (e) {
    log(`ws ${w.id}: its cap's notice: ${(e as Error).message}`)
  }
}

// #3: a workspace's cost warning. Its agents' priced chats summed (the status bar's tabs' meters; none priced: none);
// the amounts its project sets (on: false, none there), else Settings' when on, else none. Past yellow its cost shows
// yellow, past red red; each amount is told once, as its cost goes past it while Laki watches: one passed while Laki
// was off (a restart's first read) is marked told, never told late. A changed amount tells again.
// ponytail: a claude chat's subagents count as its meter does (their own transcripts aren't read)
export function wsUsd(w: { id: string; spentClosed?: number }) {
  let usd = w.spentClosed ?? 0
  let priced = usd > 0
  for (const t of agents(w)) {
    const c = meterView(t).usage?.cost
    if (c !== undefined) (usd += c), (priced = true)
  }
  return priced ? Math.round(usd * 100) / 100 : undefined
}
const amount = (v: unknown) => (typeof v === 'number' && v >= 0.01 && v <= 100000 ? Math.round(v * 100) / 100 : undefined)
// what a call says for one (Settings' or a project's): its amounts, on; null or {}: none
export function costWarnParse(v: unknown): CostWarn | undefined {
  if (v == null || typeof v !== 'object') return
  const o = v as Record<string, unknown>
  for (const k of ['yellow', 'red'] as const) if (o[k] != null && amount(o[k]) === undefined) throw new Error(`a cost warning's ${k}: dollars, 0.01 to 100000`)
  const c: CostWarn = { ...(typeof o.on === 'boolean' && { on: o.on }), ...(amount(o.yellow) && { yellow: amount(o.yellow) }), ...(amount(o.red) && { red: amount(o.red) }) }
  return Object.keys(c).length ? c : undefined
}
export function costWarnOf(w: Workspace): CostWarn | undefined {
  const own = state.projects.find(p => p.id === w.project)?.costWarn
  const all = state.settings?.costWarn
  if (own?.on === false) return
  const mine = !!(amount(own?.yellow) || amount(own?.red))
  if (!mine && all?.on !== true) return
  const pick = (k: CostLevel) => (mine ? amount(own?.[k]) : (amount(all?.[k]) ?? COST_WARN[k]))
  const warn = { yellow: pick('yellow'), red: pick('red') }
  return warn.yellow || warn.red ? warn : undefined
}
export function wsCost(w: Workspace) {
  const usd = wsUsd(w)
  if (usd === undefined) return
  const warn = costWarnOf(w)
  const level: CostLevel | undefined = warn?.red && usd >= warn.red ? 'red' : warn?.yellow && usd >= warn.yellow ? 'yellow' : undefined
  return { usd, ...(level && { level }), ...(warn && { warn }) }
}
const costSeen = new Map<string, number>() // a workspace's cost at the last tick: a crossing is one seen live
let costRead = false // the first tick read every chat there was: a workspace priced only since starts at $0
function costTick(w: Workspace) {
  const usd = wsUsd(w)
  if (usd === undefined) return
  const was = costSeen.get(w.id) ?? (costRead ? 0 : undefined)
  costSeen.set(w.id, usd)
  const warn = costWarnOf(w)
  if (!warn) return
  let told = false
  for (const k of ['red', 'yellow'] as const) { // past both at once: red's told, yellow's marked
    const at = warn[k]
    if (!at || usd < at || w.costTold?.[k] === at) continue
    w.costTold = { ...w.costTold, [k]: at }
    save()
    changed()
    if (was === undefined || was >= at || told) continue
    told = true
    wsLog(w, `its agents passed $${at} (the cost warning's ${k})`)
    void tell(w, `${nameOf(w)} has cost $${usd.toFixed(2)} so far, past your ${k} amount of $${at}.`)
  }
}

// every meter tick: the 80% notice, the 100% stop; while over, a turn that started anyway (typed in its terminal) stopped
export function capTick() {
  for (const w of state.workspaces) {
    if (w.archived) continue
    costTick(w)
    const v = capView(w)
    if (!v?.share) continue
    if (v.share >= 1 && !w.capOver) over(w, v)
    else if (v.share >= WARN && !w.capTold && !w.capOver) {
      w.capTold = true
      save()
      void tell(w, `${nameOf(w)} has spent ${capSpent(v)} of its ${capText(v.cap)} spend cap.`)
    }
    if (w.capOver) stopTurns(w)
  }
  costRead = state.settings?.contextMeter !== false || state.settings?.costs !== false // both off: meterTick read nothing, so turning one on later is a first read too
}

const stopped = new Map<string, number>() // tab → the capOver its Esc was for: once each
function stopTurns(w: Workspace, now = Date.now()) {
  for (const t of agents(w)) {
    const r = rtOf(t.id)
    if (r.status !== 'running') stopped.delete(t.id) // its Esc took: a turn it starts anyway (typed in its terminal) is stopped too
    if (r.status !== 'running' || !sessions.get(t.id) || sessions.get(t.id)!.exited || stopped.get(t.id) === w.capOver) continue
    if (r.inTool && now - r.inTool < TOOL_WAIT) continue // its tool call ends first (capToolEnd)
    stop(t, w)
  }
}
function stop(t: Tab, w: Workspace) {
  stopped.set(t.id, w.capOver!)
  input(t.id, '\x1b')
  wsLog(w, `${t.name} stopped: over its spend cap`)
}
// claude's PostToolUse (core's hook): a turn of a workspace over its cap stops as the tool call ends
export function capToolEnd(t: Tab) {
  const w = state.workspaces.find(x => x.id === t.workspace)
  if (w?.capOver && rtOf(t.id).status === 'running' && stopped.get(t.id) !== w.capOver) stop(t, w)
}

const ADD = (c: Cap) => `Add ${capText(c)} again`
const LEAVE = 'Leave it stopped'
const REMOVE = 'Remove the cap'
function over(w: Workspace, v: CapView) {
  w.capOver = Date.now()
  w.capTold = true
  save()
  changed()
  const text = `${nameOf(w)} spent ${capSpent(v)} of its ${capText(v.cap)} spend cap: its agents are stopped, and what you send waits.`
  log(`ws ${w.id}: over its spend cap (${capText(v.cap)})`)
  stopTurns(w)
  flowPhone(nameOf(w), undefined, 'is over its spend cap', text, 'Workspace')
  const add = ADD(v.cap)
  const at = w.capOver
  tell(w, text, [add, LEAVE, REMOVE], [add, REMOVE])
    ?.then(a => {
      const cur = state.workspaces.find(x => x.id === w.id)
      if (!cur || cur.capOver !== at || !a || !('choice' in a)) return
      if (a.choice === add) capSet(cur, { usd: v.cap.usd && Math.round(v.cap.usd * 200) / 100, tokens: v.cap.tokens && v.cap.tokens * 2 })
      else if (a.choice === REMOVE) capSet(cur, {})
    })
    .catch(e => log(`ws ${w.id}: its cap's notice: ${(e as Error).message}`))
}

// a cap set (wsSet's, the notice's choices): its 80% told again; one it's under now lets its turns and queues go on
export function capSet(w: Workspace, c: Cap) {
  w.cap = { ...(c.usd && { usd: c.usd }), ...(c.tokens && { tokens: c.tokens }) }
  delete w.capTold
  const v = capView(w)
  if (w.capOver && !(v?.share !== undefined && v.share >= 1)) {
    delete w.capOver
    for (const t of agents(w)) stopped.delete(t.id)
    save()
    for (const t of agents(w)) if (t.queue?.length) queueResume(t.id)
  }
  save()
  changed()
  wsLog(w, `spend cap: ${capText(w.cap)}`)
  return w
}

// an agent's wsSet: a cap it may set is a lower one (never none, never more of either part than holds now)
export function capRaises(ws: unknown, v: unknown) {
  const w = findWs(String(ws ?? ''))
  const was = capOf(w)
  const next = capParse(v)
  if (!some(next)) return !!was
  if (!was) return false
  return (['usd', 'tokens'] as const).some(k => was[k] !== undefined && !(next[k] !== undefined && next[k]! <= was[k]!))
}
