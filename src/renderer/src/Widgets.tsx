// Widgets (daemon/widgets.ts): the sidebar's grid of previews, above its foot (or a line of them in the top bar or the
// status bar: WidgetStrip, each widget's place), buttons on the rail and the sidebar's foot (WidgetButtons), and a
// widget's full view in a dialog.
// The daemon fills each template. A widget without scripts is shown in a shadow root (the app's CSS variables reach
// it, its styles stay in it) once `clean` has taken out what could run or navigate; one with scripts is a frame of
// the daemon's page for it, sandboxed, that talks to the app only in messages: open a link, refresh, the full view,
// run one of its actions.
// Only what's on screen is rendered: a folded grid, or a closed dialog, holds nothing.
import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from 'react'
import type { WidgetPlace, WidgetView } from '../../shared/types'
import { ago, sayOf, WIDGET_CSS, type WidgetSay } from '../../shared/widget'
import { daemonBase } from './api'
import { Icon, IconButton, isIconName } from './ui'

export type WidgetApi = {
  render: (id: string, full: boolean) => Promise<string | null>
  run: (id: string) => Promise<unknown>
  open: (url: string) => void
  full: (id: string) => void
  close: () => void // the full view's dialog (Esc in a JS widget's frame)
  action: (id: string, action: string, arg: string, label?: string) => Promise<void> // a button's data-run: one of widget.json's actions, done when it is
  say: (id: string, s: WidgetSay) => void // a toast, a dialog with buttons
  settings: () => void
  key?: string // the daemon's key for JS widgets' pages
}

const LINK = /^(https?:|mailto:)/i
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

// one widget's preview or full view; a click on a preview (not a link or button) opens the full view
function WidgetBody({ w, full, api }: { w: WidgetView; full: boolean; api: WidgetApi }) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [err, setErr] = useState('')
  const [src, setSrc] = useState('')
  const config = JSON.stringify(w.config)
  const cfg = [...config].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) // a frame's address changes with it
  const theme = w.js ? JSON.stringify(themeVars()) : '' // and with the theme: read at each render (the app's renders follow a change of theme)
  useEffect(() => {
    let live = true
    setErr('')
    if (w.js) {
      if (api.key) daemonBase().then(b => live && setSrc(`${b}/widget/${encodeURIComponent(w.id)}?key=${api.key}${full ? '&full=1' : ''}&at=${w.at ?? 0}&rev=${w.rev}&net=${w.net ? 1 : 0}&c=${cfg}&theme=${encodeURIComponent(theme)}`))
      return () => void (live = false)
    }
    const el = host.current!
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    api.render(w.id, full).then(
      html => {
        if (!live) return
        const style = document.createElement('style')
        style.textContent = WIDGET_CSS
        root.replaceChildren(style, clean(html ?? ''))
      },
      e => live && setErr(String(e?.message ?? e)),
    )
    return () => void (live = false)
  }, [w.id, w.js, w.at, w.rev, w.net, full, config, api.key, theme]) // net: Network access's CSP needs the page loaded again
  // a JS widget's messages: only from its own frame, and only right after a click in it (the frame has the focus,
  // the page a user activation), never on its script's own say (a refresh on load would loop: each fetch reloads it);
  // Esc in it closes the full view
  useEffect(() => {
    if (!w.js) return
    const f = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return
      const { laki, url, action, arg, label } = e.data as { laki?: string; url?: string; action?: string; arg?: string; label?: string }
      if (laki === 'close' && full) return api.close()
      if (document.activeElement !== frame.current || navigator.userActivation?.isActive === false) return
      if (laki === 'open' && typeof url === 'string' && LINK.test(url)) api.open(url)
      else if (laki === 'run' && typeof action === 'string')
        void api.action(w.id, action, String(arg ?? ''), String(label ?? '')).then(() => frame.current?.contentWindow?.postMessage({ laki: 'done', action, arg: String(arg ?? '') }, '*')) // its button works again
      else if (laki === 'say') (s => s && api.say(w.id, s))(sayOf(e.data))
      else if (laki === 'refresh') void api.run(w.id).catch(() => {})
      else if (laki === 'full' && !full && w.full) api.full(w.id)
    }
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  }, [w.js, w.id, w.full, full])
  const click = (e: MouseEvent) => {
    const path = e.nativeEvent.composedPath().filter((n): n is Element => n instanceof Element)
    const a = path.find(n => n.matches('a[href]'))
    const b = path.find(n => n.matches('[data-laki]'))
    const r = path.find(n => n.matches('[data-run]'))
    if (a) {
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (LINK.test(href)) api.open(href)
    } else if (r && !r.hasAttribute('data-busy')) {
      r.setAttribute('data-busy', '') // until it's done
      void api.action(w.id, r.getAttribute('data-run') ?? '', r.getAttribute('data-arg') ?? '', r.textContent?.trim()).then(() => r.removeAttribute('data-busy'))
    }
    else if (b?.getAttribute('data-laki') === 'refresh') void api.run(w.id).catch(() => {})
    else if (!full && w.full && !path.some(n => n.matches('button, input, select, textarea, label'))) api.full(w.id)
  }
  // the host stays mounted under an error: the next render (a fixed template, a reload) draws into it again
  return (
    <>
      {w.js ? src && <iframe ref={frame} className="widget-frame" title={w.name} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" /> : <div ref={host} className="widget-body" onClick={click} />}
      {err && <div className="widget-msg warn small">{err}</div>}
    </>
  )
}

