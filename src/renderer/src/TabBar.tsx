// The tab bar: the workspace's tabs (TabList: over the terminals, or a strip beside them, settings.tabsAt), the
// buttons after them, and the Layout menu (layoutOf). App renders them with what appCtx.ts says they read.
import type { AppBase, AppCtx } from './appCtx'
import { type RoleLayout, type SavedLayout, type Role, fillRoles, tabsOf, toRoles, LAYOUT_PRESETS, allAgents } from '../../shared/layout'
import { type PanelTab, RunButton } from './SidePanel'
import { askText, type MenuItem, ON, Icon, colorVar, TurnTime, IconButton } from './ui'
import { type TabView, HOME_ACCOUNT, creatorOf } from '../../shared/types'
import { ctxPct, ctxText, usageText, level, Ring } from './Usage'
import { colorOf, tabGlyph, wsName } from './appCtx'
import { timeLeft } from './Tunnel'
import { retrying, retryText } from './text'
import { Glyph, rollup } from './Glyph'
import type { CSSProperties } from 'react'
import { WidgetStrip } from './Widgets'
import { api } from './api'

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
export function TabList({ app }: { app: AppCtx }) {
  const { accountsOf, byId, closeTabs, costsOn, ctxLook, ctxOn, group, groups, kt, narrow, newTabActions, openMenu, openReview, quickNew, reviewOn, reviewSeen, reviewTab, selectGroup, setDialog, settings, start, statKey, tabMenu, ws } = app
  const reviewDot = reviewTab && !reviewOn && reviewSeen[ws!.id] !== undefined && reviewSeen[ws!.id] !== statKey
  const keyOff = reviewTab ? 1 : 0 // the review's tab takes ⌘1
  return (
    <>
      {reviewTab && (
        <div className={`tab nodrag review-tab ${reviewOn ? 'sel' : ''}`} role="tab" aria-label="Review" onClick={openReview} data-keys="⌘1" data-tip={`Review: ${ws!.stat?.files ? `${ws!.stat.files} file${ws!.stat.files === 1 ? '' : 's'}, +${ws!.stat.add} −${ws!.stat.del}` : `PR #${ws!.pr!.number}`}${reviewDot ? ' · changed since you looked' : ''} · ⌘1`}>
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
            data-tip={[...ts.filter(t => t.compacting).map(t => `${t.name} is compacting its chat: summing up a long one takes a few seconds`), ...ts.filter(retrying).map(t => `${t.name}: ${retryText(t.retry!)}`), ...ts.filter(t => t.queue?.length).map(t => `${t.name}: ${t.queue!.length} queued, sent as its turn ends`), ...ts.filter(t => t.alias).map(t => `${t.name} is @${t.alias}: other agents reach it by that name (laki ask, laki send)`), ...ts.filter(t => t.runs).map(t => `${t.name}: ${t.runs} runs in it (its status read off the screen)`), ...ts.filter(t => t.progress).map(t => `${t.name}: ${t.progress!.pct}% done, its own estimate${t.progress!.note ? `: ${t.progress!.note}` : ''}`), ...(ctxOn ? ts.filter(t => t.context).map(t => `${t.name}'s context: ${ctxText(t.context!)}`) : []), ...(costsOn ? ts.filter(t => t.usage).map(t => `${t.name} used ${usageText(t.usage!)} at API prices`) : []), ...ts.filter(t => t.asleep).map(t => (t.queued ? `${t.name} waits its turn after a restart: a look starts it now` : `${t.name} is asleep to free memory: a look resumes it`)), ...ts.filter(t => t.share).map(t => `${t.name} is shared as a live view${t.share!.until ? `, ${timeLeft(t.share!.until)} left` : ''} (right click: its link, stop)`), ...ts.filter(t => t.kind === 'agent' && t.status === 'exited').map(t => `${t.name} ended: ⏎ in it starts it again`), ...ts.filter(t => t.model || t.effort).map(t => `${t.name}: ${[t.model, t.effort].filter(Boolean).join(', ')}`), ...ts.filter(t => t.account && t.account !== HOME_ACCOUNT).map(t => `${t.name}: on ${accountsOf(t.preset).find(a => a.id === t.account)?.name ?? 'another account'}`), ...(groups.indexOf(g) + keyOff < 9 ? [`⌘${groups.indexOf(g) + 1 + keyOff}`] : []), 'double click to rename', 'drag to reorder, or onto a pane to split', 'right click for more'].join(' · ')}
          >
            <Glyph s={ts.length > 1 ? rollup(ts) : ts[0] ? tabGlyph(ts[0]) : 'idle'} />
            <span>{ts.map(t => t.name).join(' · ')}</span>
            {ts.some(t => t.compacting) && <span className="tab-compact">Compacting…</span>}
            {ts.some(retrying) && <span className="tab-compact">Retrying…</span>}
            {ts.filter(t => t.alias).map(t => <span key={t.id} className="tab-alias">@{t.alias}</span> /* laki name: what other agents call it */)}
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
      {ws && (ws.browser === undefined ? <IconButton icon="plus" title="New tab (⌘⇧N) · ⌘-click an item: a tab of its own, never a split" className="nodrag newtab-btn" onClick={e => openMenu(e, newTabActions)} /> : <IconButton icon="plus" title={kt('New browser tab', 'newTab')} className="nodrag newtab-btn" onClick={() => quickNew('browsers')} />)}
    </>
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

// the bar over the terminals: the tabs (unless they're in a strip), who made the workspace, the widgets, the buttons
export function TabBar({ app }: { app: AppCtx }) {
  const { canLater, devRunning, devTab, editorName, editScripts, info, kt, layoutMenu, live, narrow, openInItems, openMenu, ownWidgets, panelShown, panelTab, project, run, runMenu, selectTab, sendLater, setDialog, setReveal, setSideOpen, setWsId, showInfo, sideOpen, tab, tabsAt, toggleFull, togglePanel, view, widgetApi, ws, wsMore } = app
  return (
    <div className="tabbar drag" data-tabbar>
      {!sideOpen && <IconButton icon="sidebar" title={kt('Show sidebar', 'sidebar')} keyId="sidebar" className="nodrag side-show" onClick={() => setSideOpen(true)} />}
      {tabsAt === 'top' && <TabList app={app} />}
      {ws && !narrow && (f => f && (by => (
        <button type="button" className="nodrag created-by" data-tip={`Its agent started this workspace: ${by ? `${by.label} in ` : ''}${wsName(f)} · a click goes there`} onClick={() => (setReveal(r => [...r, f.id]), by ? selectTab({ id: by.id, workspace: f.id }) : setWsId(f.id))}>
          <Icon name="agent" size={12} /> Created by <b>{by?.label ?? wsName(f)}</b>
        </button>
      ))(creatorOf(ws, view.tabs)))(live.find(x => x.id === ws.from))}
      <span className="spacer" />
      {!(narrow && ws) && <WidgetStrip widgets={ownWidgets} api={widgetApi} place="top" /> /* a phone: in the ⋯ menu (wsMore) */}
      {ws && ws.browser === undefined && project?.kind !== 'shells' && !narrow && <IconButton icon="layers" title={kt('Layout: the agent with Preview, Changes, the dev server or a shell; yours', 'layout')} keyId="layout" className="nodrag layout-btn" onClick={e => openMenu(e, layoutMenu(), 'right')} />}
      {ws && <IconButton icon="maximize" title={kt('Full screen: just this tab', 'full')} keyId="full" className="nodrag" onClick={() => toggleFull(true)} />}
      {ws && (ws.browser !== undefined || project?.kind === 'shells') && ( // a page or a terminal: no files, PR, preview or scripts to show
        <div className="actions nodrag">
          <IconButton icon="more" title="Workspace" className="ws-more" onClick={e => openMenu(e, wsMore(), 'right')} />
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
          <IconButton icon="more" title="Workspace" className="ws-more" onClick={e => openMenu(e, wsMore(), 'right')} />
          <RunButton
            running={devRunning}
            onRun={() => (ws.run ? run() : editScripts())}
            onStop={() => devTab && api.send('input', { tab: devTab.id, data: '\x03' })}
            onMenu={e => openMenu(e, runMenu(), 'right')}
          />
        </div>
      )}
    </div>
  )
}
