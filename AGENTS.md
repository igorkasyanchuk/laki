# AGENTS.md

Notes for coding agents working on **Laki** (CLI `laki`): how the code works and how to change it
safely. User-facing docs: `README.md` (the short version: a demo GIF, TL;DR, install, quick start, a table of the docs),
`docs/features.md` (every feature, a few lines each), `docs/install.md` and `docs/guide.md` (the full guide); the product, in `requirements/`. Laki is a successor to wb
(a tmux + iTerm workbench; its repo, if you have it, is read-only from here); ideas and code are ported
from it (limits, hooks).

## Build, test, run

```bash
npm install
npm run typecheck                 # tsc --noEmit
npm test                          # node:test, every file, 4 at a time: ~5 min on an 8-core Mac (6 was no quicker there)
npm run test:one -- test/pr.test.ts   # only the files named; one test: -- --test-name-pattern='<words>' test/pr.test.ts
npm run pack                      # electron-vite build + electron-builder --dir → dist/mac-arm64/Laki.app (Intel: dist/mac)
npm run pack:x64                  # the Intel app from an Apple silicon Mac → dist/mac/Laki.app
npm run pack:linux                # in Docker: dist/linux/Laki-<version>-<arch>.AppImage, then the tests and pack-smoke.sh under Xvfb (ARCH=x64)
npm run dmg                       # minor version +1, then dist/release/Laki-<version>-arm64.dmg (the user's ask: every dmg)
npm run release                   # every platform from this Mac to a draft on the public releases repo (docs/manual-release.md)
npm run dev                       # Electron + renderer dev server on :5199
```

- **Tests** are `node --test` with type stripping (`test/*.test.ts`), no framework.
  - `test/helpers.ts` `fresh()` gives each test a temp `LAKI_HOME` and `HOME`, its own daemon, and the
    fakes in `test/fakes` first on PATH: `claude`, `codex`, `gh`, `open` (records what it would open), `caffeinate` (records its starts and stops), a shell `tsh`,
    `ssh` (every host is this machine) and `da-probe` (counts terminal query replies). No network.
  - `test/cloudflared` is a fake that's off PATH: a test links it into `$HOME/bin` (first on PATH) to install it.
  - Never let a test touch the real `~/.laki` (or `~/.laki-electron`), `~/.claude` or `~/.codex`. The rig also
    sets `LAKI_PAGE` to a folder of the test's own, so remote access never serves the build.
  - The rig's daemon has `LAKI_TEST_PARENT`, the test's pid: it shuts down once that process is gone (main.ts, every
    2 s), so a test run killed midway leaves no daemon running (`test/restart.test.ts`).
  - A file's tests run one after another, the files 4 at a time in name order: keep a file under a minute (the
    longest now, `pr` and `widget-events`, about that), else split it by topic as `daemon` was (`agents`, `presets`,
    `restart`, `worktrees`), or it's the run's tail.
- **Trying the UI in a browser**:
  1. `npm run demo -- /tmp/laki-x` builds a temp world (a repo, 3 workspaces, fake agents) and a daemon
     that accepts the dev origin. It prints a URL with the port and token in the hash. To try Expose to the
     world, `ln -s $PWD/test/cloudflared /tmp/laki-x/bin/`.
  2. `npm run dev:web` serves the renderer on :5199; open that URL.
  3. Afterwards stop it: `LAKI_HOME=/tmp/laki-x/data node out/main/cli.js stop`, then stop vite.
- **Linux** (`scripts/linux.sh`, a preview): node:22-trixie with Electron's libraries; `npm ci` there gets node-pty's
  Linux binary. Main's `mac`: off it, the system's title bar (`autoHideMenuBar`: Alt shows the menu) and close quits
  (no Dock to bring a hidden window back); the renderer's `.electron` (the traffic lights' room) is macOS only. ⌘ keys
  are Super (`metaKey`); macOS-only parts (`open`, `afplay`, `screencapture`, the Keychain, `open-url` links, panel
  windows) fail quietly or fall back. The AppImage's starter is AppImage's static type2 runtime
  (`build.toolsets.appimage`, electron-builder's `1.0.3`): no libfuse2, and on arm64 no `libz.so` (the old toolset's
  wanted both; Ubuntu has neither by default). Tried on Ubuntu 24.04 arm64 (a live session) with `--no-sandbox`.
