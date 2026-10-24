// The sidebar's Needs you list (settings.needsList, on unless false): every tab App's needsYou matches (the Dock count's
// and ⌘J's rule), waiting ones first, then done ones, the oldest first in each (the view's needAt). A waiting agent's
// card answers it (its menu's options, or Allow / Deny for a permission prompt with none read); a done one's says what
// it answered, Review opens Changes, Seen clears its ●. A click elsewhere on a card opens the tab; with a card focused,
// 1–9 answer and Enter opens.
import type { KeyboardEvent, MouseEvent } from 'react'
import type { TabView, WorkspaceView } from '../../shared/types'
import { Glyph } from './Glyph'
import { Elapsed, Icon } from './ui'

export type Need = { t: TabView; w: WorkspaceView }
export type NeedsApi = {
  open: (t: TabView) => void
  answer: (t: TabView, n: number, label: string) => void
  pick: (t: TabView, pick: 'first' | 'last') => void // a permission prompt with no menu read: Allow / Deny
  permission: (t: TabView) => boolean // its last wait said "permission" (the turn event's text)
  review: (t: TabView) => void
  seen: (t: TabView) => void
  name: (w: WorkspaceView) => string
}

// waiting first, then done; the oldest first in each (one with no time yet last)
export const needsSorted = (tabs: TabView[]) => {
  const by = (a: TabView, b: TabView) => (a.needAt ?? Infinity) - (b.needAt ?? Infinity)
  return [...tabs.filter(t => t.status === 'waiting').sort(by), ...tabs.filter(t => t.status !== 'waiting').sort(by)]
}

export function NeedsList({ items, shut, onFold, api, next }: { items: Need[]; shut: boolean; onFold: () => void; api: NeedsApi; next?: string }) {
  if (!items.length) return null
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
          {items.map(x => (
            <NeedCard key={x.t.id} {...x} api={api} next={x.t.id === next} />
          ))}
        </div>
      )}
    </div>
  )
}

function NeedCard({ t, w, api, next }: Need & { api: NeedsApi; next: boolean }) {
  const waiting = t.status === 'waiting'
  const opts = waiting ? (t.ask?.options ?? []) : []
  const allow = waiting && !opts.length && api.permission(t)
  const stop = (e: MouseEvent) => e.stopPropagation()
  const key = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return // a button of its own has the key
    const o = opts.find(o => String(o.n) === e.key)
    if (o) e.preventDefault(), api.answer(t, o.n, o.label)
    else if (e.key === 'Enter') e.preventDefault(), api.open(t)
  }
  const last = t.last?.trim().split('\n').find(l => l.trim())?.trim()
  const stat = w.stat && (w.stat.add > 0 || w.stat.del > 0) ? w.stat : undefined
  return (
    <div className={`need ${waiting ? 'need-wait' : 'need-done'}`} data-key={next ? 'next' : undefined} tabIndex={0} role="button" aria-label={`${api.name(w)} · ${t.name}: ${waiting ? 'waiting for you' : 'done'}`} onClick={() => api.open(t)} onKeyDown={key}>
      <div className="need-head">
        <Glyph s={waiting ? 'waiting' : 'done'} />
        <b className="need-ws">{api.name(w)}</b>
        <span className="need-tab">{t.name}</span>
        {t.needAt && <Elapsed since={t.needAt} />}
      </div>
      {waiting ? (
        <>
          <div className="need-q">{t.ask?.question || (allow ? 'Asks for permission' : 'Waiting for you')}</div>
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
            {!!w.branch && <button onClick={() => api.review(t)}>Review</button>}
            <button onClick={() => api.seen(t)}>Seen</button>
          </div>
        </>
      )}
    </div>
  )
}
