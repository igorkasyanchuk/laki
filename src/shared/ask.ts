import type { Ask } from './types.ts'

// a waiting agent's numbered menu at the bottom of its screen (claude's, codex's, gemini's permission prompts and
// questions): the last run of "1. …", "2. …" lines, one of them highlighted (❯ › > ● before its number; a menu always
// has one, a numbered list in an answer doesn't); box borders (│) aside. cursor: the line the terminal's cursor is on,
// when it shows: at or below the menu's first line it's a prompt being typed ("› 1. production" in codex's box, the
// user's own list), not a menu (claude's and codex's menus hide the cursor)
const OPTION = /^\s*([❯›>▶●→])?\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/
const RULE = /^[\s─━═╌╍┄┅╭╮╰╯┌┐└┘├┤┬┴┼-]*$/ // a box's top or bottom: no words
// claude's questions asked at once (AskUserQuestion with several): a line of their tabs over the menu, ← first and →
// last (←  ☐ Database  ☐ Auth  ✔ Submit  →); ←/→ go between them
const STEPS = /^\s*←.*(☐|☒|☑|✔|✓|□|■|Submit).*→\s*$/ // a box or Submit in it: not just any line with arrows
export function askOf(text: string, cursor?: number): Ask | undefined {
  const lines = text.split('\n').map(raw => raw.replace(/^[\s│|]+|[\s│|]+$/g, ' '))
  let opts: Ask['options'] = []
  let at = 0
  let first = 0 // the line of option 1
  let best: Ask | undefined
  let bestAt = 0 // its first line
  lines.forEach((line, i) => {
    const m = line.match(OPTION)
    if (!m) return
    const n = Number(m[2])
    if (n === 1) (opts = []), (at = 0), (first = i)
    else if (n !== opts.length + 1) return // not the next one: some other numbered line
    opts.push({ n, label: m[3].slice(0, 80) })
    if (m[1]) at = n
    if (opts.length >= 2 && at) (best = { options: [...opts], at, ...(q => q && { question: q })(questionAt(lines, first)), ...(lines.slice(Math.max(0, first - 8), first).some(l => STEPS.test(l)) && { steps: true }) }), (bestAt = first)
  })
  return cursor !== undefined && cursor >= bestAt ? undefined : best
}

// what it asks: the nearest line or two above the menu with words in them (blank ones just above skipped), the one just
// above alone when it's a question ("Do you want to proceed?"); 200 characters at most
function questionAt(lines: string[], i: number) {
  const got: string[] = []
  for (let j = i - 1; j >= 0 && got.length < 2; j--) {
    const l = lines[j].trim()
    if (!l || RULE.test(l)) {
      if (got.length) break
      continue
    }
    got.unshift(l)
    if (got.length === 1 && l.endsWith('?')) break
  }
  return got.join(' · ').replace(/\s+/g, ' ').slice(0, 200)
}

