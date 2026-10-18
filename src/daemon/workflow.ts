// Workflows (experimental: Settings › General, settings.workflows): the engine. A run walks its workflow's graph
// (shared/workflow.ts), pinned to the version it started with, in a worktree of its own (a sidebar row, its `flow`) or
// the project's folder. Agents think inside their blocks; everything between them is decided here, and each decision
// (the block, the exit, why) goes in the run with its variables and a log. Runs live in state.flows (state.json), so a
// restart resumes each at its block. Turn ends come from core's hooks (turnEnds), PR checks from its scans (prOf).
// ponytail: runs only while the daemon is up (the Mac awake); a run command runs on this Mac (not an SSH host)
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { agentVars, findAction, mergeActions, type RunAction, taskTitle, type Project, type Tab, type Workspace } from '../shared/types.ts'
import { stamp } from '../shared/when.ts'
import { ACTIONS, apiQuestions, jsonFill, varsFill, BAD_EXITS, NUM_TESTS, SHOWN_MAX, blockName, branchOf, check, DECIDE_MODELS, exitsOf, fill, FLOW_ENDED, holds, ID, jsonAsk, lastJson, OUTWARD, outAsk, outsOf, parse, RETRY_KINDS, SURE, runOf, RUNS_AT_ONCE, TURNS, type Block, type FlowRun, type FlowStatus, type Workflow, type WorkflowItem, type WorkflowSource } from '../shared/workflow.ts'
import { addTab, broadcast, changed, dir, findProject, flowFiles, flowHooks, flowPhone, isLive, killGroup, plainEnv, prAct, presets, prOf, projectConfig, q, runDev, save, scanPRs, send as coreSend, sessions, settingUp, shell, ship, state, storageOf, turnEnds, within, wsArchive, wsNew } from './core.ts'
import { aiComplete, aiDecide } from './ai.ts'
import { widgetUse } from './widgets.ts'

const MAX_FILE = 256 << 10
const FLOWS_KEPT = 100 // ended runs kept (live ones always)
const RUN_TIMEOUT = 10 // a run block's minutes, unless it says
const CALL_TIMEOUT = 2 // an AI call's or a webhook's
const BODY_MAX = 10 << 20 // a webhook's file
const WAIT_TIMEOUT = 60 // a wait block's
const ANSWER_MAX = 20000 // an agent's answer kept in a variable
const OUTPUT_LINES = 80 // a command's last lines kept
const LOG_LINES = 1000 // a run's log entries kept
const LOG_DETAIL = 4000 // an entry's detail (a prompt, an answer, a command's output) in the log
const LOG_BYTES = 256 << 10 // a run's log, details and all (state.json keeps it): past it, the oldest details go
const DETAILED = 10 // the newest ended runs keep their details; older ones keep only their lines
const RESUME_AFTER = 8000 // after a restart: the agents' tabs come back first
const AFTER_TURN = 900 // a turn's end to the next block: core types what was queued at 800 ms
const RETRY_WAIT = [10, 60] // seconds before a block's first try again, then before each later one

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
  flowFiles.at = Date.now()
  changed()
  return item(readFileSync(f.path, 'utf8'), o.id, o.source ?? 'yours', f.project, f.path)
}

export function flowRm(o: Ref) {
  on()
  const f = fileOf(o)
  if (!existsSync(f.path)) throw new Error(`no workflow ${o.id}`)
  rmSync(f.path)
  markAgent(agentKey(o.source ?? 'yours', o.id, f.project), false)
  flowFiles.at = Date.now()
  changed()
  return { ok: true }
}

// ---------- runs

const runs = () => (state.flows ??= [])
const live = (r: FlowRun) => !FLOW_ENDED.includes(r.status)
const procs = new Map<string, ChildProcess>() // a run block's command, by run
const calls = new Map<string, AbortController>() // an AI call's or a webhook's request, by run
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
  return { ...varsFill(r.flow.vars, state.settings?.flowVars), ...agent, ...r.vars, ...(ws && { 'ws.branch': ws.branch, 'ws.path': ws.path, 'ws.id': ws.id, base: ws.base }), ...(pr && { 'pr.url': pr.url, 'pr.number': String(pr.number) }) }
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
    if (r.tries?.[b.id]) delete r.tries[b.id] // entered anew: its tries again are its own
  }
  Object.assign(r, { cur: b.id, at: Date.now(), wait: undefined, status: 'running' })
  touch()
  work(r, b).catch(e => stuck(r, b, `${blockName(b)}: ${(e as Error).message}`))
}

