// What App's parts read of App: menus.ts, keydown.ts, Palette.tsx, TabBar.tsx, Sidebar.tsx and Dialogs.tsx. App builds
// it each render, after `if (!view)` (so `view` is there), from its own state and helpers: all state and every hook
// stay in App, and a part destructures what it uses. A new field: its type here, then its name in App's `appBase`.
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ExtTab } from './Extension'
import type { DeskAsk } from './Desk'
import type { ProjectTab } from './Project'
import type { Account, AchievementsKept, Gate, MergeMethod, PlanKind, PlanPin, Project, RunScript, Sep, Settings, Stat, TabView, View, WidgetCtx, WidgetMenu, WidgetView, WorkspaceView, WsSort } from '../../shared/types'
import type { FlowStartAt, Sel as FlowSel } from './Workflows'
import type { Edit, PanelApi, PanelTab } from './SidePanel'
import type { IconName, MenuItem, useRowDrag } from './ui'
import type { Achievement } from '../../shared/achievements'
import type { AppInfo, RowMark, SkillInfo, WidgetsApi } from './Settings'
import type { Step } from '../../shared/nextStep'
import type { Inserted, Inserts } from './PromptInput'
import type { SayModal } from '../../shared/widget'
import type { WorkflowItem } from '../../shared/workflow'
import type { Layout, Role, RoleLayout, RoleTab } from '../../shared/layout'
import type { KeyId, KeyMap } from '../../shared/keys'
import type { NewWsParams, Shot } from './panels'
import type { Collision } from '../../shared/overlap'
import type { Notice, ShownPop, ShownWin } from './Shown'
import type { FixWhat, PRAct } from './Info'
import type { WidgetApi } from './Widgets'
import type { menusOf } from './menus'
import type { layoutOf } from './TabBar'
import type { sideOf } from './Sidebar'
import { AGENT_COLORS } from './ui'
import { shownStatus, wsShown } from './text'

// the page or dialog over the workspace, App's `dialog`
export type Dialog = null | 'inbox' | 'scriptLogs' | 'new' | 'project' | 'palette' | 'starters' | 'onboard' | 'files' | 'ship' | 'custom' | 'settings' | 'help' | 'about' | 'board' | 'achievements' | 'bird' | 'ai' | 'usage' | 'calendar' | 'desk' | 'todos' | 'schedules' | 'fun' | 'video' | 'timer' | 'importantTimer' | { timer: string } | { timerNote: string } | { remind: string } | { sendLater: string; edit?: string; to?: string; text?: string; back?: 'ai' } | { timerCmd: string } | { schedules: string } | { compare: string } | { widget: string; back?: Dialog } | { extension: string; back?: Dialog; tab?: ExtTab; edit?: string; start?: DeskAsk; key?: string } | { uikit: true; icons?: boolean; back?: Dialog } | { settings: string; script?: 'run'; spot?: string } | { section: string; spot?: string } | { rename: string } | { renameWs: string } | { sep: string; id?: string } | { logs: string; title: string; back?: Dialog } | { attachPr: string } | { importWt: string } | { importChats: string } | { ciLog: string; job: string; name: string; url?: string } | { notes: string } | { project: string; tab?: ProjectTab } | { specs: string; of?: string; kind?: PlanKind; slug?: string; templates?: boolean } | { workflows: string; run?: string; start?: FlowStartAt; wf?: FlowSel; nav?: string } | { note: string }
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
export type Find = { q: string; only?: (typeof ONLY)[number][0]; projects?: string[] } // projects: only these (none: all)

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
export type Timer = { id: string; end: number; ms: number; then: Then | 'remind' | 'send'; cmd?: string; ws?: string; tab?: string; text?: string; left?: number; note?: string; important?: boolean } // important: its end a card on screen (main's addCard), not the dialog; cmd: then's command, run in ws; remind: a notification about ws; send: text to the agent tab (Send later); left: paused, the ms it has left (end means nothing then); note: what it's for (Go out), on its bar and as it ends

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

