// MCP servers for every project (#6: Settings › Agents & profiles › MCP servers, settings.mcp) and a project's own
// (Settings › the project › MCP servers), the project's adding to them (the same name: the project's): the user's alone
// (main.ts refuses them to agents and remote access's page); passed to an agent tab as it starts, never written into
// the agent's own config. claude: a 0600 file of { mcpServers } for one more --mcp-config (core.ts mcpFile); codex: -c
// mcp_servers.<name>.… overrides (codexMcpArgs, its TOML values quoted here); opencode: its inline config's mcp
// (OPENCODE_CONFIG_CONTENT, openCodeMcp); the others take none yet. Pure: test/units-more.test.ts
export type McpServer = { name: string; command?: string; args?: string[]; url?: string; env?: Record<string, string>; presets?: string[] }
export const MCP_NAME = /^[\w-]{1,40}$/
export const MCP_AGENTS = ['claude', 'codex', 'opencode'] // the ones that take them
// every project's, then the project's own: one of the same name is the project's
export const mcpAll = (all?: McpServer[], own?: McpServer[]) => [...(all ?? []).filter(s => !own?.some(o => o.name === s.name)), ...(own ?? [])]
// opencode's config's mcp: a local server's command and args as one list, its env as environment; a URL's remote
export const openCodeMcp = (list: McpServer[]) =>
  Object.fromEntries(list.map(s => [s.name, s.url ? { type: 'remote', url: s.url } : { type: 'local', command: [s.command ?? '', ...(s.args ?? [])], ...(s.env && Object.keys(s.env).length && { environment: s.env }) }]))
// #6's Import: a server as an agent's own config has it (claude's and Antigravity's mcpServers, codex's [mcp_servers],
// opencode's mcp), in Laki's shape; one Laki can't take (no command or URL, a name it refuses): none
export function mcpFrom(name: string, c: Record<string, unknown>): McpServer | undefined {
  if (!MCP_NAME.test(name)) return
  // what a server here can't carry: headers (a token), codex's bearer token and headers, an SSE transport (claude gets
  // http): not offered, rather than a copy that fails
  if (c.headers || c.http_headers || c.env_http_headers || c.bearer_token_env_var || c.type === 'sse' || c.transport === 'sse') return
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const words = (v: unknown) => (Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : [])
  const vars = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')) : {})
  const url = str(c.url) || str(c.httpUrl) || str(c.serverUrl)
  const cmd = Array.isArray(c.command) ? words(c.command) : [str(c.command), ...words(c.args)].filter((x, i) => i || x)
  const env = vars(c.env ?? c.environment)
  if (url && /^https?:\/\//i.test(url)) return { name, url }
  if (!cmd[0]) return
  return { name, command: cmd[0], ...(cmd.length > 1 && { args: cmd.slice(1) }), ...(Object.keys(env).length && { env }) }
}

// a server is on for a profile when it names none, or names it
export const mcpFor = (list: McpServer[] | undefined, preset: string) => (list ?? []).filter(s => !s.presets?.length || s.presets.includes(preset))

// a TOML basic string: JSON's escapes are TOML's but for \u above U+FFFF and the controls JSON leaves (U+007F), so
// those go as \u or \U escapes too
export function tomlString(s: string): string {
  return `"${[...s].map(c => {
    const n = c.codePointAt(0)!
    if (c === '"') return '\\"'
    if (c === '\\') return '\\\\'
    if (c === '\n') return '\\n'
    if (c === '\t') return '\\t'
    if (c === '\r') return '\\r'
    if (n < 0x20 || n === 0x7f) return `\\u${n.toString(16).padStart(4, '0')}`
    return c
  }).join('')}"`
}
// a bare TOML key when it's one, else a quoted one
const tomlKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k))

