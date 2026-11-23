// `laki mcp`: Laki as an MCP server over stdio (JSON-RPC 2.0, a message per line), for Claude Code, Codex or
// any MCP client. Its tools go through the daemon's API like the CLI's commands; none deletes, archives or ships.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { alive, asClient, ensureDaemon, rpcAny as conn } from '../shared/conn.ts' // T14: tools call by name
import { aiRpc, extCall, GROUPS, obj, skillTools, str, toolGroup, type Tool, tools } from '../shared/tools.ts'
import { AGENT_VARS, API, type Template, templated, templatesFor, type View } from '../shared/types.ts'
import { stamp } from '../shared/when.ts'
import type { TabPlan } from '../shared/todos.ts'

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
// T1: a trusted client's laki mcp (conn.ts' asClient: its token outside a tab): only the tools its scopes allow, listed
// and run; the rest refused here by name, as the daemon refuses their calls (main.ts' clientNo). Its scopes asked once
// (clientWho; a restart sees new ones), else create and send. No extension tools
const CLIENT_TOOLS: Record<string, string> = { laki_state: 'read', laki_screen: 'read', laki_wait: 'read', laki_diff: 'read', laki_new_workspace: 'create', laki_new_tab: 'create', laki_send: 'send', laki_ask_agent: 'send' }
const client = !!asClient()
let scopes: Promise<string[]> | undefined
const clientScopes = () => (scopes ??= alive().then(up => (up ? conn<{ scopes: string[] } | null>('clientWho') : null)).then(c => c?.scopes ?? ['create', 'send'], () => ['create', 'send']))
const clientMay = async (name: string) => {
  const need = CLIENT_TOOLS[name]
  return need === 'read' || (!!need && (await clientScopes()).includes(need))
}
const listed = async () => (client ? (await Promise.all(TOOLS.map(async t => ((await clientMay(t.name)) ? [t] : [])))).flat() : all ? TOOLS : [...TOOLS.filter(t => opened.has(toolGroup(t.name) ?? 'core')), more])

async function call(name: string, args: unknown) {
  if (client && !(await clientMay(name))) throw new Error(`${name} isn't one of this client's tools: its scopes don't allow it (laki client ls, then laki client rotate <name> --scopes …)`)
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

// ---------- resources and prompts. Resources: a workspace's diff and live plan, a project's memory, read through the
// same daemon methods as laki_diff, laki_state and laki_memory (every gate as the tools have it: Recording mode, a trusted
// client's projects); listed for the caller's own workspace in a Laki tab, every live one for your own client (no tab).
// Prompts: the user's prompt templates (Settings' and the caller's project's), each {{variable}} an argument, filled as the
// new-workspace page fills them (templated); read-only. No subscriptions
const DIFF_MAX = 200 * 1024
const live = () => !process.env.LAKI_PERM_EXT && alive()
const viewOf = () => own<View>('state')
const RES = /^laki:\/\/(ws|project)\/([\w.-]+)\/(diff|plan|memory)$/
const toolRun = (name: string, a: Record<string, unknown>) => {
  const t = TOOLS.find(x => x.name === name)
  if (!t) throw new Error(`no ${name} here`)
  return t.run(a)
}
// a workspace's tabs' plans (the agents' to-do lists, shared/todos.ts) as a Markdown checklist, a tab's under its name
export function planMd(tabs: { name: string; plan?: TabPlan }[]) {
  const withPlan = tabs.filter(t => t.plan?.items.length)
  if (!withPlan.length) return 'No plan yet: its agents keep none right now.'
  return withPlan.map(t => [`## ${t.name}`, ...t.plan!.items.map(i => `- [${i.state === 'done' ? 'x' : ' '}] ${i.state === 'now' ? `**${i.text}** (now)` : i.text}`)].join('\n')).join('\n\n')
}
// a template's arguments: prompt (what you'd type), then each {{name}} in it but a date ({{YYYY-MM-DD}}: stamped)
export function promptArgs(t: Template) {
  const names = [...new Set([...t.text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]))].filter(k => k !== 'prompt' && stamp(`{{${k}}}`, 0) === `{{${k}}}`)
  const said = new Map(AGENT_VARS.map(([k, w]) => [k.slice(2, -2), w]))
  return [{ name: 'prompt', description: 'what you would type in the box: the task', required: false }, ...names.map(name => ({ name, description: said.get(name) ?? `{{${name}}} in the template`, required: false }))]
}
async function templates() {
  const v = await viewOf()
  const proj = v.projects.find(p => p.id === v.workspaces.find(w => w.id === process.env.LAKI_WORKSPACE)?.project)
  return templatesFor(v.settings?.templates ?? [], proj?.config?.templates ?? [], proj?.repoTemplates ?? []).filter(t => t.name?.trim() && typeof t.text === 'string')
}
async function resources() {
  if (!(await live())) return []
  const v = await viewOf()
  const me = process.env.LAKI_WORKSPACE
  const list = v.workspaces.filter(w => !w.archived && (me ? w.id === me : true))
  const projects = [...new Set(list.map(w => w.project))]
  return [
    ...list.flatMap(w => [
      { uri: `laki://ws/${w.id}/diff`, name: `${w.name ?? w.id}: diff`, description: `Workspace ${w.id}'s changes against its base branch (unified diff, cut at 200 KB)`, mimeType: 'text/x-diff' },
      { uri: `laki://ws/${w.id}/plan`, name: `${w.name ?? w.id}: plan`, description: `What workspace ${w.id}'s agents plan to do, live: their to-do lists as a checklist`, mimeType: 'text/markdown' },
    ]),
    ...projects.map(id => ({ uri: `laki://project/${id}/memory`, name: `${v.projects.find(p => p.id === id)?.name ?? id}: memory`, description: `Project ${id}'s memory: the user's items and what agents learned`, mimeType: 'text/markdown' })),
  ]
}
async function readResource(uri: unknown) {
  const m = RES.exec(String(uri ?? ''))
  if (!m || (m[1] === 'ws') !== (m[3] !== 'memory')) throw new Error(`no resource ${String(uri)}: laki://ws/<id>/diff, laki://ws/<id>/plan, laki://project/<id>/memory`)
  if (client && !(await clientMay('laki_diff'))) throw new Error('not one of this client\'s reads')
  await (daemon ??= ensureDaemon().catch(e => ((daemon = undefined), Promise.reject(e))))
  const [, , id, what] = m
  let text: string
  if (what === 'diff') {
    const d = String(await toolRun('laki_diff', { ws: id }))
    const bytes = Buffer.byteLength(d)
    text = bytes > DIFF_MAX ? `${Buffer.from(d).subarray(0, DIFF_MAX).toString('utf8').replace(/\uFFFD$/, '')}\n… cut at 200 KB of ${Math.round(bytes / 1024)} KB: laki diff ${id} has all of it` : d
  } else if (what === 'plan') {
    const v = await viewOf()
    if (!v.workspaces.some(w => w.id === id)) throw new Error(`no workspace ${id}`)
    text = planMd(v.tabs.filter(t => t.workspace === id))
  } else {
    const r = (await toolRun('laki_memory', { project: id })) as { yours: { text: string; added: string }[]; learned: { text: string; added: string }[] }
    const items = (l: { text: string; added: string }[]) => (l.length ? l.map(x => `- ${x.text} (${x.added})`).join('\n') : '- none')
    text = `# Memory of ${id}\n\n## Yours (follow these)\n${items(r.yours)}\n\n## Learned by agents\n${items(r.learned)}`
  }
  return { contents: [{ uri: String(uri), mimeType: what === 'diff' ? 'text/x-diff' : 'text/markdown', text }] }
}

