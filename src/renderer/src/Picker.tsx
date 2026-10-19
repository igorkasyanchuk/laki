// Development mode's element picker (the side head's crosshair): point at anything in Laki's window, click, and a dialog
// tells what it is (a CSS selector, the React components around it, its classes, text and styles) with a screenshot of
// it, to copy and paste into a prompt while working on Laki itself. Esc or a right click stops picking.
import { Fragment, useEffect, useState } from 'react'
import { placesOf, type WidgetView } from '../../shared/types'
import { uiHtml, UI_SAMPLES } from '../../shared/widgetUi'
import { api, bridge } from './api'
import { Modal } from './panels'
import { Icon } from './ui'

export const PICKER_KEY = '⇧⌘C' // settings.pickerKey unset: as a browser's Inspect

// ext: an extension the element is in or is (its body, a JS page's frame, its button), and the UI kit's element there
export type Picked = { selector: string; components: string[]; tag: string; classes: string[]; attrs: [string, string][]; text: string; rect: { x: number; y: number; w: number; h: number }; styles: [string, string][]; html: string; shot?: string; png?: string; ext?: PickedExt }
const VIEWS: Record<string, string> = { preview: 'preview', full: 'full view', button: 'button' }
type PickedExt = { id: string; name: string; view: string; sample: boolean; kit?: string; js?: boolean; places: string; size: string; source: string; dir: string; on: boolean }

