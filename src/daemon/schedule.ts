// prompts for later: the board's to-dos, the calendar's reminders and scheduled tasks. core.ts imports it, and its users import it directly.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { flowsOn, HOME_ACCOUNT, isAgent, type OnlyIf, type Pending, type PendingView, type Reminder, REMINDERS_MAX, type RunState, type Schedule, type ScheduleRun, type Tab, type Todo, USAGE_AT, resetOf, type Workspace } from '../shared/types.ts'
import { nextRun, parseAt, parseWhen, partsOf, stamp, whenOf, wsTitle } from '../shared/when.ts'
import { type Block as FlowBlock, FLOW_ENDED, inputVals } from '../shared/workflow.ts'
import { accountFor, usageWho } from './accounts.ts'
import { addTab, branches, broadcast, byTab, cfgWait, changed, clients, findProject, findWs, git, log, presetNamed, prOf, projectArchived, run, save, send, slug, state, tabsOf, tail, tracked, turnEnds, turnWaits, wsLog, wsNew } from './core.ts'
import { dir, inRig } from './dir.ts'
import { usage } from './usage.ts'
import { meterView, statusLimits } from './meters.ts'
import { wsStat } from './files.ts'
import { flowPhone } from './phone.ts'
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

// ---------- the calendar's reminders (Calendar.tsx): a note for a moment, from the app, Laki AI, an agent or
// the CLI; reminderTick rings each once as it's due, while a client is on (one due while the app was closed rings as it opens)

