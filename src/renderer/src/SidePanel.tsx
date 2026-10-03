// The right panel (⌥⌘B): the workspace's files, its changes against the base branch, and its PR's
// checks and review comments; and the header's Run button. The same file is in both apps (wb-superset,
// wb-spike); each passes in how its daemon lists and makes files, opens one, diffs and reads reviews.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { type AutoKey, PRSection, type WsInfo } from './Info'
import { Icon, IconButton, type IconName } from './ui'

export type PanelTab = 'files' | 'changes' | 'review'
export type FileList = { files: string[]; changed: Record<string, string>; cut?: boolean } // changed: M, A, D, R
export type Changes = { base: string; files: { path: string; status: string; add?: number; del?: number }[]; diff: string }
export type Thread = { path: string; line?: number; resolved: boolean; outdated: boolean; comments: { author: string; body: string }[] }
export type PanelApi = {
  files: () => Promise<FileList>
  newFile: (path: string, dir: boolean) => Promise<string> // the path made
  openFile: (path: string) => void // in the editor
  changes: () => Promise<Changes>
  threads: () => Promise<Thread[]>
}

export const PANEL_WIDTH = 340
const TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'changes', label: 'Changes', icon: 'changes' },
  { id: 'review', label: 'Review', icon: 'review' },
]

