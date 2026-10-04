# AGENTS.md

Notes for coding agents working on **Laki** (CLI `laki`): how the code works and how to change it
safely. User-facing docs are in `README.md`; the product, in `requirements/`. Laki is a successor to wb
(`~/projects/specdrop-cli`, tmux + iTerm). That repo is read-only from here; ideas and code are ported
from it (limits, hooks).

## Build, test, run

```bash
npm install
npm run typecheck                 # tsc --noEmit
npm test                          # node:test, ~25s
npm run pack                      # electron-vite build + electron-builder --dir → dist/mac-arm64/Laki.app
npm run dev                       # Electron + renderer dev server on :5199
```

- **Tests** are `node --test` with type stripping (`test/*.test.ts`), no framework.
  - `test/helpers.ts` `fresh()` gives each test a temp `LAKI_HOME` and `HOME`, its own daemon, and the
    fakes in `test/fakes` first on PATH: `claude`, `codex`, `gh`, `open` (records what it would open), a shell `tsh`, and
    `da-probe` (counts terminal query replies). No network.
  - `test/cloudflared` is a fake that's off PATH: a test links it into `$HOME/bin` (first on PATH) to install it.
  - Never let a test touch the real `~/.laki` (or `~/.laki-electron`), `~/.claude` or `~/.codex`. The rig also
    sets `LAKI_PAGE` to a folder of the test's own, so remote access never serves the build.
- **Trying the UI in a browser**:
  1. `npm run demo -- /tmp/laki-x` builds a temp world (a repo, 3 workspaces, fake agents) and a daemon
     that accepts the dev origin. It prints a URL with the port and token in the hash. To try Expose to the
     world, `ln -s $PWD/test/cloudflared /tmp/laki-x/bin/`.
  2. `npm run dev:web` serves the renderer on :5199; open that URL.
  3. Afterwards stop it: `LAKI_HOME=/tmp/laki-x/data node out/main/cli.js stop`, then stop vite.
- `scripts/pack-smoke.sh` checks the packaged app (daemon, CLI and hooks through Electron's node, plus a
  window screenshot). `scripts/mem.sh` measures RSS with 3 workspaces × 2 tabs.
- The user runs their own daemon with real agents in it, in `~/.laki-electron` (from when the app was called
  Laki Electron; `dataDir` in `src/shared/conn.ts` keeps an existing one). Never stop it and never point tests
  at it.
