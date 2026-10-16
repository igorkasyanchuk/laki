// Small text helpers, kept apart from React so tests can load them.

import { fillTemplate, mergeActions, prRef, type RunAction, type TabView, type Template, templated, templatesFor } from '../../shared/types.ts'
export type { Template }
// a prompt template (Settings → Prompt templates, and a project's own): {{prompt}} is what you type, {{project}} and
// {{base}} the new workspace's, {{pr}} its PR (prRef); an unknown {{name}} stays as it is
export { fillTemplate, mergeActions, prRef, templated, templatesFor } // shared: laki mcp's (Laki AI's) templates and actions too

// a workspace's name from what was typed, not the template around it (as the daemons do: its first words)
export const nameOf = (prompt: string) => prompt.trim().split(/\s+/).slice(0, 4).join(' ') || undefined

// a path for the status bar: ~ for the home folder, and only the last two folders of a long one
export function shortPath(p: string) {
  const parts = p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~').split('/')
  return parts.length > 4 ? [parts[0], '…', ...parts.slice(-2)].join('/') : parts.join('/')
}

// what the daemons take: an address, or *@domain for a whole domain (cloudflared's wildcard domains)
export const MAIL_OK = /^(?:\*|[^\s@*,]+)@[^\s@*,]+\.[^\s@*,]+$/

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
const KINDS: Record<string, string> = { presets: 'array null', memory: 'array', imageDays: 'number', templates: 'array', actions: 'array', tunnelMails: 'array', widgetDirs: 'array', favThemes: 'array', env: 'object', prPrompts: 'object', webhook: 'object', ai: 'object', voice: 'object', prScan: 'number', prTries: 'number', sleepAfter: 'number', pageZoom: 'number', notifyOn: 'object', usage: 'object', projectLook: 'object', sideLook: 'object', prMarks: 'object', planTemplates: 'array', railPlans: 'array', fontSize: 'number', lineHeight: 'number', letterSpacing: 'number', minContrast: 'number', scrollSpeed: 'number', glassWindow: 'number', glassSide: 'number', glassTerm: 'number', sideClear: 'number', floaterRecent: 'number', floaterRecentHours: 'number', floaterMax: 'number' }
// an imported settings file (Settings › General › Import): a field of the wrong kind (a file from another version) is
// left out, the rest comes in; one this version doesn't know stays, harmless. ponytail: top level only
export function importable(v: Record<string, unknown>) {
  const kind = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x)
  const bad = Object.keys(v).filter(k => KINDS[k] && v[k] !== undefined && !KINDS[k].split(' ').includes(kind(v[k])))
  return { ok: Object.fromEntries(Object.entries(v).filter(([k]) => !bad.includes(k))), bad }
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
