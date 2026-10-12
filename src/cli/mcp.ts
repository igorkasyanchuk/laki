// `laki mcp`: Laki as an MCP server over stdio (JSON-RPC 2.0, a message per line), for Claude Code, Codex or
// any MCP client. Its tools go through the daemon's API like the CLI's commands; none deletes, archives or ships.
import { createInterface } from 'node:readline'
import { ensureDaemon, rpc as conn } from '../shared/conn.ts'
import { BRAINSTORM_OUTPUT } from '../shared/plans.ts'
import { AI_ACTS, API, mergeActions, prRef, rowsOf, templated, templatesFor, type View } from '../shared/types.ts'
import { stamp } from '../shared/when.ts'
import { widgetFormat } from '../shared/widgetGuide.ts'

export type Tool = { name: string; description: string; inputSchema: object; max?: number; run: (a: any) => Promise<unknown> } // max: what Laki AI's model may read of its result (TOOL_TEXT)
export type Rpc = <T = any>(method: string, params?: any, timeoutMs?: number) => Promise<T>
const str = (description: string) => ({ type: 'string', description })
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required })

// the view, without what an agent doesn't need (scans' details) or must not see: settings (env, presets' env and cmd,
// the webhook's URL), projects' config (env), queued prompts, remote access's link (its token). `laki ls --json` too
export async function state(rpc: Rpc = conn) {
  const v: View = await rpc('state')
  const live = v.workspaces.filter(w => !w.archived)
  // each workspace's group: the sidebar's head above it (rowsOf: the project's order)
  const groupOf = new Map<string, string>()
  for (const p of v.projects) {
    let at: string | undefined
    for (const r of rowsOf(p, live)) if ('project' in r) at && groupOf.set(r.id, at); else at = r.name || 'Unnamed group'
  }
  return {
    projects: v.projects.map(p => ({ id: p.id, name: p.name, path: p.path, host: p.host, git: p.git !== false, kind: p.kind, groups: p.seps?.length ? p.seps.map(s => s.name || 'Unnamed group') : undefined })), // kind: shells (the Terminals project) or browsers, the user's own; groups: the sidebar's, laki_new_workspace's group
    workspaces: live
      .map(w => ({ id: w.id, name: w.name, project: w.project, group: groupOf.get(w.id), kind: w.kind, branch: w.branch, path: w.path, host: w.host, port: w.port, ports: w.ports, pr: w.pr && { number: w.pr.number, state: w.pr.state, url: w.pr.url, title: w.pr.title, author: w.pr.author, mine: w.pr.mine, draft: w.pr.draft, checks: w.pr.checks || undefined, review: w.pr.review } })),
    tabs: v.tabs.map(t => ({ id: t.id, workspace: t.workspace, name: t.name, kind: t.kind, agent: t.kind === 'agent' ? t.preset : undefined, status: t.status, code: t.code, done: t.done, queued: t.queue?.length || undefined, last: t.last?.slice(0, 500) })),
  }
}

