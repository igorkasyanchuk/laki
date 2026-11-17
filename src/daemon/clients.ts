// T1: trusted clients: an app outside Laki (a desktop app, its MCP server, a script of yours) that drives Laki through
// the CLI or laki mcp where the caller check finds no tab and no terminal (main.ts' whoCalls: WHO). Each has an id, a
// label (what Created by and daemon.log say) and scopes (main.ts' clientNo, gates.ts' CLIENT_READ and CLIENT_SCOPE). Its
// token, lakic_ and 32 random bytes in hex, is written once to <data>/clients/<id>.token (0600, the folder 0700);
// clients.json (0600) keeps only its SHA-256, compared in constant time. Made, rotated and rescoped only once you say yes
// in Laki's window (main.ts' clientAsk); revoked at once: the next call with it is refused. No core import: tested alone.
// ponytail: the file's 0600 keeps out other macOS users, not other programs running as you; the token gives a client an
// identity and limits, not a sandbox (SECURITY.md)
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CLIENT_GONE, readJson, writeAtomic } from '../shared/conn.ts'
import { dir } from './dir.ts'

export { CLIENT_GONE }
// what each scope lets a client do (the reads always): create and send unless said
export const SCOPES = {
  create: 'new workspaces and agent tabs',
  send: 'messages to agents (laki send, laki ask)',
  cmd: "commands: a command of its own (--cmd, a command profile), Run ▾, a terminal's screen or a send into it",
  yolo: 'agents that never ask (bypass permissions, approvals off), and messages to them',
  remove: 'archive and delete workspaces',
  ship: 'ship, and act on PRs (merge, approve, close)',
} as const
export type Scope = keyof typeof SCOPES
export const SCOPES_ON: Scope[] = ['create', 'send']
// T9, T11: how much a client may start and send (main.ts' clientLimit): workspaces (and agent tabs) in a sliding hour,
// agents running or waiting at once in its workspaces, messages in a sliding minute. Set as it's added (--limits),
// changed only by a rotate (the same Allow card)
export type Limits = { wsPerHour: number; agentsAtOnce: number; sendsPerMinute: number }
export const LIMITS: Limits = { wsPerHour: 10, agentsAtOnce: 3, sendsPerMinute: 50 }
const LIMIT_KEYS: Record<string, keyof Limits> = { ws: 'wsPerHour', agents: 'agentsAtOnce', send: 'sendsPerMinute' }
// --limits ws=10,agents=3,send=50 (any of them; the rest kept from `was`, else LIMITS)
export function limitsOf(v: unknown, was: Limits = LIMITS): Limits {
  if (v === undefined || v === null || v === '') return { ...was }
  const out = { ...was }
  for (const part of (Array.isArray(v) ? v.map(String) : String(v).split(',')).map(s => s.trim()).filter(Boolean)) {
    const [k, n] = part.split('=')
    const key = LIMIT_KEYS[k?.trim().toLowerCase() ?? '']
    const num = Number(n)
    if (!key || !Number.isInteger(num) || num < 1 || num > 10000) throw new Error(`--limits ${part}: ws=10,agents=3,send=50 (whole numbers from 1)`)
    out[key] = num
  }
  return out
}
// T9: a token lasts EXPIRE_DAYS from its making (a rotate: from then), or never when you pick that on the Allow card
export const EXPIRE_DAYS = 90
const DAY = 86400_000
export function expiresOf(v: unknown): number | 'never' {
  if (v === undefined || v === null || v === '') return EXPIRE_DAYS
  if (String(v).toLowerCase() === 'never') return 'never'
  const m = /^(\d{1,4})d?$/i.exec(String(v).trim())
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 3650) throw new Error(`--expires ${String(v)}: 30d, 90d (days, up to 3650) or never`)
  return Number(m[1])
}
// expires: when its token stops (ms), 'never'; one from before T9 counts from its making. lastAt, calls: its last call and
// how many (clientUsed, saved once a minute at most)
export type Client = { id: string; label: string; scopes: Scope[]; hash: string; at: number; projects?: string[]; expires?: number | 'never'; limits?: Limits; lastAt?: number; calls?: number } // projects: only these (their ids); none: every one
export const expiryOf = (c: Client) => (c.expires === 'never' ? undefined : (c.expires ?? c.at + EXPIRE_DAYS * DAY))
export const expired = (c: Client, now = Date.now()) => (e => e !== undefined && now >= e)(expiryOf(c))
export const limitsFor = (c: Client): Limits => ({ ...LIMITS, ...c.limits })
export const TOKEN_PREFIX = 'lakic_'

