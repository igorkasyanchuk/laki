// Widgets (daemon/widgets.ts): the sidebar's grid of previews, above its foot (or a line of them in the top bar or the
// status bar: WidgetStrip, each widget's place), buttons on the rail and the sidebar's foot (WidgetButtons), and a
// widget's full view in a dialog.
// The daemon fills each template. A widget without scripts is shown in a shadow root (the app's CSS variables reach
// it, its styles stay in it) once `clean` has taken out what could run or navigate; one with scripts is a frame of
// the daemon's page for it, sandboxed, that talks to the app only in messages: open a link, refresh, the full view,
// run one of its actions.
// Only what's on screen is rendered: a folded grid, or a closed dialog, holds nothing.
import { createPortal } from 'react-dom'
import { Term } from './Term'
import { type CSSProperties, type DragEvent as RDrag, type KeyboardEvent as RKey, type MouseEvent, type PointerEvent as RPointer, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { placesOf, RETRY_KINDS, type TurnMark, type WidgetFail, type WidgetPlace, type WidgetView } from '../../shared/types'
import { ago, type SayModal, sayOf, uiBehave, WIDGET_CSS, type WidgetButton, type WidgetSay } from '../../shared/widget'
import { DO, type UiDo, uiHtml, type UiSpec } from '../../shared/widgetUi'
import { daemonBase } from './api'
import { ask, escapes, Icon, IconButton, isIconName, type MenuItem, act as press } from './ui'
import { diagramsIn } from './MarkdownView'

export type WidgetApi = {
  render: (id: string, full: boolean, sample?: boolean | string, cells?: [number, number], ws?: string, turn?: TurnAt) => Promise<string | null> // turn (P5): a turn chip's data; sample: widget.json's made-up data (a name: fixtures/<name>.json's); cells: where it shows (the UI kit's size); ws: a per-workspace one's instance
  run: (id: string, ws?: string) => Promise<unknown>
  open: (url: string) => void // http(s), mailto, laki://
  copy: (text: string) => void
  full: (id: string, ws?: string) => void // ws: that workspace's instance (a row mark's: it's selected)
  store?: (id: string, op: string, key: unknown, value: unknown, ws?: string) => Promise<unknown> // M1: a JS page's laki.store
  term?: (id: string, key: string, ws?: string) => Promise<{ tab: string }> // K1: a term element's terminal (widgetTerm)
  close: () => void // the full view's dialog (Esc in a JS widget's frame)
  action: (id: string, action: string, arg: string, label?: string, ws?: string) => Promise<false | void> // a button's data-run: one of widget.json's actions, done when it is (false: it failed)
  say: (id: string, s: WidgetSay, ws?: string) => void // a toast, a dialog with buttons
  do: (w: WidgetView, cmd: UiDo, label?: string) => Promise<unknown> | void // a Laki command (a button's do, laki.do): said and asked first; true once done
  settings: (id?: string, key?: string) => void // its page (Extension.tsx), key: at that setting; none: Settings › Extensions
  menu?: (w: WidgetView, e: MouseEvent) => void // its right click: items' in a menu
  items?: (w: WidgetView) => MenuItem[] // what its right click has anywhere: Fetch now, Inspect, Logs, Edit, on or off, places, size, Remix, Delete (the Desk's tiles add their own)
  log?: (id: string, text: string, ws?: string) => void // a JS page's laki.log: its log (widgetLog; nothing while off)
  fix?: (w: WidgetView) => void // R1: a failure's fix: a terminal with its command typed (w.fail.cmd), else its page
}

// R1: an offline failure isn't the extension's: its last data shows, stale, and nothing marks it failing
export const offline = (f?: WidgetFail) => f?.kind === 'offline'
const oldText = (f: WidgetFail) => `offline${f.since ? ` · ${(m => (m < 60 ? `${m} min` : `${Math.round(m / 60)} h`))(Math.max(1, Math.round((Date.now() - f.since) / 60_000)))} old` : ''}`
export const failed = (w: Pick<WidgetView, 'error' | 'fail'>) => !!w.error && !offline(w.fail) // marked failing: a red dot
// a failure's one fix (R1): its command typed in a terminal, Retry, or its page (Look)
export function FixButton({ w, api }: { w: WidgetView; api: WidgetApi }) {
  const f = w.fail
  if (!w.error || !f) return null
  const retry = RETRY_KINDS.includes(f.kind)
  return (
    <button className="sm" title={f.cmd ? `A terminal with ${f.cmd} typed, not run` : undefined} onClick={() => (retry ? void api.run(w.id, wsOf(w)).catch(() => {}) : api.fix?.(w))}>
      {f.cmd ? (f.kind === 'auth' ? 'Sign in' : 'Install') : retry ? 'Retry' : 'Look'}
    </button>
  )
}

// a box's Insert menu (show prompt): the actions of the ones on; a per-workspace one's only with a workspace (ws), a
// repo's only for its project
export const insertMenus = (widgets: WidgetView[] = [], ws?: string, project?: string) => widgets.filter(w => w.on && (w.scope !== 'workspace' || ws) && (!w.project || w.project === project)).flatMap(w => (w.menus ?? []).filter(m => m.show.includes('prompt')).map(m => ({ w, m })))

const LINK = /^(https?:|mailto:)/i
const OPEN = /^(https?:|mailto:|laki:\/\/)/i
// webview: the app window has webviewTag (the preview), and one in a Browsers partition may load any site.
// ponytail: <style> stays, widget.html's shared styles are the documented format (a style attribute could do as much)
const DROP = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'webview', 'form', 'base', 'meta', 'link', 'template', 'portal', 'animate', 'set', 'animatemotion', 'animatetransform', 'foreignobject'])
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'background', 'ping'])