function leave(r: FlowRun, b: Block, exit: string, why: string, you = false): void {
  if (!live(r) || r.cur !== b.id) return // a late event: the run moved on, or ended
  if (!you && BAD_EXITS.includes(exit) && retry(r, b, why)) return
  decide(r, b, exit, why, you)
  say(r, `${blockName(b)} → ${exit}: ${why}`)
  const e = exitsOf(b).find(x => x.name === exit)
  if (!e?.to) return BAD_EXITS.includes(exit) ? stuck(r, b, `${blockName(b)}: ${why}`) : finish(r, 'done', `${blockName(b)}'s ${exit} leads nowhere: the end`)
  enter(r, blockOf(r, e.to)!)
}

// retry: a bad exit with tries left enters the block again after a wait (RETRY_WAIT), not counted as a visit (an agent's
// try is a turn, though); a run block's retry on: only those exit codes. The wait is r.wait's, so flowTick (and a
// restart) takes it up too
function retry(r: FlowRun, b: Block, why: string) {
  const n = r.tries?.[b.id] ?? 0
  if (!b.retry || !RETRY_KINDS.includes(b.kind) || n >= b.retry) return false
  if (b.kind === 'run' && b.retryOn?.length && !b.retryOn.includes(Number(r.vars[`steps.${b.id}.code`]))) return false
  const secs = RETRY_WAIT[Math.min(n, RETRY_WAIT.length - 1)]
  ;(r.tries ??= {})[b.id] = n + 1
  const until = Date.now() + secs * 1000
  Object.assign(r, { status: 'running' as FlowStatus, wait: { kind: 'retry', until } })
  decide(r, b, 'retry', `${why}: tries again (${n + 2} of ${b.retry + 1})`)
  say(r, `${blockName(b)}: tries again (${n + 2} of ${b.retry + 1}) in ${secs} s: ${why}`)
  touch()
  setTimeout(() => again(r, b, until), secs * 1000)
  return true
}
// the try again it waited for, unless the run stopped or moved on meanwhile (or an earlier timer finds a later wait)
function again(r: FlowRun, b: Block, until?: number) {
  if (!live(r) || r.cur !== b.id || r.wait?.kind !== 'retry' || (until !== undefined && r.wait.until !== until)) return
  enter(r, b, true)
}

