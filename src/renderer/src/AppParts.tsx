// App's parts that read nothing of App: Laki AI's glow and floating chat, the AI button's corner, remote access's
// PIN and passkey forms, the media queries App follows, a phone's key bar, the ask bar's choices
import { Choice, choiceProps, useSayWhy } from './Diff'
import { DARK, LESS_CLEAR, MORE_CONTRAST } from './themes'
import { choose, Icon, keep as store, load, unchoose } from './ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TabView } from '../../shared/types'
import { api, passkeyReady, passkeyUnlock } from './api'
import { askScope, optLabel } from '../../shared/ask'
import icon from './icon.svg'
import { Line } from './text'

// Laki AI's glow (experimental): a moving border and a soft inner light over the pane of the tab it looked at, else the
// whole window; once (its own animation's end clears it)
export function PeekGlow({ tab, onDone }: { tab?: string; onDone: () => void }) {
  const el = tab ? document.querySelector(`[data-pane="${CSS.escape(tab)}"]`) : null
  const r = el?.getBoundingClientRect() // ponytail: measured as it starts; a resize meanwhile leaves it where it was
  // seen: its middle or a corner is the pane's, not a page's or a panel's over it
  const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-pane]') === el
  const on = !!r?.width && !!r.height && [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].some(([fx, fy]) => at(r.left + r.width * fx, r.top + r.height * fy))
  return <div className={`ai-peek ${on ? '' : 'whole'}`} style={on ? { left: r!.left, top: r!.top, width: r!.width, height: r!.height } : undefined} onAnimationEnd={e => e.animationName === 'ai-peek' && onDone()} aria-hidden />
}
// the floating Laki AI chat, dragged by its head (not its buttons) anywhere over the main area, resized by its edges and
// corners; where it was left is laki.aiFloatAt (right and bottom, px), held inside the area as it changes size, and its
// size laki.aiFloatSize (CSS keeps it inside the area); a double-click on the head puts both back
type FloatAt = { right: number; bottom: number }
type FloatSize = { width: number; height: number }
const GRIPS = ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']


// the AI button keeps to the terminals' corner (--fab-r: what's right of them), so the file preview's and the side
// panel's last rows show; T7: and above what's docked at their bottom under it (--fab-b: a pane's strips, the ask bar:
// data-dock="bottom"). One ResizeObserver: the main area, the terminals and each pane's body (a strip that comes,
// grows or goes resizes it), its panes looked for again each time. Over a plain terminal with no chat open it fades
// (.far) while the pointer is over 120px away
export function FabCorner({ className, children }: { className: string; children: ReactNode }) {
  const at = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fab = at.current
    const main = fab?.parentElement
    const wrap = main?.querySelector('.term-wrap')
    if (!fab || !main || !wrap) return
    let mid = { x: 0, y: 0 }
    const watched = new Set<Element>()
    const set = () => {
      const m = main.getBoundingClientRect()
      fab.style.setProperty('--fab-r', `${Math.max(0, m.right - wrap.getBoundingClientRect().right)}px`)
      const f = fab.getBoundingClientRect()
      let b = 0
      for (const d of main.querySelectorAll('[data-dock="bottom"]')) {
        const r = d.getBoundingClientRect()
        if (r.height > 0 && r.left < f.right && r.right > f.left) b = Math.max(b, m.bottom - r.top)
      }
      fab.style.setProperty('--fab-b', `${Math.round(b)}px`)
      for (const p of main.querySelectorAll('.pane-body')) if (!watched.has(p)) watched.add(p), ro.observe(p)
      for (const p of watched) if (!p.isConnected) watched.delete(p), ro.unobserve(p)
      const g = fab.getBoundingClientRect()
      mid = { x: g.left + g.width / 2, y: g.top + g.height / 2 }
    }
    const ro = new ResizeObserver(set)
    ro.observe(wrap)
    ro.observe(main)
    let frame = 0
    let pt: { x: number; y: number } | null = null
    const fade = () => {
      frame = 0
      const far = !!pt && Math.hypot(pt.x - mid.x, pt.y - mid.y) > 120 && main.dataset.pages === undefined && !fab.querySelector('.ai-fab.on')
      fab.classList.toggle('far', far)
    }
    const move = (e: PointerEvent) => ((pt = { x: e.clientX, y: e.clientY }), frame || (frame = requestAnimationFrame(fade)))
    const leave = () => ((pt = { x: -1e4, y: -1e4 }), frame || (frame = requestAnimationFrame(fade)))
    main.addEventListener('pointermove', move, { passive: true })
    main.addEventListener('pointerleave', leave)
    return () => (ro.disconnect(), main.removeEventListener('pointermove', move), main.removeEventListener('pointerleave', leave), cancelAnimationFrame(frame))
  }, [])
  return (
    <div className={className} ref={at}>
      {children}
    </div>
  )
}

