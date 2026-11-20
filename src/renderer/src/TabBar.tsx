// The tab bar: the workspace's tabs (TabList: over the terminals, or a strip beside them, settings.tabsAt), the
// buttons after them, and the Layout menu (layoutOf). App renders them with what appCtx.ts says they read.
import type { AppBase, AppCtx } from './appCtx'
import { type RoleLayout, type SavedLayout, type Role, fillRoles, tabsOf, toRoles, LAYOUT_PRESETS, allAgents } from '../../shared/layout'
import { type PanelTab, RunButton } from './SidePanel'
import { askText, type MenuItem, ON, Icon, colorVar, TurnTime, IconButton, act, MidText } from './ui'
import { type TabView, GOAL_SAYS, HOME_ACCOUNT, creatorOf } from '../../shared/types'
import { ctxPct, ctxText, usageText, level, levelWord, Ring } from './Usage'
import { colorOf, tabGlyph, wsName } from './appCtx'
import { timeLeft } from './Tunnel'
import { retrying, retryText } from './text'
import { Glyph, rollup } from './Glyph'
import { type CSSProperties, Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { capsulesOf, collapseOf, fitTabs, TOOLBAR_GROUPS, TOOLBAR_ITEMS, toolbarOf, type ToolbarItem } from './toolbar'
import { placesOf } from '../../shared/types'
import { click as extClick, WidgetStrip } from './Widgets'
import { api } from './api'
import { fresh } from './motion'
import { usualText } from '../../shared/nextStep'

// the tab bar's Layout menu: a preset or a saved layout lays out the workspace's tabs, and the side panel as it says
export function layoutOf(app: AppBase) {
  const { call, done, editScripts, group, groups, layoutWait, narrow, panelOpen, panelTab, panelW, project, roleTabs, run, selectTab, setGroups, setPanelOpen, setPanelTab, setPanelW, settings, tab, toast, ws } = app
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
  return { applyLayout, layoutMenu }
}

// the tabs: a tab per group of panes (its split's sessions), a drag moves them (Panes.tsx useTabDrag)
// a tab's tooltip, a card (ui.tsx tipCard): its name the title, a "Label: value" row for each fact, the hints its foot.
// A split's tabs: a head each, its rows under it
type TabTipOf = { ctxOn: boolean; costsOn: boolean; key?: string; account: (t: TabView) => string | undefined }
export function tabTip(ts: TabView[], o: TabTipOf) {
  const rows = (t: TabView) =>
    [
      t.compacting && 'Now: compacting its chat (a long one takes a few seconds)',
      retrying(t) && `Now: ${retryText(t.retry!)}`,
      t.asleep && `Now: ${t.queued ? 'waits its turn after a restart, a look starts it' : 'asleep to free memory, a look resumes it'}`,
      t.kind === 'agent' && t.status === 'exited' && 'Now: ended, ⏎ in it starts it again',
      (t.model || t.effort) && `Model: ${[t.model, t.effort].filter(Boolean).join(', ')}`,
      t.account && t.account !== HOME_ACCOUNT && `Account: ${o.account(t) ?? 'another account'}`,
      o.ctxOn && t.context && `Context: ${ctxText(t.context)}`,
      o.costsOn && t.usage && `Used: ${usageText(t.usage)} at API prices`,
      t.progress && `Progress: ${t.progress.pct}% done, its own estimate${t.progress.note ? ` (${t.progress.note})` : ''}`,
      t.usual && t.runAt && `Time: ${usualText((Date.now() - t.runAt) / 1000, t.usual)}`,
      t.queue?.length && `Queued: ${t.queue.length}, sent as its turn ends`,
      t.runs && `Runs: ${t.runs} in it (its status read off the screen)`,
      t.alias && `Alias: @${t.alias}, how other agents reach it (laki ask, laki send)`,
      t.share && `Shared: a live view${t.share.until ? `, ${timeLeft(t.share.until)} left` : ''} (right click: its link, stop)`,
    ].filter((x): x is string => typeof x === 'string')
  const one = ts.length === 1
  return [
    ts.map(t => t.name).join(' · '),
    ...(one ? rows(ts[0]) : ts.flatMap(t => (r => (r.length ? [t.name, ...r] : []))(rows(t)))),
    `${o.key ? `Go to it (${o.key}) · ` : ''}double click to rename · drag to reorder, or onto a pane to split · right click for more`,
  ].join('\n')
}

export function TabList({ app }: { app: AppCtx }) {
  const { accountsOf, byId, call, closeTabs, costsOn, ctxLook, ctxOn, group, groups, kt, narrow, newTabActions, openMenu, wsTabMenu, openReview, quickNew, reviewOn, reviewSeen, reviewTab, selectGroup, setDialog, settings, start, statKey, tabMenu, ws } = app
  const reviewDot = reviewTab && !reviewOn && reviewSeen[ws!.id] !== undefined && reviewSeen[ws!.id] !== statKey
  const keyOff = reviewTab ? 1 : 0 // the review's tab takes ⌘1
  // over the terminals: as many tabs as fit at --tab-min each, the rest behind +n (fitTabs); the selected one always
  // shows. One ResizeObserver, its width read as it changes. A strip beside them scrolls instead
  const fit = app.tabsAt === 'top'
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ w: 0, min: 120 })
  const measure = () => {
    const el = box.current
    if (!el) return
    const min = parseFloat(getComputedStyle(el).getPropertyValue('--tab-min')) || 120
    const w = el.clientWidth - [...el.querySelectorAll<HTMLElement>(':scope > .review-tab, :scope > .newtab-btn')].reduce((s, x) => s + x.offsetWidth, 0)
    setRoom(r => (r.w === w && r.min === min ? r : { w, min }))
  }
  useLayoutEffect(() => {
    if (!fit || !box.current) return
    const ro = new ResizeObserver(measure)
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [fit])
  useLayoutEffect(() => void (fit && measure()), [fit, !!reviewTab, ws?.id]) // the Review tab come or gone: the list's own size the same
  const sel = groups.indexOf(group!)
  const { shown, hidden } = fit && room.w ? fitTabs(groups.map(() => room.min), room.w, sel, room.min) : { shown: groups.map((_, i) => i), hidden: [] as number[] }
  const out = hidden.map(i => groups[i])
  const outTabs = out.flatMap(g => tabsOf(g).map(byId).filter((t): t is TabView => !!t))
  const waits = outTabs.filter(t => t.status === 'waiting').length
  const more = out.length > 0 && (
    <button
      type="button"
      className="tab-more nodrag"
      data-gi={groups.length}
      aria-label={`${out.length} more tab${out.length === 1 ? '' : 's'}${waits ? `, ${waits} waiting` : outTabs.some(t => t.failed) ? `, ${outTabs.filter(t => t.failed).length} stopped` : outTabs.some(t => t.status === 'running') ? ', working' : ''}`}
      aria-haspopup="menu"
      onClick={e => openMenu(e, out.map(g => (ts => ({ label: ts.map(t => t.name).join(' · '), sub: ts[0]?.kind === 'agent' ? ts[0].preset : undefined, mark: <Glyph s={ts.length > 1 ? rollup(ts) : ts[0] ? tabGlyph(ts[0]) : 'idle'} />, run: () => selectGroup(g) }) as MenuItem)(tabsOf(g).map(byId).filter((t): t is TabView => !!t))), 'right')}
    >
      <Glyph s={rollup(outTabs)} />+{out.length}
    </button>
  )
  const body = (
    <>
      {reviewTab && (
        <div className={`tab nodrag review-tab ${reviewOn ? 'sel' : ''}`} role="tab" aria-label="Review" onClick={openReview} data-keys="⌘1" data-tip={`Review: ${ws!.stat?.files ? `${ws!.stat.files} file${ws!.stat.files === 1 ? '' : 's'}, +${ws!.stat.add} −${ws!.stat.del}` : `PR #${ws!.pr!.number}`}${reviewDot ? ' · changed since you looked' : ''} · ⌘1`}>
          <Icon name="review" size={13} />
          {reviewDot && <i className="review-dot" />}
        </div>
      )}
      {groups.map((g, gi) => {
        if (!shown.includes(gi)) return null
        const ts = tabsOf(g).map(byId).filter((t): t is TabView => !!t)
        const queued = ts.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
        const ctx = ctxOn ? ts.flatMap(t => t.context ?? []).sort((a, b) => ctxPct(b) - ctxPct(a))[0] : undefined // a split's: the fullest
        return (
          <div
            key={ts[0]?.id}
            data-gi={gi}
            className={`tab nodrag ${g === group && !reviewOn ? 'sel' : ''}${ts.some(t => t.asleep) ? ' asleep' : ''}${ts.length && ts.every(t => t.kind === 'agent' && t.status === 'exited') ? ' ended' : ''}${fresh(ts[0]?.id) ? ' v-new' : ''}`}
            style={colorVar(colorOf(ts[0]))}
            {...act(() => selectGroup(g))}
            onDoubleClick={() => ts[0] && setDialog({ rename: ts[0].id })}
            onContextMenu={e => wsTabMenu(e, tabMenu(tabsOf(g)))}
            onPointerDown={e => !narrow && ts[0] && start(e, ts[0].id, true) /* a phone: no splits, tabs in their order */}
            onAuxClick={e => e.button === 1 && closeTabs(ts)}
            data-keys={groups.indexOf(g) + keyOff < 9 ? `⌘${groups.indexOf(g) + 1 + keyOff}` : undefined}
            data-tip-card
            data-tip={tabTip(ts, { ctxOn, costsOn, key: groups.indexOf(g) + keyOff < 9 ? `⌘${groups.indexOf(g) + 1 + keyOff}` : undefined, account: t => accountsOf(t.preset).find(a => a.id === t.account)?.name })}
          >
            <Glyph s={ts.length > 1 ? rollup(ts) : ts[0] ? tabGlyph(ts[0]) : 'idle'} />
            <MidText text={ts.map(t => t.name).join(' · ')} />
            {ts.some(t => t.compacting) && <span className="tab-compact">Compacting…</span>}
            {ts.some(retrying) && <span className="tab-compact">Retrying…</span>}
            {ts.some(t => t.drafted) && <span className="tab-compact" data-tip="Typed in its box and not sent">Draft</span>}
            {ts.some(t => t.ungated) && <span className="tab-compact" data-tip="Started before a tool gate was on: its tool calls aren't checked until it starts again (the extension's page: Restart the idle ones)">No gate</span>}
            {ts.filter(t => t.alias).map(t => <span key={t.id} className="tab-alias">@{t.alias}</span> /* laki name: what other agents call it */)}
            {settings.progressAt !== 'sidebar' && ts.map(t => t.progress && <span key={t.id} className="tab-pct" style={{ '--p': `${t.progress.pct}%` } as CSSProperties}>{t.progress.pct}%</span>)}
            {settings.timers && <TurnTime tabs={ts} />}
            {ts.some(t => t.bell) && ( // T16: a bell; its click turns it off
              <span className="ws-mark ws-bell" aria-label="Bell off" data-tip="A bell: told once when it next finishes or asks. Click to turn it off" onPointerDown={e => e.stopPropagation()} {...act(e => (e.stopPropagation(), ts.filter(t => t.bell).forEach(t => void call('tabBell', { id: t.id, on: false }).catch(() => {}))))}>
                <Icon name="bell" size={11} />
              </span>
            )}
            {(t => t && ( // A1: its /goal at work
              <span className={`ws-mark ws-goal ${t.goal!.state}`} data-tip={`Goal · ${GOAL_SAYS[t.goal!.state]}: ${t.goal!.text}`}>
                <Icon name="target" size={11} />
              </span>
            ))(ts.find(t => t.goal && t.goal.state !== 'reached' && t.goal.state !== 'failed'))}
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
            {ctx && ctxLook === 'line' && <i className={`tab-ctx ${level(ctxPct(ctx))}`} role="img" aria-label={`Context ${ctxPct(ctx)}%, ${levelWord(ctxPct(ctx))}`} style={{ '--p': `${ctxPct(ctx)}%` } as CSSProperties} />}
            {ctx && ctxLook === 'ring' && <Ring p={ctxPct(ctx)} />}
            <button className="x" data-tip={kt('Close', 'closeTab')} aria-label="Close tab" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => (e.stopPropagation(), closeTabs(ts))}>
              <Icon name="x" size={10} />
            </button>
          </div>
        )
      })}
      {more}
      {ws && (ws.browser === undefined ? <IconButton icon="plus" title="New tab (⌘⇧N) · ⌘-click an item: a tab of its own, never a split" className="nodrag newtab-btn" onClick={e => openMenu(e, newTabActions)} /> : <IconButton icon="plus" title={kt('New browser tab', 'newTab')} className="nodrag newtab-btn" onClick={() => quickNew('browsers')} />)}
    </>
  )
  return fit ? (
    <div className="tab-list" ref={box}>
      {body}
    </div>
  ) : (
    body
  )
}

