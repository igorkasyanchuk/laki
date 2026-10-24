// prompts for later: the board's to-dos, the calendar's reminders and scheduled tasks. core.ts re-exports it.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { flowsOn, HOME_ACCOUNT, isAgent, type Pending, type PendingView, type Reminder, REMINDERS_MAX, type Schedule, type ScheduleRun, type Todo, USAGE_AT, resetOf, type Workspace } from '../shared/types.ts'
import { nextRun, parseAt, parseWhen, stamp, wsTitle } from '../shared/when.ts'
import { type Block as FlowBlock, FLOW_ENDED, inputVals } from '../shared/workflow.ts'
import { usageWho } from './accounts.ts'
import { addTab, broadcast, byTab, changed, clients, dir, findProject, findWs, presetNamed, save, send, slug, state, tabsOf, tail, tracked, wsLog, wsNew } from './core.ts'
import { usage } from './usage.ts'
import { isLive } from './resources.ts'
import { widgetEvent, widgetName, widgetUse, widgetUseCheck } from './widgets.ts'

// ---------- the board's to-dos (Board.tsx): prompts waiting for a workspace; starting one is wsNew, then todoRm

// images: pasted ones and attached files, imageSave's and fileSave's paths (only those: their paths go into the prompt),
// kept by imagesTidy while it waits
export function todoAdd(o: { project: string; text: string; images?: string[] }) {
  const p = findProject(o.project)
  const text = String(o.text ?? '').trim()
  const kept = [join(dir, 'images') + sep, join(dir, 'files') + sep]
  const images = (Array.isArray(o.images) ? o.images : []).filter((x): x is string => typeof x === 'string' && kept.some(k => resolve(x).startsWith(k)) && existsSync(x)).slice(0, 10)
  if (!text && !images.length) throw new Error('a to-do needs its text')
  const t: Todo = { id: randomUUID().slice(0, 8), project: p.id, text, at: Date.now(), ...(images.length && { images }) }
  state.todos!.push(t)
  save()
  changed()
  return t
}

export function todoRm(o: { id: string }) {
  state.todos = state.todos!.filter(t => t.id !== o.id)
  save()
  changed()
}

// ---------- the calendar's reminders (Calendar.tsx, experimental): a note for a moment, from the app, Laki AI, an agent or
// the CLI; reminderTick rings each once as it's due, while a client is on (one due while the app was closed rings as it opens)

export const REMINDERS_DONE = 92 * 86400000 // a done one is in the view (the Calendar) this long after its time
const reminderOf = (id: string) => {
  const r = state.reminders!.find(x => x.id === id)
  if (!r) throw new Error(`no reminder ${id}`)
  return r
}
const calendarOn = () => {
  if (state.settings?.calendar !== true) throw new Error('turn Calendar on first: Settings › General › Experimental')
}
const reminderText = (t: unknown) => {
  const text = typeof t === 'string' ? t.trim() : ''
  if (!text) throw new Error('a reminder needs its text')
  return text.slice(0, 2000)
}
const reminderAt = (at: unknown) => {
  const r = parseAt(at as string | number)
  if (typeof r !== 'number') throw new Error(r.error)
  return r
}

export function reminderAdd(o: { at: number | string; text: string; ws?: string; project?: string; by?: string; tab?: string }) {
  calendarOn()
  const text = reminderText(o.text)
  const at = reminderAt(o.at)
  const ws = o.ws ? findWs(o.ws) : undefined
  const project = ws?.project ?? (o.project ? findProject(o.project).id : undefined)
  const by = (typeof o.by === 'string' && o.by.trim().slice(0, 80)) || byTab(o.tab) // said, else the tab it came from
  const r: Reminder = { id: randomUUID().slice(0, 8), at, text, made: Date.now(), ...(ws && { ws: ws.id }), ...(project && { project }), ...(by && { by }) }
  const all = [...state.reminders!, r]
  // ponytail: past REMINDERS_MAX the oldest rung ones go, then the oldest; a list, not a database
  while (all.length > REMINDERS_MAX) all.splice(all.findIndex(x => x.fired) >= 0 ? all.findIndex(x => x.fired) : 0, 1)
  state.reminders = all.sort((a, b) => a.at - b.at)
  save()
  changed()
  return r
}

