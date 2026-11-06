// The status bar's first item: a ring filled to the shortest limit (the 5-hour session) of the agents' plans, and its popup with every
// limit (the 5-hour session, the week, per model) and when each resets. The daemon reads them with the agents' own
// sign-in, at most every 5 minutes (usage.ts); Settings › Appearance picks the agents. Under them, today's tokens and
// their ≈ cost at API prices (the daemon's meters, View.today); and the words a tab's context and usage are said in.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton, Page } from './ui'

import { type AgentUsage, HOME_ACCOUNT, type Today, type UsageWindow } from '../../shared/types'
export type { AgentUsage, UsageWindow } // a window's note: what the % is of, for an amount rather than a rate limit (extra usage): the ring leaves it out

// the agents whose plans have limits to read
export const USAGE_AGENTS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }
// Gemini's windows are its models' quotas: the models its tabs use first (the ring's is the first), the rest under More
const byUse = (r: AgentUsage, models: string[]) => (r.agent !== 'gemini' ? r : { ...r, windows: [...r.windows].sort((a, b) => Number(!models.some(m => a.label.startsWith(m))) - Number(!models.some(m => b.label.startsWith(m)))) })
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

const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// told to wait (a 429): whose numbers these are, and when it asks again
const waitText = (r: AgentUsage, now: number) =>
  `${r.error}${r.windows.length ? `, so these are from ${hm(r.at)}` : ''}. ${r.next! > now ? `Checks again at ${hm(r.next!)}` : 'Checks again soon'}.`

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
export function UsageButton({ load, onUse, onDays, today, models = [] }: { load: () => Promise<AgentUsage[]>; onUse?: (agent: string, account: string) => void; onDays?: () => void; today?: Spent; models?: string[] }) {
  const [got, setRows] = useState<AgentUsage[] | null>(null)
  const rows = got && got.map(r => byUse(r, models)) // models: what the Gemini tabs use
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
      {at && <UsagePop anchor={at} rows={rows} top={top} today={today} onDays={onDays} onUse={onUse && ((a, id) => (onUse(a, id), setRows(r => r?.map(x => (x.agent === a ? { ...x, default: (x.account ?? HOME_ACCOUNT) === id } : x)) ?? r)))} onClose={() => setAt(null)} />}
    </>
  )
}

// an agent's name, and its account's when it has more than one
const nameOf = (r: AgentUsage, rows: AgentUsage[]) => [NAMES[r.agent] ?? r.agent, rows.filter(x => x.agent === r.agent).length > 1 && (r.account === HOME_ACCOUNT ? 'Default' : r.name)].filter(Boolean).join(' · ')

// today's, its workspaces by name
export type Spent = Omit<Today, 'ws'> & { ws: { name: string; tokens: number; cost: number }[] }

const MODELS_SHOWN = 2 // Gemini's: the first (its tabs' models), the rest under More
function windowRow(w: UsageWindow, now: number) {
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
}

function UsagePop({ anchor, rows, top, today, onUse, onDays, onClose }: { anchor: DOMRect; rows: AgentUsage[]; top?: number; today?: Spent; onUse?: (agent: string, account: string) => void; onDays?: () => void; onClose: () => void }) {
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
            {(r.agent === 'gemini' ? r.windows.slice(0, MODELS_SHOWN) : r.windows).map(w => windowRow(w, now))}
            {r.agent === 'gemini' && r.windows.length > MODELS_SHOWN && (
              <details className="usage-more">
                <summary className="muted small">More ({r.windows.length - MODELS_SHOWN})</summary>
                {r.windows.slice(MODELS_SHOWN).map(w => windowRow(w, now))}
              </details>
            )}
            {r.error && <p className="muted small">{r.next ? waitText(r, now) : r.error}</p>}
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
              {onDays && (
                <button type="button" className="link small" onClick={() => (onClose(), onDays())}>
                  By day and model
                </button>
              )}
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
          Read {ago < 1 ? 'just now' : `${ago} min ago`} with each account's own sign-in: Claude's every 7.5 minutes, Codex's every 5. Settings › Agents & profiles has the accounts; Appearance picks the agents.
        </p>
      </div>
    </div>
  )
}

