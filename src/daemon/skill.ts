// The agent skill: SKILL.md and a launcher for the CLI in each agent's skills folder (~/.claude/skills/laki,
// ~/.codex/…, ~/.gemini/…, ~/.grok/…, ~/.config/opencode/…), so their sessions know laki and can drive it. Written
// when the user asks (Settings), and again as a daemon starts when a Laki update changed one installed for it
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { groupRule } from '../shared/tools.ts'
import { USAGE } from '../shared/usage.ts'
import { cliArgv, cliEnv, dir, LAKI_CLI, pluginFiles, q, STORAGE_NOTE } from './core.ts'
import { widgetFormat } from '../shared/widgetGuide.ts'
import { STARTER_KINDS } from '../shared/widgetStarters.ts'
import { BUILTIN } from './widgets.ts'

// home: the agent's folder in ~ (its skills/ is where it looks); add: its `mcp add` for the user's scope, before the
// command (gemini's takes no --: the command's arguments follow its name)
const AGENTS = {
  claude: { name: 'Claude Code', home: '.claude', add: 'claude mcp add -s user laki --' },
  codex: { name: 'Codex', home: '.codex', add: 'codex mcp add laki --' },
  gemini: { name: 'Gemini', home: '.gemini', add: 'gemini mcp add -s user laki' },
  grok: { name: 'Grok', home: '.grok', add: 'grok mcp add -s user laki --' },
  opencode: { name: 'OpenCode', home: '.config/opencode', add: '' }, // ponytail: ~/.config, not $XDG_CONFIG_HOME
}
export type SkillAgent = keyof typeof AGENTS
// the skills, each installed on its own: laki (drive Laki), laki-widget (make widgets) and laki-orchestrate (several
// agents on one piece of work, a workspace each)
const SKILLS = ['laki', 'laki-widget', 'laki-orchestrate'] as const
export type SkillName = (typeof SKILLS)[number]
// mcp: what adds Laki as the agent's MCP server (laki's rows), which the user runs or pastes (we never write the
// agents' config): a command, or for opencode (its `mcp add` only asks questions) the lines for mcpIn, its config file
// foreign: an outdated one whose launcher drives another data dir's daemon (another Laki, LAKI_HOME=…): updating it
// points it here
export type SkillInfo = { agent: SkillAgent; skill: SkillName; name: string; path: string; state: 'missing' | 'installed' | 'outdated'; foreign?: boolean; mcp: string; mcpIn?: string }

const skillDir = (a: SkillAgent, k: SkillName) => join(homedir(), AGENTS[a].home, 'skills', k)
const mcpArgv = () => ['/usr/bin/env', ...cliEnv, `LAKI_HOME=${dir}`, ...cliArgv, 'mcp']
const mcpCmd = (a: SkillAgent) =>
  AGENTS[a].add ? `${AGENTS[a].add} ${mcpArgv().map(q).join(' ')}` : JSON.stringify({ mcp: { laki: { type: 'local', command: mcpArgv() } } }, null, 2)

