// The sidebar: its head, the picked rows' bar, Needs you, Pinned, each project's workspaces (its groups, the ones being
// made), the timers and the foot (Sidebar), and what its rows are made of (sideOf: a workspace's row, a group's head,
// the peek card App shows over everything). App renders them with what appCtx.ts says they read.
import { PwaBar } from './pwa'
import type { menusOf } from './menus'
import type { WorkspaceView, GateHeld, Stat, Project, Sep, TabView, PR, View } from '../../shared/types'
import { Num, ask, type IconName, type MenuItem, TAB_COLORS, colorVar, Icon, TurnTime, IconButton, Elapsed, ProjectMark, act, ScrollEdge } from './ui'
import { type AppBase, type AppCtx, clip, MINUTES, ONLY, prNum, span, STATE_WORDS, type Timer, TIMER_THEN, wsName } from './appCtx'
import { clock, forgeName, rowFact, prName, prPill, pendingWords, csWord, shortPath, spins, needsSorted, pickProject } from './text'
import { type NeedsApi, NeedsList } from './Needs'
import { api, openExternal } from './api'
import { rollup, Glyph } from './Glyph'
import { type Collision, spanText } from '../../shared/overlap'
import { type CSSProperties, type KeyboardEvent as ReactKey, useLayoutEffect, useRef } from 'react'
import { short, prState, Avatar, PrCard } from './Info'
import { RowMarks, rowMarks, WidgetGrid } from './Widgets'
import { planCount } from '../../shared/todos'
import { phVars, sideVars, sideAttrs } from './SettingsLook'
import { Video, TimerBar, StopwatchBar, stepsOf, OnboardBar } from './panels'
import type { StepId } from '../../shared/nextStep'
import { bulkGroups } from '../../shared/ask'
import { fresh } from './motion'
import { BLOCK, type Clash, portClashes } from '../../shared/isolation'

const STEP_CHIP: Partial<Record<StepId, string>> = { answer: 'Answer', plan: 'Plan', check: 'Check', review: 'Changes', look: 'Review', merge: 'Merge' } // a row's: short

// the rows and what they need: a workspace's row, a group's, the ones being made, the peek card; several picked at
// once (⌘-click, ⇧-click), the timers' menus, the + menus
// a project's mark when it has no icon of its own: its kind's, a host's, a plain folder's, a repo's
const markOf = (p: Project): IconName => (p.kind === 'shells' ? 'terminal' : p.kind === 'browsers' ? 'globe' : p.host ? 'server' : p.git === false ? 'folder' : 'fork')