- The app icon is `build/icon.icns`, rendered from the mark `src/renderer/src/icon.svg` (also the splash and the
  browser tab's icon) by `swift scripts/icon.swift`: change the SVG, then run it.

## Architecture

```
Laki.app (Electron)                          daemon (Electron's node, detached; or plain node)
  main: single instance, starts daemon  ──▶   127.0.0.1:<random>
        notifications, folder picker          POST /rpc    Authorization: Bearer <token>
  preload: conn/notify/pick/openExternal      GET  /ws?token=<token>   (WebSocket)
  renderer: React + xterm.js (WebGL)  ◀─WS─▶  token in <data>/daemon.json (0600); Origin must be
                                              file:// (the app) or absent (CLI); dev origins only via
laki CLI / hooks (node) ─────── /rpc ──────▶   LAKI_DEV_ORIGIN
browser elsewhere ─ cloudflared ─ GET / ───▶   the built renderer (remote access); its own token and
                                              origin while remote access runs
                                              per tab: node-pty + @xterm/headless mirror
                                              state.json, worktrees, queue, lsof/gh scans
```

### API

`src/daemon/main.ts` `api`: the same methods over HTTP and WebSocket. `API` (`src/shared/types.ts`) is in
every view as `api`; a running daemon below the renderer's (it outlives app updates) gets *daemon older than
the app · restart* in the status bar (`StaleDaemon` in `ui.tsx`: `shutdown`, then main starts the new one).
Bump `API` when the renderer starts relying on a new method or daemon behavior (1: the tunnel methods; 2: a
project's `expose`, kept by `projectSet` and returned by `cloudflared`; 3: a project's `actions`, kept by `projectSet`;
4: `usage`; 5: remote access). A
setting the renderer adds needs no bump: `settingsSet` keeps any field.

- state: `ping`, `state`, `hook`, `watchLimits`, `shutdown`, `settingsSet` (merged into `state.settings`), `apps` (installed apps a folder can open in, `APPS`), `openIn` (an app id, or `editor`: the default);
- projects and workspaces: `projectAdd`/`projectRm`, `projectSet` (name, config), `reorder` (projects or workspaces by id), `wsSet` (color), `projectFile` (the repo's `.laki.json`), `branches`, `wsNew`/`wsRm`/`wsArchive`/`wsRestore`/`wsFork`;
- tabs and agents: `tabNew`/`tabClose`, `tabSet` (name, color), `send`, `queueClear`;
- expose to the world: `cloudflared` (its version, none when missing; the default emails; with `ws`, its project's
  `expose`: what the popup starts from), `tunnelStart`
  (`ws`, `port`, `mails`: resolves with the URL), `tunnelStop`;
- worktree actions: `diff`, `run`, `ship`; the side panel's: `files`, `fileNew`, `fileRead` (text up to 512 KB, an image as a data URL, or binary: size only), `prThreads`, `openIn` with a `file` (paths must stay inside the
  workspace: `inside`);
- the agent skill (Settings): `skills`, `skillSet` with an `agent` (claude, codex) and `on`;
- plan limits: `usage`; remote access: `remoteStart` (`hours`, `mail`: resolves once there's a link),
  `remoteStop`, `remoteTick` (`now`: tests move the clock);
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

Claude gets `--settings <data>/claude-settings.json`. Its hooks run `laki hook <state>`, using an absolute
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
no branches, diff, PRs or ship). `config` (setup, run, teardown, expose), set in the app, wins field by field over
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

### Tunnels

Expose to the world (`core.ts` `tunnelStart`): `cloudflared tunnel --url http://localhost:<port>
[--allowed-mail=<m>…]`, a Cloudflare Quick Tunnel; the URL is the first `https://<name>.trycloudflare.com` in its
output that isn't `login.`. No emails: public, anyone with the link (the popup's default). Emails need
cloudflared 2026.9.3+ (`MAIL_VERSION`) and are kept in `settings.tunnelMails`. Tunnels live in the daemon's memory (`tunnels`, in `WorkspaceView.tunnels`): stopped by
`tunnelStop`, a workspace's teardown, and shutdown; a daemon restart ends them. One per workspace and port.

### Remote access

`core.ts` `remoteStart`: the same `cloudflare()` as a tunnel, in front of the daemon itself
(`http://127.0.0.1:<daemon port>`), always with one `--allowed-mail` (`ONE_MAIL`: an address, never a
`*@domain`; kept as `settings.remoteMail`), for `REMOTE_HOURS` (1, 2, 4, 8, 24). Each start makes a
`remoteToken`; `remoteView` (`view.remote`) gives the link, `<url>/#token=<token>`, which the renderer
(`api.ts`: no port in the hash) uses on the page's own origin. While it runs, `main.ts` takes that token as
well as its own and the tunnel's URL as an Origin; `remoteStop` drops both, so an old link is dead. It ends by
`remoteStop`, at `until` (`remoteTick`, every 15 s), when cloudflared exits, or at shutdown.

`main.ts` `page`: any GET serves a file of the built renderer (`out/renderer`, or `LAKI_PAGE`) whatever the
Origin: the files hold no secrets. Paths that leave the folder, or don't decode, are 404. The CSP's
`connect-src 'self'` lets the page reach its own daemon over `wss://`.

### Usage

