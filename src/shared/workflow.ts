// Workflows (experimental, settings.workflows): a graph of blocks Laki runs for a task. Agents think inside their
// blocks; the daemon (daemon/workflow.ts) walks the graph, keeps each run's decisions, state and log, and resumes it
// after a restart. One Markdown file per workflow, none to start with: yours (<data>/workflows/<id>.md) or a project's
// (.laki/workflows/<id>.md in its repo). This file is the format both sides share: parse, toFile, check.

export const BLOCKS = ['start', 'agent', 'run', 'choice', 'case', 'ask', 'action', 'wait', 'save', 'end'] as const
export type BlockKind = (typeof BLOCKS)[number]
// each kind's exits; choice, case and ask have options instead (each its own exit)
export const EXITS: Record<BlockKind, string[]> = { start: ['next'], agent: ['next', 'error'], run: ['ok', 'fail'], choice: [], case: [], ask: [], action: ['ok', 'error'], wait: ['pass', 'fail'], save: ['ok'], end: [] }
export const BAD_EXITS = ['fail', 'error']
export const optioned = (k: BlockKind) => k === 'choice' || k === 'case' || k === 'ask'
export const BLOCK_NAMES: Record<BlockKind, string> = { start: 'Start', agent: 'Agent', run: 'Run command', choice: 'If / else', case: 'Case', ask: 'Ask you', action: 'Laki action', wait: 'Wait', save: 'Save', end: 'End' }
export const ACTIONS: Record<string, string> = { ship: 'Open a PR (commit, push, gh pr create)', approve: 'Approve its PR', merge: 'Merge its PR', dev: 'Run the dev server', archive: 'Archive the workspace' }
export const OUTWARD = ['ship', 'approve', 'merge', 'archive'] // what others see: asks first unless the block says ask first: no
export const WAITS: Record<string, string> = { checks: 'Its PR’s checks pass or fail' }
export const TESTS = ['contains', 'matches', 'equals'] as const
export const WHERES: Record<string, string> = { worktree: 'A new worktree per run', main: "The project's folder (its own workspace)" }
export const SESSIONS: Record<string, string> = { new: 'A new AI session per run', shared: 'One AI session for every run (claude: each run forks the last)' }
export const RESULTS = ['success', 'stopped', 'failed'] as const
export const RUNS_AT_ONCE = 3 // a workflow's runs going at the same time (its at once:)
export const TURNS = 30 // agent turns in one run before it asks you (its turns:)
export const MAX_BLOCKS = 100 // a workflow's blocks: past it, it won't run (and + Block stops)

export type Option = { label: string; to?: string }
export type Block = {
  id: string
  kind: BlockKind
  name?: string
  at?: [number, number] // where the canvas draws it
  to?: Record<string, string> // exit → block id
  options?: Option[] // choice (yes, no), ask (buttons), case (its branches: a test each, else last)
  max?: { n: number; to?: string } // at most n times, then to
  text?: string // agent: the prompt (after its action's, with use); action ship: the commit message; save: what's written
  input?: 'task' // start
  agent?: string // a preset's name (claude, codex, one of Settings')
  use?: string // agent: an agent action's slug, or its name (Run ▾'s, Settings' or the project's: findAction): its prompt first
  model?: string
  effort?: string
  session?: string // agent: run (the run's agent tab, the default), new, or a block's id (its tab)
  cmd?: string // run
  timeout?: number // run, wait: minutes
  question?: string // ask
  show?: string // ask: what goes with the question ({{vars}})
  of?: string // choice, case: a variable (steps.review.answer) or a block's id (its answer or output); a case's branch may name its own
  test?: (typeof TESTS)[number]
  value?: string
  action?: string
  confirm?: boolean // an outward action: false skips the ask (unset: asks)
  for?: string // wait
  file?: string // save: a path in the workspace's storage folder
  from?: string // save: a file or folder of the workspace, copied there (instead of text)
  link?: string // save: a link, kept as <file>.url (the workspace's Artifacts list links first)
  result?: (typeof RESULTS)[number] // end
  notify?: boolean
}
export type Workflow = { id: string; name: string; desc?: string; where: 'worktree' | 'main'; session: 'new' | 'shared'; runs?: number; turns?: number; blocks: Block[] }
export type WorkflowSource = 'yours' | 'project'
export type WorkflowItem = Workflow & { source: WorkflowSource; project?: string; path?: string; problems: string[]; text: string; byAgent?: boolean } // the list's; byAgent: an agent wrote it (MCP), not saved by the user since

