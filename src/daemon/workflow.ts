// Workflows (experimental: Settings › General, settings.workflows): the engine. A run walks its workflow's graph
// (shared/workflow.ts), pinned to the version it started with, in a worktree of its own (a sidebar row, its `flow`) or
// the project's folder. Agents think inside their blocks; everything between them is decided here, and each decision
// (the block, the exit, why) goes in the run with its variables and a log. Runs live in state.flows (state.json), so a
// restart resumes each at its block. Turn ends come from core's hooks (turnEnds), PR checks from its scans (prOf).
// ponytail: runs only while the daemon is up (the Mac awake); a run command runs on this Mac (not an SSH host)
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { agentVars, findAction, mergeActions, type RunAction, taskTitle, type Project, type Tab, type Workspace } from '../shared/types.ts'
import { stamp } from '../shared/when.ts'
import { ACTIONS, BAD_EXITS, blockName, branchOf, check, exitsOf, fill, FLOW_ENDED, holds, ID, OUTWARD, parse, runOf, RUNS_AT_ONCE, TURNS, type Block, type FlowRun, type FlowStatus, type Workflow, type WorkflowItem, type WorkflowSource } from '../shared/workflow.ts'
import { addTab, broadcast, changed, dir, findProject, isLive, plainEnv, prAct, presets, prOf, projectConfig, q, runDev, save, scanPRs, send as coreSend, sessions, settingUp, shell, ship, state, storageOf, turnEnds, within, wsArchive, wsNew } from './core.ts'

const MAX_FILE = 256 << 10
const FLOWS_KEPT = 100 // ended runs kept (live ones always)
const RUN_TIMEOUT = 10 // a run block's minutes, unless it says
const WAIT_TIMEOUT = 60 // a wait block's
const ANSWER_MAX = 20000 // an agent's answer kept in a variable
const OUTPUT_LINES = 80 // a command's last lines kept
const LOG_LINES = 1000 // a run's log entries kept
const LOG_DETAIL = 4000 // an entry's detail (a prompt, an answer, a command's output) in the log
const LOG_BYTES = 256 << 10 // a run's log, details and all (state.json keeps it): past it, the oldest details go
const DETAILED = 10 // the newest ended runs keep their details; older ones keep only their lines
const RESUME_AFTER = 8000 // after a restart: the agents' tabs come back first
const AFTER_TURN = 900 // a turn's end to the next block: core types what was queued at 800 ms

export const on = () => {
  if (state.settings?.workflows !== true) throw new Error('Workflows are off: turn them on in Settings › General › Experimental')
}

// ---------- workflows: yours (<data>/workflows), a project's (.laki/workflows in its folder); none come with Laki

const yoursDir = () => join(dir, 'workflows')
const projectDir = (p: Project) => join(p.path, '.laki', 'workflows')
const usable = (p: Project) => !p.kind && !p.host // ponytail: not an SSH host's repo (its files are there)

function item(text: string, id: string, source: WorkflowSource, project?: string, path?: string): WorkflowItem {
  const { workflow, problems } = parse(text, id)
  return { ...workflow, source, project, path, text, problems: [...problems, ...check(workflow)], ...(byAgent(agentKey(source, id, project)) && { byAgent: true }) }
}

function readDir(d: string, source: WorkflowSource, project?: string): WorkflowItem[] {
  let names: string[] = []
  try {
    names = readdirSync(d).filter(f => f.endsWith('.md') && ID.test(f.slice(0, -3))).sort()
  } catch {
    return []
  }
  return names.flatMap(f => {
    const path = join(d, f)
    try {
      if (statSync(path).size > MAX_FILE) return []
      return [item(readFileSync(path, 'utf8'), f.slice(0, -3), source, project, path)]
    } catch {
      return []
    }
  })
}

// workflows an agent wrote (MCP's laki_workflow_write), until the user saves them in the app: an agent can't run one
const agentKey = (source: WorkflowSource, id: string, project?: string) => `${source}:${project ?? ''}:${id}`
const byAgent = (k: string) => (state.flowsByAgent ?? []).includes(k)
function markAgent(k: string, on: boolean) {
  if (on === byAgent(k)) return
  state.flowsByAgent = on ? [...(state.flowsByAgent ?? []), k] : state.flowsByAgent!.filter(x => x !== k)
  save()
}

export function flowList(o: { project?: string } = {}): WorkflowItem[] {
  on()
  const only = o.project ? findProject(o.project).id : undefined
  return [
    ...readDir(yoursDir(), 'yours'),
    ...state.projects.filter(p => usable(p) && (!only || p.id === only)).flatMap(p => readDir(projectDir(p), 'project', p.id)),
  ]
}