// a group of a project by its name (any case) or id, as wsNew's place
async function groupId(rpc: Rpc, project: string, group: string) {
  const v: View = await rpc('state')
  const p = v.projects.find(x => x.id === project || x.name === project || x.path === project || `${x.host}:${x.path}` === project) // as findProject takes it
  const want = String(group).trim().toLowerCase()
  const s = p?.seps?.find(x => x.id === group || (x.name || 'Unnamed group').toLowerCase() === want)
  if (!s) throw new Error(`no group ${group} in ${project}${p?.seps?.length ? `: its groups are ${p.seps.map(x => x.name || 'Unnamed group').join(', ')}` : ': it has none (leave group out)'}`)
  return s.id
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
        template: str("a prompt template's name (laki_templates): the prompt goes into it"),
        action: str("an agent action's name (Run ▾'s, laki_actions): its prompt is what the agent does, the prompt above added after it"),
        group: str("one of the project's groups (laki_state's groups), the sidebar's heading it goes under: the one whose name fits the task best (a PR review under Reviews); leave it out when none fits"),
      },
      ['project'],
    ),
    run: async a => {
      const place = a.group ? await groupId(rpc, a.project, a.group) : undefined // before the prompt: a wrong group makes nothing
      const prompt = a.template || a.action ? await promptOf(rpc, a.project, a.prompt ?? '', a.template, a.action, a.pr, a.base) : a.prompt
      const o = { project: a.project, prompt, preset: a.preset, name: a.name, base: a.base, local: !!a.local, model: a.model, effort: a.effort, issue: a.issue, pr: a.pr, place }
      if (!prompt && !a.issue && !a.pr) throw new Error('a prompt, an issue or a PR')
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
    description: "Laki's extensions (also called widgets or plugins: the same thing): small live pages in the sidebar (a clock, a count of PRs, a chart), each a folder with widget.json and widget.html fed by a fetch on a schedule. Each one's id, name, whether it's on, its last fetch's error.",
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
  // specs and brainstorms (experimental: off, the daemon says so)
  {
    name: 'laki_plans',
    description: "The user's specs (requirements for a task, to implement) and brainstorms (an idea to explore, with your ideas, diagrams and prototypes as files) in Laki: each a folder outside the repo with README.md, the spec as Markdown. Each one's project, kind, slug, title and folder.",
    inputSchema: obj({ project: str('a project id (laki_state); default: all') }),
    run: a => rpc('planList', { project: a.project || undefined }),
  },
  {
    name: 'laki_plan_read',
    description: 'A spec or brainstorm: its README.md (the user’s spec or brief, as Markdown), its folder and the files in it (attachments, a brainstorm’s output).',
    inputSchema: obj({ project: str('its project id'), kind: { type: 'string', enum: ['spec', 'brainstorm'] }, slug: str('its slug, from laki_plans') }, ['project', 'kind', 'slug']),
    max: 30000,
    run: async a => {
      const r = await rpc('planGet', { project: a.project, kind: a.kind, slug: a.slug })
      return { title: r.plan.title, folder: r.plan.path, readme: r.markdown, files: r.files.map((f: { path: string; size: number }) => `${f.path} (${f.size} bytes)`) }
    },
  },
  {
    name: 'laki_plan_new',
    description: 'Write a new spec or brainstorm for the user, in a project: its title and its text as Markdown (## Goal, Context, Steps as a - [ ] checklist, How to verify; a brainstorm: the idea, who it is for, constraints). The user edits it in Laki.',
    inputSchema: obj({ project: str('a project id'), kind: { type: 'string', enum: ['spec', 'brainstorm'] }, title: str('a short title'), text: str('the body, Markdown') }, ['project', 'kind', 'title']),
    run: a => rpc('planNew', { project: a.project, kind: a.kind, title: a.title, text: a.text }),
  },
  {
    name: 'laki_plan_write',
    description: `Write a file into a spec's or brainstorm's folder: a brainstorm's output (ideas.md, prototype-<option>.html, <name>.diagram.json) or notes beside a spec. Text files only (.md .html .txt .json .csv .svg .mmd), never README.md or spec.json (the user's). ${BRAINSTORM_OUTPUT}`,
    inputSchema: obj({ project: str('its project id'), kind: { type: 'string', enum: ['spec', 'brainstorm'] }, slug: str('its slug'), path: str('the file, relative to its folder: ideas.md, prototype-cards.html…'), text: str('the whole file') }, ['project', 'kind', 'slug', 'path', 'text']),
    run: a => rpc('planWrite', { project: a.project, kind: a.kind, slug: a.slug, path: a.path, text: a.text }),
  },
]

