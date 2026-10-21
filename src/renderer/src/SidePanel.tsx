// The right panel (⌥⌘B): the workspace's files, its changes against the base branch, and its PR's
// checks and review comments; a phone's screen (Simulator); a file's preview, the file finder (⌘P) and the header's Run button. App.tsx
// passes in how the daemon lists, reads and makes files, opens one in the editor, diffs and reads reviews.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { bridge, openExternal } from './api'
import { highlight } from './highlight'
import { PanelHandle } from './Panes'
import { Folded, Markdown } from './MarkdownView'
import type { MergeMethod } from '../../shared/types'
import { ago, type AutoKey, Avatar, type Check, type FixWhat, type LabelApi, type PRAct, PRSection, type WsInfo } from './Info'
import { type actionsFor, csvSep, parseCsv, parseSize, previewAddr, previewUrl, type RunAction, SIZES, splitRows, toCsv } from './text'
import { ask, escapes, Icon, IconButton, type IconName, type MenuItem, useMenu } from './ui'

export type PanelTab = 'info' | 'files' | 'changes' | 'review' | 'preview' | 'device' | `ext:${string}` // ext: an extension placed in panel
export type FileList = { files: string[]; changed: Record<string, string>; cut?: boolean } // changed: M, A, D, R
export type Changes = { base: string; files: { path: string; status: string; add?: number; del?: number }[]; diff: string }
export type Thread = { path: string; line?: number; resolved: boolean; outdated: boolean; comments: { author: string; body: string; at?: string }[] } // at: an older daemon gives none
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
  prChanges: () => Promise<Changes> // the PR's whole diff, as GitHub has it
  prFiles: () => Promise<PRFiles> // its files' Viewed boxes, as you ticked them on GitHub
  setViewed: (path: string, viewed: boolean, id: string) => Promise<unknown>
  read: (path: string, base?: boolean) => Promise<FileContent> // base: as it was where the changes start (an image)
  threads: () => Promise<Thread[]>
  comment: (c: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => Promise<unknown> // on the PR, at a diff line
  toAgent: (text: string) => Promise<unknown> // to the workspace's agent, when its turn ends
  saveImage: (base64png: string) => Promise<string> // its path, for a prompt
  toPrompt: (text: string) => Promise<unknown> // into the workspace's agent's prompt, no Enter: the user finishes it
  sim: <T = unknown>(p: { op: string; device?: string; [k: string]: unknown }) => Promise<T> // the Simulator tab's: the daemon's sim
  menu: (e: MouseEvent, path: string, dir: boolean) => void // right click on a file or folder: Open in…
  // Changes › Here's Revert: a hunk (lines: indexes into its body, none: all of it) or a whole file back to the base,
  // then a toast whose Undo is redo; then: after the revert and after its Undo (a refresh)
  undoHunk: (path: string, hunk: string, lines?: number[], then?: () => void) => Promise<boolean> // false: you said no
  undoFile: (path: string, then?: () => void) => Promise<boolean>
  redo: (id: string) => Promise<unknown>
  // the workspace's Artifacts (its storage folder) as Files' other root: list, show one in the app, open it in its app,
  // its right click (Finder, copy path); none: no storage folder yet
  artifacts?: { files: () => Promise<FileList>; preview: (path: string) => void; open: (path: string) => void; menu: (e: MouseEvent, path: string) => void }
}
export type FilesRoot = 'ws' | 'artifacts'

// a PR's node id and each file's viewerViewedState: VIEWED, UNVIEWED, DISMISSED (viewed, then changed by a commit)
export type PRFiles = { id: string; files: Record<string, string> }

export const PANEL_WIDTH = 340
const TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: 'info', label: 'Info', icon: 'info' },
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'changes', label: 'Changes', icon: 'changes' },
  { id: 'review', label: 'Review', icon: 'review' },
  { id: 'preview', label: 'Preview', icon: 'globe' },
  { id: 'device', label: 'Simulator', icon: 'phone' },
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

// root: the worktree's files, or its Artifacts (read-only here: no new files; a double click opens one in its app)
function Files({ api, ws, root, onRoot }: { api: PanelApi; ws: string; root: FilesRoot; onRoot: (r: FilesRoot) => void }) {
  const art = root === 'artifacts' ? api.artifacts : undefined
  const [d, err, reload] = useLoad(art?.files ?? api.files, `${ws}:${art ? 'art' : 'ws'}`, 8000)
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
  }, [ws, !!art])
  const preview = (f: string) => (art ? art.preview(f) : api.preview(f))
  const menu = (e: MouseEvent, f: string, dir: boolean) => (art ? art.menu(e, f) : api.menu(e, f, dir))
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
      {api.artifacts && (
        <div className="seg sp-roots" role="tablist">
          <button role="tab" aria-selected={!art} className={art ? '' : 'on'} onClick={() => onRoot('ws')}>
            Workspace
          </button>
          <button role="tab" aria-selected={!!art} className={art ? 'on' : ''} data-tip="What its agents keep for you ($LAKI_STORAGE_FOLDER)" onClick={() => onRoot('artifacts')}>
            Artifacts
          </button>
        </div>
      )}
      <div className="sp-tools">
        <Icon name="search" />
        <input value={q} placeholder={art ? 'Search artifacts' : 'Search files'} spellCheck={false} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), setQ(''))} />
        {!art && <IconButton icon="filePlus" title={`New file in ${folder || 'the root'}`} onClick={() => startMaking(false)} />}
        {!art && <IconButton icon="folderPlus" title={`New folder in ${folder || 'the root'}`} onClick={() => startMaking(true)} />}
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
              <div key={f} className={`sp-row ${sel === f ? 'sel' : ''}`} data-tip={f} onClick={() => (setSel(f), preview(f))} onContextMenu={e => (setSel(f), menu(e, f, false))}>
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
                onClick={e => (setSel(n.path), n.dir ? toggle(n.path) : e.detail < 2 && preview(n.path))} // a double-click's second opens the editor
                onDoubleClick={() => !n.dir && (art ? art.open(n.path) : api.openFile(n.path))}
                onContextMenu={e => (setSel(n.path), menu(e, n.path, n.dir))}
              >
                <span className="sp-chev">{n.dir && <Icon name={open.has(n.path) ? 'chevron' : 'chevronRight'} />}</span>
                <span className="sp-name">{n.name}</span>
                {dot(n.path, n.dir)}
              </div>
            ))}
        {query && !found.length && <div className="muted small pad">No file matches.</div>}
        {art && d && !d.files.length && !query && <div className="muted small pad">Nothing kept yet: its agents save files and links here.</div>}
        {d?.cut && <div className="muted small pad">Showing the first 50,000 files.</div>}
      </div>
    </>
  )
}

