// Cards on screen (ask.html; what's marked important: a workspace's asks and finishes, a timer, a reminder): main's
// panel at the bottom right of the screen, a card each, the newest on top. Each: its title, its words, an Edit's or Write's diff, a button
// per choice, Open, ×; its edge's color by tone (an ask amber, a finish green, a limit red); Close all over two or more.
// Keys once it's clicked: 1-9 the top card's choices, Esc its ×.
// A laki alert's words as Markdown (links open in the browser: main's window-open handler), a line break kept as one
import { imgsAsLinks, lineBreaks, markdownHtml } from '../../shared/markdown'
type Action = { text: string }
type Card = { key: string; tab: string; ask: boolean; tone: 'ask' | 'ok' | 'bad' | 'info' | 'alert'; at: number; title: string; body: string; diff?: string; origin?: string; actions: Action[]; error?: string }
type Bridge = {
  ask: {
    onCards(cb: (cards: Card[], colors: Record<string, string>) => void): void
    size(h: number): void
    act(key: string, i: number): Promise<void>
    close(key: string): void
    closeAll(): void
    open(key: string): void
  }
}
const bridge = (window as unknown as { laki?: Bridge }).laki?.ask
const el = (tag: string, text = '', cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls })
let shown: Card[] = []
const seen = new Set<string>() // cards already drawn (key and time): only a new one slides in
const id = (c: Card) => `${c.key}@${c.at}`
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function diffEl(diff: string) {
  const pre = el('pre', '', 'diff')
  pre.append(...diff.split('\n').map(l => el('div', l || ' ', l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : l[0] === '…' ? 'm' : '')))
  return pre
}

function cardEl(c: Card) {
  const box = el('div', '', `card ${c.tone}${seen.has(id(c)) ? '' : ' new'}`)
  const x = el('button', '×', 'x')
  x.title = 'Close (Esc)'
  x.onclick = () => bridge?.close(c.key)
  const head = el('div', '', 'head')
  head.append(el('span', '', 'dot'), el('span', c.title, 'title'))
  head.title = c.title
  box.append(x)
  if (c.tone === 'alert') box.append(el('div', c.origin ?? 'message from an agent or a script', 'origin')) // S10: the daemon's words, first: it's a message, not Laki asking
  box.append(head)
  // a laki alert's words as Markdown (markdownHtml escapes every word); any other card's as written: an ask's command
  // next to its Allow must read as it runs (no * or backslash taken as formatting)
  if (c.body) box.append(c.key.startsWith('alert:') ? Object.assign(el('div', '', 'what md'), { innerHTML: imgsAsLinks(markdownHtml(lineBreaks(c.body))) }) : el('pre', c.body, 'what'))
  if (c.diff) box.append(diffEl(c.diff))
  if (c.actions.length) {
    const opts = el('div', '', 'opts')
    c.actions.forEach((a, i) => {
      const b = el('button', a.text, `opt${i || c.tone === 'alert' ? '' : ' first'}`) as HTMLButtonElement // an alert's choices are all alike
      b.title = a.text
      b.onclick = () => {
        for (const o of opts.querySelectorAll('button')) o.disabled = true
        bridge?.act(c.key, i).finally(() => opts.querySelectorAll('button').forEach(o => (o.disabled = false)))
      }
      opts.append(b)
    })
    box.append(opts)
  }
  const foot = el('div', '', 'foot')
  const waits = c.tone === 'ask'
  foot.append(el('span', c.error ?? (waits ? (c.actions.length ? 'Waiting for you' : `Waiting for you: ${c.tab ? 'its tab' : 'Laki'} has the choices`) : time(c.at)), c.error ? 'err' : ''))
  const open = el('button', c.tab ? 'Open tab' : 'Open Laki', 'open')
  open.onclick = () => bridge?.open(c.key)
  foot.append(open)
  box.append(foot)
  return box
}

bridge?.onCards((cards, colors) => {
  for (const [k, v] of Object.entries(colors ?? {})) if (/^[a-z]+$/.test(k) && typeof v === 'string') document.documentElement.style.setProperty(`--${k}`, v)
  shown = cards
  const all = el('div', '', 'all')
  const shut = el('button', `Close all ${cards.length}`, 'open')
  shut.onclick = () => bridge.closeAll()
  all.append(shut)
  document.body.replaceChildren(...(cards.length > 1 ? [all] : []), ...cards.map(cardEl))
  const now = new Set(cards.map(id))
  for (const c of now) seen.add(c)
  for (const t of seen) if (!now.has(t)) seen.delete(t)
  bridge.size(document.body.scrollHeight) // now: a hidden window gets no animation frames
})

addEventListener('keydown', e => {
  const top = shown[0]
  if (!top || !bridge) return
  if (e.key === 'Escape') return bridge.close(top.key)
  const i = Number(e.key) - 1
  if (i >= 0 && i < top.actions.length) document.querySelector('.card')?.querySelectorAll<HTMLButtonElement>('button.opt')[i]?.click()
})
