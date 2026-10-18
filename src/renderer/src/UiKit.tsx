// Settings › Extensions › UI kit: every element of the Laki UI kit (widgetUi.ts) with its sample, drawn as the app
// draws an extension (a shadow root, `clean`, uiBehave), at a size picked per card and as a status bar item, its JSON
// a click from the clipboard. Its samples are the AI guide's, the starters' and the tests'. Icons: every icon of Laki's
// an extension can name (a button's, a list row's, the icon element's), found by name, a click copies it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ICON_GROUPS, ICONS, type IconName } from '../../shared/icons'
import { render, uiBehave, WIDGET_CSS } from '../../shared/widget'
import { STARTER_KINDS, STARTERS, type StarterKind } from '../../shared/widgetStarters'
import { Modal } from './panels'
import { CHARTS, colorCss, COLORS, DO, TONES, UI_EXAMPLES, uiHtml, UI_SAMPLES, type UiElement, type UiSpec } from '../../shared/widgetUi'
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
// Laki's own first (the app's), then the generic ones by group
const GROUPED = new Set(Object.values(ICON_GROUPS).flat())
const GROUPS: [string, IconName[]][] = [['Laki', NAMES.filter(n => !GROUPED.has(n))], ...Object.entries(ICON_GROUPS).map(([g, l]) => [g, [...l]] as [string, IconName[]])]
const GROUP_OF = new Map(GROUPS.flatMap(([g, l]) => l.map(n => [n, g] as const)))
// its words for the filter: ciFail is "ci fail", and its group's (weather finds sun)
const wordsOf = (n: string) => `${n} ${n.replace(/([a-z])([A-Z])/g, '$1 $2')} ${GROUP_OF.get(n as IconName) ?? ''}`.toLowerCase()

