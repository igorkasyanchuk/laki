// Small shared UI: line icons (16px, currentColor), icon buttons, tooltips, popup and context menus,
// rows dragged into a new order.
import { Component, Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as KE, type MouseEvent, type PointerEvent as PE, type ReactNode } from 'react'
import { flipMoves } from './flip'
import { EMOJIS, emojiOf, ICONS, iconLook, type IconLook, type IconName, iconOf, iconPx, isIconName, onIconLook } from '../../shared/icons'
import { TAB_COLORS } from '../../shared/types'
import { createPortal, flushSync } from 'react-dom'
import { inAim, menuKeys, midCut, snap, stackOrder, tipDelay, tipParts } from './text'
import { keyShow, type KeyId } from '../../shared/keys'
import { overUsual } from '../../shared/nextStep'
import { morphOk } from './motion'

// localStorage, per viewer: what's there may be gone, blocked or not JSON; keep(key, undefined) removes it
export function load<T>(key: string, or: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? or
  } catch {
    return or
  }
}
export const keep = (key: string, v: unknown) => {
  try {
    if (v === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {}
}
// Esc for a page or a dialog: not one something on it took (a menu, a field's own Esc), nor one that ends dictation or an
// IME's word
// a setting's ? card (SettingsKit's HelpQ) is open: it takes Esc first (a browser without the Popover API has none, and
// its querySelector would throw at :popover-open)
export const cardOpen = () => 'showPopover' in HTMLElement.prototype && !!document.querySelector('.help-card:popover-open')
export const escapes = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !cardOpen()
// a popup's backdrop, a click on it closes: in the window's .app, not where it opens, so no ancestor's backdrop-filter
// (a status bar capsule's blur, every design but Frosted) is its fixed box, which placed it off screen
export const Backdrop = ({ onClose, children }: { onClose: () => void; children: ReactNode }) =>
  createPortal(
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      {children}
    </div>,
    document.querySelector('.app') ?? document.body,
  )

export type { IconName }
export { isIconName } // an extension's icon

// in the pack, width and size Settings › Appearance › Icons picked (icons.ts' look; look: Settings' previews of another);
// size is at the default 14, scaled with it
export function Icon({ name, size = 14, look }: { name: IconName; size?: number; look?: IconLook }) {
  const now = useSyncExternalStore(onIconLook, iconLook)
  const l = look ?? now
  const i = iconOf(name, l)
  const px = iconPx(size, l)
  return <svg className="icon-svg" width={px} height={px} viewBox={`0 0 ${i.box} ${i.box}`} fill={i.fill ? 'currentColor' : 'none'} stroke={i.fill ? 'none' : 'currentColor'} strokeWidth={i.sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: i.inner }} />
}

// label: words beside the icon (the sidebar's foot)
// tip false: its name for screen readers only, no tooltip
// keyId: its Settings › Keys action (data-key: the hold-⌘ overlay's badge beside it)
// U11: a click target that isn't a <button> (a row, a cell, a picture): a button to the keyboard and a screen reader
// too: focusable, Enter and Space click it (its own key, not a child's). none: nothing to press, no role
// V13: what's on screen changes in a view transition, the place kept: a page cross-fades in the main area (styles.css'
// view-transition-name on .main's page; the root has none, so the sidebar and the terminals aren't snapshotted and a
// printing terminal never freezes); grow 'open': the sheet grows from the button (or menu item) that has the focus,
// 'close': it shrinks back there. Off without startViewTransition, under Reduce motion, Motion: Off, a window without the
// focus (one that draws no frames would hold the change until a frame comes: a daemon's view, a page opened from
// elsewhere) and ui-smoke (main marks the page data-smoke): fn at once. One whose change hasn't run in 400 ms is skipped
// (its change runs then)
let grewFrom: HTMLElement | null = null
const sheetOf = () => [...document.querySelectorAll<HTMLElement>('.overlay .modal, .main > .settings-page')].at(-1) ?? null
// a double click on a bar's empty room (the tab bar, a page's head) does what a native title bar's does: main reads macOS's
// setting (zoom, minimize or nothing); one on a control, a tab or a field is that one's own
export const titleDbl = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [role=tab], [role=button], [contenteditable=true], .tab, .nodrag')) return
  ;(window as { laki?: { titlebarDblClick?: () => void } }).laki?.titlebarDblClick?.()
}
export function morph(fn: () => void, grow?: 'open' | 'close') {
  if (!morphOk()) return fn()
  const named: HTMLElement[] = []
  const name = (el: HTMLElement | null | undefined) => void (el && ((el.style.viewTransitionName = 'morph'), named.push(el)))
  const clear = () => named.splice(0).forEach(el => (el.style.viewTransitionName = ''))
  const at = document.activeElement
  const from = grow === 'open' && at instanceof HTMLElement && at.matches('button, [role=menuitem], .menu-item') ? at : null
  const back = grow === 'close' && grewFrom?.isConnected ? grewFrom : null
  if (grow === 'open') (grewFrom = from), name(from)
  if (back) name(sheetOf())
  let ran = false
  // a page that covered the sidebar (Board, Schedule) going: its fading picture is cut to where the main area is after
  // (styles.css --vt-cut), else its text and card faded out over the sidebar's rows, already back under it
  const root = document.documentElement
  const left = () => document.querySelector('.main')?.getBoundingClientRect().left ?? 0
  const was = left()
  const t = document.startViewTransition(() => {
    ran = true
    clear()
    flushSync(fn)
    name(from ? sheetOf() : back)
    root.style.setProperty('--vt-cut', `${Math.max(0, left() - was)}px`)
  })
  void t.finished.finally(() => (clear(), root.style.removeProperty('--vt-cut')))
  t.ready.catch(() => {}) // skipped: its ready rejects
  setTimeout(() => ran || t.skipTransition(), 400)
}
// a picture opening large from its thumbnail (a shared element: it grows into place): the thumbnail's <img> named zoom,
// and as open renders, the large one (an <img> in a [data-zoom] viewer) takes the name; closeTo is the way back, into
// the thumbnail when it's still there showing the same picture. One zoom at a time; as morph, none without view
// transitions, under Reduce motion or Motion: Off, in a window without the focus or in ui-smoke: a plain open or close
let zoomed: HTMLImageElement | null = null
let zooming = false
const bigImg = () => document.querySelector<HTMLImageElement>('[data-zoom] img')
const imgIn = (el: Element | null | undefined) => (el instanceof HTMLImageElement ? el : (el?.querySelector('img') ?? null))
function zoom(from: HTMLElement, fn: () => void, to: () => HTMLElement | null) {
  zooming = true
  from.style.viewTransitionName = 'zoom'
  let into: HTMLElement | null = null
  let ran = false
  const t = document.startViewTransition(() => {
    ran = true
    from.style.viewTransitionName = ''
    flushSync(fn)
    into = to()
    if (into) into.style.viewTransitionName = 'zoom'
  })
  void t.finished.finally(() => ((zooming = false), into && (into.style.viewTransitionName = '')))
  t.ready.catch(() => {})
  setTimeout(() => ran || t.skipTransition(), 400)
}
export function openFrom(el: Element | null | undefined, open: () => void) {
  const from = imgIn(el)
  zoomed = from
  if (!from || zooming || !morphOk()) return open()
  zoom(from, open, bigImg)
}
export function closeTo(close: () => void) {
  const from = bigImg()
  const back = zoomed?.isConnected && from && zoomed.currentSrc === from.currentSrc ? zoomed : null
  zoomed = null
  if (!from || !back || zooming || !morphOk()) return close()
  zoom(from, close, () => back)
}

// a workspace's row that moved to another group (Pinned and back): a name each (only those), so it slides there
export function rowsMorph(ids: string[], fn: () => void) {
  if (!ids.length || !morphOk()) return fn()
  const rows = () => ids.map(id => document.querySelector<HTMLElement>(`.sidebar [data-row="ws:${CSS.escape(id)}"]`))
  const name = (on: boolean) => rows().forEach((el, i) => el && (el.style.viewTransitionName = on ? `row-${i}` : ''))
  name(true)
  let ran = false
  const t = document.startViewTransition(() => ((ran = true), name(false), flushSync(fn), name(true)))
  void t.finished.finally(() => name(false))
  t.ready.catch(() => {})
  setTimeout(() => ran || t.skipTransition(), 400)
}

// V11: a scrolling list's edge: once it's scrolled, its top fades under the header above it (styles.css
// [data-scrolled]: a mask). A sentinel, its scroller's first child, seen by one IntersectionObserver: no scroll listener.
// A data attribute, not a class: React leaves it alone as the scroller's className changes
// end: the last child instead, its parent data-more while more is below (a bottom fade: ⌘K, a long menu)
export function ScrollEdge({ end = false }: { end?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    const root = el?.parentElement
    const at = end ? 'data-more' : 'data-scrolled'
    if (!el || !root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => root.toggleAttribute(at, !e.isIntersecting), { root })
    io.observe(el)
    return () => (io.disconnect(), root.removeAttribute(at))
  }, [end])
  return <div ref={ref} className={`scroll-edge${end ? ' end' : ''}`} aria-hidden />
}

// space: what Space does instead of a click (U14: a file row's Quick Look)
export const act = <E extends Element>(f: ((e: MouseEvent<E>) => unknown) | false | null | undefined, space?: (() => unknown) | false) =>
  f ? { role: 'button', tabIndex: 0, onClick: f, onKeyDown: (e: KE<E>) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), e.key === ' ' && space ? space() : f(e as unknown as MouseEvent<E>)) } : {}

