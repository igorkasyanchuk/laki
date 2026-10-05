# Laki

Run Claude Code, Codex, Gemini, Grok, OpenCode or any command side by side on macOS, each task in its own git
worktree. Agents keep running when the window is closed.

- **Workspaces**: a worktree, branch and `$PORT` per task, with setup and teardown scripts and your `.env` copied in.
  Start one from a prompt, a GitHub issue or a PR. Plain folders work too.
- **Status**: running, needs you, done, on every tab and row; notifications (Allow / Deny on a permission prompt),
  a Dock and menu bar count, pushes to your phone (ntfy, Slack, Telegram), a follow-up queue. Agents resume after a
  restart or a usage limit.
- **Race**: one prompt to several agents, a worktree each; compare them side by side and keep the best.
- **Terminals**: tabs and tmux-style splits, kept alive by a daemon.
- **SSH hosts**: a project on another machine (`devbox:~/code/app`): its worktrees, git, gh and agents run there over
  ssh, with nothing to install; its `$PORT` comes back to localhost for the preview.
- **PRs**: CI and reviews in the status bar, sent to the agent if you like; ship (commit, push, PR) in one step;
  archived once merged, if you like.
- **Side panel**: files (Markdown rendered), the diff (comment on a line; images before and after), review threads, and a preview of the dev
  server that sends screenshots or a clicked element (selector, HTML, CSS, a screenshot) to the agent. Agents can
  drive a browser of their own on it (`laki browser`).
- **Board, schedules**: every workspace by where it is, to-dos, and prompts that run at times written in English.
- **Remote access**: the whole app from your phone, through a Cloudflare tunnel for your email only.
- **Looks**: 86 themes, 68 of which change shapes and type too (some after films' and games' screens); glass.
- **Keyboard and CLI**: ⌘K for everything; `laki` (also an MCP server) drives it all, agents included.

## Install

macOS (Apple silicon or Intel), Node 22.6+, git. Optional: your agents on PATH, and `gh` (logged in) for PRs.

```bash
git clone https://github.com/igorkasyanchuk/laki && cd laki
npm install && npm run pack
open dist/mac-arm64/Laki.app      # Intel: dist/mac; or copy it to /Applications
npm link                          # optional: the laki CLI
```

## Use

1. **⌘O** (or drop a folder) adds a project; one on another machine: ⌘K › *Open a project over SSH…* (`host:path`).
2. Pick an agent, write the task, **Create**: Laki makes the worktree, runs setup, starts the agent.
3. **⌘N** for more; the sidebar shows each one's status. Review in the side panel (**⌥⌘B**), then **Ship**.

```bash
laki new app --prompt "fix the login redirect"        # a worktree with claude on it
laki new app --issue 42 --fan claude,codex           # a GitHub issue, raced by two agents
laki send fix-the-login --when-idle "now add tests"  # typed in when its turn ends
laki ship fix-the-login -m "Fix the login redirect"
```

`laki help` lists every command; **⌘/** shows the keys.

## More

[The guide](docs/guide.md) · [Requirements](requirements/README.md) · [AGENTS.md](AGENTS.md) (how the code works)

[MIT](LICENSE) © 2026 Igor Kasyanchuk
