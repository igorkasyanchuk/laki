<!-- Laki's release notes, shown in Settings › Release notes. Newest first. Each user-visible addition: a line under
"## Next" (add that heading above the newest version if it isn't there). `npm run dmg` turns "## Next" into the
version it builds, with the date. -->

## Next

- **Pin to the rail**: a workspace's menu puts it (a terminal or a browser too) on the rail below a line, a click away;
  5 at most, with a count when one needs you.
- A workspace's right click has **Run ›**, the toolbar's Run ▾ for it (its script, localhost, your actions), and
  **Move to group ›** is a submenu.
- **Settings › Git & worktrees**: *Sync the base branch* (off by default) fetches it from origin before a new worktree
  starts off it; the branch prefix, the worktrees folder, diff size and archive on merge moved there.
- The new-workspace page starts off the repo's **main branch**, not whatever the repo has checked out; its ⌄ lists every
  branch (the box filtered them by what was in it). Opened for another project than your draft's, it starts empty there.
- **Laki AI** puts a new workspace in the project's group that fits it (a review in *Reviews*); the bubbles' AI window
  is the chat alone, with a cleaner head.

## 0.12.0 · Oct 12, 2026

- **Specs & Brainstorms** (experimental, Settings › General): write a project's requirements like a Notion page
  (checklists, images, diagrams: flowcharts, architecture, ER, screen flows, wireframes), then *Start* a workspace
  from one; or write an idea and *Brainstorm with Laki AI*, which writes options, a mind map, diagrams and clickable
  prototypes beside it. Each is a folder outside the repo with a README.md any agent can read; the rail's *Specs*, a
  project's *Specs* tab, the new-workspace page's *Spec* picker and MCP's `laki_plan_*` tools. The page goes from both
  lists to one kind's to the spec alone, with breadcrumbs back, and full screen (⌘⇧⏎) for writing.
- A brainstorm has its **own chat with Laki AI**, in a panel beside it; unused for 12 hours it ends, and what you type
  next starts a new one (*Continue it* takes it up again).
- **Templates** for specs and brainstorms (New ▾, *Templates*): two come with Laki, *Feature* and *Idea*; a new one
  starts empty unless you pick one.

## 0.11.0 · Oct 11, 2026

- **Linux and Windows through WSL (preview)**: `npm run pack:linux` builds an AppImage in Docker and runs the tests and
  a smoke test against it; the window has the system's title bar, and closing it quits (the daemon and its agents keep
  running). The guide says what to install.
- **The menu bar has Laki's commands**: Laki › Settings… (⌘,), File (new workspace, new tab, open a project,
  go to a file, close tab), Edit › Find…, View (sidebar, info, changes, palette, font size) and Go (the next that
  needs you, previous and next workspace, Board, Scheduled tasks).
- Laki follows macOS's *Increase contrast* (stronger hints and lines), *Reduce transparency* (no glass: the window
  stays solid) and *Reduce motion* (no animations).
- The keyboard's focus is a ring in the theme's accent, and the status bar's and tabs' small buttons are easier to
  hit.
- **Open in** is a submenu in a workspace's and a project's ⋯ menu: hover it, or → / ⏎.
- **Three more colors** for workspaces, groups and tabs: lime, brown and gray.
- **PR marks in the sidebar**: ✓ an open PR approved, ✓✓ approved by you too, 👀 you commented; each can be turned off,
  and they go by the status circle, after the name or with GitHub's mark (Settings › Appearance › Pull request marks).
- A workspace's ⋯ closes its hover card.
- Settings › Appearance holds what the window shows (plan limits, PR marks, the menu bar item, the fun button, turn
  timers, diff size), out of General.
- A project's ⋯ › *Settings* opens its page at the Settings tab.
- The agent skills know an extension and a widget are one thing, and an installed skill is brought up to date as Laki
  starts.
- **Laki AI makes extensions**: ask for one (*a clock with the time in New York*) and it writes it in Laki's extensions
  folder, saved off; turn it on in Settings › Extensions after a look (*by Laki AI* on its row).
- **Extensions in the top bar or the status bar**: each one's *Sidebar / Top bar / Status bar* in Settings › Extensions;
  in a bar it's a line high.
- **Network access for an extension**: a switch per JS extension (off by default) lets its page fetch from https sites.
- **Delete an extension** (or plugin: search finds it by either word) from Settings › Extensions: its folder and
  settings, for good, after a confirm.
- **The extensions SDK** in one page: `docs/extensions.md`.
- **Laki's skill for Laki AI** (Settings › AI, on by default): your open PRs and others' in your repos, projects' notes
  and memory, renaming and pinning, shells, your actions and prompt templates (*the review action on each PR in this
  screenshot*), to-dos and scheduled tasks. It asks you with options as buttons when unsure, and removes a memory item,
  task, tab or to-do only when you press Yes.
- **Show costs ($)** (Settings › AI): off hides the money on the AI page.
- **Your instructions** (Settings › AI): your own context for Laki AI, added to its instructions at every ask.
- **Artifacts**: the status bar's *Artifacts* opens the previews at once; their ⋯ has *Show in Finder* and *Open in
  Files* (the side panel's Files has an *Artifacts* tab now).
- **New workspace**: *worktree* is a switch; the template, agent and model pickers are words with a ⌄, not buttons; the
  prompt's top corners no longer poke out of its card (on the AI page too).
- **PR marks** go with GitHub's mark by default.

## 0.10.0 · Oct 10, 2026

- **Send later, to Laki AI too**: ⌘L, the toolbar's clock, a tab's right click or ⌘K pick an agent or Laki AI, a
  message (or one of Run ▾'s actions: *Review the code*) and a time; the AI page's clock asks it later. A timer bar
  in the sidebar until then: *Send now*, *Edit…*, *Cancel it*.
- **Extensions**: widgets are called extensions now; Settings › Extensions lists them a row each with its switch, and a
  click sets one up in a dialog.
- **⌘⇧A** shows or hides the workspace's artifacts over the status bar.
- **A page for each project**: a click on its name (the arrow still folds it) opens its Notes, Scheduled tasks, Memory
  (things to keep about it: add, edit, delete) and Settings.
- **Full screen for a tab**: ⌘⇧⏎ or the tab bar's ⤢ leaves only the tab's content, the window full screen; ⌘⇧⏎ again or the ⤡ in the corner brings the rest back.
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
