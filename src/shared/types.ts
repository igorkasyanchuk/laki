// Shapes shared by the daemon, the CLI and the renderer.
import type { Layout } from './layout.ts'
import { type Rule, stamp } from './when.ts'
import type { FlowRun, FlowView } from './workflow.ts'

// the coding agents Laki starts by name (a preset's agent; the command is the id), and what they're called
export const AGENTS = ['claude', 'codex', 'gemini', 'grok', 'opencode'] as const
export type Agent = (typeof AGENTS)[number]
export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', opencode: 'OpenCode' }
export const isAgent = (s?: string): s is Agent => (AGENTS as readonly string[]).includes(s ?? '')
// how hard an agent thinks, for those that take it (claude --effort, codex model_reasoning_effort); models: names to
// suggest (any other goes too: a full name, provider/model for opencode)
export const EFFORTS: Partial<Record<Agent, string[]>> = { claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['minimal', 'low', 'medium', 'high', 'xhigh'] }
export const MODELS: Partial<Record<Agent, string[]>> = { claude: ['fable', 'opus', 'sonnet', 'haiku'] }

// setup runs in a new worktree, teardown when one goes, run is the dev server, env goes to every tab;
// each field overrides .laki.json's (env key by key)
// expose: who Expose to the world lets in by default (emails, *@domains; empty: anyone with the link)
// actions: Run ▾'s for the project's workspaces, after the global ones (one of the same name and target replaces it);
// target any: whichever agent runs (the focused one first)
export type RunAction = { name: string; target: Agent | 'any' | 'shell'; text: string; slug?: string } // slug: unique across Settings' and every project's (actionSlug), what a workflow's use: names
// a prompt template: {{prompt}} (what's typed), {{project}}, {{base}}; settings.templates and a project's own
export type Template = { name: string; text: string }
// copy: gitignore-style patterns of files git doesn't keep (.env…) a new worktree gets from the main checkout, with .worktreeinclude's
// ports: names for the status bar's ports ({"3000": "web"})
export type ProjectConfig = { setup?: string; teardown?: string; run?: string; test?: string; lint?: string; format?: string; deploy?: string; expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; copy?: string[]; ports?: Record<string, string>; worktrees?: string; pr?: PRAllow; mergeMethod?: MergeMethod } // worktrees, pr, mergeMethod: the app's only (never .laki.json): where new ones go; what the app may do to a PR; the last merge's way
// what Laki may do to a project's PRs (its settings): approve, close and merge (each after a confirm) unless turned
// off; merge when green only when turned on
export type PRAllow = { approve?: boolean; close?: boolean; merge?: boolean; land?: boolean }
export type PRPerm = keyof PRAllow
export const prAllows = (c: ProjectConfig | undefined, act: PRPerm) => (act === 'land' ? c?.pr?.land === true : c?.pr?.[act] !== false)
export type MergeMethod = 'squash' | 'merge' | 'rebase'
export const MERGE_METHODS: MergeMethod[] = ['squash', 'merge', 'rebase']

// git: false for a plain folder (local workspaces only: no worktrees, branches, diff or PRs)
// host: an SSH host (a ~/.ssh/config name or user@host): the folder is there, and so are git, gh and its tabs' programs
export type Project = {
  id: string
  name: string
  path: string
  git?: boolean
  host?: string
  config?: ProjectConfig
  seps?: Sep[] // the sidebar's named lines between its workspaces
  rows?: string[] // with seps: its workspaces' and seps' ids in the sidebar's order (others after them)
  notes?: string // Project notes: the user's Markdown (links, how-tos), its ⋯ menu's Notes and Settings; never agents'
  kind?: 'shells' | 'browsers' // the sidebar's Terminals (shells) or Browsers (quickNew): your home folder, a workspace per terminal or page
  sort?: WsSort // its workspaces' order in the sidebar (unset: manual, as dragged); a group's own wins
  memory?: Memory[] // the project page's Memory, newest last: the user's (MEMORY_MAX) and what agents learned (auto, MEMORY_MAX); claude and codex get both at every start
  compacted?: CompactRun // its learned memories' last compaction (daemon/memory.ts): when, how many before and after, why, or what failed
  plans?: string // its specs' and brainstorms' folder (daemon/plans.ts), made with the first one
}
// each mark unset: on; at: where a row shows them (unset: start, by the status circle)
export type PRMarks = { approved?: boolean; mine?: boolean; commented?: boolean; at?: 'start' | 'name' | 'end' }
export type Memory = { id: string; text: string; at: number; edited?: number; auto?: boolean; by?: string } // at: when it was added; auto: an agent's (auto-memory), else the user's; by: who (an agent, its workspace)
export const MEMORY_MAX = 50 // each kind's: the user's (refused past it), agents' (the oldest goes)
export const MEMORY_AUTO_LEN = 600 // an agent's memory: the gist, in a line or two
// a compaction of a project's learned memories (daemon/memory.ts): why (you: Compact now; days: its every N days; full:
// MEMORY_MAX reached), how many before and after; the log (memoryCompactLog) keeps each one's texts too
export type CompactRun = { at: number; why: 'you' | 'days' | 'full'; ok: boolean; before: number; after: number; ms?: number; error?: string }
export type CompactLogLine = CompactRun & { project: string; was?: string[]; now?: string[] }
export const COMPACT_DAYS = 7 // settings.memoryCompact.days unset
export type Sep = { id: string; name: string; color?: string; template?: string; sort?: WsSort } // color: TAB_COLORS' name, its label's tint; template: a prompt template's name, the one a new workspace under it starts with; sort: its workspaces' (unset: the project's)
// the sidebar's order of a project's workspaces, or a group's: as dragged, newest first, last active first, by name
export const WS_SORTS = ['manual', 'created', 'activity', 'name'] as const
export type WsSort = (typeof WS_SORTS)[number]
// a project's sidebar rows: its workspaces (of ws) with its seps between them, in the order dragged (rows; others
// after, seps first); the app's sidebar and the daemon's placeWs
export const rowsOf = <W extends { id: string; project: string }>(p: Pick<Project, 'id' | 'seps' | 'rows'>, ws: W[]): (W | Sep)[] => {
  const at = new Map((p.rows ?? []).map((id, i) => [id, i]))
  const end = at.size
  return [...(p.seps ?? []), ...ws.filter(w => w.project === p.id)].sort((a, b) => (at.get(a.id) ?? end) - (at.get(b.id) ?? end)) // stable
}
// a folder over SSH, as scp writes it: host:path (the host never an option, -…)
export const REMOTE = /^([A-Za-z0-9_][\w.@-]*):(.+)$/