const STYLES = ['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'padding', 'margin', 'border', 'border-radius', 'gap', 'opacity']
const ATTRS = /^(id|role|title|aria-label|data-[\w-]+|href|type|name|placeholder)$/

// a selector that finds it again: ids and classes up to an id or 6 levels, :nth-of-type where a sibling shares them
export function selectorOf(el: Element): string {
  const parts: string[] = []
  for (let e: Element | null = el; e && e !== document.body && parts.length < 6; e = e.parentElement) {
    if (e.id) {
      parts.unshift(`#${CSS.escape(e.id)}`)
      break
    }
    let s = e.tagName.toLowerCase() + [...e.classList].slice(0, 3).map(c => `.${CSS.escape(c)}`).join('')
    const same = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e!.tagName) : []
    if (same.length > 1 && same.filter(x => x.matches(s)).length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`
    parts.unshift(s)
  }
  return parts.join(' > ')
}

// the React components it's in, outermost first, from React's own fiber on the node (a dev build's names; the packed
// app's are minified, still there)
export function componentsOf(el: Element): string[] {
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
  const out: string[] = []
  for (let f = key ? (el as any)[key] : null; f && out.length < 10; f = f.return) {
    const t = f.type
    const name = typeof t === 'function' ? t.displayName || t.name : t && typeof t === 'object' ? t.displayName || t.render?.name || t.type?.name : ''
    if (name && out[0] !== name) out.unshift(name)
  }
  return out
}

// the UI kit's elements by their root's class (k-ck: checklist), from drawing each one's sample once (one shown in a
// stack or a row: the element itself)
let kitClass: Map<string, string> | undefined
const own = (type: string, e: any): any => (e?.type === type ? e : Array.isArray(e?.children) ? e.children.map((c: unknown) => own(type, c)).find(Boolean) : undefined)
const kitOf = (c: string) =>
  (kitClass ??= new Map(
    UI_SAMPLES.map(x => [/class="(k-[\w-]+)/.exec(uiHtml(own(x.type, x.spec) ?? x.spec, { data: x.data, config: {}, at: 0 }, { full: true }))?.[1] ?? '', x.type] as [string, string]).filter(([k], i, all) => k && all.findIndex(y => y[0] === k) === i),
  )).get(c)
// an extension's (data-widget on its body, frame or button: Widgets.tsx); inside a template's shadow root, its host's.
// The kit's element: the nearest k-<type> class (a JS page's frame keeps what's in it to itself: its pixels only)
function extOf(el: Element, widgets: WidgetView[]): PickedExt | undefined {
  const host = el.closest('[data-widget]') ?? ((el.getRootNode() as ShadowRoot).host?.closest('[data-widget]') as Element | undefined)
  const w = host && widgets.find(x => x.id === host.getAttribute('data-widget'))
  if (!host || !w) return undefined
  let kit: string | undefined
  for (let e: Element | null = el; e && e !== host && !kit; e = e.parentElement) kit = [...e.classList].map(kitOf).find(Boolean)
  const src = w.source
  return { id: w.id, name: w.name, view: host.getAttribute('data-view') ?? 'preview', sample: host.hasAttribute('data-sample'), kit, js: !!w.js, places: placesOf(w).join(', '), size: w.size.join('×'), source: !src || src.kind === 'fetch' ? 'own script' : src.kind === 'ai' ? `AI: ${src.prompt?.slice(0, 120) ?? ''}` : `${src.kind} ${src.path ?? src.url ?? ''}`.trim(), dir: w.dir, on: w.on }
}

export function inspect(el: Element, widgets: WidgetView[] = []): Picked {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const html = el.outerHTML
  return {
    selector: selectorOf(el),
    components: componentsOf(el),
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    attrs: [...el.attributes].filter(a => ATTRS.test(a.name) && a.name !== 'class').map(a => [a.name, a.value.slice(0, 200)]),
    text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    styles: STYLES.map(k => [k, cs.getPropertyValue(k)] as [string, string]).filter(([, v]) => v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)'),
    html: html.length > 800 ? `${html.slice(0, 800)}…` : html,
    ext: extOf(el, widgets),
  }
}

// what Copy puts on the clipboard: Markdown an agent reads as the context of "this thing here"
export function pickedText(p: Picked): string {
  const lines = [
    p.ext ? `UI element in the Laki extension "${p.ext.name}" (${p.ext.id}): \`${p.selector}\`` : `UI element in Laki: \`${p.selector}\``,
    ...(p.ext
      ? [
          `- Extension: ${p.ext.id}, its folder ${p.ext.dir} (widget.json${p.ext.js ? ', widget.html: a JS page' : ''}); ${p.ext.on ? 'on' : 'off'}, in ${p.ext.places}, ${p.ext.size} cells`,
          `- Its ${VIEWS[p.ext.view] ?? p.ext.view}${p.ext.sample ? ', on sample data' : ''}${p.ext.kit ? `; the UI kit's ${p.ext.kit} element` : ''}; its data: ${p.ext.source}`,
          `- laki widget check ${p.ext.id} checks it; its page: laki://settings/widgets/${p.ext.id}/inspect`,
        ]
      : []),
    p.components.length ? `- React: ${p.components.join(' › ')}` : '',
    `- Element: <${p.tag}>${p.classes.length ? ` classes ${p.classes.map(c => `.${c}`).join(' ')}` : ''}`,
    ...p.attrs.map(([k, v]) => `- ${k}: ${v}`),
    p.text ? `- Text: ${p.text}` : '',
    `- Box: ${p.rect.w}×${p.rect.h} at ${p.rect.x},${p.rect.y}`,
    `- Styles: ${p.styles.map(([k, v]) => `${k}: ${v}`).join('; ')}`,
    p.shot ? `- Screenshot: ${p.shot}` : '',
    '',
    '```html',
    p.html,
    '```',
  ]
  return lines.filter((x, i) => x || i >= lines.length - 4).join('\n')
}

// the window's pixels under the box (main's capture-rect), saved as a file the prompt can name; in a browser: none
async function shoot(r: Picked['rect']): Promise<{ png: string; path: string } | null> {
  if (!bridge?.captureRect || r.w < 1 || r.h < 1) return null
  const pad = 4
  const png = await bridge.captureRect({ x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2 })
  const path = await api.call<string>('imageSave', { data: png, ext: 'png' })
  return { png, path }
}

export function Picker({ onClose, copy, widgets = [] }: { onClose: () => void; copy: (text: string) => void; widgets?: WidgetView[] }) {
  const [over, setOver] = useState<{ el: Element; r: DOMRect } | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (picked || busy) return
    // under the shield (it keeps frames, webviews and the app's hovers from the pointer): the first that isn't the picker's
    // an extension's template draws in a shadow root: what's under the pointer in there
    const at = (e: PointerEvent) => {
      const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => !x.closest('.picker-shield, .picker-hl, .picker-bar')) ?? null
      return el?.shadowRoot?.elementsFromPoint(e.clientX, e.clientY).find(x => x.tagName !== 'STYLE' && el.shadowRoot!.contains(x)) ?? el
    }
    const move = (e: PointerEvent) => {
      const el = at(e)
      setOver(el ? { el, r: el.getBoundingClientRect() } : null)
    }
    const stop = (e: Event) => (e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation())
    const down = (e: PointerEvent) => {
      stop(e)
      const el = at(e)
      if (e.button !== 0 || el?.closest('.picker-toggle, [data-rail="picker"]')) return onClose() // a right click or the crosshair again: stop picking
      if (!el) return
      // this press's mouseup and click too, after these listeners go: else they'd click what was picked (a link, a button)
      const swallow = (x: Event) => (stop(x), x.type === 'click' && off())
      const off = () => ['mouseup', 'click'].forEach(t => window.removeEventListener(t, swallow, true))
      ;['mouseup', 'click'].forEach(t => window.addEventListener(t, swallow, true))
      setTimeout(off, 1500)
      const p = inspect(el, widgets)
      setOver(null)
      setBusy(true)
      // the highlight off the screen first: two frames, then the window's pixels
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          shoot(p.rect)
            .then(s => setPicked(s ? { ...p, shot: s.path, png: s.png } : p))
            .catch(() => setPicked(p))
            .finally(() => setBusy(false)),
        ),
      )
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (stop(e), onClose())
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    for (const t of ['mousedown', 'mouseup', 'click', 'contextmenu', 'dblclick']) window.addEventListener(t, stop, true)
    window.addEventListener('keydown', key, true)
    document.documentElement.classList.add('picking')
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerdown', down, true)
      for (const t of ['mousedown', 'mouseup', 'click', 'contextmenu', 'dblclick']) window.removeEventListener(t, stop, true)
      window.removeEventListener('keydown', key, true)
      document.documentElement.classList.remove('picking')
    }
  }, [picked, busy])

  if (picked)
    return (
      <Modal title="Picked element" onClose={onClose} wide loose>
        <div className="picked">
          {picked.png && <img className="picked-shot" src={`data:image/png;base64,${picked.png}`} alt="The element" />}
          <dl className="picked-facts">
            {picked.ext && (
              <>
                <dt>Extension</dt>
                <dd>
                  <b>{picked.ext.name}</b> <code>{picked.ext.id}</code> · its {VIEWS[picked.ext.view] ?? picked.ext.view}
                  {picked.ext.sample ? ' on sample data' : ''}
                  {picked.ext.kit && <> · the UI kit's <code>{picked.ext.kit}</code></>} · {picked.ext.on ? 'on' : 'off'}, in {picked.ext.places}, {picked.ext.size}
                </dd>
                <dt>Its data</dt>
                <dd>{picked.ext.source}</dd>
                <dt>Folder</dt>
                <dd><code>{picked.ext.dir}</code></dd>
              </>
            )}
            <dt>Selector</dt>
            <dd><code>{picked.selector}</code></dd>
            {picked.components.length > 0 && (
              <>
                <dt>React</dt>
                <dd>{picked.components.join(' › ')}</dd>
              </>
            )}
            <dt>Element</dt>
            <dd><code>&lt;{picked.tag}&gt;</code> {picked.classes.map(c => <code key={c}>.{c}</code>)}</dd>
            {picked.attrs.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
            {picked.text && (
              <>
                <dt>Text</dt>
                <dd>{picked.text}</dd>
              </>
            )}
            <dt>Box</dt>
            <dd>{picked.rect.w}×{picked.rect.h} at {picked.rect.x},{picked.rect.y}</dd>
            <dt>Styles</dt>
            <dd className="picked-styles">{picked.styles.map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}</dd>
            {picked.shot && (
              <>
                <dt>Screenshot</dt>
                <dd><code>{picked.shot}</code></dd>
              </>
            )}
          </dl>
          <pre className="picked-html">{picked.html}</pre>
          <div className="row">
            <button className="primary" onClick={() => copy(pickedText(picked))}>
              <Icon name="copy" size={12} /> Copy the context
            </button>
            {picked.shot && bridge?.copyFile && <button onClick={() => void bridge!.copyFile!(picked.shot!)}>Copy the screenshot</button>}
            <span className="grow" />
            <button onClick={() => setPicked(null)}>Pick another</button>
          </div>
        </div>
      </Modal>
    )
  if (busy) return null // nothing of the picker's in its picture
  return (
    <>
      <div className="picker-shield" />
      <div className="picker-bar">
        <Icon name="target" size={12} /> Pick an element: click it. Esc or a right click stops.
      </div>
      {over && (
        <div className="picker-hl" style={{ left: over.r.left, top: over.r.top, width: over.r.width, height: over.r.height }}>
          <span className={`picker-tag ${over.r.top < 22 ? 'below' : ''}`}>
            {componentsOf(over.el).slice(-1)[0] ?? over.el.tagName.toLowerCase()}
            {over.el.classList.length ? `.${[...over.el.classList].slice(0, 2).join('.')}` : ''} · {Math.round(over.r.width)}×{Math.round(over.r.height)}
          </span>
        </div>
      )}
    </>
  )
}