// text, at (moved: it rings again), done, ws ('' none)
export function reminderSet(o: { id: string; text?: string; at?: number | string; done?: boolean; ws?: string }) {
  calendarOn()
  const r = reminderOf(o.id)
  if (o.text !== undefined) r.text = reminderText(o.text)
  if (o.at !== undefined) {
    r.at = reminderAt(o.at)
    if (r.at > Date.now()) delete r.fired
  }
  if (o.done !== undefined) r.done = !!o.done || undefined
  if (o.ws !== undefined) {
    const ws = o.ws ? findWs(o.ws) : undefined
    r.ws = ws?.id
    r.project = ws?.project
  }
  state.reminders!.sort((a, b) => a.at - b.at)
  save()
  changed()
  return r
}

export function reminderRm(o: { id: string }) {
  calendarOn()
  reminderOf(o.id)
  state.reminders = state.reminders!.filter(x => x.id !== o.id)
  save()
  changed()
}

// every 30 s (now: tests move the clock): the due ones not rung yet, rung once as a `reminder` event (App: a notification
// and a toast); with nobody to hear it, it waits
export function reminderTick(now = Date.now()) {
  if (state.settings?.calendar !== true || !clients.size) return []
  const due = state.reminders!.filter(r => !r.fired && !r.done && r.at <= now)
  for (const r of due) {
    r.fired = true
    broadcast({ ev: 'reminder', reminder: r.id, text: r.text, at: r.at, ws: r.ws }) // not id: that would make it a reply
  }
  if (due.length) save(), changed()
  return due
}

// ---------- scheduled tasks: a prompt to an agent at the times a line of English says (shared/when.ts)

const RUNS_KEPT = 200
export const RUNS_SHOWN = 50
// a run this late (the Mac asleep, Laki not running) is skipped, and the log says so
// ponytail: missed runs never catch up; run them on wake if that's what people want
export const MISSED_AFTER = 30 * 60e3

const findSchedule = (id: string) => {
  const s = state.schedules?.find(x => x.id === id)
  if (!s) throw new Error(`no scheduled task ${id}`)
  return s
}

type ScheduleIn = Partial<Pick<Schedule, 'id' | 'name' | 'project' | 'preset' | 'ws' | 'prompt' | 'when' | 'on' | 'workflow' | 'source' | 'widget' | 'action'>>
const SCHEDULE_IN = ['name', 'project', 'preset', 'ws', 'prompt', 'when', 'on', 'workflow', 'source', 'widget', 'action'] as const
// workflows' files changed (workflow.ts' flowSave, flowRm: yours, Laki AI's, an agent's): the page reads them again;
// heard: an event one heard, or a skip it counted (the Workflows page's, not every list's)
export const flowFiles = { at: 0, heard: 0 }
// workflows (workflow.ts, which imports this file, fills it in): a scheduled task's run of one
export const flowHooks: { start?: (o: { workflow: string; source?: 'yours' | 'project'; project: string; task: string; trigger: string }) => Promise<{ id: string; ws?: string; status: string }>; find?: (o: { id: string; source?: 'yours' | 'project'; project: string }) => { name: string; source: 'yours' | 'project' | 'builtin'; where: string; blocks: FlowBlock[] }; waitKey?: (id: string) => string | undefined; answer?: (o: { id: string; n: number }) => Promise<unknown> } = {} // what a client sets: the daemon works out the rest

