// Small shared UI: line icons (16px, currentColor), icon buttons, tooltips, popup and context menus,
// rows dragged into a new order.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as PE, type ReactNode } from 'react'

const paths = {
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  diff: 'M8 2.5v5M5.5 5h5M5.5 12h5',
  run: 'M5 3l8 5-8 5z',
  ship: 'M8 10.5V2.5M4.5 6L8 2.5 11.5 6M3 13.5h10',
  fork: 'M5.8 3a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM12.8 3a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM9.3 13a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM4.5 4.3v1.2a2 2 0 002 2h3a2 2 0 002-2V4.3M8 7.5v4.2',
  archive: 'M2.5 3h11v3h-11zM3.5 6v7h9V6M6.5 9h3',
  restore: 'M3 8a5 5 0 105-5H5.5M5.5 1L3 3.2l2.5 2.3',
  trash: 'M2.5 4.5h11M6.5 4.5V2.5h3v2M4 4.5l.7 9h6.6l.7-9',
  search: 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.5 10.5L14 14',
  settings: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3',
  folder: 'M2 4.5h4l1.5 1.5H14v7H2z',
  folderPlus: 'M2 4.5h4l1.5 1.5H14v7H2zM8 8v3.5M6.25 9.75h3.5',
  server: 'M2.5 2.5h11v4.5h-11zM2.5 9h11v4.5h-11zM5 4.75h.01M5 11.25h.01',
  splitRight: 'M2.5 2.5h11v11h-11zM8 2.5v11',
  splitDown: 'M2.5 2.5h11v11h-11zM2.5 8h11',
  terminal: 'M2.5 2.5h11v11h-11zM5 6l2 2-2 2M8.5 10.5h2.5',
  agent: 'M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z',
  link: 'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4',
  sidebar: 'M2.5 3h11v10h-11zM6.5 3v10',
  code: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5',
  gear: 'M12.92 7.13L14.65 7.18 14.65 8.82 12.92 8.87 12.1 10.87 13.28 12.12 12.12 13.28 10.87 12.1 8.87 12.92 8.82 14.65 7.18 14.65 7.13 12.92 5.13 12.1 3.88 13.28 2.72 12.12 3.9 10.87 3.08 8.87 1.35 8.82 1.35 7.18 3.08 7.13 3.9 5.13 2.72 3.88 3.88 2.72 5.13 3.9 7.13 3.08 7.18 1.35 8.82 1.35 8.87 3.08 10.87 3.9 12.12 2.72 13.28 3.88 12.1 5.13zM10.2 8a2.2 2.2 0 11-4.4 0 2.2 2.2 0 014.4 0z',
  pencil: 'M10.5 2.5l3 3L6 13H3v-3z',
  unsplit: 'M2.5 2.5h4.5v11H2.5zM9 2.5h4.5v11H9z',
  info: 'M8 14a6 6 0 100-12 6 6 0 000 12zM8 7.2v4M8 4.9v.01',
  mic: 'M8 1.8a2 2 0 012 2v4a2 2 0 11-4 0v-4a2 2 0 012-2zM4 7.5a4 4 0 008 0M8 11.5v2.7M5.8 14.2h4.4',
  image: 'M2.5 3h11v10h-11zM2.5 11l3.2-3.2 2.6 2.6 1.7-1.7 3.5 3.5M10.5 6.2v.01',
  palette: 'M8 14a6 6 0 116-6c0 1.5-1.2 2.2-2.5 2.2H10a1.3 1.3 0 00-.9 2.2c.5.6.1 1.6-1.1 1.6zM5 7.5v.01M7 5v.01M10 5v.01',
  file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  filePlus: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3M8 7.5v4.5M5.75 9.75h4.5',
  import: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3M8 12.5V7.5M6 9.5l2-2 2 2',
  refresh: 'M13 8a5 5 0 11-1.6-3.7M13.2 2v2.8h-2.8',
  back: 'M10 3.5L5.5 8l4.5 4.5',
  forward: 'M6 3.5L10.5 8 6 12.5',
  arrowRight: 'M3 8h10M9 4l4 4-4 4',
  board: 'M2.5 2.5h3v8h-3zM6.5 2.5h3v11h-3zM10.5 2.5h3v5h-3z',
  pick: 'M8 13.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM8 1v3M8 12v3M1 8h3M12 8h3M8 8h.01',
  camera: 'M2.5 5h2.7l1.2-1.8h3.2L10.8 5h2.7v7.5h-11zM8 10.6a1.9 1.9 0 100-3.8 1.9 1.9 0 000 3.8z',
  collapse: 'M8 1.5v4M5.5 3.5L8 6l2.5-2.5M8 14.5v-4M5.5 12.5L8 10l2.5 2.5M2.5 8h11',
  changes: 'M4.5 5.6a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6zM11.5 13a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6zM4.5 5.6V10a2 2 0 002 2H9M11.5 10.4V6a2 2 0 00-2-2H7M8 10.5l1.5 1.5L8 13.5M8 2.5L6.5 4 8 5.5',
  review: 'M2.5 3h11v8H8l-3 2.5V11H2.5z',
  panel: 'M2.5 3h11v10h-11zM9.5 3v10',
  chevron: 'M4.5 6.5L8 10l3.5-3.5',
  chevronRight: 'M6.5 4.5L10 8l-3.5 3.5',
  stop: 'M4.5 4.5h7v7h-7z',
  globe: 'M8 14a6 6 0 100-12 6 6 0 000 12zM2 8h12M8 2c1.6 1.7 2.4 3.7 2.4 6S9.6 12.3 8 14M8 2C6.4 3.7 5.6 5.7 5.6 8s.8 4.3 2.4 6',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  bell: 'M4 11V7a4 4 0 018 0v4l1.5 1.5h-11zM6.5 13.5a1.5 1.5 0 003 0',
  pin: 'M5.5 2.5h5M6.5 2.5v4L4 9.5h8L9.5 6.5v-4M8 9.5v4',
  bellOff: 'M4 11V7a4 4 0 018 0v4l1.5 1.5h-11zM6.5 13.5a1.5 1.5 0 003 0M2.5 2.5l11 11',
  clock: 'M8 14a6 6 0 100-12 6 6 0 000 12zM8 4.7V8l2.3 1.5',
  unread: 'M8 11a3 3 0 100-6 3 3 0 000 6z',
  chevronUp: 'M4.5 9.5L8 6l3.5 3.5',
  timer: 'M8 14.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM8 6.5V9M6.5 1.5h3M8 1.5v2',
  sep: 'M2 8h2.5M6.75 8h2.5M11.5 8h2.5',
  youtube: 'M4.5 3.5h7a3 3 0 013 3v3a3 3 0 01-3 3h-7a3 3 0 01-3-3v-3a3 3 0 013-3zM6.8 6v4L10.2 8z',
  smile: 'M8 14a6 6 0 100-12 6 6 0 000 12zM5.6 9.4c.6.9 1.4 1.3 2.4 1.3s1.8-.4 2.4-1.3M6.2 6.4v.01M9.8 6.4v.01',
  race: 'M3.5 14V2.5M3.5 3h8.5l-2 2.75 2 2.75H3.5',
  conflict: 'M8 2.2l6.2 11H1.8zM8 6.6v3.2M8 11.6v.01',
  check: 'M3.5 8.5l3 3 6-7',
  help: 'M8 14a6 6 0 100-12 6 6 0 000 12zM6.2 6.3a1.9 1.9 0 113 1.5c-.7.5-1.2.9-1.2 1.7M8 11.2v.01',
  // GitHub's mark (Octicons, MIT), filled
  github:
    'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z',
  pr: 'M5.8 3a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM5.8 13a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM12.8 13a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM4.5 4.3v7.4M11.5 11.7V7.5a2 2 0 00-2-2H7M8.5 4L7 5.5 8.5 7',
}
export type IconName = keyof typeof paths

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 16 16" fill={name === 'github' ? 'currentColor' : 'none'} stroke={name === 'github' ? 'none' : 'currentColor'} strokeWidth={name === 'more' ? 2.4 : 1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name]} />
    </svg>
  )
}

