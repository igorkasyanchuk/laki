// The sidebar's Needs you list (settings.needsList, on unless false): every tab App's needsYou matches (the Dock count's
// and ⌘J's rule) in text.ts' needsSorted order: waiting ones first, the oldest first; then done ones, the newest first;
// a done one older than settings.staleAfter (isStale) under a folded Earlier row (laki.needsEarlier), dimmed. A waiting
// agent's card answers it (its menu's options, or Allow / Deny for a permission prompt with none read); a done one's
// says what it answered, Changes opens Changes (only with changes to look at: the scan's stat, else an agent's tab that
// isn't a shell's), Seen clears its ●; Earlier's Seen all clears them all. Each card's chevron shows or hides that
// detail (open but for a stale one); anywhere else on a card opens the tab, whatever its state. With a card focused,
// 1–9 answer and Enter opens.
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { Ask, AskExplained, TabView, View, WorkspaceView } from '../../shared/types'
import { bulkGroups, bulkOk, bulkPick, groupAsks, optLabel } from '../../shared/ask'
import { api } from './api'
import { wsName } from './appCtx'
import { AskDiff, Choice, choiceProps, useExplain, useSayWhy } from './Diff'
import { ProofList } from './Proof'
import type { SpendView } from './Spend'
import { Glyph } from './Glyph'
import { isStale, STALE_AFTER } from './text'
import { ask, Elapsed, Icon, MidText, Num } from './ui'

export type Need = { t: TabView; w: WorkspaceView }
export type NeedsApi = {
  keep: (t: TabView) => void // a turn that ended on an API error: goes on
  dismiss: (t: TabView) => void
  open: (t: TabView, from?: HTMLElement) => void // from: the card clicked (it flies into the tab: ui.tsx cardMorph)
  answer: (t: TabView, n: number, label: string, say?: string) => void // say: No, and say why (Diff.tsx useSayWhy)
  answerFor?: (t: TabView, n: number, label: string) => Promise<unknown> // a group's choice, one tab at a time: its failure that tab's own
  pick: (t: TabView, pick: 'first' | 'last') => void // a permission prompt with no menu read: Allow / Deny
  permission: (t: TabView) => boolean // its last wait said "permission" (the turn event's text)
  review: (t: TabView) => void
  seen: (t: TabView) => void
  seenAll: (ts: TabView[]) => void // Earlier's Seen all
  name: (w: WorkspaceView) => string
  keys?: (t: TabView, data: string) => void // ←/→ between the questions of one ask (Ask.steps)
  bulk?: (ts: TabView[], allow: boolean) => void // U8: Allow all (it asks first, naming each) and Deny all
  allowKey?: string // Allow all's key, for its tip
  unbox?: (t: TabView) => void // a command its sandbox stopped (t.boxed): restart it without the sandbox, after a confirm
  netAllow?: (t: TabView, host: string) => void // the host its sandbox refused (t.boxed.host): allowed in its project's list
  openProof?: (t: TabView, path: string) => void // the Proof card's file (a script's output, a picture): its storage folder's
  spend?: (t: TabView) => Promise<SpendView> // its workspace's Where it went (wsSpend), on the Proof card
  turnChips?: (t: TabView) => React.ReactNode // P5: its last turn's chips from turn place extensions
  rows?: boolean // Finished turns as rows (settings.finishedRows, on unless false; a phone's always, below)
  // a phone (App's narrow): asks, then failures, then finished turns, each finished one a row a tap opens (one at a
  // time) and a swipe marks seen (seenUndo: its 4 s Undo); the head counts them, with Mark all finished as seen
  phone?: boolean
  seenUndo?: (t: TabView) => void
  explain?: (t: TabView) => Promise<AskExplained> // a command ask's ? and E (Laki AI on): what it will do (Diff.tsx useExplain)
}

// a phone's order and groups: asks (waiting), failures (a turn ended on an error, a limit, a sandbox's stop, a failed
// Done check), then the finished ones
export const failedNeed = ({ t, w }: Need) => t.status !== 'waiting' && (!!t.failed || !!t.limit || !!t.boxed || (w.proof?.tab === t.id && w.proof.checks.some(c => !c.ok)))
export function phoneGroups(items: Need[]) {
  const asks = items.filter(x => x.t.status === 'waiting')
  const fails = items.filter(failedNeed)
  return { asks, fails, done: items.filter(x => !asks.includes(x) && !fails.includes(x)) }
}

