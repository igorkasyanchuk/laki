import type { Ask } from './types.ts'

// a waiting agent's numbered menu at the bottom of its screen (claude's, codex's, gemini's permission prompts and
// questions): the last run of "1. …", "2. …" lines, one of them highlighted (❯ › > ● before its number; a menu always
// has one, a numbered list in an answer doesn't); box borders (│) aside. cursor: the line the terminal's cursor is on,
// when it shows: at or below the menu's first line it's a prompt being typed ("› 1. production" in codex's box, the
// user's own list), not a menu (claude's and codex's menus hide the cursor)
const OPTION = /^\s*([❯›>▶●→])?\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/
const RULE = /^[\s─━═╌╍┄┅╭╮╰╯┌┐└┘├┤┬┴┼-]*$/ // a box's top or bottom: no words
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
    if (opts.length >= 2 && at) (best = { options: [...opts], at, ...(q => q && { question: q })(questionAt(lines, first)) }), (bestAt = first)
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
export type Perm = { tool: string; what: string; rule?: string }
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
export function permOf(pl: { tool_name?: unknown; tool_input?: unknown; permission_suggestions?: unknown }, root?: string, home?: string): Perm | undefined {
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
  return { tool: mcp ? mcp[1] : tool, what: cut(what), ...(r => r && { rule: r })(ruleOf(pl.permission_suggestions, root, home)) }
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