type Ref = { id: string; source?: WorkflowSource; project?: string }
// a file's folder: yours, or the project's (its id checked: never a path)
function fileOf(o: Ref) {
  if (!ID.test(String(o.id ?? ''))) throw new Error(`${o.id}? a workflow's id: letters, digits, - _`)
  if (o.source === 'project') {
    const p = findProject(String(o.project ?? ''))
    if (!usable(p)) throw new Error(`${p.name} can't keep workflows (Terminals, Browsers and SSH hosts can't)`)
    return { d: projectDir(p), path: join(projectDir(p), `${o.id}.md`), project: p.id }
  }
  if (o.source && o.source !== 'yours') throw new Error(`${o.source}? a workflow is yours or a project's`)
  return { d: yoursDir(), path: join(yoursDir(), `${o.id}.md`) }
}

export function flowFind(o: Ref): WorkflowItem {
  on()
  if (!o.source) {
    // no source: the project's, then yours
    const all = flowList(o.project ? { project: o.project } : {})
    const hit = all.find(w => w.id === o.id && w.source === 'project') ?? all.find(w => w.id === o.id)
    if (!hit) throw new Error(`no workflow ${o.id}`)
    return hit
  }
  const f = fileOf(o)
  if (!existsSync(f.path)) throw new Error(`no workflow ${o.id}`)
  return item(readFileSync(f.path, 'utf8'), o.id, o.source, f.project, f.path)
}

// saved as it is, problems and all (the page shows them; a run refuses them)
export function flowSave(o: Ref & { text: string; by?: 'agent' }): WorkflowItem {
  on()
  const text = String(o.text ?? '')
  if (Buffer.byteLength(text) > MAX_FILE) throw new Error('a workflow file is 256 KB at most')
  const f = fileOf({ ...o, source: o.source ?? 'yours' })
  mkdirSync(f.d, { recursive: true })
  writeFileSync(f.path, text)
  markAgent(agentKey(o.source ?? 'yours', o.id, f.project), o.by === 'agent')
  return item(readFileSync(f.path, 'utf8'), o.id, o.source ?? 'yours', f.project, f.path)
}

export function flowRm(o: Ref) {
  on()
  const f = fileOf(o)
  if (!existsSync(f.path)) throw new Error(`no workflow ${o.id}`)
  rmSync(f.path)
  markAgent(agentKey(o.source ?? 'yours', o.id, f.project), false)
  return { ok: true }
}

// ---------- runs

const runs = () => (state.flows ??= [])
const live = (r: FlowRun) => !FLOW_ENDED.includes(r.status)
const procs = new Map<string, ChildProcess>() // a run block's command, by run
const blockOf = (r: FlowRun, id?: string) => r.flow.blocks.find(b => b.id === id)
const wsOf = (r: FlowRun) => state.workspaces.find(w => w.id === r.ws)
const clip = (s: string, n = 100) => {
  const l = String(s ?? '').trim().split('\n')[0]
  return l.length > n ? `${l.slice(0, n - 1)}…` : l
}

export function flowGet(o: { id: string }): FlowRun {
  on()
  const r = runs().find(x => x.id === o.id)
  if (!r) throw new Error(`no workflow run ${o.id}`)
  return r
}

// a log entry: its time and line, then what went with it (a prompt, an answer, a command's output) on the lines after
function say(r: FlowRun, line: string, detail?: string) {
  const t = new Date().toTimeString().slice(0, 8)
  const d = String(detail ?? '').trim()
  r.log.push(`${t} ${line}${d ? `\n${d.length > LOG_DETAIL ? `…${d.slice(-LOG_DETAIL)}` : d}` : ''}`)
  if (r.log.length > LOG_LINES) r.log.splice(0, r.log.length - LOG_LINES)
  let size = r.log.reduce((n, l) => n + l.length, 0)
  for (let i = 0; size > LOG_BYTES && i < r.log.length - 1; i++) {
    const was = r.log[i]
    r.log[i] = bare(was)
    size -= was.length - r.log[i].length
  }
}
// an entry's line without its detail
const bare = (l: string) => (l.includes('\n') ? `${l.slice(0, l.indexOf('\n'))} …` : l)
function decide(r: FlowRun, b: Block, exit: string, why: string, you = false) {
  r.decisions.push({ at: Date.now(), block: b.id, exit, why, ms: Date.now() - (r.at ?? Date.now()), ...(you && { you }), ...(BAD_EXITS.includes(exit) && { bad: true }) })
  if (r.decisions.length > 300) r.decisions.splice(0, r.decisions.length - 300)
}
const touch = () => (save(), changed())

