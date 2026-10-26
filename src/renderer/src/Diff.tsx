// A diff's pieces that the side panel's Changes and Review and the full review (FullReview.tsx) share: the diff read
// into each file's lines, a file's lines drawn in one column or two, a line's comment box, an image's before and
// after, Revert's picked lines, GitHub's Viewed boxes, and review threads with their suggestions.
import { Fragment, useEffect, useRef, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { Folded } from './MarkdownView'
import { ago, Avatar } from './Info'
import { type Gap, gapsOf, linesAt, reviewedLines, sameLines, splitRows, type Suggestion, suggestionOf } from './text'
import { escapes, Icon, IconButton, type MenuItem, useMenu } from './ui'
import type { FileContent, PanelApi, PRFiles, Thread } from './SidePanel'

// what load gives, again every few seconds while the window is in front, and on reload()
export function useLoad<T>(load: () => Promise<T>, key: string, every: number) {
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

// localStorage, or nothing (a private window, blocked storage)
export function localStore(k: string, v?: string) {
  try {
    if (v === undefined) return localStorage.getItem(k)
    localStorage.setItem(k, v)
  } catch {}
  return null
}

export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`)

// the diff of one file, without its header lines
const fileOf = (l: string) => l.match(/ b\/(.*)$/)?.[1] ?? ''

// a diff line with its line numbers: old (the base's) and new (the branch's); a hunk header has neither. hunk: which
// of the file's hunks it's in, at: its index in that hunk's body (the hunk header has none); ctx: an unchanged line from
// around the hunks the full review's expand shows (no hunk, no comments)
export type DiffLine = { text: string; old?: number; new?: number; hunk?: number; at?: number; ctx?: boolean }
// a file's diff lines and its hunks' raw text (the @@ line and its body, as Revert sends it); cut: the diff's size cap
// ran into it
export type FileDiff = { lines: DiffLine[]; hunks: string[]; cut?: boolean }
const CUT = '\n… (cut)'
export const changeLine = (l: DiffLine) => (l.old === undefined) !== (l.new === undefined) // a + or - line
export const sameLine = (a: DiffLine, b: DiffLine) => a.old === b.old && a.new === b.new && a.text === b.text
export const NO_DIFF: FileDiff = { lines: [{ text: '(no text diff: binary, or past the size cap)' }], hunks: [] }

// the daemon's diff (diff, prDiff) as each file's lines
export function diffByFile(text: string) {
  const m = new Map<string, FileDiff>()
  let cur: FileDiff | null = null
  let old = 0
  let now = 0
  let last = ''
  let at = 0 // a line's index in its hunk's body
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
}

// a line's class: a hunk header, an added or taken out line, one a click comments on
export const lineClass = (l: DiffLine, picked = false) => `dl ${l.text.startsWith('@@') ? 'dl-hunk' : l.new === undefined && l.old !== undefined ? 'dl-del' : l.old === undefined && l.new !== undefined ? 'dl-add' : ''}${(l.old ?? l.new) !== undefined ? ' dl-line' : ''}${picked ? ' picked' : ''}`

// a file's lines: one column (with their - and +), or two (the base's on the left, the branch's on the right, without
// them; a context line is both). row: a line's own props (its clicks); head: a hunk header's contents; after: what goes
// under a line (its comment box, a review's threads); gutter: before a line's text (the full review's blame), side: the
// column it's in (both: one column)
export type Side = 'old' | 'new' | 'both'
export function DiffRows({ fd, split, cls, row, head, after, gutter, nums = true }: { fd: FileDiff; split: boolean; cls: (l: DiffLine) => string; row: (l: DiffLine) => HTMLAttributes<HTMLDivElement>; head: (l: DiffLine) => ReactNode; after?: (l: DiffLine) => ReactNode; gutter?: (l: DiffLine, side: Side) => ReactNode; nums?: boolean }) {
  // the line numbers, as GitHub's (one column: old and new; two: each side's), as wide as the file's biggest; then the
  // + a commentable line (.dl-line) shows on hover: a click anywhere on it opens the box
  const w = nums ? `${String(fd.lines.reduce((m, l) => Math.max(m, l.old ?? 0, l.new ?? 0), 0)).length}ch` : ''
  const num = (n?: number) => <span className="dl-n" style={{ width: w }}>{n ?? ''}</span>
  const numbers = (l: DiffLine, side: Side) =>
    nums && (
      <>
        {side !== 'new' && num(l.old)}
        {side !== 'old' && num(l.new)}
        <span className="dl-plus" aria-hidden />
      </>
    )
  const line = (l: DiffLine, more = '', side: Side = 'both') => (
    <div className={`${cls(l)}${more}`} {...row(l)}>
      {l.text.startsWith('@@') ? head(l) : (
        <>
          {gutter?.(l, side)}
          {numbers(l, side)}
          {more ? l.text.slice(1) || ' ' : l.text || ' '}
        </>
      )}
    </div>
  )
  if (!split)
    return fd.lines.map((l, i) => (
      <Fragment key={i}>
        {line(l)}
        {after?.(l)}
      </Fragment>
    ))
  const cell = (side: Side, l?: DiffLine) => (l ? line(l, ' dl-cell', side) : <div className="dl dl-none" />)
  return splitRows(fd.lines).map((r, i) => (
    <Fragment key={i}>
      {r.full ? <div className={`${cls(r.full)} dl-full`}>{r.full.text.startsWith('@@') ? head(r.full) : r.full.text || ' '}</div> : (
        <>
          {cell('old', r.left)}
          {cell('new', r.right)}
        </>
      )}
      {after && [...new Set([r.full, r.left, r.right])].map((l, j) => l && <Fragment key={j}>{after(l)}</Fragment>)}
    </Fragment>
  ))
}

export const MORE = 20 // an expand arrow's lines
// a file's expanded lines: key, the diff they're for; lines, the file (none yet: read on the first click); up, each
// hunk's lines shown above it; down, those after the last hunk; err, why it couldn't be read
type Ctx = { key: string; lines?: string[]; up: Record<number, number>; down: number; err?: string }
// expand arrows, as GitHub's: the unchanged lines around a file's hunks (Changes and the full review), read once from
// read: the worktree's file (what the diff's new side is), or the PR head's for the PR's diff. ok: a file that has any
// (not an image, nor added, taken out or untracked); keyOf: the diff they're for (another: as new)
export function useExpand(read: (p: string) => Promise<FileContent>, ok: (p: string, fd: FileDiff) => boolean, keyOf: (p: string, fd: FileDiff) => string) {
  const [ctx, setCtx] = useState<Record<string, Ctx>>({})
  const ctxOf = (p: string, fd: FileDiff): Ctx => (k => (ctx[p]?.key === k ? ctx[p] : { key: k, up: {}, down: 0 }))(keyOf(p, fd)) // the diff moved: as new
  const can = (p: string, fd: FileDiff) => ok(p, fd) && !!fd.hunks.length
  const gapsFor = (p: string, fd: FileDiff): Gap[] => gapsOf(fd.hunks.map(h => h.split('\n', 1)[0]), ctxOf(p, fd).lines?.length ?? Infinity)
  const more = (p: string, fd: FileDiff, where: number | 'down', n: number) => {
    const c = ctxOf(p, fd)
    const grow = (x: Ctx): Ctx => (where === 'down' ? { ...x, down: x.down + n } : { ...x, up: { ...x.up, [where]: (x.up[where] ?? 0) + n } })
    if (c.lines) return setCtx(m => ({ ...m, [p]: grow(c) }))
    read(p).then(
      fc => {
        if (fc.text === undefined || fc.lossy) throw new Error(fc.text === undefined ? 'not a text file' : 'not UTF-8 text')
        const lines = fc.text.split(/\r?\n/)
        if (lines.at(-1) === '') lines.pop()
        setCtx(m => ({ ...m, [p]: grow({ ...c, lines, err: undefined }) }))
      },
      (e: Error) => setCtx(m => ({ ...m, [p]: { ...c, err: String(e?.message ?? e) } })),
    )
  }
  // a file's lines with the expanded ones: below each hunk's header, the gap's last lines; after the last hunk, the next
  const expanded = (p: string, fd: FileDiff): FileDiff => {
    const c = ctxOf(p, fd)
    if (!c.lines || !can(p, fd)) return fd
    const gaps = gapsFor(p, fd)
    const at = (n: number, g: Gap): DiffLine => ({ text: ` ${c.lines![n - 1]}`, old: n + g.shift, new: n, ctx: true })
    const out: DiffLine[] = []
    for (const l of fd.lines) {
      out.push(l)
      const g = l.text.startsWith('@@') && l.hunk !== undefined ? gaps[l.hunk] : undefined
      if (g) for (let n = Math.max(g.from, g.to - (c.up[l.hunk!] ?? 0) + 1); n <= g.to; n++) out.push(at(n, g))
    }
    const t = gaps.at(-1)!
    for (let n = t.from; n <= Math.min(t.to, t.from + c.down - 1); n++) out.push(at(n, t))
    return { ...fd, lines: out }
  }
  // the lines still hidden above a hunk (h) or after the last ('down'); Infinity: the file isn't read yet
  const hidden = (p: string, fd: FileDiff, h: number | 'down') => {
    const gaps = gapsFor(p, fd)
    const g = h === 'down' ? gaps.at(-1) : gaps[h]
    const c = ctxOf(p, fd)
    return g ? Math.max(0, g.to - g.from + 1 - (h === 'down' ? c.down : (c.up[h] ?? 0))) : 0
  }
  const expander = (p: string, fd: FileDiff, h: number | 'down') => {
    const n = can(p, fd) ? hidden(p, fd, h) : 0
    if (!n) return null
    const up = h !== 'down'
    const tip = n === Infinity ? `More of the file ${up ? 'above' : 'below'}, if there is any` /* not read yet */ : n <= MORE ? `The ${n} line${n === 1 ? '' : 's'} ${up ? 'above' : 'below'}` : `${MORE} more of the ${n} lines ${up ? 'above' : 'below'} · ⇧-click: all of them`
    const err = ctxOf(p, fd).err
    return (
      <button type="button" className={`fr-expand ${up ? '' : 'down'}`} data-tip={err ? `Can't show the file: ${err}` : tip} onClick={e => (e.stopPropagation(), more(p, fd, h, e.shiftKey ? Infinity : MORE))} onMouseDown={e => e.stopPropagation()}>
        <Icon name={up ? 'chevronUp' : 'chevron'} size={12} />
        {n !== Infinity && <span>{n}</span>}
      </button>
    )
  }
  return { expanded, expander }
}

