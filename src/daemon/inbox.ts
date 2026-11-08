// The notification inbox (the bell, Inbox.tsx): what finished, failed or asked for you, kept after its toast is gone and
// across restarts. Recorded here, as it happens, so an event with no window open lands too; <data>/inbox.json, the newest
// MAX. An entry names its workspace and tab and never holds an ask's buttons: Open looks at them as they are by then.
// Recording mode: a private workspace's stay on disk but out of the list, the count, Mark all read and Clear.
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeAtomic } from '../shared/conn.ts'
import type { InboxEntry, Tab } from '../shared/types.ts'
import { changed, state, viewed } from './core.ts'
import { dir } from './dir.ts'

const MAX = 200
const TEXT = 300 // of a turn's last message: never the whole of what it said
let list: InboxEntry[] | undefined
let at = 0 // bumped by every change: an open list loads again

const file = () => join(dir, 'inbox.json')
function all() {
  if (list) return list
  const read = readJson<InboxEntry[]>(file())
  return (list = Array.isArray(read) ? read.filter(e => typeof e?.id === 'string').slice(0, MAX) : [])
}
function save() {
  writeAtomic(file(), JSON.stringify(all()), 0o600)
  at++
  changed()
}
function shown() {
  if (!state.settings?.recording) return all()
  const ps = new Set(state.projects.filter(p => p.private).map(p => p.id))
  const ws = new Set(state.workspaces.filter(w => w.private || ps.has(w.project)).map(w => w.id))
  return all().filter(e => !e.private && !(e.ws && ws.has(e.ws)) && !(e.project && ps.has(e.project)))
}

export function inboxAdd(e: Pick<InboxEntry, 'kind' | 'title' | 'text'> & Partial<Pick<InboxEntry, 'ws' | 'tab' | 'run' | 'project' | 'read'>>) {
  const w = e.ws ? state.workspaces.find(x => x.id === e.ws) : undefined
  const project = e.project ?? w?.project
  const secret = w?.private || state.projects.find(p => p.id === project)?.private
  const text = e.text.replace(/\s+/g, ' ').trim().slice(0, TEXT)
  all().unshift({ ...e, id: randomBytes(6).toString('hex'), at: Date.now(), text, ...(project && { project }), ...(secret && { private: true }) })
  list!.length = Math.min(list!.length, MAX)
  save()
}

// an agent's turn. On screen in a focused window as it happens: seen already, so not unread. Muted: asked to stay quiet
export function inboxTurn(tab: Tab, kind: 'done' | 'failed' | 'limit' | 'waiting', text: string) {
  const w = state.workspaces.find(x => x.id === tab.workspace)
  if (tab.muted || w?.muted) return
  inboxAdd({ kind, title: `${w?.name ?? tab.workspace} · ${tab.name}`, text, ws: tab.workspace, tab: tab.id, ...(viewed(tab.id) && { read: true }) })
}

export const inboxList = () => shown()
export const inboxView = () => ({ unread: shown().filter(e => !e.read).length, at })

// ids: those; none: every one showing
export function inboxRead(p: { ids?: unknown }) {
  const ids = Array.isArray(p.ids) ? new Set(p.ids) : undefined
  let n = 0
  for (const e of shown()) if (!e.read && (!ids || ids.has(e.id))) (e.read = true), n++
  if (n) save()
  return { read: n }
}
export function inboxClear() {
  const gone = new Set(shown())
  list = all().filter(e => !gone.has(e))
  if (gone.size) save()
  return { cleared: gone.size }
}
