// Settings › Extensions › UI kit: every element of the Laki UI kit (widgetUi.ts) with its sample, drawn as the app
// draws an extension (a shadow root, `clean`, uiBehave), at a size picked per card and as a status bar item, its JSON
// a click from the clipboard. Its samples are the AI guide's, the starters' and the tests'. Icons: every icon of Laki's
// an extension can name (a button's, a list row's, the icon element's), found by name, a click copies it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ICONS, type IconName } from '../../shared/icons'
import { render, uiBehave, WIDGET_CSS } from '../../shared/widget'
import { STARTER_KINDS, STARTERS, type StarterKind } from '../../shared/widgetStarters'
import { Modal } from './panels'
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
function KitBody({ spec, data, cells, ws }: { spec: UiSpec; data: unknown; cells: [number, number] | null; ws?: Record<string, unknown> }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = WIDGET_CSS
    root.replaceChildren(style, clean(uiHtml(spec, { data, config: {}, at: Date.now() - 120_000, sample: true, ...(ws && { workspace: ws }) }, cells ? { cells } : { full: true })))
    return uiBehave(root, () => undefined)
  }, [spec, data, cells?.join()])
  return <div ref={host} className="widget-body" />
}

// New ▾ › From a starter: each starter drawn on its sample data (its ui; a rail button as one; a JS page or one file
// as what it is), a click makes it (laki widget new: yours, on, its page opened)
const SAMPLE_WS = { id: 'sample', name: 'fix-login', project: 'web', branch: 'fix-login', base: 'main', path: '~/code/web', port: 5173, pr: 'https://github.com/acme/web/pull/412' } // as the daemon's
type Look = { ui?: UiSpec; data: unknown; size: [number, number]; ws?: boolean; button?: { icon: string; label: string; badge: string }; code?: string; js?: boolean }
function lookOf(k: StarterKind): Look {
  const f = STARTERS[k].files('starter', STARTERS[k].title)
  let m: any = {}
  try {
    m = JSON.parse(f['widget.json'] ?? '{}')
  } catch {}
  let data: unknown = m.sample ?? {}
  try {
    if (f['fixtures/sample.json']) data = JSON.parse(f['fixtures/sample.json'])
  } catch {}
  const size: [number, number] = [Math.min(3, m.size?.[0] ?? 3), Math.min(3, m.size?.[1] ?? 2)]
  const one = !f['widget.json'] ? Object.values(f)[0] : undefined
  if (one) return { data, size, code: one.split('\n').slice(0, 9).join('\n') }
  if (m.place === 'rail' || m.place === 'foot') return { data, size, button: { icon: m.icon ?? 'panel', label: render(m.label ?? '', data as Record<string, unknown>), badge: render(m.badge ?? '', data as Record<string, unknown>) } }
  return m.ui ? { ui: m.ui, data, size, ws: m.scope === 'workspace' } : { data, size, js: true }
}
export function StarterPicker({ onPick, onClose }: { onPick: (k: StarterKind) => void; onClose: () => void }) {
  const looks = useMemo(() => STARTER_KINDS.map(k => [k, lookOf(k)] as const), []) // once: a new spec each render would draw each again
  return (
    <Modal title="Start from a starter" wide onClose={onClose}>
      <p className="muted small">Each runs at once on its sample data, yours to change: its files, its data, its look. Pick one.</p>
      <div className="starter-grid">
        {looks.map(([k, l]) => (
          <button key={k} type="button" className="starter-card" onClick={() => onPick(k)}>
            <span className="starter-look" inert>
              {l.ui ? (
                <span className="widget ext-tile" style={{ width: l.size[0] * 92, height: l.size[1] * 64 }}>
                  <KitBody spec={l.ui} data={l.data} cells={l.size} ws={l.ws ? SAMPLE_WS : undefined} />
                </span>
              ) : l.button ? (
                <span className="starter-btn">
                  <Icon name={l.button.icon as IconName} size={18} />
                  <span className="small">{l.button.label}</span>
                  {l.button.badge && <span className="starter-badge">{l.button.badge}</span>}
                </span>
              ) : l.code ? (
                <pre className="mono starter-code">{l.code}</pre>
              ) : (
                <span className="starter-js">
                  <Icon name="code" size={22} />
                  <span className="small muted">A page of its own: widget.html with a script</span>
                </span>
              )}
            </span>
            <b>{STARTERS[k].title}</b>
            <span className="muted small">{STARTERS[k].blurb}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
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

const NAMES = Object.keys(ICONS) as IconName[]
// its words for the filter: ciFail is "ci fail"
const wordsOf = (n: string) => `${n} ${n.replace(/([a-z])([A-Z])/g, '$1 $2')}`.toLowerCase()

// every icon: a tile each (a click picks it and copies its name), the picked one at each size and as it's used
function IconGallery({ copy }: { copy: (text: string) => void }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<IconName>('check')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = NAMES.filter(n => words.every(w => wordsOf(n).includes(w)))
  const uses: [string, string][] = [
    ['The icon element', JSON.stringify({ type: 'icon', name: pick, size: 'lg', color: 'accent' })],
    ['A button', JSON.stringify({ type: 'button', label: 'Refresh', icon: pick, refresh: true })],
    ['On the rail (widget.json)', JSON.stringify({ place: 'rail', icon: pick })],
  ]
  const pickIt = (n: IconName) => (setPick(n), copy(n))
  return (
    <div className="kit-icons">
      <div className="kit-icons-head">
        <input className="kit-find" value={q} onChange={e => setQ(e.target.value)} placeholder={`Find one of ${NAMES.length} icons: check, clock, github…`} spellCheck={false} autoFocus />
        <span className="muted small">A click copies its name. Any emoji works too: {'"icon": "🚀"'}.</span>
      </div>
      <div className="kit-icons-body">
        <div className="kit-icon-grid" role="listbox" aria-label="Icons">
          {shown.map(n => (
            <button key={n} type="button" role="option" aria-selected={pick === n} className={`kit-icon${pick === n ? ' on' : ''}`} data-tip={`Copy “${n}”`} onClick={() => pickIt(n)}>
              <Icon name={n} size={20} />
              <span className="mono">{n}</span>
            </button>
          ))}
          {!shown.length && <p className="muted">No icon has “{q}” in its name: an emoji works anywhere an icon does.</p>}
        </div>
        <aside className="ext-card kit-icon-pick">
          <div className="ext-card-head">
            <b className="mono">{pick}</b>
            <span className="grow" />
            <button type="button" className="sm" onClick={() => copy(pick)}>
              <Icon name="copy" size={12} /> Copy
            </button>
          </div>
          <div className="kit-icon-sizes">
            {[12, 16, 22, 32].map(px => (
              <span key={px}>
                <Icon name={pick} size={px} />
                <span className="muted small">{px}</span>
              </span>
            ))}
          </div>
          <div className="kit-icon-tones">
            {['', 't-good', 't-bad', 't-warn', 't-accent'].map(t => (
              <span key={t} className={t || undefined} style={t ? { color: `var(--${{ 't-good': 'done', 't-bad': 'error', 't-warn': 'waiting', 't-accent': 'accent' }[t]})` } : undefined}>
                <Icon name={pick} size={18} />
              </span>
            ))}
          </div>
          {uses.map(([what, json]) => (
            <div key={what} className="kit-icon-use">
              <span className="muted small">{what}</span>
              <button type="button" className="mono small" data-tip="Copy" onClick={() => copy(json)}>
                {json}
              </button>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}

export function UiKitPage({ back, onClose, copy, icons }: { back: string; onClose: () => void; copy: (text: string) => void; icons?: boolean }) {
  const [view, setView] = useState<'kit' | 'icons'>(icons ? 'icons' : 'kit')
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
          <div className="seg kit-view" role="tablist" aria-label="Show">
            {(['kit', 'icons'] as const).map(v => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'kit' ? 'Elements' : `Icons · ${NAMES.length}`}
              </button>
            ))}
          </div>
        </nav>
      }
    >
      {view === 'icons' ? <IconGallery copy={copy} /> : <div className="kit">
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
      </div>}
    </Page>
  )
}