// the Settings page, in any of its forms: all of it, a project's, or a section asked for
export const settingsOf = (d: Dialog) => d === 'settings' || (typeof d === 'object' && !!d && ('settings' in d || 'section' in d))
// the Specs page: specs is a project's id, '' all; kind and slug, the one to open
export const specsOf = (d: Dialog) => (d && typeof d === 'object' && 'specs' in d ? d : undefined)
// the Notes page: note, the one open ('': the first)
export const notesOf = (d: Dialog) => (d && typeof d === 'object' && 'note' in d ? d : undefined)
// the Workflows page: run, the run to open
export const flowsOf = (d: Dialog) => (d && typeof d === 'object' && 'workflows' in d ? d : undefined)
// an extension's page (Extension.tsx): its id ('' a new one), and the page it goes back to
export const extOf = (d: Dialog) => (d && typeof d === 'object' && 'extension' in d ? d : undefined)
// an extension page's key: a new one's its dialog's own, kept as its first ask names it (key), so it isn't drawn again then
const extKeys = new WeakMap<object, string>()
export const extKey = (e: { extension: string; key?: string }) => e.key ?? (e.extension || extKeys.get(e) || (k => (extKeys.set(e, k), k))(`new-${Math.random().toString(36).slice(2)}`))
// the Extension page's way back, in words
export const PAGE_WORDS: Record<string, string> = { ai: 'AI', desk: 'My Desk', todos: 'To-dos', calendar: 'Calendar', board: 'Board', achievements: 'Achievements', bird: 'Bird view', schedules: 'Schedule', help: 'Help', usage: 'Usage' }
export const backWord = (d: Dialog | undefined) => (d && typeof d === 'object' && 'section' in d && d.section === 'widgets' ? 'Extensions' : settingsOf(d ?? null) ? 'Settings' : (typeof d === 'string' && PAGE_WORDS[d]) || 'Back')