export function scheduleSet(o: ScheduleIn): Schedule {
  const old = o.id ? findSchedule(o.id) : undefined
  const given = Object.fromEntries(SCHEDULE_IN.filter(k => o[k] !== undefined).map(k => [k, o[k]]))
  if (old && given.on === false && Object.keys(given).length === 1) {
    // off takes no checks: a task whose workspace or preset is gone can still be stopped
    Object.assign(old, { on: false, next: undefined })
    save()
    changed()
    return old
  }
  const s: Schedule = { ...(old ?? { id: randomUUID().slice(0, 8), on: true, project: '', preset: '', ws: 'new', prompt: '', when: '', rule: { days: [], times: [] } }), ...given }
  s.on = s.on !== false
  const proj = findProject(s.project)
  s.project = proj.id
  if (!old) {
    // what a new one leaves out (the CLI): a worktree each run, or the folder without git; the default agent
    if (o.ws === undefined) s.ws = proj.git === false ? 'local' : 'new'
    const agent = state.settings?.agent
    s.preset ||= agent && presetNamed(agent) && presetNamed(agent)!.agent !== 'command' ? agent : 'claude'
  }
  if (!s.workflow) delete s.workflow, delete s.source // '' clears it: a prompt again
  if (!s.widget) delete s.widget, delete s.action
  if (!s.action) delete s.action // none: a fetch
  if (s.workflow && s.widget) throw new Error('a workflow or an extension, not both')
  const pr = presetNamed(s.preset) // an agent's: a command preset takes no prompt
  const ext = s.widget ? widgetUseCheck(s.widget, s.action) : undefined // throws: no such extension or action
  if (ext) {
    // a fetch or an action: no agent, no prompt (an action's argument, if any); a per-workspace one: one of the project's
    if (ext.scoped && ['new', 'local', 'local-new'].includes(s.ws)) throw new Error(`${ext.name} is per workspace: pick one of ${proj.name}'s`)
  } else if (s.workflow) {
    if (!flowsOn(state.settings) || !flowHooks.find) throw new Error('Workflows are off: turn them on in Settings › General › Pages')
    const wf = flowHooks.find({ id: s.workflow, source: s.source, project: proj.id }) // throws: no such workflow
    if (wf.source === 'builtin') throw new Error(`${wf.name} is a template: Use this… in Workflows copies it, then schedule the copy`)
    s.source = wf.source
    if (wf.where === 'here') throw new Error(`${wf.name} runs in a workspace you pick, not on a schedule: start it from that workspace's ⋯ › Run workflow`)
    // a scheduled run takes its inputs' defaults: each needed one must have one
    try {
      inputVals(wf.blocks.find(b => b.kind === 'start')?.inputs)
    } catch (e) {
      throw new Error(`${wf.name} can't run on a schedule: ${(e as Error).message} (a scheduled run takes its inputs' defaults: give it one in Start's inputs:, name=value)`)
    }
  } else if (!(pr ? pr.agent !== 'command' : isAgent(s.preset))) throw new Error(`pick an agent: ${s.preset || 'none'} isn't an agent's preset`)
  if (s.workflow || (ext && !ext.scoped)) {
    // its runs go where the workflow says; an extension's: nowhere
  } else if (s.ws === 'new') {
    if (proj.git === false) throw new Error(`${proj.name} isn't a git repository: run it in its folder instead of a new workspace`)
  } else if (s.ws !== 'local' && s.ws !== 'local-new') {
    const ws = findWs(s.ws)
    if (ws.project !== proj.id) throw new Error(`${ws.id} isn't in ${proj.name}`)
    s.ws = ws.id
  }
  s.prompt = s.prompt?.trim() ?? ''
  if (!s.prompt && !ext) throw new Error(s.workflow ? 'what should the workflow work on? (its task)' : 'the prompt is empty')
  s.name = s.name?.trim() || undefined
  if (!old || o.when !== undefined) {
    const r = parseWhen(s.when ?? '')
    if ('error' in r) throw new Error(r.error)
    s.rule = r
  }
  s.next = s.on ? nextRun(s.rule, Date.now()) : undefined
  state.schedules = old ? state.schedules!.map(x => (x === old ? s : x)) : [...state.schedules!, s]
  save()
  changed()
  return s
}

export function scheduleRm(id: string) {
  const s = findSchedule(id)
  state.schedules = state.schedules!.filter(x => x !== s)
  save()
  changed()
}

const runName = (s: Schedule, at: number) => stamp(s.name || (s.widget && !s.prompt ? `${widgetName(s.widget)}: ${s.action ?? 'fetch'}` : s.prompt.split(/\s+/).slice(0, 6).join(' ')), at)

