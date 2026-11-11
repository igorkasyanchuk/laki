<p align="center"><img src="src/renderer/src/icon.svg" width="64" alt=""></p>

<h1 align="center">Laki</h1>

<p align="center"><b>Run a dozen coding agents at once without losing track: Laki shows which one needs you, checks
what each did, and gets it merged.</b><br>
Claude Code · Codex · Gemini · Grok · OpenCode · any command · macOS (Linux preview) · MIT · <a href="https://laki.sh">laki.sh</a></p>

### One inbox for every agent

*Needs you* lists each agent that asks, with its choices as buttons; *Allow all* answers the same ask from several at
once, and ⌘J jumps to the next.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/needs-you-dark.png">
  <img src="docs/img/needs-you-light.png" alt="Needs you: two agents asking to run a command, each with Yes, Yes and don't ask again, and No as buttons; Allow all (2) above them" width="900">
</picture>

### Done means checked

As an agent finishes, your lint and test scripts (and, if you like, a second agent's review) run; a failure goes back
to the agent with its output. Collision radar flags two worktrees changing the same lines while both can still adjust.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/check-radar-dark.png">
  <img src="docs/img/check-radar-light.png" alt="A workspace whose test failed after the agent's turn: lint passed, test failed, sent back to claude (try 1 of 3); its sidebar row shows the radar's conflict mark" width="900">
</picture>

### Close the window, answer from your phone

A daemon holds the terminals: agents keep working with the window closed and come back after a restart or a plan
limit. Remote access opens the same inbox on your phone, over Cloudflare or Tailscale.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/phone-dark.png">
  <img src="docs/img/phone-light.png" alt="Laki on a phone-sized screen: Needs you with two agents' questions and their answer buttons" width="300">
</picture>

## What is different

- **One next step per workspace**: its ⋯ says what it needs now (an answer, a review, failing CI, a merge), and ⌘G does
  it.
- **Done check**: your scripts and a second agent's review run as each agent finishes; a failure goes back to it, three
  times at most, then to you.
- **Collision radar**: two worktrees changing the same lines are flagged while the agents work, not on merge day.
- **Agents outlive the window**: quit it, restart Laki or hit a plan limit, and they keep running or resume; *Auto
  fallback* moves a tab at its limit to your next account.
- **No account, MIT, your data stays local**: no sign-up and no telemetry; your agents run signed in as you.
  [What Laki sends, and to whom](docs/trust.md).

| | Laki | Agents in terminal tabs (tmux, iTerm) |
|---|---|---|
| A git worktree per task | Made, set up and cleaned up for you | By hand (`git worktree add`) |
| Any CLI agent | Claude Code, Codex, Gemini, Grok, OpenCode, any command | Any |
| A second agent checks the work | Done check, as each turn ends | No |
| Conflicts between parallel tasks | Collision radar, while they work | At merge |
| Account needed | None | None |
| Platforms | macOS 13+; Linux (preview); Windows through WSL 2 | Any |

Everything else (themes, extensions, workflows, scheduled prompts, the CLI and its MCP server):
[docs/features.md](docs/features.md).

## Install

macOS 13 or later. Download the dmg from [the latest release](https://github.com/igorkasyanchuk/laki-releases/releases/latest)
(signed and notarized), or:

```bash
brew install --cask igorkasyanchuk/laki/laki    # then: brew upgrade --cask laki
```

You need git and the agents you use on your PATH; `gh` (signed in) for pull requests. Building it yourself, Linux and
Windows (WSL 2): [docs/install.md](docs/install.md).

## Use

1. **⌘O** (or drop a folder on the window or the Dock icon) adds a project.
2. Pick an agent, write the task, **Create**: Laki makes the worktree, runs setup, starts the agent.
3. **⌘N** for more. Review in the side panel (**⌥⌘B**), then **Ship**.

```bash
laki new app --prompt "fix the login redirect"        # a worktree with claude on it
laki new app --issue 42 --fan claude,codex           # a GitHub issue, raced by two agents
laki new app --no-setup --perm acceptEdits --prompt "…"  # no setup script; it edits without asking
laki send fix-the-login --when-idle "now add tests"  # typed in when its turn ends
laki ship fix-the-login -m "Fix the login redirect"
```

`laki help` lists every command; **⌘/** shows the keys.

## Docs

| | |
|---|---|
| [Features](docs/features.md) | Everything Laki does, a few lines each |
| [Guide](docs/guide.md) | How each part works: workspaces, agents, reviews, PRs, keys, the CLI, settings |
| [Install & build](docs/install.md) | The dmg, Homebrew, building it yourself, Linux and Windows (WSL 2), troubleshooting |
| [Extensions](docs/extensions.md) | The SDK: widgets for the sidebar, bars and My Desk, the UI kit, events, tools for agents |
| [Headless](docs/headless.md) | Laki on a server with no screen, in your browser |
| [Trust](docs/trust.md) | No account, no telemetry: what stays on your Mac, every host Laki connects to, how to verify the build, who maintains it |
| [Security](SECURITY.md) | The threat model, known limits, how to report a vulnerability |
| [Release notes](docs/release-notes.md) | What changed in each version |
| [Contributing](CONTRIBUTING.md) | Build, test, the demo world, the rules; [AGENTS.md](AGENTS.md): how the code works |

## License

[MIT](LICENSE) © 2026 Igor Kasyanchuk
