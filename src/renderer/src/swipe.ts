// Two fingers across a row (a trackpad's sideways wheel) or a finger (touch, pen) pull it sideways: past SWIPE_ARM its
// first action is armed (left: Snooze; right: Seen), past SWIPE_ARM2 left its second (Archive); let go and the armed one
// runs, short of them it springs back. One listener on the list (Sidebar's: its workspace rows, data-row ws:…, and Needs
// you's cards and rows, data-swipe-tab), useRowSwipe; the row moves by transform only, from a CSS variable (--swipe),
// no React state a frame. The strip it uncovers names the action, in the existing colors (inline: the first load's CSS
// has no room). A vertical scroll under way never turns into one, and the list's own scrolling stays; a row being
// dragged (ui.tsx useRowDrag's lift: data-lifted) cancels it. Motion: None: off. Every action is in the row's menu too
import { useEffect, useRef } from 'react'

export const SWIPE_LOCK = 10 // px that settle a move's direction (Phone.tsx' drawer's)
export const SWIPE_ARM = 64
export const SWIPE_ARM2 = 160
export const SWIPE_IDLE = 160 // ms with no wheel: the fingers are off
export type SwipeAct = 'left' | 'left2' | 'right'
export type SwipeActs = Partial<Record<SwipeAct, () => void>>
export type Swipe = { dx: number; dy: number; lock?: 'x' | 'y' }
export const SWIPE_SAYS: Record<SwipeAct, string> = { left: 'Snooze', left2: 'Archive', right: 'Seen' }
const COLOR: Record<SwipeAct, string> = { left: 'var(--waiting)', left2: 'var(--error)', right: 'var(--accent)' }

// a move (a wheel's delta, or a finger's from where it went down): its direction settled once SWIPE_LOCK away
export function swipeMove(s: Swipe, x: number, y: number): Swipe {
  const n: Swipe = { ...s, dx: s.dx + x, dy: s.dy + y }
  if (!n.lock && Math.hypot(n.dx, n.dy) >= SWIPE_LOCK) n.lock = Math.abs(n.dx) > Math.abs(n.dy) ? 'x' : 'y'
  return n
}
// what a let-go runs: none for an up-and-down move, during a drag, or short of the row's own actions
export const swipeAct = (s: Swipe, has: SwipeActs, dragging = false): SwipeAct | undefined =>
  dragging || s.lock !== 'x' ? undefined : s.dx <= -SWIPE_ARM2 && has.left2 ? 'left2' : s.dx <= -SWIPE_ARM && has.left ? 'left' : s.dx >= SWIPE_ARM && has.right ? 'right' : undefined
// how far the row is drawn: as far as it has actions, a little past the last
export const swipeShown = (dx: number, has: SwipeActs) => Math.max(has.left2 ? -(SWIPE_ARM2 + 40) : has.left ? -(SWIPE_ARM + 40) : 0, Math.min(has.right ? SWIPE_ARM + 40 : 0, dx))

