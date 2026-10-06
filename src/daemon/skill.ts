// The agent skill: SKILL.md and a launcher for the CLI in each agent's skills folder (~/.claude/skills/laki,
// ~/.codex/…, ~/.gemini/…, ~/.grok/…, ~/.config/opencode/…), so their sessions know laki and can drive it. Written
// only when the user asks (Settings).
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { USAGE } from '../shared/usage.ts'
import { cliArgv, cliEnv, dir, q } from './core.ts'

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
// mcp: what adds Laki as the agent's MCP server, which the user runs or pastes (we never write the agents' config):
// a command, or for opencode (its `mcp add` only asks questions) the lines for mcpIn, its config file
export type SkillInfo = { agent: SkillAgent; name: string; path: string; state: 'missing' | 'installed' | 'outdated'; mcp: string; mcpIn?: string }

const skillDir = (a: SkillAgent) => join(homedir(), AGENTS[a].home, 'skills', 'laki')
const mcpArgv = () => ['/usr/bin/env', ...cliEnv, `LAKI_HOME=${dir}`, ...cliArgv, 'mcp']
const mcpCmd = (a: SkillAgent) =>
  AGENTS[a].add ? `${AGENTS[a].add} ${mcpArgv().map(q).join(' ')}` : JSON.stringify({ mcp: { laki: { type: 'local', command: mcpArgv() } } }, null, 2)

// the files, as they'd be written now: the launcher holds this install's paths
function files(at: string): Record<string, string> {
  const cli = join(at, 'laki')
  return {
    'laki': `#!/bin/sh\n# the laki CLI, for agents (written by laki: Settings → Agent skill)\nexec /usr/bin/env ${[...cliEnv, `LAKI_HOME=${dir}`, ...cliArgv].map(q).join(' ')} "$@"\n`,
    'SKILL.md': `---
name: laki
description: Drive Laki, the desktop app that runs coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in its own git worktree. Use it to list projects and workspaces, start a new workspace with an agent and a prompt, open tabs, message an agent or read its screen, see a workspace's diff, run its dev server or ship it as a PR, and schedule prompts for later or on repeat (every weekday at 9am…). Use when the user asks to start, hand off, parallelize, schedule or check work in Laki.
---

# Laki

Laki runs each task in a **workspace**: a git worktree on its own branch (\`laki/<id>\`), or the repo itself
(\`--local\`), with tabs for agents (claude, codex, gemini, grok, opencode), shells and a dev server. A **project** is a repo (or a
folder) added to Laki. The app shows all of it live; the CLI drives the same daemon.

Run the CLI through this launcher (an absolute path: it works from any shell; keep the quotes):

    "${cli}"

For example \`"${cli}" ls --json\`. Below, \`laki\` stands for it.

## Where you are

Inside a Laki tab, \`$LAKI_APP\` is \`true\`, \`$LAKI_HOME\` is set, \`$LAKI_WORKSPACE\` is your workspace's id,
\`$LAKI_TAB\` your tab's and \`$PORT\` the workspace's port. Outside Laki they're unset. A tab with
\`$LAKI_GO_HOME\` instead is Laki Go's: use the laki-go skill there, not this one.

## Commands

\`\`\`
${USAGE}
\`\`\`

## Start work

1. \`laki ls --json\`: the projects (ids), workspaces (id, branch, path) and tabs with their status.
2. \`laki new <project> --prompt "<task>" [--preset claude|codex|gemini|grok|opencode] [--name short-name] [--base <branch>]\`:
   a new worktree on a new branch, set up by the project's setup script, with the agent started on the
   prompt. \`--local\` works in the repo itself; \`--preset shell\` or \`none\` starts no agent; \`--model\` and
   \`--effort\` pick the agent's (blank: its own).
3. Check on it: \`laki screen <ws>\` (the agent's screen), \`laki ls --json\` (running, waiting for a
   permission, idle).
4. Follow up: \`laki send <ws> "<text>"\`, or \`--when-idle\` to queue it for when the agent's turn ends.

Write prompts as for a new colleague: the goal, where to look, how to tell it's done. Independent tasks: one
workspace each, so they run in parallel.

A project can be on an SSH host (\`laki project add devbox:~/code/app\`; \`laki ls\` shows \`host:path\`): its
workspaces' paths are on that machine, not this one, so read their work with \`laki diff\` and \`laki screen\`, not
from the disk here. Its agents run there and have no \`laki\`.

- From a GitHub issue: \`laki new <project> --issue <url|number>\` (its title and text become the prompt; a
  \`--prompt\` adds to it).
- On a GitHub PR: \`laki new <project> --pr <url|number> --prompt "…"\` (a worktree on the PR's branch, a fork's
  too, named after it).
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
  has its own name.
- \`laki schedule\` lists them (id, next run), \`laki schedule log\` the last runs; \`on\`, \`off\`, \`run\` (now)
  and \`rm\` take an id.

## Recipes

\`jq\` ships with macOS.

    # the tabs waiting for an answer (a permission prompt)
    laki ls --json | jq -r '.tabs[] | select(.status == "waiting") | "\\(.workspace)/\\(.name)"'
    # wait for a workspace's agents to finish their turn
    while laki ls --json | jq -e '.tabs[] | select(.workspace == "<ws>" and .status == "running")' >/dev/null; do sleep 10; done

## Rules

- Ask the user before \`rm\`, \`archive\`, \`ship\` or \`stop\`: they end agents, delete worktrees or push.
- Schedule a task only when the user asks for one: it starts agents later, unattended. Say when it first runs.
- \`<ws>\` is a workspace id; \`<ws>/<tab>\` picks a tab (by default the agent's).
- Don't type into a busy agent unless asked: use \`send --when-idle\`.
- The CLI talks to the Laki daemon over localhost. In a sandbox that blocks that, ask to run it outside.
- \`unknown method\`: the running daemon is older than the CLI. Ask the user to restart it (the app's status
  bar offers it; agents resume).
`,
  }
}

function info(a: SkillAgent): SkillInfo {
  const at = skillDir(a)
  const want = Object.entries(files(at))
  const have = want.filter(([f]) => existsSync(join(at, f)))
  const state = !have.length ? 'missing' : have.length === want.length && want.every(([f, t]) => readFileSync(join(at, f), 'utf8') === t) ? 'installed' : 'outdated'
  return { agent: a, name: AGENTS[a].name, path: at, state, mcp: mcpCmd(a), ...(!AGENTS[a].add && { mcpIn: join('~', AGENTS[a].home, 'opencode.json') }) }
}

export const skills = () => (Object.keys(AGENTS) as SkillAgent[]).map(info)

// install (or update) the skill for an agent, or remove it: only our files, and the folder if that empties it
export function skillSet(o: { agent: SkillAgent; on: boolean }) {
  if (!Object.hasOwn(AGENTS, o.agent)) throw new Error(`no agent ${o.agent}`)
  const at = skillDir(o.agent)
  const fs = files(at)
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
