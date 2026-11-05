// What App's parts read of App: menus.ts, keydown.ts, Palette.tsx, TabBar.tsx, Sidebar.tsx and Dialogs.tsx. App builds
// it each render, after `if (!view)` (so `view` is there), from its own state and helpers: all state and every hook
// stay in App, and a part destructures what it uses. A new field: its type here, then its name in App's `appBase`.
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ExtTab } from './Extension'
import type { DeskAsk } from './Desk'
import type { ProjectTab } from './Project'
import type { Account, AchievementsKept, MergeMethod, PlanKind, Project, RunScript, Sep, Settings, Stat, TabView, View, WidgetCtx, WidgetMenu, WidgetView, WorkspaceView, WsSort } from '../../shared/types'
import type { FlowStartAt, Sel as FlowSel } from './Workflows'
import type { Edit, PanelTab } from './SidePanel'
import type { IconName, MenuItem, useRowDrag } from './ui'
import type { AppInfo, RowMark } from './Settings'
import type { Step } from '../../shared/nextStep'
import type { Inserted } from './PromptInput'
import type { WorkflowItem } from '../../shared/workflow'
import type { Layout, Role, RoleLayout, RoleTab } from '../../shared/layout'
import type { KeyId, KeyMap } from '../../shared/keys'
import type { NewWsParams } from './panels'
import type { FixWhat, PRAct } from './Info'
import type { Collision } from '../../shared/overlap'
import type { WidgetApi } from './Widgets'
import type { menusOf } from './menus'
import type { layoutOf } from './TabBar'
import type { sideOf } from './Sidebar'
import { AGENT_COLORS } from './ui'
import { shownStatus, wsShown } from './text'

// the page or dialog over the workspace, App's `dialog`
export type Dialog = null | 'scriptLogs' | 'new' | 'project' | 'palette' | 'starters' | 'onboard' | 'files' | 'ship' | 'custom' | 'settings' | 'help' | 'about' | 'board' | 'achievements' | 'bird' | 'ai' | 'usage' | 'calendar' | 'desk' | 'todos' | 'schedules' | 'fun' | 'video' | 'timer' | { timer: string } | { timerNote: string } | { remind: string } | { sendLater: string; edit?: string; to?: string; text?: string; back?: 'ai' } | { timerCmd: string } | { schedules: string } | { compare: string } | { widget: string; back?: Dialog } | { extension: string; back?: Dialog; tab?: ExtTab; edit?: string; start?: DeskAsk; key?: string } | { uikit: true; icons?: boolean; back?: Dialog } | { settings: string; script?: 'run'; spot?: string } | { section: string; spot?: string } | { rename: string } | { renameWs: string } | { sep: string; id?: string } | { logs: string; title: string; back?: Dialog } | { attachPr: string } | { importWt: string } | { importChats: string } | { ciLog: string; job: string; name: string; url?: string } | { notes: string } | { project: string; tab?: ProjectTab } | { specs: string; of?: string; kind?: PlanKind; slug?: string; templates?: boolean } | { workflows: string; run?: string; start?: FlowStartAt; wf?: FlowSel; nav?: string } | { note: string }
// the rail layout's kinds (Settings › Appearance › Layout)
export type RailKind = 'projects' | 'shells' | 'browsers'
// a place back and forward go to (settings.history): a page (or none: the workspace view) and the workspace selected
export type Place = { d: Dialog; ws: string | null }
// a file open in the app (the preview's tabs): its workspace, path and line; an artifact's is read-only; ext: a file
// opener's full view (an extension's action with view, on this file) in its place
export type Opened = { ws: string; path: string; line?: number; n: number; edit?: Edit; storage?: boolean; ext?: string }
export type Where = { ws?: string; project?: string; widget?: string; file?: string; storage?: boolean } // what Open in opens: a folder (a widget's too), or a file in a workspace

// a tab's color: its own, else its agent's ('none' turns that off)
export const colorOf = (t?: TabView) => t?.color ?? AGENT_COLORS[t?.preset ?? '']
export const WEB = /\.(x?html?|svg|pdf|xml|json|png|jpe?g|gif|webp)$/i // what browsers show
export const wsName = wsShown
// the sidebar's filter (its funnel): words in a workspace's name, branch or PR, and at most one of these
export const ONLY = [
  ['needs', 'Needs you'],
  ['busy', 'Working'],
  ['pr', 'With a PR'],
] as const
export type Find = { q: string; only?: (typeof ONLY)[number][0] }

