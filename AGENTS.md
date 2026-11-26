# AGENTS.md

Notes for coding agents working on **Laki** (CLI `laki`): how the code works and how to change it
safely. User-facing docs: `README.md` (the short version: the outcome in a line, three proof points with stills from `LAKI_DEMO_RICH=1 npm run test:ui` (`docs/img/*-dark.png`, `*-light.png`), what is different, a comparison, install, quick start, a table of the docs),
`docs/features.md` (every feature, a few lines each), `docs/install.md` and `docs/guide.md` (the full guide); the product, in `requirements/`. Laki is a successor to wb
(a tmux + iTerm workbench; its repo, if you have it, is read-only from here); ideas and code are ported
from it (limits, hooks).

## Build, test, run

```bash
npm install                       # on Node 26.13.1 (.tool-versions: asdf); package.json's engines stay >=22.12
npm run typecheck                 # tsc --noEmit
npm run check                     # typecheck, then test:fast (~9 s): before a commit that touches src/; `npm run dmg` runs it first
npm test                          # the build first (pretest, 2 s: the rig's daemon, CLI and hooks are out/main's, a third of the CPU; LAKI_TEST_SRC=1: from source), then node:test, every file, 4 at a time, the longest first (scripts/test-run.ts: node:test's run(), which keeps the order scripts/test-order.ts gives: no history first, then by median; node --test sorts by name): ~8 min on an 8-core Mac (460 s on 19 Nov 2026; from source on Node 23: 14 min), more beside other heavy work (it's CPU-bound on the 4 performance cores; 6 at a time was no quicker); cap a background run at 20 min
npm run test:release              # npm test, then each file that failed run once more alone: flaky ones pass, twice fails (scripts/test-rerun.ts; release.sh's)
npm run test:one -- test/pr.test.ts   # only the files named; one test: -- --test-name-pattern='<words>' test/pr.test.ts
npm run test:fast                 # the files that start no daemon (never call fresh()): ~7 s
npm run test:changed              # the tests for what changed against origin/main and isn't committed, each with why (a changed test, an import of a changed file directly or through one source file, a test named for it), then run as test:one runs them; none: test:fast (scripts/test-changed.ts; more args go to node --test)
npm run test:ui                   # the real window, page by page, then the risky flows (scripts/ui-smoke.ts; npm run build first): ~1 min, screenshots in dist/ui-smoke; LAKI_DEMO_RICH=1: the README's stills instead, both themes, into docs/img
npm run test:sheet                # a contact sheet: test:ui's pages in every look × dark and light (LAKI_SHEET_THEMES=all: every theme), 1440×900 and the phone's, into dist/ui-sheet/index.html with each page's layout facts, and against the last run's (moved to dist/ui-sheet/prev; main compares them by pixels, shared/pixelDiff.ts): Changed (n) first, before and after, new and removed pages, `changed: n of m` at the end (scripts/ui-sheet.ts; npm run build first): ~2.5 min, 197 pictures; LAKI_SHEET_SET='{"diffLook":"quiet"}': those settings on every page; LAKI_SHEET_LOOKS=classic: those designs only (with LAKI_SHEET_THEMES=all: every theme's own look, ~12 min)
npm run test:report               # .test-history.jsonl (npm test and test:one add a line per file: time, pass or fail, its failed tests, SLOW, the load, dirty: on uncommitted changes, left out of the flaky list; the newest 5,000, gitignored): the 10 slowest files by median of the last 20 runs (over 60 s flagged), the flaky ones (passed and failed on one sha, or failed in under a third of the last 20); --json (scripts/test-report.ts; npm test ends with its slowest file and any likely flaky one)
npm run test:cov                  # the tests with node's coverage of src/daemon and src/shared (daemons too), the 10 least covered (scripts/cov.ts; not a gate)
npm run size                      # the window's first load (index.html's scripts, stylesheets and static imports) against package.json's lakiSize, 3% allowed (scripts/size.ts; npm run build first; dmg runs it); -- --write sets it on purpose
npm run mem                       # memory against package.json's lakiMem (daemon, renderer, pty host in MB), 10% allowed: the demo world on the packaged app (npm run pack first; APP=…), the median of 5 samples once its agents are idle (scripts/mem.ts; release.sh runs it, LAKI_SKIP_MEM=1 skips loudly; not in check); -- --write sets it on purpose
npm run pack                      # electron-vite build + electron-builder --dir → dist/mac-arm64/Laki.app (Intel: dist/mac)
npm run pack:x64                  # the Intel app from an Apple silicon Mac → dist/mac/Laki.app
npm run pack:linux                # in Docker: dist/linux/Laki-<version>-<arch>.AppImage, then the tests and pack-smoke.sh under Xvfb (ARCH=x64)
npm run dmg                       # scripts/dmg.sh: check, audit:deps, test:ui (before the version moves), minor version +1, the app built, pack-smoke on it, then dist/release/Laki-<version>-arm64.dmg from that app (the user's ask: every dmg); a failed step: no dmg, version as it was; LAKI_SKIP_SMOKE=1, LAKI_SKIP_AUDIT=1, LAKI_SKIP_UI=1 skip loudly
npm run audit:deps                # scripts/audit.ts: npm audit of what ships, high or critical fails unless scripts/audit-allow.json allows it (until a date); build tools' warn; offline warns unless LAKI_AUDIT_STRICT=1 (release.sh)
npm run eval:ai -- --model <id>   # Laki AI's tool choice against a real model (OPENROUTER_API_KEY, never written down), each ask of scripts/ai-evals.json in a demo world of its own: pass or fail, the total, the money; into dist/ai-evals (scripts/ai-evals.ts; not in test, check, dmg or release)
npm run release                   # every platform from this Mac to a draft on the public releases repo, test:ui after its build and before signing (LAKI_SKIP_UI=1 skips loudly; docs/manual-release.md)
npm run dev                       # Electron + renderer dev server on :5199
```

