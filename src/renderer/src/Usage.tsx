// The status bar's first item: a ring filled to the shortest limit (the 5-hour session) of the agents' plans, and its popup with every
// limit (the 5-hour session, the week, per model) and when each resets. The daemon reads them with the agents' own
// sign-in, at most every 5 minutes (usage.ts); Settings › Appearance picks the agents. Under them, today's tokens and
// their ≈ cost at API prices (the daemon's meters, View.today); and the words a tab's context and usage are said in.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Backdrop, IconButton, Page, act } from './ui'
import { ago as agoOf } from './Info'

import { AGENT_NAMES, AI_FROM, type AgentUsage, type AiCredits, type AiFrom, HOME_ACCOUNT, type Today, type UsageWindow, usageOld } from '../../shared/types'
export type { AgentUsage, UsageWindow } // a window's note: what the % is of, for an amount rather than a rate limit (extra usage): the ring leaves it out

// the agents whose plans have limits to read
export const USAGE_AGENTS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok', gemini: 'Antigravity' }
export const USAGE_HOSTS: Record<string, string> = { claude: 'api.anthropic.com', codex: 'chatgpt.com', grok: 'grok.com', gemini: 'agy' } // R4: who its usage endpoint asks (agy: its own /usage)
// grok's and agy's Settings › Layout hints: no numbers of their own while off (Claude's and Codex's: Settings.tsx)
export const USAGE_HINTS: Record<string, string> = {
  grok: 'Reads your Grok sign-in (~/.grok) and asks grok.com directly, as Grok’s own CLI does: undocumented, may break. Off: no numbers',
  gemini: 'Runs agy’s own /usage every 5 minutes: it takes no turn and uses no quota (agy 1.1.11 or newer). Off: no numbers',
}
const STALE = 20 * 60_000 // R4: numbers older than this say so (an agent's own come only as it works)
const old = usageOld // an agent's own numbers past STALE: dimmed, with Ask <host>
const NAMES = USAGE_AGENTS