export const ID = /^[a-z0-9][a-z0-9_?-]{0,40}$/i
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const blockName = (b: Block) => b.name || (b.kind === 'start' ? 'Start' : b.id)

// a block's exits, each with where it goes: a choice's or ask's options, then its max's
export function exitsOf(b: Block): { name: string; to?: string; bad?: boolean; max?: boolean }[] {
  const l: { name: string; to?: string; bad?: boolean; max?: boolean }[] = optioned(b.kind) ? (b.options ?? []).map(o => ({ name: o.label, to: o.to })) : EXITS[b.kind].map(e => ({ name: e, to: b.to?.[e], bad: BAD_EXITS.includes(e) }))
  if (b.max) l.push({ name: `after ${b.max.n}`, to: b.max.to, bad: true, max: true })
  return l
}

// ---------- the file
//   # Name
//   What it does.
//
//   runs in: worktree · session: new · at once: 3 · turns: 30
//
//   ## plan
//   name: Plan
//   agent: claude · model: opus · effort: high · session: run
//   > Make a plan for: {{task}}
//   next: approve
//
//   ## approve
//   ask: Build this plan?
//   show: {{steps.plan.answer}}
//   - Build it → build
//   - Change it → plan
// A block's kind is its first kind key (input for start, agent, run, choice, ask, action, wait, save, end); its exits
// are lines named after them (next:, ok:, fail:…), a choice's and an ask's options are - label → block; > lines are its
// text; max: 3 → stuck limits it; at: x,y is where the canvas draws it.

const WHOLE = new Set(['name', 'ask', 'show', 'run', 'choice', 'if', 'case', 'from', 'link']) // the rest of the line is the value: no · split
const KIND_KEY: Record<string, BlockKind> = { input: 'start', agent: 'agent', run: 'run', choice: 'choice', if: 'choice', case: 'case', ask: 'ask', action: 'action', wait: 'wait', save: 'save', end: 'end' }

export function parse(text: string, id = ''): { workflow: Workflow; problems: string[] } {
  const problems: string[] = []
  const wf: Workflow = { id, name: id || 'Workflow', where: 'worktree', session: 'new', blocks: [] }
  let b: Block | null = null
  const desc: string[] = []
  let head = true // before the first block
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const at = `line ${i + 1}`
    if (!line.trim()) return
    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1 && head) return void (wf.name = h1[1].trim())
    const h2 = /^##\s+(\S+)\s*$/.exec(line)
    if (h2) {
      head = false
      if (!ID.test(h2[1])) problems.push(`${at}: ${h2[1]} isn't a block id (letters, digits, - _ ?)`)
      if (wf.blocks.some(x => x.id === h2[1])) problems.push(`${at}: two blocks are called ${h2[1]}`)
      wf.blocks.push((b = { id: h2[1], kind: h2[1] === 'start' ? 'start' : ('' as BlockKind) }))
      return
    }
    if (head) {
      const kv = pairs(line)
      if (kv.length && kv.every(([k]) => ['runs in', 'session', 'at once', 'turns'].includes(k))) {
        for (const [k, v] of kv) {
          if (k === 'runs in') v in WHERES ? (wf.where = v as Workflow['where']) : problems.push(`${at}: runs in: ${Object.keys(WHERES).join(' or ')}`)
          else if (k === 'session') v in SESSIONS ? (wf.session = v as Workflow['session']) : problems.push(`${at}: session: new or shared`)
          else if (k === 'at once') wf.runs = num(v, at, problems)
          else wf.turns = num(v, at, problems)
        }
      } else desc.push(line.trim())
      return
    }
    if (!b) return
    if (line.startsWith('>')) return void (b.text = b.text === undefined ? line.replace(/^> ?/, '') : `${b.text}\n${line.replace(/^> ?/, '')}`)
    const opt = /^-\s+(.+?)\s*(?:→|->)\s*(\S*)\s*$/.exec(line)
    if (opt) return void (b.options ??= []).push({ label: opt[1], ...(opt[2] && opt[2] !== '?' && { to: opt[2] }) })
    const kv = /^([a-z][a-z ]*?):\s?(.*)$/i.exec(line)
    if (!kv) return void problems.push(`${at}: ${clip(line.trim(), 40)}? (key: value, > text or - option → block)`)
    const key = kv[1].toLowerCase()
    for (const [k, v] of WHOLE.has(key) ? [[key, kv[2].trim()] as [string, string]] : pairs(line)) set(b, k, v, at, problems)
  })
  wf.desc = desc.join(' ') || undefined
  for (const x of wf.blocks) if (!x.kind) problems.push(`${x.id}: what kind of block? (agent:, run:, ask:, choice:, action:, wait:, save:, end:)`)
  return { workflow: wf, problems }
}

