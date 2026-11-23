// An agent asks you for a secret (laki secret "Stripe key", MCP's laki_secret): a card at the foot of its tab, and its
// tab in Needs you, with a masked field. What you type goes to a 0600 file in the workspace's storage folder
// (.laki-secrets/, hidden: never an artifact) and the agent gets its path only, so the value never goes into the chat
// or the model's context. Files older than SECRET_HOURS go (secretsTidy, hourly). main.ts imports it; core keeps the
// ask on the tab's runtime (secret) for the view. ponytail: in memory, so a daemon restart drops an ask (the agent's
// command fails and it can ask again), and an agent stopped while it waits leaves the card up to SECRET_WAIT; this Mac's workspaces only (no storage folder on a host)

import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, rmSync, statSync, writeSync } from 'node:fs'
import { join, sep } from 'node:path'
import { SECRET_WAIT } from '../shared/types.ts'
import { broadcast, changed, log, rtOf, save, slug, state, storageOf, storageRoot, tracked } from './core.ts'
import { dir as dataDir } from './dir.ts'
import { keyRead, keyWrite } from './keychain.ts'
import { phone } from './phone.ts'

const SECRET_HOURS = 24
const SECRET_MAX = 64 << 10
export const SECRETS_DIR = '.laki-secrets'
const DIR = SECRETS_DIR
const asks = new Map<string, { tab: string; folder: string; label: string; project?: string; done: (r: { path?: string; refused?: string }) => void }>()

// a secret kept for next time (the card's Keep: this project, all projects): its value by keychain.ts (the Keychain, as
// Laki AI's keys, else a 0600 file in <data>/secrets), its name in state.secretsKept (Settings lists the names, Remove
// forgets one). An ask of the same name (by its slug) in that project, else any, shows it saved: one click gives it,
// never on its own. An agent can't list, read or forget them (gates.ts)
const norm = (label: string) => slug(label) || 'secret'
const scopeOf = (scope: string) => (scope === '*' ? '_all' : scope) // _: no project's id (a slug) has it
// the file's name joins them with a dot, which no slug has: shop + api-key and shop-api + key are two files
const keyOf = (k: { scope: string; label: string }) => ({ name: `secret:${scopeOf(k.scope)}:${norm(k.label)}`, file: join(dataDir, 'secrets', `${scopeOf(k.scope)}.${norm(k.label)}`) })
export const keptFor = (project: string | undefined, label: string) =>
  (l => (project && l.find(k => k.scope === project && norm(k.label) === norm(label))) || l.find(k => k.scope === '*' && norm(k.label) === norm(label)))(state.secretsKept ?? [])
function keep(scope: string, label: string, value: string) {
  mkdirSync(join(dataDir, 'secrets'), { recursive: true, mode: 0o700 })
  const k = keyOf({ scope, label })
  keyWrite(k.name, k.file, value)
  state.secretsKept = [...(state.secretsKept ?? []).filter(x => !(x.scope === scope && norm(x.label) === norm(label))), { scope, label, at: Date.now() }]
  resaved()
  save()
  changed()
}
// the open asks' cards say again whether one is kept for them (one kept or forgotten since they asked)
function resaved() {
  for (const a of asks.values()) {
    const r = rtOf(a.tab)
    if (!r.secret) continue
    const k = keptFor(a.project, a.label)
    r.secret = { id: r.secret.id, label: r.secret.label, ...(k && { saved: k.scope === '*' ? ('all' as const) : ('project' as const) }) }
  }
}
const forget = (had: { scope: string; label: string }) => {
  const k = keyOf(had)
  keyWrite(k.name, k.file, '')
  state.secretsKept = (state.secretsKept ?? []).filter(x => x !== had)
}
// Remove (Settings): forgotten, its value too
export function secretForget(o: { scope?: unknown; label?: unknown }) {
  const scope = String(o.scope ?? '')
  const label = String(o.label ?? '')
  const had = (state.secretsKept ?? []).find(x => x.scope === scope && norm(x.label) === norm(label))
  if (!had) throw new Error(`no ${label || 'such'} secret kept`)
  forget(had)
  resaved()
  save()
  changed()
  return { forgot: true }
}
// a project removed (core's projectRm): its kept secrets go too, values and all; a project added later under the same
// name (the same id) starts with none
export function secretsDrop(project: string) {
  for (const k of (state.secretsKept ?? []).filter(x => x.scope === project)) forget(k)
}

export function secretAsk(o: { label?: unknown; from?: { tab?: string } }) {
  const tab = state.tabs.find(t => t.id === o.from?.tab)
  if (!tab) throw new Error('laki secret runs in a Laki tab: the card that asks you shows there')
  const ws = state.workspaces.find(w => w.id === tab.workspace)
  const folder = ws && !ws.archived ? storageOf(ws) : undefined
  if (!folder) throw new Error(`${ws?.name ?? tab.workspace} has no storage folder (an SSH host's, Terminals' and Browsers' have none): ask the user to put it in a file`)
  const label = String(o.label ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!label) throw new Error('what is it? laki secret "Stripe key"')
  const r = rtOf(tab.id)
  if (r.secret) throw new Error(`${tab.name} asks for ${r.secret.label} already`)
  const id = randomUUID()
  const was = r.status
  const saved = keptFor(ws?.project, label)
  r.secret = { id, label, ...(saved && { saved: saved.scope === '*' ? ('all' as const) : ('project' as const) }) }
  if (tracked(tab) && was === 'running') r.status = 'waiting' // Needs you, the Dock's count, a notification
  broadcast({ ev: 'turn', tab: tab.id, ws: tab.workspace, kind: 'waiting', text: `${tab.name} asks for a secret: ${label}` })
  phone(tab, 'waiting', `asks for a secret: ${label}`)
  changed()
  return new Promise<{ path: string }>((ok, no) => {
    const timer = setTimeout(() => finish({ refused: `no answer in ${SECRET_WAIT / 60_000} minutes` }), SECRET_WAIT)
    const finish = (res: { path?: string; refused?: string }) => {
      clearTimeout(timer)
      asks.delete(id)
      if (r.secret?.id === id) r.secret = undefined
      if (r.status === 'waiting' && was === 'running') r.status = 'running' // its command goes on
      changed()
      if (res.path) ok({ path: res.path })
      else no(new Error(`the user didn't give ${label}: ${res.refused}`))
    }
    asks.set(id, { tab: tab.id, folder, label, project: ws?.project, done: finish })
  })
}