// a widget's HTML without scripts, frames, forms, event attributes or URLs that go anywhere but a page (links open in
// the browser, below) or a data: image
// L7: the app window loads no picture from elsewhere itself (its CSP); an extension's https ones through the daemon's
// /img (App sets how, imgKey); none set: dropped
let viaDaemon: ((url: string) => string) | undefined
export const imagesVia = (f?: (url: string) => string) => void (viaDaemon = f)
export function clean(html: string): DocumentFragment {
  const t = document.createElement('template')
  t.innerHTML = html
  const walk = (n: ParentNode) => {
    for (const el of [...n.children]) {
      if (DROP.has(el.localName.toLowerCase())) {
        el.remove()
        continue
      }
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase()
        const v = a.value.trim()
        if (name === 'src' && /^https:/i.test(v)) {
          viaDaemon ? el.setAttribute(a.name, viaDaemon(v)) : el.removeAttribute(a.name)
          continue
        }
        if (name === 'srcset') {
          el.removeAttribute(a.name) // its own pictures, past /img: src alone
          continue
        }
        // a web address only on a link (a, area): anywhere else it's a load (an SVG <image>'s href, an http src), and the
        // CSP lets this Mac's own ports in
        const link = el.localName === 'a' || el.localName === 'area'
        if (name.startsWith('on') || (URL_ATTRS.has(name) && !((link && LINK.test(v)) || v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);/i.test(v)))) el.removeAttribute(a.name)
      }
      walk(el)
    }
  }
  walk(t.content)
  return t.content
}

// the theme's variables, for a JS widget's page (another document: they don't reach it), in its address
const VARS = ['--bg', '--side', '--panel', '--line', '--fg', '--muted', '--accent', '--accent-fg', '--sel', '--hover', '--running', '--waiting', '--done', '--error', '--radius', '--mono', '--ui-font', ...['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'lime', 'brown', 'gray'].map(c => `--tc-${c}`)] // the palette: the UI kit's colors
const themeVars = () => {
  const cs = getComputedStyle(document.documentElement)
  return { ...Object.fromEntries(VARS.map(v => [v, cs.getPropertyValue(v).trim()]).filter(([, x]) => x)), 'color-scheme': cs.colorScheme }
}

// one sample drawn: its buttons and links do nothing here, its filters and tabs work
export function KitBody({ spec, data, cells, ws }: { spec: UiSpec; data: unknown; cells: [number, number] | null; ws?: Record<string, unknown> }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = WIDGET_CSS
    root.replaceChildren(style, clean(uiHtml(spec, { data, config: {}, at: Date.now() - 120_000, sample: true, ...(ws && { workspace: ws }) }, cells ? { cells } : { full: true })))
    let live = true
    diagramsIn(root, () => live)
    const off = uiBehave(root, () => undefined)
    return () => ((live = false), off())
  }, [JSON.stringify(spec), JSON.stringify(data), cells?.join(), JSON.stringify(ws)]) // by value: a chat's looks come in new objects at each update
  return <div ref={host} className="widget-body" />
}

// a per-workspace one (scope workspace) as it shows in a workspace: that instance's fetch and button words over the
// widget's; ws null or undefined: none on screen (Board, Schedule, the AI page), `here` null: "Select a workspace"
export const inWs = (w: WidgetView, ws: string | null | undefined): WidgetView => {
  if (!w.scope) return w
  const i = ws ? w.inst?.[ws] : undefined
  return { ...w, here: ws ?? null, at: i?.at, error: i?.error, fail: i?.fail, running: i?.running, mock: i?.mock, hidden: i?.hidden, fx: i?.fx, ...(i && { label: i.label, badge: i.badge, tip: i.tip }) }
}
const wsOf = (w: WidgetView) => w.here ?? undefined
const NO_WS = uiHtml({ type: 'empty', icon: 'folder', text: 'Select a workspace' }, {}, {})

// what a click in a widget asks for (uiBehave's messages, a JS page's laki.…): a link, an action (asked first when it
// says confirm), a copy, a toast or dialog, a fetch, the full view. Done when the action is
function act(m: Record<string, unknown>, w: WidgetView, full: boolean, api: WidgetApi): Promise<unknown> | void {
  const { laki, url, action, arg, label, confirm, text } = m
  // an off one's page (a preview, its page's): no link, copy or dialog of its own, as no command (do, run: refused)
  if (!w.on && (laki === 'open' || laki === 'copy' || laki === 'say')) return void api.say(w.id, { toast: `${w.name} is off: turn it on first` }, wsOf(w))
  if (laki === 'open' && typeof url === 'string' && OPEN.test(url)) return api.open(url)
  if (laki === 'run' && typeof action === 'string' && action) return (typeof confirm === 'string' && confirm ? ask(confirm.slice(0, 300), { ok: String(label || 'Run').slice(0, 40) }) : Promise.resolve(true)).then((yes): unknown => yes && api.action(w.id, action, String(arg ?? ''), String(label ?? ''), wsOf(w)))
  if (laki === 'copy' && typeof text === 'string') return api.copy(text)
  if (laki === 'say') return (s => void (s && api.say(w.id, s, wsOf(w))))(sayOf(m))
  if (laki === 'do' && m.cmd && typeof m.cmd === 'object' && (DO as readonly string[]).includes(String((m.cmd as UiDo).do))) return api.do(w, m.cmd as UiDo, typeof label === 'string' ? label.slice(0, 60) : undefined) // true: done (a prompt box empties)
  if (laki === 'refresh') return void api.run(w.id, wsOf(w)).catch(() => {})
  if (laki === 'fix') return api.fix?.(w)
  if (laki === 'full' && !full && w.full) api.full(w.id)
}

