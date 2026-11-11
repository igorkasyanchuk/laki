// F6: what an agent sees in a project, read only: the rule files it loads (in load order, with their sizes; Claude
// Code's CLAUDE.md files and their @imports, Codex's AGENTS.md files), Laki's own memory it gets, and the MCP servers
// its own config files give it (env values and tokens masked). Nothing here writes: a change goes through the agent's
// own CLI, typed in a terminal for the user to run (the page's Add a server… and Remove…). Never ~/.claude or ~/.codex
// written (AGENTS.md)
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { type AgentContext, type AgentRule, type AgentServer, HOME_ACCOUNT, type Memory } from '../shared/types.ts'
import { findProject, memoryNote, openPath, state } from './core.ts'
import { accountNamed, accountUsed, homeDir } from './accounts.ts'
import { redact } from './share.ts'

const MAX_READ = 1 << 20 // a rule file read for its @imports: its first MB
const tilde = (p: string) => (p === homedir() || p.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p)
const sizeOf = (p: string) => {
  try {
    const st = statSync(p)
    return st.isFile() ? st.size : undefined
  } catch {
    return undefined
  }
}
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
// the agent's own folder as new sessions use it: the default account's (Settings › Agents & profiles), else its own
const configDir = (agent: 'claude' | 'codex') => (id => (id !== HOME_ACCOUNT && accountNamed(id)?.dir) || homeDir(agent))(accountUsed(agent))
// a folder and its parents to the top, the top first; none above the root (/ itself never)
const chain = (from: string) => {
  const out: string[] = []
  for (let d = resolve(from); dirname(d) !== d; d = dirname(d)) out.unshift(d)
  return out
}

// Claude Code's @path imports (outside code spans and fences), each file once, 5 deep as Claude Code reads them
function withImports(out: AgentRule[], p: string, scope: AgentRule['scope'], from?: string, depth = 0) {
  const size = sizeOf(p)
  if (size === undefined || out.some(r => real(r.path) === real(p))) return // once, by where it really is (~/.claude/CLAUDE.md is a project's parent's too)
  out.push({ path: p, at: tilde(p), scope, size, ...(from && { from: tilde(from) }) })
  if (depth >= 5) return
  let text = ''
  try {
    text = readFileSync(p, 'utf8').slice(0, MAX_READ).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  } catch {
    return
  }
  for (const m of text.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w.\-/]+)/g)) {
    const ref = m[1]
    if (!/[/.]/.test(ref)) continue // @someone, not a file
    const to = ref.startsWith('~/') ? join(homedir(), ref.slice(2)) : isAbsolute(ref) ? ref : resolve(dirname(p), ref)
    withImports(out, to, scope, p, depth + 1)
  }
}
const mdIn = (d: string) => {
  try {
    return readdirSync(d).filter(f => f.endsWith('.md')).sort().map(f => join(d, f))
  } catch {
    return []
  }
}
function claudeRules(path?: string): AgentRule[] {
  const out: AgentRule[] = []
  const managed = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/CLAUDE.md' : '/etc/claude-code/CLAUDE.md'
  withImports(out, managed, 'managed')
  const cfg = configDir('claude')
  withImports(out, join(cfg, 'CLAUDE.md'), 'user')
  for (const f of mdIn(join(cfg, 'rules'))) withImports(out, f, 'user')
  if (path)
    for (const d of chain(path)) {
      for (const f of [join(d, 'CLAUDE.md'), join(d, '.claude', 'CLAUDE.md')]) withImports(out, f, 'project')
      if (d === resolve(path)) for (const f of mdIn(join(d, '.claude', 'rules'))) withImports(out, f, 'project')
      withImports(out, join(d, 'CLAUDE.local.md'), 'local')
    }
  return out
}
// Codex: its folder's AGENTS.override.md or AGENTS.md, then one per folder from the repo's root down to where it runs
function codexRules(path?: string): AgentRule[] {
  const one = (d: string, scope: AgentRule['scope']): AgentRule[] => {
    for (const n of ['AGENTS.override.md', 'AGENTS.md']) {
      const p = join(d, n)
      const size = sizeOf(p)
      if (size !== undefined) return [{ path: p, at: tilde(p), scope, size }]
    }
    return []
  }
  const out = one(configDir('codex'), 'user')
  if (!path) return out
  const dirs = chain(path)
  const root = dirs.findLastIndex(d => existsSync(join(d, '.git')))
  return [...out, ...dirs.slice(root >= 0 ? root : dirs.length - 1).flatMap(d => one(d, 'project'))]
}

