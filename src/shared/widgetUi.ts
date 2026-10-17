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
export type Kind = 'text' | 'path' | 'number' | 'bool' | 'children' | 'button' | 'buttons' | 'icon' | 'tone' | 'items' | 'object' | readonly string[]
export type Prop = { kind: Kind; desc: string }
type Def = { group: 'Layout' | 'Text' | 'Data' | 'Actions'; blurb: string; props: Record<string, Prop>; rows?: boolean }
const p = <K extends Kind>(kind: K, desc: string) => ({ kind, desc })

export const TONES = ['good', 'bad', 'warn', 'accent', 'muted'] as const
export type Tone = (typeof TONES)[number]
// a color: a tone, one of Laki's palette by name (the app's tab colors, each theme's own), or a hex (d73a4a, #d73a4a)
export const COLORS = ['blue', 'green', 'red', 'orange', 'yellow', 'purple', 'pink', 'teal', 'lime', 'brown', 'gray'] as const
// what a button may ask Laki to do (the app asks you first, showing what): a new workspace whose agent starts on a
// prompt, a prompt to the workspace's agent or to Laki AI, a command in a new terminal, a page in a Laki browser tab
export const DO = ['new', 'send', 'ai', 'terminal', 'browse'] as const
export const CHARTS = ['line', 'area', 'bars', 'stacked', 'hbars', 'pie', 'donut', 'scatter'] as const
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
export const BUTTON = {
  label: p('text', 'Its words'),
  icon: p('icon', 'An icon of Laki’s by name (refresh, check, github…) or an emoji'),
  style: p(['primary', 'quiet', 'danger'] as const, 'primary, quiet or danger; none: plain'),
  run: p('text', 'One of widget.json’s actions, run on a click'),
  arg: p('text', 'What the action gets as $WIDGET_ARG'),
  open: p('text', 'A link to open: http(s), mailto or laki://'),
  refresh: p('bool', 'Fetch again'),
  full: p('bool', 'Open the full view'),
  copy: p('text', 'Text to copy'),
  do: p(DO, 'A Laki command: new (a workspace, its agent starting on prompt), send (prompt to the workspace’s agent), ai (prompt to Laki AI), terminal (command in a new terminal), browse (url in a Laki browser tab). The app shows what and asks first (browse just opens, like a link)'),
  prompt: p('text', 'With do new, send or ai: the prompt'),
  command: p('text', 'With do terminal: the command line'),
  url: p('text', 'With do browse: the page (http or https)'),
  agent: p('text', 'With do new: an agent or a profile of yours (claude, codex…); none: your default'),
  project: p('text', 'With do new: a project by name or id; none: the workspace’s (per workspace), else the selected one’s'),
  confirm: p('text', 'A question the app asks first'),
} as const
const COLOR = p('text', 'A color: a tone (good, bad…), one of Laki’s palette (blue, green, red, orange, yellow, purple, pink, teal, lime, brown, gray) or a hex (d73a4a)')
const STAT = {
  value: p('text', 'The number or word'),
  label: p('text', 'What it counts'),
  delta: p('text', 'A change, +3 or -2%: green when up, red when down (unless tone says)'),
  spark: p('path', 'A list of numbers: a line under it'),
  icon: p('icon', 'An icon or emoji before it'),
  color: p('text', 'A dot by its label: a palette name or a hex (d73a4a, a GitHub label’s)'),
} as const
const BUTTONS = p('buttons', 'Buttons: each a button’s props (run, open, do, refresh, full, copy)')

