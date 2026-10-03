# AGENTS.md

Notes for coding agents working on **wb-superset** (`wbs`): how the code works and how to change it
safely. User-facing docs are in `README.md`. This is a prototype successor to wb
(`~/projects/specdrop-cli`, tmux + iTerm). That repo is read-only from here; ideas and code are ported
from it (limits, hooks).

## Build, test, run

```bash
npm install
npm run typecheck                 # tsc --noEmit
npm test                          # node:test, ~25s
npm run pack                      # electron-vite build + electron-builder --dir → dist/mac-arm64/wbs.app
npm run dev                       # Electron + renderer dev server on :5199
```

- **Tests** are `node --test` with type stripping (`test/*.test.ts`), no framework.
  - `test/helpers.ts` `fresh()` gives each test a temp `WBS_HOME` and `HOME`, its own daemon, and the
    fakes in `test/fakes` first on PATH: `claude`, `codex`, `gh`, a shell `tsh`, and `da-probe` (counts
    terminal query replies). No network.
  - Never let a test touch the real `~/.wb-superset`, `~/.claude` or `~/.codex`.
- **Trying the UI in a browser**:
  1. `npm run demo -- /tmp/wbs-x` builds a temp world (a repo, 3 workspaces, fake agents) and a daemon
     that accepts the dev origin. It prints a URL with the port and token in the hash.
  2. `npm run dev:web` serves the renderer on :5199; open that URL.
  3. Afterwards stop it: `WBS_HOME=/tmp/wbs-x/data node out/main/cli.js stop`, then stop vite.
- `scripts/pack-smoke.sh` checks the packaged app (daemon, CLI and hooks through Electron's node, plus a
  window screenshot). `scripts/mem.sh` measures RSS with 3 workspaces × 2 tabs.
- The user runs their own daemon from `~/.wb-superset` with real agents in it. Never stop it and never
  point tests at it.

## Architecture

```
wbs.app (Electron)                          daemon (Electron's node, detached; or plain node)
  main: single instance, starts daemon  ──▶   127.0.0.1:<random>
        notifications, folder picker          POST /rpc    Authorization: Bearer <token>
  preload: conn/notify/pick/openExternal      GET  /ws?token=<token>   (WebSocket)
  renderer: React + xterm.js (WebGL)  ◀─WS─▶  token in <data>/daemon.json (0600); Origin must be
                                              file:// (the app) or absent (CLI); dev origins only via
wbs CLI / hooks (node) ─────── /rpc ──────▶   WBS_DEV_ORIGIN
                                              per tab: node-pty + @xterm/headless mirror
                                              state.json, worktrees, queue, lsof/gh scans
```

### API

`src/daemon/main.ts` `api`: the same methods over HTTP and WebSocket.