// env values and headers as their names only; a token-shaped string, a URL's password or a value after a --token,
// --api-key… masked (share.ts' redact)
const MASK = '••••'
const SECRET_FLAG = /^--?[\w-]*(?:token|key|secret|password|auth)[\w-]*$/i
// NAME=value (-e API_TOKEN=…, docker's and env's) and --api-key=… by a secret's name; the rest by share.ts' shapes
const SECRET_SET = /^(--?)?([\w.-]*(?:token|key|secret|pass|auth|cred)[\w.-]*)=/i
const maskArgs = (args: unknown) =>
  Array.isArray(args) ? args.map(String).map((a, i, all) => (i && SECRET_FLAG.test(all[i - 1]) ? MASK : SECRET_SET.test(a) ? `${a.split('=')[0]}=${MASK}` : redact(a))) : undefined
// a URL's password, and a query value by a secret's name (?api_key=…, &sig=…)
const maskUrl = (u: string) => redact(u).replace(/(\/\/)[^/@\s]+@/, `$1${MASK}@`).replace(/([?&][^=&#]*(?:token|key|secret|pass|auth|sig|cred)[^=&#]*=)[^&#]+/gi, `$1${MASK}`)
const names = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : undefined)
function server(name: string, c: Record<string, unknown>, scope: AgentServer['scope'], file: string): AgentServer {
  const url = typeof c.url === 'string' ? maskUrl(c.url) : undefined
  const env = names(c.env)
  const headers = names(c.headers ?? c.http_headers)
  return {
    name,
    scope,
    file: tilde(file),
    transport: typeof c.type === 'string' ? c.type : url ? 'http' : 'stdio',
    ...(typeof c.command === 'string' && { command: redact(c.command) }),
    ...((a => a?.length && { args: a })(maskArgs(c.args))),
    ...(url && { url }),
    ...(env?.length && { env }),
    ...(headers?.length && { headers }),
    ...(c.enabled === false || c.disabled === true ? { off: true } : {}),
  }
}
const servers = (o: unknown, scope: AgentServer['scope'], file: string): AgentServer[] =>
  o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o as Record<string, unknown>).filter(([, c]) => c && typeof c === 'object').map(([n, c]) => server(n, c as Record<string, unknown>, scope, file)) : []
const json = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined // missing or broken: none from it (read only: never set aside, it's the agent's)
  }
}
// Claude Code's: ~/.claude.json's (its CLAUDE_CONFIG_DIR's .claude.json for an account) user servers and this
// project's local ones, the project's .mcp.json. ponytail: plugins' and managed-mcp.json's servers aren't listed
function claudeServers(path?: string): AgentServer[] {
  const cfg = configDir('claude')
  const file = cfg === join(homedir(), '.claude') && !process.env.CLAUDE_CONFIG_DIR ? join(homedir(), '.claude.json') : join(cfg, '.claude.json')
  const j = json(file)
  const local = path ? [resolve(path), real(path)].map(p => j?.projects?.[p]?.mcpServers).find(Boolean) : undefined
  return [...servers(local, 'local', file), ...(path ? servers(json(join(path, '.mcp.json'))?.mcpServers, 'project', join(path, '.mcp.json')) : []), ...servers(j?.mcpServers, 'user', file)]
}
// Codex's: config.toml's [mcp_servers.<name>] tables, its folder's and a project's .codex/config.toml
function codexServers(path?: string): AgentServer[] {
  const files: [string, AgentServer['scope']][] = [[join(configDir('codex'), 'config.toml'), 'user'], ...(path ? [[join(path, '.codex', 'config.toml'), 'project'] as [string, AgentServer['scope']]] : [])]
  return files.flatMap(([f, scope]) => {
    let text = ''
    try {
      text = readFileSync(f, 'utf8')
    } catch {
      return []
    }
    return servers(tomlServers(text), scope, f)
  })
}
// the [mcp_servers.<name>] and [mcp_servers.<name>.env] tables of a config.toml: key = a string, a number, a boolean, an
// array or an inline table (one over several lines too). ponytail: a TOML subset, enough for MCP servers; dotted keys
// in a table are skipped
export function tomlServers(text: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  let cur: Record<string, unknown> | undefined
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l || l.startsWith('#')) continue
    const h = /^\[\s*mcp_servers\.(?:"([^"]+)"|([\w-]+))(\.env)?\s*\]\s*(?:#.*)?$/.exec(l)
    if (h) {
      const s = (out[h[1] ?? h[2]] ??= {})
      cur = h[3] ? ((s.env ??= {}) as Record<string, unknown>) : s
      continue
    }
    if (l.startsWith('[')) {
      cur = undefined
      continue
    }
    const kv = /^(?:"([^"]+)"|([\w-]+))\s*=\s*(.*)$/.exec(l)
    if (!cur || !kv) continue
    let v = kv[3]
    while (/^[[{]/.test(v) && !balanced(v) && i + 1 < lines.length) v += `\n${lines[++i]}`
    cur[kv[1] ?? kv[2]] = tomlValue(v)
  }
  return out
}
const balanced = (v: string) => {
  let n = 0
  let q = ''
  for (const ch of v) {
    if (q) q = ch === q ? '' : q
    else if (ch === '"' || ch === "'") q = ch
    else if (ch === '[' || ch === '{') n++
    else if (ch === ']' || ch === '}') n--
  }
  return n <= 0
}
function tomlValue(v: string): unknown {
  const s = v.replace(/("(?:[^"\\]|\\.)*"|'[^']*')|#[^\n]*/g, (m, str) => str ?? '').trim() // comments out, strings kept
  try {
    return JSON.parse(s.replace(/'([^']*)'/g, (_, x) => JSON.stringify(x)).replace(/([{,]\s*)(?:"([^"]+)"|([\w-]+))\s*=/g, (_, pre, a, b) => `${pre}${JSON.stringify(a ?? b)}:`).replace(/,(\s*[\]}])/g, '$1'))
  } catch {
    return s
  }
}

