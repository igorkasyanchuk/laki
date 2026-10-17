// The Laki UI kit: a widget's UI as JSON elements (widget.json's "ui"), not HTML. One table (UI) says every element,
// its props and their words; from it: uiHtml (the HTML, every value escaped, the markup fixed), uiCheck (what's wrong
// with a tree, against data too), the JSON Schema and laki.d.ts (widgetSchema.ts), the AI guide's catalog
// (widgetGuide.ts), Settings' gallery and the starters (UI_SAMPLES). The daemon renders a widget's ui for the app
// (widgetRender), the app for a JS page (laki.ui, laki.mount); uiBehave (widget.ts) makes its clicks work.
import { ICONS as ICON_WORDS, iconSvg, isIconName } from './icons.ts'
import { markdownHtml } from './markdown.ts'
import { ago, date, esc, fill, num, spark, truthy, UI_CSS, valueAt } from './widget.ts'

export { UI_CSS }

// a prop's kind: text (a template: {{field}}, helpers, #if), path (looked up raw: each, items, values), number, bool,
// children (elements), button (a button's props), icon (a name of Laki's or an emoji), tone, or one of some words
type Kind = 'text' | 'path' | 'number' | 'bool' | 'children' | 'button' | 'buttons' | 'icon' | 'tone' | 'items' | 'object' | readonly string[]
type Prop = { kind: Kind; desc: string }
type Def = { group: 'Layout' | 'Text' | 'Data' | 'Actions'; blurb: string; props: Record<string, Prop>; rows?: boolean }
const p = <K extends Kind>(kind: K, desc: string) => ({ kind, desc })

export const TONES = ['good', 'bad', 'warn', 'accent', 'muted'] as const
export type Tone = (typeof TONES)[number]
const GAP = ['sm', 'md', 'lg'] as const

// every element takes these
export const COMMON = {
  if: p('text', 'Show it only when this path or template is truthy (an empty list is false)'),
  unless: p('text', 'Show it only when this path or template is falsy'),
  each: p('path', 'Repeat it once per item of this list (or object); inside, the item’s fields, this and @index. A list, table, chart… takes its rows from it instead'),
  tip: p('text', 'A tooltip'),
  tone: p('tone', 'good, bad, warn, accent or muted, or a map from its text to one: { "failed": "bad", "live": "good" }'),
} as const

// a button: one of run (+ arg), open, refresh, full, copy
const BUTTON = {
  label: p('text', 'Its words'),
  icon: p('icon', 'An icon of Laki’s by name (refresh, check, github…) or an emoji'),
  style: p(['primary', 'quiet', 'danger'] as const, 'primary, quiet or danger; none: plain'),
  run: p('text', 'One of widget.json’s actions, run on a click'),
  arg: p('text', 'What the action gets as $WIDGET_ARG'),
  open: p('text', 'A link to open: http(s), mailto or laki://'),
  refresh: p('bool', 'Fetch again'),
  full: p('bool', 'Open the full view'),
  copy: p('text', 'Text to copy'),
  confirm: p('text', 'A question the app asks first'),
} as const
const STAT = {
  value: p('text', 'The number or word'),
  label: p('text', 'What it counts'),
  delta: p('text', 'A change, +3 or -2%: green when up, red when down (unless tone says)'),
  spark: p('path', 'A list of numbers: a line under it'),
  icon: p('icon', 'An icon or emoji before it'),
  color: p('text', 'A hex color (d73a4a): a dot by its label, a GitHub label’s'),
} as const

export const UI = {
  stack: { group: 'Layout', blurb: 'Elements one under another.', props: { children: p('children', 'Its elements'), gap: p(GAP, 'Space between them: sm, md (the default) or lg') } },
  row: { group: 'Layout', blurb: 'Elements side by side.', props: { children: p('children', 'Its elements'), gap: p(GAP, 'Space between them'), align: p(['start', 'center', 'end', 'between'] as const, 'start, center (the default), end, or between: spread across'), wrap: p('bool', 'Wrap onto more lines when they don’t fit') } },
  grid: { group: 'Layout', blurb: 'Elements in columns, fewer as the cell narrows.', props: { children: p('children', 'Its elements'), columns: p('number', 'Columns, 1-6 (2 by default): fewer in a narrow cell') } },
  section: { group: 'Layout', blurb: 'A titled group, foldable.', props: { title: p('text', 'Its heading'), subtitle: p('text', 'Words beside the heading'), children: p('children', 'Its elements'), collapsed: p('bool', 'Foldable: true starts it folded, false open') } },
  tabs: { group: 'Layout', blurb: 'Panels behind tabs.', props: { tabs: p('items', 'The tabs: [{ "label", "badge", "children" }]') } },
  divider: { group: 'Layout', blurb: 'A line across.', props: {} },
  text: { group: 'Text', blurb: 'A line of text.', props: { value: p('text', 'The words'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), weight: p(['normal', 'medium', 'semibold', 'bold'] as const, 'How bold'), mono: p('bool', 'In the monospace font'), muted: p('bool', 'Dimmer'), wrap: p('bool', 'Wrap onto more lines (default: one line, cut with …)') } },
  heading: { group: 'Text', blurb: 'A heading.', props: { value: p('text', 'The words'), level: p('number', '1, 2 (the default) or 3') } },
  markdown: { group: 'Text', blurb: 'Markdown: paragraphs, lists, code, tables, links.', props: { value: p('text', 'The Markdown') } },
  code: { group: 'Text', blurb: 'A block of code, with Copy.', props: { value: p('text', 'The code'), copy: p('bool', 'A copy button') } },
  stat: { group: 'Data', blurb: 'One number with its label, a change and a sparkline.', props: STAT },
  stats: { group: 'Data', blurb: 'A few numbers in a line.', rows: true, props: { items: p('items', 'Each one’s stat props: [{ "value", "label", "delta", "tone" }]'), ...STAT } },
  kv: { group: 'Data', blurb: 'Names and values.', rows: true, props: { items: p('items', 'Each row: [{ "key", "value", "tone", "mono", "copy" }]'), key: p('text', 'With each: a row’s name'), value: p('text', 'With each: a row’s value'), mono: p('bool', 'Values in the monospace font'), copy: p('bool', 'A copy button by each value') } },
  list: {
    group: 'Data',
    blurb: 'Rows with a title, icons, tags and buttons; grouped, filtered, cut with +N more.',
    rows: true,
    props: {
      title: p('text', 'A row’s title'),
      subtitle: p('text', 'A second line'),
      icon: p('icon', 'An icon or emoji before it'),
      avatar: p('text', 'A GitHub login: its picture before it'),
      image: p('text', 'A data: image before it'),
      accessories: p('items', 'At the row’s end: [{ "tag" | "text" | "badge" | "icon" | "avatar" | "ago" | "date", "tone", "color" (a tag’s hex border), "each" (one per item of a row’s list: its labels) }]'),
      actions: p('buttons', 'Buttons at the row’s end'),
      href: p('text', 'A link a click on the row opens'),
      limit: p('number', 'Rows at most (a preview: as many as fit), then +N more'),
      filter: p('bool', 'A filter box in the full view'),
      empty: p('text', 'What it says with no rows'),
      group: p('path', 'A field: rows under a heading per value, in the order first seen'),
    },
  },
  table: {
    group: 'Data',
    blurb: 'Columns of rows, sorted, filtered, narrow-aware.',
    rows: true,
    props: {
      columns: p('items', 'The columns: [{ "title", "value", "tag", "tone", "href", "align", "mono", "width", "wrap", "hide": "narrow" }]'),
      sort: p('text', 'A field to sort by: "age", or "age desc"'),
      limit: p('number', 'Rows at most, then +N more'),
      filter: p('bool', 'A filter box in the full view'),
      empty: p('text', 'What it says with no rows'),
    },
  },
  chart: {
    group: 'Data',
    blurb: 'A line, area or bar chart, drawn as SVG.',
    rows: true,
    props: {
      kind: p(['line', 'area', 'bars'] as const, 'line (the default), area or bars'),
      x: p('text', 'A row’s label (the tooltip’s)'),
      y: p('text', 'A row’s number'),
      series: p('items', 'Several lines: [{ "label", "y", "tone" }]'),
      height: p('number', 'Its height in px'),
      min: p('number', 'The bottom of the scale'),
      max: p('number', 'The top of the scale'),
      unit: p('text', 'After each number: ms, %, $'),
      label: p('text', 'Its title, above it with the last value'),
    },
  },
  spark: { group: 'Data', blurb: 'A small line of numbers.', props: { values: p('path', 'A list of numbers') } },
  progress: { group: 'Data', blurb: 'How far along: a bar or a ring.', props: { value: p('text', 'How much is done'), max: p('number', 'Of how much (100)'), label: p('text', 'What it is'), style: p(['bar', 'ring'] as const, 'bar (the default) or ring') } },
  tags: { group: 'Data', blurb: 'Pills: labels, states.', rows: true, props: { items: p('items', 'Each one: a word, or { "tag", "tone", "color" }'), tag: p('text', 'With each: a pill’s words'), color: p('text', 'A hex color (d73a4a): its border, a GitHub label’s') } },
  badge: { group: 'Data', blurb: 'A count or a short word, filled.', props: { value: p('text', 'The count or word') } },
  timeline: { group: 'Data', blurb: 'What happened, newest first.', rows: true, props: { time: p('text', 'When (an ISO date or ms: shown as 3 hours ago; else as written)'), title: p('text', 'What happened'), text: p('text', 'More words under it'), icon: p('icon', 'An icon or emoji') } },
  image: { group: 'Data', blurb: 'A picture: a data: image or a GitHub avatar.', props: { src: p('text', 'A data:image/… URL or https://avatars.githubusercontent.com/…'), alt: p('text', 'What it shows'), height: p('number', 'Its height in px') } },
  button: { group: 'Actions', blurb: 'Runs an action, opens a link, refreshes, copies.', props: BUTTON },
  actions: { group: 'Actions', blurb: 'A row of buttons.', props: { items: p('buttons', 'The buttons') } },
  links: { group: 'Actions', blurb: 'Links in a line, a rule between them.', rows: true, props: { items: p('items', 'Each one: { "label", "href" }'), label: p('text', 'With each: a link’s words'), href: p('text', 'With each: where it goes') } },
  form: { group: 'Actions', blurb: 'Fields and a button that runs an action with them.', props: { fields: p('items', 'Its fields: [{ "id", "type": "text" | "number" | "bool" | "choice" | "textarea", "label", "hint", "default", "choices" }]'), submit: p('button', 'Its button: { "label", "run", "confirm" }; the action gets the fields as JSON in $WIDGET_ARG') } },
  empty: { group: 'Actions', blurb: 'Nothing to show, and what to do about it.', props: { text: p('text', 'What it says'), icon: p('icon', 'An icon or emoji over it'), action: p('button', 'A button under it') } },
} satisfies Record<string, Def>

