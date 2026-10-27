// The full review (settings.fullReview, on unless false: Settings › Pull requests): the tab bar's Review tab, first (⌘1) while a git workspace has
// changes. Three columns, the edges between them dragged (kept on this Mac): the files (a filter, words or a glob like
// spec/**, whose matches one click marks viewed; each a Viewed box: the PR's on GitHub, else this Mac's by the file's
// diff, so a change unticks it), every file's diff (one column or two, all folded or unfolded at once, Revert as in
// Changes, blame: the base's commits for lines taken out, the branch's for the rest; the PR's open threads at their lines
// with Apply), and the comments, hidden to a strip at the right edge: yours, kept on this Mac by workspace until they're
// sent (to an agent of the workspace as one message, or on the PR as one review: prReview), and everyone's on GitHub
// (the threads, open and resolved, a click goes to the line; the conversation and the reviews' summaries). A click on a
// line comments on it, a drag over lines on the range; a comment whose line is no longer in the diff says outdated. A
// file's (or a line's) right click: blame, the file on the repo's site (the base's or the branch's), Mark viewed by
// folder, Open in, Revert, Pin. Pinned files (kept on this Mac by workspace) go first in both lists. A hunk's arrows show
// the unchanged lines above it, the file's end those below (GitHub's expand: the worktree's file, read on the first
// click); the PR's own description is the comments column's PR tab. Read again as the workspace's stat moves.
// Keys: j/k the next or last file, v Viewed, b blame, p pin, c a comment (the line under the mouse, else the file's
// first change), ⌘⏎ sends to the agent.
import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type MouseEvent, type PointerEvent } from 'react'
import type { Blame, PR } from '../../shared/types'
import { globTest } from '../../shared/widgetSchema'
import { changeLine, CommentBox, CopyComment, DiffFind, useExpand, diffByFile, type DiffLine, DiffRows, type FileDiff, IMAGE, ImageDiff, lineClass, localStore, NO_DIFF, parentOf, sameLine, type Side, ThreadCard, threadKey, useGhViewed, useLoad, useRevert, useSuggestions, webItems, webSub } from './Diff'
import { ago, Avatar } from './Info'
import { Folded, Markdown } from './MarkdownView'
import type { PanelApi, Thread } from './SidePanel'
import { Icon, IconButton, keep as store, load, type MenuItem, useMenu } from './ui'

export type ReviewNote = { id: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT'; body: string; quote: string } // quote: the line as it was
// the PR's conversation, everyone's: a comment, or a review's summary (state: APPROVED, CHANGES_REQUESTED, COMMENTED)
export type Talk = { author: string; body: string; at: string; url?: string; state?: string }
export type ReviewApi = PanelApi & {
  send: (tab: string, text: string) => Promise<unknown>
  post: (comments: Omit<ReviewNote, 'id' | 'quote'>[]) => Promise<unknown> // prReview
  threadsAll: () => Promise<Thread[]> // the PR's review threads with everyone's comments (prThreads all)
  talk: () => Promise<Talk[]> // prTalk
  say: (body: string) => Promise<unknown> // prSay: a comment on the conversation, as you
  blame: (path: string, side: 'old' | 'new') => Promise<Blame>
}

const NOTES = 'laki.reviewNotes' // each workspace's comments not sent yet
const VIEWED = 'laki.reviewed' // each workspace's files viewed here: path → its diff's hash
const FILES_W = 'laki.reviewFilesW' // the files' column's width
const NOTES_W = 'laki.reviewNotesW' // the comments' column's width
const NOTES_OFF = 'laki.reviewNotesOff' // true: the comments hidden to a strip
const SIDE = 'laki.reviewSide' // the comments' column: yours (mine), the PR's description (pr) or GitHub's (gh)
const PINS = 'laki.reviewPins' // each workspace's pinned files, in the order pinned
const FILES_INIT = 220
const NOTES_INIT = 300
const STRIP = 28 // the hidden comments' strip
const readAll = <T,>(k: string) => load<Record<string, T>>(k, {})
const keepFor = <T,>(k: string, ws: string, v: T | undefined) => store(k, { ...readAll<T>(k), [ws]: v }) // undefined: dropped by JSON
const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}
const numOf = (l: DiffLine, side: 'LEFT' | 'RIGHT') => (side === 'LEFT' ? l.old : l.new)
const where = (n: Pick<ReviewNote, 'path' | 'line' | 'startLine' | 'side'>) => `${n.path}:${n.startLine ? `${n.startLine}-` : ''}${n.line}${n.side === 'LEFT' ? ' (taken out)' : ''}`
// the comments as one message to an agent
export const reviewText = (notes: ReviewNote[]) =>
  [`A review of your changes: ${notes.length} comment${notes.length === 1 ? '' : 's'}. Address each, then say what you changed.`, ...notes.map(n => `${where(n)} \`${n.quote.slice(1).trim()}\`\n${n.body}`)].join('\n\n')
// a folder's files and its folders, the deepest first
const foldersOf = (p: string) => {
  const out: string[] = []
  for (let x = parentOf(p); x; x = parentOf(x)) out.push(x)
  return out
}
// a commit's time in the blame: how long ago within a month, else its month
const when = (s: number) => (Date.now() / 1000 - s < 30 * 86400 ? ago(s * 1000) : new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }))
const STATES: Record<string, [string, string]> = { APPROVED: ['approved', 'good'], CHANGES_REQUESTED: ['changes requested', 'bad'], COMMENTED: ['reviewed', ''], DISMISSED: ['dismissed', ''] }

type At = { path: string; line: DiffLine; from?: number; text: string } // the box: the line it's on, a range's first number
type Blamed = { key: string; old?: Blame | string; new?: Blame | string } // key: the diff it was read for; a string: why there's none