export function sideOf(app: AppBase & ReturnType<typeof menusOf>) {
  const { anchor, busyWith, call, done, doStep, dropAgent, dropOn, dropProps, find, flowsOn, fold, folded, going, kh, kindOf, live, making, mark, markUnread, narrow, needAfter, needsYou, newWs, openMenu, wsTabMenu, openProject, order, peek, peekBox, peekStat, peekTimer, picked, pinned, projOf, quickNew, radarOf, rail, railKind, railOf, rawKind, restart, restore, ring, rows, selectTab, setDialog, setOverlapsAt, setPeek, setPicked, setSideOpen, setTimer, settings, setWsId, showPanel, sortedRows, sortItems, stepOf, stepsOn, termIn, termsOk, termWhere, timers, tint, toast, view, waits, widgetApi, ws, wsAt, wsMenu } = app
  const peekAt = (id?: string, el?: HTMLElement) => {
    clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => {
      if (!id || !el?.isConnected) return setPeek(null)
      const r = el.getBoundingClientRect()
      setPeek({ id, top: r.top, left: (el.closest('.sidebar') ?? el).getBoundingClientRect().right + 6 })
    }, !id ? 250 : peek ? 120 : 550)
  }
  const pause = (id: string) => setTimer(id, x => (x.left === undefined ? { ...x, left: Math.max(1000, x.end - Date.now()) } : { ...x, end: Date.now() + x.left, left: undefined })) // or go on
  // several picked in the sidebar (⌘-click, ⇧-click): archive, mute, move to a group, delete, drag, all at once
  const pickable = (w: WorkspaceView) => rawKind(w) === 'projects' && !w.term && !w.archived
  const pickedWs = () => order.filter(w => picked.includes(w.id) && pickable(w))
  const pickRow = (w: WorkspaceView, e: { metaKey: boolean; shiftKey: boolean }) => {
    const base = picked.length ? picked : ws && ws.id !== w.id && pickable(ws) ? [ws.id] : [] // the open one starts it
    if (e.shiftKey && (anchor.current ?? ws?.id)) {
      const ids = order.filter(pickable).map(x => x.id)
      const [a, b] = [ids.indexOf(anchor.current ?? ws!.id), ids.indexOf(w.id)].sort((x, y) => x - y)
      if (a >= 0) return setPicked([...new Set([...base, ...ids.slice(a, b + 1)])])
    }
    anchor.current = w.id
    setPicked(base.includes(w.id) ? base.filter(x => x !== w.id) : [...base, w.id])
  }
  const pickedArchive = async () => {
    const ws_ = pickedWs()
    if (!(await ask(`Archive ${ws_.length === 1 ? wsName(ws_[0]) : `${ws_.length} workspaces`}?`, { text: `${ws_.map(wsName).join(', ')}: their tabs stop, worktrees are removed (the branches stay). Ones with uncommitted changes are asked about again.`, ok: 'Archive' }))) return
    setPicked([])
    const res = await busyWith(ws_.map(w => w.id), 'archiving', () => Promise.all(ws_.map(w => call<{ dirty?: number; held?: GateHeld[] } | null>('wsArchive', { id: w.id, ifClean: true }).then(r => ({ w, r }), () => ({ w, r: undefined })))))
    const dirty = res.filter(x => x.r?.dirty).map(x => x.w)
    const held = res.filter(x => x.r?.held).map(x => x.w)
    let gone = res.filter(x => x.r && !x.r.dirty && !x.r.held).map(x => x.w)
    if (dirty.length && (await ask(`Archive ${dirty.length === 1 ? wsName(dirty[0]) : `${dirty.length} more`} with uncommitted changes?`, { text: `${dirty.map(wsName).join(', ')}: their changes go with the worktrees (the branches stay).`, ok: 'Archive', danger: true }))) {
      const more = await busyWith(dirty.map(w => w.id), 'archiving', () => Promise.all(dirty.map(w => call<{ held?: GateHeld[] } | null>('wsArchive', { id: w.id, ifClean: false }).then(r => (r?.held ? (held.push(w), null) : w), () => null))))
      gone = [...gone, ...more.filter((w): w is WorkspaceView => !!w)]
    }
    if (gone.length) done(`Archived ${gone.length === 1 ? wsName(gone[0]) : `${gone.length} workspaces`}${held.length ? `; ${held.map(wsName).join(', ')} held by an extension (archive it alone to see why)` : ''}`, () => gone.forEach(w => restore(w.id)))
    else if (held.length) toast(`${held.map(wsName).join(', ')} held by an extension: archive it alone to see why`)
  }
  const pickedRm = async () => {
    const ws_ = pickedWs()
    if (!(await ask(`Delete ${ws_.length} workspaces?`, { text: `${ws_.map(wsName).join(', ')}: their tabs stop, worktrees are removed (the branches stay). Uncommitted changes go with them.`, ok: 'Delete', danger: true }))) return
    setPicked([])
    const ok = await busyWith(ws_.map(w => w.id), 'deleting', () => Promise.all(ws_.map(w => call('wsRm', { id: w.id }).then(() => true, () => false))))
    done(`Deleted ${ok.filter(Boolean).length} workspaces: their branches stay`)
  }
  const pickedMute = () => {
    const ws_ = pickedWs()
    const muted = !ws_.every(w => w.muted)
    Promise.all(ws_.map(w => call('wsSet', { id: w.id, muted }))).then(() => done(`${muted ? 'Muted' : 'Unmuted'} ${ws_.length} workspaces`), () => {})
  }
  // 5 files: 1 new, 1 deleted, 3 changed
  const filesText = (st: Stat) => (changed => `${st.files} ${st.files === 1 ? 'file' : 'files'}${st.made || st.gone ? `: ${[st.made && `${st.made} new`, st.gone && `${st.gone} deleted`, changed > 0 && `${changed} changed`].filter(Boolean).join(', ')}` : ''}`)(st.files - (st.made ?? 0) - (st.gone ?? 0))
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
    { label: 'Important: a card on screen', icon: 'alertCircle', key: 'i', hint: t.important ? '✓' : undefined, tip: 'As it ends, a card at the bottom right over every app, until you close it', run: () => setTimer(t.id, x => ({ ...x, important: !x.important || undefined })) },
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
  const addMenu = (): MenuItem[] => [
    { label: 'Project folder…', icon: 'folderPlus', hint: '⌘O', key: 'p', run: openProject },
    { label: 'Terminal', icon: 'terminal', key: 't', hint: 'in your home folder', run: () => quickNew('shells') },
    { label: 'Browser', icon: 'globe', key: 'b', hint: 'any website', run: () => quickNew('browsers') },
  ]
  const plusMenu = (p: Project, place?: string): MenuItem[] => [
    { label: 'New workspace', icon: 'plus', key: 'n', hint: place ? undefined : kh('newWs'), run: () => newWs(p.id, place ? { place } : undefined) },
    { label: 'Terminal', icon: 'terminal', key: 't', hint: termWhere(p), run: () => termIn(p, place) },
  ]
  // ⌘J: the next tab that needs you (waiting first, then done unseen; the Dock's count), around
  // the Needs you list's cards: answered as main's notification actions do (answer refuses a menu that changed)
  const needsApi: NeedsApi = {
    keep: t => void call('send', { target: t.id, text: 'continue' }).catch(() => {}),
    dismiss: t => void call('failDismiss', { tab: t.id }).catch(() => {}),
    open: t => (setDialog(null), selectTab(t), narrow && setSideOpen(false)),
    answer: (t, n, label) => void api.call('answer', { tab: t.id, n, label }).catch(() => toast('It asks something else now: open it', () => needsApi.open(t), 'Open')),
    pick: (t, pick) => void api.call('answer', { tab: t.id, pick }).catch(e => toast((e as Error).message, () => needsApi.open(t), 'Open', false, true)),
    permission: t => /permission/i.test(waits.current.get(t.id) ?? ''),
    review: t => (setDialog(null), setWsId(t.workspace), showPanel('changes'), narrow && setSideOpen(false)),
    seen: t => void call('seen', { tab: t.id }).catch(() => {}),
    seenAll: ts => (ts.forEach(t => needsApi.seen(t)), done(`Marked ${ts.length} as seen`, () => ts.forEach(t => markUnread(t.id)))),
    name: wsName,
    keys: (t, data) => void api.call('input', { tab: t.id, data }).catch(() => {}),
    // U8: each answered as its card would be (its first option or Allow; its last or Deny), one after another; the
    // daemon refuses a menu that changed since, named in the toast
    bulk: async (ts, allow) => {
      const nameOf = (t: TabView) => (w => (w ? wsName(w) : t.workspace))(view.workspaces.find(w => w.id === t.workspace))
      if (allow && !(await ask(`Allow ${ts.length} permission asks?`, { text: 'Each agent goes on with what it asked for:', facts: bulkGroups(ts, nameOf).map(g => ({ label: g.names.join(', '), value: `${g.tool}: ${g.what}` })), ok: `Allow all (${ts.length})` }))) return
      const failed: string[] = []
      // the asks as they are now, after the confirm: one that changed meanwhile (a new command behind the same Yes) is skipped
      const now = await api.call<View>('state').then(v => new Map(v.tabs.map(x => [x.id, x])), () => new Map<string, TabView>())
      for (const t of ts) {
        const cur = now.get(t.id)
        if (!cur || cur.status !== 'waiting' || cur.ask?.tool !== t.ask?.tool || cur.ask?.what !== t.ask?.what) {
          failed.push(`${nameOf(t)} · ${t.name}`)
          continue
        }
        const o = t.ask?.options.length ? (allow ? t.ask.options[0] : t.ask.options.at(-1)) : undefined
        await api.call('answer', o ? { tab: t.id, n: o.n, label: o.label } : { tab: t.id, pick: allow ? 'first' : 'last' }).catch(() => failed.push(`${nameOf(t)} · ${t.name}`))
      }
      const word = allow ? 'Allowed' : 'Denied'
      if (failed.length) toast(`${word} ${ts.length - failed.length}; not answered (it asks something else now): ${failed.join(', ')}`)
      else done(`${word} ${ts.length}`)
    },
    allowKey: kh('allowAll'),
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
  const needNext = needAfter()
  const needsShown = !find && (!rail || railKind === 'projects') && settings.needsList !== false && !folded.includes('needs')
  const needWs = needsShown ? undefined : needNext?.workspace
  const radarWhose = (c: Collision) => (c.ws ? wsName(view.workspaces.find(x => x.id === c.ws) ?? { id: c.ws }) : c.base!)
  // F7: a dev server on a port of another workspace's block: a chip on both, saying who has the port
  const clashes = portClashes(view.workspaces)
  const clashTip = (cs: Clash[]) =>
    cs.map(c => (o => (c.theirs ? `Port ${c.port} is ${o ? wsName(o) : c.other}'s (its ports: ${o?.port} to ${(o?.port ?? 0) + BLOCK - 1}): a server here listens on it` : `${o ? wsName(o) : c.other} listens on port ${c.port}, one of this workspace's`))(view.workspaces.find(x => x.id === c.other))).join('\n') + '\nEach workspace has its own ten: $PORT and $PORT_1…$PORT_9'
  const radarTip = (w: WorkspaceView) => radarOf(w).map(c => `${c.file}: ${c.ws ? `${radarWhose(c)} changes it too` : `${c.base} changed it since this branched`} (${spanText(c.theirs)}; here ${spanText(c.mine)})`).join('\n')
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
    const simple = settings.simpleRow === true // B4: a name and one next-step chip (or the turn's time); the other marks on hover and in the peek card
    return (
      <div
        key={w.id}
        className={`ws ${w.id === ws?.id ? 'sel' : ''} ${picked.includes(w.id) ? 'ws-picked' : ''} ${going[w.id] ? 'going' : ''} ${wt.some(needsYou) ? 'needs' : ''} ${dropOn === w.id ? 'drop-on' : ''} ${simple ? 'ws-simple' : ''} ${fresh(w.id) ? 'v-new' : ''} ${rows.at('ws', w.id)}`}
        style={{ ...colorVar(w.color), ...(pc && ({ '--proj-c': `var(--tc-${pc})` } as CSSProperties)), ...(pct >= 0 && ({ '--p': `${pct}%` } as CSSProperties)) }}
        data-state={status ? (w.setup || going[w.id] ? 'running' : rollup(wt)) : undefined}
        data-row={`ws:${w.id}`}
        role="treeitem"
        aria-level={2}
        aria-selected={w.id === ws?.id}
        aria-label={wsName(w)}
        tabIndex={-1}
        data-keys={moves || undefined}
        data-group={pin ? 'pinned' : w.project}
        onPointerDown={e => (clearTimeout(peekTimer.current), setPeek(null), !pin && !find && rows.start(e, 'ws', w.id, w.project)) /* filtered: the order isn't all there */}
        onPointerEnter={e => e.pointerType === 'mouse' && !e.buttons && !narrow && !view.projects.find(p => p.id === w.project)?.kind && peekAt(w.id, e.currentTarget) /* Terminals and Browsers: no port, PR or agent to tell of */}
        onPointerLeave={() => peekAt()}
        onClick={e => ((e.metaKey || e.shiftKey) && !narrow && pickable(w) ? pickRow(w, e) : (setWsId(w.id), (!pin && !find && rows.dragged()) || (setPicked([]), setDialog(null)), narrow && setSideOpen(false))) /* ⌘ and ⇧: picked; a page over the main area (Settings, the new-workspace page…) gives way to it, and the picks go, not at a drag's end */}
        onDoubleClick={e => !(e.metaKey || e.shiftKey) && setDialog({ renameWs: w.id })}
        onContextMenu={e => wsTabMenu(e, wsMenu(w))}
        {...dropProps(w)}
      >
        {w.browser !== undefined ? <Icon name="globe" size={11} /> /* a page: no tabs */ : <Glyph s={w.setup || going[w.id] ? 'running' : w.pending && !wt.length ? 'idle' /* its agent comes later: not ended */ : rollup(wt)} />}
        {marksAt === 'start' && yes}
        <span className="ws-name">{wsName(w)}</span>
        {marksAt === 'name' && yes}
        {going[w.id] && <span className="ws-going">{going[w.id]}…</span>}
        {pin && <span className="ws-proj">{view.projects.find(p => p.id === w.project)?.name}</span>}
        {queued > 0 && <span className="badge">+{queued}</span>}
        {dropOn === w.id && <span className="ws-drop">{(a => (a ? `to ${a.name}` : w.pending ? 'its agent starts later' : 'to a new agent'))(dropAgent(w))}</span>}
        <span className="spacer" />
        {(simple || (stepsOn && mark('step'))) && !projOf(w)?.kind && !w.term && (st => st && !st.busy && (simple || !['conflict', 'ci'].includes(st.id)) /* its ⚠ and red mark say those (B4: a simple row has no marks) */ && <span className={`ws-step t-${st.tone ?? 'none'}`} data-tip={`${st.label}: ${st.tip}`} onPointerDown={e => e.stopPropagation()} {...act(e => (e.stopPropagation(), doStep(w, st, e)))}>{STEP_CHIP[st.id] ?? st.label}</span>)(stepOf(w))}
        {pctSide && !more && !words && settings.progressLook !== 'bar' && (top => top >= 0 && <span className="tab-pct" style={{ '--p': `${top}%` } as CSSProperties} data-tip={wt.filter(t => t.progress).map(t => `${t.name}: ${t.progress!.pct}%${t.progress!.note ? `, ${t.progress!.note}` : ''}`).join(' · ')}>{top}%</span>)(Math.max(-1, ...wt.map(t => t.progress?.pct ?? -1)))}
        {(settings.timers || simple) && (simple ? <span className="ws-keep"><TurnTime tabs={wt} /></span> : <TurnTime tabs={wt} />)}
        {w.stat && (w.stat.add > 0 || w.stat.del > 0) && settings.diffStat === true && (
          <span className="ws-stat">
            <span className="add">+<Num value={short(w.stat.add)} /></span>
            <span className="del">−<Num value={short(w.stat.del)} /></span>
          </span>
        )}
        {w.ticket && mark('ticket') && (
          <span className="ws-ticket" data-tip={[w.ticket.key, w.ticket.title, w.ticket.status && `(${w.ticket.status})`].filter(Boolean).join(' ') + (w.ticket.url ? '\nClick: open it' : '')} onPointerDown={e => e.stopPropagation()} {...act(e => (e.stopPropagation(), w.ticket?.url && openExternal(w.ticket.url)))}>
            {w.ticket.key}
          </span>
        )}
        <RowMarks widgets={(view.widgets ?? []).filter(x => !x.project || x.project === w.project)} ws={w.id} api={widgetApi} />
        {mark('plan') && (t => t?.plan && !t.plan.stale && <span className="ws-plan" data-tip={`${t.name}'s plan: ${t.plan.items.map(i => `${i.state === 'done' ? '✓' : i.state === 'now' ? '›' : '○'} ${i.text}`).join('\n')}`}><Num value={planCount(t.plan)} /></span>)(wt.find(t => t.plan))}
        {(cs => cs && (
          <span className="ws-clash" data-tip={clashTip(cs)}>
            <Icon name="triangle" size={11} />:{cs[0].port}
          </span>
        ))(clashes.get(w.id))}
        {mark('radar') && (n => n > 0 && (
          <span className="ws-radar" data-tip={radarTip(w)} onPointerDown={e => e.stopPropagation()} {...act(e => (e.stopPropagation(), setOverlapsAt({ w: w.id, list: radarOf(w) })))}>
            <Icon name="gitCompare" size={11} />
            {n}
          </span>
        ))(new Set(radarOf(w).map(c => c.ws ?? `base:${c.base}`)).size)}
        {w.muted && (
          <span className="ws-mark">
            <Icon name="bellOff" size={11} />
          </span>
        )}
        {w.important && !w.muted && (
          <span className="ws-mark" data-tip="Important: its asks and finishes as cards on screen">
            <Icon name="alertCircle" size={11} />
          </span>
        )}
        {!more && wt.some(t => t.compacting) && (
          <span className="ws-sched ws-compact" data-tip="Claude Code is compacting its chat: summing up a long one takes a few seconds">
            compacting…
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
        {!words && w.pr?.conflict && w.pr.state === 'OPEN' && mark('conflict') && (
          <span className="ws-pr conflict" data-tip={`PR #${w.pr.number} has merge conflicts`}>
            <Icon name="conflict" size={11} />
          </span>
        )}
        {!words && w.pr?.checks === 'fail' && w.pr.state === 'OPEN' && mark('ci') && (
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
        {!words && w.pr && mark('pr') && (
          <span className={`ws-pr ${prState(w.pr)}`} role="img" aria-label={`PR #${w.pr.number}: ${prState(w.pr)}`} /* failing checks: their own mark, before it; red here is a closed PR. U11: its shape says the state too: merged a merge, closed an ×, a draft dashed */>
            {mark('author') && (!w.pr.mine || settings.ownAvatar !== false) && <Avatar login={w.pr.author} size={16} />}
            <Icon name={w.pr.state === 'MERGED' ? 'gitMerge' : w.pr.state === 'CLOSED' ? 'xCircle' : 'github'} size={11} />
          </span>
        )}
        {/* on hover, after the marks (they slide left): its menu */}
        <span className="ws-acts" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          <IconButton icon="more" title="Workspace" onClick={e => wsTabMenu(e, wsMenu(w))} />
        </span>
        {more && (
          <div className="ws-sub">
            {(w.branch || w.kind !== 'worktree') && <span className="ws-branch">{w.branch || 'folder'}</span>}
            <span className={`ws-state g-${state}`}>{w.setup ? 'setting up' : wt.some(t => t.compacting) ? 'compacting…' : (STATE_WORDS[state] ?? state)}</span>
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
          <span data-tip={`${prName(pr)} approved${pr.approved?.length ? ` by ${pr.approved.join(', ')}` : ''}${two ? ' (you too)' : ''}`}>
            <Icon name={two ? 'checks' : 'check'} size={11} />
          </span>
        )}
        {eyes && (
          <span className="ws-eyes" role="img" aria-label="You commented" data-tip={`You commented on ${prName(pr)}`}>
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
      w.important && !w.muted && 'important: cards on screen',
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
        {pr && <PrCard pr={pr} linked={w.prLinked} face={!pr.mine || settings.ownAvatar !== false} onOpen={openExternal} />}
        {w.ticket && <div className="wp-line">{w.ticket.key}{w.ticket.title ? ` ${w.ticket.title}` : ''}{w.ticket.status ? ` · ${w.ticket.status}` : ''}</div>}
        {(st => st && (st.add > 0 || st.del > 0 || st.dirty > 0) && <div className="wp-line wp-files">{filesText(st)} <span className="ws-stat"><span className="add">+{short(st.add)}</span> <span className="del">−{short(st.del)}</span></span>{st.dirty ? ` · ${st.dirty} not committed` : ''}</div>)(w.stat ?? (peekStat?.id === w.id ? peekStat.stat : undefined))}
        {marks.map(m => (
          <div key={String(m)} className="wp-line">
            {m}
          </div>
        ))}
        {(xs => xs.length > 0 && <div className="wp-line wp-ext"><RowMarks widgets={xs} ws={w.id} api={{ ...widgetApi, full: (id, at) => (setPeek(null), widgetApi.full(id, at)) }} /></div>)(rowMarks((view.widgets ?? []).filter(x => !x.project || x.project === w.project), w.id))}
        <div className="wp-acts">
          <button onClick={() => (setPeek(null), setWsId(w.id), setDialog(null))}>Open</button>
          {pr && <button onClick={() => openExternal(pr.url)}>{prName(pr)} on {forgeName(pr)}</button>}
          <span className="spacer" />
          <IconButton icon="more" title="Workspace" onClick={e => wsTabMenu(e, wsMenu(w))} />
        </div>
      </div>
    )
  }
  // a sep (a group, as the app calls it): a named head over a project's workspaces up to the next one, dragged like a
  // row; a workspace dropped on it goes first under it. n: how many it holds; folded (a click) it hides them: hid,
  // their busiest state on it
  // the sidebar's filter: does it show this one. only: the projects picked that are still here (one archived or removed
  // meanwhile counts as none)
  const only = (find?.projects ?? []).filter(id => view.projects.some(p => p.id === id))
  const shows = (w: WorkspaceView) => {
    if (!find) return true
    if (only.length && !only.includes(w.project)) return false
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
        role="treeitem"
        aria-level={2}
        aria-expanded={!shut}
        aria-label={s.name || 'Group'}
        tabIndex={-1}
        data-group={p.id}
        data-head=""
        data-tip={`${s.name}: ${n} ${n === 1 ? 'workspace' : 'workspaces'}${s.template ? ` · new ones start with the template ${s.template}` : ''}${s.preset ? ` · new ones start ${s.preset}` : ''} · click to ${shut ? 'expand' : 'collapse'} · drag to move · drop a workspace on it to put it here · double click to rename`}
        onPointerDown={e => rows.start(e, 'ws', s.id, p.id, true)}
        onClick={e => !rows.dragged() && !(e.target as Element).closest('button') && fold(s.id)}
        onDoubleClick={() => setDialog({ sep: p.id, id: s.id })}
        onContextMenu={e => openMenu(e, sepMenu(p, s))}
      >
        <span className="project-chev">
          <span className={`fold-chev${shut ? ' shut' : ''}`}><Icon name="chevron" size={11} /></span>
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
  // the rail's list: its kind's (a filter looks through all of them)
  const listed = rail && !find ? view.projects.filter(p => railOf(p.kind) === railKind) : view.projects
  const inList = (w: WorkspaceView) => !rail || !!find || kindOf(w) === railKind
  const pins = pinned.filter(w => shows(w) && inList(w))
  return { addMenu, busiest, found, listed, makingRows, needNext, needsApi, pause, peekCard, pickedArchive, pickedMute, pickedRm, pickedWs, pins, plusMenu, reminder, sendTo, shownRows, shows, sideStyle, timerMenu, wsRow }
}

// the sidebar itself (App keeps it, hidden, while a video plays)
// U11: the list is a tree: one tab stop (the selected workspace's row, else the first), ↑↓ Home End move, → opens or
// goes in, ← closes or goes up, Enter opens, Space picks (as ⌘-click), ⇧F10 or the Menu key its menu. A button in a row
// keeps its own keys
const ITEM = '[role=treeitem]'
const rove = (tree: HTMLElement, to: HTMLElement) => {
  for (const x of tree.querySelectorAll<HTMLElement>(`${ITEM}[tabindex="0"]`)) if (x !== to) x.tabIndex = -1
  to.tabIndex = 0
}
function treeKey(e: ReactKey<HTMLElement>) {
  const el = e.target as HTMLElement
  if (el.getAttribute('role') !== 'treeitem' || e.metaKey || e.ctrlKey || e.altKey) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEM)].filter(x => x.offsetParent)
  const i = items.indexOf(el)
  const level = (x: HTMLElement) => Number(x.getAttribute('aria-level') ?? 1)
  const to = (x?: HTMLElement) => x && (e.preventDefault(), rove(e.currentTarget, x), x.focus())
  const open = el.getAttribute('aria-expanded')
  const toggle = () => (e.preventDefault(), (el.querySelector<HTMLElement>('.project-chev') ?? el).click())
  if (e.key === 'ArrowDown') to(items[i + 1])
  else if (e.key === 'ArrowUp') to(items[i - 1])
  else if (e.key === 'Home') to(items[0])
  else if (e.key === 'End') to(items.at(-1))
  else if (e.key === 'ArrowRight') open === 'false' ? toggle() : open === 'true' && to(items[i + 1])
  else if (e.key === 'ArrowLeft') open === 'true' ? toggle() : to(items.slice(0, i).reverse().find(x => level(x) < level(el)))
  else if (e.key === 'Enter') e.preventDefault(), el.click()
  else if (e.key === ' ') e.preventDefault(), el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: el.classList.contains('ws') && !el.classList.contains('ws-new') }))
  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault()
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 16, clientY: r.bottom - 4 }))
  }
}