// key: value · key: value (a value may hold colons: only " · " splits)
function pairs(line: string): [string, string][] {
  const out: [string, string][] = []
  for (const part of line.split(/\s+·\s+/)) {
    const m = /^([a-z][a-z ]*?):\s?(.*)$/i.exec(part.trim())
    if (!m) return []
    out.push([m[1].toLowerCase(), m[2].trim()])
  }
  return out
}
function num(v: string, at: string, problems: string[]) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 99) return void problems.push(`${at}: ${v}? a number from 1 to 99`)
  return n
}

function set(b: Block, k: string, v: string, at: string, problems: string[]) {
  const kind = KIND_KEY[k]
  if (kind && (!b.kind || (b.kind === 'start' && kind === 'start'))) b.kind = kind
  const exits = b.kind ? EXITS[b.kind] : []
  const yes = (v: string) => !/^(no|false|off)$/i.test(v)
  const to = (v: string) => (v && v !== '?' ? v : undefined)
  if (exits.includes(k)) return void (to(v) ? ((b.to ??= {})[k] = v) : undefined)
  switch (k) {
    case 'name': return void (b.name = v || undefined)
    case 'at': {
      const m = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(v)
      return void (m ? (b.at = [Number(m[1]), Number(m[2])]) : problems.push(`${at}: at: x,y`))
    }
    case 'max': {
      const m = /^(\d+)\s*(?:(?:→|->)\s*(\S+))?$/.exec(v)
      return void (m && Number(m[1]) >= 1 ? (b.max = { n: Number(m[1]), ...(to(m[2] ?? '') && { to: m[2] }) }) : problems.push(`${at}: max: 3 → block`))
    }
    case 'input': return void (b.input = 'task')
    case 'agent': return void (b.agent = v || 'claude')
    case 'use': return void (b.use = v || undefined)
    case 'model': return void (b.model = v || undefined)
    case 'effort': return void (b.effort = v || undefined)
    case 'session': return void (b.session = v || undefined)
    case 'run': return void (b.cmd = v)
    case 'timeout': return void (b.timeout = num(v.replace(/\s*min(utes)?$/, ''), at, problems))
    case 'ask': return void (b.question = v)
    case 'show': return void (b.show = v || undefined)
    case 'if':
    case 'choice': {
      // choice: steps.review.answer contains "LGTM" (if: is the same)
      const m = /^(\S+)\s+(contains|matches|equals)\s+"(.*)"$/.exec(v)
      if (!m) return void problems.push(`${at}: ${k}: <variable> contains|matches|equals "text"`)
      return void Object.assign(b, { of: m[1], test: m[2], value: m[3] })
    }
    case 'case': return void (b.of = v || undefined) // its branches' variable, unless a branch names its own
    case 'action':
      if (!(v in ACTIONS)) problems.push(`${at}: action: ${Object.keys(ACTIONS).join(', ')}`)
      return void (b.action = v)
    case 'ask first': return void (b.confirm = yes(v))
    case 'wait':
      if (!(v in WAITS)) problems.push(`${at}: wait: ${Object.keys(WAITS).join(', ')}`)
      return void (b.for = v)
    case 'save': return void (b.file = v)
    case 'from': return void (b.from = v || undefined)
    case 'link': return void (b.link = v || undefined)
    case 'end':
      if (!(RESULTS as readonly string[]).includes(v)) problems.push(`${at}: end: ${RESULTS.join(', ')}`)
      return void (b.result = v as Block['result'])
    case 'notify': return void (b.notify = yes(v))
  }
  problems.push(`${at}: ${k}? not a key ${b.kind ? `of a ${b.kind} block` : 'here'}`)
}

