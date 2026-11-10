// A workflow's Show you block (daemon/workflow.ts' popup): a window over the app with what the run shows you, read and
// closed (Esc, Close). HTML goes in a sandboxed frame: no scripts, nothing it loads but pictures, links open in the
// browser (main's window-open handler); anything else is Markdown.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { Digest, DigestRow } from '../../shared/types'
import { Folded, Markdown } from './MarkdownView'
import { Icon, IconButton } from './ui'

export type ShownWin = { run: string; name: string; title: string; body: string }

// the frame's page: the app's colors and fonts as they are now
function page(body: string) {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  const csp = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
body { margin: 0; padding: 16px 18px; font: 14px/1.55 ${v('--ui-font')}; color: ${v('--fg')}; background: ${v('--panel')}; overflow-wrap: anywhere; }
a { color: ${v('--accent')}; } pre, code { font-family: ${v('--mono')}; font-size: 12.5px; } pre { overflow-x: auto; }
img { max-width: 100%; } table { border-collapse: collapse; } td, th { border: 1px solid ${v('--line')}; padding: 4px 8px; } hr { border: none; border-top: 1px solid ${v('--line')}; }
</style></head><body>${body}</body></html>`
}

export function ShownDialog({ s, left, onOpenRun, onClose }: { s: ShownWin; left?: number; onOpenRun?: () => void; onClose: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), onClose())
    window.addEventListener('keydown', f, true) // before the terminal under it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])
  const html = /^\s*</.test(s.body)
  const doc = useMemo(() => (html ? page(s.body) : ''), [s.body, html])
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal widget-modal shown-modal" role="dialog" aria-label={s.title}>
        <div className="widget-modal-head">
          <b className="shown-title">{s.title}</b>
          <span className="muted small">{s.name}</span>
          <span className="spacer" />
          {!!left && <span className="muted small">{left} more</span>}
          {onOpenRun && <IconButton icon="flow" title="Open the run" onClick={onOpenRun} />}
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        {html ? (
          <iframe className="shown-frame" title={s.title} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} />
        ) : (
          <div className="shown-md">
            <Markdown src={s.body} />
          </div>
        )}
        <div className="shown-foot">
          <button className="primary" autoFocus onClick={onClose}>
            {left ? 'Next' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

// a Show you's or an end's popover: a card in the window's corner, the run going on. HTML shows as its words (DOMParser
// runs nothing); Show opens it as the window
export type ShownPop = ShownWin & { key: number }
const words = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? ''
export function ShownPops({ pops, notices, onShow, onOpenRun, onClose }: { pops: ShownPop[]; notices?: ReactNode; onShow: (p: ShownPop) => void; onOpenRun: (p: ShownPop) => void; onClose: (key: number) => void }) {
  if (!pops.length && !notices) return null
  return (
    <div className="shown-pops" role="status">
      {notices}
      {pops.map(p => (
        <div key={p.key} className="shown-pop">
          <div className="shown-pop-head">
            <Icon name="flow" />
            <b className="shown-title">{p.title}</b>
            <span className="spacer" />
            <IconButton icon="x" title="Close" onClick={() => onClose(p.key)} />
          </div>
          {p.body && (
            <div className="shown-pop-body">
              <Folded text={/^\s*</.test(p.body) ? words(p.body) : p.body} lines={4} />
            </div>
          )}
          <div className="shown-pop-foot">
            <span className="muted small">{p.name}</span>
            <span className="spacer" />
            {p.body && (
              <button className="link" onClick={() => onShow(p)}>
                Show
              </button>
            )}
            <button className="link" onClick={() => onOpenRun(p)}>
              Open the run
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// laki notice's card (daemon/alerts.ts): its words, × closes it, a choice answers it (the caller gets it), Open goes to
// the session it's about (--to: a tab, or a workspace without an agent; else the one that sent it)
export type Notice = { id: string; title: string; text: string; choices: string[]; tab?: string; to?: { ws: string; tab?: string; name: string } }

// a window's notices, from the daemon's events: it sends them again to a window as it connects, so a connection that
// opens starts over (a daemon started again has none: their waits failed). answer: × (none) or a choice, gone here at
// once, then in every window (alertDone)
export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([])
  useEffect(
    () =>
      api.on(m => {
        if (m.ev === 'open') setNotices([])
        else if (m.ev === 'notice') setNotices(q => (q.some(n => n.id === m.id) ? q : [...q, m as unknown as Notice]))
        else if (m.ev === 'alertDone') setNotices(q => q.filter(n => n.id !== m.id))
      }),
    [],
  )
  const answer = (n: Notice, choice?: string) => (setNotices(q => q.filter(x => x.id !== n.id)), void api.call('alertAnswer', { id: n.id, ...(choice !== undefined && { choice }) }).catch(() => {}))
  return { notices, answer }
}

// a floated window's (a tab's, Laki AI's, the simulator's): the same cards, without Open (the app's window has it)
export function FloatNotices() {
  const { notices, answer } = useNotices()
  if (!notices.length) return null
  return (
    <div className="shown-pops" role="status">
      {notices.map(n => (
        <NoticeCard key={n.id} n={n} onAnswer={c => answer(n, c)} />
      ))}
    </div>
  )
}
// U8: what happened during Do not disturb, once it's over: who waits, what ended, which PRs moved; a row opens its tab
// (a PR's: its workspace); kept until closed
export function DigestCard({ d, onOpen, onClose }: { d: Digest; onOpen: (r: DigestRow) => void; onClose: () => void }) {
  const at = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="shown-pop digest" role="region" aria-label="What happened during Do not disturb">
      <div className="shown-pop-head">
        <Icon name="moon" />
        <b className="shown-title">
          While you were away ({at(d.since)} to {at(d.until)})
        </b>
        <span className="spacer" />
        <IconButton icon="x" title="Close" onClick={onClose} />
      </div>
      <div className="shown-pop-body">
        {!d.rows.length && <span className="muted">Nothing finished, asked or moved.</span>}
        {([['wait', 'Waiting for you'], ['done', 'Finished'], ['pr', 'Pull requests']] as const).map(([k, title]) =>
          (rows =>
            rows.length > 0 && (
              <div key={k} className="digest-group">
                <div className="digest-title">
                  {title} · {rows.length}
                </div>
                {rows.map((r, i) => (
                  <button key={i} type="button" className="digest-row" onClick={() => onOpen(r)}>
                    <b>{r.name}</b>
                    {r.text && <span>{r.text}</span>}
                  </button>
                ))}
              </div>
            ))(d.rows.filter(r => r.kind === k)),
        )}
      </div>
    </div>
  )
}

export function NoticeCard({ n, onAnswer, onOpen }: { n: Notice; onAnswer: (choice?: string) => void; onOpen?: () => void }) {
  return (
    <div className="shown-pop">
      <div className="shown-pop-head">
        <Icon name="bell" />
        <b className="shown-title">{n.title}</b>
        <span className="spacer" />
        <IconButton icon="x" title={n.choices.length ? 'Close without an answer' : 'Close'} onClick={() => onAnswer()} />
      </div>
      <div className="shown-pop-body">
        <Folded text={n.text} lines={6} />
      </div>
      {(n.to || onOpen || n.choices.length > 0) && (
        <div className="shown-pop-foot notice-foot">
          {n.to && <span className="muted small">for {n.to.name}</span>}
          <span className="spacer" />
          {onOpen && (
            <button className="link" onClick={onOpen}>
              Open
            </button>
          )}
          {n.choices.map((c, i) => (
            <button key={c} className={i === 0 ? 'primary' : undefined} onClick={() => onAnswer(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
