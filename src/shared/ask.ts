import type { Ask } from './types.ts'

// a waiting agent's numbered menu at the bottom of its screen (claude's, codex's, agy's permission prompts and
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
    : tool === 'AskUserQuestion' ? (q => (typeof q === 'string' ? line(q) : ''))((i.questions as { question?: unknown }[] | undefined)?.[0]?.question) // claude asking you, not a tool to allow: its question, not its JSON
    : mcp ? `${mcp[1]}: ${mcp[2]} ${short(i)}`
    : s('description') || s('command') || s('file_path') || s('url') || short(i)
  return { tool: mcp ? mcp[1] : tool, what: cut(what), ...(r => r && { rule: r })(ruleOf(pl.permission_suggestions, root, home)), ...(d => d && { diff: d })(permDiff(tool, i, prior)) }
}
// the first suggestion that would stop the asking (a rule, a folder), not a mode switch: Bash's "npm init:*" → npm init *,
// WebFetch's "domain:example.com" → example.com, a folder as nearPath has it
function ruleOf(sug: unknown, root?: string, home?: string) {
  if (!Array.isArray(sug)) return
  for (const x of sug as { type?: string; rules?: { toolName?: string; ruleContent?: string }[]; directories?: string[] }[]) {
    if (x?.type === 'addRules' && Array.isArray(x.rules) && x.rules[0]) {
      const c = String(x.rules[0].ruleContent ?? '').replace(/^domain:/, '').replace(/:\*$/, ' *').trim() // its wildcard kept: the scope it grants, whole
      return cut(c || String(x.rules[0].toolName ?? '')) || undefined
    }
    if (x?.type === 'addDirectories' && typeof x.directories?.[0] === 'string') return cut(nearPath(x.directories[0], root, home))
  }
}
// the menu's "don't ask again" choice (claude: "Yes, and don't ask again for …", "Yes, and always allow access to …")
export const alwaysOf = (a?: Ask) => a?.options.find(o => /don['’]t ask again|always allow/i.test(o.label))
// an option's words on a button (the ask bar's, the Reader's): the "don't ask again" one names its rule
export const optLabel = (a: Ask, o: Ask['options'][number]) => (a.rule && o === alwaysOf(a) ? `Yes, don't ask again for ${a.rule}` : o.label)

// a choice that grants a standing permission, split into its words (label) and the rule it grants (rule: the part after
// "for" / "for:" / "access to"), whole, for drawing the rule on a line of its own; null when it grants none or its rule
// can't be told apart ("for this command", "for this session"). broad: a wildcard, a folder or a whole tool; plain: what
// it covers in words, only where that can be said safely. Per agent: claude's "Yes, and don't ask again for: npm init *",
// "Yes, and always allow access to src/ from this project", "Yes, allow all edits during this session"; codex's "Yes,
// and don't ask again for this command" (its command is the question above: no rule here); an "Allow always …" or
// "Yes, always allow tool …" (Gemini CLI's; ponytail: agy's, the gemini agent's now, read the same way, unverified); an unknown agent: all of them
export type Scope = { label: string; rule: string; broad?: true; plain?: string }
const SCOPE_CLAUDE = [/^(.*?\bdon['’]t ask again for):?\s+(.+)$/i, /^(.*?\balways allow access to)\s+(.+)$/i, /^(.*?\ballow)\s+(all edits\b.*)$/i]
const SCOPE_GEMINI = [/^(.*?\b(?:allow always|always allow)(?: for)?):?\s+(.+)$/i]
const SCOPES: Record<string, RegExp[]> = { claude: SCOPE_CLAUDE, codex: [SCOPE_CLAUDE[0]], gemini: SCOPE_GEMINI }
const NO_RULE = /^(this|these|that|the|its)\b|^(session|command|commands|files?|tools?)$/i // words, not a rule
const TOOL_WORDS: Record<string, string> = { bash: 'every command', edit: 'every file edit', write: 'every file edit', multiedit: 'every file edit', notebookedit: 'every file edit', 'all edits': 'every file edit', read: 'every file read', webfetch: 'every web fetch', websearch: 'every web search' }
const SAFE = /^[\w@.\/:=+~-]+(?: [\w@.\/:=+~-]+){0,5}$/ // a few plain words: no quotes, globs, pipes or substitutions
export function askScope(choice: string, agent?: string): Scope | null {
  const text = choice.replace(/\s*\((?:shift\+tab|esc|tab|[a-z])\)\s*$/i, '').trim() // its key's hint
  const m = (SCOPES[agent ?? ''] ?? [...SCOPE_CLAUDE, ...SCOPE_GEMINI]).map(r => r.exec(text)).find(Boolean)
  const rule = m?.[2].trim()
  if (!m || !rule || NO_RULE.test(rule)) return null
  const label = m[1].trim()
  const first = rule.split(/\s+/)[0]
  const path = /^(~|\.{0,2})\/|\/$/.test(first) || (first.includes('/') && !/\s/.test(rule))
  const dir = path && !/\.\w{1,6}$/.test(first.replace(/[/*]+$/, '')) // no file extension: a folder
  const tool = TOOL_WORDS[rule.toLowerCase().replace(/\s+(during|for) this session$/, '')]
  const prefix = /^(.+?)(?::\*| \*)$/.exec(rule)?.[1] ?? /^(.+?) commands\b/.exec(rule)?.[1] // "npm init *", "npm test commands in …"
  const broad = /[*?]/.test(rule) || dir || !!tool || !!prefix || /\ball (tools|edits|commands)\b/i.test(rule)
  const plain =
    tool ? tool
    : prefix && SAFE.test(prefix) && !/[*?]/.test(prefix) ? (path ? `every file under ${prefix.replace(/\/+$/, '')}` : `every command that starts with ${prefix}`)
    : dir && SAFE.test(first) ? `every file under ${first.replace(/[/*]+$/, '')}`
    : /^\*\.([\w-]+(\.[\w-]+)+)$/.exec(rule)?.[1].replace(/^/, 'every subdomain of ')
  return { label, rule, ...(broad && { broad: true as const }), ...(broad && plain && plain.length <= 80 && { plain }) }
}
// a choice that grants more than this one ask: a "don't ask again", "always", "for this session" one, its rule told
// apart or not: never what one click for several (Allow all) or a global hotkey picks
export const standing = (label: string) => !!askScope(label) || /don['’]t ask again|always allow|allow always|for this session|allow all\b/i.test(label)
// what it wants to do, for a notification's title: "wants to run", "wants to edit"…
export const permVerb = (tool: string) =>
  tool === 'Bash' ? 'wants to run'
  : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) ? 'wants to edit'
  : /^(Read|Glob|Grep)$/.test(tool) ? 'wants to read'
  : tool === 'WebFetch' ? 'wants to fetch'
  : tool === 'WebSearch' ? 'wants to search'
  : `wants to use ${tool}`

// ---------- U8: Needs you's Allow all and Deny all: which waiting asks one click may answer

// a command one click never allows: what deletes, rewrites history, runs as root or pipes the web into a shell
// ponytail: a list of patterns, not a shell parser; a command it misses is still on its card, and the confirm names it
const RISKY = [
  /\brm\s+(-\S*[rRf]|--recursive|--force)/,
  /\bgit\s+push\b.*(\s-\S*f\b|\s--force|\s--mirror|\s--delete|\s:\S|\s\+\S)/, // +branch: a force push too
  /\bgit\s+(reset\s+--hard|clean\s+-\S*f|checkout\s+(--\s|\.\s*$)|restore\b|branch\s+-D|stash\s+(drop|clear)|filter-(branch|repo)|update-ref\s+-d|reflog\s+expire)/,
  /\bsudo\b|\bsu\s/,
  /\b(chmod|chown)\s+-\S*R/,
  /\b(mkfs|shred|diskutil\s+erase|dd\s+if=)/,
  /\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/,
  /\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i,
  /\b(kill|pkill|killall)\s+-9\b/,
  /\bfind\b.*\s-delete\b/,
  /(^|[;&|]\s*)>\s*\/|\b(tee|cp|mv)\b.*\s\/(etc|usr|bin|System|Library)\//,
]
export const risky = (cmd: string) => RISKY.some(r => r.test(cmd))
// a path out of the worktree: absolute, the home folder's, or up out of it (nearPath writes the worktree's as relative)
const OUTSIDE = /(^|[\s'"=:(])(\/|~|\.\.(\/|$|[\s;&|)]))|\$\{?(HOME|TMPDIR)\b/ // $HOME and $TMPDIR are out of it too
const FILES = /^(Bash|Edit|Write|MultiEdit|NotebookEdit|Read)$/ // what a path in its text is written or read
const YES = /^(yes|allow|approve|proceed|run)\b/i
const NO = /^(no|deny|reject|cancel|don['’]t)\b/i
// a plain yes … no menu: its first an allow of this one ask (never a standing permission: standing), its last a no
const yesNo = (a: Ask) => a.options.length >= 2 && YES.test(a.options[0].label) && !standing(a.options[0].label) && NO.test(a.options.at(-1)!.label)
// a permission ask (claude's PermissionRequest: its tool and what it touches, the exact text the confirm shows), its
// first option an allow and its last a no (or no menu read: Allow / Deny), never a secret, one of several questions,
// a risky command, or, unless the tab's sandbox is known on, one that touches a path outside the worktree
export function bulkOk(t: { status?: string; ask?: Ask; secret?: unknown }, sandboxOn = false) {
  const a = t.ask
  if (t.status !== 'waiting' || t.secret || !a?.tool || !a.what?.trim() || a.what.endsWith('…') || a.steps) return false // cut (permOf's 300): its end unseen
  if (a.options.length && !yesNo(a)) return false
  return !risky(a.what) && (sandboxOn || !FILES.test(a.tool) || !OUTSIDE.test(a.what))
}
// "No, and say why": the agent's own way to hear it (claude's "No, and tell Claude what to do differently (esc)",
// codex's), else a no that's its menu's last (deny: the words go as the next message once it took the answer)
export const TELL_WHY = /\btell \w+ what to do differently\b/i
export const denyOf = (a: Ask) => a.options.find(o => TELL_WHY.test(o.label)) ?? (a.options.length >= 2 && NO.test(a.options.at(-1)!.label) ? a.options.at(-1) : undefined)
export const sayable = (label: string) => TELL_WHY.test(label) || NO.test(label)
// what Allow all / Deny all and the global hotkeys send: the first option (a plain yes: never a standing permission) or
// the last (a no); none when the menu isn't a plain yes … no (then nothing is sent)
export const bulkPick = (a: Ask, allow: boolean) => (yesNo(a) ? (allow ? a.options[0] : a.options.at(-1)) : undefined)
// the confirm's lines: the same tool and the same text in several workspaces, one line
export function bulkGroups<T extends { ask?: Ask }>(list: T[], name: (x: T) => string) {
  const m = new Map<string, { tool: string; what: string; names: string[] }>()
  for (const x of list) {
    const k = `${x.ask!.tool}\0${x.ask!.what}`
    const g = m.get(k) ?? (m.set(k, { tool: x.ask!.tool!, what: x.ask!.what!, names: [] }), m.get(k)!)
    if (!g.names.includes(name(x))) g.names.push(name(x))
  }
  return [...m.values()]
}

// ---------- F14: auto-answer rules, per project and the same for every agent (project.allow): an ask a rule matches
// is answered Allow as your click would. Only you add them (Settings › the project, a card's Always allow in this
// project); never agents or remote access (main.ts), none under a managed policy's allowRules: false
export type AllowRule = { tool: string; pattern: string; addedAt: number; hits?: number }
export const RULE_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'Read']
const CHAIN = /[;&|`<>\n\\]|\$[({]|↵/ // more than one command, a redirect, a substitution, an escape: a prefix says nothing of the rest
// a path glob as a pattern: ** any folders, * anything but a /, ? one character
function globRe(g: string) {
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*' && g[i + 1] === '*') (re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'), (i += g[i + 2] === '/' ? 2 : 1)
    else re += c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
// a rule's pattern as Laki takes it: a command (a prefix, or a glob with *) for Bash, a path glob in the worktree for
// the file tools; '' when it isn't one (refused: a risky or chained command, a bare *, a path out of the worktree)
export function rulePattern(tool: string, pattern: unknown): string {
  const p = typeof pattern === 'string' ? pattern.trim().replace(/\s+/g, tool === 'Bash' ? ' ' : '') : ''
  if (!RULE_TOOLS.includes(tool) || !p || p.length > 300 || /^[*\s/.]*$/.test(p)) return ''
  if (tool === 'Bash') return CHAIN.test(p) || risky(p) || OUTSIDE.test(p) || /^\S*\*/.test(p) ? '' : p // its command's first word spelled out
  return OUTSIDE.test(p) || p.split('/').includes('..') ? '' : p.replace(/^\.\//, '')
}
// does this ask (a tab's, as the view has it) fall under a rule: its tool's, its command or path matched; never a
// question, a secret, a plan, a cut one, several questions, a menu that isn't yes … no, a risky or chained command, or
// anything outside the worktree (the deny list and those win over any rule). menu: false before its menu is drawn
export function allowRuleOf(rules: AllowRule[] | undefined, t: { status?: string; ask?: Ask; secret?: unknown; planAsk?: unknown }, menu = true) {
  const a = t.ask
  if (!rules?.length || !a?.what || !ruleable(t, menu)) return
  const w = a.what.trim()
  return rules.find(r => r.tool === a.tool && (p => !!p && (a.tool === 'Bash' ? (p.includes('*') ? globRe(p).test(w) : w === p || w.startsWith(`${p} `)) : globRe(p).test(w)))(rulePattern(r.tool, r.pattern)))
}
// an ask a rule could answer (allowRuleOf's, the talk key's spoken yes or no on its own: spokenMode)
function ruleable(t: { status?: string; ask?: Ask; secret?: unknown; planAsk?: unknown }, menu = true) {
  const a = t.ask
  if (t.status !== 'waiting' || t.secret || t.planAsk || !a?.tool || !a.what || a.what.endsWith('…') || a.steps || !RULE_TOOLS.includes(a.tool)) return false
  if (menu && !yesNo(a)) return false
  const w = a.what.trim()
  return !(risky(w) || OUTSIDE.test(w) || (a.tool === 'Bash' ? CHAIN.test(w) : w.split('/').includes('..')))
}
// the talk key's spoken yes or no (talk.ts spokenAnswer) for a waiting ask: auto, answered by itself in 1.5 s (what an
// auto-answer rule could take: a plain Allow … Deny permission); enter, only with ⏎ in the pill (a yes … no menu a rule
// wouldn't take: a chained command, a path outside the worktree, another tool); laki, a click in Laki's window (a
// question, a plan, a secret, several questions, a cut one, a risky command)
export function spokenMode(t: { status?: string; ask?: Ask; secret?: unknown; planAsk?: unknown }): 'auto' | 'enter' | 'laki' {
  const a = t.ask
  if (t.status !== 'waiting' || t.secret || t.planAsk || !a?.tool || !a.what?.trim() || a.what.endsWith('…') || a.steps) return 'laki'
  if (!yesNo(a) || risky(a.what)) return 'laki'
  return ruleable(t) ? 'auto' : 'enter'
}
// Allow / Deny the newest ask by a global hotkey (main's hotAnswer): only what an auto-answer rule could take, a plain
// yes … no permission; never a secret, a plan to approve, several questions, a question with other choices, a cut
// command, a risky one (deletes, force pushes), a chained one or a path outside the worktree, nor (hidden) a private
// workspace's in Recording mode. refuse: why, for its card ("Open Laki to answer this one")
export function hotkeyAnswer(t: { status?: string; ask?: Ask; secret?: unknown; planAsk?: unknown }, hidden = false): 'allow' | `refuse:${string}` {
  const a = t.ask
  if (hidden) return 'refuse:a private workspace in Recording mode'
  if (t.status !== 'waiting' || !a) return 'refuse:nothing waits'
  if (t.secret) return 'refuse:it asks for a secret'
  if (t.planAsk) return 'refuse:a plan to approve'
  if (a.steps) return 'refuse:several questions'
  if (!a.tool || !yesNo(a)) return 'refuse:a question'
  if (!a.what?.trim() || a.what.endsWith('…')) return "refuse:its command isn't all there"
  if (risky(a.what)) return 'refuse:a risky command'
  return ruleable(t) ? 'allow' : 'refuse:a chained command or a path outside the worktree'
}
// what Always allow in this project offers for an ask: its own command or path as the pattern, when one could be a rule
export const ruleFrom = (a?: Ask) => (a?.tool && a.what && !a.what.endsWith('…') ? rulePattern(a.tool, a.what) : '')

// ---------- F15: graduated autonomy. A project's Always ask for (project.alwaysAsk): path globs an ask that touches one
// (an Edit, Write or MultiEdit of a matching path, a Bash command naming one) is never auto-answered for, whatever its
// rules say, and its card says why. A glob with no / matches a name in any folder too (yarn.lock)
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/
export const ALWAYS_ASK_EG = ['**/migrations/**', '.github/**', '**/auth/**', '**/*secret*', '.env*', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Gemfile.lock'] // Settings' suggestions; none saved unless you add them
export function alwaysAskOf(globs: string[] | undefined, a: { tool?: string; what?: string }) {
  const w = a.what?.trim()
  if (!globs?.length || !w || !a.tool) return
  const paths = (a.tool === 'Bash' ? w.split(/[\s'"=:(),;&|<>`]+/) : EDITS.test(a.tool) ? [w] : []).filter(Boolean).map(p => p.replace(/^\.\//, ''))
  return globs.find(g => (re => paths.some(p => re.test(p) || (!g.includes('/') && re.test(p.split('/').pop()!))))(globRe(g.replace(/^\.\//, ''))))
}
// your Allows of one kind of ask in a row (the daemon's askStreak.ts) and the rule it would make: a Bash command's first
// words (npm test, git status), a file's folder (src/ui/**); none for what no rule may take (the risky or chained, a path
// outside the worktree, a file at the root: a rule of * is none) or what Always ask for holds
export const STREAK_AT = 5
// ponytail: the first word alone; a runner's two (uv run, bun run, time python) still make a rule of those two
const RUNS_CODE = /^(node|nodejs|deno|bun|bunx|npx|pnpx|python[\d.]*|pip[\d.]*|uv|uvx|ruby|perl|php|lua|osascript|swift|java|bash|sh|zsh|fish|dash|ksh|env|xargs|eval|exec|nohup|time|watch|timeout|nice|caffeinate)$/
export function streakOf(a: { tool?: string; what?: string }, globs?: string[]): { key: string; tool: string; pattern: string } | undefined {
  const w = a.what?.trim()
  if (!a.tool || !w || w.endsWith('…') || !RULE_TOOLS.includes(a.tool) || risky(w) || OUTSIDE.test(w) || alwaysAskOf(globs, a)) return
  let pattern = ''
  if (a.tool === 'Bash') {
    if (CHAIN.test(w)) return
    const words = w.split(' ')
    const n = words[1] && /^[a-z][\w:.-]*$/i.test(words[1]) ? 2 : 1
    if (n === 1 && words.length > 1 && RUNS_CODE.test(words[0])) return // node -e …, bash -c …: a rule of node alone would allow any code
    pattern = words.slice(0, n).join(' ')
  } else {
    if (w.split('/').includes('..') || !w.includes('/')) return
    pattern = `${w.slice(0, w.lastIndexOf('/'))}/**`
  }
  const p = rulePattern(a.tool, pattern)
  return p ? { key: `${a.tool} ${p}`, tool: a.tool, pattern: p } : undefined
}

// Needs you's groups: waiting asks of one project that are one ask (streakOf's kind, the same words and the same
// choices), several agents asking the same thing, as one card (Needs.tsx). Never a risky or chained command, a path out
// of the worktree (streakOf has none for those), a question (no tool), one of several (steps), a plan, a secret ask;
// choices: the menu's minus any that grants a standing rule (don't ask again: one click never makes that for n tabs).
// Two or more in a group, in the order the first came. Pure: test/ask.test.ts
// ponytail: the same words too, not only streakOf's kind: one card for npm test and npm test --watch would hide what differs
export function groupAsks<T>(cards: readonly T[], of: (c: T) => { project: string; t: { status?: string; ask?: Ask; secret?: unknown; planAsk?: unknown } }) {
  const m = new Map<string, { key: string; items: T[]; choices: Ask['options'] }>()
  for (const c of cards) {
    const { project, t } = of(c)
    const a = t.ask
    if (t.status !== 'waiting' || t.secret || t.planAsk || !a?.tool || a.steps || !a.options.length) continue
    const s = streakOf(a)
    if (!s) continue
    const choices = a.options.filter(o => !standing(o.label))
    if (!choices.length) continue
    const key = [project, s.key, a.what, ...a.options.map(o => `${o.n} ${o.label}`)].join('\0')
    const g = m.get(key) ?? (m.set(key, { key, items: [], choices }), m.get(key)!)
    g.items.push(c)
  }
  return [...m.values()].filter(g => g.items.length > 1)
}