export function Sidebar({ app }: { app: AppCtx }) {
  const tree = useRef<HTMLDivElement>(null)
  // its one tab stop: kept where the keys left it while the focus is in it, else the selected row (or the first)
  useLayoutEffect(() => {
    const t = tree.current
    if (!t || t.contains(document.activeElement)) return
    const stop = t.querySelector<HTMLElement>(`.ws.sel${ITEM}`) ?? t.querySelector<HTMLElement>(ITEM)
    if (stop) rove(t, stop)
  })
  const { addMenu, busiest, dialog, find, fitFoot, fold, folded, footButtons, found, groupMoves, histNav, kt, labels, listed, listOff, live, making, makingRows, needing, needNext, needsApi, newIn, newWord, onboard, onboardDone, openMenu, ownWidgets, pause, picked, pickedArchive, pickedMute, pickedRm, pickedWs, picking, pickKey, pins, plusMenu, projectActions, quickNew, rail, railBar, railKind, reminder, rows, sendTo, setDialog, setFind, setOnboard, setPicked, setPicking, setSideOpen, setStrip, setTimer, settings, setVideo, setWatch, shownRows, shows, sideOpen, sideStyle, sideW, staleMin, strip, termIn, termsOk, timerMenu, timers, toast, video, watches, wideBar, widgetApi, ws, wsRow } = app
  // behind a rail page or a strip: hidden but laid out where it was (styles.css [data-away]), its width given back by a
  // margin so the main area lies over it; it comes back as it was, its scroll too
  const away = listOff || !!strip
  return (
    <aside className="sidebar" hidden={!sideOpen} data-away={away ? '' : undefined} data-style={sideStyle} style={{ width: sideW, ...(away && { marginRight: -sideW }), ...phVars(settings.projectLook), ...sideVars(settings.sideLook) }} {...sideAttrs(settings.sideLook, settings.projectLook)}>
      <div className="side-head drag">
        <IconButton icon="sidebar" title={kt('Hide sidebar', 'sidebar')} keyId="sidebar" onClick={() => setSideOpen(false)} />
        {!railBar && histNav}
        <span className="spacer" />
        {rail && railKind !== 'projects' && !find && <IconButton icon="chevronsLeft" title="Fold the list to a strip · right click: a strip on the right" onClick={() => setStrip(railKind, 'left')} onContextMenu={e => (e.preventDefault(), setStrip(railKind, 'right'))} />}
        <IconButton icon="filter" title={kt(find ? 'Stop filtering' : 'Filter the workspaces: by name, branch or PR; the ones that need you, working, with a PR', 'filter')} keyId="filter" on={!!find} onClick={() => setFind(f => (f ? null : { q: '' }))} />
        <IconButton icon="plus" title="Add a project, a terminal or a browser" tip={false} onClick={e => openMenu(e, addMenu())} />
        {settings.birdView !== false && <IconButton icon="eye" title="Bird view: every live session and its screen" on={dialog === 'bird'} onClick={() => setDialog(d => (d === 'bird' ? null : 'bird'))} />}
        {settings.devMode === true && !rail && <IconButton icon="target" className="picker-toggle" title={`Pick an element: what it is, to copy into a prompt (development mode)${pickKey ? ` · ${pickKey}` : ''}`} on={picking} onClick={() => setPicking(p => !p)} />}
        <IconButton icon="help" title={kt('Help: keys and commands', 'help')} keyId="help" on={dialog === 'help'} onClick={() => setDialog(d => (d === 'help' ? null : 'help'))} />
      </div>
      {find && (
        <div className="side-find">
          <div className="find-field">
            <input autoFocus value={find.q} placeholder="Filter: name, branch, PR…" spellCheck={false} onChange={e => setFind({ ...find, q: e.target.value })} onKeyDown={e => e.key === 'Escape' && setFind(null)} />
            {(find.q || find.only || !!find.projects?.length) && <IconButton icon="x" title="Clear and close the filter" onClick={() => setFind(null)} />}
          </div>
          <span className="seg">
            {ONLY.map(([id, label]) => (
              <button key={id} type="button" className={find.only === id ? 'on' : ''} onClick={() => setFind({ ...find, only: find.only === id ? undefined : id })}>
                {label}
              </button>
            ))}
          </span>
          {listed.length > 1 && (
            <div className="find-projects" role="group" aria-label="Projects">
              <button type="button" className={find.projects?.some(id => listed.some(p => p.id === id)) ? '' : 'on'} onClick={() => setFind({ ...find, projects: undefined })}>
                All projects
              </button>
              {listed.map(p => {
                const on = !!find.projects?.includes(p.id)
                const pick = (more: boolean) => setFind({ ...find, projects: pickProject(find.projects, p.id, more) })
                return (
                  <button key={p.id} type="button" className={on ? 'on' : ''} aria-pressed={on} data-tip={on ? 'Click: all projects again · Shift-click: take it out' : 'Click: only this one · Shift-click: add it'} onClick={e => pick(e.shiftKey)} onKeyDown={e => e.key === 'Enter' && e.shiftKey && (e.preventDefault(), pick(true))}>
                    <span className="fp-mark">
                      <ProjectMark p={p} or={markOf(p)} size={12} />
                      {on && <span className="fp-check"><Icon name="check" size={8} /></span>}
                    </span>
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {picked.length > 0 && (
        <div className="pick-bar" role="toolbar" aria-label={`${picked.length} picked`}>
          <b>{picked.length} picked</b>
          <span className="grow" />
          <IconButton icon="archive" title="Archive them" onClick={pickedArchive} />
          <IconButton icon="bellOff" title="Mute or unmute them" onClick={pickedMute} />
          <IconButton icon="sep" title="Move to group" onClick={e => (items => (items.length ? openMenu(e, items) : toast('Pick workspaces of one project with groups to move them')))(groupMoves(pickedWs()))} />
          <IconButton icon="trash" title="Delete them…" onClick={pickedRm} />
          <IconButton icon="x" title="Clear (Esc)" onClick={() => setPicked([])} />
        </div>
      )}
      <div className="side-scroll" role="tree" aria-label="Workspaces" ref={tree} onKeyDown={treeKey} onFocus={e => (e.target as HTMLElement).getAttribute('role') === 'treeitem' && rove(e.currentTarget, e.target as HTMLElement)}>
        <ScrollEdge />
        {find && !found && <div className="empty-side muted">No workspace matches.</div>}
        {!find && (!rail || railKind === 'projects') && settings.needsList !== false && (
          <NeedsList items={needsSorted(needing, staleMin).flatMap(t => (w => (w ? [{ t, w }] : []))(live.find(w => w.id === t.workspace)))} shut={folded.includes('needs')} onFold={() => fold('needs')} api={needsApi} next={needNext?.id} staleAfter={staleMin} />
        )}
        {pins.length > 0 && (
          <div className="project pinned">
            <div className="project-head" role="treeitem" aria-level={1} aria-expanded aria-label="Pinned" tabIndex={-1}>
              <span className="project-icon">
                <Icon name="pin" size={12} />
              </span>
              <span className="project-name">Pinned</span>
            </div>
            <div className="project-ws" role="group">{pins.map(w => wsRow(w, true))}</div>
          </div>
        )}
        {listed.map(p => {
          const mine = live.filter(w => w.project === p.id && !w.pinned) // a pinned one is above, under Pinned
          const hits = find && mine.filter(shows) // filtering: only those, folded or not, without the seps
          if (hits && !hits.length) return null
          if (!hits && settings.hideEmpty === true && !mine.length && ws?.project !== p.id && !making.some(m => m.project === p.id)) return null // Show › Empty projects off: one with no rows here
          const shut = !hits && folded.includes(p.id)
          const sum = shut ? busiest(mine) : 'idle'
          return (
          <div key={p.id} className={`project ${rows.at('project', p.id)}`} data-row={`project:${p.id}` /* the whole block: a project dropped anywhere on it */}>
            <div
              className={`project-head ${p.color && p.color !== 'none' ? 'tinted' : ''}`}
              role="treeitem"
              aria-level={1}
              aria-expanded={!shut}
              aria-label={p.name}
              tabIndex={-1}
              style={colorVar(p.color)}
              data-tip={`${p.host ? `${p.host}:` : ''}${p.path} · ${p.kind ? `click to ${shut ? 'expand' : 'collapse'}` : `click for its page (notes, tasks, memory, settings) · the arrow ${shut ? 'expands' : 'collapses'} it`} · drag to move`}
              onPointerDown={e => rows.start(e, 'project', p.id)}
              onClick={e => !rows.dragged() && !(e.target as Element).closest('button') && (p.kind || (e.target as Element).closest('.project-chev') ? fold(p.id) : setDialog({ project: p.id }))}
              onContextMenu={e => openMenu(e, projectActions(p))}
            >
              <span className="project-chev">
                <Icon name={shut ? 'chevronRight' : 'chevron'} size={12} />
              </span>
              <span className="project-icon">
                <ProjectMark p={p} or={markOf(p)} />
              </span>
              <span className="project-name">{p.name}</span>
              {p.sample && <span className="tag project-sample" data-tip="Laki's sample repo: Remove sample in its menu">sample</span>}
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
            <div className="project-ws" role="group">{/* under its project, on a guide line */}
            {hits ? hits.map(w => wsRow(w)) : shut ? [...makingRows(p, ''), ...(p.seps ?? []).flatMap(s => makingRows(p, s.id))] : shownRows(p, mine)}{/* folded: only one on its way stays */}
            {!shut && !hits && !live.some(w => w.project === p.id) && !making.some(m => m.project === p.id) && ( // nothing here yet (none pinned either): the way to start
              <div className="ws ws-new" role="treeitem" aria-level={2} tabIndex={-1} onClick={() => newIn(p)}>
                <Icon name="plus" size={12} />
                <span className="ws-name">{newWord(p)}</span>
              </div>
            )}
            {!shut && !hits && !p.kind && termsOk && !live.some(w => w.project === p.id) && !making.some(m => m.project === p.id) && ( // or just a shell there
              <div className="ws ws-new" role="treeitem" aria-level={2} tabIndex={-1} onClick={() => termIn(p)}>
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
            <div className="ws ws-new" role="treeitem" aria-level={2} tabIndex={-1} onClick={() => quickNew(railKind)}>{/* Terminals and Browsers: the first one makes the project */}
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
        <TimerBar key={t.id} end={t.end} tip={t.then === 'send' ? `To ${sendTo(t)}: ${t.text}` : undefined} label={t.then === 'send' ? `To ${sendTo(t)}: ${clip(t.text ?? '', 80)}` : t.then === 'remind' ? reminder(t) : `${t.important ? 'Important · ' : ''}${t.note ? `${t.note} · ` : ''}${span(t.ms)}${t.then === 'notify' ? '' : t.then === 'command' ? `, then ${t.cmd}` : `, then ${TIMER_THEN.find(x => x[0] === t.then)![1].toLowerCase().replace(' the video', '')}`}`} onMenu={e => openMenu(e, timerMenu(t))} left={t.left} onPause={t.then === 'send' || t.then === 'remind' ? undefined : () => pause(t.id)} onStop={() => setTimer(t.id, () => null)} />
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
      {(steps => !onboard.off && steps.some(x => !onboardDone.has(x.id)) && dialog !== 'onboard' && <OnboardBar key={steps.filter(x => onboardDone.has(x.id)).length /* a step done: a new bar, its pulse again */} done={steps.filter(x => onboardDone.has(x.id)).length} of={steps.length} onOpen={() => setDialog('onboard')} onOff={() => setOnboard(o => ({ ...o, off: true }))} />)(stepsOf(settings))}
      <PwaBar />
      {!wideBar && (
        <div className="side-foot" ref={fitFoot}>{/* pinned under the projects, in one row: words dropped from the right as they don't fit */}
          {footButtons(labels)}
        </div>
      )}
    </aside>
  )
}