export type UiType = keyof typeof UI
export const UI_TYPES = Object.keys(UI) as UiType[]

// the TypeScript types, from the table: one per element (laki.d.ts has them with their words)
type KindType<K> = K extends readonly (infer W)[] ? W : K extends 'number' ? number | string : K extends 'bool' ? boolean : K extends 'children' ? UiElement[] : K extends 'button' ? UiButton : K extends 'buttons' ? UiButton[] : K extends 'path' ? string | unknown[] : K extends 'tone' ? Tone | string | Record<string, Tone> : K extends 'items' ? any[] : K extends 'object' ? Record<string, unknown> : string | number
type PropsOf<P> = { -readonly [K in keyof P]?: P[K] extends { kind: infer Q } ? KindType<Q> : never }
type Common = PropsOf<typeof COMMON>
export type UiButton = PropsOf<typeof BUTTON> & Common
export type UiElement = { [T in UiType]: { type: T } & Common & PropsOf<(typeof UI)[T]['props']> }[UiType]
export type UiSpec = UiElement | { preview?: UiElement; full?: UiElement }

type El = Record<string, unknown> & { type?: string }
type Scope = Record<string, unknown>
type S = { scopes: Scope[]; full: boolean; single: boolean; cells: [number, number]; line: boolean; uid: string }
const obj = (v: unknown): v is El => !!v && typeof v === 'object' && !Array.isArray(v)

// a widget's ui: one tree (the preview and the full view, which shows every row) or { preview, full }
export const isElement = (spec: unknown): spec is UiElement => obj(spec) && typeof spec.type === 'string'
export const uiTree = (spec: unknown, full: boolean): El | undefined => (isElement(spec) ? (spec as El) : obj(spec) ? ((v => (obj(v) ? v : undefined))(full ? spec.full : spec.preview)) : undefined)