// what {{…}} fills: the run's own, the workspace's, its PR's (now)
function varsOf(r: FlowRun): Record<string, string> {
  const ws = wsOf(r)
  const pr = ws && prOf(ws.id)
  // the agent variables ({{branch}}, {{path}}…: what actions and templates take) under the run's own
  const agent = ws ? Object.fromEntries(Object.entries(agentVars(ws, { project: state.projects.find(p => p.id === ws.project)?.name, pr: pr?.url })).filter((e): e is [string, string] => e[1] !== undefined)) : {}
  return { ...agent, ...r.vars, ...(ws && { 'ws.branch': ws.branch, 'ws.path': ws.path, 'ws.id': ws.id, base: ws.base }), ...(pr && { 'pr.url': pr.url, 'pr.number': String(pr.number) }) }
}

export async function flowStart(o: { workflow: string; source?: WorkflowSource; project: string; task?: string; dry?: boolean; trigger?: string; by?: 'agent' }) {
  on()
  const wf = flowFind({ id: o.workflow, source: o.source, project: o.project })
  if (wf.problems.length) throw new Error(`${wf.name} can't run: ${wf.problems[0]}`)
  if (o.by === 'agent' && wf.byAgent) throw new Error(`an agent wrote ${wf.name}: the user runs it first, from Laki's Workflows, once they've read and saved it`)
  const proj = findProject(o.project)
  if (proj.kind) throw new Error('workflows run in a project: Terminals and Browsers have none')
  if (wf.where === 'worktree' && proj.git === false) throw new Error(`${proj.name} isn't a git repository: ${wf.name} runs in a worktree (runs in: main works there)`)
  const task = String(o.task ?? '').trim()
  if (wf.blocks.find(b => b.kind === 'start')?.input === 'task' && !task) throw new Error('what should it work on? (a task)')
  const going = runs().filter(r => live(r) && runOf(r, wf)).length
  if (going >= (wf.runs ?? RUNS_AT_ONCE)) throw new Error(`${wf.name} has ${going} runs going (at once: ${wf.runs ?? RUNS_AT_ONCE}): stop one or wait`)
  const { source, project, path, text, problems, byAgent: _, ...flow } = wf
  const r: FlowRun = { id: randomUUID().slice(0, 8), workflow: wf.id, source, flow: JSON.parse(JSON.stringify(flow)), project: proj.id, where: wf.where, session: wf.session, ...(o.dry && { dry: true }), task, trigger: o.trigger || 'you', status: 'running', visits: {}, vars: { task, project: proj.name }, tabs: {}, turns: 0, decisions: [], log: [], started: Date.now() }
  runs().push(r)
  say(r, `${wf.name}${r.dry ? ' (dry run)' : ''}: ${task || 'started'}`)
  touch()
  let ws: Workspace
  try {
    ws = wf.where === 'worktree' ? await wsNew({ project: proj.id, preset: 'none', name: taskTitle(task, 5) || wf.id }) : await wsNew({ project: proj.id, local: true, preset: 'none' })
  } catch (e) {
    finish(r, 'failed', `no workspace: ${(e as Error).message}`)
    throw e
  }
  r.ws = ws.id
  if (wf.where === 'worktree') ws.flow = r.id // its row's mark
  say(r, `in ${ws.name ?? ws.id} (${ws.kind === 'worktree' ? `worktree, branch ${ws.branch}` : 'the project folder'})`)
  enter(r, r.flow.blocks.find(b => b.kind === 'start')!)
  return r
}

function enter(r: FlowRun, b: Block, again = false): void {
  if (!live(r)) return
  if (!again) {
    const n = (r.visits[b.id] ?? 0) + 1
    if (b.max && n > b.max.n) {
      decide(r, b, `after ${b.max.n}`, `ran ${b.max.n} times`)
      say(r, `${blockName(b)} ran ${b.max.n} times: ${b.max.to ? `on to ${blockName(blockOf(r, b.max.to)!)}` : 'asks you'}`)
      return b.max.to ? enter(r, blockOf(r, b.max.to)!) : stuck(r, b, `${blockName(b)} ran ${b.max.n} times`)
    }
    r.visits[b.id] = n
  }
  Object.assign(r, { cur: b.id, at: Date.now(), wait: undefined, status: 'running' })
  touch()
  work(r, b).catch(e => stuck(r, b, `${blockName(b)}: ${(e as Error).message}`))
}

