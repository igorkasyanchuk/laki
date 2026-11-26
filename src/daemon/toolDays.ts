// What agents call (Settings › Agents & profiles › What agents call): each day's calls, gate refusals and errors per API
// method, from callers classed as an agent only (main.ts' call, through the CLI or laki mcp; their hooks aside), and each
// method's last error, its first 120 characters through share.ts' redact (never the params). <data>/tool-days.json,
// TOOL_KEEP days, written at most once a minute and as the daemon stops (toolDaysSave); in backups (dir.ts BACKUP_KEEP).
// Counting is in memory, sync, in a try: no await on the call's path and it never fails a call
import { join } from 'node:path'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { oldName } from '../shared/caps.ts'
import { tools } from '../shared/tools.ts'
import { dir } from './dir.ts'
import { redact } from './share.ts'

export const TOOL_KEEP = 30
export const TOOL_SHOWN = 7 // the days agentCalls sums
type Row = { calls: number; refused: number; errors: number }
type Kept = { days: Record<string, Record<string, Row>>; last: Record<string, { at: number; text: string }> }
const path = () => join(dir, 'tool-days.json')
let kept: Kept | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const keptNow = () => (kept ??= (k => (k && typeof k.days === 'object' && typeof k.last === 'object' ? k : { days: {}, last: {} }))(readJson<Kept>(path())))
const dayOf = (t: number) => (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date(t))

// one agent's call: ok, refused by a gate (before its method ran) or failed (its method threw)
export function toolCount(method: string, how: 'ok' | 'refused' | 'error', err?: unknown, now = Date.now()) {
  try {
    const r = ((keptNow().days[dayOf(now)] ??= {})[method] ??= { calls: 0, refused: 0, errors: 0 })
    r.calls++
    if (how === 'refused') r.refused++
    if (how === 'error') r.errors++
    if (how !== 'ok') keptNow().last[method] = { at: now, text: redact(String((err as Error)?.message ?? err ?? '').trim().split('\n')[0]).slice(0, 120) }
    timer ??= setTimeout(toolDaysSave, Number(process.env.LAKI_TOOL_SAVE_MS) || 60_000).unref()
  } catch {}
}
// written out (the minute's timer, and shutdown's), the days past TOOL_KEEP dropped
export function toolDaysSave(now = Date.now()) {
  clearTimeout(timer)
  timer = undefined
  if (!kept) return
  const from = dayOf(now - TOOL_KEEP * 864e5)
  for (const d of Object.keys(kept.days)) if (d < from) delete kept.days[d]
  try {
    writeAtomic(path(), JSON.stringify(kept))
  } catch {}
}

// the methods each of Laki's tools calls (tools.ts): its run, handed an rpc that only notes the name and never answers.
// ponytail: what a run calls before its first await (its validation of the args aside); a tool that calls none
// with no args is left out
let byTool: Map<string, string[]> | undefined
function toolMethods() {
  if (byTool) return byTool
  byTool = new Map()
  let seen: string[] = []
  const rpc = ((m: string) => (seen.push(oldName(m)), new Promise(() => {}))) as Parameters<typeof tools>[0]
  for (const t of tools(rpc)) {
    seen = []
    try {
      void Promise.resolve(t.run({})).catch(() => {})
    } catch {}
    if (seen.length) byTool.set(t.name, [...new Set(seen)])
  }
  return byTool
}

// agentCalls (the user's): the last TOOL_SHOWN days summed per method, the most failing share first, then the most
// called; each with its last error; the tools none of whose methods agents called then
export function agentCalls(now = Date.now()) {
  const k = keptNow()
  const from = dayOf(now - (TOOL_SHOWN - 1) * 864e5)
  const sum = new Map<string, Row>()
  for (const [d, rows] of Object.entries(k.days))
    if (d >= from)
      for (const [m, r] of Object.entries(rows)) {
        const s = sum.get(m) ?? (sum.set(m, { calls: 0, refused: 0, errors: 0 }), sum.get(m)!)
        s.calls += r.calls
        s.refused += r.refused
        s.errors += r.errors
      }
  const share = (r: Row) => (r.refused + r.errors) / (r.calls || 1)
  const rows = [...sum].map(([method, r]) => ({ method, ...r, ...(k.last[method] && { last: k.last[method] }) })).sort((a, b) => share(b) - share(a) || b.calls - a.calls)
  const unused = [...toolMethods()].filter(([, ms]) => !ms.some(m => sum.has(m))).map(([t]) => t)
  return { days: TOOL_SHOWN, rows, unused }
}