// codex's -c overrides: each a key=value its config parser takes as TOML (a URL server: url). An env's values never go
// on argv (ps shows any process's to every account): they go in codex's own environment as LAKI_MCP_<i>_<NAME> (env,
// for the caller to set; the server's index: two servers' same name never collide), the server gets them by
// env_vars (codex 0.171's: names forwarded from its environment, not renamed), and a launcher, /bin/sh -c with names
// only, exports each under its own name and execs the server
export function codexMcpArgs(list: McpServer[]): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {}
  const args = list.flatMap((s, i) => {
    const k = `mcp_servers.${tomlKey(s.name)}`
    if (s.url) return ['-c', `${k}.url=${tomlString(s.url)}`]
    const vars = Object.entries(s.env ?? {}).map(([n, v]) => ((env[`LAKI_MCP_${i}_${n}`] = v), [n, `LAKI_MCP_${i}_${n}`]))
    if (!vars.length) return ['-c', `${k}.command=${tomlString(s.command ?? '')}`, ...(s.args?.length ? ['-c', `${k}.args=[${s.args.map(tomlString).join(', ')}]`] : [])]
    const sh = `export ${vars.map(([n, l]) => `${n}="$${l}"`).join(' ')}; unset ${vars.map(([, l]) => l).join(' ')}; exec "$0" "$@"`
    return ['-c', `${k}.command="/bin/sh"`, '-c', `${k}.args=[${['-c', sh, s.command ?? '', ...(s.args ?? [])].map(tomlString).join(', ')}]`, '-c', `${k}.env_vars=[${vars.map(([, l]) => tomlString(l)).join(', ')}]`]
  })
  return { args, env }
}
// claude's --mcp-config file
export const claudeMcpConfig = (list: McpServer[]) => ({
  mcpServers: Object.fromEntries(list.map(s => [s.name, s.url ? { type: 'http', url: s.url } : { command: s.command, ...(s.args?.length && { args: s.args }), ...(s.env && Object.keys(s.env).length && { env: s.env }) }])),
})

// what projectSet keeps: up to 20, each a name (unique), a command or an https/http URL (not both), its args and env
// (names as env vars'); a value sent back masked is the one kept (the same name's). Anything else: refused whole
export function mcpOk(v: unknown, cur: McpServer[] | undefined, mask: string, envKey: RegExp): McpServer[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > 20) throw new Error('mcp: a list of up to 20 servers')
  const seen = new Set<string>()
  const out = v.map((it: unknown): McpServer => {
    const x = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
    const name = typeof x?.name === 'string' ? x.name.trim() : ''
    if (!MCP_NAME.test(name)) throw new Error(`mcp: ${name || 'a server'}: a name of letters, digits, _ and - (40 at most)`)
    if (seen.has(name)) throw new Error(`mcp: ${name} twice`)
    seen.add(name)
    const command = typeof x.command === 'string' ? x.command.trim() : ''
    const url = typeof x.url === 'string' ? x.url.trim() : ''
    if (!!command === !!url) throw new Error(`mcp: ${name}: a command or a URL`)
    if (command.length > 1000) throw new Error(`mcp: ${name}: its command is over 1000 characters`)
    if (url && (!/^https?:\/\//i.test(url) || !URL.canParse(url) || url.length > 2000)) throw new Error(`mcp: ${name}: its URL: http:// or https://`)
    const args = x.args === undefined ? [] : Array.isArray(x.args) && x.args.length <= 50 && x.args.every((a: unknown) => typeof a === 'string' && a.length <= 1000) ? (x.args as string[]) : null
    if (!args) throw new Error(`mcp: ${name}: args, a list of up to 50 words`)
    const was = cur?.find(s => s.name === name)?.env
    const env = x.env === undefined ? {} : x.env && typeof x.env === 'object' && !Array.isArray(x.env) ? (x.env as Record<string, unknown>) : null
    if (!env || Object.entries(env).some(([k, val]) => !envKey.test(k) || typeof val !== 'string' || val.length > 10000)) throw new Error(`mcp: ${name}: env, names as a variable's and text values`)
    const kept = Object.fromEntries(Object.entries(env as Record<string, string>).flatMap(([k, val]) => (val !== mask ? [[k, val]] : was?.[k] !== undefined ? [[k, was[k]]] : []))) // a mask with nothing behind it (a renamed server's): dropped
    const presets = x.presets === undefined ? [] : Array.isArray(x.presets) && x.presets.length <= 50 && x.presets.every((p: unknown) => typeof p === 'string' && p.length <= 64) ? (x.presets as string[]) : null
    if (!presets) throw new Error(`mcp: ${name}: presets, a list of profiles' ids`)
    return { name, ...(command ? { command } : { url }), ...(!url && args.length && { args }), ...(!url && Object.keys(kept).length && { env: kept }), ...(presets.length && { presets }) }
  })
  return out.length ? out : undefined
}
