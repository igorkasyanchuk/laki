// The agents' plan limits for the status bar's ring (Usage.tsx): Claude's 5-hour and weekly windows, Codex's, Grok's
// week, Antigravity's per model group. Read the way Superset, CodexBar, Orca and others do: the sign-in the agent
// already keeps on this Mac (Claude Code's Keychain item or ~/.claude/.credentials.json, Grok's ~/.grok/auth.json; Codex's
// ~/.codex/auth.json only for an older codex, asked for), sent to the endpoint the agent's own /usage screen asks;
// Codex's from its own app server and Antigravity's from agy's own /usage command (each signs in itself: Laki reads no
// token of theirs). Read-only: a token is never refreshed (a second client refreshing it can sign the agent out); an
// expired one waits for the agent's next run. test/usage.test.ts' guard holds it: turned away (401), no token URL is
// asked and the Keychain item, ~/.claude/.credentials.json and $CODEX_HOME/auth.json are byte for byte as they were.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { type AgentUsage, HOME_ACCOUNT, type QuotaSource, type UsageWindow } from '../shared/types.ts'
import { getFollow, localUrl } from './netAddr.ts'
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

type Got = Omit<AgentUsage, 'agent' | 'at'> & { again?: boolean; busy?: number; ttl?: number } // busy: told to slow down, its Retry-After (ms, 0: none); ttl: kept this long (else the agent's)
// whose limits: an agent's own sign-in (no dir) or an account's folder (accounts.ts)
export type Who = { agent: string; account: string; name: string; dir?: string; default: boolean }
const LOADERS: Record<string, (dir?: string, on?: Record<string, boolean>) => Promise<Got>> = { claude, codex, grok, gemini }

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
  for (const m of Array.isArray(u?.model_scoped) ? u.model_scoped : []) if (typeof m?.display_name === 'string' && m.display_name) add(`Weekly · ${m.display_name}`, m.utilization, when(m.resets_at)) // get_usage's per-model weeks
  // get_usage's spend: only when its used and limit are in one currency at one scale (a ratio of minor units, T3 Code's rule)
  const s = u?.spend
  type Minor = { amount_minor: number; currency: string; exponent: number }
  const minor = (v: unknown): Minor | undefined => (x => (typeof x.amount_minor === 'number' && typeof x.currency === 'string' && x.currency.trim() && Number.isInteger(x.exponent) && (x.exponent as number) >= 0 ? (x as Minor) : undefined))(obj(v))
  const [su, sl] = [minor(s?.used), minor(s?.limit)]
  if (s?.enabled === true && su && sl && su.currency.trim() === sl.currency.trim() && su.exponent === sl.exponent && sl.amount_minor > 0) {
    const money = (v: { amount_minor: number; exponent: number }) => v.amount_minor / 10 ** v.exponent
    add('Extra usage', (su.amount_minor / sl.amount_minor) * 100, undefined, `${money(su).toFixed(2)} of ${money(sl).toFixed(0)} ${su.currency.trim()}/mo`)
  }
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

