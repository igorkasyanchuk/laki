# Laki

**Run Claude Code, Codex, Gemini, Grok, OpenCode, or any terminal command side by side on macOS. Each task gets its own git worktree.**

Give each task its own workspace (a branch and a folder), start an agent in it with a prompt, and keep working
while it runs. Laki shows which agents are working, which are waiting for you and which are done. Agents keep
running when you close the window.

## Features

- **Parallel agents.** One worktree and branch per task, with setup and teardown scripts and a `$PORT` of its
  own. A plain folder works too.
- **Live status.** Each agent shows as running, waiting for you or done, with notifications and a follow-up
  queue, and a count on the Dock icon. Agents resume after a restart and pick up again after a usage limit. Pick
  a model and effort per workspace; turn timers if you like.
- **Real terminals.** Tabs and panes, tmux style: drag a tab to split. The daemon keeps them alive while the
  app is closed. ⌘F finds text in a terminal.
- **Scheduled tasks.** Give an agent a prompt to run at times you write in plain English, like *every day at
  2am except weekends*. Each run uses a new worktree, the project's own folder, or an agent already running.
  Names can carry the run's date (`Nightly {{DD-MM}}`), and a log lists every run.
- **Board.** Every workspace as a card by where it is: running, needs you, done, PR open, merged. To-dos wait
  there until you start a workspace on one.
- **PRs and git.** The status bar shows the workspace's PR and its CI. Switches send failing CI or new review
  comments to the agent. Ship commits, pushes and opens a PR in one step. You can fork a workspace, archive
  it and restore it.
- **Side panel.** Files, changes against the base branch (click a line to comment on the PR or tell the
  agent), review threads, and a browser preview of the dev server that sends screenshots, or the CSS selector of an element you click, to the agent. ⌘P
  finds a file.
- **Dev servers and ports.** ▷ Run starts the project's run script. Laki lists the ports that are listening:
  click one to open it, or share it with a public link and QR code.
- **Remote access.** Use the whole app from your phone or another computer, through a Cloudflare tunnel that
  only lets in your email. It lasts 1 to 24 hours, or until you stop it.
- **Plan limits.** A ring shows how much of your Claude and Codex plans you've used, and when each limit
  resets.
- **Your look.** 76 themes, 58 of which also change shapes and type. Glass mode makes the window
  see-through. Fonts are built in.
- **Notifications your way.** Pick which turns notify and the sound; mute a workspace or a tab.
- **Keyboard first.** ⌘ shortcuts, a ⌘K palette, a key for every menu item, and a `laki` CLI that the agents
  themselves can use, also as an MCP server (`laki mcp`). `laki://` links open a workspace or a tab.

## Install

You need macOS on Apple silicon, Node 22.6+ and git. Optional: the agents you use on your PATH (`claude`, `codex`,
`gemini`, `grok`, `opencode`), and `gh` (logged in) for PRs.

```bash
git clone https://github.com/igorkasyanchuk/laki && cd laki
npm install
npm run pack                      # builds dist/mac-arm64/Laki.app
open dist/mac-arm64/Laki.app      # or copy it to /Applications
npm link                          # optional: the laki CLI on your PATH
```

## Quick start

1. Press **⌘O** (or drop a folder on the window) to add a project.
2. Pick an agent, type what it should do, and press **Create**. Laki makes a worktree, runs the setup script
   and starts the agent.
3. Add more workspaces with **⌘N**. They all run at once, and the sidebar shows each one's status.
4. When one is done, review it in the side panel (**⌥⌘B**), then **Ship** it as a PR.

## Keys

| key | |
|---|---|
| ⌘K | palette: every action, workspace and tab |
| ⌘O / ⌘N | add a project / new workspace |
| ⌘T / ⌘W | new shell tab / close tab |
| ⌘1…⌘9, ⌘↑ / ⌘↓ | switch tabs, switch workspaces |
| ⌥⌘B / ⌘P / ⌘F | side panel / find a file / find in the terminal |
| ⌘, / ⌘/ | settings / help |

## CLI

```bash
laki new app --prompt "fix the login redirect"        # a worktree with claude working on it
laki ls                                              # projects, workspaces, tabs, status
laki send fix-the-login --when-idle "now add tests"  # typed in when its turn ends
laki schedule add app --when "weekdays at 9am" "triage new issues"
laki ship fix-the-login -m "Fix the login redirect"
claude mcp add -s user laki -- laki mcp              # Laki's tools for any MCP client
```

Run `laki help` for every command. Settings › Agent skill teaches Claude Code, Codex, Gemini, Grok and OpenCode to use it too.

## More

- [The full guide](docs/guide.md): every feature, all settings, the CLI, where data is kept, troubleshooting.
- [Requirements](requirements/README.md): what Laki is for and where it's going.
- [AGENTS.md](AGENTS.md): how the code works, for anyone (or any agent) changing it.

## License

[MIT](LICENSE) © 2026 Igor Kasyanchuk
