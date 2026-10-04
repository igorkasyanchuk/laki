import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { API, type Project, type NotifyKind, type ProjectConfig, type TabView, type View, type WorkspaceView } from '../../shared/types'
import { stamp } from '../../shared/when'
import { api, bridge, notify, openExternal } from './api'
import { type AutoKey, InfoPanel, PRStatus, type WsInfo } from './Info'
import { AddProject, NewWorkspace, type NewWsParams, Palette, type PaletteItem, Prompt } from './panels'
import { type AppInfo, FONT_SIZE, isSection, presetsOf, SettingsPage, type SkillInfo, termLook } from './Settings'
import { Glyph } from './Glyph'
import icon from './icon.svg'
import { HelpPage } from './Help'
import { Term, xterms } from './Term'
import { groupsOf, type Layout, move, resize, tabsOf } from './layout'
import { parseLink, wsLink } from './links'
import { Panes, SideHandle, useTabDrag } from './Panes'
import { actionMenu, type Changes, type FileContent, FileFinder, type FileList, FilePreview, type PanelApi, type PanelTab, PANEL_WIDTH, RunButton, SidePanel, type Thread } from './SidePanel'
import { SchedulesPage } from './Schedules'
import { actionsFor, type RunAction, shortPath } from './text'
import { applyTheme, type Paint, paintKey, paintOf, transparent } from './themes'
import { type Cloudflared, portsOf, TunnelButton, type TunnelApi } from './Tunnel'
import { type AgentUsage, USAGE_AGENTS, UsageButton } from './Usage'
import { colorVar, Icon, IconButton, type IconName, type MenuItem, moveId, StaleDaemon, TAB_COLORS, Tips, useMenu, useRowDrag } from './ui'

type Dialog = null | 'new' | 'project' | 'palette' | 'files' | 'ship' | 'custom' | 'settings' | 'help' | 'schedules' | { schedules: string } | { settings: string; script?: 'run' } | { section: string } | { rename: string } | { renameWs: string }

// the Scheduled tasks page: closed (undefined), all projects (''), or a project's (its ⋯ menu)
const schedulesOf = (d: Dialog) => (d === 'schedules' ? '' : d && typeof d === 'object' && 'schedules' in d ? d.schedules : undefined)

const STATUS_RANK = { waiting: 4, running: 3, done: 2, idle: 1, exited: 0 } as const

// a workspace's (or tab's) glyph: ◆ needs you, spinner running, ● finished while you looked away, ◷ limit
function rollup(tabs: TabView[]) {
  let best: keyof typeof STATUS_RANK = 'exited'
  let limit = false
  for (const t of tabs) {
    limit ||= !!t.limit
    const s = t.done && t.status === 'idle' ? 'done' : t.status
    if (STATUS_RANK[s] > STATUS_RANK[best]) best = s
  }
  return limit && best !== 'waiting' && best !== 'running' ? 'limit' : best
}

// a tab's color: its own, else claude's or codex's ('none' turns that off)
const colorOf = (t?: TabView) => t?.color ?? (t?.preset === 'claude' ? 'orange' : t?.preset === 'codex' ? 'teal' : undefined)

// where a folder opens: editors (one of them is ⌘E's), Finder, terminals
const EDITOR_IDS = ['cursor', 'zed', 'vscode', 'windsurf', 'sublime', 'webstorm', 'intellij', 'xcode', 'custom']
const appIcon = (id: string): IconName => (id === 'finder' ? 'folder' : EDITOR_IDS.includes(id) ? 'code' : 'terminal')

const tabGlyph = (t: TabView) => (t.limit ? 'limit' : t.done && t.status === 'idle' ? 'done' : t.status === 'exited' && t.code === 0 ? 'ok' : t.status)
const SIDE = 240 // the sidebar's default width
let requests = 0
const wsName = (w: { id: string; name?: string }) => w.name || w.id

const load = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') ?? d
  } catch {
    return d
  }
}

// the last theme (and glass, font), until the daemon's settings arrive
applyTheme(load<string | Paint>('laki.theme', ''))