const one = (s = '') => s.replace(/\s*\n\s*/g, ' ') // a field on one line: a newline would start another
export function toFile(wf: Workflow): string {
  const L = [`# ${one(wf.name)}`]
  if (wf.desc) L.push(one(wf.desc))
  L.push('', [`runs in: ${wf.where}`, `session: ${wf.session}`, wf.runs && `at once: ${wf.runs}`, wf.turns && `turns: ${wf.turns}`].filter(Boolean).join(' · '))
  for (const b of wf.blocks) {
    L.push('', `## ${b.id}`)
    if (b.name && b.name !== b.id) L.push(`name: ${one(b.name)}`)
    switch (b.kind) {
      case 'start': L.push(`input: ${b.input ?? 'task'}`); break
      case 'agent': L.push([`agent: ${b.agent || 'claude'}`, b.model && `model: ${b.model}`, b.effort && `effort: ${b.effort}`, b.session && b.session !== 'run' && `session: ${b.session}`, b.use && `use: ${one(b.use)}`].filter(Boolean).join(' · ')); break
      case 'run': L.push(`run: ${one(b.cmd)}`); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'ask': L.push(`ask: ${one(b.question)}`); if (b.show) L.push(`show: ${one(b.show)}`); break
      case 'choice': L.push(`choice: ${b.of || 'answer'} ${b.test || 'contains'} "${one(b.value)}"`); break
      case 'case': L.push(`case: ${b.of ?? ''}`.trimEnd()); break
      case 'action': L.push([`action: ${b.action || 'ship'}`, b.confirm === false && 'ask first: no'].filter(Boolean).join(' · ')); break
      case 'wait': L.push(`wait: ${b.for || 'checks'}`); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'save': L.push(`save: ${one(b.file)}`); if (b.from) L.push(`from: ${one(b.from)}`); if (b.link) L.push(`link: ${one(b.link)}`); break
      case 'end': L.push([`end: ${b.result || 'success'}`, b.notify && 'notify: yes'].filter(Boolean).join(' · ')); break
    }
    if (b.text !== undefined && b.text !== '') for (const l of b.text.split('\n')) L.push(l ? `> ${l}` : '>')
    if (optioned(b.kind)) for (const o of b.options ?? []) L.push(`- ${one(o.label)} → ${o.to || '?'}`)
    else for (const e of EXITS[b.kind]) if (b.to?.[e]) L.push(`${e}: ${b.to[e]}`)
    if (b.max) L.push(`max: ${b.max.n}${b.max.to ? ` → ${b.max.to}` : ''}`)
    if (b.at) L.push(`at: ${Math.round(b.at[0])},${Math.round(b.at[1])}`)
  }
  return L.join('\n') + '\n'
}