// the files, as they'd be written now: the launcher holds this install's paths
function files(at: string, k: SkillName): Record<string, string> {
  const cli = join(at, 'laki')
  const laki = `#!/bin/sh\n# the laki CLI, for agents (written by laki: Settings → Agent skill)\nexec /usr/bin/env ${[...cliEnv, `LAKI_HOME=${dir}`, ...cliArgv].map(q).join(' ')} "$@"\n`
  if (k === 'laki-widget') return { laki, 'SKILL.md': widgetSkill(cli) }
  if (k === 'laki-orchestrate') return { laki, 'SKILL.md': orchestrateSkill(cli) }
  return {
    laki,
    'SKILL.md': `---
name: laki
description: Drive Laki, the desktop app that runs coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in its own git worktree. Use it to list projects and workspaces, start a new workspace with an agent and a prompt, open tabs, message an agent or read its screen, see a workspace's diff, run its dev server or ship it as a PR, and schedule prompts for later or on repeat (every weekday at 9am…). Use when the user asks to start, hand off, parallelize, schedule or check work in Laki, and whenever $LAKI_PROGRESS is 1: then report how far along your task is (laki progress) while you work. To make a Laki extension (a widget), use the laki-widget skill; to split work across several agents at once, the laki-orchestrate skill.
---

# Laki

Laki runs each task in a **workspace**: a git worktree on its own branch (\`laki/<id>\`), or the repo itself
(\`--local\`), with tabs for agents (claude, codex, gemini, grok, opencode), shells and a dev server. A **project** is a repo (or a
folder) added to Laki; \`Terminals\` and \`Browsers\` (\`kind\` shells or browsers in \`ls --json\`) are the user's own terminals and web pages,
not for new workspaces. The app shows all of it live; the CLI drives the same daemon.

Run the CLI through this launcher (an absolute path: it works from any shell; keep the quotes):

    "${cli}"

For example \`"${cli}" ls --json\`. Below, \`laki\` stands for it.

## Where you are

Inside a Laki tab, \`$LAKI_APP\` is \`true\`, \`$LAKI_HOME\` is set, \`$LAKI_WORKSPACE\` is your workspace's id,
\`$LAKI_TAB\` your tab's and \`$PORT\` the workspace's port. Outside Laki they're unset.

## Report progress

When \`$LAKI_PROGRESS\` is \`1\` (the user turned on Settings › General › Progress on tabs), say how far along your
task is while you work on it: \`laki progress <0-100> "<what you're on>"\` (or the MCP tool \`laki_progress\`) about
every 20-30 seconds of work. It's your estimate of the whole task, not of the step: weigh the steps by how long
they take, never go back down, and send \`100\` when it's done. Laki shows it on your tab (or your workspace's row in
the sidebar, as the user picked) until your turn ends.
Unset: don't.

## Your pull request

A PR of your workspace's branch shows on the workspace on its own once pushed (its status, checks, author). One you
opened on another branch, or in another repo, doesn't: attach it right after \`gh pr create\`, \`laki pr . <url>\`
(MCP: \`laki_attach_pr\`). One that isn't this workspace's after all: \`laki pr . --detach\` (it stays only related).

## Keep files and links for the user

${STORAGE_NOTE}

Something for the user to look at (a folder of screenshots, a report, a page you started): \`laki show "<what it is>"
--open <folder|file|url>\` (4 at most) puts a card under your tab in Laki with a button each, instead of asking them to
run \`open …\`. Nothing opens until they click.

## Commands

Unsure of one? \`laki help <command>\` (or \`laki <command> --help\`) prints its options, what it prints and examples.

\`\`\`
${USAGE}
\`\`\`

## Start work

1. \`laki ls --json\`: the projects (ids), workspaces (id, branch, path; \`tabs\`: how its tabs are split, \`a | b\` side by
   side, \`a / b\` stacked) and tabs with their status.
2. \`laki new <project> --prompt "<task>" [--preset claude|codex|gemini|grok|opencode|<profile>] [--name short-name] [--base <branch>]\`:
   a new worktree on a new branch, set up by the project's setup script, with the agent started on the
   prompt. \`--local\` works in the repo itself; \`--preset shell\` or \`none\` starts no agent; \`--model\` and
   \`--effort\` pick the agent's (blank: its own), \`--perm\` its permission mode; \`--no-setup\` skips the setup script;
   \`--template\`, \`--action\` and \`--group\` use the user's prompt templates, agent actions and sidebar groups.
   ${groupRule("each project's \`groups\` in \`laki ls --json\`; \`--group <name>\`")}
   Another agent in a workspace that exists: \`laki tab <ws> --preset codex --prompt "<task>"\`.
3. Check on it: \`laki screen <ws>\` (the agent's screen), \`laki ls --json\` (running, waiting for a
   permission, idle).
4. Follow up: \`laki send <ws> "<text>"\`, or \`--when-idle\` to queue it for when the agent's turn ends.
5. Talk to other agents by name: \`laki name <name>\` names you (others reach you as \`@<name>\`), \`laki agents\`
   lists the named ones, \`laki ask @<name> "<question>"\` asks one and prints its reply, \`laki send @<name> "<text>"\`
   tells it something. Asked a question that way, your reply is the answer: say it plainly in your last message.

Write prompts as for a new colleague: the goal, where to look, how to tell it's done. Independent tasks: one
workspace each, so they run in parallel.

An extension (also called a widget: a small live page in Laki's sidebar) is made with the laki-widget skill (Settings ›
Agent skill installs it); \`laki widget\` lists and checks them, and \`laki widget set <id>\` changes where one shows
(\`--place desk,side\`), its size, how often it fetches and its settings (\`key=value\`); only the user turns one on. The
user's extensions may give you tools:
\`laki widget tools\` lists them and when to use them, \`laki widget tool <id> <action> '<json>'\` runs one in your
workspace (Laki may ask the user first; denied: don't try again unasked).

Specs and brainstorms (on unless the user turned them off: Settings › General › Pages) are the user's own pages,
folders outside the repo, each with a README.md: a spec says what to build, a brainstorm what to explore. A prompt that
names one (\`Spec: <path>/README.md\`) means: read it and the files beside it first, then do what it says. Over MCP
(\`laki mcp\`): \`laki_plans\` lists them, \`laki_plan_read\` reads one, \`laki_plan_new\` writes a new one for the user,
\`laki_plan_write\` puts a file beside one (ideas, a prototype, a diagram); never README.md or spec.json, the user's.

Project memory: what Laki keeps about a project for every session in it, the user's items and what agents learned
(50 each). \`laki memory .\` reads it (claude and codex get it at their start already); when you learn something
general and lasting about the project (an approach that works or doesn't, a gotcha, a convention, how to run or test
it), \`laki memory add . "<a line or two>"\` keeps it for later sessions (not task notes, progress or secrets); a
learned one that's wrong: \`laki memory rm . <id>\`. MCP: \`laki_memory\`, \`laki_remember\`.

Workflows (on unless the user turned them off: Settings › General › Pages) are graphs of blocks Laki runs for a task,
each run in a workspace of its own: agent blocks (a prompt, or one of the user's agent actions with \`use: <its slug>\`, which \`laki_workflows\` lists), run
(a shell command), ask (the user picks), choice (if/else by what a block said), case (if/elsif/else: branches tested in order, else last), action (open a PR, approve, merge, dev server,
archive: asks the user first), wait (its PR's checks), save (text, a file of the workspace, or a link into the
workspace's Artifacts), llm (one prompt to a model on OpenRouter), webhook (a request to another system; secrets as
{{env.NAME}}), decide (an OpenRouter decision model answers yes/no, choice or score questions about a JSON state:
\`steps.<block>.<question>\` and its \`.p\`; unsure, the run asks the user; \`route: <question>\` gives a line per answer),
popup (a window over Laki with HTML or Markdown: a result to read) and end (\`notify: yes\`, \`phone: yes\`); llm's
\`json: yes\` is JSON mode (an agent's too: its answer the JSON it ends with); case branches can test numbers (\`>= 0.8\`) or JS; \`out: a, b\` on an agent, llm, run or webhook block names outputs the next blocks use as
{{steps.<block>.a}}. Each is one Markdown file: yours in Laki, or a project's in \`.laki/workflows/<id>.md\`.
Over MCP: \`laki_workflows\` lists them and their runs (with an id: that one's whole file); \`laki_workflow_write\`
writes one, the whole file (its description has the format and every block); to change one, take its file from
\`laki_workflows\` with its id, edit it and write it back with the same id and project; \`laki_workflow_run\` starts a run. One you wrote runs only after the
user reads and saves it in Laki; a project's that came with the repo (or changed since) starts for you only once the user
allows it there. A run block's \`{{…}}\` go in as environment variables: write them bare or in double quotes, never in
single quotes. An agent block's \`perm:\` and \`fast: yes\` (else the head's \`perm:\`, then its profile's) set how freely it acts;
\`when done: keep\` keeps a run's worktree (unset: archived once it's done and clean). The CLI: \`laki flow ls\`,
\`laki flow run <workflow> <project> <task>\` (\`--ws .\`: in this workspace, no new worktree), \`laki flow again <run>
[--from <block>]\`, and \`laki flow check [file.md… | folder]\` after you write one (no daemon; exit 1 on a problem).

### A new session (/laki:new)

When the user writes \`/laki:new <task>\` (or \`laki:new\`), or asks for a new session for a task "with codex" or
"with claude": \`laki new . --preset <the agent named; none: claude> --prompt "<the task>"\`. The \`.\` is this
tab's project; the prompt is the task for an agent that hasn't seen this conversation (what to do, the files and
facts that matter, how to tell it's done). PRs and issues it names are only the new workspace's related links (its
own PR, once opened, is its PR); \`--link <url>\` when it's about that PR without changing it (a review). Don't do the
task here; say the workspace id it printed. In Laki's
Claude Code tabs, \`/laki:new\` is a command of its own.

\`/laki:extension <what>\` (or \`laki:extension\`): make or change a Laki extension (a widget) for it, with the
laki-widget skill (\`laki widget …\`). In Laki's Claude Code tabs it's a command of its own too.

A project can be on an SSH host (\`laki project add devbox:~/code/app\`; \`laki ls\` shows \`host:path\`): its
workspaces' paths are on that machine, not this one, so read their work with \`laki diff\` and \`laki screen\`, not
from the disk here. Its agents run there and have no \`laki\`.

- From a GitHub issue: \`laki new <project> --issue <url|number>\` (its title and text become the prompt; a
  \`--prompt\` adds to it).
- On a GitHub PR: \`laki new <project> --pr <url|number> --prompt "…"\` (a worktree on the PR's branch, a fork's
  too, named after it).
- About a GitHub PR without its branch (a review, an investigation): \`laki new <project> --link <url|number> --prompt
  "…"\` (its status, checks and author show on the workspace). From an agent's tab, a PR the prompt only names is a
  related link, not the workspace's PR.
- Two agents on the same task, to keep the better result: \`laki new <project> --fan claude,codex --prompt "…"\`
  (the user compares them in the app).

## Check the UI

\`laki browser open /\` loads the workspace's dev server (\`$PORT\`; start it with \`laki run <ws>\`) in a hidden
browser of the app's; then \`screenshot\` (a PNG's path: read it), \`click "<css>"\`, \`fill "<css>" "<text>"\`,
\`text\` (the page's text). This Mac's localhost only, and only while the Laki app is open.

## Schedule work

The daemon runs a scheduled task's prompt at the times a line of English says, while the Mac is awake (a run
more than 30 minutes late is skipped and logged as missed).

    laki schedule add <project> --when "every day at 2am except weekends" "<prompt>"

- \`--when\`: \`weekdays at 9:00\`, \`mon, wed and fri at 18:30\`, \`every 2 hours from 9am to 6pm\`,
  \`every 30 minutes\`, \`at 3 in the afternoon\`, \`tomorrow at 7am\` or \`once at 23:00\` (one run, then off).
  Every 5 minutes at most; name the days instead of "every few days". A wording it can't read is refused
  with what it needs.
- \`--where\`: \`new\` (the default in a repo: a new worktree and workspace each run), \`folder\` (the project's
  own folder, no worktree, one session; the default for a folder without git), \`folder-new\` (the folder, a new
  session and sidebar row each run) or a workspace id (its running agent gets the prompt, queued while it works).
- \`--preset claude|codex|gemini|grok|opencode|<preset>\`; \`--name "Nightly deps {{DD-MM}}"\`: \`{{DD-MM-YY}}\`, \`{{YYYY-MM-DD}}\`,
  \`{{HH:mm}}\` or \`{{ddd D MMM}}\` in the name or the prompt become the run's date, so each run's workspace
  has its own name; \`{{branch}}\`, \`{{path}}\`, \`{{port}}\`, \`{{pr}}\`, \`{{workspace}}\`, \`{{tab}}\` in the prompt
  become the run's workspace's and tab's.
- \`laki schedule\` lists them (id, next run), \`laki schedule log\` the last runs; \`on\`, \`off\`, \`run\` (now)
  and \`rm\` take an id.
- A reminder for the user (Calendar, unless it's off: Settings › General › Pages), only when they ask for one:
  \`laki remind "<when: in 2h, tomorrow at 9am, fri at 5pm, 2026-10-20 14:30>" <text> --ws .\` (\`--ws .\`: about your
  workspace); it notifies them then. \`laki reminders\` lists them; \`done\` and \`rm\` take an id. MCP: \`laki_reminder\`.

## Recipes

\`jq\` ships with macOS.

    # the tabs waiting for an answer (a permission prompt)
    laki ls --json | jq -r '.tabs[] | select(.status == "waiting") | "\\(.workspace)/\\(.name)"'
    # wait for a workspace's agents to finish their turn (a shell is running too while a command runs: a dev server)
    while laki ls --json | jq -e '.tabs[] | select(.workspace == "<ws>" and .kind == "agent" and .status == "running")' >/dev/null; do sleep 10; done

## Rules

- Ask the user before \`rm\`, \`archive\`, \`ship\` or \`stop\`: they end agents, delete worktrees or push. An
  extension's gate may hold \`ship\` or \`archive\`: it prints why and exits 1; fix what it says or tell the user
  (\`--force\` is theirs, refused in your tab).
- Schedule a task only when the user asks for one: it starts agents later, unattended. One you add is saved off: say
  they turn it on in Scheduled tasks (\`on\` and \`run\` are theirs), and when it would first run.
- From your tab, \`laki new\` and \`laki tab\` start an agent or a shell, never a command (\`--cmd\`, a command
  preset): the user starts commands. \`send\` or \`screen\` on a tab of another workspace asks the user in the app first.
- \`<ws>\` is a workspace id; \`<ws>/<tab>\` picks a tab (by default the agent's).
- Don't type into a busy agent unless asked: use \`send --when-idle\`.
- The CLI talks to the Laki daemon over localhost. In a sandbox that blocks that, ask to run it outside.
- \`unknown method\`: the running daemon is older than the CLI. Ask the user to restart it (the app's status
  bar offers it; agents resume).
`,
  }
}