// every icon: a tile each (a click picks it and copies its name), the picked one at each size and as it's used
function IconGallery({ copy }: { copy: (text: string) => void }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<IconName>('check')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = NAMES.filter(n => words.every(w => wordsOf(n).includes(w)))
  const has = new Set(shown)
  const uses: [string, string][] = [
    ['The icon element', JSON.stringify({ type: 'icon', name: pick, size: 'lg', color: 'accent' })],
    ['A button', JSON.stringify({ type: 'button', label: 'Refresh', icon: pick, refresh: true })],
    ['On the rail (widget.json)', JSON.stringify({ place: 'rail', icon: pick })],
  ]
  const pickIt = (n: IconName) => (setPick(n), copy(n))
  return (
    <div className="kit-icons">
      <div className="kit-icons-head">
        <input className="kit-find" value={q} onChange={e => setQ(e.target.value)} placeholder={`Find one of ${NAMES.length} icons: check, weather, arrow…`} spellCheck={false} autoFocus />
        <span className="muted small">A click copies its name. Any emoji works too: {'"icon": "🚀"'}.</span>
      </div>
      <div className="kit-icons-body">
        <div className="kit-icon-groups">
          {GROUPS.map(([g, list]) => (l => l.length > 0 && (
            <section key={g}>
              <h3 className="kit-h">{g} · {l.length}</h3>
              <div className="kit-icon-grid" role="listbox" aria-label={`${g} icons`}>
                {l.map(n => (
                  <button key={n} type="button" role="option" aria-selected={pick === n} className={`kit-icon${pick === n ? ' on' : ''}`} data-tip={`Copy “${n}”`} onClick={() => pickIt(n)}>
                    <Icon name={n} size={20} />
                    <span className="mono">{n}</span>
                  </button>
                ))}
              </div>
            </section>
          ))(list.filter(n => has.has(n))))}
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

// Typography, as Bootstrap's docs show theirs: each text style the kit draws, its JSON beside it (a click copies it)
const TYPE: { head: string; blurb: string; rows: [string, UiElement, unknown?][] }[] = [
  { head: 'Headings', blurb: 'heading, level 1 to 3: a title over what follows.', rows: [1, 2, 3].map(l => [`level ${l}`, { type: 'heading', value: 'Production is up', level: l }] as [string, UiElement]) },
  { head: 'Sizes', blurb: 'text’s size: sm, md (the default), lg, xl. A big number: xl and semibold, or stat.', rows: (['xl', 'lg', 'md', 'sm'] as const).map(z => [`size ${z}`, { type: 'text', value: z === 'xl' ? '12,840 visits' : 'Last deploy 2 hours ago by octocat', size: z, ...(z === 'xl' && { weight: 'semibold' as const }) }] as [string, UiElement]) },
  { head: 'Weights', blurb: 'text’s weight: normal, medium, semibold, bold.', rows: (['normal', 'medium', 'semibold', 'bold'] as const).map(w => [`weight ${w}`, { type: 'text', value: 'Move billing to the new API', weight: w }] as [string, UiElement]) },
  {
    head: 'Styles',
    blurb: 'mono for code and ids, muted for what matters less, wrap for more than a line; a tone or a color for what it says.',
    rows: [
      ['mono', { type: 'text', value: 'feat/search-index', mono: true }],
      ['muted', { type: 'text', value: 'Updated 3 minutes ago', muted: true }],
      ['wrap', { type: 'text', value: 'A long line wraps onto more lines instead of being cut with an ellipsis, when wrap is true.', wrap: true }],
      ['tone', { type: 'row', gap: 'lg', children: TONES.map(t => ({ type: 'text', value: t, tone: t })) }],
      ['color', { type: 'row', gap: 'lg', wrap: true, children: COLORS.slice(0, 6).map(c => ({ type: 'text', value: c, color: c, weight: 'medium' })) }],
    ],
  },
  {
    head: 'Inline',
    blurb: 'Small things in a line: keys, a count, labels, an icon.',
    rows: [
      ['kbd', { type: 'kbd', keys: '⌘ ⇧ P', label: 'Every command' }],
      ['badge', { type: 'row', children: [{ type: 'badge', value: '3' }, { type: 'badge', value: '2 failing', tone: 'bad' }, { type: 'badge', value: 'new', color: 'teal' }] }],
      ['tags', { type: 'tags', items: [{ tag: 'bug', color: 'd73a4a' }, { tag: 'ready', tone: 'good' }, 'docs'] }],
      ['icon', { type: 'row', children: [{ type: 'icon', name: 'check', color: 'good' }, { type: 'text', value: 'All checks passed' }] }],
    ],
  },
  {
    head: 'Blocks',
    blurb: 'Words that stand on their own: a quote, code, a callout, Markdown.',
    rows: [
      ['quote', { type: 'quote', text: 'Make it work, make it right, make it fast.', by: 'Kent Beck' }],
      ['code', { type: 'code', value: 'gh pr checkout 412\nnpm test', copy: true }],
      ['callout', { type: 'callout', tone: 'warn', title: 'Staging is slow', text: 'p95 over 2 s since 09:10' }],
      ['markdown', { type: 'markdown', value: '### Release notes\n\n**Shipped** the new search, *30%* faster.\n\n- [x] Index orders\n- [ ] Index customers\n\n`npm run reindex` · [the PR](https://github.com/acme/web/pull/418)' }],
    ],
  },
]
function TypeView({ copy }: { copy: (text: string) => void }) {
  return (
    <div className="kit-type">
      {TYPE.map(g => (
        <section key={g.head} className="kit-type-g">
          <h3 className="kit-h">{g.head}</h3>
          <p className="muted small">{g.blurb}</p>
          <div className="ext-card kit-type-rows">
            {g.rows.map(([name, spec, data]) => (
              <div key={name} className="kit-type-row">
                <span className="mono small muted kit-type-n">{name}</span>
                <div className="widget kit-type-s">
                  <KitBody spec={spec} data={data} cells={null} />
                </div>
                <button type="button" className="mono small kit-type-j" data-tip="Copy" onClick={() => copy(JSON.stringify(spec))}>
                  {JSON.stringify(spec)}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// Colors: the tones, Laki's palette (each theme its own) and the theme's own variables, as this theme paints them; a
// click copies how an extension names it
const THEME_VARS: [string, string][] = [
  ['--bg', 'The background'],
  ['--panel', 'Panels and cards'],
  ['--hover', 'A row under the mouse, a box'],
  ['--line', 'Borders and rules'],
  ['--fg', 'Text'],
  ['--muted', 'Quieter text'],
  ['--accent', 'The accent: links, the picked one'],
  ['--accent-fg', 'Text on the accent'],
]
let pixel: CanvasRenderingContext2D | null | undefined // one for every swatch
function Swatch({ name, css, use, note, copy }: { name: string; css: string; use: string; note?: string; copy: (text: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [hex, setHex] = useState('')
  const theme = document.documentElement.getAttribute('style') ?? '' // applyTheme's variables: read again when they change
  useEffect(() => {
    // as this theme paints it: one pixel of it on a canvas (a theme may give a color() or a color-mix())
    pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!pixel) return
    pixel.clearRect(0, 0, 1, 1)
    pixel.fillStyle = getComputedStyle(ref.current!).backgroundColor
    pixel.fillRect(0, 0, 1, 1)
    setHex(`#${[...pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(x => x.toString(16).padStart(2, '0')).join('')}`)
  }, [css, theme])
  return (
    <button type="button" className="kit-sw" data-tip={`Copy ${use}`} onClick={() => copy(use)}>
      <span ref={ref} className="kit-sw-c" style={{ background: css }} />
      <span className="kit-sw-t">
        <b>{name}</b>
        <span className="mono small muted">{hex}</span>
        {note && <span className="small muted">{note}</span>}
      </span>
    </button>
  )
}
const IN_USE: UiElement = { type: 'stack', children: [{ type: 'tags', items: [...TONES.map(t => ({ tag: t, tone: t })), ...COLORS.map(c => ({ tag: c, color: c }))] }, { type: 'row', wrap: true, children: COLORS.map(c => ({ type: 'badge', value: c, color: c })) }] }
function ColorView({ copy }: { copy: (text: string) => void }) {
  const groups: { head: string; blurb: string; items: { name: string; css: string; use: string; note?: string }[] }[] = [
    { head: 'Tones', blurb: 'What a thing is. tone on any element (or a map from its words: { "failed": "bad" }), or a color.', items: TONES.map(t => ({ name: t, css: colorCss(t), use: `"tone": "${t}"`, note: { good: 'done, up, passing', bad: 'failed, down', warn: 'waiting, slow', accent: 'the theme’s accent', muted: 'less important' }[t] })) },
    { head: 'Palette', blurb: 'Laki’s colors, each theme’s own shade: labels, a chart’s series, dots. Any hex works too: "color": "d73a4a".', items: COLORS.map(c => ({ name: c, css: colorCss(c), use: `"color": "${c}"` })) },
    { head: 'Theme', blurb: 'What an extension sits on: a JS page and a widget.html’s own CSS can use these variables.', items: THEME_VARS.map(([v, note]) => ({ name: v, css: `var(${v})`, use: `var(${v})`, note })) },
  ]
  return (
    <div className="kit-colors">
      {groups.map(g => (
        <section key={g.head}>
          <h3 className="kit-h">{g.head}</h3>
          <p className="muted small">{g.blurb}</p>
          <div className="kit-sw-grid">
            {g.items.map(x => (
              <Swatch key={x.name} {...x} copy={copy} />
            ))}
          </div>
        </section>
      ))}
      <section>
        <h3 className="kit-h">In use</h3>
        <div className="ext-card kit-type-rows">
          <div className="widget kit-type-s">
            <KitBody spec={IN_USE} data={undefined} cells={null} />
          </div>
        </div>
      </section>
    </div>
  )
}

export function UiKitPage({ back, onClose, copy, icons }: { back: string; onClose: () => void; copy: (text: string) => void; icons?: boolean }) {
  const [view, setView] = useState<'kit' | 'type' | 'colors' | 'icons'>(icons ? 'icons' : 'kit')
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
            {(['kit', 'type', 'colors', 'icons'] as const).map(v => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {{ kit: 'Elements', type: 'Typography', colors: 'Colors', icons: `Icons · ${NAMES.length}` }[v]}
              </button>
            ))}
          </div>
        </nav>
      }
    >
      {view === 'icons' ? <IconGallery copy={copy} /> : view === 'type' ? <TypeView copy={copy} /> : view === 'colors' ? <ColorView copy={copy} /> : <div className="kit">
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