export function agentContext(p: { agent?: string; project?: string }): AgentContext {
  const agent = p.agent
  if (agent !== 'claude' && agent !== 'codex') throw new Error('agent: claude or codex')
  const proj = p.project ? findProject(p.project) : undefined
  if (proj?.host) throw new Error(`${proj.name} is on ${proj.host}: what an agent sees there is read there`)
  const path = proj && !proj.kind ? proj.path : undefined // a project's folder (Terminals' and Browsers' are none)
  const mem = (l: Memory[] | undefined, auto: boolean) => (Array.isArray(l) ? l.filter(m => m && typeof m.text === 'string' && !!m.auto === auto).length : 0)
  const note = memoryNote(proj)
  return {
    agent,
    ...(proj && { project: proj.id, path: tilde(proj.path) }),
    rules: agent === 'claude' ? claudeRules(path) : codexRules(path),
    memory: { global: mem(state.settings?.memory, false), mine: mem(proj?.memory, false), learned: mem(proj?.memory, true), bytes: Buffer.byteLength(note) },
    servers: agent === 'claude' ? claudeServers(path) : codexServers(path),
  }
}

// Open file: one of the rule files agentContext lists for it (no other path), in the user's editor
export async function agentContextOpen(p: { agent?: string; project?: string; path?: string }) {
  const c = agentContext(p)
  const r = c.rules.find(x => x.path === p.path)
  if (!r) throw new Error('not one of its rule files')
  await openPath(r.path, 'editor', c.project)
}
