// Small text helpers, kept apart from React so tests can load them.

import { type Agent, AGENT_NAMES, type AgentUsage, fillTemplate, HOME_ACCOUNT, mergeActions, type PendingView, type PR, prRef, type RunAction, type Stat, type TabView, taskTitle, type Template, templated, templatesFor, type UsageWindow } from '../../shared/types.ts'
export type { Template }
// a prompt template (Settings → Prompt templates, and a project's own): {{prompt}} is what you type, {{project}} and
// {{base}} the new workspace's, {{pr}} its PR (prRef); an unknown {{name}} stays as it is
export { fillTemplate, mergeActions, prRef, templated, templatesFor } // shared: laki mcp's (Laki AI's) templates and actions too

// a workspace's name from what was typed, not the template around it (as the daemons do: its first words)
export const nameOf = (prompt: string) => taskTitle(prompt, 4) || undefined // its words, no links, paths or please

// the prompt an agent gets: the text, then each pasted image's or attached file's path on a line of its own, in quotes
// (JSON's) when it has a space, a quote or a backslash: the agent reads it whole
export const pathText = (p: string) => (/[\s"'\\]/.test(p) ? JSON.stringify(p) : p)
export const withPaths = (text: string, paths: string[]) => [text.trim(), paths.map(pathText).join('\n')].filter(Boolean).join('\n\n')

// a workspace's name as shown: one that numbers its PR (pr-14885-sq3-…, Review PR 14810 …, #14810) shows the PR's title,
// whatever named it (a prompt's words, a template, gh failing as it was made: pr-<n>)
export function wsShown(w: { id: string; name?: string; pr?: { number: number; title?: string } }) {
  const n = w.name || w.id
  return w.pr?.title && new RegExp(`(?:\\bpr[\\s#-]*|#)${w.pr.number}\\b`, 'i').test(n) ? w.pr.title : n
}

// a path for the status bar: ~ for the home folder, and only the last two folders of a long one
export function shortPath(p: string) {
  const parts = p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~').split('/')
  return parts.length > 4 ? [parts[0], '…', ...parts.slice(-2)].join('/') : parts.join('/')
}

// a cloud workspace's state (gh's word, or Laki's while it's made) as the row and the status bar say it
export const csWord = (st = '') => (({ Available: 'on', Shutdown: 'stopped', ShuttingDown: 'stopping', Creating: 'being made', Provisioning: 'being made', Queued: 'being made', Starting: 'starting', Failed: 'failed' }) as Record<string, string>)[st] ?? st.toLowerCase()

// what the daemons take: an address, or *@domain for a whole domain (cloudflared's wildcard domains)
export const MAIL_OK = /^(?:\*|[^\s@*,]+)@[^\s@*,]+\.[^\s@*,]+$/

// a *@domain anyone can get an address at (webmail): "only these emails" then lets in anyone who signs up; its domain
const WEBMAIL = /^\*@((?:gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|protonmail)\.com|proton\.me|mail\.ru|(?:gmx|yandex)\.[a-z]{2,3}(?:\.[a-z]{2})?)$/i
export const webmail = (m: string) => WEBMAIL.exec(m.trim())?.[1]?.toLowerCase()

// who a tunnel lets in, as typed: addresses and whole domains (*@team.com; @team.com and team.com say the same)
export const parseMails = (s: string) =>
  [...new Set(s.split(/[\s,;]+/).filter(Boolean).map(m => (m.includes('@') ? m.replace(/^@/, '*@') : `*@${m}`)))]

// an action (Settings › Actions, or a project's): a prompt for an agent, or a command for a terminal
export type { RunAction }
export type ActionTab = { id: string; agent?: string; shell?: boolean; busy?: boolean } // a workspace's live tab: its agent, or a shell (busy: a command in front, vim, a server)

// Run ▾'s actions, worked out as it opens: the global ones, then the project's (one with a global one's name and
// target replaces it). An agent's only while the workspace runs that agent (its focused tab first; any: any agent); a shell's
// always (the focused shell at its prompt, else any at its prompt; none: a new one)
export function actionsFor(global: RunAction[] = [], project: RunAction[] = [], tabs: ActionTab[] = [], focused?: string) {
  const pick = (ok: (t: ActionTab) => boolean) => tabs.find(t => t.id === focused && ok(t)) ?? tabs.find(ok)
  const agent: { action: RunAction; tab: string }[] = []
  const terminal: { action: RunAction; tab?: string }[] = []
  for (const a of mergeActions(global, project)) {
    if (a.target === 'shell') terminal.push({ action: a, tab: pick(t => !!t.shell && !t.busy)?.id })
    else {
      const t = pick(t => (a.target === 'any' ? !!t.agent : t.agent === a.target))
      if (t) agent.push({ action: a, tab: t.id })
    }
  }
  return { agent, terminal }
}

// a YouTube link (watch, youtu.be, shorts, live, embed, a playlist; t= or start=; or a bare video id) as the
// sidebar player's embed URL, else null. youtube-nocookie: no cookies until you play
export function youtubeEmbed(link: string): string | null {
  const s = link.trim()
  let u: URL
  try {
    u = new URL(/^[\w-]{11}$/.test(s) ? `https://youtu.be/${s}` : /^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  const [first, second] = u.pathname.split('/').filter(Boolean)
  const vid = (x?: string | null) => (x && /^[\w-]{11}$/.test(x) ? x : null)
  const id = host === 'youtu.be' ? vid(first) : host === 'youtube.com' || host === 'youtube-nocookie.com' ? vid(first === 'watch' ? u.searchParams.get('v') : ['shorts', 'live', 'embed', 'v'].includes(first) ? second : null) : undefined
  const list = u.searchParams.get('list')?.match(/^[\w-]+$/)?.[0]
  if (id === undefined || (!id && !list)) return null // not YouTube, or no video in it
  const out = new URL(`https://www.youtube-nocookie.com/embed/${id ?? 'videoseries'}`)
  if (list) out.searchParams.set('list', list)
  // t=90, 90s, 1h2m3s; start=90
  const t = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '')
  const start = t ? Number(t[1] ?? 0) * 3600 + Number(t[2] ?? 0) * 60 + Number(t[3] ?? 0) : 0
  if (start) out.searchParams.set('start', String(start))
  return out.href
}

// a timer's length as typed: minutes (25, 2.5), or with units (1h 30m, 90s, 45 min); in ms, up to a day, else null
export function parseDuration(typed: string): number | null {
  const s = typed.trim().toLowerCase()
  const UNIT: Record<string, number> = { h: 3600000, m: 60000, s: 1000 }
  const parts = /^\d+(\.\d+)?$/.test(s) ? [[s, 'm']] : /^(\s*\d+(\.\d+)?\s*(h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)(?![a-z]))+$/.test(s) ? [...s.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/g)].map(m => [m[1], m[2]]) : []
  const ms = Math.round(parts.reduce((n, [v, u]) => n + Number(v) * UNIT[u], 0))
  return ms >= 1000 && ms <= 86400000 ? ms : null
}

// when to send a message later, as ms from now: in a length (parseDuration's: 10m, 2h, 1h 30m, "in 45") or at a
// time of day (15:30, 3pm, at 9:05am, at 15): today, or tomorrow once it's past
export function parseLater(typed: string, now = Date.now()): number | null {
  const at = /^\s*at\s/i.test(typed)
  const s = typed.trim().toLowerCase().replace(/^(in|at)\s+/, '')
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s)
  if (!m || !(at || m[2] || m[3])) return at ? null : parseDuration(s)
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0)
  }
  if (h > 23 || min > 59) return null
  const d = new Date(now)
  d.setHours(h, min, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime() - now
}

