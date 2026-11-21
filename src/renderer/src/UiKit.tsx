// Settings › Extensions › UI kit: every element of the Laki UI kit (widgetUi.ts) with its sample, drawn as the app
// draws an extension (a shadow root, `clean`, uiBehave), at a size picked per card and as a status bar item, its JSON
// a click from the clipboard. Its samples are the AI guide's, the starters' and the tests'. Icons: every icon of Laki's
// an extension can name (a button's, a list row's, the icon element's), found by name, a click copies it.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ICON_GROUPS, ICON_PACKS, iconLook, iconOf, ICONS, type IconName, onIconLook } from '../../shared/icons'
import { render } from '../../shared/widget'
import { STARTER_KINDS, STARTERS, type StarterKind } from '../../shared/widgetStarters'
import { bridge, notify } from './api'
import { Modal } from './panels'
import { CHARTS, colorCss, COLORS, DO, TONES, uiCheck, UI_EXAMPLES, UI_GROUPS, UI_SAMPLES, type UiElement, type UiGroup, type UiSpec } from '../../shared/widgetUi'
import { escapes, Icon, Page } from './ui'
import { CELL_W, KitBody } from './Widgets'
import './uikit.css'

const SIZES: [string, [number, number] | null][] = [
  ['1×1', [1, 1]],
  ['4×1', [4, 1]],
  ['4×2', [4, 2]],
  ['Full', null],
]


