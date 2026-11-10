// prompts for later: the board's to-dos, the calendar's reminders and scheduled tasks. core.ts imports it, and its users import it directly.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { flowsOn, HOME_ACCOUNT, isAgent, type OnlyIf, type Project, type TaskEvent, type TaskEventIn, type TaskMarks, type TaskTrigger, type Pending, type PendingView, type Reminder, REMINDERS_MAX, type RunState, type Schedule, type ScheduleRun, type Tab, type Todo, USAGE_AT, resetOf, type Workspace } from '../shared/types.ts'
import { nextRun, parseAt, parseWhen, partsOf, stamp, whenOf, wsTitle } from '../shared/when.ts'
import { type Block as FlowBlock, FLOW_ENDED, inputVals } from '../shared/workflow.ts'
import { accountFor, usageWho } from './accounts.ts'
import { addTab, branches, broadcast, byTab, cfgWait, changed, clients, findProject, findWs, firstLine, ghCount, git, log, onGitHub, presetNamed, prOf, projectArchived, run, save, send, slug, state, tabStatus, tabsOf, tail, tracked, turnEnds, turnWaits, wsArchive, wsLog, wsNew } from './core.ts'
import { fillEvent, plain } from '../shared/fence.ts'
import { quotaLow } from './pr.ts'
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