// the sidebar's timers: what happens as one ends (a notification and a message always)
export const TIMER_THEN = [
  ['notify', 'Just tell me', 'bell'],
  ['pause', 'Pause the video', 'stop'],
  ['play', 'Play the video', 'run'],
  ['close', 'Close the video', 'x'],
  ['command', 'Run a command…', 'terminal'],
] as const
export type Then = (typeof TIMER_THEN)[number][0]
export type Watch = { id: string; ms: number; from?: number } // a stopwatch
export type Timer = { id: string; end: number; ms: number; then: Then | 'remind' | 'send'; cmd?: string; ws?: string; tab?: string; text?: string; left?: number; note?: string } // cmd: then's command, run in ws; remind: a notification about ws; send: text to the agent tab (Send later); left: paused, the ms it has left (end means nothing then); note: what it's for (Go out), on its bar and as it ends

// an action the ⋯ menus and the palette both show
export type Action = { label: string; icon: IconName; hint?: string; key?: string; danger?: boolean; sub?: string; tip?: string; run: () => void; cmd?: () => void }

export const SCRIPT_ICONS: Record<RunScript, IconName> = { test: 'check', lint: 'search', format: 'code', deploy: 'ship' }

// where a folder opens: editors (one of them is ⌘E's), Finder, terminals
export const EDITOR_IDS = ['cursor', 'zed', 'vscode', 'windsurf', 'antigravity', 'sublime', 'webstorm', 'intellij', 'xcode', 'custom']

export const appIcon = (id: string): IconName => (id === 'finder' ? 'folder' : EDITOR_IDS.includes(id) ? 'code' : 'terminal')

export const tabGlyph = (t: TabView) => (t.limit ? 'limit' : t.done && t.status === 'idle' ? 'done' : t.status === 'exited' && t.code === 0 ? 'ok' : shownStatus(t))

// its PR as #n (the scan's, else the linked URL's): ⌘K and the sidebar's filter find a workspace by its PR's number
export const prNum = (w: WorkspaceView) => (n => (n ? `#${n}` : undefined))(w.pr?.number ?? /\/pull\/(\d+)/.exec(w.prUrl ?? '')?.[1])

// App's state and helpers its parts read: a field each, sorted
// a workspace's state in words, for the sidebar's Extended and Cards rows
export const STATE_WORDS: Record<string, string> = { waiting: 'needs you', running: 'working', done: 'done', idle: 'idle', exited: 'stopped', limit: 'at its usage limit' }
export const clip = (s: string, n = 60) => (t => (t.length > n ? `${t.slice(0, n - 1)}…` : t))(s.replace(/\s+/g, ' ')) // a message on one line
// a timer's quick lengths, minutes
export const MINUTES = [1, 5, 10, 15, 25, 30, 45, 60]
export const span = (ms = 0) => (ms % 3600000 === 0 ? `${ms / 3600000} h` : ms % 60000 === 0 ? `${ms / 60000} min` : [Math.floor(ms / 60000) && `${Math.floor(ms / 60000)} min`, `${Math.round((ms % 60000) / 1000)} s`].filter(Boolean).join(' '))

