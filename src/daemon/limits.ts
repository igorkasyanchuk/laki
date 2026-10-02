// Usage limits: "You've hit your limit · resets 3pm (Europe/Kyiv)", codex: "Try again at 3:04 PM."
// limitReset finds the agent's last such notice in text and when it resets (ported from wb's limits.go).

const lineRe = /^[\s⎿■•●▪⚠│>*-]*(you['’]ve hit your\b.*limit|usage limit reached)/i
const whenRe = /\b(?:resets|try again|continuing automatically)(?:\s+(?:at|in))?\s+([^·\n]+)/i
const durRe = /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi
const timeRe = /^(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?,?\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i
const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec'

export function limitReset(text: string, now: Date): Date | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lineRe.test(lines[i])) continue
    // the reset time is on that line, or wraps to the next
    for (const s of [lines.slice(i, i + 2).join(' '), lines[i]]) {
      const m = whenRe.exec(s)
      const t = m && parseReset(m[1], now)
      if (t) return t
    }
    return null
  }
  return null
}

// offset (ms) of a time zone from UTC at a moment
function tzOffset(tz: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at)
      .map(x => [x.type, Number(x.value)]),
  )
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000
}

export function parseReset(s: string, now: Date): Date | null {
  s = s.trim().replace(/\.$/, '')
  let tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const z = s.match(/\(([^)]+)\)/)
  if (z) {
    try {
      tzOffset(z[1], now)
      tz = z[1]
    } catch {}
    s = s.replace(z[0], '').trim()
  }
  if (!/\d\s*[ap]m\b/i.test(s) && !s.includes(':')) {
    let ms = 0
    for (const m of s.matchAll(durRe)) ms += Number(m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2][0].toLowerCase() as 'd'] ?? 0) * 1000
    return ms > 0 ? new Date(now.getTime() + ms) : null
  }
  const m = s.replace(/\s+/g, ' ').match(timeRe)
  if (!m) return null
  let h = Number(m[4])
  const min = Number(m[5] ?? 0)
  if (m[6]) h = (h % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0)
  if (h > 23 || min > 59) return null
  // "now" as wall-clock fields in that zone
  const off = tzOffset(tz, now)
  const w = new Date(now.getTime() + off)
  let y = w.getUTCFullYear()
  let mo = w.getUTCMonth()
  let d = w.getUTCDate()
  if (m[1]) {
    const i = MONTHS.indexOf(m[1].toLowerCase())
    if (i < 0 || i % 3) return null
    mo = i / 3
    d = Number(m[2])
    if (m[3]) y = Number(m[3])
  }
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd, h, min) - off)
  let t = at(y, mo, d)
  if (!m[1] && t.getTime() < now.getTime() - 12 * 3600e3) t = at(y, mo, d + 1) // long gone today: tomorrow's
  if (m[1] && !m[3] && t.getTime() < now.getTime() - 86400e3) t = at(y + 1, mo, d) // a date without a year: the next one
  return t
}