type ScheduleIn = Partial<Pick<Schedule, 'id' | 'name' | 'project' | 'preset' | 'ws' | 'prompt' | 'when' | 'on' | 'workflow' | 'source' | 'widget' | 'action' | 'base' | 'noSetup' | 'group' | 'fresh' | 'notify' | 'missed' | 'catchUntil' | 'onlyIf' | 'trigger' | 'keep' | 'emptyGone'>>
const SCHEDULE_IN = ['name', 'project', 'preset', 'ws', 'prompt', 'when', 'on', 'workflow', 'source', 'widget', 'action', 'base', 'noSetup', 'group', 'fresh', 'notify', 'missed', 'catchUntil', 'onlyIf', 'trigger', 'keep', 'emptyGone'] as const
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
    if (given.on === false) Object.assign(old, { on: false, next: undefined }), delete old.again // off: no retry or later start either
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
  // T5: its run workspaces kept (a new workspace each run only: unset 5, 0 all), one that did nothing archived as it ends
  if (s.keep != null && (!Number.isInteger(s.keep) || s.keep < 0 || s.keep > 100)) throw new Error('keep how many of its workspaces? 0 (all) to 100')
  if (s.emptyGone != null && typeof s.emptyGone !== 'boolean') throw new Error('emptyGone? true or false')
  if (s.keep == null || s.ws !== 'new' || s.workflow || s.widget) delete s.keep, delete s.kept
  if (s.emptyGone !== false || s.ws !== 'new' || s.workflow || s.widget) delete s.emptyGone
  // T6: edited (on again, a field fixed): its failures start over
  if (s.on) delete s.fails, delete s.pausedWhy, delete s.pausedField
  delete s.again
  s.name = s.name?.trim() || undefined
  // T4: on an event instead of a clock (no times, no next); what it heard starts over when the event changes
  const trig = triggerOf(s.trigger, s)
  const what = (t?: TaskTrigger) => JSON.stringify([t?.event, t?.branch, t?.label])
  if (!trig || what(trig) !== what(old?.trigger)) delete s.marks, delete s.seen
  if (trig) Object.assign(s, { trigger: trig, when: '', rule: { days: [], times: [] } })
  else delete s.trigger
  if (!trig && (!old || o.when !== undefined || old.trigger)) {
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
    const args = ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,isDraft,reviewDecision,statusCheckRollup']
    ghCount(args)
    const prs = JSON.parse((await run('gh', args, { cwd: p.path, timeout: 60000 })).stdout || '[]') as P[]
    const failing = (x: P) => (x.statusCheckRollup ?? []).some(c => /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/.test(c.conclusion || c.state || ''))
    const hit = prs.filter(x => (o.what === 'any' ? true : o.what === 'failing' ? failing(x) : !x.isDraft && x.reviewDecision === 'REVIEW_REQUIRED'))
    if (!hit.length) return { skip: o.what === 'failing' ? 'no PR with failing checks' : o.what === 'review' ? 'no PR waiting for review' : 'no open PR', check: '' }
    return { check: hit.map(x => `#${x.number}`).join(' ') }
  }
  if (o.kind === 'issues') {
    const args = ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,createdAt', ...(o.label ? ['--label', o.label] : [])]
    ghCount(args)
    const issues = JSON.parse((await run('gh', args, { cwd: p.path, timeout: 60000 })).stdout || '[]') as { number: number; createdAt?: string }[]
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

// ---------- T4: a task on an event instead of a clock: CI failing on a branch, a PR opened or reviewed, an issue opened,
// a push. Heard by eventTick (every 3 minutes, slow while idle; never while GitHub's quota is low, as the PR scans): one
// gh call per project and kind a tick, shared by its tasks. A task's first read only notes what's there (marks, seen).
// ponytail: GitHub projects on this Mac only (no SSH host's); an incoming webhook (inHooks) doesn't feed them yet
export const EVENTS: TaskEvent[] = ['ci.failed', 'pr.opened', 'pr.review', 'issue.opened', 'push']
const EVENT_GAP = 30 // minutes between a task's runs (unset)
const EVENT_DAY = 10 // runs a day at most (unset)
const SEEN_KEPT = 50
function triggerOf(v: unknown, s: Schedule): TaskTrigger | undefined {
  if (v == null || v === '') return undefined
  const o = v as Partial<Record<string, unknown>>
  if (s.workflow || s.widget) throw new Error("on an event: that's for an agent's task (a workflow has its own on:)")
  const event = o.event as TaskEvent
  if (!EVENTS.includes(event)) throw new Error(`on which event? ${EVENTS.join(', ')}`)
  const text = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, 100) : '')
  const branch = text('branch')
  const label = text('label')
  if (branch.startsWith('-')) throw new Error(`branch ${branch}? a branch, not an option`)
  if (o.by != null && o.by !== 'others' && o.by !== 'me' && o.by !== 'any') throw new Error('by whom? others, me or any')
  const num = (k: string, hi: number, what: string) => {
    if (o[k] == null) return undefined
    if (!Number.isInteger(o[k]) || (o[k] as number) < (k === 'gap' ? 0 : 1) || (o[k] as number) > hi) throw new Error(what)
    return o[k] as number
  }
  const gap = num('gap', 1440, 'minutes between its runs? 0 to 1440')
  const perDay = num('perDay', 100, 'runs a day at most? 1 to 100')
  return { event, ...(branch && { branch }), ...(label && event === 'issue.opened' && { label }), ...(o.by && o.by !== 'any' && { by: o.by as 'others' | 'me' }), ...(gap !== undefined && { gap }), ...(perDay !== undefined && { perDay }) }
}

