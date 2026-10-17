// Settings › Extensions › UI kit: every element of the Laki UI kit (widgetUi.ts) with its sample, drawn as the app
// draws an extension (a shadow root, `clean`, uiBehave), at a size picked per card and as a status bar item, its JSON
// a click from the clipboard. Its samples are the AI guide's, the starters' and the tests'.
import { useEffect, useRef, useState } from 'react'
import { uiBehave, WIDGET_CSS } from '../../shared/widget'
import { CHARTS, COLORS, DO, TONES, UI_EXAMPLES, uiHtml, UI_SAMPLES, type UiSpec } from '../../shared/widgetUi'
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

type Item = { key: string; title: string; tag: string; blurb: string; spec: UiSpec; data?: unknown; full?: boolean }
const ITEMS: Item[] = UI_SAMPLES.map(s => ({ key: s.type, title: s.type, tag: s.group, blurb: s.blurb, spec: s.spec, data: s.data }))
const EXAMPLES: Item[] = UI_EXAMPLES.map((x, i) => ({ key: `example-${i}`, title: x.title, tag: 'Example', blurb: x.blurb, spec: x.spec, data: x.data, full: x.full }))

// one element or example: at a size, as a status bar item, its JSON
function KitCard({ it, pick, onPick, copy }: { it: Item; pick: string; onPick: (n: string) => void; copy: (text: string) => void }) {
  const cells = SIZES.find(x => x[0] === pick)?.[1] ?? null
  const json = JSON.stringify({ ui: it.spec, ...(it.data !== undefined && { sample: it.data }) }, null, 2)
  return (
    <section className="ext-card kit-card" id={`kit-${it.key}`}>
      <div className="ext-card-head kit-card-head">
        <b className={it.tag === 'Example' ? '' : 'mono'}>{it.title}</b>
        <span className="tag">{it.tag}</span>
        <div className="seg" role="tablist" aria-label="Size">
          {SIZES.map(([n]) => (
            <button key={n} role="tab" aria-selected={pick === n} className={pick === n ? 'on' : ''} onClick={() => onPick(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="muted small kit-blurb">{it.blurb}</span>
      </div>
      <div className="ext-stage kit-stage">
        <div className="widget ext-tile" style={cells ? { width: cells[0] * 92, height: cells[1] * 64 } : { width: '100%', maxHeight: 360, overflow: 'auto' }}>
          <KitBody spec={it.spec} data={it.data} cells={cells} />
        </div>
        <div className="kit-status">
          <span className="muted small">status bar</span>
          <div className="widget ext-tile in-bar" style={{ width: 2 * 92 }}>
            <KitBody spec={it.spec} data={it.data} cells={[2, 0.5]} />
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
  const match = (it: Item) => words.every(w => `${it.title} ${it.tag} ${it.blurb} ${JSON.stringify(it.spec)}`.toLowerCase().includes(w))
  const shown = ITEMS.filter(match)
  const examples = EXAMPLES.filter(match)
  const card = (it: Item) => <KitCard key={it.key} it={it} pick={size[it.key] ?? (it.full ? 'Full' : '3×2')} onPick={n => setSize(x => ({ ...x, [it.key]: n }))} copy={copy} />
  const m = (t: string) => <span className="mono">{t}</span>
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
            An extension's UI as JSON elements: widget.json's {m('"ui"')}, one element or {m('{ "preview", "full" }')}. Each element takes {m('if')}, {m('unless')}, {m('each')}, {m('tip')} and {m('tone')} too; its words are templates over the data ({m('{{field}}')}, {m('{{ago at}}')}, {m('{{num n}}')}). {m('laki widget kit')} prints the same.
          </p>
          <ul className="muted small kit-notes">
            <li>
              <b>Colors</b>: a {m('color')} takes a tone ({TONES.join(', ')}), one of Laki's palette ({COLORS.join(', ')}: each theme's own) or a hex ({m('d73a4a')}). A chart takes {m('colors')} in order, a series its {m('color')}, a row its {m('color')} template.
            </li>
            <li>
              <b>Charts</b>: {m('kind')} {CHARTS.join(', ')}.
            </li>
            <li>
              <b>Buttons</b>: {m('run')} (an action), {m('open')} (a link), {m('do')} (a Laki command: {DO.join(', ')}; the app asks first), {m('refresh')}, {m('full')}, {m('copy')}.
            </li>
          </ul>
          <input className="kit-find" value={q} onChange={e => setQ(e.target.value)} placeholder="Find an element or example: chart, pie, button…" spellCheck={false} autoFocus />
        </div>
        {!shown.length && !examples.length && <p className="muted">Nothing matches.</p>}
        {!!shown.length && <h3 className="kit-h">Elements · {shown.length}</h3>}
        <div className="kit-grid">{shown.map(card)}</div>
        {!!examples.length && <h3 className="kit-h">Examples · {examples.length}</h3>}
        <div className="kit-grid">{examples.map(card)}</div>
      </div>
    </Page>
  )
}
