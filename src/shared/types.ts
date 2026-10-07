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
export type ProjectConfig = { setup?: string; teardown?: string; run?: string; expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string>; copy?: string[]; ports?: Record<string, string> }

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
}
export type Sep = { id: string; name: string; color?: string; template?: string } // color: TAB_COLORS' name, its label's tint; template: a prompt template's name, the one a new workspace under it starts with
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
  fix?: PRFix // what autoFix/autoReview/autoMerge sent already
  race?: string // one prompt fanned out to several agents: the workspaces of one race share it (Compare)
  issue?: { number: number; url: string; title: string } // the GitHub issue it was started from (laki new --issue)
  prUrl?: string // the GitHub PR it was started from (laki new --pr, or a prompt naming one): its PR by URL (a fork's, another repo's), until the branch moves
  prLinked?: boolean // prUrl from a prompt: the PR isn't checked out here, so the auto switches (fix and push) stay off
  autoArchived?: number // the merged PR it was archived for (settings.archiveMerged): once, so an Undo stays
  fork?: boolean // a fork's PR (or a fork of one): its .laki.json isn't read, the repo's is
}

// for one PR: the commit whose failing CI was sent, how many times in a row, the review threads sent; the commit whose
// merge conflicts were sent, how many times in a row
export type PRFix = { pr: number; ci?: string; tries?: number; review?: string; mine?: string[]; merge?: string; merges?: number } // mine: the agent's comments (it comments as you)
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
}

// how an agent starts: one of AGENTS with extra args, or any command; env on top of the project's
// off: switched off in Settings: out of the pickers (new tab, new workspace, races, scheduled tasks); its tabs still start
export type Preset = { name: string; agent: Agent | 'command'; args?: string; cmd?: string; env?: Record<string, string>; off?: boolean }

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
  presets?: Preset[] | null // null: the defaults
  theme?: string
  glass?: boolean // a see-through, blurred window
  glassWindow?: number // how see-through glass makes the window, the sidebar, the terminals: %
  glassSide?: number
  glassTerm?: number
  glassGlow?: boolean // the theme's colors behind the glass (unset: on)
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
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (unset: off)
  tabsAt?: 'top' | 'bottom' | 'left' | 'right' // where the tabs are (unset: top)
  prPrompts?: Partial<Record<FixWhat, string>> // over PR_PROMPTS (unset or blank: the default)
  prScan?: number // minutes between PR checks (unset: PR_SCAN)
  prTries?: number // fix CI's and fix conflicts' tries in a row (unset: PR_TRIES)
  sleepAfter?: number // minutes an idle claude or codex nobody looks at keeps its process (unset or 0: always)
  webhook?: Webhook // pushes to your phone
  archiveMerged?: boolean // a workspace whose PR merged is archived when clean, with Undo (unset: off)
  menuBar?: boolean // the menu bar's item: the needs-you count and those tabs (unset: on)
  floater?: boolean // the floating bubbles over other apps: agents working or waiting (unset: on)
  fun?: boolean // the sidebar foot's smiley (Meme): a meme for a break (unset: on)
  widgetDirs?: string[] // folders of widgets (or a widget's own), besides <data>/widgets (daemon/widgets.ts)
  sideStyle?: SideStyle // the sidebar's rows: a line, the marks, a second line, cards with the agent's last answer (unset: default)
  progress?: boolean // LAKI_PROGRESS=1 in agents' env: with the laki skill, they report how far along their task is (unset: off)
  devMode?: boolean // an event log per workspace and widget (⋯ › Logs, Settings › Widgets), in the daemon's memory (unset: off)
  widgetHours?: string // when widgets fetch on their own, in English (when.ts parseHours: 9am-9pm weekdays; unset: always)
}

// Settings › Notifications webhook: where a waiting (unset: on) or done (unset: off) agent is pushed, in which format
export type Webhook = { url?: string; format?: 'ntfy' | 'slack' | 'telegram' | 'json'; waiting?: boolean; done?: boolean }

// how the sidebar writes project names (Settings › Appearance); 'theme' (or unset): as the theme does
export type ProjectLook = { font?: 'theme' | 'ui' | 'mono'; case?: 'theme' | 'upper' | 'none'; spacing?: string; size?: string; weight?: string }
// the sidebar's lines and rows (Settings › Appearance) as CSS values, 'theme' (or unset): as the theme draws them;
// labels: words beside its bottom buttons (unset: shown)
export type SideStyle = 'compact' | 'default' | 'extended' | 'cards' // Settings.tsx SIDE_STYLES
// development mode's event log (core.ts devLog): n, how many times a line came again
export type LogLine = { at: number; text: string; n?: number }
export type SideLook = { guide?: string; divider?: string; indent?: string; rows?: string; text?: string; icons?: string; labels?: boolean }

// a task waiting on the board (Board.tsx) for a workspace: a prompt for a project
export type Todo = { id: string; project: string; text: string; at: number }

// remote access (core.ts): who may open it, until when (ms; none: until stopped), and once cloudflared has one, its URL and the link
// with the token
export type Remote = { mail: string; until?: number; url?: string; link?: string }

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
  conflict?: boolean // merge conflicts with its base branch
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
export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string; runAt?: number; ask?: Ask; asleep?: boolean; progress?: { pct: number; note?: string } }

// Resources (Settings): memory (RSS, KB) and CPU (%) by process, from one ps. app: Laki's own (main, renderers, GPU…);
// daemon: this one, heap: its JS heap (KB); tabs: each running tab's process tree, the program first
export type ProcUse = { pid: number; rss: number; cpu: number; cmd: string }
export type Resources = { app: (ProcUse & { kind: string })[]; daemon: ProcUse & { heap: number }; tabs: { tab: string; rss: number; cpu: number; procs: ProcUse[] }[] }

// a port exposed at a trycloudflare.com URL (no url yet: starting); mails: who can open it (none: anyone)
export type Tunnel = { port: number; url?: string; mails?: string[] }

// run: the project has a dev command
// stat: its changes against where it started (a worktree: its base; the repo itself: HEAD), lines added and deleted
// (new files' too), files, and paths not committed (dirty), every 10 s (settings.diffStat on, or a race's)
export type Stat = { add: number; del: number; files: number; dirty: number }
// procs: what listens on each of its ports (the status bar's ✕ stops it); portNames: .laki.json's ports
export type WorkspaceView = Workspace & { setup: boolean; ports: number[]; procs?: Record<number, Proc>; portNames?: Record<string, string>; tunnels: Tunnel[]; pr?: PR; run: boolean; stat?: Stat }
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
export const API = 31