// laki-widget: the widget creator, a skill of its own; in Laki's claude tabs also /laki:extension, the plugin's command
// (core's claudePlugin), the same guide with the CLI as its own command line
const widgetSkill = (cli: string) => `---
name: laki-widget
description: Make Laki extensions, also called widgets (one and the same thing), the small live pages in the Laki app's sidebar, top bar or status bar (a clock, a count of PRs, a chart, a table) with a full view a click away, or buttons on its rail and sidebar foot (an icon, a label, a badge count, a click that runs an action), each fed by a shell command or a JS script on a schedule. Use when the user asks to create, change, debug or explain a Laki extension or widget (or a tile, panel, button or plugin for Laki's sidebar or rail).
---

${widgetGuide(`Run the laki CLI through this launcher (an absolute path; keep the quotes): \`"${cli}"\`.`)}`
// N10: only you start it (disable-model-invocation), and it runs unasked only what reads: new, dev, set, on, write and
// the rest ask you in Claude's own prompt
const READ_ONLY = ['ls', 'kit', 'check', 'what', 'logs', 'render', 'events', 'tools']
pluginFiles.push(() => ({
  'claude-plugin/commands/extension.md': `---
description: Make or change a Laki extension (a widget): a live tile, a bar item or a button in Laki
argument-hint: <what it shows or does>
allowed-tools: ${READ_ONLY.map(c => `Bash(${LAKI_CLI} widget ${c}:*)`).join(', ')}
disable-model-invocation: true
---
Make or change a Laki extension for this request: $ARGUMENTS

