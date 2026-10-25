// what runs an extension besides its schedule: Laki's events and custom ones, gates before a ship, merge or archive,
// and streams (a fetch that runs all along). widgets.ts re-exports it.

import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { CUSTOM_EVENT, type EventSent, type Gate, type GateHeld, type WidgetEvent, type WidgetStream, type Workspace } from '../shared/types.ts'
import { actionCmd, gateOf } from '../shared/widgetSchema.ts'
import { type Entry, envOf, eventWs, exec, faceOf, type Failed, find, guarded, inProj, instOk, isObj, keep, keyOf, lastLine, onOf, outside, ownFetch, ran, RUN_JS, scoped, shown, sourceOf, tail, trusted, where, widgetAction, widgetRun, widgets, wLog, wsEnv, wsInfo, type WsInfo } from './widgets.ts'
import { agentIn, broadcast, callerAgent, changed, devLog, killGroup, own, state } from './core.ts'
import { filesHash } from './widgetTrust.ts'
import { approve, grant, grantKey } from './widgetTools.ts'
import { LOG_RUN, xlog } from './widgetLogs.ts'

// ---------- events (widget.json's on: { "<event>": "<action>" | "refresh" }): core calls widgetEvent as each happens.
// Every extension that's on and answers it runs that action, or fetches again, with LAKI_EVENT, the event's JSON on
// stdin and in LAKI_EVENT_FILE (deleted after) and reason event:<name>; a scope workspace one only its workspace's, in
// that instance. One at a time per extension, QUEUE_MAX waiting (past it the oldest goes). What a handler's action says
// (toast, modal) goes to the app's windows. Workflows with on: <event> start through eventHooks.flows (workflow.ts sets
// it: no import cycle). The last SENT_MAX events are kept in memory, with what they reached (laki widget events)
const QUEUE_MAX = 20
const EVENT_MAX = 64 << 10
export const HOPS_MAX = 3 // an emit made while handling an event is one hop more: past this, dropped (a loop)
const SENT_MAX = 50
type Job = { name: string; json: string; h: string; ws?: string; gone?: WsInfo; hops: number; agent?: string; of?: string; rec: EventSent } // agent: an agent's event (its from.agent); of: the event's workspace (whose Always); rec: what laki widget events says of it
type From = { widget?: string; tab?: { id: string; name: string }; agent?: string }
const queues = new Map<string, Job[]>()
const draining = new Set<string>()
const sent: EventSent[] = []
export const eventHooks: { flows?: (name: string, payload: Record<string, unknown>, ws: string | undefined, agent: string | undefined, hops: number) => { flows: string[]; refused: string[] } } = {}
// its handler of that event: on[name], or on["custom.*"] for a custom one
function handlerOf(w: Entry, name: string) {
  const on = w.m.on
  const h = !on ? undefined : Object.hasOwn(on, name) ? on[name] : name.startsWith('custom.') && Object.hasOwn(on, 'custom.*') ? on['custom.*'] : undefined
  return typeof h === 'string' ? h : undefined
}
export function widgetEvent(name: WidgetEvent, extra: Record<string, unknown> = {}, ws?: string, tab?: { id: string; name: string; preset?: string }, o: { from?: From; hops?: number } = {}) {
  const hops = o.hops ?? 0
  const x = ws ? state.workspaces.find(v => v.id === ws) : undefined
  const i = x && wsInfo(x)
  const head = { event: name, at: Date.now(), ...(x && { ws: eventWs(x) }), ...(tab && { tab: { id: tab.id, name: tab.name, agent: tab.preset } }), ...(o.from && { from: o.from }) }
  const rec: EventSent = { at: head.at, event: name, ...(x && { ws: x.id }), ...(o.from && { from: { widget: o.from.widget, tab: o.from.tab?.id, agent: o.from.agent } }), ...(hops && { hops }), widgets: [], flows: [] }
  sent.push(rec)
  if (sent.length > SENT_MAX) sent.shift()
  const flows = eventHooks.flows?.(name, { ...head, ...extra }, x?.id, o.from?.agent, hops)
  if (flows) Object.assign(rec, { flows: flows.flows }, flows.refused.length && { refused: flows.refused })
  if (![...widgets.values()].some(w => handlerOf(w, name))) return rec // none answers it: nothing built
  const fields = JSON.stringify(extra)
  const json = fields.length > EVENT_MAX ? JSON.stringify({ ...head, cut: true }) : JSON.stringify({ ...head, ...extra }) // ponytail: fields past 64 KB all go (the head's own room on top: an emit just under it arrives whole)
  for (const w of widgets.values()) {
    const h = handlerOf(w, name)
    if (!h || !onOf(w) || w.id === o.from?.widget) continue // never its own emits
    if (w.project && (x ? x.project !== w.project : !(name === 'app.open' || name.startsWith('custom.')))) continue // a repo's: its project's
    // its workspace's only; as one is archived or removed, that one's too (its action runs on what it was, keeps nothing)
    const going = (name === 'workspace.archived' || name === 'workspace.removed') && !!x && instOk({ ...x, archived: false })
    if (scoped(w) && !(x && (instOk(x) || going))) continue
    const q = queues.get(w.id) ?? []
    const at = scoped(w) ? x!.id : undefined
    if (h === 'refresh' && q.some(j => j.h === 'refresh' && j.ws === at && !j.gone)) {
      wLog(w, `event ${name}: a fetch for it waits already`) // one fetch after the burst, not one per event
      continue
    }
    q.push({ name, json, h, ws: at, gone: scoped(w) && going ? i : undefined, hops, agent: o.from?.agent, of: x?.id, rec })
    if (q.length > QUEUE_MAX) wLog(w, `event ${q.shift()!.name}: dropped, ${QUEUE_MAX} more waiting`, 'warn')
    queues.set(w.id, q)
    rec.widgets.push(w.id)
    void drain(w.id)
  }
  return rec
}
// ---------- gates (an action's "gate": ["ship", "merge", "archive"]): before Laki ships, merges or archives a
// workspace, each gate for that step runs: on, a scope workspace one only in a workspace it has (instOk), GATE_MAX at
// most, together, gateWait each. stdin and LAKI_EVENT_FILE: { gate, ws, pr, stat, by }, LAKI_GATE the step, the
// workspace's env. It prints { "ok": false, "why", "fix" } to hold the step. An error or no answer (#2: a crash, past
// gateWait, a repo gate whose files changed) holds it, "its gate failed", unless you started the step: then it goes ahead,
// said (a log line, a toast). An agent could make its gate fail (its tests hang) to get past it
const GATE_MAX = 8
const gateWait = () => Number(process.env.LAKI_GATE_MS) || 30_000 // tests' shorter
export type GateBy = 'you' | 'agent' | 'auto' | 'workflow'
export const gatesOf = (w: Entry, step?: Gate) => Object.entries(w.m.actions ?? {}).filter(([, a]) => (step ? gateOf(a).includes(step) : gateOf(a).length))
// the gates' extensions as they are now: a hold is tried again once one of them changed (Merge when green)
export const gatesKey = (ids: string[]) => ids.map(id => (w => (w ? `${id}:${onOf(w)}:${filesHash(w)}` : `${id}:gone`))(widgets.get(id))).join(',')
export async function widgetGates(step: Gate, x: Workspace, by: GateBy, facts: { pr: unknown; stat: unknown }): Promise<GateHeld[]> {
  const here = (w: Entry) => inProj(w, x) && (!scoped(w) || instOk(x))
  const all = [...widgets.values()].filter(w => onOf(w) && here(w)).flatMap(w => gatesOf(w, step).map(([a]) => ({ w, a })))
  // a repo's (or an agent's linked) gate that went off as its files changed (untrust: the watcher's scan, a second
  // later): it fails as changed, so a rewrite never takes its gate away from anyone but you
  const moved = [...widgets.values()].filter(w => !onOf(w) && guarded(w) && w.s.changed && here(w) && gatesOf(w, step).length)
  if (!all.length && !moved.length) return []
  for (const { w, a } of all.slice(GATE_MAX)) wLog(w, `gate ${a} (${step}): not run, ${GATE_MAX} gates at most for a step`, 'warn')
  const input = JSON.stringify({ gate: step, ws: wsInfo(x), pr: facts.pr ?? null, stat: facts.stat ?? null, by })
  const held: GateHeld[] = []
  for (const w of moved) {
    const name = w.m.name || w.id
    if (by !== 'you') {
      wLog(w, `gate (${step}, by ${by}): changed, off until you look: held`, 'error')
      held.push({ widget: w.id, name, gate: step, why: `its gate failed: ${name} changed ${where(w)}: off until you look`, ...(w.m.icon && { icon: w.m.icon }) })
    } else broadcast({ ev: 'widget-say', widget: w.id, toast: `${name}'s gate changed (off until you look). Went ahead` })
  }
  await Promise.all(
    all.slice(0, GATE_MAX).map(async ({ w, a }) => {
      const name = w.m.name || w.id
      const hold = (why: string, fix?: string) => void held.push({ widget: w.id, name, gate: step, why, ...(fix && { fix }), ...(w.m.icon && { icon: w.m.icon }) })
      const file = join(tmpdir(), `laki-gate-${randomBytes(8).toString('hex')}.json`)
      writeFileSync(file, input, { mode: 0o600 })
      const k = keyOf(w.id, scoped(w) ? x.id : undefined)
      const reason = `gate:${step}`
      const t0 = Date.now()
      let problem: string | undefined
      let changed = false
      // what it said: {"ok": …} (all of stdout, else its last line), whatever its exit code: a no that exits 1 is a no
      const said = (out: string) => {
        const j = [out, lastLine(out)].map(t => {
          try {
            return JSON.parse(t ?? '') as unknown
          } catch {
            return undefined
          }
        }).find(isObj)
        if (!j || typeof j.ok !== 'boolean') return false
        if (j.ok) return wLog(w, `gate ${a} (${step}, by ${by}): ok`), true
        const why = typeof j.why === 'string' && j.why.trim() ? j.why.trim().slice(0, 2000) : 'it said no'
        wLog(w, `gate ${a} (${step}, by ${by}): held: ${why}`, 'warn')
        hold(why, typeof j.fix === 'string' && j.fix.trim() ? j.fix.trim().slice(0, 8000) : undefined)
        return true
      }
      try {
        const { out, err } = await exec(w, '/bin/sh', ['-c', actionCmd(w.m.actions![a])!], { LAKI_REFRESH_REASON: reason, ...wsEnv(w, x), LAKI_GATE: step, LAKI_EVENT_FILE: file }, input, gateWait())
        ran(k, { at: t0, ms: Date.now() - t0, reason, why: by, action: a, ok: true, bytes: Buffer.byteLength(out), stderr: tail(err), exit: 0 }, err)
        if (!said(out)) problem = `printed no {"ok": …}: ${lastLine(out) ?? 'nothing'}`
      } catch (e) {
        const f = e as Failed
        ran(k, { at: t0, ms: Date.now() - t0, reason, why: by, action: a, ok: false, bytes: 0, error: f.message, stderr: tail(f.stderr), exit: f.exit }, f.stderr)
        if (!said(f.stdout ?? '')) (problem = f.message), (changed = !!f.changed)
      } finally {
        rmSync(file, { force: true })
      }
      if (problem === undefined) return
      if (by !== 'you') {
        wLog(w, `gate ${a} (${step}, by ${by}) failed: ${problem}: held`, 'error')
        return hold(`its gate failed: ${problem}`)
      }
      wLog(w, `gate ${a} (${step}) failed: ${problem}: went ahead`, 'error')
      broadcast({ ev: 'widget-say', widget: w.id, toast: changed ? `${name}'s gate changed (off until you look). Went ahead` : `${name}'s gate failed: ${problem.slice(0, 120)}. Went ahead` })
    }),
  )
  for (const h of held) widgetEvent('gate.held', { gate: h.gate, widget: h.widget, why: h.why }, x.id)
  return held
}

