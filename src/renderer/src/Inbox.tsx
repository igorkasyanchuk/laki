// The notification inbox (the bell; daemon/inbox.ts): what finished, failed or asked for you, read or not. A toast going
// away never marks one read. Open goes to where it happened, as that is now: an entry has no buttons of its own for an ask
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { IconName } from '../../shared/icons'
import type { InboxEntry } from '../../shared/types'
import { ago } from './Info'
import { Icon, IconButton } from './ui'

const ICONS: Record<InboxEntry['kind'], IconName> = { done: 'check', failed: 'x', limit: 'clock', waiting: 'bell', reminder: 'calendar' }

export function Inbox({ at, unread, call, canOpen, onOpen, onClose }: { at?: number; unread: number; call: <T>(method: string, p?: object) => Promise<T>; canOpen: (e: InboxEntry) => boolean; onOpen: (e: InboxEntry) => void; onClose: () => void }) {
  const [list, setList] = useState<InboxEntry[] | null>(null)
  const [all, setAll] = useState(unread === 0) // nothing unread: what there was
  const [sure, setSure] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const load = () => void call<InboxEntry[]>('inboxList').then(setList, () => setList([]))
  useEffect(load, [at, unread])
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])
  useLayoutEffect(() => {
    // over the bell (the palette opens it too; a phone's sidebar may be shut: the corner)
    const r = document.querySelector('.inbox-bell')?.getBoundingClientRect()
    const el = box.current!
    el.style.left = `${Math.max(8, Math.min(r?.width ? r.left : 8, innerWidth - el.offsetWidth - 8))}px`
    el.style.bottom = `${r?.width ? Math.max(8, innerHeight - r.top + 6) : 8}px`
  }, [])
  const read = (ids?: string[]) => void call('inboxRead', ids ? { ids } : {}).then(load, () => {})
  const shown = (list ?? []).filter(e => all || !e.read)
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="inbox-pop" ref={box} role="dialog" aria-label="Notifications">
        <div className="inbox-head">
          <b>Notifications{unread ? ` (${unread} unread)` : ''}</b>
          <span className="grow" />
          <button disabled={!unread} onClick={() => read()}>Mark all read</button>
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        <div className="inbox-tabs" role="tablist">
          <button role="tab" aria-selected={!all} className={all ? '' : 'on'} onClick={() => setAll(false)}>Unread</button>
          <button role="tab" aria-selected={all} className={all ? 'on' : ''} onClick={() => setAll(true)}>All</button>
          <span className="grow" />
          {sure ? (
            <>
              <span className="muted small">Clear all?</span>
              <button className="danger" onClick={() => void call('inboxClear').then(load, () => {}).finally(() => setSure(false))}>Clear</button>
              <button onClick={() => setSure(false)}>Keep</button>
            </>
          ) : (
            <button disabled={!list?.length} onClick={() => setSure(true)}>Clear all</button>
          )}
        </div>
        <div className="inbox-list">
          {list && !shown.length && <div className="inbox-none muted">{all ? 'Nothing yet: finished agents, failed workflows, reminders and asks land here.' : 'Nothing unread.'}</div>}
          {shown.map(e => (
            <div key={e.id} className={`inbox-row ${e.read ? '' : 'unread'} ${e.kind}`}>
              <Icon name={ICONS[e.kind]} />
              <div className="inbox-words">
                <div className="inbox-title" title={e.title}>{e.title}</div>
                {e.text && <div className="inbox-text">{e.text}</div>}
                <div className="muted small">{ago(e.at)}</div>
              </div>
              <div className="inbox-acts">
                {canOpen(e) ? <button onClick={() => onOpen(e)}>Open</button> : <span className="muted small" title="Its workspace or tab was closed">Gone</span>}
                {!e.read && <IconButton icon="check" title="Mark read" onClick={() => read([e.id])} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