const logRun = (r: ScheduleRun) => {
  state.runs = [r, ...(state.runs ?? [])].slice(0, RUNS_KEPT)
  save()
  changed()
  return r
}

// one run: a new workspace with the agent and the prompt, or the prompt to the workspace's agent
export async function runSchedule(s: Schedule, now = Date.now()): Promise<ScheduleRun> {
  s = state.schedules?.find(x => x.id === s.id) ?? s // scheduleSet replaces a task: the current one
  const r: ScheduleRun = { id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, now), at: now, ok: true, what: '' }
  const prompt = stamp(s.prompt, now)
  s.last = now
  try {
    if (s.widget) {
      // an extension: fetched, or one of its actions run (on ones only)
      const u = await widgetUse({ id: s.widget, action: s.action, arg: prompt || undefined, ws: ['new', 'local', 'local-new'].includes(s.ws) ? undefined : s.ws }, 'schedule', `scheduled task ${s.name ?? s.id}`)
      if (!u.ok) throw new Error(u.error ?? `${u.name} failed`)
      r.what = s.action ? `ran ${u.name}'s ${s.action}${u.out?.trim() ? `: ${u.out.trim().split('\n').pop()!.slice(0, 120)}` : ''}` : `fetched ${u.name}`
    } else if (s.workflow) {
      // a workflow's run, unless the last one this task started is still going
      const going = state.flows?.find(f => !FLOW_ENDED.includes(f.status) && f.workflow === s.workflow && f.source === (s.source ?? 'yours') && f.project === s.project && f.trigger === `schedule ${s.id}`)
      if (going) throw new Error(`skipped: its last run (${going.id}) is still going`)
      if (!flowHooks.start || !flowsOn(state.settings)) throw new Error('Workflows are off: Settings › General › Pages')
      const run = await flowHooks.start({ workflow: s.workflow, source: s.source, project: s.project, task: prompt, trigger: `schedule ${s.id}` })
      r.ws = run.ws
      r.what = `${run.status === 'queued' ? 'queued' : 'started'} a run of ${s.workflow} (${run.id})` // past its at once: it waits its turn
    } else if (s.ws === 'new' || s.ws === 'local-new') {
      // a new worktree, or a new session in the folder: either way a row of its own in the sidebar
      const title = wsTitle(s, now)
      const ws = await wsNew({ project: s.project, preset: s.preset, prompt, name: title, vars: true, ...(s.ws === 'local-new' && { local: true, another: true }) })
      // told apart in the sidebar, as its id is: Check 05-10-k3x9 (an hourly 'Check {{DD-MM}}'), with the id's tail
      const taken = (n: string) => state.workspaces.some(w => w !== ws && !w.archived && (w.name || w.id) === n)
      const own = ws.id.startsWith(`${slug(title)}-`) ? ws.id.slice(slug(title).length) : ''
      let name = taken(title) ? title + (own || `-${tail()}`) : title
      while (taken(name)) name = `${title}-${tail()}`
      Object.assign(ws, { name, schedule: s.id })
      save()
      changed()
      r.ws = ws.id
      r.tab = tabsOf(ws.id).find(t => t.kind === 'agent')?.id
      r.what = `started in a new ${s.ws === 'new' ? 'workspace' : 'session in its folder'}, ${ws.id}`
    } else {
      // its folder: the project's local workspace, made the first time (no worktree, no agent of its own)
      const ws = s.ws === 'local' ? await wsNew({ project: s.project, local: true, preset: 'none' }) : findWs(s.ws)
      if (ws.archived) throw new Error(`${ws.id} is archived`)
      r.ws = ws.id
      const live = tabsOf(ws.id).find(t => t.kind === 'agent' && (t.profile ?? t.preset) === s.preset && isLive(t))
      if (live) {
        const sent = send({ target: live.id, text: prompt, whenIdle: tracked(live), vars: true })
        r.tab = live.id
        r.what = 'queued' in sent ? `queued for its tab, ${live.name} (it was working)` : `sent to its tab, ${live.name}`
      } else {
        const t = addTab(ws.id, { preset: s.preset, prompt, vars: true })
        r.tab = t.id
        r.what = `started in a new tab, ${t.name}`
      }
    }
  } catch (e) {
    r.ok = false
    r.what = (e as Error).message
  }
  widgetEvent('schedule.ran', { task: { id: s.id, name: s.name ?? runName(s, now) }, ok: r.ok, what: r.what }, r.ws)
  return logRun(r)
}

