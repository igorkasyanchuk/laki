// Shapes shared by the daemon, the CLI and the renderer.
import type { Rule } from './when.ts'

// the coding agents Laki starts by name (a preset's agent; the command is the id), and what they're called
export const AGENTS = ['claude', 'codex', 'gemini', 'grok', 'opencode'] as const
export type Agent = (typeof AGENTS)[number]
export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', opencode: 'OpenCode' }
export const isAgent = (s?: string): s is Agent => (AGENTS as readonly string[]).includes(s ?? '')

// setup runs in a new worktree, teardown when one goes, run is the dev server, env goes to every tab;
// each field overrides .laki.json's (env key by key)
// expose: who Expose to the world lets in by default (emails, *@domains; empty: anyone with the link)
// actions: Run ▾'s for the project's workspaces, after the global ones (one of the same name and target replaces it)
export type RunAction = { name: string; target: Agent | 'shell'; text: string }
// a prompt template: {{prompt}} (what's typed), {{project}}, {{base}}; settings.templates and a project's own
export type Template = { name: string; text: string }
export type ProjectConfig = { setup?: string; teardown?: string; run?: string; expose?: string; actions?: RunAction[]; templates?: Template[]; env?: Record<string, string> }

// git: false for a plain folder (local workspaces only: no worktrees, branches, diff or PRs)
export type Project = { id: string; name: string; path: string; git?: boolean; config?: ProjectConfig }

export type Workspace = {
  id: string
  project: string
  path: string
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
  autoFix?: boolean // failing CI goes to the agent
  autoReview?: boolean // new PR review comments go to the agent
  fix?: PRFix // what autoFix/autoReview sent already
}

// for one PR: the commit whose failing CI was sent, how many times in a row, the review threads sent
export type PRFix = { pr: number; ci?: string; tries?: number; review?: string }

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
}

// how an agent starts: one of AGENTS with extra args, or any command; env on top of the project's
export type Preset = { name: string; agent: Agent | 'command'; args?: string; cmd?: string; env?: Record<string, string> }

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
  notify?: boolean
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
  templates?: Template[] // prompt templates ({{prompt}}…), for new workspaces; a project's own come first
  actions?: RunAction[] // Run ▾'s: a prompt for an agent, or a command for a terminal
  env?: Record<string, string> // every session's, under the project's and the preset's
  tunnelMails?: string[] // who the last tunnel let in (Expose to the world)
  usage?: Record<string, boolean> // claude, codex: the status bar shows its plan's limits (unset: on)
  remoteMail?: string // the one email remote access lets in
}

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

export type State = { projects: Project[]; workspaces: Workspace[]; tabs: Tab[]; settings?: Settings; schedules?: Schedule[]; runs?: ScheduleRun[] }

export type Status = 'running' | 'waiting' | 'idle' | 'exited'

export type Check = { name: string; state: 'pass' | 'fail' | 'pending' | 'skip'; url?: string }

// checks: all of them in one word; list: each one. head: the commit the checks ran on.
export type PR = {
  number: number
  state: string
  url: string
  checks: '' | 'pass' | 'fail' | 'pending'
  list?: Check[]
  title?: string
  author?: string
  draft?: boolean
  head?: string
  review?: string // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  additions?: number
  deletions?: number
  body?: string
  updated?: string
}

export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string }

// a port exposed at a trycloudflare.com URL (no url yet: starting); mails: who can open it (none: anyone)
export type Tunnel = { port: number; url?: string; mails?: string[] }

// run: the project has a dev command
export type WorkspaceView = Workspace & { setup: boolean; ports: number[]; tunnels: Tunnel[]; pr?: PR; run: boolean }

// presets: the agents a tab or workspace can start (Settings' presets, or every agent installed); api: the
// daemon's API (none: older than API existed)
// schedules and runs (newest first): scheduled tasks and their log
export type View = { projects: Project[]; workspaces: WorkspaceView[]; tabs: TabView[]; presets: Preset[]; settings: Settings; remote?: Remote; schedules?: Schedule[]; runs?: ScheduleRun[]; api?: number }

// The API this build's daemon speaks and its renderer expects: a running daemon with a lower one (it
// outlives app updates) gets a restart button in the status bar. Bump it when the renderer starts relying
// on a new method or behavior of the daemon.
export const API = 9