// the tabs as a strip under or beside the terminals (settings.tabsAt)
export function TabStrip({ app }: { app: AppCtx }) {
  const { tabsAt } = app
  return (
    <div className={`tabstrip ${tabsAt}`} data-tabbar>
      <TabList app={app} />
    </div>
  )
}

// a row of buttons as one group (role group, its name): a capsule each; the tab bar's toolbar and the sidebar's top
// row follow the one rule (toolbar.ts' groups)
export const ToolGroup = ({ label, id, children }: { label: string; id?: string; children: ReactNode }) => (
  <div className="actions capsule nodrag tool-group" role="group" aria-label={label} data-g={id}>
    {children}
  </div>
)

// the toolbar's buttons that apply here, as toolbar.ts items (an extension's top bar ones too, by `ext:<id>`)
export function toolbarHere(app: AppCtx): ToolbarItem[] {
  const { onePane, readSwitch, canLater, narrow, ownWidgets, project, tab, ws } = app
  const page = !ws || ws.browser !== undefined || project?.kind === 'shells' // a page or a terminal: no files, PR, preview or scripts
  const can: Record<string, boolean> = {
    reader: !!(onePane && readSwitch(tab?.id)),
    full: !!ws,
    panel: !page,
    layout: !page,
    editor: !page && !narrow,
    preview: !page && !narrow,
    share: !!tab && !tab.share && !narrow,
    ship: !page && ws?.kind === 'worktree' && !narrow,
    timer: !page && canLater && !narrow,
  }
  const ext = ownWidgets.filter(w => w.on && placesOf(w).includes('top') && w.here !== null).map(w => ({ id: `ext:${w.id}`, title: w.name, icon: 'panel' as const, group: 'ext' as const }))
  return [...TOOLBAR_ITEMS.filter(x => can[x.id]), ...ext]
}