function leave(r: FlowRun, b: Block, exit: string, why: string, you = false): void {
  if (!live(r) || r.cur !== b.id) return // a late event: the run moved on, or ended
  decide(r, b, exit, why, you)
  say(r, `${blockName(b)} → ${exit}: ${why}`)
  const e = exitsOf(b).find(x => x.name === exit)
  if (!e?.to) return BAD_EXITS.includes(exit) ? stuck(r, b, `${blockName(b)}: ${why}`) : finish(r, 'done', `${blockName(b)}'s ${exit} leads nowhere: the end`)
  enter(r, blockOf(r, e.to)!)
}

async function work(r: FlowRun, b: Block) {
  const vars = varsOf(r)
  switch (b.kind) {
    case 'start':
      return leave(r, b, 'next', r.dry ? 'started (dry run: outward actions are said, not done)' : 'started')
    case 'end':
      return finish(r, b.result === 'stopped' ? 'stopped' : b.result === 'failed' ? 'failed' : 'done', blockName(b), b.notify)
    case 'agent':
      return agent(r, b)
    case 'run':
      return command(r, b)
    case 'choice': {
      const want = b.value ?? ''
      const yes = holds(valueOf(r, vars, b.of), b.test, want)
      const opt = b.options![yes ? 0 : 1]
      return leave(r, b, opt.label, `${b.of} ${yes ? '' : "doesn't "}${b.test === 'matches' ? 'match' : b.test === 'equals' ? 'equal' : 'contain'}${yes ? (b.test === 'matches' ? 'es' : 's') : ''} "${want}"`)
    }
    case 'case': {
      // the first branch that holds, else the last (check: else is there, last)
      for (const o of b.options ?? []) {
        const br = branchOf(o.label)
        if (!br) throw new Error(`“${o.label}” isn't a branch`)
        if (br === 'else') return leave(r, b, o.label, 'nothing above matched: else')
        const of = br.of ?? b.of ?? ''
        const v = valueOf(r, vars, of)
        if (holds(v, br.test, br.value)) return leave(r, b, o.label, `${of} ${br.test === 'matches' ? 'matches' : br.test} "${br.value}" (${clip(v.replace(/\s+/g, ' ').trim() || 'empty', 60)})`)
      }
      throw new Error('no branch matched, and no else')
    }
    case 'ask':
      return ask(r, 'ask', fill(b.question ?? '', vars), fill(b.show ?? '', vars), (b.options ?? []).map(o => o.label))
    case 'action':
      if (OUTWARD.includes(b.action!) && b.confirm !== false && !r.dry) return ask(r, 'confirm', `${ACTIONS[b.action!]}?`, b.action === 'ship' ? `Commit message: ${fill(b.text || '{{task}}', vars)}` : undefined, ['Do it', 'Stop the run'])
      return act(r, b)
    case 'wait':
      r.wait = { kind: 'wait' }
      touch()
      void scanPRs() // its state now, not at the minute's scan
      return waitTick(r, b, Date.now())
    case 'save':
      return keep(r, b, vars)
  }
}

// what a choice or a case tests: a variable, else a block's answer, else its output (none: empty)
const valueOf = (r: FlowRun, vars: Record<string, string>, of = '') => r.vars[of] ?? vars[of] ?? r.vars[`steps.${of}.answer`] ?? r.vars[`steps.${of}.output`] ?? ''

// a save block: text, a file or folder of the workspace, or a link (<file>.url), into its storage folder (its Artifacts)
function keep(r: FlowRun, b: Block, vars: Record<string, string>) {
  const ws = wsOf(r)
  const root = ws && storageOf(ws)
  if (!ws || !root) throw new Error('this workspace has no storage folder')
  const link = b.link && fill(b.link, vars).trim()
  if (b.link && !/^https?:\/\/\S+$/i.test(link || '')) throw new Error(`${b.link}${link !== b.link ? ` (${link})` : ''}: not an http(s) link`)
  const name = fill(b.file ?? '', vars).trim()
  const path = resolve(root, link && !/\.url$/i.test(name) ? `${name}.url` : name)
  if (!path.startsWith(root + sep)) throw new Error(`${b.file}: a path in the storage folder`)
  mkdirSync(resolve(path, '..'), { recursive: true })
  if (b.from) {
    const top = realpathSync(ws.path)
    const src = resolve(ws.path, fill(b.from, vars).trim())
    if (!existsSync(src)) throw new Error(`${b.from}: no such file in the workspace`)
    const real = realpathSync(src) // a link out of the workspace isn't its file
    if (real === top || !within(top, real)) throw new Error(`${b.from}: a file or folder in the workspace (not all of it)`)
    cpSync(real, path, { recursive: true, force: true })
  } else if (link) writeFileSync(path, `[InternetShortcut]\r\nURL=${link}\r\n`)
  else writeFileSync(path, fill(b.text ?? '', vars))
  r.vars[`steps.${b.id}.output`] = path
  return leave(r, b, 'ok', `${b.from ? 'copied' : link ? 'linked' : 'wrote'} ${basename(path)}`)
}

