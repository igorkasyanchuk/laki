// Shapes shared by the daemon, the CLI and the renderer.

export type Project = { id: string; name: string; path: string }

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
}

export type State = { projects: Project[]; workspaces: Workspace[]; tabs: Tab[] }

export type Status = 'running' | 'waiting' | 'idle' | 'exited'

export type PR = { number: number; state: string; url: string; checks: '' | 'pass' | 'fail' | 'pending' }

export type TabView = Tab & { status: Status; code?: number; done: boolean; limit?: number; last?: string }

export type WorkspaceView = Workspace & { setup: boolean; ports: number[]; pr?: PR }

export type View = { projects: Project[]; workspaces: WorkspaceView[]; tabs: TabView[]; presets: string[] }