export type Workspace = {
  id: string
  project: string
  path: string
  host?: string // its project's SSH host: path is there
  branch: string
  base: string
  kind: 'worktree' | 'local'
  port: number
  created: number
  archived?: boolean
  archivedAt?: number // when (ms), for settings.archivedDays
  color?: string // its sidebar color's name
  name?: string // shown instead of the id (which names the worktree and branch)
  schedule?: string // the scheduled task that made it (its clock in the sidebar)
  muted?: boolean // no notifications from its tabs
  pinned?: boolean // the sidebar shows it above the projects, under Pinned
  railPin?: number // on the rail, after a line, for a quick click (RAIL_PINS at most): when it was pinned, their order
  autoFix?: boolean // failing CI goes to the agent
  autoReview?: boolean // new PR review comments go to the agent
  autoMerge?: boolean // merge conflicts with the PR's base go to the agent
  autoLand?: boolean // merge when green: Laki merges the PR (its project's last way) once all checks pass, no conflicts, not a draft, approved if it must be
  fix?: PRFix // what autoFix/autoReview/autoMerge/autoLand did already
  race?: string // one prompt fanned out to several agents: the workspaces of one race share it (Compare)
  issue?: { number: number; url: string; title: string } // the GitHub issue it was started from (laki new --issue)
  prUrl?: string // its primary PR, by URL (a fork's, another repo's): laki new --pr's, a prompt's, one attached or its agent named; else its branch's
  prLinked?: boolean // prUrl isn't its branch's (a prompt's, one attached): no auto switches (fix and push)
  prSaid?: boolean // prUrl a guess, a PR its prompt or its agent (prFromSaid) named, not one attached or asked for (--link): a worktree's branch's own PR, once pushed, replaces it
  related?: string[] // GitHub PRs and issues it's about, not its primary: its prompt's (a session an agent started), a primary its own PR replaced, one you moved off
  from?: string // the workspace whose agent started it (laki new ., /laki:new, MCP): its prompt's PRs are only related
  autoArchived?: number // the merged PR it was archived for (settings.archiveMerged): once, so an Undo stays
  fork?: boolean // a fork's PR (or a fork of one): its .laki.json isn't read, the repo's is
  browser?: string // a Browsers workspace: the page it's on (the app shows it instead of terminals)
  storage?: string // its tabs' $LAKI_STORAGE_FOLDER (storageOf: made at its first tab, removed with it unless settings.keepStorage)
  flow?: string // the workflow run that made it (its mark in the sidebar)
}

// for one PR: the commit whose failing CI was sent, how many times in a row, the review threads sent; the commit whose
// merge conflicts were sent, how many times in a row
export type PRFix = { pr: number; ci?: string; tries?: number; review?: string; mine?: string[]; merge?: string; merges?: number; land?: string } // mine: the agent's comments (it comments as you); land: the head commit merge when green tried
export type FixWhat = 'ci' | 'review' | 'conflict'

// what fix CI, review and fix conflicts (and the info panel's send buttons) tell the agent; settings.prPrompts
// replaces any of them. {{pr}}: the PR's number, {{url}}: its link, {{base}}: its base branch. The failing checks
// (with the end of their logs) or the open review threads go after it.
export const PR_PROMPTS: Record<FixWhat, string> = {
  ci: 'CI fails on PR #{{pr}} ({{url}}). Find the cause and fix it, run what you can locally, then commit and push the fix, then say what you changed.',
  review:
    "Address the open review comments on PR #{{pr}} ({{url}}). Fix what you agree with; then commit and push the fix, then say what you changed, and what you didn't and why. Answer here, not on GitHub.",
  conflict:
    'PR #{{pr}} ({{url}}) has merge conflicts with {{base}}. Merge it in (git fetch origin {{base}}, then git merge origin/{{base}}; no rebase, no force push), resolve the conflicts keeping what both sides meant, run what you can locally, then commit and push the merge, then say what you changed.',
}
// the first GitHub PR a prompt names ("review https://github.com/o/r/pull/12"): the new workspace is named after it
// and linked to it
export const prIn = (text = '') => /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0]
// every GitHub PR and issue a text names, each once (any case: GitHub's names are), as first written: a workspace's related
export const refsIn = (text = '') => {
  const seen = new Map<string, string>()
  for (const [u] of text.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+/g)) if (!seen.has(u.toLowerCase())) seen.set(u.toLowerCase(), u)
  return [...seen.values()]
}