// one widget's preview or full view; a click on a preview (not a link or button) opens the full view. sample: with its
// made-up data, as it would look (nothing it shows does anything). cells: where it shows, across and down (½: a bar)
export function WidgetBody({ w, full, api, sample, cells, onSize, turn, still }: { w: WidgetView; full: boolean; api: WidgetApi; sample?: boolean | string; cells?: [number, number]; onSize?: (px: number) => void; turn?: TurnAt; still?: boolean /* looked at only (a peek): its terminals take no keys */ }) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [err, setErr] = useState('')
  const [src, setSrc] = useState('')
  const [terms, setTerms] = useState<string[]>([]) // K1: its term elements' keys, a terminal each in its slot
  const config = JSON.stringify(w.config)
  const cfg = [...config].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) // a frame's address changes with it
  const theme = w.js ? JSON.stringify(themeVars()) : '' // and with the theme: read at each render (the app's renders follow a change of theme)
  const size = cells?.join('x') ?? ''
  const now = useRef({ w, full, api, sample, cells })
  now.current = { w, full, api, sample, cells }
  const rootOf = (el: HTMLDivElement) => el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  const none = w.here === null && !sample // per workspace, none on screen (a sample has a made-up one)
  const hide = `${w.hide?.refresh ? 'r' : ''}${w.hide?.at ? 'a' : ''}`
  useEffect(() => {
    let live = true
    setErr('')
    if (none) {
      // per workspace, none on screen
      if (host.current) rootOf(host.current).replaceChildren(Object.assign(document.createElement('style'), { textContent: WIDGET_CSS }), clean(NO_WS))
      return
    }
    if (w.js) {
      if (w.key) daemonBase().then(b => live && setSrc(`${b}/widget/${encodeURIComponent(w.id)}?key=${w.key}${full ? '&full=1' : ''}${sample ? `&sample=${sample === true ? 1 : encodeURIComponent(sample)}` : ''}${size ? `&cells=${size}` : ''}${w.here ? `&ws=${encodeURIComponent(w.here)}` : ''}${turn ? `&turn=${turn.tab}:${turn.at}` : ''}&at=${w.at ?? 0}&rev=${w.rev}&h=${hide}&net=${w.net ? 1 : 0}&c=${cfg}&theme=${encodeURIComponent(theme)}`))
      return () => void (live = false)
    }
    const root = rootOf(host.current!)
    api.render(w.id, full, sample, cells, wsOf(w), turn).then(
      html => {
        if (!live) return
        const style = document.createElement('style')
        style.textContent = WIDGET_CSS
        root.replaceChildren(style, clean(html ?? ''))
        diagramsIn(root, () => live)
        // its terminals: not a sample's, a turn's, nor a peek's (still: the command's words, nothing started)
        const keys = sample || turn || still || !now.current.api.term ? [] : [...new Set([...root.querySelectorAll<HTMLElement>('.k-term[data-term]')].map(e => e.dataset.term!))]
        setTerms(t => (t.join() === keys.join() ? t : keys))
      },
      e => live && setErr(String(e?.message ?? e)),
    )
    return () => void (live = false)
  }, [w.id, w.js, w.at, w.fx, w.rev, w.icons, w.net, w.here, none, full, config, w.key, theme, sample, size, hide, turn?.tab, turn?.at]) // fx: its facts changed; icons: the pack, width or size Settings picked (the daemon draws a template's); net: Network access's CSP needs the page loaded again; hide: drawn without what it hides
  // a template widget's clicks: uiBehave in its shadow root; made-up data: nothing it shows does anything (a button
  // clicked is done at once: uiBehave waits on what this returns)
  useEffect(() => {
    if (w.js || !host.current) return
    return uiBehave(rootOf(host.current), m => (n => (n.sample ? undefined : act(m, n.w, n.full, n.api)) ?? Promise.resolve())(now.current))
  }, [w.js])
  // a JS widget's messages: only from its own frame, and only right after a click in it (the frame has the focus,
  // the page a user activation), never on its script's own say (a refresh on load would loop: each fetch reloads it);
  // Esc in it closes the full view. The UI kit's HTML (laki.ui, laki.mount) it gets any time: nothing runs
  useEffect(() => {
    if (!w.js) return
    const f = (e: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (e.source !== win || !e.data || typeof e.data !== 'object') return
      const m = e.data as Record<string, unknown>
      // M1: its own store, any time (its own id only); a sample's page reads it, never writes
      if (m.laki === 'store') {
        const reply = (r: Record<string, unknown>) => win?.postMessage({ laki: 'store', req: m.req, ...r }, '*')
        const op = String(m.op)
        if (!now.current.api.store) return reply({ error: 'this Laki has no store' })
        if (now.current.sample && op !== 'get' && op !== 'keys') return reply({ error: 'a preview on sample data: its store is read only' })
        return void now.current.api.store(now.current.w.id, op, m.key, m.value, wsOf(now.current.w)).then(r => reply(r as Record<string, unknown>), e => reply({ error: String(e?.message ?? e) }))
      }
      if (m.laki === 'ui') return win?.postMessage({ laki: 'ui', req: m.req, html: uiHtml(m.spec, m.ctx && typeof m.ctx === 'object' ? (m.ctx as Record<string, unknown>) : {}, { full, cells: now.current.cells }) }, '*')
      if (m.laki === 'close' && full) return api.close()
      if (m.laki === 'log') return sample || api.log?.(w.id, String(m.text ?? '').slice(0, 2048), wsOf(w)) // any time, as a page's console: 50 a second at most (the daemon's)
      if (m.laki === 'size') return void (!full && typeof m.w === 'number' && m.w > 0 && onSize?.(Math.min(Math.ceil(m.w), 2000))) // its content's width: a bar's Auto
      const ok = !sample && document.activeElement === frame.current && navigator.userActivation?.isActive !== false // made-up data: its buttons and links do nothing
      const done = ok ? act(m, w, full, api) : undefined
      if (m.laki === 'run') void Promise.resolve(done).finally(() => win?.postMessage({ laki: 'done', action: m.action, arg: String(m.arg ?? '') }, '*')) // its button works again
    }
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  }, [w.js, w.id, w.full, full, sample])
  // the host stays mounted under an error: the next render (a fixed template, a reload) draws into it again
  return (
    <>
      {w.js && !none ? src && <iframe ref={frame} className="widget-frame" title={w.name} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" data-widget={w.id} data-view={full ? 'full' : 'preview'} data-sample={sample ? '' : undefined} /> : <div ref={host} className="widget-body" data-widget={w.id} data-view={full ? 'full' : 'preview'} data-sample={sample ? '' : undefined} />}
      {err && <div className="widget-msg warn small">{err}</div>}
      {!w.js && !none && host.current && terms.map(k => createPortal(<TermSlot key={k} w={w} k={k} live={full && !still} api={api} />, host.current!, k))}
    </>
  )
}
// K1: a term element's terminal, in the host's light DOM: its slot shows it in the kit's HTML, the app's CSS (xterm's)
// applies. Live in the full view (keys, focus); a cell, a peek: shown only
function TermSlot({ w, k, live, api }: { w: WidgetView; k: string; live: boolean; api: WidgetApi }) {
  const [tab, setTab] = useState<string>()
  const [err, setErr] = useState('')
  useEffect(() => {
    let on = true
    api.term?.(w.id, k, wsOf(w)).then(
      r => on && setTab(r.tab),
      e => on && setErr(String(e?.message ?? e)),
    )
    return () => void (on = false)
  }, [w.id, k, w.here])
  return (
    <div slot={`term-${k}`} className="ext-term">
      {err ? <div className="muted small pad">{err}</div> : tab && <Term key={`${tab}:${live}`} tab={tab} active={live} readOnly={!live} />}
    </div>
  )
}

