// Widgets' templates (daemon/widgets.ts renders them, the CLI and tests too): HTML with {{…}} filled from the widget's
// stored JSON. {{a.b}} (escaped; a list's .length), {{#each a}}…{{else}}…{{/each}} (inside: the item's fields, this,
// @index), {{#if a}}…{{else}}…{{/if}}, {{#unless a}}…{{/unless}} (an empty list is false), and helpers: {{date a}},
// {{ago a}}, {{spark a}} (a line chart of numbers, as SVG). No other code runs: the app shows the result as HTML.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (v: unknown) => (v === undefined || v === null ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/[&<>"']/g, c => ESC[c]))

type Node = string | { tag: string; arg: string; body: Node[]; alt: Node[] } | { get: string }
const BLOCKS = new Set(['each', 'if', 'unless'])

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

const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v)

const date = (v: unknown) => {
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
const HELPERS: Record<string, (v: unknown) => string> = { date: v => esc(date(v)), ago: v => esc(ago(v)), spark }

function run(nodes: Node[], scopes: Record<string, unknown>[]): string {
  let out = ''
  for (const n of nodes) {
    if (typeof n === 'string') out += n
    else if ('get' in n) {
      const [a, b] = n.get.split(/\s+/)
      out += b !== undefined && Object.hasOwn(HELPERS, a) ? HELPERS[a](lookup(scopes, b)) : esc(lookup(scopes, n.get))
    } else {
      const v = lookup(scopes, n.arg)
      if (n.tag === 'each') {
        const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []
        out += list.length ? list.map((item, i) => run(n.body, [{ ...(item && typeof item === 'object' ? item : {}), this: item, '@index': i }, ...scopes])).join('') : run(n.alt, scopes)
      } else out += run(truthy(v) === (n.tag === 'if') ? n.body : n.alt, scopes)
    }
  }
  return out
}

export const render = (template: string, ctx: Record<string, unknown>) => run(parse(template), [ctx])

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
p { margin: 0 0 10px; }`

// a JS widget's page (the daemon serves it, sandboxed, to a frame of the app): the filled template with window.laki
// (data, config, at, error, full; refresh(), open(url), expand(), run(action, arg)); links open in the browser,
// data-laki="refresh" or "full" on an element asks the app for that, data-run="<action>" (data-arg) runs one of
// widget.json's actions, a click elsewhere on a preview opens the full view, Esc closes it. The app takes these only
// right after a click in the frame
// vars: the app's theme (its CSS variables), as the app asked for the page
export function pageOf(body: string, ctx: Record<string, unknown>, vars: Record<string, string> = {}) {
  const json = JSON.stringify(ctx).replace(/</g, '\\u003c')
  // color-scheme too: a frame whose scheme isn't the app's gets an opaque white backdrop
  const theme = Object.entries(vars)
    .filter(([k, v]) => typeof v === 'string' && (k === 'color-scheme' ? /^(light|dark|normal)( (light|dark))?$/.test(v) : /^--[\w-]+$/.test(k) && !/[<>{};\\]/.test(v)))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root { ${theme} } ${WIDGET_CSS}</style><script>
const say = m => parent.postMessage(m, '*')
window.laki = { ...${json}, refresh: () => say({ laki: 'refresh' }), open: url => say({ laki: 'open', url: String(url) }), expand: () => say({ laki: 'full' }), run: (action, arg) => say({ laki: 'run', action: String(action), arg: arg === undefined ? '' : String(arg) }) }
addEventListener('click', e => {
  const t = e.target instanceof Element ? e.target : null
  const a = t && t.closest('a[href]'), b = t && t.closest('[data-laki]'), r = t && t.closest('[data-run]')
  if (a) e.preventDefault(), laki.open(a.href)
  else if (r) e.preventDefault(), laki.run(r.getAttribute('data-run'), r.getAttribute('data-arg') ?? undefined)
  else if (b) e.preventDefault(), say({ laki: b.getAttribute('data-laki') })
  else if (!laki.full && !(t && t.closest('button, input, select, textarea, label'))) laki.expand()
})
addEventListener('keydown', e => e.key === 'Escape' && say({ laki: 'close' }))
</script></head><body>${body}</body></html>`
}