- **Tests** are `node --test` with type stripping (`test/*.test.ts`), no framework.
  The rig (fresh(), the fakes, waits, sleeps), test:ui and trying the UI in a browser: `test/AGENTS.md`.
- **Linux** (`scripts/linux.sh`, a preview): node:22-trixie with Electron's libraries; `npm ci` there gets node-pty's
  Linux binary. Main's `mac`: off it, the system's title bar (`autoHideMenuBar`: Alt shows the menu) and close quits
  (no Dock to bring a hidden window back); the renderer's `.electron` (the traffic lights' room) is macOS only. ⌘ keys
  are Super (`metaKey`); macOS-only parts (`open`, `afplay`, `screencapture`, the Keychain, `open-url` links, panel
  windows) fail quietly or fall back. The AppImage's starter is AppImage's static type2 runtime
  (`build.toolsets.appimage`, electron-builder's `1.0.3`): no libfuse2, and on arm64 no `libz.so` (the old toolset's
  wanted both; Ubuntu has neither by default). Tried on Ubuntu 24.04 arm64 (a live session) with `--no-sandbox`.
- The maintainer's own daemon may be running with real agents in it, in `~/.laki` or `~/.laki-electron` (from when
  the app was called Laki Electron; `dataDir` in `src/shared/conn.ts` keeps an existing one). Never stop it and never
  point tests at it.
- Releasing: `docs/release.md` (checks, both builds, `scripts/pack-smoke.sh` once before each release);
  `scripts/release.sh` (`npm run release`, `docs/manual-release.md`) does all of it for macOS arm64/x64 and Linux
  arm64/x64 (Docker), signed and notarized when a Developer ID is in the Keychain (`--adhoc` otherwise), into
  `dist/release/<v>`, then a draft on `build.publish`'s repo (`upload`, `publish` subcommands); `publish` also writes the
  Homebrew tap's `Casks/laki.rb` (`TAP`, `<owner>/homebrew-laki`, through GitHub's contents API; `tap`, `cask`
  subcommands; `test/release.test.ts`). Run it only when the user asks: it uploads.