export const UI = {
  stack: { group: 'Layout', blurb: 'Elements one under another.', props: { children: p('children', 'Its elements'), gap: p(GAP, 'Space between them: sm, md (the default) or lg') } },
  row: { group: 'Layout', blurb: 'Elements side by side.', props: { children: p('children', 'Its elements'), gap: p(GAP, 'Space between them'), align: p(['start', 'center', 'end', 'between'] as const, 'start, center (the default), end, or between: spread across'), wrap: p('bool', 'Wrap onto more lines when they don’t fit') } },
  grid: { group: 'Layout', blurb: 'Elements in columns, fewer as the cell narrows.', props: { children: p('children', 'Its elements'), columns: p('number', 'Columns, 1-6 (2 by default): fewer in a narrow cell') } },
  section: { group: 'Layout', blurb: 'A titled group, foldable.', props: { title: p('text', 'Its heading'), subtitle: p('text', 'Words beside the heading'), children: p('children', 'Its elements'), collapsed: p('bool', 'Foldable: true starts it folded, false open') } },
  tabs: { group: 'Layout', blurb: 'Panels behind tabs.', props: { tabs: p('items', 'The tabs: [{ "label", "badge", "children" }]') } },
  header: { group: 'Layout', blurb: 'A title bar: an icon, a title and subtitle, buttons at its end.', props: { title: p('text', 'Its title'), subtitle: p('text', 'A line under it'), icon: p('icon', 'An icon or emoji before it'), color: COLOR, href: p('text', 'A link its title opens'), actions: BUTTONS } },
  footer: { group: 'Layout', blurb: 'A bar along the bottom: muted words, buttons and links at its end.', props: { text: p('text', 'Its words (“updated {{ago at}}”)'), actions: BUTTONS } },
  toolbar: { group: 'Layout', blurb: 'Icon buttons in a row, their words as tooltips.', props: { items: BUTTONS, labels: p('bool', 'Their words beside the icons too'), align: p(['start', 'end', 'between'] as const, 'start (the default), end, or between') } },
  spacer: { group: 'Layout', blurb: 'Room that pushes what follows it in a row to the end.', props: {} },
  divider: { group: 'Layout', blurb: 'A line across.', props: {} },
  text: { group: 'Text', blurb: 'A line of text.', props: { value: p('text', 'The words'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), weight: p(['normal', 'medium', 'semibold', 'bold'] as const, 'How bold'), mono: p('bool', 'In the monospace font'), muted: p('bool', 'Dimmer'), wrap: p('bool', 'Wrap onto more lines (default: one line, cut with …)'), color: COLOR } },
  heading: { group: 'Text', blurb: 'A heading.', props: { value: p('text', 'The words'), level: p('number', '1, 2 (the default) or 3'), color: COLOR } },
  markdown: { group: 'Text', blurb: 'Formatted text: headings, lists, tasks, code, tables, quotes, links and https images.', props: { value: p('text', 'The Markdown (a whole note: “{{text}}” of a file or a typed text)') } },
  code: { group: 'Text', blurb: 'A block of code, with Copy.', props: { value: p('text', 'The code'), copy: p('bool', 'A copy button') } },
  callout: { group: 'Text', blurb: 'A box that stands out: a tip, a warning, an outage.', props: { title: p('text', 'Its first line, bold'), text: p('text', 'More words under it'), icon: p('icon', 'An icon or emoji (default: by its tone)'), action: p('button', 'A button at its end') } },
  icon: { group: 'Text', blurb: 'An icon of Laki’s or an emoji, any size and color.', props: { name: p('icon', 'An icon of Laki’s by name, or an emoji'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), color: COLOR } },
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
      image: p('text', 'An image before it: data: or https'),
      accessories: p('items', 'At the row’s end: [{ "tag" | "text" | "badge" | "icon" | "avatar" | "ago" | "date", "tone", "color" (a palette name, or a tag’s hex border), "each" (one per item of a row’s list: its labels) }]'),
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
    blurb: 'A chart drawn as SVG: line, area, bars, stacked bars, horizontal bars, pie, donut or scatter.',
    rows: true,
    props: {
      kind: p(CHARTS, 'line (the default), area, bars, stacked (bars, a series on another), hbars (a bar per row, its label beside it), pie, donut, or scatter'),
      x: p('text', 'A row’s label (pie and donut: a slice’s; scatter: a number across)'),
      y: p('text', 'A row’s number'),
      series: p('items', 'Several numbers per row: [{ "label", "y", "color" }] (line, area, bars, stacked, scatter)'),
      color: p('text', 'A row’s color, a template (pie, donut, hbars, bars of one series): {{color}}'),
      colors: p('items', 'The colors in order: a series’, or a slice’s: ["blue", "orange", "#d73a4a"] (default: Laki’s palette)'),
      height: p('number', 'Its height in px'),
      min: p('number', 'The bottom of the scale'),
      max: p('number', 'The top of the scale'),
      unit: p('text', 'After each number: ms, %, $'),
      label: p('text', 'Its title, above it with the last value (a donut: in its middle, with the total)'),
      legend: p('bool', 'A legend: on by default with several series and for pie and donut'),
    },
  },
  spark: { group: 'Data', blurb: 'A small line of numbers.', props: { values: p('path', 'A list of numbers'), color: COLOR } },
  progress: { group: 'Data', blurb: 'How far along: a bar or a ring.', props: { value: p('text', 'How much is done'), max: p('number', 'Of how much (100)'), label: p('text', 'What it is'), style: p(['bar', 'ring'] as const, 'bar (the default) or ring'), color: COLOR } },
  gauge: { group: 'Data', blurb: 'A dial: a number on a half circle between min and max.', props: { value: p('text', 'The number'), min: p('number', 'The low end (0)'), max: p('number', 'The high end (100)'), label: p('text', 'What it is'), unit: p('text', 'After the number: %, ms'), color: COLOR } },
  heatmap: { group: 'Data', blurb: 'A grid of squares, darker for more: days of activity, GitHub style.', rows: true, props: { x: p('text', 'A square’s label (its tooltip): a date'), value: p('text', 'Its number'), rows: p('number', 'Squares down, 7 by default (a week a column)'), max: p('number', 'The darkest (default: the highest)'), color: COLOR } },
  status: { group: 'Data', blurb: 'Things and their state, a dot each: services, environments, jobs.', rows: true, props: { label: p('text', 'Its name'), state: p('text', 'Its state: up, degraded, down… (its dot and words, colored by tone)'), text: p('text', 'More words beside it'), href: p('text', 'A link a click opens') } },
  checklist: { group: 'Data', blurb: 'Tasks ticked or not, with how many are done.', rows: true, props: { text: p('text', 'A task'), done: p('text', 'A path or template: done when truthy'), count: p('bool', 'Its count above it (3/5): on by default') } },
  avatars: { group: 'Data', blurb: 'GitHub pictures in an overlapping row, then +N.', rows: true, props: { login: p('text', 'A GitHub login'), max: p('number', 'Pictures at most (5), then +N') } },
  tags: { group: 'Data', blurb: 'Pills: labels, states.', rows: true, props: { items: p('items', 'Each one: a word, or { "tag", "tone", "color" }'), tag: p('text', 'With each: a pill’s words'), color: p('text', 'A palette name, or a hex (d73a4a): its border and dot, a GitHub label’s') } },
  badge: { group: 'Data', blurb: 'A count or a short word, filled.', props: { value: p('text', 'The count or word'), color: COLOR } },
  timeline: { group: 'Data', blurb: 'What happened, newest first.', rows: true, props: { time: p('text', 'When (an ISO date or ms: shown as 3 hours ago; else as written)'), title: p('text', 'What happened'), text: p('text', 'More words under it'), icon: p('icon', 'An icon or emoji') } },
  image: { group: 'Data', blurb: 'A picture: a data: image or an https one.', props: { src: p('text', 'A data:image/… or https:// URL'), alt: p('text', 'What it shows'), height: p('number', 'Its height in px') } },
  card: { group: 'Data', blurb: 'A box with a picture, a title, words and a tag: a link to open.', rows: true, props: { title: p('text', 'Its title'), text: p('text', 'Its words'), image: p('text', 'A picture: data: or https'), icon: p('icon', 'Or an icon or emoji'), tag: p('text', 'A pill by its title'), href: p('text', 'A link a click opens') } },
  button: { group: 'Actions', blurb: 'Runs an action or a Laki command, opens a link, refreshes, copies.', props: BUTTON },
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
type S = { scopes: Scope[]; full: boolean; single: boolean; cells: [number, number]; line: boolean; ids: { uid: string; n: number } } // ids: one counter for the whole tree (rows' copies of S share it)
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
function toneWord(e: El, main: string, s: S) {
  const t = e.tone
  const v = obj(t) ? (Object.hasOwn(t, main) ? t[main] : Object.hasOwn(t, main.toLowerCase()) ? t[main.toLowerCase()] : undefined) : t
  const w = typeof v === 'string' ? txt(v, s).trim() : ''
  return (TONES as readonly string[]).includes(w) ? w : ''
}
const toneOf = (e: El, main: string, s: S) => (w => (w ? `t-${w}` : ''))(toneWord(e, main, s))
// a color as CSS: a tone's (the theme's), the palette's (the theme's tab colors, these where it has none) or a hex
const TONE_CSS: Record<string, string> = { good: 'var(--done, #9ece6a)', bad: 'var(--error, #f7768e)', warn: 'var(--waiting, #e0af68)', accent: 'var(--accent, #7aa2f7)', muted: 'var(--muted, #7a8294)' }
const TC: Record<string, string> = { red: '#f7768e', orange: '#ff9e64', yellow: '#e0af68', green: '#9ece6a', teal: '#73daca', blue: '#7aa2f7', purple: '#bb9af7', pink: '#f5a3d0', lime: '#b5cf6b', brown: '#99603c', gray: '#7a8294' }
export function colorCss(word: string) {
  const w = word.trim().toLowerCase()
  return Object.hasOwn(TONE_CSS, w) ? TONE_CSS[w] : Object.hasOwn(TC, w) ? `var(--tc-${w}, ${TC[w]})` : (x => (x ? `#${x}` : ''))(hex(w))
}
const hue = (v: unknown, s: S) => (v === undefined ? '' : colorCss(txt(v, s)))
// its class (with its tone), tooltip and color (a color prop: its text and currentColor)
const at = (e: El, s: S, cls: string, main = '', color?: unknown) => {
  const c = [cls, toneOf(e, main, s)].filter(Boolean).join(' ')
  const tip = e.tip !== undefined ? txt(e.tip, s) : ''
  const col = hue(color, s)
  return `${c ? ` class="${c}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}${col ? ` style="color:${col}"` : ''}`
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
const link = (url: string, inner: string, cls = '') => (u => (!u ? `<span${cls ? ` class="${cls}"` : ''}>${inner}</span>` : /^laki:/i.test(u) ? `<a${cls ? ` class="${cls}"` : ''} data-open="${esc(u)}">${inner}</a>` : `<a${cls ? ` class="${cls}"` : ''} href="${esc(u)}" title="${esc(u)}">${inner}</a>`))(safeUrl(url))
const avatarUrl = (login: string) => (/^[A-Za-z0-9-]{1,39}$/.test(login.trim()) ? `https://avatars.githubusercontent.com/${login.trim()}?s=40` : '')
// a picture: data: or https (a JS page without network access shows none of the latter: the guide says so)
const imageOk = (u: string) => /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(u) || /^https:\/\/[\w.-]+(:\d+)?\/[^\s"'<>\\]*$/.test(u)
const hex = (v: string) => (/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v.trim()) ? v.trim().replace(/^#/, '') : '')
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

// a Laki command a button asks for (the app shows it and asks first): its words filled in
export type UiDo = { do: (typeof DO)[number]; prompt?: string; command?: string; url?: string; agent?: string; project?: string }
const doOf = (b: El, s: S): UiDo | undefined => {
  const w = txt(b.do, s).trim()
  if (!(DO as readonly string[]).includes(w)) return undefined
  const c: Record<string, string> = { do: w }
  for (const k of ['prompt', 'command', 'url', 'agent', 'project']) if (b[k] !== undefined) c[k] = txt(b[k], s)
  return c as UiDo
}
// bare: its icon alone, its words the tooltip (a toolbar's)
function button(b: unknown, s: S, small = false, bare = false): string {
  if (!obj(b) || hidden(b, s)) return ''
  const label = txt(b.label, s)
  const style = ['primary', 'quiet', 'danger'].includes(String(b.style)) ? ` ${b.style}` : ''
  const iconOnly = bare && b.icon !== undefined && !!icon(b.icon, s, 12)
  let act = ''
  if (b.run !== undefined) act = ` data-run="${h(b.run, s)}"${b.arg !== undefined ? ` data-arg="${h(b.arg, s)}"` : ''}`
  else if (b.do !== undefined) act = (c => (c ? ` data-do="${esc(JSON.stringify(c))}"` : ' disabled'))(doOf(b, s))
  else if (b.open !== undefined) act = (u => (u ? ` data-open="${esc(u)}"` : ' disabled'))(safeUrl(txt(b.open, s)))
  else if (b.refresh === true) act = ' data-laki="refresh"'
  else if (b.full === true) act = ' data-laki="full"'
  else if (b.copy !== undefined) act = ` data-copy="${h(b.copy, s)}"`
  const confirm = b.confirm !== undefined ? ` data-confirm="${h(b.confirm, s)}"` : ''
  return `<button type="button"${at(iconOnly && b.tip === undefined ? { ...b, tip: label } : b, s, `k-btn${style}${small ? ' sm' : ''}${iconOnly ? ' bare' : ''}`, label)}${act}${confirm}${iconOnly && label ? ` aria-label="${esc(label)}"` : ''}>${b.icon !== undefined ? icon(b.icon, s, 12) : ''}${label && !iconOnly ? `<span>${esc(label)}</span>` : ''}</button>`
}
const buttons = (v: unknown, s: S, small = true, bare = false) => (Array.isArray(v) ? v.map(b => button(b, s, small, bare)).join('') : '')

function stat(e: El, s: S) {
  const value = txt(e.value, s)
  const d = txt(e.delta, s).trim()
  const dt = e.tone === undefined && d ? (/^[-−]/.test(d) ? 't-bad' : /^\+/.test(d) ? 't-good' : 't-muted') : toneOf(e, d, s)
  const c = hue(e.color, s)
  const label = txt(e.label, s)
  const sp = e.spark !== undefined ? spark(valueAt(e.spark, s.scopes)) : ''
  return `<div${at(e, s, 'k-stat', value)}>${e.icon !== undefined ? icon(e.icon, s, 16) : ''}<div class="k-v">${esc(value)}${d ? `<span class="k-delta ${dt}">${esc(d)}</span>` : ''}</div>${label || c ? `<div class="k-l">${c ? `<i class="k-dotc" style="background:${c}"></i>` : ''}${esc(label)}</div>` : ''}${sp ? `<div class="k-spark">${sp}</div>` : ''}</div>`
}

function accessory(a: unknown, s: S): string {
  if (!obj(a)) return ''
  if (a.each !== undefined) return listAt(a.each, s).map((x, i) => accessory({ ...a, each: undefined }, inner(s, x, i))).join('') // one per item: a PR's labels
  if (hidden(a, s)) return ''
  const key = ['tag', 'badge', 'text', 'icon', 'avatar', 'ago', 'date'].find(k => a[k] !== undefined)
  if (!key) return ''
  const v = txt(a[key], s)
  const tone = toneOf(a, v, s)
  const c = hue(a.color, s)
  if (key === 'tag') return v ? `<span class="k-tag ${tone}"${c ? ` style="border-color:${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'badge') return v ? `<span class="k-badge ${tone}${c ? ' c' : ''}"${c ? ` style="color:${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'icon') return `<span class="${tone}"${c ? ` style="color:${c}"` : ''}>${icon(a.icon, s, 13)}</span>`
  if (key === 'avatar') return (u => (u ? `<img class="k-av" src="${u}" alt="${esc(v)}" title="${esc(v)}">` : ''))(avatarUrl(v))
  const t = key === 'ago' || key === 'date' ? timeOf(v.trim()) : undefined
  const words = key === 'ago' ? (t === undefined ? v : ago(t)) : key === 'date' ? (t === undefined ? v : date(t)) : v
  return words ? `<span class="${tone}"${c ? ` style="color:${c}"` : ''}${t !== undefined ? ` title="${esc(new Date(t).toLocaleString())}"` : ''}>${esc(words)}</span>` : ''
}

// each row of a list
function row(e: El, s: S, extra: boolean) {
  const title = txt(e.title, s)
  const sub = txt(e.subtitle, s)
  const href = e.href !== undefined ? safeUrl(txt(e.href, s)) : ''
  const lead = e.avatar !== undefined ? (u => (u ? `<img class="k-av" src="${u}" alt="">` : ''))(avatarUrl(txt(e.avatar, s))) : e.image !== undefined ? (u => (imageOk(u) ? `<img class="k-av" src="${esc(u)}" alt="">` : ''))(txt(e.image, s).trim()) : e.icon !== undefined ? icon(e.icon, s) : ''
  const acc = Array.isArray(e.accessories) ? e.accessories.map(a => accessory(a, s)).join('') : ''
  const acts = buttons(e.actions, s)
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
// a chart's colors in order: Laki's palette, or the chart's colors
const PALETTE = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'yellow', 'red']
const numOf = (v: string) => (v.trim() === '' ? NaN : Number(v))
const f1 = (x: number) => x.toFixed(1)
const legendOf = (keys: [string, string, string?][]) => `<div class="k-legend">${keys.map(([label, c, v]) => `<span><i style="background:${c}"></i>${esc(label)}${v ? `<b>${esc(v)}</b>` : ''}</span>`).join('')}</div>`
function chart(e: El, s: S) {
  const rs = listAt(e.each ?? e.items, s).map((item, i) => inner(s, item, i))
  const kind = (CHARTS as readonly string[]).includes(String(e.kind)) ? String(e.kind) : 'line'
  const given = (Array.isArray(e.colors) ? e.colors : []).map(c => hue(c, s)).filter(Boolean)
  const pal = (k: number) => (given.length ? given[k % given.length] : colorCss(PALETTE[k % PALETTE.length]))
  const unit = txt(e.unit, s)
  const fmt = (v: number) => `${num(v)}${unit}`
  const xs = rs.map(r => txt(e.x, r))
  const label = txt(e.label, s)
  const height = s.line ? 18 : (n(e.height, s) ?? (s.full ? 160 : Math.max(24, s.cells[1] * 64 - 34)))
  const wrap = (body: string, head = '', legend = '') => `<div${at({ tip: e.tip }, s, `k-chart k-${kind}`)}>${s.line ? '' : head}${body}${s.line ? '' : legend}</div>`
  const headOf = (v?: string) => (label || v ? `<div class="k-ch-head"><span>${esc(label)}</span>${v ? `<b>${esc(v)}</b>` : ''}</div>` : '')
  // a row's own color (pie, donut, hbars, one series' bars): its color template, its tone, else the palette's next
  const rowColor = (i: number) => hue(e.color, rs[i]) || (w => (w ? colorCss(w) : ''))(toneWord(e, xs[i], rs[i])) || pal(i)

  if (kind === 'pie' || kind === 'donut' || kind === 'hbars') {
    const vals = rs.map(r => numOf(txt(e.y, r)))
    const ok = vals.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v) && v > 0)
    if (!ok.length) return ''
    const total = ok.reduce((a, [v]) => a + v, 0)
    if (kind === 'hbars') {
      const top = n(e.max, s) ?? Math.max(...ok.map(([v]) => v))
      const max = cap(e, s, 18)
      const rows = ok.map(([v, i], k) => (k >= max && !s.full ? '' : `<div class="k-hb" data-row${k >= max ? ' data-extra hidden' : ''} title="${esc(`${xs[i]}: ${fmt(v)}`)}"><span class="k-hb-l">${esc(xs[i])}</span><span class="k-hb-t"><i style="width:${f1(Math.min(100, (v / (top || 1)) * 100))}%;background:${rowColor(i)}"></i></span><b>${esc(fmt(v))}</b></div>`)).join('')
      return wrap(`<div class="k-hbars" data-rows>${rows}${s.line ? '' : more(ok.length - Math.min(max, ok.length))}</div>`, headOf())
    }
    const pie = kind === 'pie'
    const r = pie ? 7.9577 : 15.9155
    let off = 0
    const slices = ok
      .map(([v, i]) => {
        const pct = (v / total) * 100
        const c = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="currentColor" style="color:${rowColor(i)}" stroke-width="${pie ? 15.9155 : 6}" pathLength="100" stroke-dasharray="${f1(pct)} ${f1(100 - pct)}" stroke-dashoffset="${f1(-off)}" transform="rotate(-90 21 21)"><title>${esc(`${xs[i] ? `${xs[i]}: ` : ''}${fmt(v)} (${Math.round(pct)}%)`)}</title></circle>`
        off += pct
        return c
      })
      .join('')
    const size = s.line ? 16 : Math.min(height, s.full ? 180 : height)
    const mid = pie || s.line ? '' : `<div class="k-pie-mid"><b>${esc(fmt(total))}</b>${label ? `<span>${esc(label)}</span>` : ''}</div>`
    const legend = e.legend === false || s.line ? '' : legendOf(ok.map(([v, i]) => [xs[i], rowColor(i), s.full || s.cells[0] > 1 ? `${Math.round((v / total) * 100)}%` : undefined]))
    return wrap(`<div class="k-pie-body"><div class="k-pie-c" style="width:${size}px;height:${size}px"><svg viewBox="0 0 42 42" role="img" aria-label="${esc(label || kind)}">${slices}</svg>${mid}</div>${legend}</div>`, pie ? headOf() : '')
  }

  const series = (Array.isArray(e.series) && e.series.length ? e.series.filter(obj) : [{ y: e.y }]) as El[]
  const ys = series.map(se => rs.map(r => numOf(txt(se.y, r))))
  const all = ys.flat().filter(Number.isFinite)
  if (!all.length) return '' // nothing to draw
  const colorOfSe = (se: El, k: number) => hue(se.color, s) || (w => (w ? colorCss(w) : ''))(toneWord(se, '', s)) || pal(k)
  const stacked = kind === 'stacked'
  const sums = rs.map((_, i) => ys.reduce((a, y) => a + Math.max(0, Number.isFinite(y[i]) ? y[i] : 0), 0))
  let lo = n(e.min, s) ?? (stacked ? 0 : Math.min(...all))
  const hi = n(e.max, s) ?? (stacked ? Math.max(...sums) : Math.max(...all))
  if (kind === 'bars' && e.min === undefined) lo = Math.min(0, lo)
  const yOf = (v: number) => chartPoints([v], lo, hi)[0][1]
  let plot = [2, H / 2, H - 2].map(y => `<line class="grid" x1="0" x2="100" y1="${y}" y2="${y}" vector-effect="non-scaling-stroke"/>`).join('')
  let dots = ''
  const slot = 100 / Math.max(1, rs.length)
  if (kind === 'scatter') {
    // x: a number across when every row's is one, else the row's place
    const xn = rs.map(r => numOf(txt(e.x, r)))
    const byX = xn.every(Number.isFinite) && xn.length > 1
    const [xlo, xhi] = byX ? [Math.min(...xn), Math.max(...xn)] : [0, Math.max(1, rs.length - 1)]
    series.forEach((se, k) =>
      ys[k].forEach((v, i) => {
        if (!Number.isFinite(v)) return
        const x = (((byX ? xn[i] : i) - xlo) / (xhi - xlo || 1)) * 100
        dots += `<i class="k-sc-dot" style="left:${f1(x)}%;top:${f1((yOf(v) / H) * 100)}%;background:${colorOfSe(se, k)}" title="${esc(`${xs[i] ? `${xs[i]}: ` : ''}${series.length > 1 ? `${txt(se.label, s)} ` : ''}${fmt(v)}`)}"></i>`
      }),
    )
  } else if (kind === 'bars' || stacked) {
    const base = yOf(Math.max(lo, Math.min(0, hi)))
    const acc = rs.map(() => 0)
    series.forEach((se, k) => {
      const c = colorOfSe(se, k)
      ys[k].forEach((v, i) => {
        if (!Number.isFinite(v)) return
        const w = stacked ? slot : slot / series.length
        const x = stacked ? i * slot : i * slot + k * w
        const [y0, y1] = stacked ? [yOf(acc[i]), yOf((acc[i] += Math.max(0, v)))] : [base, yOf(v)]
        const col = series.length === 1 && !stacked ? rowColorOr(i, c) : c
        plot += `<rect x="${f1(x + w * 0.15)}" y="${f1(Math.min(y0, y1))}" width="${f1(w * 0.7)}" height="${f1(Math.max(0.5, Math.abs(y0 - y1)))}" fill="currentColor" style="color:${col}"/>`
      })
    })
  } else
    series.forEach((se, k) => {
      const c = colorOfSe(se, k)
      const vals = ys[k]
      const pts = chartPoints(vals.map(v => (Number.isFinite(v) ? v : lo)), lo, hi).filter((_, i) => Number.isFinite(vals[i]))
      const line = pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')
      if (kind === 'area' && pts.length) plot += `<polygon points="${f1(pts[0][0])},${H} ${line} ${f1(pts.at(-1)![0])},${H}" fill="currentColor" fill-opacity="0.15" style="color:${c}"/>`
      plot += `<polyline points="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" style="color:${c}"/>`
      const last = pts.at(-1)
      if (last && k === 0) dots = `<i class="k-ch-dot" style="left:${f1(last[0])}%;top:${f1((last[1] / H) * 100)}%;background:${c}"></i>`
    })
  // each point's tooltip: a slot across the plot
  if (kind !== 'scatter') plot += rs.map((_, i) => `<rect x="${f1(i * slot)}" y="0" width="${f1(slot)}" height="${H}" fill="transparent"><title>${esc(xs[i] ? `${xs[i]}: ` : '')}${esc(series.map((se, k) => `${series.length > 1 ? `${txt(se.label, s)} ` : ''}${Number.isFinite(ys[k][i]) ? fmt(ys[k][i]) : '–'}`).join(', '))}</title></rect>`).join('')
  const lastV = stacked ? sums.at(-1) : ys[0].filter(Number.isFinite).at(-1)
  const legend = (e.legend ?? series.length > 1) === true ? legendOf(series.map((se, k) => [txt(se.label, s) || txt(e.y, s), colorOfSe(se, k)])) : ''
  const xAxis = s.full && xs.some(Boolean) && kind !== 'scatter' ? `<div class="k-ch-x"><span>${esc(xs[0])}</span><span>${esc(xs.at(-1)!)}</span></div>` : ''
  return wrap(`<div class="k-ch-body" style="height:${height}px">${s.line ? '' : `<div class="k-ch-axis"><span>${esc(fmt(hi))}</span><span>${esc(fmt(lo))}</span></div>`}<div class="k-ch-plot"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label || 'chart')}">${plot}</svg>${dots}</div></div>${xAxis}`, kind === 'scatter' ? headOf() : headOf(lastV !== undefined ? fmt(lastV) : undefined), legend)

  // one series' bars: each its own color only when the chart says how (a color template or a tone map)
  function rowColorOr(i: number, c: string) {
    return hue(e.color, rs[i]) || (w => (w ? colorCss(w) : ''))(toneWord(e, String(ys[0][i]), rs[i])) || c
  }
}

// a heatmap's level, 0-4, of the highest
const level = (v: number, top: number) => (!(v > 0) ? 0 : Math.min(4, Math.max(1, Math.ceil((v / (top || 1)) * 4))))
const STATE: [RegExp, Tone][] = [
  [/^(up|ok|okay|operational|healthy|passing|passed|live|online|green|success|succeeded|done|ready|running)$/i, 'good'],
  [/^(degraded|slow|partial|pending|queued|warn|warning|maintenance|yellow|starting|deploying)$/i, 'warn'],
  [/^(down|outage|offline|failing|failed|error|red|broken|crashed|stopped)$/i, 'bad'],
]
const stateTone = (e: El, state: string, s: S) => toneOf(e, state, s) || (t => (t ? `t-${t}` : 't-muted'))(STATE.find(([re]) => re.test(state.trim()))?.[1])
const CALLOUT: Record<string, string> = { good: 'check', bad: 'ciFail', warn: 'bell' }
const SIZE: Record<string, number> = { sm: 12, md: 16, lg: 22, xl: 32 }

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
    const name = `kt-${s.ids.uid}-${++s.ids.n}`
    return `<div${at(e, s, 'k-tabs')}><div class="k-tabbar" role="tablist">${tabs.map((t, i) => `<label><input type="radio" name="${name}"${i ? '' : ' checked'}><span>${h(t.label, s)}</span>${(b => (b ? `<span class="k-badge">${esc(b)}</span>` : ''))(txt(t.badge, s))}</label>`).join('')}</div>${tabs.map(t => `<section class="k-panel">${kids(t.children, s)}</section>`).join('')}</div>`
  },
  header: (e, s) => {
    const title = txt(e.title, s)
    const href = e.href !== undefined ? txt(e.href, s) : ''
    const acts = buttons(e.actions, s)
    return `<div${at(e, s, 'k-header', title)}>${e.icon !== undefined ? `<span class="k-hd-i"${(c => (c ? ` style="color:${c}"` : ''))(hue(e.color, s))}>${icon(e.icon, s, 16)}</span>` : ''}<div class="k-main"><div class="k-hd-t">${href ? link(href, esc(title)) : esc(title)}</div>${e.subtitle !== undefined ? `<div class="k-sub">${h(e.subtitle, s)}</div>` : ''}</div>${acts ? `<div class="k-acts">${acts}</div>` : ''}</div>`
  },
  footer: (e, s) => (acts => `<div${at(e, s, 'k-footer')}><span class="k-ft-t">${h(e.text, s)}</span>${acts ? `<div class="k-acts">${acts}</div>` : ''}</div>`)(buttons(e.actions, s)),
  toolbar: (e, s) => `<div${at(e, s, `k-toolbar a-${['end', 'between'].includes(String(e.align)) ? e.align : 'start'}`)}>${buttons(e.items, s, true, e.labels !== true)}</div>`,
  spacer: () => '<div class="k-spacer"></div>',
  divider: (e, s) => `<hr${at(e, s, 'k-hr')}>`,
  text: (e, s) => (v => `<div${at(e, s, ['k-text', ['sm', 'lg', 'xl'].includes(String(e.size)) ? `s-${e.size}` : '', ['medium', 'semibold', 'bold'].includes(String(e.weight)) ? `w-${e.weight}` : '', e.mono === true ? 'mono' : '', e.muted === true ? 't-muted' : '', e.wrap === true ? 'wrap' : ''].filter(Boolean).join(' '), v, e.color)}>${esc(v)}</div>`)(txt(e.value, s)),
  heading: (e, s) => (l => (v => `<h${l}${at(e, s, 'k-h', v, e.color)}>${esc(v)}</h${l}>`)(txt(e.value, s)))(Math.min(3, Math.max(1, Math.round(n(e.level, s) ?? 2)))),
  callout: (e, s) => {
    const title = txt(e.title, s)
    const tone = toneWord(e, title, s) || 'accent'
    return `<div${at({ ...e, tone }, s, 'k-callout', title)}>${icon(e.icon ?? CALLOUT[tone] ?? 'info', s, 15)}<div class="k-main">${title ? `<b>${esc(title)}</b>` : ''}${e.text !== undefined ? `<div class="k-co-t">${h(e.text, s)}</div>` : ''}</div>${e.action !== undefined ? button(e.action, s, true) : ''}</div>`
  },
  icon: (e, s) => `<span${at(e, s, 'k-ic', '', e.color)}>${icon(e.name, s, SIZE[String(e.size)] ?? 16)}</span>`,
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
  spark: (e, s) => `<div${at(e, s, 'k-spark', '', e.color)}>${spark(valueAt(e.values, s.scopes))}</div>`,
  gauge: (e, s) => {
    const lo = n(e.min, s) ?? 0
    const hi = n(e.max, s) ?? 100
    const v = n(e.value, s)
    const pct = v === undefined ? 0 : Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100))
    const label = txt(e.label, s)
    const shown = v === undefined ? '–' : `${num(v)}${txt(e.unit, s)}`
    return `<div${at(e, s, 'k-gauge', String(v ?? ''), e.color)}><div class="k-ga-c"><svg viewBox="0 0 100 56" aria-hidden="true"><path class="bg" d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke-width="9" stroke-linecap="round" pathLength="100"/><path class="fg" d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="${f1(pct)} 100"/></svg><b>${esc(shown)}</b></div>${label ? `<span class="k-ga-l">${esc(label)}</span>` : ''}</div>`
  },
  heatmap: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const rs = items.map((item, i) => inner(s, item, i))
    const vals = rs.map(r => n(e.value ?? '{{value}}', r) ?? 0)
    const top = n(e.max, s) ?? Math.max(0, ...vals)
    const down = Math.min(31, Math.max(1, Math.round(n(e.rows, s) ?? 7)))
    return `<div${at({ tip: e.tip, tone: e.tone }, s, 'k-hm')} style="--rows:${down}${(c => (c ? `;color:${c}` : ''))(hue(e.color, s))}">${rs.map((r, i) => `<i class="l${level(vals[i], top)}" title="${esc(`${txt(e.x, r)}${txt(e.x, r) ? ': ' : ''}${num(vals[i])}`)}"></i>`).join('')}</div>`
  },
  status: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const max = cap(e, s, 24)
    return `<div${at({ tip: e.tip }, s, 'k-status')} data-rows>${items
      .map((item, i) => {
        if (i >= max && !s.full) return ''
        const r = inner(s, item, i)
        const state = txt(e.state ?? '{{state}}', r)
        const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
        const t = stateTone(e, state, r)
        return `<div class="k-st" data-row${i >= max ? ' data-extra hidden' : ''}${href ? ` data-open="${esc(href)}"` : ''}><i class="k-st-dot ${t}"></i><span class="k-st-l">${h(e.label ?? '{{label}}', r)}</span>${e.text !== undefined ? `<span class="k-sub">${h(e.text, r)}</span>` : ''}<span class="k-st-s ${t}">${esc(state)}</span></div>`
      })
      .join('')}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
  },
  checklist: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const rs = items.map((item, i) => inner(s, item, i))
    const done = rs.map((r, i) => (e.done !== undefined ? holds(e.done, r) : obj(items[i]) && truthy(items[i].done)))
    const max = cap(e, s, 22)
    const n0 = done.filter(Boolean).length
    const head = e.count === false || !items.length ? '' : `<div class="k-ck-h"><b>${n0}/${items.length}</b><span class="k-bar"><i style="width:${f1((n0 / items.length) * 100)}%"></i></span></div>`
    return `<div${at({ tip: e.tip }, s, 'k-checks')} data-rows>${head}${rs
      .map((r, i) => {
        if (i >= max && !s.full) return ''
        const text = e.text !== undefined ? txt(e.text, r) : typeof items[i] === 'string' ? String(items[i]) : txt('{{text}}', r)
        return `<div class="k-ck${done[i] ? ' on' : ''}" data-row${i >= max ? ' data-extra hidden' : ''}><span class="k-box">${done[i] ? iconSvg('check', 10) : ''}</span><span class="k-ck-t">${esc(text)}</span></div>`
      })
      .join('')}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
  },
  avatars: (e, s) => {
    const logins = listAt(e.each ?? e.items, s).map((item, i) => (e.login !== undefined ? txt(e.login, inner(s, item, i)) : typeof item === 'string' ? item : txt('{{login}}', inner(s, item, i))).trim()).filter(l => avatarUrl(l))
    const max = Math.max(1, Math.round(n(e.max, s) ?? 5))
    return logins.length ? `<div${at({ tip: e.tip }, s, 'k-avs')}>${logins.slice(0, max).map(l => `<img class="k-av" src="${avatarUrl(l)}" alt="${esc(l)}" title="${esc(l)}">`).join('')}${logins.length > max ? `<span class="k-avs-n">+${logins.length - max}</span>` : ''}</div>` : ''
  },
  progress: (e, s) => {
    const max = n(e.max, s) ?? 100
    const pct = Math.round(Math.min(100, Math.max(0, ((n(e.value, s) ?? 0) / (max || 1)) * 100)))
    const label = txt(e.label, s)
    if (e.style === 'ring')
      return `<div${at(e, s, 'k-prog ring', String(pct), e.color)}><svg width="32" height="32" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4"/><circle class="fg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg><div class="k-prog-h"><b>${pct}%</b><span>${esc(label)}</span></div></div>`
    return `<div${at(e, s, 'k-prog', String(pct), e.color)}><div class="k-prog-h"><span>${esc(label)}</span><b>${pct}%</b></div><div class="k-bar"><i style="width:${pct}%"></i></div></div>`
  },
  tags: (e, s) =>
    `<div${at({ tip: e.tip }, s, 'k-tags')}>${itemsOf(e, s)
      .map(([x, r]) => {
        const t = txt(x.tag, r)
        const c = hue(x.color ?? (x === e ? undefined : e.color), r)
        return t ? `<span class="k-tag ${toneOf(x === e ? e : { tone: x.tone ?? e.tone }, t, r)}"${c ? ` style="border-color:${c}"` : ''}>${c ? `<i class="k-dotc" style="background:${c}"></i>` : ''}${esc(t)}</span>` : ''
      })
      .join('')}</div>`,
  badge: (e, s) => (v => (v ? `<span${at(e, s, `k-badge${e.color !== undefined && hue(e.color, s) ? ' c' : ''}`, v, e.color)}>${esc(v)}</span>` : ''))(txt(e.value, s)),
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
  card: (e, s) => {
    const one = (r: S) => {
      const title = txt(e.title, r)
      const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
      const img = e.image !== undefined ? txt(e.image, r).trim() : ''
      const tag = e.tag !== undefined ? txt(e.tag, r) : ''
      const top = imageOk(img) ? `<img class="k-card-img" src="${esc(img)}" alt="">` : e.icon !== undefined ? `<span class="k-card-ic">${icon(e.icon, r, 18)}</span>` : ''
      return `<div class="k-card${href ? ' link' : ''}" data-row${href ? ` data-open="${esc(href)}"` : ''}>${top}<div class="k-card-b"><div class="k-card-h"><b>${esc(title)}</b>${tag ? `<span class="k-tag ${toneOf(e, tag, r)}">${esc(tag)}</span>` : ''}</div>${e.text !== undefined ? `<div class="k-card-t">${h(e.text, r)}</div>` : ''}</div></div>`
    }
    if (e.each === undefined && e.items === undefined) return `<div${at({ tip: e.tip }, s, 'k-cards one')}>${one(s)}</div>`
    const items = listAt(e.each ?? e.items, s)
    return `<div${at({ tip: e.tip }, s, 'k-cards')} data-rows>${items.map((item, i) => one(inner(s, item, i))).join('')}${empty(e, s, items.length)}</div>`
  },
  image: (e, s) => (u => (imageOk(u) ? `<img${at(e, s, 'k-img')} src="${esc(u)}" alt="${h(e.alt, s)}"${(x => (x ? ` style="height:${Math.min(2000, x)}px"` : ''))(n(e.height, s))}>` : ''))(txt(e.src, s).trim()),
  button: (e, s) => button(e, s),
  actions: (e, s) => `<div${at(e, s, 'k-actions')}>${buttons(e.items, s, false)}</div>`,
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
  const s: S = { scopes: [top], full: !!o.full, single: isElement(spec), cells, line, ids: { uid: Math.random().toString(36).slice(2, 7), n: 0 } }
  const failed = !!ctx.error && (data === undefined || data === null)
  const body = failed ? `<div class="k-error"><b>${line ? '⚠' : 'Couldn’t fetch it'}</b><div class="k-sub">${esc(ctx.error)}</div><button type="button" class="k-btn sm" data-laki="refresh">Retry</button></div>` : node(tree, s)
  return `<div class="k" data-kit="${o.full ? 'full' : 'preview'}"${line ? ' data-line' : ''}>${body}</div>`
}

