// Shapes shared by the daemon, the CLI and the renderer.

// setup runs in a new worktree, teardown when one goes, run is the dev server, env goes to every tab;
// each field overrides .wb.json's (env key by key)
export type ProjectConfig = { setup?: string; teardown?: string; run?: string; env?: Record<string, string> }

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
}

export type TabKind = 'agent' | 'shell' | 'setup' | 'dev' | 'ship'

export type Tab = {
  id: string
  workspace: string
  name: string
  kind: TabKind
  preset?: string // claude | codex | custom: what the agent is (hooks, resume)
  profile?: string // the preset (Settings) it started from: its args and env
  cmd?: string // custom command
  resumeId?: string // claude session_id / codex thread-id
  forkOf?: string // claude session to fork on first start
  queue?: string[] // follow-ups for when the agent is idle
  color?: string // a tab color's name (red, blue, …); 'none' turns the agent's default off
}

// how an agent starts: claude or codex with extra args, or any command; env on top of the project's
export type Preset = { name: string; agent: 'claude' | 'codex' | 'command'; args?: string; cmd?: string; env?: Record<string, string> }

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
  presets?: Preset[]
}

export type State = { projects: Project[]; workspaces: Workspace[]; tabs: Tab[]; settings?: Settings }

export type Status = 'running' | 'waiting' | 'idle' | 'exited'

export type PR = { number: number; state: string; url: string; checks: '' | 'pass' | 'fail' | 'pending' }

export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string }

// run: the project has a dev command
export type WorkspaceView = Workspace & { setup: boolean; ports: number[]; pr?: PR; run: boolean }

// presets: the agents a tab or workspace can start (Settings' presets, or claude and codex)
export type View = { projects: Project[]; workspaces: WorkspaceView[]; tabs: TabView[]; presets: Preset[]; settings: Settings }