// all: when it was fetched though the user hid it (its own page)
export const status = (w: WidgetView, all = false) => (w.running ? 'fetching…' : w.error && w.fail && offline(w.fail) ? oldText(w.fail) : w.error ? `failed: ${w.fail?.hint ?? w.error}` : w.hide?.at && !all ? '' : w.at ? `fetched ${ago(w.at)}` : w.every ? 'not fetched yet' : '')

// JS widgets stopped in Settings › Resources (laki-stop): unloaded until a click, wherever they show. Kept here, not in
// a strip's state: the status bar's goes away on a Browsers page, and a stop meanwhile would be lost
const parked = new Set<string>()
const parkSubs = new Set<() => void>()
const parkSay = () => parkSubs.forEach(f => f())
if (typeof window !== 'undefined')
  window.addEventListener('laki-stop', e => (d => typeof d === 'string' && d.startsWith('widget:') && (parked.add(d.slice(7)), parkSay()))((e as CustomEvent).detail))
function useParked() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick(n => n + 1)
    parkSubs.add(f)
    return () => void parkSubs.delete(f)
  }, [])
  return [[...parked], (id: string) => (parked.delete(id), parkSay())] as const
}

// P3: Edit layout (App's switch: ⌘K, Settings › Extensions): each extension in a place is dragged by itself, onto
// another (before it) or a place's empty room (its end), across places too; arrows move the focused one; a sidebar
// cell's corner resizes it. Clicks do nothing meanwhile. App keeps each change (widgetSet order, place, size)
export type LayoutEdit = { move: (id: string, from: WidgetPlace, to: WidgetPlace, before: string | null) => void; nudge: (id: string, place: WidgetPlace, by: -1 | 1) => void; size: (id: string, size: [number, number]) => void }
let editing: LayoutEdit | null = null
const editSubs = new Set<() => void>()
export const setLayoutEdit = (e: LayoutEdit | null) => ((editing = e), peekSet(null), editSubs.forEach(f => f()))
const onEdit = (f: () => void) => (editSubs.add(f), () => void editSubs.delete(f))
export const useLayoutEdit = () => useSyncExternalStore(onEdit, () => editing)
export const byOrder = (a: WidgetView, b: WidgetView) => (a.order ?? 1e9) - (b.order ?? 1e9) // its order, then as listed
const DRAG = 'laki/ext'
const NUDGE: Record<string, -1 | 1 | undefined> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }
const dragOf = (ev: RDrag) => (t => (t ? (JSON.parse(t) as [string, WidgetPlace]) : undefined))(ev.dataTransfer.getData(DRAG))
const editOf = (e: LayoutEdit | null, w: WidgetView, place: WidgetPlace) =>
  e
    ? {
        draggable: true,
        tabIndex: 0,
        'data-edit': '',
        'aria-label': `${w.name}: drag, or arrows, to move it`,
        onClickCapture: (ev: MouseEvent) => (ev.preventDefault(), ev.stopPropagation()),
        onDragStart: (ev: RDrag) => ((ev.dataTransfer.effectAllowed = 'move'), ev.dataTransfer.setData(DRAG, JSON.stringify([w.id, place]))),
        onDragOver: (ev: RDrag) => ev.dataTransfer.types.includes(DRAG) && ev.preventDefault(),
        onDrop: (ev: RDrag) => (d => d && (ev.preventDefault(), ev.stopPropagation(), d[0] !== w.id && e.move(d[0], d[1], place, w.id)))(dragOf(ev)),
        onKeyDown: (ev: RKey) => (by => by && (ev.preventDefault(), e.nudge(w.id, place, by)))(NUDGE[ev.key]),
      }
    : {}
