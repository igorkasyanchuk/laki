// Desk (experimental, settings.desk; the rail's Desk, ⌘K): the extensions placed there (a place like the sidebar, and
// any number of places at once) as tiles on a page of their own, each with its full view when it has one: an overview
// of what's going on. Drag a tile's head to move it (onto a tab: to that tab), its corner to resize it; the order, sizes
// and tabs are settings.deskTiles and deskTabs (none: one tab, Desk; laki.deskTab: the one shown). Build with Laki AI asks the floating chat for one placed here: it shows as a tile with its sample
// data, off until you turn it on. App.tsx passes a DeskApi.
import { type DragEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { DESK_COLS, DESK_ROW, DESK_TILE, type DeskTab, type DeskTile, placesOf, type WidgetPlace, type WidgetView } from '../../shared/types'
import { Icon, IconButton, type MenuItem, Page, useMenu } from './ui'
import { CellButton, status, type WidgetApi, WidgetBody } from './Widgets'

export type DeskApi = WidgetApi & {
  place(id: string, places: WidgetPlace[], on?: boolean): Promise<unknown> // its places (and on: turned on with it)
  save(o: { tiles?: DeskTile[]; tabs?: DeskTab[] }): void // the tiles' order, sizes and tabs, the tabs: saved at once
  build?: (want: string) => void // Build with Laki AI: the floating chat asked to make one for the Desk (unset: Laki AI is off)
}
const GAP = 10 // px between tiles, as styles.css' .desk-grid
// a tile: placed on the Desk and on, or made there by Laki AI (off until you look: its sample shows)
export const onDesk = (w: WidgetView) => placesOf(w).includes('desk') && (w.on || !!w.byAi)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const MAIN: DeskTab = { id: 'main', name: 'Desk' } // the one tab while none are set
const TAB_KEY = 'laki.deskTab'
const tabNow = () => {
  try {
    return localStorage.getItem(TAB_KEY) ?? ''
  } catch {
    return ''
  }
}

// wsName: the workspace a per-workspace tile shows (the one selected last), named on its head
export function DeskPage({ widgets, wsName, tiles: saved = [], tabs: savedTabs = [], api, onClose }: { widgets: WidgetView[]; wsName?: string; tiles?: DeskTile[]; tabs?: DeskTab[]; api: DeskApi; onClose: () => void }) {
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
  const [pendingTabs, setPendingTabs] = useState<DeskTab[] | null>(null)
  const tabsKey = JSON.stringify(savedTabs)
  useEffect(() => setPendingTabs(p => (p && JSON.stringify(p) === tabsKey ? null : p)), [tabsKey])
  const tabList = (t => (t.length ? t : [MAIN]))(pendingTabs ?? savedTabs)
  const [cur, setCur] = useState(tabNow)
  const tab = tabList.some(t => t.id === cur) ? cur : tabList[0].id
  const show = (id: string) => {
    setCur(id)
    try {
      localStorage.setItem(TAB_KEY, id)
    } catch {}
  }
  const tabOf = (t: DeskTile) => (t.tab && tabList.some(x => x.id === t.tab) ? t.tab : tabList[0].id)
  const [naming, setNaming] = useState<string | null>(null) // the tab whose name is being typed
  const [over, setOver] = useState<string | null>(null) // the tab a tile is dragged over
  const [want, setWant] = useState<string | null>(null) // Build with Laki AI's box, open
  const build = () => api.build && want?.trim() && (api.build(want.trim()), setWant(null))
  const here = widgets.filter(onDesk)
  // the saved order first, then any placed here since (DESK_TILE); gone ones dropped
  const tiles: DeskTile[] = [...mine.filter(t => here.some(w => w.id === t.id)), ...here.filter(w => !mine.some(t => t.id === w.id)).map(w => ({ id: w.id, ...DESK_TILE }))]
  const shown = tiles.filter(t => tabOf(t) === tab)
  // one placed here since (Settings, Laki AI's Build): kept on the tab shown, where you'd look for it
  const fresh = here.filter(w => !mine.some(t => t.id === w.id)).map(w => w.id)
  useEffect(() => void (fresh.length && save(tiles.map(t => (fresh.includes(t.id) ? { ...t, tab } : t)))), [fresh.join()])
  const tidy = (t: DeskTile[]) => [...t, ...mine.filter(s => !t.some(x => x.id === s.id))].map(({ id, w, h, tab }) => ({ id, w, h, ...(tab && { tab }) })) // one off for now keeps its size and tab
  const save = (t: DeskTile[], tabs?: DeskTab[]) => {
    const all = tidy(t)
    setPending(all)
    if (tabs) setPendingTabs(tabs)
    api.save({ tiles: all, ...(tabs && { tabs }) })
  }
  const saveTabs = (tabs: DeskTab[]) => (setPendingTabs(tabs), api.save({ tabs }))
  const newTab = () => {
    const taken = new Set(tabList.map(t => t.name))
    let k = tabList.length + 1
    while (taken.has(`Tab ${k}`)) k++
    const t = { id: Math.random().toString(36).slice(2, 8), name: `Tab ${k}` }
    return { t, tabs: [...tabList, t] }
  }
  const addTab = () => {
    const { t, tabs } = newTab()
    saveTabs(tabs)
    show(t.id)
    setNaming(t.id)
  }
  const rename = (id: string, name: string) => {
    const n = name.trim().slice(0, 40)
    setNaming(null)
    if (n && n !== tabList.find(t => t.id === id)?.name) saveTabs(tabList.map(t => (t.id === id ? { ...t, name: n } : t)))
  }
  // a tab gone: its tiles to the first of the others
  const removeTab = (id: string) => {
    const tabs = tabList.filter(t => t.id !== id)
    if (!tabs.length) return
    save(
      tiles.map(t => (tabOf(t) === id ? { ...t, tab: tabs[0].id } : t)),
      tabs,
    )
    if (tab === id) show(tabs[0].id)
  }
  const shiftTab = (id: string, by: number) => {
    const i = tabList.findIndex(t => t.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= tabList.length) return
    const tabs = [...tabList]
    ;[tabs[i], tabs[j]] = [tabs[j], tabs[i]]
    // a tile with no tab is the first tab's: pinned where it is, so it doesn't follow another tab moved first
    save([...tiles, ...mine.filter(s => !tiles.some(t => t.id === s.id))].map(t => ({ ...t, tab: tabOf(t) })), tabs)
  }
  // a tile to another tab: last there
  const moveTo = (id: string, to: string, tabs?: DeskTab[]) => {
    const t = tiles.find(x => x.id === id)
    if (!t) return
    save([...tiles.filter(x => x.id !== id), { ...t, tab: to }], tabs)
  }
  const tabMenu = (e: React.MouseEvent, t: DeskTab) =>
    openMenu(e, [
      { label: 'Rename', icon: 'pencil', run: () => setNaming(t.id) },
      ...(tabList[0].id !== t.id ? [{ label: 'Move left', icon: 'chevronLeft', run: () => shiftTab(t.id, -1) } as MenuItem] : []),
      ...(tabList.at(-1)!.id !== t.id ? [{ label: 'Move right', icon: 'chevronRight', run: () => shiftTab(t.id, 1) } as MenuItem] : []),
      null,
      ...(tabList.length > 1 ? [{ label: `Remove the tab (its tiles go to ${tabList.find(x => x.id !== t.id)!.name})`, icon: 'x', run: () => removeTab(t.id) } as MenuItem] : []),
    ])
  const resize = (e: ReactPointerEvent, t: DeskTile) => {
    e.preventDefault()
    const el = grid.current
    if (!el || e.button !== 0) return
    const handle = e.currentTarget as HTMLElement
    const tile = handle.parentElement!
    handle.setPointerCapture(e.pointerId) // the pointer stays its own over a widget's frame and outside the window
    const cell = (el.clientWidth - GAP * (DESK_COLS - 1)) / DESK_COLS
    const box = tile.getBoundingClientRect()
    const [dx, dy] = [box.right - e.clientX, box.bottom - e.clientY] // where on its corner it was taken
    // the size from where the pointer is over the tile as it is now (a scroll meanwhile counts), not from how far it
    // moved; the grid keeps its height meanwhile: a bottom tile shrinking would shorten the page, which scrolls it up
    // under the pointer, which shrinks it again
    const page = (p => { for (; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p })(el.parentElement) ?? undefined
    el.style.minHeight = `${el.offsetHeight}px`
    let now = t
    let at = { x: e.clientX, y: e.clientY }
    let raf = 0
    const size = () => {
      const r = tile.getBoundingClientRect()
      const [w, h] = [clamp(Math.round((at.x + dx - r.left + GAP) / (cell + GAP)), 2, DESK_COLS), clamp(Math.round((at.y + dy - r.top + GAP) / (DESK_ROW + GAP)), 2, 30)]
      if (w !== now.w || h !== now.h) setLive((now = { ...t, w, h })) // a scroll's every event: only a new size draws
    }
    // near the page's top or bottom edge: it scrolls, so a tile grows past what's in sight
    const edge = () => {
      raf = 0
      const b = page?.getBoundingClientRect()
      const v = !b ? 0 : at.y > b.bottom - 40 ? 14 : at.y < b.top + 40 ? -14 : 0
      if (!page || !v || (v < 0 ? page.scrollTop <= 0 : page.scrollTop + page.clientHeight >= page.scrollHeight)) return
      page.scrollTop += v
      raf = requestAnimationFrame(edge)
    }
    const move = (m: PointerEvent) => ((at = { x: m.clientX, y: m.clientY }), size(), raf || (raf = requestAnimationFrame(edge)))
    const off = (sizing.current = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      page?.removeEventListener('scroll', size)
      cancelAnimationFrame(raf)
      el.style.minHeight = ''
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
    page?.addEventListener('scroll', size)
    setLive(t)
  }
  const drop = (e: DragEvent, target: string) => {
    e.preventDefault()
    if (!drag || drag === target) return setDrag(null)
    const moved = { ...tiles.find(t => t.id === drag)!, tab: tabOf(tiles.find(t => t.id === target)!) }
    const rest = tiles.filter(t => t.id !== drag)
    rest.splice(rest.findIndex(t => t.id === target), 0, moved) // before the one it's dropped on
    save(rest)
    setDrag(null)
  }
  const addable = widgets.filter(w => !here.includes(w))
  const addMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { head: addable.length ? 'Put an extension on the Desk' : 'Every extension is here' },
      ...addable.map(w => ({ label: w.name, sub: w.description?.slice(0, 80), icon: 'plus', run: () => (save([...tiles.filter(t => t.id !== w.id), { id: w.id, ...(mine.find(t => t.id === w.id) ?? DESK_TILE), tab }]), void api.place(w.id, w.on ? [...placesOf(w), 'desk'] : ['desk'], true).catch(() => {})) }) as MenuItem), // on this tab
      null,
      ...(api.build ? [{ label: 'Build one with Laki AI…', icon: 'ai', run: () => setWant('') } as MenuItem] : []),
      { label: 'Extensions in Settings…', icon: 'settings', run: () => api.settings() },
    ])
  const tileMenu = (e: React.MouseEvent, w: WidgetView) =>
    openMenu(e, [
      ...(w.on && w.every !== undefined && w.here !== null ? [{ label: 'Fetch now', icon: 'refresh', run: () => void api.run(w.id, w.here ?? undefined).catch(() => {}) } as MenuItem] : []),
      ...(w.full ? [{ label: 'Open its full view', icon: 'expand', run: () => api.full(w.id) } as MenuItem] : []),
      { label: 'Its page: settings, Laki AI', icon: 'settings', run: () => api.settings(w.id) },
      {
        label: 'Move to tab',
        icon: 'arrowRight',
        items: [
          ...tabList.filter(t => t.id !== tab).map(t => ({ label: t.name, run: () => moveTo(w.id, t.id) }) as MenuItem),
          { label: 'A new tab', icon: 'plus', run: () => (({ t, tabs }) => (moveTo(w.id, t.id, tabs), show(t.id), setNaming(t.id)))(newTab()) },
        ],
      },
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
          {(ws => ws.length > 0 && <IconButton icon="refresh" title="Fetch this tab's now" onClick={() => ws.forEach(w => void api.run(w.id, w.here ?? undefined).catch(() => {}))} />)(here.filter(w => shown.some(t => t.id === w.id) && w.on && w.every !== undefined && w.here !== null))}
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
      {(here.length > 0 || savedTabs.length > 0) && (
        <div className="desk-tabs" role="tablist" aria-label="Desk tabs">
          {tabList.map(t =>
            naming === t.id ? (
              <input key={t.id} className="desk-tab-name" autoFocus defaultValue={t.name} maxLength={40} aria-label="The tab's name" onFocus={e => e.currentTarget.select()} onBlur={e => rename(t.id, e.currentTarget.value)} onKeyDown={e => (e.key === 'Enter' ? rename(t.id, e.currentTarget.value) : e.key === 'Escape' && (e.preventDefault(), (e.currentTarget.value = t.name), setNaming(null)))} />
            ) : (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`desk-tab${tab === t.id ? ' on' : ''}${drag && over === t.id ? ' over' : ''}`}
                data-tip={drag ? `Move it to ${t.name}` : 'Double-click to rename; right click for more'}
                onClick={() => show(t.id)}
                onDoubleClick={() => setNaming(t.id)}
                onContextMenu={e => (e.preventDefault(), tabMenu(e, t))}
                onDragOver={e => drag && tabOf(tiles.find(x => x.id === drag)!) !== t.id && (e.preventDefault(), setOver(t.id))}
                onDragLeave={() => setOver(o => (o === t.id ? null : o))}
                onDrop={e => (e.preventDefault(), setOver(null), drag && moveTo(drag, t.id), setDrag(null))}
              >
                {t.name}
                <span className="muted small">{tiles.filter(x => tabOf(x) === t.id).length}</span>
              </button>
            ),
          )}
          <IconButton icon="plus" title="New tab" onClick={addTab} />
        </div>
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
      ) : !shown.length ? (
        <div className="desk-empty">
          <b>Nothing on {tabList.find(t => t.id === tab)!.name} yet</b>
          <p className="muted small">Drag a tile's head onto this tab, pick it in a tile's ⋯ › Move to tab, or add one here.</p>
          <div className="row">
            <button type="button" className="primary" onClick={addMenu}>
              <Icon name="plus" size={12} /> Add an extension
            </button>
          </div>
        </div>
      ) : (
        <div ref={grid} role="tabpanel" className={`desk-grid ${live ? 'sizing' : ''} ${drag ? 'moving' : ''}`}>
          {shown.map(t => {
            const w = here.find(x => x.id === t.id)!
            const s = live?.id === t.id ? live : t
            return (
              <div key={t.id} className={`desk-tile ${drag === t.id ? 'dragging' : ''} ${live?.id === t.id ? 'sizing' : ''} ${w.on ? '' : 'off'}`} style={{ gridColumn: `span ${s.w}`, gridRow: `span ${s.h}` }} onDragOver={e => drag && e.preventDefault()} onDrop={e => drop(e, t.id)}>
                <div className="desk-head" draggable onDragStart={e => (e.dataTransfer.setData('text/plain', t.id), (e.dataTransfer.effectAllowed = 'move'), setDrag(t.id))} onDragEnd={() => (setDrag(null), setOver(null))} data-tip="Drag to move it">
                  <b>{w.name}</b>
                  {w.scope === 'workspace' && <span className="small muted" data-tip="Per workspace: the one you selected last">{wsName ?? 'no workspace'}</span>}
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