// a project's prompt templates and Run ▾'s actions, as the app has them (templatesFor, mergeActions)
async function kit(rpc: Rpc, project?: string, view?: View) {
  const v: View = view ?? (await rpc('state'))
  const p = project ? v.projects.find(x => x.id === project || x.name === project) : undefined
  if (project && !p) throw new Error(`no project ${project}`)
  const templates = templatesFor(v.settings.templates, p?.config?.templates).filter(t => t.name?.trim() && t.text?.trim())
  return { v, p, templates, actions: mergeActions(v.settings.actions, p?.config?.actions) }
}
const named = <T extends { name: string }>(list: T[], name: string, what: string) => list.find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? Promise.reject(new Error(`no ${what} ${name}: ${list.map(x => x.name).join(', ') || 'none'}`))
// a new workspace's prompt through a template or from an action (its words first, what was asked after)
async function promptOf(rpc: Rpc, project: string, prompt: string, template?: string, action?: string, pr?: string, base?: string) {
  const { p, templates, actions } = await kit(rpc, project)
  if (action) {
    const x = await named(actions.filter(a => a.target !== 'shell'), action, 'agent action')
    prompt = [stamp(x.text.trim(), Date.now()), prompt.trim()].filter(Boolean).join('\n\n') // its {{HH:mm}}-style dates: now's, as Run ▾'s
  }
  if (!template) return prompt
  return templated(await named(templates, template, 'template'), prompt, { project: p?.name, base, pr: pr ? prRef(String(pr)) : undefined }) // as the new-workspace page fills one
}

// Laki's skill for Laki AI (Settings › AI, on unless turned off): what these tools are for, in its instructions
export const SKILL = `With Laki's skill you also: list a project's open PRs (laki_prs: yours, or others' to review), read a project's notes, memory, templates, actions and scheduled tasks (laki_project), write its notes and memory, rename or pin workspaces and tabs, open a shell (its command typed for the user to run), run the user's own actions (laki_run_action: a terminal's command is typed for them to run), start a workspace through a prompt template or an agent action (laki_new_workspace's template and action: e.g. a review action on each PR of a screenshot, a workspace each), add to-dos, change scheduled tasks.
Not sure what the user means, or which of a few they want? Ask with laki_ask (2-6 short options) instead of guessing, then stop: their pick comes as the next message.
To remove something (a memory item, a scheduled task, a tab, a to-do) call laki_remove: the user confirms it with a button, and Laki removes it, not you. Never archive, delete, ship or merge workspaces.
The user's specs (what to build) and brainstorms (ideas to explore), when turned on: laki_plans, laki_plan_read; laki_plan_new writes one for them, laki_plan_write puts your work beside one (ideas.md, a prototype per option, diagrams).`