// Claude Code's own: claude -p's control requests, initialize then get_usage (as T3 Code and emdash ask it), with the
// account's folder: claude reads its own sign-in, Laki none of it; no prompt, nothing billed, no session kept, its hooks
// off; skip_behaviors, or it first reads 7 days of transcripts. rate_limits: the endpoint's shape (claudeWindows), its
// model_scoped weeks and spend too; subscription_type its plan. rate_limits_available false, or a sign-in that isn't
// Anthropic's own (initialize's account.apiProvider): none. An error or no answer in CLAUDE_MS: said, the last good
// reading kept (ask). ponytail: get_usage is marked experimental by Claude Code ("the response shape may change"): read
// defensively, its shape as claude 2.1.332 said it (2026-11-28); a change reads as no windows (the endpoint then, if on)
const CLAUDE_MS = Number(process.env.LAKI_CLAUDE_USAGE_MS) || 20_000 // the env: tests'
const OLDER_CLAUDE = 'This Claude Code doesn’t say its limits: update it, or ask api.anthropic.com with your sign-in'
async function claudeOwn(d?: string): Promise<Got> {
  const env = { ...process.env, ...(d && { CLAUDE_CONFIG_DIR: d }) }
  const req = (id: string, request: object) => ({ type: 'control_request', request_id: id, request })
  let init: Obj | undefined
  let r: Obj
  try {
    r = await asked('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--settings', '{"disableAllHooks":true}'], env, [req('laki-init', { subtype: 'initialize' }), req('laki-usage', { subtype: 'get_usage', skip_behaviors: true })], (m: unknown) => {
      const x = obj(obj(m).response)
      if (obj(m).type !== 'control_response') return
      if (x.request_id === 'laki-init') init = x
      else if (x.request_id === 'laki-usage') return x
    }, 'its limits', CLAUDE_MS)
  } catch (e) {
    const x = e as { code?: string }
    return { windows: [], error: x.code === 'ENOENT' ? 'Claude Code isn’t installed' : failed(e), again: true }
  }
  if (r.subtype !== 'success') {
    const why = String(r.error ?? 'an error')
    return UNKNOWN.test(why) || /subtype/i.test(why) ? { windows: [], error: OLDER_CLAUDE } : { windows: [], error: `Claude Code: ${why.slice(0, 160)}`, again: true }
  }
  const u = obj(r.response)
  const provider = str(obj(obj(init?.response).account).apiProvider)
  const plan = str(u.subscription_type)
  if ((provider && provider !== 'firstParty') || u.rate_limits_available === false) return { plan, windows: [], error: 'No plan limits for this sign-in' }
  const windows = claudeWindows(u.rate_limits)
  return { plan, windows, error: windows.length ? undefined : 'This plan shows no limits', ttl: USAGE_TTL }
}
// on.claude: unset, Claude Code's own (get_usage); true, the endpoint too when that gave no windows; false: neither
async function claude(d?: string, on: Record<string, boolean> = {}): Promise<Got> {
  const own = await claudeOwn(d)
  return own.windows.length || on.claude !== true ? own : claudeEndpoint(d)
}
async function claudeEndpoint(d?: string): Promise<Got> {
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

// a command spoken to on its stdio (JSON lines: send, stdin kept open: claude ends with it; each line it says given to
// take until take says something), killed
// as take has its answer, as it ends, or after ms; what: what it was asked for, in the errors. No shell. accounts.ts'
// agentModels (codex's model/list, claude's initialize) and codex's limits here
export function asked<T>(cmd: string, args: string[], env: NodeJS.ProcessEnv, send: object[], take: (m: any) => T | undefined, what = 'its models', ms = 20_000): Promise<T> {
  return new Promise((ok, no) => {
    const c = spawn(cmd, args, { env, cwd: homedir(), stdio: ['pipe', 'pipe', 'ignore'] })
    const end = (f: () => void) => (clearTimeout(t), c.kill(), f())
    const t = setTimeout(() => end(() => no(Object.assign(new Error(`${cmd} didn't say ${what} in ${ms / 1000} seconds`), { timeout: true }))), ms)
    let buf = ''
    c.on('error', e => end(() => no(Object.assign(new Error(`${cmd}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed' : e.message}`), { code: (e as NodeJS.ErrnoException).code }))))
    c.on('close', () => end(() => no(new Error(`${cmd} ended without ${what}`)))) // close: after its output was read
    c.stdin.on('error', () => {}) // it went first: exit says so
    c.stdout.setEncoding('utf8').on('data', (d: string) => {
      buf += d
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: unknown
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        const r = take(m)
        if (r !== undefined) return end(() => ok(r))
      }
      if (buf.length > 4 << 20) end(() => no(new Error(`${cmd} said too much`)))
    })
    for (const m of send) c.stdin.write(`${JSON.stringify(m)}\n`)
  })
}

// ---------- Codex: its own app server, else (asked for: usage.codex true) chatgpt.com's wham/usage

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

