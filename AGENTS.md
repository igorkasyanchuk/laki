# AGENTS.md

Notes for coding agents working on **Laki Electron** (CLI `laki-electron`): how the code works and how to change it
safely. User-facing docs are in `README.md`; the product, in `../requirements/`. Laki Electron is a successor to wb
(`~/projects/specdrop-cli`, tmux + iTerm). That repo is read-only from here; ideas and code are ported
from it (limits, hooks).

## Build, test, run

```bash
npm install
npm run typecheck                 # tsc --noEmit
npm test                          # node:test, ~25s
npm run pack                      # electron-vite build + electron-builder --dir → dist/mac-arm64/Laki Electron.app
npm run dev                       # Electron + renderer dev server on :5199
```

- **Tests** are `node --test` with type stripping (`test/*.test.ts`), no framework.
  - `test/helpers.ts` `fresh()` gives each test a temp `LAKI_ELECTRON_HOME` and `HOME`, its own daemon, and the
    fakes in `test/fakes` first on PATH: `claude`, `codex`, `gh`, a shell `tsh`, and `da-probe` (counts
    terminal query replies). No network.
  - Never let a test touch the real `~/.laki-electron`, `~/.claude` or `~/.codex`.
- **Trying the UI in a browser**:
  1. `npm run demo -- /tmp/laki-electron-x` builds a temp world (a repo, 3 workspaces, fake agents) and a daemon
     that accepts the dev origin. It prints a URL with the port and token in the hash.
  2. `npm run dev:web` serves the renderer on :5199; open that URL.
  3. Afterwards stop it: `LAKI_ELECTRON_HOME=/tmp/laki-electron-x/data node out/main/cli.js stop`, then stop vite.
- `scripts/pack-smoke.sh` checks the packaged app (daemon, CLI and hooks through Electron's node, plus a
  window screenshot). `scripts/mem.sh` measures RSS with 3 workspaces × 2 tabs.
- The user runs their own daemon from `~/.laki-electron` with real agents in it. Never stop it and never
  point tests at it.

## Architecture

```
Laki Electron.app (Electron)                          daemon (Electron's node, detached; or plain node)
  main: single instance, starts daemon  ──▶   127.0.0.1:<random>
        notifications, folder picker          POST /rpc    Authorization: Bearer <token>
  preload: conn/notify/pick/openExternal      GET  /ws?token=<token>   (WebSocket)
  renderer: React + xterm.js (WebGL)  ◀─WS─▶  token in <data>/daemon.json (0600); Origin must be
                                              file:// (the app) or absent (CLI); dev origins only via
laki-electron CLI / hooks (node) ─────── /rpc ──────▶   LAKI_ELECTRON_DEV_ORIGIN
                                              per tab: node-pty + @xterm/headless mirror
                                              state.json, worktrees, queue, lsof/gh scans
```

### API

`src/daemon/main.ts` `api`: the same methods over HTTP and WebSocket.

- state: `ping`, `state`, `hook`, `watchLimits`, `shutdown`, `settingsSet` (merged into `state.settings`), `apps` (installed apps a folder can open in, `APPS`), `openIn` (an app id, or `editor`: the default);
- projects and workspaces: `projectAdd`/`projectRm`, `projectSet` (name, config), `reorder` (projects or workspaces by id), `wsSet` (color), `projectFile` (the repo's `.laki.json`), `branches`, `wsNew`/`wsRm`/`wsArchive`/`wsRestore`/`wsFork`;
- tabs and agents: `tabNew`/`tabClose`, `tabSet` (name, color), `send`, `queueClear`;
- worktree actions: `diff`, `run`, `ship`; the side panel's: `files`, `fileNew`, `fileRead` (text up to 512 KB, an image as a data URL, or binary: size only), `prThreads`, `openIn` with a `file` (paths must stay inside the
  workspace: `inside`);
- the agent skill (Settings): `skills`, `skillSet` with an `agent` (claude, codex) and `on`;
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
- **Exit**: a signal reports code 128+signal. A shell's exit, or an agent's with code 0, closes its tab
  (`core.ts` `onExit`), unless the daemon ended it: closing, archiving and shutdown drop the session from `sessions`
  first, restarting replaces it.

### Terminal queries

Queries (DA, DSR/CPR, DECRQM, DECRQSS, XTVERSION, OSC color) are answered exactly once.

- The newest attached client is the *responder*.
- Other renderers swallow those queries through xterm.js parser hooks (`Term.tsx`).
- With no client attached, the headless terminal answers.

### Agents and hooks

Commands run as `$SHELL -lic '<cmd>'`. The environment adds:
- `TERM=xterm-256color`, `COLORTERM=truecolor`;
- `LAKI_WORKSPACE`, `LAKI_TAB`, `PORT`.

