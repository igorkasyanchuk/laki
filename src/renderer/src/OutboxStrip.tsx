// the remote page's outbox (outbox.ts): what waits to go again, Not sent yet with Cancel; what was dropped, and why
import { useSyncExternalStore } from 'react'
import { outbox, outText } from './outbox'

export function Outbox({ name }: { name: (tab: string) => string }) {
  const { box, notes } = useSyncExternalStore(outbox.on, outbox.get)
  if (!box.length && !notes.length) return null
  return (
    <div className="outbox" role="status" aria-live="polite">
      {box.map(it => (
        <div key={it.cid} className="outbox-item">
          <span className="outbox-text">{outText(it)}</span>
          <span className="muted small">→ {name(it.tab)} · Not sent yet</span>
          <button type="button" className="link" onClick={() => outbox.cancel(it.cid)}>Cancel</button>
        </div>
      ))}
      {notes.map(n => (
        <div key={n.cid} className="outbox-item note">
          <span className="outbox-text">{n.text}</span>
          <span className="muted small">{n.why}</span>
          <button type="button" className="link" onClick={() => outbox.seen(n.cid)}>OK</button>
        </div>
      ))}
    </div>
  )
}