- `scripts/pack-smoke.sh` checks the packaged app (daemon, CLI and hooks through Electron's node, plus a
  window screenshot); `APP=$PWD/dist/mac/Laki.app` checks the Intel build (under Rosetta here). `scripts/mem.sh` measures RSS with 3 workspaces × 2 tabs.
- The maintainer's own daemon may be running with real agents in it, in `~/.laki` or `~/.laki-electron` (from when
  the app was called Laki Electron; `dataDir` in `src/shared/conn.ts` keeps an existing one). Never stop it and never
  point tests at it.
- Releasing: `docs/release.md` (checks, both builds, `scripts/pack-smoke.sh` once before each release);
  `scripts/release.sh` (`npm run release`, `docs/manual-release.md`) does all of it for macOS arm64/x64 and Linux
  arm64/x64 (Docker), signed and notarized when a Developer ID is in the Keychain (`--adhoc` otherwise), into
  `dist/release/<v>`, then a draft on `build.publish`'s repo (`upload`, `publish` subcommands); `publish` also writes the
  Homebrew tap's `Casks/laki.rb` (`TAP`, `<owner>/homebrew-laki`, through GitHub's contents API; `tap`, `cask`
  subcommands; `test/release.test.ts`). Run it only when the user asks: it uploads.
- Release notes: `docs/release-notes.md`, Settings › Release notes (with `devMode` only, its ⌘K item too; `?raw`, comments stripped). Each user-visible
  addition gets a line under `## Next` (add that heading above the newest version when it isn't there); `npm run dmg`
  stamps it as the version it builds and the date (`scripts/notes.ts`).
- Signing: the app is ad-hoc signed (`build.mac.identity: "-"`, `hardenedRuntime: false`), not notarized. Keep it:
  with `identity: null` (unsigned) a downloaded dmg (Slack, mail, a browser) says *"Laki" is damaged* on other Macs;
  ad-hoc, it says Apple could not verify it, and System Settings › Privacy & Security › *Open Anyway* opens it.
  `codesign --verify --deep --strict` on the built app must pass. `npm run release` overrides it with the Developer ID
  in the Keychain (`.env`'s `LAKI_SIGN_ID`, gitignored: `.env.example`), the hardened runtime and notarization (`laki-notary`): what goes to
  `igorkasyanchuk/laki-releases`, a plain double-click everywhere.
- Fuses (`build.electronFuses`, electron-builder's `@electron/fuses`): `--inspect` and `NODE_OPTIONS` off, so another
  program can't run its code as Laki (and borrow its privacy grants); `runAsNode` stays (the daemon, the CLI, hooks, MCP,
  widget scripts and `--headless` run through `ELECTRON_RUN_AS_NODE`), and the asar ones (asar is off). Cookie encryption
  stays off: Chromium's cookie store then waits on the Keychain's *Laki Safe Storage*, the window never reaches the daemon
  until it's answered (pack-smoke's temp home: never), and an ad-hoc signature asks again after each update.
  `npx electron-fuses read --app dist/mac-arm64/Laki.app` shows them.
- package.json's `overrides`: minimatch 7–11.0.0 (electron-builder's own and `@electron/universal`'s, build tools only)
  to 11 (GHSA-g3hv-75wg-m249); the older 3.x and 5.x copies stay (their API went in 11). Drop it once electron-builder
  takes minimatch 11 itself; a pack's file list was the same with it.
- The app icon is `build/icon.icns`, rendered from the mark `src/renderer/src/icon.svg` (also the splash and the
  browser tab's icon) by `swift scripts/icon.swift`: change the SVG, then run it.
- Licenses: each build writes `out/renderer/THIRD_PARTY_NOTICES.txt` (electron.vite.config.ts' `notices`: every npm
  package in a bundle, the daemon's `dependencies` and Electron, each with its own license files, then the fonts'
  `NOTICE.md`, `OFL.txt`, `HACK-LICENSE.md`); About's *Open-source licenses* opens it. `THIRD_PARTY_LICENSES.md` is
  the summary.

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

## Where the details are

This file is the map. How each part works, and why it's so, is in `docs/dev/` (moved there word for word); read the one
for the part you change, and keep it up to date with the change.

- [docs/dev/api.md](docs/dev/api.md): the daemon's API (`src/daemon/main.ts` `api`): each method over `/rpc` and the
  WebSocket, its events and the view; `laki mcp`, the MCP server.
- [docs/api-history.md](docs/api-history.md): what each `API` number added, 1 to 146. Bump `API` (`src/shared/types.ts`)
  when the renderer starts relying on a new method or daemon behavior (a setting needs no bump); the next one goes at its end.
- [docs/dev/agents.md](docs/dev/agents.md): profiles and accounts, layouts, agent variables, turns, asks, sessions, sleep,
  terminal queries, agents and their hooks, projects and their trust, presets, interrupts, resume after a restart.
- [docs/dev/scans.md](docs/dev/scans.md): what the daemon keeps watching (shells, artifacts, ports, Done check, Reader,
  the radar, diff size, PRs and the PR switches), scheduled tasks, notifications and phone pushes, the app's updates, plan
  limits, the context and cost meters.
- [docs/dev/renderer.md](docs/dev/renderer.md): laki:// links, the Preview, Browsers pages and the agent browser, and the
  renderer: App.tsx, every page and component, phones, themes and styles.
- [docs/dev/extensions.md](docs/dev/extensions.md): extensions (widgets): `daemon/widgets.ts` and its modules, the UI
  kit, dev mode, starters and the checker, per-workspace instances, events, streams, gates, tools for agents, sources,
  logs, repo extensions, the studio (`docs/extensions.md` is the SDK for people).
- [docs/dev/workflows.md](docs/dev/workflows.md): workflows: the model and its Markdown file, the engine (runs, blocks,
  asks, agents' turns, retries, budgets, the queue, resume, trust, stats, events), the page.
- [docs/dev/ai-and-notes.md](docs/dev/ai-and-notes.md): Laki AI (its backends, chats, key, call log), Specs &
  Brainstorms, Notes and To-dos.
- [docs/dev/remote.md](docs/dev/remote.md): SSH hosts and cloud workspaces, tunnels (cloudflared, tailscale), shared
  tabs, remote access and headless.

## Invariants

- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check: keep both on any new endpoint
  (remote access's own token and origin: `docs/dev/remote.md`).
- **Never write** `~/.claude/settings.json` or `~/.codex/*`: agents get settings and notify through flags only.
- **`laki hook` must never fail or block the agent.**
- **No new dependencies**: node's stdlib and the ones already here (Conventions).
- **Tests never touch** the real `~/.laki`, `~/.laki-electron`, `~/.claude` or `~/.codex`: `test/helpers.ts` `fresh()`
  gives each its own `LAKI_HOME`, `HOME` and daemon.
- **Never stop the maintainer's daemon** (`~/.laki` or `~/.laki-electron`, real agents in it), and never point tests at it.

## Files

| file | what |
|---|---|
| `src/main/index.ts` | Electron main (every IPC handler checks its sender: `fromApp`, the token's; `from(e, …pages)`: the app window, else only the pages named, `new`, `ai`, `tab` by `?window=`, `voice` the bubbles'; the bubbles', the editor's and a floated tab's own by their window): single instance, starts the daemon, window (where it was left: `window.json` in userData, `winAt`, bounds, maximized, full screen; else maximized; hiddenInset title bar; traffic lights centered in the 38px header; `glass` IPC: vibrancy and a clear background), menu (with *Quit Laki Completely*: `shutdown`, asking first when an agent is running; File, Edit, View and Go list the renderer's ⌘ keys: `key()`, `registerAccelerator: false`, a click sends `browser-key`; Settings › Keys' through `bound()`, its keys from `keysNow`, the `keys` IPC's (`from(e)`: the app window; `keyMap` checks them; `appMenu` builds it again), a click sends its id; a Browsers page's `before-input-event` takes `newTab`/`closeTab`'s keys by `keyFor`), notifications (with their sound; Allow/Deny actions call `answer`), the agent browser (`browse` IPC: a hidden window per workspace), the Dock badge and menu bar item (`badge` IPC: `Tray`; its *Screenshot … to an agent*: `screenshot`, macOS's `screencapture` `-i` or `-m` (the bubbles hidden meanwhile: `shooting`), then `annotate`'s editor window, sent as `shot` (png, note) once the renderer says `shot-ready`), the floating bubbles (`floats` IPC: `placeFloater`, floater.html's bar and the card, menu and voice windows it opens; `floater-act`, `voice-send`), `pick-folder` IPC, `open-external` (http(s) and mailto only), laki:// links, the preview's webview guard and `capture` |
| `src/main/update.ts` | the app's updates: GitHub's latest release, Squirrel.Mac's download and install (Updates: `docs/dev/scans.md`) |
| `src/shared/update.ts` | updates' pure parts: `newer`, `releaseOf`, `feedOf`, `RELEASES` |
| `src/preload/index.ts` | `bridge`: conn info, notify, glass, badge, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab, onBrowserTab, onBrowserKey (⌘W/⌘T from a Browsers page), dictate (`startDictation:` to the first responder), dictationSettings, onDeepLink, onShot (the menu bar's screenshot, drawn on, and its note), annotate (the editor window's), floats and floater (the floating bubbles' list and options; their windows': the bar, the card, the + menu, the voice prompt), onNewPrompt and fitNew (the new-workspace window's), shotKey and onAiShot (Screenshot to Laki AI's keys; the AI window's picture), capture, browse |
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, `GET /artifact/…` (the artifacts viewer), shutdown |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, run, ship, archive/fork, view; the modules below (hosts, pr, files, remote, resources…) import it and it them, and main.ts imports each directly; no module in the cycle reads another's const or let as it loads, so any of them can load first (`test/load-order.test.ts`), and the data folder, `dir`, is `dir.ts`', out of the cycle |
| `src/daemon/dir.ts` | the data folder, `dir` (`dataDir()`), in a module of its own: out of core's import cycle |
| `src/daemon/hosts.ts` | SSH hosts (one ssh connection per host, `exec`/`sshIn` there, a tab's ssh) and cloud workspaces |
| `src/daemon/pr.ts` | branches followed, PR scans, `autoPR` and the PR switches' messages, merge when green, the side panel's PR calls |
| `src/daemon/files.ts` | the diff against the base and its size, Changes' revert and redo, the side panel's files |
| `src/daemon/remote.ts` | tunnels (cloudflared, tailscale), shared tabs, remote access |
| `src/daemon/resources.ts` | listening ports, memory and CPU by tab, process groups, sleep and wake |
| `src/daemon/artifacts.ts` | a storage folder's artifacts and the published links, kept in its `.laki-links.json` (`.url` files moved in) |
| `src/daemon/meters.ts` | transcripts read as they grow: the context and usage meters, today's spend |
| `src/daemon/phone.ts` | phone pushes and the taps that answer them |
| `src/daemon/schedule.ts` | the board's to-dos, reminders, scheduled tasks, `flowHooks` |
| `src/daemon/accounts.ts` | claude's and codex's accounts: folders with the agent's own linked in, a tab's account, who signs in |
| `src/daemon/skill.ts` | the agent skills: SKILL.md and a CLI launcher in each agent's `skills/laki` and `skills/laki-widget` (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.grok`, `~/.config/opencode`; `skills`, `skillSet`); `src/shared/usage.ts` is the CLI help it quotes |
| `src/daemon/widgets.ts` | widgets: folders, storage, fetch on schedule, actions, a JS widget's page; it re-exports the six below, so `widgets.X` reaches them |
| `src/daemon/widgetLogs.ts` | an extension's log file: its runs' stderr, Laki's lines, `laki widget log` |
| `src/daemon/widgetEvents.ts` | events and their handlers, gates before a ship, merge or archive, streams |
| `src/daemon/widgetTools.ts` | tools for agents, the asks before they run, grants, an AI source's permission asks |
| `src/daemon/widgetTrust.ts` | what a Yes holds for: `filesHash`, a repo extension's whole folder (`repoFiles`, `dirHash`), `widgetWhat` |
| `src/daemon/widgetFiles.ts` | an extension's files read and written, its history and undo, Remix, the trash |
| `src/daemon/widgetDev.ts` | runs, mock data and fixtures, `laki widget dev`'s links, `widgetNew`, the checker |
| `src/daemon/share.ts` | shared tabs: transcripts as what was said, its Markdown and the view-only page; the meters' `meterOf`: a transcript's context and tokens |
| `src/daemon/codespace.ts` | cloud workspaces' gh: a codespace made, waited for, started, stopped, deleted, listed; machine types; its ssh Host entry and `<data>/ssh/config` (`sshF`) |
| `src/daemon/turns.ts` | what agents' turns leave: each turn's changes (Undo), the next prompt guessed, a chat handed to the other agent |
| `src/daemon/secrets.ts` | `laki secret`: an agent asks you for a token on a masked card, gets a 0600 file's path |
| `src/daemon/verify.ts` | Done check: a project's scripts and a second agent's review as an agent's turn ends, failures sent back |
| `src/daemon/memory.ts` | memory's compaction: learned memories through Laki AI's model, every few days or when full, its log |
| `src/daemon/tickets.ts` | linked tickets: a project's Ticket script per workspace, its key, title and status |
| `src/daemon/policy.ts` | a managed policy for teams: locked settings, remote access off, approvals required, which agents |
| `src/daemon/hookHealth.ts` | hooks not heard: `hookCause`, why an agent's hooks likely don't reach Laki (no core import: tested directly) |
| `src/daemon/notes.ts` | notes and To-dos: one JSON file each, their pasted files, the list with search |
| `src/renderer/src/FullReview.tsx` | the full review (`settings.fullReview`, on unless false: Settings › Pull requests' *Review tab*; `scanStats` runs for it): the tab bar's Review tab over the panes, files with Viewed boxes under a filter (words or `globMatch`'s glob; Mark viewed takes its matches, `useGhViewed`'s `mark` one file after another), every file's diff (Collapse/Expand all, blame per file: `blame` old and new, DiffRows' `gutter`), the comments gathered (`laki.reviewNotes`; Viewed off a PR: `laki.reviewed`, by the file's diff), sent to an agent or posted as one review (`prReview`), and everyone's on GitHub (`prThreads` `all`, `prTalk`); its columns' widths `laki.reviewFilesW`, `laki.reviewNotesW`, the comments hidden `laki.reviewNotesOff`, their tab `laki.reviewSide` (yours, `pr`: the PR's description, `gh`); pinned files first in both lists `laki.reviewPins` (p); a hunk's arrows (`expander`) show `MORE` lines of the worktree's file around it (`text.ts` `gapsOf` from the @@ heads, `DiffLine.ctx`; not for `PR #n`, an image, A, D or untracked); a file's right click: blame, `fileWeb` (Diff.tsx `webItems`, Changes' too), Mark viewed by folder, PanelApi's `fileItems` (App's `fileMenu`), Revert |
| `src/renderer/src/Diff.tsx` | a diff's shared pieces (Changes, Review, the full review): `diffByFile`, `DiffRows`, `CommentBox`, `ImageDiff`, `useRevert`, `useGhViewed`, `ThreadCard`, `useSuggestions`, `useLoad` |
| `src/renderer/src/Notes.tsx` | the Notes page: the list with search and colors, the open note in BlockNote (SpecEditor) |
| `src/daemon/plans.ts` | specs and brainstorms: their folders, the editor's save, files, agents' output, a prototype's page |
| `src/renderer/src/Specs.tsx` | the Specs & Brainstorms page; `SpecEditor.tsx` (BlockNote), `diagram.tsx` (React Flow), `specmd.ts` (blocks → Markdown), `plans.css`: ported from specdrop |
| `src/shared/plans.ts` | specs' and brainstorms' words for agents: the prompts, what a brainstorm writes, the diagram format |
| `src/daemon/workflow.ts` | workflows: the sources, the engine (runs, decisions, asks, agents' turns, commands, PR waits), resume |
| `src/shared/workflow.ts` | workflows' model and Markdown file, `check`, the format in words (MCP's and Laki AI's) |
| `src/shared/island.ts` | the bubbles' island (floaterAt notch): where the pill and its card go, which card shows next, when one folds; a reply's words |
| `src/renderer/src/Workflows.tsx` | the Workflows page: list, canvas with its blocks and variables sidebar, inspector, file, runs |
| `src/daemon/ai.ts` | Laki AI: OpenRouter's tool loop, claude -p and codex exec with `laki mcp`, the conversation, the key, the call log |
| `src/renderer/src/Ai.tsx` | the AI page: its earlier chats' sidebar, Chat (a thread, the composer, images as thumbnails), Calls and Info tabs |
| `src/renderer/src/voice.ts` | Settings › Voice's cloud: recording, hold Fn, the text typed where the cursor was |
| `src/shared/widget.ts` | widgets' template language, views, base CSS (the UI kit's too), `uiBehave`, a JS widget's page |
| `src/shared/widgetUi.ts` | the UI kit: its elements, `uiHtml`, `uiCheck`, `UI_SAMPLES` |
| `src/shared/widgetSchema.ts` | widget.json's keys: the JSON Schema (`docs/widget.schema.json`, by `scripts/widget-schema.ts`), `laki.d.ts`, `manifestCheck`, an action's tool (`toolOf`, `toolSchema`, `toolArgs`) |
| `src/shared/widgetStarters.ts` | `laki widget new`'s starters: each kind's files |
| `src/shared/icons.ts` | the line icons' paths: the app's `Icon` and the UI kit's `iconSvg`; the icons' look (Settings › Appearance › Icons: `iconPack`, Tabler unset, `iconWidth` as at a 24 grid, `iconSize`; `lookOf`, `setIconLook`: themes.ts' `applyTheme` in each window, core's `settingsSet`/`uiReset`/`load` for the daemon's kit HTML, `iconTurns` as a widget's `icons`; `iconPx`, and `--icon-k` for the CSS-sized marks), a name a pack lacks drawn by Laki's own |
| `src/shared/iconPacks.ts` | generated by `scripts/icon-packs.ts` (npm pack, no dependency): each Laki icon name as Tabler's and Lucide's shapes, checked to be shapes only; their licenses `icon-licenses.txt`, in the notices |
| `src/renderer/src/UiKit.tsx` | Settings › Extensions › UI kit: every element with its sample, at each size, its JSON |
| `src/shared/widgetGuide.ts` | how to make a widget, in words: the laki-widget skill's body (`widgetFormat`) and Settings' AI prompt (`widgetPrompt`); `WIDGET_EVERY` |
| `src/renderer/src/Widgets.tsx` | the sidebar's widget grid, a widget's dialog, the sanitizer |
| `src/renderer/src/appCtx.ts` | what App's parts read of App: `AppBase` (a field per App local they use; App builds `appBase` each render after `if (!view)`), the `Dialog` type, small helpers they share. No state, no hooks: those stay in App |
| `src/renderer/src/menus.ts` | `menusOf`: the ⋯ and right-click menus of a workspace (`wsMenu`), a tab (`tabMenu`), a file (`fileMenu`) and a project (`projectActions`), and the sidebar's *Show ›* (`showItems`) |
| `src/renderer/src/Extension.tsx` | an extension's page, the one place to make, change and set one up: its preview (live or its sample), settings, the inspector, Laki AI's chat (starters, Undo to here), Undo, Try it live, Turn on; New extension |
| `src/renderer/src/NewWindow.tsx` | the new-workspace, AI, floated tab and floated simulator windows (`?window=new`, `ai`, `tab`, `sim`, main.tsx renders them instead of App): the page alone, its own socket, the theme without glass |
| `src/renderer/src/Browser.tsx` | a Browsers workspace's page: a `<webview>` in `persist:browser` with an address bar |
| `src/renderer/src/dock.ts` | Settings › Appearance › Dock icon: the mark and `icons/*.svg`, drawn to a PNG for main's `dock-icon` IPC (`app.dock.setIcon`; kept as userData's `dock-icon.png`, set as the next start begins) |
| `src/daemon/session.ts` | node-pty + headless mirror, snapshot, attach/detach, responder |
| `src/daemon/limits.ts` | usage-limit reset parsing (from wb) |
| `src/daemon/usage.ts` | plan limits: Claude's and Codex's usage endpoints, with the agents' own sign-in, kept 7.5 and 5 minutes |
| `src/daemon/push.ts` | phone pushes: each format's request (`pushRequest`), the URL's check, `pushTo` |
| `src/daemon/device.ts` | laki screen's device ops: the iOS Simulator's and apps' windows' screenshots (in points), the simulator's taps, swipes, typing and elements through idb |
| `src/daemon/fun.ts` | `meme`: r/memes, r/ProgrammerHumor, r/wholesomememes (`SUBS`, in a random order): each one's hot pictures (Reddit's `hot.json`, else meme-api.com's `gimme/<sub>/50`: Reddit's bot wall; a list: no
redirect followed, 2 MB read at most, `conn.ts` `readCapped`), kept 15 minutes, one not shown yet at random (`seen`: the last 500); no NSFW, spoilers or pinned posts; the picture as a data URL (8 MB); only on a click; `LAKI_MEME_API` is tests' fake (localhost only) |
| `src/shared/conn.ts` | data dir, `daemon.json`, `ensureDaemon` (autostart), `rpc`; the daemon's `readJson`, `writeAtomic` (a temp file, then a rename) and `move` (across volumes too) |
| `src/shared/types.ts` | view types shared by daemon, CLI and renderer |
| `src/renderer/src/Reader.tsx` | Reader view: an agent tab's chat as a conversation, its ask as buttons, a box that sends |
| `src/shared/nextStep.ts` | One next step: what a workspace needs from you now, from its tabs, check and PR |
| `src/shared/todos.ts` | the agent's plan, live: a tab's to-do list from its tools' calls, `planCount`, `planNow` |
| `src/shared/overlap.ts` | Collision radar: a -U0 diff's base lines per file, where two diffs meet |
| `src/shared/achievements.ts` | the achievements (54): their groups, words, where each is done, and what earns each (a call, a page, the view) |
| `src/shared/settingsMap.ts` | Settings' sections and each setting's title and words (`FIND`): the page's *Find a setting* and Laki AI's `laki_settings_find` (`skillTools`: where it is, a `laki://settings/<section>?spot=` link, matching plain values, never `SAID_NOT`'s) |
| `src/shared/keys.ts` | Settings › Keys: `KEYS` (the rebindable actions, their defaults), `keyLabel`, `keyMap`, `keyFor`, `keyClash` (another action, `others`, `FIXED`, ⌃ alone), `keyShow`; App's, main's menu's, Help's |
| `src/shared/when.ts` | scheduled tasks' times: English to a rule, the next run, the rule in words; `stamp` (dates in names, prompts, templates, actions) and `wsTitle` (a run's dated names) |
| `src/cli/main.ts` | the `laki` CLI (`laki hook` is `src/cli/hook.ts`, its own build entry); `help`: `laki`, `--help`/`-h`, `laki help <command> [sub]`, `<command> --help` (or after its sub), before any daemon (`usage.ts` `helpFor`: its USAGE lines, its alternatives' else, then `HELP`'s details and examples, for agents) |
| `src/cli/mcp.ts` | `laki mcp`: the MCP server over stdio, its `ext_*` tools |
| `src/shared/tools.ts` | the tools for agents (`tools`, `skillTools`, `state`): MCP's and Laki AI's, through `rpc` |
| `bin/laki.js` | CLI entry: the built `out/main/cli.js`, else the TypeScript source |
| `build/icon.icns` | the app icon (electron-builder), rendered from `src/renderer/src/icon.svg` by `scripts/icon.swift` |
| `test/` | fakes for every agent (`claude`, `codex`, `gemini`, `grok`, `opencode`); `daemon` (and by topic: `agents` (each agent's hooks), `presets` (how agents start), `restart`, `worktrees`), `api` (errors, edge cases, daemon start, tunnels, remote access), `shells` (shell tabs, Terminals and Browsers), `pr` (PR feedback), `cli`, `cli-agents` (the CLI from an agent's tab), `workflow`, `workflow-runs`, `workflow-agents`, `workflow-events`, `e2e`, `snapshot`, `limits`, `layout`, `qr`, `highlight`, `template` (text.ts; theme ids and looks), `ask` (waiting menus), `markdown`, `contrast` (every theme's text, hints and button labels: WCAG ratios), `actions` (Run ▾'s), `usage` (plan limits, a fake server), `schedule` (`when.ts`, scheduled tasks), `links` (laki:// links), `push` (phone pushes), `fun` (memes, a fake server), `ssh` (projects over SSH, `fakes/ssh`), `widget` (templates, widgets, the two that come with Laki), `resources` (memory by tab, sleep and wake), `ai` (Laki AI's backends, key, log), `plans` (specs and brainstorms, their MCP tools), `meter` (context and usage from fake transcripts, prices), `statusline` (Claude's status line kept, yours run after, its context and limits), `keys` (Settings › Keys' resolution, matching, clashes), `radar` (Collision radar), `check` (Done check), `plan` (the agent's plan, live), `next-step` (One next step), `reader` (Reader view), `css` (no restyle of the whole window: no `*` under a `:has()`, BlockNote's suggested edits out), `load-order` (every daemon module imported first, each in a process of its own: none reads another's const or let as it loads), and edge cases for branch coverage: `units-more` (pure functions), `cli-more` (CLI, MCP, HTTP), `services-more` (usage, memes, widgets), `core-a` and `core-b` (core.ts by halves; their own `ssh`, `ps`, `lsof`, `cloudflared` stand-ins in the rig's `$HOME/bin`) tests; `helpers.ts`; `flows.ts` (the workflows' tests' shared files); `fakes/`; `cloudflared` |
| `scripts/` | `demo.ts`, `pack-smoke.sh`, `mem.sh`, `icon.swift`, `widget-schema.ts`, `icon-packs.ts` |

## Conventions

- **Keep it small.** Use node's stdlib plus the existing deps (Electron, node-pty, xterm and its addons,
  React, mermaid: the user's call, loaded only for a diagram; BlockNote, Mantine, React Flow and html-to-image: the user's
  call, for specs, loaded only with the Specs page); no new dependencies. Fonts are bundled (`fonts/`: OFL, Hack MIT; each in `NOTICE.md`), never loaded from the web. Mark deliberate shortcuts with a `ponytail:` comment naming the limit.
- **`laki hook` must never fail or block the agent.**
- **Never write** `~/.claude/settings.json` or `~/.codex/*`. Agents get settings and notify through
  flags only.
- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check. Keep both on any new
  endpoint. A refused WebSocket is logged once per address and Origin, then counted once a minute (`refusedWs`, L15). Remote access reaches it through cloudflared on this Mac, for one email (or, asked for with a typed
  confirm, anyone with the link), with a token and an origin of its own that end with it; only the page's static files skip the checks.
- **Colors** come from CSS variables in `styles.css` (`:root`). The terminal theme reads them through `css('--…')`.
- **No `*` or `:not()` under a `:has()`** (`.main:has(…) > *`): beside any `:has()` Blink can't follow by class
  (`:only-child`, `:nth-child`, `:disabled`: BlockNote's and Mantine's have them), every DOM change then restyles the
  whole window (a brainstorm's 5,600 elements: 90 ms a change). Mark the frame instead (ui.tsx `usePageMark`: `.main[data-pages]`);
  `test/css.test.ts` checks it. `src/renderer/postcss.config.mjs` leaves BlockNote's suggested edits' rules out
  (`.bn-suggestion-node`, `-mark`: Yjs collaboration, never used here) for the same reason.
- **`asar` is off**, because node-pty's helper must be a real file. The packaged daemon runs on Electron's node.
- **Intel**: node-pty is `@lydell/node-pty`, a prebuilt binary per platform in an optional package; npm installs only
  this Mac's, so `pack:x64` adds `@lydell/node-pty-darwin-x64` (`--no-save --force`) before `electron-builder --x64`.
  Nothing else is native. The CLI's `open` and the scripts pick `dist/mac-arm64` or `dist/mac` by architecture.
- **User-facing text** is short and plain. When adding commands or keys, update `docs/guide.md` (keys, CLI),
  `README.md` when it's a main one, and the CLI's usage (`src/shared/usage.ts`, which the agent skill quotes).
- **Commits** end with the `Co-Authored-By` trailer. Never push.
