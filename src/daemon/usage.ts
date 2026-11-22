// The agents' plan limits for the status bar's ring (Usage.tsx): Claude's 5-hour and weekly windows, Codex's, Grok's
// week, Antigravity's per model group. Read the way Superset, CodexBar, Orca and others do: the sign-in the agent
// already keeps on this Mac (Claude Code's Keychain item or ~/.claude/.credentials.json, Codex's ~/.codex/auth.json,
// Grok's ~/.grok/auth.json), sent to the endpoint the agent's own /usage screen asks; Antigravity's from agy's own
// /usage command (agy signs in itself: Laki never reads its token). Read-only: a token is never refreshed (a second
// client refreshing it can sign the agent out); an expired one waits for the agent's next run.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { type AgentUsage, HOME_ACCOUNT, type UsageWindow } from '../shared/types.ts'
import { newer } from '../shared/update.ts'

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
const LOADERS: Record<string, (dir?: string) => Promise<Got>> = { claude, codex, grok, gemini }

// grok and agy have no accounts in Laki: their own sign-in only, listed once it's on this Mac (Grok's auth.json; agy on
// PATH with its folder), so a Mac without them gets no row (nor a test's temp HOME)
const onPath = (cmd: string) => (process.env.PATH ?? '').split(':').some(d => d && existsSync(join(d, cmd)))
export const othersWho = (): Who[] =>
  [
    existsSync(join(homedir(), '.grok', 'auth.json')) && 'grok',
    existsSync(join(homedir(), '.gemini', 'antigravity-cli')) && onPath('agy') && 'gemini',
  ].flatMap(agent => (agent ? [{ agent, account: HOME_ACCOUNT, name: 'Default', default: true }] : []))

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

async function get(url: string, headers: Record<string, string>, expired: string, who: string, body?: string): Promise<any> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error', ...(body !== undefined && { method: 'POST', body }) }) // the token goes to that host only
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

// R4: Codex's own numbers, documented in its transcript: a token_count event's rate_limits (meters.ts' meterOf), at: its time
export function codexRateWindows(rl: any, at: number): UsageWindow[] {
  const out: UsageWindow[] = []
  for (const w of [rl?.primary, rl?.secondary]) {
    if (typeof w?.used_percent !== 'number') continue
    const resets = typeof w.resets_at === 'number' ? w.resets_at * 1000 : typeof w.resets_in_seconds === 'number' ? at + w.resets_in_seconds * 1000 : undefined
    out.push({ label: span(typeof w.window_minutes === 'number' ? w.window_minutes * 60 : undefined), used: pct(w.used_percent), resets })
  }
  return out
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

// ---------- Grok: its CLI's billing view (cli-chat-proxy.grok.com, as Orca reads it), with ~/.grok/auth.json's token

const XAI = 'https://auth.x.ai' // an issuer's name in auth.json, never contacted
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
type GrokCred = { key: string; user_id?: unknown; expires_at?: unknown }
const gone = (c: GrokCred) => (when(c.expires_at) ?? Infinity) < Date.now()
// auth.json: an entry per issuer; xAI's own first (another issuer's only when there's none), a live one before an expired one
export function grokCred(auth: unknown): GrokCred | undefined {
  const all = Object.entries(obj(auth)).flatMap(([k, e]) => (str(obj(e).key) ? [[k, obj(e) as GrokCred] as const] : []))
  const xai = all.filter(([k]) => k === XAI || k.startsWith(`${XAI}::`))
  const creds = (xai.length ? xai : all).map(([, e]) => e)
  return creds.find(c => !gone(c)) ?? creds[0]
}

// creditUsagePercent: the week's (SuperGrok); monthlyLimit and used: a unified-billing account's month
const grokConfig = (u: unknown) => obj(obj(u).config ?? u)
export function grokWindows(u: unknown): UsageWindow[] {
  const c = grokConfig(u)
  const resets = when(obj(c.currentPeriod).end ?? c.billingPeriodEnd)
  const money = (v: unknown) => (x => num(typeof x === 'string' ? Number.parseFloat(x) : x))(obj(v).val)
  const out: UsageWindow[] = []
  const week = num(c.creditUsagePercent)
  if (week !== undefined) out.push({ label: 'Weekly', used: pct(Math.min(100, week)), resets })
  const limit = money(c.monthlyLimit)
  const used = money(c.used)
  if (limit && limit > 0 && used !== undefined) out.push({ label: 'Monthly', used: pct(Math.min(100, (used / limit) * 100)), resets })
  return out
}

// ponytail: Orca's guesses for a percent the server leaves out (a weekly 0% from a zero cap) skipped: no number, no row
async function grok(): Promise<Got> {
  let auth: unknown
  try {
    auth = JSON.parse(await readFile(join(homedir(), '.grok', 'auth.json'), 'utf8'))
  } catch {
    return { windows: [], error: 'Not signed in: run grok, then sign in', again: true }
  }
  const c = grokCred(auth)
  if (!c) return { windows: [], error: 'Not signed in: run grok, then sign in', again: true }
  const expired = 'Sign-in expired: Grok renews it on its next run'
  if (gone(c)) return { windows: [], error: expired, again: true }
  const headers: Record<string, string> = { Authorization: `Bearer ${c.key}`, 'X-XAI-Token-Auth': 'xai-grok-cli', Accept: 'application/json' } // the CLI's own
  const user = str(c.user_id)
  if (user) headers['x-userid'] = user
  const at = `${base('https://cli-chat-proxy.grok.com')}/v1/billing`
  try {
    const u = await get(`${at}?format=credits`, headers, expired, 'xAI')
    let windows = grokWindows(u)
    let plan = str(grokConfig(u).subscriptionTier)
    if (!windows.length) {
      const d = await get(at, headers, expired, 'xAI') // a unified-billing account's month: only in the default view
      windows = grokWindows(d)
      plan ||= str(grokConfig(d).subscriptionTier)
    }
    return { plan: plan || undefined, windows, error: windows.length ? undefined : 'This plan shows no limits' }
  } catch (e) {
    return fail(e)
  }
}

// ---------- Antigravity (the gemini agent): agy's own `agy -p /usage --output-format json`, its quota per model group

const AGY_MIN = '1.1.11' // before it, print mode's /usage spent a model turn (agy's changelog, as Orca found)
const BILLED = 'agy answered /usage as a prompt, so Laki stopped asking (until it restarts)'
let agyVersion: { at: number; v?: string } | undefined
let agyBilled = false // its /usage once took a turn (a prompt, not a command): never asked again until Laki restarts

// agy's answer: its JSON line among any log noise; billed: it ran a model turn (a conversation, turns), so stop asking
export function agyRead(stdout: string): { windows?: UsageWindow[]; error?: string; billed?: boolean } {
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let e: Obj
    try {
      e = obj(JSON.parse(line))
    } catch {
      continue
    }
    if ((num(e.num_turns) ?? 0) > 0 || str(e.conversation_id)) return { billed: true }
    if (e.status === 'ERROR') return { error: str(e.error)?.slice(0, 200) || 'agy failed' }
    const c = obj(e.command)
    if (e.status === 'SUCCESS' && c.name === 'usage' && Array.isArray(obj(c.data).groups)) return { windows: agyWindows(c.data) }
  }
  return {}
}