// ---------- what's wrong with a ui, for laki widget check, the inspector and agents: unknown elements and props,
// props of the wrong kind, actions and icons that aren't there; with data (a fixture, the last fetch), each's lists
// and the fields its rows use
export type UiProblem = { level: 'error' | 'warn' | 'ok'; where: string; text: string } // ok: a check that passed (widgetCheck's)

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
  const colorOk = (v: unknown) => typeof v !== 'string' || v.includes('{{') || !!colorCss(v)
  const NEEDS: Record<string, string> = { new: 'prompt', send: 'prompt', ai: 'prompt', terminal: 'command', browse: 'url' }
  const runs = (b: unknown, where: string) => {
    if (!obj(b)) return
    if (typeof b.run === 'string' && !b.run.includes('{{') && o.actions && !o.actions.includes(b.run)) say('error', where, `runs ${b.run}, which isn't one of widget.json's actions${mean(b.run, o.actions)}`)
    if (b.icon !== undefined && !iconOk(b.icon)) say('warn', where, `icon ${b.icon} isn't one of Laki's icons${mean(String(b.icon), Object.keys(ICON_WORDS))} or an emoji`)
    if (typeof b.do === 'string' && !b.do.includes('{{')) {
      if (!(DO as readonly string[]).includes(b.do)) say('error', where, `do: one of ${DO.join(', ')}${mean(b.do, DO)}`)
      else if (b[NEEDS[b.do]] === undefined) say('warn', where, `do ${b.do} without ${NEEDS[b.do]}: the app has nothing to ${b.do === 'browse' ? 'open' : b.do === 'terminal' ? 'run' : 'send'}`)
      if (b.run !== undefined) say('warn', where, 'both run and do: run wins')
    }
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
    for (const c of [el.color, ...(Array.isArray(el.colors) ? el.colors : []), ...(Array.isArray(el.series) ? el.series.map(x => (obj(x) ? x.color : undefined)) : [])]) if (!colorOk(c)) say('warn', here, `color ${c}: a tone (${TONES.join(', ')}), one of ${COLORS.join(', ')}, or a hex${mean(String(c), [...TONES, ...COLORS])}`)
    if (type === 'button') runs(el, here)
    if (type === 'form') runs(el.submit, `${here}.submit`)
    for (const k of ['action', 'submit']) if (obj(el[k]) && type !== 'form') runs(el[k], `${here}.${k}`)
    for (const k of ['actions', 'items'] as const) if (UI[type as UiType].props[k as never] && (UI[type as UiType].props as Record<string, Prop>)[k].kind === 'buttons') (Array.isArray(el[k]) ? (el[k] as unknown[]) : []).forEach((b, i) => runs(b, `${here}.${k}[${i}]`))
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
          const skip = new Set(['each', 'items', 'empty', 'limit', 'filter', 'sort', 'kind', 'height', 'min', 'max', 'label', 'unit', 'if', 'unless', 'tip', 'series', 'colors', 'legend', 'rows', 'count'])
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
// twelve weeks of activity, the heatmap's sample
const DAYS = Array.from({ length: 84 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 27 + i)).toISOString().slice(0, 10), n: i % 7 > 4 ? (i * 3) % 2 : ((i * 37) % 11) % 6 }))
const SAMPLES: Record<UiType, { spec: UiElement; data?: unknown }> = {
  stack: { spec: { type: 'stack', gap: 'sm', children: [{ type: 'text', value: '{{repo}}', weight: 'semibold' }, { type: 'text', value: '{{open}} open · {{drafts}} drafts', muted: true }] }, data: { repo: 'acme/web', open: 6, drafts: 1 } },
  row: { spec: { type: 'row', align: 'between', children: [{ type: 'text', value: 'Deploys today' }, { type: 'badge', value: '{{n}}', tone: 'good' }] }, data: { n: 4 } },
  grid: { spec: { type: 'grid', columns: 3, children: [{ type: 'stat', value: '{{open}}', label: 'open' }, { type: 'stat', value: '{{failing}}', label: 'failing', tone: 'bad' }, { type: 'stat', value: '{{merged}}', label: 'merged', tone: 'good' }] }, data: { open: 6, failing: 1, merged: 12 } },
  section: { spec: { type: 'section', title: 'Releases', subtitle: '{{releases.length}}', collapsed: false, children: [{ type: 'tags', each: 'releases', tag: '{{this}}' }] }, data: { releases: ['v2.4.0', 'v2.3.2', 'v2.3.1'] } },
  tabs: { spec: { type: 'tabs', tabs: [{ label: 'Mine', badge: '{{mine.length}}', children: [{ type: 'list', each: 'mine', title: '{{title}}' }] }, { label: 'Team', badge: '{{team.length}}', children: [{ type: 'list', each: 'team', title: '{{title}}' }] }] }, data: { mine: [{ title: 'Fix the date picker' }], team: [{ title: 'Retry webhooks' }, { title: 'Spike: exports' }] } },
  header: { spec: { type: 'header', icon: 'github', title: '{{repo}}', subtitle: '{{open}} open pull requests', href: 'https://github.com/{{repo}}', actions: [{ icon: 'refresh', label: 'Refresh', refresh: true, style: 'quiet' }] }, data: { repo: 'acme/web', open: 6 } },
  footer: { spec: { type: 'stack', children: [{ type: 'text', value: '{{open}} open, {{failing}} failing' }, { type: 'footer', text: 'Updated {{ago updated}}', actions: [{ label: 'GitHub', icon: 'github', open: 'https://github.com/{{repo}}', style: 'quiet' }] }] }, data: { repo: 'acme/web', open: 6, failing: 1, updated: '2026-10-17T09:00:00Z' } },
  toolbar: { spec: { type: 'toolbar', align: 'end', items: [{ icon: 'refresh', label: 'Refresh', refresh: true }, { icon: 'github', label: 'Open on GitHub', open: 'https://github.com/{{repo}}' }, { icon: 'copy', label: 'Copy the repo', copy: '{{repo}}' }, { icon: 'ai', label: 'Ask Laki AI about it', do: 'ai', prompt: 'What needs my review in {{repo}}?' }] }, data: { repo: 'acme/web' } },
  spacer: { spec: { type: 'row', children: [{ type: 'text', value: 'Deploys today: {{n}}' }, { type: 'spacer' }, { type: 'button', label: 'Deploy', icon: 'ship', run: 'deploy', style: 'primary' }] }, data: { n: 4 } },
  divider: { spec: { type: 'stack', children: [{ type: 'text', value: 'Above' }, { type: 'divider' }, { type: 'text', value: 'Below', muted: true }] } },
  text: { spec: { type: 'text', value: 'Last deploy {{ago at}} by {{who}}', size: 'md', tone: { failed: 'bad' } }, data: { at: '2026-10-17T09:00:00Z', who: 'octocat' } },
  heading: { spec: { type: 'heading', value: '{{name}}', level: 2 }, data: { name: 'Production' } },
  markdown: { spec: { type: 'markdown', value: '{{notes}}' }, data: { notes: '**Shipped** the new search.\n\n- 30% faster\n- [Release notes](https://github.com/acme/web/releases)' } },
  code: { spec: { type: 'code', value: '{{cmd}}', copy: true }, data: { cmd: 'gh pr checkout 412' } },
  callout: { spec: { type: 'callout', tone: 'warn', title: 'Staging is slow', text: '{{why}}', action: { label: 'Status', open: 'https://status.example.com' } }, data: { why: 'p95 over 2 s since 09:10' } },
  icon: { spec: { type: 'row', children: [{ type: 'icon', name: 'check', color: 'good', size: 'lg' }, { type: 'icon', name: 'ciFail', color: 'bad', size: 'lg' }, { type: 'icon', name: 'clock', color: 'orange', size: 'lg' }, { type: 'icon', name: 'github', color: 'purple', size: 'lg' }, { type: 'icon', name: '🚀', size: 'lg' }] } },
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
  gauge: { spec: { type: 'gauge', value: '{{cpu}}', unit: '%', label: 'CPU', color: 'teal' }, data: { cpu: 72 } },
  heatmap: { spec: { type: 'heatmap', each: 'days', x: '{{date}}', value: '{{n}}', color: 'green' }, data: { days: DAYS } },
  status: { spec: { type: 'status', each: 'services', label: '{{name}}', state: '{{state}}', text: '{{note}}' }, data: { services: [{ name: 'API', state: 'up', note: '99.98%' }, { name: 'Web', state: 'up', note: '99.95%' }, { name: 'Workers', state: 'degraded', note: 'queue 2k' }, { name: 'Search', state: 'down', note: 'since 09:10' }] } },
  checklist: { spec: { type: 'checklist', each: 'steps', text: '{{text}}', done: 'done' }, data: { steps: [{ text: 'Write the migration', done: true }, { text: 'Backfill orders', done: true }, { text: 'Switch reads over', done: false }, { text: 'Drop the old table', done: false }] } },
  avatars: { spec: { type: 'avatars', each: 'reviewers', login: '{{this}}', max: 4 }, data: { reviewers: ['octocat', 'hubot', 'monalisa', 'defunkt', 'mojombo', 'pjhyett'] } },
  tags: { spec: { type: 'tags', each: 'labels', tag: '{{name}}', color: '{{color}}' }, data: { labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'feature', color: '0e8a16' }, { name: 'docs', color: '0075ca' }] } },
  badge: { spec: { type: 'badge', value: '{{failing}} failing', tone: 'bad', if: 'failing' }, data: { failing: 2 } },
  timeline: { spec: { type: 'timeline', each: 'events', time: '{{at}}', title: '{{what}}', text: '{{who}}', tone: { 'Deploy failed': 'bad', Deployed: 'good' } }, data: { events: [{ at: '2026-10-17T09:10:00Z', what: 'Deployed', who: 'v2.4.0 by octocat' }, { at: '2026-10-17T08:40:00Z', what: 'Deploy failed', who: 'v2.4.0-rc1' }, { at: '2026-10-16T17:00:00Z', what: 'Merged #418', who: 'hubot' }] } },
  card: { spec: { type: 'card', each: 'posts', title: '{{title}}', text: '{{blurb}}', icon: '{{icon}}', tag: '{{tag}}', href: '{{url}}', tone: { new: 'accent' } }, data: { posts: [{ title: 'Search, 30% faster', blurb: 'How we cut p95 by moving to the new index.', icon: '⚡', tag: 'new', url: 'https://example.com/blog/search' }, { title: 'Dark mode', blurb: 'The dashboard follows your system now.', icon: '🌙', tag: 'ui', url: 'https://example.com/blog/dark' }] } },
  image: { spec: { type: 'image', src: 'https://avatars.githubusercontent.com/{{login}}?s=80', alt: '{{login}}', height: 40 }, data: { login: 'octocat' } },
  button: { spec: { type: 'button', label: 'Deploy', icon: 'ship', style: 'primary', run: 'deploy', arg: '{{branch}}', confirm: 'Deploy {{branch}} to production?' }, data: { branch: 'main' } },
  actions: { spec: { type: 'actions', items: [{ label: 'Refresh', icon: 'refresh', refresh: true }, { label: 'GitHub', icon: 'github', open: 'https://github.com/{{repo}}' }, { label: 'Copy repo', copy: '{{repo}}', style: 'quiet' }] }, data: { repo: 'acme/web' } },
  links: { spec: { type: 'links', items: [{ label: 'Linear', href: 'https://linear.app' }, { label: 'Status', href: 'https://status.example.com' }, { label: 'Board', href: 'laki://board' }] } },
  form: { spec: { type: 'form', fields: [{ id: 'title', type: 'text', label: 'Title', hint: 'What broke?' }, { id: 'urgent', type: 'bool', label: 'Urgent' }, { id: 'team', type: 'choice', label: 'Team', choices: ['web', 'api'], default: 'web' }], submit: { label: 'File issue', run: 'file', confirm: 'File it on GitHub?' } } },
  empty: { spec: { type: 'empty', text: 'No deploys yet today', icon: 'ship', action: { label: 'Refresh', refresh: true } } },
}
export const UI_SAMPLES = UI_TYPES.map(type => ({ type, group: UI[type].group, blurb: UI[type].blurb, spec: SAMPLES[type].spec, data: SAMPLES[type].data }))