export function IconButton({ icon, title, onClick, on, className = '', label, tip = true, disabled, onContextMenu, keyId }: { icon: IconName; title: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; on?: boolean; className?: string; label?: string; tip?: boolean; disabled?: boolean; onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void; keyId?: string }) {
  return (
    <button className={`ib ${on ? 'on' : ''} ${label ? 'labeled' : ''} ${className}`} data-tip={tip ? title : undefined} data-key={keyId} aria-label={title} disabled={disabled} onClick={onClick} onContextMenu={onContextMenu}>
      <Icon name={icon} />
      {label && <span className="ib-label">{label}</span>}
    </button>
  )
}

// how long a turn has been going (since: the daemon's clock, a phone's may differ a little): 42s, 12m, 1h 5m
// usual: its project's and profile's usual turn (seconds): past twice it and 5 minutes, drawn in the waiting color
// a name cut in the middle to its room (text.ts midCut), both ends readable: the whole one in a hidden span beside it
// sets the box's width, so the cut never shrinks it; one ResizeObserver for every MidText, so nothing is measured
// unless a box changes size (the sidebar resized) or its name changes. The whole name is its title and what a screen
// reader reads; one that fits is shown as it is
const fits = new WeakMap<Element, () => void>()
let midRo: ResizeObserver | undefined
// floor: at least that many characters (or all of a shorter name): its row (the closest [data-floor]) gets data-tight
// when the name has fewer, for the row to give room (a workspace row's One next step chip: its icon alone); it's let go
// once there's room for `extra` characters more (the chip's word back), so it doesn't flip back and forth
export function MidText({ text, className = '', floor }: { text: string; className?: string; floor?: { chars: number; extra: number } }) {
  const box = useRef<HTMLSpanElement>(null)
  const whole = useRef<HTMLSpanElement>(null)
  const cut = useRef<HTMLSpanElement>(null)
  const [max, setMax] = useState(Infinity)
  const [tipped, setTipped] = useState(false) // inside an element with Laki's tooltip or peek card (data-tip, data-peek): no native one beside it
  // the estimate (characters by the whole name's average width) can be a little long: one fewer until the cut fits
  useLayoutEffect(() => {
    const c = cut.current
    if (c && max !== Infinity && max > 2 && c.scrollWidth > c.clientWidth + 0.5) setMax(max - 1)
  }, [max])
  useLayoutEffect(() => {
    const el = box.current!
    const fit = () => {
      setTipped(!!el.parentElement?.closest('[data-tip], [data-peek]')) // read as it fits: a row's peek comes and goes with the window's width
      const w = el.clientWidth
      const fw = whole.current!.offsetWidth
      const len = [...text].length
      setMax(!fw || fw <= w + 0.5 ? Infinity : Math.max(2, Math.floor((len * w) / fw) - 1))
      const row = floor && fw ? el.closest<HTMLElement>('[data-floor]') : null
      if (!row || !floor) return
      const room = Math.floor((len * w) / fw) // characters it has room for
      const need = Math.min(floor.chars, len)
      if (row.hasAttribute('data-tight') ? room >= need + floor.extra : room < need) requestAnimationFrame(() => row.toggleAttribute('data-tight', room < need)) // next frame: not inside the observer's own (a loop warning)
    }
    fit()
    midRo ??= new ResizeObserver(es => es.forEach(e => fits.get(e.target)?.()))
    fits.set(el, fit)
    midRo.observe(el)
    return () => (midRo!.unobserve(el), void fits.delete(el))
  }, [text])
  return (
    <span ref={box} className={`mid ${className}`} title={max !== Infinity && !tipped ? text : undefined /* the whole name, only when it's cut */}>
      <span ref={cut} className="mid-cut" aria-hidden>{midCut(text, max)}</span>
      <span ref={whole} className="mid-whole">{text}</span>
    </span>
  )
}