// label: words beside the icon (the sidebar's foot)
export function IconButton({ icon, title, onClick, on, className = '', label }: { icon: IconName; title: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; on?: boolean; className?: string; label?: string }) {
  return (
    <button className={`ib ${on ? 'on' : ''} ${label ? 'labeled' : ''} ${className}`} data-tip={title} aria-label={title} onClick={onClick}>
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
export function Switch({ on, onChange, tip, className = '', children }: { on?: boolean; onChange: (v: boolean) => void; tip?: string; className?: string; children?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} className={`toggle ${on ? 'on' : ''} ${className}`} data-tip={tip} onClick={() => onChange(!on)}>
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      {children}
    </button>
  )
}

// ask: a yes/no question in the app's own dialog (confirm() is the OS's sheet), true on OK. AskHost, mounted once
// in App, shows it; a newer question answers the one before with no. Esc or a click outside: no; Enter: the focused
// button (OK at first); its keys never reach what's under it, ⌘ shortcuts aside.
type Asking = { title: string; text?: string; ok: string; danger?: boolean; done: (yes: boolean) => void }
let asker: ((a: Asking) => void) | null = null
export const ask = (title: string, o: { text?: string; ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>(done => (asker ? asker({ title, ok: 'OK', ...o, done }) : done(confirm([title, o.text].filter(Boolean).join(' ')))))

export function AskHost() {
  const [a, setA] = useState<Asking | null>(null)
  const cur = useRef<{ a: Asking; back: Element | null } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const close = (yes: boolean) => {
    const c = cur.current
    if (!c) return
    cur.current = null
    setA(null)
    c.a.done(yes)
    if (c.back instanceof HTMLElement) c.back.focus() // the terminal it came from
  }
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = e => {
    if (!cur.current || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    const btns = [...(box.current?.querySelectorAll('button') ?? [])]
    const at = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') close(false)
    else if (e.key === 'Enter') close(at !== 0)
    else if (['Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) btns[at === 0 ? 1 : 0]?.focus()
  }
  useEffect(() => {
    asker = next => {
      cur.current?.a.done(false)
      cur.current = { a: next, back: cur.current?.back ?? document.activeElement }
      setA(next)
    }
    const f = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', f, true) // before the terminal and the page under it
    return () => {
      asker = null
      window.removeEventListener('keydown', f, true)
    }
  }, [])
  useEffect(() => box.current?.querySelector<HTMLButtonElement>('button.primary')?.focus(), [a])
  if (!a) return null
  return (
    <div className="overlay ask-overlay" onMouseDown={e => e.target === e.currentTarget && close(false)}>
      <div className="modal ask-box" role="alertdialog" aria-modal aria-label={a.title} ref={box}>
        <div className="ask-title">{a.title}</div>
        {a.text && <p className="ask-text">{a.text}</p>}
        <div className="ask-buttons">
          <button onClick={() => close(false)}>Cancel</button>
          <button className={`primary ${a.danger ? 'danger' : ''}`} onClick={() => close(true)}>
            {a.ok}
          </button>
        </div>
      </div>
    </div>
  )
}

// a page over the main area, as Settings is (the new-workspace form): its title, ✕ and Esc close it
export function Page({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  return (
    <div className="settings-page" role="dialog" aria-label={title}>
      <div className="settings-head">
        <b>{title}</b>
        <span className="grow" />
        <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className={`page-body ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  )
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
  return (
    <button
      className="stale"
      disabled={step === 'busy'}
      data-tip="Laki's daemon is older than this app: newer things (like expose to the world) fail until it restarts. Restarting stops every agent and resumes it; a turn in progress is cut off."
      onClick={() => (step === 'sure' ? (setStep('busy'), restart().catch(() => setStep(''))) : setStep('sure'))}
    >
      {step === 'busy' ? 'restarting the daemon…' : step === 'sure' ? 'click again to restart it: agents resume' : 'daemon older than the app · restart'}
    </button>
  )
}

// tab colors, by name: CSS --tc-<name> in each app's theme
export const TAB_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
export const colorVar = (c?: string) => (c && c !== 'none' ? ({ '--tab-c': `var(--tc-${c})` } as CSSProperties) : undefined)

// a row dropped before or after another of its kind (and group: workspaces stay in their project)
export type RowDrop = { kind: string; id: string; target: string; after: boolean }

// rows ([data-row="<kind>:<id>"], optional data-group) dragged into a new order; `over` is where the
// pointer would drop, for an insertion line
export function useRowDrag(onDrop: (d: RowDrop) => void) {
  const [over, setOver] = useState<RowDrop | null>(null)
  const dragged = useRef(false)
  const done = useRef(onDrop)
  done.current = onDrop
  const start = (e: PE, kind: string, id: string, group = '') => {
    if (e.button !== 0) return
    const y0 = e.clientY
    let cur: RowDrop | null = null
    let moved = false
    dragged.current = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 5) return
      moved = true
      document.getSelection()?.removeAllRanges()
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(`[data-row^="${kind}:"]`)
      const target = el && (el.dataset.group ?? '') === group ? el.dataset.row!.slice(kind.length + 1) : ''
      const r = el?.getBoundingClientRect()
      cur = target && target !== id && r ? { kind, id, target, after: ev.clientY > r.top + r.height / 2 } : null
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
  const at = (kind: string, id: string) => (over?.kind === kind && over.target === id ? (over.after ? 'drop-after' : 'drop-before') : '')
  return { start, at, dragged: () => dragged.current }
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
// runs it while the menu is open; without one it gets the first free initial of its label's words.
export type MenuItem =
  | { label: string; icon?: IconName; hint?: string; key?: string; danger?: boolean; run: () => void }
  | { head: string }
  | { colors: string[]; value?: string; pick: (c: string) => void }
  | null
type Act = Extract<MenuItem, { run: () => void }>
const isAct = (it: MenuItem): it is Act => !!it && 'run' in it

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

function Menu({ anchor, items, align, onClose }: { anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const acts = items.filter(isAct)
  const keys = menuKeys(acts)
  const [sel, setSel] = useState(-1) // ↑↓ moves it, ⏎ runs it
  const pick = (a: Act) => {
    onClose()
    a.run()
  }
  const colors = items.find(it => !!it && 'colors' in it) as Extract<MenuItem, { colors: string[] }> | undefined
  // keys go to the menu while it's open (not to the terminal under it); ⌘ shortcuts still work
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') setSel(i => (i + 1) % acts.length)
    else if (e.key === 'ArrowUp') setSel(i => (i <= 0 ? acts.length : i) - 1)
    else if (e.key === 'Enter' && acts[sel]) pick(acts[sel])
    else if (colors && /^[0-9]$/.test(k) && +k <= colors.colors.length) {
      onClose()
      colors.pick(['none', ...colors.colors][+k])
    } else if (keys.includes(k)) pick(acts[keys.indexOf(k)])
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])
  // kept inside the window: flipped up or left when there's no room
  useLayoutEffect(() => {
    const el = box.current!
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight - 6) el.style.top = `${Math.max(6, anchor.top - r.height - 4)}px`
    if (r.right > window.innerWidth - 6) el.style.left = `${Math.max(6, window.innerWidth - r.width - 6)}px`
  }, [anchor])
  const pos = align === 'left' ? { left: anchor.left } : { right: window.innerWidth - anchor.right }
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()} onContextMenu={e => (e.preventDefault(), onClose())}>
      <div className="menu" role="menu" ref={box} style={{ top: anchor.bottom + 4, ...pos }}>
        {items.map((it, i) =>
          !it ? (
            <div key={i} className="menu-sep" />
          ) : 'head' in it ? (
            <div key={i} className="menu-head">
              {it.head}
            </div>
          ) : 'colors' in it ? (
            <div key={i} className="menu-colors">
              {['none', ...it.colors].map((c, n) => (
                <button
                  key={c}
                  className={`swatch ${c === (it.value ?? 'none') ? 'on' : ''}`}
                  style={colorVar(c)}
                  data-tip={`${c === 'none' ? 'No color' : c} · ${n}`}
                  onClick={() => {
                    onClose()
                    it.pick(c)
                  }}
                />
              ))}
            </div>
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`menu-item ${it.danger ? 'danger' : ''} ${acts[sel] === it ? 'sel' : ''}`}
              onClick={() => pick(it)}
              onPointerMove={() => setSel(-1)}
            >
              <span className="menu-icon">{it.icon && <Icon name={it.icon} />}</span>
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
              {keys[acts.indexOf(it)] && <kbd className="menu-key">{keys[acts.indexOf(it)]!.toUpperCase()}</kbd>}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

// [the open menu (render it somewhere), open(event, items, align)]: under the clicked element, or at the
// pointer for a right click (contextmenu)
export function useMenu(): [ReactNode, (e: MouseEvent, items: MenuItem[], align?: 'left' | 'right') => void] {
  const [m, setM] = useState<{ anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right' } | null>(null)
  const open = (e: MouseEvent, items: MenuItem[], align: 'left' | 'right' = 'left') => {
    e.stopPropagation()
    e.preventDefault()
    const anchor = e.type === 'contextmenu' ? new DOMRect(e.clientX, e.clientY - 4, 0, 0) : (e.currentTarget as HTMLElement).getBoundingClientRect()
    setM({ anchor, items, align: e.type === 'contextmenu' ? 'left' : align })
  }
  return [m && <Menu {...m} onClose={() => setM(null)} />, open]
}

// tooltips for anything with data-tip, after a short hover (WebKit doesn't show title tooltips reliably)
export function Tips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // centered on the element, but kept inside the window (measured before it's painted)
  useLayoutEffect(() => {
    const el = box.current
    if (el && tip) el.style.left = `${Math.max(8, Math.min(tip.x - el.offsetWidth / 2, window.innerWidth - el.offsetWidth - 8))}px`
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
        const below = r.bottom + 30 < window.innerHeight
        setTip({ text: el.dataset.tip!, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, 350)
    }
    window.addEventListener('pointerover', over)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('keydown', hide, true)
    return () => {
      hide()
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('keydown', hide, true)
    }
  }, [])
  if (!tip) return null
  return (
    <div className="tip" ref={box} style={{ top: tip.y, transform: tip.below ? undefined : 'translateY(-100%)' }}>
      {tip.text}
    </div>
  )
}
