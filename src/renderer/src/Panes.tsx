// A tab's terminal area split into panes (layout.ts), panes and tabs dragged around, and the sidebar's
// resize handle. Panes are absolutely placed siblings keyed by session, so splitting never remounts a terminal.
import { useRef, useState, type MouseEvent, type PointerEvent as PE, type ReactNode } from 'react'
import { type Bar, type Layout, place, type Spot } from './layout'
import { colorVar } from './ui'

export type Drag = { tab: string; whole: boolean; x: number; y: number; over?: Spot; line?: { left: number; top: number; width: number; height: number } }

const ZONE = 0.3 // a pane's edge band, of its width or height: a split there; inside it, the center

// what's under the pointer: a tab bar ([data-tabbar]) with tabs, the index between them and a line there (fixed), or
// a pane ([data-pane]): its edge within ZONE, or its center
function overAt(x: number, y: number): Pick<Drag, 'over' | 'line'> | undefined {
  const el = document.elementFromPoint(x, y)
  const bar = el?.closest<HTMLElement>('[data-tabbar]')
  if (bar) {
    const rs = [...bar.querySelectorAll(':scope > .tab')].map(t => t.getBoundingClientRect()) // groups' order
    if (!rs.length) return undefined // the top bar while tabs are elsewhere
    const col = getComputedStyle(bar).flexDirection.startsWith('column')
    const i = rs.filter(r => (col ? y > r.top + r.height / 2 : x > r.left + r.width / 2)).length
    const r = rs[Math.min(i, rs.length - 1)]
    const at = i < rs.length ? (col ? r.top : r.left) : col ? r.bottom : r.right
    return { over: { bar: i }, line: col ? { left: r.left, top: at - 1, width: r.width, height: 2 } : { left: at - 1, top: r.top, width: 2, height: r.height } }
  }
  const p = el?.closest<HTMLElement>('[data-pane]')
  if (!p) return undefined
  const r = p.getBoundingClientRect()
  const fx = (x - r.left) / r.width
  const fy = (y - r.top) / r.height
  const [edge, d] = ([['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]] as const).reduce((m, e) => (e[1] < m[1] ? e : m))
  return { over: { pane: p.dataset.pane!, edge: d < ZONE ? edge : 'center' } }
}

// a text field outside the panes has the keyboard (a terminal's own textarea is inside one): hover focus waits
const typing = () => !!document.activeElement?.matches('input, textarea, select, [contenteditable]') && !document.activeElement.closest('.pane')

// a pane header (one session) or a tab (whole: all its panes) dragged past 4px (less: a click), VS Code style: a
// target only where ok says the drop changes something; a release there, onDrop; Esc, a release elsewhere, losing
// the window or the pointer: nothing
export function useTabDrag(onDrop: (tab: string, whole: boolean, over: Spot) => void, ok: (tab: string, whole: boolean, over: Spot) => boolean) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const cb = useRef({ onDrop, ok })
  cb.current = { onDrop, ok }
  const start = (e: PE, tab: string, whole: boolean) => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection, and the keyboard stays where it is
    const x0 = e.clientX
    const y0 = e.clientY
    let cur: Drag | null = null
    const move = (ev: PointerEvent) => {
      if (!cur && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      if (!cur) document.documentElement.classList.add('tab-dragging') // grabbing everywhere, no selection
      const at = overAt(ev.clientX, ev.clientY)
      cur = { tab, whole, x: ev.clientX, y: ev.clientY, ...(at?.over && cb.current.ok(tab, whole, at.over) && at) }
      setDrag(cur)
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !cur) return
      ev.preventDefault()
      ev.stopPropagation() // not the terminal's Esc
      stop()
    }
    const up = (ev: PointerEvent) => {
      if (cur) move(ev) // where it's released
      const over = cur?.over
      stop()
      if (over) cb.current.onDrop(tab, whole, over)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      window.removeEventListener('keydown', key, true)
      document.documentElement.classList.remove('tab-dragging')
      cur = null
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    window.addEventListener('keydown', key, true)
  }
  return { drag, start }
}

// a divider or handle that follows the pointer while pressed (pointer capture: no window listeners)
const grab = (e: PE) => {
  e.currentTarget.setPointerCapture(e.pointerId)
  e.preventDefault()
}
const held = (e: PE) => e.currentTarget.hasPointerCapture(e.pointerId)

export function Panes(p: {
  layout: Layout
  active: string | null
  drag: Drag | null
  label: (tab: string) => ReactNode // pane header
  color: (tab: string) => string | undefined // its tab color's name
  onMenu: (e: MouseEvent, tab: string) => void // right click on a pane header
  ghost: ReactNode // what follows the pointer while dragging
  render: (tab: string) => ReactNode
  onFocus: (tab: string) => void
  hoverFocus?: boolean // the pane under the mouse gets the keyboard (Settings › Terminal)
  onClose: (tab: string) => void
  onResize: (path: string, at: number) => void
  startDrag: (e: PE, tab: string) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const { panes, bars } = place(p.layout)
  const pct = (f: number) => `${f * 100}%`
  const at = (e: PE, b: Bar) => {
    const r = area.current!.getBoundingClientRect()
    return b.dir === 'row' ? ((e.clientX - r.left) / r.width - b.box.x) / b.box.w : ((e.clientY - r.top) / r.height - b.box.y) / b.box.h
  }
  const over = p.drag?.over
  return (
    <div className="panes" ref={area}>
      {panes.map(({ tab, box }) => (
        <div
          key={tab}
          data-pane={tab}
          className={`pane ${panes.length > 1 ? 'multi' : ''} ${tab === p.active ? 'active' : ''}`}
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
          onPointerDownCapture={() => p.onFocus(tab)}
          onPointerEnter={e => p.hoverFocus && !e.buttons && document.hasFocus() && !typing() && p.onFocus(tab) /* not mid-drag or mid-selection, nor while typing elsewhere */}
        >
          {panes.length > 1 && (
            <div className="pane-head" style={colorVar(p.color(tab))} onPointerDown={e => p.startDrag(e, tab)} onContextMenu={e => p.onMenu(e, tab)}>
              {p.label(tab)}
              <button className="x" data-tip="Close" onPointerDown={e => e.stopPropagation()} onClick={() => p.onClose(tab)}>
                ×
              </button>
            </div>
          )}
          <div className="pane-body">{p.render(tab)}</div>
          {over && 'pane' in over && over.pane === tab && <div className={`drop-zone ${over.edge}`} />}
        </div>
      ))}
      {bars.map(b => (
        <div
          key={b.path}
          className={`bar ${b.dir}`}
          style={
            b.dir === 'row'
              ? { left: pct(b.box.x + b.box.w * b.at), top: pct(b.box.y), height: pct(b.box.h) }
              : { top: pct(b.box.y + b.box.h * b.at), left: pct(b.box.x), width: pct(b.box.w) }
          }
          onPointerDown={grab}
          onPointerMove={e => held(e) && p.onResize(b.path, at(e, b))}
        />
      ))}
      {p.drag && (
        <div className="drag-ghost" style={{ left: Math.min(p.drag.x + 12, innerWidth - 272), top: Math.min(p.drag.y + 10, innerHeight - 32) /* in the window: 260 wide at most */ }}>
          {p.ghost}
        </div>
      )}
      {p.drag?.line && <div className="drop-line" style={p.drag.line} />}
    </div>
  )
}

// a right panel's left edge (the side panel's, the info panel's): drag to resize, double-click for the default width
export function PanelHandle({ onWidth, init }: { onWidth: (w: number) => void; init: number }) {
  return (
    <div
      className="sp-handle"
      data-tip="Drag to resize · double-click to reset"
      onPointerDown={grab}
      onPointerMove={e => held(e) && onWidth(Math.round(Math.min(760, Math.max(240, window.innerWidth - e.clientX))))}
      onDoubleClick={() => onWidth(init)}
    />
  )
}

// the sidebar's right edge: drag to resize, double-click for the default width
export function SideHandle({ width, onWidth, init }: { width: number; onWidth: (w: number) => void; init: number }) {
  return (
    <div
      className="side-handle"
      style={{ left: width }}
      data-tip="Drag to resize · double-click to reset"
      onPointerDown={grab}
      onPointerMove={e => held(e) && onWidth(Math.round(Math.min(480, Math.max(160, e.clientX))))}
      onDoubleClick={() => onWidth(init)}
    />
  )
}