export function Elapsed({ since, usual }: { since: number; usual?: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((now - since) / 1000))
  return <span className={`elapsed ${usual && overUsual(s, usual) ? 'over' : ''}`}>{s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`}</span>
}

// seconds left until `to`, ticking
export function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="elapsed">{Math.max(0, Math.ceil((to - now) / 1000))} s</span>
}

// the turn timer (settings.timers): since the earliest turn going among these tabs
// B6: an empty page shows what it will hold: a few sample rows, faint, not for the screen reader or the pointer
// children: the page's own rows, drawn from sample items (inert: no click, no Tab stop); rows: a title and a line each,
// where a page has no row to borrow (My Desk's tiles are extensions)
export function Ghosts({ rows, children, className = '' }: { rows?: [string, string][]; children?: ReactNode; className?: string }) {
  return (
    <div className={`ghosts ${className}`} aria-hidden inert>
      {children ??
        rows?.map(([a, b]) => (
          <div key={a} className="ghost">
            <b>{a}</b>
            <span>{b}</span>
          </div>
        ))}
    </div>
  )
}

export function TurnTime({ tabs }: { tabs: { runAt?: number; usual?: number }[] }) {
  const since = Math.min(...tabs.map(t => t.runAt ?? Infinity))
  const first = tabs.find(t => t.runAt === since)
  return since < Infinity ? <Elapsed since={since} usual={first?.usual} /> : null
}

// a file Laki doesn't draw as text or a picture: audio and video play (src, the daemon's data URL); anything else, or
// one too big to play here, its kind and size with the ways to open it (the file preview's, the artifacts' big view)
export type FileAct = { label: string; icon: IconName; run: () => void; primary?: boolean }
// big: audio or video too big to play here, or (a string) why it won't play (else, with no src yet: still loading)
export function FileCard({ path, meta, media, src, big, acts }: { path: string; meta?: string; media?: string; src?: string; big?: boolean | string; acts: FileAct[] }) {
  const ext = /\.([^./]+)$/.exec(path)?.[1].toUpperCase() ?? 'File'
  return (
    <div className={`file-card ${src && media === 'video' ? 'video' : ''}`}>
      {src && media === 'video' ? <video controls preload="metadata" src={src} /> : <Icon name={media === 'audio' ? 'music' : media === 'video' ? 'film' : 'file'} size={30} />}
      <div className="file-card-name">{path.split('/').pop()}</div>
      <div className="muted small">
        {[ext, meta, media && !src ? (typeof big === 'string' ? big : big ? 'too big to play here' : 'loading…') : !media ? "Laki can't show this kind of file" : ''].filter(Boolean).join(' · ')}
      </div>
      {src && media === 'audio' && <audio controls preload="metadata" src={src} />}
      {acts.length > 0 && (
        <div className="file-card-acts">
          {acts.map(a => (
            <button key={a.label} className={`small ${a.primary ? 'primary' : ''}`} onClick={a.run}>
              <Icon name={a.icon} size={13} /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// an on/off switch: the status bar's auto toggles, Settings' options (a row: className="switch-row")
export function Switch({ on, onChange, tip, className = '', disabled, children }: { on?: boolean; onChange: (v: boolean) => void; tip?: string; className?: string; disabled?: boolean; children?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={children ? undefined : tip} className={`toggle ${on ? 'on' : ''} ${className}`} data-tip={tip} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      {children}
    </button>
  )
}

// ask: a yes/no question in the app's own dialog (confirm() is the OS's sheet), true on OK. AskHost, mounted once
// in App, shows it; a newer question covers the one before, which waits, first in line, and comes back as the newer one
// closes (#18: a covered tool ask was a deny). Esc or a click outside: no; Enter: the focused
// button (OK at first); its keys never reach what's under it, ⌘ shortcuts aside. choose: the same dialog with any
// buttons (a widget's modal), the index picked, -1 for none; check: a checkbox under the text, its on as it was left.
type Choice = { label: string; primary?: boolean; danger?: boolean }
type Check = { label: string; on: boolean }
type Field = { value: string; placeholder?: string; multi?: boolean } // multi: a text box (Enter a new line, ⌘⏎ OK)
// a line of ask's facts, under its text; icon: a name (Icon) or an emoji; tone: its icon's color (ok green, warn amber,
// bad red); chip: a pill before the value in that tone (a PR's Merged); pr: a PR's state (Info's prState: open, draft,
// merged, closed), its icon and chip in that state's color as everywhere else, over tone
export type Tone = 'ok' | 'warn' | 'bad'
export type Fact = { label: string; value: ReactNode; icon?: string; tone?: Tone; chip?: string; pr?: string } // value: words, or a few spans (a size's +/−)
export type Verdict = { tone: Tone; text: string } // a line over the facts: what it all comes to (Safe to delete…, Check first…)
type Asking = { n?: number; title: string; text?: string; verdict?: Verdict; facts?: Fact[]; buttons: Choice[]; check?: Check; field?: Field; done: (i: number) => void; tag?: string }
let asker: ((a: Asking) => void) | null = null
export const ask = (title: string, o: { text?: string; verdict?: Verdict; facts?: Fact[]; ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>(done =>
    asker ? asker({ title, text: o.text, verdict: o.verdict, facts: o.facts, buttons: [{ label: 'Cancel' }, { label: o.ok ?? 'OK', primary: true, danger: o.danger }], done: i => done(i === 1) }) : done(confirm([title, o.text].filter(Boolean).join(' '))),
  )
// one asked before AskHost is there (an extension's ask as the window opens) waits for it, not a no
let early: Asking[] = []
let asked = 0
export const choose = (title: string, text: string | undefined, buttons: Choice[], check?: Check, tag?: string, facts?: Fact[], verdict?: Verdict) => new Promise<number>(done => (a => (asker ? asker(a) : early.push(a)))({ title, text, verdict, facts, buttons, check, done, tag }))
// a line typed in the app's own dialog (an extension action's ask): the text, or null for Cancel, Esc or outside
export const askText = (title: string, o: { text?: string; ok?: string; placeholder?: string; value?: string; multi?: boolean } = {}) =>
  new Promise<string | null>(done => {
    const field: Field = { value: o.value ?? '', placeholder: o.placeholder, multi: o.multi }
    if (!asker) return done(null)
    asker({ title, text: o.text, field, buttons: [{ label: o.ok ?? 'OK', primary: true }, { label: 'Cancel' }], done: i => done(i === 0 ? field.value : null) })
  })
// unchoose: closes the dialog choose showed with that tag, waiting or on screen, as none (-1: answered elsewhere, a
// tool's notification) or as i (App's AWAY: a page opened over it)
let closer: ((tag: string, i: number) => void) | null = null
export const unchoose = (tag: string, i = -1) => ((early = early.filter(x => (x.tag === tag ? (x.done(i), false) : true))), closer?.(tag, i))

export function AskHost() {
  const [a, setA] = useState<Asking | null>(null)
  const [on, setOn] = useState(false) // check's
  const cur = useRef<{ a: Asking; back: Element | null } | null>(null)
  const waiting = useRef<Asking[]>([]) // ones a newer ask covered, the last covered first
  const box = useRef<HTMLDivElement>(null)
  const show = (next: Asking, back: Element | null) => {
    next.n ??= ++asked // its own dialog: a covered one back gets its own field, not the newer one's typing
    cur.current = { a: next, back }
    setOn(!!next.check?.on)
    setA(next)
  }
  const close = (i: number) => {
    const c = cur.current
    if (!c) return
    cur.current = null
    setA(null)
    c.a.done(i)
    const w = waiting.current.shift()
    const at = document.activeElement
    if (w) show(w, c.back) // the one it covered, back
    else if (c.back instanceof HTMLElement && (!at || at === document.body || box.current?.contains(at))) c.back.focus() // the terminal it came from, unless a page that opened over it has the keyboard
  }
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = e => {
    const area = !!document.activeElement?.matches('.ask-field textarea')
    if (cur.current && area && (e.metaKey || e.ctrlKey) && e.key === 'Enter') return (e.preventDefault(), e.stopImmediatePropagation(), close(cur.current.a.buttons.findIndex(b => b.primary))) // ⌘⏎ in its text box: OK
    if (!cur.current || e.metaKey || e.ctrlKey || e.altKey) return
    e.stopImmediatePropagation() // the keys are its: not App's, nor the page's under it (its Esc)
    if (document.activeElement?.matches('.ask-field input, .ask-field textarea') && !['Escape', ...(area ? [] : ['Enter']), 'Tab'].includes(e.key)) return // typing in it (a text box's Enter: a new line)
    e.preventDefault()
    const btns = [...(box.current?.querySelectorAll('button') ?? [])]
    const at = btns.indexOf(document.activeElement as HTMLButtonElement)
    const n = btns.length
    if (e.key === 'Escape') close(-1)
    else if (e.key === ' ' && document.activeElement?.matches('.ask-check input')) (document.activeElement as HTMLInputElement).click()
    else if (e.key === 'Enter') close(at >= 0 ? at : cur.current.a.buttons.findIndex(b => b.primary))
    else if (e.key === 'Tab') {
      const all = [...(box.current?.querySelectorAll<HTMLElement>('.ask-field input, .ask-field textarea, .ask-check input, button') ?? [])] // the checkbox too (Space toggles it)
      const i = all.indexOf(document.activeElement as HTMLElement)
      all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length]?.focus()
    } else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) btns[(at + (e.key === 'ArrowLeft' ? n - 1 : 1)) % n]?.focus()
  }
  useEffect(() => {
    asker = next => {
      if (cur.current) waiting.current.unshift(cur.current.a)
      show(next, cur.current?.back ?? document.activeElement)
    }
    closer = (t, i) => {
      waiting.current = waiting.current.filter(x => (x.tag === t ? (x.done(i), false) : true))
      if (cur.current?.a.tag === t) close(i)
    }
    early.splice(0).forEach(asker)
    const f = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', f, true) // before the terminal and the page under it
    return () => {
      asker = closer = null
      window.removeEventListener('keydown', f, true)
    }
  }, [])
  useEffect(() => void (el => (el?.focus(), el instanceof HTMLInputElement && el.select()))(box.current?.querySelector<HTMLElement>('.ask-field input, .ask-field textarea, button.primary')), [a]) // a line's value selected: typing replaces it (a rename)
  if (!a) return null
  return (
    <div className="overlay ask-overlay" onMouseDown={e => e.target === e.currentTarget && close(-1)}>
      <div key={a.n} className="modal ask-box" role="alertdialog" aria-modal aria-label={a.title} ref={box}>
        <div className="ask-title">{a.title}</div>
        {a.text && <p className="ask-text">{a.text}</p>}
        {a.verdict && (
          <div className={`ask-verdict ${a.verdict.tone}`} role="status">
            <Icon name={a.verdict.tone === 'ok' ? 'checkCircle' : a.verdict.tone === 'warn' ? 'alertCircle' : 'xCircle'} />
            <span>{a.verdict.text}</span>
          </div>
        )}
        {!!a.facts?.length && (
          <dl className="ask-facts">
            {a.facts.map(f => (
              <div key={f.label}>
                <dt className={f.pr ? `ask-pr ${f.pr}` : f.tone}>
                  {f.icon && (isIconName(f.icon) ? <Icon name={f.icon} /> : `${f.icon} `)}
                  {f.label}
                </dt>
                <dd>
                  {f.chip && <span className={`ask-chip ${f.pr ? `ask-pr ${f.pr}` : (f.tone ?? '')}`}>{f.chip}</span>}
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {a.field && (
          <label className="ask-field">
            {a.field.multi ? (
              <textarea defaultValue={a.field.value} placeholder={a.field.placeholder} rows={6} onChange={e => (a.field!.value = e.target.value)} />
            ) : (
              <input defaultValue={a.field.value} placeholder={a.field.placeholder} spellCheck={false} onChange={e => (a.field!.value = e.target.value)} />
            )}
          </label>
        )}
        {a.check && (
          <label className="ask-check">
            <input type="checkbox" checked={on} onChange={e => setOn((a.check!.on = e.target.checked))} /> {a.check.label}
          </label>
        )}
        <div className="ask-buttons">
          {a.buttons.map((b, i) => (
            <button key={i} className={`${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`} onClick={() => close(i)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// a page over the main area, as Settings is (the new-workspace form): its title, ✕ and Esc close it
// head: what the header shows in place of the title (the Specs page's breadcrumbs); tools: buttons before its ✕
// esc false: Esc doesn't close it (Workflows: a page you keep open while runs go)
// a settable hotkey is kept as keyLabel's text (shared/keys.ts: ⇧⌘C)
export const keyRec = { on: false } // Settings' KeyField is recording: App's keys stand aside (they'd run the combo)
export { keyLabel } from '../../shared/keys'

export const HOTKEY = '⌃⌥⌘L' // the global hotkey's keys (settings.hotkey unset)
export const SHOT_KEY = '⌃⌥⌘S' // Screenshot to Laki AI's (settings.shotKey unset)
export const QUICK_KEY = '⌥Space' // Q1: the quick bar's suggested keys (off until turned on: settings.quickOn)
export const TELL_KEY = '⌃⌥⌘T' // Q7: show and tell's suggested keys (off until turned on: settings.tellOn)
export const TALK_KEY = '⌃⌥⌘M' // Q2: the talk key's suggested keys (off until turned on: settings.talkOn)

// a resize edge's soft snap points while dragged (text.ts snap: within 8px; ⌥ held: none). Onto a point or off it, the
// edge jumps: html[data-glide] for the spring's 350 ms gives what it moves a width transition (styles.css), nil with
// Motion: Off or Reduce motion (their catch-alls), so the snap stays and the glide goes
let glideT = 0
let onPoint = false
export const snapStart = () => void (onPoint = false) // a drag begins: its first move onto a point glides, off one doesn't
export function snapped(px: number, total: number, points: number[], e: { altKey: boolean }): number {
  const to = e.altKey ? px : snap(px, total, points)
  if (to !== px === onPoint) return to
  onPoint = to !== px
  const html = document.documentElement
  html.dataset.glide = ''
  clearTimeout(glideT)
  glideT = window.setTimeout(() => delete html.dataset.glide, 350)
  return to
}

// an edge between two columns (the full review's, Notes'): dragged (to: the pointer's x in the columns' box), double-clicked back to its width
// init: that width, a snap point (arrow keys move without one)
export function Edge({ x, to, done, reset, init }: { x: { left: number } | { right: number }; to: (x: number, box: DOMRect) => void; done: () => void; reset: () => void; init: number }) {
  const held = (e: PE<HTMLDivElement>) => e.currentTarget.hasPointerCapture(e.pointerId)
  const r = 'right' in x
  return (
    <div
      className={`fr-edge ${r ? 'r' : ''}`}
      style={x}
      data-tip="Drag to resize · double-click to reset"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize: the left and right arrows, Enter to reset"
      tabIndex={0}
      onKeyDown={e => {
        // R13: by keyboard too: 16px a press (⇧: 64), Enter back to its width
        if (e.key === 'Enter') return reset()
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const at = e.currentTarget.getBoundingClientRect()
        to(at.left + (r ? at.width : 0) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 64 : 16), e.currentTarget.parentElement!.getBoundingClientRect())
        done()
      }}
      onPointerDown={e => (e.currentTarget.setPointerCapture(e.pointerId), e.preventDefault(), snapStart())}
      onPointerMove={e => {
        if (!held(e)) return
        const box = e.currentTarget.parentElement!.getBoundingClientRect()
        const w = snapped(r ? box.right - e.clientX : e.clientX - box.left, box.width, [init], e)
        to(r ? box.right - w : box.left + w, box)
      }}
      onLostPointerCapture={done}
      onDoubleClick={reset}
    />
  )
}

// a page's own list (Notes', Laki AI's chats): its head's sidebar button hides and shows it, kept per page
// (laki.pageSides), apart from the app's sidebar
export function usePageSide(page: string): [boolean, ReactNode] {
  const all = () => (m => (m && typeof m === 'object' ? (m as Record<string, boolean>) : {}))(load<unknown>('laki.pageSides', {}))
  const [shown, setShown] = useState(() => all()[page] !== false)
  const flip = () => (setShown(!shown), keep('laki.pageSides', { ...all(), [page]: !shown }))
  return [shown, <IconButton icon="sidebar" title={shown ? 'Hide the list' : 'Show the list'} className="page-side-btn" onClick={flip} />]
}

// a page over the main area (.settings-page: Page, Settings, Help): its frame (.main) counts them as data-pages, which
// the chrome look hides what's under one by (styles.css; a :has(> .settings-page) there restyled the whole window)
export function usePageMark() {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const m = el.current?.parentElement
    if (!m) return
    m.dataset.pages = String(Number(m.dataset.pages ?? 0) + 1)
    return () => void (Number(m.dataset.pages) > 1 ? (m.dataset.pages = String(Number(m.dataset.pages) - 1)) : delete m.dataset.pages)
  }, [])
  return el
}

export function Page({ title, head, tools, onClose, children, wide, esc = true, backdrop }: { title: string; head?: ReactNode; tools?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; esc?: boolean; backdrop?: ReactNode /* Backdrop.tsx's: behind the page's body */ }) {
  useEffect(() => {
    if (!esc) return
    const f = (e: KeyboardEvent) => escapes(e) && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose, esc])
  const [onScroll, toTop] = useToTop()
  const el = usePageMark()
  return (
    <div ref={el} className="settings-page" role="dialog" aria-label={title} onScrollCapture={onScroll}>
      <div className="settings-head edge-blur" onDoubleClick={titleDbl}>
        {head ?? <b>{title}</b>}
        <span className="grow" />
        {tools}
        <IconButton icon="x" title={esc ? 'Close (Esc)' : 'Close'} onClick={onClose} />
      </div>
      {(body => (backdrop ? <div className="page-frame">{backdrop}{body}</div> /* under the body, in its card (a chrome design's), never under the head */ : body))(<div className={`page-body ${wide ? 'wide' : ''}`}>{children}</div>)}
      {toTop}
    </div>
  )
}
// true once the element comes within a screen or so of sight, and then for good: what's costly to draw (a mermaid
// chart, a diagram) waits until it's scrolled to. Hidden (display: none, a closed <details>): never, until shown.
// scrollMargin: the page's own scroller would clip the margin away otherwise
export function useNear(): [(el: Element | null) => void, boolean] {
  const [el, setEl] = useState<Element | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!el || near) return
    const o = new IntersectionObserver(es => es.some(e => e.isIntersecting) && setNear(true), { rootMargin: '800px', scrollMargin: '800px' } as IntersectionObserverInit)
    o.observe(el)
    return () => o.disconnect()
  }, [el, near])
  return [setEl, near]
}
// a page scrolled well down (its body, or a list of its own): ↑ back to the top. Its frame takes onScroll (capture: a
// scroll doesn't bubble) and draws the button (Page, Settings, Help)
export function useToTop(): [(e: { target: EventTarget }) => void, ReactNode] {
  const [up, setUp] = useState<HTMLElement | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const onScroll = (e: { target: EventTarget }) => (el => el instanceof HTMLElement && el.scrollHeight - el.clientHeight > 400 && setUp(el.scrollTop > 400 ? el : null))(e.target)
  // at the scrolled list's own bottom right, not the frame's: a chat's thread ends above its composer (Laki AI's send
  // button was under it); again as it changes size (the composer grows). Rects are zoomed (Settings, Help), styles not
  useLayoutEffect(() => {
    const b = btn.current, box = b?.offsetParent
    if (!b || !up || !(box instanceof HTMLElement)) return
    const place = () => {
      const r = up.getBoundingClientRect(), o = box.getBoundingClientRect(), z = box.offsetWidth ? o.width / box.offsetWidth : 1
      b.style.bottom = `${Math.max(0, o.bottom - r.bottom) / z + 22}px`
      b.style.right = `${Math.max(0, o.right - r.right) / z + 24}px`
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(up)
    return () => ro.disconnect()
  }, [up])
  const button = up?.isConnected && (
    <button ref={btn} type="button" className="to-top" aria-label="Back to the top" data-tip="Back to the top" onClick={() => (up.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), setUp(null))}>
      <Icon name="arrowUp" size={15} />
    </button>
  )
  return [onScroll, button]
}

// What a throw while drawing leaves (React unmounts everything under the nearest boundary): a page's (title, onClose)
// keeps the rest of the window, the root's says so over it all; Reload (⌘R) loads the build again: a lazy page whose
// code is gone (a newer build behind remote access) needs it
export class Boundary extends Component<{ title?: string; onClose?: () => void; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('Laki:', error)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const body = (
      <div className="boom">
        <Icon name="alertCircle" size={22} />
        <b>{this.props.title ? `${this.props.title} couldn't open` : 'Laki hit an error'}</b>
        <span className="muted small">{error.message || String(error)}</span>
        <span className="muted small">Your agents keep running. Reload (⌘R) draws the window again.</span>
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>
            Reload
          </button>
          {this.props.onClose && <button onClick={() => (this.setState({ error: undefined }), this.props.onClose!())}>Close</button>}
        </div>
      </div>
    )
    return this.props.onClose ? (
      <Page title={this.props.title ?? 'Error'} onClose={this.props.onClose}>
        {body}
      </Page>
    ) : (
      <div className="boom-root">{body}</div>
    )
  }
}