// a comment on one diff line (or lines: from), as it was when the box opened: to the PR on GitHub, or to the
// workspace's agent; onAdd (the full review's): onto its list of comments instead. The text lives in the caller: a
// refresh can move the line, and the box with it.
export function CommentBox({ path, line, from, text, setText, pr, api, onAdd, onClose }: { path: string; line: DiffLine; from?: number; text: string; setText: (t: string) => void; pr?: number; api: PanelApi; onAdd?: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const n = line.new ?? line.old!
  const where = from ? `lines ${from}-${n}` : `line ${n}`
  const go = (f: () => Promise<unknown>) => {
    if (busy || !text.trim()) return
    setBusy(true)
    setErr('')
    f().then(onClose, e => (setErr(String(e?.message ?? e)), setBusy(false)))
  }
  const toPR = () => pr && go(() => api.comment({ path, line: n, side: line.new === undefined ? 'LEFT' : 'RIGHT', body: text }))
  // to an agent of the workspace: the focused one first, another from the ▾ (agents: the workspace's live agent tabs)
  const [to, setTo] = useState(api.agents[0]?.id)
  const agent = api.agents.find(a => a.id === to) ?? api.agents[0]
  const [menu, openMenu] = useMenu()
  const toAgent = (tab = agent?.id) => go(() => api.toAgent(`About ${path}, line ${n}${line.new === undefined ? ' (removed)' : ''}: \`${line.text.slice(1).trim()}\`\n\n${text}`, true, tab))
  const add = () => text.trim() && onAdd!()
  const sendButton = (
    <span className="split">
      <button disabled={busy || !text.trim()} onClick={() => toAgent()} data-tip={agent ? `When its turn ends: ${agent.name}` : 'When its turn ends'}>
        Send to {agent?.name ?? 'the agent'}
      </button>
      {api.agents.length > 1 && <IconButton icon="chevron" title="Another agent of this workspace" disabled={busy} onClick={e => openMenu(e, api.agents.map(a => ({ label: a.name, icon: 'send', hint: a.id === agent?.id ? '✓' : undefined, run: () => setTo(a.id) }) as MenuItem))} />}
    </span>
  )
  return (
    <div className="dl-comment" onClick={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}>
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder={`A comment on ${where} · ⌘⏎ ${onAdd ? 'adds it to the review' : pr ? 'posts it' : 'sends it to the agent'}`}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation() // the full review's keys: not while typing
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter' && e.metaKey) onAdd ? add() : pr ? toPR() : agent && toAgent()
        }}
      />
      {err && <div className="warn small">{err}</div>}
      <div className="row">
        {onAdd ? (
          <>
            <button className="primary" disabled={!text.trim()} onClick={add}>
              Add to the review
            </button>
            {!!api.agents.length && sendButton}
          </>
        ) : (
          <>
            {pr ? (
              <button className="primary" disabled={busy || !text.trim()} onClick={toPR}>
                Comment on PR #{pr}
              </button>
            ) : (
              <span className="muted small">No PR yet</span>
            )}
            {api.agents.length ? sendButton : <span className="muted small">No agent running here</span>}
          </>
        )}
        <span className="grow" />
        <button className="link small" onClick={onClose}>
          Cancel
        </button>
      </div>
      {menu}
    </div>
  )
}