// ---------- agent blocks: a prompt to a tab, then its turn's end (core's turnEnds)

const tabOf = (id?: string) => state.tabs.find(t => t.id === id)
const alive = (id?: string) => {
  const t = tabOf(id)
  return t && isLive(t) ? t : undefined
}

function agent(r: FlowRun, b: Block) {
  if (r.turns >= (r.flow.turns ?? TURNS)) return stuck(r, b, `${r.turns} agent turns in this run`, ['Go on', 'Stop the run'])
  const ws = wsOf(r)
  if (!ws || ws.archived) throw new Error('its workspace is gone')
  // use: one of the user's agent actions (Run ▾'s: Settings', the project's), its prompt first, the block's after it
  // Run ▾'s agent actions: Settings' and the project's own (the app's, as Run ▾ has them)
  const agentActs = (l?: RunAction[]) => l?.filter(a => a.target !== 'shell')
  const g = agentActs(state.settings?.actions), own = agentActs(state.projects.find(p => p.id === ws.project)?.config?.actions)
  const action = findAction(g, own, b.use)
  if (b.use && !action) throw new Error(`no agent action “${b.use}” here (Settings › Actions, or the project's)${(x => (x.length ? `: ${x.join(', ')}` : ''))(mergeActions(g, own).map(a => a.slug ?? a.name))}`)
  const vars = varsOf(r)
  const prompt = [action && stamp(action.text, Date.now()), b.text].filter(t => t?.trim()).map(t => fill(t!, vars)).join('\n\n')
  const preset = b.agent || 'claude'
  if (presets().find(p => p.name === preset)?.agent === 'command') throw new Error(`${preset} is a command, not an agent: it doesn't say when it's done`)
  // session: run (the run's tab of that agent), new (a tab of its own), or another block's tab
  const key = b.session === 'new' ? undefined : b.session && b.session !== 'run' ? b.session : `run:${preset}`
  let tab = key ? alive(r.tabs[key]) : undefined
  // a shared session: the last run's tab, when it's in this workspace (runs in: main), else a fork of its chat (claude)
  let forkOf: string | undefined
  if (!tab && key === `run:${preset}` && r.session === 'shared') {
    // this workflow's runs in this project: another repo's chat is no session of this one
    const before = runs().filter(x => x !== r && x.project === r.project && runOf(x, { id: r.workflow, source: r.source, project: r.project }) && x.tabs[key]).sort((a, b) => b.started - a.started)[0]
    const t = before && tabOf(before.tabs[key])
    if (t?.workspace === ws.id && isLive(t) && !runs().some(x => x !== r && live(x) && Object.values(x.tabs).includes(t.id))) tab = t
    else forkOf = t?.resumeId ?? before?.resume?.[key]
  }
  // a tab that just started (a restart resumed it) takes typing once it's drawn: it printed, then half a second quiet
  const s = tab && sessions.get(tab.id)
  if (s && Date.now() - s.born < 10000 && (Date.now() - s.born < 2000 || Date.now() - s.lastOutput < 500)) return later(r, b, agent)
  let queued = false
  if (tab) {
    queued = !!send(tab.id, prompt).queued // after the turn under way: until it's typed in, a turn's end isn't ours
    say(r, `${blockName(b)}: to ${tab.name}${queued ? ' (queued: it was busy)' : ''}${action ? ` · ${action.name}` : ''}`, prompt)
  } else {
    tab = addTab(ws.id, { preset, prompt, model: b.model, effort: b.effort, forkOf, name: key === `run:${preset}` ? undefined : blockName(b) })
    say(r, `${blockName(b)}: a new ${preset} tab, ${tab.name}${forkOf ? ' (the last run’s chat, forked)' : ''}${action ? ` · ${action.name}` : ''}`, prompt)
  }
  r.tabs[b.id] = tab.id
  if (key) r.tabs[key] = tab.id
  tab.flow = r.id // the session links back to the run
  r.turns++
  r.wait = { kind: 'agent', tab: tab.id, ...(queued && { queued: prompt }) }
  touch()
}
// the block again in half a second (a tab still drawing, a setup script still running)
function later(r: FlowRun, b: Block, f: (r: FlowRun, b: Block) => void) {
  r.wait = { kind: 'run' }
  setTimeout(() => {
    if (!live(r) || r.cur !== b.id || r.wait?.kind !== 'run') return
    try {
      f(r, b)
    } catch (e) {
      stuck(r, b, `${blockName(b)}: ${(e as Error).message}`)
    }
  }, 500)
}
const send = (tab: string, text: string) => coreSend({ target: tab, text, whenIdle: true }) as { queued?: number }