- Release notes: `docs/release-notes.md`, Settings › Release notes and its ⌘K item (`?raw`, comments stripped); a version's first three lines are the What's new card after an update (U13: `notesOf`, settings' `seenVersion`; a line's trailing `[Try it](laki://…)` its Try). Each user-visible
  addition gets a line under `## Next` (add that heading above the newest version when it isn't there); `npm run dmg`
  stamps it as the version it builds and the date (`scripts/notes.ts`).
- Signing: the app is ad-hoc signed (`build.mac.identity: "-"`, `hardenedRuntime: false`), not notarized. Keep it:
  with `identity: null` (unsigned) a downloaded dmg (Slack, mail, a browser) says *"Laki" is damaged* on other Macs;
  ad-hoc, it says Apple could not verify it, and System Settings › Privacy & Security › *Open Anyway* opens it.
  `codesign --verify --deep --strict` on the built app must pass. `npm run release` overrides it with the Developer ID
  in the Keychain (`.env`'s `LAKI_SIGN_ID`, gitignored: `.env.example`), the hardened runtime and notarization (`laki-notary`): what goes to
  `igorkasyanchuk/laki-releases`, a plain double-click everywhere.
- package.json's `overrides`: minimatch 7–11.0.0 (electron-builder's own and `@electron/universal`'s, build tools only)
  to 11 (GHSA-g3hv-75wg-m249); the older 3.x and 5.x copies stay (their API went in 11). Drop it once electron-builder
  takes minimatch 11 itself; a pack's file list was the same with it.
- Licenses: each build writes `out/renderer/THIRD_PARTY_NOTICES.txt` (electron.vite.config.ts' `notices`: every npm
  package in a bundle, the daemon's `dependencies` and Electron, each with its own license files, then the fonts'
  `NOTICE.md`, `OFL.txt`, `HACK-LICENSE.md`); About's *Open-source licenses* opens it. `THIRD_PARTY_LICENSES.md` is
  the summary.
- Elsewhere: the packaged app's smoke (`scripts/pack-smoke.sh`) in `scripts/AGENTS.md`; the fuses and the app icon in
  `build/AGENTS.md`.

## Architecture

```
Laki.app (Electron)                          daemon (Electron's node, detached; or plain node)
  main: single instance, starts daemon  ──▶   127.0.0.1:<random>
        notifications, folder picker          POST /rpc    Authorization: Bearer <token>
  preload: conn/notify/pick/openExternal      GET  /ws?token=<token>   (WebSocket)
  renderer: React + xterm.js (WebGL)  ◀─WS─▶  token in <data>/daemon.json (0600); Origin must be
                                              app://laki (the app) or absent (CLI); dev origins only via
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
- [docs/api-history.md](docs/api-history.md): what each `API` number added, 1 to 233. Bump `API` (`src/shared/types.ts`)
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
- [docs/dev/helper.md](docs/dev/helper.md): off the app's binary: Laki Node (the runAsNode fuse off on the app's), how it's
  built, what runs on it and where each starts.
- [docs/dev/remote.md](docs/dev/remote.md): SSH hosts and cloud workspaces, tunnels (cloudflared, tailscale), shared
  tabs, remote access and headless.
- The Files table (what each file is): its rows are in the AGENTS.md of the folder each is in (bin, build, scripts, src/cli, src/daemon, src/main, src/preload, src/ptyhost, src/renderer/src, src/shared, test).

## Invariants

- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check: keep both on any new endpoint
  (remote access's own token and origin: `docs/dev/remote.md`).
- **Never write** `~/.claude/settings.json` or `~/.codex/*`: agents get settings and notify through flags only.
- **`laki hook` must never fail or block the agent.**
- **No new dependencies**: node's stdlib and the ones already here (Conventions).
- **Tests never touch** the real `~/.laki`, `~/.laki-electron`, `~/.claude` or `~/.codex`: `test/helpers.ts` `fresh()`
  gives each its own `LAKI_HOME`, `HOME` and daemon.
- **Never stop the maintainer's daemon** (`~/.laki` or `~/.laki-electron`, real agents in it), and never point tests at it.
- **No credentials in the repo**, anywhere in its history: no OAuth client IDs or secrets, tokens, API keys or
  passwords, not even another app's "public" ones (Laki ships to everyone). Read them at runtime from where they live
  (the other app's install; the user's own config; the Keychain), and
  never write them to a log, the view or a file of Laki's. Tests use fakes that look like no real one (`fake-secret`).
  One committed by mistake: rewrite the unpushed commits so none has it (GitHub's push protection refuses the push).

## Conventions

- **Keep it small.** Use node's stdlib plus the existing deps (Electron, node-pty, xterm and its addons,
  React, mermaid: the user's call, loaded only for a diagram; BlockNote, Mantine, React Flow and html-to-image: the user's
  call, for specs, loaded only with the Specs page); no new dependencies. Fonts are bundled (`fonts/`: OFL, Hack MIT; each in `NOTICE.md`), never loaded from the web. Mark deliberate shortcuts with a `ponytail:` comment naming the limit; `npm run debt` lists them all by file (`--json` for tools, scripts/debt.ts; `--old`: by age, oldest first, the security files' marked, and `npm run dmg` prints the three oldest of those). Type holes are counted too: `test/docs.test.ts` (in test:fast) holds `: any` and `as any` in src to `test/any-baseline.txt`; remove the `any`, or raise the baseline on purpose in the same commit. No line in src/daemon, src/main or src/renderer/src is over 1,000 characters (`test/docs.test.ts`): break one between items, or a string with a line continuation (a backslash and a newline), so the build stays the same.
- **`laki hook` must never fail or block the agent.**
- **Never write** `~/.claude/settings.json` or `~/.codex/*`. Agents get settings and notify through
  flags only.
- **The daemon only listens on 127.0.0.1**, behind the token and the Origin check. Keep both on any new
  endpoint. A refused WebSocket is logged once per address and Origin, then counted once a minute (`refusedWs`, L15). Remote access reaches it through cloudflared on this Mac, for one email (or, asked for with a typed
  confirm, anyone with the link), with a token and an origin of its own that end with it; only the page's static files skip the checks.
- **Daemon calls are typed** (T14, `src/shared/api.ts`): new calls go through `rpc` (conn.ts) or the window's `call`
  by a name the typecheck knows (main.ts' api table, `export type Api`); a handler whose params are typed (`In<typeof
  fn>`: notes', and the schedule, flow, plan, client and PR ones; test/docs.test.ts' `TYPED_MIN` keeps their count from going down) has its params and result checked on a call with no result type given. A name made at run time:
  `rpcAny` / `callAny`, held to `RPC_ANY_MAX` (test/docs.test.ts); `test/types/api.test-d.ts` is the typecheck's own test.
- **A type from another module is `import type`**, not `import { type X }`: with `verbatimModuleSyntax` the latter keeps
  the module in the bundle, and a lazy page (Dialogs.tsx' `PRELOAD`) lands back in the window's first load.
- **CSS only a lazy page draws** goes in that page's own file (`ai.css`, `uikit.css`…: `docs/dev/renderer.md`), out of
  the first load (`npm run size`); it loads after looks-base.css (and a look's own file, looks/<look>.css, may load after it), so never one a rule of equal specificity after it also styles.
- **Colors** come from CSS variables in `styles.css` (`:root`). The terminal theme reads them through `css('--…')`.
- **Sizes** too (V2): space `--sp-1…6`, corners `--r-xs…xl` and `--r-pill` (a look sets its own), elevation `--lift-1…3`,
  control heights `--h-s/m/l`, stacking `--z-*`, type `--fs-1…5`; `test/css.test.ts` keeps styles.css on them (a raw px only
  for 0, a 1px hairline or 20px and up of layout).
- **No `*` or `:not()` under a `:has()`** (`.main:has(…) > *`): beside any `:has()` Blink can't follow by class
  (`:only-child`, `:nth-child`, `:disabled`: BlockNote's and Mantine's have them), every DOM change then restyles the
  whole window (a brainstorm's 5,600 elements: 90 ms a change). Mark the frame instead (ui.tsx `usePageMark`: `.main[data-pages]`);
  `test/css.test.ts` checks it. `src/renderer/postcss.config.mjs` leaves BlockNote's suggested edits' rules out
  (`.bn-suggestion-node`, `-mark`: Yjs collaboration, never used here) for the same reason.
- **`asar` is off**, because node-pty's helper must be a real file. The packaged daemon runs on Electron's node.
- **Intel**: node-pty is `@lydell/node-pty`, a prebuilt binary per platform in an optional package; npm installs only
  this Mac's, so `pack:x64` adds `@lydell/node-pty-darwin-x64` (`scripts/x64-pty.ts`: the tarball package-lock.json pins,
  checked against its integrity; it's in `optionalDependencies` too) before `electron-builder --x64`.
  Nothing else is native. The CLI's `open` and the scripts pick `dist/mac-arm64` or `dist/mac` by architecture.
- **User-facing text** is short and plain, one word per thing (`docs/glossary.md`; `test/terms.test.ts` keeps the retired ones out of Help and Settings). When adding commands or keys, update `docs/guide.md` (keys, CLI),
  `README.md` when it's a main one, and the CLI's usage (`src/shared/usage.ts`, which the agent skill quotes).
- **Commits** end with the `Co-Authored-By` trailer. Never push.
