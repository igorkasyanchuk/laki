// Desk (experimental, settings.desk; the rail's Desk, ⌘K): the extensions placed there (a place like the sidebar, and
// any number of places at once) as tiles on a page of their own, each with its full view when it has one: an overview
// of what's going on. Drag a tile's head to put it in any cell of the grid (gaps stay; one in its way moves down; onto a
// tab: to that tab), its corner to resize it; the cells, sizes and tabs are settings.deskTiles and deskTabs (none: one tab, Desk; laki.deskTab: the one shown). Build with AI's dialog
// (DeskBuild: what it should show, screenshots, files) opens the extension studio on it: Laki AI asks, then writes one
// placed here, a tile with its sample data, off until you turn it on. App.tsx passes a DeskApi.
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { emojiOf } from '../../shared/icons'
import { DESK_COLS, DESK_ROW, DESK_TILE, type DeskTab, type DeskTile, deskLayout, placesOf, type WidgetPlace, type WidgetView } from '../../shared/types'
import { api as daemon, bridge } from './api'
import { Modal } from './panels'
import { type Img, PromptInput, useDraft } from './PromptInput'
import { colorVar, Icon, IconButton, iconItems, isIconName, type MenuItem, Page, TAB_COLORS, useMenu } from './ui'
import { CellButton, status, type WidgetApi, WidgetBody } from './Widgets'

