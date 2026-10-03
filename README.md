# wbs — coding agents in parallel git worktrees

A macOS app for running Claude Code, Codex (or any command) side by side, each in its own git worktree,
with a terminal per tab, live agent status, a follow-up queue, diff, ports, PRs and ship.
Same shape as Superset: Electron + a separate terminal-host daemon (node-pty + @xterm/headless) + xterm.js.

## Build and run

```bash
npm install                      # if node_modules/electron/dist is missing: node node_modules/electron/install.js
npm run pack                     # → dist/mac-arm64/wbs.app (unsigned)
open dist/mac-arm64/wbs.app      # or copy it to /Applications
```

The app starts the daemon if none is running; the daemon keeps running (and your agents with it) when
the app quits. Data lives in `~/.wb-superset` (`WBS_HOME` overrides it).

CLI (`npm link` puts `wbs` on PATH; it uses `out/main/cli.js` after a build):

```bash
wbs project add ~/code/app
wbs new app --prompt "fix the login redirect"          # worktree + claude with that prompt
wbs new app --preset codex --base develop --name dark
wbs ls [--json]
wbs send fix-the-login --when-idle "now add tests"     # queued; typed in when the turn ends
wbs screen fix-the-login/claude
wbs diff fix-the-login | run fix-the-login | ship fix-the-login -m "Fix redirect"
wbs archive fix-the-login | restore … | fork … | rm …
wbs daemon                                             # foreground daemon; `wbs stop` stops it
wbs open
```

Development:

```bash
npm run dev          # electron-vite: Electron + renderer dev server on :5199
npm test             # node:test, ~25s; temp homes, fake claude/codex/gh, no network
npm run typecheck
npm run demo -- /tmp/wbs-demo   # a temp world (repo, 3 workspaces, fake agents) + a daemon; prints a URL
npm run dev:web      # the renderer alone on :5199; open the URL `demo` printed (port + token in the hash)
scripts/pack-smoke.sh          # packaged app: daemon + CLI + hooks via Electron's node, window screenshot
scripts/mem.sh                 # RSS with 3 workspaces × 2 tabs
```

## Project config: `.wb.json` in the repo

```json
{ "setup": "npm install", "teardown": "docker compose down", "run": "npm run dev -- --port $PORT" }
```

