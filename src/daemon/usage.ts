// The agents' plan limits for the status bar's ring (Usage.tsx): Claude's 5-hour and weekly windows, Codex's, Gemini
// CLI's per model.
// Read the way Superset, CodexBar and others do: the sign-in the agent already keeps on this Mac (Claude Code's
// Keychain item or ~/.claude/.credentials.json, Codex's ~/.codex/auth.json), sent to the endpoint the agent's own
// /usage screen asks. Read-only: a token is never refreshed (a second client refreshing it can sign the agent out);
// an expired one waits for the agent's next run (Gemini's: refreshed in memory, below).
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
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
const LOADERS: Record<string, (dir?: string) => Promise<Got>> = { claude, codex, gemini }

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

// ---------- Gemini CLI: Code Assist's quota per model (CodeNomad's way: NeuralNomadsAI/CodeNomad#1312)
// its sign-in, ~/.gemini/oauth_creds.json (GEMINI_CLI_HOME's .gemini), read only. An expired token is refreshed at
// Google's token endpoint with Gemini CLI's own client, read from its install (geminiClient), the new token kept in
// memory only: nothing is written under ~/.gemini. Its project: GOOGLE_CLOUD_PROJECT, else loadCodeAssist's (asked
// once). An API-key user (its settings.json's pick), or any failure: unknown, said plainly, never an error. Each
// bucket's remainingFraction a window, the model its label (gemini(), below)

// Gemini CLI's sign-in client (an installed app's ID and secret: only they renew its sign-in), read from the gemini on
// PATH each time a token is renewed, never kept in Laki's code or files: its bin's real path (a one-file bundle has
// them), else its core's code_assist/oauth2.js in a node_modules at or above it (its own, or the global one). None: unknown.
// ponytail: a shim (asdf, volta) isn't followed to its package, nor a release that renames OAUTH_CLIENT_ID
async function geminiClient(): Promise<{ client_id: string; client_secret: string } | undefined> {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    const real = d && (await realpath(join(d, 'gemini')).catch(() => ''))
    if (!real) continue
    const files = [real]
    for (let at = dirname(real); dirname(at) !== at; at = dirname(at)) files.push(join(at, 'node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js'))
    for (const f of files) {
      const t = await readFile(f, 'utf8').catch(() => '')
      const [id, secret] = ['ID', 'SECRET'].map(k => new RegExp(`OAUTH_CLIENT_${k}\\w*\\s*=\\s*['"]([^'"]+)['"]`).exec(t)?.[1])
      if (id && secret) return { client_id: id, client_secret: secret }
    }
    return // the first gemini on PATH, as a shell would run
  }
}
const geminiDir = () => join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini')
export const geminiSigned = () => existsSync(join(geminiDir(), 'oauth_creds.json'))
const geminiToken = new Map<string, { access: string; expires: number }>() // by its refresh token's hash
const geminiProject = new Map<string, string>() // by its refresh token's hash: another sign-in, another project

