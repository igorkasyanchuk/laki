import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { API, rowsOf, type WsSort, type Doctor, type LogLine, type MergeMethod, PR_SCAN, PR_TRIES, prAllows, prIn, type PR, type Project, type ProjectLook, type Sep, type SideLook, type NotifyKind, type ProjectConfig, type Resources, type TabView, type View, type WorkspaceView } from '../../shared/types'
import { stamp } from '../../shared/when'
import { api, bridge, notify, type NotifyAction, onLakiLink, openExternal } from './api'
import { DOCK_ICONS, dockPng } from './dock'
import { BrowserPane } from './Browser'
import { type AutoKey, Avatar, ciText, type FixWhat, INFO_WIDTH, InfoPanel, MERGE_WORDS, type PRAct, prState, PRStatus, REVIEW, reviewersText, type WsInfo } from './Info'
import { About, AddProject, type Artifact, ArtifactsBar, Fun, Logs, OnboardBar, Onboarding, ProjectNotes, type Meme, NewWorkspace, type NewWsParams, Palette, type PaletteItem, Prompt, Ready, RemindDialog, SendLaterDialog, type Shot, StarLaki, STEPS, StopwatchBar, TimerBar, TimerDialog, Video, videoCommand, Welcome } from './panels'
import { type AppInfo, FONT_SIZE, isSection, PAGE_ZOOMS, SettingsPage, type SkillInfo, termLook } from './Settings'
import { AiPage } from './Ai'
import { ProjectPage, type ProjectTab } from './Project'
import { BoardPage } from './Board'
import { type WidgetApi, WidgetDialog, WidgetGrid } from './Widgets'
import type { WidgetSay } from '../../shared/widget'
import { ComparePage } from './Compare'
import { Glyph, rollup } from './Glyph'
import icon from './icon.svg'
import { HelpPage } from './Help'
import { Term, xterms } from './Term'
import { groupsOf, type Layout, move, resize, tabsOf } from './layout'
import { parseLink, wsLink } from './links'
import { Panes, SideHandle, useTabDrag } from './Panes'
import { actionMenu, type Changes, type Edit, edited, type FileContent, FileFinder, type FileList, FilePreview, type PanelApi, type PanelTab, PANEL_WIDTH, type PRFiles, RunButton, SidePanel, type Thread } from './SidePanel'
import { SchedulesPage } from './Schedules'
import { actionsFor, clock, mergeActions, nameOf, parseDuration, type RunAction, shortPath, templatesFor, youtubeEmbed } from './text'
import { applyTheme, blurred, css, LESS_CLEAR, MORE_CONTRAST, type Paint, paintKey, paintOf, transparent } from './themes'
import { type Cloudflared, portsOf, TunnelButton, type TunnelApi } from './Tunnel'
import { type AgentUsage, USAGE_AGENTS, UsageButton } from './Usage'
import { ask, AskHost, choose, colorVar, Icon, IconButton, type IconName, keep as store, load, type MenuItem, moveId, ON, StaleDaemon, TAB_COLORS, Tips, TurnTime, useMenu, useRowDrag } from './ui'

type Dialog = null | 'new' | 'project' | 'palette' | 'onboard' | 'files' | 'ship' | 'custom' | 'settings' | 'help' | 'about' | 'board' | 'ai' | 'schedules' | 'fun' | 'video' | 'timer' | { timer: string } | { timerNote: string } | { remind: string } | { sendLater: string; edit?: string; to?: string; text?: string; back?: 'ai' } | { timerCmd: string } | { schedules: string } | { compare: string } | { widget: string } | { settings: string; script?: 'run'; spot?: string } | { section: string } | { rename: string } | { renameWs: string } | { sep: string; id?: string } | { logs: string; title: string } | { attachPr: string } | { notes: string } | { project: string; tab?: ProjectTab }

// the Scheduled tasks page: closed (undefined), all projects (''), or a project's (its ⋯ menu)
const schedulesOf = (d: Dialog) => (d === 'schedules' ? '' : d && typeof d === 'object' && 'schedules' in d ? d.schedules : undefined)
// the Settings page, in any of its forms: all of it, a project's, or a section asked for
const settingsOf = (d: Dialog) => d === 'settings' || (typeof d === 'object' && !!d && ('settings' in d || 'section' in d))

// a tab's color: its own, else its agent's ('none' turns that off)
const AGENT_COLORS: Record<string, string> = { claude: 'orange', codex: 'teal', gemini: 'blue', grok: 'purple', opencode: 'green' }
const colorOf = (t?: TabView) => t?.color ?? AGENT_COLORS[t?.preset ?? '']

// where a folder opens: editors (one of them is ⌘E's), Finder, terminals
const EDITOR_IDS = ['cursor', 'zed', 'vscode', 'windsurf', 'antigravity', 'sublime', 'webstorm', 'intellij', 'xcode', 'custom']
type Where = { ws?: string; project?: string; widget?: string; file?: string } // what Open in opens: a folder (a widget's too), or a file in a workspace
const WEB = /\.(x?html?|svg|pdf|xml|json|png|jpe?g|gif|webp)$/i // what browsers show
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

