// Widgets (daemon/widgets.ts): the sidebar's grid of previews, above its foot (or a line of them in the top bar or the
// status bar: WidgetStrip, each widget's place), buttons on the rail and the sidebar's foot (WidgetButtons), and a
// widget's full view in a dialog.
// The daemon fills each template. A widget without scripts is shown in a shadow root (the app's CSS variables reach
// it, its styles stay in it) once `clean` has taken out what could run or navigate; one with scripts is a frame of
// the daemon's page for it, sandboxed, that talks to the app only in messages: open a link, refresh, the full view,
// run one of its actions.
// Only what's on screen is rendered: a folded grid, or a closed dialog, holds nothing.
import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from 'react'
import { placesOf, type WidgetPlace, type WidgetView } from '../../shared/types'
import { ago, sayOf, uiBehave, WIDGET_CSS, type WidgetSay } from '../../shared/widget'
import { uiHtml } from '../../shared/widgetUi'
import { daemonBase } from './api'
import { ask, Icon, IconButton, isIconName } from './ui'

export type WidgetApi = {
  render: (id: string, full: boolean, sample?: boolean, cells?: [number, number], ws?: string) => Promise<string | null> // sample: widget.json's made-up data; cells: where it shows (the UI kit's size); ws: a per-workspace one's instance
  run: (id: string, ws?: string) => Promise<unknown>
  open: (url: string) => void // http(s), mailto, laki://
  copy: (text: string) => void
  full: (id: string) => void
  close: () => void // the full view's dialog (Esc in a JS widget's frame)
  action: (id: string, action: string, arg: string, label?: string, ws?: string) => Promise<void> // a button's data-run: one of widget.json's actions, done when it is
  say: (id: string, s: WidgetSay, ws?: string) => void // a toast, a dialog with buttons
  settings: (id?: string) => void // its page (Extension.tsx); none: Settings › Extensions
  menu?: (w: WidgetView, e: MouseEvent) => void // its right click: Fetch now, Inspect, its page
  key?: string // the daemon's key for JS widgets' pages
}

const LINK = /^(https?:|mailto:)/i
const OPEN = /^(https?:|mailto:|laki:\/\/)/i
const DROP = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'base', 'meta', 'link', 'template', 'portal', 'animate', 'set', 'animatemotion', 'animatetransform', 'foreignobject'])
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'background', 'ping'])

// a widget's HTML without scripts, frames, forms, event attributes or URLs that go anywhere but a page (links open in
// the browser, below) or a data: image
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
        if (name.startsWith('on') || (URL_ATTRS.has(name) && !(LINK.test(v) || v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);/i.test(v)))) el.removeAttribute(a.name)
      }
      walk(el)
    }
  }
  walk(t.content)
  return t.content
}

// the theme's variables, for a JS widget's page (another document: they don't reach it), in its address
const VARS = ['--bg', '--side', '--panel', '--line', '--fg', '--muted', '--accent', '--accent-fg', '--sel', '--hover', '--running', '--waiting', '--done', '--error', '--radius', '--mono', '--ui-font']
const themeVars = () => {
  const cs = getComputedStyle(document.documentElement)
  return { ...Object.fromEntries(VARS.map(v => [v, cs.getPropertyValue(v).trim()]).filter(([, x]) => x)), 'color-scheme': cs.colorScheme }
}

// a per-workspace one (scope workspace) as it shows in a workspace: that instance's fetch and button words over the
// widget's; ws null or undefined: none on screen (Board, Schedule, the AI page), `here` null: "Select a workspace"
export const inWs = (w: WidgetView, ws: string | null | undefined): WidgetView => {
  if (!w.scope) return w
  const i = ws ? w.inst?.[ws] : undefined
  return { ...w, here: ws ?? null, at: i?.at, error: i?.error, running: i?.running, mock: i?.mock, ...(i && { label: i.label, badge: i.badge, tip: i.tip }) }
}
const wsOf = (w: WidgetView) => w.here ?? undefined
const NO_WS = uiHtml({ type: 'empty', icon: 'folder', text: 'Select a workspace' }, {}, {})

// what a click in a widget asks for (uiBehave's messages, a JS page's laki.…): a link, an action (asked first when it
// says confirm), a copy, a toast or dialog, a fetch, the full view. Done when the action is
function act(m: Record<string, unknown>, w: WidgetView, full: boolean, api: WidgetApi): Promise<unknown> | void {
  const { laki, url, action, arg, label, confirm, text } = m
  if (laki === 'open' && typeof url === 'string' && OPEN.test(url)) return api.open(url)
  if (laki === 'run' && typeof action === 'string' && action) return (typeof confirm === 'string' && confirm ? ask(confirm.slice(0, 300), { ok: String(label || 'Run').slice(0, 40) }) : Promise.resolve(true)).then((yes): unknown => yes && api.action(w.id, action, String(arg ?? ''), String(label ?? ''), wsOf(w)))
  if (laki === 'copy' && typeof text === 'string') return api.copy(text)
  if (laki === 'say') return (s => void (s && api.say(w.id, s, wsOf(w))))(sayOf(m))
  if (laki === 'refresh') return void api.run(w.id, wsOf(w)).catch(() => {})
  if (laki === 'full' && !full && w.full) api.full(w.id)
}