// ---------- a claude permission ask, from its PermissionRequest hook (tool_name, tool_input, permission_suggestions):
// what the tool touches in a line, and the "don't ask again" rule its menu offers, made readable
export type Perm = { tool: string; what: string; rule?: string; diff?: string }
const WHAT_MAX = 300
const cut = (s: string) => (s.length > WHAT_MAX ? `${s.slice(0, WHAT_MAX - 1)}…` : s)
const line = (s: string) => s.replace(/\s*\n\s*/g, ' ↵ ').trim() // a command's lines on one, its breaks still seen
const short = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}
// a path in the workspace (root) as from its folder, one under home as ~/…; else as it is
export function nearPath(p: string, root?: string, home?: string) {
  const r = root?.replace(/\/+$/, '')
  if (r && p.startsWith(`${r}/`)) return p.slice(r.length + 1)
  const h = home?.replace(/\/+$/, '')
  return h && (p === h || p.startsWith(`${h}/`)) ? `~${p.slice(h.length)}` : p
}
// a line diff of before and after: ' ' kept, '-' gone, '+' new, gone before new (LCS)
// ponytail: O(n·m); past 90,000 line pairs every old line out and every new one in
export function lineDiff(a: string, b: string): string[] {
  const x = a ? a.split('\n') : [], y = b ? b.split('\n') : []
  const n = x.length, m = y.length
  if (n * m > 90000) return [...x.map(l => `-${l}`), ...y.map(l => `+${l}`)]
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1)) // L[i][j]: the common lines of x[i…] and y[j…]
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: string[] = []
  for (let i = 0, j = 0; i < n || j < m; )
    if (i < n && j < m && x[i] === y[j]) out.push(` ${x[i++]}`), j++
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) out.push(`-${x[i++]}`)
    else out.push(`+${y[j++]}`)
  return out
}
const DIFF_LINES = 200
const DIFF_CHARS = 12000 // it rides in every view while the tab waits
// what an Edit, MultiEdit or Write would change, as lineDiff's lines (prior: a Write's file as it is now, '' a new
// one; null or unset: none shown), at most 200 lines of 300 characters and 12,000 in all, then how many more and their
// counts (diffCounts reads them); the approval cards show it (Reader, the bar, Needs you, the island)
export function permDiff(tool: string, i: Record<string, unknown>, prior?: string | null): string | undefined {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const lines =
    tool === 'Edit' ? lineDiff(s(i.old_string), s(i.new_string))
    : tool === 'MultiEdit' && Array.isArray(i.edits) ? i.edits.flatMap((e: any, k: number) => [...(k ? ['…'] : []), ...lineDiff(s(e?.old_string), s(e?.new_string))])
    : tool === 'Write' && typeof i.content === 'string' && typeof prior === 'string' ? lineDiff(prior, i.content)
    : undefined
  if (!lines?.some(l => l[0] === '-' || l[0] === '+')) return
  const shown: string[] = []
  let size = 0
  for (const raw of lines.slice(0, DIFF_LINES)) {
    const l = raw.length > 300 ? `${raw.slice(0, 299)}…` : raw
    if (size + l.length > DIFF_CHARS) break
    shown.push(l)
    size += l.length + 1
  }
  const rest = lines.slice(shown.length)
  const n = (c: string) => rest.filter(l => l[0] === c).length
  return [...shown, ...(rest.length ? [`…${rest.length} more lines (+${n('+')} −${n('-')})`] : [])].join('\n')
}
// a diff's + and − lines, the ones past its cut too (permDiff's last line)
export function diffCounts(d: string) {
  const ls = d.split('\n')
  const more = /^…\d+ more lines \(\+(\d+) −(\d+)\)$/.exec(ls.at(-1) ?? '')
  return { add: ls.filter(l => l[0] === '+').length + Number(more?.[1] ?? 0), del: ls.filter(l => l[0] === '-').length + Number(more?.[2] ?? 0) }
}
export function permOf(pl: { tool_name?: unknown; tool_input?: unknown; permission_suggestions?: unknown }, root?: string, home?: string, prior?: string | null): Perm | undefined {
  if (typeof pl?.tool_name !== 'string' || !pl.tool_name) return
  const tool = pl.tool_name
  const i = (pl.tool_input && typeof pl.tool_input === 'object' ? pl.tool_input : {}) as Record<string, unknown>
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  const what =
    tool === 'Bash' ? line(s('command'))
    : /^(Edit|Write|MultiEdit|NotebookEdit|Read)$/.test(tool) ? nearPath(s('file_path') || s('notebook_path'), root, home)
    : tool === 'Glob' || tool === 'Grep' ? s('pattern')
    : tool === 'WebFetch' ? s('url')
    : tool === 'WebSearch' ? s('query')
    : mcp ? `${mcp[1]}: ${mcp[2]} ${short(i)}`
    : s('description') || s('command') || s('file_path') || s('url') || short(i)
  return { tool: mcp ? mcp[1] : tool, what: cut(what), ...(r => r && { rule: r })(ruleOf(pl.permission_suggestions, root, home)), ...(d => d && { diff: d })(permDiff(tool, i, prior)) }
}
// the first suggestion that would stop the asking (a rule, a folder), not a mode switch: Bash's "npm init *" → npm init,
// WebFetch's "domain:example.com" → example.com, a folder as nearPath has it
function ruleOf(sug: unknown, root?: string, home?: string) {
  if (!Array.isArray(sug)) return
  for (const x of sug as { type?: string; rules?: { toolName?: string; ruleContent?: string }[]; directories?: string[] }[]) {
    if (x?.type === 'addRules' && Array.isArray(x.rules) && x.rules[0]) {
      const c = String(x.rules[0].ruleContent ?? '').replace(/^domain:/, '').replace(/(:\*|\s+\*)$/, '').trim()
      return cut(c || String(x.rules[0].toolName ?? '')) || undefined
    }
    if (x?.type === 'addDirectories' && typeof x.directories?.[0] === 'string') return cut(nearPath(x.directories[0], root, home))
  }
}
// the menu's "don't ask again" choice (claude: "Yes, and don't ask again for …", "Yes, and always allow access to …")
export const alwaysOf = (a?: Ask) => a?.options.find(o => /don['’]t ask again|always allow/i.test(o.label))
// what it wants to do, for a notification's title: "wants to run", "wants to edit"…
export const permVerb = (tool: string) =>
  tool === 'Bash' ? 'wants to run'
  : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) ? 'wants to edit'
  : /^(Read|Glob|Grep)$/.test(tool) ? 'wants to read'
  : tool === 'WebFetch' ? 'wants to fetch'
  : tool === 'WebSearch' ? 'wants to search'
  : `wants to use ${tool}`