const zoneOf = (e: LayoutEdit | null, place: WidgetPlace) => (e ? { 'data-zone': place, onDragOver: (ev: RDrag) => ev.dataTransfer.types.includes(DRAG) && ev.preventDefault(), onDrop: (ev: RDrag) => (d => d && (ev.preventDefault(), e.move(d[0], d[1], place, null)))(dragOf(ev)) } : {})
// the changes, through widgetSet: a place's extensions numbered again in tens as they now go; a move across places swaps
// the one it left for the one it's in. ponytail: one order per extension, shared by its places; per place if one in two
// places ever needs each its own
export function layoutEditor(list: () => WidgetView[], set: (id: string, o: { order?: number; place?: WidgetPlace[]; size?: [number, number] }) => Promise<unknown>): LayoutEdit {
  const ids = (p: WidgetPlace) =>
    list()
      .filter(w => w.on && placesOf(w).includes(p))
      .sort(byOrder)
      .map(w => w.id)
  const number = (order: string[]) => Promise.all(order.map((id, i) => list().find(w => w.id === id)?.order !== i * 10 && set(id, { order: i * 10 })))
  return {
    move: async (id, from, to, before) => {
      const w = list().find(x => x.id === id)
      if (!w) return
      if (from !== to) await set(id, { place: [...new Set([...placesOf(w).filter(p => p !== from), to])] })
      const order = ids(to).filter(x => x !== id)
      const at = before ? order.indexOf(before) : -1
      order.splice(at < 0 ? order.length : at, 0, id)
      await number(order)
    },
    nudge: (id, place, by) => {
      const order = ids(place)
      const i = order.indexOf(id)
      if (i < 0 || !order[i + by]) return
      ;[order[i], order[i + by]] = [order[i + by], order[i]]
      void number(order)
    },
    size: (id, size) => void set(id, { size }),
  }
}
export function LayoutBar({ onDone }: { onDone: () => void }) {
  if (!useLayoutEdit()) return null
  return (
    <div className="ext-layout-bar" role="status">
      <span>Drag an extension to move it, between places too; arrows move the focused one; a sidebar tile's corner resizes it.</span>
      <button type="button" className="primary" onClick={onDone}>
        Done
      </button>
    </div>
  )
}
const Zone = ({ e, place }: { e: LayoutEdit; place: WidgetPlace }) => (
  <span className="ext-zone muted small" {...zoneOf(e, place)}>
    Drop here
  </span>
)
// a sidebar cell's corner: its size from where the pointer is over the grid (4 across, half rows of 32 px), drawn as it
// goes, kept on release; Esc puts it back. ponytail: the Desk's own track has edge scrolling a cell this small needn't
function resize(ev: RPointer, w: WidgetView, e: LayoutEdit) {
  ev.preventDefault()
  ev.stopPropagation()
  const handle = ev.currentTarget as HTMLElement
  const cell = handle.closest('.widget') as HTMLElement
  const grid = cell?.parentElement
  if (!cell || !grid) return
  cell.classList.add('ext-resizing') // App's Esc leaves it to this
  const cw = grid.clientWidth / 4
  const box = cell.getBoundingClientRect()
  let size = w.size
  const was = [cell.style.gridColumn, cell.style.gridRow]
  handle.setPointerCapture(ev.pointerId)
  const move = (m: PointerEvent) => {
    size = [Math.min(4, Math.max(1, Math.round((m.clientX - box.left) / cw))), Math.min(4, Math.max(0.5, Math.round((m.clientY - box.top) / 32) / 2))]
    cell.style.gridColumn = `span ${size[0]}`
    cell.style.gridRow = `span ${size[1] * 2}`
  }
  const off = () => (cell.classList.remove('ext-resizing'), handle.removeEventListener('pointermove', move), handle.removeEventListener('lostpointercapture', end), window.removeEventListener('keydown', key, true))
  const end = () => (off(), (size[0] !== w.size[0] || size[1] !== w.size[1]) && e.size(w.id, size))
  const key = (k: KeyboardEvent) => k.key === 'Escape' && (k.preventDefault(), k.stopPropagation(), off(), ([cell.style.gridColumn, cell.style.gridRow] = was), handle.releasePointerCapture(ev.pointerId))
  handle.addEventListener('pointermove', move)
  handle.addEventListener('lostpointercapture', end)
  window.addEventListener('keydown', key, true)
}

// P4: a hover peek: 350 ms over a bar item, a row mark, a rail or foot button shows its full view, looked at only, in a
// popover by it; the pointer may go into it, a click there opens the full view. Not for one off, with a setting still
// unset, without a full view or a tooltip (tip: false), while the layout is edited, nor under reduced motion
const PEEK_MS = 350
type Peek = { w: WidgetView; at: DOMRect; side: 'below' | 'above' | 'right' }
let peek: Peek | null = null
let peekT: ReturnType<typeof setTimeout> | undefined
const peekSubs = new Set<() => void>()
const peekSet = (p: Peek | null) => ((peek = p), peekSubs.forEach(f => f()))
const onPeek = (f: () => void) => (peekSubs.add(f), () => void peekSubs.delete(f))
const peekable = (w: WidgetView) => w.on && w.full && !w.hide?.tip && !w.missing?.length && w.here !== null && !editing && !matchMedia('(prefers-reduced-motion: reduce)').matches
const peekOf = (w: WidgetView, side: Peek['side']) =>
  peekable(w)
    ? {
        onMouseEnter: (ev: MouseEvent) => {
          clearTimeout(peekT)
          const el = ev.currentTarget as HTMLElement
          peekT = setTimeout(() => el.isConnected && peekSet({ w, at: el.getBoundingClientRect(), side }), PEEK_MS)
        },
        onMouseLeave: () => (clearTimeout(peekT), (peekT = setTimeout(() => peekSet(null), 200))),
      }
    : {}
export function WidgetPeek({ widgets, api }: { widgets: WidgetView[]; api: WidgetApi }) {
  const p = useSyncExternalStore(onPeek, () => peek)
  const w = p && (x => x && inWs(x, p.w.here))(widgets.find(x => x.id === p.w.id))
  if (!p || !w || !peekable(w)) return null
  const W = 360
  const left = Math.max(8, Math.min(innerWidth - W - 8, p.side === 'right' ? p.at.right + 6 : p.at.left))
  const style: CSSProperties = p.side === 'below' ? { left, top: p.at.bottom + 6 } : p.side === 'above' ? { left, bottom: innerHeight - p.at.top + 6 } : { left, top: Math.max(8, Math.min(p.at.top, innerHeight - 320)) }
  return (
    <div className="ext-peek" style={{ ...style, width: W }} role="dialog" aria-label={`${w.name}: a click opens it`} onMouseEnter={() => clearTimeout(peekT)} onMouseLeave={() => peekSet(null)} onClick={() => (peekSet(null), api.full(w.id, w.here ?? undefined))}>
      <div className="ext-peek-head small">
        <b>{w.name}</b> <span className="muted">{status(w)}</span>
      </div>
      <div className="ext-peek-body">
        <WidgetBody w={w} full still api={api} />
      </div>
    </div>
  )
}