// one widget's preview or full view; a click on a preview (not a link or button) opens the full view. sample: with its
// made-up data, as it would look (nothing it shows does anything). cells: where it shows, across and down (½: a bar)
export function WidgetBody({ w, full, api, sample, cells }: { w: WidgetView; full: boolean; api: WidgetApi; sample?: boolean; cells?: [number, number] }) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [err, setErr] = useState('')
  const [src, setSrc] = useState('')
  const config = JSON.stringify(w.config)
  const cfg = [...config].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) // a frame's address changes with it
  const theme = w.js ? JSON.stringify(themeVars()) : '' // and with the theme: read at each render (the app's renders follow a change of theme)
  const size = cells?.join('x') ?? ''
  const now = useRef({ w, full, api, sample, cells })
  now.current = { w, full, api, sample, cells }
  const rootOf = (el: HTMLDivElement) => el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  const none = w.here === null && !sample // per workspace, none on screen (a sample has a made-up one)
  useEffect(() => {
    let live = true
    setErr('')
    if (none) {
      // per workspace, none on screen
      if (host.current) rootOf(host.current).replaceChildren(Object.assign(document.createElement('style'), { textContent: WIDGET_CSS }), clean(NO_WS))
      return
    }
    if (w.js) {
      if (api.key) daemonBase().then(b => live && setSrc(`${b}/widget/${encodeURIComponent(w.id)}?key=${api.key}${full ? '&full=1' : ''}${sample ? '&sample=1' : ''}${size ? `&cells=${size}` : ''}${w.here ? `&ws=${encodeURIComponent(w.here)}` : ''}&at=${w.at ?? 0}&rev=${w.rev}&net=${w.net ? 1 : 0}&c=${cfg}&theme=${encodeURIComponent(theme)}`))
      return () => void (live = false)
    }
    const root = rootOf(host.current!)
    api.render(w.id, full, sample, cells, wsOf(w)).then(
      html => {
        if (!live) return
        const style = document.createElement('style')
        style.textContent = WIDGET_CSS
        root.replaceChildren(style, clean(html ?? ''))
      },
      e => live && setErr(String(e?.message ?? e)),
    )
    return () => void (live = false)
  }, [w.id, w.js, w.at, w.rev, w.net, w.here, none, full, config, api.key, theme, sample, size]) // net: Network access's CSP needs the page loaded again
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
      if (m.laki === 'ui') return win?.postMessage({ laki: 'ui', req: m.req, html: uiHtml(m.spec, m.ctx && typeof m.ctx === 'object' ? (m.ctx as Record<string, unknown>) : {}, { full, cells: now.current.cells }) }, '*')
      if (m.laki === 'close' && full) return api.close()
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
      {w.js && !none ? src && <iframe ref={frame} className="widget-frame" title={w.name} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" /> : <div ref={host} className="widget-body" />}
      {err && <div className="widget-msg warn small">{err}</div>}
    </>
  )
}

export const status = (w: WidgetView) => (w.running ? 'fetching…' : w.error ? `failed: ${w.error}` : w.at ? `fetched ${ago(w.at)}` : w.every ? 'not fetched yet' : '')

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

// a widget as a button (its view's button: a rail or foot place, or no preview of its own): a click runs its click
// action, else opens its full view, else fetches it now (else its settings)
const click = (w: WidgetView, api: WidgetApi) =>
  w.here === null ? undefined : w.click ? void api.action(w.id, w.click, '', w.name, wsOf(w)).catch(() => {}) : w.full ? api.full(w.id) : w.every !== undefined ? void api.run(w.id, wsOf(w)).catch(() => {}) : api.settings(w.id)
const tipOf = (w: WidgetView) => `${w.tip ?? w.name}${w.here === null ? ' · per workspace: select one' : status(w) ? ` · ${status(w)}` : ''}${w.dev ? ' · dev' : ''}${w.devError ? ` · last good version kept: ${w.devError}` : ''}${w.mock ? ' · sample data' : ''}`
// its icon: one of the app's by name, an emoji as it is, else its name's first letter
function Glyph({ w, size = 14 }: { w: WidgetView; size?: number }) {
  if (isIconName(w.icon)) return <Icon name={w.icon} size={size} />
  return <span className="widget-glyph" style={{ fontSize: size - 1 }}>{w.icon && !/^[a-z]/i.test(w.icon) ? w.icon : ([...w.name.trim()][0] ?? '?').toUpperCase()}</span>
}
// a button widget in a cell (the sidebar's grid, a bar): its icon, label and badge across the cell
export function CellButton({ w, api }: { w: WidgetView; api: WidgetApi }) {
  return (
    <button className="widget-button" onClick={() => click(w, api)}>
      <Glyph w={w} />
      <span className="widget-button-label">{w.label ?? w.name}</span>
      {w.badge && <span className="widget-badge">{w.badge}</span>}
    </button>
  )
}