turnEnds.add((tab: Tab, o: { last?: string; limit?: number; failed: boolean }) => {
  for (const r of runs()) {
    if (!live(r) || (r.wait?.kind !== 'agent' && r.wait?.kind !== 'limit') || r.wait.tab !== tab.id) continue
    const b = blockOf(r, r.cur)!
    if (r.wait.kind === 'agent' && r.wait.queued !== undefined && tab.queue?.includes(r.wait.queued)) continue // a turn before ours: ours is still queued
    if (o.limit) {
      Object.assign(r, { status: 'paused' as FlowStatus, wait: { kind: 'limit', tab: tab.id, until: o.limit } })
      say(r, `${blockName(b)}: ${tab.name} hit its usage limit; paused until ${new Date(o.limit).toTimeString().slice(0, 5)}`)
      touch()
      continue
    }
    if (tab.resumeId) for (const [k, id] of Object.entries(r.tabs)) if (id === tab.id && k.startsWith('run:')) (r.resume ??= {})[k] = tab.resumeId
    r.vars[`steps.${b.id}.answer`] = String(o.last ?? '').slice(-ANSWER_MAX)
    if (o.last) say(r, `${tab.name} answered`, String(o.last))
    Object.assign(r, { status: 'running' as FlowStatus, wait: undefined })
    // on after core's deliver (800 ms: the agent redraws its prompt after the hook), so what was queued goes first
    setTimeout(() => leave(r, b, o.failed ? 'error' : 'next', o.failed ? `${tab.name} failed: ${clip(o.last ?? '')}` : o.last ? `${tab.name}: “${clip(o.last, 80)}”` : `${tab.name} is done`), AFTER_TURN)
  }
})

// ---------- run blocks: a shell command in the run's folder, its exit code

function command(r: FlowRun, b: Block) {
  const ws = wsOf(r)
  if (!ws || ws.archived) throw new Error('its workspace is gone')
  if (ws.host) throw new Error('run blocks run on this Mac: not in an SSH host’s workspace')
  if (settingUp(ws)) return later(r, b, command)
  kill0(r) // never two at once
  const vars = Object.fromEntries(Object.entries(varsOf(r)).map(([k, v]) => [k, q(v)])) // every value quoted: an answer is never shell
  const cmd = fill(b.cmd ?? '', vars)
  const storage = storageOf(ws)
  const child = spawn(shell, ['-lc', cmd], { cwd: ws.path, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...plainEnv(), ...state.settings?.env, ...projectConfig(ws).env, PORT: String(ws.port), LAKI_WORKSPACE: ws.id, LAKI_FLOW: r.id, ...(storage && { LAKI_STORAGE_FOLDER: storage }), CI: '1' } })
  procs.set(r.id, child)
  let out = ''
  const take = (d: Buffer) => (out = (out + d.toString()).slice(-64000))
  child.stdout!.on('data', take)
  child.stderr!.on('data', take)
  const min = b.timeout ?? RUN_TIMEOUT
  let late = false
  const timer = setTimeout(() => ((late = true), kill(child)), min * 60000)
  child.on('error', e => (out += `\n${e.message}`))
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    if (procs.get(r.id) !== child) return // stopped, or run again
    procs.delete(r.id)
    const lines = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').trimEnd().split('\n')
    r.vars[`steps.${b.id}.output`] = lines.slice(-OUTPUT_LINES).join('\n')
    r.vars[`steps.${b.id}.code`] = String(code ?? -1)
    if (lines.join('').trim()) say(r, `${blockName(b)}: its output`, lines.slice(-OUTPUT_LINES).join('\n'))
    leave(r, b, code === 0 ? 'ok' : 'fail', late ? `stopped after ${min} min` : signal ? `killed (${signal})` : `exit ${code}${code ? `: ${clip(lines.at(-1) ?? '', 80)}` : ''}`)
  })
  r.wait = { kind: 'run' }
  say(r, `${blockName(b)}: ${clip(cmd, 120)}`)
  touch()
}
function kill(c: ChildProcess) {
  try {
    process.kill(-c.pid!, 'SIGTERM') // its group: npm and what it started
    setTimeout(() => {
      try {
        process.kill(-c.pid!, 'SIGKILL')
      } catch {}
    }, 3000).unref()
  } catch {}
}