export const REMINDERS_DONE = 92 * 86400000 // a done one is in the view (the Calendar) this long after its time
const reminderOf = (id: string) => {
  const r = state.reminders!.find(x => x.id === id)
  if (!r) throw new Error(`no reminder ${id}`)
  return r
}
const calendarOn = () => {
  if (state.settings?.calendar === false) throw new Error('turn Calendar on first: Settings › General › Pages')
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
// at's words, or every's: one moment, or a rule that repeats (every weekday at 9am: its next time and the words)
const reminderWhen = (at: unknown, every?: unknown): { at: number; every?: string } => {
  if (typeof every === 'string' && every.trim()) {
    const w = whenOf(every)
    if ('error' in w) throw new Error(w.error)
    if (!w.every) throw new Error(`${every.trim()} doesn't repeat: say every… (every weekday at 9am)`)
    return { at: at === undefined || at === '' ? w.at : reminderAt(at), every: w.every.slice(0, 200) }
  }
  if (typeof at === 'string' && !/^\d+$/.test(at)) {
    const w = whenOf(at)
    if ('error' in w) throw new Error(w.error)
    return { at: w.at, ...(w.every && { every: w.every.slice(0, 200) }) }
  }
  return { at: reminderAt(typeof at === 'string' ? Number(at) : at) }
}

export function reminderAdd(o: { at?: number | string; every?: string; text: string; ws?: string; project?: string; by?: string; tab?: string; important?: boolean }) {
  calendarOn()
  const text = reminderText(o.text)
  const { at, every } = reminderWhen(o.at, o.every)
  const ws = o.ws ? findWs(o.ws) : undefined
  const project = ws?.project ?? (o.project ? findProject(o.project).id : undefined)
  const by = (typeof o.by === 'string' && o.by.trim().slice(0, 80)) || byTab(o.tab) // said, else the tab it came from
  const r: Reminder = { id: randomUUID().slice(0, 8), at, text, made: Date.now(), ...(every && { every }), ...(ws && { ws: ws.id }), ...(project && { project }), ...(by && { by }), ...(o.important === true && { important: true }) }
  const all = [...state.reminders!, r]
  // ponytail: past REMINDERS_MAX the oldest rung ones go, then the oldest; a list, not a database
  while (all.length > REMINDERS_MAX) all.splice(all.findIndex(x => x.fired) >= 0 ? all.findIndex(x => x.fired) : 0, 1)
  state.reminders = all.sort((a, b) => a.at - b.at)
  save()
  changed()
  return r
}

// text, at (moved: it rings again; words that repeat make it repeat, others make it once), every ('' or null: once,
// at its next time), done, ws ('' none)
export function reminderSet(o: { id: string; text?: string; at?: number | string; every?: string | null; done?: boolean; ws?: string; important?: boolean }) {
  calendarOn()
  const r = reminderOf(o.id)
  if (o.text !== undefined) r.text = reminderText(o.text)
  if (o.at !== undefined || o.every !== undefined) {
    const w = o.every ? reminderWhen(o.at, o.every) : o.at !== undefined ? reminderWhen(o.at) : { at: r.at }
    r.at = w.at
    if (w.every) r.every = w.every
    else delete r.every
    if (r.at > Date.now()) delete r.fired
  }
  if (o.done !== undefined) r.done = !!o.done || undefined
  if (o.important !== undefined) r.important = o.important === true || undefined
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
  if (state.settings?.calendar === false || !clients.size) return []
  const due = state.reminders!.filter(r => !r.fired && !r.done && r.at <= now)
  for (const r of due) {
    broadcast({ ev: 'reminder', reminder: r.id, text: r.text, at: r.at, ws: r.ws, ...(r.important && { important: true }) }) // not id: that would make it a reply
    // a repeating one: its next time after now (the ones missed while nobody heard ring as this one)
    const rule = r.every ? parseWhen(r.every, now) : undefined
    const next = rule && !('error' in rule) ? nextRun(rule, Math.max(now, r.at)) : undefined
    if (next) r.at = next
    else r.fired = true
  }
  if (due.length) state.reminders!.sort((a, b) => a.at - b.at)
  if (due.length) save(), changed()
  return due
}

// ---------- scheduled tasks: a prompt to an agent at the times a line of English says (shared/when.ts)

const RUNS_KEPT = 200
export const RUNS_SHOWN = 50
// a run this late (the Mac asleep, Laki not running) is missed: logged, or run once it's noticed (T2: missed catchup)
export const MISSED_AFTER = 30 * 60e3

const findSchedule = (id: string) => {
  const s = state.schedules?.find(x => x.id === id)
  if (!s) throw new Error(`no scheduled task ${id}`)
  return s
}

type ScheduleIn = Partial<Pick<Schedule, 'id' | 'name' | 'project' | 'preset' | 'ws' | 'prompt' | 'when' | 'on' | 'workflow' | 'source' | 'widget' | 'action' | 'base' | 'noSetup' | 'group' | 'fresh' | 'notify' | 'missed' | 'catchUntil' | 'onlyIf'>>
const SCHEDULE_IN = ['name', 'project', 'preset', 'ws', 'prompt', 'when', 'on', 'workflow', 'source', 'widget', 'action', 'base', 'noSetup', 'group', 'fresh', 'notify', 'missed', 'catchUntil', 'onlyIf'] as const
// workflows' files changed (workflow.ts' flowSave, flowRm: yours, Laki AI's, an agent's): the page reads them again;
// heard: an event one heard, or a skip it counted (the Workflows page's, not every list's)
export const flowFiles = { at: 0, heard: 0 }
// workflows (workflow.ts, which imports this file, fills it in): a scheduled task's run of one
export const flowHooks: { start?: (o: { workflow: string; source?: 'yours' | 'project'; project: string; task: string; trigger: string }) => Promise<{ id: string; ws?: string; status: string }>; find?: (o: { id: string; source?: 'yours' | 'project'; project: string }) => { name: string; source: 'yours' | 'project' | 'builtin'; where: string; blocks: FlowBlock[] }; waitKey?: (id: string) => string | undefined; answer?: (o: { id: string; n: number }) => Promise<unknown> } = {} // what a client sets: the daemon works out the rest

// a task's group (the page's collapsible heads): a name, 60 characters at most; '' or none: no group
const groupSet = (s: Schedule, g: unknown) => {
  const name = typeof g === 'string' ? g.trim().slice(0, 60) : ''
  if (name) s.group = name
  else delete s.group
}
// Archive: out of the list and never run, kept to restore (the page's Archived; Delete permanently is there). Restored,
// it's as it was: on ones run at their next time
function archiveSet(s: Schedule, on: boolean) {
  if (on) (s.archived ??= Date.now()), (s.next = undefined)
  else if (s.archived) delete s.archived, (s.next = s.on ? nextRun(s.rule, Date.now()) : undefined)
}
export function scheduleSet(o: ScheduleIn & { archived?: boolean }): Schedule {
  const old = o.id ? findSchedule(o.id) : undefined
  if (o.archived !== undefined && typeof o.archived !== 'boolean') throw new Error('archived? true or false')
  if (o.archived && !old) throw new Error('archive which task? (its id)')
  const given = Object.fromEntries(SCHEDULE_IN.filter(k => o[k] !== undefined).map(k => [k, o[k]]))
  if (old && Object.keys(given).every(k => k === 'group' || (k === 'on' && given.on === false))) {
    // off, a group and archive take no checks: a task whose workspace or preset is gone can still be stopped or moved
    if (given.on === false) Object.assign(old, { on: false, next: undefined })
    if (given.group !== undefined) groupSet(old, given.group)
    if (o.archived !== undefined) archiveSet(old, o.archived)
    save()
    changed()
    return old
  }
  const s: Schedule = { ...(old ?? { id: randomUUID().slice(0, 8), on: true, project: '', preset: '', ws: 'new', prompt: '', when: '', rule: { days: [], times: [] } }), ...given }
  s.on = s.on !== false
  groupSet(s, s.group)
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
    if (ext.scoped && ['new', 'local', 'local-new', 'same'].includes(s.ws)) throw new Error(`${ext.name} is per workspace: pick one of ${proj.name}'s`)
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
  } else if (s.ws === 'new' || s.ws === 'same') {
    if (proj.git === false) throw new Error(`${proj.name} isn't a git repository: run it in its folder instead of a new workspace`)
  } else if (s.ws !== 'local' && s.ws !== 'local-new') {
    const ws = findWs(s.ws)
    if (ws.project !== proj.id) throw new Error(`${ws.id} isn't in ${proj.name}`)
    s.ws = ws.id
  }
  // a base branch: a new workspace's only ('' clears it; a task moved elsewhere drops it)
  // ponytail: a branch that isn't there is a failed run, not a refusal here (syncBase may fetch it by then)
  if (s.base != null && typeof s.base !== 'string') throw new Error('base? a branch name') // null: cleared, as ''
  s.base = s.base?.trim() || undefined
  if (s.base?.startsWith('-')) throw new Error(`base ${s.base}? a branch, not an option`)
  // same: the workspace its first run made (sameWs), for every run after; another where or project drops it
  if (s.ws !== 'same' || s.workflow || s.widget || (old && old.project !== s.project)) delete s.sameWs
  const making = (s.ws === 'new' || s.ws === 'same') && !s.workflow && !s.widget // its runs make a worktree: the first one, or each
  if (!making) {
    if (o.base?.trim()) throw new Error('a base branch is for a new workspace each run')
    delete s.base
  }
  // no setup script: likewise (false or null clears it)
  if (s.noSetup != null && typeof s.noSetup !== 'boolean') throw new Error('noSetup? true or false')
  if (!s.noSetup || !making) {
    if (o.noSetup) throw new Error('without the setup script is for a new workspace each run')
    delete s.noSetup
  }
  // fresh: a run into a workspace it shares (one you picked, its folder's, the same one) starts a new agent tab
  // instead of telling the agent there (Continue, unset)
  if (s.fresh != null && typeof s.fresh !== 'boolean') throw new Error('fresh? true or false')
  if (!s.fresh || ['new', 'local-new'].includes(s.ws) || s.workflow || s.widget) {
    if (o.fresh) throw new Error('start fresh is for runs that share a workspace (its folder, the same one, or one you pick)')
    delete s.fresh
  }
  s.prompt = s.prompt?.trim() ?? ''
  if (!s.prompt && !ext) throw new Error(s.workflow ? 'what should the workflow work on? (its task)' : 'the prompt is empty')
  // T1: Tell me (unset: when it needs you or fails)
  if (s.notify != null && !['never', 'needs', 'always'].includes(s.notify)) throw new Error('tell you? never, needs (when it needs you or fails) or always')
  if (!s.notify || s.notify === 'needs') delete s.notify
  // T2: a run the Mac slept through (unset: catchup for at most 2 times a day), until when (minutes after midnight)
  if (s.missed != null && s.missed !== 'skip' && s.missed !== 'catchup') throw new Error('if the Mac sleeps through it? skip or catchup')
  if (!s.missed) delete s.missed
  if (s.catchUntil != null && (!Number.isInteger(s.catchUntil) || s.catchUntil < 0 || s.catchUntil >= 1440)) throw new Error('catch up until? minutes after midnight (0-1439)')
  if (s.catchUntil == null) delete s.catchUntil
  delete s.catchup // edited: one waiting goes
  s.onlyIf = onlyIfOf(s.onlyIf, s) // T3
  if (!s.onlyIf) delete s.onlyIf, delete s.lastHead
  s.name = s.name?.trim() || undefined
  if (!old || o.when !== undefined) {
    const r = parseWhen(s.when ?? '')
    if ('error' in r) throw new Error(r.error)
    s.rule = r
  }
  s.next = s.on && !s.archived ? nextRun(s.rule, Date.now()) : undefined
  if (o.archived !== undefined) archiveSet(s, o.archived)
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

// T3: a run condition, checked as given (a client's JSON): not for a workflow or an extension (they decide for themselves)
function onlyIfOf(v: unknown, s: Schedule): OnlyIf | undefined {
  if (v == null || v === '') return undefined
  const o = v as Partial<Record<string, unknown>>
  if (s.workflow || s.widget) throw new Error("only if…: a run condition is for an agent's task (a workflow or an extension decides for itself)")
  if (o.kind === 'commits') return { kind: 'commits' }
  if (o.kind === 'prs') {
    if (o.what !== 'failing' && o.what !== 'review' && o.what !== 'any') throw new Error('only if which PRs? failing, review or any')
    return { kind: 'prs', what: o.what }
  }
  if (o.kind === 'issues') {
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 100) : ''
    return { kind: 'issues', ...(label && { label }) }
  }
  if (o.kind === 'cmd') {
    const cmd = typeof o.cmd === 'string' ? o.cmd.trim() : ''
    if (!cmd) throw new Error('only if what? a command (exit 0: it runs)')
    return { kind: 'cmd', cmd: cmd.slice(0, 2000) }
  }
  throw new Error('only if? commits, prs, issues or cmd')
}
// T3: whether to run now: skip says why not; check, {{check}} in the prompt (the command's first line, the PRs or
// issues found, the base's head); head: the base's, kept once an agent starts (commits). A gh or git failure fails the run
async function onlyIfCheck(s: Schedule): Promise<{ skip?: string; check: string; head?: string; fail?: string }> {
  const p = findProject(s.project)
  const o = s.onlyIf!
  const since = state.runs?.find(r => r.schedule === s.id && r.ok && !r.skipped && r.tab)?.at ?? 0 // its last run that started an agent
  if (o.kind === 'commits') {
    const base = s.base || (await branches(p.id)).main || 'HEAD'
    await git(p, 'fetch', '--quiet', 'origin', base).catch(() => {}) // none (no origin, offline): the local branch as it is
    const head = await git(p, 'rev-parse', '--verify', '--quiet', `origin/${base}^{commit}`).catch(() => git(p, 'rev-parse', '--verify', `${base}^{commit}`))
    if (s.lastHead && head === s.lastHead) return { skip: `no new commits on ${base}`, check: '' }
    return { head, check: head.slice(0, 12) }
  }
  if (o.kind === 'prs') {
    type P = { number: number; isDraft?: boolean; reviewDecision?: string; statusCheckRollup?: { conclusion?: string; state?: string }[] }
    const prs = JSON.parse((await run('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,isDraft,reviewDecision,statusCheckRollup'], { cwd: p.path, timeout: 60000 })).stdout || '[]') as P[]
    const failing = (x: P) => (x.statusCheckRollup ?? []).some(c => /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/.test(c.conclusion || c.state || ''))
    const hit = prs.filter(x => (o.what === 'any' ? true : o.what === 'failing' ? failing(x) : !x.isDraft && x.reviewDecision === 'REVIEW_REQUIRED'))
    if (!hit.length) return { skip: o.what === 'failing' ? 'no PR with failing checks' : o.what === 'review' ? 'no PR waiting for review' : 'no open PR', check: '' }
    return { check: hit.map(x => `#${x.number}`).join(' ') }
  }
  if (o.kind === 'issues') {
    const issues = JSON.parse((await run('gh', ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,createdAt', ...(o.label ? ['--label', o.label] : [])], { cwd: p.path, timeout: 60000 })).stdout || '[]') as { number: number; createdAt?: string }[]
    const fresh = issues.filter(x => Date.parse(x.createdAt ?? '') > since)
    if (!fresh.length) return { skip: `no new issues${o.label ? ` labeled ${o.label}` : ''}`, check: '' }
    return { check: fresh.map(x => `#${x.number}`).join(' ') }
  }
  // a command of yours (never an agent's or remote access's: main.ts), in the project's folder, 60 s; a repo whose
  // .laki.json waits for your trust doesn't run it
  if (p.host) return { fail: `${p.name} is on another machine: a check command runs only for a project on this Mac`, check: '' }
  if (cfgWait(p)) return { fail: `not checked: ${p.name}'s .laki.json changed and waits for your trust (Settings › the project)`, check: '' }
  const r = await run('/bin/sh', ['-c', o.cmd], { cwd: p.path, timeout: 60000, maxBuffer: 1 << 20 }).then(
    x => ({ code: 0, out: x.stdout }),
    (e: { code?: number | string; stdout?: string; killed?: boolean }) => ({ code: e.killed ? 'timeout' : (e.code ?? 1), out: e.stdout ?? '' }),
  )
  const line = String(r.out).trim().split('\n')[0].slice(0, 200)
  if (r.code !== 0) return { skip: `its check said no (${r.code === 'timeout' ? 'over 60 s' : `exit ${r.code}`})${line ? `: ${line}` : ''}`, check: '' }
  return { check: line }
}

const runName = (s: Schedule, at: number) => stamp(s.name || (s.widget && !s.prompt ? `${widgetName(s.widget)}: ${s.action ?? 'fetch'}` : s.prompt.split(/\s+/).slice(0, 6).join(' ')), at)

const logRun = (r: ScheduleRun) => {
  state.runs = [r, ...(state.runs ?? [])].slice(0, RUNS_KEPT)
  save()
  changed()
  return r
}

// same's workspace: the one its first run made, while it's there and not archived; sameMaking: tasks whose run is
// making it now (a second run meanwhile is skipped, not a second workspace)
const sameOf = (s: Schedule) => (s.sameWs ? state.workspaces.find(w => w.id === s.sameWs && !w.archived) : undefined)
const sameMaking = new Set<string>()

// one run: a new workspace with the agent and the prompt, or the prompt to the workspace's agent. asked: Run now (its
// condition isn't checked: you asked); late: a catch-up's words (T2), before what it did
export async function runSchedule(s: Schedule, now = Date.now(), o: { asked?: boolean; late?: string } = {}): Promise<ScheduleRun> {
  s = state.schedules?.find(x => x.id === s.id) ?? s // scheduleSet replaces a task: the current one
  const r: ScheduleRun = { id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, now), at: now, ok: true, what: '' }
  let check = ''
  let head: string | undefined
  s.last = now
  try {
    if (projectArchived(s.project)) throw new Error(`${s.project} is archived: bring it back to run its tasks`)
    if (s.onlyIf && !s.widget && !s.workflow && !o.asked) {
      const c = await onlyIfCheck(s)
      if (c.fail) throw new Error(c.fail)
      if (c.skip) {
        Object.assign(r, { skipped: true, what: `skipped: ${c.skip}` })
        log(`scheduled task ${s.id}: ${r.what}`)
        return logRun(r)
      }
      ;({ check, head } = c)
    }
    if (o.late) r.what = `${o.late}: `
  } catch (e) {
    Object.assign(r, { ok: false, what: (e as Error).message })
    widgetEvent('schedule.ran', { task: { id: s.id, name: s.name ?? runName(s, now) }, ok: r.ok, what: r.what }, r.ws)
    return logRun(r)
  }
  const prompt = stamp(s.prompt.replaceAll('{{check}}', check), now)
  const late = r.what
  try {
    if (s.widget) {
      // an extension: fetched, or one of its actions run (on ones only)
      const u = await widgetUse({ id: s.widget, action: s.action, arg: prompt || undefined, ws: ['new', 'local', 'local-new', 'same'].includes(s.ws) ? undefined : s.ws }, 'schedule', `scheduled task ${s.name ?? s.id}`)
      if (!u.ok) throw new Error(u.error ?? `${u.name} failed`)
      Object.assign(r, { state: 'done', endedAt: Date.now() }) // T1: its end is now
      r.what = s.action ? `ran ${u.name}'s ${s.action}${u.out?.trim() ? `: ${u.out.trim().split('\n').pop()!.slice(0, 120)}` : ''}` : `fetched ${u.name}`
    } else if (s.workflow) {
      // a workflow's run, unless the last one this task started is still going
      const going = state.flows?.find(f => !FLOW_ENDED.includes(f.status) && f.workflow === s.workflow && f.source === (s.source ?? 'yours') && f.project === s.project && f.trigger === `schedule ${s.id}`)
      if (going) throw new Error(`skipped: its last run (${going.id}) is still going`)
      if (!flowHooks.start || !flowsOn(state.settings)) throw new Error('Workflows are off: Settings › General › Pages')
      const run = await flowHooks.start({ workflow: s.workflow, source: s.source, project: s.project, task: prompt, trigger: `schedule ${s.id}` })
      Object.assign(r, { ws: run.ws, flow: run.id, state: 'running' }) // T1: its end, scheduleFlowEnded
      r.what = `${run.status === 'queued' ? 'queued' : 'started'} a run of ${s.workflow} (${run.id})` // past its at once: it waits its turn
    } else if (s.ws === 'new' || s.ws === 'local-new' || (s.ws === 'same' && !sameOf(s))) {
      // a new worktree, or a new session in the folder: either way a row of its own in the sidebar (same: its first
      // run's, or one after its workspace was archived or deleted; the runs after go there)
      const title = wsTitle(s, now)
      // its base branch gone: wsNew refuses it, so the run fails and says so (never off another branch)
      if (s.ws === 'same' && sameMaking.has(s.id)) throw new Error('skipped: its first run is still making its workspace')
      if (s.ws === 'same') sameMaking.add(s.id)
      const ws = await wsNew({ project: s.project, preset: s.preset, prompt, name: title, vars: true, ...(s.ws !== 'local-new' && s.base && { base: s.base }), ...(s.ws !== 'local-new' && s.noSetup && { noSetup: true }), ...(s.ws === 'local-new' && { local: true, another: true }) }).finally(() => sameMaking.delete(s.id))
      // on the task as it is now: one edited while its workspace was made is another object (scheduleSet replaces it), and
      // one moved elsewhere meanwhile takes none
      const cur = state.schedules?.find(x => x.id === s.id)
      if (s.ws === 'same' && cur?.ws === 'same' && cur.project === s.project && !cur.workflow && !cur.widget) cur.sameWs = ws.id
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
      r.what = `started in a new ${s.ws === 'local-new' ? 'session in its folder' : 'workspace'}, ${ws.id}${s.base ? `, off ${ws.base}` : ''}${s.ws === 'same' ? ': its next runs go there too' : ''}`
    } else {
      // its folder: the project's local workspace, made the first time (no worktree, no agent of its own)
      const ws = s.ws === 'local' ? await wsNew({ project: s.project, local: true, preset: 'none' }) : s.ws === 'same' ? sameOf(s)! : findWs(s.ws)
      if (ws.archived) throw new Error(`${ws.id} is archived`)
      r.ws = ws.id
      // ponytail: Start fresh opens a tab each run and closes none (an earlier run's chat may be yours now): close them yourself
      const live = s.fresh ? undefined : tabsOf(ws.id).find(t => t.kind === 'agent' && (t.profile ?? t.preset) === s.preset && isLive(t))
      if (live) {
        const sent = send({ target: live.id, text: prompt, whenIdle: tracked(live), vars: true })
        r.tab = live.id
        r.what = 'queued' in sent ? `queued for its tab, ${live.name} (it was working)` : `sent to its tab, ${live.name}`
      } else {
        const t = addTab(ws.id, { preset: s.preset, prompt, vars: true })
        r.tab = t.id
        r.what = `started ${s.fresh ? 'fresh ' : ''}in a new tab, ${t.name}`
      }
    }
    if (r.tab) r.state = 'running' // T1: filled in as its turns end (runEnded)
    if (head && r.tab) s.lastHead = head // T3 commits: the next run waits for newer ones
  } catch (e) {
    r.ok = false
    r.what = (e as Error).message
    if (s.widget) Object.assign(r, { state: 'failed', endedAt: Date.now() })
  }
  if (late) r.what = late + r.what
  widgetEvent('schedule.ran', { task: { id: s.id, name: s.name ?? runName(s, now) }, ok: r.ok, what: r.what }, r.ws)
  return logRun(r)
}

export function scheduleRun(id: string) {
  const s = findSchedule(id)
  if (s.archived) throw new Error('this task is archived: restore it to run it (Archived, at the bottom of Scheduled tasks)') // archived ones never run
  return runSchedule(s, Date.now(), { asked: true })
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
    for (const w of state.workspaces.filter(x => x.pending && !x.archived && !x.pending.failed && !projectArchived(x.project))) { // an archived project's: once it's back (late)
      const p = w.pending!
      if (p.limit && !(p.at !== undefined && p.at <= now)) {
        const agent = presetNamed(p.preset)?.agent ?? p.preset
        const account = accountFor({ preset: agent } as Tab, presetNamed(p.preset)?.account) ?? HOME_ACCOUNT // its tab's, now (one removed since: the agent's own)
        const [u] = await usage(state.settings?.usage, usageWho().filter(x => x.agent === agent && x.account === account), now, statusLimits).catch(() => []) // R4: the agent's own numbers too
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
    const t = addTab(w.id, { preset: p.preset, cmd: p.cmd, prompt: p.prompt, model: p.model, effort: p.effort, perm: p.perm, fast: p.fast, sandbox: p.sandbox, vars: p.vars, agent: p.agent })
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

// every 30 s (tests pass `now`): what's due runs, what's long overdue is missed (logged, or a catch-up waits: T2); then
// the next time; then one catch-up waiting, if any (several that woke together go a tick, 30 s, apart)
export async function scheduleTick(now = Date.now()) {
  // every due one moves on first: a tick while a run is still starting (a worktree takes a while) doesn't start it again
  const due = (state.schedules ?? []).filter(s => s.on && !s.archived && s.next !== undefined && s.next <= now).map(s => ({ s, at: s.next! }))
  for (const { s } of due) {
    s.next = s.rule.once ? undefined : nextRun(s.rule, now)
    if (s.rule.once) s.on = false
  }
  if (due.length) save(), changed()
  for (const { s, at } of due) {
    if (!state.schedules?.some(x => x.id === s.id)) continue // deleted while an earlier one started
    if (now - at > MISSED_AFTER) missed(s, at, now)
    else if (s.widget) void runSchedule(s, now) // a fetch may take minutes (an AI source's): the rest don't wait for it
    else await runSchedule(s, now)
  }
  await catchTick(now)
}

// T2: a task that catches up: a rule of at most 2 times a day (every N minutes or hours: no), unless it says
const catches = (s: Schedule) => (s.missed ?? (Math.max(...partsOf(s.rule).map(p => p.times.length)) <= 2 ? 'catchup' : 'skip')) === 'catchup'
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const missedRun = (s: Schedule, at: number, why: string) => logRun({ id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, at), at, ok: false, what: `missed: ${why}` })
// a due time the Mac slept through: its latest one (the ones before it only logged) waits to run, before catchUntil (that
// day's, after the due time) or the task's next time; past that, or a task that skips: missed
function missed(s: Schedule, at: number, now: number) {
  if (!catches(s)) return void missedRun(s, at, "the Mac was asleep or Laki wasn't running")
  let latest = at
  for (let t = nextRun(s.rule, at), n = 0; t !== undefined && t <= now && n < 1000; t = nextRun(s.rule, t), n++) latest = t
  const day = new Date(latest)
  if (s.catchUntil !== undefined) day.setHours(0, s.catchUntil, 0, 0)
  if (s.catchUntil !== undefined && day.getTime() <= latest) day.setDate(day.getDate() + 1)
  const until = s.catchUntil !== undefined ? day.getTime() : (s.next ?? latest + 12 * 3600e3)
  if (now >= until) return void missedRun(s, latest, `the Mac woke after ${hhmm(until)}`)
  s.catchup = { due: latest, until }
  save()
  changed()
}
// one a tick: the oldest catch-up waiting runs (one past its time: missed); not on a battery under 20% (unless the
// task says? ponytail: no per-task switch yet; pmset's, the Mac's only)
async function catchTick(now: number) {
  const waiting = (state.schedules ?? []).filter(s => s.catchup && s.on !== false && !s.archived).sort((a, b) => a.catchup!.due - b.catchup!.due)
  for (const s of waiting.filter(x => now >= x.catchup!.until)) missedRun(s, s.catchup!.due, `the Mac woke after ${hhmm(s.catchup!.until)}`), delete s.catchup
  const s = waiting.find(x => x.catchup)
  if (!s) return
  if (await lowBattery()) return // the next tick looks again, until its time is up
  const at = s.catchup!.due
  delete s.catchup
  save()
  await runSchedule(s, now, { late: `after wake (due ${hhmm(at)})` })
}
const lowBattery = async () => {
  if (process.platform !== 'darwin' || inRig()) return false // tests: never
  const out = await run('pmset', ['-g', 'batt'], { timeout: 5000 }).then(r => r.stdout, () => '')
  const m = /(\d+)%;\s*discharging/.exec(out)
  return !!m && Number(m[1]) < 20
}

// ---------- T1: how a run ended: its tab's turns (core's turnEnds, turnWaits), the first day after it started; each
// end again (it resumed, it ended again). A workflow's: its run's end (scheduleFlowEnded); an extension's: at once
const OUTCOME_MS = 24 * 3600e3
const runOfTab = (tab: string, now = Date.now()) => state.runs?.find(r => r.tab === tab && r.state !== undefined && now - r.at < OUTCOME_MS)
async function runEnded(tab: Tab, st: RunState, text?: string) {
  if (!runOfTab(tab.id)) return
  const endedAt = Date.now()
  const d = await wsStat({ ws: tab.workspace }).catch(() => null) // first: the entry changes at once, whole
  const r = runOfTab(tab.id)
  if (!r) return
  const was = r.state
  const said = text?.trim().split('\n')[0].slice(0, 200)
  const pr = prOf(tab.workspace)
  const u = state.settings?.costs !== false ? meterView(tab).usage : undefined
  Object.assign(r, { state: st, endedAt, ...(said && { said }), ...(pr?.number && { pr: { number: pr.number, url: pr.url } }), ...(u && { tokens: u.tokens, ...(u.cost !== undefined && { cost: u.cost }) }), ...(d && { diff: { add: d.add, del: d.del, files: d.files } }) })
  save()
  changed()
  ranTold(r, was)
}
// main.ts, as the daemon starts (not as this module loads: core's sets may not be there yet, load-order.test)
export function runOutcomes() {
  turnEnds.add((tab, o) => void setTimeout(() => void runEnded(tab, o.failed || o.limit ? 'failed' : 'done', o.last).catch(e => log(`run ${tab.id}: ${e.message}`)), 1500).unref?.()) // its usage meter is read a second after the end
  turnWaits.add((tab, o) => void runEnded(tab, 'waiting', o.question).catch(e => log(`run ${tab.id}: ${e.message}`)))
}
// a workflow's run ended (workflow.ts' end): its task's log entry says how
export function scheduleFlowEnded(id: string, status: string, why: string) {
  const r = state.runs?.find(x => x.flow === id && x.state === 'running')
  if (!r) return
  const was = r.state
  Object.assign(r, { state: status === 'done' ? 'done' : status === 'stopped' ? 'stopped' : 'failed', endedAt: Date.now(), said: why.trim().split('\n')[0].slice(0, 200) })
  save()
  changed()
  ranTold(r, was)
}
// told as it changes (Tell me: needs, unset: when it waits or failed; always: done too; never): a `scheduled` event (the
// app's notification and toast) and a phone push (a wait's push is its tab's own: not twice); extensions' schedule.done
function ranTold(r: ScheduleRun, was?: RunState) {
  const s = state.schedules?.find(x => x.id === r.schedule)
  const name = s?.name ? stamp(s.name, r.at) : r.name
  widgetEvent('schedule.done', { task: { id: r.schedule, name }, state: r.state, said: r.said, ...(r.pr && { pr: r.pr }), ...(r.diff && { diff: r.diff }), ...(r.cost !== undefined && { cost: r.cost }) }, r.ws)
  if (r.state === was) return
  const tell = s?.notify ?? 'needs'
  const needs = r.state === 'waiting' || r.state === 'failed'
  if (tell === 'never' || (tell === 'needs' && !needs)) return
  const how = r.state === 'waiting' ? 'needs you' : r.state === 'failed' ? 'failed' : r.state === 'stopped' ? 'stopped' : 'is done'
  broadcast({ ev: 'scheduled', run: r.id, ws: r.ws, tab: r.tab, state: r.state, name, text: `${name} ${how}${r.said ? `: ${r.said}` : ''}` })
  if (r.state !== 'waiting') flowPhone(name, r.ws && (state.workspaces.find(w => w.id === r.ws)?.name || r.ws), how, r.said ?? '', 'Scheduled')
}
