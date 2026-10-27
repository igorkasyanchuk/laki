// The status bar's first item: a ring filled to the shortest limit (the 5-hour session) of the agents' plans, and its popup with every
// limit (the 5-hour session, the week, per model) and when each resets. The daemon reads them with the agents' own
// sign-in, at most every 5 minutes (usage.ts); Settings › Appearance picks the agents. Under them, today's tokens and
// their ≈ cost at API prices (the daemon's meters, View.today); and the words a tab's context and usage are said in.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from './ui'

import { type AgentUsage, HOME_ACCOUNT, type Today, type UsageWindow } from '../../shared/types'
export type { AgentUsage, UsageWindow } // a window's note: what the % is of, for an amount rather than a rate limit (extra usage): the ring leaves it out

// the agents whose plans have limits to read
export const USAGE_AGENTS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }
const NAMES = USAGE_AGENTS

// a window whose reset has passed starts over
const live = (w: UsageWindow, now: number) => (w.resets && w.resets <= now ? 0 : w.used)
export const level = (p: number) => (p >= 90 ? 'high' : p >= 70 ? 'mid' : 'low') // amber past 70%, red past 90%

// a tab's context (142K of 200K tokens · 71%) and what its chat used (≈ $0.42 · 1.2M tokens)
export const tokensText = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`)
export const ctxPct = (c: { used: number; max: number }) => Math.min(100, Math.round((c.used / c.max) * 100))
export const ctxText = (c: { used: number; max: number }) => `${tokensText(c.used)} of ${tokensText(c.max)} tokens · ${ctxPct(c)}%`
export const usageText = (u: { tokens: number; cost?: number }) => `${u.cost !== undefined ? `≈ $${u.cost.toFixed(2)} · ` : ''}${tokensText(u.tokens)} tokens`
// the ring's: the shortest window, which usage.ts lists first (Claude's 5-hour, Codex's primary)
const topOf = (r: AgentUsage, now: number) => {
  const w = r.windows.find(w => !w.note)
  return w && live(w, now)
}

// the account of an agent with clearly more room left in its shortest window: marked only 20 points past the next
export function mostRoom(rows: AgentUsage[], agent: string, now = Date.now()) {
  const left = rows.filter(r => r.agent === agent).map(r => [r.account ?? HOME_ACCOUNT, 100 - (topOf(r, now) ?? 100)] as const).sort((a, b) => b[1] - a[1])
  return left.length > 1 && left[0][1] - left[1][1] >= 20 ? left[0][0] : undefined
}

export function resetsIn(t: number, now: number) {
  const m = Math.max(1, Math.round((t - now) / 60_000))
  if (m < 60) return `in ${m}m`
  if (m < 24 * 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`
  return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function Ring({ p }: { p?: number }) {
  const r = 5.5
  const c = 2 * Math.PI * r
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className={`usage-ring ${p === undefined ? '' : level(p)}`} aria-hidden>
      <circle cx="7" cy="7" r={r} className="track" />
      {!!p && <circle cx="7" cy="7" r={r} className="fill" strokeDasharray={`${(Math.min(p, 100) / 100) * c} ${c}`} transform="rotate(-90 7 7)" />}
    </svg>
  )
}

// onUse: an account made the default for new sessions (the popup's Use); today: what was used today (none: hidden)
export function UsageButton({ load, onUse, today }: { load: () => Promise<AgentUsage[]>; onUse?: (agent: string, account: string) => void; today?: Spent }) {
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
  const used = rows.filter(r => r.default !== false) // the ring: each agent's default account (an older daemon's: its one)
  const tops = used.map(r => topOf(r, now))
  const known = tops.filter(p => p !== undefined)
  if (!known.length) return null // no agent has given a reading yet (a first run, signed out): no empty ring that looks like a spinner
  const top = Math.max(...known)
  const tip = `Plan limits · ${used.map((r, i) => `${nameOf(r, rows)} ${tops[i] === undefined ? '–' : `${tops[i]}%`}`).join(' · ')}`
  return (
    <>
      <button className="usage-btn" data-tip={tip} aria-label={tip} onClick={e => setAt(e.currentTarget.getBoundingClientRect())}>
        <Ring p={top} />
      </button>
      {at && <UsagePop anchor={at} rows={rows} top={top} today={today} onUse={onUse && ((a, id) => (onUse(a, id), setRows(r => r?.map(x => (x.agent === a ? { ...x, default: (x.account ?? HOME_ACCOUNT) === id } : x)) ?? r)))} onClose={() => setAt(null)} />}
    </>
  )
}

// an agent's name, and its account's when it has more than one
const nameOf = (r: AgentUsage, rows: AgentUsage[]) => [NAMES[r.agent] ?? r.agent, rows.filter(x => x.agent === r.agent).length > 1 && (r.account === HOME_ACCOUNT ? 'Default' : r.name)].filter(Boolean).join(' · ')

// today's, its workspaces by name
export type Spent = Omit<Today, 'ws'> & { ws: { name: string; tokens: number; cost: number }[] }

function UsagePop({ anchor, rows, top, today, onUse, onClose }: { anchor: DOMRect; rows: AgentUsage[]; top?: number; today?: Spent; onUse?: (agent: string, account: string) => void; onClose: () => void }) {
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
          <section key={`${r.agent}:${r.account ?? ''}`} className={`usage-agent${r.default === false ? ' other' : ''}`}>
            <div className="usage-name">
              <b>{nameOf(r, rows)}</b>
              {r.plan && <span className="muted">{r.plan[0].toUpperCase() + r.plan.slice(1)}</span>}
              <span className="grow" />
              {mostRoom(rows, r.agent, now) === (r.account ?? HOME_ACCOUNT) && <span className="tag tag-open">most room</span>}
              {rows.filter(x => x.agent === r.agent).length > 1 &&
                (r.default !== false ? (
                  <span className="tag" data-tip="New sessions start on it">default</span>
                ) : (
                  onUse && (
                    <button type="button" className="link small" data-tip="Make it the default for new sessions (running tabs keep theirs)" onClick={() => onUse(r.agent, r.account ?? HOME_ACCOUNT)}>
                      Use
                    </button>
                  )
                ))}
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
        {today && (
          <section className="usage-agent">
            <div className="usage-name">
              <b>Today {usageText({ tokens: today.tokens, cost: today.cost || undefined })}</b>
              <span className="grow" />
              <span className="tag" data-tip="What these tokens would cost at the API's list prices, from each chat's transcript: your plan bills its own way">
                ≈ API price
              </span>
            </div>
            {today.ws.map((w, i) => (
              <div key={i} className="usage-row usage-spent">
                <span className="usage-label">{w.name}</span>
                <span className="usage-pct">{w.cost ? `$${w.cost.toFixed(2)}` : ''}</span>
                <span className="muted small usage-when">{tokensText(w.tokens)} tokens</span>
              </div>
            ))}
          </section>
        )}
        <p className="muted small">
          Read {ago < 1 ? 'just now' : `${ago} min ago`} with each account's own sign-in, at most every 5 minutes. Settings › Agents & profiles has the accounts; Appearance picks the agents.
        </p>
      </div>
    </div>
  )
}
