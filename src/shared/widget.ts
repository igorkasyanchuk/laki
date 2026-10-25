// Widgets' templates (daemon/widgets.ts renders them, the CLI and tests too): HTML with {{…}} filled from the widget's
// stored JSON. {{a.b}} (escaped; a list's .length), {{#each a}}…{{else}}…{{/each}} (inside: the item's fields, this,
// @index), {{#if a}}…{{else}}…{{/if}}, {{#unless a}}…{{/unless}} (an empty list is false), and helpers: {{date a}},
// {{ago a}}, {{spark a}} (a line chart of numbers, as SVG), {{num a}} (1.2k), {{pct a}} (42%), {{bytes a}} (1.5 KB),
// {{dur a}} (ms as 2m 3s), {{upper a}}, {{lower a}}. No other code runs: the app shows the result as HTML.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (v: unknown) => (v === undefined || v === null ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/[&<>"']/g, c => ESC[c]))

type Node = string | { tag: string; arg: string; body: Node[]; alt: Node[] } | { get: string }
const BLOCKS = new Set(['each', 'if', 'unless'])

// parsed once: the UI kit fills the same props for every row
const parsed = new Map<string, Node[]>()
function parseOnce(src: string): Node[] {
  let n = parsed.get(src)
  if (!n) {
    if (parsed.size > 2000) parsed.clear() // ponytail: the whole cache goes past 2000 templates, an LRU if that ever shows
    parsed.set(src, (n = parse(src)))
  }
  return n
}