type Ask = <T>(key: string, f: () => Promise<T>) => Promise<T>
// what's new for one task since its last read: its marks and seen moved on (on the task as it is now: scheduleSet may
// have replaced it meanwhile); the first read only sets them
async function eventsOf(s: Schedule, p: Project, ask: Ask): Promise<TaskEventIn[]> {
  const t = s.trigger!
  const m = s.marks
  const branch = t.branch || (await ask('main', async () => (await branches(p.id)).main)) || 'main'
  const gh = <T>(args: string[]) => ask(args.join(' '), () => (ghCount(args), run('gh', args, { cwd: p.path, timeout: 30000, maxBuffer: 8 << 20 }).then(r => JSON.parse(String(r.stdout) || '[]') as T)))
  const me = t.by ? await ask('me', () => run('gh', ['api', 'user', '--jq', '.login'], { timeout: 10000 }).then(r => String(r.stdout).trim().toLowerCase())) : ''
  const whose = (login?: string) => !t.by || (t.by === 'me') === (!!login && login.toLowerCase() === me)
  const marks: TaskMarks = {}
  const seen = new Set(s.seen)
  let out: TaskEventIn[] = []
  if (t.event === 'ci.failed') {
    // a run on the branch that ended failing, by its id (an older one may end after a newer); a pull_request run there is
    // a fork's (a branch of the repo's own has its own name): held
    type R = { databaseId: number; status?: string; conclusion?: string; event?: string; displayTitle?: string; url?: string }
    const runs = await gh<R[]>(['run', 'list', '--branch', branch, '--limit', '20', '--json', 'databaseId,status,conclusion,event,displayTitle,url'])
    const failed = runs.filter(r => r.status === 'completed' && /^(failure|timed_out|startup_failure)$/.test(r.conclusion ?? ''))
    out = failed.map(r => ({ id: `ci:${r.databaseId}`, kind: t.event, words: `CI failed on ${branch}`, title: r.displayTitle, url: r.url, branch, ...(/^pull_request/.test(r.event ?? '') && { fork: true }) }))
  } else if (t.event === 'pr.opened' || t.event === 'pr.review') {
    type R = { number: number; title?: string; url?: string; author?: { login?: string }; headRefName?: string; baseRefName?: string; isCrossRepository?: boolean; latestReviews?: { author?: { login?: string }; state?: string; submittedAt?: string }[] }
    const prs = (await gh<R[]>(['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,url,author,headRefName,baseRefName,isCrossRepository,latestReviews'])).filter(x => !t.branch || x.baseRefName === t.branch)
    const ev = (x: R, id: string, words: string): TaskEventIn => ({ id, kind: t.event, words, title: x.title, url: x.url, number: x.number, branch: x.headRefName, ...(x.isCrossRepository && { fork: true }) })
    if (t.event === 'pr.opened') {
      marks.pr = Math.max(m?.pr ?? 0, ...prs.map(x => x.number))
      out = prs.filter(x => x.number > (m?.pr ?? Infinity) && whose(x.author?.login)).map(x => ev(x, `pr:${x.number}`, `PR #${x.number} opened`))
    } else {
      marks.reviews = Object.fromEntries(Object.entries(m?.reviews ?? {}).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 100)) // a PR off the top 30 for a while keeps its mark
      for (const x of prs) {
        const r = [...(x.latestReviews ?? [])].filter(y => y.submittedAt).sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!)).pop()
        if (!r) continue
        marks.reviews[x.number] = r.submittedAt!
        if (m && m.reviews?.[x.number] !== r.submittedAt && whose(r.author?.login)) out.push(ev(x, `review:${x.number}:${r.submittedAt}`, `PR #${x.number} reviewed (${(r.state ?? '').toLowerCase().replace(/_/g, ' ') || 'a review'})`))
      }
    }
  } else if (t.event === 'issue.opened') {
    type R = { number: number; title?: string; url?: string; author?: { login?: string } }
    const issues = await gh<R[]>(['issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,url,author', ...(t.label ? ['--label', t.label] : [])])
    marks.issue = Math.max(m?.issue ?? 0, ...issues.map(x => x.number))
    out = issues.filter(x => x.number > (m?.issue ?? Infinity) && whose(x.author?.login)).map(x => ({ id: `issue:${x.number}`, kind: t.event, words: `issue #${x.number} opened`, title: x.title, url: x.url, number: x.number }))
  } else {
    // a push: the branch's head on origin moved (who pushed isn't known here: by doesn't apply)
    const head = await ask(`head ${branch}`, () => git(p, 'ls-remote', 'origin', `refs/heads/${branch}`).then(o => o.split(/\s/)[0] || ''))
    marks.head = head
    if (head && head !== m?.head) out = [{ id: `push:${head}`, kind: t.event, words: `a push to ${branch} (${head.slice(0, 7)})`, branch }]
  }
  const cur = state.schedules?.find(x => x.id === s.id)
  if (!cur) return []
  const fresh = m ? out.filter(e => !seen.has(e.id)) : [] // the first read: what's there is old news
  cur.marks = marks
  cur.seen = [...(m ? (s.seen ?? []) : out.map(e => e.id)), ...fresh.map(e => e.id)].slice(-SEEN_KEPT)
  return fresh
}

