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
import { dotsText, pinWhat, plainLines, replyOf, tookText } from '../../shared/island'
import type { Ask } from '../../shared/types'
import { base64, dropText, initials, noteWhole, wavOf } from './text'
import type { SpeechLine } from '../../shared/speech'
import { spokenMode } from '../../shared/ask'
import { AI_TO, type Route, routeOf, spokenAnswer, type RouteTab, type TalkTo, talkDefault, talkName, talkNext, talkTime, VOICE_MAX_MS, VOICE_SHORT_MS, FLAT, levelOf, QUIET_MS, quietSay } from '../../shared/talk'
import { voiceFix } from '../../shared/types'

// branch, agents, pr, lines: the card's more, as the sidebar's hover card has them; agent, at, ask, answer, took: the
// island's cards and the reply window's (its agent, since when it needs you, its menu, its last answer, its turn's time)
export type Float = { tab: string; name: string; project: string; status: 'running' | 'waiting' | 'idle' | 'done'; color?: string; last?: string; perm?: { tool: string; what: string }; branch?: string; agents?: string; pr?: { state: string; text: string; meta: string }; lines?: string[]; agent?: string; at?: number; ask?: Ask; answer?: string; took?: number }
type Colors = Record<string, string>
type Drop = { text?: string; paths: string[] } // Q9: what was dropped on a bubble: text or a link, files' and pictures' paths
type Floats = { items: Float[]; colors: Colors; style?: string; add?: boolean; menu?: 'stack' | 'card'; doneAlert?: boolean; ai?: boolean; at?: 'edge' | 'notch' }
type IslandCard = { f?: Float; i?: number; n?: number; list?: Float[] }
// the +'s actions, the menu bar's too: what, its name, what it does; Ask Laki AI while it's on (Settings › AI), last:
// the others keep their keys
const ACTS = [
  ['new', 'New task', 'an agent in a worktree'],
  ['mic', 'Say it', 'dictate a prompt'],
  ['area', 'Screenshot area', 'drag over what to show'],
  ['screen', 'Whole screen', "the screen you're on"],
  ['tell', 'Show and tell', 'a screenshot, then say what to do'], // Q7: main's tellShot
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
    onCard: (cb: (f: Float, colors: Colors, pinned?: boolean, drop?: Drop) => void) => void
    drop: (to: string, d: Drop) => void
    dropImage: (data: string, ext: string) => Promise<{ path?: string; error?: string }>
    dropSend: (tab: string, text: string) => Promise<{ error?: string }>
    click: (tab: string) => void
    pin: (ev: 'esc') => void
    replySend: (tab: string, text: string) => Promise<{ error?: string }>
    cardSize: (tab: string, w: number, h: number) => void
    onVoice: (cb: (items: Float[], colors: Colors, to: string, reply?: Float, route?: RouteCfg) => void) => void
    voiceSend: (tab: string, text: string, project?: string) => Promise<{ error?: string; queued?: boolean; ai?: boolean }>
    voiceClose: () => void
    menuTab: (tab: string) => void
    reply: (tab: string) => void
    answer: (tab: string, n: number, label: string) => Promise<{ error?: string }>
    onIsland: (cb: (c: IslandCard, colors: Colors) => void) => void
    islandSize: (h: number) => void
    islandEv: (ev: string) => void
    onTalk: (cb: (c: Talk) => void) => void
    onTalkKey: (cb: () => void) => void
    talkText: (audio: string) => Promise<{ text?: string; error?: string }>
    talkSend: (tab: string, text: string, project?: string) => Promise<{ error?: string; queued?: boolean; new?: boolean; ai?: boolean; shot?: boolean; noShot?: string }>
    talkUndo: () => Promise<{ error?: string }>
    talkClose: () => void
    talkListen: () => Promise<{ error?: string }>
    onTalkHeard: (cb: (x: SpeechLine | { kind: 'end' }) => void) => void
    talkListenStop: (keep: boolean) => void
    talkFix: (text: string) => Promise<{ text?: string; error?: string }>
    talkAnswer: (tab: string, n: number, label: string) => Promise<{ error?: string }>
  }
}
// Q2: what the talk pill opens with: who it may go to and who by default, the theme, the mic's state (macOS's), smoke:
// npm run test:ui's (no microphone opened); ai: Laki AI is on (Tab goes to it too)
type Talk = { list: TalkTab[]; to: string; ai?: boolean; colors: Colors; mic: string; smoke?: boolean; route?: RouteCfg; speech?: string; answers?: boolean } // answers: a spoken yes or no answers a waiting ask (Settings › Voice)
// a waiting one's ask (what a spoken yes or no answers) and held: its secret or plan (never answered from the pill)
type TalkTab = RouteTab & { ask?: Ask; held?: boolean } // speech: the on-device engine's locale (main's Laki Speech), else Cloud
// Q5: Route by first words, on: the projects (a new task in one), Laki AI's word and whether it's on, the word fixes,
// the project last sent to (a route into another one shows a little longer)
type RouteCfg = { projects: { id: string; name: string }[]; aiWord?: string; aiOn?: boolean; fixes?: string; last?: string; lastTab?: string }
const ROUTE_MS = 1500 // a route shown before it goes; into another project than the last one: ROUTE_FAR_MS
const ROUTE_FAR_MS = 3000
// a route's target as the pages send it: a tab, '' (a new task, maybe in a project) or Laki AI; null: the default
const routeTo = (r: Route) => (r.target.kind === 'tab' ? { tab: r.target.tab } : r.target.kind === 'ai' ? { tab: AI_TO } : r.target.kind === 'new' ? { tab: '', project: r.target.project } : null)
const routeLong = (r: Route, list: RouteTab[], c: RouteCfg) => (p => (p && c.last && p !== c.last ? ROUTE_FAR_MS : ROUTE_MS))(r.target.kind === 'tab' ? list.find(f => f.tab === (r.target as { tab: string }).tab)?.project : r.target.kind === 'new' ? r.target.project : undefined)