async function work(r: FlowRun, b: Block) {
  const vars = varsOf(r)
  switch (b.kind) {
    case 'start':
      return leave(r, b, 'next', r.dry ? 'started (dry run: outward actions are said, not done)' : 'started')
    case 'end':
      // its words (none: its name) end the log, and the notification it asks for
      return finish(r, b.result === 'stopped' ? 'stopped' : b.result === 'failed' ? 'failed' : 'done', fill(b.text ?? '', vars).trim().slice(0, 500) || blockName(b), b.notify, b.notify && b.phone)
    case 'agent':
      return agent(r, b)
    case 'run':
      return command(r, b)
    case 'llm':
      return sent(r, b, llmSend(b, vars, `${r.flow.name} · ${blockName(b)}`))
    case 'decide':
      return sent(r, b, decideSend(b, vars, before(r, vars), `${r.flow.name} · ${blockName(b)}`))
    case 'webhook': {
      const ws = wsOf(r)
      const send = hookSend(b, vars, envOf(ws), ws?.path, runBody(r))
      return r.dry ? leave(r, b, 'ok', send.dry) : sent(r, b, send)
    }
    case 'choice': {
      const want = b.value ?? ''
      const yes = holds(valueOf(r, vars, b.of), b.test, want)
      const opt = b.options![yes ? 0 : 1]
      const v = valueOf(r, vars, b.of)
      if (NUM_TESTS.includes(b.test ?? '')) return leave(r, b, opt.label, `${b.of} is ${clip(v.trim() || 'empty', 30)}: ${yes ? '' : 'not '}${b.test} ${want}`)
      return leave(r, b, opt.label, `${b.of} ${yes ? '' : "doesn't "}${b.test === 'matches' ? 'match' : b.test === 'equals' ? 'equal' : 'contain'}${yes ? (b.test === 'matches' ? 'es' : 's') : ''} "${want}"`)
    }
    case 'case': {
      // the first branch that holds, else the last (check: else is there, last)
      for (const o of b.options ?? []) {
        const br = branchOf(o.label)
        if (!br) throw new Error(`“${o.label}” isn't a branch`)
        if (br === 'else') return leave(r, b, o.label, 'nothing above matched: else')
        if (br.test === 'js') {
          if (js(br.value, vars)) return leave(r, b, o.label, `js: ${clip(br.value, 60)}`)
          continue
        }
        const of = br.of ?? b.of ?? ''
        const v = valueOf(r, vars, of)
        if (holds(v, br.test, br.value)) return leave(r, b, o.label, `${of} ${br.test === 'matches' ? 'matches' : br.test} ${NUM_TESTS.includes(br.test) ? br.value : `"${br.value}"`} (${clip(v.replace(/\s+/g, ' ').trim() || 'empty', 60)})`)
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
    case 'extension':
      return extension(r, b)
    case 'popup': {
      // a window in Laki, read and closed: the run goes on
      const title = fill(b.title ?? '', vars).trim() || blockName(b)
      const body = fill(b.text ?? '', vars).slice(0, SHOWN_MAX)
      r.shown = [...(r.shown ?? []), { at: Date.now(), block: b.id, title, body }].slice(-20)
      say(r, `${blockName(b)}: shows you “${clip(title, 80)}”`, body)
      broadcast({ ev: 'flow', id: r.id, ws: r.ws, kind: 'show', name: r.flow.name, text: title, body, notify: !!b.notify })
      if (b.notify && b.phone) flowPhone(r.flow.name, wsOf(r)?.name, 'shows you', title)
      return leave(r, b, 'next', `showed you “${clip(title, 60)}”`)
    }
  }
}

// an extension: fetched now, waited for, then its data as steps.<id>.data and each field of it as steps.<id>.<field>
async function extension(r: FlowRun, b: Block) {
  const id = b.extension?.trim() ?? ''
  const got = await widgetUse({ id, ws: r.ws }, 'workflow', `${r.flow.name} · ${blockName(b)}`).catch(e => ({ ok: false, error: (e as Error).message, name: id, data: undefined }))
  if (!live(r) || r.cur !== b.id) return // stopped meanwhile
  for (const k of Object.keys(r.vars)) if (k.startsWith(`steps.${b.id}.`)) delete r.vars[k] // a loop's earlier fetch: none of its fields stay, an error's way neither
  if (!got.ok) return leave(r, b, 'error', got.error ?? `${got.name} failed`)
  const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v) ?? '').slice(0, ANSWER_MAX)
  r.vars[`steps.${b.id}.data`] = text(got.data)
  if (got.data && typeof got.data === 'object' && !Array.isArray(got.data)) for (const [k, v] of Object.entries(got.data)) if (/^[\w-]{1,40}$/.test(k) && k !== 'data') r.vars[`steps.${b.id}.${k}`] = text(v)
  say(r, `${blockName(b)}: fetched ${got.name}`, r.vars[`steps.${b.id}.data`])
  leave(r, b, 'ok', `fetched ${got.name}`)
}

// what a choice or a case tests: a variable, else a block's answer, else its output (none: empty)
const valueOf = (r: FlowRun, vars: Record<string, string>, of = '') => r.vars[of] ?? vars[of] ?? r.vars[`steps.${of}.answer`] ?? r.vars[`steps.${of}.output`] ?? ''

