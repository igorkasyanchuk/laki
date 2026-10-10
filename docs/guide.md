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
  notification (and, if you opt in, on a Telegram or ntfy push). *Send a message later* (the toolbar's ⋯) types a
  message into an agent at a time you pick. *Mark as unread* puts a tab's ● back.
- **Race**: one prompt to several agents (claude, codex…), each in its own worktree; *Compare* lays them side by
  side (status, diff size, what each said last, the files it changed) and *Keep this one* archives the rest.
- **Issues and PRs**: `laki new <project> --issue <url>` starts a workspace on a GitHub issue (its title and text as
  the prompt); `--pr <url>` on a PR's branch, a fork's too. A prompt
  that names a PR (`review https://github.com/o/r/pull/12`) names the workspace after it (`pr-12-<title>`) and links
  it to that PR: its status and checks, without checking it out (so no fix/review switches: the agent couldn't push
  to it; `--pr` gives those).
- **Terminals**: real PTYs in tmux-style tabs and panes (drag to split), kept by a daemon while the app is
  closed. ⌘F finds with every match in yellow; copy on select; drop files on one to type their paths; font,
  size, line height, weight, cursor and zoom, with a live preview.
- **New workspace prompt**: type, dictate (macOS dictation) or paste/drop screenshots; the agent gets the text
  and the images' paths. Prompt templates wrap it (`{{prompt}}`).
- **Plan limits**: a ring in the status bar fills to the 5-hour limit of your Claude and Codex plans; click
  it for each one (5-hour, weekly, per model) and when it resets.
- **Resources**: memory and CPU for Laki and each tab (its agent, MCP servers, dev servers), in Settings or ⌘K; idle
  agents can sleep to give their memory back, and resume their chat when you look.
- **PRs**: the workspace's PR and its CI in the status bar; switches that send failing CI, new review
  comments or merge conflicts to the agent on their own; an info panel with the PR and its checks;
  a workspace archived once its PR merges (off by default).
- **Side panel** (⌥⌘B): the workspace's files (search, preview, new file or folder, changed files marked),
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
  workspaces, reviews PRs in their own worktrees, sends prompts, tells you what your agents are doing. It runs on
  OpenRouter (your API key) or on claude -p / codex exec, and every ask's tokens and cost are logged.
- **Git**: ship (commit, push, open a PR), fork a workspace with its chat, archive and restore.
- **Scripts and ports**: setup, teardown and run scripts per project (any number of lines); ▷ Run starts the
  run script in its tab, ■ stops it; listening ports you click to open, name (`.laki.json`), stop (✕), or expose to
  the world (a public trycloudflare.com link and its QR code, optionally only for some email addresses).
- **Look**: 86 themes, including Warp-style gradients and sixty-eight that also change shapes, borders and type;
  glass (a see-through window, as see-through as you set, with a color glow); Inter and eleven terminal fonts
  built in (JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Geist Mono, Hack, Iosevka,
  Inconsolata, Roboto Mono, Victor Mono); tab and
  workspace colors.
- **Remote access**: the whole app in a browser on another computer or your phone, through a Cloudflare
  tunnel that lets in one email address (or, if you type *confirm*, anyone with the link), for 1 hour to 3 days or
  until you stop it; a QR code to open it.
- **Keys everywhere**: ⌘ shortcuts, a ⌘K palette, and a letter for every menu item.
- **A break**: the smiley at the bottom of the sidebar shows a random meme from r/memes, r/ProgrammerHumor or r/wholesomememes (not
  one you've seen); *Next* (→, N) for another, a right click to copy, download or open it. Settings › General hides it.
- **Timers**: the stopwatch at the bottom of the sidebar starts a countdown, 1 minute to an hour (or any length), as
  many as you like; each shows as a bar over the bottom buttons (⏸ pauses it) and then rings: a sound and a dialog,
  or a notification (Settings › General › Timers), and pauses, plays or closes the
  video, or runs a command, if you like. Its *Stopwatch* counts up instead: start or pause, reset, close.
- **Widgets**: small live pages at the bottom of the sidebar, in a grid 3 cells across: a count, a chart, a table,
  each fed by a command or a script on a schedule, with a full view a click away (below: Widgets). Two come with
  Laki: *My PRs* and *Team PRs*; the *Widget creator* agent skill makes more.
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

To put the CLI on your PATH as `laki`:

```bash
npm link
```

## First run

1. Open the app (maximized the first time; after that where you left it: its size, place, maximized or full
   screen, on that screen if it's still there). It starts its background daemon if one isn't running. With no project yet it says what it found:
   git, whether `gh` is signed in (for PRs), whether `cloudflared` is there (optional: its ? says what for, public
   links and remote access) and which agents are on your PATH.
2. *Get started* opens once (everyone sees it once, after an update too): the first steps (add a project, start a
   workspace, Settings, a widget, actions, a prompt template, a terminal or a browser), each with a button that does it.
   A step ticks itself as you do it, or click its circle to tick it yourself. *Skip for now* closes it: what's left
   stays as a bar at the sidebar's bottom (a click opens it again, ✕ hides it; *Get started* in ⌘K or the Help menu's *Get Started Again…* brings it back);
   *Don't show again* hides both.
3. Add a project: **⌘O**, + at the top of the sidebar › *Project folder…*, or drag a folder from Finder onto the
   window. It can be a git repository or any other folder.
4. The new-workspace page opens. Pick an agent (claude, codex, gemini, grok, opencode, shell, or a custom command) and,
   optionally, a first prompt.
   - For a git repository, also pick a base branch. The workspace gets a worktree in
     `~/.laki/worktrees/<project>/<id>` (or the folder you pick in Settings › General › *Worktrees*, or in the
     project's settings) on branch `laki/<id>`, its setup command runs, then the
     agent starts. Untick *worktree* to work in the repo itself instead.
   - A folder without git always works in the folder itself; it has no branches, diff, PRs or ship.

## Using it

**Sidebar:** projects (a branch icon for a repo, a folder for a plain folder) and their workspaces, one line each
(status, name; GitHub's mark when it has a PR: green open, gray draft, purple merged, red closed
or an open one's failing checks; a yellow ⚠ beside it: merge conflicts with its base; off in Settings › General). The
selected workspace's PR is in the status bar.
- A line divides the projects; each one's workspaces hang under it, indented on a guide line.
- *Diff size in the sidebar* (Settings › General, off by default) puts each workspace's diff size on its row
  (`+120 −8`: lines added and removed against its base, new files too; checked every 10 seconds). On hover ⋯, its
  menu, slides in at the row's end and its marks move left to make room.
- Rest the mouse on a row for its card beside the sidebar: its branch and `$PORT`, what its agents are doing, the
  agent's last answer (or what it asks), its PR (author, state, checks, review, conflicts, lines added and removed),
  its diff size, ports and marks (from a scheduled task, muted, a reminder, a race). Move onto the card to click it:
  *Open*, *PR #n on GitHub* (or the PR's title), ⋯ its menu.
- Archiving with nothing uncommitted happens at once, with *Undo* in the message that follows; with uncommitted
  changes it asks first (they go with the worktree; the branch stays).
- Click a project to fold its workspaces away (its busiest status and their count stay), again to unfold;
  *Collapse all projects* and *Expand all projects* are in ⌘K.
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
- A shell tab running a command (a `git push`, `npm install`, a dev server) has the spinner, on its tab and its row,
  until its prompt is back. An agent you start there (`claude`, `codex`…) shows as an agent tab does instead: idle,
  working, asking (◆) or done (●), read off its screen (no notifications: start it in its own tab for those).
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
- *Send a message later…* (the toolbar's ⋯, when the workspace has an agent): pick the agent tab (the one in front
  first), the message and when: in a length (10m, 2h, 1h 30m; or 15 min, 30 min, 1 h, 2 h) or at a time (15:30,
  3pm: today, or tomorrow once it's past). Until then it's a timer bar over the bottom buttons with the message (its
  whole text on hover); its menu: *Send now*, *Edit…* (the message, the agent, the time), *Cancel it*. As it's due
  the message goes in, or waits in the agent's queue while it's busy, and a notification says so. Laki must be
  running: one due while it was closed isn't sent, and a message says so as it opens.
- The funnel at the top filters the workspaces: words in a name, branch, PR title, author or `#number`, and *Needs
  you*, *Working* or *With a PR*; the projects with none hide, groups too. Esc, the funnel again or the × in the
  field stops it (⌘K too).
- ⋯ on a project opens its menu:
  - *New workspace*;
  - *Collapse* / *Expand*;
  - *Settings…* (see Project settings below);
  - *Scheduled tasks…* (the project's tasks and runs; the count of its tasks on the right);
  - *Remove project*;
  - its archived workspaces, which you click to restore.
- Drag the sidebar's right edge to resize it; double-click the edge to reset. ⌘B (or the sidebar icon) hides
  and shows it.
- ⋯ (or a right click) also opens the project in any editor, Finder or terminal app you have.
- Right click a workspace for a color, *Rename…* (the name it shows; its folder and branch keep the id),
  *Info*, *Mute notifications*, *Remind me…*, *Pin to top* (it moves under *Pinned*, above the projects, until *Unpin*),
  *Mark as unread*, *Copy branch name*, *Refresh PR status* (asks GitHub now, not at the next check), *Attach a PR…* (a
  git workspace on a branch with no PR found: one opened another way, by its URL or number; also the status bar's
  *+ PR* and the info panel's PR section; a PR whose branch is another one is only linked: its status, no PR switches;
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
  project* gives it back), and a drag still moves a workspace into a group. A workspace's menu › *Move to group*: one of the project's groups (first in it), or *Out of its group*. A click folds it: they hide, the selected one too (the
  busiest one's mark stays on it), until another click. Drop a workspace on a group's head to put it first in
  that group (a folded one opens). Drag the head like a workspace; double click to rename; right click (or its ⋯)
  for a color (its name in a box of that color, after a dot), *New workspace here…* (the new-workspace page, set to
  put it first in this group), *Rename or set its template…* (a default prompt template: *New workspace here…* starts
  with it rather than the last one used) and *Remove group* (its workspaces stay).
- A workspace with someone else's PR shows its author's GitHub picture before the PR mark.

**Tabs and panes**, tmux style: a tab holds one terminal or several, split side by side or stacked.
- ＋ in the tab bar (⌘⇧N from the keyboard) opens a new tab: shell (⌘T), one of your agent presets (claude, codex, gemini, …) or a command.
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
workspace, then D deletes it, R renames it). ↑↓ and ⏎ work too, and 0–8 pick a color.

**Find:** ⌘F searches the active pane's terminal and its scrollback; every match is yellow.
- ⏎ goes to the next match, ⇧⏎ to the previous.
- *Aa* matches case and *.\** turns on regex. Esc closes the search.

**Tab bar icons** (right side; hover for a tooltip):
- info (⌘I): the workspace info panel (below);
- editor: opens the workspace in Cursor, Zed, VS Code, Windsurf, Antigravity, Sublime Text, JetBrains IDEs, Xcode, Finder,
  Terminal, iTerm, Warp or Ghostty (the ones installed). ⌘E opens the default, which is the last editor picked;
- panel (⌥⌘B): the side panel (below); ⌘D opens it on *Changes*;
- ship: commit, push and open a PR, in a *ship* tab;
- search: the command palette (⌘K);
- ⋯: split right/down, fork, archive, delete;
- ▷ Run ▾: the project's run script in a *dev* tab, ■ Stop while it runs (^C). ▾ restarts it, shows its tab,
  opens `localhost:$PORT` or edits the script. With no run script, Run opens the project's scripts.
  ▾ also lists your actions (Settings → *Actions*, and the project's), worked out as it opens:
  - *Agent actions*: a prompt for an agent (Claude Code, Codex, Gemini, Grok, OpenCode, or *Any agent*), listed while the workspace runs that agent. It goes to
    the focused tab if it's that agent, else its first tab, now or (while it works) when its turn ends.
  - *Terminal actions*: a command, typed into the focused shell, else the workspace's first, else a new one.

**Status bar** (bottom): branch ← base, `$PORT` (green while something listens on it) and the other
listening ports (click one to open it in the browser; a name from `.laki.json`'s `ports` beside it; ✕ stops what
listens there, after you confirm: SIGTERM, then SIGKILL 3 seconds later if it's still there; only your own processes
of that workspace), the PR (click to open it), its CI (`✓ 4/4`,
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
  and the info panel (⌘I) shows the public link too.
- It runs in the daemon until you stop it, delete or archive the workspace, or stop the daemon; closing the
  app leaves it on. A port with a tunnel stays in the status bar after its server stops.

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
- Once it's up: a QR code to scan with your phone, the link (copy, open), when it ends, and *Stop remote
  access*. The status bar says *Remote until 18:30* (forever: *Remote on*) while it runs; click it to get back here. ⌘K has it too:
  *Start remote access for you@…, 1 hour* (with an email set), *Remote access…*, and *Stop remote access*.
- It won't start, or Cloudflare's sign-in won't let you in: run `cloudflared tunnel login` once in a terminal (a
  browser page opens to pick your Cloudflare account). Settings › *Remote access* and Help say so too.
- When the page can't reach Laki it says why: Cloudflare's sign-in ran out (it reloads, to sign in again), the
  link ended (remote access stopped or started again: open the newest one), or the Mac is out of reach.
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
*Merged*'s ⋯ archives them all (one with uncommitted changes asks first). *To do* holds prompts for later: write one (⌘⏎ adds it) for a project, then ▷ (or drag it onto another
column) starts a workspace on it with the default agent, and the to-do goes.

**AI** (Settings › *AI* turns it on; then *AI* on the rail, *AI* in ⌘K,
`laki://ai`, `laki ai` in a terminal, or *Ask Laki AI* in the floating bubbles' +: a small window of its own over the app
you're in): Laki's own assistant, one conversation that works Laki with the same tools as
`laki mcp`. Ask *what are my agents doing?*, *start a code review of the PR with the login form*, *take the PR from
workspace ABC and start a new codex session to review it*, or paste a screenshot with three PR links and ask to review
each in its own workspace: it reads the workspaces, their PRs and agents' last answers, then starts workspaces (a PR's
on its branch), opens tabs, sends prompts, attaches PRs and schedules tasks, at once, without asking. It never archives, deletes, ships
or merges, and it does nothing until you ask. It reads like a chat: ⏎ asks (⇧⏎ a new line), the tools a turn ran fold
into one line you can open, *Stop* ends an ask, *New chat* starts over. A workspace or tab it names is a link: a click
opens it in Laki (from the bubbles' window too); a tool line's *Open* goes to the workspace it worked on. The *Calls* tab
lists every ask with its backend and model, tokens in and out, cost and time; *Info* says how it runs and how it's paid
for, what it spent today and this month (also in Settings › AI), and what it can do. It runs with:
- **OpenRouter**: any model there that can call tools (images too, for screenshots), `anthropic/claude-sonnet-5.5`
  unless you pick one; paid per token with your API key, which Laki keeps in `ai-key` in its data folder (0600), never
  in its settings and never shown again;
- **claude -p** or **codex exec**: the agent in the background on your plan, in `<data>/ai`, with `laki mcp` as its only
  tools (claude: Read too, for a screenshot; codex: read-only, without your config.toml's MCP servers), going on with
  the same session ask after ask (one conversation, it remembers; *New chat* starts a new session). claude's
  cost is Claude Code's own estimate; codex's is your plan's. *Your agent presets* in the Backend list run it as one of
  yours: a claude or codex preset with its env, another account (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), each with a session
  of its own.

*Steps* (unset: 20) caps the rounds of tool calls one ask may make.

**Scheduled tasks** (the clock at the bottom of the sidebar, *Schedule* on the rail in Rail and list, *Scheduled tasks* in ⌘K, or a project's ⋯ menu for its own): a prompt for an agent at
times you write in plain English. *New task* opens the form: the prompt, with the agent under it, then *When*, then
the project, where it runs and a name as chips, the way the new-workspace page has them. A form you leave (Esc, a click elsewhere) is there when the page opens again;
*Cancel* asks before it throws away what you changed, and ⌘⏎ saves it (Enter in a field doesn't).
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
until the agent's next run renews it. Settings › General turns each agent off (then nothing is read).

**Side panel** (⌥⌘B, the panel icon; drag its edge to resize; one panel at a time with the info panel):
- *Files*: the workspace's files (git's, ignored ones left out; a plain folder's, without `node_modules` and
  the like). Search filters by path. New file and new folder go in the selected folder; a new file opens in
  your editor. A click on a file previews it next to the terminal (text with line numbers, code in color up
  to 50 KB, or an image),
  with *Open in editor*; a double-click opens it in the editor. The pencil edits a text file right there, for small
  changes (no completion): ⌘S or *Save* writes it, Esc or *Cancel* drops the edit (asked first when you changed
  something; closing the preview, ⌘W, or opening another file asks too). If the file changed since you started (an
  agent at work), saving asks before writing yours over it. Line ends (CRLF) stay as they were; files over 512 KB or
  not UTF-8 open in your editor instead. A right click opens it elsewhere: its default
  app, a browser (HTML, SVG, PDF, images, JSON, XML), any editor, Finder (shows it), a terminal (in its folder);
  or copies its path. Changed files are colored (modified, new, deleted) and their
  folders get a dot. Refresh, collapse all.
- *Changes*: the files changed against the base branch (committed, uncommitted and new) with +/−; click one
  for its diff, with links to preview the file or open it in the editor (*Expand all* opens every file's, then
  *Collapse all* closes them). With a PR, *Here* / *PR #n* switch to the
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

**Info panel** (ⓘ or ⌘I, open or closed per workspace; drag its left edge to make it wider, double-click it for the default): a card of the workspace's
facts, a line each (rest on one for all of it; a copy button on hover): its id, branch, path, storage folder, `$PORT`
(a click opens `localhost:<port>`), each public link (*public*: anyone with the link, *shared*: only some emails), when it was made; its PR's title, author, state,
review decision, size, checks (each links to its run) and description, as in *Review*; the PR switches, with a note
when *failing CI* or *conflicts* gave up (turn it off and on to try again), and *Send now* beside one when there's
something to send to the agent now.

**PRs.** Laki finds the PR of each workspace's branch with `gh` (logged in) every minute (Settings › *Pull requests*:
1 to 30 minutes), and a couple of seconds after an agent's turn ends (at most every 20 seconds), so a PR the agent just
opened shows up at once. If an agent switches the workspace to another branch, Laki follows it (the status bar and the
PR are that branch's). Hover a switch for what it does, how often it checks and how many tries it gets.

The three switches in the status bar (and the info panel), each on or off per workspace, act on an open PR after each
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
side panel's *Review*, the info panel), in the status bar PR's right click and (approve) a workspace's right click,
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

*Archive workspace when its PR merges* (Settings › *Pull requests*, off by default): the next check after a merge
archives the workspace, if it's clean: nothing uncommitted, no commit the PR doesn't have, no agent at work. Once per
PR: *Undo* in the message brings it back for good. One that can't go says *merged* in the sidebar.

What each sends is a prompt in Settings › *Pull requests*, which you can change: `{{pr}}` is the PR's number, `{{url}}`
its link, `{{base}}` its base branch; the failing checks or the review threads go after it. *Reset* puts the default
back. *Send now* beside each switch (*Review*, the info panel) sends the same prompt once, switch or not; it shows
only when there's something to send: failing checks, open review threads, merge conflicts.

**New workspace** (a page, like Settings; Esc closes it): write the prompt; the agent and its model are picked
under it, where the work goes in the row below.
Closing it (Esc, ✕, a click in the sidebar) keeps what you typed as a draft: it's there when the page opens again,
until you create it or *Clear* it. Enter in a field never creates it; ⌘⏎ or *Create* does.
It starts from your last choices (project, its group, agent, model, template, worktree), never the last prompt.
- Under the prompt: ＋ (images), the mic and its ⌄, *Template*, the agent (a preset, *Shell*, *Custom command…* or
  *No agent*) and the model (the agent's default, one of its models or *Another model by name…*; for Claude Code and Codex
  the effort too; both kept for its restarts and forks). Their menus have a filter box (type, ↑↓, ⏎), a line about each
  choice, the picked one in the accent with a check; the agent menu marks your default and, for another agent, offers
  *Make … the default for new workspaces*; Claude's models show how they compare in cost ($ to $$$$).
- The row below: the project and its group in one menu (with a filter past six projects; a group puts it first in that group; the project alone, first
  in the project), the base branch with *worktree* (untick it to work in the repo itself, on its current branch),
  the name (from the prompt when blank) and *More*: *Race*, and a box for a model typed by hand (like a full name) once you pick *Another model…*.
In a plain folder (or without a worktree), whose own workspace is there already, an agent or a prompt makes another
session beside it, in the same folder, named after the prompt; *No agent* gives the folder's own back. A new
workspace is never hidden: a folded project or group holding it, or the one you were on, opens. The prompt:
- paste a screenshot (⌘V), drop image files on it, or pick them with ＋; each shows as a thumbnail, and its path
  goes after your text;
- the mic starts macOS dictation (or press Fn twice). Its ⌄ says where the microphone and languages are picked
  (System Settings › Keyboard › Dictation) and opens it;
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
small window of its own over the app you're in, as the bubbles' + does. With *Turn timers* on (Settings › General), a
working tab and its workspace show how long the turn has gone (`42s`, `12m`, `1h 5m`). Follow-ups queued with `laki send --when-idle` show as `+n`.
**A new session from an agent**: in a Claude Code tab, `/laki:new <the task> with codex` (or claude, gemini, grok,
opencode; none named: claude) has the agent write the task up as a prompt and start it in a new workspace of this
project (`laki new .`), with that agent; it doesn't do the task itself. Laki gives its Claude Code tabs this command
through a plugin of its own (`--plugin-dir`, nothing written to `~/.claude`); other agents with the laki skill
installed (Settings › Agent skill) take `/laki:new …` in a prompt the same way. Not in SSH hosts' tabs.

With *Progress on tabs* on (Settings › General), Claude and Codex tabs started from then on are told to report how
far along their task is every 20–30 seconds (`laki progress 40 "writing tests"`; Claude may run it without asking):
the tab shows `40%` over a bar, its tooltip what they're on, until the turn ends. Other agents get `LAKI_PROGRESS=1`
and report through the laki skill (Settings › Agent skill) or MCP's `laki_progress`.

**The rail**, like Slack's: a narrow rail on the left with *Projects*, *Board*, *Schedule* (a red dot: a run failed),
*Terminal* and *Browser*, the kinds each with a count of their tabs that need you (or a dot while one works), and
*Settings* at its bottom (Settings › Appearance › Rail › *Labels* off: icons only and a narrower rail). Board and Schedule are pages
over the list (only the rail stays); Video, Meme and Timer stay at the list's bottom. The
list shows the kind you pick, and its rail button goes back to the last workspace you had there.
A workspace you go to some other way (⌘J, ⌘K, a notification, a link) shows its kind; ⌘↑/⌘↓ stay in the list, and the
filter looks through every kind. A phone always has one sidebar.

**The sidebar's style** (Settings › Appearance › Sidebar): *Compact* (a short line: the state and the name),
*Default* (the marks: PR, its author, timers), *Extended* (a second line: the branch, what the agent is doing, its
progress, the PR's title, the diff; a hover shows its ⋯ in a place kept for it, so nothing moves), *Cards* (a card each, with the agent's last answer) or *Status* (the row's edge
in its state's color: working, waiting, done, a limit; a thin line under it fills with the agent's reported progress,
or sweeps along while it works without one). *Icon size* sets the PR
mark, its author's picture and the other marks to one size.

### Widgets

Small live pages at the bottom of the sidebar, above its buttons, in a grid 3 cells across (a cell is 64 px tall, or
half that: ½, a thin line, like *Links*, its sites as plain words with a rule between them, wrapping when they don't fit),
plain values on the sidebar (no tiles; Settings › Widgets turns them on and off). A click on one opens its full view in a dialog, small, medium or large (its *view* in
Settings › Widgets: large for wide tables; ↻ fetches now, the sliders its settings).
Links open in the browser; a widget's buttons can run commands its `widget.json` names (*Review in Laki*). While one
runs, a toast in the bottom right says so (and the button waits); what it prints decides what shows after: a line as
a toast, or JSON with `toast` and `modal` (a dialog with a title, text and up to 4 buttons, each running another of
its actions, opening a link or closing it; none: OK). A widget's page can do the same from its script:
`laki.toast(text)`, `laki.modal({ title, text, buttons })`.

Each widget is a folder: `widget.json` (its name, size in cells, settings, how often it fetches, and the command
or JS script that fetches its data, as JSON) and `widget.html` (what the tile shows and what the full view shows).
The fetch and the buttons' commands run in the widget's folder, so they can run its own scripts in any language:
`sh fetch.sh`, `python3 fetch.py`; each setting comes as `$WIDGET_<NAME>`, all of them as JSON in
`$LAKI_WIDGET_CONFIG`.
Laki looks in `<data>/widgets/` and the folders you add in Settings › Widgets; *Reload widgets* reads them again,
no restart. A widget fetches when it's turned on, when its settings change, and every few minutes (its own
*Fetch every*) while the app is open; what it fetched last is kept in `<data>/widget-data/<id>.json`, with your
settings. A failed fetch keeps the last data and shows a red dot (its tooltip, and Settings › Widgets, say why:
what the command printed last, or what the script threw).

A widget's settings each have a kind: text, a number, an on/off, one of a few choices, or a list (logins, labels:
typed as chips, Enter or a comma after each).

*Working hours* (Settings › Widgets › *Fetch only*): when widgets fetch on their own, in plain English: `9am-9pm
weekdays`, `8:00 to 18:30 except fri`, `9am-6pm, no weekends`, `noon-6`, `10pm-6am` (overnight). Outside them nothing fetches until they start again;
*Fetch now* and a change of settings still do. Empty: any time the app is open.

Three come with Laki, off until you turn them on in Settings › Widgets:
- *My PRs*: your open PRs in a repo (*Repo*: `owner/name` or its GitHub link; *Author*: `@me`, or someone's login;
  blank: you) counted: open, drafts, with conflicts, and with each of up to 3 labels (*Count label 1–3*); the full
  view (large) has the counts and the PRs grouped by what they need: conflicts, failing CI, changes asked, approved,
  in review, drafts, each with its labels, CI, review and date.
- *Team PRs*: the open PRs of your team (*GitHub logins*, a chip each; one query per login, so a busy repo doesn't
  time out) in a repo: how many; the full view (large) lists them with labels, CI, review and conflicts, a filter by
  author (a click on a name too) and by words, sorting, *Open PR* and *Review in Laki* (a new workspace on the PR with the *Review prompt*; set *Laki project* to the project's name; a toast while it's made, then *Review started* with *Open it*).
  *Review command* runs a shell command of yours instead (`$PR` is the PR's URL, `$PR_NUMBER` its number, `$LAKI_CLI`
  the laki command: `"$LAKI_CLI" new myapp --pr "$PR" --preset codex --prompt 'Review it'`), and *Button* renames the
  button.
- *Links*: sites you open often, a click away in your default browser (Linear, New Relic, lunch): each chip of
  *Links* is `Label: https://…` (a bare URL: its host as the label; `mailto:` links open your mail).

My PRs and Team PRs take *Only with labels* (any of them; empty: all) and *Hide with labels* (`wip`, `do-not-merge`).

To make one, install the *Widget creator* skill (Settings › Agent skill) and ask your agent ("a widget with my
open issues"), or use any AI chat: Settings › Widgets › *Make one with AI* has the whole format as a prompt (type what
you want, copy it, paste it in the chat), then save the files it gives you in `<data>/widgets/<id>/` and press
*Reload widgets*. A widget without a script is drawn inside the app; one whose page has a `<script>` runs in a
sandboxed frame that can't reach the network or the app (its data comes from its fetch). `laki widget` lists,
reloads, fetches and renders them.

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

| key | |
|---|---|
| ⌘O | open a project folder (or drop one on the sidebar; on a terminal it types the path), then a new workspace in it |
| ⌘N | new workspace |
| ⌘T / ⌘W | new shell tab / close tab (or the file preview, when one is open); in a browser: a new page / close it |
| ⌘⇧N | the tab bar's ＋ menu: shell, an agent preset or a command, picked with ↑↓ and ⏎ (or the item's letter) |
| ⌘1…⌘9 | tabs |
| Esc | close a dialog or menu |
| ⌘↑ / ⌘↓ | previous / next workspace |
| ⌘J | the next tab that needs you (waiting first, then done unseen), across workspaces |
| ⌘K | palette |
| ⌘P | find a file in the workspace |
| ⌘D | changes (the side panel) |
| ⌥⌘B | side panel: files, changes, review, preview |
| ⌘I | workspace info |
| ⌘F | find in the terminal |
| ⌘S | save the file you're editing in the preview |
| ⌘⏎ / ⇧⏎ | a new line in an agent's prompt (⏎ sends it), also one started in a terminal tab |
| ⌘-click | a file or folder link in a terminal (Claude Code's paths): a file of the workspace opens in the preview, a folder in Finder, another document in its app (an app or a script: shown in Finder) |
| ⌘← / ⌘→, ⌥← / ⌥→, ⌘⌫ | in a terminal: the line's start / end, a word back / on, delete the line (Settings › Terminal) |
| ⌘E | open in the editor |
| ⌘B | hide / show the sidebar |
| ⌘, | settings |
| ⌘/ | help: keys, status glyphs, the main CLI commands, with a filter (⌘F or /; Esc clears it) and a link to this guide (also the ? at the top of the sidebar) |
| ⌘+ / ⌘− / ⌘0 | terminal font bigger / smaller / default (Settings or Help open: their size) |

## Settings

⌘, or the gear at the bottom of the sidebar opens the settings page. Changes save as you make them, into
`state.json`. The page grows and shrinks with the terminal font size; on/off options are switches. *Find a
setting* (the box above the sections) lists the settings that match what you type; Enter or a click opens one,
lit for a moment.
- *General*: the agent new workspaces start with, the branch prefix for new worktrees (default `laki/`),
  *macOS notifications* (on by default; also *Turn macOS notifications off/on* in ⌘K) with a switch for each
  kind (waiting for you, finished, usage limit) and the sound (macOS's, or none), *plan limits* for
  Claude Code and for Codex (the status bar's ring; on by default), *Pull requests in the sidebar* (GitHub's
  mark on a workspace with a PR; on by default), *Menu bar item* (the count and its menu; on by default), *Fun button* (the smiley at the bottom of the sidebar; on by default), *Turn
  timers* (off by default), *Diff size in the sidebar* (off by default), *Progress on tabs* (agents report how far
  along they are; off by default), *Timers* (a sidebar timer's end: Laki's dialog or a notification, and its sound), *Development mode* (an event log per workspace, ⋯ › *Logs*: each PR check with
  its checks, conflicts and review, what *fix CI*, *review* and *fix conflicts* sent to the agent or why not, what
  waited in its queue and went in, its tabs' turns and the command each tab started with; *Creation log* under it: what
  making each workspace ran, step by step (what was asked, git, the setup, the agent) or why it failed; and per widget, *Logs* in Settings › Widgets: each fetch, how
  long it took or why it failed, its actions; the last 500 lines each, in the daemon's memory; off by default), *Close tabs without asking* (off by default: closing a tab whose agent or server still runs asks first), *Worktrees* (the folder new worktrees go in, a folder per project inside it; empty: `~/.laki/worktrees`; a project's settings can pick its own; ones made already stay), and environment
  variables for every session (a project's or preset's env wins over them). *Move to another Mac*: Export saves
  every setting of these pages to `laki-settings.json` (your env too: keep it private); Import on the other Mac
  reads it back (projects and their own settings don't move). A file from another version comes in too: a setting
  this one keeps in another shape is left out (Import names it), the rest applies.
- *Appearance*: *Dock icon* (Laki's, or Dawn, Terminal, Glacier, Bubbles or Neon: the Dock and the app switcher show it
  from the moment Laki opens, after a restart or an update too; Finder keeps the app's own), the interface font (Inter by default, SF Pro, Geist, IBM Plex Sans, Roboto, Source Sans 3, Fira Sans, Manrope, a few of the Mac's, or a developer's monospace one: JetBrains Mono, Geist Mono, Fira Code and more), *Settings & Help size* (90% to 150%,
  over the terminal font's scaling; ⌘+ / ⌘− / ⌘0 change it while Settings or Help is open), *Accent color* (over the theme's: the
  selected row, buttons, the cursor; text on it black or white, whichever reads), *Corners* (square to very round,
  over the theme's: every corner it draws, its selected row, buttons and dialogs too; pills and circles stay round), *Tabs* (top by default; bottom, under the terminals, or a column left or right of them; a phone
  keeps them on top), *Project names in the sidebar* (font,
  case, letter spacing, size and weight, each the theme's unless you pick one), *The sidebar* (its guide line: thin,
  thick, dashed, dotted, big dots, accent, accent dots or none; the line between projects: a line, dashed, dotted,
  double or nothing; the indent, row height, text size and icon size, each the theme's unless you pick one; the style:
  Compact, Default, Extended, Cards or Status (the row's edge in the color of what its agent is doing, and a line under
  it that fills as the agent reports its progress, or sweeps while it works without reporting), above; *Button labels*: words
  beside Schedule, Board, Video, Meme, Timer and Settings at its bottom, in one row: the last ones lose their words when they don't fit),
  *Floating bubbles* (while you're in another app, a drop stuck to the screen's right or left edge, over every app and
  Space, with a circle per agent working or waiting for you (a pulse), two letters from its workspace's name inside (none the same; pr-, issue- and numbers skipped): hover one for
  its card, as the sidebar's: its name, project, branch and `$PORT`, its agents, what it asked or last said, its PR
  (state, checks, review, conflicts), diff size and ports; click to open it in Laki; drag it from anywhere on it (a circle too)
  up and down or to the other side, and it sticks to the nearer edge as you let go, where it stays; hidden while Laki is
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
  (System Settings › Accessibility › Display) the blur is plain grey, and Settings says so), without glass *Sidebar see-through*
  (a slider, 0 by default: the sidebar and the rail let the desktop through, blurred, like macOS's own sidebars, their
  hovers, lines and selection tints as with glass; the rest stays solid), and the theme (newest first; yours is outlined and checked; hovering one shows it on
  the whole window until the mouse leaves the list; the box above them finds
  one by name; the ☆ on a card's corner makes it a favorite: *Favorites*, a group of its own above the rest, and still in the full list): Midnight (default), Dawn (light), Synthwave, Forest, Ember, Fjord, Graphite,
  Velvet, Nightfall, Paper (light), Mist (light), and the Warp-style gradients Cyber Wave, Koi, Pink City, Leafy,
  Aurora, Sunset and Snowy (light); and fifty-eight ✦ themes that change more than colors: Phosphor (a CRT: mono,
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
  frames), Cockpit (an orange flight HUD with target brackets) and Islander (light: an island phone app).
  Terminals take its 16 colors.
- *Terminal*: font (JetBrains Mono by default; Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Geist
  Mono, Hack, Iosevka, Inconsolata, Roboto Mono and Victor Mono are built in too; the monospace fonts you have, or any other by name), font size (also ⌘+ / ⌘− / ⌘0),
  line height, letter spacing, font weight, minimum contrast (text lightens or darkens to stay readable),
  cursor style (block, bar, underline) and blinking, *Padding* (the space around the text: tiny, normal or roomy), *Scroll speed* (lines per wheel step: 3× by default, xterm's own
  is 1×; with ⌥ three times that), copy selected text to the clipboard (on by default), *Mac editing keys* (⌘← and
  ⌘→ go to the line's start and end, ⌥← and ⌥→ a word back and on, ⌘⌫ deletes the line, as iTerm's Natural Text
  Editing has them; on by default) and
  *Dim other panes* (in a split, the panes without the keyboard fade back; off by default) and *Focus the pane under
  the mouse* (in a split, moving the mouse onto a pane gives it the keyboard, no click needed; off by default), with a live preview. Ligatures aren't drawn: xterm.js needs an add-on for them that isn't bundled.
- *Open in*: the default app for ⌘E, or a custom command that gets the folder as `$1` (e.g. `idea "$1"`).
- *Agent presets*: how agents start. A preset is an agent (Claude Code, Codex, Gemini, Grok, OpenCode) with extra
  arguments (e.g. `--model opus --permission-mode acceptEdits`), or any command, plus environment variables. Each
  one is in the new-tab menu, the new-workspace page (and its races) and scheduled tasks; its switch takes one you
  don't use out of them (its tabs still start and resume). The defaults are the agents on your PATH (*Reset to the
  agents installed* goes back to them). Edit `claude` or `codex` to change how every new one starts; a tab started from a preset uses its current settings when it restarts or resumes.
  The chips under the arguments (`$PORT`, `$LAKI_WORKSPACE`, `$LAKI_TAB`, `$LAKI_PROJECT_PATH`, `$LAKI_STORAGE_FOLDER`) put a variable in at the
  cursor: the line goes through the shell, so they work there. Every tab also gets `LAKI_APP=true` (a program or
  skill can tell it runs in Laki), and an agent's `FORCE_HYPERLINK=1` (Claude Code's links show as their text, a click
  opens them; set it to 0 in an env to see the URLs).
  *Tell it about Laki* (on by default; Claude Code and Codex): each start adds a short note to the agent's system
  prompt (`--append-system-prompt`, Codex's `developer_instructions`; a preset whose arguments set their own keeps
  those, and so does Codex with `developer_instructions` in its `config.toml`: no note then): it runs in Laki, and how to name its workspace (`laki rename . "…"`), attach a PR (`laki pr . <n>`), hand a
  task to a new workspace, look at the app in the agent browser, and where to keep files for you, and a link to whatever it publishes (the storage folder, below).
- *Storage* (General): every workspace gets a folder of its own outside the repo, `$LAKI_STORAGE_FOLDER` in each of its
  tabs (agents and shells alike): `<data>/storage/<name>-<id>`, or under the folder you set. It's made with the
  workspace's first tab and keeps its path when the workspace is renamed. Ask an agent to put screenshots, reports
  or exports there; the info panel's *Storage* opens it, and the status bar's *Artifacts: n* (the files in it, hidden
  ones not counted; none at 0) opens it in Finder or shows them here: a strip of previews over the status bar, newest
  first; click one for a big view (images, text, Markdown rendered), ← and → for the others. A link to whatever an
  agent publishes for you (a Claude artifact, a deployed site, a gist) is kept there too, as a `<title>.url` file
  (Finder opens it in the browser), without anyone asking: Laki keeps what Claude's publish tools return (its
  *Artifact* tool, an MCP tool named publish, deploy, upload or share) and, for any agent, the links its last answer
  gives to Claude artifacts, gists and sites on vercel.app, netlify.app, pages.dev, github.io, fly.dev, onrender.com,
  surge.sh, web.app or workers.dev; agents are told to save anything else themselves. Each link once. Links come first in the strip and open in the browser on a click,
  and the info panel lists them under *links*. Archiving keeps it; deleting the workspace (or removing its
  project) deletes it too, unless *Keep a deleted workspace's storage* is on. None for Terminals, Browsers and SSH hosts.
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
  conflicts* get (3), *Archive workspace when its PR merges* (off), and the prompts the PR switches send (above, in
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
- *Actions*: Run ▾'s shortcuts, each a name, who it's for (an agent, *Any agent*: whichever runs, or a terminal) and the prompt
  or command, e.g. `execute code review 2 times with --fix` for Claude, `execute $code-review and fix
  findings` for Codex, `bundle exec rails db:migrate` for a terminal. The copy button duplicates one (to make the
  same for another agent); *Show* lists one agent's.
- *Agent skill*: installs a skill for Claude Code, Codex, Gemini, Grok or OpenCode in your home folder
  (`~/.claude/skills/laki`, `~/.codex/…`, `~/.gemini/…`, `~/.grok/…`, `~/.config/opencode/…`), so every session knows Laki: what it is, and how to drive it with its CLI (list
  projects and workspaces, start a workspace with an agent and a prompt, message agents, read their screens).
  *Widget creator* (`skills/laki-widget`, installed on its own) teaches them to make widgets: the files, the
  template language, JS widgets, actions, and checking one with `laki widget`.
  It holds the app's path: update it after moving the app. *Remove* takes only its own files. Below it, *MCP
  server*: the command that adds Laki to each agent as an MCP server (Copy, then run it in a terminal: it goes in
  the agent's own settings, which Laki never writes); OpenCode's `mcp add` only asks questions, so it gets the
  lines to merge into `~/.config/opencode/opencode.json`.
- *Remote access*: the email it lets in, how long, start and stop, the QR code and link (above).
- *Widgets*: *Make one with AI* (the prompt, above), the folders they're found in (Laki's own, and more of yours,
  one per line), *Reload widgets*, *Working hours*, and each widget in a row: on or off, its size (cells across ×
  down, ½ a thin line), how often it fetches (minutes), its full view's size, *Fetch now*, *Open*, its folder (in Finder, your editor
  or a terminal, or *Copy path*) and, in development mode, its *Logs*; its settings under it.
- *Release notes* (also ⌘K *Release notes*): what's new in Laki, newest first; *Next* is what the coming version adds.
- *Resources* (also ⌘K *Resources*): memory and CPU now, refreshed every 3 seconds while it's open. macOS counts every
  process Laki starts as Laki's (the Force Quit window's number): each agent, its MCP servers, the dev servers in
  its tabs. *Laki itself* is the app's own processes and the daemon; the video, JS widgets (all in one process: one
  site), the preview's page, the floating bubbles, an agent browser and the sidebar's browser pages (*Browser: site*;
  a sign-in window too) each get a row of their own with *Stop*, which frees it until it's opened again (a widget: a
  click on it; the preview: *Load it again*; the bubbles: when an agent's state
  changes; a browser: the pages you aren't on, each back as you open it). The total line splits out *shells* (every
  shell tab) and *browsers*. Template widgets and the memes are drawn in the window's own
  process. Then each tab, biggest first, with its processes under it (a click). *Sleep* ends an idle Claude or Codex
  tab's process now; *Open* goes to the tab.
  *Sleep idle agents after* (never by default; 15 minutes to 8 hours) does it on its own for an idle Claude or Codex
  tab nobody is looking at, quiet that long. A sleeping tab keeps its screen and says so; looking at it, a key, or a
  message (`laki send`, a scheduled task, the PR buttons) resumes the chat (`--resume`), and a message waits until
  it's up. Never one with a dev server listening under it, getting PR feedback (the PR switches), or on an SSH
  host. An agent grows the longer it runs; a resumed one starts small.
- *Projects*: each project's settings (below).

Selecting text in a terminal copies it. A tab whose agent you stop with Esc goes back to idle, and so does one
whose turn ends without a word (a resumed chat's recap): quiet for a few seconds, no "esc to interrupt".

## Project settings

Settings → *Projects*, or ⋯ on a project then *Settings…* (Run ▾ → *Edit the run script…* opens its Run
tab). Saved as you type:
- Name.
- *Notes*: yours, in Markdown (links, how to run it, who to ask). ⋯ on the project › *Notes* shows them rendered, with
  *Edit*; agents never see them (not in `laki ls --json` or MCP).
- *Scripts*, one tab each, any number of lines; *Import* fills one from a script file:
  - *Setup*: runs in each new worktree, e.g. `npm install`; agent and dev tabs wait for it.
    `$LAKI_PROJECT_PATH` is the repo itself, e.g. `cp "$LAKI_PROJECT_PATH/.env" .env`.
  - *Teardown*: runs when a workspace is deleted or archived.
  - *Run*: what ▷ Run starts, e.g. `npm run dev -- --port $PORT`.
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
laki new app --fan claude,codex --prompt "…"            # a race: a worktree each, Compare in the app
laki new . --preset codex --prompt "…"                  # in a Laki tab: . is its own project (an agent's /laki:new)
laki ls [--json]
laki send fix-the-login --when-idle "now add tests"     # queued; typed in when the turn ends
laki progress 40 "writing the tests"                    # in an agent's tab: its estimate, shown on the tab
laki screen fix-the-login/claude
laki diff fix-the-login | run fix-the-login | ship fix-the-login -m "Fix redirect"
laki browser fix-the-login open /login                  # the agent browser (the app must be open)
laki browser fix-the-login fill "#email" a@b.c | click "button[type=submit]" | text | screenshot
laki archive fix-the-login | restore … | fork … | rm …
laki rename . "fix the login redirect"                  # in a Laki tab: . is its own workspace
laki pr . 42                                            # attach a PR (URL or number) to the workspace
laki schedule add app --when "weekdays at 9am" "triage new issues"   # a prompt on repeat
laki schedule add app --when "daily at 2am" --where folder-new --name "Deps {{DD-MM}}" "update the deps"
laki schedule | schedule log | schedule off <id> | schedule run <id> | schedule rm <id>
laki widget | widget reload                             # the sidebar's widgets | read their folders again, fetch
laki widget on|off|run <id>                             # show or hide one | fetch now
laki widget render <id> --full                          # the HTML its full view shows now
laki widget action <id> <action> [arg]                  # run one of its buttons' actions: what the app would show
laki ai "what are my agents doing?"                     # ask Laki AI (Settings › AI): it acts, then answers
laki ai --image prs.png "review each of these PRs"      # with a screenshot
laki ai | ai log | ai new                               # the conversation | each call's tokens and cost | start over
laki open                                               # the app
laki mcp                                                # an MCP server on stdio (below)
laki stop                                               # stop the daemon (agents resume when it starts again)
laki daemon                                             # run the daemon in the foreground
```

### MCP

`laki mcp` is an MCP server on stdio, for Claude Code, Codex, Gemini, Grok, OpenCode or any MCP client. Its tools: `laki_state`
(projects, workspaces, tabs and their status), `laki_new_workspace` (also from an issue or a PR, or a race with
`presets`), `laki_new_tab` (another agent in a workspace), `laki_send`, `laki_attach_pr`, `laki_progress` (how far along the calling agent is, on its tab), `laki_screen`, `laki_diff`, `laki_browser` (the agent browser), `laki_schedules` and
`laki_schedule_add`. None deletes, archives or ships; `laki_send` reaches agents only, never a shell or a question an
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
- `widgets/` (your widgets) and `widget-data/` (each one's settings and last data);
- Laki AI's: `ai-key` (the OpenRouter key, 0600), `ai-chat.json` (the conversation), `ai-calls.jsonl` (each ask's
  tokens and cost) and `ai/` (where claude -p and codex exec run);
- `worktrees/` and `run/`.

`~/.claude`, `~/.codex`, `~/.gemini`, `~/.grok` and `~/.config/opencode` are left alone, except the skill folders *Settings → Agent skill* writes when you click Install.

No telemetry. Laki goes online only for what you use: `gh` (PRs, issues, the widgets that use it), the agents' plan limits, Laki AI
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