// an image the changes touched, before and after side by side (one side when it's new or gone), each with its size in
// pixels and bytes; a click shows it full size. An SVG is an <img> too: never markup in the page
export const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
export function ImageDiff({ api, path, status }: { api: PanelApi; path: string; status: string }) {
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

// lines picked for Revert (⌥-click, ⇧-click a range): one hunk's, by their index in its body; last: where ⇧ starts
type Picks = { path: string; hunk: number; text: string; at: number[]; last: number }

// Revert: a hunk, picked lines or a whole file back to the base (PanelApi's undoHunk, undoFile: Undo in the toast).
// off: the PR's diff, which needn't be the worktree's; reset: what drops the picks (another workspace, another diff)
export function useRevert(api: PanelApi, byFile: Map<string, FileDiff>, off: boolean, reload: () => void, reset: string) {
  // a refresh that changes their hunk drops them
  const [picks, setPicks] = useState<Picks | null>(null)
  useEffect(() => setPicks(p => (p && byFile.get(p.path)?.hunks[p.hunk] === p.text ? p : null)), [byFile])
  useEffect(() => setPicks(null), [reset])
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
  const [busy, setBusy] = useState(false)
  const revert = (f: () => Promise<boolean>) => {
    if (busy) return
    setBusy(true)
    f().then(done => done && setPicks(null), () => {}).finally(() => setBusy(false)) // a no keeps the picks
  }
  const revertHunk = (path: string, hunk: number) => {
    const text = byFile.get(path)?.hunks[hunk]
    if (text !== undefined) revert(() => api.undoHunk(path, text, undefined, reload))
  }
  const revertPicks = () => picks && revert(() => api.undoHunk(picks.path, picks.text, [...picks.at].sort((a, b) => a - b), reload))
  const revertFile = (path: string) => revert(() => api.undoFile(path, reload))
  // a ⌥- or ⇧-click on a + or - line picks it; true: it did
  const onPick = (path: string, l: DiffLine, e: MouseEvent) => {
    if (!(e.altKey || e.shiftKey) || off || !changeLine(l) || byFile.get(path)?.cut) return false
    pickLine(path, l, e.shiftKey)
    return true
  }
  // ⌥ and ⇧ pick lines: no text selection meanwhile
  const noSelect = (e: MouseEvent) => (e.altKey || e.shiftKey) && !off && e.preventDefault()
  // a hunk header's Revert
  const hunkHead = (path: string, l: DiffLine, cut?: boolean) => (
    <>
      <span>{l.text || ' '}</span>
      {!off && !cut && l.hunk !== undefined && (
        <button type="button" className="dl-revert" disabled={busy} data-tip="Take this hunk back to the base: Undo is in the toast" onClick={e => (e.stopPropagation(), revertHunk(path, l.hunk!))}>
          Revert
        </button>
      )}
    </>
  )
  const bar = picks && (
    <div className="dl-picks" role="status">
      <span>
        {picks.at.length} line{picks.at.length === 1 ? '' : 's'} picked
      </span>
      <button type="button" className="primary" disabled={busy} onClick={revertPicks}>
        Revert these
      </button>
      <button type="button" className="link small" onClick={() => setPicks(null)}>
        Esc
      </button>
    </div>
  )
  return { picked, onPick, noSelect, hunkHead, revertFile, bar }
}

// Viewed, as on GitHub's Files changed: each file of the PR's viewerViewedState (VIEWED, UNVIEWED, DISMISSED: viewed,
// then changed by a commit); none for a file the PR hasn't. mine: ticks made here until GitHub's next answer has them
export function useGhViewed(api: PanelApi, ws: string, pr?: number) {
  const [gh] = useLoad<PRFiles | null>(pr ? api.prFiles : () => Promise.resolve(null), `${ws}#${pr ?? ''}`, 60000)
  const [mine, setMine] = useState<Record<string, string>>({})
  useEffect(() => setMine({}), [ws])
  useEffect(() => setMine(m => Object.fromEntries(Object.entries(m).filter(([p, v]) => gh?.files[p] !== v))), [gh]) // kept until GitHub's answer has them (one asked for before the tick doesn't)
  const [err, setErr] = useState('')
  const viewedOf = (p: string): string | undefined => mine[p] ?? gh?.files[p]
  const line = useRef(Promise.resolve()) // every mark's calls in one line: a later click's never lands before an earlier one's
  // shown at once, sent one after another (a folder's at a time: GitHub's limits); a failure puts back the ones not sent
  // ponytail: a call per file (GitHub's markFileAsViewed takes one path), so a few hundred take a minute or two
  const mark = (ps: string[], on: boolean) => {
    if (!gh || !ps.length) return
    const was = Object.fromEntries(ps.map(p => [p, viewedOf(p)!]))
    const state = on ? 'VIEWED' : 'UNVIEWED'
    setMine(m => ({ ...m, ...Object.fromEntries(ps.map(p => [p, state])) }))
    setErr('')
    let sent = 0
    line.current = ps
      .reduce((chain, p) => chain.then(() => api.setViewed(p, on, gh.id)).then(() => void sent++), line.current)
      .catch(e => (setMine(m => ({ ...m, ...Object.fromEntries(ps.slice(sent).map(p => [p, was[p]])) })), setErr(String(e?.message ?? e))))
  }
  return { viewedOf, mark, err }
}

// a file's page on the repo's site (PanelApi's web): at the base branch, or at the branch as pushed; line: a diff
// line's numbers, the base's for the one, the branch's for the other. webItems: in a submenu
export const webSub = (api: PanelApi, path: string, base: string, branch?: string, line?: { old?: number; new?: number }): MenuItem[] =>
  api.web
    ? [
        { label: `At ${base.replace(/^origin\//, '')}`, icon: 'gitBranch', sub: `the base branch on origin${line?.old ? `, line ${line.old}` : ''}`, run: () => api.web!(path, 'base', line?.old) },
        { label: `At ${branch || 'this branch'}`, icon: 'gitBranch', sub: `as pushed to origin${line?.new ? `, line ${line.new}` : ''}`, run: () => api.web!(path, 'branch', line?.new) },
      ]
    : []
export const webItems = (api: PanelApi, path: string, base: string, branch?: string, line?: { old?: number; new?: number }): MenuItem[] =>
  api.web ? [{ label: 'Open on remote', icon: 'externalLink', items: webSub(api, path, base, branch, line) }] : []

// a thread's key across refreshes: where it is and when it began (the daemon gives no id)
export const threadKey = (t: Thread) => `${t.path}:${t.line ?? ''}:${t.comments[0]?.at ?? t.comments[0]?.body.slice(0, 40)}`

// a thread's suggestion as an edit: lines on the new file's side whose hunk shows them (what the review saw: Apply
// needs the file's lines there to be those still)
const editOf = (t: Thread, lines?: string[]): Suggestion | null => {
  if (!lines || t.side !== 'RIGHT' || !t.line || !t.hunk) return null
  const start = t.startLine ?? t.line
  const seen = reviewedLines(t.hunk, t.line - start + 1)
  return seen && { start, end: t.line, seen, lines }
}

export type ApplyProps = { text?: string; pending?: Suggestion[]; busy?: boolean; onApply?: (edits: Suggestion[]) => void } // an open thread's: its file now, the file's suggestions still to apply

// the open threads' suggestions (each one's newest), the files they're on read as they are now, and Apply: what a
// ThreadCard of an open thread takes (props(t))
export function useSuggestions(api: PanelApi, open: Thread[], ws: string, threads: unknown) {
  const edits = new Map<string, Suggestion[]>()
  for (const t of open) {
    const e = !t.outdated && editOf(t, t.comments.map(c => suggestionOf(c.body)).filter(x => !!x).at(-1)?.lines)
    if (e) edits.set(t.path, [...(edits.get(t.path) ?? []), e])
  }
  const [texts, setTexts] = useState<Record<string, string | undefined>>({})
  const [n, setN] = useState(0) // after an Apply and its Undo: read again
  const [busy, setBusy] = useState(false)
  useEffect(() => setTexts({}), [ws])
  const files = [...edits.keys()].join('\n')
  useEffect(() => {
    let alive = true
    for (const f of files ? files.split('\n') : []) api.read(f).then(c => alive && setTexts(x => ({ ...x, [f]: c.text })), () => {})
    return () => {
      alive = false
    }
  }, [files, threads, n])
  const pending = (path: string) => (edits.get(path) ?? []).filter(e => texts[path] === undefined || sameLines(linesAt(texts[path]!, e.start, e.end), e.seen))
  const apply = (path: string, es: Suggestion[]) => {
    setBusy(true)
    api
      .apply(path, es, () => setN(x => x + 1))
      .catch(() => {})
      .finally(() => setBusy(false))
  }
  return (t: Thread): ApplyProps => ({ text: texts[t.path], pending: pending(t.path), busy, onApply: es => apply(t.path, es) })
}

// a review thread: where (a click shows the file at that line; noHead: drawn at its line already), then each comment
// as Markdown, a suggestion as a diff
// a comment's copy button, at the end of its head (shown on hover, styles.css): its Markdown as written
export function CopyComment({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return <IconButton icon={done ? 'check' : 'copy'} className="sp-copy" title={done ? 'Copied' : 'Copy the comment'} onClick={() => void navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)), () => {})} />
}

