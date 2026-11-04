// What App's parts read of App: menus.ts, keydown.ts, Palette.tsx, TabBar.tsx, Sidebar.tsx and Dialogs.tsx. App builds
// it each render, after `if (!view)` (so `view` is there), from its own state and helpers: all state and every hook
// stay in App, and a part destructures what it uses. A new field: its type here, then its name in App's `appBase`.
import type { Dispatch, SetStateAction } from 'react'
import { AGENT_COLORS } from './ui'
import { wsShown } from './text'
import type { ExtTab } from './Extension'
import type { DeskAsk } from './Desk'
import type { ProjectTab } from './Project'
import type { Account, PlanKind, Project, Settings, TabView, View, WidgetCtx, WorkspaceView, WsSort } from '../../shared/types'
import type { FlowStartAt, Sel as FlowSel } from './Workflows'
import type { AppInfo, RowMark } from './Settings'
import type { MenuItem } from './ui'
import type { Layout } from '../../shared/layout'
import type { KeyId } from '../../shared/keys'
import type { Collision } from '../../shared/overlap'
import type { PanelTab } from './SidePanel'

// the page or dialog over the workspace, App's `dialog`
export type Dialog = null | 'scriptLogs' | 'new' | 'project' | 'palette' | 'starters' | 'onboard' | 'files' | 'ship' | 'custom' | 'settings' | 'help' | 'about' | 'board' | 'achievements' | 'bird' | 'ai' | 'usage' | 'calendar' | 'desk' | 'todos' | 'schedules' | 'fun' | 'video' | 'timer' | { timer: string } | { timerNote: string } | { remind: string } | { sendLater: string; edit?: string; to?: string; text?: string; back?: 'ai' } | { timerCmd: string } | { schedules: string } | { compare: string } | { widget: string; back?: Dialog } | { extension: string; back?: Dialog; tab?: ExtTab; edit?: string; start?: DeskAsk; key?: string } | { uikit: true; icons?: boolean; back?: Dialog } | { settings: string; script?: 'run'; spot?: string } | { section: string; spot?: string } | { rename: string } | { renameWs: string } | { sep: string; id?: string } | { logs: string; title: string; back?: Dialog } | { attachPr: string } | { importWt: string } | { importChats: string } | { ciLog: string; job: string; name: string; url?: string } | { notes: string } | { project: string; tab?: ProjectTab } | { specs: string; of?: string; kind?: PlanKind; slug?: string; templates?: boolean } | { workflows: string; run?: string; start?: FlowStartAt; wf?: FlowSel; nav?: string } | { note: string }
// the rail layout's kinds (Settings › Appearance › Layout)
export type RailKind = 'projects' | 'shells' | 'browsers'
export type Where = { ws?: string; project?: string; widget?: string; file?: string; storage?: boolean } // what Open in opens: a folder (a widget's too), or a file in a workspace

// a tab's color: its own, else its agent's ('none' turns that off)
export const colorOf = (t?: TabView) => t?.color ?? AGENT_COLORS[t?.preset ?? '']
export const WEB = /\.(x?html?|svg|pdf|xml|json|png|jpe?g|gif|webp)$/i // what browsers show
export const wsName = wsShown

// App's state and helpers its parts read: a field each, sorted
export type AppBase = {
  accountsOf: (agent?: string) => (Account | { id: string; name: string })[]
  apps: AppInfo[]
  archive: (w: WorkspaceView, asked?: boolean) => Promise<void>
  attachable: (w: WorkspaceView) => boolean
  byId: (id: string) => TabView | undefined
  call: <T>(method: string, params?: object) => Promise<T>
  closeTabs: (ts: TabView[]) => Promise<void>
  copy: (text: string) => Promise<void>
  copyTab: (t: TabView) => undefined
  done: (text: string, undo?: () => void) => void
  extItems: (show: string, x: WorkspaceView | undefined | null, ctx: WidgetCtx, file?: string) => MenuItem[]
  fail: (e: unknown) => void
  floated: string[]
  floatTab: (id: string, on?: boolean) => void | undefined
  flowMenu: (w: WorkspaceView) => MenuItem[]
  fold: (id: string) => void
  folded: string[]
  forkWs: (w: WorkspaceView) => Promise<void>
  groupMoves: (ws_: WorkspaceView[]) => MenuItem[]
  groups: Layout[]
  inReader: (id: string) => boolean
  isTerm: (w: WorkspaceView) => boolean
  kh: (id: KeyId) => string | undefined
  laterCancel: (w: WorkspaceView) => Promise<void>
  laterChange: (w: WorkspaceView) => Promise<void>
  laterNow: (w: WorkspaceView) => undefined
  mark: (m: RowMark) => boolean
  markUnread: (id: string) => Promise<unknown>
  newIn: (p: Project) => void | Promise<void>
  newWord: (p: Project) => "New browser" | "New terminal" | "New workspace"
  openIn: (app: string, where?: Where) => void
  openInItems: (where?: Where) => MenuItem[]
  prMenu: (w: WorkspaceView) => MenuItem[]
  projOf: (w?: { project: string } | null) => Project | undefined
  rail: boolean
  rawKind: (w: WorkspaceView) => RailKind
  readerOn: boolean
  refreshPR: () => Promise<void>
  restore: (id: string) => Promise<void>
  rmItem: (w: WorkspaceView) => MenuItem
  runMenu: (w?: WorkspaceView | null) => MenuItem[]
  selectTab: (ref: string | { id: string; workspace: string }) => void
  setDialog: Dispatch<SetStateAction<Dialog>>
  setGroups: (next: Layout[]) => void | false | null
  setOverlapsAt: Dispatch<SetStateAction<{ w: string; list?: Collision[] | undefined; err?: string | undefined } | null>>
  setRead: (id: string, m: 'reader' | 'term') => void
  setSharing: Dispatch<SetStateAction<string | null>>
  settings: Settings
  setWsId: Dispatch<SetStateAction<string | null>>
  showInfo: (on?: boolean) => void
  showPanel: (t: PanelTab) => void
  sortItems: (cur: WsSort | undefined, pick: (s: WsSort | undefined) => void, inherit?: WsSort) => MenuItem[]
  split: (edge: "bottom" | "right", next?: string) => Promise<void>
  stepItem: (w: WorkspaceView) => MenuItem[]
  tabByWs: Record<string, string>
  termIn: (p: Project, place?: string) => Promise<void>
  termsOk: boolean
  termWhere: (p: Project) => string
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean) => void
  view: View
}
