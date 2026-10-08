// The floating bubbles (floater.html, small windows main keeps over every app while Laki isn't in front). #bar: a drop
// on the screen's edge with a circle per workspace whose agent works (floater.css: a glow, a gradient, an arc,
// bricks, a comet, a wave or still, Settings' pick), waits for you (a pulse), or was used last (dimmer), its initials inside; a click opens its tab
// in Laki, a hover asks main for its card, a drag (from anywhere on it, past 4px) moves it and main sticks it to the
// nearer edge as it's let go. Under the circles, + Session and the microphone (Settings' switches). #card: that card
// (name, project, what the agent asked or last said) in a window of its own beside the drop, so the drop never moves
// under the mouse. #voice: the microphone's prompt, dictated (macOS's), sent to an agent of the list or a new session.
// The bar opens the other two (window.open): one renderer process for all three.
import './floater.css'
import { initials } from './text'

// branch, agents, pr, lines: the card's more, as the sidebar's hover card has them
export type Float = { tab: string; name: string; project: string; status: 'running' | 'waiting' | 'idle' | 'done'; color?: string; last?: string; branch?: string; agents?: string; pr?: { state: string; text: string; meta: string }; lines?: string[] }
type Colors = Record<string, string>
type Bridge = {
  dictate?: () => void
  floater?: {
    onFloats: (cb: (f: { items: Float[]; colors: Colors; style?: string; add?: boolean; mic?: boolean }) => void) => void
    onSide: (cb: (side: 'left' | 'right') => void) => void
    drag: (phase: 'start' | 'move' | 'end', dx?: number, dy?: number) => void
    size: (h: number) => void
    hover: (tab: string, top: number) => void
    open: (tab: string) => void
    act: (what: 'new') => void
    onCard: (cb: (f: Float, colors: Colors) => void) => void
    cardSize: (tab: string, w: number, h: number) => void
    onVoice: (cb: (items: Float[], colors: Colors, to: string) => void) => void
    voiceSend: (tab: string, text: string) => Promise<{ error?: string; queued?: boolean }>
    voiceClose: () => void
  }
}

const laki = (window as unknown as { laki?: Bridge }).laki
const bridge = laki?.floater
const bar = document.getElementById('bar')!
const card = document.getElementById('card')!
const mode = /^#(card|voice)$/.exec(location.hash)?.[1] ?? 'bar'
const page = (hash: string) => window.open(`${location.href.split('#')[0]}#${hash}`) // main allows #card and #voice

