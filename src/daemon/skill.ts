// The agent skill: SKILL.md and a launcher for the CLI in ~/.claude/skills/laki and ~/.codex/skills/laki, so
// Claude Code and Codex sessions know laki and can drive it. Written only when the user asks (Settings).
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { USAGE } from '../shared/usage.ts'
import { cliArgv, cliEnv, dir, q } from './core.ts'

const AGENTS = { claude: { name: 'Claude Code', home: '.claude' }, codex: { name: 'Codex', home: '.codex' } }
export type SkillAgent = keyof typeof AGENTS
export type SkillInfo = { agent: SkillAgent; name: string; path: string; state: 'missing' | 'installed' | 'outdated' }

const skillDir = (a: SkillAgent) => join(homedir(), AGENTS[a].home, 'skills', 'laki')

// the files, as they'd be written now: the launcher holds this install's paths
function files(at: string): Record<string, string> {
  const cli = join(at, 'laki')
  return {
    'laki': `#!/bin/sh\n# the laki CLI, for agents (written by laki: Settings → Agent skill)\nexec /usr/bin/env ${[...cliEnv, `LAKI_HOME=${dir}`, ...cliArgv].map(q).join(' ')} "$@"\n`,
    'SKILL.md': `---
name: laki
description: Drive Laki, the desktop app that runs coding agents (Claude Code, Codex) side by side, each task in its own git worktree. Use it to list projects and workspaces, start a new workspace with an agent and a prompt, open tabs, message an agent or read its screen, and see a workspace's diff, run its dev server or ship it as a PR. Use when the user asks to start, hand off, parallelize or check work in Laki.
---

# Laki

Laki runs each task in a **workspace**: a git worktree on its own branch (\`laki/<id>\`), or the repo itself
(\`--local\`), with tabs for agents (claude, codex), shells and a dev server. A **project** is a repo (or a
folder) added to Laki. The app shows all of it live; the CLI drives the same daemon.

Run the CLI through this launcher (an absolute path: it works from any shell; keep the quotes):

    "${cli}"

For example \`"${cli}" ls --json\`. Below, \`laki\` stands for it.

## Where you are

Inside a Laki tab, \`$LAKI_HOME\` is set, \`$LAKI_WORKSPACE\` is your workspace's id,
\`$LAKI_TAB\` your tab's and \`$PORT\` the workspace's port. Outside Laki they're unset. A tab with
\`$LAKI_GO_HOME\` instead is Laki Go's: use the laki-go skill there, not this one.

## Commands

\`\`\`
${USAGE}
\`\`\`

## Start work

1. \`laki ls --json\`: the projects (ids), workspaces (id, branch, path) and tabs with their status.
2. \`laki new <project> --prompt "<task>" [--preset claude|codex] [--name short-name] [--base <branch>]\`:
   a new worktree on a new branch, set up by the project's setup script, with the agent started on the
   prompt. \`--local\` works in the repo itself; \`--preset shell\` or \`none\` starts no agent.
3. Check on it: \`laki screen <ws>\` (the agent's screen), \`laki ls --json\` (running, waiting for a
   permission, idle).
4. Follow up: \`laki send <ws> "<text>"\`, or \`--when-idle\` to queue it for when the agent's turn ends.

Write prompts as for a new colleague: the goal, where to look, how to tell it's done. Independent tasks: one
workspace each, so they run in parallel.

## Recipes

\`jq\` ships with macOS.

    # the tabs waiting for an answer (a permission prompt)
    laki ls --json | jq -r '.tabs[] | select(.status == "waiting") | "\\(.workspace)/\\(.name)"'
    # wait for a workspace's agents to finish their turn
    while laki ls --json | jq -e '.tabs[] | select(.workspace == "<ws>" and .status == "running")' >/dev/null; do sleep 10; done

## Rules

- Ask the user before \`rm\`, \`archive\`, \`ship\` or \`stop\`: they end agents, delete worktrees or push.
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
  return { agent: a, name: AGENTS[a].name, path: at, state }
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