export function ThreadCard({ t, api, noHead, ...a }: { t: Thread; api: PanelApi; noHead?: boolean } & ApplyProps) {
  return (
    <div className="sp-thread">
      {!noHead && (
        <button className="sp-thread-head" onClick={() => api.preview(t.path, t.line)} data-tip="Show the file at this line">
          <Icon name="file" />
          <span className="sp-thread-path">
            {t.path}
            {t.line ? `:${t.line}` : ''}
          </span>
          {t.outdated && <span className="tag">outdated</span>}
        </button>
      )}
      {t.comments.map((c, j) => (
        <div key={j} className="sp-comment">
          <div className="sp-comment-by">
            <Avatar login={c.author} size={16} />
            <b>{c.author}</b>
            {c.at && <span className="muted">{ago(c.at)}</span>}
            <CopyComment text={c.body} />
          </div>
          {(s =>
            s ? (
              <>
                {s.rest && <Folded text={s.rest} lines={10} html />}
                <Suggested t={t} lines={s.lines} {...a} />
              </>
            ) : (
              <Folded text={c.body} lines={10} html />
            ))(suggestionOf(c.body))}
        </div>
      ))}
    </div>
  )
}

// a comment's suggestion: the file's lines now (else what the review saw) and the suggested ones; Apply while they're
// as the review saw them (an open thread, not outdated, on the new file's side), Apply all with the file's others
function Suggested({ t, lines, text, pending = [], busy, onApply }: { t: Thread; lines: string[] } & ApplyProps) {
  const e = !t.outdated && onApply ? editOf(t, lines) : null
  const now = e && text !== undefined ? linesAt(text, e.start, e.end) : null
  const state = !e ? '' : !now || sameLines(now, e.seen) ? 'apply' : sameLines(now, lines) ? 'applied' : 'changed'
  const was = (state === 'changed' ? now : e?.seen) ?? []
  return (
    <div className="sp-sugg">
      <div className="sp-diff">
        {was.map((l, i) => (
          <div key={`-${i}`} className="dl dl-del">
            -{l}
          </div>
        ))}
        {lines.map((l, i) => (
          <div key={`+${i}`} className="dl dl-add">
            +{l}
          </div>
        ))}
        {!lines.length && <div className="dl muted">(the lines go)</div>}
      </div>
      {state === 'apply' && (
        <span className="row-buttons">
          <button type="button" disabled={busy} data-tip="Put it in the file: Undo is in the toast; nothing is committed" onClick={() => onApply!([e!])}>
            Apply
          </button>
          {pending.length > 1 && (
            <button type="button" className="link small" disabled={busy} onClick={() => onApply!(pending)}>
              Apply all {pending.length} in {t.path.slice(t.path.lastIndexOf('/') + 1)}
            </button>
          )}
        </span>
      )}
      {state === 'applied' && <span className="muted small">Applied: it goes in with your next commit</span>}
      {state === 'changed' && <span className="muted small">Changed since the review: these lines aren't what it saw</span>}
    </div>
  )
}