// ---------- more, past one per element: every chart kind, colors, Laki's commands, a note, layouts of a few elements
const LANGS = [{ name: 'TypeScript', pct: 62 }, { name: 'Go', pct: 18 }, { name: 'CSS', pct: 11 }, { name: 'Shell', pct: 6 }, { name: 'Other', pct: 3 }]
const WEEK = [{ day: 'Mon', passed: 41, failed: 3, skipped: 4, p50: 210, p95: 480, red: false }, { day: 'Tue', passed: 38, failed: 7, skipped: 2, p50: 190, p95: 440, red: true }, { day: 'Wed', passed: 45, failed: 1, skipped: 3, p50: 230, p95: 610, red: false }, { day: 'Thu', passed: 40, failed: 5, skipped: 5, p50: 200, p95: 420, red: true }, { day: 'Fri', passed: 47, failed: 0, skipped: 2, p50: 180, p95: 390, red: false }]
export const UI_EXAMPLES: { title: string; blurb: string; spec: UiElement; data?: unknown; full?: boolean }[] = [ // full: the UI kit page shows it in full first
  { title: 'Colors', full: true, blurb: 'Every color a color prop, colors or a series takes: the tones, Laki’s palette (each theme’s own), or a hex.', spec: { type: 'stack', children: [{ type: 'text', value: 'Tones', size: 'sm', muted: true }, { type: 'tags', each: 'tones', tag: '{{this}}', color: '{{this}}' }, { type: 'text', value: 'Palette', size: 'sm', muted: true }, { type: 'tags', each: 'palette', tag: '{{this}}', color: '{{this}}' }, { type: 'text', value: 'Hex', size: 'sm', muted: true }, { type: 'tags', each: 'hexes', tag: '{{this}}', color: '{{this}}' }] }, data: { tones: [...TONES], palette: [...COLORS], hexes: ['d73a4a', '0e8a16', '#0075ca'] } },
  { title: 'Lines: two series', blurb: 'A series per number of a row, each its own color, a legend.', spec: { type: 'chart', kind: 'line', each: 'week', x: '{{day}}', series: [{ label: 'p50', y: '{{p50}}', color: 'teal' }, { label: 'p95', y: '{{p95}}', color: 'orange' }], unit: ' ms', label: 'Latency' }, data: { week: WEEK } },
  { title: 'Bars, colored by row', blurb: 'One series, each bar its color: a template over the row.', spec: { type: 'chart', kind: 'bars', each: 'week', x: '{{day}}', y: '{{failed}}', color: '{{#if red}}red{{else}}green{{/if}}', label: 'Failed tests' }, data: { week: WEEK } },
  { title: 'Stacked bars', blurb: 'Series one on another: a total per row.', spec: { type: 'chart', kind: 'stacked', each: 'week', x: '{{day}}', series: [{ label: 'passed', y: '{{passed}}', color: 'green' }, { label: 'failed', y: '{{failed}}', color: 'red' }, { label: 'skipped', y: '{{skipped}}', color: 'gray' }], label: 'Test runs' }, data: { week: WEEK } },
  { title: 'Horizontal bars', blurb: 'A bar per row with its label and number: rankings, shares.', spec: { type: 'chart', kind: 'hbars', each: 'langs', x: '{{name}}', y: '{{pct}}', unit: '%', label: 'Languages' }, data: { langs: LANGS } },
  { title: 'Pie', blurb: 'Shares of a whole, a legend beside it.', spec: { type: 'chart', kind: 'pie', each: 'langs', x: '{{name}}', y: '{{pct}}', unit: '%', colors: ['blue', 'teal', 'purple', 'yellow', 'gray'] }, data: { langs: LANGS } },
  { title: 'Donut', blurb: 'A pie with its total in the middle.', spec: { type: 'chart', kind: 'donut', each: 'tickets', x: '{{state}}', y: '{{n}}', label: 'tickets', tone: { open: 'warn', closed: 'good', blocked: 'bad' } }, data: { tickets: [{ state: 'open', n: 14 }, { state: 'closed', n: 31 }, { state: 'blocked', n: 3 }] } },
  { title: 'Scatter', blurb: 'Dots by two numbers: x across, y up.', spec: { type: 'chart', kind: 'scatter', each: 'builds', x: '{{files}}', y: '{{secs}}', unit: ' s', label: 'Build time by files changed', colors: ['purple'] }, data: { builds: [{ files: 3, secs: 41 }, { files: 12, secs: 58 }, { files: 7, secs: 47 }, { files: 30, secs: 96 }, { files: 18, secs: 70 }, { files: 2, secs: 39 }, { files: 24, secs: 81 }] } },
  { title: 'Header, body, footer', blurb: 'A card of a few elements: a title bar with buttons, numbers, a footer.', spec: { type: 'stack', children: [{ type: 'header', icon: 'pr', color: 'purple', title: 'Pull requests', subtitle: '{{repo}}', actions: [{ icon: 'refresh', label: 'Refresh', refresh: true, style: 'quiet' }, { icon: 'github', label: 'GitHub', open: 'https://github.com/{{repo}}/pulls', style: 'quiet' }] }, { type: 'stats', items: [{ value: '{{open}}', label: 'open' }, { value: '{{failing}}', label: 'failing', tone: 'bad' }, { value: '{{approved}}', label: 'approved', tone: 'good' }] }, { type: 'footer', text: 'Updated {{ago updated}}', actions: [{ label: 'Review the next', do: 'new', prompt: 'Review the oldest open PR of {{repo}}', style: 'quiet' }] }] }, data: { repo: 'acme/web', open: 6, failing: 1, approved: 2, updated: '2026-10-17T09:00:00Z' } },
  { title: 'Laki commands', blurb: 'Buttons that ask Laki: a new workspace, a prompt to the agent or Laki AI, a terminal, a browser tab. The app shows what and asks first.', spec: { type: 'grid', columns: 2, children: [{ type: 'button', label: 'Fix the flaky test', icon: 'agent', do: 'new', prompt: 'Find and fix the flaky test in {{suite}}' }, { type: 'button', label: 'Ask the agent', icon: 'run', do: 'send', prompt: 'Run the tests and tell me what fails' }, { type: 'button', label: 'Ask Laki AI', icon: 'ai', do: 'ai', prompt: 'Which of my workspaces need me?' }, { type: 'button', label: 'Tail the logs', icon: 'terminal', do: 'terminal', command: 'tail -f log/development.log' }, { type: 'button', label: 'Open staging', icon: 'globe', do: 'browse', url: 'https://staging.example.com' }, { type: 'button', label: 'Copy the URL', icon: 'copy', copy: 'https://staging.example.com', style: 'quiet' }] }, data: { suite: 'checkout' } },
  { title: 'A Markdown note', full: true, blurb: 'Formatted text: headings, lists, tasks, a table, code, links and https pictures.', spec: { type: 'markdown', value: '{{text}}' }, data: { text: '## On call this week\n\n![octocat](https://avatars.githubusercontent.com/octocat?s=48) **@octocat**, then **@hubot**.\n\n- [x] Rotate the API keys\n- [ ] Renew the TLS cert (`staging`)\n\n| Service | Owner |\n|---|---|\n| API | octocat |\n| Web | hubot |\n\nRunbook: [wiki/oncall](https://example.com/wiki/oncall)' } },
  { title: 'A status page', blurb: 'A header, each service’s state colored by its word, a callout for the worst.', spec: { type: 'stack', children: [{ type: 'header', icon: 'server', title: 'Production', subtitle: '{{services.length}} services' }, { type: 'callout', if: 'incident', tone: 'bad', title: '{{incident}}', action: { label: 'Fix it', icon: 'agent', do: 'new', prompt: 'Look into: {{incident}}' } }, { type: 'status', each: 'services', label: '{{name}}', state: '{{state}}' }] }, data: { incident: 'Search is down since 09:10', services: [{ name: 'API', state: 'up' }, { name: 'Workers', state: 'degraded' }, { name: 'Search', state: 'down' }] } },
  { title: 'Gauges in a grid', blurb: 'A few dials side by side, each its color.', spec: { type: 'grid', columns: 3, children: [{ type: 'gauge', value: '{{cpu}}', unit: '%', label: 'CPU', color: 'teal' }, { type: 'gauge', value: '{{mem}}', unit: '%', label: 'Memory', color: 'purple' }, { type: 'gauge', value: '{{disk}}', unit: '%', label: 'Disk', color: '{{#if full}}bad{{else}}blue{{/if}}' }] }, data: { cpu: 42, mem: 68, disk: 91, full: true } },
]