// the skill's tools: Laki AI's only (laki mcp gives them when LAKI_AI_SKILL is set: its claude -p or codex exec)
export const skillTools = (rpc: Rpc): Tool[] => [
  {
    name: 'laki_ask',
    description: 'Ask the user a question with 2-6 options, shown as buttons in the conversation; then end your turn without more words: their pick comes as the next message. Use it when unsure what they mean or which of several things they want.',
    inputSchema: obj({ question: str('the question, short'), options: { type: 'array', items: { type: 'string' }, description: '2 to 6 short answers to pick from' } }, ['question', 'options']),
    run: a => rpc('aiQuestion', { text: a.question, options: a.options }),
  },
  {
    name: 'laki_remove',
    description: 'Ask the user to remove something: a memory item of a project, a scheduled task, a tab (closing it), a to-do. They see Yes / No buttons and Laki removes it on Yes; you never remove it yourself. End your turn after it.',
    inputSchema: obj({ kind: { type: 'string', enum: [...AI_ACTS] }, id: str('its id (a memory item: from laki_project; a tab: <tab id>)'), project: str("a memory item's project id"), }, ['kind', 'id']),
    run: a => rpc('aiQuestion', { act: { kind: a.kind, id: a.id, project: a.project } }), // Laki names it, from its own state
  },
  {
    name: 'laki_prs',
    description: "Open pull requests on GitHub in a project's repo (gh pr list), or in every project's: who: mine (the user's), others (everyone else's: to review), all. Each with its author, branch, review state, and the workspace that has it, if one does.",
    inputSchema: obj({ project: str('a project id (default: every git project)'), who: { type: 'string', enum: ['mine', 'others', 'all'] } }),
    max: 12000,
    run: async a => {
      const v: View = await rpc('state')
      const ps = v.projects.filter(p => p.git !== false && !p.kind && (!a.project || p.id === a.project || p.name === a.project))
      if (!ps.length) throw new Error(a.project ? `no git project ${a.project}` : 'no git projects')
      return Promise.all(ps.map(p => rpc('prList', { project: p.id, who: a.who || 'all' }, 40000).then(prs => ({ project: p.id, name: p.name, prs }), e => ({ project: p.id, name: p.name, error: e.message }))))
    },
  },
  {
    name: 'laki_project',
    description: "A project's notes (the user's Markdown), memory (items to remember, each with an id), prompt templates, actions (Run ▾'s: a prompt for an agent, or a command for a terminal), scheduled tasks and to-dos.",
    inputSchema: obj({ project: str('a project id') }, ['project']),
    max: 16000,
    run: async a => {
      const { v, p, templates, actions } = await kit(rpc, a.project)
      return { id: p!.id, name: p!.name, path: p!.path, notes: p!.notes || '', memory: p!.memory ?? [], templates, actions, schedules: (v.schedules ?? []).filter(x => x.project === p!.id).map(x => ({ id: x.id, name: x.name, when: x.when, on: x.on, next: x.next, prompt: x.prompt.slice(0, 300) })), todos: (v.todos ?? []).filter(t => t.project === p!.id) }
    },
  },
  {
    name: 'laki_notes_write',
    description: "Write a project's notes (Markdown, the user's own page): add to the end, or replace them all when asked to.",
    inputSchema: obj({ project: str('a project id'), text: str('Markdown'), replace: { type: 'boolean', description: 'replace the whole notes (default: add to the end)' } }, ['project', 'text']),
    run: async a => {
      const { p } = await kit(rpc, a.project)
      const notes = a.replace ? String(a.text) : [p!.notes?.trimEnd(), String(a.text)].filter(Boolean).join('\n\n')
      await rpc('projectSet', { id: p!.id, notes })
      return { ok: true, length: notes.length }
    },
  },
  {
    name: 'laki_memory_write',
    description: "Add an item to a project's memory (a fact to keep: a decision, a how-to), or change one by its id.",
    inputSchema: obj({ project: str('a project id'), text: str('the item, a line or a few'), id: str("an item's id to change it (default: a new one)") }, ['project', 'text']),
    run: async a => {
      const { p } = await kit(rpc, a.project)
      const list = p!.memory ?? []
      const text = String(a.text).trim()
      if (!text) throw new Error('its text')
      if (a.id && !list.some(m => m.id === a.id)) throw new Error(`no memory item ${a.id} in ${p!.name}`)
      const id = a.id || Math.random().toString(36).slice(2, 10)
      const memory = a.id ? list.map(m => (m.id === a.id ? { ...m, text, edited: Date.now() } : m)) : [...list, { id, text, at: Date.now() }]
      await rpc('projectSet', { id: p!.id, memory })
      return { ok: true, id }
    },
  },
  {
    name: 'laki_rename',
    description: 'Rename, pin, mute or color a workspace, or rename or mute a tab.',
    inputSchema: obj({ ws: str('a workspace id'), tab: str('a tab id (instead of ws)'), name: str('its new name'), pinned: { type: 'boolean', description: 'a workspace: in the sidebar’s Pinned' }, muted: { type: 'boolean', description: 'no notifications from it' }, color: str('a workspace’s color: red, orange, yellow, lime, green, teal, blue, purple, pink, brown, gray, or none') }),
    run: a => {
      if (a.tab) return rpc('tabSet', { id: a.tab, name: a.name || undefined, muted: a.muted })
      if (!a.ws) throw new Error('a workspace or a tab')
      return rpc('wsSet', { id: a.ws, name: a.name || undefined, pinned: a.pinned, muted: a.muted, color: a.color === 'none' ? '' : a.color })
    },
  },
  {
    name: 'laki_shell',
    description: "Open a shell: a tab in a workspace's folder, or a new Terminal in the home folder. A command is typed into it for the user to run (Enter is theirs).",
    inputSchema: obj({ ws: str('a workspace id (default: a new Terminal)'), command: str('what to type, not run') }),
    run: async a => {
      // a workspace's new shell tab, or a new Terminal's (quickNew: a workspace with its shell)
      const t = a.ws ? await rpc('tabNew', { ws: a.ws, preset: 'shell' }) : await rpc<{ id: string }>('quickNew', { kind: 'shells' }).then(w => rpc<View>('state').then(v => v.tabs.find(x => x.workspace === w.id)))
      if (!t?.id) throw new Error('no shell tab')
      // ponytail: a fixed 1.5 s for the shell's prompt to come up; a slow login shell gets it typed early (bringBack's wait for quiet output if that bites)
      if (a.command) await new Promise(r => setTimeout(r, 1500)).then(() => rpc('send', { target: t.id, text: String(a.command), enter: false }))
      return { ok: true, workspace: t.workspace, tab: t.id, typed: !!a.command }
    },
  },
  {
    name: 'laki_actions',
    description: "The user's actions (Run ▾): prompts for an agent and commands for a terminal, global and the project's, by name.",
    inputSchema: obj({ project: str('a project id') }),
    run: async a => (await kit(rpc, a.project)).actions,
  },
  {
    name: 'laki_templates',
    description: "The user's prompt templates for new workspaces ({{prompt}} is where the prompt goes), global and the project's.",
    inputSchema: obj({ project: str('a project id') }),
    run: async a => (await kit(rpc, a.project)).templates,
  },
  {
    name: 'laki_run_action',
    description: "Run one of the user's actions in a workspace, as Run ▾ does: an agent's prompt goes to its agent there (a new tab of it when none runs); a terminal's command is typed into a new shell tab for the user to run (Enter is theirs, as laki_shell's).",
    inputSchema: obj({ ws: str('a workspace id'), name: str("the action's name (laki_actions)") }, ['ws', 'name']),
    run: async a => {
      const v0: View = await rpc('state')
      const w = v0.workspaces.find(x => x.id === a.ws)
      if (!w) throw new Error(`no workspace ${a.ws}`)
      const { v, actions } = await kit(rpc, w.project, v0)
      const x = await named(actions, a.name, 'action')
      const text = stamp(x.text, Date.now()) // its {{HH:mm}}-style dates: now's, as Run ▾'s
      if (x.target === 'shell') {
        const t = await rpc('tabNew', { ws: w.id, preset: 'shell' })
        await new Promise(r => setTimeout(r, 1500)) // ponytail: as laki_shell's, a fixed wait for the prompt
        await rpc('send', { target: t.id, text, enter: false }) // typed, not run: a command on the Mac is the user's to start
        return { ok: true, workspace: w.id, tab: t.id, typed: true }
      }
      const live = v.tabs.find(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited' && (x.target === 'any' || t.preset === x.target))
      if (live) return rpc('send', { target: live.id, text, whenIdle: true, agent: true })
      return rpc('tabNew', { ws: w.id, preset: x.target === 'any' ? v.settings.agent || 'claude' : x.target, prompt: text, name: x.name })
    },
  },
  {
    name: 'laki_schedule_set',
    description: 'Change a scheduled task by its id (laki_schedules): turn it on or off, its times in English, prompt or name.',
    inputSchema: obj({ id: str("the task's id"), on: { type: 'boolean' }, when: str('e.g. "weekdays at 9am"'), prompt: str('its prompt'), name: str('its name') }, ['id']),
    run: a => rpc('scheduleSet', { id: a.id, on: a.on, when: a.when, prompt: a.prompt, name: a.name }),
  },
  {
    name: 'laki_todo_add',
    description: "Add a to-do to a project's column on the Board (a task to start later).",
    inputSchema: obj({ project: str('a project id'), text: str('the task') }, ['project', 'text']),
    run: a => rpc('todoAdd', { project: a.project, text: a.text }),
  },
]

let daemon: Promise<unknown> | undefined
const TOOLS = [...tools(conn), ...(process.env.LAKI_AI_SKILL === '1' ? skillTools(conn) : [])]
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