// a finished turn's row a click or Space opened into its card: kept so until it leaves the list (its tab and when it
// began needing you). ponytail: never pruned, a few strings a day
const opened = new Set<string>()

const EARLIER = 'laki.needsEarlier' // '1': the Earlier row unfolded
const unfolded = () => {
  try {
    return localStorage.getItem(EARLIER) === '1'
  } catch {
    return false
  }
}

// U8: Allow all and Deny all (Needs you's; the workers dock's Allow safe): asked first, naming each (allow), then each
// answered as its card would be (its first option or Allow; its last or Deny), one after another, by the asks as they
// are after the confirm: one that changed meanwhile (a new command behind the same Yes), or whose menu isn't a plain
// yes … no (a standing permission's choice: bulkPick has none), isn't answered, and the toast names it
export async function bulkAnswer(ts: TabView[], allow: boolean, o: { view: View; toast: (text: string) => void; done: (text: string) => void }) {
  const nameOf = (t: TabView) => (w => (w ? wsName(w) : t.workspace))(o.view.workspaces.find(w => w.id === t.workspace))
  if (allow && !(await ask(`Allow ${ts.length} permission asks?`, { text: 'Each agent goes on with what it asked for:', facts: bulkGroups(ts, nameOf).map(g => ({ label: g.names.join(', '), value: `${g.tool}: ${g.what}` })), ok: `Allow all (${ts.length})` }))) return
  const failed: string[] = []
  const now = await api.call<View>('state').then(v => new Map(v.tabs.map(x => [x.id, x])), () => new Map<string, TabView>())
  for (const t of ts) {
    const cur = now.get(t.id)
    const pick = cur?.ask?.options.length ? bulkPick(cur.ask, allow) : undefined
    if (!cur || cur.status !== 'waiting' || cur.ask?.tool !== t.ask?.tool || cur.ask?.what !== t.ask?.what || (cur.ask?.options.length && !pick)) {
      failed.push(`${nameOf(t)} · ${t.name}`)
      continue
    }
    await api.call('answer', pick ? { tab: t.id, n: pick.n, label: pick.label } : { tab: t.id, pick: allow ? 'first' : 'last' }).catch(() => failed.push(`${nameOf(t)} · ${t.name}`))
  }
  const word = allow ? 'Allowed' : 'Denied'
  if (failed.length) o.toast(`${word} ${ts.length - failed.length}; not answered (it asks something else now): ${failed.join(', ')}`)
  else o.done(`${word} ${ts.length}`)
}

