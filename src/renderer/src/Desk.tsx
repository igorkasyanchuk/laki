// Desk (experimental, settings.desk; the rail's Desk, ⌘K): the extensions placed there (a place like the sidebar, and
// any number of places at once) as tiles on a page of their own, each with its full view when it has one: an overview
// of what's going on. Drag a tile's head to move it, its corner to resize it; the order and sizes are
// settings.deskTiles. Build with Laki AI asks the floating chat for one placed here: it shows as a tile with its sample
// data, off until you turn it on. App.tsx passes a DeskApi.
import { type DragEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { DESK_COLS, DESK_ROW, DESK_TILE, type DeskTile, placesOf, type WidgetPlace, type WidgetView } from '../../shared/types'
import { Icon, IconButton, type MenuItem, Page, useMenu } from './ui'
import { CellButton, status, type WidgetApi, WidgetBody } from './Widgets'

export type DeskApi = WidgetApi & {
  place(id: string, places: WidgetPlace[], on?: boolean): Promise<unknown> // its places (and on: turned on with it)
  tiles(t: DeskTile[]): void // the order and sizes, saved
  build?: (want: string) => void // Build with Laki AI: the floating chat asked to make one for the Desk (unset: Laki AI is off)
}
const GAP = 10 // px between tiles, as styles.css' .desk-grid
// a tile: placed on the Desk and on, or made there by Laki AI (off until you look: its sample shows)
export const onDesk = (w: WidgetView) => placesOf(w).includes('desk') && (w.on || !!w.byAi)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function DeskPage({ widgets, tiles: saved = [], api, onClose }: { widgets: WidgetView[]; tiles?: DeskTile[]; api: DeskApi; onClose: () => void }) {
  const [menu, openMenu] = useMenu()
  const grid = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<DeskTile | null>(null) // the tile being resized, as it is under the pointer
  const [drag, setDrag] = useState<string | null>(null)
  const sizing = useRef<() => void>(undefined) // a resize's listeners off: closed mid-drag too
  useEffect(() => () => sizing.current?.(), [])
  // what was just saved, shown until the settings come back with it: no snapping back to the old size or order meanwhile
  const [pending, setPending] = useState<DeskTile[] | null>(null)
  const savedKey = JSON.stringify(saved)
  useEffect(() => setPending(p => (p && JSON.stringify(p) === savedKey ? null : p)), [savedKey]) // every view is a new array: by what it holds
  const mine = pending ?? saved
  const [want, setWant] = useState<string | null>(null) // Build with Laki AI's box, open
  const build = () => api.build && want?.trim() && (api.build(want.trim()), setWant(null))
  const here = widgets.filter(onDesk)
  // the saved order first, then any placed here since (DESK_TILE); gone ones dropped
  const tiles: DeskTile[] = [...mine.filter(t => here.some(w => w.id === t.id)), ...here.filter(w => !mine.some(t => t.id === w.id)).map(w => ({ id: w.id, ...DESK_TILE }))]
  const save = (t: DeskTile[]) => {
    const all = [...t, ...mine.filter(s => !t.some(x => x.id === s.id))].map(({ id, w, h }) => ({ id, w, h })) // one off for now keeps its size
    setPending(all)
    api.tiles(all)
  }
  const resize = (e: ReactPointerEvent, t: DeskTile) => {
    e.preventDefault()
    const el = grid.current
    if (!el || e.button !== 0) return
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId) // the pointer stays its own over a widget's frame and outside the window
    const cell = (el.clientWidth - GAP * (DESK_COLS - 1)) / DESK_COLS
    const [x0, y0] = [e.clientX, e.clientY]
    let now = t
    const move = (m: PointerEvent) => setLive((now = { id: t.id, w: clamp(Math.round(t.w + (m.clientX - x0) / (cell + GAP)), 2, DESK_COLS), h: clamp(Math.round(t.h + (m.clientY - y0) / (DESK_ROW + GAP)), 2, 30) }))
    const off = (sizing.current = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      sizing.current = undefined
    })
    const up = () => {
      off()
      if (now.w !== t.w || now.h !== t.h) save(tiles.map(x => (x.id === t.id ? now : x)))
      setLive(null)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    setLive(t)
  }
  const drop = (e: DragEvent, target: string) => {
    e.preventDefault()
    if (!drag || drag === target) return setDrag(null)
    const moved = tiles.find(t => t.id === drag)!
    const rest = tiles.filter(t => t.id !== drag)
    rest.splice(rest.findIndex(t => t.id === target), 0, moved) // before the one it's dropped on
    save(rest)
    setDrag(null)
  }
  const addable = widgets.filter(w => !here.includes(w))
  const addMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { head: addable.length ? 'Put an extension on the Desk' : 'Every extension is here' },
      ...addable.map(w => ({ label: w.name, sub: w.description?.slice(0, 80), icon: 'plus', run: () => void api.place(w.id, w.on ? [...placesOf(w), 'desk'] : ['desk'], true).catch(() => {}) }) as MenuItem),
      null,
      ...(api.build ? [{ label: 'Build one with Laki AI…', icon: 'ai', run: () => setWant('') } as MenuItem] : []),
      { label: 'Extensions in Settings…', icon: 'settings', run: () => api.settings() },
    ])
  const tileMenu = (e: React.MouseEvent, w: WidgetView) =>
    openMenu(e, [
      ...(w.on && w.every !== undefined && w.here !== null ? [{ label: 'Fetch now', icon: 'refresh', run: () => void api.run(w.id, w.here ?? undefined).catch(() => {}) } as MenuItem] : []),
      ...(w.full ? [{ label: 'Open its full view', icon: 'expand', run: () => api.full(w.id) } as MenuItem] : []),
      { label: 'Its page: settings, Laki AI', icon: 'settings', run: () => api.settings(w.id) },
      null,
      // its only place: off, and the sidebar's when it's on again (one Laki AI made shows here while it's off)
      { label: 'Take it off the Desk', icon: 'x', run: () => void (placesOf(w).length > 1 ? api.place(w.id, placesOf(w).filter(p => p !== 'desk')) : api.place(w.id, ['side'], false)).catch(() => {}) },
    ])
  return (
    <Page
      title="Desk"
      wide
      esc={false} /* a page to stay on, as the rail's others: Esc never closes it */
      onClose={onClose}
      tools={
        <>
          {here.some(w => w.on && w.every !== undefined && w.here !== null) && <IconButton icon="refresh" title="Fetch them all now" onClick={() => here.forEach(w => w.on && w.every !== undefined && w.here !== null && void api.run(w.id, w.here ?? undefined).catch(() => {}))} />}
          {api.build && (
            <button type="button" className={want !== null ? 'on' : ''} onClick={() => setWant(w => (w === null ? '' : null))}>
              <Icon name="ai" size={12} /> Build with AI
            </button>
          )}
          <button type="button" className="primary" onClick={addMenu}>
            <Icon name="plus" size={12} /> Add
          </button>
        </>
      }
    >
      {menu}
      {want !== null && (
        <form className="desk-build" onSubmit={e => (e.preventDefault(), build())}>
          <Icon name="ai" />
          <input autoFocus value={want} onChange={e => setWant(e.target.value)} onKeyDown={e => e.key === 'Escape' && (e.preventDefault(), setWant(null))} placeholder="What should it show? e.g. my open Sentry issues, by count" />
          <button type="submit" className="primary" disabled={!want.trim()}>
            Build it
          </button>
          <span className="muted small">Laki AI asks a few questions in its chat, then puts it here with made-up data: off until you turn it on. Ask it for changes until you like it.</span>
        </form>
      )}
      {!here.length ? (
        <div className="desk-empty">
          <Icon name="desk" size={28} />
          <b>Your Desk is empty</b>
          <p className="muted small">
            Put extensions here (your PRs, links, ones you build with Laki AI) as tiles of any size: an overview of what's
            going on. An extension can be here and in the sidebar at once.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={addMenu}>
              <Icon name="plus" size={12} /> Add an extension
            </button>
            {api.build && want === null && (
              <button type="button" onClick={() => setWant('')}>
                <Icon name="ai" size={12} /> Build one with Laki AI
              </button>
            )}
          </div>
        </div>
      ) : (
        <div ref={grid} className={`desk-grid ${live ? 'sizing' : ''} ${drag ? 'moving' : ''}`}>
          {tiles.map(t => {
            const w = here.find(x => x.id === t.id)!
            const s = live?.id === t.id ? live : t
            return (
              <div key={t.id} className={`desk-tile ${drag === t.id ? 'dragging' : ''} ${live?.id === t.id ? 'sizing' : ''} ${w.on ? '' : 'off'}`} style={{ gridColumn: `span ${s.w}`, gridRow: `span ${s.h}` }} onDragOver={e => drag && e.preventDefault()} onDrop={e => drop(e, t.id)}>
                <div className="desk-head" draggable onDragStart={e => (e.dataTransfer.setData('text/plain', t.id), (e.dataTransfer.effectAllowed = 'move'), setDrag(t.id))} onDragEnd={() => setDrag(null)} data-tip="Drag to move it">
                  <b>{w.name}</b>
                  <span className={`small ${w.error && !w.running && w.on ? 'warn' : 'muted'}`}>{w.on ? status(w) : w.sample ? 'off · made-up data' : 'off'}</span>
                  <span className="grow" />
                  <IconButton icon="more" title={w.name} onClick={e => tileMenu(e, w)} />
                </div>
                <div className="desk-body">{w.button && !w.full ? <CellButton w={w} api={api} /> : <WidgetBody w={w} full={w.full} api={api} sample={!w.on && w.sample} />}</div>
                {!w.on && (
                  <div className="desk-off">
                    <Icon name="ai" size={12} />
                    <span className="grow">By Laki AI · off</span>
                    <button onClick={() => api.settings(w.id)}>Look</button>
                    <button className="primary" onClick={() => void api.place(w.id, placesOf(w), true).catch(() => {})}>
                      Turn on
                    </button>
                  </div>
                )}
                <span className="desk-size" onPointerDown={e => resize(e, t)} data-tip={`${s.w}×${s.h}: drag to resize`} />
                {live?.id === t.id && <span className="desk-dims">{s.w} × {s.h}</span>}
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