// a prop as text: a template filled over the scopes (plain text: escaped where it goes)
const txt = (v: unknown, s: S): string => (typeof v === 'string' ? fill(v, s.scopes) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')
const h = (v: unknown, s: S) => esc(txt(v, s))
const n = (v: unknown, s: S) => (v === undefined || v === null || v === '' ? undefined : (x => (Number.isFinite(x) ? x : undefined))(Number(typeof v === 'string' ? txt(v, s) : v)))
const holds = (v: unknown, s: S) => (typeof v === 'string' && v.includes('{{') ? (t => !!t && t !== 'false' && t !== '0')(txt(v, s).trim()) : typeof v === 'string' ? truthy(valueAt(v, s.scopes)) : !!v)
const listAt = (v: unknown, s: S): unknown[] => (x => (Array.isArray(x) ? x : obj(x) ? Object.values(x) : []))(valueAt(v, s.scopes))
const inner = (s: S, item: unknown, i: number): S => ({ ...s, scopes: [{ ...(obj(item) ? item : {}), this: item, '@index': i }, ...s.scopes] })

// tone: a word, or a map from the element's main text to one
function toneOf(e: El, main: string, s: S) {
  const t = e.tone
  const v = obj(t) ? (Object.hasOwn(t, main) ? t[main] : Object.hasOwn(t, main.toLowerCase()) ? t[main.toLowerCase()] : undefined) : t
  const w = typeof v === 'string' ? txt(v, s).trim() : ''
  return (TONES as readonly string[]).includes(w) ? `t-${w}` : ''
}
// its class (with its tone) and tooltip
const at = (e: El, s: S, cls: string, main = '') => {
  const c = [cls, toneOf(e, main, s)].filter(Boolean).join(' ')
  const tip = e.tip !== undefined ? txt(e.tip, s) : ''
  return `${c ? ` class="${c}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}`
}
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined
const emoji = (t: string) => !!t && !/\s/.test(t) && !/^[a-z]/i.test(t) && (graphemes ? [...graphemes.segment(t)].length : t.length) <= 2
function icon(v: unknown, s: S, size = 14) {
  const t = txt(v, s).trim()
  return isIconName(t) ? iconSvg(t, size) : emoji(t) ? `<span class="k-emoji" style="font-size:${size - 1}px">${esc(t)}</span>` : ''
}
const LINK = /^(https?:|mailto:|laki:\/\/)/i
const safeUrl = (u: string) => (LINK.test(u.trim()) ? u.trim() : '')
// a link: http(s) and mailto as one (the app opens it in the browser); laki:// through data-open (a widget's HTML keeps no other href)
const link = (u: string, inner: string, cls = '') => (!safeUrl(u) ? `<span${cls ? ` class="${cls}"` : ''}>${inner}</span>` : /^laki:/i.test(u) ? `<a${cls ? ` class="${cls}"` : ''} data-open="${esc(u.trim())}">${inner}</a>` : `<a${cls ? ` class="${cls}"` : ''} href="${esc(u.trim())}" title="${esc(u.trim())}">${inner}</a>`)
const avatarUrl = (login: string) => (/^[A-Za-z0-9-]{1,39}$/.test(login.trim()) ? `https://avatars.githubusercontent.com/${login.trim()}?s=40` : '')
const imageOk = (u: string) => /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(u) || /^https:\/\/avatars\.githubusercontent\.com\/[\w\-./?=&%]+$/.test(u)
const hex = (v: string) => (/^#?[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().replace(/^#/, '') : '')
const err = (e: unknown) => `<span class="k-chip-err" title="${esc((e as Error)?.message ?? e)}">⚠ ${esc(String((e as Error)?.message ?? e).slice(0, 80))}</span>`
const copyBtn = (text: string) => `<button type="button" class="k-copy quiet" data-copy="${esc(text)}" title="Copy">${iconSvg('copy', 11)}</button>`
const timeOf = (t: string) => (/^\d{10,13}$/.test(t) ? Number(t.length === 10 ? Number(t) * 1000 : t) : /^\d{4}-\d{2}-\d{2}/.test(t) ? t : undefined)

// if / unless: an element's, a button's, an accessory's, an item's
const hidden = (x: El, s: S) => (x.if !== undefined && !holds(x.if, s)) || (x.unless !== undefined && holds(x.unless, s))

function node(el: unknown, s: S): string {
  if (!obj(el)) return ''
  try {
    if (hidden(el, s)) return ''
    const def = (UI as Record<string, Def>)[String(el.type)]
    if (!def) return err(`no element ${el.type}`)
    if (el.each !== undefined && !def.rows) return listAt(el.each, s).map((item, i) => one(el, inner(s, item, i))).join('')
    return one(el, s)
  } catch (e) {
    return err(e)
  }
}
function one(e: El, s: S) {
  try {
    return R[e.type as UiType](e, s)
  } catch (x) {
    return err(x) // a bad template in one element: its chip, the rest still draws
  }
}
const kids = (v: unknown, s: S) => (Array.isArray(v) ? v.map(x => node(x, s)).join('') : '')
const gap = (v: unknown) => ` g-${GAP.includes(v as 'sm') ? v : 'md'}`

// how many rows: a bar's line one, a preview as many as fit its cells (rowH px each), a full view of one tree all
function cap(e: El, s: S, rowH: number) {
  if (s.line) return 1
  const l = n(e.limit, s)
  if (s.full) return s.single || l === undefined ? Infinity : Math.max(1, l)
  return Math.max(1, l ?? Math.floor((s.cells[1] * 64 - 10) / rowH))
}
const more = (left: number) => (left > 0 ? `<button type="button" class="k-more" data-more>+${left} more</button>` : '')
const filterBox = (e: El, s: S) => (s.full && e.filter === true ? '<input class="k-filter" type="search" data-filter placeholder="Filter…" aria-label="Filter">' : '')
const empty = (e: El, s: S, rows: number) => (rows ? '' : `<div class="k-empty small">${h(e.empty ?? 'Nothing here', s)}</div>`)

function button(b: unknown, s: S, small = false): string {
  if (!obj(b) || hidden(b, s)) return ''
  const label = txt(b.label, s)
  const style = ['primary', 'quiet', 'danger'].includes(String(b.style)) ? ` ${b.style}` : ''
  let act = ''
  if (b.run !== undefined) act = ` data-run="${h(b.run, s)}"${b.arg !== undefined ? ` data-arg="${h(b.arg, s)}"` : ''}`
  else if (b.open !== undefined) act = (u => (u ? ` data-open="${esc(u)}"` : ' disabled'))(safeUrl(txt(b.open, s)))
  else if (b.refresh === true) act = ' data-laki="refresh"'
  else if (b.full === true) act = ' data-laki="full"'
  else if (b.copy !== undefined) act = ` data-copy="${h(b.copy, s)}"`
  const confirm = b.confirm !== undefined ? ` data-confirm="${h(b.confirm, s)}"` : ''
  return `<button type="button"${at(b, s, `k-btn${style}${small ? ' sm' : ''}`, label)}${act}${confirm}>${b.icon !== undefined ? icon(b.icon, s, 12) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`
}

function stat(e: El, s: S) {
  const value = txt(e.value, s)
  const d = txt(e.delta, s).trim()
  const dt = e.tone === undefined && d ? (/^[-−]/.test(d) ? 't-bad' : /^\+/.test(d) ? 't-good' : 't-muted') : toneOf(e, d, s)
  const c = e.color !== undefined ? hex(txt(e.color, s)) : ''
  const label = txt(e.label, s)
  const sp = e.spark !== undefined ? spark(valueAt(e.spark, s.scopes)) : ''
  return `<div${at(e, s, 'k-stat', value)}>${e.icon !== undefined ? icon(e.icon, s, 16) : ''}<div class="k-v">${esc(value)}${d ? `<span class="k-delta ${dt}">${esc(d)}</span>` : ''}</div>${label || c ? `<div class="k-l">${c ? `<i class="k-dotc" style="background:#${c}"></i>` : ''}${esc(label)}</div>` : ''}${sp ? `<div class="k-spark">${sp}</div>` : ''}</div>`
}

function accessory(a: unknown, s: S): string {
  if (!obj(a)) return ''
  if (a.each !== undefined) return listAt(a.each, s).map((x, i) => accessory({ ...a, each: undefined }, inner(s, x, i))).join('') // one per item: a PR's labels
  if (hidden(a, s)) return ''
  const key = ['tag', 'badge', 'text', 'icon', 'avatar', 'ago', 'date'].find(k => a[k] !== undefined)
  if (!key) return ''
  const v = txt(a[key], s)
  const tone = toneOf(a, v, s)
  const c = a.color !== undefined ? hex(txt(a.color, s)) : ''
  if (key === 'tag') return v ? `<span class="k-tag ${tone}"${c ? ` style="border-color:#${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'badge') return v ? `<span class="k-badge ${tone}">${esc(v)}</span>` : ''
  if (key === 'icon') return `<span class="${tone}">${icon(a.icon, s, 13)}</span>`
  if (key === 'avatar') return (u => (u ? `<img class="k-av" src="${u}" alt="${esc(v)}" title="${esc(v)}">` : ''))(avatarUrl(v))
  const t = key === 'ago' || key === 'date' ? timeOf(v.trim()) : undefined
  const words = key === 'ago' ? (t === undefined ? v : ago(t)) : key === 'date' ? (t === undefined ? v : date(t)) : v
  return words ? `<span class="${tone}"${t !== undefined ? ` title="${esc(new Date(t).toLocaleString())}"` : ''}>${esc(words)}</span>` : ''
}

// each row of a list
function row(e: El, s: S, extra: boolean) {
  const title = txt(e.title, s)
  const sub = txt(e.subtitle, s)
  const href = e.href !== undefined ? safeUrl(txt(e.href, s)) : ''
  const lead = e.avatar !== undefined ? (u => (u ? `<img class="k-av" src="${u}" alt="">` : ''))(avatarUrl(txt(e.avatar, s))) : e.image !== undefined ? (u => (imageOk(u) ? `<img class="k-av" src="${esc(u)}" alt="">` : ''))(txt(e.image, s).trim()) : e.icon !== undefined ? icon(e.icon, s) : ''
  const acc = Array.isArray(e.accessories) ? e.accessories.map(a => accessory(a, s)).join('') : ''
  const acts = Array.isArray(e.actions) ? e.actions.map(b => button(b, s, true)).join('') : ''
  const tip = e.tip !== undefined ? txt(e.tip, s) : ''
  return `<div class="k-li" data-row${extra ? ' data-extra hidden' : ''}${href ? ` data-open="${esc(href)}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}>${lead}<div class="k-main"><div class="k-title ${toneOf(e, title, s)}">${esc(title)}</div>${sub ? `<div class="k-sub">${esc(sub)}</div>` : ''}</div>${acc ? `<div class="k-acc">${acc}</div>` : ''}${acts ? `<div class="k-acts">${acts}</div>` : ''}</div>`
}

function list(e: El, s: S) {
  const items = listAt(e.each ?? e.items, s)
  const max = cap(e, s, e.subtitle !== undefined ? 36 : 26)
  let shown = 0
  const rows = (idx: number[]) =>
    idx
      .map(i => {
        const k = shown++
        if (k >= max && !s.full) return ''
        return row(e, inner(s, items[i], i), k >= max)
      })
      .join('')
  let body: string
  if (e.group !== undefined) {
    const groups = new Map<string, number[]>()
    items.forEach((item, i) => (g => groups.set(g, [...(groups.get(g) ?? []), i]))(String(valueAt(e.group, inner(s, item, i).scopes) ?? '')))
    body = [...groups]
      .map(([g, idx]) => {
        const start = shown
        const r = rows(idx)
        return start >= max && !s.full ? '' : `<div class="k-group" data-group><div class="k-gh">${esc(g)}<span class="k-sub">${idx.length}</span></div>${r}</div>`
      })
      .join('')
  } else body = rows(items.map((_, i) => i))
  return `<div${at({ tip: e.tip }, s, 'k-list')} data-rows>${filterBox(e, s)}${body}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
}

const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true }))
function table(e: El, s: S) {
  const cols = (Array.isArray(e.columns) ? e.columns : []).filter(obj)
  const items = listAt(e.each ?? e.items, s).map((item, i) => ({ item, i }))
  const [field, dir] = String(e.sort ?? '').trim().split(/\s+/)
  if (field) items.sort((a, b) => cmp(valueAt(field, inner(s, a.item, a.i).scopes), valueAt(field, inner(s, b.item, b.i).scopes)) * (dir === 'desc' ? -1 : 1))
  const max = cap(e, s, 28)
  const cls = (c: El) => [c.align === 'right' || c.align === 'center' ? `al-${c.align}` : '', c.mono === true ? 'mono' : '', c.wrap === true ? 'wrap' : '', c.hide === 'narrow' ? 'hide-narrow' : ''].filter(Boolean).join(' ')
  const width = (c: El) => (w => (w ? ` style="width:${/^\d+$/.test(w) ? `${w}px` : w}"` : ''))(/^\d{1,4}(px|%)?$/.test(String(c.width ?? '')) ? String(c.width) : '')
  const head = `<thead><tr>${cols.map(c => `<th class="${cls(c)}"${width(c)}>${h(c.title, s)}</th>`).join('')}</tr></thead>`
  const cell = (c: El, r: S) => {
    const v = txt(c.value, r)
    const tag = c.tag !== undefined ? txt(c.tag, r) : ''
    const tone = toneOf(c, v || tag, r)
    const inside = `${tag ? `<span class="k-tag ${tone}">${esc(tag)}</span>` : ''}${v ? (tag ? ` ${esc(v)}` : `<span class="${tone}">${esc(v)}</span>`) : ''}`
    const href = c.href !== undefined ? txt(c.href, r) : ''
    return `<td class="${cls(c)}">${href ? link(href, inside, 'link') : inside}</td>`
  }
  const body = items
    .map(({ item, i }, k) => (k >= max && !s.full ? '' : (r => `<tr data-row${k >= max ? ' data-extra hidden' : ''}>${cols.map(c => cell(c, r)).join('')}</tr>`)(inner(s, item, i))))
    .join('')
  return `<div${at({ tip: e.tip }, s, 'k-table')} data-rows>${filterBox(e, s)}<table>${head}<tbody>${body}</tbody></table>${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
}

// a chart: the plot in a 100×40 box stretched to its size (lines keep their width), its labels and dot in HTML
const H = 40
export function chartPoints(ys: number[], lo: number, hi: number) {
  const span = hi - lo || 1
  return ys.map((v, i) => [ys.length === 1 ? 50 : (i / (ys.length - 1)) * 100, 2 + (1 - (v - lo) / span) * (H - 4)] as [number, number])
}
const PALETTE = ['t-accent', 't-good', 't-warn', 't-bad', 't-muted']
function chart(e: El, s: S) {
  const items = listAt(e.each ?? e.items, s)
  const rs = items.map((item, i) => inner(s, item, i))
  const series = (Array.isArray(e.series) && e.series.length ? e.series.filter(obj) : [{ y: e.y }]) as El[]
  const ys = series.map(se => rs.map(r => (v => (v.trim() === '' ? NaN : Number(v)))(txt(se.y, r))))
  const all = ys.flat().filter(Number.isFinite)
  if (!all.length) return '' // nothing to draw
  const kind = ['area', 'bars'].includes(String(e.kind)) ? String(e.kind) : 'line'
  let lo = n(e.min, s) ?? Math.min(...all)
  const hi = n(e.max, s) ?? Math.max(...all)
  if (kind === 'bars' && e.min === undefined) lo = Math.min(0, lo)
  const unit = txt(e.unit, s)
  const fmt = (v: number) => `${num(v)}${unit}`
  const xs = rs.map(r => txt(e.x, r))
  const height = s.line ? 18 : (n(e.height, s) ?? (s.full ? 160 : Math.max(24, s.cells[1] * 64 - 34)))
  const f = (x: number) => x.toFixed(1)
  let plot = `<line class="grid" x1="0" x2="100" y1="2" y2="2" vector-effect="non-scaling-stroke"/><line class="grid" x1="0" x2="100" y1="${H / 2}" y2="${H / 2}" vector-effect="non-scaling-stroke"/><line class="grid" x1="0" x2="100" y1="${H - 2}" y2="${H - 2}" vector-effect="non-scaling-stroke"/>`
  let dot = ''
  series.forEach((se, k) => {
    const tone = toneOf(se, '', s) || PALETTE[k % PALETTE.length]
    const vals = ys[k]
    if (kind === 'bars') {
      const slot = 100 / vals.length
      const base = 2 + (1 - (Math.max(lo, Math.min(0, hi)) - lo) / (hi - lo || 1)) * (H - 4)
      vals.forEach((v, i) => {
        if (!Number.isFinite(v)) return
        const y = chartPoints([v], lo, hi)[0][1]
        const w = slot / series.length
        plot += `<rect class="${toneOf(e, String(v), rs[i]) || tone}" x="${f(i * slot + k * w + w * 0.15)}" y="${f(Math.min(y, base))}" width="${f(w * 0.7)}" height="${f(Math.max(0.5, Math.abs(base - y)))}" fill="currentColor"/>`
      })
    } else {
      const pts = chartPoints(vals.map(v => (Number.isFinite(v) ? v : lo)), lo, hi).filter((_, i) => Number.isFinite(vals[i]))
      const line = pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')
      if (kind === 'area' && pts.length) plot += `<polygon class="${tone}" points="${f(pts[0][0])},${H} ${line} ${f(pts.at(-1)![0])},${H}" fill="currentColor" fill-opacity="0.15"/>`
      plot += `<polyline class="${tone}" points="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`
      const last = pts.at(-1)
      if (last && k === 0) dot = `<i class="k-ch-dot ${tone}" style="left:${f(last[0])}%;top:${f((last[1] / H) * 100)}%"></i>`
    }
  })
  // each point's tooltip: a slot across the plot
  const slot = 100 / Math.max(1, rs.length)
  plot += rs.map((_, i) => `<rect x="${f(i * slot)}" y="0" width="${f(slot)}" height="${H}" fill="transparent"><title>${esc(xs[i] ? `${xs[i]}: ` : '')}${esc(series.map((se, k) => `${series.length > 1 ? `${txt(se.label, s)} ` : ''}${Number.isFinite(ys[k][i]) ? fmt(ys[k][i]) : '–'}`).join(', '))}</title></rect>`).join('')
  const lastV = ys[0].filter(Number.isFinite).at(-1)
  const label = txt(e.label, s)
  const head = s.line ? '' : `<div class="k-ch-head"><span>${esc(label)}</span>${lastV !== undefined ? `<b>${esc(fmt(lastV))}</b>` : ''}</div>`
  const legend = series.length > 1 && !s.line ? `<div class="k-legend">${series.map((se, k) => `<span class="${toneOf(se, '', s) || PALETTE[k % PALETTE.length]}"><i></i>${h(se.label, s)}</span>`).join('')}</div>` : ''
  return `<div${at({ tip: e.tip }, s, 'k-chart')}>${head}<div class="k-ch-body" style="height:${height}px">${s.line ? '' : `<div class="k-ch-axis"><span>${esc(fmt(hi))}</span><span>${esc(fmt(lo))}</span></div>`}<div class="k-ch-plot"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label || 'chart')}">${plot}</svg>${dot}</div></div>${legend}</div>`
}

// the items of a stats, kv, tags or links: written ones (their props templates), or each row with the element's own
const itemsOf = (e: El, s: S): [El, S][] => (Array.isArray(e.items) ? e.items.filter(x => !obj(x) || !hidden(x, s)).map(x => [obj(x) ? x : { tag: x, value: x, label: x }, s] as [El, S]) : listAt(e.each, s).map((item, i) => [e, inner(s, item, i)] as [El, S]))

const R: Record<UiType, (e: El, s: S) => string> = {
  stack: (e, s) => `<div${at(e, s, `k-stack${gap(e.gap)}`)}>${kids(e.children, s)}</div>`,
  row: (e, s) => `<div${at(e, s, `k-row${gap(e.gap)} a-${['start', 'center', 'end', 'between'].includes(String(e.align)) ? e.align : 'center'}${e.wrap === true ? ' wrap' : ''}`)}>${kids(e.children, s)}</div>`,
  grid: (e, s) => (c => `<div${at(e, s, `k-grid c-${c}`)} style="--cols:${c}">${kids(e.children, s)}</div>`)(Math.min(6, Math.max(1, Math.round(n(e.columns, s) ?? 2)))),
  section: (e, s) => {
    const head = `${h(e.title, s)}${e.subtitle !== undefined ? `<span class="k-sub">${h(e.subtitle, s)}</span>` : ''}`
    return typeof e.collapsed === 'boolean'
      ? `<details${at(e, s, 'k-section')}${e.collapsed ? '' : ' open'}><summary class="k-sh">${head}</summary>${kids(e.children, s)}</details>`
      : `<section${at(e, s, 'k-section')}>${e.title !== undefined ? `<div class="k-sh">${head}</div>` : ''}${kids(e.children, s)}</section>`
  },
  tabs: (e, s) => {
    const tabs = (Array.isArray(e.tabs) ? e.tabs : []).filter(obj).slice(0, 8)
    const name = `kt-${s.uid}-${(s.uid = (Number.parseInt(s.uid, 36) + 1).toString(36))}`
    return `<div${at(e, s, 'k-tabs')}><div class="k-tabbar" role="tablist">${tabs.map((t, i) => `<label><input type="radio" name="${name}"${i ? '' : ' checked'}><span>${h(t.label, s)}</span>${(b => (b ? `<span class="k-badge">${esc(b)}</span>` : ''))(txt(t.badge, s))}</label>`).join('')}</div>${tabs.map(t => `<section class="k-panel">${kids(t.children, s)}</section>`).join('')}</div>`
  },
  divider: (e, s) => `<hr${at(e, s, 'k-hr')}>`,
  text: (e, s) => (v => `<div${at(e, s, ['k-text', ['sm', 'lg', 'xl'].includes(String(e.size)) ? `s-${e.size}` : '', ['medium', 'semibold', 'bold'].includes(String(e.weight)) ? `w-${e.weight}` : '', e.mono === true ? 'mono' : '', e.muted === true ? 't-muted' : '', e.wrap === true ? 'wrap' : ''].filter(Boolean).join(' '), v)}>${esc(v)}</div>`)(txt(e.value, s)),
  heading: (e, s) => (l => (v => `<h${l}${at(e, s, 'k-h', v)}>${esc(v)}</h${l}>`)(txt(e.value, s)))(Math.min(3, Math.max(1, Math.round(n(e.level, s) ?? 2)))),
  markdown: (e, s) => `<div${at(e, s, 'k-md')}>${markdownHtml(txt(e.value, s))}</div>`,
  code: (e, s) => (v => `<div${at(e, s, 'k-code')}><pre><code>${esc(v)}</code></pre>${e.copy === true ? copyBtn(v) : ''}</div>`)(txt(e.value, s)),
  stat,
  stats: (e, s) => `<div${at({ tip: e.each === undefined ? e.tip : undefined }, s, 'k-stats')}>${itemsOf(e, s).map(([x, r]) => stat(x === e ? e : { ...x, tone: x.tone ?? e.tone }, r)).join('')}</div>`,
  kv: (e, s) =>
    `<dl${at({ tip: e.tip }, s, 'k-kv')}>${itemsOf(e, s)
      .map(([x, r]) => {
        const v = txt(x.value, r)
        return `<div data-row><dt>${h(x.key, r)}</dt><dd class="${[x.mono === true || e.mono === true ? 'mono' : '', toneOf(x === e ? e : { tone: x.tone ?? e.tone }, v, r)].filter(Boolean).join(' ')}"><span>${esc(v)}</span>${(x.copy ?? e.copy) === true && v ? copyBtn(v) : ''}</dd></div>`
      })
      .join('')}</dl>`,
  list,
  table,
  chart,
  spark: (e, s) => `<div${at(e, s, 'k-spark')}>${spark(valueAt(e.values, s.scopes))}</div>`,
  progress: (e, s) => {
    const max = n(e.max, s) ?? 100
    const pct = Math.round(Math.min(100, Math.max(0, ((n(e.value, s) ?? 0) / (max || 1)) * 100)))
    const label = txt(e.label, s)
    if (e.style === 'ring')
      return `<div${at(e, s, 'k-prog ring', String(pct))}><svg width="32" height="32" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4"/><circle class="fg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg><div class="k-prog-h"><b>${pct}%</b><span>${esc(label)}</span></div></div>`
    return `<div${at(e, s, 'k-prog', String(pct))}><div class="k-prog-h"><span>${esc(label)}</span><b>${pct}%</b></div><div class="k-bar"><i style="width:${pct}%"></i></div></div>`
  },
  tags: (e, s) =>
    `<div${at({ tip: e.tip }, s, 'k-tags')}>${itemsOf(e, s)
      .map(([x, r]) => {
        const t = txt(x.tag, r)
        const c = x.color !== undefined ? hex(txt(x.color, r)) : ''
        return t ? `<span class="k-tag ${toneOf(x === e ? e : { tone: x.tone ?? e.tone }, t, r)}"${c ? ` style="border-color:#${c}"` : ''}>${c ? `<i class="k-dotc" style="background:#${c}"></i>` : ''}${esc(t)}</span>` : ''
      })
      .join('')}</div>`,
  badge: (e, s) => (v => (v ? `<span${at(e, s, 'k-badge', v)}>${esc(v)}</span>` : ''))(txt(e.value, s)),
  timeline: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const max = cap(e, s, 34)
    return `<ol${at({ tip: e.tip }, s, 'k-tl')} data-rows>${items
      .map((item, i) => {
        if (i >= max && !s.full) return ''
        const r = inner(s, item, i)
        const tm = txt(e.time, r).trim()
        const t = timeOf(tm)
        const title = txt(e.title, r)
        const text = txt(e.text, r)
        return `<li data-row${i >= max ? ' data-extra hidden' : ''}><i class="k-tl-dot ${toneOf(e, title, r)}"></i>${e.icon !== undefined ? icon(e.icon, r, 13) : ''}<div class="k-main"><div class="k-tl-h"><b>${esc(title)}</b>${tm ? `<span class="k-time"${t !== undefined ? ` title="${esc(new Date(t).toLocaleString())}"` : ''}>${esc(t !== undefined ? ago(t) : tm)}</span>` : ''}</div>${text ? `<div class="k-sub">${esc(text)}</div>` : ''}</div></li>`
      })
      .join('')}</ol>${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}`
  },
  image: (e, s) => (u => (imageOk(u) ? `<img${at(e, s, 'k-img')} src="${esc(u)}" alt="${h(e.alt, s)}"${(x => (x ? ` style="height:${Math.min(2000, x)}px"` : ''))(n(e.height, s))}>` : ''))(txt(e.src, s).trim()),
  button: (e, s) => button(e, s),
  actions: (e, s) => `<div${at(e, s, 'k-actions')}>${(Array.isArray(e.items) ? e.items : []).map(b => button(b, s)).join('')}</div>`,
  links: (e, s) => `<div${at(e, s, 'linkbar k-links')}>${itemsOf(e, s).map(([x, r]) => link(txt(x.href, r), h(x.label ?? x.href, r))).join('')}</div>`,
  form: (e, s) => {
    const fields = (Array.isArray(e.fields) ? e.fields : []).filter(obj).filter(f => /^[A-Za-z_][\w-]{0,40}$/.test(String(f.id)))
    const field = (f: El) => {
      const id = esc(f.id)
      const label = h(f.label ?? f.id, s)
      const hint = f.hint !== undefined ? h(f.hint, s) : ''
      const def = txt(f.default, s)
      if (f.type === 'bool') return `<label class="k-check"><input type="checkbox" name="${id}"${def && def !== 'false' ? ' checked' : ''}><span>${label}</span></label>`
      const input =
        f.type === 'choice'
          ? `<select name="${id}">${(Array.isArray(f.choices) ? f.choices : []).map(c => (v => `<option${v === def ? ' selected' : ''}>${esc(v)}</option>`)(txt(c, s))).join('')}</select>`
          : f.type === 'textarea'
            ? `<textarea name="${id}" rows="3" placeholder="${hint}">${esc(def)}</textarea>`
            : `<input type="${f.type === 'number' ? 'number' : 'text'}" name="${id}" value="${esc(def)}" placeholder="${hint}">`
      return `<label class="k-field"><span>${label}</span>${input}</label>`
    }
    const sub = obj(e.submit) ? e.submit : {}
    return `<div${at(e, s, 'k-form')} data-form>${fields.map(field).join('')}<div class="k-form-foot"><button type="button" class="k-btn primary" data-run="${h(sub.run, s)}" data-submit${sub.confirm !== undefined ? ` data-confirm="${h(sub.confirm, s)}"` : ''}>${h(sub.label ?? 'Submit', s)}</button></div></div>`
  },
  empty: (e, s) => `<div${at(e, s, 'k-empty')}>${e.icon !== undefined ? icon(e.icon, s, 18) : ''}<div>${h(e.text ?? 'Nothing here', s)}</div>${e.action !== undefined ? button(e.action, s, true) : ''}</div>`,
}

// a widget's ui as HTML for its preview or full view, over its context ({ data, config, at, error, full, sample,
// workspace }, the same names as a template's: {{open}} as {{data.open}}); cells: where it shows (across, down; ½ down: a
// bar's line). A failed fetch with no data: the error and Retry, instead of the tree
export function uiHtml(spec: unknown, ctx: Record<string, unknown>, o: { full?: boolean; cells?: [number, number] } = {}) {
  const tree = uiTree(spec, !!o.full)
  if (!tree) return ''
  const data = ctx.data
  const top = { ...(obj(data) ? data : {}), ...ctx, full: !!o.full }
  const cells: [number, number] = o.cells && o.cells.length === 2 ? [Number(o.cells[0]) || 1, Number(o.cells[1]) || 1] : o.full ? [3, 4] : [1, 1]
  const line = !o.full && cells[1] <= 0.5
  const s: S = { scopes: [top], full: !!o.full, single: isElement(spec), cells, line, uid: Math.random().toString(36).slice(2, 7) }
  const failed = !!ctx.error && (data === undefined || data === null)
  const body = failed ? `<div class="k-error"><b>${line ? '⚠' : 'Couldn’t fetch it'}</b><div class="k-sub">${esc(ctx.error)}</div><button type="button" class="k-btn sm" data-laki="refresh">Retry</button></div>` : node(tree, s)
  return `<div class="k" data-kit="${o.full ? 'full' : 'preview'}"${line ? ' data-line' : ''}>${body}</div>`
}

// ---------- what's wrong with a ui, for laki widget check, the inspector and agents: unknown elements and props,
// props of the wrong kind, actions and icons that aren't there; with data (a fixture, the last fetch), each's lists
// and the fields its rows use
export type UiProblem = { level: 'error' | 'warn'; where: string; text: string }

// the nearest of some words, for "did you mean": within a third of its length (2 at least) of edits
export function near(word: string, words: readonly string[]) {
  const d = (a: string, b: string) => {
    const row = [...Array(b.length + 1).keys()]
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) [prev, row[j]] = [row[j], Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))]
    }
    return row[b.length]
  }
  const best = words.map(w => [w, d(word.toLowerCase(), w.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0]
  return best && best[1] <= Math.max(2, Math.floor(word.length / 3)) ? best[0] : undefined
}
const mean = (w: string, ws: readonly string[]) => (m => (m ? ` (did you mean ${m}?)` : ''))(near(w, ws))
const NAMES = new Set(['data', 'config', 'at', 'error', 'full', 'sample', 'workspace', 'this', '@index', 'else'])

export function uiCheck(spec: unknown, data?: unknown, o: { actions?: string[] } = {}): UiProblem[] {
  const out: UiProblem[] = []
  const say = (level: UiProblem['level'], where: string, text: string) => out.push({ level, where, text })
  const has = data !== undefined
  const top = { ...(obj(data) ? data : {}), data, config: {}, at: 0, error: undefined, full: false, sample: false, workspace: {} }
  const kindOk = (k: Kind, v: unknown) =>
    Array.isArray(k)
      ? typeof v === 'string' && (k.includes(v) || v.includes('{{'))
      : k === 'text' || k === 'icon'
        ? ['string', 'number', 'boolean'].includes(typeof v)
        : k === 'number'
          ? typeof v === 'number' || (typeof v === 'string' && (v.includes('{{') || Number.isFinite(Number(v))))
          : k === 'bool'
            ? typeof v === 'boolean'
            : k === 'path'
              ? typeof v === 'string' || Array.isArray(v)
              : k === 'children' || k === 'buttons' || k === 'items'
                ? Array.isArray(v)
                : k === 'button' || k === 'object'
                  ? obj(v)
                  : k === 'tone'
                    ? typeof v === 'string' || obj(v)
                    : true
  const kindName = (k: Kind) => (Array.isArray(k) ? `one of ${k.join(', ')}` : { text: 'text', icon: 'an icon name or emoji', number: 'a number', bool: 'true or false', path: 'a path (data.items) or a list', children: 'a list of elements', buttons: 'a list of buttons', items: 'a list', button: 'a button ({ "label", "run" })', object: 'an object', tone: 'a tone or a map of them' }[k as string])
  // the names a template uses: {{name}}, {{#if name}}, {{ago name}}
  const refs = (v: unknown, acc: string[] = []): string[] => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{\s*(?:[#/]?\w+\s+)?([A-Za-z_@][\w@]*)[\w.]*\s*\}\}/g)) acc.push(m[1])
    else if (Array.isArray(v)) v.forEach(x => refs(x, acc))
    else if (obj(v) && v.each === undefined) Object.values(v).forEach(x => refs(x, acc)) // one with each of its own: its items' fields
    return acc
  }
  const iconOk = (v: unknown) => typeof v !== 'string' || v.includes('{{') || isIconName(v.trim()) || emoji(v.trim())
  const runs = (b: unknown, where: string) => {
    if (obj(b) && typeof b.run === 'string' && !b.run.includes('{{') && o.actions && !o.actions.includes(b.run)) say('error', where, `runs ${b.run}, which isn't one of widget.json's actions${mean(b.run, o.actions)}`)
    if (obj(b) && b.icon !== undefined && !iconOk(b.icon)) say('warn', where, `icon ${b.icon} isn't one of Laki's icons${mean(String(b.icon), Object.keys(ICON_WORDS))} or an emoji`)
  }
  const walk = (el: unknown, where: string, scopes: Scope[] | null) => {
    if (!obj(el)) return say('error', where, 'an element: { "type": … }')
    const type = String(el.type ?? '')
    const def = (UI as Record<string, Def>)[type]
    if (!def) return say('error', where, el.type === undefined ? 'no type' : `no element ${type}${mean(type, UI_TYPES)}`)
    const here = `${where} (${type})`
    const props: Record<string, Prop> = { ...COMMON, ...def.props }
    for (const [k, v] of Object.entries(el)) {
      if (k === 'type') continue
      const pr = props[k]
      if (!pr) {
        say('warn', here, `no prop ${k}${mean(k, Object.keys(props))}`)
        continue
      }
      if (!kindOk(pr.kind, v)) say('error', here, `${k}: ${kindName(pr.kind)}`)
      else if (pr.kind === 'icon' && !iconOk(v)) say('warn', here, `icon ${v} isn't one of Laki's icons${mean(String(v), Object.keys(ICON_WORDS))} or an emoji`)
    }
    if (type === 'button') runs(el, here)
    if (type === 'form') runs(el.submit, `${here}.submit`)
    if (type === 'empty' && el.action !== undefined) runs(el.action, `${here}.action`)
    for (const k of ['actions', 'items'] as const) if ((type === 'list' && k === 'actions') || (type === 'actions' && k === 'items')) (Array.isArray(el[k]) ? (el[k] as unknown[]) : []).forEach((b, i) => runs(b, `${here}.${k}[${i}]`))
    // against the data: each's list, then the fields the rows use
    let rowScopes = scopes
    const path = el.each ?? (def.rows && typeof el.items === 'string' ? el.items : undefined)
    if (scopes && typeof path === 'string' && !path.includes('{{')) {
      const v = valueAt(path, scopes)
      if (v === undefined) say('warn', here, `each: ${path} isn't in the data`)
      else if (!Array.isArray(v) && !obj(v)) say('error', here, `each: ${path} is ${typeof v}, not a list`)
      else {
        const items = Array.isArray(v) ? v : Object.values(v)
        rowScopes = items.length ? [{ ...(obj(items[0]) ? items[0] : {}), this: items[0], '@index': 0 }, ...scopes] : null
        if (items.length && def.rows) {
          const fields = new Set(items.flatMap(x => (obj(x) ? Object.keys(x) : [])))
          const outer = new Set(scopes.flatMap(sc => Object.keys(sc)))
          const skip = new Set(['each', 'items', 'empty', 'limit', 'filter', 'sort', 'kind', 'height', 'min', 'max', 'label', 'unit', 'if', 'unless', 'tip', 'series'])
          for (const [k, val] of Object.entries(el)) {
            if (skip.has(k)) continue
            for (const r of refs(k === 'columns' && Array.isArray(val) ? val.map(c => (obj(c) ? { ...c, title: undefined } : c)) : val)) if (!NAMES.has(r) && !fields.has(r) && !outer.has(r)) say('warn', here, `${k} uses ${r}, which no item of ${path} has${mean(r, [...fields])}`)
          }
          if (type === 'chart')
            for (const y of [el.y, ...(Array.isArray(el.series) ? el.series.map(x => (obj(x) ? x.y : undefined)) : [])])
              if (typeof y === 'string') {
                const bad = items.map((x, i) => fill(y, [{ ...(obj(x) ? x : {}), this: x, '@index': i }, ...scopes])).filter(t => t.trim() === '' || !Number.isFinite(Number(t)))
                if (bad.length) say('warn', here, `y ${y}: ${bad.length} of ${items.length} rows aren't numbers (${bad[0] || 'empty'})`)
              }
        }
      }
    }
    if (Array.isArray(el.children)) el.children.forEach((c, i) => walk(c, `${here}.children[${i}]`, def.rows ? scopes : rowScopes))
    if (type === 'tabs' && Array.isArray(el.tabs)) el.tabs.forEach((t, i) => (obj(t) && Array.isArray(t.children) ? t.children.forEach((c, j) => walk(c, `${here}.tabs[${i}].children[${j}]`, scopes)) : say('error', `${here}.tabs[${i}]`, 'a tab: { "label", "children": [elements] }')))
  }
  if (isElement(spec)) walk(spec, 'ui', has ? [top] : null)
  else if (obj(spec)) {
    for (const k of Object.keys(spec)) if (k !== 'preview' && k !== 'full') say('error', 'ui', `no key ${k}: ui is an element ({ "type": … }) or { "preview", "full" }${mean(k, ['preview', 'full', 'type'])}`)
    for (const k of ['preview', 'full'] as const) if (spec[k] !== undefined) walk(spec[k], `ui.${k}`, has ? [top] : null)
    if (spec.preview === undefined && spec.full === undefined) say('error', 'ui', 'no preview nor full')
  } else say('error', 'ui', 'an element ({ "type": … }) or { "preview", "full" }')
  return out
}
// ---------- one sample per element, with data: the gallery, the tests, the AI guide's catalog and the starters
const PRS = [
  { number: 412, title: 'Move billing to the new API', url: 'https://github.com/acme/web/pull/412', author: 'octocat', ci: 'failing', state: 'Failing CI', updated: '2026-10-16T09:00:00Z', labels: ['bug'] },
  { number: 418, title: 'Faster search on the orders page', url: 'https://github.com/acme/web/pull/418', author: 'hubot', ci: 'passing', state: 'Approved', updated: '2026-10-15T14:00:00Z', labels: ['feature'] },
  { number: 421, title: 'Dark mode for the dashboard', url: 'https://github.com/acme/web/pull/421', author: 'monalisa', ci: 'pending', state: 'In review', updated: '2026-10-17T08:30:00Z', labels: [] },
]
const SAMPLES: Record<UiType, { spec: UiElement; data?: unknown }> = {
  stack: { spec: { type: 'stack', gap: 'sm', children: [{ type: 'text', value: '{{repo}}', weight: 'semibold' }, { type: 'text', value: '{{open}} open · {{drafts}} drafts', muted: true }] }, data: { repo: 'acme/web', open: 6, drafts: 1 } },
  row: { spec: { type: 'row', align: 'between', children: [{ type: 'text', value: 'Deploys today' }, { type: 'badge', value: '{{n}}', tone: 'good' }] }, data: { n: 4 } },
  grid: { spec: { type: 'grid', columns: 3, children: [{ type: 'stat', value: '{{open}}', label: 'open' }, { type: 'stat', value: '{{failing}}', label: 'failing', tone: 'bad' }, { type: 'stat', value: '{{merged}}', label: 'merged', tone: 'good' }] }, data: { open: 6, failing: 1, merged: 12 } },
  section: { spec: { type: 'section', title: 'Releases', subtitle: '{{releases.length}}', collapsed: false, children: [{ type: 'tags', each: 'releases', tag: '{{this}}' }] }, data: { releases: ['v2.4.0', 'v2.3.2', 'v2.3.1'] } },
  tabs: { spec: { type: 'tabs', tabs: [{ label: 'Mine', badge: '{{mine.length}}', children: [{ type: 'list', each: 'mine', title: '{{title}}' }] }, { label: 'Team', badge: '{{team.length}}', children: [{ type: 'list', each: 'team', title: '{{title}}' }] }] }, data: { mine: [{ title: 'Fix the date picker' }], team: [{ title: 'Retry webhooks' }, { title: 'Spike: exports' }] } },
  divider: { spec: { type: 'stack', children: [{ type: 'text', value: 'Above' }, { type: 'divider' }, { type: 'text', value: 'Below', muted: true }] } },
  text: { spec: { type: 'text', value: 'Last deploy {{ago at}} by {{who}}', size: 'md', tone: { failed: 'bad' } }, data: { at: '2026-10-17T09:00:00Z', who: 'octocat' } },
  heading: { spec: { type: 'heading', value: '{{name}}', level: 2 }, data: { name: 'Production' } },
  markdown: { spec: { type: 'markdown', value: '{{notes}}' }, data: { notes: '**Shipped** the new search.\n\n- 30% faster\n- [Release notes](https://github.com/acme/web/releases)' } },
  code: { spec: { type: 'code', value: '{{cmd}}', copy: true }, data: { cmd: 'gh pr checkout 412' } },
  stat: { spec: { type: 'stat', value: '{{num visits}}', label: 'visits today', delta: '{{change}}', spark: 'week' }, data: { visits: 12840, change: '+12%', week: [8, 9, 7, 11, 10, 12, 13] } },
  stats: { spec: { type: 'stats', each: 'stats', value: '{{n}}', label: '{{name}}', color: '{{color}}', tone: '{{#if bad}}bad{{/if}}' }, data: { stats: [{ name: 'open', n: 6 }, { name: 'drafts', n: 1 }, { name: 'conflicts', n: 1, bad: true }, { name: 'bug', n: 2, color: 'd73a4a' }] } },
  kv: { spec: { type: 'kv', items: [{ key: 'Branch', value: '{{branch}}', mono: true, copy: true }, { key: 'Status', value: '{{status}}', tone: { live: 'good', down: 'bad' } }, { key: 'Updated', value: '{{ago at}}' }] }, data: { branch: 'feat/search', status: 'live', at: '2026-10-17T08:00:00Z' } },
  list: {
    spec: { type: 'list', each: 'prs', title: '#{{number}} {{title}}', subtitle: '{{author}} · {{ago updated}}', avatar: '{{author}}', href: '{{url}}', group: 'state', filter: true, accessories: [{ tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }], actions: [{ label: 'Review', run: 'review', arg: '{{url}}' }], empty: 'No open PRs' },
    data: { prs: PRS },
  },
  table: {
    spec: { type: 'table', each: 'prs', sort: 'number desc', filter: true, columns: [{ title: 'PR', value: '#{{number}} {{title}}', href: '{{url}}' }, { title: 'Author', value: '{{author}}', hide: 'narrow' }, { title: 'CI', tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }, { title: 'Updated', value: '{{ago updated}}', align: 'right', hide: 'narrow' }] },
    data: { prs: PRS },
  },
  chart: { spec: { type: 'chart', kind: 'area', each: 'days', x: '{{day}}', y: '{{ms}}', unit: ' ms', label: 'p95 latency' }, data: { days: [{ day: 'Mon', ms: 320 }, { day: 'Tue', ms: 280 }, { day: 'Wed', ms: 410 }, { day: 'Thu', ms: 300 }, { day: 'Fri', ms: 260 }] } },
  spark: { spec: { type: 'spark', values: 'cpu', tone: 'accent' }, data: { cpu: [12, 30, 22, 48, 35, 60, 41] } },
  progress: { spec: { type: 'progress', value: '{{done}}', max: '{{total}}', label: 'Sprint 42' }, data: { done: 18, total: 25 } },
  tags: { spec: { type: 'tags', each: 'labels', tag: '{{name}}', color: '{{color}}' }, data: { labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'feature', color: '0e8a16' }, { name: 'docs', color: '0075ca' }] } },
  badge: { spec: { type: 'badge', value: '{{failing}} failing', tone: 'bad', if: 'failing' }, data: { failing: 2 } },
  timeline: { spec: { type: 'timeline', each: 'events', time: '{{at}}', title: '{{what}}', text: '{{who}}', tone: { 'Deploy failed': 'bad', Deployed: 'good' } }, data: { events: [{ at: '2026-10-17T09:10:00Z', what: 'Deployed', who: 'v2.4.0 by octocat' }, { at: '2026-10-17T08:40:00Z', what: 'Deploy failed', who: 'v2.4.0-rc1' }, { at: '2026-10-16T17:00:00Z', what: 'Merged #418', who: 'hubot' }] } },
  image: { spec: { type: 'image', src: 'https://avatars.githubusercontent.com/{{login}}?s=80', alt: '{{login}}', height: 40 }, data: { login: 'octocat' } },
  button: { spec: { type: 'button', label: 'Deploy', icon: 'ship', style: 'primary', run: 'deploy', arg: '{{branch}}', confirm: 'Deploy {{branch}} to production?' }, data: { branch: 'main' } },
  actions: { spec: { type: 'actions', items: [{ label: 'Refresh', icon: 'refresh', refresh: true }, { label: 'GitHub', icon: 'github', open: 'https://github.com/{{repo}}' }, { label: 'Copy repo', copy: '{{repo}}', style: 'quiet' }] }, data: { repo: 'acme/web' } },
  links: { spec: { type: 'links', items: [{ label: 'Linear', href: 'https://linear.app' }, { label: 'Status', href: 'https://status.example.com' }, { label: 'Board', href: 'laki://board' }] } },
  form: { spec: { type: 'form', fields: [{ id: 'title', type: 'text', label: 'Title', hint: 'What broke?' }, { id: 'urgent', type: 'bool', label: 'Urgent' }, { id: 'team', type: 'choice', label: 'Team', choices: ['web', 'api'], default: 'web' }], submit: { label: 'File issue', run: 'file', confirm: 'File it on GitHub?' } } },
  empty: { spec: { type: 'empty', text: 'No deploys yet today', icon: 'ship', action: { label: 'Refresh', refresh: true } } },
}
export const UI_SAMPLES = UI_TYPES.map(type => ({ type, group: UI[type].group, blurb: UI[type].blurb, spec: SAMPLES[type].spec, data: SAMPLES[type].data }))