${widgetGuide(`Run the laki CLI as \`${LAKI_CLI}\`.`)}`,
}))
const widgetGuide = (run: string) => `# Making a Laki extension (a widget)

Extension and widget are two names for one thing: the app says extension (Settings › Extensions), its files, ids and
\`laki widget\` say widget. A user who asks for either means this. A widget is a folder; its name is the widget's id. Make new ones in Laki's own folder:

    ${join(dir, 'widgets')}/<id>/

(the user can add more folders in Settings › Extensions). Two complete examples come with Laki, read them first:
${BUILTIN ? `\`${join(BUILTIN, 'my-prs')}\` (a shell fetch with gh and jq; its ui: stats, and a grouped list in the full view; its sample) and \`${join(BUILTIN, 'links')}\` (a JS page, no fetch, a list setting)` : 'my-prs and links in the app'}.
Don't edit those: copy one to a new id.

${widgetFormat()}
## Check your work

${run} Below, \`laki\` stands for it.

    laki widget reload               # read the folders again (after any change) and fetch
    laki widget run <id>             # fetch now: "fetched" or the error
    laki widget render <id> [--full] # the HTML it shows now
    laki widget action <id> <action> [arg] # a button's action: what the app would show (it really runs; from an agent, the user is asked first)
    laki widget ls                   # each one: on or off, size, schedule, last error
    laki widget set <id> --place desk --size 3x2 --every 10 key=value  # where it shows (side, top, status, rail, foot, desk, panel, row), its size, schedule, settings
    laki widget kit [element]        # the UI kit's elements, or one's props and a sample
    laki widget check <id> --no-run  # what's wrong with it: fix every ✗ before you answer (after every change)
    laki widget new <name> --kind <k> # a starter to begin from: ${STARTER_KINDS.join(', ')}
    laki widget push <id> '<json>'   # its data from outside (a hook, a cron job): no fetch; --merge over it, --ws <id> per workspace
    laki widget tools                # its actions that are tools for agents; laki widget tool <id> <action> '<json>' calls one

An agent uses an extension's tools: \`laki widget tools\`, then \`laki widget tool\` (the user approves as the tool says).
\`laki widget action\` from an agent asks the user each time; \`laki widget on\` from an agent is refused (only the user
turns an extension on), and \`laki widget dev\` from one links the folder but leaves its extensions off.

For the user working on an extension of their own (in their code, not Laki's folder): \`laki widget dev\` in its
folder links it (on, first, reloaded on each save, the last good version kept over a broken file) and prints each run;
its page's Data, Runs, Env and Files tabs show the rest. It runs until Ctrl-C: suggest it, don't run it yourself.

A new widget in Laki's folder is found at once and starts off: the user turns it on in Settings › Extensions. Tell the user which settings to fill in (Settings ›
Extensions) and what it fetches how often: each fetch may call an API. To show one somewhere else, resize it or change
a plain setting of any extension, \`laki widget set\` (no file to write; never a secret, its source or network access).
`

