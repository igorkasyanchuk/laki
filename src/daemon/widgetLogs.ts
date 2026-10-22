// an extension's log (off by default; on for every one in Settings › Extensions, one at a time, or in dev mode): its
// runs' stderr, Laki's lines about it and laki widget log's, in <data>/widget-data/<id>.log. widgets.ts re-exports it.

import { dirname, join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { LOG_LEVELS, type LogLevel, type WidgetLogLine } from '../shared/types.ts'
import { SECRET } from '../shared/widgetSchema.ts'
import { dir } from './dir.ts'
import { clamp, configOf, type Entry, find, optionsOf, secretsOf } from './widgets.ts'
import { changed, state } from './core.ts'

// ---------- logs (off by default): Settings › Extensions' Keep logs for every extension (settings.widgetLogs), an
// extension's own Keep a log (the store's log), or one laki widget dev links, while linked. <data>/widget-data/<id>.log,
// a JSON line each (WidgetLogLine), 0600, rotated past LOG_MAX to <id>.log.1 (two files at most), written in batches
// every 500 ms and at shutdown. Each line masked first: a secret's value, and a setting's named like one (SECRET)
const LOG_MAX = () => Number(process.env.LAKI_WIDGET_LOG_MAX) || 1 << 20 // tests' smaller
export const LOG_RUN = 64 << 10 // a run's stderr, at most
export const logPath = (id: string) => join(dir, 'widget-data', `${id}.log`)
export const logOn = (w: Entry) => state.settings?.widgetLogs === true || !!w.s.log || w.dev
export const pending = new Map<string, WidgetLogLine[]>()
export const lastN = new Map<string, number>() // each log's last n, read from its files once
export const errAt = new Map<string, number>() // its last error line's time (Settings' red tag): since the daemon started
let flushing: NodeJS.Timeout | undefined
// a line's own level: debug:, info:, warn: or error: at its start (taken off), else info
const leveled = (t: string): [LogLevel, string] => (m => (m ? [m[1].toLowerCase() as LogLevel, t.slice(m[0].length)] : ['info', t]))(/^(debug|info|warn|error):\s?/i.exec(t))
export const masks = new Map<string, (t: string) => string>() // each one's, until its secrets or settings are written again
export function masker(w: Entry) {
  const m = masks.get(w.id)
  if (m) return m
  const c = configOf(w, true)
  const vals = [...new Set([...Object.values(secretsOf(w.id)), ...optionsOf(w).filter(o => o.type === 'secret' || SECRET.test(o.key)).map(o => c[o.key])])].filter(v => typeof v === 'string' && v.length >= 4).sort((a, b) => b.length - a.length)
  const f = (t: string) => vals.reduce((x, v) => x.split(v).join('••••'), t)
  masks.set(w.id, f)
  return f
}
function readLog(id: string): WidgetLogLine[] {
  const out: WidgetLogLine[] = []
  for (const p of [`${logPath(id)}.1`, logPath(id)]) {
    let text = ''
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    for (const l of text.split('\n'))
      try {
        if (l) out.push(JSON.parse(l))
      } catch {}
  }
  return [...out, ...(pending.get(id) ?? [])]
}
// a line (each line of text) for its log, while it keeps one. A level other than info, Laki's own lines and a run's own
// line (as) are as given; else each line's prefix says
export function xlog(w: Entry, level: LogLevel, src: string, text: string, ws?: string, as = false) {
  if (!logOn(w)) return
  const mask = masker(w)
  const l = pending.get(w.id) ?? []
  let n = lastN.get(w.id) ?? readLog(w.id).at(-1)?.n ?? 0
  for (const t of text.split('\n')) {
    if (!t.trim()) continue
    const [lv, rest] = level === 'info' && src !== 'laki' && !as ? leveled(t) : [level, t]
    l.push({ n: ++n, at: Date.now(), level: lv, src, text: mask(rest).slice(0, 2048), ...(ws && { ws }) })
    if (lv === 'error') errAt.set(w.id, Date.now())
  }
  lastN.set(w.id, n)
  pending.set(w.id, l)
  flushing ??= setTimeout(flushLogs, 500)
}
export function flushLogs() {
  clearTimeout(flushing)
  flushing = undefined
  for (const [id, l] of pending) {
    pending.delete(id)
    const p = logPath(id)
    const text = l.map(x => JSON.stringify(x)).join('\n') + '\n'
    try {
      mkdirSync(dirname(p), { recursive: true })
      const size = statSync(p, { throwIfNoEntry: false })?.size
      if (size && size + text.length > LOG_MAX()) renameSync(p, `${p}.1`) // the older one goes
      appendFileSync(p, text, { mode: 0o600 })
    } catch (e) {
      console.error(`widget log ${id}: ${(e as Error).message}`)
    }
  }
}
const rank = (l: string) => LOG_LEVELS.indexOf(l as LogLevel)
// the Logs tab (every 2 s, from its cursor: since), laki widget logs, MCP's laki_extension_logs: the lines after since,
// at least level, of a src (action: every action's), of a workspace; the last limit of them; next: the cursor for the next
export function widgetLogs(o: { id: string; since?: number; limit?: number; level?: string; src?: string; ws?: string }) {
  const w = find(o.id)
  const all = readLog(w.id)
  const since = Number(o.since) || 0
  const min = Math.max(0, rank(String(o.level ?? '')))
  const src = typeof o.src === 'string' && o.src ? o.src : undefined
  const lines = all.filter(l => l.n > since && rank(l.level) >= min && (!src || l.src === src || l.src.startsWith(`${src}:`)) && (!o.ws || l.ws === o.ws))
  return { on: logOn(w), lines: lines.slice(-clamp(o.limit, 1, 5000, 500)), next: all.at(-1)?.n ?? since, file: logPath(w.id) }
}
// a line put there on purpose: laki widget log (a hook, a cron job; src cli) or a JS page's laki.log (page), 50 a second
// at most each, 2 KB a line. Its log off: nothing written, and fine (a script never breaks on it)
const LOG_RATE = 50
const rate = new Map<string, { s: number; n: number }>()
export function widgetLog(o: { id: string; text?: unknown; level?: string; ws?: string; src?: string }) {
  const w = find(o.id)
  const text = String(o.text ?? '').slice(0, 2048)
  if (!text.trim()) throw new Error('some text to log')
  if (!logOn(w)) return { ok: true, kept: false }
  const s = Math.floor(Date.now() / 1000)
  const r = rate.get(w.id)
  if (r?.s === s && r.n >= LOG_RATE) return { ok: true, kept: false, note: `over ${LOG_RATE} lines a second: dropped` }
  rate.set(w.id, r?.s === s ? { s, n: r.n + 1 } : { s, n: 1 })
  const ws = typeof o.ws === 'string' && state.workspaces.some(x => x.id === o.ws) ? o.ws : undefined
  xlog(w, LOG_LEVELS.includes(o.level as LogLevel) ? (o.level as LogLevel) : 'info', o.src === 'page' ? 'page' : 'cli', text, ws)
  return { ok: true, kept: true }
}
// its log's file, for Finder (written now; none yet: an empty one)
export function widgetLogFile(id: string) {
  const w = find(id)
  flushLogs()
  const p = logPath(w.id)
  if (!existsSync(p)) mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, '', { mode: 0o600 })
  return p
}
export function widgetLogClear(o: { id: string }) {
  const w = find(o.id)
  pending.delete(w.id)
  errAt.delete(w.id)
  for (const p of [logPath(w.id), `${logPath(w.id)}.1`]) rmSync(p, { force: true }) // n goes on: a reader's cursor stays good
  changed()
  return { ok: true }
}