- state: `ping`, `state`, `hook`, `watchLimits`, `shutdown`;
- projects and workspaces: `projectAdd`/`projectRm`, `projectSet` (name, config), `projectFile` (the repo's `.wb.json`), `branches`, `wsNew`/`wsRm`/`wsArchive`/`wsRestore`/`wsFork`;
- tabs and agents: `tabNew`/`tabClose`, `send`, `queueClear`;
- worktree actions: `diff`, `run`, `ship`;
- terminals: `screen`, `input`, `resize`, `view`, `detach`.

WebSocket events:
- `state`: the whole view, debounced 30 ms;
- `data` and `responder`: per tab;
- `turn`: waiting, done or limit, for notifications;
- `open` / `close`: the connection's own status.

`view` carries `tab` (the pane with the keyboard), `tabs` (every pane on screen) and `focused`. Tabs
on screen in a focused window get no ● (`viewed`/`setView` in `core.ts`).

### Sessions

`src/daemon/session.ts`: every PTY is mirrored into an `@xterm/headless` terminal.

- **Attach** sends a snapshot, built with `@xterm/addon-serialize`, plus what serialize leaves out:
  cursor visibility and style, mouse encoding, scroll region.
- The live stream follows on the same socket, in order.
- Any number of clients can attach.

### Terminal queries

Queries (DA, DSR/CPR, DECRQM, DECRQSS, XTVERSION, OSC color) are answered exactly once.

- The newest attached client is the *responder*.
- Other renderers swallow those queries through xterm.js parser hooks (`Term.tsx`).
- With no client attached, the headless terminal answers.

### Agents and hooks

Commands run as `$SHELL -lic '<cmd>'`. The environment adds:
- `TERM=xterm-256color`, `COLORTERM=truecolor`;
- `WB_WORKSPACE`, `WB_TAB`, `PORT`.

Claude gets `--settings <data>/claude-settings.json`. Its hooks run `wbs hook <state>`, using an absolute
node/Electron path and the CLI's path, and map to states:

| hook | state |
|---|---|
| SessionStart | records the resume id |
| UserPromptSubmit, Pre/PostToolUse | running |
| Notification (permission prompts) | waiting |
| Stop | idle, plus the last answer, then delivers the next queued message |
| StopFailure | usage limit (`limits.ts`) |

Codex gets `-c notify=[…,"hook","done"]`, which reports the thread id and the end of a turn.

### Projects

A project is a git repository (its top level) or any other folder (`git: false`: local workspaces only,
no branches, diff, PRs or ship). `config` (setup, run, teardown), set in the app, wins field by field over
the repo's `.wb.json` (`projectConfig`).

### Resume

`state.json` keeps projects, workspaces, tabs and resume ids. Starting the daemon brings every tab back:
`claude --resume <id>`, `codex resume <id>`; shells start fresh.

### Scans

- Ports: the `ps` process tree of each workspace's tabs, matched against `lsof -iTCP -sTCP:LISTEN`, every 5s.
- PRs: `gh pr view <branch> --json number,state,url,statusCheckRollup`, every 60s.

### Renderer

`src/renderer/src`:

- **`App.tsx`**: the sidebar, tab bar, toolbar, send bar, palette items and keys.
  - Keys are handled in a capture-phase `keydown` through the `act` map; xterm never sees ⌘ keys.
  - Per-viewer UI state is in `localStorage`:
    - `wbs.ws`: the selected workspace;
    - `wbs.tabs`: the selected tab per workspace;
    - `wbs.groups`: each workspace's tabs, each a split tree of sessions;
    - `wbs.side`: the sidebar width.
- **`Term.tsx`**: one xterm per pane. It attaches on mount and detaches on unmount, and swallows terminal
  queries unless it is the responder.
- **`layout.ts`**: tabs, tmux style. A UI tab is a split tree whose leaves are daemon tabs (sessions), so a
  session is in exactly one tab and nothing nests. Pure functions: `groupsOf` (stored tabs minus ended
  sessions, plus one tab per unplaced session), `move` (a pane or a whole tab next to a pane, or out to the
  tab bar), `insert`, `keep`, `resize`, `place`. Tested in `test/layout.test.ts`.
- **`Panes.tsx`**:
  - panes are absolutely placed siblings keyed by tab, so splitting never remounts a terminal;
  - `useTabDrag` is pointer-based (not HTML5 DnD) and finds the drop target with `elementFromPoint`:
    a pane's nearest edge, or the tab bar (`[data-tabbar]`);
  - `SideHandle` resizes the sidebar.
- **`Find.tsx`**: the ⌘F bar (`@xterm/addon-search`).
- **`ui.tsx`**: line icons (`Icon`, `IconButton`) and popup menus (`useMenu`).
- **`panels.tsx`**: the new-workspace dialog, palette, project settings, prompt, diff panel and add-project dialog (the last
  only for the web dev renderer, which has no folder picker).
- **`api.ts`**: the WebSocket client. In Electron the address comes from the preload bridge; in a browser,
  from the URL hash.

**Shared files:** `layout.ts`, `Panes.tsx`, `Find.tsx` and `ui.tsx` are identical copies of the files in
`~/projects/wb-spike/frontend/src/`. Change both copies.

## Files

| file | what |
|---|---|
| `src/main/index.ts` | Electron main: single instance, starts the daemon, window (hiddenInset title bar), menu, notifications, `pick-folder` IPC |
| `src/preload/index.ts` | `bridge`: conn info, notify, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab |
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, shutdown |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, scans, diff, run, ship, archive/fork, view |
| `src/daemon/session.ts` | node-pty + headless mirror, snapshot, attach/detach, responder |
| `src/daemon/limits.ts` | usage-limit reset parsing (from wb) |
| `src/shared/conn.ts` | data dir, `daemon.json`, `ensureDaemon` (autostart), `rpc` |
| `src/shared/types.ts` | view types shared by daemon, CLI and renderer |
| `src/cli/main.ts` | the `wbs` CLI and `wbs hook` |
| `bin/wbs.js` | CLI entry: the built `out/main/cli.js`, else the TypeScript source |
| `test/` | `daemon`, `cli`, `e2e`, `snapshot`, `limits`, `layout` tests; `helpers.ts`; `fakes/` |
| `scripts/` | `demo.ts`, `pack-smoke.sh`, `mem.sh` |

## Conventions

- **Keep it small.** Use node's stdlib plus the existing deps (Electron, node-pty, xterm and its addons,
  React); no new dependencies. Mark deliberate shortcuts with a `ponytail:` comment naming the limit.
- **`wbs hook` must never fail or block the agent.**
- **Never write** `~/.claude/settings.json` or `~/.codex/*`. Agents get settings and notify through
  flags only.
- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check. Keep both on any new
  endpoint.
- **Colors** come from CSS variables in `styles.css` (`:root`). The terminal theme reads them through `css('--…')`.
- **`asar` is off**, because node-pty's helper must be a real file. The packaged daemon runs on Electron's node.
- **User-facing text** is short and plain. When adding commands or keys, update `README.md` (keys, CLI)
  and the CLI's usage.
- **Commits** end with the `Co-Authored-By` trailer. Never push.
