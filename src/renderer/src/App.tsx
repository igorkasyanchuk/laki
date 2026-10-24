import { type CSSProperties, lazy, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { aiOn, neverAsks, PERMS, type Agent, flowsOn as flowsOnIn, specsOn as specsOnIn, jobOf, type Account, type StudioChat, type Gate, type GateHeld, type WidgetLogLine, type WidgetRuns, againOnEnter, placesOf, type RunScript, type AccountView, type AchievementsKept, type CompactLogLine, AGENT_NAMES, API, HOME_ACCOUNT, isAccountAgent, RAIL_PINS, rowsOf, type WsSort, type Doctor, type LogLine, type MergeMethod, PR_SCAN, PR_TRIES, prAllows, prIn, type PR, type PRLabel, type Project, type ProjectLook, type Sep, type SideLook, type NotifyKind, type PlanKind, type PlanPin, type ProjectConfig, type Resources, type TabView, type View, type WidgetCtx, type WidgetMenu, type WidgetView, type WorkspaceView, type ActionFile } from '../../shared/types'
import { planTemplates, specPrompt } from '../../shared/plans'
import { parseAt, stamp } from '../../shared/when'
import { api, bridge, daemonBase, reportView, type Msg, notify, type NotifyAction, onLakiLink, openExternal, openKeptLink, pageNow } from './api'
import { DOCK_ICONS, dockPng } from './dock'
import { BrowserPane } from './Browser'
import { FullReview, type ReviewApi } from './FullReview'
import { ago, type AutoKey, Avatar, type Check, CiMark, ciText, type FixWhat, InfoTab, type LabelApi, MERGE_WORDS, type PRAct, prState, PRStatus, REVIEW, reviewersText, showAvatars, type WsInfo } from './Info'
import { KeyOverlay } from './KeyOverlay'
import { type NeedsApi, NeedsList, needsSorted } from './Needs'
import { About, AddProject, type Artifact, ArtifactsBar, ArtifactView, VIEWED, CiLog, Fun, Loading, Logs, OnboardBar, Onboarding, ProjectNotes, type Meme, NewWorkspace, type NewWsParams, Palette, type PaletteItem, Prompt, Ready, QueueStrip, RemindDialog, SendLaterDialog, type Shot, StarLaki, STEPS, StopwatchBar, TimerBar, TimerDialog, Video, videoCommand, Welcome } from './panels'
import { type AccountsApi, type AppInfo, extMenuItems, FONT_SIZE, isSection, PAGE_ZOOMS, RAIL_ITEMS, railSorted, SettingsPage, type SkillInfo, termLook, type WidgetsApi } from './Settings'
import { AiPage } from './Ai'
import { Picker, PICKER_KEY } from './Picker'
import { isKeyId, type KeyId, keyFor, keyMap, keyShow } from '../../shared/keys'
import { CalendarPage } from './Calendar'
import { type DeskAsk, DeskPage, onDesk } from './Desk'
import { completeOf, type Inserted, type Inserts, keepFile, VoiceBar, withImages } from './PromptInput'
import { ProjectPage, type ProjectTab } from './Project'
import { BirdPage } from './Bird'
import { BoardPage } from './Board'
import { AchievementsPage } from './Achievements'
import { ACHIEVEMENTS, earnedBy, pageEarns, upsOf, wentUp } from '../../shared/achievements'
import { StarterPicker, UiKitPage } from './UiKit'
import { Glyph as ExtGlyph, imagesVia, insertMenus, inWs, RowMarks, rowMarks, status as extStatus, type WidgetApi, WidgetBody, WidgetButtons, WidgetDialog, WidgetGrid, WidgetModal, WidgetPanel, WidgetStrip } from './Widgets'
import type { SayModal, WidgetSay } from '../../shared/widget'
import type { UiDo, UiProblem } from '../../shared/widgetUi'
import { globMatch, pressOf } from '../../shared/widgetSchema'
import { type ExtTab, ExtensionPage } from './Extension'
import { ComparePage } from './Compare'
import type { FlowStartAt, Sel as FlowSel } from './Workflows'
import { FLOW_ENDED, type WorkflowItem } from '../../shared/workflow'
import { Glyph, rollup } from './Glyph'
import icon from './icon.svg'
import { HelpPage } from './Help'
import { Term, xterms } from './Term'
import { groupsOf, type Layout, move, resize, tabsOf, allAgents, fillRoles, LAYOUT_PRESETS, type Role, rolesIn, type RoleLayout, type RoleTab, type SavedLayout, toRoles } from '../../shared/layout'
import { parseLink, wsLink } from './links'
import { PanelHandle, Panes, SideHandle, useTabDrag } from './Panes'
import { actionMenu, type Changes, type Edit, edited, type FileContent, FileFinder, type FileList, FilePreview, type FilesRoot, type PanelApi, type PanelTab, PANEL_WIDTH, type PRFiles, RunButton, SidePanel, type Thread } from './SidePanel'
import { SchedulesPage } from './Schedules'
import { actionsFor, applySuggestions, pendingWords, prPill, rowFact, clock, csWord, initials, limitsCrossed, limitText, Line, mergeActions, nameOf, parseDuration, type RunAction, shortPath, shownStatus, spins, spinsUntil, templatesFor, USAGE_AT, withPaths, wsShown, youtubeEmbed } from './text'
import { applyTheme, blurred, css, LESS_CLEAR, MORE_CONTRAST, type Paint, paintKey, paintOf, transparent } from './themes'
import { type Cloudflared, portsOf, SharePop, timeLeft, TunnelButton, type TunnelApi } from './Tunnel'
import { type ShownPop, ShownDialog, ShownPops, type ShownWin } from './Shown'
import { type AgentUsage, ctxPct, ctxText, level, Ring, USAGE_AGENTS, UsageButton, usageText } from './Usage'
import { ask, askText, AskHost, choose, unchoose, colorVar, Elapsed, type Fact, Icon, IconButton, iconItems, type IconName, ProjectMark, keep as store, load, type MenuItem, moveId, ON, Page, StaleDaemon, TAB_COLORS, Tips, TurnTime, useMenu, useRowDrag, keyLabel, keyRec, HOTKEY, SHOT_KEY } from './ui'
import { emojiOf } from '../../shared/icons'

declare const __BUILT__: string | undefined // electron.vite.config.ts' define: the build's time, the daemon's too
// a daemon older than this app: a lower API, or the same API from an earlier build (it outlives app updates)
// Laki AI's glow (experimental): a moving border and a soft inner light over the pane of the tab it looked at, else the
// whole window; once (its own animation's end clears it)
function PeekGlow({ tab, onDone }: { tab?: string; onDone: () => void }) {
  const el = tab ? document.querySelector(`[data-pane="${CSS.escape(tab)}"]`) : null
  const r = el?.getBoundingClientRect() // ponytail: measured as it starts; a resize meanwhile leaves it where it was
  // seen: its middle or a corner is the pane's, not a page's or a panel's over it
  const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-pane]') === el
  const on = !!r?.width && !!r.height && [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].some(([fx, fy]) => at(r.left + r.width * fx, r.top + r.height * fy))
  return <div className={`ai-peek ${on ? '' : 'whole'}`} style={on ? { left: r!.left, top: r!.top, width: r!.width, height: r!.height } : undefined} onAnimationEnd={e => e.animationName === 'ai-peek' && onDone()} aria-hidden />
}
// the floating Laki AI chat, dragged by its head (not its buttons) anywhere over the main area, resized by its edges and
// corners; where it was left is laki.aiFloatAt (right and bottom, px), held inside the area as it changes size, and its
// size laki.aiFloatSize (CSS keeps it inside the area); a double-click on the head puts both back
type FloatAt = { right: number; bottom: number }
type FloatSize = { width: number; height: number }
const GRIPS = ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']
const DOCK_MS = 320 // the AI button's way down into the status bar: styles.css' ai-dock
function AiFloat({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<FloatAt | null>(() => load<FloatAt | null>('laki.aiFloatAt', null))
  const [size, setSize] = useState<FloatSize | null>(() => load<FloatSize | null>('laki.aiFloatSize', null))
  const now = useRef({ at, size })
  now.current = { at, size }
  const [moving, setMoving] = useState('') // moving, or sizing-<grip>: the cursor everywhere meanwhile
  // 8px inside its area at least, so its head stays in reach
  const fit = (p: FloatAt): FloatAt => {
    const el = box.current
    const area = el?.offsetParent as HTMLElement | null
    if (!el || !area) return p
    const keep = (v: number, max: number) => Math.round(Math.max(8, Math.min(v, max - 8)))
    return { right: keep(p.right, area.clientWidth - el.offsetWidth), bottom: keep(p.bottom, area.clientHeight - el.offsetHeight) }
  }
  useLayoutEffect(() => {
    const area = box.current?.offsetParent
    if (!area) return
    const ro = new ResizeObserver(() => setAt(a => (a ? fit(a) : a)))
    ro.observe(area)
    return () => ro.disconnect()
  }, [])
  const head = (e: { target: EventTarget }) => {
    const t = e.target as Element
    return !!t.closest('.ai-win-head') && !t.closest('button, a, input, select, textarea')
  }
  // a drag: its moves and release come here even over a frame or outside the window; then where it is, and its size, kept
  const track = (e: React.PointerEvent, how: string, move: (m: PointerEvent, area: DOMRect, r: DOMRect) => void) => {
    const el = box.current
    if (e.button !== 0 || !el?.offsetParent) return
    e.preventDefault() // no text selected on the way
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const area = (el.offsetParent as HTMLElement).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const go = (m: PointerEvent) => (setMoving(how), move(m, area, r))
    const up = () => {
      window.removeEventListener('pointermove', go)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setMoving('')
      if (now.current.at) store('laki.aiFloatAt', now.current.at)
      if (now.current.size) store('laki.aiFloatSize', now.current.size)
    }
    window.addEventListener('pointermove', go)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const onHead = useRef(false) // the press was on the head: a double-click's target is the box itself (the pointer was captured)
  const down = (e: React.PointerEvent) =>
    (onHead.current = head(e)) &&
    track(e, 'moving', (m, area, r) => setAt(fit({ right: area.right - r.right - (m.clientX - e.clientX), bottom: area.bottom - r.bottom - (m.clientY - e.clientY) })))
  // an edge or a corner: its far side stays where it is
  const grab = (e: React.PointerEvent, g: string) =>
    (onHead.current = false) ||
    track(e, `sizing-${g}`, (m, area, r) => {
      const dx = m.clientX - e.clientX
      const dy = m.clientY - e.clientY
      const keep = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(v, hi)))
      const w = g.includes('l') ? keep(r.width - dx, 320, r.right - area.left - 8) : g.includes('r') ? keep(r.width + dx, 320, area.right - r.left - 8) : r.width
      const h = g.includes('t') ? keep(r.height - dy, 280, r.bottom - area.top - 8) : g.includes('b') ? keep(r.height + dy, 280, area.bottom - r.top - 8) : r.height
      setSize({ width: Math.round(w), height: Math.round(h) })
      if (g.includes('r') || g.includes('b')) setAt({ right: Math.round(area.right - r.right - (g.includes('r') ? w - r.width : 0)), bottom: Math.round(area.bottom - r.bottom - (g.includes('b') ? h - r.height : 0)) })
    })
  const reset = () => onHead.current && (setAt(null), setSize(null), store('laki.aiFloatAt', undefined), store('laki.aiFloatSize', undefined))
  return (
    <div ref={box} className={`ai-float ${moving}`} style={{ ...at, ...size }} onPointerDown={down} onDoubleClick={reset}>
      {children}
      {GRIPS.map(g => (
        <div key={g} className={`ai-grip ${g}`} onPointerDown={e => grab(e, g)} aria-hidden />
      ))}
    </div>
  )
}
const staleDaemon = (v: { api?: number; built?: string }) => (v.api ?? 0) < API || (typeof __BUILT__ === 'string' && !!v.built && v.built < __BUILT__)

const SpecsPage = lazy(() => import('./Specs')) // BlockNote, Mantine and React Flow with it: loaded as it opens, so on by default costs nothing until then
const WorkflowsPage = lazy(() => import('./Workflows').then(m => ({ default: m.WorkflowsPage }))) // loaded as it opens
const WidgetStudio = lazy(() => import('./WidgetStudio').then(m => ({ default: m.WidgetStudio }))) // Laki AI's: loaded as it opens
const NotesPage = lazy(() => import('./Notes')) // experimental, and BlockNote with it: loaded as it opens
const TodoListPage = lazy(() => import('./TodoList')) // experimental, and BlockNote with it: loaded as it opens
// what a lazy page shows while its code loads (the first open): its frame, not the workspace under it for a moment
const Waiting = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <Page title={title} wide esc={false} onClose={onClose}>
    {null}
  </Page>
)

// Run ▾'s project scripts besides run (RUN_SCRIPTS)
const SCRIPT_LABELS: Record<RunScript, string> = { test: 'Test', lint: 'Lint', format: 'Format', deploy: 'Deploy…' }
const SCRIPT_ICONS: Record<RunScript, IconName> = { test: 'check', lint: 'search', format: 'code', deploy: 'ship' }
// an extension tool's asks: one dialog at a time, the others in line (tagged by req); toolOn: the one on screen
type ToolAsk = { req: string; title: string; text: string; picks: { label: string; allow: 'once' | 'always' | 'deny' }[]; answer: (allow: string) => void }
const toolLine = new Line<ToolAsk>()
let toolOn: string | undefined
const AWAY = -2 // #18: a page or dialog opened over the ask on screen: it waits, first in line, and comes back as that closes
function toolShow() {
  const t = toolLine.first
  if (!t || toolOn === t.req) return
  if (toolOn) return unchoose(toolOn) // another came first (a notification's click): this one back in line, its then shows it
  toolOn = t.req
  void choose(t.title, t.text, t.picks.map((p, i) => ({ label: p.label, primary: i === 0, danger: p.allow === 'deny' })), undefined, t.req).then(i => {
    toolOn = undefined
    if (i === AWAY) return // App's effect on its dialog shows it again
    // Esc, Deny or outside denies the one on screen only; one answered elsewhere (toolDone) or moved back: just the next
    if (toolLine.first === t) toolLine.drop(t.req), t.answer(t.picks[i]?.allow ?? 'deny')
    toolShow()
  })
}
type Dialog = null | 'new' | 'project' | 'palette' | 'starters' | 'onboard' | 'files' | 'ship' | 'custom' | 'settings' | 'help' | 'about' | 'board' | 'achievements' | 'bird' | 'ai' | 'calendar' | 'desk' | 'todos' | 'schedules' | 'fun' | 'video' | 'timer' | { timer: string } | { timerNote: string } | { remind: string } | { sendLater: string; edit?: string; to?: string; text?: string; back?: 'ai' } | { timerCmd: string } | { schedules: string } | { compare: string } | { widget: string; back?: Dialog } | { extension: string; back?: Dialog; tab?: ExtTab; edit?: string } | { uikit: true; icons?: boolean; back?: Dialog } | { studio: string; back?: Dialog; first?: DeskAsk; key?: string } | { settings: string; script?: 'run'; spot?: string } | { section: string; spot?: string } | { rename: string } | { renameWs: string } | { sep: string; id?: string } | { logs: string; title: string; back?: Dialog } | { attachPr: string } | { ciLog: string; job: string; name: string; url?: string } | { notes: string } | { project: string; tab?: ProjectTab } | { specs: string; kind?: PlanKind; slug?: string } | { workflows: string; run?: string; start?: FlowStartAt; wf?: FlowSel; nav?: string } | { note: string }

// the Scheduled tasks page: closed (undefined), all projects (''), or a project's (its ⋯ menu)
const schedulesOf = (d: Dialog) => (d === 'schedules' ? '' : d && typeof d === 'object' && 'schedules' in d ? d.schedules : undefined)
// the Specs page: specs is a project's id, '' all; kind and slug, the one to open
const specsOf = (d: Dialog) => (d && typeof d === 'object' && 'specs' in d ? d : undefined)
// the Notes page (experimental): note, the one open ('': the first)
const notesOf = (d: Dialog) => (d && typeof d === 'object' && 'note' in d ? d : undefined)
// the Workflows page: run, the run to open
const flowsOf = (d: Dialog) => (d && typeof d === 'object' && 'workflows' in d ? d : undefined)
// the Settings page, in any of its forms: all of it, a project's, or a section asked for
const settingsOf = (d: Dialog) => d === 'settings' || (typeof d === 'object' && !!d && ('settings' in d || 'section' in d))
// an extension's page (Extension.tsx): its id ('' a new one), and the page it goes back to
const extOf = (d: Dialog) => (d && typeof d === 'object' && 'extension' in d ? d : undefined)
const studioOf = (d: Dialog) => (d && typeof d === 'object' && 'studio' in d ? d : undefined)
// a studio's key: a new one's its dialog's own, kept as its first ask names it (key), so it isn't drawn again then
const studioKeys = new WeakMap<object, string>()
const studioKey = (s: { studio: string; key?: string }) => s.key ?? (s.studio || studioKeys.get(s) || (k => (studioKeys.set(s, k), k))(`new-${Math.random().toString(36).slice(2)}`))
// back and forward (settings.history, on unless false): a place is a page (or none: the workspace view) and the workspace
// selected; a dialog over them (⌘K, a rename, a timer) isn't one. HISTORY_MAX back, as a browser's
type Place = { d: Dialog; ws: string | null }
const HISTORY_MAX = 25
const PAGES = new Set(['settings', 'help', 'board', 'achievements', 'bird', 'ai', 'calendar', 'desk', 'todos', 'schedules'])
const PAGE_KEYS = ['schedules', 'compare', 'extension', 'uikit', 'studio', 'settings', 'section', 'project', 'specs', 'workflows', 'note']
const isPlace = (d: Dialog) => d === null || (typeof d === 'string' ? PAGES.has(d) : PAGE_KEYS.some(k => k in d))
// the Extension page's way back, in words
const PAGE_WORDS: Record<string, string> = { ai: 'AI', desk: 'My Desk', todos: 'To-dos', calendar: 'Calendar', board: 'Board', achievements: 'Achievements', bird: 'Bird view', schedules: 'Schedule', help: 'Help' }
const backWord = (d: Dialog | undefined) => (d && typeof d === 'object' && 'section' in d && d.section === 'widgets' ? 'Extensions' : settingsOf(d ?? null) ? 'Settings' : (typeof d === 'string' && PAGE_WORDS[d]) || 'Back')

// a tab's color: its own, else its agent's ('none' turns that off)
const AGENT_COLORS: Record<string, string> = { claude: 'orange', codex: 'teal', gemini: 'blue', grok: 'purple', opencode: 'green' }
const colorOf = (t?: TabView) => t?.color ?? AGENT_COLORS[t?.preset ?? '']

// where a folder opens: editors (one of them is ⌘E's), Finder, terminals
const EDITOR_IDS = ['cursor', 'zed', 'vscode', 'windsurf', 'antigravity', 'sublime', 'webstorm', 'intellij', 'xcode', 'custom']
type Where = { ws?: string; project?: string; widget?: string; file?: string } // what Open in opens: a folder (a widget's too), or a file in a workspace
const WEB = /\.(x?html?|svg|pdf|xml|json|png|jpe?g|gif|webp)$/i // what browsers show
const PICTURE = /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i // what Copy puts on the clipboard as a picture (main's PICS)
const PLAIN = /\.(md|markdown|txt|log|json|jsonl|ya?ml|toml|csv|tsv|xml|html?|css|svg|[cm]?[jt]sx?|py|rb|go|rs|sh|sql|diff|patch)$/i // Copy text: files that are text
const appIcon = (id: string): IconName => (id === 'finder' ? 'folder' : EDITOR_IDS.includes(id) ? 'code' : 'terminal')

// Settings › Appearance › Project names: what's not the theme's goes on the sidebar, as data-ph-* (styles.css) and
// the values as --ph-* (spacing, size, weight: any CSS value)
const own = (pl: ProjectLook | undefined, k: keyof ProjectLook) => (pl?.[k] && pl[k] !== 'theme' ? pl[k] : undefined)
const phAttrs = (pl?: ProjectLook) => Object.fromEntries((['font', 'case', 'spacing', 'size', 'weight'] as const).flatMap(k => (own(pl, k) ? [[`data-ph-${k}`, k === 'font' || k === 'case' ? own(pl, k) : '']] : [])))
const phVars = (pl?: ProjectLook) => Object.fromEntries((['spacing', 'size', 'weight'] as const).flatMap(k => (own(pl, k) ? [[`--ph-${k}`, own(pl, k)]] : []))) as CSSProperties
// a workspace's state in words, for the sidebar's Extended and Cards rows
const STATE_WORDS: Record<string, string> = { waiting: 'needs you', running: 'working', done: 'done', idle: 'idle', exited: 'stopped', limit: 'at its usage limit' }
// a row's +/-: 1234 as 1.2k, 12345 as 12k
const clip = (s: string, n = 60) => (t => (t.length > n ? `${t.slice(0, n - 1)}…` : t))(s.replace(/\s+/g, ' ')) // a message on one line
const short = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
// …and its lines and rows (SideLook): the variables looks set (styles.css .project-ws), nearer than the theme's
const SIDE_VARS = { guide: '--ws-guide', divider: '--proj-divider', indent: '--ws-indent', rows: '--ws-h', text: '--ws-font', icons: '--ws-icon' } as const
const sideVars = (sl?: SideLook) => Object.fromEntries((Object.keys(SIDE_VARS) as (keyof typeof SIDE_VARS)[]).flatMap(k => (sl?.[k] && sl[k] !== 'theme' ? [[SIDE_VARS[k], sl[k]]] : []))) as CSSProperties

// the sidebar's timers: what happens as one ends (a notification and a message always); its quick lengths, minutes
const TIMER_THEN = [
  ['notify', 'Just tell me', 'bell'],
  ['pause', 'Pause the video', 'stop'],
  ['play', 'Play the video', 'run'],
  ['close', 'Close the video', 'x'],
  ['command', 'Run a command…', 'terminal'],
] as const
type Then = (typeof TIMER_THEN)[number][0]
type Watch = { id: string; ms: number; from?: number } // a stopwatch
type Timer = { id: string; end: number; ms: number; then: Then | 'remind' | 'send'; cmd?: string; ws?: string; tab?: string; text?: string; left?: number; note?: string } // cmd: then's command, run in ws; remind: a notification about ws; send: text to the agent tab (Send later); left: paused, the ms it has left (end means nothing then); note: what it's for (Go out), on its bar and as it ends
const MINUTES = [1, 5, 10, 15, 25, 30, 45, 60]
// the sidebar's filter (its funnel): words in a workspace's name, branch or PR, and at most one of these
const ONLY = [
  ['needs', 'Needs you'],
  ['busy', 'Working'],
  ['pr', 'With a PR'],
] as const
type Find = { q: string; only?: (typeof ONLY)[number][0] }
const span = (ms = 0) => (ms % 3600000 === 0 ? `${ms / 3600000} h` : ms % 60000 === 0 ? `${ms / 60000} min` : [Math.floor(ms / 60000) && `${Math.floor(ms / 60000)} min`, `${Math.round((ms % 60000) / 1000)} s`].filter(Boolean).join(' '))

const tabGlyph = (t: TabView) => (t.limit ? 'limit' : t.done && t.status === 'idle' ? 'done' : t.status === 'exited' && t.code === 0 ? 'ok' : shownStatus(t))
const SIDE = 240 // the sidebar's default width
// the rail layout (Settings › Appearance › Layout): a kind each, its words, its icon
type RailKind = 'projects' | 'shells' | 'browsers'
const RAIL: [RailKind, string, IconName][] = [['projects', 'Projects', 'fork'], ['shells', 'Terminal', 'terminal'], ['browsers', 'Browser', 'globe']]
// the rail with words: past RAIL_FIT buttons above the pins (⋯ More one of them), these go into More, the least used first
const RAIL_FIT = 7
const RAIL_MORE = ['todos', 'calendar', 'workflows', 'specs', 'board']
let requests = 0
// a file open in the app (the preview's tabs): its workspace, path and line; an artifact's is read-only; ext: a file
// opener's full view (an extension's action with view, on this file) in its place
type Opened = { ws: string; path: string; line?: number; n: number; edit?: Edit; storage?: boolean; ext?: string }
const fileKey = (f: { path: string; storage?: boolean; ext?: string }) => `${f.ext ? `ext:${f.ext}:` : ''}${f.storage ? 'artifact:' : ''}${f.path}`
const wsName = wsShown
// remote access's page, with Laki's PIN: the code shown in Settings › Remote access on the Mac (api.pin); a wrong one
// counts down, the last stops remote access. One solid card (styles.css' .pin-*): Laki's mark, a lock in a ring that
// fills a sixth per digit, the PIN in six boxes over one input (paste, one-time-code autofill), sent as the sixth digit
// is typed; a wrong one shakes them, a right one turns the ring green with a check while the socket opens. Unlock is
// always a button: short of six digits it says so
const PIN_LEN = 6 // remote.ts' PIN
function PinForm({ left }: { left?: number }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false) // the PIN was right: the socket opens next
  const [over, setOver] = useState(false) // stopped: nothing more to try here
  const [shake, setShake] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const send = (c = code) => {
    if (busy || over || ok) return
    if (c.length < PIN_LEN) return void (setErr(`Type all ${PIN_LEN} digits`), setShake(true), box.current?.focus())
    setBusy(true)
    setErr('')
    api.pin(c).then(
      () => (setOk(true), setBusy(false)), // the socket opens next (or the splash says why not)
      e => (setErr((e as Error).message), setCode(''), setShake(true), /stopped/.test((e as Error).message) && setOver(true), setBusy(false), box.current?.focus()),
    )
  }
  const type = (v: string) => {
    const c = v.normalize('NFKC').replace(/\D/g, '').slice(0, PIN_LEN)
    setCode(c)
    if (err && c) setErr('')
    if (c.length === PIN_LEN) send(c) // all of it: in at once
  }
  const filled = ok ? PIN_LEN : code.length
  return (
    <form className={`pin-card ${ok ? 'ok' : ''} ${over ? 'over' : ''}`} onSubmit={e => (e.preventDefault(), send())}>
      <div className="pin-brand">
        <img src={icon} alt="" />
        <b>Laki</b>
        <span className="pin-tag">
          <Icon name="globe" size={11} /> Remote access
        </span>
      </div>
      <div className="pin-ring" aria-hidden>
        <svg viewBox="0 0 64 64">
          <circle className="pin-track" cx="32" cy="32" r="29" />
          <circle className="pin-fill" cx="32" cy="32" r="29" pathLength={100} style={{ strokeDashoffset: 100 - (filled / PIN_LEN) * 100 }} />
        </svg>
        <span key={ok ? 'ok' : over ? 'over' : 'lock'}>
          <Icon name={ok ? 'check' : over ? 'shieldAlert' : 'lock'} size={22} />
        </span>
      </div>
      <h1>{ok ? 'Unlocked' : over ? 'Remote access stopped' : 'Enter your PIN'}</h1>
      <label htmlFor="pin" className="pin-say">
        {ok ? 'Opening Laki…' : over ? 'Start it again on your Mac for a new link.' : 'The six digits Laki shows on your Mac, in Settings › Remote access.'}
      </label>
      <div className={`pin-boxes ${shake ? 'shake' : ''} ${err && !ok ? 'bad' : ''}`} onAnimationEnd={e => e.target === e.currentTarget && setShake(false)}>
        <input ref={box} id="pin" value={code} autoFocus disabled={over || ok} readOnly={busy} inputMode="numeric" autoComplete="one-time-code" aria-invalid={!!err} /* readOnly, not disabled: it keeps the keyboard for the next try */ onChange={e => type(e.target.value)} />
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <span key={i} className={`pin-box ${i < code.length ? 'full' : ''} ${i === code.length ? 'at' : ''}`} aria-hidden>
            {code[i] ?? ''}
          </span>
        ))}
      </div>
      <button type="submit" className={`pin-go ${code.length < PIN_LEN && !busy && !ok ? 'short' : ''}`} disabled={over}>
        {ok || busy ? (
          <>
            <span className="btn-spin" /> {ok ? 'Opening Laki' : 'Checking…'}
          </>
        ) : (
          <>
            Unlock <Icon name="arrowRight" size={15} />
          </>
        )}
      </button>
      <div className="pin-foot">
        {err ? (
          <span className="pin-err" role="alert">
            {err}
          </span>
        ) : (
          <span>{ok ? 'Your Mac, through a private link' : left === undefined ? 'Paste works too' : left === 1 ? 'One wrong PIN stops remote access' : `${left} wrong PINs stop remote access`}</span>
        )}
      </div>
    </form>
  )
}
// its PR as #n (the scan's, else the linked URL's): ⌘K and the sidebar's filter find a workspace by its PR's number
const prNum = (w: WorkspaceView) => (n => (n ? `#${n}` : undefined))(w.pr?.number ?? /\/pull\/(\d+)/.exec(w.prUrl ?? '')?.[1])

// the last theme (and glass, font), until the daemon's settings arrive
applyTheme(load<string | Paint>('laki.theme', ''))

// a media query's answer, kept current (useSyncExternalStore): a phone's narrow layout, a touch screen's keys
const media = (q: string) => {
  const m = matchMedia(q)
  return { on: (f: () => void) => (m.addEventListener('change', f), () => m.removeEventListener('change', f)), now: () => m.matches }
}
const NARROW = media('(max-width: 640px)') // under the app window's minWidth (700): phones and narrow browsers only
const TOUCH = media('(pointer: coarse)')
const LESS = media(LESS_CLEAR) // macOS's Reduce transparency and Increase contrast: applyTheme reads them, App repaints
const MORE = media(MORE_CONTRAST)

// keys a phone's keyboard lacks, typed into the focused pane (claude and codex ask with arrows, Esc, ⇧⇥)
const KEYS: [string, string][] = [['esc', '\x1b'], ['tab', '\t'], ['⇧tab', '\x1b[Z'], ['^C', '\x03'], ['←', '\x1b[D'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['→', '\x1b[C'], ['⏎', '\r']]
// a press that doesn't take the focus: the terminal keeps it, and the phone its keyboard
const keep = (e: { preventDefault(): void }) => e.preventDefault()
function KeyBar({ onKey }: { onKey: (data: string) => void }) {
  const typing = () => {
    const ta = document.querySelector<HTMLTextAreaElement>('.pane.active .xterm-helper-textarea')
    if (ta && document.activeElement === ta) ta.blur()
    else ta?.focus()
  }
  return (
    <div className="keybar">
      <button onPointerDown={keep} onMouseDown={keep} onClick={typing} aria-label="Keyboard">
        ⌨
      </button>
      {KEYS.map(([k, data]) => (
        <button key={k} onPointerDown={keep} onMouseDown={keep} onClick={() => onKey(data)}>
          {k}
        </button>
      ))}
    </div>
  )
}


export function App() {
  const [view, setView] = useState<View | null>(null)
  const [connected, setConnected] = useState(false)
  const [glow, setGlow] = useState<{ tab?: string; n: number } | null>(null) // Laki AI just looked (Settings › Experimental › Laki AI's glow)
  const [problem, setProblem] = useState<string | undefined>() // the remote page: why it can't connect
  const [pinAsk, setPinAsk] = useState<{ left?: number } | null>(null) // the remote page: Laki's PIN, asked for on the splash
  const [going, setGoing] = useState<Record<string, string>>({}) // workspaces being archived or deleted: a spinner on their rows
  const [making, setMaking] = useState<{ key: number; project: string; place?: string; name: string }[]>([]) // new ones on their way: a row each
  const made = useRef({ key: 0, page: 0 }) // making's keys; page: the new-workspace page's closes (one closed mid-create isn't the one open now)
  const [wsId, setWsId] = useState<string | null>(() => load('laki.ws', null))
  const [tabByWs, setTabByWs] = useState<Record<string, string>>(() => load('laki.tabs', {})) // the focused pane's session
  const [aiFloat, setAiFloat] = useState(false) // the floating Laki AI chat, open
  // its button minimized into the status bar (laki.aiDock) until put back; fly: on its way down or back up (DOCK_MS)
  const [aiDock, setAiDock] = useState(() => load('laki.aiDock', false))
  const [fly, setFly] = useState<'' | 'down' | 'up' | 'landed'>('')
  const docked = (on: boolean) => {
    const to = on ? 'landed' : 'up' // the status bar's item pops in, or the button rises back
    setAiDock(on)
    store('laki.aiDock', on || undefined)
    setFly(to)
    setTimeout(() => setFly(f => (f === to ? '' : f)), DOCK_MS)
  }
  const dock = (on: boolean) => (on && !matchMedia('(prefers-reduced-motion: reduce)').matches ? (setFly('down'), setTimeout(() => docked(true), DOCK_MS - 20)) : docked(on))
  // another app in front: the window's animations (spinners, lines, a look's effects) stop where they are, so a window
  // in sight but not in use draws only what changes (styles.css' html.away); the bubbles say who's at work meanwhile
  useEffect(() => {
    // main says when another app is in front (a click into a Browsers page or the preview blurs the window, but Laki is
    // still in front); a browser: the page's focus, read once it has moved (into one of its frames: still focused)
    const away = (on: boolean) => void document.documentElement.classList.toggle('away', on)
    away(!document.hasFocus())
    if (bridge?.onFront) return void bridge.onFront(on => away(!on))
    const f = () => void setTimeout(() => away(!document.hasFocus()))
    window.addEventListener('focus', f)
    window.addEventListener('blur', f)
    return () => (window.removeEventListener('focus', f), window.removeEventListener('blur', f))
  }, [])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [picking, setPicking] = useState(false) // development mode's element picker (Picker.tsx)
  const settingsKey = useMemo(() => ++requests, [dialog]) // each request remounts the settings page where it asks
  // #18: a page or dialog opened over an extension's or agent's ask puts it back in line (not a deny: its Esc would have
  // been the page's); it shows again as that closes. One that comes while a page is open shows over it
  useEffect(() => {
    if (dialog && toolOn) unchoose(toolOn, AWAY)
    else if (!dialog) toolShow()
  }, [dialog])
  const [newFor, setNewFor] = useState<string>() // a project just opened: its new-workspace dialog
  const [newInit, setNewInit] = useState<Partial<NewWsParams> & { linked?: boolean }>() // a laki://new link's prompt and name (linked: the page says so)
  const [newImages, setNewImages] = useState<Shot[]>([]) // the menu bar's screenshots, in the new workspace's prompt
  const [link, setLink] = useState<string>() // a laki:// link, routed once the view is in
  const [panelOpen, setPanelOpen] = useState<boolean>(() => load('laki.panel', false)) // the right panel: files, changes, review
  const [panelTab, setPanelTab] = useState<PanelTab>(() => load('laki.panelTab', 'files'))
  const [panelW, setPanelW] = useState<number>(() => load('laki.panelW', PANEL_WIDTH))
  // files open in the app, as tabs over the preview (each workspace its own); n: each request reloads it; edit: its
  // unsaved edit; storage: an artifact's (read-only). shownFile: each workspace's tab in front (fileKey)
  const [openFiles, setOpenFiles] = useState<Opened[]>([])
  const [shownFile, setShownFile] = useState<Record<string, string>>({})
  const [previewW, setPreviewW] = useState<number | null>(() => load<number | null>('laki.previewW', null)) // dragged: its width; null: it shares the room
  const [artView, setArtView] = useState<{ ws: string; path: string } | null>(null) // an HTML or Markdown artifact in the app's viewer
  const [base, setBase] = useState<string | null>(null) // the daemon's address, for the viewer's frame ('': the page's own, remote access)
  useEffect(() => void daemonBase().then(setBase, () => {}), [])
  const [artsIn, setArtsIn] = useState<string | null>(null) // the workspace whose side panel Files shows its Artifacts (the others: their worktree)
  const [finds, setFinds] = useState<Record<string, number>>({}) // ⌘F presses per session, for its find bar
  const [floated, setFloated] = useState<string[]>([]) // tabs in windows of their own (main's tabWin): their panes say so
  const floatTab = (id: string, on = true) => bridge?.floatTab?.(id, on) // a tab in a window of its own over every app (on false: back)
  useEffect(() => void (bridge?.onFloating?.(setFloated), bridge?.floating?.().then(setFloated)), [])
  // tabs (of panes) per workspace: the daemon's (view.layouts, API 60: every window, the phone, Laki AI see one), kept
  // here too for the first paint and an older daemon
  const [stored, setStored] = useState<Record<string, Layout[]>>(() => load('laki.groups', {}))
  const pushes = useRef<Record<string, ReturnType<typeof setTimeout> | true>>({}) // a change of ours on its way: it wins
  // the sidebar's width per rail kind (projects, terminals, browsers: each its own); one from before, every kind's
  const [sideWs, setSideWs] = useState<Partial<Record<RailKind, number>>>(() => {
    const old = load<unknown>('laki.side', SIDE)
    const one = typeof old === 'number' && old > 0 ? old : SIDE
    const m = load<unknown>('laki.sideW', null)
    const ok = Object.entries(m && typeof m === 'object' ? m : {}).filter(([, w]) => typeof w === 'number' && w >= 160 && w <= 480) // SideHandle's range
    return { projects: one, shells: one, browsers: one, ...Object.fromEntries(ok) }
  })
  const [sideOpen, setSideOpen] = useState<boolean>(() => load('laki.sideOpen', true))
  const [railKind, setRailKind] = useState<RailKind>(() => load('laki.rail', 'projects')) // the rail layout's list: which kind
  const [folded, setFolded] = useState<string[]>(() => load('laki.folded', [])) // projects and seps whose workspaces are hidden
  const [find, setFind] = useState<Find | null>(null) // the sidebar's filter: null, all of them
  const [runsSeen, setRunsSeen] = useState<string>(() => load('laki.runsSeen', '')) // the newest scheduled run read
  // the sidebar's video (its embed URL); play: just asked for, so it starts (one kept from before waits for a click), at:
  // when, so the same link asked for again starts over; min: only its bar shows (it plays on)
  const [video, setVideo] = useState<{ src: string; play?: boolean; at?: number; min?: boolean } | null>(() => {
    const kept = load<unknown>('laki.video', null)
    const src = typeof kept === 'string' && youtubeEmbed(kept) // checked again: it becomes an iframe's src
    return src ? { src } : null
  })
  const [dropping, setDropping] = useState(false) // a folder dragged over the window
  const [shown, setShown] = useState<ShownWin[]>([]) // what workflows' Show you blocks show, in turn
  const [pops, setPops] = useState<ShownPop[]>([]) // and their popovers (an end's too), the newest 3
  const [sharing, setSharing] = useState<string | null>(null) // the tab whose Share popover is open
  const [note, setNote] = useState<{ text: string; undo?: () => void; label?: string; ok?: boolean; busy?: boolean } | null>(null) // the toast, maybe with Undo (or another action: label); ok: done, not a failure; busy: under way, until the next one
  const [menu, showMenu] = useMenu()
  const [gallery, setGallery] = useState<string | null>(null) // the workspace whose Artifacts show over the status bar
  const [branchFull, setBranchFull] = useState(() => load('laki.branchFull', false)) // the status bar's branch: all of it, base too
  // full screen (⌘⇧⏎, the tab bar's ⤢): the tab's content alone, no rail, sidebar, tab bar, panels or status bar; the
  // window full screen too (main's, so Esc stays the terminal's)
  const [full, setFull] = useState(false)
  const toggleFull = (on = !full) => (setFull(on), bridge?.fullScreen?.(on))
  const [apps, setApps] = useState<AppInfo[]>([])
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const narrow = useSyncExternalStore(NARROW.on, NARROW.now) // a phone: one pane at a time, the sidebar and panels over it
  const touch = useSyncExternalStore(TOUCH.on, TOUCH.now)
  // a workspace's card as the mouse rests on its row (peekCard): its id, where (the row's top, the sidebar's right
  // edge); a moment to move onto it, where its links and buttons take clicks; a wheel, a key or leaving the window hides it
  const [peek, setPeek] = useState<{ id: string; top: number; left: number } | null>(null)
  const peekTimer = useRef(0)
  const peekBox = useRef<HTMLDivElement>(null)
  const peekAt = (id?: string, el?: HTMLElement) => {
    clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => {
      if (!id || !el?.isConnected) return setPeek(null)
      const r = el.getBoundingClientRect()
      setPeek({ id, top: r.top, left: (el.closest('.sidebar') ?? el).getBoundingClientRect().right + 6 })
    }, !id ? 250 : peek ? 120 : 550)
  }
  // a menu (a row's ⋯, a right click, any other) closes the card first
  const openMenu: typeof showMenu = (e, items, align) => (clearTimeout(peekTimer.current), setPeek(null), showMenu(e, items, align))
  useEffect(() => {
    if (!peek) return
    const hide = (e: Event) => !(e.type === 'wheel' && peekBox.current?.contains(e.target as Node)) && (clearTimeout(peekTimer.current), setPeek(null))
    const on = ['wheel', 'keydown'] as const
    for (const k of on) window.addEventListener(k, hide, true)
    window.addEventListener('blur', hide) // the window's own (not captured: a button on the card taking the focus would hide it before its click)
    return () => (on.forEach(k => window.removeEventListener(k, hide, true)), window.removeEventListener('blur', hide))
  }, [!!peek])
  useLayoutEffect(() => { // kept inside the window, as its text changes too
    const el = peekBox.current
    if (el && peek) el.style.top = `${Math.max(8, Math.min(peek.top - 6, window.innerHeight - el.offsetHeight - 8))}px`
  })
  const mru = useRef<string[]>([]) // sessions, most recently focused first: which pane a tab focuses

  const live = useMemo(() => view?.workspaces.filter(w => !w.archived) ?? [], [view])
  // files open in a workspace that's gone (archived, deleted) close with it
  useEffect(() => void (view && setOpenFiles(l => (l.every(f => live.some(w => w.id === f.ws)) ? l : l.filter(f => live.some(w => w.id === f.ws))))), [live])
  // a shell's spinner stops SHELL_SPIN after its command started (Glyph's spins): drawn again as one crosses it
  const [, spinTick] = useState(0)
  const spinLeft = view ? spinsUntil(view.tabs) : undefined
  useEffect(() => {
    if (spinLeft === undefined) return
    const t = setTimeout(() => spinTick(n => n + 1), spinLeft + 50)
    return () => clearTimeout(t)
  })
  // when each agent tab last worked or waited (laki.active, by tab), for the recent ones
  const active = useRef<Record<string, number>>((a => (a && typeof a === 'object' && !Array.isArray(a) ? a : {}))(load<unknown>('laki.active', {})) as Record<string, number>)
  for (const t of view?.tabs ?? []) if (t.kind === 'agent' && (t.status === 'running' || t.status === 'waiting' || (t.done && !active.current[t.id]))) active.current[t.id] = Date.now() // done unseen with no stamp: it ran while the app was closed
  // a project's sidebar rows: rowsOf, each group's workspaces (and the ones above its first group) in its sort, a
  // group's own or the project's (manual: as dragged); last active: its agents' latest turn here, else when it was made
  const lastAts = new Map<string, number>() // this render's, by workspace
  for (const t of view?.tabs ?? []) lastAts.set(t.workspace, Math.max(lastAts.get(t.workspace) ?? 0, active.current[t.id] ?? 0))
  const lastAt = (w: WorkspaceView) => Math.max(w.created, lastAts.get(w.id) ?? 0)
  const SORT_BY: Record<WsSort, ((a: WorkspaceView, b: WorkspaceView) => number) | null> = { manual: null, created: (a, b) => b.created - a.created, activity: (a, b) => lastAt(b) - lastAt(a), name: (a, b) => wsName(a).localeCompare(wsName(b), undefined, { numeric: true }) }
  const sortedRows = (p: Project, ws: WorkspaceView[]) => {
    const out: (WorkspaceView | Sep)[] = []
    let run: WorkspaceView[] = []
    let by = SORT_BY[p.sort ?? 'manual']
    const flush = () => void (out.push(...(by ? run.sort(by) : run)), (run = []))
    for (const x of rowsOf(p, ws))
      if ('path' in x) run.push(x)
      else flush(), out.push(x), (by = SORT_BY[x.sort ?? p.sort ?? 'manual'])
    flush()
    return out
  }
  const byProject = (view?.projects ?? []).flatMap(p => sortedRows(p, live).filter((x): x is WorkspaceView => 'path' in x)) // as the sidebar shows them
  const pinned = byProject.filter(w => w.pinned) // the sidebar's top
  // the sidebar's order: Pinned, then each project's (⌘↑/⌘↓, ⌘J, the palette)
  const order = [...pinned, ...byProject.filter(w => !w.pinned)]
  // what's on screen stays there: a pick that's gone (archived, removed) or not in the view yet falls back to the one
  // shown, not to the first row, which a new workspace (placed on top, or sorted by last active) would take
  const shownWs = useRef<string | null>(null)
  const ws = live.find(w => w.id === wsId) ?? live.find(w => w.id === shownWs.current) ?? order[0] ?? null
  shownWs.current = ws?.id ?? null
  const wsFiles = ws ? openFiles.filter(f => f.ws === ws.id) : [] // this workspace's open files, its tabs
  const previewed = wsFiles.find(f => fileKey(f) === shownFile[ws?.id ?? '']) ?? wsFiles.at(-1) ?? null // the one in front
  const project = view?.projects.find(p => p.id === ws?.project)
  const git = project?.git !== false
  const tabs = useMemo(() => view?.tabs.filter(t => t.workspace === ws?.id) ?? [], [view, ws])
  const byId = (id: string) => tabs.find(t => t.id === id)
  const placed = groupsOf(stored[ws?.id ?? ''], tabs.map(t => t.id))
  const groups = narrow ? placed.flatMap(g => tabsOf(g).map(tab => ({ tab }))) : placed // too narrow for splits: a tab per pane
  const shownTab = useRef<string | null>(null) // likewise the tab: a new one doesn't take the pane's place
  const tab = tabs.find(t => t.id === tabByWs[ws?.id ?? '']) ?? tabs.find(t => t.id === shownTab.current) ?? tabs.find(t => t.kind === 'agent') ?? tabs[0] ?? null
  shownTab.current = tab?.id ?? null
  const group = groups.find(g => tabsOf(g).includes(tab?.id ?? '')) ?? null
  const visible = tabsOf(group)

  useEffect(() => void localStorage.setItem('laki.ws', JSON.stringify(ws?.id ?? null)), [ws?.id])
  // back and forward: each new place after the one you're at (what was ahead of it goes, as in a
  // browser); a move of travel's own is that place again, not a new one
  const historyOn = !!view && view.settings?.history !== false
  const hist = useRef<{ at: Place[]; i: number; going?: string }>({ at: [], i: -1 })
  const [, histDrawn] = useState(0)
  const hereKey = JSON.stringify({ d: dialog, ws: ws?.id ?? null })
  useEffect(() => {
    const h = hist.current
    if (!historyOn || !isPlace(dialog)) return
    const going = h.going
    h.going = undefined
    if (going === hereKey || (h.at[h.i] && JSON.stringify(h.at[h.i]) === hereKey)) return
    h.at = [...h.at.slice(0, h.i + 1), { d: dialog, ws: ws?.id ?? null }].slice(-(HISTORY_MAX + 1))
    h.i = h.at.length - 1
    histDrawn(n => n + 1)
  }, [hereKey, historyOn])
  // to the place at j: its workspace selected again (one gone since: the one you're in; the workspace view of one gone,
  // or a page turned off since: skipped)
  const travel = (j: number) => {
    const h = hist.current
    const by = j < h.i ? -1 : 1
    const s = view?.settings ?? {}
    const off = (d: Dialog) => (d === 'desk' && s.desk === false) || (d === 'calendar' && s.calendar !== true) || (d === 'bird' && s.birdView === false) || (d === 'ai' && !aiOn(s)) || (!!notesOf(d) && s.notes !== true) || (d === 'todos' && s.todoList !== true) || (!!specsOf(d) && !specsOnIn(s)) || (!!flowsOf(d) && !flowsOnIn(s)) || (!!studioOf(d) && !aiOn(s))
    const gone = (p: Place) => off(p.d) || (p.d === null && !!p.ws && !live.some(w => w.id === p.ws))
    while (h.at[j] && gone(h.at[j])) j += by
    const p = h.at[j]
    if (!p || j === h.i) return
    const to: Place = { d: p.d, ws: p.ws && live.some(w => w.id === p.ws) ? p.ws : (ws?.id ?? null) }
    h.at[j] = to
    h.i = j
    h.going = JSON.stringify(to)
    if (to.ws && to.ws !== ws?.id) setWsId(to.ws)
    setDialog(to.d)
    histDrawn(n => n + 1)
  }
  const projOf = (w?: { project: string } | null) => (w ? view?.projects.find(p => p.id === w.project) : undefined)
  const tint = (w: WorkspaceView) => (w.color && w.color !== 'none' ? w.color : projOf(w)?.color) // its own color, else its project's
  const placeName = (p: Place) => {
    const d = p.d
    const w = live.find(x => x.id === p.ws)
    if (d === null) return w ? wsName(w) : 'the workspace'
    if (typeof d === 'string') return d === 'settings' ? 'Settings' : PAGE_WORDS[d] ?? d
    if ('extension' in d) return view?.widgets?.find(x => x.id === d.extension)?.name ?? 'an extension'
    if ('studio' in d) return 'the extension studio'
    if ('uikit' in d) return 'the UI kit'
    if ('settings' in d || 'section' in d) return 'Settings'
    if ('project' in d) return view?.projects.find(x => x.id === d.project)?.name ?? 'a project'
    if ('schedules' in d) return 'Schedule'
    if ('compare' in d) return 'Compare'
    if ('specs' in d) return 'Specs'
    if ('workflows' in d) return (n => (n.startsWith('run:') ? 'A workflow run' : n ? 'A workflow' : 'Flows'))(d.nav ?? (d.run ? 'run:' : d.wf ? 'wf:' : ''))
    if ('note' in d) return 'Notes'
    return 'a page'
  }
  // the window's title (a screen share's picker, the Window menu, a browser's tab): the page you're on, else the
  // workspace and its tab; a dialog over a page (⌘K, a rename) keeps the page's
  const titleAt = useRef<Dialog>(null)
  if (isPlace(dialog)) titleAt.current = dialog
  // a workspace whose project has an emoji: it and the project's name first (🛒 web · fix-login)
  const hereP = projOf(ws)
  const pe = emojiOf(hereP?.icon)
  const here = titleAt.current === null ? [pe && `${pe} ${hereP!.name}`, ws && wsName(ws), tab?.name].filter(Boolean).join(' · ') : view ? placeName({ d: titleAt.current, ws: ws?.id ?? null }) : ''
  const winTitle = here ? `${here} — Laki` : 'Laki'
  useEffect(() => void (document.title = winTitle), [winTitle])
  // a new studio's first ask names it: the dialog (and the place in the history) says which, so Back, ⌘K's way back and
  // a reopen go to that chat, not a blank studio; its key stays, so it isn't drawn again
  const nameStudio = (s: { studio: string; back?: Dialog; key?: string }, id: string) => {
    const d: Dialog = { studio: id, back: s.back, key: studioKey(s) }
    const h = hist.current
    if (h.at[h.i] && studioOf(h.at[h.i].d)) h.at[h.i] = { ...h.at[h.i], d }
    h.going = JSON.stringify({ d, ws: ws?.id ?? null })
    setDialog(x => (studioOf(x) ? d : x))
  }
  useEffect(() => void localStorage.setItem('laki.tabs', JSON.stringify(tabByWs)), [tabByWs])
  useEffect(() => void localStorage.setItem('laki.groups', JSON.stringify(stored)), [stored])
  const layoutsOn = (view?.api ?? 0) >= 60
  const migrated = useRef(false)
  useEffect(() => {
    if (!layoutsOn || !view) return
    const l = view.layouts ?? {}
    // the first time: what this window arranged before the daemon kept layouts
    if (!migrated.current) {
      migrated.current = true
      for (const [id, g] of Object.entries(stored)) if (!l[id] && view.workspaces.some(w => w.id === id) && g.some(x => !('tab' in x))) call('layoutSet', { ws: id, groups: g }).catch(() => {})
    }
    setStored(m => {
      let n = m
      for (const [id, g] of Object.entries(l)) if (!pushes.current[id] && JSON.stringify(g) !== JSON.stringify(m[id])) n = { ...n, [id]: g }
      return n
    })
  }, [view?.layouts, layoutsOn])
  useEffect(() => void localStorage.setItem('laki.sideW', JSON.stringify(sideWs)), [sideWs])
  useEffect(() => void localStorage.setItem('laki.sideOpen', JSON.stringify(sideOpen)), [sideOpen])
  useEffect(() => void localStorage.setItem('laki.rail', JSON.stringify(railKind)), [railKind])
  useEffect(() => void localStorage.setItem('laki.folded', JSON.stringify(folded)), [folded])
  useEffect(() => void localStorage.setItem('laki.branchFull', JSON.stringify(branchFull)), [branchFull])
  // a new workspace, and the one selected before it, stay in sight: their projects and seps unfold once the view has them
  const [reveal, setReveal] = useState<string[]>([])
  useEffect(() => {
    if (!view || !reveal.length) return
    const here = reveal.filter(id => view.workspaces.some(w => w.id === id))
    if (!here.length) return
    const open = new Set<string>()
    for (const p of view.projects) {
      let sep = ''
      for (const x of rowsOf(p, view.workspaces)) {
        if (!('path' in x)) sep = x.id
        else if (here.includes(x.id)) open.add(p.id).add(sep)
      }
    }
    setFolded(f => (f.some(x => open.has(x)) ? f.filter(x => !open.has(x)) : f))
    setReveal(r => r.filter(id => !here.includes(id)))
  }, [view, reveal])
  useEffect(() => void localStorage.setItem('laki.video', JSON.stringify(video?.src ?? null)), [video?.src])
  // the sidebar's timers, each a bar over its foot: when it ends, how long it was set for, and what happens then (ones
  // that ended while Laki was closed are dropped; a reminder's comes at once)
  const missed = useRef<Timer[]>([]) // messages for later due while Laki was closed: not sent, said so once it's up
  const [timers, setTimers] = useState<Timer[]>(() => {
    const kept = load<unknown>('laki.timers', [])
    return (Array.isArray(kept) ? kept : []).flatMap((t: Partial<Timer>): Timer[] => {
      if (t?.then === 'send') {
        const ok = typeof t.id === 'string' && typeof t.end === 'number' && typeof t.ms === 'number' && typeof t.tab === 'string' && typeof t.text === 'string' && typeof t.ws === 'string'
        if (ok && t.end! <= Date.now() && !missed.current.some(x => x.id === t.id)) missed.current.push(t as Timer)
        return ok && t.end! > Date.now() ? [{ id: t.id!, end: t.end!, ms: t.ms!, then: 'send' as const, ws: t.ws, tab: t.tab, text: t.text }] : []
      }
      const remind = t?.then === 'remind' && typeof t.ws === 'string'
      const left = !remind && typeof t?.left === 'number' && t.left > 0 ? t.left : undefined // paused: kept however long it was closed
      return typeof t?.id === 'string' && typeof t.end === 'number' && (t.end > Date.now() || remind || left) && typeof t.ms === 'number' && t.ms > 0
        ? [{ id: t.id, end: t.end, ms: t.ms, then: remind || (TIMER_THEN.some(x => x[0] === t.then) && (t.then !== 'command' || (typeof t.cmd === 'string' && !!t.cmd.trim() && typeof t.ws === 'string'))) ? t.then! : 'notify', cmd: t.cmd, ws: t.ws, left, ...(typeof t.note === 'string' && t.note.trim() && { note: t.note.trim().slice(0, 120) }) }]
        : []
    })
  })
  useEffect(() => void localStorage.setItem('laki.timers', JSON.stringify(timers)), [timers])
  // stopwatches (the timer button's Stopwatch): ms counted before, from: running since; kept across a reload
  const [watches, setWatches] = useState<Watch[]>(() => (l => (Array.isArray(l) ? l.filter((w: Watch) => typeof w?.id === 'string' && typeof w.ms === 'number' && (w.from === undefined || typeof w.from === 'number')) : []))(load<unknown>('laki.watches', [])))
  useEffect(() => void localStorage.setItem('laki.watches', JSON.stringify(watches)), [watches])
  const setWatch = (id: string, f: (w: Watch) => Watch | null) => setWatches(l => l.map(w => (w.id === id ? f(w) : w)).filter((w): w is Watch => !!w))
  const watchesRef = useRef(watches)
  watchesRef.current = watches
  // Laki AI's timers (laki_timer, through the daemon): a timer, a reminder about a workspace, a message for later or a
  // stopwatch; what runs; one stopped
  const timerAct = useRef<(m: { act: string; ms: number; note?: string; ws?: string; tab?: string; text?: string; which?: string }) => unknown>(() => {})
  timerAct.current = m => {
    const id = Math.random().toString(36).slice(2, 10)
    if (m.act === 'stopwatch') return (setWatches(l => [...l, { id, ms: 0, from: Date.now() }]), { id, stopwatch: 'running' })
    if (m.act === 'list')
      return {
        timers: timersRef.current.map(t => ({ id: t.id, kind: t.then === 'remind' ? 'reminder' : t.then === 'send' ? 'send later' : 'timer', secondsLeft: Math.round((t.left ?? t.end - Date.now()) / 1000), paused: t.left !== undefined, note: t.note, ws: t.ws, text: t.text })),
        stopwatches: watchesRef.current.map(w => ({ id: w.id, seconds: Math.round((w.ms + (w.from ? Date.now() - w.from : 0)) / 1000), running: !!w.from })),
      }
    if (m.act === 'stop') {
      if (timersRef.current.some(t => t.id === m.which)) return (setTimer(m.which!, () => null), { stopped: m.which })
      if (watchesRef.current.some(w => w.id === m.which)) return (setWatch(m.which!, () => null), { stopped: m.which })
      throw new Error(`no timer or stopwatch ${m.which}`)
    }
    const then: Partial<Timer> = m.act === 'remind' ? { then: 'remind', ws: m.ws } : m.act === 'send' ? { then: 'send', ws: m.ws, tab: m.tab, text: m.text } : {}
    setTimers(l => [...l, { id, end: Date.now() + m.ms, ms: m.ms, then: 'notify', ...then, ...(m.note && { note: m.note }) }])
    return { id, rings: new Date(Date.now() + m.ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
  }
  const addTimer = (ms: number, more: Partial<Timer> = {}) => {
    if (more.then !== 'remind') earn(more.then === 'send' ? 'later' : 'timer')
    setTimers(l => [...l, { id: Math.random().toString(36).slice(2, 10), end: Date.now() + ms, ms, then: 'notify', ...more }])
  }
  const setTimer = (id: string, f: (t: Timer) => Timer | null) => setTimers(l => l.map(t => (t.id === id ? f(t) : t)).filter((t): t is Timer => !!t)) // null: gone
  const pause = (id: string) => setTimer(id, x => (x.left === undefined ? { ...x, left: Math.max(1000, x.end - Date.now()) } : { ...x, end: Date.now() + x.left, left: undefined })) // or go on
  const restart = (id: string, ms: number) => setTimer(id, x => ({ ...x, end: Date.now() + ms, ms, left: undefined })) // a new length, running
  // one ends: what was picked, then a notification (it's what you asked for: muting doesn't apply) and a message
  const timersRef = useRef(timers)
  timersRef.current = timers
  const ring = (id: string) => {
    const t = timersRef.current.find(x => x.id === id)
    if (!t) return
    if ((t.then === 'send' || t.then === 'remind') && !viewRef.current) return void setTimeout(() => ring(id), 1000) // due as Laki opens: once the tabs are in
    if (t.then === 'send' && t.tab === 'ai') return void (setTimer(id, () => null), askLater(stamp(t.text!, Date.now())))
    if (t.then === 'send') {
      setTimer(id, () => null)
      const tab = viewRef.current?.tabs.find(x => x.id === t.tab)
      const say = (text: string, ok?: boolean) => (notify('Message for later', text, ok ? t.tab! : '', () => tab && selectTab(tab.id), viewRef.current?.settings.notifySound), toast(text, undefined, undefined, ok))
      if (!tab) return say(`Not sent: its agent tab is gone (${clip(t.text!)})`)
      return void api.call<{ queued?: number }>('send', { target: tab.id, text: stamp(t.text!, Date.now()), whenIdle: true }).then(
        r => say(`${r?.queued ? `Queued for ${tab.name}, busy now` : `Sent to ${tab.name}`}: ${clip(t.text!)}`, true),
        e => say(`Not sent to ${tab.name}: ${e.message}`),
      )
    }
    setTimer(id, () => null)
    if (t.then === 'remind') {
      const w = viewRef.current?.workspaces.find(x => x.id === t.ws && !x.archived)
      const say = w ? wsName(w) : 'a workspace that is gone now'
      notify('Reminder', say, (w && viewRef.current?.tabs.find(x => x.workspace === w.id)?.id) ?? '', () => w && setWsId(w.id), viewRef.current?.settings.notifySound) // its click: there
      return toast(`Reminder: ${say}`, w && (() => setWsId(w.id)), 'Open')
    }
    // no video now, or the command's workspace gone: only the notice (which says so for the command)
    const gone = t.then === 'command' && !viewRef.current?.workspaces.some(w => w.id === t.ws && !w.archived)
    const then = gone || (t.then !== 'command' && t.then !== 'notify' && !document.querySelector('.video')) ? 'notify' : t.then
    if (then === 'pause') videoCommand('pauseVideo')
    else if (then === 'play') (setVideo(v => v && { ...v, min: false }), setSideOpen(true), videoCommand('playVideo'))
    else if (then === 'close') setVideo(null)
    else if (then === 'command') call('tabNew', { ws: t.ws, preset: 'custom', cmd: t.cmd }).catch(() => {}) // a tab of its own, not focused: it closes when the command succeeds
    const did = gone ? `: ${t.cmd} didn't run, its workspace is gone` : then === 'notify' ? '' : then === 'command' ? `: ran ${t.cmd}` : `: ${TIMER_THEN.find(x => x[0] === then)![1].toLowerCase()}`
    // Settings › General › Timers: a sound and the app's dialog (Again starts the same one over), or a notification
    const s = viewRef.current?.settings
    const sound = s?.timerSound || 'Glass'
    const up = t.note ? `${t.note} (${span(t.ms)} is up${did})` : `${span(t.ms)} is up${did}` // its message first: what it was for
    if (s?.timerAlert === 'notification') return void (notify(t.note || 'Timer', up, '', () => {}, sound), toast(`Timer: ${up}`))
    if (sound !== 'none') bridge?.sound?.(sound)
    const again = () => addTimer(t.ms, { then: t.then, cmd: t.cmd, ws: t.ws, note: t.note })
    if (document.querySelector('.ask-overlay')) return toast(`Timer: ${up}`, again, 'Again') // a dialog would answer the open one with no
    choose(t.note || `${span(t.ms)} timer is up`, [t.note && `${span(t.ms)} timer is up`, did && did.slice(2).replace(/^./, c => c.toUpperCase())].filter(Boolean).join(' · ') || undefined, [{ label: 'Again' }, { label: 'OK', primary: true }]).then(i => i === 0 && again())
  }
  // Send later to Laki AI: asked now, or once it's free (one ask at a time: tried every 15 s for an hour); its answer is
  // a notification that opens the AI page
  // busy or not connected (a daemon restarting): tried again every 15 s for an hour
  // ponytail: the retries live in this window only; a reload meanwhile drops the ask (keep it as a timer if that bites)
  const askLater = (text: string, tries = 0) => {
    const say = (s: string, ok?: boolean) => (notify('Laki AI', s, '', () => setDialog('ai'), viewRef.current?.settings.notifySound), toast(s, () => setDialog('ai'), 'Open', ok))
    if (!tries) toast(`Asked Laki AI: ${clip(text)}`, () => setDialog('ai'), 'Open', true)
    api.call('aiAsk', { text }).then(
      () => say(`Answered: ${clip(text)}`, true),
      e => (/^(the AI is still|the AI is at work|not connected)/.test(e.message) && tries < 240 ? void setTimeout(() => askLater(text, tries + 1), 15000) : say(`${tries >= 240 || /^(Laki AI is off|ask something|no OpenRouter API key|not connected)/.test(e.message) ? 'Not asked' : 'Failed'}: ${e.message} (${clip(text)})`)),
    )
  }
  useEffect(() => {
    const n = missed.current.length
    if (n) toast(n > 1 ? `${n} messages for later weren't sent: Laki was closed when they were due` : `A message for later wasn't sent: Laki was closed at ${new Date(missed.current[0].end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${clip(missed.current[0].text!, 40)})`)
    missed.current = []
  }, [])
  const ends = timers.map(t => `${t.id}:${t.end}:${t.left}`).join()
  useEffect(() => {
    const ts = timersRef.current.filter(t => t.left === undefined).map(t => setTimeout(() => ring(t.id), t.end - Date.now()))
    return () => ts.forEach(clearTimeout)
  }, [ends])
  // the Dock's count: agents waiting for you or done while you looked away, muted ones and archived workspaces aside
  const quiet = new Set(view?.workspaces.filter(w => w.muted || w.archived).map(w => w.id))
  const needsYou = (t: TabView) => (t.status === 'waiting' || (t.done && t.status === 'idle')) && !t.muted && !quiet.has(t.workspace)
  // the Dock's count, and the menu bar's item from the same list: waiting ones first, each with what it asks
  const waits = useRef(new Map<string, string>()) // a tab's last waiting turn's text (turn events)
  const needing = view?.tabs.filter(needsYou) ?? []
  const trayItems = [...needing.filter(t => t.status === 'waiting'), ...needing.filter(t => t.status !== 'waiting')].map(t => {
    const w = view?.workspaces.find(w => w.id === t.workspace)
    const asks = t.status === 'waiting' ? waits.current.get(t.id) || t.ask?.options.map(o => o.label).join(' / ') || 'waiting for you' : 'finished'
    return { tab: t.id, label: `${w ? wsName(w) : t.workspace} · ${t.name}: ${asks.replace(/\s+/g, ' ').slice(0, 60)}` }
  })
  const trayKey = JSON.stringify([trayItems, view?.settings.menuBar])
  useEffect(() => bridge?.badge?.(trayItems.length, trayItems, view?.settings.menuBar !== false), [trayKey])
  useEffect(() => void (narrow && dialog && setSideOpen(false)), [narrow, dialog]) // a page the drawer opened goes on top
  // the phone's tab strip scrolls: the selected tab first in it (scroll-padding clears the sidebar button)
  useEffect(() => void (narrow && document.querySelector('.tab.sel')?.scrollIntoView({ block: 'nearest', inline: 'start' })), [narrow, tab?.id])
  useEffect(() => {
    localStorage.setItem('laki.panel', JSON.stringify(panelOpen))
    localStorage.setItem('laki.panelTab', JSON.stringify(panelTab))
    localStorage.setItem('laki.panelW', JSON.stringify(panelW))
    localStorage.setItem('laki.previewW', JSON.stringify(previewW))
  }, [panelOpen, panelTab, panelW, previewW])

  // the theme, painted before the terminals read it (their effects run before ours)
  const paint = paintOf(view?.settings)
  const lessClear = useSyncExternalStore(LESS.on, LESS.now)
  const moreContrast = useSyncExternalStore(MORE.on, MORE.now)
  const theme = paintKey(paint) + (lessClear ? ' less' : '') + (moreContrast ? ' more' : '') // terminals repaint when it changes
  const painted = useRef<string | null>(null)
  const glassed = useRef<boolean | null>(null)
  if (view && painted.current !== theme) {
    if (glassed.current !== blurred(paint)) bridge?.glass?.((glassed.current = blurred(paint))) // the window's own blur
    painted.current = theme
    applyTheme(paint)
    localStorage.setItem('laki.theme', JSON.stringify(paint))
  }
  // L7: no https picture straight from the window: an extension's through the daemon's /img, GitHub's avatars by the switch
  imagesVia(view?.imgKey && base !== null ? u => `${base}/img?k=${view.imgKey}&u=${encodeURIComponent(u)}` : undefined)
  showAvatars(view?.settings.avatars !== false)
  // Settings' Dock icon (unset: the app's own, nothing to send)
  const dockIcon = view?.settings.dockIcon
  useEffect(() => {
    const d = DOCK_ICONS.find(x => x[0] === dockIcon)
    if (d && bridge?.dockIcon) dockPng(d[2]).then(bridge.dockIcon).catch(() => {})
  }, [dockIcon])
  // Settings › Resources' Stop on the video: closed
  useEffect(() => {
    const f = (e: Event) => (e as CustomEvent).detail === 'video' && setVideo(null)
    window.addEventListener('laki-stop', f)
    return () => window.removeEventListener('laki-stop', f)
  }, [])
  // the floating bubbles (Settings › Appearance; main shows them while Laki isn't in front): each workspace whose agent
  // works or waits, the waiting ones first, with what it asked or last said, then the recent ones, in the theme's colors
  const fs = view?.settings
  // a bubble's card says what the sidebar's hover card does: the branch, the agents, the PR, the diff, the ports
  const projWords = (w: WorkspaceView) => (p => (p ? `${emojiOf(p.icon) ? `${emojiOf(p.icon)} ` : ''}${p.name}` : ''))(projOf(w)) // a card's project: its emoji too (ponytail: an icon by name isn't drawn there)
  const floatMore = (w: WorkspaceView) => {
    const pr = w.pr
    return {
      branch: `${w.branch || w.path.split('/').pop()} · $PORT ${w.port}`,
      agents: view!.tabs.filter(t => t.workspace === w.id && t.kind === 'agent').map(t => `${t.name}${t.progress ? ` ${t.progress.pct}%` : ''}`).join(' · '),
      pr: pr && { state: prState(pr), text: `#${pr.number} ${pr.title}`, meta: [pr.author && !pr.mine && `by ${pr.author}`, (pr.list?.length || pr.checks) && ciText(pr), pr.review && REVIEW[pr.review], pr.conflict && pr.state === 'OPEN' && 'conflicts'].filter(Boolean).join(' · ') },
      lines: [
        w.stat && (w.stat.add > 0 || w.stat.del > 0 || w.stat.dirty > 0) && `+${w.stat.add} −${w.stat.del} in ${w.stat.files} ${w.stat.files === 1 ? 'file' : 'files'}${w.stat.dirty ? `, ${w.stat.dirty} not committed` : ''}`,
        w.ports.length > 0 && `listening on ${w.ports.map(p => `:${p}`).join(' ')}`,
      ].filter((x): x is string => !!x),
    }
  }
  const atWork = fs?.floater === false ? [] : live.flatMap(w => {
    const ag = view!.tabs.filter(t => t.workspace === w.id && t.kind === 'agent')
    const t = ag.find(t => t.status === 'waiting') ?? ag.find(t => t.status === 'running')
    const last = t && (t.status === 'waiting' ? waits.current.get(t.id) || t.ask?.options.map(o => o.label).join(' / ') : t.last && `Its last turn: ${t.last}`) // working: what it said the turn before
    return t ? [{ tab: t.id, name: wsName(w), project: projWords(w), status: t.status as 'running' | 'waiting' | 'idle' | 'done', color: tint(w), last: last?.replace(/\s+/g, ' ').trim().slice(0, 300), ...floatMore(w) }] : []
  }).sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'))
  // Settings' Recent sessions too: the workspaces whose agent worked last, one bubble each, after the ones at work
  // (finished ones you haven't seen first, then by when; one idle longer than floaterRecentHours drops out)
  const recentN = Math.min(5, Math.max(0, Math.floor(fs?.floaterRecent ?? 3)))
  const recentFor = (fs?.floaterRecentHours ?? 4) * 3600e3
  const [, minute] = useState(0)
  useEffect(() => {
    if (!recentN || !recentFor) return
    const t = setInterval(() => minute(n => n + 1), 60e3) // recent ones age out without a state change
    return () => clearInterval(t)
  }, [recentN, recentFor])
  // Finished ones stand out (floaterDone, unset: on): one you haven't seen stays a bubble, green, past recentN and the hours
  const doneAlert = fs?.floaterDone !== false
  const recent = (!recentN && !doneAlert) || fs?.floater === false ? [] : live
    .filter(w => !atWork.some(f => view!.tabs.find(t => t.id === f.tab)?.workspace === w.id))
    .flatMap(w => {
      const t = view!.tabs.filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited' && active.current[t.id]).sort((a, b) => active.current[b.id] - active.current[a.id])[0]
      return t && (!recentFor || (doneAlert && t.done) || Date.now() - active.current[t.id] < recentFor) ? [{ t, w, at: active.current[t.id] }] : []
    })
    .sort((a, b) => Number(b.t.done) - Number(a.t.done) || b.at - a.at)
    .filter((x, i) => i < recentN || (doneAlert && x.t.done))
    .map(({ t, w }) => ({ tab: t.id, name: wsName(w), project: projWords(w), status: (t.done ? 'done' : 'idle') as 'idle' | 'done', color: tint(w), last: t.last && `Its last answer: ${t.last.replace(/\s+/g, ' ').trim().slice(0, 300)}`, ...floatMore(w) }))
  const floats = [...atWork, ...recent].slice(0, Math.max(1, fs?.floaterMax ?? 12))
  const floatColors = useMemo(() => Object.fromEntries(([['bg', '--panel'], ['fg', '--fg'], ['muted', '--muted'], ['line', '--line'], ['running', '--running'], ['waiting', '--waiting'], ['done', '--done'], ['accent', '--accent'], ['font', '--ui-font'], ...TAB_COLORS.map(c => [`tc${c}`, `--tc-${c}`])] as const).map(([k, v]) => [k, css(v)])), [theme]) // as painted just above
  const floatOpts = { style: fs?.floaterStyle ?? 'gradient', cards: fs?.floaterCards !== false, add: fs?.floater !== false && fs?.floaterNew !== false, menu: fs?.floaterMenu === 'card' ? 'card' : 'stack', voiceTo: fs?.floaterVoiceTo === 'new' ? 'new' : 'pick', doneAlert, ai: aiOn(fs) }
  const floatKey = JSON.stringify([floats, floatColors, floatOpts])
  useEffect(() => {
    bridge?.floats?.(floats, floatColors, floatOpts)
    const keep = new Set(view?.tabs.map(t => t.id))
    for (const id of Object.keys(active.current)) if (view && !keep.has(id)) delete active.current[id] // closed tabs go
    try {
      localStorage.setItem('laki.active', JSON.stringify(active.current))
    } catch {}
  }, [floatKey])

  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const archived = useRef<string[]>([]) // workspaces archived for a merged PR, while their toast shows
  const archivedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // the sidebar's foot, in one row: its words dropped one by one from the right (data-bare: how many) until it fits;
  // measured as the sidebar resizes and the theme (its font) changes
  const footRef = useRef<HTMLDivElement | null>(null)
  const fit = () => {
    const el = footRef.current
    if (!el) return
    const n = el.querySelectorAll('.ib-label').length
    for (let bare = 0; bare <= n; bare++) {
      el.dataset.bare = String(bare)
      if (el.scrollWidth <= el.clientWidth + 1) break
    }
  }
  const fitFoot = useCallback((el: HTMLDivElement | null) => {
    footRef.current = el
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])
  const toast = (text: string, undo?: () => void, label?: string, ok?: boolean) => {
    clearTimeout(noteTimer.current) // an older toast's timer would cut this one short
    setNote({ text, undo, label, ok })
    noteTimer.current = setTimeout(() => setNote(null), undo ? 8000 : 6000)
  }
  const done = (text: string, undo?: () => void) => toast(text, undo, undefined, true) // a success, with a check
  const fail = (e: unknown) => toast((e as Error).message)
  const call = useCallback(<T,>(method: string, params: object = {}) => api.call<T>(method, params).catch(e => (fail(e), Promise.reject(e))), [])

  // a tab's queue (QueueStrip): the whole list again, with what it was (a delivery meanwhile refuses it)
  const queueSave = (t: TabView, queue: string[], was: string[]) => call('queueSet', { tab: t.id, queue, was }).then(() => true, () => false)
  // one removed (i), or all: Undo puts the list back while nothing else changed it
  const queueRemove = (t: TabView, i?: number) => {
    const was = t.queue ?? []
    const left = i === undefined ? [] : was.filter((_, j) => j !== i)
    void queueSave(t, left, was).then(ok => ok && toast(i === undefined ? `Cleared ${t.name}'s queue` : `Removed from ${t.name}'s queue`, () => void queueSave(t, was, left)))
  }
  // the Layout menu (the tab bar's; Settings › Keys' layout): a split by role (shared/layout.ts fillRoles) from this
  // workspace's tabs, and the side panel as it says. One that needs a Run tab or a shell starts it first, then
  // layoutWait lays it out once it's in the view (10 s at most)
  const roleOf = (t: TabView): Role | undefined => (t.kind === 'agent' ? 'agent' : t.kind === 'dev' ? 'dev' : t.kind === 'shell' ? 'shell' : undefined)
  const roleTabs = (w: WorkspaceView, gs: Layout[]): RoleTab[] => {
    const mine = viewRef.current?.tabs.filter(t => t.workspace === w.id && t.status !== 'exited') ?? []
    return [...new Set([...gs.flatMap(tabsOf), ...mine.map(t => t.id)])].flatMap(id => (t => (t ? [{ id, role: roleOf(t) }] : []))(mine.find(t => t.id === id)))
  }
  const layoutWait = useRef<{ ws: string; tree: RoleLayout; panel?: SavedLayout['panel']; needs: Role; until: number } | null>(null)
  const applyLayout = async (tree: RoleLayout, panel?: SavedLayout['panel'], needs?: Role) => {
    if (!ws || narrow) return
    if (needs && !roleTabs(ws, groups).some(t => t.role === needs)) {
      layoutWait.current = { ws: ws.id, tree, panel, needs, until: Date.now() + 10000 }
      return void (needs === 'dev' ? run() : call('tabNew', { ws: ws.id, preset: 'shell' }).catch(() => (layoutWait.current = null)))
    }
    const next = fillRoles(tree, roleTabs(ws, groups), tab?.kind === 'agent' ? tab.id : undefined)
    if (!next) return toast('No agent running here to lay out')
    setGroups(next)
    selectTab(tabsOf(next[0])[0])
    if (panel?.open && panel.tab) (setPanelTab(panel.tab as PanelTab), setPanelOpen(true), panel.w && setPanelW(panel.w))
    else setPanelOpen(false)
  }
  const saveLayout = async () => {
    if (!ws || !group) return
    const tree = toRoles(group, roleTabs(ws, groups), tab?.kind === 'agent' ? tab.id : undefined)
    if (!tree) return toast('Nothing here to save: a layout keeps agents, the Run tab and shells')
    const name = (await askText('Save this layout', { text: 'Its splits, by what each pane is (an agent, the Run tab, a shell), and the side panel as it is now.', ok: 'Save', placeholder: 'Agent, dev server and Preview' }))?.trim()
    if (!name) return
    const saved: SavedLayout = { name, tree, panel: { open: panelOpen, tab: panelTab, w: panelW } }
    call('settingsSet', { layouts: [...(settings.layouts ?? []).filter(l => l.name !== name), saved] }).then(() => done(`Saved the layout ${name}`), () => {})
  }
  const layoutMenu = (): MenuItem[] => {
    if (!ws) return []
    const rt = roleTabs(ws, groups)
    const agents = rt.filter(t => t.role === 'agent').length
    const saved = settings.layouts ?? []
    const mine = project?.config?.layout
    return [
      ...LAYOUT_PRESETS.map((p): MenuItem => {
        const off = p.needs === 'dev' && !rt.some(t => t.role === 'dev') && !ws.run
        return off
          ? { label: p.name, icon: 'splitRight', sub: 'No Run tab, and no run script to start one', run: editScripts }
          : { label: p.name, icon: p.panel ? 'panel' : p.tree && 'dir' in p.tree ? (p.tree.dir === 'row' ? 'splitRight' : 'splitDown') : 'agent', run: () => void applyLayout(p.tree, p.panel ? { open: true, tab: p.panel, w: Math.max(panelW, 560) } : undefined, p.needs) }
      }),
      ...(agents > 1 ? [{ label: `All agents (${Math.min(agents, 4)})`, icon: 'layers', run: () => void applyLayout(allAgents(Math.min(agents, 4))) } as MenuItem] : []),
      ...(saved.length ? [null as unknown as MenuItem, { head: 'Saved' } as MenuItem, ...saved.map((l): MenuItem => ({ label: l.name, icon: 'layers', hint: l.name === mine ? ON : undefined, run: () => void applyLayout(l.tree, l.panel) }))] : []),
      null as unknown as MenuItem,
      { label: 'Save this layout…', icon: 'save', run: () => void saveLayout() },
      ...(saved.length && project && !project.kind
        ? [
            { label: `Use for new workspaces in ${project.name}`, icon: 'plus', items: [{ label: 'None', hint: mine ? undefined : ON, run: () => setProjectLayout(undefined) }, ...saved.map((l): MenuItem => ({ label: l.name, hint: l.name === mine ? ON : undefined, run: () => setProjectLayout(l.name) }))] } as MenuItem,
            { label: 'Remove a saved layout', icon: 'trash', items: saved.map((l): MenuItem => ({ label: l.name, danger: true, run: () => call('settingsSet', { layouts: saved.filter(x => x !== l) }).catch(() => {}) })) } as MenuItem,
          ]
        : []),
    ]
  }
  const setProjectLayout = (layout?: string) => project && call('projectSet', { id: project.id, config: { ...project.config, layout } }).then(() => done(layout ? `New workspaces in ${project.name} start as ${layout}` : `New workspaces in ${project.name} start as they come`), () => {})
  // a layout waiting for its Run tab or shell; a new workspace whose project has a layout for new ones, once its tabs show
  const layoutSeen = useRef<Set<string> | null>(null) // the workspaces there were: theirs stay as they are
  useEffect(() => {
    const v = view
    if (!v) return
    const p = layoutWait.current
    if (p && (Date.now() > p.until || p.ws !== ws?.id)) layoutWait.current = null
    else if (p && ws && roleTabs(ws, groups).some(t => t.role === p.needs)) (layoutWait.current = null), void applyLayout(p.tree, p.panel)
    if (!layoutSeen.current) return void (layoutSeen.current = new Set(v.workspaces.map(w => w.id)))
    for (const w of v.workspaces) {
      if (layoutSeen.current.has(w.id) || w.archived) continue
      const name = v.projects.find(p => p.id === w.project)?.config?.layout
      const l = name ? v.settings.layouts?.find(x => x.name === name) : undefined
      if (!l || narrow) {
        layoutSeen.current.add(w.id)
        continue
      }
      if (!v.tabs.some(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited')) continue // its agent not up yet
      // the shell and Run tab it has a place for: started once, laid out when they're there (15 s at most)
      const at = (layoutNew.current[w.id] ??= { since: Date.now(), asked: new Set() })
      const has = new Set(roleTabs(w, []).map(t => t.role))
      const want = rolesIn(l.tree).filter(r => !has.has(r) && (r === 'shell' || (r === 'dev' && w.run)))
      for (const r of want.filter(r => !at.asked.has(r))) at.asked.add(r), void (r === 'shell' ? call('tabNew', { ws: w.id, preset: 'shell' }) : call('run', { ws: w.id })).catch(() => {})
      if (want.length && Date.now() - at.since < 15000) continue
      layoutSeen.current.add(w.id)
      delete layoutNew.current[w.id]
      const next = fillRoles(l.tree, roleTabs(w, []))
      if (next) setGroupsOf(w.id, next)
    }
  }, [view])
  const layoutNew = useRef<Record<string, { since: number; asked: Set<Role> }>>({})
  // files, an image or text dropped on a workspace's row (or its rail pin): to its agent, the one focused there, else its
  // first live one, else a new one (its last agent's profile, else the default); queued while it works (Undo takes it
  // back off the queue); with ⌥, a box first to add a line. Terminals', Browsers' and archived rows take none
  const [dropOn, setDropOn] = useState<string | null>(null)
  const dropAgent = (w: WorkspaceView) => (ts => ts.find(t => t.id === tabByWs[w.id]) ?? ts[0])((viewRef.current?.tabs ?? []).filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited'))
  const takesDrop = (w: WorkspaceView, e: React.DragEvent) => !w.archived && !projOf(w)?.kind && w.browser === undefined && ['Files', 'text/plain'].some(k => e.dataTransfer.types.includes(k))
  const dropProps = (w: WorkspaceView) => ({
    onDragOver: (e: React.DragEvent) => takesDrop(w, e) && (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'), dropOn !== w.id && setDropOn(w.id)),
    onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropOn(d => (d === w.id ? null : d)),
    onDrop: (e: React.DragEvent) => {
      setDropOn(null)
      if (!takesDrop(w, e)) return
      e.preventDefault() // the window's own drop (a folder: a project) leaves it
      void dropTo(w, [...e.dataTransfer.items].flatMap(i => (i.kind === 'file' ? [{ f: i.getAsFile(), dir: !!i.webkitGetAsEntry?.()?.isDirectory }] : [])), e.dataTransfer.files.length ? '' : e.dataTransfer.getData('text/plain'), e.altKey)
    },
  })
  const dropTo = async (w: WorkspaceView, files: { f: File | null; dir: boolean }[], text: string, more: boolean) => {
    const paths: string[] = []
    for (const { f, dir } of files) {
      if (!f) continue
      if (dir) {
        const p = bridge?.pathOf?.(f) // a folder: its path, never read
        if (p) paths.push(p)
        else toast(`${f.name}: a folder goes in by its path, in the app only`)
        continue
      }
      try {
        paths.push((await keepFile(f, (data, ext) => api.call<string>('imageSave', { data, ext }), (data, name) => api.call<string>('fileSave', { data, name }))).path)
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}, not sent`)
      }
    }
    let msg = withPaths(text, paths)
    if (!msg.trim()) return
    const agent = dropAgent(w)
    const names = files.map(x => x.f?.name).filter(Boolean).join(', ') || clip(text, 40)
    if (more) {
      const t = await askText(`To ${wsName(w)}${agent ? ` · ${agent.name}` : ''}`, { text: 'Add a line if you like: it goes before the paths.', value: msg, multi: true, ok: 'Send' })
      if (!t?.trim()) return
      msg = t
    }
    if (!agent) {
      const last = viewRef.current?.tabs.filter(t => t.workspace === w.id && t.kind === 'agent').at(-1)
      const t = await call<TabView>('tabNew', { ws: w.id, preset: last?.profile ?? last?.preset ?? settings.agent ?? 'claude', prompt: msg }).catch(() => null)
      return t && done(`Started ${t.name} in ${wsName(w)} with ${names}`)
    }
    const r = await call<{ queued?: number }>('send', { target: agent.id, text: msg, whenIdle: true }).catch(() => null)
    if (!r) return
    const where = `${wsName(w)} · ${agent.name}`
    if (!r.queued) return done(`Sent ${names} to ${where}`)
    toast(`Sent ${names} to ${where}: queued until it's free`, () => {
      const was = viewRef.current?.tabs.find(t => t.id === agent.id)?.queue ?? []
      const i = was.lastIndexOf(msg)
      if (i < 0) return toast('Already sent: it was free')
      void queueSave(agent, was.filter((_, j) => j !== i), was)
    })
  }
  // a session by id, or one just created (its view may not have arrived yet)
  const selectTab = useCallback((ref: string | { id: string; workspace: string }) => {
    const t = typeof ref === 'string' ? viewRef.current?.tabs.find(t => t.id === ref) : ref
    if (!t) return
    mru.current = [t.id, ...mru.current.filter(x => x !== t.id)].slice(0, 200)
    setWsId(t.workspace)
    setTabByWs(m => ({ ...m, [t.workspace]: t.id }))
    setReviewing(m => (m[t.workspace] ? { ...m, [t.workspace]: false } : m))
  }, [])
  const selectGroup = (g: Layout) => selectTab(mru.current.find(id => tabsOf(g).includes(id)) ?? tabsOf(g)[0])
  // narrow shows them flat: kept as they were. To the daemon a moment later (a divider's drag is many)
  const setGroups = (next: Layout[]) => ws && !narrow && setGroupsOf(ws.id, next)
  const setGroupsOf = (id: string, next: Layout[]) => {
    setStored(m => ({ ...m, [id]: next }))
    if (!layoutsOn) return
    clearTimeout(pushes.current[id] as ReturnType<typeof setTimeout>)
    pushes.current[id] = setTimeout(() => {
      pushes.current[id] = true
      call('layoutSet', { ws: id, groups: next })
        .catch(() => {})
        .finally(() => pushes.current[id] === true && delete pushes.current[id])
    }, 250)
  }

  // the daemon connection
  const widgetSay = useRef<WidgetApi['say']>(undefined) // an extension's event handler's toast or dialog (widget-say)
  const [extModal, setExtModal] = useState<{ wid: string; ws?: string; m: SayModal; n: number } | null>(null) // an extension's own dialog (WidgetModal); n: its key, kept by a say with its id
  const extN = useRef(0)
  const toolAsk = useRef<(m: Msg) => void>(undefined) // an agent wants to run an extension's tool
  const earlyAsks = useRef<Msg[]>([]) // ones that came before the view: asked once it's drawn (widgetAsks, as a window opens)
  useEffect(() => void (toolAsk.current && earlyAsks.current.splice(0).forEach(m => toolAsk.current!(m))))
  useEffect(() => {
    const off = api.on(m => {
      if (m.ev === 'state') setView(m.view)
      else if (m.ev === 'widget-say' && typeof m.notify === 'string') {
        // an extension's notify: its new words, a notification (its click: its full view, else its page) and a toast
        const w = viewRef.current?.widgets?.find(x => x.id === m.widget)
        const open = () => setDialog(w?.full ? { widget: m.widget } : { extension: m.widget })
        if (viewRef.current?.settings.notify !== false && !document.hasFocus()) notify(w?.name ?? m.widget, m.notify, '', open, viewRef.current?.settings.notifySound) // looking at Laki: the toast is enough
        toast(`${w?.name ?? m.widget}: ${m.notify}`, open, 'Open')
      } else if (m.ev === 'widget-say') widgetSay.current?.(m.widget, { toast: m.toast, modal: m.modal, close: m.close }, m.ws)
      else if (m.ev === 'toolAsk') toolAsk.current ? toolAsk.current(m) : earlyAsks.current.push(m)
      else if (m.ev === 'toolDone') (earlyAsks.current = earlyAsks.current.filter(x => x.req !== m.req)), toolLine.drop(m.req) && toolOn === m.req && unchoose(m.req) // answered elsewhere: out of line
      else if (m.ev === 'problem') setProblem(m.text)
      else if (m.ev === 'pin') (setPinAsk({ left: m.left }), setProblem(undefined)) // asked: a miss before it (the link's key alone) says nothing
      else if (m.ev === 'remote') {
        // remote access stopped by a wrong PIN on its page: said here, and as a notification
        toast(m.text, () => setDialog({ section: 'remote' }), 'Settings')
        notify('Remote access', m.text, '', () => setDialog({ section: 'remote' }), viewRef.current?.settings.notifySound)
      } else if (m.ev === 'open') {
        setConnected(true)
        setProblem(undefined)
        setPinAsk(null)
        api.call<AppInfo[]>('apps').then(setApps, () => {})
      }
      else if (m.ev === 'close') setConnected(false)
      else if (m.ev === 'turn') {
        if (m.kind === 'waiting') waits.current.set(m.tab, m.text ?? '')
        // a wait a moment later, with its menu (often drawn after the hook), unless it's over by then
        const post = () => {
          const t = viewRef.current?.tabs.find(t => t.id === m.tab)
          const shown = document.hasFocus() && shownTabs.current.includes(m.tab)
          const s = viewRef.current?.settings
          const w = viewRef.current?.workspaces.find(w => w.id === t?.workspace)
          if (!t || shown || s?.notify === false || s?.notifyOn?.[m.kind as NotifyKind] === false || t.muted || w?.muted || (m.kind === 'waiting' && t.status !== 'waiting')) return
          const body = m.kind === 'waiting' ? `needs you${m.text ? `: ${m.text}` : ''}` : m.kind === 'limit' ? 'hit a usage limit' : m.text || 'finished'
          // a button per choice of its menu; a permission prompt whose menu wasn't read: Allow and Deny, its first and last
          const actions: NotifyAction[] | undefined =
            m.kind !== 'waiting' ? undefined : t.ask ? t.ask.options.map(o => ({ text: `${o.n}. ${o.label}`, n: o.n, label: o.label })) : /permission/i.test(m.text ?? '') ? [{ text: 'Allow', pick: 'first' }, { text: 'Deny', pick: 'last' }] : undefined
          notify(`${w ? wsName(w) : t.workspace} · ${t.name}`, body.slice(0, 200), t.id, () => selectTab(t.id), s?.notifySound, actions)
        }
        if (m.kind === 'waiting') setTimeout(post, 800)
        else post()
      } else if (m.ev === 'flow') {
        // a workflow run asks you, shows you something (a window, maybe a notification), or ended (a notify end, a failure)
        const s = viewRef.current?.settings
        if (m.kind === 'refused') {
          // a repo's workflow an event or its schedule didn't start (once per file version): Look… opens it, where its
          // sheet shows the file before Allow; never an Allow here
          if (s?.notify === false) return
          const look = () => setDialog({ workflows: '', wf: m.wf })
          const words = `${m.name} didn't start on ${m.on === 'schedule' ? 'its schedule' : m.on}: ${m.changed ? 'it changed in the repo since you allowed it' : "it comes with the repo and isn't allowed yet"}`
          notify(`Workflow · ${m.name}`, words.slice(0, 200), '', look, s?.notifySound)
          toast(words.slice(0, 160), look, 'Look…')
          return
        }
        if (m.kind === 'paused') {
          // 5 failed runs in a row that started by themselves: events and its schedules don't start it now
          const on = () => void api.call('flowPause', { ...m.wf, on: true }).then(() => toast(`${m.name} is on again`), fail)
          if (s?.notify !== false) notify(`Workflow · ${m.name}`, `paused: ${m.text}`, '', () => setDialog({ workflows: '', wf: m.wf }), s?.notifySound)
          toast(`${m.name} is paused: ${m.text}`.slice(0, 160), on, 'Turn on again')
          return
        }
        const open = () => setDialog({ workflows: '', run: m.id })
        // a window (a Show you's unless modal: no; an end's with modal: yes) and a popover, each as the block says
        const win = m.kind === 'show' ? { run: m.id, name: m.name, title: m.text, body: m.body ?? '' } : { run: m.id, name: m.name, title: `${m.name}: ${m.status}`, body: m.text ?? '' }
        if (m.kind === 'show' ? m.modal !== false : m.kind === 'end' && m.modal) setShown(q => [...q, win].slice(-10))
        if ((m.kind === 'show' || m.kind === 'end') && m.popover) setPops(q => [...q, { ...win, key: Date.now() + Math.random() }].slice(-3))
        if (m.kind === 'show') {
          if (m.notify && s?.notify !== false) notify(`Workflow · ${m.name}`, String(m.text).slice(0, 200), '', open, s?.notifySound)
          return
        }
        if (s?.notify === false || (m.kind === 'end' && !m.notify)) return
        const body = m.kind === 'waiting' ? `asks you: ${m.text}` : `${m.status}: ${m.text}`
        notify(`Workflow · ${m.name}`, body.slice(0, 200), '', open, s?.notifySound)
        if (m.kind === 'waiting') toast(`${m.name} asks you: ${m.text}`.slice(0, 160), open, 'Open')
      } else if (m.ev === 'reminder') {
        // the calendar's reminder, due (the daemon rings each once): a notification and a toast, Open its workspace. One
        // due while the app was closed comes right after the first state, before it's drawn: once there's a view
        const ring = (n = 0): unknown => {
          const v = viewRef.current
          if (!v) return n < 100 && setTimeout(() => ring(n + 1), 50)
          const w = m.ws ? v.workspaces.find(x => x.id === m.ws && !x.archived) : undefined
          const open = () => (w ? (setDialog(null), setWsId(w.id)) : setDialog('calendar'))
          if (v.settings.notify !== false) notify('Reminder', String(m.text).slice(0, 200), (w && v.tabs.find(x => x.workspace === w.id)?.id) ?? '', open, v.settings.notifySound) // its click: there
          toast(`Reminder: ${m.text}`.slice(0, 160), open, w ? 'Open' : 'Calendar')
        }
        ring()
      } else if (m.ev === 'started') {
        // a delayed start's agent (wsNew startAt), started by the daemon: where it is, and late when it was down then
        const open = () => (setDialog(null), selectTab(m.tab))
        const text = `${m.agent} started (scheduled${m.late ? `, late: it was due ${new Date(m.late).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''})`
        if (viewRef.current?.settings.notify !== false) notify(String(m.name), text, m.tab, open, viewRef.current?.settings.notifySound)
        toast(`${m.name}: ${text}`, open, 'Open')
      } else if (m.ev === 'focus') {
        selectTab(m.tab) // Laki AI's "show me": that tab, in its workspace
      } else if (m.ev === 'archived') {
        // several at once (the setting just turned on): one message, whose Undo brings them all back
        const all = (archived.current = [...archived.current, m.ws])
        clearTimeout(archivedTimer.current)
        archivedTimer.current = setTimeout(() => (archived.current = []), 8000)
        toast(all.length > 1 ? `Archived ${all.length} workspaces: their PRs merged` : `Archived ${m.name}: PR #${m.pr} merged`, () => {
          archived.current = []
          for (const id of all) call('wsRestore', { id }).catch(() => {})
        })
      } else if (m.ev === 'timer') {
        // Laki AI's laki_timer: the sidebar's timers live here; the answer goes back as the agent browser's does
        new Promise(ok => ok(timerAct.current(m as Msg & { act: string; ms: number })))
          .then(
            result => api.call('browseDone', { id: m.req, ok: true, result }),
            e => api.call('browseDone', { id: m.req, ok: false, error: String((e as Error).message) }),
          )
          .catch(() => {})
      } else if (m.ev === 'peek') {
        // Laki AI looked at a tab (lit where it's shown, else the window) or used the agent browser (the window); Laki in
        // the background (away: animations paused): none, not a late one when you're back
        if (viewRef.current?.settings?.aiGlow !== false && !document.documentElement.classList.contains('away')) setGlow({ tab: shownTabs.current.includes(m.tab) ? m.tab : undefined, n: Date.now() })
      } else if (m.ev === 'browse' && bridge?.browse) {
        // the agent browser (laki browser): main drives a hidden window; its answer goes back to the daemon
        const { req: id, ev: _, ...r } = m // req: an event with an id would be taken for a reply
        bridge.browse(r).then(
          result => api.call('browseDone', { id, ok: true, result }),
          e => api.call('browseDone', { id, ok: false, error: String((e as Error).message).replace(/^Error invoking remote method 'browse': (Error: )?/, '') }),
        ).catch(() => {})
      }
    })
    api.connect()
    bridge?.onFocusTab(id => (setDialog(null), selectTab(id))) // a notification's or the menu bar's: over any page, as ⌘J
    bridge?.onDeepLink?.(setLink)
    onLakiLink(setLink) // a laki:// link in the app (the AI's to a workspace): routed here, as the Dock's
    // the menu bar's screenshot: saved where pasted images go, then the new-workspace page with it (another one adds to it)
    bridge?.onShot?.((png, note) =>
      api.call<string>('imageSave', { data: png, ext: 'png' }).then(
        path => (setNewImages(i => [...i, { path, url: `data:image/png;base64,${png}`, ...(note && { note }) }]), setDialog('new')), // its note: the page adds it to the prompt
        e => toast(`The screenshot wasn't saved: ${(e as Error).message}`),
      ),
    )
    return off
  }, [selectTab])

  // laki:// links select and fill in; nothing starts from one
  useEffect(() => {
    if (!link || !view) return
    setLink(undefined)
    const l = parseLink(link)
    const proj = (id?: string) => view.projects.find(p => p.id === id || p.name === id)?.id
    if (l?.to === 'ws') {
      // by id, else by name (a model may write the name): a live one first
      const w = view.workspaces.find(w => w.id === l.ws) ?? [...view.workspaces].sort((a, b) => +!!a.archived - +!!b.archived).find(w => (w.name || w.id) === l.ws || wsName(w) === l.ws) // its own name (MCP's) or the one shown
      const t = view.tabs.find(t => t.id === l.tab && t.workspace === w?.id)
      if (!w) toast(`No workspace ${l.ws}`)
      else if (w.archived) toast(`${wsName(w)} is archived`)
      else {
        setDialog(null)
        t ? selectTab(t) : setWsId(w.id)
      }
    } else if (l?.to === 'new') {
      if (!view.projects.length) return toast('Add a project first (⌘O)')
      if (l.project && !proj(l.project)) toast(`No project ${l.project}: pick one`)
      setNewFor(proj(l.project))
      setNewInit({ prompt: l.prompt, name: l.name, ...(l.prompt && { linked: true }) })
      setDialog('new')
    } else if (l?.to === 'schedules') setDialog({ schedules: proj(l.project) ?? '' })
    else if (l?.to === 'settings') setDialog(l.section && isSection(l.section) ? { section: l.section, ...(l.spot && { spot: l.spot }) } : 'settings')
    else if (l?.to === 'studio') aiOn(settings) ? setDialog({ studio: l.id, back: { section: 'widgets' } }) : setDialog(l.id ? { extension: l.id, back: { section: 'widgets' } } : { section: 'ai' })
    else if (l?.to === 'extension') view.widgets?.some(w => w.id === l.id) ? setDialog({ extension: l.id, back: { section: 'widgets' }, ...(l.inspect && { tab: 'data' as const }) }) : toast(`No extension ${l.id}`)
    else if (l?.to === 'help') setDialog('help')
    else if (l?.to === 'board') setDialog('board')
    else if (l?.to === 'achievements') setDialog('achievements')
    else if (l?.to === 'ai') setDialog('ai')
    else if (l?.to === 'about') setDialog('about')
    else if (l?.to === 'onboard') (setOnboard(o => ({ ...o, off: false })), setDialog('onboard'))
    else if (l?.to === 'desk') settings.desk !== false ? setDialog('desk') : toast('My Desk is off: Settings › General › Pages')
    else if (l?.to === 'uikit') setDialog({ uikit: true, ...(l.icons && { icons: true }) })
    else if (l?.to === 'starters') setDialog('starters')
    else toast(`Laki can't open ${link.slice(0, 80)}`)
  }, [link, view])

  // tell the daemon what's on screen: it clears ● there and doesn't set it
  const current = useRef<string | null>(null)
  current.current = tab?.id ?? null
  const shownTabs = useRef<string[]>([])
  shownTabs.current = visible
  // the workspace whose per-workspace extensions show (scope workspace: Widgets.tsx inWs), and fetch: none under a page
  // over every workspace (Board, Schedule, the AI page…), nor a terminal's, a browser's or one on an SSH host; the Desk's
  // tiles: the one selected last (laki.ws), named on each
  const covered = schedulesOf(dialog) !== undefined || dialog === 'board' || dialog === 'achievements' || dialog === 'calendar' || dialog === 'ai' || !!specsOf(dialog) || !!flowsOf(dialog)
  const wsHere = !covered && ws && !ws.archived && !ws.host && !project?.kind ? ws.id : null
  useEffect(() => reportView(() => ({ tab: current.current, tabs: shownTabs.current, browse: !!bridge?.browse, ws: wsHere })), [tab?.id, visible.join(), wsHere])

  // a folder dropped on the window becomes a project (git or not), then a new workspace in it
  useEffect(() => {
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    // a drop target inside (the prompt's images) prevents the default: not a folder for us then
    const over = (e: DragEvent) => {
      if (!files(e)) return
      setDropping(!e.defaultPrevented)
      e.preventDefault()
    }
    const leave = (e: DragEvent) => !e.relatedTarget && setDropping(false)
    const drop = async (e: DragEvent) => {
      setDropping(false)
      if (!files(e) || e.defaultPrevented) return
      e.preventDefault()
      if (!bridge?.pathOf) return fail(new Error('Drop folders on the app window'))
      let last: Project | null = null
      for (const f of e.dataTransfer!.files) last = (await call<Project>('projectAdd', { path: bridge.pathOf(f) }).catch(() => null)) ?? last
      if (last) {
        setNewFor(last.id)
        setDialog('new')
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [call])

  // panes: a pane (or a whole tab) dropped beside or onto another pane, or into the tab bar; only where that
  // changes something
  const { drag, start } = useTabDrag(
    (id, whole, over) => {
      setGroups(move(groups, id, whole, over))
      selectTab(id)
      requestAnimationFrame(() => xterms.get(id)?.focus()) // the keyboard goes with it
    },
    (id, whole, over) => JSON.stringify(move(groups, id, whole, over)) !== JSON.stringify(groups), // a split where it is too
  )

  const newTab = async (preset: string, cmd?: string, w: WorkspaceView | null = ws) => w && selectTab(await call<TabView>('tabNew', { ws: w.id, preset, cmd }))
  // a new shell next to the focused pane
  const split = async (edge: 'right' | 'bottom', next = tab?.id) => {
    if (!ws || !next) return
    const t = await call<TabView>('tabNew', { ws: ws.id, preset: 'shell', beside: next, edge }) // the daemon puts it there
    if (!layoutsOn) setGroups(move([...groups, { tab: t.id }], t.id, false, { pane: next, edge }))
    selectTab(t)
  }

  const closeTabs = async (ts: TabView[]) => {
    const running = ts.filter(t => t.status !== 'exited')
    if (running.length && !settings.closeNoAsk && !(await ask(`Close ${ts.map(t => t.name).join(', ')}?`, { text: `${running.length > 1 ? 'Their processes' : 'Its process'} will be stopped.`, ok: 'Close', danger: true }))) return
    for (const t of ts) await call('tabClose', { id: t.id })
  }

  // ⌘↑ ⌘↓: the rows in sight, not those a folded project or group hides
  const wsAt = (d: number) => {
    const seen = order.filter(w => (w.id === ws?.id || !foldedAway(w)) && (!rail || kindOf(w) === railKind)) // the rail's: its list's
    if (!seen.length) return
    const i = Math.max(0, seen.findIndex(w => w.id === ws?.id))
    return seen[(i + d + seen.length) % seen.length]
  }
  const moveWs = (d: number) => (w => w && setWsId(w.id))(wsAt(d))
  const foldedAway = (w: WorkspaceView) => {
    const p = view?.projects.find(p => p.id === w.project)
    if (w.pinned || !p || find) return false // filtering: the hits show, folded or not
    if (folded.includes(p.id)) return true
    let under = false // a folded sep above it
    for (const x of rowsOf(p, live)) if (!('path' in x)) under = folded.includes(x.id)
      else if (x.id === w.id) return under
    return false
  }

  // while f runs, the rows of ids say what's happening (archiving, deleting: a worktree takes a moment to go)
  const [checking, setChecking] = useState<string>() // `<step>:<ws>`: its gates run (gated)
  const busyWith = async <T,>(ids: string[], what: string, f: () => Promise<T>) => {
    setGoing(g => ({ ...g, ...Object.fromEntries(ids.map(id => [id, what])) }))
    try {
      return await f()
    } finally {
      setGoing(g => Object.fromEntries(Object.entries(g).filter(([id]) => !ids.includes(id))))
    }
  }
  // what Delete takes with it, said first, a line each: where it is, uncommitted files, commits not pushed, its PR, agents
  // at work, servers, the storage folder's files; the daemon's git counts (wsPeek) are waited for 1.5 s at most
  const rmFacts = async (w: WorkspaceView): Promise<Fact[]> => {
    type Peek = { dirty?: number; ahead?: number; unpushed?: number }
    const pk: Peek = (view?.api ?? 0) >= 94 ? await Promise.race([api.call<Peek>('wsPeek', { id: w.id }).catch(() => ({})), new Promise<Peek>(r => setTimeout(() => r({}), 1500))]) : {}
    const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
    const tabs = view?.tabs.filter(t => t.workspace === w.id && t.status !== 'exited') ?? []
    const busy = tabs.filter(t => t.kind === 'agent' && (t.status === 'running' || t.status === 'waiting'))
    const facts: Fact[] = [{ label: 'Project', value: view?.projects.find(p => p.id === w.project)?.name ?? '' }]
    if (w.kind === 'worktree') facts.push({ label: 'Branch', value: `${w.branch} → ${w.base} (${w.codespace !== undefined ? 'only what was pushed stays' : 'stays'})` })
    facts.push(w.codespace !== undefined ? { label: 'Codespace', value: `${w.codespace || '(being made)'}: deleted on GitHub` } : { label: 'Folder', value: `${w.host ? `${w.host}:` : ''}${shortPath(w.path)}${w.kind === 'worktree' ? ' (removed)' : ' (stays)'}` })
    if (pk.dirty !== undefined) facts.push({ label: 'Changes', value: pk.dirty ? `${n(pk.dirty, 'uncommitted file')}: lost` : 'none uncommitted' })
    if (pk.ahead) facts.push({ label: 'Commits', value: `${n(pk.ahead, 'commit')} not in ${w.base}${pk.unpushed ? `, ${pk.unpushed} not pushed` : ', all pushed'} (on the branch)` })
    if (w.pr) facts.push({ label: 'PR', value: `#${w.pr.number} ${w.pr.draft ? 'draft' : w.pr.state.toLowerCase()}${w.pr.title ? ` · ${w.pr.title}` : ''} (stays on GitHub)` })
    if (w.pr?.author) facts.push({ label: 'Author', value: `${w.pr.author}${w.pr.mine ? ' (you)' : ''}` })
    facts.push({ label: 'Tabs', value: tabs.length ? `${n(tabs.length, 'tab')}${busy.length ? `, ${busy.length} agent${busy.length === 1 ? '' : 's'} at work: stopped` : ''}` : 'none' })
    if (w.ports.length) facts.push({ label: 'Servers', value: `${w.ports.map(p => `:${p}`).join(', ')}: stopped` })
    if (w.artifacts) facts.push(view?.settings?.keepStorage ? { label: 'Artifacts', value: `${n(w.artifacts, 'file')} (kept)` } : { label: 'Artifacts', value: `${n(w.artifacts, 'file')}: deleted` })
    facts.push({ label: 'Created', value: ago(w.created) })
    return facts
  }
  const rmWs = async (w: WorkspaceView) => {
    if (!(await ask(`Delete ${wsName(w)}?`, { text: `Its tabs stop${w.kind === 'worktree' ? ', the worktree is removed (the branch stays)' : ''}.`, facts: await rmFacts(w), ok: 'Delete', danger: true }))) return
    if (!(await busyWith([w.id], 'deleting', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return // the toast says why
    done(`Deleted ${wsName(w)}${w.kind === 'worktree' && w.branch ? `: its branch ${w.branch} stays` : ''}`)
  }
  // a terminal closes as a tab does: asked only while something runs in it (an agent, a command, a server) or it keeps artifacts
  const closeTerm = async (w: WorkspaceView) => {
    const busy = w.ports.length > 0 || (!!w.artifacts && !view?.settings?.keepStorage) || (view?.tabs ?? []).some(t => t.workspace === w.id && t.status !== 'exited' && (t.kind === 'agent' || t.status === 'running' || !!t.runs))
    if (busy && !(await ask(`Close ${wsName(w)}?`, { text: 'What runs in it stops.', facts: await rmFacts(w), ok: 'Close', danger: true }))) return
    if (!(await busyWith([w.id], 'closing', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return
    done(`Closed ${wsName(w)}`)
  }
  const rmItem = (w: WorkspaceView): MenuItem => (isTerm(w) ? { label: 'Close terminal', icon: 'x', key: 'x', danger: true, run: () => closeTerm(w) } : { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(w) })
  // an extension's gates on a ship, a merge or an archive: Checking… on its button while they run (checking: the step and
  // workspace; an archive's row says it, busyWith); a hold says what held it, each by its icon, then Do it anyway (asked
  // first) or the agent's fix, shown to change first. f(force) makes the call; undefined: failed (the toast says), or not done
  const gatesOn = (step: Gate, w?: WorkspaceView) => (view?.widgets ?? []).some(x => x.on && x.gates?.includes(step) && (!x.project || x.project === w?.project)) // a repo's: its project's only
  const gated = async <T,>(w: WorkspaceView, step: Gate, f: (force?: boolean) => Promise<T>): Promise<T | undefined> => {
    const key = `${step}:${w.id}`
    const on = gatesOn(step, w)
    if (on) setChecking(key)
    const r = await f().finally(() => on && setChecking(c => (c === key ? undefined : c)))
    const held = (r as { held?: GateHeld[] } | null | undefined)?.held
    if (!held) return r
    const fix = held.flatMap(h => (h.fix ? [h.fix] : [])).join('\n\n')
    const agent = !!fix && (view?.tabs ?? []).some(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited')
    const words = { ship: 'shipped', merge: 'merged', archive: 'archived' }[step]
    const n = await choose(`Not ${words}`, undefined, [{ label: 'Cancel' }, ...(agent ? [{ label: 'Ask the agent to fix it', primary: true }] : []), { label: 'Do it anyway', danger: true }], undefined, undefined, held.map(h => ({ icon: h.icon, label: h.name, value: h.why })))
    if (agent && n === 1) {
      const text = await askText('Ask the agent to fix it', { text: `To ${wsName(w)}'s agent, once it's free. Change it as you like.`, value: fix, multi: true, ok: 'Send' })
      return void (text?.trim() && call('send', { target: w.id, text, whenIdle: true }).then(() => toast('Sent to the agent'), () => {}))
    }
    if (n !== (agent ? 2 : 1)) return
    if (!(await ask(`${{ ship: 'Ship', merge: 'Merge', archive: 'Archive' }[step]} ${wsName(w)} anyway?`, { text: `Past what ${held.map(h => h.name).join(', ')} said.`, ok: 'Do it anyway', danger: true }))) return
    return f(true)
  }
  // archive: at once when nothing is uncommitted (Undo brings it back), else asked first: the worktree goes, with them
  const archive = async (w: WorkspaceView) => {
    const old = (view?.api ?? 0) < 12 // its daemon archives whatever is there: ask
    let forced = false
    const go = (ifClean: boolean) => (force?: boolean) => busyWith([w.id], gatesOn('archive', w) && !(forced ||= !!force) ? 'checking' : 'archiving', () => call<{ dirty?: number; held?: GateHeld[] } | null>('wsArchive', { id: w.id, ifClean, force: forced }).catch(() => undefined))
    const r = old ? { dirty: -1 } : await gated(w, 'archive', go(true))
    if (r === undefined) return // the toast says why, or it wasn't done
    if (r?.dirty) {
      const lost = r.dirty > 0 ? `${r.dirty} uncommitted ${r.dirty === 1 ? 'change goes' : 'changes go'} with the worktree` : 'the worktree is removed'
      if (!(await ask(`Archive ${wsName(w)}?`, { text: `Its tabs stop and ${lost} (the branch stays).`, ok: 'Archive', danger: true }))) return
      if ((await gated(w, 'archive', go(false))) === undefined) return
    }
    done(`Archived ${wsName(w)}`, () => restore(w.id))
  }
  // a Browsers page closes (⌘W) as a browser's tab does: no question, the next one of its project selected, Undo opens it again
  const closePage = async (w: WorkspaceView) => {
    if (going[w.id]) return // a held ⌘W: it's on its way
    const i = order.findIndex(x => x.id === w.id)
    const next = order.slice(i + 1).find(x => x.project === w.project) ?? order.slice(0, Math.max(0, i)).reverse().find(x => x.project === w.project)
    if (!(await busyWith([w.id], 'closing', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return
    if (next) setReveal(r => [...r, next.id]), setWsId(next.id) // in a folded group: it opens
    // ponytail: Undo opens its address again, not its pin, color, group or name (wsRm forgets them)
    done(`Closed ${wsName(w)}`, () => quickNew('browsers', w.browser || undefined))
  }
  const statText = (w: WorkspaceView) => w.stat && `+${w.stat.add} −${w.stat.del} in ${w.stat.files} ${w.stat.files === 1 ? 'file' : 'files'} against ${w.kind === 'worktree' ? w.base : 'the last commit'}${w.stat.dirty ? `, ${w.stat.dirty} not committed` : ''}`
  // a workspace's first agent tab; ● again on a tab, as if its turn ended unseen (until it's looked at again)
  const agentTab = (id: string) => view?.tabs.find(t => t.workspace === id && t.kind === 'agent')
  const markUnread = (id: string) => call('unread', { tab: id }).catch(() => {})
  // claude's and codex's accounts by name (Settings › Agents & profiles): the agent's own sign-in first
  const accountsOf = (agent?: string) => (isAccountAgent(agent) ? [{ id: HOME_ACCOUNT, name: 'Default sign-in' }, ...(view?.settings.accounts ?? []).filter(a => a.agent === agent)] : [])
  // Restart on another account: the same chat there (a turn at work stops: asked first)
  const restartOn = async (t: TabView, account: string, name: string) => {
    if (t.status === 'running' && !(await ask(`Restart ${t.name} on ${name}?`, { text: 'Its turn at work stops; the chat resumes there.', ok: 'Restart' }))) return
    call('tabAccount', { tab: t.id, account }).then(() => toast(`${t.name}: on ${name} now`, undefined, undefined, true), () => {})
  }
  // Settings › Agents & profiles' accounts: Sign in opens its terminal (Settings closes: the sign-in is there)
  const accountsApi: AccountsApi = {
    load: () => api.call<AccountView[]>('accounts'),
    usage: () => api.call<AgentUsage[]>('usage'),
    add: (agent, name) => call<Account>('accountAdd', { agent, name }),
    rename: (id, name) => call('accountSet', { id, name }),
    remove: async a => {
      if (!(await ask(`Remove the account ${a.name}?`, { text: `Its sign-in goes with it (${a.email ?? 'its folder'}, and Claude's Keychain item for it). Its chats stay: they're shared. Tabs on it start on the default next time.`, ok: 'Remove', danger: true }))) throw new Error('kept')
      return call('accountRm', { id: a.id })
    },
    login: a => call<WorkspaceView>('accountLogin', { id: a.id, agent: a.agent }).then(w => (setDialog(null), showNew(w.id))),
  }
  const showNew = (id: string, ...more: string[]) => (setReveal(r => [...r, ...(wsId ? [wsId] : []), id, ...more]), setWsId(id))
  const forkWs = (w: WorkspaceView) => call<WorkspaceView>('wsFork', { id: w.id }).then(x => showNew(x.id), () => {})

  const run = async () => ws && selectTab(await call<TabView>('run', { ws: ws.id }))
  // a RUN_SCRIPTS one (Run ▾, ⌘K): its tab, the last one's replaced; deploy once you say so
  const runScript = async (w: WorkspaceView, k: RunScript) => {
    if (k === 'deploy' && !(await ask(`Deploy ${w.name ?? w.id}?`, { text: "Runs the project's deploy script in a deploy tab.", ok: 'Deploy' }))) return
    call<TabView>('run', { ws: w.id, script: k }).then(selectTab, () => {})
  }
  // the panel on the right, on a tab: Info (⌘I), Files, Changes, Review, Preview
  const showPanel = (t: PanelTab) => (setPanelTab(t), setPanelOpen(true))
  const panelShown = panelOpen
  const togglePanel = (t = panelTab) => (panelShown && t === panelTab ? setPanelOpen(false) : showPanel(t))
  const info = panelOpen && panelTab === 'info'
  const showInfo = (on = !info) => (on ? showPanel('info') : setPanelOpen(false))
  // the run script: its tab, Run ▾
  const devTab = ws ? view?.tabs.find(t => t.workspace === ws.id && t.kind === 'dev') : undefined
  const devRunning = !!devTab && devTab.status !== 'exited'
  const editScripts = () => project && setDialog({ settings: project.id, script: 'run', spot: 'Scripts' }) // opened at its Scripts, lit
  // an action from Run ▾: a prompt to its agent's tab (queued while it works), a command to a shell (a new one if none)
  const runAction = async (w: WorkspaceView, a: RunAction, tab?: string) => {
    // a new tab goes in whole: the view doesn't have it yet
    const t = tab ? byId(tab) : await call<TabView>('tabNew', { ws: w.id, preset: 'shell' }).catch(() => null)
    if (!t) return
    selectTab(t)
    const r = await call<{ queued?: number }>('send', { target: t.id, text: stamp(a.text, Date.now()), whenIdle: a.target !== 'shell', vars: true }).catch(() => null) // its {{HH:mm}}-style dates: now's; its {{branch}}…: the daemon's
    if (r?.queued) toast(`${a.name}: queued for when the agent's turn ends`)
  }
  // Run ▾'s actions for a workspace (the sidebar's right click: any workspace's, its own tabs and project)
  const actionItems = (w: WorkspaceView): MenuItem[] => {
    const live = (view?.tabs ?? []).filter(t => t.workspace === w.id && t.status !== 'exited').map(t => ({ id: t.id, agent: t.kind === 'agent' ? t.preset : undefined, shell: t.kind === 'shell', busy: t.status !== 'idle' || !!t.runs }))
    const cfg = view?.projects.find(p => p.id === w.project)?.config
    return actionMenu(actionsFor(settings.actions, cfg?.actions, live, w.id === ws?.id ? tab?.id : undefined), id => byId(id)?.name, (a, t) => runAction(w, a, t))
  }
  // Run ▾: the toolbar's, and a sidebar row's right click (Run ›) for any workspace
  const runMenu = (w = ws): MenuItem[] => {
    if (!w) return []
    const dev = view?.tabs.find(t => t.workspace === w.id && t.kind === 'dev')
    const p = view?.projects.find(x => x.id === w.project)
    const edit = () => p && setDialog({ settings: p.id, script: 'run', spot: 'Scripts' }) // opened at its Scripts, lit
    return [
      { label: dev ? 'Restart' : 'Run', icon: 'run', key: 'r', run: () => (w.run ? call<TabView>('run', { ws: w.id }).then(selectTab, () => {}) : edit()) },
      ...(dev && dev.status !== 'exited' ? [{ label: 'Stop', icon: 'stop', key: 's', run: () => api.send('input', { tab: dev.id, data: '\x03' }) } as MenuItem] : []),
      ...(dev ? [{ label: 'Show the run tab', icon: 'terminal', key: 't', run: () => selectTab(dev.id) } as MenuItem] : []),
      ...(w.scripts ?? []).map((k): MenuItem => ({ label: SCRIPT_LABELS[k], icon: SCRIPT_ICONS[k], run: () => runScript(w, k) })),
      ...(w.noSetup && p?.hasSetup ? [{ label: 'Run the setup script', icon: 'terminal', sub: 'Made without it', run: () => call<TabView>('run', { ws: w.id, script: 'setup' }).then(selectTab, () => {}) } as MenuItem] : []), // its tab; the item goes
      { label: `Open localhost:${w.port}`, icon: 'link', key: 'o', run: () => openPort(w.port) },
      ...actionItems(w),
      null,
      { label: w.run || w.scripts?.length ? 'Edit scripts…' : 'Set a run script…', icon: 'pencil', key: 'e', run: edit },
      ...(p && !p.kind ? [{ label: 'Edit actions…', icon: 'pencil', run: () => setDialog({ settings: p.id, spot: 'Actions' }) } as MenuItem] : []),
    ]
  }
  // the file preview goes (closed, or another file shown): an unsaved edit only once you say so
  // a file in a tab of its own (one open already: in front, at the line asked for); its unsaved edit goes only once you say so
  const openFile = (f: Omit<Opened, 'n'>) => {
    const k = fileKey(f)
    setOpenFiles(l => (l.some(x => x.ws === f.ws && fileKey(x) === k) ? l.map(x => (x.ws === f.ws && fileKey(x) === k && f.line !== undefined ? { ...x, line: f.line, n: ++requests } : x)) : [...l, { ...f, n: ++requests }]))
    setShownFile(m => ({ ...m, [f.ws]: k }))
  }
  const closeFile = async (f: Opened) => {
    if (edited(f.edit) && !(await ask(`Discard your changes to ${f.path.split('/').pop()}?`, { text: "They aren't saved.", ok: 'Discard', danger: true }))) return
    const mine = openFiles.filter(x => x.ws === f.ws)
    const i = mine.findIndex(x => fileKey(x) === fileKey(f))
    const next = mine[i + 1] ?? mine[i - 1] // the one in front closed: the one beside it comes forward
    setOpenFiles(l => l.filter(x => !(x.ws === f.ws && fileKey(x) === fileKey(f))))
    if (next && fileKey(mine.find(x => fileKey(x) === shownFile[f.ws]) ?? mine.at(-1)!) === fileKey(f)) setShownFile(m => ({ ...m, [f.ws]: fileKey(next) }))
  }
  const closePreview = async () => void (previewed && (await closeFile(previewed)))
  // a terminal's ⌘-clicked file:// link: a file of the tab's workspace in the preview, anything else as Finder would
  // (main's open-path, which follows links: a workspace's file by its real path too); a host's only in the preview,
  // through the daemon; a browser has no Finder
  const openPath = async (tab: string, path: string) => {
    const w = view?.workspaces.find(x => x.id === byId(tab)?.workspace)
    if (!w) return
    const rel = path.startsWith(`${w.path}/`) ? path.slice(w.path.length + 1).replace(/\/+$/, '') : ''
    const how = w.host || !bridge?.openPath ? (rel ? { rel } : 'none') : await bridge.openPath(path, w.path)
    if (typeof how === 'object') panelApi(w).preview(how.rel)
    else if (how === 'missing') toast(`Not there: ${path}`)
  }
  // Changes' Revert while an agent works there: asked once (yes holds until no agent runs there); a whole file: asked
  // always, the agent in the same question
  const revertYes = useRef(new Set<string>())
  const revertOk = async (w: WorkspaceView, file?: string) => {
    const busy = view?.tabs.find(t => t.workspace === w.id && t.kind === 'agent' && t.status === 'running')
    if (!busy) revertYes.current.delete(w.id)
    const warn = busy && `${busy.preset ?? busy.name} is working here: it may write ${file ? 'it' : 'this file'} again.`
    if (file) return ask(`Revert ${file.split('/').pop()}?`, { text: [`Back to how it is on ${w.base ?? 'the base'}: every change in it goes. Undo is in the toast.`, warn].filter(Boolean).join(' '), ok: 'Revert', danger: true })
    if (!busy || revertYes.current.has(w.id)) return true
    const yes = await ask(`${warn} Revert anyway?`, { ok: 'Revert' })
    if (yes) revertYes.current.add(w.id)
    return yes
  }
  const redo = (w: WorkspaceView, id: string, then?: () => void) => call('hunkRedo', { ws: w.id, id }).then(() => (then?.(), done('Back as it was')), () => {})
  const panelApi = (w: WorkspaceView): PanelApi => ({
    files: () => api.call<FileList>('files', { ws: w.id }),
    newFile: (path, dir) => api.call<{ path: string }>('fileNew', { ws: w.id, path, dir }).then(r => r.path),
    openFile: file => void call('openIn', { ws: w.id, app: 'editor', file }).catch(() => {}),
    preview: (path, line) => openFile({ ws: w.id, path, line }),
    changes: () => api.call<Changes>('diff', { ws: w.id }),
    prChanges: () => api.call<Changes>('prDiff', { ws: w.id }),
    prFiles: () => api.call<PRFiles>('prFiles', { ws: w.id }),
    setViewed: (path, viewed, id) => api.call('prViewed', { ws: w.id, path, viewed, id }),
    read: (path, base) => api.call<FileContent>('fileRead', { ws: w.id, path, base }),
    threads: () => api.call<Thread[]>('prThreads', { ws: w.id }),
    // the file read again: its lines must still be what the review saw (applySuggestions), and fileWrite's was keeps an
    // agent's write meanwhile; Undo writes the text back the same way
    apply: async (path, edits, then) => {
      const was = (await call<FileContent>('fileRead', { ws: w.id, path })).text
      if (was === undefined) return toast(`${path} isn't text`)
      let text: string
      try {
        text = applySuggestions(was, edits)
      } catch (e) {
        return toast(`${path.split('/').pop()}: ${(e as Error).message}: nothing applied`)
      }
      await call('fileWrite', { ws: w.id, path, text, was })
      then?.()
      done(`Applied ${edits.length === 1 ? 'the suggestion' : `${edits.length} suggestions`} to ${path.split('/').pop()}`, () => void call('fileWrite', { ws: w.id, path, text: was, was: text }).then(() => (then?.(), done('Back as it was')), () => {}))
    },
    comment: c => api.call('prComment', { ws: w.id, ...c }).then(() => (earn('comment'), toast(`Commented on PR #${w.pr?.number}`))),
    toAgent: (text, line) => api.call('send', { target: w.id, text, whenIdle: true }).then(() => (line && earn('comment'), toast('Sent to the agent'))),
    saveImage: data => api.call<string>('imageSave', { data, ext: 'png' }),
    toPrompt: text => intoAgent(w.id, text),
    sim: p => api.call('sim', p),
    setup: () => setDialog({ section: 'simulator' }),
    float: bridge?.floatSim && (device => bridge!.floatSim!(device, w.id)),
    menu: (e, path, dir) => openMenu(e, fileMenu(w, path, dir)),
    undoHunk: async (path, hunk, lines, then) => {
      if (!(await revertOk(w))) return false
      const { id } = await call<{ id: string }>('hunkUndo', { ws: w.id, path, hunk, lines })
      then?.()
      done(`Reverted ${lines ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : '1 hunk'} in ${path.split('/').pop()}`, () => void redo(w, id, then))
      return true
    },
    undoFile: async (path, then) => {
      if (!(await revertOk(w, path))) return false
      const { id } = await call<{ id: string }>('fileUndo', { ws: w.id, path })
      then?.()
      done(`Reverted ${path.split('/').pop()}`, () => void redo(w, id, then))
      return true
    },
    redo: id => redo(w, id),
    artifacts: w.storage
      ? {
          files: () => api.call<{ path: string }[]>('artifactList', { ws: w.id }).then(l => ({ files: l.map(f => f.path), changed: {} })),
          preview: path => openFile({ ws: w.id, path, storage: true }),
          open: path => openArt(w, path),
          menu: (e, path) => openMenu(e, artMenu(w, path)),
        }
      : undefined,
  })
  // the full review's: the panel's, the workspace's agents (the focused one first), a send when its turn ends, and the
  // PR's review
  const reviewApi = (w: WorkspaceView): ReviewApi => ({
    ...panelApi(w),
    agents: (ts => [...ts.filter(t => t.id === tabByWs[w.id]), ...ts.filter(t => t.id !== tabByWs[w.id])])((view?.tabs ?? []).filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited')).map(t => ({ id: t.id, name: t.name })),
    send: (tab, text) => api.call('send', { target: tab, text, whenIdle: true }).then(() => done(`Sent the review to ${view?.tabs.find(t => t.id === tab)?.name ?? 'the agent'}`)),
    post: comments => api.call<{ url?: string; n: number }>('prReview', { ws: w.id, comments }).then(r => (r.url ? toast(`Posted ${r.n} comment${r.n === 1 ? '' : 's'} on PR #${w.pr?.number}`, () => openExternal(r.url!), 'Open', true) : done(`Posted ${r.n} comment${r.n === 1 ? '' : 's'} on PR #${w.pr?.number}`))),
  })
  // an artifact opened: HTML and Markdown in the app's viewer (Settings › General › Storage, unless In the browser), the
  // rest a document in its app, else shown in Finder
  const inViewer = (path: string) => settings.artifactsIn !== 'browser' && VIEWED.test(path)
  const artPage = (w: WorkspaceView, path: string) => (w.artKey && base !== null ? `${base}/artifact/${w.artKey}/${encodeURIComponent(w.id)}/${path.split('/').map(encodeURIComponent).join('/')}` : undefined) // its own key: one workspace's
  // in the browser: an HTML one as the daemon's sandboxed page (L11: never a file: page), anything else by main's open-path
  const inBrowser = (w: WorkspaceView, path: string) => (/\.html?$/i.test(path) && artPage(w, path) ? void bridge?.openExternal?.(artPage(w, path)!) : void bridge?.openPath?.(`${w.storage}/${path}`))
  const openArt = (w: WorkspaceView, path: string) => (inViewer(path) ? setArtView({ ws: w.id, path }) : inBrowser(w, path))
  // an artifact's right click (Files' Artifacts, the status bar's strip and its big view): open it, Finder, the clipboard
  const artMenu = (w: WorkspaceView, path: string): MenuItem[] => {
    const full = `${w.storage}/${path}`
    return [
      ...(inViewer(path) ? [{ label: 'Open', icon: 'file', run: () => openArt(w, path) } as MenuItem] : []),
      ...(bridge?.openPath ? [{ label: inViewer(path) ? 'Open in the browser' : 'Open', icon: inViewer(path) ? 'globe' : 'file', run: () => inBrowser(w, path) } as MenuItem, { label: 'Show in Finder', icon: 'folder', run: () => revealArt(w, path) } as MenuItem, null] : []),
      ...(bridge?.copyFile ? [{ label: 'Copy', icon: 'copy', key: 'c', sub: PICTURE.test(path) ? 'The picture' : 'The file: paste it in Finder, Slack or mail', run: () => void bridge!.copyFile!(full).then(k => (k === 'missing' ? toast(`${path} is gone`) : done(k === 'image' ? 'Picture copied' : 'File copied')), fail) } as MenuItem] : []),
      ...(PLAIN.test(path) ? [{ label: 'Copy text', icon: 'copy', key: 't', run: () => void api.call<FileContent>('fileRead', { ws: w.id, path, storage: true }).then(c => (c.text === undefined ? toast(`${path} isn't text`) : c.cut ? toast(`${path} is too big to copy as text: Copy puts the file itself there`) : copy(c.text)), fail) } as MenuItem] : []),
      { label: 'Copy path', icon: 'copy', key: 'p', run: () => copy(full) },
      ...extItems('file', w, { ws: w.id, file: path, storage: true }, path), // its file actions, on the artifact
    ]
  }
  // an artifact's folder in Finder ('': the storage folder): open-path would open a document in its app
  const revealArt = (w: WorkspaceView, path: string) => void bridge?.openPath?.(`${w.storage}/${path.replace(/\/?[^/]*$/, '')}`)
  // the Artifacts in the side panel's Files (the strip's ⋯ › Open in Files)
  const artifactsInFiles = () => (setArtsIn(ws?.id ?? null), showPanel('files'), setGallery(null))
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => done('Copied'), fail)
  // the agent skills installed with other text than this Laki's (Settings › Agent skill: an update of Laki changed
  // it, an edit, half a folder): a bar with Update, read as it connects and on the window's focus (a minute apart);
  // not one another Laki set up (foreign: Update there would point it here). Not now: until the app starts again
  const [oldSkills, setOldSkills] = useState<SkillInfo[]>([])
  const skillsAt = useRef(0)
  const skillsLater = useRef(false)
  const stale = (rows: SkillInfo[]) => setOldSkills(skillsLater.current ? [] : rows.filter(r => r.state === 'outdated' && !r.foreign))
  useEffect(() => {
    if (!connected) return
    const check = () => {
      if (skillsLater.current || Date.now() - skillsAt.current < 60_000) return
      skillsAt.current = Date.now()
      api.call<SkillInfo[]>('skills').then(stale, () => {})
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [connected])
  // one after another: each answer is the rows after its write (at once, the last could be read before another's);
  // the bar goes as it starts (a second click does nothing), and comes back with what's left
  const updateSkills = () => {
    const todo = oldSkills
    const names = [...new Set(todo.map(r => r.name))].join(', ')
    setOldSkills([])
    return todo
      .reduce((p, r) => p.then(() => api.call<SkillInfo[]>('skillSet', { agent: r.agent, on: true, skill: r.skill })), Promise.resolve<SkillInfo[]>([]))
      .then(rows => (stale(rows), done(`Updated Laki's skill in ${names}`)), e => (fail(e), api.call<SkillInfo[]>('skills').then(stale, () => {})))
  }
  // a tab's whole terminal as text, the scrollback too (an older daemon's: the bottom of its screen)
  const copyTab = (t: TabView) =>
    void api.call<string>('screen', { target: t.id, all: true }).then(text => {
      if (!text.trim()) return toast(`Nothing in ${t.name} to copy`)
      const n = text.split('\n').length
      return navigator.clipboard.writeText(text).then(() => done(`Copied ${t.name}: ${n} line${n === 1 ? '' : 's'}`), fail)
    }, fail)
  const tunnelApi = (w: WorkspaceView): TunnelApi => ({
    check: () => api.call<Cloudflared>('cloudflared', { ws: w.id }),
    start: (port, mails, hours) => api.call('tunnelStart', { ws: w.id, port, mails, hours }),
    stop: port => api.call('tunnelStop', { ws: w.id, port }),
    open: openExternal,
    copy,
  })
  const settings = view?.settings ?? {}
  const specsOn = specsOnIn(settings) // Settings › General › Pages: on unless turned off
  const flowsOn = flowsOnIn(settings) // the same
  // Achievements (achievements.ts): each earned once, as you do it, into settings.achievements (got: when). sent: the
  // last one written, shown and built on until the view has it, so an unlock, a ✕ and Turn off in a row keep each
  // other. Off: none earned, no trophy, no toast
  // ponytail: the whole object is written, so two windows earning in the same instant can lose one; a daemon method if it matters.
  // Only this window's calls count: the new-workspace and AI windows (NewWindow.tsx) earn nothing
  const sent = useRef<AchievementsKept | null>(null)
  if (sent.current && JSON.stringify(sent.current) === JSON.stringify(settings.achievements ?? {})) sent.current = null
  const achKept: AchievementsKept = sent.current ?? settings.achievements ?? {}
  const achRef = useRef(achKept)
  achRef.current = achKept
  const [unlocked, setUnlocked] = useState<string[]>([]) // the unlock toast's, newest last
  const unlockTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const unlockAt = useRef(0)
  const achSet = (o: AchievementsKept) => {
    const next = (sent.current = achRef.current = { ...achRef.current, ...o })
    return api.call('settingsSet', { achievements: next }).catch(e => {
      if (sent.current === next) sent.current = null // the view's again: a failed unlock can be earned again
      throw e
    })
  }
  const earn = (id: string) => {
    const a = achRef.current
    if (!viewRef.current || a.off || a.got?.[id] || a.hidden?.includes(id)) return // no view yet: its settings unknown, written over; hidden: doesn't unlock
    achSet({ got: { ...a.got, [id]: Date.now() } }).catch(() => {})
    const fresh = Date.now() - unlockAt.current > 1500 // one action's unlocks together, not the last toast's too
    unlockAt.current = Date.now()
    setUnlocked(u => (fresh ? [id] : [...u, id]))
    clearTimeout(unlockTimer.current)
    unlockTimer.current = setTimeout(() => setUnlocked([]), 6000)
  }
  const earnRef = useRef(earn)
  earnRef.current = earn
  useEffect(() => api.onCall((method, params, r) => earnedBy(method, params, r).forEach(id => earnRef.current(id))), [])
  // the view's numbers and values that moved since the last view (the first, and the first after a reconnect: where
  // they start, nothing earned; a new daemon's view, an update's migrations, isn't something you did)
  const ups = useRef<Record<string, number | string>>(undefined)
  useEffect(() => void (connected || (ups.current = undefined)), [connected])
  useEffect(() => {
    if (!view) return
    const now = upsOf(view)
    if (ups.current) wentUp(ups.current, now).forEach(earn)
    ups.current = now
  }, [view])
  useEffect(() => void (dialog && pageEarns(typeof dialog === 'string' ? dialog : settingsOf(dialog) ? 'settings' : Object.keys(dialog)[0]).forEach(earn)), [dialog])
  useEffect(() => void (find && earn('filter')), [!!find])
  // Changes or the Simulator on screen, once it wasn't: not the panel as it was left when Laki started
  const onTab = panelShown && ws ? panelTab : ''
  const tabWas = useRef<string>(undefined)
  useEffect(() => {
    if (!view) return
    const id = ({ changes: 'changes', device: 'simTab' } as Record<string, string>)[onTab]
    if (id && tabWas.current !== undefined && tabWas.current !== onTab) earn(id)
    tabWas.current = onTab
  }, [onTab, !view])
  useEffect(() => void bridge?.onEarn?.(id => earnRef.current(id)), []) // main's: the global hotkey, a bubble's click
  // the extension studio's chats (studioChats, Laki AI on): where you left off, in Settings › Extensions and a new
  // studio, again a moment after an ai event
  const [studioChats, setStudioChats] = useState<StudioChat[]>([])
  const studioOn = aiOn(settings)
  useEffect(() => {
    if (!studioOn || !connected) return
    let t: ReturnType<typeof setTimeout> | undefined
    const chats = () => void api.call<StudioChat[]>('studioChats').then(setStudioChats, () => {})
    chats()
    const off = api.on(m => {
      if (m.ev === 'ai') t ??= setTimeout(() => ((t = undefined), chats()), 1500)
    })
    return () => (off(), clearTimeout(t))
  }, [studioOn, connected])
  const pickKey = settings.pickerKey ?? PICKER_KEY // the element picker's hotkey ('' none)
  const kb = keyMap(settings.keys) // Settings › Keys': the keys of App's own actions in use ('' none)
  const kh = (id: KeyId) => keyShow(kb[id]) || undefined // as a menu's hint
  const kt = (title: string, id: KeyId) => (kb[id] ? `${title} (${keyShow(kb[id])})` : title) // a tooltip with its keys
  const hotkey = !view ? null : settings.hotkeyOn !== false ? settings.hotkey ?? HOTKEY : '' // the global hotkey (main's globalShortcut; '' none; null: no settings yet)
  useEffect(() => void (hotkey !== null && bridge?.hotkey?.(hotkey)), [hotkey])
  const shotKey = !view ? null : settings.shotAsk === true && aiOn(settings) ? settings.shotKey ?? SHOT_KEY : false // Screenshot to Laki AI's (false: off)
  useEffect(() => void (shotKey !== null && bridge?.shotKey?.(shotKey)), [shotKey])
  const updateAuto = !view ? null : settings.updateCheck !== false // Settings' Check for updates (null: no settings yet)
  useEffect(() => void (updateAuto !== null && bridge?.updateAuto?.(updateAuto)), [updateAuto])
  // a version a scheduled check found, once each (main's update.json): its notes and Download are in Settings
  useEffect(() => bridge?.onUpdate?.(s => void (s.found && s.latest && toast(`Laki ${s.latest.version} is out`, () => setDialog({ section: 'general', spot: 'Updates' }), "See what's new"))), [])
  // a rail of kinds (Slack's) beside a list of the one picked; a phone keeps the one drawer
  const rail = !narrow
  const railWords = settings.railLabels !== false // its own setting: words under its icons, or icons only (narrower)
  const railW = railWords ? 68 : 52
  const sideKind: RailKind = rail ? railKind : 'projects' // a phone's drawer, or no rail: one width
  const sideW = sideWs[sideKind] ?? SIDE
  const setSideW = (w: number) => setSideWs(m => ({ ...m, [sideKind]: w }))
  // a kind whose rail button is off (Settings › Appearance › Rail): its projects go in Projects' list
  const railOf = (k?: RailKind): RailKind => ((k === 'shells' && settings.railShells === false) || (k === 'browsers' && settings.railBrowsers === false) ? 'projects' : (k ?? 'projects'))
  const rawKind = (w: WorkspaceView): RailKind => view?.projects.find(p => p.id === w.project)?.kind ?? 'projects'
  const kindOf = (w: WorkspaceView): RailKind => railOf(rawKind(w))
  const isTerm = (w: WorkspaceView) => !!w.term || rawKind(w) === 'shells' // a terminal: closed, not deleted
  useEffect(() => void (railOf(railKind) !== railKind && setRailKind('projects')), [railKind, settings.railShells, settings.railBrowsers])
  // the full review (settings.fullReview, FullReview.tsx): the tab bar's first tab while a git workspace has changes
  // (its stat); shown or not per workspace (a session's tab picked leaves it), and the stat it last showed: its dot,
  // files changed since
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({})
  const [reviewSeen, setReviewSeen] = useState<Record<string, string>>({})
  const statKey = ws?.stat ? JSON.stringify(ws.stat) : ''
  const reviewTab = !!ws && settings.fullReview === true && git && !!ws.stat?.files && ws.browser === undefined && !isTerm(ws) && !ws.archived
  const reviewOn = reviewTab && !!reviewing[ws!.id]
  const reviewDot = reviewTab && !reviewOn && reviewSeen[ws!.id] !== undefined && reviewSeen[ws!.id] !== statKey
  const openReview = () => ws && setReviewing(m => ({ ...m, [ws.id]: true }))
  useEffect(() => void (reviewOn && ws && setReviewSeen(m => (m[ws.id] === statKey ? m : { ...m, [ws.id]: statKey }))), [reviewOn, ws?.id, statKey])
  const lastIn = useRef<Partial<Record<RailKind, string>>>({}) // each kind's last workspace: its rail button goes back there
  useEffect(() => {
    if (!ws || !project) return
    const k = railOf(project.kind)
    lastIn.current[k] = ws.id
    setRailKind(k) // picked anywhere (⌘J, the palette, a link, a new one): its kind's list shows it
  }, [ws?.id, project?.id])
  const railTo = (k: RailKind) => {
    setRailKind(k)
    setDialog(null) // a page over the main area gives way, as a row's click does
    const to = live.find(w => w.id === lastIn.current[k]) ?? order.find(w => kindOf(w) === k)
    if (to) setWsId(to.id)
  }
  useEffect(() => void requestAnimationFrame(fit), [theme, settings.uiFont, settings.sideLook?.labels, settings.fun, sideOpen, !!view, rail]) // a new font, a button more or less (the rail takes two): measured again
  const tracked = Object.keys(USAGE_AGENTS).filter(a => settings.usage?.[a] !== false) // the status bar's plan limits
  // a plan limit past settings.usageAt as Usage.tsx reads them: a toast, and a notification unless you're looking (or
  // notify is off); once per window per reset (laki.limitsTold), told or not as it crosses (seen: each window's last %)
  // ponytail: only while the app is open with the ring on screen; the daemon doesn't watch usage on its own
  const limitsSeen = useRef<Record<string, number>>({})
  const limits = (rows: AgentUsage[]) => {
    const s = viewRef.current?.settings
    const told = load<Record<string, number>>('laki.limitsTold', {})
    const { hits, seen } = limitsCrossed(rows, s?.usageAt ?? USAGE_AT, limitsSeen.current, told)
    limitsSeen.current = seen
    if (!hits.length || s?.notifyOn?.usage === false) return rows
    hits.forEach(h => (told[h.id] = h.w.resets ?? 0))
    store('laki.limitsTold', told)
    const says = hits.map(h => limitText(h, rows))
    if (s?.notify !== false && !document.hasFocus()) says.forEach(t => notify('Plan limit', t, '', () => {}, s?.notifySound))
    toast(says.join('; '))
    return rows
  }
  const editor = settings.editor || 'cursor'
  const targets: AppInfo[] = [...apps.filter(a => !a.browser), ...(settings.editorCmd?.trim() ? [{ id: 'custom', name: 'Custom command' }] : [])]
  const editorName = targets.find(a => a.id === editor && a.id !== 'custom')?.name ?? 'editor'
  const openIn = (app: string, where: Where = { ws: ws?.id }) => {
    call('openIn', { ...where, app }).catch(() => {})
    // an editor picked from the list is ⌘E's from now on (for a folder: a file's pick is just for it)
    if (EDITOR_IDS.includes(app) && app !== editor && !where.file) call('settingsSet', { editor: app }).catch(() => {})
  }
  // Open in: every app, ⌘E's first
  const openInItems = (where: Where = { ws: ws?.id }): MenuItem[] =>
    [...targets]
      .sort((a, b) => Number(b.id === editor) - Number(a.id === editor))
      .map(a => ({ label: a.name, icon: appIcon(a.id), hint: a.id === editor && !where.file ? '⌘E' : undefined, run: () => openIn(a.id, where) }))
  // right click in Files: a file in its default app, a browser (for what they show), or any app (Finder reveals it,
  // a terminal opens its folder)
  const fileMenu = (w: WorkspaceView, file: string, dir: boolean): MenuItem[] => [
    { head: 'Open in' },
    ...(dir ? [] : [{ label: 'Default app', icon: 'file', key: 'o', run: () => openIn('default', { ws: w.id, file }) } as MenuItem]),
    ...(!dir && WEB.test(file) ? apps.filter(a => a.browser).map(a => ({ label: a.name, icon: 'globe', run: () => openIn(a.id, { ws: w.id, file }) }) as MenuItem) : []),
    ...openInItems({ ws: w.id, file }),
    null,
    { label: 'Copy path', icon: 'copy', key: 'c', run: () => copy(`${w.path}/${file}`) },
    ...(dir ? [] : extItems('file', w, { ws: w.id, file }, file)),
  ]
  // typed into an agent's prompt, unsent: the focused one if it's this workspace's, else its first live one; then its
  // pane gets the keys
  const intoAgent = (wsId: string, text: string) => {
    const live = view?.tabs.filter(t => t.workspace === wsId && t.kind === 'agent' && t.status !== 'exited') ?? []
    const to = live.find(t => t.id === tab?.id) ?? live[0]
    if (!to) return Promise.reject(new Error('No agent runs here: start one (＋ in the tab bar)'))
    return api.call('send', { target: to.id, text, enter: false }).then(() => (selectTab(to.id), xterms.get(to.id)?.focus(), toast(`In ${to.name}'s prompt: say what to do with it`)))
  }
  // extensions' actions offered where you work (widget.json's show and key: WidgetMenu), of the ones on: a place's, a
  // workspace's (not a terminal's, a browser's or a host's: no extensions there), a file's by match
  const extWs = (x?: WorkspaceView | null) => (x && !x.archived && !x.host && !view?.projects.find(p => p.id === x.project)?.kind ? x : undefined)
  const extOn = (x?: WorkspaceView | null) => (view?.widgets ?? []).filter(w => w.on && (w.scope !== 'workspace' || extWs(x)) && (!w.project || w.project === x?.project)) // a repo's: its project's only
  const extMenus = (show: string, x?: WorkspaceView | null, file?: string) => extOn(x).flatMap(w => (w.menus ?? []).filter(m => m.show.includes(show) && (!file || !m.match?.length || m.match.some(g => globMatch(g, file)))).map(m => ({ w, m })))
  const keyText = (k: string) => k.replace('Ctrl+', '⌃').replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Cmd+', '⌘')
  const hereCtx = (): WidgetCtx => (x => ({ ws: x?.id, tab: x && tab?.workspace === x.id ? tab.id : undefined }))(extWs(ws))
  // a run: its confirm and ask first, then widgetAction with where it was picked (ctx); insert and files (#26): into the
  // box it was picked in (into), else the workspace's agent's prompt (files as paths), else the clipboard; open: the link
  // after (laki://: the router); view: its full view after
  const extRun = async (w: WidgetView, m: WidgetMenu, ctx: WidgetCtx, into?: (t: Inserted) => void) => {
    if (m.confirm && !(await ask(m.confirm, { text: `${w.name} · ${m.title}`, ok: m.title }))) return
    const arg = m.ask ? await askText(m.ask, { text: `${w.name} · ${m.title}`, ok: m.title }) : ''
    if (arg === null) return
    clearTimeout(noteTimer.current)
    setNote({ text: `${m.title}…`, busy: true })
    type R = { ok: boolean; out?: string; error?: string; insert?: string; open?: string; files?: ActionFile[] } & WidgetSay
    const r = await api.call<R>('widgetAction', { id: w.id, action: m.action, arg, ws: w.scope === 'workspace' ? ctx.ws : undefined, ctx }).catch((e): R => ({ ok: false, error: String(e?.message ?? e) }))
    if (!r.ok) return toast(`${m.title} failed: ${r.error}`)
    setNote(null)
    const put = r.insert !== undefined || !!r.files?.length
    const text = withPaths(r.insert ?? '', (r.files ?? []).map(f => f.path))
    if (put) into ? into({ text: r.insert ?? '', files: r.files }) : ctx.ws ? await intoAgent(ctx.ws, text).catch(e => toast(String(e.message))) : copy(text)
    if (r.open) widgetApi.open(r.open)
    if (r.toast || r.modal) widgetApi.say(w.id, r, ctx.ws)
    else if (!put && !r.open && !m.view) done(r.out || `${m.title}: done`)
    // a file opener's: its full view as a tab beside the file's in the preview, else a dialog
    if (m.view) ctx.file && ctx.ws && w.full ? openFile({ ws: ctx.ws, path: ctx.file, ext: w.id, ...(ctx.storage && { storage: true }) }) : setDialog(w.full ? { widget: w.id, back: dialog } : { extension: w.id, back: dialog })
  }
  const extItems = (show: string, x: WorkspaceView | undefined | null, ctx: WidgetCtx, file?: string): MenuItem[] => (l => (!extWs(x) ? [] : l.length ? [null, { head: 'Extensions' }, ...l.map(({ w, m }): MenuItem => ({ label: m.title, sub: w.name, icon: 'panel', hint: m.key && keyText(m.key), run: () => void extRun(w, m, ctx) }))] : []))(extMenus(show, x, file)) // none in a terminal's, a browser's, a host's or an archived one: ctxOf refuses those
  // a box's Insert menu (the new-workspace page's, Laki AI's, Send later's): an action's text at its cursor, its files
  // with it. ctx: the workspace and tab it types for (a per-workspace one's there, a repo's of its project); project: the
  // new-workspace page's pick, before there's a workspace
  const extInserts = (ctx: WidgetCtx = {}, project?: string): Inserts => {
    const x = extWs(view?.workspaces.find(w => w.id === ctx.ws))
    const at: WidgetCtx = x ? { ws: x.id, tab: ctx.tab } : {}
    return insertMenus(view?.widgets, x?.id, x?.project ?? project).map(({ w, m }) => ({ label: m.title, sub: w.name, run: () => new Promise<Inserted | undefined>(res => void extRun(w, m, at, res).then(() => res(undefined))) }))
  }
  const openPort = (port: number) => openExternal(`http://localhost:${port}`)
  // widgets: the sidebar's grid and a widget's dialog (Widgets.tsx)
  const widgetApi: WidgetApi = {
    render: (id, full, sample, cells, ws) => api.call<string | null>('widgetRender', { id, full, ...(sample && { sample }), ...(cells && { cells }), ws }),
    run: (id, ws) => call('widgetRun', { id, ws }),
    open: url => (/^laki:\/\//i.test(url) ? setLink(url) : openExternal(url)),
    copy: text => void copy(text),
    full: (id, at) => (at && setWsId(at), setDialog({ widget: id, back: dialog })), // at: a row mark's workspace, selected first: its instance shows
    close: () => setDialog(d => (d && typeof d === 'object' && 'widget' in d ? (d.back ?? null) : d)), // the full view's (Esc in its frame), not a page's

    action: (id, action, arg, label, ws) => {
      const what = label || action
      clearTimeout(noteTimer.current)
      setNote({ text: `${what}…`, busy: true }) // something is happening, until it says what
      return api.call<{ ok: boolean; out?: string; error?: string; open?: string } & WidgetSay>('widgetAction', { id, action, arg, ws }).then(
        r => (!r.ok ? (toast(`${what} failed: ${r.error}`), false as const) : (r.open && widgetApi.open(r.open), r.toast || r.modal || r.close ? (setNote(null), widgetApi.say(id, r, ws)) : r.open ? setNote(null) : done(r.out || `${what}: done`))), // #26: its link opened after it
        e => (toast(`${what} failed: ${(e as Error).message}`), false as const), // false: the kit's slider, pick or box goes back
      )
    },
    // a toast; a close (true: its dialog, else the one with that id) before a dialog: one with the shown one's id is
    // drawn in its place, any other replaces it
    say: (id, s, ws) => {
      if (s.toast) done(s.toast)
      if (s.close || s.modal)
        setExtModal(x => {
          const cur = x && x.wid === id && (s.close === true || (s.close && x.m.id === s.close)) ? null : x
          if (!s.modal) return cur
          return { wid: id, ws, m: s.modal, n: cur?.wid === id && s.modal.id && cur.m.id === s.modal.id ? cur.n : ++extN.current }
        })
    },
    do: (w, c, label) => widgetDo(w, c, label),
    settings: (id, key) => setDialog(id ? { extension: id, back: dialog, ...(key && { edit: key }) } : { section: 'widgets' }),
    menu: (w, e) => openMenu(e, [{ head: w.name }, ...widgetApi.items!(w)]),
    items: w => [
      ...(w.every !== undefined && w.on && w.here !== null ? [{ label: 'Fetch now', icon: 'refresh' as const, run: () => void call('widgetRun', { id: w.id, ws: w.here }) }] : []),
      { label: 'Inspect', icon: 'search' as const, sub: 'its data, runs, env and files', run: () => setDialog({ extension: w.id, back: dialog, tab: 'data' }) },
      { label: 'Logs', icon: 'file' as const, sub: w.log ? 'what it did, its runs and stderr' : 'off: Keep a log turns it on', run: () => setDialog({ extension: w.id, back: dialog, tab: 'logs' }) },
      { label: 'Edit', icon: 'settings' as const, sub: 'its place, settings and Laki AI', run: () => setDialog({ extension: w.id, back: dialog }) },
      null,
      ...extMenuItems(w, extCfg),
    ],
    log: (id, text, ws) => void api.call('widgetLog', { id, text, ws, src: 'page' }).catch(() => {}),
  }
  widgetSay.current = widgetApi.say
  // a widget button's Laki command (the UI kit's do, a JS page's laki.do): said and asked first (a page in a browser
  // tab only opens, like a link), then done. Its workspace: a per-workspace one's, else the selected one
  const widgetDo = async (w: WidgetView, c: UiDo, label?: string) => {
    if (!w.on) return toast(`${w.name} is off: turn it on first`) // as its actions: an off one does nothing
    const by = `${w.name}${label ? ` › ${label}` : ''} asks`
    const shown = (t: string) => `“${t}”` // all of it: the dialog scrolls, and a cut could hide what runs
    const unseen = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/ // control and direction characters: ⌃U would hide a line's start
    const bad = [c.prompt, c.command].find(t => typeof t === 'string' && (t.length > 4000 || unseen.test(t)))
    if (bad !== undefined) return toast(`${w.name}: its ${c.command === bad ? 'command' : 'prompt'} is too long or has characters the dialog can't show`)
    const here = w.here ? view?.workspaces.find(x => x.id === w.here) : ws
    const prompt = String(c.prompt ?? '').trim()
    if (c.do === 'browse') {
      const url = String(c.url ?? '').trim()
      return /^https?:\/\/\S+$/i.test(url) ? quickNew('browsers', url) : toast(`${w.name}: no http(s) page to open`)
    }
    if (c.do === 'terminal') {
      const cmd = String(c.command ?? '').trim()
      if (!cmd || /[\r\n]/.test(cmd)) return toast(`${w.name}: no command (one line) to run`)
      if (!(await ask('Run this in a new terminal?', { text: `${by}: ${shown(cmd)}`, ok: 'Run', danger: true }))) return
      const t = await call<WorkspaceView>('quickNew', { kind: 'shells' }).catch(() => null)
      if (!t) return
      showNew(t.id)
      setDialog(null)
      // ponytail: laki_shell's 1.5 s for the shell's prompt to come up
      return void setTimeout(() => void call('send', { target: `${t.id}/1`, text: cmd }).catch(() => {}), 1500)
    }
    if (!prompt) return toast(`${w.name}: no prompt to send`)
    if (c.do === 'ai') {
      if (!aiOn(settings)) return toast('Laki AI is off: Settings › AI')
      if (!(await ask('Ask Laki AI this?', { text: `${by}: ${shown(prompt)}`, ok: 'Ask' }))) return
      if (settings.ai?.float === false) setDialog('ai')
      else setAiFloat(true)
      void api.call('aiAsk', { text: prompt }).catch(fail)
      return true
    }
    if (c.do === 'send') {
      if (!here || view?.projects.find(x => x.id === here.project)?.kind) return toast(`${w.name}: select a workspace with an agent to send it to`)
      if (!(await ask(`Send this to ${here.name}’s agent?`, { text: `${by}: ${shown(prompt)}`, ok: 'Send' }))) return
      const r = await call<{ queued?: number }>('send', { target: here.id, text: prompt, whenIdle: true, agent: true }).catch(() => null)
      if (r) done(r.queued ? `Queued for ${here.name}’s agent` : `Sent to ${here.name}’s agent`)
      return !!r
    }
    if (c.do === 'new') {
      const want = String(c.project ?? '').trim().toLowerCase()
      const p = want ? view?.projects.find(x => x.id.toLowerCase() === want || x.name.toLowerCase() === want) : view?.projects.find(x => x.id === here?.project)
      if (!p || p.kind) return toast(want ? `${w.name}: no project ${c.project}` : `${w.name}: select a workspace of the project to start it in`)
      const agent = String(c.agent ?? '').trim()
      // #30: its model, effort, mode and fast mode (wsNew checks them); never an agent that doesn't ask, by the mode it
      // asks for or its profile's own
      const pr = view?.presets.find(x => x.name === (agent || settings.agent)) ?? (agent ? undefined : view?.presets.find(x => x.agent !== 'command')) // an agent named but no profile of it: that agent itself, never another's mode
      const kind = pr?.agent ?? (agent || 'claude')
      const [model, effort, perm] = [c.model, c.effort, c.perm].map(x => String(x ?? '').trim() || undefined)
      if (neverAsks(kind, perm ?? pr?.perm, pr?.args)) return toast(`${w.name}: an extension never starts an agent that doesn't ask first${perm ? ` (${perm})` : ` (${pr?.name}'s mode)`}`)
      const how = [model, effort && `${effort} effort`, perm && (PERMS[kind as Agent]?.find(x => x[0] === perm)?.[1] ?? perm), c.fast && 'fast mode'].filter(Boolean).join(', ')
      if (!(await ask(`Start a new workspace in ${p.name}?`, { text: `${by}${agent ? `, with ${agent}` : ''}${how ? ` (${how})` : ''}: ${shown(prompt)}`, ok: 'Start' }))) return
      const made = await call<WorkspaceView>('wsNew', { project: p.id, prompt, place: 'top', ...(agent && { preset: agent }), ...(model && { model }), ...(effort && { effort }), ...(perm && { perm }), ...(c.fast && { fast: true }), ...(p.git === false && { local: true, another: true, name: nameOf(prompt) }) }).catch(() => null)
      if (made) (showNew(made.id), setDialog(null))
      return !!made
    }
  }
  // an extension's tool an agent calls (widgetToolCall): what would run, asked here and as a notification; the first
  // answer counts (widgetToolAnswer), Esc denies. Always: in this workspace from now on, for a tool that asks first
  toolAsk.current = m => {
    if (toolLine.has(m.req)) return // sent again as the socket came back (widgetAsks)
    type Pick = { label: string; allow: 'once' | 'always' | 'deny' }
    const answer = (allow: string) => void api.call('widgetToolAnswer', { req: m.req, allow }).catch(() => {})
    if (typeof m.perm === 'string') {
      // an extension's agent (its AI source or an AI action, claude -p) asking for a tool it may not use unasked: its
      // input as lines, Always: in its runs from now on (its page lists them)
      const tool = m.perm.replace(/^mcp__(.+?)__(.+)$/, '$2 ($1)')
      const lines = Object.entries((m.input ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}: ${(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 300)}`)
      const title = `${m.name} wants to use ${tool}`
      const picks: Pick[] = [{ label: 'Allow once', allow: 'once' }, { label: `Always for ${m.name}`, allow: 'always' }, { label: 'Deny', allow: 'deny' }]
      notify(title, lines.join(' · ').slice(0, 200) || m.perm, '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })))
      toolLine.add({ req: m.req, title, text: `${lines.length ? `${lines.join('\n')}\n\n` : ''}Its agent asks while it works in the background. Always: it uses ${m.perm} unasked from now on (Revoke on its page). Deny: it goes on without it.`, picks, answer })
      return toolShow()
    }
    if (m.cross) {
      // an agent's send or screen into another workspace's tab (main.ts' crossAsk): what it sends, or that it reads; an
      // event for another workspace (emit): its workflows and extensions run there
      const send = m.cross === 'send'
      const emit = m.cross === 'emit'
      const title = emit ? `${m.agent} in ${m.from} wants to send ${m.target} to ${m.to}` : `${m.agent} in ${m.from} wants to ${send ? 'send to' : 'read'} ${m.target} in ${m.to}`
      const picks: Pick[] = [{ label: 'Allow once', allow: 'once' }, { label: `Always from ${m.from} to ${m.to}`, allow: 'always' }, { label: 'Deny', allow: 'deny' }]
      notify(title, send || emit ? String(m.text ?? '').slice(0, 200) : 'what its terminal shows now', m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })))
      toolLine.add({ req: m.req, title, text: `${emit ? `An event: the workflows and extensions listening in ${m.to} would run there, with this:\n\n${m.text}` : send ? `It would send this to ${m.target}:\n\n${m.text}` : `It would read what ${m.target}'s terminal shows now, which may hold what you'd keep in ${m.to}.`}\n\nAlways: until Laki restarts.`, picks, answer })
      return toolShow()
    }
    const where = m.ws ? (view?.workspaces.find(w => w.id === m.ws)?.name ?? m.ws) : ''
    const title = `${m.agent || 'An agent'} wants to run ${m.name}: ${m.action}`
    const input = m.input && Object.keys(m.input).length ? `\n\nInput: ${JSON.stringify(m.input)}` : ''
    const picks: Pick[] = [{ label: 'Allow once', allow: 'once' }, ...(m.ask === 'first' ? [{ label: where ? `Always in ${where}` : 'Always', allow: 'always' } as Pick] : []), { label: 'Deny', allow: 'deny' }]
    // its click: the window, this ask on screen (the one there back in line)
    notify(title, `${m.description}${where ? ` · ${where}` : ''}`, m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })))
    toolLine.add({ req: m.req, title, text: `${m.description}\n\n$ ${m.command}${input}${where ? `\n\nIn ${where}` : ''}`, picks, answer })
    toolShow()
  }
  // a repo's extension (or one in a folder an agent linked) turned on: what it runs, the settings it needs, what it can
  // hold; the files hash shown, or none
  // a repo's .laki.json not trusted as it is (cfgWait): its text, then Trust; meanwhile its setup, scripts and env wait
  const cfgSheet = async (p: Project) => {
    const c = await call<{ hash: string; text: string; trusted: boolean }>('projectTrust', { id: p.id }).catch(() => null)
    if (!c || c.trusted) return
    const text = `Its setup, teardown, run and other scripts run on this Mac, with its env. Until you trust it, none of them runs (its port names still show), and workspaces made meanwhile get their setup as you trust it.\n\n${c.text}`
    if ((await choose(`Trust ${p.name}'s .laki.json?`, text, [{ label: 'Not now' }, { label: "Trust this repo's .laki.json", primary: true }])) !== 1) return
    if (await call('projectTrust', { id: p.id, hash: c.hash }).then(() => true, () => false)) done(`Trusted ${p.name}'s .laki.json`)
  }
  const repoSheet = async (w: WidgetView) => {
    const what = await call<{ name: string; text: string; hash: string }>('widgetWhat', { id: w.id }).catch(e => (toast(String(e?.message ?? e)), null))
    if (!what) return
    const proj = view?.projects.find(p => p.id === w.project)?.name ?? w.project
    const needs = w.options.filter(x => x.required || x.type === 'secret').map(x => `${x.label || x.key}${x.type === 'secret' ? ' (a secret, kept on this Mac)' : ''}${x.required ? ', needed' : ''}`)
    const from = w.project ? `It comes with ${proj}'s repo (.laki/extensions)` : "An agent linked its folder (laki widget dev): its code is the agent's"
    const text = [`${from}${w.changed ? ', and its files changed there since you turned it on' : ''}.`, what.text.replace(/^`{3,}$/gm, '').replace(/\n{3,}/g, '\n\n'), needs.length ? `Its settings: ${needs.join('; ')}.` : '', w.project ? 'It shows and runs only in its workspaces.' : 'It turns off again as its files change.'].filter(Boolean).join('\n\n')
    return (await choose(`Turn on ${what.name}?`, text, [{ label: 'Cancel' }, { label: w.project ? `Turn on in ${proj}` : 'Turn on', primary: true }])) === 1 ? what.hash : undefined
  }
  // Settings › Extensions' and the Extension page's: each one's settings, page, folder, logs
  const extCfg: WidgetsApi = {
    list: view?.widgets ?? [],
    home: view?.widgetHome,
    // turned on with a setting it needs still empty: its page, at that field; a repo's (.laki/extensions) shows what
    // it runs first (repoSheet), on only for the files shown
    set: async (id, o) => {
      const rw = view?.widgets?.find(x => x.id === id)
      if (o.on && !o.seen && (rw?.project || rw?.agentDev)) {
        const seen = await repoSheet(rw)
        if (!seen) return
        o = { ...o, seen }
      }
      const r = await call<WidgetView>('widgetSet', { id, ...o })
      if (o.on && r?.missing?.length) setDialog({ extension: id, back: extOf(dialog)?.extension === id ? extOf(dialog)!.back : dialog, edit: r.missing[0] })
      return r
    },
    desk: settings.desk !== false,
    agents: (view?.presets ?? []).filter(p => !p.off && (p.agent === 'claude' || p.agent === 'codex')).map(p => ({ name: p.name, agent: p.agent })),
    agent: settings.widgetAgent,
    run: (id, ws) => call('widgetRun', { id, ws }),
    stop: id => call('resourceStop', { key: `agent:${id}` }),
    // asked first, then the trash: Undo puts it back
    rm: async id => {
      const name = view?.widgets?.find(w => w.id === id)?.name ?? id
      if (!(await ask(`Delete ${name}?`, { text: 'Its folder, settings and data go to the trash, and it stops running. Undo brings it back.', ok: 'Delete', danger: true }))) return
      const r = await call<{ trash: string }>('widgetRm', { id })
      if (r) done(`Deleted ${name}`, () => void call('widgetRestore', { trash: r.trash }))
    },
    // the studio's sessions: the ones with nothing made yet, and the one at work
    chats: studioChats.filter(c => c.busy || !view?.widgets?.some(w => w.id === c.id)),
    chatRm: async id => {
      if (!(await ask('Delete this session?', { text: 'Its chat with Laki AI goes; nothing was saved of the extension yet.', ok: 'Delete', danger: true }))) return
      await call('studioChatRm', { id })
      setStudioChats(cs => cs.filter(c => c.id !== id))
    },
    reload: () => call('widgetReload'),
    page: id => setDialog(!id && aiOn(settings) ? { studio: '', back: dialog } : { extension: id, back: dialog }), // a new one: the studio while Laki AI is on
    ...(aiOn(settings) && { studio: (id: string) => setDialog({ studio: id, back: dialog }) }),
    // a copy to change: in the studio while Laki AI is on, else its page (Files)
    remix: (id: string) => api.call<{ id: string }>('widgetRemix', { id }).then(r => setDialog(aiOn(settings) ? { studio: r.id, back: dialog } : { extension: r.id, back: dialog }), e => toast(String(e?.message ?? e))),
    undo: (id, after) => api.call('widgetUndo', { id, after }),
    tryOnce: (id, ws) => api.call<{ ok: boolean; error?: string }>('widgetRun', { id, once: true, ws }),
    folder: (id, e) => {
      const w = view?.widgets?.find(x => x.id === id)
      openMenu(e, [{ head: 'Open in' }, ...openInItems({ widget: id }), null, { label: 'Copy path', icon: 'copy', key: 'c', run: () => w && copy(w.dir) }])
    },
    allLogs: settings.widgetLogs === true,
    logs: id => setDialog({ extension: id, back: extOf(dialog)?.extension === id ? extOf(dialog)!.back : dialog, tab: 'logs' }),
    log: {
      read: (id, o) => api.call<{ on: boolean; lines: WidgetLogLine[]; next: number }>('widgetLogs', { id, ...o }),
      clear: id => api.call('widgetLogClear', { id }),
      reveal: id => void call('openIn', { widget: id, log: true, app: 'finder' }),
    },
    kit: icons => setDialog({ uikit: true, icons, back: dialog }),
    runs: (id, ws) => api.call<WidgetRuns>('widgetRuns', { id, data: true, ws }),
    mock: (id, o) => call('widgetMock', { id, ...o }),
    files: id => api.call<{ files: Record<string, string> }>('widgetFiles', { id }).then(r => r.files),
    save: (id, path, text, was, force) => api.call('widgetFileSave', { id, path, text, was, force }),
    make: kind => api.call<{ id: string }>('widgetNew', { kind, name: kind === 'pullmain' ? 'Pull main' : `My ${kind === 'onefile' ? 'script' : kind}` }).then(r => setDialog({ extension: r.id, back: dialog === 'starters' ? null : dialog }), e => toast(String(e?.message ?? e))), // ⌘K's picker: its page, then nothing behind it
    check: (id, run, ws) => api.call<{ problems: UiProblem[] }>('widgetCheck', { id, run, ws }),
    revoke: (id, action, ws) => api.call('widgetGrantRm', { id, action, ws }),
    wsName: ws => (ws ? (view?.workspaces.find(w => w.id === ws)?.name ?? ws) : 'no workspace'),
  }
  const fontSize = settings.fontSize ?? FONT_SIZE // Settings' size: every tab's, less its own zoom
  // ⌘± zoom the tab with the keyboard (laki.zoom: each tab's points over Settings' size; ⌘0 back to it), Settings and
  // Help their own size
  const [zooms, setZooms] = useState<Record<string, number>>(() => (z => (z && typeof z === 'object' && !Array.isArray(z) ? z : {}))(load<unknown>('laki.zoom', {})) as Record<string, number>)
  useEffect(() => void localStorage.setItem('laki.zoom', JSON.stringify(zooms)), [zooms])
  const sizeOf = (id: string) => Math.min(32, Math.max(8, fontSize + (Number(zooms[id]) || 0)))
  const zoom = (d: number) => {
    if (pageOpen) return zoomPage(d)
    if (!tab || dialog) return // a page or dialog over the terminals: not the tab you'd see grow
    const size = d ? Math.min(32, Math.max(8, sizeOf(tab.id) + d)) : fontSize
    if (size === sizeOf(tab.id)) return // as big or as small as it goes, or at Settings' size already
    const { [tab.id]: _, ...rest } = zooms
    setZooms(size === fontSize ? rest : { ...rest, [tab.id]: size - fontSize })
    toast(size === fontSize ? `${tab.name}: Settings' size, ${fontSize}` : `${tab.name}: text ${size} (⌘0: back to ${fontSize})`, undefined, undefined, true)
  }
  const tabIds = view?.tabs.map(t => t.id).join() // closed tabs' zooms go
  useEffect(() => void (view && setZooms(z => (Object.keys(z).every(id => view.tabs.some(t => t.id === id)) ? z : Object.fromEntries(Object.entries(z).filter(([id]) => view.tabs.some(t => t.id === id)))))), [tabIds])
  // Settings and Help: ⌘± zoom them (Appearance's Settings & Help size), over the terminal font's size they follow
  const pageOpen = settingsOf(dialog) || dialog === 'help'
  const pageZoom = PAGE_ZOOMS.includes(settings.pageZoom as number) ? settings.pageZoom! : 1
  const zoomPage = (d: number) => {
    const i = PAGE_ZOOMS.indexOf(pageZoom)
    call('settingsSet', { pageZoom: d ? PAGE_ZOOMS[Math.min(PAGE_ZOOMS.length - 1, Math.max(0, i + d))] : 1 }).catch(() => {})
  }

  // the sidebar's order: projects, and workspaces and seps within their project, dragged
  const rows = useRowDrag(d => {
    if (d.kind === 'project') return void call('reorder', { projects: moveId(view!.projects.map(p => p.id), d) })
    const p = view!.projects.find(p => p.seps?.some(x => x.id === d.id) || live.some(w => w.id === d.id && w.project === p.id))
    if (!p) return
    const ids = rowsOf(p, view!.workspaces).map(x => x.id) // archived ones too: a restore keeps its place
    // a folded sep takes the workspaces it hides along, up to the next sep
    const at = ids.indexOf(d.id)
    const next = ids.findIndex((x, i) => i > at && !!p.seps?.some(s => s.id === x))
    const moved = moveId(ids, d, folded.includes(d.id) ? (next < 0 ? ids.length : next) - at : 1)
    call('reorder', { workspaces: moved })
    // a workspace moved within a sorted group: its sort puts it back, so say why it didn't move
    const groupOf = (l: string[]) => l.slice(0, l.indexOf(d.id)).findLast(x => p.seps?.some(s => s.id === x)) ?? ''
    const g = groupOf(ids)
    const sort = p.seps?.find(s => s.id === g)?.sort ?? p.sort ?? 'manual'
    if (!p.seps?.some(s => s.id === d.id) && sort !== 'manual' && g === groupOf(moved)) toast(`Sorted ${SORTS.find(x => x[0] === sort)![1].toLowerCase()}: the ${g ? 'group' : 'project'}'s ⋯ › Sort workspaces › As dragged keeps the order you drag`)
    if (d.into && folded.includes(d.target)) fold(d.target) // dropped into a folded group: it opens, to show it there
  })
  // a sep: name it (a new one goes at the top: groups are made from the project's ⋯ only), or rename it
  // template: the default prompt template of a new workspace under it ('' none)
  const sepName = async (o: { sep: string; id?: string }, name: string, template: string) => {
    const p = view!.projects.find(p => p.id === o.sep)
    if (!p) return
    if (o.id) return void (await call('projectSet', { id: p.id, seps: p.seps?.map(x => (x.id === o.id ? { ...x, name, template } : x)) }))
    const id = `sep-${Math.random().toString(36).slice(2, 10)}`
    const ids = [id, ...rowsOf(p, view!.workspaces).map(x => x.id)]
    await call('projectSet', { id: p.id, seps: [...(p.seps ?? []), { id, name, template }], rows: ids })
  }
  // Sort workspaces: a project's (unset: as dragged), or a group's (unset: the project's, its own way named)
  const SORTS: [WsSort, string][] = [['manual', 'As dragged'], ['created', 'Newest first'], ['activity', 'Last active first'], ['name', 'By name']]
  const sortItems = (cur: WsSort | undefined, pick: (s: WsSort | undefined) => void, inherit?: WsSort): MenuItem[] => [
    null,
    { head: 'Sort workspaces' },
    ...(inherit ? [{ label: `Like the project (${SORTS.find(x => x[0] === inherit)![1].toLowerCase()})`, icon: 'sort', hint: cur ? undefined : ON, run: () => pick(undefined) } as MenuItem] : []),
    ...SORTS.map(([k, label]) => ({ label, icon: 'sort', hint: (cur ?? (inherit ? undefined : 'manual')) === k ? ON : undefined, run: () => pick(k) }) as MenuItem),
  ]
  const sepMenu = (p: Project, s: Sep): MenuItem[] => [
    { colors: TAB_COLORS, value: s.color, pick: c => call('projectSet', { id: p.id, seps: p.seps?.map(x => (x.id === s.id ? { ...x, color: c } : x)) }) },
    { label: 'New workspace here…', icon: 'plus', key: 'n', run: () => newWs(p.id, { place: s.id }) },
    ...(termsOk ? [{ label: 'New terminal here', icon: 'terminal', key: 't', run: () => termIn(p, s.id) } as MenuItem] : []),
    { label: folded.includes(s.id) ? 'Expand' : 'Collapse', icon: folded.includes(s.id) ? 'chevron' : 'chevronRight', key: 'c', run: () => fold(s.id) },
    { label: 'Edit…', icon: 'pencil', key: 'e', run: () => setDialog({ sep: p.id, id: s.id }) },
    ...sortItems(s.sort, sort => call('projectSet', { id: p.id, seps: p.seps?.map(x => (x.id === s.id ? { ...x, sort } : x)) }), p.sort ?? 'manual'),
    null,
    { label: 'Remove group (keeps its workspaces)', icon: 'trash', key: 'd', danger: true, run: () => call('projectSet', { id: p.id, seps: p.seps?.filter(x => x.id !== s.id), rows: p.rows?.filter(x => x !== s.id) }) },
  ]

  // the foot's timer button: a new one, for a length
  const startMenu = (): MenuItem[] => [
    { head: 'Start a timer' },
    ...MINUTES.map(m => ({ label: span(m * 60000), icon: 'timer', run: () => addTimer(m * 60000) }) as MenuItem),
    { label: 'Other length, a message or a command…', icon: 'pencil', key: 'o', run: () => setDialog('timer') },
    null,
    { label: 'Stopwatch', icon: 'clock', key: 's', run: () => setWatches(l => [...l, { id: Math.random().toString(36).slice(2, 10), ms: 0, from: Date.now() }]) },
  ]
  // a timer's own (its bar): more time, a new length, what happens as it ends, or stop it
  const reminder = (t: Timer, w = live.find(x => x.id === t.ws)) => `Remind me about ${w ? wsName(w) : 'a gone workspace'}`
  const sendTo = (t: Timer) => (t.tab === 'ai' ? 'Laki AI' : (view?.tabs.find(x => x.id === t.tab)?.name ?? 'a gone tab'))
  const timerMenu = (t: Timer): MenuItem[] => t.then === 'send' ? [
    { head: `Sends to ${sendTo(t)} at ${new Date(t.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` },
    { label: 'Send now', icon: 'arrowRight', key: 's', run: () => ring(t.id) },
    { label: 'Edit…', icon: 'pencil', key: 'e', run: () => setDialog({ sendLater: t.ws ?? '', edit: t.id }) },
    null,
    { label: 'Cancel it', icon: 'stop', key: 'c', danger: true, run: () => setTimer(t.id, () => null) },
  ] : t.then === 'remind' ? [
    { head: `${reminder(t)} at ${new Date(t.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` },
    { label: 'Open the workspace', icon: 'arrowRight', key: 'o', run: () => t.ws && setWsId(t.ws) },
    { label: 'Add 15 minutes', icon: 'plus', key: 'a', run: () => setTimer(t.id, x => ({ ...x, end: x.end + 900000, ms: x.ms + 900000 })) },
    null,
    { label: 'Cancel the reminder', icon: 'stop', key: 'c', danger: true, run: () => setTimer(t.id, () => null) },
  ] : [
    { head: t.left === undefined ? `Ends at ${new Date(t.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : `Paused, ${clock(t.left)} left` },
    { label: t.left === undefined ? 'Pause' : 'Go on', icon: t.left === undefined ? 'pause' : 'run', key: 'p', run: () => pause(t.id) },
    { label: 'Add 5 minutes', icon: 'plus', key: 'a', run: () => setTimer(t.id, x => ({ ...x, end: x.end + 300000, ms: x.ms + 300000, ...(x.left !== undefined && { left: x.left + 300000 }) })) },
    { label: t.note ? 'Change its message…' : 'Add a message…', icon: 'pencil', key: 'm', run: () => setDialog({ timerNote: t.id }) },
    ...(t.note ? [{ label: 'Remove its message', icon: 'x', run: () => setTimer(t.id, x => ({ ...x, note: undefined })) } as MenuItem] : []),
    null,
    { head: 'Start over with' },
    ...MINUTES.map(m => ({ label: span(m * 60000), icon: 'timer', run: () => restart(t.id, m * 60000) }) as MenuItem),
    { label: 'Other length…', icon: 'pencil', key: 'o', run: () => setDialog({ timer: t.id }) },
    null,
    { head: 'When it ends' },
    ...TIMER_THEN.filter(([id]) => id !== 'command' || ws).map(([id, label, icon]) => ({ label, icon, hint: t.then === id ? '✓' : undefined, run: () => (id === 'command' ? setDialog({ timerCmd: t.id }) : setTimer(t.id, x => ({ ...x, then: id }))) }) as MenuItem), // a command runs in a workspace: none, none offered
    null,
    { label: 'Stop the timer', icon: 'stop', key: 's', danger: true, run: () => setTimer(t.id, () => null) },
  ]

  // right click on a workspace in the sidebar
  // a delayed start (wsNew startAt): its agent now, at another time (when.ts parseAt's words, or limit), or never
  const laterNow = (w: WorkspaceView) => void call('wsSet', { id: w.id, start: true }).catch(() => {})
  const laterChange = async (w: WorkspaceView) => {
    const t = (await askText(`When should ${w.pending?.agent ?? 'its agent'} start?`, { text: 'tomorrow 9am, in 2h, 2026-10-20 14:30, or limit: after the plan limit resets', value: w.pending?.limit ? 'limit' : '', ok: 'Change' }))?.trim()
    if (!t) return
    const at = /^(after )?(the )?(plan )?limit/i.test(t) ? ('limit' as const) : parseAt(t)
    if (typeof at === 'object') return toast(at.error)
    call('wsSet', { id: w.id, pending: { at } }).then(() => done(pendingWords({ at: at === 'limit' ? undefined : at, limit: at === 'limit', agent: '' }, true)), () => {})
  }
  const laterCancel = (w: WorkspaceView) => call('wsSet', { id: w.id, pending: null }).then(() => done(`${w.pending?.agent ?? 'Its agent'} won't start in ${wsName(w)}`), () => {})
  const laterItems = (w: WorkspaceView): MenuItem[] => (w.pending ? [{ head: pendingWords(w.pending, true) }, { label: 'Start now', icon: 'run', run: () => laterNow(w) }, { label: 'Change time…', icon: 'clock', run: () => void laterChange(w) }, { label: 'Cancel delayed start', icon: 'x', danger: true, run: () => void laterCancel(w) }, null] : [])
  const wsMenu = (w: WorkspaceView): MenuItem[] => [
    ...laterItems(w),
    { colors: TAB_COLORS, value: w.color, pick: c => call('wsSet', { id: w.id, color: c }) },
    { label: 'Rename…', icon: 'pencil', key: 'r', run: () => setDialog({ renameWs: w.id }) },
    { label: 'Info', icon: 'info', key: 'i', run: () => (setWsId(w.id), showInfo(true)) },
    { label: 'Open in', icon: 'code', key: 'o', items: openInItems({ ws: w.id }) },
    { label: w.muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', run: () => call('wsSet', { id: w.id, muted: !w.muted }) },
    { label: 'Remind me…', icon: 'timer', key: 'e', run: () => setDialog({ remind: w.id }) },
    { label: w.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', key: 'p', run: () => call('wsSet', { id: w.id, pinned: !w.pinned }) },
    ...(rail ? [{ label: w.railPin ? 'Unpin from the rail' : 'Pin to the rail', icon: 'pin', key: 'k', run: () => call('wsSet', { id: w.id, railPin: !w.railPin }).catch(fail) } as MenuItem] : []), // full (pinned specs count too): says so
    ...(agentTab(w.id) ? [{ label: 'Mark as unread', icon: 'unread', key: 'u', run: () => markUnread(agentTab(w.id)!.id) } as MenuItem] : []),
    ...(w.race ? [{ label: 'Compare the race', icon: 'race', key: 'c', run: () => setDialog({ compare: w.race! }) } as MenuItem] : []),
    ...(w.branch && !isTerm(w) ? [{ label: 'Copy branch name', icon: 'copy', key: 'b', run: () => copy(w.branch) } as MenuItem] : []),
    ...(w.kind === 'worktree' ? [{ label: w.pr ? 'Refresh PR status' : 'Look for a PR', icon: 'refresh', run: refreshPR } as MenuItem] : []),
    ...(attachable(w) ? [{ label: 'Attach a PR…', icon: 'link', key: 'h', run: () => setDialog({ attachPr: w.id }) } as MenuItem] : []),
    ...(settings.devMode ? [{ label: 'Logs', icon: 'file', key: 'l', run: () => setDialog({ logs: `ws:${w.id}`, title: `Logs · ${wsName(w)}` }) } as MenuItem] : []),
    ...(w.pr?.state === 'OPEN' && !w.pr.mine && allows(w, 'approve') ? [{ label: `Approve PR #${w.pr.number}…`, icon: 'check', run: () => prAct(w, 'approve') } as MenuItem] : []),
    ...(w.pinned ? [] : groupItems(w)),
    ...runItems(w),
    ...flowMenu(w),
    null,
    ...(w.kind === 'worktree'
      ? [
          { label: 'Fork workspace', icon: 'fork', key: 'f', run: () => forkWs(w) } as MenuItem,
          { label: 'Archive workspace', icon: 'archive', key: 'a', run: () => archive(w) } as MenuItem,
        ]
      : []),
    rmItem(w),
    ...extItems('workspace', w, { ws: w.id }),
  ]

  // Move to group ›, a submenu: a workspace into one of its project's groups (first in it, as a drop on its head), or out
  // of its group (last before the first one); no groups: nothing (they're made from the project's ⋯)
  const groupItems = (w: WorkspaceView): MenuItem[] => {
    const p = view?.projects.find(p => p.id === w.project)
    if (!p?.seps?.length) return []
    const ids = rowsOf(p, view!.workspaces).map(x => x.id)
    const seps = p.seps ?? []
    const isSep = (x: string) => seps.some(s => s.id === x)
    const inSep = ids.slice(0, ids.indexOf(w.id)).reverse().find(isSep)
    const to = (target: string, into: boolean) => {
      call('reorder', { workspaces: moveId(ids, { kind: 'ws', id: w.id, target, after: into, into }) }).catch(() => {})
      if (into && folded.includes(target)) fold(target) // as a drop does: it opens, to show it there
    }
    const items = [
      ...seps.filter(s => s.id !== inSep).map(s => ({ label: s.name || 'Unnamed group', icon: 'sep', run: () => to(s.id, true) }) as MenuItem),
      ...(inSep ? [{ label: 'Out of its group', icon: 'minus', run: () => to(ids.find(isSep)!, false) } as MenuItem] : []),
    ]
    return items.length ? [{ label: 'Move to group', icon: 'sep', key: 'g', items }] : []
  }
  // Run workflow ›: the project's workflows and yours, a pick its Run sheet in this workspace (Workflows on; not a
  // terminal's, a browser's, a host's or an archived one)
  const flowsHere = (w: WorkspaceView) => flowItems.filter(f => f.source === 'yours' || f.project === w.project)
  const flowMenu = (w: WorkspaceView): MenuItem[] =>
    !flowsOn || rawKind(w) !== 'projects' || w.term || w.host || w.archived
      ? []
      : (l => [{ label: 'Run workflow', icon: 'flow', key: 'w', items: l.length ? l.map(f => ({ label: f.name, sub: f.problems[0] ?? (f.source === 'project' ? 'the project’s' : 'yours'), icon: 'flow', ...(f.problems.length && { tone: 'warn' as const }), run: () => runFlow(f, w.id) }) as MenuItem) : [{ label: 'New workflow…', icon: 'plus', run: () => setDialog({ workflows: '' }) }] }])(flowsHere(w))
  const runFlow = (f: WorkflowItem, ws?: string) => setDialog({ workflows: '', start: { id: f.id, source: f.source, project: f.project, ws } })
  // Run ›: the toolbar's Run ▾ for this workspace (its script, localhost, the agent and terminal actions), a submenu;
  // a terminal or a browser has none
  const runItems = (w: WorkspaceView): MenuItem[] => (rawKind(w) === 'projects' ? [{ label: 'Run', icon: 'run', key: 'n', items: runMenu(w) }] : [])
  // a git workspace on a branch with no PR found: one can be attached by hand (prAttach)
  const attachable = (w: WorkspaceView) => !w.pr && !!w.branch && !w.term && view?.projects.find(p => p.id === w.project)?.git !== false
  // the status bar's branch, short: Laki's prefix (Settings › Git & worktrees) off
  const shortBranch = (b: string, pre = settings.branchPrefix?.trim() || 'laki/') => (b.startsWith(pre) ? b.slice(pre.length) : b)
  // a workspace for the info panel and the status bar's PR
  const cfgOf = (w: WorkspaceView) => view?.projects.find(p => p.id === w.project)?.config
  const allows = (w: WorkspaceView, k: 'approve' | 'close' | 'merge' | 'land') => prAllows(cfgOf(w), k)
  const infoOf = (w: WorkspaceView, cfg = cfgOf(w)): WsInfo => {
    const live = (id?: string) => view?.workspaces.find(x => x.id === id && !x.archived)
    const from = live(w.from)
    return {
      ...w,
      checking: checking === `merge:${w.id}`,
      from: from && { id: from.id, name: wsName(from) },
      started: view?.workspaces.filter(x => x.from === w.id && !x.archived).map(x => ({ id: x.id, name: wsName(x) })),
      allow: { approve: prAllows(cfg, 'approve'), close: prAllows(cfg, 'close'), merge: prAllows(cfg, 'merge'), land: prAllows(cfg, 'land') },
      method: cfg?.mergeMethod,
      ...(w.fix?.pr === w.pr?.number && { fixTries: w.fix?.tries, mergeTries: w.fix?.merges }), // this PR's counts only
      prScan: settings.prScan || PR_SCAN,
      prTries: settings.prTries || PR_TRIES,
    }
  }
  // merge when green, and fix CI on a fork's PR: asked as it's turned on
  const setAuto = async (w: WorkspaceView, k: AutoKey, v: boolean) => {
    if (k === 'autoFix' && v && (w.fork || w.pr?.cross) && !(await ask(`Fix CI on ${w.pr ? `PR #${w.pr.number}` : 'this PR'}, from a fork?`, { text: "Its failing checks' logs go to the agent, and they're output of code someone outside the repo wrote: they can say anything. The agent is told they're data, not instructions; read what it does.", ok: 'Fix CI' }))) return
    if (k === 'autoLand' && v && !(await ask(`Merge ${w.pr ? `PR #${w.pr.number}` : 'the PR'} when it's green?`, { text: `Laki will ${MERGE_WORDS[cfgOf(w)?.mergeMethod ?? 'squash'].toLowerCase()} it as you and delete its branch on GitHub, once every check passes, it has no conflicts, isn't a draft, is approved if the repo asks for a review and its agent isn't working.`, ok: 'Merge when green' }))) return
    call('wsSet', { id: w.id, [k]: v }).catch(() => {})
  }
  // job: only that check's (its Log's Send to the agent); whether it went
  const prFix = (w: WorkspaceView, what: FixWhat, job?: string) => call('prFix', { ws: w.id, what, job }).then(() => (toast('Sent to the agent'), true), () => false)
  const ciLog = (w: WorkspaceView, c: Check) => (job => (job ? setDialog({ ciLog: w.id, job, name: c.name, url: c.url }) : c.url && openExternal(c.url)))(jobOf(c.url)) // other CI: its page
  // GitHub asked again now, not at the next scan (every settings.prScan minutes)
  const refreshPR = () => call('prRefresh').then(() => done('PR status: fresh from GitHub'), () => {})
  // the PR section's Labels: the repo's, and one put on or taken off (gh pr edit, as you)
  const labelApi = (w: WorkspaceView): LabelApi => ({
    list: () => call<PRLabel[]>('prLabels', { ws: w.id }),
    set: (label, on) => void call('prLabel', { ws: w.id, label, on }).then(() => done(on ? `Labeled PR #${w.pr?.number}: ${label}` : `Took ${label} off PR #${w.pr?.number}`), () => {}),
  })
  // right click on the status bar's PR
  // Approve / Close / Merge: gh as you, once you say so (merge: the checks and review in the question, and whether
  // GitHub deletes the branch)
  const prAct = async (w: WorkspaceView, act: PRAct, method: MergeMethod = cfgOf(w)?.mergeMethod ?? 'squash') => {
    const pr = w.pr
    if (!pr) return
    if (act === 'merge') {
      const del = { label: 'Delete the branch on GitHub', on: true }
      const verb = { squash: 'Squash-merge', merge: 'Merge', rebase: 'Rebase-merge' }[method]
      const review = (pr.review && REVIEW[pr.review]) || 'no review needed'
      const text = [pr.title, `Checks: ${ciText(pr)} · ${review}${pr.conflict ? ' · merge conflicts' : ''}`].filter(Boolean).join('\n')
      if ((await choose(`${verb} PR #${pr.number} into ${pr.base ?? 'its base'}?`, text, [{ label: 'Cancel' }, { label: MERGE_WORDS[method], primary: true }], del)) !== 1) return
      return gated(w, 'merge', force => call('prAct', { ws: w.id, act, method, deleteBranch: del.on, force }).catch(() => undefined)).then(r => r !== undefined && toast(`Merged PR #${pr.number}`, undefined, undefined, true))
    }
    const close = act === 'close'
    const facts = close ? 'Without merging; it can be reopened on GitHub.' : [pr.author && `By ${pr.author}`, `Checks: ${ciText(pr)}`, pr.conflict && 'merge conflicts'].filter(Boolean).join(' · ')
    if (!(await ask(close ? `Close PR #${pr.number}?` : `Approve PR #${pr.number}?`, { text: [pr.title, facts].filter(Boolean).join('\n'), ok: close ? 'Close pull request' : 'Approve', danger: close }))) return
    call('prAct', { ws: w.id, act }).then(() => toast(close ? `Closed PR #${pr.number}` : `Approved PR #${pr.number}`, undefined, undefined, true), () => {})
  }
  const prMenu = (w: WorkspaceView): MenuItem[] => [
    { label: 'Refresh from GitHub', icon: 'refresh', key: 'r', run: refreshPR },
    ...(w.pr
      ? [
          { label: 'Open the PR', icon: 'link', key: 'o', run: () => openExternal(w.pr!.url) } as MenuItem,
          { label: 'Open its checks', icon: 'link', key: 'c', run: () => openExternal(`${w.pr!.url}/checks`) } as MenuItem,
          { label: 'Copy PR link', icon: 'copy', key: 'l', run: () => copy(w.pr!.url) } as MenuItem,
          { label: `Copy #${w.pr.number}`, icon: 'copy', key: 'n', run: () => copy(`#${w.pr!.number}`) } as MenuItem,
        ]
      : []),
    ...(w.pr?.state === 'OPEN'
      ? [
          null,
          ...(allows(w, 'merge') && !w.pr.draft ? [{ label: `${MERGE_WORDS[cfgOf(w)?.mergeMethod ?? 'squash']}…`, icon: 'pr', key: 'm', run: () => prAct(w, 'merge') } as MenuItem] : []),
          ...(w.pr.mine || !allows(w, 'approve') ? [] : [{ label: 'Approve…', icon: 'check', key: 'a', run: () => prAct(w, 'approve') } as MenuItem]),
          ...(allows(w, 'close') ? [{ label: 'Close PR…', icon: 'x', danger: true, run: () => prAct(w, 'close') } as MenuItem] : []),
        ]
      : []),
  ]

  // right click on a tab (or a pane header: one session)
  const tabMenu = (ids: string[]): MenuItem[] => {
    const ts = ids.map(byId).filter((t): t is TabView => !!t)
    const g = groups.find(g => tabsOf(g).includes(ids[0]))
    const ended = ts.filter(t => t.status === 'exited' && againOnEnter(t))
    const others = groups.filter(x => x !== g).flatMap(x => tabsOf(x).map(byId)).filter((t): t is TabView => !!t)
    return [
      { label: 'Rename…', icon: 'pencil', key: 'r', run: () => setDialog({ rename: ts[0].id }) },
      { colors: TAB_COLORS, value: colorOf(ts[0]), pick: c => ts.forEach(t => call('tabSet', { id: t.id, color: c })) },
      { label: ts[0].muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', run: () => ts.forEach(t => call('tabSet', { id: t.id, muted: !ts[0].muted })) },
      { label: 'Mark as unread', icon: 'unread', key: 'u', run: () => ts.forEach(t => markUnread(t.id)) },
      ...(bridge?.floatTab && ts.length === 1 ? [floated.includes(ts[0].id) ? ({ label: 'Back from its own window', icon: 'popIn', run: () => floatTab(ts[0].id, false) } as MenuItem) : ({ label: 'Float in its own window', icon: 'popOut', sub: 'Over every app, so you can watch it from anywhere', run: () => floatTab(ts[0].id) } as MenuItem)] : []),
      ...(ts[0].kind === 'agent' && ts[0].status !== 'exited' ? [{ label: 'Send a message later…', icon: 'timer', run: () => setDialog({ sendLater: ts[0].workspace, to: ts[0].id }) } as MenuItem] : []),
      ...(ts.length === 1 ? [{ label: 'Copy contents', icon: 'copy', sub: 'Its whole terminal as text, the scrollback too', run: () => copyTab(ts[0]) } as MenuItem] : []),
      ...(bridge ? [{ label: 'Copy link', icon: 'link', key: 'l', run: () => copy(wsLink(ts[0].workspace, ts[0].id)) } as MenuItem] : []),
      ts[0].share
        ? {
            label: 'Shared live view',
            icon: 'globe',
            items: [
              { label: 'Link and QR code…', icon: 'globe', run: () => setSharing(ts[0].id) },
              { label: 'Copy share link', icon: 'link', run: () => copy(ts[0].share!.url) },
              { label: 'Stop sharing', icon: 'x', danger: true, run: () => void call('shareStop', { tab: ts[0].id }).then(() => done(`${ts[0].name} isn't shared any more: its link is dead`)) },
            ],
          }
        : { label: 'Share live view…', icon: 'globe', sub: 'A view-only page of it, live, at a link', run: () => setSharing(ts[0].id) },
      null,
      { label: 'Split right', icon: 'splitRight', run: () => (selectTab(ts[0].id), split('right', ts[0].id)) },
      { label: 'Split down', icon: 'splitDown', run: () => (selectTab(ts[0].id), split('bottom', ts[0].id)) },
      ...(g && tabsOf(g).length > 1
        ? ids.length > 1
          ? [{ label: 'Separate panes', icon: 'unsplit', run: () => setGroups(groups.flatMap(x => (x === g ? tabsOf(x).map(tab => ({ tab })) : [x]))) } as MenuItem]
          : [{ label: 'Move to its own tab', icon: 'unsplit', run: () => setGroups(move(groups, ids[0], false, 'bar')) } as MenuItem]
        : []),
      ...(ended.length ? [{ label: 'Restart', icon: 'restore', run: () => ended.forEach(t => api.send('input', { tab: t.id, data: '\r' })) } as MenuItem] : []),
      ...(ts.length === 1 && accountsOf(ts[0].preset).length > 1 && !view?.workspaces.find(w => w.id === ts[0].workspace)?.host
        ? [{ label: 'Restart on another account', icon: 'restore', items: accountsOf(ts[0].preset).map(a => ({ label: a.name, hint: (ts[0].account ?? HOME_ACCOUNT) === a.id ? ON : undefined, run: () => (ts[0].account ?? HOME_ACCOUNT) !== a.id && restartOn(ts[0], a.id, a.name) }) as MenuItem) } as MenuItem]
        : []),
      null,
      { label: ids.length > 1 ? 'Close tab' : 'Close', icon: 'x', hint: kh('closeTab'), run: () => closeTabs(ts) },
      ...(ids.length > 1 || !g || tabsOf(g).length === 1 ? (others.length ? [{ label: 'Close other tabs', icon: 'x', danger: true, run: () => closeTabs(others) } as MenuItem] : []) : []),
      ...(ts.length === 1 ? extItems('tab', view?.workspaces.find(x => x.id === ts[0].workspace), { ws: ts[0].workspace, tab: ts[0].id }) : []),
    ]
  }
  const restore = (id: string) => call('wsRestore', { id }).then(() => showNew(id))
  const newWs = (projectId?: string, init?: Partial<NewWsParams>) => {
    setNewFor(projectId)
    setNewInit(init) // a sep's place, or none: not the one the page was opened with before
    setDialog('new')
  }

  // the native folder picker, then straight to a workspace in that project (the web dev renderer has
  // no picker: it gets the typed-path dialog)
  const openProject = async () => {
    if (!bridge) return setDialog('project')
    const path = await bridge.pickFolder()
    if (!path) return
    const p = await call<Project>('projectAdd', { path }).catch(() => null) // the toast says why
    if (p) newWs(p.id)
  }
  // Browsers workspaces opened since the app started: their pages stay loaded (hidden) as you move between them
  const [browsed, setBrowsed] = useState<string[]>([])
  useEffect(() => {
    if (ws?.browser !== undefined && !browsed.includes(ws.id)) setBrowsed(b => [...b, ws.id])
  }, [ws?.id])
  // Settings › Resources' Stop on a browser: the pages you aren't on unloaded (each loads again as you open it)
  const wsNow = useRef(ws?.id)
  wsNow.current = ws?.id
  useEffect(() => {
    const f = (e: Event) => (e as CustomEvent).detail === 'browsers' && setBrowsed(b => b.filter(id => id === wsNow.current))
    window.addEventListener('laki-stop', f)
    return () => window.removeEventListener('laki-stop', f)
  }, [])
  // a page's address and title: the workspace's (its sidebar name), once it settles
  const pageTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pageSeen = (id: string, url: string, title: string) => {
    clearTimeout(pageTimers.current[id])
    pageTimers.current[id] = setTimeout(() => void api.call('wsSet', { id, browser: url, ...(title.trim() && { name: title }) }).catch(() => {}), 400)
  }
  // Get started (panels.tsx Onboarding): shown once as Laki opens (seen), its steps done by hand (done) or by
  // themselves (onboardDone, kept as they happen); off: Don't show again, and no bar at the sidebar's foot
  const [onboard, setOnboard] = useState<{ done: string[]; seen?: boolean; off?: boolean }>(() => load('laki.onboard', { done: [] }))
  useEffect(() => store('laki.onboard', onboard), [onboard])
  const [seenSecs, setSeenSecs] = useState<string[]>([]) // Settings' sections opened since the app started
  const onboardDone = new Set([
    ...onboard.done,
    ...(view?.projects.some(p => !p.kind) ? ['project'] : []),
    ...(view?.workspaces.some(w => !w.archived && !view.projects.find(p => p.id === w.project)?.kind) ? ['workspace'] : []),
    ...(seenSecs.length ? ['settings'] : []),
    ...['actions', 'templates', 'presets', 'remote'].filter(x => seenSecs.includes(x)),
    ...(settings.calendar || settings.notes || settings.todoList ? ['experimental'] : []), // one turned on; else seen through Go (below)
    ...(view?.widgets?.some(w => w.on) ? ['widgets'] : []), // an extension turned on, not the section only looked at
    ...(view?.projects.some(p => p.kind) ? ['shell'] : []),
  ])
  const onboardKey = [...onboardDone].sort().join()
  useEffect(() => {
    if (view && onboardDone.size > onboard.done.length) setOnboard(o => ({ ...o, done: [...onboardDone] })) // kept: a project removed later doesn't undo it
  }, [onboardKey])
  useEffect(() => {
    if (!view || onboard.seen || dialog) return // a link's page first: it comes as that closes
    setOnboard(o => ({ ...o, seen: true }))
    setDialog('onboard') // once, as it opens: everyone, this update's users too
  }, [!!view, !dialog])
  // the workflows a workspace's Run workflow › and ⌘K offer: again as a file changes (Workflows on). Once the first view
  // is in (the socket is open: Workflows are on before the settings come), and quietly: a list in the background
  const [flowItems, setFlowItems] = useState<WorkflowItem[]>([])
  useEffect(() => void (flowsOn && view ? api.call<WorkflowItem[]>('flowList', {}).then(l => setFlowItems(l.filter(f => f.source !== 'builtin')), () => {}) : setFlowItems([])), [flowsOn, !view, view?.flowFiles])
  // a page seen ticks its step: Scheduled tasks, Workflows, Settings opened at Experimental
  useEffect(() => {
    const id = schedulesOf(dialog) !== undefined ? 'schedules' : flowsOf(dialog) ? 'workflows' : dialog && typeof dialog === 'object' && 'spot' in dialog && dialog.spot === 'Experimental' ? 'experimental' : undefined
    if (id) setOnboard(o => (o.done.includes(id) ? o : { ...o, done: [...o.done, id] }))
  }, [dialog])
  const onboardGo = (id: string) => {
    setDialog(null)
    if (id === 'project') openProject()
    else if (id === 'workspace') view?.projects.some(p => !p.kind) ? newWs() : openProject()
    else if (id === 'settings') setDialog('settings')
    else if (id === 'shell') quickNew('shells')
    else if (id === 'experimental') setDialog({ section: 'general', spot: 'Experimental' })
    else if (id === 'workflows' && !flowsOn) setDialog({ section: 'general', spot: 'Pages' }) // Workflows off: where it's turned on again
    else if (id === 'schedules') setDialog('schedules')
    else if (id === 'workflows') setDialog({ workflows: '' })
    else setDialog({ section: id })
  }
  // the sidebar's + › Terminal or Browser: a new one in the Terminals or Browsers project (the first makes it), selected
  // a page's link to a new tab (url; front: target=_blank, else a middle click, ⌘-click or its menu): one more, selected or not
  const quickNew = async (kind: 'shells' | 'browsers', url?: string, front = true, at?: { project: string; place?: string }) => {
    const w = await call<WorkspaceView>('quickNew', { kind, ...(url && { url }), ...at }).catch(() => null) // the toast says why
    if (w && front) (showNew(w.id), setDialog(null))
  }
  const quickRef = useRef(quickNew)
  quickRef.current = quickNew
  useEffect(() => {
    bridge?.onBrowserTab?.((url, front) => void quickRef.current('browsers', url, front))
  }, [])
  const addMenu = (): MenuItem[] => [
    { label: 'Project folder…', icon: 'folderPlus', hint: '⌘O', key: 'p', run: openProject },
    { label: 'Terminal', icon: 'terminal', key: 't', hint: 'in your home folder', run: () => quickNew('shells') },
    { label: 'Browser', icon: 'globe', key: 'b', hint: 'any website', run: () => quickNew('browsers') },
  ]
  const newIn = (p: Project) => (p.kind ? quickNew(p.kind) : newWs(p.id)) // a project head's +
  // a project's or group's +: a workspace, or a terminal in the project's own folder (API 107; before: a workspace at once)
  const termsOk = (view?.api ?? 0) >= 107
  const termIn = (p: Project, place?: string) => quickNew('shells', undefined, true, { project: p.id, ...(place && { place }) })
  const plusMenu = (p: Project, place?: string): MenuItem[] => [
    { label: 'New workspace', icon: 'plus', key: 'n', hint: place ? undefined : kh('newWs'), run: () => newWs(p.id, place ? { place } : undefined) },
    { label: 'Terminal', icon: 'terminal', key: 't', hint: termWhere(p), run: () => termIn(p, place) },
  ]
  const termWhere = (p: Project) => `in ${p.host ? `${p.host}:` : ''}${shortPath(p.path)}`
  const newWord = (p: Project) => (p.kind === 'shells' ? 'New terminal' : p.kind === 'browsers' ? 'New browser' : 'New workspace')

  // keys: capture phase, before xterm.js sees them. force: an action of Settings › Keys by its id (a menu bar item's,
  // a Browsers page's ⌘T/⌘W), whatever its keys; fixed: a menu bar item's fixed key (⌘O, ⌘E…), never one of Settings ›
  // Keys' that was given the same keys
  const keys = useRef<(e: KeyboardEvent, force?: KeyId, fixed?: boolean) => void>(() => {})
  keys.current = (e, force, fixed) => {
    if (keyRec.on) return // a hotkey being recorded in Settings
    // development mode's element picker, over anything (a dialog, a page): its hotkey (Settings › General › Development)
    if (!force && settings.devMode === true && pickKey && !e.repeat && keyLabel(e) === pickKey) return void (e.preventDefault(), e.stopPropagation(), setPicking(p => !p))
    const field = (t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && !t.classList.contains('xterm-helper-textarea'))(e.target as HTMLElement | null)
    // Settings › Keys' (kb): false where one doesn't apply now, so its keys go on (⌘[ in a text field: an indent)
    const bound: Record<KeyId, false | (() => unknown)> = {
      newWs: () => newWs(ws?.project),
      newTab: () => (ws?.browser !== undefined ? quickNew('browsers') : newTab('shell')), // a browser's: another browser
      closeTab: () => (ws?.browser !== undefined ? dialog || closePage(ws) : previewed ? closePreview() : tab && closeTabs([tab])), // a Browsers page: it closes (not under a page or dialog: it isn't in sight); else the file preview first
      sidebar: () => setSideOpen(o => !o),
      panel: () => ws && togglePanel(),
      info: () => showInfo(),
      palette: () => setDialog(d => (d === 'palette' ? null : 'palette')),
      files: () => ws && setDialog(d => (d === 'files' ? null : 'files')),
      find: () => dialog || (tab && setFinds(m => ({ ...m, [tab.id]: (m[tab.id] ?? 0) + 1 }))), // not over a dialog
      next: nextNeed,
      later: canLater && !dialog && (() => sendLater(tab?.kind === 'agent' ? tab.id : undefined)),
      artifacts: () => dialog || toggleArtifacts(), // not under a page: out of sight
      full: () => toggleFull(), // full screen, or back
      back: historyOn && !field && (() => travel(hist.current.i - 1)),
      forward: historyOn && !field && (() => travel(hist.current.i + 1)),
      settings: () => toSettings(),
      help: () => setDialog(d => (d === 'help' ? null : 'help')),
      layout: !dialog && (() => document.querySelector<HTMLElement>('.layout-btn')?.click()),
    }
    const id = force ?? (fixed ? undefined : keyFor(e, kb))
    const run = id && bound[id]
    if (run) return void (e.preventDefault(), e.stopPropagation(), run())
    if (force) return
    // an extension action's key (with Alt or Ctrl: ⌘ and ⌘⇧ alone are Laki's), with the workspace and tab you're in;
    // not under a yes/no (its run's own question would replace it: a Deny, a Cancel)
    const hit = (e.altKey || e.ctrlKey) && !e.repeat && !document.querySelector('.ask-overlay') ? (p => extOn(ws).flatMap(w => (w.menus ?? []).filter(m => m.key === p).map(m => ({ w, m }))))(pressOf(e))[0] : undefined
    if (hit) return void (e.preventDefault(), e.stopPropagation(), void extRun(hit.w, hit.m, hereCtx()))
    if (!e.metaKey || e.altKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    // ⌘⇧N: the tab bar's +, its menu (shell, each agent, command) to pick from with the keys
    if (e.shiftKey && k === 'n') return void (e.preventDefault(), e.stopPropagation(), dialog || document.querySelector<HTMLElement>('.newtab-btn')?.click())
    // the fixed ones (shared/keys.ts FIXED)
    const act: Record<string, () => void> = {
      e: () => ws && openIn(editor),
      '=': () => zoom(1),
      '+': () => zoom(1),
      '-': () => zoom(-1),
      '0': () => zoom(0),
      o: openProject,
      d: () => git && togglePanel('changes'),
      arrowup: () => moveWs(-1),
      arrowdown: () => moveWs(1),
    }
    if (/^[1-9]$/.test(k)) act[k] = () => (n => (n < 0 ? openReview() : groups[n] && selectGroup(groups[n])))(Number(k) - 1 - (reviewTab ? 1 : 0)) // the review's tab first: ⌘1
    if (!act[k] || (e.shiftKey && k !== 'arrowup' && k !== 'arrowdown' && k !== '+')) return
    const t = e.target as HTMLElement | null // ⌘↑/⌘↓ in a text field move its cursor (xterm's own textarea isn't one)
    if (k.startsWith('arrow') && t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && !/^(checkbox|radio|button|submit)$/.test(t.type))) && !t.classList.contains('xterm-helper-textarea')) return
    e.preventDefault()
    e.stopPropagation()
    act[k]()
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    bridge?.onBrowserKey?.(key => keys.current(new KeyboardEvent('keydown', { key, metaKey: true }), isKeyId(key) ? key : undefined, !isKeyId(key))) // a menu bar item's (an id, or a fixed key) or a Browsers page's, as if here
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])
  useEffect(() => void bridge?.keys?.(settings.keys ?? {}), [JSON.stringify(settings.keys ?? {})]) // the menu bar's items show them

  // the actions, once: the ⋯ menus and the palette show the same ones
  type Action = { label: string; icon: IconName; hint?: string; key?: string; danger?: boolean; sub?: string; run: () => void }
  const newTabIn = (w: WorkspaceView | null): Action[] => [
    { label: 'Shell', icon: 'terminal', hint: w?.id === ws?.id ? kh('newTab') : undefined, run: () => newTab('shell', undefined, w) },
    ...(view?.presets ?? []).filter(p => !p.off).map(p => ({ label: p.name, icon: 'agent', sub: p.agent === 'command' ? 'Command' : [AGENT_NAMES[p.agent], p.model].filter(Boolean).join(' · '), run: () => newTab(p.name, undefined, w) }) as Action),
    { label: 'Command…', icon: 'terminal', run: () => (w && setWsId(w.id), setDialog('custom')) }, // the dialog is for the selected one
  ]
  const newTabActions = newTabIn(ws)
  // ⌘J: the next tab that needs you (waiting first, then done unseen; the Dock's count), around
  // the Needs you list's cards: answered as main's notification actions do (answer refuses a menu that changed)
  const needsApi: NeedsApi = {
    open: t => (setDialog(null), selectTab(t), narrow && setSideOpen(false)),
    answer: (t, n, label) => void api.call('answer', { tab: t.id, n, label }).catch(() => toast('It asks something else now: open it', () => needsApi.open(t), 'Open')),
    pick: (t, pick) => void api.call('answer', { tab: t.id, pick }).catch(e => toast((e as Error).message, () => needsApi.open(t), 'Open')),
    permission: t => /permission/i.test(waits.current.get(t.id) ?? ''),
    review: t => (setDialog(null), setWsId(t.workspace), showPanel('changes'), narrow && setSideOpen(false)),
    seen: t => void call('seen', { tab: t.id }).catch(() => {}),
    name: wsName,
  }
  // ⌘J and the Needs you list walk the same list: waiting first, then done, the oldest first in each
  const nextNeed = () => {
    earn('jump')
    const need = needsSorted(needing.filter(t => order.some(w => w.id === t.workspace)))
    if (!need.length) return toast('Nothing needs you')
    setDialog(null)
    selectTab(need[(need.findIndex(t => t.id === tab?.id) + 1) % need.length])
  }
  // ⌘⇧A, the status bar's Artifacts › Show here: the strip of what its agents keep, over the status bar, or not
  const toggleArtifacts = () => (ws?.storage ? setGallery(g => (g === ws.id ? null : ws.id)) : toast('No artifacts here: its folder is made with its first agent'))
  // Send later: to one of the workspace's agents, or Laki AI (on); to: who it's for at first
  const canLater = !!ws && (aiOn(settings) || tabs.some(t => t.kind === 'agent' && t.status !== 'exited'))
  const sendLater = (to?: string, text?: string) => setDialog({ sendLater: ws?.id ?? '', ...(to && { to }), ...(text && { text }) })
  const wsActions: Action[] = !ws
    ? []
    : [
        ...(tab ? [{ label: 'Split right', icon: 'splitRight', run: () => split('right') } as Action, { label: 'Split down', icon: 'splitDown', run: () => split('bottom') } as Action] : []),
        ...(ws.kind === 'worktree'
          ? [{ label: 'Fork workspace', icon: 'fork', key: 'f', run: () => forkWs(ws) } as Action, { label: 'Archive workspace', icon: 'archive', key: 'a', run: () => archive(ws) } as Action]
          : []),
        ...(canLater ? [{ label: 'Send a message later…', icon: 'timer', key: 'l', hint: kh('later'), run: () => sendLater() } as Action] : []),
        { label: 'Rename workspace…', icon: 'pencil', key: 'r', run: () => setDialog({ renameWs: ws.id }) },
        ...(ws.browser === undefined ? [{ label: 'Copy path', icon: 'copy', key: 'c', hint: (ws.host ? `${ws.host}:` : '') + shortPath(ws.path), run: () => copy((ws.host ? `${ws.host}:` : '') + ws.path) } as Action] : []),
        { label: ws.pinned ? 'Unpin workspace' : 'Pin workspace to top', icon: 'pin', run: () => call('wsSet', { id: ws.id, pinned: !ws.pinned }) },
        rmItem(ws) as Action,
      ]
  const tasksOf = (project: string) => (n => (n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : undefined))(view?.schedules?.filter(s => s.project === project).length ?? 0)
  // fold a project's workspaces away, or back; ids of removed projects go
  const fold = (id: string) => setFolded(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]).filter(x => x === 'needs' || view?.projects.some(p => p.id === x || p.seps?.some(s => s.id === x)))) // needs: the Needs you list
  const projectActions = (p: Project): MenuItem[] => {
    const archived = view?.workspaces.filter(w => w.archived && w.project === p.id) ?? []
    return [
      { label: newWord(p), icon: 'plus', hint: p.kind ? undefined : kh('newWs'), run: () => newIn(p) },
      ...(!p.kind && termsOk ? [{ label: 'New terminal', icon: 'terminal', key: 't', hint: termWhere(p), run: () => termIn(p) } as MenuItem] : []),
      ...(p.kind ? [] : [{ label: 'Open project page', icon: 'info', key: 'o', run: () => setDialog({ project: p.id }) } as MenuItem]),
      { label: 'Open in', icon: 'code', key: 'i', items: openInItems({ project: p.id }) },
      { label: 'Add a group', icon: 'sep', run: () => setDialog({ sep: p.id }) },
      { label: folded.includes(p.id) ? 'Expand' : 'Collapse', icon: folded.includes(p.id) ? 'chevron' : 'chevronRight', run: () => fold(p.id) },
      { label: 'Notes', icon: 'file', key: 'n', hint: p.notes?.trim() ? undefined : 'none yet', run: () => setDialog({ notes: p.id }) },
      { label: 'Color', icon: 'palette', items: [{ colors: TAB_COLORS, value: p.color, pick: c => call('projectSet', { id: p.id, color: c }) }] },
      ...iconItems(p.icon, icon => call('projectSet', { id: p.id, icon: icon ?? '' })),
      ...(p.kind ? [] : sortItems(p.sort ?? 'manual', sort => call('projectSet', { id: p.id, sort: sort ?? 'manual' }))),
      null,
      ...(p.kind ? [] : [{ label: 'Settings', icon: 'settings', key: 's', run: () => setDialog({ project: p.id, tab: 'settings' }) } as MenuItem]), // its page's Settings tab; Terminals and Browsers have none
      { label: 'Scheduled tasks…', icon: 'clock', hint: tasksOf(p.id), run: () => setDialog({ schedules: p.id }) },
      { label: 'Remove project', icon: 'trash', key: 'd', danger: true, run: () => void ask(`Remove project ${p.name}?`, { text: 'Its workspaces leave Laki; its files stay.', ok: 'Remove', danger: true }).then(y => void (y && call('projectRm', { id: p.id }).then(() => done(`Removed project ${p.name}`), () => {}))) },
      ...(archived.length ? [null, { head: 'Archived' }, ...archived.map(w => ({ label: wsName(w), icon: 'restore' as IconName, hint: 'restore', run: () => restore(w.id) }))] : []),
    ]
  }

  const palette: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = []
    const a = (x: Action) => items.push({ ...x, hint: x.hint ?? 'action' })
    // For <workspace>: its next step, only the ones that apply
    if (ws) {
      const wt = view!.tabs.filter(t => t.workspace === ws.id)
      const f = (x: Action) => items.push({ ...x, kind: 'for' })
      const asks = wt.find(t => t.status === 'waiting')
      if (asks) f({ label: `Answer ${asks.name}: ${asks.ask?.question || asks.ask?.options.map(o => o.label).join(' / ') || 'it waits for you'}`, icon: 'bell', run: () => selectTab(asks) })
      const pr = ws.pr?.state === 'OPEN' ? ws.pr : undefined
      if (pr?.checks === 'fail') f({ label: `Fix CI: send #${pr.number}'s failing checks to the agent`, icon: 'ciFail', run: () => void prFix(ws, 'ci') })
      if (pr?.conflict) f({ label: `Resolve conflicts with ${pr.base ?? 'the base'}`, icon: 'conflict', run: () => void prFix(ws, 'conflict') })
      if (pr && !pr.draft && pr.checks === 'pass' && !pr.conflict && pr.ready !== false && allows(ws, 'merge')) f({ label: `Merge #${pr.number}…`, icon: 'pr', run: () => prAct(ws, 'merge') })
      if (ws.kind === 'worktree' && !ws.pr && (ws.stat ? ws.stat.files > 0 || ws.stat.dirty > 0 : wt.some(t => t.kind === 'agent' && t.last))) f({ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') })
      if (git && wt.some(t => t.kind === 'agent' && t.done && t.status === 'idle')) f({ label: 'Review changes: the agent is done', icon: 'changes', run: () => showPanel('changes') })
    }
    // Needs you: every other tab of needsYou, in its order
    for (const t of needsSorted(needing)) {
      const w = t.workspace !== ws?.id && live.find(w => w.id === t.workspace)
      if (w) items.push({ label: t.status === 'waiting' ? `Answer ${wsName(w)}: ${t.ask?.question || t.ask?.options[0]?.label || 'it waits for you'}` : `${wsName(w)} is done`, hint: t.name, glyph: tabGlyph(t), kind: 'needs', mark: <ProjectMark p={projOf(w)} />, run: () => selectTab(t) })
    }
    if (ws) a({ label: 'Find files…', icon: 'search', hint: kh('files'), run: () => setDialog('files') })
    for (const w of order) items.push({ kind: 'ws', more: () => wsMenu(w), label: wsName(w), hint: [(f => f.kind !== 'branch' && f.text)(rowFact(w, view!.tabs.filter(t => t.workspace === w.id))), w.branch || 'folder', prNum(w)].filter(Boolean).join(' · '), glyph: rollup(view!.tabs.filter(t => t.workspace === w.id)), mark: <ProjectMark p={projOf(w)} />, run: () => setWsId(w.id) })
    for (const t of view?.tabs ?? []) {
      const w = live.find(w => w.id === t.workspace)
      if (w) items.push({ kind: 'tab', more: () => tabMenu([t.id]), label: `${wsName(w)} / ${t.name}`, hint: t.last ? t.last.slice(0, 80) : 'tab', glyph: tabGlyph(t), mark: <ProjectMark p={projOf(w)} />, run: () => selectTab(t.id) })
    }
    a({ label: 'Next tab that needs you', icon: 'bell', hint: kh('next'), run: nextNeed })
    for (const { w, m } of extMenus('palette', ws)) a({ label: `${w.name}: ${m.title}`, icon: 'panel', hint: m.key ? keyText(m.key) : 'extension', run: () => void extRun(w, m, hereCtx()) })
    a({ label: full ? 'Exit full screen' : 'Full screen: just this tab', icon: full ? 'minimize' : 'maximize', hint: kh('full'), run: () => toggleFull() })
    if (aiOn(settings)) a({ label: 'Ask Laki AI later…', icon: 'timer', run: () => sendLater('ai') })
    if (aiOn(settings) && settings.ai?.float !== false && aiDock) a({ label: 'Float the Laki AI button again', icon: 'popOut', run: () => dock(false) }) // minimized: where no status bar shows it too
    if (ws?.storage) a({ label: gallery === ws.id ? 'Hide artifacts' : 'Show artifacts', icon: 'image', hint: kh('artifacts'), run: toggleArtifacts })
    for (const race of new Set(live.flatMap(w => (w.race ? [w.race] : [])))) {
      const w = live.find(w => w.race === race)!
      a({ label: `Compare the race: ${wsName(w).replace(/-[^-]+$/, '')}`, icon: 'race', run: () => setDialog({ compare: race }) })
    }
    a({ label: 'New workspace', icon: 'plus', hint: kh('newWs'), run: () => newWs(ws?.project) })
    a({ label: 'Open project folder…', icon: 'folderPlus', hint: '⌘O', run: openProject })
    a({ label: 'New terminal (in your home folder)', icon: 'terminal', run: () => quickNew('shells') })
    a({ label: 'Get started: the first steps', icon: 'check', run: () => (setOnboard(o => ({ ...o, off: false })), setDialog('onboard')) })
    a({ label: 'New browser', icon: 'globe', run: () => quickNew('browsers') })
    a({ label: 'Open a project over SSH…', icon: 'server', run: () => setDialog('project') })
    a({ label: 'Settings', icon: 'gear', hint: kh('settings'), run: () => setDialog('settings') })
    a({ label: 'Themes: change how Laki looks', icon: 'palette', run: () => setDialog({ section: 'appearance', spot: 'Theme' }) }) // Settings › Appearance, at its Theme card, lit
    a({ label: 'Scheduled tasks', icon: 'clock', run: () => setDialog('schedules') })
    a({ label: 'Board: every workspace by where it is, and to-dos', icon: 'board', run: () => setDialog('board') })
    if (!achKept.off) a({ label: 'Achievements: what to try next', icon: 'trophy', run: () => setDialog('achievements') })
    if (specsOn) a({ label: 'Specs & Brainstorms: requirements to implement, ideas to explore', icon: 'spec', run: () => setDialog({ specs: '' }) })
    if (flowsOn) a({ label: 'Workflows: blocks Laki runs for a task, and their runs', icon: 'flow', run: () => setDialog({ workflows: '' }) })
    // Run workflow: each one, in the selected workspace (none, or one it can't run in: the Run sheet asks)
    const flowWs = flowsOn && ws && flowMenu(ws).length ? ws : undefined
    if (flowsOn) for (const f of flowWs ? flowsHere(flowWs) : flowItems) if (!f.problems.length) a({ label: `Run workflow: ${f.name}`, icon: 'flow', hint: flowWs ? wsName(flowWs) : 'workflow', run: () => runFlow(f, flowWs?.id) })
    if (settings.birdView !== false) a({ label: 'Bird view: every live session and its screen', icon: 'eye', run: () => setDialog('bird') })
    if (settings.calendar === true) a({ label: 'Calendar: scheduled tasks and reminders by week or month', icon: 'calendar', run: () => setDialog('calendar') })
    if (settings.desk !== false) a({ label: 'My Desk: your extensions as tiles, an overview of what is going on', icon: 'desk', run: () => setDialog('desk') })
    if (settings.notes === true) a({ label: 'Notes: your own, for any project', icon: 'note', run: () => setDialog({ note: '' }) })
    if (settings.todoList === true) a({ label: 'To-dos: your checklist', icon: 'listChecks', run: () => setDialog('todos') })
    if (aiOn(settings)) a({ label: 'AI: ask Laki to work your agents, and what it cost', icon: 'ai', run: () => setDialog('ai') })
    if (settings.devMode) a({ label: "Release notes: what's new in Laki", icon: 'file', run: () => setDialog({ section: 'notes' }) })
    for (const w of view?.widgets ?? []) if (w.on && w.full && (!w.project || w.project === ws?.project)) a({ label: `Extension: ${w.name}`, icon: 'panel', run: () => setDialog({ widget: w.id }) })
    a({ label: 'Extensions (plugins): settings, reload, delete', icon: 'panel', run: () => setDialog({ section: 'widgets' }) })
    if (aiOn(settings)) a({ label: 'New extension…: make one with Laki AI in the studio', icon: 'plus', run: () => setDialog({ studio: '' }) })
    a({ label: 'New extension from a starter…: each one shown on its sample data', icon: 'plus', run: () => setDialog('starters') })
    a({ label: 'UI kit: the elements an extension is made of, each with its JSON', icon: 'panel', run: () => setDialog({ uikit: true }) })
    a({ label: 'Icons: every icon an extension can use, by name', icon: 'smile', run: () => setDialog({ uikit: true, icons: true }) })
    a({ label: 'Resources: memory and CPU by tab', icon: 'memory', run: () => setDialog({ section: 'resources' }) })
    a({ label: 'Help: keys and commands', icon: 'help', hint: kh('help'), run: () => setDialog('help') })
    a({ label: 'About Laki', icon: 'info', run: () => setDialog('about') })
    a({ label: 'Collapse all projects', icon: 'chevronRight', run: () => setFolded(view?.projects.map(p => p.id) ?? []) })
    a({ label: 'Expand all projects', icon: 'chevron', run: () => setFolded([]) })
    a({ label: sideOpen ? 'Hide sidebar' : 'Show sidebar', icon: 'sidebar', hint: kh('sidebar'), run: () => setSideOpen(o => !o) })
    a({ label: video ? 'Another YouTube video…' : 'Watch a YouTube video…', icon: 'youtube', run: () => setDialog('video') })
    if (video) a({ label: 'Close the video', icon: 'x', run: () => setVideo(null) })
    const ticking = timers.filter(t => t.then !== 'remind').length // reminders stay
    if (ticking) a({ label: ticking > 1 ? 'Stop all timers' : 'Stop the timer', icon: 'stop', run: () => setTimers(l => l.filter(t => t.then === 'remind')) })
    a({ label: 'Start a timer…', icon: 'timer', run: () => setDialog('timer') })
    if (ws) a({ label: `Remind me about ${wsName(ws)}…`, icon: 'timer', run: () => setDialog({ remind: ws.id }) })
    a({ label: find ? 'Stop filtering the sidebar' : 'Filter the sidebar…', icon: 'filter', run: () => (setSideOpen(true), setFind(f => (f ? null : { q: '' }))) })
    if (!view?.remote) {
      // the way Settings has it: Laki's PIN, or the saved email
      if (settings.remoteAuth === 'tailscale') a({ label: `Start remote access ${settings.remoteFunnel ? 'on the internet (Tailscale Funnel)' : 'on your tailnet'}, 1 hour`, icon: 'link', run: () => (call('remoteStart', { hours: 1, via: 'tailscale', pin: !!(settings.remoteTsPin || settings.remoteFunnel), funnel: !!settings.remoteFunnel }).catch(() => {}), setDialog({ section: 'remote' })) })
      else if (settings.remoteAuth === 'pin') a({ label: 'Start remote access with a PIN, 1 hour', icon: 'link', run: () => (call('remoteStart', { hours: 1, pin: true }).catch(() => {}), setDialog({ section: 'remote' })) })
      else if (settings.remoteMail) a({ label: `Start remote access for ${settings.remoteMail}, 1 hour`, icon: 'link', run: () => (call('remoteStart', { hours: 1, mail: settings.remoteMail }).catch(() => {}), setDialog({ section: 'remote' })) })
      a({ label: 'Remote access…', icon: 'link', run: () => setDialog({ section: 'remote' }) })
    } else {
      a({ label: 'Remote access: the link and QR code', icon: 'link', run: () => setDialog({ section: 'remote' }) })
      a({ label: 'Stop remote access', icon: 'stop', danger: true, run: () => call('remoteStop').catch(() => {}) })
    }
    a({ label: `Turn macOS notifications ${settings.notify === false ? 'on' : 'off'}`, icon: 'bell', run: () => call('settingsSet', { notify: settings.notify === false }).catch(() => {}) })
    if (ws) {
      newTabActions.forEach(x => a({ ...x, label: `New tab: ${x.label}` }))
      for (const x of targets) a({ label: `Open in ${x.name}`, icon: appIcon(x.id), hint: x.id === editor ? '⌘E' : undefined, run: () => openIn(x.id) })
      a({ label: `Open localhost:${ws.port} ($PORT)`, icon: 'link', run: () => openPort(ws.port) })
      a({ label: 'Files', icon: 'file', hint: kh('panel'), run: () => showPanel('files') })
      if (git) a({ label: 'Changes', icon: 'changes', hint: '⌘D', run: () => showPanel('changes') })
      if (git) a({ label: 'Review: PR checks and comments', icon: 'review', run: () => showPanel('review') })
      a({ label: 'Workspace info', icon: 'info', hint: kh('info'), run: () => showInfo(true) })
      if (tab) a({ label: "Copy the tab's contents: its whole terminal as text", icon: 'copy', run: () => copyTab(tab) })
      if (tab && bridge?.floatTab) a(floated.includes(tab.id) ? { label: 'Bring the tab back from its own window', icon: 'popIn', run: () => floatTab(tab.id, false) } : { label: 'Float the tab in its own window', icon: 'popOut', run: () => floatTab(tab.id) })
      a({ label: ws.run ? 'Run the run script' : 'Set a run script…', icon: 'run', run: ws.run ? run : editScripts })
      if (devRunning) a({ label: 'Stop the run script', icon: 'stop', run: () => api.send('input', { tab: devTab!.id, data: '\x03' }) })
      for (const k of ws.scripts ?? []) a({ label: `Run the ${k} script`, icon: SCRIPT_ICONS[k], run: () => runScript(ws, k) })
      if (ws.kind === 'worktree') a({ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') })
      wsActions.forEach(a)
      if (previewed) a({ label: 'Close the file preview', icon: 'x', hint: kh('closeTab'), run: closePreview })
      if (tab) a({ label: `Close ${tab.name}`, icon: 'x', hint: previewed ? undefined : kh('closeTab'), run: () => closeTabs([tab]) })
      if (ws.pr) a({ label: `Open PR #${ws.pr.number}`, icon: 'pr', run: () => openExternal(ws.pr!.url) })
      for (const p of ws.ports) a({ label: `Open localhost:${p}`, icon: 'link', run: () => openExternal(`http://localhost:${p}`) })
      if (project && !project.kind) a({ label: `Project settings: ${project.name}`, icon: 'settings', run: () => setDialog({ settings: project.id }) })
    }
    for (const w of view?.workspaces.filter(w => w.archived) ?? []) a({ label: `Restore ${wsName(w)}`, icon: 'restore', hint: 'archived', run: () => restore(w.id) })
    // the default account for new sessions (Settings › Agents & profiles)
    for (const agent of ['claude', 'codex'] as const)
      for (const x of accountsOf(agent))
        if ((settings.accountUse?.[agent] ?? HOME_ACCOUNT) !== x.id) a({ label: `Switch ${AGENT_NAMES[agent]} to ${x.name}`, icon: 'agent', hint: 'new sessions', run: () => call('settingsSet', { accountUse: { ...settings.accountUse, [agent]: x.id } }).then(() => toast(`New ${AGENT_NAMES[agent]} sessions start on ${x.name}`, undefined, undefined, true), () => {}) })
    return items
  }, [view, live, ws, tab, group, sideOpen, apps, previewed, video, timers.length, find, gallery, full, aiDock])

  const pinning = pinAsk && !connected
  if (!view)
    return (
      <div className={`splash ${pinning ? 'pinning' : ''}`}>
        {pinning ? <PinForm left={pinAsk.left} /> : <Loading connected={connected} />}
        {problem && !connected && <div className="splash-problem">{problem}</div>}
      </div>
    )

  const settingsFor = dialog && typeof dialog === 'object' && 'settings' in dialog ? view.projects.find(p => p.id === dialog.settings) : undefined
  const section = dialog && typeof dialog === 'object' && 'section' in dialog ? dialog.section : undefined // a Settings section asked for
  const schedulesFor = schedulesOf(dialog)
  const ports = ws ? portsOf(ws.ports, ws.tunnels).filter(p => p !== ws.port || !!project?.kind) : [] // $PORT has its own, always (a terminal: none, its ports as any)
  // ✕ beside a port something of the workspace listens on: stops it, once you say so
  const portStop = (ws: WorkspaceView, port: number) => {
    const p = ws.procs?.[port]
    if (!p) return null
    const stop = async () => {
      if (!(await ask(`Stop ${p.cmd} (pid ${p.pid}) on :${port}?`, { text: 'SIGTERM first, SIGKILL after 3 seconds if it is still running.', ok: 'Stop', danger: true }))) return
      call('portKill', { ws: ws.id, port }).catch(() => {})
    }
    return (
      <button className="port-stop" data-tip={`stop ${p.cmd} (pid ${p.pid})`} aria-label={`stop ${p.cmd} on port ${port}`} onClick={stop}>
        <Icon name="x" size={10} />
      </button>
    )
  }
  const nextTask = (view.schedules ?? []).filter(s => s.on && s.next).sort((a, b) => a.next! - b.next!)[0]
  const runs = view.runs ?? [] // newest first: the ones above the last read
  const seen = runs.findIndex(r => r.id === runsSeen)
  const runFailed = runs.slice(0, seen < 0 ? undefined : seen).some(r => !r.ok) // the clock gets a dot
  const labels = settings.sideLook?.labels !== false // words beside the sidebar's bottom buttons
  const portUp = !!ws?.ports.includes(ws.port)
  const label = (id: string) => {
    const t = byId(id)
    return (
      t && (
        <>
          <Glyph s={tabGlyph(t)} />
          <span>{t.name}</span>
        </>
      )
    )
  }
  // a folded project's or sep's busiest workspace state (a setup script counts as running, as on its row)
  const busiest = (list: WorkspaceView[]) => rollup([...view.tabs.filter(t => list.some(w => w.id === t.workspace)), ...(list.some(w => w.setup) ? [{ status: 'running' } as TabView] : [])])
  // a workspace's row: under its project, or under Pinned (with its project's name; no drag there: pins keep the
  // sidebar's order)
  const sideStyle = settings.sideStyle ?? 'default'
  const more = sideStyle === 'extended' || sideStyle === 'cards' // a second line under each row
  const words = sideStyle === 'words' // a second line in words (text.ts rowFact), one PR pill for the marks
  const pctSide = settings.progressAt === 'sidebar' || settings.progressAt === 'both' // an agent's percent on its row (the second line has its own)
  const upWs = wsAt(-1)?.id
  const downWs = wsAt(1)?.id
  // where ⌘J goes: the Needs you list's card when it shows, else its workspace's row
  const needNext = (need => need[(need.findIndex(t => t.id === tab?.id) + 1) % need.length])(needsSorted(needing))
  const needsShown = !find && (!rail || railKind === 'projects') && settings.needsList !== false && !folded.includes('needs')
  const needWs = needsShown ? undefined : needNext?.workspace
  const wsRow = (w: WorkspaceView, pin = false) => {
    const wt = view.tabs.filter(t => t.workspace === w.id)
    const queued = wt.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
    const state = more ? rollup(wt) : 'idle' // the second line's
    const status = sideStyle === 'status' // an edge in its state's color, a line that fills with its agents' progress
    const pct = status ? Math.max(-1, ...wt.map(t => t.progress?.pct ?? -1)) : -1
    const pc = projOf(w)?.color // its bar's color where it has none of its own (styles.css' --ws-bar)
    const moves = [w.id === upWs && '⌘↑', w.id === downWs && '⌘↓', w.id === needWs && kh('next')].filter(Boolean).join(' ') // the hold-⌘ overlay's
    const yes = words ? null : prMarks(w.pr)
    const fact = words ? rowFact(w, wt) : undefined
    const pill = words && w.pr && settings.prIcon !== false ? prPill(w.pr) : undefined
    const last = sideStyle === 'cards' ? wt.find(t => t.kind === 'agent' && t.last)?.last?.trim().replace(/\s+/g, ' ').slice(0, 300) : undefined // a card's: the agent's last answer
    return (
      <div
        key={w.id}
        className={`ws ${w.id === ws?.id ? 'sel' : ''} ${going[w.id] ? 'going' : ''} ${wt.some(needsYou) ? 'needs' : ''} ${dropOn === w.id ? 'drop-on' : ''} ${rows.at('ws', w.id)}`}
        style={{ ...colorVar(w.color), ...(pc && ({ '--proj-c': `var(--tc-${pc})` } as CSSProperties)), ...(pct >= 0 && ({ '--p': `${pct}%` } as CSSProperties)) }}
        data-state={status ? (w.setup || going[w.id] ? 'running' : rollup(wt)) : undefined}
        data-row={`ws:${w.id}`}
        data-keys={moves || undefined}
        data-group={pin ? 'pinned' : w.project}
        onPointerDown={e => (clearTimeout(peekTimer.current), setPeek(null), !pin && !find && rows.start(e, 'ws', w.id, w.project)) /* filtered: the order isn't all there */}
        onPointerEnter={e => e.pointerType === 'mouse' && !e.buttons && !narrow && !view.projects.find(p => p.id === w.project)?.kind && peekAt(w.id, e.currentTarget) /* Terminals and Browsers: no port, PR or agent to tell of */}
        onPointerLeave={() => peekAt()}
        onClick={() => (setWsId(w.id), (!pin && !find && rows.dragged()) || setDialog(null), narrow && setSideOpen(false)) /* a page over the main area (Settings, the new-workspace page…) gives way to it, not to a drag's end */}
        onContextMenu={e => openMenu(e, wsMenu(w))}
        {...dropProps(w)}
      >
        {w.browser !== undefined ? <Icon name="globe" size={11} /> /* a page: no tabs */ : <Glyph s={w.setup || going[w.id] ? 'running' : w.pending && !wt.length ? 'idle' /* its agent comes later: not ended */ : rollup(wt)} />}
        {marksAt === 'start' && yes}
        <span className="ws-name">{wsName(w)}</span>
        {marksAt === 'name' && yes}
        {going[w.id] && <span className="ws-going">{going[w.id]}…</span>}
        {pin && <span className="ws-proj">{view.projects.find(p => p.id === w.project)?.name}</span>}
        {queued > 0 && <span className="badge">+{queued}</span>}
        {dropOn === w.id && <span className="ws-drop">to {dropAgent(w)?.name ?? 'a new agent'}</span>}
        <span className="spacer" />
        {pctSide && !more && !words && settings.progressLook !== 'bar' && (top => top >= 0 && <span className="tab-pct" style={{ '--p': `${top}%` } as CSSProperties} data-tip={wt.filter(t => t.progress).map(t => `${t.name}: ${t.progress!.pct}%${t.progress!.note ? `, ${t.progress!.note}` : ''}`).join(' · ')}>{top}%</span>)(Math.max(-1, ...wt.map(t => t.progress?.pct ?? -1)))}
        {settings.timers && <TurnTime tabs={wt} />}
        {w.stat && (w.stat.add > 0 || w.stat.del > 0) && settings.diffStat === true && (
          <span className="ws-stat">
            <span className="add">+{short(w.stat.add)}</span>
            <span className="del">−{short(w.stat.del)}</span>
          </span>
        )}
        <RowMarks widgets={(view.widgets ?? []).filter(x => !x.project || x.project === w.project)} ws={w.id} api={widgetApi} />
        {w.muted && (
          <span className="ws-mark">
            <Icon name="bellOff" size={11} />
          </span>
        )}
        {w.pending && (
          <span className={`ws-mark ${w.pending.failed ? 'err' : ''}`} data-tip={`${w.pending.agent}: ${pendingWords(w.pending, true).replace(/^S/, 's')}`}>
            <Icon name="clock" size={11} />
          </span>
        )}
        {timers.some(t => t.then === 'remind' && t.ws === w.id) && (
          <span className="ws-mark">
            <Icon name="timer" size={11} />
          </span>
        )}
        {w.race && (
          <span className="ws-sched">
            <Icon name="race" size={11} />
          </span>
        )}
        {w.codespace !== undefined && ( // a cloud workspace: its codespace's state, unless it's on
          <span className={`ws-sched ws-cs ${w.csState === 'Failed' ? 'bad' : ''}`} data-tip={`Codespace ${w.codespace || '(being made)'}: ${csWord(w.csState)}${w.csError ? ` · ${w.csError}` : ''}`}>
            <Icon name="cloud" size={11} />
            {w.csState !== 'Available' && csWord(w.csState)}
          </span>
        )}
        {w.schedule && (
          <span className="ws-sched">
            <Icon name="clock" size={11} />
          </span>
        )}
        {w.flow && flowsOn && (
          <span className="ws-sched" data-tip={(f => (f ? `Workflow ${f.name}: ${f.status}${f.block ? ` · ${f.block}` : ''}` : 'From a workflow run'))(view.flows?.find(f => f.id === w.flow))}>
            <Icon name="flow" size={11} />
          </span>
        )}
        {pill && (
          <span className={`ws-pill t-${pill.tone}`} data-tip={`PR #${w.pr!.number}${w.pr!.title ? `: ${w.pr!.title}` : ''}`}>
            {pill.text}
          </span>
        )}
        {!words && w.pr?.conflict && w.pr.state === 'OPEN' && settings.prIcon !== false && (
          <span className="ws-pr conflict" data-tip={`PR #${w.pr.number} has merge conflicts`}>
            <Icon name="conflict" size={11} />
          </span>
        )}
        {!words && w.pr?.checks === 'fail' && w.pr.state === 'OPEN' && settings.prIcon !== false && (
          <span className="ws-pr ci" data-tip={(n => `PR #${w.pr!.number}: ${n ? `${n} failing check${n > 1 ? 's' : ''}` : 'CI is failing'}`)(w.pr.list?.filter(c => c.state === 'fail').length)}>
            <Icon name="ciFail" size={11} />
          </span>
        )}
        {settings.archiveMerged && w.kind === 'worktree' && w.pr?.state === 'MERGED' && (
          <span className="ws-merged" data-tip={`PR #${w.pr.number} merged; not archived: changes, an agent at work, or an Undo`}>
            merged
          </span>
        )}
        {marksAt === 'end' && yes}
        {!words && w.pr && settings.prIcon !== false && (
          <span className={`ws-pr ${prState(w.pr)}`} /* failing checks: their own mark, before it; red here is a closed PR */>
            {(!w.pr.mine || settings.ownAvatar !== false) && <Avatar login={w.pr.author} size={16} />}
            <Icon name="github" size={11} />
          </span>
        )}
        {/* on hover, after the marks (they slide left): its menu */}
        <span className="ws-acts" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <IconButton icon="more" title="Workspace" onClick={e => openMenu(e, wsMenu(w))} />
        </span>
        {more && (
          <div className="ws-sub">
            {(w.branch || w.kind !== 'worktree') && <span className="ws-branch">{w.branch || 'folder'}</span>}
            <span className={`ws-state g-${state}`}>{w.setup ? 'setting up' : (STATE_WORDS[state] ?? state)}</span>
            {wt.map(t => t.progress && <span key={t.id}>{t.progress.pct}%</span>)}
            {w.pr && <span className="ws-sub-pr">#{w.pr.number} {w.pr.title}</span>}
            {w.stat && (w.stat.add > 0 || w.stat.del > 0) && (
              <span className="ws-stat">
                <span className="add">+{short(w.stat.add)}</span>
                <span className="del">−{short(w.stat.del)}</span>
              </span>
            )}
          </div>
        )}
        {fact && (
          <div className={`ws-sub ws-fact t-${fact.tone}`} data-tip={fact.text.length > 40 ? fact.text : undefined}>
            <span>{w.setup ? 'Setting up' : fact.text}</span>
            {!w.setup && fact.since && <Elapsed since={fact.since} />}
            {!w.setup && fact.note && <span className="ws-fact-note">· {fact.note}</span>}
          </div>
        )}
        {sideStyle === 'cards' && last && <div className="ws-last">{last}</div>}
        {status && <span className={`ws-line ${pct >= 0 ? 'pct' : ''}`} />}
        {!status && pctSide && settings.progressLook && settings.progressLook !== 'pct' && (top => top >= 0 && <span className="ws-line pct" style={{ '--p': `${top}%` } as CSSProperties} />)(Math.max(-1, ...wt.map(t => t.progress?.pct ?? -1))) /* the status style's line, filling as it goes */}
      </div>
    )
  }
  // an open PR's marks (settings.prMarks, each unset on): ✓ approved, ✓✓ approved by you too, 👀 you commented
  const marksAt = settings.prMarks?.at ?? 'end'
  const prMarks = (pr?: PR) => {
    const m = settings.prMarks ?? {}
    if (!pr || pr.state !== 'OPEN') return null
    const ok = pr.review === 'APPROVED' || (!pr.review && !!pr.approved?.length) // GitHub's decision; none required: any approval
    const two = ok && pr.approvedByMe && m.mine !== false
    const one = ok && !two && m.approved !== false
    const eyes = pr.commentedByMe && m.commented !== false
    if (!one && !two && !eyes) return null
    return (
      <span className="ws-yes">
        {(one || two) && (
          <span data-tip={`PR #${pr.number} approved${pr.approved?.length ? ` by ${pr.approved.join(', ')}` : ''}${two ? ' (you too)' : ''}`}>
            <Icon name={two ? 'checks' : 'check'} size={11} />
          </span>
        )}
        {eyes && (
          <span className="ws-eyes" data-tip={`You commented on PR #${pr.number}`}>
            👀
          </span>
        )}
      </span>
    )
  }
  // the card over a row (peek): its state and agents, the agent's last answer, its PR (author, checks, review, lines),
  // its changes, ports and marks; Open, the PR on GitHub, its menu
  const peekCard = (w: WorkspaceView) => {
    const wt = view.tabs.filter(t => t.workspace === w.id)
    const agents = wt.filter(t => t.kind === 'agent')
    const st = w.setup || going[w.id] ? 'running' : rollup(wt)
    const last = agents.find(t => t.status === 'waiting' && t.ask)?.ask?.options.map(o => o.label).join(' / ') || agents.find(t => t.last)?.last?.trim().replace(/\s+/g, ' ').slice(0, 400)
    const pr = w.pr
    const marks = [
      w.schedule && `from the scheduled task ${view.schedules?.find(s => s.id === w.schedule)?.name ?? ''}`.trimEnd(),
      w.race && 'in a race: ⋯ › Compare the race',
      w.muted && 'notifications muted',
      w.pending && `${w.pending.agent}: ${pendingWords(w.pending, true).replace(/^S/, 's')}`,
      ...wt.filter(t => t.queue?.length).map(t => `${t.queue!.length} queued for ${t.name}`),
      ...timers.filter(t => t.then === 'remind' && t.ws === w.id).map(t => `a reminder at ${new Date(t.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      w.ports.length > 0 && `listening on ${w.ports.map(p => `:${p}`).join(' ')}`,
    ].filter(Boolean)
    return (
      <div className="ws-peek" ref={peekBox} style={{ top: peek!.top, left: peek!.left, ...colorVar(tint(w)) }} onPointerEnter={() => clearTimeout(peekTimer.current)} onPointerLeave={() => peekAt()}>
        <div className="wp-head">
          <Glyph s={st} />
          <b>{wsName(w)}</b>
          <span className="muted">{view.projects.find(p => p.id === w.project)?.name}</span>
        </div>
        <div className="wp-branch">
          {w.branch || shortPath(w.path)} · $PORT {w.port}
        </div>
        <div className="wp-agents">
          <span className={`g-${st}`}>{w.setup ? 'setting up' : (STATE_WORDS[st] ?? st)}</span>
          {agents.map(t => (
            <span key={t.id} className="muted">
              {t.name}
              {t.progress ? ` ${t.progress.pct}%` : ''}
              {settings.timers && <TurnTime tabs={[t]} />}
            </span>
          ))}
        </div>
        {last && <div className="wp-last">{last}</div>}
        {pr && (
          <div className="wp-pr">
            <a href={pr.url} onClick={e => (e.preventDefault(), openExternal(pr.url))}>
              {(!pr.mine || settings.ownAvatar !== false) && <Avatar login={pr.author} size={16} />}
              <span className={`wp-pr-state ${prState(pr)}`}>{prState(pr)}</span>
              <span className="wp-pr-title">
                #{pr.number} {pr.title}
              </span>
            </a>
            <div className="wp-pr-meta">
              {pr.author && !pr.mine && <span>by {pr.author}</span>}
              {pr.list?.length || pr.checks ? <span className={`ci-${pr.checks}`}><CiMark pr={pr} /></span> : null}
              {pr.review && REVIEW[pr.review] && <span>{REVIEW[pr.review]}</span>}
              {pr.conflict && pr.state === 'OPEN' && <span className="ci-fail">conflicts</span>}
              {(pr.additions || pr.deletions) ? <span className="ws-stat"><span className="add">+{short(pr.additions ?? 0)}</span> <span className="del">−{short(pr.deletions ?? 0)}</span></span> : null}
              {w.prLinked && <span>linked</span>}
            </div>
            {reviewersText(pr) && <div className="wp-pr-meta">{reviewersText(pr)}</div>}
          </div>
        )}
        {w.stat && (w.stat.add > 0 || w.stat.del > 0 || w.stat.dirty > 0) && <div className="wp-line">{statText(w)}</div>}
        {marks.map(m => (
          <div key={String(m)} className="wp-line">
            {m}
          </div>
        ))}
        {(xs => xs.length > 0 && <div className="wp-line wp-ext"><RowMarks widgets={xs} ws={w.id} api={{ ...widgetApi, full: (id, at) => (setPeek(null), widgetApi.full(id, at)) }} /></div>)(rowMarks((view.widgets ?? []).filter(x => !x.project || x.project === w.project), w.id))}
        <div className="wp-acts">
          <button onClick={() => (setPeek(null), setWsId(w.id), setDialog(null))}>Open</button>
          {pr && <button onClick={() => openExternal(pr.url)}>PR #{pr.number} on GitHub</button>}
          <span className="spacer" />
          <IconButton icon="more" title="Workspace" onClick={e => openMenu(e, wsMenu(w))} />
        </div>
      </div>
    )
  }
  // a sep (a group, as the app calls it): a named head over a project's workspaces up to the next one, dragged like a
  // row; a workspace dropped on it goes first under it. n: how many it holds; folded (a click) it hides them: hid,
  // their busiest state on it
  // the sidebar's filter: does it show this one
  const shows = (w: WorkspaceView) => {
    if (!find) return true
    const q = find.q.trim().toLowerCase()
    const wt = view.tabs.filter(t => t.workspace === w.id)
    if (q && ![wsName(w), w.name, w.branch, w.pr?.title, w.pr?.author, prNum(w)].some(x => x?.toLowerCase().includes(q))) return false
    return find.only === 'needs' ? wt.some(needsYou) : find.only === 'busy' ? !!w.setup || wt.some(t => spins(t)) : find.only === 'pr' ? !!w.pr : true
  }
  const found = find && live.filter(shows).length
  const sepRow = (p: Project, s: Sep, n: number, hid: WorkspaceView[] = []) => {
    const shut = folded.includes(s.id)
    const sum = hid.length ? busiest(hid) : 'idle'
    return (
      <div
        key={s.id}
        className={`ws-sep ${s.color && s.color !== 'none' ? 'tinted' : ''} ${rows.at('ws', s.id)}` /* not .ws: the looks' workspace styles stay off it */}
        style={colorVar(s.color)}
        data-row={`ws:${s.id}`}
        data-group={p.id}
        data-head=""
        data-tip={`${s.name}: ${n} ${n === 1 ? 'workspace' : 'workspaces'}${s.template ? ` · new ones start with the template ${s.template}` : ''} · click to ${shut ? 'expand' : 'collapse'} · drag to move · drop a workspace on it to put it here · double click to rename`}
        onPointerDown={e => rows.start(e, 'ws', s.id, p.id, true)}
        onClick={e => !rows.dragged() && !(e.target as Element).closest('button') && fold(s.id)}
        onDoubleClick={() => setDialog({ sep: p.id, id: s.id })}
        onContextMenu={e => openMenu(e, sepMenu(p, s))}
      >
        <span className="project-chev">
          <Icon name={shut ? 'chevronRight' : 'chevron'} size={11} />
        </span>
        <span className="ws-name">{s.name}</span>
        {sum !== 'idle' && sum !== 'exited' && <Glyph s={sum} />}
        <span className="project-count">{n}</span>
        <span className="ws-acts" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          <IconButton icon="plus" title={termsOk ? `New workspace or terminal in ${s.name || 'this group'}` : `New workspace in ${s.name || 'this group'}`} onClick={e => (termsOk ? openMenu(e, plusMenu(p, s.id)) : newWs(p.id, { place: s.id }))} />
          <IconButton icon="more" title="Group" onClick={e => openMenu(e, sepMenu(p, s))} />
        </span>
      </div>
    )
  }
  // a workspace on its way (the new-workspace page's Create): where it will be, with a spinner
  const makingRows = (p: Project, at: string) =>
    making
      .filter(m => m.project === p.id && (p.seps?.some(s => s.id === m.place) ? m.place : '') === at)
      .map(m => (
        <div key={`making-${m.key}`} className="ws making" aria-busy="true" data-tip="being made: the worktree, then its agent">
          <Glyph s="running" />
          <span className="ws-name">{m.name}</span>
          <span className="ws-going">creating…</span>
        </div>
      ))
  // a project's rows as shown: none under a folded sep, the selected one too (each folded sep's in hidden)
  const shownRows = (p: Project, mine: WorkspaceView[]) => {
    const hidden = new Map<string, WorkspaceView[]>()
    const count = new Map<string, number>() // each sep's workspaces
    let sep = ''
    let under = '' // the folded sep above
    const shown = sortedRows(p, mine).filter(x => {
      if (!('path' in x)) return (sep = x.id), (under = folded.includes(x.id) ? x.id : ''), true
      if (sep) count.set(sep, (count.get(sep) ?? 0) + 1)
      if (!under) return true
      hidden.get(under)?.push(x) ?? hidden.set(under, [x])
      return false
    })
    return [...makingRows(p, ''), ...shown.flatMap(x => ('path' in x ? [wsRow(x)] : [sepRow(p, x, count.get(x.id) ?? 0, hidden.get(x.id)), ...makingRows(p, x.id)]))]
  }
  // the tabs: in the top bar (the default), or a strip of their own under the terminals or beside them (Settings ›
  // Appearance; a phone keeps them on top)
  const tabsAt = (!narrow && (['bottom', 'left', 'right'] as const).find(x => x === settings.tabsAt)) || 'top' // an unknown value: top
  const ctxLook = settings.contextMeter === false ? undefined : settings.contextMeter === 'ring' || settings.contextMeter === 'status' ? settings.contextMeter : 'line' // Settings › Appearance: the context meter, and how its tab shows it
  const ctxOn = !!ctxLook
  const costsOn = settings.costs !== false // and what agents used
  const keyOff = reviewTab ? 1 : 0 // the review's tab takes ⌘1
  const tabList = (
    <>
      {reviewTab && (
        <div className={`tab nodrag review-tab ${reviewOn ? 'sel' : ''}`} role="tab" aria-label="Review" onClick={openReview} data-keys="⌘1" data-tip={`Review: ${ws!.stat!.files} file${ws!.stat!.files === 1 ? '' : 's'}, +${ws!.stat!.add} −${ws!.stat!.del}${reviewDot ? ' · changed since you looked' : ''} · ⌘1`}>
          <Icon name="review" size={13} />
          {reviewDot && <i className="review-dot" />}
        </div>
      )}
      {groups.map(g => {
        const ts = tabsOf(g).map(byId).filter((t): t is TabView => !!t)
        const queued = ts.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
        const ctx = ctxOn ? ts.flatMap(t => t.context ?? []).sort((a, b) => ctxPct(b) - ctxPct(a))[0] : undefined // a split's: the fullest
        return (
          <div
            key={ts[0]?.id}
            className={`tab nodrag ${g === group && !reviewOn ? 'sel' : ''}${ts.some(t => t.asleep) ? ' asleep' : ''}${ts.length && ts.every(t => t.kind === 'agent' && t.status === 'exited') ? ' ended' : ''}`}
            style={colorVar(colorOf(ts[0]))}
            onClick={() => selectGroup(g)}
            onDoubleClick={() => ts[0] && setDialog({ rename: ts[0].id })}
            onContextMenu={e => openMenu(e, tabMenu(tabsOf(g)))}
            onPointerDown={e => !narrow && ts[0] && start(e, ts[0].id, true) /* a phone: no splits, tabs in their order */}
            onAuxClick={e => e.button === 1 && closeTabs(ts)}
            data-keys={groups.indexOf(g) + keyOff < 9 ? `⌘${groups.indexOf(g) + 1 + keyOff}` : undefined}
            data-tip={[...ts.filter(t => t.queue?.length).map(t => `${t.name}: ${t.queue!.length} queued, sent as its turn ends`), ...ts.filter(t => t.runs).map(t => `${t.name}: ${t.runs} runs in it (its status read off the screen)`), ...ts.filter(t => t.progress).map(t => `${t.name}: ${t.progress!.pct}% done, its own estimate${t.progress!.note ? `: ${t.progress!.note}` : ''}`), ...(ctxOn ? ts.filter(t => t.context).map(t => `${t.name}'s context: ${ctxText(t.context!)}`) : []), ...(costsOn ? ts.filter(t => t.usage).map(t => `${t.name} used ${usageText(t.usage!)} at API prices`) : []), ...ts.filter(t => t.asleep).map(t => `${t.name} is asleep to free memory: a look resumes it`), ...ts.filter(t => t.share).map(t => `${t.name} is shared as a live view${t.share!.until ? `, ${timeLeft(t.share!.until)} left` : ''} (right click: its link, stop)`), ...ts.filter(t => t.kind === 'agent' && t.status === 'exited').map(t => `${t.name} ended: ⏎ in it starts it again`), ...ts.filter(t => t.model || t.effort).map(t => `${t.name}: ${[t.model, t.effort].filter(Boolean).join(', ')}`), ...ts.filter(t => t.account && t.account !== HOME_ACCOUNT).map(t => `${t.name}: on ${accountsOf(t.preset).find(a => a.id === t.account)?.name ?? 'another account'}`), ...(groups.indexOf(g) + keyOff < 9 ? [`⌘${groups.indexOf(g) + 1 + keyOff}`] : []), 'double click to rename', 'drag to reorder, or onto a pane to split', 'right click for more'].join(' · ')}
          >
            <Glyph s={ts.length > 1 ? rollup(ts) : ts[0] ? tabGlyph(ts[0]) : 'idle'} />
            <span>{ts.map(t => t.name).join(' · ')}</span>
            {settings.progressAt !== 'sidebar' && ts.map(t => t.progress && <span key={t.id} className="tab-pct" style={{ '--p': `${t.progress.pct}%` } as CSSProperties}>{t.progress.pct}%</span>)}
            {settings.timers && <TurnTime tabs={ts} />}
            {ts.some(t => t.muted) && (
              <span className="ws-mark">
                <Icon name="bellOff" size={11} />
              </span>
            )}
            {ts.some(t => t.share) && (
              <span className="ws-mark">
                <Icon name="globe" size={11} />
              </span>
            )}
            {queued > 0 && <span className="badge">+{queued}</span>}
            {ctx && ctxLook === 'line' && <i className={`tab-ctx ${level(ctxPct(ctx))}`} style={{ width: `${ctxPct(ctx)}%` }} />}
            {ctx && ctxLook === 'ring' && <Ring p={ctxPct(ctx)} />}
            <button className="x" data-tip={kt('Close', 'closeTab')} aria-label="Close tab" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => (e.stopPropagation(), closeTabs(ts))}>
              <Icon name="x" size={10} />
            </button>
          </div>
        )
      })}
      {ws && (ws.browser === undefined ? <IconButton icon="plus" title="New tab (⌘⇧N)" className="nodrag newtab-btn" onClick={e => openMenu(e, newTabActions)} /> : <IconButton icon="plus" title={kt('New browser tab', 'newTab')} className="nodrag newtab-btn" onClick={() => quickNew('browsers')} />)}
    </>
  )
  const schedTip = nextTask ? `Scheduled tasks · next: ${nextTask.name ? stamp(nextTask.name, nextTask.next!) : nextTask.prompt.slice(0, 40)}, ${new Date(nextTask.next!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Scheduled tasks'
  const toSchedules = () => setDialog(d => (schedulesOf(d) === undefined ? 'schedules' : null))
  const toBoard = () => setDialog(d => (d === 'board' ? null : 'board'))
  const toSpecs = () => setDialog(d => (specsOf(d) ? null : { specs: '' }))
  const SPECS_TIP = 'Specs & Brainstorms: requirements to implement, ideas to explore with Laki AI'
  const toFlows = () => setDialog(d => (flowsOf(d) ? null : { workflows: '' }))
  const flowsAsk = (view?.flows ?? []).filter(r => r.status === 'waiting').length
  const FLOWS_TIP = `Workflows: blocks Laki runs for a task${flowsAsk ? ` · ${flowsAsk} ask${flowsAsk > 1 ? '' : 's'} you` : ''}`
  const calOn = settings.calendar === true // experimental: Settings › General
  const toCal = () => setDialog(d => (d === 'calendar' ? null : 'calendar'))
  const calSoon = (view?.reminders ?? []).filter(r => !r.done && r.fired).length // rung, not ticked off
  const deskOn = settings.desk !== false // Settings › General › Pages
  const notesOn = settings.notes === true // experimental: Settings › General
  const todosOn = settings.todoList === true // experimental: Settings › General
  const toTodos = () => setDialog(d => (d === 'todos' ? null : 'todos'))
  const toDesk = () => setDialog(d => (d === 'desk' ? null : 'desk'))
  const toNotes = () => setDialog(d => (notesOf(d) ? null : { note: '' }))
  const toAi = () => setDialog(d => (d === 'ai' ? null : 'ai'))
  const AI_TIP = 'AI: ask Laki to start, check and steer your agents'
  const toSettings = () => setDialog(d => (settingsOf(d) ? null : 'settings'))
  const BOARD_TIP = 'Board: every workspace by where it is, and to-dos'
  // an achievement's Show me (achievements.ts' go): where it's done; a page that's off, where it's turned on
  const achGo = (go: string) => {
    const [k, arg, spot] = go.split(':')
    const off: Record<string, boolean> = { workflows: !flowsOn, specs: !specsOn, notes: !notesOn, calendar: !calOn, todos: !todosOn, desk: !deskOn, ai: !aiOn(settings), device: !(view.projects.find(p => p.id === ws?.project)?.config?.simulator ?? settings.simulator === true) }
    const at = k === 'panel' ? arg : k // the Simulator tab: off unless Settings › Simulators (or the project's own) turns it on
    setDialog(null)
    if (off[at]) setDialog(at === 'ai' || at === 'device' ? { section: at === 'ai' ? 'ai' : 'simulator' } : { section: 'general', spot: ['desk', 'workflows', 'specs'].includes(at) ? 'Pages' : 'Experimental' })
    else if (k === 'project') void openProject()
    else if (k === 'new') view.projects.some(p => !p.kind) ? newWs() : void openProject()
    else if (k === 'shells' || k === 'browsers') void quickNew(k)
    else if (k === 'section') setDialog({ section: arg, ...(spot && { spot }) })
    else if (k === 'workflows') setDialog({ workflows: '' })
    else if (k === 'specs') setDialog({ specs: '' })
    else if (k === 'notes') setDialog({ note: '' })
    else if (k === 'panel' || k === 'newtab' || k === 'rename' || k === 'ship') {
      if (!ws || ws.browser !== undefined) toast('Select a workspace first, then try it there')
      else if (k === 'panel') showPanel(arg as PanelTab)
      else if (k === 'rename') setDialog({ renameWs: ws.id })
      else if (k === 'ship') ws.kind === 'worktree' ? setDialog('ship') : toast('Ship needs a worktree: start a workspace first')
      else setTimeout(() => document.querySelector<HTMLElement>('.newtab-btn')?.click(), 50) // its menu, where it is
    } else setDialog(k as Dialog) // a page: help, palette, board, schedules, timer, ai, desk, todos
  }
  const achHidden = achKept.hidden ?? []
  const achAll = ACHIEVEMENTS.filter(a => !achHidden.includes(a.id))
  const achN = achAll.filter(a => achKept.got?.[a.id]).length
  // each kind's tabs that need you (the Dock's rule) and whether one works, for its rail button
  const kinds = rail ? new Map(live.map(w => [w.id, kindOf(w)])) : null
  const railSays = (k: RailKind) => {
    const mine = view.tabs.filter(t => kinds?.get(t.workspace) === k)
    return { n: mine.filter(needsYou).length, busy: mine.some(t => spins(t)) }
  }
  // a rail button: its icon, words (Labels), and a count or a dot on the icon
  const railButton = (key: string, icon: IconName, label: string, on: boolean, tip: string, run: () => void, mark?: ReactNode, menu?: (e: React.MouseEvent) => void) => (
    <button key={key} type="button" data-rail={key} data-key={isKeyId(key) ? key : undefined} className={`rail-kind nodrag ${on ? 'on' : ''}`} aria-pressed={on} aria-label={tip} data-tip={tip} aria-haspopup={menu ? 'menu' : undefined} onClick={menu ?? run}>
      <span className="rail-icon">
        <Icon name={icon} size={18} />
        {mark}
      </span>
      {railWords && <span className="rail-label">{label}</span>}
    </button>
  )
  // a kind's button: its count, or a dot while one works
  const kindButton = ([k, label, icon]: (typeof RAIL)[number]) => {
    const { n, busy } = railSays(k)
    const says = `${label}${n ? ` · ${n} need${n === 1 ? 's' : ''} you` : busy ? ' · at work' : ''}`
    return railButton(k, icon, label, railKind === k && !onPage, says, () => railTo(k), n > 0 ? <span className="rail-count">{n > 99 ? '99+' : n}</span> : busy && <span className="rail-dot" />)
  }
  // the rail's quick access: workspaces, terminals and browsers pinned there (Pin to the rail), oldest pin first
  const railPins = rail ? live.filter(w => w.railPin).sort((a, b) => a.railPin! - b.railPin!).slice(0, RAIL_PINS) : []
  const pinMarks = initials(railPins.map(wsName))
  const pinButton = (w: WorkspaceView, i: number) => {
    const mine = view.tabs.filter(t => t.workspace === w.id)
    const n = mine.filter(needsYou).length
    const k = rawKind(w)
    const tip = `${wsName(w)}${k === 'projects' ? ` · ${projWords(w)}` : ''}${n ? ` · ${n} need${n === 1 ? 's' : ''} you` : ''} · right click: its menu`
    // never lit as the open one: its kind's button above is, and the list shows the row; a mouse click lets go of the
    // focus (a key pressed later would ring it, :focus-visible), Enter or Space keeps a keyboard user's place
    return (
      <button key={`pin:${w.id}`} type="button" className={`rail-kind rail-pin nodrag ${dropOn === w.id ? 'drop-on' : ''}`} {...dropProps(w)} aria-current={ws?.id === w.id && !onPage ? 'true' : undefined} aria-label={tip} data-tip={tip} onClick={e => (e.detail && e.currentTarget.blur(), setDialog(null), setWsId(w.id))} onContextMenu={e => (e.preventDefault(), openMenu(e, wsMenu(w)))}>
        <span className="rail-icon" style={colorVar(tint(w))}>
          {k === 'projects' ? <span className="rail-mark">{pinMarks[i]}</span> : <Icon name={k === 'shells' ? 'terminal' : 'globe'} size={18} />}
          {k === 'projects' && <ProjectMark p={projOf(w)} size={11} /> /* its project's, at the corner */}
          {n > 0 ? <span className="rail-count">{n}</span> : mine.some(t => spins(t)) && <span className="rail-dot" />}
        </span>
        {railWords && <span className="rail-label">{wsName(w)}</span>}
      </button>
    )
  }
  // specs and brainstorms pinned there (settings.railPlans), after the workspaces: a click opens it on the Specs page
  const planPins = rail && specsOn ? (settings.railPlans ?? []).slice(0, RAIL_PINS - railPins.length) : [] // the same 5 places as the workspaces'
  const samePlan = (a: PlanPin, b: { project: string; kind: PlanKind; slug: string }) => a.project === b.project && a.kind === b.kind && a.slug === b.slug
  const pinPlan = (r: PlanPin, on: boolean) => {
    const was = settings.railPlans ?? []
    const had = was.find(x => samePlan(x, r))
    if (on && had?.title === r.title) return
    if (on && !had && railPins.length + was.length >= RAIL_PINS) return toast(`The rail holds ${RAIL_PINS} pins: unpin one first`)
    void call('settingsSet', { railPlans: on ? (had ? was.map(x => (x === had ? r : x)) : [...was, r]) : was.filter(x => x !== had) }).catch(fail)
  }
  const planButton = (p: PlanPin) => {
    const words = p.kind === 'spec' ? 'Spec' : 'Brainstorm'
    const tip = `${words}: ${p.title || 'Untitled'} · ${view.projects.find(x => x.id === p.project)?.name ?? ''} · right click: unpin`
    return (
      <button key={`plan:${p.project}/${p.kind}/${p.slug}`} type="button" className="rail-kind rail-pin nodrag" aria-label={tip} data-tip={tip} onClick={e => (e.detail && e.currentTarget.blur(), setDialog({ specs: p.project, kind: p.kind, slug: p.slug }))} onContextMenu={e => (e.preventDefault(), openMenu(e, [{ label: 'Open', icon: (p.kind === 'spec' ? 'spec' : 'bulb'), run: () => setDialog({ specs: p.project, kind: p.kind, slug: p.slug }) }, { label: 'Unpin from the rail', icon: 'pin', run: () => pinPlan(p, false) }]))}>
        <span className="rail-icon">
          <Icon name={(p.kind === 'spec' ? 'spec' : 'bulb')} size={18} />
        </span>
        {railWords && <span className="rail-label">{p.title || 'Untitled'}</span>}
      </button>
    )
  }
  // the floating chat (Settings › AI's Chat button): Laki AI over any page but its own and those with a chat on them
  const aiFab = aiOn(settings) && settings.ai?.float !== false && !narrow && dialog !== 'ai' && dialog !== 'help' && !specsOf(dialog) && !settingsOf(dialog) && !extOf(dialog) && !studioOf(dialog) /* its own chat */
  // what it tells the model with each ask: the page open, the workspace and tab, as they are now, and the tab's screen
  const whereNow = async () => {
    const page = dialog === null ? 'the workspace below (no page over it)' : typeof dialog === 'string' ? `the ${dialog} page` : `the ${Object.keys(dialog)[0]} page`
    const w = ws && [`workspace "${wsName(ws)}" (id ${ws.id}) in project ${project?.name ?? ws.project}`, ws.branch && `branch ${ws.branch}`, ws.pr && `PR #${ws.pr.number} "${ws.pr.title}" ${ws.pr.state.toLowerCase()} ${ws.pr.url}`].filter(Boolean).join(', ')
    const t = tab && [`tab "${tab.name}" (id ${tab.id}, ${tab.kind === 'agent' ? tab.preset ?? 'agent' : tab.kind}) ${STATE_WORDS[tab.status] ?? tab.status}`, tab.progress && `${tab.progress.pct}% done`, tab.last && `its last answer: ${tab.last.trim().replace(/\s+/g, ' ').slice(0, 400)}`].filter(Boolean).join(', ')
    const flow = flowsOf(dialog) && pageNow.workflow?.() // the Workflows page: the workflow open there, and its file
    if (flow) return `On the Workflows page, with ${flow}`
    const screen = tab && tab.status !== 'exited' ? await api.call<string>('screen', { target: tab.id, lines: 40, by: 'ai' }).catch(() => '') : '' // by: Laki AI looks (its glow)
    // the Desk: its tiles by id, so "change it" finds the one (Laki AI rewrites only ones it made)
    const desk = dialog === 'desk' && (view.widgets ?? []).filter(onDesk).map(x => `"${x.name}" (extension id ${x.id}${x.byAi ? ', made by Laki AI' : ''}${x.on ? '' : ', off'})`)
    return [`On ${page}`, desk && (desk.length ? `its tiles: ${desk.join(', ')}` : 'no tiles yet'), w && `selected: ${w}`, t, screen.trim() && `the tab's screen now (its last 40 lines):\n${screen.replace(/\s+$/gm, '').slice(-5000)}`].filter(Boolean).join('; ')
  }
  // the names Laki AI's answers may write in bold (made links): its own (MCP's state) and the one shown (a PR's title)
  const aiNames = view.workspaces.filter(w => !w.archived).flatMap(w => [...new Set([w.name || w.id, wsName(w)])].map(name => ({ id: w.id, name })))
  const shownWidgets = (view.widgets ?? []).map(w => inWs(w, wsHere)) // a per-workspace one's instance in the workspace on screen
  const ownWidgets = shownWidgets.filter(w => (!w.project || w.project === ws?.project) && !(w.on && w.hidden)) // a repo's (.laki/extensions): only while a workspace of its project is selected; hidden: its data says so
  const deskWidgets = shownWidgets.filter(w => !(w.on && w.hidden)).map(w => (w.project ? { ...w, name: `${w.name} · ${view.projects.find(p => p.id === w.project)?.name ?? w.project}` } : w)) // the Desk: every one, a repo's named with its project
  const onPage = schedulesFor !== undefined || dialog === 'board' || dialog === 'achievements' || (dialog === 'calendar' && calOn) || (dialog === 'desk' && deskOn) || (notesOn && !!notesOf(dialog)) || (todosOn && dialog === 'todos') || (dialog === 'bird' && settings.birdView !== false) || dialog === 'ai' || !!specsOf(dialog) || !!flowsOf(dialog) || settingsOf(dialog) // the rail's lit button: the page over the main area, else the list's kind
  const listOff = rail && sideOpen && (schedulesFor !== undefined || dialog === 'board' || (calOn && dialog === 'calendar') || (deskOn && dialog === 'desk') || (notesOn && !!notesOf(dialog)) || (todosOn && dialog === 'todos') || dialog === 'ai' || (specsOn && !!specsOf(dialog)) || (flowsOn && !!flowsOf(dialog))) // the rail's Schedule and Board: a page over all but the rail
  // back and forward's buttons: the rail's top, else the sidebar's head; a right click lists where each goes
  const histMenu = (e: React.MouseEvent, by: -1 | 1) => {
    e.preventDefault()
    const h = hist.current
    const js = by < 0 ? h.at.slice(0, h.i).map((_, j) => j).reverse() : h.at.slice(h.i + 1).map((_, j) => h.i + 1 + j)
    if (js.length) openMenu(e, [{ head: by < 0 ? 'Back to' : 'Forward to' }, ...js.map(j => ({ label: placeName(h.at[j]), icon: (h.at[j].d === null ? 'terminal' : 'file') as IconName, run: () => travel(j) }))])
  }
  const histAt = hist.current
  const histNav = historyOn && (
    <span className="hist-nav nodrag">
      <IconButton icon="chevronLeft" keyId="back" title={kt(histAt.at[histAt.i - 1] ? `Back to ${placeName(histAt.at[histAt.i - 1])}; right click: more` : 'Back', 'back')} disabled={histAt.i < 1} onClick={() => travel(histAt.i - 1)} onContextMenu={e => histMenu(e, -1)} />
      <IconButton icon="chevronRight" keyId="forward" title={kt(histAt.at[histAt.i + 1] ? `Forward to ${placeName(histAt.at[histAt.i + 1])}` : 'Forward', 'forward')} disabled={histAt.i >= histAt.at.length - 1} onClick={() => travel(histAt.i + 1)} onContextMenu={e => histMenu(e, 1)} />
    </span>
  )
  // the rail's pages after Projects, then the other kinds; with words under the icons and more than RAIL_FIT buttons,
  // the least used ones (RAIL_MORE's order) go into ⋯ More, a menu, its count their counts', lit while one is open
  type RailPage = { key: string; icon: IconName; label: string; on: boolean; tip: string; run: () => void; mark?: ReactNode; n?: number } | { key: string; kind: (typeof RAIL)[number] }
  const railPages: RailPage[] = [
    { key: 'board', icon: 'board', label: 'Board', on: dialog === 'board', tip: BOARD_TIP, run: toBoard },
    { key: 'schedules', icon: 'clock', label: 'Schedule', on: schedulesFor !== undefined, tip: `${schedTip}${runFailed ? ' · a run failed' : ''}`, run: toSchedules, mark: runFailed && <span className="rail-dot bad" /> },
    ...(specsOn ? [{ key: 'specs', icon: 'spec' as const, label: 'Specs', on: !!specsOf(dialog), tip: SPECS_TIP, run: toSpecs }] : []),
    ...(flowsOn ? [{ key: 'workflows', icon: 'flow' as const, label: 'Flows', on: !!flowsOf(dialog), tip: FLOWS_TIP, run: toFlows, n: flowsAsk }] : []),
    ...(deskOn ? [{ key: 'desk', icon: 'desk' as const, label: 'My Desk', on: dialog === 'desk', tip: 'My Desk (experimental): your extensions as tiles', run: toDesk }] : []),
    ...(notesOn ? [{ key: 'notes', icon: 'note' as const, label: 'Notes', on: !!notesOf(dialog), tip: 'Notes (experimental): yours, for any project', run: toNotes }] : []),
    ...(todosOn ? [{ key: 'todos', icon: 'listChecks' as const, label: 'To-dos', on: dialog === 'todos', tip: 'To-dos (experimental): your checklist', run: toTodos }] : []),
    ...(calOn ? [{ key: 'calendar', icon: 'calendar' as const, label: 'Calendar', on: dialog === 'calendar', tip: `Calendar (experimental): scheduled tasks and reminders${calSoon ? ` · ${calSoon} rang` : ''}`, run: toCal, n: calSoon }] : []),
    ...RAIL.slice(1).filter(([k]) => railOf(k) === k).map(kind => ({ key: kind[0], kind })),
  ]
  // the user's order and the ones they put into More (Settings › Appearance › Rail), then the ones that don't fit
  const railHide = settings.railHide ?? []
  const railShown = railSorted(railPages, settings.railOrder).filter(x => !railHide.includes(x.key))
  const over = (o => (o.length > 1 ? o : []))(railWords && railShown.length + 1 > RAIL_FIT ? RAIL_MORE.filter(k => railShown.some(x => x.key === k)).slice(0, railShown.length + 1 - (RAIL_FIT - 1)) : []) // one alone: More would save no room
  const railKept = railShown.filter(x => !over.includes(x.key))
  type RailRun = Extract<RailPage, { run: () => void }>
  const kindPage = ([k, label, icon]: (typeof RAIL)[number]): RailRun => (({ n, busy }) => ({ key: k, icon, label, on: railKind === k && !onPage, tip: `${label}${busy ? ' · at work' : ''}`, run: () => railTo(k), n }))(railSays(k))
  const aiPage: RailRun = { key: 'ai', icon: 'ai', label: 'AI', on: dialog === 'ai', tip: AI_TIP, run: toAi }
  const railMore = [...railSorted(railPages, settings.railOrder).filter(x => railHide.includes(x.key) || over.includes(x.key)), ...(aiOn(settings) && railHide.includes('ai') ? [aiPage] : [])].map(x => ('kind' in x ? kindPage(x.kind) : x))
  // a right click on the rail: put that button into More (or back), or the whole list in Settings
  const railMenu = (e: React.MouseEvent) => {
    const key = (e.target as Element).closest<HTMLElement>('[data-rail]')?.dataset.rail
    const item = RAIL_ITEMS.find(x => x.key === key)
    e.preventDefault()
    openMenu(e, [
      ...(item ? [{ label: `Move ${item.label} into ⋯ More`, icon: 'more' as const, run: () => void call('settingsSet', { railHide: [...railHide, item.key] }).catch(() => {}) }] : []),
      { label: 'Customize the rail…', icon: 'gear', sub: 'which buttons show, their order', run: () => setDialog({ section: 'appearance', spot: 'Rail' }) },
    ])
  }
  const railBar = rail && sideOpen && (
    <nav className="rail drag" aria-label="Projects, the board, scheduled tasks, terminals, browsers and settings" data-bare={railWords ? undefined : ''} style={{ width: railW }} onContextMenu={e => !e.defaultPrevented && railMenu(e)}>
      {histNav}
      {kindButton(RAIL[0])}
      {railKept.map(x => ('kind' in x ? kindButton(x.kind) : railButton(x.key, x.icon, x.label, x.on, x.tip, x.run, x.n ? <span className="rail-count">{x.n}</span> : x.mark)))}
      {railMore.length > 0 &&
        railButton('more', 'more', 'More', railMore.some(x => x.on), `More: ${railMore.map(x => x.label).join(', ')}`, () => {}, (n => (n ? <span className="rail-count">{n}</span> : undefined))(railMore.reduce((a, x) => a + (x.n ?? 0), 0)), e =>
          openMenu(e, [
            ...railMore.map(x => ({ label: x.label, icon: x.icon, sub: x.tip, run: x.run, ...(x.on && { hint: 'ON' }), ...(x.n ? { pill: String(x.n), tone: 'warn' as const } : {}) })),
            ...(railHide.length ? [{ label: 'Show them all on the rail', icon: 'eye' as const, foot: true, run: () => void call('settingsSet', { railHide: [] }).catch(() => {}) }] : []),
            { label: 'Customize the rail…', icon: 'gear', foot: true, run: () => setDialog({ section: 'appearance', spot: 'Rail' }) },
          ]),
        )}
      {(railPins.length > 0 || planPins.length > 0) && <span className="rail-sep" />}
      {railPins.map(pinButton)}
      {planPins.map(planButton)}
      <WidgetButtons widgets={ownWidgets} api={widgetApi} places={['rail']} look="rail" words={railWords} />
      <span className="spacer" />
      {settings.devMode === true && railButton('picker', 'target', 'Pick', picking, `Pick an element: what it is, to copy into a prompt (development mode)${pickKey ? ` · ${pickKey}` : ''}`, () => setPicking(p => !p))}
      {aiOn(settings) && !railHide.includes('ai') && railButton('ai', 'ai', 'AI', dialog === 'ai', AI_TIP, toAi)}
      {railButton('settings', 'gear', 'Settings', settingsOf(dialog), kt('Settings', 'settings'), toSettings)}
    </nav>
  )
  // the rail's list: its kind's (a filter looks through all of them)
  const listed = rail && !find ? view.projects.filter(p => railOf(p.kind) === railKind) : view.projects
  const inList = (w: WorkspaceView) => !rail || !!find || kindOf(w) === railKind
  const pins = pinned.filter(w => shows(w) && inList(w))
  const tabStrip = tabsAt !== 'top' && (
    <div className={`tabstrip ${tabsAt}`} data-tabbar>
      {tabList}
    </div>
  )
  return (
    <div style={rail ? ({ '--rail-w': `${railW}px` } as CSSProperties) : undefined} className={`app ${sideOpen ? '' : 'side-closed'} ${rail ? 'rail-on' : ''} ${listOff ? 'list-off' : ''} ${narrow ? 'narrow' : ''} ${bridge && /Mac/.test(navigator.userAgent) ? 'electron' : ''} ${settings.dimPanes !== false ? 'dim-panes' : ''} ${full ? 'full' : ''}`} data-pad={settings.termPad}>
      {railBar}
      {(sideOpen || video) && ( // hidden, not gone, while a video plays
      <aside className="sidebar" hidden={!sideOpen || listOff} data-style={sideStyle} style={{ width: sideW, ...phVars(settings.projectLook), ...sideVars(settings.sideLook) }} {...phAttrs(settings.projectLook)}>
        <div className="side-head drag">
          <IconButton icon="sidebar" title={kt('Hide sidebar', 'sidebar')} keyId="sidebar" onClick={() => setSideOpen(false)} />
          {!railBar && histNav}
          <span className="spacer" />
          <IconButton icon="filter" title={find ? 'Stop filtering' : 'Filter the workspaces: by name, branch or PR; the ones that need you, working, with a PR'} on={!!find} onClick={() => setFind(f => (f ? null : { q: '' }))} />
          <IconButton icon="plus" title="Add a project, a terminal or a browser" tip={false} onClick={e => openMenu(e, addMenu())} />
          {settings.birdView !== false && <IconButton icon="eye" title="Bird view: every live session and its screen" on={dialog === 'bird'} onClick={() => setDialog(d => (d === 'bird' ? null : 'bird'))} />}
          {settings.devMode === true && !rail && <IconButton icon="target" className="picker-toggle" title={`Pick an element: what it is, to copy into a prompt (development mode)${pickKey ? ` · ${pickKey}` : ''}`} on={picking} onClick={() => setPicking(p => !p)} />}
          <IconButton icon="help" title={kt('Help: keys and commands', 'help')} keyId="help" on={dialog === 'help'} onClick={() => setDialog(d => (d === 'help' ? null : 'help'))} />
        </div>
        {find && (
          <div className="side-find">
            <div className="find-field">
              <input autoFocus value={find.q} placeholder="Filter: name, branch, PR…" spellCheck={false} onChange={e => setFind({ ...find, q: e.target.value })} onKeyDown={e => e.key === 'Escape' && setFind(null)} />
              {(find.q || find.only) && <IconButton icon="x" title="Clear and close the filter" onClick={() => setFind(null)} />}
            </div>
            <span className="seg">
              {ONLY.map(([id, label]) => (
                <button key={id} type="button" className={find.only === id ? 'on' : ''} onClick={() => setFind({ ...find, only: find.only === id ? undefined : id })}>
                  {label}
                </button>
              ))}
            </span>
          </div>
        )}
        <div className="side-scroll">
          {find && !found && <div className="empty-side muted">No workspace matches.</div>}
          {!find && (!rail || railKind === 'projects') && settings.needsList !== false && (
            <NeedsList items={needsSorted(needing).flatMap(t => (w => (w ? [{ t, w }] : []))(live.find(w => w.id === t.workspace)))} shut={folded.includes('needs')} onFold={() => fold('needs')} api={needsApi} next={needNext?.id} />
          )}
          {pins.length > 0 && (
            <div className="project pinned">
              <div className="project-head">
                <span className="project-icon">
                  <Icon name="pin" size={12} />
                </span>
                <span className="project-name">Pinned</span>
              </div>
              <div className="project-ws">{pins.map(w => wsRow(w, true))}</div>
            </div>
          )}
          {listed.map(p => {
            const mine = live.filter(w => w.project === p.id && !w.pinned) // a pinned one is above, under Pinned
            const hits = find && mine.filter(shows) // filtering: only those, folded or not, without the seps
            if (hits && !hits.length) return null
            const shut = !hits && folded.includes(p.id)
            const sum = shut ? busiest(mine) : 'idle'
            return (
            <div key={p.id} className={`project ${rows.at('project', p.id)}`} data-row={`project:${p.id}` /* the whole block: a project dropped anywhere on it */}>
              <div
                className="project-head"
                data-tip={`${p.host ? `${p.host}:` : ''}${p.path} · ${p.kind ? `click to ${shut ? 'expand' : 'collapse'}` : `click for its page (notes, tasks, memory, settings) · the arrow ${shut ? 'expands' : 'collapses'} it`} · drag to move`}
                onPointerDown={e => rows.start(e, 'project', p.id)}
                onClick={e => !rows.dragged() && !(e.target as Element).closest('button') && (p.kind || (e.target as Element).closest('.project-chev') ? fold(p.id) : setDialog({ project: p.id }))}
                onContextMenu={e => openMenu(e, projectActions(p))}
              >
                <span className="project-chev">
                  <Icon name={shut ? 'chevronRight' : 'chevron'} size={12} />
                </span>
                <span className="project-icon">
                  <ProjectMark p={p} or={p.kind === 'shells' ? 'terminal' : p.kind === 'browsers' ? 'globe' : p.host ? 'server' : p.git === false ? 'folder' : 'fork'} />
                </span>
                <span className="project-name">{p.name}</span>
                {shut && mine.length > 0 && (
                  <>
                    {sum !== 'idle' && sum !== 'exited' && <Glyph s={sum} />}
                    <span className="project-count">{mine.length}</span>
                  </>
                )}
                <span className="spacer" />
                <IconButton icon="plus" title={p.kind || !termsOk ? newWord(p) : 'New workspace or terminal'} onClick={e => (p.kind || !termsOk ? newIn(p) : openMenu(e, plusMenu(p)))} />
                <IconButton icon="more" title="Project" onClick={e => openMenu(e, projectActions(p))} />
              </div>
              <div className="project-ws">{/* under its project, on a guide line */}
              {hits ? hits.map(w => wsRow(w)) : shut ? [...makingRows(p, ''), ...(p.seps ?? []).flatMap(s => makingRows(p, s.id))] : shownRows(p, mine)}{/* folded: only one on its way stays */}
              {!shut && !hits && !live.some(w => w.project === p.id) && !making.some(m => m.project === p.id) && ( // nothing here yet (none pinned either): the way to start
                <div className="ws ws-new" onClick={() => newIn(p)}>
                  <Icon name="plus" size={12} />
                  <span className="ws-name">{newWord(p)}</span>
                </div>
              )}
              {!shut && !hits && !p.kind && termsOk && !live.some(w => w.project === p.id) && !making.some(m => m.project === p.id) && ( // or just a shell there
                <div className="ws ws-new" onClick={() => termIn(p)}>
                  <Icon name="terminal" size={12} />
                  <span className="ws-name">Terminal</span>
                </div>
              )}
              </div>
            </div>
            )
          })}
          {!listed.length &&
            (railKind === 'projects' || !rail || find ? (
              <div className="empty-side muted">Open a folder (⌘O) or drop one here.</div>
            ) : (
              <div className="ws ws-new" onClick={() => quickNew(railKind)}>{/* Terminals and Browsers: the first one makes the project */}
                <Icon name="plus" size={12} />
                <span className="ws-name">{railKind === 'shells' ? 'New terminal' : 'New browser'}</span>
              </div>
            ))}
        </div>
        {video && (
          <Video
            key={video.at}
            src={`${video.src}${video.src.includes('?') ? '&' : '?'}enablejsapi=1&cc_load_policy=0&iv_load_policy=3&rel=0&playsinline=1${video.play ? '&autoplay=1' : ''}` /* enablejsapi: the timer pauses and plays it; captions and annotations off, related videos only the channel's (YouTube won't hide its own buttons) */}
            min={video.min}
            onMin={min => setVideo(v => v && { ...v, min })}
            onChange={() => setDialog('video')}
            onClose={() => setVideo(null)}
          />
        )}
        {timers.map(t => (
          <TimerBar key={t.id} end={t.end} tip={t.then === 'send' ? `To ${sendTo(t)}: ${t.text}` : undefined} label={t.then === 'send' ? `To ${sendTo(t)}: ${clip(t.text ?? '', 80)}` : t.then === 'remind' ? reminder(t) : `${t.note ? `${t.note} · ` : ''}${span(t.ms)}${t.then === 'notify' ? '' : t.then === 'command' ? `, then ${t.cmd}` : `, then ${TIMER_THEN.find(x => x[0] === t.then)![1].toLowerCase().replace(' the video', '')}`}`} onMenu={e => openMenu(e, timerMenu(t))} left={t.left} onPause={t.then === 'send' || t.then === 'remind' ? undefined : () => pause(t.id)} onStop={() => setTimer(t.id, () => null)} />
        ))}
        {watches.map(w => (
          <StopwatchBar
            key={w.id}
            ms={w.ms}
            from={w.from}
            onToggle={() => setWatch(w.id, x => (x.from ? { id: x.id, ms: x.ms + Date.now() - x.from } : { ...x, from: Date.now() }))}
            onReset={() => setWatch(w.id, x => ({ ...x, ms: 0, from: x.from && Date.now() }))}
            onClose={() => setWatch(w.id, () => null)}
          />
        ))}
        <WidgetGrid widgets={ownWidgets} api={widgetApi} desk={settings.desk !== false} />
        {!onboard.off && onboardDone.size < STEPS.length && dialog !== 'onboard' && <OnboardBar done={STEPS.filter(x => onboardDone.has(x.id)).length} onOpen={() => setDialog('onboard')} onOff={() => setOnboard(o => ({ ...o, off: true }))} />}
        <div className="side-foot" ref={fitFoot}>{/* pinned under the projects, in one row: words dropped from the right as they don't fit */}
          {!rail && ( // the rail layout has them on its rail
            <>
              <IconButton icon="clock" title={schedTip} on={schedulesFor !== undefined} className={runFailed ? 'dot' : ''} label={labels ? 'Schedule' : undefined} onClick={toSchedules} />
              <IconButton icon="board" title={BOARD_TIP} label={labels ? 'Board' : undefined} on={dialog === 'board'} onClick={toBoard} />
              {specsOn && <IconButton icon="spec" title={SPECS_TIP} label={labels ? 'Specs' : undefined} on={!!specsOf(dialog)} onClick={toSpecs} />}
              {flowsOn && <IconButton icon="flow" title={FLOWS_TIP} label={labels ? 'Flows' : undefined} on={!!flowsOf(dialog)} className={flowsAsk ? 'dot' : ''} onClick={toFlows} />}
              {aiOn(settings) && <IconButton icon="ai" title={AI_TIP} label={labels ? 'AI' : undefined} on={dialog === 'ai'} onClick={toAi} />}
            </>
          )}
          <IconButton icon="youtube" title="Watch a YouTube video while you work" label={labels ? 'Video' : undefined} on={!!video} onClick={() => setDialog('video')} />
          {settings.fun !== false && <IconButton icon="smile" title="A random meme from Reddit, for a break (off: Settings › Appearance)" label={labels ? 'Meme' : undefined} on={dialog === 'fun'} onClick={() => setDialog(d => (d === 'fun' ? null : 'fun'))} />}
          <IconButton icon="timer" title="Timers: a countdown, then a sound and a dialog or a notification (and the video paused, played or closed, if you like); or a stopwatch" label={labels ? 'Timer' : undefined} on={timers.length + watches.length > 0} onClick={e => openMenu(e, startMenu())} />
          <WidgetButtons widgets={ownWidgets} api={widgetApi} places={rail ? ['foot'] : ['foot', 'rail'] /* no rail: its widgets here */} look="foot" words={labels} />
          {!rail && (
            <>
              <span className="spacer" />
              <IconButton icon="gear" title={kt('Settings', 'settings')} keyId="settings" label={labels ? 'Settings' : undefined} on={settingsOf(dialog)} onClick={toSettings} />
            </>
          )}
        </div>
      </aside>
      )}
      {sideOpen && !listOff && (narrow ? <div className="side-backdrop" onClick={() => setSideOpen(false)} /> : <SideHandle width={sideW} onWidth={setSideW} init={SIDE} at={rail ? railW : 0} />)}

      <main className="main">
        {full && <IconButton icon="minimize" title={kt('Exit full screen', 'full')} className="full-exit" onClick={() => toggleFull(false)} />}
        <div className="tabbar drag" data-tabbar>
          {!sideOpen && <IconButton icon="sidebar" title={kt('Show sidebar', 'sidebar')} keyId="sidebar" className="nodrag side-show" onClick={() => setSideOpen(true)} />}
          {tabsAt === 'top' && tabList}
          <span className="spacer" />
          <WidgetStrip widgets={ownWidgets} api={widgetApi} place="top" />
          {ws && ws.browser === undefined && project?.kind !== 'shells' && !narrow && <IconButton icon="layers" title={kt('Layout: the agent with Preview, Changes, the dev server or a shell; yours', 'layout')} keyId="layout" className="nodrag layout-btn" onClick={e => openMenu(e, layoutMenu(), 'right')} />}
          {ws && <IconButton icon="maximize" title={kt('Full screen: just this tab', 'full')} keyId="full" className="nodrag" onClick={() => toggleFull(true)} />}
          {ws && (ws.browser !== undefined || project?.kind === 'shells') && ( // a page or a terminal: no files, PR, preview or scripts to show
            <div className="actions nodrag">
              <IconButton icon="more" title="Workspace" onClick={e => openMenu(e, wsActions, 'right')} />
            </div>
          )}
          {ws && ws.browser === undefined && project?.kind !== 'shells' && (
            <div className="actions nodrag">
              {!narrow && ( // a phone: in ⌘K's palette (the search button)
                <>
                  <IconButton icon="code" title={`Open in… (⌘E: ${editorName})`} onClick={e => openMenu(e, openInItems(), 'right')} />
                  <IconButton icon="info" title={kt('Workspace info', 'info')} keyId="info" on={info} onClick={() => showInfo()} />
                  <IconButton icon="globe" title={`Preview localhost:${ws.port}`} on={panelShown && panelTab === 'preview'} onClick={() => togglePanel('preview')} />
                </>
              )}
              <IconButton icon="panel" title={kt('Info, files, changes, review, preview', 'panel')} keyId="panel" on={panelShown} onClick={() => togglePanel()} />
              {ws.kind === 'worktree' && !narrow && <IconButton icon="ship" title="Ship: commit, push, open a PR" onClick={() => setDialog('ship')} />}
              <IconButton icon="search" title={kt('Commands', 'palette')} keyId="palette" onClick={() => setDialog('palette')} />
              {canLater && !narrow && <IconButton icon="timer" title={`${kt('Send a message later', 'later')}: to an agent or Laki AI`} keyId="later" onClick={() => sendLater(tab?.kind === 'agent' ? tab.id : undefined)} />}
              <IconButton icon="more" title="Workspace" onClick={e => openMenu(e, wsActions, 'right')} />
              <RunButton
                running={devRunning}
                onRun={() => (ws.run ? run() : editScripts())}
                onStop={() => devTab && api.send('input', { tab: devTab.id, data: '\x03' })}
                onMenu={e => openMenu(e, runMenu(), 'right')}
              />
            </div>
          )}
        </div>
        {connected && staleDaemon(view) && <StaleDaemon restart={() => api.call('shutdown')} />}
        {connected && !staleDaemon(view) && oldSkills.length > 0 && (
          <div className="stale-bar soft" role="status">
            <Icon name="import" size={16} />
            <span>
              <b>Laki's skill is out of date in {[...new Set(oldSkills.map(r => r.name))].join(', ')}.</b> Its agents read older commands and paths than this Laki's.
            </span>
            <button onClick={() => void updateSkills()}>Update</button>
            <button className="ghost" onClick={() => ((skillsLater.current = true), setOldSkills([]))}>
              Not now
            </button>
          </div>
        )}
        {glow && <PeekGlow key={glow.n} tab={glow.tab} onDone={() => setGlow(null)} />}
        <div className="body">
          {tabsAt === 'left' && tabStrip}
          <div className="term-wrap">
            {group ? (
              <Panes
                layout={group}
                active={tab?.id ?? null}
                drag={drag}
                label={label}
                color={id => colorOf(byId(id))}
                onMenu={(e, id) => openMenu(e, tabMenu([id]))}
                ghost={drag && (() => { // a pill: the tab's glyph and names, as in the tab bar
                  const ts = (drag.whole ? tabsOf(groups.find(g => tabsOf(g).includes(drag.tab)) ?? null) : [drag.tab]).map(byId).filter((t): t is TabView => !!t)
                  return ts.length > 1 ? <><Glyph s={rollup(ts)} /><span>{ts.map(t => t.name).join(' · ')}</span></> : label(drag.tab)
                })()}
                render={id => floated.includes(id) ? (
                  <div className="floated">
                    <span>In a window of its own, over every app</span>
                    <div className="row">
                      <button onClick={() => floatTab(id)}>Show it</button>
                      <button onClick={() => floatTab(id, false)}>Bring it back</button>
                    </div>
                  </div>
                ) : (
                  <Term
                    key={transparent() ? 'clear' : 'solid' /* xterm takes allowTransparency only as it opens */}
                    tab={id}
                    active={id === tab?.id && !dialog && !reviewOn}
                    findSeq={finds[id] ?? 0}
                    fontSize={narrow ? Math.min(sizeOf(id), 11) : sizeOf(id) /* ponytail: a phone's own size, not a setting */}
                    fontFamily={settings.fontFamily}
                    copyOnSelect={settings.copyOnSelect !== false}
                    editKeys={settings.editKeys !== false}
                    theme={theme}
                    look={termLook(settings)}
                    onFile={path => openPath(id, path)}
                  />
                )}
                foot={id => (t => t?.queue?.length ? <QueueStrip tab={t} onSave={(q, was) => queueSave(t, q, was)} onRemove={i => queueRemove(t, i)} onNow={() => void call('queueNow', { tab: t.id }).catch(() => {})} onClear={() => queueRemove(t)} /> : null)(byId(id))}
                onFocus={id => id !== tab?.id && selectTab(id)}
                hoverFocus={settings.hoverFocus !== false}
                onClose={id => byId(id) && closeTabs([byId(id)!])}
                onResize={(path, at) => setGroups(groups.map(g => (g === group ? resize(g, path, at) : g)))}
                startDrag={(e, id) => start(e, id, false)}
              />
            ) : (
              <div className="empty">
                {ws ? (
                  ws.browser === undefined && <Ready name={wsName(ws)} branch={ws.kind === 'worktree' ? ws.branch : undefined} project={view.projects.find(p => p.id === ws.project)?.name} actions={newTabActions.filter(x => x.label !== 'Command…')} later={ws.pending && { title: `${ws.pending.agent} ${pendingWords(ws.pending, true).replace(/^S/, 's')}`, prompt: ws.pending.prompt, failed: ws.pending.failed, onStart: () => laterNow(ws), onChange: () => void laterChange(ws), onCancel: () => void laterCancel(ws) }} />
                ) : (
                  view.projects.length ? (
                    <>
                      <p>No workspaces yet.</p>
                      <button className="primary" onClick={() => newWs()}>New workspace  ⌘N</button>
                      <StarLaki />
                    </>
                  ) : (
                    <Welcome onOpen={openProject} onSsh={() => setDialog('project')} check={() => api.call<Doctor>('doctor')} />
                  )
                )}
              </div>
            )}
            {browsed.flatMap(id => {
              const w = live.find(x => x.id === id)
              return w?.browser !== undefined ? [<BrowserPane key={id} url={w.browser} hidden={id !== ws?.id || !!dialog} onPage={(url, title) => pageSeen(id, url, title)} onOpen={openExternal} />] : []
            })}
            {reviewOn && ws && <FullReview key={ws.id} ws={ws.id} base={ws.base} pr={ws.pr} linked={ws.prLinked} api={reviewApi(ws)} stat={statKey} onOpen={openExternal} />}
          </div>
          {tabsAt === 'right' && tabStrip}
          {previewed && ws && (
            <div className={`pv-wrap ${previewW ? 'sized' : ''}`} style={previewW ? { width: previewW } : undefined}>
              <PanelHandle onWidth={w => setPreviewW(w || null)} init={0} />
              {wsFiles.length > 1 && (
                <div className="pv-tabs" role="tablist" aria-label="Open files">
                  {wsFiles.map(f => (
                    <div key={fileKey(f)} role="tab" aria-selected={f === previewed} className={`pv-tab ${f === previewed ? 'on' : ''}`} data-tip={`${f.ext ? `${view.widgets?.find(x => x.id === f.ext)?.name ?? f.ext} · ` : ''}${f.storage ? `Artifacts › ${f.path}` : f.path}`} onClick={() => setShownFile(m => ({ ...m, [ws.id]: fileKey(f) }))} onAuxClick={e => e.button === 1 && void closeFile(f)}>
                      {(x => (x ? <ExtGlyph w={x} size={12} /> : <Icon name="file" size={12} />))(f.ext && view.widgets?.find(x => x.id === f.ext))}
                      <span className="pv-tab-name">{f.path.split('/').pop()}</span>
                      {edited(f.edit) && <span className="pv-dirty" aria-label="unsaved" />}
                      <IconButton icon="x" title="Close" className="pv-tab-x" onClick={e => (e.stopPropagation(), void closeFile(f))} />
                    </div>
                  ))}
                </div>
              )}
            {previewed.ext ? (
              // a file opener's full view, its data what its action on this file kept
              // ponytail: one data per extension (per workspace): two files' tabs of one opener show the last one run
              (w => (
                <div className="preview">
                  <div className="pv-head">
                    {w ? <ExtGlyph w={w} /> : <Icon name="panel" />}
                    <span className="pv-path" data-tip={previewed.path}>
                      {w?.name ?? previewed.ext} <span className="muted">{previewed.path}</span>
                    </span>
                    {w && <span className="muted small pv-wide">{extStatus(w)}</span>}
                    <IconButton icon="x" title="Close (⌘W)" onClick={closePreview} />
                  </div>
                  <div className="pv-body pv-ext">{w ? <WidgetBody w={w} full api={widgetApi} /> : <div className="muted small pad">That extension is gone (or off).</div>}</div>
                </div>
              ))((x => (x?.on ? inWs(x, ws.id) : undefined))(view.widgets?.find(x => x.id === previewed.ext)))
            ) : (
            <FilePreview
              key={previewed.n}
              path={previewed.path}
              line={previewed.line}
              load={() => api.call<FileContent>('fileRead', { ws: ws.id, path: previewed.path, storage: previewed.storage })}
              onOpen={() => (previewed.storage ? panelApi(ws).artifacts?.open(previewed.path) : panelApi(ws).openFile(previewed.path))}
              openLabel={previewed.storage ? 'Open' : undefined}
              readOnly={previewed.storage}
              onClose={closePreview}
              edit={previewed.edit}
              onEdit={edit => setOpenFiles(l => l.map(x => (x.ws === previewed.ws && fileKey(x) === fileKey(previewed) ? { ...x, edit } : x)))}
              save={(text, was, force) => api.call('fileWrite', { ws: ws.id, path: previewed.path, text, was, force })}
            />
            )}
            </div>
          )}
          {panelShown && ws && ( // the right panel: Info, Files, Changes, Review, Preview
            <SidePanel
              w={infoOf(ws)}
              git={git}
              tab={panelTab}
              onTab={setPanelTab}
              api={panelApi(ws)}
              sim={project?.config?.simulator ?? settings.simulator === true} /* the project's own over Settings' */
              width={panelW}
              onWidth={setPanelW}
              onClose={() => setPanelOpen(false)}
              onOpen={openExternal}
              onToggle={(k, v) => setAuto(ws, k, v)}
              onFix={what => prFix(ws, what)}
              onLog={c => ciLog(ws, c)}
              onAct={(act, method) => prAct(ws, act, method)}
              onLabel={labelApi(ws)}
              root={artsIn === ws.id ? 'artifacts' : 'ws'}
              onRoot={(r: FilesRoot) => setArtsIn(r === 'artifacts' ? ws.id : null)}
              ext={ownWidgets.filter(w => w.on && placesOf(w).includes('panel')).map(w => ({ id: `ext:${w.id}` as const, label: w.name, icon: <ExtGlyph w={w} size={14} />, body: <WidgetPanel w={w} api={widgetApi} /> }))}
              info={
                <InfoTab
                w={infoOf(ws)}
                onOpen={url => void openKeptLink(url).catch(fail) /* its .url links too: a file:/// one */}
                onToggle={(k, v) => setAuto(ws, k, v)}
                onFix={what => prFix(ws, what)}
                onLog={c => ciLog(ws, c)}
                onAct={(act, method) => prAct(ws, act, method)}
                onLabel={labelApi(ws)}
                onRename={() => setDialog({ renameWs: ws.id })}
                onAttach={attachable(ws) ? () => setDialog({ attachPr: ws.id }) : undefined}
                onCopy={copy}
                onWs={id => (setReveal(r => [...r, id]), setWsId(id))}
                onPrimary={url => call('prAttach', { ws: ws.id, pr: url }).then(r => done(`PR #${(r as { number: number }).number} is this workspace's PR`), () => {})}
                onUnrelate={url => call('wsSet', { id: ws.id, unrelate: url }).catch(() => {})}
                onDetach={() => call('prDetach', { ws: ws.id }).then(() => done('Only related now: its own PR, once opened, is its PR'), () => {})}
                onStorage={bridge?.openPath && ws.storage ? () => void bridge!.openPath!(ws.storage!).then(r => r === 'missing' && toast('Nothing kept yet: its folder is made with its first tab')) : undefined}
                />
              }
            />
          )}
        </div>
        {tab?.ask && (
          // the waiting agent's menu as buttons (a phone's thumb, or no reaching for arrows): the daemon moves and presses ⏎
          <div className="ask-bar">
            <span className="muted">{tab.name} asks:</span>
            {tab.ask.options.map(o => (
              <button key={o.n} className={o.n === tab.ask!.options[0].n ? 'primary' : ''} data-tip={o.label} onClick={() => call('answer', { tab: tab.id, n: o.n }).catch(() => {})}>
                {o.n}. {o.label.length > 40 ? `${o.label.slice(0, 38)}…` : o.label}
              </button>
            ))}
          </div>
        )}
        {touch && tab && !(narrow && (panelOpen || previewed)) /* not under a panel */ && (
          <KeyBar onKey={data => api.send('input', { tab: tab.id, data: xterms.get(tab.id)?.modes.applicationCursorKeysMode ? data.replace(/^\x1b\[([ABCD])$/, '\x1bO$1') : data })} />
        )}
        {tabsAt === 'bottom' && tabStrip}
        {(dialog === 'settings' || settingsFor || section) && (
          <SettingsPage
            key={settingsKey}
            settings={view.settings}
            presets={view.presets}
            apps={apps}
            onClose={() => setDialog(null)}
            onSection={id => {
              setSeenSecs(l => (l.includes(id) ? l : [...l, id]))
              if (id === 'resources' || id === 'simulator') earn(id === 'resources' ? 'resources' : 'simTab')
            }}
            onSave={({ achievements: _, ...s }) => {
              // achievements: App's own (earn), never this page's copy from when it opened; a profile: the list longer than the one in use
              if (s.presets && s.presets.length > (settings.presets ?? view.presets).length) earn('profile')
              call('settingsSet', s).catch(() => {})
            }}
            projects={view.projects.filter(p => !p.kind).map(p => ({ ...p, git: p.git !== false })) /* Terminals and Browsers: not projects, nothing to set */}
            projectFile={id => api.call<ProjectConfig>('projectFile', { id })}
            onSaveProject={(id, p) => call('projectSet', { id, ...p }).catch(() => {})}
            onMemory={id => setDialog({ project: id, tab: 'memory' })}
            achievements={{ n: achN, of: achAll.length, hidden: achHidden.length, off: !!achKept.off, setOff: off => void achSet({ off }).catch(fail), unhide: () => void achSet({ hidden: [] }).catch(fail), open: () => setDialog('achievements') }}
            renameProjects
            skill={{ app: 'Laki', load: () => api.call<SkillInfo[]>('skills').then(r => (stale(r), r)), set: (agent, on, skill) => api.call<SkillInfo[]>('skillSet', { agent, on, skill }).then(r => (stale(r), r)), doctor: () => api.call<Doctor>('doctor') }}
            accounts={layoutsOn ? accountsApi : undefined}
            ai={{ state: () => api.call('aiState'), key: key => api.call('aiKey', { key }), open: () => setDialog('ai') }}
            webhookTest={w => api.call('webhookTest', w)}
            cli={{ state: () => api.call('cliState'), install: () => api.call('cliInstall'), remove: () => api.call('cliRemove') }}
            uiReset={() => api.call('uiReset')}
            simulator={p => api.call('sim', p)}
            resources={{
              load: () => api.call<Resources>('resources'),
              tabs: view.tabs,
              wsName: id => (w => (w ? wsName(w) : id))(view.workspaces.find(w => w.id === id)),
              sleep: tab => api.call('tabSleep', { tab }),
              stopOther: key => api.call('resourceStop', { key }),
              open: tab => (setDialog(null), selectTab(tab), view.tabs.find(t => t.id === tab)?.asleep && call('tabWake', { tab }).catch(() => {})),
              procs: bridge?.procs,
              // main's (the bubbles, an agent browser), else the page's own frames (laki-stop: the video, a widget, the preview)
              stop: what => (what === 'floater' || what.startsWith('browse:') ? bridge?.procStop?.(what) : window.dispatchEvent(new CustomEvent('laki-stop', { detail: what }))),
              widgetName: id => view.widgets?.find(w => w.id === id)?.name ?? id,
            }}
            remote={{ state: view.remote, start: (hours, mail, open, pin, via, funnel) => api.call('remoteStart', { hours, mail, open, pin, via, funnel }), stop: () => api.call('remoteStop'), copy, open: openExternal }}
            widgets={extCfg}
            logs={(key, title) => setDialog({ logs: key, title })}
            section={settingsFor ? `project:${settingsFor.id}` : section}
            script={typeof dialog === 'object' && dialog && 'script' in dialog ? dialog.script : undefined}
            spot={typeof dialog === 'object' && dialog && 'spot' in dialog ? dialog.spot : undefined}
          />
        )}
        {shown[0] && <ShownDialog s={shown[0]} left={shown.length - 1} onOpenRun={() => (setDialog({ workflows: '', run: shown[0].run }), setShown([]))} onClose={() => setShown(q => q.slice(1))} />}
        <ShownPops pops={pops} onShow={p => (setShown(q => [...q, p]), setPops(q => q.filter(x => x !== p)))} onOpenRun={p => (setDialog({ workflows: '', run: p.run }), setPops(q => q.filter(x => x !== p)))} onClose={k => setPops(q => q.filter(x => x.key !== k))} />
        {(t =>
          t && (
            <SharePop
              name={t.name}
              share={t.share}
              onClose={() => setSharing(null)}
              api={{
                // the link copied as it's made: what you share it for
                start: hours => api.call<{ url: string }>('shareStart', { tab: t.id, hours }).then(r => navigator.clipboard.writeText(r.url).then(() => done('Share link copied'), () => {})),
                stop: () => api.call('shareStop', { tab: t.id }),
                open: openExternal,
                copy,
              }}
            />
          ))(sharing ? byId(sharing) : undefined)}
        {(w => w && <WidgetDialog w={w} api={widgetApi} onClose={() => setDialog(dialog && typeof dialog === 'object' && 'widget' in dialog ? (dialog.back ?? null) : null)} />)(dialog && typeof dialog === 'object' && 'widget' in dialog ? shownWidgets.find(x => x.id === dialog.widget) : undefined)}
        {(w => w && extModal && <WidgetModal key={extModal.n} w={w} ws={extModal.ws} m={extModal.m} api={widgetApi} onClose={m => setExtModal(x => (!m || x?.m === m ? null : x))} />)(extModal ? view.widgets?.find(x => x.id === extModal.wid) : undefined)}
        {(e => e && (
          <ExtensionPage
            key={e.extension}
            id={e.extension}
            tab={e.tab}
            edit={e.edit}
            widgets={view.widgets ?? []}
            cfg={extCfg}
            api={widgetApi}
            ai={settings.ai}
            workspaces={aiNames}
            spots={order.filter(w => !w.host && !view.projects.find(p => p.id === w.project)?.kind).map(w => ({ id: w.id, name: wsName(w) }))}
            here={wsHere}
            back={backWord(e.back)}
            onAiSettings={() => setDialog({ section: 'ai' })}
            onClose={() => setDialog(e.back ?? null)}
          />
        ))(extOf(dialog))}
        {(s => s && (
          <Suspense fallback={<Waiting title="Extension studio" onClose={() => setDialog(s.back ?? null)} />}>
            <WidgetStudio key={studioKey(s)} id={s.studio} first={s.first} widgets={view.widgets ?? []} cfg={extCfg} api={widgetApi} back={backWord(s.back)} onNamed={id => nameStudio(s, id)} onClose={() => setDialog(s.back ?? null)} />
          </Suspense>
        ))(aiOn(settings) ? studioOf(dialog) : undefined)}
        {dialog && typeof dialog === 'object' && 'uikit' in dialog && <UiKitPage key={String(dialog.icons)} icons={dialog.icons} back={backWord(dialog.back)} copy={copy} onClose={() => setDialog(dialog.back ?? { section: 'widgets' })} />}
        {dialog === 'help' && <HelpPage cli="laki" ship keys={kb} zoom={(fontSize / FONT_SIZE) * pageZoom} onClose={() => setDialog(null)} />}
        {dialog === 'about' && <About onClose={() => setDialog(null)} />}
        {picking && <Picker copy={copy} widgets={view?.widgets} onClose={() => setPicking(false)} />}
        {dialog === 'desk' && deskOn && (
          <DeskPage
            widgets={deskWidgets}
            wsName={ws && wsHere ? wsName(ws) : undefined}
            tiles={settings.deskTiles}
            tabs={settings.deskTabs}
            api={{
              ...widgetApi,
              place: (id, place, on) => (on ? extCfg.set(id, { place, on }) : call('widgetSet', { id, place, ...(on !== undefined && { on }) })), // on: a repo's sheet first
              build: aiOn(settings) ? first => setDialog({ studio: '', back: 'desk', first }) : undefined, // the studio, its first ask Build with AI's: it writes one placed on the Desk
              save: o => void call('settingsSet', { ...(o.tiles && { deskTiles: o.tiles }), ...(o.tabs && { deskTabs: o.tabs }) }).catch(() => {}),
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {(o =>
          o &&
          notesOn && (
            <Suspense fallback={<Waiting title="Notes" onClose={() => setDialog(null)} />}>
              <NotesPage id={o.note} api={{ call: (m, p) => api.call(m, p) }} onOpen={note => setDialog({ note })} onClose={() => setDialog(null)} />
            </Suspense>
          ))(notesOf(dialog))}
        {dialog === 'todos' && todosOn && (
          <Suspense fallback={<Waiting title="To-dos" onClose={() => setDialog(null)} />}>
            <TodoListPage api={{ call: (m, p) => api.call(m, p) }} onClose={() => setDialog(null)} />
          </Suspense>
        )}
        {dialog === 'calendar' && calOn && (
          <CalendarPage
            schedules={view.schedules ?? []}
            runs={view.runs ?? []}
            reminders={view.reminders ?? []}
            workspaces={live.map(w => ({ id: w.id, name: wsName(w) }))}
            api={{
              add: r => call('reminderAdd', r),
              set: r => call('reminderSet', r),
              rm: id => call('reminderRm', { id }),
              openWs: id => (setDialog(null), setWsId(id)),
              openSchedules: () => setDialog('schedules'),
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'onboard' && (
          <Onboarding
            done={onboardDone}
            onGo={onboardGo}
            onTick={id => setOnboard(o => (o.done.includes(id) ? o : { ...o, done: [...o.done, id] }))}
            onSkip={() => setDialog(null)}
            onOff={() => (setOnboard(o => ({ ...o, off: true })), setDialog(null))}
            theme={settings.theme ?? 'default'}
            onTheme={theme => call('settingsSet', { theme }).catch(() => {})}
          />
        )}
        {dialog && typeof dialog === 'object' && 'logs' in dialog && <Logs title={dialog.title} load={() => api.call<LogLine[]>('logs', { key: dialog.logs })} copy={copy} onClose={() => setDialog(dialog.back ?? (dialog.logs === 'new' ? { section: 'general' } : null))} />}
        {dialog === 'fun' && <Fun load={() => api.call<Meme>('meme')} onClose={() => setDialog(null)} />}
        {dialog === 'starters' && <StarterPicker onClose={() => setDialog(null)} onPick={k => (setDialog(null), void extCfg.make!(k))} />}
        {dialog && typeof dialog === 'object' && 'project' in dialog && (p => p && (
          <ProjectPage
            key={p.id}
            project={p}
            schedules={view.schedules?.filter(s => s.project === p.id) ?? []}
            tab={dialog.tab}
            onTab={tab => setDialog({ project: p.id, tab })}
            onClose={() => setDialog(null)}
            api={{
              save: o => call('projectSet', { id: p.id, ...o }),
              saveSettings: o => call('projectSet', { id: p.id, ...o }).catch(() => {}),
              ...(aiOn(settings) && { compact: { run: () => call('memoryCompact', { project: p.id }), log: () => api.call<CompactLogLine[]>('memoryCompactLog', { project: p.id }) } }),
              file: id => api.call<ProjectConfig>('projectFile', { id }),
              global: { actions: settings.actions, templates: settings.templates, simulator: settings.simulator === true },
              onGlobal: sec => setDialog({ section: sec }),
              schedules: () => setDialog({ schedules: p.id }),
              setSchedule: (id, on) => call('scheduleSet', { id, on }),
              specs: specsOn ? { list: () => api.call('planList', { project: p.id }), open: at => setDialog({ specs: p.id, ...at }) } : undefined,
            }}
          />
        ))(view.projects.find(x => x.id === dialog.project && !x.kind))}
        {dialog === 'ai' && <AiPage settings={settings.ai ?? {}} workspaces={aiNames} onClose={() => setDialog(null)} onSettings={() => setDialog({ section: 'ai' })} onLater={text => setDialog({ sendLater: ws?.id ?? '', to: 'ai', text, back: 'ai' })} inserts={extInserts(hereCtx())} complete={completeOf(view, { project: extWs(ws)?.project })} />}
        {(o =>
          o &&
          specsOn && (
            <Suspense fallback={<Waiting title="Specs & Brainstorms" onClose={() => setDialog(null)} />}>
              <SpecsPage
                key={`${o.specs}/${o.kind}/${o.slug}`}
                projects={view.projects.filter(p => !p.kind)}
                at={{ project: o.specs || undefined, kind: o.kind, slug: o.slug }}
                onClose={() => setDialog(null)}
                api={{
                  call,
                  aiOn: aiOn(settings),
                  start: p => (setNewFor(p.project), setNewInit({ prompt: specPrompt(p) }), setDialog('new')),
                  aiSettings: () => setDialog({ section: 'ai' }),
                  templates: planTemplates(settings),
                  saveTemplates: planTemplates => call('settingsSet', { planTemplates }),
                  copy,
                  reveal: path => void bridge?.openPath?.(path),
                  full,
                  toggleFull: () => toggleFull(),
                  ...(rail && { pinned: r => (settings.railPlans ?? []).some(x => samePlan(x, r)), pin: pinPlan }),
                }}
              />
            </Suspense>
          ))(specsOf(dialog))}
        {(o =>
          o &&
          flowsOn && (
            <Suspense fallback={<Waiting title="Workflows" onClose={() => setDialog(null)} />}>
              <WorkflowsPage
                key={o.run ?? (o.start ? JSON.stringify(o.start) : o.wf ? JSON.stringify(o.wf) : '')}
                view={view}
                projects={view.projects.filter(p => !p.kind)}
                presets={view.presets.filter(p => !p.off)}
                actions={settings.actions}
                at={{ run: o.run, start: o.start, wf: o.wf }}
                nav={o.nav}
                onNav={nav => setDialog(d => (d && typeof d === 'object' && 'workflows' in d ? { ...d, nav } : d))}
                onClose={() => setDialog(null)}
                api={{
                  call,
                  openWs: id => (setDialog(null), setWsId(id)),
                  openTab: (ws, tab) => (setDialog(null), selectTab({ id: tab, workspace: ws })),
                  toast: (text, undo) => toast(text, undo),
                  phone: !!settings.webhook?.url?.trim(),
                  settings: section => setDialog({ section }),
                  // Laki AI's floating chat over the page (it knows the open workflow); an ask: sent there, as you'd type it
                  ai: aiOn(settings) ? ask => (setAiFloat(true), ask && void whereNow().then(context => api.call('aiAsk', { text: ask, context })).catch(fail)) : undefined,
                  globals: settings.flowVars,
                  setGlobals: flowVars => call('settingsSet', { flowVars }),
                }}
              />
            </Suspense>
          ))(flowsOf(dialog))}
        {dialog === 'bird' && settings.birdView !== false && (
          <BirdPage
            view={view}
            onClose={() => setDialog(null)}
            api={{ screen: tab => api.call<string>('screen', { target: tab, lines: 40 }) /* no toast: a tab closed meanwhile */, open: (ws, tab) => (setDialog(null), selectTab({ id: tab, workspace: ws })), needs: needsYou }}
          />
        )}
        {dialog === 'achievements' && (
          <AchievementsPage
            kept={achKept}
            onClose={() => setDialog(null)}
            api={{
              go: achGo,
              hide: (id, hide) => (h => void achSet({ hidden: hide ? [...h, id] : h }).catch(fail))((achRef.current.hidden ?? []).filter(x => x !== id)),
              off: off => void achSet({ off }).then(() => off && (setDialog(null), toast('Achievements off: Settings › Achievements turns them back on')), fail),
            }}
          />
        )}
        {dialog === 'board' && (
          <BoardPage
            view={view}
            timers={settings.timers}
            going={going}
            onClose={() => setDialog(null)}
            api={{
              open: id => (setWsId(id), setDialog(null)),
              start: t => {
                // a folder's own workspace has its session already: another one beside it, for this prompt
                const plain = view.projects.find(p => p.id === t.project)?.git === false
                const prompt = withImages(t.text, (t.images ?? []).map(path => ({ path })))
                return call('wsNew', { project: t.project, prompt, place: 'top', ...(plain && { local: true, another: true, name: nameOf(t.text) }) }).then(() => call('todoRm', { id: t.id }))
              },
              add: (project, text, images) => call('todoAdd', { project, text, images }),
              saveImage: (data, ext) => api.call<string>('imageSave', { data, ext }),
              saveFile: (data, name) => api.call<string>('fileSave', { data, name }),
              rm: id => call('todoRm', { id }),
              menu: (e, w) =>
                openMenu(e, [
                  { label: 'Open', icon: 'arrowRight', key: 'o', run: () => (setWsId(w.id), setDialog(null)) },
                  null,
                  ...(w.kind === 'worktree' ? [{ label: 'Archive workspace', icon: 'archive', key: 'a', run: () => archive(w) } as MenuItem] : []),
                  { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(w) },
                ]),
              archiveAll: (e, merged) => openMenu(e, [{ label: `Archive all ${merged.length}`, icon: 'archive', key: 'a', run: async () => { for (const w of merged) await archive(w) } }], 'right'), // one by one: one with changes asks
            }}
          />
        )}
        {typeof dialog === 'object' && dialog && 'compare' in dialog && (
          <ComparePage
            view={view}
            race={dialog.compare}
            timers={settings.timers}
            onClose={() => setDialog(null)}
            api={{
              open: id => (setWsId(id), setDialog(null)),
              changes: id => api.call<Changes>('diff', { ws: id }),
              keep: async (winner, losers) => {
                if (!(await ask(`Keep ${wsName(winner)}?`, { text: `${losers.map(wsName).join(', ')} ${losers.length === 1 ? 'is' : 'are'} archived: tabs stop and worktrees go (the branches stay).`, ok: 'Archive the others', danger: true }))) return
                const gone: string[] = []
                const held: string[] = []
                await busyWith(losers.map(w => w.id), 'archiving', async () => {
                  for (const w of losers) if (await call<{ held?: GateHeld[] } | null>('wsArchive', { id: w.id }).then(r => (r?.held && held.push(`${wsName(w)} (${r.held.map(h => h.why).join('; ')})`), !r?.held), () => false)) gone.push(w.id) // held by a gate: it stays
                })
                setWsId(winner.id)
                setDialog(null)
                toast(`Kept ${wsName(winner)}, archived ${gone.length}${held.length ? `; a gate held ${held.join(', ')}` : ''}`, () => gone.reduce((p, id) => p.then(() => call('wsRestore', { id })), Promise.resolve<unknown>(undefined)).then(() => setWsId(winner.id), () => {}))
              },
            }}
          />
        )}
        {schedulesFor !== undefined && (
          <SchedulesPage
            key={schedulesFor /* another project's menu: its filter */}
            project={schedulesFor}
            view={view}
            onSeen={id => (setRunsSeen(id), localStorage.setItem('laki.runsSeen', JSON.stringify(id)))}
            onClose={() => setDialog(null)}
            api={{
              set: s => api.call('scheduleSet', s),
              rm: id => api.call('scheduleRm', { id }),
              run: id => api.call('scheduleRun', { id }),
              flows: flowsOn ? () => api.call('flowList', {}) : undefined,
              open: (w, t) => (setDialog(null), t && view.tabs.some(x => x.id === t) ? selectTab(t) : setWsId(w)),
              pick: async () => {
                const path = bridge ? await bridge.pickFolder() : prompt('The folder’s full path') // a browser has no folder picker
                return path?.trim() ? api.call<Project>('projectAdd', { path: path.trim() }) : null
              },
            }}
          />
        )}
        {dialog === 'new' && (
          <NewWorkspace
            key={`${newFor}${JSON.stringify(newInit ?? '')}`} // another project asked for while it's open (＋, a dropped folder, a link)
            view={{ ...view, projects: view.projects.filter(p => !p.kind) } /* Terminals and Browsers make theirs with + */}
            project={[newFor, ws?.project].find(id => view.projects.some(p => p.id === id && !p.kind))}
            agent={settings.agent}
            initial={newInit}
            images={newImages}
            inserts={project => extInserts({}, project)}
            onClose={() => {
              made.current.page++
              setDialog(null)
              setNewFor(undefined)
              setNewInit(undefined)
              setNewImages([])
            }}
            onCreate={async p => {
              // a row in the sidebar meanwhile (it stays when Esc closes the page: the workspace is still coming)
              const key = ++made.current.key
              const page = made.current.page
              const pr = prIn(p.prompt) // a prompt naming a PR: the workspace is named after it
              const name = p.name?.trim() || (pr ? `PR #${pr.replace(/.*\/pull\//, '')}` : nameOf(p.prompt ?? '')) || 'new workspace'
              setMaking(m => [...m, { key, project: p.project, place: p.place, name: p.fan ? `${name} ×${p.fan.length}` : name }])
              const gone = () => setMaking(m => m.filter(x => x.key !== key))
              // a race: a workspace per agent, then Compare
              // a PR whose branch a workspace has already: that one, a click away
              const got = await (p.fan
                ? call<WorkspaceView[]>('wsFan', { ...p, presets: p.fan })
                : api.call<WorkspaceView>('wsNew', p).then(
                    w => [w],
                    e => {
                      const there = (e as Error).message.match(/checked out in workspace (\S+)$/)?.[1]
                      toast((e as Error).message, there ? () => (setWsId(there), setDialog(null)) : undefined, 'Open it')
                      throw e
                    },
                  )
              ).finally(gone)
              if (page !== made.current.page) {
                // closed meanwhile: you went on with something else, which keeps the focus; the new one is a click away
                setReveal(r => [...r, ...got.map(w => w.id)])
                return toast(`${wsName(got[0])}${got.length > 1 ? ` and ${got.length - 1} more` : ''} ready`, () => showNew(got[0].id, ...got.slice(1).map(w => w.id)), 'Open', true)
              }
              showNew(got[0].id, ...got.slice(1).map(w => w.id))
              ;(pj => pj?.cfgWait && void cfgSheet(pj))(view?.projects.find(x => x.id === got[0].project))
              setDialog(d => (d !== 'new' ? d : p.fan && got[0].race ? { compare: got[0].race } : null))
              setNewFor(undefined)
              setNewInit(undefined)
              setNewImages([])
            }}
          />
        )}
        {ws && gallery === ws.id && ws.storage && (
          <ArtifactsBar
            ws={ws.id}
            n={ws.artifacts ?? 0}
            links={ws.links}
            onClose={() => setGallery(null)}
            api={{
              list: () => api.call<Artifact[]>('artifactList', { ws: ws.id }),
              read: path => api.call<FileContent>('fileRead', { ws: ws.id, path, storage: true }),
              reveal: bridge?.openPath && (path => revealArt(ws, path)),
              files: artifactsInFiles,
              menu: path => artMenu(ws, path),
              copy,
              page: path => (inViewer(path) ? artPage(ws, path) : undefined),
              external: bridge?.openPath && (path => inBrowser(ws, path)), // HTML as the sandboxed page (L11), as the right click's
            }}
          />
        )}
        {artView && (w => w && (
          <ArtifactView
            key={`${w.id}/${artView.path}`}
            path={artView.path}
            page={artPage(w, artView.path)}
            read={() => api.call<FileContent>('fileRead', { ws: w.id, path: artView.path, storage: true })}
            onExternal={bridge?.openPath && (() => inBrowser(w, artView.path))}
            onReveal={bridge?.openPath && (() => revealArt(w, artView.path))}
            onClose={() => setArtView(null)}
          />
        ))(view.workspaces.find(x => x.id === artView.ws))}
        {(ws?.browser === undefined || !connected) && ( // a browser page: none, unless something's wrong
        <div className="status">
          {tracked.length > 0 && ws?.browser === undefined && <UsageButton key={tracked.join()} load={() => api.call<AgentUsage[]>('usage').then(limits)} onUse={(agent, id) => call('settingsSet', { accountUse: { ...settings.accountUse, [agent]: id } }).catch(() => {})} today={costsOn && view.today ? { ...view.today, ws: view.today.ws.map(w => ({ ...w, name: (x => (x ? wsName(x) : 'a removed workspace'))(view.workspaces.find(x => x.id === w.ws)) })) } : undefined} /> /* remounts as agents are turned on or off */}
          {ws && ws.browser === undefined && ( // a page: no port, branch or folder of its own
            <>
              {ctxOn && tab?.context && (
                // the focused tab's context: how full, so you compact or start a new chat in time
                <span className="sb-ctx" data-tip={`${tab.name}'s context: ${ctxText(tab.context)}${costsOn && tab.usage ? ` · its chat used ${usageText(tab.usage)} at API prices` : ''} · /compact or a new chat before it fills`}>
                  <span className={`usage-bar ${level(ctxPct(tab.context))}`}>
                    <i style={{ width: `${ctxPct(tab.context)}%` }} />
                  </span>
                  {ctxPct(tab.context)}%
                </span>
              )}
              {git && (
                // short (no branch prefix, cut), all of it on hover; a click shows it whole, its base too
                <button
                  className={`sb-branch ${branchFull ? 'full' : ''}`}
                  data-tip={`${ws.kind === 'worktree' ? `${ws.branch} ← ${ws.base}` : `${ws.branch}, the repo itself`} · click: ${branchFull ? 'shorter' : 'all of it'}`}
                  onClick={() => setBranchFull(f => !f)}
                >
                  <Icon name="fork" size={11} />
                  {branchFull ? ws.branch : shortBranch(ws.branch)}
                  {branchFull && ws.kind === 'worktree' && <span className="muted"> ← {ws.base}</span>}
                </button>
              )}
              {ws.codespace !== undefined && (
                // a cloud workspace: its codespace and its state (why it failed, cut: all of it on hover)
                <button className="sb-flow" data-status={ws.csState === 'Failed' ? 'failed' : ws.csState === 'Available' ? undefined : 'waiting'} data-tip={`Codespace ${ws.codespace || '(being made)'}: ${csWord(ws.csState)}${ws.csError ? ` · ${ws.csError}` : ''} · click: your codespaces on GitHub`} onClick={() => openExternal('https://github.com/codespaces')}>
                  <span className="sb-flow-icon">
                    <Icon name="cloud" size={12} />
                  </span>
                  <span className="sb-flow-name">
                    codespace<span className="muted"> · {csWord(ws.csState)}{ws.csState === 'Failed' && ws.csError ? `: ${ws.csError}` : ''}</span>
                  </span>
                </button>
              )}
              {(pj =>
                pj?.cfgWait && (
                  // its repo's .laki.json, not trusted as it is: its setup, scripts and env wait for you
                  <button className="sb-flow" data-status="waiting" data-tip="This repo's .laki.json isn't trusted yet: its setup, scripts and env wait · click: look at it" onClick={() => cfgSheet(pj)}>
                    <span className="sb-flow-icon">
                      <Icon name="shieldAlert" size={11} />
                    </span>
                    <span className="sb-flow-name">.laki.json waits for you</span>
                  </button>
                ))(view.projects.find(x => x.id === ws.project))}
              {(f =>
                f && (
                  // the workflow run that made this workspace, or sent the focused tab its last block: a click opens it
                  <button className="sb-flow" data-status={f.status} data-tip={`Workflow run: ${f.name} · ${f.status}${f.block ? ` at ${f.block}` : ''} · click: open it`} onClick={() => setDialog({ workflows: '', run: f.id })}>
                    <span className="sb-flow-icon">
                      <Icon name={f.status === 'running' ? 'gear' : 'flow'} size={12} />
                    </span>
                    <span className="sb-flow-name">
                      {f.name}
                      {f.block && ['running', 'waiting', 'paused'].includes(f.status) && <span className="muted"> · {f.block}</span>}
                    </span>
                  </button>
                ))(flowsOn ? ([tab?.flow, ws.flow].map(id => id && view.flows?.find(r => r.id === id)).find(Boolean) || view.flows?.find(r => r.ws === ws.id && !FLOW_ENDED.includes(r.status))) : undefined)} {/* the tab's run gone (past the 100 kept): the workspace's; else one going in it (a workspace you picked) */}
              {!project?.kind && ( // a terminal in your home folder: no $PORT of its own to show
              <span className="port-item">
                <button
                  className={`listen ${portUp ? '' : 'port-main'}`}
                  data-tip={`$PORT · ${portUp ? 'listening · ' : ''}open http://localhost:${ws.port}`}
                  onClick={() => openPort(ws.port)}
                >
                  $PORT {ws.port}
                  {ws.portNames?.[ws.port] && <span className="port-name">{ws.portNames[ws.port]}</span>}
                </button>
                <TunnelButton key={ws.id} port={ws.port} tunnel={ws.tunnels?.find(t => t.port === ws.port)} api={tunnelApi(ws)} />
                {portStop(ws, ws.port)}
              </span>
              )}
              {ports.map(port => (
                <span key={`${ws.id}:${port}`} className="port-item">
                  <button className="listen" data-tip={ws.ports.includes(port) ? `listening · open http://localhost:${port}` : 'not listening now'} onClick={() => openPort(port)}>
                    ↗{port}
                    {ws.portNames?.[port] && <span className="port-name">{ws.portNames[port]}</span>}
                  </button>
                  <TunnelButton port={port} tunnel={ws.tunnels?.find(t => t.port === port) /* an older daemon has none */} api={tunnelApi(ws)} />
                  {portStop(ws, port)}
                </span>
              ))}
              <PRStatus w={infoOf(ws)} onOpen={openExternal} onToggle={(k, v) => setAuto(ws, k, v)} onMenu={e => openMenu(e, prMenu(ws))} />
              {attachable(ws) && ws.kind !== 'local' && (
                <button className="pr pr-attach" data-tip={`No PR found for ${ws.branch}: attach one by its URL or number`} onClick={() => setDialog({ attachPr: ws.id })}>
                  + PR
                </button>
              )}
              {ws.setup && <span className="warn-soft">setup running…</span>}
            </>
          )}
          {!!ws?.artifacts && ws.storage && ( // the files its agents keep for you ($LAKI_STORAGE_FOLDER): shown here; Finder and Files from the strip's ⋯
            <button
              className={`listen port-main ${gallery === ws.id ? 'on' : ''}`}
              data-tip={`${shortPath(ws.storage)}: what its agents keep for you ($LAKI_STORAGE_FOLDER) · ⌘⇧A`}
              onClick={toggleArtifacts}
            >
              Artifacts: {ws.artifacts}
            </button>
          )}
          <span className="spacer" />
          {view.remote && ws?.browser === undefined && (
            <button
              className={`remote-badge ${view.remote.url ? '' : 'starting'} ${view.remote.open ? 'open' : ''}`}
              data-tip={view.remote.open ? 'Remote access for anyone with the link (no email): Settings › Remote access' : `Remote access for ${view.remote.mail}: Settings › Remote access`}
              onClick={() => setDialog({ section: 'remote' })}
            >
              {!view.remote.url ? 'Remote starting…' : view.remote.open ? 'Remote: open to anyone with the link' : view.remote.until ? `Remote until ${new Date(view.remote.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Remote on'}
            </button>
          )}
          {!connected && <span className="warn" data-tip={problem}>{problem ? 'not connected: hover for why' : 'reconnecting…'}</span>}
          <WidgetStrip widgets={ownWidgets} api={widgetApi} place="status" />
          {!achKept.off && (
            <button className={`sb-trophy ${dialog === 'achievements' ? 'on' : ''}`} aria-label={`Achievements: ${achN} of ${achAll.length}`} data-tip={`Achievements: ${achN} of ${achAll.length} · click: what to try next`} onClick={() => setDialog(d => (d === 'achievements' ? null : 'achievements'))}>
              <Icon name="trophy" size={11} />
              {achN}/{achAll.length}
            </button>
          )}
          {aiFab && aiDock && (
            // the AI button minimized: here until its right click puts it back
            <button
              className={`sb-ai ${aiFloat ? 'on' : ''} ${fly}`}
              data-tip={`${aiFloat ? 'Close Laki AI (Esc)' : 'Ask Laki AI about what is on screen'} · right click: float the button again`}
              onClick={() => setAiFloat(o => !o)}
              onContextMenu={e => openMenu(e, [{ label: 'Float the button again', icon: 'popOut', run: () => dock(false) }])}
            >
              <Icon name="ai" size={11} />
              AI
            </button>
          )}
        </div>
        )}
        {aiFab && (
          <>
            {aiFloat && (
              <AiFloat>
                <AiPage compact settings={settings.ai ?? {}} workspaces={aiNames} onClose={() => setAiFloat(false)} context={whereNow} inserts={extInserts(hereCtx())} complete={completeOf(view, { project: extWs(ws)?.project })} />
              </AiFloat>
            )}
            {!aiDock && (
              <div className={`ai-fab-wrap ${fly}`}>
                <button type="button" className={`ai-fab ${aiFloat ? 'on' : ''}`} aria-label={aiFloat ? 'Close Laki AI' : 'Ask Laki AI'} data-tip={aiFloat ? 'Close (Esc)' : 'Ask Laki AI about what is on screen'} onClick={() => setAiFloat(o => !o)} onContextMenu={e => openMenu(e, [{ label: 'Minimize to the status bar', icon: 'minimize', run: () => dock(true) }])}>
                  <Icon name={aiFloat ? 'x' : 'ai'} size={17} />
                </button>
                {!aiFloat && (
                  <button type="button" className="ai-fab-min" aria-label="Minimize to the status bar" data-tip="Minimize to the status bar" onClick={() => dock(true)}>
                    <Icon name="minus" size={10} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {menu}
      <Tips />
      {peek && (w => w && peekCard(w))(live.find(w => w.id === peek.id))}
      <AskHost />
      <VoiceBar />
      {dropping && <div className="drop-overlay">Drop a folder to add it as a project</div>}
      {unlocked.length > 0 && (
        <button className={`ach-toast ${note ? 'up' : ''}` /* over a toast at the same time (an archive's Undo) */} aria-live="polite" onClick={() => (setUnlocked([]), setDialog('achievements'))}>
          <Icon name="trophy" size={14} />
          <span>
            Unlocked: <b>{ACHIEVEMENTS.find(a => a.id === unlocked.at(-1))?.title}</b>
            {unlocked.length > 1 && ` and ${unlocked.length - 1} more`}
          </span>
          <span className="muted small">{achN}/{achAll.length}</span>
        </button>
      )}
      {note && (
        <div className={`toast ${note.undo ? 'has-undo' : ''} ${note.ok || note.busy ? 'ok' : ''}`} role="status">
          {note.ok && <Icon name="check" size={14} />}
          {note.busy && <Glyph s="running" />}
          <span>{note.text}</span>
          {note.undo && (
            <button className="toast-undo" onClick={() => (setNote(null), note.undo!())}>
              {note.label ?? 'Undo'}
            </button>
          )}
        </div>
      )}
      {dialog === 'project' && (
        <AddProject
          onClose={() => setDialog(null)}
          onAdd={async path => {
            const p = await call<Project>('projectAdd', { path })
            newWs(p.id) // as a picked folder goes
          }}
        />
      )}
      {dialog === 'files' && ws && <FileFinder files={() => api.call<FileList>('files', { ws: ws.id })} onPick={path => panelApi(ws).preview(path)} onClose={() => setDialog(null)} />}
      {dialog === 'palette' && <Palette items={palette} forName={ws && wsName(ws)} onClose={() => setDialog(null)} />}
      <KeyOverlay on={settings.keyOverlay !== false && !narrow && !touch && !dialog} keys={settings.keys} />
      {dialog === 'ship' && ws && (
        <Prompt
          title={`Ship ${ws.id}`}
          busy={checking === `ship:${ws.id}` ? 'Checking…' : undefined}
          hint={`git add -A, commit, git push -u origin ${ws.branch}, gh pr create --fill — in a ship tab`}
          placeholder="Commit message"
          onClose={() => setDialog(null)}
          onSubmit={async message => {
            const t = await gated(ws, 'ship', force => call<TabView | { held: GateHeld[] }>('ship', { ws: ws.id, message, force }))
            setDialog(null)
            if (t && 'id' in t) selectTab(t)
          }}
        />
      )}
      {dialog === 'video' && (
        <Prompt
          title="Watch a YouTube video"
          placeholder="https://www.youtube.com/watch?v=…"
          hint="It plays at the bottom of the sidebar, beside your work; × closes it."
          onClose={() => setDialog(null)}
          onSubmit={async link => {
            const src = youtubeEmbed(link)
            if (!src) {
              toast('Not a YouTube link: a video, a short or a playlist')
              throw new Error('not YouTube') // the dialog stays open
            }
            setVideo({ src, play: true, at: Date.now() })
            earn('video')
            setSideOpen(true) // asked for from ⌘K with the sidebar hidden: shown, not just heard
            setDialog(null)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'timerCmd' in dialog && ws && (
        <Prompt
          title="When it ends, run"
          placeholder="say 'time is up' · npm test · open https://…"
          hint={`Runs through your login shell in ${wsName(ws)}, in a tab of its own (it closes when the command succeeds).`}
          initial={timers.find(t => t.id === dialog.timerCmd)?.cmd}
          onClose={() => setDialog(null)}
          onSubmit={async cmd => {
            setTimer(dialog.timerCmd, x => ({ ...x, then: 'command', cmd, ws: ws.id }))
            setDialog(null)
          }}
        />
      )}
      {dialog === 'timer' && (
        <TimerDialog
          where={ws ? wsName(ws) : undefined}
          onClose={() => setDialog(null)}
          onStart={(ms, cmd, note) => {
            addTimer(ms, { ...(cmd && ws && { then: 'command' as const, cmd, ws: ws.id }), ...(note && { note }) })
            setDialog(null)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'remind' in dialog && (
        <RemindDialog
          name={wsName(live.find(w => w.id === dialog.remind) ?? { id: dialog.remind })}
          onClose={() => setDialog(null)}
          onPick={ms => {
            addTimer(ms, { then: 'remind', ws: dialog.remind })
            setDialog(null)
            done(`I'll remind you at ${new Date(Date.now() + ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'sendLater' in dialog && (() => {
        const old = timers.find(t => t.id === dialog.edit)
        const agents = [
          ...(view?.tabs ?? []).filter(t => t.workspace === dialog.sendLater && t.kind === 'agent' && (t.status !== 'exited' || t.id === old?.tab)).map(t => ({ id: t.id, name: t.name })),
          ...(aiOn(settings) || old?.tab === 'ai' ? [{ id: 'ai', name: 'Laki AI' }] : []),
        ]
        const w = live.find(x => x.id === dialog.sendLater)
        const picks = mergeActions(settings.actions, view?.projects.find(p => p.id === w?.project)?.config?.actions).filter(a => a.target !== 'shell') // Run ▾'s agent actions
        return (
          <SendLaterDialog
            agents={agents}
            tab={old?.tab ?? dialog.to ?? (agents.some(t => t.id === tab?.id) ? tab!.id : undefined)}
            text={old?.text ?? dialog.text}
            at={old?.end}
            picks={picks}
            inserts={to => (t => extInserts(to === 'ai' ? hereCtx() : { ws: t?.workspace, tab: t?.id }))(view.tabs.find(x => x.id === to))}
            complete={to => (to === 'ai' ? completeOf(view, { project: w?.project }) : completeOf(view, { ws: view.tabs.find(x => x.id === to)?.workspace }))}
            onClose={() => setDialog(dialog.back ?? null)}
            onPick={o => {
              if (old) setTimer(old.id, x => ({ ...x, tab: o.tab, text: o.text, end: Date.now() + o.ms, ms: o.ms }))
              else addTimer(o.ms, { then: 'send', ws: dialog.sendLater, tab: o.tab, text: o.text })
              setDialog(dialog.back ?? null) // from the AI page: back there
              done(`It goes to ${agents.find(t => t.id === o.tab)?.name ?? 'the agent'} at ${new Date(Date.now() + o.ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
            }}
          />
        )
      })()}
      {typeof dialog === 'object' && dialog && 'timerNote' in dialog && (
        <Prompt
          title="The timer's message"
          initial={timers.find(t => t.id === dialog.timerNote)?.note ?? ''}
          placeholder="Go out · Stretch · Check the oven"
          hint="On its bar, and what it says as it ends."
          onClose={() => setDialog(null)}
          onSubmit={async typed => {
            setTimer(dialog.timerNote, x => ({ ...x, note: typed.trim().slice(0, 120) || undefined }))
            setDialog(null)
          }}
        />
      )}
      {typeof dialog === 'object' && dialog && 'timer' in dialog && (
        <Prompt
          title="Start this timer over with"
          placeholder="25 · 1h 30m · 90s"
          hint="Minutes, or with units (h, m, s); up to a day. It starts at once."
          onClose={() => setDialog(null)}
          onSubmit={async typed => {
            const ms = parseDuration(typed)
            if (!ms) {
              toast('A length like 25, 1h 30m or 90s, up to 24 hours')
              throw new Error('no length') // the dialog stays open
            }
            restart(dialog.timer, ms)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'custom' && ws && (
        <Prompt
          title="New tab: command"
          placeholder="aider --model sonnet"
          hint="Runs through your login shell, in the workspace."
          onClose={() => setDialog(null)}
          onSubmit={async cmd => {
            setDialog(null)
            await newTab('custom', cmd)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'rename' in dialog && byId(dialog.rename) && (
        <Prompt
          title="Rename"
          initial={byId(dialog.rename)!.name}
          onClose={() => setDialog(null)}
          onSubmit={async name => {
            await call('tabSet', { id: dialog.rename, name })
            setDialog(null)
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && 'sep' in dialog && (() => {
        const p = view.projects.find(p => p.id === dialog.sep)
        const s = p?.seps?.find(x => x.id === dialog.id)
        const tpls = templatesFor(settings.templates, p?.config?.templates)
        return (
        <Prompt
          title={dialog.id ? 'Edit group' : 'New group'}
          hint={dialog.id ? undefined : 'A named line between workspaces. Drag it, or them, to sort.'}
          initial={s?.name}
          pick={tpls.length || s?.template ? { label: 'Default prompt template: a new workspace here starts with it', none: 'None: the last one used', options: tpls.map(t => t.name), value: s?.template } : undefined}
          onClose={() => setDialog(null)}
          onSubmit={async (name, template) => {
            await sepName(dialog, name, template)
            setDialog(null)
          }}
        />
        )
      })()}
      {dialog && typeof dialog === 'object' && 'notes' in dialog && (p => p && <ProjectNotes name={p.name} notes={p.notes ?? ''} onSave={notes => call('projectSet', { id: p.id, notes })} onClose={() => setDialog(null)} />)(view?.projects.find(p => p.id === dialog.notes))}
      {dialog && typeof dialog === 'object' && 'attachPr' in dialog && (w => w && (
        <Prompt
          title="Attach a pull request"
          placeholder="https://github.com/owner/repo/pull/12, or 12"
          hint={`Its URL, or its number in this repo. Its status and checks show here; the PR switches work when its branch is this workspace's (${w.branch}).`}
          onClose={() => setDialog(null)}
          onSubmit={async pr => {
            const r = await call<{ number: number; linked: boolean }>('prAttach', { ws: w.id, pr })
            setDialog(null)
            done(`PR #${r.number} attached${r.linked ? ': only linked, its branch is another one' : ''}`)
          }}
        />
      ))(live.find(w => w.id === dialog.attachPr))}
      {dialog && typeof dialog === 'object' && 'ciLog' in dialog && (w => w && (
        <CiLog
          key={dialog.job}
          name={dialog.name}
          url={dialog.url}
          load={() => api.call<string>('prLog', { ws: w.id, job: dialog.job }) /* its failure shows in it, not as a toast */}
          onSend={() => prFix(w, 'ci', dialog.job)}
          onOpen={openExternal}
          copy={copy}
          onClose={() => setDialog(null)}
        />
      ))(live.find(w => w.id === dialog.ciLog))}
      {dialog && typeof dialog === 'object' && 'renameWs' in dialog && live.some(w => w.id === dialog.renameWs) && (
        <Prompt
          title="Rename workspace"
          hint="Only the name shown here: the folder and branch keep the id. Enter the id to go back to it."
          initial={(w => w.name || w.id)(live.find(w => w.id === dialog.renameWs)!)}
          onClose={() => setDialog(null)}
          onSubmit={async name => {
            await call('wsSet', { id: dialog.renameWs, name })
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}
