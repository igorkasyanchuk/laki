// The floating bubbles (floater.html, small windows main keeps over every app while Laki isn't in front). #bar: a drop
// on the screen's edge with a circle per workspace whose agent works (floater.css: a glow, a gradient, an arc,
// bricks, a comet, a wave or still, Settings' pick), waits for you (a pulse), or was used last (dimmer), its initials inside; a click opens its tab
// in Laki, a right click marks a done one seen (as a look would), a hover asks main for its card, a drag (from anywhere on it, past 4px) moves it and main sticks it to the
// edge nearest where it's let go (top or bottom: a row, body[data-side]). Under the circles, a + (Settings' switch) whose click shows ACTS: stacked in the drop
// over it (floaterMenu stack, a hover's name in the card's window) or #menu, a window beside it (card). #card: that card
// (name, project, what the agent asked or last said) in a window of its own beside the drop, so the drop never moves
// under the mouse. #voice: Say it's prompt, dictated (macOS's), sent to an agent of the list or a new session.
// The bar opens the other three (window.open): one renderer process for all four.
import './floater.css'
import { alwaysOf, permVerb } from '../../shared/ask'
import { dotsText, plainLines, replyOf, tookText } from '../../shared/island'
import type { Ask } from '../../shared/types'
import { initials } from './text'

// branch, agents, pr, lines: the card's more, as the sidebar's hover card has them; agent, at, ask, answer, took: the
// island's cards and the reply window's (its agent, since when it needs you, its menu, its last answer, its turn's time)
export type Float = { tab: string; name: string; project: string; status: 'running' | 'waiting' | 'idle' | 'done'; color?: string; last?: string; perm?: { tool: string; what: string }; branch?: string; agents?: string; pr?: { state: string; text: string; meta: string }; lines?: string[]; agent?: string; at?: number; ask?: Ask; answer?: string; took?: number }
type Colors = Record<string, string>
type Floats = { items: Float[]; colors: Colors; style?: string; add?: boolean; menu?: 'stack' | 'card'; doneAlert?: boolean; ai?: boolean; at?: 'edge' | 'notch' }
type IslandCard = { f?: Float; i?: number; n?: number; list?: Float[] }
// the +'s actions, the menu bar's too: what, its name, what it does; Ask Laki AI while it's on (Settings › AI), last:
// the others keep their keys
const ACTS = [
  ['new', 'New task', 'an agent in a worktree'],
  ['mic', 'Say it', 'dictate a prompt'],
  ['area', 'Screenshot area', 'drag over what to show'],
  ['screen', 'Whole screen', "the screen you're on"],
  ['ai', 'Ask Laki AI', 'it starts and steers agents'],
] as const
type Act = (typeof ACTS)[number][0]
const actsFor = (f: Floats | null) => ACTS.filter(([act]) => act !== 'ai' || f?.ai)
type Bridge = {
  dictate?: () => void
  floater?: {
    onFloats: (cb: (f: Floats) => void) => void
    onSide: (cb: (side: 'left' | 'right' | 'top' | 'bottom' | 'notch') => void) => void
    drag: (phase: 'start' | 'move' | 'end', dx?: number, dy?: number) => void
    size: (len: number, up?: boolean) => void
    hover: (tab: string, top: number) => void
    open: (tab: string, panel?: 'changes') => void
    seen: (tab: string) => void
    act: (what: Act) => void
    tip: (name: string, hint: string, top: number) => void
    menuAt: (top: number) => void
    menuClose: () => void
    onMenu: (cb: (open: boolean) => void) => void
    onVoiceOpen: (cb: () => void) => void
    onCard: (cb: (f: Float, colors: Colors) => void) => void
    cardSize: (tab: string, w: number, h: number) => void
    onVoice: (cb: (items: Float[], colors: Colors, to: string, reply?: Float) => void) => void
    voiceSend: (tab: string, text: string) => Promise<{ error?: string; queued?: boolean }>
    voiceClose: () => void
    menuTab: (tab: string) => void
    reply: (tab: string) => void
    answer: (tab: string, n: number, label: string) => Promise<{ error?: string }>
    onIsland: (cb: (c: IslandCard, colors: Colors) => void) => void
    islandSize: (h: number) => void
    islandEv: (ev: string) => void
  }
}