const laki = (window as unknown as { laki?: Bridge & { pathOf?: (f: File) => string } }).laki
const bridge = laki?.floater
const bar = document.getElementById('bar')!
const card = document.getElementById('card')!
const mode = /^#(card|voice|menu|talk)$/.exec(location.hash)?.[1] ?? 'bar'
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
// a permission ask's buttons only when what it runs is shown whole, as it is (noteWhole, a notification's rule): a cut
// one (ask.ts' WHAT_MAX), one with a bidi or invisible character, or an empty one gets none, its tab shows it
const whole = (a?: Ask) => !a?.tool || (!!a.what?.trim() && noteWhole(a.what))
// the buttons' line icons (constants: safe as markup)
const svg = (d: string, box = 24) => `<svg viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${box === 24 ? 2 : 1.5}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS: Record<Act | 'plus', string> = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  new: svg('<path d="M7 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9"/><path d="M11.5 2.5l2 2L8 10H6V8z"/>', 16),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  ai: svg('<path d="M6.5 2.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3L2 7l3.3-1.2zM12 9.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/>', 16),
  area: svg('<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/>', 16),
  screen: svg('<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4M8 11v3"/>', 16),
  tell: svg('<path d="M2 5V2h3M2 11v3h3M11 2h3v3"/><rect x="9.5" y="7" width="3" height="5" rx="1.5"/><path d="M8 11a3 3 0 0 0 6 0M11 14v1"/>', 16), // a corner of the area, a mic
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
  let pinned = '' // Q4: the tab whose card is pinned to answer from
  document.addEventListener('keydown', e => {
    if (!pinned || e.metaKey || e.ctrlKey) return
    if (e.key === 'Escape') bridge?.pin('esc')
    else if (/^[1-9]$/.test(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') card.querySelector<HTMLButtonElement>(`[data-n="${e.key}"]`)?.click()
  })
  bridge?.onCard((f, colors, pin, drop) => {
    paint(colors)
    document.getElementById('island')!.replaceChildren() // the island's card or list, from before a switch to the edge: never under it (the window is this card's size: it showed cut)
    card.classList.toggle('pinned', !!pin)
    const draft = pin && pinned === f.tab ? (card.querySelector('input')?.value ?? '') : ''
    pinned = pin ? f.tab : ''
    if (pin && drop) return dropCard(f, drop, draft)
    if (pin) return pinnedCard(f, draft)
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
else if (mode === 'talk') talkPage()
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
    if (click && !d?.moved && (d?.tab || d?.act === 'new' || d?.act === 'ai' || d?.act === 'area' || d?.act === 'screen' || d?.act === 'tell')) (away = true), hot() // the bar hides, or a window comes over it: not lit as it comes back
    if (d?.moved) document.body.classList.remove('dragging'), bridge?.drag('end')
    else if (click && d?.tab && alt) hover(''), bridge?.reply(d.tab) // ⌥-click: a reply to it, Laki stays where it is
    else if (click && d?.tab) hover(''), bridge?.click(d.tab) // Q4: main pins a waiting one's card, else opens its tab
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
  // Q9: something dragged over a circle or the +: it lights, its card says where it goes; let go, it's sent to main (a
  // file by its path only, a picture with no file saved first, text or a link). The island has no drop
  const dropAt = (e: DragEvent) => (notch() ? null : (e.target as HTMLElement).closest<HTMLElement>('.fl-dot, .fl-btn[data-act="plus"]'))
  let over = ''
  bar.ondragover = e => {
    const t = dropAt(e)
    if (!t || !e.dataTransfer) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const key = t.dataset.tab ?? '+'
    if (over === key) return
    over = key
    hot(t)
    const f = cur?.items.find(x => x.tab === t.dataset.tab)
    bridge?.tip(f ? `Release to send to ${f.name}` : 'Release for a new task', f ? 'then say what to do with it' : 'the quick bar, with it in', along(t))
  }
  bar.ondragleave = e => {
    if (bar.contains(e.relatedTarget as Node)) return
    over = ''
    hot()
    hover('')
  }
  bar.ondrop = async e => {
    const t = dropAt(e)
    over = ''
    hot()
    hover('')
    if (!t || !e.dataTransfer) return
    e.preventDefault()
    const paths: string[] = []
    for (const file of [...e.dataTransfer.files]) {
      const p = laki?.pathOf?.(file)
      if (p) paths.push(p)
      else if (/^image\/(png|jpe?g|gif|webp)$/.test(file.type) && file.size <= 20 << 20) {
        const r = await bridge?.dropImage(base64(new Uint8Array(await file.arrayBuffer())), file.type.split('/')[1].replace('jpeg', 'jpg'))
        if (r?.path) paths.push(r.path)
      }
    }
    const text = paths.length ? '' : (e.dataTransfer.getData('text/uri-list').split('\n').find(l => l && !l.startsWith('#')) ?? '') || e.dataTransfer.getData('text/plain')
    if (paths.length || text.trim()) bridge?.drop(t.dataset.tab ?? '+', { ...(text.trim() && { text }), paths })
  }
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

// Q9: what was dropped on a circle, on its card: the files and pictures by name, the text, a line for what to do with it
// (optional); ⏎ sends it all to that agent (dropText: the words, then each path on a line), Esc puts it away
function dropCard(f: Float, drop: Drop, draft: string) {
  const note = el('div', '', 'i-note')
  const fit = () => bridge?.cardSize(f.tab, card.offsetWidth, card.offsetHeight)
  const what = el('div', '', 'drop-what')
  for (const p of drop.paths) what.append(el('div', `📄 ${p.split('/').pop() || p}`, 'mono'))
  if (drop.text) what.append(el('div', drop.text.length > 200 ? `${drop.text.slice(0, 199)}…` : drop.text, 'drop-text'))
  const wrap = el('div', '', 'i-reply')
  const input = Object.assign(document.createElement('input'), { placeholder: 'What to do with it (optional)…', spellcheck: false, value: draft })
  const go = async () => {
    const r = await bridge?.dropSend(f.tab, dropText(input.value, drop))
    if (r?.error) (note.textContent = r.error), note.classList.add('bad'), fit()
  }
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing) e.preventDefault(), go()
  }
  wrap.append(input, Object.assign(el('button', '↑', 'i-send'), { onclick: go, title: 'Send (⏎)' }))
  const foot = el('div', '', 'i-foot')
  foot.append(Object.assign(el('button', 'Open tab') as HTMLButtonElement, { onclick: () => bridge?.open(f.tab) }), el('span', 'Esc puts it away', 'i-sub'))
  card.replaceChildren(el('b', `To ${f.name}`), el('div', `${f.agent ?? 'agent'} · ${f.project} · only the paths go: the agent reads the files itself`, 'meta'), what, wrap, note, foot)
  fit()
  setTimeout(() => input.focus(), 30)
}

// Q4: a waiting circle's card, pinned (main: clickable, focusable): what it asks; a permission's tool and its command or
// file in mono, its first 3 lines (cut: no buttons, Open to read it all); its options as buttons (1-9), or a line to
// answer in words (sent now, as an answer); Open. Esc, a click elsewhere or the answer unpins it (main)
function pinnedCard(f: Float, draft: string) {
  const note = el('div', '', 'i-note')
  const fit = () => bridge?.cardSize(f.tab, card.offsetWidth, card.offsetHeight)
  const bad = (t: string) => ((note.textContent = t), note.classList.add('bad'), fit())
  const a = f.ask
  const parts: HTMLElement[] = [el('b', f.name), el('div', `${f.agent ?? 'agent'} asks · ${f.project}`, 'meta')]
  let cut = false
  if (a?.tool) {
    const w = pinWhat(a.what ?? '')
    cut = w.cut
    parts.push(el('div', permVerb(a.tool), 'i-q'), el('pre', w.shown, 'i-what pin-what'), ...(cut ? [el('div', 'Longer than this card: Open it to read all of it before you answer', 'i-sub')] : []))
  } else if (a?.question || f.last) parts.push(el('div', a?.question ?? f.last ?? '', 'i-q'))
  const btn = (text: string, cls: string, on: () => void) => Object.assign(el('button', text, cls) as HTMLButtonElement, { onclick: on })
  if (replyOf(f) === 'options') {
    const opts = el('div', '', 'i-opts pin-opts')
    const always = a?.rule ? alwaysOf(a) : undefined
    if (!cut && whole(a))
      for (const o of a!.options) {
        const b = btn(`${o.n}  ${o === always ? `Always: ${a!.rule}` : o.label}`, `i-opt${o.n === a!.options[0].n ? ' primary' : ''}`, async () => {
          const r = await bridge?.answer(f.tab, o.n, o.label)
          if (r?.error) bad(r.error)
        })
        b.dataset.n = String(o.n)
        opts.append(b)
      }
    else if (!cut) parts.push(el('div', "Can't show it whole here: answer in its tab", 'i-sub'))
    parts.push(opts)
  } else {
    // its question in words: a line, ⏎ sends it now
    const wrap = el('div', '', 'i-reply')
    const input = Object.assign(document.createElement('input'), { placeholder: `Answer ${f.agent ?? 'it'}…`, spellcheck: false, value: draft })
    const go = async () => {
      if (!input.value.trim()) return
      const r = await bridge?.replySend(f.tab, input.value)
      if (r?.error) bad(r.error)
    }
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.isComposing) e.preventDefault(), go()
    }
    wrap.append(input, Object.assign(el('button', '↑', 'i-send'), { onclick: go, title: 'Send (⏎)' }))
    parts.push(wrap)
    setTimeout(() => input.focus(), 30)
  }
  const foot = el('div', '', 'i-foot')
  foot.append(btn('Open tab', '', () => bridge?.open(f.tab)), el('span', 'Esc closes', 'i-sub'))
  card.replaceChildren(...parts, note, foot)
  fit()
}

// an Edit's or Write's change (Ask.diff, permDiff's lines) on its card: red and green, its first 10 lines (its cut's
// own last line, …N more, muted)
function diffEl(diff: string) {
  const lines = diff.split('\n')
  const pre = el('pre', '', 'i-diff')
  pre.append(...lines.slice(0, 10).map(l => el('div', l || ' ', l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : l[0] === '…' ? 'm' : '')), ...(lines.length > 10 ? [el('div', '…the rest in its tab: Open tab', 'm')] : []))
  return pre
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
  // measured at once: the window is hidden until main has its size, and a hidden page gets no animation frames
  const fit = () => bridge?.islandSize(box.offsetHeight)
  box.onpointerenter = () => bridge?.islandEv('enter')
  box.onpointerdown = () => bridge?.islandEv('focus') // a press, not a pass: the app in front keeps the keyboard until then
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
    card.replaceChildren() // the edge's hover card, from before a switch to the island: never above it
    const draft = c.f && shown?.f?.tab === c.f.tab ? (box.querySelector('textarea')?.value ?? '') : '' // the same one again: what you typed stays
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
      if (a?.tool) parts.push(el('div', permVerb(a.tool), 'i-q'), el('pre', a.what ?? '', 'i-what'), ...(a.diff ? [diffEl(a.diff)] : []), el('div', `${a.tool} · ${f.project} / ${f.name}`, 'i-sub'))
      else if (a?.question || f.last) parts.push(el('div', a?.question ?? f.last ?? '', 'i-q'))
      const opts = el('div', '', 'i-opts')
      const always = a?.rule ? alwaysOf(a) : undefined
      for (const o of whole(a) ? (a?.options ?? []) : []) {
        const b = btn(`${o.n}  ${o === always ? `Always: ${a!.rule}` : o.label}`, `i-opt${o.n === a!.options[0].n ? ' primary' : ''}`, async () => {
          const r = await bridge?.answer(f.tab, o.n, o.label)
          if (r?.error) say(note, r.error)
        })
        b.dataset.n = String(o.n)
        opts.append(b)
      }
      parts.push(opts)
      if (!a?.options.length) parts.push(el('div', 'Its question is in its tab', 'i-sub'))
      else if (!whole(a)) parts.push(el('div', "Can't show it whole here: answer in its tab", 'i-sub'))
    } else {
      parts.push(head(f, f.took ? `done in ${tookText(f.took)}` : 'done'))
      parts.push(el('div', plainLines(f.answer, 2).join('\n') || 'Finished', 'i-answer'))
      parts.push(replyBox(f, note, fit, draft))
    }
    const foot = el('div', '', 'i-foot')
    foot.append(...(f.status === 'done' ? [btn('Review changes', '', () => bridge?.open(f.tab, 'changes'))] : []), btn('Open tab', '', () => bridge?.open(f.tab)), dots)
    box.replaceChildren(...parts, note, foot)
    fit()
  })
}
// a reply box: ⏎ sends to the agent (send, queued while it works), ⇧⏎ a new line; a menu it shows: its options only
function replyBox(f: Float, note: HTMLElement, fit: () => void, draft = '') {
  const wrap = el('div', '', 'i-reply')
  const text = Object.assign(document.createElement('textarea'), { rows: 1, placeholder: `Reply to ${f.agent ?? 'it'}…`, spellcheck: false, value: draft })
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
  let items: Float[] = []
  let route: RouteCfg | undefined // Q5: Route by first words, on
  let routing: ReturnType<typeof setTimeout> | undefined // a route shown, about to go
  let decided = false // routed once (or stopped): ⏎ sends to what's picked
  let newIn: string | undefined // a new task's project
  const later = (what: string, ms: number) => ((note.textContent = `→ ${what}: sends in a moment · Esc stops it`), note.classList.remove('bad'), (decided = true), (routing = setTimeout(() => ((routing = undefined), void go()), ms)))
  const go = async () => {
    if (!text.value.trim() || send.disabled) return
    // an agent in a menu: typed keys would pick one of its options
    if (reply && replyOf(reply) === 'options') return void ((note.textContent = 'Pick an option, or Open the tab'), note.classList.add('bad'))
    if (routing) clearTimeout(routing), (routing = undefined) // ⏎ while it's shown: now
    else if (!reply && route && !decided) {
      // Q5: its first words name who gets it (the word fixes first: macOS's dictation has none of its own); else the
      // agent that asked last or the one last sent to, as the talk pill's
      const tabs: RouteTab[] = items.map(f => ({ tab: f.tab, name: f.name, status: f.status, at: f.at, project: (f as Float & { pid?: string }).pid, alias: (f as Float & { alias?: string }).alias }))
      const r = routeOf(text.value, { tabs, projects: route.projects, aiOn: route.aiOn, aiWord: route.aiWord, fixes: route.fixes, fix: voiceFix })
      const at = routeTo(r)
      if (at && !r.rest) return void ((note.textContent = `Nothing after “${r.how}”: say what to do`), note.classList.add('bad'))
      if (at && [...to.options].some(o => o.value === at.tab)) return void ((text.value = r.rest), (to.value = at.tab), (newIn = at.project), later(r.how, routeLong(r, tabs, route)))
      if (to.value === PICK) {
        const d = talkDefault(tabs, route.lastTab)
        return void ((to.value = d), later(d ? talkName(tabs, d) : 'a new session', ROUTE_MS))
      }
    }
    if (!reply && to.value === PICK) return void ((note.textContent = 'Pick who gets it first'), note.classList.add('bad'), to.focus())
    send.disabled = true
    const r = await bridge?.voiceSend(reply ? reply.tab : to.value, text.value, !reply && !to.value ? newIn : undefined)
    send.disabled = false
    if (r?.error) (note.textContent = r.error), note.classList.add('bad') // its text kept
    else if (r?.queued) (note.textContent = 'Queued: it gets it when its turn ends'), note.classList.remove('bad'), setTimeout(() => bridge?.voiceClose(), 1200)
  }
  send.onclick = go
  text.oninput = () => (calm(), routing ? (clearTimeout(routing), (routing = undefined), (note.textContent = 'Stopped: ⏎ sends to what’s picked')) : (decided = false))
  text.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault(), go()
  }
  // Esc shuts it; with words in it, a second Esc (the first may be meant for dictation)
  let esc = false
  document.onkeydown = e => {
    if (e.key === 'Escape' && routing) return void (clearTimeout(routing), (routing = undefined), (note.textContent = 'Stopped: ⏎ sends to what’s picked')) // Q5: not at all yet
    if (e.key !== 'Escape') return void (esc && ((esc = false), (note.textContent = hint))) // re-armed: the mode's note again
    if (!text.value.trim() || esc) return bridge?.voiceClose()
    esc = true
    note.textContent = 'Esc again to throw it away'
    note.classList.remove('bad')
  }
  to.onchange = () => (routing && (clearTimeout(routing), (routing = undefined), (note.textContent = hint)), (newIn = undefined), to.value !== PICK && calm())
  bridge?.onVoice((list, colors, where, to1, r) => {
    paint(colors)
    items = list
    route = r
    decided = false
    reply = to1
    box.classList.toggle('reply', !!reply)
    title.textContent = reply ? `Reply to ${reply.agent ?? 'it'} · ${reply.name}` : 'Say a prompt'
    const perm = reply && replyOf(reply) === 'options' && reply.ask?.tool ? reply.ask : undefined // what a Yes here runs
    lastBox.textContent = perm ? `${permVerb(perm.tool!)} ${perm.what ?? ''}` : reply ? plainLines(reply.answer, 3).join('\n') : ''
    lastBox.hidden = !lastBox.textContent
    // a waiting one's menu: its options as buttons (answer, by n and label)
    opts.replaceChildren(
      ...(reply && replyOf(reply) === 'options' && whole(reply.ask)
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
      note.textContent = hint = replyOf(reply) !== 'options' ? '⏎ sends · ⇧⏎ a new line · Esc closes' : whole(reply.ask) ? 'Pick an option, or Open the tab · Esc closes' : "Can't show it whole here: Open the tab · Esc closes"
      return void text.focus()
    }
    const opt = (value: string, textContent: string, o: Partial<HTMLOptionElement> = {}) => Object.assign(document.createElement('option'), { value, textContent, ...o })
    to.replaceChildren(
      ...(where === 'new' ? [] : [opt(PICK, 'Pick who gets it…', { disabled: true, selected: true })]),
      ...items.map(f => opt(f.tab, `${f.name} · ${WORDS[f.status] ?? f.status}`)),
      ...(route?.aiOn ? [opt(AI_TO, 'Laki AI')] : []),
      opt('', 'A new session…', { selected: where === 'new' }),
    )
    to.hidden = where === 'new'
    if (where === 'new') note.textContent = hint = 'For a new session · ⏎ opens it with this prompt · Esc closes'
    dictate()
  })
}

// Q2: the talk key's pill: recording as it opens (the mic open only until it stops: the red dot says so), its level
// from an AnalyserNode on the same stream, the time, who gets it (Tab, ⇧Tab: another). The key again or ⏎: stopped,
// written down (main's talk-text: the daemon's voiceText), sent; Esc drops it. Then "Sent to …" for 4 s, with Undo
// while it's still queued (typed into a terminal, it can't be taken back)
function talkPage() {
  const box = document.getElementById('talk')!
  const toEl = box.querySelector<HTMLElement>('.t-to')!
  const timeEl = box.querySelector<HTMLElement>('.t-time')!
  const level = box.querySelector<HTMLElement>('.t-level > i')!
  const note = box.querySelector<HTMLElement>('.t-note')!
  const undo = box.querySelector<HTMLButtonElement>('.t-undo')!
  let list: TalkTab[] = []
  let answers = false
  let lang: string | undefined
  let asking: { go: () => void; t?: ReturnType<typeof setTimeout>; text: string } | undefined // a spoken yes or no shown before it answers
  let to = ''
  let toProject: string | undefined // a new task's project (Q5)
  let cfg: RouteCfg | undefined
  let ai = false // Laki AI on: a Tab target
  let phase: 'wait' | 'rec' | 'writing' | 'route' | 'answer' | 'sending' | 'sent' = 'wait'
  let routed: { text: string; t: ReturnType<typeof setTimeout> } | undefined // Q5: shown before it goes
  let stopRec: ((send: boolean) => void) | undefined
  const close = () => bridge?.talkClose()
  const say = (t: string, bad = false) => ((note.textContent = t), note.classList.toggle('bad', bad))
  const show = () => (toEl.textContent = `→ ${to ? talkName(list, to) : toProject ? `new task in ${cfg?.projects.find(p => p.id === toProject)?.name ?? toProject}` : 'new task'}`)
  const HINT = 'The key again or ⏎ sends · Tab: who gets it · Esc drops it'
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) return
    // a spoken yes or no shown: ⏎ answers, Tab sends the words as a message instead, Esc drops it
    if (phase === 'answer' && asking) {
      if (e.key === 'Enter') return void (e.preventDefault(), clearTimeout(asking.t), asking.go())
      if (e.key === 'Tab') return void (e.preventDefault(), clearTimeout(asking.t), (phase = 'wait'), void send(asking.text))
      if (e.key === 'Escape') return void (e.preventDefault(), clearTimeout(asking.t), close())
      return
    }
    if (e.key === 'Escape') return void (e.preventDefault(), routed && clearTimeout(routed.t), stopRec ? stopRec(false) : close())
    if (e.key === 'Tab' && (phase === 'rec' || phase === 'wait' || phase === 'route')) {
      e.preventDefault()
      to = talkNext(list, to, e.shiftKey, ai)
      toProject = undefined
      toEl.classList.remove('moved')
      if (routed) clearTimeout(routed.t), (routed.t = setTimeout(() => void send(routed!.text), ROUTE_MS)) // the new one, a moment again
      return void show()
    }
    if (e.key === 'Enter' && phase === 'rec') e.preventDefault(), stopRec?.(true)
    else if (e.key === 'Enter' && phase === 'route' && routed) e.preventDefault(), clearTimeout(routed.t), void send(routed.text) // now
  })
  bridge?.onTalkKey(() => (phase === 'answer' && asking ? (clearTimeout(asking.t), asking.go()) : phase === 'rec' ? stopRec?.(true) : phase === 'route' && routed ? (clearTimeout(routed.t), void send(routed.text)) : phase === 'sent' || phase === 'wait' ? close() : undefined))
  undo.onclick = async () => {
    undo.disabled = true
    const r = await bridge?.talkUndo()
    undo.hidden = true
    say(r?.error ? `Not taken back: ${r.error}` : 'Taken back', !!r?.error)
    setTimeout(close, 1200)
  }
  bridge?.onTalk(c => {
    paint(c.colors)
    list = c.list
    to = c.to
    answers = c.answers !== false
    lang = c.speech
    ai = !!c.ai
    cfg = c.route
    show()
    if (c.mic === 'denied' || c.mic === 'restricted') return say('The microphone is off for Laki: System Settings › Privacy & Security › Microphone, then the key again', true)
    if (c.mic === 'not-determined') say('macOS asks once: Laki hears what you say to an agent, and only while this pill shows red')
    else say(HINT)
    if (c.speech && !c.smoke) return void listen()
    void record(!!c.smoke)
  })
  async function record(smoke: boolean) {
    let stream: MediaStream | undefined
    if (!smoke)
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      } catch (e) {
        return say(`Microphone: ${(e as Error).message}`, true)
      }
    const at = Date.now()
    phase = 'rec'
    box.classList.add('rec')
    say(HINT)
    const ctx = stream && new AudioContext()
    const an = ctx?.createAnalyser()
    if (an && ctx && stream) (an.fftSize = 512), ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(512)
    const device = stream?.getAudioTracks()[0]?.label
    let loud = Date.now()
    let deaf = false // Q6: flat for QUIET_MS: "I can't hear you", the input named, until it hears something
    const tick = setInterval(() => {
      timeEl.textContent = talkTime(Date.now() - at)
      if (!an) return void (level.style.width = `${30 + 20 * Math.sin(Date.now() / 200)}%`)
      an.getByteTimeDomainData(buf)
      const l = levelOf(buf)
      level.style.width = `${l * 100}%`
      if (l >= FLAT) loud = Date.now()
      const q = phase === 'rec' && Date.now() - loud >= QUIET_MS
      if (q !== deaf) (deaf = q), say(q ? quietSay(device) : HINT, q)
    }, 60)
    const r = stream && new MediaRecorder(stream)
    const chunks: Blob[] = []
    r?.addEventListener('dataavailable', e => chunks.push(e.data))
    r?.start()
    const limit = setTimeout(() => stopRec?.(true), VOICE_MAX_MS)
    stopRec = send => {
      stopRec = undefined
      clearTimeout(limit)
      clearInterval(tick)
      const done = () => {
        stream?.getTracks().forEach(t => t.stop()) // the mic off
        void ctx?.close()
        box.classList.remove('rec')
        level.style.width = '0'
        if (!send) return close()
        if (Date.now() - at < VOICE_SHORT_MS) return void (say('Too short: say it, then press the key again', true), setTimeout(close, 1500))
        void heard(smoke ? 'smoke test' : undefined, r && new Blob(chunks, { type: r.mimeType }))
      }
      if (r && r.state !== 'inactive') (r.onstop = done), r.stop()
      else done()
    }
  }
  // the on-device engine: main's Laki Speech listens (the mic open while the pill is red), its level and words as it
  // goes; stopped, its final text is cleaned as Cloud's is (talkFix: fillers, word fixes), then routed and sent as Cloud's
  let onHeard: ((x: SpeechLine | { kind: 'end' }) => void) | undefined
  bridge?.onTalkHeard(x => onHeard?.(x))
  async function listen() {
    const at = Date.now()
    let partial = ''
    let ended = false
    let loud = Date.now()
    let deaf = false
    const tick = setInterval(() => {
      timeEl.textContent = talkTime(Date.now() - at)
      const q = phase === 'rec' && Date.now() - loud >= QUIET_MS
      if (q !== deaf) (deaf = q), say(q ? quietSay(undefined) : HINT, q)
    }, 200)
    const limit = setTimeout(() => stopRec?.(true), VOICE_MAX_MS)
    const end = (text: string) => {
      if (ended) return
      ended = true
      onHeard = undefined
      void bridge?.talkFix(text).then(w => heard(w?.text ?? text), () => heard(text))
    }
    onHeard = x => {
      if (x.kind === 'level') (level.style.width = `${x.level * 100}%`), x.level >= FLAT && (loud = Date.now())
      else if (x.kind === 'partial') (partial = x.text), phase === 'rec' && !deaf && say(x.text.length > 70 ? `…${x.text.slice(-70)}` : x.text)
      else if (x.kind === 'final') phase === 'writing' && end(x.text.trim() || partial)
      else if (x.kind === 'error') (ended = true), clearInterval(tick), clearTimeout(limit), stopRec?.(false), say(`${x.error}${x.code === 'no-on-device' || x.code === 'locale' ? ': Settings › Voice › Talk key, Cloud' : ''}`, true), setTimeout(close, 5000)
      else if (x.kind === 'end' && phase === 'writing') end(partial) // it stopped without a final line
    }
    phase = 'rec'
    box.classList.add('rec')
    const r = await bridge?.talkListen()
    if (r?.error) return void ((phase = 'wait'), box.classList.remove('rec'), say(r.error, true))
    stopRec = keep => {
      stopRec = undefined
      clearTimeout(limit)
      clearInterval(tick)
      box.classList.remove('rec')
      level.style.width = '0'
      if (!keep || Date.now() - at < VOICE_SHORT_MS) bridge?.talkListenStop(false)
      if (!keep) return ended || close()
      if (Date.now() - at < VOICE_SHORT_MS) return void (say('Too short: say it, then press the key again', true), setTimeout(close, 1500))
      phase = 'writing'
      say('Writing it down…')
      bridge?.talkListenStop(true)
    }
  }
  async function heard(given?: string, audio?: Blob | null) {
    phase = 'writing'
    say('Writing it down…')
    let text = given ?? ''
    if (!given && audio) {
      try {
        const b = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await audio.arrayBuffer())
        const w = await bridge?.talkText(base64(wavOf(b.getChannelData(0), 16000)))
        if (w?.error) return void (say(w.error, true), setTimeout(close, 4000))
        text = w?.text?.trim() ?? ''
      } catch (e) {
        return void (say((e as Error).message, true), setTimeout(close, 4000))
      }
    }
    if (!text) return void (say('Nothing heard', true), setTimeout(close, 1500))
    // a spoken yes or no with an ask waiting (the pill's target's, else the newest): that ask's answer, not a message
    const yes = answers && spokenAnswer(text, lang)
    const waiting = list.filter(x => x.status === 'waiting' && x.ask)
    const t = yes && (waiting.find(x => x.tab === to) ?? waiting.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0])
    if (yes && t) return answerAsk(t, yes, text)
    // Q5: its first words name who gets it: shown a moment (Tab: another, ⏎: now, Esc: not at all), then the rest goes
    const r = cfg && routeOf(text, { tabs: list, projects: cfg.projects, aiOn: cfg.aiOn, aiWord: cfg.aiWord })
    const at = r && routeTo(r)
    if (!r || !at) return send(text)
    if (!r.rest) return void (say(`Nothing after “${r.how}”: say it again with what to do`, true), setTimeout(close, 3000))
    to = at.tab
    toProject = at.project
    show()
    toEl.classList.add('moved')
    phase = 'route'
    say(`${r.how}: sends in a moment · Tab: another · ⏎ now · Esc stops it`)
    routed = { text: r.rest, t: setTimeout(() => void send(r.rest), routeLong(r, list, cfg!)) }
  }
  function answerAsk(t: TalkTab, yes: 'yes' | 'no', text: string) {
    const a = t.ask!
    const what = `${a.tool ?? ''}${a.tool && (a.what || a.question) ? ': ' : ''}${(a.what || a.question || '').split('\n')[0]}`.slice(0, 120)
    const mode = spokenMode({ status: 'waiting', ask: a, ...(t.held && { secret: true }) })
    to = t.tab
    show()
    phase = 'answer'
    const word = yes === 'yes' ? 'Yes' : 'No'
    if (mode === 'laki') {
      asking = { text, go: () => void bridge?.talkClose() }
      return say(`${t.name} asks something to answer in Laki: ${what} · Tab: send “${text}” as a message · Esc`, true)
    }
    const opt = yes === 'yes' ? a.options[0] : a.options.at(-1)!
    asking = {
      text,
      go: async () => {
        asking = undefined
        phase = 'sending'
        const r = await bridge?.talkAnswer(t.tab, opt.n, opt.label)
        phase = 'sent'
        say(r?.error ? `Not answered: ${r.error}` : `Answered ${word}: ${t.name}`, !!r?.error)
        setTimeout(close, r?.error ? 4000 : 2000)
      },
    }
    say(`Answer ${word} to: ${what} · ${mode === 'auto' ? 'in a moment, ⏎ now' : '⏎ answers'} · Tab: send it as a message · Esc drops it`)
    if (mode === 'auto') asking.t = setTimeout(() => asking?.go(), 1500)
  }
  async function send(text: string) {
    if (phase === 'sending' || phase === 'sent') return
    phase = 'sending'
    const name = talkName(list, to)
    const r = await bridge?.talkSend(to, text, to ? undefined : toProject)
    phase = 'sent'
    if (r?.error) {
      const copied = await navigator.clipboard?.writeText(text).then(() => true, () => false)
      return void (say(`Not sent: ${r.error}${copied ? '. Copied, paste it' : ''}`, true), setTimeout(close, 5000))
    }
    if (r?.new) return close() // the new task's window has it
    if (r?.ai) return void (say(`Asked Laki AI${r.shot ? ' with your screen' : ''}: its answer is on the AI page${r.noShot ? ` (no screen: ${r.noShot})` : ''}`, !!r.noShot), setTimeout(close, r.noShot ? 5000 : 2500))
    say(r?.queued ? `Sent to ${name}: it gets it when its turn ends` : `Sent to ${name}`)
    undo.hidden = !r?.queued
    setTimeout(close, 4000)
  }
}

