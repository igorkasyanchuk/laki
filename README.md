# Laki

Run Claude Code, Codex, Gemini, Grok, OpenCode or any command side by side on macOS, each task in its own git
worktree. Agents keep running when the window is closed.

- **Workspaces**: a worktree, branch and `$PORT` per task, with setup and teardown scripts (a repo's `.laki.json` once you trust it) and your `.env` copied in;
  worktrees in a folder you pick, for all projects or one. Start one from a prompt, a GitHub issue or a PR, with the
  agent's model, effort, permission mode (auto, accept edits, plan, bypass) and fast mode picked under the prompt. Plain folders work too.
- **Status**: running, needs you, done (and how far along, by the agent's own estimate), on every tab and row; notifications with a button per choice an agent asks you to make,
  a Dock and menu bar count, floating bubbles over other apps (agents working or waiting, recent ones too; click one to jump there, or say a prompt to one), pushes to your phone (ntfy, Slack, Telegram; answer from them with Telegram's or ntfy's buttons), a follow-up queue and
  messages sent later (in 2h, at 3pm; to Laki AI too). Agents resume after a
  restart or a usage limit.
- **Projects**: a page each (a click on its name): notes, scheduled tasks, memory (yours and what agents learned, 50 each, given to Claude and Codex at every start) and its
  settings.
- **Specs & Brainstorms**: write what to build like a Notion page (checklists, images, diagrams), from
  your own templates, then start a workspace from it; or brainstorm an idea with Laki AI in a chat beside it, which writes
  options, a mind map, diagrams and clickable prototypes. Both in one list, filtered by kind, and *New* ▾ for either.
  Folders outside the repo that any agent can read.
- **Workflows**: blocks Laki runs for a task, drawn on a canvas or written as Markdown (say, a plan you
  approve, the build, tests until they pass, a PR, CI until green). Blocks can call a model on OpenRouter or a webhook,
  ask a decision model yes/no, choice or score questions (a way out per answer, or asking you when it isn't sure),
show you what a run made (a window, a popover in the corner, a macOS notification), and name outputs (`{{steps.sum.title}}`) the next blocks use; your own
variables (`{{vars.REPO}}`), a workflow's or global. A schedule can start one, and Laki AI makes or changes one with
you. Each run keeps its decisions and log: run it again, or again from any block; a run in a workspace you have, its
worktree archived when it's done, each agent block's permission mode, a deleted one in the trash for 30 days,
`laki flow check` for a repo's CI, and each workflow's runs at a glance (one failing by itself 5 times pauses;
`laki flow on` turns it on again). Six templates to start from (fix CI, review a PR, feature to PR…), and a try as if
on an event, the last one or a sample (`laki flow run --event`), questions answered from the phone, and a budget of
time and AI money per run (`budget: 60 min, $5`).
- **Agents & profiles, accounts**: each agent's profiles (model, effort, account, flags, env), and more than one Claude
  Code or Codex sign-in: a default for new sessions, each account's plan limits, a tab restarted on another account
  with its chat. Actions, templates and scheduled prompts take `{{branch}}`, `{{path}}`, `{{pr}}` and more.
- **Race**: one prompt to several agents, a worktree each; compare them side by side and keep the best.
- **Terminals**: tabs and tmux-style splits, kept alive by a daemon; their dev servers' ports in the status bar (not
  what an agent listens on itself, like its browser bridge or a browser it tests in); a spinner while a shell runs a command (an agent
  started there shows its own status); an agent you quit keeps its tab, ⏎ resumes it. After a daemon restart or an
  update, shells come back in their folder with what ran there: an agent resumes its chat, a dev server is typed back for ⏎. Terminals in
  your home folder and a browser (any website, sign-ins kept, Google's too) live in the sidebar too, from + at its top. A tab floats
  out in a window of its own, over every app (its right click › *Float in its own window*). Run ▾ runs the project's
  test, lint, format and deploy scripts, each in a tab.
- **SSH hosts**: a project on another machine (`devbox:~/code/app`): its worktrees, git, gh and agents run there over
  ssh, with nothing to install; its `$PORT` comes back to localhost for the preview.
- **PRs**: CI and reviews in the status bar (who approved, who asked for changes) and at a glance in the sidebar
  (<img src="docs/icons/pr-open.svg" width="13" alt="GitHub's mark"> its state,
  <img src="docs/icons/approved.svg" width="13" alt="✓"> approved, <img src="docs/icons/approved-you.svg" width="13" alt="✓✓"> by you
  too, 👀 you commented), sent to the agent if you like; a failing check's log a click away; ship (commit, push, PR) in one step; merge
  (squash, merge or rebase), approve or close from the app, or merge when green, each allowed per project; archived once
  merged, if you like. Each shows its author's picture (yours too); ⌘K and the sidebar's filter find a workspace by its PR's
  number, and a right click on the PR in the status bar copies its link or `#number`.
- **Side panel**: files (Markdown rendered, Mermaid diagrams too; CSV as a table you can edit), the diff (one column or two side by side; comment on a line; images before and after;
  a Viewed box per file, the same as GitHub's; revert a hunk, picked lines or a whole file, with Undo), review threads, and a preview of the dev
  server that sends screenshots or a clicked element (selector, HTML, CSS, a screenshot) to the agent. Agents can
  drive a browser of their own on it (`laki browser`). The Simulator (Settings › Simulators turns it on and checks what
  this Mac has, and starts and stops its iPhones, iPads and Android emulators): one live in the panel, a click to tap,
  a drag to swipe, your keyboard to type, a screenshot into the agent's prompt; a device per workspace, or floated over
  every app.
- **Artifacts**: a folder per workspace, outside the repo, for what its agents make for you (screenshots, reports; in
  folders of their own, which you open and back out of) and links to what they publish (Claude artifacts, sites, gists:
  kept on their own as an agent publishes them; a page an agent made elsewhere on this Mac too, as a `file:///` link): counted in the status bar, a gallery of previews (links first,
  opened in the browser) a click away, each big in a click, copied with a right click (the file itself, a picture as a picture), in Finder or the side panel's Files too, the links in the info panel.
- **Board, schedules**: every workspace by where it is, to-dos, and prompts that run at times written in English.
- **Share a tab**: right click › *Share live view*: an agent's chat (or a terminal's text) as a live page anyone
  with the link reads, for some hours or until you stop it, with a QR code, and Copy and Download as Markdown.
- **Remote access**: the whole app from your phone, through a Cloudflare tunnel for your email only; or with Laki's own
  PIN instead (shown on your Mac, a new one each time; a wrong one, twice unless you pick otherwise, stops it); or for
  anyone with the link, if you type *confirm* (a red warning says what that risks; 24 hours at most); or through Tailscale, for your
  tailnet's devices only (a PIN too if you like), or with Funnel and a PIN for the internet. Its link opens once, in one tab.
- **Headless**: on a server with no screen, `./Laki.AppImage --headless --tailscale`, and Laki in your browser
  ([docs/headless.md](docs/headless.md)).
- **Resources**: memory and CPU for Laki and each agent, a graph of the last minutes; put an idle agent to sleep (now, or after a while) and it wakes as you
  look; the video, extensions, the preview or the floating bubbles stop with a click.
- **Get started**: the first steps in a window that ticks them as you go, what's left at the sidebar's bottom.
- **Rail**: like Slack's (Projects, Board, Schedule, Terminal, Browser, with what needs you on each) beside a list of
  the one you pick, and up to 5 pins: workspaces in their color, specs and brainstorms.
- **Looks**: six Dock icons to pick from; 100 themes, 82 of which change shapes and type too (some after films' and games' screens); glass; your
  accent, corners (every theme's), sidebar lines and rows (compact to cards); tabs on top, bottom, left or right.
- **Extensions** (widgets or plugins, the same thing): live tiles in the sidebar, the top bar, the status bar or on My Desk, laid out as you drag them (your
  PRs counted and grouped, links you open often, or any you make with Laki AI on the extension's own page, an agent's
  laki-widget skill, or any AI chat: Settings has the prompt; each previewed with made-up data before it runs), or buttons on the rail and in the sidebar's foot (an icon, a label,
  a count, a click that runs something), each fed by a command on a schedule (within working hours, if
  you like), with a full view a click away; their buttons answer with toasts and dialogs; a JS one reaches the web only if you allow it.
  Drawn with the UI kit (60 JSON elements: stats, lists, tables, charts, boards, calendars, chats, PRs, logs, diffs, pipelines, switches, forms; Settings › Extensions › *UI kit*, with its typography, colors and 330+ icons); edit an extension's files right in Laki; its data from a fetch, a file, a URL or an agent with your MCP servers (*sum up Slack since yesterday*, every hour); `laki widget new` starts one from a starter, `laki widget dev` reloads yours as you save, `laki widget check` says what's wrong; one can be per workspace (its branch, its server, its PR), answer events (a turn done, a PR's checks failing), stream, take `laki widget push`, or give your agents tools (asked first). With Laki AI, the studio makes one from a sentence, on sample data, with Undo and *Try it live*. The SDK: [docs/extensions.md](docs/extensions.md).
- **Screenshots to agents**: from the menu bar, drawn on (crop, arrows, text, boxes) with a note, straight to a new
  workspace's prompt. Agents take their own of the iOS Simulator or any app's window (`laki screen shot`), and with
  idb tap, swipe and type in the simulator to check what they built.
- **A video while you work**: a YouTube link plays at the bottom of the sidebar.
- **Laki AI** (optional): ask in plain words, or paste a screenshot of PR links, and it starts workspaces, reviews
  PRs, sends prompts, tells you what your agents are doing and makes extensions (saved off until you turn them on); with Laki's skill it also
  lists your PRs and others', runs your actions and templates, keeps a project's notes and memory, and asks you with options when unsure (it
  removes something only when you press Yes); a chat button on every page that knows what you're looking at; timers, reminders and messages for later on request;
  on OpenRouter or claude -p / codex exec, every ask's cost logged (shown or hidden).
- **Keyboard and CLI**: ⌃⌥⌘L brings Laki forward from any app, ⌘K for everything, ⌘⇧⏎ a tab full screen, ⌘+ / ⌘− one tab's text size, ⌘L send later; `laki` (also an MCP server) drives it all, agents included.

## Install

macOS (Apple silicon or Intel). Optional: your agents on PATH, and `gh` (logged in) for PRs.

Download the dmg for your Mac from [the latest release](https://github.com/igorkasyanchuk/laki-releases/releases/latest)
(signed and notarized: a double-click opens it), or with Homebrew:

```bash
brew install --cask igorkasyanchuk/laki/laki    # then: brew upgrade --cask laki
```

Or build it (Node 22.12+, git):

```bash
git clone https://github.com/igorkasyanchuk/laki && cd laki
npm install && npm run pack
open dist/mac-arm64/Laki.app      # Intel: dist/mac; or copy it to /Applications
npm link                          # optional: the laki CLI (or Settings › General › Developer › Install the laki command)
```

Linux and Windows (WSL 2), a preview: `npm run pack:linux` builds `dist/linux/Laki-<version>-<arch>.AppImage` in Docker
and tests it there (`ARCH=x64` for Intel/AMD); [the guide](docs/guide.md#linux-and-windows-through-wsl) says how to run it.

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

[The guide](docs/guide.md) · [Requirements](requirements/README.md) · [AGENTS.md](AGENTS.md) (how the code works) ·
[Releasing](docs/manual-release.md) (every platform from your Mac: `npm run release`) ·
[Security](SECURITY.md) (how to report a vulnerability, what Laki calls)

[MIT](LICENSE) © 2026 Igor Kasyanchuk