// a case's js: branch: a JS expression over the run's variables (vars, num(name): NaN when it's empty, json(name)), 200
// ms at most; one that throws stops the run on that block (Try again or Stop), saying why. ponytail: node:vm is no sandbox, but it runs what a run: block could
// (an agent's workflow runs only after you save it)
function js(expr: string, vars: Record<string, string>) {
  const v = Object.freeze({ ...vars })
  const json = (k: string) => {
    try {
      return JSON.parse(v[k] ?? '')
    } catch {
      return undefined
    }
  }
  try {
    return !!runInNewContext(`(${expr})`, { vars: v, num: (k: string) => (v[k]?.trim() ? Number(v[k]) : NaN), json }, { timeout: 200 })
  } catch (e) {
    throw new Error(`js: ${clip(expr, 60)}: ${(e as Error).message}`)
  }
}

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
  const prompt = [...[action && stamp(action.text, Date.now()), b.text].filter(t => t?.trim()).map(t => fill(t!, vars)), b.out?.length ? outAsk(b.out) : b.json && jsonAsk].filter(Boolean).join('\n\n')
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
    // JSON mode: its answer is the JSON it ended with (none: its words, and said)
    const j = b.json ? lastJson(String(o.last ?? '')) : undefined
    if (b.json && j === undefined && o.last && !o.failed) say(r, `${blockName(b)}: no JSON in its answer (its words kept)`)
    r.vars[`steps.${b.id}.answer`] = j !== undefined ? JSON.stringify(j).slice(0, ANSWER_MAX) : String(o.last ?? '').slice(-ANSWER_MAX) // JSON: its start, as out:'s
    if (b.out?.length) outs(r, b, String(o.last ?? ''))
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
    if (b.out?.length) outs(r, b, lines.join('\n'))
    if (lines.join('').trim()) say(r, `${blockName(b)}: its output`, lines.slice(-OUTPUT_LINES).join('\n'))
    leave(r, b, code === 0 ? 'ok' : 'fail', late ? `stopped after ${min} min` : signal ? `killed (${signal})` : `exit ${code}${code ? `: ${clip(lines.at(-1) ?? '', 80)}` : ''}`)
  })
  r.wait = { kind: 'run' }
  say(r, `${blockName(b)}: ${clip(cmd, 120)}`)
  touch()
}
const kill = killGroup // its group: npm and what it started

// out: its names' values as {{steps.<id>.<name>}}, from its result (an answer's JSON, a command's, a response's)
function outs(r: FlowRun, b: Block, text: string) {
  const { vars, missing } = outsOf(text, b.out!)
  for (const [k, v] of Object.entries(vars)) r.vars[`steps.${b.id}.${k}`] = v.slice(0, ANSWER_MAX) // its start: a list's JSON stays whole up to there
  if (missing.length) say(r, `${blockName(b)}: no ${missing.join(', ')} in what it gave (empty)`)
}

// ---------- AI call, AI decision and webhook blocks: one request each (a webhook's tried again on a 429 or a 5xx),
// stopped with the run (kill0). The same requests go alone as the inspector's Test (flowTest). Each kind's *Send checks
// the block first (what's wrong throws: the run asks you), then gives what sends it

// what a request gave: its exit and why, the variables it sets, the text out: reads, what a decision isn't sure of
type Got = { exit: string; why: string; vars: Record<string, string>; text?: string; unsure?: string[] }
type Send = (signal: AbortSignal, say: (line: string, detail?: string) => void) => Promise<Got>

// a request under way for this run: its signal (the block's timeout, or a stop), and whether it still counts
function request(r: FlowRun, b: Block) {
  kill0(r)
  const ctl = new AbortController()
  calls.set(r.id, ctl)
  const min = b.timeout ?? CALL_TIMEOUT
  r.wait = { kind: 'run' }
  touch()
  return { signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(min * 60000)]), mine: () => calls.get(r.id) === ctl && (calls.delete(r.id), true), min }
}
const why = (e: unknown, min: number) => ((e as Error).name === 'TimeoutError' ? `nothing after ${min} min` : (e as Error).message)