// The daemon outlives the app, so after an update it can be an older one that lacks what this app asks of
// it. The status bar says so; restarting it (a second click to confirm) ends the agents, which resume.
export function StaleDaemon({ restart }: { restart: () => Promise<unknown> }) {
  const [step, setStep] = useState<'' | 'sure' | 'busy'>('')
  const [err, setErr] = useState('') // why it didn't restart: said, not swallowed
  useEffect(() => {
    if (!step) return
    const t = setTimeout(() => setStep(''), step === 'sure' ? 5000 : 15000) // busy: unless the new daemon answers first (this goes)
    return () => clearTimeout(t)
  }, [step])
  // a bar across the top of the main area: easy to miss in the status bar, and what's new fails until it's done
  return (
    <div className="stale-bar" role="alert">
      <Icon name="conflict" size={16} />
      <span>
        <b>Restart Laki's daemon.</b> It's older than this app, so what's new in it fails until it restarts. Every agent stops and resumes; a turn in
        progress is cut off.{err && <span className="stale-err"> It didn't restart: {err}</span>}
      </span>
      <button disabled={step === 'busy'} onClick={() => (step === 'sure' ? (setStep('busy'), setErr(''), restart().catch((e: Error) => (setStep(''), setErr(e.message)))) : setStep('sure'))}>
        {step === 'busy' ? 'Restarting…' : step === 'sure' ? 'Click again to restart' : 'Restart the daemon'}
      </button>
    </div>
  )
}

// tab colors, by name: CSS --tc-<name> in each app's theme
export { TAB_COLORS }
export const AGENT_COLORS: Record<string, string> = { claude: 'orange', codex: 'teal', gemini: 'blue', grok: 'purple', opencode: 'green' } // a tab's color unless it has its own; the new-workspace page's agent
export const colorVar = (c?: string) => (c && c !== 'none' ? ({ '--tab-c': `var(--tc-${c})` } as CSSProperties) : undefined)

// a project's own mark (projectSet's icon in its color, or its emoji, a line under it in the color); none set: or (the
// sidebar's kind icon), else nothing
export function ProjectMark({ p, size = 12, or }: { p?: { icon?: string; color?: string }; size?: number; or?: IconName }) {
  const i = p?.icon
  const e = emojiOf(i)
  const name = isIconName(i) ? i : or
  const l = useSyncExternalStore(onIconLook, iconLook) // an emoji as big as an icon would be
  if (!e && !name) return null
  return (
    <span className={`p-mark ${e ? 'emoji' : ''} ${p?.color ? 'tinted' : ''}`} style={{ ...colorVar(p?.color), ...(e && { fontSize: iconPx(size, l) }) }} aria-hidden>
      {e ?? <Icon name={name!} size={size} />}
    </span>
  )
}

// Icon… (a submenu: every icon by its words, arrowLeft: arrow left, for the filter, or an emoji typed or pasted into its
// box) and No icon once one is set: a Desk tab's, a project's
const ICON_NAMES = Object.keys(ICONS) as IconName[]
export const iconWords = (n: string) => n.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()
export const iconItems = (now: string | undefined, set: (icon?: string) => void): MenuItem[] => [
  {
    label: 'Icon…',
    icon: isIconName(now) ? now : 'star',
    items: [{ filter: 'Find an icon, or type an emoji', typed: q => (e => (e ? { label: `Use ${e}`, run: () => set(e) } : null))(emojiOf(q)) }, ...ICON_NAMES.map(n => ({ label: iconWords(n), icon: n, hint: now === n ? ON : undefined, run: () => set(n) }))],
  },
  {
    label: 'Emoji…',
    icon: 'smile',
    ...(emojiOf(now) && { hint: now }),
    items: [{ filter: 'Find an emoji: rocket, bug, fire…', typed: q => (e => (e ? { label: `Use ${e}`, run: () => set(e) } : null))(emojiOf(q)) }, { emojis: EMOJIS, value: now, pick: e => set(e) }],
  },
  ...(now ? [{ label: 'No icon', icon: 'x', run: () => set() } as MenuItem] : []),
]

// V18: rows that change place glide there (FLIP, flip.ts' flipMoves). useFlip: the [data-flip="<id>"] rows under ref, each placed against its closest `within` (a project's list, Needs
// you's cards: a project folding above doesn't move them). Each commit reads only their ids in order (no layout); a
// new order reads every row's place once, then animates the moved ones (translate, --t-spring on --spring, the two read
// once). Skipped: Motion: None or Reduce motion, a drag or swipe in it ([data-swiping]), a sidebar behind a page
// (data-away), a row coming in (.v-new). ponytail: the places kept are the last order's, so a row that grew since (an
// opened card) glides from a stale place once; getSnapshotBeforeUpdate would need a class component
export function useFlip(ref: { current: HTMLElement | null }, within: string) {
  const last = useRef({ order: '', at: new Map<string, number>() })
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const els = [...box.querySelectorAll<HTMLElement>('[data-flip]')]
    const order = els.map(el => el.dataset.flip).join()
    if (order === last.current.order) return
    const tops = new Map<Element, number>()
    const top = (el: Element) => tops.get(el) ?? (t => (tops.set(el, t), t))(el.getBoundingClientRect().top)
    const at = new Map(els.map(el => [el.dataset.flip!, top(el) - top(el.parentElement?.closest(within) ?? box)]))
    const was = last.current.at
    last.current = { order, at }
    const root = document.documentElement
    if (!was.size || root.dataset.motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches || box.closest('[data-away], [data-swiping]') || box.querySelector('[data-swiping]')) return
    const moves = flipMoves(was, at)
    if (!moves?.length) return
    const cs = getComputedStyle(root)
    const duration = parseFloat(cs.getPropertyValue('--t-spring')) || 600 // ms (styles.css' :root)
    const easing = cs.getPropertyValue('--spring').trim() || 'ease-out'
    const byId = new Map(els.map(el => [el.dataset.flip!, el]))
    for (const [id, dy] of moves) (el => el && !el.classList.contains('v-new') && el.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration, easing }))(byId.get(id))
  })
}