// ---------- actions, waits, asks

async function act(r: FlowRun, b: Block) {
  const ws = wsOf(r)
  if (!ws || ws.archived) throw new Error('its workspace is gone')
  const a = b.action!
  if (r.dry && OUTWARD.includes(a)) return leave(r, b, 'ok', `dry run: would ${ACTIONS[a].toLowerCase()}`)
  try {
    if (a === 'ship') {
      const tab = ship(ws.id, fill(b.text || '{{task}}', varsOf(r)))
      const s = sessions.get(tab.id)!
      const then = s.onExit
      s.onExit = code => {
        then(code)
        if (sessions.get(tab.id) === s) leave(r, b, code ? 'error' : 'ok', code ? `ship exited ${code}` : 'committed, pushed, PR open') // not one shutdown killed: that one resumes
      }
      r.wait = { kind: 'run' }
      return touch()
    }
    if (a === 'approve' || a === 'merge') await prAct({ ws: ws.id, act: a })
    else if (a === 'dev') runDev(ws.id)
    else if (a === 'archive') await wsArchive(ws.id)
    else throw new Error(`no action ${a}`)
    leave(r, b, 'ok', a === 'dev' ? 'the dev server runs' : `${a}d`)
  } catch (e) {
    leave(r, b, 'error', (e as Error).message)
  }
}

// a wait block: its PR's checks, as the scans see them; a failure on a commit already reported waits for a new one
function waitTick(r: FlowRun, b: Block, now: number) {
  const ws = wsOf(r)
  if (r.dry) return leave(r, b, 'pass', 'dry run: taken as passed')
  if (now - (r.at ?? now) > (b.timeout ?? WAIT_TIMEOUT) * 60000) return leave(r, b, 'fail', `nothing after ${b.timeout ?? WAIT_TIMEOUT} min`)
  const pr = ws && prOf(ws.id)
  if (!pr) return
  const seen = r.vars[`steps.${b.id}.head`]
  if (pr.checks === 'fail' && pr.head && pr.head === seen) return // the commit it failed on before: the fix's push isn't scanned yet
  if (pr.checks === 'pass' || (pr.checks === '' && now - (r.at ?? now) > 120000)) return leave(r, b, 'pass', pr.checks ? `PR #${pr.number}'s checks pass` : `PR #${pr.number} has no checks`)
  if (pr.checks === 'fail') {
    const bad = (pr.list ?? []).filter(c => c.state === 'fail')
    r.vars[`steps.${b.id}.output`] = bad.map(c => `${c.name}${c.url ? ` ${c.url}` : ''}`).join('\n') || 'checks fail'
    if (pr.head) r.vars[`steps.${b.id}.head`] = pr.head
    return leave(r, b, 'fail', `${bad.map(c => c.name).join(', ') || 'checks'} failed on PR #${pr.number}`)
  }
}

function ask(r: FlowRun, kind: 'ask' | 'confirm' | 'stuck', question: string, show: string | undefined, options: string[]) {
  Object.assign(r, { status: 'waiting' as FlowStatus, wait: { kind, question, ...(show && { show }), options } })
  say(r, `asks you: ${question}`, show)
  touch()
  broadcast({ ev: 'flow', id: r.id, ws: r.ws, kind: 'waiting', name: r.flow.name, text: question })
}
function stuck(r: FlowRun, b: Block, why: string, options = ['Try again', 'Stop the run']) {
  if (!live(r)) return
  kill0(r)
  r.cur = b.id
  ask(r, 'stuck', why, undefined, options)
}

export function flowAnswer(o: { id: string; n: number; text?: string }) {
  const r = flowGet(o)
  const w = r.wait
  if (r.status !== 'waiting' || !w || !('options' in w)) throw new Error('that run isn’t asking anything')
  const label = w.options[o.n]
  if (label === undefined) throw new Error(`choice ${o.n}? 0 to ${w.options.length - 1}`)
  const b = blockOf(r, r.cur)!
  const typed = String(o.text ?? '').trim()
  if (w.kind === 'ask') r.vars.answer = typed || label // yours: a confirm's or a retry's button isn't words for a prompt
  r.wait = undefined
  r.status = 'running'
  if (w.kind === 'ask') return leave(r, b, label, `you: ${label}${typed ? ` · “${clip(typed, 80)}”` : ''}`, true), r
  if (o.n === w.options.length - 1) return decide(r, b, 'stop', 'you stopped it', true), finish(r, 'stopped', 'you stopped it'), r
  decide(r, b, w.kind === 'confirm' ? 'yes' : 'again', `you: ${label}`, true)
  if (w.kind === 'confirm') return say(r, `${blockName(b)}: you said do it`), void act(r, b).catch(e => stuck(r, b, `${blockName(b)}: ${(e as Error).message}`)), r
  // stuck: the block again, its count and the turns given back
  if (r.turns >= (r.flow.turns ?? TURNS)) r.turns = 0
  r.visits[b.id] = 0
  say(r, `${blockName(b)}: again`)
  enter(r, b)
  return r
}

