// Shapes shared by the daemon, the CLI and the renderer.
import { type Rule, stamp } from './when.ts'

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
export type RunAction = { name: string; target: Agent | 'any' | 'shell'; text: string }
// a prompt template: {{prompt}} (what's typed), {{project}}, {{base}}; settings.templates and a project's own
export type Template = { name: string; text: string }
// copy: gitignore-style patterns of files git doesn't keep (.env…) a new worktree gets from the main checkout, with .worktreeinclude's
// ports: names for the status bar's ports ({"3000": "web"})
export type ProjectConfig = { setup?: string; teardown?: string; run?: string; expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; copy?: string[]; ports?: Record<string, string>; worktrees?: string; pr?: PRAllow; mergeMethod?: MergeMethod } // worktrees, pr, mergeMethod: the app's only (never .laki.json): where new ones go; what the app may do to a PR; the last merge's way
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
  memory?: Memory[] // the project page's Memory: the user's notes to keep, one each, newest last; never agents' (yet)
}
export type Memory = { id: string; text: string; at: number; edited?: number } // at: when it was added
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
  color?: string // its sidebar color's name
  name?: string // shown instead of the id (which names the worktree and branch)
  schedule?: string // the scheduled task that made it (its clock in the sidebar)
  muted?: boolean // no notifications from its tabs
  pinned?: boolean // the sidebar shows it above the projects, under Pinned
  autoFix?: boolean // failing CI goes to the agent
  autoReview?: boolean // new PR review comments go to the agent
  autoMerge?: boolean // merge conflicts with the PR's base go to the agent
  autoLand?: boolean // merge when green: Laki merges the PR (its project's last way) once all checks pass, no conflicts, not a draft, approved if it must be
  fix?: PRFix // what autoFix/autoReview/autoMerge/autoLand did already
  race?: string // one prompt fanned out to several agents: the workspaces of one race share it (Compare)
  issue?: { number: number; url: string; title: string } // the GitHub issue it was started from (laki new --issue)
  prUrl?: string // the GitHub PR it was started from (laki new --pr, or a prompt naming one): its PR by URL (a fork's, another repo's), until the branch moves
  prLinked?: boolean // prUrl from a prompt: the PR isn't checked out here, so the auto switches (fix and push) stay off
  prSaid?: boolean // prUrl a PR its agent named (prFromSaid): one on its own branch, once there, replaces it
  autoArchived?: number // the merged PR it was archived for (settings.archiveMerged): once, so an Undo stays
  fork?: boolean // a fork's PR (or a fork of one): its .laki.json isn't read, the repo's is
  browser?: string // a Browsers workspace: the page it's on (the app shows it instead of terminals)
  storage?: string // its tabs' $LAKI_STORAGE_FOLDER (storageOf: made at its first tab, removed with it unless settings.keepStorage)
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

// {{name}} (spaces inside allowed) as vars say; an unknown one stays as it is (not {{constructor}}): prompt templates', PR_PROMPTS'.
// The template's dates ({{DD-MM-YY HH:MM}}, when.ts' stamp) are now's; what vars bring in (a typed prompt) isn't stamped
export const fillTemplate = (text: string, vars: Record<string, string | undefined>, at = Date.now()) =>
  stamp(text, at).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? (vars[k] ?? m) : m))
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

export type TabKind = 'agent' | 'shell' | 'setup' | 'dev' | 'ship'

