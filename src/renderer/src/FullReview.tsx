// The full review (settings.fullReview, experimental): the tab bar's Review tab, first (⌘1) while a git workspace has
// changes. Three columns: the files (each a Viewed box: the PR's on GitHub, else this Mac's by the file's diff, so a
// change unticks it), every file's diff (one column or two, Revert as in Changes, the PR's open threads at their lines
// with Apply), and the comments gathered so far, each kept on this Mac by workspace until it's sent: to an agent of the
// workspace as one message, or on the PR as one review (prReview). A click on a line comments on it, a drag over lines
// on the range; a comment whose line is no longer in the diff says outdated. Read again as the workspace's stat moves.
// Keys: j/k the next or last file, v Viewed, c a comment (the line under the mouse, else the file's first change), ⌘⏎
// sends to the agent.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { changeLine, CommentBox, diffByFile, type DiffLine, DiffRows, IMAGE, ImageDiff, lineClass, localStore, NO_DIFF, parentOf, sameLine, ThreadCard, threadKey, useGhViewed, useLoad, useRevert, useSuggestions } from './Diff'
import type { PanelApi, Thread } from './SidePanel'
import { Icon, IconButton, useMenu } from './ui'

export type ReviewNote = { id: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT'; body: string; quote: string } // quote: the line as it was
export type ReviewApi = PanelApi & {
  agents: { id: string; name: string }[] // the workspace's live agent tabs, the one to send to first
  send: (tab: string, text: string) => Promise<unknown>
  post: (comments: Omit<ReviewNote, 'id' | 'quote'>[]) => Promise<unknown> // prReview
}

const NOTES = 'laki.reviewNotes' // each workspace's comments not sent yet
const VIEWED = 'laki.reviewed' // each workspace's files viewed here: path → its diff's hash
const readAll = <T,>(k: string): Record<string, T> => {
  try {
    return JSON.parse(localStore(k) ?? '{}') ?? {}
  } catch {
    return {}
  }
}
const keep = <T,>(k: string, ws: string, v: T | undefined) => {
  const all = readAll<T>(k)
  if (v === undefined) delete all[ws]
  else all[ws] = v
  localStore(k, JSON.stringify(all))
}
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

type At = { path: string; line: DiffLine; from?: number; text: string } // the box: the line it's on, a range's first number

export function FullReview({ ws, base, pr, linked, api, stat, onOpen }: { ws: string; base: string; pr?: { number: number; url: string }; linked?: boolean; api: ReviewApi; stat: string; onOpen: (url: string) => void }) {
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

  // Viewed: GitHub's for a file of the PR, else this Mac's while its diff is the one ticked
  const gh = useGhViewed(api, ws, pr?.number)
  const [local, setLocal] = useState<Record<string, string>>(() => readAll<Record<string, string>>(VIEWED)[ws] ?? {})
  const hashOf = (p: string) => hash(byFile.get(p)?.hunks.join('\n') ?? files.find(f => f.path === p)?.status ?? '')
  const viewed = (p: string) => (gh.viewedOf(p) !== undefined ? gh.viewedOf(p) === 'VIEWED' : local[p] === hashOf(p))
  const [flip, setFlip] = useState<Set<string>>(new Set()) // folded or not, against what Viewed says
  const shown = (p: string) => viewed(p) === flip.has(p)
  const mark = (p: string, on: boolean) => {
    setFlip(s => (s.delete(p), new Set(s)))
    if (gh.viewedOf(p) !== undefined) return gh.mark(p, on)
    const next = { ...local }
    if (on) next[p] = hashOf(p)
    else delete next[p]
    setLocal(next)
    keep(VIEWED, ws, Object.keys(next).length ? next : undefined)
  }
  const nViewed = files.filter(f => viewed(f.path)).length

  // the PR's open review threads, at their lines (the PR's side as the diff has it)
  const [threads] = useLoad<Thread[] | null>(pr ? api.threads : () => Promise.resolve(null), `${ws}#${pr?.number ?? ''}`, 60000)
  const open = (threads ?? []).filter(t => t.comments.length && !t.resolved && !t.outdated)
  const props = useSuggestions(api, open, ws, threads)
  const threadsAt = (path: string, l: DiffLine) => open.filter(t => t.path === path && t.line !== undefined && numOf(l, t.side ?? 'RIGHT') === t.line && (t.side === 'LEFT' ? l.new === undefined : l.new !== undefined))

  // the comments, kept until sent
  const [notes, setNotesNow] = useState<ReviewNote[]>(() => readAll<ReviewNote[]>(NOTES)[ws] ?? [])
  const setNotes = (f: (n: ReviewNote[]) => ReviewNote[]) =>
    setNotesNow(n => {
      const next = f(n)
      keep(NOTES, ws, next.length ? next : undefined)
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
  const here = cur && files.some(f => f.path === cur) ? cur : files[0]?.path

  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [menu, openMenu] = useMenu()
  const send = (tab: string) => {
    if (busy || !notes.length) return
    setBusy(true)
    setSaid('')
    const sent = notes
    api
      .send(tab, reviewText(sent))
      .then(() => setNotes(n => n.filter(x => !sent.includes(x))), e => setSaid(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }
  const post = () => {
    if (busy || !notes.length) return
    setBusy(true)
    setSaid('')
    const sent = notes
    api
      .post(sent.map(({ path, line, startLine, side, body }) => ({ path, line, startLine, side, body })))
      .then(() => setNotes(n => n.filter(x => !sent.includes(x))), e => setSaid(String(e?.message ?? e))) // GitHub's no: all of them stay
      .finally(() => setBusy(false))
  }

  // the keys, outside a field and under no dialog
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    const t = e.target as HTMLElement | null
    if (e.defaultPrevented || e.altKey || e.ctrlKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) || document.querySelector('.overlay, .ask-overlay, .menu')) return
    const i = files.findIndex(f => f.path === here)
    if (e.metaKey) return void (e.key === 'Enter' && api.agents[0] && (e.preventDefault(), send(api.agents[0].id)))
    if (e.shiftKey) return
    const k = e.key.toLowerCase()
    if (k === 'j' || k === 'k') files[i + (k === 'j' ? 1 : -1)] && go(files[i + (k === 'j' ? 1 : -1)].path)
    else if (k === 'v' && here) mark(here, !viewed(here))
    else if (k === 'c' && here) {
      const h = hover.current
      const l = h?.path === here ? h.l : byFile.get(here)?.lines.find(changeLine)
      if (!l) return
      if (!shown(here)) setFlip(s => new Set(s.has(here) ? (s.delete(here), s) : s.add(here)))
      comment(here, l)
    } else return
    e.preventDefault()
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  const add_ = files.reduce((n, f) => n + (f.add ?? 0), 0)
  const del_ = files.reduce((n, f) => n + (f.del ?? 0), 0)
  const agent = api.agents[0]
  return (
    <div className="full-review">
      <div className="fr-head">
        {pr && (
          <span className="seg">
            <button type="button" className={all ? '' : 'on'} data-tip="This workspace's changes: its branch against its base, and what isn't committed" onClick={() => setWhole(false)}>
              All changes vs {d?.base ?? base}
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
        <span className="fr-keys muted small" data-tip="j k: the next or last file · v: Viewed · c: comment on the line under the mouse · ⌘⏎: send to the agent">
          j k · v · c · ⌘⏎
        </span>
        <IconButton icon={split ? 'unsplit' : 'splitRight'} title={split ? 'One column: the changes in one' : 'Two columns: before and after side by side'} on={split} onClick={() => pickSplit(!split)} />
        {pr && <IconButton icon="github" title="Files changed, on GitHub" onClick={() => onOpen(`${pr.url}/files`)} />}
        <IconButton icon="refresh" title="Refresh" onClick={reload} />
      </div>
      <div className="fr-cols">
        <div className="fr-files">
          <div className={`fr-viewed muted small ${files.length && nViewed === files.length ? 'all' : ''}`}>
            {nViewed} of {files.length} viewed
          </div>
          {files.map(f => (
            <div key={f.path} className={`sp-row ${f.path === here ? 'sel' : ''} ${viewed(f.path) ? 'fr-done' : ''}`} onClick={() => go(f.path)} data-tip={f.path}>
              <span className={`st st-${f.status[0] === '?' ? 'A' : f.status[0]}`}>{f.status[0] === '?' ? 'A' : f.status[0]}</span>
              <span className="sp-name">
                {f.path.slice(f.path.lastIndexOf('/') + 1)} <span className="muted">{parentOf(f.path)}</span>
              </span>
              {notes.some(n => n.path === f.path) && <Icon name="message" size={11} />}
              <label className="sp-viewed" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={viewed(f.path)} onChange={e => mark(f.path, e.target.checked)} />
              </label>
            </div>
          ))}
        </div>
        <div className="fr-diff" ref={body} onScroll={() => requestAnimationFrame(spy)}>
          {err && <div className="warn small pad">{err}</div>}
          {gh.err && <div className="warn small pad">{gh.err}</div>}
          {d && !files.length && <div className="muted small pad">{all ? `PR #${pr!.number} changes nothing.` : `No changes: the branch is where ${d.base} is, and nothing is uncommitted.`}</div>}
          {files.map(f => {
            const fd = byFile.get(f.path) ?? NO_DIFF
            const box = boxFor(f.path)
            const fold = () => setFlip(s => new Set(s.has(f.path) ? (s.delete(f.path), s) : s.add(f.path)))
            return (
              <section key={f.path} className={`sp-change fr-file ${viewed(f.path) ? 'viewed' : ''}`}>
                <div className="sp-row" data-file={f.path} onClick={fold} onContextMenu={e => !all && openMenu(e, [{ label: 'Revert this file…', icon: 'undo', danger: true, run: () => rv.revertFile(f.path) }])}>
                  <span className="sp-chev">
                    <Icon name={shown(f.path) ? 'chevron' : 'chevronRight'} />
                  </span>
                  <span className={`st st-${f.status[0] === '?' ? 'A' : f.status[0]}`}>{f.status[0] === '?' ? 'A' : f.status[0]}</span>
                  <span className="sp-name">{f.path}</span>
                  {f.add !== undefined && !IMAGE.test(f.path) && (
                    <span className="mono small">
                      <span className="add">+{f.add}</span> <span className="del">−{f.del ?? 0}</span>
                    </span>
                  )}
                  {f.status[0] !== 'D' && !all && <IconButton icon="file" title="Show the file" onClick={e => (e.stopPropagation(), api.preview(f.path))} />}
                  <label className="sp-viewed fr-viewed-box" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={viewed(f.path)} onChange={e => mark(f.path, e.target.checked)} /> Viewed
                  </label>
                </div>
                {shown(f.path) && IMAGE.test(f.path) && !all && <ImageDiff api={api} path={f.path} status={f.status} />}
                {shown(f.path) && (!IMAGE.test(f.path) || all) && (
                  <div className={`sp-diff ${split ? 'split' : ''}`}>
                    <DiffRows
                      fd={fd}
                      split={split}
                      cls={l => lineClass(l, rv.picked(f.path, l))}
                      row={l => ({
                        onMouseDown: e => (rv.noSelect(e), (down.current = { path: f.path, l })),
                        onMouseUp: () => up(f.path, l),
                        onMouseEnter: () => (hover.current = { path: f.path, l }),
                        onClick: e => click(f.path, l, e),
                      })}
                      head={l => rv.hunkHead(f.path, l, fd.cut)}
                      after={l => (
                        <>
                          {threadsAt(f.path, l).map(t => (
                            <div key={threadKey(t)} className="fr-thread">
                              <ThreadCard t={t} api={api} noHead {...props(t)} />
                            </div>
                          ))}
                          {notes.filter(n => n.path === f.path && n.line === numOf(l, n.side) && n.quote === l.text).map(n => (
                            <div key={n.id} className="fr-inline" onClick={() => setEditing(n.id)}>
                              <Icon name="message" size={11} /> {n.body}
                            </div>
                          ))}
                          {at && l === box && <CommentBox path={f.path} line={at.line} from={at.from} text={at.text} setText={text => setAt(a => a && { ...a, text })} api={api} onAdd={add} onClose={() => setAt(null)} />}
                        </>
                      )}
                    />
                  </div>
                )}
              </section>
            )
          })}
          {rv.bar}
        </div>
        <div className="fr-notes">
          <h3>
            Comments {notes.length > 0 && <span className="sp-count">{notes.length}</span>}
          </h3>
          {!notes.length && <p className="muted small">Click a line to comment on it, or drag over lines. They wait here until you send them.</p>}
          {notes.map(n => (
            <div key={n.id} className={`fr-note ${outdated(n) ? 'outdated' : ''}`}>
              <div className="fr-note-head">
                <button className="link small mono" onClick={() => go(n.path)} data-tip="Go to the file">
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
          {said && <div className="warn small">{said}</div>}
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
        </div>
      </div>
      {menu}
    </div>
  )
}
