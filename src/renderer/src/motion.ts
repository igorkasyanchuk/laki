// V7: the motion layer's parts CSS can't do alone (styles.css' V7 rules do the rest). Off under Settings › Appearance ›
// Motion: Off (html[data-motion='none']) and the system's Reduce motion.
const still = () => document.documentElement.dataset.motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches

// a sidebar row or a tab that's new since the window drew its first view: it grows in once. One that comes back as you
// switch workspaces or unfold a project was seen already (every id in the first view counts as seen)
// (born: when each new one was first drawn; it keeps its class through the renders of its animation, 400 ms)
const seen = new Set<string>()
const born = new Map<string, number>()
let settled = false
export function settle(ids: Iterable<string>) {
  if (settled) return
  for (const id of ids) seen.add(id)
  settled = true
}
export function fresh(id: string | undefined): boolean {
  if (!id || !settled || still()) return false
  const now = performance.now()
  if (!seen.has(id)) seen.add(id), born.set(id, now)
  const at = born.get(id)
  if (at === undefined) return false
  if (now - at < 400) return true
  born.delete(id)
  return false
}

// what floats (a menu, a dialog, ⌘K, a tooltip, a toast) leaves in 120 ms: React has removed it; an inert copy goes back
// where it was, plays .leaving's animation, then goes. Only these roots, all position: fixed, so the copy takes no room
// in the layout (the side panel is in the flow: it only comes in)
const LEAVES = '.menu-backdrop, .menu, .overlay, .tip, .toast'
const OUT_MS = 120
export function exits(root: Node) {
  new MutationObserver(recs => {
    if (still()) return
    for (const r of recs)
      for (const n of r.removedNodes) {
        if (!(n instanceof HTMLElement) || n.classList.contains('leaving') || !n.matches(LEAVES) || !r.target.isConnected) continue
        const g = n.cloneNode(true) as HTMLElement
        // no view-transition name in the copy: a menu item that a page grows from is named morph (ui.tsx morph) as the menu
        // goes, and a second morph in the page's new state aborts its transition (Chromium: "duplicate view-transition-name")
        for (const e of [g, ...g.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')]) e.style.viewTransitionName = ''
        g.classList.add('leaving')
        g.inert = true
        g.setAttribute('aria-hidden', 'true')
        g.removeAttribute('id')
        const at = r.nextSibling?.parentNode === r.target ? r.nextSibling : null
        r.target.insertBefore(g, at)
        setTimeout(() => g.remove(), OUT_MS + 30) // not animationend: a window in the background pauses animations
      }
  }).observe(root, { childList: true, subtree: true })
}

// another app in front (App's away, html.away): the endless animations (spinners, lines, a look's effects) stop where
// they are, one that starts meanwhile too, and go on as Laki comes back. One that ends (a row, a page, a card coming in)
// plays out: a CSS pause of every animation left it at its first frame, unseen yet there to click and type in (a filter
// closed, a page opened while the window wasn't the key one). ponytail: one paused and played here no longer follows
// CSS' animation-play-state (.sidebar[data-away]'s): it runs behind a rail page until it's drawn again
const held = new Set<Animation>()
const hold = () => {
  for (const a of document.getAnimations()) if (a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity) (a.pause(), held.add(a))
}
export function away(on: boolean) {
  document.documentElement.classList.toggle('away', on)
  if (on) return void (hold(), document.addEventListener('animationstart', hold, true))
  document.removeEventListener('animationstart', hold, true)
  for (const a of held) if (a.playState === 'paused') a.play() // one that's gone since is idle: left so
  held.clear()
}

// whether something may move now (ui.tsx Num): not under Reduce motion or Motion: Off, nor with the window away
export const moving = () => !still() && !document.documentElement.classList.contains('away')

// whether a view transition may run (ui.tsx' morph, themes.ts' paintTheme): the API there, a window that draws, not
// under Reduce motion, Motion: Off or ui-smoke. Here, not in themes.ts: its table stays out of ui.tsx' first load
export const morphOk = () => typeof document.startViewTransition === 'function' && !document.hidden && document.hasFocus() && !('smoke' in document.documentElement.dataset) && !still()