function parse(src: string): Node[] {
  const root: Node[] = []
  const stack: { tag: string; body: Node[]; alt: Node[]; inAlt: boolean; node: Node }[] = []
  const into = () => (stack.length ? (stack.at(-1)!.inAlt ? stack.at(-1)!.alt : stack.at(-1)!.body) : root)
  const re = /\{\{\s*([#/]?)([^{}]*?)\s*\}\}/g
  let last = 0
  for (let m; (m = re.exec(src)); last = re.lastIndex) {
    if (m.index > last) into().push(src.slice(last, m.index))
    const [, mark, inner] = m
    const [tag, ...rest] = inner.split(/\s+/)
    if (mark === '#' && !BLOCKS.has(tag)) throw new Error(`no block {{#${tag}}}: each, if or unless`)
    if (mark === '#') {
      const node = { tag, arg: rest.join(' '), body: [] as Node[], alt: [] as Node[] }
      into().push(node)
      stack.push({ tag, body: node.body, alt: node.alt, inAlt: false, node })
    } else if (mark === '/') {
      if (stack.at(-1)?.tag !== tag) throw new Error(`{{/${tag}}} doesn't close ${stack.length ? `{{#${stack.at(-1)!.tag}}}` : 'anything'}`)
      stack.pop()
    } else if (!mark && inner === 'else' && stack.length) stack.at(-1)!.inAlt = true
    else into().push({ get: inner })
  }
  if (last < src.length) into().push(src.slice(last))
  if (stack.length) throw new Error(`{{#${stack.at(-1)!.tag}}} isn't closed`)
  return root
}

// a dotted path, looked up in the innermost scope that has its first part
function lookup(scopes: Record<string, unknown>[], path: string): unknown {
  if (path === 'this') return scopes[0].this
  const [head, ...rest] = path.split('.')
  const scope = scopes.find(s => s && typeof s === 'object' && Object.hasOwn(s, head))
  let v: any = scope?.[head]
  for (const k of rest) v = v !== null && v !== undefined && (Object.hasOwn(Object(v), k) || (k === 'length' && Array.isArray(v))) ? v[k] : undefined
  return v
}

// a prop the UI kit reads as a path (each, items, a chart's values): looked up raw, {{braces}} or not; anything else
// (a list written in widget.json) is itself
export const valueAt = (path: unknown, scopes: Record<string, unknown>[]) => (typeof path === 'string' ? lookup(scopes, path.trim().replace(/^\{\{\s*([^{}]*?)\s*\}\}$/, '$1')) : path)

export const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v)

export const date = (v: unknown) => {
  const d = new Date(v as string)
  return isNaN(+d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
export function ago(v: unknown, now = Date.now()) {
  const t = +new Date(v as string)
  if (isNaN(t)) return ''
  const s = Math.max(0, (now - t) / 1000)
  const [n, unit] = s < 60 ? [0, ''] : s < 3600 ? [s / 60, 'minute'] : s < 86400 ? [s / 3600, 'hour'] : s < 86400 * 30 ? [s / 86400, 'day'] : s < 86400 * 365 ? [s / 86400 / 30, 'month'] : [s / 86400 / 365, 'year']
  return unit ? `${Math.floor(n)} ${unit}${Math.floor(n) === 1 ? '' : 's'} ago` : 'just now'
}
// numbers (or objects' .value) as a line across a 100×30 box, stretched to the width it's given
export function spark(v: unknown) {
  const ns = (Array.isArray(v) ? v : []).map(x => Number(x && typeof x === 'object' ? (x as any).value : x)).filter(Number.isFinite)
  if (!ns.length) return ''
  const lo = Math.min(...ns)
  const span = Math.max(...ns) - lo || 1
  const pts = ns.map((n, i) => `${ns.length === 1 ? 50 : ((i / (ns.length - 1)) * 100).toFixed(1)},${(28 - ((n - lo) / span) * 26).toFixed(1)}`).join(' ')
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height="30"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`
}
const trim1 = (n: number) => n.toFixed(1).replace(/\.0$/, '')
const isNum = (v: unknown) => v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v))
// 1234 → 1.2k, 1500000 → 1.5M
export const num = (v: unknown) => {
  if (!isNum(v)) return ''
  const n = Number(v)
  const a = Math.abs(n)
  return a >= 1e9 ? `${trim1(n / 1e9)}B` : a >= 1e6 ? `${trim1(n / 1e6)}M` : a >= 1e3 ? `${trim1(n / 1e3)}k` : String(Math.round(n * 100) / 100)
}
// 0.42 or 42 → 42% (a fraction up to 1, else a percentage already)
export const pct = (v: unknown) => {
  if (!isNum(v)) return ''
  const n = Math.abs(Number(v)) <= 1 ? Number(v) * 100 : Number(v)
  return `${Math.abs(n) < 10 && !Number.isInteger(n) ? trim1(n) : Math.round(n)}%`
}
export const bytes = (v: unknown) => {
  if (!isNum(v)) return ''
  let n = Number(v)
  let u = 0
  while (Math.abs(n) >= 1024 && u < 4) (n /= 1024), u++
  return u ? `${trim1(n)} ${['B', 'KB', 'MB', 'GB', 'TB'][u]}` : `${n} B`
}
// ms → 450 ms, 45s, 2m 3s, 1h 2m, 3d 4h
export const dur = (v: unknown) => {
  if (!isNum(v)) return ''
  const ms = Math.abs(Number(v))
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  const [d, h, m] = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60)]
  return d ? `${d}d${h ? ` ${h}h` : ''}` : h ? `${h}h${m ? ` ${m}m` : ''}` : m ? `${m}m${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`
}
// plain text, escaped where it goes into HTML; spark is SVG (nothing in plain text)
const HELPERS: Record<string, (v: unknown) => string> = { date, ago: v => ago(v), num, pct, bytes, dur, upper: v => (v == null ? '' : String(v).toUpperCase()), lower: v => (v == null ? '' : String(v).toLowerCase()), spark }
const plainOf = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

// text: plain text (the UI kit's props, escaped by it), not HTML
function run(nodes: Node[], scopes: Record<string, unknown>[], text = false): string {
  let out = ''
  for (const n of nodes) {
    if (typeof n === 'string') out += n
    else if ('get' in n) {
      const [a, b] = n.get.split(/\s+/)
      if (b !== undefined && Object.hasOwn(HELPERS, a)) out += a === 'spark' ? (text ? '' : spark(lookup(scopes, b))) : text ? HELPERS[a](lookup(scopes, b)) : esc(HELPERS[a](lookup(scopes, b)))
      else out += text ? plainOf(lookup(scopes, n.get)) : esc(lookup(scopes, n.get))
    } else {
      const v = lookup(scopes, n.arg)
      if (n.tag === 'each') {
        const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []
        out += list.length ? list.map((item, i) => run(n.body, [{ ...(item && typeof item === 'object' ? item : {}), this: item, '@index': i }, ...scopes], text)).join('') : run(n.alt, scopes, text)
      } else out += run(truthy(v) === (n.tag === 'if') ? n.body : n.alt, scopes, text)
    }
  }
  return out
}

export const render = (template: string, ctx: Record<string, unknown>) => run(parseOnce(template), [ctx])
// a template as plain text, over scopes (the innermost first): the UI kit's props
export const fill = (template: string, scopes: Record<string, unknown>[]) => run(parseOnce(template), scopes, true)
// why a template doesn't read (an unclosed {{#each}}…), or nothing: dev mode keeps the last good version over it
export function templateError(src: string) {
  try {
    parse(src)
  } catch (e) {
    return (e as Error).message
  }
}

// a widget's HTML file: <template preview>…</template> is what the sidebar shows, <template full>…</template> what
// opens on a click (none: no full view); what's outside both (a <style>) goes with either. No templates: it's all
// the preview.
// A view ends at its own </template>: one inside it (a JS widget's row template) nests.
export function viewOf(html: string, full: boolean): string | undefined {
  const parts: Record<string, string> = {}
  let shared = ''
  let at = 0
  const start = /<template\s+(preview|full)\s*>/gi
  for (let m; (m = start.exec(html)); ) {
    shared += html.slice(at, m.index)
    const tags = /<(\/?)template\b[^>]*>/gi
    tags.lastIndex = start.lastIndex
    let depth = 1
    let t: RegExpExecArray | null = null
    while (depth && (t = tags.exec(html))) depth += t[1] ? -1 : 1
    parts[m[1].toLowerCase()] = html.slice(start.lastIndex, depth ? html.length : t!.index)
    at = start.lastIndex = depth ? html.length : tags.lastIndex
  }
  shared += html.slice(at)
  if (!Object.keys(parts).length) return full ? undefined : html
  const body = parts[full ? 'full' : 'preview']
  return body === undefined ? undefined : shared + body
}
export const hasFull = (html: string) => /<template\s+full\s*>/i.test(html)
export const hasScript = (html: string) => /<script\b/i.test(html)

// the UI kit's elements (widgetUi.ts): only the theme's variables and these fallbacks, so they read in every theme.
// .k is a container: an element adapts to the cells it has (1 to 4 across); data-line: a bar's line (½ high)
export const UI_CSS = `.k { container: kit / inline-size; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
:host-context(.widget.fit) .k, html.laki-measure .k { container-type: normal; } /* a bar's Auto: its content's width (an inline-size container has none); a JS page's as pageOf measures it */
.k [hidden] { display: none !important; }
.k[data-kit=preview] { height: 100%; gap: 6px; padding: 4px 6px; overflow: hidden; }
.k[data-line] { flex-direction: row; align-items: center; gap: 8px; padding: 0 6px; white-space: nowrap; }
.k .k-icon, .k .k-emoji { flex: none; display: inline-block; vertical-align: -2px; line-height: 1; }
.t-good { color: var(--done, #9ece6a); } .t-bad { color: var(--error, #f7768e); } .t-warn { color: var(--waiting, #e0af68); } .t-accent { color: var(--accent, #7aa2f7); } .t-muted { color: var(--muted, #7a8294); }
.k-stack { display: flex; flex-direction: column; min-width: 0; } .k-row { display: flex; align-items: center; min-width: 0; } .k-row > * { min-width: 0; } .k-row.wrap { flex-wrap: wrap; }
.g-sm { gap: 4px; } .g-md { gap: 8px; } .g-lg { gap: 14px; } .a-start { align-items: flex-start; } .a-center { align-items: center; } .a-end { align-items: flex-end; } .a-between { justify-content: space-between; }
.k-grid { display: grid; gap: 8px; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); min-width: 0; }
@container kit (max-width: 300px) { .k-grid.c-4, .k-grid.c-5, .k-grid.c-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container kit (max-width: 200px) { .k-grid.c-3, .k-grid.c-4, .k-grid.c-5, .k-grid.c-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container kit (max-width: 110px) { .k-grid { grid-template-columns: minmax(0, 1fr); } }
.k-section { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 0; }
.k-sh { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; } .k-sh .k-sub { font-weight: 400; }
details.k-section > summary { cursor: pointer; list-style: none; } details.k-section > summary::-webkit-details-marker { display: none; }
details.k-section > summary::before { content: '›'; display: inline-block; width: 10px; color: var(--muted, #7a8294); transition: transform 0.15s; } details.k-section[open] > summary::before { transform: rotate(90deg); }
.k-tabs { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.k-tabbar { display: flex; gap: 2px; border-bottom: 1px solid var(--line, #232833); overflow-x: auto; scrollbar-width: none; }
.k-tabbar label { position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; margin-bottom: -1px; border-bottom: 2px solid transparent; color: var(--muted, #7a8294); white-space: nowrap; cursor: pointer; }
.k-tabbar label:hover { color: var(--fg, #d5d9e3); } .k-tabbar input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.k-tabbar label:has(input:checked) { color: var(--fg, #d5d9e3); border-bottom-color: var(--accent, #7aa2f7); } .k-tabbar label:has(input:focus-visible) { outline: 1px solid var(--accent, #7aa2f7); }
.k-tabs > .k-panel { display: none; flex-direction: column; gap: 8px; min-width: 0; margin: 0; }
${[1, 2, 3, 4, 5, 6, 7, 8].map(i => `.k-tabs:has(> .k-tabbar > label:nth-child(${i}) input:checked) > .k-panel:nth-of-type(${i})`).join(', ')} { display: flex; }
.k-hr { border: 0; border-top: 1px solid var(--line, #232833); margin: 2px 0; width: 100%; }
.k-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-text.wrap { white-space: normal; overflow-wrap: anywhere; }
.s-sm { font-size: 11px; } .s-lg { font-size: 15px; } .s-xl { font-size: 22px; font-weight: 600; line-height: 1.15; } .w-medium { font-weight: 500; } .w-semibold { font-weight: 600; } .w-bold { font-weight: 700; }
.k .mono { font-family: var(--mono, ui-monospace, Menlo, monospace); font-size: 11.5px; }
.k-h { margin: 0; font-weight: 600; line-height: 1.25; } h1.k-h { font-size: 17px; } h2.k-h { font-size: 14px; } h3.k-h { font-size: 12px; color: var(--muted, #7a8294); }
.k-md { line-height: 1.5; overflow-wrap: anywhere; min-width: 0; } .k-md > :last-child { margin-bottom: 0; } .k-md :is(p, ul, ol, blockquote, pre, .tw) { margin: 0 0 8px; } .k-md :is(ul, ol) { padding-left: 18px; }
.k-md :is(h1, h2, h3, h4, h5, h6) { margin: 4px 0 6px; font-size: 13px; } .k-md h1 { font-size: 15px; } .k-md blockquote { padding-left: 10px; border-left: 2px solid var(--line, #232833); color: var(--muted, #7a8294); }
.k-md li:has(> input[type=checkbox]) { list-style: none; margin-left: -16px; } .k-md li > input[type=checkbox] { margin: 0 6px 0 0; vertical-align: -1px; } .k-md li > input[type=checkbox] + p { display: inline; } .k-md li > p { margin: 0; } .k-md img { max-height: 240px; vertical-align: middle; }
.k-md code { font: 11px var(--mono, ui-monospace, Menlo, monospace); padding: 0 3px; border-radius: 3px; background: var(--hover, #1b2029); } .k-md pre { padding: 8px 10px; overflow: auto; border-radius: var(--radius, 6px); background: var(--hover, #1b2029); } .k-md pre code { padding: 0; background: none; } .k-md .tw { overflow-x: auto; } .k-md img { max-width: 100%; }
.k-code { position: relative; min-width: 0; } .k-code pre { margin: 0; padding: 8px 10px; overflow: auto; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--hover, #1b2029); font: 11.5px/1.45 var(--mono, ui-monospace, Menlo, monospace); } .k-code > .k-copy { position: absolute; top: 4px; right: 4px; }
.k-copy { padding: 0 5px; font-size: 10px; line-height: 16px; } .k-copy .k-icon { vertical-align: -3px; }
.k-stat { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1px; min-width: 0; text-align: center; }
.k > .k-stat, .k[data-kit=preview] > .k-stack:only-child, .k[data-kit=preview] > .k-stack:only-child > :only-child { flex: 1; } .k-stat .k-v { display: inline-flex; align-items: baseline; gap: 6px; font-size: 24px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.k-stat .k-l { display: flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; color: var(--muted, #7a8294); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } .k-stat .k-icon { color: var(--muted, #7a8294); }
.k-delta { font-size: 11px; font-weight: 500; } .k-stat .k-spark { align-self: stretch; } .k-dotc { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--muted, #7a8294); }
@container kit (max-width: 110px) { .k-stat .k-v { font-size: 20px; } }
.k-stats { display: flex; flex-wrap: wrap; align-content: center; gap: 0 10px; min-width: 0; } .k > .k-stats { flex: 1; overflow: hidden; }
.k-stats .k-stat { flex-direction: row; align-items: baseline; gap: 4px; white-space: nowrap; } .k-stats .k-v { font-size: 17px; } .k-stats .k-l { max-width: 60px; } .k-stats .k-dotc { align-self: center; }
.k[data-kit=full] .k-stats { gap: 4px 22px; } .k[data-kit=full] .k-stats .k-v { font-size: 26px; } .k[data-kit=full] .k-stats .k-l { max-width: none; font-size: 12px; }
.k[data-line] .k-stat { flex-direction: row; align-items: baseline; gap: 4px; } .k[data-line] .k-v { font-size: 13px; } .k[data-line] .k-stats { flex-wrap: nowrap; overflow: hidden; } .k[data-line] .k-stat .k-spark { display: none; }
.k-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 12px; align-items: baseline; margin: 0; min-width: 0; } .k-kv > div { display: contents; }
.k-kv dt { color: var(--muted, #7a8294); white-space: nowrap; } .k-kv dd { display: flex; align-items: center; gap: 4px; min-width: 0; margin: 0; overflow: hidden; white-space: nowrap; } .k-kv dd > span { overflow: hidden; text-overflow: ellipsis; }
@container kit (max-width: 140px) { .k-kv { grid-template-columns: minmax(0, 1fr); gap: 0; } .k-kv dd { margin-bottom: 4px; } }
.k-list, .k-table { display: flex; flex-direction: column; min-width: 0; }
.k-li { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 26px; padding: 3px 2px; } .k-li + .k-li { border-top: 1px solid var(--line, #232833); }
.k-li[data-open] { cursor: pointer; } .k-li[data-open]:hover { background: var(--hover, #1b2029); } .k-li > .k-icon, .k-li > .k-emoji { color: var(--muted, #7a8294); }
.k-main { display: flex; flex: 1; flex-direction: column; min-width: 0; } .k-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k-sub { overflow: hidden; color: var(--muted, #7a8294); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.k-acc { display: flex; flex: none; align-items: center; gap: 6px; color: var(--muted, #7a8294); font-size: 11px; } .k-acts { display: flex; flex: none; gap: 4px; }
.k-av { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--hover, #1b2029); object-fit: cover; } .k-img { display: block; max-width: 100%; border-radius: var(--radius, 6px); object-fit: contain; }
.k-group { display: flex; flex-direction: column; min-width: 0; } .k-gh { display: flex; align-items: baseline; gap: 6px; padding: 10px 2px 2px; font-weight: 600; } .k-list > .k-group:first-child > .k-gh, .k-filter + .k-group > .k-gh { padding-top: 0; }
.k-more { align-self: flex-start; margin-top: 2px; padding: 1px 4px; border: 0; background: none; color: var(--accent, #7aa2f7); font-size: 11px; cursor: pointer; } .k-more:hover { text-decoration: underline; }
.k input:not([type=checkbox]):not([type=radio]), .k select, .k textarea { width: 100%; min-width: 0; padding: 4px 8px; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: transparent; color: inherit; font: inherit; }
.k-filter { margin-bottom: 6px; }
@container kit (max-width: 170px) { .k-acc, .k-acts, .k-sub { display: none; } }
.k-table { overflow-x: auto; } .k-table table { min-width: 100%; } .k-table :is(th, td) { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-table :is(th, td).wrap { white-space: normal; overflow-wrap: anywhere; }
.k[data-kit=preview] .k-table :is(th, td) { padding: 3px 6px; } .k-table .al-right { text-align: right; } .k-table .al-center { text-align: center; } .k-table tr[data-open] { cursor: pointer; } .k-table tr[data-open]:hover td { background: var(--hover, #1b2029); }
@container kit (max-width: 360px) { .k-table .hide-narrow { display: none; } }
.k[data-line] .k-table thead, .k[data-line] :is(.k-gh, .k-filter, .k-more, .k-sh, .k-ch-head, .k-ch-axis, .k-legend) { display: none; } .k[data-line] .k-stack { flex-direction: row; align-items: center; } .k[data-line] .k-stack > :is(.k-row, .k-chl) { flex-shrink: 0; } /* their min-width 0 would let a bar's line squeeze them to nothing, the words over the next */ .k[data-line] .k-table :is(th, td) { padding: 0 6px; border: 0; }
.k-chart { display: flex; flex-direction: column; gap: 2px; min-width: 0; color: var(--accent, #7aa2f7); } .k > .k-chart { flex: 1; }
.k-ch-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--muted, #7a8294); font-size: 11px; } .k-ch-head b { margin-left: auto; color: var(--fg, #d5d9e3); font-variant-numeric: tabular-nums; }
.k-ch-body { display: flex; flex: 1; gap: 4px; min-height: 0; } .k-ch-axis { display: flex; flex-direction: column; justify-content: space-between; color: var(--muted, #7a8294); font-size: 9.5px; line-height: 1; text-align: right; font-variant-numeric: tabular-nums; }
.k-ch-plot { position: relative; flex: 1; min-width: 0; } .k-ch-plot svg { display: block; width: 100%; height: 100%; overflow: visible; } .k-ch-plot .grid { stroke: var(--line, #232833); }
.k-ch-dot { position: absolute; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 2px var(--bg, #0f1117); pointer-events: none; }
.k-legend { display: flex; flex-wrap: wrap; gap: 2px 10px; color: var(--muted, #7a8294); font-size: 10.5px; } .k-legend span { display: inline-flex; align-items: center; gap: 4px; } .k-legend i { width: 8px; height: 2px; border-radius: 1px; background: currentColor; }
@container kit (max-width: 120px) { .k-ch-axis { display: none; } }
.k-spark { min-width: 0; color: var(--accent, #7aa2f7); }
.k-prog { display: flex; flex-direction: column; gap: 3px; min-width: 0; color: var(--accent, #7aa2f7); } .k-prog-h { display: flex; justify-content: space-between; gap: 8px; color: var(--muted, #7a8294); font-size: 11px; } .k-prog-h b { color: var(--fg, #d5d9e3); font-weight: 600; font-variant-numeric: tabular-nums; }
.k-bar { height: 6px; overflow: hidden; border-radius: 3px; background: var(--hover, #1b2029); box-shadow: inset 0 0 0 1px var(--line, #232833); } .k-bar > i { display: block; height: 100%; border-radius: 3px; background: currentColor; }
.k-prog.ring { flex-direction: row; align-items: center; gap: 8px; } .k-prog.ring svg { flex: none; } .k-prog.ring .bg { stroke: var(--hover, #1b2029); } .k-prog.ring .fg { stroke: currentColor; } .k[data-line] .k-prog { flex: 1; flex-direction: row; align-items: center; } .k[data-line] .k-bar { flex: 1; }
.k-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; } .k[data-line] .k-tags { flex-wrap: nowrap; overflow: hidden; }
.k-tag { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; padding: 0 7px; border: 1px solid var(--line, #232833); border-radius: 9px; font-size: 10.5px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.k-tag:is(.t-good, .t-bad, .t-warn, .t-accent) { border-color: color-mix(in srgb, currentColor 45%, transparent); }
.k-badge { display: inline-block; width: fit-content; min-width: 16px; padding: 0 5px; border-radius: 8px; background: var(--accent, #7aa2f7); color: var(--accent-fg, #fff); font-size: 10.5px; font-weight: 600; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.k-badge:is(.t-good, .t-bad, .t-warn, .t-muted) { background: color-mix(in srgb, currentColor 18%, transparent); }
.k-tl { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; min-width: 0; } .k-tl > li { position: relative; display: flex; gap: 8px; min-width: 0; padding: 0 0 10px 16px; }
.k-tl > li::before { content: ''; position: absolute; top: 13px; bottom: -1px; left: 4px; border-left: 1px solid var(--line, #232833); } .k-tl > li:last-child::before { display: none; } .k-tl > li:last-child { padding-bottom: 0; }
.k-tl-dot { position: absolute; top: 4px; left: 0; width: 9px; height: 9px; border-radius: 50%; background: currentColor; color: var(--muted, #7a8294); } .k-tl-dot:is(.t-good, .t-bad, .t-warn, .t-accent) { color: inherit; } .k-tl-dot.t-good { color: var(--done, #9ece6a); } .k-tl-dot.t-bad { color: var(--error, #f7768e); } .k-tl-dot.t-warn { color: var(--waiting, #e0af68); } .k-tl-dot.t-accent { color: var(--accent, #7aa2f7); }
.k-tl-h { display: flex; align-items: baseline; gap: 8px; min-width: 0; } .k-tl-h b { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; } .k-time { flex: none; margin-left: auto; color: var(--muted, #7a8294); font-size: 11px; white-space: nowrap; }
.k-btn { display: inline-flex; width: fit-content; align-items: center; gap: 5px; white-space: nowrap; } .k[data-kit=preview] .k-btn { padding: 1px 8px; font-size: 11px; } .k-actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.k-form { display: flex; flex-direction: column; gap: 8px; min-width: 0; } .k-field { display: flex; flex-direction: column; gap: 3px; } .k-field > span { color: var(--muted, #7a8294); font-size: 11px; } .k-hint { color: var(--muted, #7a8294); font-size: 10.5px; }
.k-check { display: flex; align-items: center; gap: 6px; } .k-form-foot { display: flex; justify-content: flex-end; }
.k-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px; color: var(--muted, #7a8294); text-align: center; } .k[data-line] .k-empty { flex-direction: row; padding: 0; }
.k-error { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 6px; text-align: center; } .k-error b { color: var(--error, #f7768e); } .k-error .k-sub { white-space: normal; }
.k[data-line] .k-error { flex-direction: row; padding: 0; } .k[data-line] .k-error .k-sub { white-space: nowrap; }
.k-chip-err { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; padding: 0 6px; border: 1px dashed currentColor; border-radius: 9px; color: var(--error, #f7768e); font-size: 10.5px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.k-mock { position: absolute; top: 2px; right: 2px; padding: 0 5px; border-radius: 7px; background: var(--waiting, #e0af68); color: var(--bg, #0f1117); font-size: 9px; font-weight: 600; line-height: 13px; pointer-events: none; }
.k[data-line] .k-md > :not(:first-child), .k[data-line] .k-code > .k-copy { display: none; } .k[data-line] .k-md > * { margin: 0; overflow: hidden; text-overflow: ellipsis; } .k[data-line] .k-md :is(ul, ol) { padding: 0; list-style: none; } .k[data-line] .k-code pre { padding: 0 6px; } .k[data-line] .k-stat { flex: none; }
.k:not([data-line]) .k-table :is(th, td):first-child:not(.wrap) { width: 100%; max-width: 0; } .k[data-line] .k-kv { display: flex; gap: 6px; overflow: hidden; } .k[data-line] .k-kv :is(dt, dd) { flex: none; margin: 0; } .k[data-line] .k-chart { flex: 1; flex-direction: row; align-items: center; } .k[data-line] .k-ch-body { flex: 1; height: 16px; } .k[data-line] .k-ch-dot { display: none; }
.k[data-line] .k-actions { flex-wrap: nowrap; overflow: hidden; } .k[data-line] .k-links { flex-wrap: nowrap; overflow: hidden; } .k[data-line] .k-links > * { flex: none; } .k[data-line] .k-empty > div { min-width: 0; overflow: hidden; text-overflow: ellipsis; } .k[data-line] .k-btn { flex: none; } .k[data-line] .k-form { flex-direction: row; align-items: center; } .k[data-line] .k-form > :is(.k-field, .k-check) { display: none; } .k[data-line] .k-hr { flex: none; width: 1px; height: 12px; margin: 0; border-top: 0; border-left: 1px solid var(--line, #232833); } .k[data-line] .k-tabbar { display: none; } .k[data-line] :is(.k-tabs, .k-tabs > .k-panel) { flex-direction: row; align-items: center; }
.k[data-line] .k-grid { display: flex; gap: 8px; overflow: hidden; } .k[data-line] .k-grid > * { flex: none; }
.k-header { display: flex; align-items: center; gap: 8px; min-width: 0; } .k-hd-i { flex: none; display: inline-flex; color: var(--accent, #7aa2f7); } .k-hd-t { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; } .k-hd-t a { color: inherit; text-decoration: none; } .k-hd-t a:hover { text-decoration: underline; }
.k-footer { display: flex; align-items: center; gap: 8px; min-width: 0; margin-top: auto; padding-top: 6px; border-top: 1px solid var(--line, #232833); color: var(--muted, #7a8294); font-size: 11px; } .k-ft-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k-toolbar { display: flex; flex-wrap: wrap; gap: 2px; min-width: 0; } .k-toolbar.a-end { justify-content: flex-end; } .k-toolbar.a-between { justify-content: space-between; } .k .k-btn.bare { padding: 3px 5px; } .k-spacer { flex: 1; min-width: 0; }
.k-callout { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding: 7px 10px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: var(--radius, 6px); background: color-mix(in srgb, currentColor 9%, transparent); } .k-callout > .k-icon, .k-callout > .k-emoji { margin-top: 2px; } .k-callout > .k-main { color: var(--fg, #d5d9e3); } .k-co-t { color: var(--muted, #7a8294); font-size: 11px; overflow-wrap: anywhere; } .k-callout > .k-btn { flex: none; align-self: center; }
.k-ic { display: inline-flex; align-items: center; }
.k-gauge { display: flex; flex-direction: column; align-items: center; min-width: 0; color: var(--accent, #7aa2f7); } .k-ga-c { position: relative; width: 100%; max-width: 150px; } .k[data-kit=preview] .k-ga-c { max-width: 84px; } .k-ga-c svg { display: block; width: 100%; height: auto; } .k-gauge .bg { stroke: var(--hover, #1b2029); } .k-gauge .fg { stroke: currentColor; }
.k-ga-c b { position: absolute; right: 0; bottom: 0; left: 0; color: var(--fg, #d5d9e3); font-size: 15px; font-weight: 600; line-height: 1; text-align: center; font-variant-numeric: tabular-nums; } .k-ga-l { color: var(--muted, #7a8294); font-size: 11px; }
.k[data-line] .k-gauge { flex-direction: row; gap: 6px; } .k[data-line] .k-ga-c { display: flex; align-items: center; gap: 4px; width: auto; max-width: none; } .k[data-line] .k-ga-c svg { width: 24px; } .k[data-line] .k-ga-c b { position: static; font-size: 12px; }
.k-hm { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows, 7), 9px); grid-auto-columns: 9px; gap: 2px; justify-content: end; min-width: 0; overflow: hidden; color: var(--tc-green, #9ece6a); } .k[data-kit=full] .k-hm { grid-template-rows: repeat(var(--rows, 7), 12px); grid-auto-columns: 12px; gap: 3px; justify-content: start; }
.k-hm i { border-radius: 2px; background: var(--hover, #1b2029); } .k-hm .l1 { background: color-mix(in srgb, currentColor 30%, var(--hover, #1b2029)); } .k-hm .l2 { background: color-mix(in srgb, currentColor 55%, var(--hover, #1b2029)); } .k-hm .l3 { background: color-mix(in srgb, currentColor 78%, var(--hover, #1b2029)); } .k-hm .l4 { background: currentColor; } .k[data-line] .k-hm { grid-template-rows: 12px; grid-auto-columns: 6px; }
.k-status { display: flex; flex-direction: column; min-width: 0; } .k-st { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 22px; } .k-st + .k-st { border-top: 1px solid var(--line, #232833); } .k-st[data-open] { cursor: pointer; } .k-st[data-open]:hover { background: var(--hover, #1b2029); }
.k-st-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); } .k-st-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-st .k-sub { flex: 1; } .k-st-s { flex: none; margin-left: auto; font-size: 11px; }
.k[data-line] .k-status { flex-direction: row; gap: 10px; overflow: hidden; } .k[data-line] .k-st { border: 0; }
.k-checks { display: flex; flex-direction: column; gap: 2px; min-width: 0; } .k-ck-h { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; color: var(--done, #9ece6a); font-size: 11px; } .k-ck-h b { color: var(--fg, #d5d9e3); font-weight: 600; font-variant-numeric: tabular-nums; } .k-ck-h .k-bar { flex: 1; height: 4px; }
.k-ck { display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 20px; } .k-box { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; border: 1px solid var(--muted, #7a8294); border-radius: 4px; } .k-ck.on .k-box { border-color: var(--done, #9ece6a); background: var(--done, #9ece6a); color: var(--bg, #0f1117); }
.k-ck-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-ck.on .k-ck-t { color: var(--muted, #7a8294); text-decoration: line-through; } .k[data-line] .k-checks { flex-direction: row; align-items: center; gap: 8px; } .k[data-line] .k-ck-h { margin: 0; } .k[data-line] .k-ck-h .k-bar { flex: none; width: 36px; }
.k-avs { display: flex; align-items: center; min-width: 0; } .k-avs .k-av { width: 22px; height: 22px; box-shadow: 0 0 0 2px var(--bg, #0f1117); } .k-avs .k-av + .k-av { margin-left: -6px; } .k-avs-n { margin-left: 5px; color: var(--muted, #7a8294); font-size: 11px; } .k[data-line] .k-avs .k-av { width: 16px; height: 16px; }
.k-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; min-width: 0; } .k-cards.one { display: block; } .k[data-kit=preview] .k-cards { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.k-card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); } .k-card.link { cursor: pointer; } .k-card.link:hover { background: var(--hover, #1b2029); } .k-card-img { display: block; width: 100%; height: 80px; object-fit: cover; background: var(--hover, #1b2029); } .k[data-kit=preview] .k-card-img { height: 44px; }
.k-card-ic { padding: 8px 10px 0; } .k-card-b { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 7px 10px; } .k-card-h { display: flex; align-items: center; gap: 6px; min-width: 0; } .k-card-h b { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; } .k-card-h .k-tag { flex: none; margin-left: auto; }
.k-card-t { display: -webkit-box; overflow: hidden; color: var(--muted, #7a8294); font-size: 11px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.k[data-line] .k-cards { display: flex; gap: 10px; overflow: hidden; } .k[data-line] .k-card { flex: none; border: 0; } .k[data-line] :is(.k-card-img, .k-card-t, .k-card-ic) { display: none; } .k[data-line] .k-card-b { padding: 0; }
.k-hbars { display: flex; flex-direction: column; gap: 3px; min-width: 0; } .k-hb { display: grid; grid-template-columns: minmax(0, 32%) minmax(0, 1fr) auto; align-items: center; gap: 6px; min-height: 15px; font-size: 11px; } .k-hb-l { overflow: hidden; color: var(--muted, #7a8294); text-overflow: ellipsis; white-space: nowrap; }
.k-hb-t { height: 8px; overflow: hidden; border-radius: 3px; background: var(--hover, #1b2029); } .k-hb-t > i { display: block; height: 100%; border-radius: 3px; } .k-hb > b { color: var(--fg, #d5d9e3); font-weight: 600; font-variant-numeric: tabular-nums; } .k[data-line] .k-hbars, .k[data-line] .k-hb { flex: 1; }
.k-pie-body { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; min-height: 0; } .k-pie-c { position: relative; flex: none; container-type: size; } .k-pie-c svg { display: block; width: 100%; height: 100%; }
.k-pie-mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; pointer-events: none; } .k-pie-mid b { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; } .k-pie-mid span { color: var(--muted, #7a8294); font-size: 9.5px; } @container (max-width: 64px) { .k-pie-mid { display: none; } }
.k-pie-body .k-legend { flex-direction: column; flex-wrap: nowrap; min-width: 0; overflow: hidden; } .k-legend span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-pie-body .k-legend i { flex: none; height: 8px; border-radius: 2px; } .k-legend b { margin-left: 4px; color: var(--fg, #d5d9e3); font-weight: 500; } .k[data-line] .k-pie-body { gap: 4px; }
.k-sc-dot { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; opacity: 0.85; } .k-ch-x { display: flex; justify-content: space-between; color: var(--muted, #7a8294); font-size: 9.5px; }
.k-badge.c { background: color-mix(in srgb, currentColor 18%, transparent); }
.k[data-line] :is(.k-callout, .k-header, .k-footer, .k-st, .k-gauge, .k-ck, .k-ck-h, .k-avs, .k-card, .k-toolbar, .k-hm) { flex: none; } .k[data-line] .k-callout .k-main b { white-space: nowrap; }
.k[data-line] .k-callout { align-items: center; padding: 0 6px; } .k[data-line] :is(.k-callout .k-co-t, .k-header .k-sub) { display: none; } .k[data-line] .k-callout > :is(.k-icon, .k-emoji) { margin: 0; } .k[data-line] .k-footer { margin: 0; padding: 0; border: 0; } .k[data-line] .k-header .k-hd-t { font-size: 12px; }
.k-quote { margin: 0; min-width: 0; } .k-quote blockquote { margin: 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--accent, #7aa2f7); font-style: italic; overflow-wrap: anywhere; } .k-quote figcaption { margin-top: 4px; color: var(--muted, #7a8294); font-size: 11px; }
.k[data-line] .k-quote { overflow: hidden; } .k[data-line] .k-quote blockquote { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k[data-line] .k-quote figcaption { display: none; }
.k-diff { display: flex; flex-direction: column; gap: 4px; min-width: 0; } .k-df-h { display: flex; gap: 8px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.k-df-b { display: grid; grid-template-columns: minmax(100%, max-content); overflow: auto; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--hover, #1b2029); font: 11px/1.5 var(--mono, ui-monospace, monospace); }
.k-dl { padding: 0 8px; white-space: pre; } .k-dl.a { background: color-mix(in srgb, var(--done, #9ece6a) 14%, transparent); color: var(--done, #9ece6a); } .k-dl.d { background: color-mix(in srgb, var(--error, #f7768e) 14%, transparent); color: var(--error, #f7768e); } .k-dl.h { color: var(--accent, #7aa2f7); } .k-dl.f { color: var(--muted, #7a8294); font-weight: 600; }
.k[data-line] .k-diff { flex-direction: row; } .k[data-line] .k-df-b { display: none; }
.k-cd { display: flex; flex-direction: column; min-width: 0; } .k-cd > b { font-size: 20px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } .k-cd > span { color: var(--muted, #7a8294); font-size: 11px; }
.k[data-line] .k-cd { flex: none; flex-direction: row; align-items: baseline; gap: 6px; } .k[data-line] .k-cd > b { font-size: 13px; }
.k-steps { display: flex; margin: 0; padding: 0; list-style: none; min-width: 0; } .k-sp { position: relative; flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; text-align: center; } .k-sp[data-open] { cursor: pointer; }
.k-sp::before { content: ''; position: absolute; top: 7px; right: 50%; left: -50%; border-top: 2px solid var(--line, #232833); } .k-sp:first-child::before { display: none; } .k-sp:is(.done, .now, .fail)::before { border-color: var(--done, #9ece6a); }
.k-sp-dot { position: relative; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; box-sizing: border-box; border: 2px solid var(--line, #232833); border-radius: 50%; background: var(--bg, #0f1117); color: var(--bg, #0f1117); }
.k-sp.done .k-sp-dot { border-color: var(--done, #9ece6a); background: var(--done, #9ece6a); } .k-sp.fail .k-sp-dot { border-color: var(--error, #f7768e); background: var(--error, #f7768e); } .k-sp.now .k-sp-dot { border-color: var(--accent, #7aa2f7); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #7aa2f7) 25%, transparent); } .k-sp.skip .k-sp-dot { border-style: dashed; }
.k-sp .k-main { display: flex; flex-direction: column; align-items: center; max-width: 100%; min-width: 0; } .k-sp b { max-width: 100%; overflow: hidden; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } .k-sp .k-sub { max-width: 100%; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; } .k-sp:is(.todo, .skip) b { color: var(--muted, #7a8294); }
@container kit (max-width: 200px) { .k:not([data-line]) .k-steps { flex-direction: column; gap: 4px; } .k:not([data-line]) .k-sp { flex-direction: row; text-align: left; } .k:not([data-line]) .k-sp::before { display: none; } .k:not([data-line]) .k-sp .k-main { flex-direction: row; align-items: baseline; gap: 6px; } }
.k[data-line] .k-steps { flex: none; gap: 4px; } .k[data-line] .k-sp { flex: none; } .k[data-line] .k-sp::before, .k[data-line] .k-sp .k-main { display: none; } .k[data-line] .k-sp.now .k-main { display: flex; } .k[data-line] .k-sp.now { flex-direction: row; gap: 5px; } .k[data-line] .k-sp.now .k-sub { display: none; }
.k-meter { display: flex; flex-direction: column; gap: 5px; min-width: 0; } .k-meter-b { display: flex; gap: 2px; height: 8px; overflow: hidden; border-radius: 4px; background: var(--hover, #1b2029); box-shadow: inset 0 0 0 1px var(--line, #232833); } .k-meter-b > i { display: block; flex: none; height: 100%; }
.k[data-line] .k-meter { flex: 1; flex-direction: row; align-items: center; } .k[data-line] .k-meter-b { flex: 1; }
.k-board { display: flex; gap: 8px; min-width: 0; overflow-x: auto; } .k-bd-col { display: flex; flex: 1 0 130px; flex-direction: column; gap: 4px; min-width: 0; padding: 6px; border-radius: var(--radius, 6px); background: var(--hover, #1b2029); } .k-bd-col > .k-gh { padding: 0 2px 2px; }
.k-bd-c { min-width: 0; padding: 5px 7px; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--bg, #0f1117); } .k-bd-c[data-open] { cursor: pointer; } .k-bd-c[data-open]:hover { border-color: var(--accent, #7aa2f7); }
.k-bd-t { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } .k-bd-m { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 3px; } .k-bd-m .k-av { width: 14px; height: 14px; } .k-bd-m .k-tag { margin-left: auto; }
.k[data-line] .k-board { overflow: hidden; } .k[data-line] .k-bd-col { flex: none; padding: 0; background: none; } .k[data-line] .k-bd-col .k-gh { display: flex; padding: 0; font-weight: 500; } .k[data-line] .k-bd-c { display: none; }
.k-tree { display: flex; flex-direction: column; min-width: 0; } .k-tr-n { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 20px; padding-left: 14px; } .k-tr-n[data-open] { cursor: pointer; } .k-tr-n[data-open]:hover .k-tr-l { color: var(--accent, #7aa2f7); }
.k-tr-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-tr-c { margin-left: auto; color: var(--muted, #7a8294); font-size: 10.5px; } .k-tr-k { margin-left: 4px; padding-left: 8px; border-left: 1px solid var(--line, #232833); }
:is(summary.k-tr-n, summary.k-js-r) { padding-left: 0; cursor: pointer; list-style: none; } :is(summary.k-tr-n, summary.k-js-r)::-webkit-details-marker { display: none; } :is(summary.k-tr-n, summary.k-js-r)::before { content: '▸'; flex: none; width: 8px; color: var(--muted, #7a8294); font-size: 10px; } details[open] > :is(summary.k-tr-n, summary.k-js-r)::before { content: '▾'; }
.k[data-line] .k-tree { flex-direction: row; gap: 10px; overflow: hidden; } .k[data-line] .k-tr-k { display: none; } .k[data-line] .k-tr-n { flex: none; padding-left: 0; }
.k-log { display: flex; flex-direction: column; min-width: 0; padding: 5px 8px; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--hover, #1b2029); font: 11px/1.5 var(--mono, ui-monospace, monospace); }
.k-lg-l { display: flex; gap: 8px; min-width: 0; } .k-lg-t { flex: none; color: var(--muted, #7a8294); } .k-lg-x { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; } .k-log.wrap .k-lg-x { overflow-wrap: anywhere; white-space: pre-wrap; } .k-log > .k-more { align-self: flex-start; margin: 0 0 2px; }
.k[data-line] .k-log { flex: 1; padding: 0; border: 0; background: none; }
.k-json { min-width: 0; overflow: auto; font: 11px/1.55 var(--mono, ui-monospace, monospace); } .k-js-r { display: block; overflow: hidden; padding-left: 12px; text-overflow: ellipsis; white-space: nowrap; } summary.k-js-r::before { display: inline-block; width: 12px; }
.k-js-c { margin-left: 4px; padding-left: 8px; border-left: 1px solid var(--line, #232833); } .k-js-k { color: var(--accent, #7aa2f7); } .k-js-s { color: var(--done, #9ece6a); } .k-js-n { color: var(--waiting, #e0af68); } .k-js-b { color: var(--tc-purple, #bb9af7); }
.k-toggle, .k-toggle:hover { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 4px 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; } .k-toggle .k-main { display: flex; flex: 1; flex-direction: column; min-width: 0; } .k-tg-l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k-tg-s { position: relative; flex: none; width: 28px; height: 16px; border-radius: 8px; background: var(--line, #232833); transition: background 0.15s; } .k-tg-s::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--fg, #d5d9e3); transition: left 0.15s; }
.k-toggle.on .k-tg-s { background: var(--accent, #7aa2f7); } .k-toggle.on .k-tg-s::after { left: 14px; background: var(--accent-fg, #fff); } .k-toggle[data-busy] { opacity: 0.6; } .k-toggle:focus-visible .k-tg-s { outline: 2px solid var(--accent, #7aa2f7); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .k-tg-s, .k-tg-s::after { transition: none; } }
.k[data-line] .k-json { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k[data-line] .k-toggle { flex: none; width: auto; padding: 0; } .k[data-line] .k-toggle .k-sub { display: none; }
.k-kbd { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 3px; min-width: 0; } .k-kbd kbd { display: inline-block; min-width: 18px; padding: 0 5px; border: 1px solid var(--line, #232833); border-bottom-width: 2px; border-radius: 4px; background: var(--hover, #1b2029); font: 11px/16px var(--mono, ui-monospace, monospace); text-align: center; } .k-kbd-l { margin-left: 5px; color: var(--muted, #7a8294); }
.k-secret { display: flex; align-items: center; gap: 6px; min-width: 0; } .k-sc-l { flex: none; color: var(--muted, #7a8294); } .k-sc { min-width: 0; } .k-sc > summary { display: inline-flex; align-items: center; gap: 5px; color: var(--muted, #7a8294); cursor: pointer; list-style: none; } .k-sc > summary::-webkit-details-marker { display: none; }
.k-sc-d { letter-spacing: 1px; } .k-sc[open] > summary .k-sc-d { display: none; } .k-sc > code { display: block; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; user-select: all; } .k-sc[open] { display: flex; align-items: center; gap: 5px; } .k-sc[open] > summary { order: 1; }
.k-rate { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--waiting, #e0af68); } .k-stars { display: inline-flex; flex: none; } .k-stars i { position: relative; display: inline-block; width: 1em; font-style: normal; line-height: 1; } .k-stars i::before { content: '★'; color: var(--line, #232833); }
.k-stars i::after { content: '★'; position: absolute; top: 0; left: 0; width: var(--f); overflow: hidden; } .k-rate b { color: var(--fg, #d5d9e3); font-weight: 600; font-variant-numeric: tabular-nums; }
.k-cal { display: flex; flex-direction: column; gap: 4px; min-width: 0; } .k-cal-h { font-weight: 600; } .k-cal-g { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; text-align: center; font-variant-numeric: tabular-nums; } .k-cw { color: var(--muted, #7a8294); font-size: 10px; }
.k[data-kit=preview] .k-cd { min-height: 18px; } @container kit (max-width: 150px) { .k .k-cal-g, .k .k-cd { font-size: 9px; } }
.k-cd { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 22px; border-radius: 5px; font-size: 11px; } .k-cd.out { visibility: hidden; } .k-cd.has { background: var(--hover, #1b2029); } .k-cd.today { box-shadow: inset 0 0 0 1px var(--accent, #7aa2f7); color: var(--accent, #7aa2f7); font-weight: 600; } .k-cd[data-open] { cursor: pointer; }
.k-cd-dots { display: flex; gap: 2px; height: 4px; } .k-cd-dots i, .k-cal-ev i { width: 4px; height: 4px; border-radius: 50%; background: var(--accent, #7aa2f7); } .k-cal-list { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; } .k-cal-ev { display: flex; align-items: center; gap: 7px; min-width: 0; } .k-cal-ev .k-time { flex: none; width: 52px; margin: 0; } .k-cal-ev[data-open] { cursor: pointer; }
.k-cal-line { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.k-ini { display: inline-flex; align-items: center; justify-content: center; color: var(--muted, #7a8294); font-size: 8.5px; font-weight: 600; letter-spacing: -0.2px; }
.k-people, .k-inbox, .k-prs, .k-commits { display: flex; flex-direction: column; min-width: 0; } :is(.k-pp, .k-ib, .k-pr, .k-cm) + :is(.k-pp, .k-ib, .k-pr, .k-cm) { border-top: 1px solid var(--line, #232833); } :is(.k-pp, .k-ib, .k-pr, .k-cm)[data-open] { cursor: pointer; } :is(.k-pp, .k-ib, .k-pr, .k-cm)[data-open]:hover { background: var(--hover, #1b2029); }
.k-pp { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 32px; } .k-pp-f { position: relative; flex: none; } .k-pp-f .k-av { width: 24px; height: 24px; } .k-pp-dot { position: absolute; right: -1px; bottom: -1px; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 2px var(--bg, #0f1117); } .k-pp-s { flex: none; font-size: 11px; }
.k-ib { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding: 4px 0; } .k-ib > .k-av { width: 24px; height: 24px; margin-top: 1px; } .k-ib-h { display: flex; align-items: baseline; gap: 8px; min-width: 0; } .k-ib-h b { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } .k-ib .k-title { color: var(--muted, #7a8294); } .k-ib.on .k-title, .k-ib.on .k-ib-h b { color: var(--fg, #d5d9e3); font-weight: 600; }
.k-ib-dot { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: var(--accent, #7aa2f7); vertical-align: 1px; }
.k-chat { display: flex; flex-direction: column; gap: 6px; min-width: 0; } .k-msg { display: flex; align-items: flex-end; gap: 6px; max-width: 88%; min-width: 0; } .k-msg > .k-av { width: 20px; height: 20px; } .k-msg.me { align-self: flex-end; }
.k-bub { min-width: 0; padding: 4px 9px; border-radius: 10px 10px 10px 3px; background: var(--hover, #1b2029); } .k-msg.me .k-bub { border-radius: 10px 10px 3px 10px; background: color-mix(in srgb, var(--accent, #7aa2f7) 22%, transparent); } .k-msg-h { display: flex; align-items: baseline; gap: 6px; font-size: 11px; } .k-msg-h b { font-weight: 600; } .k-msg-h .k-time { margin-left: 0; }
.k-msg-t { overflow-wrap: anywhere; white-space: pre-wrap; } .k[data-kit=preview] .k-msg-t { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.k-pr { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 36px; } .k-pr-i, .k-pr-ck { flex: none; display: inline-flex; } .k-pr > .k-av { width: 18px; height: 18px; } .k-pr .k-tag { flex: none; }
.k-cm { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 26px; } .k-sha { flex: none; padding: 0 5px; border-radius: 4px; background: var(--hover, #1b2029); color: var(--accent, #7aa2f7); font: 11px/17px var(--mono, ui-monospace, monospace); cursor: copy; } .k-cm-m { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-cm > .k-av { width: 16px; height: 16px; } .k-cm .k-time { margin-left: 0; }
@container kit (max-width: 200px) { .k-cm > .k-av, .k-pr > .k-av, .k-pp-s { display: none; } }
.k-segw { display: flex; align-items: center; gap: 8px; min-width: 0; } .k-seg-l { flex: none; color: var(--muted, #7a8294); } .k-seg { display: inline-flex; min-width: 0; padding: 2px; border-radius: var(--radius, 6px); background: var(--hover, #1b2029); }
.k-seg-o, .k-seg-o:hover { min-width: 0; padding: 1px 10px; overflow: hidden; border: 0; border-radius: calc(var(--radius, 6px) - 2px); background: none; color: var(--muted, #7a8294); font: inherit; font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; } .k-seg-o:not(:disabled):not(.on):hover { color: var(--fg, #d5d9e3); } .k-seg-o.on { background: color-mix(in srgb, var(--fg, #d5d9e3) 16%, var(--hover, #1b2029)); color: var(--fg, #d5d9e3); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / 25%); cursor: default; } .k-seg-o[data-busy] { opacity: 0.6; }
.k-stepper { display: flex; align-items: center; gap: 8px; min-width: 0; } .k-step-l { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-step { display: inline-flex; flex: none; align-items: center; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); }
.k-step-b, .k-step-b:hover { width: 24px; padding: 0; border: 0; border-radius: 0; background: none; color: var(--muted, #7a8294); font: 600 14px/20px var(--mono, ui-monospace, monospace); } .k-step-b:not(:disabled):hover { background: var(--hover, #1b2029); color: var(--fg, #d5d9e3); } .k-step b { min-width: 28px; padding: 0 4px; border-inline: 1px solid var(--line, #232833); font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; } .k-step .k-unit { margin-left: 2px; color: var(--muted, #7a8294); font-weight: 400; }
.k[data-line] :is(.k-people, .k-inbox, .k-prs, .k-commits) { flex-direction: row; gap: 10px; overflow: hidden; } .k[data-line] :is(.k-pp, .k-ib, .k-pr, .k-cm) { flex: none; min-height: 0; padding: 0; border: 0; } .k[data-line] :is(.k-pp, .k-ib, .k-pr) .k-sub, .k[data-line] .k-pp-f .k-av { display: none; } .k[data-line] .k-pp-f { width: 8px; height: 8px; } .k[data-line] .k-pp-dot { position: static; display: block; box-shadow: none; }
.k[data-line] .k-ib > .k-av, .k[data-line] .k-ib-h .k-time { display: none; } .k[data-line] .k-ib .k-main { flex-direction: row; gap: 6px; } .k[data-line] .k-pr > .k-av, .k[data-line] .k-pr .k-tag { display: none; } .k[data-line] .k-chat { flex-direction: row; overflow: hidden; } .k[data-line] .k-msg { max-width: none; } .k[data-line] .k-msg > .k-av, .k[data-line] .k-msg-h .k-time { display: none; } .k[data-line] .k-bub { padding: 0 7px; } .k[data-line] .k-bub, .k[data-line] .k-msg-t { display: flex; gap: 5px; white-space: nowrap; }
.k[data-line] :is(.k-segw, .k-stepper, .k-secret, .k-rate, .k-kbd) { flex: none; } .k[data-line] .k-step-b { line-height: 16px; } .k[data-line] .k-seg { padding: 1px; } .k[data-line] .k-seg-o { padding: 0 7px; line-height: 15px; }
.k-tc { display: flex; align-items: center; gap: 7px; min-width: 0; } .k-table .al-right .k-tc { justify-content: flex-end; } .k-table .al-center .k-tc { justify-content: center; } .k-table td { vertical-align: middle; }
.k-tc-a { display: flex; flex: 1; align-items: center; gap: 7px; min-width: 0; } .k-tc .k-main > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-table td.wrap .k-tc .k-main > * { overflow-wrap: anywhere; white-space: normal; } .k-tc .k-av { width: 20px; height: 20px; } .k-tc:has(.k-sub) .k-av { width: 28px; height: 28px; } .k-av.sq { border-radius: 5px; } .k[data-line] .k-table { overflow: hidden; } .k[data-line] .k-tc .k-av { width: 16px; height: 16px; } .k[data-line] .k-tc .k-sub { display: none; }
.k-tc > :is(.k-badge, .k-copy, .k-btn) { flex: none; } .k-tc-sp { flex: 1; min-width: 40px; max-width: 120px; color: var(--accent, #7aa2f7); } .k-tc-sp svg { display: block; height: 18px; }
.k-tbar { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 80px; color: var(--accent, #7aa2f7); } .k-tbar .k-bar { flex: 1; min-width: 30px; } .k-tbar > b { flex: none; color: var(--fg, #d5d9e3); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; } .k-tbar.sm { flex: none; width: 78px; min-width: 0; } .k-tbar.sm .k-bar { height: 4px; }
.k-accord { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); } .k-ad + .k-ad { border-top: 1px solid var(--line, #232833); } .k-accord > .k-more { margin: 2px 6px 4px; }
.k-ad-h { display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 30px; padding: 4px 10px; cursor: pointer; list-style: none; } .k-ad-h::-webkit-details-marker { display: none; } .k-ad-h:hover { background: var(--hover, #1b2029); } .k-ad-h:focus-visible { outline: 2px solid var(--accent, #7aa2f7); outline-offset: -2px; } .k-ad-h > .k-title { font-weight: 500; } .k-ad-h > :is(.k-icon, .k-emoji) { color: var(--muted, #7a8294); }
.k-ad-h > .k-badge { order: 1; margin-left: auto; } .k-ad-h::after { content: '›'; order: 2; flex: none; margin-left: auto; color: var(--muted, #7a8294); font-size: 14px; line-height: 1; transform: rotate(90deg); transition: transform 0.15s; } .k-ad-h:has(> .k-badge)::after { margin-left: 4px; } .k-ad[open] > .k-ad-h::after { transform: rotate(-90deg); }
.k-ad-b { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 2px 10px 9px; } .k-ad-t { overflow-wrap: anywhere; white-space: pre-wrap; } .k[data-kit=preview] .k-ad-h { min-height: 26px; padding: 3px 8px; } .k[data-kit=preview] .k-ad-b { padding: 0 8px 6px; }
.k[data-line] .k-accord { flex-direction: row; gap: 10px; overflow: hidden; border: 0; } .k[data-line] .k-ad { flex: none; border: 0; } .k[data-line] :is(.k-ad-b, .k-ad-h .k-sub) { display: none; } .k[data-line] .k-ad-h { min-height: 0; padding: 0; } .k[data-line] .k-ad-h::after { content: none; }
.k-crumbs { display: flex; align-items: center; min-width: 0; overflow: hidden; color: var(--muted, #7a8294); white-space: nowrap; } .k-cr { display: inline-flex; flex: 0 1 auto; align-items: center; min-width: 0; } .k-cr > * { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; color: inherit; }
.k-cr span { overflow: hidden; text-overflow: ellipsis; } .k-cr + .k-cr::before { content: '›'; flex: none; padding: 0 6px; opacity: 0.7; } .k-cr:last-child { flex-shrink: 0.3; color: var(--fg, #d5d9e3); } .k-cr a:hover { color: var(--accent, #7aa2f7); text-decoration: none; }
.k-gallery { display: flex; gap: 6px; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; } .k-gl-i { display: flex; flex: none; flex-direction: column; gap: 3px; max-width: 85%; margin: 0; scroll-snap-align: start; } .k-gl-i[data-open] { cursor: pointer; }
.k-gl-i img { display: block; min-width: 48px; max-width: 100%; border-radius: var(--radius, 6px); background: var(--hover, #1b2029); object-fit: cover; } .k-gl-i[data-open]:hover img { opacity: 0.85; } .k-gl-i figcaption { width: 0; min-width: 100%; overflow: hidden; color: var(--muted, #7a8294); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.k[data-line] .k-gallery { gap: 4px; overflow: hidden; } .k[data-line] .k-gl-i img { min-width: 0; border-radius: 3px; }
.k-load { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--accent, #7aa2f7); } .k-load > span { min-width: 0; overflow: hidden; color: var(--muted, #7a8294); text-overflow: ellipsis; white-space: nowrap; }
.k-ld-s { flex: none; width: 14px; height: 14px; border: 2px solid color-mix(in srgb, currentColor 22%, transparent); border-top-color: currentColor; border-radius: 50%; animation: k-spin 0.8s linear infinite; } .k-load.s-sm .k-ld-s { width: 10px; height: 10px; border-width: 1.5px; } .k-load.s-lg .k-ld-s { width: 22px; height: 22px; border-width: 3px; }
.k-ld-d { display: inline-flex; flex: none; gap: 3px; } .k-ld-d i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: k-blink 1.2s ease-in-out infinite; } .k-ld-d i:nth-child(2) { animation-delay: 0.2s; } .k-ld-d i:nth-child(3) { animation-delay: 0.4s; } .k-load.s-sm .k-ld-d i { width: 4px; height: 4px; } .k-load.s-lg .k-ld-d i { width: 8px; height: 8px; }
.k-load.bar { flex-direction: column; align-items: stretch; gap: 3px; } .k-load.bar > span { order: -1; } .k-ld-b { position: relative; display: block; height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, currentColor 18%, transparent); } .k-load.s-sm .k-ld-b { height: 3px; } .k-load.s-lg .k-ld-b { height: 6px; }
.k-ld-b > i { position: absolute; top: 0; bottom: 0; left: 0; width: 35%; border-radius: 2px; background: currentColor; animation: k-slide 1.4s ease-in-out infinite; }
@keyframes k-spin { to { transform: rotate(360deg); } } @keyframes k-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } } @keyframes k-slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) { .k-ld-s, .k-ld-d i, .k-ld-b > i { animation-duration: 3s; } }
.k[data-line] .k-load { flex: none; } .k[data-line] .k-load.bar { flex: 1; flex-direction: row; align-items: center; } .k[data-line] .k-load.bar .k-ld-b { flex: 1; } .k[data-line] .k-load.bar > span { order: 0; }
.k-hero { --hero: var(--accent, #7aa2f7); display: flex; align-items: center; gap: 14px; min-width: 0; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--hero) 28%, transparent); border-radius: calc(var(--radius, 6px) + 4px); background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--hero) 22%, transparent), transparent 62%), color-mix(in srgb, var(--hero) 5%, transparent); }
.k-hero.center { flex-direction: column; text-align: center; } .k-hero.center .k-actions { justify-content: center; } .k-hero-b { display: flex; flex: 1; flex-direction: column; gap: 6px; min-width: 0; } .k-hero.center .k-hero-b { align-items: center; }
.k-hero-img { flex: none; width: 96px; height: 96px; border-radius: var(--radius, 6px); object-fit: cover; } .k-hero-ic { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: color-mix(in srgb, var(--hero) 18%, transparent); color: var(--hero); }
.k-hero-t { font-size: 20px; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; overflow-wrap: anywhere; } .k-hero-x { color: var(--muted, #7a8294); } .k-hero .k-actions { margin-top: 4px; }
.k[data-kit=preview] .k-hero { gap: 10px; padding: 8px 10px; } .k[data-kit=preview] .k-hero-t { font-size: 15px; } .k[data-kit=preview] .k-hero-img { width: 56px; height: 56px; } .k[data-kit=preview] .k-hero-ic { width: 36px; height: 36px; border-radius: 10px; } .k[data-kit=preview] .k-hero .k-actions { margin-top: 0; }
@container kit (max-width: 220px) { .k-hero-img, .k-hero-ic { display: none; } }
.k[data-line] .k-hero { flex: none; padding: 0; border: 0; background: none; } .k[data-line] .k-hero > :not(.k-hero-b), .k[data-line] .k-hero-b > :not(.k-hero-t) { display: none; } .k[data-line] .k-hero-t { font-size: inherit; font-weight: 600; }
.k-mk { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: calc(var(--radius, 6px) + 2px); background: var(--hover, #1b2029); }
.k-mk-bar { display: flex; flex: none; align-items: center; gap: 5px; min-width: 0; padding: 6px 9px; border-bottom: 1px solid var(--line, #232833); } .k-mk-bar > i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #ff5f57; } .k-mk-bar > i:nth-child(2) { background: #febc2e; } .k-mk-bar > i:nth-child(3) { background: #28c840; }
.k-mk-url, .k-mk-t { flex: 1; min-width: 0; margin-left: 6px; overflow: hidden; color: var(--muted, #7a8294); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } .k-mk-url { padding: 0 8px; border-radius: 5px; background: var(--bg, #0f1117); line-height: 17px; cursor: pointer; } .k-mk-t { margin-right: 40px; text-align: center; }
.k-mk-b { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg, #0f1117); } .k-mk-b > :not(.k-mk-img):not(.k-mk-code) { margin: 8px 10px; }
.k-mk-img { display: block; width: 100%; object-fit: cover; object-position: top; } .k-mk-code { padding: 8px 10px; overflow: hidden; color: var(--muted, #7a8294); font: 11.5px/1.5 var(--mono, ui-monospace, monospace); white-space: pre; } .k-mk-code > div { overflow: hidden; text-overflow: ellipsis; } .k-mk-code .cmd { color: var(--fg, #d5d9e3); } .k-mk-p { margin-right: 7px; color: var(--done, #9ece6a); user-select: none; }
.k:not([data-line]) .k-mk.terminal { border-color: #2a2e38; background: #1b1e25; } .k:not([data-line]) .k-mk.terminal .k-mk-bar { border-color: #2a2e38; } .k:not([data-line]) .k-mk.terminal .k-mk-b { background: #0d0f14; } .k:not([data-line]) .k-mk.terminal .k-mk-code { color: #9aa3b5; } .k:not([data-line]) .k-mk.terminal .cmd { color: #e6e9ef; } .k:not([data-line]) .k-mk.terminal .k-mk-p { color: #9ece6a; }
.k-mk.phone { align-self: center; width: min(100%, 240px); padding: 6px; border-width: 2px; border-radius: 28px; } .k-mk.phone .k-mk-b { border-radius: 22px; } .k-mk-notch { display: block; flex: none; align-self: center; width: 64px; height: 12px; margin-bottom: 5px; border-radius: 8px; background: var(--line, #232833); }
.k[data-kit=preview] .k-mk { flex: 1; min-height: 0; } .k[data-kit=preview] .k-mk-bar { padding: 4px 7px; } .k[data-kit=preview] .k-mk-code { padding: 5px 8px; font-size: 10.5px; }
.k[data-line] .k-mk { flex: none; flex-direction: row; align-items: center; gap: 6px; border: 0; background: none; } .k[data-line] .k-mk-bar { padding: 0; border: 0; } .k[data-line] .k-mk-bar > i, .k[data-line] .k-mk-notch, .k[data-line] .k-mk-img, .k[data-line] .k-mk-code > div + div { display: none; } .k[data-line] .k-mk-b { flex-direction: row; background: none; } .k[data-line] .k-mk-code { padding: 0; }
.k-filt { display: flex; flex-direction: column; gap: 8px; min-width: 0; } .k-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.k-chip, .k-chip:hover { padding: 0 9px; border: 1px solid var(--line, #232833); border-radius: 10px; background: none; color: var(--muted, #7a8294); font-size: 11px; line-height: 18px; white-space: nowrap; } .k-chip:hover { color: var(--fg, #d5d9e3); } .k-chip.on { border-color: transparent; background: var(--accent, #7aa2f7); color: var(--accent-fg, #fff); font-weight: 600; }
.k[data-kit=preview] .k-filt { gap: 5px; } .k[data-kit=preview] .k-chips { flex-wrap: nowrap; overflow: hidden; } .k[data-kit=preview] .k-chip { flex: none; } .k[data-line] .k-filt { flex: 1; flex-direction: row; } .k[data-line] .k-chips { display: none; }
.k-rot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.3em; min-width: 0; font-size: 15px; font-weight: 600; } .k-rot.s-sm { font-size: 12px; } .k-rot.s-lg { font-size: 20px; } .k-rot.s-xl { font-size: 28px; letter-spacing: -0.01em; }
.k-rot-w { display: inline-block; height: 1.3em; overflow: hidden; color: var(--rc, var(--accent, #7aa2f7)); line-height: 1.3em; vertical-align: bottom; } .k-rot-t { display: flex; flex-direction: column; animation: k-rot calc(var(--n) * var(--s)) steps(var(--n)) infinite; } .k-rot-t > span { height: 1.3em; white-space: nowrap; } .k-rot-1 { color: var(--rc, var(--accent, #7aa2f7)); }
@keyframes k-rot { to { transform: translateY(calc(var(--n) * -1.3em)); } }
.k[data-line] .k-rot { flex: none; flex-wrap: nowrap; font-size: inherit; letter-spacing: normal; }
.k-cmp { position: relative; display: grid; grid-template-columns: auto 1fr; width: 100%; min-width: 0; overflow: hidden; border-radius: var(--radius, 6px); background: var(--hover, #1b2029); container-type: inline-size; user-select: none; }
.k-cmp > * { position: relative; grid-row: 1; grid-column: 1; } .k-cmp-a { grid-column: 1 / -1; } .k-cmp-b { z-index: 1; overflow: hidden; border-right: 2px solid #fff; }
.k-cmp img { position: absolute; top: 0; left: 0; width: 100cqi; max-width: none; height: 100%; object-fit: cover; pointer-events: none; }
.k-cmp-l { position: absolute; top: 6px; left: 6px; z-index: 1; padding: 0 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 10.5px; line-height: 16px; white-space: nowrap; pointer-events: none; } .k-cmp-l.r { right: 6px; left: auto; } @container (max-width: 160px) { .k-cmp-l { display: none; } }
.k-cmp-h { z-index: 2; display: grid; place-items: center; align-self: center; justify-self: end; width: 26px; height: 26px; border-radius: 50%; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4); translate: 50%; pointer-events: none; } .k-cmp-h::after { content: '\\2039\\00a0\\203A'; color: #222; font: 700 13px/1 system-ui, sans-serif; font-style: normal; }
.k-cmp-r { z-index: 3; top: 50%; width: 50cqi; min-width: 1rem; max-width: calc(100cqi - 1rem); height: 2rem; overflow: hidden; resize: horizontal; opacity: 0; cursor: ew-resize; transform-origin: 100% 100%; scale: 4; translate: 1.5rem -0.5rem; clip-path: inset(calc(100% - 0.75rem) 0 0 calc(100% - 0.75rem)); }
.k[data-line] .k-cmp { flex: none; width: 48px; border-radius: 3px; } .k[data-line] .k-cmp-r, .k[data-line] .k-cmp-h { display: none; } .k[data-line] .k-cmp-b { width: 24px; border-right-width: 1px; }
.k-skel { display: flex; flex-direction: column; gap: 8px; min-width: 0; } .k-sk-r { display: flex; align-items: flex-start; gap: 10px; min-width: 0; } .k-sk-ls { display: flex; flex: 1; flex-direction: column; gap: 7px; min-width: 0; padding-top: 2px; }
.k-sk { display: block; height: 10px; border-radius: 5px; background: linear-gradient(90deg, color-mix(in srgb, var(--fg, #d5d9e3) 7%, transparent) 25%, color-mix(in srgb, var(--fg, #d5d9e3) 16%, transparent) 50%, color-mix(in srgb, var(--fg, #d5d9e3) 7%, transparent) 75%); background-size: 300% 100%; animation: k-shim 1.6s ease-in-out infinite; } .k-sk.av { flex: none; width: 32px; height: 32px; border-radius: 50%; } .k-sk.img { width: 100%; height: 72px; border-radius: var(--radius, 6px); }
@keyframes k-shim { from { background-position: 100% 0; } to { background-position: 0 0; } }
.k[data-kit=preview] .k-sk.img { height: 40px; } .k[data-kit=preview] .k-sk.av { width: 24px; height: 24px; } .k[data-line] .k-skel { flex: none; } .k[data-line] .k-sk.img, .k[data-line] .k-sk.av, .k[data-line] .k-sk-ls > .k-sk + .k-sk { display: none; } .k[data-line] .k-sk-ls { width: 80px; padding: 0; } .k[data-line] .k-sk { height: 8px; }
.k-radial { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; color: var(--accent, #7aa2f7); } .k-rd-c { position: relative; width: 64px; height: 64px; } .k-radial.s-sm .k-rd-c { width: 40px; height: 40px; } .k-radial.s-lg .k-rd-c { width: 96px; height: 96px; }
.k-rd-c svg { display: block; width: 100%; height: 100%; } .k-rd-c .bg { stroke: color-mix(in srgb, currentColor 16%, transparent); } .k-rd-c .fg { stroke: currentColor; }
.k-rd-c b { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg, #d5d9e3); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; } .k-radial.s-sm .k-rd-c b { font-size: 10px; } .k-radial.s-lg .k-rd-c b { font-size: 18px; }
.k-rd-l { max-width: 100%; overflow: hidden; color: var(--muted, #7a8294); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.k[data-kit=preview] .k-radial .k-rd-c { width: 46px; height: 46px; } .k[data-kit=preview] .k-radial.s-sm .k-rd-c { width: 32px; height: 32px; } .k[data-kit=preview] .k-radial.s-lg .k-rd-c { width: 64px; height: 64px; } .k[data-kit=preview] .k-radial .k-rd-c b { font-size: 11px; }
.k[data-line] .k-radial { flex: none; flex-direction: row; gap: 5px; } .k[data-line] .k-radial .k-rd-c { display: flex; align-items: center; gap: 4px; width: auto; height: 14px; } .k[data-line] .k-radial .k-rd-c svg { width: 14px; height: 14px; } .k[data-line] .k-radial .k-rd-c b { position: static; font-size: inherit; }
.k-ind { position: relative; display: inline-flex; flex: none; align-self: flex-start; width: fit-content; margin: 7px 9px 0 0; } .k-ind[data-open] { cursor: pointer; } .k-ind-x { display: inline-flex; align-items: center; gap: 6px; } .k-ind-x .k-av { width: 28px; height: 28px; } .k-ind-x.box { padding: 3px 10px; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--hover, #1b2029); }
.k-ind-b { position: absolute; top: -7px; right: -9px; min-width: 16px; padding: 0 4px; border-radius: 8px; color: var(--error, #f7768e); background: currentColor; box-shadow: 0 0 0 2px var(--bg, #0f1117); font-size: 10px; font-weight: 700; line-height: 15px; text-align: center; font-variant-numeric: tabular-nums; } .k-ind-b > span { color: #fff; } .k-ind-b:is(.t-warn, .t-good) > span { color: #16181d; }
.k-ind-d { position: absolute; top: -2px; right: -3px; width: 9px; height: 9px; border-radius: 50%; color: var(--accent, #7aa2f7); background: currentColor; box-shadow: 0 0 0 2px var(--bg, #0f1117); }
.k[data-line] .k-ind { align-self: center; align-items: center; margin: 0; } .k[data-line] .k-ind-b { position: static; margin-left: 4px; box-shadow: none; } .k[data-line] .k-ind-x .k-av { width: 16px; height: 16px; } .k[data-line] .k-ind-x.box { padding: 0 6px; } .k[data-line] .k-ind-d { top: 0; box-shadow: none; }
.k-avatar { --av: 40px; display: flex; align-items: center; gap: 10px; min-width: 0; } .k-avatar.sm { --av: 24px; } .k-avatar.lg { --av: 64px; } .k-avatar.xl { --av: 96px; } .k-avatar[data-open] { cursor: pointer; }
.k-avt-w { position: relative; flex: none; width: var(--av); height: var(--av); } .k-avt { display: block; width: 100%; height: 100%; } .k-avt.ring { padding: max(2px, calc(var(--av) * 0.05)); background: var(--ring); }
.k-avt-f { display: grid; place-items: center; width: 100%; height: 100%; overflow: hidden; background: var(--hover, #1b2029); } .k-avt-f img { display: block; width: 100%; height: 100%; object-fit: cover; } .k-avt-i { color: var(--muted, #7a8294); font-size: calc(var(--av) * 0.36); font-weight: 600; }
.k-avatar .sh-circle { border-radius: 50%; } .k-avatar .sh-rounded { border-radius: 22%; } .k-avatar .sh-squircle { border-radius: 34%; } .k-avatar .sh-hexagon { clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); } .k-avatar .sh-diamond { clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
.k-avt-d { position: absolute; right: 2%; bottom: 2%; width: max(8px, calc(var(--av) * 0.2)); height: max(8px, calc(var(--av) * 0.2)); border-radius: 50%; background: currentColor; box-shadow: 0 0 0 2px var(--bg, #0f1117); }
.k[data-kit=preview] .k-avatar.lg { --av: 44px; } .k[data-kit=preview] .k-avatar.xl { --av: 52px; } .k[data-line] .k-avatar { --av: 16px; flex: none; gap: 6px; } .k[data-line] .k-avatar .k-sub { display: none; } .k[data-line] .k-avt-d { width: 6px; height: 6px; box-shadow: none; } .k[data-line] .k-avt.ring { padding: 1px; }
.k-range { display: flex; flex-direction: column; gap: 3px; min-width: 0; } .k-rg-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; } .k-rg-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-rg-h b { flex: none; font-variant-numeric: tabular-nums; } .k-rg-h .k-unit { margin-left: 1px; color: var(--muted, #7a8294); font-weight: 400; }
.k .k-range input[type=range] { width: 100%; height: 16px; margin: 0; padding: 0; border: 0; background: none; accent-color: var(--accent, #7aa2f7); cursor: pointer; } .k .k-range input[type=range]:disabled { opacity: 0.5; cursor: default; }
.k[data-line] .k-range { flex: 1; flex-direction: row; align-items: center; gap: 6px; min-width: 120px; } .k[data-line] .k-rg-h { order: 1; } .k[data-line] .k-rg-l { display: none; }
.k-selw { display: flex; align-items: center; gap: 8px; min-width: 0; } @container kit (max-width: 150px) { .k-selw .k-seg-l { display: none; } } .k .k-selw select { flex: 1; min-width: 0; background: var(--hover, #1b2029); cursor: pointer; } .k .k-selw select:disabled { opacity: 0.6; cursor: default; }
.k[data-kit=preview] .k-selw select { padding: 2px 6px; font-size: 11px; } .k[data-line] .k-selw { flex: none; } .k[data-line] .k-selw select { width: auto; padding: 0 4px; font-size: 11px; }
.k-input { display: flex; align-items: center; gap: 6px; min-width: 0; } .k-input input { flex: 1; } .k-input .k-btn { flex: none; } .k[data-kit=preview] .k-input input { padding: 2px 6px; font-size: 11px; }
.k[data-line] .k-input { flex: 1; min-width: 120px; max-width: 240px; } .k[data-line] .k-input input { padding: 0 6px; } .k[data-line] .k-input .k-btn { padding: 0 6px; line-height: 15px; }
.k-swap, .k-swap:hover { display: inline-flex; flex: none; align-items: center; gap: 6px; width: fit-content; padding: 3px 9px; } .k-swap.bare { padding: 4px; border-color: transparent; background: none; } .k-swap.bare:hover { background: var(--hover, #1b2029); }
.k-swap:not(.on) { color: var(--muted, #7a8294); } .k-swap:not(.on):hover { color: var(--fg, #d5d9e3); } .k-swap.on { border-color: color-mix(in srgb, currentColor 40%, transparent); color: var(--accent, #7aa2f7); } .k-swap .k-icon { transition: transform 0.15s; } .k-swap:active .k-icon { transform: scale(0.85); }
.k[data-line] .k-swap { padding: 0 6px; line-height: 15px; } .k[data-line] .k-swap.bare { padding: 0 2px; }
.k-pg { display: inline-flex; flex: none; align-items: stretch; width: fit-content; max-width: 100%; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); } .k-pg > * + * { border-left: 1px solid var(--line, #232833); }
.k-pg-b, .k-pg-b:hover { min-width: 28px; padding: 2px 8px; border: 0; border-radius: 0; background: none; font-variant-numeric: tabular-nums; } .k-pg > * + .k-pg-b { border-left: 1px solid var(--line, #232833); } .k-pg-b:not(:disabled):hover { background: var(--hover, #1b2029); } .k-pg-b.arr { font-size: 14px; line-height: 1; }
.k-pg-b.on, .k-pg-b.on:disabled { background: var(--accent, #7aa2f7); color: var(--accent-fg, #fff); font-weight: 600; opacity: 1; } .k-pg-gap, .k-pg-n { display: grid; place-items: center; padding: 0 6px; color: var(--muted, #7a8294); font-variant-numeric: tabular-nums; }
@container kit (max-width: 220px) { .k-pg-b.pn:not(.on), .k-pg-gap { display: none; } }
.k[data-kit=preview] .k-pg-b { min-width: 24px; padding: 1px 6px; font-size: 11px; } .k[data-line] .k-pg-b { min-width: 0; padding: 0 6px; line-height: 15px; }
.k-menu { display: flex; flex-direction: column; gap: 1px; min-width: 0; } .k-mn-h { padding: 6px 8px 2px; overflow: hidden; color: var(--muted, #7a8294); font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; } .k-mn-h:first-child { padding-top: 0; }
.k-mn-i, .k-mn-i:hover { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 4px 8px; border: 0; background: none; color: inherit; text-align: left; } .k-mn-i:not(:disabled):hover { background: var(--hover, #1b2029); } .k-mn-i .k-icon { color: var(--muted, #7a8294); } .k-mn-i .k-title { flex: 1; min-width: 0; } .k-mn-i .k-badge { flex: none; }
.k-mn-i.on, .k-mn-i.on:hover { background: color-mix(in srgb, var(--accent, #7aa2f7) 16%, transparent); color: var(--accent, #7aa2f7); font-weight: 600; } .k-mn-i.on .k-icon { color: inherit; }
.k[data-kit=preview] .k-mn-i { padding: 2px 6px; } .k[data-kit=preview] .k-mn-h { padding: 3px 6px 1px; } .k[data-line] .k-menu { flex-direction: row; gap: 4px; overflow: hidden; } .k[data-line] .k-mn-h { display: none; } .k[data-line] .k-mn-i { flex: none; width: auto; padding: 0 6px; }
.k[data-kit=preview] { position: relative; } .k-dd { position: relative; display: inline-block; flex: none; width: fit-content; } .k-dd > summary { list-style: none; } .k-dd > summary::-webkit-details-marker { display: none; }
.k-dd-s { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--hover, #1b2029); white-space: nowrap; cursor: pointer; user-select: none; } .k-dd-s > .k-icon:last-child { opacity: 0.7; transition: transform 0.15s; } .k-dd[open] > .k-dd-s > .k-icon:last-child { transform: rotate(180deg); }
.k-dd-s.primary { border-color: transparent; background: var(--accent, #7aa2f7); color: var(--accent-fg, #fff); font-weight: 600; } .k-dd-s.quiet { border-color: transparent; background: none; color: var(--muted, #7a8294); } .k-dd-s.quiet:hover { background: var(--hover, #1b2029); color: var(--fg, #d5d9e3); } .k-dd-s.danger { color: var(--error, #f7768e); }
.k-dd-m { position: absolute; top: calc(100% + 4px); left: 0; z-index: 5; display: flex; flex-direction: column; gap: 1px; min-width: 160px; max-width: 280px; padding: 4px; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--bg, #0f1117); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); } .k-dd.end .k-dd-m { right: 0; left: auto; }
.k[data-kit=preview] .k-dd { position: static; } .k[data-kit=preview] .k-dd-m { inset: 4px; min-width: 0; max-width: none; overflow: auto; } .k[data-kit=preview] .k-dd-s { padding: 1px 8px; font-size: 11px; } .k[data-line] .k-dd-s { padding: 0 7px; line-height: 15px; } .k[data-line] .k-dd-m { display: none; }
@media (prefers-reduced-motion: reduce) { .k-rot-t { animation-duration: calc(var(--n) * var(--s) * 2); } .k-sk { animation-duration: 4s; } .k-dd-s > .k-icon:last-child, .k-swap .k-icon { transition: none; } }
.k-pop { display: inline-flex; flex: none; width: fit-content; } .k-pop > .k-dd-s { font: inherit; color: inherit; }
.k-pop-b { position: fixed; inset: auto; top: anchor(bottom); left: anchor(left); position-try-fallbacks: flip-block, flip-inline; flex-direction: column; gap: 6px; min-width: 220px; max-width: 320px; max-height: 70vh; margin: 4px 0; padding: 10px 12px; overflow: auto; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--bg, #0f1117); color: var(--fg, #d5d9e3); font: 12px/1.4 var(--ui-font, -apple-system, system-ui, sans-serif); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.k-pop-b:popover-open { display: flex; } .k-pop.end .k-pop-b { left: auto; right: anchor(right); } .k-pop-t { font-weight: 600; } .k-pop-x { color: var(--muted, #7a8294); overflow-wrap: anywhere; } .k-pop.hover > .k-dd-s { cursor: default; }
.k-cmd { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); } .k-cmd-q { display: flex; flex: none; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--line, #232833); color: var(--muted, #7a8294); }
.k .k-cmd-q input { flex: 1; padding: 7px 0; border: 0; border-radius: 0; background: none; outline: none; } .k-cmd-m { padding: 4px; overflow: auto; } .k-cmd .k-mn-i:focus-visible { outline: none; background: var(--hover, #1b2029); box-shadow: inset 2px 0 0 var(--accent, #7aa2f7); }
.k-cmd > .k-empty, .k-cmd > .k-more { margin: 2px 4px 6px; } .k-mn-k { flex: none; margin-left: auto; } .k-mn-i .k-badge + .k-mn-k { margin-left: 6px; } .k-mn-k kbd { min-width: 16px; padding: 0 4px; font-size: 10px; line-height: 15px; }
.k[data-kit=preview] .k-cmd { flex: 1; min-height: 0; } .k[data-kit=preview] .k-cmd-q input { padding: 4px 0; font-size: 11px; } .k-cmd-l { color: var(--muted, #7a8294); }
.k-date { display: flex; align-items: center; gap: 8px; min-width: 0; } .k .k-date input { flex: 1; min-width: 0; color-scheme: inherit; cursor: pointer; } .k .k-date input:disabled { opacity: 0.6; cursor: default; }
.k .k-date input::-webkit-calendar-picker-indicator { opacity: 0.6; cursor: pointer; } @container kit (max-width: 150px) { .k-date .k-seg-l { display: none; } }
.k[data-kit=preview] .k-date input { padding: 2px 6px; font-size: 11px; } .k[data-line] .k-date { flex: none; } .k[data-line] .k-date input { width: auto; padding: 0 4px; font-size: 11px; }
.k-split { display: inline-flex; flex: none; align-items: stretch; width: fit-content; max-width: 100%; } .k-split > .k-btn { min-width: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; } .k-split > .k-btn > span { overflow: hidden; text-overflow: ellipsis; }
.k-split > .k-dd { display: flex; } .k-split-s.k-dd-s { height: 100%; margin-left: -1px; padding: 0 6px; border-top-left-radius: 0; border-bottom-left-radius: 0; } .k-split-s.primary { border-left: 1px solid color-mix(in srgb, var(--accent-fg, #fff) 35%, transparent); } .k[data-line] .k-split-s.k-dd-s { padding: 0 4px; }
.k-radio { display: flex; flex-direction: column; gap: 6px; min-width: 0; } .k-ro-h { color: var(--muted, #7a8294); font-size: 11px; font-weight: 600; } .k-ro-g { display: grid; gap: 6px; grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr)); }
.k-ro, .k-ro:hover { display: flex; align-items: flex-start; gap: 9px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line, #232833); background: none; text-align: left; } .k-ro:not(:disabled):not(.on):hover { background: var(--hover, #1b2029); } .k-ro > .k-icon, .k-ro > .k-emoji { margin-top: 2px; color: var(--muted, #7a8294); }
.k-ro-l { display: flex; align-items: center; gap: 6px; min-width: 0; font-weight: 500; } .k-ro-t { color: var(--muted, #7a8294); font-size: 11px; white-space: normal; } .k-ro-d { flex: none; width: 14px; height: 14px; margin: 1px 0 0 auto; border: 1.5px solid var(--muted, #7a8294); border-radius: 50%; }
.k-ro.on { border-color: var(--accent, #7aa2f7); background: color-mix(in srgb, var(--accent, #7aa2f7) 9%, transparent); cursor: default; } .k-ro.on > .k-icon { color: var(--accent, #7aa2f7); } .k-ro.on .k-ro-d { border: 4px solid var(--accent, #7aa2f7); }
@container kit (max-width: 300px) { .k-ro-g { grid-template-columns: minmax(0, 1fr); } } .k[data-kit=preview] .k-ro { padding: 4px 8px; } .k[data-kit=preview] .k-ro-g, .k[data-kit=preview] .k-radio { gap: 4px; }
.k[data-line] .k-radio, .k[data-line] .k-ro-g { display: flex; flex: none; flex-direction: row; gap: 4px; } .k[data-line] .k-ro { flex: none; padding: 0 7px; } .k[data-line] .k-ro-d, .k[data-line] .k-ro > .k-icon { display: none; }
.k-area { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); } .k-area:focus-within { border-color: color-mix(in srgb, var(--accent, #7aa2f7) 60%, transparent); }
.k .k-area textarea { display: block; padding: 8px 10px; border: 0; border-radius: 0; outline: none; resize: none; line-height: 1.45; } .k-area-f { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 4px 6px; }
.k[data-kit=preview] .k-area { flex: 1; min-height: 0; } .k[data-kit=preview] .k-area textarea { flex: 1; padding: 4px 8px; font-size: 11px; } .k[data-kit=preview] .k-area-f { padding: 2px 4px; } .k[data-kit=preview] .k-area-f .k-sub { display: none; }
.k-snip { min-width: 0; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); background: var(--hover, #1b2029); } .k-snip-bar { display: flex; gap: 2px; padding: 0 6px; border-bottom: 1px solid var(--line, #232833); overflow-x: auto; scrollbar-width: none; }
.k-snip-bar label { position: relative; padding: 4px 8px; margin-bottom: -1px; border-bottom: 2px solid transparent; color: var(--muted, #7a8294); font-size: 11px; white-space: nowrap; cursor: pointer; } .k-snip-bar label:hover { color: var(--fg, #d5d9e3); } .k-snip-bar input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.k-snip-bar label:has(input:checked) { color: var(--fg, #d5d9e3); border-bottom-color: var(--accent, #7aa2f7); } .k-snip-bar label:has(input:focus-visible) { outline: 1px solid var(--accent, #7aa2f7); } .k-snip-f { display: inline-flex; align-items: center; gap: 5px; padding: 4px 2px; color: var(--muted, #7a8294); font-size: 11px; }
.k-snip-c { position: relative; margin: 0; } .k-snip.tabs > .k-snip-c { display: none; } .k-snip-c pre { margin: 0; padding: 8px 34px 8px 10px; overflow: auto; font: 11.5px/1.5 var(--mono, ui-monospace, Menlo, monospace); } .k-snip-c > .k-copy { position: absolute; top: 6px; right: 6px; } .k-snip-d { margin-right: 8px; color: var(--muted, #7a8294); user-select: none; }
${[1, 2, 3, 4, 5, 6, 7, 8].map(i => `.k-snip:has(> .k-snip-bar > label:nth-child(${i}) input:checked) > .k-snip-c:nth-of-type(${i})`).join(', ')} { display: block; }
.k[data-kit=preview] .k-snip-c pre { padding: 5px 30px 5px 8px; font-size: 10.5px; } .k-snip-l { display: inline-flex; flex: none; align-items: center; gap: 6px; min-width: 0; } .k-snip-l code { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.k-env { display: flex; flex-direction: column; min-width: 0; font-size: 11.5px; } .k-env-r { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 26px; } .k-env-r + .k-env-r { border-top: 1px solid var(--line, #232833); }
.k-env-k { flex: 0 0 min(38%, 220px); overflow: hidden; color: var(--accent, #7aa2f7); text-overflow: ellipsis; white-space: nowrap; } .k-env-v, .k-env-r > .k-sc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-env-r > .k-tag, .k-env-r > .k-copy { flex: none; }
@container kit (max-width: 220px) { .k-env-r > .k-tag { display: none; } } .k[data-line] .k-env { flex-direction: row; gap: 10px; overflow: hidden; } .k[data-line] .k-env-r { flex: none; min-height: 0; border: 0; } .k[data-line] .k-env-r > :not(.k-env-k) { display: none; }
.k-up { display: flex; flex-direction: column; gap: 5px; min-width: 0; } .k-up-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; } .k-up-h span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-up-h b { flex: none; font-variant-numeric: tabular-nums; }
.k-up-b { display: flex; justify-content: flex-end; gap: 2px; height: 26px; min-width: 0; overflow: hidden; } .k-up-i { flex: 1 0 3px; max-width: 12px; border-radius: 2px; background: currentColor; } .k-up-i.none { color: var(--line, #232833); } .k-up-i:hover { opacity: 0.7; }
.k-up-x { display: flex; justify-content: space-between; color: var(--muted, #7a8294); font-size: 10.5px; } .k[data-kit=preview] .k-up-b { height: 20px; } .k[data-line] .k-up { flex: 1; flex-direction: row; align-items: center; gap: 6px; } .k[data-line] .k-up-b { flex: 1; height: 12px; min-width: 60px; } .k[data-line] .k-up-i { flex-basis: 2px; }
.k-deploys, .k-issues, .k-eps, .k-clocks { display: flex; flex-direction: column; min-width: 0; } :is(.k-dp, .k-is, .k-ep, .k-clk) + :is(.k-dp, .k-is, .k-ep, .k-clk) { border-top: 1px solid var(--line, #232833); } :is(.k-dp, .k-is, .k-ep)[data-open] { cursor: pointer; } :is(.k-dp, .k-is, .k-ep)[data-open]:hover { background: var(--hover, #1b2029); }
.k-dp { display: flex; align-items: center; gap: 9px; min-width: 0; min-height: 36px; } .k-dp > .k-tag { flex: none; } .k-dp .k-sub .k-icon { vertical-align: -1px; }
.k-dp-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: currentColor; } .k-dp-dot.live { box-shadow: 0 0 0 0 currentColor; animation: k-ping 1.6s ease-out infinite; } @keyframes k-ping { 70% { box-shadow: 0 0 0 5px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.k-is { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; } .k-is-p { flex: none; display: inline-flex; color: var(--muted, #7a8294); } .k-is-id { flex: none; color: var(--muted, #7a8294); font: 11px var(--mono, ui-monospace, monospace); }
.k-is-s { flex: none; display: inline-flex; color: var(--muted, #7a8294); } .k-is-s.doing { color: var(--waiting, #e0af68); } .k-is-s.review { color: var(--done, #9ece6a); } .k-is-s.done { color: var(--tc-purple, #bb9af7); } .k-is > .k-title { flex: 1; min-width: 0; } .k-is-ls { display: flex; flex: none; gap: 4px; }
@container kit (max-width: 240px) { .k-is-id, .k-is-ls, .k-is > .k-av { display: none; } }
.k-ep { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; } .k-ep-m { flex: none; width: 50px; font: 600 10.5px var(--mono, ui-monospace, monospace); letter-spacing: 0.02em; } .k-ep-p { min-width: 0; overflow: hidden; font: 11.5px var(--mono, ui-monospace, monospace); text-overflow: ellipsis; white-space: nowrap; } .k-ep-v { color: var(--tc-orange, #ff9e64); }
.k-ep-n { flex: none; color: var(--muted, #7a8294); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; } .k-ep-s { flex: none; min-width: 30px; font: 600 11px var(--mono, ui-monospace, monospace); text-align: right; } @container kit (max-width: 260px) { .k-ep-n { display: none; } .k-ep-m { width: auto; } }
.k-chl { display: flex; flex-direction: column; gap: 10px; min-width: 0; } .k-chl-r + .k-chl-r { padding-top: 10px; border-top: 1px solid var(--line, #232833); } .k-chl-h { display: flex; align-items: baseline; gap: 8px; min-width: 0; } .k-chl-h b { flex: none; font-weight: 600; } .k-chl-h .k-sub { min-width: 0; }
.k-chl-l { display: flex; flex-direction: column; gap: 3px; margin: 5px 0 0; padding: 0; list-style: none; } .k-chl-l li { display: flex; align-items: baseline; gap: 7px; min-width: 0; } .k-chl-l li > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.k-chl-t { flex: none; width: 62px; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, currentColor 14%, transparent); font: 600 10px/16px var(--mono, ui-monospace, monospace); text-align: center; } .k[data-kit=preview] .k-chl-l li > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k[data-line] .k-chl { flex-direction: row; gap: 10px; overflow: hidden; } .k[data-line] .k-chl-r { flex: none; padding: 0; border: 0; } .k[data-line] .k-chl-h .k-sub { display: none; }
.k-clk { display: flex; align-items: center; gap: 9px; min-width: 0; min-height: 30px; } .k-clk-i { flex: none; display: inline-flex; } .k-clk-t { flex: none; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.k[data-line] .k-clocks, .k[data-line] .k-deploys, .k[data-line] .k-issues, .k[data-line] .k-eps { flex-direction: row; gap: 12px; overflow: hidden; } .k[data-line] :is(.k-clk, .k-dp, .k-is, .k-ep) { flex: none; min-height: 0; border: 0; } .k[data-line] :is(.k-clk, .k-dp, .k-ep) .k-sub, .k[data-line] :is(.k-dp, .k-is) > :is(.k-tag, .k-av), .k[data-line] :is(.k-is-ls, .k-ep-n) { display: none; } .k[data-line] .k-clk-t { font-size: inherit; }
.k-funnel { display: flex; flex-direction: column; gap: 4px; min-width: 0; } .k-fn-r { display: grid; grid-template-columns: minmax(60px, 32%) minmax(0, 1fr) auto 44px 40px; align-items: center; gap: 8px; min-width: 0; font-size: 11.5px; }
.k-fn-l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .k-fn-t { height: 14px; overflow: hidden; border-radius: 3px; background: var(--hover, #1b2029); } .k-fn-t > i { display: block; height: 100%; border-radius: 3px; background: var(--accent, #7aa2f7); }
.k-fn-r > b { font-variant-numeric: tabular-nums; text-align: right; } .k-fn-p, .k-fn-d { color: var(--muted, #7a8294); font-size: 10.5px; font-variant-numeric: tabular-nums; text-align: right; } .k .k-fn-d.t-bad { color: var(--error, #f7768e); }
@container kit (max-width: 240px) { .k-fn-r { grid-template-columns: minmax(50px, 38%) minmax(0, 1fr) auto; } .k-fn-p, .k-fn-d { display: none; } } .k-fn-line { display: inline-flex; flex: none; align-items: baseline; gap: 5px; }
.k-sws { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); min-width: 0; } .k-sw, .k-sw:hover { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 4px; border: 1px solid var(--line, #232833); background: none; text-align: left; cursor: copy; } .k-sw:hover { background: var(--hover, #1b2029); }
.k-sw > i { flex: none; width: 26px; height: 26px; border-radius: calc(var(--radius, 6px) - 2px); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg, #d5d9e3) 14%, transparent); } .k-sw .k-sub { font-family: var(--mono, ui-monospace, monospace); font-size: 10px; }
.k[data-line] .k-sws { display: flex; flex: none; gap: 3px; } .k[data-line] .k-sw { padding: 0; border: 0; } .k[data-line] .k-sw > i { width: 12px; height: 12px; } .k[data-line] .k-sw .k-main { display: none; }
.k-mx { min-width: 0; overflow-x: auto; } .k .k-mx table { width: auto; border-collapse: separate; border-spacing: 3px; } .k .k-mx :is(th, td) { padding: 0; border: 0; vertical-align: middle; } .k .k-mx thead th { padding: 0 2px 2px; color: var(--muted, #7a8294); font-size: 10.5px; font-weight: 500; text-align: center; white-space: nowrap; }
.k .k-mx tbody th { padding-right: 8px; font-weight: 500; text-align: left; white-space: nowrap; } .k .k-mx td { width: 30px; min-width: 30px; height: 22px; border-radius: 4px; background: color-mix(in srgb, currentColor 12%, transparent); text-align: center; } .k .k-mx td:empty { background: var(--hover, #1b2029); } .k .k-mx td[data-open] { cursor: pointer; } .k .k-mx td[data-open]:hover { background: color-mix(in srgb, currentColor 24%, transparent); }
.k-mx td .k-icon { vertical-align: -2px; } .k-mx-run { display: inline-block; width: 9px; height: 9px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: -1px; animation: k-spin 0.9s linear infinite; } .k-mx-skip { display: inline-block; width: 9px; height: 2px; border-radius: 1px; background: currentColor; vertical-align: 3px; } .k-mx-todo { display: inline-block; width: 8px; height: 8px; border: 1.5px solid currentColor; border-radius: 50%; vertical-align: 0; }
.k-mx-line { display: inline-flex; flex: none; gap: 8px; } .k-mx-line > span { display: inline-flex; align-items: center; gap: 3px; } .k-mx-line .k-mx-run { width: 8px; height: 8px; }
.k-mq { min-width: 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); } .k-mq-t { display: flex; width: max-content; animation: k-mq var(--s, 20s) linear infinite; } .k-mq:hover .k-mq-t { animation-play-state: paused; }
.k-mq.rev .k-mq-t { animation-direction: reverse; } .k-mq-g { display: flex; flex: none; align-items: center; gap: 28px; padding-right: 28px; } .k-mq-i { display: inline-flex; flex: none; align-items: center; gap: 6px; white-space: nowrap; } a.k-mq-i { color: inherit; } a.k-mq-i:hover { color: var(--accent, #7aa2f7); text-decoration: none; }
@keyframes k-mq { to { transform: translateX(-50%); } } .k[data-line] .k-mq { flex: 1; }
.k-bento { display: grid; gap: 8px; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); grid-auto-rows: minmax(76px, auto); grid-auto-flow: dense; min-width: 0; }
.k-bt { --bt: var(--accent, #7aa2f7); display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px 12px; overflow: hidden; border: 1px solid var(--line, #232833); border-radius: calc(var(--radius, 6px) + 2px); background: radial-gradient(120% 90% at 0 0, color-mix(in srgb, var(--bt) 16%, transparent), transparent 65%), var(--hover, #1b2029); }
.k-bt.link { cursor: pointer; } .k-bt.link:hover { border-color: color-mix(in srgb, var(--bt) 50%, transparent); } .k-bt-i { display: inline-flex; color: var(--bt); } .k-bt-t { font-size: 14px; font-weight: 600; line-height: 1.25; } .k-bt-x { color: var(--muted, #7a8294); font-size: 11px; } .k-bt > .k-spark { margin-top: auto; color: var(--bt); }
@container kit (max-width: 340px) { .k-bento { grid-template-columns: repeat(2, minmax(0, 1fr)); } .k-bento > .k-bt:is(.w-3, .w-4, .w-5, .w-6) { grid-column: span 2 !important; } }
@container kit (max-width: 180px) { .k-bento { grid-template-columns: minmax(0, 1fr); } .k-bento > .k-bt { grid-column: span 1 !important; grid-row: span 1 !important; } }
.k[data-kit=preview] .k-bento { grid-auto-rows: minmax(56px, auto); gap: 6px; } .k[data-kit=preview] .k-bt { padding: 6px 8px; } .k[data-kit=preview] .k-bt-t { font-size: 12px; }
.k[data-line] .k-bento { display: flex; flex: none; gap: 10px; overflow: hidden; } .k[data-line] .k-bt { flex: none; flex-direction: row; align-items: center; gap: 5px; padding: 0; border: 0; background: none; } .k[data-line] .k-bt > :not(.k-bt-i):not(.k-bt-t) { display: none; } .k[data-line] .k-bt-t { font-size: inherit; }
@media (prefers-reduced-motion: reduce) { .k-mq-t { flex-wrap: wrap; width: auto; animation: none; } .k-mq-g { flex-wrap: wrap; row-gap: 6px; } .k-mq-g[inert] { display: none; } .k-dp-dot.live, .k-mx-run { animation-duration: 4s; } }
/* tones last, over an element's own color (a badge's, a bar's, a chart's) */
.k .t-good { color: var(--done, #9ece6a); } .k .t-bad { color: var(--error, #f7768e); } .k .t-warn { color: var(--waiting, #e0af68); } .k .t-accent { color: var(--accent, #7aa2f7); } .k .t-muted { color: var(--muted, #7a8294); } .k .k-badge.t-accent { color: var(--accent-fg, #fff); }`

// what every widget looks like before its own <style>: the app's colors and fonts (its CSS variables reach a widget
// in the sidebar; a JS widget's page gets them in its address), a number tile, tables, links
export const WIDGET_CSS = `:host, body { display: block; margin: 0; height: 100%; box-sizing: border-box; overflow: auto; color: var(--fg, #d5d9e3); font: 12px/1.4 var(--ui-font, -apple-system, system-ui, sans-serif); }
* { box-sizing: border-box; }
::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; } ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--fg, #d5d9e3) 14%, transparent); border-radius: 3px; } ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--fg, #d5d9e3) 32%, transparent); }
a { color: var(--accent, #7aa2f7); text-decoration: none; } a:hover { text-decoration: underline; }
.tile { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 6px; gap: 2px; overflow: hidden; }
.num { font-size: 24px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.label { color: var(--muted, #7a8294); font-size: 11px; line-height: 1.25; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--muted, #7a8294); } .small { font-size: 10.5px; } .nowrap { white-space: nowrap; }
.bad { color: var(--error, #f7768e); } .good { color: var(--done, #9ece6a); } .warn { color: var(--waiting, #e0af68); }
.spark { color: var(--accent, #7aa2f7); display: block; }
.tag { display: inline-block; margin: 0 4px 2px 0; padding: 0 6px; border: 1px solid var(--line, #232833); border-radius: 9px; font-size: 10.5px; line-height: 16px; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; } th { text-align: left; font-weight: 600; color: var(--muted, #7a8294); }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--line, #232833); vertical-align: top; }
button { font: inherit; color: inherit; background: var(--hover, #1b2029); border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); padding: 3px 10px; cursor: pointer; user-select: none; } /* a double click never selects its words */
[data-busy] { opacity: 0.6; cursor: progress; }
p { margin: 0 0 10px; }
.row { display: flex; align-items: center; gap: 6px; min-width: 0; } .col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.grow { flex: 1; min-width: 0; } .wrap { flex-wrap: wrap; } .fill { height: 100%; } .center { justify-content: center; align-items: center; text-align: center; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel { background: var(--hover, #1b2029); border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); padding: 8px 10px; }
.title { font-weight: 600; } .sub { color: var(--muted, #7a8294); font-size: 11px; }
.link { color: var(--fg, #d5d9e3); } .link:hover { color: var(--accent, #7aa2f7); text-decoration: none; }
.linkbar { display: flex; flex-wrap: wrap; align-items: center; row-gap: 2px; padding-left: 0; overflow: hidden; }
.linkbar > * { margin-left: -1px; padding: 1px 9px; border-left: 1px solid var(--line, #232833); color: var(--muted, #7a8294); line-height: 18px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.linkbar > a:hover { color: var(--fg, #d5d9e3); background: var(--hover, #1b2029); text-decoration: none; }
.linkbar.spread > * { flex: 1 1 auto; text-align: center; }
button.primary { background: var(--accent, #7aa2f7); border-color: transparent; color: var(--accent-fg, #fff); font-weight: 600; }
button.quiet { background: none; border-color: transparent; color: var(--muted, #7a8294); } button.quiet:hover { background: var(--hover, #1b2029); color: var(--fg, #d5d9e3); }
button.danger { color: var(--error, #f7768e); } button.sm { padding: 1px 7px; font-size: 11px; } button:disabled { opacity: 0.5; cursor: default; }
.list { list-style: none; margin: 0; padding: 0; } .list > li, .item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 2px; border-bottom: 1px solid var(--line, #232833); } .list > li:last-child, .item:last-child { border-bottom: none; }
.badge { display: inline-block; min-width: 16px; padding: 0 5px; border-radius: 8px; background: var(--accent, #7aa2f7); color: var(--accent-fg, #fff); font-size: 10.5px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
.dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.empty { color: var(--muted, #7a8294); text-align: center; padding: 10px; }
${UI_CSS}`

// what a widget asks the app to show (`laki.toast`, `laki.modal`, `laki.close` in a JS widget's page, or an action that
// prints it as JSON): a toast, bottom right, and a dialog: its words, a UI kit element drawn over its own data (its
// buttons run the extension's actions), and up to 6 buttons, each running one of its actions (arg), opening a link
// (http(s), mailto, laki://) or only closing it (style primary, danger or quiet; close false: it stays, 'done': once
// the action is done); none: OK, [] none. An id: a later dialog with it is drawn in its place; close (true, or that
// id) closes it. Anything else is dropped.
export type WidgetButton = { label: string; run?: string; arg?: string; open?: string; style?: 'primary' | 'danger' | 'quiet'; close?: false | 'done' }
export type SayModal = { id?: string; title: string; text?: string; ui?: Record<string, unknown>; data?: unknown; size?: 's' | 'm' | 'l'; buttons: WidgetButton[] }
export type WidgetSay = { toast?: string; modal?: SayModal; close?: true | string }
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const fits = (v: unknown, max: number) => {
  try {
    return JSON.stringify(v).length <= max
  } catch {
    return false
  }
}
const STYLES = ['primary', 'danger', 'quiet']
// a link an extension may open (a button's, an action's open): http(s), mailto or laki://
export const openOk = (u: unknown): u is string => typeof u === 'string' && /^(https?:|mailto:|laki:\/\/)/i.test(u)
export function sayOf(x: unknown): WidgetSay | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const o = x as Record<string, unknown>
  const toast = text(o.toast, 300)
  const m = o.modal && typeof o.modal === 'object' && !Array.isArray(o.modal) ? (o.modal as Record<string, unknown>) : undefined
  const buttons = (Array.isArray(m?.buttons) ? m.buttons : [])
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !!text(b.label, 40))
    .slice(0, 6)
    .map(b => ({ label: text(b.label, 40)!, run: text(b.run, 100), arg: typeof b.arg === 'string' || typeof b.arg === 'number' ? String(b.arg).slice(0, 2000) : undefined, open: [text(b.open, 2000)].find(openOk), style: STYLES.includes(String(b.style)) ? b.style : b.primary === true ? 'primary' : undefined, close: b.close === false ? false : b.close === 'done' ? 'done' : undefined }))
  const ui = m && m.ui && typeof m.ui === 'object' && !Array.isArray(m.ui) && typeof (m.ui as Record<string, unknown>).type === 'string' && fits(m.ui, 64_000) ? m.ui : undefined
  const none = Array.isArray(m?.buttons) && !m.buttons.length // [] : no buttons, the ✕ and Esc close it
  const modal = m && (text(m.title, 120) || text(m.text, 2000) || ui)
    ? { id: text(m.id, 60), title: text(m.title, 120) ?? '', text: text(m.text, 2000), ui, data: ui && m.data !== undefined && fits(m.data, 512_000) ? m.data : undefined, size: ['s', 'm', 'l'].includes(String(m.size)) ? m.size : undefined, buttons: buttons.length || none ? buttons : [{ label: 'OK', style: 'primary' }] }
    : undefined
  const close = o.close === true ? true : text(o.close, 60)
  return toast || modal || close ? JSON.parse(JSON.stringify({ toast, modal, close })) : null // without the undefined fields
}

// what a click in a widget does, for a template widget's shadow root (Widgets.tsx) and a JS page (pageOf embeds it as
// text: it uses nothing from outside itself). send tells the app: { laki: 'run', action, arg, label, confirm },
// 'open' (url), 'copy' (text), 'refresh', 'full'; a run's button waits (data-busy) until send's promise settles, or the
// app's done message (a page). Links and data-open open; data-run (data-arg, data-confirm, data-submit: the nearest
// [data-form]'s fields as JSON) runs an action; data-laki asks for refresh or the full view; data-copy copies; a
// [data-filter] box hides the [data-row]s of its [data-rows] whose words (not their buttons') don't match; data-more
// shows the rows a limit hid (a preview: its full view); a click elsewhere on a preview opens the full view (the app
// knows whether there is one)
export function uiBehave(root: { addEventListener: (t: string, f: (e: any) => void) => void; removeEventListener: (t: string, f: (e: any) => void) => void }, send: (m: Record<string, unknown>) => unknown) {
  const said = (x: any): string => [...x.childNodes].map((c: any) => (c.nodeType === 3 ? c.data : c.nodeType === 1 && c.localName !== 'button' && c.localName !== 'kbd' ? said(c) : '')).join('') // a row's words, not its buttons'
  // the rows of a box: those whose words have q (none: all but the extra ones, unless it's open)
  const sift = (box: any, q: string) => {
    const open = box.hasAttribute('data-open')
    box.querySelectorAll('[data-row]').forEach((x: any) => (x.hidden = q ? !said(x).toLowerCase().includes(q) : x.hasAttribute('data-extra') && !open))
    box.querySelectorAll('[data-group]').forEach((g: any) => (g.hidden = !g.querySelector('[data-row]:not([hidden])')))
    // a heading among its rows (a menu's): shown while a row up to the next one is
    box.querySelectorAll('[data-sect]').forEach((hd: any) => {
      let x = hd.nextElementSibling
      while (x && !x.hasAttribute('data-sect') && !(x.hasAttribute('data-row') && !x.hidden)) x = x.nextElementSibling
      hd.hidden = !x || x.hasAttribute('data-sect')
    })
    const more = box.querySelector('[data-more]')
    if (more) more.hidden = !!q
    const none = box.querySelector('[data-none]') // a palette's "Nothing matches"
    if (none) none.hidden = !q || !!box.querySelector('[data-row]:not([hidden])')
  }
  const all = (q: string): any[] => (d => (d && d.querySelectorAll ? [...d.querySelectorAll(q)] : []))((root as any).querySelectorAll ? root : (root as any).document) // a shadow root's, a page's
  const click = (e: any) => {
    const t = e.target && e.target.closest ? e.target : null
    if (!t) return
    // an open dropdown closes at a click outside it or in its menu (its own summary toggles it)
    let shut = false
    for (const dd of all('details.k-dd[open]')) if (!dd.contains(t) || t.closest('.k-dd-m')) (dd.open = false), (shut = true)
    // a hover card opened by the pointer: a click on its button keeps it open (it would toggle it shut)
    const pin = t.closest('.k-pop[data-hov] > [popovertarget]')
    if (pin) return void (e.preventDefault(), pin.parentNode.removeAttribute('data-hov'))
    const chip = t.closest('[data-chip]')
    if (chip) {
      // a filter's chip: the rows under it with its words; clicked again (or All), every row
      const box = chip.closest('[data-filt]')
      if (!box) return
      const v = chip.classList.contains('on') ? '' : chip.getAttribute('data-chip') || ''
      box.querySelectorAll('[data-chip]').forEach((c: any) => (on => (c.classList.toggle('on', on), c.setAttribute('aria-pressed', String(on))))((c.getAttribute('data-chip') || '') === v))
      box.querySelectorAll('[data-rows]').forEach((r: any) => sift(r, v.toLowerCase()))
      return
    }
    // the innermost thing to click wins: a button in a row that runs an action is the button's
    const hit = t.closest('[data-more], [data-run], [data-do], [data-copy], a[href], [data-open], [data-laki]')
    const at = (q: string) => (hit && hit.matches(q) ? hit : null)
    const more = at('[data-more]')
    const r = at('[data-run]')
    const d = at('[data-do]')
    const c = at('[data-copy]')
    const a = at('a[href]')
    const o = at('[data-open]')
    const b = at('[data-laki]')
    if (more) {
      e.preventDefault()
      const box = more.closest('[data-rows]')
      if (!more.closest('[data-kit="full"]') || !box) return void send({ laki: 'full' })
      box.setAttribute('data-open', '')
      box.querySelectorAll('[data-extra]').forEach((x: any) => (x.hidden = false))
      more.remove()
    } else if (r) {
      e.preventDefault()
      if (r.hasAttribute('data-busy')) return
      let arg = r.getAttribute('data-arg') ?? ''
      // an input's button: what's typed is the arg; nothing typed, the box gets the keyboard
      const box = r.hasAttribute('data-input') && r.closest('[data-inbox]')?.querySelector('input, textarea')
      if (box) {
        arg = String(box.value).trim()
        if (!arg) return void box.focus()
      }
      const form = r.hasAttribute('data-submit') && r.closest('[data-form]')
      if (form) {
        const v: Record<string, unknown> = {}
        form.querySelectorAll('input[name], select[name], textarea[name]').forEach((f: any) => (v[f.name] = f.type === 'checkbox' ? f.checked : f.type === 'number' ? (f.value === '' ? null : Number(f.value)) : f.value))
        arg = JSON.stringify(v)
      }
      r.setAttribute('data-busy', '')
      const p: any = send({ laki: 'run', action: r.getAttribute('data-run'), arg, label: (r.getAttribute('data-label') || r.textContent || '').trim(), confirm: r.getAttribute('data-confirm') || undefined })
      const clear = () => box && !r.hasAttribute('data-keep') && box.value.trim() === arg && (box.value = '')
      if (p && typeof p.then === 'function') p.then((ok: unknown) => (r.removeAttribute('data-busy'), ok !== false && clear()), () => r.removeAttribute('data-busy'))
      else clear() // a JS page's: the app says when it's done
    } else if (d) {
      // a Laki command: the app says what it will do and asks first
      e.preventDefault()
      let cmd = null
      try {
        cmd = JSON.parse(d.getAttribute('data-do') || 'null')
      } catch {}
      if (!cmd || typeof cmd !== 'object') return
      // a prompt box's button: what's typed is the prompt; nothing typed, the box gets the keyboard
      const box = d.hasAttribute('data-input') && d.closest('[data-inbox]')?.querySelector('input, textarea')
      if (box) {
        if (d.hasAttribute('data-busy')) return
        cmd.prompt = String(box.value).trim()
        if (!cmd.prompt) return void box.focus()
        d.setAttribute('data-busy', '')
      }
      const p: any = send({ laki: 'do', cmd, label: (d.getAttribute('data-label') || d.textContent || d.getAttribute('aria-label') || '').trim(), confirm: d.getAttribute('data-confirm') || undefined })
      // emptied once it went. ponytail: a JS page's box keeps its words (the app doesn't say back when a do went)
      const done = (ok: unknown) => box && (d.removeAttribute('data-busy'), ok === true && !d.hasAttribute('data-keep') && box.value.trim() === cmd.prompt && (box.value = ''))
      if (p && typeof p.then === 'function') p.then(done, () => done(false))
      else done(false)
    } else if (c) e.preventDefault(), send({ laki: 'copy', text: c.getAttribute('data-copy') })
    else if (a) e.preventDefault(), send({ laki: 'open', url: a.getAttribute('href') })
    else if (o) e.preventDefault(), send({ laki: 'open', url: o.getAttribute('data-open') })
    else if (b) e.preventDefault(), send({ laki: b.getAttribute('data-laki') })
    else if (!shut && !t.closest('button, input, select, textarea, label, summary, .k-sc, .k-dd-m, .k-pop-b, .k-cmp, [data-kit="full"]')) send({ laki: 'full' }) // .k-sc: a secret shown, to select; .k-cmp: a drag between pictures
  }
  const input = (e: any) => {
    const t = e.target && e.target.closest ? e.target : null
    if (!t) return
    if (t.type === 'range') return void (v => v && (v.textContent = t.value))(t.closest('.k-range')?.querySelector('[data-rv]')) // a slider's number as it moves
    const f = t.closest('[data-filter]')
    const box = f && f.closest('[data-rows]')
    if (box) sift(box, String(f.value).trim().toLowerCase())
  }
  // a slider let go, an option picked: runs its action with the value
  const change = (e: any) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-change]') : null
    if (!t) return
    const pick = t.localName === 'select' ? (t.selectedOptions?.[0]?.textContent ?? '').trim() : `${t.getAttribute('aria-label') || ''} ${t.value}`.trim() // its confirm's and note's words
    const p: any = send({ laki: 'run', action: t.getAttribute('data-change'), arg: String(t.value), label: pick, confirm: t.getAttribute('data-confirm') || undefined })
    // declined or failed: back to what the data says (a done one is drawn again from the new data)
    const back = () => {
      if (t.localName === 'select') for (const o of t.options) o.selected = o.defaultSelected
      else t.value = t.defaultValue
      const v = t.closest('.k-range')?.querySelector('[data-rv]')
      if (v) v.textContent = t.value
    }
    if (!p || typeof p.then !== 'function') return
    t.disabled = true // one run at a time: a second pick meanwhile would race it
    p.then((ok: unknown) => ok === false && back(), back).finally(() => (t.disabled = false))
  }
  // a dropdown left for somewhere else, the rest of the app too: closed
  const blur = (e: any) => {
    const dd = e.target && e.target.closest ? e.target.closest('details.k-dd[open]') : null
    if (dd && !(e.relatedTarget && dd.contains(e.relatedTarget))) dd.open = false
  }
  // Enter in an input's box clicks its button, ⌘ Enter in a textarea's; in a palette ↑ ↓ go through its rows and Enter
  // in its box runs the first
  const key = (e: any) => {
    const t = e.target && e.target.closest ? e.target : null
    if (!t || e.isComposing) return
    // Esc closes an open popover or dropdown first, not the full view's dialog under it (it waits for a key not taken)
    if (e.key === 'Escape') {
      const open = all('.k-pop-b:popover-open, details.k-dd[open]')
      if (open.length) e.preventDefault(), open.forEach((x: any) => (x.localName === 'details' ? (x.open = false) : x.hidePopover()))
      return
    }
    const cmd = t.closest('.k-cmd')
    if (cmd && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.key === 'Enter' && t.localName === 'input'))) {
      const rows = [...cmd.querySelectorAll('.k-mn-i:not([hidden]):not(:disabled)')]
      const i = rows.indexOf(t)
      const to = e.key === 'Enter' ? rows[0] : e.key === 'ArrowDown' ? rows[i + 1] : i > 0 ? rows[i - 1] : i === 0 ? cmd.querySelector('input') : null
      if (!to) return
      e.preventDefault()
      return void (e.key === 'Enter' ? to.click() : to.focus())
    }
    if (e.key !== 'Enter') return
    const b = t.closest('[data-inbox]')?.querySelector('[data-input]')
    if (b && (t.localName === 'input' || (t.localName === 'textarea' && (e.metaKey || e.ctrlKey)))) e.preventDefault(), b.click()
  }
  // a hover card: open while the pointer is on it, unless a click pinned it (data-hov: opened by the pointer); it goes
  // a moment after the pointer leaves, so the pointer can cross the gap to the card
  const hover = (e: any) => {
    const pop = e.target && e.target.closest ? e.target.closest('.k-pop.hover') : null
    const b = pop && pop.querySelector('[popover]')
    if (!b || (e.relatedTarget && pop.contains(e.relatedTarget))) return
    clearTimeout(pop.kHide)
    const shut = () => {
      try {
        if (pop.hasAttribute('data-hov')) b.hidePopover(), pop.removeAttribute('data-hov')
      } catch {} // gone from the page meanwhile
    }
    try {
      if (e.type === 'mouseover' && !b.matches(':popover-open')) b.showPopover(), pop.setAttribute('data-hov', '')
    } catch {}
    if (e.type === 'mouseout') pop.kHide = setTimeout(shut, 250)
  }
  // a clock's time, every 15 s (its options are widgetUi.ts' CLOCK's)
  const tick = () =>
    all('[data-clock]').forEach((c: any) => {
      try {
        const h12 = c.hasAttribute('data-h12')
        c.textContent = new Intl.DateTimeFormat('en-US', { timeZone: c.getAttribute('data-clock') || undefined, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23' }).format(new Date())
      } catch {}
    })
  const clock: any = setInterval(tick, 15_000)
  clock?.unref?.() // node's (the tests'): it never holds the process
  // a full view's dropdown opened near its bottom: its menu scrolled into sight (toggle doesn't bubble: caught on the way down)
  const toggle = (e: any) => {
    const t = e.target
    if (t && t.open && t.matches && t.matches('details.k-dd') && t.closest('[data-kit="full"]')) t.querySelector('.k-dd-m')?.scrollIntoView({ block: 'nearest' })
  }
  const on: [string, (e: any) => void, boolean?][] = [['click', click], ['input', input], ['change', change], ['keydown', key], ['toggle', toggle, true], ['focusout', blur], ['mouseover', hover], ['mouseout', hover]]
  for (const [k, f, c] of on) (root as any).addEventListener(k, f, c)
  return () => (clearInterval(clock), on.forEach(([k, f, c]) => (root as any).removeEventListener(k, f, c)))
}

// a JS widget's page (the daemon serves it, sandboxed, to a frame of the app): the filled template with window.laki
// (data, config, at, error, full; refresh(), open(url), expand(), run(action, arg), do({ do, prompt… }), toast(text), modal({ title, text,
// buttons }), ui(spec, data) and mount(el, spec, data): the UI kit's HTML, which the app makes); its clicks are
// uiBehave's; Esc closes the full view. The app takes them only right after a click in the frame
// vars: the app's theme (its CSS variables), as the app asked for the page
export function pageOf(body: string, ctx: Record<string, unknown>, vars: Record<string, string> = {}) {
  const json = JSON.stringify(ctx).replace(/</g, '\\u003c')
  // color-scheme too: a frame whose scheme isn't the app's gets an opaque white backdrop
  const theme = Object.entries(vars)
    .filter(([k, v]) => typeof v === 'string' && (k === 'color-scheme' ? /^(light|dark|normal)( (light|dark))?$/.test(v) : /^--[\w-]+$/.test(k) && !/[<>{};\\]/.test(v)))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root { ${theme} } html { height: 100%; } ${WIDGET_CSS}</style><script>
const say = m => parent.postMessage(m, '*')
const uiWait = new Map()
window.laki = { ...${json}, refresh: () => say({ laki: 'refresh' }), open: url => say({ laki: 'open', url: String(url) }), expand: () => say({ laki: 'full' }), run: (action, arg, label) => say({ laki: 'run', action: String(action), arg: arg === undefined ? '' : String(arg), label: label === undefined ? '' : String(label) }), toast: text => say({ laki: 'say', toast: String(text) }), modal: m => say({ laki: 'say', modal: m }), close: id => say({ laki: 'say', close: id === undefined ? true : String(id) }), do: (cmd, label) => say({ laki: 'do', cmd, label: label === undefined ? '' : String(label) }), send: (text, label) => laki.do({ do: 'send', prompt: String(text) }, label), ai: (text, label) => laki.do({ do: 'ai', prompt: String(text) }, label),
  log: (...a) => say({ laki: 'log', text: a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x) } catch { return String(x) } })())).join(' ').slice(0, 2048) }),
  ui: (spec, data) => new Promise(ok => { const req = uiWait.size + Math.random(); uiWait.set(req, ok); say({ laki: 'ui', req, spec, ctx: { data: data === undefined ? laki.data : data, config: laki.config, at: laki.at, error: laki.error, full: laki.full, workspace: laki.workspace, facts: laki.facts } }) }),
  mount: (el, spec, data) => laki.ui(spec, data).then(html => { el.innerHTML = html }) }
;(${String(uiBehave)})(window, say)
addEventListener('keydown', e => e.key === 'Escape' && !e.defaultPrevented && say({ laki: 'close' })) // not one that closed a popover or dropdown
// a preview's content width, for a bar's Auto: the page at max-content for a moment (no paint between), said as it changes:
// a node or text changed, or any element's size (a font that came late, words that wrapped in a frame too narrow)
if (!laki.full) addEventListener('DOMContentLoaded', () => {
  let was = 0
  const fit = () => {
    const h = document.documentElement, s = h.style.width
    h.classList.add('laki-measure'), (h.style.width = 'max-content')
    const w = Math.ceil(h.getBoundingClientRect().width)
    h.classList.remove('laki-measure'), (h.style.width = s)
    if (w > 0 && w !== was) say({ laki: 'size', w: (was = w) })
  }
  const sizes = new ResizeObserver(fit)
  const watch = () => (sizes.disconnect(), [...document.body.querySelectorAll('*')].slice(0, 200).forEach(e => sizes.observe(e))) // ponytail: a preview's first 200 elements
  fit(), watch(), new MutationObserver(() => (watch(), fit())).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  document.fonts?.addEventListener('loadingdone', fit), addEventListener('load', fit)
})
// the app says an action is done (its buttons work again), or gives the UI kit's HTML
addEventListener('message', e => {
  if (e.source !== parent || !e.data) return
  if (e.data.laki === 'ui' && uiWait.has(e.data.req)) uiWait.get(e.data.req)(String(e.data.html ?? '')), uiWait.delete(e.data.req)
  if (e.data.laki === 'done') document.querySelectorAll('[data-run][data-busy]').forEach(r => r.getAttribute('data-run') === e.data.action && (r.hasAttribute('data-submit') || r.hasAttribute('data-input') || (r.getAttribute('data-arg') ?? '') === e.data.arg) && r.removeAttribute('data-busy'))
})
</script></head><body>${body}</body></html>`
}