Plan limits (`usage.ts`, the renderer's `Usage.tsx`): `usage` reads Claude's `GET api.anthropic.com/api/oauth/usage`
(`Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`; the token is the freshest of `security
find-generic-password [-a $USER] -s "Claude Code-credentials" -w` and `~/.claude/.credentials.json`) and Codex's `GET
chatgpt.com/backend-api/wham/usage` (`$CODEX_HOME/auth.json` `tokens`, `chatgpt-account-id`). Tokens are read-only:
never refreshed (that can sign the agent out), an expired one isn't sent. Each agent's answer is kept 5 minutes
(`USAGE_TTL`: Anthropic turns away faster pollers; a 429 or a turned-away token too), one that asked no server or failed on the way 1
(`AGAIN`); `settings.usage[agent] === false` skips it. The renderer asks every minute. Tests set `LAKI_USAGE_API`
(a fake server for both; only `http://127.0.0.1` or `localhost` count: a session's env can reach a daemon the CLI starts) and get a fake `security`
(`test/fakes`) reading `$HOME/keychain`: never the real Keychain.

### Renderer

`src/renderer/src`:

- **`App.tsx`**: the sidebar, tab bar, toolbar, send bar, palette items and keys.
  - Keys are handled in a capture-phase `keydown` through the `act` map; xterm never sees ⌘ keys.
  - Per-viewer UI state is in `localStorage`:
    - `laki.ws`: the selected workspace;
    - `laki.tabs`: the selected tab per workspace;
    - `laki.groups`: each workspace's tabs, each a split tree of sessions;
    - `laki.side`: the sidebar width; `laki.sideOpen`: whether it's shown; `laki.info`: the info panel;
    - `laki.panel`, `laki.panelTab`, `laki.panelW`: the right panel;
    - `laki.theme`: the last `Paint` (theme, glass, font), painted before the daemon's settings arrive.
  - The theme is applied during render (`applyTheme`), before the terminals' effects read the CSS. Glass also
    goes to main (`bridge.glass`: `setVibrancy`) when it changes.
  - The status bar shows the workspace's path shortened (`shortPath`), with a copy button for the full one.
  - The project and workspace order is the daemon's (`reorder`).
- **`Term.tsx`**: one xterm per pane. It attaches on mount and detaches on unmount, and swallows terminal
  queries unless it is the responder. xterm takes `allowTransparency` only as it opens, so App keys each
  `Term` on `transparent()`: turning glass on or off remounts the terminals. A keypress whose keydown it didn't see is dropped: Enter that closed a
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
- **`themes.ts`**: `THEMES`, `applyTheme` (sets the CSS variables on `<html>`, some also under the names Laki
  Go used; `default` leaves the
  stylesheet's), `termTheme` (xterm colors from `--ansi-0…15`). Gradient themes set `--app-bg` and a
  transparent `--term-bg` (xterm runs with `allowTransparency`).
- **`look.css`**: the bundled fonts (Inter, JetBrains Mono; `fonts/NOTICE.md`), syntax colors (`.hl-*`), glass
  (`html.glass`) and the creative themes' looks (`[data-look=…]`, from a theme's `look`), some selectors also name
  Laki Go's classes. `applyTheme` takes a `Paint` (theme, `uiFont`, glass and its sliders `glassWindow`/`glassSide`/
  `glassTerm` and `glassGlow`; `paintOf` picks them from the settings, `paintKey` is what terminals watch). Glass sets
  see-through `--app-bg` (with the glow's radial gradients), `--side` and `--term-bg` (`#rrggbbaa`: xterm reads only
  that) and frosts what floats; the window's own blur is native
  (`setVibrancy` over IPC). `main.tsx` loads the fonts
  before the first render: a terminal measures its cells once.
- **`highlight.ts`**: the file preview's syntax colors, a regex per language family, up to `HL_MAX` (50 KB);
  tokens become React text, never HTML.