export function AiFloat({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<FloatAt | null>(() => load<FloatAt | null>('laki.aiFloatAt', null))
  const [size, setSize] = useState<FloatSize | null>(() => load<FloatSize | null>('laki.aiFloatSize', null))
  const now = useRef({ at, size })
  now.current = { at, size }
  const [moving, setMoving] = useState('') // moving, or sizing-<grip>: the cursor everywhere meanwhile
  // 8px inside its area at least, so its head stays in reach
  const fit = (p: FloatAt): FloatAt => {
    const el = box.current
    const area = el?.offsetParent as HTMLElement | null
    if (!el || !area) return p
    const keep = (v: number, max: number) => Math.round(Math.max(8, Math.min(v, max - 8)))
    return { right: keep(p.right, area.clientWidth - el.offsetWidth), bottom: keep(p.bottom, area.clientHeight - el.offsetHeight) }
  }
  useLayoutEffect(() => {
    const area = box.current?.offsetParent
    if (!area) return
    const ro = new ResizeObserver(() => setAt(a => (a ? fit(a) : a)))
    ro.observe(area)
    return () => ro.disconnect()
  }, [])
  const head = (e: { target: EventTarget }) => {
    const t = e.target as Element
    return !!t.closest('.ai-win-head') && !t.closest('button, a, input, select, textarea')
  }
  // a drag: its moves and release come here even over a frame or outside the window; then where it is, and its size, kept
  const track = (e: React.PointerEvent, how: string, move: (m: PointerEvent, area: DOMRect, r: DOMRect) => void) => {
    const el = box.current
    if (e.button !== 0 || !el?.offsetParent) return
    e.preventDefault() // no text selected on the way
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const area = (el.offsetParent as HTMLElement).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const go = (m: PointerEvent) => (setMoving(how), move(m, area, r))
    const up = () => {
      window.removeEventListener('pointermove', go)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setMoving('')
      if (now.current.at) store('laki.aiFloatAt', now.current.at)
      if (now.current.size) store('laki.aiFloatSize', now.current.size)
    }
    window.addEventListener('pointermove', go)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const onHead = useRef(false) // the press was on the head: a double-click's target is the box itself (the pointer was captured)
  const down = (e: React.PointerEvent) =>
    (onHead.current = head(e)) &&
    track(e, 'moving', (m, area, r) => setAt(fit({ right: area.right - r.right - (m.clientX - e.clientX), bottom: area.bottom - r.bottom - (m.clientY - e.clientY) })))
  // an edge or a corner: its far side stays where it is
  const grab = (e: React.PointerEvent, g: string) =>
    (onHead.current = false) ||
    track(e, `sizing-${g}`, (m, area, r) => {
      const dx = m.clientX - e.clientX
      const dy = m.clientY - e.clientY
      const keep = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(v, hi)))
      const w = g.includes('l') ? keep(r.width - dx, 320, r.right - area.left - 8) : g.includes('r') ? keep(r.width + dx, 320, area.right - r.left - 8) : r.width
      const h = g.includes('t') ? keep(r.height - dy, 280, r.bottom - area.top - 8) : g.includes('b') ? keep(r.height + dy, 280, area.bottom - r.top - 8) : r.height
      setSize({ width: Math.round(w), height: Math.round(h) })
      if (g.includes('r') || g.includes('b')) setAt({ right: Math.round(area.right - r.right - (g.includes('r') ? w - r.width : 0)), bottom: Math.round(area.bottom - r.bottom - (g.includes('b') ? h - r.height : 0)) })
    })
  const reset = () => onHead.current && (setAt(null), setSize(null), store('laki.aiFloatAt', undefined), store('laki.aiFloatSize', undefined))
  return (
    <div ref={box} className={`ai-float ${moving}`} style={{ ...at, ...size }} onPointerDown={down} onDoubleClick={reset}>
      {children}
      {GRIPS.map(g => (
        <div key={g} className={`ai-grip ${g}`} onPointerDown={e => grab(e, g)} aria-hidden />
      ))}
    </div>
  )
}

