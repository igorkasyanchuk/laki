// `laki mcp`: Laki as an MCP server over stdio (JSON-RPC 2.0, a message per line), for Claude Code, Codex or
// any MCP client. Its tools go through the daemon's API like the CLI's commands; none deletes, archives or ships.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { alive, ensureDaemon, rpc as conn } from '../shared/conn.ts'
import { aiRpc, extCall, GROUPS, obj, skillTools, str, toolGroup, type Tool, tools } from '../shared/tools.ts'
import { API } from '../shared/types.ts'

// MCP's ext_<id>_<action>: each tool as one of its own, while a daemon runs (tools/list never starts one: stdout is the
// protocol's)
type ExtTool = { tool: string; id: string; action: string; name: string; description: string; input: object; agents?: string }
// each one's name: ext_<id>_<action>, made safe; one cut at 64 or the same as another's ends in 6 hex of its id.action.
// ponytail: no listChanged: a name a new extension makes collide changes at the client's next tools/list
export function extNames<T extends { id: string; action: string }>(ts: T[]): Map<string, T> {
  const base = (t: T) => `ext_${t.id}_${t.action}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  const n = new Map<string, number>()
  for (const t of ts) n.set(base(t), (n.get(base(t)) ?? 0) + 1)
  return new Map(ts.map(t => [base(t).length > 64 || n.get(base(t))! > 1 ? `${base(t).slice(0, 57)}_${createHash('sha256').update(`${t.id}.${t.action}`).digest('hex').slice(0, 6)}` : base(t), t]))
}
const extTools = async (): Promise<ExtTool[]> => (!process.env.LAKI_PERM_EXT && (await alive()) ? conn<ExtTool[]>('widgetTools', { ws: process.env.LAKI_WORKSPACE }).catch(() => []) : []) // an extension's permission server: none

// S13: Laki AI's codex gives a tab's token as a 0600 file's path (its -c flags show in ps); unreadable, none of yours either
if (process.env.LAKI_TAB_TOKEN_FILE && !process.env.LAKI_TAB_TOKEN) {
  try {
    process.env.LAKI_TAB_TOKEN = readFileSync(process.env.LAKI_TAB_TOKEN_FILE, 'utf8').trim()
  } catch {
    process.stderr.write("laki mcp: the agent's token file is gone\n")
    process.exit(1)
  }
}
let daemon: Promise<unknown> | undefined
const own = process.env.LAKI_AI === '1' ? aiRpc(conn, process.env.LAKI_AI_CHAT) : conn // Laki AI's claude or codex runs this laki mcp, for that chat
// Laki AI's claude -p (LAKI_AI_PERM) asks through it (--permission-prompt-tool) before a tool it may not use unasked: the user's pick in
// the chat, as claude wants it back. An extension's (LAKI_PERM_EXT, its id): the app's dialog, and only this tool here
const permission: Tool = {
  name: 'laki_permission',
  description: "Laki's own: Claude Code asks the user through it before a tool it may not use unasked. Never call it yourself.",
  inputSchema: obj({ tool_name: str('the tool'), input: { type: 'object', description: 'its input' } }, ['tool_name']),
  run: async a => {
    const r: { allow: boolean; message?: string } = await own('aiPermission', { tool: a.tool_name, input: a.input, ext: process.env.LAKI_PERM_EXT || undefined }, 300000)
    return JSON.stringify(r.allow ? { behavior: 'allow', updatedInput: a.input ?? {} } : { behavior: 'deny', message: r.message ?? 'The user said no.' })
  },
}
const TOOLS = process.env.LAKI_PERM_EXT ? [permission] : [...tools(own, process.env.LAKI_WORKSPACE || undefined, process.env.LAKI_AI === '1' ? 'Laki AI' : undefined), ...(process.env.LAKI_AI_SKILL === '1' ? skillTools(own) : []), ...(process.env.LAKI_AI_PERM === '1' ? [permission] : [])]
// what tools/list shows: every tool with --all, LAKI_MCP_ALL=1, Laki AI's backends and an extension's permission server;
// else the core group and laki_more, which adds a group for this connection (tools/list_changed). Any tool still runs by
// its name, listed or not: a client that never lists again
let all = process.env.LAKI_MCP_ALL === '1' || process.env.LAKI_AI === '1' || !!process.env.LAKI_PERM_EXT
const opened = new Set(['core'])
let changed = () => {}
const more: Tool = {
  name: 'laki_more',
  description: `More of Laki's tools, a group at a time: call it before a laki_* tool you don't have yet, and that group's tools are listed from then on. Groups:\n${Object.entries(GROUPS)
    .filter(([g]) => g !== 'core')
    .map(([g, x]) => `- ${g}: ${x.words}`)
    .join('\n')}`,
  inputSchema: obj({ group: { type: 'string', enum: Object.keys(GROUPS).filter(g => g !== 'core'), description: 'the group' } }, ['group']),
  run: async a => {
    const g = GROUPS[a.group as string]
    if (!g || a.group === 'core') throw new Error(`no group ${a.group}: ${Object.keys(GROUPS).join(', ')}`)
    const was = opened.size
    opened.add(a.group)
    if (opened.size > was) changed()
    return `${a.group}: ${TOOLS.filter(t => toolGroup(t.name) === a.group).map(t => t.name).join(', ') || 'none here'}`
  },
}
const listed = () => (all ? TOOLS : [...TOOLS.filter(t => opened.has(toolGroup(t.name) ?? 'core')), more])

async function call(name: string, args: unknown) {
  if (name === 'laki_more' && !all) return String(await more.run(args ?? {})) // no daemon; its group's open before the next line is read
  const tool = TOOLS.find(t => t.name === name)
  if (!tool && name.startsWith('ext_')) {
    const t = extNames(await extTools()).get(name)
    if (!t) throw new Error(`no tool ${name}: its extension is off, or Laki isn't running`)
    return extCall(own, t.tool, args ?? {}, process.env.LAKI_WORKSPACE || undefined, process.env.LAKI_AI === '1' ? 'Laki AI' : undefined)
  }
  if (!tool) throw new Error(`no tool ${name}`)
  await (daemon ??= ensureDaemon().catch(e => ((daemon = undefined), Promise.reject(e))))
  const r = await tool.run(args ?? {})
  return typeof r === 'string' ? r : JSON.stringify(r, null, 2)
}

