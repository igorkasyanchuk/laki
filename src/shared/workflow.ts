// Workflows (experimental, settings.workflows): a graph of blocks Laki runs for a task. Agents think inside their
// blocks; the daemon (daemon/workflow.ts) walks the graph, keeps each run's decisions, state and log, and resumes it
// after a restart. One Markdown file per workflow, none to start with: yours (<data>/workflows/<id>.md) or a project's
// (.laki/workflows/<id>.md in its repo). This file is the format both sides share: parse, toFile, check.

export const BLOCKS = ['start', 'agent', 'llm', 'decide', 'run', 'choice', 'case', 'ask', 'popup', 'action', 'wait', 'save', 'webhook', 'extension', 'end'] as const
export type BlockKind = (typeof BLOCKS)[number]
// each kind's exits; choice, case and ask have options instead (each its own exit)
export const EXITS: Record<BlockKind, string[]> = { start: ['next'], agent: ['next', 'error'], llm: ['ok', 'error'], decide: ['ok', 'error'], popup: ['next'], webhook: ['ok', 'error'], run: ['ok', 'fail'], choice: [], case: [], ask: [], action: ['ok', 'error'], wait: ['pass', 'fail'], save: ['ok'], extension: ['ok', 'error'], end: [] }
export const BAD_EXITS = ['fail', 'error']
export const optioned = (k: BlockKind) => k === 'choice' || k === 'case' || k === 'ask'
export const BLOCK_NAMES: Record<BlockKind, string> = { start: 'Start', agent: 'Agent', llm: 'AI call', decide: 'AI decision', popup: 'Show you', webhook: 'Webhook', run: 'Run command', choice: 'If / else', case: 'Case', ask: 'Ask you', action: 'Laki action', wait: 'Wait', save: 'Save', extension: 'Extension', end: 'End' }
export const ACTIONS: Record<string, string> = { ship: 'Open a PR (commit, push, gh pr create)', approve: 'Approve its PR', merge: 'Merge its PR', dev: 'Run the dev server', archive: 'Archive the workspace' }
export const OUTWARD = ['ship', 'approve', 'merge', 'archive'] // what others see: asks first unless the block says ask first: no
export const WAITS: Record<string, string> = { checks: 'Its PR’s checks pass or fail' }
export const TESTS = ['contains', 'matches', 'equals', '>=', '<=', '>', '<', 'js'] as const // the last five: a number's, and a case branch's own JS
export const NUM_TESTS = ['>=', '<=', '>', '<']
export const WHERES: Record<string, string> = { worktree: 'A new worktree per run', main: "The project's folder (its own workspace)" }
export const SESSIONS: Record<string, string> = { new: 'A new AI session per run', shared: 'One AI session for every run (claude: each run forks the last)' }
export const RESULTS = ['success', 'stopped', 'failed'] as const
export const METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] as const // a webhook's
// out: what a block gives the blocks after it, as {{steps.<id>.<name>}}: an agent's or an AI call's answer ends with a
// JSON object of them (they're told to), a command's output or a webhook's response is one; its own variables aren't
export const OUT_NAME = /^[a-z][\w-]{0,40}$/i
export const OUT_TAKEN = ['answer', 'output', 'code', 'status', 'head']
export const OUT_KINDS: BlockKind[] = ['agent', 'llm', 'run', 'webhook']
// an AI decision: OpenRouter's decision models (the Decisions API: typed questions in, probabilities out; no text). A
// model id of any other works too
export const DECIDE_MODELS: { id: string; name: string }[] = [
  { id: 'typesafe/jev-1.13', name: 'Jev (TypeSafe)' },
  { id: 'openai/gpt-6-luna-decisions', name: 'GPT-6 Luna Decisions (OpenAI)' },
  { id: 'microsoft/microsoft-decision-1', name: 'Microsoft-Decision-1' },
  { id: '~perplexity/pplx-decider-latest', name: 'Perplexity Decider' },
  { id: 'cloudflare/clef', name: 'Clef (Cloudflare)' },
]
export const QTYPES = ['yes/no', 'choice', 'score'] as const // the API's noul (how true: yes/no by sure), choice, score
// each type as the Decisions API names it and what it's for (the inspector's picker)
export const QTYPE_INFO: Record<(typeof QTYPES)[number], { api: string; name: string; says: string; e: string }> = {
  'yes/no': { api: 'noul', name: 'How true', says: 'How true something is: yes or no by how sure', e: 'Is `food` a sandwich?' },
  choice: { api: 'choice', name: 'Choice', says: 'A multiple-choice question: one of its options', e: 'What color is `object`?' },
  score: { api: 'score', name: 'Score', says: 'Graded with a rubric: one of its levels', e: 'How much did `subject` contribute?' },
}
// a question: yes/no's opts are what yes and what no mean (both optional), a choice's its options (label: what it
// means), a score's its levels in order (0 the lowest)
export type DecideQ = { name: string; type: (typeof QTYPES)[number]; ask: string; opts: { label: string; text: string }[] }
export const SURE = 0.7 // yes from this probability, no below 1 - it; a choice or a score this confident: else it asks you
export const RUNS_AT_ONCE = 3 // a workflow's runs going at the same time (its at once:)
export const TURNS = 30 // agent turns in one run before it asks you (its turns:)
export const MAX_BLOCKS = 100 // a workflow's blocks: past it, it won't run (and + Block stops)
export const RETRY_KINDS: BlockKind[] = ['agent', 'run', 'llm', 'decide', 'extension'] // what retry: takes
export const RETRY_MAX = 5
export const AGENT_TIMEOUT = 60 // an agent block's minutes for its turn, unless it says (time it waits for you doesn't count)

