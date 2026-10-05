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
  needs you. A permission prompt's choices are buttons under the terminal, and *Allow* / *Deny* on its
  notification. *Mark as unread* puts a tab's ● back.
- **Race**: one prompt to several agents (claude, codex…), each in its own worktree; *Compare* lays them side by
  side (status, diff size, what each said last, the files it changed) and *Keep this one* archives the rest.
- **Issues and PRs**: `laki new <project> --issue <url>` starts a workspace on a GitHub issue (its title and text as
  the prompt); `--pr <url>` (or the new-workspace page's *Pull request*) on a PR's branch, a fork's too.
- **Terminals**: real PTYs in tmux-style tabs and panes (drag to split), kept by a daemon while the app is
  closed. ⌘F finds with every match in yellow; copy on select; drop files on one to type their paths; font,
  size, line height, weight, cursor and zoom, with a live preview.
- **New workspace prompt**: type, dictate (macOS dictation) or paste/drop screenshots; the agent gets the text
  and the images' paths. Prompt templates wrap it (`{{prompt}}`).
- **Plan limits**: a ring in the status bar fills to the 5-hour limit of your Claude and Codex plans; click
  it for each one (5-hour, weekly, per model) and when it resets.
- **PRs**: the workspace's PR and its CI in the status bar; switches that send failing CI, new review
  comments or merge conflicts to the agent on their own; an info panel with the PR, its checks and what the agents said last;
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
- **Git**: ship (commit, push, open a PR), fork a workspace with its chat, archive and restore.
- **Scripts and ports**: setup, teardown and run scripts per project (any number of lines); ▷ Run starts the
  run script in its tab, ■ stops it; listening ports you click to open, name (`.laki.json`), stop (✕), or expose to
  the world (a public trycloudflare.com link and its QR code, optionally only for some email addresses).
- **Look**: 86 themes, including Warp-style gradients and sixty-eight that also change shapes, borders and type;
  glass (a see-through window, as see-through as you set, with a color glow); Inter and six terminal fonts
  built in (JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Geist Mono); tab and
  workspace colors.
- **Remote access**: the whole app in a browser on another computer or your phone, through a Cloudflare
  tunnel that lets in one email address, for 1 to 24 hours or until you stop it; a QR code to open it.
- **Keys everywhere**: ⌘ shortcuts, a ⌘K palette, and a letter for every menu item.
- **A break**: the smiley in the tab bar shows a random meme from r/memes; *Next* for another.

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

The build is for the Mac it runs on (unsigned): `dist/mac-arm64/Laki.app` on Apple silicon, `dist/mac/Laki.app` on
Intel. Open it from there, or copy it to /Applications:

```bash
open "dist/mac-arm64/Laki.app"   # Intel: dist/mac/Laki.app
```

`npm run pack:x64` builds the Intel app on an Apple silicon Mac (it adds node-pty's Intel binary to
`node_modules`, unsaved; the next `npm install` drops it).

To put the CLI on your PATH as `laki`:

```bash
npm link
```

## First run

1. Open the app. It starts its background daemon if one isn't running. With no project yet it says what it found:
   git, whether `gh` is signed in (for PRs), and which agents are on your PATH.
2. Add a project: **⌘O**, the folder icon at the top of the sidebar, or drag a folder from Finder onto the
   window. It can be a git repository or any other folder.
3. The new-workspace page opens. Pick an agent (claude, codex, gemini, grok, opencode, shell, or a custom command) and,
   optionally, a first prompt.
   - For a git repository, also pick a base branch. The workspace gets a worktree in
     `~/.laki/worktrees/<project>/<id>` on branch `laki/<id>`, its setup command runs, then the
     agent starts. *Local* works in the repo itself instead.
   - A folder without git always works in the folder itself; it has no branches, diff, PRs or ship.

## Using it

**Sidebar:** projects (a branch icon for a repo, a folder for a plain folder) and their workspaces, one line each
(status, name; GitHub's mark when it has a PR: green open, gray draft, purple merged, red closed
or an open one's failing checks; a yellow ⚠ beside it: merge conflicts with its base; off in Settings › General). The
selected workspace's PR is in the status bar.
- A line divides the projects; each one's workspaces hang under it, indented on a guide line.
- *Diff size in the sidebar* (Settings › General, off by default) puts each workspace's diff size on its row
  (`+120 −8`: lines added and removed against its base, new files too; checked every 10 seconds). On hover the row
  shows ⋯, its menu.
- Archiving with nothing uncommitted happens at once, with *Undo* in the message that follows; with uncommitted
  changes it asks first (they go with the worktree; the branch stays).
- Click a project to fold its workspaces away (its busiest status and their count stay), again to unfold;
  *Collapse all projects* and *Expand all projects* are in ⌘K.
- ＋ on a project creates a new workspace in it.
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
  *Info*, *Mute notifications*, *Mark as unread*, *Copy link* (`laki://ws/<id>`), *Compare the race* (a race's
  workspace: the flag on its row), *Open in*, fork, archive and delete. A tab's menu has *Mute notifications*,
  *Mark as unread* (its ● again, until you look at it) and *Copy link* too.
- Drag projects, and workspaces within a project, to reorder them.

**Tabs and panes**, tmux style: a tab holds one terminal or several, split side by side or stacked.
- ＋ in the tab bar opens a new tab: shell (⌘T), one of your agent presets (claude, codex, gemini, …) or a command.
- Splitting:
  - Drag a tab onto a pane's edge: it moves into that tab, on that side.
  - *Split right* / *Split down* (⋯ menu or ⌘K) open a new shell next to the active pane.
- Drag a pane's header to move the pane within its tab, or onto the tab bar to give it a tab of its own.
- Drag the dividers to resize.
- × on a pane closes that terminal; × on a tab closes all of its terminals. Both stop the process.
- ⌘1…⌘9 switch tabs. Double click a tab to rename it.
- A tab closes by itself when its shell exits, or its agent ends cleanly (exit code 0). An agent that failed
  stays open to read, and ⏎ starts it again.
- Each workspace remembers its tabs and splits.
- Drop files or folders from Finder on a terminal: their paths are typed in (quoted when they need it), for a
  shell or an agent's prompt.
- When an agent asks something with numbered choices (a permission prompt, a question), they show as buttons
  under the terminal: a click picks one, as the arrows and ⏎ would. A permission prompt's notification has
  *Allow* (the first choice) and *Deny* (the last).
- Right click a tab (or a pane's header) for *Rename*, a color, *Split right/down*, *Move to its own tab*,
  *Restart* (an ended agent or dev server), *Close* and *Close other tabs*. Claude tabs are orange, codex
  teal, gemini blue, grok purple and opencode green, unless you pick another color (or none).

**Menus:** every item has a key, shown on its right: press it while the menu is open (e.g. right click a
workspace, then D deletes it, R renames it). ↑↓ and ⏎ work too, and 0–8 pick a color.

**Find:** ⌘F searches the active pane's terminal and its scrollback; every match is yellow.
- ⏎ goes to the next match, ⇧⏎ to the previous.
- *Aa* matches case and *.\** turns on regex. Esc closes the search.

**Tab bar icons** (right side; hover for a tooltip):
- smiley: a random meme from r/memes, for a break (*Next*, Esc). Fetched only when you click: Reddit's own, or
  meme-api.com when Reddit turns the request away;
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
  - *Agent actions*: a prompt for an agent (Claude Code, Codex, Gemini, Grok, OpenCode), listed while the workspace runs that agent. It goes to
    the focused tab if it's that agent, else its first tab, now or (while it works) when its turn ends.
  - *Terminal actions*: a command, typed into the focused shell, else the workspace's first, else a new one.

**Status bar** (bottom): branch ← base, `$PORT` (green while something listens on it) and the other
listening ports (click one to open it in the browser; a name from `.laki.json`'s `ports` beside it; ✕ stops what
listens there, after you confirm: SIGTERM, then SIGKILL 3 seconds later if it's still there; only your own processes
of that workspace), the PR (click to open it), its CI (`✓ 4/4`,
`✗ 1 failing`, `… 2 running`; click for the checks), *⚠ conflicts* when it has merge conflicts, the *fix CI*, *review* and *fix conflicts*
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
email address only.
- Set the email (kept in the app's settings for next time), pick how long (1, 2, 4, 8 or 24 hours, or Forever: until you stop it or the daemon) and click
  *Start remote access*. It needs `cloudflared` 2026.9.3 or newer (`brew install cloudflared`), like *Expose
  to the world*.
- cloudflared publishes the daemon at a random `https://….trycloudflare.com` link; the daemon serves the app's
  page there. Cloudflare asks for that email and sends it a one-time code, and the link also carries a key of
  its own (`?token=…`: it survives Cloudflare's sign-in, which drops anything after `#`).
- Once it's up: a QR code to scan with your phone, the link (copy, open), when it ends, and *Stop remote
  access*. The status bar says *Remote until 18:30* (forever: *Remote on*) while it runs; click it to get back here. ⌘K has it too:
  *Start remote access for you@…, 1 hour* (with an email set), *Remote access…*, and *Stop remote access*.
- On a phone the app has its own layout: the sidebar slides over, one pane at a time (split tabs show as
  separate tabs), the panels and Settings take the whole screen, and a row of keys a phone keyboard lacks
  (⌨ to show it, Esc, Tab, ⇧Tab, ⌃C, arrows, Enter) sits above the status bar. A terminal takes the size of the
  last screen that typed in it or came to the front, so coming back to the Mac gives it the Mac's size again.
- It stops on its own when the time is up, when you stop it, or with the daemon. Each start makes a new key, so
  an old link never works again.

**Board** (the columns icon at the bottom of the sidebar, *Board* in ⌘K, `laki://board`): every workspace as a card in
the column of where it is: *Running* (a usage limit too: it resumes by itself), *Needs you*, *Done*, *PR open*,
*Merged*; with its last answer, its PR and checks, and its turn's time when timers are on. Click a card to open the
workspace. *To do* holds prompts for later: write one (⌘⏎ adds it) for a project, then ▷ (or drag it onto another
column) starts a workspace on it with the default agent, and the to-do goes.

**Scheduled tasks** (the clock at the bottom of the sidebar, *Scheduled tasks* in ⌘K, or a project's ⋯ menu for its own): a prompt for an agent at
times you write in plain English.
- Pick the project (or *Another folder…*: it's added as a project), the agent (Claude Code, Codex, Gemini, Grok,
  OpenCode, or a preset of theirs), where it runs (*A new workspace each run*, a worktree; *In its folder, a new session each run*: the
  project's own checkout or folder, a new agent and sidebar row every run; *In its folder, one session*: the same
  agent gets every run; or one of the project's workspaces: its running agent of that kind gets the prompt, queued
  while it works, or a new tab starts), the prompt, and when: `every day at 2am except weekends`, `weekdays at 9:00`,
  `mon, wed and fri at 18:30`, `every 2 hours from 9am to 6pm`, `every 30 minutes`, `hourly on weekends`,
  `at 9am and 5pm`, `tomorrow at 7am` or `once at 23:00` (both run one time, then turn off). The form says how
  it read it and the next three runs. Every 5 minutes at most; no "every few days" (name the days).
- Dates in the name or the prompt: `{{DD-MM-YY}}`, `{{YYYY-MM-DD}}`, `{{HH:mm}}`, `{{ddd D MMM}}` (`Nightly deps
  {{DD-MM}}` → *Nightly deps 05-10*) become the run's date and time. A new workspace is named after the task, or
  with no name after the date and the prompt's first words (*05-10 02:00 update the deps and*), and gets a clock
  in the sidebar. A name a workspace already has gets four random characters (*Nightly deps 05-10-k3x9*).
- *Run now* runs one at once; the switch turns one off; *Runs* lists the last 50 (click one to go to its
  workspace); *All projects* narrows both lists to one project. The clock gets a red dot when a run failed since you last looked.
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
  with *Open in editor*; a double-click opens it in the editor. A right click opens it elsewhere: its default
  app, a browser (HTML, SVG, PDF, images, JSON, XML), any editor, Finder (shows it), a terminal (in its folder);
  or copies its path. Changed files are colored (modified, new, deleted) and their
  folders get a dot. Refresh, collapse all.
- *Changes*: the files changed against the base branch (committed, uncommitted and new) with +/−; click one
  for its diff, with links to preview the file or open it in the editor. Click a line of a diff to write a
  comment on it: *Comment on PR #n* posts it on GitHub at that line (`gh`; the line must be in the PR's diff,
  so commit and push first), *Send to the agent* gives it to the workspace's agent with the file and line
  (when its turn ends). ⌘⏎ does the first that applies, Esc closes it. A changed image (PNG, JPEG, GIF, WebP, SVG)
  shows before and after side by side, each with its size in pixels and bytes (one side when it's new or deleted);
  click one for full size.
- *Review*: the PR with its checks, the *fix CI* / *review* / *fix conflicts* switches and the send buttons, and the open
  review threads (from reviewers with write access and bots: what the agent would get). Click a thread's
  file to preview it at that line.
- *Preview* (also the toolbar's globe): the workspace's dev server in a browser: `$PORT` first, or a listening port (the menu), a path, back,
  forward, reload, open in your browser. The camera takes a screenshot of the page and sends it to the agent
  with what you write. The crosshair picks an element: hover outlines it, a click types its CSS selector, text,
  size, HTML (cut at 1,500 characters), its computed CSS (what isn't a default) and the path of a screenshot of
  just that element into the agent's prompt, without Enter, for you to say what to do with it; Esc stops (in the
  app only). It opens pages on this Mac (`localhost`, `127.0.0.1`; links may lead elsewhere), without
  popups, the camera, the microphone or clipboard reads. Its cookies are its own and kept. While the page has the focus, ⌘ keys go to it:
  click outside it first. In a browser (remote access), it works only on the Mac itself.

**File preview:** a Markdown file (`.md`) shows rendered (headings, lists, tables, code, links: they open in your
browser) or *Raw* (its lines, numbered); the switch is in its header and remembered.

**Find files** (*Find files…*, first in ⌘K; or ⌘P): type parts of a path (`crt` finds `src/cart.ts`); names match
before folders. ↑↓ and Enter preview the file; ⌘W closes the preview.

**Info panel** (ⓘ or ⌘I): the workspace's name, branch, path and `$PORT`; each public link (Expose to the
world: open, copy, and who can open it); its PR's title, author, state,
review decision, size, checks (each links to its run) and description; the PR switches, with a note when *fix CI* or
*fix conflicts* gave up (turn it off and on to try again); buttons that send the failing CI, the open review comments or
the merge conflicts to the agent now; and what each agent said last.

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

*Archive workspace when its PR merges* (Settings › *Pull requests*, off by default): the next check after a merge
archives the workspace, if it's clean: nothing uncommitted, no commit the PR doesn't have, no agent at work. Once per
PR: *Undo* in the message brings it back for good. One that can't go says *merged* in the sidebar.

What each sends is a prompt in Settings › *Pull requests*, which you can change: `{{pr}}` is the PR's number, `{{url}}`
its link, `{{base}}` its base branch; the failing checks or the review threads go after it. *Reset* puts the default
back. The info panel's *Send failing CI*, *Send review comments* and *Send merge conflicts* buttons send the same
prompts once, switches or not.

**New workspace** (a page, like Settings; Esc closes it): pick the project, *Pull request* (optional: a PR's number
or URL; the worktree is on its branch through `gh pr checkout`, a fork's as `<owner>/<branch>`, its base the PR's,
named `pr-<n>-<title>`; a fork's own `.laki.json` is ignored, so its setup never runs a stranger's code: the repo's
is used; when a workspace has that branch already, the message offers *Open it*), base branch, name and agent (for an
agent, its model, like `opus` or a full name, and for Claude Code and Codex its effort; both blank: the agent's
default, kept for its restarts and forks), then the prompt:
- paste a screenshot (⌘V), drop image files on it, or pick them with the image icon; each shows as a
  thumbnail, and its path goes after your text;
- the mic starts macOS dictation (or press Fn twice). *mic & language…* opens System Settings → Keyboard →
  Dictation, where you pick the microphone and the languages;
- *Template* (under the prompt, once you have one in Settings → *Prompt templates* or in the project's settings;
  the project's come first): the prompt goes in its `{{prompt}}`; the box below shows what the agent will get;
- *Race* (an agent, in a worktree): ＋ adds other presets; each gets a worktree of its own (named
  `<name>-<preset>`) on the same prompt, and Compare opens (also in a race workspace's menu and ⌘K). Compare shows
  each one's status, diff size, last answer and changed files; *Open* goes to it, *Keep this one* archives the
  others (*Undo* in the message brings them back);
- ⌘⏎ creates it.

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
those tabs (waiting first, with what they ask): a click opens one. With *Turn timers* on (Settings › General), a
working tab and its workspace show how long the turn has gone (`42s`, `12m`, `1h 5m`). Follow-ups queued with `laki send --when-idle` show as `+n`.

### Keys

| key | |
|---|---|
| ⌘O | open a project folder (or drop one on the sidebar; on a terminal it types the path), then a new workspace in it |
| ⌘N | new workspace |
| ⌘T / ⌘W | new shell tab / close tab (or the file preview, when one is open) |
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
| ⌘⏎ / ⇧⏎ | a new line in an agent's prompt (⏎ sends it) |
| ⌘E | open in the editor |
| ⌘B | hide / show the sidebar |
| ⌘, | settings |
| ⌘/ | help: keys, status glyphs, the main CLI commands (also the ? at the top of the sidebar) |
| ⌘+ / ⌘− / ⌘0 | terminal font bigger / smaller / default |

## Settings

⌘, or the gear at the bottom of the sidebar opens the settings page. Changes save as you make them, into
`state.json`. The page grows and shrinks with the terminal font size; on/off options are switches. *Find a
setting* (the box above the sections) lists the settings that match what you type; Enter or a click opens one,
lit for a moment.
- *General*: the agent new workspaces start with, the branch prefix for new worktrees (default `laki/`),
  *macOS notifications* (on by default; also *Turn macOS notifications off/on* in ⌘K) with a switch for each
  kind (waiting for you, finished, usage limit) and the sound (macOS's, or none), *plan limits* for
  Claude Code and for Codex (the status bar's ring; on by default), *Pull requests in the sidebar* (GitHub's
  mark on a workspace with a PR; on by default), *Menu bar item* (the count and its menu; on by default), *Turn
  timers* (off by default), *Diff size in the sidebar* (off by default), and environment
  variables for every session (a project's or preset's env wins over them). *Move to another Mac*: Export saves
  every setting of these pages to `laki-settings.json` (your env too: keep it private); Import on the other Mac
  reads it back (projects and their own settings don't move).
- *Appearance*: the interface font (Inter by default, SF Pro, or a few more), *Project names in the sidebar* (font,
  case, letter spacing, size and weight, each the theme's unless you pick one), *The sidebar* (its guide line, the
  line between projects, the indent and row height, each the theme's unless you pick one; *Button labels*: words
  beside Tasks (scheduled), Board and Settings at its bottom; hidden when the sidebar is too narrow for them), *Glass* (a see-through
  window: the desktop shows through, blurred; sliders for how see-through the window, the sidebar and the
  terminals are, and *Glow*: the theme's colors lit from two corners behind it), and the theme (newest first; yours is outlined and checked, in sight as the page opens; hovering one shows it on
  the whole window until the mouse leaves the list; the box above them finds
  one by name): Midnight (default), Dawn (light), Synthwave, Forest, Ember, Fjord, Graphite,
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
- *Terminal*: font (JetBrains Mono by default; Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono and Geist
  Mono are built in too; the monospace fonts you have, or any other by name), font size (also ⌘+ / ⌘− / ⌘0),
  line height, letter spacing, font weight, minimum contrast (text lightens or darkens to stay readable),
  cursor style (block, bar, underline) and blinking, copy selected text to the clipboard (on by default) and
  *Dim other panes* (in a split, the panes without the keyboard fade back; off by default), with a live preview. Ligatures aren't drawn: xterm.js needs an add-on for them that isn't bundled.
- *Open in*: the default app for ⌘E, or a custom command that gets the folder as `$1` (e.g. `idea "$1"`).
- *Agent presets*: how agents start. A preset is an agent (Claude Code, Codex, Gemini, Grok, OpenCode) with extra
  arguments (e.g. `--model opus --permission-mode acceptEdits`), or any command, plus environment variables. Each
  one is in the new-tab menu and the new-workspace page. The defaults are the agents on your PATH (*Reset to the
  agents installed* goes back to them). Edit `claude` or `codex` to change how every new one starts; a tab started from a preset uses its current settings when it restarts or resumes.
- *Phone pushes*: a webhook that gets a push when an agent waits for you (on) or finishes (off), with what it asks.
  *Format*: ntfy (a topic's URL, e.g. `https://ntfy.sh/<a topic only you know>`, which the ntfy app subscribes to),
  Slack (an incoming webhook), Telegram (your bot's whole `sendMessage?chat_id=…` URL) or generic JSON (`{event,
  workspace, tab, agent, message, ts}`). Once per wait or turn; muted workspaces and tabs don't push. It goes to that
  URL only, and *Send test* sends one now.
- *Pull requests*: how often Laki checks PRs (every minute by default), how many tries in a row *fix CI* and *fix
  conflicts* get (3), *Archive workspace when its PR merges* (off), and the prompts the PR switches send (above, in
  *PRs*).
- *Prompt templates*: prompts you reuse. `{{prompt}}` is what you type when you use one, `{{project}}` and
  `{{base}}` the workspace's project and base branch; a template without `{{prompt}}` gets the prompt after
  it. *Add template* starts from an example. A project can have its own (its settings, below).
- *Actions*: Run ▾'s shortcuts, each a name, who it's for (an agent or a terminal) and the prompt
  or command, e.g. `execute code review 2 times with --fix` for Claude, `execute $code-review and fix
  findings` for Codex, `bundle exec rails db:migrate` for a terminal.
- *Agent skill*: installs a skill for Claude Code, Codex, Gemini, Grok or OpenCode in your home folder
  (`~/.claude/skills/laki`, `~/.codex/…`, `~/.gemini/…`, `~/.grok/…`, `~/.config/opencode/…`), so every session knows Laki: what it is, and how to drive it with its CLI (list
  projects and workspaces, start a workspace with an agent and a prompt, message agents, read their screens).
  It holds the app's path: update it after moving the app. *Remove* takes only its own files. Below it, *MCP
  server*: the command that adds Laki to each agent as an MCP server (Copy, then run it in a terminal: it goes in
  the agent's own settings, which Laki never writes); OpenCode's `mcp add` only asks questions, so it gets the
  lines to merge into `~/.config/opencode/opencode.json`.
- *Remote access*: the email it lets in, how long, start and stop, the QR code and link (above).
- *Projects*: each project's settings (below).

Selecting text in a terminal copies it. A tab whose agent you stop with Esc goes back to idle, and so does one
whose turn ends without a word (a resumed chat's recap): quiet for a few seconds, no "esc to interrupt".

## Project settings

Settings → *Projects*, or ⋯ on a project then *Settings…* (Run ▾ → *Edit the run script…* opens its Run
tab). Saved as you type:
- Name.
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
laki new app --prompt "fix the login redirect"          # worktree + claude with that prompt
laki new app --preset codex --base develop --name dark
laki new app --model opus --effort high --prompt "…"   # the agent's model and effort
laki new app --issue https://github.com/o/app/issues/12 # a GitHub issue as the prompt (gh)
laki new app --pr 57 --prompt "address the review"     # a worktree on PR #57's branch (gh pr checkout, forks too)
laki new app --fan claude,codex --prompt "…"            # a race: a worktree each, Compare in the app
laki ls [--json]
laki send fix-the-login --when-idle "now add tests"     # queued; typed in when the turn ends
laki screen fix-the-login/claude
laki diff fix-the-login | run fix-the-login | ship fix-the-login -m "Fix redirect"
laki browser fix-the-login open /login                  # the agent browser (the app must be open)
laki browser fix-the-login fill "#email" a@b.c | click "button[type=submit]" | text | screenshot
laki archive fix-the-login | restore … | fork … | rm …
laki schedule add app --when "weekdays at 9am" "triage new issues"   # a prompt on repeat
laki schedule add app --when "daily at 2am" --where folder-new --name "Deps {{DD-MM}}" "update the deps"
laki schedule | schedule log | schedule off <id> | schedule run <id> | schedule rm <id>
laki open                                               # the app
laki mcp                                                # an MCP server on stdio (below)
laki stop                                               # stop the daemon (agents resume when it starts again)
laki daemon                                             # run the daemon in the foreground
```

### MCP

`laki mcp` is an MCP server on stdio, for Claude Code, Codex, Gemini, Grok, OpenCode or any MCP client. Its tools: `laki_state`
(projects, workspaces, tabs and their status), `laki_new_workspace` (also from an issue or a PR, or a race with
`presets`), `laki_send`, `laki_screen`, `laki_diff`, `laki_browser` (the agent browser), `laki_schedules` and
`laki_schedule_add`. None deletes, archives or ships. Add it with the command in
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
| `laki://ws/<id>[?tab=<tab>]` | a workspace, or one of its tabs (*Copy link* in their menus) |
| `laki://new?project=<id>&prompt=…&preset=…&name=…` | the new-workspace page, filled in |
| `laki://schedules[/<project>]` | Scheduled tasks, filtered to a project |
| `laki://settings[/<section>]` | Settings (`general`, `appearance`, `remote`…) |
| `laki://board` | the Board |
| `laki://help` | Help |
| `laki://about` | About (the version and the website) |

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
laki ls --json | jq -r '.tabs[] | select(.preset == "claude" and .status == "idle") | "\(.workspace)/\(.name)"' |
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
- `worktrees/` and `run/`.

`~/.claude`, `~/.codex`, `~/.gemini`, `~/.grok` and `~/.config/opencode` are left alone, except the skill folders *Settings → Agent skill* writes when you click Install.

No telemetry. Laki goes online only for what you use: `gh` (PRs, issues), the agents' plan limits, cloudflared
(tunnels, remote access), your phone-push webhook, and a meme when you click the smiley.

## Updating

After pulling or changing the code, rebuild (`npm run pack`) and reopen the app. The running daemon stays the
old build until it restarts. When the app relies on something that daemon lacks, the status bar says *daemon
older than the app · restart*: click it, then again to confirm. Or run `laki stop` and open the app. Agents
come back resumed (`claude --resume`, `codex resume`, `gemini --resume`, `grok --resume`, `opencode --session`);
shells and dev servers start fresh.

Coming from Laki Electron (the app's old name): build, quit *Laki Electron*, and open `dist/mac-arm64/Laki.app`.
It finds the same daemon and data, and says the daemon is older: restart it there. Then delete the old app. The
CLI is `laki` now (`npm link` again); the skill is `laki` (*Settings → Agent skill*: install it, and remove an
old `laki-electron` folder from `~/.claude/skills` and `~/.codex/skills` if you had one).

## Troubleshooting

- **The app shows "connecting to the daemon…"**: check `~/.laki/daemon.log`. To restart the daemon, run `laki stop`, then reopen the app.
- **An agent isn't found**: commands run through your login shell (`$SHELL -lic`), so `claude`, `codex` and the others must be on the PATH your `~/.zshrc` sets.
- **No PR badge**: run `gh auth status`. PRs are checked once a minute.

## Known limits

- **Build**: unsigned, one architecture per build (no universal app), no auto-update. The app is ~290 MB and uses ~500 MB of memory.
- **Startup**: when the daemon starts, every tab of every workspace starts (agents resume). After a reboot that can mean many agents at once.
- **Daemon**: if it dies, its terminals end. Agents come back resumed; shells start fresh.
- **Codex** has no prompt hook, so "running" is a guess (Enter in an idle codex tab).
- **How Laki follows the other agents**: OpenCode through a plugin of Laki's (`OPENCODE_CONFIG_DIR`, on top of your
  config), Gemini through hooks in a settings file of Laki's (`GEMINI_CLI_SYSTEM_DEFAULTS_PATH`, added to yours;
  Gemini versions with hooks, in folders Gemini trusts). Grok's terminal UI takes no hooks from outside `~/.grok`,
  so Laki reads its screen and window title: Enter or a prompt starts a turn, *Action Required* is waiting, a few
  quiet seconds end it and notify (a turn you started with Enter only after 8 seconds: a shorter one is likely a menu). Gemini without hooks works the same way. Laki never writes `~/.gemini`, `~/.grok` or `~/.config/opencode`.
- **Snapshots** keep 5,000 lines of scrollback.
- **Fork** copies commits only; uncommitted changes stay behind.