export type AppBase = {
  accountsOf: (agent?: string) => (Account | { id: string; name: string })[]
  achAll: Achievement[]
  achHidden: string[]
  achKept: AchievementsKept
  achN: number
  achRef: RefObject<AchievementsKept>
  achSet: (o: AchievementsKept) => Promise<any>
  addTimer: (ms: number, more?: Partial<Timer>) => void
  aiDock: boolean
  aiNames: { id: string; name: string }[]
  allows: (w: WorkspaceView, k: 'approve' | 'close' | 'merge' | 'land') => boolean
  anchor: RefObject<string | null>
  apps: AppInfo[]
  archive: (w: WorkspaceView, asked?: boolean) => Promise<void>
  artMenu: (w: WorkspaceView, path: string) => MenuItem[]
  artPage: (w: WorkspaceView, path: string) => string | undefined
  artView: { ws: string; path: string } | null
  asFile: (w: WorkspaceView, path: string) => (() => undefined) | undefined
  attachable: (w: WorkspaceView) => boolean
  bgUrl: string
  busyWith: <T>(ids: string[], what: string, f: () => Promise<T>) => Promise<T>
  byId: (id: string) => TabView | undefined
  call: <T>(method: string, params?: object) => Promise<T>
  calOn: boolean
  canLater: boolean
  cfgSheet: (p: Project) => Promise<void>
  checking: string | undefined
  closePage: (w: WorkspaceView) => Promise<void>
  closePreview: () => Promise<undefined>
  closeTabs: (ts: TabView[]) => Promise<void>
  reopenTab: (w?: WorkspaceView | null, index?: number) => Promise<unknown>
  copy: (text: string) => Promise<void>
  copyTab: (t: TabView) => undefined
  costsOn: boolean
  ctxLook: "line" | "ring" | "status" | undefined
  ctxOn: boolean
  deskOn: boolean
  devRunning: boolean
  devTab: TabView | undefined
  dialog: Dialog
  dock: (on: boolean) => void | NodeJS.Timeout
  done: (text: string, undo?: () => void) => void
  doStep: (w: WorkspaceView, s: Step, e?: React.MouseEvent) => void | Window | null
  dropAgent: (w: WorkspaceView) => TabView
  dropOn: string | null
  dropProps: (w: WorkspaceView) => { onDragOver: (e: React.DragEvent) => void | false; onDragLeave: (e: React.DragEvent) => void | false; onDrop: (e: React.DragEvent) => void }
  earn: (id: string) => void
  editor: string
  editorName: string
  editScripts: () => void | undefined
  extCfg: WidgetsApi
  extInserts: (ctx?: WidgetCtx, project?: string) => Inserts
  extItems: (show: string, x: WorkspaceView | undefined | null, ctx: WidgetCtx, file?: string) => MenuItem[]
  extMenus: (show: string, x?: WorkspaceView | null, file?: string) => { w: WidgetView; m: WidgetMenu }[]
  extModal: { wid: string; ws?: string | undefined; m: SayModal; n: number } | null
  extOn: (x?: WorkspaceView | null) => WidgetView[]
  extRun: (w: WidgetView, m: WidgetMenu, ctx: WidgetCtx, into?: (t: Inserted) => void) => Promise<void>
  extWs: (x?: WorkspaceView | null) => WorkspaceView | undefined
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
  fontSize: number
  footButtons: (words: boolean, bar?: boolean) => React.JSX.Element
  forkWs: (w: WorkspaceView) => Promise<void>
  full: boolean
  gallery: string | null
  gated: <T>(w: WorkspaceView, step: Gate, f: (force?: boolean) => Promise<T>) => Promise<T | undefined>
  git: boolean
  going: Record<string, string>
  group: Layout | null
  groupMoves: (ws_: WorkspaceView[]) => MenuItem[]
  groups: Layout[]
  held: { open: boolean; shot: boolean }
  hereCtx: () => WidgetCtx
  hist: RefObject<{ at: Place[]; i: number; going?: string | undefined }>
  histNav: false | React.JSX.Element
  historyOn: boolean
  hotkey: string | null
  inBrowser: (w: WorkspaceView, path: string) => undefined
  info: boolean
  inReader: (id: string) => boolean
  inViewer: (path: string) => boolean
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
  layoutsOn: boolean
  layoutWait: RefObject<{ ws: string; tree: RoleLayout; panel?: { open: boolean; tab?: string | undefined; w?: number | undefined } | undefined; needs: Role; until: number } | null>
  listOff: boolean
  live: WorkspaceView[]
  made: RefObject<{ key: number; page: number }>
  making: { key: number; project: string; place?: string | undefined; name: string }[]
  mark: (m: RowMark) => boolean
  markUnread: (id: string) => Promise<unknown>
  moveWs: (d: number) => void | undefined
  narrow: boolean
  needAfter: () => TabView
  needing: TabView[]
  needsYou: (t: TabView) => boolean
  newFor: string | undefined
  newImages: Shot[]
  newIn: (p: Project) => void | Promise<void>
  newInit: (Partial<NewWsParams> & { linked?: boolean | undefined }) | undefined
  newTab: (preset: string, cmd?: string | undefined, w?: WorkspaceView | null, own?: boolean) => Promise<void | null>
  newTabActions: Action[]
  newWord: (p: Project) => "New browser" | "New terminal" | "New workspace"
  newWs: (projectId?: string, init?: Partial<NewWsParams>) => void
  nextNeed: () => void
  notesOn: boolean
  onboard: { done: string[]; seen?: boolean | undefined; off?: boolean | undefined }
  onboardDone: Set<string>
  openFile: (f: Omit<Opened, 'n'>) => void
  openIn: (app: string, where?: Where) => void
  openInItems: (where?: Where) => MenuItem[]
  openMenu: (e: DOMRect | React.MouseEvent<Element, MouseEvent>, items: MenuItem[], align?: "left" | "right" | undefined) => void
  openPort: (port: number) => void | Window | null
  openProject: () => Promise<void>
  openReview: () => void | null
  order: WorkspaceView[]
  overlapsAt: { w: string; list?: Collision[] | undefined; err?: string | undefined } | null
  own: number
  ownWidgets: WidgetView[]
  pageZoom: number
  panelApi: (w: WorkspaceView) => PanelApi
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
  pinPlan: (r: PlanPin, on: boolean) => void
  placeName: (p: Place) => string
  notices: Notice[]
  answerNotice: (n: Notice, choice?: string) => void
  pops: ShownPop[]
  prAct: (w: WorkspaceView, act: PRAct, method?: MergeMethod) => Promise<void | false>
  previewed: Opened | null
  prFix: (w: WorkspaceView, what: FixWhat, job?: string) => Promise<boolean>
  prMenu: (w: WorkspaceView) => MenuItem[]
  project: Project | undefined
  projOf: (w?: { project: string } | null) => Project | undefined
  quickNew: (kind: "browsers" | "shells", url?: string | undefined, front?: boolean, at?: { project: string; place?: string | undefined } | undefined) => Promise<void>
  radarKey: (w: WorkspaceView, c: Collision) => string
  radarOf: (w: WorkspaceView) => Collision[]
  rail: boolean
  railBar: false | React.JSX.Element
  railKind: RailKind
  railOf: (k?: RailKind) => RailKind
  rawKind: (w: WorkspaceView) => RailKind
  readerOn: boolean
  refreshPR: () => Promise<void>
  reply: { tab: string; text: string; x: number; y: number } | null
  replyTo: (id: string) => TabView[]
  restart: (id: string, ms: number) => void
  restore: (id: string) => Promise<void>
  revealArt: (w: WorkspaceView, path: string) => undefined
  reviewOn: boolean
  reviewSeen: Record<string, string>
  reviewTab: boolean
  ring: (id: string) => void
  rmItem: (w: WorkspaceView) => MenuItem
  rmWs: (w: WorkspaceView) => Promise<void>
  roleTabs: (w: WorkspaceView, gs: Layout[]) => RoleTab[]
  rows: ReturnType<typeof useRowDrag>
  run: () => Promise<void | null>
  runFlow: (f: WorkflowItem, ws?: string) => void
  runMenu: (w?: WorkspaceView | null) => MenuItem[]
  runScript: (w: WorkspaceView, k: RunScript) => Promise<void>
  samePlan: (a: PlanPin, b: { project: string; kind: PlanKind; slug: string }) => boolean
  schedulesFor: string | undefined
  selectGroup: (g: Layout) => void
  selectTab: (ref: string | { id: string; workspace: string }) => void
  sendLater: (to?: string, text?: string) => void
  setAiFloat: Dispatch<SetStateAction<boolean>>
  setArtsIn: Dispatch<SetStateAction<string | null>>
  setArtView: Dispatch<SetStateAction<{ ws: string; path: string } | null>>
  setDialog: Dispatch<SetStateAction<Dialog>>
  setExtModal: Dispatch<SetStateAction<{ wid: string; ws?: string | undefined; m: SayModal; n: number } | null>>
  setFind: Dispatch<SetStateAction<Find | null>>
  setFinds: Dispatch<SetStateAction<Record<string, number>>>
  setFolded: Dispatch<SetStateAction<string[]>>
  setGallery: Dispatch<SetStateAction<string | null>>
  setGroups: (next: Layout[]) => void | false | null
  setMaking: Dispatch<SetStateAction<{ key: number; project: string; place?: string | undefined; name: string }[]>>
  setNewFor: Dispatch<SetStateAction<string | undefined>>
  setNewImages: Dispatch<SetStateAction<Shot[]>>
  setNewInit: Dispatch<SetStateAction<(Partial<NewWsParams> & { linked?: boolean | undefined }) | undefined>>
  setOnboard: Dispatch<SetStateAction<{ done: string[]; seen?: boolean | undefined; off?: boolean | undefined }>>
  setOverlapsAt: Dispatch<SetStateAction<{ w: string; list?: Collision[] | undefined; err?: string | undefined } | null>>
  setPanelOpen: Dispatch<SetStateAction<boolean>>
  setPanelTab: Dispatch<SetStateAction<PanelTab>>
  setPanelW: Dispatch<SetStateAction<number>>
  setPeek: (p: { id: string; top: number; left: number } | null) => undefined
  setPicked: Dispatch<SetStateAction<string[]>>
  setPicking: Dispatch<SetStateAction<boolean>>
  setPops: Dispatch<SetStateAction<ShownPop[]>>
  setRadarHid: Dispatch<SetStateAction<string[]>>
  setRead: (id: string, m: 'reader' | 'term') => void
  setReply: Dispatch<SetStateAction<{ tab: string; text: string; x: number; y: number } | null>>
  setReveal: Dispatch<SetStateAction<string[]>>
  setRunsSeen: Dispatch<SetStateAction<string>>
  setSeenSecs: Dispatch<SetStateAction<string[]>>
  setSharing: Dispatch<SetStateAction<string | null>>
  setShown: Dispatch<SetStateAction<ShownWin[]>>
  setSideOpen: (v: boolean | ((o: boolean) => boolean)) => void
  setStrip: (k: RailKind, at?: 'left' | 'right') => void
  setTimer: (id: string, f: (t: Timer) => Timer | null) => void
  setTimers: Dispatch<SetStateAction<Timer[]>>
  settings: Settings
  settingsKey: number
  setVideo: Dispatch<SetStateAction<{ src: string; play?: boolean | undefined; at?: number | undefined; min?: boolean | undefined } | null>>
  setWatch: (id: string, f: (w: Watch) => Watch | null) => void
  setWsId: Dispatch<SetStateAction<string | null>>
  budgetSaid: { current: string } // the memory budget: why nothing could be unloaded
  sharing: string | null
  shotKey: string | false | null
  showInfo: (on?: boolean) => void
  shown: ShownWin[]
  showNew: (id: string, ...more: string[]) => void
  shownWidgets: WidgetView[]
  showPanel: (t: PanelTab) => void
  sideOpen: boolean
  sideW: number
  sortedRows: (p: Project, ws: WorkspaceView[]) => (Sep | WorkspaceView)[]
  sortItems: (cur: WsSort | undefined, pick: (s: WsSort | undefined) => void, inherit?: WsSort) => MenuItem[]
  specsOn: boolean
  split: (edge: "bottom" | "right", next?: string) => Promise<void>
  stale: (rows: SkillInfo[]) => void
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
  todosOn: boolean
  toggleArtifacts: () => void
  toggleFull: (on?: boolean) => void | undefined
  togglePanel: (t?: PanelTab) => void
  toSettings: () => void
  touch: boolean
  travel: (j: number) => void
  video: { src: string; play?: boolean | undefined; at?: number | undefined; min?: boolean | undefined } | null
  view: View
  waits: RefObject<Map<string, string>>
  watches: Watch[]
  whereNow: () => Promise<string>
  wideBar: boolean
  widgetApi: WidgetApi
  ws: WorkspaceView | null
  wsActions: Action[]
  wsAt: (d: number) => WorkspaceView | undefined
  wsHere: string | null
  wsMore: () => MenuItem[]
  zoom: (d: number) => void
}

// and what the parts App builds first give the ones after: the menus (menusOf), the Layout menu (layoutOf)
export type AppCtx = AppBase & ReturnType<typeof menusOf> & ReturnType<typeof layoutOf> & ReturnType<typeof sideOf>