// a row dropped before or after another of its kind (and group: workspaces stay in their project)
// into: onto a group's head (data-head) from a row that isn't one: first in that group (after the head)
export type RowDrop = { kind: string; id: string; target: string; after: boolean; into?: boolean }

// rows ([data-row="<kind>:<id>"], optional data-group) dragged into a new order; `over` is where the
// pointer would drop, for an insertion line
export function useRowDrag(onDrop: (d: RowDrop) => void) {
  const [over, setOver] = useState<RowDrop | null>(null)
  const dragged = useRef(false)
  const done = useRef(onDrop)
  done.current = onDrop
  const start = (e: PE, kind: string, id: string, group = '', head = false) => {
    if (e.button !== 0) return
    const y0 = e.clientY
    const list = (e.currentTarget as Element).closest('.side-scroll') // the list it's in: it scrolls near (or past) its edges
    let cur: RowDrop | null = null
    let moved = false
    dragged.current = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 5) return
      if (!moved) list?.setAttribute('data-swiping', '') // useFlip waits it out
      moved = true
      document.getSelection()?.removeAllRanges()
      // near the list's top or bottom edge, or past it: it scrolls (ponytail: only as the pointer moves)
      const box = list?.getBoundingClientRect()
      if (box) list!.scrollBy(0, ev.clientY < box.top + 30 ? -12 : ev.clientY > box.bottom - 30 ? 12 : 0)
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(`[data-row^="${kind}:"]`)
      const target = el && (el.dataset.group ?? '') === group ? el.dataset.row!.slice(kind.length + 1) : ''
      const r = el?.getBoundingClientRect()
      // a group's head, for a row that isn't one: its top third is before it (the group above, or none), the rest into it
      const onHead = !head && el?.dataset.head !== undefined
      const into = onHead && !!r && ev.clientY > r.top + r.height / 3
      cur = target && target !== id && r ? { kind, id, target, after: into || (!onHead && ev.clientY > r.top + r.height / 2), into } : null
      setOver(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      list?.removeAttribute('data-swiping')
      setOver(null)
      dragged.current = moved // the click that ends a drag isn't one
      if (cur) done.current(cur)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // the class a row gets while something would drop next to it
  const at = (kind: string, id: string) => (over?.kind === kind && over.target === id ? (over.into ? 'drop-into' : over.after ? 'drop-after' : 'drop-before') : '')
  return { start, at, dragged: () => dragged.current }
}

// several ids (the sidebar's picked ones, in their order) moved next to d.target as one block; onto one of them: as they were
export const moveIds = (ids: string[], block: string[], d: RowDrop) => {
  if (!block.length || block.includes(d.target)) return ids
  const rest = ids.filter(x => !block.includes(x))
  rest.splice(rest.indexOf(d.target) + (d.after ? 1 : 0), 0, ...ids.filter(x => block.includes(x)))
  return rest
}
// ids with d.id, and the n - 1 after it (a folded sep's workspaces), moved next to d.target; onto itself: as they were
export const moveId = (ids: string[], d: RowDrop, n = 1) => {
  const block = ids.slice(Math.max(0, ids.indexOf(d.id)), ids.indexOf(d.id) + n)
  if (!block.length || block.includes(d.target)) return ids
  const rest = ids.filter(x => !block.includes(x))
  rest.splice(rest.indexOf(d.target) + (d.after ? 1 : 0), 0, ...block)
  return rest
}

// null is a separator, { head } a section title, { colors } a row of swatches (keys 0-8). An item's key
// runs it while the menu is open; without one it gets the first free initial of its label's words. indent: under the
// item before it (a project's groups); sub: a line under its label; pill: a tag at its end (tone: good green, warn
// yellow); mono: its label in the terminal's font; foot: in the menu's foot, under a line; mark: drawn in place of its icon
// (a project's ProjectMark).
// { filter } puts a box on top (its placeholder): what's typed keeps the items it matches, and keys are for the box
export const ON = '✓' // a menu item's hint: the one picked (its label in the accent, a check after it)
// a picture to the clipboard as a PNG, the one kind it takes: a JPEG, a GIF's first frame or an SVG drawn again as one
export async function copyImage(img: HTMLImageElement) {
  const c = document.createElement('canvas')
  ;[c.width, c.height] = [img.naturalWidth || img.width, img.naturalHeight || img.height]
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const png = new Promise<Blob>((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error("couldn't copy it"))), 'image/png'))
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
type ItemBase = { toggle?: boolean /* on or off: a switch at its end (a menuitemcheckbox) */; off?: boolean; label: string; icon?: IconName; mark?: ReactNode; hint?: string; key?: string; danger?: boolean; good?: boolean; indent?: boolean; sub?: string; pill?: string; tone?: 'good' | 'warn'; mono?: boolean; foot?: boolean; tip?: string; font?: string } // font: its label drawn in it (a CSS font-family: the font pickers')
export type MenuItem =
  | (ItemBase & { run: () => void; cmd?: () => void; items?: never }) // cmd: what a ⌘-click or ⌘⏎ does instead (the + menu's: a tab of its own)
  | (ItemBase & { items: MenuItem[]; run?: never }) // a submenu: hover, a click, → or ⏎ opens it beside
  | { head: string }
  | { filter: string; typed?: (q: string) => MenuItem } // typed: an item for what's typed itself, first (a Desk tab's emoji); null: none
  | { colors: string[]; value?: string; pick: (c: string) => void }
  | { emojis: [string, string][]; value?: string; pick: (e: string) => void } // a grid of them, each with the words a filter matches
  | null
type Act = Extract<MenuItem, { label: string }>
const isAct = (it: MenuItem): it is Act => !!it && 'label' in it