// codex app-server's account/rateLimits/read: its main limit's windows (rateLimits), each other limit's with its name
// (rateLimitsByLimitId), as codexRateWindows reads a transcript's (camelCase here, resetsAt in seconds)
type AppWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null
type AppLimit = { limitId?: unknown; limitName?: unknown; primary?: AppWindow; secondary?: AppWindow; planType?: unknown } | null
type AppLimits = { rateLimits?: AppLimit; rateLimitsByLimitId?: unknown } | null | undefined
export function codexAppWindows(r: AppLimits): UsageWindow[] {
  const out: UsageWindow[] = []
  const add = (l: AppLimit | undefined, name?: string) => {
    for (const w of [l?.primary, l?.secondary]) {
      if (typeof w?.usedPercent !== 'number') continue
      const label = span(typeof w.windowDurationMins === 'number' ? w.windowDurationMins * 60 : undefined)
      out.push({ label: name ? `${label} · ${name}` : label, used: pct(w.usedPercent), resets: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : undefined })
    }
  }
  const main = r?.rateLimits
  add(main)
  for (const [id, l] of Object.entries((r?.rateLimitsByLimitId && typeof r.rateLimitsByLimitId === 'object' ? r.rateLimitsByLimitId : {}) as Record<string, AppLimit>)) if (id !== main?.limitId) add(l, str(l?.limitName) || id)
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

// codex app-server (the account's CODEX_HOME): initialize, initialized, account/rateLimits/read, its answer or 15 s;
// codex reads its own sign-in, Laki none of it. ~0.65 s to its answer, 0.15 s of CPU (3.6 s the first time in a while:
// docs/dev/scans.md). A codex that doesn't know the method (or isn't installed): chatgpt.com, only when asked for
const APP_MS = Number(process.env.LAKI_CODEX_APP_MS) || 15_000 // the env: tests'
const UNKNOWN = /unknown (variant|method)|method not found|not supported|unrecognized/i
async function codex(d?: string, on: Record<string, boolean> = {}): Promise<Got> {
  const env = { ...process.env, ...(d && { CODEX_HOME: d }) }
  const older = () => (on.codex === true ? codexWham(d) : { windows: [], error: 'This Codex doesn’t say its limits: update it, or ask chatgpt.com with your sign-in' })
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'laki', title: 'Laki', version: '1' } } }
  let m: { error?: { code?: unknown; message?: unknown }; result?: AppLimits & { rateLimits?: AppLimit } }
  try {
    m = await asked('codex', ['app-server'], env, [init, { jsonrpc: '2.0', method: 'initialized' }, { jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' }], (x: { id?: unknown; error?: unknown }) => (x?.id === 2 || (x?.id === 1 && x.error) ? (x as typeof m) : undefined), 'its limits', APP_MS)
  } catch (e) {
    const x = e as { code?: string; timeout?: boolean }
    if (x.code === 'ENOENT') return on.codex === true ? codexWham(d) : { windows: [], error: 'Codex isn’t installed', again: true }
    if (!x.timeout) return older() // it ended without an answer: a codex with no app-server
    return fail(e)
  }
  const err = m.error
  if (err) {
    const why = String(err.message ?? err.code ?? 'an error')
    if (err.code === -32601 || UNKNOWN.test(why)) return older()
    if (/429|too many requests|rate.?limit/i.test(why)) return { windows: [], error: 'OpenAI asked Laki to check less often', busy: 0 }
    return { windows: [], error: `Codex: ${why.slice(0, 160)}`, again: true }
  }
  const windows = codexAppWindows(m.result)
  return { plan: str(m.result?.rateLimits?.planType), windows, error: windows.length ? undefined : 'This plan shows no limits' }
}
async function codexWham(d?: string): Promise<Got> {
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

// ---------- quota sources (settings.quotaSources, Settings › Usage › Add a quota source), for every other provider's or hub's limits
// in T3 Code's HTTP quota format (its docs/user/usage.md): { version: 1, accounts: [{ id, label, windows: [{ id, kind:
// session|weekly|monthly|other, label, usedPercent, resetsAt? }] }] }, GET every 5 minutes with its token as a Bearer (the
// Keychain's, quota-<id>: never state.json, a log or the view), through netAddr's getFollow (https, a public address,
// each redirect checked again; a URL on this Mac, a local hub, asked directly). Each account a row (agent and source
// 'quota'); another version or shape: one row with the error. At most QUOTA_MAX sources, accounts and windows each.
// No reader of Laki's own takes another app's token (Copilot, Cursor, z.ai…): a quota source covers them
export const QUOTA_MAX = 8
const KIND: Record<string, string> = { session: 'Session', weekly: 'Weekly', monthly: 'Monthly', other: 'Limit' }
export function quotaRead(doc: unknown): { accounts: { id: string; label: string; windows: UsageWindow[] }[] } | { error: string } {
  const d = obj(doc)
  const bad = (why: string) => ({ error: `Not a quota document Laki reads: ${why}` })
  if (d.version !== 1) return bad(`version ${JSON.stringify(d.version ?? null)}, not 1`)
  if (!Array.isArray(d.accounts)) return bad('no accounts')
  const accounts: { id: string; label: string; windows: UsageWindow[] }[] = []
  for (const a of d.accounts.slice(0, QUOTA_MAX).map(obj)) {
    const id = str(a.id)
    if (!id || !Array.isArray(a.windows)) return bad('an account with no id or windows')
    const windows: UsageWindow[] = []
    for (const w of a.windows.slice(0, QUOTA_MAX).map(obj)) {
      const used = num(w.usedPercent)
      if (used === undefined || !Object.hasOwn(KIND, String(w.kind))) return bad('a window with no usedPercent or kind')
      windows.push({ label: (str(w.label)?.trim() || KIND[String(w.kind)]).slice(0, 40), used: pct(Math.min(100, used)), resets: when(w.resetsAt) })
    }
    accounts.push({ id: id.slice(0, 80), label: (str(a.label)?.trim() || id).slice(0, 80), windows })
  }
  return { accounts }
}
async function quotaGet(s: QuotaSource, token: string): Promise<AgentUsage[]> {
  const row = (r: Partial<AgentUsage>): AgentUsage => ({ agent: 'quota', source: 'quota', windows: [], at: Date.now(), account: s.id, name: s.name, ...r })
  try {
    const signal = AbortSignal.timeout(10_000)
    const headers: Record<string, string> = { Accept: 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }
    let status: number
    let body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
    if (localUrl(s.url)) {
      const r = await fetch(s.url, { signal, headers, redirect: 'error' })
      ;[status, body] = [r.status, r.body ?? []]
    } else {
      const r = await getFollow(s.url, signal, headers)
      ;[status, body] = [r.statusCode ?? 0, r]
    }
    if (status === 401 || status === 403) return [row({ error: 'Turned away: check its token (Settings › Usage)' })]
    if (status < 200 || status > 299) return [row({ error: `HTTP ${status}` })]
    const parts: Buffer[] = []
    let size = 0
    for await (const b of body) {
      if ((size += b.length) > 1 << 20) throw new Error('more than 1 MB')
      parts.push(Buffer.from(b))
    }
    let doc: unknown
    try {
      doc = JSON.parse(Buffer.concat(parts).toString('utf8'))
    } catch {
      return [row({ error: 'Not JSON' })]
    }
    const r = quotaRead(doc)
    if ('error' in r) return [row({ error: r.error })]
    return r.accounts.map(a => row({ account: `${s.id}:${a.id}`, name: `${s.name} · ${a.label}`, windows: a.windows, ...(!a.windows.length && { error: 'No limits said' }) }))
  } catch (e) {
    return [row({ error: failed(e) })]
  }
}
const quotaKept = new Map<string, { at: number; url: string; p: Promise<AgentUsage[]> }>()
export const quotaForget = (id: string) => quotaKept.delete(id) // its URL or token changed: asked again
export function quotaUsage(sources: QuotaSource[] | undefined, token: (id: string) => string, now = Date.now()): Promise<AgentUsage[]> {
  return Promise.all(
    (sources ?? []).slice(0, QUOTA_MAX).map(s => {
      const c = quotaKept.get(s.id)
      if (c && c.url === s.url && now - c.at < USAGE_TTL) return c.p
      const p = quotaGet(s, token(s.id))
      quotaKept.set(s.id, { at: now, url: s.url, p })
      return p
    }),
  ).then(x => x.flat())
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
const OWN_CMD: Record<string, true> = { gemini: true, codex: true, claude: true } // asked unless off: the agent's own command, no token of its read
const asksOf = (on: Record<string, boolean>, agent: string) => (OWN_CMD[agent] ? on[agent] !== false : on[agent] === true)
export function usage(on: Record<string, boolean> = {}, who: Who[] = [], now = Date.now(), own?: (w: Who, now: number, any?: boolean) => { windows: UsageWindow[]; at: number } | undefined): Promise<AgentUsage[]> {
  return Promise.all(
    who.filter(w => LOADERS[w.agent] && (asksOf(on, w.agent) || SAYS[w.agent])).map(w => {
      const key = `${w.agent}:${w.dir ?? ''}`
      const mine = (r: Omit<AgentUsage, 'account' | 'name' | 'default'>): AgentUsage => ({ ...r, account: w.account, name: w.name, default: w.default })
      const asks = asksOf(on, w.agent)
      const said = own?.(w, now, !asks)
      if (!said && !asks) return Promise.resolve(mine({ agent: w.agent, windows: [], at: now, error: SAYS[w.agent], source: 'own' }))
      if (!said) return ask(w, key, now, on).then(mine) // a rename, another default: now's
      // ponytail: the endpoint's other windows (per model, extra usage) and plan as it last read them, under own's time:
      // a 429 can hold them hours with no As of; asked again on its TTL, waited for only while there's no read yet
      const got = asks && ask(w, key, now, on)
      const wait: Promise<unknown> = got && !last.has(key) ? got : Promise.resolve()
      return wait.then(() => {
        const had = asks ? last.get(key) : undefined
        return mine({ agent: w.agent, plan: had?.plan, windows: [...said.windows, ...(had?.windows ?? []).filter(x => !said.windows.some(y => y.label === x.label))], at: said.at, source: 'own' })
      })
    }),
  )
}

function ask(w: Who, key: string, now: number, on: Record<string, boolean>): Promise<AgentUsage> {
  const c = cache.get(key)
  if (c?.p && now - c.at < c.ttl) return c.p
  const entry: Entry = { at: now, ttl: TTL[w.agent] ?? USAGE_TTL }
  entry.p = LOADERS[w.agent](w.dir, on).then(
    ({ again, busy, ttl, ...r }) => {
      if (ttl) entry.ttl = ttl
      if (again) entry.ttl = AGAIN
      // failed on the way (an error, no answer): said, with the last good reading kept
      const had = last.get(key)
      if (again && r.error && !r.windows.length && had) return { ...had, error: r.error }
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