// P5: a tab's turn chips (the turn place's): each extension's face as that turn ended, its tone; a click opens its full
// view on that turn's data. Off or gone: none
export type TurnAt = { tab: string; at: number }
export function TurnChips({ marks, widgets, open }: { marks: TurnMark[]; widgets: WidgetView[]; open: (m: TurnMark) => void }) {
  const shown = marks.flatMap(m => (w => (w?.on ? [{ m, w }] : []))(widgets.find(x => x.id === m.widget)))
  if (!shown.length) return null
  return (
    <div className="turn-chips" onClick={e => e.stopPropagation()}>
      {shown.map(({ m, w }) => (
        <button key={`${m.widget}:${m.at}`} type="button" className={`turn-chip small ${m.tone ? `t-${m.tone}` : ''}`} data-tip={m.tip ?? w.name} aria-label={`${w.name}: ${m.tip ?? m.label ?? ''}`} onClick={() => open(m)}>
          <Glyph w={w} size={12} />
          <span>{m.label ?? w.name}</span>
          {m.badge && <span className="widget-badge">{m.badge}</span>}
        </button>
      ))}
    </div>
  )
}

// a widget as a button (its view's button: a rail or foot place, or no preview of its own): a click runs its click
// action, else opens its full view, else fetches it now (else its settings)
export const click = (w: WidgetView, api: WidgetApi) =>
  w.here === null ? undefined : w.click ? runClick(w, api, wsOf(w)) : w.full ? api.full(w.id) : w.every !== undefined ? void api.run(w.id, wsOf(w)).catch(() => {}) : api.settings(w.id)
// its click action, its confirm asked first (clickAsk), wherever it's clicked: a button, a row's mark
const runClick = (w: WidgetView, api: WidgetApi, ws?: string) => void (w.clickAsk ? ask(w.clickAsk.slice(0, 300), { ok: (w.label ?? w.name).slice(0, 40) }) : Promise.resolve(true)).then(yes => yes && api.action(w.id, w.click!, '', w.name, ws)).catch(() => {})
// its tooltip; none when its user (or widget.json's "tip": false) said so
const tipOf = (w: WidgetView) => (w.hide?.tip ? undefined : tipText(w))
const tipText = (w: WidgetView) => `${w.tip ?? w.name}${w.here === null ? ' · per workspace: select one' : status(w) ? ` · ${status(w)}` : ''}${w.dev ? ' · dev' : ''}${w.devError ? ` · last good version kept: ${w.devError}` : ''}${w.mock ? ' · sample data' : ''}`
// its icon: one of the app's by name, an emoji as it is, else its name's first letter
export function Glyph({ w, size = 14 }: { w: WidgetView; size?: number }) {
  if (isIconName(w.icon)) return <Icon name={w.icon} size={size} />
  return <span className="widget-glyph" style={{ fontSize: size - 1 }}>{w.icon && !/^[a-z]/i.test(w.icon) ? w.icon : ([...w.name.trim()][0] ?? '?').toUpperCase()}</span>
}
// a button widget in a cell (the sidebar's grid, a bar): its icon, label and badge across the cell
export function CellButton({ w, api }: { w: WidgetView; api: WidgetApi }) {
  return (
    <button className="widget-button" data-widget={w.id} data-view="button" onClick={() => click(w, api)} onContextMenu={api.menu && (e => (e.stopPropagation(), api.menu!(w, e)))}>
      <Glyph w={w} />
      <span className="widget-button-label">{w.label ?? w.name}</span>
      {w.badge && <span className="widget-badge">{w.badge}</span>}
    </button>
  )
}

// the rail's or the sidebar's foot's widgets: buttons like theirs (look), the rail's with its words under (words), the
// foot's beside (words: the foot's labels). places: those shown here (the foot takes the rail's when there's no rail)
// colors: the rail's (settings.railColors, by widget:<id>), its right click's swatches
export function WidgetButtons({ widgets, api, places, look, words, colors }: { widgets: WidgetView[]; api: WidgetApi; places: WidgetPlace[]; look: 'rail' | 'foot'; words: boolean; colors?: Record<string, string> }) {
  const edit = useLayoutEdit()
  const on = widgets.filter(w => w.on && placesOf(w).some(p => places.includes(p))).sort(byOrder)
  const items = on.map(w => {
    const dot = w.running ? 'rail-dot' : failed(w) ? 'rail-dot bad' : ''
    const here = placesOf(w).find(p => places.includes(p))!
    const peeks = peekOf(w, 'right')
    return look === 'rail' ? (
      <button key={`widget:${w.id}`} type="button" data-widget={w.id} data-view="button" className={`rail-kind nodrag ${w.here === null ? 'no-ws' : ''}`} aria-label={tipText(w)} data-tip={peeks.onMouseEnter ? undefined : tipOf(w)} onClick={() => click(w, api)} onContextMenu={api.menu && (e => (e.stopPropagation(), api.menu!(w, e)))} {...peeks} {...editOf(edit, w, here)}>
        <span className={`rail-icon ${colors?.[`widget:${w.id}`] ? 'tinted' : ''}`} style={colors?.[`widget:${w.id}`] ? ({ '--tab-c': `var(--tc-${colors[`widget:${w.id}`]})` } as CSSProperties) : undefined}>
          <Glyph w={w} size={18} />
          {w.badge ? <span className="rail-count">{w.badge}</span> : dot && <span className={dot} />}
        </span>
        {words && <span className="rail-label">{w.label ?? w.name}</span>}
      </button>
    ) : (
      <button key={`widget:${w.id}`} type="button" data-widget={w.id} data-view="button" className={`ib widget-foot ${words ? 'labeled' : ''} ${failed(w) && !w.running ? 'dot' : ''} ${w.here === null ? 'no-ws' : ''}`} aria-label={tipText(w)} data-tip={peeks.onMouseEnter ? undefined : tipOf(w)} onClick={() => click(w, api)} onContextMenu={api.menu && (e => (e.stopPropagation(), api.menu!(w, e)))} {...peeks} {...editOf(edit, w, here)}>
        <Glyph w={w} />
        {words && <span className="ib-label">{w.label ?? w.name}</span>}
        {w.badge && <span className="widget-badge">{w.badge}</span>}
      </button>
    )
  })
  return edit ? [...items, <Zone key="zone" e={edit} place={places[0]} />] : items
}