// beside: a submenu's, the item it opens from (no backdrop of its own; onBack: ← or Esc closes only it)
function Menu({ anchor, items: all, align, first, beside, onBack, onEnter, onClose, onBox }: { onBox?: (el: HTMLDivElement | null) => void; anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; first?: boolean; beside?: DOMRect; onBack?: () => void; onEnter?: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const filter = all.find(it => !!it && 'filter' in it) as Extract<MenuItem, { filter: string }> | undefined
  const [q, setQ] = useState('')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const typed = (q.trim() && filter?.typed?.(q.trim())) || null
  const grid = all.find(it => !!it && 'emojis' in it) as Extract<MenuItem, { emojis: unknown }> | undefined
  const gridShown = grid ? grid.emojis.filter(([, w]) => words.every(x => w.includes(x))) : []
  const shown = [...(typed ? [typed] : []), ...all.filter(it => it !== filter && (it === grid || !words.length || (isAct(it) && (it.foot || words.every(w => `${it.label} ${it.sub ?? ''}`.toLowerCase().includes(w))))))]
  const items = shown.filter(it => !isAct(it) || !it.foot)
  const foot = shown.filter((it): it is Act => isAct(it) && !!it.foot)
  const main = items.filter(isAct)
  const acts = [...main, ...foot]
  const keys = filter ? [] : menuKeys(acts) // with a box, letters are for it
  // ↑↓ moves it, ⏎ runs it; first: opened by a key, ⏎ runs the first; -2 (a filter's): the first whose label matches
  // what's typed (else the first match by its line; none: nothing, never a foot's), or the picked one while nothing is
  const [at, setSel] = useState(filter ? -2 : first ? 0 : -1)
  const best = words.length ? (i => (i >= 0 ? i : main.length ? 0 : -1))(main.findIndex(a => words.every(w => a.label.toLowerCase().includes(w)))) : Math.max(0, acts.findIndex(a => a.hint === ON))
  const sel = at === -2 ? best : at
  // what had the keyboard (the new-workspace form, for its ⌘⏎) gets it back as a filter's box goes, unless a pick moved it
  const back = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => () => void (filter && back.current?.isConnected && (!document.activeElement || document.activeElement === document.body) && back.current.focus()), [])
  // a submenu opens on a hover after a moment (a short one to switch, so a slant toward it doesn't close it)
  const [subOf, setSubOf] = useState<{ it: Act; at: DOMRect; anchor: DOMRect; first?: boolean } | null>(null)
  const wait = useRef(0)
  useEffect(() => () => clearTimeout(wait.current), [])
  const open = (it: Act, el: Element, first?: boolean) => {
    clearTimeout(wait.current)
    const at = el.getBoundingClientRect()
    setSubOf({ it, at, anchor: new DOMRect(at.right + 4, at.top - 10, 0, 0), first })
  }
  const hover = (it: Act, el: Element) => {
    clearTimeout(wait.current)
    if (subOf?.it !== it && (subOf || it.items)) wait.current = window.setTimeout(() => (it.items ? open(it, el) : setSubOf(null)), subOf ? 250 : 120)
  }
  // the safe triangle (text.ts inAim): with a submenu open, the mouse on its way there over the items between doesn't
  // move the highlight or close it; what it would have done waits till it leaves the triangle or rests 300 ms. Its
  // positions from this menu's own pointermoves (capture: before an item's); a touch skips it; the keys never wait
  const subBox = useRef<HTMLDivElement | null>(null)
  const aim = useRef<{ prev?: [number, number]; cur?: [number, number]; pending?: () => void; t?: number }>({})
  useEffect(() => () => clearTimeout(aim.current.t), [])
  const aiming = (p: [number, number]) => {
    const a = aim.current
    const el = subBox.current
    const from = a.cur && (a.cur[0] !== p[0] || a.cur[1] !== p[1]) ? a.cur : a.prev
    if (!subOf || !el || !from || !box.current) return false
    const r = el.getBoundingClientRect()
    return inAim(from, p, r, r.left >= box.current.getBoundingClientRect().right - 2 ? 'right' : 'left')
  }
  const guard = (e: { clientX: number; clientY: number; pointerType: string }, f: () => void) => {
    const a = aim.current
    if (e.pointerType === 'touch' || !aiming([e.clientX, e.clientY])) return void ((a.pending = undefined), clearTimeout(a.t), f())
    a.pending = f
    clearTimeout(a.t)
    a.t = window.setTimeout(() => (f => ((aim.current.pending = undefined), f?.()))(aim.current.pending), 300)
  }
  const track = (e: { clientX: number; clientY: number; pointerType: string }) => {
    const a = aim.current
    if (e.pointerType === 'touch') return
    a.prev = a.cur
    a.cur = [e.clientX, e.clientY]
    if (a.pending && !aiming(a.cur)) (f => ((a.pending = undefined), clearTimeout(a.t), f()))(a.pending)
  }
  const pick = (a: Act, el?: Element | null, first = true, meta = false) => {
    if (a.items) return el && open(a, el, first) // a key's: its first item picked
    onClose()
    const go = meta && a.cmd ? a.cmd : a.run
    go?.()
  }
  const elOf = (a: Act) => box.current?.querySelectorAll('.menu-item')[acts.indexOf(a)] ?? null
  const colors = items.find(it => !!it && 'colors' in it) as Extract<MenuItem, { colors: string[] }> | undefined
  // keys go to the menu while it's open (not to the terminal under it); ⌘ shortcuts still work
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = e => {
    if ((e.metaKey && e.key !== 'Enter') || e.ctrlKey || e.altKey || subOf) return // an open submenu has the keys; ⌘⏎ is a pick with ⌘
    if (filter && !['Escape', 'ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return // typed into the box
    if (filter && e.key === 'Escape' && q) return e.preventDefault(), e.stopPropagation(), setQ('') // Esc clears it first
    e.preventDefault()
    e.stopPropagation()
    const k = e.key.toLowerCase()
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && onBack)) (onBack ?? onClose)()
    else if (e.key === 'ArrowDown') setSel((sel + 1) % acts.length)
    else if (e.key === 'ArrowUp') setSel((sel <= 0 ? acts.length : sel) - 1)
    else if ((e.key === 'Enter' || (e.key === 'ArrowRight' && acts[sel]?.items)) && acts[sel]) pick(acts[sel], elOf(acts[sel]), true, e.metaKey)
    else if (e.key === 'Enter' && grid && gridShown.length) (onClose(), grid.pick(gridShown[0][0])) // the first emoji the filter left
    else if (colors && /^[0-9]$/.test(k) && +k <= colors.colors.length) {
      onClose()
      colors.pick(['none', ...colors.colors][+k])
    } else if (keys.includes(k)) pick(acts[keys.indexOf(k)], elOf(acts[keys.indexOf(k)]))
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])
  // V19: its items' stagger (styles.css) only as it opens: set before the first paint, gone after 250 ms
  useLayoutEffect(() => {
    const el = box.current
    el?.setAttribute('data-opening', '')
    const t = setTimeout(() => el?.removeAttribute('data-opening'), 250)
    return () => clearTimeout(t)
  }, [])
  // kept inside the window: flipped up or left when there's no room. Inside a zoomed page (Settings' size) a px of its
  // style is z of the window's: every place is the window's over z
  useLayoutEffect(() => {
    const el = box.current!
    const z = el.currentCSSZoom || 1
    const px = (n: number) => `${n / z}px`
    el.style.bottom = '' // another anchor: placed again
    el.style.top = px(anchor.bottom + 4)
    // the window's height, not CSS's 70vh: a workspace's menu scrolled its last items (Delete) out of sight; still too
    // tall, its rows packed and their lines under dropped (data-tight), then it scrolls
    el.style.maxHeight = px(window.innerHeight - 12)
    el.removeAttribute('data-tight')
    const list = el.querySelector<HTMLElement>('.menu-list')
    if (list && list.scrollHeight > list.clientHeight + 1) el.setAttribute('data-tight', '')
    if (align === 'left') (el.style.right = ''), (el.style.left = px(anchor.left)) // a flip before held it by the other edge
    else (el.style.left = ''), (el.style.right = px(window.innerWidth - anchor.right))
    const r = el.getBoundingClientRect()
    // above it, held by its bottom: a filter that shrinks it keeps it by the button
    if (r.bottom > window.innerHeight - 6) beside ? (el.style.top = px(Math.max(6, window.innerHeight - r.height - 6))) : anchor.top - r.height - 4 < 6 ? (el.style.top = px(6)) : ((el.style.top = 'auto'), (el.style.bottom = px(window.innerHeight - anchor.top + 4)))
    // held by its right edge: by the left one, its width as measured squeezed against the window's edge, it'd widen past it
    if (r.right > window.innerWidth - 6) (el.style.left = 'auto'), (el.style.right = px(beside ? window.innerWidth - beside.left + 4 : 6)) // a submenu: on the other side
    // where it grows from (styles.css' transform-origin, clamped to its box there): the button's middle, the pointer (a
    // right click's anchor is a point), a submenu's item on the side it touches; from the places set above, nothing read
    const [w, h, iw, ih] = [r.width, r.height, window.innerWidth, window.innerHeight]
    const top = r.bottom > ih - 6 ? (beside ? Math.max(6, ih - h - 6) : anchor.top - h - 4 < 6 ? 6 : anchor.top - 4 - h) : anchor.bottom + 4
    const flip = r.right > iw - 6
    const left = flip ? (beside ? beside.left - 4 - w : iw - 6 - w) : align === 'left' ? anchor.left : anchor.right - w
    const [x, y] = beside ? [flip ? beside.left : beside.right, (beside.top + beside.bottom) / 2] : [(anchor.left + anchor.right) / 2, (anchor.top + anchor.bottom) / 2]
    el.style.setProperty('--ox', px(x - left))
    el.style.setProperty('--oy', px(y - top))
  }, [anchor])
  const pos = align === 'left' ? { left: anchor.left } : { right: window.innerWidth - anchor.right }
  const menu = (
      <div className={`menu ${filter || all.some(it => isAct(it) && it.sub) ? 'rich' : ''}`} role="menu" ref={el => ((box.current = el), onBox?.(el))} style={{ top: anchor.bottom + 4, ...pos }} onPointerEnter={onEnter} onPointerMoveCapture={track}>
        {filter && <input className="menu-filter" value={q} placeholder={filter.filter} aria-label="Filter" spellCheck={false} autoFocus={!matchMedia('(pointer: coarse)').matches /* no keyboard popping up on a phone */} onChange={e => (setQ(e.target.value), setSel(-2))} />}
        <div className="menu-list">
          {items.map((it, i) =>
            !it ? (
              <div key={i} className="menu-sep" />
            ) : 'head' in it ? (
              <div key={i} className="menu-head">
                {it.head}
              </div>
            ) : 'emojis' in it ? (
              <div key={i} className="menu-emojis">
                {gridShown.map(([e, w]) => (
                  <button key={e} type="button" className={`menu-emoji ${e === it.value ? 'on' : ''}`} data-tip={w.split(' ')[0]} aria-label={w} onClick={() => (onClose(), it.pick(e))}>
                    {e}
                  </button>
                ))}
              </div>
            ) : 'colors' in it ? (
              <div key={i} className="menu-colors">
                {['none', ...it.colors].map((c, n) => (
                  <button
                    key={c}
                    className={`swatch ${c === (it.value ?? 'none') ? 'on' : ''}`}
                    style={colorVar(c)}
                    aria-label={c === 'none' ? 'No color' : c}
                    data-tip={`${c === 'none' ? 'No color' : c}${n <= 9 ? ` · ${n}` : ''}`}
                    onClick={() => {
                      onClose()
                      it.pick(c)
                    }}
                  />
                ))}
              </div>
            ) : (
              isAct(it) && item(it, i)
            ),
          )}
          {words.length > 0 && !main.length && !gridShown.length && <div className="menu-none">Nothing matches</div>}
          <ScrollEdge end />
        </div>
        {foot.length > 0 && <div className="menu-foot">{foot.map(item)}</div>}
      </div>
  )
  const sub = subOf && <Menu key={subOf.it.label} anchor={subOf.anchor} beside={subOf.at} items={subOf.it.items!} align="left" first={subOf.first} onBack={() => setSubOf(null)} onEnter={() => (clearTimeout(wait.current), clearTimeout(aim.current.t), (aim.current.pending = undefined))} onBox={el => (subBox.current = el)} onClose={onClose} />
  if (beside) return (
    <>
      {menu}
      {sub}
    </>
  )
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()} onContextMenu={e => (e.preventDefault(), onClose())}>
      {menu}
      {sub}
    </div>
  )
  function item(it: Act, i: number) {
    const on = it.hint === ON
    const long = !!it.hint && !on && String(it.hint).length > 12 // a path: it gives way, the label keeps its words
    return (
      <button
        key={i}
        role={it.toggle === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={it.toggle}
        aria-haspopup={it.items ? 'menu' : undefined}
        aria-expanded={it.items ? subOf?.it === it : undefined}
        className={`menu-item ${it.off ? 'off' : ''} ${it.danger ? 'danger' : ''} ${it.good ? 'good' : ''} ${it.indent ? 'indent' : ''} ${it.foot ? 'foot' : ''} ${on ? 'on' : ''} ${it.sub ? 'two' : ''} ${acts[sel] === it || subOf?.it === it ? 'sel' : ''}`}
        data-tip={it.tip}
        onClick={e => pick(it, e.currentTarget, e.detail === 0, e.metaKey)}
        onPointerEnter={e => (el => guard(e, () => hover(it, el)))(e.currentTarget)}
        onPointerMove={e => guard(e, () => setSel(acts.indexOf(it)))} // the one under the mouse is ⏎'s, as in a native menu
      >
        <span className="menu-icon">{it.mark ?? (it.icon && <Icon name={it.icon} />)}</span>
        <span className={`menu-text${long ? ' keep' : ''}`}>
          <span className={`menu-label ${it.mono ? 'mono' : ''}`}>
            <span style={it.font ? { fontFamily: it.font } : undefined}>{it.label}</span>
            {on && <Icon name="check" size={12} />}
          </span>
          {it.sub && <span className="menu-sub">{it.sub}</span>}
        </span>
        {it.hint && !on && <span className={`menu-hint${long ? ' long' : ''}`}>{it.hint}</span>}
        {it.pill && <span className={`menu-pill ${it.tone ?? ''}`}>{it.pill}</span>}
        {it.toggle !== undefined && (
          <span className={`toggle menu-toggle ${it.toggle ? 'on' : ''}`} aria-hidden>
            <span className="toggle-track">
              <span className="toggle-knob" />
            </span>
          </span>
        )}
        {keys[acts.indexOf(it)] && <kbd className="menu-key">{keys[acts.indexOf(it)]!.toUpperCase()}</kbd>}
        {it.items && <Icon name="chevronRight" size={12} />}
      </button>
    )
  }
}