// a window whose reset has passed starts over
const live = (w: UsageWindow, now: number) => (w.resets && w.resets <= now ? 0 : w.used)
export const level = (p: number) => (p >= 90 ? 'high' : p >= 70 ? 'mid' : 'low') // amber past 70%, red past 90%
// U11: the level in words, beside its color (a tip, a screen reader's label)
export const levelWord = (p: number) => ({ high: 'nearly full', mid: 'filling up', low: 'room left' })[level(p)]

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
// asks: Settings' usage, the agents whose endpoint is asked; onAsk: turn an agent's on (its own numbers too old); credits: Laki AI's OpenRouter credits and spend (low:
// said in the ring's tip and the popup's tag, no mark on the ring: it's the plans' meter)
export function UsageButton({ load, credits, onUse, onDays, today, asks, onAsk }: { load: () => Promise<AgentUsage[]>; credits?: () => Promise<AiCredits | null>; onUse?: (agent: string, account: string) => void; onDays?: () => void; today?: Spent; asks?: Record<string, boolean>; onAsk?: (agent: string) => Promise<unknown> }) {
  const [rows, setRows] = useState<AgentUsage[] | null>(null)
  const [at, setAt] = useState<DOMRect | null>(null)
  const [or, setOr] = useState<AiCredits | null>(null)
  const loader = useRef({ load, credits })
  loader.current = { load, credits }
  const again = useRef(() => {})
  useEffect(() => {
    let on = true
    // an older daemon has no usage: no ring; a failed ask (the daemon restarting) keeps the last answer
    const get = () => (loader.current.load().then(r => on && setRows(r), () => {}), loader.current.credits?.().then(c => on && setOr(c), () => {}))
    again.current = get
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
  const tip = `Plan limits · ${used.map((r, i) => `${nameOf(r, rows)} ${tops[i] === undefined ? '–' : `${tops[i]}%${old(r, now) ? ` as of ${hm(r.at)}` : ''}`}`).join(' · ')}${or?.low ? ' · OpenRouter credits low' : ''}`
  return (
    <>
      <button className="usage-btn" data-tip={tip} aria-label={tip} onClick={e => setAt(e.currentTarget.getBoundingClientRect())}>
        <Ring p={top} />
      </button>
      {at && <UsagePop anchor={at} rows={rows} top={top} today={today} or={or} asks={asks} onAsk={onAsk && (a => onAsk(a).then(() => again.current(), () => {}))} onDays={onDays} onUse={onUse && ((a, id) => (onUse(a, id), setRows(r => r?.map(x => (x.agent === a ? { ...x, default: (x.account ?? HOME_ACCOUNT) === id } : x)) ?? r)))} onClose={() => setAt(null)} />}
    </>
  )
}

// an agent's name, and its account's when it has more than one
const nameOf = (r: AgentUsage, rows: AgentUsage[]) => [NAMES[r.agent] ?? r.agent, rows.filter(x => x.agent === r.agent).length > 1 && (r.account === HOME_ACCOUNT ? 'Default' : r.name)].filter(Boolean).join(' · ')

// today's, its workspaces by name
export type Spent = Omit<Today, 'ws'> & { ws: { name: string; tokens: number; cost: number }[] }

function windowRow(w: UsageWindow, now: number) {
  const p = live(w, now)
  return (
    <div key={w.label} className="usage-row">
      <span className="usage-label" data-tip={w.label.length > 28 ? w.label : undefined /* past 17em: cut, whole on hover */}>{w.label}</span>
      <span className={`usage-bar ${level(p)}`}>
        <i style={{ width: `${Math.min(p, 100)}%` }} />
      </span>
      <span className="usage-pct">{p}%</span>
      <span className="muted small usage-when">{w.note ?? (w.resets ? (w.resets <= now ? 'reset since' : `resets ${resetsIn(w.resets, now)}`) : '')}</span>
    </div>
  )
}

// Laki AI's OpenRouter: credits left (a bar of what's used), the key's spend, its own limit
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n >= 1000 ? 0 : 2, maximumFractionDigits: n >= 1000 ? 0 : 2 })}` // $2,224, $24.99
function creditsPart(c: AiCredits) {
  const used = c.credits?.total ? Math.round((c.credits.used / c.credits.total) * 100) : 0 // none bought: an empty bar, not a red one
  return (
    <section className="usage-agent">
      <div className="usage-name">
        <b>OpenRouter</b>
        <span className="muted">Laki AI</span>
        <span className="grow" />
        {c.low && <span className="tag tag-warn">running low</span>}
      </div>
      {c.credits && (
        <div className="usage-row">
          <span className="usage-label">Credits</span>
          <span className={`usage-bar ${c.low ? 'high' : level(used)}`}>
            <i style={{ width: `${Math.min(used, 100)}%` }} />
          </span>
          <span className="usage-pct">{used}%</span>
          <span className="muted small usage-when">{usd(Math.max(0, c.credits.total - c.credits.used))} left of {usd(c.credits.total)}</span>
        </div>
      )}
      {c.key &&
        (
          [
            ['Today', c.key.day, 'this key spent'],
            ['This week', c.key.week, ''],
            ['This month', c.key.month, ''],
            ...(c.key.limit !== undefined && c.key.left !== undefined ? [['Key limit', c.key.left, `left of ${usd(c.key.limit)}`] as const] : []),
          ] as const
        ).map(([label, n, note]) => (
          <div key={label} className="usage-row usage-spent">
            <span className="usage-label">{label}</span>
            <span className="usage-pct">{usd(n)}</span>
            <span className="muted small usage-when">{note}</span>
          </div>
        ))}
      {c.error && <p className="muted small">{c.error}.</p>}
      {c.key && !c.credits && <p className="muted small">Credits left: OpenRouter shows them only to a key that may read them.</p>}
      {c.low && <p className="muted small">Add credits at openrouter.ai before Laki AI stops.</p>}
    </section>
  )
}

function UsagePop({ anchor, rows, top, today, or, asks, onAsk, onUse, onDays, onClose }: { anchor: DOMRect; rows: AgentUsage[]; top?: number; today?: Spent; or?: AiCredits | null; asks?: Record<string, boolean>; onAsk?: (agent: string) => void; onUse?: (agent: string, account: string) => void; onDays?: () => void; onClose: () => void }) {
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
  // asked: the rows a server or agy's /usage answered just now; the agents' own numbers keep their own As of
  const asked = rows.filter(r => r.source === 'endpoint' || (r.source !== 'own' && asks?.[r.agent] === true))
  const ago = asked.length ? Math.round((now - Math.min(...asked.map(r => r.at))) / 60_000) : 0
  return (
    <Backdrop onClose={onClose}>
      <div className="tunnel-pop usage-pop" ref={box} role="dialog" aria-label="Plan limits">
        <div className="tunnel-head">
          <Ring p={top} />
          <b>Plan limits</b>
          <span className="grow" />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        {rows.map(r => (
          <section key={`${r.agent}:${r.account ?? ''}`} className={`usage-agent${r.default === false ? ' other' : ''}${old(r, now) ? ' old' : ''}`}>
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
            {r.windows.map(w => windowRow(w, now))}
            {r.error && <p className="muted small">{r.next ? waitText(r, now) : r.error}</p>}
            {old(r, now) ? (
              <p className="muted small">
                As of {hm(r.at)} ({agoOf(r.at)}): {NAMES[r.agent] ?? r.agent} says them only as it works in Laki, so what it used since, outside Laki too, isn't in them.
                {onAsk && USAGE_HOSTS[r.agent] && (
                  <>
                    {' '}
                    <button type="button" className="link small" data-tip={`Settings › Layout › Ask ${USAGE_HOSTS[r.agent]}: ${USAGE_HINTS[r.agent] ?? `reads your ${NAMES[r.agent] ?? r.agent} sign-in and asks ${USAGE_HOSTS[r.agent]} directly: undocumented, may break`}`} onClick={() => onAsk(r.agent)}>
                      Ask {USAGE_HOSTS[r.agent]}
                    </button>
                  </>
                )}
              </p>
            ) : (
              !r.error && r.windows.length > 0 && now - r.at > STALE && <p className="muted small">As of {hm(r.at)}: not read again since.</p>
            )}
          </section>
        ))}
        {or && creditsPart(or)}
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
        <p className="muted small usage-foot">
          {asked.length ? `Read ${ago < 1 ? 'just now' : `${ago} min ago`}; asked with each account's own sign-in where Layout says so${rows.some(r => r.source === 'own') ? "; the others are the agents' own numbers" : ''}.` : "The agents' own numbers: Claude Code's status line, Codex's reports."}{rows.some(r => r.agent === 'claude' && r.windows.length > 0) && asks?.claude !== true && ` Claude's week per model (Fable's) only comes from Anthropic: Settings › Layout › Ask ${USAGE_HOSTS.claude}.`} Settings › Agents & profiles has the accounts.
        </p>
      </div>
    </Backdrop>
  )
}