`setup` runs in a visible *setup* tab when a worktree workspace is created; the agent tab waits for it.
`teardown` runs when a workspace is deleted or archived. `run` is the *Run* button / `wbs run` (a *dev* tab).
Read from the workspace, else from the repo root (so it works before it's committed).

## Keys

| | |
|---|---|
| ⌘O | open a project folder (native picker), then a new workspace in it |
| ⌘F | find in the terminal and its scrollback: ⏎ next, ⇧⏎ previous, Aa match case, .* regex, esc closes |
| ⌘N | new workspace (project, base branch, agent, prompt; or *local*: the repo itself) |
| ⌘T / ⌘W | new shell tab / close tab (asks; stops its process) |
| ⌘1…⌘9 | tabs |
| ⌘↑ ⌘↓ | previous / next workspace |
| ⌘K | palette: fuzzy jump to any workspace or tab, and every action (diff, run, ship, fork, archive, restore, open PR/ports…) |
| ⌘D | diff panel |

Status: spinner running · ◆ waiting for you · ● finished while you weren't looking (goes once you look) ·
◷ usage limit · ○ idle · ✓/✖ process ended (ok / failed). A workspace shows its most urgent tab.
Sidebar: branch, `$PORT`, listening ports (click: open in the browser), PR number with CI (✓ ✗ …).

## Architecture

```
wbs.app (Electron)                          daemon (Electron's node, detached; or plain node)
  main: single instance, starts daemon  ──▶   127.0.0.1:<random>
        notifications, folder picker          POST /rpc    Authorization: Bearer <token>
  preload: conn/notify/pick/openExternal      GET  /ws?token=<token>   (WebSocket)
  renderer: React + xterm.js (WebGL)  ◀─WS─▶  token in <data>/daemon.json (0600); Origin must be
                                              file:// (the app) or absent (CLI); dev origins only with
wbs CLI / hooks (node) ─────── /rpc ──────▶   WBS_DEV_ORIGIN
                                              per tab: node-pty + @xterm/headless mirror
                                              state.json, worktrees, queue, lsof/gh scans
```

- **Sessions** (`src/daemon/session.ts`): every PTY is mirrored into an `@xterm/headless` terminal. Attach
  = snapshot (`@xterm/addon-serialize`: scrollback, colors, cursor, alt screen, modes) plus what serialize
  leaves out (cursor visibility and style, mouse encoding, scroll region), taken once the headless terminal
  has parsed everything written so far; the live stream follows on the same socket, in order. Resizes
  apply to the PTY and the mirror. Any number of clients can attach.
- **Terminal queries** (DA, DSR/CPR, DECRQM, DECRQSS, XTVERSION, OSC color) are answered exactly once: the
  newest attached client is the *responder*; other renderers swallow those queries via xterm.js parser
  hooks; with no client attached the headless terminal answers. Checked by a test and, live, with two
  renderers attached to one tab (`test/fakes/da-probe` gets 1 reply).
- **Agents**: commands run as `$SHELL -lic '<cmd>'` (PATH from your login shell even from Finder) with
  `TERM=xterm-256color COLORTERM=truecolor WB_WORKSPACE WB_TAB PORT`. Claude gets
  `--settings <data>/claude-settings.json` whose hooks run `wbs hook <state>` (absolute node/Electron +
  CLI path): SessionStart → resume id, UserPromptSubmit/Pre/PostToolUse → running, Notification
  (permission prompts) → waiting, Stop → idle + last answer, StopFailure → usage limit. Codex gets
  `-c notify=[…,"hook","done"]` (thread id, end of turn). `~/.claude` and `~/.codex` are never touched.
- **Resume**: state.json keeps projects, workspaces, tabs and resume ids. A daemon start brings every tab
  back: `claude --resume <id>`, `codex resume <id>`, shells fresh.
- Ports: `ps` process tree of each workspace's tabs × `lsof -iTCP -sTCP:LISTEN`, every 5s.
  PRs: `gh pr view <branch> --json number,state,url,statusCheckRollup`, every 60s.

## Features

| # | feature | status |
|---|---|---|
| 1 | daemon: `wbs daemon`, autostart from the app (detached, Electron as node), single instance | done |
| 2 | attach/reattach with snapshot, resize, multiple clients | done |
| 3 | projects: add with the native folder picker (+ Add project, ⌘O, palette; CLI), list, remove | done |
| 4 | workspaces: worktree `wb/<id>` from a base (default: current branch) or local; delete keeps the branch | done |
| 5 | tabs: claude, codex, shell, custom command; close kills; login shell; env | done |
| 6 | `.wb.json` setup (visible tab, agent waits) / teardown / run | done |
| 7 | `$PORT` = 3100 + n·10, unique, persisted | done |
| 8 | agent status via hooks, rolled up per workspace | done (codex: running is inferred from Enter; idle from notify) |
| 9 | macOS notification when a tab waits or finishes off screen; click focuses it | done (event flow tested; the native banner itself not checked visually) |
| 10 | GUI: sidebar, tab bar, terminal, ⌘N ⌘T ⌘W ⌘1-9 ⌘↑↓ ⌘K | done |
| 11 | resume after a daemon restart/reboot | done |
| 12 | diff panel (merge-base + uncommitted + new files) | done |
| 13 | listening ports per workspace, click to open | done |
| 14 | dev server (Run) | done |
| 15 | PR + CI status; Ship (commit, push, `gh pr create --fill`) in a ship tab | done |
| 16 | send now / queue when idle (UI + CLI) | done |
| 17 | CLI with `--json` | done |
| 18 | inbox | removed for now (status glyphs and notifications stay) |
| 19 | archive / restore | done |
| 20 | fork (`claude --resume <id> --fork-session` in a new worktree from this branch) | done (commits only: uncommitted changes aren't copied) |
| 21 | usage limits: ◷ until reset, then `continue`; queue waits | done |

## Known limits

- Unsigned, arm64 only, no auto-update, default Electron icon. `asar` is off (node-pty's helper binary
  must be a real file; simplest that way).
- Every tab of every workspace is started when the daemon starts (no lazy start): many workspaces mean
  many agents at once after a reboot.
- A daemon's death ends its PTYs (agents come back resumed, shells fresh). The daemon is not a launchd job.
- Codex without hooks: "running" is a guess (Enter in an idle codex tab), "idle" comes from notify.
- Sending while Claude's UserPromptSubmit hook hasn't reported yet (~0.2s) can type into a running turn.
- Snapshots keep 5000 lines of scrollback; the window title and the current SGR pen aren't restored.
- In dev (`npm run dev`), a daemon started earlier without `WBS_DEV_ORIGIN` refuses the dev renderer
  (`wbs stop` first). ⌘N/⌘T/⌘W work in the app; in a regular browser tab some are the browser's.
- PR polling runs `gh` once a minute per worktree workspace.
