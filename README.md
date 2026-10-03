# wbs (wb-superset)

A macOS app for running coding agents (Claude Code, Codex, or any command) side by side, each in its own
git worktree. You get a sidebar of projects and workspaces, tabs per workspace, real terminals you can split
into panes, and live agent status (running, waiting for you, finished). It also has a follow-up queue, a
side panel (files, changes, review), a Run button, dev servers, listening ports, PRs and ship. Agents keep running when you quit the app.

Electron + a terminal-host daemon (node-pty + @xterm/headless) + React + xterm.js, the same shape as Superset.

## Features

- **Workspaces**: one git worktree and branch per task (or the repo or a plain folder itself), with setup and
  teardown scripts, env, a `$PORT` of its own, and a name you can change.
- **Agents**: Claude Code, Codex or any command, started from presets (args, env). Live status per tab and
  workspace; notifications; a follow-up queue; resume after a restart; usage limits wait and continue.
- **Terminals**: real PTYs in tmux-style tabs and panes (drag to split), kept by a daemon while the app is
  closed. ⌘F finds with every match in yellow; copy on select; font, size, line height, weight, cursor
  and zoom, with a live preview.
- **New workspace prompt**: type, dictate (macOS dictation) or paste/drop screenshots; the agent gets the text
  and the images' paths.
- **PRs**: the workspace's PR and its CI in the status bar; switches that send failing CI or new review
  comments to the agent on their own; an info panel with the PR, its checks and what the agents said last.
- **Side panel** (⌥⌘B): the workspace's files (search, preview, new file or folder, changed files marked),
  its changes against the base branch, and its PR's checks and review comments. ⌘P finds a file by name.
- **Git**: ship (commit, push, open a PR), fork a workspace with its chat, archive and restore.
- **Scripts and ports**: setup, teardown and run scripts per project (any number of lines); ▷ Run starts the
  run script in its tab, ■ stops it; listening ports you click to open.
- **Look**: 9 themes, including Warp-style gradients; tab and workspace colors.
- **Keys everywhere**: ⌘ shortcuts, a ⌘K palette, and a letter for every menu item.

## Install

You need:

- macOS on Apple silicon
- Node 22.6+ (23 recommended) and npm
- git

Optional: `gh` (logged in, for PRs and ship), `claude` and/or `codex` on your PATH.

```bash
cd ~/projects/wb-superset
npm install            # if node_modules/electron/dist is missing: node node_modules/electron/install.js
npm run pack
```

The build produces `dist/mac-arm64/wbs.app` (unsigned). Open it from there, or copy it to /Applications:

```bash
open dist/mac-arm64/wbs.app
```

To put the CLI on your PATH as `wbs`:

```bash
npm link
```

## First run

1. Open the app. It starts its background daemon if one isn't running.
2. Add a project: **⌘O**, the folder icon at the top of the sidebar, or drag a folder from Finder onto the
   window. It can be a git repository or any other folder.
3. The new-workspace dialog opens. Pick an agent (claude, codex, shell, or a custom command) and,
   optionally, a first prompt.
   - For a git repository, also pick a base branch. The workspace gets a worktree in
     `~/.wb-superset/worktrees/<project>/<id>` on branch `wb/<id>`, its setup command runs, then the
     agent starts. *Local* works in the repo itself instead.
   - A folder without git always works in the folder itself; it has no branches, diff, PRs or ship.

## Using it

**Sidebar:** projects and their workspaces, one line each (status, name). The selected workspace's PR is in the status bar.
- ＋ on a project creates a new workspace in it.
- ⋯ on a project opens its menu:
  - *New workspace*;
  - *Settings…* (see Project settings below);
  - *Remove project*;
  - its archived workspaces, which you click to restore.
- Drag the sidebar's right edge to resize it; double-click the edge to reset. ⌘B (or the sidebar icon) hides
  and shows it.
- ⋯ (or a right click) also opens the project in any editor, Finder or terminal app you have.
- Right click a workspace for a color, *Rename…* (the name it shows; its folder and branch keep the id),
  *Info*, *Open in*, fork, archive and delete.
- Drag projects, and workspaces within a project, to reorder them.

**Tabs and panes**, tmux style: a tab holds one terminal or several, split side by side or stacked.
- ＋ in the tab bar opens a new tab: shell (⌘T), one of your agent presets (claude, codex, …) or a command.
- Splitting:
  - Drag a tab onto a pane's edge: it moves into that tab, on that side.
  - *Split right* / *Split down* (⋯ menu or ⌘K) open a new shell next to the active pane.