// an event of your own (laki widget emit, MCP's laki_extension_emit): custom.<name> with data (64 KB at most), from an
// extension's command (its LAKI_WIDGET), an agent's tab or you; hops: the event being handled when it was made (its
// handler's LAKI_EVENT_HOPS), one more here
export function widgetEmit(o: { name?: unknown; data?: unknown; ws?: unknown; from?: { widget?: unknown; tab?: unknown; ws?: unknown }; hops?: unknown; ai?: unknown; agent?: unknown }) {
  const raw = String(o.name ?? '').trim()
  const name = raw.startsWith('custom.') ? raw : `custom.${raw}`
  if (!CUSTOM_EVENT.test(name)) throw new Error(`${raw || '(none)'}: an event's name is letters, digits, . _ - (custom.<name>, 41 at most)`)
  const data = o.data === undefined ? {} : o.data
  if (JSON.stringify({ data }).length > EVENT_MAX) throw new Error(`its data is over ${EVENT_MAX >> 10} KB`) // as widgetEvent measures it
  const ws = typeof o.ws === 'string' && o.ws ? state.workspaces.find(x => x.id === o.ws || x.name === o.ws) : undefined
  if (o.ws && !ws) throw new Error(`no workspace ${o.ws}`)
  const t = typeof o.from?.tab === 'string' ? state.tabs.find(x => x.id === o.from!.tab) : undefined
  const widget = typeof o.from?.widget === 'string' && widgets.has(o.from.widget) ? o.from.widget : undefined
  // Laki AI's counts as an agent's, and so does one an extension makes handling an agent's event: the daemon's own
  // handling (its handler can't drop that), else its LAKI_EVENT_AGENT. The input may add an agent, never take one off
  const agent = callerAgent(o.from) ?? (o.ai === true ? 'Laki AI' : (widget && handling.get(widget)) || agentIn(o.agent))
  const from: From = { ...(widget && { widget }), ...(t && { tab: { id: t.id, name: t.name } }), ...(agent && { agent }) }
  const hops = o.hops === undefined || o.hops === '' ? 0 : (Number(o.hops) || 0) + 1
  if (hops > HOPS_MAX) {
    const w = widget ? widgets.get(widget) : undefined
    if (w) wLog(w, `emit ${name}: dropped, ${hops} hops (a loop of events?)`, 'warn')
    sent.push({ at: Date.now(), event: name, ...(ws && { ws: ws.id }), from: { widget, tab: t?.id, agent }, hops, widgets: [], flows: [], refused: [`${hops} hops: dropped`] })
    if (sent.length > SENT_MAX) sent.shift()
    return { ok: false, dropped: `${hops} hops: a loop of events? dropped` }
  }
  const rec = widgetEvent(name as WidgetEvent, { data }, ws?.id, undefined, { from, hops })
  return { ok: true, event: name, widgets: rec.widgets, flows: rec.flows }
}
export const widgetEvents = () => [...sent].reverse()
async function drain(id: string) {
  if (draining.has(id)) return
  draining.add(id)
  try {
    for (let j = queues.get(id)?.shift(); j; j = queues.get(id)?.shift()) await handle(id, j).catch(e => wLog({ id }, `event ${j!.name}: ${(e as Error).message}`, 'error'))
  } finally {
    draining.delete(id)
    queues.delete(id)
  }
}
// an extension handling an agent's event: that agent's, until its handler ends (an event it emits meanwhile is the agent's)
const handling = new Map<string, string>()
async function handle(id: string, j: Job) {
  const w = widgets.get(id)
  if (!w || !onOf(w)) return
  // an agent's event and an action: a command the user never asked for, asked first as an agent's tool is (Always: for
  // that action as it is now, in the event's workspace); a fetch isn't asked
  if (j.agent && j.h !== 'refresh') {
    const ws = j.of ?? ''
    const key = grantKey(w, j.h, true)
    if (!state.widgetGrants?.[ws]?.includes(key)) {
      const how = await approve(w, j.h, { description: `Its "${j.h}" action, on ${j.name}: an event ${j.agent} sent`, ask: 'first', ws: ws || undefined, agent: j.agent }).catch((e: Error) => {
        wLog(w, `event ${j.name} from ${j.agent}: action ${j.h} not run: ${e.message}`, 'warn')
        ;(j.rec.refused ??= []).push(`${id}: ${j.h} not run: ${e.message}`)
      })
      if (!how) return
      if (how === 'always') grant(w, j.h, ws, key)
    }
  }
  const file = join(tmpdir(), `laki-event-${randomBytes(8).toString('hex')}.json`)
  writeFileSync(file, j.json, { mode: 0o600 })
  const ev = { env: { LAKI_EVENT: j.name, LAKI_EVENT_FILE: file, LAKI_EVENT_HOPS: String(j.hops), ...(j.agent && { LAKI_EVENT_AGENT: j.agent }) }, stdin: j.json, gone: j.gone }
  if (j.agent) handling.set(id, j.agent)
  try {
    if (j.h === 'refresh' && j.gone) wLog(w, `event ${j.name}: not fetched: ${j.gone.name} is gone, nothing to keep (an action runs on it)`)
    else if (j.h === 'refresh') {
      const r = await widgetRun({ id, reason: `event:${j.name}`, ws: j.ws }, false, ev)
      if (!r.ok) wLog(w, `event ${j.name}: not fetched: ${r.error}`, 'warn')
    } else {
      const r = await widgetAction({ id, action: j.h, ws: j.ws }, `event:${j.name}`, ev)
      if (r.ok && (r.toast || r.modal || r.close)) broadcast({ ev: 'widget-say', widget: id, ws: j.ws, toast: r.toast, modal: r.modal, close: r.close })
    }
  } finally {
    rmSync(file, { force: true })
    handling.delete(id)
  }
}

