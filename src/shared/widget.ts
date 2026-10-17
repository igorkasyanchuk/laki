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
// .k is a container: an element adapts to the cells it has (1, 2 or 3 across); data-line: a bar's line (½ high)
export const UI_CSS = `.k { container: kit / inline-size; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
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
.k[data-line] .k-table thead, .k[data-line] :is(.k-gh, .k-filter, .k-more, .k-sh, .k-ch-head, .k-ch-axis, .k-legend) { display: none; } .k[data-line] .k-stack { flex-direction: row; align-items: center; } .k[data-line] .k-table :is(th, td) { padding: 0 6px; border: 0; }
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
/* tones last, over an element's own color (a badge's, a bar's, a chart's) */
.k .t-good { color: var(--done, #9ece6a); } .k .t-bad { color: var(--error, #f7768e); } .k .t-warn { color: var(--waiting, #e0af68); } .k .t-accent { color: var(--accent, #7aa2f7); } .k .t-muted { color: var(--muted, #7a8294); } .k .k-badge.t-accent { color: var(--accent-fg, #fff); }`

// what every widget looks like before its own <style>: the app's colors and fonts (its CSS variables reach a widget
// in the sidebar; a JS widget's page gets them in its address), a number tile, tables, links
export const WIDGET_CSS = `:host, body { display: block; margin: 0; height: 100%; box-sizing: border-box; overflow: auto; color: var(--fg, #d5d9e3); font: 12px/1.4 var(--ui-font, -apple-system, system-ui, sans-serif); }
* { box-sizing: border-box; }
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
button { font: inherit; color: inherit; background: var(--hover, #1b2029); border: 1px solid var(--line, #232833); border-radius: var(--radius, 6px); padding: 3px 10px; cursor: pointer; }
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

// what a widget asks the app to show (`laki.toast`, `laki.modal` in a JS widget's page, or an action that prints it
// as JSON): a toast, bottom right, and a dialog with buttons, each running one of its actions (arg), opening a link
// (http(s), mailto, laki://) or only closing it; none: OK. Anything else is dropped.
export type WidgetButton = { label: string; run?: string; arg?: string; open?: string; primary?: boolean }
export type WidgetSay = { toast?: string; modal?: { title: string; text?: string; buttons: WidgetButton[] } }
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
export function sayOf(x: unknown): WidgetSay | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const o = x as Record<string, unknown>
  const toast = text(o.toast, 300)
  const m = o.modal && typeof o.modal === 'object' && !Array.isArray(o.modal) ? (o.modal as Record<string, unknown>) : undefined
  const buttons = (Array.isArray(m?.buttons) ? m.buttons : [])
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !!text(b.label, 40))
    .slice(0, 4)
    .map(b => ({ label: text(b.label, 40)!, run: text(b.run, 100), arg: typeof b.arg === 'string' || typeof b.arg === 'number' ? String(b.arg).slice(0, 2000) : undefined, open: [text(b.open, 2000)].find(u => u && /^(https?:|mailto:|laki:\/\/)/i.test(u)), primary: b.primary === true || undefined }))
  const modal = m && (text(m.title, 120) || text(m.text, 2000)) ? { title: text(m.title, 120) ?? '', text: text(m.text, 2000), buttons: buttons.length ? buttons : [{ label: 'OK', primary: true }] } : undefined
  return toast || modal ? JSON.parse(JSON.stringify({ toast, modal })) : null // without the undefined fields
}

// what a click in a widget does, for a template widget's shadow root (Widgets.tsx) and a JS page (pageOf embeds it as
// text: it uses nothing from outside itself). send tells the app: { laki: 'run', action, arg, label, confirm },
// 'open' (url), 'copy' (text), 'refresh', 'full'; a run's button waits (data-busy) until send's promise settles, or the
// app's done message (a page). Links and data-open open; data-run (data-arg, data-confirm, data-submit: the nearest
// [data-form]'s fields as JSON) runs an action; data-laki asks for refresh or the full view; data-copy copies; a
// [data-filter] box hides the [data-row]s of its [data-rows] that don't match; data-more shows the rows a limit hid (a
// preview: its full view); a click elsewhere on a preview opens the full view (the app knows whether there is one)
export function uiBehave(root: { addEventListener: (t: string, f: (e: any) => void) => void; removeEventListener: (t: string, f: (e: any) => void) => void }, send: (m: Record<string, unknown>) => unknown) {
  const click = (e: any) => {
    const t = e.target && e.target.closest ? e.target : null
    if (!t) return
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
      const form = r.hasAttribute('data-submit') && r.closest('[data-form]')
      if (form) {
        const v: Record<string, unknown> = {}
        form.querySelectorAll('input[name], select[name], textarea[name]').forEach((f: any) => (v[f.name] = f.type === 'checkbox' ? f.checked : f.type === 'number' ? (f.value === '' ? null : Number(f.value)) : f.value))
        arg = JSON.stringify(v)
      }
      r.setAttribute('data-busy', '')
      const p: any = send({ laki: 'run', action: r.getAttribute('data-run'), arg, label: (r.textContent || '').trim(), confirm: r.getAttribute('data-confirm') || undefined })
      if (p && typeof p.then === 'function') p.then(() => r.removeAttribute('data-busy'), () => r.removeAttribute('data-busy'))
    } else if (d) {
      // a Laki command: the app says what it will do and asks first
      e.preventDefault()
      let cmd = null
      try {
        cmd = JSON.parse(d.getAttribute('data-do') || 'null')
      } catch {}
      if (cmd && typeof cmd === 'object') send({ laki: 'do', cmd, label: (d.textContent || d.getAttribute('aria-label') || '').trim(), confirm: d.getAttribute('data-confirm') || undefined })
    } else if (c) e.preventDefault(), send({ laki: 'copy', text: c.getAttribute('data-copy') })
    else if (a) e.preventDefault(), send({ laki: 'open', url: a.getAttribute('href') })
    else if (o) e.preventDefault(), send({ laki: 'open', url: o.getAttribute('data-open') })
    else if (b) e.preventDefault(), send({ laki: b.getAttribute('data-laki') })
    else if (!t.closest('button, input, select, textarea, label, summary, [data-kit="full"]')) send({ laki: 'full' })
  }
  const input = (e: any) => {
    const f = e.target && e.target.closest ? e.target.closest('[data-filter]') : null
    const box = f && f.closest('[data-rows]')
    if (!box) return
    const q = String(f.value).trim().toLowerCase()
    const open = box.hasAttribute('data-open')
    box.querySelectorAll('[data-row]').forEach((x: any) => (x.hidden = q ? !String(x.textContent).toLowerCase().includes(q) : x.hasAttribute('data-extra') && !open))
    box.querySelectorAll('[data-group]').forEach((g: any) => (g.hidden = !g.querySelector('[data-row]:not([hidden])')))
    const more = box.querySelector('[data-more]')
    if (more) more.hidden = !!q
  }
  root.addEventListener('click', click)
  root.addEventListener('input', input)
  return () => (root.removeEventListener('click', click), root.removeEventListener('input', input))
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
window.laki = { ...${json}, refresh: () => say({ laki: 'refresh' }), open: url => say({ laki: 'open', url: String(url) }), expand: () => say({ laki: 'full' }), run: (action, arg, label) => say({ laki: 'run', action: String(action), arg: arg === undefined ? '' : String(arg), label: label === undefined ? '' : String(label) }), toast: text => say({ laki: 'say', toast: String(text) }), modal: m => say({ laki: 'say', modal: m }), do: (cmd, label) => say({ laki: 'do', cmd, label: label === undefined ? '' : String(label) }),
  ui: (spec, data) => new Promise(ok => { const req = uiWait.size + Math.random(); uiWait.set(req, ok); say({ laki: 'ui', req, spec, ctx: { data: data === undefined ? laki.data : data, config: laki.config, at: laki.at, error: laki.error, full: laki.full, workspace: laki.workspace } }) }),
  mount: (el, spec, data) => laki.ui(spec, data).then(html => { el.innerHTML = html }) }
;(${String(uiBehave)})(window, say)
addEventListener('keydown', e => e.key === 'Escape' && say({ laki: 'close' }))
// the app says an action is done (its buttons work again), or gives the UI kit's HTML
addEventListener('message', e => {
  if (e.source !== parent || !e.data) return
  if (e.data.laki === 'ui' && uiWait.has(e.data.req)) uiWait.get(e.data.req)(String(e.data.html ?? '')), uiWait.delete(e.data.req)
  if (e.data.laki === 'done') document.querySelectorAll('[data-run][data-busy]').forEach(r => r.getAttribute('data-run') === e.data.action && (r.hasAttribute('data-submit') || (r.getAttribute('data-arg') ?? '') === e.data.arg) && r.removeAttribute('data-busy'))
})
</script></head><body>${body}</body></html>`
}
