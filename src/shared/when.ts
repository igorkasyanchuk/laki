// When a scheduled task runs, from a line of English (the daemon schedules with it, the form previews it):
//   every day at 2am except weekends · weekdays at 9:00 · mon, wed and fri at 18:30 · every 2 hours from 9am to 6pm
//   every 30 minutes · hourly on weekends · at 9am and 5pm · tomorrow at 7am · once at 23:00
// A rule is the days of the week (0 Sunday … 6) and the times on them (minutes after midnight), in the Mac's time zone;
// once: it runs one time, at the first of them.
export type Rule = { days: number[]; times: number[]; once?: boolean }

export const MIN_EVERY = 5 // minutes: the shortest interval
const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*'
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`
const ALL = [0, 1, 2, 3, 4, 5, 6]
const DAY_WORD = '(?:week ?days?|work ?days?|weekends?|(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)'
// except weekends · but not on fri · excluding mon and tue: only the days, so what follows them (at 2am) still counts
const EXCEPT = new RegExp(`\\b(?:except|but not|excluding|not on|not|no|skip(?:ping)?)(?: on)? (${DAY_WORD}(?:(?: , | and | or | ?[-–] ?| to | through | thru )${DAY_WORD})*)\\b`, 'g')

// "2am" → 120, "14:30" → 870, "noon" → 720; null for a time that can't be
function minutes(h: string, m = '0', ap = ''): number | null {
  let hour = Number(h)
  const min = Number(m)
  if (min > 59) return null
  if (ap) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (ap.startsWith('p') ? 12 : 0)
  } else if (hour > 23) return null
  return hour * 60 + min
}

function daysIn(s: string): number[] {
  const out = new Set<number>()
  if (/\b(every ?day|daily|each day|all days)\b/.test(s)) ALL.forEach(d => out.add(d))
  if (/\b(week ?days?|work ?days?)\b/.test(s)) [1, 2, 3, 4, 5].forEach(d => out.add(d))
  if (/\bweekends?\b/.test(s)) [0, 6].forEach(d => out.add(d))
  const rest = s.replace(new RegExp(`\\b${DAY}\\s*(?:-|–|to|through|thru)\\s*${DAY}`, 'g'), (_, a: string, b: string) => {
    for (let d = NAMES.indexOf(a); ; d = (d + 1) % 7) {
      out.add(d)
      if (d === NAMES.indexOf(b)) break
    }
    return ' '
  })
  for (const m of rest.matchAll(new RegExp(`\\b${DAY}\\b`, 'g'))) out.add(NAMES.indexOf(m[1]))
  return [...out].sort()
}

const tidy = (text: string) => ` ${text.toLowerCase().replace(/\b([ap])\.m\.?/g, '$1m').replace(/(\d)\.(\d\d)(?!\d)/g, '$1:$2').replace(/[,;&]/g, ' , ').replace(/[.!?]/g, ' ').replace(/\s+/g, ' ')} `

export function parseWhen(text: string, now = Date.now()): Rule | { error: string } {
  let s = tidy(text)
  s = s.replace(/\b(\d{1,2}(?::\d\d)?) (?:in the )?(morning|afternoon|evening)\b/g, (_, t: string, w: string) => `${t}${w === 'morning' ? 'am' : 'pm'}`) // at 3 in the afternoon
  if (/\bevery (\d+ |other )(days?|weeks?)\b|\bevery (\d+ )?(months?|years?)\b|\b(monthly|yearly)\b/.test(s)) return { error: 'Every few days isn’t a choice: name the days (mon and thu at 9am)' }
  let once = /\b(?:once|one time)\b(?! (?:a|per|each|every) )/.test(s) // not once a day
  let days: number[] | undefined
  if (/\btomorrow\b/.test(s)) {
    once = true
    days = [(new Date(now).getDay() + 1) % 7]
  }
  let skipped = ''
  s = s.replace(EXCEPT, (_, d: string) => ((skipped += ` ${d}`), ' '))
  if (/\b(?:except|but not|excluding|not on|skip(?:ping)?)\b/.test(s)) return { error: 'Except which days? (except weekends, but not fri)' }
  const skip = daysIn(skipped)
  days ??= daysIn(s)
  if (!days.length) days = ALL
  days = days.filter(d => !skip.includes(d))
  if (!days.length) return { error: 'That leaves no days to run on' }

  // every 30 minutes · every 2 hours from 9am to 6pm · hourly
  s = s.replace(/\bnoon\b/g, '12pm').replace(/\bmidnight\b/g, '12am')
  let times: number[] = []
  const every = /\bevery (\d+ )?(minutes?|mins?|hours?|hrs?)\b|\b(hourly)\b|\bevery (half an? hour)\b/.exec(s)
  if (every) {
    const n = Number(every[1] ?? 1)
    const step = every[3] ? 60 : every[4] ? 30 : /^h/.test(every[2]) ? n * 60 : n
    if (step < MIN_EVERY) return { error: `At most every ${MIN_EVERY} minutes` }
    s = s.replace(every[0], ' ')
    let [from, to] = [0, 24 * 60 - 1]
    const span = new RegExp(`\\b(?:from|between) ${TIME} (?:to|and|until|till|-) ${TIME}`).exec(s)
    if (span) {
      const a = minutes(span[1], span[2], span[3])
      const b = minutes(span[4], span[5], span[6])
      if (a === null || b === null || b <= a) return { error: 'From when to when? (from 9am to 6pm)' }
      ;[from, to] = [a, b]
      s = s.replace(span[0], ' ')
    }
    for (let t = from; t <= to; t += step) times.push(t)
  }
  // at 2am · at 9 and 17:30 · noon · midnight: a bare number only after at / and / a comma
  for (const m of s.matchAll(new RegExp(`\\b${TIME}(?![\\d:])`, 'g'))) {
    if (!m[2] && !m[3] && !/(?:\bat|\band|,|@)\s*$/.test(s.slice(0, m.index))) continue
    const t = minutes(m[1], m[2], m[3])
    if (t === null) return { error: `${m[0].trim()} isn’t a time` }
    if (every) return { error: 'From when to when? (from 9am to 6pm)' } // "until 5pm": a bound it would ignore
    times.push(t)
  }
  times = [...new Set(times)].sort((a, b) => a - b)
  if (!times.length) return { error: 'At what time? (every day at 9am)' }
  return { days, times, ...(once ? { once } : {}) }
}

// the first time the rule says after `after` (ms), or undefined (no days or times)
export function nextRun(r: Rule, after: number): number | undefined {
  const d = new Date(after)
  for (let i = 0; i <= 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)
    if (!r.days.includes(day.getDay())) continue
    for (const t of r.times) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(t / 60), t % 60).getTime()
      if (at > after) return at
    }
  }
}

// a reminder's moment (Calendar): ms, a date (2026-10-20: 9am that day; 2026-10-20 14:30; an ISO time), a length from now
// (in 30m, in 2 hours, in 3 days, in 1w) or a day and time parseWhen reads (tomorrow at 9am, fri at 5pm, at 18:30): its
// next time after now
export function parseAt(text: string | number, now = Date.now()): number | { error: string } {
  const say = { error: 'When? (tomorrow at 9am, in 2h, fri at 5pm, 2026-10-20 14:30)' }
  if (typeof text === 'number') return Number.isFinite(text) ? text : say
  const s = String(text ?? '').trim().toLowerCase()
  const rel = /^in (\d+(?:\.\d+)?) ?(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/.exec(s)
  if (rel) return now + Number(rel[1]) * { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[rel[2][0] as 'm' | 'h' | 'd' | 'w']
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(s)
  if (day) {
    const at = new Date(+day[1], +day[2] - 1, +day[3], day[4] ? +day[4] : 9, day[5] ? +day[5] : 0)
    return at.getMonth() === +day[2] - 1 && at.getDate() === +day[3] && (!day[4] || (+day[4] < 24 && +day[5] < 60)) ? at.getTime() : say // no 2026-02-31
  }
  if (/^\d{4}-\d{2}-\d{2}t/.test(s) && !Number.isNaN(Date.parse(text))) return Date.parse(text)
  const r = parseWhen(s, now)
  if ('error' in r) return { error: `${r.error.replace(/\(.*\)/, '').trim()} (tomorrow at 9am, in 2h, 2026-10-20 14:30)` }
  return nextRun(r, now) ?? say
}

// a reminder's when that repeats: words that say again and again (every weekday at 9am, mondays at 5pm, daily at 8:30)
export const REPEATS = /\b(every|each|daily|hourly|nightly|week ?days|work ?days|weekends|(?:sun|mon|tues|wednes|thurs|fri|satur)days)\b/i
// a reminder's when, in words: a repeating rule (REPEATS: parseWhen's, its next time; every: the words) or one moment
// (parseAt)
export function whenOf(text: string, now = Date.now()): { at: number; every?: string } | { error: string } {
  const s = String(text ?? '').trim()
  if (!REPEATS.test(s)) return (at => (typeof at === 'number' ? { at } : at))(parseAt(s, now))
  const r = parseWhen(s, now)
  if ('error' in r) return r
  const at = nextRun(r, now)
  return at === undefined ? { error: 'When? (every weekday at 9am)' } : r.once ? { at } : { at, every: s }
}

// parseAt's time, or its words as an error: ms as digits too (laki new --at, MCP's start_at)
export function atOrThrow(v: unknown) {
  const t = parseAt(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : String(v))
  if (typeof t !== 'number') throw new Error(t.error)
  return t
}

// widgets' working hours (Settings › Widgets): 9am-9pm · weekdays 8:00 to 18:30 · 22:00-6:00 except weekends. to before
// from: across midnight (the night belongs to the day it starts on). Empty: always
export type Hours = { days: number[]; from: number; to: number }
export function parseHours(text: string): Hours | { error: string } {
  let s = tidy(text).replace(/\bnoon\b/g, '12pm').replace(/\bmidnight\b/g, '12am')
  const span = new RegExp(`\\b${TIME}\\s*(?:-|–|to|until|till|and)\\s*${TIME}(?![\\d:])`).exec(s)
  if (!span) return { error: 'From when to when? (9am-9pm weekdays)' }
  let from = minutes(span[1], span[2], span[3])
  let to = minutes(span[4], span[5], span[6])
  if (from !== null && to !== null && !span[3] && span[6] === 'pm' && from + 720 < to) from += 720 // 1-5pm: 13:00
  if (from !== null && to !== null && !span[6] && to < from && from <= 720 && to < 720) to += 720 // 9-5, 9am-5, noon-6: to 17:00, 18:00
  if (from === null || to === null || from === to) return { error: 'From when to when? (9am-9pm weekdays)' }
  s = s.replace(span[0], ' ')
  let skipped = ''
  s = s.replace(EXCEPT, (_, d: string) => ((skipped += ` ${d}`), ' '))
  if (/\b(?:except|but not|excluding|skip(?:ping)?)\b/.test(s)) return { error: 'Except which days? (except weekends)' }
  const skip = daysIn(skipped)
  const named = daysIn(s)
  const days = (named.length ? named : ALL).filter(d => !skip.includes(d))
  if (!days.length) return { error: 'That leaves no days' }
  return { days, from, to }
}
// is it within them now
export function inHours(h: Hours, now = Date.now()) {
  const d = new Date(now)
  const t = d.getHours() * 60 + d.getMinutes()
  if (h.from < h.to) return h.days.includes(d.getDay()) && t >= h.from && t < h.to
  return (h.days.includes(d.getDay()) && t >= h.from) || (h.days.includes((d.getDay() + 6) % 7) && t < h.to)
}

const hhmm = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// "Weekdays at 02:00", "Mon, Wed, Fri every 30 min from 09:00 to 17:30", "Once: Sat at 07:00"
export function describe(r: Rule): string {
  const k = r.days.join()
  const days = k === '0,1,2,3,4,5,6' ? 'Every day' : k === '1,2,3,4,5' ? 'Weekdays' : k === '0,6' ? 'Weekends' : r.days.map(d => DAY_LABEL[d]).join(', ')
  const t = r.times
  const step = t.length > 3 ? t[1] - t[0] : 0
  const even = step > 0 && t.every((x, i) => !i || x - t[i - 1] === step)
  const times = even ? `every ${step % 60 ? `${step} min` : step === 60 ? 'hour' : `${step / 60} hours`} from ${hhmm(t[0])} to ${hhmm(t[t.length - 1])}` : `at ${t.map(hhmm).join(', ')}`
  return r.once ? `Once, ${days === 'Every day' ? '' : `${days} `}${times}` : `${days} ${times}`
}

// "Weekdays, 09:00–21:00"
export function describeHours(h: Hours) {
  const k = h.days.join()
  const days = k === '0,1,2,3,4,5,6' ? 'Every day' : k === '1,2,3,4,5' ? 'Weekdays' : k === '0,6' ? 'Weekends' : h.days.map(d => DAY_LABEL[d]).join(', ')
  return `${days}, ${hhmm(h.from)}–${hhmm(h.to)}${h.to < h.from ? ' (the next day)' : ''}`
}

// a date in a task's name or prompt, a prompt template or an action: any of these tokens, in any order, with any of
// the separators between them: {{DD-MM-YY}} · {{YYYY-MM-DD}} · {{HH:mm}} · {{ddd D MMM}} · {{DDMMYY HH-MM}}. MM is the
// month, but right after an hour (HH, H, hh) it's the minutes, as people write it; mm always is. Only braces of these
// tokens and separators change: {{project}} and the like stay as they are.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TOKENS = 'YYYY|YY|MMMM|MMM|MM|DD|D|dddd|ddd|HH|H|hh|mm|ss|A'
const TOKEN = new RegExp(TOKENS, 'g')
const STAMP = new RegExp(`\\{\\{((?:${TOKENS}|[ \\-:./,_])+)\\}\\}`, 'g')
export function stamp(text: string, at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  const h12 = d.getHours() % 12 || 12
  const part: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: p(d.getFullYear() % 100),
    MMMM: MONTH_NAMES[d.getMonth()],
    MMM: MONTHS[d.getMonth()],
    MM: p(d.getMonth() + 1),
    DD: p(d.getDate()),
    D: String(d.getDate()),
    dddd: DAY_NAMES[d.getDay()],
    ddd: DAY_LABEL[d.getDay()],
    HH: p(d.getHours()),
    H: String(d.getHours()),
    hh: p(h12),
    mm: p(d.getMinutes()),
    ss: p(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM',
  }
  return text.replace(STAMP, (all, f: string) => {
    if (!/[YMDdHhmsA]/.test(f)) return all
    let prev = ''
    return f.trim().replace(TOKEN, k => {
      const v = k === 'MM' && /^(HH|H|hh)$/.test(prev) ? part.mm : part[k]
      prev = k
      return v
    })
  })
}

// a scheduled run's new workspace: the task's name with the run's date; no name: the date, then the prompt's first
// words, so each run's workspace is told apart in the sidebar (which cuts long names at their end)
export const wsTitle = (s: { name?: string; prompt: string }, at: number) => stamp(s.name || `{{DD-MM HH:mm}} ${s.prompt.trim().split(/\s+/).slice(0, 4).join(' ')}`, at)