const status = (w: WidgetView) => (w.running ? 'fetching…' : w.error ? `failed: ${w.error}` : w.at ? `fetched ${ago(w.at)}` : w.every ? 'not fetched yet' : '')

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
  w.click ? void api.action(w.id, w.click, '', w.name).catch(() => {}) : w.full ? api.full(w.id) : w.every !== undefined ? void api.run(w.id).catch(() => {}) : api.settings()
const tipOf = (w: WidgetView) => `${w.tip ?? w.name}${status(w) ? ` · ${status(w)}` : ''}`
// its icon: one of the app's by name, an emoji as it is, else its name's first letter
function Glyph({ w, size = 14 }: { w: WidgetView; size?: number }) {
  if (isIconName(w.icon)) return <Icon name={w.icon} size={size} />
  return <span className="widget-glyph" style={{ fontSize: size - 1 }}>{w.icon && !/^[a-z]/i.test(w.icon) ? w.icon : ([...w.name.trim()][0] ?? '?').toUpperCase()}</span>
}
// a button widget in a cell (the sidebar's grid, a bar): its icon, label and badge across the cell
function CellButton({ w, api }: { w: WidgetView; api: WidgetApi }) {
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
  const on = widgets.filter(w => w.on && places.includes(w.place ?? 'side'))
  return on.map(w => {
    const dot = w.running ? 'rail-dot' : w.error ? 'rail-dot bad' : ''
    return look === 'rail' ? (
      <button key={`widget:${w.id}`} type="button" className="rail-kind nodrag" aria-label={tipOf(w)} data-tip={tipOf(w)} onClick={() => click(w, api)}>
        <span className="rail-icon">
          <Glyph w={w} size={18} />
          {w.badge ? <span className="rail-count">{w.badge}</span> : dot && <span className={dot} />}
        </span>
        {words && <span className="rail-label">{w.label ?? w.name}</span>}
      </button>
    ) : (
      <button key={`widget:${w.id}`} type="button" className={`ib widget-foot ${words ? 'labeled' : ''} ${w.error && !w.running ? 'dot' : ''}`} aria-label={tipOf(w)} data-tip={tipOf(w)} onClick={() => click(w, api)}>
        <Glyph w={w} />
        {words && <span className="ib-label">{w.label ?? w.name}</span>}
        {w.badge && <span className="widget-badge">{w.badge}</span>}
      </button>
    )
  })
}

// a widget in its place: its preview (or Stopped · load), and a dot while it fetches or after it failed
function Cell({ w, api, parked, load, style }: { w: WidgetView; api: WidgetApi; parked: boolean; load: () => void; style: CSSProperties }) {
  return (
    <div className={`widget ${w.full ? 'opens' : ''} ${w.button ? 'is-button' : ''}`} style={style} data-tip={tipOf(w)}>
      {w.button ? (
        <CellButton w={w} api={api} />
      ) : w.js && parked ? (
        <button className="widget-parked muted small" onClick={load}>
          Stopped · load
        </button>
      ) : (
        <WidgetBody w={w} full={false} api={api} />
      )}
      {(w.error || w.running) && <span className={`widget-dot ${w.error && !w.running ? 'bad' : ''}`} />}
    </div>
  )
}

// the sidebar's widgets: a grid 3 cells across, each widget its size in cells, plain (no tiles, no head)
export function WidgetGrid({ widgets, api }: { widgets: WidgetView[]; api: WidgetApi }) {
  const [parked, load] = useParked()
  const on = widgets.filter(w => w.on && (w.place ?? 'side') === 'side')
  if (!on.length) return null
  return (
    <div className="widgets widget-grid">
      {on.map(w => (
        <Cell key={w.id} w={w} api={api} parked={parked.includes(w.id)} load={() => load(w.id)} style={{ gridColumn: `span ${w.size[0]}`, gridRow: `span ${w.size[1] * 2}` /* half rows: ½ is a thin line */ }} />
      ))}
    </div>
  )
}

// the top bar's or the status bar's widgets: a line high, each as wide as its cells across (a ½-high one fits best)
export function WidgetStrip({ widgets, api, place }: { widgets: WidgetView[]; api: WidgetApi; place: 'top' | 'status' }) {
  const [parked, load] = useParked()
  const on = widgets.filter(w => w.on && w.place === place)
  if (!on.length) return null
  return (
    <div className={`widget-strip ${place} nodrag`}>
      {on.map(w => (
        <Cell key={w.id} w={w} api={api} parked={parked.includes(w.id)} load={() => load(w.id)} style={{ width: `calc(${w.size[0]} * var(--widget-cell, 92px))` }} />
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
          {w.every !== undefined && <IconButton icon="refresh" title="Fetch now" onClick={() => void api.run(w.id).catch(() => {})} />}
          <IconButton icon="settings" title="Its settings" onClick={api.settings} />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        <div className="widget-full">
          <WidgetBody w={w} full api={api} />
        </div>
      </div>
    </div>
  )
}