// what keeps it from running: no start, a block nothing leads to, one with no way out, an exit to no block, a loop
// with no limit (a max on one of its blocks, or an Ask you in it)
export function check(wf: Workflow): string[] {
  const out: string[] = []
  const by = new Map(wf.blocks.map(b => [b.id, b]))
  const start = wf.blocks.find(b => b.kind === 'start')
  if (!start) return ['no start block (## start)']
  if (wf.blocks.filter(b => b.kind === 'start').length > 1) out.push('more than one start block')
  if (wf.blocks.length > MAX_BLOCKS) return [...out, `${wf.blocks.length} blocks: ${MAX_BLOCKS} at most`] // the walks below recurse: not over thousands
  for (const b of wf.blocks) {
    for (const e of exitsOf(b)) if (e.to && !by.has(e.to)) out.push(`${blockName(b)}: ${e.name} goes to ${e.to}, which isn't a block`)
    if (b.kind !== 'end' && !exitsOf(b).some(e => e.to)) out.push(`${blockName(b)} has no way out`)
    if (optioned(b.kind) && (b.options?.length ?? 0) < 2) out.push(`${blockName(b)} needs two options at least`)
    if (b.kind === 'case') out.push(...caseProblems(b))
    if (b.kind === 'agent' && !b.text?.trim() && !b.use?.trim()) out.push(`${blockName(b)} has no prompt (or agent action)`)
    if (b.kind === 'run' && !b.cmd?.trim()) out.push(`${blockName(b)} has no command`)
    if (b.kind === 'ask' && !b.question?.trim()) out.push(`${blockName(b)} asks nothing`)
    if (b.kind === 'save' && !b.file?.trim()) out.push(`${blockName(b)} has no file`)
    if (b.kind === 'save' && b.from && b.link) out.push(`${blockName(b)}: a file or a link, not both`)
    if (b.kind === 'agent' && b.session && !['run', 'new'].includes(b.session) && by.get(b.session)?.kind !== 'agent') out.push(`${blockName(b)}: session ${b.session} isn't an agent block`)
    if (wf.where === 'main' && ((b.kind === 'action' && ['ship', 'approve', 'merge'].includes(b.action ?? '')) || b.kind === 'wait')) out.push(`${blockName(b)} needs a PR: runs in: worktree`) // a folder's own workspace has no PR of its own
  }
  const seen = new Set<string>()
  const walk = (b?: Block) => {
    if (!b || seen.has(b.id)) return
    seen.add(b.id)
    for (const e of exitsOf(b)) walk(by.get(e.to ?? ''))
  }
  walk(start)
  for (const b of wf.blocks) if (!seen.has(b.id)) out.push(`nothing leads to ${blockName(b)}`)
  // loops (Tarjan's strongly connected parts) once the limited blocks (a max, an Ask you) are left out: what still goes
  // round could go round forever
  const limited = (id: string) => !!by.get(id)!.max || by.get(id)!.kind === 'ask'
  let n = 0
  const idx = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>()
  const scc = (v: string) => {
    idx.set(v, n), low.set(v, n++), stack.push(v), on.add(v)
    for (const e of limited(v) ? [] : exitsOf(by.get(v)!)) {
      if (!e.to || !by.has(e.to) || e.max || limited(e.to)) continue
      if (!idx.has(e.to)) scc(e.to), low.set(v, Math.min(low.get(v)!, low.get(e.to)!))
      else if (on.has(e.to)) low.set(v, Math.min(low.get(v)!, idx.get(e.to)!))
    }
    if (low.get(v) !== idx.get(v)) return
    const part: string[] = []
    for (let w = ''; w !== v; ) (w = stack.pop()!), on.delete(w), part.push(w)
    const loop = part.length > 1 || (!limited(v) && exitsOf(by.get(v)!).some(e => e.to === v))
    if (loop) out.push(`the loop through ${part.reverse().map(id => blockName(by.get(id)!)).join(', ')} has no limit: give one of its blocks a max`)
  }
  for (const b of wf.blocks) if (!idx.has(b.id)) scc(b.id)
  return out
}

