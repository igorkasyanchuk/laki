// The terminal area split into panes (layout.ts), tabs dragged onto them, and the sidebar's resize handle.
// Panes are absolutely placed siblings keyed by tab, so splitting never remounts a terminal.
import { useRef, useState, type PointerEvent as PE, type ReactNode } from 'react'
import { type Bar, type Edge, type Layout, place } from './layout'

export type Drag = { tab: string; x: number; y: number; over?: { pane: string; edge: Edge } }

// the pane under the pointer, and which part of it: a quarter in from an edge splits there
function paneAt(x: number, y: number): Drag['over'] {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane]')
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  const fx = (x - r.left) / r.width
  const fy = (y - r.top) / r.height
  const [edge, d] = ([['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]] as const).reduce((m, e) => (e[1] < m[1] ? e : m))
  return { pane: el.dataset.pane!, edge: d < 0.25 ? edge : 'center' }
}

// a tab (tab bar or pane header) dragged more than a few pixels; dropped on a pane, onDrop
export function useTabDrag(onDrop: (tab: string, pane: string, edge: Edge) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const done = useRef(onDrop)
  done.current = onDrop
  const start = (e: PE, tab: string) => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection on the way
    const x0 = e.clientX
    const y0 = e.clientY
    let cur: Drag | null = null
    const move = (ev: PointerEvent) => {
      if (!cur && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
      cur = { tab, x: ev.clientX, y: ev.clientY, over: paneAt(ev.clientX, ev.clientY) }
      setDrag(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (cur?.over) done.current(tab, cur.over.pane, cur.over.edge)
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
  label: (tab: string) => ReactNode // pane header and drag ghost
  render: (tab: string) => ReactNode
  onFocus: (tab: string) => void
  onClosePane: (tab: string) => void
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
            <div className="pane-head" onPointerDown={e => p.startDrag(e, tab)} title="Drag onto another pane to move it">
              {p.label(tab)}
              <span className="spacer" />
              <button className="x" title="Close pane (the tab keeps running)" onClick={() => p.onClosePane(tab)}>
                ×
              </button>
            </div>
          )}
          <div className="pane-body">{p.render(tab)}</div>
          {over?.pane === tab && <div className={`drop-zone ${over.edge}`} />}
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
          {p.label(p.drag.tab)}
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
      title="Drag to resize · double-click to reset"
      onPointerDown={grab}
      onPointerMove={e => held(e) && onWidth(Math.round(Math.min(520, Math.max(180, e.clientX))))}
      onDoubleClick={() => onWidth(init)}
    />
  )
}