// [the open menu (render it somewhere), open(event, items, align)]: under the clicked element, or at the
// pointer for a right click (contextmenu)
// a click opens it at its button; a rect: there (a menu whose items came after an await, the click's target gone)
// The open menu is the slot's state, not the caller's: opening or closing one draws the menu alone, not App (10 ms a
// time with 40 workspaces). The slot is one element for good, so the caller's renders pass it by.
type Opened = { anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; first?: boolean }
function MenuSlot({ to }: { to: { current: (m: Opened | null) => void } }) {
  const [m, setM] = useState<Opened | null>(null)
  to.current = setM
  return m && <Menu {...m} onClose={() => setM(null)} />
}
export function useMenu(): [ReactNode, (e: MouseEvent | DOMRect, items: MenuItem[], align?: 'left' | 'right') => void] {
  const to = useRef<(m: Opened | null) => void>(() => {})
  const [slot] = useState(() => <MenuSlot to={to} />)
  const setM = (m: Opened) => to.current(m)
  const open = (e: MouseEvent | DOMRect, items: MenuItem[], align: 'left' | 'right' = 'left') => {
    if (e instanceof DOMRect) return setM({ anchor: e, items, align })
    e.stopPropagation()
    e.preventDefault()
    const anchor = e.type === 'contextmenu' ? new DOMRect(e.clientX, e.clientY - 4, 0, 0) : (e.currentTarget as HTMLElement).getBoundingClientRect()
    setM({ anchor, items, align: e.type === 'contextmenu' ? 'left' : align, first: e.detail === 0 && e.type === 'click' }) // a key's click (⌘⇧N, Space): the first is picked
  }
  return [slot, open]
}

