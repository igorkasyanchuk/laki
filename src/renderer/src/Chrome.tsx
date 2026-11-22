// what App draws around the workspace from the view, once it's in (after the splash): its ports, the next step, the
// rail's pages and pins, the side strip, back and forward, the foot buttons, the phone's bar, the AI button, the status
// bar's words; computed inline in App's render (r: App's values this render), as it was in App
import { ACHIEVEMENTS } from '../../shared/achievements'
import type { BarItem } from './Phone'
import type { Collision } from '../../shared/overlap'
import { byOrder as extOrder, click as extClick, Glyph as ExtGlyph, inWs, type WidgetApi, WidgetButtons } from './Widgets'
import { Glyph } from './Glyph'
import { ask, colorVar, Icon, IconButton, type IconName, type MenuItem, Num, ProjectMark, TAB_COLORS } from './ui'
import { PRELOAD } from './Dialogs'
import { type AchievementsKept, aiOn, type MergeMethod, placesOf, type PlanKind, type PlanPin, type Project, RAIL_PINS, type Settings, type TabView, type View, type WidgetView, type WorkspaceView } from '../../shared/types'
import { RAIL_ITEMS, railSorted, type RowMark, rowMarkOn } from './settingsBase'
import { ciText, type FixWhat, type PRAct, prState, REVIEW } from './Info'
import { type Action, type Dialog, extOf, type Find, flowsOf, notesOf, type Place, type RailKind, settingsOf, specsOf, STATE_WORDS, STEP_ICON, tabGlyph, type Timer, type Watch, wsName } from './appCtx'
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { nextStep, type Step } from '../../shared/nextStep'
import { api, openExternal, pageNow } from './api'
import { initials, spins } from './text'
import { isIconName } from '../../shared/icons'
import { isKeyId, type KeyId } from '../../shared/keys'
import { onDesk } from './Desk'
import { portsOf } from './Tunnel'
import { stamp } from '../../shared/when'
import { whenOk } from '../../shared/widgetSchema'
import { isPlace, schedulesOf } from './AppParts'
import type { Call } from '../../shared/api'
import type { PanelTab } from './SidePanel'

// the rail layout (Settings › Appearance › Layout): a kind each, its words, its icon
const RAIL: [RailKind, string, IconName][] = [['projects', 'Projects', 'fork'], ['shells', 'Terminal', 'terminal'], ['browsers', 'Browser', 'globe']]
// the rail with words: past RAIL_FIT buttons above the pins (⋯ More one of them), these go into More, the least used first
const RAIL_FIT = 7
const RAIL_MORE = ['todos', 'calendar', 'workflows', 'specs', 'board']

export type ChromeIn = {
  achKept: AchievementsKept
  allows: (w: WorkspaceView, k: 'approve' | 'close' | 'merge' | 'land' | 'revert') => boolean
  archive: (w: WorkspaceView, asked?: boolean) => Promise<void>
  byId: (id: string) => TabView | undefined
  call: Call
  dialog: Dialog
  dropOn: string | null
  dropProps: (w: WorkspaceView) => { onDragOver: (e: React.DragEvent) => void | false; onDragLeave: (e: React.DragEvent) => void | false; onDrop: (e: React.DragEvent) => void; }
  fail: (e: unknown) => void
  find: Find | null
  flowsOn: boolean
  hist: RefObject<{ at: Place[]; i: number; going?: string; }>
  historyOn: boolean
  kh: (id: KeyId) => string | undefined
  kindOf: (w: WorkspaceView) => RailKind
  kt: (title: string, id: KeyId) => string
  live: WorkspaceView[]
  narrow: boolean
  needing: TabView[]
  needsYou: (t: TabView) => boolean
  openMenu: (e: React.MouseEvent | DOMRect, items: MenuItem[], align?: 'left' | 'right') => void
  order: WorkspaceView[]
  pickKey: string
  picking: boolean
  placeName: (p: Place) => string
  prAct: (w: WorkspaceView, act: PRAct, method?: MergeMethod) => Promise<void | false>
  prFix: (w: WorkspaceView, what: FixWhat, job?: string) => Promise<boolean>
  projOf: (w?: { project: string; } | null) => Project | undefined
  projWords: (w: WorkspaceView) => string
  project: Project | undefined
  quickNew: (kind: 'shells' | 'browsers', url?: string, front?: boolean, at?: { project: string; place?: string; }) => Promise<void>
  radarHid: string[]
  rail: boolean
  railKind: RailKind
  railOf: (k?: RailKind) => RailKind
  railTo: (k: RailKind) => void
  railW: number
  railWords: boolean
  rawKind: (w: WorkspaceView) => RailKind
  runsSeen: string
  selectTab: (ref: string | { id: string; workspace: string; }) => void
  setDialog: Dispatch<SetStateAction<Dialog>>
  setPicking: Dispatch<SetStateAction<boolean>>
  setSideOpen: (v: boolean | ((o: boolean) => boolean)) => void
  setStrip: (k: RailKind, at?: 'left' | 'right') => void
  setWsId: Dispatch<SetStateAction<string | null>>
  settings: Settings
  showPanel: (t: PanelTab) => void
  sideOpen: boolean
  sideOpens: Partial<Record<RailKind, boolean>>
  specsOn: boolean
  startMenu: () => MenuItem[]
  strips: Partial<Record<RailKind, "left" | "right">>
  tab: TabView
  tabs: TabView[]
  timers: Timer[]
  tint: (w: WorkspaceView) => string | undefined
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean, err?: boolean, ms?: number) => void
  travel: (j: number) => void
  video: { src: string; play?: boolean; at?: number; min?: boolean; } | null
  view: View
  watches: Watch[]
  widgetApi: WidgetApi
  widgetsNow: RefObject<WidgetView[]>
  ws: WorkspaceView | null
  wsActions: Action[]
  wsHere: string | null
  wsMenu: (w: WorkspaceView) => MenuItem[]
  wsTabMenu: (e: React.MouseEvent | DOMRect, items: MenuItem[], align?: 'left' | 'right') => void
}

