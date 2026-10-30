// Small shared UI: line icons (16px, currentColor), icon buttons, tooltips, popup and context menus,
// rows dragged into a new order.
import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent as PE, type ReactNode } from 'react'
import { EMOJIS, emojiOf, ICONS, iconLook, type IconLook, type IconName, iconOf, iconPx, isIconName, onIconLook } from '../../shared/icons'
import { TAB_COLORS } from '../../shared/types'

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
export const escapes = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !e.isComposing

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
export function IconButton({ icon, title, onClick, on, className = '', label, tip = true, disabled, onContextMenu, keyId }: { icon: IconName; title: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; on?: boolean; className?: string; label?: string; tip?: boolean; disabled?: boolean; onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void; keyId?: string }) {
  return (
    <button className={`ib ${on ? 'on' : ''} ${label ? 'labeled' : ''} ${className}`} data-tip={tip ? title : undefined} data-key={keyId} aria-label={title} disabled={disabled} onClick={onClick} onContextMenu={onContextMenu}>
      <Icon name={icon} />
      {label && <span className="ib-label">{label}</span>}
    </button>
  )
}

// how long a turn has been going (since: the daemon's clock, a phone's may differ a little): 42s, 12m, 1h 5m
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((now - since) / 1000))
  return <span className="elapsed">{s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`}</span>
}

// the turn timer (settings.timers): since the earliest turn going among these tabs
export function TurnTime({ tabs }: { tabs: { runAt?: number }[] }) {
  const since = Math.min(...tabs.map(t => t.runAt ?? Infinity))
  return since < Infinity ? <Elapsed since={since} /> : null
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
export type Fact = { label: string; value: string; icon?: string } // a line of ask's facts, under its text; icon: a name (Icon) or an emoji
type Asking = { n?: number; title: string; text?: string; facts?: Fact[]; buttons: Choice[]; check?: Check; field?: Field; done: (i: number) => void; tag?: string }
let asker: ((a: Asking) => void) | null = null
export const ask = (title: string, o: { text?: string; facts?: Fact[]; ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>(done =>
    asker ? asker({ title, text: o.text, facts: o.facts, buttons: [{ label: 'Cancel' }, { label: o.ok ?? 'OK', primary: true, danger: o.danger }], done: i => done(i === 1) }) : done(confirm([title, o.text].filter(Boolean).join(' '))),
  )
// one asked before AskHost is there (an extension's ask as the window opens) waits for it, not a no
let early: Asking[] = []
let asked = 0
export const choose = (title: string, text: string | undefined, buttons: Choice[], check?: Check, tag?: string, facts?: Fact[]) => new Promise<number>(done => (a => (asker ? asker(a) : early.push(a)))({ title, text, facts, buttons, check, done, tag }))
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
  useEffect(() => box.current?.querySelector<HTMLElement>('.ask-field input, .ask-field textarea, button.primary')?.focus(), [a])
  if (!a) return null
  return (
    <div className="overlay ask-overlay" onMouseDown={e => e.target === e.currentTarget && close(-1)}>
      <div key={a.n} className="modal ask-box" role="alertdialog" aria-modal aria-label={a.title} ref={box}>
        <div className="ask-title">{a.title}</div>
        {a.text && <p className="ask-text">{a.text}</p>}
        {!!a.facts?.length && (
          <dl className="ask-facts">
            {a.facts.map(f => (
              <div key={f.label}>
                <dt>
                  {f.icon && (isIconName(f.icon) ? <Icon name={f.icon} /> : `${f.icon} `)}
                  {f.label}
                </dt>
                <dd>{f.value}</dd>
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

// an edge between two columns (the full review's, Notes'): dragged (to: the pointer's x in the columns' box), double-clicked back to its width
export function Edge({ x, to, done, reset }: { x: { left: number } | { right: number }; to: (x: number, box: DOMRect) => void; done: () => void; reset: () => void }) {
  const held = (e: PE<HTMLDivElement>) => e.currentTarget.hasPointerCapture(e.pointerId)
  return (
    <div
      className={`fr-edge ${'right' in x ? 'r' : ''}`}
      style={x}
      data-tip="Drag to resize · double-click to reset"
      onPointerDown={e => (e.currentTarget.setPointerCapture(e.pointerId), e.preventDefault())}
      onPointerMove={e => held(e) && to(e.clientX, e.currentTarget.parentElement!.getBoundingClientRect())}
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

export function Page({ title, head, tools, onClose, children, wide, esc = true }: { title: string; head?: ReactNode; tools?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; esc?: boolean }) {
  useEffect(() => {
    if (!esc) return
    const f = (e: KeyboardEvent) => escapes(e) && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose, esc])
  return (
    <div className="settings-page" role="dialog" aria-label={title}>
      <div className="settings-head">
        {head ?? <b>{title}</b>}
        <span className="grow" />
        {tools}
        <IconButton icon="x" title={esc ? 'Close (Esc)' : 'Close'} onClick={onClose} />
      </div>
      <div className={`page-body ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  )
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
        progress is cut off.
      </span>
      <button disabled={step === 'busy'} onClick={() => (step === 'sure' ? (setStep('busy'), restart().catch(() => setStep(''))) : setStep('sure'))}>
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
type ItemBase = { label: string; icon?: IconName; mark?: ReactNode; hint?: string; key?: string; danger?: boolean; indent?: boolean; sub?: string; pill?: string; tone?: 'good' | 'warn'; mono?: boolean; foot?: boolean; tip?: string }
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