Claude gets `--settings <data>/claude-settings.json`. Its hooks run `laki-electron hook <state>`, using an absolute
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
the repo's `.laki.json` (`projectConfig`).

### Presets

`settings.presets` (default: plain `claude` and `codex`) say how agents start: `agent` (claude, codex,
command), `args` (appended raw before the prompt), `cmd`, `env`. A tab keeps `preset` = what the agent is
(hooks, resume, colors) and `profile` = the preset's name, looked up at every start (`presetOf`), so edits
apply on restart. Env order: process < `settings.env` (global) < project (`.laki.json`, then the app's) <
preset < Laki's own vars.

### Interrupts

Esc or ⌃C ends a Claude/Codex turn without any hook. `input` sees the key and `interrupted` checks the
screen for "Interrupted" a few times over 2.5s; a `running` hook in between cancels it. A turn can also end
with no hook and no key (a resumed chat's recap): `sweepRunning` (every 2s) sets a running tab idle after 4s
without output when its last 15 lines lack "esc to interrupt" (claude and codex show it, and redraw, while
they work).

### Resume

`state.json` keeps projects, workspaces, tabs and resume ids. Starting the daemon brings every tab back:
`claude --resume <id>`, `codex resume <id>`; shells start fresh.

### Scans

- Ports: the `ps` process tree of each workspace's tabs, matched against `lsof -iTCP -sTCP:LISTEN`, every 5s.
- PRs: `gh pr view <branch> --json …` (`PR_FIELDS`: title, author, checks list, head commit, review
  decision, size, body), every 60s; one scan at a time (`scanPRs`), so `autoPR` never sends twice.
- `autoPR` (workspace `autoFix` / `autoReview`, ported from wb's `review.go`): failing CI on a new head
  commit → `prFix('ci')` (`gh pr checks`, `gh run view --job <id> --log-failed`), at most 3 in a row
  (`MAX_CI_FIXES`), then status waiting and a notification; new review threads → `reviewMessage`
  (GraphQL `reviewThreads`; `reviewKey` counts only others' comments). What was sent is `workspace.fix`.
  Messages go to the first live claude/codex tab with `send({ whenIdle })`.
- Images pasted into a prompt: `imageSave` writes them to `<data>/images/`; the prompt gets their paths.

### Renderer

`src/renderer/src`:

- **`App.tsx`**: the sidebar, tab bar, toolbar, send bar, palette items and keys.
  - Keys are handled in a capture-phase `keydown` through the `act` map; xterm never sees ⌘ keys.
  - Per-viewer UI state is in `localStorage`:
    - `laki-electron.ws`: the selected workspace;
    - `laki-electron.tabs`: the selected tab per workspace;
    - `laki-electron.groups`: each workspace's tabs, each a split tree of sessions;
    - `laki-electron.side`: the sidebar width; `laki-electron.sideOpen`: whether it's shown; `laki-electron.info`: the info panel;
    - `laki-electron.theme`: the last theme, painted before the daemon's settings arrive.
  - The theme is applied during render (`applyTheme`), before the terminals' effects read the CSS.
  - The project and workspace order is the daemon's (`reorder`).
- **`Term.tsx`**: one xterm per pane. It attaches on mount and detaches on unmount, and swallows terminal
  queries unless it is the responder. A keypress whose keydown it didn't see is dropped: Enter that closed a
  dialog (and so focused the terminal) would type a stray ⏎.
- **`layout.ts`**: tabs, tmux style. A UI tab is a split tree whose leaves are daemon tabs (sessions), so a
  session is in exactly one tab and nothing nests. Pure functions: `groupsOf` (stored tabs minus ended
  sessions, plus one tab per unplaced session), `move` (a pane or a whole tab next to a pane, or out to the
  tab bar), `insert`, `keep`, `resize`, `place`. Tested in `test/layout.test.ts`.
- **`Panes.tsx`**:
  - panes are absolutely placed siblings keyed by tab, so splitting never remounts a terminal;
  - `useTabDrag` is pointer-based (not HTML5 DnD) and finds the drop target with `elementFromPoint`:
    a pane's nearest edge, or the tab bar (`[data-tabbar]`);
  - `SideHandle` resizes the sidebar.
- **`Find.tsx`**: the ⌘F bar (`@xterm/addon-search`). Matches are `--find` (yellow); while it's open the
  terminal's `minimumContrastRatio` keeps their text readable.
- **`themes.ts`**: `THEMES`, `applyTheme` (sets both apps' CSS variables on `<html>`; `default` leaves the
  stylesheet's), `termTheme` (xterm colors from `--ansi-0…15`). Gradient themes set `--app-bg` and a
  transparent `--term-bg` (xterm runs with `allowTransparency`).
- **`PromptInput.tsx`**: a prompt with pasted/dropped images (saved by the daemon) and dictation;
  `withImages` appends their paths. The mic keeps the text box focused and starts dictation 150 ms later: macOS
  learns the web view's text field a moment after focus, and dictation started before that stops at once.
- **`Info.tsx`**: the workspace info panel and the status bar's PR (`PRStatus`, `AutoToggles`, `ciText`);
  each app maps its workspace to `WsInfo`.
- **`ui.tsx`**: line icons (`Icon`, `IconButton`), popup and right-click menus (`useMenu`, color swatches;
  each item has a key: its own `key` or a free initial, `menuKeys`),
  tooltips (`Tips`: any element with `data-tip`), tab colors (`TAB_COLORS`, `colorVar`: CSS `--tc-<name>`),
  and sidebar rows dragged into a new order (`useRowDrag`, `moveId`; rows carry `data-row="kind:id"`).
- **`Settings.tsx`**: the settings page (⌘,), autosaved, zoomed by the terminal font size (its preview cancels
  that); presets, `EnvField` (KEY=value lines), fonts,
  `termLook` (line height, weight, cursor… as xterm options; Term takes it as `look`) with a live preview
  (`TermPreview`), and `ScriptsField` (a project's setup/teardown/run scripts, Import from a file). A
  setting back at its default is saved as that value: an unset key wouldn't replace the saved one. Projects
  are sections of it (`ProjectSection`: name, scripts, env; saved 400 ms after typing and on leaving).
- **`SidePanel.tsx`**: the right panel (⌥⌘B): Files (tree from the daemon's file list, search, new
  file/folder, changed files marked), Changes (the diff by file), Review (`PRSection` from `Info.tsx`, review
  threads); `FilePreview` (a click in Files, or a thread's line), `FileFinder` (⌘P, `findFiles`: a
  basename match first); and `RunButton`. Each app passes a `PanelApi` over its daemon. One right panel at a time: it or
  the info panel.
- **`panels.tsx`**: the new-workspace dialog, palette, prompt and add-project dialog (the last
  only for the web dev renderer, which has no folder picker).
- **`api.ts`**: the WebSocket client. In Electron the address comes from the preload bridge; in a browser,
  from the URL hash.

**Shared files:** `layout.ts`, `Panes.tsx`, `Find.tsx`, `ui.tsx`, `Settings.tsx`, `themes.ts`, `PromptInput.tsx`,
`Info.tsx`, `Glyph.tsx` and `SidePanel.tsx` are identical copies of the files in
`~/projects/laki/go/frontend/src/`. Change both copies.

## Files

| file | what |
|---|---|
| `src/main/index.ts` | Electron main: single instance, starts the daemon, window (maximized, hiddenInset title bar; traffic lights centered in the 38px header), menu, notifications, `pick-folder` IPC |
| `src/preload/index.ts` | `bridge`: conn info, notify, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab, dictate (`startDictation:` to the first responder), dictationSettings |
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, shutdown |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, scans, diff, run, ship, archive/fork, view |
| `src/daemon/skill.ts` | the agent skill: SKILL.md and a CLI launcher in `~/.claude/skills/laki-electron` and `~/.codex/skills/laki-electron` (`skills`, `skillSet`); `src/shared/usage.ts` is the CLI help it quotes |
| `src/daemon/session.ts` | node-pty + headless mirror, snapshot, attach/detach, responder |
| `src/daemon/limits.ts` | usage-limit reset parsing (from wb) |
| `src/shared/conn.ts` | data dir, `daemon.json`, `ensureDaemon` (autostart), `rpc` |
| `src/shared/types.ts` | view types shared by daemon, CLI and renderer |
| `src/cli/main.ts` | the `laki-electron` CLI and `laki-electron hook` |
| `bin/laki-electron.js` | CLI entry: the built `out/main/cli.js`, else the TypeScript source |
| `test/` | `daemon`, `cli`, `e2e`, `snapshot`, `limits`, `layout` tests; `helpers.ts`; `fakes/` |
| `scripts/` | `demo.ts`, `pack-smoke.sh`, `mem.sh` |

## Conventions

- **Keep it small.** Use node's stdlib plus the existing deps (Electron, node-pty, xterm and its addons,
  React); no new dependencies. Mark deliberate shortcuts with a `ponytail:` comment naming the limit.
- **`laki-electron hook` must never fail or block the agent.**
- **Never write** `~/.claude/settings.json` or `~/.codex/*`. Agents get settings and notify through
  flags only.
- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check. Keep both on any new
  endpoint.
- **Colors** come from CSS variables in `styles.css` (`:root`). The terminal theme reads them through `css('--…')`.
- **`asar` is off**, because node-pty's helper must be a real file. The packaged daemon runs on Electron's node.
- **User-facing text** is short and plain. When adding commands or keys, update `README.md` (keys, CLI)
  and the CLI's usage.
- **Commits** end with the `Co-Authored-By` trailer. Never push.
