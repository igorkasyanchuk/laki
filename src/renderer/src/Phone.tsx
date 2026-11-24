// A phone's (App's .narrow, ≤640px) bottom tab bar and its More sheet, and the drawer's swipes. The bar: the first four
// of the rail's items (Projects first, with the Needs you count) and More, five equal columns, each an icon over its
// label, a floating glass capsule 49px high over the bottom safe area; as a page scrolls down it folds to its icons
// (data-folded: text.ts barFold), up, at the top or with the keyboard's focus in it it unfolds. Hidden while the
// keyboard is up (main.tsx' html[data-kb]) or a dialog covers the page (styles.css). More: a sheet with the rest, AI
// and Settings, and Quiet
import { useEffect, useRef, useState } from 'react'
import { barFold, type BarFold } from './text'
import { hhmm, quietChoices } from '../../shared/tray'
import type { IconName } from './ui'
import { Icon, Num } from './ui'

export type BarItem = { key: string; icon: IconName; label: string; on: boolean; run: () => void; n?: number }
export type QuietApi = { until?: number; set: (o: { off?: true; minutes?: number; until?: number }) => void }

export const BAR_FIT = 4 // the items before More

export function PhoneBar({ items, quiet }: { items: BarItem[]; quiet: QuietApi }) {
  const [more, setMore] = useState(false)
  const head = items.slice(0, BAR_FIT)
  const rest = items.slice(BAR_FIT)
  const moreOn = rest.some(x => x.on)
  const moreN = rest.reduce((a, x) => a + (x.n ?? 0), 0)
  useEffect(() => {
    if (!more) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), setMore(false))
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [more])
  const go = (x: BarItem) => (setMore(false), x.run())
  // any scroller's scroll (capture: scroll doesn't bubble; passive), each scroller its own baseline; not the bar's or
  // More's own
  const [folded, setFolded] = useState(false)
  const fold = useRef<{ s: BarFold; at: EventTarget | null }>({ s: { y: 0, down: 0, folded: false }, at: null })
  const step = (e: { y: number } | 'focus') => setFolded((fold.current.s = barFold(fold.current.s, e)).folded)
  useEffect(() => {
    const on = (e: Event) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement
      if (!el || el.closest('.phone-bar, .phone-sheet')) return
      if (el !== fold.current.at) (fold.current.at = el), (fold.current.s = { ...fold.current.s, y: el.scrollTop })
      step({ y: el.scrollTop })
    }
    document.addEventListener('scroll', on, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', on, true)
  }, [])
  const cell = (x: BarItem) => (
    <button key={x.key} type="button" className={`pb-item ${x.on ? 'on' : ''}`} aria-current={x.on ? 'page' : undefined} aria-label={x.n ? `${x.label}: ${x.n}` : x.label} onClick={() => go(x)}>
      <span className="pb-icon">
        <Icon name={x.icon} size={22} />
        {!!x.n && <span className="pb-badge"><Num value={x.n} /></span>}
      </span>
      <span className="pb-label">{x.label}</span>
    </button>
  )
  return (
    <>
      <nav className="phone-bar" aria-label="Pages" data-folded={folded ? '' : undefined} onFocus={() => step('focus')}>
        {head.map(cell)}
        <button type="button" className={`pb-item ${moreOn || more ? 'on' : ''}`} aria-current={moreOn ? 'page' : undefined} aria-expanded={more} aria-label={moreN ? `More: ${moreN}` : 'More'} onClick={() => setMore(m => !m)}>
          <span className="pb-icon">
            <Icon name="more" size={22} />
            {moreN > 0 && <span className="pb-badge"><Num value={moreN} /></span>}
          </span>
          <span className="pb-label">More</span>
        </button>
      </nav>
      {more && (
        <div className="phone-sheet-back" role="presentation" onClick={() => setMore(false)}>
          <div className="phone-sheet" role="dialog" aria-label="More" onClick={e => e.stopPropagation()}>
            {rest.map(x => (
              <button key={x.key} type="button" className={`ps-row ${x.on ? 'on' : ''}`} aria-current={x.on ? 'page' : undefined} onClick={() => go(x)}>
                <Icon name={x.icon} size={18} />
                <span className="ps-label">{x.label}</span>
                {!!x.n && <span className="pb-badge"><Num value={x.n} /></span>}
              </button>
            ))}
            <div className="ps-quiet">
              <Icon name="moon" size={18} />
              {quiet.until ? (
                <>
                  <span className="ps-label">Quiet until {hhmm(quiet.until)}</span>
                  <button type="button" onClick={() => (quiet.set({ off: true }), setMore(false))}>End</button>
                </>
              ) : (
                <>
                  <span className="ps-label">Quiet</span>
                  {quietChoices().slice(0, 2).map(c => (
                    <button key={c.label} type="button" aria-label={`Quiet ${c.label}`} onClick={() => (quiet.set(c.o), setMore(false))}>
                      {c.label.replace('for ', '')}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// the drawer's swipes (touch and pen, not a mouse): from the left edge (.drawer-edge) to the right opens it; on it (or
// its scrim) to the left closes it. The direction is settled once the finger has moved 10px: a mostly vertical move is
// a scroll and nothing more; past 60px it acts
export function useDrawerSwipe(on: boolean, open: boolean, set: (open: boolean) => void) {
  useEffect(() => {
    if (!on) return
    let s: { x: number; y: number; id: number; lock?: 'x' | 'y' } | null = null
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !(e.target instanceof Element)) return
      if (open ? !e.target.closest('.sidebar, .side-backdrop') || e.target.closest('.need-row') /* its own swipe: seen */ : !e.target.closest('.drawer-edge')) return
      s = { x: e.clientX, y: e.clientY, id: e.pointerId }
    }
    const move = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id || s.lock) return
      const [dx, dy] = [e.clientX - s.x, e.clientY - s.y]
      if (Math.hypot(dx, dy) >= 10) s.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    const up = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return
      const dx = e.clientX - s.x
      if (s.lock === 'x' && (open ? dx < -60 : dx > 60)) set(!open)
      s = null
    }
    const cancel = () => void (s = null)
    document.addEventListener('pointerdown', down, { passive: true })
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerup', up, { passive: true })
    document.addEventListener('pointercancel', cancel, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
    }
  }, [on, open])
}
