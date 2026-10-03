// Shapes shared by the daemon, the CLI and the renderer.

// setup runs in a new worktree, teardown when one goes, run is the dev server; each field overrides .wb.json's
export type ProjectConfig = { setup?: string; teardown?: string; run?: string }

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
}

export type TabKind = 'agent' | 'shell' | 'setup' | 'dev' | 'ship'

export type Tab = {
  id: string
  workspace: string
  name: string
  kind: TabKind
  preset?: string // claude | codex | custom
  cmd?: string // custom command
  resumeId?: string // claude session_id / codex thread-id
  forkOf?: string // claude session to fork on first start
  queue?: string[] // follow-ups for when the agent is idle
  color?: string // a tab color's name (red, blue, …); 'none' turns the agent's default off
}

// the app's settings (⌘,): editor is a preset (cursor, zed, vscode, windsurf, sublime) or 'custom' (editorCmd + the path)
export type Settings = { editor?: string; editorCmd?: string; agent?: string; branchPrefix?: string; fontSize?: number; notify?: boolean }

export type State = { projects: Project[]; workspaces: Workspace[]; tabs: Tab[]; settings?: Settings }

export type Status = 'running' | 'waiting' | 'idle' | 'exited'

export type PR = { number: number; state: string; url: string; checks: '' | 'pass' | 'fail' | 'pending' }

export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string }

export type WorkspaceView = Workspace & { setup: boolean; ports: number[]; pr?: PR }

export type View = { projects: Project[]; workspaces: WorkspaceView[]; tabs: TabView[]; presets: string[]; settings: Settings }