- Drag a pane's header to move the pane within its tab, or onto the tab bar to give it a tab of its own.
- Drag the dividers to resize.
- × on a pane closes that terminal; × on a tab closes all of its terminals. Both stop the process.
- ⌘1…⌘9 switch tabs.
- Each workspace remembers its tabs and splits.
- Right click a tab (or a pane's header) for *Rename*, a color, *Split right/down*, *Move to its own tab*,
  *Restart* (an ended agent or dev server), *Close* and *Close other tabs*. Claude tabs are orange and codex
  tabs teal unless you pick another color (or none).

**Menus:** every item has a key, shown on its right: press it while the menu is open (e.g. right click a
workspace, then D deletes it, R renames it). ↑↓ and ⏎ work too, and 0–8 pick a color.

**Find:** ⌘F searches the active pane's terminal and its scrollback; every match is yellow.
- ⏎ goes to the next match, ⇧⏎ to the previous.
- *Aa* matches case and *.\** turns on regex. Esc closes the search.

**Tab bar icons** (right side; hover for a tooltip):
- info (⌘I): the workspace info panel (below);
- editor: opens the workspace in Cursor, Zed, VS Code, Windsurf, Sublime Text, JetBrains IDEs, Xcode, Finder,
  Terminal, iTerm, Warp or Ghostty (the ones installed). ⌘E opens the default, which is the last editor picked;
- panel (⌥⌘B): the side panel (below); ⌘D opens it on *Changes*;
- ship: commit, push and open a PR, in a *ship* tab;
- search: the command palette (⌘K);
- ⋯: split right/down, fork, archive, delete;
- ▷ Run ▾: the project's run script in a *dev* tab, ■ Stop while it runs (^C). ▾ restarts it, shows its tab,
  opens `localhost:$PORT` or edits the script. With no run script, Run opens the project's scripts.

**Status bar** (bottom): branch ← base, `$PORT` and listening ports (click one to open it in the browser), the PR
(click to open it), its CI (`✓ 4/4`, `✗ 1 failing`, `… 2 running`; click for the checks), the *fix CI* and
*review* switches (see PRs below), and the workspace's path.

**Side panel** (⌥⌘B, the panel icon; drag its edge to resize; one panel at a time with the info panel):
- *Files*: the workspace's files (git's, ignored ones left out; a plain folder's, without `node_modules` and
  the like). Search filters by path. New file and new folder go in the selected folder; a new file opens in
  your editor. A click on a file previews it next to the terminal (text with line numbers, or an image),
  with *Open in editor*; a double-click opens it in the editor. Changed files are colored (modified, new, deleted) and their
  folders get a dot. Refresh, collapse all.
- *Changes*: the files changed against the base branch (committed, uncommitted and new) with +/−; click one
  for its diff, with links to preview the file or open it in the editor.
- *Review*: the PR with its checks, the *fix CI* / *review* switches and the send buttons, and the open
  review threads (from reviewers with write access and bots: what the agent would get). Click a thread's
  file to preview it at that line.

**Find files** (*Find files…*, first in ⌘K; or ⌘P): type parts of a path (`crt` finds `src/cart.ts`); names match
before folders. ↑↓ and Enter preview the file; ⌘W closes the preview.

**Info panel** (ⓘ or ⌘I): the workspace's name, branch, path and `$PORT`; its PR's title, author, state,
review decision, size, checks (each links to its run) and description; buttons that send the failing CI or
the open review comments to the agent now; and what each agent said last.

**PRs.** wbs finds the PR of each workspace's branch with `gh` (logged in) every minute.
- *fix CI*: when CI fails on a new commit, the failing checks and the end of their GitHub Actions logs go to
  the workspace's agent (when it's idle), asking it to fix, commit and push. Once per commit; after 3 tries
  in a row it stops and tells you.
- *review*: new review comments from others (unresolved inline threads) go to the agent, asking it to
  address them and push. Its own replies don't start another round.

**New workspace:** pick the project, base branch, name and agent, then the prompt:
- paste a screenshot (⌘V), drop image files on it, or pick them with the image icon; each shows as a
  thumbnail, and its path goes after your text;
- the mic starts macOS dictation (or press Fn twice). *mic & language…* opens System Settings → Keyboard →
  Dictation, where you pick the microphone and the languages;
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
notification; click it to jump there. Follow-ups queued with `wbs send --when-idle` show as `+n`.

### Keys

| key | |
|---|---|
| ⌘O | open a project folder (or drop one on the window), then a new workspace in it |
| ⌘N | new workspace |
| ⌘T / ⌘W | new shell tab / close tab (or the file preview, when one is open) |
| ⌘1…⌘9 | tabs |
| Esc | close a dialog or menu |
| ⌘↑ / ⌘↓ | previous / next workspace |
| ⌘K | palette |
| ⌘P | find a file in the workspace |
| ⌘D | changes (the side panel) |
| ⌥⌘B | side panel: files, changes, review |
| ⌘I | workspace info |
| ⌘F | find in the terminal |
| ⌘E | open in the editor |
| ⌘B | hide / show the sidebar |
| ⌘, | settings |
| ⌘+ / ⌘− / ⌘0 | terminal font bigger / smaller / default |

## Settings

⌘, or the gear at the top of the sidebar opens the settings page. Changes save as you make them, into
`state.json`. The page grows and shrinks with the terminal font size.
- *General*: the agent new workspaces start with, the branch prefix for new worktrees (default `wb/`),
  notifications, and environment variables for every session (a project's or preset's env wins over them).
- *Appearance*: the theme: Midnight (default), Dawn (light), Synthwave, Forest, Ember, and the Warp-style
  gradients Cyber Wave, Koi, Pink City, Leafy and Snowy (light). Terminals take its 16 colors.