// one event: once per id (seen), a fork's held for your click, then its guards (the gap since its last run, runs a day)
async function onEvent(s: Schedule, ev: TaskEventIn, now: number) {
  const t = s.trigger!
  const base: ScheduleRun = { id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, now), at: now, ok: true, what: '', event: ev.words }
  if (ev.fork) {
    // a fork's PR (or a CI run of one): its text and code are a stranger's, so no agent starts on it until you say
    const r = logRun({ ...base, what: `held: ${ev.words}, from a fork: it runs only when you start it`, held: ev })
    log(`scheduled task ${s.id}: ${r.what}`)
    broadcast({ ev: 'scheduled', run: r.id, state: 'waiting', name: r.name, text: `${r.name}: ${ev.words} is from a fork, held until you start it (Scheduled tasks)` })
    return
  }
  const gap = t.gap ?? EVENT_GAP
  if (s.last !== undefined && now - s.last < gap * 60e3) return void logRun({ ...base, skipped: true, what: `skipped: ${ev.words}, ${Math.round((now - s.last) / 60e3)} min after its last run (at least ${gap} apart)` })
  const day = new Date(now).setHours(0, 0, 0, 0)
  const today = (state.runs ?? []).filter(r => r.schedule === s.id && r.event && !r.skipped && !r.held && r.at >= day).length
  if (today >= (t.perDay ?? EVENT_DAY)) return void logRun({ ...base, skipped: true, what: `skipped: ${ev.words}, it ran ${today} times today (its most)` })
  await runSchedule(s, now, { event: ev })
}

let eventBusy = false
export async function eventTick(now = Date.now()) {
  const on = (state.schedules ?? []).filter(s => s.trigger && s.on && !s.archived && !projectArchived(s.project))
  if (!on.length || eventBusy || (await quotaLow(now))) return
  eventBusy = true
  const memo = new Map<string, Promise<unknown>>()
  try {
    for (const s of on) {
      const p = state.projects.find(x => x.id === s.project)
      if (!p || p.host || p.kind || p.git === false || !onGitHub(p.path)) continue
      const ask: Ask = (k, f) => (memo.get(`${p.id} ${k}`) ?? memo.set(`${p.id} ${k}`, f()).get(`${p.id} ${k}`)) as ReturnType<typeof f>
      const heard = await eventsOf(s, p, ask).catch(e => void log(`scheduled task ${s.id}: its events not read: ${firstLine(e)}`))
      if (!heard) continue
      save()
      for (const ev of heard) {
        const cur = state.schedules?.find(x => x.id === s.id)
        if (!cur?.on || cur.archived) break // turned off by a run before it (T6)
        await onEvent(cur, ev, now)
      }
    }
  } finally {
    eventBusy = false
  }
}

