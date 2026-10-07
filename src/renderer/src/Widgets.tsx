// Widgets (daemon/widgets.ts): the sidebar's grid of previews, above its foot, and a widget's full view in a dialog.
// The daemon fills each template. A widget without scripts is shown in a shadow root (the app's CSS variables reach
// it, its styles stay in it) once `clean` has taken out what could run or navigate; one with scripts is a frame of
// the daemon's page for it, sandboxed, that talks to the app only in messages: open a link, refresh, the full view,
// run one of its actions.
// Only what's on screen is rendered: a folded grid, or a closed dialog, holds nothing.
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { WidgetView } from '../../shared/types'
import { ago, WIDGET_CSS } from '../../shared/widget'
import { daemonBase } from './api'
import { Icon, IconButton } from './ui'

export type WidgetApi = {
  render: (id: string, full: boolean) => Promise<string | null>
  run: (id: string) => Promise<unknown>
  open: (url: string) => void
  full: (id: string) => void
  close: () => void // the full view's dialog (Esc in a JS widget's frame)
  action: (id: string, action: string, arg: string) => void // a button's data-run: one of widget.json's actions
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
      if (api.key) daemonBase().then(b => live && setSrc(`${b}/widget/${encodeURIComponent(w.id)}?key=${api.key}${full ? '&full=1' : ''}&at=${w.at ?? 0}&rev=${w.rev}&c=${cfg}&theme=${encodeURIComponent(theme)}`))
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
  }, [w.id, w.js, w.at, w.rev, full, config, api.key, theme])
  // a JS widget's messages: only from its own frame, and only right after a click in it (the frame has the focus,
  // the page a user activation), never on its script's own say (a refresh on load would loop: each fetch reloads it);
  // Esc in it closes the full view
  useEffect(() => {
    if (!w.js) return
    const f = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return
      const { laki, url, action, arg } = e.data as { laki?: string; url?: string; action?: string; arg?: string }
      if (laki === 'close' && full) return api.close()
      if (document.activeElement !== frame.current || navigator.userActivation?.isActive === false) return
      if (laki === 'open' && typeof url === 'string' && LINK.test(url)) api.open(url)
      else if (laki === 'run' && typeof action === 'string') api.action(w.id, action, String(arg ?? ''))
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
    } else if (r) api.action(w.id, r.getAttribute('data-run') ?? '', r.getAttribute('data-arg') ?? '')
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

// the sidebar's widgets: a head that folds them, then a grid 3 cells across, each widget its size in cells
export function WidgetGrid({ widgets, api, shut, onShut }: { widgets: WidgetView[]; api: WidgetApi; shut: boolean; onShut: (shut: boolean) => void }) {
  const on = widgets.filter(w => w.on)
  if (!on.length) return null
  return (
    <div className="widgets">
      <div className="widgets-head" onClick={e => !(e.target as Element).closest('button') && onShut(!shut)} data-tip={shut ? 'Show the widgets' : 'Hide the widgets'}>
        <Icon name={shut ? 'chevronRight' : 'chevron'} size={12} />
        <span>Widgets</span>
        {shut && <span className="project-count">{on.length}</span>}
        <span className="spacer" />
        <IconButton icon="settings" title="Widgets' settings" onClick={api.settings} />
      </div>
      {!shut && (
        <div className="widget-grid">
          {on.map(w => (
            <div key={w.id} className={`widget ${w.full ? 'opens' : ''}`} style={{ gridColumn: `span ${w.size[0]}`, gridRow: `span ${w.size[1]}` }} data-tip={`${w.name}${status(w) ? ` · ${status(w)}` : ''}`}>
              <WidgetBody w={w} full={false} api={api} />
              {(w.error || w.running) && <span className={`widget-dot ${w.error && !w.running ? 'bad' : ''}`} />}
            </div>
          ))}
        </div>
      )}
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