// a widget in its place: its preview (or Stopped · load), and a dot while it fetches or after it failed
// fit: a bar's Auto, its content's width, 4 cells at most (styles.css' .widget.fit, UI_CSS' :host-context); a JS page's
// as the page says it, kept while Auto is off too (it says it once), its cells until then
function Cell({ w, api, parked, load, style, cells, fit, place }: { w: WidgetView; api: WidgetApi; parked: boolean; load: () => void; style: CSSProperties; cells: [number, number]; fit?: boolean; place: WidgetPlace }) {
  const [fw, setFw] = useState(0)
  const edit = useLayoutEdit()
  const on = fit && (!w.js || w.button || fw > 0)
  const st = on ? ({ maxWidth: 'calc(4 * var(--widget-cell, 92px))', ...(fw > 0 && { '--fit-w': `${fw}px` }) } as CSSProperties) : style
  const peeks = place === 'side' ? {} : peekOf(w, place === 'top' ? 'below' : 'above')
  return (
    <div className={`widget ${w.full ? 'opens' : ''} ${w.button ? 'is-button' : ''} ${w.here === null ? 'no-ws' : ''} ${on ? 'fit' : ''}`} style={st} data-tip={peeks.onMouseEnter ? undefined : tipOf(w)} onContextMenu={api.menu && (e => api.menu!(w, e))} {...peeks} {...editOf(edit, w, place)}>
      {w.tooNew || w.missingBins?.length ? (
        // R2: a program it runs isn't on this Mac, or it's for a newer Laki: say so, its page says more
        <button className="widget-parked muted small" data-tip={w.tooNew ?? `${w.missingBins!.join(', ')}: not on the PATH its commands get`} onClick={() => api.settings(w.id)}>
          {w.tooNew ? `Needs a newer Laki` : `Needs ${w.missingBins!.join(', ')}`}
        </button>
      ) : w.missing?.length ? (
        // a setting it needs is empty: say which, and open it there
        <button className="widget-parked muted small" onClick={() => api.settings(w.id, w.missing![0])}>
          Set {(o => o?.label || o?.key)(w.options.find(o => o.key === w.missing![0]))}
        </button>
      ) : w.button ? (
        <CellButton w={w} api={api} />
      ) : w.js && parked ? (
        <button className="widget-parked muted small" onClick={load}>
          Stopped · load
        </button>
      ) : (
        <WidgetBody w={w} full={false} api={api} cells={cells} onSize={setFw} />
      )}
      {!w.missing?.length && (failed(w) || w.running || w.devError) && <span className={`widget-dot ${(failed(w) || w.devError) && !w.running ? 'bad' : ''}`} />}
      {w.mock ? <span className="widget-mock">Sample data</span> : w.error && offline(w.fail) && !w.running && <span className="widget-mock">{oldText(w.fail!)}</span>}
      {edit && place === 'side' && <span className="ext-resize" aria-label="Drag to resize" onPointerDown={e => resize(e, w, edit)} />}
    </div>
  )
}

// place panel: a tab of the right panel, its full view (else its preview) the panel's width; a per-workspace one's
// instance in the workspace the panel is for
export function WidgetPanel({ w, api }: { w: WidgetView; api: WidgetApi }) {
  return (
    <div className="widget-panel" onContextMenu={api.menu && (e => api.menu!(w, e))}>
      <WidgetBody w={w} full={w.full} api={api} cells={[3, 4]} />
      {(w.error || w.mock) && (
        <p className={`small ${failed(w) ? 'warn' : 'muted'}`}>
          {w.error ? status(w) : 'Sample data'} <FixButton w={w} api={api} />
        </p>
      )}
    </div>
  )
}

// place row: a per-workspace one's mark on each workspace's row (and its peek card), its instance's badge (else label),
// tip and its data's tone; a click runs its click action there, else opens that workspace's full view, else goes on to
// the row (it selects the workspace)
export const rowMarks = (widgets: WidgetView[], ws: string) => widgets.filter(w => w.on && w.scope === 'workspace' && placesOf(w).includes('row') && !w.inst?.[ws]?.hidden && (w.inst?.[ws]?.badge || w.inst?.[ws]?.label))
export function RowMarks({ widgets, ws, api }: { widgets: WidgetView[]; ws: string; api: WidgetApi }) {
  const on = rowMarks(widgets, ws)
  return (
    <>
      {on.map(w => {
        const i = w.inst![ws]
        const go = w.click ? () => runClick(w, api, ws) : w.full ? () => api.full(w.id, ws) : undefined
        return (
          <span key={w.id} className={`ws-ext ${failed(i) ? 'bad' : i.tone ? `t-${i.tone}` : ''}`} data-tip={w.hide?.tip && !i.error ? undefined : `${i.tip ?? w.name}${i.error ? ` · ${i.fail?.hint ?? i.error}` : ''}`} {...peekOf(inWs(w, ws), 'right')} {...press(go && ((e: React.MouseEvent) => (e.stopPropagation(), go())))}>
            <Glyph w={w} size={10} />
            {i.badge || i.label}
          </span>
        )
      })}
    </>
  )
}

// a sidebar cell's width where an extension is previewed (Settings, its page, the UI kit): the grid's 4 across the
// default 240 px sidebar
export const CELL_W = 60