const paint = (colors: Colors) => {
  for (const [k, v] of Object.entries(colors)) if (/^[a-z]+$/.test(k) && typeof v === 'string') document.documentElement.style.setProperty(`--${k}`, v)
}
const WORDS: Record<Float['status'], string> = { running: 'working', waiting: 'waiting for you', idle: 'idle', done: 'finished' }
let hovered = '' // the tab whose card shows
const hover = (tab: string, top = 0) => ((hovered = tab), bridge?.hover(tab, top))
const el = (tag: string, text: string, cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls })
// the buttons' line icons (constants: safe as markup)
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = { new: svg('<path d="M12 5v14M5 12h14"/>'), mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>') }
const button = (act: 'new' | 'mic', tip: string) => {
  const b = Object.assign(document.createElement('div'), { className: 'fl-btn', innerHTML: ICONS[act], title: tip })
  b.dataset.act = act
  return b
}

document.body.dataset.mode = mode
if (mode === 'card')
  bridge?.onCard((f, colors) => {
    paint(colors)
    card.style.setProperty('--c', `var(--${f.status})`)
    const meta = el('div', '', 'meta')
    meta.append(el('i', WORDS[f.status] ?? f.status), ` · ${f.project} · click to open`)
    const pr = f.pr && el('div', '', 'pr')
    if (pr && f.pr) pr.append(el('span', f.pr.state, `st ${/^[a-z]+$/.test(f.pr.state) ? f.pr.state : ''}`), el('span', f.pr.text, 'title'), ...(f.pr.meta ? [el('div', f.pr.meta, 'sub')] : []))
    card.replaceChildren(
      el('b', f.name),
      meta,
      ...[f.branch, f.agents].flatMap(x => (x ? [el('div', x, 'row')] : [])),
      ...(f.last ? [el('div', f.last, 'last')] : []),
      ...(pr ? [pr] : []),
      ...(f.lines ?? []).map(x => el('div', x, 'row')),
    )
    bridge.cardSize(f.tab, card.offsetWidth, card.offsetHeight)
  })
else if (mode === 'voice') voicePage()
else {
  page('card')
  // a drag from anywhere on the drop (a circle too: less than 4px is its click); main moves the window, the pointer's
  // screen position stays true while it does
  let drag: { x: number; y: number; moved: boolean; tab?: string; act?: string } | null = null
  bar.onpointerdown = e => {
    if (e.button !== 0) return
    bar.setPointerCapture(e.pointerId)
    const at = e.target as HTMLElement
    drag = { x: e.screenX, y: e.screenY, moved: false, tab: at.closest<HTMLElement>('.fl-dot')?.dataset.tab, act: at.closest<HTMLElement>('.fl-btn')?.dataset.act }
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
    else if (click && d?.act === 'new') bridge?.act('new')
    else if (click && d?.act === 'mic') page('voice')
  }
  bar.onpointerup = () => done(true)
  bar.onpointercancel = () => done(false)
  // hidden (Laki in front): the circle under the mouse then isn't under it as it comes back
  document.addEventListener('visibilitychange', () => document.hidden && (hovered = ''))
  bridge?.onSide(side => (document.body.dataset.side = side))
  bridge?.onFloats(({ items, colors, style, add, mic }) => {
    paint(colors)
    document.body.dataset.fstyle = style || 'glow'
    bar.querySelectorAll('.fl-dot, .fl-btns').forEach(d => d.remove())
    const labels = initials(items.map(f => f.name))
    for (const [i, f] of items.entries()) {
      const d = document.createElement('div')
      d.className = `fl-dot ${WORDS[f.status] ? f.status : 'running'}`
      d.textContent = labels[i]
      d.dataset.tab = f.tab
      if (f.color && /^[a-z]+$/.test(f.color)) d.style.setProperty('--ink', `var(--tc${f.color})`)
      d.onmouseenter = () => !drag?.moved && hover(f.tab, d.getBoundingClientRect().top)
      d.onmouseleave = () => !drag?.moved && hover('')
      bar.append(d)
    }
    if (add || mic) {
      const btns = el('div', '', 'fl-btns')
      for (const [on, act, tip] of [[add, 'new', 'New session'], [mic, 'mic', 'Say a prompt']] as const)
        if (on) btns.append(button(act, tip))
      bar.append(btns)
    }
    // a card open across an update: its new text, beside where its circle is now (gone: it shuts)
    const still = hovered && [...bar.querySelectorAll<HTMLElement>('.fl-dot')].find(d => d.dataset.tab === hovered)
    if (still) hover(hovered, still.getBoundingClientRect().top)
    else if (hovered) hover('')
    bridge.size(bar.offsetHeight)
  })
}

// the microphone's window: a text box dictation starts in (macOS's, as the app's prompt mic: 150 ms after the focus, once
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
  const go = async () => {
    if (!text.value.trim() || send.disabled) return
    if (to.value === PICK) return void ((note.textContent = 'Pick who gets it first'), note.classList.add('bad'), to.focus())
    send.disabled = true
    const r = await bridge?.voiceSend(to.value, text.value)
    send.disabled = false
    if (r?.error) (note.textContent = r.error), note.classList.add('bad')
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
  bridge?.onVoice((items, colors, where) => {
    paint(colors)
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
