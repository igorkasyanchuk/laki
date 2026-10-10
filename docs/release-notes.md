<!-- Laki's release notes, shown in Settings › Release notes. Newest first. Each user-visible addition: a line under
"## Next" (add that heading above the newest version if it isn't there). `npm run dmg` turns "## Next" into the
version it builds, with the date. -->

## Next

- **Laki AI** (optional, Settings › AI): ask in plain words, or paste a screenshot of PR links, and it works Laki for
  you: starts workspaces (PR reviews in their own worktrees), opens agent tabs, sends prompts, attaches PRs, schedules
  tasks and tells you what your agents are doing. It runs on OpenRouter with your API key, or on `claude -p` /
  `codex exec`, and never archives, deletes, ships or merges.
- **AI page**: a chat like Claude's (⏎ asks, the tools it ran folded into a line), the workspaces and tabs it names as
  links that open them, a Calls tab with every ask's tokens, cost and time, and an Info tab with how it runs and is paid
  for and what it spent today and this month. Also `laki ai` in a terminal.
- **Laki AI on your agent presets**: a claude or codex preset (its env: another account) as the AI's backend.
- **Ask Laki AI from the bubbles**: the floating bubbles' + (with Laki AI on) opens the AI chat in a small window over
  any app.
- **Release notes** in Settings: this page.
- **Themes, easier to read**: every theme checked for contrast; links and picked items in a light theme's accent read
  on the page, status marks, the terminal's colors and dim text show in all 86, and a few looks have new fonts (Geist,
  IBM Plex Sans, Roboto, Manrope, Source Sans 3, Fira Sans).
- **More interface fonts**: Geist, IBM Plex Sans, Roboto, Source Sans 3, Fira Sans and Manrope, and the developer
  fonts Geist Mono, IBM Plex Mono, Fira Code, Cascadia Code, Source Code Pro and Roboto Mono (Settings › Appearance).
- **Resources counts everything Laki runs**: Laki AI's agent, tunnels, remote access, SSH connections and widgets'
  fetches each get a row (Stop ends the AI's answer, a tunnel or remote access).
- **Find a theme by game or film**: *winamp*, *halo*, *fallout*, *star wars*… in Settings › Appearance's theme finder.
- **12 new themes after games and films**: Llama Amp (a 1998 music player), Spartan (a power-armour HUD), Vault
  Dweller (a wrist computer's green screen), Overworld (a block world), Rip & Tear (hell's red), Warp Pipe (a plumber's
  sky), Power Pellet (a maze arcade), Hyperspace (a space opera), Spice (a desert planet), Outatime (a time machine),
  Grand Hotel (a pink mountain hotel) and Replicant (orange smog), each with its own look.
- **The rail only**: *One sidebar* is gone from Settings › Appearance; the rail's *Labels* switch stays (a phone still has
  its one drawer).
- **Tabs named by their task**: another agent tab in a workspace is named by its prompt's first words (`claude: fix
  the cart total`), or by the first prompt you type in it; a name you give it stays.
- `laki_send` (MCP's and the AI's) reaches agents only, never a shell or a question an agent asks you; new MCP tools
  `laki_new_tab` and `laki_attach_pr`.
- **PR review**: Viewed boxes in Changes (synced with GitHub), who approved or asked for changes.
- **Artifacts**: links your agents publish are kept with the workspace, first in the gallery and in the info panel.
- **Shells come back** after a restart with what ran in them; an ended agent keeps its tab.
- **New workspace window**: the bubbles' + menu (New task, Say it, screenshots) opens the page over any app.
- Glass that shows the desktop, terminal padding, a wider screenshot editor, a filterable picker look.

## 0.9.0 · Oct 9, 2026

- **Rail layout** by default: Projects, Board, Schedule, Terminals and Browsers on a narrow rail, like Slack.
- **A composer for new workspaces**: the prompt first, agent, model and effort as pickers, the rest as chips.
- A compact **Scheduled tasks** page.
- ⌘W / ⌘T in browser pages; groups from a workspace's menu (*Move to group*).
- A hard-to-miss **Restart Laki's daemon** bar when the daemon is older than the app.

## 0.8.0 · Oct 8, 2026

- **Get started**: the first steps, ticked as you do them.
- **Terminals and Browsers** in the sidebar: plain shells and web pages as workspaces, browser tabs of their own.
- A spinner while a shell runs a command; drag projects to reorder them.
- Bubble cards that work; six Dock icons.
- Remote access without an email (anyone with the link, after a typed confirm).
- Shift+Enter makes a new line in every tab; Claude started in a terminal tab is tracked too.

## 0.7.0 · Oct 8, 2026

- A release build of 0.6.0's work.

## 0.6.0 · Oct 8, 2026

- **Floating bubbles**: recent sessions, + Session and a voice prompt, three new styles.
- A workspace's **hover card**: state, last answer, PR, checks.
- PRs an agent names are linked to its workspace.
- Timer messages, nicer PR buttons, a resizable info panel, drafts that survive closing, ⌘-click file links.

## 0.5.0 · Oct 8, 2026

- **Merge from the app**, and **merge when green**; PR permissions per project.
- **Answers from notifications and the phone**: Allow / Deny, a menu's choices.
- **Send later**; a worktrees folder of your choice; Stop in Resources; corners for every theme.
- Mac editing keys in the terminal; floating bubbles; group templates.

## 0.4.0 · Oct 7, 2026

- **CSV editor** and **Mermaid** diagrams in the preview.
- **Agent progress**: how far along an agent is, on its tab.
- Sidebar styles, a screenshot editor, widget toasts and dialogs, working hours, development logs.

## 0.3.0 · Oct 7, 2026

- **Resources**: memory and CPU by tab, and idle agents put to sleep.
- The Team PRs widget's review command.

## 0.2.0 · Oct 7, 2026

- **Widgets** in the sidebar; **groups** of workspaces; VS Code-style pane drag; a Review tab; Help's contents; dmg builds.
- Actions (duplicate, filter, any agent); PRs named and linked from prompts; Approve / Close PR.
- The new-workspace page; sidebar video, timers, separators, file editing, more looks and fonts.
- **Projects over SSH**; pinned workspaces; phone pushes; archive when a PR merges; start a workspace from a PR;
  `.env` and other ignored files copied into new worktrees; image diffs; the menu bar item; a meme button.

## 0.1.0 · Oct 5, 2026

- **The first Laki**: coding agents (Claude Code, Codex, Gemini, Grok, OpenCode) side by side, each task in its own
  git worktree, with tabs, splits, a status bar, a side panel (files, changes, review) and a preview.
- PR auto-fix (CI, reviews, conflicts), races and Compare, the Board, scheduled tasks, remote access from a phone,
  plan limits, an MCP server, `laki://` links, themes, the agent skill and the `laki` CLI.