export type Option = { label: string; to?: string }
export type Block = {
  id: string
  kind: BlockKind
  name?: string
  at?: [number, number] // where the canvas draws it
  to?: Record<string, string> // exit → block id
  options?: Option[] // choice (yes, no), ask (buttons), case (its branches: a test each, else last)
  max?: { n: number; to?: string } // at most n times, then to
  text?: string // popup: what it shows (HTML when it starts with <, else Markdown); end: its notification's words; decide: the state it judges (a JSON template; none: the block before's result); agent, llm: the prompt (after its action's, with use); action ship: the commit message; save: what's written; webhook: its body
  input?: 'task' // start
  agent?: string // a preset's name (claude, codex, one of Settings')
  use?: string // agent: an agent action's slug, or its name (Run ▾'s, Settings' or the project's: findAction): its prompt first
  model?: string // agent; llm: an OpenRouter model (unset: Settings › AI's); decide: a decision model (unset: Jev)
  system?: string // llm: its system prompt
  temperature?: number // llm
  qs?: DecideQ[] // decide: its questions
  sure?: number // decide: how sure it must be (SURE)
  route?: string // decide: the question whose answer picks the way out (a line per answer: routesOf), else one way, ok
  json?: boolean // llm: JSON mode, its answer a JSON object (unset: when it has out:); agent: told to end with one JSON value, its answer that JSON
  out?: string[] // agent, llm, run, webhook: the names it gives (OUT_NAME)
  url?: string // webhook: where it goes ({{vars}} too)
  method?: (typeof METHODS)[number] // webhook (unset: POST)
  headers?: string[] // webhook: Name: value, {{env.NAME}} for a secret
  effort?: string
  session?: string // agent: run (the run's agent tab, the default), new, or a block's id (its tab)
  cmd?: string // run
  timeout?: number // agent, run, wait, llm, decide, webhook: minutes
  retry?: number // agent, run, llm, decide, extension: tries again after a bad exit (fail, error), 1 to RETRY_MAX times
  retryOn?: number[] // run: only these exit codes are tried again (unset: any but 0)
  question?: string // ask
  title?: string // popup: its title ({{vars}})
  show?: string // ask: what goes with the question ({{vars}})
  of?: string // choice, case: a variable (steps.review.answer) or a block's id (its answer or output); a case's branch may name its own
  test?: (typeof TESTS)[number]
  value?: string
  action?: string
  confirm?: boolean // an outward action: false skips the ask (unset: asks)
  for?: string // wait
  file?: string // save: a path in the workspace's storage folder
  from?: string // save: a file or folder of the workspace, copied there (instead of text); webhook: a file of it, sent as the body
  link?: string // save: a link, kept as <file>.url (the workspace's Artifacts list links first)
  extension?: string // extension: its id, fetched now (an on one only), then its data as variables
  result?: (typeof RESULTS)[number] // end
  notify?: boolean // end, popup: a notification too
  phone?: boolean // end, popup, with notify: a push to the phone too (Settings › Phone pushes)
}
export type Workflow = { id: string; name: string; desc?: string; where: 'worktree' | 'main'; session: 'new' | 'shared'; runs?: number; turns?: number; vars?: Record<string, string>; blocks: Block[] } // vars: its own {{vars.NAME}} (var NAME: value lines), over Settings' flowVars
export type WorkflowSource = 'yours' | 'project'
export type WorkflowItem = Workflow & { source: WorkflowSource; project?: string; path?: string; problems: string[]; text: string; byAgent?: boolean } // the list's; byAgent: an agent wrote it (MCP), not saved by the user since

export const ID = /^[a-z0-9][a-z0-9_?-]{0,40}$/i
export const VAR_NAME = /^[A-Za-z_][\w-]{0,40}$/ // a variable's: {{vars.NAME}}
const VAR_LINE = /^var\s+([A-Za-z_][\w-]{0,40})\s*:\s?(.*)$/
// {{vars.NAME}}: Settings' (every workflow's), then the workflow's own over them
export const varsFill = (own?: Record<string, string>, global?: Record<string, string>) => Object.fromEntries(Object.entries({ ...global, ...own }).filter(([k]) => VAR_NAME.test(k)).map(([k, v]) => [`vars.${k}`, String(v ?? '')]))
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const blockName = (b: Block) => b.name || (b.kind === 'start' ? 'Start' : b.id)

// a decision's ways out when it routes on a question: its answers (yes and no, a choice's options, a score's levels by
// number; label: as the canvas says it), each kept as an option (- yes → block)
export function routesOf(b: Block): { name: string; label: string }[] | undefined {
  const q = b.kind === 'decide' && b.route ? b.qs?.find(x => x.name === b.route) : undefined
  if (!q) return
  if (q.type === 'yes/no') return [{ name: 'yes', label: 'yes' }, { name: 'no', label: 'no' }]
  return q.opts.map((o, i) => (q.type === 'choice' ? { name: o.label, label: o.label } : { name: String(i), label: `${i}: ${clip(o.text, 24)}` }))
}