async function answer(m: any): Promise<object | undefined> {
  switch (m.method) {
    case 'initialize':
      return {
        protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18',
        capabilities: { tools: all ? {} : { listChanged: true } },
        serverInfo: { name: 'laki', version: `api ${API}` },
        instructions: 'Laki runs coding agents side by side, each task in its own git worktree. Ask the user before scheduling tasks.',
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: [...listed().map(({ run, max, ...t }) => t), ...[...extNames(await extTools())].map(([name, t]) => ({ name, description: `${t.name}: ${t.description}${t.agents ? `\n\n${t.agents}` : ''}`, inputSchema: t.input }))] }
    case 'tools/call':
      try {
        return { content: [{ type: 'text', text: await call(m.params?.name, m.params?.arguments) }] }
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true }
      }
  }
}

export function mcp(every = false) {
  all ||= every
  const send = (o: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n')
  changed = () => send({ method: 'notifications/tools/list_changed' })
  const busy = new Set<Promise<unknown>>()
  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => {
    if (!line.trim()) return
    let m: any
    try {
      m = JSON.parse(line)
    } catch {
      return send({ id: null, error: { code: -32700, message: 'parse error' } })
    }
    if (m.id === undefined || m.id === null) return // a notification (initialized, cancelled): nothing to say
    const p = answer(m).then(
      result => send(result ? { id: m.id, result } : { id: m.id, error: { code: -32601, message: `no method ${m.method}` } }),
      e => send({ id: m.id, error: { code: -32603, message: String(e?.message ?? e) } }),
    )
    busy.add(p)
    p.finally(() => busy.delete(p))
  })
  lines.on('close', () => Promise.all(busy).then(() => process.stdout.write('', () => process.exit(0)))) // the client hung up: answer what it asked, flushed
}