export function chromeOf(r: ChromeIn) {
  const { achKept, allows, archive, byId, call, dialog, dropOn, dropProps, fail, find, flowsOn, hist, historyOn, kh, kindOf, kt, live, narrow, needing, needsYou, openMenu, order, picking, pickKey, placeName, prAct, prFix, project, projOf, projWords, quickNew, radarHid, rail, railKind, railOf, railTo, railW, railWords, rawKind, runsSeen, selectTab, setDialog, setPicking, setSideOpen, setStrip, settings, setWsId, showPanel, sideOpen, sideOpens, specsOn, startMenu, strips, tab, tabs, timers, tint, toast, travel, video, view, watches, widgetApi, widgetsNow, ws, wsActions, wsHere, wsMenu, wsTabMenu } = r
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
  // Collision radar: where a workspace's changes meet another live worktree's, or what landed on its base since it
  // branched (the daemon's scanOverlaps); one you hid stays hidden while it reads the same
  const radarKey = (w: WorkspaceView, c: Collision) => [w.id, c.ws ?? c.base, c.file, c.mine, c.theirs].join('|')
  const radarOf = (w: WorkspaceView) => (w.overlaps ?? []).filter(c => !radarHid.includes(radarKey(w, c)))
  // One next step (shared/nextStep.ts): the toolbar's button (⌘G) and a row's chip; a click does it
  const stepsOn = settings.nextStep !== false
  // a row's marks (Settings › Appearance › Sidebar rows); Show ›, in the sidebar's right clicks, turns each on or off
  const mark = (m: RowMark) => rowMarkOn(settings, m)
  const stepOf = (w: WorkspaceView) => nextStep(w, view!.tabs, { merge: allows(w, 'merge'), git: projOf(w)?.git !== false })
  const doStep = (w: WorkspaceView, s: Step) => {
    const at = () => (setWsId(w.id), setDialog(null))
    if (s.tab && ['answer', 'plan', 'check', 'working'].includes(s.id)) return selectTab({ id: s.tab, workspace: w.id })
    if (s.id === 'continue') return void call('send', { target: s.tab, text: 'continue' }).catch(() => {})
    if (s.id === 'conflict' || s.id === 'ci' || s.id === 'review') return void prFix(w, s.id)
    if (s.id === 'merge') return void prAct(w, 'merge')
    if (s.id === 'archive') return void archive(w)
    if (s.id === 'look') return at(), showPanel('changes')
    if (s.id === 'ship') return at(), setDialog('ship')
    if (s.id === 'wait' && w.pr) return openExternal(w.pr.url)
    at()
  }
  // the step as the first item of a workspace's ⋯ (the toolbar's, a row's and its right click), a line under it
  const stepItem = (w: WorkspaceView): MenuItem[] =>
    (st => (st ? [{ label: st.label, icon: STEP_ICON[st.id], hint: w.id === ws?.id ? kh('step') : undefined, tip: st.tip, run: () => doStep(w, st) } as MenuItem, null] : []))(stepsOn && !projOf(w)?.kind && !w.term ? (st => (st?.id === 'archive' && w.kind === 'worktree' ? undefined : st))(stepOf(w)) : undefined)
  // the tabs: in the top bar (the default), or a strip of their own under the terminals or beside them (Settings ›
  // Appearance; a phone keeps them on top)
  const tabsAt = (!narrow && (['bottom', 'left', 'right'] as const).find(x => x === settings.tabsAt)) || 'top' // an unknown value: top
  const ctxLook = settings.contextMeter === false ? undefined : settings.contextMeter === 'ring' || settings.contextMeter === 'status' ? settings.contextMeter : 'line' // Settings › Appearance: the context meter, and how its tab shows it
  const ctxOn = !!ctxLook
  const costsOn = settings.costs !== false // and what agents used
  const schedTip = nextTask ? `Scheduled tasks · next: ${nextTask.name ? stamp(nextTask.name, nextTask.next!) : nextTask.prompt.slice(0, 40)}, ${new Date(nextTask.next!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Scheduled tasks'
  const toSchedules = () => setDialog(d => (schedulesOf(d) === undefined ? 'schedules' : null))
  const toBoard = () => setDialog(d => (d === 'board' ? null : 'board'))
  const toSpecs = () => setDialog(d => (specsOf(d) ? null : { specs: '' }))
  const SPECS_TIP = 'Specs & Brainstorms: requirements to implement, ideas to explore with Laki AI'
  const toFlows = () => setDialog(d => (flowsOf(d) ? null : { workflows: '' }))
  const flowsAsk = (view?.flows ?? []).filter(r => r.status === 'waiting' && r.wait?.kind !== 'timer').length // W9: a wait for a time asks nothing
  const FLOWS_TIP = `Workflows: blocks Laki runs for a task${flowsAsk ? ` · ${flowsAsk} ask${flowsAsk > 1 ? '' : 's'} you` : ''}`
  const calOn = settings.calendar !== false // Settings › General › Pages
  const toCal = () => setDialog(d => (d === 'calendar' ? null : 'calendar'))
  const calSoon = (view?.reminders ?? []).filter(r => !r.done && r.fired).length // rung, not ticked off
  const deskOn = settings.desk !== false // Settings › General › Pages
  const notesOn = settings.notes !== false // Settings › General › Pages
  const todosOn = settings.todoList !== false // Settings › General › Pages
  const toTodos = () => setDialog(d => (d === 'todos' ? null : 'todos'))
  const toDesk = () => setDialog(d => (d === 'desk' ? null : 'desk'))
  const toNotes = () => setDialog(d => (notesOf(d) ? null : { note: '' }))
  const toAi = () => setDialog(d => (d === 'ai' ? null : 'ai'))
  const AI_TIP = 'AI: ask Laki to start, check and steer your agents'
  const toSettings = () => setDialog(d => (settingsOf(d) ? null : 'settings'))
  const BOARD_TIP = 'Board: every workspace by where it is, and to-dos'
  const achHidden = achKept.hidden ?? []
  const achAll = ACHIEVEMENTS.filter(a => !achHidden.includes(a.id))
  const achN = achAll.filter(a => achKept.got?.[a.id]).length
  // each kind's tabs that need you (the Dock's rule) and whether one works, for its rail button
  const kinds = rail ? new Map(live.map(w => [w.id, kindOf(w)])) : null
  const railSays = (k: RailKind) => {
    const mine = view.tabs.filter(t => kinds?.get(t.workspace) === k)
    return { n: mine.filter(needsYou).length, busy: mine.some(t => spins(t)) }
  }
  // a rail button's color (its right click's swatches: settings.railColors, by its key); 'none' drops it
  const railColors = settings.railColors ?? {}
  const railColor = (key: string, c: string) => {
    const { [key]: _, ...rest } = railColors
    void call('settingsSet', { railColors: c === 'none' ? rest : { ...rest, [key]: c } }).catch(fail)
  }
  const tinted = (key: string) => (railColors[key] ? { className: 'rail-icon tinted', style: colorVar(railColors[key]) } : { className: 'rail-icon' })
  // a rail button: its icon, words (Labels), and a count or a dot on the icon
  const railButton = (key: string, icon: IconName, label: string, on: boolean, tip: string, run: () => void, mark?: ReactNode, menu?: (e: React.MouseEvent) => void) => (
    <button key={key} type="button" data-rail={key} data-key={isKeyId(key) ? key : undefined} className={`rail-kind nodrag ${on ? 'on' : ''}`} aria-pressed={on} aria-label={tip} data-tip={tip} aria-haspopup={menu ? 'menu' : undefined} onClick={menu ?? run} onPointerEnter={() => key in PRELOAD && void PRELOAD[key as keyof typeof PRELOAD]().catch(() => {}) /* E8: its page's code, before the click */}>
      <span {...tinted(key)}>
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
    return railButton(k, icon, label, railKind === k && !onPage, says, () => railTo(k), n > 0 ? <span className="rail-count"><Num value={n > 99 ? '99+' : n} /></span> : busy && <span className="rail-dot" />)
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
      <button key={`pin:${w.id}`} type="button" className={`rail-kind rail-pin nodrag ${dropOn === w.id ? 'drop-on' : ''}`} {...dropProps(w)} aria-current={ws?.id === w.id && !onPage ? 'true' : undefined} aria-label={tip} data-tip={tip} onClick={e => (e.detail && e.currentTarget.blur(), setDialog(null), setWsId(w.id))} onContextMenu={e => (e.preventDefault(), wsTabMenu(e, wsMenu(w)))}>
        <span className="rail-icon" style={colorVar(tint(w))}>
          {w.icon ? isIconName(w.icon) ? <Icon name={w.icon} size={18} /> : <span className="rail-emoji">{w.icon}</span> : k === 'projects' ? <span className="rail-mark">{pinMarks[i]}</span> : <Icon name={k === 'shells' ? 'terminal' : 'globe'} size={18} />}
          {k === 'projects' && <ProjectMark p={projOf(w)} size={11} /> /* its project's, at the corner */}
          {n > 0 ? <span className="rail-count"><Num value={n} /></span> : mine.some(t => spins(t)) && <span className="rail-dot" />}
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
    const tip = `${words}: ${p.title || 'Untitled'} · ${view.projects.find(x => x.id === p.project)?.name ?? ''} · right click: unpin, color`
    const key = `plan:${p.project}/${p.kind}/${p.slug}`
    return (
      <button key={`plan:${p.project}/${p.kind}/${p.slug}`} type="button" className="rail-kind rail-pin nodrag" aria-label={tip} data-tip={tip} onClick={e => (e.detail && e.currentTarget.blur(), setDialog({ specs: p.project, kind: p.kind, slug: p.slug }))} onContextMenu={e => (e.preventDefault(), openMenu(e, [{ label: 'Open', icon: (p.kind === 'spec' ? 'spec' : 'bulb'), run: () => setDialog({ specs: p.project, kind: p.kind, slug: p.slug }) }, { label: 'Unpin from the rail', icon: 'pin', run: () => pinPlan(p, false) }, { colors: TAB_COLORS, value: railColors[key], pick: c => railColor(key, c) }]))}>
        <span {...tinted(key)}>
          <Icon name={(p.kind === 'spec' ? 'spec' : 'bulb')} size={18} />
        </span>
        {railWords && <span className="rail-label">{p.title || 'Untitled'}</span>}
      </button>
    )
  }
  // the floating chat (Settings › AI's Chat button): Laki AI over any page but its own and those with a chat on them
  const aiFab = aiOn(settings) && settings.ai?.float !== false && !narrow && dialog !== 'ai' && dialog !== 'help' && !specsOf(dialog) && !settingsOf(dialog) && !extOf(dialog) /* its own chat */
  // what it tells the model with each ask: the page open, the workspace and tab, as they are now, and the tab's screen
  const whereNow = async () => {
    const page = dialog === null ? 'the workspace below (no page over it)' : typeof dialog === 'string' ? `the ${dialog} page` : `the ${Object.keys(dialog)[0]} page`
    // the selected workspace's facts, as Info shows them: where it is, its branch and base, its changes, its PR (checks,
    // review, conflicts), what listens there, its other tabs
    const w = ws && [
      `workspace "${wsName(ws)}" (id ${ws.id}) in project ${project?.name ?? ws.project}`,
      `${ws.kind === 'worktree' ? 'a worktree' : 'the folder itself'} at ${ws.host ? `${ws.host}:` : ''}${ws.path}`,
      ws.branch && `branch ${ws.branch}${ws.base ? ` off ${ws.base}` : ''}`,
      ws.stat && `changes: ${ws.stat.files} file${ws.stat.files === 1 ? '' : 's'} +${ws.stat.add} −${ws.stat.del}${ws.stat.dirty ? `, ${ws.stat.dirty} uncommitted` : ''}`,
      ws.pr && `PR #${ws.pr.number} "${ws.pr.title}" ${prState(ws.pr)} ${ws.pr.url}, checks ${ciText(ws.pr)}${ws.pr.review && REVIEW[ws.pr.review] ? `, ${REVIEW[ws.pr.review]}` : ''}${ws.pr.conflict ? ', merge conflicts' : ''}`,
      ws.ports.length && `listening on ${ws.ports.map(n => `localhost:${n}`).join(', ')}`,
      ws.storage && `its storage folder ${ws.storage}`,
      (ts => ts.length > 1 && `its tabs: ${ts.map(x => `"${x.name}" (${x.kind === 'agent' ? (x.preset ?? 'agent') : x.kind}, ${STATE_WORDS[x.status] ?? x.status})`).join(', ')}`)(tabs.filter(x => x.workspace === ws.id && x.status !== 'exited')),
    ].filter(Boolean).join(', ')
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
  const whenHere = ws && { projectName: view.projects.find(p => p.id === ws.project)?.name, agents: view.tabs.filter(t => t.workspace === ws.id && t.kind === 'agent').map(t => t.status) } // P2: what a when reads of the selected workspace
  const ownWidgets = shownWidgets.filter(w => (!w.project || w.project === ws?.project) && !(w.on && w.hidden) && whenOk(w.when, ws ?? undefined, whenHere || {}))
  widgetsNow.current = ownWidgets // Edit layout orders the ones that show here (P3): an arrow never swaps with one that isn't // a repo's (.laki/extensions): only while a workspace of its project is selected; hidden: its data says so; when: only while the selected workspace matches
  // the tab bar's ⋯: One next step first; on a phone, the top bar's extensions too (no room for their strip), each as
  // its button's click
  const wsMore = (extra: MenuItem[] = []): MenuItem[] => [...(ws ? stepItem(ws) : []), ...extra, ...(narrow && ws?.kind === 'worktree' && !(stepsOn && stepOf(ws)?.id === 'ship') ? [{ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') } as MenuItem] : []), ...(tops => (narrow && tops.length ? [...wsActions, { head: 'Extensions' }, ...tops.map(w => ({ label: w.name, sub: w.label ?? w.badge, run: () => extClick(w, widgetApi) }))] : wsActions))(ownWidgets.filter(w => w.on && placesOf(w).includes('top')))]
  const onPage = schedulesFor !== undefined || dialog === 'board' || dialog === 'achievements' || (dialog === 'calendar' && calOn) || (dialog === 'desk' && deskOn) || (notesOn && !!notesOf(dialog)) || (todosOn && dialog === 'todos') || (dialog === 'bird' && settings.birdView !== false) || dialog === 'ai' || !!specsOf(dialog) || !!flowsOf(dialog) || settingsOf(dialog) // the rail's lit button: the page over the main area, else the list's kind
  const listOff = rail && sideOpen && (schedulesFor !== undefined || dialog === 'board' || (calOn && dialog === 'calendar') || (deskOn && dialog === 'desk') || (notesOn && !!notesOf(dialog)) || (todosOn && dialog === 'todos') || dialog === 'ai' || (specsOn && !!specsOf(dialog)) || (flowsOn && !!flowsOf(dialog))) // the rail's Schedule and Board: a page over all but the rail
  // the list as a strip: a name each, written down it (no filter, a page over it or a phone: the list)
  const strip = rail && sideOpen && !listOff && !find && railKind !== 'projects' ? strips[railKind] : undefined
  const stripMenu = (at: 'left' | 'right'): MenuItem[] => [
    { label: 'Show the list', icon: 'sidebar', run: () => setStrip(railKind) },
    { label: at === 'left' ? 'Move it to the right' : 'Move it to the left', icon: at === 'left' ? 'chevronsRight' : 'chevronsLeft', run: () => setStrip(railKind, at === 'left' ? 'right' : 'left') },
  ]
  const stripNeeds = strip && new Set(needing.map(t => t.workspace)) // the Dock's list: its rows' dots
  const stripBar = strip && (
    <nav className={`side-strip ${strip}`} aria-label={railKind === 'shells' ? 'Terminals' : 'Browsers'} onContextMenu={e => (e.preventDefault(), openMenu(e, stripMenu(strip)))}>
      <span className="strip-drag drag" />
      <IconButton icon={strip === 'left' ? 'chevronsRight' : 'chevronsLeft'} title="Show the list · right click: move the strip to the other side" onClick={() => setStrip(railKind)} />
      {order
        .filter(w => kindOf(w) === railKind)
        .map(w => (
          <button key={w.id} type="button" className={`strip-ws ${w.id === ws?.id && !onPage ? 'sel' : ''}`} style={colorVar(tint(w))} data-tip={wsName(w)} onClick={() => (setDialog(null), setWsId(w.id))} onContextMenu={e => (e.preventDefault(), e.stopPropagation(), wsTabMenu(e, wsMenu(w)))}>
            <span className="fr-vert">{wsName(w)}</span>
            {stripNeeds && stripNeeds.has(w.id) && <i role="img" aria-label="needs you" />}
          </button>
        ))}
      <IconButton icon="plus" title={railKind === 'shells' ? 'New terminal' : 'New browser'} onClick={() => railKind !== 'projects' && quickNew(railKind)} />
    </nav>
  )
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
    ...(flowsOn ? [{ key: 'workflows', icon: 'flow' as const, label: 'Workflows', on: !!flowsOf(dialog), tip: FLOWS_TIP, run: toFlows, n: flowsAsk }] : []),
    ...(deskOn ? [{ key: 'desk', icon: 'desk' as const, label: 'My Desk', on: dialog === 'desk', tip: 'My Desk: your extensions as tiles', run: toDesk }] : []),
    ...(notesOn ? [{ key: 'notes', icon: 'note' as const, label: 'Notes', on: !!notesOf(dialog), tip: 'Notes: yours, for any project', run: toNotes }] : []),
    ...(todosOn ? [{ key: 'todos', icon: 'listChecks' as const, label: 'To-dos', on: dialog === 'todos', tip: 'To-dos: your checklist', run: toTodos }] : []),
    ...(calOn ? [{ key: 'calendar', icon: 'calendar' as const, label: 'Calendar', on: dialog === 'calendar', tip: `Calendar: scheduled tasks and reminders${calSoon ? ` · ${calSoon} rang` : ''}`, run: toCal, n: calSoon }] : []),
    ...RAIL.slice(1).filter(([k]) => railOf(k) === k).map(kind => ({ key: kind[0], kind })),
  ]
  // the user's order and the ones they put into More (Settings › Appearance › Rail), then the ones that don't fit
  const railHide = settings.railHide ?? []
  // D7: a phone at answer only: the pages whose work it may do (the Board's and the Calendar's reminders, Laki AI)
  const railOk = (x: { key: string }) => view.remote?.level !== 'answer' || ['board', 'calendar', 'ai'].includes(x.key)
  const railShown = railSorted(railPages.filter(railOk), settings.railOrder).filter(x => !railHide.includes(x.key))
  const over = (o => (o.length > 1 ? o : []))(railWords && railShown.length + 1 > RAIL_FIT ? RAIL_MORE.filter(k => railShown.some(x => x.key === k)).slice(0, railShown.length + 1 - (RAIL_FIT - 1)) : []) // one alone: More would save no room
  const railKept = railShown.filter(x => !over.includes(x.key))
  type RailRun = Extract<RailPage, { run: () => void }>
  const kindPage = ([k, label, icon]: (typeof RAIL)[number]): RailRun => (({ n, busy }) => ({ key: k, icon, label, on: railKind === k && !onPage, tip: `${label}${busy ? ' · at work' : ''}`, run: () => railTo(k), n }))(railSays(k))
  const aiPage: RailRun = { key: 'ai', icon: 'ai', label: 'AI', on: dialog === 'ai', tip: AI_TIP, run: toAi }
  const railMore = [...railSorted(railPages.filter(railOk), settings.railOrder).filter(x => railHide.includes(x.key) || over.includes(x.key)), ...(aiOn(settings) && railHide.includes('ai') ? [aiPage] : [])].map(x => ('kind' in x ? kindPage(x.kind) : x))
  // a phone's bottom bar (Phone.tsx): Projects (the drawer; a page over it gives way), the rail's pages in its order
  // (the ones put into More last), AI, Settings; its first four, the rest in More
  const phoneItems: BarItem[] = !narrow
    ? []
    : [
        { key: 'projects', icon: RAIL[0][2], label: RAIL[0][1], on: !dialog, n: needing.length, run: () => (dialog ? (setDialog(null), setSideOpen(true)) : setSideOpen(o => !o)) },
        ...[...railShown, ...railSorted(railPages.filter(railOk), settings.railOrder).filter(x => railHide.includes(x.key))].flatMap(x => ('kind' in x ? [] : [x])),
        ...(aiOn(settings) ? [aiPage] : []),
        { key: 'settings', icon: 'gear', label: 'Settings', on: settingsOf(dialog), run: toSettings },
      ]
  // a right click on the rail: put that button into More (or back), or the whole list in Settings
  const railMenu = (e: React.MouseEvent) => {
    const key = (e.target as Element).closest<HTMLElement>('[data-rail]')?.dataset.rail
    const item = RAIL_ITEMS.find(x => x.key === key)
    e.preventDefault()
    openMenu(e, [
      ...(key ? [{ head: 'Color' }, { colors: TAB_COLORS, value: railColors[key], pick: (c: string) => railColor(key, c) }, null] : []),
      ...(item ? [{ label: `Move ${item.label} into ⋯ More`, icon: 'more' as const, run: () => void call('settingsSet', { railHide: [...railHide, item.key] }).catch(() => {}) }] : []),
      { label: 'Customize the rail…', icon: 'gear', sub: 'which buttons show, their order', run: () => setDialog({ section: 'layout', spot: 'Rail' }) },
    ])
  }
  // the rail stays while Projects' sidebar is open: a kind whose list is hidden (Terminals, Browsers) keeps it
  const railUp = rail && (sideOpen || (sideOpens.projects ?? true))
  const wsTint = settings.wsTint && ws?.color && ws.color !== 'none' ? ws.color : undefined // the open workspace's color in the glass (none on a page: .main[data-pages])
  const railBar = railUp && (
    <nav className="rail drag" aria-label="Projects, the board, scheduled tasks, terminals, browsers and settings" data-bare={railWords ? undefined : ''} style={{ width: railW }} onContextMenu={e => !e.defaultPrevented && railMenu(e)}>
      {histNav}
      {kindButton(RAIL[0])}
      {railKept.map(x => ('kind' in x ? kindButton(x.kind) : railButton(x.key, x.icon, x.label, x.on, x.tip, x.run, x.n ? <span className="rail-count"><Num value={x.n} /></span> : x.mark)))}
      {railMore.length > 0 &&
        railButton('more', 'more', 'More', railMore.some(x => x.on), `More: ${railMore.map(x => x.label).join(', ')}`, () => {}, (n => (n ? <span className="rail-count"><Num value={n} /></span> : undefined))(railMore.reduce((a, x) => a + (x.n ?? 0), 0)), e =>
          openMenu(e, [
            ...railMore.map(x => ({ label: x.label, icon: x.icon, sub: x.tip, run: x.run, ...(x.on && { hint: 'ON' }), ...(x.n ? { pill: String(x.n), tone: 'warn' as const } : {}) })),
            ...(railHide.length ? [{ label: 'Show them all on the rail', icon: 'eye' as const, foot: true, run: () => void call('settingsSet', { railHide: [] }).catch(() => {}) }] : []),
            { label: 'Customize the rail…', icon: 'gear', foot: true, run: () => setDialog({ section: 'layout', spot: 'Rail' }) },
          ]),
        )}
      {(railPins.length > 0 || planPins.length > 0) && <span className="rail-sep" />}
      {railPins.map(pinButton)}
      {planPins.map(planButton)}
      <WidgetButtons widgets={ownWidgets} api={widgetApi} places={['rail']} look="rail" words={railWords} colors={railColors} />
      <span className="spacer" />
      {settings.devMode === true && railButton('picker', 'target', 'Pick', picking, `Pick an element: what it is, to copy into a prompt (development mode)${pickKey ? ` · ${pickKey}` : ''}`, () => setPicking(p => !p))}
      {aiOn(settings) && !railHide.includes('ai') && railButton('ai', 'ai', 'AI', dialog === 'ai', AI_TIP, toAi)}
      {railButton('settings', 'gear', 'Settings', settingsOf(dialog), `${kt('Settings', 'settings')}${view?.agentUpdates?.length ? ` · an update is out: ${view.agentUpdates.join(', ')} (Agents & profiles)` : ''}`, toSettings, settings.updateDot === true && view?.agentUpdates?.length ? <span className="rail-dot" /> : undefined)}
    </nav>
  )
  // the status bar, full width (Zed's way): one bar under the sidebar and the main area, over every page too, the
  // sidebar's foot buttons first (with their words) and AI and Settings at its end; a phone's under the main area.
  // Off (Settings › Appearance › Status bar): none, its foot buttons at the sidebar's foot; a lost connection still
  // says so, as a phone's bar
  const noBar = settings.statusBar === false
  const wideBar = !narrow && !noBar
  const pageHere = dialog !== null && isPlace(dialog) && view ? placeName({ d: dialog, ws: ws?.id ?? null }) : ''
  const pageBar = wideBar && !!pageHere // a page over the workspace: the bar says only what isn't the workspace's
  // the sidebar's foot buttons (Schedule, Board… without the rail; Video, Meme, Timer, its extensions, Settings), there
  // or first in the wide status bar (bar: without AI and Settings, which go at its end); words: their labels
  const footButtons = (words: boolean, bar = false) => (
    <>
          {!rail && !narrow && ( // the rail layout has them on its rail, a phone on its bottom bar
            <>
              <IconButton icon="clock" title={schedTip} on={schedulesFor !== undefined} className={runFailed ? 'dot' : ''} label={words ? 'Schedule' : undefined} onClick={toSchedules} />
              <IconButton icon="board" title={BOARD_TIP} label={words ? 'Board' : undefined} on={dialog === 'board'} onClick={toBoard} />
              {specsOn && <IconButton icon="spec" title={SPECS_TIP} label={words ? 'Specs' : undefined} on={!!specsOf(dialog)} onClick={toSpecs} />}
              {flowsOn && <IconButton icon="flow" title={FLOWS_TIP} label={words ? 'Workflows' : undefined} on={!!flowsOf(dialog)} className={flowsAsk ? 'dot' : ''} onClick={toFlows} />}
              {aiOn(settings) && !bar && <IconButton icon="ai" title={AI_TIP} label={words ? 'AI' : undefined} on={dialog === 'ai'} onClick={toAi} />}
            </>
          )}
          {/* Video, Meme and Timer under ⋯ (each still off in Settings › Appearance); one in use shows as its own button */}
          {!!video && <IconButton icon="youtube" title="The video you're watching" label={words ? 'Video' : undefined} on onClick={() => setDialog('video')} />}
          {timers.length + watches.length > 0 && <IconButton icon="timer" title="Timers: another one, or a stopwatch" label={words ? 'Timer' : undefined} on onClick={e => openMenu(e, startMenu())} />}
          {(extras => extras.length > 0 && <IconButton icon="more" className="foot-more" title={`More: ${extras.map(i => (i && 'label' in i ? i.label : '')).filter(Boolean).join(', ')}`} on={dialog === 'fun'} onClick={e => openMenu(e, extras)} />)([
            ...(settings.videoButton !== false && !video ? [{ label: 'Video', icon: 'youtube', tip: 'Watch a YouTube video while you work (off: Settings › Appearance)', run: () => setDialog('video') } as MenuItem] : []),
            ...(settings.fun !== false ? [{ label: 'Meme', icon: 'smile', tip: 'A random meme from Reddit, for a break (off: Settings › Appearance)', run: () => setDialog(d => (d === 'fun' ? null : 'fun')) } as MenuItem] : []),
            ...(settings.timerButton !== false && timers.length + watches.length === 0 ? [{ label: 'Timer', icon: 'timer', tip: 'A countdown, then a sound and a dialog or a notification (and the video paused, played or closed, if you like); or a stopwatch (off: Settings › Appearance)', items: startMenu() } as MenuItem] : []),
            // place more: an extension's item, its click as its button's (an action, its full view, a fetch)
            ...ownWidgets.filter(w => w.on && placesOf(w).includes('more')).sort(extOrder).map((w): MenuItem => ({ label: w.label ?? w.name, mark: <ExtGlyph w={w} />, hint: w.badge, tip: w.here === null ? 'Per workspace: select one' : w.tip, off: w.here === null, run: () => extClick(w, widgetApi) })),
          ])}
          <WidgetButtons widgets={ownWidgets} api={widgetApi} places={rail ? ['foot'] : ['foot', 'rail'] /* no rail: its widgets here */} look="foot" words={words} />
          {!rail && !bar && !narrow && (
            <>
              <span className="spacer" />
              <IconButton icon="gear" title={kt('Settings', 'settings')} keyId="settings" label={words ? 'Settings' : undefined} on={settingsOf(dialog)} onClick={toSettings} />
            </>
          )}
    </>
  )
  return { AI_TIP, achAll, achHidden, achN, aiFab, aiNames, calOn, costsOn, ctxLook, ctxOn, deskOn, doStep, footButtons, histNav, label, labels, listOff, mark, noBar, notesOn, ownWidgets, pageBar, phoneItems, pinPlan, portStop, portUp, ports, radarKey, radarOf, railBar, railColor, railUp, samePlan, schedulesFor, shownWidgets, stepItem, stepOf, stepsOn, strip, stripBar, tabsAt, toAi, toSettings, todosOn, whereNow, wideBar, wsMore, wsTint } as const // the literal types App had (tabsAt, ctxLook)
}
