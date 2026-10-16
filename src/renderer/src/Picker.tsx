// Development mode's element picker (the side head's crosshair): point at anything in Laki's window, click, and a dialog
// tells what it is (a CSS selector, the React components around it, its classes, text and styles) with a screenshot of
// it, to copy and paste into a prompt while working on Laki itself. Esc or a right click stops picking.
import { Fragment, useEffect, useState } from 'react'
import { api, bridge } from './api'
import { Modal } from './panels'
import { Icon } from './ui'

export const PICKER_KEY = '⇧⌘C' // settings.pickerKey unset: as a browser's Inspect

export type Picked = { selector: string; components: string[]; tag: string; classes: string[]; attrs: [string, string][]; text: string; rect: { x: number; y: number; w: number; h: number }; styles: [string, string][]; html: string; shot?: string; png?: string }

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

export function inspect(el: Element): Picked {
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
  }
}

// what Copy puts on the clipboard: Markdown an agent reads as the context of "this thing here"
export function pickedText(p: Picked): string {
  const lines = [
    `UI element in Laki: \`${p.selector}\``,
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

export function Picker({ onClose, copy }: { onClose: () => void; copy: (text: string) => void }) {
  const [over, setOver] = useState<{ el: Element; r: DOMRect } | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (picked || busy) return
    // under the shield (it keeps frames, webviews and the app's hovers from the pointer): the first that isn't the picker's
    const at = (e: PointerEvent) => document.elementsFromPoint(e.clientX, e.clientY).find(x => !x.closest('.picker-shield, .picker-hl, .picker-bar')) ?? null
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
      const p = inspect(el)
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