- *Terminal*: font (the monospace fonts you have, or any other by name), font size (also ⌘+ / ⌘− / ⌘0),
  line height, letter spacing, font weight, minimum contrast (text lightens or darkens to stay readable),
  cursor style (block, bar, underline) and blinking, and copy selected text to the clipboard (on by default),
  with a live preview. Ligatures aren't drawn: xterm.js needs an add-on for them that isn't bundled.
- *Open in*: the default app for ⌘E, or a custom command that gets the folder as `$1` (e.g. `idea "$1"`).
- *Agent presets*: how agents start. A preset is Claude Code or Codex with extra arguments (e.g.
  `--model opus --permission-mode acceptEdits`), or any command, plus environment variables. Each one is in
  the new-tab menu and the new-workspace dialog. Edit `claude` and `codex` to change how every new one
  starts; a tab started from a preset uses its current settings when it restarts or resumes.
- *Agent skill*: installs a skill for Claude Code and Codex in your home folder (`~/.claude/skills/wbs`,
  `~/.codex/skills/wbs`), so every session knows wbs: what it is, and how to drive it with its CLI (list
  projects and workspaces, start a workspace with an agent and a prompt, message agents, read their screens).
  It holds the app's path: update it after moving the app. *Remove* takes only its own files.
- *Projects*: each project's settings (below).

Selecting text in a terminal copies it. A tab whose agent you stop with Esc goes back to idle, and so does one
whose turn ends without a word (a resumed chat's recap): quiet for a few seconds, no "esc to interrupt".

## Project settings

Settings → *Projects*, or ⋯ on a project then *Settings…* (Run ▾ → *Edit the run script…* opens its Run
tab). Saved as you type:
- Name.
- *Scripts*, one tab each, any number of lines; *Import* fills one from a script file:
  - *Setup*: runs in each new worktree, e.g. `npm install`; agent and dev tabs wait for it.
    `$WB_PROJECT_PATH` is the repo itself, e.g. `cp "$WB_PROJECT_PATH/.env" .env`.
  - *Teardown*: runs when a workspace is deleted or archived.
  - *Run*: what ▷ Run starts, e.g. `npm run dev -- --port $PORT`.
- *Env*: `KEY=value` lines for every tab of the project's workspaces, and its setup and teardown.

These are saved in the app. A field left empty falls back to a `.wb.json` in the repo, which a team can
commit. The page shows that file's values as placeholders:

```json
{ "setup": "npm install", "teardown": "docker compose down", "run": "npm run dev -- --port $PORT", "env": { "NODE_ENV": "development" } }
```

Env from the app and from `.wb.json` merge, key by key (the app's wins), then a preset's env goes on top.

Every workspace gets its own `$PORT` (3100, 3110, …).

## CLI

```bash
wbs project add ~/code/app
wbs new app --prompt "fix the login redirect"          # worktree + claude with that prompt
wbs new app --preset codex --base develop --name dark
wbs ls [--json]
wbs send fix-the-login --when-idle "now add tests"     # queued; typed in when the turn ends
wbs screen fix-the-login/claude
wbs diff fix-the-login | run fix-the-login | ship fix-the-login -m "Fix redirect"
wbs archive fix-the-login | restore … | fork … | rm …
wbs open                                               # the app
wbs stop                                               # stop the daemon (agents resume when it starts again)
wbs daemon                                             # run the daemon in the foreground
```

## Data

Data lives in `~/.wb-superset`; set `WBS_HOME` to use another folder. It holds:
- `state.json`: projects, workspaces, tabs and chat ids;
- `daemon.json`: the daemon's port and token (0600);
- `daemon.log`;
- `claude-settings.json`: the hooks Claude gets through `--settings`;
- `worktrees/` and `run/`.

`~/.claude` and `~/.codex` are never touched.

## Updating

After pulling or changing the code, run `npm run pack` and reopen the app. The running daemon stays the
old build until it restarts: run `wbs stop`, then open the app. Agents come back resumed
(`claude --resume`, `codex resume`); shells and dev servers start fresh.

## Troubleshooting

- **The app shows "connecting to the daemon…"**: check `~/.wb-superset/daemon.log`. To restart the daemon, run `wbs stop`, then reopen the app.
- **An agent isn't found**: commands run through your login shell (`$SHELL -lic`), so `claude` and `codex` must be on the PATH your `~/.zshrc` sets.
- **No PR badge**: run `gh auth status`. PRs are checked once a minute.

## Known limits

- **Build**: unsigned, arm64 only, no auto-update, default Electron icon. The app is ~290 MB and uses ~500 MB of memory.
- **Startup**: when the daemon starts, every tab of every workspace starts (agents resume). After a reboot that can mean many agents at once.
- **Daemon**: if it dies, its terminals end. Agents come back resumed; shells start fresh.
- **Codex** has no prompt hook, so "running" is a guess (Enter in an idle codex tab).
- **Snapshots** keep 5,000 lines of scrollback.
- **Fork** copies commits only; uncommitted changes stay behind.
- **Theme**: dark only.