export function geminiWindows(u: any): UsageWindow[] {
  const out: UsageWindow[] = []
  for (const b of Array.isArray(u?.buckets) ? u.buckets : []) {
    const f = b?.remainingFraction
    if (typeof b?.modelId !== 'string' || typeof f !== 'number' || !(f >= 0 && f <= 1)) continue
    const model = b.modelId.replace(/^models\//, '')
    const label = out.some(w => w.label === model) && typeof b.tokenType === 'string' ? `${model} · ${b.tokenType.toLowerCase()}` : model
    if (!out.some(w => w.label === label)) out.push({ label, used: pct(100 - f * 100), resets: when(b.resetTime) })
  }
  return out
}

async function gemini(): Promise<Got> {
  const unknown = (why: string): Got => ({ windows: [], error: `Unknown: ${why}`, again: true })
  const set = await readFile(join(geminiDir(), 'settings.json'), 'utf8').then(t => JSON.parse(t), () => ({}))
  const how = set?.security?.auth?.selectedType ?? set?.selectedAuthType // gemini's sign-in pick, newer or older
  if (how === 'gemini-api-key' || how === 'vertex-ai') return unknown('signed in with an API key (billed per token, no quota to read)')
  let c: any
  try {
    c = JSON.parse(await readFile(join(geminiDir(), 'oauth_creds.json'), 'utf8'))
  } catch {
    return unknown('not signed in with Google: run gemini')
  }
  try {
    const key = createHash('sha256').update(String(c?.refresh_token ?? '')).digest('hex')
    const kept = geminiToken.get(key)
    const soon = Date.now() + 60_000
    let access: string | undefined = typeof c?.access_token === 'string' && c.access_token && Number(c.expiry_date) > soon ? c.access_token : kept && kept.expires > soon ? kept.access : undefined
    if (!access) {
      if (typeof c?.refresh_token !== 'string' || !c.refresh_token) return unknown('the sign-in expired: gemini renews it on its next run')
      const app = await geminiClient()
      if (!app) return unknown('the sign-in expired: gemini renews it on its next run')
      const at = Date.now()
      const r = await get(`${base('https://oauth2.googleapis.com')}/token`, { 'Content-Type': 'application/x-www-form-urlencoded' }, 'Sign-in expired: gemini renews it on its next run', 'Google', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh_token, ...app }).toString())
      if (typeof r?.access_token !== 'string' || typeof r.expires_in !== 'number') return unknown('Google gave no token')
      geminiToken.set(key, { access: r.access_token, expires: at + r.expires_in * 1000 }) // never its refresh token
      access = r.access_token
    }
    const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }
    const ca = base('https://cloudcode-pa.googleapis.com')
    const project = process.env.GOOGLE_CLOUD_PROJECT || geminiProject.get(key) || ((await get(`${ca}/v1internal:loadCodeAssist`, headers, 'Sign-in expired', 'Google', JSON.stringify({ metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } })))?.cloudaicompanionProject as string | undefined) || undefined
    if (!project) return unknown('no Code Assist project for this sign-in')
    geminiProject.set(key, project)
    const windows = geminiWindows(await get(`${ca}/v1internal:retrieveUserQuota`, headers, 'Sign-in expired', 'Google', JSON.stringify({ project })))
    return windows.length ? { windows } : unknown('Google shows no quota for this sign-in')
  } catch (e: any) {
    return e?.busy !== undefined ? fail(e) : unknown(failed(e)) // told to wait: waitOf's; anything else: unknown
  }
}

// ---------- each agent's answer, kept for its TTL (AGAIN or BACK_OFF when it says so); callers asking meanwhile share
// one request; last: its last answer with numbers, shown while the server says to wait

type Entry = { at: number; ttl: number; p?: Promise<AgentUsage>; slows?: number }
const cache = new Map<string, Entry>()
const last = new Map<string, AgentUsage>()

// on: Settings' usage. R4: an agent's usage endpoint (undocumented, with its own sign-in) is asked only when set to
// true; else its numbers are what it says itself (own: meters.ts' statusLimits, claude's status line and codex's
// transcripts, of any age: at says when), and an agent with neither (gemini) isn't listed. who: each agent's accounts,
// its own first; asked, own's fresh numbers win over the endpoint's
const SAYS: Record<string, string> = { claude: "No numbers yet: they come with Claude Code's status line, as a tab works (Settings › Appearance › Read Claude's status line)", codex: 'No numbers yet: they come with what Codex reports as a tab works' }
export function usage(on: Record<string, boolean> = {}, who: Who[] = [], now = Date.now(), own?: (w: Who, now: number, any?: boolean) => { windows: UsageWindow[]; at: number } | undefined): Promise<AgentUsage[]> {
  return Promise.all(
    who.filter(w => LOADERS[w.agent] && (on[w.agent] === true || SAYS[w.agent])).map(w => {
      const key = `${w.agent}:${w.dir ?? ''}`
      const mine = (r: Omit<AgentUsage, 'account' | 'name' | 'default'>): AgentUsage => ({ ...r, account: w.account, name: w.name, default: w.default })
      const asks = on[w.agent] === true
      const said = own?.(w, now, !asks)
      if (!said && !asks) return Promise.resolve(mine({ agent: w.agent, windows: [], at: now, error: SAYS[w.agent], source: 'own' }))
      if (said) {
        // ponytail: the endpoint's other windows (per model, extra usage) as it last read them, while it's asked; its plan likewise
        const had = asks ? last.get(key) : undefined
        return Promise.resolve(mine({ agent: w.agent, plan: had?.plan, windows: [...said.windows, ...(had?.windows ?? []).filter(x => !said.windows.some(y => y.label === x.label))], at: said.at, source: 'own' }))
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
          const got = { agent: w.agent, ...r, at: Date.now(), source: 'endpoint' as const }
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
