// Secret values out of state.json: a secret-looking variable (shared/env.ts secretLooking) in Settings' env, a
// profile's, a project's or one of its MCP servers', and the phone push's URL and reply topic (a token in either), kept
// by keychain.ts as Laki AI's keys are (the Keychain on a signed release with the default data folder, else a 0600 file
// of its own in <data>/env-keys); a value that is a secret whatever its name too (shared/env.ts secretValue: a URL with
// a password, a token's shape). state.json keeps the name, its value null. In memory the state is whole, so every
// place that builds an env (childEnv, scripts, ai.ts…) reads it as before: load() restores (envRestore), save() stores
// what's new or changed and drops what's gone (envStash), then writes the copy with them null (envJson). No core
// import: tested through the daemon (test/env-keys.test.ts)
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { secretLooking, secretValue } from '../shared/env.ts'
import { dir } from './dir.ts'
import { keyRead, keyWrite } from './keychain.ts'

type Holder = Record<string, unknown>
type Spot = { key: string; at: Holder; field: string }
type S = { settings?: { env?: Holder; presets?: { name: string; env?: Holder }[] | null; webhook?: Holder; mcp?: { name: string; env?: Holder }[] }; projects?: { id: string; config?: { env?: Holder; mcp?: { name: string; env?: Holder }[] } }[] }

// every place a secret can sit, by its key-store name; a value of any kind (null: kept, its value in the store)
function spots(s: S): Spot[] {
  const out: Spot[] = []
  // a secret's name, or its value (secretValue: a URL's password, a token's shape); null: one kept already; one the store
  // has or couldn't give: still its, whatever it reads now (never back into state.json by a change of shape)
  const env = (key: string, at?: Holder) => {
    if (at && typeof at === 'object')
      for (const [k, v] of Object.entries(at)) {
        const name = `${key}:${k}`
        if (secretLooking(k) || v === null || stored.has(name) || unread.has(name) || (typeof v === 'string' && secretValue(v))) out.push({ key: name, at, field: k })
      }
  }
  env('env', s.settings?.env)
  for (const p of s.settings?.presets ?? []) env(`env:profile:${p?.name}`, p?.env)
  for (const m of s.settings?.mcp ?? []) env(`env:mcp:${m?.name}`, m?.env) // #6: every project's MCP servers'
  for (const p of s.projects ?? []) {
    env(`env:project:${p.id}`, p.config?.env)
    for (const m of p.config?.mcp ?? []) env(`env:project:${p.id}:mcp:${m?.name}`, m?.env)
  }
  const w = s.settings?.webhook
  if (w && typeof w === 'object') for (const f of ['url', 'replyTopic']) if (f in w) out.push({ key: `push:${f}`, at: w, field: f })
  return out
}
// its own file when the Keychain isn't used: by the name's hash (a profile's name can be anything)
const fileOf = (key: string) => join(dir, 'env-keys', createHash('sha256').update(key).digest('hex').slice(0, 32))
const stored = new Map<string, string>() // what the store has, by key: written or read here
// ponytail: one the store didn't give as Laki started (the Keychain didn't answer, or it's gone): '' in memory, still
// null in state.json, never removed from the store, until it's set again; its tabs miss it until then
const unread = new Set<string>()

// load: each null filled from the store; a value still in state.json (from before, or a restored v1 backup) moved into
// it (keychain.ts reads it back), and the caller saves at once so it leaves the file. true: something moved
export function envRestore(s: S): boolean {
  let moved = false
  for (const p of spots(s)) {
    const v = p.at[p.field]
    if (v === null) {
      const got = keyRead(p.key, fileOf(p.key))
      p.at[p.field] = got
      if (got) stored.set(p.key, got)
      else unread.add(p.key)
    } else if (typeof v === 'string' && v) {
      put(p.key, v)
      moved = true
    }
  }
  return moved
}
const put = (key: string, v: string) => {
  mkdirSync(join(dir, 'env-keys'), { recursive: true, mode: 0o700 })
  keyWrite(key, fileOf(key), v)
  stored.set(key, v)
  unread.delete(key)
}
// save: new and changed values into the store, gone ones out of it
export function envStash(s: S) {
  const now = new Set<string>()
  for (const p of spots(s)) {
    const v = p.at[p.field]
    if (typeof v !== 'string' || !v) {
      if (unread.has(p.key)) now.add(p.key)
      continue
    }
    now.add(p.key)
    if (stored.get(p.key) !== v) put(p.key, v)
  }
  for (const k of [...stored.keys(), ...unread]) if (!now.has(k)) keyWrite(k, fileOf(k), ''), stored.delete(k), unread.delete(k)
}
// state.json's text: what the store has, null (its name stays)
export function envJson(s: object, space?: number) {
  const held = new Map<Holder, Set<string>>()
  for (const p of spots(s as S)) if (stored.has(p.key) || unread.has(p.key)) (held.get(p.at) ?? held.set(p.at, new Set()).get(p.at)!).add(p.field)
  return JSON.stringify(s, function (this: Holder, k, v) {
    return held.get(this)?.has(k) ? null : v
  }, space)
}
// an older state's copy (state.json.bak-*, a newer Laki's set aside): its secret values null too, the store has today's
export function envScrub(text: string) {
  const s = JSON.parse(text) as S
  let had = false
  for (const p of spots(s)) if (typeof p.at[p.field] === 'string' && p.at[p.field]) (p.at[p.field] = null), (had = true)
  return had ? JSON.stringify(s, null, 2) : undefined
}
// the ones the store didn't give as Laki started (the Keychain locked or not answering), asked again (keychain.ts: a
// minute after the last try): each one it gives now filled in. core's envAgain, as an app window connects or comes to
// the front, throttled. left: still unread (the view's envUnread)
export function envRetry(s: S): { got: number; left: number } {
  let got = 0
  for (const p of spots(s)) {
    if (!unread.has(p.key)) continue
    const v = keyRead(p.key, fileOf(p.key))
    if (!v) continue
    p.at[p.field] = v
    stored.set(p.key, v)
    unread.delete(p.key)
    got++
  }
  return { got, left: unread.size }
}
export const envUnread = () => unread.size
// laki backup's manifest: the names whose values aren't in its state.json
export const envKept = () => [...stored.keys(), ...unread].sort()