// a key per item: its own, else a free initial of its words, else any free letter of its label
function menuKeys(acts: Act[]) {
  const used = new Set(acts.map(a => a.key?.toLowerCase()))
  return acts.map(a => {
    if (a.key) return a.key.toLowerCase()
    const l = a.label.toLowerCase()
    const k = [...l.split(/[^a-z0-9]+/).map(w => w[0]), ...l].find(c => c && /[a-z0-9]/.test(c) && !used.has(c))
    if (k) used.add(k)
    return k
  })
}

// beside: a submenu's, the item it opens from (no backdrop of its own; onBack: ← or Esc closes only it)
function Menu({ anchor, items: all, align, first, beside, onBack, onEnter, onClose }: { anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; first?: boolean; beside?: DOMRect; onBack?: () => void; onEnter?: () => void; onClose: () => void }) {
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
  // kept inside the window: flipped up or left when there's no room. Inside a zoomed page (Settings' size) a px of its
  // style is z of the window's: every place is the window's over z
  useLayoutEffect(() => {
    const el = box.current!
    const z = el.currentCSSZoom || 1
    const px = (n: number) => `${n / z}px`
    el.style.bottom = '' // another anchor: placed again
    el.style.top = px(anchor.bottom + 4)
    if (align === 'left') (el.style.right = ''), (el.style.left = px(anchor.left)) // a flip before held it by the other edge
    else (el.style.left = ''), (el.style.right = px(window.innerWidth - anchor.right))
    const r = el.getBoundingClientRect()
    // above it, held by its bottom: a filter that shrinks it keeps it by the button
    if (r.bottom > window.innerHeight - 6) beside ? (el.style.top = px(Math.max(6, window.innerHeight - r.height - 6))) : anchor.top - r.height - 4 < 6 ? (el.style.top = px(6)) : ((el.style.top = 'auto'), (el.style.bottom = px(window.innerHeight - anchor.top + 4)))
    // held by its right edge: by the left one, its width as measured squeezed against the window's edge, it'd widen past it
    if (r.right > window.innerWidth - 6) (el.style.left = 'auto'), (el.style.right = px(beside ? window.innerWidth - beside.left + 4 : 6)) // a submenu: on the other side
  }, [anchor])
  const pos = align === 'left' ? { left: anchor.left } : { right: window.innerWidth - anchor.right }
  const menu = (
      <div className={`menu ${filter || all.some(it => isAct(it) && it.sub) ? 'rich' : ''}`} role="menu" ref={box} style={{ top: anchor.bottom + 4, ...pos }} onPointerEnter={onEnter}>
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
        </div>
        {foot.length > 0 && <div className="menu-foot">{foot.map(item)}</div>}
      </div>
  )
  const sub = subOf && <Menu key={subOf.it.label} anchor={subOf.anchor} beside={subOf.at} items={subOf.it.items!} align="left" first={subOf.first} onBack={() => setSubOf(null)} onEnter={() => clearTimeout(wait.current)} onClose={onClose} />
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
    return (
      <button
        key={i}
        role="menuitem"
        aria-haspopup={it.items ? 'menu' : undefined}
        aria-expanded={it.items ? subOf?.it === it : undefined}
        className={`menu-item ${it.danger ? 'danger' : ''} ${it.indent ? 'indent' : ''} ${it.foot ? 'foot' : ''} ${on ? 'on' : ''} ${it.sub ? 'two' : ''} ${acts[sel] === it || subOf?.it === it ? 'sel' : ''}`}
        data-tip={it.tip}
        onClick={e => pick(it, e.currentTarget, e.detail === 0, e.metaKey)}
        onPointerEnter={e => hover(it, e.currentTarget)}
        onPointerMove={() => setSel(acts.indexOf(it))} // the one under the mouse is ⏎'s, as in a native menu
      >
        <span className="menu-icon">{it.mark ?? (it.icon && <Icon name={it.icon} />)}</span>
        <span className="menu-text">
          <span className={`menu-label ${it.mono ? 'mono' : ''}`}>
            <span>{it.label}</span>
            {on && <Icon name="check" size={12} />}
          </span>
          {it.sub && <span className="menu-sub">{it.sub}</span>}
        </span>
        {it.hint && !on && <span className="menu-hint">{it.hint}</span>}
        {it.pill && <span className={`menu-pill ${it.tone ?? ''}`}>{it.pill}</span>}
        {keys[acts.indexOf(it)] && <kbd className="menu-key">{keys[acts.indexOf(it)]!.toUpperCase()}</kbd>}
        {it.items && <Icon name="chevronRight" size={12} />}
      </button>
    )
  }
}