// the diff of one file, without its header lines
const fileOf = (l: string) => l.match(/ b\/(.*)$/)?.[1] ?? ''

// a diff line with its line numbers: old (the base's) and new (the branch's); a hunk header has neither. hunk: which
// of the file's hunks it's in, at: its index in that hunk's body (the hunk header has none)
type DiffLine = { text: string; old?: number; new?: number; hunk?: number; at?: number }
// a file's diff lines and its hunks' raw text (the @@ line and its body, as Revert sends it); cut: the diff's size cap
// ran into it
type FileDiff = { lines: DiffLine[]; hunks: string[]; cut?: boolean }
const CUT = '\n… (cut)'
// lines picked for Revert (⌥-click, ⇧-click a range): one hunk's, by their index in its body; last: where ⇧ starts
type Picks = { path: string; hunk: number; text: string; at: number[]; last: number }
const changeLine = (l: DiffLine) => (l.old === undefined) !== (l.new === undefined) // a + or - line

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

// whole: the PR's diff (gh pr diff) instead of the workspace's; first for a workspace that only links its PR
function ChangesTab({ api, ws, pr, linked, onOpen }: { api: PanelApi; ws: string; pr?: { number: number; url: string }; linked?: boolean; onOpen: (url: string) => void }) {
  const [whole, setWhole] = useState<boolean | null>(null) // null: as linked says (its PR may come after the panel opens)
  const all = !!pr && (whole ?? !!linked)
  const [d, err, reload] = useLoad(all ? api.prChanges : api.changes, `${ws}#${all}`, all ? 60000 : 8000) // gh's: once a minute
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [at, setAt] = useState<{ path: string; line: DiffLine; text: string } | null>(null) // the line being commented on, as it was
  useEffect(() => (setOpen(new Set()), setAt(null)), [ws, all])
  const byFile = useMemo(() => {
    const m = new Map<string, FileDiff>()
    let cur: FileDiff | null = null
    let old = 0
    let now = 0
    let last = ''
    let at = 0 // a line's index in its hunk's body
    const text = d?.diff ?? ''
    for (const l of (text.endsWith(CUT) ? text.slice(0, -CUT.length) : text).split('\n')) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l)
      const hunk = cur ? cur.hunks.length - 1 : -1
      if (l.startsWith('diff --git ')) m.set((last = fileOf(l)), (cur = { lines: [], hunks: [] }))
      else if (!cur || (hunk < 0 && !h)) continue // its header: index, ---, +++, new file, rename… (a body line can start with --- too)
      else if (h) (old = +h[1]), (now = +h[2]), (at = 0), cur.hunks.push(l), cur.lines.push({ text: l, hunk: hunk + 1 })
      else {
        cur.hunks[hunk] += '\n' + l
        if (l[0] === '+') cur.lines.push({ text: l, new: now++, hunk, at: at++ })
        else if (l[0] === '-') cur.lines.push({ text: l, old: old++, hunk, at: at++ })
        else if (l[0] === ' ') cur.lines.push({ text: l, old: old++, new: now++, hunk, at: at++ })
        else cur.lines.push({ text: l, hunk, at: at++ }) // \ No newline at end of file
      }
    }
    const lastOne = m.get(last)
    if (text.endsWith(CUT) && lastOne) lastOne.cut = true // its hunks may be whole only in part: no Revert but the file's
    return m
  }, [d])
  // Revert's picks: a refresh that changes their hunk drops them
  const [picks, setPicks] = useState<Picks | null>(null)
  useEffect(() => setPicks(p => (p && byFile.get(p.path)?.hunks[p.hunk] === p.text ? p : null)), [byFile])
  useEffect(() => setPicks(null), [ws, all])
  useEffect(() => {
    if (!picks) return
    // Esc drops them, before a terminal with the keyboard gets it (its agent would stop)
    const f = (e: KeyboardEvent) => escapes(e) && (e.stopPropagation(), e.preventDefault(), setPicks(null)) // not a dialog's (Revert's ask): it keeps them
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [!!picks])
  // ⌥-click toggles a + or - line, ⇧-click picks the range from the last pick (one hunk's: another's starts over)
  const pickLine = (path: string, l: DiffLine, range: boolean) => {
    const text = byFile.get(path)?.hunks[l.hunk!]
    if (text === undefined || l.at === undefined) return
    setPicks(p => {
      const here = p && p.path === path && p.hunk === l.hunk ? p : null
      if (!here || !range) {
        const at = here?.at.includes(l.at!) ? here.at.filter(x => x !== l.at) : [...(here?.at ?? []), l.at!]
        return at.length ? { path, hunk: l.hunk!, text, at, last: l.at! } : null
      }
      const [a, b] = [Math.min(here.last, l.at!), Math.max(here.last, l.at!)]
      const span = (byFile.get(path)?.lines ?? []).filter(x => x.hunk === l.hunk && x.at !== undefined && x.at >= a && x.at <= b && changeLine(x)).map(x => x.at!)
      return { ...here, at: [...new Set([...here.at, ...span])], last: l.at! }
    })
  }
  const picked = (path: string, l: DiffLine) => !!picks && picks.path === path && picks.hunk === l.hunk && l.at !== undefined && picks.at.includes(l.at)
  const [busyRevert, setBusyRevert] = useState(false)
  const revert = (f: () => Promise<boolean>) => {
    if (busyRevert) return
    setBusyRevert(true)
    f().then(done => done && setPicks(null), () => {}).finally(() => setBusyRevert(false)) // a no keeps the picks
  }
  const revertHunk = (path: string, hunk: number) => {
    const text = byFile.get(path)?.hunks[hunk]
    if (text !== undefined) revert(() => api.undoHunk(path, text, undefined, reload))
  }
  const revertPicks = () => picks && revert(() => api.undoHunk(picks.path, picks.text, [...picks.at].sort((a, b) => a - b), reload))
  const [menu, openMenu] = useMenu()
  const fileMenu = (e: MouseEvent, path: string) =>
    !all && openMenu(e, [{ label: 'Revert this file…', icon: 'undo', danger: true, run: () => revert(() => api.undoFile(path, reload)) }])
  const same = (a: DiffLine, b: DiffLine) => a.old === b.old && a.new === b.new && a.text === b.text
  // a click (not a drag that selects text) on a line opens its comment box
  const pick = (path: string, l: DiffLine, e?: MouseEvent) => {
    if (e && (e.altKey || e.shiftKey) && !all && changeLine(l) && !byFile.get(path)?.cut) return pickLine(path, l, e.shiftKey)
    if ((l.old ?? l.new) !== undefined && !window.getSelection()?.toString()) setAt(a => (a?.path === path && same(a.line, l) ? null : { path, line: l, text: '' }))
  }
  // ⌥ and ⇧ pick lines: no text selection meanwhile
  const noSelect = (e: MouseEvent) => (e.altKey || e.shiftKey) && !all && e.preventDefault()
  // where the box goes after a refresh: under its line, else (the line changed) at the end of the file's diff
  const boxAt = (path: string, lines: DiffLine[]) => {
    if (at?.path !== path) return -1
    const i = lines.findIndex(l => same(l, at.line))
    return i < 0 ? lines.length - 1 : i
  }
  const toggle = (p: string) => setOpen(o => (o.has(p) ? (o.delete(p), new Set(o)) : new Set(o.add(p))))
  const [split, setSplit] = useState(() => localStore('laki.diffSplit') === 'split') // side by side, as GitHub's split view; the last one picked
  const pickSplit = (on: boolean) => (setSplit(on), localStore('laki.diffSplit', on ? 'split' : 'unified'))
  const lineClass = (path: string, l: DiffLine) => `dl ${l.text.startsWith('@@') ? 'dl-hunk' : l.new === undefined && l.old !== undefined ? 'dl-del' : l.old === undefined && l.new !== undefined ? 'dl-add' : ''}${(l.old ?? l.new) !== undefined ? ' dl-line' : ''}${picked(path, l) ? ' picked' : ''}`
  // a hunk header's Revert (Here only: the PR's diff needn't be the worktree's)
  const hunkHead = (path: string, l: DiffLine, cut?: boolean) => (
    <>
      <span>{l.text || ' '}</span>
      {!all && !cut && l.hunk !== undefined && (
        <button type="button" className="dl-revert" disabled={busyRevert} data-tip="Take this hunk back to the base: Undo is in the toast" onClick={e => (e.stopPropagation(), revertHunk(path, l.hunk!))}>
          Revert
        </button>
      )}
    </>
  )
  const files = d?.files ?? []
  // Viewed, as on GitHub's Files changed: a box for each file in the PR (in both views); ticked, it folds and dims.
  // DISMISSED (viewed, then changed by a commit) is unticked. mine: ticks made here until GitHub's next answer has them
  const [gh] = useLoad<PRFiles | null>(pr ? api.prFiles : () => Promise.resolve(null), `${ws}#${pr?.number ?? ''}`, 60000)
  const [mine, setMine] = useState<Record<string, string>>({})
  useEffect(() => setMine({}), [ws])
  useEffect(() => setMine(m => Object.fromEntries(Object.entries(m).filter(([p, v]) => gh?.files[p] !== v))), [gh]) // kept until GitHub's answer has them (one asked for before the tick doesn't)
  const viewedOf = (p: string) => mine[p] ?? gh?.files[p]
  const inPR = files.filter(f => viewedOf(f.path))
  const viewed = inPR.filter(f => viewedOf(f.path) === 'VIEWED').length
  const [vErr, setVErr] = useState('')
  const mark = (p: string, on: boolean) => {
    if (!gh) return
    const was = viewedOf(p)
    setMine(m => ({ ...m, [p]: on ? 'VIEWED' : 'UNVIEWED' }))
    if (on) setOpen(o => (o.delete(p), new Set(o)))
    setVErr('')
    api.setViewed(p, on, gh.id).catch(e => (setMine(m => ({ ...m, [p]: was! })), setVErr(String(e?.message ?? e))))
  }
  return (
    <>
      <div className="sp-tools">
        {pr && (
          <span className="seg">
            <button type="button" className={all ? '' : 'on'} data-tip="This workspace's changes: its branch against its base, and what isn't committed" onClick={() => setWhole(false)}>
              Here
            </button>
            <button type="button" className={all ? 'on' : ''} data-tip={`All of PR #${pr.number}, as GitHub has it (gh pr diff)`} onClick={() => setWhole(true)}>
              PR #{pr.number}
            </button>
          </span>
        )}
        {(sum => (
          <span className="sp-sum muted small grow" data-tip={sum && files.length ? `${sum} · click a line to comment` : undefined}>
            {sum || (err ? '' : 'Loading…')}
            {sum && files.length > 0 && <span className="sp-sum-more"> · click a line to comment</span>}
          </span>
        ))(d && !err ? `${files.length} file${files.length === 1 ? '' : 's'}${all ? '' : ` changed vs ${d.base}`}` : '')}
        {inPR.length > 0 && (
          <span className={`sp-viewed-n ${viewed === inPR.length ? 'all' : ''}`} data-tip={`Files you've marked viewed on GitHub, of the ${inPR.length} here in PR #${pr!.number}`}>
            {viewed}/{inPR.length}
            <span className="sp-viewed-w"> viewed</span>
          </span>
        )}
        <IconButton icon={split ? 'unsplit' : 'splitRight'} title={split ? 'One column: the changes in one' : 'Two columns: before and after side by side'} on={split} onClick={() => pickSplit(!split)} />
        {pr && <IconButton icon="github" title="Files changed, on GitHub" onClick={() => onOpen(`${pr.url}/files`)} />}
        {files.some(f => open.has(f.path)) ? <IconButton icon="collapse" title="Collapse all" onClick={() => setOpen(new Set())} /> : <IconButton icon="expand" title={viewed ? 'Expand all but the viewed ones' : 'Expand all'} onClick={() => setOpen(new Set(files.filter(f => viewedOf(f.path) !== 'VIEWED').map(f => f.path)))} />}
        <IconButton icon="refresh" title="Refresh" onClick={reload} />
      </div>
      <div className="sp-body">
        {err && <div className="warn small pad">{err}</div>}
        {vErr && <div className="warn small pad">{vErr}</div>}
        {d && !files.length && <div className="muted small pad">{all ? `PR #${pr!.number} changes nothing.` : `No changes: the branch is where ${d.base} is, and nothing is uncommitted.`}{!all && pr ? ` PR #${pr.number} above shows the PR's.` : ''}</div>}
        {files.map(f => (
          <div key={f.path} className={`sp-change ${viewedOf(f.path) === 'VIEWED' ? 'viewed' : ''}`}>
            <div className="sp-row" onClick={() => toggle(f.path)} onContextMenu={e => fileMenu(e, f.path)} data-tip={all ? f.path : `${f.path} · right click: Revert this file`}>
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
              {viewedOf(f.path) && (
                <label className="sp-viewed" data-tip={viewedOf(f.path) === 'VIEWED' ? 'Viewed (on GitHub too): untick to show it again' : 'Mark viewed, as on GitHub'} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={viewedOf(f.path) === 'VIEWED'} onChange={e => mark(f.path, e.target.checked)} />
                </label>
              )}
            </div>
            {open.has(f.path) && IMAGE.test(f.path) && !all && <ImageDiff api={api} path={f.path} status={f.status} />}
            {open.has(f.path) && (!IMAGE.test(f.path) || all) /* the PR's images: GitHub has them */ && (
              <div className={`sp-diff ${split ? 'split' : ''}`}>
                {(fd => {
                  const lines = fd.lines
                  const box = boxAt(f.path, lines)
                  const comment = at && <CommentBox path={f.path} line={at.line} text={at.text} setText={text => setAt(a => a && { ...a, text })} pr={pr?.number} api={api} onClose={() => setAt(null)} />
                  const row = (l: DiffLine, more = '') => (
                    <div className={`${lineClass(f.path, l)}${more}`} onMouseDown={noSelect} onClick={e => pick(f.path, l, e)}>
                      {l.text.startsWith('@@') ? hunkHead(f.path, l, fd.cut) : more ? l.text.slice(1) || ' ' : l.text || ' '}
                    </div>
                  )
                  if (split) {
                    // two columns: the base's lines on the left, the branch's on the right, without their - and +
                    const cell = (l?: DiffLine) => (l ? row(l, ' dl-cell') : <div className="dl dl-none" />)
                    return splitRows(lines).map((r, i) => (
                      <Fragment key={i}>
                        {r.full ? (
                          <div className={`${lineClass(f.path, r.full)} dl-full`}>{r.full.text.startsWith('@@') ? hunkHead(f.path, r.full, fd.cut) : r.full.text || ' '}</div>
                        ) : (
                          <>
                            {cell(r.left)}
                            {cell(r.right)}
                          </>
                        )}
                        {at && box >= 0 && [r.full, r.left, r.right].includes(lines[box]) && comment}
                      </Fragment>
                    ))
                  }
                  return lines.map((l, i) => (
                    <Fragment key={i}>
                      {row(l)}
                      {i === box && comment}
                    </Fragment>
                  ))
                })(byFile.get(f.path) ?? { lines: [{ text: '(no text diff: binary, or past the size cap)' }], hunks: [] })}
                {f.status[0] !== 'D' && !all /* this workspace's copy needn't be the PR's */ && (
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
        {picks && (
          <div className="dl-picks" role="status">
            <span>
              {picks.at.length} line{picks.at.length === 1 ? '' : 's'} picked
            </span>
            <button type="button" className="primary" disabled={busyRevert} onClick={revertPicks}>
              Revert these
            </button>
            <button type="button" className="link small" onClick={() => setPicks(null)}>
              Esc
            </button>
          </div>
        )}
      </div>
      {menu}
    </>
  )
}

function ReviewTab(p: { w: WsInfo; api: PanelApi; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onFix: (what: FixWhat) => void; onLog?: (c: Check) => void; onAct: (act: PRAct, method?: MergeMethod) => void; onLabel?: LabelApi }) {
  const pr = p.w.pr
  const [threads, err, reload] = useLoad(p.api.threads, `${p.w.id}#${pr?.number ?? ''}`, 60000)
  const said = (threads ?? []).filter(t => t.comments.length)
  const open = said.filter(t => !t.resolved)
  const resolved = said.filter(t => t.resolved)
  return (
    <div className="sp-body info-body">
      <PRSection w={p.w} threads={threads ? open.length : err ? undefined : 0} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} onLog={p.onLog} onAct={p.onAct} onLabel={p.onLabel} />
      {pr && (
        <section>
          <h3>
            <Icon name="review" /> Review comments
            {open.length > 0 && <span className="sp-count">{open.length}</span>}
            <span className="grow" />
            <IconButton icon="refresh" title="Refresh" onClick={reload} />
          </h3>
          {err && <div className="warn small">{err}</div>}
          {!threads && !err && <span className="muted small">Loading…</span>}
          {threads && !open.length && <span className="muted small">{resolved.length ? 'No open review comments' : 'No review comments'}</span>}
          {open.map(t => (
            <ThreadCard key={threadKey(t)} t={t} api={p.api} />
          ))}
          {resolved.length > 0 && (
            <details className="sp-resolved">
              <summary>{resolved.length} resolved</summary>
              {resolved.map(t => (
                <ThreadCard key={threadKey(t)} t={t} api={p.api} />
              ))}
            </details>
          )}
          {threads && <span className="muted small">From reviewers with write access and bots: what the agent gets.</span>}
        </section>
      )}
    </div>
  )
}

// a thread's key across refreshes: where it is and when it began (the daemon gives no id)
const threadKey = (t: Thread) => `${t.path}:${t.line ?? ''}:${t.comments[0]?.at ?? t.comments[0]?.body.slice(0, 40)}`

// a review thread: where (a click shows the file at that line), then each comment as Markdown
function ThreadCard({ t, api }: { t: Thread; api: PanelApi }) {
  return (
    <div className="sp-thread">
      <button className="sp-thread-head" onClick={() => api.preview(t.path, t.line)} data-tip="Show the file at this line">
        <Icon name="file" />
        <span className="sp-thread-path">
          {t.path}
          {t.line ? `:${t.line}` : ''}
        </span>
        {t.outdated && <span className="tag">outdated</span>}
      </button>
      {t.comments.map((c, j) => (
        <div key={j} className="sp-comment">
          <div className="sp-comment-by">
            <Avatar login={c.author} size={16} />
            <b>{c.author}</b>
            {c.at && <span className="muted">{ago(c.at)}</span>}
          </div>
          <Folded text={c.body} lines={10} />
        </div>
      ))}
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
  onLog?: (c: Check) => void // a failing check's log (Review's PR section)
  onAct: (act: PRAct, method?: MergeMethod) => void
  onLabel?: LabelApi // the PR's labels (Review's PR section)
  root: FilesRoot // Files': the worktree, or the Artifacts
  onRoot: (r: FilesRoot) => void
  info: ReactNode // the Info tab (Info.tsx InfoTab): the workspace's facts and PR
  ext?: { id: `ext:${string}`; label: string; icon: ReactNode; body: ReactNode }[] // extensions placed in panel, a tab each after the others
}) {
  const tabs = TABS.filter(t => p.git || t.id === 'info' || t.id === 'files' || t.id === 'preview' || t.id === 'device')
  const ext = p.ext?.find(x => x.id === p.tab)
  const tab = ext || tabs.some(t => t.id === p.tab) ? p.tab : 'files'
  return (
    <div className="side-panel" style={{ width: p.width }}>
      <PanelHandle onWidth={p.onWidth} init={PANEL_WIDTH} />
      <div className="sp-tabs">
        {tabs.map(t => (
          <button key={t.id} className={t.id === tab ? 'on' : ''} data-tip={t.label} onClick={() => p.onTab(t.id)}>
            <Icon name={t.icon} /> <span className="sp-tab-label">{t.label}</span>
          </button>
        ))}
        {p.ext?.map(x => (
          <button key={x.id} className={x.id === tab ? 'on' : ''} data-tip={x.label} onClick={() => p.onTab(x.id)}>
            {x.icon} <span className="sp-tab-label">{x.label}</span>
          </button>
        ))}
        <span className="grow" />
        <IconButton icon="x" title="Close (⌥⌘B)" onClick={p.onClose} />
      </div>
      {tab === 'info' && p.info}
      {tab === 'files' && <Files api={p.api} ws={p.w.id} root={p.api.artifacts ? p.root : 'ws'} onRoot={p.onRoot} />}
      {tab === 'changes' && <ChangesTab key={p.w.id} api={p.api} ws={p.w.id} pr={p.w.pr} linked={p.w.prLinked} onOpen={p.onOpen} />}
      {tab === 'review' && <ReviewTab w={p.w} api={p.api} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} onLog={p.onLog} onAct={p.onAct} onLabel={p.onLabel} />}
      {tab === 'preview' && <PreviewTab key={p.w.id} w={p.w} api={p.api} onOpen={p.onOpen} />}
      {tab === 'device' && <DeviceTab api={p.api} />}
      {ext && <div className="sp-ext">{ext.body}</div>}
    </div>
  )
}

// Simulator: a booted iOS Simulator or an Android emulator (or a phone on adb) in the panel, a frame after another while
// it shows (the daemon's sim; one asked for as the last comes, not while the window is hidden). A click is a tap, a drag
// a swipe, the box types (Enter: it, then Return), the buttons press Home, Back, Lock…; the camera puts a screenshot's
// path into the agent's prompt. iOS input needs idb, as laki screen's
// ponytail: a few frames a second and a third of a second for a tap; a stream with live touches is the next step
type SimDevice = { id: string; name: string; os: 'ios' | 'android' }
const SIM_PICK = 'laki.sim' // the device picked last
const SIM_GAP = 250 // ms at least between frames
const SIM_KEY_WORDS: [key: string, label: string, icon: IconName, android?: boolean][] = [
  ['home', 'Home', 'home'],
  ['back', 'Back', 'back', true],
  ['apps', 'Apps', 'layers', true],
  ['lock', 'Lock', 'lock'],
]
function DeviceTab({ api }: { api: PanelApi }) {
  const [list, setList] = useState<{ devices: SimDevice[]; why: string[] } | null>(null)
  const [pick, setPick] = useState(() => {
    try {
      return localStorage.getItem(SIM_PICK) ?? ''
    } catch {
      return ''
    }
  })
  const [frame, setFrame] = useState('')
  const [err, setErr] = useState('') // the frames'
  const [said, setSaid] = useState('') // input's: a frame coming doesn't clear it
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false) // input on its way
  const img = useRef<HTMLImageElement>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const look = () => (setList(null), api.sim<{ devices: SimDevice[]; why: string[] }>({ op: 'list' }).then(setList, e => setList({ devices: [], why: [String(e?.message ?? e)] })))
  useEffect(() => void look(), [])
  const dev = list?.devices.find(d => d.id === pick) ?? list?.devices[0]
  useEffect(() => {
    if (!dev) return
    let on = true
    let t: ReturnType<typeof setTimeout> | undefined
    setFrame('')
    const next = async () => {
      if (!on) return
      if (document.hidden) return void (t = setTimeout(next, 1000))
      const at = Date.now()
      let wait = SIM_GAP
      try {
        const r = await api.sim<{ frame: string }>({ op: 'frame', device: dev.id })
        if (on) (setFrame(r.frame), setErr(''))
      } catch (e) {
        if (on) setErr(String((e as Error)?.message ?? e))
        wait = 2000 // gone, or not ready: again in a while
      }
      if (on) t = setTimeout(next, Math.max(0, wait - (Date.now() - at)))
    }
    void next()
    return () => ((on = false), clearTimeout(t))
  }, [dev?.id])
  const choose = (id: string) => {
    setPick(id)
    try {
      localStorage.setItem(SIM_PICK, id)
    } catch {}
  }
  const send = (p: { op: string; [k: string]: unknown }) => {
    if (!dev) return
    setBusy(true)
    api
      .sim({ ...p, device: dev.id })
      .then(() => setSaid(''), e => setSaid(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }
  // where on the picture, as fractions of it (the image keeps its own shape: its box is the picture)
  const spot = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect()
    const f = (v: number) => Math.min(1, Math.max(0, v))
    return { x: f((e.clientX - r.left) / r.width), y: f((e.clientY - r.top) / r.height), r }
  }
  const up = (e: React.PointerEvent) => {
    const a = down.current
    down.current = null
    if (!a || !img.current) return
    const b = spot(e)
    if (Math.hypot((b.x - a.x) * b.r.width, (b.y - a.y) * b.r.height) > 8) send({ op: 'swipe', x: a.x, y: a.y, x2: b.x, y2: b.y })
    else send({ op: 'tap', x: a.x, y: a.y })
  }
  const toAgent = () =>
    dev &&
    api
      .sim<{ path: string }>({ op: 'shot', device: dev.id })
      .then(r => api.toPrompt(`A screenshot of the ${dev.name} ${dev.os === 'ios' ? 'simulator' : 'emulator'}: ${r.path}`))
      .catch(e => setSaid(String(e?.message ?? e)))
  const type = () => text && (send({ op: 'type', text }), setText(''))
  if (!list) return <div className="muted small pad">Looking for simulators…</div>
  if (!dev)
    return (
      <div className="sim-none">
        <Icon name="phone" size={22} />
        <b>No simulator or emulator is running</b>
        <p className="muted small">Open Simulator (Xcode › Open Developer Tool), or start an Android emulator (Android Studio's Device Manager, or emulator -avd &lt;name&gt;), then look again. A phone plugged in with USB debugging shows too.</p>
        {list.why.map(w => (
          <p key={w} className="warn small">
            {w}
          </p>
        ))}
        <button type="button" onClick={() => void look()}>
          <Icon name="refresh" size={12} /> Look again
        </button>
      </div>
    )
  return (
    <>
      <div className="sp-tools sim-tools">
        {list.devices.length > 1 ? (
          <select value={dev.id} aria-label="Which device" onChange={e => choose(e.target.value)}>
            {list.devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.os === 'ios' ? 'iOS' : 'Android'}
              </option>
            ))}
          </select>
        ) : (
          <span className="sim-name" data-tip={dev.id}>
            {dev.name} · {dev.os === 'ios' ? 'iOS' : 'Android'}
          </span>
        )}
        <span className="grow" />
        {SIM_KEY_WORDS.filter(k => !k[3] || dev.os === 'android').map(([key, label, icon]) => (
          <IconButton key={key} icon={icon} title={label} onClick={() => send({ op: 'key', key })} />
        ))}
        <IconButton icon="camera" title="Screenshot into the agent's prompt" onClick={() => void toAgent()} />
        <IconButton icon="refresh" title="Look for devices again" onClick={() => void look()} />
      </div>
      <div className={`sim-screen ${busy ? 'busy' : ''}`}>
        {frame ? (
          <img
            ref={img}
            src={frame}
            alt={`${dev.name}'s screen`}
            draggable={false}
            onPointerDown={e => e.button === 0 && (e.currentTarget.setPointerCapture(e.pointerId), (down.current = spot(e)))}
            onPointerUp={up}
            onPointerCancel={() => (down.current = null)}
          />
        ) : (
          !err && <span className="muted small">Its screen…</span>
        )}
      </div>
      {(err || said) && <div className="warn small pad">{err || said}</div>}
      <div className="sp-tools sim-type">
        <input value={text} placeholder="Type into it · Enter sends" spellCheck={false} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && (text ? type() : send({ op: 'key', key: 'enter' }))} />
        <IconButton icon="enter" title="Return" onClick={() => send({ op: 'key', key: 'enter' })} />
        <IconButton icon="eraser" title="Delete (backspace)" onClick={() => send({ op: 'key', key: 'delete' })} />
      </div>
    </>
  )
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/ // main's will-attach-webview's first page; the iframe's only ones
const canFrame = !bridge && ['localhost', '127.0.0.1'].includes(location.hostname) // a browser on this Mac: an iframe

// the size the page is laid out at (null: the panel's), and whether the sizes bar is open; per viewer
type Size = { w: number; h: number } | null
const SIZE_KEY = 'laki.previewSize'
const keptSize = (): Size => {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null')
    return s && parseSize(`${s.w}x${s.h}`) ? { w: s.w, h: s.h } : null
  } catch {
    return null
  }
}

// Preview: the workspace's dev server in the panel, or any website. In the app a <webview> (no node, no preload, its
// own session with few permissions: main's will-attach-webview), with back, forward and a screenshot for the agent; in
// a browser on this Mac an iframe, localhost only (the CSP's frame-src): another site opens in a tab of its own.
// A size (the devices bar) lays the page out at a phone's or a screen's width and height, scaled down to fit.
// ponytail: ⌘ keys don't reach the app while the page has the focus (the guest gets them); a size is only the
// viewport's: no touch, no phone's user agent
function PreviewTab({ w, api, onOpen }: { w: WsInfo; api: PanelApi; onOpen: (url: string) => void }) {
  const first = `http://localhost:${w.port}/` // $PORT's
  const [port, setPort] = useState(w.port) // for a path typed bare
  const [addr, setAddr] = useState(previewAddr(first)) // the address bar: a path on the port, or a whole URL
  const [url, setUrl] = useState(first) // what's shown
  const [n, setN] = useState(0) // the iframe's reloads
  const [err, setErr] = useState('')
  const [shot, setShot] = useState<{ data: string; url: string } | null>(null)
  const [picking, setPicking] = useState(0) // a pick in progress (its number: a later one wins)
  const [size, setSize] = useState<Size>(keptSize)
  const [sizes, setSizes] = useState(() => !!keptSize()) // the bar
  const [typed, setTyped] = useState(() => (size ? `${size.w}×${size.h}` : '')) // its own size, as typed
  const [box, setBox] = useState({ w: 0, h: 0 }) // the room the page has
  const stage = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<any>(null) // the webview element
  const [parked, setParked] = useState(false) // stopped in Settings › Resources (laki-stop): its page unloaded until Load
  useEffect(() => {
    const f = (e: Event) => (e as CustomEvent).detail === 'preview' && setParked(true)
    window.addEventListener('laki-stop', f)
    return () => window.removeEventListener('laki-stop', f)
  }, [])
  const pickSize = (s: Size) => {
    setSize(s)
    setTyped(s ? `${s.w}×${s.h}` : '')
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(s))
    } catch {}
  }
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const k = size && box.w ? Math.max(0.05, Math.min(1, (box.w - 16) / size.w, (box.h - 16) / size.h)) : 1 // 8px around it
  // its methods throw until it's attached and ready
  const on = (f: (v: any) => unknown) => {
    try {
      return view.current && f(view.current)
    } catch {}
  }
  const load = (u: string) => {
    if (!/^https?:\/\//.test(u)) return
    if (!bridge && !LOCAL.test(u)) return onOpen(u) // the iframe takes localhost only
    setErr('')
    setUrl(u)
    setAddr(previewAddr(u))
    if (view.current && on(v => v.loadURL(u).catch(() => {})) === undefined) view.current.setAttribute('src', u) // a failure comes as did-fail-load
  }
  const go = () => load(previewUrl(addr, port))
  useEffect(() => {
    if (!bridge || !host.current || parked) return
    const v = document.createElement('webview') as any
    v.setAttribute('src', url)
    v.setAttribute('partition', 'persist:preview') // its own cookies, kept: a dev app's sign-in stays
    v.className = 'web-view'
    const at = (e: any) => {
      setUrl(e.url)
      setErr('')
      setAddr(previewAddr(e.url))
      if (LOCAL.test(e.url)) setPort(Number(new URL(e.url).port) || 80)
    }
    v.addEventListener('did-navigate', at)
    v.addEventListener('did-start-navigation', (e: any) => e.isMainFrame && !e.isInPlace && setPicking(0)) // the page's picker goes with it
    v.addEventListener('did-navigate-in-page', (e: any) => e.isMainFrame && at(e))
    v.addEventListener('did-fail-load', (e: any) => e.isMainFrame && e.errorCode !== -3 && setErr(e.errorCode === -102 ? `Nothing listens on ${new URL(e.validatedURL).host} yet: ▷ Run starts the dev server. Or type another address above.` : e.errorDescription || 'It didn’t load'))
    host.current.appendChild(v)
    view.current = v
    return () => {
      v.remove()
      view.current = null
    }
  }, [parked])
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
  const own = size && !SIZES.some(([, sw, sh]) => sw === size.w && sh === size.h)
  return (
    <>
      <div className="sp-tools web-tools">
        {bridge && <IconButton icon="back" title="Back" onClick={() => on(v => v.goBack())} />}
        {bridge && <IconButton icon="forward" title="Forward" onClick={() => on(v => v.goForward())} />}
        <IconButton icon="refresh" title="Reload" onClick={() => (setErr(''), parked ? setParked(false) : bridge ? on(v => v.reload()) : setN(x => x + 1))} />
        <input value={addr} spellCheck={false} placeholder="localhost:3000/ · :5173 · example.com" data-tip="A path on this port (/x), another port (:5173), or any address" onChange={e => setAddr(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} onFocus={e => e.target.select()} />
        <IconButton icon="devices" title="Sizes: a phone's, a tablet's, HD…" on={sizes} onClick={() => (sizes && pickSize(null), setSizes(!sizes))} />
        {bridge && <IconButton icon="pick" title={picking ? 'Picking: click an element (Esc stops)' : "Pick an element: its CSS selector into the agent's prompt"} on={!!picking} onClick={pick} />}
        {bridge?.capture && <IconButton icon="camera" title="Screenshot to the agent" onClick={capture} />}
        <IconButton icon="link" title="Open in the browser" onClick={() => onOpen(url)} />
      </div>
      {sizes && (
        <div className="sp-tools web-sizes">
          <span className="seg wrap">
            <button type="button" className={size ? '' : 'on'} data-tip="As wide and tall as the panel" onClick={() => pickSize(null)}>
              Fit
            </button>
            {SIZES.map(([name, sw, sh]) => (
              <button key={name} type="button" className={size?.w === sw && size.h === sh ? 'on' : ''} data-tip={`${sw}×${sh}`} onClick={() => pickSize({ w: sw, h: sh })}>
                {name}
              </button>
            ))}
          </span>
          <input
            className={own ? 'on' : ''}
            value={typed}
            placeholder="1440×900"
            spellCheck={false}
            data-tip="Your own size: width×height, then Enter"
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              const s = parseSize(typed)
              if (s) pickSize({ w: s[0], h: s[1] })
              else setTyped(size ? `${size.w}×${size.h}` : '')
            }}
          />
          {size && <IconButton icon="refresh" title="Turn it: width and height swapped" onClick={() => pickSize({ w: size.h, h: size.w })} />}
          {size && <span className="muted small">{Math.round(k * 100)}%</span>}
        </div>
      )}
      {shot && <ShotBox shot={shot} api={api} onClose={() => setShot(null)} />}
      {err && <div className="warn small pad">{err}</div>}
      {parked && (
        <div className="muted small pad">
          Unloaded to free memory. <button className="small" onClick={() => setParked(false)}>Load it again</button>
        </div>
      )}
      <div className={`web-body ${size ? 'sized' : ''}`} ref={stage}>
        <div className="web-host" ref={host} style={size ? { width: size.w, height: size.h, transform: `scale(${k})` } : undefined}>
          {!bridge && <iframe key={n} className="web-view" src={url} title="Preview" />}
        </div>
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

const ACTION_TIP = 600 // ponytail: a tip's characters; the rest is in Settings › Actions
// Run ▾'s two groups of actions (actionsFor's); tabName: a tab's name, for the hint; run: the app sends it
export function actionMenu({ agent, terminal }: ReturnType<typeof actionsFor>, tabName: (id: string) => string | undefined, run: (a: RunAction, tab?: string) => void): MenuItem[] {
  // its tip: what it sends (a prompt) or runs (a command), cut long
  const tip = (a: RunAction) => (a.text.length > ACTION_TIP ? `${a.text.slice(0, ACTION_TIP)}…` : a.text)
  const item = (a: RunAction, tab: string | undefined, hint: string): MenuItem => ({ label: a.name, icon: a.target === 'shell' ? 'terminal' : 'agent', hint, tip: tip(a), run: () => run(a, tab) })
  return [
    ...(agent.length ? [null, { head: 'Agent actions' }, ...agent.map(x => item(x.action, x.tab, tabName(x.tab) ?? x.action.target))] : []),
    ...(terminal.length ? [null, { head: 'Shell actions' }, ...terminal.map(x => item(x.action, x.tab, (x.tab && tabName(x.tab)) || 'new shell'))] : []),
  ]
}

// a CSV file as a table, its first row the head; edit: a click on a cell edits it (Enter: the one below, Tab: the next,
// Esc: as it was), + Row, + Column, × on a row's number. Each change is the whole file again (toCsv), as the text edit's
const CSV_MAX = 2000 // ponytail: rows shown; the rest is there, edited in Raw
function CsvTable({ path, text, edit, onText }: { path: string; text: string; edit: boolean; onText: (t: string) => void }) {
  const sep = useMemo(() => csvSep(path, text), [path]) // the file's, not each edit's
  const { rows, quoted } = useMemo(() => parseCsv(text, sep), [text, sep])
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0)
  const [at, setAt] = useState<[number, number] | null>(null)
  useEffect(() => void (edit || setAt(null)), [edit])
  const commit = (next: string[][], q = quoted) => onText(toCsv(next, sep, q, text.endsWith('\n') || !text)) // q: each cell's quotes, row for row with next
  const setCell = (r: number, c: number, v: string) => {
    if ((rows[r]?.[c] ?? '') === v) return
    const next = rows.map(x => [...x])
    while (next.length <= r) next.push([])
    while (next[r].length <= c) next[r].push('')
    next[r][c] = v
    commit(next)
  }
  const cell = (r: number, c: number) => {
    const v = rows[r]?.[c] ?? ''
    if (at?.[0] === r && at[1] === c)
      return (
        <input
          className="csv-input"
          autoFocus
          defaultValue={v}
          onFocus={e => e.target.select()}
          onBlur={e => (setCell(r, c, e.target.value), setAt(x => (x?.[0] === r && x[1] === c ? null : x)))}
          onKeyDown={e => {
            const back = () => e.currentTarget.closest<HTMLElement>('.pv-body')?.focus({ preventScroll: true }) // its keys (⌘S, Esc) work on
            const go = (to: [number, number] | null) => (e.preventDefault(), setCell(r, c, e.currentTarget.value), to || back(), setAt(to))
            if (e.key === 'Enter') go(r + 1 < Math.max(rows.length, 1) ? [r + 1, c] : null)
            else if (e.key === 'Tab') go(e.shiftKey ? (c > 0 ? [r, c - 1] : null) : c + 1 < cols ? [r, c + 1] : r + 1 < rows.length ? [r + 1, 0] : null)
            else if (e.key === 'Escape') e.preventDefault(), e.stopPropagation(), (e.currentTarget.value = v), back(), setAt(null)
            else if (e.key === 's' && (e.metaKey || e.ctrlKey)) setCell(r, c, e.currentTarget.value) // then ⌘S saves it, with this cell
          }}
        />
      )
    return v
  }
  const pick = (r: number, c: number) => edit && setAt([r, c])
  const shown = rows.slice(1, CSV_MAX + 1)
  return (
    <div className="csv">
      <table>
        <thead>
          <tr>
            <th className="csv-n" />
            {[...Array(cols)].map((_, c) => (
              <th key={c} className={edit ? 'csv-edit' : ''} onClick={() => pick(0, c)}>
                {cell(0, c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i}>
              <td className="csv-n">
                {i + 1}
                {edit && (
                  <button className="csv-del" aria-label={`Delete row ${i + 1}`} data-tip="Delete this row" onClick={() => commit(rows.filter((_, j) => j !== i + 1), quoted.filter((_, j) => j !== i + 1))}>
                    <Icon name="x" size={10} />
                  </button>
                )}
              </td>
              {[...Array(cols)].map((_, c) => (
                <td key={c} className={`${edit ? 'csv-edit' : ''} ${c >= row.length ? 'csv-none' : ''}`} onClick={() => pick(i + 1, c)}>
                  {cell(i + 1, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > CSV_MAX + 1 && <div className="muted small pad">Showing the first {CSV_MAX} rows of {rows.length - 1}: Raw has the rest.</div>}
      {edit && (
        <div className="row pad">
          <button className="small" onClick={() => (commit([...rows, Array(Math.max(cols, 1)).fill('')]), setAt([rows.length, 0]))}>
            <Icon name="plus" /> Row
          </button>
          <button className="small" onClick={() => commit(rows.length ? rows.map(r => [...r, ...Array(Math.max(0, cols - r.length)).fill(''), '']) : [['']])}>
            <Icon name="plus" /> Column
          </button>
          <span className="muted small">{sep === '\t' ? 'Tabs' : sep === ';' ? 'Semicolons' : 'Commas'} between fields · click a cell to edit it</span>
        </div>
      )}
    </div>
  )
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
  openLabel?: string // the open button's words (an artifact: in its app)
  readOnly?: boolean // no edit (an artifact)
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
  const editable = !p.readOnly && f?.text !== undefined && !f.cut && !f.lossy && !(f.text.includes('\r\n') && /(^|[^\r])\n/.test(f.text)) // mixed line ends: one kind would replace both
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
  const [saveSoon, setSaveSoon] = useState(0) // the table's ⌘S: after the render that has the cell it was typed in
  useEffect(() => void (saveSoon && save()), [saveSoon])
  // Markdown: Rendered or Raw (the last one picked; a jump to a line: Raw); CSV: Table or Raw, the same way (laki.csv)
  const md = /\.(md|markdown|mdx)$/i.test(p.path)
  const csv = /\.(csv|tsv)$/i.test(p.path)
  const modeKey = csv ? 'laki.csv' : 'laki.md'
  const [mode, setMode] = useState<'raw' | 'rendered'>(() => (p.line ? 'raw' : (localStore(modeKey) as 'raw') || 'rendered'))
  const rendered = (md || csv) && mode === 'rendered' && f?.text !== undefined && !(csv && f.cut) // a cut CSV: Raw only
  const table = csv && rendered
  useEffect(() => void (p.edit && table && body.current?.focus({ preventScroll: true })), [!!p.edit, table]) // ⌘S and Esc from the start
  const pickMode = (m: typeof mode) => (setMode(m), localStore(modeKey, m))
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
        {(md || csv) && f?.text !== undefined && !(csv && f.cut) && (
          <div className="seg small">
            <button className={mode === 'rendered' ? 'on' : ''} onClick={() => pickMode('rendered')}>
              {csv ? 'Table' : 'Rendered'}
            </button>
            <button className={mode === 'raw' ? 'on' : ''} onClick={() => pickMode('raw')}>
              Raw
            </button>
          </div>
        )}
        {editable && <IconButton icon="pencil" title="Edit here: small changes, ⌘S saves" onClick={startEdit} />}
        <IconButton icon="refresh" title="Reload" onClick={() => setN(x => x + 1)} />
        <button className="small" data-tip={p.openLabel ?? 'Open in editor'} onClick={p.onOpen}>
          <Icon name="code" />
          <span className="pv-wide"> {p.openLabel ?? 'Open in editor'}</span>
        </button>
          </>
        )}
        <IconButton icon="x" title="Close (⌘W)" onClick={p.onClose} />
      </div>
      {err && p.edit && <div className="warn small pad">{err}</div>}
      {p.edit && table ? (
        <div
          className="pv-body"
          ref={body}
          onKeyDown={e => {
            if (e.key === 's' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), setSaveSoon(n => n + 1)) // once a cell being typed is in
            else if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) (e.preventDefault(), cancel())
          }}
          tabIndex={-1}
        >
          <CsvTable path={p.path} text={p.edit.text} edit onText={text => p.onEdit({ ...p.edit!, text })} />
        </div>
      ) : p.edit ? (
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
        {rendered && (table ? <CsvTable path={p.path} text={f.text!} edit={false} onText={() => {}} /> : <Markdown src={f.text!} />)}
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
  useEffect(() => void list.current?.querySelector('.ff-item.sel')?.scrollIntoView({ block: 'nearest' }), [i])
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