export function scheduleRun(id: string) {
  return runSchedule(findSchedule(id))
}

// ---------- a workspace's agent started later (wsNew startAt)

export const pendingView = (p: Pending): PendingView => ({ at: p.at, limit: p.limit, failed: p.failed, prompt: p.prompt?.trim().split('\n')[0].slice(0, 200), agent: p.preset })

// every 30 s and as the daemon starts (tests pass `now`): each workspace whose agent waits, started once its time has
// come; a limit one's time is its account's reset (usage, kept 5 minutes), read again each tick until it has passed
// (then it starts: a reset moves on as it's reached). Usage not known: the next tick
let pendingBusy = false
export async function pendingTick(now = Date.now()) {
  if (pendingBusy) return
  pendingBusy = true
  try {
    for (const w of state.workspaces.filter(x => x.pending && !x.archived && !x.pending.failed)) {
      const p = w.pending!
      if (p.limit && !(p.at !== undefined && p.at <= now)) {
        const agent = presetNamed(p.preset)?.agent ?? p.preset
        const [u] = await usage(state.settings?.usage, usageWho().filter(x => x.agent === agent && x.account === (p.account ?? HOME_ACCOUNT))).catch(() => [])
        const at = u && !u.error ? resetOf(u.windows, state.settings?.usageAt ?? USAGE_AT) : undefined
        if (at !== undefined && at !== p.at && w.pending === p) (p.at = at), save(), changed()
      }
      if (p.at !== undefined && p.at <= now && w.pending === p) startPending(w, now)
    }
  } finally {
    pendingBusy = false
  }
}

// its agent now, as wsNew would have started it; a late one (the daemon was down) says so. One that fails stays, with
// why (Start now tries again). asked: Start now's (no notification: you started it; a failure is thrown to it, the time
// kept)
export function startPending(w: Workspace, now = Date.now(), asked = false) {
  const p = w.pending!
  const late = p.at !== undefined && now - p.at > 90_000 ? p.at : undefined
  try {
    const t = addTab(w.id, { preset: p.preset, cmd: p.cmd, prompt: p.prompt, model: p.model, effort: p.effort, perm: p.perm, fast: p.fast, vars: p.vars, agent: p.agent })
    delete w.pending
    wsLog(w, asked ? `${t.name} started now (Start now)` : late ? `${t.name} started late, was due ${new Date(late).toLocaleString()}` : `${t.name} started, as it was scheduled`)
    if (!asked) broadcast({ ev: 'started', ws: w.id, tab: t.id, name: w.name || w.id, agent: t.name, late })
    return t
  } catch (e) {
    const why = String((e as Error).message ?? e)
    wsLog(w, `its agent didn't start: ${why}`)
    if (asked) throw e // Start now's: said where it was asked, and still due at its time
    p.failed = why
  } finally {
    save()
    changed()
  }
}

// every 30 s (tests pass `now`): what's due runs, what's long overdue is logged as missed; then the next time
export async function scheduleTick(now = Date.now()) {
  // every due one moves on first: a tick while a run is still starting (a worktree takes a while) doesn't start it again
  const due = (state.schedules ?? []).filter(s => s.on && s.next !== undefined && s.next <= now).map(s => ({ s, at: s.next! }))
  for (const { s } of due) {
    s.next = s.rule.once ? undefined : nextRun(s.rule, now)
    if (s.rule.once) s.on = false
  }
  if (!due.length) return
  save()
  changed()
  for (const { s, at } of due) {
    if (!state.schedules?.some(x => x.id === s.id)) continue // deleted while an earlier one started
    if (now - at > MISSED_AFTER) logRun({ id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, at), at, ok: false, what: "missed: the Mac was asleep or Laki wasn't running" })
    else if (s.widget) void runSchedule(s, now) // a fetch may take minutes (an AI source's): the rest don't wait for it
    else await runSchedule(s, now)
  }
}