// ---------- streams (widget.json's stream: true; global ones only): its fetch runs all along (spawn), each line of
// JSON it prints its data, other lines its log. The view follows at most every 250 ms, the store every 5 s and as it
// ends. It runs while it's on and a window was shown in the last STREAM_IDLE (and within widgetHours); it stops when
// it's off, gone, reloaded, Stopped in Settings › Resources (until Fetch now, a switch or a reload) and at shutdown;
// after an exit it starts again 1, 2, 4… 60 s later (1 again once it ran a minute)
type Stream = { p?: ChildProcess; since?: number; restarts: number; last?: string; next?: number; wait: number; timer?: NodeJS.Timeout; view?: NodeJS.Timeout; save?: NodeJS.Timeout; data?: unknown; unsaved?: boolean; ending?: boolean; stopped?: boolean; err: string }
export const streams = new Map<string, Stream>()
const STREAM_IDLE = 10 * 60_000
let shownAt = 0 // the last time a window was shown
export const streaming = (w: Entry) => w.m.stream === true && !scoped(w) && sourceOf(w).kind === 'fetch' && ownFetch(w)
export function streamSync(now = Date.now()) {
  if (shown()) shownAt = now
  const ok = (w: Entry) => now - shownAt < STREAM_IDLE && !outside(w, now)
  for (const [id, st] of streams) {
    const w = widgets.get(id)
    if (w && streaming(w) && onOf(w) && !w.s.mock && ok(w)) continue
    if (st.stopped && w && onOf(w)) continue // a Stop stays while it's on: nothing runs
    stopStream(id)
  }
  for (const w of widgets.values()) if (streaming(w) && onOf(w) && !w.s.mock && ok(w) && !streams.get(w.id)?.stopped) startStream(w)
}
function startStream(w: Entry) {
  const was = streams.get(w.id)
  if (was?.p || was?.timer) return
  try {
    trusted(w)
  } catch {
    return
  }
  const script = w.m.script ? resolve(w.dir, w.m.script) : undefined
  if (script && !script.startsWith(w.dir + '/')) return
  const st: Stream = was ?? { restarts: 0, wait: 1, err: '' }
  streams.set(w.id, st)
  const p = spawn(script ? process.execPath : '/bin/sh', script ? ['--input-type=module', '-e', RUN_JS, script] : ['-c', w.m.fetch!], { cwd: w.dir, env: envOf(w, { LAKI_REFRESH_REASON: 'stream', ...(script && process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) }), stdio: ['ignore', 'pipe', 'pipe'], detached: true }) // its group: a stop ends what it started
  own(p, `Extension · ${w.m.name || w.id} (stream)`, `stream:${w.id}`)
  Object.assign(st, { p, since: Date.now(), next: undefined, ending: false })
  wLog(w, `stream: ${script ? `node ${w.m.script}` : w.m.fetch}`)
  createInterface({ input: p.stdout! }).on('line', line => {
    st.last = line.slice(0, 500)
    let d: unknown
    try {
      d = JSON.parse(line)
    } catch {
      devLog(`widget:${w.id}`, `stream: ${line.slice(0, 300)}`)
      return xlog(w, 'info', 'stream', line)
    }
    st.data = d
    st.unsaved = true
    st.view ??= setTimeout(() => streamView(w.id), 250)
  })
  let part = '' // a line cut between two reads
  p.stderr!.on('data', b => {
    st.err = (st.err + b).slice(-4096)
    const lines = (part + b).split('\n')
    part = lines.pop()!.slice(-LOG_RUN)
    if (lines.length) xlog(w, 'info', 'stream', lines.join('\n'))
  })
  p.stderr!.on('end', () => part && xlog(w, 'info', 'stream', part))
  p.on('error', e => wLog(w, `stream: ${e.message}`, 'error'))
  p.on('exit', (code, sig) => {
    st.p = undefined
    streamView(w.id, true)
    const up = Date.now() - (st.since ?? Date.now())
    ran(w.id, { at: st.since ?? Date.now(), ms: up, reason: 'stream', ok: !code || st.ending === true, bytes: 0, error: code && !st.ending ? lastLine(st.err) || `exit ${code}` : undefined, stderr: tail(st.err), exit: code ?? 0 })
    st.err = ''
    changed()
    if (st.ending || streams.get(w.id) !== st) return // stopped
    if (up >= 60_000) st.wait = 1
    st.restarts++
    st.next = Date.now() + st.wait * 1000
    wLog(w, `stream ended (${sig ?? `exit ${code}`}) after ${Math.round(up / 1000)} s: again in ${st.wait} s`)
    st.timer = setTimeout(() => {
      st.timer = undefined
      if (streams.get(w.id) === st && !st.stopped) streamSync()
    }, st.wait * 1000)
    st.wait = Math.min(60, st.wait * 2)
  })
  changed()
}
// its last line to the view (at), and to the store every 5 s (end: now)
function streamView(id: string, end = false) {
  const st = streams.get(id)
  const w = widgets.get(id)
  if (!st || !w) return
  clearTimeout(st.view)
  st.view = undefined
  if (st.data !== undefined && st.unsaved) {
    w.s = { ...w.s, at: Date.now(), error: undefined }
    w.face = faceOf(w, st.data)
    changed()
  }
  const save = () => {
    clearTimeout(st.save)
    st.save = undefined
    if (!st.unsaved) return
    st.unsaved = false
    keep(w, undefined, s => ((s.data = st.data), (s.at = w.s.at), (s.error = undefined)))
  }
  if (end) save()
  else st.save ??= setTimeout(save, 5000)
}
export function stopStream(id: string, park = false) {
  const st = streams.get(id)
  if (!st) return
  clearTimeout(st.timer)
  st.timer = undefined
  st.ending = true
  streamView(id, true)
  if (st.p) killGroup(st.p)
  if (park) (st.stopped = true), (st.next = undefined)
  else streams.delete(id)
  changed()
}
// Settings › Resources' Stop: until Fetch now, a switch or a reload
export const widgetStreamStop = (id: string) => stopStream(find(id).id, true)
export const streamOf = (id: string): WidgetStream | undefined => (st => st && { running: !!st.p, since: st.p ? st.since : undefined, restarts: st.restarts, last: st.last, next: st.timer ? st.next : undefined, stopped: st.stopped })(streams.get(id))