export type Tab = {
  id: string
  workspace: string
  name: string
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
  again?: { cwd?: string; cmd?: string; run?: boolean } // what a shell ran as the daemon stopped (keepShells), back at its next start; a Run tab's: start it again
  titled?: boolean // its name says what it's for (given, renamed, or its first prompt's words): no prompt renames it
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
export type Preset = { name: string; agent: Agent | 'command'; args?: string; cmd?: string; env?: Record<string, string>; off?: boolean; laki?: boolean } // laki: false: no note about Laki at its starts (unset: told)

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
  notifyOn?: Partial<Record<NotifyKind, boolean>> // which turns notify (unset: all)
  notifySound?: string // a macOS sound's name (Glass, Ping…), 'none', or unset: the default
  timerAlert?: 'dialog' | 'notification' // what a sidebar timer's end shows (unset: Laki's dialog)
  timerSound?: string // a macOS sound or 'none' as a timer ends (unset: Glass)
  presets?: Preset[] | null // null: the defaults
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
  remoteMail?: string // the one email remote access lets in
  timers?: boolean // how long each turn has been going, on its tab and row (unset: off)
  projectLook?: ProjectLook // the sidebar's project names, over the theme's
  sideLook?: SideLook // the sidebar's lines, rows and button labels, over the theme's
  diffStat?: boolean // each workspace's +/- in the sidebar, scanned every 10 s (unset: off; a race's are always)
  dimPanes?: boolean // a split's other panes dimmed (unset: off)
  termPad?: 'tiny' | 'normal' | 'roomy' // Settings › Terminal › Padding: the space around a terminal's text (unset: normal)
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (unset: off)
  closeNoAsk?: boolean // closing a tab whose process still runs doesn't ask first (unset: it asks)
  pageZoom?: number // Settings and Help's size (0.9–1.5, renderer's PAGE_ZOOMS; unset: 1)
  storageDir?: string // where workspaces' storage folders go (unset: <data>/storage; ~ is home)
  keepStorage?: boolean // a deleted workspace's storage folder stays (unset: removed with it)
  worktrees?: string // where new worktrees go: <it>/<project>/<workspace> (unset: <data>/worktrees; a project's own folder wins)
  tabsAt?: 'top' | 'bottom' | 'left' | 'right' // where the tabs are (unset: top)
  prPrompts?: Partial<Record<FixWhat, string>> // over PR_PROMPTS (unset or blank: the default)
  prScan?: number // minutes between PR checks (unset: PR_SCAN)
  prTries?: number // fix CI's and fix conflicts' tries in a row (unset: PR_TRIES)
  sleepAfter?: number // minutes an idle claude or codex nobody looks at keeps its process (unset or 0: always)
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
  railLabels?: boolean // the rail layout's words under its icons; off: icons only, a narrower rail (unset: on)
  sideStyle?: SideStyle // the sidebar's rows: a line, the marks, a second line, cards with the agent's last answer (unset: default)
  progress?: boolean // LAKI_PROGRESS=1 in agents' env: with the laki skill, they report how far along their task is (unset: off)
  devMode?: boolean // an event log per workspace and widget (⋯ › Logs, Settings › Widgets), in the daemon's memory (unset: off)
  widgetHours?: string // when widgets fetch on their own, in English (when.ts parseHours: 9am-9pm weekdays; unset: always)
  ai?: AiSettings // Laki's own AI (Settings › AI, the AI page)
}

// Laki's own AI (daemon/ai.ts): optional (on), it works Laki through the MCP server's tools, only when asked. backend:
// OpenRouter (its key in <data>/ai-key, never here) or a CLI agent in the background (claude -p, codex exec); models:
// each backend's (unset: AI_MODEL for OpenRouter, the agent's own for the others); steps: tool calls an ask may make
export type AiBackend = 'openrouter' | 'claude' | 'codex'
// preset: an agent preset of the backend's agent (claude, codex), its env for an account of its own
export type AiSettings = { on?: boolean; backend?: AiBackend; preset?: string; models?: Partial<Record<AiBackend, string>>; steps?: number }
export const AI_MODEL = 'anthropic/claude-sonnet-5.5'
export const AI_STEPS = 20
// the AI page's conversation: what you asked (images: their paths), its answers, each tool it ran, a failure
export type AiMsg = { role: 'user' | 'ai' | 'tool' | 'error'; text: string; at: number; images?: string[] }
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

// Settings › Notifications webhook: where a waiting (unset: on) or done (unset: off) agent is pushed, in which format
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
export type Todo = { id: string; project: string; text: string; at: number }

// remote access (core.ts): who may open it, until when (ms; none: until stopped), and once cloudflared has one, its URL and the link
// with the token
export type Remote = { mail: string; open?: boolean; until?: number; url?: string; link?: string } // open: no email (mail ''), anyone with the link

// a plan's limit (daemon/usage.ts): used %, when it resets (ms); note: what the % is of, for an amount (extra usage)
export type UsageWindow = { label: string; used: number; resets?: number; note?: string }
// an agent's limits; error: why there are none (signed out…); at: when they were read
export type AgentUsage = { agent: string; plan?: string; windows: UsageWindow[]; error?: string; at: number }

// a scheduled task: at the times `when` says (rule: what it said when saved, shared/when.ts), its prompt goes to an
// agent (a preset's name): in a new workspace each time (ws 'new': a worktree), in the project's own folder (ws 'local':
// no worktree, one session; 'local-new': a new session, a sidebar row, each run), or in that workspace (its running agent of the preset, queued while it works; else a new tab). next:
// when it runs (none: off, or a once that ran)
export type Schedule = { id: string; name?: string; project: string; preset: string; ws: string; prompt: string; when: string; rule: Rule; on: boolean; next?: number; last?: number }
// one run of a task, for the log: what happened (a new workspace, sent, queued, why it failed or was missed)
export type ScheduleRun = { id: string; schedule: string; project?: string; name: string; at: number; ok: boolean; what: string; ws?: string; tab?: string }

