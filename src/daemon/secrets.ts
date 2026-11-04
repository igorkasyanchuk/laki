// An agent asks you for a secret (laki secret "Stripe key", MCP's laki_secret): a card at the foot of its tab, and its
// tab in Needs you, with a masked field. What you type goes to a 0600 file in the workspace's storage folder
// (.laki-secrets/, hidden: never an artifact) and the agent gets its path only, so the value never goes into the chat
// or the model's context. Files older than SECRET_HOURS go (secretsTidy, hourly). main.ts imports it; core keeps the
// ask on the tab's runtime (secret) for the view. ponytail: in memory, so a daemon restart drops an ask (the agent's
// command fails and it can ask again), and an agent stopped while it waits leaves the card up to SECRET_WAIT; this Mac's workspaces only (no storage folder on a host)

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SECRET_WAIT } from '../shared/types.ts'
import { broadcast, changed, log, rtOf, slug, state, storageOf, tracked } from './core.ts'
import { phone } from './phone.ts'

const SECRET_HOURS = 24
const SECRET_MAX = 64 << 10
const DIR = '.laki-secrets'
const asks = new Map<string, { tab: string; folder: string; label: string; done: (r: { path?: string; refused?: string }) => void }>()

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
  r.secret = { id, label }
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
    asks.set(id, { tab: tab.id, folder, label, done: finish })
  })
}

// your answer (the card's): the value into its file, or no
export function secretGive(o: { id?: string; value?: unknown; refuse?: boolean }) {
  const a = asks.get(String(o.id))
  if (!a) throw new Error('that ask is gone: the agent stopped waiting')
  if (o.refuse) return a.done({ refused: 'refused' }), { ok: true }
  const value = typeof o.value === 'string' ? o.value.replace(/\r?\n$/, '') : ''
  if (!value) throw new Error('empty: type it, or Refuse')
  if (value.length > SECRET_MAX) throw new Error(`longer than ${SECRET_MAX >> 10} KB`)
  const dir = join(a.folder, DIR)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${slug(a.label) || 'secret'}-${randomBytes(3).toString('hex')}`)
  writeFileSync(path, value, { mode: 0o600, flag: 'wx' })
  log(`secret: ${a.label} for ${a.tab} in ${path}`) // the path, never the value
  a.done({ path })
  return { ok: true }
}

// hourly: each storage folder's secrets past SECRET_HOURS (tests pass now)
export function secretsTidy(now = Date.now()) {
  let n = 0
  for (const w of state.workspaces) {
    const dir = w.storage && join(w.storage, DIR)
    if (!dir || !existsSync(dir)) continue
    for (const f of readdirSync(dir))
      try {
        if (now - statSync(join(dir, f)).mtimeMs > SECRET_HOURS * 3600e3) rmSync(join(dir, f), { force: true }), n++
      } catch {}
  }
  return n
}
