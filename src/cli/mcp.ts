// `laki mcp`: Laki as an MCP server over stdio (JSON-RPC 2.0, a message per line), for Claude Code, Codex or
// any MCP client. Its tools go through the daemon's API like the CLI's commands; none deletes, archives or ships.
import { createInterface } from 'node:readline'
import { ensureDaemon, rpc } from '../shared/conn.ts'
import { API, type View } from '../shared/types.ts'

type Tool = { name: string; description: string; inputSchema: object; run: (a: any) => Promise<unknown> }
const str = (description: string) => ({ type: 'string', description })
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required })

// the view, without what an agent doesn't need (settings, scans' details)
async function state() {
  const v: View = await rpc('state')
  return {
    projects: v.projects.map(p => ({ id: p.id, name: p.name, path: p.path, git: p.git !== false })),
    workspaces: v.workspaces
      .filter(w => !w.archived)
      .map(w => ({ id: w.id, name: w.name, project: w.project, kind: w.kind, branch: w.branch, path: w.path, port: w.port, ports: w.ports, pr: w.pr && { number: w.pr.number, state: w.pr.state, url: w.pr.url } })),
    tabs: v.tabs.map(t => ({ id: t.id, workspace: t.workspace, name: t.name, kind: t.kind, agent: t.kind === 'agent' ? t.preset : undefined, status: t.status, done: t.done, queued: t.queue?.length || undefined, last: t.last?.slice(0, 500) })),
  }
}

const TOOLS: Tool[] = [
  {
    name: 'laki_state',
    description: "Laki's projects, workspaces (a git worktree per task, or a folder) and tabs, with each agent's status: running, waiting (for a permission), idle or exited; done: finished while nobody looked.",
    inputSchema: obj({}),
    run: state,
  },
  {
    name: 'laki_new_workspace',
    description: "Start a task: a new workspace in a project (a git worktree on a new branch, set up by the project's setup script, or the folder itself with local) with an agent working on the prompt.",
    inputSchema: obj(
      {
        project: str('a project id, from laki_state'),
        prompt: str('what the agent should do, as for a new colleague: the goal, where to look, how to tell it is done'),
        preset: str('claude (the default), codex, gemini, grok, opencode, a preset of theirs, shell or none'),
        name: str('a short name for the workspace and its branch'),
        base: str('the branch to start from (default: the repo’s current one)'),
        local: { type: 'boolean', description: 'work in the project’s own folder instead of a new worktree' },
        model: str("the agent's model (opus, sonnet, a full name; provider/model for opencode); default: the agent's own"),
        effort: str('how hard it thinks: claude low…max, codex minimal…xhigh; default: the agent’s own'),
        issue: str('a GitHub issue (its URL or number) to work on: its title and text become the prompt, with the prompt above after them'),
        pr: str("a GitHub PR (its URL or number) to work on: the workspace is a worktree on its branch (forks too), named after it"),
        presets: { type: 'array', items: { type: 'string' }, description: 'a race: 2–6 presets (claude, codex…) that each get a worktree on the same prompt, for the user to compare and keep one' },
      },
      ['project'],
    ),
    run: a => {
      const o = { project: a.project, prompt: a.prompt, preset: a.preset, name: a.name, base: a.base, local: !!a.local, model: a.model, effort: a.effort, issue: a.issue, pr: a.pr }
      if (!a.prompt && !a.issue && !a.pr) throw new Error('a prompt, an issue or a PR')
      return Array.isArray(a.presets) && a.presets.length ? rpc('wsFan', { ...o, presets: a.presets }, 120000 * a.presets.length) : rpc('wsNew', o, 120000)
    },
  },
  {
    name: 'laki_browser',
    description:
      "Drive a browser on the workspace's dev server (this Mac's localhost only; needs the Laki app open): open a URL or path (default: http://localhost:$PORT/), screenshot (a PNG's path, to read), click or fill an element by CSS selector, or read the page's text.",
    inputSchema: obj(
      {
        ws: str('a workspace id'),
        op: { type: 'string', enum: ['open', 'screenshot', 'click', 'fill', 'text'] },
        url: str('for open: a URL on localhost, or a path like /login'),
        selector: str('for click and fill: a CSS selector'),
        text: str('for fill: what to type'),
      },
      ['ws', 'op'],
    ),
    run: a => rpc('browse', { ws: a.ws, op: a.op, url: a.url, selector: a.selector, text: a.text }, 45000),
  },
  {
    name: 'laki_send',
    description: "Type a message into an agent's tab, as if the user typed it and pressed Enter. With when_idle it waits for the agent's turn to end.",
    inputSchema: obj({ target: str('a workspace id (its agent) or <ws>/<tab>'), text: str('the message'), when_idle: { type: 'boolean', description: 'queue it until the agent finishes its turn' } }, ['target', 'text']),
    run: a => rpc('send', { target: a.target, text: a.text, whenIdle: !!a.when_idle }),
  },
  {
    name: 'laki_screen',
    description: "The last lines of a tab's terminal: what the agent or command shows now.",
    inputSchema: obj({ target: str('a workspace id (its agent) or <ws>/<tab>'), lines: { type: 'number', description: 'how many lines (default 40)' } }, ['target']),
    run: a => rpc('screen', { target: a.target, lines: Number(a.lines) || 40 }),
  },
  {
    name: 'laki_diff',
    description: "A workspace's changes against its base branch, as a unified diff.",
    inputSchema: obj({ ws: str('a workspace id') }, ['ws']),
    run: async a => (await rpc('diff', { ws: a.ws })).diff || 'no changes',
  },
  {
    name: 'laki_schedules',
    description: 'The scheduled tasks (id, when, next run) and the last runs.',
    inputSchema: obj({}),
    run: async () => {
      const v: View = await rpc('state')
      return { schedules: v.schedules ?? [], runs: (v.runs ?? []).slice(0, 20) }
    },
  },
  {
    name: 'laki_schedule_add',
    description: 'Schedule a prompt for an agent, once or on repeat, at times written in English. Only when the user asks for one: it starts agents later, unattended.',
    inputSchema: obj(
      {
        project: str('a project id'),
        when: str('e.g. "weekdays at 9am", "every day at 2am except weekends", "every 2 hours from 9am to 6pm", "tomorrow at 7am"'),
        prompt: str('what the agent should do each run; {{DD-MM-YY}}-style dates become the run’s'),
        preset: str('claude (the default), codex, gemini, grok, opencode or a preset of theirs'),
        name: str('the task’s name, also each run’s workspace name; may hold {{DD-MM}}'),
        where: str('new (a new worktree each run), local (the project folder, one session), local-new (the folder, a new session each run) or a workspace id'),
      },
      ['project', 'when', 'prompt'],
    ),
    run: a => rpc('scheduleSet', { project: a.project, when: a.when, prompt: a.prompt, preset: a.preset, name: a.name, ws: a.where }),
  },
]

let daemon: Promise<unknown> | undefined
async function call(name: string, args: unknown) {
  const tool = TOOLS.find(t => t.name === name)
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
        capabilities: { tools: {} },
        serverInfo: { name: 'laki', version: `api ${API}` },
        instructions: 'Laki runs coding agents side by side, each task in its own git worktree. Ask the user before scheduling tasks.',
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS.map(({ run, ...t }) => t) }
    case 'tools/call':
      try {
        return { content: [{ type: 'text', text: await call(m.params?.name, m.params?.arguments) }] }
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true }
      }
  }
}

export function mcp() {
  const send = (o: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n')
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
