// #S1: a shell tab's last screen across a Mac's restart or a pty host's crash: every LAKI_SCREEN_SAVE_MS (5 minutes)
// for a tab whose output changed since, and as the daemon stops, each shell tab's screen and scrollback (Session.saved:
// its text and colors) to <data>/screens/<tab id>.txt, 0600 (the folder 0700, in DATA_SECRETS: out of agents' reach),
// SCREEN_MAX at most (its tail). Not an agent's (its chat is resumed), nor a Private workspace's or project's. When the
// tab comes back with no terminal behind it (restoreNow), that screen goes into the new one first, dimmed, then a line
// with when it was, then its shell. A tab closed for good, or gone, takes its file with it (the next save's prune)
// ponytail: the tail is cut by bytes: a cut escape sequence at its start may draw a stray character or two
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from '../shared/conn.ts'
import { dir } from './dir.ts'
import { sessions, state } from './core.ts'

export const SCREEN_MAX = 200 * 1024
export const SCREEN_EVERY = () => Number(process.env.LAKI_SCREEN_SAVE_MS) || 5 * 60_000
const folder = () => join(dir, 'screens')
const fileOf = (id: string) => join(folder(), `${id.replace(/[^\w-]/g, '_')}.txt`)
const savedAt = new Map<string, number>() // tab → its output's time when last saved
const privateTab = (wsId: string) => (w => !w || !!w.private || !!state.projects.find(p => p.id === w.project)?.private)(state.workspaces.find(x => x.id === wsId))
export function screensSave(all = false) {
  const ids = new Set(state.tabs.map(t => t.id))
  for (const t of state.tabs) {
    if (t.kind !== 'shell') continue
    const s = sessions.get(t.id)
    if (!s || privateTab(t.workspace)) {
      if (privateTab(t.workspace)) rmSync(fileOf(t.id), { force: true }) // made Private since: its file goes too
      continue
    }
    if (!all && savedAt.get(t.id) === s.lastOutput) continue
    const text = s.saved()
    if (text === undefined) continue
    mkdirSync(folder(), { recursive: true, mode: 0o700 })
    const buf = Buffer.from(text)
    writeAtomic(fileOf(t.id), buf.length > SCREEN_MAX ? buf.subarray(buf.length - SCREEN_MAX).toString() : text, 0o600)
    savedAt.set(t.id, s.lastOutput)
  }
  // a tab closed for good (or its workspace gone): its file too
  try {
    for (const f of readdirSync(folder())) if (f.endsWith('.txt') && !ids.has(f.slice(0, -4))) rmSync(join(folder(), f), { force: true })
  } catch {}
}
export const screenForget = (id: string) => (rmSync(fileOf(id), { force: true }), savedAt.delete(id))
// what a restored shell tab shows first: its saved screen dimmed (each color change keeps the dim), then when it was
export function screenBack(id: string): string | undefined {
  let text = ''
  let at = 0
  try {
    text = readFileSync(fileOf(id), 'utf8')
    at = statSync(fileOf(id)).mtimeMs
  } catch {
    return undefined
  }
  if (!text.trim()) return undefined
  const dim = `\x1b[2m${text.replace(/\x1b\[[0-9;:]*m/g, m => `${m}\x1b[2m`)}\x1b[0m`
  const when = new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `${dim}\r\n\x1b[2m──── before the restart, ${when} ────\x1b[0m\r\n`
}