// the bar over the terminals: the tabs (unless they're in a strip), who made the workspace, the widgets, the buttons
// in groups (view, open elsewhere, workspace, extensions: settings.toolbar's, toolbar.ts), then ⋯ and Run, fixed. A
// button hidden, or its group folded for room (collapseOf, from the right, whole), is an item in ⋯. A right click on
// the bar's empty room: Customize toolbar… (the sheet, ToolbarSheet.tsx)
export function TabBar({ app }: { app: AppCtx }) {
  const { onePane, readSwitch, devRunning, devTab, editorName, editScripts, inReader, kh, kt, layoutMenu, live, narrow, openInItems, openMenu, ownWidgets, panelShown, panelTab, project, run, runMenu, selectTab, sendLater, setDialog, setRead, setReveal, setSharing, setSideOpen, setWsId, settings, sideOpen, tab, tabsAt, toggleFull, togglePanel, view, widgetApi, ws, wsMore } = app
  const bar = useRef<HTMLDivElement>(null)
  const [barW, setBarW] = useState(0)
  const [tabMin, setTabMin] = useState(120) // styles.css --tab-min, as TabList reads it
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(() => (setBarW(el.clientWidth), setTabMin(parseFloat(getComputedStyle(el).getPropertyValue('--tab-min')) || 120)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const here = toolbarHere(app)
  const { shown } = toolbarOf(settings.toolbar, [...TOOLBAR_ITEMS, ...here.filter(x => x.group === 'ext')], settings.toolbarSeen)
  const on = shown.filter(id => here.some(x => x.id === id))
  const groups = TOOLBAR_GROUPS.map(g => ({ ...g, ids: on.filter(id => here.find(x => x.id === id)!.group === g.id) })).filter(g => g.ids.length)
  // room for the buttons: the bar less three tabs' least (--tab-min), ⋯ and Run (150), and Terminal | Reader (130) where it shows
  const folded = new Set(narrow || !barW ? [] : collapseOf(groups.map(g => ({ id: g.id, n: g.ids.filter(id => id !== 'reader').length })), barW - 3 * tabMin - 150 - (on.includes('reader') ? 130 : 0)))
  const inBar = new Set(groups.filter(g => !folded.has(g.id)).flatMap(g => g.ids))
  const page = !ws || ws.browser !== undefined || project?.kind === 'shells'
  const later = () => sendLater(tab?.kind === 'agent' ? tab.id : undefined)
  // each built-in button: the bar's, and its ⋯ item when it isn't there (hidden or folded)
  const BTN: Record<string, { node: () => ReactNode; item?: () => MenuItem }> = {
    reader: { node: () => readSwitch(tab?.id), item: () => ({ label: tab && inReader(tab.id) ? 'Show as terminal' : 'Show as Reader', icon: 'bookOpen', run: () => tab && setRead(tab.id, inReader(tab.id) ? 'term' : 'reader') }) },
    full: { node: () => <IconButton icon="maximize" title={kt('Full screen: just this tab', 'full')} onClick={() => toggleFull(true)} /> },
    panel: { node: () => <IconButton icon="panel" title={kt('Info, files, changes, review, preview', 'panel')} keyId="panel" on={panelShown} onClick={() => togglePanel()} />, item: () => ({ label: 'Side panel: info, files, changes, review, preview', icon: 'panel', hint: kh('panel'), run: () => togglePanel() }) },
    layout: { node: () => <IconButton icon="layers" title={kt('Layout', 'layout')} onClick={e => openMenu(e, layoutMenu(), 'right')} /> },
    editor: { node: () => <IconButton icon="code" title={`Open in… (⌘E: ${editorName})`} onClick={e => openMenu(e, openInItems(), 'right')} />, item: () => ({ label: `Open in… (⌘E: ${editorName})`, icon: 'code', items: openInItems() }) },
    preview: { node: () => ws && <IconButton icon="globe" title={`Preview localhost:${ws.port}`} on={panelShown && panelTab === 'preview'} onClick={() => togglePanel('preview')} />, item: () => ({ label: `Preview localhost:${ws?.port}`, icon: 'globe', run: () => togglePanel('preview') }) },
    share: { node: () => tab && <IconButton icon="share" title="Share live view…" onClick={() => setSharing(tab.id)} />, item: () => ({ label: 'Share live view…', icon: 'share', run: () => tab && setSharing(tab.id) }) },
    ship: { node: () => <IconButton icon="ship" title="Ship: commit, push, open a PR" onClick={() => setDialog('ship')} />, item: () => ({ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') }) },
    timer: { node: () => <IconButton icon="timer" title={`${kt('Send a message later', 'later')}: to an agent or Laki AI`} keyId="later" onClick={later} />, item: () => ({ label: 'Send a message later…', icon: 'timer', hint: kh('later'), run: later }) },
  }
  // an extension's top bar button hidden or folded: in ⋯ as a phone has them (wsMore adds them itself when narrow)
  const extOut = narrow ? [] : ownWidgets.filter(w => !inBar.has(`ext:${w.id}`) && here.some(x => x.id === `ext:${w.id}`))
  const extItems: MenuItem[] = extOut.length ? [{ head: 'Extensions' }, ...extOut.map(w => ({ label: w.name, sub: w.label ?? w.badge, run: () => extClick(w, widgetApi) }))] : []
  const outside: MenuItem[] = [...here.filter(x => !inBar.has(x.id) && BTN[x.id]?.item).map(x => BTN[x.id].item!()), ...extItems]
  const full: MenuItem[] = ws ? [{ label: 'Full screen: just this tab', icon: 'maximize', hint: kh('full'), run: () => toggleFull(true) }] : [] // in ⋯, for the bar's room
  const extShown = new Set(groups.find(g => g.id === 'ext' && !folded.has('ext'))?.ids ?? [])
  const customize = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).matches('.spacer, .tab-list')) return
    e.preventDefault()
    openMenu(e, [{ label: 'Customize toolbar…', icon: 'settings', run: () => setDialog('toolbar') }])
  }
  return (
    <div className="tabbar drag" data-tabbar ref={bar} onContextMenu={customize}>
      {!sideOpen && <IconButton icon="sidebar" title={kt('Show sidebar', 'sidebar')} keyId="sidebar" className="nodrag side-show" onClick={() => setSideOpen(true)} />}
      {tabsAt === 'top' && <TabList app={app} />}
      {ws && !narrow && (f => f && (by => (
        <button type="button" className="nodrag created-by" data-tip={`Its agent started this workspace: ${by ? `${by.label} in ` : ''}${wsName(f)} · a click goes there`} onClick={() => (setReveal(r => [...r, f.id]), by ? selectTab({ id: by.id, workspace: f.id }) : setWsId(f.id))}>
          <Icon name="agent" size={12} /> Created by <b>{by?.label ?? wsName(f)}</b>
        </button>
      ))(creatorOf(ws, view.tabs)))(live.find(x => x.id === ws.from))}
      {ws && !narrow && !ws.from && ws.client && (
        <span className="nodrag created-by" data-tip={`A trusted client started this workspace (laki client): ${ws.client}`}>
          <Icon name="agent" size={12} /> Created by <b>{ws.client}</b>
        </span>
      )}
      {tabsAt !== 'top' && <span className="spacer" />}
      {inBar.has('reader') && BTN.reader.node() /* the Terminal | Reader switch: a capsule of its own (U2: a split pane has it in its header) */}
      {capsulesOf(groups.filter(g => !folded.has(g.id) && g.id !== 'ext').map(g => ({ ...g, ids: g.ids.filter(id => id !== 'reader') }))).map(c => (
        <ToolGroup key={c.id} id={c.id} label={c.label}>
          {c.ids.map(id => <Fragment key={id}>{BTN[id]?.node()}</Fragment>)}
        </ToolGroup>
      ))}
      {extShown.size > 0 && !(narrow && ws) && <ToolGroup id="ext" label="Extensions"><WidgetStrip widgets={ownWidgets.filter(w => extShown.has(`ext:${w.id}`))} api={widgetApi} place="top" /></ToolGroup> /* a phone: in the ⋯ menu (wsMore) */}
      {ws && (
        <div className="actions capsule nodrag tool-end">
          {narrow && !page && <IconButton icon="search" title={kt('Commands', 'palette')} keyId="palette" onClick={() => setDialog('palette')} /> /* a phone has no ⌘K */}
          <IconButton icon="more" title="Workspace" className="ws-more" onClick={e => openMenu(e, wsMore(page ? [...extItems, ...full] : [...outside, ...(outside.length ? [null] : []), ...full, { label: 'Layout', icon: 'layers', hint: kh('layout'), items: layoutMenu() }, null, { label: 'Customize toolbar…', icon: 'settings', run: () => setDialog('toolbar') }]), 'right')} />
          {!page && (
            <RunButton
              running={devRunning}
              onRun={() => (ws.run ? run() : editScripts())}
              onStop={() => devTab && api.send('input', { tab: devTab.id, data: '\x03' })}
              onMenu={e => openMenu(e, runMenu(), 'right')}
            />
          )}
        </div>
      )}
    </div>
  )
}