// New ▾ › From a starter: each starter drawn on its sample data (its ui; a button, rail or no look of its own, as one; a JS page or one file
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
  const size: [number, number] = [Math.min(4, m.size?.[0] ?? 4), Math.min(3, m.size?.[1] ?? 2)]
  const one = !f['widget.json'] ? Object.values(f)[0] : undefined
  if (one) return { data, size, code: one.split('\n').slice(0, 9).join('\n') }
  if (m.place === 'none') return { data, size, button: { icon: 'bell', label: 'In the background', badge: '' } }
  if (m.place === 'rail' || m.place === 'foot' || m.place === 'more' || (!m.ui && !f['widget.html'])) return { data, size, button: { icon: m.icon ?? 'panel', label: render(m.label ?? '', data as Record<string, unknown>), badge: render(m.badge ?? '', data as Record<string, unknown>) } }
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
                <span className="widget ext-tile" style={{ width: l.size[0] * CELL_W, height: l.size[1] * 64 }}>
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
// C4: its ui and its sample edited in place (each box read 300 ms after a key), drawn the same way, uiCheck's problems
// under it; Reset puts the sample back; Make an extension from this: yours, its data that sample (a static source)
const DRAW_AFTER = 300
function KitCard({ it, pick, onPick, copy, make }: { it: Item; pick: string; onPick: (n: string) => void; copy: (text: string) => void; make?: (name: string, ui: UiSpec, sample: unknown) => void }) {
  const cells = SIZES.find(x => x[0] === pick)?.[1] ?? null
  const first = useMemo(() => [JSON.stringify(it.spec, null, 2), it.data === undefined ? '' : JSON.stringify(it.data, null, 2)], [it.key])
  const [uiText, setUiText] = useState(first[0])
  const [dataText, setDataText] = useState(first[1])
  const [shown, setShown] = useState<{ spec: UiSpec; data: unknown; bad?: string }>({ spec: it.spec, data: it.data })
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const spec = JSON.parse(uiText) as UiSpec
        const data = dataText.trim() ? JSON.parse(dataText) : undefined
        setShown({ spec, data })
      } catch (e) {
        setShown(s => ({ ...s, bad: (e as Error).message }))
      }
    }, DRAW_AFTER)
    return () => clearTimeout(t)
  }, [uiText, dataText])
  const edited = uiText !== first[0] || dataText !== first[1]
  const problems = useMemo(() => uiCheck(shown.spec, shown.data).filter(p => p.level !== 'ok'), [shown])
  const json = JSON.stringify({ ui: shown.spec, ...(shown.data !== undefined && { sample: shown.data }) }, null, 2)
  return (
    <section className="ext-card kit-card" id={`kit-${it.key}`}>
      <div className="ext-card-head kit-card-head">
        <b className={it.tag === 'Example' ? '' : 'mono'}>{it.title}</b>
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
        <div className="widget ext-tile" style={cells ? { width: cells[0] * CELL_W, height: cells[1] * 64 } : { width: '100%', maxHeight: 360, overflow: 'auto' }}>
          <KitBody spec={shown.spec} data={shown.data} cells={cells} />
        </div>
        <div className="kit-status">
          <span className="muted small">status bar</span>
          <div className="widget ext-tile in-bar" style={{ width: 2 * 92 }}>
            <KitBody spec={shown.spec} data={shown.data} cells={[2, 0.5]} />
          </div>
        </div>
      </div>
      {(shown.bad || problems.length > 0) && (
        <ul className="kit-problems small">
          {shown.bad && <li className="bad">Not JSON: {shown.bad}</li>}
          {problems.map((p, i) => (
            <li key={i} className={p.level === 'error' ? 'bad' : 'warn'}>
              {p.level === 'error' ? '✗' : '!'} {p.where}: {p.text}
            </li>
          ))}
        </ul>
      )}
      <div className="kit-json kit-edit">
        <label className="small muted" htmlFor={`kit-ui-${it.key}`}>
          ui
        </label>
        <textarea id={`kit-ui-${it.key}`} className="mono" spellCheck={false} value={uiText} onChange={e => setUiText(e.target.value)} />
        <label className="small muted" htmlFor={`kit-data-${it.key}`}>
          sample
        </label>
        <textarea id={`kit-data-${it.key}`} className="mono" spellCheck={false} value={dataText} onChange={e => setDataText(e.target.value)} />
        <div className="kit-edit-acts">
          <button type="button" className="sm" onClick={() => copy(json)}>
            <Icon name="copy" size={12} /> Copy
          </button>
          <button type="button" className="sm" disabled={!edited} onClick={() => (setUiText(first[0]), setDataText(first[1]))}>
            Reset
          </button>
          {make && (
            <button type="button" className="sm primary" disabled={!!shown.bad} data-tip="An extension of yours showing this, its data this sample: it opens on its page" onClick={() => {
                try {
                  make(it.title, JSON.parse(uiText) as UiSpec, dataText.trim() ? JSON.parse(dataText) : undefined) // as the boxes say now, not 300 ms ago
                } catch (e) {
                  setShown(s => ({ ...s, bad: (e as Error).message }))
                }
              }}>
              Make an extension from this
            </button>
          )}
        </div>
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
  const look = useSyncExternalStore(onIconLook, iconLook) // Settings › Appearance › Icons' pack: what's drawn here
  const pack = ICON_PACKS.find(([p]) => p === look.pack)?.[1]
  const own = (n: IconName) => look.pack !== 'laki' && iconOf(n, look).box === 16 // the pack lacks it: Laki's own
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
        <span className="muted small">
          A click copies its name. Drawn in {pack} (Settings › Appearance › Icons): a name is the same in every pack, so it follows the one picked. Any emoji works too: {'"icon": "🚀"'}.
        </span>
      </div>
      <div className="kit-icons-body">
        <div className="kit-icon-groups">
          {GROUPS.map(([g, list]) => (l => l.length > 0 && (
            <section key={g}>
              <h3 className="kit-h">{g} · {l.length}</h3>
              <div className="kit-icon-grid" role="listbox" aria-label={`${g} icons`}>
                {l.map(n => (
                  <button key={n} type="button" role="option" aria-selected={pick === n} className={`kit-icon${pick === n ? ' on' : ''}`} data-tip={`Copy “${n}”${own(n) ? ` · ${pack} has none: Laki's own` : ''}`} onClick={() => pickIt(n)}>
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
                <Icon name={pick} size={px} look={{ ...look, size: 14 }} />
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

// What it can do: each thing an extension can do, what it writes for it (widget.json, or the JSON an action prints) and
// Try: the real thing with made-up words (a toast, a notification, a dialog, the card on screen), or Make one from its
// starter. Nothing runs: no extension is involved
type Can = { icon: IconName; title: string; blurb: string; code: string; try?: 'background' | 'notify' | 'toast' | 'modal' | 'alert'; starter?: StarterKind; look?: UiSpec; data?: unknown }
const DEPLOY: UiSpec = { type: 'list', each: 'commits', title: '{{msg}}', subtitle: '{{sha}} · {{when}}', icon: 'gitCommit' } as UiSpec
const COMMITS = { commits: [{ msg: 'Fix the cart total rounding', sha: 'a1f3c9e', when: '2 h ago' }, { msg: 'Faster product search', sha: '7bd2e10', when: '5 h ago' }, { msg: 'Bump the API client', sha: 'c04e8a2', when: 'yesterday' }] }
const CAN: Can[] = [
  { icon: 'layout', title: 'Show where you work', blurb: 'A number, a list, a chart or a button: in the sidebar, the top or status bar, on the rail, in the ⋯ menu, on My Desk, in the side panel, on each workspace’s row or under each agent turn. A click opens its full view.', code: '{\n  "place": ["side", "status"],\n  "every": 5,\n  "fetch": "gh pr list --json number --jq \'{n: length}\'",\n  "ui": { "type": "stat", "value": "{{n}}", "label": "open PRs" }\n}', starter: 'number', look: { type: 'stat', value: '7', label: 'open PRs', tone: 'accent' } as UiSpec },
  { icon: 'moon', title: 'Run in the background', blurb: '"place": "none" shows it nowhere. Its fetch still runs every few minutes while Laki is open, its handlers answer Laki’s events, and it speaks up only when it has something to say.', code: '{\n  "place": "none",\n  "every": 5,\n  "fetch": "sh health.sh",\n  "notify": "{{#unless ok}}api.acme.dev is down{{/unless}}",\n  "on": { "pr.checks.failed": "failed" },\n  "actions": { "failed": "sh failed.sh" }\n}', try: 'background', starter: 'background' },
  { icon: 'bell', title: 'Notifications', blurb: 'A notification on your Mac, and a toast in Laki: its notify template after each fetch (said once each time it reads anew), or {"notify": …} printed by an action or an event’s handler.', code: '{ "notify": "Deploy of web is done: 3 commits" }', try: 'notify' },
  { icon: 'message', title: 'Toasts', blurb: 'A short line at the bottom of Laki’s window that goes by itself: what an action printed last, or its toast.', code: '{ "toast": "Saved to Notes" }', try: 'toast' },
  { icon: 'panel', title: 'Dialogs', blurb: 'A dialog over Laki: its words, a UI kit element over its own data and up to 6 buttons, each running one of its actions or opening a link. An id lets a later one update it (a progress dialog).', code: '{ "modal": {\n  "title": "Deploy web?",\n  "text": "3 commits since the last deploy",\n  "ui": { "type": "list", "each": "commits", "title": "{{msg}}", "subtitle": "{{sha}} · {{when}}" },\n  "data": { "commits": [{ "msg": "Fix the cart total rounding", "sha": "a1f3c9e", "when": "2 h ago" }, …] },\n  "buttons": [{ "label": "Deploy", "run": "deploy", "style": "primary" }, { "label": "Not now" }]\n} }', try: 'modal', look: DEPLOY, data: COMMITS },
  { icon: 'monitor', title: 'A card on your screen', blurb: 'For what can’t wait: a card over every app, bottom right, until you close it. Its first line, from Laki, names the extension that sent it; 5 a minute at most.', code: '{ "alert": { "title": "Prod is down", "text": "api.acme.dev answers 502 since 10:42" } }', try: 'alert' },
  { icon: 'run', title: 'Control Laki', blurb: 'Its buttons ask Laki to start a workspace with a prompt, message the workspace’s agent, ask Laki AI, open a terminal or a page (Laki shows what and asks first). Its scripts run the laki command as $LAKI_CLI: anything the CLI does.', code: '"$LAKI_CLI" new web "Fix the flaky cart test"\n"$LAKI_CLI" send "$LAKI_WORKSPACE" --when-idle "Run the tests"\n"$LAKI_CLI" alert "Release is tagged" --choice OK\n"$LAKI_CLI" ls --json', starter: 'launcher', look: { type: 'row', children: [{ type: 'button', label: 'Fix a flaky test', icon: 'agent', do: 'new', prompt: 'Find and fix the flakiest test' }, { type: 'button', label: 'Ask the agent', icon: 'run', do: 'send', prompt: 'Run the tests' }] } as UiSpec },
  { icon: 'zap', title: 'Answer Laki’s events', blurb: 'An agent’s turn done or waiting, a PR opened, failing, reviewed or merged, a workspace made or archived, a port open, a webhook, your own (laki widget emit): each runs one of its actions, the event as JSON on stdin.', code: '"on": {\n  "turn.done": "note",\n  "pr.checks.failed": "failed",\n  "pr.merged": "refresh"\n}', starter: 'turn' },
  { icon: 'wrench', title: 'Tools for your agents', blurb: 'An action with a tool: Claude Code and Laki AI can call it, with its input, asked first (or always allowed once you say so).', code: '"actions": { "add": {\n  "run": "sh add.sh",\n  "tool": { "description": "Add a note to the board", "input": { "text": "the note" } }\n} }', starter: 'tool' },
  { icon: 'shield', title: 'Gates', blurb: 'Hold a ship, a merge or an archive until its check passes, or Claude Code’s tool calls (tool.call): its action’s exit says go or why not.', code: '"actions": { "lint": {\n  "run": "npm run lint",\n  "gate": ["ship", "merge"]\n} }' },
]
let tried = 0
function CanView({ copy, toast, start }: { copy: (text: string) => void; toast?: (text: string) => void; start?: (k: StarterKind, name: string) => void }) {
  const [modal, setModal] = useState(false)
  const [soon, setSoon] = useState(false)
  const say = (t: string) => (toast ? toast(t) : undefined)
  const alert = () =>
    bridge
      ? notify('Prod is down', 'api.acme.dev answers 502 since 10:42', '', () => {}, undefined, [], { alert: `try-${++tried}`, origin: 'message from the extension Uptime (an example: the UI kit’s Try)' })
      : say('Prod is down: api.acme.dev answers 502 since 10:42 (in the app, a card over every app)')
  const go: Record<NonNullable<Can['try']>, () => void> = {
    background: () => (setSoon(true), setTimeout(() => (setSoon(false), notify('Uptime', 'api.acme.dev is down', '', () => {}), say('Uptime: api.acme.dev is down')), 2500)),
    notify: () => (notify('Deploys', 'Deploy of web is done: 3 commits', '', () => {}), say('Deploys: Deploy of web is done: 3 commits')),
    toast: () => say('Saved to Notes'),
    modal: () => setModal(true),
    alert,
  }
  return (
    <div className="kit">
      <p className="muted">
        An extension is a folder with a widget.json: what it fetches, when, and what it does with it. It can show in many places or in none at all. Each Try below shows the real thing with made-up words; Make one starts an extension of yours from a starter.
      </p>
      <div className="kit-grid kit-can">
        {CAN.map(c => (
          <section key={c.title} className="ext-card kit-card">
            <div className="ext-card-head kit-card-head">
              <Icon name={c.icon} size={16} />
              <b>{c.title}</b>
              <span className="muted small kit-blurb">{c.blurb}</span>
            </div>
            {c.look && (
              <div className="ext-stage kit-can-look" inert>
                <div className="widget ext-tile" style={{ width: 4 * CELL_W }}>
                  <KitBody spec={c.look} data={c.data ?? {}} cells={[4, 2]} />
                </div>
              </div>
            )}
            <div className="kit-json">
              <pre className="mono">{c.code}</pre>
              <button type="button" className="sm" aria-label={`Copy: ${c.title}`} onClick={() => copy(c.code)}>
                <Icon name="copy" size={12} />
              </button>
            </div>
            {(c.try || (c.starter && start)) && (
              <div className="kit-edit-acts">
                {c.try && (
                  <button type="button" className="sm primary" disabled={c.try === 'background' && soon} onClick={go[c.try]}>
                    {c.try === 'background' ? (soon ? 'Running in the background…' : 'Try it: it speaks up in 2 s') : 'Try it'}
                  </button>
                )}
                {c.starter && start && (
                  <button type="button" className="sm" data-tip={`${STARTERS[c.starter].title}: ${STARTERS[c.starter].blurb}. Yours, on, its page opened`} onClick={() => start(c.starter!, STARTERS[c.starter!].title)}>
                    Make one
                  </button>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      {modal && (
        <Modal title="Deploy web?" onClose={() => setModal(false)}>
          <p className="muted small">3 commits since the last deploy</p>
          <KitBody spec={DEPLOY} data={COMMITS} cells={null} />
          <div className="row">
            <button onClick={() => setModal(false)}>Not now</button>
            <button className="primary" onClick={() => (setModal(false), say('Deploying web… (an example: nothing ran)'))}>
              Deploy
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function UiKitPage({ back, onClose, copy, icons, can, make, toast, start }: { back: string; onClose: () => void; copy: (text: string) => void; icons?: boolean; can?: boolean; make?: (name: string, ui: UiSpec, sample: unknown) => void; toast?: (text: string) => void; start?: (k: StarterKind, name: string) => void }) {
  const [view, setView] = useState<'kit' | 'can' | 'type' | 'colors' | 'icons'>(icons ? 'icons' : can ? 'can' : 'kit')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<UiGroup | ''>('')
  const [size, setSize] = useState<Record<string, string>>({})
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Esc goes back, unless the filter has something typed (it clears first) or a dialog is over it (Try's: it closes)
  useEffect(() => {
    const f = (e: KeyboardEvent) => escapes(e) && !(document.activeElement instanceof HTMLInputElement && document.activeElement.value) && !document.querySelector('.overlay .modal') && closeRef.current()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const match = (it: Item) => words.every(w => `${it.title} ${it.tag} ${it.blurb} ${JSON.stringify(it.spec)}`.toLowerCase().includes(w))
  const found = ITEMS.filter(match)
  const shown = found.filter(it => !only || it.tag === only)
  const examples = only ? [] : EXAMPLES.filter(match)
  const count = (g: string) => found.filter(it => it.tag === g).length
  const card = (it: Item) => <KitCard key={it.key} it={it} pick={size[it.key] ?? (it.full ? 'Full' : '4×2')} onPick={n => setSize(x => ({ ...x, [it.key]: n }))} copy={copy} make={make} />
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
            {(['kit', 'can', 'type', 'colors', 'icons'] as const).map(v => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {{ kit: 'Elements', can: 'What it can do', type: 'Typography', colors: 'Colors', icons: `Icons · ${NAMES.length}` }[v]}
              </button>
            ))}
          </div>
        </nav>
      }
    >
      {view === 'icons' ? <IconGallery copy={copy} /> : view === 'can' ? <CanView copy={copy} toast={toast} start={start} /> : view === 'type' ? <TypeView copy={copy} /> : view === 'colors' ? <ColorView copy={copy} /> : <div className="kit">
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
        <div className="kit-groups" role="group" aria-label="Show one group">
          {(['', ...Object.keys(UI_GROUPS)] as (UiGroup | '')[]).map(g => (
            <button key={g} type="button" aria-pressed={only === g} className={`${only === g ? 'on' : ''}${g && only !== g && !count(g) ? ' none' : ''}`} data-tip={g ? UI_GROUPS[g] : undefined} onClick={() => setOnly(only === g ? '' : g)}>
              {g || 'All'} <span className="muted">{g ? count(g) : found.length}</span>
            </button>
          ))}
        </div>
        {(Object.keys(UI_GROUPS) as UiGroup[]).map(g => (l => !!l.length && (
          <section key={g} className="kit-group">
            <h3 className="kit-h">
              {g} · {l.length} <span className="muted small">{UI_GROUPS[g]}</span>
            </h3>
            <div className="kit-grid">{l.map(card)}</div>
          </section>
        ))(shown.filter(it => it.tag === g)))}
        {!!examples.length && <h3 className="kit-h">Examples · {examples.length}</h3>}
        <div className="kit-grid">{examples.map(card)}</div>
      </div>}
    </Page>
  )
}