const tabGlyph = (t: TabView) => (t.limit ? 'limit' : t.done && t.status === 'idle' ? 'done' : t.status === 'exited' && t.code === 0 ? 'ok' : t.status)
const SIDE = 240 // the sidebar's default width
// the rail layout (Settings › Appearance › Layout): a kind each, its words, its icon
type RailKind = 'projects' | 'shells' | 'browsers'
const RAIL: [RailKind, string, IconName][] = [['projects', 'Projects', 'fork'], ['shells', 'Terminal', 'terminal'], ['browsers', 'Browser', 'globe']]
let requests = 0
const wsName = (w: { id: string; name?: string }) => w.name || w.id

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
  const [problem, setProblem] = useState<string | undefined>() // the remote page: why it can't connect
  const [going, setGoing] = useState<Record<string, string>>({}) // workspaces being archived or deleted: a spinner on their rows
  const [making, setMaking] = useState<{ key: number; project: string; place?: string; name: string }[]>([]) // new ones on their way: a row each
  const made = useRef({ key: 0, page: 0 }) // making's keys; page: the new-workspace page's closes (one closed mid-create isn't the one open now)
  const [wsId, setWsId] = useState<string | null>(() => load('laki.ws', null))
  const [tabByWs, setTabByWs] = useState<Record<string, string>>(() => load('laki.tabs', {})) // the focused pane's session
  const [dialog, setDialog] = useState<Dialog>(null)
  const settingsKey = useMemo(() => ++requests, [dialog]) // each request remounts the settings page where it asks
  const [newFor, setNewFor] = useState<string>() // a project just opened: its new-workspace dialog
  const [newInit, setNewInit] = useState<Partial<NewWsParams>>() // a laki://new link's prompt, preset, name
  const [newImages, setNewImages] = useState<Shot[]>([]) // the menu bar's screenshots, in the new workspace's prompt
  const [link, setLink] = useState<string>() // a laki:// link, routed once the view is in
  const [panelOpen, setPanelOpen] = useState<boolean>(() => load('laki.panel', false)) // the right panel: files, changes, review
  const [panelTab, setPanelTab] = useState<PanelTab>(() => load('laki.panelTab', 'files'))
  const [panelW, setPanelW] = useState<number>(() => load('laki.panelW', PANEL_WIDTH))
  const [preview, setPreview] = useState<{ ws: string; path: string; line?: number; n: number; edit?: Edit } | null>(null) // a file shown in the app; n: each request reloads it; edit: its unsaved edit
  // the workspaces whose info panel is open (⌘I): each its own, so another one opens without it (an older boolean: none)
  const [infoOn, setInfoOn] = useState<string[]>(() => (x => (Array.isArray(x) ? x.filter(i => typeof i === 'string') : []))(load<unknown>('laki.info', [])))
  const [infoW, setInfoW] = useState<number>(() => load('laki.infoW', INFO_WIDTH))
  const [finds, setFinds] = useState<Record<string, number>>({}) // ⌘F presses per session, for its find bar
  const [stored, setStored] = useState<Record<string, Layout[]>>(() => load('laki.groups', {})) // tabs (of panes) per workspace
  const [sideW, setSideW] = useState<number>(() => load('laki.side', SIDE))
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
  const [note, setNote] = useState<{ text: string; undo?: () => void; label?: string; ok?: boolean; busy?: boolean } | null>(null) // the toast, maybe with Undo (or another action: label); ok: done, not a failure; busy: under way, until the next one
  const [menu, showMenu] = useMenu()
  const [gallery, setGallery] = useState<string | null>(null) // the workspace whose Artifacts show over the status bar
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
  const ws = live.find(w => w.id === wsId) ?? order[0] ?? null
  const info = !!ws && infoOn.includes(ws.id)
  const setInfo = (on: boolean, id = ws?.id) => void (id && setInfoOn(l => (on ? (l.includes(id) ? l : [...l, id]) : l.filter(x => x !== id))))
  const previewed = ws && preview?.ws === ws.id ? preview : null // the file preview, when it's this workspace's
  const project = view?.projects.find(p => p.id === ws?.project)
  const git = project?.git !== false
  const tabs = useMemo(() => view?.tabs.filter(t => t.workspace === ws?.id) ?? [], [view, ws])
  const byId = (id: string) => tabs.find(t => t.id === id)
  const placed = groupsOf(stored[ws?.id ?? ''], tabs.map(t => t.id))
  const groups = narrow ? placed.flatMap(g => tabsOf(g).map(tab => ({ tab }))) : placed // too narrow for splits: a tab per pane
  const tab = tabs.find(t => t.id === tabByWs[ws?.id ?? '']) ?? tabs.find(t => t.kind === 'agent') ?? tabs[0] ?? null
  const group = groups.find(g => tabsOf(g).includes(tab?.id ?? '')) ?? null
  const visible = tabsOf(group)

  useEffect(() => void localStorage.setItem('laki.ws', JSON.stringify(ws?.id ?? null)), [ws?.id])
  useEffect(() => void localStorage.setItem('laki.tabs', JSON.stringify(tabByWs)), [tabByWs])
  useEffect(() => void localStorage.setItem('laki.groups', JSON.stringify(stored)), [stored])
  useEffect(() => void localStorage.setItem('laki.side', JSON.stringify(sideW)), [sideW])
  useEffect(() => void localStorage.setItem('laki.sideOpen', JSON.stringify(sideOpen)), [sideOpen])
  useEffect(() => void localStorage.setItem('laki.rail', JSON.stringify(railKind)), [railKind])
  useEffect(() => void localStorage.setItem('laki.folded', JSON.stringify(folded)), [folded])
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
  useEffect(() => void localStorage.setItem('laki.info', JSON.stringify(infoOn.filter(id => view?.workspaces.some(w => w.id === id) ?? true))), [infoOn]) // gone ones drop out
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
  const addTimer = (ms: number, more: Partial<Timer> = {}) => setTimers(l => [...l, { id: Math.random().toString(36).slice(2, 10), end: Date.now() + ms, ms, then: 'notify', ...more }])
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
    localStorage.setItem('laki.infoW', JSON.stringify(infoW))
  }, [panelOpen, panelTab, panelW, infoW])

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
    return t ? [{ tab: t.id, name: wsName(w), project: view!.projects.find(p => p.id === w.project)?.name ?? '', status: t.status as 'running' | 'waiting' | 'idle' | 'done', color: w.color && w.color !== 'none' ? w.color : undefined, last: last?.replace(/\s+/g, ' ').trim().slice(0, 300), ...floatMore(w) }] : []
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
    .map(({ t, w }) => ({ tab: t.id, name: wsName(w), project: view!.projects.find(p => p.id === w.project)?.name ?? '', status: (t.done ? 'done' : 'idle') as 'idle' | 'done', color: w.color && w.color !== 'none' ? w.color : undefined, last: t.last && `Its last answer: ${t.last.replace(/\s+/g, ' ').trim().slice(0, 300)}`, ...floatMore(w) }))
  const floats = [...atWork, ...recent].slice(0, Math.max(1, fs?.floaterMax ?? 12))
  const floatColors = useMemo(() => Object.fromEntries(([['bg', '--panel'], ['fg', '--fg'], ['muted', '--muted'], ['line', '--line'], ['running', '--running'], ['waiting', '--waiting'], ['done', '--done'], ['accent', '--accent'], ['font', '--ui-font'], ...TAB_COLORS.map(c => [`tc${c}`, `--tc-${c}`])] as const).map(([k, v]) => [k, css(v)])), [theme]) // as painted just above
  const floatOpts = { style: fs?.floaterStyle ?? 'gradient', cards: fs?.floaterCards !== false, add: fs?.floater !== false && fs?.floaterNew !== false, menu: fs?.floaterMenu === 'card' ? 'card' : 'stack', voiceTo: fs?.floaterVoiceTo === 'new' ? 'new' : 'pick', doneAlert, ai: !!fs?.ai?.on }
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

  // a session by id, or one just created (its view may not have arrived yet)
  const selectTab = useCallback((ref: string | { id: string; workspace: string }) => {
    const t = typeof ref === 'string' ? viewRef.current?.tabs.find(t => t.id === ref) : ref
    if (!t) return
    mru.current = [t.id, ...mru.current.filter(x => x !== t.id)].slice(0, 200)
    setWsId(t.workspace)
    setTabByWs(m => ({ ...m, [t.workspace]: t.id }))
  }, [])
  const selectGroup = (g: Layout) => selectTab(mru.current.find(id => tabsOf(g).includes(id)) ?? tabsOf(g)[0])
  const setGroups = (next: Layout[]) => ws && !narrow && setStored(m => ({ ...m, [ws.id]: next })) // narrow shows them flat: kept as they were

  // the daemon connection
  useEffect(() => {
    const off = api.on(m => {
      if (m.ev === 'state') setView(m.view)
      else if (m.ev === 'problem') setProblem(m.text)
      else if (m.ev === 'open') {
        setConnected(true)
        setProblem(undefined)
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
      } else if (m.ev === 'archived') {
        // several at once (the setting just turned on): one message, whose Undo brings them all back
        const all = (archived.current = [...archived.current, m.ws])
        clearTimeout(archivedTimer.current)
        archivedTimer.current = setTimeout(() => (archived.current = []), 8000)
        toast(all.length > 1 ? `Archived ${all.length} workspaces: their PRs merged` : `Archived ${m.name}: PR #${m.pr} merged`, () => {
          archived.current = []
          for (const id of all) call('wsRestore', { id }).catch(() => {})
        })
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
      const w = view.workspaces.find(w => w.id === l.ws) ?? [...view.workspaces].sort((a, b) => +!!a.archived - +!!b.archived).find(w => wsName(w) === l.ws)
      const t = view.tabs.find(t => t.id === l.tab && t.workspace === w?.id)
      if (!w) toast(`No workspace ${l.ws}`)
      else if (w.archived) toast(`${wsName(w)} is archived`)
      else {
        setDialog(null)
        t ? selectTab(t) : setWsId(w.id)
      }
    } else if (l?.to === 'new') {
      if (!view.projects.length) return toast('Add a project first (⌘O)')
      const presets = [...view.presets.filter(p => !p.off).map(p => p.name), 'shell', 'none']
      if (l.project && !proj(l.project)) toast(`No project ${l.project}: pick one`)
      setNewFor(proj(l.project))
      setNewInit({ prompt: l.prompt, name: l.name, ...(l.preset && presets.includes(l.preset) && { preset: l.preset }) })
      setDialog('new')
    } else if (l?.to === 'schedules') setDialog({ schedules: proj(l.project) ?? '' })
    else if (l?.to === 'settings') setDialog(l.section && isSection(l.section) ? { section: l.section } : 'settings')
    else if (l?.to === 'help') setDialog('help')
    else if (l?.to === 'board') setDialog('board')
    else if (l?.to === 'ai') setDialog('ai')
    else if (l?.to === 'about') setDialog('about')
    else if (l?.to === 'onboard') (setOnboard(o => ({ ...o, off: false })), setDialog('onboard'))
    else toast(`Laki can't open ${link.slice(0, 80)}`)
  }, [link, view])

  // tell the daemon what's on screen: it clears ● there and doesn't set it
  const current = useRef<string | null>(null)
  current.current = tab?.id ?? null
  const shownTabs = useRef<string[]>([])
  shownTabs.current = visible
  useEffect(() => {
    // shown: the window isn't hidden (closing it only hides it), so widgets fetch only while it's open
    const report = () => api.send('view', { tab: current.current, tabs: shownTabs.current, focused: document.hasFocus(), browse: !!bridge?.browse, shown: document.visibilityState === 'visible' })
    report()
    window.addEventListener('focus', report)
    window.addEventListener('blur', report)
    document.addEventListener('visibilitychange', report)
    const off = api.on(m => m.ev === 'open' && report())
    return () => {
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', report)
      document.removeEventListener('visibilitychange', report)
      off()
    }
  }, [tab?.id, visible.join()])

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
    const t = await call<TabView>('tabNew', { ws: ws.id, preset: 'shell' })
    setGroups(move([...groups, { tab: t.id }], t.id, false, { pane: next, edge }))
    selectTab(t)
  }

  const closeTabs = async (ts: TabView[]) => {
    const running = ts.filter(t => t.status !== 'exited')
    if (running.length && !settings.closeNoAsk && !(await ask(`Close ${ts.map(t => t.name).join(', ')}?`, { text: `${running.length > 1 ? 'Their processes' : 'Its process'} will be stopped.`, ok: 'Close', danger: true }))) return
    for (const t of ts) await call('tabClose', { id: t.id })
  }

  // ⌘↑ ⌘↓: the rows in sight, not those a folded project or group hides
  const moveWs = (d: number) => {
    const seen = order.filter(w => (w.id === ws?.id || !foldedAway(w)) && (!rail || kindOf(w) === railKind)) // the rail's: its list's
    if (!seen.length) return
    const i = Math.max(0, seen.findIndex(w => w.id === ws?.id))
    setWsId(seen[(i + d + seen.length) % seen.length].id)
  }
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
  const busyWith = async <T,>(ids: string[], what: string, f: () => Promise<T>) => {
    setGoing(g => ({ ...g, ...Object.fromEntries(ids.map(id => [id, what])) }))
    try {
      return await f()
    } finally {
      setGoing(g => Object.fromEntries(Object.entries(g).filter(([id]) => !ids.includes(id))))
    }
  }
  const rmWs = async (w: WorkspaceView) => {
    if (!(await ask(`Delete ${wsName(w)}?`, { text: `Its tabs stop${w.kind === 'worktree' ? ', the worktree is removed (the branch stays)' : ''}.`, ok: 'Delete', danger: true }))) return
    if (!(await busyWith([w.id], 'deleting', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return // the toast says why
    done(`Deleted ${wsName(w)}${w.kind === 'worktree' && w.branch ? `: its branch ${w.branch} stays` : ''}`)
  }
  // archive: at once when nothing is uncommitted (Undo brings it back), else asked first: the worktree goes, with them
  const archive = async (w: WorkspaceView) => {
    const old = (view?.api ?? 0) < 12 // its daemon archives whatever is there: ask
    const r = old ? { dirty: -1 } : await busyWith([w.id], 'archiving', () => call<{ dirty?: number } | null>('wsArchive', { id: w.id, ifClean: true }).catch(() => undefined))
    if (r === undefined) return // the toast says why
    if (r?.dirty) {
      const lost = r.dirty > 0 ? `${r.dirty} uncommitted ${r.dirty === 1 ? 'change goes' : 'changes go'} with the worktree` : 'the worktree is removed'
      if (!(await ask(`Archive ${wsName(w)}?`, { text: `Its tabs stop and ${lost} (the branch stays).`, ok: 'Archive', danger: true }))) return
      if (!(await busyWith([w.id], 'archiving', () => call('wsArchive', { id: w.id }).then(() => true, () => false)))) return
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
  const showNew = (id: string, ...more: string[]) => (setReveal(r => [...r, ...(wsId ? [wsId] : []), id, ...more]), setWsId(id))
  const forkWs = (w: WorkspaceView) => call<WorkspaceView>('wsFork', { id: w.id }).then(x => showNew(x.id), () => {})

  const run = async () => ws && selectTab(await call<TabView>('run', { ws: ws.id }))
  // one panel on the right: the side panel (on a tab) or the info panel
  const showPanel = (t: PanelTab) => (setPanelTab(t), setPanelOpen(true), setInfo(false))
  const panelShown = panelOpen && !info // this workspace's info open: it shows instead
  const togglePanel = (t = panelTab) => (panelShown && t === panelTab ? setPanelOpen(false) : showPanel(t))
  const showInfo = (on = !info, id = ws?.id) => (setInfo(on, id), on && setPanelOpen(false))
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
    const r = await call<{ queued?: number }>('send', { target: t.id, text: stamp(a.text, Date.now()), whenIdle: a.target !== 'shell' }).catch(() => null) // its {{HH:mm}}-style dates: now's
    if (r?.queued) toast(`${a.name}: queued for when the agent's turn ends`)
  }
  const actionItems = (w: WorkspaceView): MenuItem[] => {
    const live = tabs.filter(t => t.status !== 'exited').map(t => ({ id: t.id, agent: t.kind === 'agent' ? t.preset : undefined, shell: t.kind === 'shell' }))
    return actionMenu(actionsFor(settings.actions, project?.config?.actions, live, tab?.id), id => byId(id)?.name, (a, t) => runAction(w, a, t))
  }
  const runMenu = (): MenuItem[] =>
    ws
      ? [
          { label: devTab ? 'Restart' : 'Run', icon: 'run', key: 'r', run: () => (ws.run ? run() : editScripts()) },
          ...(devRunning ? [{ label: 'Stop', icon: 'stop', key: 's', run: () => api.send('input', { tab: devTab!.id, data: '\x03' }) } as MenuItem] : []),
          ...(devTab ? [{ label: 'Show the run tab', icon: 'terminal', key: 't', run: () => selectTab(devTab.id) } as MenuItem] : []),
          { label: `Open localhost:${ws.port}`, icon: 'link', key: 'o', run: () => openPort(ws.port) },
          ...actionItems(ws),
          null,
          { label: ws.run ? 'Edit the run script…' : 'Set a run script…', icon: 'pencil', key: 'e', run: editScripts },
          ...(project && !project.kind ? [{ label: 'Edit actions…', icon: 'pencil', run: () => setDialog({ settings: project.id, spot: 'Actions' }) } as MenuItem] : []),
        ]
      : []
  // the file preview goes (closed, or another file shown): an unsaved edit only once you say so
  const leavePreview = async () => !edited(preview?.edit) || ask(`Discard your changes to ${preview!.path.split('/').pop()}?`, { text: "They aren't saved.", ok: 'Discard', danger: true })
  const closePreview = async () => void ((await leavePreview()) && setPreview(null))
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
  const panelApi = (w: WorkspaceView): PanelApi => ({
    files: () => api.call<FileList>('files', { ws: w.id }),
    newFile: (path, dir) => api.call<{ path: string }>('fileNew', { ws: w.id, path, dir }).then(r => r.path),
    openFile: file => void call('openIn', { ws: w.id, app: 'editor', file }).catch(() => {}),
    preview: async (path, line) => (await leavePreview()) && setPreview({ ws: w.id, path, line, n: ++requests }),
    changes: () => api.call<Changes>('diff', { ws: w.id }),
    prChanges: () => api.call<Changes>('prDiff', { ws: w.id }),
    prFiles: () => api.call<PRFiles>('prFiles', { ws: w.id }),
    setViewed: (path, viewed, id) => api.call('prViewed', { ws: w.id, path, viewed, id }),
    read: (path, base) => api.call<FileContent>('fileRead', { ws: w.id, path, base }),
    threads: () => api.call<Thread[]>('prThreads', { ws: w.id }),
    comment: c => api.call('prComment', { ws: w.id, ...c }).then(() => toast(`Commented on PR #${w.pr?.number}`)),
    toAgent: text => api.call('send', { target: w.id, text, whenIdle: true }).then(() => toast('Sent to the agent')),
    saveImage: data => api.call<string>('imageSave', { data, ext: 'png' }),
    // the focused agent if it's this workspace's, else its first live one; then its pane gets the keys
    toPrompt: text => {
      const live = view?.tabs.filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited') ?? []
      const to = live.find(t => t.id === tab?.id) ?? live[0]
      if (!to) return Promise.reject(new Error('No agent runs here: start one (＋ in the tab bar)'))
      return api.call('send', { target: to.id, text, enter: false }).then(() => (selectTab(to.id), xterms.get(to.id)?.focus(), toast(`In ${to.name}'s prompt: say what to do with it`)))
    },
    menu: (e, path, dir) => openMenu(e, fileMenu(w, path, dir)),
  })
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => done('Copied'), fail)
  const tunnelApi = (w: WorkspaceView): TunnelApi => ({
    check: () => api.call<Cloudflared>('cloudflared', { ws: w.id }),
    start: (port, mails) => api.call('tunnelStart', { ws: w.id, port, mails }),
    stop: port => api.call('tunnelStop', { ws: w.id, port }),
    open: openExternal,
    copy,
  })
  const settings = view?.settings ?? {}
  // a rail of kinds (Slack's) beside a list of the one picked; a phone keeps the one drawer
  const rail = !narrow
  const railWords = settings.railLabels !== false // its own setting: words under its icons, or icons only (narrower)
  const railW = railWords ? 68 : 52
  const kindOf = (w: WorkspaceView): RailKind => view?.projects.find(p => p.id === w.project)?.kind ?? 'projects'
  const lastIn = useRef<Partial<Record<RailKind, string>>>({}) // each kind's last workspace: its rail button goes back there
  useEffect(() => {
    if (!ws || !project) return
    const k = project.kind ?? 'projects'
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
  ]
  const openPort = (port: number) => openExternal(`http://localhost:${port}`)
  // widgets: the sidebar's grid and a widget's dialog (Widgets.tsx)
  const widgetApi: WidgetApi = {
    render: (id, full) => api.call<string | null>('widgetRender', { id, full }),
    run: id => call('widgetRun', { id }),
    open: openExternal,
    full: id => setDialog({ widget: id }),
    close: () => setDialog(null),
    action: (id, action, arg, label) => {
      const what = label || action
      clearTimeout(noteTimer.current)
      setNote({ text: `${what}…`, busy: true }) // something is happening, until it says what
      return api.call<{ ok: boolean; out?: string; error?: string } & WidgetSay>('widgetAction', { id, action, arg }).then(
        r => (!r.ok ? toast(`${what} failed: ${r.error}`) : r.toast || r.modal ? (setNote(null), widgetApi.say(id, r)) : done(r.out || `${what}: done`)),
        e => toast(`${what} failed: ${(e as Error).message}`),
      )
    },
    say: (id, s) => {
      if (s.toast) done(s.toast)
      const m = s.modal
      if (m)
        void choose(m.title, m.text, m.buttons).then(i => {
          const b = m.buttons[i]
          if (b?.run) void widgetApi.action(id, b.run, b.arg ?? '', b.label)
          else if (b?.open && /^laki:\/\//i.test(b.open)) setLink(b.open)
          else if (b?.open) openExternal(b.open)
        })
    },
    settings: () => setDialog({ section: 'widgets' }),
    key: view?.widgetKey,
  }
  const fontSize = settings.fontSize ?? FONT_SIZE
  const zoomed = useRef(fontSize) // the size asked for last: quick presses add up before the view comes back
  const zoom = (d: number) => {
    if (pageOpen) return zoomPage(d)
    zoomed.current = d ? Math.min(32, Math.max(8, zoomed.current + d)) : FONT_SIZE
    call('settingsSet', { fontSize: zoomed.current }).catch(() => {})
  }
  useEffect(() => void (zoomed.current = fontSize), [fontSize])
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
    { label: folded.includes(s.id) ? 'Expand' : 'Collapse', icon: folded.includes(s.id) ? 'chevron' : 'chevronRight', key: 'c', run: () => fold(s.id) },
    { label: 'Rename or set its template…', icon: 'pencil', key: 'r', run: () => setDialog({ sep: p.id, id: s.id }) },
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
  const wsMenu = (w: WorkspaceView): MenuItem[] => [
    { colors: TAB_COLORS, value: w.color, pick: c => call('wsSet', { id: w.id, color: c }) },
    { label: 'Rename…', icon: 'pencil', key: 'r', run: () => setDialog({ renameWs: w.id }) },
    { label: 'Info', icon: 'info', key: 'i', run: () => (setWsId(w.id), showInfo(true, w.id)) },
    { label: 'Open in', icon: 'code', key: 'o', items: openInItems({ ws: w.id }) },
    { label: w.muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', run: () => call('wsSet', { id: w.id, muted: !w.muted }) },
    { label: 'Remind me…', icon: 'timer', key: 'e', run: () => setDialog({ remind: w.id }) },
    { label: w.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', key: 'p', run: () => call('wsSet', { id: w.id, pinned: !w.pinned }) },
    ...(agentTab(w.id) ? [{ label: 'Mark as unread', icon: 'unread', key: 'u', run: () => markUnread(agentTab(w.id)!.id) } as MenuItem] : []),
    ...(w.race ? [{ label: 'Compare the race', icon: 'race', key: 'c', run: () => setDialog({ compare: w.race! }) } as MenuItem] : []),
    ...(w.branch ? [{ label: 'Copy branch name', icon: 'copy', key: 'b', run: () => copy(w.branch) } as MenuItem] : []),
    ...(w.kind === 'worktree' ? [{ label: w.pr ? 'Refresh PR status' : 'Look for a PR', icon: 'refresh', run: refreshPR } as MenuItem] : []),
    ...(attachable(w) ? [{ label: 'Attach a PR…', icon: 'link', key: 'h', run: () => setDialog({ attachPr: w.id }) } as MenuItem] : []),
    ...(settings.devMode ? [{ label: 'Logs', icon: 'file', key: 'l', run: () => setDialog({ logs: `ws:${w.id}`, title: `Logs · ${wsName(w)}` }) } as MenuItem] : []),
    ...(w.pr?.state === 'OPEN' && !w.pr.mine && allows(w, 'approve') ? [{ label: `Approve PR #${w.pr.number}…`, icon: 'check', run: () => prAct(w, 'approve') } as MenuItem] : []),
    ...(w.pinned ? [] : groupItems(w)),
    null,
    ...(w.kind === 'worktree'
      ? [
          { label: 'Fork workspace', icon: 'fork', key: 'f', run: () => forkWs(w) } as MenuItem,
          { label: 'Archive workspace', icon: 'archive', key: 'a', run: () => archive(w) } as MenuItem,
        ]
      : []),
    { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(w) },
  ]

  // a workspace into one of its project's groups (first in it, as a drop on its head), or out of its group (last before
  // the first one); no groups: nothing (they're made from the project's ⋯)
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
    return [
      null,
      { head: 'Move to group' },
      ...seps.filter(s => s.id !== inSep).map(s => ({ label: s.name || 'Unnamed group', icon: 'sep', run: () => to(s.id, true) }) as MenuItem),
      ...(inSep ? [{ label: 'Out of its group', icon: 'minus', run: () => to(ids.find(isSep)!, false) } as MenuItem] : []),
    ]
  }
  // a git workspace on a branch with no PR found: one can be attached by hand (prAttach)
  const attachable = (w: WorkspaceView) => !w.pr && !!w.branch && view?.projects.find(p => p.id === w.project)?.git !== false
  // a workspace for the info panel and the status bar's PR
  const cfgOf = (w: WorkspaceView) => view?.projects.find(p => p.id === w.project)?.config
  const allows = (w: WorkspaceView, k: 'approve' | 'close' | 'merge' | 'land') => prAllows(cfgOf(w), k)
  const infoOf = (w: WorkspaceView, cfg = cfgOf(w)): WsInfo => ({
    ...w,
    allow: { approve: prAllows(cfg, 'approve'), close: prAllows(cfg, 'close'), merge: prAllows(cfg, 'merge'), land: prAllows(cfg, 'land') },
    method: cfg?.mergeMethod,
    ...(w.fix?.pr === w.pr?.number && { fixTries: w.fix?.tries, mergeTries: w.fix?.merges }), // this PR's counts only
    prScan: settings.prScan || PR_SCAN,
    prTries: settings.prTries || PR_TRIES,
  })
  // merge when green: asked once, as it's turned on
  const setAuto = async (w: WorkspaceView, k: AutoKey, v: boolean) => {
    if (k === 'autoLand' && v && !(await ask(`Merge ${w.pr ? `PR #${w.pr.number}` : 'the PR'} when it's green?`, { text: `Laki will ${MERGE_WORDS[cfgOf(w)?.mergeMethod ?? 'squash'].toLowerCase()} it as you and delete its branch on GitHub, once every check passes, it has no conflicts, isn't a draft, is approved if the repo asks for a review and its agent isn't working.`, ok: 'Merge when green' }))) return
    call('wsSet', { id: w.id, [k]: v }).catch(() => {})
  }
  const prFix = (w: WorkspaceView, what: FixWhat) => call('prFix', { ws: w.id, what }).then(() => toast('Sent to the agent'), () => {})
  // GitHub asked again now, not at the next scan (every settings.prScan minutes)
  const refreshPR = () => call('prRefresh').then(() => done('PR status: fresh from GitHub'), () => {})
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
      return call('prAct', { ws: w.id, act, method, deleteBranch: del.on }).then(() => toast(`Merged PR #${pr.number}`, undefined, undefined, true), () => {})
    }
    const close = act === 'close'
    const facts = close ? 'Without merging; it can be reopened on GitHub.' : [pr.author && `By ${pr.author}`, `Checks: ${ciText(pr)}`, pr.conflict && 'merge conflicts'].filter(Boolean).join(' · ')
    if (!(await ask(close ? `Close PR #${pr.number}?` : `Approve PR #${pr.number}?`, { text: [pr.title, facts].filter(Boolean).join('\n'), ok: close ? 'Close pull request' : 'Approve', danger: close }))) return
    call('prAct', { ws: w.id, act }).then(() => toast(close ? `Closed PR #${pr.number}` : `Approved PR #${pr.number}`, undefined, undefined, true), () => {})
  }
  const prMenu = (w: WorkspaceView): MenuItem[] => [
    { label: 'Refresh from GitHub', icon: 'refresh', key: 'r', run: refreshPR },
    ...(w.pr ? [{ label: 'Open the PR', icon: 'link', key: 'o', run: () => openExternal(w.pr!.url) } as MenuItem, { label: 'Open its checks', icon: 'link', key: 'c', run: () => openExternal(`${w.pr!.url}/checks`) } as MenuItem] : []),
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
    const ended = ts.filter(t => t.status === 'exited' && (t.kind === 'agent' || t.kind === 'dev'))
    const others = groups.filter(x => x !== g).flatMap(x => tabsOf(x).map(byId)).filter((t): t is TabView => !!t)
    return [
      { label: 'Rename…', icon: 'pencil', key: 'r', run: () => setDialog({ rename: ts[0].id }) },
      { colors: TAB_COLORS, value: colorOf(ts[0]), pick: c => ts.forEach(t => call('tabSet', { id: t.id, color: c })) },
      { label: ts[0].muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', run: () => ts.forEach(t => call('tabSet', { id: t.id, muted: !ts[0].muted })) },
      { label: 'Mark as unread', icon: 'unread', key: 'u', run: () => ts.forEach(t => markUnread(t.id)) },
      ...(ts[0].kind === 'agent' && ts[0].status !== 'exited' ? [{ label: 'Send a message later…', icon: 'timer', run: () => setDialog({ sendLater: ts[0].workspace, to: ts[0].id }) } as MenuItem] : []),
      ...(bridge ? [{ label: 'Copy link', icon: 'link', key: 'l', run: () => copy(wsLink(ts[0].workspace, ts[0].id)) } as MenuItem] : []),
      null,
      { label: 'Split right', icon: 'splitRight', run: () => (selectTab(ts[0].id), split('right', ts[0].id)) },
      { label: 'Split down', icon: 'splitDown', run: () => (selectTab(ts[0].id), split('bottom', ts[0].id)) },
      ...(g && tabsOf(g).length > 1
        ? ids.length > 1
          ? [{ label: 'Separate panes', icon: 'unsplit', run: () => setGroups(groups.flatMap(x => (x === g ? tabsOf(x).map(tab => ({ tab })) : [x]))) } as MenuItem]
          : [{ label: 'Move to its own tab', icon: 'unsplit', run: () => setGroups(move(groups, ids[0], false, 'bar')) } as MenuItem]
        : []),
      ...(ended.length ? [{ label: 'Restart', icon: 'restore', run: () => ended.forEach(t => api.send('input', { tab: t.id, data: '\r' })) } as MenuItem] : []),
      null,
      { label: ids.length > 1 ? 'Close tab' : 'Close', icon: 'x', hint: '⌘W', run: () => closeTabs(ts) },
      ...(ids.length > 1 || !g || tabsOf(g).length === 1 ? (others.length ? [{ label: 'Close other tabs', icon: 'x', danger: true, run: () => closeTabs(others) } as MenuItem] : []) : []),
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
    ...['widgets', 'actions', 'templates'].filter(x => seenSecs.includes(x)),
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
  const onboardGo = (id: string) => {
    setDialog(null)
    if (id === 'project') openProject()
    else if (id === 'workspace') view?.projects.some(p => !p.kind) ? newWs() : openProject()
    else if (id === 'settings') setDialog('settings')
    else if (id === 'shell') quickNew('shells')
    else setDialog({ section: id })
  }
  // the sidebar's + › Terminal or Browser: a new one in the Terminals or Browsers project (the first makes it), selected
  // a page's link to a new tab (url; front: target=_blank, else a middle click, ⌘-click or its menu): one more, selected or not
  const quickNew = async (kind: 'shells' | 'browsers', url?: string, front = true) => {
    const w = await call<WorkspaceView>('quickNew', { kind, ...(url && { url }) }).catch(() => null) // the toast says why
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
  const newWord = (p: Project) => (p.kind === 'shells' ? 'New terminal' : p.kind === 'browsers' ? 'New browser' : 'New workspace')

  // keys: capture phase, before xterm.js sees them
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (e.metaKey && e.altKey && !e.ctrlKey && e.code === 'KeyB') return void (e.preventDefault(), e.stopPropagation(), ws && togglePanel())
    if (!e.metaKey || e.altKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    // ⌘⇧N: the tab bar's +, its menu (shell, each agent, command) to pick from with the keys
    if (e.shiftKey && k === 'n') return void (e.preventDefault(), e.stopPropagation(), dialog || document.querySelector<HTMLElement>('.newtab-btn')?.click())
    if (e.shiftKey && k === 'a') return void (e.preventDefault(), e.stopPropagation(), dialog || toggleArtifacts())
    if (e.shiftKey && k === 'enter') return void (e.preventDefault(), e.stopPropagation(), toggleFull()) // ⌘⇧⏎: full screen, or back // ⌘⇧A: the Artifacts strip (not under a page: out of sight)
    const act: Record<string, () => void> = {
      n: () => newWs(ws?.project),
      b: () => setSideOpen(o => !o),
      ',': () => toSettings(),
      '/': () => setDialog(d => (d === 'help' ? null : 'help')),
      e: () => ws && openIn(editor),
      '=': () => zoom(1),
      '+': () => zoom(1),
      '-': () => zoom(-1),
      '0': () => zoom(0),
      o: openProject,
      f: () => dialog || (tab && setFinds(m => ({ ...m, [tab.id]: (m[tab.id] ?? 0) + 1 }))), // not over a dialog
      t: () => (ws?.browser !== undefined ? quickNew('browsers') : newTab('shell')), // a browser's: another browser
      w: () => (ws?.browser !== undefined ? dialog || closePage(ws) : previewed ? closePreview() : tab && closeTabs([tab])), // a Browsers page: it closes (not under a page or dialog: it isn't in sight); else the file preview first
      k: () => setDialog(d => (d === 'palette' ? null : 'palette')),
      p: () => ws && setDialog(d => (d === 'files' ? null : 'files')),
      d: () => git && togglePanel('changes'),
      i: () => showInfo(),
      j: nextNeed,
      arrowup: () => moveWs(-1),
      arrowdown: () => moveWs(1),
    }
    if (/^[1-9]$/.test(k)) act[k] = () => groups[Number(k) - 1] && selectGroup(groups[Number(k) - 1])
    if (canLater && !dialog) act.l = () => sendLater(tab?.kind === 'agent' ? tab.id : undefined)
    if (!act[k] || (e.shiftKey && k !== 'arrowup' && k !== 'arrowdown' && k !== '+')) return
    const t = e.target as HTMLElement | null // ⌘↑/⌘↓ in a text field move its cursor (xterm's own textarea isn't one)
    if (k.startsWith('arrow') && t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && !/^(checkbox|radio|button|submit)$/.test(t.type))) && !t.classList.contains('xterm-helper-textarea')) return
    e.preventDefault()
    e.stopPropagation()
    act[k]()
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    bridge?.onBrowserKey?.(key => keys.current(new KeyboardEvent('keydown', { key, metaKey: true }))) // from a Browsers page, as if here
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])

  // the actions, once: the ⋯ menus and the palette show the same ones
  type Action = { label: string; icon: IconName; hint?: string; key?: string; danger?: boolean; run: () => void }
  const newTabIn = (w: WorkspaceView | null): Action[] => [
    { label: 'Shell', icon: 'terminal', hint: w?.id === ws?.id ? '⌘T' : undefined, run: () => newTab('shell', undefined, w) },
    ...(view?.presets ?? []).filter(p => !p.off).map(p => ({ label: p.name, icon: 'agent', run: () => newTab(p.name, undefined, w) }) as Action),
    { label: 'Command…', icon: 'terminal', run: () => (w && setWsId(w.id), setDialog('custom')) }, // the dialog is for the selected one
  ]
  const newTabActions = newTabIn(ws)
  // ⌘J: the next tab that needs you (waiting first, then done unseen; the Dock's count), in the sidebar's order, around
  const nextNeed = () => {
    const tabs = order.flatMap(w => view?.tabs.filter(t => t.workspace === w.id && needsYou(t)) ?? [])
    const need = [...tabs.filter(t => t.status === 'waiting'), ...tabs.filter(t => t.status !== 'waiting')]
    if (!need.length) return toast('Nothing needs you')
    setDialog(null)
    selectTab(need[(need.findIndex(t => t.id === tab?.id) + 1) % need.length])
  }
  // ⌘⇧A, the status bar's Artifacts › Show here: the strip of what its agents keep, over the status bar, or not
  const toggleArtifacts = () => (ws?.storage ? setGallery(g => (g === ws.id ? null : ws.id)) : toast('No artifacts here: its folder is made with its first agent'))
  // Send later: to one of the workspace's agents, or Laki AI (on); to: who it's for at first
  const canLater = !!ws && (!!settings.ai?.on || tabs.some(t => t.kind === 'agent' && t.status !== 'exited'))
  const sendLater = (to?: string, text?: string) => setDialog({ sendLater: ws?.id ?? '', ...(to && { to }), ...(text && { text }) })
  const wsActions: Action[] = !ws
    ? []
    : [
        ...(tab ? [{ label: 'Split right', icon: 'splitRight', run: () => split('right') } as Action, { label: 'Split down', icon: 'splitDown', run: () => split('bottom') } as Action] : []),
        ...(ws.kind === 'worktree'
          ? [{ label: 'Fork workspace', icon: 'fork', key: 'f', run: () => forkWs(ws) } as Action, { label: 'Archive workspace', icon: 'archive', key: 'a', run: () => archive(ws) } as Action]
          : []),
        ...(canLater ? [{ label: 'Send a message later…', icon: 'timer', key: 'l', hint: '⌘L', run: () => sendLater() } as Action] : []),
        { label: 'Rename workspace…', icon: 'pencil', key: 'r', run: () => setDialog({ renameWs: ws.id }) },
        ...(ws.browser === undefined ? [{ label: 'Copy path', icon: 'copy', key: 'c', hint: (ws.host ? `${ws.host}:` : '') + shortPath(ws.path), run: () => copy((ws.host ? `${ws.host}:` : '') + ws.path) } as Action] : []),
        { label: ws.pinned ? 'Unpin workspace' : 'Pin workspace to top', icon: 'pin', run: () => call('wsSet', { id: ws.id, pinned: !ws.pinned }) },
        { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(ws) },
      ]
  const tasksOf = (project: string) => (n => (n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : undefined))(view?.schedules?.filter(s => s.project === project).length ?? 0)
  // fold a project's workspaces away, or back; ids of removed projects go
  const fold = (id: string) => setFolded(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]).filter(x => view?.projects.some(p => p.id === x || p.seps?.some(s => s.id === x))))
  const projectActions = (p: Project): MenuItem[] => {
    const archived = view?.workspaces.filter(w => w.archived && w.project === p.id) ?? []
    return [
      { label: newWord(p), icon: 'plus', hint: p.kind ? undefined : '⌘N', run: () => newIn(p) },
      ...(p.kind ? [] : [{ label: 'Open project page', icon: 'info', key: 'o', run: () => setDialog({ project: p.id }) } as MenuItem]),
      { label: 'Open in', icon: 'code', key: 'i', items: openInItems({ project: p.id }) },
      { label: 'Add a group', icon: 'sep', run: () => setDialog({ sep: p.id }) },
      { label: folded.includes(p.id) ? 'Expand' : 'Collapse', icon: folded.includes(p.id) ? 'chevron' : 'chevronRight', run: () => fold(p.id) },
      { label: 'Notes', icon: 'file', key: 'n', hint: p.notes?.trim() ? undefined : 'none yet', run: () => setDialog({ notes: p.id }) },
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
    if (ws) a({ label: 'Find files…', icon: 'search', hint: '⌘P', run: () => setDialog('files') }) // first: it opens a search of its own
    for (const w of order) items.push({ label: wsName(w), hint: `${w.branch || 'folder'} · workspace`, glyph: rollup(view!.tabs.filter(t => t.workspace === w.id)), run: () => setWsId(w.id) })
    for (const t of view?.tabs ?? []) {
      const w = live.find(w => w.id === t.workspace)
      if (w) items.push({ label: `${wsName(w)} / ${t.name}`, hint: t.last ? t.last.slice(0, 80) : 'tab', glyph: tabGlyph(t), run: () => selectTab(t.id) })
    }
    a({ label: 'Next tab that needs you', icon: 'bell', hint: '⌘J', run: nextNeed })
    a({ label: full ? 'Exit full screen' : 'Full screen: just this tab', icon: full ? 'minimize' : 'maximize', hint: '⌘⇧⏎', run: () => toggleFull() })
    if (settings.ai?.on) a({ label: 'Ask Laki AI later…', icon: 'timer', run: () => sendLater('ai') })
    if (ws?.storage) a({ label: gallery === ws.id ? 'Hide artifacts' : 'Show artifacts', icon: 'image', hint: '⌘⇧A', run: toggleArtifacts })
    for (const race of new Set(live.flatMap(w => (w.race ? [w.race] : [])))) {
      const w = live.find(w => w.race === race)!
      a({ label: `Compare the race: ${wsName(w).replace(/-[^-]+$/, '')}`, icon: 'race', run: () => setDialog({ compare: race }) })
    }
    a({ label: 'New workspace', icon: 'plus', hint: '⌘N', run: () => newWs(ws?.project) })
    a({ label: 'Open project folder…', icon: 'folderPlus', hint: '⌘O', run: openProject })
    a({ label: 'New terminal (in your home folder)', icon: 'terminal', run: () => quickNew('shells') })
    a({ label: 'Get started: the first steps', icon: 'check', run: () => (setOnboard(o => ({ ...o, off: false })), setDialog('onboard')) })
    a({ label: 'New browser', icon: 'globe', run: () => quickNew('browsers') })
    a({ label: 'Open a project over SSH…', icon: 'server', run: () => setDialog('project') })
    a({ label: 'Settings', icon: 'gear', hint: '⌘,', run: () => setDialog('settings') })
    a({ label: 'Scheduled tasks', icon: 'clock', run: () => setDialog('schedules') })
    a({ label: 'Board: every workspace by where it is, and to-dos', icon: 'board', run: () => setDialog('board') })
    a({ label: 'AI: ask Laki to work your agents, and what it cost', icon: 'ai', run: () => setDialog('ai') })
    a({ label: "Release notes: what's new in Laki", icon: 'file', run: () => setDialog({ section: 'notes' }) })
    for (const w of view?.widgets ?? []) if (w.on && w.full) a({ label: `Extension: ${w.name}`, icon: 'panel', run: () => setDialog({ widget: w.id }) })
    a({ label: 'Extensions: settings, reload', icon: 'panel', run: () => setDialog({ section: 'widgets' }) })
    a({ label: 'Resources: memory and CPU by tab', icon: 'memory', run: () => setDialog({ section: 'resources' }) })
    a({ label: 'Help: keys and commands', icon: 'help', hint: '⌘/', run: () => setDialog('help') })
    a({ label: 'About Laki', icon: 'info', run: () => setDialog('about') })
    a({ label: 'Collapse all projects', icon: 'chevronRight', run: () => setFolded(view?.projects.map(p => p.id) ?? []) })
    a({ label: 'Expand all projects', icon: 'chevron', run: () => setFolded([]) })
    a({ label: sideOpen ? 'Hide sidebar' : 'Show sidebar', icon: 'sidebar', hint: '⌘B', run: () => setSideOpen(o => !o) })
    a({ label: video ? 'Another YouTube video…' : 'Watch a YouTube video…', icon: 'youtube', run: () => setDialog('video') })
    if (video) a({ label: 'Close the video', icon: 'x', run: () => setVideo(null) })
    const ticking = timers.filter(t => t.then !== 'remind').length // reminders stay
    if (ticking) a({ label: ticking > 1 ? 'Stop all timers' : 'Stop the timer', icon: 'stop', run: () => setTimers(l => l.filter(t => t.then === 'remind')) })
    a({ label: 'Start a timer…', icon: 'timer', run: () => setDialog('timer') })
    if (ws) a({ label: `Remind me about ${wsName(ws)}…`, icon: 'timer', run: () => setDialog({ remind: ws.id }) })
    a({ label: find ? 'Stop filtering the sidebar' : 'Filter the sidebar…', icon: 'filter', run: () => (setSideOpen(true), setFind(f => (f ? null : { q: '' }))) })
    if (!view?.remote) {
      if (settings.remoteMail) a({ label: `Start remote access for ${settings.remoteMail}, 1 hour`, icon: 'link', run: () => (call('remoteStart', { hours: 1, mail: settings.remoteMail }).catch(() => {}), setDialog({ section: 'remote' })) })
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
      a({ label: 'Files', icon: 'file', hint: '⌥⌘B', run: () => showPanel('files') })
      if (git) a({ label: 'Changes', icon: 'changes', hint: '⌘D', run: () => showPanel('changes') })
      if (git) a({ label: 'Review: PR checks and comments', icon: 'review', run: () => showPanel('review') })
      a({ label: 'Workspace info', icon: 'info', hint: '⌘I', run: () => showInfo(true) })
      a({ label: ws.run ? 'Run the run script' : 'Set a run script…', icon: 'run', run: ws.run ? run : editScripts })
      if (devRunning) a({ label: 'Stop the run script', icon: 'stop', run: () => api.send('input', { tab: devTab!.id, data: '\x03' }) })
      if (ws.kind === 'worktree') a({ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') })
      wsActions.forEach(a)
      if (previewed) a({ label: 'Close the file preview', icon: 'x', hint: '⌘W', run: closePreview })
      if (tab) a({ label: `Close ${tab.name}`, icon: 'x', hint: previewed ? undefined : '⌘W', run: () => closeTabs([tab]) })
      if (ws.pr) a({ label: `Open PR #${ws.pr.number}`, icon: 'pr', run: () => openExternal(ws.pr!.url) })
      for (const p of ws.ports) a({ label: `Open localhost:${p}`, icon: 'link', run: () => openExternal(`http://localhost:${p}`) })
      if (project && !project.kind) a({ label: `Project settings: ${project.name}`, icon: 'settings', run: () => setDialog({ settings: project.id }) })
    }
    for (const w of view?.workspaces.filter(w => w.archived) ?? []) a({ label: `Restore ${wsName(w)}`, icon: 'restore', hint: 'archived', run: () => restore(w.id) })
    return items
  }, [view, live, ws, tab, group, sideOpen, apps, previewed, video, timers.length, find, gallery, full])

  if (!view)
    return (
      <div className="splash">
        <div className="logo">
          <img src={icon} alt="" />
          <span className="wordmark">Laki</span>
        </div>
        <div className="muted">{connected ? 'loading…' : 'connecting to the daemon…'}</div>
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
        ×
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
  const wsRow = (w: WorkspaceView, pin = false) => {
    const wt = view.tabs.filter(t => t.workspace === w.id)
    const queued = wt.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
    const state = more ? rollup(wt) : 'idle' // the second line's
    const status = sideStyle === 'status' // an edge in its state's color, a line that fills with its agents' progress
    const pct = status ? Math.max(-1, ...wt.map(t => t.progress?.pct ?? -1)) : -1
    const yes = prMarks(w.pr)
    const last = sideStyle === 'cards' ? wt.find(t => t.kind === 'agent' && t.last)?.last?.trim().replace(/\s+/g, ' ').slice(0, 300) : undefined // a card's: the agent's last answer
    return (
      <div
        key={w.id}
        className={`ws ${w.id === ws?.id ? 'sel' : ''} ${going[w.id] ? 'going' : ''} ${wt.some(needsYou) ? 'needs' : ''} ${rows.at('ws', w.id)}`}
        style={{ ...colorVar(w.color), ...(pct >= 0 && ({ '--p': `${pct}%` } as CSSProperties)) }}
        data-state={status ? (w.setup || going[w.id] ? 'running' : rollup(wt)) : undefined}
        data-row={`ws:${w.id}`}
        data-group={pin ? 'pinned' : w.project}
        onPointerDown={e => (clearTimeout(peekTimer.current), setPeek(null), !pin && !find && rows.start(e, 'ws', w.id, w.project)) /* filtered: the order isn't all there */}
        onPointerEnter={e => e.pointerType === 'mouse' && !e.buttons && !narrow && !view.projects.find(p => p.id === w.project)?.kind && peekAt(w.id, e.currentTarget) /* Terminals and Browsers: no port, PR or agent to tell of */}
        onPointerLeave={() => peekAt()}
        onClick={() => (setWsId(w.id), (!pin && !find && rows.dragged()) || setDialog(null), narrow && setSideOpen(false)) /* a page over the main area (Settings, the new-workspace page…) gives way to it, not to a drag's end */}
        onContextMenu={e => openMenu(e, wsMenu(w))}
      >
        {w.browser !== undefined ? <Icon name="globe" size={11} /> /* a page: no tabs */ : <Glyph s={w.setup || going[w.id] ? 'running' : rollup(wt)} />}
        {marksAt === 'start' && yes}
        <span className="ws-name">{wsName(w)}</span>
        {marksAt === 'name' && yes}
        {going[w.id] && <span className="ws-going">{going[w.id]}…</span>}
        {pin && <span className="ws-proj">{view.projects.find(p => p.id === w.project)?.name}</span>}
        {queued > 0 && <span className="badge">+{queued}</span>}
        <span className="spacer" />
        {settings.timers && <TurnTime tabs={wt} />}
        {w.stat && (w.stat.add > 0 || w.stat.del > 0) && settings.diffStat === true && (
          <span className="ws-stat">
            <span className="add">+{short(w.stat.add)}</span>
            <span className="del">−{short(w.stat.del)}</span>
          </span>
        )}
        {w.muted && (
          <span className="ws-mark">
            <Icon name="bellOff" size={11} />
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
        {w.schedule && (
          <span className="ws-sched">
            <Icon name="clock" size={11} />
          </span>
        )}
        {w.pr?.conflict && w.pr.state === 'OPEN' && settings.prIcon !== false && (
          <span className="ws-pr conflict" data-tip={`PR #${w.pr.number} has merge conflicts`}>
            <Icon name="conflict" size={11} />
          </span>
        )}
        {settings.archiveMerged && w.kind === 'worktree' && w.pr?.state === 'MERGED' && (
          <span className="ws-merged" data-tip={`PR #${w.pr.number} merged; not archived: changes, an agent at work, or an Undo`}>
            merged
          </span>
        )}
        {marksAt === 'end' && yes}
        {w.pr && settings.prIcon !== false && (
          <span className={`ws-pr ${prState(w.pr)} ${w.pr.checks === 'fail' && w.pr.state === 'OPEN' ? 'fail' : ''}`}>
            {!w.pr.mine && <Avatar login={w.pr.author} size={16} />}
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
        {sideStyle === 'cards' && last && <div className="ws-last">{last}</div>}
        {status && <span className={`ws-line ${pct >= 0 ? 'pct' : ''}`} />}
      </div>
    )
  }
  // an open PR's marks (settings.prMarks, each unset on): ✓ approved, ✓✓ approved by you too, 👀 you commented
  const marksAt = settings.prMarks?.at ?? 'start'
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
      ...timers.filter(t => t.then === 'remind' && t.ws === w.id).map(t => `a reminder at ${new Date(t.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      w.ports.length > 0 && `listening on ${w.ports.map(p => `:${p}`).join(' ')}`,
    ].filter(Boolean)
    return (
      <div className="ws-peek" ref={peekBox} style={{ top: peek!.top, left: peek!.left, ...colorVar(w.color) }} onPointerEnter={() => clearTimeout(peekTimer.current)} onPointerLeave={() => peekAt()}>
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
              {!pr.mine && <Avatar login={pr.author} size={16} />}
              <span className={`wp-pr-state ${prState(pr)}`}>{prState(pr)}</span>
              <span className="wp-pr-title">
                #{pr.number} {pr.title}
              </span>
            </a>
            <div className="wp-pr-meta">
              {pr.author && !pr.mine && <span>by {pr.author}</span>}
              {pr.list?.length || pr.checks ? <span className={`ci-${pr.checks}`}>{ciText(pr)}</span> : null}
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
    if (q && ![wsName(w), w.branch, w.pr?.title, w.pr?.author, w.pr && `#${w.pr.number}`].some(x => x?.toLowerCase().includes(q))) return false
    return find.only === 'needs' ? wt.some(needsYou) : find.only === 'busy' ? !!w.setup || wt.some(t => t.status === 'running') : find.only === 'pr' ? !!w.pr : true
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
  const tabList = (
    <>
      {groups.map(g => {
        const ts = tabsOf(g).map(byId).filter((t): t is TabView => !!t)
        const queued = ts.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
        return (
          <div
            key={ts[0]?.id}
            className={`tab nodrag ${g === group ? 'sel' : ''}${ts.some(t => t.asleep) ? ' asleep' : ''}${ts.length && ts.every(t => t.kind === 'agent' && t.status === 'exited') ? ' ended' : ''}`}
            style={colorVar(colorOf(ts[0]))}
            onClick={() => selectGroup(g)}
            onDoubleClick={() => ts[0] && setDialog({ rename: ts[0].id })}
            onContextMenu={e => openMenu(e, tabMenu(tabsOf(g)))}
            onPointerDown={e => !narrow && ts[0] && start(e, ts[0].id, true) /* a phone: no splits, tabs in their order */}
            onAuxClick={e => e.button === 1 && closeTabs(ts)}
            data-tip={[...ts.filter(t => t.runs).map(t => `${t.name}: ${t.runs} runs in it (its status read off the screen)`), ...ts.filter(t => t.progress).map(t => `${t.name}: ${t.progress!.pct}% done, its own estimate${t.progress!.note ? `: ${t.progress!.note}` : ''}`), ...ts.filter(t => t.asleep).map(t => `${t.name} is asleep to free memory: a look resumes it`), ...ts.filter(t => t.kind === 'agent' && t.status === 'exited').map(t => `${t.name} ended: ⏎ in it starts it again`), ...ts.filter(t => t.model || t.effort).map(t => `${t.name}: ${[t.model, t.effort].filter(Boolean).join(', ')}`), `⌘${groups.indexOf(g) + 1}`, 'double click to rename', 'drag to reorder, or onto a pane to split', 'right click for more'].join(' · ')}
          >
            <Glyph s={ts.length > 1 ? rollup(ts) : ts[0] ? tabGlyph(ts[0]) : 'idle'} />
            <span>{ts.map(t => t.name).join(' · ')}</span>
            {ts.map(t => t.progress && <span key={t.id} className="tab-pct" style={{ '--p': `${t.progress.pct}%` } as CSSProperties}>{t.progress.pct}%</span>)}
            {settings.timers && <TurnTime tabs={ts} />}
            {ts.some(t => t.muted) && (
              <span className="ws-mark">
                <Icon name="bellOff" size={11} />
              </span>
            )}
            {queued > 0 && <span className="badge">+{queued}</span>}
            <button className="x" data-tip="Close (⌘W)" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => (e.stopPropagation(), closeTabs(ts))}>
              ×
            </button>
          </div>
        )
      })}
      {ws && (ws.browser === undefined ? <IconButton icon="plus" title="New tab (⌘⇧N)" className="nodrag newtab-btn" onClick={e => openMenu(e, newTabActions)} /> : <IconButton icon="plus" title="New browser tab (⌘T)" className="nodrag newtab-btn" onClick={() => quickNew('browsers')} />)}
    </>
  )
  const schedTip = nextTask ? `Scheduled tasks · next: ${nextTask.name ? stamp(nextTask.name, nextTask.next!) : nextTask.prompt.slice(0, 40)}, ${new Date(nextTask.next!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Scheduled tasks'
  const toSchedules = () => setDialog(d => (schedulesOf(d) === undefined ? 'schedules' : null))
  const toBoard = () => setDialog(d => (d === 'board' ? null : 'board'))
  const toAi = () => setDialog(d => (d === 'ai' ? null : 'ai'))
  const AI_TIP = 'AI: ask Laki to start, check and steer your agents'
  const toSettings = () => setDialog(d => (settingsOf(d) ? null : 'settings'))
  const BOARD_TIP = 'Board: every workspace by where it is, and to-dos'
  // each kind's tabs that need you (the Dock's rule) and whether one works, for its rail button
  const kinds = rail ? new Map(live.map(w => [w.id, kindOf(w)])) : null
  const railSays = (k: RailKind) => {
    const mine = view.tabs.filter(t => kinds?.get(t.workspace) === k)
    return { n: mine.filter(needsYou).length, busy: mine.some(t => t.status === 'running') }
  }
  // a rail button: its icon, words (Labels), and a count or a dot on the icon
  const railButton = (key: string, icon: IconName, label: string, on: boolean, tip: string, run: () => void, mark?: ReactNode) => (
    <button key={key} type="button" className={`rail-kind nodrag ${on ? 'on' : ''}`} aria-pressed={on} aria-label={tip} data-tip={tip} onClick={run}>
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
  const onPage = schedulesFor !== undefined || dialog === 'board' || dialog === 'ai' || settingsOf(dialog) // the rail's lit button: the page over the main area, else the list's kind
  const listOff = rail && sideOpen && (schedulesFor !== undefined || dialog === 'board' || dialog === 'ai') // the rail's Schedule and Board: a page over all but the rail
  const railBar = rail && sideOpen && (
    <nav className="rail drag" aria-label="Projects, the board, scheduled tasks, terminals, browsers and settings" data-bare={railWords ? undefined : ''} style={{ width: railW }}>
      {kindButton(RAIL[0])}
      {railButton('board', 'board', 'Board', dialog === 'board', BOARD_TIP, toBoard)}
      {railButton('schedules', 'clock', 'Schedule', schedulesFor !== undefined, `${schedTip}${runFailed ? ' · a run failed' : ''}`, toSchedules, runFailed && <span className="rail-dot bad" />)}
      {settings.ai?.on && railButton('ai', 'ai', 'AI', dialog === 'ai', AI_TIP, toAi)}
      {RAIL.slice(1).map(kindButton)}
      <span className="spacer" />
      {railButton('settings', 'gear', 'Settings', settingsOf(dialog), 'Settings (⌘,)', toSettings)}
    </nav>
  )
  // the rail's list: its kind's (a filter looks through all of them)
  const listed = rail && !find ? view.projects.filter(p => (p.kind ?? 'projects') === railKind) : view.projects
  const inList = (w: WorkspaceView) => !rail || !!find || kindOf(w) === railKind
  const pins = pinned.filter(w => shows(w) && inList(w))
  const tabStrip = tabsAt !== 'top' && (
    <div className={`tabstrip ${tabsAt}`} data-tabbar>
      {tabList}
    </div>
  )
  return (
    <div style={rail ? ({ '--rail-w': `${railW}px` } as CSSProperties) : undefined} className={`app ${sideOpen ? '' : 'side-closed'} ${rail ? 'rail-on' : ''} ${listOff ? 'list-off' : ''} ${narrow ? 'narrow' : ''} ${bridge ? 'electron' : ''} ${settings.dimPanes ? 'dim-panes' : ''} ${full ? 'full' : ''}`} data-pad={settings.termPad}>
      {railBar}
      {(sideOpen || video) && ( // hidden, not gone, while a video plays
      <aside className="sidebar" hidden={!sideOpen || listOff} data-style={sideStyle} style={{ width: sideW, ...phVars(settings.projectLook), ...sideVars(settings.sideLook) }} {...phAttrs(settings.projectLook)}>
        <div className="side-head drag">
          <IconButton icon="sidebar" title="Hide sidebar (⌘B)" onClick={() => setSideOpen(false)} />
          <span className="spacer" />
          <IconButton icon="filter" title={find ? 'Stop filtering' : 'Filter the workspaces: by name, branch or PR; the ones that need you, working, with a PR'} on={!!find} onClick={() => setFind(f => (f ? null : { q: '' }))} />
          <IconButton icon="plus" title="Add a project, a terminal or a browser" tip={false} onClick={e => openMenu(e, addMenu())} />
          <IconButton icon="help" title="Help: keys and commands (⌘/)" on={dialog === 'help'} onClick={() => setDialog(d => (d === 'help' ? null : 'help'))} />
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
                  <Icon name={p.kind === 'shells' ? 'terminal' : p.kind === 'browsers' ? 'globe' : p.host ? 'server' : p.git === false ? 'folder' : 'fork'} size={12} />
                </span>
                <span className="project-name">{p.name}</span>
                {shut && mine.length > 0 && (
                  <>
                    {sum !== 'idle' && sum !== 'exited' && <Glyph s={sum} />}
                    <span className="project-count">{mine.length}</span>
                  </>
                )}
                <span className="spacer" />
                <IconButton icon="plus" title={newWord(p)} onClick={() => newIn(p)} />
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
        <WidgetGrid widgets={view.widgets ?? []} api={widgetApi} />
        {!onboard.off && onboardDone.size < STEPS.length && dialog !== 'onboard' && <OnboardBar done={STEPS.filter(x => onboardDone.has(x.id)).length} onOpen={() => setDialog('onboard')} onOff={() => setOnboard(o => ({ ...o, off: true }))} />}
        <div className="side-foot" ref={fitFoot}>{/* pinned under the projects, in one row: words dropped from the right as they don't fit */}
          {!rail && ( // the rail layout has them on its rail
            <>
              <IconButton icon="clock" title={schedTip} on={schedulesFor !== undefined} className={runFailed ? 'dot' : ''} label={labels ? 'Schedule' : undefined} onClick={toSchedules} />
              <IconButton icon="board" title={BOARD_TIP} label={labels ? 'Board' : undefined} on={dialog === 'board'} onClick={toBoard} />
              {settings.ai?.on && <IconButton icon="ai" title={AI_TIP} label={labels ? 'AI' : undefined} on={dialog === 'ai'} onClick={toAi} />}
            </>
          )}
          <IconButton icon="youtube" title="Watch a YouTube video while you work" label={labels ? 'Video' : undefined} on={!!video} onClick={() => setDialog('video')} />
          {settings.fun !== false && <IconButton icon="smile" title="A random meme from Reddit, for a break (off: Settings › Appearance)" label={labels ? 'Meme' : undefined} on={dialog === 'fun'} onClick={() => setDialog(d => (d === 'fun' ? null : 'fun'))} />}
          <IconButton icon="timer" title="Timers: a countdown, then a sound and a dialog or a notification (and the video paused, played or closed, if you like); or a stopwatch" label={labels ? 'Timer' : undefined} on={timers.length + watches.length > 0} onClick={e => openMenu(e, startMenu())} />
          {!rail && (
            <>
              <span className="spacer" />
              <IconButton icon="gear" title="Settings (⌘,)" label={labels ? 'Settings' : undefined} on={settingsOf(dialog)} onClick={toSettings} />
            </>
          )}
        </div>
      </aside>
      )}
      {sideOpen && !listOff && (narrow ? <div className="side-backdrop" onClick={() => setSideOpen(false)} /> : <SideHandle width={sideW} onWidth={setSideW} init={SIDE} at={rail ? railW : 0} />)}

      <main className="main">
        {full && <IconButton icon="minimize" title="Exit full screen (⌘⇧⏎)" className="full-exit" onClick={() => toggleFull(false)} />}
        <div className="tabbar drag" data-tabbar>
          {!sideOpen && <IconButton icon="sidebar" title="Show sidebar (⌘B)" className="nodrag side-show" onClick={() => setSideOpen(true)} />}
          {tabsAt === 'top' && tabList}
          <span className="spacer" />
          {ws && <IconButton icon="maximize" title="Full screen: just this tab (⌘⇧⏎)" className="nodrag" onClick={() => toggleFull(true)} />}
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
                  <IconButton icon="info" title="Workspace info (⌘I)" on={info} onClick={() => showInfo()} />
                  <IconButton icon="globe" title={`Preview localhost:${ws.port}`} on={panelShown && panelTab === 'preview'} onClick={() => togglePanel('preview')} />
                </>
              )}
              <IconButton icon="panel" title="Files, changes, review, preview (⌥⌘B)" on={panelShown} onClick={() => togglePanel()} />
              {ws.kind === 'worktree' && !narrow && <IconButton icon="ship" title="Ship: commit, push, open a PR" onClick={() => setDialog('ship')} />}
              <IconButton icon="search" title="Commands (⌘K)" onClick={() => setDialog('palette')} />
              {canLater && !narrow && <IconButton icon="timer" title="Send a message later (⌘L): to an agent or Laki AI" onClick={() => sendLater(tab?.kind === 'agent' ? tab.id : undefined)} />}
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
        {connected && (view.api ?? 0) < API && <StaleDaemon restart={() => api.call('shutdown')} />}
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
                render={id => (
                  <Term
                    key={transparent() ? 'clear' : 'solid' /* xterm takes allowTransparency only as it opens */}
                    tab={id}
                    active={id === tab?.id && !dialog}
                    findSeq={finds[id] ?? 0}
                    fontSize={narrow ? Math.min(fontSize, 11) : fontSize /* ponytail: a phone's own size, not a setting */}
                    fontFamily={settings.fontFamily}
                    copyOnSelect={settings.copyOnSelect !== false}
                    editKeys={settings.editKeys !== false}
                    theme={theme}
                    look={termLook(settings)}
                    onFile={path => openPath(id, path)}
                  />
                )}
                onFocus={id => id !== tab?.id && selectTab(id)}
                hoverFocus={!!settings.hoverFocus}
                onClose={id => byId(id) && closeTabs([byId(id)!])}
                onResize={(path, at) => setGroups(groups.map(g => (g === group ? resize(g, path, at) : g)))}
                startDrag={(e, id) => start(e, id, false)}
              />
            ) : (
              <div className="empty">
                {ws ? (
                  ws.browser === undefined && <Ready name={wsName(ws)} branch={ws.kind === 'worktree' ? ws.branch : undefined} actions={newTabActions.filter(x => x.label !== 'Command…')} />
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
          </div>
          {tabsAt === 'right' && tabStrip}
          {previewed && ws && (
            <FilePreview
              key={previewed.n}
              path={previewed.path}
              line={previewed.line}
              load={() => api.call<FileContent>('fileRead', { ws: ws.id, path: previewed.path })}
              onOpen={() => panelApi(ws).openFile(previewed.path)}
              onClose={closePreview}
              edit={previewed.edit}
              onEdit={edit => setPreview(x => x && { ...x, edit })}
              save={(text, was, force) => api.call('fileWrite', { ws: ws.id, path: previewed.path, text, was, force })}
            />
          )}
          {panelShown && ws && ( // one on the right: a workspace with its info open shows that
            <SidePanel
              w={infoOf(ws)}
              git={git}
              tab={panelTab}
              onTab={setPanelTab}
              api={panelApi(ws)}
              width={panelW}
              onWidth={setPanelW}
              onClose={() => setPanelOpen(false)}
              onOpen={openExternal}
              onToggle={(k, v) => setAuto(ws, k, v)}
              onFix={what => prFix(ws, what)}
              onAct={(act, method) => prAct(ws, act, method)}
            />
          )}
          {info && ws && (
            <InfoPanel
              w={infoOf(ws)}
              width={infoW}
              onWidth={setInfoW}
              onClose={() => setInfo(false)}
              onOpen={openExternal}
              onToggle={(k, v) => setAuto(ws, k, v)}
              onFix={what => prFix(ws, what)}
              onAct={(act, method) => prAct(ws, act, method)}
              onRename={() => setDialog({ renameWs: ws.id })}
              onAttach={attachable(ws) ? () => setDialog({ attachPr: ws.id }) : undefined}
              onCopy={copy}
              onStorage={bridge?.openPath && ws.storage ? () => void bridge!.openPath!(ws.storage!).then(r => r === 'missing' && toast('Nothing kept yet: its folder is made with its first tab')) : undefined}
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
        {touch && tab && !(narrow && (panelOpen || info || previewed)) /* not under a panel */ && (
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
            onSection={id => setSeenSecs(l => (l.includes(id) ? l : [...l, id]))}
            onSave={s => call('settingsSet', s).catch(() => {})}
            projects={view.projects.filter(p => !p.kind).map(p => ({ ...p, git: p.git !== false })) /* Terminals and Browsers: not projects, nothing to set */}
            projectFile={id => api.call<ProjectConfig>('projectFile', { id })}
            onSaveProject={(id, p) => call('projectSet', { id, ...p }).catch(() => {})}
            renameProjects
            skill={{ app: 'Laki', load: () => api.call<SkillInfo[]>('skills'), set: (agent, on, skill) => api.call<SkillInfo[]>('skillSet', { agent, on, skill }) }}
            ai={{ state: () => api.call('aiState'), key: key => api.call('aiKey', { key }), open: () => setDialog('ai') }}
            webhookTest={w => api.call('webhookTest', w)}
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
            remote={{ state: view.remote, start: (hours, mail, open) => api.call('remoteStart', { hours, mail, open }), stop: () => api.call('remoteStop'), copy, open: openExternal }}
            widgets={{
              list: view.widgets ?? [],
              home: view.widgetHome,
              set: (id, o) => call('widgetSet', { id, ...o }),
              run: id => call('widgetRun', { id }),
              reload: () => call('widgetReload'),
              open: id => setDialog({ widget: id }),
              folder: (id, e) => {
                const w = view.widgets?.find(x => x.id === id)
                openMenu(e, [{ head: 'Open in' }, ...openInItems({ widget: id }), null, { label: 'Copy path', icon: 'copy', key: 'c', run: () => w && copy(w.dir) }])
              },
              logs: settings.devMode ? id => setDialog({ logs: `widget:${id}`, title: `Logs · ${view.widgets?.find(x => x.id === id)?.name ?? id}` }) : undefined,
            }}
            logs={(key, title) => setDialog({ logs: key, title })}
            section={settingsFor ? `project:${settingsFor.id}` : section}
            script={typeof dialog === 'object' && dialog && 'script' in dialog ? dialog.script : undefined}
            spot={typeof dialog === 'object' && dialog && 'spot' in dialog ? dialog.spot : undefined}
          />
        )}
        {(w => w && <WidgetDialog w={w} api={widgetApi} onClose={() => setDialog(null)} />)(dialog && typeof dialog === 'object' && 'widget' in dialog ? view.widgets?.find(x => x.id === dialog.widget) : undefined)}
        {dialog === 'help' && <HelpPage cli="laki" ship zoom={(fontSize / FONT_SIZE) * pageZoom} onClose={() => setDialog(null)} />}
        {dialog === 'about' && <About onClose={() => setDialog(null)} />}
        {dialog === 'onboard' && (
          <Onboarding
            done={onboardDone}
            onGo={onboardGo}
            onTick={id => setOnboard(o => (o.done.includes(id) ? o : { ...o, done: [...o.done, id] }))}
            onSkip={() => setDialog(null)}
            onOff={() => (setOnboard(o => ({ ...o, off: true })), setDialog(null))}
          />
        )}
        {dialog && typeof dialog === 'object' && 'logs' in dialog && <Logs title={dialog.title} load={() => api.call<LogLine[]>('logs', { key: dialog.logs })} copy={copy} onClose={() => setDialog(dialog.logs.startsWith('widget:') ? { section: 'widgets' } : dialog.logs === 'new' ? { section: 'general' } : null)} />}
        {dialog === 'fun' && <Fun load={() => api.call<Meme>('meme')} onClose={() => setDialog(null)} />}
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
              file: id => api.call<ProjectConfig>('projectFile', { id }),
              global: { actions: settings.actions, templates: settings.templates },
              onGlobal: sec => setDialog({ section: sec }),
              schedules: () => setDialog({ schedules: p.id }),
              setSchedule: (id, on) => call('scheduleSet', { id, on }),
            }}
          />
        ))(view.projects.find(x => x.id === dialog.project && !x.kind))}
        {dialog === 'ai' && <AiPage settings={settings.ai ?? {}} workspaces={view.workspaces.filter(w => !w.archived).map(w => ({ id: w.id, name: wsName(w) }))} onClose={() => setDialog(null)} onSettings={() => setDialog({ section: 'ai' })} onLater={text => setDialog({ sendLater: ws?.id ?? '', to: 'ai', text, back: 'ai' })} />}
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
                return call('wsNew', { project: t.project, prompt: t.text, place: 'top', ...(plain && { local: true, another: true, name: nameOf(t.text) }) }).then(() => call('todoRm', { id: t.id }))
              },
              add: (project, text) => call('todoAdd', { project, text }),
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
                await busyWith(losers.map(w => w.id), 'archiving', async () => {
                  for (const w of losers) if (await call('wsArchive', { id: w.id }).then(() => true, () => false)) gone.push(w.id)
                })
                setWsId(winner.id)
                setDialog(null)
                toast(`Kept ${wsName(winner)}, archived ${gone.length}`, () => gone.reduce((p, id) => p.then(() => call('wsRestore', { id })), Promise.resolve<unknown>(undefined)).then(() => setWsId(winner.id), () => {}))
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
              showNew(got[0].id, ...got.slice(1).map(w => w.id))
              if (page !== made.current.page) return // closed meanwhile: whatever is open now (another new page too) stays
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
              reveal: bridge?.openPath && (path => void bridge!.openPath!(`${ws.storage}/${path.replace(/\/?[^/]*$/, '')}`)), // its folder: open-path would open a document in its app
            }}
          />
        )}
        {(ws?.browser === undefined || !connected) && ( // a browser page: none, unless something's wrong
        <div className="status">
          {tracked.length > 0 && ws?.browser === undefined && <UsageButton key={tracked.join()} load={() => api.call<AgentUsage[]>('usage')} /> /* remounts as agents are turned on or off */}
          {ws && ws.browser === undefined && ( // a page: no port, branch or folder of its own
            <>
              {git && (
                <span title={ws.kind === 'worktree' ? `branch ${ws.branch}, from ${ws.base}` : 'the repo itself'}>
                  ⎇ {ws.branch}
                  {ws.kind === 'worktree' && <span className="muted"> ← {ws.base}</span>}
                </span>
              )}
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
          {!!ws?.artifacts && ws.storage && ( // the files its agents keep for you ($LAKI_STORAGE_FOLDER): Finder, or here
            <button
              className="listen port-main"
              data-tip={`${shortPath(ws.storage)}: what its agents keep for you ($LAKI_STORAGE_FOLDER) · ⌘⇧A shows them here`}
              onClick={e =>
                bridge?.openPath
                  ? openMenu(e, [
                      { label: 'Open in Finder', icon: 'folder', run: () => void bridge!.openPath!(ws.storage!) },
                      { label: gallery === ws.id ? 'Hide the gallery' : 'Show here', icon: 'image', hint: '⌘⇧A', run: toggleArtifacts },
                    ])
                  : toggleArtifacts()
              }
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
        </div>
        )}
      </main>

      {menu}
      <Tips />
      {peek && (w => w && peekCard(w))(live.find(w => w.id === peek.id))}
      <AskHost />
      {dropping && <div className="drop-overlay">Drop a folder to add it as a project</div>}
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
      {dialog === 'palette' && <Palette items={palette} onClose={() => setDialog(null)} />}
      {dialog === 'ship' && ws && (
        <Prompt
          title={`Ship ${ws.id}`}
          hint={`git add -A, commit, git push -u origin ${ws.branch}, gh pr create --fill — in a ship tab`}
          placeholder="Commit message"
          onClose={() => setDialog(null)}
          onSubmit={async message => {
            selectTab(await call<TabView>('ship', { ws: ws.id, message }))
            setDialog(null)
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
          ...(settings.ai?.on || old?.tab === 'ai' ? [{ id: 'ai', name: 'Laki AI' }] : []),
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
      {dialog && typeof dialog === 'object' && 'renameWs' in dialog && live.some(w => w.id === dialog.renameWs) && (
        <Prompt
          title="Rename workspace"
          hint="Only the name shown here: the folder and branch keep the id. Enter the id to go back to it."
          initial={wsName(live.find(w => w.id === dialog.renameWs)!)}
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
