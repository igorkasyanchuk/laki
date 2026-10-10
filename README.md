# Laki

Run Claude Code, Codex, Gemini, Grok, OpenCode or any command side by side on macOS, each task in its own git
worktree. Agents keep running when the window is closed.

- **Workspaces**: a worktree, branch and `$PORT` per task, with setup and teardown scripts and your `.env` copied in;
  worktrees in a folder you pick, for all projects or one. Start one from a prompt, a GitHub issue or a PR. Plain folders work too.
- **Status**: running, needs you, done (and how far along, by the agent's own estimate), on every tab and row; notifications with a button per choice an agent asks you to make,
  a Dock and menu bar count, floating bubbles over other apps (agents working or waiting, recent ones too; click one to jump there, or say a prompt to one), pushes to your phone (ntfy, Slack, Telegram; answer from them with Telegram's or ntfy's buttons), a follow-up queue and
  messages sent later (in 2h, at 3pm). Agents resume after a
  restart or a usage limit.
- **Race**: one prompt to several agents, a worktree each; compare them side by side and keep the best.
- **Terminals**: tabs and tmux-style splits, kept alive by a daemon; a spinner while a shell runs a command (an agent
  started there shows its own status); an agent you quit keeps its tab, ⏎ resumes it. After a daemon restart or an
  update, shells come back in their folder with what ran there: an agent resumes its chat, a dev server is typed back for ⏎. Terminals in
  your home folder and a browser (any website, sign-ins kept) live in the sidebar too, from + at its top.
- **SSH hosts**: a project on another machine (`devbox:~/code/app`): its worktrees, git, gh and agents run there over
  ssh, with nothing to install; its `$PORT` comes back to localhost for the preview.
- **PRs**: CI and reviews in the status bar (who approved, who asked for changes), sent to the agent if you like; ship (commit, push, PR) in one step; merge
  (squash, merge or rebase), approve or close from the app, or merge when green, each allowed per project; archived once
  merged, if you like.
- **Side panel**: files (Markdown rendered, Mermaid diagrams too; CSV as a table you can edit), the diff (comment on a line; images before and after;
  a Viewed box per file, the same as GitHub's), review threads, and a preview of the dev
  server that sends screenshots or a clicked element (selector, HTML, CSS, a screenshot) to the agent. Agents can
  drive a browser of their own on it (`laki browser`).
- **Artifacts**: a folder per workspace, outside the repo, for what its agents make for you (screenshots, reports) and
  links to what they publish (Claude artifacts, sites, gists: kept on their own as an agent publishes them): counted in the status bar, a gallery of previews (links first,
  opened in the browser), the links in the info panel too.
- **Board, schedules**: every workspace by where it is, to-dos, and prompts that run at times written in English.
- **Remote access**: the whole app from your phone, through a Cloudflare tunnel for your email only (or anyone with the
  link, if you type *confirm*: a red warning says what that risks).
- **Resources**: memory and CPU for Laki and each agent; put an idle agent to sleep (now, or after a while) and it wakes as you
  look; the video, widgets, the preview or the floating bubbles stop with a click.
- **Get started**: the first steps in a window that ticks them as you go, what's left at the sidebar's bottom.
- **Layout**: a rail like Slack's (Projects, Board, Schedule, Terminal, Browser, with what needs you on each) beside a
  list of the one you pick; or one sidebar for everything.
- **Looks**: six Dock icons to pick from; 86 themes, 68 of which change shapes and type too (some after films' and games' screens); glass; your
  accent, corners (every theme's), sidebar lines and rows (compact to cards); tabs on top, bottom, left or right.
- **Widgets**: live tiles in the sidebar (your PRs counted and grouped, your team's PRs, links you open often, or any you make
  with an agent or any AI chat: Settings has the prompt), each fed by a command on a schedule (within working hours, if
  you like), with a full view a click away; their buttons answer with toasts and dialogs.
- **Screenshots to agents**: from the menu bar, drawn on (crop, arrows, text, boxes) with a note, straight to a new
  workspace's prompt.
- **A video while you work**: a YouTube link plays at the bottom of the sidebar.
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
