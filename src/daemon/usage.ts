// The agents' plan limits for the status bar's ring (Usage.tsx): Claude's 5-hour and weekly windows, Codex's.
// Read the way Superset, CodexBar and others do: the sign-in the agent already keeps on this Mac (Claude Code's
// Keychain item or ~/.claude/.credentials.json, Codex's ~/.codex/auth.json), sent to the endpoint the agent's own
// /usage screen asks. Read-only: a token is never refreshed (a second client refreshing it can sign the agent out);
// an expired one waits for the agent's next run.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentUsage, UsageWindow } from '../shared/types.ts'

const run = promisify(execFile)
// Anthropic turns away clients that ask more often (CodexBar and ccusage hit it): Claude's every 7.5 minutes, Codex's
// every 5. AGAIN: an answer that asked no server (signed out, expired) or failed on the way (offline) is asked again
// sooner. BACK_OFF: told to slow down (429), its Retry-After, else 10, 20, 40, then every 60 minutes, the last numbers
// kept meanwhile.
const USAGE_TTL = 5 * 60_000
const TTL: Record<string, number> = { claude: 7.5 * 60_000 }
const AGAIN = 60_000
const BACK_OFF = [10, 20, 40, 60].map(m => m * 60_000)
// tests point both endpoints at a fake server: only a local one (a session's env, from a repo's .laki.json, can
// reach a daemon the CLI starts; the tokens never leave the machine)
export const base = (real: string) => {
  const t = process.env.LAKI_USAGE_API
  return t && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t : real
}

type Got = Omit<AgentUsage, 'agent' | 'at'> & { again?: boolean; busy?: number } // busy: told to slow down, its Retry-After (ms, 0: none)
// whose limits: an agent's own sign-in (no dir) or an account's folder (accounts.ts)
export type Who = { agent: string; account: string; name: string; dir?: string; default: boolean }
const LOADERS: Record<string, (dir?: string) => Promise<Got>> = { claude, codex }

const pct = (n: number) => Math.max(0, Math.round(n))
const failed = (e: any) =>
  e?.name === 'TimeoutError' ? 'No answer in 10 seconds' : e?.message === 'fetch failed' ? 'Can’t reach the server: offline?' : String(e?.message ?? e)
// a request that failed: why, and whether to ask again sooner (not when told to slow down or the token was turned away)
const fail = (e: any, plan?: string): Got => ({ plan, windows: [], error: failed(e), again: !e?.slow, busy: e?.busy })
const slow = (message: string, busy?: number) => Object.assign(new Error(message), { slow: true, busy })
const when = (s: unknown) => (typeof s === 'string' && Date.parse(s)) || undefined

// Retry-After: seconds, or a date
export const waitOf = (h: string | null, now = Date.now()) => {
  const n = Number(h)
  const ms = h && Number.isFinite(n) ? n * 1000 : h ? Date.parse(h) - now : NaN
  return ms > 0 ? Math.min(ms, 6 * 3600_000) : 0
}

async function get(url: string, headers: Record<string, string>, expired: string, who: string): Promise<any> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' }) // the token goes to that host only
  if (r.status === 401 || r.status === 403) throw slow(expired)
  if (r.status === 429) throw slow(`${who} asked Laki to check less often`, waitOf(r.headers.get('retry-after')))
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json().catch(() => Promise.reject(new Error('Unexpected answer from the server'))) // a captive portal's page
}

// ---------- Claude Code: /api/oauth/usage