// remote access's page, with Laki's PIN: the code shown in Settings › Remote access on the Mac (api.pin); a wrong one
// counts down, the last stops remote access. One solid card (styles.css' .pin-*): Laki's mark, a lock in a ring that
// fills a sixth per digit, the PIN in six boxes over one input (paste, one-time-code autofill), sent as the sixth digit
// is typed; a wrong one shakes them, a right one turns the ring green with a check while the socket opens. Unlock is
// always a button: short of six digits it says so
const PIN_LEN = 6 // remote.ts' PIN
// D6: a passkey device's page, locked (each page load, and after its idle minutes): Face ID or Touch ID, or the PIN
// instead (pin: Settings allows it)
export function UnlockForm({ pin }: { pin: boolean }) {
  const [usePin, setUsePin] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => passkeyReady('passkeyChallenge'), []) // its challenge before the tap (api.ts: Safari's)
  if (usePin) return <PinForm unlock onPin={code => api.call('passkeyPin', { pin: code })} />
  const go = () => {
    if (busy) return
    setBusy(true)
    setErr('')
    passkeyUnlock().then(
      () => setBusy(false),
      e => (setBusy(false), passkeyReady('passkeyChallenge'), setErr(/NotAllowed|cancel/i.test(String(e?.name ?? e?.message)) ? 'Not unlocked: try again' : String(e?.message ?? e))),
    )
  }
  return (
    <div className="pin-card">
      <div className="pin-brand">
        <img src={icon} alt="" />
        <b>Laki</b>
        <span className="pin-tag">
          <Icon name="globe" size={11} /> Remote access
        </span>
      </div>
      <div className="pin-ring" aria-hidden>
        <span>
          <Icon name="fingerprint" size={22} />
        </span>
      </div>
      <h1>Unlock Laki</h1>
      <p className="pin-say">This device unlocks with its passkey: Face ID, Touch ID or its code.</p>
      <button type="button" className="pin-go" autoFocus onClick={go} disabled={busy}>
        {busy ? (
          <>
            <span className="btn-spin" /> Waiting for you…
          </>
        ) : (
          <>
            Unlock <Icon name="arrowRight" size={15} />
          </>
        )}
      </button>
      <div className="pin-foot">
        {err ? <span className="pin-err" role="alert">{err}</span> : <span>Your Mac, through a private link</span>}
        {pin && (
          <button type="button" className="link small" onClick={() => setUsePin(true)}>
            Use PIN instead
          </button>
        )}
      </div>
    </div>
  )
}
// what a notification shows whole, so its buttons may answer it: one short line of plain ASCII words, single spaces
// between (macOS shows about two lines: a newline, a run of spaces or wide glyphs would push a tail out of sight; 40 of
// its widest letter still fit)
export const shownWhole = (t: string) => t.length <= 40 && /^[!-~]+(?: [!-~]+)*$/.test(t)
export function PinForm({ left, onPin, unlock }: { left?: number; onPin?: (code: string) => Promise<unknown>; unlock?: boolean }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false) // the PIN was right: the socket opens next
  const [over, setOver] = useState(false) // stopped: nothing more to try here
  const [shake, setShake] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const send = (c = code) => {
    if (busy || over || ok) return
    if (c.length < PIN_LEN) return void (setErr(`Type all ${PIN_LEN} digits`), setShake(true), box.current?.focus())
    setBusy(true)
    setErr('')
    const go = onPin ?? ((x: string) => api.pin(x))
    go(c).then(
      () => (setOk(true), setBusy(false)), // the socket opens next (or the splash says why not)
      e => (setErr((e as Error).message), setCode(''), setShake(true), /stopped/.test((e as Error).message) && setOver(true), setBusy(false), box.current?.focus()),
    )
  }
  const type = (v: string) => {
    const c = v.normalize('NFKC').replace(/\D/g, '').slice(0, PIN_LEN)
    setCode(c)
    if (err && c) setErr('')
    if (c.length === PIN_LEN) send(c) // all of it: in at once
  }
  const filled = ok ? PIN_LEN : code.length
  return (
    <form className={`pin-card ${ok ? 'ok' : ''} ${over ? 'over' : ''}`} onSubmit={e => (e.preventDefault(), send())}>
      <div className="pin-brand">
        <img src={icon} alt="" />
        <b>Laki</b>
        <span className="pin-tag">
          <Icon name="globe" size={11} /> Remote access
        </span>
      </div>
      <div className="pin-ring" aria-hidden>
        <svg viewBox="0 0 64 64">
          <circle className="pin-track" cx="32" cy="32" r="29" />
          <circle className="pin-fill" cx="32" cy="32" r="29" pathLength={100} style={{ strokeDashoffset: 100 - (filled / PIN_LEN) * 100 }} />
        </svg>
        <span key={ok ? 'ok' : over ? 'over' : 'lock'}>
          <Icon name={ok ? 'check' : over ? 'shieldAlert' : 'lock'} size={22} />
        </span>
      </div>
      <h1>{ok ? 'Unlocked' : over ? 'Remote access stopped' : 'Enter your PIN'}</h1>
      <label htmlFor="pin" className="pin-say">
        {ok ? 'Opening Laki…' : over ? 'Start it again on your Mac for a new link.' : 'The six digits Laki shows on your Mac, in Settings › Remote access.'}
      </label>
      <div className={`pin-boxes ${shake ? 'shake' : ''} ${err && !ok ? 'bad' : ''}`} onAnimationEnd={e => e.target === e.currentTarget && setShake(false)}>
        <input ref={box} id="pin" value={code} autoFocus disabled={over || ok} readOnly={busy} inputMode="numeric" autoComplete="one-time-code" aria-invalid={!!err} /* readOnly, not disabled: it keeps the keyboard for the next try */ onChange={e => type(e.target.value)} />
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <span key={i} className={`pin-box ${i < code.length ? 'full' : ''} ${i === code.length ? 'at' : ''}`} aria-hidden>
            {code[i] ?? ''}
          </span>
        ))}
      </div>
      <button type="submit" className={`pin-go ${code.length < PIN_LEN && !busy && !ok ? 'short' : ''}`} disabled={over}>
        {ok || busy ? (
          <>
            <span className="btn-spin" /> {ok ? 'Opening Laki' : 'Checking…'}
          </>
        ) : (
          <>
            Unlock <Icon name="arrowRight" size={15} />
          </>
        )}
      </button>
      <div className="pin-foot">
        {err ? (
          <span className="pin-err" role="alert">
            {err}
          </span>
        ) : (
          <span>{ok ? 'Your Mac, through a private link' : left === undefined || unlock ? 'Paste works too' : left === 1 ? 'One wrong PIN stops remote access' : `${left} wrong PINs stop remote access`}</span>
        )}
      </div>
    </form>
  )
}