// tooltips for anything with data-tip, after a short hover (WebKit doesn't show title tooltips reliably). Warm, as
// macOS's: within a second of one going, the next shows at once and doesn't fade in (data-warm; text.ts tipDelay). The
// keyboard's focus (:focus-visible) shows its tip after TIP_FOCUS; any key, a press or leaving it hides it. An element
// with data-tip-card has its tip as a card (tipCard), its --tab-c color on the card's edge
const TIP_FOCUS = 600
export function Tips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; at: number; below: boolean; menu?: DOMRect; warm?: boolean; card?: boolean; color?: string } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // centered on the element, but kept inside the window (measured before it's painted); a menu item's beside its menu,
  // never over the items under it: on its left when there's room, else its right
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !tip) return
    const w = el.offsetWidth
    const m = tip.menu
    el.style.left = `${m ? (m.left - w - 8 >= 8 ? m.left - w - 8 : Math.min(m.right + 8, window.innerWidth - w - 8)) : Math.max(8, Math.min(tip.x - w / 2, window.innerWidth - w - 8))}px`
    // under its element, else above (a card taller than the room under it too), else centered on a menu item; kept in
    // the window. Set here each time: the element is reused from one tip to the next
    const h = el.offsetHeight
    let top = m ? tip.y - h / 2 : tip.below ? tip.y : tip.y - h
    if (!m && tip.below && top + h > window.innerHeight - 8) top = tip.at - 6 - h
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`
  }, [tip])
  useEffect(() => {
    let timer = 0
    let cur: HTMLElement | null = null
    let showing = false
    let byFocus = false // cur's tip is the keyboard focus's (focusout hides only that one: a pressed button's cur stays)
    let lastShown = -Infinity // when a tip was last on screen (performance.now()): the warm-up's
    const hide = () => {
      clearTimeout(timer)
      if (showing) lastShown = performance.now()
      showing = false
      byFocus = false
      cur = null
      setTip(null)
    }
    const show = (el: HTMLElement, warm: boolean) => {
      if (!el.isConnected || !el.dataset.tip) return
      const r = el.getBoundingClientRect()
      const menu = el.closest('.menu')?.getBoundingClientRect()
      showing = true
      if (menu) return setTip({ text: el.dataset.tip, x: 0, y: r.top + r.height / 2, at: r.top, below: true, menu, warm })
      const below = r.bottom + 30 < window.innerHeight
      const card = el.hasAttribute('data-tip-card')
      setTip({ text: el.dataset.tip, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, at: r.top, below, warm, card, color: (card && getComputedStyle(el).getPropertyValue('--tab-c').trim()) || undefined })
    }
    const after = (el: HTMLElement, ms: number) => {
      cur = el
      if (!ms) return show(el, true)
      timer = window.setTimeout(() => show(el, false), ms)
    }
    const over = (e: PointerEvent) => {
      // a view transition's picture is the root's: the pointer "leaves" a button under it and comes back as it ends, and
      // a rail button just pressed got its tip again, over the sidebar
      if (e.target === document.documentElement && document.documentElement.matches(':active-view-transition')) return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null
      if (el === cur) return
      hide()
      if (el?.dataset.tip) after(el, tipDelay(performance.now(), lastShown))
    }
    // the keyboard's focus: a Tab's keydown hid the last one first (keydown comes before the focus moves)
    const focusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el?.dataset?.tip || el === cur || !el.matches(':focus-visible') || el.matches('input, textarea, select, [contenteditable]')) return // a field: focused to type in (a key's, a page's own), its tip would cover it
      hide()
      after(el, TIP_FOCUS)
      byFocus = true
    }
    const focusOut = (e: FocusEvent) => void (byFocus && e.target === cur && hide())
    // pressed: none, and none again until the pointer leaves it (over its icon, a child, would start one: a menu it
    // opens would have the tip over its first item)
    const down = (e: PointerEvent) => (hide(), (cur = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null))
    window.addEventListener('pointerover', over)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', hide, true)
    window.addEventListener('focusin', focusIn)
    window.addEventListener('focusout', focusOut)
    return () => {
      hide()
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('focusin', focusIn)
      window.removeEventListener('focusout', focusOut)
    }
  }, [])
  if (!tip) return null
  return (
    <div className={`tip ${tip.menu ? 'side' : ''} ${tip.card ? 'tip-card' : ''}`} data-warm={tip.warm || undefined} ref={box} style={tip.color ? ({ '--tip-c': tip.color } as CSSProperties) : undefined}>
      {tip.card ? tipCard(tip.text) : tipText(tip.text)}
    </div>
  )
}
// a card tip (text.ts tipParts): its title with a dot in its color, "Label: value" rows in two columns (the label
// muted), a section's head between them (a split's tab), the foot (the hints, muted); Context's share at its end
// (… · 71%) in its level's color
export function tipCard(text: string) {
  const { title, lines, foot } = tipParts(text)
  return (
    <>
      {title && <div className="tip-title">{tipText(title)}</div>}
      {lines.length > 0 && (
        <div className="tip-rows">
          {lines.map((l, i) =>
            typeof l === 'string' ? (
              <span key={i} className="tip-head">
                {tipText(l)}
              </span>
            ) : (
              <Fragment key={i}>
                <span className="tip-k">{l[0]}</span>
                <span className="tip-v">{l[0] === 'Context' ? tipShare(l[1]) : tipText(l[1])}</span>
              </Fragment>
            ),
          )}
        </div>
      )}
      {foot && <div className="tip-foot">{tipText(foot)}</div>}
    </>
  )
}
const tipShare = (v: string) =>
  (m => (m ? <>{tipText(v.slice(0, m.index + 2))}<b className={`tip-pct ${+m[1] >= 90 ? 'high' : +m[1] >= 70 ? 'mid' : 'low'}`}>{m[1]}%</b></> : tipText(v)))(/· (\d{1,3})%$/.exec(v))
// Settings › Keys' keys in use (App sets it as it draws), for keyTip outside App: a tooltip's keys are never hard-coded
export const tipKeys: { map: Partial<Record<KeyId, string>> } = { map: {} }
export const keyTip = (title: string, id: KeyId) => (tipKeys.map[id] ? `${title} (${keyShow(tipKeys.map[id]!)})` : title)
// a tooltip's keys, "Settings (⌘,)", as keycaps (a modifier each, then the key), and a diff's +added −deleted in their
// colors (Review's tab, the status bar's changes, a row's stat…)
const KEYS_IN = /\(([⌃⌥⇧⌘]+[^\s()]{1,6})\)/
const tipText = (text: string) =>
  text.split(KEYS_IN).map((part, j) =>
    j % 2 ? (
      <span key={`k${j}`} className="tip-keys">
        {[...(part.match(/^[⌃⌥⇧⌘]+/)![0])].concat(part.replace(/^[⌃⌥⇧⌘]+/, '')).map((k, i) => <kbd key={i}>{k}</kbd>)}
      </span>
    ) : (
      part.split(/(\+\d[\d.,k]* −\d[\d.,k]*)/).map((s, i) => (i % 2 ? (([add, del]) => <span key={`${j}-${i}`} className="ws-stat"><span className="add">{add}</span> <span className="del">{del}</span></span>)(s.split(' ')) : s))
    ),
  )

// a number that slides to its new value: the old one out (up as it grows, down as it shrinks), the new one in, 250 ms
// on --spring (styles.css .num). None as it first draws, more than 3 changes in a second (it just swaps), Motion: None
// or the system's Reduce motion (styles.css). A string's first number tells which way ("3/7"); the moving copy is
// aria-hidden, so a screen reader reads the value once
const NUM_RATE = 3
export function Num({ value }: { value: number | string }) {
  const was = useRef(value)
  const times = useRef<number[]>([])
  const [out, setOut] = useState<{ text: number | string; dir: 'up' | 'down'; k: number } | null>(null)
  useEffect(() => {
    const old = was.current
    if (old === value) return
    was.current = value
    const now = Date.now()
    times.current = [...times.current.filter(t => now - t < 1000), now]
    if (times.current.length > NUM_RATE) return setOut(null)
    const n = (v: number | string) => Number(String(v).match(/-?\d+(\.\d+)?/)?.[0] ?? NaN)
    setOut({ text: old, dir: n(value) < n(old) ? 'down' : 'up', k: now })
    const t = setTimeout(() => setOut(null), 300)
    return () => clearTimeout(t)
  }, [value])
  return (
    <span className={`num-roll${out ? ` num-${out.dir}` : ''}`}>
      {out && <span key={`o${out.k}`} className="num-out" aria-hidden>{out.text}</span>}
      <span key={`i${out?.k ?? 0}`} className="num-in">{value}</span>
    </span>
  )
}

// the capsules' light (styles.css .capsule::after): one listener for the window, the capsule under the pointer lit
// where it is (--mx, --my, a frame at most), the one it left unlit
let lit: HTMLElement | null = null
let litAt: { x: number; y: number } | null = null
let litFrame = 0
if (typeof window !== 'undefined' && typeof document !== 'undefined')
  window.addEventListener(
    'pointermove',
    e => {
      litAt = { x: e.clientX, y: e.clientY }
      const over = (e.target as Element | null)?.closest?.('.capsule') as HTMLElement | null
      if (over !== lit) lit?.removeAttribute('data-lit'), (lit = over), over?.setAttribute('data-lit', '')
      if (!lit || litFrame) return
      litFrame = requestAnimationFrame(() => {
        litFrame = 0
        if (!lit || !litAt) return
        const r = lit.getBoundingClientRect()
        lit.style.setProperty('--mx', `${litAt.x - r.left}px`)
        lit.style.setProperty('--my', `${litAt.y - r.top}px`)
      })
    },
    { passive: true },
  )
if (typeof document !== 'undefined') document.documentElement?.addEventListener?.('pointerleave', () => (lit?.removeAttribute('data-lit'), (lit = null))) // out of the window: none lit

// in-window toasts (App's toast): a column at the bottom right, the front first (text.ts stackOrder: errors, then an
// Undo's, then the newest). More than two: stacked as macOS stacks notifications, the front whole, the next two
// behind it (smaller, lower, fainter), the rest kept but hidden and out of the keyboard's reach; the mouse on it or
// the keyboard in it opens the column, with Close all, and it closes 600 ms after. Each keeps its own timer (App's).
// A polite live region: each is read once as it comes. Motion: Off, the plain column
export type Toast = { id: number; at: number; text: string; undo?: () => void; label?: string; ok?: boolean; busy?: boolean; err?: boolean }
export function Toasts({ toasts, drop, Busy }: { toasts: Toast[]; drop: (id?: number) => void; Busy: ReactNode }) {
  const [open, setOpen] = useState(false)
  const shut = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = () => (clearTimeout(shut.current), setOpen(true))
  const hide = () => (clearTimeout(shut.current), (shut.current = setTimeout(() => setOpen(false), 600)))
  useEffect(() => () => clearTimeout(shut.current), [])
  const list = stackOrder(toasts)
  const stacked = list.length > 2 && !open && document.documentElement.dataset.motion !== 'none'
  if (!list.length) return null
  return (
    <div className={`toasts${stacked ? ' stacked' : ''}`} role="status" aria-live="polite" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={e => !e.currentTarget.contains(e.relatedTarget as Node) && hide()}>
      {list.map((t, i) => (
        <div key={t.id} className={`toast ${t.undo ? 'has-undo' : ''} ${t.ok || t.busy ? 'ok' : ''} ${t.err ? 'err' : ''}${stacked && i === 0 ? ' front' : ''}`} style={{ '--i': Math.min(i, 3) } as CSSProperties} inert={stacked && i > 0 ? true : undefined} role={t.err ? 'alert' : undefined /* an error interrupts, as before the stack */}>
          {t.ok && <Icon name="check" size={14} />}
          {t.busy && Busy}
          <span>{t.text}</span>
          {t.undo && (
            <button className="toast-undo" onClick={() => (drop(t.id), t.undo!())}>
              {t.label ?? 'Undo'}
            </button>
          )}
          {stacked && i === 0 && <span className="toast-count" aria-hidden="true">+{list.length - 1}</span>}
        </div>
      ))}
      {open && list.length > 1 && (
        <button type="button" className="toasts-close" onClick={() => (drop(), setOpen(false))}>
          Close all
        </button>
      )}
    </div>
  )
}
