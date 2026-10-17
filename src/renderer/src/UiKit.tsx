// Settings › Extensions › UI kit: every element of the Laki UI kit (widgetUi.ts) with its sample, drawn as the app
// draws an extension (a shadow root, `clean`, uiBehave), at a size picked per card and as a status bar item, its JSON
// a click from the clipboard. Its samples are the AI guide's, the starters' and the tests'.
import { useEffect, useRef, useState } from 'react'
import { uiBehave, WIDGET_CSS } from '../../shared/widget'
import { uiHtml, UI_SAMPLES, type UiSpec } from '../../shared/widgetUi'
import { escapes, Icon, Page } from './ui'
import { clean } from './Widgets'

const SIZES: [string, [number, number] | null][] = [
  ['1×1', [1, 1]],
  ['3×1', [3, 1]],
  ['3×2', [3, 2]],
  ['Full', null],
]

// one sample drawn: its buttons and links do nothing here, its filters and tabs work
function KitBody({ spec, data, cells }: { spec: UiSpec; data: unknown; cells: [number, number] | null }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = WIDGET_CSS
    root.replaceChildren(style, clean(uiHtml(spec, { data, config: {}, at: Date.now() - 120_000, sample: true }, cells ? { cells } : { full: true })))
    return uiBehave(root, () => undefined)
  }, [spec, data, cells?.join()])
  return <div ref={host} className="widget-body" />
}

export function UiKitPage({ back, onClose, copy }: { back: string; onClose: () => void; copy: (text: string) => void }) {
  const [q, setQ] = useState('')
  const [size, setSize] = useState<Record<string, string>>({})
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Esc goes back, unless the filter has something typed (it clears first)
  useEffect(() => {
    const f = (e: KeyboardEvent) => escapes(e) && !(document.activeElement instanceof HTMLInputElement && document.activeElement.value) && closeRef.current()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = UI_SAMPLES.filter(s => words.every(w => `${s.type} ${s.group} ${s.blurb}`.toLowerCase().includes(w)))
  return (
    <Page
      title="UI kit"
      wide
      esc={false}
      onClose={onClose}
      head={
        <nav className="crumbs" aria-label="Where you are">
          <button className="crumb" onClick={onClose}>
            <Icon name="chevronLeft" size={12} /> {back}
          </button>
          <span className="muted">›</span>
          <b className="crumb here">UI kit</b>
        </nav>
      }
    >
      <div className="kit">
        <div className="kit-head">
          <p className="muted">
            An extension's UI as JSON elements: widget.json's <span className="mono">"ui"</span>, one element or <span className="mono">{'{ "preview", "full" }'}</span>. Each element takes <span className="mono">if</span>, <span className="mono">unless</span>, <span className="mono">each</span>, <span className="mono">tip</span> and <span className="mono">tone</span> too; its words are templates over the data (<span className="mono">{'{{field}}'}</span>, <span className="mono">{'{{ago at}}'}</span>, <span className="mono">{'{{num n}}'}</span>). <span className="mono">laki widget kit</span> prints the same.
          </p>
          <input className="kit-find" value={q} onChange={e => setQ(e.target.value)} placeholder="Find an element: list, chart, form…" spellCheck={false} autoFocus />
        </div>
        {!shown.length && <p className="muted">No element matches.</p>}
        <div className="kit-grid">
          {shown.map(s => {
            const pick = size[s.type] ?? '3×2'
            const cells = SIZES.find(x => x[0] === pick)?.[1] ?? null
            const json = JSON.stringify({ ui: s.spec, ...(s.data !== undefined && { sample: s.data }) }, null, 2)
            return (
              <section key={s.type} className="ext-card kit-card" id={`kit-${s.type}`}>
                <div className="ext-card-head">
                  <b className="mono">{s.type}</b>
                  <span className="tag">{s.group}</span>
                  <span className="muted small grow">{s.blurb}</span>
                  <div className="seg" role="tablist" aria-label="Size">
                    {SIZES.map(([n]) => (
                      <button key={n} role="tab" aria-selected={pick === n} className={pick === n ? 'on' : ''} onClick={() => setSize(x => ({ ...x, [s.type]: n }))}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ext-stage kit-stage">
                  <div className="widget ext-tile" style={cells ? { width: cells[0] * 92, height: cells[1] * 64 } : { width: '100%', maxHeight: 360, overflow: 'auto' }}>
                    <KitBody spec={s.spec} data={s.data} cells={cells} />
                  </div>
                  <div className="kit-status">
                    <span className="muted small">status bar</span>
                    <div className="widget ext-tile bar" style={{ width: 2 * 92 }}>
                      <KitBody spec={s.spec} data={s.data} cells={[2, 0.5]} />
                    </div>
                  </div>
                </div>
                <div className="kit-json">
                  <pre className="mono">{json}</pre>
                  <button type="button" className="sm" onClick={() => copy(json)}>
                    <Icon name="copy" size={12} /> Copy
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </Page>
  )
}