// a media query's answer, kept current (useSyncExternalStore): a phone's narrow layout, a touch screen's keys
const media = (q: string) => {
  const m = matchMedia(q)
  return { on: (f: () => void) => (m.addEventListener('change', f), () => m.removeEventListener('change', f)), now: () => m.matches }
}
export const NARROW = media('(max-width: 640px)') // under the app window's minWidth (700): phones and narrow browsers only
export const SMALL = media('(max-width: 480px)') // a phone held upright: the drawer takes the whole width
export const TOUCH = media('(pointer: coarse)')
export const LESS = media(LESS_CLEAR) // macOS's Reduce transparency and Increase contrast: applyTheme reads them, App repaints
export const MORE = media(MORE_CONTRAST)
export const SYS_DARK = media(DARK)

// keys a phone's keyboard lacks, typed into the focused pane (claude and codex ask with arrows, Esc, ⇧⇥)
const KEYS: [string, string][] = [['esc', '\x1b'], ['tab', '\t'], ['⇧tab', '\x1b[Z'], ['^C', '\x03'], ['←', '\x1b[D'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['→', '\x1b[C'], ['⏎', '\r']]
// a press that doesn't take the focus: the terminal keeps it, and the phone its keyboard
const keep = (e: { preventDefault(): void }) => e.preventDefault()
export function KeyBar({ onKey }: { onKey: (data: string) => void }) {
  const typing = () => {
    const ta = document.querySelector<HTMLTextAreaElement>('.pane.active .xterm-helper-textarea')
    if (ta && document.activeElement === ta) ta.blur()
    else ta?.focus()
  }
  return (
    <div className="keybar">
      <button onPointerDown={keep} onMouseDown={keep} onClick={typing} aria-label="Keyboard">
        ⌨
      </button>
      {KEYS.map(([k, data]) => (
        <button key={k} onPointerDown={keep} onMouseDown={keep} onClick={() => onKey(data)}>
          {k}
        </button>
      ))}
    </div>
  )
}

// the ask bar's choices (the daemon moves and presses ⏎), with No, and say why (Diff.tsx useSayWhy)
export function BarChoices({ tab, answer }: { tab: TabView; answer: (n: number, label: string, say?: string) => void }) {
  const why = useSayWhy(tab.ask, answer)
  return (
    <span className="ask-choices" onKeyDown={why.key}>
      {tab.ask!.options.map(o => {
        const label = optLabel(tab.ask!, o)
        const scoped = askScope(label, tab.preset) // a standing permission: never cut, its rule on a line of its own
        return (
          <button key={o.n} className={o.n === tab.ask!.options[0].n ? 'primary' : ''} data-tip={why.no?.n === o.n ? '⌥-click, a long press or N: say why' : scoped ? undefined : o.label} {...choiceProps(label, tab.preset)} {...why.on(o)}>
            {scoped ? <Choice text={label} agent={tab.preset} n={`${o.n}. `} /> : `${o.n}. ${label.length > 48 ? `${label.slice(0, 46)}…` : label}`}
          </button>
        )
      })}
      {why.box}
    </span>
  )
}

// an extension tool's asks: one dialog at a time, the others in line (tagged by req); toolOn: the one on screen
export type ToolAsk = { req: string; title: string; text: string; picks: { label: string; allow: 'once' | 'always' | 'deny' }[]; answer: (allow: string) => void }
export const toolLine = new Line<ToolAsk>()
export let toolOn: string | undefined
export const AWAY = -2 // #18: a page or dialog opened over the ask on screen: it waits, first in line, and comes back as that closes
export function toolShow() {
  const t = toolLine.first
  if (!t || toolOn === t.req) return
  if (toolOn) return unchoose(toolOn) // another came first (a notification's click): this one back in line, its then shows it
  toolOn = t.req
  void choose(t.title, t.text, t.picks.map((p, i) => ({ label: p.label, primary: i === 0, danger: p.allow === 'deny' })), undefined, t.req).then(i => {
    toolOn = undefined
    if (i === AWAY) return // App's effect on its dialog shows it again
    // Esc, Deny or outside denies the one on screen only; one answered elsewhere (toolDone) or moved back: just the next
    if (toolLine.first === t) toolLine.drop(t.req), t.answer(t.picks[i]?.allow ?? 'deny')
    toolShow()
  })
}