export function NeedsList({ items: given, shut, onFold, api, next, staleAfter = STALE_AFTER }: { items: Need[]; shut: boolean; onFold: () => void; api: NeedsApi; next?: string; staleAfter?: number }) {
  const [early, setEarly] = useState(unfolded)
  const [one, setOne] = useState('') // a phone's finished row tapped open (its tab and since when)
  const [apart, setApart] = useState<Set<string>>(new Set()) // groups shown Separately (by their asks and tabs: one that changes groups again)
  const [errs, setErrs] = useState<Map<string, string>>(new Map()) // a group's answer that failed for a tab (its id and wait): its own card, with why
  if (!given.length) return null
  const g = phoneGroups(given)
  const items = api.phone ? [...g.asks, ...g.fails, ...g.done] : given
  const counts = [g.asks.length && `${g.asks.length} to answer`, g.fails.length && `${g.fails.length} failed`, g.done.length && `${g.done.length} finished`].filter(Boolean).join(' · ')
  const allSeen = async () => (g.done.length <= 3 || (await ask(`Mark ${g.done.length} finished turns as seen?`, { text: 'They leave Needs you; each stays in its workspace.', ok: 'Mark as seen' }))) && api.seenAll(g.done.map(x => x.t))
  const now = Date.now()
  const stale = items.filter(x => isStale(x.t, staleAfter, now))
  const fresh = items.filter(x => !stale.includes(x))
  const foldEarly = () => {
    setEarly(!early)
    try {
      localStorage.setItem(EARLIER, early ? '' : '1')
    } catch {}
  }
  // U8: the asks one click may answer (shared/ask.ts bulkOk: permission asks, none risky, none outside the worktree
  // unless its sandbox is on), two or more
  const many = items.map(x => x.t).filter(t => bulkOk(t, t.sandbox === true && t.perm !== 'bypassPermissions'))
  // the key: a new wait or finish, or one going stale, starts the card over (its detail open or not)
  const newest = items.reduce<Need | undefined>((m, x) => ((x.t.needAt ?? 0) > (m?.t.needAt ?? 0) ? x : m), undefined)?.t.id // its card's ring (styles.css)
  // one ask in several workspaces of a project (shared/ask.ts groupAsks): one card; not on a phone (its swipe rows)
  const errOf = (t: TabView) => errs.get(`${t.id}:${t.needAt ?? ''}`)
  const groups = api.phone || !api.answerFor ? [] : groupAsks(fresh.filter(x => !errOf(x.t)), x => ({ project: x.w.project, t: x.t })).map(g => ({ ...g, id: `${g.key}\0${g.items.map(x => x.t.id).join(',')}` })).filter(g => !apart.has(g.id))
  const grouped = new Map(groups.flatMap(g => g.items.map(x => [x.t.id, g] as const)))
  const failed = (t: TabView, e: string) => setErrs(m => new Map(m).set(`${t.id}:${t.needAt ?? ''}`, e))
  const card = (x: Need, old = false) => (k => <NeedCard key={`${k}${old ? ':old' : ''}`} {...x} err={errOf(x.t)} api={api} next={x.t.id === next} newest={x.t.id === newest} stale={old} {...(api.phone && { shown: one === k, show: () => setOne(o => (o === k ? '' : k)) })} />)(`${x.t.id}@${x.t.needAt ?? 0}`)
  return (
    <div className="project needs-list" role="group" aria-label="Needs you">
      <div className="project-head" role="treeitem" aria-level={1} aria-expanded={!shut} aria-label={`Needs you: ${items.length}`} tabIndex={-1} onClick={onFold} data-tip={`Agents waiting for you or done while you looked away · ⌘J goes to the next · click to ${shut ? 'expand' : 'collapse'}`}>
        <span className="project-chev">
          <span className={`fold-chev${shut ? ' shut' : ''}`}><Icon name="chevron" size={12} /></span>
        </span>
        <span className="project-icon">
          <Icon name="inbox" size={12} />
        </span>
        <span className="project-name">Needs you</span>
        {api.phone ? <span className="needs-counts">{counts}</span> : <span className="project-count"><Num value={items.length} /></span>}
        {many.length > 1 && api.bulk && (
          <span className="needs-bulk" onClick={e => e.stopPropagation()}>
            <button type="button" className="needs-allow-all" data-tip={`Allow the ${many.length} permission asks: it asks first, naming each${api.allowKey ? ` · ${api.allowKey} with a card focused` : ''}`} aria-label={`Allow all (${many.length})`} title={`Allow all (${many.length})`} onClick={() => api.bulk!(many, true)}>
              <Icon name="check" size={12} />
              <span className="nb-word">Allow all</span> ({many.length})
            </button>
            <button type="button" className="needs-deny-all" data-tip={`Deny the ${many.length} permission asks`} aria-label="Deny all" title="Deny all" onClick={() => api.bulk!(many, false)}>
              <Icon name="x" size={12} />
              <span className="nb-word">Deny all</span>
            </button>
          </span>
        )}
      </div>
      {!shut && (
        <div className="needs-cards">
          {fresh.map(x => (g => (!g ? card(x) : g.items[0] === x ? <NeedGroup key={g.id} items={g.items} choices={g.choices} api={api} onApart={() => setApart(s => new Set(s).add(g.id))} onFail={failed} /> : null))(grouped.get(x.t.id)))}
          {api.phone && g.done.length > 1 && (
            <button type="button" className="needs-all-seen" onClick={() => void allSeen()}>
              Mark all finished as seen
            </button>
          )}
          {stale.length > 0 && (
            <div className="need-earlier">
              <button type="button" className="need-earlier-head" aria-expanded={early} onClick={foldEarly} data-tip={`Done more than ${staleAfter} minutes ago · click to ${early ? 'collapse' : 'expand'}`}>
                <span className={`fold-chev${early ? '' : ' shut'}`}><Icon name="chevron" size={12} /></span>
                Earlier · {stale.length}
              </button>
              <button type="button" className="need-all" onClick={() => api.seenAll(stale.map(x => x.t))}>
                Seen all
              </button>
            </div>
          )}
          {early && stale.map(x => card(x, true))}
        </div>
      )}
    </div>
  )
}