// each group's buckets (its week, its 5 hours), the 5-hour ones first: the ring reads a row's first window
export function agyWindows(d: unknown): UsageWindow[] {
  const out: UsageWindow[] = []
  for (const g of list(obj(d).groups).map(obj)) {
    const group = str(g.name)?.replace(/\s+models$/i, '') ?? ''
    for (const b of list(g.buckets).map(obj)) {
      const left = num(b.remaining_fraction)
      if (b.disabled === true || left === undefined) continue // disabled: not metered
      const span = b.window === '5h' ? '5-hour' : b.window === 'weekly' ? 'Weekly' : str(b.name) || 'Limit'
      out.push({ label: group ? `${span} · ${group}` : span, used: pct((1 - Math.min(1, Math.max(0, left))) * 100), resets: when(b.reset_time) })
    }
  }
  return out.sort((a, b) => Number(!a.label.startsWith('5-hour')) - Number(!b.label.startsWith('5-hour')))
}

async function gemini(): Promise<Got> {
  if (agyBilled) return { windows: [], error: BILLED }
  const env = { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' } // no update mid-check
  const cmd = (args: string[], timeout: number) => {
    const p = run('agy', args, { timeout, maxBuffer: 512 << 10, env, cwd: tmpdir() })
    p.child.stdin?.end() // print mode reads stdin: nothing comes
    return p.then(r => r.stdout)
  }
  if (!agyVersion || Date.now() - agyVersion.at > 6 * 3600e3) agyVersion = { at: Date.now(), v: await cmd(['--version'], 5000).then(o => /\d+\.\d+\.\d+/.exec(o)?.[0], () => undefined) }
  if (!agyVersion.v) return (agyVersion = undefined), { windows: [], error: 'agy didn’t say its version: is it installed?', again: true }
  if (newer(AGY_MIN, agyVersion.v)) return { windows: [], error: `agy ${agyVersion.v} spends a turn on /usage: update it to ${AGY_MIN} or newer (agy update)` }
  // never --disable-slash-commands: agy then sends /usage as a prompt, billed (Orca's note)
  let out: string
  try {
    out = await cmd(['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s'], 30_000).catch((e: unknown) => str(obj(e).stdout) || Promise.reject(e))
  } catch (e) {
    const x = obj(e)
    return { windows: [], error: x.killed ? 'No answer from agy in 30 seconds' : x.code === 'ENOENT' ? 'agy isn’t on PATH' : 'agy failed', again: true }
  }
  const r = agyRead(out)
  if (r.billed) return (agyBilled = true), { windows: [], error: BILLED }
  if (r.error) return { windows: [], error: /sign|login|auth|credential/i.test(r.error) ? 'Not signed in: run agy, then sign in' : r.error, again: true }
  if (!r.windows) return { windows: [], error: 'Unexpected answer from agy', again: true }
  return { windows: r.windows, error: r.windows.length ? undefined : 'This plan shows no limits' }
}

// ---------- each agent's answer, kept for its TTL (AGAIN or BACK_OFF when it says so); callers asking meanwhile share
// one request; last: its last answer with numbers, shown while the server says to wait

type Entry = { at: number; ttl: number; p?: Promise<AgentUsage>; slows?: number }
const cache = new Map<string, Entry>()
const last = new Map<string, AgentUsage>()

// on: Settings' usage. R4: an agent's usage endpoint (undocumented, with its own sign-in) is asked only when set to
// true; else its numbers are what it says itself (own: meters.ts' statusLimits, claude's status line and codex's
// transcripts, of any age: at says when), and an agent with neither isn't listed. who: each agent's accounts,
// its own first; asked, own's fresh numbers win over the endpoint's, which is still asked on its TTL: only it has the
// per-model windows (Claude's Fable week: the status line has the 5-hour and the week alone). Grok's server is asked
// only when set to true too; agy's own /usage (Laki reads no token of its, and it takes no turn) unless set to false
const SAYS: Record<string, string> = {
  claude: "No numbers yet: they come with Claude Code's status line, as a tab works (Settings › Layout › Read Claude's status line)",
  codex: 'No numbers yet: they come with what Codex reports as a tab works',
  grok: 'Laki asks grok.com for these only when you say so: Settings › Layout › Ask grok.com',
}
const OWN_CMD: Record<string, true> = { gemini: true }
const asksOf = (on: Record<string, boolean>, agent: string) => (OWN_CMD[agent] ? on[agent] !== false : on[agent] === true)
export function usage(on: Record<string, boolean> = {}, who: Who[] = [], now = Date.now(), own?: (w: Who, now: number, any?: boolean) => { windows: UsageWindow[]; at: number } | undefined): Promise<AgentUsage[]> {
  return Promise.all(
    who.filter(w => LOADERS[w.agent] && (asksOf(on, w.agent) || SAYS[w.agent])).map(w => {
      const key = `${w.agent}:${w.dir ?? ''}`
      const mine = (r: Omit<AgentUsage, 'account' | 'name' | 'default'>): AgentUsage => ({ ...r, account: w.account, name: w.name, default: w.default })
      const asks = asksOf(on, w.agent)
      const said = own?.(w, now, !asks)
      if (!said && !asks) return Promise.resolve(mine({ agent: w.agent, windows: [], at: now, error: SAYS[w.agent], source: 'own' }))
      if (!said) return ask(w, key, now).then(mine) // a rename, another default: now's
      // ponytail: the endpoint's other windows (per model, extra usage) and plan as it last read them, under own's time:
      // a 429 can hold them hours with no As of; asked again on its TTL, waited for only while there's no read yet
      const asked = asks && ask(w, key, now)
      const wait: Promise<unknown> = asked && !last.has(key) ? asked : Promise.resolve()
      return wait.then(() => {
        const had = asks ? last.get(key) : undefined
        return mine({ agent: w.agent, plan: had?.plan, windows: [...said.windows, ...(had?.windows ?? []).filter(x => !said.windows.some(y => y.label === x.label))], at: said.at, source: 'own' })
      })
    }),
  )
}

function ask(w: Who, key: string, now: number): Promise<AgentUsage> {
  const c = cache.get(key)
  if (c?.p && now - c.at < c.ttl) return c.p
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
      const got = { agent: w.agent, ...r, at: Date.now(), source: 'endpoint' as const }
      if (got.windows.length) last.set(key, got)
      return got
    },
    e => ((entry.ttl = AGAIN), { agent: w.agent, windows: [], error: failed(e), at: Date.now() }),
  )
  cache.set(key, entry)
  return entry.p
}