// {{name}} (spaces inside allowed) as vars say; an unknown one stays as it is (not {{constructor}}): prompt templates', PR_PROMPTS'.
// The template's dates ({{DD-MM-YY HH:MM}}, when.ts' stamp) are now's; what vars bring in (a typed prompt) isn't stamped
export const fillTemplate = (text: string, vars: Record<string, string | undefined>, at = Date.now()) => fillVars(stamp(text, at), vars)
// {{name}} and {{ws.branch}}-style names as vars say, nothing else: no dates (a typed prompt's {{DD}} stays)
export const fillVars = (text: string, vars: Record<string, string | undefined>) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? (vars[k] ?? m) : m))
// agent variables (Maestro's {{AGENT_PATH}}…, Laki's lowercase like {{prompt}}): what an action (Run ▾), a prompt
// template, a scheduled prompt and a workflow are filled with as they reach a workspace's agent or terminal (the daemon,
// asked with vars: a message you type is left as it is); one without a value (no PR yet) stays. Settings' chips list them
export const AGENT_VARS: [string, string][] = [
  ['{{workspace}}', "the workspace's name"],
  ['{{branch}}', "the workspace's branch"],
  ['{{path}}', "the workspace's folder (its worktree)"],
  ['{{port}}', "the workspace's $PORT"],
  ['{{pr}}', "the workspace's PR (its link)"],
  ['{{project}}', "the project's name"],
  ['{{base}}', 'the base branch'],
  ['{{storage}}', "the workspace's storage folder ($LAKI_STORAGE_FOLDER)"],
  ['{{tab}}', 'the tab it goes to (its name)'],
  ['{{agent}}', 'the agent there: claude, codex…'],
  ['{{date}}', 'today: YYYY-MM-DD'],
  ['{{time}}', 'now: HH:MM'],
]
export function agentVars(w: { id: string; name?: string; path: string; branch?: string; base?: string; port?: number; storage?: string }, o: { project?: string; pr?: string; tab?: { name: string; preset?: string } } = {}, at = Date.now()): Record<string, string | undefined> {
  return {
    workspace: w.name || w.id,
    branch: w.branch || undefined,
    path: w.path,
    port: w.port ? String(w.port) : undefined,
    pr: o.pr,
    project: o.project,
    base: w.base || undefined,
    storage: w.storage,
    tab: o.tab?.name,
    agent: o.tab?.preset,
    date: stamp('{{YYYY-MM-DD}}', at),
    time: stamp('{{HH:mm}}', at),
  }
}
// a project's templates first, then the global ones it doesn't replace (one of the same name)
export const templatesFor = (global: Template[] = [], project: Template[] = []) => [...project, ...global.filter(g => !project.some(t => t.name.trim() === g.name.trim()))]
// a PR as the new-workspace page has it: the PR field (#123 or its URL), else a PR's URL in the prompt, else a prompt
// that is only #123 or 123
export function prRef(field = '', prompt = '') {
  const ref = (s: string) => /^https?:\/\//.test(s) ? s : /^#?\d+$/.test(s) ? `#${s.replace('#', '')}` : undefined
  return ref(field.trim()) ?? prIn(prompt) ?? ref(prompt.trim())
}
// the prompt through a template; one without {{prompt}} gets the typed text after it, unless that text is only the
// PR its {{pr}} took
export function templated(t: Template | undefined, prompt: string, vars: Record<string, string | undefined> = {}) {
  if (!t) return prompt
  const text = fillTemplate(t.text, { ...vars, prompt })
  const uses = (k: string) => new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`).test(t.text)
  const taken = uses('pr') && !!vars.pr && [vars.pr, vars.pr.replace('#', '')].includes(prompt.trim())
  return uses('prompt') || !prompt.trim() || taken ? text : `${text}\n\n${prompt}`
}
// an action's slug: its own (typed) or its name's, lowercase words and dashes, 40 at most; -2, -3… past one taken
export function actionSlug(want: string, taken: Set<string> = new Set()) {
  const base = want.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'action'
  let s = base
  for (let n = 2; taken.has(s); n++) s = `${base.slice(0, 40 - String(n).length - 1)}-${n}`
  taken.add(s)
  return s
}
// the action a workflow's use: names, by its slug, else its name (any case); the merged list first, then the global
// ones a project's replaced
export function findAction(global: RunAction[] = [], project: RunAction[] = [], use?: string) {
  const u = use?.trim()
  if (!u) return undefined
  const all = [...mergeActions(global, project), ...mergeActions(global)] // unfinished ones (no name or text) aren't actions
  return all.find(a => a.slug === u) ?? all.find(a => a.name.trim().toLowerCase() === u.toLowerCase())
}
// the global actions and a project's together: a project's one with a global one's name and target replaces it
export function mergeActions(global: RunAction[] = [], project: RunAction[] = []) {
  const same = (a: RunAction, b: RunAction) => a.target === b.target && (a.name ?? '').trim() === (b.name ?? '').trim() // a hand-edited one may lack a name
  return [...global.filter(g => !project.some(p => same(p, g))), ...project].filter(a => a.name?.trim() && a.text?.trim())
}
// a webhook's URL as pushes take it (push.ts; Settings says why not as you type)
export function webhookUrl(url?: string) {
  let u: URL
  try {
    u = new URL(String(url ?? '').trim())
  } catch {
    throw new Error('the webhook needs a URL')
  }
  // what's pushed holds the agent's question: plain http only to this Mac (a relay of yours, tests' server)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) throw new Error('the webhook URL must start with https://')
  return u.href
}

export const PR_SCAN = 1 // minutes between PR checks (settings.prScan)
export const PR_TRIES = 3 // failing CI or conflicts go to the agent this many times in a row (settings.prTries), then over to you

export type TabKind = 'agent' | 'shell' | 'setup' | 'dev' | 'ship' | 'script' // script: Run ▾'s test, lint, format or deploy (its name)
// the project's scripts Run ▾ starts besides run, each in a tab of its own (named as it), set like run (the project's
// settings, .laki.json)
export const RUN_SCRIPTS = ['test', 'lint', 'format', 'deploy'] as const
// laki screen's ops on what isn't a web page (daemon/device.ts): a screenshot of the iOS Simulator or an app's window,
// the windows open, and the simulator's hands through idb
export const DEVICE_OPS = ['shot', 'windows', 'tap', 'swipe', 'type', 'describe'] as const
export type RunScript = (typeof RUN_SCRIPTS)[number]
// Enter (or the tab menu's Restart) in its ended tab starts it again: an agent, the run tab, a script; a deploy only
// through Run ▾, which asks (core's input, App's tab menu)
export const againOnEnter = (t: { kind: TabKind; script?: RunScript }) => t.kind === 'agent' || t.kind === 'dev' || (t.kind === 'script' && t.script !== 'deploy')

export type Tab = {
  id: string
  workspace: string
  name: string
  flow?: string // the workflow run that last sent it a block's prompt (the status bar links to it)
  kind: TabKind
  preset?: string // an Agent or custom: what the agent is (hooks, resume)
  profile?: string // the preset (Settings) it started from: its args and env
  cmd?: string // custom command
  resumeId?: string // the agent's chat: claude session_id, codex thread-id, gemini/opencode session, grok's (Laki picks it)
  forkOf?: string // claude session to fork on first start
  queue?: string[] // follow-ups for when the agent is idle
  color?: string // a tab color's name (red, blue, …); 'none' turns the agent's default off
  muted?: boolean // no notifications from it
  model?: string // the agent's --model (unset: its own default), kept for restarts
  effort?: string // and its effort (EFFORTS)
  account?: string // the account it started on (claude, codex: an Account's id or HOME_ACCOUNT), kept for restarts and resumes
  again?: { cwd?: string; cmd?: string; run?: boolean } // what a shell ran as the daemon stopped (keepShells), back at its next start; a Run tab's: start it again
  titled?: boolean // its name says what it's for (given, renamed, or its first prompt's words): no prompt renames it
  script?: RunScript // a script tab's (kind script): which RUN_SCRIPTS one, whatever it's named
}

// a few words of what a prompt asks, for a tab's name: its first line less links (a GitHub PR's or issue's is #n), flags,
// Markdown, a leading "please" and a trailing "the"; a path is its file's name; "" when nothing's left
export function taskTitle(prompt: string, words = 6) {
  let s = (prompt.split('\n').find(l => l.trim()) ?? '')
    .replace(/https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/(?:pull|issues)\/(\d+)\S*/g, '#$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\s)(?:[~.]{0,2}\/(?:[^\s/]+\/)+|(?:[^\s/]+\/){2,})([^\s/]*)/g, '$1$2') // a path: two parts at least (a /command, and/or stay)
    .replace(/(^|\s)--?[a-z][\w-]*(=\S*)?/gi, '$1')
    .replace(/[*_`>[\]()"{}]+|#(?!\d)/g, ' ')
    .trim()
  for (let was = ''; was !== s; ) {
    was = s
    s = s.replace(/^(please|pls|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|let's|lets|now|ok|okay|hey|hi|so|then|and)\b[\s,:;!.-]*/i, '')
  }
  const w = s.split(/\s+/).filter(Boolean).slice(0, words)
  while (w.length > 1 && /^(the|a|an|to|of|in|on|for|and|or|with|at|from|that|this|is|by|as)$/i.test(w.at(-1)!.replace(/[,.;:!?-]+$/, ''))) w.pop()
  const t = w.join(' ').replace(/[\s,.;:!?-]+$/, '')
  const c = [...t] // by code point: an emoji stays whole
  return c.length > 36 ? `${c.slice(0, 35).join('').trimEnd()}…` : t
}

// how an agent starts: one of AGENTS with extra args, or any command; env on top of the project's
// off: switched off in Settings: out of the pickers (new tab, new workspace, races, scheduled tasks); its tabs still start
// a profile (Settings › Agents & profiles; the code's word is preset): how an agent starts. laki: false: no note about
// Laki at its starts (unset: told); model, effort: its tabs' unless a workspace picks its own; account: an Account's id
// or HOME_ACCOUNT (unset: the agent's default, settings.accountUse)
export type Preset = { name: string; agent: Agent | 'command'; args?: string; cmd?: string; env?: Record<string, string>; off?: boolean; laki?: boolean; model?: string; effort?: string; account?: string }

// another sign-in of claude or codex: a config folder of its own (CLAUDE_CONFIG_DIR, CODEX_HOME) that Laki made, its
// settings, skills and chats shared with the agent's own (links), its sign-in not
export type AccountAgent = 'claude' | 'codex'
export const ACCOUNT_AGENTS: AccountAgent[] = ['claude', 'codex']
export const isAccountAgent = (a?: string): a is AccountAgent => a === 'claude' || a === 'codex'
export type Account = { id: string; agent: AccountAgent; name: string; dir: string }
// the agent's own sign-in (~/.claude, ~/.codex): an account with no folder of Laki's
export const HOME_ACCOUNT = 'home'
// who an account signs in as (accounts): its email and plan, read from its folder; signedIn: it has a sign-in
export type AccountView = { id: string; agent: AccountAgent; name: string; dir: string; email?: string; plan?: string; signedIn: boolean; default: boolean }

// what a notification is about: an agent waiting for you, done with its turn, at a usage limit
export type NotifyKind = 'waiting' | 'done' | 'limit'

// the app's settings (⌘,): editor is an app id (cursor, zed, …, see APPS) or 'custom' (editorCmd + the path)
export type Settings = {
  editor?: string
  editorCmd?: string
  agent?: string // the preset new workspaces start
  branchPrefix?: string
  fontSize?: number
  fontFamily?: string
  copyOnSelect?: boolean
  editKeys?: boolean // the terminal's ⌘← ⌘→ ⌘⌫ ⌥← ⌥→ as macOS editors have them (unset: on)
  notify?: boolean
  prIcon?: boolean // the sidebar marks a workspace with a PR (unset: on)
  ownAvatar?: boolean // that mark on your own PR has your GitHub picture (unset: on; off: GitHub's mark alone)
  prMarks?: PRMarks // the sidebar's ✓ (approved), ✓✓ (by you too) and 👀 (you commented) on an open PR
  notifyOn?: Partial<Record<NotifyKind, boolean>> // which turns notify (unset: all)
  notifySound?: string // a macOS sound's name (Glass, Ping…), 'none', or unset: the default
  timerAlert?: 'dialog' | 'notification' // what a sidebar timer's end shows (unset: Laki's dialog)
  timerSound?: string // a macOS sound or 'none' as a timer ends (unset: Glass)
  presets?: Preset[] | null // null: the defaults
  accounts?: Account[] // claude's and codex's other sign-ins (the agent's own is HOME_ACCOUNT)
  accountUse?: Partial<Record<AccountAgent, string>> // each agent's default account for new sessions (unset: HOME_ACCOUNT)
  theme?: string
  glass?: boolean // a see-through, blurred window
  glassWindow?: number // how see-through glass makes the window, the sidebar, the terminals: %
  glassSide?: number
  glassTerm?: number
  glassGlow?: boolean // the theme's colors behind the glass (unset: on)
  sideClear?: number // without glass: how see-through the sidebar and the rail are, the rest solid: % (unset: 0)
  uiFont?: string // the interface's font
  accent?: string // #rrggbb over the theme's accent (unset: the theme's)
  radius?: string // corners, a CSS length over the theme's (unset: the theme's)
  templates?: Template[] // prompt templates ({{prompt}}…), for new workspaces; a project's own come first
  actions?: RunAction[] // Run ▾'s: a prompt for an agent, or a command for a terminal
  env?: Record<string, string> // every session's, under the project's and the preset's
  tunnelMails?: string[] // who the last tunnel let in (Expose to the world)
  usage?: Record<string, boolean> // claude, codex: the status bar shows its plan's limits (unset: on)
  specs?: boolean // experimental (Settings › General): Specs & Brainstorms, off unless true
  workflows?: boolean // experimental (Settings › General): Workflows, off unless true
  birdView?: boolean // experimental (Settings › General): the eye beside Help, every live session's screen at once, off unless true
  calendar?: boolean // experimental (Settings › General): the rail's Calendar, scheduled tasks and reminders by week or month, off unless true
  desk?: boolean // experimental (Settings › General): the rail's Desk, extensions placed there as tiles, off unless true
  deskTiles?: DeskTile[] // the Desk's tiles in order, each one's size and tab (an extension placed there without one: last, DESK_TILE, the first tab)
  deskTabs?: DeskTab[] // the Desk's tabs in order (none: one, Desk)
  aiGlow?: boolean // experimental (Settings › General): a glow over what Laki AI looks at (a tab's pane, else the window), off unless true
  planTemplates?: PlanTemplate[] // the Specs page's Templates (unset: PLAN_TEMPLATES, shared/plans.ts)
  remoteMail?: string // the one email remote access lets in
  remoteAuth?: 'email' | 'pin' | 'tailscale' // how remote access lets you in: email (unset too), Cloudflare's code; pin, Laki's own PIN (no email); tailscale, your tailnet (tailscale serve)
  remoteTries?: number // pin: wrong PINs that stop remote access (unset: REMOTE_TRIES)
  timers?: boolean // how long each turn has been going, on its tab and row (unset: off)
  projectLook?: ProjectLook // the sidebar's project names, over the theme's
  sideLook?: SideLook // the sidebar's lines, rows and button labels, over the theme's
  diffStat?: boolean // each workspace's +/- in the sidebar, scanned every 10 s (unset: off; a race's are always)
  dimPanes?: boolean // a split's other panes dimmed (unset: off)
  termPad?: 'tiny' | 'normal' | 'roomy' // Settings › Terminal › Padding: the space around a terminal's text (unset: normal)
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (unset: off)
  splitNew?: boolean // a new tab opens as a split beside the pane you're on, not a tab of its own (layoutPlace)
  closeNoAsk?: boolean // closing a tab whose process still runs doesn't ask first (unset: it asks)
  pageZoom?: number // Settings and Help's size (0.9–1.5, renderer's PAGE_ZOOMS; unset: 1)
  storageDir?: string // where workspaces' storage folders go (unset: <data>/storage; ~ is home)
  keepStorage?: boolean // a deleted workspace's storage folder stays (unset: removed with it)
  worktrees?: string // where new worktrees go: <it>/<project>/<workspace> (unset: <data>/worktrees; a project's own folder wins)
  syncBase?: '' | 'origin' | 'ff' // a new worktree's base fetched from origin first: origin, start off origin's copy (your branch untouched); ff, your branch fast-forwarded to it when it can be, else origin's (unset or '': off, the local branch as it is)
  tabsAt?: 'top' | 'bottom' | 'left' | 'right' // where the tabs are (unset: top)
  prPrompts?: Partial<Record<FixWhat, string>> // over PR_PROMPTS (unset or blank: the default)
  prScan?: number // minutes between PR checks (unset: PR_SCAN)
  bgRefresh?: boolean // PR checks on their own (each prScan minutes, a turn's end); off: only Refresh PR status (unset: on)
  copyIgnored?: boolean // a new worktree gets every file git ignores from the main checkout, not only .worktreeinclude's (unset: off)
  copyUntracked?: boolean // and the untracked ones (unset: off)
  archivedDays?: number // archived workspaces deleted after this many days, their branch kept (unset or 0: never)
  prTries?: number // fix CI's and fix conflicts' tries in a row (unset: PR_TRIES)
  sleepAfter?: number // minutes an idle claude or codex nobody looks at keeps its process (unset: SLEEP_AFTER; 0: always)
  webhook?: Webhook // pushes to your phone
  archiveMerged?: boolean // a workspace whose PR merged is archived when clean, with Undo (unset: off)
  menuBar?: boolean // the menu bar's item: the needs-you count and those tabs (unset: on)
  floater?: boolean // the floating bubbles over other apps: agents working or waiting (unset: on)
  floaterStyle?: 'glow' | 'gradient' | 'arc' | 'bricks' | 'comet' | 'wave' | 'still' // how a working agent's bubble looks (unset: gradient)
  floaterRecent?: number // the bubbles' agents used last, idle or done, after the ones at work: 0-5 (unset: 3)
  floaterRecentHours?: number // a recent one drops out after this many hours idle; 0: never (unset: 4)
  floaterVoiceTo?: 'pick' | 'new' // the voice prompt goes to: an agent you pick each time, or always a new session (unset: pick)
  floaterMax?: number // the bubbles at most (unset: 12)
  floaterCards?: boolean // a bubble's card on hover (unset: on)
  floaterDone?: boolean // a finished agent you haven't seen: a green, pulsing bubble until a click or a look (unset: on)
  floaterNew?: boolean // the bubbles' +: New task, Say it, Screenshot area, Whole screen (unset: on)
  floaterMenu?: 'stack' | 'card' // the +'s actions: stacked in the drop over it, or a menu beside it (unset: stack)
  dockIcon?: string // the Dock's icon while Laki runs: laki, dawn, terminal, glacier, bubbles, neon (unset: the app's own, laki)
  fun?: boolean // the sidebar foot's smiley (Meme): a meme for a break (unset: on)
  widgetDirs?: string[] // folders of widgets (or a widget's own), besides <data>/widgets (daemon/widgets.ts)
  widgetDev?: string[] // laki widget dev's folders: your own code, scanned first and watched
  railLabels?: boolean // the rail layout's words under its icons; off: icons only, a narrower rail (unset: on)
  railShells?: boolean // the rail's Terminal button; off: Terminals is a project in Projects' list (unset: on)
  railBrowsers?: boolean // the rail's Browser button; off: Browsers is a project in Projects' list (unset: on)
  imageDays?: number // pasted images kept this many days (unset: IMAGE_DAYS)
  artifactsIn?: 'app' | 'browser' // an HTML or Markdown artifact opens in the app's viewer or the default browser (unset: app)
  memory?: Memory[] // Settings › Global memory: the user's own rules (MEMORY_MAX, never auto) for claude and codex in every project, with its memory
  memoryCompact?: { off?: boolean; days?: number } // agents' learned memories compacted by Laki AI every days (unset: COMPACT_DAYS) and as they reach MEMORY_MAX; off: only Compact now
  flowVars?: Record<string, string> // workflows' global variables, {{vars.NAME}} in every one (a workflow's own var lines win)
  sideStyle?: SideStyle // the sidebar's rows: a line, the marks, a second line, cards with the agent's last answer (unset: default)
  progress?: boolean // LAKI_PROGRESS=1 in agents' env: with the laki skill, they report how far along their task is (unset: off)
  progressAt?: 'tab' | 'sidebar' | 'both' // where that percent shows (unset: tab)
  progressLook?: 'pct' | 'bar' | 'both' // in the sidebar: the percent, a filling line, or both (unset: pct)
  railPlans?: PlanPin[] // specs and brainstorms pinned to the rail (RAIL_PINS at most), oldest first
  pickerKey?: string // development mode's element picker: its hotkey as ui.tsx' keyLabel writes it (unset: PICKER_KEY; '': none)
  hotkeyOn?: boolean // the global hotkey: Laki forward from any app (main's globalShortcut; unset: on)
  hotkey?: string // its keys as keyLabel writes them (unset: ui.tsx HOTKEY; '': none)
  devMode?: boolean // an event log per workspace and widget (⋯ › Logs, Settings › Widgets), in the daemon's memory (unset: off)
  widgetAgent?: string // Settings › Extensions' agent: the claude or codex preset an AI source runs (unset: the first claude one)
  widgetHours?: string // when widgets fetch on their own, in English (when.ts parseHours: 9am-9pm weekdays; unset: always)
  ai?: AiSettings // Laki's own AI (Settings › AI, the AI page)
  voice?: VoiceSettings // Settings › Voice: how the mic and hold Fn turn speech into text
}

// Settings › Voice: engine device, macOS dictation (the mic starts it; Fn Fn is macOS's own); cloud, Laki records and
// OpenRouter's speech-to-text (daemon/ai.ts voiceText, the AI key) writes it down. model: an OpenRouter speech-to-text
// model's id (unset: VOICE_MODEL). fn: cloud only, hold Fn to talk anywhere in Laki, let go to insert (unset: on)
// on: experimental (Settings › General), off unless true: the mic is macOS dictation, no Voice section, no hold Fn
export type VoiceSettings = { on?: boolean; engine?: 'device' | 'cloud'; model?: string; fn?: boolean }
export const VOICE_MODEL = 'microsoft/mai-transcribe-2'

// Laki's own AI (daemon/ai.ts): optional (on), it works Laki through the MCP server's tools, only when asked. backend:
// OpenRouter (its key in <data>/ai-key, never here) or a CLI agent in the background (claude -p, codex exec); models:
// each backend's (unset: AI_MODEL for OpenRouter, the agent's own for the others); steps: tool calls an ask may make
export type AiBackend = 'openrouter' | 'claude' | 'codex'
// preset: an agent preset of the backend's agent (claude, codex), its env for an account of its own
// skill: Laki's skill for it (unset: on): more tools (PRs, projects' notes and memory, tabs and shells, actions, templates) and
// asking you with options; hideCost: no $ on the AI page
export type AiSettings = { on?: boolean; backend?: AiBackend; preset?: string; models?: Partial<Record<AiBackend, string>>; efforts?: Partial<Record<'claude' | 'codex', string>>; steps?: number; skill?: boolean; hideCost?: boolean; context?: string; float?: boolean } // efforts: claude -p's --effort, codex's model_reasoning_effort (EFFORTS; unset: theirs); context: the user's own instructions, after the system prompt; float: the chat button in the corner (unset: on)
export const AI_MODEL = 'anthropic/claude-sonnet-5.5'
export const AI_STEPS = 20
export const AI_CONTEXT_MAX = 8000 // Your instructions' characters
// the AI page's conversation: what you asked (images: their paths), its answers, each tool it ran, a failure
export type AiMsg = { role: 'user' | 'ai' | 'tool' | 'error'; text: string; at: number; images?: string[]; ask?: AiAsk }
// a question Laki AI asked (laki_ask, or before a removal): its options as buttons, picked: the answer given. act: what a
// Yes removes: only the user's click does it (the daemon's aiAnswer), never the AI itself
export type AiAsk = { id: string; options: string[]; picked?: string; act?: AiAct }
export const AI_ACTS = ['memory', 'schedule', 'tab', 'todo'] as const
export type AiAct = { kind: (typeof AI_ACTS)[number]; id: string; project?: string; label: string }
// one ask's cost, in <data>/ai-calls.jsonl: tokens in and out, USD (OpenRouter's; claude -p's is Claude Code's own
// estimate; codex: none), the tool calls it made (settings' steps: rounds of them)
export type AiCall = { at: number; backend: AiBackend; model: string; in: number; out: number; cost?: number; ms: number; tools: number; ok: boolean; ask: string; error?: string }
export type AiTotals = { today: AiSum; month: AiSum }
export type AiSum = { calls: number; in: number; out: number; cost: number }
// today's and this month's calls, on this Mac's clock
export function aiTotals(calls: AiCall[], now = new Date()): AiTotals {
  const sum = (from: number): AiSum =>
    calls.filter(c => c.at >= from).reduce((s, c) => ({ calls: s.calls + 1, in: s.in + (c.in || 0), out: s.out + (c.out || 0), cost: s.cost + (c.cost || 0) }), { calls: 0, in: 0, out: 0, cost: 0 })
  return { today: sum(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()), month: sum(new Date(now.getFullYear(), now.getMonth(), 1).getTime()) }
}

// Settings › Phone pushes: where a waiting (unset: on) or done (unset: off) agent is pushed, in which format
// answer: Answer from the phone (Telegram's and ntfy's buttons; off: the choices as text only); replyTopic: the random
// part of ntfy's reply topic (<topic>-<it>), made as answer turns on
export type Webhook = { url?: string; format?: 'ntfy' | 'slack' | 'telegram' | 'json'; waiting?: boolean; done?: boolean; answer?: boolean; replyTopic?: string }

// how the sidebar writes project names (Settings › Appearance); 'theme' (or unset): as the theme does
export type ProjectLook = { font?: 'theme' | 'ui' | 'mono'; case?: 'theme' | 'upper' | 'none'; spacing?: string; size?: string; weight?: string }
// the sidebar's lines and rows (Settings › Appearance) as CSS values, 'theme' (or unset): as the theme draws them;
// labels: words beside its bottom buttons (unset: shown)
export type SideStyle = 'compact' | 'default' | 'extended' | 'cards' | 'status' // Settings.tsx SIDE_STYLES
// development mode's event log (core.ts devLog): n, how many times a line came again
export type LogLine = { at: number; text: string; n?: number }
export type SideLook = { guide?: string; divider?: string; indent?: string; rows?: string; text?: string; icons?: string; labels?: boolean }

// a task waiting on the board (Board.tsx) for a workspace: a prompt for a project
export type Todo = { id: string; project: string; text: string; at: number; images?: string[] } // images: pasted ones (<data>/images), their paths after the text as it starts
// a follow-up on the calendar (Calendar, experimental): a note for a moment, from you, Laki AI or an agent (by), maybe about a
// workspace or a project; it rings once as it's due (fired) while the app is open, done: ticked off
export type Reminder = { id: string; at: number; text: string; made: number; ws?: string; project?: string; by?: string; done?: boolean; fired?: boolean }
export const REMINDERS_MAX = 500 // past it the oldest rung ones go
// a tile on the Desk (experimental): an extension's id and its size in the Desk's grid (DESK_COLS across, rows of DESK_ROW px)
export type DeskTile = { id: string; w: number; h: number; tab?: string } // tab: a DeskTab's id (none, or one gone: the first tab)
// a tab of the Desk: its tiles apart from the others' (none set: one tab, Desk)
export type DeskTab = { id: string; name: string }
export const DESK_COLS = 12
export const DESK_ROW = 40
export const DESK_TILE: Omit<DeskTile, 'id'> = { w: 4, h: 6 }

// remote access (core.ts): who may open it, until when (ms; none: until stopped), and once cloudflared has one, its URL and the link
// with the token
// open: no email (mail ''), anyone with the link; pin: Laki's PIN instead of an email (shown here, typed on the page),
// tries: wrong ones left before it stops
export type Remote = { mail: string; open?: boolean; pin?: string; tries?: number; until?: number; url?: string; link?: string; via?: 'tailscale' } // via tailscale: tailscale serve, the tailnet's devices only
export const REMOTE_TRIES = 2
export const SLEEP_AFTER = 480 // minutes: an idle agent sleeps after 8 hours unless Settings › Resources says otherwise
export const IMAGE_DAYS = 30 // days a pasted image is kept (<data>/images: Laki AI's chats, prompts) unless Settings › AI says otherwise
// an earlier chat of the AI page's (New chat keeps the one it ends): its file's name, its first ask, its last message, its messages
export type AiPast = { id: string; title: string; at: number; n: number }

// a plan's limit (daemon/usage.ts): used %, when it resets (ms); note: what the % is of, for an amount (extra usage)
export type UsageWindow = { label: string; used: number; resets?: number; note?: string }
// an agent's limits; error: why there are none (signed out…); at: when they were read
// account: whose (an Account's id or HOME_ACCOUNT), name to tell them apart, default: the one new sessions use
export type AgentUsage = { agent: string; plan?: string; windows: UsageWindow[]; error?: string; at: number; account?: string; name?: string; default?: boolean }

// a scheduled task: at the times `when` says (rule: what it said when saved, shared/when.ts), its prompt goes to an
// agent (a preset's name): in a new workspace each time (ws 'new': a worktree), in the project's own folder (ws 'local':
// no worktree, one session; 'local-new': a new session, a sidebar row, each run), or in that workspace (its running agent of the preset, queued while it works; else a new tab). next:
// when it runs (none: off, or a once that ran)
export type Schedule = { id: string; name?: string; project: string; preset: string; ws: string; prompt: string; when: string; rule: Rule; on: boolean; next?: number; last?: number; workflow?: string; source?: 'yours' | 'project'; widget?: string; action?: string } // workflow: a run of that workflow (Workflows on) instead of a prompt, prompt its task; widget: an extension fetched (action: one of its actions run instead, prompt its argument), on ones only
// one run of a task, for the log: what happened (a new workspace, sent, queued, why it failed or was missed)
export type ScheduleRun = { id: string; schedule: string; project?: string; name: string; at: number; ok: boolean; what: string; ws?: string; tab?: string }

export type State = { projects: Project[]; workspaces: Workspace[]; tabs: Tab[]; layouts?: Record<string, Layout[]>; widgetGrants?: Record<string, string[]>; settings?: Settings; schedules?: Schedule[]; runs?: ScheduleRun[]; todos?: Todo[]; reminders?: Reminder[]; flows?: FlowRun[]; flowsByAgent?: string[] }

export type Status = 'running' | 'waiting' | 'idle' | 'exited'

export type Check = { name: string; state: 'pass' | 'fail' | 'pending' | 'skip'; url?: string; took?: number } // took: seconds, a finished one's

// checks: all of them in one word; list: each one. head: the commit the checks ran on.
export type PR = {
  number: number
  state: string
  url: string
  checks: '' | 'pass' | 'fail' | 'pending'
  list?: Check[]
  title?: string
  author?: string
  mine?: boolean // its author is you (gh api user): no Approve
  draft?: boolean
  head?: string
  review?: string // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  approved?: string[] // the logins whose latest review approves it
  changes?: string[] // and whose asks for changes
  approvedByMe?: boolean // your latest review approves it (someone else's PR)
  commentedByMe?: boolean // you commented on it, or reviewed with comments (someone else's PR)
  conflict?: boolean // merge conflicts with its base branch
  ready?: boolean // mergeStateStatus CLEAN (or HAS_HOOKS): GitHub would merge it now; false: blocked, behind, unstable…
  base?: string // its base branch
  additions?: number
  deletions?: number
  body?: string
  updated?: string
}

// runAt: when its turn began (the daemon's clock), while it runs or waits
// ask: a waiting agent's numbered menu on its screen (a permission prompt, a question): the choices and the highlighted one
export type Ask = { options: { n: number; label: string }[]; at: number }
// asleep: an idle agent whose process Laki ended to free memory (settings.sleepAfter); a look, a key or a message resumes it
// progress: the agent's estimate of its task (laki progress), until its turn ends
export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string; runAt?: number; ask?: Ask; asleep?: boolean; progress?: { pct: number; note?: string }; runs?: Agent; share?: { url: string; until?: number } } // runs: an agent typed in a shell tab; share: its read-only page's link (shareStart), until when

// Resources (Settings): memory (RSS, KB) and CPU (%) by process, from one ps. app: Laki's own (main, renderers, GPU…);
// daemon: this one, heap: its JS heap (KB); tabs: each running tab's process tree, the program first
export type ProcUse = { pid: number; rss: number; cpu: number; cmd: string }
// others: what the daemon runs besides tabs (Laki AI's agent, tunnels, remote access, SSH, widgets' fetches); stop: resourceStop's key
export type Resources = { app: (ProcUse & { kind: string })[]; daemon: ProcUse & { heap: number }; tabs: { tab: string; rss: number; cpu: number; procs: ProcUse[] }[]; others?: { name: string; stop?: string; rss: number; cpu: number; procs: ProcUse[] }[] }

// a port exposed at a trycloudflare.com URL (no url yet: starting); mails: who can open it (none: anyone)
export type Tunnel = { port: number; url?: string; mails?: string[] }

// run: the project has a dev command; scripts: the RUN_SCRIPTS it has
// stat: its changes against where it started (a worktree: its base; the repo itself: HEAD), lines added and deleted
// (new files' too), files, and paths not committed (dirty), every 10 s (settings.diffStat on, or a race's)
export type Stat = { add: number; del: number; files: number; dirty: number }
// procs: what listens on each of its ports (the status bar's ✕ stops it); portNames: .laki.json's ports; artifacts:
// the files in its storage folder ($LAKI_STORAGE_FOLDER), the status bar's count
export type WorkspaceView = Workspace & { setup: boolean; scripts?: RunScript[]; ports: number[]; procs?: Record<number, Proc>; portNames?: Record<string, string>; tunnels: Tunnel[]; pr?: PR; run: boolean; stat?: Stat; artifacts?: number; links?: Link[] }
// a link an agent kept in the storage folder (a .url file: what it published), its title the file's name
export type Link = { path: string; url: string; title: string; at: number }
export type Proc = { pid: number; cmd: string; own?: boolean } // own: an agent's own (no shell between: its browser bridge, an MCP server) or a browser: not in ports
// the first-run screen's checks: git, gh (missing, signed out, in), which agents are on PATH
export type Doctor = { git: boolean; gh: 'missing' | 'out' | 'in'; cloudflared?: boolean; idb?: boolean; agents: { id: Agent; found: boolean }[] } // idb: laki screen's simulator hands

// a widget (daemon/widgets.ts): a folder with widget.json and widget.html; on: in the sidebar, fetching every `every`
// minutes (none: no fetch command or script); size: cells, 1–3 across the sidebar's grid by 1–4 down; full: it has a
// full view (a dialog); js: its page has scripts, so it runs in a sandboxed frame; config: its settings; at, error:
// the last fetch; rev: changes on each reload
// a widget's setting (widget.json config): its kind (text, number, bool: an on/off, choice: one of choices, list: words
// or names, kept joined by commas; secret: a token, kept in <data>/widget-secrets.json and given only to its fetch and
// actions), what Settings calls it and says under it
export type WidgetOption = { key: string; type: 'text' | 'number' | 'bool' | 'choice' | 'list' | 'secret'; label?: string; hint?: string; choices?: string[]; set?: boolean; required?: boolean } // secret: a token, never in the view (its config ''), set: it has one; required: it needs one (WidgetView.missing)
// view: the full view's dialog, small, medium or large; config: each setting as text (a bool's '1' or '')
// button: it shows as a button (a rail or foot place, or no preview of its own): icon (one of the app's icons, or a
// character or two), label, badge (a count on it) and tip, filled from its data; click: the action a click runs (none:
// its full view, else a fetch)
// a fetch's or an action's run (widgetRuns): reason schedule, open, settings, manual, reload, dev or action:<name>; why:
// what changed (dev mode); stderr: its last 20 lines
export type WidgetRun = { at: number; ms: number; reason: string; why?: string; action?: string; ok: boolean; bytes: number; error?: string; stderr?: string; exit?: number }
export type WidgetRuns = { runs: WidgetRun[]; env: Record<string, string>; fixtures: string[]; devError?: string; mock?: string; data?: string; big?: boolean; stream?: WidgetStream } // data: its last data's JSON, when asked (big: over 256 KB, not given)
// a stream's (widget.json's stream): running since, restarts so far, its last line, the next start after an exit
export type WidgetStream = { running: boolean; since?: number; restarts: number; last?: string; next?: number; stopped?: boolean }
// what an extension may answer (widget.json's on: { "<event>": "<action>" | "refresh" }; widgets.ts widgetEvent)
export const WIDGET_EVENTS = ['turn.done', 'turn.failed', 'turn.waiting', 'pr.opened', 'pr.checks.failed', 'pr.checks.passed', 'pr.review', 'pr.merged', 'pr.closed', 'workspace.new', 'workspace.archived', 'workspace.restored', 'workspace.removed', 'schedule.ran', 'app.open'] as const
export type WidgetEvent = (typeof WIDGET_EVENTS)[number]
// where an extension's data comes from: its own fetch (or script), a text typed in (JSON, else { text }), a file of this
// Mac's or a URL (read each time it fetches: JSON, else { text }); widget.json's source is the default, the user's pick wins
export const WIDGET_SOURCES = ['fetch', 'static', 'file', 'url', 'ai'] as const
// ai: an agent answers prompt with the user's own tools and MCP servers (claude: tools, the ones it may use unasked), its
// last ```json block the data; profile: a claude or codex preset (unset: settings.widgetAgent, else claude)
export type WidgetSource = { kind: (typeof WIDGET_SOURCES)[number]; text?: string; path?: string; url?: string; prompt?: string; tools?: string; profile?: string }
export const AI_SOURCE_EVERY = 60 // minutes between an AI source's runs unless set; 15 at least: each one costs
// what the user hid of an extension (its switches): its refresh buttons, when it was fetched
export type WidgetHide = { refresh?: boolean; at?: boolean }
export type WidgetView = { id: string; name: string; source?: WidgetSource; ownFetch?: boolean; fixtures?: string[]; description?: string; dir: string; builtin?: boolean; on: boolean; size: [number, number]; every?: number; full: boolean; view: WidgetSize; place?: WidgetPlace; places?: WidgetPlace[]; net?: boolean; hide?: WidgetHide; js?: boolean; actions?: string[]; menus?: WidgetMenu[]; config: Record<string, string>; options: WidgetOption[]; missing?: string[]; at?: number; error?: string; running?: boolean; agent?: boolean; byAi?: boolean; sample?: boolean; dev?: boolean; devError?: string; mock?: string; rev: number; button?: boolean; icon?: string; label?: string; badge?: string; tip?: string; click?: string; scope?: 'workspace'; inst?: Record<string, WidgetInst>; here?: string | null; tools?: WidgetTool[]; history?: number[] } // history: the studio's Undo, when each kept version was taken (ms), oldest first
// an action an agent may call (its tool): Always granted in these workspaces ('': calls from none, Laki AI's)
export type WidgetTool = { action: string; description: string; ask: 'always' | 'first' | 'never'; grants: string[] }
// an action offered where you work (widget.json's title, show, match, key, ask, confirm, insert, view: widgetSchema.ts actionMenu)
export type WidgetMenu = { action: string; title: string; show: string[]; match?: string[]; key?: string; ask?: string; confirm?: string; insert?: boolean; view?: boolean }
// where an action was picked (widgetAction ctx): a workspace, its tab, a file of it (relative)
export type WidgetCtx = { ws?: string; tab?: string; file?: string }
// here: the app's (Widgets.tsx inWs), the workspace whose instance a per-workspace one shows; null: none on screen
// a scope workspace extension's instance in a workspace (WidgetView.inst, by its id): its last fetch and its button's words
export type WidgetInst = { at?: number; error?: string; running?: boolean; mock?: string; label?: string; badge?: string; tip?: string }
export type WidgetSize = 's' | 'm' | 'l'
// where an extension shows: the sidebar's grid (the default), the top bar or the status bar (a line high, by the bar's
// right end), the rail (a button among its icons; without the rail, the sidebar's foot), the sidebar's foot (a button
// beside Video, Meme and Timer) or the Desk (experimental: a page of tiles, each resized there). Any of them at once:
// places (place is the first of them, for an older app)
export const WIDGET_PLACES = ['side', 'top', 'status', 'rail', 'foot', 'desk', 'panel', 'row'] as const // panel: a right-panel tab; row: a mark on each workspace's row (per workspace only)
export const placesOf = (w: { place?: WidgetPlace; places?: WidgetPlace[] }): WidgetPlace[] => (w.places?.length ? w.places : [w.place ?? 'side'])
export const BUTTON_PLACES: readonly WidgetPlace[] = ['rail', 'foot']
export type WidgetPlace = (typeof WIDGET_PLACES)[number]

// presets: the agents a tab or workspace can start (Settings' presets, or every agent installed); api: the
// daemon's API (none: older than API existed)
// schedules and runs (newest first): scheduled tasks and their log
export type View = { projects: Project[]; workspaces: WorkspaceView[]; tabs: TabView[]; layouts?: Record<string, Layout[]>; presets: Preset[]; settings: Settings; remote?: Remote; schedules?: Schedule[]; runs?: ScheduleRun[]; todos?: Todo[]; reminders?: Reminder[]; widgets?: WidgetView[]; widgetKey?: string; widgetHome?: string; flows?: FlowView[]; flowFiles?: number; api?: number; built?: string } // built: its build's time (none from source); flowFiles: when a workflow file last changed

// specs and brainstorms (experimental, settings.specs; daemon/plans.ts): a folder each, outside the repo. files: how
// many beside the editor's own (attachments, a brainstorm's output)
export const PLAN_KINDS = ['spec', 'brainstorm'] as const
export type PlanKind = (typeof PLAN_KINDS)[number]
export type Plan = { project: string; kind: PlanKind; slug: string; title: string; at: number; path: string; files: number }
export type PlanFile = { path: string; size: number; at: number }
// a template for a new one (the Specs page's Templates; settings.planTemplates, unset: PLAN_TEMPLATES): its Markdown is the
// new one's README.md under its title. None picked: empty
export type PlanTemplate = { name: string; kind: PlanKind; text: string }
export type PlanPin = { project: string; kind: PlanKind; slug: string; title: string } // its title as last seen: the rail's tip

// The API this build's daemon speaks and its renderer expects: a running daemon with a lower one (it
// outlives app updates) gets a restart button in the status bar. Bump it when the renderer starts relying
// on a new method or behavior of the daemon.
export const RAIL_PINS = 5 // the rail's quick access: workspaces, terminals or browsers pinned there
export const API = 85
export const REPO = 'https://github.com/igorkasyanchuk/laki' // About's and Help's links, the widget schema's raw URL