// a held run (a fork's): started now, as you asked (Run it, on its log entry)
export async function scheduleRelease(o: { run: string }) {
  const r = state.runs?.find(x => x.id === o.run && x.held)
  if (!r) throw new Error(`no held run ${o.run}`)
  const s = findSchedule(r.schedule)
  if (s.archived) throw new Error('this task is archived: restore it first')
  const ev = r.held!
  delete r.held
  r.what = `${ev.words}, from a fork: you started it`
  save()
  changed()
  return runSchedule(s, Date.now(), { event: { ...ev, fork: false }, asked: true })
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

// ---------- T6: a run that failed. Transient (the network, a fetch, a lock, busy): tried again once, 5 minutes on; the
// rest not. Failed runs in a row (an agent that ended on an error too; one waiting for you doesn't count, nor a skip or a
// Run now) turn the task off at FAILS_OFF, told once (a notification, a phone push); the page shows it on top, with Fix
const RETRY_MS = 5 * 60e3
const FAILS_OFF = 3
const TRANSIENT = /network|unable to access|could not read from remote|could not resolve host|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|\.lock'?: File exists|is locked|\bbusy\b|try again/i
// the form's field to fix (Fix on the page)
const fieldOf = (why: string) => (/\bbase\b/i.test(why) ? 'base' : /extension/i.test(why) ? 'widget' : /workflow/i.test(why) ? 'workflow' : /preset|pick an agent/i.test(why) ? 'preset' : /workspace|is archived|isn't in/i.test(why) ? 'ws' : undefined)
const live = (s: Schedule) => state.schedules?.find(x => x.id === s.id)
// on, or a once task that's due (scheduleTick turns it off as it runs): one that may still try again or wait for a reset
const going = (s: Schedule) => !s.archived && (s.on || (!!s.rule.once && !s.next))
function failedRun(s: Schedule, why: string) {
  const cur = live(s)
  if (!cur?.on) return
  cur.fails = (cur.fails ?? 0) + 1
  if (cur.fails < FAILS_OFF) return void save()
  const field = fieldOf(why)
  Object.assign(cur, { on: false, next: undefined, pausedWhy: why.slice(0, 300), ...(field && { pausedField: field }) })
  delete cur.again, delete cur.catchup
  save()
  changed()
  const name = cur.name ?? runName(cur, Date.now())
  log(`scheduled task ${cur.id}: off, it failed ${FAILS_OFF} times in a row: ${why}`)
  broadcast({ ev: 'scheduled', state: 'failed', name, text: `${name} is off: it failed ${FAILS_OFF} times in a row (${why})` })
  flowPhone(name, undefined, `is off: it failed ${FAILS_OFF} times in a row`, why, 'Scheduled')
}
const goodRun = (s: Schedule) => (cur => cur?.fails && (delete cur.fails, save()))(live(s))
// a start's end (not Run now's: you saw it): good, a retry waiting, or one more failure
function settle(s: Schedule, r: ScheduleRun, o: { asked?: boolean; again?: boolean; event?: TaskEventIn }, now: number) {
  if (o.asked) return
  if (r.ok) return void (r.state === 'done' && goodRun(s))
  if (r.what.startsWith('skipped:')) return
  const cur = live(s)
  if (cur && going(cur) && !o.again && TRANSIENT.test(r.what)) {
    cur.again = { at: now + RETRY_MS, why: 'retry', ...(o.event && { event: o.event }) }
    r.retry = cur.again.at
    r.what += ` (it tries again at ${hhmm(r.retry)})`
    return
  }
  failedRun(s, r.what)
}

// the plan limit of a task's agent (claude's, codex's: usage.ts), reached now: its reset
const usageOf = async (preset: string, now: number) => {
  const agent = presetNamed(preset)?.agent ?? preset
  const account = accountFor({ preset: agent } as Tab, presetNamed(preset)?.account) ?? HOME_ACCOUNT // its tab's, now (one removed since: the agent's own)
  const [u] = await usage(state.settings?.usage, usageWho().filter(x => x.agent === agent && x.account === account), now, statusLimits).catch(() => []) // R4: the agent's own numbers too
  return u && !u.error ? u : undefined
}
async function limitOf(s: Schedule, now: number) {
  const agent = presetNamed(s.preset)?.agent ?? s.preset
  if (agent !== 'claude' && agent !== 'codex') return
  const u = await usageOf(s.preset, now)
  const at = state.settings?.usageAt ?? USAGE_AT
  if (!u?.windows.some(w => !w.note && w.resets && w.used >= at)) return
  const reset = resetOf(u.windows, at)
  return reset !== undefined && reset > now ? { reset, agent } : undefined
}
// how late a deferred start may be: before its next time, and that day's catchUntil when it has one
const deadline = (s: Schedule, now: number) => Math.min(s.next ?? now + 12 * 3600e3, s.catchUntil === undefined ? Infinity : (d => (d.setHours(0, s.catchUntil!, 0, 0) <= now ? d.setDate(d.getDate() + 1) : d.getTime()))(new Date(now)))

// ---------- T5: a task's run workspaces (a new one each run): past keep, its older ones archived as each new one starts,
// oldest first, only those with nothing to lose: clean (wsArchive's ifClean: nothing uncommitted, no submodule or ignored
// work), no open PR, not pinned, no agent working or asking; the rest kept and counted (the row says so). Archive, never
// delete: the branch stays, Restore brings it back, its log entry still links to it
const KEEP = 5
const working = (w: Workspace) => tabsOf(w.id).some(t => t.kind === 'agent' && ['running', 'waiting'].includes(tabStatus(t.id)))
const keeps = (w: Workspace) => !!w.pinned || prOf(w.id)?.state === 'OPEN' || working(w)
const archiveRun = (w: Workspace, why: string) =>
  wsArchive(w.id, { ifClean: true }).then(
    held => (held ? false : (wsLog(w, `archived: ${why}`), true)),
    e => (log(`scheduled run ${w.id} not archived: ${firstLine(e)}`), false),
  )
const tidying = new Map<string, Promise<void>>() // a task's tidy at a time: two runs starting together don't archive one twice
const keepTidy = (s: Schedule) => {
  const p = (tidying.get(s.id) ?? Promise.resolve()).then(() => tidy(s))
  tidying.set(s.id, p)
  return p.finally(() => tidying.get(s.id) === p && tidying.delete(s.id))
}
async function tidy(s: Schedule) {
  const keep = s.keep ?? KEEP
  if (s.ws !== 'new' || s.workflow || s.widget || !keep) return
  const mine = state.workspaces.filter(w => w.schedule === s.id && !w.archived && w.kind === 'worktree').sort((a, b) => b.created - a.created)
  let kept = 0
  for (const w of mine.slice(keep).reverse()) if (!w.archived && (keeps(w) || !(await archiveRun(w, `its scheduled task keeps its last ${keep} runs`)))) kept++
  const cur = live(s)
  if (!cur || (cur.kept ?? 0) === kept) return
  if (kept) cur.kept = kept
  else delete cur.kept
  save()
  changed()
}
// a run whose agent ended with nothing to show (no diff against its base, nothing uncommitted, no PR): archived (emptyGone)
async function emptyGone(r: ScheduleRun, d: { files: number; dirty?: number } | null) {
  const s = state.schedules?.find(x => x.id === r.schedule)
  const w = state.workspaces.find(x => x.id === r.ws)
  if (!s || s.ws !== 'new' || s.emptyGone === false || s.workflow || s.widget || !w || w.archived || w.schedule !== s.id || w.kind !== 'worktree') return
  if (!d || d.files || d.dirty || w.pinned || prOf(w.id) || working(w)) return
  if (!(await archiveRun(w, 'its scheduled run changed nothing'))) return
  r.what += ' · archived: it changed nothing'
  save()
  changed()
}

// one run: a new workspace with the agent and the prompt, or the prompt to the workspace's agent. asked: Run now (its
// condition isn't checked: you asked); late: a catch-up's words (T2), before what it did
export async function runSchedule(s: Schedule, now = Date.now(), o: { asked?: boolean; late?: string; event?: TaskEventIn; again?: boolean } = {}): Promise<ScheduleRun> {
  s = state.schedules?.find(x => x.id === s.id) ?? s // scheduleSet replaces a task: the current one
  const r: ScheduleRun = { id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, now), at: now, ok: true, what: '', ...(o.event && { event: o.event.words }), ...(o.asked && { asked: true }) }
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
    // T6: its agent at its plan limit: started as it resets, if that's before its next time; else skipped
    const limit = !s.widget && !s.workflow && !o.asked ? await limitOf(s, now) : undefined
    if (limit) {
      const cur = live(s)
      if (limit.reset > deadline(s, now) || !cur) return logRun(Object.assign(r, { skipped: true, what: 'skipped: plan limit (it resets after its next time)' }))
      cur.again = { at: limit.reset, why: 'limit', ...(o.event && { event: o.event }) }
      return logRun(Object.assign(r, { retry: limit.reset, what: `deferred: ${limit.agent}'s plan limit, it starts at ${hhmm(limit.reset)} as it resets` }))
    }
    const pre = [o.late, o.event?.words].filter(Boolean).join(', ') // a catch-up's, a retry's; T4: the event that started it
    if (pre) r.what = `${pre}: `
  } catch (e) {
    Object.assign(r, { ok: false, what: (e as Error).message })
    settle(s, r, o, now)
    widgetEvent('schedule.ran', { task: { id: s.id, name: s.name ?? runName(s, now) }, ok: r.ok, what: r.what }, r.ws)
    return logRun(r)
  }
  const stamped = stamp(s.prompt.replaceAll('{{check}}', check), now)
  const prompt = o.event ? fillEvent(stamped, o.event) : stamped.replace(/\{\{event\.\w+\}\}/g, '') // Run now on an event's task: none
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
      const pr = o.event?.kind.startsWith('pr.') && plain(o.event.url) // T4: a PR's event: the PR is its workspace's link
      const ws = await wsNew({ project: s.project, preset: s.preset, prompt, name: title, vars: true, ...(s.ws !== 'local-new' && s.base && { base: s.base }), ...(s.ws !== 'local-new' && s.noSetup && { noSetup: true }), ...(s.ws === 'local-new' && { local: true, another: true }), ...(pr && { linked: pr, guessed: true }), ...(o.event && { outside: true }) }).finally(() => sameMaking.delete(s.id))
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
  settle(s, r, o, now)
  if (late) r.what = late + r.what
  widgetEvent('schedule.ran', { task: { id: s.id, name: s.name ?? runName(s, now) }, ok: r.ok, what: r.what }, r.ws)
  logRun(r)
  if (r.ok && r.ws && s.ws !== 'local-new' && !s.workflow && !s.widget) void keepTidy(s).catch(e => log(`scheduled task ${s.id}: ${firstLine(e)}`)) // T5
  return r
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
        const u = await usageOf(p.preset, now)
        const at = u ? resetOf(u.windows, state.settings?.usageAt ?? USAGE_AT) : undefined
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
  // T6: a retry (5 minutes after a transient failure) or a start at a plan limit's reset, when due
  for (const s of (state.schedules ?? []).filter(x => x.again && x.again.at <= now && going(x))) {
    const a = s.again!
    delete s.again
    save()
    await runSchedule(s, now, { again: true, late: a.why === 'limit' ? 'its plan limit reset' : 'tried again', ...(a.event && { event: a.event }) })
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
async function runEnded(tab: Tab, st: RunState, text?: string, limit?: boolean) { // limit: it ended at a plan limit (T6: not a failure that counts)
  if (!runOfTab(tab.id)) return
  const endedAt = Date.now()
  const d = await wsStat({ ws: tab.workspace, fresh: true }).catch(() => null) // first: the entry changes at once, whole
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
  const s = state.schedules?.find(x => x.id === r.schedule)
  if (s && st !== was && !r.asked) {
    if (st === 'failed' && !limit) failedRun(s, `its agent ended on an error${said ? `: ${said}` : ''}`) // T6: counts; a wait or a plan limit doesn't
    if (st === 'done') goodRun(s)
  }
  if (st === 'done' && was !== 'done') await emptyGone(r, d) // T5
}
// main.ts, as the daemon starts (not as this module loads: core's sets may not be there yet, load-order.test)
export function runOutcomes() {
  turnEnds.add((tab, o) => void setTimeout(() => void runEnded(tab, o.failed || o.limit ? 'failed' : 'done', o.last, !!o.limit && !o.failed).catch(e => log(`run ${tab.id}: ${e.message}`)), 1500).unref?.()) // its usage meter is read a second after the end
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
  const s = state.schedules?.find(x => x.id === r.schedule)
  if (s && !r.asked) r.state === 'done' ? goodRun(s) : r.state === 'failed' && failedRun(s, `its workflow run failed${r.said ? `: ${r.said}` : ''}`) // T6
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