// laki-orchestrate: a coordinator's protocol over Laki's workspaces (Superset's orchestrate, in Laki's commands), a skill
// of its own; in Laki's claude tabs also /laki:orchestrate, only you start it, its laki commands unasked (another
// workspace's screen or a message to it: Laki asks you, unless this workspace started it)
const orchestrateSkill = (cli: string) => `---
name: laki-orchestrate
description: Coordinate several coding agents in parallel through Laki, each in a workspace of its own (a git worktree on its own branch), with follow-ups, progress reads, dependencies between tasks and a structured result from each. Use when the user asks to delegate, parallelize, fan out or split up coding work across agents or workspaces, hand work from one agent to another, or check on workers ("spin up agents for each of these", "run these in parallel", "what are my workers doing"). Not for one task in one workspace (the laki skill's laki new).
argument-hint: the work to split up and coordinate
---

${orchestrateGuide(`Run the laki CLI through this launcher (an absolute path; keep the quotes): \`"${cli}"\`.`)}`
const ORCH_CMDS = ['ls', 'new', 'tab', 'send', 'screen', 'diff', 'progress']
pluginFiles.push(() => ({
  'claude-plugin/commands/orchestrate.md': `---
description: Split work across several Laki agents in parallel, a workspace each, and coordinate them to one result
argument-hint: <the work to split up>
allowed-tools: ${ORCH_CMDS.map(c => `Bash(${LAKI_CLI} ${c}:*)`).join(', ')}
disable-model-invocation: true
---
Coordinate this work across Laki agents: $ARGUMENTS

