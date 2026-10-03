import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, TabView, View, WorkspaceView } from '../../shared/types'
import { api, bridge, notify, openExternal } from './api'
import { AddProject, DiffPanel, NewWorkspace, Palette, type PaletteItem, Prompt } from './panels'
import { Glyph } from './Glyph'
import { Term } from './Term'
import { drop, keep, type Layout, resize, show, tabsOf } from './layout'
import { Panes, SideHandle, useTabDrag } from './Panes'

type Dialog = null | 'new' | 'project' | 'palette' | 'ship'

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

const tabGlyph = (t: TabView) => (t.limit ? 'limit' : t.done && t.status === 'idle' ? 'done' : t.status === 'exited' && t.code === 0 ? 'ok' : t.status)
const SIDE = 260 // the sidebar's default width

const load = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') ?? d
  } catch {
    return d
  }
}

export function App() {
  const [view, setView] = useState<View | null>(null)
  const [connected, setConnected] = useState(false)
  const [wsId, setWsId] = useState<string | null>(() => load('wbs.ws', null))
  const [tabByWs, setTabByWs] = useState<Record<string, string>>(() => load('wbs.tabs', {}))
  const [dialog, setDialog] = useState<Dialog>(null)
  const [newFor, setNewFor] = useState<string>() // a project just opened: its new-workspace dialog
  const [diff, setDiff] = useState(false)
  const [finds, setFinds] = useState<Record<string, number>>({}) // ⌘F presses per tab, for its find bar
  const [layouts, setLayouts] = useState<Record<string, Layout>>(() => load('wbs.layouts', {})) // panes per workspace
  const [sideW, setSideW] = useState<number>(() => load('wbs.side', SIDE))
  const [error, setError] = useState('')
  const viewRef = useRef<View | null>(null)
  viewRef.current = view

  const live = useMemo(() => view?.workspaces.filter(w => !w.archived) ?? [], [view])
  const ws = live.find(w => w.id === wsId) ?? live[0] ?? null
  const tabs = useMemo(() => view?.tabs.filter(t => t.workspace === ws?.id) ?? [], [view, ws])
  // panes whose tab still exists; the selected tab is always in one of them
  const kept = keep(layouts[ws?.id ?? ''] ?? null, id => tabs.some(t => t.id === id))
  const tab = tabs.find(t => t.id === tabByWs[ws?.id ?? '']) ?? tabs.find(t => tabsOf(kept).includes(t.id)) ?? tabs.find(t => t.kind === 'agent') ?? tabs[0] ?? null
  const layout = tab ? show(kept, tab.id) : null
  const visible = tabsOf(layout)
  const tabByWsRef = useRef(tabByWs)
  tabByWsRef.current = tabByWs

  useEffect(() => void localStorage.setItem('wbs.ws', JSON.stringify(ws?.id ?? null)), [ws?.id])
  useEffect(() => void localStorage.setItem('wbs.tabs', JSON.stringify(tabByWs)), [tabByWs])
  useEffect(() => void localStorage.setItem('wbs.layouts', JSON.stringify(layouts)), [layouts])
  useEffect(() => void localStorage.setItem('wbs.side', JSON.stringify(sideW)), [sideW])

  const fail = (e: unknown) => {
    setError((e as Error).message)
    setTimeout(() => setError(''), 6000)
  }
  const call = useCallback(<T,>(method: string, params: object = {}) => api.call<T>(method, params).catch(e => (fail(e), Promise.reject(e))), [])

  // a tab by id, or one just created (its view may not have arrived yet); one not on screen takes the
  // focused pane's place
  const selectTab = useCallback((ref: string | { id: string; workspace: string }) => {
    const t = typeof ref === 'string' ? viewRef.current?.tabs.find(t => t.id === ref) : ref
    if (!t) return
    const instead = tabByWsRef.current[t.workspace] ?? current.current ?? undefined
    setLayouts(m => ({ ...m, [t.workspace]: show(m[t.workspace] ?? null, t.id, instead) }))
    setWsId(t.workspace)
    setTabByWs(m => ({ ...m, [t.workspace]: t.id }))
  }, [])

  // the daemon connection
  useEffect(() => {
    const off = api.on(m => {
      if (m.ev === 'state') setView(m.view)
      else if (m.ev === 'open') setConnected(true)
      else if (m.ev === 'close') setConnected(false)
      else if (m.ev === 'turn') {
        const v = viewRef.current
        const t = v?.tabs.find(t => t.id === m.tab)
        const shown = document.hasFocus() && shownTabs.current.includes(m.tab)
        if (!t || shown) return
        const body = m.kind === 'waiting' ? `needs you${m.text ? `: ${m.text}` : ''}` : m.kind === 'limit' ? 'hit a usage limit' : m.text || 'finished'
        notify(`${t.workspace} · ${t.name}`, body.slice(0, 200), t.id, () => selectTab(t.id))
      }
    })
    api.connect()
    bridge?.onFocusTab(selectTab)
    return off
  }, [selectTab])

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

  // panes: drop a dragged tab on one, close one (its tab keeps running), move a divider
  const { drag, start } = useTabDrag((id, pane, edge) => {
    const next = ws && layout && drop(layout, id, pane, edge)
    if (!ws || !next) return
    setLayouts(m => ({ ...m, [ws.id]: next }))
    selectTab(id)
  })
  const closePane = (id: string) => {
    const rest = keep(layout, x => x !== id)
    if (!ws || !rest) return
    setLayouts(m => ({ ...m, [ws.id]: rest }))
    if (id === tab?.id) selectTab(tabsOf(rest)[0])
  }
  const tabLabel = (id: string) => {
    const t = tabs.find(t => t.id === id)
    return t && (
      <>
        <Glyph s={tabGlyph(t)} />
        <span>{t.name}</span>
      </>
    )
  }

  const newTab = useCallback(
    async (preset: string) => {
      if (!ws) return
      selectTab(await call<TabView>('tabNew', { ws: ws.id, preset }))
    },
    [ws, call, selectTab],
  )

  const closeTab = useCallback(
    async (t: TabView | null) => {
      if (!t) return
      const running = t.status !== 'exited'
      if (running && !confirm(`Close ${t.name}? Its process will be stopped.`)) return
      await call('tabClose', { id: t.id })
    },
    [call],
  )

  const moveWs = (d: number) => {
    if (!live.length) return
    const i = Math.max(0, live.findIndex(w => w.id === ws?.id))
    setWsId(live[(i + d + live.length) % live.length].id)
  }

  const rmWs = async (w: WorkspaceView, archive: boolean) => {
    const what = archive ? 'Archive' : 'Delete'
    if (!confirm(`${what} ${w.id}? Its tabs stop${w.kind === 'worktree' ? ', the worktree is removed (the branch stays)' : ''}.`)) return
    await call(archive ? 'wsArchive' : 'wsRm', { id: w.id })
  }

  const run = async () => ws && selectTab(await call<TabView>('run', { ws: ws.id }))

  // the native folder picker, then straight to a workspace in that project (the web dev renderer has
  // no picker: it gets the typed-path dialog)
  const openProject = async () => {
    if (!bridge) return setDialog('project')
    const path = await bridge.pickFolder()
    if (!path) return
    const p = await call<Project>('projectAdd', { path }).catch(() => null) // the toast says why
    if (p) {
      setNewFor(p.id)
      setDialog('new')
    }
  }

  // keys: capture phase, before xterm.js sees them
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (!e.metaKey || e.altKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    const act: Record<string, () => void> = {
      n: () => setDialog('new'),
      o: openProject,
      f: () => dialog || (tab && setFinds(m => ({ ...m, [tab.id]: (m[tab.id] ?? 0) + 1 }))), // not over a dialog
      t: () => newTab('shell'),
      w: () => closeTab(tab),
      k: () => setDialog(d => (d === 'palette' ? null : 'palette')),
      d: () => setDiff(d => !d),
      arrowup: () => moveWs(-1),
      arrowdown: () => moveWs(1),
    }
    if (/^[1-9]$/.test(k)) act[k] = () => tabs[Number(k) - 1] && selectTab(tabs[Number(k) - 1].id)
    if (!act[k] || (e.shiftKey && k !== 'arrowup' && k !== 'arrowdown')) return
    e.preventDefault()
    e.stopPropagation()
    act[k]()
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])

  const palette: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = []
    for (const w of live) items.push({ label: w.id, hint: `${w.branch} · workspace`, glyph: rollup(view!.tabs.filter(t => t.workspace === w.id)), run: () => setWsId(w.id) })
    for (const t of view?.tabs ?? []) {
      const w = live.find(w => w.id === t.workspace)
      if (w) items.push({ label: `${t.workspace} / ${t.name}`, hint: t.last ? t.last.slice(0, 80) : 'tab', glyph: t.done && t.status === 'idle' ? 'done' : t.status, run: () => selectTab(t.id) })
    }
    const a = (label: string, run: () => void, hint = 'action') => items.push({ label, hint, run })
    a('New workspace', () => setDialog('new'), '⌘N')
    a('Open project folder…', openProject, '⌘O')
    if (ws) {
      a('New shell tab', () => newTab('shell'), '⌘T')
      a('New claude tab', () => newTab('claude'))
      a('New codex tab', () => newTab('codex'))
      a('Diff', () => setDiff(true), '⌘D')
      a('Run dev server', run)
      if (ws.kind === 'worktree') a('Ship: commit, push, open PR', () => setDialog('ship'))
      if (ws.kind === 'worktree') a('Fork workspace', async () => setWsId((await call<WorkspaceView>('wsFork', { id: ws.id })).id))
      if (ws.kind === 'worktree') a('Archive workspace', () => rmWs(ws, true))
      a('Delete workspace', () => rmWs(ws, false))
      if (tab) a('Close tab', () => closeTab(tab), '⌘W')
      if (ws.pr) a(`Open PR #${ws.pr.number}`, () => openExternal(ws.pr!.url))
      for (const p of ws.ports) a(`Open localhost:${p}`, () => openExternal(`http://localhost:${p}`))
    }
    for (const w of view?.workspaces.filter(w => w.archived) ?? []) a(`Restore ${w.id}`, () => call('wsRestore', { id: w.id }).then(() => setWsId(w.id)), 'archived')
    return items
  }, [view, live, ws, tab])

  if (!view)
    return (
      <div className="splash">
        <div className="logo">wbs</div>
        <div className="muted">{connected ? 'loading…' : 'connecting to the daemon…'}</div>
      </div>
    )

  const archived = view.workspaces.filter(w => w.archived)
  return (
    <div className="app">
      <aside className="sidebar" style={{ width: sideW }}>
        <div className="side-head drag">
          <span className="logo">wbs</span>
          <span className="spacer" />
          <button className="icon nodrag" title="New workspace (⌘N)" onClick={() => setDialog('new')}>
            +
          </button>
        </div>
        <div className="side-scroll">
          {view.projects.map(p => (
            <div key={p.id} className="project">
              <div className="project-head">
                <span title={p.path}>{p.name}</span>
                <span className="spacer" />
                <button className="icon small" title={`Remove project ${p.name}`} onClick={() => confirm(`Remove project ${p.name}? Files stay.`) && call('projectRm', { id: p.id })}>
                  ×
                </button>
              </div>
              {live
                .filter(w => w.project === p.id)
                .map(w => {
                  const wt = view.tabs.filter(t => t.workspace === w.id)
                  const queued = wt.reduce((n, t) => n + (t.queue?.length ?? 0), 0)
                  return (
                    <div key={w.id} className={`ws ${w.id === ws?.id ? 'sel' : ''}`} onClick={() => setWsId(w.id)}>
                      <div className="ws-line">
                        <Glyph s={w.setup ? 'running' : rollup(wt)} />
                        <span className="ws-name">{w.id}</span>
                        {queued > 0 && <span className="badge">+{queued}</span>}
                        <span className="spacer" />
                        {w.pr && (
                          <button className={`pr pr-${w.pr.checks || 'none'} pr-${w.pr.state.toLowerCase()}`} title={`PR #${w.pr.number} ${w.pr.state} ${w.pr.checks}`} onClick={e => (e.stopPropagation(), openExternal(w.pr!.url))}>
                            #{w.pr.number}
                            {{ pass: ' ✓', fail: ' ✗', pending: ' …', '': '' }[w.pr.checks]}
                          </button>
                        )}
                      </div>
                      <div className="ws-meta">
                        <span className="branch">{w.kind === 'local' ? `⌂ ${w.branch}` : `⎇ ${w.branch}`}</span>
                        <span className="port" title="$PORT">:{w.port}</span>
                        {w.ports.map(port => (
                          <button key={port} className="listen" title={`open http://localhost:${port}`} onClick={e => (e.stopPropagation(), openExternal(`http://localhost:${port}`))}>
                            ↗{port}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
          {archived.length > 0 && (
            <div className="project archived">
              <div className="project-head">archived</div>
              {archived.map(w => (
                <div key={w.id} className="ws">
                  <div className="ws-line">
                    <span className="ws-name muted">{w.id}</span>
                    <span className="spacer" />
                    <button className="link" onClick={() => call('wsRestore', { id: w.id }).then(() => setWsId(w.id))}>
                      restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!view.projects.length && <div className="empty-side muted">Add a git repository to start.</div>}
        </div>
        <div className="side-foot">
          <button title="Open a project folder (⌘O)" onClick={openProject}>+ Add project</button>
        </div>
      </aside>

      <SideHandle width={sideW} onWidth={setSideW} init={SIDE} />
      <main className="main">
        <div className="tabbar drag">
          {tabs.map((t, i) => (
            <div
              key={t.id}
              className={`tab nodrag ${t.id === tab?.id ? 'sel' : visible.includes(t.id) ? 'shown' : ''}`}
              onClick={() => selectTab(t.id)}
              onPointerDown={e => start(e, t.id)}
              onAuxClick={e => e.button === 1 && closeTab(t)}
              title={`${t.name} (⌘${i + 1})${t.cmd ? `\n${t.cmd}` : ''}`}
            >
              <Glyph s={tabGlyph(t)} />
              <span>{t.name}</span>
              {!!t.queue?.length && <span className="badge">+{t.queue.length}</span>}
              <button className="x" onClick={e => (e.stopPropagation(), closeTab(t))} title="Close (⌘W)">
                ×
              </button>
            </div>
          ))}
          {ws && (
            <button className="icon nodrag" title="New shell tab (⌘T)" onClick={() => newTab('shell')}>
              +
            </button>
          )}
          <span className="spacer" />
          {ws && (
            <div className="actions nodrag">
              <button onClick={() => setDiff(d => !d)} className={diff ? 'on' : ''} title="⌘D">
                Diff
              </button>
              <button onClick={run} title="Run the project's dev command (.wb.json run) in a dev tab">
                Run
              </button>
              {ws.kind === 'worktree' && <button onClick={() => setDialog('ship')}>Ship</button>}
              <button onClick={() => setDialog('palette')} title="⌘K">
                ⌘K
              </button>
            </div>
          )}
        </div>
        <div className="body">
          <div className="term-wrap">
            {layout ? (
              <Panes
                layout={layout}
                active={tab?.id ?? null}
                drag={drag}
                label={tabLabel}
                render={id => <Term tab={id} active={id === tab?.id} findSeq={finds[id] ?? 0} />}
                onFocus={id => id !== tab?.id && selectTab(id)}
                onClosePane={closePane}
                onResize={(path, at) => ws && setLayouts(m => ({ ...m, [ws.id]: resize(layout, path, at) }))}
                startDrag={start}
              />
            ) : (
              <div className="empty">
                {ws ? (
                  <>
                    <p>No tabs in {ws.id}.</p>
                    <button onClick={() => newTab('claude')}>claude</button> <button onClick={() => newTab('codex')}>codex</button> <button onClick={() => newTab('shell')}>shell</button>
                  </>
                ) : (
                  <>
                    <p>{view.projects.length ? 'No workspaces yet.' : 'No projects yet.'}</p>
                    <button onClick={() => (view.projects.length ? setDialog('new') : openProject())}>{view.projects.length ? 'New workspace  ⌘N' : 'Open project folder…  ⌘O'}</button>
                  </>
                )}
              </div>
            )}
          </div>
          {diff && ws && <DiffPanel ws={ws.id} onClose={() => setDiff(false)} />}
        </div>
        {tab?.kind === 'agent' && <SendBar tab={tab} call={call} />}
        <div className="status">
          {ws ? (
            <>
              <span>{ws.path}</span>
              <span className="spacer" />
              {ws.setup && <span className="muted">setup running… </span>}
              <span>PORT {ws.port}</span>
            </>
          ) : (
            <span className="spacer" />
          )}
          {!connected && <span className="warn"> · reconnecting…</span>}
        </div>
      </main>

      {error && <div className="toast">{error}</div>}
      {dialog === 'new' && (
        <NewWorkspace
          view={view}
          project={newFor ?? ws?.project}
          onClose={() => {
            setDialog(null)
            setNewFor(undefined)
          }}
          onCreate={async p => {
            const w = await call<WorkspaceView>('wsNew', p)
            setWsId(w.id)
            setDialog(null)
            setNewFor(undefined)
          }}
        />
      )}
      {dialog === 'project' && (
        <AddProject
          onClose={() => setDialog(null)}
          onAdd={async path => {
            await call('projectAdd', { path })
            setDialog(null)
          }}
        />
      )}
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
    </div>
  )
}

function SendBar({ tab, call }: { tab: TabView; call: <T>(m: string, p?: object) => Promise<T> }) {
  const [text, setText] = useState('')
  const [whenIdle, setWhenIdle] = useState(true)
  const submit = async () => {
    if (!text.trim()) return
    setText('') // now, so text typed while the request runs isn't sent along with it
    await call('send', { target: tab.id, text, whenIdle }).catch(() => setText(text))
  }
  return (
    <div className="sendbar">
      <textarea
        rows={1}
        value={text}
        placeholder={`Message ${tab.name}… (⏎ send, ⇧⏎ newline)`}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <label title="Queue it: typed in when the agent finishes its turn">
        <input type="checkbox" checked={whenIdle} onChange={e => setWhenIdle(e.target.checked)} /> when idle
      </label>
      <button onClick={submit}>Send</button>
      {!!tab.queue?.length && (
        <button className="link" title={tab.queue.join('\n')} onClick={() => call('queueClear', { target: tab.id })}>
          {tab.queue.length} queued · clear
        </button>
      )}
    </div>
  )
}