// the Usage page (the popup's Today › By day and model, ⌘K): what Laki's claude, codex, grok and gemini (Antigravity)
// tabs used each day, at the API's list prices, from their transcripts (Grok's own price, agy's tokens: agentUsage.ts) (the daemon's usageDays: USAGE_KEEP days back), and Laki AI's own calls (its
// call log, by what made each: ai), for one agent or model or all. A bar a day, stacked by agent (each its own color, in
// SERIES order: a filter never repaints one), then Where it went (each workspace's tabs and each of Laki AI's sources),
// then each model's share
export type UsageDay = { day: string; agent: string; model: string; ws?: string; tokens: number; cost: number }
export type UsageAi = { day: string; from: AiFrom; model: string; tokens: number; cost: number }
type Row = { day: string; agent: string; model: string; src: string; tokens: number; cost: number } // src: ws:<id> or ai:<from>
const RANGES = [7, 30, 90]
const LAKI = 'laki' // Laki AI's series
const SERIES = ['claude', 'codex', 'gemini', 'grok', 'opencode', LAKI] // the stack's order and colors, fixed
const COLOR: Record<string, string> = { claude: 'var(--tc-orange)', codex: 'var(--tc-blue)', gemini: 'var(--tc-green)', grok: 'var(--tc-yellow)', opencode: 'var(--tc-pink)', [LAKI]: 'var(--tc-purple)' }
const nameOfAgent = (a: string) => (a === LAKI ? 'Laki AI' : (AGENT_NAMES[a as keyof typeof AGENT_NAMES] ?? NAMES[a] ?? a))
const WHERE_SHOWN = 8 // Where it went's rows before More
const dayKey = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
const money = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString()}`
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '')
// what a workspace's id names: its name and project (gone: none)
export type WsNames = (id: string) => { name: string; project?: string; archived?: boolean } | undefined
export function UsagePage({ load, onClose, names }: { load: () => Promise<{ keep: number; rows: UsageDay[]; ai?: UsageAi[] }>; onClose: () => void; names: WsNames }) {
  const [d, setD] = useState<{ keep: number; rows: Row[]; where: boolean } | null>(null) // where: rows name their workspace (a daemon from API 213)
  const [err, setErr] = useState('')
  const [range, setRange] = useState(30)
  const [agent, setAgent] = useState('')
  const [model, setModel] = useState('')
  const [by, setBy] = useState<'cost' | 'tokens'>('cost')
  useEffect(
    () =>
      void load().then(
        r => setD({ keep: r.keep, where: !!r.ai, rows: [...r.rows.map(x => ({ ...x, src: `ws:${x.ws ?? ''}` })), ...(r.ai ?? []).map(x => ({ day: x.day, agent: LAKI, model: x.model, src: `ai:${x.from}`, tokens: x.tokens, cost: x.cost }))] }),
        e => setErr(String(e?.message ?? e)),
      ),
    [],
  )
  const days = Array.from({ length: range }, (_, i) => (t => dayKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (range - 1 - i))))(new Date())) // by the calendar: a DST day is still one
  const inRange = (d?.rows ?? []).filter(r => r.day >= days[0])
  const agents = SERIES.filter(a => inRange.some(r => r.agent === a)).concat([...new Set(inRange.map(r => r.agent))].filter(a => !SERIES.includes(a)))
  const models = [...new Set(inRange.filter(r => !agent || r.agent === agent).map(r => r.model))].sort()
  const rows = inRange.filter(r => (!agent || r.agent === agent) && (!model || r.model === model))
  const shown = agents.filter(a => rows.some(r => r.agent === a)) // the stack's series now, in SERIES order
  const per = new Map(days.map(k => [k, new Map<string, { tokens: number; cost: number }>()]))
  for (const r of rows) (m => m && (x => ((x.tokens += r.tokens), (x.cost += r.cost)))(m.get(r.agent) ?? (m.set(r.agent, { tokens: 0, cost: 0 }), m.get(r.agent)!)))(per.get(r.day))
  const dayTotal = (k: string) => [...per.get(k)!.values()].reduce((n, x) => n + x[by], 0)
  const sum = (rs: Row[]) => ({ tokens: rs.reduce((n, r) => n + r.tokens, 0), cost: rs.reduce((n, r) => n + r.cost, 0) })
  const total = sum(rows)
  const top = Math.max(...days.map(dayTotal), 0)
  const group = <K extends string>(key: (r: Row) => K) => [...rows.reduce((m, r) => (x => ((x.tokens += r.tokens), (x.cost += r.cost), m))(m.get(key(r)) ?? (m.set(key(r), { key: key(r), agent: r.agent, model: r.model, src: r.src, tokens: 0, cost: 0 }), m.get(key(r))!)), new Map<K, { key: K; agent: string; model: string; src: string; tokens: number; cost: number }>()).values()].sort((a, b) => b[by] - a[by] || b.tokens - a.tokens)
  const byModel = group(r => `${r.agent}|${r.model}`)
  const where = d?.where ? group(r => r.src) : [] // an older daemon's rows name no workspace: no Where it went
  const srcName = (src: string) => {
    if (src.startsWith('ai:')) return { name: AI_FROM[src.slice(3) as AiFrom] ?? src.slice(3), kind: 'Laki AI' }
    const w = names(src.slice(3))
    return w ? { name: w.name, kind: `${w.project ?? 'workspace'}${w.archived ? ' · archived' : ''}` } : { name: 'A deleted workspace', kind: src.slice(3) || 'no workspace' }
  }
  const show = (x: { tokens: number; cost: number }) => (by === 'cost' ? money(x.cost) : `${tokensText(x.tokens)} tokens`)
  const label = (k: string) => new Date(`${k}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const active = days.filter(k => [...per.get(k)!.values()].some(x => x.tokens > 0)).length
  const whereTop = where.slice(0, WHERE_SHOWN)
  const whereRest = where.slice(WHERE_SHOWN)
  const split = new Map(group(r => `${r.src}|${r.agent}`).map(y => [y.key, y])) // each source's agents, in one pass
  const whereRow = (x: (typeof where)[number]) => {
    const n = srcName(x.src)
    const parts = agents.flatMap(a => (v => (v && v[by] > 0 ? [[a, v] as const] : []))(split.get(`${x.src}|${a}`))) // its agents, each its color
    return (
      <li key={x.key} data-tip-card data-tip={[`${n.name} · ${money(x.cost)} · ${tokensText(x.tokens)} tokens`, ...(parts.length > 1 ? parts.map(([a, v]) => `${nameOfAgent(a)}: ${show(v)}`) : [])].join('\n')}>
        <span className="usage-where-name">
          <span className="usage-where-label">{n.name}</span>
          <span className="muted">{n.kind}</span>
        </span>
        <span className="usage-where-bar" aria-hidden>
          <span style={{ width: total[by] ? `${Math.max(1, (x[by] / total[by]) * 100)}%` : 0 }}>
            {parts.map(([a, v]) => (
              <i key={a} style={{ flexGrow: v[by], background: COLOR[a] ?? 'var(--muted)' }} />
            ))}
          </span>
        </span>
        <span className="num">{show(x)}</span>
        <span className="num muted">{pct(x[by], total[by])}</span>
      </li>
    )
  }
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
                {a ? nameOfAgent(a) : 'All'}
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
            <button className={by === 'cost' ? 'on' : ''} aria-label="By cost" aria-pressed={by === 'cost'} onClick={() => setBy('cost')}>$</button>
            <button className={by === 'tokens' ? 'on' : ''} aria-pressed={by === 'tokens'} onClick={() => setBy('tokens')}>Tokens</button>
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
              <div><span className="muted small">The most</span><b className="usage-tile-name">{where[0] ? srcName(where[0].src).name : '–'}</b></div>
            </div>
            <div className="usage-chart">
              {shown.length > 0 && (
                <ul className="usage-legend" aria-label="Agents">
                  {shown.map(a => (
                    <li key={a}>
                      <span className="usage-swatch" style={{ background: COLOR[a] ?? 'var(--muted)' }} aria-hidden />
                      {nameOfAgent(a)} <span className="muted num">{show(sum(rows.filter(r => r.agent === a)))}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="usage-plot" role="img" aria-label={`${by === 'cost' ? 'Cost' : 'Tokens'} a day by agent, the last ${range} days`}>
                <span className="usage-max muted small">{top ? show({ tokens: top, cost: top }) : ''}</span>
                <div className="usage-bars">
                  {days.map(k => {
                    const m = per.get(k)!
                    const n = dayTotal(k)
                    const parts = shown.filter(a => m.get(a)?.[by])
                    return (
                      <span key={k} className="usage-col" data-tip-card data-tip={[`${label(k)} · ${show({ tokens: [...m.values()].reduce((t, x) => t + x.tokens, 0), cost: [...m.values()].reduce((t, x) => t + x.cost, 0) })}`, ...parts.map(a => `${nameOfAgent(a)}: ${show(m.get(a)!)}`)].join('\n')}>
                        <span className="usage-stack" style={{ height: top ? `${Math.max(n ? 2 : 0, (n / top) * 100)}%` : 0 }}>
                          {parts.map(a => (
                            <i key={a} style={{ flexGrow: m.get(a)![by], background: COLOR[a] ?? 'var(--muted)' }} />
                          ))}
                        </span>
                      </span>
                    )
                  })}
                </div>
                <div className="usage-axis muted small">
                  <span>{label(days[0])}</span>
                  <span>Today</span>
                </div>
              </div>
            </div>
            {where.length > 0 && (
              <section className="usage-where">
                <h3>Where it went</h3>
                <ul>{whereTop.map(whereRow)}</ul>
                {whereRest.length > 0 && (
                  <details>
                    <summary className="muted small">{whereRest.length} more · {show(sum(rows.filter(r => whereRest.some(x => x.src === r.src))))}</summary>
                    <ul>{whereRest.map(whereRow)}</ul>
                  </details>
                )}
              </section>
            )}
            {byModel.length ? (
              <section className="usage-where">
                <h3>By model</h3>
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
                      <tr key={m.key} className={model === m.model ? 'on' : ''} {...act(() => setModel(model === m.model ? '' : m.model))} data-tip={model === m.model ? 'All models again' : 'Only this model'}>
                        <td className="mono">{m.model}</td>
                        <td>
                          <span className="usage-swatch" style={{ background: COLOR[m.agent] ?? 'var(--muted)' }} aria-hidden /> {nameOfAgent(m.agent)}
                        </td>
                        <td className="num">{tokensText(m.tokens)}</td>
                        <td className="num">{money(m.cost)}</td>
                        <td className="num">{pct(m[by], total[by])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : (
              <p className="muted">Nothing in these {range} days{agent || model ? ' for this filter' : ''}: Laki counts its own Claude Code, Codex, Grok and Antigravity tabs, from their own files, as they work, and Laki AI's calls.</p>
            )}
            <p className="muted small">At the API's list prices, from each chat's transcript and Laki AI's call log (codex exec's: your plan, no price); Grok's at its own price, Antigravity's tokens only: your plan bills its own way. Laki's own tabs only, {d.keep} days back.</p>
          </>
        )}
      </div>
    </Page>
  )
}