- **`text.ts`**: `actionsFor` (Run ▾'s actions as it opens: `settings.actions`, then the project's `config.actions`,
  which replace a global one of the same name and target; an agent's only with a live tab of it, the focused one
  first; a shell's to the focused shell, any, or none: each app's `runAction` opens one), `parseMails` (a tunnel's who-gets-in: `@team.com` and `team.com` become `*@team.com`) and
  `MAIL_OK` (what the daemons take: kept in step with their `MAIL`/`mailRe`); prompt templates (`templated`, `fillTemplate`: `{{prompt}}`, `{{project}}`, `{{base}}`;
  `settings.templates`, filled in by the new-workspace page; `nameOf`: a templated workspace's name from the typed
  prompt, the daemons' first-4-words rule) and `shortPath` (the status bar's).
- **`PromptInput.tsx`**: a prompt with pasted/dropped images (saved by the daemon) and dictation;
  `withImages` appends their paths. The mic keeps the text box focused and starts dictation 150 ms later: macOS
  learns the web view's text field a moment after focus, and dictation started before that stops at once.
- **`Info.tsx`**: the workspace info panel (with each public link: `WsInfo.tunnels`, `onCopy`) and the status bar's PR (`PRStatus`, `AutoToggles`, `ciText`);
  each app maps its workspace to `WsInfo`.
- **`ui.tsx`**: line icons (`Icon`, `IconButton`), `Switch` (every on/off: the auto toggles, Settings' rows as
  `switch-row`), popup and right-click menus (`useMenu`, color swatches;
  each item has a key: its own `key` or a free initial, `menuKeys`),
  tooltips (`Tips`: any element with `data-tip`), tab colors (`TAB_COLORS`, `colorVar`: CSS `--tc-<name>`),
  sidebar rows dragged into a new order (`useRowDrag`, `moveId`; rows carry `data-row="kind:id"`), and `Page`
  (a page over the main area, like Settings: the new-workspace form).
- **`Settings.tsx`**: the settings page (⌘,), autosaved, zoomed by the terminal font size (its preview cancels
  that); presets, `EnvField` (KEY=value lines), fonts,
  `termLook` (line height, weight, cursor… as xterm options; Term takes it as `look`) with a live preview
  (`TermPreview`, keyed on `transparent()` like `Term`), Actions (`ActionsField`, also in each project's section), Appearance (themes, interface font, glass: `paint` applies
  them at once, before the save), Prompt templates (`settings.templates`), Remote access (`RemoteSection`, shown when App.tsx
  passes `remote`: the email, 1h…24h, then the QR code and link), and `ScriptsField` (a project's
  setup/teardown/run scripts, Import from a file). A
  setting back at its default is saved as that value: an unset key wouldn't replace the saved one. Projects
  are sections of it (`ProjectSection`: name, scripts, env; saved 400 ms after typing and on leaving).
- **`SidePanel.tsx`**: the right panel (⌥⌘B): Files (tree from the daemon's file list, search, new
  file/folder, changed files marked), Changes (the diff by file), Review (`PRSection` from `Info.tsx`, review
  threads); `FilePreview` (a click in Files, or a thread's line), `FileFinder` (⌘P, `findFiles`: a
  basename match first); `RunButton` and `actionMenu` (Run ▾'s Agent and Terminal actions). App.tsx passes a `PanelApi` over the daemon. One right panel at a time: it or
  the info panel.
- **`Tunnel.tsx`**: Expose to the world: the status bar's globe next to each port (`TunnelButton`) and its
  popup: install instructions when cloudflared is missing, who can open it (anyone with the link, the default,
  or only some emails and `*@domain`s), then a QR code and the link; with emails, chips of who gets in, the bad ones flagged. `portsOf`: listening ports plus tunneled ones. App.tsx passes a `TunnelApi`. `QR`: a code
  as SVG, also Remote access's.
- **`Usage.tsx`**: the status bar's first item, the plan-limits ring (`UsageButton`: the most-used limit, asked
  every minute; hidden while the daemon has none) and its popup: each agent's windows, bars, when they reset.
  `USAGE_AGENTS` names the agents Settings › General has switches for.
- **`Help.tsx`**: the help page (⌘/, the sidebar's ?, ⌘K): keys, status glyphs, where things are, the main CLI
  commands and recipes (`cli`: the app's command; `ship`: list `ship`). Keep it in step with
  README's keys and CLI recipes.
- **`qr.ts`**: a QR encoder (byte mode, level M, versions 1–40, best mask), for the tunnel's link. Its test
  compares a code with macOS CoreImage's (`test/qr.test.ts`).
- **`panels.tsx`**: the new-workspace page (ui.tsx's `Page`: over the main area, like Settings), the palette,
  prompt and add-project dialogs (the last only for the web dev renderer, which has no folder picker).
- **`api.ts`**: the WebSocket client. In Electron the address comes from the preload bridge; in a browser,
  from the URL hash.

Laki was built twice while the stack was picked; the Go + Wails build is now its own repository
(`igorkasyanchuk/laki-go`, `~/projects/laki-go`) and nothing here keeps it in step. Many renderer files were
shared with it: some class and variable names in `look.css` and `themes.ts` are its, and harmless here.

## Files

| file | what |
|---|---|
| `src/main/index.ts` | Electron main: single instance, starts the daemon, window (maximized, hiddenInset title bar; traffic lights centered in the 38px header; `glass` IPC: vibrancy and a clear background), menu (with *Quit Laki Completely*: `shutdown`, asking first when an agent is running), notifications, `pick-folder` IPC |
| `src/preload/index.ts` | `bridge`: conn info, notify, glass, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab, dictate (`startDictation:` to the first responder), dictationSettings |
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, shutdown |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, scans, diff, run, ship, archive/fork, view |
| `src/daemon/skill.ts` | the agent skill: SKILL.md and a CLI launcher in `~/.claude/skills/laki` and `~/.codex/skills/laki` (`skills`, `skillSet`); `src/shared/usage.ts` is the CLI help it quotes |
| `src/daemon/session.ts` | node-pty + headless mirror, snapshot, attach/detach, responder |
| `src/daemon/limits.ts` | usage-limit reset parsing (from wb) |
| `src/daemon/usage.ts` | plan limits: Claude's and Codex's usage endpoints, with the agents' own sign-in, kept 5 minutes |
| `src/shared/conn.ts` | data dir, `daemon.json`, `ensureDaemon` (autostart), `rpc` |
| `src/shared/types.ts` | view types shared by daemon, CLI and renderer |
| `src/cli/main.ts` | the `laki` CLI and `laki hook` |
| `bin/laki.js` | CLI entry: the built `out/main/cli.js`, else the TypeScript source |
| `build/icon.icns` | the app icon (electron-builder), rendered from `src/renderer/src/icon.svg` by `scripts/icon.swift` |
| `test/` | `daemon`, `api` (errors, edge cases, daemon start, tunnels, remote access), `pr` (PR feedback), `cli`, `e2e`, `snapshot`, `limits`, `layout`, `qr`, `highlight`, `template` (text.ts; theme ids and looks), `actions` (Run ▾'s), `usage` (plan limits, a fake server) tests; `helpers.ts`; `fakes/`; `cloudflared` |
| `scripts/` | `demo.ts`, `pack-smoke.sh`, `mem.sh`, `icon.swift` |

## Conventions

- **Keep it small.** Use node's stdlib plus the existing deps (Electron, node-pty, xterm and its addons,
  React); no new dependencies. Fonts are bundled (`fonts/`, OFL), never loaded from the web. Mark deliberate shortcuts with a `ponytail:` comment naming the limit.
- **`laki hook` must never fail or block the agent.**
- **Never write** `~/.claude/settings.json` or `~/.codex/*`. Agents get settings and notify through
  flags only.
- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check. Keep both on any new
  endpoint. Remote access reaches it through cloudflared on this Mac, for one email, with a token and an
  origin of its own that end with it; only the page's static files skip the checks.
- **Colors** come from CSS variables in `styles.css` (`:root`). The terminal theme reads them through `css('--…')`.
- **`asar` is off**, because node-pty's helper must be a real file. The packaged daemon runs on Electron's node.
- **User-facing text** is short and plain. When adding commands or keys, update `README.md` (keys, CLI)
  and the CLI's usage.
- **Commits** end with the `Co-Authored-By` trailer. Never push.
