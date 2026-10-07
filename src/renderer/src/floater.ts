// The floating bubbles (floater.html, small windows main keeps over every app while Laki isn't in front). #bar: a drop
// on the screen's edge with a circle per workspace whose agent works (floater.css: a glow, a gradient, an arc or
// still, Settings' pick) or waits for you (a pulse), its initials inside; a click opens its tab in Laki, a hover asks
// main for its card, a drag (from anywhere on it, past 4px) moves it and main sticks it to the nearer edge as it's let
// go. #card: that card (name, project, what the agent asked or last said) in a window of its own beside the drop, so
// the drop never moves under the mouse.
import './floater.css'

export type Float = { tab: string; name: string; project: string; status: 'running' | 'waiting'; color?: string; last?: string }
type Colors = Record<string, string>
type Bridge = {
  floater?: {
    onFloats: (cb: (f: { items: Float[]; colors: Colors; style?: string }) => void) => void
    onSide: (cb: (side: 'left' | 'right') => void) => void
    drag: (phase: 'start' | 'move' | 'end', dx?: number, dy?: number) => void
    size: (h: number) => void
    hover: (tab: string, top: number) => void
    open: (tab: string) => void
    onCard: (cb: (f: Float, colors: Colors) => void) => void
    cardSize: (tab: string, w: number, h: number) => void
  }
}

const bridge = (window as unknown as { laki?: Bridge }).laki?.floater
const bar = document.getElementById('bar')!
const card = document.getElementById('card')!

// two letters: the first two words' (fix-cart-total: FC), else the name's first two
const initials = (name: string) => {
  const w = name.split(/[\s_./-]+/).filter(Boolean)
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? '?').slice(0, 2)).toUpperCase()
}
const paint = (colors: Colors) => {
  for (const [k, v] of Object.entries(colors)) if (/^[a-z]+$/.test(k) && typeof v === 'string') document.documentElement.style.setProperty(`--${k}`, v)
}
let hovered = '' // the tab whose card shows
const hover = (tab: string, top = 0) => ((hovered = tab), bridge?.hover(tab, top))
const el = (tag: string, text: string, cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls })

document.body.dataset.mode = location.hash === '#card' ? 'card' : 'bar'
if (location.hash === '#card')
  bridge?.onCard((f, colors) => {
    paint(colors)
    card.style.setProperty('--c', `var(--${f.status})`)
    const meta = el('div', '', 'meta')
    meta.append(el('i', f.status === 'waiting' ? 'waiting for you' : 'working'), ` · ${f.project} · click to open`)
    card.replaceChildren(el('b', f.name), meta, ...(f.last ? [el('div', f.last, 'last')] : []))
    bridge.cardSize(f.tab, card.offsetWidth, card.offsetHeight)
  })
else {
  // a drag from anywhere on the drop (a circle too: less than 4px is its click); main moves the window, the pointer's
  // screen position stays true while it does
  let drag: { x: number; y: number; moved: boolean; tab?: string } | null = null
  bar.onpointerdown = e => {
    if (e.button !== 0) return
    bar.setPointerCapture(e.pointerId)
    drag = { x: e.screenX, y: e.screenY, moved: false, tab: (e.target as HTMLElement).closest<HTMLElement>('.fl-dot')?.dataset.tab }
  }
  bar.onpointermove = e => {
    if (!drag) return
    const [dx, dy] = [e.screenX - drag.x, e.screenY - drag.y]
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) (drag.moved = true), document.body.classList.add('dragging'), (hovered = ''), bridge?.drag('start')
    bridge?.drag('move', dx, dy)
  }
  const done = (click: boolean) => {
    const d = drag
    drag = null
    if (d?.moved) document.body.classList.remove('dragging'), bridge?.drag('end')
    else if (click && d?.tab) hover(''), bridge?.open(d.tab)
  }
  bar.onpointerup = () => done(true)
  bar.onpointercancel = () => done(false)
  bridge?.onSide(side => (document.body.dataset.side = side))
  bridge?.onFloats(({ items, colors, style }) => {
    paint(colors)
    document.body.dataset.fstyle = style || 'glow'
    bar.querySelectorAll('.fl-dot').forEach(d => d.remove())
    for (const f of items) {
      const d = document.createElement('div')
      d.className = `fl-dot ${f.status === 'waiting' ? 'waiting' : 'running'}`
      d.textContent = initials(f.name)
      d.dataset.tab = f.tab
      if (f.color && /^[a-z]+$/.test(f.color)) d.style.setProperty('--ink', `var(--tc${f.color})`)
      d.onmouseenter = () => !drag?.moved && hover(f.tab, d.getBoundingClientRect().top)
      d.onmouseleave = () => !drag?.moved && hover('')
      bar.append(d)
    }
    // a card open across an update: its new text, beside where its circle is now (gone: it shuts)
    const still = hovered && [...bar.querySelectorAll<HTMLElement>('.fl-dot')].find(d => d.dataset.tab === hovered)
    if (still) hover(hovered, still.getBoundingClientRect().top)
    else if (hovered) hover('')
    bridge.size(bar.offsetHeight)
  })
}
