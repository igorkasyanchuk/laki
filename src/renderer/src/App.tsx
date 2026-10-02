import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TabView, View, WorkspaceView } from '../../shared/types'
import { api, bridge, notify, openExternal } from './api'
import { AddProject, DiffPanel, Inbox, NewWorkspace, Palette, type PaletteItem, Prompt } from './panels'
import { Glyph } from './Glyph'
import { Term } from './Term'

type Dialog = null | 'new' | 'project' | 'palette' | 'ship' | 'inbox'

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
  const [diff, setDiff] = useState(false)
  const [error, setError] = useState('')
  const viewRef = useRef<View | null>(null)
  viewRef.current = view

  const live = useMemo(() => view?.workspaces.filter(w => !w.archived) ?? [], [view])
  const ws = live.find(w => w.id === wsId) ?? live[0] ?? null
  const tabs = useMemo(() => view?.tabs.filter(t => t.workspace === ws?.id) ?? [], [view, ws])
  const tab = tabs.find(t => t.id === tabByWs[ws?.id ?? '']) ?? tabs.find(t => t.kind === 'agent') ?? tabs[0] ?? null

  useEffect(() => void localStorage.setItem('wbs.ws', JSON.stringify(ws?.id ?? null)), [ws?.id])
  useEffect(() => void localStorage.setItem('wbs.tabs', JSON.stringify(tabByWs)), [tabByWs])

  const fail = (e: unknown) => {
    setError((e as Error).message)
    setTimeout(() => setError(''), 6000)
  }
  const call = useCallback(<T,>(method: string, params: object = {}) => api.call<T>(method, params).catch(e => (fail(e), Promise.reject(e))), [])

  // a tab by id, or one just created (its view may not have arrived yet)
  const selectTab = useCallback((ref: string | { id: string; workspace: string }) => {
    const t = typeof ref === 'string' ? viewRef.current?.tabs.find(t => t.id === ref) : ref
    if (!t) return
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
        const shown = document.hasFocus() && current.current === m.tab
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
  useEffect(() => {
    const report = () => api.send('view', { tab: current.current, focused: document.hasFocus() })
    report()
    window.addEventListener('focus', report)
    window.addEventListener('blur', report)
    const off = api.on(m => m.ev === 'open' && report())
    return () => {
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', report)
      off()
    }
  }, [tab?.id])

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

  // keys: capture phase, before xterm.js sees them
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (!e.metaKey || e.altKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    const act: Record<string, () => void> = {
      n: () => setDialog('new'),
      t: () => newTab('shell'),
      w: () => closeTab(tab),
      k: () => setDialog(d => (d === 'palette' ? null : 'palette')),
      d: () => setDiff(d => !d),
      i: () => setDialog(d => (d === 'inbox' ? null : 'inbox')),
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
    a('Add project', () => setDialog('project'))
    a('Inbox', () => setDialog('inbox'), '⌘I')
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
      <aside className="sidebar">
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
          <button onClick={() => setDialog('project')}>+ Add project</button>
          <InboxButton view={view} onClick={() => setDialog('inbox')} />
        </div>
      </aside>

      <main className="main">
        <div className="tabbar drag">
          {tabs.map((t, i) => (
            <div
              key={t.id}
              className={`tab nodrag ${t.id === tab?.id ? 'sel' : ''}`}
              onClick={() => selectTab(t.id)}
              onAuxClick={e => e.button === 1 && closeTab(t)}
              title={`${t.name} (⌘${i + 1})${t.cmd ? `\n${t.cmd}` : ''}`}
            >
              <Glyph s={t.limit ? 'limit' : t.done && t.status === 'idle' ? 'done' : t.status} />
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
            {tab ? (
              <Term key={tab.id} tab={tab.id} />
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
                    <button onClick={() => setDialog(view.projects.length ? 'new' : 'project')}>{view.projects.length ? 'New workspace  ⌘N' : 'Add project'}</button>
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
          project={ws?.project}
          onClose={() => setDialog(null)}
          onCreate={async p => {
            const w = await call<WorkspaceView>('wsNew', p)
            setWsId(w.id)
            setDialog(null)
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
      {dialog === 'inbox' && (
        <Inbox
          view={view}
          onClose={() => setDialog(null)}
          onPick={id => {
            selectTab(id)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function InboxButton({ view, onClick }: { view: View; onClick: () => void }) {
  const waiting = view.tabs.filter(t => t.status === 'waiting').length
  const done = view.tabs.filter(t => t.done && t.status === 'idle').length
  return (
    <button onClick={onClick} title="Inbox (⌘I)" className="inbox-btn">
      Inbox{waiting > 0 && <span className="g-waiting"> ◆{waiting}</span>}
      {done > 0 && <span className="g-done"> ●{done}</span>}
    </button>
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