async function sent(r: FlowRun, b: Block, send: Send) {
  const q = request(r, b)
  try {
    const got = await send(q.signal, (line, detail) => say(r, line, detail))
    if (!q.mine()) return
    Object.assign(r.vars, got.vars)
    if (b.out?.length && got.text !== undefined) outs(r, b, got.text)
    if (got.unsure?.length) return unsure(r, b, got.unsure)
    leave(r, b, got.exit, got.why)
  } catch (e) {
    if (q.mine()) leave(r, b, 'error', why(e, q.min))
  }
}

// an AI call: the prompt (and out:'s ask) to OpenRouter, its answer as {{steps.<id>.answer}}
function llmSend(b: Block, vars: Record<string, string>, ask: string): Send {
  const prompt = [fill(b.text ?? '', vars), b.out?.length && outAsk(b.out)].filter(Boolean).join('\n\n')
  return async (signal, say) => {
    say(`${blockName(b)}: asks ${b.model || 'Settings › AI’s model'}`, prompt)
    const a = await aiComplete({ model: b.model, prompt, system: b.system && fill(b.system, vars), temperature: b.temperature, json: b.json ?? !!b.out?.length, signal, ask })
    say(`${a.model} answered${a.cost ? ` ($${a.cost.toFixed(4)})` : ''}`, a.text)
    return { exit: 'ok', why: `${a.model}: “${clip(a.text, 80)}”`, vars: { [`steps.${b.id}.answer`]: a.text.slice(-ANSWER_MAX) }, text: a.text }
  }
}

