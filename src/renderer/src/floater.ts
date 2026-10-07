// The floating bubbles (floater.html, small windows main keeps over every app while Laki isn't in front). #bar: a
// circle per workspace whose agent works (an arc going round) or waits for you (a pulse), its initials inside; a click
// opens its tab in Laki, a hover asks main for its card, the grip drags the bar. #card: that card (name, project, what
// the agent asked or last said) in a window of its own beside the bar, so the bar never moves under the mouse.
export type Float = { tab: string; name: string; project: string; status: 'running' | 'waiting'; color?: string; last?: string }
type Colors = Record<string, string>
type Bridge = {
  floater?: {
    onFloats: (cb: (f: { items: Float[]; colors: Colors }) => void) => void
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
else
  bridge?.onFloats(({ items, colors }) => {
    paint(colors)
    bar.querySelectorAll('.dot').forEach(d => d.remove())
    for (const f of items) {
      const d = document.createElement('div')
      d.className = `dot ${f.status === 'waiting' ? 'waiting' : 'running'}`
      d.textContent = initials(f.name)
      d.dataset.tab = f.tab
      if (f.color && /^[a-z]+$/.test(f.color)) d.style.setProperty('--ink', `var(--tc${f.color})`)
      d.onmouseenter = () => hover(f.tab, d.offsetTop)
      d.onmouseleave = () => hover('')
      d.onclick = () => (hover(''), bridge.open(f.tab))
      bar.append(d)
    }
    // a card open across an update: its new text, beside where its circle is now (gone: it shuts)
    const still = hovered && [...bar.querySelectorAll<HTMLElement>('.dot')].find(d => d.dataset.tab === hovered)
    if (still) hover(hovered, still.offsetTop)
    else if (hovered) hover('')
    bridge.size(bar.offsetHeight)
  })
