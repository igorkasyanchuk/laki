// The sidebar's Needs you list (settings.needsList, on unless false): every tab App's needsYou matches (the Dock count's
// and ⌘J's rule) in text.ts' needsSorted order: waiting ones first, the oldest first; then done ones, the newest first;
// a done one older than settings.staleAfter (isStale) under a folded Earlier row (laki.needsEarlier), dimmed. A waiting
// agent's card answers it (its menu's options, or Allow / Deny for a permission prompt with none read); a done one's
// says what it answered, Review opens Changes (only with changes to look at: the scan's stat, else an agent's tab that
// isn't a shell's), Seen clears its ●; Earlier's Seen all clears them all. Each card's chevron shows or hides that
// detail (open but for a stale one); anywhere else on a card opens the tab, whatever its state. With a card focused,
// 1–9 answer and Enter opens.
import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { TabView, WorkspaceView } from '../../shared/types'
import { Glyph } from './Glyph'
import { isStale, STALE_AFTER } from './text'
import { Elapsed, Icon } from './ui'

export type Need = { t: TabView; w: WorkspaceView }
export type NeedsApi = {
  open: (t: TabView) => void
  answer: (t: TabView, n: number, label: string) => void
  pick: (t: TabView, pick: 'first' | 'last') => void // a permission prompt with no menu read: Allow / Deny
  permission: (t: TabView) => boolean // its last wait said "permission" (the turn event's text)
  review: (t: TabView) => void
  seen: (t: TabView) => void
  seenAll: (ts: TabView[]) => void // Earlier's Seen all
  name: (w: WorkspaceView) => string
}

const EARLIER = 'laki.needsEarlier' // '1': the Earlier row unfolded
const unfolded = () => {
  try {
    return localStorage.getItem(EARLIER) === '1'
  } catch {
    return false
  }
}

export function NeedsList({ items, shut, onFold, api, next, staleAfter = STALE_AFTER }: { items: Need[]; shut: boolean; onFold: () => void; api: NeedsApi; next?: string; staleAfter?: number }) {
  const [early, setEarly] = useState(unfolded)
  if (!items.length) return null
  const now = Date.now()
  const stale = items.filter(x => isStale(x.t, staleAfter, now))
  const fresh = items.filter(x => !stale.includes(x))
  const foldEarly = () => {
    setEarly(!early)
    try {
      localStorage.setItem(EARLIER, early ? '' : '1')
    } catch {}
  }
  // the key: a new wait or finish, or one going stale, starts the card over (its detail open or not)
  const card = (x: Need, old = false) => <NeedCard key={`${x.t.id}@${x.t.needAt ?? 0}${old ? ':old' : ''}`} {...x} api={api} next={x.t.id === next} stale={old} />
  return (
    <div className="project needs-list">
      <div className="project-head" onClick={onFold} data-tip={`Agents waiting for you or done while you looked away · ⌘J goes to the next · click to ${shut ? 'expand' : 'collapse'}`}>
        <span className="project-chev">
          <Icon name={shut ? 'chevronRight' : 'chevron'} size={12} />
        </span>
        <span className="project-icon">
          <Icon name="inbox" size={12} />
        </span>
        <span className="project-name">Needs you</span>
        <span className="project-count">{items.length}</span>
      </div>
      {!shut && (
        <div className="needs-cards">
          {fresh.map(x => card(x))}
          {stale.length > 0 && (
            <div className="need-earlier">
              <button type="button" className="need-earlier-head" aria-expanded={early} onClick={foldEarly} data-tip={`Done more than ${staleAfter} minutes ago · click to ${early ? 'collapse' : 'expand'}`}>
                <Icon name={early ? 'chevron' : 'chevronRight'} size={12} />
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

function NeedCard({ t, w, api, next, stale }: Need & { api: NeedsApi; next: boolean; stale: boolean }) {
  const [open, setOpen] = useState(!stale) // detail open for what needs you, a stale finish one line
  const waiting = t.status === 'waiting'
  const opts = waiting ? (t.ask?.options ?? []) : []
  const allow = waiting && !opts.length && api.permission(t)
  const stop = (e: MouseEvent) => (e.target as HTMLElement).closest('button') && e.stopPropagation() // a button's own click; the row's room around it opens the tab
  const key = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return // a button of its own has the key
    const o = opts.find(o => String(o.n) === e.key)
    if (o) e.preventDefault(), api.answer(t, o.n, o.label)
    else if (e.key === 'Enter') e.preventDefault(), api.open(t)
  }
  const last = t.last?.trim().split('\n').find(l => l.trim())?.trim()
  const stat = w.stat && (w.stat.add > 0 || w.stat.del > 0) ? w.stat : undefined
  const changed = w.stat ? w.stat.files > 0 || w.stat.dirty > 0 : t.kind === 'agent' && !t.runs // no scan yet: a shell (or an agent typed in one) has none to show
  return (
    <div className={`need ${waiting ? 'need-wait' : 'need-done'}${stale ? ' need-stale' : ''}`} data-key={next ? 'next' : undefined} tabIndex={0} role="button" aria-label={`${api.name(w)} · ${t.name}: ${waiting ? 'waiting for you' : 'done'}`} onClick={() => api.open(t)} onKeyDown={key}>
      <div className="need-head">
        <Glyph s={waiting ? 'waiting' : 'done'} />
        <b className="need-ws">{api.name(w)}</b>
        <span className="need-tab">{t.name}</span>
        {t.needAt && <Elapsed since={t.needAt} />}
        <button type="button" className="need-chev" aria-expanded={open} aria-label={open ? 'Hide detail' : 'Show detail'} onClick={e => (e.stopPropagation(), setOpen(!open))}>
          <Icon name={open ? 'chevron' : 'chevronRight'} size={12} />
        </button>
      </div>
      {!open ? null : waiting ? (
        <>
          <div className="need-q">{t.secret ? `Asks for a secret: ${t.secret.label}` : t.ask?.question || (allow ? 'Asks for permission' : 'Waiting for you')}</div>
          {(opts.length > 0 || allow) && (
            <div className="need-opts" onClick={stop}>
              {opts.map(o => (
                <button key={o.n} className={o.n === t.ask?.at ? 'on' : ''} data-tip={o.label} onClick={() => api.answer(t, o.n, o.label)}>
                  <span className="need-n">{o.n}</span>
                  {o.label}
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
        </>
      ) : (
        <>
          {last && <div className="need-q need-last">{last}</div>}
          <div className="need-acts" onClick={stop}>
            {stat && (
              <span className="ws-stat">
                <span className="add">+{stat.add}</span> <span className="del">−{stat.del}</span>
              </span>
            )}
            <span className="spacer" />
            {!!w.branch && changed && <button onClick={() => api.review(t)}>Review</button>}
            <button onClick={() => api.seen(t)}>Seen</button>
          </div>
        </>
      )}
    </div>
  )
}