// several agents of one project asking the same (groupAsks): the ask's words once, ×n, each workspace a link to its
// tab, each choice for all n (in order, one at a time: one that fails stays as its own card, with why), Separately
function NeedGroup({ items, choices, api, onApart, onFail }: { items: Need[]; choices: Ask['options']; api: NeedsApi; onApart: () => void; onFail: (t: TabView, e: string) => void }) {
  const [busy, setBusy] = useState(false)
  const a = items[0].t.ask!
  const n = items.length
  const since = Math.min(...items.map(x => x.t.needAt ?? Date.now()))
  const all = async (o: Ask['options'][number]) => {
    setBusy(true)
    for (const x of items) await api.answerFor!(x.t, o.n, o.label).catch((e: Error) => onFail(x.t, e?.message || 'not answered'))
    setBusy(false)
  }
  return (
    <div className="need need-wait need-group" role="group" aria-label={`${n} agents ask: ${a.what}`}>
      <div className="need-head">
        <Glyph s="waiting" />
        <b className="need-ws">{a.question || `${a.tool} asks`}</b>
        <span className="need-tab">×{n}</span>
        <Elapsed since={since} />
      </div>
      <div className="need-cmd">
        <span className="mono small muted" data-tip={a.what}>{a.what}</span>
      </div>
      <div className="need-group-ws">
        {items.map(x => (
          <button key={x.t.id} type="button" className="link small" data-tip={`Open ${x.t.name}`} onClick={() => api.open(x.t)}>
            {api.name(x.w)}
          </button>
        ))}
      </div>
      <div className="need-opts">
        {choices.map(o => (
          <button key={o.n} type="button" className={o.n === a.at ? 'on' : ''} disabled={busy} onClick={() => void all(o)}>
            {optLabel(a, o)} for all {n}
          </button>
        ))}
        <button type="button" disabled={busy} data-tip="One card for each again" onClick={onApart}>
          Separately
        </button>
      </div>
    </div>
  )
}