// a message for later's When again (its edit): at H:MM, digits by hand (a locale's own, ٣:٣٠, wouldn't parse), or 1m once
// that minute has begun (at it would mean tomorrow)
export const laterText = (at: number, now = Date.now()) => (at - now < 120000 ? '1m' : (d => `at ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`)(new Date(at)))

// time left as a clock: 4:05, 1:02:03
export function clock(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000))
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

// CSV (the file preview's Table): RFC 4180 rows, quotes doubled inside quotes, newlines inside them; quoted: which
// fields were in quotes, cell by cell (written back the same way, so an edit doesn't rewrite the whole file). sep: a
// comma, or what the first line has most of (; or a tab), a tab for .tsv
export function csvSep(path: string, text: string) {
  if (/\.tsv$/i.test(path)) return '\t'
  const line = text.slice(0, text.search(/\r?\n|$/)).replace(/"[^"]*"/g, '')
  return [',', ';', '\t'].map(c => [c, line.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0]
}
export function parseCsv(text: string, sep = ','): { rows: string[][]; quoted: boolean[][] } {
  const rows: string[][] = []
  const quoted: boolean[][] = []
  let row: string[] = []
  let qs: boolean[] = []
  let cell = ''
  let q = false // inside quotes
  let was = false // this field was quoted
  const end = () => {
    row.push(cell)
    qs.push(was)
    cell = ''
    was = false
  }
  const next = () => (rows.push(row), quoted.push(qs), (row = []), (qs = []))
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c !== '"') cell += c
      else if (text[i + 1] === '"') (cell += '"'), i++
      else q = false
    } else if (c === '"' && !cell && !was) q = was = true
    else if (c === sep) end()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      end()
      next()
    } else cell += c
  }
  if (cell || was || row.length) end(), next()
  return { rows, quoted }
}
// LF only: the edit's text is (FilePreview's save puts a CRLF file's \r\n back). A cell in quotes before stays in
// them; a new row is quoted like the one above it, a new column like the cell before it; any that needs them gets them
export function toCsv(rows: string[][], sep = ',', quoted: boolean[][] = [], trail = true) {
  const was = (r: number, c: number): boolean => (quoted[r] ? (quoted[r][c] ?? quoted[r][c - 1] ?? false) : r > 0 && was(r - 1, c))
  return rows.map((row, r) => row.map((v, c) => (was(r, c) || v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(sep)).join('\n') + (trail && rows.length ? '\n' : '')
}

// what an imported field must be where a page would break on anything else (a list it maps, a number it adds to)
const KINDS: Record<string, string> = { presets: 'array null', memory: 'array', imageDays: 'number', templates: 'array', actions: 'array', tunnelMails: 'array', widgetDirs: 'array', favThemes: 'array', env: 'object', prPrompts: 'object', webhook: 'object', ai: 'object', voice: 'object', prScan: 'number', prTries: 'number', prBots: 'array', archivedDays: 'number', sleepAfter: 'number', pageZoom: 'number', notifyOn: 'object', usageAt: 'number', usage: 'object', projectLook: 'object', sideLook: 'object', prMarks: 'object', planTemplates: 'array', railPlans: 'array', railOrder: 'array', railHide: 'array', railColors: 'object', fontSize: 'number', lineHeight: 'number', letterSpacing: 'number', minContrast: 'number', scrollSpeed: 'number', glassWindow: 'number', glassSide: 'number', glassTerm: 'number', sideClear: 'number', floaterRecent: 'number', floaterRecentHours: 'number', floaterMax: 'number', flowVars: 'object', deskTiles: 'array', deskTabs: 'array', keys: 'object', layouts: 'array', tunnel: 'object' }
// what Export leaves out and Import never takes (this Mac's stay): secrets (env and presets' env: API keys; the phone
// webhook's URL: its token) and what's private (remote access's and tunnels' emails, workflows' variables)
const PRIVATE = ['env', 'webhook', 'remoteMail', 'tunnelMails', 'flowVars']
type EnvPreset = { name: string; env?: Record<string, string> }
export function exportable<T extends { presets?: EnvPreset[] | null }>(s: T) {
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(s).filter(([k]) => !PRIVATE.includes(k)))
  if (s.presets) out.presets = s.presets.map(({ env: _e, ...p }) => p)
  return out
}
// an imported settings file (Settings › General › Import): a field of the wrong kind (a file from another version) is
// left out, the rest comes in; one this version doesn't know stays, harmless. ponytail: top level only
export function importable(v: Record<string, unknown>, mine?: { presets?: EnvPreset[] | null }) {
  const kind = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x)
  v = Object.fromEntries(Object.entries(v).filter(([k]) => !PRIVATE.includes(k))) // an older file's: yours stay
  const bad = Object.keys(v).filter(k => KINDS[k] && v[k] !== undefined && !KINDS[k].split(' ').includes(kind(v[k])))
  const ok = Object.fromEntries(Object.entries(v).filter(([k]) => !bad.includes(k)))
  // Export leaves presets' env out (secrets): a preset in the file keeps this Mac's, by name; the file's own wins
  const envs = new Map((mine?.presets ?? []).map(p => [p.name, p.env]))
  if (Array.isArray(ok.presets)) ok.presets = (ok.presets as EnvPreset[]).map(p => (p?.env || !envs.get(p?.name) ? p : { ...p, env: envs.get(p.name) }))
  return { ok, bad }
}