async function answer(m: any): Promise<object | undefined> {
  switch (m.method) {
    case 'initialize':
      return {
        protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18',
        capabilities: { tools: all || client ? {} : { listChanged: true }, ...(!process.env.LAKI_PERM_EXT && { resources: {}, prompts: {} }) },
        serverInfo: { name: 'laki', version: `api ${API}` },
        instructions: 'Laki runs coding agents side by side, each task in its own git worktree. Ask the user before scheduling tasks.',
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: [...(await listed()).map(({ run, max, ...t }) => t), ...[...extNames(client ? [] : await extTools())].map(([name, t]) => ({ name, description: `${t.name}: ${t.description}${t.agents ? `\n\n${t.agents}` : ''}`, inputSchema: t.input }))] }
    case 'resources/list':
      return { resources: await resources() }
    case 'resources/templates/list':
      return {
        resourceTemplates: process.env.LAKI_PERM_EXT
          ? []
          : [
              { uriTemplate: 'laki://ws/{id}/diff', name: "a workspace's diff", description: 'Its changes against its base branch, cut at 200 KB', mimeType: 'text/x-diff' },
              { uriTemplate: 'laki://ws/{id}/plan', name: "a workspace's plan", description: "Its agents' to-do lists, live", mimeType: 'text/markdown' },
              { uriTemplate: 'laki://project/{id}/memory', name: "a project's memory", description: "The user's items and what agents learned", mimeType: 'text/markdown' },
            ],
      }
    case 'resources/read':
      return readResource(m.params?.uri)
    case 'prompts/list':
      return { prompts: (await live()) ? (await templates()).map(t => ({ name: t.name.trim(), description: `Prompt template: ${t.text.split('\n')[0].slice(0, 120)}`, arguments: promptArgs(t) })) : [] }
    case 'prompts/get': {
      await (daemon ??= ensureDaemon().catch(e => ((daemon = undefined), Promise.reject(e))))
      const t = (await templates()).find(x => x.name.trim() === String(m.params?.name ?? '').trim())
      if (!t) throw new Error(`no prompt template ${String(m.params?.name ?? '')}`)
      const args = (m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}) as Record<string, unknown>
      const vars = Object.fromEntries(Object.entries(args).filter(([k, v]) => k !== 'prompt' && typeof v === 'string')) as Record<string, string>
      return { description: t.name.trim(), messages: [{ role: 'user', content: { type: 'text', text: templated(t, typeof args.prompt === 'string' ? args.prompt : '', vars) } }] }
    }
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
