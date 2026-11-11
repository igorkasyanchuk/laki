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
