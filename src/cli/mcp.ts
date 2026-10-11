// `laki mcp`: Laki as an MCP server over stdio (JSON-RPC 2.0, a message per line), for Claude Code, Codex or
// any MCP client. Its tools go through the daemon's API like the CLI's commands; none deletes, archives or ships.
import { createInterface } from 'node:readline'
import { ensureDaemon, rpc as conn } from '../shared/conn.ts'
import { API, type View } from '../shared/types.ts'
import { widgetFormat } from '../shared/widgetGuide.ts'

export type Tool = { name: string; description: string; inputSchema: object; max?: number; run: (a: any) => Promise<unknown> } // max: what Laki AI's model may read of its result (TOOL_TEXT)
export type Rpc = <T = any>(method: string, params?: any, timeoutMs?: number) => Promise<T>
const str = (description: string) => ({ type: 'string', description })
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required })

// the view, without what an agent doesn't need (scans' details) or must not see: settings (env, presets' env and cmd,
// the webhook's URL), projects' config (env), queued prompts, remote access's link (its token). `laki ls --json` too
export async function state(rpc: Rpc = conn) {
  const v: View = await rpc('state')
  return {
    projects: v.projects.map(p => ({ id: p.id, name: p.name, path: p.path, host: p.host, git: p.git !== false, kind: p.kind })), // kind: shells (the Terminals project) or browsers, the user's own
    workspaces: v.workspaces
      .filter(w => !w.archived)
      .map(w => ({ id: w.id, name: w.name, project: w.project, kind: w.kind, branch: w.branch, path: w.path, host: w.host, port: w.port, ports: w.ports, pr: w.pr && { number: w.pr.number, state: w.pr.state, url: w.pr.url, title: w.pr.title } })),
    tabs: v.tabs.map(t => ({ id: t.id, workspace: t.workspace, name: t.name, kind: t.kind, agent: t.kind === 'agent' ? t.preset : undefined, status: t.status, code: t.code, done: t.done, queued: t.queue?.length || undefined, last: t.last?.slice(0, 500) })),
  }
}

export const tools = (rpc: Rpc): Tool[] => [
  {
    name: 'laki_state',
    description: "Laki's projects, workspaces (a git worktree per task, or a folder) and tabs, with each tab's status: running (an agent's turn, or a shell's command), waiting (for a permission), idle or exited; done: finished while nobody looked; last: the agent's last answer. Terminals and Browsers (a project's kind shells or browsers) are the user's own terminals and web pages.",
    inputSchema: obj({}),
    run: () => state(rpc),
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
    description: "Type a message into an agent's tab, as if the user typed it and pressed Enter. With when_idle it waits for the agent's turn to end. Agents only, and not while one asks the user something.",
    inputSchema: obj({ target: str('a workspace id (its agent) or <ws>/<tab>'), text: str('the message'), when_idle: { type: 'boolean', description: 'queue it until the agent finishes its turn' } }, ['target', 'text']),
    run: a => rpc('send', { target: a.target, text: a.text, whenIdle: !!a.when_idle, agent: true }),
  },
  {
    name: 'laki_new_tab',
    description: 'A new agent session (a tab) in a workspace that exists, in its folder, with a prompt: e.g. a codex review of what claude did there.',
    inputSchema: obj({ ws: str('a workspace id'), preset: str("claude, codex, gemini, grok, opencode or a preset of theirs (default: the user's default agent)"), prompt: str('what it should do'), model: str("the agent's model (default: its own)"), name: str("the tab's name, 2-4 words of what it's for, e.g. codex review (default: the agent and the prompt's first words)") }, ['ws', 'prompt']),
    run: async a => rpc('tabNew', { ws: a.ws, preset: a.preset || (await rpc<View>('state')).settings?.agent || 'claude', prompt: a.prompt, model: a.model, name: a.name || undefined }), // none: a shell
  },
  {
    name: 'laki_attach_pr',
    description: "Link a GitHub PR to a workspace (its status, checks and review then show on it), when the workspace's branch has none found: e.g. a PR its agent named.",
    inputSchema: obj({ ws: str('a workspace id'), pr: str('the PR: its URL or number') }, ['ws', 'pr']),
    run: a => rpc('prAttach', { ws: a.ws, pr: a.pr }),
  },
  {
    name: 'laki_progress',
    description: "Say how far along your task is, shown on your tab in Laki: an estimate of the whole task (0-100) and what you're on. When LAKI_PROGRESS is set, call it every 20-30 seconds of work; 100 when done.",
    inputSchema: obj({ pct: { type: 'number', description: '0 to 100: how much of the whole task is done' }, note: str('what you are on now, a few words') }, ['pct']),
    run: a => rpc('progress', { tab: process.env.LAKI_TAB, pct: a.pct, note: a.note }),
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
  // extensions (the app's word; files, ids and the API say widget): read the guide, an example, then write one, saved off
  {
    name: 'laki_extensions',
    description: "Laki's extensions (also called widgets: the same thing): small live pages in the sidebar (a clock, a count of PRs, a chart), each a folder with widget.json and widget.html fed by a fetch on a schedule. Each one's id, name, whether it's on, its last fetch's error.",
    inputSchema: obj({}),
    run: async () => ((await rpc<View>('state')).widgets ?? []).map(w => ({ id: w.id, name: w.name, description: w.description, on: w.on, builtin: w.builtin, byAi: w.byAi, every: w.every, error: w.error })),
  },
  {
    name: 'laki_extension_guide',
    description: 'How a Laki extension (a widget) is made (widget.json, widget.html, its fetch command or JS script, the template language, JS pages). Read it before laki_extension_write.',
    inputSchema: obj({}),
    max: 12000,
    run: async () => `Examples that come with Laki (laki_extension_read): links (a JS page, no fetch), my-prs (a shell fetch with gh and jq, a template), team-prs (a JS fetch script, a JS page). Write a new one under a new id with laki_extension_write; change one you made by its id (files you leave out stay; never the user's own nor one that comes with Laki). A fetch runs in the extension's folder; for a JS script, "script": "fetch.mjs". It is saved turned off: the user turns it on in Settings › Extensions (laki://settings/widgets).\n\n${widgetFormat()}`,
  },
  {
    name: 'laki_extension_read',
    description: "An extension's files as text: an example to copy (links, my-prs, team-prs) or one to change.",
    inputSchema: obj({ id: str('its id, from laki_extensions') }, ['id']),
    max: 24000,
    run: a => rpc('widgetFiles', { id: a.id }),
  },
  {
    name: 'laki_extension_write',
    description: "Make an extension, or change one Laki AI made: its files in Laki's extensions folder (never the user's own). Files left out stay as they are. Saved turned off: tell the user to turn it on in [Settings › Extensions](laki://settings/widgets), and what its fetch runs.",
    inputSchema: obj(
      {
        id: str('a new id for a new one: lowercase letters, digits and dashes (e.g. ny-clock)'),
        files: { type: 'object', additionalProperties: { type: 'string' }, description: 'each file name and its whole text: widget.json, widget.html, and the scripts its fetch runs (fetch.sh, fetch.mjs…)' },
      },
      ['id', 'files'],
    ),
    run: a => rpc('widgetWrite', { id: a.id, files: typeof a.files === 'string' ? JSON.parse(a.files) : a.files }), // some models send the object as JSON text
  },
]

let daemon: Promise<unknown> | undefined
const TOOLS = tools(conn)
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
      return { tools: TOOLS.map(({ run, max, ...t }) => t) }
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