export function useRowSwipe(ref: { current: HTMLElement | null }, actsOf: (row: HTMLElement) => SwipeActs | undefined, on = true) {
  const of = useRef(actsOf)
  of.current = actsOf
  useEffect(() => {
    const list = ref.current
    if (!list || !on) return
    let s: Swipe | null = null
    let row: HTMLElement | null = null
    let box: DOMRect | undefined // the row's place before it moved: the strip's
    let acts: SwipeActs = {}
    let strip: HTMLDivElement | null = null
    let idle: ReturnType<typeof setTimeout> | undefined
    let vAt = -1e9 // the last vertical wheel's time
    let pid: number | undefined
    let at = { x: 0, y: 0 }
    let ate = false // a finger's swipe: the click its lift makes isn't one
    const html = document.documentElement
    const still = () => html.dataset.motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches
    const dragging = () => !!document.querySelector('[data-lifted]')
    const begin = (t: EventTarget | null) => {
      const r = t instanceof Element ? t.closest<HTMLElement>('[data-row^="ws:"], [data-swipe-tab]') : null
      const a = r && list.contains(r) && !dragging() ? of.current(r) : undefined
      if (!r || !a || !Object.values(a).some(Boolean)) return false
      ;[row, acts, box, s] = [r, a, r.getBoundingClientRect(), { dx: 0, dy: 0 }]
      return true
    }
    const paint = () => {
      const r = row!
      const x = swipeShown(s!.dx, acts)
      if (r.dataset.rowSwipe === undefined) (r.dataset.rowSwipe = ''), (r.style.transition = 'none'), (r.style.transform = 'translateX(var(--swipe))')
      r.style.setProperty('--swipe', `${x}px`)
      const side: SwipeAct | undefined = x < 0 ? (s!.dx <= -SWIPE_ARM2 && acts.left2 ? 'left2' : acts.left ? 'left' : 'left2') : x > 0 ? 'right' : undefined
      if (!side || !box) return strip?.style.setProperty('visibility', 'hidden')
      const armed = swipeAct(s!, acts) === side
      if (!strip) {
        strip = document.createElement('div')
        strip.setAttribute('aria-hidden', 'true')
        Object.assign(strip.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, display: 'flex', alignItems: 'center', padding: '0 var(--sp-4)', boxSizing: 'border-box', fontSize: 'var(--fs-2)', fontWeight: '600', color: 'var(--fg)', borderRadius: 'var(--r-m)', pointerEvents: 'none', zIndex: 'var(--z-pop)' })
        document.body.append(strip)
      }
      const w = Math.abs(x)
      Object.assign(strip.style, { visibility: 'visible', justifyContent: x < 0 ? 'flex-end' : 'flex-start', clipPath: x < 0 ? `inset(0 0 0 ${box.width - w}px)` : `inset(0 ${box.width - w}px 0 0)`, background: `color-mix(in srgb, ${COLOR[side]} ${armed ? 34 : 12}%, transparent)`, opacity: armed ? '1' : '0.7' })
      strip.textContent = SWIPE_SAYS[side]
    }
    const end = (run: boolean) => {
      clearTimeout(idle)
      const a = run && s ? swipeAct(s, acts, dragging()) : undefined
      const r = row
      const act = a && acts[a]
      ate = pid !== undefined && s?.lock === 'x'
      ;[s, row, pid, box] = [null, null, undefined, undefined]
      strip?.remove()
      strip = null
      if (r) {
        r.style.transition = still() ? 'none' : 'transform var(--t-spring-soft) var(--spring-soft)' // it springs back
        r.style.setProperty('--swipe', '0px')
        delete r.dataset.rowSwipe
        setTimeout(() => r.dataset.rowSwipe === undefined && ['transform', 'transition', '--swipe'].forEach(p => r.style.removeProperty(p)), 400)
      }
      act?.()
    }
    const wheel = (e: WheelEvent) => {
      if (html.dataset.motion === 'none') return
      if (!s) {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return void (vAt = e.timeStamp) // up or down: the list's scroll
        if (e.timeStamp - vAt < 300 || !begin(e.target)) return // a scroll under way never becomes a swipe
      }
      s = swipeMove(s!, -e.deltaX, -e.deltaY) // the row follows the fingers
      if (s.lock === 'y' || dragging()) return end(false)
      paint()
      clearTimeout(idle)
      idle = setTimeout(() => end(true), SWIPE_IDLE)
    }
    const down = (e: PointerEvent) => void (e.pointerType !== 'mouse' && !s && html.dataset.motion !== 'none' && begin(e.target) && ((pid = e.pointerId), (at = { x: e.clientX, y: e.clientY })))
    const move = (e: PointerEvent) => {
      if (!s || e.pointerId !== pid) return
      s = swipeMove({ dx: 0, dy: 0, lock: s.lock }, e.clientX - at.x, e.clientY - at.y)
      if (s.lock === 'y' || dragging()) return end(false)
      if (s.lock === 'x') paint()
    }
    const up = (e: PointerEvent) => void (s && e.pointerId === pid && end(e.type === 'pointerup'))
    const click = (e: MouseEvent) => void (ate && ((ate = false), e.stopPropagation(), e.preventDefault()))
    list.addEventListener('click', click, true)
    list.addEventListener('wheel', wheel, { passive: true })
    list.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', up, { passive: true })
    return () => {
      end(false)
      list.removeEventListener('click', click, true)
      list.removeEventListener('wheel', wheel)
      list.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [ref, on])
}
