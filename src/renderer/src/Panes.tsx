// A tab's terminal area split into panes (layout.ts), panes and tabs dragged around, and the sidebar's
// resize handle. Panes are absolutely placed siblings keyed by session, so splitting never remounts a terminal.
import { useRef, useState, type MouseEvent, type PointerEvent as PE, type ReactNode } from 'react'
import { type Bar, type Edge, type Layout, place } from './layout'
import { colorVar } from './ui'

export type Over = { pane: string; edge: Edge } | 'bar'
export type Drag = { tab: string; whole: boolean; x: number; y: number; over?: Over }

// what's under the pointer: the tab bar ([data-tabbar]), or a pane ([data-pane]) and its nearest edge
function overAt(x: number, y: number): Over | undefined {
  const el = document.elementFromPoint(x, y)
  if (el?.closest('[data-tabbar]')) return 'bar'
  const p = el?.closest<HTMLElement>('[data-pane]')
  if (!p) return undefined
  const r = p.getBoundingClientRect()
  const fx = (x - r.left) / r.width
  const fy = (y - r.top) / r.height
  const [edge] = ([['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]] as const).reduce((m, e) => (e[1] < m[1] ? e : m))
  return { pane: p.dataset.pane!, edge }
}

// a pane header (one session) or a tab (whole: all its panes) dragged more than a few pixels; on release
// over a target, onDrop
export function useTabDrag(onDrop: (tab: string, whole: boolean, over: Over) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const done = useRef(onDrop)
  done.current = onDrop
  const start = (e: PE, tab: string, whole: boolean) => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection on the way
    const x0 = e.clientX
    const y0 = e.clientY
    let cur: Drag | null = null
    const move = (ev: PointerEvent) => {
      if (!cur && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
      cur = { tab, whole, x: ev.clientX, y: ev.clientY, over: overAt(ev.clientX, ev.clientY) }
      setDrag(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (cur?.over) done.current(tab, whole, cur.over)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
    <div className={`panes ${p.drag ? 'dragging' : ''}`} ref={area}>
      {panes.map(({ tab, box }) => (
        <div
          key={tab}
          data-pane={tab}
          className={`pane ${panes.length > 1 ? 'multi' : ''} ${tab === p.active ? 'active' : ''}`}
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
          onPointerDownCapture={() => p.onFocus(tab)}
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
          {over && over !== 'bar' && over.pane === tab && <div className={`drop-zone ${over.edge}`} />}
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
        <div className="drag-ghost" style={{ left: p.drag.x + 12, top: p.drag.y + 10 }}>
          {p.ghost}
        </div>
      )}
    </div>
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
