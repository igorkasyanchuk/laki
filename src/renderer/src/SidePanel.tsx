// The right panel (⌥⌘B): the workspace's files, its changes against the base branch, and its PR's
// checks and review comments; a file's preview, the file finder (⌘P) and the header's Run button. App.tsx
// passes in how the daemon lists, reads and makes files, opens one in the editor, diffs and reads reviews.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { bridge, openExternal } from './api'
import { highlight } from './highlight'
import { type Block, type Inline, markdown } from './markdown'
import { type AutoKey, type FixWhat, PRSection, type WsInfo } from './Info'
import { type actionsFor, type RunAction } from './text'
import { ask, Icon, IconButton, type IconName, type MenuItem } from './ui'

export type PanelTab = 'files' | 'changes' | 'review' | 'preview'
export type FileList = { files: string[]; changed: Record<string, string>; cut?: boolean } // changed: M, A, D, R
export type Changes = { base: string; files: { path: string; status: string; add?: number; del?: number }[]; diff: string }
export type Thread = { path: string; line?: number; resolved: boolean; outdated: boolean; comments: { author: string; body: string }[] }
// a file to show: text (up to a size), an image as a data: URL, or neither (binary)
export type FileContent = { size: number; text?: string; image?: string; cut?: boolean; lossy?: boolean } // lossy: not UTF-8
// an edit in the file preview: the text as typed (a textarea's \n line ends) and the file's text it started from (App
// keeps it: a workspace switch doesn't lose it)
export type Edit = { text: string; was: string }
export const edited = (e?: Edit | null) => !!e && e.text !== e.was.replace(/\r\n/g, '\n')
export type PanelApi = {
  files: () => Promise<FileList>
  newFile: (path: string, dir: boolean) => Promise<string> // the path made
  openFile: (path: string) => void // in the editor
  preview: (path: string, line?: number) => void // in the app
  changes: () => Promise<Changes>
  read: (path: string, base?: boolean) => Promise<FileContent> // base: as it was where the changes start (an image)
  threads: () => Promise<Thread[]>
  comment: (c: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => Promise<unknown> // on the PR, at a diff line
  toAgent: (text: string) => Promise<unknown> // to the workspace's agent, when its turn ends
  saveImage: (base64png: string) => Promise<string> // its path, for a prompt
  toPrompt: (text: string) => Promise<unknown> // into the workspace's agent's prompt, no Enter: the user finishes it
  menu: (e: MouseEvent, path: string, dir: boolean) => void // right click on a file or folder: Open in…
}

export const PANEL_WIDTH = 340
const TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'changes', label: 'Changes', icon: 'changes' },
  { id: 'review', label: 'Review', icon: 'review' },
  { id: 'preview', label: 'Preview', icon: 'globe' },
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
              <div key={f} className={`sp-row ${sel === f ? 'sel' : ''}`} data-tip={f} onClick={() => (setSel(f), api.preview(f))} onContextMenu={e => (setSel(f), api.menu(e, f, false))}>
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
                onClick={e => (setSel(n.path), n.dir ? toggle(n.path) : e.detail < 2 && api.preview(n.path))} // a double-click's second opens the editor
                onDoubleClick={() => !n.dir && api.openFile(n.path)}
                onContextMenu={e => (setSel(n.path), api.menu(e, n.path, n.dir))}
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

// a diff line with its line numbers: old (the base's) and new (the branch's); a hunk header has neither
type DiffLine = { text: string; old?: number; new?: number }