// a case's branch: [<variable>] contains|matches|equals "<text>", or else (its last). No variable: the case's
export type Branch = { of?: string; test: (typeof TESTS)[number]; value: string } | 'else'
export function branchOf(label: string): Branch | undefined {
  if (/^else$/i.test(label.trim())) return 'else'
  const m = /^(?:(\S+)\s+)?(contains|matches|equals)\s+"(.*)"$/.exec(label.trim())
  return m ? { ...(m[1] && { of: m[1] }), test: m[2] as (typeof TESTS)[number], value: m[3] } : undefined
}
export const branchLabel = (b: Exclude<Branch, 'else'>) => `${b.of ? `${b.of} ` : ''}${b.test} "${b.value.replace(/\s*\n\s*/g, ' ')}"`
// whether a test holds of a value: contains and equals in any case, matches as a regular expression; equals takes the
// whole value less the wrapping an agent's one-word answer gets (`only_specs`, **only_specs**, "only_specs", only_specs.)
const bare = (x: string) => x.trim().replace(/^[\s"'`*]+|[\s"'`*.!]+$/g, '').toLowerCase()
export function holds(v: string, test: string | undefined, want: string) {
  return test === 'matches' ? new RegExp(want, 'i').test(v) : test === 'equals' ? bare(v) === bare(want) : v.toLowerCase().includes(want.toLowerCase())
}
function caseProblems(b: Block): string[] {
  const out: string[] = []
  const opts = b.options ?? []
  opts.forEach((o, i) => {
    const br = branchOf(o.label)
    if (!br) return void out.push(`${blockName(b)}: “${clip(o.label, 40)}”? a branch is [variable] contains|matches|equals "text", or else`)
    if (br === 'else') return void (i !== opts.length - 1 && out.push(`${blockName(b)}: else goes last`))
    if (!br.of && !b.of?.trim()) out.push(`${blockName(b)}: “${clip(o.label, 40)}” names no variable (and the case has none)`)
    if (!br.value.trim() && br.test !== 'equals') out.push(`${blockName(b)}: “${clip(o.label, 40)}” tests no text: it would always hold`)
    if (br.test === 'matches')
      try {
        new RegExp(br.value)
      } catch {
        out.push(`${blockName(b)}: “${clip(br.value, 40)}” isn't a regular expression`)
      }
  })
  if (opts.length && !opts.some(o => branchOf(o.label) === 'else')) out.push(`${blockName(b)} needs an else, last: where it goes when nothing matches`)
  if (new Set(opts.map(o => o.label.trim())).size < opts.length) out.push(`${blockName(b)}: two branches say the same`)
  return out
}

// {{name}} from a run's variables; an unknown one stays as it is
export const fill = (text: string, vars: Record<string, string | undefined>) => String(text ?? '').replace(/\{\{\s*([\w.?-]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m)

// ---------- runs

export type FlowStatus = 'running' | 'waiting' | 'paused' | 'done' | 'stopped' | 'failed'
export const FLOW_ENDED: FlowStatus[] = ['done', 'stopped', 'failed']
// a run of this workflow: a project's only in that project (two repos may each have a review.md)
export const runOf = (r: { workflow: string; source: WorkflowSource; project: string }, w: { id: string; source: WorkflowSource; project?: string }) => r.workflow === w.id && r.source === w.source && (w.source !== 'project' || r.project === w.project)
export type Decision = { at: number; block: string; exit: string; why: string; ms?: number; you?: boolean; bad?: boolean }
// what a run waits on: an ask (yours, a confirm before an outward action, a stuck block), an agent's turn, a command,
// a wait block, a usage limit
export type FlowWait =
  | { kind: 'ask' | 'confirm' | 'stuck'; question: string; show?: string; options: string[] }
  | { kind: 'agent'; tab: string; queued?: string } // queued: the prompt, while it waits in the tab's queue
  | { kind: 'run' | 'wait' }
  | { kind: 'limit'; tab: string; until?: number }
export type FlowRun = {
  id: string
  workflow: string // its id
  source: WorkflowSource
  flow: Workflow // the version it started with: edits don't move a run
  project: string
  ws?: string
  where: Workflow['where']
  session: Workflow['session']
  dry?: boolean // outward actions said, not done
  task: string
  trigger: string
  status: FlowStatus
  cur?: string // the block it's on
  at?: number // since when
  wait?: FlowWait
  visits: Record<string, number>
  vars: Record<string, string>
  tabs: Record<string, string> // run:<agent> and each agent block's id → its tab
  resume?: Record<string, string> // run:<agent> → its chat's id, for the next run's shared session
  turns: number
  decisions: Decision[]
  log: string[]
  started: number
  ended?: number
}
export type FlowView = Omit<FlowRun, 'flow' | 'log' | 'decisions' | 'vars' | 'tabs' | 'resume'> & { name: string; block?: string; decisions: number; last?: Decision } // the view's: the details come from flowGet
export const flowView = ({ flow, log, decisions, vars, tabs, resume, ...r }: FlowRun): FlowView => {
  const b = flow.blocks.find(x => x.id === r.cur)
  const wait = r.wait && 'show' in r.wait ? { ...r.wait, show: undefined } : r.wait // an agent's whole answer: flowGet has it
  return { ...r, wait, name: flow.name, block: b && blockName(b), decisions: decisions.length, last: decisions.at(-1) }
}

// the format in words: MCP's laki_workflow_write and Laki AI's guide to writing one
export const WORKFLOW_FORMAT = `A Laki workflow is one Markdown file: a graph of blocks Laki runs for a task, in a worktree of its own (or the project's folder).

# <Name>
<one line: what it does>

runs in: worktree|main · session: new|shared · at once: 3 · turns: 30

Then a "## <id>" per block (id: letters, digits, - _ ?). A block's first kind key sets its kind:
- ## start, with "input: task" and "next: <block>": where it begins. {{task}} is what the user asked.
- agent: <preset: claude, codex…> · model: <opus…> · effort: <high…> · session: run|new|<agent block id> · use: <an agent action's slug: laki_workflows lists them>, then the prompt as "> " lines. Waits for the agent's turn to end; exits next, error. Its answer is {{steps.<id>.answer}}. session run (the default): the run's tab of that agent; <block id>: the same tab as that block. use: one of the user's agent actions (Run ▾'s, in Settings or the project's: laki_actions): its prompt goes first, the block's "> " lines after it (none needed).
- run: <shell command> (in the run's folder; timeout: <minutes>). Exits ok (exit 0), fail. {{steps.<id>.output}}: its last lines.
- ask: <question>, show: <text with {{vars}}>, then options "- <label> → <block>". Waits for the user; what they type is {{answer}}.
- choice: <variable or block id> contains|matches|equals "<text>" (if/else; "if:" is the same), then two options: the first when it holds, the second when not.
- case: <variable or block id>, then its branches in order, the first that holds wins: "- contains|matches|equals "<text>" → <block>", a branch may test another variable ("- steps.size.output equals "0" → <block>"), and "- else → <block>" last (needed). if/elsif/else, or a switch on one value. To route on what an agent found, tell it to answer with one word (only_specs, code…) and test {{steps.<id>.answer}}.
- action: ship|approve|merge|dev|archive (ship's commit message as "> " lines). ship, approve, merge and archive ask the user first unless "ask first: no". Exits ok, error.
- wait: checks: until the workspace's PR's checks pass or fail (timeout: <minutes>). Exits pass, fail.
- save: <file> in the workspace's storage folder (its Artifacts), its text as "> " lines; or "from: <a file or folder of the workspace>" copied there; or "link: <https URL, {{pr.url}}…>" kept as <file>.url. Exit ok.
- end: success|stopped|failed · notify: yes.
A workflow has ${MAX_BLOCKS} blocks at most. Exits are lines: "next: <block>", "ok: <block>", "fail: <block>"… "max: 3 → <block>" limits a block to 3 times, then goes there: every loop needs a max or an ask in it. Other variables: {{answer}}, {{pr.url}}, {{pr.number}}, {{ws.branch}}, {{base}}, {{project}}. "at: x,y" places a block on the canvas (optional).`