export function claudeWindows(u: any): UsageWindow[] {
  const out: UsageWindow[] = []
  const add = (label: string, used: unknown, resets?: number, note?: string) => {
    if (typeof used === 'number' && !out.some(w => w.label === label)) out.push({ label, used: pct(used), resets, note })
  }
  add('5-hour', u?.five_hour?.utilization, when(u?.five_hour?.resets_at))
  add('Weekly', u?.seven_day?.utilization, when(u?.seven_day?.resets_at))
  add('Weekly · Opus', u?.seven_day_opus?.utilization, when(u?.seven_day_opus?.resets_at))
  add('Weekly · Sonnet', u?.seven_day_sonnet?.utilization, when(u?.seven_day_sonnet?.resets_at))
  for (const l of Array.isArray(u?.limits) ? u.limits : [])
    if (l?.kind === 'weekly_scoped' && l.scope?.model?.display_name) add(`Weekly · ${l.scope.model.display_name}`, l.percent, when(l.resets_at))
  const x = u?.extra_usage // cents
  if (x && x.is_enabled !== false && typeof x.used_credits === 'number' && x.monthly_limit > 0)
    add('Extra usage', (x.used_credits / x.monthly_limit) * 100, undefined, `$${(x.used_credits / 100).toFixed(2)} of $${(x.monthly_limit / 100).toFixed(0)}/mo`)
  return out
}

type ClaudeCred = { accessToken: string; expiresAt?: number; subscriptionType?: string }

// Claude Code's Keychain item for a config folder (CLAUDE_CONFIG_DIR): its name's hash, the folder as given
export const keychainService = (d: string) => `Claude Code-credentials-${createHash('sha256').update(d.normalize('NFC')).digest('hex').slice(0, 8)}`

// the freshest of Claude Code's Keychain items (the login user's, else the first) and its credentials file; d: an
// account's folder (its own item and file), else the agent's own
export async function claudeCred(d?: string): Promise<ClaudeCred | undefined> {
  const service = d ? keychainService(d) : 'Claude Code-credentials'
  const keychain = (...a: string[]) => run('security', ['find-generic-password', ...a, '-s', service, '-w'], { timeout: 5000 }).then(r => r.stdout)
  const reads = await Promise.allSettled([
    Promise.resolve().then(() => keychain('-a', userInfo().username)), // userInfo throws without a passwd entry
    keychain(),
    readFile(join(d ?? join(homedir(), '.claude'), '.credentials.json'), 'utf8'),
  ])
  let best: ClaudeCred | undefined
  for (const read of reads) {
    try {
      const c = read.status === 'fulfilled' && JSON.parse(read.value)?.claudeAiOauth
      if (typeof c?.accessToken === 'string' && c.accessToken && (!best || (c.expiresAt ?? 0) > (best.expiresAt ?? 0))) best = c
    } catch {} // not signed in that way
  }
  return best
}

