# Laki: the full guide

Everything Laki does, how to use it, and where it keeps things. The short version is the [README](../README.md).

A macOS app for running coding agents (Claude Code, Codex, Gemini, Grok, OpenCode, or any command) side by side, each in its own
git worktree. You get a sidebar of projects and workspaces, tabs per workspace, real terminals you can split
into panes, and live agent status (running, waiting for you, finished). It also has a follow-up queue, a
side panel (files, changes, review), a Run button, dev servers, listening ports, PRs and ship. Agents keep running when you quit the app;
*Laki › Quit Laki Completely* stops them too (they resume next time).

Electron + a terminal-host daemon (node-pty + @xterm/headless) + React + xterm.js, the same shape as Superset.

What Laki is and where it's going: [requirements](../requirements/README.md). How the code works, for agents
changing it: [AGENTS.md](../AGENTS.md).

## Features

- **Workspaces**: one git worktree and branch per task (or the repo or a plain folder itself), with setup and
  teardown scripts (worktrees only: a folder's own workspace never runs them), env, a `$PORT` of its own, and a
  name you can change. Files git ignores that a worktree needs (`.env`…) are copied in (`.worktreeinclude`).
- **Agents**: Claude Code, Codex, Gemini, Grok, OpenCode or any command, started from presets (args, env). Live status per tab and
  workspace; notifications and a count on the Dock icon and in the menu bar; pushes to your phone; a follow-up queue; resume after a restart; usage limits wait
  and continue; a model and effort per workspace; turn timers (off by default); ⌘J jumps to the next tab that
  needs you. An agent's numbered choices (a permission prompt, a question) are buttons under the terminal and on its
  notification (and, if you opt in, on a Telegram or ntfy push). *Send a message later* (⌘L, the toolbar's clock) types a
  message into an agent, or asks Laki AI, at a time you pick. *Mark as unread* puts a tab's ● back.
- **Race**: one prompt to several agents (claude, codex…), each in its own worktree; *Compare* lays them side by
  side (status, diff size, what each said last, the files it changed) and *Keep this one* archives the rest.
- **Issues and PRs**: `laki new <project> --issue <url>` starts a workspace on a GitHub issue (its title and text as
  the prompt); `--pr <url>` on a PR's branch, a fork's too. A prompt
  that names a PR (`review https://github.com/o/r/pull/12`) names the workspace after it (`pr-12-<title>`) and links
  it to that PR: its status, author and checks from the start, without checking it out (so no fix/review switches:
  the agent couldn't push to it; `--pr` gives those). The link stays when the agent checks the PR out to review it.
  That's the workspace's **PR**, until its own branch has one: once the agent pushes and opens a PR, that one is its
  PR and the other moves to *related* (a PR you attached or picked stays). A session an agent starts from another one (`/laki:new`) only lists the PRs its
  prompt names as related, so the PR it opens is its PR (`--link <url>`: the PR it's about, as for a review).
- **Terminals**: real PTYs in tmux-style tabs and panes (drag to split), kept by a daemon while the app is
  closed. ⌘F finds with every match in yellow; copy on select; drop files on one to type their paths; font,
  size, line height, weight, cursor and zoom, with a live preview.
- **New workspace prompt**: type, dictate (macOS dictation) or paste/drop screenshots; the agent gets the text
  and the images' paths. Prompt templates wrap it (`{{prompt}}`).
- **Plan limits**: a ring in the status bar fills to the 5-hour limit of your Claude and Codex plans; click
  it for each one (5-hour, weekly, per model) and when it resets.
- **Resources**: memory and CPU for Laki, each tab (its agent, MCP servers, dev servers), Laki AI, tunnels, remote
  access and SSH connections, in Settings or ⌘K; idle
  agents can sleep to give their memory back, and resume their chat when you look.
- **PRs**: the workspace's PR and its CI in the status bar; switches that send failing CI, new review
  comments or merge conflicts to the agent on their own; the side panel's *Info* (⌘I) with the PR and its checks;
  a workspace archived once its PR merges (off by default).
- **Side panel** (⌥⌘B): the workspace's info (⌘I), its files (search, preview, several open as tabs, new file or folder, changed files marked),
  its changes against the base branch (click a line to comment on the PR or tell the agent), its PR's checks
  and review comments, and a browser preview of its dev server (a screenshot, or a picked element's selector,
  HTML, CSS and screenshot, goes to the agent). Markdown files preview rendered or raw; changed images show
  before and after. ⌘P finds a file by name.
- **Agent browser**: `laki browser` (and MCP's `laki_browser`) lets an agent open its dev server in a hidden
  browser of the app's, take screenshots, click, fill in fields and read the page.
- **MCP and links**: `laki mcp` gives any MCP client (Claude Code, Codex…) Laki's tools; `laki://` links open
  a workspace, a tab or a page of the app.
- **Board**: every workspace in a column by where it is (running, needs you, done, PR open, merged), and to-dos
  that start a workspace.
- **Laki AI** (optional): ask in plain words, or paste a screenshot of PR links, and it works Laki for you: starts
  workspaces, reviews PRs in their own worktrees, sends prompts, tells you what your agents are doing, makes extensions. It runs on
  OpenRouter (your API key) or on claude -p / codex exec, and every ask's tokens and cost are logged.
- **Git**: ship (commit, push, open a PR), fork a workspace with its chat, archive and restore.
- **Scripts and ports**: setup, teardown, run, test, lint, format and deploy scripts per project (any number of
  lines); ▷ Run starts the run script in its tab, ■ stops it, Run ▾ runs the others, each in a tab of its own; listening ports you click to open, name (`.laki.json`), stop (✕), or expose to
  the world (a public trycloudflare.com link and its QR code, optionally only for some email addresses).
- **Look**: 98 themes, including Warp-style gradients and eighty that also change shapes, borders and type;
  glass (a see-through window, as see-through as you set, with a color glow); Inter and eleven terminal fonts
  built in (JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Geist Mono, Hack, Iosevka,
  Inconsolata, Roboto Mono, Victor Mono); tab and
  workspace colors.
- **Remote access**: the whole app in a browser on another computer or your phone, through a Cloudflare
  tunnel that lets in one email address (or, if you type *confirm*, anyone with the link), or through Tailscale for
  your tailnet's devices, for 1 hour to 3 days or until you stop it; a QR code to open it.
- **Headless**: Laki on a server with no screen (`./Laki.AppImage --headless --tailscale`), used in a browser
  ([headless.md](headless.md)).
- **A tab in its own window**: a tab's right click › *Float in its own window* (⌘K too): its terminal, live, in a small
  window over every app, as big as you drag it; its ✕ puts it back.
- **The iOS Simulator and app windows**: `laki screen shot` gives an agent a screenshot of the booted simulator or any
  app's window, and with idb it taps, swipes and types in the simulator (`laki screen tap`), to check what it built.
- **A global hotkey**: ⌃⌥⌘L brings Laki forward from any app (Settings › General).
- **Keys everywhere**: ⌘ shortcuts, a ⌘K palette, and a letter for every menu item.
- **A break**: the smiley at the bottom of the sidebar shows a random meme from r/memes, r/ProgrammerHumor or r/wholesomememes (not
  one you've seen); *Next* (→, N) for another, a right click to copy, download or open it. Settings › Appearance hides it.
- **Timers**: the stopwatch at the bottom of the sidebar starts a countdown, 1 minute to an hour (or any length), as
  many as you like; each shows as a bar over the bottom buttons (⏸ pauses it) and then rings: a sound and a dialog,
  or a notification (Settings › General › Timers), and pauses, plays or closes the
  video, or runs a command, if you like. Its *Stopwatch* counts up instead: start or pause, reset, close.
- **Extensions** (also called widgets: one and the same): small live pages at the bottom of the sidebar, in a grid 3 cells across: a count, a chart, a table,
  each fed by a command or a script on a schedule, with a full view a click away (below: Extensions). Two come with
  Laki: *Links* and *My PRs*; Laki AI (Settings › Extensions › *New extension*, or the Desk's *Build with AI*) or the
  *Extension creator* agent skill makes more.
- **A video while you work**: the play button at the bottom of the sidebar asks for a YouTube link (a video, a
  short, a playlist; `t=` starts it there) and plays it there, with YouTube's own controls; ✕ closes it.

## Install

You need:

- macOS on Apple silicon or Intel
- Node 22.6+ (23 recommended) and npm
- git

Optional: `gh` (logged in, for PRs and ship), and the agents you use on your PATH: `claude`, `codex`, `gemini`,
`grok`, `opencode`. Each one found there is a preset; Claude Code and Codex always are.

```bash
cd ~/projects/laki
npm install            # if node_modules/electron/dist is missing: node node_modules/electron/install.js
npm run pack
```

The build is for the Mac it runs on (ad-hoc signed, not notarized): `dist/mac-arm64/Laki.app` on Apple silicon, `dist/mac/Laki.app` on
Intel. Open it from there, or copy it to /Applications:

```bash
open "dist/mac-arm64/Laki.app"   # Intel: dist/mac/Laki.app
```

A downloaded copy (a dmg sent over Slack, mail, a browser) is quarantined: the first open says Apple could not
verify Laki. Click Done, then System Settings › Privacy & Security › *Open Anyway* (once). Or in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Laki.app
```

`npm run pack:x64` builds the Intel app on an Apple silicon Mac (it adds node-pty's Intel binary to
`node_modules`, unsaved; the next `npm install` drops it).

### Linux, and Windows through WSL

`npm run pack:linux` builds the Linux app in Docker, `dist/linux/Laki-<version>-arm64.AppImage` (`ARCH=x64 npm run
pack:linux`: `…-x86_64.AppImage`), then runs the tests and a smoke test against it. To run it on Ubuntu 24.04, or on
Windows in WSL 2 (its Ubuntu; WSLg shows the window):

```bash
sudo apt install libnss3 libasound2t64 libfuse2t64 wslu xdg-utils   # wslu: WSL only, links open in Windows' browser
chmod +x Laki-*-x86_64.AppImage && ./Laki-*-x86_64.AppImage
```

In WSL, add `export BROWSER=wslview` to `~/.bashrc` for those links. Everything runs in Linux there: install your agents
and `gh` in WSL and sign in there, and keep projects in its own folders (`~/…`, not `/mnt/c`: git is slow across that
boundary). On a desktop Ubuntu 24.04+, if it stops on the SUID sandbox helper (AppArmor), start it with `--no-sandbox`.
On arm64 the AppImage's starter also wants `libz.so` (`sudo apt install zlib1g-dev`).

On a server with no screen, `./Laki-*.AppImage --headless --tailscale` runs Laki for a browser instead of a window:
[headless.md](headless.md).

Not like the Mac: shortcuts written ⌘ are the Super key, and paste in a terminal is Ctrl+Shift+V (Ctrl+V and Ctrl+C go
to the terminal); the window has the system's title bar (Alt shows the menu) and closing it quits Laki (the daemon and
its agents keep running); no menu bar screenshots, timer sounds, *Open in* other apps, `laki open` or laki:// links.

To put the CLI on your PATH as `laki`: Settings › General › *Developer* › *Install the laki command* (a small
launcher in Homebrew's bin, /usr/local/bin or ~/.local/bin; it says when that folder isn't on your PATH), or from the
repo:

```bash
npm link
```

## First run

1. Open the app (maximized the first time; after that where you left it: its size, place, maximized or full
   screen, on that screen if it's still there). It starts its background daemon if one isn't running. With no project yet it says what it found:
   git, whether `gh` is signed in (for PRs), whether `cloudflared` is there (optional: its ? says what for, public
   links and remote access) and which agents are on your PATH.
2. *Get started* opens once (everyone sees it once, after an update too): the first steps (add a project, start a
   workspace, Settings, an extension, actions, a prompt template, a terminal or a browser), each with a button that does it,
   and a theme to pick from a dropdown (painted as you pick).
   A step ticks itself as you do it, or click its circle to tick it yourself. *Skip for now* closes it: what's left
   stays as a bar at the sidebar's bottom (a click opens it again, ✕ hides it; *Get started* in ⌘K or the Help menu's *Get Started Again…* brings it back);
   *Don't show again* hides both.
3. Add a project: **⌘O**, + at the top of the sidebar › *Project folder…*, or drag a folder from Finder onto the
   window. It can be a git repository or any other folder.
4. The new-workspace page opens. Pick an agent (claude, codex, gemini, grok, opencode, shell, or a custom command) and,
   optionally, a first prompt.
   - For a git repository, also pick a base branch (the repo's main one, `main` or `master`, unless you pick
     another; ⌄ lists them all, or type any ref). The workspace gets a worktree in
     `~/.laki/worktrees/<project>/<id>` (or the folder you pick in Settings › *Git & worktrees*, or in the
     project's settings) on branch `laki/<id>`, its setup command runs, then the
     agent starts. Settings › *Git & worktrees* › *Sync the base branch* (off by default) fetches it from origin first:
     *Origin's* (recommended) starts the worktree off `origin/<base>`, your own branch as it is; *Fast-forward mine*
     moves your base branch up to origin's first, when it can. Turn off the *worktree* switch to work in the repo itself instead.
   - A folder without git always works in the folder itself; it has no branches, diff, PRs or ship.

## Using it

**Sidebar:** projects (a branch icon for a repo, a folder for a plain folder) and their workspaces, one line each
(status, name; GitHub's mark when it has a PR: green open, gray draft, purple merged, red closed; a red ⊗ beside it:
an open PR's checks failing; a yellow ⚠ beside it: merge conflicts with its base; off in Settings › Appearance). The
selected workspace's PR is in the status bar.
- An open PR's marks, with GitHub's mark at the row's end: ✓ approved, ✓✓ approved and by you too, 👀 you commented on someone
  else's PR. Settings › Appearance › *Pull request marks* turns each off and puts them by the status circle or after the name instead.

  | mark | meaning |
  |---|---|
  | <img src="icons/pr-open.svg" width="14" alt="green GitHub mark"> | an open PR |
  | <img src="icons/pr-draft.svg" width="14" alt="gray GitHub mark"> | a draft PR |
  | <img src="icons/pr-merged.svg" width="14" alt="purple GitHub mark"> | merged |
  | <img src="icons/pr-closed.svg" width="14" alt="red GitHub mark"> | closed |
  | <img src="icons/ci-fail.svg" width="14" alt="red crossed circle"> | an open PR's checks failing |
  | <img src="icons/conflict.svg" width="14" alt="yellow warning sign"> | merge conflicts with its base |
  | the author's picture | its PR's author (yours too) |
  | <img src="icons/approved.svg" width="14" alt="check"> | approved |
  | <img src="icons/approved-you.svg" width="14" alt="double check"> | approved, and by you too |
  | 👀 | you commented on, or reviewed with comments, someone else's PR |
- A line divides the projects; each one's workspaces hang under it, indented (Settings › Appearance › *The sidebar* adds
  a guide line beside them; none by default).
- *Diff size in the sidebar* (Settings › Appearance › Sidebar, off by default) puts each workspace's diff size on its row
  (`+120 −8`: lines added and removed against its base, new files too; checked every 10 seconds). On hover ⋯, its
  menu, slides in at the row's end and its marks move left to make room.
- Rest the mouse on a row for its card beside the sidebar: its branch and `$PORT`, what its agents are doing, the
  agent's last answer (or what it asks), its PR (author, state, checks, review, conflicts, lines added and removed),
  its diff size, ports and marks (from a scheduled task, muted, a reminder, a race). Move onto the card to click it:
  *Open*, *PR #n on GitHub* (or the PR's title), ⋯ its menu.
- Archiving with nothing uncommitted happens at once, with *Undo* in the message that follows; with uncommitted
  changes it asks first (they go with the worktree; the branch stays).
- Click a project's arrow to fold its workspaces away (its busiest status and their count stay), again to unfold;
  *Collapse all projects* and *Expand all projects* are in ⌘K. (Terminals and Browsers fold on a click anywhere.)
- Click a project's name for its page (also ⋯ › *Open project page*), in tabs: *Notes* (yours, in Markdown; *Edit*,
  saved as you leave), *Scheduled tasks* (its tasks, each with its switch; a click or *New task* goes to the Scheduled
  tasks page), *Memory* (things to keep about it, one each, in Markdown) and *Settings* (the same as Settings' section
  for it). The tab you were on is the one the next opens on.
- **Project memory** has two lists of 50 each. *Yours*: add with ⌘⏎, edit, delete. *Learned by agents*
  (auto-memory): what agents found worth keeping as they worked there (an approach that works, a gotcha, a
  convention), each with when and who added it; past 50 the oldest goes, and the pin keeps one as yours. Claude and
  Codex get both lists at every start in the project (after Settings › *Global memory*), with how to add to them (unless the preset's *Tell it about
  Laki* is off); other agents read them with `laki memory`. Edits reach a session at its next start. With Laki AI on,
  its model compacts the learned list (never yours) every 7 days and as it fills up: duplicates merged, overlaps
  joined, stale ones dropped. *Compact now* does it at once, *Log* shows each run's list before and after; Settings ›
  *Global memory* sets how often (or only when full) or turns it off.
  ```bash
  laki memory [.]                         # this project's memory (in a tab, . is its project)
  laki memory add . "tests need Postgres up: docker compose up db"   # an agent's; --mine: yours
  laki memory rm . <id>                   # a learned one (yours you delete in the app)
  ```
- ＋ on a project creates a new workspace in it.
- ＋ at the sidebar's top: *Project folder…* (⌘O), *Terminal* or *Browser*. *Terminal* opens a shell in your home
  folder, without a terminal app: a workspace of the *Terminals* project (made by the first one; terminal 1, terminal
  2…). *Browser* opens any website in Laki: a workspace of the *Browsers* project, with back, forward, reload and an
  address bar (a site, a URL, or words to search); the page's title names its row, and it opens on the same page after
  a restart. Sign-ins are kept between runs (its own cookies, apart from the preview's), and a sign-in's popup (Google,
  GitHub) gets a small window of its own. A page you opened stays loaded as you move to other workspaces.
  - Tabs are rows too: a middle click or ⌘-click on a link (or its right click › *Open Link in New Tab*) adds one
    under *Browsers* in the background, named after the site until you open it; a link that opens a new tab adds one
    and goes there; ⌘T or + in its tab bar opens an empty one, and ⌘W closes the page (its row goes, the next one
    opens; *Undo* in the toast opens its address again), the page in focus or not (not while Settings or another page
    covers it).
  - A right click on a page: open or copy a link, copy an image or text, back, forward, reload, *Inspect Element*; the
    `</>` button opens its developer tools.
  - Terminals and Browsers are projects like the others: drag them, fold them, remove them (your home folder stays),
    though the new-workspace page leaves them out and Files lists nothing for them (your home folder). ⌘K has *New
    terminal* and *New browser*. (A *Shells* project from before is renamed *Terminals*.) Their status bar: a terminal's
    shows only the ports something in it listens on (no `$PORT`, no folder); a browser has none. Their top bar has only
    ⋯ (no Open in, info, preview, side panel or Run), and Settings and the Board leave them out.
- A shell tab (or the Run tab) running a command (a `git push`, `npm install`, a dev server) has the spinner, on its tab
  and its row, until its prompt is back or for 5 seconds at most: a server, vim or a REPL runs on, and shows idle after. An
  agent you start there (`claude`, `codex`…) shows as an agent tab does instead: idle, working (the spinner, its whole
  turn), asking (◆) or done (●), read off its screen (no notifications: start it in its own tab for those).
- *Meme* (the smiley) at its bottom, beside *Video*: a random meme from r/memes, r/ProgrammerHumor or
  r/wholesomememes, pictures only, for a break (*Next*, → or N; a right click: copy, download, open on
  Reddit; Esc closes it); one you've seen comes again only when nothing new is left. Fetched only when you click:
  Reddit's own, or meme-api.com when Reddit turns the request away.
- *Video* at its bottom: a YouTube video under the projects, as wide as the sidebar (*YouTube* above it: the chevron
  minimizes it to that bar, playing on, and shows it again; the pencil asks for another, ✕ closes it; these are in ⌘K
  too). Hiding the sidebar (⌘B) keeps it playing; it's back, paused, after a restart.
- *Timer* at its bottom starts a countdown (1, 5, 10, 15, 25, 30, 45 minutes, 1 hour, or *Other length, a message or a
  command…*: 25, 1h 30m, 90s, a message if you like (*Go out*: on its bar, and the title of what it says as it ends),
  and its *Then run a command* switch with the command, run as it ends in the workspace in front);
  start as many as you like. Each is a bar above the bottom buttons, like the minimized video, with its time left;
  ⏸ pauses it and ▷ goes on (a paused one stays paused across a restart); its pencil (or a right click) pauses it too,
  adds 5 minutes, adds or changes its message, starts it over with another length and picks what happens as it ends: a sound and Laki's dialog
  (*Again* starts the same timer over), or a macOS notification instead (Settings › General › Timers: what it shows
  and its sound, Glass unless you pick another or none), and the video paused, played or closed, or a command run (*Run a command…*:
  through your login shell, in a tab of the workspace selected then, not focused; it closes when the command succeeds),
  if you like; ✕ stops it. *Stopwatch* in the same menu counts up from 0:00 in a bar of its own: ▷/⏸ starts and
  pauses it, ↻ resets it, ✕ closes it; it keeps counting across a reload. *Start a
  timer…* and *Stop all timers* are in ⌘K. They're kept when Laki quits; one that ends while it's closed is dropped, its action not run.
- *Remind me…* (a workspace's right click, or ⌘K for the one in front): in 20 minutes, 1 hour, 3 hours, tomorrow at
  9:00, or any length; then a notification about it (a click opens it) and a message with *Open*. Meanwhile it's a bar
  over the bottom buttons (its menu: open it, 15 more minutes, cancel) and a timer mark on the workspace's row. A
  reminder that came due while Laki was closed comes as it opens.
- *Send a message later…* (⌘L, the toolbar's clock, the ⋯, a tab's right click, ⌘K; when the workspace has an agent
  or Laki AI is on): pick who gets it (the agent tab in front first, or *Laki AI*), the message (or one of Run ▾'s
  agent actions, a click: *Review the code*) and when: in a length (10m, 2h, 1h 30m; or 15 min, 30 min, 1 h, 2 h) or
  at a time (15:30, 3pm: today, or tomorrow once it's past). The AI page's clock does the same for what's typed
  there. Until then it's a timer bar over the bottom buttons with the message (its whole text on hover); its menu:
  *Send now*, *Edit…* (the message, who gets it, the time), *Cancel it*. As it's due the message goes in, or waits in
  the agent's queue while it's busy (Laki AI: asked once it's free), and a notification says so (Laki AI's: once it
  answers). Laki must be running: one due while it was closed isn't sent, and a message says so as it opens.
- The funnel at the top filters the workspaces: words in a name, branch, PR title, author or the PR's number (`14466`
  or `#14466`; ⌘K finds a workspace by it too), and *Needs
  you*, *Working* or *With a PR*; the projects with none hide, groups too. Esc, the funnel again or the × in the
  field stops it (⌘K too).
- ⋯ on a project opens its menu:
  - *New workspace*;
  - *Collapse* / *Expand*;
  - *Settings* (the project's page at its Settings tab; see Project settings below);
  - *Scheduled tasks…* (the project's tasks and runs; the count of its tasks on the right);
  - *Remove project*;
  - its archived workspaces, which you click to restore.
- Drag the sidebar's right edge to resize it; double-click the edge to reset. With the rail, each kind (Projects,
  Terminals, Browsers) keeps its own width. ⌘B (or the sidebar icon) hides and shows it.
- ⋯ (or a right click) also opens the project in any editor, Finder or terminal app you have.
- Right click a workspace for a color, *Rename…* (the name it shows; its folder and branch keep the id),
  *Info*, *Mute notifications*, *Remind me…*, *Pin to top* (it moves under *Pinned*, above the projects, until *Unpin*),
  *Pin to the rail* (a button on the rail, below a line, a click away from anywhere; 5 at most: terminals and browsers
  too), *Run ›* (the toolbar's Run ▾ for that workspace: its run script, localhost, your agent and shell actions),
  *Mark as unread*, *Copy branch name*, *Refresh PR status* (asks GitHub now, not at the next check), *Attach a PR…* (a
  git workspace on a branch with no PR found: one opened another way, by its URL or number; also the status bar's
  *+ PR* and *Info*'s PR section; a PR whose branch is another one is only linked: its status, no PR switches;
  one with no PR on its branch gets the PR its agent names in its last answer by itself, as a scheduled run's that
  pushed under another branch name: one link of the repo's own remotes),
  *Approve PR #n…* (someone else's open PR), *Compare the race* (a race's
  workspace: the flag on its row), *Open in*, fork, archive and delete. While a workspace is archived or deleted its row
  shows a spinner, then a message says it's done (archive: with *Undo*). A tab's menu has *Mute notifications*,
  *Mark as unread* (its ● again, until you look at it) and *Copy link* (`laki://ws/<id>?tab=<tab>`).
- Drag projects, and workspaces within a project, to reorder them; a project drops anywhere on another one (its top
  half: before it), and the list scrolls as you near its top or bottom.
- Groups: a project's ⋯ › *Add a group* puts a named head over its workspaces, up to the next group; it shows how
  many it holds. *Sort workspaces* (a project's ⋯, and a group's menu): *As dragged* (the default), *Newest first*,
  *Last active first* (its agents' latest turn) or *By name*; a group's own sort wins over the project's (*Like the
  project* gives it back), and a drag still moves a workspace into a group. A workspace's menu › *Move to group ›*: one of the project's groups (first in it), or *Out of its group*. A click folds it: they hide, the selected one too (the
  busiest one's mark stays on it), until another click. Drop a workspace on a group's head to put it first in
  that group (a folded one opens). Drag the head like a workspace; double click to rename; its + (on hover, beside ⋯) is *New workspace here…*; right click (or its ⋯)
  for a color (its name in a box of that color, after a dot), *New workspace here…* (the new-workspace page, set to
  put it first in this group), *Edit…* (its name and a default prompt template: *New workspace here…* starts
  with it; a group without one starts with no template, never the last one used) and *Remove group* (its workspaces stay).
- A workspace with a PR shows its author's GitHub picture before the PR mark (yours on your own).

**Tabs and panes**, tmux style: a tab holds one terminal or several, split side by side or stacked.
- ＋ in the tab bar (⌘⇧N from the keyboard) opens a new tab: shell (⌘T), one of your profiles (claude, codex, gemini, …) or a command.
  With Settings › Terminal › *New tabs open as a split* it opens beside the pane you're on instead, in the same tab.
- How a workspace's tabs are split is kept by Laki itself (not each window): the app, a phone over remote access, the
  CLI (`laki ls --json`'s `tabs`) and Laki AI see the same arrangement, and it survives a restart.
- Splitting:
  - Drag a tab onto a pane's edge: it moves into that tab, on that side. Onto a pane's center: they trade places.
  - *Split right* / *Split down* (⋯ menu or ⌘K) open a new shell next to the active pane.
- Drag a tab along the tab bar to reorder; a line shows where it goes. Esc cancels a drag.
- Drag a pane's header to move the pane within its tab, or onto the tab bar to give it a tab of its own, there.
- Drag the dividers to resize.
- × on a pane closes that terminal; × on a tab closes all of its terminals. Both stop the process.
- ⌘1…⌘9 switch tabs. Double click a tab to rename it. A workspace's first agent tab, made with a prompt, is named after the
  agent (the workspace's name says its task); any other agent tab gets its prompt's first words, `claude: fix the cart
  total`, or the first prompt you type in it.
- A tab closes by itself when its shell exits, or its command ends cleanly (exit code 0). An agent that ends (you
  quit it, or it failed) stays open to read, its chat id on the screen, its name dimmed, and ⏎ resumes it.
- Each workspace remembers its tabs and splits.
- Drop files or folders from Finder on a terminal: their paths are typed in (quoted when they need it), for a
  shell or an agent's prompt.
- When an agent asks something with numbered choices (a permission prompt, a question), they show as buttons
  under the terminal: a click picks one, as the arrows and ⏎ would. Its notification has a button per choice
  (macOS shows the first and the rest under *Options*; set Laki's notifications to *Alerts* in System Settings to
  keep them on screen); a click on the notification itself opens the tab. A choice picked there only goes in while
  the same menu is still on screen. A permission prompt whose menu wasn't read gets *Allow* (the first choice) and
  *Deny* (the last).
- Right click a tab (or a pane's header) for *Rename*, a color, *Split right/down*, *Move to its own tab*,
  *Restart* (an ended agent or dev server), *Close* and *Close other tabs*. Claude tabs are orange, codex
  teal, gemini blue, grok purple and opencode green, unless you pick another color (or none).

**Menus:** every item has a key, shown on its right: press it while the menu is open (e.g. right click a
workspace, then D deletes it, R renames it). ↑↓ and ⏎ work too, and 0–9 pick a color (brown and gray by a click).

**Find:** ⌘F searches the active pane's terminal and its scrollback; every match is yellow.
- ⏎ goes to the next match, ⇧⏎ to the previous.
- *Aa* matches case and *.\** turns on regex. Esc closes the search.

**Tab bar icons** (right side; hover for a tooltip):
- info (⌘I): the side panel on *Info* (below);
- editor: opens the workspace in Cursor, Zed, VS Code, Windsurf, Antigravity, Sublime Text, JetBrains IDEs, Xcode, Finder,
  Terminal, iTerm, Warp or Ghostty (the ones installed). ⌘E opens the default, which is the last editor picked;
- panel (⌥⌘B): the side panel (below); ⌘D opens it on *Changes*;
- ship: commit, push and open a PR, in a *ship* tab;
- search: the command palette (⌘K);
- ⋯: split right/down, fork, archive, delete;
- ▷ Run ▾: the project's run script in a *dev* tab, ■ Stop while it runs (^C). ▾ restarts it, shows its tab,
  opens `localhost:$PORT` or edits the scripts. With no run script, Run opens the project's scripts. The project's
  *Test*, *Lint*, *Format* and *Deploy* scripts (when set) are in ▾ too, each in a tab named as it (run again, the
  last one's tab goes; Deploy asks first); Enter in its ended tab runs it again (a deploy's: only Run ▾ › Deploy, which asks). ⌘K has *Run the test script*…
  ▾ also lists your actions (Settings → *Actions*, and the project's), worked out as it opens:
  - *Agent actions*: a prompt for an agent (Claude Code, Codex, Gemini, Grok, OpenCode, or *Any agent*), listed while the workspace runs that agent. It goes to
    the focused tab if it's that agent, else its first tab, now or (while it works) when its turn ends.
  - *Shell actions*: a command (an action whose target is *Shell*), run in the focused shell if it's at its prompt,
    else the workspace's first shell at its prompt, else a new one.
  - Resting on an action shows what it sends or runs.

**Status bar** (bottom): the branch (short, without the branch prefix; hover for all of it and its base, click to
show it whole: Laki remembers), `$PORT` (green while something listens on it) and the other
listening ports (click one to open it in the browser; a name from `.laki.json`'s `ports` beside it; ✕ stops what
listens there, after you confirm: SIGTERM, then SIGKILL 3 seconds later if it's still there; only your own processes
of that workspace; not what an agent listens on itself, such as its browser bridge or an MCP server, nor a browser it
tests in: a dev server it starts shows), the PR (click to open it; a right click copies its link or `#number`), its CI (`✓ 4/4`,
`✗ 1 failing`, `… 2 running`, each check by its newest run, so a re-run that passed counts; click for the checks,
right click for *Refresh from GitHub*), *⚠ conflicts* when it has merge conflicts, the *fix CI*, *review* and *fix conflicts*
switches (see PRs below), and
the workspace's path, short (`~/…/app/fix-login`; hover for all of it) with a button that copies the whole path.

**Expose to the world** (the globe next to `$PORT` and each listening port): publishes the port at a random
`https://….trycloudflare.com` link through Cloudflare Quick Tunnels, with no Cloudflare account. It needs
`cloudflared` on your PATH (`brew install cloudflared`; the popup says so when it's missing).
- *Who can open it*: *Anyone with the link* (the default: public, no sign-in), or *Only these emails*:
  addresses, or a whole domain: `*@gmail.com` (`@gmail.com` or just `gmail.com` say the same). The popup lists
  who gets in and flags what isn't an address or a domain. A project can set its own default (Settings › the
  project › *Expose to the world*, or `expose` in `.laki.json`): the popup opens with it each time. Cloudflare then emails each visitor a one-time code, and only those
  addresses get in (cloudflared 2026.9.3 or newer: `--allowed-mail`). The list is kept for next time; with
  none yet, it's git's `user.email`.
- Once it's up: a QR code to open it on your phone, the link (copy, open), and *Stop*. The globe lights up,
  and *Info* (⌘I) shows the public link too.
- It runs in the daemon until you stop it, delete or archive the workspace, or stop the daemon; closing the
  app leaves it on. A port with a tunnel stays in the status bar after its server stops.

**Share a tab** (a tab's right click › *Share live view…*: for 1, 8 or 24 hours, or until you stop it): a page
anyone with the link can read, at a random `https://….trycloudflare.com/s/<id>` (the same Quick Tunnels, so it needs
`cloudflared` too), copied as it starts and shown with a QR code. Past its hours the link is dead. An
agent's tab shows its chat (Claude Code's and Codex's: your prompts, its answers, its tool calls folded a line each);
any other tab (a shell, a server, another agent) its terminal's text, in chat bubbles under a *LIVE* badge. It updates as
you go on (every few seconds), follows the end while the reader is there (further up, *New below* takes them down), and has *Copy as Markdown*, *Download .md* and a *Tool calls* switch. Nobody can type into it,
and the tunnel reaches these pages only, never the rest of Laki. A shared tab has a globe; its right click ›
*Shared live view* copies or opens the link, or stops sharing. Closing the tab, archiving its workspace or stopping
the daemon stops it too, and the link is dead after (a new share is a new link). Resources lists its cloudflared as
*Shared tabs*.

**Remote access** (Settings › *Remote access*): Laki in a browser on another computer or your phone, with
its terminals and agents, as if you sat at this Mac. Whoever gets in has a shell here as you, so it lets in one
email address only, unless you leave the email out on purpose (below).
- Set the email (kept in the app's settings for next time), pick how long (1, 2, 4, 8, 12, 24, 48 or 72 hours, or Forever: until you stop it or the daemon) and click
  *Start remote access*. It needs `cloudflared` 2026.9.3 or newer (`brew install cloudflared`), like *Expose
  to the world*.
- cloudflared publishes the daemon at a random `https://….trycloudflare.com` link; the daemon serves the app's
  page there. Cloudflare asks for that email and sends it a one-time code, and the link also carries a key of
  its own (`?token=…`: it survives Cloudflare's sign-in, which drops anything after `#`).
- Without an email (a real risk): leave the field empty, and a red box says what it means: no Cloudflare
  sign-in, the link alone opens a shell on this Mac as you, and a link in a chat, a screenshot or a browser's history
  is enough. Type *confirm* to start it (*Start without an email*), and every start asks again. While it runs, the
  page says *Anyone with this link gets in* and the status bar's badge turns red: *Remote: open to anyone with the
  link*. The link's key still has to be right; pick a short time and stop it when you're done.
- With a PIN instead (*Sign in with* › *PIN (Laki)*; the email stays the default): no Cloudflare sign-in and no
  email. Each start makes a new 6-digit PIN, shown big beside the QR code; the page asks for it before it opens
  Laki (the link's key alone gets nothing else). A wrong PIN counts down: after 2 (or what you pick: 1, 2, 3, 5 or 10)
  remote access stops, the link and the PIN die with it, and Laki says so here and in a notification.
- Once it's up: a QR code to scan with your phone, the link (copy, open), when it ends, and *Stop remote
  access*. The status bar says *Remote until 18:30* (forever: *Remote on*) while it runs; click it to get back here. ⌘K has it too:
  *Start remote access for you@…, 1 hour* (with an email set), *Remote access…*, and *Stop remote access*.
- It won't start, or Cloudflare's sign-in won't let you in: run `cloudflared tunnel login` once in a terminal (a
  browser page opens to pick your Cloudflare account). Settings › *Remote access* and Help say so too.
- When the page can't reach Laki it says why: Cloudflare's sign-in ran out (it reloads, to sign in again), the
  link ended (remote access stopped or started again: open the newest one), or the Mac is out of reach.
- With Tailscale instead (*Sign in with* › *Tailscale*): `tailscale serve` publishes it at
  `https://<this Mac>.<your tailnet>.ts.net`, for your tailnet's devices only (never Funnel), with the link's key.
  It needs Tailscale connected here and HTTPS certificates on for the tailnet (its admin console › DNS); the Mac app's
  own `tailscale` is used when none is on your PATH. On a server with no screen: [headless.md](headless.md).
- On a phone the app has its own layout: the sidebar slides over, one pane at a time (split tabs show as
  separate tabs), the panels and Settings take the whole screen, and a row of keys a phone keyboard lacks
  (⌨ to show it, Esc, Tab, ⇧Tab, ⌃C, arrows, Enter) sits above the status bar. A terminal takes the size of the
  last screen that typed in it or came to the front, so coming back to the Mac gives it the Mac's size again.
- It stops on its own when the time is up, when you stop it, or with the daemon. Each start makes a new key, so
  an old link never works again.

**Board** (the columns icon at the bottom of the sidebar, *Board* in ⌘K, `laki://board`): every workspace as a card in
the column of where it is: *Running* (a usage limit too: it resumes by itself), *Needs you*, *Done*, *PR open*,
*Merged*; with its last answer, its PR and checks, and its turn's time when timers are on (Terminals and Browsers
aren't on it). Click a card to open the workspace; right-click it (or its ⋯ on hover) to open, archive or delete it;
*Merged*'s ⋯ archives them all (one with uncommitted changes asks first). *To do* holds prompts for later: write one (⌘⏎ adds it; paste or drop screenshots in, they go with it) for a project, then ▷ (or drag it onto another
column) starts a workspace on it with the default agent, and the to-do goes.

**AI** (Settings › *AI*, or the same switch in General › *Experimental*, turns it on; then *AI* at the rail's bottom, over Settings, *AI* in ⌘K,
`laki://ai`, `laki ai` in a terminal, or *Ask Laki AI* in the floating bubbles' +: a small window of its own over the app
you're in): Laki's own assistant, one conversation that works Laki with the same tools as
`laki mcp`. Ask *what are my agents doing?*, *start a code review of the PR with the login form*, *take the PR from
workspace ABC and start a new codex session to review it*, or paste a screenshot with three PR links and ask to review
each in its own workspace: it reads the workspaces, their PRs and agents' last answers, then starts workspaces (a PR's
on its branch), opens tabs, sends prompts, attaches PRs and schedules tasks, at once, without asking. A project with
groups gets each new workspace in the group whose name fits it (a review in *Reviews*), or none; a group with a prompt
template starts it with that template, else it picks one of yours that plainly fits the task. The bubbles' window is
the chat alone: no Calls, Info or cost (the app's AI page has them). The chat button at the window's bottom right (every
page but AI, Settings, Help and Specs; Settings › AI › *Chat button* hides it) opens the same chat over what
you're doing, and each ask tells it where you are: the page, the workspace, the tab, its status, progress and last
answer, and the tab's last 40 lines. It knows Laki's built-in tools too (timers, the stopwatch, reminders, Send later,
Bird view…) and starts a timer, a stopwatch, a reminder or a Send later when you ask (*remind me about the login PR
in an hour*). *Laki's skill*
(Settings › AI, on by default) gives it more of Laki: your open PRs and everyone else's in your projects' repos, a
project's notes, memory, templates, actions and to-dos (it writes notes and memory, adds to-dos), renaming and pinning
workspaces and tabs, commands run in a tab that's open (*fix this and run it here*: the tab you're on, or one you
name; a shell runs it, an agent gets it as a message; it asks first before anything that deletes or resets), a new
shell with a command typed for you to run (or run, when you ask), the panes split inside a workspace's tabs (*put
codex beside claude*, *move the shell to its own tab*, *open a shell under the agent*, *show me the review tab*;
closing one is a question you answer, as below), your actions (*start the review action on each PR in
this screenshot, a workspace each*; a terminal's command is typed, for you to run) and prompt templates for new
workspaces. When it isn't sure, it asks with a few options as buttons: a click answers, and it goes on (until you ask
something else: then that question is closed). It removes a memory item, a scheduled task, a tab or a to-do only
through such a question: *Yes, remove…* is yours to press, and Laki does it. Ask it for an extension
(*a clock with the time in New York*) and it writes one in Laki's extensions folder, saved off: its fetch runs commands,
so you look and turn it on in Settings › Extensions (*by Laki AI* on its row); the chat on an extension's page has it
rewrite one of yours the same way. It never archives or deletes
workspaces, ships or merges, and it does nothing until you ask. It reads like a chat: ⏎ asks (⇧⏎ a new line), the tools a turn ran fold
into one line you can open, a pasted image is a thumbnail (a click shows it big), *Stop* ends an ask, *New chat* starts
over. The chat it ends stays in the page's sidebar (the last 100): a click takes one up again (its claude or codex session
goes on), the trash deletes it. A workspace or tab it names is a link: a click
opens it in Laki (from the bubbles' window too); a tool line's *Open* goes to the workspace it worked on. The *Calls* tab
lists every ask with its backend and model, tokens in and out, cost and time; *Info* says how it runs and how it's paid
for, what it spent today and this month (also in Settings › AI), and what it can do. It runs with:
- **OpenRouter**: any model there that can call tools (images too, for screenshots), `anthropic/claude-sonnet-5.5`
  unless you pick one; paid per token with your API key, which Laki keeps in `ai-key` in its data folder (0600), never
  in its settings and never shown again;
- **claude -p** or **codex exec**: the agent in the background on your plan, in `<data>/ai`, with `laki mcp` as its only
  tools (claude: Read too, for a screenshot; codex: read-only, without your config.toml's MCP servers), going on with
  the same session ask after ask (one conversation, it remembers; *New chat* starts a new session). claude's
  cost is Claude Code's own estimate; codex's is your plan's. *Your profiles* in the Backend list run it as one of
  yours: a claude or codex profile with its env and account (none: the agent's default account), each with a session
  of its own. *Effort* (beside the model) sets how hard it thinks: low to max for claude, minimal to xhigh for codex
  (unset: the agent's default); memory compaction uses it too.

*Steps* (unset: 20) caps the rounds of tool calls one ask may make. *Keep pasted images* (Settings › AI › *Pasted
images*: 30 days unless changed) is how long Laki keeps what you paste into its chats and new workspaces' prompts. *Show costs ($)* (Settings › AI › Spending, on by
default) turned off hides the money on the AI page: asks and tokens only.
*Your instructions* (Settings › AI) is your own context for it, added after Laki's instructions at every ask: who you
are, how you name things, what it should know. It can't lift what Laki AI may not do.

**Scheduled tasks** (the clock at the bottom of the sidebar, *Schedule* on the rail in Rail and list, *Scheduled tasks* in ⌘K, or a project's ⋯ menu for its own): a prompt for an agent at
times you write in plain English. *New task* opens the form: the prompt, with the agent under it, then *When*, then
the project, where it runs and a name as chips, the way the new-workspace page has them. A form you leave (Esc, a click elsewhere) is there when the page opens again;
*Cancel* asks before it throws away what you changed, and ⌘⏎ saves it (Enter in a field doesn't). It's a page of
its own: Esc doesn't close it (its ✕, or another page, does).
- Pick the project (or *Another folder…*: it's added as a project), the agent (Claude Code, Codex, Gemini, Grok,
  OpenCode, or a preset of theirs), where it runs (*A new workspace each run*, a worktree; *In its folder, a new session each run*: the
  project's own checkout or folder, a new agent and sidebar row every run; *In its folder, one session*: the same
  agent gets every run; or one of the project's workspaces: its running agent of that kind gets the prompt, queued
  while it works, or a new tab starts), the prompt, and when: `every day at 2am except weekends`, `weekdays at 9:00`,
  `mon, wed and fri at 18:30`, `every 2 hours from 9am to 6pm`, `every 30 minutes`, `hourly on weekends`,
  `at 9am and 5pm`, `tomorrow at 7am` or `once at 23:00` (both run one time, then turn off). Until it reads, a few
  examples sit under *When* (a click fills it in); then the form says how it read it and the next three runs. Every 5 minutes at most; no "every few days" (name the days).
- Dates in the name or the prompt: `{{DD-MM-YY}}`, `{{YYYY-MM-DD}}`, `{{HH:mm}}`, `{{ddd D MMM}}` (`Nightly deps
  {{DD-MM}}` → *Nightly deps 05-10*) become the run's date and time (any of the tokens, below in *Prompt templates*). A new workspace is named after the task, or
  with no name after the date and the prompt's first words (*05-10 02:00 update the deps and*), and gets a clock
  in the sidebar. A name a workspace already has gets four random characters (*Nightly deps 05-10-k3x9*).
- A task's row: its switch turns it off, a click on it edits it, ▷ runs it now, the bin deletes it. *Runs* shows the
  last 8 (*Show all* for the rest of the last 50; click one to go to its workspace); the filter at the top (*All
  projects*) narrows both lists to one project. The clock gets a red dot when a run failed since you last looked.
- The daemon runs them (closing the window doesn't stop them), in the Mac's time zone. A run more than 30
  minutes late (the Mac asleep, Laki not running) is skipped and logged as missed.

**Plan limits** (the ring at the start of the status bar): the theme's accent color, its waiting color past 70%,
its error color past 90%, filled to
the 5-hour session of the agents' plans (the busier agent's). Click it for each agent's windows: Claude's 5-hour session, the week,
the week per model and extra usage; Codex's 5-hour and weekly windows. Each shows when it resets. The daemon
reads them the way Superset and CodexBar do: with the sign-in the agent already keeps on this Mac (Claude
Code's Keychain item or `~/.claude/.credentials.json`; Codex's `~/.codex/auth.json`), from the endpoint the
agent's own `/usage` screen asks, at most every 5 minutes. It never refreshes a token: an expired one says so
until the agent's next run renews it. Settings › Appearance turns each agent off (then nothing is read).

**Side panel** (⌥⌘B, the panel icon; drag its edge to resize; ⌘I or ⓘ opens it on *Info*, below):
- *Files*: the workspace's files (git's, ignored ones left out; a plain folder's, without `node_modules` and
  the like). Search filters by path. New file and new folder go in the selected folder; a new file opens in
  your editor. A click on a file previews it next to the terminal (text with line numbers, code in color up
  to 50 KB, or an image),
  with *Open in editor*; a double-click opens it in the editor. The pencil edits a text file right there, for small
  changes (no completion): ⌘S or *Save* writes it, Esc or *Cancel* drops the edit (asked first when you changed
  something; closing its tab, ⌘W, asks too). Each file you open is a tab over the preview, with its own unsaved edit (a
  dot): a click goes to one, ✕ or a middle click closes it, ⌘W the one in front. Drag the preview's left edge to make it
  wider; a double-click on it shares the room with the terminals again. If the file changed since you started (an
  agent at work), saving asks before writing yours over it. Line ends (CRLF) stay as they were; files over 512 KB or
  not UTF-8 open in your editor instead. A right click opens it elsewhere: its default
  app, a browser (HTML, SVG, PDF, images, JSON, XML), any editor, Finder (shows it), a terminal (in its folder);
  or copies its path. Changed files are colored (modified, new, deleted) and their
  folders get a dot. Refresh, collapse all.
- *Changes*: the files changed against the base branch (committed, uncommitted and new) with +/−; click one
  for its diff, with links to preview the file or open it in the editor (*Expand all* opens every file's, then
  *Collapse all* closes them); the button beside it shows the diffs in two columns, old and new side by side like
  GitHub's split view, and Laki remembers it. With a PR, *Here* / *PR #n* switch to the
  whole PR as GitHub has it (`gh pr diff`; first for a workspace that only links its PR), and the GitHub mark opens
  its *Files changed* there. Each file in the PR has a *Viewed* box, in both views, the same one as on GitHub's
  *Files changed* (ticked here, it's ticked there): a viewed file folds and dims, *Expand all* skips it, and the bar
  counts *3/10 viewed*. A file changed by a commit since you viewed it is unticked again, as GitHub has it. Click a line of a diff to write a
  comment on it: *Comment on PR #n* posts it on GitHub at that line (`gh`; the line must be in the PR's diff,
  so commit and push first), *Send to the agent* gives it to the workspace's agent with the file and line
  (when its turn ends). ⌘⏎ does the first that applies, Esc closes it. A changed image (PNG, JPEG, GIF, WebP, SVG)
  shows before and after side by side, each with its size in pixels and bytes (one side when it's new or deleted);
  click one for full size.
- *Review*: the PR: its title, state, author and size; *Merge* ▾, *Approve*, GitHub and ⋯; its description,
  rendered, a few lines of it until *Show more*; its checks, failing first, each with how long it ran and a click to its
  log; *Let the agent fix*: the *failing CI* / *review comments* / *conflicts* switches, each with *Send now* when
  there's something to send. Then the review threads as cards (from reviewers with write access and bots: what the
  agent would get), the resolved ones folded under *N resolved*. Click a thread's file to preview it at that line.
- *Preview* (also the toolbar's globe): the workspace's dev server in a browser: `$PORT` first; the address bar takes
  a path (`/admin`), another port (`:5173`), `localhost:8080/x` or any website (type `example.com` or a whole URL; in
  the app, not in a browser elsewhere); back, forward, reload, open in your browser. The devices button opens the
  sizes: *Fit* (the panel's), iPhone SE, iPhone, Android, iPad, Laptop, HD, Full HD, or your own (`1440×900`, Enter):
  one click lays the page out at that width and height, scaled down to fit (the percentage says how much); the
  arrows swap width and height. Only the size: no touch, no phone's user agent. The camera takes a screenshot of the page and sends it to the agent
  with what you write. The crosshair picks an element: hover outlines it, a click types its CSS selector, text,
  size, HTML (cut at 1,500 characters), its computed CSS (what isn't a default) and the path of a screenshot of
  just that element into the agent's prompt, without Enter, for you to say what to do with it; Esc stops (in the
  app only). It starts on this Mac (`localhost`); the address bar and links go anywhere, without
  popups, the camera, the microphone or clipboard reads. Its cookies are its own and kept. While the page has the focus, ⌘ keys go to it:
  click outside it first. In a browser (remote access), it works only on the Mac itself.

**File preview:** a Markdown file (`.md`) shows rendered (headings, lists, tables, code, links: they open in your
browser; a ```` ```mermaid ```` block as its diagram, PR descriptions too) or *Raw* (its lines, numbered); the switch is
in its header and remembered. A CSV file (`.csv`, `.tsv`; commas, semicolons or tabs) shows as a *Table* (its first
row the head) or *Raw*: with the pencil, a click on a cell edits it (Enter: the cell below, Tab: the next, Esc: as it
was), *+ Row*, *+ Column*, × on a row's number deletes it, ⌘S saves. Only the cells you change change in the file:
its quotes and line ends stay as they were. The first 2,000 rows show; Raw has the rest.

**Find files** (*Find files…*, first in ⌘K; or ⌘P): type parts of a path (`crt` finds `src/cart.ts`); names match
before folders. ↑↓ and Enter preview the file; ⌘W closes the preview.

**Info** (the side panel's first tab; ⓘ or ⌘I): its name (the pencil renames it), then a card of the workspace's
facts, a line each (rest on one for all of it; a copy button on hover): its id, branch, path, storage folder, `$PORT`
(a click opens `localhost:<port>`), each public link (*public*: anyone with the link, *shared*: only some emails), when it was made,
*from* (the workspace whose agent started it) and *started* (the ones its agents started), a click opens one, and
*related*: other PRs and issues it's about (the ones its prompt named, a PR its own replaced), each with *Make it this
workspace's PR* and ✕ on hover; its PR's title, author, state,
review decision, size, checks (each links to its run) and description, as in *Review*; the PR switches, with a note
when *failing CI* or *conflicts* gave up (turn it off and on to try again), and *Send now* beside one when there's
something to send to the agent now. A PR only linked (another branch's) has *Not this workspace's PR* in its ⋯: it
moves to *related*, and the branch's own PR, once there is one, shows instead.

**PRs.** Laki finds the PR of each workspace's branch with `gh` (logged in) every minute (Settings › *Pull requests*:
1 to 30 minutes), and a couple of seconds after an agent's turn ends (at most every 20 seconds), so a PR the agent just
opened shows up at once. If an agent switches the workspace to another branch, Laki follows it (the status bar and the
PR are that branch's). Hover a switch for what it does, how often it checks and how many tries it gets.

The three switches in the status bar (and *Info*), each on or off per workspace, act on an open PR after each
check. Each sends its prompt to the workspace's first running agent (Claude Code, Codex…), queued until its turn ends;
with no agent running nothing is sent, and the next check tries again.
- *fix CI*: when CI fails on a new commit, the failing checks and the end of their GitHub Actions logs (the last 80
  lines of up to 3 jobs) go to the agent, asking it to fix, commit and push. Once per commit: its push makes a new
  commit, and CI runs again. After 3 tries in a row (*Tries in a row*) it stops: the agent's tab shows ◆ waiting and
  you get a notification. A passing run starts the count over; so does turning the switch off and on (which also sends
  the current commit's failure again).
- *review*: new review comments (unresolved inline threads from people with write access to the repo, and bots) go
  to the agent, asking it to address them and push. Yours count too, but the agent comments as you, so a comment of
  yours made while it works counts as its own and doesn't start another round: comment while it's idle. A thread goes
  again only when someone adds to it.
- *fix conflicts*: when the PR has merge conflicts with its base branch, the agent is asked to merge the base in
  (no rebase, no force push), resolve them, commit and push. Once per commit; after 3 tries in a row it stops and tells
  you. Right after a push GitHub doesn't know yet whether it conflicts: that keeps the count; no conflicts, or the
  switch turned off and on, starts it over.

Under the PR's title, who approved it and who asked for changes (each one's latest review, with their pictures);
the status bar PR's tooltip and the row's hover card say the same.

*Merge* ▾ (green once it could go in: checks passing, no conflicts, no changes requested; plain otherwise, its
tooltip says why), *Approve*, GitHub, and ⋯ (its checks, its files, *Close pull request…*), under the PR's title (the
side panel's *Review* and *Info*), in the status bar PR's right click and (approve) a workspace's right click,
merge, approve or close the open PR with `gh`, as you, after you confirm (each question names the PR; Approve's its
author and checks). Your own PR has no *Approve* (GitHub refuses it). *Merge* uses the way you
merged last in this project (*Squash and merge* at first); ▾ picks *Create a merge commit* or *Rebase and merge*,
which becomes the next default. Its question shows the checks and the review, and *Delete the branch on GitHub* (on
by default). A draft has no *Merge*.

*Merge when green* (a fourth switch, in the status bar and under *When it's green* in the PR panel): Laki merges the
PR itself, the project's last way, and deletes its branch on GitHub, once every check has passed (none failing or
running), it has no conflicts, isn't a draft, is approved if the repo requires a review and its agent isn't at work
(a push may come). It asks once, as you turn it on, and tries once per commit: a failure marks the agent ◆ and
notifies you. The workspace stays (*Archive workspace when its PR merges* still applies).

Each project says which of these Laki may do (its settings › *Pull requests*): *Merge*, *Approve* and *Close* are on
until you turn them off; *Merge when green* is off until you turn it on. What's off isn't shown, and the daemon
refuses it.

*Archive workspace when its PR merges* (Settings › *Git & worktrees*, off by default): the next check after a merge
archives the workspace, if it's clean: nothing uncommitted, no commit the PR doesn't have, no agent at work. Once per
PR: *Undo* in the message brings it back for good. One that can't go says *merged* in the sidebar.

What each sends is a prompt in Settings › *Pull requests*, which you can change: `{{pr}}` is the PR's number, `{{url}}`
its link, `{{base}}` its base branch; the failing checks or the review threads go after it. *Reset* puts the default
back. *Send now* beside each switch (*Review*, *Info*) sends the same prompt once, switch or not; it shows
only when there's something to send: failing checks, open review threads, merge conflicts.

**New workspace** (a page, like Settings; Esc closes it): write the prompt; the agent and its model are picked
under it, where the work goes in the row below.
Closing it (Esc, ✕, a click in the sidebar) keeps what you typed as a draft: it's there when the page opens again,
until you create it or *Clear* it. Enter in a field never creates it; ⌘⏎ or *Create* does.
It starts from your last choices (project, its group, agent, model, template, worktree), never the last prompt.
- Under the prompt: ＋ (images), the mic and its ⌄, then *Template*, the agent (a preset, *Shell*, *Custom command…* or
  *No agent*) and the model, as words with a ⌄ (a hover shows they're menus) (the agent's default, one of its models or *Another model by name…*; for Claude Code and Codex
  the effort too; both kept for its restarts and forks). Their menus have a filter box (type, ↑↓, ⏎), a line about each
  choice, the picked one in the accent with a check; the agent menu marks your default and, for another agent, offers
  *Make … the default for new workspaces*; Claude's models show how they compare in cost ($ to $$$$).
- The row below: the project and its group in one menu (with a filter past six projects; a group puts it first in that group; the project alone, first
  in the project), the base branch (the repo's main one; its ⌄ lists every branch, with a filter) with the *worktree*
  switch (off: work in the repo itself, on its current branch),
  the name (from the prompt when blank) and *More*: *Race*, and a box for a model typed by hand (like a full name) once you pick *Another model…*.
In a plain folder (or without a worktree), whose own workspace is there already, an agent or a prompt makes another
session beside it, in the same folder, named after the prompt; *No agent* gives the folder's own back. A new
workspace is never hidden: a folded project or group holding it, or the one you were on, opens. The prompt:
- paste a screenshot (⌘V), drop image files on it, or pick them with ＋; each shows as a thumbnail, and its path
  goes after your text;
- the mic starts macOS dictation (or press Fn twice). Its ⌄ says where the microphone and languages are picked
  (System Settings › Keyboard › Dictation) and opens it. With Voice on (experimental) and on *Cloud*, the mic records instead: a
  click, talk, a click again (or hold Fn) and the text is typed where the cursor is;
- *Template* (once you have one in Settings → *Prompt templates* or in the project's settings; the project's come
  first): the prompt goes in its `{{prompt}}`; the box below shows what the agent will get;
- *Race* (an agent, in a worktree): ＋ adds other presets; each gets a worktree of its own (named
  `<name>-<preset>`) on the same prompt, and Compare opens (also in a race workspace's menu and ⌘K). Compare shows
  each one's status, diff size, last answer and changed files; *Open* goes to it, *Keep this one* archives the
  others (*Undo* in the message brings them back);
- ⌘⏎ creates it. Meanwhile a line under the page says what's happening (the worktree, then the files and the agent)
  and for how long, *Create* spins, and the sidebar shows its row, *creating…*, where it will be. Esc closes the
  page; it goes on there.

**A screenshot to an agent**: Laki's mark in the menu bar has *Screenshot Area…* (drag over what you
want, or Space and a click for a window; Esc cancels) and *Screenshot Screen* (with more than one screen, a submenu
of them, the one you're on first; the bubbles' *Whole screen* asks the same with a menu at the pointer). A small window
opens over the others to draw on it: *Crop* (C), *Arrow* (A), *Text* (T: click, type, Enter), *Rectangle* (R) and
*Pen* (P), in red, orange, yellow, green, blue or white (1–6), ⌘Z undoes; the box under it says what the agent should
do with it. *Add to prompt* (⌘⏎) opens the new-workspace page with the picture and that note in the prompt: pick the
project and agent, ⌘⏎. Esc drops it. macOS asks once for Screen Recording for Laki.

**⌘K palette:** jump to any workspace or tab, or run any action.

**Status**

| glyph | meaning |
|---|---|
| spinner | running |
| ◆ | waiting for you (permission prompt) |
| ● | finished while you weren't looking; clears when you look |
| ○ | idle |
| ◷ | usage limit (it types `continue` after the reset) |
| ✓ / ✖ | process ended (ok / failed) |

A workspace shows its most urgent tab. A terminal that waits or finishes while off screen sends a macOS
notification; click it to jump there. Settings › General picks which (waiting, finished, usage limit) and the
sound, or turns them off; a workspace's or tab's menu mutes just it. The Dock icon counts the tabs that wait
for you or finished while you looked away (muted ones aside); so does Laki's mark in the menu bar, whose menu lists
those tabs (waiting first, with what they ask): a click opens one. Its *New Workspace…* opens the new-workspace page in a
small window of its own over the app you're in, as the bubbles' + does. With *Turn timers* on (Settings › Appearance), a
working tab and its workspace show how long the turn has gone (`42s`, `12m`, `1h 5m`). Follow-ups queued with `laki send --when-idle` show as `+n`.
**A new session from an agent**: in a Claude Code tab, `/laki:new <the task> with codex` (or claude, gemini, grok,
opencode; none named: claude) has the agent write the task up as a prompt and start it in a new workspace of this
project (`laki new .`), with that agent; it doesn't do the task itself. Laki gives its Claude Code tabs this command
through a plugin of its own (`--plugin-dir`, nothing written to `~/.claude`); other agents with the laki skill
installed (Settings › Agent skill) take `/laki:new …` in a prompt the same way. Not in SSH hosts' tabs.

With *Progress on tabs* on (Settings › General), Claude and Codex tabs started from then on are told to report how
far along their task is every 20–30 seconds (`laki progress 40 "writing tests"`; Claude may run it without asking):
the tab shows `40%` over a bar, its tooltip what they're on, until the turn ends. *Show progress* puts it on the tab,
in the sidebar (the workspace's row: `40%`, a line under it, or both) or both. Other agents get `LAKI_PROGRESS=1`
and report through the laki skill (Settings › Agent skill) or MCP's `laki_progress`.

**The rail**, like Slack's: a narrow rail on the left with *Projects*, *Board*, *Schedule* (a red dot: a run failed),
*Terminal* and *Browser*, the kinds each with a count of their tabs that need you (or a dot while one works), and
*AI* (when it's on) over *Settings* at its bottom (Settings › Appearance › Rail › *Labels* off: icons only and a narrower rail;
*Terminals* or *Browsers* off: no button, and that project is in Projects' list). Board and Schedule are pages
over the list (only the rail stays); Video, Meme and Timer stay at the list's bottom. The
list shows the kind you pick, and its rail button goes back to the last workspace you had there.
A workspace you go to some other way (⌘J, ⌘K, a notification, a link) shows its kind; ⌘↑/⌘↓ stay in the list, and the
filter looks through every kind. Below a line, up to 5 workspaces, terminals or browsers you pinned there (a
workspace's menu › *Pin to the rail*): their initials in their color (a terminal's or browser's icon), with a count when
one needs you; a click opens it, a right click its menu (a pinned one isn't lit while open: its kind's button is).
Specs and brainstorms pin there too (the pin in an open one's header, or a right click on it in the list), counted in
the same 5. A phone always has one sidebar.

**The sidebar's style** (Settings › Appearance › Sidebar): *Compact* (a short line: the state and the name),
*Default* (the marks: PR, its author, timers), *Extended* (a second line: the branch, what the agent is doing, its
progress, the PR's title, the diff; a hover shows its ⋯ in a place kept for it, so nothing moves), *Cards* (a card each, with the agent's last answer) or *Status* (the row's edge
in its state's color: working, waiting, done, a limit; a thin line under it fills with the agent's reported progress,
or sweeps along while it works without one). *Icon size* sets the PR
mark, its author's picture and the other marks to one size.

### Extensions

Extensions (also called widgets or plugins: one and the same) are small live pages. The SDK, in one page:
[extensions.md](extensions.md).

Where each one shows is its own (Settings › Extensions › the extension: *Sidebar*, *Top bar*, *Status bar*, *Rail* or
*Sidebar foot*): the sidebar's grid (the default), the top bar left of its buttons, or the status bar's right end; the
bars are a line high, as wide as its cells across. On the rail (among its icons; with no rail, in the sidebar's foot)
or in the sidebar's foot (beside Video, Meme and Timer) it's a button: its icon (one of Laki's or an emoji), its label,
a badge with a count and a tooltip, which its fetch keeps up to date in the background, and a click that runs one of
its actions (none: its full view, or a fetch now). One with no preview of its own is a button wherever it sits. In the sidebar they sit at the bottom, above its buttons, in a grid 3 cells across (a cell is 64 px tall, or
half that: ½, a thin line, like *Links*, its sites as plain words with a rule between them, wrapping when they don't fit),
plain values on the sidebar (no tiles; Settings › Extensions turns them on and off). A click on one opens its full view in a dialog, small, medium or large (its *view* in
Settings › Extensions: large for wide tables; ↻ fetches now, the sliders its settings).
Links open in the browser; an extension's buttons can run commands its `widget.json` names (*Review in Laki*). While one
runs, a toast in the bottom right says so (and the button waits); what it prints decides what shows after: a line as
a toast, or JSON with `toast` and `modal` (a dialog with a title, text and up to 4 buttons, each running another of
its actions, opening a link or closing it; none: OK). An extension's page can do the same from its script:
`laki.toast(text)`, `laki.modal({ title, text, buttons })`.

Each extension is a folder: `widget.json` (its name, size in cells, settings, how often it fetches, and the command
or JS script that fetches its data, as JSON) and `widget.html` (what the tile shows and what the full view shows).
The fetch and the buttons' commands run in the extension's folder, so they can run its own scripts in any language:
`sh fetch.sh`, `python3 fetch.py`; each setting comes as `$WIDGET_<NAME>`, all of them as JSON in
`$LAKI_WIDGET_CONFIG`.
Laki looks in `<data>/widgets/` and the folders you add in Settings › Extensions; *Reload extensions* reads them again,
no restart. An extension fetches when it's turned on, when its settings change, and every few minutes (its own
*Fetch every*) while the app is open; what it fetched last is kept in `<data>/widget-data/<id>.json`, with your
settings. A failed fetch keeps the last data and shows a red dot (its tooltip, and Settings › Extensions, say why:
what the command printed last, or what the script threw).

An extension's settings each have a kind: text, a number, an on/off, one of a few choices, or a list (logins, labels:
typed as chips, Enter or a comma after each).

*Working hours* (Settings › Extensions › *Fetch only*): when extensions fetch on their own, in plain English: `9am-9pm
weekdays`, `8:00 to 18:30 except fri`, `9am-6pm, no weekends`, `noon-6`, `10pm-6am` (overnight). Outside them nothing fetches until they start again;
*Fetch now* and a change of settings still do. Empty: any time the app is open.

Every extension, yours too, starts off: turn it on in Settings › Extensions. Two come with Laki:
- *My PRs*: your open PRs in a repo (*Repo*: `owner/name` or its GitHub link; *Author*: `@me`, or someone's login;
  blank: you) counted: open, drafts, with conflicts, and with each of up to 3 labels (*Count label 1–3*); the full
  view (large) has the counts and the PRs grouped by what they need: conflicts, failing CI, changes asked, approved,
  in review, drafts, each with its labels, CI, review and date.
- *Links*: sites you open often, a click away in your default browser (Linear, New Relic, lunch): each chip of
  *Links* is `Label: https://…` (a bare URL: its host as the label; `mailto:` links open your mail).

My PRs takes *Only with labels* (any of them; empty: all) and *Hide with labels* (`wip`, `do-not-merge`).

Each extension has a **page of its own**: a click on its row in Settings › Extensions (or ⚙ in its full view, *Its
page* on a Desk tile). It shows how it looks where it sits, and its full view, either live or with **made-up data**
(*Sample*: what its `widget.json` gives as `sample`, so you see it before it ever runs; every one with a fetch has
one), its settings under them, and Laki AI's chat beside them: say what to change and it rewrites the extension (one
of yours, in Laki's folder), saved off until you turn it on, the preview showing each version. The crumb at the top,
or Esc, goes back where you came from (Settings, the Desk).

*Edit* at its top goes to its settings, lit. Its **Data** tab says where the data comes from (its fetch, a text, a
file, a URL), shows the data, and its examples (its sample and each `fixtures/*.json`: *Show it with this*); the
preview's *Sample* picks one. Its **Files** tab edits its files: *Edit*, then *Save* or ⌘S (JSON is checked first, it
reloads at once, and the studio's *Undo* keeps the version before). One that comes with Laki: Remix it first.
Settings › Extensions › *Icons* shows every icon an extension can name, with a search; a click copies the name.

To make one: Settings › Extensions › *Yours* › **New extension** opens a new extension's page. Describe it in the chat
there (with Laki AI on): it asks you at least two questions (what it shows, where it sits, what a click does), then
writes it, and the page turns into its page, the preview with its sample data; ask for changes until you like it,
then turn it on. Without Laki AI, *Copy the prompt* there gives any AI chat the whole format with what you typed;
save the files it gives you in `<data>/widgets/<id>/` and press *Reload extensions*. Or install the *Extension
creator* skill (Settings › Agent skill) and ask your agent ("an extension with my open issues"). An extension without a script is drawn inside the app; one whose page has a `<script>` runs in a
sandboxed frame that can't reach the app, nor the network unless you turn on its *Network access* (then its page may
fetch from and show images of https sites; its data otherwise comes from its fetch, which always has the network).
Most draw with the **UI kit**: widget.json's `ui`, elements as JSON (stats, lists, tables, charts, forms, tabs…) that
follow the theme and fit any size; Settings › Extensions › *UI kit* shows each with its sample and its JSON to copy
(`laki widget kit` in a terminal). `laki widget` lists, reloads, fetches and renders them.

Working on one of your own: `laki widget dev` in its folder links it (it's on, ahead of an installed one of the same
id, and every save reloads it and fetches it again; a file that doesn't read keeps the last good version running and
says why), then prints each fetch as it runs. Its page has tabs beside Overview: **Data** (its JSON; edit it and Apply,
or pick one of its `fixtures/*.json`, to see it with that data, *Sample data* on it until *Live*), **Runs** (the last
20 fetches and actions, why each ran, a click for its stderr), **Env** (what its fetch gets, tokens masked) and
**Files**, and **Check**. A right click on an extension opens it there (*Inspect*), and so does `laki://settings/widgets/<id>/inspect`.

To start one: Settings › Extensions › *New ▾* (a starter: a number, a list, a table, a chart, a note, a launcher, a
button, a form, a JS page or one file; it runs at once on sample data, and its page opens), or `laki widget new
"Deploys" --kind table`. Its card's *Data* says where its data comes from: its fetch, a text you type (JSON, or a
Markdown note), a file, a URL, or *AI*: an agent finds it with your own MCP servers and sums it up, every hour (a
prompt such as *"What's new in #eng on Slack since yesterday: decisions, questions for me"*, the tools it may use
unasked, `mcp__slack`; Settings › Extensions › *Agent profile* picks which claude or codex profile runs it, each run in
Laki AI's Calls). Its buttons can ask Laki to start a workspace, send a prompt to the agent or Laki AI,
run a command in a terminal or open a page (`do`; Laki asks first); an action can be a prompt the agent answers
(`{ "ai": "Draft a reply to {{arg}}" }`, the answer in a dialog), and `notify` posts a notification when its data says
something new. *New ▾* makes one *With Laki AI* or *From a starter* (each shown on its sample data).
`laki widget check <id>` (its page's **Check**) says what's wrong: unknown keys (with a guess), places, actions, the
`ui` against its sample and fixtures, and its fetch run once. One file is an extension too: `prs.5m.sh`, run every
5 minutes, its name, place and settings in comment lines (`# <laki.place>status</laki.place>`).

An extension can be **per workspace** (`"scope": "workspace"` in its widget.json; the *This branch* starter is one):
what it shows is about the selected workspace (its branch, PR, port, path), each workspace with its own data, fetched
while it's selected. With none selected (the Board, Scheduled tasks) it says *Select a workspace*. Its data goes when
the workspace is deleted and stays while it's archived. `--ws <workspace>` picks the instance for `laki widget run`,
`render`, `action` and `check`; its page has a workspace picker.

Extensions can answer what happens (`"on": { "turn.done": "an action" }` in widget.json: an agent's turn ending or
asking something, a PR's checks failing or passing, a merge, a new or archived workspace, a scheduled run, the app
opening): the action gets the event as JSON on stdin. One can **stream** (`"stream": true`: its command runs all along,
each line of JSON it prints shown at once), and anything can put data in one with `laki widget push <id> '{"n": 3}'`
(a cron job, a git hook, CI).

An extension's action can be a **tool for your agents** (`"tool"` on it in widget.json: what it does, its input, when
to ask): agents list them with `laki widget tools`, call one with `laki widget tool <id> <action> '<json>'` or through
MCP, and Laki shows you the command first (once per workspace, every time, or never, as the tool says). Settings ›
Extensions lists each tool and where you allowed it always, with *Revoke*.

With Laki AI on, *New ▾ › Make with Laki AI* (⌘K *New extension…*) opens the **extension studio**: say what it
should show and Laki AI writes it beside its preview on sample data; *Try it live* shows what it runs and runs it once,
*Undo* takes a change back, *Turn on* turns it on. A row's ✨ opens one of yours there, and *Remix* makes a copy of any
one to change.

To delete one, open it in Settings › Extensions and press the trash can: its folder and its settings go for good,
after you confirm. The ones that come with Laki only turn off.

### Specs & Brainstorms (experimental)

Turn them on in Settings › General › *Experimental*. Off, nothing of them shows.

A **spec** is what you want built, written like a Notion page: headings, checklists, tables, code, images (paste or
drop them in) and diagrams (type `/` for the menu: flowchart, architecture, state, ER, swimlane, screen flow and
wireframes, drawn in a full-screen editor). A **brainstorm** is an idea to explore: write the idea, who it's for and
the constraints, then *Brainstorm with Laki AI* (Laki AI must be on, Settings › AI): it reads the brief and the
project's code and writes its options beside it (`ideas.md` with a mermaid mind map and diagrams, a clickable
`prototype-<option>.html` per option, `<name>.diagram.json`), which show under the brief as they come.

Each brainstorm has its own chat with Laki AI, in a panel on its right (the ✦ beside *Brainstorm with Laki AI* hides
it): ask for another option, a darker prototype, a diagram of the flow; it knows which brainstorm it's in: every ask carries
the brief as it is then (edit it as you talk) and the names of its files, and it reads one (ideas.md, a prototype) when
it needs to, so "what do you think?" is about this brainstorm. *New chat*
starts over. A chat unused for 12 hours ends: what was said stays to read, and what you type next starts a new chat;
*Continue it* takes the old one up again (Claude and Codex go on with their session while they still have it). Laki AI
works on one ask at a time, in whichever chat.

*New* ▾ starts a spec or a brainstorm, empty or from a template: its Markdown goes under the
title (the headings, a checklist of the steps you want, questions to answer). *Edit templates…*, at the menu's foot, lists them: a name, spec or brainstorm, the Markdown, saved as you type. Laki comes with two,
*Feature* (a spec: goal, context, steps, how to verify) and *Idea* (a brainstorm: the idea, who it's for, constraints,
questions); *The ones Laki comes with* puts them back.

They're on the rail's *Specs* (the sidebar's foot without the rail, ⌘K) for every project, and on a project's page,
its *Specs* tab. The page is one list, newest first, each row with its kind (*spec* or *brainstorm*), its project and
when it changed: a filter, a project, *All* / *Specs* / *Brainstorms* (with their counts) and *New* ▾ over it. A click
opens one alone, the page's whole width, with the way back as breadcrumbs at the top (*Specs & Brainstorms › the
spec*). The ⤢ at the top (⌘⇧⏎) puts the
page alone in the window, without the sidebar. Each is a folder outside your repo and its worktrees,
`<data>/plans/<project>/specs|brainstorms/<name>/`: `spec.json` (the editor's), `README.md` (the same as Markdown,
written on each save: what agents read; a diagram is its nodes and edges, with its picture in `files/`) and the files
beside them. A README.md changed by someone else (an agent) since: the spec asks *Load it* or *Keep mine*.

To hand one to an agent: a spec's *Start* opens the new-workspace page with a prompt naming its README.md (pick the
agent, change the words, create); *Copy for a prompt* copies a line naming its README.md, to paste into any agent's
prompt. Agents with Laki's MCP server list, read and write them too
(`laki_plans`, `laki_plan_read`, `laki_plan_new`, `laki_plan_write`: never README.md or spec.json, your words).
A prototype runs in a sandboxed frame: no requests out, never the app or your files.

### Workflows (experimental)

Turn them on in Settings › General › *Experimental*; the rail's *Flows* opens them (⌘K too). The page lists your
workflows and their runs, like Scheduled tasks; a click opens one, and the breadcrumbs go back. Esc doesn't close it:
it stays open while runs go (✕ does).

A **workflow** is a graph of blocks Laki runs for a task: agents think inside their blocks, and Laki decides what
happens between them. The blocks: *Agent* (a prompt to claude, codex or a preset, or one of Run ▾'s *agent actions*,
picked from the sidebar's *Agent actions* or in the block, `use: <its slug>` in the file; it waits for the turn to end),
*Run command* (`npm test`: ok or fail by its exit code), *If / else* (two ways, by what a block said: contains, matches,
equals), *Case* (if / elsif / else: its branches in order, the first that holds wins, *else* last; each tests the case's
variable or one of its own, so *if the change is only specs → approve, else → a full review* is a Case on what an agent
answered: tell it to answer `only_specs` or `code`), *Ask you* (a question with buttons; words you add are `{{answer}}`), *Laki action* (open a PR, approve,
merge, the dev server, archive), *Wait* (until its PR's checks pass or fail), *Save* (into the workspace's storage
folder, its Artifacts: text such as an agent's answer, a file or folder of the workspace, or a link such as its PR),
*AI call* (one prompt to a model on OpenRouter with Laki AI's key, no tools: a summary, a title, a pick; its cost
among Laki AI's calls), *Webhook* (a request to another system: POST unless changed, headers such as
`Authorization: Bearer {{env.MY_TOKEN}}` from Settings' or the project's env, never logged; the body is your text, a
workspace file, or else the run's variables as JSON; ok on 2xx, else error; 429 and 5xx are tried twice more, after
the server's Retry-After), *AI decision* (a decision model on OpenRouter: Jev, GPT-6 Luna Decisions,
Microsoft-Decision-1, Perplexity Decider, Cloudflare Clef or any model id; it judges a state, JSON built from the run's
variables such as `{"messages": {{steps.<block>.answer}}}` (a bare `{{var}}` goes in as JSON when it is, in quotes
it's escaped), and answers yes/no, choice or score questions with probabilities: each answer is
`{{steps.<block>.<question>}}` with its `.p`; under *Sure from* (70%) the run asks you instead; the questions as cards
or as the API's JSON), *Show you* (a window over Laki with what the run made: HTML or Markdown, scrollable, with a
notification if you like; the run keeps it, to open again) and *End*. A Case branch can also compare numbers (`>=
0.8`) or be a JS expression over the run's variables (`num('steps.triage.urgent.p') > 0.8 && vars.task`). An AI call
takes a system prompt and a temperature, and asks for JSON when it names outputs. *Test it* under an AI call, AI
decision or Webhook sends it once with sample values: its exit, outputs and log, without a run. Variables carry results along:
`{{task}}`, `{{steps.plan.answer}}`, `{{steps.test.output}}`, `{{steps.hook.status}}`, `{{pr.url}}`. An agent, AI
call, command or webhook can also name its **outputs** (`out: title, files`): the agent or model is asked to end with a
JSON object with those keys (a command or a response that prints one works too), and each becomes
`{{steps.<block>.<name>}}` for the blocks after it (a list stays JSON). Every loop needs a limit (*at most 3 times,
then…*) or an *Ask you* in it.

An AI decision's questions come in Jev's three kinds: *How true* (`noul`: yes or no, by how sure), *Choice* (one of
its options) and *Score* (graded with a rubric: one of its levels). Its *Ways out*: one line (*ok*, for a Case after
it), or *A line per answer of* one question: yes and no, each option of a choice, each level of a score (by its
number), each to its own block, and *error*. An AI call's *JSON mode* asks the model for one JSON object (on by itself
when it names outputs); an agent's tells it to end with one JSON object or list, and its answer is that JSON (bare in
an AI decision's state, `json('steps.<id>.answer')` in a Case's JS; none: its words, said in the log). *Notify me* on a Show you or an End: a notification on this Mac with the workflow's name, how
the run ended and what the End says (*What it says*, with variables; else its name); a click opens the run. A failed
run notifies anyway, and Settings › General › *macOS notifications* turns them all off. *And on my phone* sends it to
your phone pushes too (Settings › Phone pushes: ntfy, Telegram, Slack or a webhook).

Each block has an **ID**, its `## id` in the file (on the canvas when it has its own name): change it in the block and
every arrow and `{{steps.<id>.…}}` follows. The sidebar's *{{ }} Variables* lists every variable a workflow has, the run's
and each block's, with what it holds; a click copies one, a drag drops it into a field. Your own variables are on top
of it: *This workflow's* (kept in its file, `var REPO: acme/web` lines) and *Every workflow's* (global, kept in Laki's
settings: a team name, a channel, a URL), each `{{vars.NAME}}` in any block; a workflow's own wins over a global one of
the same name. Laki AI works on the Workflows page too: in a workflow, ✦ (or the
chat button) opens its chat with the workflow in every ask (the file, your unsaved changes): ask it to add or change a
step, it writes the workflow, you read it and *Save*.

None come with Laki: *New workflow* ▾ makes one. *From scratch*: yours (any project) or a project's (in its repo,
`.laki/workflows/<id>.md`, to share with your team), from a start, an agent and an end (100 blocks at most). *With
Laki AI…*: say what it should do; its chat asks you a few questions first (what starts it, its steps, where it routes,
how it tells you), then writes it, and the workflow opens as it's written. A row's ⋯ copies or deletes it (deleting
asks first); so does the ⋯ in a workflow's head.
Laki AI and your agents (the laki skill) write them too: ask for one, read it, then *Save* it before it runs. For example: a plan
you approve, the build, tests until they pass (at most 3 fixes), a PR, CI until green. A workflow opens on a canvas: drag blocks, pick one to change it
on the right (its prompt, model, where each exit goes). The sidebar on the left has *Blocks* (a click adds one after the
picked block, else at the end; a drag onto the canvas drops it where you let go) and *Variables*. A block's right
click: *Add a block after it*, *Duplicate* or *Delete*. ⇧-click (or ⌘-click) picks several, and so does a box dragged
on the empty canvas; drag one of them to move them all. With the canvas clicked, Delete or ⌫ deletes what's picked,
⌘A picks every block and Esc none; ⌘Z undoes a change (a deletion too) while you aren't typing in a box. *File* shows the
same workflow as Markdown, the way agents write one (`laki_workflow_write`).

*Run* asks for a project and a task. Each run works in a new worktree (a sidebar row, with a workflow mark) or the
project's folder, with a new AI session or one shared with the workflow's earlier runs. Opening a PR, approving,
merging and archiving ask you first unless the block says not to; *Dry run* says them instead of doing them. A run
keeps the version it started with, so editing a workflow never moves one under way. Several run at once (*Runs at
once*, 3 unless changed), and a run asks you before more agent turns than the workflow allows (30). A scheduled task
(Schedule › New task › the agent picker's *Workflow*) starts one at its times, its prompt the run's task; while that
run goes on, the next time is skipped.

A run opens on the same canvas, lit where it is and where it went: the working block's gear turns and the arrow it took
flows, with what it asks you on top (also a notification),
its **decisions** (each block's exit and why: the agent's answer, the exit code, your pick) and its **state** (the
variables, how many times each block ran). *Log* shows all of it in order, the prompts sent, the agents' answers and
the commands' output folded under each line, with a filter and Copy. A run and its sessions link both ways: its
workspace's status bar (or an agent tab's it sent a prompt to) shows the run and its block, a click opens it; in the run,
an agent block's decision (or *open its session* with the block picked) opens its tab. The trash can deletes a run (one under way stops
first), after you confirm; its workspace and tabs stay. A run stopped by a restart goes on at its block (an agent is
asked again), one at a usage limit waits for the reset, and a block that fails with nowhere to go asks you: *Try
again* or *Stop*. Runs go on only while Laki's daemon runs (the Mac awake).

```bash
laki flow                                      # workflows and runs
laki flow run my-flow app "add CSV export"     # --dry: a PR, approve, merge said, not done
laki flow show <run> | flow answer <run> 0 "use the new API" | flow stop <run>
```

### Bird view (experimental)

Turn it on in Settings › General › *Experimental*; the eye beside Help (⌘K too) opens it. Every live session, agents
and terminals, as a card under its workspace with its screen as it is now (read every few seconds while it's open);
*All*, *Working* or *Needs you* (a red dot on those). A click opens that session. The cards stand in columns, each as
tall as its screen, and each workspace is tinted with its color (its group's, else one of its own).

### Calendar (experimental)

Turn it on in Settings › General › *Experimental*; the rail's Calendar (⌘K too) opens it, a page to stay on (Esc
doesn't close it). A week (Monday first) or a month, switched at the top of the page, with ‹ *Today* › to move: your
scheduled tasks at the times they'll run, the runs that happened, and your reminders. Click a day for its overview on
the right (every task, run and reminder that day), *Remind me this day* or *+ Reminder* to add one: what, when, and a
workspace it's about if any. Laki AI and agents add them too, when you ask
(*remind me to check the release tomorrow at 10*; `laki remind "tomorrow at 10am" Check the release`, MCP's
`laki_reminder`). As one is due Laki notifies you (a toast too, *Open* goes to its workspace); one due while Laki was
closed rings as it opens. Tick it off when it's done; the rail's count is the ones that rang and aren't.

### Desk (experimental)

Turn it on in Settings › General › *Experimental*; the rail's Desk (⌘K too) opens it: your extensions as tiles, an
overview of what's going on. *Add* puts one there (it can stay in the sidebar too: Settings › Extensions' place menu
ticks every place it shows in). Drag a tile's head onto another to move it, its corner to resize it; Laki keeps the
layout. A tile shows the extension's full view when it has one. Esc doesn't close it: it's a page to stay on.

**Tabs** keep tiles apart (Work, Team, Home): + beside them adds one (type its name), a double-click renames it, a
right click moves or removes it (its tiles go to the first tab). Drag a tile's head onto a tab, or pick a tile's ⋯ ›
*Move to tab*, to move it there; *Add* puts an extension on the tab you're on.

**Build with AI** (with Laki AI on) asks what it should show, then hands it to Laki AI's floating chat: it asks a few
questions and writes the extension for the Desk. It shows as a tile right away, dashed, with its made-up data and
*By Laki AI · off*: *Look* opens its page (what it runs, its settings), *Turn on* runs it. Ask the chat for changes
and the tile follows; *Take it off the Desk* in a tile's ⋯ removes it.

### Laki AI's glow (experimental)

Turn it on in Settings › General › *Experimental*. As Laki AI looks at your screen (it reads a tab, or its chat sends
the tab you're on with your ask, or it uses the agent browser), a rainbow edge turns once around that tab's pane with a
soft light inside it, then fades: it was looking there. A tab that isn't shown, or the agent browser: the whole
window's edge. Nothing while Laki is in the background; with reduced motion the edge stays still.

### Projects over SSH

A project can be a folder on another machine: ⌘K › *Open a project over SSH…* (*Open a folder over SSH…* on the first
screen, or `laki project add devbox:~/code/app`), then `host:path`. The host is a name from `~/.ssh/config` or
`user@host`; a relative path or `~` is from its home. The project is named `app (devbox)` (rename it in its
settings) and shows a server icon; the toolbar's ⋯ › *Copy path* gives `devbox:` before the path.

- Laki signs in with your SSH keys or agent, never a password or a 2FA prompt: `ssh devbox` must work in a terminal
  without asking anything (the host's key known too). One connection per host carries git and gh; each tab has its own
  (they open a moment apart: sshd turns away many at once).
- Worktrees go to `~/.laki-host/<this Mac>/worktrees` on the host. git, gh, the setup and teardown scripts and the
  agents run there, from its login shell: install the agents (and `gh`, for PRs) there and sign in to them there.
- Agents report their turns through their own terminal (a hook prints an escape code Laki reads and hides), so
  nothing listens on the host or calls back to your Mac.
- The workspace's `$PORT` on your Mac reaches the same port on the host: the preview, the toolbar's globe and Expose
  to the world work as they do here. Ports a dev server picks itself aren't forwarded, and the status bar lists none
  of a host's listening ports.
- Pasted images and the preview's screenshots are copied to the host for its agent.
- *Open in*: VS Code, Cursor or Windsurf open the folder there (their Remote - SSH).
- If the connection drops, the host's tabs end; Enter starts each again (agents resume their chat).
- Archiving a workspace needs the host reachable (its worktree is removed there); deleting one doesn't.
- Not on a host yet: ignored files copied into a new worktree (`.worktreeinclude`; a setup script can do it:
  `cp "$LAKI_PROJECT_PATH/.env" .`), new files' lines in the diff size, and the agent skill (agents there have no
  `laki`).

### Keys

The menu bar's File, Edit, View and Go menus list most of these, and Laki › Settings… is ⌘,.

| key | |
|---|---|
| ⌃⌥⌘L | from any app: bring Laki forward (Settings › General › *Global hotkey*: off, or other keys) |
| ⌘O | open a project folder (or drop one on the sidebar; on a terminal it types the path), then a new workspace in it |
| ⌘N | new workspace |
| ⌘T / ⌘W | new shell tab / close tab (or the file in front in the preview, when one is open); in a browser: a new page / close it |
| ⌘⇧N | the tab bar's ＋ menu: shell, an agent preset or a command, picked with ↑↓ and ⏎ (or the item's letter) |
| ⌘1…⌘9 | tabs |
| Esc | close a dialog or menu |
| ⌘↑ / ⌘↓ | previous / next workspace |
| ⌘J | the next tab that needs you (waiting first, then done unseen), across workspaces |
| ⌘L | send a message later: to an agent of the workspace or Laki AI |
| ⌘⇧A | show / hide the workspace's artifacts over the status bar |
| ⌘⇧⏎ | full screen: just the tab's content (no rail, sidebar, tab bar, panels or status bar), the window full screen too; again (or the faint ⤡ in the corner) brings it all back. Also the tab bar's ⤢ |
| ⌘K | palette |
| ⌘P | find a file in the workspace |
| ⌘D | changes (the side panel) |
| ⌥⌘B | side panel: info, files, changes, review, preview |
| ⌘I | workspace info (the side panel on *Info*) |
| ⌘F | find in the terminal |
| ⌘S | save the file you're editing in the preview |
| ⌘⏎ / ⇧⏎ | a new line in an agent's prompt (⏎ sends it), also one started in a terminal tab |
| ⌘-click | a file or folder link in a terminal (Claude Code's paths): a file of the workspace opens in the preview, a folder in Finder, another document in its app (an app or a script: shown in Finder). A web link opens on a click, or on ⌘-click in an app that takes the mouse (Codex): a plain click there is the app's |
| ⌘← / ⌘→, ⌥← / ⌥→, ⌘⌫ | in a terminal: the line's start / end, a word back / on, delete the line (Settings › Terminal) |
| ⌘E | open in the editor |
| ⌘B | hide / show the sidebar |
| ⌘, | settings |
| ⌘/ | help: keys, status glyphs, the main CLI commands, with a filter (⌘F or /; Esc clears it) and a link to this guide (also the ? at the top of the sidebar) |
| ⌘+ / ⌘− / ⌘0 | text in the tab with the keyboard bigger / smaller / back to Settings' size; each tab keeps its own (Settings or Help open: their size) |
| hold Fn | talk, let go: the text is typed where the cursor is, a prompt, a field or a terminal (experimental: Settings › Voice on *Cloud*; another key while you hold it, or Esc, drops it) |

Laki follows macOS's System Settings › Accessibility › Display: *Increase contrast* makes hints and lines
stronger, *Reduce transparency* keeps the window solid (no glass), *Reduce motion* stops its animations.

## Settings

⌘, or the gear at the bottom of the sidebar opens the settings page. Changes save as you make them, into
`state.json`. The page grows and shrinks with the terminal font size; on/off options are switches. *Find a
setting* (the box above the sections) lists the settings that match what you type; Enter or a click opens one,
lit for a moment.
- *General*: the agent new workspaces start with, *Global hotkey* (on: ⌃⌥⌘L brings Laki forward from any app; *Record* other keys: two of ⌃ ⌥ ⌘ with a key, or one with Space or an F key, so no app loses its own ⌘K; it says when another app has them), *Developer* (the `laki` command for any terminal, with links to the CLI reference and the agent skill), *macOS notifications* (on by default; also *Turn macOS notifications off/on* in ⌘K) with a switch for each
  kind (waiting for you, finished, usage limit) and the sound (macOS's, or none), *Progress on tabs* (agents report how far
  along they are; off by default), *Timers* (a sidebar timer's end: Laki's dialog or a notification, and its sound), *Development mode* (an event log per workspace, ⋯ › *Logs*: each PR check with
  its checks, conflicts and review, what *fix CI*, *review* and *fix conflicts* sent to the agent or why not, what
  waited in its queue and went in, its tabs' turns and the command each tab started with; *Creation log* under it: what
  making each workspace ran, step by step (what was asked, git, the setup, the agent) or why it failed; *Pick an
  element*: the rail's *Pick* (without the rail, the crosshair beside Help) or its hotkey, ⇧⌘C unless you record
  another, works on every page and over dialogs: point at anything in Laki's window, click, and it tells what it is
  (selector, React components, classes, styles, a screenshot) to copy into a prompt; Esc or a right click stops; *Reset the interface*: Laki as it starts: every setting at its default (the theme, the rail and sidebar, the terminal, notifications, the experimental features), every extension off, Get started again, the window's layout (widths, open panels, folded projects, the selected workspace and tabs, text sizes); projects, workspaces, sessions, profiles and accounts, Laki AI, phone pushes, remote access, env, actions, templates, global memory, how long pasted images are kept, your editor, folders, timers and drafts stay; and per extension, *Logs* in Settings › Extensions: each fetch, how
  long it took or why it failed, its actions; the last 500 lines each, in the daemon's memory; off by default), *Close tabs without asking* (off by default: closing a tab whose agent or server still runs asks first), and environment
  variables for every session (a project's or preset's env wins over them). *Move to another Mac*: Export saves
  every setting of these pages to `laki-settings.json` (your env too: keep it private); Import on the other Mac
  reads it back (projects and their own settings don't move). A file from another version comes in too: a setting
  this one keeps in another shape is left out (Import names it), the rest applies.
- *Git & worktrees*: the branch prefix for new worktrees (default `laki/`), *Sync the base branch* (off; *Origin's*,
  recommended: git fetch, then the worktree starts off `origin/<base>`; *Fast-forward mine*: your base branch moves up to
  origin's first, when it can; a failed fetch never stops a workspace), *Folder for worktrees* (a folder per project
  inside it; empty: `~/.laki/worktrees`; a project's settings can pick its own; ones made already stay), *Copy ignored
  files to new worktrees* (off: every file `.gitignore` leaves out, not only `.worktreeinclude`'s; `node_modules` too,
  which can be slow) and *Copy untracked files to new worktrees* (off), *Refresh PR status in the background* (on;
  off: a PR's status changes only with its right click › *Refresh PR status*, if `gh` asks for an SSH passphrase or
  GitHub rate-limits you; the PR switches need it on), *Delete archived workspaces* (Never, or after a day to a month:
  the workspace goes, its branch stays) and *Archive workspace when its PR merges* (off).
- *Appearance*: what the window shows (*plan limits* for Claude Code and for Codex: the status bar's ring, on by
  default; *Pull requests in the sidebar*: GitHub's mark on a workspace with a PR, on by default, with *Your picture on your PRs* (on: your GitHub picture beside it, as others' show theirs); *Pull request marks*:
  ✓, ✓✓ and 👀, each on by default, and where they go; *Menu bar item*: the count and its menu, on by default; *Fun
  button*: the smiley at the bottom of the sidebar, on by default; *Turn timers*, off by default), *Dock icon* (Laki's, or Dawn, Terminal, Glacier, Bubbles or Neon: the Dock and the app switcher show it
  from the moment Laki opens, after a restart or an update too; Finder keeps the app's own), the interface font (Inter by default, SF Pro, Geist, IBM Plex Sans, Roboto, Source Sans 3, Fira Sans, Manrope, a few of the Mac's, or a developer's monospace one: JetBrains Mono, Geist Mono, Fira Code and more), *Settings & Help size* (90% to 150%,
  over the terminal font's scaling; ⌘+ / ⌘− / ⌘0 change it while Settings or Help is open), *Accent color* (over the theme's: the
  selected row, buttons, the cursor; text on it black or white, whichever reads), *Corners* (square to very round,
  over the theme's: every corner it draws, its selected row, buttons and dialogs too; pills and circles stay round), *Tabs* (top by default; bottom, under the terminals, or a column left or right of them; a phone
  keeps them on top), *Project names in the sidebar* (font,
  case, letter spacing, size and weight, each the theme's unless you pick one), *The sidebar* (its guide line: none by
  default, or thin, thick, dashed, dotted, big dots, accent, accent dots; *Diff size in the sidebar*, off; the line between projects: a line, dashed, dotted,
  double or nothing; the indent, row height, text size and icon size, each the theme's unless you pick one; the style:
  Compact, Default, Extended, Cards or Status (the row's edge in the color of what its agent is doing, and a line under
  it that fills as the agent reports its progress, or sweeps while it works without reporting), above; *Button labels*: words
  beside Schedule, Board, Video, Meme, Timer and Settings at its bottom, in one row: the last ones lose their words when they don't fit),
  *Floating bubbles* (while you're in another app, a drop stuck to the screen's right or left edge, over every app and
  Space, with a circle per agent working or waiting for you (a pulse), two letters from its workspace's name inside (none the same; pr-, issue- and numbers skipped): hover one for
  its card, as the sidebar's: its name, project, branch and `$PORT`, its agents, what it asked or last said, its PR
  (state, checks, review, conflicts), diff size and ports; click to open it in Laki; drag it from anywhere on it (a circle too)
  anywhere, and it sticks to the screen's side nearest where you let go (left or right), where it stays; hidden while Laki is
  in front; on by default. *While working* picks how a working agent's circle looks, each shown live: *Glow* (a soft
  halo), *Gradient* (its color turning slowly inside, the default), *Arc* (an arc going round), *Bricks* (pixel bars rising and falling inside it), *Comet* (a bright head going round, its tail fading behind), *Wave* (filled with its color, a slow tide rolling over) or *Still*; *Recent
  sessions too*: the last 1 to 5 agents you used (3 by default), idle or finished, as dimmer circles after the ones at work (finished
  ones you haven't seen first; one drops out after 1, 4 (the default), 8 or 24 hours idle, or never); *Bubbles
  at most*: 3, 5, 8 or 12; *Finished ones stand out* (on by default): an agent that finished while you weren't
  looking keeps a bubble, filled green with a slow pulse, until you click it or look at its tab in Laki; *Card on hover*; *+ button*: a + under the circles (on by
  default) whose click shows the menu bar's actions: *New task* (Laki's new-workspace page in a window of its own over every app; Laki's window and the app
  you're in stay where they are; Esc or *Create* closes it), *Say it* (a small window where macOS dictation starts by
  itself, then ⏎ sends what you said), *Screenshot area* and *Whole screen*, and with Laki AI on (Settings › AI), *Ask
  Laki AI* (its chat in a window over the app you're in). *Its actions*: *Stacked in the drop* (the
  default: buttons over the +, which turns into ×; the drop grows upward, so the + stays under the mouse; a hover
  names each) or *A menu beside it* (a card with their names; 1-5 pick one, arrows and ⏎ too, Esc or a click elsewhere closes it).
  *Say it goes to* picks either *An agent I pick each time* (the default: the bubbles'
  agents or a new session, nothing chosen until you do; queued while the agent works) or *Always a new session*
  (the new-workspace window with it). With + the drop stays even when no agent is at work. macOS shows
  another app's pointer shapes only while it's the active one, so a hovered circle or button grows a little instead),
  *Glass* (a see-through
  window: the desktop shows through, blurred; sliders for how see-through the window (the main area), the sidebar (the rail too) and the
  terminals are, and *Glow*: the theme's colors lit from two corners behind it; every theme's rows, lines, hovers and
  selection turn into tints of its own text color over what shows through, never solid blocks; with macOS's *Reduce transparency* on
  (System Settings › Accessibility › Display) the window stays solid instead, and Settings says so), without glass *Sidebar see-through*
  (a slider, 0 by default: the sidebar and the rail let the desktop through, blurred, like macOS's own sidebars, their
  hovers, lines and selection tints as with glass; the rest stays solid), and the theme (newest first; yours is outlined and checked; hovering one shows it on
  the whole window until the mouse leaves the list; the box above them finds
  one by name; the ☆ on a card's corner makes it a favorite: *Favorites*, a group of its own above the rest, and still in the full list): Midnight (default), Dawn (light), Synthwave, Forest, Ember, Fjord, Graphite,
  Velvet, Nightfall, Paper (light), Mist (light), and the Warp-style gradients Cyber Wave, Koi, Pink City, Leafy,
  Aurora, Sunset and Snowy (light); and eighty ✦ themes that change more than colors: Phosphor (a CRT: mono,
  dashed, glowing, scanlines), Neon Arcade (pills and glow), Brutalist (light: thick black lines, hard
  shadows), Bubblegum (light: round and soft), Blueprint (a drafting grid, mono capitals), Cyberpunk (clipped
  corners, hazard stripes, yellow tabs), Art Deco (gold double rules, serif capitals, a sunburst), Classic
  (light: a 1995 desktop with grey bevels and navy title bars), Notebook (light: ruled paper, a red margin,
  a highlighter, sketched buttons), Aqua (light: glossy gel pill buttons, pinstripes, a blue jelly selection and
  scrollbars, glowing focus rings), Clay (light: soft UI, everything raised out of one color or pressed into it),
  Pocket (light: a handheld's green LCD, pixel-stepped corners, a ▶ cursor on the selection, a crimson A button)
  Starship (a ship's console: flat pastel pills, rounded elbows framing the popups, a segmented column down
  the sidebar), Gazette (light: a broadsheet's serif type, double rules, a red drop cap, a masthead on the popups),
  Holo (iridescent foil: popups edged in a moving rainbow, prism lines), Bauhaus (light: Futura, primary color
  blocks, a circle, square and triangle by the headings), Chalkboard (chalk on a green board, the selection circled
  by hand, popups in a wooden frame), Brass (steampunk: brass plates with rivets, copper pipes along the edges),
  Circuit (a circuit board: gold pads for buttons, copper traces, fiducials in the popups' corners, a grid of
  vias), Riso (light: a two-ink print, pink and blue a little out of register, overprinted selections), Denim
  (a twill weave, orange stitching along the seams, a leather patch, popups cut like a back pocket), Kraft
  (light: cardboard flutes, a typewriter, masking tape on the popups, a red rubber stamp), Outrun (chrome headings,
  a sunset button, a neon grid floor under the terminals), Cathedral (stained glass: jewel panes in dark leading, a
  rose window), Washi (light: Mincho type, a brush stroke, a red hanko seal, an ensō), Comic (light: ink outlines,
  hard shadows, caption boxes, speech-bubble popups, Ben-Day dots), Groovy (light: the seventies' four stripes,
  Cooper type, pills, a rainbow), Sonar (range rings and a slow sweep, a pulsing blip), Luna (light: a 2001
  desktop's blue title bars, a task pane, a green Start button), Quest (a role-playing game's blue windows and
  ▶ pointer), Terrarium (leaf-shaped corners, moss, fireflies), Bricks (light: toy bricks with studs), Zero Day (a
  hacker's green mono, a root prompt with a blinking cursor, [ bracketed ] buttons, digital rain behind the terminals),
  Glitch (condensed caps split red and cyan, controls that jump on hover, a tear rolling down the terminals), Greenbar
  (light: line-printer paper with green bands, tractor-feed holes, *** banner *** headings), Noir (black and white,
  Didot italics, light through venetian blinds, film grain), Big Top (light: a striped valance, marquee bulbs around
  the popups, a ticket button), Darkroom (a red safelight, a film strip with frame numbers down the sidebar), Transit
  (light: a subway map, each workspace a station on the line, black signage), Modular (a synth rack: brushed
  aluminium, screws, LED switches, an oscilloscope trace), Topo (light: contour lines, a map legend with a scale bar),
  Abyss (the deep sea: bioluminescent glows, rising bubbles), Manuscript (light: parchment, Luminari capitals in red
  and gold, a wax seal), Mixtape (cassette labels and tape-deck keys), Workshop (wood grain, a pegboard, a tape
  measure for the status bar), Receipt (light: thermal paper torn off in a zigzag, a barcode), Aquarelle (light:
  watercolour washes, Snell Roundhand), Cosmos (stars that twinkle, a nebula), Sakura (light: petals drifting down),
  Magma (glowing seams, rising embers), Azulejo (light: Lisbon's blue tiles), Field Ops (olive drab, hazard stripes,
  HUD brackets), Diner (light: a checkerboard floor, chrome buttons), E-Ink (light: an e-reader's ink on paper),
  Vapor (light: vaporwave windows and a pastel grid), Shibuya (neon in the rain), Origami (light: folded paper),
  Tiki (bamboo and torchlight); and ten after films' and games' screens: Lightcycle (glowing cyan lines on a grid),
  Phantom (black, white and red slanted slabs), Test Chamber (light: a test lab's tiles and two portals), Monolith (a
  ship computer's red eye), Macrodata (a severed office's sea-blue terminal), Redline (a racing HUD: carbon fibre,
  shift lights), Mission Control (1969 consoles, label plates, an amber lamp), Grimoire (a dungeon inventory's gold
  frames), Cockpit (an orange flight HUD with target brackets), Islander (light: an island phone app), Llama Amp (a
  1998 music player: ribbed chrome, gold title stripes, the playlist's blue selection, a spectrum in the status bar),
  Spartan (a power-armour HUD: hexagons, a shield bar, the visor's gold, a motion tracker), Vault Dweller (a wrist
  computer's green screen with scanlines), Overworld (a block world: dirt, stone buttons, a grass block, the
  experience bar), Rip & Tear (hell's red on scorched iron, claw marks, a fire's glow), Warp Pipe (light: sky and
  clouds, coins, a brick ledge), Power Pellet (a maze arcade: blue double walls, pellets, a chomping circle),
  Hyperspace (stars, the crawl's yellow leaning back, saber glows), Spice (light: desert sand, wind ripples, two
  moons), Outatime (brushed steel, a title in italic fire, the flux glow, the time circuits' display), Grand Hotel
  (light: pink wallpaper stripes, a pastry box with a ribbon, lobby purple) and Replicant (a haze from amber smog to
  night teal).
  Terminals take its 16 colors.
- *Terminal*: font (JetBrains Mono by default; Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Geist
  Mono, Hack, Iosevka, Inconsolata, Roboto Mono and Victor Mono are built in too; the monospace fonts you have, or any other by name), font size (every tab's; ⌘+ / ⌘− / ⌘0 change one tab's, which keeps it),
  line height, letter spacing, font weight, minimum contrast (text lightens or darkens to stay readable),
  cursor style (block, bar, underline) and blinking, *Padding* (the space around the text: tiny, normal or roomy), *Scroll speed* (lines per wheel step: 3× by default, xterm's own
  is 1×; with ⌥ three times that), copy selected text to the clipboard (on by default), *Mac editing keys* (⌘← and
  ⌘→ go to the line's start and end, ⌥← and ⌥→ a word back and on, ⌘⌫ deletes the line, as iTerm's Natural Text
  Editing has them; on by default) and
  *Dim other panes* (in a split, the panes without the keyboard fade back; on by default) and *Focus the pane under
  the mouse* (in a split, moving the mouse onto a pane gives it the keyboard, no click needed; on by default), with a live preview. Ligatures aren't drawn: xterm.js needs an add-on for them that isn't bundled.
- *Open in*: the default app for ⌘E, or a custom command that gets the folder as `$1` (e.g. `idea "$1"`).
- *Agents & profiles*: an agent is a CLI Laki starts (Claude Code, Codex, Gemini, Grok, OpenCode, or any command); a
  profile is how it starts, grouped under its agent: a model and an effort (a workspace that picks its own wins),
  an account (Claude Code and Codex), flags (e.g. `--permission-mode acceptEdits`) and environment variables. Each
  one is in the new-tab menu, the new-workspace page (and its races) and scheduled tasks; its switch takes one you
  don't use out of them (its tabs still start and resume). The defaults are the agents on your PATH (*Reset to the
  agents installed* goes back to them; *Add a profile for…* adds another agent's). Edit `claude` or `codex` to change how every new one starts; a tab started from a profile uses its current settings when it restarts or resumes.
- *Accounts* (Claude Code and Codex, at the top of each one's group in *Agents & profiles*): your other sign-ins, say a
  work and a personal plan. *Add … account* makes a folder for it in Laki's data folder (given to the agent as
  `CLAUDE_CONFIG_DIR` or `CODEX_HOME`) and opens a terminal with the agent's own sign-in there (`claude auth login`,
  `codex login`); *Sign in again* does that later. Its settings, skills, plugins, commands, agents and chats are your
  own folder's (`~/.claude`, `~/.codex`), linked in, so a chat resumes on any account; only the sign-in is its own
  (and Claude's ↑ prompt history). Each row says who it signs in as, its plan, and *most room* on the one with clearly
  more of its 5-hour window left. The circle picks the default: new sessions start on it (a profile can pick one of
  its own); a tab keeps the account it started on, and its right click › *Restart on another account* moves its chat
  to another (a turn at work stops first). ⌘K's *Switch Claude Code to …* and the plan limits' popup (*Use*) change the
  default too. The ring in the status bar shows each agent's default account; its popup lists them all. Removing one
  removes its folder and Claude's Keychain item for it; its chats stay.
  The chips under the arguments (`$PORT`, `$LAKI_WORKSPACE`, `$LAKI_TAB`, `$LAKI_PROJECT_PATH`, `$LAKI_STORAGE_FOLDER`) put a variable in at the
  cursor: the line goes through the shell, so they work there. Every tab also gets `LAKI_APP=true` (a program or
  skill can tell it runs in Laki), and an agent's `FORCE_HYPERLINK=1` (Claude Code's links show as their text, a click
  opens them; set it to 0 in an env to see the URLs).
  *Tell it about Laki* (on by default; Claude Code and Codex): each start adds a short note to the agent's system
  prompt (`--append-system-prompt`, Codex's `developer_instructions`; a preset whose arguments set their own keeps
  those, and so does Codex with `developer_instructions` in its `config.toml`: no note then): it runs in Laki, and how to name its workspace (`laki rename . "…"`), attach a PR (`laki pr . <n>`), hand a
  task to a new workspace, look at the app in the agent browser, and where to keep files for you, and a link to whatever it publishes (the storage folder, below).
- *Global memory*: your own rules for every project (how you like commits, tests to run, what never to do), 50 at most,
  added and edited like a project's memory: Claude and Codex get them at every start, in any project, just before that
  project's own (none with *Tell it about Laki* off). Only you add here: agents' auto-memory stays with each project.
- *Storage* (General): every workspace gets a folder of its own outside the repo, `$LAKI_STORAGE_FOLDER` in each of its
  tabs (agents and shells alike): `<data>/storage/<name>-<id>`, or under the folder you set. It's made with the
  workspace's first tab and keeps its path when the workspace is renamed. Ask an agent to put screenshots, reports
  or exports there; *Info*'s *Storage* opens it, and the status bar's *Artifacts: n* (the files in it, hidden
  ones not counted; none at 0) shows them here (⌘⇧A shows or hides them): a strip of previews over the status bar, newest
  first; click one for a big view (images, text, Markdown rendered, an HTML page in a frame), ← and → for the others. Its folders come first:
  click one to go in, the path at the top (or ←) to go back out. A right click on one (in the strip,
the big view or Files) copies the file itself (a picture as a picture, to paste into a chat or a document), its text
or its path, opens it, or shows it in Finder. The strip's ⋯ has *Show in
  Finder* and *Open in Files*: the side panel's Files with its *Artifacts* tab (beside *Workspace*), a tree of them to
  search, preview (read-only) and open in their app. A link to whatever an
  agent publishes for you (a Claude artifact, a deployed site, a gist) is kept there too, as a `<title>.url` file
  (Finder opens it in the browser), without anyone asking: Laki keeps what Claude's publish tools return (its
  *Artifact* tool, an MCP tool named publish, deploy, upload or share) and, for any agent, the links its last answer
  gives to Claude artifacts, gists and sites on vercel.app, netlify.app, pages.dev, github.io, fly.dev, onrender.com,
  surge.sh, web.app or workers.dev; agents are told to save anything else themselves, and to group related files in
  a subfolder. A `.url` file with a `file:///` link (a page an agent made elsewhere on this Mac) opens that page in
  the browser too. Each link once. Links come first in the strip and open in the browser on a click,
  and *Info* lists them under *links*. Archiving keeps it; deleting the workspace (or removing its
  project) deletes it too, unless *Keep a deleted workspace's storage* is on. None for Terminals, Browsers and SSH hosts.
  An HTML or Markdown file opens in a viewer over the app (*Open HTML and Markdown artifacts*: *In Laki*, the default, or
  *In the browser*): HTML sandboxed, its scripts run and the CSS and pictures beside it load, it can’t read Laki or your files; Markdown
  rendered; with *Open in the browser* and *Show in Finder*.
- *Phone pushes*: a webhook that gets a push when an agent waits for you (on) or finishes (off), with what it asks.
  *Format*: ntfy (a topic's URL, e.g. `https://ntfy.sh/<a topic only you know>`, which the ntfy app subscribes to),
  Slack (an incoming webhook), Telegram (your bot's whole `sendMessage?chat_id=…` URL) or generic JSON (`{event,
  workspace, tab, agent, message, ts}`). Once per wait or turn; muted workspaces and tabs don't push. It goes to that
  URL only (`https://`: it holds what the agent asks), and *Send test* sends one now. A wait goes a moment later,
  with the agent's numbered choices as lines of text (JSON: `options` too). *Answer from the phone* (off by default)
  puts a button per choice on Telegram's push (taps from your bot's chat only) and ntfy's (the first 3; a tap posts
  to a reply topic, your topic's URL with a random part after it, shown there): a tap picks that choice, as a key
  press would, so it can allow a command. Laki asks Telegram or ntfy for taps every 5 seconds only while a pushed
  question waits (a day at most), and a tap counts only while the same menu is still on screen.
- *Pull requests*: how often Laki checks PRs (every minute by default), how many tries in a row *fix CI* and *fix
  conflicts* get (3), and the prompts the PR switches send (above, in
  *PRs*).
- *Prompt templates*: prompts you reuse. `{{prompt}}` is what you type when you use one, `{{project}}` and
  `{{base}}` the workspace's project and base branch, `{{pr}}` its PR (a PR link in the prompt, or a prompt of
  only `#123`: *Review {{pr}}, list what's risky* then takes just the number); a template
  without `{{prompt}}` gets the prompt after it (not a prompt `{{pr}}` took). Dates are the time you use it, any
  tokens in any order between `{{` and `}}`: `YYYY` `YY`, `MMMM` (October) `MMM` (Oct) `MM`, `DD` `D`, `dddd`
  (Monday) `ddd`, `HH` `H` `hh` (12-hour), `mm` `ss`, `A` (AM/PM), with `-:./,_` or spaces between: `{{DDMMYY
  HH-MM}}` → *051026 07-05* (`MM` right after an hour is the minutes; `mm` always is). They work in actions and
  the PR prompts too; what you type for `{{prompt}}` is left as it is. *Add template* starts from an example; the
  chips under each one put a variable in at the cursor. A project can have its own (its settings, below).
- *Agent variables*: `{{workspace}}`, `{{branch}}`, `{{path}}`, `{{port}}`, `{{pr}}` (its link), `{{project}}`,
  `{{base}}`, `{{storage}}`, `{{tab}}`, `{{agent}}` (claude, codex…), `{{date}}` (YYYY-MM-DD) and `{{time}}` (HH:MM)
  become the workspace's and the tab's as an action, a template, a scheduled prompt or a workflow reaches it: *Run the
  tests on {{branch}}, then comment on {{pr}}*. One with nothing to give (no PR yet) stays as it is, and a message you
  type is left alone.
- *Actions*: Run ▾'s shortcuts, each a name, who it's for (an agent, *Any agent*: whichever runs, or *Shell*: a command) and the prompt
  or command, e.g. `execute code review 2 times with --fix` for Claude, `execute $code-review and fix
  findings` for Codex, `bundle exec rails db:migrate` for a shell. The copy button duplicates one (to make the
  same for another agent); *Show* lists one agent's. Each has a slug beside its name (`xhigh-code-review`), set from
  the name as you type it and kept when you rename it, unique across your actions and every project's (type your own;
  one taken gets a `-2`): a workflow's agent block names the action by it (`use: xhigh-code-review`).
- *Voice* (experimental: turn it on in General › *Experimental*; off, the mic is macOS dictation and the section
  isn't there): how the prompt boxes' mic turns speech into text. *On this Mac* (the default) is macOS dictation, free
  (Fn twice starts it anywhere). *Cloud* has Laki record you and a speech-to-text model on OpenRouter write it down,
  with the OpenRouter key Laki AI uses (one key for both, set in either section): *Model* picks it (MAI-Transcribe 2
  by default: 60 languages, mixed in one sentence too, about $0.10 an hour of audio; Whisper, Parakeet, GPT-4o
  Transcribe and others, or *Another model…* for any id). Neither the audio nor the text is kept. *Hold Fn to talk*
  (on): hold Fn anywhere in Laki, talk, let go, and the text is typed where your cursor is; another key while you
  hold it, or Esc, drops it. Set System Settings › Keyboard › *Press 🌐 key to* to *Do Nothing*, so macOS doesn't
  open its emoji picker or dictation as well (*Open Keyboard settings*).
- *Agent skill*: installs a skill for Claude Code, Codex, Gemini, Grok or OpenCode in your home folder
  (`~/.claude/skills/laki`, `~/.codex/…`, `~/.gemini/…`, `~/.grok/…`, `~/.config/opencode/…`), so every session knows Laki: what it is, and how to drive it with its CLI (list
  projects and workspaces, start a workspace with an agent and a prompt, message agents, read their screens).
  *Extension creator* (`skills/laki-widget`, installed on its own) teaches them to make extensions: the files, the
  template language, JS extensions, actions, and checking one with `laki widget`.
  It holds the app's path: update it after moving the app. *Remove* takes only its own files. Below it, *MCP
  server*: the command that adds Laki to each agent as an MCP server (Copy, then run it in a terminal: it goes in
  the agent's own settings, which Laki never writes); OpenCode's `mcp add` only asks questions, so it gets the
  lines to merge into `~/.config/opencode/opencode.json`.
- *Remote access*: the email it lets in, how long, start and stop, the QR code and link (above).
- *Extensions*: the extensions in two lists, *Yours* (with *New extension*, above) and *Built in*, a row each (its name,
  what it shows, its size, how often it fetches, the last fetch; *Fetch now* on hover) with its switch: on or off; the
  folders they're found in (Laki's own, and more of yours, one per line), *Reload extensions* and *Working hours*. A
  click on one opens its page (above): the preview, live or with its sample, and its settings: its size (cells across
  × down, ½ a thin line), how often it fetches (minutes), its full view's size, *Fetch now*, its folder (in Finder, your
  editor or a terminal, or *Copy path*) and, in development mode, its *Logs*; its settings under them, saved as they
  change; Laki AI's chat beside them.
- *Release notes* (with *Development mode* on; also ⌘K *Release notes*): what's new in Laki, newest first; *Next* is what the coming version adds.
- *Resources* (also ⌘K *Resources*): memory and CPU now, refreshed every 3 seconds while it's open. macOS counts every
  process Laki starts as Laki's (the Force Quit window's number): each agent, its MCP servers, the dev servers in
  its tabs. *Laki itself* is the app's own processes and the daemon; the video, JS extensions (all in one process: one
  site), the preview's page, the floating bubbles, an agent browser and the sidebar's browser pages (*Browser: site*;
  a sign-in window too) each get a row of their own with *Stop*, which frees it until it's opened again (an extension: a
  click on it; the preview: *Load it again*; the bubbles: when an agent's state
  changes; a browser: the pages you aren't on, each back as you open it). The total line splits out *shells* (every
  shell tab) and *browsers*. Template extensions and the memes are drawn in the window's own
  process. What the daemon runs besides tabs gets a row each: *Laki AI* (its `claude -p` or `codex exec` while it
  answers), *Expose to the world* (each tunnel's cloudflared), *Shared tabs* (their cloudflared), *Remote access*, *SSH* (a host's connection) and a
  extension's fetch; *Stop* ends the AI's answer, a tunnel or remote access. The daemon's short commands (git, gh) count
  under *Laki itself*. Then each tab, biggest first (or busiest first: *By CPU*), with its processes under it (a
  click); the total has CPU beside memory (100% is one core) and a graph of both over the last minutes. *Sleep* ends an idle Claude or Codex
  tab's process now; *Open* goes to the tab.
  *Sleep idle agents after* (8 hours by default; Never, or 15 minutes to 8 hours) does it on its own for an idle Claude or Codex
  tab nobody is looking at, quiet that long. A sleeping tab keeps its screen and says so; looking at it, a key, or a
  message (`laki send`, a scheduled task, the PR buttons) resumes the chat (`--resume`), and a message waits until
  it's up. Never one with a dev server listening under it, getting PR feedback (the PR switches), or on an SSH
  host. An agent grows the longer it runs; a resumed one starts small.
- *Project settings*: each project's settings (below).

Selecting text in a terminal copies it. A tab whose agent you stop with Esc goes back to idle, and so does one
whose turn ends without a word (a resumed chat's recap): quiet for a few seconds, no "esc to interrupt".

## Project settings

Settings → *Project settings*, or ⋯ on a project then *Settings* (its page's Settings tab; Run ▾ → *Edit the run script…* opens its Run
tab). Saved as you type:
- Name.
- *Memory*: how many items are yours and how many agents learned; *Manage* opens the project page's *Memory* tab.
- *Notes*: yours, in Markdown (links, how to run it, who to ask). ⋯ on the project › *Notes* shows them rendered, with
  *Edit*; agents never see them (not in `laki ls --json` or MCP).
- *Scripts*, one tab each, any number of lines; *Import* fills one from a script file:
  - *Setup*: runs in each new worktree, e.g. `npm install`; agent and dev tabs wait for it.
    `$LAKI_PROJECT_PATH` is the repo itself, e.g. `cp "$LAKI_PROJECT_PATH/.env" .env`.
  - *Teardown*: runs when a workspace is deleted or archived.
  - *Run*: what ▷ Run starts, e.g. `npm run dev -- --port $PORT`.
  - *Test*, *Lint*, *Format*, *Deploy*: Run ▾'s, e.g. `npm test`; `.laki.json` takes them as `test`, `lint`, `format`
    and `deploy`.
- *Env*: `KEY=value` lines for every tab of the project's workspaces, and its setup and teardown.
- *Expose to the world*: who can open its tunnels, as addresses and `*@domains` (e.g. `me@x.dev, *@team.com`).
  The popup starts from it every time: *Only these emails*, filled in. Empty: *Anyone with the link*.
- *Prompt templates*: this project's, listed first under a new workspace's prompt here, then the global ones;
  one with a global one's name replaces it. Saved in the app only.
- *Actions*: Run ▾'s for this project, after the global ones; one with a global one's name and kind replaces
  it here (e.g. its own *Migrate*). Saved in the app only, not in `.laki.json`.
- *Worktrees* (a git repository here): the folder this project's new worktrees go in, `<folder>/<id>`: a path
  relative to the repo, `~/…`, or a whole one. Empty: Settings › General's. Saved in the app only.
- *Pull requests* (a git repository): what Laki may do to its PRs: *Merge*, *Merge when green*, *Approve*, *Close*
  (above, in *PRs*). Saved in the app only.

These are saved in the app. A field left empty falls back to a `.laki.json` in the repo, which a team can
commit. The page shows that file's values as placeholders:

```json
{ "setup": "npm install", "teardown": "docker compose down", "run": "npm run dev -- --port $PORT", "expose": "*@team.com", "env": { "NODE_ENV": "development" }, "copy": [".env*", "config/master.key"], "ports": { "3000": "web", "5432": "db" } }
```

Two of them live only there:
- `copy`: files git doesn't keep that a new worktree needs, as gitignore patterns. A `.worktreeinclude` at the repo's
  root (one pattern a line) does the same; both add up. They're copied from the repo's own
  checkout into each new or restored worktree, with their permissions, before setup and the agent start; one already
  there stays, and links that lead out of the repo are skipped (`daemon.log` lists what was copied).
- `ports`: names for the status bar's ports.

Env from the app and from `.laki.json` merge, key by key (the app's wins), then a preset's env goes on top.

Every workspace gets its own `$PORT` (3100, 3110, …).

## CLI

```bash
laki project add ~/code/app
laki project add devbox:~/code/app                      # a folder over SSH (below: Projects over SSH)
laki new app --prompt "fix the login redirect"          # worktree + claude with that prompt
laki new app --preset codex --base develop --name dark
laki new app --model opus --effort high --prompt "…"   # the agent's model and effort
laki new app --issue https://github.com/o/app/issues/12 # a GitHub issue as the prompt (gh)
laki new app --pr 57 --prompt "address the review"     # a worktree on PR #57's branch (gh pr checkout, forks too)
laki new app --link 57 --prompt "review it"            # about PR #57 without its branch: its status, checks and author
laki new app --fan claude,codex --prompt "…"            # a race: a worktree each, Compare in the app
laki new . --preset codex --prompt "…"                  # in a Laki tab: . is its own project (an agent's /laki:new)
laki ls [--json]
laki send fix-the-login --when-idle "now add tests"     # queued; typed in when the turn ends
laki progress 40 "writing the tests"                    # in an agent's tab: its estimate, shown on the tab
laki screen fix-the-login/claude
laki diff fix-the-login | run fix-the-login | ship fix-the-login -m "Fix redirect"
laki run fix-the-login test                             # the project's test script (lint, format, deploy) in its tab
laki screen shot                                        # the booted iOS Simulator's screen: a PNG's path
laki screen shot Safari | windows                       # an app's frontmost window | the windows open
laki screen tap 120 640 | swipe 200 700 200 200 | type "hi" | describe   # the simulator's hands (idb)
laki browser fix-the-login open /login                  # the agent browser (the app must be open)
laki browser fix-the-login fill "#email" a@b.c | click "button[type=submit]" | text | screenshot
laki archive fix-the-login | restore … | fork … | rm …
laki rename . "fix the login redirect"                  # in a Laki tab: . is its own workspace
laki pr . 42                                            # attach a PR (URL or number) to the workspace
laki memory . | memory add . "<a line>" [--mine] | memory rm . <id>   # the project's memory (Project memory)
laki schedule add app --when "weekdays at 9am" "triage new issues"   # a prompt on repeat
laki schedule add app --when "daily at 2am" --where folder-new --name "Deps {{DD-MM}}" "update the deps"
laki schedule | schedule log | schedule off <id> | schedule run <id> | schedule rm <id>
laki flow run my-flow app "add CSV export" [--dry]     # a workflow run (experimental: Workflows, below)
laki flow | flow show <run> | flow answer <run> <n> | flow stop <run>
laki widget | widget reload                             # the sidebar's extensions | read their folders again, fetch
laki widget on|off|run <id> [--ws <ws>]                 # show or hide one | fetch now (--ws: a per-workspace one's instance)
laki widget render <id> --full                          # the HTML its full view shows now
laki widget action <id> <action> [arg]                  # run one of its buttons' actions: what the app would show
laki widget kit [element] [--json]                      # the UI kit's elements: each one's props and sample
laki widget dev [folder]                                # dev mode: your extension's folder linked, on, watched; its runs as they come
laki widget dev --off <id|folder> | --list              # unlink one | the linked folders
laki widget new <name> [--kind <k>] [--dir <folder>]     # a starter: number, list, table, chart, note, launcher, button, form, panel, workspace, stream, tool, onefile
laki widget check [id|folder] [--no-run] [--ws <ws>]    # what's wrong with one: widget.json, ui, fixtures, its fetch once
laki widget push <id> [json | -] [--ws <ws>] [--merge]   # its data from a cron job, a git hook, CI (stdin with -)
laki widget tools [--json]                              # the extensions' tools for agents, their input and when to use them
laki widget tool <id> <action> [json] [--ws <ws>]       # call one (asked first unless the tool says never)
laki ai "what are my agents doing?"                     # ask Laki AI (Settings › AI): it acts, then answers
laki ai --image prs.png "review each of these PRs"      # with a screenshot
laki ai | ai log | ai new                               # the conversation | each call's tokens and cost | start over
laki open                                               # the app
laki mcp                                                # an MCP server on stdio (below)
laki stop                                               # stop the daemon (agents resume when it starts again)
laki daemon                                             # run the daemon in the foreground
laki serve --tailscale                                  # headless: the daemon and remote access (headless.md)
laki remote | remote stop                               # remote access's link (and PIN) | stop it
```

`laki screen` shot and windows work on this Mac (an app's window needs Screen Recording for Laki: System Settings ›
Privacy & Security › Screen & System Audio Recording). tap, swipe, type and describe need
[idb](https://fbidb.io) (`brew install facebook/fb/idb-companion`, then `pipx install fb-idb`); Settings › Agent skill
says whether it's found. They take points, and with idb a simulator screenshot is drawn in points too: a spot in the
picture is where to tap. MCP's `laki_device` does the same.

### MCP

`laki mcp` is an MCP server on stdio, for Claude Code, Codex, Gemini, Grok, OpenCode or any MCP client. Its tools: `laki_state`
(projects, workspaces, tabs and their status), `laki_new_workspace` (also from an issue or a PR, or a race with
`presets`), `laki_new_tab` (another agent in a workspace; `beside` a tab: a split in its tab), `laki_send`, `laki_attach_pr`, `laki_progress` (how far along the calling agent is, on its tab), `laki_screen`, `laki_diff`, `laki_browser` (the agent browser), `laki_schedules` and
`laki_schedule_add`, with Specs & Brainstorms on `laki_plans`, `laki_plan_read`, `laki_plan_new` and `laki_plan_write`, and with Workflows on `laki_workflows`, `laki_workflow_write` (saved for you to read: an agent can't run one it wrote until you save it in the app) and `laki_workflow_run`. None deletes, archives or ships; `laki_send` reaches agents only, never a shell or a question an
agent asks you. Add it with the command in
*Settings › Agent skill* (it has the app's paths), or with the CLI on your PATH:

```bash
claude mcp add -s user laki -- laki mcp
codex mcp add laki -- laki mcp
gemini mcp add -s user laki laki mcp
grok mcp add -s user laki -- laki mcp
```

OpenCode's `mcp add` only asks questions: put `"mcp": { "laki": { "type": "local", "command": ["laki", "mcp"] } }` in
`~/.config/opencode/opencode.json`.

### Links

`laki://` links open the app at a place; they select and fill in, and never start anything:

| link | opens |
|---|---|
| `laki://ws/<id>[?tab=<tab>]` | a workspace, or one of its tabs (a tab's *Copy link*) |
| `laki://new?project=<id>&prompt=…&preset=…&name=…` | the new-workspace page, filled in |
| `laki://schedules[/<project>]` | Scheduled tasks, filtered to a project |
| `laki://settings[/<section>]` | Settings (`general`, `appearance`, `remote`…) |
| `laki://board` | the Board |
| `laki://help` | Help |
| `laki://about` | About (the version, when it was built, and the website) |
| `laki://onboard` | Get started, the first steps (also the Help menu's *Get Started Again…*) |

`open 'laki://ws/fix-the-login'` works from a terminal, a note or a calendar invite.

### Recipes

Everything the app does, a script (or an agent with the skill) can do. `jq` ships with macOS.

```bash
# three agents on three tasks, at once
for t in "fix the login redirect" "add dark mode" "speed up the tests"; do
  laki new app --prompt "$t"
done

# who needs you: the tabs waiting for an answer
laki ls --json | jq -r '.tabs[] | select(.status == "waiting") | "\(.workspace)/\(.name)"'

# follow-ups, typed in one at a time as the agent's turns end
laki send fix-login --when-idle "now add tests and run them"
laki send fix-login --when-idle "then update the README"

# the same message to every idle Claude
laki ls --json | jq -r '.tabs[] | select(.agent == "claude" and .status == "idle") | "\(.workspace)/\(.name)"' |
  while read -r t; do laki send "$t" "rebase on main and fix any conflicts"; done

# watch an agent from another terminal
while sleep 5; do clear; laki screen fix-login --lines 30; done

# start the dev server and open it
laki run fix-login
open "http://localhost:$(laki ls --json | jq '.workspaces[] | select(.id == "fix-login") | .port')"

# a tab that runs the tests on every change
laki tab fix-login --cmd "npm test -- --watch"

# try another approach without losing this one: a new branch with the same chat
laki fork fix-login

# a nightly agent in a fresh worktree, named by its date
laki schedule add app --when "every day at 2am except weekends" --name "Nightly {{DD-MM}}" \
  "update the dependencies, run the tests and open a PR if they pass"

# review, then wrap up
laki diff fix-login | less
laki ship fix-login -m "Fix the login redirect"
laki archive fix-login
```

## Data

Data lives in `~/.laki`; set `LAKI_HOME` to use another folder. A Mac that ran Laki when it was called Laki
Electron keeps using `~/.laki-electron` (as long as there's no `~/.laki`): its worktrees are in there, and the
agents find their conversations by those paths. It holds:
- `state.json`: projects, workspaces, tabs and chat ids;
- `daemon.json`: the daemon's port and token (0600);
- `daemon.log`;
- `claude-settings.json`: the hooks Claude gets through `--settings`;
- `widgets/` (your extensions) and `widget-data/` (each one's settings and last data);
- `plans/`: specs and brainstorms (experimental), a folder each;
- Laki AI's: `ai-key` (the OpenRouter key, 0600), `ai-chat.json` (the conversation), `ai-calls.jsonl` (each ask's
  tokens and cost) and `ai/` (where claude -p and codex exec run);
- `worktrees/` and `run/`.

`~/.claude`, `~/.codex`, `~/.gemini`, `~/.grok` and `~/.config/opencode` are left alone, except the skill folders *Settings → Agent skill* writes when you click Install.

No telemetry. Laki goes online only for what you use: `gh` (PRs, issues, the extensions that use it), the agents' plan limits, Laki AI
(OpenRouter, or the agent it runs, with what you ask, the screenshot you paste and what its tools read: your
workspaces, agents' screens and diffs), cloudflared
(tunnels, remote access), your phone-push webhook, a meme when you click the smiley, and the YouTube video you ask the
sidebar for (youtube-nocookie.com).

## Updating

After pulling or changing the code, rebuild (`npm run pack`) and reopen the app. The running daemon stays the
old build until it restarts. When the app relies on something that daemon lacks, a yellow bar at the top says
*Restart Laki's daemon* (close Settings or any page over it to see it): click *Restart the daemon*, then again to confirm. Or run `laki stop` and open the app. Agents
come back resumed (`claude --resume`, `codex resume`, `gemini --resume`, `grok --resume`, `opencode --session`).
Shells come back in the folder they were in. An agent you started in one comes back too: claude resumes its own chat,
codex its last one in that folder. Any other program that was running (a dev server, a watcher) is typed back at the
prompt; press ⏎ to run it again. It isn't run for you, so a deploy caught halfway doesn't run twice. A Run tab that was
running starts again. This happens when the daemon stops properly (the yellow bar, `laki stop`, *Quit Laki Completely*,
a log out). After a crash, shells start fresh, and nothing comes back over SSH.

Coming from Laki Electron (the app's old name): build, quit *Laki Electron*, and open `dist/mac-arm64/Laki.app`.
It finds the same daemon and data, and says the daemon is older: restart it there. Then delete the old app. The
CLI is `laki` now (`npm link` again); the skill is `laki` (*Settings → Agent skill*: install it, and remove an
old `laki-electron` folder from `~/.claude/skills` and `~/.codex/skills` if you had one).

## Troubleshooting

- **The app shows "connecting to the daemon…"**: check `~/.laki/daemon.log`. To restart the daemon, run `laki stop`, then reopen the app.
- **Laki uses a lot of memory**: Settings › Resources says what: it's nearly always the agents (each Claude is
  200 MB to a few GB after a long day) and what they started. *Sleep* the idle ones, or set *Sleep idle agents
  after*.
- **An agent isn't found**: commands run through your login shell (`$SHELL -lic`), so `claude`, `codex` and the others must be on the PATH your `~/.zshrc` sets.
- **No PR badge**: run `gh auth status`. PRs are checked once a minute.
- **A host won't connect**: run `ssh <host>` in a terminal; it must sign in without asking anything (keys or agent, a
  known host key). Laki's error is in `~/.laki/daemon.log` and in the tab.

## Known limits

- **Build**: ad-hoc signed, not notarized (the first open of a download needs *Open Anyway*), one architecture per build (no universal app), no auto-update. The app is ~290 MB and uses ~500 MB of memory.
- **Startup**: when the daemon starts, every tab of every workspace starts (agents resume). After a reboot that can mean many agents at once.
- **Daemon**: if it dies, its terminals end. Agents come back resumed. Shells start fresh, without what ran in them (a stop brings that back too, see Updating).
- **Codex** has no prompt hook, so "running" is a guess (Enter in an idle codex tab).
- **How Laki follows the other agents**: OpenCode through a plugin of Laki's (`OPENCODE_CONFIG_DIR`, on top of your
  config), Gemini through hooks in a settings file of Laki's (`GEMINI_CLI_SYSTEM_DEFAULTS_PATH`, added to yours;
  Gemini versions with hooks, in folders Gemini trusts). Grok's terminal UI takes no hooks from outside `~/.grok`,
  so Laki reads its screen and window title: Enter or a prompt starts a turn, *Action Required* is waiting, a few
  quiet seconds end it and notify (a turn you started with Enter only after 8 seconds: a shorter one is likely a menu). Gemini without hooks works the same way. Laki never writes `~/.gemini`, `~/.grok` or `~/.config/opencode`.
- **Snapshots** keep 5,000 lines of scrollback.
- **Sleeping agents** live in the daemon's memory: a daemon restart resumes every tab, asleep or not. A process that
  left its tab's tree (a double fork) shows nowhere in Resources.
- **Fork** copies commits only; uncommitted changes stay behind.
- **SSH hosts**: a dropped connection (the Mac asleep) ends the host's tabs, as nothing holds them there; Enter
  resumes each. Keys or an agent only, no password prompts.