${orchestrateGuide(`Run the laki CLI as \`${LAKI_CLI}\`.`)}`,
  // Laki's OpenCode tabs too (OPENCODE_CONFIG_DIR, core's: <data>/opencode): /laki-orchestrate
  'opencode/command/laki-orchestrate.md': `---
description: Split work across several Laki agents in parallel, a workspace each, and coordinate them to one result
---
Coordinate this work across Laki agents: $ARGUMENTS

${orchestrateGuide(`Run the laki CLI as \`${LAKI_CLI}\`.`)}`,
}))
const orchestrateGuide = (run: string) => `# Orchestrating agents in Laki

You are the coordinator: Laki runs the workers (each a workspace with an agent in it) and tells you their state; you
own the plan, the order and what counts as done. ${run} Below, \`laki\` stands for it.

## The control surface

    laki ls --json                                        # projects (ids), workspaces, tabs: status running | waiting | idle | exited, done, last (its last answer)
    laki new <project|.> --name <task-id> --prompt '…'    # a worker: a new worktree and branch, its agent on the prompt; prints its workspace id
         [--preset claude|codex|gemini|grok|opencode|<profile>] [--model m] [--effort e] [--perm acceptEdits (claude's: codex's never asks, not yours to start)] [--base <branch>] [--no-setup]
    laki tab <ws> --preset codex --name review --prompt '…'  # a second agent in a workspace that exists (a review of what the first did)
    laki screen <ws>[/<tab>] --lines 200                  # read what an agent shows, nothing typed
    laki send <ws>[/<tab>] --when-idle '…'                # a follow-up, queued until its turn ends (without --when-idle: now)
    laki diff <ws> [--uncommitted]                        # what it changed

\`.\` is your own tab's project (\`$LAKI_WORKSPACE\`). Workers you start come from your workspace (Laki shows it): reading or
messaging them needs no question; any other workspace, Laki asks the user first. A worker's turn ends when its tab is
\`idle\` (Laki knows from the agent's own hooks, not from guessing); \`waiting\` means it asks something: read its
screen, then answer it if it's yours to answer (\`laki send\`), else tell the user. Never ship, merge, archive or delete
a workspace unless the user asked for it.

## Plan

Keep a table in your own context, one row per task: id, depends on, workspace, status (pending, ready, running, done,
blocked, failed) and result. Prefer independent tasks and short chains. Parallel edits get a workspace each (their own
branches); two agents in one workspace only for reading, or work in files that don't overlap. Tell the user the plan
in a few lines before you start workers.

## Each worker's prompt

Write it for a colleague who hasn't seen this conversation: the task id and goal, the files it may change and the ones
it must not, how to check it (the commands), what it needs from tasks before it, not to widen the scope nor undo
others' work, and that its last answer must end with one of these:

    LAKI_WORKER_DONE
    task: <task-id>
    summary: <one line>
    files: <paths, or none>
    checks: <commands and how they went>
    handoff: <what the next task needs, or none>

    LAKI_WORKER_BLOCKED
    task: <task-id>
    reason: <what stops it>
    needs: <a decision, access or another task's result>

## Run and watch

Start every task that's ready before watching any. Then, every minute or two, \`laki ls --json\` and, for each tab that's
idle or waiting, \`laki screen <ws> --lines 200\` (its \`last\` has the answer's start): look for the envelope and check
that what's above it backs it (tests run, files there; \`laki diff <ws>\`). Short passes, not one long blocking loop, so
you can tell the user how it goes in between. A missing or malformed envelope: read the whole screen and ask the worker
(\`laki send <ws> --when-idle\`).

- DONE and checked: done. Hand its handoff to the tasks that wait on it: in their prompt as they start, or sent to one
  that runs.
- BLOCKED: give it what it needs, or ask the user, then send it on.
- A task's turn ended without the envelope, or failed: send it what's missing; start it again only with a changed prompt
  or another agent, and stop after two tries: report it.
- A task is ready when every task it depends on is done.

## Finish

Check the risky or overlapping changes yourself before you report. Then a short report: each task's outcome, its
workspace and branch, files, checks, and the order to merge them; say which of it the workers claimed and which you
checked. Leave the workspaces as they are (the user reviews, ships or archives them) unless asked otherwise.
`