// an edge between two columns: dragged (to: the pointer's x in the columns' box), double-clicked back to its width
function Edge({ x, to, done, reset }: { x: { left: number } | { right: number }; to: (x: number, box: DOMRect) => void; done: () => void; reset: () => void }) {
  const held = (e: PointerEvent<HTMLDivElement>) => e.currentTarget.hasPointerCapture(e.pointerId)
  return (
    <div
      className={`fr-edge ${'right' in x ? 'r' : ''}`}
      style={x}
      data-tip="Drag to resize · double-click to reset"
      onPointerDown={e => (e.currentTarget.setPointerCapture(e.pointerId), e.preventDefault())}
      onPointerMove={e => held(e) && to(e.clientX, e.currentTarget.parentElement!.getBoundingClientRect())}
      onLostPointerCapture={done}
      onDoubleClick={reset}
    />
  )
}

export function FullReview({ ws, base, branch, pr, linked, api, stat, onOpen }: { ws: string; base: string; branch?: string; pr?: Pick<PR, 'number' | 'url' | 'title' | 'body' | 'author' | 'base' | 'head'>; linked?: boolean; api: ReviewApi; stat: string; onOpen: (url: string) => void }) {
  const [whole, setWhole] = useState<boolean | null>(null)
  const all = !!pr && (whole ?? !!linked)
  const [d, err, reload] = useLoad(all ? api.prChanges : api.changes, `${ws}#${all}`, all ? 60000 : 15000)
  const first = useRef(true)
  useEffect(() => (first.current ? void (first.current = false) : reload()), [stat]) // its files moved: read again, the scroll and comments kept
  const byFile = useMemo(() => diffByFile(d?.diff ?? ''), [d])
  const files = d?.files ?? []
  const rv = useRevert(api, byFile, all, reload, `${ws}#${all}`)
  const [split, setSplit] = useState(() => localStore('laki.diffSplit') === 'split')
  const pickSplit = (on: boolean) => (setSplit(on), localStore('laki.diffSplit', on ? 'split' : 'unified'))
  const baseName = d?.base ?? base

  // the filter: words, or a glob (* or ?) as an extension's match takes it (a pattern without / is the file's name)
  const [q, setQ] = useState('')
  const filterBox = useRef<HTMLInputElement>(null)
  const query = q.trim()
  const matches = useMemo(() => (/[*?]/.test(query) ? globTest(query) : (p: string) => p.toLowerCase().includes(query.toLowerCase())), [query])
  // pinned files first, in the order pinned; one no longer in the diff stays pinned for when it's back
  const [pins, setPinsNow] = useState<string[]>(() => readAll<string[]>(PINS)[ws] ?? [])
  const pin = (p: string, on?: boolean) =>
    setPinsNow(ps => {
      const next = (on ?? !ps.includes(p)) ? [...ps.filter(x => x !== p), p] : ps.filter(x => x !== p) // ps: a second p before the render toggles back
      keepFor(PINS, ws, next.length ? next : undefined)
      return next
    })
  const listed = useMemo(() => {
    const ls = files.filter(f => matches(f.path))
    const at = (p: string) => pins.indexOf(p)
    return [...ls.filter(f => at(f.path) >= 0).sort((a, b) => at(a.path) - at(b.path)), ...ls.filter(f => at(f.path) < 0)]
  }, [files, matches, pins])
  const lastPin = listed.filter(f => pins.includes(f.path)).at(-1)?.path

  // Viewed: GitHub's for a file of the PR, else this Mac's while its diff is the one ticked
  const gh = useGhViewed(api, ws, pr?.number)
  const [local, setLocal] = useState<Record<string, string>>(() => readAll<Record<string, string>>(VIEWED)[ws] ?? {})
  const hashes = useMemo(() => new Map(files.map(f => [f.path, hash(byFile.get(f.path)?.hunks.join('\n') ?? f.status)])), [byFile, files])
  const hashOf = (p: string) => hashes.get(p) ?? ''
  const viewed = (p: string) => (gh.viewedOf(p) !== undefined ? gh.viewedOf(p) === 'VIEWED' : local[p] === hashOf(p))
  const [flip, setFlip] = useState<Set<string>>(new Set()) // folded or not, against what Viewed says
  const shown = (p: string) => viewed(p) === flip.has(p)
  const setShown = (ps: string[], open: boolean) =>
    setFlip(s => {
      const n = new Set(s)
      for (const p of ps) viewed(p) === open ? n.add(p) : n.delete(p)
      return n
    })
  const mark = (ps: string[], on: boolean) => {
    setFlip(s => new Set([...s].filter(p => !ps.includes(p))))
    gh.mark(ps.filter(p => gh.viewedOf(p) !== undefined && viewed(p) !== on), on)
    const mine = ps.filter(p => gh.viewedOf(p) === undefined)
    if (mine.length)
      setLocal(l => {
        const next = { ...l }
        for (const p of mine) {
          if (on) next[p] = hashOf(p)
          else delete next[p]
        }
        keepFor(VIEWED, ws, Object.keys(next).length ? next : undefined)
        return next
      })
  }
  const nViewed = files.filter(f => viewed(f.path)).length
  const listedViewed = listed.length > 0 && listed.every(f => viewed(f.path))
  const inFolder = (dir: string) => files.filter(f => f.path.startsWith(`${dir}/`)).map(f => f.path)

  // the PR's review threads, everyone's: the open ones at their lines (the PR's side as the diff has it), all of them in
  // the comments' GitHub list; and its conversation
  const [threads, thErr] = useLoad<Thread[] | null>(pr ? api.threadsAll : () => Promise.resolve(null), `${ws}#${pr?.number ?? ''}`, 60000)
  const said = (threads ?? []).filter(t => t.comments.length)
  const live = said.filter(t => !t.resolved)
  const open = live.filter(t => !t.outdated)
  const resolved = said.filter(t => t.resolved)
  const props = useSuggestions(api, open, ws, threads)
  const threadsAt = (path: string, l: DiffLine) => open.filter(t => t.path === path && t.line !== undefined && numOf(l, t.side ?? 'RIGHT') === t.line && (t.side === 'LEFT' ? l.new === undefined : l.new !== undefined))
  const [talk, talkErr, talkAgain] = useLoad<Talk[] | null>(pr ? api.talk : () => Promise.resolve(null), `${ws}#${pr?.number ?? ''}`, 60000)
  const [reply, setReply] = useState(() => localStore(`laki.reviewReply.${ws}`) ?? '') // the conversation's box: kept as it's typed, until it's sent
  const [replying, setReplying] = useState(false)
  const keepReply = (t: string) => (setReply(t), localStore(`laki.reviewReply.${ws}`, t))
  const sayIt = () => {
    if (!reply.trim() || replying) return
    setReplying(true)
    const sent = reply
    api.say(sent).then(() => (setReply(r => (r === sent ? (localStore(`laki.reviewReply.${ws}`, ''), '') : r)), talkAgain()), () => {}).finally(() => setReplying(false)) // what's typed meanwhile stays
  }
  const ghN = live.length + (talk?.length ?? 0)

  // blame, a file at a time: the base's for its old lines, the worktree's for its new ones
  // ponytail: not in the PR's diff (this worktree needn't be the PR's head); blame at the PR's head commit when asked
  const [blamed, setBlamed] = useState<Set<string>>(new Set())
  const [blames, setBlames] = useState<Record<string, Blamed>>({})
  const readBlame = (p: string) => {
    const st = files.find(f => f.path === p)?.status[0]
    const key = `${hashOf(p)}#${stat}` // a commit moves stat, not the diff: its lines aren't 'not committed' any more
    const get = (side: 'old' | 'new') => api.blame(p, side).then(b => b, (e: Error) => String(e?.message ?? e))
    void Promise.all([st === 'A' || st === '?' ? undefined : get('old'), st === 'D' ? undefined : get('new')]).then(([o, n]) => setBlames(b => ({ ...b, [p]: { key, old: o, new: n } })))
  }
  const blame = (p: string, on = !blamed.has(p)) => {
    if (all || IMAGE.test(p)) return
    setBlamed(s => new Set(on ? [...s, p] : [...s].filter(x => x !== p)))
    if (!on) return
    setShown([p], true)
    if (blames[p]?.key !== `${hashOf(p)}#${stat}`) readBlame(p)
  }
  useEffect(() => {
    for (const p of blamed) if (blames[p] && blames[p].key !== `${hashOf(p)}#${stat}`) readBlame(p) // its diff or its commits moved (a stat change reads the diff again: then)
  }, [byFile])
  const blameWhy = (p: string) => {
    const b = blames[p]
    if (!b) return 'blame…'
    const why = [b.old, b.new].filter(x => typeof x === 'string')
    return why.length ? `blame: ${[...new Set(why)].join(', ')}` : ''
  }
  // a line's commit at the start of each run of lines from the same one; on the side the column shows (one column: the
  // branch's, the base's for a line taken out)
  const gutterOf = (p: string, fd: FileDiff) => {
    const b = blames[p]
    if (all || !blamed.has(p)) return undefined
    const at = (l: DiffLine, side: Side) => {
      const s = side === 'both' ? (l.new !== undefined ? 'new' : 'old') : side
      const n = s === 'new' ? l.new : l.old
      const bl = b?.[s]
      return n !== undefined && typeof bl === 'object' ? bl.commits[bl.lines[n - 1]] : undefined
    }
    // the rows that start a run, in each column as it's drawn (one column: every line; two: the old side's, the new
    // side's), a hunk starting over
    const starts = { both: new Set<DiffLine>(), old: new Set<DiffLine>(), new: new Set<DiffLine>() }
    for (const side of ['both', 'old', 'new'] as const) {
      let prev: unknown = null
      for (const l of fd.lines) {
        if (l.text.startsWith('@@')) prev = null
        else if (side === 'both' || (side === 'old' ? l.old : l.new) !== undefined) {
          const c = at(l, side)?.sha
          if (c !== prev) starts[side].add(l)
          prev = c
        }
      }
    }
    return (l: DiffLine, side: Side) => {
      const c = at(l, side)
      if (!c) return <span className="dl-blame" />
      const zero = /^0+$/.test(c.sha)
      const again = !starts[side].has(l)
      return (
        <span
          className={`dl-blame ${zero ? 'mine' : ''}`}
          data-tip={zero ? 'Not committed yet' : `${c.sha.slice(0, 8)} · ${c.author} · ${new Date(c.at * 1000).toLocaleString()} · ${c.summary} · click: copy its id`}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => (e.stopPropagation(), zero || void navigator.clipboard.writeText(c.sha).catch(() => {}))}
        >
          {again ? '' : zero ? 'not committed' : `${c.author.split(/\s+/)[0]} · ${when(c.at)}`}
        </span>
      )
    }
  }

  // expand arrows: the unchanged lines around the hunks, from the worktree's file (what the diff's new side is), or for
  // the PR's diff the PR head's (prFile: this worktree needn't be at it); not an image or a file added or taken out
  const xp = useExpand(p => (all ? api.prFile(p) : api.read(p)), p => !IMAGE.test(p) && !/^[AD?]/.test(files.find(f => f.path === p)?.status ?? 'A'), p => `${all}#${hashOf(p)}`)

  // the comments, kept until sent
  const [notes, setNotesNow] = useState<ReviewNote[]>(() => readAll<ReviewNote[]>(NOTES)[ws] ?? [])
  const setNotes = (f: (n: ReviewNote[]) => ReviewNote[]) =>
    setNotesNow(n => {
      const next = f(n)
      keepFor(NOTES, ws, next.length ? next : undefined)
      return next
    })
  const outdated = (n: ReviewNote) => !!d && !(byFile.get(n.path)?.lines ?? []).some(l => numOf(l, n.side) === n.line && l.text === n.quote)
  const [at, setAt] = useState<At | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const add = () => {
    if (!at?.text.trim()) return
    const side = at.line.new === undefined ? 'LEFT' : 'RIGHT'
    setNotes(n => [...n, { id: Math.random().toString(36).slice(2), path: at.path, line: numOf(at.line, side)!, startLine: at.from, side, body: at.text.trim(), quote: at.line.text }])
    setAt(null)
    setSide('mine') // shown, not saved as the choice
  }
  const boxFor = (path: string) => (at?.path === path ? (byFile.get(path)?.lines.find(l => sameLine(l, at.line)) ?? byFile.get(path)?.lines.at(-1)) : undefined)
  // a click on a line: its box; a drag from one line to another of the file: the range, on the side of the last
  const down = useRef<{ path: string; l: DiffLine } | null>(null)
  const hover = useRef<{ path: string; l: DiffLine } | null>(null)
  const comment = (path: string, l: DiffLine, from?: number) => (l.old ?? l.new) !== undefined && setAt(a => (a?.path === path && sameLine(a.line, l) && a.from === from ? null : { path, line: l, from, text: a?.path === path && sameLine(a.line, l) ? a.text : '' }))
  const click = (path: string, l: DiffLine, e: MouseEvent) => !rv.onPick(path, l, e) && !window.getSelection()?.toString() && comment(path, l)
  const up = (path: string, l: DiffLine) => {
    const s = down.current
    down.current = null
    if (!s || s.path !== path || sameLine(s.l, l)) return
    const side = l.new === undefined ? 'LEFT' : 'RIGHT'
    const [a, b] = [numOf(s.l, side), numOf(l, side)]
    if (a === undefined || b === undefined || a === b) return
    window.getSelection()?.removeAllRanges()
    const [lo, hi] = a < b ? [s.l, l] : [l, s.l]
    comment(path, hi, numOf(lo, side))
  }

  // the file in view: the last whose head is at the top (j/k move it and scroll there)
  const body = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState('')
  const spy = () => {
    const el = body.current
    if (!el) return
    const heads = [...el.querySelectorAll<HTMLElement>('[data-file]')]
    const top = el.getBoundingClientRect().top + 8
    const h = heads.filter(x => x.getBoundingClientRect().top <= top).at(-1) ?? heads[0]
    if (h) setCur(h.dataset.file!)
  }
  const go = (p: string) => (setCur(p), body.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'start' }))
  const pinGo = (p: string) => (pin(p), setTimeout(() => go(p), 0)) // the lists move: the file stays in view
  // a line of a file (a comment's, a thread's), unfolded and lit; the filter let go when it hides the file
  const goLine = (path: string, n?: number, side: 'LEFT' | 'RIGHT' = 'RIGHT') => {
    if (!matches(path)) setQ('')
    setShown([path], true)
    setCur(path)
    setTimeout(() => {
      const sec = body.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(path)}"]`)?.parentElement
      const el = n ? sec?.querySelector<HTMLElement>(`[data-${side === 'LEFT' ? 'old' : 'new'}="${n}"]`) : null
      if (!el) return sec?.scrollIntoView({ block: 'start' })
      el.scrollIntoView({ block: 'center' })
      el.classList.add('fr-flash')
      setTimeout(() => el.classList.remove('fr-flash'), 1600)
    }, 60)
  }
  const here = cur && listed.some(f => f.path === cur) ? cur : listed[0]?.path

  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')
  const [menu, openMenu] = useMenu()
  const send = (tab: string) => {
    if (busy || !notes.length) return
    setBusy(true)
    setSent('')
    const out = notes
    api
      .send(tab, reviewText(out))
      .then(() => setNotes(n => n.filter(x => !out.includes(x))), e => setSent(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }
  const post = () => {
    if (busy || !notes.length) return
    setBusy(true)
    setSent('')
    const out = notes
    api
      .post(out.map(({ path, line, startLine, side, body }) => ({ path, line, startLine, side, body })))
      .then(() => setNotes(n => n.filter(x => !out.includes(x))), e => setSent(String(e?.message ?? e))) // GitHub's no: all of them stay
      .finally(() => setBusy(false))
  }

  // a file's right click (or a line's: the site's page at that line)
  const fileMenu = (e: MouseEvent, p: string, l?: DiffLine) => {
    const gone = files.find(f => f.path === p)?.status[0] === 'D'
    const dirs = foldersOf(p)
    const items: MenuItem[] = [
      ...(!all && !gone ? ([{ label: 'Show the file', icon: 'file', run: () => api.preview(p, l?.new) }, { label: 'Open in the editor', icon: 'code', run: () => api.openFile(p) }] as MenuItem[]) : []),
      ...(!all && !IMAGE.test(p) ? ([{ label: blamed.has(p) ? 'Hide blame' : 'Blame', icon: 'history', key: 'b', sub: "who last changed each line: the base's for lines taken out, the branch's for the rest", run: () => blame(p) }] as MenuItem[]) : []),
      ...webItems(api, p, baseName, branch, l),
      null,
      { label: viewed(p) ? 'Not viewed' : 'Viewed', icon: 'eye', key: 'v', run: () => mark([p], !viewed(p)) },
      { label: pins.includes(p) ? 'Unpin' : 'Pin to the top', icon: 'pin', key: 'p', sub: pins.includes(p) ? undefined : 'first in both lists, kept on this Mac', run: () => pinGo(p) },
      {
        label: 'Mark viewed',
        icon: 'checks',
        items: [
          ...dirs.map(dir => (n => ({ label: `Everything in ${dir}/`, icon: 'folder', sub: `${n} file${n === 1 ? '' : 's'}`, run: () => mark(inFolder(dir), true) }) as MenuItem)(inFolder(dir).length)),
          { label: 'Files matching a pattern…', icon: 'filter', sub: 'the filter, then Mark viewed', run: () => (setQ(dirs.length ? `${dirs.at(-1)}/**` : /\.[^.]+$/.exec(p) ? `*${/\.[^.]+$/.exec(p)![0]}` : '*'), setTimeout(() => filterBox.current?.select(), 0)) },
        ],
      },
      ...(api.fileItems && !gone ? [null, { label: 'Open in, copy path', icon: 'popOut', items: api.fileItems(p).filter(x => !(x && 'head' in x)) } as MenuItem] : []),
      ...(all ? [] : [null, { label: 'Revert this file…', icon: 'undo', danger: true, run: () => rv.revertFile(p) } as MenuItem]),
    ]
    openMenu(e, items)
  }

  // the keys, outside a field and under no dialog
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    const t = e.target as HTMLElement | null
    if (e.defaultPrevented || e.altKey || e.ctrlKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) || document.querySelector('.overlay, .ask-overlay, .menu, .settings-page')) return
    const i = listed.findIndex(f => f.path === here)
    if (e.metaKey) return void (e.key === 'Enter' && api.agents[0] && (e.preventDefault(), send(api.agents[0].id)))
    if (e.shiftKey) return
    const k = e.key.toLowerCase()
    if (k === 'j' || k === 'k') listed[i + (k === 'j' ? 1 : -1)] && go(listed[i + (k === 'j' ? 1 : -1)].path)
    else if (k === 'v' && here) mark([here], !viewed(here))
    else if (k === 'b' && here && !all) blame(here)
    else if (k === 'p' && here) pinGo(here)
    else if (k === 'c' && here) {
      const h = hover.current
      const l = h?.path === here ? h.l : byFile.get(here)?.lines.find(changeLine)
      if (!l) return
      setShown([here], true)
      comment(here, l)
    } else return
    e.preventDefault()
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  // the keyboard as it opens: the terminal behind it keeps it otherwise (Term only focuses), and j or c would go to its agent
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => root.current?.focus({ preventScroll: true }), [])

  // the columns: the files' and the comments' widths, the comments hidden to a strip; yours or GitHub's in it
  const [fw, setFw] = useState(() => load(FILES_W, FILES_INIT))
  const [nw, setNw] = useState(() => load(NOTES_W, NOTES_INIT))
  const [notesOff, setNotesOff] = useState(() => load(NOTES_OFF, false))
  const hideNotes = (off: boolean) => (setNotesOff(off), store(NOTES_OFF, off))
  const [side, setSide] = useState<'mine' | 'pr' | 'gh'>(() => load<'mine' | 'pr' | 'gh' | ''>(SIDE, '') || (notes.length || !pr ? 'mine' : 'gh'))
  const pickTab = (s: 'mine' | 'pr' | 'gh') => (setSide(s), store(SIDE, s))
  const tab = pr ? side : 'mine'
  const right = notesOff ? STRIP : nw

  const add_ = files.reduce((n, f) => n + (f.add ?? 0), 0)
  const del_ = files.reduce((n, f) => n + (f.del ?? 0), 0)
  const agent = api.agents[0]
  const anyOpen = listed.some(f => shown(f.path))
  const unread = listed.filter(f => !viewed(f.path)).map(f => f.path)
  const lineAttrs = (path: string, l: DiffLine) =>
    ({
      'data-old': l.old,
      'data-new': l.new,
      onMouseDown: (e: MouseEvent) => (rv.noSelect(e), (down.current = { path, l })),
      onMouseUp: () => up(path, l),
      onMouseEnter: () => (hover.current = { path, l }),
      onClick: (e: MouseEvent) => click(path, l, e),
      onContextMenu: (e: MouseEvent) => fileMenu(e, path, l),
    }) as HTMLAttributes<HTMLDivElement>
  // an expanded line: its numbers (a thread's or a comment's jump), the file's right click; no comment or Revert
  const ctxAttrs = (path: string, l: DiffLine) => ({ 'data-old': l.old, 'data-new': l.new, onContextMenu: (e: MouseEvent) => fileMenu(e, path, l) }) as HTMLAttributes<HTMLDivElement>
  return (
    <div className="full-review" ref={root} tabIndex={-1} data-find>
      <div className="fr-head">
        {pr && (
          <span className="seg">
            <button type="button" className={all ? '' : 'on'} data-tip="This workspace's changes: its branch against its base, and what isn't committed" onClick={() => setWhole(false)}>
              All changes vs {baseName}
            </button>
            <button type="button" className={all ? 'on' : ''} data-tip={`All of PR #${pr.number}, as GitHub has it (gh pr diff)`} onClick={() => setWhole(true)}>
              PR #{pr.number}
            </button>
          </span>
        )}
        <span className="muted small grow">
          {d ? (
            <>
              {files.length} file{files.length === 1 ? '' : 's'} · <span className="add">+{add_}</span> <span className="del">−{del_}</span>
              {!pr && ` vs ${d.base}`}
            </>
          ) : err ? '' : 'Loading…'}
        </span>
        <span className="fr-keys muted small" data-tip="j k: the next or last file · v: Viewed · b: blame · p: pin to the top · c: comment on the line under the mouse · ⌘⏎: send to the agent">
          j k · v · b · p · c · ⌘⏎
        </span>
        {anyOpen ? (
          <IconButton icon="collapse" title="Collapse all" onClick={() => setShown(listed.map(f => f.path), false)} />
        ) : (
          <IconButton icon="expand" title={unread.length && unread.length < listed.length ? 'Expand all but the viewed ones' : 'Expand all'} onClick={() => setShown(unread.length ? unread : listed.map(f => f.path), true)} />
        )}
        <IconButton icon={split ? 'unsplit' : 'splitRight'} title={split ? 'One column: the changes in one' : 'Two columns: before and after side by side'} on={split} onClick={() => pickSplit(!split)} />
        {pr && <IconButton icon="github" title="Files changed, on GitHub" onClick={() => onOpen(`${pr.url}/files`)} />}
        <IconButton icon="refresh" title="Refresh" onClick={reload} />
      </div>
      <div className="fr-cols" style={{ gridTemplateColumns: `${fw}px minmax(0, 1fr) ${right}px` }}>
        <div className="fr-files">
          <div className="fr-filter">
            <Icon name="filter" />
            <input
              ref={filterBox}
              value={q}
              placeholder="Filter: words, or spec/**"
              spellCheck={false}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), q ? setQ('') : e.currentTarget.blur())}
              data-tip="Words in a path, or a glob: spec/**, *.rb, **/*_test.go (no /: the file's name)"
            />
          </div>
          <div className={`fr-viewed muted small ${files.length && nViewed === files.length ? 'all' : ''}`}>
            <span className="grow">
              {nViewed} of {files.length} viewed{query && ` · ${listed.length} shown`}
            </span>
            {listed.length > 0 && (
              <button type="button" className="link small" onClick={() => mark(listed.map(f => f.path), !listedViewed)} data-tip={query ? `The ${listed.length} the filter shows` : 'Every file'}>
                {listedViewed ? (query ? 'Unmark these' : 'Unmark all') : query ? `Mark ${listed.length} viewed` : 'Mark all viewed'}
              </button>
            )}
          </div>
          {listed.map(f => (
            <div key={f.path} className={`sp-row ${f.path === here ? 'sel' : ''} ${viewed(f.path) ? 'fr-done' : ''} ${f.path === lastPin ? 'fr-pin-end' : ''}`} onClick={() => go(f.path)} onContextMenu={e => fileMenu(e, f.path)} data-tip={`${f.path} · right click: more`}>
              <span className={`st st-${f.status[0] === '?' ? 'A' : f.status[0]}`}>{f.status[0] === '?' ? 'A' : f.status[0]}</span>
              <span className="sp-name">
                {f.path.slice(f.path.lastIndexOf('/') + 1)} <span className="muted">{parentOf(f.path)}</span>
              </span>
              {(notes.some(n => n.path === f.path) || live.some(t => t.path === f.path)) && <Icon name="message" size={11} />}
              <button type="button" className={`fr-pin ${pins.includes(f.path) ? 'on' : ''}`} aria-label={pins.includes(f.path) ? 'Unpin' : 'Pin to the top'} data-tip={pins.includes(f.path) ? 'Pinned: first in both lists · click: unpin' : 'Pin to the top (p)'} onClick={e => (e.stopPropagation(), pinGo(f.path))}>
                <Icon name="pin" size={11} />
              </button>
              <label className="sp-viewed" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={viewed(f.path)} onChange={e => mark([f.path], e.target.checked)} />
              </label>
            </div>
          ))}
          {query && !listed.length && <div className="muted small pad">No file matches.</div>}
        </div>
        <Edge x={{ left: fw }} to={(x, box) => setFw(Math.round(Math.max(140, Math.min(x - box.left, 640, box.width - right - 320))))} done={() => store(FILES_W, fw)} reset={() => (setFw(FILES_INIT), store(FILES_W, FILES_INIT))} />
        <div className="fr-diff" ref={body} onScroll={() => requestAnimationFrame(spy)}>
          <DiffFind at={root} within={body} />
          {err && <div className="warn small pad">{err}</div>}
          {gh.err && <div className="warn small pad">{gh.err}</div>}
          {d && !files.length && <div className="muted small pad">{all ? `PR #${pr!.number} changes nothing.` : `No changes: the branch is where ${d.base} is, and nothing is uncommitted.`}</div>}
          {listed.map(f => {
            const fd = byFile.get(f.path) ?? NO_DIFF
            const fdx = xp.expanded(f.path, fd)
            const tail = xp.expander(f.path, fd, 'down')
            const box = boxFor(f.path)
            const fold = () => setShown([f.path], !shown(f.path))
            const blaming = !all && blamed.has(f.path)
            return (
              <section key={f.path} className={`sp-change fr-file ${viewed(f.path) ? 'viewed' : ''}`}>
                <div className="sp-row" data-file={f.path} onClick={fold} onContextMenu={e => fileMenu(e, f.path)}>
                  <span className="sp-chev">
                    <Icon name={shown(f.path) ? 'chevron' : 'chevronRight'} />
                  </span>
                  <span className={`st st-${f.status[0] === '?' ? 'A' : f.status[0]}`}>{f.status[0] === '?' ? 'A' : f.status[0]}</span>
                  <span className="sp-name">{f.path}</span>
                  {blaming && blameWhy(f.path) && <span className="muted small fr-why">{blameWhy(f.path)}</span>}
                  {f.add !== undefined && !IMAGE.test(f.path) && (
                    <span className="mono small">
                      <span className="add">+{f.add}</span> <span className="del">−{f.del ?? 0}</span>
                    </span>
                  )}
                  <IconButton icon="pin" title={pins.includes(f.path) ? 'Unpin (p)' : 'Pin to the top (p): first in both lists'} on={pins.includes(f.path)} onClick={e => (e.stopPropagation(), pinGo(f.path))} />
                  {!all && !IMAGE.test(f.path) && <IconButton icon="history" title={blaming ? 'Hide blame (b)' : "Blame (b): who last changed each line, the base's for lines taken out, the branch's for the rest"} on={blaming} onClick={e => (e.stopPropagation(), blame(f.path))} />}
                  {api.web && <IconButton icon="externalLink" title={`Open on remote: at ${baseName.replace(/^origin\//, '')} or at ${branch || 'the branch'}`} onClick={e => (e.stopPropagation(), openMenu(e, webSub(api, f.path, baseName, branch)))} />}
                  {f.status[0] !== 'D' && !all && <IconButton icon="file" title="Show the file" onClick={e => (e.stopPropagation(), api.preview(f.path))} />}
                  {f.status[0] !== 'D' && !all && <IconButton icon="code" title="Open in the editor" onClick={e => (e.stopPropagation(), api.openFile(f.path))} />}
                  <label className="sp-viewed fr-viewed-box" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={viewed(f.path)} onChange={e => mark([f.path], e.target.checked)} /> Viewed
                  </label>
                </div>
                {shown(f.path) && IMAGE.test(f.path) && !all && <ImageDiff api={api} path={f.path} status={f.status} />}
                {shown(f.path) && (!IMAGE.test(f.path) || all) && (
                  <div className={`sp-diff ${split ? 'split' : ''} ${blaming ? 'blamed' : ''}`}>
                    <DiffRows
                      fd={fdx}
                      split={split}
                      cls={l => (l.ctx ? 'dl dl-ctx' : lineClass(l, rv.picked(f.path, l)))}
                      row={l => (l.ctx ? ctxAttrs(f.path, l) : lineAttrs(f.path, l))}
                      head={l => (
                        <>
                          {l.hunk !== undefined && xp.expander(f.path, fd, l.hunk)}
                          {rv.hunkHead(f.path, l, fd.cut)}
                        </>
                      )}
                      gutter={gutterOf(f.path, fdx)}
                      after={l => (
                        <>
                          {threadsAt(f.path, l).map(t => (
                            <div key={threadKey(t)} className="fr-thread">
                              <ThreadCard t={t} api={api} noHead {...props(t)} />
                            </div>
                          ))}
                          {notes.filter(n => n.path === f.path && n.line === numOf(l, n.side) && n.quote === l.text).map(n => (
                            <div key={n.id} className="fr-inline" onClick={() => (pickTab('mine'), hideNotes(false), setEditing(n.id))}>
                              <Icon name="message" size={11} /> {n.body}
                            </div>
                          ))}
                          {at && l === box && <CommentBox path={f.path} line={at.line} from={at.from} text={at.text} setText={text => setAt(a => a && { ...a, text })} api={api} onAdd={add} onClose={() => setAt(null)} />}
                        </>
                      )}
                    />
                    {tail && <div className="fr-more">{tail}</div>}
                  </div>
                )}
              </section>
            )
          })}
          {rv.bar}
        </div>
        {notesOff ? (
          <button type="button" className="fr-strip" onClick={() => hideNotes(false)} data-tip="Show the comments">
            <Icon name="messages" />
            <span className="fr-vert">
              Comments{notes.length > 0 && ` · ${notes.length}`}
              {pr && ' · PR'}
              {pr && ghN > 0 && ` · GitHub ${ghN}`}
            </span>
          </button>
        ) : (
          <>
            <Edge x={{ right: nw }} to={(x, box) => setNw(Math.round(Math.max(200, Math.min(box.right - x, 720, box.width - fw - 320))))} done={() => store(NOTES_W, nw)} reset={() => (setNw(NOTES_INIT), store(NOTES_W, NOTES_INIT))} />
            <div className="fr-notes">
              <div className="fr-notes-head">
                {pr ? (
                  <span className="seg">
                    <button type="button" className={tab === 'mine' ? 'on' : ''} onClick={() => pickTab('mine')} data-tip="Your comments, not sent yet">
                      Yours{notes.length > 0 && ` ${notes.length}`}
                    </button>
                    <button type="button" className={tab === 'pr' ? 'on' : ''} onClick={() => pickTab('pr')} data-tip={`PR #${pr.number}: its title and description`}>
                      PR
                    </button>
                    <button type="button" className={tab === 'gh' ? 'on' : ''} onClick={() => pickTab('gh')} data-tip={`Everyone's on PR #${pr.number}: the open threads, then the conversation`}>
                      GitHub{ghN > 0 && ` ${ghN}`}
                    </button>
                  </span>
                ) : (
                  <h3>Comments {notes.length > 0 && <span className="sp-count">{notes.length}</span>}</h3>
                )}
                <span className="grow" />
                <IconButton icon="chevronsRight" title="Hide the comments" onClick={() => hideNotes(true)} />
              </div>
              {tab === 'mine' ? (
                <>
                  {!notes.length && <p className="muted small">Click a line to comment on it, or drag over lines. They wait here until you send them.</p>}
                  {notes.map(n => (
                    <div key={n.id} className={`fr-note ${outdated(n) ? 'outdated' : ''}`}>
                      <div className="fr-note-head">
                        <button className="link small mono" onClick={() => goLine(n.path, n.line, n.side)} data-tip="Go to the line">
                          {where(n)}
                        </button>
                        {outdated(n) && <span className="tag" data-tip="Its line isn't in the diff as it was any more">outdated</span>}
                        <span className="grow" />
                        <IconButton icon="pencil" title="Edit" onClick={() => setEditing(n.id)} />
                        <IconButton icon="x" title="Remove" onClick={() => setNotes(ns => ns.filter(x => x.id !== n.id))} />
                      </div>
                      <code className="fr-quote">{n.quote.slice(1).trim() || ' '}</code>
                      {editing === n.id ? (
                        <textarea
                          autoFocus
                          rows={3}
                          defaultValue={n.body}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Escape') setEditing(null)
                            else if (e.key === 'Enter' && e.metaKey) e.currentTarget.blur()
                          }}
                          onBlur={e => (setNotes(ns => ns.map(x => (x.id === n.id && e.target.value.trim() ? { ...x, body: e.target.value.trim() } : x))), setEditing(null))}
                        />
                      ) : (
                        <p className="fr-note-body" onClick={() => setEditing(n.id)}>
                          {n.body}
                        </p>
                      )}
                    </div>
                  ))}
                  {sent && <div className="warn small">{sent}</div>}
                  <div className="fr-send">
                    {agent ? (
                      <span className="split">
                        <button className="primary" disabled={busy || !notes.length} onClick={() => send(agent.id)} data-tip="One message, when its turn ends · ⌘⏎">
                          Send to {agent.name}
                        </button>
                        {api.agents.length > 1 && <IconButton icon="chevron" title="Another agent" disabled={busy || !notes.length} onClick={e => openMenu(e, api.agents.map(a => ({ label: a.name, icon: 'send', run: () => send(a.id) })))} />}
                      </span>
                    ) : (
                      <span className="muted small">No agent running here</span>
                    )}
                    {pr && (
                      <button disabled={busy || !notes.length} onClick={post} data-tip={`One review on GitHub, as you: each line must be in PR #${pr.number}'s diff`}>
                        Post on #{pr.number}
                      </button>
                    )}
                  </div>
                </>
              ) : tab === 'pr' && pr ? (
                <div className="fr-pr">
                  <h3>{pr.title || `PR #${pr.number}`}</h3>
                  <div className="fr-pr-meta muted small">
                    <span>#{pr.number}</span>
                    {pr.author && (
                      <>
                        <Avatar login={pr.author} size={14} />
                        <span>{pr.author}</span>
                      </>
                    )}
                    {pr.base && <span className="mono">{`${pr.head ?? branch ?? ''} → ${pr.base}`}</span>}
                  </div>
                  {pr.body?.trim() ? <Markdown src={pr.body} html /> : <p className="muted small">No description.</p>}
                  <button type="button" className="link small" onClick={() => onOpen(pr.url)}>
                    Open on GitHub
                  </button>
                </div>
              ) : (
                <>
                  {thErr && <div className="warn small">{thErr}</div>}
                  {!threads && !thErr && <span className="muted small">Loading…</span>}
                  {threads && !live.length && <span className="muted small">{resolved.length ? 'No open review comments' : 'No review comments on the code'}</span>}
                  {live.map(t => (
                    <div key={threadKey(t)} className="fr-gh">
                      <div className="fr-note-head">
                        <button className="link small mono" onClick={() => goLine(t.path, t.line, t.side)} data-tip={t.outdated ? 'Go to the file: the code moved since' : 'Go to the line'}>
                          {t.path}
                          {t.line ? `:${t.startLine ? `${t.startLine}-` : ''}${t.line}` : ''}
                        </button>
                        {t.outdated && <span className="tag">outdated</span>}
                      </div>
                      <ThreadCard t={t} api={api} noHead {...(t.outdated ? {} : props(t))} />
                    </div>
                  ))}
                  {resolved.length > 0 && (
                    <details className="sp-resolved">
                      <summary>{resolved.length} resolved</summary>
                      {resolved.map(t => (
                        <div key={threadKey(t)} className="fr-gh">
                          <button className="link small mono" onClick={() => goLine(t.path, t.line, t.side)}>
                            {t.path}
                            {t.line ? `:${t.line}` : ''}
                          </button>
                          <ThreadCard t={t} api={api} noHead />
                        </div>
                      ))}
                    </details>
                  )}
                  <h4 className="fr-talk-head">Conversation</h4>
                  {talkErr && <div className="warn small">{talkErr}</div>}
                  {!talk && !talkErr && <span className="muted small">Loading…</span>}
                  {talk && !talk.length && <span className="muted small">No comments on the PR itself</span>}
                  {talk?.map((c, i) => (
                    <div key={`${c.at}:${i}`} className="sp-comment fr-talk">
                      <div className="sp-comment-by">
                        <Avatar login={c.author} size={16} />
                        <b>{c.author}</b>
                        {c.state && STATES[c.state] && <span className={`tag ${STATES[c.state][1]}`}>{STATES[c.state][0]}</span>}
                        {c.at && <span className="muted">{ago(c.at)}</span>}
                        <span className="grow" />
                        {c.body.trim() && <CopyComment text={c.body} />}
                        {c.url && <IconButton icon="externalLink" title="On GitHub" onClick={() => onOpen(c.url!)} />}
                      </div>
                      {c.body.trim() && <Folded text={c.body} lines={10} html />}
                    </div>
                  ))}
                  {talk && (
                    <div className="fr-reply">
                      <textarea value={reply} rows={3} placeholder={`Reply on PR #${pr!.number}, as you (Markdown)`} aria-label="Reply on the PR's conversation" onChange={e => keepReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.metaKey && (e.preventDefault(), e.stopPropagation(), sayIt())} />
                      <button type="button" className="primary" disabled={!reply.trim() || replying} data-tip="Posted on GitHub as you · ⌘⏎" onClick={sayIt}>
                        {replying ? 'Posting…' : 'Comment'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
      {menu}
    </div>
  )
}