// a block's exits, each with where it goes: a choice's or ask's options, a routed decision's answers, then its max's
export type Exit = { name: string; label?: string; to?: string; bad?: boolean; max?: boolean }
export function exitsOf(b: Block): Exit[] {
  const routes = routesOf(b)
  const l: Exit[] = optioned(b.kind)
    ? (b.options ?? []).map(o => ({ name: o.label, to: o.to }))
    : routes
      ? [...routes.map(r => ({ ...r, to: b.options?.find(o => o.label === r.name)?.to })), { name: 'error', to: b.to?.error, bad: true }]
      : EXITS[b.kind].map(e => ({ name: e, to: b.to?.[e], bad: BAD_EXITS.includes(e) }))
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

const WHOLE = new Set(['name', 'ask', 'show', 'run', 'choice', 'if', 'case', 'from', 'link', 'webhook', 'header', 'question', 'system', 'popup', 'extension']) // the rest of the line is the value: no · split
const KIND_KEY: Record<string, BlockKind> = { input: 'start', agent: 'agent', llm: 'llm', decide: 'decide', popup: 'popup', webhook: 'webhook', run: 'run', choice: 'choice', if: 'choice', case: 'case', ask: 'ask', action: 'action', wait: 'wait', save: 'save', extension: 'extension', end: 'end' }

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
      const v = VAR_LINE.exec(line) // var NAME: value
      if (v) return void ((wf.vars ??= {})[v[1]] = v[2].trim())
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
    if (/^\s/.test(line) && b.kind === 'decide' && b.qs?.length) {
      // under a question: "  label: what it means" (yes/no, choice), "  - a level" (score, lowest first)
      const q = b.qs.at(-1)!
      const m = q.type === 'score' ? /^\s+-\s+(.*)$/.exec(line) : /^\s+([^:]+?):\s*(.*)$/.exec(line)
      if (!m) return void problems.push(`${at}: ${q.type === 'score' ? '  - a level' : '  label: what it means'}`)
      return void q.opts.push(q.type === 'score' ? { label: String(q.opts.length), text: m[1].trim() } : { label: m[1].trim(), text: m[2].trim() })
    }
    if (line.startsWith('>')) return void (b.text = b.text === undefined ? line.replace(/^> ?/, '') : `${b.text}\n${line.replace(/^> ?/, '')}`)
    const opt = /^-\s+(.+?)\s*(?:→|->)\s*(\S*)\s*$/.exec(line)
    if (opt) return void (b.options ??= []).push({ label: opt[1], ...(opt[2] && opt[2] !== '?' && { to: opt[2] }) })
    const kv = /^([a-z][a-z ]*?):\s?(.*)$/i.exec(line)
    if (!kv) return void problems.push(`${at}: ${clip(line.trim(), 40)}? (key: value, > text or - option → block)`)
    const key = kv[1].toLowerCase()
    for (const [k, v] of WHOLE.has(key) ? [[key, kv[2].trim()] as [string, string]] : pairs(line)) set(b, k, v, at, problems)
  })
  wf.desc = desc.join(' ') || undefined
  for (const x of wf.blocks) if (!x.kind) problems.push(`${x.id}: what kind of block? (agent:, llm:, decide:, run:, ask:, choice:, case:, popup:, action:, wait:, save:, webhook:, end:)`)
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
    case 'llm': return void (b.model = v || undefined)
    case 'decide': return void (b.model = v || undefined)
    case 'popup': return void (b.title = v || undefined)
    case 'system': return void (b.system = v || undefined)
    case 'temperature': {
      const n = Number(v)
      return void (v !== '' && n >= 0 && n <= 2 ? (b.temperature = n) : problems.push(`${at}: temperature: 0 to 2`))
    }
    case 'sure': {
      const n = Number(v)
      return void (n >= 0.5 && n < 1 ? (b.sure = n) : problems.push(`${at}: sure: 0.5 to 0.99`))
    }
    case 'route': return void (b.route = v || undefined)
    case 'json': return void (b.json = yes(v))
    case 'phone': return void (b.phone = yes(v))
    case 'question': {
      // question: urgent · yes/no · Does any message need me today? (noul, the API's name, is yes/no)
      const [name = '', t = '', ...ask] = v.split(/\s+·\s+/)
      const type = t === 'noul' ? 'yes/no' : t
      if (!OUT_NAME.test(name) || [...OUT_TAKEN, 'answers'].includes(name)) problems.push(`${at}: question: ${name}? a name (letters, digits, - _)`)
      if (!(QTYPES as readonly string[]).includes(type)) problems.push(`${at}: question: name · ${QTYPES.join('|')} · what it asks`)
      return void (b.qs ??= []).push({ name, type: (QTYPES as readonly string[]).includes(type) ? (type as DecideQ['type']) : 'yes/no', ask: ask.join(' · '), opts: [] })
    }
    case 'out': {
      const names = v.split(/[\s,]+/).filter(Boolean)
      for (const n of names) if (!OUT_NAME.test(n) || OUT_TAKEN.includes(n)) problems.push(`${at}: out: ${n}? a name (letters, digits, - _), not ${OUT_TAKEN.join(', ')}`)
      return void (b.out = names.length ? names : undefined)
    }
    case 'webhook': return void (b.url = v)
    case 'extension': return void (b.extension = v)
    case 'method': {
      const m = v.toUpperCase() as Block['method']
      if (!(METHODS as readonly string[]).includes(m!)) problems.push(`${at}: method: ${METHODS.join(', ')}`)
      return void (b.method = m)
    }
    case 'header': return void (/^[\w-]+:\s?\S/.test(v) ? (b.headers ??= []).push(v) : problems.push(`${at}: header: Name: value`))
    case 'effort': return void (b.effort = v || undefined)
    case 'session': return void (b.session = v || undefined)
    case 'run': return void (b.cmd = v)
    case 'timeout': return void (b.timeout = num(v.replace(/\s*min(utes)?$/, ''), at, problems))
    case 'retry': return void (Number.isInteger(Number(v)) && v !== '' ? (b.retry = Number(v)) : problems.push(`${at}: retry: how many times it tries again, 1 to ${RETRY_MAX}`)) // check() says what's out of range
    case 'retry on': {
      const codes = v.split(/[\s,]+/).filter(Boolean).map(Number)
      return void (codes.length && codes.every(c => Number.isInteger(c) && c >= 1 && c <= 255) ? (b.retryOn = codes) : problems.push(`${at}: retry on: exit codes, 1 to 255 (retry on: 1, 75)`))
    }
    case 'ask': return void (b.question = v)
    case 'show': return void (b.show = v || undefined)
    case 'if':
    case 'choice': {
      // choice: steps.review.answer contains "LGTM" (if: is the same), or a number's: steps.triage.urgent.p >= 0.8
      const br = branchOf(v)
      if (!br || br === 'else' || !br.of || br.test === 'js') return void problems.push(`${at}: ${k}: <variable> contains|matches|equals "text", or <variable> >= <number>`)
      return void Object.assign(b, { of: br.of, test: br.test, value: br.value })
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
  for (const [k, v] of Object.entries(wf.vars ?? {})) if (VAR_NAME.test(k)) L.push(`var ${k}: ${one(v)}`)
  for (const b of wf.blocks) {
    L.push('', `## ${b.id}`)
    if (b.name && b.name !== b.id) L.push(`name: ${one(b.name)}`)
    switch (b.kind) {
      case 'start': L.push(`input: ${b.input ?? 'task'}`); break
      case 'agent': L.push([`agent: ${b.agent || 'claude'}`, b.model && `model: ${b.model}`, b.effort && `effort: ${b.effort}`, b.session && b.session !== 'run' && `session: ${b.session}`, b.use && `use: ${one(b.use)}`, b.json && 'json: yes'].filter(Boolean).join(' · ')); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'llm': L.push(`llm: ${b.model ?? ''}`.trimEnd()); if (b.system) L.push(`system: ${one(b.system)}`); if (b.temperature !== undefined) L.push(`temperature: ${b.temperature}`); if (b.json !== undefined) L.push(`json: ${b.json ? 'yes' : 'no'}`); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'decide':
        L.push([`decide: ${b.model ?? ''}`.trimEnd(), b.sure !== undefined && `sure: ${b.sure}`, b.timeout && `timeout: ${b.timeout}`].filter(Boolean).join(' · '))
        for (const q of b.qs ?? []) {
          L.push(`question: ${q.name} · ${q.type} · ${one(q.ask)}`)
          for (const o of q.opts) L.push(q.type === 'score' ? `  - ${one(o.text)}` : `  ${one(o.label).replace(/:/g, '')}: ${one(o.text)}`)
        }
        if (b.route) L.push(`route: ${b.route}`)
        break
      case 'webhook': L.push(`webhook: ${one(b.url)}`); if (b.method && b.method !== 'POST') L.push(`method: ${b.method}`); for (const h of b.headers ?? []) L.push(`header: ${one(h)}`); if (b.from) L.push(`from: ${one(b.from)}`); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'run': L.push(`run: ${one(b.cmd)}`); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'extension': L.push(`extension: ${one(b.extension)}`.trimEnd()); break
      case 'ask': L.push(`ask: ${one(b.question)}`); if (b.show) L.push(`show: ${one(b.show)}`); break
      case 'popup': L.push(`popup: ${one(b.title)}`.trimEnd()); if (b.notify) L.push('notify: yes'); if (b.phone) L.push('phone: yes'); break
      case 'choice': L.push(`choice: ${branchLabel({ of: b.of || 'answer', test: b.test && b.test !== 'js' ? b.test : 'contains', value: b.value ?? '' })}`); break
      case 'case': L.push(`case: ${b.of ?? ''}`.trimEnd()); break
      case 'action': L.push([`action: ${b.action || 'ship'}`, b.confirm === false && 'ask first: no'].filter(Boolean).join(' · ')); break
      case 'wait': L.push(`wait: ${b.for || 'checks'}`); if (b.timeout) L.push(`timeout: ${b.timeout}`); break
      case 'save': L.push(`save: ${one(b.file)}`); if (b.from) L.push(`from: ${one(b.from)}`); if (b.link) L.push(`link: ${one(b.link)}`); break
      case 'end': L.push([`end: ${b.result || 'success'}`, b.notify && 'notify: yes', b.phone && 'phone: yes'].filter(Boolean).join(' · ')); break
    }
    if (b.retry !== undefined || b.retryOn?.length) L.push([b.retry !== undefined && `retry: ${b.retry}`, b.retryOn?.length && `retry on: ${b.retryOn.join(', ')}`].filter(Boolean).join(' · '))
    if (b.out?.length && OUT_KINDS.includes(b.kind)) L.push(`out: ${b.out.join(', ')}`)
    if (b.text !== undefined && b.text !== '') for (const l of b.text.split('\n')) L.push(l ? `> ${l}` : '>')
    const routed = b.kind === 'decide' && !!b.route
    // a routed decision: its answers that go somewhere (the rest end the run there), in its question's order
    const opts = routed ? (routesOf(b)?.map(r => ({ label: r.name, to: b.options?.find(x => x.label === r.name)?.to })).filter(o => o.to) ?? b.options ?? []) : (b.options ?? [])
    if (optioned(b.kind) || routed) for (const o of opts) L.push(`- ${one(o.label)} → ${o.to || '?'}`)
    for (const e of optioned(b.kind) ? [] : routed ? ['error'] : EXITS[b.kind]) if (b.to?.[e]) L.push(`${e}: ${b.to[e]}`)
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
    if (b.kind === 'llm' && !b.text?.trim()) out.push(`${blockName(b)} has no prompt`)
    if (b.kind === 'decide') out.push(...decideProblems(b))
    if (b.kind === 'webhook' && !/^(https?:\/\/|\{\{)\S+$/i.test(b.url?.trim() ?? '')) out.push(`${blockName(b)}: webhook: an http(s) URL`)
    if (b.kind === 'webhook' && b.from && b.text?.trim()) out.push(`${blockName(b)}: a body or a file (from:), not both`)
    if (b.out?.length && !OUT_KINDS.includes(b.kind)) out.push(`${blockName(b)}: out: is for agent, AI call, run and webhook blocks`)
    if (b.json !== undefined && b.kind !== 'agent' && b.kind !== 'llm') out.push(`${blockName(b)}: json: is for agent and AI call blocks`)
    if (b.retry !== undefined && !RETRY_KINDS.includes(b.kind)) out.push(`${blockName(b)}: retry: is for agent, run, AI call, AI decision and extension blocks`)
    else if (b.retry !== undefined && !(Number.isInteger(b.retry) && b.retry >= 1 && b.retry <= RETRY_MAX)) out.push(`${blockName(b)}: retry: ${b.retry}? 1 to ${RETRY_MAX} tries again`)
    if (b.retryOn?.length && b.kind !== 'run') out.push(`${blockName(b)}: retry on: is for run blocks (their exit codes)`)
    else if (b.retryOn?.length && !b.retry) out.push(`${blockName(b)}: retry on: needs retry: (how many times)`)
    if (b.kind === 'ask' && !b.question?.trim()) out.push(`${blockName(b)} asks nothing`)
    if (b.kind === 'popup' && !b.text?.trim()) out.push(`${blockName(b)} shows nothing`)
    if (b.kind === 'save' && !b.file?.trim()) out.push(`${blockName(b)} has no file`)
    if (b.kind === 'extension' && !/^[\w.-]{1,80}$/.test(b.extension?.trim() ?? '')) out.push(`${blockName(b)}: extension: which one (its id)`)
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

// a case's branch: [<variable>] contains|matches|equals "<text>", [<variable>] >=|<=|>|< <number>, js: <a JS
// expression> (vars, num(name), json(name)), or else (its last). No variable: the case's
export type Branch = { of?: string; test: (typeof TESTS)[number]; value: string } | 'else'
export function branchOf(label: string): Branch | undefined {
  const l = label.trim()
  if (/^else$/i.test(l)) return 'else'
  const js = /^js:\s*(.*)$/i.exec(l)
  if (js) return { test: 'js', value: js[1] }
  const n = /^(?:(\S+)\s+)?(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(l)
  if (n) return { ...(n[1] && { of: n[1] }), test: n[2] as (typeof TESTS)[number], value: n[3] }
  const m = /^(?:(\S+)\s+)?(contains|matches|equals)\s+"(.*)"$/.exec(l)
  return m ? { ...(m[1] && { of: m[1] }), test: m[2] as (typeof TESTS)[number], value: m[3] } : undefined
}
export const branchLabel = (b: Exclude<Branch, 'else'>) =>
  b.test === 'js' ? `js: ${b.value.replace(/\s*\n\s*/g, ' ')}` : NUM_TESTS.includes(b.test) ? `${b.of ? `${b.of} ` : ''}${b.test} ${b.value.trim()}` : `${b.of ? `${b.of} ` : ''}${b.test} "${b.value.replace(/\s*\n\s*/g, ' ')}"`
// whether a test holds of a value: contains and equals in any case, matches as a regular expression; equals takes the
// whole value less the wrapping an agent's one-word answer gets (`only_specs`, **only_specs**, "only_specs", only_specs.)
const bare = (x: string) => x.trim().replace(/^[\s"'`*]+|[\s"'`*.!]+$/g, '').toLowerCase()
export function holds(v: string, test: string | undefined, want: string) {
  if (test && NUM_TESTS.includes(test)) {
    const [a, b] = [Number(bare(v)), Number(want)]
    return v.trim() !== '' && !Number.isNaN(a) && (test === '>=' ? a >= b : test === '<=' ? a <= b : test === '>' ? a > b : a < b)
  }
  return test === 'matches' ? new RegExp(want, 'i').test(v) : test === 'equals' ? bare(v) === bare(want) : v.toLowerCase().includes(want.toLowerCase())
}
function caseProblems(b: Block): string[] {
  const out: string[] = []
  const opts = b.options ?? []
  opts.forEach((o, i) => {
    const br = branchOf(o.label)
    if (!br) return void out.push(`${blockName(b)}: “${clip(o.label, 40)}”? a branch is [variable] contains|matches|equals "text", [variable] >= 3, js: <expression>, or else`)
    if (br === 'else') return void (i !== opts.length - 1 && out.push(`${blockName(b)}: else goes last`))
    if (br.test === 'js') return void (!br.value.trim() && out.push(`${blockName(b)}: a js: branch with no expression`))
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

function decideProblems(b: Block): string[] {
  const out: string[] = []
  const qs = b.qs ?? []
  if (!qs.length) out.push(`${blockName(b)} asks no question`)
  if (new Set(qs.map(q => q.name)).size < qs.length) out.push(`${blockName(b)}: two questions are called the same`)
  for (const q of qs) {
    if (!OUT_NAME.test(q.name) || [...OUT_TAKEN, 'answers'].includes(q.name)) out.push(`${blockName(b)}: ${q.name}? a question's name: letters, digits, - _ (not ${[...OUT_TAKEN, 'answers'].join(', ')})`)
    if (!q.ask.trim()) out.push(`${blockName(b)}: ${q.name} asks nothing`)
    if (q.type !== 'yes/no' && q.opts.length < 2) out.push(`${blockName(b)}: ${q.name} needs two ${q.type === 'score' ? 'levels' : 'options'} at least`)
    if (q.type === 'yes/no' && q.opts.some(o => !['yes', 'no'].includes(o.label))) out.push(`${blockName(b)}: ${q.name}: a yes/no question's lines are yes: and no:`)
    if (q.type === 'choice' && new Set(q.opts.map(o => o.label)).size < q.opts.length) out.push(`${blockName(b)}: ${q.name}: two options are called the same`)
  }
  if (b.route && !qs.some(q => q.name === b.route)) out.push(`${blockName(b)}: route: ${b.route} isn't one of its questions`)
  // its - <answer> → block lines: only with a route, each one of its answers (toFile keeps no other)
  const answers = routesOf(b)?.map(r => r.name)
  if (answers || !b.route) for (const o of b.options ?? []) if (!answers?.includes(o.label)) out.push(`${blockName(b)}: - ${o.label} → ${o.to ?? '?'}: ${answers ? `not an answer of ${b.route} (${answers.join(', ')})` : 'a line per answer needs route: <question>'}`)
  if (answers?.includes('error')) out.push(`${blockName(b)}: ${b.route}: an option called error is its error exit's name`)
  return out
}

// Workflows' Make it with Laki AI: what's wanted, and the questions to ask first (laki_ask), then laki_workflow_write
export const workflowAsk = (want: string) => `Make me a Laki workflow: ${want.trim()}

Before you write it, ask me at least 2 questions, one at a time with laki_ask (each with options to tap): what starts it and what it works on (a task I type, a schedule), its steps and which are agents, commands, AI calls or AI decisions, where it routes (a decision's answers, a case), what it keeps or posts (Artifacts, a webhook), and how it tells me it's done (a Show you window, a notification, my phone). Then write it with laki_workflow_write (mine unless I name a project), check what laki_workflows says of it, and tell me to read it and save it in Laki.`

// ---------- what a workflow's variables are: the run's, each block's ({{steps.<id>.…}}), for the inspector's list

export type FlowVar = { name: string; what: string; from?: string } // from: the block that sets it
export function flowVars(wf: Workflow): FlowVar[] { // yours, {{vars.NAME}}, aren't here: the editor lists them apart
  const out: FlowVar[] = [
    { name: 'task', what: 'what the run works on (Run’s task, a schedule’s prompt)' },
    { name: 'project', what: 'the project’s name' },
    { name: 'answer', what: 'what you typed with your last Ask you pick (else its label)' },
    { name: 'pr.url', what: 'the workspace’s PR, once there is one' },
    { name: 'pr.number', what: 'its number' },
    { name: 'ws.branch', what: 'the run’s branch' },
    { name: 'ws.path', what: 'the run’s folder' },
    { name: 'base', what: 'the base branch' },
  ]
  for (const b of wf.blocks) {
    const at = (n: string, what: string) => out.push({ name: `steps.${b.id}.${n}`, what, from: b.id })
    if (b.kind === 'agent' || b.kind === 'llm') at('answer', (b.kind === 'llm' ? (b.json ?? !!b.out?.length) : b.json) ? 'its answer: one JSON object (JSON mode)' : b.kind === 'agent' ? 'the agent’s answer: its last message this turn' : 'the model’s answer')
    if (b.kind === 'run') at('output', 'the command’s last 80 lines'), at('code', 'its exit code')
    if (b.kind === 'webhook') at('status', 'the HTTP status'), at('output', 'the response')
    if (b.kind === 'wait') at('output', 'the checks that failed')
    if (b.kind === 'save') at('output', 'the saved file’s path')
    if (b.kind === 'extension') at('data', `its data, fetched now, as JSON; each field of it: steps.${b.id}.<field>`)
    for (const n of OUT_KINDS.includes(b.kind) ? (b.out ?? []) : []) at(n, 'an output it names (out:)')
    if (b.kind === 'decide') {
      for (const q of b.qs ?? []) {
        at(q.name, q.type === 'yes/no' ? 'yes or no (empty: it asked you)' : q.type === 'choice' ? `one of ${q.opts.map(o => o.label).join(', ') || 'its options'}` : `a level’s number, 0 to ${Math.max(0, q.opts.length - 1)}`)
        at(`${q.name}.p`, q.type === 'yes/no' ? 'how true: 0 to 1' : 'its answer’s probability')
        if (q.type !== 'yes/no') at(`${q.name}.confidence`, 'how sure: 0 to 1')
        if (q.type === 'score') at(`${q.name}.level`, 'its level’s words'), at(`${q.name}.score`, 'the score as the model gave it')
        at(`${q.name}.you`, '“yes” when you settled it')
      }
      at('answers', 'every answer as the API gave it (JSON)')
    }
  }
  return out
}

// a block's new id, and every way to it: exits, sessions, routes and {{steps.<id>.…}} in its text. What's wrong throws
export function renameBlock(wf: Workflow, from: string, to: string) {
  if (from === 'start') throw new Error('start keeps its id')
  if (!ID.test(to)) throw new Error(`${to}? letters, digits, - _ ? (41 at most)`)
  if (to !== from && wf.blocks.some(b => b.id === to)) throw new Error(`a block is called ${to} already`)
  const sub = (s?: string) => s?.split(`steps.${from}.`).join(`steps.${to}.`)
  for (const b of wf.blocks) {
    if (b.id === from) b.id = to
    for (const k of Object.keys(b.to ?? {})) if (b.to![k] === from) b.to![k] = to
    for (const o of b.options ?? []) {
      if (o.to === from) o.to = to
      o.label = sub(o.label)!
      const br = b.kind === 'case' ? branchOf(o.label) : undefined
      if (br && br !== 'else' && br.of === from) o.label = branchLabel({ ...br, of: to }) // a branch on the block's id
    }
    if (b.max?.to === from) b.max.to = to
    if (b.session === from) b.session = to
    if (b.of === from) b.of = to
    for (const k of ['text', 'title', 'url', 'system', 'question', 'show', 'file', 'from', 'link', 'of', 'value', 'cmd'] as const) if (typeof b[k] === 'string') (b as Record<string, unknown>)[k] = sub(b[k])
    if (b.headers) b.headers = b.headers.map(h => sub(h)!)
  }
  return wf
}

// a decision's questions as the Decisions API takes them (yes/no is its noul: criteria "true" and "false")
export function apiQuestions(qs: DecideQ[]) {
  return Object.fromEntries(
    qs.map(q => {
      const crit = q.type === 'score' ? q.opts.map(o => o.text) : q.type === 'choice' ? Object.fromEntries(q.opts.map(o => [o.label, o.text || null])) : Object.fromEntries(q.opts.map(o => [o.label === 'yes' ? 'true' : 'false', o.text]))
      return [q.name, { type: q.type === 'yes/no' ? 'noul' : q.type, instructions: q.ask, ...((q.type !== 'yes/no' || q.opts.length) && { criteria: crit }) }]
    }),
  )
}
// and back (the inspector's JSON tab): what it can't read throws
export function fromApi(j: unknown): DecideQ[] {
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('an object: { "name": { "type": …, "instructions": …, "criteria": … } }')
  return Object.entries(j as Record<string, any>).map(([name, q]) => {
    const type = q?.type === 'noul' ? 'yes/no' : q?.type
    if (!(QTYPES as readonly string[]).includes(type)) throw new Error(`${name}: type noul, choice or score`)
    const text = (x: unknown) => (x == null ? '' : typeof x === 'string' ? x : JSON.stringify(x))
    const c = q.criteria
    const opts =
      type === 'score' ? (Array.isArray(c) ? c : []).map((x, i) => ({ label: String(i), text: text(x) })) : type === 'choice' ? Object.entries(c ?? {}).map(([label, x]) => ({ label, text: text(x) })) : Object.entries(c ?? {}).filter(([k]) => k === 'true' || k === 'false').map(([k, x]) => ({ label: k === 'true' ? 'yes' : 'no', text: text(x) }))
    return { name, type, ask: text(q.instructions), opts }
  })
}

// what an agent or an AI call is told when its block has out: the JSON object its answer ends with
export const outAsk = (out: string[]) => `End your answer with a JSON object (in a \`\`\`json block) with exactly these keys: ${out.join(', ')}. Each value a string, or JSON for a list or an object.`
// an agent's JSON mode (json: yes) without out:: the JSON its answer ends with
export const jsonAsk = 'End your answer with one JSON object or list (in a ```json block), the result of this step.'
// the JSON a result ends with (that ok takes): its last ```json block, else all of it, else its last {…} that parses
export function lastJson(text: string, ok: (j: unknown) => boolean = j => !!j && typeof j === 'object'): unknown {
  const t = String(text ?? '')
  const parsed = (x: string) => {
    try {
      const j = JSON.parse(x.trim())
      return ok(j) ? j : undefined
    } catch {}
  }
  let obj = [...t.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].reverse().reduce<unknown>((o, m) => o ?? parsed(m[1]), undefined) ?? parsed(t)
  const end = t.lastIndexOf('}')
  // ponytail: O(n²) on a 20k answer with many {s at worst
  for (let i = t.lastIndexOf('{', end); obj === undefined && i >= 0 && i < end; i = i ? t.lastIndexOf('{', i - 1) : -1) obj = parsed(t.slice(i, end + 1))
  return obj
}
// the out: names' values from a block's result (lastJson: an object with one of them); a string as it is, anything
// else as JSON; a name it lacks: '' (missing says which)
export function outsOf(text: string, out: string[]): { vars: Record<string, string>; missing: string[] } {
  const obj = lastJson(text, j => !!j && typeof j === 'object' && !Array.isArray(j) && out.some(k => k in j)) as Record<string, unknown> | undefined
  const vars: Record<string, string> = {}
  const missing: string[] = []
  for (const k of out) {
    const v = obj?.[k]
    if (v === undefined || v === null) missing.push(k)
    vars[k] = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  }
  return { vars, missing }
}

// a JSON template's {{name}}: inside a string, its value escaped; bare, its value as it is when that's JSON (a list an
// out: gave), else as a string. Text that isn't JSON: fill's
export function jsonFill(t: string, vars: Record<string, string | undefined>) {
  if (!/^\s*[[{]/.test(t)) return fill(t, vars)
  let out = ''
  let str = false // inside a "string"
  for (let i = 0; i < t.length; ) {
    const m = t[i] === '{' && t[i + 1] === '{' ? /^\{\{\s*([\w.?-]+)\s*\}\}/.exec(t.slice(i, i + 200)) : null
    if (m) {
      const v = vars[m[1]]
      let json = false
      if (v !== undefined && !str)
        try {
          json = v.trim() !== '' && (JSON.parse(v), true)
        } catch {}
      out += v === undefined ? m[0] : str ? JSON.stringify(v).slice(1, -1) : json ? v : JSON.stringify(v)
      i += m[0].length
      continue
    }
    if (t[i] === '"' && !/(^|[^\\])(\\\\)*\\$/.test(t.slice(Math.max(0, i - 40), i))) str = !str // not an escaped one
    out += t[i++]
  }
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
  | { kind: 'ask' | 'confirm' | 'stuck'; question: string; show?: string; options: string[]; tab?: string; used?: number } // tab, used: a stalled agent's (stuck), what its block's turn has had of its timeout
  | { kind: 'decide'; question: string; show?: string; options: string[]; key: string; rest: string[] } // an AI decision it isn't sure of: key's answer is yours, then rest's
  | { kind: 'agent'; tab: string; queued?: string; since?: number; used?: number; nudged?: number } // queued: the prompt, while it waits in the tab's queue; since: when its timeout's clock last started, used: what it had before (time it waited for you or a limit doesn't count); nudged: when Laki checked in on it, silent
  | { kind: 'run' | 'wait' }
  | { kind: 'retry'; until: number } // a bad exit's try again, at until
  | { kind: 'limit'; tab: string; until?: number }
  | { kind: 'agent-ask'; tab: string; question: string; options: string[]; ns: number[]; used?: number } // its agent asks (a permission prompt): options its menu's choices (ns: their numbers), then Stop the run
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
  tries?: Record<string, number> // each block's tries again since it was entered (retry:)
  vars: Record<string, string>
  tabs: Record<string, string> // run:<agent> and each agent block's id → its tab
  resume?: Record<string, string> // run:<agent> → its chat's id, for the next run's shared session
  turns: number
  decisions: Decision[]
  log: string[]
  started: number
  ended?: number
  shown?: Shown[] // what its Show you blocks showed, the last 20
}
export type Shown = { at: number; block: string; title: string; body: string }
export const SHOWN_MAX = 512 << 10 // a Show you's body
export type FlowView = Omit<FlowRun, 'flow' | 'log' | 'decisions' | 'vars' | 'tabs' | 'resume' | 'shown'> & { name: string; block?: string; decisions: number; last?: Decision } // the view's: the details come from flowGet
export const flowView = ({ flow, log, decisions, vars, tabs, resume, shown, ...r }: FlowRun): FlowView => {
  const b = flow.blocks.find(x => x.id === r.cur)
  const wait = r.wait && 'show' in r.wait ? { ...r.wait, show: undefined } : r.wait // an agent's whole answer: flowGet has it
  return { ...r, wait, name: flow.name, block: b && blockName(b), decisions: decisions.length, last: decisions.at(-1) }
}

// the format in words: MCP's laki_workflow_write and Laki AI's guide to writing one
export const WORKFLOW_FORMAT = `A Laki workflow is one Markdown file: a graph of blocks Laki runs for a task, in a worktree of its own (or the project's folder).

# <Name>
<one line: what it does>

runs in: worktree|main · session: new|shared · at once: 3 · turns: 30
var <NAME>: <value> (any number of these lines: its variables, {{vars.NAME}}; the user's global ones in Settings are {{vars.NAME}} too, the workflow's own win)

Then a "## <id>" per block (id: letters, digits, - _ ?). A block's first kind key sets its kind:
- ## start, with "input: task" and "next: <block>": where it begins. {{task}} is what the user asked.
- agent: <preset: claude, codex…> · model: <opus…> · effort: <high…> · session: run|new|<agent block id> · use: <an agent action's slug: laki_workflows lists them>, then the prompt as "> " lines (timeout: <minutes>, 60 unless said: then Esc and its error way). Waits for the agent's turn to end; exits next, error. One that prints nothing for 10 minutes is nudged once, then asks the user (Nudge again, Try again, Skip it, Stop the run). Its answer is {{steps.<id>.answer}}; json: yes (JSON mode) tells it to end with one JSON object or list, and its answer is that JSON (bare in a decide's state, json() in a case's JS). session run (the default): the run's tab of that agent; <block id>: the same tab as that block. use: one of the user's agent actions (Run ▾'s, in Settings or the project's: laki_actions): its prompt goes first, the block's "> " lines after it (none needed).
- run: <shell command> (in the run's folder; timeout: <minutes>). Exits ok (exit 0), fail. {{steps.<id>.output}}: its last lines.
- ask: <question>, show: <text with {{vars}}>, then options "- <label> → <block>". Waits for the user; what they type is {{answer}}.
- choice: <variable or block id> contains|matches|equals "<text>", or <variable> >=|<=|>|< <number> (if/else; "if:" is the same), then two options: the first when it holds, the second when not.
- case: <variable or block id>, then its branches in order, the first that holds wins: "- contains|matches|equals "<text>" → <block>", a branch may test another variable ("- steps.size.output equals "0" → <block>"), a number's "- steps.triage.urgent.p >= 0.8 → <block>", a JS expression's "- js: num('steps.triage.urgency') >= 2 && vars['steps.triage.team'] === 'payments' → <block>" (vars: every variable, num(name), json(name)), and "- else → <block>" last (needed). if/elsif/else, or a switch on one value. To route on what an agent found, tell it to answer with one word (only_specs, code…) and test {{steps.<id>.answer}}.
- action: ship|approve|merge|dev|archive (ship's commit message as "> " lines). ship, approve, merge and archive ask the user first unless "ask first: no". Exits ok, error.
- wait: checks: until the workspace's PR's checks pass or fail (timeout: <minutes>). Exits pass, fail.
- save: <file> in the workspace's storage folder (its Artifacts), its text as "> " lines; or "from: <a file or folder of the workspace>" copied there; or "link: <https URL, {{pr.url}}…>" kept as <file>.url. Exit ok.
- llm: <an OpenRouter model, e.g. anthropic/claude-sonnet-4.5; empty: Settings › AI's> (system: <its system prompt> · temperature: 0 to 2 · json: yes|no · timeout: <minutes>), the prompt as "> " lines: one call to OpenRouter with the key in Settings › AI, no tools, no agent. json: yes is JSON mode (its answer one JSON object; on by itself with out:). Exits ok, error. {{steps.<id>.answer}}: its answer.
- decide: <a decision model: typesafe/jev-1.13 (the default), openai/gpt-6-luna-decisions, microsoft/microsoft-decision-1, ~perplexity/pplx-decider-latest, cloudflare/clef> · sure: 0.7, the state it judges as "> " lines (JSON with {{vars}}, values escaped; none: the block before's answer or output), then "question: <name> · yes/no|choice|score · <what it asks>" lines (yes/no is the API's noul: how true), each with its lines indented under it: yes/no's "  yes: <what yes means>" and "  no: …", a choice's "  <option>: <what it means>", a score's "  - <level>" lowest first. One call to OpenRouter's Decisions API: no text, probabilities. Each answer is {{steps.<id>.<name>}} (yes or no; the option; the level's number), with .p (its probability), .confidence, .score, .level (a score's words); {{steps.<id>.answers}} all of it as JSON. Under sure (yes/no between 1-sure and sure; a choice or score less confident) it asks the user. Its ways out: "ok: <block>" and "error: <block>", then route with a case (numbers, JS); or "route: <a question's name>" and a line per answer of it: "- yes → <block>", "- no → <block>", "- <option> → <block>", "- <level number> → <block>" (and error:).
- webhook: <http(s) URL> · method: POST|PUT|PATCH|GET|DELETE (POST unless said), "header: Name: value" lines ({{env.NAME}}: Settings' or the project's env, for a secret), the body as "> " lines (JSON when it starts with { or [: values go in escaped), or "from: <a file of the workspace>" sent as it is; no body: the run's variables as JSON. Exits ok (2xx), error. {{steps.<id>.status}}, {{steps.<id>.output}}: the response.
- extension: <an extension's id: laki_extensions lists them>: fetches it now (one that's turned on; a per-workspace one for the run's workspace), waits, then its data: {{steps.<id>.data}} as JSON, and each field of it as {{steps.<id>.<field>}} (a list or an object as JSON). Exits ok, error (off, no fetch, the fetch failed).
- retry: <1 to 5> on an agent, run, llm, decide or extension block: a bad exit (fail, error) tries the block again that many times, 10 s after the first and 60 s after each later one, before it takes that way ("retry: 2 · retry on: 1, 75" on a run block: only those exit codes are tried again; unset: any but 0). An agent's next try goes to the same tab.
- out: <name>, <name>… on an agent, llm, run or webhook block: what it gives the blocks after it, {{steps.<id>.<name>}}. An agent or an llm is told to end its answer with a JSON object of them; a command's output or a webhook's response is one.
- popup: <title> (the whole line), then "notify: yes" and "phone: yes" on lines of their own if wanted, its body as "> " lines: HTML when it starts with <, else Markdown ({{vars}} filled): a window in Laki the user reads and closes (scrollable; no buttons), and a notification with notify: yes. It doesn't wait; exit next. For a run's result: "Job done", then {{steps.report.answer}}.
- end: success|stopped|failed · notify: yes · phone: yes, its notification's words as "> " lines ({{vars}}; none: the block's name). notify: a notification on the Mac (and the phone with phone: yes, when Settings › Phone pushes is set up) as the run ends there; a failed run always notifies.
A workflow has ${MAX_BLOCKS} blocks at most. Exits are lines: "next: <block>", "ok: <block>", "fail: <block>"… "max: 3 → <block>" limits a block to 3 times, then goes there: every loop needs a max or an ask in it. Other variables: {{answer}}, {{pr.url}}, {{pr.number}}, {{ws.branch}}, {{base}}, {{project}}. "at: x,y" places a block on the canvas (optional).`
