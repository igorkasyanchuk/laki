// The status bar's first item: a ring filled to the most-used limit of the agents' plans, and its popup with every
// limit (the 5-hour session, the week, per model) and when each resets. The daemon reads them with the agents' own
// sign-in, at most every 5 minutes (usage.ts); Settings › General picks the agents.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from './ui'

// note: what the % is of, for an amount rather than a rate limit (extra usage): the ring leaves it out
export type UsageWindow = { label: string; used: number; resets?: number; note?: string }
export type AgentUsage = { agent: string; plan?: string; windows: UsageWindow[]; error?: string; at: number }

// the agents whose plans have limits to read
export const USAGE_AGENTS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }
const NAMES = USAGE_AGENTS

// a window whose reset has passed starts over
const live = (w: UsageWindow, now: number) => (w.resets && w.resets <= now ? 0 : w.used)
const level = (p: number) => (p >= 90 ? 'high' : p >= 70 ? 'mid' : 'low')
const topOf = (r: AgentUsage, now: number) => {
  const ps = r.windows.filter(w => !w.note).map(w => live(w, now))
  return ps.length ? Math.max(...ps) : undefined
}

export function resetsIn(t: number, now: number) {
  const m = Math.max(1, Math.round((t - now) / 60_000))
  if (m < 60) return `in ${m}m`
  if (m < 24 * 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`
  return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function Ring({ p }: { p?: number }) {
  const r = 5.5
  const c = 2 * Math.PI * r
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className={`usage-ring ${p === undefined ? '' : level(p)}`} aria-hidden>
      <circle cx="7" cy="7" r={r} className="track" />
      {!!p && <circle cx="7" cy="7" r={r} className="fill" strokeDasharray={`${(Math.min(p, 100) / 100) * c} ${c}`} transform="rotate(-90 7 7)" />}
    </svg>
  )
}

export function UsageButton({ load }: { load: () => Promise<AgentUsage[]> }) {
  const [rows, setRows] = useState<AgentUsage[] | null>(null)
  const [at, setAt] = useState<DOMRect | null>(null)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let on = true
    // an older daemon has no usage: no ring; a failed ask (the daemon restarting) keeps the last answer
    const get = () => loader.current().then(r => on && setRows(r), () => {})
    get()
    const t = setInterval(get, 60_000) // cheap: the daemon asks the servers at most every 5 minutes
    return () => {
      on = false
      clearInterval(t)
    }
  }, [])
  if (!rows?.length) return null
  const now = Date.now()
  const tops = rows.map(r => topOf(r, now))
  const known = tops.filter(p => p !== undefined)
  const top = known.length ? Math.max(...known) : undefined
  const tip = `Plan limits · ${rows.map((r, i) => `${NAMES[r.agent] ?? r.agent} ${tops[i] === undefined ? '–' : `${tops[i]}%`}`).join(' · ')}`
  return (
    <>
      <button className="usage-btn" data-tip={tip} aria-label={tip} onClick={e => setAt(e.currentTarget.getBoundingClientRect())}>
        <Ring p={top} />
      </button>
      {at && <UsagePop anchor={at} rows={rows} top={top} onClose={() => setAt(null)} />}
    </>
  )
}

function UsagePop({ anchor, rows, top, onClose }: { anchor: DOMRect; rows: AgentUsage[]; top?: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), onClose())
    window.addEventListener('keydown', f, true) // before the terminal under it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])
  // above the status bar, kept inside the window
  useLayoutEffect(() => {
    const el = box.current!
    el.style.left = `${Math.max(8, Math.min(anchor.left - 8, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.bottom = `${window.innerHeight - anchor.top + 6}px`
  })
  const now = Date.now()
  const ago = Math.round((now - Math.min(...rows.map(r => r.at))) / 60_000)
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="tunnel-pop usage-pop" ref={box} role="dialog" aria-label="Plan limits">
        <div className="tunnel-head">
          <Ring p={top} />
          <b>Plan limits</b>
          <span className="grow" />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        {rows.map(r => (
          <section key={r.agent} className="usage-agent">
            <div className="usage-name">
              <b>{NAMES[r.agent] ?? r.agent}</b>
              {r.plan && <span className="muted">{r.plan[0].toUpperCase() + r.plan.slice(1)}</span>}
            </div>
            {r.windows.map(w => {
              const p = live(w, now)
              return (
                <div key={w.label} className="usage-row">
                  <span className="usage-label">{w.label}</span>
                  <span className={`usage-bar ${level(p)}`}>
                    <i style={{ width: `${Math.min(p, 100)}%` }} />
                  </span>
                  <span className="usage-pct">{p}%</span>
                  <span className="muted small usage-when">{w.note ?? (w.resets ? (w.resets <= now ? 'reset since' : `resets ${resetsIn(w.resets, now)}`) : '')}</span>
                </div>
              )
            })}
            {r.error && <p className="muted small">{r.error}</p>}
          </section>
        ))}
        <p className="muted small">
          Read {ago < 1 ? 'just now' : `${ago} min ago`} with each agent's own sign-in, at most every 5 minutes. Settings › General picks the agents.
        </p>
      </div>
    </div>
  )
}