// an AI decision: the state (its template filled, JSON's values escaped; else what the block before gave) and the
// questions to the Decisions API. Each answer is steps.<id>.<name> (yes/no, the option, the level's number) with .p,
// .confidence and .score; one under sure is left to you (unsure)
function decideSend(b: Block, vars: Record<string, string>, before: string, ask: string): Send {
  const text = b.text?.trim() ? jsonFill(b.text, vars) : before
  let st: unknown = text
  let words = false // a template that isn't JSON once filled (an unknown {{var}}): sent as words, and said
  try {
    st = JSON.parse(text)
  } catch {
    words = /^\s*[[{]/.test(text)
  }
  const model = b.model || DECIDE_MODELS[0].id
  const qs = b.qs ?? []
  const sure = b.sure ?? SURE
  return async (signal, say) => {
    say(`${blockName(b)}: asks ${model} ${qs.map(q => q.name).join(', ')}${words ? ' (its state isn’t JSON: sent as words)' : ''}`, clip(text, LOG_DETAIL))
    const a = await aiDecide({ model, state: st, questions: apiQuestions(qs), signal, ask })
    const got: Record<string, string> = { [`steps.${b.id}.answers`]: JSON.stringify(a.answers) }
    const unsure: string[] = []
    const said: string[] = []
    for (const q of qs) {
      const x = a.answers[q.name]
      if (!x) throw new Error(`${a.model} gave no answer to ${q.name}`)
      const k = `steps.${b.id}.${q.name}`
      const pct = (n: number) => `${Math.round(n * 100)}%`
      if (q.type === 'yes/no') {
        const p = Number(x.noul)
        got[k] = p >= sure ? 'yes' : p <= 1 - sure ? 'no' : ''
        got[`${k}.p`] = String(p)
        said.push(`${q.name}: ${got[k] || '?'} (yes ${pct(p)})`)
      } else {
        const conf = Number(x.confidence ?? 1)
        const level = q.type === 'score' ? Math.round(Number(x.score)) : -1
        const bad = q.type === 'score' ? !q.opts[level] : !q.opts.some(o => o.label === x.choice) // not one it could be: yours
        got[k] = q.type === 'choice' ? String(x.choice ?? '') : String(level)
        got[`${k}.confidence`] = String(conf)
        got[`${k}.p`] = String(x.probabilities?.[got[k]] ?? conf)
        if (q.type === 'score') (got[`${k}.score`] = String(x.score)), (got[`${k}.level`] = q.opts[level]?.text ?? '')
        if (conf < sure || bad) got[k] = ''
        said.push(`${q.name}: ${got[k] === '' ? '?' : q.type === 'score' ? `${got[`${k}.score`]} (${q.opts[level]?.text ?? level})` : got[k]}, ${pct(conf)} sure`)
      }
      if (got[k] === '') unsure.push(q.name)
    }
    say(`${a.model} decided${a.cost ? ` ($${a.cost.toFixed(5)})` : ''}`, said.join('\n'))
    // routed: the way its question's answer names (one it isn't sure of: yours, once you settle it)
    return { exit: b.route ? got[`steps.${b.id}.${b.route}`] || 'ok' : 'ok', why: said.join(' · '), vars: got, unsure }
  }
}
// a decision's way out: its route question's answer (yes, an option, a level's number), else ok
const routeOf = (r: FlowRun, b: Block) => (b.route ? r.vars[`steps.${b.id}.${b.route}`] || 'ok' : 'ok')
// what a decision isn't sure of, one question at a time: the options are the answers it could be, yours is kept
function unsure(r: FlowRun, b: Block, names: string[]) {
  const [key, ...rest] = names
  const q = b.qs?.find(x => x.name === key)
  if (!q) return leave(r, b, routeOf(r, b), 'decided')
  let a: any = {}
  try {
    a = JSON.parse(r.vars[`steps.${b.id}.answers`] ?? '{}')[key] ?? {}
  } catch {}
  const options = q.type === 'yes/no' ? ['yes', 'no'] : q.type === 'choice' ? q.opts.map(o => o.label) : q.opts.map((o, i) => `${i}: ${clip(o.text, 40)}`)
  const odds = q.type === 'yes/no' ? `yes ${Math.round(Number(a.noul) * 100)}%` : Object.entries(a.probabilities ?? {}).map(([k, p]) => `${q.type === 'score' ? (q.opts[Number(k)]?.text ?? k) : k} ${Math.round(Number(p) * 100)}%`).join(', ')
  Object.assign(r, { status: 'waiting' as FlowStatus, wait: { kind: 'decide', question: `${blockName(b)}: ${q.ask}`, show: `The model isn't sure${odds ? `: ${odds}` : ''}. Your answer is ${q.name}'s.`, options, key, rest } })
  say(r, `asks you: ${q.ask}`, odds)
  touch()
  broadcast({ ev: 'flow', id: r.id, ws: r.ws, kind: 'waiting', name: r.flow.name, text: q.ask })
}

// a webhook: its URL, headers and body filled ({{env.NAME}} too: Settings' and the project's env, never kept in the
// run), a JSON body's values escaped; or a file of the workspace (root); or the run's variables as JSON. dry: what a
// dry run says instead
const TYPES: Record<string, string> = { json: 'application/json', html: 'text/html', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' }
const TRIES = 3 // a webhook's: again after a 429 or a 5xx, or no answer at all
function hookSend(b: Block, vars: Record<string, string>, envs: Record<string, string>, root: string | undefined, all: Record<string, string>): Send & { dry: string } {
  const env = Object.fromEntries(Object.entries(envs).map(([k, v]) => [`env.${k}`, String(v)]))
  const masked = Object.fromEntries(Object.keys(env).map(k => [k, '••••']))
  // a value after the ? is encoded (an answer's & or # stays in its parameter); before it, as it is (a URL a step gave)
  const tpl = b.url ?? ''
  const q0 = tpl.indexOf('?')
  const enc = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, encodeURIComponent(v)]))
  const urlOf = (e: Record<string, string>) => (q0 < 0 ? fill(tpl, { ...vars, ...e }) : `${fill(tpl.slice(0, q0), { ...vars, ...e })}?${fill(tpl.slice(q0 + 1), { ...enc, ...e })}`).trim()
  const url = urlOf(env)
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`${b.url}: not an http(s) URL`)
  const method = b.method ?? 'POST'
  const headers: Record<string, string> = {}
  for (const h of b.headers ?? []) {
    const i = h.indexOf(':')
    headers[h.slice(0, i).trim().toLowerCase()] = fill(h.slice(i + 1).trim(), { ...vars, ...env })
  }
  let body: string | Blob | undefined
  let shown: string | undefined // the body as the log has it: never a secret
  let type = 'application/json'
  if (method !== 'GET') {
    if (b.from) {
      if (!root) throw new Error('a file body needs a workspace')
      const top = realpathSync(root)
      const src = resolve(root, fill(b.from, vars).trim())
      if (!existsSync(src) || !within(top, realpathSync(src)) || !statSync(src).isFile()) throw new Error(`${b.from}: no such file in the workspace`)
      if (statSync(src).size > BODY_MAX) throw new Error(`${b.from}: over 10 MB`)
      body = new Blob([readFileSync(src)])
      type = TYPES[src.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'
    } else if (b.text?.trim()) {
      body = jsonFill(b.text, { ...vars, ...env })
      shown = jsonFill(b.text, { ...vars, ...masked })
      type = /^\s*[[{]/.test(b.text) ? 'application/json' : 'text/plain; charset=utf-8'
    } else body = shown = JSON.stringify(all)
    headers['content-type'] ??= type
  }
  const send: Send = async (signal, say) => {
    say(`${blockName(b)}: ${method} ${urlOf(masked).replace(/\?.*$/, '?…')}`, body instanceof Blob ? `(${b.from}, ${body.size} bytes)` : shown)
    for (let n = 1; ; n++) {
      let res: Response | undefined
      try {
        res = await fetch(url, { method, headers, body, signal, redirect: 'follow' })
      } catch (e) {
        if (signal.aborted || n >= TRIES) throw e
      }
      if (res && (n >= TRIES || (res.status !== 429 && res.status < 500))) {
        const text = (await res.text()).slice(0, ANSWER_MAX)
        if (text.trim()) say(`${blockName(b)}: ${res.status}`, text)
        return { exit: res.ok ? 'ok' : 'error', why: `${res.status} ${res.statusText}`.trim(), vars: { [`steps.${b.id}.status`]: String(res.status), [`steps.${b.id}.output`]: text }, text }
      }
      // Retry-After's seconds (30 at most), else 2 s, then 6 s
      const after = Math.min(30, Number(res?.headers.get('retry-after')) || 2 * 3 ** (n - 1))
      await res?.body?.cancel().catch(() => {}) // its socket back
      say(`${blockName(b)}: ${res ? res.status : 'no answer'}, again in ${after} s`)
      await new Promise<void>((ok, fail) => {
        const stop = () => (clearTimeout(t), fail(signal.reason))
        const t = setTimeout(() => (signal.removeEventListener('abort', stop), ok()), after * 1000)
        signal.addEventListener('abort', stop, { once: true })
      })
    }
  }
  return Object.assign(send, { dry: `dry run: would ${method} ${new URL(url).origin}` })
}
const envOf = (ws?: Workspace) => ({ ...state.settings?.env, ...(ws && projectConfig(ws).env) }) as Record<string, string>
// a run's variables as a webhook's default body: the task and what the blocks gave
const runBody = (r: FlowRun) => ({ task: r.task, ...Object.fromEntries(Object.entries(r.vars).filter(([k]) => k.startsWith('steps.'))) })
// what the block before gave: its answer, else its output (an AI decision's default state)
const before = (r: FlowRun, vars: Record<string, string>) => (id => (id ? valueOf(r, vars, id) : '') || r.task)(r.decisions.at(-1)?.block)

// the inspector's Test: an AI call, an AI decision or a webhook sent once, alone, with the variables given (a project's
// env and folder, when it names one); what it says and gives back, never a run
export async function flowTest(o: { block: Block; vars?: Record<string, string>; project?: string; own?: Record<string, string> }) { // own: the workflow's variables
  on()
  const b = o.block
  if (!b || !['llm', 'decide', 'webhook'].includes(b.kind)) throw new Error('Test sends an AI call, an AI decision or a webhook')
  const proj = o.project ? findProject(o.project) : undefined
  const vars: Record<string, string> = { task: 'a test task', ...varsFill(o.own, state.settings?.flowVars), ...Object.fromEntries(Object.entries(o.vars ?? {}).map(([k, v]) => [k, String(v)])) }
  const ask = `Test · ${blockName(b)}`
  const log: string[] = []
  const t0 = Date.now()
  try {
    const send = b.kind === 'llm' ? llmSend(b, vars, ask) : b.kind === 'decide' ? decideSend(b, vars, vars.task, ask) : hookSend(b, vars, envOf(proj && ({ project: proj.id, path: proj.path } as Workspace)), proj?.path, { task: vars.task })
    const got = await send(AbortSignal.timeout((b.timeout ?? CALL_TIMEOUT) * 60000), (line, detail) => log.push(detail ? `${line}\n${detail}` : line))
    const o2 = b.out?.length && got.text !== undefined ? outsOf(got.text, b.out) : undefined
    const outVars = Object.fromEntries(Object.entries(o2?.vars ?? {}).map(([k, v]) => [`steps.${b.id}.${k}`, v]))
    return { exit: got.exit, why: got.why, vars: { ...got.vars, ...outVars }, missing: o2?.missing ?? [], unsure: got.unsure ?? [], log, ms: Date.now() - t0 }
  } catch (e) {
    return { exit: 'error', why: (e as Error).name === 'TimeoutError' ? 'no answer in time' : (e as Error).message, vars: {}, missing: [], unsure: [], log, ms: Date.now() - t0 }
  }
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
  if (w.kind === 'decide') {
    // yours is the answer (a score's: its level's number), then the next it isn't sure of
    const k = `steps.${b.id}.${w.key}`
    r.vars[k] = /^\d+: /.test(label) ? label.slice(0, label.indexOf(':')) : label
    r.vars[`${k}.you`] = 'yes'
    const q = b.qs?.find(x => x.name === w.key)
    if (q?.type === 'score') (r.vars[`${k}.score`] = r.vars[k]), (r.vars[`${k}.level`] = q.opts[Number(r.vars[k])]?.text ?? '')
    say(r, `${blockName(b)}: ${w.key} is ${label}, you said`)
    if (w.rest.length) return unsure(r, b, w.rest), r
    return leave(r, b, routeOf(r, b), `you settled ${w.key}: ${label}`, true), r
  }
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
  calls.get(r.id)?.abort()
  calls.delete(r.id)
}

function finish(r: FlowRun, status: FlowStatus, why: string, notify?: boolean, phone?: boolean) {
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
  if (phone) flowPhone(r.flow.name, wsOf(r)?.name, status === 'done' ? 'is done' : status, why)
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
    else if (r.wait?.kind === 'retry' && now >= r.wait.until) again(r, b)
    else if (r.wait?.kind === 'agent' && !alive(r.wait.tab)) leave(r, b, 'error', `${tabOf(r.wait.tab)?.name ?? 'its tab'} stopped`)
  }
}

// at the daemon's start: each run back at its block. An agent's turn was cut short, so it's asked again (its tab
// resumes its chat first); a command runs again; asks wait on
// ponytail: the prompt goes again whole; the agent may redo work it had done
let resumeLater = false
const boot = Date.now() // runs started since were never cut short
export function flowResume() {
  resumeLater = state.settings?.workflows !== true
  if (resumeLater) return // off: they wait until it's on again
  const back = runs().filter(r => live(r) && r.status !== 'waiting' && r.started < boot)
  const was = new Map(back.map(r => [r, r.cur]))
  for (const r of back) say(r, `Laki restarted: back at ${blockName(blockOf(r, r.cur) ?? ({ id: '?' } as Block))}`)
  if (!back.length) return
  save()
  setTimeout(() => {
    for (const r of back) {
      const b = blockOf(r, r.cur)
      if (!live(r) || !b || r.status === 'waiting' || r.cur !== was.get(r)) continue // moved on meanwhile: that block is under way
      if (r.wait?.kind === 'wait' || r.wait?.kind === 'retry') continue // flowTick
      enter(r, b, true)
    }
  }, RESUME_AFTER).unref()
}

export const flowStopAll = () => [...new Set([...procs.keys(), ...calls.keys()])].forEach(id => kill0({ id } as FlowRun)) // shutdown

// a scheduled task's workflow (core.ts' runSchedule): its run, through this file
flowHooks.start = o => flowStart(o)
flowHooks.find = o => flowFind(o)
