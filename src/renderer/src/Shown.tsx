// A workflow's Show you block (daemon/workflow.ts' popup): a window over the app with what the run shows you, read and
// closed (Esc, Close). HTML goes in a sandboxed frame: no scripts, nothing it loads but pictures, links open in the
// browser (main's window-open handler); anything else is Markdown.
import { useEffect, useMemo } from 'react'
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
export function ShownPops({ pops, onShow, onOpenRun, onClose }: { pops: ShownPop[]; onShow: (p: ShownPop) => void; onOpenRun: (p: ShownPop) => void; onClose: (key: number) => void }) {
  if (!pops.length) return null
  return (
    <div className="shown-pops" role="status">
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