// the preview's address bar: a path on the port (/x), :5173/x, localhost:5173/x, a whole URL, or a site's address
// (example.com/x, docs.example.com:8080: https). ponytail: index.html typed bare reads as a site; /index.html is the path
const SITE = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/
export function previewUrl(typed: string, port: number) {
  const a = typed.trim()
  if (/^https?:\/\//i.test(a)) return a.replace(/^https?/i, x => x.toLowerCase()) // HTTP://: load takes it lowercase
  if (/^:\d+([/?#]|$)/.test(a)) return `http://localhost${a}`
  if (LOCAL_HOST.test(a)) return `http://${a}`
  if (SITE.test(a)) return `https://${a}`
  return `http://localhost:${port}${a.startsWith('/') ? a : `/${a}`}`
}
// and what it shows for a URL: this Mac's without the http://
export const previewAddr = (url: string) => url.replace(/^http:\/\/(?=(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$))/, '')

// the preview's sizes (Preview's devices bar): the page laid out at that width and height, scaled down to fit the panel
export const SIZES: [string, number, number][] = [
  ['iPhone SE', 375, 667],
  ['iPhone', 393, 852],
  ['Android', 412, 915],
  ['iPad', 768, 1024],
  ['Laptop', 1366, 768],
  ['HD', 1280, 720],
  ['Full HD', 1920, 1080],
]
// a typed size: 1440x900, 1440×900, 1440 900 (each 200 to 4000 px)
export function parseSize(s: string): [number, number] | null {
  const m = /^\s*(\d{3,4})\s*[x×*, ]\s*(\d{3,4})\s*$/i.exec(s)
  if (!m) return null
  const [w, h] = [Number(m[1]), Number(m[2])]
  return w >= 200 && h >= 200 && w <= 4000 && h <= 4000 ? [w, h] : null
}

// the floating bubbles' labels: two letters per bubble, none the same: a name's words without pr, issue and numbers (pr-14176-bound-regen: BR),
// the first two words' initials first (fix-cart-total: FC), then other pairs, then a word's first two letters, then
// its initial and a digit
export const initials = (names: string[]) => {
  const used = new Set<string>()
  return names.map(name => {
    const all = name.split(/[\s_./-]+/).filter(Boolean)
    const w = all.filter(x => !/^(\d+|pr|issue)$/i.test(x))
    const ws = (w.length ? w : all.length ? all : ['?']).map(x => [...x])
    const pairs = ws.flatMap((a, i) => ws.slice(i + 1).map(b => a[0] + b[0]))
    const tries = [...pairs, ...ws.map(a => a.slice(0, 2).join('')), ...[2, 3, 4, 5, 6, 7, 8, 9].map(d => ws[0][0] + d)].map(x => x.toUpperCase())
    const pick = tries.find(x => !used.has(x)) ?? tries[0]
    used.add(pick)
    return pick
  })
}

// a Browsers page's address bar: a URL as it is, a site (example.com, localhost:3000/x, 192.168.1.1) on http(s), else a search
export const browserUrl = (s: string) => {
  const t = s.trim()
  if (!t) return ''
  if (/^(https?:\/\/|about:blank$)/i.test(t)) return t
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i.test(t)) return `http://${t}` // this Mac, or a device on the network (a router): plain http
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t)) return `https://${t}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
}

// a diff's lines side by side, as GitHub's split view: a context line on both sides, a run of removed lines beside the
// added lines right after it, pair by pair; anything else (a hunk's @@, "\ No newline") across both
export type SplitRow<T> = { left?: T; right?: T; full?: T }
export function splitRows<T extends { old?: number; new?: number }>(lines: T[]): SplitRow<T>[] {
  const rows: SplitRow<T>[] = []
  const del = (l?: T) => !!l && l.old !== undefined && l.new === undefined
  const add = (l?: T) => !!l && l.new !== undefined && l.old === undefined
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]
    if (!del(l) && !add(l)) {
      rows.push(l.old !== undefined ? { left: l, right: l } : { full: l })
      i++
      continue
    }
    const dels: T[] = []
    const adds: T[] = []
    while (del(lines[i])) dels.push(lines[i++])
    while (add(lines[i])) adds.push(lines[i++])
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] })
  }
  return rows
}

// a review comment's ```suggestion block (GitHub's: 3 or more backticks or tildes, suggestion the info string's first
// word; unclosed, it runs to the end): the lines it puts in place of the thread's ([]: deletes them), and the comment
// without it. The first one only
export function suggestionOf(body: string): { lines: string[]; rest: string } | null {
  const ls = body.split(/\r?\n/)
  for (let i = 0; i < ls.length; i++) {
    const m = /^( {0,3})(`{3,}|~{3,})[ \t]*suggestion([ \t].*)?$/.exec(ls[i])
    if (!m || (m[2][0] === '`' && m[3]?.includes('`'))) continue
    const close = new RegExp(`^ {0,3}${m[2][0]}{${m[2].length},}[ \\t]*$`)
    let j = i + 1
    while (j < ls.length && !close.test(ls[j])) j++
    const indent = new RegExp(`^ {0,${m[1].length}}`)
    return { lines: ls.slice(i + 1, j).map(l => l.replace(indent, '')), rest: [...ls.slice(0, i), ...ls.slice(j + 1)].join('\n').trim() }
  }
  return null
}

// the new file's last n lines in a review comment's diff hunk (GitHub's diffHunk ends at the comment's line): what the
// review saw there; null: the hunk has fewer
export function reviewedLines(hunk: string, n: number): string[] | null {
  const ls = hunk.split(/\r?\n/)
  if (ls.at(-1) === '') ls.pop()
  const right = ls.filter(l => !/^(@@|-|\\)/.test(l)).map(l => l.slice(1))
  return n > 0 && right.length >= n ? right.slice(-n) : null
}

// the unchanged lines between a file's hunks, as GitHub's expand shows them (the full review's arrows): before each hunk,
// then after the last; lines from..to of the new file (none when to < from), the old file's number is the new one's +
// shift. heads: each hunk's @@ line; total: the new file's lines (unknown: Infinity)
export type Gap = { from: number; to: number; shift: number }
export function gapsOf(heads: string[], total: number): Gap[] {
  const out: Gap[] = []
  let newEnd = 0
  let shift = 0
  for (const h of heads) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(h)
    if (!m) continue
    const [a, b, c, d] = [+m[1], m[2] === undefined ? 1 : +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
    const oldStart = b ? a : a + 1 // an empty side's number is the line before it
    const newStart = d ? c : c + 1
    out.push({ from: newEnd + 1, to: newStart - 1, shift: oldStart - newStart })
    newEnd = newStart + d - 1
    shift = oldStart + b - 1 - newEnd
  }
  out.push({ from: newEnd + 1, to: total, shift })
  return out
}

// a review suggestion as an edit: lines start..end (from 1) were seen, become lines
export type Suggestion = { start: number; end: number; seen: string[]; lines: string[] }
const piecesOf = (text: string) => text.split(/(?<=\n)/) // each line with its own ending, the last one's maybe none
const bare = (p: string) => p.replace(/\r?\n$/, '')
export const linesAt = (text: string, start: number, end: number) => piecesOf(text).slice(start - 1, end).map(bare)
export const sameLines = (a?: string[] | null, b?: string[] | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

// suggestions put in a file's text, bottom-up so the line numbers hold: each one's lines must still be what the review
// saw, else it throws and nothing changes. New lines take the replaced ones' line endings (else the file's), the last
// one its last's; the file ends with a newline only if it did
export function applySuggestions(text: string, edits: Suggestion[]) {
  const ps = piecesOf(text)
  const down = [...edits].sort((a, b) => b.start - a.start)
  down.forEach((e, i) => {
    if (i && e.end >= down[i - 1].start) throw new Error('two suggestions on the same lines: apply them one at a time')
    const now = ps.slice(e.start - 1, e.end)
    if (e.start < 1 || e.end < e.start || e.end > ps.length || !sameLines(now.map(bare), e.seen)) throw new Error('changed since the review')
    const eol = (now.find(p => p.endsWith('\n')) ?? text).includes('\r\n') ? '\r\n' : '\n'
    const last = now.at(-1)!.slice(bare(now.at(-1)!).length)
    ps.splice(e.start - 1, now.length, ...e.lines.map((l, k) => l + (k === e.lines.length - 1 ? last : eol)))
  })
  const out = ps.join('')
  return !text || text.endsWith('\n') ? out : out.replace(/\r?\n$/, '')
}

// Voice's recording as a WAV file (voice.ts, for OpenRouter's speech-to-text): one channel of samples (-1..1) as 16-bit PCM
export function wavOf(samples: Float32Array, rate: number) {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const str = (at: number, s: string) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  b.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVEfmt ')
  b.setUint32(16, 16, true) // the fmt chunk's size
  b.setUint16(20, 1, true) // PCM
  b.setUint16(22, 1, true) // one channel
  b.setUint32(24, rate, true)
  b.setUint32(28, rate * 2, true) // bytes a second
  b.setUint16(32, 2, true) // bytes a sample
  b.setUint16(34, 16, true) // bits
  str(36, 'data')
  b.setUint32(40, samples.length * 2, true)
  samples.forEach((v, i) => b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true))
  return new Uint8Array(b.buffer)
}

// a shell's command (vim, a server, a REPL) spins its first SHELL_SPIN ms only, then shows as idle: it may run for
// good. An agent, and one typed in a shell (runs), spins its whole turn. App re-renders as one crosses it (spinsUntil)
export const SHELL_SPIN = 5000
const shellish = (t: TabView) => (t.kind === 'shell' || t.kind === 'dev') && !t.runs // a terminal or the run tab; not one running an agent
const quiet = (t: TabView, now: number) => t.status === 'running' && shellish(t) && !!t.runAt && now - t.runAt >= SHELL_SPIN
export const shownStatus = (t: TabView, now = Date.now()) => (quiet(t, now) ? 'idle' : t.status)
export const spins = (t: TabView, now = Date.now()) => shownStatus(t, now) === 'running'
// when the next shell stops spinning (ms from now), or undefined: none will
export function spinsUntil(tabs: TabView[], now = Date.now()) {
  const left = tabs.filter(t => t.status === 'running' && shellish(t) && t.runAt && !quiet(t, now)).map(t => t.runAt! + SHELL_SPIN - now)
  return left.length ? Math.max(0, Math.min(...left)) : undefined
}

// dialogs one at a time (extension tools' asks): the first is on screen; drop: answered or gone, true when it was the
// one on screen; front: a notification's click brings one first, the one on screen back to second
export class Line<T extends { req: string }> {
  items: T[] = []
  get first(): T | undefined {
    return this.items[0]
  }
  add(t: T) {
    this.items.push(t)
  }
  has(req: string) {
    return this.items.some(x => x.req === req)
  }
  drop(req: string) {
    const i = this.items.findIndex(x => x.req === req)
    if (i >= 0) this.items.splice(i, 1)
    return i === 0
  }
  front(req: string) {
    const i = this.items.findIndex(x => x.req === req)
    if (i > 0) this.items.unshift(...this.items.splice(i, 1))
    return i > 0
  }
}

// a plan limit nearly used (App, on each of Usage.tsx's minute reads): a window (agent, account, label) at `at`% or more
// now and below it at the last reading (last: each window's then; none, as the app opens: past it already counts),
// unless told for this reset (told: each window's reset when it was said; within an hour is the same one, as Codex's may
// come from "in n seconds"). A window past its reset is at 0; one with a note (an amount, extra usage) isn't a limit.
// seen: last as it is now
export { USAGE_AT } from '../../shared/types.ts'
export type LimitHit = { id: string; r: AgentUsage; w: UsageWindow; used: number }
export function limitsCrossed(rows: AgentUsage[], at: number, last: Record<string, number>, told: Record<string, number>, now = Date.now()) {
  const seen = { ...last }
  const hits: LimitHit[] = []
  for (const r of rows)
    for (const w of r.windows) {
      if (w.note) continue
      const id = `${r.agent}:${r.account ?? HOME_ACCOUNT}:${w.label}`
      const used = w.resets && w.resets <= now ? 0 : w.used
      const was = last[id]
      seen[id] = used
      if (used >= at && (was === undefined || was < at) && !(id in told && Math.abs(told[id] - (w.resets ?? 0)) < 3600_000)) hits.push({ id, r, w, used })
    }
  return { hits, seen }
}
// "Claude Code · 5-hour limit at 92% · resets 5:00 PM": the account named when the agent has several
export function limitText({ r, w, used }: LimitHit, rows: AgentUsage[], now = Date.now()) {
  const who = [AGENT_NAMES[r.agent as Agent] ?? r.agent, rows.filter(x => x.agent === r.agent).length > 1 && r.name].filter(Boolean).join(' · ')
  const at = w.resets && new Date(w.resets)
  const when = at && at.toLocaleString([], at.toDateString() === new Date(now).toDateString() ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return `${who} · ${w.label} limit at ${used}%${when ? ` · resets ${when}` : ''}`
}

// a delayed start in words (wsNew startAt): Starts Fri 09:00, Starts at the limit reset ~14:20, or why it didn't
export function pendingWords(p: PendingView, long = false) {
  const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (p.failed) return `Didn't start: ${p.failed}`
  if (p.limit) return `Starts at the limit reset${p.at ? ` ~${hm(p.at)}` : ''}`
  return p.at ? `Starts ${new Date(p.at).toLocaleString([], { weekday: 'short', ...(long && { day: 'numeric', month: 'short' }), hour: '2-digit', minute: '2-digit' })}` : 'Starts later'
}
// the Words sidebar style (Settings' SIDE_STYLES 'words'): a row's second line says the one thing that matters most,
// the first of these that applies; its first line one PR pill (prPill) instead of the marks. The palette and the peek
// card can say the same (ROW_WORDS)
export const ROW_WORDS = { asks: 'Asks', pick: 'Asks you to pick', ci: 'CI failing', conflict: 'Conflicts with', changes: 'Changes requested by', working: 'Working', done: 'Done', unseen: 'not looked at', ready: 'Ready to merge' }
export type RowTone = 'waiting' | 'error' | 'running' | 'done' | 'muted'
export type RowFact = { kind: 'asks' | 'ci' | 'conflict' | 'changes' | 'working' | 'done' | 'ready' | 'later' | 'branch'; text: string; tone: RowTone; since?: number; note?: string } // since: a turn's start, its time after the words; note: the agent's progress after that
export function rowFact(w: { branch?: string; base?: string; pr?: PR; stat?: Stat; pending?: PendingView }, tabs: TabView[]): RowFact {
  const agents = tabs.filter(t => t.kind === 'agent' || t.runs)
  const asks = agents.find(t => t.status === 'waiting')
  if (asks) return { kind: 'asks', text: asks.ask?.question ? `${ROW_WORDS.asks}: ${asks.ask.question}` : ROW_WORDS.pick, tone: 'waiting' }
  const pr = w.pr?.state === 'OPEN' ? w.pr : undefined
  if (pr?.checks === 'fail') return { kind: 'ci', text: (c => (c ? `${ROW_WORDS.ci} · ${c}` : ROW_WORDS.ci))(pr.list?.find(c => c.state === 'fail')?.name), tone: 'error' }
  if (pr?.conflict) return { kind: 'conflict', text: `${ROW_WORDS.conflict} ${pr.base || w.base || 'its base'}`, tone: 'error' }
  if (pr?.review === 'CHANGES_REQUESTED' || pr?.changes?.length) return { kind: 'changes', text: `${ROW_WORDS.changes} ${pr.changes?.join(', ') || 'a reviewer'}`, tone: 'error' }
  const working = agents.find(t => t.status === 'running')
  if (working) {
    const p = working.progress
    return { kind: 'working', text: ROW_WORDS.working, tone: 'running', since: working.runAt, ...(p && { note: p.note || `${p.pct}%` }) }
  }
  if (agents.some(t => t.done && t.status === 'idle')) {
    const stat = w.stat && (w.stat.add || w.stat.del) ? `+${w.stat.add} −${w.stat.del}` : ''
    return { kind: 'done', text: [ROW_WORDS.done, stat, ROW_WORDS.unseen].filter(Boolean).join(' · '), tone: 'done' }
  }
  if (pr && !pr.draft && pr.checks !== 'pending' && (pr.review === 'APPROVED' || (!pr.review && !!pr.approved?.length))) return { kind: 'ready', text: ROW_WORDS.ready, tone: 'done' }
  if (w.pending) return { kind: 'later', text: pendingWords(w.pending), tone: w.pending.failed ? 'error' : 'muted' }
  return { kind: 'branch', text: w.branch || 'folder', tone: 'muted' }
}
// the Words style's one PR pill: #n and how it stands
export function prPill(pr: PR): { text: string; tone: RowTone | 'merged' } {
  const n = `#${pr.number}`
  if (pr.state === 'MERGED') return { text: `${n} merged`, tone: 'merged' }
  if (pr.state !== 'OPEN') return { text: `${n} closed`, tone: 'muted' }
  if (pr.draft) return { text: `${n} draft`, tone: 'muted' }
  if (pr.conflict) return { text: `${n} ⚠`, tone: 'error' }
  if (pr.checks === 'fail') return { text: `${n} ✕`, tone: 'error' }
  if (pr.checks === 'pass') return { text: `${n} ✓`, tone: 'done' }
  return { text: n, tone: pr.checks === 'pending' ? 'running' : 'muted' }
}

// fuzzy: the query's characters in order; contiguous runs and word starts score higher
export function fuzzy(q: string, s: string): number {
  q = q.toLowerCase()
  s = s.toLowerCase()
  if (!q) return 1
  let score = 0
  let j = 0
  let prev = -2
  for (let i = 0; i < s.length && j < q.length; i++) {
    if (s[i] !== q[j]) continue
    score += 1 + (i === prev + 1 ? 2 : 0) + (i === 0 || /[\s/\-_.]/.test(s[i - 1]) ? 3 : 0)
    prev = i
    j++
  }
  return j === q.length ? score - s.length * 0.01 : 0
}

// the palette's groups (⌘K), each under a heading: with nothing typed, what the focused workspace needs next (for),
// every other tab that needs you, the last few picked, then workspaces, tabs and actions as given; typing matches
// everything as before (fuzzy over the label and hint, a recent pick a little ahead), the suggestions first when they
// match, then each kind under its heading, the best match's group first
export type PalKind = 'for' | 'needs' | 'ws' | 'tab' | 'action'
const PAL_HEADS: Record<Exclude<PalKind, 'for'>, string> = { needs: 'Needs you', ws: 'Workspaces', tab: 'Tabs', action: 'Actions' }
export const PAL_RECENT = 30 // laki.recent's length
export function paletteGroups<T extends { label: string; hint?: string; kind?: PalKind }>(items: T[], q: string, recent: string[], forName = 'this workspace', recentMax = 8): { head: string; items: T[] }[] {
  const kind = (x: T): PalKind => x.kind ?? 'action'
  const head = (k: PalKind) => (k === 'for' ? `For ${forName}` : PAL_HEADS[k])
  const of = (k: PalKind, xs: T[]) => ({ head: head(k), items: xs.filter(x => kind(x) === k) })
  const top = (x: T) => kind(x) === 'for' || kind(x) === 'needs'
  if (!q.trim()) {
    const rec = recent.flatMap(l => items.filter(x => x.label === l && !top(x)).slice(0, 1)).slice(0, recentMax)
    const rest = items.filter(x => !rec.includes(x))
    return [of('for', items), of('needs', items), { head: 'Recent', items: rec }, of('ws', rest), of('tab', rest), of('action', rest)].filter(g => g.items.length)
  }
  const score = new Map<T, number>()
  for (const x of items) {
    const all = `${x.label} ${x.hint ?? ''}`
    const s = fuzzy(q, all) && fuzzy(q, x.label) + 0.5 * fuzzy(q, all)
    const r = recent.indexOf(x.label)
    if (s > 0) score.set(x, s + (r < 0 ? 0 : PAL_RECENT - r) * 0.1) // a recent one wins a close call, not a much better match
  }
  const hits = [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)!)
  const rest = (['ws', 'tab', 'action'] as const).map(k => of(k, hits)).filter(g => g.items.length).sort((a, b) => score.get(b.items[0])! - score.get(a.items[0])!)
  return [of('for', hits), of('needs', hits), ...rest].filter(g => g.items.length)
}

// q's characters in order in s, case aside: a score (contiguous runs and word starts count more) and
// where they matched; null when they don't
function fileMatch(q: string, s: string) {
  const ls = s.toLowerCase()
  const hits: number[] = []
  let score = 0
  let j = 0
  for (const c of q) {
    j = ls.indexOf(c, j)
    if (j < 0) return null
    const start = j === 0 || '/_-. '.includes(s[j - 1]) || (s[j] !== ls[j] && s[j - 1] === ls[j - 1])
    score += 1 + (hits.at(-1) === j - 1 ? 3 : 0) + (start ? 2 : 0)
    hits.push(j++)
  }
  return { score, hits }
}

// the files matching q best: its letters in the file name first, else anywhere in the path
// ponytail: greedy first match per letter, not the best alignment; fine for picking files
export function findFiles(q: string, files: string[], max = 60) {
  q = q.toLowerCase().replace(/\s+/g, '')
  if (!q) return files.slice(0, max).map(path => ({ path, hits: [] as number[] }))
  const out: { path: string; hits: number[]; score: number }[] = []
  for (const path of files) {
    const at = path.lastIndexOf('/') + 1
    const b = fileMatch(q, path.slice(at))
    const m = b ? { score: b.score * 2 + 10, hits: b.hits.map(h => h + at) } : fileMatch(q, path)
    if (m) out.push({ path, hits: m.hits, score: m.score - path.length * 0.02 })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}

// the prompt boxes' completion (PromptInput's complete): @ a file, # a PR or issue, after the start or a space; / a
// prompt template at the start of a line. The trigger the caret is in, its word so far and where it starts
export type Trigger = { ch: '@' | '#' | '/'; q: string; from: number }
export function triggerAt(v: string, caret: number): Trigger | null {
  const before = v.slice(0, caret)
  const m = /(^|\s)([@#])([^\s@#]*)$/.exec(before)
  if (m) return { ch: m[2] as '@' | '#', q: m[3], from: caret - m[3].length - 1 }
  const s = /(^|\n)\/([^\s/]*)$/.exec(before)
  return s ? { ch: '/', q: s[2], from: caret - s[2].length - 1 } : null
}
export type Ref = { n: number; title: string; url: string; kind: 'PR' | 'issue' }
// the rows a trigger offers, 8 at most: files (changed ones first when nothing is typed), refs by number or title words,
// templates by name
export function completions(t: Trigger, o: { files?: string[]; changed?: string[]; refs?: Ref[]; templates?: Template[] }, max = 8): { label: string; sub?: string; value: string; template?: Template }[] {
  const q = t.q.toLowerCase()
  if (t.ch === '@') {
    const changed = new Set(o.changed ?? [])
    const all = [...(o.changed ?? []).filter(f => (o.files ?? []).includes(f) || !o.files), ...(o.files ?? []).filter(f => !changed.has(f))]
    return findFiles(q, all, max).map(f => ({ label: f.path.slice(f.path.lastIndexOf('/') + 1), sub: `${f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}${changed.has(f.path) ? (f.path.includes('/') ? ' · changed' : 'changed') : ''}`, value: f.path }))
  }
  if (t.ch === '#') {
    const words = q.replace(/^#/, '').split(/\s+/).filter(Boolean)
    return (o.refs ?? [])
      .filter(r => words.every(w => String(r.n).startsWith(w) || r.title.toLowerCase().includes(w)))
      .slice(0, max)
      .map(r => ({ label: `#${r.n} ${r.title}`, sub: r.kind, value: r.url }))
  }
  return (o.templates ?? []).filter(x => x.name.toLowerCase().includes(q)).slice(0, max).map(x => ({ label: `/${x.name}`, sub: x.text.split('\n')[0].slice(0, 60), value: x.text, template: x }))
}
// a pick put in: the trigger's word replaced by a path or URL and a space, or by a template's text, the caret where
// its {{prompt}} was (else at its end)
export function completeInto(v: string, t: Trigger, caret: number, value: string, template?: boolean) {
  if (!template) return { value: `${v.slice(0, t.from)}${value}${/^\s/.test(v.slice(caret)) ? '' : ' '}${v.slice(caret)}`, caret: t.from + value.length + 1 } // a space after it (one there already: past it)
  const at = value.search(/\{\{\s*prompt\s*\}\}/)
  const [a, b] = at < 0 ? [fillTemplate(value, {}), ''] : [fillTemplate(value.slice(0, at), {}), fillTemplate(value.slice(at).replace(/^\{\{\s*prompt\s*\}\}/, ''), {})]
  return { value: `${v.slice(0, t.from)}${a}${b}${v.slice(caret)}`, caret: t.from + a.length }
}