// the sidebar's widgets: a grid 4 cells across, each widget its size in cells, plain (no tiles, no head); with the Desk off
// (experimental), one placed only there too: else it would show nowhere
export function WidgetGrid({ widgets, api, desk }: { widgets: WidgetView[]; api: WidgetApi; desk?: boolean }) {
  const [parked, load] = useParked()
  const edit = useLayoutEdit()
  const on = widgets.filter(w => w.on && (l => l.includes('side') || (!desk && l.every(p => p === 'desk')))(placesOf(w))).sort(byOrder)
  if (!on.length && !edit) return null
  return (
    <div className="widgets widget-grid" {...zoneOf(edit, 'side')}>
      {on.map(w => (
        <Cell key={w.id} w={w} api={api} place="side" parked={parked.includes(w.id)} load={() => load(w.id)} cells={w.size} style={{ gridColumn: `span ${w.size[0]}`, gridRow: `span ${w.size[1] * 2}` /* half rows: ½ is a thin line */ }} />
      ))}
      {edit && <Zone e={edit} place="side" />}
    </div>
  )
}

// the top bar's or the status bar's widgets: a line high, each as wide as its cells across (a ½-high one fits best)
export function WidgetStrip({ widgets, api, place }: { widgets: WidgetView[]; api: WidgetApi; place: 'top' | 'status' }) {
  const [parked, load] = useParked()
  const edit = useLayoutEdit()
  const on = widgets.filter(w => w.on && placesOf(w).includes(place) && w.here !== null).sort(byOrder) // a per-workspace one with no workspace here (a terminal, a browser): nothing to show in a bar
  if (!on.length && !edit) return null
  return (
    <div className={`widget-strip ${place} nodrag`} {...zoneOf(edit, place)}>
      {on.map(w => (
        <Cell key={w.id} w={w} api={api} place={place} parked={parked.includes(w.id)} load={() => load(w.id)} cells={[w.size[0], 0.5]} fit={w.fit} style={{ width: `calc(${w.size[0]} * var(--widget-cell, 92px))` }} />
      ))}
      {edit && <Zone e={edit} place={place} />}
    </div>
  )
}

// a widget's full view: a dialog over the app
export function WidgetDialog({ w, api, onClose, turn }: { w: WidgetView; api: WidgetApi; onClose: () => void; turn?: TurnAt }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal widget-modal ${w.view ?? 'm'}`} role="dialog" aria-label={w.name}>
        <div className="widget-modal-head">
          <b>{w.name}</b>
          {turn ? <span className="small muted">After the turn of {new Date(turn.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : <span className={`small ${failed(w) && !w.running ? 'warn' : 'muted'}`}>{status(w)}</span>}
          {!w.running && !turn && <FixButton w={w} api={api} />}
          <span className="spacer" />
          {w.every !== undefined && !w.hide?.refresh && !turn && <IconButton icon="refresh" title="Fetch now" onClick={() => void api.run(w.id, wsOf(w)).catch(() => {})} />}
          <IconButton icon="settings" title="Edit: its settings, preview, Laki AI" onClick={() => api.settings(w.id)} />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        <div className="widget-full">
          <WidgetBody w={w} full api={api} turn={turn} />
        </div>
      </div>
    </div>
  )
}

// an extension's own dialog (a say's modal: an action's JSON, laki.modal): its words, a UI kit element over its own data
// (its buttons run the extension's actions, as in its full view) and its buttons. A button closes it first (close
// false: it stays while its action runs; 'done': once it's done); a later say with its id is drawn in its place, a
// close with its id (or true) closes it. onClose(m): only while m is still the one shown
export function WidgetModal({ w, ws, m, api, onClose }: { w: WidgetView; ws?: string; m: SayModal; api: WidgetApi; onClose: (m?: SayModal) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(-1)
  const here = { ...w, here: ws ?? w.here }
  const now = useRef({ here, api })
  now.current = { here, api }
  const ui = JSON.stringify([m.ui, m.data])
  useEffect(() => {
    if (!m.ui || !host.current) return
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    root.replaceChildren(Object.assign(document.createElement('style'), { textContent: WIDGET_CSS }), clean(uiHtml(m.ui, { data: m.data, config: w.config ?? {}, at: Date.now() }, { full: true })))
    return uiBehave(root, x => act(x, now.current.here, true, now.current.api) ?? Promise.resolve())
  }, [ui])
  useEffect(() => {
    const back = document.activeElement
    ;(box.current?.querySelector<HTMLElement>('.ext-modal-buttons button.primary') ?? box.current)?.focus() // Enter: the primary one; none: no button takes it by chance
    const f = (e: KeyboardEvent) => escapes(e) && (e.preventDefault(), e.stopPropagation(), onClose()) // before the full view under it (an ask over it took it first)
    window.addEventListener('keydown', f, true)
    return () => {
      window.removeEventListener('keydown', f, true)
      if (back instanceof HTMLElement && back.isConnected) back.focus() // the terminal it came from
    }
  }, [])
  const press = (b: WidgetButton, i: number) => {
    if (b.open) return void (api.open(b.open), b.close !== false && onClose(m))
    if (!b.run) return onClose(m)
    if (b.close === undefined) return void (onClose(m), api.action(w.id, b.run, b.arg ?? '', b.label, here.here ?? undefined))
    setBusy(i)
    void api.action(w.id, b.run, b.arg ?? '', b.label, here.here ?? undefined).then(r => (setBusy(-1), b.close === 'done' && r !== false && onClose(m)))
  }
  return (
    <div className="overlay ext-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className={`modal ext-modal ${m.size ?? (m.ui ? 'm' : '')}`} role="dialog" aria-modal aria-label={m.title || w.name} data-widget={w.id}>
        <div className="ext-modal-head">
          <b>{m.title || w.name}</b>
          <span className="spacer" />
          <IconButton icon="x" title="Close (Esc)" onClick={() => onClose()} />
        </div>
        <div className="ext-modal-body">
          {m.text && <p className="ext-modal-text">{m.text}</p>}
          {m.ui && <div ref={host} className="widget-body" data-view="full" />}
        </div>
        {m.buttons.length > 0 && (
          <div className="ext-modal-buttons">
            {m.buttons.map((b, i) => (
              <button key={i} className={`${b.style ?? ''} ${busy === i ? 'busy' : ''}`} disabled={busy >= 0} onClick={() => press(b, i)}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