// the rail's or the sidebar's foot's widgets: buttons like theirs (look), the rail's with its words under (words), the
// foot's beside (words: the foot's labels). places: those shown here (the foot takes the rail's when there's no rail)
export function WidgetButtons({ widgets, api, places, look, words }: { widgets: WidgetView[]; api: WidgetApi; places: WidgetPlace[]; look: 'rail' | 'foot'; words: boolean }) {
  const on = widgets.filter(w => w.on && placesOf(w).some(p => places.includes(p)))
  return on.map(w => {
    const dot = w.running ? 'rail-dot' : w.error ? 'rail-dot bad' : ''
    return look === 'rail' ? (
      <button key={`widget:${w.id}`} type="button" className={`rail-kind nodrag ${w.here === null ? 'no-ws' : ''}`} aria-label={tipOf(w)} data-tip={tipOf(w)} onClick={() => click(w, api)}>
        <span className="rail-icon">
          <Glyph w={w} size={18} />
          {w.badge ? <span className="rail-count">{w.badge}</span> : dot && <span className={dot} />}
        </span>
        {words && <span className="rail-label">{w.label ?? w.name}</span>}
      </button>
    ) : (
      <button key={`widget:${w.id}`} type="button" className={`ib widget-foot ${words ? 'labeled' : ''} ${w.error && !w.running ? 'dot' : ''} ${w.here === null ? 'no-ws' : ''}`} aria-label={tipOf(w)} data-tip={tipOf(w)} onClick={() => click(w, api)}>
        <Glyph w={w} />
        {words && <span className="ib-label">{w.label ?? w.name}</span>}
        {w.badge && <span className="widget-badge">{w.badge}</span>}
      </button>
    )
  })
}

// a widget in its place: its preview (or Stopped · load), and a dot while it fetches or after it failed
function Cell({ w, api, parked, load, style, cells }: { w: WidgetView; api: WidgetApi; parked: boolean; load: () => void; style: CSSProperties; cells: [number, number] }) {
  return (
    <div className={`widget ${w.full ? 'opens' : ''} ${w.button ? 'is-button' : ''} ${w.here === null ? 'no-ws' : ''}`} style={style} data-tip={tipOf(w)} onContextMenu={api.menu && (e => api.menu!(w, e))}>
      {w.button ? (
        <CellButton w={w} api={api} />
      ) : w.js && parked ? (
        <button className="widget-parked muted small" onClick={load}>
          Stopped · load
        </button>
      ) : (
        <WidgetBody w={w} full={false} api={api} cells={cells} />
      )}
      {(w.error || w.running || w.devError) && <span className={`widget-dot ${(w.error || w.devError) && !w.running ? 'bad' : ''}`} />}
      {w.mock && <span className="widget-mock">Sample data</span>}
    </div>
  )
}

// the sidebar's widgets: a grid 3 cells across, each widget its size in cells, plain (no tiles, no head); with the Desk off
// (experimental), one placed only there too: else it would show nowhere
export function WidgetGrid({ widgets, api, desk }: { widgets: WidgetView[]; api: WidgetApi; desk?: boolean }) {
  const [parked, load] = useParked()
  const on = widgets.filter(w => w.on && (l => l.includes('side') || (!desk && l.every(p => p === 'desk')))(placesOf(w)))
  if (!on.length) return null
  return (
    <div className="widgets widget-grid">
      {on.map(w => (
        <Cell key={w.id} w={w} api={api} parked={parked.includes(w.id)} load={() => load(w.id)} cells={w.size} style={{ gridColumn: `span ${w.size[0]}`, gridRow: `span ${w.size[1] * 2}` /* half rows: ½ is a thin line */ }} />
      ))}
    </div>
  )
}

// the top bar's or the status bar's widgets: a line high, each as wide as its cells across (a ½-high one fits best)
export function WidgetStrip({ widgets, api, place }: { widgets: WidgetView[]; api: WidgetApi; place: 'top' | 'status' }) {
  const [parked, load] = useParked()
  const on = widgets.filter(w => w.on && placesOf(w).includes(place))
  if (!on.length) return null
  return (
    <div className={`widget-strip ${place} nodrag`}>
      {on.map(w => (
        <Cell key={w.id} w={w} api={api} parked={parked.includes(w.id)} load={() => load(w.id)} cells={[w.size[0], 0.5]} style={{ width: `calc(${w.size[0]} * var(--widget-cell, 92px))` }} />
      ))}
    </div>
  )
}

// a widget's full view: a dialog over the app
export function WidgetDialog({ w, api, onClose }: { w: WidgetView; api: WidgetApi; onClose: () => void }) {
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
          <span className={`small ${w.error && !w.running ? 'warn' : 'muted'}`}>{status(w)}</span>
          <span className="spacer" />
          {w.every !== undefined && <IconButton icon="refresh" title="Fetch now" onClick={() => void api.run(w.id, wsOf(w)).catch(() => {})} />}
          <IconButton icon="settings" title="Its page: settings, preview, Laki AI" onClick={() => api.settings(w.id)} />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        <div className="widget-full">
          <WidgetBody w={w} full api={api} />
        </div>
      </div>
    </div>
  )
}
