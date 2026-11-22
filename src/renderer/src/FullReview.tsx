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
import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type MouseEvent } from 'react'
import type { Blame, PR } from '../../shared/types'
import { hunkKey, REST, startOf, type Walk } from '../../shared/walk'
import { globTest } from '../../shared/widgetSchema'
import { SplitToggle, useSplit, type Annot, AnnotRows, annotClass, annotsOn, NO_ANNOTS, useAnnots, atHead, canPage, ChangeMap, changeLine, CommentBox, CopyComment, DiffFind, useExpand, diffByFile, type DiffLine, DiffRows, type FileDiff, IMAGE, ImageDiff, lineClass, localStore, NO_DIFF, parentOf, sameLine, ScopeSeg, type Side, ThreadCard, threadKey, useGhViewed, useLoad, useRevert, useScope, useSuggestions, webItems, webSub } from './Diff'
import { ago, Avatar } from './Info'
import { Folded, Markdown } from './MarkdownView'
import type { PanelApi, Thread } from './SidePanel'
import { Edge, Icon, IconButton, keep as store, load, type MenuItem, useMenu, act, ScrollEdge } from './ui'
import { fileTree, hunkNext, prName, prNo, reviewList } from './text'
import './review.css'

export type ReviewNote = { id: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT'; body: string; quote: string } // quote: the line as it was
// the PR's conversation, everyone's: a comment, or a review's summary (state: APPROVED, CHANGES_REQUESTED, COMMENTED)
export type Talk = { author: string; body: string; at: string; url?: string; state?: string }
export type ReviewApi = PanelApi & {
  send: (tab: string, text: string) => Promise<unknown>
  post: (comments: Omit<ReviewNote, 'id' | 'quote'>[]) => Promise<unknown> // prReview
  threadsAll: () => Promise<Thread[]> // the PR's review threads with everyone's comments (prThreads all)
  talk: () => Promise<Talk[]> // prTalk
  say: (body: string) => Promise<unknown> // prSay: a comment on the conversation, as you
  blame: (path: string, side: 'old' | 'new', uncommitted?: boolean) => Promise<Blame> // old: at the base, or HEAD (uncommitted)
  notesGet: () => Promise<{ notes: ReviewNote[]; at?: number }> // R10: the daemon's copy of the unsent comments (at: none, never set there)
  notesSet: (notes: ReviewNote[]) => Promise<unknown>
  mark: () => Promise<unknown> // R11: Since I reviewed starts here (reviewMark)
  walk?: (uncommitted: boolean, o?: { again?: boolean; kept?: boolean }) => Promise<Walk | null> // R13: reviewSteps (none: an older daemon)
  walkOff?: string // why Walk through can't ask (Laki AI is off)
}

const NOTES = 'laki.reviewNotes' // each workspace's comments not sent yet: a cache of the daemon's (R10: reviewNotesGet), drawn at once
const VIEWED = 'laki.reviewed' // each workspace's files viewed here: path → its diff's hash
const FILES_W = 'laki.reviewFilesW' // the files' column's width
const NOTES_W = 'laki.reviewNotesW' // the comments' column's width
const DIFF_MIN = 480 // U6: the diff's least width
const HEAD_MIN = 720 // under it the head's count is +a −d alone
const NOTES_OFF = 'laki.reviewNotesOff' // true: the comments hidden to a strip
const UNVIEWED = 'laki.reviewUnviewed' // true: only the files not viewed yet
const FILES_OFF = 'laki.reviewFilesOff' // true: the files hidden to a strip, likewise
const SIDE = 'laki.reviewSide' // the comments' column: yours (mine), the PR's description (pr) or GitHub's (gh)
const PINS = 'laki.reviewPins' // each workspace's pinned files, in the order pinned
const WALK_SEEN = 'laki.reviewWalkSeen' // each workspace's Walk through: its hash and the steps viewed
const FILES_INIT = 220
const NOTES_INIT = 300
const STRIP = 28 // a hidden column's strip: the files', the comments'
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

// U2: the review's keys, as its Keys popover lists them (the handler: onKey)
const REVIEW_KEYS: [string, string][] = [['j', 'Next file'], ['k', 'Previous file'], [']', 'Next change'], ['[', 'Previous change'], ['v', 'Mark the file viewed'], ['b', 'Blame'], ['p', 'Pin the file to the top'], ['c', 'Comment on the line under the mouse'], ['⌘⏎', 'Send the comments to the agent; none, every file viewed: review the next workspace']]
// next: the workspace to review after this one (shared/nextStep.ts reviewQueue: App's), its bar once every file is viewed
// (asked only then: the queue walks every workspace)
type Next = { name: string; files?: number; pr: string; more: number; key?: string; go: () => void } // files: its diff's, once scanned
export function FullReview({ ws, base, branch, pr, linked, empty, worktree, api: wsApi, stat, onOpen, onTight, next }: { ws: string; base: string; branch?: string; pr?: Pick<PR, 'number' | 'url' | 'title' | 'body' | 'author' | 'base' | 'head' | 'forge'>; linked?: boolean; empty?: boolean; worktree: boolean; api: ReviewApi; stat: string; onOpen: (url: string) => void; onTight?: () => void; next?: () => Next | undefined }) {
  const [scope, setScope] = useScope('laki.reviewScope', !!pr && pr.forge !== 'gitlab', !!linked, worktree, false, empty) // Diff.tsx: Branch, Uncommitted, PR #n
  const all = scope === 'pr'
  const unc = scope === 'uncommitted'
  const api = atHead(wsApi, unc) // its reads and reverts against HEAD
  const [d, err, reload] = useLoad(all ? api.prChanges : api.changes, `${ws}#${scope}`, all ? 60000 : 15000)
  const first = useRef(true)
  useEffect(() => (first.current ? void (first.current = false) : reload()), [stat]) // its files moved: read again, the scroll and comments kept
  const byFile = useMemo(() => diffByFile(d?.diff ?? ''), [d])
  const files = d?.files ?? []
  const rv = useRevert(api, byFile, all, reload, `${ws}#${scope}`)
  const sp = useSplit() // T18: one column under 900px
  const split = sp.split
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
  // the files column by folder (text.ts fileTree; the pinned ones first, as they are), the last one picked (laki.diffTree,
  // Changes' too; unset: a tree here). In a tree the diffs and j/k go in its order, folders' files together
  const [tree, setTree] = useState(() => localStore('laki.diffTree') !== 'list')
  const pickTree = (on: boolean) => (setTree(on), localStore('laki.diffTree', on ? 'tree' : 'list'))
  const matched = useMemo(() => {
    const ls = files.filter(f => matches(f.path))
    const at = (p: string) => pins.indexOf(p)
    const rest = ls.filter(f => at(f.path) < 0)
    return [...ls.filter(f => at(f.path) >= 0).sort((a, b) => at(a.path) - at(b.path)), ...(tree ? fileTree(rest).flatMap(r => ('file' in r ? [r.file] : [])) : rest)]
  }, [files, matches, pins, tree])
  const [dirsShut, setDirsShut] = useState<Set<string>>(new Set())
  const shutDir = (d: string) => setDirsShut(o => (o.has(d) ? (o.delete(d), new Set(o)) : new Set(o.add(d))))

  // Viewed: GitHub's for a file of the PR, else this Mac's while its diff is the one ticked
  const gh = useGhViewed(api, ws, pr?.number)
  const [local, setLocal] = useState<Record<string, string>>(() => readAll<Record<string, string>>(VIEWED)[ws] ?? {})
  const hashes = useMemo(() => new Map(files.map(f => [f.path, hash(byFile.get(f.path)?.hunks.join('\n') ?? f.status)])), [byFile, files])
  const hashOf = (p: string) => hashes.get(p) ?? ''
  const viewed = (p: string) => (gh.viewedOf(p) !== undefined ? gh.viewedOf(p) === 'VIEWED' : local[p] === hashOf(p))
  const [flip, setFlip] = useState<Set<string>>(new Set()) // folded or not, against what Viewed says
  const shown = (p: string) => viewed(p) === flip.has(p)
  // Unviewed: only the files not viewed yet (the filter's among them); one just marked stays a frame, then the next
  // takes its place
  const [only, setOnly] = useState(() => load(UNVIEWED, false))
  const pickOnly = (on: boolean) => (setOnly(on), store(UNVIEWED, on))
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())
  const listed = reviewList(matched, viewed, only, leaving)
  const lastPin = listed.filter(f => pins.includes(f.path)).at(-1)?.path
  const setShown = (ps: string[], open: boolean) =>
    setFlip(s => {
      const n = new Set(s)
      for (const p of ps) viewed(p) === open ? n.add(p) : n.delete(p)
      return n
    })
  const mark = (ps: string[], on: boolean) => {
    if (only && on) {
      const i = listed.findIndex(f => f.path === here)
      const to = ps.includes(here ?? '') ? (listed.slice(i + 1).find(f => !ps.includes(f.path) && !viewed(f.path)) ?? listed.slice(0, i).findLast(f => !ps.includes(f.path) && !viewed(f.path))) : undefined
      setLeaving(new Set(ps))
      requestAnimationFrame(() => (setLeaving(new Set()), to && go(to.path)))
    }
    if (on && files.length && files.every(f => ps.includes(f.path) || viewed(f.path))) void wsApi.mark().catch(() => {}) // R11: the last one viewed: a review done
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

  // R13: Walk through: the diff in steps by Laki AI (the daemon's reviewSteps, kept by the diff's hash: read back as the
  // tab opens or the diff changes, with no call). The files column shows the steps (Files | Steps goes back); a picked
  // step shows only its changes; a step viewed marks its files viewed once every step with a change of theirs is
  const [walk, setWalk] = useState<Walk | null>(null)
  const [walking, setWalking] = useState(false)
  const [walkErr, setWalkErr] = useState('')
  const [stepsOn, setStepsOn] = useState(true)
  const [step, setStep] = useState<number | null>(null)
  const [seenSteps, setSeenSteps] = useState<number[]>([])
  const walkOk = !!wsApi.walk && !all
  const walkWhy = all ? "Walk through reads the branch's changes: pick Branch" : wsApi.walkOff
  const walkScope = useRef(scope) // an answer for a scope left meanwhile is dropped
  walkScope.current = scope
  const walkSet = (w: Walk, open = false) => {
    setWalk(w)
    setStep(null)
    if (open) setStepsOn(true) // asked: the steps; a kept one read again keeps Files | Steps as it was
    setSeenSteps((x => (x?.hash === w.hash && x.at === w.at ? x.seen : []))(readAll<{ hash: string; at: number; seen: number[] }>(WALK_SEEN)[ws])) // Again: the same diff, other steps
  }
  const walkAsk = (again = false) => {
    const at = scope
    setWalking(true)
    setWalkErr('')
    wsApi.walk!(unc, { again }).then(
      w => (setWalking(false), walkScope.current === at && w && (walkSet(w, true), hideFiles(false))), // the steps are in the files column: unfolded
      e => (setWalking(false), walkScope.current === at && setWalkErr((e as Error).message)),
    )
  }
  // the diff's changes as the walk names them (a file with none: start 0); one not in the walk, or gone: it's stale
  const nowKeys = useMemo(() => new Set([...byFile].flatMap(([p, fd]) => (fd.hunks.length ? fd.hunks.map(h => hunkKey({ file: p, start: startOf(h) })) : [hunkKey({ file: p, start: 0 })]))), [byFile])
  const walkKeys = walk?.steps.flatMap(x => x.hunks.map(hunkKey)) ?? []
  const stale = !!walk && !!d && (walkKeys.length !== nowKeys.size || walkKeys.some(k => !nowKeys.has(k)))
  useEffect(() => (setWalk(null), setWalkErr('')), [scope]) // another scope's changes: none until its kept one is read
  useEffect(() => {
    if (!walkOk) return void setWalk(null)
    let on = true
    wsApi.walk!(unc, { kept: true }).then(w => on && w && walkSet(w), () => {})
    return () => void (on = false)
  }, [scope, walkOk, stale ? hash(d?.diff ?? '') : ''])
  const picked = walk && step !== null ? walk.steps[step] : undefined
  const stepFiles = picked ? [...new Set(picked.hunks.map(h => h.file))].flatMap(p => files.filter(f => f.path === p)) : []
  // a file's lines in the picked step: only its changes there (the hunks' indices kept: Revert's and the expander's)
  const inStep = (path: string, fd: FileDiff): FileDiff => {
    if (!picked) return fd
    const want = new Set(picked.hunks.filter(h => h.file === path).map(h => h.start))
    const keep = new Set(fd.hunks.flatMap((h, i) => (want.has(startOf(h)) ? [i] : [])))
    return keep.size ? { ...fd, lines: fd.lines.filter(l => l.hunk === undefined || keep.has(l.hunk)) } : fd
  }
  const pickStep = (i: number | null) => {
    setStep(i)
    if (i === null || !walk) return
    setShown([...new Set(walk.steps[i].hunks.map(h => h.file))], true)
    requestAnimationFrame(() => body.current?.scrollTo({ top: 0 }))
  }
  const seeStep = (i: number, on: boolean) => {
    if (!walk) return
    const next = on ? [...new Set([...seenSteps, i])] : seenSteps.filter(x => x !== i)
    setSeenSteps(next)
    keepFor(WALK_SEEN, ws, { hash: walk.hash, at: walk.at, seen: next })
    const mine = [...new Set(walk.steps[i].hunks.map(h => h.file))].filter(p => files.some(f => f.path === p))
    const ps = on ? mine.filter(p => !viewed(p) && walk.steps.every((x, j) => next.includes(j) || !x.hunks.some(h => h.file === p))) : [] // unticked: the step alone (a file viewed stays: yours, GitHub's)
    if (ps.length) mark(ps, true)
  }

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
  // a commit moves stat, not the diff: its lines aren't 'not committed' any more; its old side is the base's or HEAD's
  const blameKey = (p: string) => `${hashOf(p)}#${stat}#${unc}`
  const readBlame = (p: string) => {
    const st = files.find(f => f.path === p)?.status[0]
    const key = blameKey(p)
    const get = (side: 'old' | 'new') => api.blame(p, side, unc).then(b => b, (e: Error) => String(e?.message ?? e))
    void Promise.all([st === 'A' || st === '?' ? undefined : get('old'), st === 'D' ? undefined : get('new')]).then(([o, n]) => setBlames(b => ({ ...b, [p]: { key, old: o, new: n } })))
  }
  const blame = (p: string, on = !blamed.has(p)) => {
    if (all || IMAGE.test(p)) return
    setBlamed(s => new Set(on ? [...s, p] : [...s].filter(x => x !== p)))
    if (!on) return
    setShown([p], true)
    if (blames[p]?.key !== blameKey(p)) readBlame(p)
  }
  useEffect(() => {
    for (const p of blamed) if (blames[p] && blames[p].key !== blameKey(p)) readBlame(p) // its diff or its commits moved (a stat change reads the diff again: then)
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
          {...act(e => (e.stopPropagation(), zero || void navigator.clipboard.writeText(c.sha).catch(() => {})))}
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
  // R10: the daemon keeps them (another window, the phone, a cleared cache see the same); this window's copy draws them at
  // once, moves in once (a daemon that never had them), and each change goes there 400 ms after the last (and as it closes)
  const [notes, setNotesNow] = useState<ReviewNote[]>(() => readAll<ReviewNote[]>(NOTES)[ws] ?? [])
  const notesOut = useRef<{ t?: ReturnType<typeof setTimeout>; next?: ReviewNote[]; touched?: boolean }>({})
  const notesFlush = () => {
    const o = notesOut.current
    clearTimeout(o.t)
    if (o.next) void wsApi.notesSet(o.next).catch(() => {}) // an older daemon: the cache still has them
    o.next = undefined
  }
  useEffect(() => {
    let on = true
    wsApi.notesGet().then(
      r => {
        if (!on || notesOut.current.touched) return // changed meanwhile: that goes there instead
        if (r.at !== undefined) return void (setNotesNow(r.notes), keepFor(NOTES, ws, r.notes.length ? r.notes : undefined))
        const mine = readAll<ReviewNote[]>(NOTES)[ws] ?? []
        if (mine.length) void wsApi.notesSet(mine).catch(() => {})
      },
      () => {},
    )
    return () => ((on = false), notesFlush())
  }, [ws])
  const setNotes = (f: (n: ReviewNote[]) => ReviewNote[]) =>
    setNotesNow(n => {
      const next = f(n)
      keepFor(NOTES, ws, next.length ? next : undefined)
      const o = notesOut.current
      clearTimeout(o.t)
      Object.assign(o, { next, touched: true, t: setTimeout(notesFlush, 400) })
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
  // P6: extensions' notes on lines, each added as a comment of yours (its words, its fix) to send with the rest
  const annotsAll = useAnnots(wsApi)
  const annots = all ? NO_ANNOTS : annotsAll // the worktree's lines: not a PR's diff
  const noteOf = (path: string, a: Annot, l: DiffLine): ReviewNote => ({ id: Math.random().toString(36).slice(2), path, line: a.line, side: 'RIGHT', body: `${a.name}: ${a.text}${a.fix ? `\nFix: ${a.fix}` : ''}`, quote: l.text })
  const addAnnot = (path: string, a: Annot, l: DiffLine) => (setNotes(n => [...n, noteOf(path, a, l)]), setSide('mine'), hideNotes(false))
  // on a line of the diff; kept while the notes and the diff stay (not each keystroke in a box)
  const shownAnnots = useMemo(() => [...annots].flatMap(([path, by]) => (fd => (fd ? [...by].flatMap(([n, as]) => (l => (l ? as.map(a => noteOf(path, a, l)) : []))(fd.lines.find(l => l.new === n && !l.text.startsWith('@@')))) : []))(byFile.get(path))), [annots, byFile])
  const addAll = () => (setNotes(n => [...n, ...shownAnnots.filter(x => !n.some(y => y.path === x.path && y.line === x.line && y.body === x.body))]), setSide('mine'))
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
    const h = heads.filter(x => (x.parentElement ?? x).getBoundingClientRect().top <= top).at(-1) ?? heads[0] // its section's box (R10: a head inside one off screen isn't laid out; asking would lay every file out each frame)
    if (h) setCur(h.dataset.file!)
  }
  const go = (p: string) => (setCur(p), body.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'start' }))
  const pinGo = (p: string) => (pin(p), setTimeout(() => go(p), 0)) // the lists move: the file stays in view
  // ] and [: the next or previous change (a hunk's @@ head) below its file's sticky head, into the next or previous file
  // at a file's end; only the files near are asked where theirs are (.sp-change's content-visibility: R10)
  const hunk = (dir: 1 | -1) => {
    const box = body.current
    if (!box) return
    const top = box.getBoundingClientRect().top
    const secs = [...box.querySelectorAll<HTMLElement>('section.fr-file')]
    for (const s of dir > 0 ? secs : secs.reverse()) {
      const r = s.getBoundingClientRect()
      if (dir > 0 ? r.bottom <= top : r.top >= top) continue // wholly above the top (going back: below it)
      const head = s.querySelector<HTMLElement>('[data-file]')?.offsetHeight ?? 0
      const tops = [...s.querySelectorAll<HTMLElement>('[data-hunk]')].map(h => h.parentElement!.getBoundingClientRect().top - top - head)
      const i = hunkNext(tops, dir)
      if (i >= 0) return void box.scrollTo({ top: box.scrollTop + tops[i], behavior: document.documentElement.dataset.motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }
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
      .then(() => (setNotes(n => n.filter(x => !out.includes(x))), void api.mark().catch(() => {})), e => setSent(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }
  const post = () => {
    if (busy || !notes.length) return
    setBusy(true)
    setSent('')
    const out = notes
    api
      .post(out.map(({ path, line, startLine, side, body }) => ({ path, line, startLine, side, body })))
      .then(() => (setNotes(n => n.filter(x => !out.includes(x))), void api.mark().catch(() => {})), e => setSent(String(e?.message ?? e))) // GitHub's no: all of them stay
      .finally(() => setBusy(false))
  }

  // a file's right click (or a line's: the site's page at that line)
  const fileMenu = (e: MouseEvent, p: string, l?: DiffLine) => {
    const gone = files.find(f => f.path === p)?.status[0] === 'D'
    const dirs = foldersOf(p)
    const items: MenuItem[] = [
      ...(!all && !gone ? ([{ label: 'Show the file', icon: 'file', run: () => api.preview(p, l?.new) }, { label: 'Open in the editor', icon: 'code', run: () => api.openFile(p) }] as MenuItem[]) : []),
      ...(!all && !IMAGE.test(p) ? ([{ label: blamed.has(p) ? 'Hide blame' : 'Blame', icon: 'history', key: 'b', sub: "who last changed each line: the base's for lines taken out, the branch's for the rest", run: () => blame(p) }] as MenuItem[]) : []),
      ...webItems(all ? { ...api, page: undefined } : api, p, baseName, branch, l), // a PR's file may not be this worktree's: no View as page
      null,
      { label: viewed(p) ? 'Not viewed' : 'Viewed', icon: 'eye', key: 'v', run: () => mark([p], !viewed(p)) },
      { label: pins.includes(p) ? 'Unpin' : 'Pin to the top', icon: 'pin', key: 'p', sub: pins.includes(p) ? undefined : 'first in both lists, kept on this Mac', run: () => pinGo(p) },
      {
        label: 'Mark viewed',
        icon: 'checks',
        items: [
          ...dirs.map(dir => (n => ({ label: `Everything in ${dir}/`, icon: 'folder', sub: `${n} file${n === 1 ? '' : 's'}`, run: () => mark(inFolder(dir), true) }) as MenuItem)(inFolder(dir).length)),
          { label: 'Files matching a pattern…', icon: 'filter', sub: 'the filter, then Mark viewed', run: () => (hideFiles(false), setQ(dirs.length ? `${dirs.at(-1)}/**` : /\.[^.]+$/.exec(p) ? `*${/\.[^.]+$/.exec(p)![0]}` : '*'), setTimeout(() => filterBox.current?.select(), 0)) },
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
    else if (k === ']' || k === '[') hunk(k === ']' ? 1 : -1)
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
  const nx = d && nViewed === files.length ? next?.() : undefined
  const goNext = useRef(nx?.go)
  goNext.current = nx?.go
  useEffect(() => {
    const f = () => goNext.current?.()
    window.addEventListener('laki-review-next', f)
    return () => window.removeEventListener('laki-review-next', f)
  }, [])
  // the keyboard as it opens: the terminal behind it keeps it otherwise (Term only focuses), and j or c would go to its agent
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => root.current?.focus({ preventScroll: true }), [])

  // the columns: the files' and the comments' widths, the comments hidden to a strip; yours or GitHub's in it
  const [fw, setFw] = useState(() => load(FILES_W, FILES_INIT))
  const [nw, setNw] = useState(() => load(NOTES_W, NOTES_INIT))
  const [notesOff, setNotesOff] = useState(() => load(NOTES_OFF, false))
  const hideNotes = (off: boolean) => (setNotesOff(off), store(NOTES_OFF, off))
  const [filesOff, setFilesOff] = useState(() => load(FILES_OFF, false))
  const hideFiles = (off: boolean) => (setFilesOff(off), store(FILES_OFF, off))
  const [side, setSide] = useState<'mine' | 'pr' | 'gh'>(() => load<'mine' | 'pr' | 'gh' | ''>(SIDE, '') || (notes.length || !pr ? 'mine' : 'gh'))
  const pickTab = (s: 'mine' | 'pr' | 'gh') => (setSide(s), store(SIDE, s))
  const tab = pr ? (side === 'gh' && pr.forge === 'gitlab' ? 'pr' : side) : 'mine' // an MR has no GitHub tab
  const left = filesOff ? STRIP : fw
  // U6: the diff keeps DIFF_MIN of the tab's own width (a ResizeObserver: the side panel and the sidebar take theirs):
  // too narrow, the comments fold to their strip first (not saved: your choice comes back with the room), then the side
  // panel goes while this tab shows (onTight: App's, until you leave it), then the head's count loses its "n files"
  const [rw, setRw] = useState(0)
  useEffect(() => {
    const o = new ResizeObserver(([e]) => setRw(Math.round(e.contentRect.width)))
    o.observe(root.current!)
    return () => o.disconnect()
  }, [])
  const autoOff = !notesOff && rw > 0 && rw - left - nw < DIFF_MIN
  const noNotes = notesOff || autoOff
  const right = noNotes ? STRIP : nw
  const tight = rw > 0 && rw - left - STRIP < DIFF_MIN
  useEffect(() => void (tight && onTight?.()), [tight])

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
  const fileRow = (f: (typeof files)[number], depth?: number) => (
            <div key={f.path} className={`sp-row ${f.path === here ? 'sel' : ''} ${viewed(f.path) ? 'fr-done' : ''} ${f.path === lastPin ? 'fr-pin-end' : ''}`} style={depth === undefined ? undefined : { paddingLeft: 8 + depth * 12 }} {...act(() => go(f.path), f.status[0] !== 'D' && api.look && (() => api.look!(f.path)))} {...(f.status[0] !== 'D' && api.drag && { draggable: true, onDragStart: (e: React.DragEvent) => (e.preventDefault(), api.drag!(f.path)) })} onContextMenu={e => fileMenu(e, f.path)} data-tip={`${f.path} · Space: Quick Look · right click: more`}>
              <span className={`st st-${f.status[0] === '?' ? 'A' : f.status[0]}`}>{f.status[0] === '?' ? 'A' : f.status[0]}</span>
              <span className="sp-name">
                {f.path.slice(f.path.lastIndexOf('/') + 1)} {depth === undefined && <span className="muted">{parentOf(f.path)}</span>}
              </span>
              {(notes.some(n => n.path === f.path) || live.some(t => t.path === f.path)) && <Icon name="message" size={11} />}
              <button type="button" className={`fr-pin ${pins.includes(f.path) ? 'on' : ''}`} aria-label={pins.includes(f.path) ? 'Unpin' : 'Pin to the top'} data-tip={pins.includes(f.path) ? 'Pinned: first in both lists · click: unpin' : 'Pin to the top (p)'} onClick={e => (e.stopPropagation(), pinGo(f.path))}>
                <Icon name="pin" size={11} />
              </button>
              <label className="sp-viewed" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={viewed(f.path)} onChange={e => mark([f.path], e.target.checked)} />
              </label>
            </div>
  )
  return (
    <div className="full-review" ref={root} tabIndex={-1} data-find>
      <div className="fr-head">
        <ScopeSeg scope={scope} onScope={setScope} pr={pr} worktree={worktree} branch={`All changes vs ${baseName}`} />
        <span className="muted small grow">
          {d ? (
            <>
              {!(rw > 0 && rw < HEAD_MIN) && `${files.length} file${files.length === 1 ? '' : 's'} · `}<span className="add">+{add_}</span> <span className="del">−{del_}</span>
              {unc ? ' not committed' : !pr && !worktree ? ` vs ${d.base}` : ''}
            </>
          ) : err ? '' : 'Loading…'}
        </span>
        {wsApi.walk && files.length > 0 && (
          <button type="button" className={`ghost fr-walk-btn ${walk && stepsOn && !filesOff ? 'on' : ''}`} aria-disabled={walking || (!walk && !!walkWhy) || undefined} data-tip={walking ? 'Laki AI reads the changes' : walk ? 'The steps Laki AI put the changes in' : (walkWhy ?? 'Laki AI puts the changes in 3 to 7 steps to read in order')} onClick={() => (walking || (!walk && walkWhy) ? undefined : walk ? (setStepsOn(true), hideFiles(false)) : walkAsk())}>
            <Icon name="map" size={12} /> {walking ? 'Reading…' : 'Walk through'}
          </button>
        )}
        {/* U2: the keys in a popover, each with what it does: no bare legend */}
        <button type="button" className="ghost fr-keys-btn" aria-haspopup="menu" onClick={e => openMenu(e, [{ head: 'Keys in the review' }, ...REVIEW_KEYS.map(([k, what]) => ({ label: what, hint: k, run: () => {} }))])}>
          Keys
        </button>
        {anyOpen ? (
          <IconButton icon="collapse" title="Collapse all" onClick={() => setShown(listed.map(f => f.path), false)} />
        ) : (
          <IconButton icon="expand" title={unread.length && unread.length < listed.length ? 'Expand all but the viewed ones' : 'Expand all'} onClick={() => setShown(unread.length ? unread : listed.map(f => f.path), true)} />
        )}
        <SplitToggle s={sp} />
        {pr && <IconButton icon="github" title="Files changed, on GitHub" onClick={() => onOpen(`${pr.url}/files`)} />}
        <IconButton icon="refresh" title="Refresh" onClick={reload} />
      </div>
      <div className="fr-cols" style={{ gridTemplateColumns: `${left}px minmax(min(${DIFF_MIN}px, 100% - ${left + right}px), 1fr) ${right}px` }}>
        {filesOff ? (
          <button type="button" className="fr-strip left" onClick={() => hideFiles(false)} data-tip="Show the files">
            <Icon name="files" />
            <span className="fr-vert">
              Files · {nViewed} of {files.length} viewed
            </span>
          </button>
        ) : (
        <div className="fr-files">
          <ScrollEdge />
          {walk && walkOk && (
            <div className="fr-walk-seg">
              <span className="seg">
                <button type="button" className={stepsOn ? '' : 'on'} aria-pressed={!stepsOn} onClick={() => (setStepsOn(false), setStep(null))}>
                  Files
                </button>
                <button type="button" className={stepsOn ? 'on' : ''} aria-pressed={stepsOn} onClick={() => setStepsOn(true)}>
                  Steps
                </button>
              </span>
              <span className="grow" />
              <IconButton icon="chevronsLeft" title="Hide the steps" onClick={() => hideFiles(true)} />
            </div>
          )}
          {walk && walkOk && stepsOn ? (
            <div className="fr-steps">
              <div className="fr-viewed muted small">
                <span className="grow">
                  {seenSteps.length} of {walk.steps.length} steps viewed
                </span>
                <button type="button" className="link small" onClick={() => !walking && !walkWhy && walkAsk(true)} aria-disabled={walking || !!walkWhy || undefined} data-tip={walkWhy ?? 'Laki AI puts the changes in steps again'}>
                  {walking ? 'Reading…' : 'Again'}
                </button>
              </div>
              {stale && <div className="warn small pad">The changes moved since these steps: a step may miss some, or name ones gone. Again asks anew.</div>}
              {walk.cut && <div className="muted small pad">{walk.skipped ? `${walk.skipped} change${walk.skipped === 1 ? '' : 's'} Laki AI did not read (too big): under ${REST}.` : `Over 200 KB: Laki AI read the first part, the rest is under ${REST}.`}</div>}
              {walk.steps.map((x, i) => {
                const risky = [...new Set(x.hunks.flatMap(h => (h.risky ? [h.risky] : [])))]
                const n = new Set(x.hunks.map(h => h.file)).size
                return (
                  <div key={i} className={`sp-row fr-step ${step === i ? 'sel' : ''} ${seenSteps.includes(i) ? 'fr-done' : ''}`} {...act(() => pickStep(step === i ? null : i))} data-tip={step === i ? 'Click: every change again' : undefined}>
                    <span className="fr-step-n">{x.rest ? '…' : i + 1}</span>
                    <span className="fr-step-text">
                      <span className="fr-step-title">{x.title}</span>
                      {x.why && <span className="muted small">{x.why}</span>}
                      <span className="muted small">
                        {x.hunks.length} change{x.hunks.length === 1 ? '' : 's'} in {n} file{n === 1 ? '' : 's'}
                        {x.rest && walk.skipped ? ` · ${walk.skipped} Laki AI did not read` : ''}
                      </span>
                    </span>
                    {risky.length > 0 && (
                      <span className="fr-risk" role="img" aria-label={`Read with care: ${risky.join(', ')}`} data-tip={`Read with care: ${risky.join(', ')}`}>
                        <Icon name="alertCircle" size={12} />
                      </span>
                    )}
                    <label className="sp-viewed" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={seenSteps.includes(i)} onChange={e => seeStep(i, e.target.checked)} aria-label={`${x.title}: viewed`} />
                    </label>
                  </div>
                )
              })}
            </div>
          ) : (
          <>
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
            {files.length > 1 && (
              <span className="seg fr-shape">
                <button type="button" className={tree ? '' : 'on'} aria-pressed={!tree} aria-label="List" data-tip="Every file with its folder" onClick={() => pickTree(false)}>
                  <Icon name="list" size={12} />
                </button>
                <button type="button" className={tree ? 'on' : ''} aria-pressed={tree} aria-label="Tree" data-tip="The files by folder: a click folds one" onClick={() => pickTree(true)}>
                  <Icon name="tree" size={12} />
                </button>
              </span>
            )}
            <IconButton icon="chevronsLeft" title="Hide the files" onClick={() => hideFiles(true)} />
          </div>
          <div className={`fr-viewed muted small ${files.length && nViewed === files.length ? 'all' : ''}`}>
            {files.length > 0 && (
              <span className="seg fr-only">
                <button type="button" className={only ? 'on' : ''} aria-pressed={only} onClick={() => pickOnly(!only)} data-tip={only ? 'Only the files not viewed yet · click: every file' : 'Show only the files not viewed yet'}>
                  Unviewed {files.length - nViewed} / {files.length}
                </button>
              </span>
            )}
            <span className="grow">
              {nViewed} of {files.length} viewed{query && ` · ${listed.length} shown`}
            </span>
            {listed.length > 0 && (
              <button type="button" className="link small" onClick={() => mark(listed.map(f => f.path), !listedViewed)} data-tip={query ? `The ${listed.length} the filter shows` : 'Every file'}>
                {listedViewed ? (query ? 'Unmark these' : 'Unmark all') : query ? `Mark ${listed.length} viewed` : 'Mark all viewed'}
              </button>
            )}
          </div>
          {tree
            ? [
                ...listed.filter(f => pins.includes(f.path)).map(f => fileRow(f)),
                ...fileTree(listed.filter(f => !pins.includes(f.path)), dirsShut).map(r => {
                  if (!('dir' in r)) return fileRow(r.file, r.depth)
                  const inDir = listed.filter(f => f.path.startsWith(`${r.dir}/`) && !pins.includes(f.path)).map(f => f.path)
                  const seen = inDir.filter(viewed).length
                  return (
                    <div key={`dir:${r.dir}`} className={`sp-row sp-dir ${seen === inDir.length ? 'fr-done' : ''}`} style={{ paddingLeft: 8 + r.depth * 12 }} {...act(() => shutDir(r.dir))} onContextMenu={e => openMenu(e, [{ label: seen === inDir.length ? 'Not viewed' : 'Mark viewed', icon: 'eye', run: () => mark(inDir, seen !== inDir.length) }, { label: dirsShut.size ? 'Unfold every folder' : 'Fold every folder', icon: 'tree', run: () => setDirsShut(dirsShut.size ? new Set() : new Set(fileTree(listed).flatMap(x => ('dir' in x ? [x.dir] : [])))) }])} data-tip={`${r.dir}: ${seen} of ${inDir.length} viewed · right click: more`}>
                      <Icon name={dirsShut.has(r.dir) ? 'folder' : 'folderOpen'} size={12} />
                      <span className="sp-name">{r.name}</span>
                      <span className="muted small">{seen ? `${seen}/${inDir.length}` : inDir.length}</span>
                      <label className="sp-viewed" onClick={e => e.stopPropagation()} data-tip={`Every file in ${r.name} viewed`}>
                        <input type="checkbox" checked={seen === inDir.length} ref={el => void (el && (el.indeterminate = seen > 0 && seen < inDir.length))} onChange={e => mark(inDir, e.target.checked)} aria-label={`${r.name}: every file viewed`} />
                      </label>
                    </div>
                  )
                }),
              ]
            : listed.map(f => fileRow(f))}
          {query && !listed.length && <div className="muted small pad">{only && matched.length ? 'Every file it matches is viewed.' : 'No file matches.'}</div>}
          {only && !query && files.length > 0 && !listed.length && <div className="muted small pad">Every file viewed.</div>}
          </>
          )}
        </div>
        )}
        {!filesOff && <Edge x={{ left: fw }} to={(x, box) => setFw(Math.round(Math.max(140, Math.min(x - box.left, 640, box.width - right - 320))))} done={() => store(FILES_W, fw)} reset={() => (setFw(FILES_INIT), store(FILES_W, FILES_INIT))} init={FILES_INIT} />}
        <div className="fr-diff" ref={el => void ((body.current = el), sp.room(el))} onScroll={() => requestAnimationFrame(spy)}>
          <DiffFind at={root} within={body} unfold={w => setShown(files.filter(f => !shown(f.path) && byFile.get(f.path)?.hunks.some(h => h.toLowerCase().includes(w))).map(f => f.path), true)} />
          {err && <div className="warn small pad">{err}</div>}
          {gh.err && <div className="warn small pad">{gh.err}</div>}
          {walkErr && <div className="warn small pad">Walk through: {walkErr}</div>}
          {picked && (
            <div className="fr-step-bar small">
              <Icon name="map" size={12} />
              <span className="grow">
                Step {picked.rest ? '' : `${step! + 1} `}of {walk!.steps.length}: {picked.title}
              </span>
              <button type="button" className="link small" onClick={() => pickStep(null)}>
                Every change
              </button>
            </div>
          )}
          {d && !files.length && <div className="muted small pad">{all ? `PR #${pr!.number} changes nothing.` : `No changes: the branch is where ${d.base} is, and nothing is uncommitted.`}</div>}
          {(picked ? stepFiles : listed).map(f => {
            const fd = inStep(f.path, byFile.get(f.path) ?? NO_DIFF)
            const fdx = xp.expanded(f.path, fd)
            const tail = xp.expander(f.path, fd, 'down')
            const box = boxFor(f.path)
            const fold = () => setShown([f.path], !shown(f.path))
            const blaming = !all && blamed.has(f.path)
            return (
              <section key={f.path} className={`sp-change fr-file ${viewed(f.path) ? 'viewed' : ''}`}>
                <div className="sp-row edge-blur" data-file={f.path} {...act(fold)} onContextMenu={e => fileMenu(e, f.path)}>
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
                  {f.status[0] !== 'D' && !all && canPage(api, f.path) && <IconButton icon="globe" title="View as page: the file as it is in the worktree now" onClick={e => (e.stopPropagation(), api.page!(f.path))} />}
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
                      cls={l => (l.ctx ? 'dl dl-ctx' : lineClass(l, rv.picked(f.path, l))) + annotClass(annotsOn(annots, f.path, l))}
                      row={l => (l.ctx ? ctxAttrs(f.path, l) : lineAttrs(f.path, l))}
                      head={l => (
                        <>
                          <span data-hunk hidden />
                          {l.hunk !== undefined && xp.expander(f.path, fd, l.hunk)}
                          {rv.hunkHead(f.path, l, fd.cut)}
                        </>
                      )}
                      gutter={gutterOf(f.path, fdx)}
                      after={l => (
                        <>
                          <AnnotRows as={annotsOn(annots, f.path, l)} add={a => addAnnot(f.path, a, l)} />
                          {threadsAt(f.path, l).map(t => (
                            <div key={threadKey(t)} className="fr-thread">
                              <ThreadCard t={t} api={api} noHead {...props(t)} />
                            </div>
                          ))}
                          {notes.filter(n => n.path === f.path && n.line === numOf(l, n.side) && n.quote === l.text).map(n => (
                            <div key={n.id} className="fr-inline" {...act(() => (pickTab('mine'), hideNotes(false), setEditing(n.id)))}>
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
        <ChangeMap at={body} />
        {noNotes ? (
          <button type="button" className="fr-strip" onClick={() => hideNotes(false)} data-tip={autoOff ? 'The comments: folded while the diff has no room (widen the window, or hide the files)' : 'Show the comments'}>
            <Icon name="messages" />
            <span className="fr-vert">
              Comments{notes.length > 0 && ` · ${notes.length}`}
              {pr && ' · PR'}
              {pr && ghN > 0 && ` · GitHub ${ghN}`}
            </span>
          </button>
        ) : (
          <>
            <Edge x={{ right: nw }} to={(x, box) => setNw(Math.round(Math.max(200, Math.min(box.right - x, 720, box.width - left - 320))))} done={() => store(NOTES_W, nw)} reset={() => (setNw(NOTES_INIT), store(NOTES_W, NOTES_INIT))} init={NOTES_INIT} />
            <div className="fr-notes">
              <div className="fr-notes-head">
                {pr ? (
                  <span className="seg">
                    <button type="button" className={tab === 'mine' ? 'on' : ''} onClick={() => pickTab('mine')} data-tip="Your comments, not sent yet">
                      Yours{notes.length > 0 && ` ${notes.length}`}
                    </button>
                    <button type="button" className={tab === 'pr' ? 'on' : ''} onClick={() => pickTab('pr')} data-tip={`${prName(pr)}: its title and description`}>
                      PR
                    </button>
                    {pr.forge !== 'gitlab' && <button type="button" className={tab === 'gh' ? 'on' : ''} onClick={() => pickTab('gh')} data-tip={`Everyone's on PR #${pr.number}: the open threads, then the conversation`}>
                      GitHub{ghN > 0 && ` ${ghN}`}
                    </button>}
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
                  {shownAnnots.length > 0 && (
                    <button type="button" className="link small" onClick={addAll} title="Each extension's note on a line of this diff, as a comment of yours">
                      Add {shownAnnots.length} extension note{shownAnnots.length === 1 ? '' : 's'}
                    </button>
                  )}
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
                        <p className="fr-note-body" {...act(() => setEditing(n.id))}>
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
                      <button disabled={busy || !notes.length || pr.forge === 'gitlab'} onClick={post} data-tip={pr.forge === 'gitlab' ? 'GitHub only for now: send them to the agent' : `One review on GitHub, as you: each line must be in PR #${pr.number}'s diff`}>
                        Post on {prNo(pr)}
                      </button>
                    )}
                  </div>
                </>
              ) : tab === 'pr' && pr ? (
                <div className="fr-pr">
                  <h3>{pr.title || prName(pr)}</h3>
                  <div className="fr-pr-meta muted small">
                    <span>{prNo(pr)}</span>
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
      {nx && (
        // every file viewed (or none changed): the next one to review, ⌘⏎ (keydown.ts reviewNext) unless comments wait to go
        <div className="fr-next" data-go={notes.length ? undefined : ''} role="status">
          <Icon name="check" />
          <span className="grow">
            Next: <b>{nx.name}</b>{nx.files !== undefined && ` · ${nx.files} file${nx.files === 1 ? '' : 's'}`} · {nx.pr}
            {nx.more > 0 && <span className="muted"> · {nx.more} more to review</span>}
          </span>
          <button type="button" className="primary sm" onClick={nx.go} data-tip={notes.length ? 'Your comments here stay; ⌘⏎ sends them first' : undefined}>
            Review it{nx.key && !notes.length && <kbd>{nx.key}</kbd>}
          </button>
        </div>
      )}
      {menu}
    </div>
  )
}