// the Usage page (the popup's Today › By day and model, ⌘K): what Laki's claude and codex tabs used each day, at the
// API's list prices, from their transcripts (the daemon's usageDays: USAGE_KEEP days back), for one agent or model or all;
// a bar a day, then each model's share. Single series in the accent: the filters pick what it is
export type UsageDay = { day: string; agent: string; model: string; tokens: number; cost: number }
const RANGES = [7, 30, 90]
const dayKey = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
const money = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString()}`
export function UsagePage({ load, onClose }: { load: () => Promise<{ keep: number; rows: UsageDay[] }>; onClose: () => void }) {
  const [d, setD] = useState<{ keep: number; rows: UsageDay[] } | null>(null)
  const [err, setErr] = useState('')
  const [range, setRange] = useState(30)
  const [agent, setAgent] = useState('')
  const [model, setModel] = useState('')
  const [by, setBy] = useState<'cost' | 'tokens'>('cost')
  useEffect(() => void load().then(setD, e => setErr(String(e?.message ?? e))), [])
  const days = Array.from({ length: range }, (_, i) => (t => dayKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (range - 1 - i))))(new Date())) // by the calendar: a DST day is still one
  const inRange = (d?.rows ?? []).filter(r => r.day >= days[0])
  const agents = [...new Set(inRange.map(r => r.agent))]
  const models = [...new Set(inRange.filter(r => !agent || r.agent === agent).map(r => r.model))].sort()
  const rows = inRange.filter(r => (!agent || r.agent === agent) && (!model || r.model === model))
  const per = new Map(days.map(k => [k, { tokens: 0, cost: 0 }]))
  for (const r of rows) (x => x && ((x.tokens += r.tokens), (x.cost += r.cost)))(per.get(r.day))
  const total = { tokens: rows.reduce((n, r) => n + r.tokens, 0), cost: rows.reduce((n, r) => n + r.cost, 0) }
  const top = Math.max(...[...per.values()].map(x => x[by]), 0)
  const byModel = [...rows.reduce((m, r) => (x => ((x.tokens += r.tokens), (x.cost += r.cost), m))(m.get(`${r.agent}|${r.model}`) ?? (m.set(`${r.agent}|${r.model}`, { agent: r.agent, model: r.model, tokens: 0, cost: 0 }), m.get(`${r.agent}|${r.model}`)!)), new Map<string, { agent: string; model: string; tokens: number; cost: number }>()).values()].sort((a, b) => b[by] - a[by])
  const show = (x: { tokens: number; cost: number }) => (by === 'cost' ? money(x.cost) : `${tokensText(x.tokens)} tokens`)
  const label = (k: string) => new Date(`${k}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const active = [...per.values()].filter(x => x.tokens > 0).length
  return (
    <Page title="Usage" onClose={onClose} wide>
      <div className="usage-page">
        <div className="usage-filters" role="toolbar" aria-label="Filters">
          <span className="seg">
            {RANGES.filter(n => n <= (d?.keep ?? 90)).map(n => (
              <button key={n} className={range === n ? 'on' : ''} onClick={() => setRange(n)}>
                {n} days
              </button>
            ))}
          </span>
          <span className="seg">
            {['', ...agents].map(a => (
              <button key={a} className={agent === a ? 'on' : ''} onClick={() => (setAgent(a), setModel(''))}>
                {a ? (NAMES[a] ?? a) : 'All agents'}
              </button>
            ))}
          </span>
          <select value={model} aria-label="Model" onChange={e => setModel(e.target.value)}>
            <option value="">All models</option>
            {models.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="grow" />
          <span className="seg">
            <button className={by === 'cost' ? 'on' : ''} onClick={() => setBy('cost')}>$</button>
            <button className={by === 'tokens' ? 'on' : ''} onClick={() => setBy('tokens')}>Tokens</button>
          </span>
        </div>
        {err && <p className="warn">{err}</p>}
        {!d && !err && <p className="muted">Loading…</p>}
        {d && (
          <>
            <div className="usage-tiles">
              <div><span className="muted small">{range} days</span><b>{show(total)}</b></div>
              <div><span className="muted small">A day it worked</span><b>{active ? show({ tokens: total.tokens / active, cost: total.cost / active }) : '–'}</b></div>
              <div><span className="muted small">{by === 'cost' ? 'Tokens' : '≈ API price'}</span><b>{by === 'cost' ? tokensText(total.tokens) : money(total.cost)}</b></div>
            </div>
            <div className="usage-chart" role="img" aria-label={`${by === 'cost' ? 'Cost' : 'Tokens'} a day, the last ${range} days`}>
              <span className="usage-max muted small">{top ? show({ tokens: top, cost: top }) : ''}</span>
              <div className="usage-bars">
                {days.map(k => {
                  const x = per.get(k)!
                  return (
                    <span key={k} className="usage-col" data-tip={`${label(k)} · ${money(x.cost)} · ${tokensText(x.tokens)} tokens`}>
                      <i style={{ height: top ? `${Math.max(x[by] ? 2 : 0, (x[by] / top) * 100)}%` : 0 }} />
                    </span>
                  )
                })}
              </div>
              <div className="usage-axis muted small">
                <span>{label(days[0])}</span>
                <span>Today</span>
              </div>
            </div>
            {byModel.length ? (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Agent</th>
                    <th className="num">Tokens</th>
                    <th className="num">≈ API price</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map(m => (
                    <tr key={`${m.agent}|${m.model}`} className={model === m.model ? 'on' : ''} onClick={() => setModel(model === m.model ? '' : m.model)} data-tip={model === m.model ? 'All models again' : 'Only this model'}>
                      <td className="mono">{m.model}</td>
                      <td>{NAMES[m.agent] ?? m.agent}</td>
                      <td className="num">{tokensText(m.tokens)}</td>
                      <td className="num">{money(m.cost)}</td>
                      <td className="num">{total[by] ? `${Math.round((m[by] / total[by]) * 100)}%` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Nothing in these {range} days{agent || model ? ' for this filter' : ''}: Laki counts its own Claude Code and Codex tabs, from their transcripts, as they work.</p>
            )}
            <p className="muted small">At the API's list prices, from each chat's transcript: your plan bills its own way. Laki's own tabs only, {d.keep} days back.</p>
          </>
        )}
      </div>
    </Page>
  )
}
