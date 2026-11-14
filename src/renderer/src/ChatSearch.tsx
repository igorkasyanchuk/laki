// Search chats (⌥⌘F, ⌘K): every chat Laki knows (the daemon's chatSearch), the hits under their workspace's name; ↑↓
// and Enter open one in the Reader at that message. An archived workspace's opens only from its Restore (a click)
import { useEffect, useRef, useState } from 'react'
import type { ChatHit } from '../../shared/types'
import { act, Icon } from './ui'

export function ChatSearch(p: { search: (q: string) => Promise<{ hits: ChatHit[]; more?: true }>; wsName: (id: string) => string; archived: (id: string) => boolean; onOpen: (h: ChatHit) => void; onRestore: (h: ChatHit) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [got, setGot] = useState<{ q: string; hits: ChatHit[]; more?: true; err?: string }>()
  const [i, setI] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const words = q.trim()
    if (!words) return setGot(undefined)
    let alive = true
    const t = setTimeout(() => void p.search(words).then(r => alive && (setGot({ q: words, ...r }), setI(0)), e => alive && setGot({ q: words, hits: [], err: String(e?.message ?? e) })), 250)
    return () => ((alive = false), clearTimeout(t))
  }, [q])
  useEffect(() => void list.current?.querySelector('.ff-item.sel')?.scrollIntoView({ block: 'nearest' }), [i])
  const hits = got?.hits ?? []
  // grouped by workspace, in the order their newest hit came; i counts the hits in that order
  const groups = [...new Set(hits.map(h => h.ws))].map(ws => ({ ws, hits: hits.filter(h => h.ws === ws) }))
  const flat = groups.flatMap(g => g.hits)
  const open = (h?: ChatHit) => h && !p.archived(h.ws) && (p.onClose(), p.onOpen(h))
  const when = (at?: number) => (at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
  let k = -1
  return (
    <div className="overlay top" onMouseDown={e => e.target === e.currentTarget && p.onClose()}>
      <div className="finder chat-search" role="dialog" aria-label="Search chats">
        <input
          autoFocus
          value={q}
          placeholder="Search chats: what you or an agent said"
          spellCheck={false}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setI(x => Math.max(0, Math.min(flat.length - 1, x + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter') {
              e.preventDefault() // or its keypress reaches the terminal focused after it closes
              open(flat[i])
            } else if (e.key === 'Escape') (e.stopPropagation(), p.onClose())
          }}
        />
        <div className="ff-list" ref={list}>
          {got?.err && <div className="warn small pad">{got.err}</div>}
          {q.trim() && !got && <div className="muted small pad">Searching…</div>}
          {groups.map(g => (
            <div key={g.ws} className="cs-group">
              <div className="cs-head small muted">
                {p.wsName(g.ws)}
                {p.archived(g.ws) && <> · archived</>}
              </div>
              {g.hits.map(h => {
                const n = ++k
                const old = p.archived(h.ws)
                return (
                  <div key={`${h.id}${h.who}${n}`} className={`ff-item cs-hit ${n === i ? 'sel' : ''}`} onMouseEnter={() => setI(n)} {...act(() => open(h))}>
                    <Icon name={h.who === 'you' ? 'user' : h.who === 'tool' ? 'terminal' : 'robot'} />
                    <span className="cs-text">{h.text}</span>
                    <span className="cs-where small muted">
                      {h.tab ? h.name : `${h.name} (closed)`} · {when(h.at)}
                    </span>
                    {old && (
                      <button type="button" className="cs-restore" onClick={e => (e.stopPropagation(), p.onClose(), p.onRestore(h))}>
                        Restore
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {got && !got.err && !hits.length && <div className="muted small pad">Nothing said matches.</div>}
          {got?.more && <div className="muted small pad">More… (the newest {hits.length} shown: add words to narrow it)</div>}
        </div>
      </div>
    </div>
  )
}