function NeedCard({ t, w, api, next, newest, stale, shown, show, err }: Need & { api: NeedsApi; next: boolean; newest?: boolean; stale: boolean; shown?: boolean; show?: () => void; err?: string }) {
  const [open, setOpen] = useState(!stale) // detail open for what needs you, a stale finish one line
  const waiting = t.status === 'waiting'
  const opts = waiting ? (t.ask?.options ?? []) : []
  const allow = waiting && !opts.length && api.permission(t)
  const stop = (e: MouseEvent) => (e.target as HTMLElement).closest('button') && e.stopPropagation() // a button's own click; the row's room around it opens the tab
  const why = useSayWhy(waiting ? t.ask : undefined, (n, label, say) => api.answer(t, n, label, say)) // ⌥-click, a long press or N: No, and say why
  const x = useExplain(t.id, waiting ? t.ask : undefined, api.explain && (() => api.explain!(t))) // ? or E: what its command will do
  const key = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return // a button of its own has the key
    if (why.key(e) || x.key(e)) return
    const o = opts.find(o => String(o.n) === e.key)
    if (o) e.preventDefault(), api.answer(t, o.n, o.label)
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && waiting && t.ask?.steps && api.keys) e.preventDefault(), api.keys(t, e.key === 'ArrowLeft' ? '\x1b[D' : '\x1b[C') // its other questions
    else if (e.key === 'Enter') e.preventDefault(), api.open(t, e.currentTarget as HTMLElement)
  }
  const last = t.failed ?? t.last?.trim().split('\n').find(l => l.trim())?.trim()
  const stat = w.stat && (w.stat.add > 0 || w.stat.del > 0) ? w.stat : undefined
  const changed = w.stat ? w.stat.files > 0 || w.stat.dirty > 0 : t.kind === 'agent' && !t.runs // no scan yet: a shell (or an agent typed in one) has none to show
  // a finished turn as a row (asks stay cards: they weigh most): its mark, workspace, the first words of its last line,
  // how long ago; Changes and Seen where the words were on hover or focus, the row's height kept. A failed Done check,
  // a plan limit, a sandbox's stop or an API error stay cards. A click or Space opens it into its card
  const id = `${t.id}:${t.needAt ?? ''}`
  const flip = `${t.id}@${t.needAt ?? 0}${stale ? ':old' : ''}` // its key in the list: Sidebar's useFlip
  const [, grow] = useState(0)
  const swipe = useSwipe(() => api.seenUndo?.(t))
  const plain = !waiting && !failedNeed({ t, w })
  if (plain && (api.phone ? !shown : api.rows && !opened.has(id))) {
    const expand = () => (api.phone ? show?.() : (opened.add(id), grow(n => n + 1)))
    return (
      <div className="need need-done need-row" data-flip={flip} data-key={next ? 'next' : undefined} tabIndex={0} role="button" aria-label={`${api.name(w)} · ${t.name}: done. ${api.phone ? 'Tap shows more, a swipe marks it seen' : 'Space shows more'}`} onClick={() => swipe.moved() || expand()} onKeyDown={e => (e.key === ' ' && e.target === e.currentTarget ? (e.preventDefault(), expand()) : key(e))} {...(api.phone && api.seenUndo && swipe.props)}>
        <Glyph s="done" />
        <span className="need-row-line">
          <b className="need-ws">
            <MidText text={api.name(w)} />
          </b>
          <span className="need-row-mid">
            <span className="need-row-last">{last ?? t.name}</span>
            <span className="need-row-acts" onClick={stop}>
              {!!w.branch && changed && <button type="button" onClick={() => api.review(t)}>Changes</button>}
              <button type="button" onClick={() => api.seen(t)}>Seen</button>
            </span>
          </span>
        </span>
        {t.needAt && <Elapsed since={t.needAt} />}
      </div>
    )
  }
  return (
    <div className={`need ${waiting ? 'need-wait' : 'need-done'}${stale ? ' need-stale' : ''}${shown ? ' need-shown' : ''}`} data-flip={flip} data-key={next ? 'next' : undefined} data-newest={newest || undefined} tabIndex={0} role="button" aria-label={`${api.name(w)} · ${t.name}: ${waiting ? 'waiting for you' : 'done'}`} onClick={e => api.open(t, e.currentTarget)} onKeyDown={key}>
      <div className="need-head">
        <Glyph s={waiting ? 'waiting' : 'done'} />
        <b className="need-ws">
          <MidText text={api.name(w)} />
        </b>
        <span className="need-tab">{t.name}</span>
        {t.needAt && <Elapsed since={t.needAt} />}
        <button type="button" className="need-chev" aria-expanded={open} aria-label={open ? 'Hide detail' : 'Show detail'} onClick={e => (e.stopPropagation(), setOpen(!open))}>
          <Icon name={open ? 'chevron' : 'chevronRight'} size={12} />
        </button>
      </div>
      {!open ? null : waiting ? (
        <>
          <div className="need-q">{t.secret ? `Asks for a secret: ${t.secret.label}${t.secret.saved ? " (kept: one click gives it)" : ""}` : t.ask?.question || (allow ? 'Asks for permission' : 'Waiting for you')}</div>
          {t.held && <div className="muted small">Asked because it touches {t.held}</div>}
          {err && <div className="need-err small">For all didn't answer this one: {err}</div>}
          {t.boxed && api.unbox && <Boxed t={t} unbox={api.unbox} netAllow={api.netAllow} />}
          {t.ask?.steps && api.keys && <div className="need-steps muted small">One of several questions: ← → (the card focused) go between them</div>}
          {x.button && (
            // a command: as it runs, and the ? for Laki AI's words on it
            <div className="need-cmd" onClick={stop}>
              <span className="mono small muted" data-tip={t.ask!.what}>{t.ask!.what}</span>
              {x.button}
            </div>
          )}
          {x.line}
          {t.ask?.diff && (
            // an Edit's or Write's change, before its Yes
            <div className="need-diff" onClick={stop}>
              <div className="mono small muted">{t.ask.what}</div>
              <AskDiff key={t.ask.what} diff={t.ask.diff} />
            </div>
          )}
          {(opts.length > 0 || allow) && (
            <div className="need-opts" onClick={stop}>
              {opts.map(o => (
                <button key={o.n} className={o.n === t.ask?.at ? 'on' : ''} {...choiceProps(optLabel(t.ask!, o), t.preset)} {...why.on(o)} {...(why.no?.n === o.n && { 'data-tip': '⌥-click, a long press or N: say why' })}>
                  <Choice text={optLabel(t.ask!, o)} agent={t.preset} n={<span className="need-n">{o.n}</span>} />
                </button>
              ))}
              {allow && (
                <>
                  <button className="on" onClick={() => api.pick(t, 'first')}>Allow</button>
                  <button onClick={() => api.pick(t, 'last')}>Deny</button>
                </>
              )}
            </div>
          )}
          {why.box}
        </>
      ) : (
        <>
          {last && <div className="need-q need-last">{last}</div>}
          {w.proof?.tab === t.id && api.openProof && <ProofList p={w.proof} open={path => api.openProof!(t, path)} spend={api.spend && (() => api.spend!(t))} />}
          {api.turnChips?.(t)}
          {t.boxed && api.unbox && <Boxed t={t} unbox={api.unbox} netAllow={api.netAllow} />}
          <div className="need-acts" onClick={stop}>
            {stat && (
              <span className="ws-stat">
                <span className="add">+{stat.add}</span> <span className="del">−{stat.del}</span>
              </span>
            )}
            <span className="spacer" />
            {!t.failed && !!w.branch && changed && <button onClick={() => api.review(t)}>Changes</button>}
            {t.failed && <button className="on" data-tip={t.failed} onClick={() => api.keep(t)}>Continue</button>}
            {t.failed && <button onClick={() => api.dismiss(t)}>Dismiss</button>}
            {!t.failed && <button onClick={() => api.seen(t)}>Seen</button>}
          </div>
        </>
      )}
    </div>
  )
}