// [the open menu (render it somewhere), open(event, items, align)]: under the clicked element, or at the
// pointer for a right click (contextmenu)
// a click opens it at its button; a rect: there (a menu whose items came after an await, the click's target gone)
export function useMenu(): [ReactNode, (e: MouseEvent | DOMRect, items: MenuItem[], align?: 'left' | 'right') => void] {
  const [m, setM] = useState<{ anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; first?: boolean } | null>(null)
  const open = (e: MouseEvent | DOMRect, items: MenuItem[], align: 'left' | 'right' = 'left') => {
    if (e instanceof DOMRect) return setM({ anchor: e, items, align })
    e.stopPropagation()
    e.preventDefault()
    const anchor = e.type === 'contextmenu' ? new DOMRect(e.clientX, e.clientY - 4, 0, 0) : (e.currentTarget as HTMLElement).getBoundingClientRect()
    setM({ anchor, items, align: e.type === 'contextmenu' ? 'left' : align, first: e.detail === 0 && e.type === 'click' }) // a key's click (⌘⇧N, Space): the first is picked
  }
  return [m && <Menu {...m} onClose={() => setM(null)} />, open]
}

// tooltips for anything with data-tip, after a short hover (WebKit doesn't show title tooltips reliably)
export function Tips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean; menu?: DOMRect } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // centered on the element, but kept inside the window (measured before it's painted); a menu item's beside its menu,
  // never over the items under it: on its left when there's room, else its right
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !tip) return
    const w = el.offsetWidth
    const m = tip.menu
    el.style.left = `${m ? (m.left - w - 8 >= 8 ? m.left - w - 8 : Math.min(m.right + 8, window.innerWidth - w - 8)) : Math.max(8, Math.min(tip.x - w / 2, window.innerWidth - w - 8))}px`
  }, [tip])
  useEffect(() => {
    let timer = 0
    let cur: HTMLElement | null = null
    const hide = () => {
      clearTimeout(timer)
      cur = null
      setTip(null)
    }
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null
      if (el === cur) return
      hide()
      if (!el?.dataset.tip) return
      cur = el
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        const menu = el.closest('.menu')?.getBoundingClientRect()
        if (menu) return setTip({ text: el.dataset.tip!, x: 0, y: r.top + r.height / 2, below: true, menu })
        const below = r.bottom + 30 < window.innerHeight
        setTip({ text: el.dataset.tip!, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, 350)
    }
    // pressed: none, and none again until the pointer leaves it (over its icon, a child, would start one: a menu it
    // opens would have the tip over its first item)
    const down = (e: PointerEvent) => (hide(), (cur = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null))
    window.addEventListener('pointerover', over)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', hide, true)
    return () => {
      hide()
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', hide, true)
    }
  }, [])
  if (!tip) return null
  return (
    <div className={`tip ${tip.menu ? 'side' : ''}`} ref={box} style={{ top: tip.y, transform: tip.menu ? 'translateY(-50%)' : tip.below ? undefined : 'translateY(-100%)' }}>
      {tip.text}
    </div>
  )
}