const laki = (window as unknown as { laki?: Bridge }).laki
const bridge = laki?.floater
const bar = document.getElementById('bar')!
const card = document.getElementById('card')!
const mode = /^#(card|voice|menu)$/.exec(location.hash)?.[1] ?? 'bar'
const page = (hash: string) => window.open(`${location.href.split('#')[0]}#${hash}`) // main allows #card, #menu and #voice
// on the top or bottom edge the drop is a row: a circle's place and its length are across it, not down
const across = () => document.body.dataset.side === 'top' || document.body.dataset.side === 'bottom'
const along = (e: Element) => (r => (across() ? r.left : r.top))(e.getBoundingClientRect())

const paint = (colors: Colors) => {
  for (const [k, v] of Object.entries(colors)) if (/^[a-z]+$/.test(k) && typeof v === 'string') document.documentElement.style.setProperty(`--${k}`, v)
}
const WORDS: Record<Float['status'], string> = { running: 'working', waiting: 'waiting for you', idle: 'idle', done: 'finished' }
let hovered = '' // the tab whose card shows
const hover = (tab: string, top = 0) => ((hovered = tab), bridge?.hover(tab, top))
const el = (tag: string, text: string, cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls })
// the buttons' line icons (constants: safe as markup)
const svg = (d: string, box = 24) => `<svg viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${box === 24 ? 2 : 1.5}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS: Record<Act | 'plus', string> = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  new: svg('<path d="M7 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9"/><path d="M11.5 2.5l2 2L8 10H6V8z"/>', 16),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  ai: svg('<path d="M6.5 2.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3L2 7l3.3-1.2zM12 9.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/>', 16),
  area: svg('<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/>', 16),
  screen: svg('<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4M8 11v3"/>', 16),
}
const button = (act: Act | 'plus', name: string) => {
  const b = Object.assign(document.createElement('div'), { className: 'fl-btn', innerHTML: ICONS[act] })
  b.setAttribute('aria-label', name)
  b.dataset.act = act
  return b
}

document.body.dataset.mode = mode
let hinted = false // the reply hint on a finished one's card: once per session
if (mode === 'card') {
  islandPage()
  bridge?.onCard((f, colors) => {
    paint(colors)
    card.classList.toggle('tip', (f.status as string) === 'tip') // a stacked action's name
    if ((f.status as string) === 'tip') return card.replaceChildren(el('b', f.name), el('div', f.last ?? '', 'meta')), bridge.cardSize(f.tab, card.offsetWidth, card.offsetHeight)
    card.style.setProperty('--c', `var(--${f.status})`)
    const meta = el('div', '', 'meta')
    meta.append(el('i', WORDS[f.status] ?? f.status), ` · ${f.project} · click to open${f.status === 'done' ? ' · right click: seen' : ''}`)
    const pr = f.pr && el('div', '', 'pr')
    if (pr && f.pr) pr.append(el('span', f.pr.state, `st ${/^[a-z]+$/.test(f.pr.state) ? f.pr.state : ''}`), el('span', f.pr.text, 'title'), ...(f.pr.meta ? [el('div', f.pr.meta, 'sub')] : []))
    card.replaceChildren(
      el('b', f.name),
      ...(f.perm ? [((p: HTMLElement) => (p.append(el('b', f.perm!.tool), ' · ', el('span', f.perm!.what, 'mono')), p))(el('div', '', 'perm'))] : []), // claude's permission ask: the tool and what it touches
      meta,
      ...[f.branch, f.agents].flatMap(x => (x ? [el('div', x, 'row')] : [])),
      ...(f.last ? [el('div', f.last, 'last')] : []),
      ...(pr ? [pr] : []),
      ...(f.lines ?? []).map(x => el('div', x, 'row')),
      ...(f.status === 'done' && !hinted ? [el('div', 'Right-click or ⌥-click to reply', 'hint')] : []),
    )
    if (f.status === 'done') hinted = true
    bridge.cardSize(f.tab, card.offsetWidth, card.offsetHeight)
  })
} else if (mode === 'voice') voicePage()
else if (mode === 'menu') menuPage()
else {
  page('card')
  // a drag from anywhere on the drop (a circle too: less than 4px is its click); main moves the window, the pointer's
  // screen position stays true while it does
  let drag: { x: number; y: number; moved: boolean; tab?: string; act?: string; wasOpen?: boolean } | null = null
  let cur: Floats | null = null // the last list, drawn again as the + opens or closes
  let stack = false // the + open, its actions stacked over it (floaterMenu stack)
  let menuOpen = false // its menu beside the drop (card), and when that last closed: a press on the + takes its focus,
  let menuShut = 0 // which closes it before the click would open it again
  let tipped = '' // the stacked action whose name shows
  let quiet = 0 // until then no name shows: the stack just opened, and put an action under a pointer that didn't move
  // the circle or button under the mouse: a class set as the mouse really moves, not :hover (or pointerover), which
  // Chromium sets again at the last place the mouse was (the + just clicked) as the bar comes back after Laki was in
  // front: hidden, the page hears nothing (no visibilitychange for a hidden panel)
  const hot = (x?: Element | null) => {
    const was = bar.querySelector('.hot')
    if (was !== x) was?.classList.remove('hot'), x?.classList.add('hot')
  }
  // a click that brings Laki in front: nothing lights (a twitch of the hand before the bar hides) until the mouse comes
  // in again
  let away = false
  bar.onpointerenter = () => (away = false)
  bar.onpointerleave = () => hot()
  const notch = () => document.body.dataset.at === 'notch'
  bar.onpointerdown = e => {
    if (e.button !== 0 || notch()) return
    bar.setPointerCapture(e.pointerId)
    const at = e.target as HTMLElement
    drag = { x: e.screenX, y: e.screenY, moved: false, tab: at.closest<HTMLElement>('.fl-dot')?.dataset.tab, act: at.closest<HTMLElement>('.fl-btn')?.dataset.act, wasOpen: menuOpen || Date.now() - menuShut < 400 }
  }
  bar.onpointermove = e => {
    if (!drag) return void (away || hot((e.target as HTMLElement).closest('.fl-dot, .fl-btn')))
    const [dx, dy] = [e.screenX - drag.x, e.screenY - drag.y]
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) (drag.moved = true), document.body.classList.add('dragging'), (hovered = ''), hot(), bridge?.drag('start')
    bridge?.drag('move', dx, dy)
  }
  const done = (click: boolean) => {
    const d = drag
    drag = null
    if (click && !d?.moved && (d?.tab || d?.act === 'new' || d?.act === 'ai' || d?.act === 'area' || d?.act === 'screen')) (away = true), hot() // the bar hides, or a window comes over it: not lit as it comes back
    if (d?.moved) document.body.classList.remove('dragging'), bridge?.drag('end')
    else if (click && d?.tab && alt) hover(''), bridge?.reply(d.tab) // ⌥-click: a reply to it, Laki stays where it is
    else if (click && d?.tab) hover(''), bridge?.open(d.tab)
    else if (click && d?.act === 'plus') plus(!!d.wasOpen)
    else if (click && d?.act) {
      hover('')
      if (stack) (stack = false), render(true)
      if (d.act === 'mic') page('voice')
      else bridge?.act(d.act as Act)
    }
  }
  const plusAt = () => (p => (p ? along(p) : 0))(bar.querySelector('[data-act="plus"]'))
  const plus = (wasOpen: boolean) => {
    hover('')
    if (cur?.menu !== 'card') return void ((stack = !stack), (quiet = Date.now() + 400), render(true, stack))
    if (wasOpen) return bridge?.menuClose()
    bridge?.menuAt(plusAt())
    page('menu')
  }
  // the menu beside the drop opened or closed; closed also as main hides the bar: the stack shuts too
  bridge?.onMenu(open => {
    if (!open && menuOpen) menuShut = Date.now() // a menu that was open: not the hide's signal alone
    menuOpen = open
    if (!open && stack) (stack = false), render(true)
    bar.querySelector('[data-act="plus"]')?.classList.toggle('on', open)
  })
  bridge?.onVoiceOpen(() => page('voice'))
  let alt = false // the click's ⌥ (pointerup's)
  bar.onpointerup = e => ((alt = e.altKey), done(true))
  // a circle's right click: main's menu (Reply…, Open tab, and Seen for a finished one: done turns idle, no longer lit)
  bar.oncontextmenu = e => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.fl-dot')?.dataset.tab
    if (tab && !notch()) e.preventDefault(), hover(''), bridge?.menuTab(tab)
  }
  // the island's pill: a hover (or a click) shows the sessions, unless a card does
  bar.addEventListener('pointerenter', () => notch() && bridge?.islandEv('pill'))
  bar.addEventListener('pointerleave', () => notch() && bridge?.islandEv('leave'))
  bar.addEventListener('click', () => notch() && bridge?.islandEv('pill'))
  bar.onpointercancel = () => done(false)
  // hidden (Laki in front): the circle under the mouse then isn't under it as it comes back
  document.addEventListener('visibilitychange', () => document.hidden && (hovered = ''))
  const length = () => (across() ? bar.offsetWidth : bar.offsetHeight)
  bridge?.onSide(side => {
    if (side === 'notch') return
    const turned = across() !== (side === 'top' || side === 'bottom')
    document.body.dataset.side = side
    if (turned && cur) bridge.size(length()) // a row now (or a column again): its own length
  })
  bridge?.onFloats(f => {
    cur = f
    const shut = stack && (!f.add || f.menu === 'card') // closed by Settings: shrinks upward, as the + would
    if (shut) stack = false
    render(shut)
  })
  // up: the + opened or closed, the drop grows or shrinks upward, leftward in a row (main); pop: its actions come in
  function render(up = false, pop = false) {
    if (!cur) return
    tipped = '' // its buttons are made anew: a move names one again
    const { items, colors, style, add, doneAlert } = cur
    paint(colors)
    document.body.dataset.at = cur.at ?? 'edge'
    if (cur.at === 'notch') return pillRender(items)
    bar.querySelectorAll('.isl').forEach(x => x.remove())
    document.body.dataset.fstyle = style || 'glow'
    document.body.dataset.done = doneAlert === false ? '' : 'on' // a finished one you haven't seen: green, pulsing
    const was = bar.querySelector<HTMLElement>('.hot')?.dataset // lit again below, made anew
    bar.querySelectorAll('.fl-dot, .fl-btns').forEach(d => d.remove())
    // each circle's animations at a phase of its own (not all in step), by the clock: one made anew (each update) goes
    // on where it was, as a negative delay into its loop
    const phase = (tab: string) => `-${(((Date.now() + [...tab].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 9973) / 1000) % 3600).toFixed(3)}s`
    const labels = initials(items.map(f => f.name))
    for (const [i, f] of items.entries()) {
      const d = document.createElement('div')
      d.className = `fl-dot ${WORDS[f.status] ? f.status : 'running'}`
      d.textContent = labels[i]
      d.dataset.tab = f.tab
      d.style.setProperty('--fl-d', phase(f.tab))
      if (f.color && /^[a-z]+$/.test(f.color)) d.style.setProperty('--ink', `var(--tc${f.color})`)
      d.onmouseenter = () => !drag?.moved && hover(f.tab, along(d))
      d.onmouseleave = () => !drag?.moved && hover('')
      bar.append(d)
    }
    if (add) {
      const btns = el('div', '', 'fl-btns')
      // a stacked action's name beside it, once the pointer really moves over it (not mouseenter: the drop growing
      // under a still pointer puts the top one there)
      const tip = (b: HTMLElement, name: string, hint: string) => {
        b.onpointermove = () => drag || tipped === name || Date.now() < quiet || ((tipped = name), (hovered = ''), bridge?.tip(name, hint, along(b)))
        b.onmouseleave = () => !drag?.moved && ((tipped = ''), hover(''))
      }
      if (stack) {
        const acts = el('div', '', `fl-acts${pop ? ' pop' : ''}`)
        for (const [act, name, hint] of actsFor(cur)) {
          const b = button(act, name)
          tip(b, name, hint)
          acts.append(b)
        }
        btns.append(acts)
      }
      const p = button('plus', stack || menuOpen ? 'Close' : 'New')
      p.classList.toggle('on', stack || menuOpen)
      btns.append(p)
      bar.append(btns)
    }
    hot(was && [...bar.querySelectorAll<HTMLElement>('.fl-dot, .fl-btn')].find(x => (was.tab ?? was.act) === (x.dataset.tab ?? x.dataset.act)))
    // a card open across an update: its new text, beside where its circle is now (gone: it shuts)
    const still = hovered && [...bar.querySelectorAll<HTMLElement>('.fl-dot')].find(d => d.dataset.tab === hovered)
    if (still) hover(hovered, along(still))
    else if (hovered) hover('')
    bridge?.size(length(), up)
  }
}

// the island's pill at rest: a thin bar per agent in its color (waiting: pulsing; done: green) on the left, how many need
// you on the right (main sizes and places it; nothing to drag)
function pillRender(items: Float[]) {
  bar.querySelectorAll('.fl-dot, .fl-btns, .isl').forEach(d => d.remove())
  const bars = el('div', '', 'isl isl-bars')
  for (const f of items.slice(0, 8)) {
    const b = el('i', '', `isl-b ${f.status}`)
    if (f.color && /^[a-z]+$/.test(f.color)) b.style.setProperty('--ink', `var(--tc${f.color})`)
    bars.append(b)
  }
  const need = items.filter(f => f.status === 'waiting' || f.status === 'done').length
  const count = el('div', need ? String(need) : '', `isl isl-n${items.some(f => f.status === 'waiting') ? ' waiting' : ''}`)
  bar.append(bars, el('div', '', 'isl isl-gap'), count)
}

// the island's card window: an agent's ask (its menu as buttons, 1-9; a permission's tool and command), a finished one
// (its first lines, its time, a reply box, Review, Open), or the session list (a row's body opens its tab, its chevron
// shows its last answer). Its height goes to main, which places it under the pill; the pointer and Esc decide when it
// folds (main: shared/island.ts lifeStep)
function islandPage() {
  const box = document.getElementById('island')!
  let shown: IslandCard | null = null
  const fit = () => requestAnimationFrame(() => bridge?.islandSize(box.offsetHeight))
  box.onpointerenter = () => (bridge?.islandEv('enter'), bridge?.islandEv('focus'))
  box.onpointerleave = () => bridge?.islandEv('leave')
  document.addEventListener('keydown', e => {
    if (!shown || e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'TEXTAREA') return void (e.key === 'Escape' && (e.target as HTMLElement).tagName === 'TEXTAREA' && bridge?.islandEv('esc'))
    if (e.key === 'Escape') bridge?.islandEv('esc')
    else if (e.key === 'ArrowRight') bridge?.islandEv('next')
    else if (e.key === 'ArrowLeft') bridge?.islandEv('prev')
    else if (/^[1-9]$/.test(e.key) && shown.f?.ask) box.querySelector<HTMLButtonElement>(`[data-n="${e.key}"]`)?.click()
  })
  const head = (f: Float, right: string) => {
    const h = el('div', '', 'i-head')
    const dot = el('i', '', `i-dot ${f.status}`)
    if (f.color && /^[a-z]+$/.test(f.color)) dot.style.setProperty('--ink', `var(--tc${f.color})`)
    h.append(dot, el('b', f.agent ?? 'agent'), el('span', ` · ${f.name}`, 'i-ws'), el('span', right, 'i-right'))
    return h
  }
  const btn = (text: string, cls: string, on: () => void) => Object.assign(el('button', text, cls) as HTMLButtonElement, { onclick: on })
  const say = (to: HTMLElement, text: string) => ((to.textContent = text), to.classList.add('bad'), fit())
  bridge?.onIsland((c, colors) => {
    paint(colors)
    shown = c
    if (c.list) {
      // the sessions: a row's body opens its tab, its chevron (its end, the same pixel always) shows its last answer
      box.replaceChildren(
        el('div', 'Sessions', 'i-title'),
        ...c.list.map(f => {
          const row = el('div', '', 'i-row')
          const main = el('div', '', 'i-main')
          main.append(head(f, WORDS[f.status] ?? f.status))
          main.onclick = () => bridge?.open(f.tab)
          const more = el('div', plainLines(f.answer, 3).join('\n'), 'i-more')
          more.hidden = true
          const chev = btn('›', 'i-chev', () => ((more.hidden = !more.hidden), chev.classList.toggle('on', !more.hidden), fit()))
          chev.disabled = !f.answer
          row.append(main, chev, more)
          return row
        }),
      )
      return fit()
    }
    const f = c.f!
    const dots = el('span', dotsText(c.i ?? 0, c.n ?? 1), 'i-dots')
    dots.onclick = () => bridge?.islandEv('next')
    const note = el('div', '', 'i-note')
    const parts: HTMLElement[] = []
    if (f.status === 'waiting') {
      parts.push(head(f, 'asks'))
      const a = f.ask
      if (a?.tool) parts.push(el('div', permVerb(a.tool), 'i-q'), el('pre', a.what ?? '', 'i-what'), el('div', `${a.tool} · ${f.project} / ${f.name}`, 'i-sub'))
      else if (a?.question || f.last) parts.push(el('div', a?.question ?? f.last ?? '', 'i-q'))
      const opts = el('div', '', 'i-opts')
      const always = a?.rule ? alwaysOf(a) : undefined
      for (const o of a?.options ?? []) {
        const b = btn(`${o.n}  ${o === always ? `Always: ${a!.rule}` : o.label}`, `i-opt${o.n === a!.options[0].n ? ' primary' : ''}`, async () => {
          const r = await bridge?.answer(f.tab, o.n, o.label)
          if (r?.error) say(note, r.error)
        })
        b.dataset.n = String(o.n)
        opts.append(b)
      }
      parts.push(opts)
      if (!a?.options.length) parts.push(el('div', 'Its question is in its tab', 'i-sub'))
    } else {
      parts.push(head(f, f.took ? `done in ${tookText(f.took)}` : 'done'))
      parts.push(el('div', plainLines(f.answer, 2).join('\n') || 'Finished', 'i-answer'))
      parts.push(replyBox(f, note, fit))
    }
    const foot = el('div', '', 'i-foot')
    foot.append(...(f.status === 'done' ? [btn('Review changes', '', () => bridge?.open(f.tab, 'changes'))] : []), btn('Open tab', '', () => bridge?.open(f.tab)), dots)
    box.replaceChildren(...parts, note, foot)
    fit()
  })
}
// a reply box: ⏎ sends to the agent (send, queued while it works), ⇧⏎ a new line; a menu it shows: its options only
function replyBox(f: Float, note: HTMLElement, fit: () => void) {
  const wrap = el('div', '', 'i-reply')
  const text = Object.assign(document.createElement('textarea'), { rows: 1, placeholder: `Reply to ${f.agent ?? 'it'}…`, spellcheck: false })
  const go = async () => {
    if (!text.value.trim()) return
    if (replyOf(f) === 'options') return void ((note.textContent = 'Pick an option, or Open the tab'), note.classList.add('bad'), fit())
    const r = await bridge?.voiceSend(f.tab, text.value)
    if (r?.error) (note.textContent = r.error), note.classList.add('bad'), fit()
    else if (r?.queued) (note.textContent = 'Queued: it gets it when its turn ends'), note.classList.remove('bad'), (text.value = ''), fit()
  }
  text.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault(), go()
  }
  text.oninput = () => ((text.style.height = 'auto'), (text.style.height = `${Math.min(text.scrollHeight, 96)}px`), fit())
  wrap.append(text, Object.assign(el('button', '↑', 'i-send'), { onclick: go, title: 'Send (⏎)' }))
  return wrap
}

// the +'s menu beside the drop (floaterMenu card): a row per action with its name, what it does and its key (1-5);
// arrows move, ⏎ picks, Esc or a click elsewhere closes it (main: on blur). Its rows come with the floats (Ask Laki AI)
function menuPage() {
  const box = document.getElementById('menu')!
  let rows: HTMLButtonElement[] = []
  const draw = (f: Floats) =>
    (rows = actsFor(f).map(([act, name, hint], i) => {
      const b = Object.assign(document.createElement('button'), { className: 'm-row' })
      b.onclick = () => bridge?.act(act)
      b.setAttribute('role', 'menuitem')
      const ic = el('span', '', 'm-ic')
      ic.innerHTML = ICONS[act]
      const txt = el('span', '', 'm-txt')
      txt.append(el('span', name, 'm-t'), el('span', hint, 'm-h'))
      b.append(ic, txt, el('span', String(i + 1), 'm-k'))
      b.onmousemove = () => document.activeElement !== b && b.focus() // moved onto, not a pointer resting where it opened
      return b
    }))
  document.onkeydown = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return // ⌘1 and the like aren't its keys
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') bridge?.menuClose()
    else if (/^[1-9]$/.test(e.key)) rows[Number(e.key) - 1]?.click()
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault(), rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1) + rows.length) % rows.length]?.focus()
  }
  bridge?.onFloats(f => {
    paint(f.colors)
    const focus = rows.length ? rows.indexOf(document.activeElement as HTMLButtonElement) : 0
    box.replaceChildren(...draw(f))
    rows[Math.max(0, focus)]?.focus()
  })
}

// Say it's window: a text box dictation starts in (macOS's, as the app's prompt mic: 150 ms after the focus, once
// macOS knows the field), who gets it (Settings' It goes to: picked each time from the bubbles' agents or a new
// session, nothing chosen first; or always a new session, no list), ⏎ sends, Esc shuts
const PICK = '-' // the voice window's 'pick who gets it' row: not a tab
function voicePage() {
  const box = document.getElementById('voice')!
  const text = box.querySelector('textarea')!
  const to = box.querySelector('select')!
  const note = box.querySelector<HTMLElement>('.v-note')!
  const send = box.querySelector<HTMLButtonElement>('.v-send')!
  let hint = note.textContent // the mode's own, back once an error is dealt with
  const calm = () => note.classList.contains('bad') && ((note.textContent = hint), note.classList.remove('bad'))
  const dictate = () => (text.focus(), setTimeout(() => laki?.dictate?.(), 150))
  box.querySelector<HTMLElement>('.v-mic')!.innerHTML = ICONS.mic
  box.querySelector<HTMLElement>('.v-mic')!.onclick = dictate
  box.querySelector<HTMLElement>('.v-x')!.onclick = () => bridge?.voiceClose()
  const title = box.querySelector<HTMLElement>('.v-head b')!
  const lastBox = box.querySelector<HTMLElement>('.v-last')!
  const opts = box.querySelector<HTMLElement>('.v-opts')!
  let reply: Float | undefined // a circle's Reply…: the one agent it goes to
  const go = async () => {
    if (!text.value.trim() || send.disabled) return
    // an agent in a menu: typed keys would pick one of its options
    if (reply && replyOf(reply) === 'options') return void ((note.textContent = 'Pick an option, or Open the tab'), note.classList.add('bad'))
    if (!reply && to.value === PICK) return void ((note.textContent = 'Pick who gets it first'), note.classList.add('bad'), to.focus())
    send.disabled = true
    const r = await bridge?.voiceSend(reply ? reply.tab : to.value, text.value)
    send.disabled = false
    if (r?.error) (note.textContent = r.error), note.classList.add('bad') // its text kept
    else if (r?.queued) (note.textContent = 'Queued: it gets it when its turn ends'), note.classList.remove('bad'), setTimeout(() => bridge?.voiceClose(), 1200)
  }
  send.onclick = go
  text.oninput = calm
  text.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault(), go()
  }
  // Esc shuts it; with words in it, a second Esc (the first may be meant for dictation)
  let esc = false
  document.onkeydown = e => {
    if (e.key !== 'Escape') return void (esc && ((esc = false), (note.textContent = hint))) // re-armed: the mode's note again
    if (!text.value.trim() || esc) return bridge?.voiceClose()
    esc = true
    note.textContent = 'Esc again to throw it away'
    note.classList.remove('bad')
  }
  to.onchange = () => to.value !== PICK && calm()
  bridge?.onVoice((items, colors, where, to1) => {
    paint(colors)
    reply = to1
    box.classList.toggle('reply', !!reply)
    title.textContent = reply ? `Reply to ${reply.agent ?? 'it'} · ${reply.name}` : 'Say a prompt'
    lastBox.textContent = reply ? plainLines(reply.answer, 3).join('\n') : ''
    lastBox.hidden = !lastBox.textContent
    // a waiting one's menu: its options as buttons (answer, by n and label)
    opts.replaceChildren(
      ...(reply && replyOf(reply) === 'options'
        ? reply.ask!.options.map(o =>
            Object.assign(el('button', `${o.n}. ${o.label}`, 'v-opt'), {
              onclick: async () => {
                const r = await bridge?.answer(reply!.tab, o.n, o.label)
                if (r?.error) (note.textContent = r.error), note.classList.add('bad')
                else bridge?.voiceClose()
              },
            }),
          )
        : []),
    )
    opts.hidden = !opts.childElementCount
    if (reply) {
      to.hidden = true
      note.textContent = hint = replyOf(reply) === 'options' ? 'Pick an option, or Open the tab · Esc closes' : '⏎ sends · ⇧⏎ a new line · Esc closes'
      return void text.focus()
    }
    const opt = (value: string, textContent: string, o: Partial<HTMLOptionElement> = {}) => Object.assign(document.createElement('option'), { value, textContent, ...o })
    to.replaceChildren(
      ...(where === 'new' ? [] : [opt(PICK, 'Pick who gets it…', { disabled: true, selected: true })]),
      ...items.map(f => opt(f.tab, `${f.name} · ${WORDS[f.status] ?? f.status}`)),
      opt('', 'A new session…', { selected: where === 'new' }),
    )
    to.hidden = where === 'new'
    if (where === 'new') note.textContent = hint = 'For a new session · ⏎ opens it with this prompt · Esc closes'
    dictate()
  })
}