// a comment on one diff line: to the PR on GitHub, or to the workspace's agent. The text lives in ChangesTab: a
// refresh can move the line, and the box with it.
function CommentBox({ path, line, text, setText, pr, api, onClose }: { path: string; line: DiffLine; text: string; setText: (t: string) => void; pr?: number; api: PanelApi; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const n = line.new ?? line.old!
  const go = (f: () => Promise<unknown>) => {
    if (busy || !text.trim()) return
    setBusy(true)
    setErr('')
    f().then(onClose, e => (setErr(String(e?.message ?? e)), setBusy(false)))
  }
  const toPR = () => pr && go(() => api.comment({ path, line: n, side: line.new === undefined ? 'LEFT' : 'RIGHT', body: text }))
  const toAgent = () => go(() => api.toAgent(`About ${path}, line ${n}${line.new === undefined ? ' (removed)' : ''}: \`${line.text.slice(1).trim()}\`\n\n${text}`))
  return (
    <div className="dl-comment" onClick={e => e.stopPropagation()}>
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder={`A comment on line ${n} · ⌘⏎ ${pr ? 'posts it' : 'sends it to the agent'}`}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter' && e.metaKey) pr ? toPR() : toAgent()
        }}
      />
      {err && <div className="warn small">{err}</div>}
      <div className="row">
        {pr ? (
          <button className="primary" disabled={busy || !text.trim()} onClick={toPR}>
            Comment on PR #{pr}
          </button>
        ) : (
          <span className="muted small">No PR yet</span>
        )}
        <button disabled={busy || !text.trim()} onClick={toAgent}>
          Send to the agent
        </button>
        <span className="grow" />
        <button className="link small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// an image the changes touched, before and after side by side (one side when it's new or gone), each with its size in
// pixels and bytes; a click shows it full size. An SVG is an <img> too: never markup in the page
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
function ImageDiff({ api, path, status }: { api: PanelApi; path: string; status: string }) {
  const s = status[0] === '?' ? 'A' : status[0]
  const [sides, setSides] = useState<[string, FileContent | string][]>([])
  const [zoom, setZoom] = useState<string | null>(null)
  useEffect(() => {
    const want: [string, Promise<FileContent> | null][] = [
      ['before', s === 'A' || s === 'R' ? null : api.read(path, true)], // a rename's old path isn't known here
      ['after', s === 'D' ? null : api.read(path)],
    ]
    let live = true
    Promise.all(want.filter(([, p]) => p).map(([label, p]) => p!.then(c => [label, c] as [string, FileContent], e => [label, (e as Error).message] as [string, string]))).then(r => live && setSides(r))
    return () => void (live = false)
  }, [path, s])
  useEffect(() => {
    if (!zoom) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setZoom(null))
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [zoom])
  return (
    <div className="img-diff">
      {!sides.length && <span className="muted small pad">Loading…</span>}
      {sides.map(([label, c]) => (
        <ImageSide key={label} label={label} c={c} onZoom={setZoom} />
      ))}
      {zoom && (
        <div className="img-zoom" onClick={() => setZoom(null)} data-tip="Click or Esc to close">
          <img src={zoom} alt={path} />
        </div>
      )}
    </div>
  )
}

function ImageSide({ label, c, onZoom }: { label: string; c: FileContent | string; onZoom: (src: string) => void }) {
  const [px, setPx] = useState('')
  if (typeof c === 'string' || !c.image)
    return (
      <figure className="img-side">
        <span className="muted small">{typeof c === 'string' ? c : `too big to show (${sizeText(c.size)})`}</span>
        <figcaption className="muted small">{label}</figcaption>
      </figure>
    )
  return (
    <figure className="img-side">
      <img src={c.image} alt={label} onLoad={e => setPx(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight} · `)} onClick={() => onZoom(c.image!)} />
      <figcaption className="muted small">
        {label} · {px}
        {sizeText(c.size)}
      </figcaption>
    </figure>
  )
}

function ChangesTab({ api, ws, pr }: { api: PanelApi; ws: string; pr?: number }) {
  const [d, err, reload] = useLoad(api.changes, ws, 8000)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [at, setAt] = useState<{ path: string; line: DiffLine; text: string } | null>(null) // the line being commented on, as it was
  useEffect(() => (setOpen(new Set()), setAt(null)), [ws])
  const byFile = useMemo(() => {
    const m = new Map<string, DiffLine[]>()
    let cur: DiffLine[] | null = null
    let old = 0
    let now = 0
    for (const l of d?.diff.split('\n') ?? []) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l)
      if (l.startsWith('diff --git ')) m.set(fileOf(l), (cur = []))
      else if (!cur || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(l)) continue
      else if (h) (old = +h[1]), (now = +h[2]), cur.push({ text: l })
      else if (l[0] === '+') cur.push({ text: l, new: now++ })
      else if (l[0] === '-') cur.push({ text: l, old: old++ })
      else if (l[0] === ' ') cur.push({ text: l, old: old++, new: now++ })
      else cur.push({ text: l }) // \ No newline at end of file
    }
    return m
  }, [d])
  const same = (a: DiffLine, b: DiffLine) => a.old === b.old && a.new === b.new && a.text === b.text
  // a click (not a drag that selects text) on a line opens its comment box
  const pick = (path: string, l: DiffLine) => (l.old ?? l.new) !== undefined && !window.getSelection()?.toString() && setAt(a => (a?.path === path && same(a.line, l) ? null : { path, line: l, text: '' }))
  // where the box goes after a refresh: under its line, else (the line changed) at the end of the file's diff
  const boxAt = (path: string, lines: DiffLine[]) => {
    if (at?.path !== path) return -1
    const i = lines.findIndex(l => same(l, at.line))
    return i < 0 ? lines.length - 1 : i
  }
  const toggle = (p: string) => setOpen(o => (o.has(p) ? (o.delete(p), new Set(o)) : new Set(o.add(p))))
  const files = d?.files ?? []
  return (
    <>
      <div className="sp-tools">
        <span className="muted small grow">{d ? `${files.length} file${files.length === 1 ? '' : 's'} changed vs ${d.base}${files.length ? ' · click a line to comment' : ''}` : 'Loading…'}</span>
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
              {f.add !== undefined && !IMAGE.test(f.path) /* git counts no lines in an image */ && (
                <span className="mono small">
                  <span className="add">+{f.add}</span> <span className="del">−{f.del ?? 0}</span>
                </span>
              )}
            </div>
            {open.has(f.path) && IMAGE.test(f.path) && <ImageDiff api={api} path={f.path} status={f.status} />}
            {open.has(f.path) && !IMAGE.test(f.path) && (
              <div className="sp-diff">
                {(lines => {
                  const box = boxAt(f.path, lines)
                  return lines.map((l, i) => (
                    <Fragment key={i}>
                      <div
                        className={`dl ${l.text.startsWith('@@') ? 'dl-hunk' : l.new === undefined && l.old !== undefined ? 'dl-del' : l.old === undefined && l.new !== undefined ? 'dl-add' : ''}${(l.old ?? l.new) !== undefined ? ' dl-line' : ''}`}
                        onClick={() => pick(f.path, l)}
                      >
                        {l.text || ' '}
                      </div>
                      {at && i === box && <CommentBox path={f.path} line={at.line} text={at.text} setText={text => setAt(a => a && { ...a, text })} pr={pr} api={api} onClose={() => setAt(null)} />}
                    </Fragment>
                  ))
                })(byFile.get(f.path) ?? [{ text: '(no text diff: binary, or past the size cap)' }])}
                {f.status[0] !== 'D' && (
                  <span className="row">
                    <button className="link small" onClick={() => api.preview(f.path)}>
                      show the file
                    </button>
                    <button className="link small" onClick={() => api.openFile(f.path)}>
                      open in the editor
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function ReviewTab(p: { w: WsInfo; api: PanelApi; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onFix: (what: FixWhat) => void }) {
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
              <div className="sp-thread-head mono small" onClick={() => p.api.preview(t.path, t.line)} data-tip="Show the file">
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
  onFix: (what: FixWhat) => void
}) {
  const tabs = TABS.filter(t => p.git || t.id === 'files' || t.id === 'preview')
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
          <button key={t.id} className={t.id === tab ? 'on' : ''} data-tip={t.label} onClick={() => p.onTab(t.id)}>
            <Icon name={t.icon} /> <span className="sp-tab-label">{t.label}</span>
          </button>
        ))}
        <span className="grow" />
        <IconButton icon="x" title="Close (⌥⌘B)" onClick={p.onClose} />
      </div>
      {tab === 'files' && <Files api={p.api} ws={p.w.id} />}
      {tab === 'changes' && <ChangesTab api={p.api} ws={p.w.id} pr={p.w.pr?.number} />}
      {tab === 'review' && <ReviewTab w={p.w} api={p.api} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} />}
      {tab === 'preview' && <PreviewTab key={p.w.id} w={p.w} api={p.api} onOpen={p.onOpen} />}
    </div>
  )
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/ // main's will-attach-webview takes only these
const canFrame = !bridge && ['localhost', '127.0.0.1'].includes(location.hostname) // a browser on this Mac: an iframe

// Preview: the workspace's dev server in the panel. In the app a <webview> (no node, no preload; main keeps it to
// localhost), with back, forward and a screenshot for the agent; in a browser on this Mac an iframe.
// ponytail: ⌘ keys don't reach the app while the page has the focus (the guest gets them)
function PreviewTab({ w, api, onOpen }: { w: WsInfo; api: PanelApi; onOpen: (url: string) => void }) {
  const ports = [...new Set([w.port, ...(w.ports ?? [])])] // $PORT first
  const [port, setPort] = useState(ports[0])
  const [addr, setAddr] = useState('/') // the address bar: a path on the port, or a whole URL
  const [url, setUrl] = useState(`http://localhost:${ports[0]}/`) // what's shown
  const [n, setN] = useState(0) // the iframe's reloads
  const [err, setErr] = useState('')
  const [shot, setShot] = useState<{ data: string; url: string } | null>(null)
  const [picking, setPicking] = useState(0) // a pick in progress (its number: a later one wins)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<any>(null) // the webview element
  // its methods throw until it's attached and ready
  const on = (f: (v: any) => unknown) => {
    try {
      return view.current && f(view.current)
    } catch {}
  }
  const load = (u: string) => {
    if (!LOCAL.test(u)) return /^https?:\/\//.test(u) && onOpen(u) // elsewhere: the browser
    setErr('')
    setUrl(u)
    if (view.current && on(v => v.loadURL(u).catch(() => {})) === undefined) view.current.setAttribute('src', u) // a failure comes as did-fail-load
  }
  // a path on the port, a whole URL, or localhost:5173/x without the http://
  const go = (p = port, a = addr.trim()) => load(/^https?:\/\//.test(a) ? a : LOCAL.test(`http://${a}`) ? `http://${a}` : `http://localhost:${p}${a.startsWith('/') ? a : `/${a}`}`)
  useEffect(() => {
    if (!bridge || !host.current) return
    const v = document.createElement('webview') as any
    v.setAttribute('src', url)
    v.setAttribute('partition', 'persist:preview') // its own cookies, kept: a dev app's sign-in stays
    v.className = 'web-view'
    const at = (e: any) => {
      setUrl(e.url)
      setErr('')
      const u = new URL(e.url)
      if (!LOCAL.test(e.url)) return setAddr(e.url)
      setPort(Number(u.port) || 80)
      setAddr(u.pathname + u.search + u.hash)
    }
    v.addEventListener('did-navigate', at)
    v.addEventListener('did-start-navigation', (e: any) => e.isMainFrame && !e.isInPlace && setPicking(0)) // the page's picker goes with it
    v.addEventListener('did-navigate-in-page', (e: any) => e.isMainFrame && at(e))
    v.addEventListener('did-fail-load', (e: any) => e.isMainFrame && e.errorCode !== -3 && setErr(e.errorCode === -102 ? `Nothing listens on ${new URL(e.validatedURL).host} yet: ▷ Run starts the dev server` : e.errorDescription || 'It didn’t load'))
    host.current.appendChild(v)
    view.current = v
    return () => {
      v.remove()
      view.current = null
    }
  }, [])
  const capture = () => {
    const id = on(v => v.getWebContentsId())
    if (bridge?.capture && id) bridge.capture(id).then(data => setShot({ data, url: on(v => v.getURL()) || url }), e => setErr(String(e?.message ?? e)))
  }
  // an element of the page, picked with the mouse, into the agent's prompt: what it is and where
  const pick = () => {
    if (picking) return setPicking(0), on(v => v.executeJavaScript('window.__lakiPick?.(null)').catch(() => {}))
    const id = Date.now()
    const end = () => setPicking(p => (p === id ? 0 : p))
    const r = on(v => v.executeJavaScript(`(${pickElement})()`, true)) as Promise<Picked | null> | undefined
    if (!r) return setErr('The page isn’t ready yet')
    setPicking(id)
    on(v => v.focus()) // for Esc
    r.then(async p => {
      end()
      if (!p) return
      // and a screenshot of just that element, when the app can take one
      const id = on(v => v.getWebContentsId())
      const path = bridge?.capture && id ? await bridge.capture(id).then(png => crop(png, p)).then(api.saveImage).catch(() => '') : ''
      await api.toPrompt(pickedText(p, path)).catch(e => setErr(String(e?.message ?? e)))
    }, end)
  }
  if (!bridge && !canFrame) return <div className="muted small pad">The preview shows this Mac's localhost: open {w.name || w.id} in the app there. To open a port from here, share it with the globe in the status bar.</div>
  return (
    <>
      <div className="sp-tools web-tools">
        {bridge && <IconButton icon="back" title="Back" onClick={() => on(v => v.goBack())} />}
        {bridge && <IconButton icon="forward" title="Forward" onClick={() => on(v => v.goForward())} />}
        <IconButton icon="refresh" title="Reload" onClick={() => (setErr(''), bridge ? on(v => v.reload()) : setN(x => x + 1))} />
        <select
          value={port}
          title="Port"
          onChange={e => {
            setPort(Number(e.target.value))
            setAddr('/')
            go(Number(e.target.value), '/')
          }}
        >
          {[...new Set([...ports, port])].map(x => (
            <option key={x} value={x}>
              :{x}
            </option>
          ))}
        </select>
        <input value={addr} spellCheck={false} onChange={e => setAddr(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        {bridge && <IconButton icon="pick" title={picking ? 'Picking: click an element (Esc stops)' : "Pick an element: its CSS selector into the agent's prompt"} on={!!picking} onClick={pick} />}
        {bridge?.capture && <IconButton icon="camera" title="Screenshot to the agent" onClick={capture} />}
        <IconButton icon="link" title="Open in the browser" onClick={() => onOpen(url)} />
      </div>
      {shot && <ShotBox shot={shot} api={api} onClose={() => setShot(null)} />}
      {err && <div className="warn small pad">{err}</div>}
      <div className="web-body" ref={host}>
        {!bridge && <iframe key={n} className="web-view" src={url} title="Preview" />}
      </div>
    </>
  )
}

// an element the picker returned: its selector, opening tag, text, size, its HTML (cut) and computed CSS (what isn't a
// default), where it is on the page (CSS pixels, vw: the page's width), and the page
type Picked = { selector: string; tag: string; text: string; size: string; url: string; html?: string; css?: string; rect?: { x: number; y: number; w: number; h: number }; vw?: number }
const pickedText = (p: Picked, shot?: string) =>
  [
    `In the preview (${p.url}), the element \`${p.selector}\` (${[p.text && `"${p.text}"`, p.size].filter(Boolean).join(', ')}):`,
    p.html ? `HTML: ${p.html}` : p.tag,
    p.css && `CSS: ${p.css}`,
    shot && `A screenshot of it: ${shot}`,
  ]
    .filter(Boolean)
    .join('\n') + '\n'

// the element's part of the page's screenshot (its CSS pixels scaled to the image's, a little around it, inside the
// page), as base64 PNG
async function crop(png: string, p: Picked) {
  if (!p.rect || !p.vw) throw new Error('where?')
  const img = new Image()
  img.src = `data:image/png;base64,${png}`
  await img.decode()
  const k = img.naturalWidth / p.vw
  const x = Math.max(0, p.rect.x - 4)
  const y = Math.max(0, p.rect.y - 4)
  const w = Math.min(p.vw, p.rect.x + p.rect.w + 4) - x
  const h = Math.min(img.naturalHeight / k, p.rect.y + p.rect.h + 4) - y
  if (w < 2 || h < 2) throw new Error('off screen')
  const c = document.createElement('canvas')
  c.width = Math.round(w * k)
  c.height = Math.round(h * k)
  c.getContext('2d')!.drawImage(img, x * k, y * k, w * k, h * k, 0, 0, c.width, c.height)
  return c.toDataURL('image/png').split(',')[1]
}

// runs in the preview's page (executeJavaScript, as its source: it uses nothing from here): outlines what's under the
// mouse with its selector, and resolves with the one clicked, or null on Esc or window.__lakiPick(null) (the app's)
// ponytail: a selector made of ids, test ids, classes (generated-looking ones skipped) and :nth-of-type, short of a
// unique one; frames and shadow roots aren't entered
function pickElement(): Promise<Picked | null> {
  return new Promise(done => {
    const w = window as any
    w.__lakiPick?.(null)
    const box = document.createElement('div')
    const label = document.createElement('div')
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;background:rgba(76,141,255,.14);border-radius:2px'
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;font:11px/1.5 ui-monospace,Menlo,monospace;background:#4c8dff;color:#fff;padding:0 6px;border-radius:3px;white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis'
    document.documentElement.append(box, label)
    const esc = (s: string) => CSS.escape(s)
    const one = (s: string) => {
      try {
        return document.querySelectorAll(s).length === 1
      } catch {
        return false
      }
    }
    const fine = (c: string) => /^[a-zA-Z_-][\w-]*$/.test(c) && c.length < 32 && !/\d{3}|^(css|sc|jsx|svelte|emotion|chakra)-/.test(c) // not generated
    const selector = (el: Element) => {
      if (el.id && one(`#${esc(el.id)}`)) return `#${esc(el.id)}`
      for (const a of ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name']) {
        const v = el.getAttribute(a)
        const s = v && `${esc(el.localName)}[${a}="${v.replace(/["\\]/g, '\\$&')}"]`
        if (s && one(s)) return s
      }
      const parts: string[] = []
      for (let e: Element | null = el; e; e = e.parentElement) {
        if (e !== el && e.id && one(`#${esc(e.id)}`)) {
          parts.unshift(`#${esc(e.id)}`)
          break
        }
        let p = esc(e.localName) + [...e.classList].filter(fine).slice(0, 2).map(c => `.${esc(c)}`).join('')
        const kin = e.parentElement ? [...e.parentElement.children] : []
        if (kin.filter(x => x.matches(p)).length > 1) p += `:nth-of-type(${kin.filter(x => x.localName === e!.localName).indexOf(e) + 1})`
        parts.unshift(p)
        if (one(parts.join(' > '))) break
      }
      return parts.join(' > ')
    }
    let cur: Element | null = null
    let sel = ''
    const place = () => {
      if (!cur) return
      const r = cur.getBoundingClientRect()
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
      label.textContent = `${sel}  ${Math.round(r.width)}×${Math.round(r.height)}`
      Object.assign(label.style, { left: `${Math.max(0, r.left)}px`, top: `${r.top > 22 ? r.top - 20 : r.bottom + 2}px` })
    }
    const move = (e: globalThis.MouseEvent) => {
      const el = e.target
      if (!(el instanceof Element)) return
      if (el !== cur) (cur = el), (sel = selector(el)) // the selector only when it changes: it queries the page
      place()
    }
    const stop = (e: Event) => (e.preventDefault(), e.stopPropagation()) // the page's own handlers don't see it
    const finish = (v: Picked | null) => {
      removeEventListener('mousemove', move, true)
      removeEventListener('scroll', place, true)
      for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) removeEventListener(t, stop, true)
      removeEventListener('click', click, true)
      removeEventListener('keydown', key, true)
      box.remove()
      label.remove()
      delete w.__lakiPick
      if (v) requestAnimationFrame(() => requestAnimationFrame(() => done(v))) // painted without the outline: the app's screenshot of it is clean
      else done(v)
    }
    const click = (e: globalThis.MouseEvent) => {
      stop(e)
      const el = e.target as Element
      const r = el.getBoundingClientRect()
      const tag = (el.cloneNode(false) as Element).outerHTML.replace(/<\/[^>]+>$/, '').replace(/\s+/g, ' ')
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ')
      const html = el.outerHTML.replace(/\s+/g, ' ')
      const cs = getComputedStyle(el)
      const css = CSS_KEYS.map(k => [k, cs.getPropertyValue(k)])
        .filter(([, v]) => v && !/^(none|normal|auto|static|visible|0px|1|rgba\(0, 0, 0, 0\)|0px none .*)$/.test(v))
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
      finish({
        selector: selector(el),
        tag: tag.length > 200 ? `${tag.slice(0, 199)}…` : tag,
        text: text.length > 120 ? `${text.slice(0, 119)}…` : text,
        size: `${Math.round(r.width)}×${Math.round(r.height)}`,
        url: location.href,
        html: html.length > 1500 ? `${html.slice(0, 1499)}…` : html,
        css,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        vw: innerWidth,
      })
    }
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && (stop(e), finish(null))
    // the computed styles worth telling an agent (in here: the function goes to the page as its source)
    const CSS_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'border', 'border-radius', 'box-shadow', 'gap', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'overflow', 'opacity', 'z-index']
    addEventListener('mousemove', move, true)
    addEventListener('scroll', place, true) // the box follows what it outlines
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) addEventListener(t, stop, true)
    addEventListener('click', click, true)
    addEventListener('keydown', key, true)
    w.__lakiPick = finish
  })
}

// a preview's screenshot on its way to the agent, with what to say about it
function ShotBox({ shot, api, onClose }: { shot: { data: string; url: string }; api: PanelApi; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = () => {
    if (busy) return
    setBusy(true)
    api
      .saveImage(shot.data)
      .then(path => api.toAgent(`${text.trim() || 'Here is how the page looks now.'}\n\nA screenshot of ${shot.url}: ${path}`))
      .then(onClose, e => (setErr(String(e?.message ?? e)), setBusy(false)))
  }
  return (
    <div className="dl-comment web-shot">
      <img src={`data:image/png;base64,${shot.data}`} alt="The screenshot" />
      <textarea
        autoFocus
        rows={2}
        value={text}
        placeholder="What should the agent do about it? · ⌘⏎ sends"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => (e.key === 'Escape' ? onClose() : e.key === 'Enter' && e.metaKey && send())}
      />
      {err && <div className="warn small">{err}</div>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={send}>
          Send to the agent
        </button>
        <span className="grow" />
        <button className="link small" onClick={onClose}>
          Cancel
        </button>
      </div>
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

// Run ▾'s two groups of actions (actionsFor's); tabName: a tab's name, for the hint; run: the app sends it
export function actionMenu({ agent, terminal }: ReturnType<typeof actionsFor>, tabName: (id: string) => string | undefined, run: (a: RunAction, tab?: string) => void): MenuItem[] {
  const item = (a: RunAction, tab: string | undefined, hint: string): MenuItem => ({ label: a.name, icon: a.target === 'shell' ? 'terminal' : 'agent', hint, run: () => run(a, tab) })
  return [
    ...(agent.length ? [null, { head: 'Agent actions' }, ...agent.map(x => item(x.action, x.tab, tabName(x.tab) ?? x.action.target))] : []),
    ...(terminal.length ? [null, { head: 'Terminal actions' }, ...terminal.map(x => item(x.action, x.tab, (x.tab && tabName(x.tab)) || (x.tab ? 'shell' : 'new shell')))] : []),
  ]
}

const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`)

// a file in the app, next to the panel: text with line numbers, an image, or what it is
export function FilePreview(p: {
  path: string
  line?: number
  load: () => Promise<FileContent>
  onOpen: () => void
  onClose: () => void
  edit?: Edit // being edited (the pencil): a textarea instead of the lines
  onEdit: (e?: Edit) => void
  save: (text: string, was: string, force?: boolean) => Promise<unknown> // over the file, unless it changed since was
}) {
  const [f, setF] = useState<FileContent | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  const [saving, setSaving] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const top = useRef(0) // where the lines were scrolled, kept into the edit and back
  const load = useRef(p.load)
  load.current = p.load
  useEffect(() => {
    let alive = true
    setErr('')
    load.current().then(x => alive && setF(x), e => alive && (setF(null), setErr(String(e?.message ?? e))))
    return () => void (alive = false)
  }, [p.path, n])
  useLayoutEffect(() => {
    if (p.line && !top.current) body.current?.querySelector('.pv-line.at')?.scrollIntoView({ block: 'center' })
    else body.current?.scrollTo(0, top.current)
  }, [f, p.line])
  useLayoutEffect(() => void (p.edit ? area.current?.scrollTo(0, top.current) : body.current?.scrollTo(0, top.current)), [!!p.edit])
  const name = p.path.slice(p.path.lastIndexOf('/') + 1)
  // edit: small tweaks, no more (no completion); only what the preview shows whole and as its bytes
  const editable = f?.text !== undefined && !f.cut && !f.lossy && !(f.text.includes('\r\n') && /(^|[^\r])\n/.test(f.text)) // mixed line ends: one kind would replace both
  const startEdit = () => {
    top.current = body.current?.scrollTop ?? 0
    p.onEdit({ text: f!.text!.replace(/\r\n/g, '\n'), was: f!.text! })
  }
  const stopEdit = () => {
    top.current = area.current?.scrollTop ?? top.current
    p.onEdit(undefined)
  }
  const cancel = async () => (!edited(p.edit) || (await ask(`Discard your changes to ${name}?`, { ok: 'Discard', danger: true }))) && stopEdit()
  const save = async () => {
    const e = p.edit
    if (!e || saving) return
    if (!edited(e)) return stopEdit()
    const text = e.was.includes('\r\n') ? e.text.replace(/\n/g, '\r\n') : e.text // its line ends kept
    setSaving(true)
    setErr('')
    try {
      await p.save(text, e.was).catch(async (x: Error) => {
        // an agent (or anyone) changed it meanwhile: theirs goes only if you say so
        if (!/changed since/.test(x.message) || !(await ask(`${name} changed since you opened it`, { text: 'Save yours over it? What changed there is lost.', ok: 'Save over it', danger: true }))) throw x
        return p.save(text, e.was, true)
      })
      stopEdit()
      setN(x => x + 1)
    } catch (x) {
      setErr(String((x as Error)?.message ?? x))
    } finally {
      setSaving(false)
    }
  }
  // Markdown: Rendered or Raw (the last one picked; a jump to a line: Raw)
  const md = /\.(md|markdown|mdx)$/i.test(p.path)
  const [mode, setMode] = useState<'raw' | 'rendered'>(() => (p.line ? 'raw' : (localStore('laki.md') as 'raw') || 'rendered'))
  const rendered = md && mode === 'rendered' && f?.text !== undefined
  const pickMode = (m: typeof mode) => (setMode(m), localStore('laki.md', m))
  const lines = useMemo(() => (f?.text === undefined || rendered || p.edit ? [] : highlight(p.path, f.text)), [f, p.path, rendered, !!p.edit]) // colored up to 50 KB
  const cut = p.path.lastIndexOf('/') + 1
  return (
    <div className="preview">
      <div className="pv-head">
        <Icon name="file" />
        <span className="pv-path" data-tip={p.path}>
          {p.path.slice(cut)} <span className="muted">{p.path.slice(0, cut)}</span>
        </span>
        {f && <span className="muted small pv-wide">{sizeText(f.size)}</span>}
        {p.edit ? (
          <>
            <button className="small" disabled={saving} onClick={cancel}>
              Cancel
            </button>
            <button className="small primary" disabled={saving} data-tip="⌘S" onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
        {md && f?.text !== undefined && (
          <div className="seg small">
            <button className={mode === 'rendered' ? 'on' : ''} onClick={() => pickMode('rendered')}>
              Rendered
            </button>
            <button className={mode === 'raw' ? 'on' : ''} onClick={() => pickMode('raw')}>
              Raw
            </button>
          </div>
        )}
        {editable && <IconButton icon="pencil" title="Edit here: small changes, ⌘S saves" onClick={startEdit} />}
        <IconButton icon="refresh" title="Reload" onClick={() => setN(x => x + 1)} />
        <button className="small" data-tip="Open in editor" onClick={p.onOpen}>
          <Icon name="code" />
          <span className="pv-wide"> Open in editor</span>
        </button>
          </>
        )}
        <IconButton icon="x" title="Close (⌘W)" onClick={p.onClose} />
      </div>
      {err && p.edit && <div className="warn small pad">{err}</div>}
      {p.edit ? (
        <textarea
          ref={area}
          className="pv-edit"
          value={p.edit.text}
          wrap="off"
          spellCheck={false}
          autoFocus
          onChange={e => p.onEdit({ ...p.edit!, text: e.target.value })}
          onKeyDown={e => {
            if (e.key === 's' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save())
            else if (e.key === 'Escape') (e.preventDefault(), cancel())
          }}
        />
      ) : (
      <div className="pv-body" ref={body}>
        {err && <div className="warn small pad">{err}</div>}
        {f?.image && (
          <div className="pv-image">
            <img src={f.image} alt={p.path} />
          </div>
        )}
        {rendered && <Markdown src={f.text!} />}
        {f?.text !== undefined &&
          lines.map((l, i) => (
            <div key={i} className={`pv-line ${p.line === i + 1 ? 'at' : ''}`}>
              <span className="pv-n">{i + 1}</span>
              {l.length ? l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t)) : ' '}
            </div>
          ))}
        {f?.cut && <div className="muted small pad">Showing the start of the file. Open it in the editor for the rest.</div>}
        {f && f.text === undefined && !f.image && <div className="muted small pad">Not shown here ({sizeText(f.size)}): open it in the editor or Finder.</div>}
      </div>
      )}
    </div>
  )
}

// localStorage, or nothing (a private window, blocked storage)
function localStore(k: string, v?: string) {
  try {
    if (v === undefined) return localStorage.getItem(k)
    localStorage.setItem(k, v)
  } catch {}
  return null
}

// a Markdown file as the page it's written to be (markdown.ts' tree, as React nodes: nothing in it is HTML); links
// open in the browser, images show as links (a preview fetches nothing)
function Markdown({ src }: { src: string }) {
  const tree = useMemo(() => markdown(src), [src])
  return <div className="md">{tree.map(mdBlock)}</div>
}
function mdBlock(b: Block, k: number): React.ReactNode {
  switch (b.t) {
    case 'h': {
      const H = `h${b.level}` as 'h1'
      return <H key={k}>{b.inl.map(mdInline)}</H>
    }
    case 'p':
      return <p key={k}>{b.inl.map(mdInline)}</p>
    case 'hr':
      return <hr key={k} />
    case 'quote':
      return <blockquote key={k}>{b.blocks.map(mdBlock)}</blockquote>
    case 'code':
      return (
        <pre key={k}>
          <code>
            {highlight(`x.${b.lang || 'txt'}`, b.text).map((l, i) => (
              <Fragment key={i}>
                {i > 0 && '\n'}
                {l.map(([c, t], j) => (c ? <span key={j} className={c}>{t}</span> : t))}
              </Fragment>
            ))}
          </code>
        </pre>
      )
    case 'list': {
      const items = b.items.map((it, i) => {
        const box = it.task !== undefined && <input key="box" type="checkbox" checked={it.task} readOnly />
        const [first, ...more] = it.blocks
        return (
          <li key={i} className={it.task !== undefined ? 'task' : undefined}>
            {/* one paragraph: a tight list's line, no paragraph's margins; a task's box goes in its first line */}
            {first?.t !== 'p' ? (
              [box, ...it.blocks.map(mdBlock)]
            ) : more.length ? (
              <>
                <p>
                  {box}
                  {first.inl.map(mdInline)}
                </p>
                {more.map(mdBlock)}
              </>
            ) : (
              [box, ...first.inl.map(mdInline)]
            )}
          </li>
        )
      })
      return b.ordered ? (
        <ol key={k} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={k}>{items}</ul>
      )
    }
    case 'table':
      return (
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={{ textAlign: b.align[i] || undefined }}>
                    {c.map(mdInline)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {b.head.map((_, j) => (
                    <td key={j} style={{ textAlign: b.align[j] || undefined }}>
                      {(r[j] ?? []).map(mdInline)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}
function mdInline(x: Inline, k: number): React.ReactNode {
  if (typeof x === 'string') return x
  switch (x.t) {
    case 'code':
      return <code key={k}>{x.text}</code>
    case 'b':
      return <strong key={k}>{x.kids.map(mdInline)}</strong>
    case 'i':
      return <em key={k}>{x.kids.map(mdInline)}</em>
    case 's':
      return <del key={k}>{x.kids.map(mdInline)}</del>
    case 'br':
      return <br key={k} />
    case 'a':
    case 'img': {
      const href = x.t === 'a' ? x.href : x.src
      const web = /^(https?:|mailto:)/i.test(href) // a relative one is a file of the repo: shown, not followed
      const kids = x.t === 'a' ? x.kids.map(mdInline) : `🖼 ${x.alt || 'image'}`
      return (
        <a key={k} href={web ? href : undefined} data-tip={href} onClick={e => (e.preventDefault(), web && openExternal(href))}>
          {kids}
        </a>
      )
    }
  }
}

// q's characters in order in s, case aside: a score (contiguous runs and word starts count more) and
// where they matched; null when they don't
function match(q: string, s: string) {
  const ls = s.toLowerCase()
  const hits: number[] = []
  let score = 0
  let j = 0
  for (const c of q) {
    j = ls.indexOf(c, j)
    if (j < 0) return null
    const start = j === 0 || '/_-. '.includes(s[j - 1]) || (s[j] !== ls[j] && s[j - 1] === ls[j - 1])
    score += 1 + (hits.at(-1) === j - 1 ? 3 : 0) + (start ? 2 : 0)
    hits.push(j++)
  }
  return { score, hits }
}

// the files matching q best: its letters in the file name first, else anywhere in the path
// ponytail: greedy first match per letter, not the best alignment; fine for picking files
export function findFiles(q: string, files: string[], max = 60) {
  q = q.toLowerCase().replace(/\s+/g, '')
  if (!q) return files.slice(0, max).map(path => ({ path, hits: [] as number[] }))
  const out: { path: string; hits: number[]; score: number }[] = []
  for (const path of files) {
    const at = path.lastIndexOf('/') + 1
    const b = match(q, path.slice(at))
    const m = b ? { score: b.score * 2 + 10, hits: b.hits.map(h => h + at) } : match(q, path)
    if (m) out.push({ path, hits: m.hits, score: m.score - path.length * 0.02 })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}

// ⌘P: find a file in the workspace by a few letters of its name or path
export function FileFinder(p: { files: () => Promise<FileList>; onPick: (path: string) => void; onClose: () => void }) {
  const [all, setAll] = useState<string[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => void p.files().then(f => setAll(f?.files ?? []), e => setErr(String(e?.message ?? e))), [])
  const found = useMemo(() => findFiles(q, all ?? []), [q, all])
  useEffect(() => setI(0), [q])
  useEffect(() => list.current?.querySelector('.ff-item.sel')?.scrollIntoView({ block: 'nearest' }), [i])
  const pick = (path?: string) => path && (p.onClose(), p.onPick(path))
  const mark = (path: string, hits: number[]) => {
    const at = path.lastIndexOf('/') + 1
    const span = (from: number, to: number) =>
      [...path.slice(from, to)].map((c, k) => (hits.includes(from + k) ? <b key={k}>{c}</b> : c))
    return (
      <>
        <span className="ff-name">{span(at, path.length)}</span> <span className="muted">{span(0, at)}</span>
      </>
    )
  }
  return (
    <div className="overlay top" onMouseDown={e => e.target === e.currentTarget && p.onClose()}>
      <div className="finder" role="dialog" aria-label="Find a file">
        <input
          autoFocus
          value={q}
          placeholder={all ? `Find a file (${all.length.toLocaleString()} files)` : 'Find a file…'}
          spellCheck={false}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setI(x => Math.max(0, Math.min(found.length - 1, x + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter') {
              e.preventDefault() // or its keypress reaches the terminal focused after the finder closes
              pick(found[i]?.path)
            }
            else if (e.key === 'Escape') (e.stopPropagation(), p.onClose())
          }}
        />
        <div className="ff-list" ref={list}>
          {err && <div className="warn small pad">{err}</div>}
          {!all && !err && <div className="muted small pad">Loading the files…</div>}
          {found.map((f, k) => (
            <div key={f.path} className={`ff-item ${k === i ? 'sel' : ''}`} onMouseEnter={() => setI(k)} onClick={() => pick(f.path)}>
              <Icon name="file" />
              {mark(f.path, f.hits)}
            </div>
          ))}
          {all && !found.length && <div className="muted small pad">{q ? 'No file matches.' : 'No files here.'}</div>}
        </div>
      </div>
    </div>
  )
}