function kill0(r: FlowRun) {
  const c = procs.get(r.id)
  procs.delete(r.id)
  if (c) kill(c)
}

function finish(r: FlowRun, status: FlowStatus, why: string, notify?: boolean) {
  if (!live(r)) return
  kill0(r)
  Object.assign(r, { status, ended: Date.now(), wait: undefined })
  say(r, `${status}: ${why}`)
  // ended ones past FLOWS_KEPT go, the oldest first
  const ended = runs().filter(x => !live(x))
  if (ended.length > FLOWS_KEPT) state.flows = runs().filter(x => live(x) || ended.indexOf(x) >= ended.length - FLOWS_KEPT)
  for (const x of [...ended].sort((a, b) => (a.ended ?? 0) - (b.ended ?? 0)).slice(0, -DETAILED)) if (x.log.some(l => l.includes('\n'))) x.log = x.log.map(bare) // the ones that ended before: their lines
  touch()
  broadcast({ ev: 'flow', id: r.id, ws: r.ws, kind: 'end', status, name: r.flow.name, text: why, notify: !!notify || status === 'failed' })
}

export function flowStop(o: { id: string }) {
  const r = flowGet(o)
  if (!live(r)) throw new Error(`that run is ${r.status} already`)
  finish(r, 'stopped', 'you stopped it')
  return r
}

// a run off the list (a live one stops first); its workspace and tabs stay
export function flowForget(o: { id: string }) {
  const r = flowGet(o)
  if (live(r)) finish(r, 'stopped', 'you deleted it')
  state.flows = runs().filter(x => x !== r)
  const ws = wsOf(r)
  if (ws?.flow === r.id) delete ws.flow // its row's mark
  for (const t of state.tabs) if (t.flow === r.id) delete t.flow // and its sessions' link
  touch()
  return { ok: true }
}

// every 5 s: waits, agents that went away, workspaces that did
export function flowTick(now = Date.now()) {
  if (state.settings?.workflows !== true) return
  if (resumeLater) flowResume() // turned on since the start
  for (const r of runs()) {
    if (!live(r)) continue
    const b = blockOf(r, r.cur)
    const ws = wsOf(r)
    if (r.ws && (!ws || ws.archived) && !(b?.kind === 'action' && b.action === 'archive')) {
      finish(r, 'failed', 'its workspace was archived or deleted')
      continue
    }
    if (!b) continue
    if (r.wait?.kind === 'wait' && r.status === 'running') waitTick(r, b, now)
    else if (r.wait?.kind === 'agent' && !alive(r.wait.tab)) leave(r, b, 'error', `${tabOf(r.wait.tab)?.name ?? 'its tab'} stopped`)
  }
}

// at the daemon's start: each run back at its block. An agent's turn was cut short, so it's asked again (its tab
// resumes its chat first); a command runs again; asks wait on
// ponytail: the prompt goes again whole; the agent may redo work it had done
let resumeLater = false
export function flowResume() {
  resumeLater = state.settings?.workflows !== true
  if (resumeLater) return // off: they wait until it's on again
  const back = runs().filter(r => live(r) && r.status !== 'waiting')
  const was = new Map(back.map(r => [r, r.cur]))
  for (const r of back) say(r, `Laki restarted: back at ${blockName(blockOf(r, r.cur) ?? ({ id: '?' } as Block))}`)
  if (!back.length) return
  save()
  setTimeout(() => {
    for (const r of back) {
      const b = blockOf(r, r.cur)
      if (!live(r) || !b || r.status === 'waiting' || r.cur !== was.get(r)) continue // moved on meanwhile: that block is under way
      if (r.wait?.kind === 'wait') continue // flowTick
      enter(r, b, true)
    }
  }, RESUME_AFTER).unref()
}

export const flowStopAll = () => [...procs.keys()].forEach(id => kill0({ id } as FlowRun)) // shutdown
