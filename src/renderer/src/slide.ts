// The selection slides (styles.css .slid): in the Terminal | Reader switch and the side panel's tabs (a segmented .seg
// group's pick is a fill of its own, standing still) the picked item's fill or underline is the group's ::before, moved under the new pick with the spring when it
// changes. One MutationObserver for the window (class and aria changes on a group's items, read only there); a group
// is drawn so only from its first change on, starting where the old pick was, so nothing slides as a page first draws
// or as a group's items come. An item come or gone, a change of its size (Density, the zoom) or the window's puts them back without moving. Motion: Off / Reduce motion: styles.css' catch-all
const GROUP = '.reader-switch, .sp-tabs'
const PICKED = ':scope > :is(.on, [aria-checked="true"], [aria-pressed="true"], [aria-selected="true"])'

function place(g: HTMLElement, el: Element | null | undefined, still: boolean) {
  if (!el) return g.classList.remove('slid')
  const a = g.getBoundingClientRect()
  const b = el.getBoundingClientRect()
  if (still) g.setAttribute('data-still', '')
  g.style.setProperty('--ind-x', `${b.left - a.left - g.clientLeft + g.scrollLeft}px`)
  g.style.setProperty('--ind-y', `${b.top - a.top - g.clientTop + g.scrollTop}px`)
  g.style.setProperty('--ind-w', `${b.width}px`)
  g.style.setProperty('--ind-h', `${b.height}px`)
  if (still) void g.offsetWidth, g.removeAttribute('data-still') // drawn there at once, then free to move
}

// a look that fills the pick its own way (looks.css: Frosted's accent, a gradient): its fill is the mark,
// an underline sliding over it would be a second one, so that group doesn't slide. Read as the look ends it: the
// transition skipped, else the new pick reads as it was a frame ago. The default's pick has none (an underline). ponytail:
// a sibling not under the mouse as the look's plain button (one under it may show its hover)
const bg = (e: HTMLElement) => {
  const t = e.style.transition
  e.style.transition = 'none'
  const cs = getComputedStyle(e)
  const v = { color: cs.backgroundColor, image: cs.backgroundImage }
  e.style.transition = t
  return { ...v, none: v.image === 'none' && (v.color === 'transparent' || /[,/]\s*0\)$/.test(v.color)), key: `${v.color} ${v.image}` }
}
function filled(g: HTMLElement, pick: Element | null) {
  if (!(pick instanceof HTMLElement) || g.matches('.reader-switch')) return false // the Reader switch's slide is a fill itself
  const plain = [...g.children].find((c): c is HTMLElement => c !== pick && c instanceof HTMLElement && c.tagName === pick.tagName && !c.matches(':hover'))
  const p = bg(pick)
  return !p.none && (!plain || bg(plain).key !== p.key) // a fill of its own, not the one every button has
}

export function slideStart() {
  // a group's size changed (an item came or went, Density, the zoom): its fill put back under the pick, without moving
  const again = (g: HTMLElement) => g.isConnected && g.classList.contains('slid') && place(g, g.querySelector(PICKED), true)
  const sizes = new WeakMap<Element, string>() // its first report is its size as observed: not a change (the first slide plays)
  const ro = new ResizeObserver(es =>
    es.forEach(e => {
      const was = sizes.get(e.target)
      sizes.set(e.target, `${e.contentRect.width}x${e.contentRect.height}`)
      if (was !== undefined && was !== sizes.get(e.target)) again(e.target as HTMLElement)
    }),
  )
  const items = new MutationObserver(ms => new Set(ms.map(m => m.target as HTMLElement)).forEach(again)) // an item came or went: the others moved
  new MutationObserver(ms => {
    const seen = new Set<HTMLElement>()
    for (const m of ms) {
      const g = (m.target as Element).parentElement
      if (!g?.matches(GROUP) || seen.has(g)) continue
      seen.add(g)
      if (filled(g, g.querySelector(PICKED))) {
        g.classList.remove('slid') // a look that fills it (one switched to as it showed, too)
        continue
      }
      if (!g.classList.contains('slid')) {
        // its first change: from the one that was picked (its old attribute said so)
        const was = ms.find(x => x.target.parentElement === g && /(^|\s)on(\s|$)|true/.test(x.oldValue ?? '') && !(x.target as Element).matches(PICKED.replace(':scope > ', '')))
        if (!was) continue
        place(g, was.target as Element, true)
        g.classList.add('slid')
        ro.observe(g) // ponytail: never unobserved; a group gone is dropped with its element
        items.observe(g, { childList: true })
      }
      place(g, g.querySelector(PICKED), false) // after React's commit already: the new pick is there
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-checked', 'aria-pressed', 'aria-selected'] })
  addEventListener('resize', () => document.querySelectorAll<HTMLElement>('.slid').forEach(again)) // an item's width with the group's the same
}