// what load gives, again every few seconds while the window is in front, and on reload()
function useLoad<T>(load: () => Promise<T>, key: string, every: number) {
  const [d, setD] = useState<T | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  const f = useRef(load)
  f.current = load
  useEffect(() => setD(null), [key])
  useEffect(() => {
    let alive = true
    const go = () => f.current().then(x => alive && (setD(x), setErr('')), e => alive && setErr(String(e?.message ?? e)))
    go()
    const t = setInterval(() => !document.hidden && go(), every)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [key, n, every])
  return [d, err, () => setN(x => x + 1)] as const
}

type Node = { name: string; path: string; dir: boolean }

// each folder's entries, folders first; a path ending in / is an empty folder
function tree(files: string[]) {
  const kids = new Map<string, Node[]>([['', []]])
  for (const f of files) {
    const parts = f.split('/')
    let parent = ''
    for (let i = 0; i < parts.length && parts[i]; i++) {
      const path = parent ? `${parent}/${parts[i]}` : parts[i]
      const dir = i < parts.length - 1
      if (!dir || !kids.has(path)) kids.get(parent)!.push({ name: parts[i], path, dir })
      if (dir && !kids.has(path)) kids.set(path, [])
      parent = path
    }
  }
  for (const l of kids.values()) l.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  return kids
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const ST: Record<string, string> = { M: 'modified', A: 'new', D: 'deleted', R: 'renamed', '?': 'new' }

function Files({ api, ws }: { api: PanelApi; ws: string }) {
  const [d, err, reload] = useLoad(api.files, ws, 8000)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState('')
  const [made, setMade] = useState<string[]>([]) // folders made here: git lists no empty ones
  const [making, setMaking] = useState<{ dir: boolean } | null>(null)
  const [name, setName] = useState('')
  const [makeErr, setMakeErr] = useState('')
  useEffect(() => {
    setOpen(new Set())
    setSel('')
    setMade([])
  }, [ws])
  const kids = useMemo(() => tree([...(d?.files ?? []), ...made.map(m => `${m}/`)]), [d, made])
  const changed = d?.changed ?? {}
  const changedDirs = useMemo(() => {
    const s = new Set<string>()
    for (const p of Object.keys(d?.changed ?? {})) for (let x = parentOf(p); x; x = parentOf(x)) s.add(x)
    return s
  }, [d])
  const folder = kids.has(sel) ? sel : parentOf(sel) // where new files go
  const toggle = (p: string) => setOpen(o => (o.has(p) ? (o.delete(p), new Set(o)) : new Set(o.add(p))))
  // p's folders open
  const reveal = (p: string) =>
    setOpen(o => {
      const n = new Set(o)
      for (let x = parentOf(p); x; x = parentOf(x)) n.add(x)
      return n
    })
  const make = async () => {
    const path = [folder, name.trim().replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/')
    if (!name.trim()) return setMaking(null)
    try {
      const p = await api.newFile(path, making!.dir)
      if (making!.dir) setMade(m => [...m, p])
      reveal(`${p}/x`)
      setSel(p)
      setMaking(null)
      reload()
      if (!making!.dir) api.openFile(p)
    } catch (e) {
      setMakeErr((e as Error).message ?? String(e))
    }
  }
  const startMaking = (dir: boolean) => (setMaking({ dir }), setName(''), setMakeErr(''))

  const rows: { n: Node; depth: number }[] = []
  const walk = (p: string, depth: number) => {
    for (const n of kids.get(p) ?? []) {
      rows.push({ n, depth })
      if (n.dir && open.has(n.path)) walk(n.path, depth + 1)
    }
  }
  const query = q.trim().toLowerCase()
  const found = query ? (d?.files ?? []).filter(f => f.toLowerCase().includes(query)).slice(0, 300) : []
  if (!query) walk('', 0)
  const dot = (p: string, dir: boolean) =>
    dir ? changedDirs.has(p) && <span className="sp-dot" /> : changed[p] && <span className={`sp-dot st-${changed[p]}`} data-tip={ST[changed[p]]} />
  return (
    <>
      <div className="sp-tools">
        <Icon name="search" />
        <input value={q} placeholder="Search files" spellCheck={false} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), setQ(''))} />
        <IconButton icon="filePlus" title={`New file in ${folder || 'the root'}`} onClick={() => startMaking(false)} />
        <IconButton icon="folderPlus" title={`New folder in ${folder || 'the root'}`} onClick={() => startMaking(true)} />
        <IconButton icon="refresh" title="Refresh" onClick={reload} />
        <IconButton icon="collapse" title="Collapse all" onClick={() => setOpen(new Set())} />
      </div>
      {making && (
        <div className="sp-make">
          <input
            autoFocus
            value={name}
            placeholder={`${making.dir ? 'folder' : 'file'} name, in ${folder || 'the root'}`}
            spellCheck={false}
            onChange={e => (setName(e.target.value), setMakeErr(''))}
            onKeyDown={e => (e.key === 'Enter' ? make() : e.key === 'Escape' && (e.stopPropagation(), setMaking(null)))}
            onBlur={() => !name.trim() && setMaking(null)}
          />
          {makeErr && <div className="warn small">{makeErr}</div>}
        </div>
      )}
      <div className="sp-body sp-tree">
        {err && <div className="warn small pad">{err}</div>}
        {!d && !err && <div className="muted small pad">Loading…</div>}
        {query
          ? found.map(f => (
              <div key={f} className={`sp-row ${sel === f ? 'sel' : ''}`} data-tip={f} onClick={() => (setSel(f), api.openFile(f))}>
                <Icon name="file" />
                <span className="sp-name">
                  {f.slice(f.lastIndexOf('/') + 1)} <span className="muted">{parentOf(f)}</span>
                </span>
                {dot(f, false)}
              </div>
            ))
          : rows.map(({ n, depth }) => (
              <div
                key={n.path}
                className={`sp-row ${sel === n.path ? 'sel' : ''} ${n.dir ? '' : `ch-${changed[n.path] ?? ''}`}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => (setSel(n.path), n.dir ? toggle(n.path) : api.openFile(n.path))}
              >
                <span className="sp-chev">{n.dir && <Icon name={open.has(n.path) ? 'chevron' : 'chevronRight'} />}</span>
                <span className="sp-name">{n.name}</span>
                {dot(n.path, n.dir)}
              </div>
            ))}
        {query && !found.length && <div className="muted small pad">No file matches.</div>}
        {d?.cut && <div className="muted small pad">Showing the first 50,000 files.</div>}
      </div>
    </>
  )
}

// the diff of one file, without its header lines
const fileOf = (l: string) => l.match(/ b\/(.*)$/)?.[1] ?? ''

function ChangesTab({ api, ws }: { api: PanelApi; ws: string }) {
  const [d, err, reload] = useLoad(api.changes, ws, 8000)
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => setOpen(new Set()), [ws])
  const byFile = useMemo(() => {
    const m = new Map<string, string[]>()
    let cur: string[] | null = null
    for (const l of d?.diff.split('\n') ?? []) {
      if (l.startsWith('diff --git ')) m.set(fileOf(l), (cur = []))
      else if (cur && !/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(l)) cur.push(l)
    }
    return m
  }, [d])
  const toggle = (p: string) => setOpen(o => (o.has(p) ? (o.delete(p), new Set(o)) : new Set(o.add(p))))
  const files = d?.files ?? []
  return (
    <>
      <div className="sp-tools">
        <span className="muted small grow">{d ? `${files.length} file${files.length === 1 ? '' : 's'} changed vs ${d.base}` : 'Loading…'}</span>
        <IconButton icon="collapse" title="Collapse all" onClick={() => setOpen(new Set())} />
        <IconButton icon="refresh" title="Refresh" onClick={reload} />
      </div>
      <div className="sp-body">
        {err && <div className="warn small pad">{err}</div>}
        {d && !files.length && <div className="muted small pad">No changes: the branch is where {d.base} is, and nothing is uncommitted.</div>}
        {files.map(f => (
          <div key={f.path} className="sp-change">
            <div className="sp-row" onClick={() => toggle(f.path)} data-tip={f.path}>
              <span className="sp-chev">
                <Icon name={open.has(f.path) ? 'chevron' : 'chevronRight'} />
              </span>
              <span className={`st st-${f.status[0] === '?' ? 'A' : f.status[0]}`}>{f.status[0] === '?' ? 'A' : f.status[0]}</span>
              <span className="sp-name">
                {f.path.slice(f.path.lastIndexOf('/') + 1)} <span className="muted">{parentOf(f.path)}</span>
              </span>
              {f.add !== undefined && (
                <span className="mono small">
                  <span className="add">+{f.add}</span> <span className="del">−{f.del ?? 0}</span>
                </span>
              )}
            </div>
            {open.has(f.path) && (
              <div className="sp-diff">
                {(byFile.get(f.path) ?? ['(no text diff: binary, or past the size cap)']).map((l, i) => (
                  <div key={i} className={`dl ${l.startsWith('@@') ? 'dl-hunk' : l[0] === '+' ? 'dl-add' : l[0] === '-' ? 'dl-del' : ''}`}>
                    {l || ' '}
                  </div>
                ))}
                <button className="link small" onClick={() => api.openFile(f.path)}>
                  open in the editor
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function ReviewTab(p: { w: WsInfo; api: PanelApi; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onFix: (what: 'ci' | 'review') => void }) {
  const pr = p.w.pr
  const [threads, err, reload] = useLoad(p.api.threads, `${p.w.id}#${pr?.number ?? ''}`, 60000)
  const open = (threads ?? []).filter(t => !t.resolved && t.comments.length)
  const resolved = (threads ?? []).filter(t => t.resolved).length
  return (
    <div className="sp-body info-body">
      <PRSection w={p.w} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} />
      {pr && (
        <section>
          <h3>
            <Icon name="review" /> Review comments
            <span className="grow" />
            <IconButton icon="refresh" title="Refresh" onClick={reload} />
          </h3>
          {err && <div className="warn small">{err}</div>}
          {!threads && !err && <span className="muted small">Loading…</span>}
          {threads && !open.length && <span className="muted small">No open threads{resolved ? ` (${resolved} resolved)` : ''}.</span>}
          {open.map((t, i) => (
            <div key={i} className="sp-thread">
              <div className="sp-thread-head mono small" onClick={() => p.api.openFile(t.path)} data-tip="Open in the editor">
                {t.path}
                {t.line ? `:${t.line}` : ''}
                {t.outdated && <span className="tag">outdated</span>}
              </div>
              {t.comments.map((c, j) => (
                <div key={j} className="sp-comment">
                  <b>@{c.author}</b> {c.body}
                </div>
              ))}
            </div>
          ))}
          {open.length > 0 && resolved > 0 && <span className="muted small">{resolved} resolved, not shown.</span>}
          <span className="muted small">From reviewers with write access and bots: what the agent gets.</span>
        </section>
      )}
    </div>
  )
}

export function SidePanel(p: {
  w: WsInfo
  git: boolean
  tab: PanelTab
  onTab: (t: PanelTab) => void
  api: PanelApi
  width: number
  onWidth: (w: number) => void
  onClose: () => void
  onOpen: (url: string) => void
  onToggle: (k: AutoKey, v: boolean) => void
  onFix: (what: 'ci' | 'review') => void
}) {
  const tabs = TABS.filter(t => p.git || t.id === 'files')
  const tab = tabs.some(t => t.id === p.tab) ? p.tab : 'files'
  return (
    <div className="side-panel" style={{ width: p.width }}>
      <div
        className="sp-handle"
        data-tip="Drag to resize · double-click to reset"
        onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={e => e.currentTarget.hasPointerCapture(e.pointerId) && p.onWidth(Math.round(Math.min(760, Math.max(240, window.innerWidth - e.clientX))))}
        onDoubleClick={() => p.onWidth(PANEL_WIDTH)}
      />
      <div className="sp-tabs">
        {tabs.map(t => (
          <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => p.onTab(t.id)}>
            <Icon name={t.icon} /> {t.label}
          </button>
        ))}
        <span className="grow" />
        <IconButton icon="x" title="Close (⌥⌘B)" onClick={p.onClose} />
      </div>
      {tab === 'files' && <Files api={p.api} ws={p.w.id} />}
      {tab === 'changes' && <ChangesTab api={p.api} ws={p.w.id} />}
      {tab === 'review' && <ReviewTab w={p.w} api={p.api} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} />}
    </div>
  )
}

// ▷ Run ▾: the project's run script in its run tab (■ Stop while it runs); ▾ for the rest
export function RunButton({ running, onRun, onStop, onMenu }: { running: boolean; onRun: () => void; onStop: () => void; onMenu: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <div className="run-btn nodrag">
      <button className={running ? 'running' : ''} data-tip={running ? 'Stop the run script (^C)' : "Run the project's run script"} onClick={running ? onStop : onRun}>
        <Icon name={running ? 'stop' : 'run'} /> {running ? 'Stop' : 'Run'}
      </button>
      <button className="run-more" aria-label="Run options" data-tip="Restart, the run tab, scripts…" onClick={onMenu}>
        <Icon name="chevron" />
      </button>
    </div>
  )
}