export type AppBase = {
  accountsOf: (agent?: string) => (Account | { id: string; name: string })[]
  achKept: AchievementsKept
  aiDock: boolean
  allows: (w: WorkspaceView, k: 'approve' | 'close' | 'merge' | 'land') => boolean
  anchor: RefObject<string | null>
  apps: AppInfo[]
  archive: (w: WorkspaceView, asked?: boolean) => Promise<void>
  attachable: (w: WorkspaceView) => boolean
  busyWith: <T>(ids: string[], what: string, f: () => Promise<T>) => Promise<T>
  byId: (id: string) => TabView | undefined
  call: <T>(method: string, params?: object) => Promise<T>
  canLater: boolean
  closePage: (w: WorkspaceView) => Promise<void>
  closePreview: () => Promise<undefined>
  closeTabs: (ts: TabView[]) => Promise<void>
  copy: (text: string) => Promise<void>
  copyTab: (t: TabView) => undefined
  costsOn: boolean
  ctxLook: "line" | "ring" | "status" | undefined
  ctxOn: boolean
  devRunning: boolean
  devTab: TabView | undefined
  dialog: Dialog
  dock: (on: boolean) => void | NodeJS.Timeout
  done: (text: string, undo?: () => void) => void
  doStep: (w: WorkspaceView, s: Step, e?: React.MouseEvent) => void | Window | null
  dropAgent: (w: WorkspaceView) => TabView
  dropOn: string | null
  dropProps: (w: WorkspaceView) => { onDragOver: (e: React.DragEvent) => void | false; onDragLeave: (e: React.DragEvent) => void | false; onDrop: (e: React.DragEvent) => void }
  editor: string
  editorName: string
  editScripts: () => void | undefined
  extItems: (show: string, x: WorkspaceView | undefined | null, ctx: WidgetCtx, file?: string) => MenuItem[]
  extMenus: (show: string, x?: WorkspaceView | null, file?: string) => { w: WidgetView; m: WidgetMenu }[]
  extOn: (x?: WorkspaceView | null) => WidgetView[]
  extRun: (w: WidgetView, m: WidgetMenu, ctx: WidgetCtx, into?: (t: Inserted) => void) => Promise<void>
  fail: (e: unknown) => void
  find: Find | null
  findIn: () => boolean
  fitFoot: (el: HTMLDivElement | null) => (() => void) | undefined
  floated: string[]
  floatTab: (id: string, on?: boolean) => void | undefined
  flowItems: WorkflowItem[]
  flowMenu: (w: WorkspaceView) => MenuItem[]
  flowsHere: (w: WorkspaceView) => WorkflowItem[]
  flowsOn: boolean
  fold: (id: string) => void
  folded: string[]
  footButtons: (words: boolean, bar?: boolean) => React.JSX.Element
  forkWs: (w: WorkspaceView) => Promise<void>
  full: boolean
  gallery: string | null
  git: boolean
  going: Record<string, string>
  group: Layout | null
  groupMoves: (ws_: WorkspaceView[]) => MenuItem[]
  groups: Layout[]
  hereCtx: () => WidgetCtx
  hist: RefObject<{ at: Place[]; i: number; going?: string | undefined }>
  histNav: false | React.JSX.Element
  historyOn: boolean
  info: boolean
  inReader: (id: string) => boolean
  isTerm: (w: WorkspaceView) => boolean
  kb: KeyMap
  keyText: (k: string) => string
  kh: (id: KeyId) => string | undefined
  kindOf: (w: WorkspaceView) => RailKind
  kt: (title: string, id: KeyId) => string
  labels: boolean
  laterCancel: (w: WorkspaceView) => Promise<void>
  laterChange: (w: WorkspaceView) => Promise<void>
  laterNow: (w: WorkspaceView) => undefined
  layoutWait: RefObject<{ ws: string; tree: RoleLayout; panel?: { open: boolean; tab?: string | undefined; w?: number | undefined } | undefined; needs: Role; until: number } | null>
  listOff: boolean
  live: WorkspaceView[]
  making: { key: number; project: string; place?: string | undefined; name: string }[]
  mark: (m: RowMark) => boolean
  markUnread: (id: string) => Promise<unknown>
  moveWs: (d: number) => void | undefined
  narrow: boolean
  needAfter: () => TabView
  needing: TabView[]
  needsYou: (t: TabView) => boolean
  newIn: (p: Project) => void | Promise<void>
  newTab: (preset: string, cmd?: string | undefined, w?: WorkspaceView | null, own?: boolean) => Promise<void | null>
  newTabActions: Action[]
  newWord: (p: Project) => "New browser" | "New terminal" | "New workspace"
  newWs: (projectId?: string, init?: Partial<NewWsParams>) => void
  nextNeed: () => void
  onboard: { done: string[]; seen?: boolean | undefined; off?: boolean | undefined }
  onboardDone: Set<string>
  openIn: (app: string, where?: Where) => void
  openInItems: (where?: Where) => MenuItem[]
  openMenu: (e: DOMRect | React.MouseEvent<Element, MouseEvent>, items: MenuItem[], align?: "left" | "right" | undefined) => void
  openPort: (port: number) => void | Window | null
  openProject: () => Promise<void>
  openReview: () => void | null
  order: WorkspaceView[]
  ownWidgets: WidgetView[]
  panelOpen: boolean
  panelShown: boolean
  panelTab: PanelTab
  panelW: number
  peek: { id: string; top: number; left: number } | null
  peekBox: RefObject<HTMLDivElement | null>
  peekStat: { id: string; stat: Stat } | null
  peekTimer: RefObject<number>
  picked: string[]
  picking: boolean
  pickKey: string
  pinned: WorkspaceView[]
  prAct: (w: WorkspaceView, act: PRAct, method?: MergeMethod) => Promise<void | false>
  previewed: Opened | null
  prFix: (w: WorkspaceView, what: FixWhat, job?: string) => Promise<boolean>
  prMenu: (w: WorkspaceView) => MenuItem[]
  project: Project | undefined
  projOf: (w?: { project: string } | null) => Project | undefined
  quickNew: (kind: "browsers" | "shells", url?: string | undefined, front?: boolean, at?: { project: string; place?: string | undefined } | undefined) => Promise<void>
  radarOf: (w: WorkspaceView) => Collision[]
  rail: boolean
  railBar: false | React.JSX.Element
  railKind: RailKind
  railOf: (k?: RailKind) => RailKind
  rawKind: (w: WorkspaceView) => RailKind
  readerOn: boolean
  refreshPR: () => Promise<void>
  restart: (id: string, ms: number) => void
  restore: (id: string) => Promise<void>
  reviewOn: boolean
  reviewSeen: Record<string, string>
  reviewTab: boolean
  ring: (id: string) => void
  rmItem: (w: WorkspaceView) => MenuItem
  roleTabs: (w: WorkspaceView, gs: Layout[]) => RoleTab[]
  rows: ReturnType<typeof useRowDrag>
  run: () => Promise<void | null>
  runFlow: (f: WorkflowItem, ws?: string) => void
  runMenu: (w?: WorkspaceView | null) => MenuItem[]
  runScript: (w: WorkspaceView, k: RunScript) => Promise<void>
  selectGroup: (g: Layout) => void
  selectTab: (ref: string | { id: string; workspace: string }) => void
  sendLater: (to?: string, text?: string) => void
  setDialog: Dispatch<SetStateAction<Dialog>>
  setFind: Dispatch<SetStateAction<Find | null>>
  setFinds: Dispatch<SetStateAction<Record<string, number>>>
  setFolded: Dispatch<SetStateAction<string[]>>
  setGroups: (next: Layout[]) => void | false | null
  setOnboard: Dispatch<SetStateAction<{ done: string[]; seen?: boolean | undefined; off?: boolean | undefined }>>
  setOverlapsAt: Dispatch<SetStateAction<{ w: string; list?: Collision[] | undefined; err?: string | undefined } | null>>
  setPanelOpen: Dispatch<SetStateAction<boolean>>
  setPanelTab: Dispatch<SetStateAction<PanelTab>>
  setPanelW: Dispatch<SetStateAction<number>>
  setPeek: (p: { id: string; top: number; left: number } | null) => undefined
  setPicked: Dispatch<SetStateAction<string[]>>
  setPicking: Dispatch<SetStateAction<boolean>>
  setRead: (id: string, m: 'reader' | 'term') => void
  setReveal: Dispatch<SetStateAction<string[]>>
  setSharing: Dispatch<SetStateAction<string | null>>
  setSideOpen: (v: boolean | ((o: boolean) => boolean)) => void
  setStrip: (k: RailKind, at?: 'left' | 'right') => void
  setTimer: (id: string, f: (t: Timer) => Timer | null) => void
  setTimers: Dispatch<SetStateAction<Timer[]>>
  settings: Settings
  setVideo: Dispatch<SetStateAction<{ src: string; play?: boolean | undefined; at?: number | undefined; min?: boolean | undefined } | null>>
  setWatch: (id: string, f: (w: Watch) => Watch | null) => void
  setWsId: Dispatch<SetStateAction<string | null>>
  showInfo: (on?: boolean) => void
  showPanel: (t: PanelTab) => void
  sideOpen: boolean
  sideW: number
  sortedRows: (p: Project, ws: WorkspaceView[]) => (Sep | WorkspaceView)[]
  sortItems: (cur: WsSort | undefined, pick: (s: WsSort | undefined) => void, inherit?: WsSort) => MenuItem[]
  specsOn: boolean
  split: (edge: "bottom" | "right", next?: string) => Promise<void>
  staleMin: number
  start: (e: React.PointerEvent, tab: string, whole: boolean) => void
  statKey: string
  stepItem: (w: WorkspaceView) => MenuItem[]
  stepOf: (w: WorkspaceView) => Step | undefined
  stepsOn: boolean
  strip: "left" | "right" | undefined
  tab: TabView
  tabByWs: Record<string, string>
  tabsAt: "bottom" | "left" | "right" | "top"
  targets: AppInfo[]
  termIn: (p: Project, place?: string) => Promise<void>
  termsOk: boolean
  termWhere: (p: Project) => string
  timers: Timer[]
  tint: (w: WorkspaceView) => string | undefined
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean) => void
  toggleArtifacts: () => void
  toggleFull: (on?: boolean) => void | undefined
  togglePanel: (t?: PanelTab) => void
  toSettings: () => void
  travel: (j: number) => void
  video: { src: string; play?: boolean | undefined; at?: number | undefined; min?: boolean | undefined } | null
  view: View
  waits: RefObject<Map<string, string>>
  watches: Watch[]
  wideBar: boolean
  widgetApi: WidgetApi
  ws: WorkspaceView | null
  wsActions: Action[]
  wsAt: (d: number) => WorkspaceView | undefined
  wsMore: () => MenuItem[]
  zoom: (d: number) => void
}

// and what the parts App builds first give the ones after: the menus (menusOf), the Layout menu (layoutOf)
export type AppCtx = AppBase & ReturnType<typeof menusOf> & ReturnType<typeof layoutOf> & ReturnType<typeof sideOf>
