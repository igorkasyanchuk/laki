# wbs (wb-superset)

A macOS app for running coding agents (Claude Code, Codex, or any command) side by side, each in its own
git worktree. You get a sidebar of projects and workspaces, tabs per workspace, real terminals you can split
into panes, and live agent status (running, waiting for you, finished). It also has a follow-up queue, a
diff panel, dev servers, listening ports, PRs and ship. Agents keep running when you quit the app.

Electron + a terminal-host daemon (node-pty + @xterm/headless) + React + xterm.js, the same shape as Superset.

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
2. **⌘O** (or *+ Add project* at the bottom of the sidebar) opens a project: pick a git repository.
3. The new-workspace dialog opens. Pick:
   - an agent (claude, codex, shell, or a custom command);
   - a base branch;
   - optionally, a first prompt.

   *Local* runs in the repo itself instead of a new worktree.
4. The workspace gets a worktree in `~/.wb-superset/worktrees/<project>/<id>`, on branch `wb/<id>`. Its
   setup script runs, then the agent starts.

## Using it

**Sidebar**
- Shows projects, each with its workspaces.
- Each workspace row shows its status, branch, `$PORT`, listening ports (click one to open it in the browser) and its PR with CI status.
- Archived workspaces are listed at the bottom with *restore*.
- Drag the sidebar's right edge to resize it; double-click the edge to reset.

**Tabs**
- \+ in the tab bar (or ⌘T) opens a shell. New claude/codex tabs are in the ⌘K palette.
- ⌘W closes a tab (this stops its process), and middle-click does too. ⌘1…⌘9 switch tabs.

**Panes**
- Drag a tab from the tab bar onto the terminal.
  - Dropping near an edge splits that pane: side by side, or stacked top and bottom.
  - Dropping in the middle replaces what that pane shows.
- Drag a pane's header to move the pane, and drag the dividers to resize.
- × on a pane header closes the pane; the tab keeps running.
- Clicking a tab that isn't on screen shows it in the active pane.
- Each workspace remembers its layout.

**Find**
- ⌘F searches the active pane's terminal and its scrollback.
- ⏎ goes to the next match, ⇧⏎ to the previous.
- *Aa* matches case and *.\** turns on regex. Esc closes the search.

**Send bar** (under an agent tab)
- Type a follow-up and press ⏎ to send it; ⇧⏎ adds a newline.
- With *when idle* checked, the message is queued and typed in when the agent's turn ends.
- *n queued · clear* drops the queue.

**Toolbar**
- *Diff* (⌘D) shows changes against the base branch, including uncommitted and new files.
- *Run* starts the project's dev command in a *dev* tab.
- *Ship* commits, pushes and opens a PR, in a *ship* tab.
- *⌘K* opens the palette.

**⌘K palette**
- Jump to any workspace or tab.
- Run any action: new claude/codex/shell tab, diff, run, ship, fork, archive, delete, restore, open the PR or a port.

**Status**

| glyph | meaning |
|---|---|
| spinner | running |
| ◆ | waiting for you (permission prompt) |
| ● | finished while you weren't looking; clears when you look |
| ○ | idle |
| ◷ | usage limit (it types `continue` after the reset) |
| ✓ / ✖ | process ended (ok / failed) |

A workspace shows its most urgent tab. A tab that waits or finishes while off screen sends a macOS
notification; click it to jump to the tab.

### Keys

| key | |
|---|---|
| ⌘O | open a project folder, then a new workspace in it |
| ⌘N | new workspace |
| ⌘T / ⌘W | new shell tab / close tab |
| ⌘1…⌘9 | tabs |
| ⌘↑ / ⌘↓ | previous / next workspace |
| ⌘K | palette |
| ⌘D | diff |
| ⌘F | find in the terminal |

## Project config: `.wb.json`

Put this in the repo root (it's read from the workspace first, then the repo, so it works before you commit it):

```json
{ "setup": "npm install", "teardown": "docker compose down", "run": "npm run dev -- --port $PORT" }
```

- `setup` runs in a visible *setup* tab when a worktree workspace is created; the agent tab waits for it.
- `teardown` runs when a workspace is deleted or archived.
- `run` is the *Run* button.

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
