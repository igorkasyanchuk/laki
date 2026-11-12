// D9: what was done over remote access, for you to look back at. A line per remote call that changed something
// (main.ts' call: not one of READS) and the session's events (remote.ts: started, a device paired, unlocked, a wrong
// PIN, stopped and why): <data>/remote-log.jsonl, 0600, a JSON line each; past 1 MB it moves to remote-log.1.jsonl (the
// one before goes). A prompt's first 80 characters at most, never a secret. Settings › Remote access › Activity and
// `laki remote log` read the newest 200. It never fails a call
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dir } from './dir.ts'

export type Activity = { at: number; device?: string; method?: string; line: string }
const FILE = () => join(dir, 'remote-log.jsonl')
const OLD = () => join(dir, 'remote-log.1.jsonl')
export const LOG_MAX = 1 << 20

export function activity(e: Omit<Activity, 'at'>, at = Date.now()) {
  try {
    const f = FILE()
    if (existsSync(f) && statSync(f).size >= LOG_MAX) renameSync(f, OLD())
    appendFileSync(f, `${JSON.stringify({ at, ...e })}\n`, { mode: 0o600 })
  } catch {}
}
// the newest n, newest first
export function activityList(n = 200): Activity[] {
  const read = (f: string) =>
    existsSync(f)
      ? readFileSync(f, 'utf8')
          .split('\n')
          .flatMap(l => {
            try {
              return l ? [JSON.parse(l) as Activity] : []
            } catch {
              return []
            }
          })
      : []
  const now = read(FILE())
  return (now.length >= n ? now : [...read(OLD()), ...now]).slice(-n).reverse()
}
// a prompt or a message as the log keeps it: one line, its first 80 characters
export const clip80 = (s: unknown) => (t => (t.length > 80 ? `${t.slice(0, 80)}…` : t))(String(s ?? '').replace(/\s+/g, ' ').trim())