export type State = { projects: Project[]; workspaces: Workspace[]; tabs: Tab[]; settings?: Settings; schedules?: Schedule[]; runs?: ScheduleRun[]; todos?: Todo[] }

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
  mine?: boolean // its author is you (gh api user): no avatar, no Approve
  draft?: boolean
  head?: string
  review?: string // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  approved?: string[] // the logins whose latest review approves it
  changes?: string[] // and whose asks for changes
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
export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string; runAt?: number; ask?: Ask; asleep?: boolean; progress?: { pct: number; note?: string }; runs?: Agent } // runs: an agent typed in a shell tab

// Resources (Settings): memory (RSS, KB) and CPU (%) by process, from one ps. app: Laki's own (main, renderers, GPU…);
// daemon: this one, heap: its JS heap (KB); tabs: each running tab's process tree, the program first
export type ProcUse = { pid: number; rss: number; cpu: number; cmd: string }
// others: what the daemon runs besides tabs (Laki AI's agent, tunnels, remote access, SSH, widgets' fetches); stop: resourceStop's key
export type Resources = { app: (ProcUse & { kind: string })[]; daemon: ProcUse & { heap: number }; tabs: { tab: string; rss: number; cpu: number; procs: ProcUse[] }[]; others?: { name: string; stop?: string; rss: number; cpu: number; procs: ProcUse[] }[] }

// a port exposed at a trycloudflare.com URL (no url yet: starting); mails: who can open it (none: anyone)
export type Tunnel = { port: number; url?: string; mails?: string[] }

// run: the project has a dev command
// stat: its changes against where it started (a worktree: its base; the repo itself: HEAD), lines added and deleted
// (new files' too), files, and paths not committed (dirty), every 10 s (settings.diffStat on, or a race's)
export type Stat = { add: number; del: number; files: number; dirty: number }
// procs: what listens on each of its ports (the status bar's ✕ stops it); portNames: .laki.json's ports; artifacts:
// the files in its storage folder ($LAKI_STORAGE_FOLDER), the status bar's count
export type WorkspaceView = Workspace & { setup: boolean; ports: number[]; procs?: Record<number, Proc>; portNames?: Record<string, string>; tunnels: Tunnel[]; pr?: PR; run: boolean; stat?: Stat; artifacts?: number; links?: Link[] }
// a link an agent kept in the storage folder (a .url file: what it published), its title the file's name
export type Link = { path: string; url: string; title: string; at: number }
export type Proc = { pid: number; cmd: string }
// the first-run screen's checks: git, gh (missing, signed out, in), which agents are on PATH
export type Doctor = { git: boolean; gh: 'missing' | 'out' | 'in'; cloudflared?: boolean; agents: { id: Agent; found: boolean }[] }

// a widget (daemon/widgets.ts): a folder with widget.json and widget.html; on: in the sidebar, fetching every `every`
// minutes (none: no fetch command or script); size: cells, 1–3 across the sidebar's grid by 1–4 down; full: it has a
// full view (a dialog); js: its page has scripts, so it runs in a sandboxed frame; config: its settings; at, error:
// the last fetch; rev: changes on each reload
// a widget's setting (widget.json config): its kind (text, number, bool: an on/off, choice: one of choices, list: words
// or names, kept joined by commas), what Settings calls it and says under it
export type WidgetOption = { key: string; type: 'text' | 'number' | 'bool' | 'choice' | 'list'; label?: string; hint?: string; choices?: string[] }
// view: the full view's dialog, small, medium or large; config: each setting as text (a bool's '1' or '')
export type WidgetView = { id: string; name: string; description?: string; dir: string; builtin?: boolean; on: boolean; size: [number, number]; every?: number; full: boolean; view: WidgetSize; js?: boolean; config: Record<string, string>; options: WidgetOption[]; at?: number; error?: string; running?: boolean; rev: number }
export type WidgetSize = 's' | 'm' | 'l'

// presets: the agents a tab or workspace can start (Settings' presets, or every agent installed); api: the
// daemon's API (none: older than API existed)
// schedules and runs (newest first): scheduled tasks and their log
export type View = { projects: Project[]; workspaces: WorkspaceView[]; tabs: TabView[]; presets: Preset[]; settings: Settings; remote?: Remote; schedules?: Schedule[]; runs?: ScheduleRun[]; todos?: Todo[]; widgets?: WidgetView[]; widgetKey?: string; widgetHome?: string; api?: number }

// The API this build's daemon speaks and its renderer expects: a running daemon with a lower one (it
// outlives app updates) gets a restart button in the status bar. Bump it when the renderer starts relying
// on a new method or behavior of the daemon.
export const API = 45