export type DeskApi = WidgetApi & {
  place(id: string, places: WidgetPlace[], on?: boolean): Promise<unknown> // its places (and on: turned on with it)
  save(o: { tiles?: DeskTile[]; tabs?: DeskTab[] }): void // the tiles' order, sizes and tabs, the tabs: saved at once
  build?: (a: DeskAsk) => void // Build with AI: the extension studio, its first ask this (unset: Laki AI is off)
}
export type DeskAsk = { want: string; text: string; images: Img[] } // what's wanted (its id's words), the ask, its screenshots
const GAP = 10 // px between tiles, as styles.css' .desk-grid
// a tile: placed on the Desk and on, or made there by Laki AI (off until you look: its sample shows)
export const onDesk = (w: WidgetView) => placesOf(w).includes('desk') && (w.on || !!w.byAi)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const MAIN: DeskTab = { id: 'main', name: 'My Desk' } // the one tab while none are set
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
  const [live, setLive] = useState<DeskTile | null>(null) // the tile being moved or resized, as it is under the pointer
  const [drag, setDrag] = useState<string | null>(null) // the tile being moved
  const sizing = useRef<() => void>(undefined) // a move's or resize's listeners off: closed mid-drag too
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
  const [building, setBuilding] = useState(false) // Build with AI's dialog
  const here = widgets.filter(onDesk)
  // the saved order first, then any placed here since (DESK_TILE); gone ones dropped
  const tiles: DeskTile[] = [...mine.filter(t => here.some(w => w.id === t.id)), ...here.filter(w => !mine.some(t => t.id === w.id)).map(w => ({ id: w.id, ...DESK_TILE }))]
  const shown = tiles.filter(t => tabOf(t) === tab)
  // one placed here since (Settings, Laki AI's Build): kept on the tab shown, where you'd look for it
  const fresh = here.filter(w => !mine.some(t => t.id === w.id)).map(w => w.id)
  useEffect(() => void (fresh.length && save(tiles.map(t => (fresh.includes(t.id) ? { ...t, tab } : t)))), [fresh.join()])
  const tidy = (t: DeskTile[]) => [...t, ...mine.filter(s => !t.some(x => x.id === s.id))].map(({ id, w, h, tab, x, y }) => ({ id, w, h, ...(tab && { tab }), ...(x !== undefined && y !== undefined && { x, y }) })) // one off for now keeps its size, cell and tab
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
  const setIcon = (id: string, icon?: string) => saveTabs(tabList.map(t => (t.id === id ? { ...t, icon } : t))) // none: undefined, which JSON leaves out
  const setColor = (id: string, c: string) => saveTabs(tabList.map(t => (t.id === id ? { ...t, color: c === 'none' ? undefined : c } : t)))
  // a tab gone: its tiles to the first of the others, under the tiles there (their cells were another tab's)
  const removeTab = (id: string) => {
    const tabs = tabList.filter(t => t.id !== id)
    if (!tabs.length) return
    save(
      tiles.map(t => (tabOf(t) === id ? { id: t.id, w: t.w, h: t.h, tab: tabs[0].id } : t)),
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
  // a tile to another tab: under the tiles there
  const moveTo = (id: string, to: string, tabs?: DeskTab[]) => {
    const t = tiles.find(x => x.id === id)
    if (!t) return
    save([...tiles.filter(x => x.id !== id), { id, w: t.w, h: t.h, tab: to }], tabs)
  }
  const tabMenu = (e: React.MouseEvent, t: DeskTab) =>
    openMenu(e, [
      { label: 'Rename', icon: 'pencil', run: () => setNaming(t.id) },
      ...iconItems(t.icon, i => setIcon(t.id, i)),
      { colors: TAB_COLORS, value: t.color, pick: c => setColor(t.id, c) },
      ...(tabList[0].id !== t.id ? [{ label: 'Move left', icon: 'chevronLeft', run: () => shiftTab(t.id, -1) } as MenuItem] : []),
      ...(tabList.at(-1)!.id !== t.id ? [{ label: 'Move right', icon: 'chevronRight', run: () => shiftTab(t.id, 1) } as MenuItem] : []),
      null,
      ...(tabList.length > 1 ? [{ label: `Remove the tab (its tiles go to ${tabList.find(x => x.id !== t.id)!.name})`, icon: 'x', run: () => removeTab(t.id) } as MenuItem] : []),
    ])
  // where this tab's tiles are, each in its cell (one not placed yet: where the grid's flow had it, under the placed
  // ones); with one moved or resized (at): the others pinned where they are first, then it where the pointer has it
  const base = deskLayout(shown)
  const at = (t: DeskTile) => deskLayout(base.map(x => (x.id === t.id ? t : x)), t.id)
  const laid = live ? at(live) : base
  const cellW = (el: HTMLElement) => (el.clientWidth - GAP * (DESK_COLS - 1)) / DESK_COLS
  // after a move or a resize: every tile of the tab saved in its cell, so the ones it pushed down stay there
  const keep = (t: DeskTile) => (to => save(tiles.map(x => to.find(y => y.id === x.id) ?? x)))(at(t))
  // a drag's end saves with the tiles as they are then (a view that came meanwhile: Laki AI placed one, another window)
  const ends = useRef({ keep, moveTo })
  ends.current = { keep, moveTo }
  // a drag of a tile's head or corner until it ends, every way once: the capture goes with a release, a cancel, and a
  // release the page never got (outside the window, over its title bar or a frame: Chromium drops the capture at the
  // next move, with no pointerup); the window's blur too, which keeps where it got to; Esc (done's cancel). Near the page's top or
  // bottom edge it scrolls, a scroll meanwhile counts; the grid keeps its height meanwhile: a bottom tile shrinking
  // would shorten the page, which scrolls it up under the pointer, which shrinks it again
  const track = (e: ReactPointerEvent, el: HTMLElement, step: (at: { x: number; y: number }) => void, done: (cancel: boolean) => void) => {
    const handle = e.currentTarget as HTMLElement
    const id = e.pointerId
    handle.setPointerCapture(id) // the pointer stays its own over a widget's frame and outside the window
    const page = (p => { for (; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p })(el.parentElement) ?? undefined
    el.style.minHeight = `${el.offsetHeight}px`
    el.style.setProperty('--cw', `${cellW(el) + GAP}px`) // the grid's dots while it moves
    let at = { x: e.clientX, y: e.clientY }
    let raf = 0
    const again = () => step(at)
    const edge = () => {
      raf = 0
      const b = page?.getBoundingClientRect()
      const v = !b ? 0 : at.y > b.bottom - 40 ? 14 : at.y < b.top + 40 ? -14 : 0
      if (!page || !v || (v < 0 ? page.scrollTop <= 0 : page.scrollTop + page.clientHeight >= page.scrollHeight)) return
      page.scrollTop += v
      raf = requestAnimationFrame(edge)
    }
    const move = (m: PointerEvent) => ((at = { x: m.clientX, y: m.clientY }), step(at), raf || (raf = requestAnimationFrame(edge)))
    const off = (sizing.current = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('lostpointercapture', end)
      window.removeEventListener('blur', end)
      window.removeEventListener('keydown', key, true)
      page?.removeEventListener('scroll', again)
      cancelAnimationFrame(raf)
      el.style.minHeight = ''
      el.style.removeProperty('--cw')
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
      sizing.current = undefined
    })
    const end = () => (off(), done(false))
    const key = (k: KeyboardEvent) => k.key === 'Escape' && (k.preventDefault(), k.stopPropagation(), off(), done(true))
    handle.addEventListener('pointermove', move)
    handle.addEventListener('lostpointercapture', end)
    window.addEventListener('blur', end)
    window.addEventListener('keydown', key, true)
    page?.addEventListener('scroll', again)
  }
  // the corner: the size from where the pointer is over the tile as it is now, not from how far it moved; up to the
  // grid's right edge. Esc keeps the size it has, as a release would. A phone's one column (.narrow): its height only
  const resize = (e: ReactPointerEvent, t: DeskTile & { x: number; y: number }) => {
    e.preventDefault()
    const el = grid.current
    if (!el || e.button !== 0) return
    const tile = (e.currentTarget as HTMLElement).parentElement!
    const cell = cellW(el)
    const box = tile.getBoundingClientRect()
    const [dx, dy] = [box.right - e.clientX, box.bottom - e.clientY] // where on its corner it was taken
    const tall = !!el.closest('.narrow') // no columns to widen it across
    let now: DeskTile = t
    track(
      e,
      el,
      at => {
        const r = tile.getBoundingClientRect()
        const [w, h] = [tall ? t.w : clamp(Math.round((at.x + dx - r.left + GAP) / (cell + GAP)), 2, DESK_COLS - t.x), clamp(Math.round((at.y + dy - r.top + GAP) / (DESK_ROW + GAP)), 2, 30)]
        if (w !== now.w || h !== now.h) setLive((now = { ...t, w, h })) // a scroll's every event: only a new size draws
      },
      () => (now !== t && ends.current.keep(now), setLive(null)),
    )
    setLive(t)
  }
  // the head: the tile to the cell under the pointer (where on it it was taken kept), the ones in its way moved down as
  // it goes; onto a tab of the bar: to that tab; Esc: back where it was. Under 4px it's a click
  const move = (e: ReactPointerEvent, t: DeskTile & { x: number; y: number }) => {
    const el = grid.current
    // a phone's one column (.narrow) has no cells to put it in: the tiles keep the desktop's
    if (!el || e.button !== 0 || el.closest('.narrow') || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const cell = cellW(el)
    const g = el.getBoundingClientRect()
    const [ox, oy] = [e.clientX - g.left - t.x * (cell + GAP), e.clientY - g.top - t.y * (DESK_ROW + GAP)]
    const [sx, sy] = [e.clientX, e.clientY]
    let now: DeskTile = t
    let to: string | null = null
    let going = false
    track(
      e,
      el,
      at => {
        if (!going && Math.hypot(at.x - sx, at.y - sy) < 4) return
        if (!going) (going = true), setDrag(t.id), setLive(t)
        const over = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-desk-tab]')?.dataset.deskTab
        setOver((to = over && over !== tab ? over : null))
        if (to) return // where it was on this tab stays shown
        const r = el.getBoundingClientRect()
        const [x, y] = [clamp(Math.round((at.x - ox - r.left) / (cell + GAP)), 0, DESK_COLS - t.w), Math.max(0, Math.round((at.y - oy - r.top) / (DESK_ROW + GAP)))]
        if (x !== now.x || y !== now.y) setLive((now = { ...t, x, y }))
      },
      cancel => (cancel ? undefined : to ? ends.current.moveTo(t.id, to) : now !== t && ends.current.keep(now), setLive(null), setDrag(null), setOver(null)), // Esc: back where it was
    )
  }
  const addable = widgets.filter(w => !here.includes(w))
  const addMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { head: addable.length ? 'Put an extension on My Desk' : 'Every extension is here' },
      ...addable.map(w => ({ label: w.name, sub: w.description?.slice(0, 80), icon: 'plus', run: () => (save([...tiles.filter(t => t.id !== w.id), { id: w.id, ...(mine.find(t => t.id === w.id) ?? DESK_TILE), tab }]), void api.place(w.id, w.on ? [...placesOf(w), 'desk'] : ['desk'], true).catch(() => {})) }) as MenuItem), // on this tab
      null,
      ...(api.build ? [{ label: 'Build one with Laki AI…', icon: 'ai', run: () => setBuilding(true) } as MenuItem] : []),
      { label: 'Extensions in Settings…', icon: 'settings', run: () => api.settings() },
    ])
  const tileMenu = (e: React.MouseEvent, w: WidgetView) =>
    openMenu(e, [
      ...(w.on && w.every !== undefined && w.here !== null ? [{ label: 'Fetch now', icon: 'refresh', run: () => void api.run(w.id, w.here ?? undefined).catch(() => {}) } as MenuItem] : []),
      ...(w.full ? [{ label: 'Open its full view', icon: 'expand', run: () => api.full(w.id) } as MenuItem] : []),
      { label: 'Edit', icon: 'settings', run: () => api.settings(w.id) },
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
      { label: 'Take it off My Desk', icon: 'x', run: () => void (placesOf(w).length > 1 ? api.place(w.id, placesOf(w).filter(p => p !== 'desk')) : api.place(w.id, ['side'], false)).catch(() => {}) },
    ])
  return (
    <Page
      title="My Desk"
      wide
      esc={false} /* a page to stay on, as the rail's others: Esc never closes it */
      onClose={onClose}
      tools={
        <>
          {(ws => ws.length > 0 && <IconButton icon="refresh" title="Fetch this tab's now" onClick={() => ws.forEach(w => void api.run(w.id, w.here ?? undefined).catch(() => {}))} />)(here.filter(w => shown.some(t => t.id === w.id) && w.on && w.every !== undefined && w.here !== null))}
          {api.build && (
            <button type="button" onClick={() => setBuilding(true)}>
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
      {building && api.build && <DeskBuild onBuild={a => (setBuilding(false), api.build!(a))} onClose={() => setBuilding(false)} />}
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
                data-desk-tab={t.id}
                style={colorVar(t.color)}
              >
                {t.color && !isIconName(t.icon) && <span className="desk-dot" aria-hidden />}
                {isIconName(t.icon) ? <Icon name={t.icon} size={13} /> : emojiOf(t.icon) && <span aria-hidden>{t.icon}</span>}
                {t.name}
              </button>
            ),
          )}
          <IconButton icon="plus" title="New tab" onClick={addTab} />
        </div>
      )}
      {!here.length ? (
        <div className="desk-empty">
          <Icon name="desk" size={28} />
          <b>My Desk is empty</b>
          <p className="muted small">
            Put extensions here (your PRs, links, ones you build with Laki AI) as tiles of any size: an overview of what's
            going on. An extension can be here and in the sidebar at once.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={addMenu}>
              <Icon name="plus" size={12} /> Add an extension
            </button>
            {api.build && (
              <button type="button" onClick={() => setBuilding(true)}>
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
        <div ref={grid} role="tabpanel" className={`desk-grid ${live && !drag ? 'sizing' : ''} ${drag ? 'moving' : ''}`}>
          {/* in the order saved, whatever the cells: a frame moved in the page loads again */}
          {shown.map(t => {
            const w = here.find(x => x.id === t.id)!
            const s = laid.find(x => x.id === t.id)!
            return (
              <div key={t.id} className={`desk-tile ${drag === t.id ? 'dragging' : ''} ${live?.id === t.id && !drag ? 'sizing' : ''} ${w.on ? '' : 'off'}`} style={{ gridColumn: `${s.x + 1} / span ${s.w}`, gridRow: `${s.y + 1} / span ${s.h}`, order: s.y * DESK_COLS + s.x, '--h': s.h } as CSSProperties}>
                <div className="desk-head" onPointerDown={e => move(e, s)} data-tip={drag ? undefined : 'Drag to put it anywhere on the grid'}>
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
                <span className="desk-size" onPointerDown={e => resize(e, s)} data-tip={`${s.w}×${s.h}: drag to resize`} />
                {live?.id === t.id && <span className="desk-dims">{s.w} × {s.h}</span>}
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}

// Build with AI: what it should show and where from, with screenshots (pasted, dropped, attached, or taken: a part of
// the screen) and files (text: each goes in the ask, cut at FILE_MAX); Build it opens the extension studio on it
const FILE_MAX = 20_000 // characters of a file in the ask
const FILE_BYTES = 1_000_000 // a file bigger than this isn't read
const fence = (t: string) => '`'.repeat(Math.max(3, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1))) // longer than any run of backticks in it
export const deskAsk = (want: string, files: { name: string; text: string }[]) =>
  [want.trim(), 'It goes on my Desk ("place": "desk"): a tile there.', ...files.map(f => (c => `Attached: ${f.name}\n${fence(c)}\n${c}\n${fence(c)}`)(f.text.length > FILE_MAX ? `${f.text.slice(0, FILE_MAX)}\n… (cut: ${f.text.length} characters in all)` : f.text))].join('\n\n')

function DeskBuild({ onBuild, onClose }: { onBuild: (a: DeskAsk) => void; onClose: () => void }) {
  const [text, setText, images, setImages] = useDraft('desk:build')
  const [files, setFiles] = useState<{ name: string; text: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const save = (data: string, ext: string) => daemon.call<string>('imageSave', { data, ext })
  const attach = async (fs: File[]) => {
    setErr('')
    for (const f of fs) {
      const t = f.size > FILE_BYTES ? null : await f.text().catch(() => '\u0000')
      if (t === null || t.includes('\u0000')) setErr(`${f.name}: ${t === null ? 'over 1 MB' : 'not a text file'}; screenshots and text files only`)
      else setFiles(x => [...x.filter(y => y.name !== f.name), { name: f.name, text: t }])
    }
  }
  const shoot = async () => {
    setErr('')
    try {
      const png = await bridge!.shoot!()
      if (!png) return // cancelled
      const path = await save(png, 'png')
      setImages(x => [...x, { path, url: `data:image/png;base64,${png}` }])
    } catch (e) {
      setErr(`The screenshot: ${(e as Error).message}`)
    }
  }
  const ok = !saving && !!text.trim()
  const build = () => ok && (onBuild({ want: text.trim(), text: deskAsk(text, files), images }), setText(''), setImages([]))
  return (
    <Modal title="Build an extension with Laki AI" wide onClose={onClose}>
      <form className="form desk-build" onSubmit={e => (e.preventDefault(), build())}>
        <div className="nw-card nw-composer">
          <PromptInput
            value={text}
            onChange={setText}
            images={images}
            onImages={setImages}
            save={save}
            files={fs => void attach(fs)}
            dictate={bridge?.dictate}
            dictationSettings={bridge?.dictationSettings}
            onSubmit={build}
            onBusy={setSaving}
            rows={7}
            placeholder={'What should it show, and where does it come from? e.g. the PRs posted in a Slack channel, each with its review state, since the last run.\n\nPaste or drop screenshots and files here.'}
            tools={
              bridge?.shoot && (
                <button type="button" className="ib" aria-label="Take a screenshot" data-tip="Take a screenshot: drag over a part of the screen (Space, then a click: a window)" onClick={() => void shoot()}>
                  <Icon name="crop" />
                </button>
              )
            }
          />
        </div>
        {files.length > 0 && (
          <div className="desk-files" aria-label="Attached files">
            {files.map(f => (
              <span key={f.name} className="tag" data-tip={`${f.text.length.toLocaleString()} characters${f.text.length > FILE_MAX ? `: the first ${FILE_MAX.toLocaleString()} go` : ''}`}>
                <Icon name="file" size={11} /> {f.name}
                <button type="button" className="link" aria-label={`Remove ${f.name}`} onClick={() => setFiles(x => x.filter(y => y !== f))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {err && <p className="warn small">{err}</p>}
        <p className="muted small">The extension studio opens with it: Laki AI asks a few questions, then puts it on My Desk with made-up data, off until you turn it on. Ask it for changes there until you like it.</p>
        <div className="buttons">
          <span className="muted small">⌘⏎</span>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            <Icon name="ai" size={12} /> Build it
          </button>
        </div>
      </form>
    </Modal>
  )
}