// a media query's answer, kept current (useSyncExternalStore): a phone's narrow layout, a touch screen's keys
const media = (q: string) => {
  const m = matchMedia(q)
  return { on: (f: () => void) => (m.addEventListener('change', f), () => m.removeEventListener('change', f)), now: () => m.matches }
}
const NARROW = media('(max-width: 640px)') // under the app window's minWidth (700): phones and narrow browsers only
const TOUCH = media('(pointer: coarse)')

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
  const [wsId, setWsId] = useState<string | null>(() => load('laki.ws', null))
  const [tabByWs, setTabByWs] = useState<Record<string, string>>(() => load('laki.tabs', {})) // the focused pane's session
  const [dialog, setDialog] = useState<Dialog>(null)
  const settingsKey = useMemo(() => ++requests, [dialog]) // each request remounts the settings page where it asks
  const [newFor, setNewFor] = useState<string>() // a project just opened: its new-workspace dialog
  const [newInit, setNewInit] = useState<Partial<NewWsParams>>() // a laki://new link's prompt, preset, name
  const [link, setLink] = useState<string>() // a laki:// link, routed once the view is in
  const [panelOpen, setPanelOpen] = useState<boolean>(() => load('laki.panel', false)) // the right panel: files, changes, review
  const [panelTab, setPanelTab] = useState<PanelTab>(() => load('laki.panelTab', 'files'))
  const [panelW, setPanelW] = useState<number>(() => load('laki.panelW', PANEL_WIDTH))
  const [preview, setPreview] = useState<{ ws: string; path: string; line?: number; n: number } | null>(null) // a file shown in the app; n: each request reloads it
  const [info, setInfo] = useState<boolean>(() => load('laki.info', false)) // the workspace info panel
  const [finds, setFinds] = useState<Record<string, number>>({}) // ⌘F presses per session, for its find bar
  const [stored, setStored] = useState<Record<string, Layout[]>>(() => load('laki.groups', {})) // tabs (of panes) per workspace
  const [sideW, setSideW] = useState<number>(() => load('laki.side', SIDE))
  const [sideOpen, setSideOpen] = useState<boolean>(() => load('laki.sideOpen', true))
  const [runsSeen, setRunsSeen] = useState<string>(() => load('laki.runsSeen', '')) // the newest scheduled run read
  const [dropping, setDropping] = useState(false) // a folder dragged over the window
  const [error, setError] = useState('')
  const [menu, openMenu] = useMenu()
  const [apps, setApps] = useState<AppInfo[]>([])
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const narrow = useSyncExternalStore(NARROW.on, NARROW.now) // a phone: one pane at a time, the sidebar and panels over it
  const touch = useSyncExternalStore(TOUCH.on, TOUCH.now)
  const mru = useRef<string[]>([]) // sessions, most recently focused first: which pane a tab focuses

  const live = useMemo(() => view?.workspaces.filter(w => !w.archived) ?? [], [view])
  const ws = live.find(w => w.id === wsId) ?? live[0] ?? null
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
  useEffect(() => void localStorage.setItem('laki.info', JSON.stringify(info)), [info])
  useEffect(() => void (narrow && dialog && setSideOpen(false)), [narrow, dialog]) // a page the drawer opened goes on top
  // the phone's tab strip scrolls: the selected tab first in it (scroll-padding clears the sidebar button)
  useEffect(() => void (narrow && document.querySelector('.tab.sel')?.scrollIntoView({ block: 'nearest', inline: 'start' })), [narrow, tab?.id])
  useEffect(() => {
    localStorage.setItem('laki.panel', JSON.stringify(panelOpen))
    localStorage.setItem('laki.panelTab', JSON.stringify(panelTab))
    localStorage.setItem('laki.panelW', JSON.stringify(panelW))
  }, [panelOpen, panelTab, panelW])

  // the theme, painted before the terminals read it (their effects run before ours)
  const paint = paintOf(view?.settings)
  const theme = paintKey(paint) // terminals repaint when it changes
  const painted = useRef<string | null>(null)
  const glassed = useRef<boolean | null>(null)
  if (view && painted.current !== theme) {
    if (glassed.current !== !!paint.glass) bridge?.glass?.((glassed.current = !!paint.glass)) // the window's own blur
    painted.current = theme
    applyTheme(paint)
    localStorage.setItem('laki.theme', JSON.stringify(paint))
  }

  const toast = (m: string) => {
    setError(m)
    setTimeout(() => setError(''), 6000)
  }
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
      else if (m.ev === 'open') {
        setConnected(true)
        api.call<AppInfo[]>('apps').then(setApps, () => {})
      }
      else if (m.ev === 'close') setConnected(false)
      else if (m.ev === 'turn') {
        const t = viewRef.current?.tabs.find(t => t.id === m.tab)
        const shown = document.hasFocus() && shownTabs.current.includes(m.tab)
        const s = viewRef.current?.settings
        const w = viewRef.current?.workspaces.find(w => w.id === t?.workspace)
        if (!t || shown || s?.notify === false || s?.notifyOn?.[m.kind as NotifyKind] === false || t.muted || w?.muted) return
        const body = m.kind === 'waiting' ? `needs you${m.text ? `: ${m.text}` : ''}` : m.kind === 'limit' ? 'hit a usage limit' : m.text || 'finished'
        notify(`${w ? wsName(w) : t.workspace} · ${t.name}`, body.slice(0, 200), t.id, () => selectTab(t.id), s?.notifySound)
      }
    })
    api.connect()
    bridge?.onFocusTab(selectTab)
    bridge?.onDeepLink?.(setLink)
    return off
  }, [selectTab])

  // laki:// links select and fill in; nothing starts from one
  useEffect(() => {
    if (!link || !view) return
    setLink(undefined)
    const l = parseLink(link)
    const proj = (id?: string) => view.projects.find(p => p.id === id || p.name === id)?.id
    if (l?.to === 'ws') {
      const w = view.workspaces.find(w => w.id === l.ws)
      const t = view.tabs.find(t => t.id === l.tab && t.workspace === w?.id)
      if (!w) toast(`No workspace ${l.ws}`)
      else if (w.archived) toast(`${wsName(w)} is archived`)
      else {
        setDialog(null)
        t ? selectTab(t) : setWsId(w.id)
      }
    } else if (l?.to === 'new') {
      if (!view.projects.length) return toast('Add a project first (⌘O)')
      const presets = [...presetsOf(view.settings).map(p => p.name), 'shell', 'none']
      if (l.project && !proj(l.project)) toast(`No project ${l.project}: pick one`)
      setNewFor(proj(l.project))
      setNewInit({ prompt: l.prompt, name: l.name, ...(l.preset && presets.includes(l.preset) && { preset: l.preset }) })
      setDialog('new')
    } else if (l?.to === 'schedules') setDialog({ schedules: proj(l.project) ?? '' })
    else if (l?.to === 'settings') setDialog(l.section && isSection(l.section) ? { section: l.section } : 'settings')
    else if (l?.to === 'help') setDialog('help')
    else toast(`Laki can't open ${link.slice(0, 80)}`)
  }, [link, view])

  // tell the daemon what's on screen: it clears ● there and doesn't set it
  const current = useRef<string | null>(null)
  current.current = tab?.id ?? null
  const shownTabs = useRef<string[]>([])
  shownTabs.current = visible
  useEffect(() => {
    const report = () => api.send('view', { tab: current.current, tabs: shownTabs.current, focused: document.hasFocus() })
    report()
    window.addEventListener('focus', report)
    window.addEventListener('blur', report)
    const off = api.on(m => m.ev === 'open' && report())
    return () => {
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', report)
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

  // panes: a pane (or a whole tab) dropped next to another pane, or onto the tab bar: a tab of its own
  const { drag, start } = useTabDrag((id, whole, over) => {
    setGroups(move(groups, id, whole, over))
    selectTab(id)
  })

  const newTab = async (preset: string, cmd?: string) => ws && selectTab(await call<TabView>('tabNew', { ws: ws.id, preset, cmd }))
  // a new shell next to the focused pane
  const split = async (edge: 'right' | 'bottom', next = tab?.id) => {
    if (!ws || !next) return
    const t = await call<TabView>('tabNew', { ws: ws.id, preset: 'shell' })
    setGroups(move([...groups, { tab: t.id }], t.id, false, { pane: next, edge }))
    selectTab(t)
  }

  const closeTabs = async (ts: TabView[]) => {
    const running = ts.filter(t => t.status !== 'exited')
    if (running.length && !confirm(`Close ${ts.map(t => t.name).join(', ')}? ${running.length > 1 ? 'Their processes' : 'Its process'} will be stopped.`)) return
    for (const t of ts) await call('tabClose', { id: t.id })
  }

  const moveWs = (d: number) => {
    if (!live.length) return
    const i = Math.max(0, live.findIndex(w => w.id === ws?.id))
    setWsId(live[(i + d + live.length) % live.length].id)
  }

  const rmWs = async (w: WorkspaceView, archive: boolean) => {
    const what = archive ? 'Archive' : 'Delete'
    if (!confirm(`${what} ${wsName(w)}? Its tabs stop${w.kind === 'worktree' ? ', the worktree is removed (the branch stays)' : ''}.`)) return
    await call(archive ? 'wsArchive' : 'wsRm', { id: w.id })
  }

  const run = async () => ws && selectTab(await call<TabView>('run', { ws: ws.id }))
  // one panel on the right: the side panel (on a tab) or the info panel
  const showPanel = (t: PanelTab) => (setPanelTab(t), setPanelOpen(true), setInfo(false))
  const togglePanel = (t = panelTab) => (panelOpen && t === panelTab ? setPanelOpen(false) : showPanel(t))
  const showInfo = (on = !info) => (setInfo(on), on && setPanelOpen(false))
  // the run script: its tab, Run ▾
  const devTab = ws ? view?.tabs.find(t => t.workspace === ws.id && t.kind === 'dev') : undefined
  const devRunning = !!devTab && devTab.status !== 'exited'
  const editScripts = () => project && setDialog({ settings: project.id, script: 'run' })
  // an action from Run ▾: a prompt to its agent's tab (queued while it works), a command to a shell (a new one if none)
  const runAction = async (w: WorkspaceView, a: RunAction, tab?: string) => {
    // a new tab goes in whole: the view doesn't have it yet
    const t = tab ? byId(tab) : await call<TabView>('tabNew', { ws: w.id, preset: 'shell' }).catch(() => null)
    if (!t) return
    selectTab(t)
    const r = await call<{ queued?: number }>('send', { target: t.id, text: a.text, whenIdle: a.target !== 'shell' }).catch(() => null)
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
          ...(project ? [{ label: 'Edit actions…', icon: 'pencil', run: () => setDialog({ settings: project.id }) } as MenuItem] : []),
        ]
      : []
  const panelApi = (w: WorkspaceView): PanelApi => ({
    files: () => api.call<FileList>('files', { ws: w.id }),
    newFile: (path, dir) => api.call<{ path: string }>('fileNew', { ws: w.id, path, dir }).then(r => r.path),
    openFile: file => void call('openIn', { ws: w.id, app: 'editor', file }).catch(() => {}),
    preview: (path, line) => setPreview({ ws: w.id, path, line, n: ++requests }),
    changes: () => api.call<Changes>('diff', { ws: w.id }),
    threads: () => api.call<Thread[]>('prThreads', { ws: w.id }),
    comment: c => api.call('prComment', { ws: w.id, ...c }).then(() => toast(`Commented on PR #${w.pr?.number}`)),
    toAgent: text => api.call('send', { target: w.id, text, whenIdle: true }).then(() => toast('Sent to the agent')),
    saveImage: data => api.call<string>('imageSave', { data, ext: 'png' }),
  })
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Copied'), fail)
  const tunnelApi = (w: WorkspaceView): TunnelApi => ({
    check: () => api.call<Cloudflared>('cloudflared', { ws: w.id }),
    start: (port, mails) => api.call('tunnelStart', { ws: w.id, port, mails }),
    stop: port => api.call('tunnelStop', { ws: w.id, port }),
    open: openExternal,
    copy,
  })
  const settings = view?.settings ?? {}
  const tracked = Object.keys(USAGE_AGENTS).filter(a => settings.usage?.[a] !== false) // the status bar's plan limits
  const editor = settings.editor || 'cursor'
  const targets: AppInfo[] = [...apps, ...(settings.editorCmd?.trim() ? [{ id: 'custom', name: 'Custom command' }] : [])]
  const editorName = targets.find(a => a.id === editor && a.id !== 'custom')?.name ?? 'editor'
  const openIn = (app: string, where: { ws?: string; project?: string } = { ws: ws?.id }) => {
    call('openIn', { ...where, app }).catch(() => {})
    // an editor picked from the list is ⌘E's from now on
    if (EDITOR_IDS.includes(app) && app !== editor) call('settingsSet', { editor: app }).catch(() => {})
  }
  // Open in: every app, ⌘E's first
  const openInItems = (where: { ws?: string; project?: string } = { ws: ws?.id }): MenuItem[] =>
    [...targets]
      .sort((a, b) => Number(b.id === editor) - Number(a.id === editor))
      .map(a => ({ label: a.name, icon: appIcon(a.id), hint: a.id === editor ? '⌘E' : undefined, run: () => openIn(a.id, where) }))
  const openPort = (port: number) => openExternal(`http://localhost:${port}`)
  const fontSize = settings.fontSize ?? FONT_SIZE
  const zoomed = useRef(fontSize) // the size asked for last: quick presses add up before the view comes back
  const zoom = (d: number) => {
    zoomed.current = d ? Math.min(32, Math.max(8, zoomed.current + d)) : FONT_SIZE
    call('settingsSet', { fontSize: zoomed.current }).catch(() => {})
  }
  useEffect(() => void (zoomed.current = fontSize), [fontSize])

  // the sidebar's order: projects, and workspaces within their project, dragged
  const rows = useRowDrag(d =>
    d.kind === 'project'
      ? call('reorder', { projects: moveId(view!.projects.map(p => p.id), d) })
      : call('reorder', { workspaces: moveId(live.filter(w => w.project === live.find(x => x.id === d.id)?.project).map(w => w.id), d) }),
  )

  // right click on a workspace in the sidebar
  const wsMenu = (w: WorkspaceView): MenuItem[] => [
    { colors: TAB_COLORS, value: w.color, pick: c => call('wsSet', { id: w.id, color: c }) },
    { label: 'Rename…', icon: 'pencil', key: 'r', run: () => setDialog({ renameWs: w.id }) },
    { label: 'Info', icon: 'info', key: 'i', run: () => (setWsId(w.id), showInfo(true)) },
    { label: w.muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', run: () => call('wsSet', { id: w.id, muted: !w.muted }) },
    ...(bridge ? [{ label: 'Copy link', icon: 'link', key: 'l', run: () => copy(wsLink(w.id)) } as MenuItem] : []),
    null,
    { head: 'Open in' },
    ...openInItems({ ws: w.id }),
    null,
    ...(w.kind === 'worktree'
      ? [
          { label: 'Fork workspace', icon: 'fork', key: 'f', run: () => call<WorkspaceView>('wsFork', { id: w.id }).then(x => setWsId(x.id)) } as MenuItem,
          { label: 'Archive workspace', icon: 'archive', key: 'a', run: () => rmWs(w, true) } as MenuItem,
        ]
      : []),
    { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(w, false) },
  ]

  // a workspace for the info panel and the status bar's PR
  const infoOf = (w: WorkspaceView): WsInfo => ({
    ...w,
    fixTries: w.fix?.pr === w.pr?.number ? w.fix?.tries : 0,
    agents: (view?.tabs ?? []).filter(t => t.workspace === w.id && t.kind === 'agent').map(t => ({ id: t.id, name: t.name, glyph: tabGlyph(t), last: t.last })),
  })
  const setAuto = (w: WorkspaceView, k: AutoKey, v: boolean) => call('wsSet', { id: w.id, [k]: v }).catch(() => {})
  const prFix = (w: WorkspaceView, what: 'ci' | 'review') => call('prFix', { ws: w.id, what }).then(() => toast('Sent to the agent'), () => {})

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
  const fork = async () => ws && setWsId((await call<WorkspaceView>('wsFork', { id: ws.id })).id)
  const restore = (id: string) => call('wsRestore', { id }).then(() => setWsId(id))
  const newWs = (projectId?: string) => {
    setNewFor(projectId)
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

  // keys: capture phase, before xterm.js sees them
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (e.metaKey && e.altKey && !e.ctrlKey && e.code === 'KeyB') return void (e.preventDefault(), e.stopPropagation(), ws && togglePanel())
    if (!e.metaKey || e.altKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    const act: Record<string, () => void> = {
      n: () => newWs(ws?.project),
      b: () => setSideOpen(o => !o),
      ',': () => setDialog(d => (d === 'settings' || (typeof d === 'object' && d && ('settings' in d || 'section' in d)) ? null : 'settings')),
      '/': () => setDialog(d => (d === 'help' ? null : 'help')),
      e: () => ws && openIn(editor),
      '=': () => zoom(1),
      '+': () => zoom(1),
      '-': () => zoom(-1),
      '0': () => zoom(0),
      o: openProject,
      f: () => dialog || (tab && setFinds(m => ({ ...m, [tab.id]: (m[tab.id] ?? 0) + 1 }))), // not over a dialog
      t: () => newTab('shell'),
      w: () => (previewed ? setPreview(null) : tab && closeTabs([tab])), // the file preview first
      k: () => setDialog(d => (d === 'palette' ? null : 'palette')),
      p: () => ws && setDialog(d => (d === 'files' ? null : 'files')),
      d: () => git && togglePanel('changes'),
      i: () => showInfo(),
      arrowup: () => moveWs(-1),
      arrowdown: () => moveWs(1),
    }
    if (/^[1-9]$/.test(k)) act[k] = () => groups[Number(k) - 1] && selectGroup(groups[Number(k) - 1])
    if (!act[k] || (e.shiftKey && k !== 'arrowup' && k !== 'arrowdown' && k !== '+')) return
    e.preventDefault()
    e.stopPropagation()
    act[k]()
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])

  // the actions, once: the ⋯ menus and the palette show the same ones
  type Action = { label: string; icon: IconName; hint?: string; key?: string; danger?: boolean; run: () => void }
  const newTabActions: Action[] = [
    { label: 'Shell', icon: 'terminal', hint: '⌘T', run: () => newTab('shell') },
    ...(view?.presets ?? []).map(p => ({ label: p.name, icon: 'agent', run: () => newTab(p.name) }) as Action),
    { label: 'Command…', icon: 'terminal', run: () => setDialog('custom') },
  ]
  const wsActions: Action[] = !ws
    ? []
    : [
        ...(tab ? [{ label: 'Split right', icon: 'splitRight', run: () => split('right') } as Action, { label: 'Split down', icon: 'splitDown', run: () => split('bottom') } as Action] : []),
        ...(ws.kind === 'worktree'
          ? [{ label: 'Fork workspace', icon: 'fork', key: 'f', run: fork } as Action, { label: 'Archive workspace', icon: 'archive', key: 'a', run: () => rmWs(ws, true) } as Action]
          : []),
        { label: 'Rename workspace…', icon: 'pencil', key: 'r', run: () => setDialog({ renameWs: ws.id }) },
        { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, run: () => rmWs(ws, false) },
      ]
  const tasksOf = (project: string) => (n => (n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : undefined))(view?.schedules?.filter(s => s.project === project).length ?? 0)
  const projectActions = (p: Project): MenuItem[] => {
    const archived = view?.workspaces.filter(w => w.archived && w.project === p.id) ?? []
    return [
      { label: 'New workspace', icon: 'plus', hint: '⌘N', run: () => newWs(p.id) },
      { label: 'Settings…', icon: 'settings', run: () => setDialog({ settings: p.id }) },
      { label: 'Scheduled tasks…', icon: 'clock', hint: tasksOf(p.id), run: () => setDialog({ schedules: p.id }) },
      { label: 'Remove project', icon: 'trash', key: 'd', danger: true, run: () => confirm(`Remove project ${p.name}? Its files stay.`) && call('projectRm', { id: p.id }) },
      null,
      { head: 'Open in' },
      ...openInItems({ project: p.id }),
      ...(archived.length ? [null, { head: 'Archived' }, ...archived.map(w => ({ label: wsName(w), icon: 'restore' as IconName, hint: 'restore', run: () => restore(w.id) }))] : []),
    ]
  }

  const palette: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = []
    const a = (x: Action) => items.push({ ...x, hint: x.hint ?? 'action' })
    if (ws) a({ label: 'Find files…', icon: 'search', hint: '⌘P', run: () => setDialog('files') }) // first: it opens a search of its own
    for (const w of live) items.push({ label: wsName(w), hint: `${w.branch || 'folder'} · workspace`, glyph: rollup(view!.tabs.filter(t => t.workspace === w.id)), run: () => setWsId(w.id) })
    for (const t of view?.tabs ?? []) {
      const w = live.find(w => w.id === t.workspace)
      if (w) items.push({ label: `${wsName(w)} / ${t.name}`, hint: t.last ? t.last.slice(0, 80) : 'tab', glyph: tabGlyph(t), run: () => selectTab(t.id) })
    }
    a({ label: 'New workspace', icon: 'plus', hint: '⌘N', run: () => newWs(ws?.project) })
    a({ label: 'Open project folder…', icon: 'folderPlus', hint: '⌘O', run: openProject })
    a({ label: 'Settings', icon: 'gear', hint: '⌘,', run: () => setDialog('settings') })
    a({ label: 'Scheduled tasks', icon: 'clock', run: () => setDialog('schedules') })
    a({ label: 'Help: keys and commands', icon: 'help', hint: '⌘/', run: () => setDialog('help') })
    a({ label: sideOpen ? 'Hide sidebar' : 'Show sidebar', icon: 'sidebar', hint: '⌘B', run: () => setSideOpen(o => !o) })
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
      if (previewed) a({ label: 'Close the file preview', icon: 'x', hint: '⌘W', run: () => setPreview(null) })
      if (tab) a({ label: `Close ${tab.name}`, icon: 'x', hint: previewed ? undefined : '⌘W', run: () => closeTabs([tab]) })
      if (ws.pr) a({ label: `Open PR #${ws.pr.number}`, icon: 'pr', run: () => openExternal(ws.pr!.url) })
      for (const p of ws.ports) a({ label: `Open localhost:${p}`, icon: 'link', run: () => openExternal(`http://localhost:${p}`) })
      if (project) a({ label: `Project settings: ${project.name}`, icon: 'settings', run: () => setDialog({ settings: project.id }) })
    }
    for (const w of view?.workspaces.filter(w => w.archived) ?? []) a({ label: `Restore ${wsName(w)}`, icon: 'restore', hint: 'archived', run: () => restore(w.id) })
    return items
  }, [view, live, ws, tab, group, sideOpen, apps, previewed])

  if (!view)
    return (
      <div className="splash">
        <div className="logo">
          <img src={icon} alt="" />
          <span className="wordmark">Laki</span>
        </div>
        <div className="muted">{connected ? 'loading…' : 'connecting to the daemon…'}</div>
      </div>
    )

  const settingsFor = dialog && typeof dialog === 'object' && 'settings' in dialog ? view.projects.find(p => p.id === dialog.settings) : undefined
  const section = dialog && typeof dialog === 'object' && 'section' in dialog ? dialog.section : undefined // a Settings section asked for
  const schedulesFor = schedulesOf(dialog)
  const ports = ws ? portsOf(ws.ports, ws.tunnels).filter(p => p !== ws.port) : [] // $PORT has its own, always
  const nextTask = (view.schedules ?? []).filter(s => s.on && s.next).sort((a, b) => a.next! - b.next!)[0]
  const runs = view.runs ?? [] // newest first: the ones above the last read
  const seen = runs.findIndex(r => r.id === runsSeen)
  const runFailed = runs.slice(0, seen < 0 ? undefined : seen).some(r => !r.ok) // the clock gets a dot
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
  return (
    <div className={`app ${sideOpen ? '' : 'side-closed'} ${narrow ? 'narrow' : ''} ${bridge ? 'electron' : ''}`}>
      {sideOpen && (
      <aside className="sidebar" style={{ width: sideW }}>
        <div className="side-head drag">
          <IconButton icon="sidebar" title="Hide sidebar (⌘B)" onClick={() => setSideOpen(false)} />
          <span className="spacer" />
          <IconButton icon="folderPlus" title="Open a project folder (⌘O), or drop one on the window" onClick={openProject} />
          <IconButton
            icon="clock"
            title={nextTask ? `Scheduled tasks · next: ${nextTask.name ? stamp(nextTask.name, nextTask.next!) : nextTask.prompt.slice(0, 40)}, ${new Date(nextTask.next!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Scheduled tasks'}
            on={schedulesFor !== undefined}
            className={runFailed ? 'dot' : ''}
            onClick={() => setDialog(d => (schedulesOf(d) === undefined ? 'schedules' : null))}
          />
          <IconButton icon="help" title="Help: keys and commands (⌘/)" on={dialog === 'help'} onClick={() => setDialog(d => (d === 'help' ? null : 'help'))} />
          <IconButton icon="gear" title="Settings (⌘,)" on={dialog === 'settings'} onClick={() => setDialog(d => (d === 'settings' ? null : 'settings'))} />
        </div>
        <div className="side-scroll">
          {view.projects.map(p => (
            <div key={p.id} className="project">
              <div
                className={`project-head ${rows.at('project', p.id)}`}
                title={p.path}
                data-row={`project:${p.id}`}
                onPointerDown={e => rows.start(e, 'project', p.id)}
                onContextMenu={e => openMenu(e, projectActions(p))}
              >
                <span className="project-name">{p.name}</span>
                <span className="spacer" />
                <IconButton icon="plus" title="New workspace" onClick={() => newWs(p.id)} />
                <IconButton icon="more" title="Project" onClick={e => openMenu(e, projectActions(p))} />
              </div>
              {live
                .filter(w => w.project === p.id)
                .map(w => {
                  const wt = view.tabs.filter(t => t.workspace === w.id)
                  const queued = wt.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
                  return (
                    <div
                      key={w.id}
                      className={`ws ${w.id === ws?.id ? 'sel' : ''} ${rows.at('ws', w.id)}`}
                      style={colorVar(w.color)}
                      data-row={`ws:${w.id}`}
                      data-group={p.id}
                      onPointerDown={e => rows.start(e, 'ws', w.id, p.id)}
                      onClick={() => (setWsId(w.id), narrow && setSideOpen(false))}
                      onContextMenu={e => openMenu(e, wsMenu(w))}
                      title={`${w.branch || w.path} · $PORT ${w.port}${w.schedule ? ` · from the scheduled task ${view.schedules?.find(s => s.id === w.schedule)?.name ?? ''}`.trimEnd() : ''}${w.muted ? ' · notifications muted' : ''}`}
                    >
                      <Glyph s={w.setup ? 'running' : rollup(wt)} />
                      <span className="ws-name">{wsName(w)}</span>
                      {queued > 0 && <span className="badge">+{queued}</span>}
                      <span className="spacer" />
                      {w.muted && (
                        <span className="ws-mark">
                          <Icon name="bellOff" size={11} />
                        </span>
                      )}
                      {w.schedule && (
                        <span className="ws-sched">
                          <Icon name="clock" size={11} />
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
          {!view.projects.length && <div className="empty-side muted">Open a folder (⌘O) or drop one here.</div>}
        </div>
      </aside>
      )}
      {sideOpen && (narrow ? <div className="side-backdrop" onClick={() => setSideOpen(false)} /> : <SideHandle width={sideW} onWidth={setSideW} init={SIDE} />)}

      <main className="main">
        <div className="tabbar drag" data-tabbar>
          {!sideOpen && <IconButton icon="sidebar" title="Show sidebar (⌘B)" className="nodrag side-show" onClick={() => setSideOpen(true)} />}
          {groups.map(g => {
            const ts = tabsOf(g).map(byId).filter((t): t is TabView => !!t)
            const queued = ts.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
            return (
              <div
                key={ts[0]?.id}
                className={`tab nodrag ${g === group ? 'sel' : ''}`}
                style={colorVar(colorOf(ts[0]))}
                onClick={() => selectGroup(g)}
                onDoubleClick={() => ts[0] && setDialog({ rename: ts[0].id })}
                onContextMenu={e => openMenu(e, tabMenu(tabsOf(g)))}
                onPointerDown={e => ts[0] && start(e, ts[0].id, true)}
                onAuxClick={e => e.button === 1 && closeTabs(ts)}
                data-tip={`⌘${groups.indexOf(g) + 1} · double click to rename · drag onto a pane to split · right click for more`}
              >
                <Glyph s={ts.length > 1 ? rollup(ts) : ts[0] ? tabGlyph(ts[0]) : 'idle'} />
                <span>{ts.map(t => t.name).join(' · ')}</span>
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
          {ws && <IconButton icon="plus" title="New tab" className="nodrag" onClick={e => openMenu(e, newTabActions)} />}
          <span className="spacer" />
          {ws && (
            <div className="actions nodrag">
              {!narrow && ( // a phone: in ⌘K's palette (the search button)
                <>
                  <IconButton icon="code" title={`Open in… (⌘E: ${editorName})`} onClick={e => openMenu(e, openInItems(), 'right')} />
                  <IconButton icon="info" title="Workspace info (⌘I)" on={info} onClick={() => showInfo()} />
                </>
              )}
              <IconButton icon="panel" title="Files, changes, review, preview (⌥⌘B)" on={panelOpen} onClick={() => togglePanel()} />
              {ws.kind === 'worktree' && !narrow && <IconButton icon="ship" title="Ship: commit, push, open a PR" onClick={() => setDialog('ship')} />}
              <IconButton icon="search" title="Commands (⌘K)" onClick={() => setDialog('palette')} />
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
        <div className="body">
          <div className="term-wrap">
            {group ? (
              <Panes
                layout={group}
                active={tab?.id ?? null}
                drag={drag}
                label={label}
                color={id => colorOf(byId(id))}
                onMenu={(e, id) => openMenu(e, tabMenu([id]))}
                ghost={drag && (drag.whole ? tabsOf(groups.find(g => tabsOf(g).includes(drag.tab)) ?? null).map(id => byId(id)?.name).join(' · ') : label(drag.tab))}
                render={id => (
                  <Term
                    key={transparent() ? 'clear' : 'solid' /* xterm takes allowTransparency only as it opens */}
                    tab={id}
                    active={id === tab?.id && !dialog}
                    findSeq={finds[id] ?? 0}
                    fontSize={narrow ? Math.min(fontSize, 11) : fontSize /* ponytail: a phone's own size, not a setting */}
                    fontFamily={settings.fontFamily}
                    copyOnSelect={settings.copyOnSelect !== false}
                    theme={theme}
                    look={termLook(settings)}
                  />
                )}
                onFocus={id => id !== tab?.id && selectTab(id)}
                onClose={id => byId(id) && closeTabs([byId(id)!])}
                onResize={(path, at) => setGroups(groups.map(g => (g === group ? resize(g, path, at) : g)))}
                startDrag={(e, id) => start(e, id, false)}
              />
            ) : (
              <div className="empty">
                {ws ? (
                  <>
                    <p>No tabs in {wsName(ws)}.</p>
                    <div className="row">
                      {newTabActions.slice(0, 3).map(x => (
                        <button key={x.label} onClick={x.run}>
                          {x.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p>{view.projects.length ? 'No workspaces yet.' : 'Open a folder, or drop one here.'}</p>
                    <button onClick={() => (view.projects.length ? newWs() : openProject())}>{view.projects.length ? 'New workspace  ⌘N' : 'Open folder…  ⌘O'}</button>
                  </>
                )}
              </div>
            )}
          </div>
          {previewed && ws && (
            <FilePreview
              key={previewed.n}
              path={previewed.path}
              line={previewed.line}
              load={() => api.call<FileContent>('fileRead', { ws: ws.id, path: previewed.path })}
              onOpen={() => panelApi(ws).openFile(previewed.path)}
              onClose={() => setPreview(null)}
            />
          )}
          {panelOpen && ws && (
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
            />
          )}
          {info && ws && (
            <InfoPanel
              w={infoOf(ws)}
              onClose={() => setInfo(false)}
              onOpen={openExternal}
              onToggle={(k, v) => setAuto(ws, k, v)}
              onFix={what => prFix(ws, what)}
              onRename={() => setDialog({ renameWs: ws.id })}
              onAgent={selectTab}
              onCopy={copy}
            />
          )}
        </div>
        {touch && tab && !(narrow && (panelOpen || info || previewed)) /* not under a panel */ && (
          <KeyBar onKey={data => api.send('input', { tab: tab.id, data: xterms.get(tab.id)?.modes.applicationCursorKeysMode ? data.replace(/^\x1b\[([ABCD])$/, '\x1bO$1') : data })} />
        )}
        {(dialog === 'settings' || settingsFor || section) && (
          <SettingsPage
            key={settingsKey}
            settings={view.settings}
            apps={apps}
            onClose={() => setDialog(null)}
            onSave={s => call('settingsSet', s).catch(() => {})}
            projects={view.projects.map(p => ({ ...p, git: p.git !== false }))}
            projectFile={id => api.call<ProjectConfig>('projectFile', { id })}
            onSaveProject={(id, p) => call('projectSet', { id, ...p }).catch(() => {})}
            renameProjects
            skill={{ app: 'Laki', load: () => api.call<SkillInfo[]>('skills'), set: (agent, on) => api.call<SkillInfo[]>('skillSet', { agent, on }) }}
            remote={{ state: view.remote, start: (hours, mail) => api.call('remoteStart', { hours, mail }), stop: () => api.call('remoteStop'), copy, open: openExternal }}
            section={settingsFor ? `project:${settingsFor.id}` : section}
            script={typeof dialog === 'object' && dialog && 'script' in dialog ? dialog.script : undefined}
          />
        )}
        {dialog === 'help' && <HelpPage cli="laki" ship onClose={() => setDialog(null)} />}
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
            view={view}
            project={newFor ?? ws?.project}
            agent={settings.agent}
            initial={newInit}
            onClose={() => {
              setDialog(null)
              setNewFor(undefined)
              setNewInit(undefined)
            }}
            onCreate={async p => {
              const w = await call<WorkspaceView>('wsNew', p)
              setWsId(w.id)
              setDialog(null)
              setNewFor(undefined)
              setNewInit(undefined)
            }}
          />
        )}
        <div className="status">
          {tracked.length > 0 && <UsageButton key={tracked.join()} load={() => api.call<AgentUsage[]>('usage')} /> /* remounts as agents are turned on or off */}
          {ws && (
            <>
              {git && (
                <span title={ws.kind === 'worktree' ? `branch ${ws.branch}, from ${ws.base}` : 'the repo itself'}>
                  ⎇ {ws.branch}
                  {ws.kind === 'worktree' && <span className="muted"> ← {ws.base}</span>}
                </span>
              )}
              <span className="port-item">
                <button
                  className={`listen ${portUp ? '' : 'port-main'}`}
                  data-tip={`$PORT · ${portUp ? 'listening · ' : ''}open http://localhost:${ws.port}`}
                  onClick={() => openPort(ws.port)}
                >
                  $PORT {ws.port}
                </button>
                <TunnelButton key={ws.id} port={ws.port} tunnel={ws.tunnels?.find(t => t.port === ws.port)} api={tunnelApi(ws)} />
              </span>
              {ports.map(port => (
                <span key={`${ws.id}:${port}`} className="port-item">
                  <button className="listen" data-tip={ws.ports.includes(port) ? `listening · open http://localhost:${port}` : 'not listening now'} onClick={() => openPort(port)}>
                    ↗{port}
                  </button>
                  <TunnelButton port={port} tunnel={ws.tunnels?.find(t => t.port === port) /* an older daemon has none */} api={tunnelApi(ws)} />
                </span>
              ))}
              <PRStatus w={infoOf(ws)} onOpen={openExternal} onToggle={(k, v) => setAuto(ws, k, v)} />
              {ws.setup && <span className="warn-soft">setup running…</span>}
            </>
          )}
          <span className="spacer" />
          {view.remote && (
            <button
              className={`remote-badge ${view.remote.url ? '' : 'starting'}`}
              data-tip={`Remote access for ${view.remote.mail}: Settings › Remote access`}
              onClick={() => setDialog({ section: 'remote' })}
            >
              {!view.remote.url ? 'Remote starting…' : view.remote.until ? `Remote until ${new Date(view.remote.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Remote on'}
            </button>
          )}
          {ws && (
            <>
              <span className="path" data-tip={ws.path}>
                {'\u200e' + shortPath(ws.path) /* keeps the leading ~ in the right-to-left truncation */}
              </span>
              <IconButton icon="copy" title="Copy the path" className="path-copy" onClick={() => copy(ws.path)} />
            </>
          )}
          {connected && (view.api ?? 0) < API && <StaleDaemon restart={() => api.call('shutdown')} />}
          {!connected && <span className="warn">reconnecting…</span>}
        </div>
      </main>

      {menu}
      <Tips />
      {dropping && <div className="drop-overlay">Drop a folder to add it as a project</div>}
      {error && <div className="toast">{error}</div>}
      {dialog === 'project' && (
        <AddProject
          onClose={() => setDialog(null)}
          onAdd={async path => {
            await call('projectAdd', { path })
            setDialog(null)
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