const listFile = () => join(dir, 'clients.json')
export const tokenPath = (id: string) => join(dir, 'clients', `${id}.token`)
let list: Client[] | undefined
const all = () => (list ??= (readJson<Client[]>(listFile()) ?? []).filter(c => c && typeof c.id === 'string' && typeof c.label === 'string' && /^[0-9a-f]{64}$/.test(String(c.hash)) && Array.isArray(c.scopes)))
const save = () => writeAtomic(listFile(), JSON.stringify(all(), null, 2), 0o600)
const sha = (t: string) => createHash('sha256').update(t).digest()
// as listed: never its hash; days left, unused (no call in 30 days, or none since a month after its making)
const shown = ({ hash: _, ...c }: Client, now = Date.now()) => (e => ({ ...c, limits: limitsFor(c as Client), file: tokenPath(c.id), ...(e !== undefined && { expiresAt: e, daysLeft: Math.max(0, Math.ceil((e - now) / DAY)) }), ...(now - (c.lastAt ?? c.at) > 30 * DAY && { unused: true }) }))(expiryOf(c as Client))

export const isClientToken = (t: unknown): t is string => typeof t === 'string' && t.startsWith(TOKEN_PREFIX)
// the client a call's token is of: none for any other token, nor for one revoked or rotated away
export function clientOf(token: unknown): Client | undefined {
  if (!isClientToken(token)) return
  const said = sha(token)
  return all().find(c => timingSafeEqual(Buffer.from(c.hash, 'hex'), said))
}
export function scopesOf(v: unknown): Scope[] {
  if (v === undefined || v === null || v === '') return [...SCOPES_ON]
  const said = (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim().toLowerCase()).filter(Boolean)
  const bad = said.filter(s => !Object.hasOwn(SCOPES, s))
  if (bad.length) throw new Error(`no scope ${bad.join(', ')}: ${Object.keys(SCOPES).join(', ')}`)
  return [...new Set(said)] as Scope[]
}
export function labelOf(v: unknown) {
  const l = String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!l) throw new Error('a name for it: laki client add "Grok Bot"')
  return l
}
// by its id or its name, any case
export function clientFind(ref: unknown) {
  const r = String(ref ?? '').trim().toLowerCase()
  const byId = all().find(x => x.id === r)
  const byName = all().find(x => x.label.toLowerCase() === r)
  if (byId && byName && byId !== byName) throw new Error(`${String(ref)} is ${byId.label}'s id (${byId.id}) and ${byName.label}'s name (${byName.id}): name one by the other: "${byId.label}" or ${byName.id}`)
  const c = byId ?? byName
  if (!c) throw new Error(`no client ${String(ref ?? '')}: laki client ls`)
  return c
}
export const clientName = (id: unknown) => all().find(c => c.id === id)?.label ?? String(id)
export const clientList = () => all().map(c => shown(c))
// a call it made: lastAt and calls, kept in memory and written once a minute at most (a client polling every second
// doesn't rewrite the file each time)
let savedAt = 0
let saveLater: NodeJS.Timeout | undefined
export function clientUsed(id: string, now = Date.now()) {
  const c = all().find(x => x.id === id)
  if (!c) return
  c.lastAt = now
  c.calls = (c.calls ?? 0) + 1
  if (now - savedAt >= 60_000) (savedAt = now), save()
  else saveLater ??= setTimeout(() => ((saveLater = undefined), (savedAt = Date.now()), save()), 60_000 - (now - savedAt)).unref()
}
// the calling client's own (laki mcp lists the tools its scopes allow): never its hash
export const clientWho = (id: unknown) => (c => c && { id: c.id, label: c.label, scopes: c.scopes, ...(c.projects && { projects: c.projects }) })(all().find(x => x.id === id))
// the id a new client of that name gets: its name in lowercase words, made unique (grok-bot, grok-bot-2)
export function clientIdFor(label: string) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'client'
  let id = base
  for (let n = 2; all().some(c => c.id === id); n++) id = `${base}-${n}`
  return id
}
// a new token, written once to its file (only its hash is kept): a new client's, or an existing one's (id: rotated, its
// old token dead at once)
export function clientMint(label: string, scopes: Scope[], id?: string, projects?: string[], o: { expires?: number | 'never'; limits?: Limits } = {}) {
  if (!id && all().some(c => c.label.toLowerCase() === label.toLowerCase())) throw new Error(`${label} is a client already: laki client rotate gives it a new token`)
  const cid = id ?? clientIdFor(label)
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex')
  mkdirSync(join(dir, 'clients'), { recursive: true, mode: 0o700 })
  chmodSync(join(dir, 'clients'), 0o700)
  writeAtomic(tokenPath(cid), `${token}\n`, 0o600)
  const was = all().find(x => x.id === cid)
  const now = Date.now()
  const days = o.expires ?? EXPIRE_DAYS
  const c: Client = { id: cid, label, scopes, hash: sha(token).toString('hex'), at: now, ...(projects?.length && { projects }), expires: days === 'never' ? 'never' : now + days * DAY, limits: o.limits ?? was?.limits ?? { ...LIMITS }, ...(was?.lastAt && { lastAt: was.lastAt, calls: was.calls }) }
  list = [...all().filter(x => x.id !== cid), c]
  save()
  return shown(c)
}
// revoked: its next call is refused, and its file goes
export function clientRm(ref: unknown) {
  const c = clientFind(ref)
  list = all().filter(x => x.id !== c.id)
  save()
  rmSync(tokenPath(c.id), { force: true })
  return shown(c)
}
