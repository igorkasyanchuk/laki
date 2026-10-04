// The agents' plan limits for the status bar's ring (Usage.tsx): Claude's 5-hour and weekly windows, Codex's.
// Read the way Superset, CodexBar and others do: the sign-in the agent already keeps on this Mac (Claude Code's
// Keychain item or ~/.claude/.credentials.json, Codex's ~/.codex/auth.json), sent to the endpoint the agent's own
// /usage screen asks. Read-only: a token is never refreshed (a second client refreshing it can sign the agent out);
// an expired one waits for the agent's next run.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentUsage, UsageWindow } from '../shared/types.ts'

const run = promisify(execFile)
// Anthropic turns away clients that ask more often (CodexBar and ccusage hit it). AGAIN: an answer that asked no
// server (signed out, expired) or failed on the way (offline) is asked again sooner.
const USAGE_TTL = 5 * 60_000
const AGAIN = 60_000
// tests point both endpoints at a fake server: only a local one (a session's env, from a repo's .laki.json, can
// reach a daemon the CLI starts; the tokens never leave the machine)
export const base = (real: string) => {
  const t = process.env.LAKI_USAGE_API
  return t && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t : real
}

type Got = Omit<AgentUsage, 'agent' | 'at'> & { again?: boolean }
const AGENTS: { id: string; load: () => Promise<Got> }[] = [
  { id: 'claude', load: claude },
  { id: 'codex', load: codex },
]

const pct = (n: number) => Math.max(0, Math.round(n))
const failed = (e: any) =>
  e?.name === 'TimeoutError' ? 'No answer in 10 seconds' : e?.message === 'fetch failed' ? 'Can’t reach the server: offline?' : String(e?.message ?? e)
// a request that failed: why, and whether to ask again sooner (not when told to slow down or the token was turned away)
const fail = (e: any, plan?: string): Got => ({ plan, windows: [], error: failed(e), again: !e?.slow })
const slow = (message: string) => Object.assign(new Error(message), { slow: true })
const when = (s: unknown) => (typeof s === 'string' && Date.parse(s)) || undefined

async function get(url: string, headers: Record<string, string>, expired: string): Promise<any> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (r.status === 401 || r.status === 403) throw slow(expired)
  if (r.status === 429) throw slow('Asked too often: tries again in a few minutes')
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

// the freshest of Claude Code's Keychain items (the login user's, else the first) and its credentials file
async function claudeCred(): Promise<ClaudeCred | undefined> {
  const keychain = (...a: string[]) => run('security', ['find-generic-password', ...a, '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }).then(r => r.stdout)
  const reads = await Promise.allSettled([
    Promise.resolve().then(() => keychain('-a', userInfo().username)), // userInfo throws without a passwd entry
    keychain(),
    readFile(join(homedir(), '.claude', '.credentials.json'), 'utf8'),
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

async function claude(): Promise<Got> {
  const c = await claudeCred()
  if (!c) return { windows: [], error: 'Not signed in to a Claude plan: run claude, then /login', again: true }
  const plan = c.subscriptionType || undefined
  const expired = 'Sign-in expired: Claude Code renews it on its next run'
  if (c.expiresAt && c.expiresAt < Date.now()) return { plan, windows: [], error: expired, again: true }
  let u
  try {
    u = await get(`${base('https://api.anthropic.com')}/api/oauth/usage`, { Authorization: `Bearer ${c.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, expired)
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

async function codex(): Promise<Got> {
  let auth: any
  try {
    auth = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'))
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
    u = await get(`${base('https://chatgpt.com')}/backend-api/wham/usage`, headers, 'Sign-in expired: Codex renews it on its next run')
  } catch (e) {
    return fail(e)
  }
  const windows = codexWindows(u)
  return { plan: typeof u?.plan_type === 'string' ? u.plan_type : undefined, windows, error: windows.length ? undefined : 'This plan shows no limits' }
}

// ---------- each agent's answer, kept for USAGE_TTL (AGAIN when it says so); callers asking meanwhile share one request

type Entry = { at: number; ttl: number; p?: Promise<AgentUsage> }
const cache = new Map<string, Entry>()

// on: Settings' usage (an agent set to false isn't asked)
export function usage(on: Record<string, boolean> = {}, now = Date.now()): Promise<AgentUsage[]> {
  return Promise.all(
    AGENTS.filter(a => on[a.id] !== false).map(a => {
      const c = cache.get(a.id)
      if (c?.p && now - c.at < c.ttl) return c.p
      const entry: Entry = { at: now, ttl: USAGE_TTL }
      entry.p = a.load().then(
        ({ again, ...r }) => {
          if (again) entry.ttl = AGAIN
          return { agent: a.id, ...r, at: Date.now() }
        },
        e => ((entry.ttl = AGAIN), { agent: a.id, windows: [], error: failed(e), at: Date.now() }),
      )
      cache.set(a.id, entry)
      return entry.p
    }),
  )
}