function info(a: SkillAgent, k: SkillName): SkillInfo {
  const at = skillDir(a, k)
  const want = Object.entries(files(at, k))
  const have = want.filter(([f]) => existsSync(join(at, f)))
  const state = !have.length ? 'missing' : have.length === want.length && want.every(([f, t]) => readFileSync(join(at, f), 'utf8') === t) ? 'installed' : 'outdated'
  const launcher = existsSync(join(at, 'laki')) ? readFileSync(join(at, 'laki'), 'utf8') : ''
  const foreign = state === 'outdated' && /\bLAKI_HOME=/.test(launcher) && !launcher.includes(` ${q(`LAKI_HOME=${dir}`)} `)
  const mcp = k === 'laki' ? mcpCmd(a) : ''
  return { agent: a, skill: k, name: AGENTS[a].name, path: at, state, ...(foreign && { foreign }), mcp, ...(mcp && !AGENTS[a].add && { mcpIn: join('~', AGENTS[a].home, 'opencode.json') }) }
}

// laki's rows first, one per agent, then laki-widget's
export const skills = () => SKILLS.flatMap(k => (Object.keys(AGENTS) as SkillAgent[]).map(a => info(a, k)))

// as the daemon starts: an installed skill that's out of date (a Laki update changed it) is written again; never one
// that isn't there, nor one whose launcher drives another data dir's daemon (another Laki, LAKI_HOME=…)
export function refreshSkills() {
  const ours = q(`LAKI_HOME=${dir}`)
  const launcher = (at: string) => (existsSync(join(at, 'laki')) ? readFileSync(join(at, 'laki'), 'utf8') : '')
  for (const r of skills()) if (r.state === 'outdated' && launcher(r.path).includes(` ${ours} `)) skillSet({ agent: r.agent, on: true, skill: r.skill })
}

// install (or update) a skill (laki unless said) for an agent, or remove it: only our files, and the folder if that
// empties it
export function skillSet(o: { agent: SkillAgent; on: boolean; skill?: SkillName }) {
  if (!Object.hasOwn(AGENTS, o.agent)) throw new Error(`no agent ${o.agent}`)
  const k = o.skill ?? 'laki'
  if (!SKILLS.includes(k)) throw new Error(`no skill ${k}`)
  const at = skillDir(o.agent, k)
  const fs = files(at, k)
  if (o.on) {
    mkdirSync(at, { recursive: true })
    for (const [f, t] of Object.entries(fs)) writeFileSync(join(at, f), t)
    chmodSync(join(at, 'laki'), 0o755)
  } else if (existsSync(at)) {
    for (const f of Object.keys(fs)) rmSync(join(at, f), { force: true })
    if (!readdirSync(at).length) rmdirSync(at)
  }
  return skills()
}