// your answer (the card's): the value into its file, or no. saved: the one kept for it (its card said so); keep: this
// value kept for next time, for the ask's project or for all projects
export function secretGive(o: { id?: string; value?: unknown; refuse?: boolean; saved?: unknown; keep?: unknown }) {
  const a = asks.get(String(o.id))
  if (!a) throw new Error('that ask is gone: the agent stopped waiting')
  if (o.refuse) return a.done({ refused: 'refused' }), { ok: true }
  const k = o.saved === true ? keptFor(a.project, a.label) : undefined
  if (o.saved === true && !k) throw new Error('none is kept for it any more: type it')
  const value = k ? keyRead(keyOf(k).name, keyOf(k).file) : typeof o.value === 'string' ? o.value.replace(/\r?\n$/, '') : ''
  if (!value) throw new Error(k ? "the kept one can't be read (the Keychain didn't answer?): type it" : 'empty: type it, or Refuse')
  if (value.length > SECRET_MAX) throw new Error(`longer than ${SECRET_MAX >> 10} KB`)
  if (!k && (o.keep === 'project' || o.keep === 'all')) {
    if (o.keep === 'project' && !a.project) throw new Error('its workspace has no project: keep it for all projects')
    keep(o.keep === 'all' ? '*' : a.project!, a.label, value)
  }
  const path = writeSecret(a.folder, a.label, value)
  log(`secret: ${a.label} for ${a.tab} in ${path}`) // the path, never the value
  a.done({ path })
  return { ok: true }
}
function writeSecret(folder: string, label: string, value: string) {
  const dir = join(folder, DIR)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {}
  // S10: the agent writes its storage folder: a .laki-secrets of its own (a link to a folder it would rather read, or
  // where a file of yours would go) isn't written. ponytail: a swap between this check and the write; O_NOFOLLOW guards the file
  if (!ownDir(folder, dir)) throw new Error(`${DIR} in the storage folder isn't a folder of its own (a link?): not written`)
  const path = join(dir, `${slug(label) || 'secret'}-${randomBytes(3).toString('hex')}`)
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    writeSync(fd, value)
  } finally {
    closeSync(fd)
  }
  return path
}
// a secret you pasted into a prompt box (its Pass as a secret, secretHint.tsx): into a 0600 file in the workspace's storage
// folder's .laki-secrets (no workspace yet, a new one's prompt: the storage root's own), its path back for the prompt;
// the value is never logged, in the view or sent back. The user's, a phone's (gates.ts); never an agent's
export function secretKeep(o: { value?: unknown; label?: unknown; ws?: unknown }) {
  const value = typeof o.value === 'string' ? o.value.trim() : ''
  if (!value) throw new Error('empty: nothing to keep')
  if (value.length > SECRET_MAX) throw new Error(`longer than ${SECRET_MAX >> 10} KB`)
  const label = String(o.label ?? 'secret').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 80) || 'secret'
  const ws = o.ws ? state.workspaces.find(w => w.id === o.ws) : undefined
  if (o.ws && !ws) throw new Error(`no workspace ${String(o.ws)}`)
  const folder = ws ? (!ws.archived ? storageOf(ws) : undefined) : storageRoot()
  if (!folder) throw new Error(`${ws?.name ?? ws?.id} has no storage folder (${ws?.archived ? "it's archived" : "an SSH host's has none"}): leave it in the prompt or put it in a file yourself`)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const path = writeSecret(folder, label, value)
  log(`secret: ${label} kept from a prompt in ${path}`) // the path, never the value
  return { path }
}

// a real folder (not a link) inside the storage folder, by its real path
function ownDir(folder: string, dir: string) {
  try {
    const st = lstatSync(dir)
    return st.isDirectory() && !st.isSymbolicLink() && realpathSync(dir).startsWith(`${realpathSync(folder)}${sep}`)
  } catch {
    return false
  }
}
// hourly: each storage folder's secrets past SECRET_HOURS (tests pass now)
export function secretsTidy(now = Date.now()) {
  let n = 0
  for (const top of [...state.workspaces.map(w => w.storage), storageRoot()]) {
    const dir = top && join(top, DIR)
    if (!dir || !existsSync(dir) || !ownDir(top!, dir)) continue // S10: a link: never the files it points at
    for (const f of readdirSync(dir))
      try {
        if (now - statSync(join(dir, f)).mtimeMs > SECRET_HOURS * 3600e3) rmSync(join(dir, f), { force: true }), n++
      } catch {}
  }
  return n
}