async function claude(d?: string): Promise<Got> {
  const c = await claudeCred(d)
  if (!c) return { windows: [], error: d ? 'Not signed in: Settings › Agents & profiles, Sign in' : 'Not signed in to a Claude plan: run claude, then /login', again: true }
  const plan = c.subscriptionType || undefined
  const expired = 'Sign-in expired: Claude Code renews it on its next run'
  if (c.expiresAt && c.expiresAt < Date.now()) return { plan, windows: [], error: expired, again: true }
  let u
  try {
    u = await get(`${base('https://api.anthropic.com')}/api/oauth/usage`, { Authorization: `Bearer ${c.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, expired, 'Anthropic')
  } catch (e) {
    return fail(e, plan)
  }
  const windows = claudeWindows(u)
  return { plan, windows, error: windows.length ? undefined : 'This plan shows no limits (organization and education plans don’t)' }
}

// ---------- Codex: chatgpt.com's wham/usage

const span = (secs: unknown) => {
  if (typeof secs !== 'number') return 'Limit'
  const h = Math.round(secs / 3600)
  return h === 168 ? 'Weekly' : h >= 24 && h % 24 === 0 ? `${h / 24}-day` : `${h}-hour`
}

export function codexWindows(u: any, now = Date.now()): UsageWindow[] {
  const out: UsageWindow[] = []
  const add = (w: any, name?: string) => {
    if (typeof w?.used_percent !== 'number') return
    const resets = typeof w.reset_at === 'number' ? w.reset_at * 1000 : typeof w.reset_after_seconds === 'number' ? now + w.reset_after_seconds * 1000 : undefined
    out.push({ label: name ? `${span(w.limit_window_seconds)} · ${name}` : span(w.limit_window_seconds), used: pct(w.used_percent), resets })
  }
  add(u?.rate_limit?.primary_window)
  add(u?.rate_limit?.secondary_window)
  for (const x of Array.isArray(u?.additional_rate_limits) ? u.additional_rate_limits : []) {
    add(x?.rate_limit?.primary_window, x?.limit_name || 'other')
    add(x?.rate_limit?.secondary_window, x?.limit_name || 'other')
  }
  return out
}

async function codex(d?: string): Promise<Got> {
  let auth: any
  try {
    auth = JSON.parse(await readFile(join(d ?? (process.env.CODEX_HOME || join(homedir(), '.codex')), 'auth.json'), 'utf8'))
  } catch {
    return { windows: [], error: 'Not signed in: run codex login', again: true }
  }
  const t = auth?.tokens
  if (typeof t?.access_token !== 'string' || !t.access_token)
    return { windows: [], error: auth?.OPENAI_API_KEY ? 'Signed in with an API key: billed per token, no plan limits' : 'Not signed in: run codex login', again: true }
  const headers: Record<string, string> = { Authorization: `Bearer ${t.access_token}` }
  if (typeof t.account_id === 'string' && t.account_id) headers['chatgpt-account-id'] = t.account_id
  let u
  try {
    u = await get(`${base('https://chatgpt.com')}/backend-api/wham/usage`, headers, 'Sign-in expired: Codex renews it on its next run', 'OpenAI')
  } catch (e) {
    return fail(e)
  }
  const windows = codexWindows(u)
  return { plan: typeof u?.plan_type === 'string' ? u.plan_type : undefined, windows, error: windows.length ? undefined : 'This plan shows no limits' }
}

// ---------- each agent's answer, kept for its TTL (AGAIN or BACK_OFF when it says so); callers asking meanwhile share
// one request; last: its last answer with numbers, shown while the server says to wait

type Entry = { at: number; ttl: number; p?: Promise<AgentUsage>; slows?: number }
const cache = new Map<string, Entry>()
const last = new Map<string, AgentUsage>()

// on: Settings' usage (an agent set to false isn't asked); who: each agent's accounts, its own first; own: an account's
// windows the agent said itself (meters.ts' statusLimits, claude's status line), fresh: the endpoint isn't asked
export function usage(on: Record<string, boolean> = {}, who: Who[] = [], now = Date.now(), own?: (w: Who, now: number) => { windows: UsageWindow[]; at: number } | undefined): Promise<AgentUsage[]> {
  return Promise.all(
    who.filter(w => on[w.agent] !== false && LOADERS[w.agent]).map(w => {
      const key = `${w.agent}:${w.dir ?? ''}`
      const mine = (r: Omit<AgentUsage, 'account' | 'name' | 'default'>): AgentUsage => ({ ...r, account: w.account, name: w.name, default: w.default })
      const said = own?.(w, now)
      if (said) {
        // ponytail: the endpoint's other windows (per model, extra usage) as it last read them; its plan likewise
        const had = last.get(key)
        return Promise.resolve(mine({ agent: w.agent, plan: had?.plan, windows: [...said.windows, ...(had?.windows ?? []).filter(x => !said.windows.some(y => y.label === x.label))], at: said.at }))
      }
      const c = cache.get(key)
      if (c?.p && now - c.at < c.ttl) return c.p.then(mine) // a rename, another default: now's
      const entry: Entry = { at: now, ttl: TTL[w.agent] ?? USAGE_TTL }
      entry.p = LOADERS[w.agent](w.dir).then(
        ({ again, busy, ...r }) => {
          if (again) entry.ttl = AGAIN
          if (busy !== undefined) {
            entry.slows = (c?.slows ?? 0) + 1
            entry.ttl = Math.max(busy, BACK_OFF[Math.min(entry.slows, BACK_OFF.length) - 1])
            const had = last.get(key)
            return { ...(had ?? { agent: w.agent, ...r, at: Date.now() }), error: r.error, next: entry.at + entry.ttl }
          }
          const got = { agent: w.agent, ...r, at: Date.now() }
          if (got.windows.length) last.set(key, got)
          return got
        },
        e => ((entry.ttl = AGAIN), { agent: w.agent, windows: [], error: failed(e), at: Date.now() }),
      )
      cache.set(key, entry)
      return entry.p.then(mine)
    }),
  )
}