// a command its sandbox stopped (t.boxed): one line, and a restart without the sandbox (unbox asks first)
function Boxed({ t, unbox, netAllow }: { t: TabView; unbox: (t: TabView) => void; netAllow?: (t: TabView, host: string) => void }) {
  const b = t.boxed!
  return (
    <div className="need-boxed" onClick={e => e.stopPropagation()}>
      <span className="muted small" title={b.why}>
        {b.wrap ? 'The wrapper sandbox refused' : 'The sandbox stopped'} {b.host ? <code>{b.host}</code> : b.cmd ? <code>{b.cmd}</code> : 'a command'}
      </span>
      {b.host && netAllow && <button onClick={() => netAllow(t, b.host!)}>Allow this domain in this project</button>}
      <button onClick={() => unbox(t)}>{b.wrap ? 'Restart without the wrapper' : 'Restart without sandbox'}</button>
    </div>
  )
}

// a finished row's swipe (a phone's: touch or pen): it follows the finger once the move is mostly sideways (10px
// settles it); let go past 40% of its width, gone (onSwipe: marked seen, with Undo), else it springs back
// (styles.css .need-row: no spring with reduced motion). moved(): a swipe's release, not a tap
function useSwipe(onSwipe: () => void) {
  const s = useRef<{ x: number; y: number; id: number; lock?: 'x' | 'y'; dx: number; w: number } | null>(null)
  const was = useRef(false)
  const [dx, setDx] = useState(0)
  const [gone, setGone] = useState(false)
  const end = () => {
    const p = s.current
    s.current = null
    if (!p || p.lock !== 'x') return setDx(0)
    was.current = true
    if (Math.abs(p.dx) >= p.w * 0.4) return void (setGone(true), setDx(Math.sign(p.dx) * p.w), onSwipe())
    setDx(0)
  }
  return {
    moved: () => (m => ((was.current = false), m))(was.current),
    props: {
      style: dx ? { transform: `translateX(${dx}px)` } : undefined,
      'data-swiping': s.current?.lock === 'x' ? '' : undefined,
      'data-gone': gone ? '' : undefined,
      onPointerDown: (e: PointerEvent) => void ((was.current = false), e.pointerType !== 'mouse' && !gone && (s.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, w: e.currentTarget.getBoundingClientRect().width || 1 })), // a swipe with no click after it: the next tap is a tap
      onPointerMove: (e: PointerEvent) => {
        const p = s.current
        if (!p || e.pointerId !== p.id) return
        const [x, y] = [e.clientX - p.x, e.clientY - p.y]
        if (!p.lock && Math.hypot(x, y) >= 10) p.lock = Math.abs(x) > Math.abs(y) ? 'x' : 'y'
        if (p.lock === 'y') return void (s.current = null)
        if (p.lock === 'x') (p.dx = x), setDx(x)
      },
      onPointerUp: end,
      onPointerCancel: () => ((s.current = null), setDx(0)),
    },
  }
}
