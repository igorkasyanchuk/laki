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

### API

`src/daemon/main.ts` `api`: the same methods over HTTP and WebSocket. `API` (`src/shared/types.ts`) is in
every view as `api`; a running daemon below the renderer's (it outlives app updates), or from an older build (the view's `built`:
electron.vite.config.ts' `__BUILT__`, the build's time, in the daemon and the renderer alike; none from source), gets a yellow bar at the
top of the main area, *Restart Laki's daemon* (`StaleDaemon` in `ui.tsx`, `.stale-bar`; two clicks: `shutdown`, then main starts the new one).
Bump `API` (`src/shared/types.ts`) when the renderer starts relying on a new method or daemon behavior (a setting needs no bump): [docs/api-history.md](docs/api-history.md) says what each number added, 1 to 146. Read it before a bump (the next number goes at its end) or to find when a method came.

- when everything is done (`settings.whenDone`: sleep, lock, shutdown; unset or off: nothing; Settings › Git &
  worktrees' *When everything is done*): core.ts `whenDone` at each view, beside `keepAwake`: armed by something going
  (an agent running or waiting, a live workflow run, a scheduled task or a workspace's late start due within the hour),
  then, once none is, the view's `whenDone` (`{ act, at }`: App's bar with Cancel, `settingsSet` `whenDone: 'off'`) for
  `WHEN_DONE_WAIT` (`LAKI_WHEN_DONE_MS`: tests'), anything going again cancels it; then `pmset sleepnow`,
  `pmset displaysleepnow` (the lock) or loginwindow's shut down, and the setting goes back to off. `settingsSet` refuses
  a value but those (one already saved is off); an agent can't change it (main.ts' `AGENT_KEYS`, with `doneCheck`,
  `recording`, `nextPrompt`, `keepAwake`, the tidies' `storageDays`, `archivedDays`, `imageDays`, `memoryCompact`,
  `updateCheck`, `updateDelay`; nor a workspace's or project's `private`, `bgSet`, `sideNew`, `uiReset`; remote access
  can: Cancel). Tested with a `pmset`
  in the rig's `$HOME/bin` (`test/resources.test.ts`);
- keep awake (`settings.keepAwake`, off unless true; Settings › Git & worktrees' *In the background*): core.ts
  `keepAwake` at each view (`changed()`): while a tab of an agent (`tracked`, or a shell's `runs`) is running or waiting,
  one `caffeinate -i -w <daemon pid>` (the screen may sleep; it ends with the daemon, a crash too); none found (not a
  Mac): said once. Tested with `test/fakes/caffeinate` in `test/resources.test.ts`;
- state: `ping`, `state`, `hook`, `watchLimits`, `shutdown`, `settingsSet` (merged into `state.settings`), `apps` (installed apps a folder can open in, `APPS`, and browsers, `BROWSERS`, flagged `browser`: only for a file), `openIn` (an app id, `editor`: the one in Settings, or `default`: macOS's for the file, but one that would run, `LAUNCH` or executable, is revealed (L11); with a `file`, Finder reveals it and a terminal opens its folder);
- `worktreeList` (`project`: `git worktree list --porcelain`, each on a branch, its folder there, not the project's own
  nor any Laki workspace's, archived too, by realpath; this Mac's git projects) and `worktreeImport` (`project`, `paths`:
  each one listed as a workspace as it is, its folder's name its id, the project's `main` its base; no setup, nothing
  copied; `imported`: archive and delete leave its folder to `git worktree remove`, never `rmSync` (a forged
  `.git/worktrees/<x>/gitdir` may name any folder); refused from an agent, `AGENT_NO`): a project's ⋯ › *Import
  worktrees…* (panels.tsx `ImportWorktrees`);
- projects and workspaces: `projectAdd`/`projectRm`, `projectSet` (name, config, `color` (`TAB_COLORS`, shared/types.ts)
  and `icon` (an `ICONS` name or icons.ts `emojiOf`'s emoji): '' (a color's `none` too) clears one, anything else is
  refused before any change; the project's ⋯ › *Color* and *Icon…*, Settings' `ProjectSection`; `notes`: the user's Markdown, the
  project's ⋯ › Notes (`ProjectNotes`, panels.tsx), its page and Settings, left out of MCP's and `ls --json`'s state; `memory`:
  the project page's Memory, the whole list (the user's `MEMORY_MAX`, refused past it unless it had more; agents'
  `auto` ones, the newest `MEMORY_MAX`), likewise left out of MCP's state (MCP's `laki_memory` reads it); `seps`: the sidebar's groups (the app's word: a
  named head over the workspaces up to the next one, its count beside it; a workspace dropped on it goes first in it (its top
  third: before it), `RowDrop` `into`, from `data-head`; a workspace's menu › *Move to group* (App's `groupItems`):
  first in one, or *Out of its group* (before the first), a submenu; groups are made only from the project's ⋯, at the top), each with a `color` of `TAB_COLORS` or none and a `template` (a prompt template's name: the new-workspace page opened from the group starts with it; none set: with no template, never the last one used) and a `sort` (`WS_SORTS`; unset: the project's), and the project's own `sort` (unset: manual; App's `sortedRows`: each group's workspaces in its sort, rows unchanged; last active: `laki.active`), and `rows`: their ids and its workspaces' in order; no seps, no rows), `reorder` (projects or workspaces by id; with a sep's id, its project's `rows` too), `wsSet` (color, `muted`, `pinned`: the sidebar's Pinned, above the projects; `railPin`: the rail's quick access, the time
pinned (their order), refused past `RAIL_PINS`, 5), `projectFile` (the repo's `.laki.json`), `branches` (`main`: origin's
HEAD, else main or master: the new-workspace page's base unless picked), `wsNew`/`wsRm`/`wsArchive`/`wsRestore`/`wsFork`;
- `wsNew` in a folder (or `local`) whose own workspace is there: an agent other than none, or a prompt, makes `another`
  beside it (named by the prompt's first words); none gives it back as it is (scheduled tasks' `local`). In development
  mode each step goes to `devLog('new', …)` (Settings › General › *Creation log*) and, once it has an id, the
  workspace's own log; `spawnTab` logs each tab's command line there;
- project memory: `memoryAdd` (`project`, `text`, `auto`: unset an agent's, `MEMORY_AUTO_LEN`; `tab`: `by`, the agent and
  its workspace; the same text again dated anew; the oldest learned one past `MEMORY_MAX` goes; the user's, `auto`
  false, refused past it and from an agent's tab: main.ts' `agentNo`), `memoryRm` (a learned one only); the CLI's `laki memory`, MCP's `laki_memory` and
  `laki_remember` (not Laki AI's: its `laki_memory_write` keeps the user's). `memoryNote` gives both lists to claude and
  codex at every start with Laki's note (the preset's `laki`), each item cut at 2,000 characters, the newest within
  40,000, and how to add to it (claude's settings allow `laki memory add .` and `rm .`); before them *Global memory*
  (`settings.memory`, Settings › Global memory: the user's own items only, the newest within `MEMORY_GLOBAL`, 20,000);
- `quickNew` (`kind` shells or browsers, a browser's `url`; the sidebar's + › Terminal and Browser): the `Terminals` (`load` renames a `Shells` from 0.7) or
  `Browsers` project (`kind`, your home folder, `git: false`; made by the first one; never the home folder's own
  project: `projectAdd` and `findProject`'s path match skip it), then `wsNew` `local` `another` named `terminal <n>` (a
  shell tab; with `project`, a project's or group's + › Terminal: in that project's own folder, `place` as `wsNew`'s) or `browser <n>` (no tabs, the workspace's `browser`: the page, `URL_OK`, http(s) or about:blank; `wsSet`
  `browser` and `name` follow the page and its title); one at a time (`quick`: two clicks would pick the same id);
- an action's `slug` (`RunAction`, `shared/types.ts` `actionSlug`): `slugActions` keeps every one unique across
  `settings.actions` and each project's `config.actions` (at `load`, for older ones; in `settingsSet` and `projectSet`, the
  list just saved yielding to the others: one without gets its name's, a taken one `-2`); Settings' `ActionsField` shows
  it, a new card's following its name until typed (`fresh`), and flags one another list has (`taken`);
- `wsNew`/`wsFan` `place` (`placeWs`, as a drag would: `top`, first in the project, or a sep's id, first under it; a
  race in its order; none: last, as the CLI's and scheduled runs are);
- the board's to-dos (`state.todos`, `view.todos`; a project's go with it): `todoAdd` (`project`, `text`, `images`:
  `imageSave`'s and `fileSave`'s paths only, 10 at most, after the text in the prompt as it starts; the board's `Thumbs`,
  a file's `FileChip`), `todoRm`;
- the calendar's reminders (`settings.calendar`, on unless false; off: refused, none in the view; done ones in it for 92 days, `REMINDERS_DONE`): `reminderAdd` (`at`: ms or
  `when.ts` `parseAt`'s words, or words that repeat (`whenOf`: its next time and `every`), `every`, `text`, `ws`, `project`, `by`; `REMINDERS_MAX`), `reminderSet` (`text`, `at`: moved later, it
  rings again; `done`; `ws`), `reminderRm`, `reminderTick` (every 30 s and as the first client connects; with no client
  it waits): each due one not `fired` or `done` broadcast once as a `reminder` event (`reminder`: its id, never `id`),
  App's notification and toast; the CLI's `laki remind <when> <text> [--ws]` and `laki reminders [rm|done <id>]`, MCP's
  `laki_reminder` (agents' and Laki AI's: add, list, done, rm);
- the laki command for any shell (Settings › General › Developer, `CliField`, with the CLI reference and agent skill links): `cliState` (`path`: Laki's launcher,
  `CLI_MARK` in it; `current`: its paths this install's; `onPath`; `other`: another laki first on PATH; `to`: where an
  install goes), `cliInstall` (the launcher, `LAKI_CLI`, in the first writable of `cliSpots` with no other `laki` there, a link too (never
  written through): `/opt/homebrew/bin`, `/usr/local/bin`, else `~/.local/bin`, made; none: refused; `LAKI_CLI_DIRS`: tests' own), `cliRemove` (only one with `CLI_MARK`);
- memory's compaction (`daemon/memory.ts`): `memoryCompact` (`project`: its learned memories, never the user's, to Laki
  AI's model through `ai.ts` `aiOnce` (OpenRouter's `aiComplete`, or `claude -p`/`codex exec` with no tools), back as
  `{memories: [{text, from}]}`; an answer that isn't one, empty or longer changes nothing; what changed meanwhile
  stays (learned since, pinned as yours, edited: only the ones still as given are replaced); the project's `compacted`, a line in `<data>/memory-compact.jsonl` with the texts before and after),
  `memoryCompactLog`, `memoryTick` (every 30 minutes, unless `settings.memoryCompact.on` is false (Settings › Global memory's *On its own*, on by default: it sends them to Laki AI's model; `load` makes a choice saved before 0.29, 0.24's `off` or an object without `on`, off; Settings always saves `on`) and Laki AI on and able to answer (OpenRouter: a key): every
  `memoryCompact.days` (`COMPACT_DAYS`, 7; 0: only when full) since the last, or the oldest learned one, and as the learned
  ones reach `MEMORY_MAX`, unless the last run left them full: then by days); Project.tsx' Memory tab: *Compact now*, the last run, Log;
- `wsPeek` (a worktree's `dirty`: `git status` lines, `ahead`: commits not in its base, `unpushed`: of those on no remote;
  a git that fails, a local, archived or gone one: none of it): what App's `rmFacts` puts in the delete question (ui.tsx
  `ask` `facts`, `.ask-facts`), waited for 1.5 s at most;
- `wsArchive` `ifClean`: archives only with nothing uncommitted (the worktree goes, and that with it), else returns `{ dirty }`;
  `doctor` (the first-run screen's: git, `gh auth status`, `cloudflared` (optional; Welcome's ? says what for), which agents are on PATH);
- tabs and agents: `tabNew`/`tabClose` (a tab's name: `addTab`, `freeName` numbers it; an agent tab after the
  workspace's first, with a prompt, is `<agent>: <taskTitle(prompt)>` (`shared/types.ts`: its first words, no URLs, paths,
  flags or please), `titled`; one without takes its first prompt's words, `titleFrom`: claude's UserPromptSubmit and
  gemini's BeforeAgent `prompt`, codex's first notify `input-messages`, never a bare /command; in an untitled workspace
  (a workspace's `untitled`: made with no name or prompt, a Local one or a worktree's `ws-<tail>`; or a folder's own from
  before, its project's id; `wsSet` `name` sets it false; a workspace's `named`: you named it, `wsSet` `name` not from an
  agent (`wsSet` in `FROM`) or `wsNew` `named` with no `from` (the page's typed name, the CLI's `--name`): an agent's
  rename refused unless `asked` (`laki rename --asked`), `wsSet` `auto` (a Browsers page's title) passes it by), that prompt names the workspace instead and the tab keeps its
  agent's name; a new Local one is named the name given, else `taskTitle` of its prompt (the renderer's `nameOf` too); MCP's `laki_new_tab` takes a `name`), `tabSet` (name, color, `muted`; a name sets `titled`), `send` (`enter: false`: into the prompt, no Enter, escapes dropped; refused while the agent asks something; an agent's
  (main.ts `agentSend`): to an agent's tab (`agent: true`), or a terminal of its own workspace, which is then the agent's
  (`agentCaller`, core's `agentTyped`; its keys through `input` too) until you send or type there (`youTyped`: keys with
  no escape), another workspace's terminal refused before any ask), `queueClear`, `queueSet` (the whole list: an edit, a
  reorder, a removal; `was` refuses one made over a delivery), `queueNow` (Esc into a running turn, 5 s for it to stop, then `deliver`; an asleep one, a restart's too, woken
  instead, its first one going as it settles; an ended one refused, as is a delivery that couldn't type);
  `answer` (`tab`, `n` or `pick` first/last: a waiting agent's menu, below; `label`: refused unless choice `n` still says that), `unread` (its ● again: `done`, until a look clears it);
- a race (`wsFan`: the `NewWs` fields and 2–6 `presets`, agents only, worktrees only): `wsNew` per preset, one after
  another, named `<name>-<preset>`, sharing a random `race` id (the sidebar's flag; the renderer's `Compare.tsx`);
- an issue (`wsNew`/`wsFan` `issue`: a URL or number): `fromIssue` runs `gh issue view <ref> --json number,title,body,url`
  in the project; the prompt is "Work on GitHub issue #n: title", the URL, the body (8,000 characters at most) and the
  prompt given, the name `issue-<n>-<slug>`; the workspace keeps `issue`;
- a PR (`wsNew` `pr`: a URL or number; not local, not a race): `prHead` (`gh pr view <ref> --json …`; `ghSays` turns gh's
  failures into a line: not installed, signed out, not found), then `worktree add --detach` and `gh pr checkout <url>
  --branch <b>` in it (`b`: the head branch, a fork's `<owner>/<branch>`; refused when a workspace or the repo has it
  checked out: "already checked out in workspace <id>", which the app offers to open). A prompt that names a PR
  (`prIn`, no `pr`: `fromPRLink`) only links it: the workspace keeps `linked` as `prUrl` and `prLinked` (`autoPR` skips it, the app shows no
  switches: its branch isn't the PR's; a local one too: `scanPRs` takes any workspace with a `prUrl`; a branch move keeps
  it, `moveBranch`: a review's `gh pr checkout`; any `prUrl` scans as the workspace is made). Not with `from` (a session
  another workspace's agent started: `laki new` in an agent's tab or one a shell tab runs (`$LAKI_TAB`'s kind or `runs`; yours
  in a shell isn't), an agent's `laki mcp`, by `$LAKI_WORKSPACE`; Laki AI's has none; `agentNoCmd` refuses its `cmd`
  and a command preset, as `tabNew` does for an `agentCaller` or MCP's `from`): its prompt's PRs are what it came from, only `related`, unless `link` (`laki new --link`, MCP's `link`; gh
  failing: refused) names the one it's about (`guessed` false: kept). Every other GitHub PR and issue the prompt names (`refsIn`; not an issue
  workspace's: the issue's text names any) goes to `related` (`relate`: once, any case, the newest last, 20 at most) and, unnamed, is `pr-<n>-<slug>` (gh failing: `pr-<n>`); the renderer sends no
  template name for one. The base is the PR's, the name
  `pr-<n>-<slug>`; the workspace keeps `prUrl`, which `scanPR` asks for until `syncBranches` sees another branch, and a
  fork's `fork` (kept by `wsFork`);
  a base with no local branch is `origin/<base>`;
- `settings.syncBase` (Settings › Git & worktrees; unset or '': off): `synced` before `worktree add` (not a PR's):
  `origin`, `git fetch origin <base>`, then the worktree off `origin/<base>` (`--no-track`: a push never goes to the
  base) and that as its `base`; `ff`, `git fetch origin <base>:<base>` first (git refuses one checked out or not a
  fast-forward: then as `origin`). A fetch has a minute; one that fails leaves the base as it was;
- a `wsNew` `base` (the page's, `laki new --base`, a scheduled task's; not a PR's) that isn't a commit here (`hasRef`,
  after `synced`): `origin/<b>` (`--no-track`) when origin has it, else refused, `base <b> not found in <project>`;
- `worktreeAdd` (`wsNew`'s and `wsRestore`'s `git worktree add`): `-c checkout.workers=0` (a worker per core) unless the
  project's `git config --get checkout.workers` says something (`ownWorkers`: read once per repo per daemon, by host and path, a host's
  there); tested with a logging `git` in the rig's `$HOME/bin` (`test/worktrees.test.ts`);
- files git ignores (`copyIncludes`, after `worktree add` in `wsNew` and `wsRestore`): `.worktreeinclude` (the repo's
  root) and `.laki.json` `copy` as gitignore patterns to `git ls-files -z --others --ignored`, copied from the repo with
  their mode; one already there stays, a source outside the repo (a link) or a destination outside the worktree is
  skipped; failures go to `daemon.log`, never fail the workspace;
- `wsNew` `noSetup` (a worktree; the new-workspace page's where menu › *New worktree, no setup*, shown for the project view's
  `hasSetup`: `projectConfig`'s setup; off each time, never in `LastNew` or a draft; `laki new --no-setup`, MCP's
  `no_setup`; a race's and a PR's too): no `runSetup`, so no marker (`settingUp` false: agents start at once),
  `copyIncludes` still, the creation log's `setup: skipped`; untrusted, `setupWait` as before (`projectTrust` copies
  only); the workspace's `noSetup` until `run` `script: 'setup'` (worktrees only, trusted only: Run ▾'s *Run the setup
  script*, `laki run <ws> setup`) runs it and clears it;
- expose to the world: `cloudflared` (its version, none when missing; the default emails; with `ws`, its project's
  `expose`: what the popup starts from; `named`: settings.tunnel's, when set), `tunnelStart`
  (`ws`, `port` (never the daemon's own), `mails`, `hours`: resolves with the URL; `host`: a permanent one, refused from an agent), `tunnelStop`,
  `tunnelCheck` (Settings › Tunnels: cloudflared, `cert.pem`, the named tunnel in `tunnel list`, its credentials file
  beside the certificate or in `~/.cloudflared`; `name`, `domain`: the form's as typed, Settings saving 300 ms later);
- worktree actions: `diff` (git's text but its last newline: a hunk to revert must match), `run`, `ship`; Changes'
  Revert (not a `git: false` project): `hunkUndo` (`path`, `hunk`: the @@ line and its body as `diff` gave it, refused
  as "changed since you looked" when the diff read again hasn't it, or the file runs into the 4 MB cut; `lines`:
  indexes into its body; a forward patch from the worktree to the base, `git apply --check` then `git apply`: a temp
  file here, stdin over `sshIn` on a host; a new file taken whole goes, a deleted one comes back whole only),
  `fileUndo` (`path`: its status from `--name-status -M`, untracked as A; its content first kept by `hash-object -w`;
  `git restore --source=<base> --worktree`, an A removed, an R's old path restored and the new removed), `hunkRedo`
  (`id`: `git apply -R`, or the blobs written back; `undos`, the last 20 per workspace in memory); nothing staged;
  the side panel's: `files`, `fileNew`, `fileRead` (text up to 512 KB, an image as a data URL, or binary: size only; `lossy`: not UTF-8; `base`: an image as `git show <diffBase>:<path>`, for Changes' before), `fileWrite` (`text`, `was`: the text the edit started from, refused as "changed since you opened it" when the file isn't that any more, unless `force`; only a whole UTF-8 text file; written in place, its mode kept; on a host, `cat >` over `sshIn`), `prThreads` (each thread's `startLine`, `side`: LEFT when a range starts on the old file's, `hunk`: its first
  comment's `diffHunk`), `prComment` (`path`,
  `line`, `side` LEFT/RIGHT, `body`: `gh api …/pulls/<n>/comments` at the PR's head commit; a 422 is "not in the
  PR's diff"), `prAct` (`act` approve, close or merge, each only where the project's `prAllows` says (`config.pr`:
  approve, close, merge on unless false, `land` off unless true; the daemon refuses, the app hides); merge: `method`
  squash/merge/rebase, saved as the project's `mergeMethod`, `deleteBranch`: `merge()`, `gh pr merge --<method>
  [--delete-branch] -R <host/owner/repo> -- <url>`: `-R` keeps gh off the worktree's git (no checkout, no local branch
  deleted), then a scan a second later), `prLog` (`ws`, `job`: a GitHub Actions job id, `shared/types.ts` `jobOf` from a
  check's link; refused without a PR): `failedLog`, `gh run view --job <id> --log-failed`'s last 80 lines, colors and
  gh's job, step and time out, a `▸ <step>` line where each step starts (`steps`; prFix's own has none), gh's failure
  as `gh couldn't read the log: <its first line>`; Info's and Review's *Log* on a failing check with a job (`Checks`
  `onLog`, App's `ciLog` dialog: panels.tsx `CiLog`, read again each time it opens; *Send to the agent* is `prFix`
  `job`: that check's section only, `that check isn't failing … now` once it isn't), `prAttach` (`ws`, `pr`: a URL or number; the app's *Attach a PR…*, the status bar's *+ PR*, the right
  panel's Info: a git workspace on a branch, no PR found, and related's *Make it this workspace's PR*): `prHead`, then `prUrl`,
  and `prLinked` when its head isn't the workspace's branch, the one before (`prUrl`, else the branch's) to `related`; a scan follows), `prDetach`
  (`ws`: a linked `prUrl` to `related`, the PR ⋯'s *Not this workspace's PR*, the workspace menu's *PR #n ›* (App's `prSub`: `prMenu`, the status bar PR's right click) › *Detach PR*, `laki pr .
  --detach`; its branch's own too, kept off as `prOff`: the scan leaves it out until `prAttach`), `prDiff` (`gh pr diff` by the PR's URL, in `diff`'s shape: `diffFiles` reads each file's status and
  lines; Changes' *PR #n*), `prFiles` (GraphQL: the PR's node id and each file's `viewerViewedState`, VIEWED, UNVIEWED,
  DISMISSED; owner and repo from the PR's URL) and `prViewed` (`path`, `viewed`, `id`: `markFileAsViewed` /
  `unmarkFileAsViewed`; Changes' Viewed boxes, in both views, a ticked file folded and dimmed, *n/m viewed*), `prLabels` (the PR's repo's, `gh label list -R`, kept a minute per repo; a color only as GitHub's 6 hex digits: `labelOf`) and `prLabel` (`label`, `on`: `gh pr edit --add-label=` / `--remove-label=` `-R` by the PR's URL, shown at once, then a scan; a name with a comma refused: gh splits there): `PRSection`'s tag button (`LabelApi`), a PR's `labels` from the scan (`PR_FIELDS`), `prAct` (`act` approve or close: `gh pr review --approve` / `gh pr close` by the PR's URL, after the
  app's confirm; an open PR only), `imageSave` (the preview's screenshots too), `fileSave` (below), `openIn` with a `file` (paths must stay inside the
  workspace: `inside`, links followed, by `realpath`);
- widgets (below): `widgetRender` (`id`, `full`: the filled HTML, a JS widget's as a whole page; null: no such
  view; `sample`: filled with widget.json's `sample` and `sampleConfig` over its settings, `at` two minutes ago,
  `sample: true`), `widgetSet` (`on`, `size`, `every`, `view`, `config`: each setting as text, made what its kind takes;
  `name`: written in widget.json (`rename`: 60 characters, empty drops it; not a repo's nor one file's; the history's
  `snapshot` first, then `scanWidgets`, nothing fetched), `WidgetCard`'s name field;
  `ai`: the Extension page's chat sets it before each ask, one of the user's in `widgetHome()` (else refused) gets the
  store's `aiMay` (an hour), which lets `widgetWrite` rewrite it; `agent`, or `from` an agent's tab: MCP's and Laki AI's
  `laki_extension_set`, `laki widget set` (`place`, `size`, `every`, `view`, `hide`, plain settings as `key=value`):
  never `on: true`, `net: true`, `source`, `ai`, a secret setting or one a source or an AI action's prompt reads (`steering`: its `{{config.x}}`); a place it doesn't know is refused), `widgetRun` (fetch now; it and `widgetAction` refuse an off one: one Laki AI wrote runs nothing, a preview's clicks and scripts neither, until it's turned on; Widgets.tsx' `act` likewise
refuses an off one's `open`, `copy` and `say` with a toast), `widgetRm` (Settings' trash can, no `ask`: App's toast with Undo, `widgetRestore`; the folder (a link: only it, `readlinkSync` kept), its
  store, instances, history, chat and secrets moved to `<data>/widget-trash/<id>-<ms>/` (`move`: rename, `cpSync` on EXDEV; `trash.json`: id, name, from, link, file, at), its grants gone; never a repo's (`repoSays`) nor your home, the data dir or `widgetHome()` itself; not MCP's nor Laki AI's), `widgetRestore` (`trash`: back where it was, a link made again, on or off as it was, `from` an agent off, its grants dropped and a `note`; refused when its id or its path is taken), `widgetTrash` (newest first; `widgetTrashTidy` at start and hourly: past `TRASH_DAYS` 30 or `TRASH_MAX` 20; the CLI's `laki widget trash|restore`), `widgetAction` (`action`, `arg`), `widgetReload`, `widgetFiles` (a widget's own files as text, 20 at most) and `widgetWrite` (`id`, `files`: Laki AI's and MCP's `laki_extension_write`; only `<data>/widgets/<id>`, never another root's id, the user's own there (no `by: 'ai'` nor `aiMay`) nor through a link, files left out kept; a new one saved off, one that was on stays on (Laki AI from its own page's chat, `page`: `aiRpc`'s `by: 'ai'` and `chat` `widget:<id>`, whatever changed; any other writer, `agent` (an agent's tab, main.ts' `FROM`, or an MCP client outside Laki) or Laki AI in another chat, only while `widgetTrust.ts` `runsOf` is the same, else off and its `net` dropped: its manifest's commands, prompts, handlers and settings, every file but widget.html without a script, fixtures and Markdown; `widgetUndo` likewise) with the store's `by: 'ai'` (a user's own keeps `aiMay` for its hour), the view's `byAi`: its fetch is a model's shell command, so the user turns it on), `widgetTick` (`now`: tests move the
  clock; one asked for while it fetches runs once more after: `again`); `widgetNew` (`kind`, `name`, `dir`: a starter, on; `from` an agent: off, nothing run, a `note`),
  `widgetCheck` (`id` or `dir`, `run`: its fetch once; below); `openIn` `widget` (its folder); `GET /widget/<id>?key=…`: a JS widget's page;
- the agent skill (Settings): `skills` (each with `skill`, laki, laki-widget, laki-specs (`specsSkill`: `laki plan`, shared/plans.ts' `BRAINSTORM_METHOD`) or laki-orchestrate (the coordinator's protocol over `laki new`, `screen`, `send`: skill.ts
  `orchestrateGuide`, also claude's `/laki:orchestrate`, only you start it, `ORCH_CMDS` unasked, and opencode's `/laki-orchestrate`: `<data>/opencode/command/`, its `OPENCODE_CONFIG_DIR`), and `mcp`: the agent's `mcp add` command, shown, never run; for
  opencode, whose `mcp add` only asks questions, the JSON for `mcpIn`, its config file), `skillSet` with an `agent`
  (claude, codex, gemini, grok, opencode: `skill.ts` `AGENTS`, each one's home and `mcp add`), `on` and `skill`
  (`SKILLS`: laki, the default, or laki-widget: the widget creator's guide, its own folder and launcher, no MCP; it says
  extension and widget are one thing); `refreshSkills` at the daemon's start writes an installed skill that's out of date again (only one whose launcher has this data dir's `LAKI_HOME`); an outdated one whose launcher has another's is `foreign`; App's `oldSkills` (the others outdated, `skills` as it connects and on the window's focus, a minute apart; Settings' rows too) is a bar under the tab bar (`.stale-bar.soft`: *Update*, `skillSet` each; *Not now*: until the app starts again), Settings' *Update all*, a foreign row's *Use this one*;
- scheduled tasks: `scheduleSet` (makes one, or changes one by `id`: name, project, preset, ws, prompt, when, on;
  a new one without ws or preset gets `new`, or `local` without git, and the default agent), `scheduleRm`,
  `scheduleRun` (now), `scheduleTick` (`now`: tests move the clock); the CLI's `laki schedule`;
- resources and sleep (Settings › Resources): `resources` (one `ps -axo pid,ppid,rss,%cpu,command`: `app`, the app
  bundle's processes by `--type`, none on plain node, which the renderer names by main's `procs` IPC (each pid's
  holder: the window, a JS widget's or the video's frame (`framesInSubtree`: JS widgets share one process, one site),
  the preview's webview, a Browsers page (`Browser: <host>`, stop `browsers`: App unloads the pages not selected,
  `browsed`) or its sign-in window, an agent browser, the bubbles, the editor; the total splits out shell tabs and
  browsers) with a Stop each: main's `proc-stop` (the
  bubbles' windows destroyed until `floats` changes state, `parked`; an agent browser closed) or the page's own
  `laki-stop` event (the video closed, a widget unloaded until a click, the preview unloaded until
  *Load it again*); `daemon` with its heap; `tabs`, each live session's process
  tree, the program first; RSS in KB; `others`: what else the daemon runs, each child with what's under it, named by `own`
  (Laki AI's agent, a tunnel, remote access, an SSH host's master, a widget's fetch, an extension's agent; the rest, short git/gh/lsof, in `app` by name), `resourceStop`
  (main.ts: `ai`, `remote`, `share`, `tunnel:<ws>:<port>`, `tunnel:named`, `stream:<id>`, `agent:<id>`) for a row's Stop); `tabSleep` (now: `cantSleep`'s rules: claude or codex with a `resumeId`, idle, no queue or limit, not on a host),
  `tabWake`, `sleepTick` (`now`: tests move the clock; every 60 s);
- development mode (`settings.devMode`): `logs` (`key`: `ws:<id>` or `widget:<id>`): `core.ts` `devLog`'s lines, the
  last 500 per key in memory, a line among the last 6 again counted (`n`) and moved to the end, all let go when dev mode
  goes off; a line may be a function, called only in dev mode; PR scans, the PR switches' choices and why
  not (`autoPR`, `prFix`, `tellAgent`), queue deliveries, tabs' status changes (`turn`), widgets' fetches and actions;
- an agent's estimate: `progress` (`tab`, `pct` 0-100, `note`; `laki progress`, MCP's `laki_progress`): it returns what
  it stored (clamped, rounded), and the tab's view has it until the turn ends (`view` drops it on idle or exit, however
  the turn ended); `settings.progress` puts `LAKI_PROGRESS=1` in agents' env (`lakiEnv`) and
  the laki skill tells them to report every 20-30 s; claude and codex on this Mac are told at every start (`agentCmd`'s
  `PROGRESS_NOTE`: `--append-system-prompt`, `-c developer_instructions`; the skill loads only for Laki's own tasks), and
  claude's settings allow its `progress` command;
- Laki AI (below): `aiAsk` (`text`, `images`: paths `imageSave` gave; resolves with the answer), `aiState` (the
  conversation, `busy`, `ended`, `key`: one is saved, the last 100 calls,
  `totals`), `aiNew`, `aiStop` (none: any chat's ask), `aiKey` (`key`; empty removes it); each takes `chat` (a spec's or
  brainstorm's, `planChat`; none: the AI page's), and `aiContinue` (an ended chat taken up again), `aiTick` (`now`: tests
  move the clock; every 10 minutes); the AI page's earlier chats: `aiChats`, `aiOpen` (`id`), `aiChatRm` (`id`); `aiImage`
  (`path`: a message's pasted image, `imageOk`'s only, as a data URL);
- Laki AI's skill: `prList` (`project`, `who` mine/others/all: `gh pr list --state open` in the project, `ghLogin`
  for mine, each with the workspace that has it by `prUrl` or branch), `aiQuestion` (`text`, `options` 2-6 with `looks` (each a UI kit `ui` over its `data`, `size`: Ai.tsx draws the option so, Widgets.tsx' `KitBody`; ai.ts `lookOf`, 16 KB), or `act`:
  `AI_ACTS` memory/schedule/tab/todo, a removal, run (`text`: a command for a shell tab, `runIn`'s words, Yes runs it), or widget, turning an extension on (`laki_extension_on`; its words say
  what it runs, `widgetTrust.ts` `widgetWhat`: its command or prompt as a code block, the events that run its actions; a
  Yes only while it still says the same and its `filesHash` is the act's `hash`, else the question again as it reads
  now; one that's on is refused), with `id`, `project`, `label`: Yes / No; only while
  `busy`; a chat message with `ask`), `aiAnswer` (`id`, `n`: the AI page's buttons; a pick is the next `aiAsk`, an
  `act`'s Yes is `remove` here, `runAct`, or `widgetSet` `on` with `seen` (the user's, no `agent`), never the AI's own);
- specs and brainstorms (`settings.specs`, `specsOn`; below): `planList` (`project`?), `planNew` (`project`, `kind` spec
  or brainstorm, `title`, `text`), `planGet`, `planSave` (`title`, `blocks`, `markdown`), `planFile` (`path`: text, or an
  image as a data URL), `planUpload` (`name`, `data` base64: `files/…`), `planWrite` (`path`, `text`: MCP's and Laki AI's,
  never README.md or spec.json), `planRm` (the app's, after `ask`); each takes `project`, `kind`, `slug`; off, each says so;
- voice (`voiceOn`: `settings.voice.on` unless false; off: the mic is macOS dictation, no hold Fn, and `voiceText`
  refuses; Settings › Voice, always there: picking an Engine clears an old `on: false`): `voiceText` (`audio`: WAV in base64, 24 MB of it at most; the AI's key,
  `<data>/ai-key`): OpenRouter's `POST /audio/transcriptions` with `voice.model` (unset: `VOICE_MODEL`,
  microsoft/mai-transcribe-2), returns `{ text }`; a 429 or 5xx is tried again after `VOICE_AGAIN` (1 s, 2.5 s;
  `LAKI_VOICE_AGAIN`: tests' shorter waits), then refused with OpenRouter's message and the provider's `raw`; nothing kept. `LAKI_AI_API` is tests' fake, as for Laki AI. The
  renderer's `voice.ts`: engine `device` (unset) is macOS dictation as before; `cloud` records (`getUserMedia`,
  `MediaRecorder`, decoded to 16 kHz mono, `text.ts` `wavOf`) from the prompt's mic or while Fn is held (its capture
  listeners from the module's load, before App's keys, `stopImmediatePropagation`; the mic opens after `HOLD_MS`, so a tap
  or Fn + a key never opens it; another key while held or Esc drops it, Esc while it's written down too; under
  `SHORT_MS`: *Too short*), then types the text where the focus was (`execCommand('insertText')`: a field, a
  contenteditable, xterm's textarea; a terminal or an input gets one line, no control characters), else copies it, as
  it does for a terminal whose agent shows a menu (`ask`: its keys would pick an option); `VoiceBar` (PromptInput.tsx)
  says what it's doing in the app and the new-workspace and AI windows (`html.away` doesn't pause it). Settings › Voice's
  Hold Fn group shows on a Mac only. `voice.send` (*Send as you stop talking*, cloud, off unless true: `voiceSends`):
  `insert` sends it too: an idle `agent` tab's terminal through `send` `agent: true` (refused, it began asking meanwhile: copied, never typed there), a box
  with `data-voice-send` (PromptInput with `onSubmit`, Send later's) a synthetic ⌘⏎ keydown 50 ms after the
  `insertText` (its React state has the text by then); never a shell, another field, under `SHORT_MS`, or a stop of the `MAX_MS` cap's or the window's blur (`voiceStop`'s `only`: typed, not sent);
- the project's scripts besides run (`RUN_SCRIPTS`: test, lint, format, deploy; `ProjectConfig`, `.laki.json`,
  Settings' `ScriptsField`): `run` `script` (`runDev`: `replaceTab` kind `script`, named as it; it stays when it ends,
  a tab's `script` says which (`replaceTab` replaces that one, renamed or not); Enter runs it again, like a dev tab, but a deploy only through Run ▾'s `ask`; `running` while it's alive; not kept over a restart), the view's `scripts` (the ones set: Run ▾'s, ⌘K's;
  App's `runScript`, Deploy after `ask`);
- `sim` (`daemon/device.ts`, `SIM_OPS`; the side panel's Simulator, SidePanel.tsx `DeviceTab`: two frames on their way;
  an Android frame `screencap -j`, a JPEG sized by `jpegSize`, `-p` from then on for a device without it, `noJpeg`; an AVD started
  `-no-window` unless `settings.emuWindow`; a device floated, main's `sim-floating`, leaves the tab, `away`: *Show it*,
  *Bring it back*): `list` (booted iOS
  Simulators by `simctl`, on a Mac, and `adb devices -l`'s ready ones (an emulator named by its AVD, `emu avd name`: the name then OK, within 5 s, else its model), `ios:<udid>` / `android:<serial>`; `why`: what
  keeps a kind out), `frame` (simctl's JPEG or adb's `screencap -p`, through `sips` to a JPEG at most `FRAME_MAX` tall on
  a Mac; the panel asks for the next as one comes, `SIM_GAP` apart, none while hidden: `visibilitychange` starts them again), `shot` (`imageSave`'s path, for
  the prompt), `tap`/`swipe` (`x`, `y`, `x2`, `y2`: fractions of the picture; iOS points by `simPoints` (simctl's `getenv` `SIMULATOR_MAINSCREEN_*`: pixels over scale; idb's `describe-all` names no app on iOS 27's home screen),
  `iosPts`, Android pixels by the last frame's PNG header, `droidPx`), `type` (adb's `input text` single-quoted for the
  device's sh, spaces `%s`), `key` (`IOS_KEYS`, `DROID_KEYS`: back and apps Android's, the arrows HID codes or DPAD); an iOS `shot` in points, as laki screen's;
  `devices` (Settings › Simulators' `SimDevices`: `simDevices`, every `SimDev`: simctl's available devices of iOS
  runtimes and each AVD (`avdsOf`, `avd:<name>`, `on` when an `emulator-*`'s `emu avd name` is it), running first, then
  the newest iOS), `start`/`stop` (`power`: `simctl boot`/`shutdown` (an already-so error is none); an AVD's `emulator
  -avd` spawned detached, `adb emu kill`; the page asks `devices` again 2 s after each answer until it says so,
  `GOING_MAX`);
  `check` (Settings › Simulators, `SimSection`: `SimCheck`s, each `ok`, `says`, a `fix` command (a `›` menu path: no
  Copy) and `warn` (works without it, or none running): iOS `xcode` (`xcode-select -p` an app's, not the Command Line
  Tools), `simctl` (`list runtimes`: the license), `runtime`, `booted`, `idb` (and `idb_companion`); Android `adb`,
  `emulator` (`-list-avds`), `device` (`droidDevices`, shared with `list`)). adb and the emulator are `sdkTool`'s: PATH,
  else `$ANDROID_HOME`, `$ANDROID_SDK_ROOT`, Android Studio's folder. The tab shows with `settings.simulator` (off
  unless true; SidePanel's `sim`), a project's `config.simulator` over it (the app's only, kept by `projectSet`; ProjectSection's
  *Simulator* select, `global.simulator` for its words), its empty state's *Start a device…* and the tablet button are
  `PanelApi.setup`. `DeviceTab`: `list` again 5 s after the last; the device picked per workspace (`laki.sims`; none:
  `laki.sim`, the last anywhere); the screen (`tabIndex` 0) takes keys while focused (`onKey`: `SIM_KEYS`, a
  character typed, a paste; ⌘ and ⌃ the app's, Esc blurs; `queue`/`drain` one call at a time, letters meanwhile as one,
  a held key's repeats dropped while one's on its way); `PanelApi.float` (preload's `floatSim`, main's `sim-float`:
  `simWins`, one `panelWin` per device, `?window=sim&device=&ws=`, NewWindow.tsx `SimWindow`: `DeviceTab` `only`, its
  camera `send` `enter: false` to the workspace's live agent). ponytail: frames polled, a drag one swipe;
  a stream (serve-sim, idb/axe video-stream, scrcpy) next;
- `device` (`daemon/device.ts`; the CLI's `laki screen <op>`, MCP's `laki_device`; `DEVICE_OPS`): shot (the booted
  simulator, `xcrun simctl io <udid> screenshot`, or `app`'s frontmost window: CoreGraphics' window list through JXA
  (`osascript -l JavaScript`), `screencapture -x -o -l <id>`), scaled by `sips` to its size in points (an app window's
  bounds; the simulator's from `simPoints`, else at most `SHOT_MAX` across), saved by `imageSave`, its path
  back; windows; tap, swipe, type, describe through `idb ui … --udid <booted> --` (on PATH: the user's install, as
  cloudflared; Settings › Agent skill says, `doctor`'s `idb`);
- clean-up: `archivedTidy` (hourly and at start: archived workspaces past `settings.archivedDays` dropped as `wsRm`
  would, their branch kept; `archivedAt` set by `wsArchive`, one archived before it counts from the first look);
  `settings.bgRefresh === false`: no `prTick`, `prSoon` or branch-move scans (only `prRefresh`); `settings.copyIgnored` /
  `copyUntracked`: `copyIncludes` takes every ignored (`--exclude-standard`) / untracked file too, copied awaited (a
  relative link into the repo made again as a link: node_modules/.bin's, pnpm's);
- plan limits: `usage`; remote access: `remoteStart` (`hours`, `mail`: resolves once there's a link),
  `remoteStop`, `remoteTick` (`now`: tests move the clock);
- terminals: `screen` (`all`: the whole terminal, the scrollback too, each wrapped line joined, `Session.allText`: a
  tab's *Copy contents*, App's `copyTab`), `input`, `resize`, `view`, `detach`;
- the agent browser: `browse` (`ws`, `op`: open, screenshot, click, fill, text; `url` (a path: the workspace's
  `$PORT`; localhost only), `selector`, `text`) goes to the newest client whose `view` says `browse` as a `browse`
  event (`req`: its id; an `id` would make it a reply), and waits up to 30 s for its `browseDone` (`id`, `ok`, `result` or `error`); a screenshot's PNG is saved
  (`imageSave`) and its path returned. The CLI's `laki browser`, MCP's `laki_browser`.

WebSocket events:
- `state`: the whole view, debounced 30 ms;
- `data` and `responder`: per tab;
- `turn`: waiting, done or limit, for notifications;
- `browse`: an agent browser op, for the app (above);
- `timer`: Laki AI's `laki_timer` (`core.ts` `timer`: checked there, `req` and `which`, not `id`), for the app's window, whose
  timers and stopwatches live in its localStorage (App's `timerAct`); answered with `browseDone`, like `browse`;
- `ai`: Laki AI's conversation and `busy`, as each message comes;
- `tunnel`: a quick tunnel cloudflared started again, at its new `url` (`was`: the old one), for App's toast;
- `open` / `close`: the connection's own status.

`view` carries `tab` (the pane with the keyboard), `tabs` (every pane on screen), `focused` and `browse` (the app's
window: it can run the agent browser). Tabs on screen in a focused window get no ● (`viewed`/`setView` in `core.ts`).

### Profiles and accounts

Settings › *Agents & profiles* (the code's word stays *preset*): each preset can carry `model` and `effort` (`agentCmd`:
the tab's own, from the new-workspace page, wins), for claude and codex `perm` and `fast` (likewise; below), and
`account`. `daemon/accounts.ts`: an
`Account` (`settings.accounts`, only through `accountAdd`/`accountSet`/`accountRm`: `settingsSet` drops `accounts`, so an
import never brings folders) is a folder `<data>/accounts/<agent>-<id>` given as `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
(`accountEnv`, in `lakiEnv`, not on a host); `HOME_ACCOUNT` (`home`) is the agent's own sign-in, no env at all (that
variable set to `~/.claude` would read another Keychain item). `linkShared` links `SHARED` (claude: projects, file-history,
todos, plans, skills, plugins, commands, agents, hooks, output-styles, settings.json, CLAUDE.md, keybindings.json; codex: sessions, archived_sessions,
skills, prompts, config.toml, AGENTS.md) from the agent's own folder, at its making and each start, so a chat resumes on
any account (claude's missing folders made in `~/.claude` first; `~/.codex` is never written: only what's there). `spawnTab` keeps `tab.account` (`accountFor`: its own, else its profile's, else `settings.accountUse`, else
home; a removed one: home); `tabAccount` (a tab's right click › *Restart on another account*) sets it and resumes.
`accountLogin` opens a Terminals workspace `sign in: <name>` and types the agent's login there once its prompt is up
(`whenPrompt`, `loginCmd`). `accountView`: claude's email from the folder's `.claude.json` (home: `~/.claude.json`),
signed in when `usage.ts` `claudeCred(dir)` finds a token: the Keychain item `Claude Code-credentials-<sha256(dir)[:8]>`
(`keychainService`, the folder as given) or the folder's `.credentials.json`; codex's from `auth.json`'s id_token.
`usage` takes `usageWho()` (each agent's accounts, `default` marked), cached per folder; the ring shows the defaults,
the popup each (Usage.tsx `mostRoom`: 20 points ahead). `accountRm` (refused while a live tab is on it) removes the folder (one under `<data>/accounts`; the
links, not their targets) and claude's Keychain item. Laki AI's claude/codex backends take the preset's account, else
the default. Tested in `test/accounts.test.ts` (the fake `security` keeps an account's item in `$HOME/keychain-<name>`).

### Layouts

A workspace's tabs, each a split tree of sessions (`shared/layout.ts`), are the daemon's: `state.layouts` (by workspace,
dropped with it), the view's `layouts`, `layoutOf` (`groupsOf`: ended sessions out, a tab per session in none).
`layoutSet` (`layoutCheck`: shapes, this workspace's sessions, splits 10-90%) from the app: App keeps `laki.groups` for
the first paint and an older daemon, pushes a change 250 ms later (`pushes`: a change on its way wins over a view),
and takes the view's otherwise; the first view with API 60 sends what this window had. `tabNew` `beside`/`edge`
(`layoutPlace`: a split there; `beside: null`, a tab of its own; none with `settings.splitNew`, beside `paneOn`: the
pane the newest focused window is on). `layoutMove` (beside another pane, or none: a tab of its own) and `tabFocus` (a
`focus` event: App's `selectTab`) are Laki AI's `laki_panes`; MCP's state gives each workspace's `tabs` in words
(`describe`: `a | b` side by side, `a / b` stacked). Tested in `test/layout.test.ts`.

### Agent variables

`shared/types.ts` `AGENT_VARS`/`agentVars`: `{{workspace}}`, `{{branch}}`, `{{path}}`, `{{port}}`, `{{pr}}` (its URL),
`{{project}}`, `{{base}}`, `{{storage}}`, `{{tab}}`, `{{agent}}`, `{{date}}`, `{{time}}`, filled by `core.ts` `varsIn`
(`fillVars`: only these names; a missing value stays; into a shell tab, one that isn't plain characters goes in quoted for the tab's shell: fish's way under fish, else `q`) where the caller says `vars`: `send` (before a queue), `addTab`'s
prompt, `wsNew`'s (the new-workspace page with a template, Run ▾'s actions, MCP's `laki_run_action` and
`laki_new_workspace` with a template or an action, scheduled runs). A message as typed never. Workflows add them under
their own (`varsOf`). Settings' chips under an action or a template list them.

### Turns

`daemon/turns.ts` (main.ts imports it; core's `turnStarts`, claude's UserPromptSubmit, and `turnEnds`), core keeping
what the view shows on the tab's runtime:
- each turn's changes (`settings.turnChanges`, on unless false): the worktree as a tree through an index of its own,
  `<data>/turns/<ws>.index` (`treeOf`: first a copy of the worktree's own index, for git's stat cache; `git add -A`,
  `write-tree`, one at a time per workspace; the worktree's own index never touched; Done check's tree too; `turnsTidy`,
  hourly: gone workspaces' indexes, closed tabs' turns), as a claude turn starts (the last turn's card and Undo go then) and as any claude or codex turn ends (codex: the
  last end, or Undo's tree, is its start); a tab's
  `changes` (`TurnChanges`: `n`, `add`, `del`, the first `TURN_FILES` files, git's A/M/D, no renames). The Reader's
  `TurnCard` (Review: Changes' *This turn*, `Scope` `turn`, the `laki-scope` event, `turnDiff`, read only; Undo:
  `turnUndo`, after `ask`: refused while it runs or once one of its files changed since, then `git restore
  --source=<before> --worktree` and its added files removed, `inside`). ponytail: the last turn per tab, in memory;
  this Mac's git workspaces only;
- the next prompt (`settings.nextPrompt`, off unless true; Settings › AI's *Guess my next prompt*): at a claude or codex
  turn's end with an answer (yours: not a workflow's, nothing queued; Laki AI on, with a key for OpenRouter), `aiOnce`
  with your last message (`Runtime.asked`: UserPromptSubmit's, codex's `input-messages`) and the answer's end; a line
  but NONE is the tab's `suggest` while it's idle; the Reader's box shows it as its placeholder, Tab takes it, Esc hides it;
- `tabHandover` (`tab`, `to`: the other of claude and codex; the tab menu's *Continue in Codex / Claude Code*, refused
  from an agent): a handover in the storage folder (`handover-<from>-to-<to>-<stamp>.md`: `chatRead`'s your messages and
  its answers, the newest `HANDOVER_MAX`, and `diff`'s files), then `addTab` of the other agent's first profile told to
  read it (a host's: in the prompt). Tested in `test/worktrees.test.ts`, `test/ai.test.ts`, `test/reader.test.ts`.

`daemon/secrets.ts`: `laki secret <what>` (MCP's `laki_secret`; `SECRET_WAIT`, the CLI's rpc waits as long):
`secretAsk` (`from`'s tab; its storage folder, none on a host) puts `secret` (`{ id, label }`) on the tab (waiting while
its command runs: Needs you, a notification, a phone push), panels.tsx `SecretStrip` at the pane's foot, a password
field; `secretGive` (`id`, `value` or `refuse`; refused from an agent) writes `<storage>/.laki-secrets/<slug>-<hex>`, 0600
(hidden: no artifact) and the agent gets its path; `secretsTidy` (hourly) removes those past 24 hours. ponytail: in
memory (a restart drops an ask). Tested in `test/cli-agents.test.ts`.

### Asks

A waiting tab's view has `ask` (`shared/ask.ts` `askOf`, over the bottom 16 lines of its screen): numbered options
(`1.`, `2)`…), consecutive, at least two, one of them marked (❯ › > ▶ ● →), box borders stripped; the last such menu
wins (tested in `test/ask.test.ts`). `answer` reads it again, then sends ↑/↓ one at a time, 40 ms apart (a TUI reads
a burst as one key; `Session.appCursor` picks `ESC O` or `ESC [`), then ⏎. The renderer's ask bar (App.tsx) shows
them as buttons for the tab with the keyboard; a permission prompt's notification gets *Allow* / *Deny* (main's
`Notification` `actions`; main calls `answer` itself, `pick` first / last, so a closed window doesn't matter). `answer`
needs the tab waiting and takes one at a time (a second after its Enter too). A waiting tab's output has its menu read
again 300 ms later (`spawnTab`'s `onOutput`), and a view goes out when it isn't the ask the last pushed view gave (`askKey`, set in `changed`).

### Sessions

`src/daemon/session.ts`: every PTY is mirrored into an `@xterm/headless` terminal.

- **Attach** sends a snapshot, built with `@xterm/addon-serialize`, plus what serialize leaves out:
  cursor visibility and style, mouse encoding, scroll region.
- The live stream follows on the same socket, in order.
- Any number of clients can attach. The PTY takes the size of the one that typed or resized last (`resizeFor`,
  `follow`: a phone, then the Mac).
- **Exit**: a signal reports code 128+signal. A shell's exit, or a command's with code 0, closes its tab (`core.ts`
  `onExit`); an AI agent's (`tracked`), any code, leaves it with its screen and *press Enter to start it again* (a
  resume; the tab bar dims it, ✓), unless the daemon ended it: closing, archiving and shutdown drop the session from `sessions`
  first, restarting replaces it.

### Sleep

`resources.ts` `sleepTick`: an idle claude or codex tab (`sleepy`: `cantSleep` says nothing, no attached client, idle
`settings.sleepAfter` minutes (unset: `SLEEP_AFTER`, 480; 0: never) by `idleAt` (set in `view` like `runAt`; not the last output: a TUI may redraw); not on a host, not in a workspace with a PR switch on, none of the workspace's
listening ports (`procs`) in its tree) is put to sleep: `asleep` (in memory) and `Session.end`, which SIGHUPs the job
(SIGKILL 5 s later if it's still there) but keeps the screen, the clients and a note instead of the exit line; `onExit`
leaves it be. Its view is `idle`, `asleep: true` (the tab bar dims it, its tooltip says so); `onExit` ignores a session no longer in `sessions` (replaced or dropped). `wake` (an attach in `main.ts`, any `input` but xterm's own focus and mouse reports (`REPORTS`; the key is
dropped), `send`, `tabWake`) is `spawnTab` `resume`, status running (so `send` queues; `sweepRunning` ends it once
quiet and delivers), the ● kept. Enter's restart of an ended agent with a queue sets running too, for the same delivery. `agentOf` and scheduled
runs count an asleep tab as live. A replaced session's `kill` sends its clients `exit` with code -1, which `Term.tsx`
takes as "attach again" (a wake, Enter on an ended agent).

### Terminal queries

Queries (DA, DSR/CPR, DECRQM, DECRQSS, XTVERSION, OSC color) are answered exactly once.

- The newest attached client is the *responder*.
- Other renderers swallow those queries through xterm.js parser hooks (`Term.tsx`).
- With no client attached, the headless terminal answers.

### Agents and hooks

Commands run as `$SHELL -lic '<cmd>'`. An agent's values (its prompt, Laki's note, paths, flags: `agentCmd`) are
never quoted into that line: a plain word (`PLAIN`) goes in as it is, anything else in the tab's env as `LAKI_ARG_n`,
named `"$LAKI_ARG_n"` (sh, bash, zsh and fish expand it whole; fish reads `\'` inside single quotes as an escape); on an
SSH host the generated `/bin/sh` script exports them. A preset's `args` stay as written. The environment adds:
- `TERM=xterm-256color`, `COLORTERM=truecolor`, `LAKI_APP=true`;
- an agent's `FORCE_HYPERLINK=1` (claude's links as OSC 8; an env may say 0; not shells': piped output would get
  them): `Session` snapshots keep them (`keepLinks`: the serialize addon drops them);
- `LAKI_WORKSPACE`, `LAKI_TAB`, `PORT`; `LAKI_HOOK` (a key per start, the Session's `hookKey`: `laki hook` sends it, and
  main.ts' `hookWho` takes a tab's state with its key only, else from a process of that tab or of none (`peerOf`: tests'
  direct `hook` calls), never another tab's; never from remote access, `REMOTE_NO`);
- `LAKI_STORAGE_FOLDER` (`storageOf`; `STORAGE_NOTE`, the start note's and the laki skill's words: files, and a
  link for each thing an agent publishes, kept in its `LINKS`, `.laki-links.json`; a `.url` file it saves is moved in, read by `urlOf`): the workspace's own folder for what its agents keep for you, `<settings.storageDir
  or <data>/storage>/<name>-<id>`, named and made at its first tab, kept as `ws.storage` (a rename doesn't move it); none
  for Terminals, Browsers and hosts. `wsRm` and `projectRm` delete it (`rmStorage`: only a `…<id>` folder) unless `settings.keepStorage`; archive keeps it.

Claude and Codex are told about Laki at every start (`LAKI_NOTE` and Settings' global memory, then the project's, `memoryNote`, unless the preset's `laki` is false; then
`PROGRESS_NOTE` with `settings.progress`; one text through `--append-system-prompt` / `-c developer_instructions`, not when
the preset's args set their own, nor for codex when its `config.toml` has `developer_instructions` (`codexOwn`: `-c` would
replace them), not on a host): what Laki is, `laki rename .`, `laki pr .`, `laki new .`, `laki browser`,
`$LAKI_STORAGE_FOLDER` (`STORAGE_NOTE`: files, and a link to what it publishes). The CLI's `rename`/`pr` take `.` for `$LAKI_WORKSPACE` (`wsSet` name, `prAttach`).

Claude gets `--settings <data>/claude-settings.json` and, on this Mac (not a host: no laki CLI there), `--plugin-dir
<data>/claude-plugin` (`claudePlugin`, written by `writeHooks`): a plugin named laki whose `commands/new.md` is
`/laki:new <task> [with <agent>]`, a new workspace in this project through `laki new .` (the CLI's `.`: the project of
`$LAKI_WORKSPACE`'s workspace; `allowed-tools` lets it run only that `laki new` unasked); the laki skill's SKILL.md says the same for the other agents.
Other modules add commands through `pluginFiles` (core can't import them): skill.ts' `commands/extension.md`,
`/laki:extension <what>`, the laki-widget skill's guide (`widgetGuide`) with `LAKI_CLI` as its command, only you start
it (`disable-model-invocation`), and only `READ_ONLY`'s `laki widget` subcommands allowed unasked (N10: new, dev, set,
on and the rest ask in Claude's own prompt). Its hooks run `laki hook <state>`, using an absolute
node/Electron path and `hook.js` (`src/cli/hook.ts`, core's `hookArgv`: conn.ts only, so a tool call's hook doesn't load the
whole CLI; `laki hook` through the CLI imports it), and map to states:

| hook | state |
|---|---|
| SessionStart | records the resume id |
| UserPromptSubmit, Pre/PostToolUse | running |
| PermissionRequest | waiting, and the tab's `perm` (the tool, what it touches, the rule): prints nothing, so claude asks in its own menu |
| Notification (permission prompts) | waiting |
| Stop | idle, plus the last answer, then delivers the next queued message; with `background_tasks` of agents still going (subagent, workflow, teammate: `bgAgents`), running instead (`Runtime.bg`: no ●, no done notice, no turn's end; sweepRunning leaves it `BG_MAX`): they report back as a new turn |
| StopFailure | usage limit (`limits.ts`) |
| PreCompact | running and `compacting` (the tab and row say *Compacting…*) until its next hook (SessionStart, source compact) |

Codex gets `-c notify=[…,"hook","done"]`, which reports the thread id and the end of a turn.

Hooks not heard (core.ts `hookTick`, every 30 s; `daemon/hookHealth.ts`): a live tab on this Mac of an agent whose hooks
say as a turn starts (`HEARS`: claude, gemini, opencode; codex's notify comes only as one ends), its session started
`DEAF_AFTER` (2 minutes) ago, given a prompt (`prompted`, per Session: `typeInto`'s Enter, a typed Enter in `input`, its
start's) that its screen answered (`Session.lastOutput` since), and no hook from this start (`heardIn`, per Session: a restart under a moved app is checked anew): its view's `hookless`
is `hookCause`'s first that holds: `disableAllHooks` or `allowManagedHooksOnly` true in the worktree's
`.claude/settings.local.json`, `.claude/settings.json`, its config folder's (an account's, or `CLAUDE_CONFIG_DIR` from
an env), `~/.claude/settings.json` or the managed one (read only; the file and line as `detail`); the profile's args with
their own `--settings`; `CLAUDE_CONFIG_DIR` in the profile's, project's, Settings' or the daemon's env (no account);
`hookArgv`'s node or script gone or not executable (a moved app under a daemon that outlived it); gemini's trusted
folders; else unknown. Any hook clears it (`hook`, `heard`: each agent's last, `hooksSeen`). panels.tsx `HookStrip` at
the pane's foot (Details, Copy; Dismiss: App's `hookHid`, per tab, in memory); `doctor`'s `hooks` runs `hookArgv` `hook
ping` (hook.ts exits 0 before any RPC) and `hookFiles` reads `hookFiles(localHooks)`' files back: Welcome's rows. Tested
in `test/hook-health.test.ts` (the fake claude runs no hook with `disableAllHooks` in `$HOME/.claude/settings.json`).

The other agents (`AGENTS` in `shared/types.ts`: the command is the id; `presets()` defaults to claude, codex and
those on PATH):
- **Gemini**: `gemini -i <prompt>` (0.4.1 answers a bare prompt and exits), `--resume <id>`. Hooks (versions that
  have them, in a folder Gemini trusts) in `<data>/gemini-settings.json`, given as `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`
  (the lowest layer; hook lists add up with the user's): SessionStart (session_id), BeforeAgent/AfterTool (running),
  Notification (waiting), AfterAgent (idle, `prompt_response`); each prints `{}` (gemini wants JSON back). Superset
  puts the same hooks in `~/.gemini/settings.json`; Laki may not. Laki doesn't trust folders for it.
- **OpenCode**: `opencode --prompt <p>`, `--session <id>`; a model in `OPENCODE_CONFIG_CONTENT` (`{"model": …}` over a
  profile's own of it), never `-m` (some versions' TUI refuses it). `OPENCODE_CONFIG_DIR=<data>/opencode` (on top of the
  user's config) loads `plugin/laki.js` (`OPENCODE_PLUGIN`): session.created (not a subagent's: `parentID`) →
  start, session.status busy/idle (idle with the last answer, from `client.session.messages`),
  permission.asked/question.asked → waiting, session.error → failed (an Esc's `MessageAbortedError`: interrupted), and
  the idle after either says nothing; reports go one at a time, in order.
- **Grok**: `grok --session-id <uuid> <prompt>`: Laki picks the chat's id, `--resume <id>` after. Its TUI takes hooks
  only from `~/.grok` (or `~/.claude/settings.json`), so it has none: Enter or a prompt sets running; `sweepRunning`
  reads its window title (`Session.title`: `BUSY` while it works, `ASKS` "Action Required": waiting) and ends the
  turn after `QUIET` with no `BUSY` text, as a hook would (a done notification; a turn started by Enter only after 8s, `Runtime.since`: likely a menu). Gemini without
  hooks too (`Runtime.hooked`: a hook came from the tab; `turn` is `hook` without marking it).

### Projects

A project is a git repository (its top level) or any other folder (`git: false`: local workspaces only,
no branches, diff, PRs or ship). New worktrees go to `worktreesOf` (the folders it makes 0700, a folder you had as it is): the project's `config.worktrees` (the app's only; relative: to the repo),
else `settings.worktrees` (`~` is home) with a folder per project, else `<data>/worktrees/<project>`; a host's stay in
`~/.laki-host`. Made ones keep their path. `config` (setup, run, teardown, expose), set in the app, wins field by field over
the repo's `.laki.json` (`projectConfig`: the project's own folder only, never a worktree's, so a branch, a PR's checkout
or a fork can't swap in its own setup, teardown, run, env, copy or ports). Its trust: a project's `trusted` (`cfgHash`,
sha256 of its JSON); a file that isn't that gives its `ports` only (`cfgWait`, the view's project `cfgWait`: App's
status bar *.laki.json waits for you* and `cfgSheet`, also after the new-workspace page makes one); `projectTrust` (no
`hash`: its text and hash; with the shown one: trusted, then each `setupWait` workspace (made meanwhile) gets
`copyIncludes` and its setup, a `noSetup` one's copy only). `ENV_BAD` (`ZDOTDIR`, `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `PATH`, `DYLD_*`, `LD_*`,
`*_BASE_URL`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) never comes from the file, trusted or not, each said once in
daemon.log. `load` trusts projects from before (no `state.cfgTrust`) as their file is (a host's `as-read`: at its first
read). Tests: the rig's `projectAdd` trusts (`rig.trust`) unless `untrusted: true`.

### SSH hosts

A project with `host` (`projectAdd` `host:path`, `REMOTE` in `shared/types.ts`: a `~/.ssh/config` name or
`user@host`; `hostProjectAdd`) is a folder on that machine; its workspaces copy `host`. `hosts.ts`' SSH hosts section:

- One connection per host (`hostUp`, `connect`): a ControlMaster the daemon spawns (`-M -N`, socket at
  `<data>/ssh/<hash>`, `BatchMode`: keys or agent, no prompts; a failure stands 10 s), then `$HOME` and the login
  shell's PATH there, then `hostFiles` (heredocs over `sh -s`) puts `~/.laki-host/<mac>/` (`mac()`: the hostname when
  first asked, kept in `<data>/ssh/mac`, since macOS's changes with the network): the `hook` script
  and the agents' hook files (`hookFiles`, as here, their command `<dir>/hook <state>`). Its `exit` drops it: the next
  use connects again. `stopHosts` at shutdown.
- `exec(at, cmd, args)` / `git(at, …)`: here, or `ssh host 'export PATH=…; cd <path> && exec <cmd>'` through the
  master. Every git and gh call takes an `At` (a project or workspace). `sshIn` sends a script or a file on stdin
  (never on a command line: `ps` there shows those). Both go 8 at a time per host (`slot`): sshd takes 10 sessions
  per connection (MaxSessions).
- A tab (`spawnTab` → `hostTab`): its PTY here runs a `/bin/sh` that waits for `<run>/<key>.go` (or prints
  `<key>.err`), then `ssh -tt … 'exec sh ~/.laki-host/<mac>/run/<key>.sh'` on a connection of its own (`TAB_SSH`:
  not the master's sessions; `spaced`: 300 ms apart per host, sshd's MaxStartups drops handshakes past 10). Meanwhile the daemon puts that script
  there: `rm -f "$0"`, `LAKI_TTY=$(tty)`, the folder, `lakiEnv` exported (with `LAKI_HOOK`, a key per start), then
  `exec "$SHELL" -lic <cmd>`. A shell that loses its connection (255) stays; Enter starts it again, like an agent.
- Hooks: the host's `hook` prints `OSC 7717 ; <key> ; <state> ; <base64 JSON> BEL` to `$LAKI_TTY`; the Session's
  headless terminal (`onHook`) hands it to `hook()` when the key is this start's (`running` sends `{}`: PreToolUse's
  payload holds whole files). Nothing listens on the host, and nothing there reaches the daemon.
- `forward`: each live workspace's `$PORT` (`ssh -O forward -L port:localhost:port`) when the host connects and in
  `wsNew`/`wsRestore`; cancelled in `teardown`.
- `.laki.json` there: `hostCfg` (null: none), the project's folder's, read by `readHostCfg`/`readHostCfgs` (project add, `wsNew`, `wsRestore`,
  a tab's start when not read yet, each PR scan: `hostSync`, which also follows the branch); `projectConfig` reads the
  cache. `wsArchive` needs the host up (teardown there would fail quietly); `diff` gets new files' diffs in one call.
- `toHost` copies the images a prompt or `send` names (`<data>/images/…`) to the host and rewrites their paths, and
  attached files by their folder (`<data>/files/<id>/`: the one file in it to the same name there, only the folder
  rewritten, so a quoted name with spaces stays whole) (`textFor`, `typeInto` takes a promise). `files`, `fileRead` (`hostFileRead`: base64), `fileNew`, `diff`, stats run
  there; `openIn` opens `vscode|cursor|windsurf://vscode-remote/ssh-remote+<host><path>`, other apps refuse.
- Not there (ponytail): `copyIncludes`, port scans (`scanPorts` sees none), new files' lines in `stat`, a local
  workspace's branch sync, the agent skill. Tested with `test/fakes/ssh` (every host is this machine; `nohost`
  refuses) in `test/ssh.test.ts`.
- `-F <data>/ssh/config` (`codespace.ts` `sshF`: once the file is there, on `sshOpts`, the master's spawn and a tab's
  ssh line): `<data>/ssh/codespaces/*` first (ssh takes an option's first value: a `Host *` of yours never wins over a
  codespace's own; they name only `laki-cs-*`), then `Include ~/.ssh/config`, `/etc/ssh/ssh_config` (-F reads neither),
  so plain hosts read as before.
- Cloud workspaces (experimental, `settings.cloud`; `hosts.ts`' cloud section, `daemon/codespace.ts`: gh on this Mac): a
  workspace of a local GitHub project (`origin`, `ghRepo`) with a host of its own, `codespace` its codespace's name ('' while
  made), `csState` (gh's word; `Creating`, `Failed` with `csError`). `wsNew` `codespace` (a machine type, '': the repo's
  first; `cloudCheck`: the setting, not an agent's (`from`: GitHub bills it), not a host's or a folder's, not Local, a
  PR or a race) asks `machines` (`gh api repos/<o/r>/codespaces/machines`: the scope, the repo and the type, at once;
  `csMachines`, the new-workspace page's *In a codespace* picker), then answers with the workspace (`cloudNew`: host
  `laki-cs-<id>`, path `<CS_ROOT>/<repo>`, `/workspaces` unless `LAKI_CS_ROOT`, tests'; branch `laki/<id>` off the base),
  while `csMake` (`making`) runs `gh codespace create -R -b -m --default-permissions`, waits for Available (`until`),
  writes its Host entry (`gh codespace ssh --config`, its `Host` line renamed: `sshEntry`) and makes the branch there (a
  one-off ssh), then connects. `connect` waits for it (`csUp`: made or its `csError`; a stopped one started:
  `gh api -X POST user/codespaces/<name>/start`, then `until`), so its tabs wait in `hostTab` and print why it failed.
  `away` (made, stopped or not connected: `live`) keeps scans off it (PRs, `stat`, `wsPeek`): none wakes it.
  `csRefresh` (`gh codespace list`, with each `scanPRs` and as its master exits) keeps `csState` current. Archive:
  `gh codespace stop` (no `ifClean`: its files stay; no teardown script), Restore: `hostUp` (starts it), Delete:
  `gh codespace delete --force` first (a failure keeps the workspace), `dropWs`' `csGone` for the rest
  (`archivedTidy`, a project removed); `load` marks one left `Creating` `Failed`. `SCOPE`: gh without the codespace
  scope says `gh auth refresh -s codespace`. Tested with `test/fakes/gh`'s `codespace` (its create clones the
  project into `$LAKI_CS_ROOT/<repo>`, a state file each) and `fakes/ssh` in `test/ssh.test.ts`.

### Presets

`settings.presets` (default: plain `claude` and `codex`) say how agents start: `agent` (claude, codex,
command), `args` (appended raw before the prompt), `cmd`, `env`, `laki` (false: no `LAKI_NOTE`; Settings' *Tell it about Laki*, claude and codex), `off` (Settings' switch: out of the renderer's
pickers, the new-tab menu, the new-workspace page and its races, scheduled tasks; the daemon still starts it). A tab keeps `preset` = what the agent is
(hooks, resume, colors) and `profile` = the preset's name, looked up at every start (`presetOf`), so edits
apply on restart. Env order: process < `settings.env` (global) < project (`.laki.json`, then the app's) <
preset < Laki's own vars.

A tab's `model` and `effort` (`wsNew`, `tabNew`, kept by `wsFork`; `modelCheck` before a worktree is made: a name, an
effort of `EFFORTS`) become flags at every start (`agentCmd`): claude `--model`/`--effort`, codex `-m` and `-c
model_reasoning_effort="…"`, opencode its inline config (above), the others `-m`. Likewise `perm` (`PERMS`: claude's `--permission-mode`; codex's
`--approve-for-me`, `-s workspace-write -a never`, `-s read-only`, `--dangerously-bypass-approvals-and-sandbox`) and
`fast` (`FAST`: claude's `--settings` is `claude-settings-fast.json`, the same with `fastMode`; codex `-c
service_tier="fast"`); the new-workspace page sets them (a race's agents keep their own). A tab's unset `perm`/`fast`
is its profile's, read at each start; `''` (*Ask first*) and `false` are none over the profile's (`addTab` keeps them):
the page shows the profile's as picked and sends only a change from it (`permSent`, `fastSent`). A profile whose `args`
set a mode (`permInArgs`: claude's `--permission-mode`, `--dangerously-skip-permissions`; codex's `-s`, `-a`,
`--full-auto`…) gets none of Laki's, the page no picker, Settings' select off. `view` gives a running or waiting tab `runAt`, its turn's start (set
there: each change of status comes with `changed()`), for the turn timers (`settings.timers`).

### Interrupts

Esc or ⌃C ends a Claude/Codex turn without any hook. `input` sees the key and `interrupted` checks the
screen for "Interrupted" a few times over 2.5s; a `running` hook in between cancels it. A turn can also end
with no hook and no key (a resumed chat's recap): `sweepRunning` (every 2s) sets a running tab idle after 4s
without output when its last 15 lines lack "esc to interrupt" (claude and codex show it, and redraw, while
they work).

### Resume

`state.json` keeps projects, workspaces, tabs and resume ids (`save`: fsync, then rename; `load` copies one that
reads as `state.json.bak`, and moves one that doesn't to `state.json.broken-<ms>`, then loads the `.bak`: never
empty over it). `daemon.log` goes to `daemon.log.1` past 10 MB when a daemon starts. Starting the daemon brings every tab back:
`claude --resume <id>`, `codex resume <id>`, a few at a time (`restoreAll`: each in `queued`, as `asleep` meanwhile, the
oldest first; a tracked agent whose `usedAt` (a tab's: made, or `turn()`'s every state but start; `keepShells` saves it at
shutdown) is older than `sleepAfter` is `dormant`: queued, never started by `nextRestore`, only by `restoreNow`, its view
`asleep` without `queued`; `RESTORE_GAP` 2.5 s apart, a shell's a tenth; the view's `queued`, the tab's tooltip; `restoreNow` for one a look, a key or a message wakes,
and every one of a workspace a window shows, `setView`; `LAKI_RESTORE_GAP` 0: all at once, tests'; shutdown clears it). Shells come back with what ran in them: `keepShells`, in `main.ts`'s
`shutdown` before the sessions are killed, gives each local shell tab `again` (state.json): its front program's
folder (`lsof -d cwd`) and `rerun`'s command. An agent resumes and runs: claude by `~/.claude/sessions/<pid>.json`'s
`sessionId` (read only), else `--continue`; codex `resume --last` (its newest chat in that folder). Anything else is
typed, no Enter; a node shim's line is its name again (`node /…/bin/npm run dev` is `npm run dev`). A live Run tab
gets `again` `{ run: true }`, and `restoreAll` keeps it. `restoreAll` starts the shell in that folder, then `bringBack`
types it once the prompt is up (it printed, then 500 ms quiet; 10 s at most) under a dim note. A crash keeps nothing,
and neither does a host.

A resume of a chat claude or codex don't have (`CHAT_GONE`, their words on the screen as it exits) drops the tab's
`resumeId` (Enter starts a new chat) only when it exits within `RESUME_FAIL` (30 s) of starting: later, a chat's own
words ("session not found") don't. In development mode `spawnTab`'s exit logs each agent's end to its workspace's log:
the code, the seconds it ran, its last lines.

### Scans

- Shells (`shellTick`, every 2 s): a local shell tab whose terminal's foreground process group (`ps -o pid=,tpgid=`,
  one call for all) isn't the shell's own is `running` in `view` (`busyShells`): the spinner while a command runs (its first
  `SHELL_SPIN`, 5 s, only, a Run tab's too: the renderer's `text.ts` `shownStatus`; vim or a server would spin for good), not
  `worked()` (an agent's turn, for review comments) nor notifications. One whose foreground program is an agent
  (`agentRuns`: `ps -o args=`, claude or `node …/codex`) is `shellAgents`: its status off its screen (`askOf`: waiting;
  `BUSY`: running; else idle, `done` if no one looked), the view's `runs` (it spins its whole turn); no notifications.
- Artifacts (`scanArtifacts`, with the port scan): the files in each live workspace's storage folder, hidden files and folders not
  counted, one scan at a time, as `WorkspaceView.artifacts`: the status bar's *Artifacts: n* (a menu: Finder, or *Show here*: panels.tsx
  `ArtifactsBar`, a strip of previews over the status bar from `artifactList` (newest first, 500 at most) and `fileRead`
  `storage` (the folder as the root, `inside`'s checks), a click shows one big, ← → the others; the folder's folders first,
  a click goes in (`dir`), the head's path or ← back out), none at 0. Its links (`LINKS`: http(s), or `file:///`) are `WorkspaceView.links` (newest first): Info's *links* rows, and first in the gallery,
  where a click opens them in the browser (the renderer's `openKeptLink`: a `file:///` one through main's `open-path`; `openExternal`, every other link's, never opens files; an HTML artifact *in the browser*, `inBrowser`: the daemon's sandboxed `/artifact/` page, never a `file:` page, L11). `keepPublished`, at each turn's end (`turn`'s idle/done/failed), keeps
  a link for each one the agent published and the folder hasn't (`sameUrl`): its publish tools' (`publishedBy`, from
  claude's PostToolUse payload, buffered as `Runtime.published`: the Artifact tool's publish, not its read/list/asset, or an
  `mcp__` tool named publish/deploy/upload/share: the first https link it returned, named by its `title`/`name`/file) and
  its last answer's (`publishedIn`: `PUBLISHED`'s hosts, claude.ai artifacts, gists, vercel.app, netlify.app, pages.dev,
  github.io…; named by `[text](url)`, else its sentence's words less "I published", else the host).
- Ports: the `ps` process tree of each workspace's tabs, matched against `lsof -iTCP -sTCP:LISTEN -Fpcn`, every 5s
  (`procs`: each port's pid and command, `WorkspaceView.procs`; `.laki.json` `ports`, strings only, as `portNames`).
  An agent tab's own processes (its pid and what it runs with no shell between: `ps`'s `comm`, `SHELLS`; its browser
  bridge, an MCP server, the browser that drives) and any of `THEIRS` (a browser, an Android emulator's qemu-system and netsimd) listen for the agent: `own` in `procs` (sleep still
  sees them), left out of `ports`; what its shell tool starts (a dev server) is the workspace's.
  `portKill` (the status bar's ✕, after `ask`): that pid, if it still listens there and is yours (uid), gets SIGTERM,
  and SIGKILL 3 s later if `ps`'s uid and start time are the same. First,
  `syncBranches`: each workspace's `branch` follows its folder's HEAD (`headOf` reads the file, no git run; detached
  stays), so an agent's `git checkout -b` moves the PR lookup, status bar, ship and restore with it (a PR only linked
  stays: its branch's own replaces a guessed one once pushed), and scans PRs now.
  A turn's end scans its workspace's PR 2 s later too (`prSoon`, at most every 20 s each; `scanPRs`' `only`, a branch
  move's too): `gh pr create` shows up without the minute's wait.
- Done check (`daemon/verify.ts`, main.ts imports it, core doesn't: `turnEnds`, core's `checkHooks.will` and `checks`;
  `settings.doneCheck`, on unless false): a project's `check` (`DoneCheck`, `checkOk`: `steps` of `CHECK_STEPS` in that
  order, `review` claude or codex; the app's over a trusted `.laki.json`'s; a step without its script dropped:
  `checkOf`). A tracked agent's turn end (not a limit or failure, not a workflow's tab, nothing queued) whose worktree
  changed (turns.ts' `treeOf`, the turns' index, below: the same as the last check's, or the
  merge base's the first time, unless that check failed: skipped, `check` event `skipped`) runs each step as a workflow's
  run block would (`$SHELL -lc`, the workspace's env, `CI=1`, its group, `LAKI_CHECK_MIN` minutes), then `aiOnce` with
  that agent's first preset over `diff` (`DIFF_MAX`; LGTM or notes). A failure `send`s the agent its output (`fence`d,
  untrusted) `whenIdle`, `CHECK_TRIES` in a row, then `over` (a phone push). `turn`'s broadcast says `checking` when
  `will`, so App waits for the `check` event to notify (passed, over, skipped; failed: none). `CheckRun` in the view as
  a workspace's `check`; panels.tsx `CheckStrip` at the pane's foot; App's `offerCheck` (once per project,
  `laki.checkOffered`); SettingsProject.tsx' *Done check* group. `checkTidy`: hourly, gone workspaces' last trees and
  `<data>/check` (each check's own index before 0.42).
- Reader view (`settings.reader`, on unless false; meters.ts `chatRead`: a `Reader` per tab, `tailOf` and share.ts'
  `chatOf` as shares read, `v` moving with it, the newest 400; `{ none }` without a transcript): Reader.tsx over the
  pane's `Term` (still attached; its `active` off meanwhile), `readable` (claude, codex), asked every 1.5 s while shown;
  App's `readMode` (`laki.reader`: `reader` or `term` per tab, unset: `narrow`'s Reader), `.reader-switch`, the tab
  menu's item; its box is `send` `whenIdle`, its ask `answer`. Tested in `test/reader.test.ts`.
- One next step (`settings.nextStep`, on unless false; shared/nextStep.ts `nextStep`: a workspace's tabs, `check` and PR
  to one `Step`, `busy` while an agent or CI works; overlaps aren't one: Check overlaps, the row's ⇄): App's
  `stepOf`/`doStep`, `stepItem` (with `STEP_ICON`) first in `wsMore` (the toolbar's ⋯) and `wsMenu` (a row's ⋯ and right
  click), ⌘G (`KEYS`' `step`: `doStep`), a row's `.ws-step` chip only with `rowMarks.step` (`STEP_CHIP`'s words; not
  busy, nor `conflict`, `ci`: its ⚠ and red mark say those; not Terminals' or Browsers'). Tested in
  `test/next-step.test.ts`.
- A sidebar row's marks (Settings.tsx `ROW_MARKS`, `rowMarkOn`, `rowMarkSet`: `prIcon`, `prMarks`, `diffStat`, the rest
  `settings.rowMarks`, on unless false but `step`, off unless true; `conflict`, `ci` unset: as `prIcon`): App's `mark` in
  `wsRow`, `showItems` (*Show ›* in `wsMenu` and `projectActions`), Settings › Appearance › *Sidebar rows*.
- The agent's plan, live (`settings.livePlan`, on unless false; shared/todos.ts `planFrom`): claude's to-do tools from
  its Pre/PostToolUse payloads in `turn()` (TodoWrite and update_plan the whole list before they run; TaskCreate after,
  for its id; TaskUpdate by `taskId`; a subagent's, `agent_id`, left out), codex's `update_plan` from its transcript
  (share.ts `meterOf`, so only while the meters read: `contextMeter` or `costs` on), as a tab's `plan` (`TabPlan`:
  items todo/now/done, `stale` once a prompt came since: the next TaskCreate starts it over); all done, it goes as the
  turn ends. ExitPlanMode's `plan` is `planAsk` while the tab waits. panels.tsx `PlanStrip` at the pane's foot (the
  list, folded by its head; the plan card: the ask's options, or a changed plan's *Send changes*: the last option, then
  `send` `whenIdle`), App's `.ws-plan` (n/m) on a row; the ask bar steps aside for the card. ponytail: claude's
  TaskCreate id read from its result's text when it isn't JSON.
- Collision radar (`scanOverlaps`, files.ts, every 15 s, `LAKI_OVERLAP_MS`; `settings.radar`, off unless true; `overlapCheck`: one worktree now, Workspace › *Check overlaps…*): each
  live worktree on this Mac (no host or codespace) as `git diff -U0` against `diffBase` plus its untracked files, by the
  base's lines (shared/overlap.ts `rangesOf`: a new file `[0, 0]`, whole; `RADAR_SKIP`'s lockfiles out), against the
  project's other worktrees' and what its base gained since the merge base (`<from>..<base tip>`, cached by both;
  nothing fetched): `overlaps` (lines that meet or touch, as git's merge would conflict) as `WorkspaceView.overlaps`
  (`Collision`: `ws` or `base`, `file`, `mine`, `theirs`). ponytail: two worktrees off different merge bases compare
  their own lines. The renderer: App's `.ws-radar` mark (how many others), `radarTip`, `radarMenu` (open the other, tell
  either agent with `send` `whenIdle`, ask it to merge the base in, *Hide until it changes*: `laki.radarHide`).
- Diff size (`scanStats`, every 10 s, `LAKI_STAT_SCAN_MS`; with `settings.diffStat === true`, off by default, or the Review tab (`settings.fullReview` unless false), and a race's
  always, for Compare): each live git
  workspace's `git diff --numstat` against `diff`'s base, new files' lines (the first 100, up to 1 MB) and `git status`'s
  count as `stat` (`WorkspaceView.stat`: add, del, files, dirty); one scan at a time.
- PRs: `gh pr view <branch> --json …` (`PR_FIELDS`: title, author, checks list, head commit, base
  branch, review decision, mergeable: `PR.conflict`, the sidebar's ⚠, mergeStateStatus: `PR.ready` (CLEAN or HAS_HOOKS; UNKNOWN: none), size, body, reviews:
  `reviewersOf`'s (each author's last approval or ask for changes) `approved`, `changes` (the PR section's *Approved by*, the hover card, the status bar's tip); `yoursOn`'s `approvedByMe` and `commentedByMe` (someone else's PR: your approval, your comments or reviews with them; `comments` in `PR_FIELDS`), the sidebar's ✓, ✓✓ and 👀 (`settings.prMarks`: `approved`, `mine`, `commented`, unset on; `at`: start, name or end); `mine`: the author is `ghLogin`'s,
  `gh api user` once per host: no avatar, no Approve), every `settings.prScan` minutes
  (`PR_SCAN`, 1; `prTick`, each minute; `LAKI_PR_SCAN_MS`: tests' pace instead); one scan at a time (`scanPRs`), so `autoPR` never sends twice.
  A gh failure but *no pull requests found* (a rate limit, the network, a timeout) keeps the last PR; the timer's scans
  (`scanPRs(true)`) skip a branch gh found none for within `NONE_EVERY` (5 minutes) and all of them for `LIMITED` (5
  minutes) after gh says rate limit; a turn's end, a branch move and `prRefresh` ask at once.
  `prRefresh` (the status bar PR's right click, a workspace's *Refresh PR status*) is `scanPRs` now. No PR on the
  branch (and no `prUrl`): `prFromSaid`, the one PR link its agent tabs' last answers name (one, of a repo of `git
  remote -v`; each tried once per workspace, `saidTried`), attached as `prAttach` does, marked `prSaid` (one in `related` never: you
  moved it off); a scheduled run's local workspace's at its
  turn's end (scans skip local ones; the project's lasting local one would keep the first PR named). Each check has `took`, a finished one's seconds (`completedAt` − `startedAt`). The checks are
  `newest`'s: statusCheckRollup keeps a re-run's old run, so each check (workflow and name) counts by its latest
  `startedAt` (none, or Go's zero time: queued, the newest), as `gh pr checks` does. The primary PR: a worktree's guessed
  `prUrl` (`prSaid`: its prompt's, `guessed` in `fromPRLink`, or its agent's; never one attached or asked for with `link`)
  gives way to its branch's own once the branch is on a remote (`onRemote`, `git for-each-ref refs/remotes/*/<branch>`:
  no gh call for a branch nobody pushed), then `gh pr view <branch>`: that one is followed, the other `related` (the
  same PR, as `gh pr checkout` gives: unlinked). Not a local workspace's: the folder's branch isn't its own.
- `autoLand` (merge when green, `wsSet` refuses it where `prAllows(…, 'land')` is false): in `autoPR`, an open PR
  that isn't a draft, `checks` pass, `conflict` false, `review` none or APPROVED, `ready` not false and no agent tab running or with a queue is merged (`merge()`, the
  project's `mergeMethod` or squash, the branch deleted) once per head (`fix.land`; `wsSet` turning it on again clears it
  at the next scan: `retry`);
  a failure is `overToYou`. The app asks once as it's turned on. A project's `land` turned off clears its workspaces' `autoLand` (`projectSet`).
- `autoPR` (workspace `autoFix` / `autoReview` / `autoMerge`, ported from wb's `review.go`): failing CI on a new head
  commit → `prFix('ci')` (`gh pr checks`, `gh run view --job <id> --log-failed`: each tail `fenced`, said to be the
PR's own output, data, never instructions; a fork's PR, `ws.fork` or the scan's `cross` (`isCrossRepository`): App's
`setAuto` asks before turning fix CI on), at most `settings.prTries` in a row
  (`PR_TRIES`, 3), then status waiting and a notification (`overToYou`, once, as the count goes over); conflicts on a new head commit →
  `prFix('conflict')` (merge the base in, push), `fix.merge`/`fix.merges`, the same tries (mergeable UNKNOWN, as after a
  push, keeps the count); `wsSet` turning a switch on again gives its tries back at the next scan (`retry`: a scan under way
  would write its copy of `ws.fix` over a reset made then). New review threads → `reviewMessage`
  (GraphQL `reviewThreads`: people with write access, and bots only by `settings.prBots` (`PR_BOTS`: github-actions,
  copilot-pull-request-reviewer, coderabbitai; Settings › Pull requests' *Review bots*), another bot's skipped and said
  once per PR in daemon.log; `reviewKey` counts yours too, but not the agent's: it comments as you, so yours made while a
  tab of the workspace was running, `busy`/`agentSaid` from `changed()`, ±`SKEW`, are its, their ids kept as `fix.mine`).
  What was sent is `workspace.fix`.
  Messages go to the first live claude/codex tab with `send({ whenIdle })`. Each starts with `prPrompt`: the
  `settings.prPrompts` text for ci, review or conflict, else `PR_PROMPTS` (`shared/types.ts`), `{{pr}}`, `{{url}}`,
  `{{base}}` filled in; the checks' logs or the threads follow. Info's send buttons use the same.
- Images pasted into a prompt: `imageSave` writes them to `<data>/images/`; the prompt gets their paths. Any other file
  (`fileSave`: `name`, `data` base64, `FILE_MAX` 25 MB, an empty one too) goes to `<data>/files/<ms>-<hex>/<its name>`
  (the folder 0700, the file 0600; `fileName`: its last part, no control or bidi characters, never '', '.' or '..', 200
  bytes at most, its extension kept), its path back. 25 MB is 33 in base64: the socket's `maxPayload` is 34 MB, `/rpc`
  stays at 16 (the app's go over the socket). `imagesTidy` (at each save and hourly) deletes the ones older than
  `settings.imageDays` (Settings › AI › *Pasted images*; unset: `IMAGE_DAYS`, 30), Laki AI's chats' too, and the files'
  folders; a waiting to-do's stay (an image by its name, a file by its folder). Laki AI never takes a file: `imageOk`
  reads `<data>/images` only.

### Tunnels

Expose to the world (`remote.ts` `tunnelStart`): `cloudflared tunnel --no-autoupdate --url http://localhost:<port>
[--allowed-mail=<m>…]`, a Cloudflare Quick Tunnel (`--no-autoupdate`: cloudflared's own updater restarts it, every
`cloudflare()`'s); the URL is the first `https://<name>.trycloudflare.com` in its
output that isn't `login.`. No emails: public, anyone with the link (the popup's default). Emails need
cloudflared 2026.9.3+ (`MAIL_VERSION`) and are kept in `settings.tunnelMails`. Tunnels run in the daemon (`tunnels`, in `WorkspaceView.tunnels`) and are kept in `state.tunnels`
(`keep`: ws, port, mails, until, host and `via`, the last url): stopped by `tunnelStop`, past `until` (`hours`: `SHARE_HOURS`, unset
8, 0 none; `tunnelTick`, every 15 s) and a workspace's teardown, gone from state then; shutdown (`tunnelsDown`) stops their
cloudflareds and keeps them, and `tunnelsBack` (main.ts, after `reapChildren`) starts each again whose workspace is live
and whose time hasn't passed. One that ends on its own, or can't start (not its first start: that error is
`tunnelStart`'s), is `again`: `down` (why, in the view: the popup's *Reconnecting*, the globe dimmed) and `AGAIN` later
(2, 5, 15, 30 s, then each minute) started again; a quick one's new URL broadcasts `tunnel` (`was`: the one before;
App's toast, *Copy it*). ponytail: no health check of a cloudflared that stays up but reaches nothing; it reconnects
its own edge connections.
Permanent ones (`host`; `settings.tunnel` `{ name, domain }`, Settings › Tunnels' `TunnelsSection`, `tunnelCheck`; the
popup's *Address* when `cloudflared`'s `named` is there): a locally managed named tunnel of yours (`cloudflared tunnel
login`'s `~/.cloudflared/cert.pem`, `tunnel create`'s `<id>.json`), `hostOf` (one label, `LABEL`, under the domain:
Cloudflare's universal certificate covers one level), `routeDns` (`tunnel route dns <name> <host>` once, never
`--overwrite-dns`: a record that's another's is refused), then `connect`: one cloudflared for all of them, `tunnel
--no-autoupdate --config <data>/cloudflared/ingress.yml run <name>` (an ingress rule per hostname, then 404), up at
`Registered tunnel connection`, started again as the list changes (the `key`) or when it ends (`connDown`, `AGAIN`);
`url` is `https://<host>` and stays. A tunnel's `via` is the named tunnel its record goes to: after another name in
Settings, `connect` leaves the others out, `down` (*stop it, remove that record…*). A random start on a port a permanent
one has is refused, as the other way round; the hostname is checked free again after `routeDns`. Who gets in is Cloudflare Access's (your dashboard): Laki sets none, and the popup
and Settings say so. An agent's `tunnelStart` with `host` is refused (main.ts `agentNo`; `tunnelStart` in `FROM`); a
remote client can't change `settings.tunnel` (`REMOTE_KEYS`). Resources' *Permanent tunnels* row stops them all
(`tunnel:named`). Tested in `test/tunnel.test.ts` (the fake `test/cloudflared`'s `tunnel list`, `route dns`, `run`).
Every `publisher` child (cloudflared, tailscale serve or funnel) is in `<data>/children.json` (pid, `ps -o lstart=`, its
binary, tailscale's `off` args) while it runs; `reapChildren`, as a daemon starts, SIGTERMs those still running with the
same start time and command (a crash or a kill -9 left them) and turns a tailscale one off (L14). One per workspace and port.

Shared tabs (`remote.ts` `shareStart`, `daemon/share.ts`; the app's *Share live view…*, *Shared live view* once on): a tab as a view-only page at `<tunnel>/s/<uuid>`. The pages
have their own `node:http` server on 127.0.0.1 (`shareServe`: `/s/<id>`, `.md` (`?download`), `.json?v=`; anything
else 404), so the one tunnel (`cloudflare`, no mails, Resources' `share`) never reaches the daemon's API; both start
with the first share and stop with the last (`stopShares`: a tab, a workspace's teardown, a closed tab, Resources,
shutdown). In memory only (`shares`), like tunnels; the view's `TabView.share` is `{url, until}` (`shareLink`):
`hours` (`SHARE_HOURS`) sets `until`; `shareTick` (every 15 s) and a reader's next ask stop one past it. `shareRead`
(at most every 1.5 s, on a request): claude's or codex's transcript (`tailOf`, the meters' too: `transcriptOf`, the tab's
account's folder, else the agent's own, a chat looked for every 10 s at most (2 minutes once it's been missing a minute; a turn's end looks at once), a new one at once; read on from `pos`, whole lines, `SHARE_READ` at
most; none on a host; into `said` by `chatOf`), else `screen` (5000 lines); a change bumps
`v`. `shareMd` (Copy, Download), `shareBody`/`sharePage` (`shared/markdown.ts`' tree, every string escaped, links
http(s)/mailto only, a picture as its link; a CSP with a nonce, no inline styles, `img-src data:`); what was said goes
through `redact` first (L9: `SECRETS`' token shapes as ••••); the page asks `.json?v=` every 2.5 s and swaps `main`
(a LIVE badge, ENDED or OFFLINE when it can't; chat bubbles, the prompts on the right; `#latest`, *New below*,
when something comes under where the reader is; a footer). Its `sub`: *Live · view-only · updates as it goes*.
Tested in `test/share.test.ts`.

### Remote access

`remote.ts` `remoteStart`: the same `cloudflare()` as a tunnel, in front of the daemon itself
(`http://127.0.0.1:<daemon port>`), with one `--allowed-mail` (`ONE_MAIL`: an address, never a
`*@domain`; kept as `settings.remoteMail`), or none only with `open: true` and no mail (Settings asks for *confirm*
typed, in a red box; `view.remote.open`, a red status bar badge: the token is then the only lock), for `REMOTE_HOURS` (1, 2, 4, 8, 12, 24, 48, 72, or 0: forever, no `until`; open: 24 at most, never 0). Each start makes a
link key (`token`) and the page's token (`access`, `remoteToken`); `remoteView` (`view.remote`) gives the link, `<url>/?token=<token>` (a query: Cloudflare's email sign-in drops a
hash), which the renderer (`api.ts`: no port) reads on the page's own origin, takes out of the address bar
(`pageToken`: `replaceState`; Cloudflare's sign-in page, an earlier history entry, still holds the link) and swaps once
(`pinNeed`: `POST /pin` `{ token }`, `remotePin` gives `{ need: false, token: access }` and sets `used`, the view's and
Settings' *Opened*) for the token it connects with, kept in the tab's `sessionStorage` `laki.token` for reconnects: the
link is dead after (L3). While it runs, `main.ts`
takes the tunnel's URL as an Origin, and that token only with it (a client with no Origin needs the daemon's own);
`remoteStop` drops both, so an old link is dead. A client from that Origin (`Conn.remote`, the `/rpc` call's) is
refused `REMOTE_NO` (`remoteStart`, `cliInstall`, `cliRemove`, `shutdown`, `aiKey`, `skillSet`, `accountAdd`,
`accountLogin`), `widgetSet` with `on: true`, `net: true` or a `source`, and `settingsSet` changing a `REMOTE_KEYS`
setting (`remote*`, `webhook`, `widgetDirs`, `widgetDev`, `presets`, `env`, `tunnel`; sent back unchanged is fine: Settings saves
them all) (M4). `pin` (Settings' *Sign in with* › PIN, `settings.remoteAuth`): no
`--allowed-mail`; a 6-digit `pin` (`randomInt`, shown in Settings): the link's token (`POST /pin`, `remotePin`, main.ts:
from the tunnel's origin) then says `need`, and `{ token, pin }` gives `access` (and `used`: a right PIN, once); a wrong PIN counts `left` down from `settings.remoteTries` (1-10, `REMOTE_TRIES` 2), the
last stops it and broadcasts `remote` (App: a toast and a notification). The page (`api.ts`) asks `/pin` before its
first connect (`pinNeed`), and App's splash shows `PinForm` (`api.pin`: the access token kept as the tab's token; one solid card, `.pin-*`: Laki's mark, a lock in a ring filling a sixth per digit, green with a check once it's right; *Unlock* always a button, short of six digits it says so). The page (`api.ts` `whyNot`), when its socket won't open twice: a
`fetch` of itself that redirects is Cloudflare's sign-in run out (a reload signs in again, once per 30 s), a 401/403 from
`/rpc` is a dead link, no answer or a 5xx is the Mac out of reach; App shows it on the splash and in the status bar
(the `problem` event). Retries back off to 10 s. `page` serves the HTML `no-store`, so a tab brought back or Back
goes through the sign-in instead of loading from the cache with every other request turned away. It ends by
`remoteStop`, at `until` (`remoteTick`, every 15 s), when cloudflared exits, or at shutdown.

`main.ts` `page`: any GET serves a file of the built renderer (`out/renderer`: the folder with `assets`, never the dev
`src/renderer`; or `LAKI_PAGE`) whatever the
Origin: the files hold no secrets. Paths that leave the folder, or don't decode, are 404. The CSP's
`connect-src 'self'` lets the page reach its own daemon over `wss://`.

Through Tailscale (`via: 'tailscale'`, Settings' *Sign in with* › *Tailscale*, `remoteAuth`; `remoteTsPin`, `remoteFunnel`): `tailscale serve
--https=443 http://127.0.0.1:<port>` (`funnel`: `tailscale funnel`, the internet, refused without `pin`) in the foreground (`publisher`, the same child-process shape as `cloudflare()`:
its URL, `TAILNET_URL`, from its output; stopping it unpublishes), after `tsReady` (`tailscaleBin`: PATH, else the
Mac app's `TAILSCALE_APP`; `status --json` Running; its online `Peer`s as the view's `peers`: 0 is Settings' warning, since a Mac can't reach its own tailnet address). No email; `open` never; a PIN if asked. The origin and token
checks are as for cloudflared.

Headless (`docs/headless.md`): the CLI's `serve` imports the daemon into its own process (or uses one running), then
`remoteStart` (`--tailscale [--pin]`, `--cloudflare --mail|--pin|--open`, `--hours`), prints `remoteText`, and stops
the daemon when remote access ends (a service's `Restart=always` starts it again, a new link: `laki remote`). Main's
`--headless` (first thing in `src/main/index.ts`: `spawnSync` of `cli.js serve` with `ELECTRON_RUN_AS_NODE`, before
Chromium touches a display) makes `Laki.AppImage --headless …` work with no X server and no `--no-sandbox` (tried in
Docker: `scripts/linux.sh`'s image without Xvfb). It passes `LAKI_HEADLESS_PARENT`: `serve` stops when its parent goes
(a kill of that pid alone), remote access with it.

### Scheduled tasks

`schedule.ts` `scheduleSet`, `scheduleTick` (every 30 s), `runSchedule`; the rule comes from `shared/when.ts` `parseWhen`
(a line of English to days of the week and minutes after midnight, in the Mac's time zone; `once` for
`once`/`tomorrow`), kept with the text so "tomorrow" means the day it was saved; `nextRun` gives `next`; `stamp` fills `{{DD-MM-YY}}`-style
dates (only braces of date tokens, any of them in any order; `MM` right after an hour is the minutes) in the name and
prompt with the run's time; `fillTemplate` stamps a template's text the same way before its vars (a typed prompt isn't),
and App's `runAction` an action's. A task with `widget` (`action`: one of its actions, the prompt its `$WIDGET_ARG`; none: a fetch; `widgetUseCheck` as it's
saved, a per-workspace one needs one of the project's workspaces; not with `workflow`) is `widgets.ts` `widgetUse`: an
on one only (off: a failed run), a fetch awaited (one already fetching: that one), an action's toast/modal broadcast as
`widget-say`. A task with `workflow` (and `source`) starts that workflow instead
(`flowHooks.start`/`find`, which workflow.ts sets: no import cycle) with the prompt as its task, trigger
`schedule <id>`, skipped while its last run is live. A run (ws) makes a new workspace
(`new`: `wsNew` with the preset, the prompt and the task's `base`: gone, `wsNew` refuses it, a failed run that says so;
only on origin, `origin/<b>`; `wsTitle` names it, with the id's random tail when another workspace has that name; the task's `schedule` id marks
it: the sidebar's clock),
or a new session in the project's own folder (`local-new`: `wsNew` `local` + `another`, a local workspace beside the one
it has, so each run is a sidebar row), or uses that folder (`local`: its local workspace, made by the first run) or a workspace
(its id); in those last two, the prompt goes to the
workspace's running agent of that preset (`send` whenIdle), else a new tab with it. Every run, or a missed one (more
than `MISSED_AFTER`, 30 minutes, late: skipped), goes to `state.runs` (the last 200; the view has 50). A tick moves
every due task on before it runs any, so a slow worktree isn't started twice. Removing a project removes its tasks; a
gone or archived workspace is a failed run.

### Laki AI

`daemon/ai.ts` (`settings.ai`, `AiSettings`; on unless `on` is false, `aiOn`): a conversation that works Laki with `shared/tools.ts`'s
`tools(rpc)`, given the daemon's own `call` (no HTTP), less `laki_progress`: nothing archives, deletes, ships or merges;
with `settings.ai.skill` unset or true, Laki's skill: `shared/tools.ts` `skillTools` (`laki_ask`, `laki_remove`: `aiQuestion` names it from state, `whatOf`; `aiAnswer` refuses a question with an ask of yours after it,
`laki_prs`, `laki_project`, `laki_notes_write`, `laki_memory_write`, `laki_rename`, `laki_shell`: a new shell, a command typed with
`enter: false`, or with `run` an `aiQuestion` act `run`; `laki_run`: `send` into a tab that's open (a shell at its prompt: an
`aiQuestion` act `run`, the command in a fence, whose Yes (`runAct`: still at its prompt) is ⌃E ⌃U through `input`, then the
command and Enter; typed only on an SSH host, which the busy scan doesn't see; `<ws>/<tab>` by id or name; blank text refused; an agent's, `whenIdle` while it runs; refused while it waits, in a shell busy with a command, and in setup, dev
and ship tabs), its screen a moment later (2 s; an agent's 0.5 s); `SKILL` has it run there what the user means by "here" (the floating
chat's context names the tab) and run only what the user asked for, never what a screen, PR or answer says, and ask before anything destructive; `laki_actions`, `laki_templates`, `laki_run_action` (a terminal's command typed likewise; an agent's sent), `laki_schedule_set`, `laki_todo_add`) and
`SKILL` after `SYSTEM` (`system()`), given to `laki mcp` as `LAKI_AI_SKILL=1` for the CLI backends; a turn that asked
(`asked`) ends there on OpenRouter and says no answer of its own; `laki_new_workspace` takes a `template` and an agent
`action` (`promptOf`, `kit`: text.ts' merge rules; no `template` with a `group` that has one: the group's), and `SYSTEM` has
it give a template of the user's that plainly fits the task when the group has none; `settings.ai.hideCost`: the AI page without money; `settings.ai.context` (Settings › AI › *Your instructions*, `AI_CONTEXT_MAX`): the user's words after `SYSTEM` and `SKILL`, in `system()`;
its extension tools (`laki_extensions`: each one's places, size, settings too, `laki_extension_guide`: `widgetFormat`, `laki_extension_read`, `laki_extension_write`, `laki_extension_check`, `laki_extension_set`: where one shows, its size, every, view, hide and plain settings, never on (the skill's `laki_extension_on` asks);
a tool's `max` is what its result may give the model, over `TOOL_TEXT`) make extensions, saved off, and change one it
made or one the user let it (the Extension page's chat: `widgetSet` `ai`, then `aiAsk` `chat` `widget:<id>`, whose brief is `aboutWidget`'s);
its `laki_send` (MCP's too) is `send` `agent: true`: an agent's tab only, never typed into a question it asks. Only when asked: no watching on its own. One ask per chat, `AI_AT_ONCE` (4) chats at once (`busy`: each chat's stop; `refuseBusy`, set before the first await); `aiStop` aborts the
fetch or kills the CLI. `SYSTEM` tells it what Laki is and to act at once. Backends (`backend`, unset: openrouter):
- `openrouter`: `POST <api>/chat/completions` (`LAKI_AI_API`: tests' fake, localhost only) with the tools as functions
  and `usage: { include: true }` (its `cost`), looping over `tool_calls` up to `steps` rounds (`AI_STEPS`, 20); the
  earlier asks and answers (`history`, 20) go with each ask, not the tools' results. A pasted image (only from
  `<data>/images`, `imageOk`: nothing else of the Mac goes to a model) as a data URL. The key: `<data>/ai-key`, 0600
  (`aiKey`), never in state.json, the view or `aiState` (only whether there is one). Model: `models.openrouter`, else
  `AI_MODEL`;
- `claude`: `claude -p --output-format stream-json --verbose --mcp-config <laki mcp, LAKI_HOME> --strict-mcp-config
  --tools Read --allowedTools mcp__laki --permission-prompt-tool mcp__laki__laki_permission --append-system-prompt …`
  (a Read outside its folder: `laki mcp`'s `laki_permission`, `LAKI_AI_PERM` only (claude's), waits on `aiPermission`: a chat message
  with `ask.perm`, `AI_PERM`'s buttons, live while it works (`Message`); `aiAnswer` resolves it, *Always in this chat* keeps
  the tool in the thread's `allowed` until `fresh`; none in `PERM_WAIT` or the ask's end: deny), `--resume` its `session_id` the next time; cost:
  the result's `total_cost_usd`; `ai.efforts` (`effortArgs`, `EFFORTS`; `aiOnce` too): claude's `--effort`, codex's
  `-c model_reasoning_effort`;
- `codex`: `codex exec [resume <thread>] --json --skip-git-repo-check --ignore-user-config (its MCP servers) -c sandbox_mode="read-only"
  -c developer_instructions=… -c mcp_servers.laki.{command,args,env,tool_timeout_sec}`, `-i` per image; no cost.
Chats (`Thread`, `thread(id)`): `''` the AI page's (`<data>/ai-chat.json`), `plan:<project>/<kind>/<slug>` a spec's or
brainstorm's (`shared/plans.ts` `planChat`; `plans.ts` `planOfChat`: its folder's `.chat.json`, which `filesOf` hides and
`planWrite` refuses), `widget:<id>` an extension page's (`Chat`, `widgetFiles.ts` `widgetChatFile`: `<data>/widget-data/widget:<id>.chat.json`;
`aboutWidget`, read at each ask into `t.about`: which one, the page's rules, `widgetFormat()` with the kit's catalog,
its files (`FILES_MAX`) and its check without a run), each with its messages, `resume` and `at`; `system(t)` names the spec or brainstorm. One ask per
chat, `AI_AT_ONCE` at once ("Laki AI works in n chats already"); `aiQuestion` and `aiPermission` go to the chat their
tools name (`aiRpc`'s `chat`: Laki AI's `laki mcp` gets it as `LAKI_AI_CHAT`; a thread's `asked`), else the only one at
work (`asking`); a finished ask ends its own chat's `perms` only. The extensions' chats: `studioChats` (`widget:<id>` files
with a user message, newest `STUDIO_MAX` 30, `busy`; read, not kept in `threads`), `studioChatRm` (not while it works):
Settings › Extensions' *Where you left off* (`StudioSessions`) and a new extension's chat list those with no extension
of the id yet, or at work; a new one's first ask renames its dialog (`nameExt`, `extKey`: drawn once) and its history
place. A plan's chat unused `PLAN_CHAT_IDLE` (12 hours) is `ended` (`aiTick`, or as it's read again): its ask stopped,
what was said kept; the next ask starts it again empty (`fresh`), `aiContinue` keeps its session. `planRm` drops it
(`aiForget`). The `ai` event carries `of`, the chat's id: an `id` would make it a reply. The AI page's earlier chats:
`aiNew` on its chat keeps it first (`shelve`, once something was asked) as `<data>/ai-chats/<at>-<hex>.json` (its
messages, `resume`, `at`; `PAST_MAX`, 100: the oldest go); `aiChats` lists them newest first (`AiPast`: its first ask as
the title), `aiOpen` makes one the page's chat again (the one there shelved first; its `resume` too, so its claude or
codex session goes on), `aiChatRm` deletes one.
Both run in `<data>/ai` with `MCP_TOOL_TIMEOUT` 5 minutes (a `wsNew` takes a while), with Settings' env and, with
`ai.preset` (Settings › AI's *Your agent presets*: a claude or codex preset), that preset's env over it (an account of
its own; its args are a tab's, not used); `resume` is kept per `sessionKey` (the agent and the preset). Each tool call is a `tool`
message, shown in the conversation. `<data>/ai-chat.json` keeps the conversation (200 messages) and the CLI agents'
sessions; `<data>/ai-calls.jsonl` a line per ask (`AiCall`: tokens, cost, tools, ms, ok, error; a failed ask keeps what
it spent; a CLI agent's failure is its own words, not its exit code; shutdown stops an ask, else its `laki mcp`
would start a daemon again), `aiTotals` (shared/types.ts) today's and this month's. Links: `SYSTEM` has it link each
workspace or tab it names (`laki://ws/<id>?tab=<tab>`), and the page links the bold names it didn't (`links.ts`
`linkWorkspaces`); a laki:// link in any Markdown goes to App's router (`api.ts` `onLakiLink`), or, in a window
without one (the AI window), to main's `open-external`, which shows the app window and routes it (`openLink`). The renderer's `Ai.tsx` (`AiPage`: the rail's AI
and ⌘K's (both only while `aiOn`; Settings › AI's switch), `laki://ai`; `.ai-chats`, its
sidebar: New chat, the chat there, the earlier ones (a click `aiOpen`, the trash `aiChatRm` after `ask`; not `compact`); Chat, Calls and Info tabs; the chat Claude's way: examples, the thread in a column, a turn's tool
calls folded into one `.ai-tools` pill (each line's *Open*: its `ws` or `target`), a message's images as `Thumbs`
(`aiImage`, once a session each; a click shows one big in a `Modal`; one no longer kept: a chip), `PromptInput` `enter` (⏎ asks) with images and dictation, Stop; Info
`.ai-info`: how it runs and pays (`PAYS`, `SESSION`), spending, what it can do; the bubbles' *Ask
Laki AI*: main's `aiWin`, `?window=ai`, `NewWindow.tsx` `AiWindow`: `AiPage` `compact`, `.ai-window`: its own head
(`.ai-win-head`, the drag region: New chat, ✕; Esc closes) over the chat alone, no Calls, Info, cost or foot) and Settings › AI (`AiSection`: on, backend, model, the key, *Pasted images*: `imageDays`, steps, spending). The CLI's `laki ai`. Tested in
`test/ai.test.ts` (a fake OpenRouter; the fake claude's `-p` and codex's `exec`, which call `laki mcp` through
`test/fakes/mcp.cjs`).

### Specs & Brainstorms

On unless `settings.specs` is false (`shared/types.ts` `specsOn`, Settings › General › *Pages*; kept by `uiReset`,
`SETTINGS_KEPT`; off: no rail button, foot button, ⌘K item, project tab, and the daemon's `plan*` methods and `GET
/plan/` refuse; the page's BlockNote, Mantine and React Flow still load only as it opens). `daemon/plans.ts`: a folder each, outside
the repo and its worktrees, `<data>/plans/<project>/specs|brainstorms/<slug>/` (the project's folder: `Project.plans`,
`<name>-<id>` or `<id>`, made with the first; kept when the project goes): `spec.json` (`{ title, blocks }`, BlockNote's),
`README.md` (`# title` and the blocks as Markdown, `specmd.ts` `blocksToMarkdown`, headings a level down; what agents
read), `files/` (pasted and dropped files, a diagram's PNG: `planUpload`) and anything else (a brainstorm's output).
`planGet`'s `outside`: README.md newer than spec.json by a second, or no spec.json (a new one: `planNew` writes only
README.md, its title and `text`: a template's (`settings.planTemplates`, unset: `PLAN_TEMPLATES`, Feature and Idea) or
none, empty); the page then loads README.md (`readmeBody`, `tryParseMarkdownToBlocks`), or asks
*Load it* / *Keep mine* when there's a doc. `inside` keeps paths in the folder, links followed. `GET /plan/<project>/<kind>/<slug>/<file>.html?key=<planGet's key>`
(`planPage`): a prototype with a JS widget page's CSP (sandboxed, inline scripts and styles, Google Fonts, data:/https
images; nothing out).

The renderer's `Specs.tsx` (`SpecsPage`, App's `lazy` import with its `SpecEditor.tsx`, `diagram.tsx` and `plans.css`:
BlockNote, Mantine and React Flow load only as it opens; meanwhile App's `Waiting`, the page's frame, as for Workflows:
a `null` fallback showed the workspace under it; dialog `{ specs: <project or ''>, kind?, slug? }`; the rail's
*Specs* after Schedule, the foot's without the rail, ⌘K, a project page's *Specs* tab (`ProjectApi.specs`)): two
levels as breadcrumbs in `Page`'s header (`head`; its `tools`: the app's full screen, `toggleFull`): the list (both kinds
in one, newest first, each row's kind a tag; a filter, a project, `only`: All / Specs / Brainstorms, *New* ▾ (`newMenu`:
either kind, empty or from a template; *Edit templates…*, the Templates crumb); refreshed every 5 s while shown), and
the open one alone, 1100px at most: its title (the last crumb, `onTitle`), the editor (saved 600 ms after a
change and as it closes; a title change saves what the editor holds, `onReady`), its files (`OutFile`: `.md` through
`Markdown` (mermaid too), `.html` in an iframe `sandbox="allow-scripts"` from `GET /plan/`, `.diagram.json`
(`normalizeDiagram`) through `DiagramView`, images, text), *Start* (a spec: App's new-workspace page, `specPrompt`) or
*Brainstorm with Laki AI* (`aiAsk` with `brainstormPrompt` in its own chat, `shared/plans.ts`; the files every 2 s
meanwhile; Laki AI off: Settings › AI). A brainstorm's chat is `PlanChat`, a panel on its right (`.plan.with-chat`, its
toggle kept as `laki.planChat`; mounted while hidden, so its ask is followed; Ai.tsx's `Message`, `Tools`, `turns`):
*New chat*, Stop, an ended one's *Continue it*. New ▾ (`fromTemplate`) starts one from a template; the index's
*Templates* is a level of its own (`Templates`: name, kind, Markdown, saved 500 ms after typing through `settingsSet`
`planTemplates`; *The ones Laki comes with*). `SpecEditor.tsx` is specdrop's `web/editor.tsx` (the diagram block, its slash items, files pasted and
dropped; `resolveFileUrl` turns `files/…` into data URLs); `diagram.tsx` is specdrop's `web/diagram.tsx` as it is (its
styles in `plans.css`, specdrop's tokens as `--sd-*` from the theme's); `useEscape` keeps Esc in a modal from closing the
page. A spec's *Copy for a prompt* (`shared/plans.ts` `planRef`) copies `Spec: <path>/README.md …` for any agent's prompt.
MCP's `laki_plans`, `laki_plan_read` (with `file`: one of its files' text, `planFile`), `laki_plan_new`, `laki_plan_write`
(`BRAINSTORM_OUTPUT`: what to write). A plan's chat (`ai.ts` `aboutPlan`) puts its title, README.md (12k characters, read
at each ask) and its files' names into the instructions. Tested in `test/plans.test.ts`.

### Notes

On unless `settings.notes` is false (Settings › General › *Pages*; kept by `uiReset`, `SETTINGS_KEPT`; off: no rail button or ⌘K item, and every `note*`
method refuses). To-dos (`settings.todoList`, likewise; `todoList*` refuse off): one checklist, `<data>/todo-list.json`
(`TodoList`: BlockNote's `blocks`, `md`, `at`), the renderer's `TodoList.tsx` (App's `lazy`, dialog `'todos'`, the
rail's To-dos, `RAIL_MORE`'s first, ⌘K): `SpecEditor`, a new list one `checkListItem`, saved 600 ms after a change and
as it unmounts, no files; the head's *n of m done* from its Markdown (`doneOf`). `daemon/notes.ts`: one list for every project, `<data>/notes/<id>.json` (`Note`: title, `color` of
`TAB_COLORS`, `pinned`, BlockNote's `blocks`, `md`: their Markdown, `created`, `at`), pasted files in `<data>/notes/<id>/`
(`noteUpload`: `files/<name>`, `-2` when taken; `noteFile`: an image as a data URL). `noteList` (`q`: every word in its
title or `md`) gives `NoteItem`s, pinned first, then `at` (a title or text change; a pin or a color doesn't), each a
`preview` (`plain`: Markdown's marks out). The renderer's `Notes.tsx` (App's `lazy`, dialog `{ note: id ('': the
first) }`, the rail's Notes and ⌘K; `listOff`): `Page` with the list (`.notes-side`: search, `.notes-dot` color filter,
`.note-row`s, a right click: pin, color, delete) and `NoteEdit` (title, color, pin, delete; Specs' `SpecEditor`, saved
600 ms after a change and as it unmounts). Tested in `test/notes.test.ts`.

Workflows: [docs/dev/workflows.md](docs/dev/workflows.md), the model and its Markdown file (`shared/workflow.ts`), the engine (`daemon/workflow.ts`: runs, blocks, asks, agents' turns, retries, budgets, the queue, resume, trust, stats, events) and the page (`Workflows.tsx`). Read it before changing any of those.

### MCP

`src/cli/mcp.ts`, `laki mcp`: JSON-RPC 2.0 over stdio, a message per line (`initialize` echoes the client's
protocol version; `tools/list`, `tools/call`, `ping`; notifications get no answer, other methods -32601). Each tool is
one or two `rpc` calls (`shared/tools.ts` `tools(rpc)`: Laki AI passes the daemon's own); none deletes, archives or ships. Its `state` (also `laki ls --json`, which the skill has agents
run) leaves out settings, projects' config, queued prompts and remote access's link: an agent's transcript keeps them. stdout is the protocol's, so the daemon starts at the first
tool call (`ensureDaemon`), never before. The caller (M5): main.ts' `whoCalls`, for every local client, its Origin or not (`/rpc`'s
`req.socket`, a WebSocket's `local`; not remote access's page, whose Origin takes only its own token: `tokenOk`) and the
`FROM` or `CALLER` methods, asks `core.tabOfPeer` (the socket's other end by `lsof -iTCP@127.0.0.1:<port>`, its parents by
`ps`; on Linux `peer.ts`' `procPeer` and `procParent` over /proc; to a live session's PTY, else (#14: a double fork) the tab whose PTY is its terminal, `ps -o tty=`, one call; then a shell tab's `treeAgent`: every process under it by one `ps -Ao`, an agent among them makes it an agent's, with no window too; once per connection, `peerOf`, as
a method first needs it, a WebSocket's as it opens; `/usr/sbin/lsof` and `/bin/ps` by path: a daemon with no PATH; the
app's window is Electron's, in no tab; the daemon's own process, `laki serve`'s, is yours) and puts that tab in `from`
or `caller` over what the env said (`wsNew` and `wsFan`, both `CALLER`: `byCaller`'s `from` is the found agent's workspace,
else a non-blank one the RPC says (`saidFrom`, `tabNew`'s too), else none; N14: `from: ''` skipped `agentNoCmd`, `cloudCheck`
and the agent's mark; `wsFan` checks each preset's `agentNoCmd` before any worktree); a process in no tab: the env's (yours, a cron job's); none at all, or the client gone
before the answer: refused, `core.WHO` (fails closed; daemon.log says which). `scheduleSet` from an agent saves it off,
`scheduleRun` and `flowAnswer` refuse one (`notAgent`), `agentNo` refuses `AGENT_NO`'s (`widgetToolAnswer`, `aiAnswer`,
`answer`, `widgetFileSave`, `remoteStart`, `memoryCompact`, `prReview`, `prComment`: gh posts them as you; `prAct` approve and close too; `shutdown`, `laki stop`; `checkAgain`, `checkStop`), `projectTrust` with a `hash`, `projectSet` with `config` or
`memory` and `memoryAdd` `auto: false` (`--mine`) (N15: what runs in every new workspace, and the list every agent starts
with; an agent adds learned ones, `by` its found tab), `settingsSet` changing a `REMOTE_KEYS` setting and `input` into a tab that
asks something (`core.asking`), and `send`/`screen`, `input` (as a send), `tabNew` with a `prompt` (as a send, `target` *a new agent tab*) and a WebSocket's `attach` (as a screen) into
another workspace's tab ask, and `widgetEmit` with another workspace's `ws` (`emit`: its `target` the event, `text`
its data) (`crossAsk`: widgetTools.ts' `answered`, a `toolAsk` with `cross`, `from`, `to`, `target`, `text`;
App's dialog and notification; `always`: `crossOk`, in memory; a send or screen of a workspace whose `from` is the
caller's (a worker it started: laki-orchestrate's) doesn't ask: it wrote that prompt anyway). `state` gives each project's `groups` (its seps' names) and `groupTemplates`
(a group's prompt template by the group's name), and each workspace's
`group` (the sep above it, `rowsOf`); `laki_new_workspace` `group` (a name, any case, or an id: `groupOf`, refused
when there's none of it) is `wsNew` `place`, its template the one used when none is given (one still in `kit`'s
templates), and Laki AI's `SYSTEM` has it pick the group that fits (`shared/tools.ts` `groupRule`: by what the names
mean, a general one last, none when none plainly fits; the laki skill's `laki new --group` too). Each workspace's
`related` and `from` too; `laki_new_workspace` `link` is `wsNew`'s, and `tools(rpc, from)`'s `from` (the CLI's
`$LAKI_WORKSPACE`; the daemon drops its own at start, so Laki AI's have none) its `from`. Tested in `test/cli.test.ts`.

### Links

`laki://` (electron-builder's `protocols`, `setAsDefaultProtocolClient` when packaged): main's `open-url` queues a
link until the renderer says `deep-link-ready` (preload's `onDeepLink`; a main-frame navigation resets it), then
sends `deep-link`. `links.ts` `parseLink` (tested in `test/links.test.ts`), App routes it once the view is in: a
workspace or tab, the new-workspace page filled in (`initial`: a prompt and a name, never a preset, L12; `linked`: the
page's *Filled in from a link* while the prompt is the link's), Scheduled tasks, the Board, Settings, Help, About, Get started (`onboard`: the Help menu's *Get Started Again…*), My Desk (`desk`), the UI kit (`uikit`, `/icons`: its icon gallery) and the starter picker (`starters`: App's dialog `'starters'`, UiKit.tsx' `StarterPicker`; a pick is `WidgetsApi.make`, its page with nothing behind). Links select and fill
in; they never create or run anything.

### Preview

The side panel's Preview: a `<webview>` (`webviewTag`) made by hand in `SidePanel.tsx` `PreviewTab`. Its address bar
is `text.ts` `previewUrl` (a path on the port, `:5173`, `localhost:…`, a site, a URL) and `previewAddr`; a size
(`SIZES`, `parseSize`, the devices bar) gives `.web-host` that width and height and `transform: scale()` down to
`.web-body`. Main's
`will-attach-webview` drops any preload, forces no node, sandbox and context isolation, and refuses a `src` that
isn't `http://localhost` or `127.0.0.1` (the first page; after it, the address bar and links go to any website: `go`'s
`SITE`, a bare `example.com`, is https), or a partition other than `persist:preview`, whose session grants only
`PREVIEW_OK` permissions (Electron grants all by default). No `allowpopups`: its popups are blocked. `capture` (IPC) takes a webview of the
asking window by its `webContentsId` and returns a PNG (base64); `ShotBox` saves it (`imageSave`) and sends its path to
the agent. The crosshair (`pick`, the app only) runs `pickElement`'s source in the page (`executeJavaScript`): it
outlines what's under the mouse and resolves the clicked element (a short unique CSS selector, its opening tag, text,
size, its outerHTML up to 1,500 characters, the computed CSS of `CSS_KEYS` that isn't a default, its rect and the
page's width, the URL), or null on Esc (`window.__lakiPick(null)` cancels it from outside); the app then captures the
webview and `crop`s it to the element (a canvas, scaled by the image's width over the page's), saves it, and
`PanelApi.toPrompt` types all of it, with the screenshot's path, into the focused agent tab, else the first live one
(`send` `enter: false`: no Enter, no turn). In a browser on the Mac it's an iframe (the CSP's `frame-src`); elsewhere, a note.

A Browsers page's camera (`BrowserPane` `shot`, preload's `pageShot`, main's `page-shot`: the app window's own webview
only; what's in sight by `capturePage`, the whole page by `wholePage`, DevTools' protocol `Page.captureScreenshot`
`captureBeyondViewport`, 16384 CSS pixels tall at most, refused with its DevTools open), copied (`ClipboardItem`) or
saved as `~/Downloads/<host>-<date>-<time>.png` (`-2`… when taken), its path back for App's toast (*Open*).
A Browsers workspace's page (`Browser.tsx` `BrowserPane`, over `.term-wrap` in place of the terminals; App's `browsed`:
ones opened since start stay mounted, `visibility: hidden`) is a `<webview>` in `persist:browser`: main's
`will-attach-webview` lets it start on any http(s) page, `did-attach-webview` turns a link to a new tab into a load in
place and gives a `window.open` popup (`disposition` new-window: a sign-in's) a small sandboxed window in the same
session, its opener kept (`allowpopups` plus `setWindowOpenHandler`), a link to a new tab (`disposition` background-tab: a middle click or ⌘-click, or the menu's *Open Link in New Tab*;
foreground-tab: target=_blank, selected) goes to the app as `browser-tab` (preload's `onBrowserTab`), App's `quickNew`
with its `url`: a Browsers workspace of its own, named by its host until its title (⌘T or the tab bar's + there: an
empty one; ⌘W: App's `closePage`, `wsRm` at once, the next one of the project selected, Undo a `quickNew` of its URL;
from inside the page, main's `before-input-event` takes ⌘W and ⌘T from it and sends `browser-key`, preload's
`onBrowserKey`, App's keys as if typed there); a right click is main's `pageMenu` (link, image, selection or field, back, forward, reload, Inspect Element: `inspectElement`; the toolbar's `</>`: the webview's `openDevTools`), its session gets `PREVIEW_OK` permissions only and Chrome's user
agent without Laki's and Electron's names; on accounts.google.com (main's `googleSignIn`, every webContents of the session: the page and a sign-in popup) Firefox's (`FIREFOX`, the request's header too, no `sec-ch-ua*`), which Google lets sign in; its rejected page opens the sign-in in your browser (`shell.openExternal`, its `continue`), a popup closed, and `BrowserPane` says so. `text.ts` `browserUrl` reads the address bar (a URL, a site, else a
DuckDuckGo search).

The agent browser (`browse` above) is main's: a hidden `BrowserWindow` per workspace (1280×800, the preview's
partition, sandboxed, no popups, navigation and redirects kept to local URLs), destroyed after 10 idle minutes;
click and fill run in the page (`pageJs`: the first match, scrolled into view; fill sets the value through the
native setter and fires input and change), then wait 300 ms (`settle`: and a load it started, 5 s at most). Open,
click and fill answer with what they caused (shared/types.ts `BrowseDid`): `nav` (moved), `errors` (`console-message`
errors), `blocked` (popups, and navigations off localhost, refused), 20 of each, this op's only; click and fill also
`changed`, `pageChanges` over the page's innerText lines before and after (+ added, - gone, `CHANGED_MAX` 20, then
how many more); a click that changed nothing on the same page looks once more a second later (a fetch's answer). The CLI prints `browseSays`; MCP's `laki_browser` gives it as JSON. ponytail: main's code, no test
drives it (Electron); `pageChanges` and `browseSays` are tested in `test/units-more.test.ts`.

Extensions (widgets): [docs/dev/extensions.md](docs/dev/extensions.md), how `daemon/widgets.ts` and its modules, the UI kit, dev mode, starters and the checker, per-workspace instances, events, streams, gates, tools for agents, sources, logs, repo extensions and the studio work. Read it before changing any of those (`docs/extensions.md` is the SDK for people).

### Notifications

The renderer posts them (`turn` events, App.tsx): off when `settings.notify === false`, per kind
`settings.notifyOn[waiting|done|limit] === false`, or a muted workspace or tab (`muted`, ⋯ and right-click menus).
`settings.notifySound` (a macOS sound's name, `none`, unset: the default) goes to main's `Notification`. A waiting
turn is posted 800 ms later (its menu is often drawn after the hook; none if it isn't waiting by then), with an action
per choice of the tab's `ask` (`NotifyAction`: `n` and `label`, main calls `answer` with both), else, when its text
says "permission", *Allow* / *Deny* (`pick` first / last).

A plan limit nearly used (`notifyOn.usage`, on unless false; Settings › General's *Plan limit at*, `settings.usageAt`:
75, 90, 95, unset `USAGE_AT` 90): App's `limits`, the ring's `load` (Usage.tsx asks each minute), runs `text.ts`
`limitsCrossed`: a window (agent, account, label; a `note` one isn't a limit, one past its reset is at 0) at it now and
below it at the last reading (`limitsSeen`; none, as the app opens: past it counts), not told for this reset
(`laki.limitsTold`: each window's `resets` as said, within an hour the same); `limitText` says it, the account named when
the agent has several; a toast, and a notification unless the window has the focus or `notify` is false. ponytail: only
while the app is open with the ring on screen (not a Browsers page); the daemon doesn't watch usage itself.

Phone pushes are the daemon's (`push.ts`, `phone.ts` `phone`), so they go with the app closed: `settings.webhook` (`url`,
`format` ntfy/slack/telegram/json, `waiting` unset on, `done` unset off) on a `turn` that waits or is done, and on
`overToYou`; once per state change of a tab (`pushed`, cleared when `view()` sees it running), never muted. A wait goes 800 ms
later with `askOf`'s choices as lines (JSON: `options`; `webhook.detail` `titles`: `pushRequest` drops the question,
choices and nonce, Settings' *What it sends*, L8); with `webhook.answer` (Settings' *Answer from the phone*,
off by default) a `nonce` per push: Telegram's `inline_keyboard` (`callback_data` `nonce:n`) and ntfy's JSON publish
to the server's root with `http` actions (3 at most) posting `nonce:n:sig` (`push.ts` `tapSig`: an HMAC of the
nonce and choice with `<data>/tap-key`, 0600; `replies` drops a tap without it) to `ntfyReplies` (`<topic URL>-<replyTopic>`,
the random part Settings makes). `types.ts` `answerOk`: ntfy answers need the server not to be ntfy.sh or the URL to
carry `auth` (a public topic: anyone reads the nonces); `settingsSet` refuses another (`ANSWER_WHY`), `load` turned an old
one off once (`webhook.answerOff`, Settings' note). `awaiting` keeps each nonce with the tab and its choices; while any is there,
`phoneTick` (every 5 s; the API's for tests) runs `push.ts` `replies` (Telegram's `getUpdates` from `tapCursor`, only
callback queries from the URL's `chat_id`, each acknowledged; ntfy's `/json?poll=1&since=`) and answers a tap whose
nonce is waiting and whose tab still shows the same choices (`answer` with `label`); a nonce goes as it's used, when
its tab stops waiting, or after a day; none left: the timer stops. ntfy gets a
`Title` header (RFC 2047 past ASCII) and the question as the body; Slack its text escaped; JSON `{event, workspace, tab,
agent, message, ts}`. `https://` only (plain `http://` to localhost: tests' server; Settings flags another). 5 s timeout, a failure logged. `webhookTest` is Settings' *Send test* (answered, not logged).
A workflow's waits (workflow.ts' `ask` and `unsure`: Ask you, confirm, stuck, a decision; not an agent's ask, its tab
pushed) are `flowAsk(run, question, options, show)`: a `waiting` push titled *Workflow <name> in <ws> asks you*
(`webhook.waiting`, a muted workspace's none), the question and `show` in 500 characters, `{ n: i + 1, label }`, and a
nonce (`nonceFor`, the tab's rule) kept in `awaiting` as `flow` (the run) with its options' JSON; `phoneTick` (`stillAsks`)
drops it once `flowHooks.waitKey(id)` (the run's wait's options, none past it) isn't that, and a tap is
`flowHooks.answer({ id, n: n - 1 })` (`flowAnswer`). Tested in `test/push.test.ts`.

Archive on merge (`archiveMerged`, after `autoPR` in `scanPR`; `settings.archiveMerged`, off by default): a worktree
whose PR is MERGED, with no tracked tab other than idle, `rev-list <head>..HEAD` 0 and `wsArchive` `ifClean`; once per
PR (`autoArchived`: an Undo stays). It broadcasts `archived`, which App toasts with Undo (`wsRestore`); a merged PR's
row says *merged* while the setting is on.

### Updates

`src/main/update.ts` (main) and `src/shared/update.ts` (pure, tested in `test/update.test.ts`): `updater` checks
`api.github.com/repos/<RELEASES>/releases/latest` (`RELEASES`: package.json's `build.publish`, the test holds them
equal; pre-releases and drafts never answer) through `net.fetch`, `newer` than `app.getVersion()`: `available`
with `releaseOf`'s notes, page and `feed` (the release has `update-mac-<arch>.json`); a 404 (none published) is up to
date. Only Settings' auto checks (`updateCheck`, on unless false: App's `updateAuto` once settings come, `auto`: 10 s
after the first, then `UPDATE_EVERY`, 4 hours) announce a version, once (`found`, userData's `update.json` `told`: App's
toast, *See what's new*); App's `upd` (the state as it opens, then each change) keeps `.sb-update` in the status bar
while `latest` is there (*Update to x.y*, *Downloading…*, *Restart to update*: Settings › Updates). Nothing downloads until `download` (Settings' *Update to x.y*), only with `install`
(packaged, macOS, `codesign -dv` says Developer ID) and the feed: Electron's `autoUpdater` (Squirrel.Mac, `serverType:
'json'`, that version's feed, `feedOf`: its zip), `ready` on `update-downloaded`, then `install` is `quitAndInstall`
(main sets `quitting` on autoUpdater's `before-quit-for-update`: the window's close would only hide it). A check has
30 s (`AbortSignal.timeout`) and sets `checking` before any await, so a second one meanwhile returns its state; `auto`
the same again (a window's reload) keeps the timer. Else *Download* is the release's page. The
daemon outlives it: the stale bar, as before. IPC `update` (state, check, download, install; `from(e)`), `update-auto`,
the `update` event; preload's `update`, `updateAuto`, `onUpdate` (returns its unsubscribe). The app menu's *Check for
Updates…* is `laki://settings/general?spot=Updates` (links.ts' settings `spot`) and a check. `scripts/release.sh`
`upload` writes each Mac zip's `update-mac-<arch>.json` (`feedOf` through `node -e`) before the checksums, only for a
Developer ID one (its `Laki.app/Contents/MacOS/Laki` through `codesign -dv`: Squirrel.Mac turns an ad-hoc one down). The
app's Info.plist has `ElectronSquirrelPreventDowngrades` (`build.mac.extendInfo`): Squirrel.Mac refuses a downloaded app
older than the one running, whatever the release's tag says (an older signed build tagged as new). Settings ›
General's `UpdatesField`. ponytail: no Linux self-update (no new dependency), no channels, no daemon restart.

### Usage

Plan limits (`usage.ts`, the renderer's `Usage.tsx`): `usage` reads Claude's `GET api.anthropic.com/api/oauth/usage`
(`Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`; no redirect followed, both; the token is the freshest of `security
find-generic-password [-a $USER] -s "Claude Code-credentials" -w` and `~/.claude/.credentials.json`) and Codex's `GET
chatgpt.com/backend-api/wham/usage` (`$CODEX_HOME/auth.json` `tokens`, `chatgpt-account-id`). Tokens are read-only:
never refreshed (that can sign the agent out), an expired one isn't sent. Each agent's answer is kept 5 minutes
(`USAGE_TTL`; Claude's 7.5, `TTL`: Anthropic turns away faster pollers; a turned-away token too), one that asked no server or failed on the way 1
(`AGAIN`); a 429 (`busy`) its `Retry-After` (`waitOf`), else `BACK_OFF` (10, 20, 40, then 60 minutes, `slows` in a row), the last
answer with numbers (`last`) given meanwhile with the error and `next` (Usage.tsx' `waitText`: from when, checked again when); the RPC's `now` (tests'); `settings.usage[agent] === false` skips it. The renderer asks every minute (and notifies near a limit: Notifications). Tests set `LAKI_USAGE_API`
(a fake server for both; only `http://127.0.0.1` or `localhost` count: a session's env can reach a daemon the CLI starts) and get a fake `security`
(`test/fakes`) reading `$HOME/keychain`: never the real Keychain. Claude's account whose tab wrote `rate_limits` in its
status line within `STATUS_FRESH` (meters.ts' `statusLimits`, below; main.ts passes it as `usage`'s `own`) isn't asked:
its 5-hour and weekly windows (`claudeWindows`' labels), the endpoint's others and plan as `last` had them.

### Meters

Claude's status line (`settings.statusBridge`, on unless false; Settings › Appearance's *Read Claude's status line*;
meters.ts' statusline section): `hookFiles` gives this Mac's claude settings files (and the fast one) `statusLine`
`<data>/statusline.sh` (`statusSh`, `padding: 0`; `--settings` wins over a project's own), `writeHooks` writes the script
(sh, 0755, exits 0; again on `settingsSet` `statusBridge` and `uiReset`). It keeps claude's JSON as
`$LAKI_STATUSLINE_DIR/$LAKI_TAB.json` (a `.tmp` renamed), then runs `$LAKI_STATUSLINE_CMD` (unset first: one that runs
the script again ends) with the same stdin. `lakiEnv` gives a local claude tab both, the setting on or off (`statusLineEnv`;
the dir 0700): `ownStatusLine`, the first `statusLine` `type: command` of the workspace's `.claude/settings.local.json`,
`settings.json`, the account's folder's, `homeDir('claude')`'s, as the tab starts, none when it names `statusSh`.
`statusOf` (read again only as its mtime moves; `meterRead` and `statusLimits`): `session` (`session_id`), `used`
(`current_usage`'s input + cache writes + reads; null before an answer), `pct`, `max` (`context_window_size`), `limits`
(`rate_limits`' five_hour, seven_day, `resets_at` in seconds, through `claudeWindows`). `meterView` takes a line of this
chat (`session` is its `resumeId`): `max` its window (kept once it's old), `used` while `STATUS_FRESH` (10 minutes;
`pct` × `max` when only that), else the transcript's. `statusGone` at `closeTab`, `statusTidy` hourly (gone tabs').
Tested in `test/statusline.test.ts` (the fake claude runs `statusLine` with `test/fixtures/statusline.json`, its chat's
id, as it starts and at each prompt; what it printed in `FAKE_LOG` as `bin: 'statusline'`). ponytail: not a host's, a
codespace's or codex's; your status line's `padding` and managed settings aren't read.

A claude or codex tab's context and what its chat used (`meters.ts` `meterTick`, every 10 s, `LAKI_METER_MS`: tests'; and
1 s after a turn's end; both settings off: the tick reads none; an archived workspace's tabs skipped): each tab's transcript read on by `tailOf` (a `MeterRun` per tab:
its file, `pos`; another chat's file, a /clear: none until this one's), parsed by `share.ts` `meterOf` (only lines that
name `"usage"`, `token_count` or `turn_context`). Claude: an answer's lines share a `message.id`, the last one's usage
counts (`msg`, `was`); `used` is its `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` (not a
sidechain's; `<synthetic>` skipped); the window `WINDOW` (200K), 1M for a `[1m]` model (the tab's or its preset's
`model`, the preset's args; none named: claude's own settings, `claudeBig`: the workspace's `.claude/settings.local.json`,
`settings.json`, then the account's folder's) or once `used` is past it. Codex: `turn_context`'s model, the last `token_count`'s
`last_token_usage.total_tokens` of `model_context_window`, its `total_token_usage` growing (`total`: a smaller one is
counted anew). Tokens: input, output, cache writes and reads; cost by `shared/types.ts` `PRICES` (`costOf`, the first
regex on the model; `priced`: some had one, else tokens only). `meterView`: `TabView.context` `{ used, max }`, `usage`
`{ tokens, cost? }`. Today's (`dayOf`, by each line's `timestamp`, this Mac's day; `m.today` starts over at midnight)
per chat in `<data>/usage-today.json` (`spent`: `day`, `chats` by resume id with its workspace; a chat's the more of
what was kept and what's read now, so a restart's reading anew counts once and a closed tab's stays), the view's `today`
(`todayView`: tokens, cost, the 5 workspaces that used most). The renderer (`settings.contextMeter`, `settings.costs`,
on unless false, Settings › Appearance; `contextMeter` `line` (unset, true), `ring` or `status`, App's `ctxLook`): App's `tabList` `.tab-ctx` (its place: one rule in styles.css, a 2px line
along the tab's bottom edge; a split's fullest), or Usage.tsx' `Ring` there, and tooltip lines, the status bar's `.sb-ctx` (the focused tab's,
`.usage-bar`), `UsageButton`'s `today` (*Today*, *≈ API price*); `Usage.tsx` `level` (amber past 70, red past 90),
`ctxText`, `usageText`. Tested in `test/meter.test.ts`.

### Renderer

`src/renderer/src`:

- **`App.tsx`**: the sidebar, tab bar, toolbar, send bar, palette items and keys.
  - Keys are handled in a capture-phase `keydown`; xterm never sees ⌘ keys. Settings › Keys' (`shared/keys.ts` `KEYS`:
    17 actions, an id, words and a default each; `settings.keys` over them, `keyMap`: '' none, one `keyOk` refuses (no
    ⌘, ⌥ or ⌃) the default) go first, after the picker's: `kb`, `keyFor` (the layout's character, `keyLabel(e, true)`,
    then the physical key: Dvorak's ⌘K, Cyrillic's, ⌥'s) into `bound` (false: not now, the key goes on: ⌘[ in a
    field); a rebound one's old keys do nothing. `keys.current`'s `force` runs one by id (`browser-key` with an id: the
    menu bar's, a Browsers page's). The rest (`FIXED`: ⌘1…⌘9, ⌘↑ ⌘↓, ⌘O, ⌘E, ⌘D, ⌘⇧N, zoom) are the `act` map's. `kh`
    and `kt` put the keys in use in menus' hints and tooltips; `bridge.keys` sends `settings.keys` to main. ⌘⇧N clicks the tab
    bar's + (`.newtab-btn`): a menu opened by a key's click (`detail` 0) has its first item picked (`Menu` `first`).
    ⌘⇧A is `toggleArtifacts` (the status bar's Artifacts strip, `gallery`); ⌘L is Send later (`canLater`); ⌘⇧⏎ is
    `toggleFull` (the tab bar's ⤢): `.app.full` hides the chrome (styles.css), `.full-exit` brings it back, and main's
    `full-screen` IPC puts the window full screen (`focusFull`: whether it was, restored after, and what `saveWin` keeps).
  - Per-viewer UI state is in `localStorage`:
    - `laki.ws`: the selected workspace;
    - `laki.tabs`: the selected tab per workspace;
    - `laki.groups`: each workspace's tabs, each a split tree of sessions (the daemon's `layouts`, kept here for the first paint);
    - `laki.sideW`: the sidebar's width per `RailKind` (`sideKind`: the rail's kind, projects without the rail; `laki.side`, the
      one width before, seeds each); `laki.sideOpen`: whether it's shown;
    - `laki.rail`: the rail layout's kind (`RailKind`: projects, shells, browsers);
    - `laki.folded`: the projects whose workspaces the sidebar hides (a click on the project's head; `rows.dragged`
      keeps a drag's click from folding it), and the seps whose workspaces up to the next sep it hides (`shownRows`);
    - `laki.panel`, `laki.panelTab` (`info`: ⌘I's), `laki.panelW`: the right panel; `laki.previewW`: the file preview's
      width (null: it shares the room with the terminals; a double-click on its edge goes back to that) (both
      `Panes.tsx` `PanelHandle`: no cap but the terminals' 280px, also `max-width` in styles.css);
    - `laki.theme`: the last `Paint` (theme, glass, font), painted before the daemon's settings arrive.
    - `laki.active`: when each agent tab last worked or waited (ms), for the bubbles' recent ones; closed tabs drop out.
    - `laki.runsSeen`: the newest run the Scheduled tasks page showed (the clock's dot: a failed one after it).
    - `laki.needsEarlier`: `1` while Needs you's Earlier row (stale finishes) is unfolded.
    - `laki.limitsTold`: each plan limit window's reset it was told for (`limitsCrossed`: once per reset).
    - `laki.recent`: the palette's last 30 picks, by label: first in it, and ahead of a close match.
    - `laki.md`: the file preview's Markdown mode, `raw` or `rendered`.
    - `laki.zoom`: each tab's ⌘± text size, in points over `settings.fontSize` (App's `sizeOf`; ⌘0 drops it; closed tabs'
      go); Settings and Help zoom with `pageZoom` instead.
    - `laki.diffSplit`: Changes in two columns (`split`, `text.ts` `splitRows`) or one (`unified`, the default).
    - `laki.changesScope`, `laki.reviewScope`: Changes' and the Review tab's *Branch* or *Uncommitted* (Diff.tsx `useScope`).
    - `laki.video`: the sidebar's video (an embed URL), back after a reload without autoplay.
    - `laki.timers`: the sidebar's timers (`id`, `end`, `ms`, `then`, `left`: paused, its ms left, kept as it is;
      `note`: its message, Go out: on its bar, the end dialog's title, the notification's); ones that ended while the
      app was closed are dropped.
      Send later (⌘L, the toolbar's clock and ⋯, a tab's right click, ⌘K, the AI page's clock (`onLater`, dialog `back`);
      `SendLaterDialog` in panels.tsx, `text.ts` `parseLater`: a length or a time of day; `picks`: Run ▾'s agent actions,
      `mergeActions`) is one with `then: 'send'`, `ws`, `tab`, `text`: `send` `whenIdle` as it rings (Send now, Edit,
      Cancel in its menu, and in its tab's pane foot: panels.tsx `LaterStrip`, beside the `QueueStrip`); `tab: 'ai'` is Laki AI (`askLater`: `aiAsk` with the text stamped, tried every 15 s for an hour
      while it's busy, a notification as it answers); one due while the app was closed is dropped with a toast (`missed`).
    - `laki.watches`: the stopwatches (the timer menu's *Stopwatch*, `StopwatchBar` in panels.tsx): `ms` counted before,
      `from` running since.
      A reminder (a workspace's *Remind me…*, `RemindDialog`) is one with `then: 'remind'` and `ws`: it notifies about
      the workspace (the click: its first tab) and toasts *Open*; one due while the app was closed rings as it opens.
    - `laki.previewSize`: Preview's size (`{ w, h }`, null: the panel's).
    - `laki.aiFloatAt`: where the floating Laki AI chat was dragged (App's `AiFloat`: `right` and `bottom` in px, held
      8px inside the main area as it changes size; a double-click on its head drops it and the size); `laki.aiFloatSize`:
      its size, from its edges and corners (`.ai-grip`s; the window clips, so they reach past the round corners).
    - `laki.aiDock`: the chat button minimized into the status bar (App's `dock`: `fly` down, `DOCK_MS`; `.sb-ai`, sticky at
      the bar's end; its right click, or ⌘K where no status bar shows it, floats it again).
    - `laki.checkOffered`: projects Done check was offered for (its toast, once each).
    - `laki.reader`: each claude or codex tab's Reader view or terminal (`reader`, `term`; unset: Reader on a phone).
    - `laki.radarHide`: Collision radar's overlaps you hid (`radarKey`: both sides' lines; a change shows it again), the newest 200.
    - `laki.branchFull`: the status bar's branch (`.sb-branch`) whole, with its base; else short: no branch prefix, cut at 24ch, all of it in the tip.
    - `laki.aiDrafts`: Laki AI's composers' unsent text and images (paths, shown again through `aiImage`), by chat:
      PromptInput.tsx `useDraft` (the AI page, floating chat and AI window share `ai:<chat>`; an extension page's `widget:<id>`,
      `widget:` a new one; a brainstorm's chat; `desk:build`); kept by Reset the interface (`UI_KEEP`).
    - `laki.newDraft`: the new-workspace page's draft (`Draft`: the form, images, race, template), saved as it changes
      while something's typed, dropped as it's made (back if that fails) or *Clear*ed; `laki.scheduleDraft`: Scheduled
      tasks' open form (Cancel asks when it changed); `laki.settingsSec`: Settings' last section. Their forms don't
      submit on Enter (`onSubmit` prevents it; ⌘⏎ or the button), and `Page`'s and `Modal`'s Esc is `escapes` (not one
      a menu or field took, nor an IME's; a `Modal` takes the keyboard as it opens unless a field of its has it, and gives it
      back as it closes: a terminal that kept it took Esc to its agent; its title has a ✕; the AI page's `Page` has `esc` false); a `Modal` with something typed in it nods at a click outside instead of closing
      (`loose`: the palette closes anyway).
    - Settings › General › Development › *Reset the interface* (`resetUi`): the daemon's `uiReset` (core.ts: every setting
      but `SETTINGS_KEPT`, what the user set up or wrote (`specs` and `workflows` too: on unless false), back to unset, the experimental ones too; `widgetsOff`: every
      extension off), then removes every `laki.*` key but `UI_KEEP` (timers, stopwatches, drafts; Get started shows
      again), then reloads: add a key that holds what the user made there, and a setting that's set up or written to
      `SETTINGS_KEPT`.
    - `laki.onboard`: Get started (`panels.tsx` `Onboarding`, `STEPS`): `done` (ticked, or seen done by App's
      `onboardDone`: a project, a workspace, Settings' sections through `SettingsPage` `onSection`, Shells or Browsers),
      `seen` (it opened once by itself, after the first project: Welcome's checks come first), `off` (Don't show again:
      no `OnboardBar` at the sidebar's foot either). What it ticks that Achievements' Getting started has too (a project,
      a workspace, Settings) is earned there quietly (no toast), so the two agree; the status bar's trophy shows from
      the first unlock.
    - `laki.newWs`: the new-workspace page's last choices (`LastNew`: project, preset, cmd, local, model, effort,
      base, place (that project's), template name, and Settings' default agent then: a new default wins; never the prompt, name, PR or a race); its More starts closed.
  - The Dock's count (`bridge.badge`, main's `app.dock.setBadge`): tabs waiting, or done unseen, outside muted tabs,
    muted and archived workspaces. The same message carries the menu bar's item (`badge(n, items, tray)`: main's
    `Tray`, `trayIcon` drawn in code as a template image; the count as its title, a menu of those tabs, waiting first
    with what they ask from `turn` events, `show(tab)` on a click, then *New Workspace…* (`newWsWin`), the screenshots and *Open Laki* (the global hotkey as its `accelerator`, `registerAccelerator: false`; the `hotkey` IPC builds the menu again); `settings.menuBar === false` destroys it: Settings › General › *Menu bar icon*). `TurnTime` (`ui.tsx`'s `Elapsed`, ticking each second) on a tab and a row, with
    `settings.timers`.
  - The theme is applied during render (`applyTheme`), before the terminals' effects read the CSS. Glass also
    goes to main (`bridge.glass`: `setVibrancy`) when it changes.
  - The toolbar's ⋯ (`wsActions`) has *Copy path* (the full one, `host:` first; `shortPath`'d as its hint); the status
    bar has no path. A Terminals workspace's leaves out `$PORT` (its listening ports as any), a Browsers one's bar has only the foot
    buttons (on a phone none, unless the daemon is stale or the connection is down).
  - Resting on a row (`peek`, 550 ms; 120 ms once one shows) shows `peekCard` beside the sidebar instead of a
    tooltip: state and agents, the last answer or the ask, the PR (avatar, state, title, author, checks, review,
    conflicts, size), `statText`, ports and marks, *Open*, the PR, ⋯; it stays while the mouse is on it (250 ms to get
    there), a wheel, a key or the window's blur hides it; not on a phone or with a pointer other than a mouse, nor for
    a Terminals or Browsers row (`kind`: no port, PR or agent to tell of).
  - A workspace with a PR gets GitHub's mark in the sidebar (`.ws-pr`, its `prState` as colors; an open one's failing
    checks a red mark of their own before it, `.ws-pr.ci`, as conflicts get theirs: a red GitHub mark is a closed PR),
    unless `settings.prIcon === false`. Projects show `fork` (a repo) or `folder` (`git: false`), or their own `icon` in
    their `color` (ui.tsx `ProjectMark`, `.p-mark`: an emoji with a line in it; also the new-workspace page's project
    menu (a menu item's `mark`), the palette's workspaces and tabs (`PaletteItem` `mark`), Settings' nav, a rail pin's
    corner); App's `tint`: a workspace's color, else its project's (the peek card, rail pins, the bubbles).
  - A project's workspaces are in `.project-ws` (indented on a guide line; a line between projects). Rows are inset and
    rounded (hover and selection one item each), the selected one with a short bar (`--ws-bar`: its color, its project's
    (`--proj-c`, set inline: every row's bar, no tint) or the accent; a
    look's `.ws.sel` background replaces it), `.needs` (a tab of `needsYou`) a bold name; a project with none shows
    *New workspace* (`.ws-new`). A row shows
    `stat` (`.ws-stat`, with `settings.diffStat`) and, on hover, `.ws-acts` (its ⋯ menu) growing in after its marks, which slide left. The PR mark is red
    for a closed PR only: a merged one stays purple.
  - The sidebar's filter (`find`, the head's funnel, ⌘K): `shows` (words in a name, branch, PR title, author or
    `#n`, and `ONLY`: needs you, working, with a PR); matching rows only, flat (no seps), no drag meanwhile.
  - A PR's author's picture (`Avatar`, Info.tsx: `avatars.githubusercontent.com/<login>`, the CSP's one `img-src` host) before
    the row's PR mark and in the PR section, unless it's `mine`; `settings.avatars === false` (Settings › Appearance's
    *GitHub pictures*, `showAvatars`): none loaded.
  - ⌘J (`nextNeed`): the next tab of `needsYou` (the Dock count's rule) in text.ts `needsSorted`'s order, as Needs you
    lists them: waiting ones, the oldest first; then done ones, the newest first, fresh before stale (`isStale`: done
    `settings.staleAfter` minutes ago by its `needAt`; unset `STALE_AFTER` 30, 0 never; waiting never). Needs.tsx folds
    the stale ones under *Earlier · n* (`laki.needsEarlier`: unfolded; *Seen all*: `seen` each, Undo `unread`), dimmed,
    one line; each card's chevron shows or hides its detail (open but for a stale one), the rest of it opens the tab.
    App's `minute` tick moves one across while nothing else changes. The Dock's count is all of them.
  - Picked rows (`picked`, ⌘-click and ⇧-click, `pickRow`, `anchor`; `pickable`: a project's live workspaces, not
    terminals' or browsers'; not on a phone): `.ws.ws-picked`, `.pick-bar` over the list (Archive: `wsArchive` `ifClean`
    each, the dirty ones asked once, Undo restores all; Mute; Move to group, `pickedGroups`, when they share a project
    with groups; Delete, asked once), a drag of a picked row moves them all (`moveIds`); Esc or a plain click clears.
  - Back and forward (`settings.history`, on unless false; Settings › Appearance › Rail): `hist` (a ref: `Place`s, `{ d: dialog, ws }`, `HISTORY_MAX`
    back) gets each new place (`isPlace`: a page, `PAGES`/`PAGE_KEYS`, or none; a dialog over them isn't one), what was
    ahead dropped (Workflows' index, a workflow and a run are places too: its dialog's `nav`, `WorkflowsPage` `onNav`); `travel(j)` selects its workspace (gone: the one you're in; a gone one's workspace view skipped) and
    page, `going` so that isn't a new place. `histNav` (‹ ›, a right click: `histMenu`, `placeName`) at the rail's top,
    else after the side head's hide button; ⌘[ ⌘] outside a text field.
    A page's own levels: Workflows' and Specs' (`onNav`: the list, each spec or brainstorm open, its templates; the
    dialog's `of`, `kind`, `slug`, `templates`) are places; Settings' section and an extension page's tab only rewrite
    the place they're at (App's `keepHere`, a microtask after the effects), so Back comes to where you left it.
  - The window's title (`winTitle`, `document.title`: Electron's window takes it; a screen share's picker, the Window
    menu, a browser's tab): `placeName` of the last page (`titleAt`: a dialog over it keeps it), else the workspace · tab
    (after `<emoji> <project>` when its project's icon is an emoji),
    then ` — Laki`; the new-workspace, AI and floated tab windows set their own (main.tsx, `TabWindow`).
  - `toast(text, undo?, label?, ok?)`: one message at a time (a newer one restarts the timer; `ok`: done, a check
    and no red); `archive` asks first (`peekWs`, `rmFacts` with `archive`: the storage folder kept, a codespace
    stopped), then `wsArchive` with `ifClean` unless it was dirty when asked, and offers Undo (`wsRestore`); one dirty
    since is asked again; `asked`: the caller asked once for several (`pickedArchive`, the Board's `archiveAll`). Deleting a
    workspace and removing a project say so too. `busyWith` puts `going` on the rows meanwhile (a spinner and
    *archiving…* / *deleting…*), Compare's *Keep this one* too.
  - A new workspace stays in sight (`showNew`, from the new-workspace page, a fork, a restore): `reveal` unfolds the
    project and sep holding it, and the one selected before it, once the view has them.
  - The menu bar's screenshot (`bridge.onShot`): `imageSave`, then the new-workspace page with it (`newImages`, a
    `Shot` each: its editor note goes in the prompt as it arrives, the page kept).
  - `making`: workspaces the new-workspace page is making, a row each (`makingRows`, a spinner, *creating…*) where
    `place` puts them; Esc closes the page and they stay until `wsNew`/`wsFan` answers (a dialog opened meanwhile stays).
  - No project: `Welcome` (panels.tsx) with `doctor`'s checks. `settings.dimPanes` (unset: on): `.dim-panes` on `.app`.
  - While a video plays, a closed sidebar is hidden (`hidden`), not unmounted, so it plays on. The video (`Video` in
    panels.tsx, the status bar's play button and ⌘K, the `video` dialog): `text.ts` `youtubeEmbed` turns a link into a `youtube-nocookie.com/embed` URL
    (else refused), an iframe sandboxed without top navigation; the CSP's `frame-src` allows that host, and main sets a
    `Referer` on its requests (`dev.laki.app`): from a `file://` page YouTube's player refuses to play (Error 153).
    `min`: only its bar (the iframe `hidden`, playing on). Its src has `enablejsapi=1`: `videoCommand` (panels.tsx)
    posts `playVideo`/`pauseVideo` to it.
  - Timers (App's `timers`, any number: the foot's button and `startMenu` add one; each a `TimerBar`, panels.tsx, over
    the foot, its time left ticking, its `timerMenu`: more time, start over, what happens as it ends, stop; the `timer`
    dialog, `{ timer: id }` for one's new length, with `text.ts` `parseDuration`): as one ends (`ring`), `TIMER_THEN`'s
    action (pause, play or close the video; with no video, only the notice; `command`: `tabNew` `custom` with the
    timer's `cmd` in its `ws`, the workspace selected when it was picked, not focused; gone or archived, only the
    notice), then `settings.timerSound` (Glass unless set; main's `sound` IPC: `afplay`) and `choose`'s dialog (*Again*:
    the same timer over), or with `settings.timerAlert` `notification`, `notify` with that sound (no tab: it shows the
    window) and a toast. `pause` (the bar's ⏸, its menu): `left` instead of a running `end`; `ring` isn't set for it.
  - Tabs (`tabList`) go in the top bar, or a `.tabstrip` (`data-tabbar`, a drop target too) under or beside the terminals:
    `settings.tabsAt`, top on a phone. `settings.hoverFocus` (unset: on): a pane the mouse enters (no button held, window focused)
    gets the keyboard (`Panes` `onPointerEnter`).
  - `.side-head` (top): hide, open a project, help; App's `footButtons` (Schedule, Board, Video (`settings.videoButton`),
    Meme (`settings.fun`), Timer (`settings.timerButton`; each on unless false, a running video or timer keeps its own),
    Settings): off a phone the full-width status bar's start (`.sb-foot`, `wideBar`), on a phone or with
    `settings.statusBar === false` (`noBar`: no status bar at all but while disconnected, as a phone's; the AI button
    then can't minimize into it) `.side-foot` (pinned at the sidebar's bottom), with words (`IconButton` `label`) unless `settings.sideLook.labels === false`; one row: App's `fit`
    (a `ResizeObserver`, and the theme's font) sets `data-bare`, how many buttons from the right lose their words, until
    it fits.
  - The project and workspace order is the daemon's (`reorder`).
  - The rail (`rail`: always, but on a phone, whose sidebar is a drawer; Settings › Appearance › Rail) puts `railBar`
    (`.rail`, `railW` as `--rail-w` on `.app`, `.rail-on`) left of the sidebar: a `railButton` per `RAIL` kind (a project's
    `kind`, none: projects) with `railSays` (`needsYou`'s count, a dot while a tab `spins`), Board and Schedule (`runFailed`: a
    red dot) right after Projects, and AI (when on) over Settings at its bottom, which leave the list's `.side-foot` (Video, Meme, Timer stay); Schedule's and Board's pages hide the list (`listOff`: the aside `hidden`, `.list-off`); the list is `listed`, that kind's projects, and `inList` its pinned (a filter: all). An
    effect on the selected workspace sets the kind (`lastIn`: each kind's last, where `railTo` goes back); below `.rail-sep`,
    `railPins` (`pinButton`: `initials` in the workspace's color, a terminal's or browser's icon, `needsYou`'s count; never lit, its kind's button is; a
    right click is `wsMenu`); `moveWs`
    keeps to the list; `SideHandle` `at`. Its settings: `railLabels` (off:
    `data-bare`, icons only, `railW` 52), `railShells` and `railBrowsers` (off: `railOf` makes that kind `projects`, no
    button, its project in Projects' list; `rawKind` still gives a pin its icon and leaves out *Run ›*). With words, past
    `RAIL_FIT` buttons above the pins, `RAIL_MORE`'s (todos, calendar, workflows, specs, board: the least used first; the default
    pages: workflows and specs) go into a ⋯ More menu, lit while its page is open. `settings.railOrder` and `railHide` (Settings › Appearance › Rail's
    `RailField`: `RAIL_ITEMS`' boxes, an HTML5 drag; `railSorted`; AI fixed at the foot): the order and the ones put
    into More; a right click on the rail (`railMenu`) colors one (`settings.railColors`, by its `data-rail` key, a pinned spec's `plan:<project>/<kind>/<slug>`; `.rail-icon.tinted` in `--tab-c`) or moves one there, More's foot shows them all again or opens it.
- **Phones** (`App.tsx`, `useMedia`): `narrow` (≤640px, under the window's minWidth) puts `.narrow` on `.app` (styles.css' last block: the
  sidebar as a drawer, one pane per tab, panels and pages over the main area, terminal font at most 11px);
  `touch` (`pointer: coarse`) shows `KeyBar` (Esc, Tab, ⇧Tab, ⌃C, arrows, ⏎ to the focused pane, ⌨ focuses
  xterm's textarea; its buttons never take the focus). Traffic-light paddings are `.electron` only.
- **`Term.tsx`**: one xterm per pane. Reply (`onReply`, given while `replyTo` finds an agent: the tab's own when one
  runs in it, else its workspace's live agent tabs): a pill (`.term-reply`) where the mouse let go of a selection, gone
  at a key, a press, a scroll or an empty selection; it opens panels.tsx' `ReplyPop` (the quote, your words, a pick of
  agents; ⏎ `send` `enter: false` into the prompt, ⌘⏎ `send` (`whenIdle` for an agent tab); ⌥ held (`alt`, `USES`,
  `onSelection`: App's `selectionTo`): *New workspace* (`newWs` with the text as its prompt), *New tab here* (`tabNew`
  with Settings' agent), *Ask Laki AI* (`aiAsk` with `whereNow`), the pill shown with ⌥ alone when no agent can be
  replied to), text.ts `replyText`: *From
  <tab>:* (*your output* from its own), the quote fenced, the words). A link's hover card (`LinkPeek.tsx`, 400 ms on,
  250 ms to reach it; `peekOf`: a GitHub PR or issue link, `ghCard`; an image, by extension): from the OSC 8 handler, the
  WebLinksAddon and a link provider of its own for a picture's path in plain text (`PIC`, relative to `cwd`, the
  workspace's folder); App's `peekImage`: `fileRead` (the workspace, else its storage folder), else `aiImage` (pasted
  ones only); an https one through `/img` (Widgets.tsx `imgVia`); a click on the picture or its ⤢ (`.lp-open`) opens it larger: Term's `big`, panels.tsx' `Modal`, which outlives the card. No native title over a link that peeks.
  Any other file's path (`CODE`: one with a folder, or a bare name with `:line`; not a picture's) is a link too: ⌘-click
  (⌃ unless an app has the mouse; a plain click would open it as you select it) is `onCode`, App's `openCode`: a file of the workspace in the preview at its line,
  or `openIn` `editor` (`settings.fileClick`, ⌥ the other; `codeTo` for the hover's words); any other path `openPath`'s. In any tab (claude started in a terminal tab too; a shell runs the line on ⌃J), ⌘⏎ and ⇧⏎ send ⌃J (`\n`): a new line in claude's,
  codex's and opencode's prompt, where xterm would send ⏎. It attaches on mount and detaches on unmount, and swallows terminal
  queries unless it is the responder. xterm takes `allowTransparency` only as it opens, so App keys each
  `Term` on `transparent()`: turning glass on or off remounts the terminals. A keypress whose keydown it didn't see is dropped: Enter that closed a
  dialog (and so focused the terminal) would type a stray ⏎. On window focus or a page turning visible it sends
  its size again, so a look is enough to get it back after a phone. Links: a plain URL (WebLinksAddon) opens on a click (with the mouse
  captured, `?1000h`…: only on ⌘-click, and a ⌘-press on a link (`over`, the link providers' hover) is kept from the
  app's mouse report by `.xterm-screen`'s listener: codex opens its links itself, two tabs otherwise; in a browser
  elsewhere, no `bridge`, a tap too); an OSC 8 http(s) one only on ⌘-click (L13: its words aren't its address; a tap
  with no `bridge`); every link's address in the `title` on hover; `file://` (or a
  bare absolute path) on ⌘-click (⌃ too, unless the mouse is captured) (`allowNonHttpProtocols`): App's `openPath`, a file of the
  tab's workspace in the preview, else main's `open-path` (the app window's only: a folder in Finder, a document of
  `DOCS` in its app (not HTML: L11), anything else, bundles (`BUNDLE`: an Xcode project and a playground too) too, revealed). Files dropped on it (`bridge.pathOf`) are
  pasted as their paths, shell-quoted when they need it; its `preventDefault` keeps the window's folder drop out.
- **`shared/layout.ts`** (the daemon's too): tabs, tmux style. A UI tab is a split tree whose leaves are daemon tabs (sessions), so a
  session is in exactly one tab and nothing nests. Pure functions: `groupsOf` (stored tabs minus ended
  sessions, plus one tab per unplaced session), `move` (a pane or a whole tab to a `Spot`: beside a pane,
  onto its center to trade places with it, or into the tab bar at an index, its own tab; no change: `groups` itself), `insert`, `keep`, `resize`, `place`. Tested in `test/layout.test.ts`.
- **`Panes.tsx`**:
  - panes are absolutely placed siblings keyed by tab, so splitting never remounts a terminal;
  - `useTabDrag`, VS Code style, pointer-based (not HTML5 DnD): a drag starts past 4px (less is a click); a pill
    (`.drag-ghost`) follows the pointer; `overAt` finds the target with `elementFromPoint`: a pane's edge band (`ZONE`,
    30%) or its center, shaded (`.drop-zone`), or a tab bar (`[data-tabbar]`, its `.tab` children in groups' order, the
    flex direction for top/bottom or left/right) and the index between tabs, a line there (`.drop-line`); App's `ok`
    (the drop changes the groups) hides the rest. Esc, a release elsewhere, the window's blur end it with nothing;
    `.tab-dragging` on `<html>`: grabbing, no selection. After a drop the pane's terminal gets the keyboard. Off on a
    phone;
  - `SideHandle` resizes the sidebar.
- **`annotate.ts`** (`annotate.html`, electron-vite's second renderer entry): the menu bar screenshot's editor, a
  window main keeps on top (`annotate()` in main, `bridge.annotate`): crop, arrow, text, rectangle, pen, six colors,
  ⌘Z, a note; *Add to prompt* sends the PNG and note to main (only from that window), which sends `shot` (png, note)
  to the app: the new-workspace page with the image and the note as its prompt. Vanilla TS; in a browser (the dev
  server) a stand-in picture.
- **`floater.ts`** (`floater.html`, the third renderer entry): the floating bubbles (Settings › Appearance;
  `settings.floater`, unset: on). App's `floats` (each workspace whose agent tab works or waits, waiting first, then
  `floaterRecent` (0-5, 3 unset) workspaces whose agent worked last, by `laki.active`, as `idle` or `done` (a fresh done first:
  a stale one, `isStale`, is drawn and kept as idle, no fill; idle
  longer than `floaterRecentHours`, 4 unset, 0 never: out, a minute's tick ages them); at most `floaterMax`:
  `tab`, name, project (`projWords`: its emoji first; ponytail: an icon by name isn't drawn there), status, its color
  (`tint`), what it asked or last said, and `floatMore`'s branch, agents, PR and
  lines for the card), the theme's colors and the options (`style`:
  `floaterStyle`, `cards`: `floaterCards`, `add`: `floaterNew`, `menu`: `floaterMenu`, `voiceTo`: `floaterVoiceTo`) go to
  main (`bridge.floats`);
  main's `placeFloater` shows the bar while Laki isn't in front (`front`: one of its own windows has the focus, not the
  drop, its card or the voice window: a press on the drop makes Laki the active app, and the drop would hide under the
  pointer), and with + on even with no circles; `type: 'panel'` windows over every Space and
  full-screen app: `#bar` (labels: `text.ts` `initials`, two letters, unique, `pr`/`issue`/numbers skipped; a drop against the screen's left or right edge, never the top or bottom (`snap`; a row along them is still in the code, unreached: `data-side` from main's `floater-side`; `across`: the page's offsets and length along the row, main's `beside` puts the card, menu and voice windows below or above it):
  `.shape` with its flares, a slow wobble, a round blob while dragged; the circles; `.fl-btns`: the + (×, `.on`, while
  open) and `ACTS`, the menu bar's: New task, Say it, Screenshot area, Whole screen, and Ask Laki AI while
  `aiOn` (`actsFor`, the floats' `ai`; the menu a row taller: `menuH`); `menu` stack: `.fl-acts` over the + in
  the drop (`floater-size` `up`: main moves `home` so the + stays under the mouse; a hover's name and hint go to the card's
  window, `floater-tip`, cards on or not), card: `#menu`, a focusable panel beside the drop (`MENU`, its foot by the +'s,
  `floater-menu-at`; keys 1-5, arrows, ⏎, Esc; closed on blur, the bar told by `floater-menu`: a press on the + while
  open, or just after a blur closed it (`menuShut`), closes it); its picks are `floater-act` (`new`, `ai`: `aiWin`, `area`: `screenshot`,
  `screen`: `screenPick`, with more than one screen a menu of `screenItems` at the pointer, as the menu bar's submenu; `mic` from the menu: `floater-voice`, the bar opens `#voice`, the stack's opens it itself); New task is
  `new` (main's `newWsWin`, also the menu bar's *New Workspace…*: the renderer's `?window=new`, `NewWindow.tsx`, the new-workspace page alone in a `type: 'panel'`
  window, compact (`.new-window` in styles.css; as tall as the page: `new-fit`, a `ResizeObserver` on the form), pinned over every app and Space, focused without bringing Laki's window forward (`own` leaves it out, so the
  bubbles stay); one at a time, a voice prompt to it is `new-prompt`; it closes itself (`window.close()`) once `wsNew`
  answers, or on Esc), Say it opens `#voice`; a click on a circle is `floater-open`: `show(tab)`; a drag from
  anywhere on it past 4px is `floater-drag` start/move/end with the pointer's screen offset, so its cursors (grab,
  pointer) work, which macOS's drag regions take away (macOS shows them only while Laki is the active app: a hovered
  circle grows instead: `.hot`, set by `pointerover`, not `:hover`, which outlives the bar's hiding as a click brings Laki in front); at the end main's `snap` sticks it to the side (left or right) nearest the pointer, animated (another orientation: centered there, its length kept until the page says its own), and
  `floater.json` in userData keeps where (`home`, with its `side`; an older one's: left or right by where it is: a screen gone puts it on the main one, `barAt`, and leaves `home` for
  the screen's return), `#card` (a hover's card, beside the bar toward the screen's middle, click-through: its own
  window so the bar never moves under the mouse; `floater-hover` and `floater-card` show it only while the cursor is
  over the bar and Laki isn't in front: a bar shown again keeps the circle it had under the mouse) and `#voice` (the
  microphone's: a focusable panel, `focus()` makes it key without bringing Laki's window forward; dictation 150 ms
  after the focus; `voiceTo` pick: a "Pick who gets it" row first, nothing sent until one is; new: no list, always a
  new session; `voice-send`: `rpc('send', { whenIdle })` to a tab of the list, or `newWsWin(prompt)`). The card
  and voice windows are the bar page's `window.open` (main's `setWindowOpenHandler` allows only `#card` and `#voice`
  of the same page, one each; `did-create-window` pins them, `pin`'s `to`: their own page's load is a navigation too,
  which `will-navigate` would block): one renderer process, one row in Settings › Resources.
  `floater.css`: the circles' styles (`[data-fstyle]`: glow; gradient, the default; arc; bricks, box-shadow pixel bars stepped behind the initials; comet; wave, two turning rounded squares as a tide; still; idle and done dimmer; `[data-done='on']`: a done one filled green with a slow pulse, `floaterDone` unset or true: App keeps an unseen done one a bubble past `floaterRecent` and its hours),
  also Settings › Appearance's live previews.
- **The island** (`settings.floaterAt` `notch`; unset `edge`, the drop above): shared/island.ts (its pure parts:
  `hasNotch` by a built-in screen's menu bar over 24 points, `pillRect` (`NOTCH` 200, ponytail: Electron doesn't say the
  notch's width), `cardRect`, `cardQueue` (asks first, then finished ones, newest first by the float's `at`, its
  `needAt`), `lifeStep` (an ask folds only on Esc; a finished one `DONE_FOLD` 6 s after it showed unless the pointer is
  on it, and as it leaves after being on it), `fullScreen` (ponytail: a screen with no menu bar; main's `menuBarHides`, `_HIHideMenuBar`: never then), `plainLines`,
  `tookText`, `replyOf`); main's `islandAt` puts the bar at the pill (no drag, no snap; `home` and floater.json stay
  the edge's), `islandFloats` opens a card as a float turns waiting, or done within the last minute with `floaterDone` (an ask over a finished
  one; the same card again isn't redrawn, `islSent`: its reply box keeps what's typed), `island(tab, list)` sends it to the #card window (`island` IPC; its height back as `island-size`, then
  clickable and focusable: `island-ev` `focus` as the pointer presses on it (a pass leaves the keyboard where it was), its keys 1-9, ←→, Esc), `islandEv` the
  pointer's `enter`/`leave`/`esc`/`next`/`prev` and the 500 ms tick; a hover on the pill (`pill`) the session list,
  folded once the pointer is on neither. floater.ts' `pillRender` (bars, `.isl-*`) and `islandPage` (`#island`: an
  ask's options through `floater-answer` with n and label, a permission's `permVerb` and command, a finished one's
  `plainLines`, `tookText`, `replyBox` (`voice-send` from the card window), *Review changes*: `floater-open` with
  `changes`, main's `show(tab, panel)`, App's `onFocusTab` → `showPanel('changes')`). A float's `agent`, `at`, `ask`,
  `answer`, `took` (App's `islandOf`; `turnAt`: each tab's last `runAt`). Replies (edge too): a circle's right click
  is main's native menu (`floater-menu-tab`: *Reply…*, *Open tab*, a done one's *Seen*), ⌥-click and *Reply…*
  `floater-reply` → `replyTo`: #voice with `replyFor` (`sendVoice`: no pick row, its last answer, a waiting one's
  options as buttons; text refused while it shows a menu; queued: *Queued*, then it closes); the hover card's *Right-click or ⌥-click to reply*, once
  a session. Tested in `test/island.test.ts`.
- **A floated tab** (main's `tabWins`, `tab-float` IPC through App's `floatTab`: the tab's menu › *Float in its own window* (`popOut`), ⌘K, and the
  pane's *Show it* / *Bring it back*): `panelWin` `?window=tab&tab=<id>`, `NewWindow.tsx` `TabWindow` (its head the
  title bar; a `Term` of its own at the tab's ⌘± size: one more client of the session, the PTY sizes to whoever typed last;
  its ⌘-clicked files through main's `open-path`, which takes these windows too), closed when the
  tab goes. Main sends `floating` (the ids) as one opens or closes; App's `floated` shows `.floated` in that pane
  instead of a `Term`.
- **The global hotkey** (`settings.hotkeyOn`, unset on; `hotkey`, unset `HOTKEY` ⌃⌥⌘L, keyLabel's text): App sends it
  to main's `hotkey` IPC once settings come (main's `accelOf`: two of ⌃⌥⌘, or one with Space or an F key, else refused; → `globalShortcut`
  through `bindKey`, `keys.open`; it shows the app's window), Settings' `HotkeyField` too, which says when another app (or
  the other hotkey: `grab` never puts both on the same keys, and gives one the keys it asked for once the other lets go,
  `wants`) has it (`register` false); the Keys page shows the same group (`globalKeys`), and Help the keys in use
  (`GlobalKeys`: App's `hotkey` and `shotKey` once main took them, `held`). Screenshot to Laki AI (`settings.shotAsk`, on unless false, only while `aiOn`, a Mac only: preload's `shotKey`;
  `shotKey`, unset `SHOT_KEY` ⌃⌥⌘S): App's `shotKey` to main's `shot-hotkey` (false: off, `shotOn`; `keys.shot`), and the
  menu bar's *Screenshot to Laki AI…* while on: `shotAsk`, `screenshot` `-i` (one at a time: `shooting`), then `aiWin`
  with the PNG (`ai-shot`, or `aiShots` until the page's `ai-shot-ready`, `did-navigate` its reset: preload's `onAiShot`); `AiWindow` hands it through `AiPage` to PromptInput's
  `shot`: added as a pasted image (`add`), then the mic on (cloud's `voiceStart`, else macOS dictation) as the window gets
  the focus (5 s at most).
- **`Find.tsx`**: the ⌘F bar (`@xterm/addon-search`). Matches are `--find` (yellow); while it's open the
  terminal's `minimumContrastRatio` keeps their text readable. In a diff (Changes' `sp-body`, the full review's
  `.full-review`, each `data-find`), Diff.tsx' `DiffFind` instead: App's `findIn` sends `laki-find` to the `[data-find]`
  the pointer went down in last (`lastDown`), or the full review while it's shown; the lines' text found by a
  TreeWalker (not `.dl-n` or `.dl-blame`), marked by the CSS Custom Highlight API (`laki-find`, `laki-find-on`),
  found again as the diff changes (a MutationObserver); a folded file's lines aren't drawn, so aren't found.
- **Errors** (ui.tsx `Boundary`): main.tsx wraps every window's root and App's `Lazy` each lazy page (`Waiting` its
  Suspense fallback): a throw while drawing, or a page's code gone (remote access after an update), says so with
  *Reload* (and *Close* for a page) instead of a blank window. Main's `render-process-gone` reloads the window, at most
  once a minute.
- **`themes.ts`**: `THEMES`, `applyTheme` (sets the CSS variables on `<html>`, some also under the names Laki
  Go used; `default` leaves the stylesheet's; then `gateRules`: a rule whose every selector starts with another look's
  or motion's `[data-look="x"]` gets the selector `#laki-off` until that one's picked, its own text kept: Chrome tried
  all 500 on every element, `[data-look] :is(…)` can't be filed under a class), `termTheme` (xterm colors from `--ansi-0…15`). Gradient themes set `--app-bg` and a
  transparent `--term-bg` (xterm runs with `allowTransparency`). A theme after a game or film has an evocative name
  and its `aka` (the game's or film's words), which Settings' theme finder also matches. `--accent-ink` is the accent as text (every `color:`
  of it; fills and borders keep `--accent`): `readable` darkens it (lightens, on a dark theme) to 4.5:1 on the theme's
  background and panels, so a light theme's bright accent stays bright where it fills; `--on-waiting`/`--on-error` are
  labels on those fills (`onAccent`). `test/contrast.test.ts` holds every theme to WCAG ratios (text 4.5; hints, status
  marks and terminal colors 3, a mark on the selection 2.5 (its shape tells it too), the dim grey 2.5; on the main area,
  the sidebar, the rail, panels and the selection; a gradient theme's on both ends): a new theme or color must pass it. A look that fills a selected tab or row gives its marks the text's
  color (look.css' last rules).
- **`look.css`**: the bundled fonts (Inter, JetBrains Mono, the other terminal fonts and the interface ones, `themes.ts` `UI_FONTS`; `fonts/NOTICE.md`), syntax colors (`.hl-*`), a look's tab bar
  line as `--tab-line` (a gradient across it as `--tab-line-bg` and `--tab-line-w`, one down it as `--tab-line-img`):
  styles.css' real tab draws it beside the selected tab (the bar's `::before`/`::after`, CSS anchor positioning on the
  tab's `--laki-tab`) and as the tab's border, never under it; not on a phone or the pill looks), glass
  (`html.glass`) and the creative themes' looks (`[data-look=…]`, from a theme's `look`; their own fonts only with `uiFont` `theme`, `html.theme-font`:
  else look.css' last rules give them `--ui-default`, SF Pro, Inter off a Mac), some selectors also name
  Laki Go's classes. `applyTheme` takes a `Paint` (theme, `uiFont`, glass and its sliders `glassWindow`/`glassSide`/
  `glassTerm` and `glassGlow`, and `sideClear`, and `motion`: `html[data-motion]`, Appearance's Animations, styles.css'
  last block: none ends every animation and transition at once, high adds entrances, a stagger and presses; `paintOf` picks them from the settings, `paintKey` is what terminals watch). Glass sets
  see-through `--app-bg` (with the glow's radial gradients), `--side` and `--rail-bg` (`glassSide`) and `--term-bg` (`#rrggbbaa`: xterm reads only
  that); `sideClear` (Settings' *Sidebar see-through*, without glass) only `--side` and `--rail-bg`, with `html.side-clear`
  (a clear body, `.main` alone on `--app-bg`; glass in the app too: the sidebar's slider is over the desktop, not the Window one's background) and the window's blur (`blurred`; the new-workspace window never: `NewWindow`'s paint); what floats is nearly opaque, never `backdrop-filter` (over the see-through window Electron repaints it badly:
  flicker, stale tooltips, rectangles around menus); the window's own blur is native
  (`setVibrancy` over IPC, App's `glassed`; `themes.ts` `LESS_CLEAR`: macOS's Reduce transparency turns glass and `sideClear` off in `applyTheme` and `blurred`, Settings notes it under Glass; `MORE_CONTRAST`, Increase contrast: `--muted` and `--line` halfway to `--fg`; the Paint's `highContrast`, Appearance's *High contrast mode*, off unless true: most of the way, and `--accent-ink` `readable` at 7:1; App repaints as either changes). `main.tsx` loads the fonts
  before the first render: a terminal measures its cells once.
- **`highlight.ts`**: the file preview's syntax colors, a regex per language family, up to `HL_MAX` (50 KB), and a
  workflow file's (`highlightWorkflow`, a line at a time: the Workflows editor's File view);
  tokens become React text, never HTML.
- **Sidebar styles** (`settings.sideStyle`, `SIDE_STYLES` in Settings.tsx): `.sidebar[data-style]`; status: `wsRow`'s
  `data-state` (its rollup) colors the row's bar, `.ws-line` fills to `--p` (its agents' highest `progress`); App's `wsRow` adds
  `.ws-sub` (branch, `STATE_WORDS`, progress, PR, diff) for extended and cards, `.ws-last` (the agent's last answer)
  for cards; compact is CSS only. Extended and cards keep the ⋯'s place (`visibility`) and the marks on hover: rows as tall
  as their first line's marks would jump. `sideLook.icons` is `--ws-icon`, every row mark's size (avatar and GitHub's alike).
- **CSV** (`SidePanel.tsx` `CsvTable`, `text.ts` `csvSep`/`parseCsv`/`toCsv`): a `.csv`/`.tsv` preview's Table (or
  Raw, `laki.csv`); editing a cell rewrites the file through `toCsv` (`parseCsv`'s `quoted`, cell by cell: a quoted cell stays quoted, a
  new row's like the row above, a new column's like the cell before; LF only: FilePreview's save puts CRLF back), saved like the
  text edit. ```` ```mermaid ```` blocks: `MarkdownView.tsx` `Mermaid`, the `mermaid` package imported on first use
  (`securityLevel: strict`), each chart an `<img>` of its SVG (inline, a brainstorm's 50 were 18k nodes that every
  next chart laid out again), in `FONT` (an image has no web fonts), drawn once ui.tsx' `useNear` says it nears the
  screen, one at a time with a yield between (`turn`), kept by theme and text (`pics`, 200). `useNear` also holds back
  diagram.tsx' `DiagramView` (a React Flow each) until scrolled to; a prototype's frame is `loading="lazy"`.
- **`shared/markdown.ts`**: `markdown` (blocks) and `inline` (shared: a shared tab's page renders it too): a Markdown file as a tree (GitHub's common subset; `html`: GitHub's text and a repo's files, `fromHtml` reads its tags into the same tree, `<details>` a `details` block, unknown tags and code left as text; never for what people and agents say), which
  `MarkdownView.tsx`'s `Markdown` (and `Folded`: a few lines, Show more) renders as React nodes (code blocks through `highlight`; links open in the browser,
  images show as links: the preview fetches nothing). `FilePreview` switches Rendered / Raw (`laki.md`; a jump to a
  line opens Raw). Tested in `test/markdown.test.ts`.
- **Artifacts in Files** (`SidePanel.tsx` `Files` `root`, App's `filesRoot`): with a storage folder, Files has
  *Workspace* / *Artifacts* (`PanelApi.artifacts`: `artifactList` as the tree, the preview's `storage` (read-only,
  `openLabel` Open: App's `openArt`), a right click: Open, Show in Finder, Copy path; no new files). The status bar's
  *Artifacts: n* toggles `ArtifactsBar`; its ⋯ (`ArtifactsApi` `reveal('')`, `files`: `artifactsInFiles`) and the big
  view's buttons go to Finder or there. An HTML or Markdown one (`VIEWED`) opens in `ArtifactView` (panels.tsx, a
  `Modal`; App's `artView`) unless `settings.artifactsIn` is `browser` (Settings › General › Storage; then main's
  `open-path`, as any other): HTML in an iframe `sandbox="allow-scripts"` from the daemon's `GET
  /artifact/<the workspace's artKey>/<ws>/<path>` (main.ts `artifactPage`: core's `artifactFile`, the storage folder through
  `inside`, never a host's; a CSP `sandbox allow-scripts`, its own files and https: scripts, styles, fonts and pictures,
  `connect-src 'self'`: its JSON beside it, CORS null; 50 MB a file); *Open file* and the right click's *Open the file*
  (App's `asFile`, main's `open-file`: an HTML file inside the storage folder as `file://` in the browser, asked for), so the CSS, scripts and pictures beside it load; Markdown through `fileRead`;
  *Open in the browser* (App's `inBrowser`, the gallery's and the right click's too), *Show in Finder*. The gallery's big view frames HTML the same way (`ArtifactsApi.page`), and
  its right click has *Open* (the viewer) and *Open in the browser*.
- **`text.ts`**: `actionsFor` (Run ▾'s actions as it opens: `settings.actions`, then the project's `config.actions`,
  which replace a global one of the same name and target; an agent's only with a live tab of it (`any`: any
  agent's), the focused one first; a shell's to the focused shell at its prompt (`ActionTab` `busy`: a command in
  front, vim, a server, an agent it runs), any other at its prompt, or none: each app's `runAction` opens one),
  `SHELL_SPIN`, `shownStatus`, `spins` and `spinsUntil` (a shell's or Run tab's command spins its first 5 s only, then
  shows idle; an agent, and one a shell `runs`, its whole turn; App draws again as one crosses it, and `tabGlyph`,
  Glyph's `rollup`, the rail's dots and the filter's *Working* go by it), `parseMails` (a tunnel's who-gets-in: `@team.com` and `team.com` become `*@team.com`) and
  `MAIL_OK` (what the daemons take: kept in step with their `MAIL`/`mailRe`); prompt templates (`templated`, `fillTemplate`, from `shared/types.ts`: the daemon's `prPrompt` uses it too; `{{prompt}}`, `{{project}}`, `{{base}}`;
  `settings.templates` and a project's `config.templates`, merged by `templatesFor`: the project's first, replacing a
  global one of the same name; filled in by the new-workspace page; `nameOf`: a templated workspace's name from the typed
  prompt, the daemons' first-4-words rule) and `shortPath` (the ⋯'s *Copy path* hint).
- **`PromptInput.tsx`**: `useComplete` (@ a file, # a PR or issue, / a template; the box's `complete`, `completeOf(view, …)`:
  each kind read as its menu first opens, a minute; Esc keeps the word, a space or the caret out of it opens the next);
  a prompt with pasted/dropped images (saved by the daemon) and dictation (the mic's ⌄: where
  macOS picks the microphone and languages, `dictationSettings`); `tools`: the page's pickers at the toolbar's end;
  `saveFile` (`fileSave`; the new-workspace page's and the board's, never Laki AI's): any other file (HEIC, SVG too) a
  `FileChip` (icon, name, size, ✕; an `Img` without `url`), refused past `FILE_MAX` before it's read (the socket would
  drop); `files`: the caller's own (Desk's). A folder dropped in is its path typed at the cursor (`pathText`, Term.tsx's
  drop), never read (`webkitGetAsEntry`). `withImages` appends their paths (`text.ts` `withPaths`: a line each, in
  JSON's quotes when one has a space, a quote or a backslash). The mic keeps the text box focused and starts dictation 150 ms later: macOS
  learns the web view's text field a moment after focus, and dictation started before that stops at once.
- **`Info.tsx`**: the right panel's Info tab (`InfoTab`, App's `SidePanel` `info`; ⌘I and ⓘ open the panel on it): the
  workspace's name with a rename pencil (`.info-name`), then `.info-facts`: a card of one-line `Row`s, the whole value in `data-tip`, a
  copy button on hover, a row's `acts` beside it; the path and storage `shortPath`'d, `$PORT` opens `localhost`, each
  public link: `WsInfo.tunnels`, `onCopy`; *from* and *started*, the workspaces `from` ties (`onWs`: it selected), and
  *related* (`refLabel`: PR #n · repo; a PR's *Make it this workspace's PR*, `onPrimary`: `prAttach`; ✕, `onUnrelate`:
  `wsSet` `unrelate`; the PR shown below left out); the PR ⋯'s *Not this workspace's PR* for a linked one, `onDetach`: `prDetach`) and the status bar's PR (`PRStatus`, `AutoToggles`, `ciText`);
  each app maps its workspace to `WsInfo`. `PRSection` (Info's and Review's): title, a muted meta line, one row
  of Merge ▾ (`.split.green` when nothing `blocked` it: conflicts, failing or running checks, changes requested, `ready`
false), Approve, then GitHub and ⋯ (checks, files, *Close pull request…*) square at the end (neither Merge nor Approve:
  *Open on GitHub* and ⋯ first in the row), the
  body as `Folded` Markdown (MarkdownView.tsx's: 6 lines, Show more), `Checks` (failing, running, passing, skipped, each
  with `took`, the daemon's seconds, and its URL; a summary line), *Let the agent fix*: `AutoToggles` with `row`, a
  switch per row and *Send now* (`send`) only when there's something to send (failing checks, `threads` open, an
  older daemon's or Info's unknown, or conflicts).
- **`ui.tsx`**: line icons (`Icon`, `IconButton`), `Switch` (every on/off: the auto toggles, Settings' rows as
  `switch-row`), popup and right-click menus (`useMenu`: the open one is `MenuSlot`'s state, one element for good, so opening or closing
  draws the menu alone, never its caller (App); color swatches;
  each item has a key: its own `key` or a free initial, `menuKeys`; `sub`: a line under the label, `pill`/`tone`: a tag at
  its end, `mono`, `foot`: under a line at the bottom, its icon at the end; `tip`: its tooltip (Run ▾'s actions: their text); `items`: a submenu beside it (a hover, a click, → or ⏎; ← or Esc back), as the ⋯ menus' *Open in*; a picked item (`hint` `ON`) is in the accent
  with a check; `{ filter }`: a box on top, letters go to it, ⏎ runs the first label match (else the picked one), Esc
  clears it first, its `typed` an item for what's typed itself, first; such menus are `.menu.rich`; one flipped above its button is held by its bottom),
  tooltips (`Tips`: any element with `data-tip`; a pressed one shows none until the pointer leaves it, a menu it opens stays clear; `IconButton` `tip={false}`: an `aria-label` only), tab colors (`TAB_COLORS`, shared/types.ts' (the daemon checks a project's), `colorVar`: CSS `--tc-<name>`),
  `iconItems` (*Icon…*: every `ICONS` name by `iconWords`, an emoji typed or pasted, `emojiOf`; *Emoji…*: icons.ts `EMOJIS`,
  a menu item `{ emojis }` drawn as a grid its filter narrows, ⏎ the first; *No icon*: a Desk tab's, a
  project's), `ProjectMark`,
  sidebar rows dragged into a new order (`useRowDrag`, `moveId`; rows carry `data-row="kind:id"`), `Page`
  (a page over the main area, like Settings: the new-workspace form), and `ask` (a yes/no in the app's own dialog,
  `AskHost` in App: never `confirm()`, the OS's sheet; its keys stay in it (`stopImmediatePropagation`: not the page's Esc too), Esc or outside is no; a newer one covers it, `waiting`, and it comes back as that closes; `unchoose(tag, i)` closes one on screen or waiting).
- **`Project.tsx`**: a project's page (a click on its name in the sidebar, its ⋯ › *Open project page*; dialog
  `{ project, tab? }`: its ⋯ › Settings opens that tab, else the last one, `laki.projectTab`): Notes (panels.tsx' `NotesView`, also the ⋯ › Notes dialog's:
  an edit saved as it unmounts), Scheduled tasks (Schedules.tsx' rows, a switch each; changes on that page), Memory
  (`Project.memory`, `{ id, text, at, edited, auto, by }`, the whole list through `projectSet`: *Yours* and *Learned by
  agents*, `MEMORY_MAX` each, a learned one's pin keeps it as yours; never in MCP's state or `ls --json`; `MemoryList`, also Settings' Global memory with `global`: yours only) and Settings (SettingsProject.tsx' `ProjectSection`, `noNotes`). The sidebar's
  arrow folds; Terminals and Browsers have no page.
- **`Settings.tsx`**: the settings page (⌘,; its sections' parts in `SettingsKit.tsx` (`Says`, `Group`, `Scope`), `SettingsAgents.tsx` (AI, Voice, the skill and accounts), `SettingsProject.tsx` (a project's section and the fields the global ones share), `SettingsConnect.tsx` (phone pushes, remote access, simulators), `SettingsResources.tsx` and `SettingsExtensions.tsx`, which it re-exports), autosaved, zoomed by the terminal font size times `settings.pageZoom`
  (`PAGE_ZOOMS`, Appearance's *Settings & Help size*; ⌘± while it or Help is open; Help takes the same zoom; its
  preview cancels that); the nav's sections under a head each (`SECTIONS` `group`: Laki, Agents, Connect); each section's settings in
  `Group`s (a titled card, `.set-group`: a new block of settings goes in one, or a new one); `VarChips` under a
  template (`TEMPLATE_VARS`) and a preset's args or command (`ENV_VARS`) put a variable in at the cursor of the field
  just before them (in a `.preset` card, shown only while it has the focus); presets, `EnvField` (KEY=value lines), fonts,
  `termLook` (line height, weight, cursor… as xterm options; Term takes it as `look`), `termPad` (*Padding*: `.app[data-pad]`, the `.term`'s inset and the preview's padding; tiny on a phone too, roomy not) with a live preview
  (`TermPreview`, keyed on `transparent()` like `Term`), Actions (`ActionsField`, also in each project's section: a duplicate button, a *Show* filter by target), Appearance (themes, the current one outlined and checked, a name filter that stays in sight, a ☆ on each (`favThemes`: Favorites, a group first, each one still in All themes too);
  accent color and corners: `accent`, `radius` in `Paint`, set by `applyTheme` over the theme's and its look's (`radius`
  also as `--rs`, which every fixed px radius in look.css and styles.css takes first, `var(--rs, 10px)`: keep new ones so;
  pills (999px, or half their height: `.pr`, `.tag`, the switch's track) and circles (50%) stay),
  `--accent-fg` by `onAccent`; `tabsAt`;
  `PROJECT_LOOK`: the sidebar's project names over the theme, `settings.projectLook`, App's `phAttrs`/`phVars` put them
  on `.sidebar` as `data-ph-*` and `--ph-*`, styles.css overrides any look with `!important`; its `color` (`data-ph-color`,
  unset `auto`): `--accent-ink` in every theme but the looks whose head is a band of their own (starship, luna, mission,
  islander), `own` the project's color, `theme` none; `SIDE_LOOK`,
  `settings.sideLook`: the sidebar's lines and rows as CSS values, App's `sideVars` sets `--ws-guide`, `--proj-divider`,
  `--ws-indent`, `--ws-h`, `--ws-font` on `.sidebar`, nearer than the looks' own, set on `[data-look]` at the end of look.css;
  `sideLook.labels === false` hides the bottom buttons' words; interface font, glass: `paint` applies
  them at once, before the save), Prompt templates (`TemplatesField`: `settings.templates`, and each project's; the global sections, it and Actions, open with a `Scope` note, `.set-scope`: Global, everywhere, and where a project's own go; a project's two say *This project*: only there, with the global ones, counted (`mergeActions`, `templatesFor`), and a link to the global list), Keys (`KeysSection`: a `KeyField` per `KEYS` action, Reset all, `keyClash` against the global hotkeys and the picker as `others`; `settings.keys` only the changed ones), Remote access (`RemoteSection`, shown when App.tsx
  passes `remote`: the email, 1h…72h or Forever, then the QR code and link), and `ScriptsField` (a project's
  setup/teardown/run scripts, Import from a file), Resources (`ResourcesSection`: `resources` every 3 s while open,
  Laki itself and each tab by RSS with its processes, Sleep/Open/Wake, `settings.sleepAfter`; App.tsx passes a
  `ResourcesApi`), Pull requests (`PR_KINDS`: the PR switches' prompts over `PR_PROMPTS`,
  each with Reset; `prScan`, `prTries`), and General's Export/Import (`laki-settings.json`: `{ laki:
  'settings', version: 1, settings }`; text.ts `exportable` leaves `PRIVATE` out (env, webhook, remoteMail, tunnelMails,
  flowVars, presets' env) and `importable` never takes them; an import goes through `paint`, so it's painted and autosaved like typing, after
  `KINDS` refuses a field of the wrong kind: add a new list, object or number setting there). *Find a setting* (`FIND`: section, the title as the page writes it, more
  words; add new settings there) opens a section and lights (`.spot`) the first label, row or heading that starts with
  the title. Settings' `spot` (App's dialog `{ settings, spot }`: Run ▾'s *Edit the run script…* → Scripts, *Edit actions…* → Actions)
  opens at that `Group`'s card, lit the same way (a ring, a halo and a tint, 2.6 s). Hovering a theme paints it (`applyTheme`), the chosen one again as the mouse leaves `.themes` or the page closes. A
  setting back at its default is saved as that value: an unset key wouldn't replace the saved one. Projects
  are sections of it, under the nav's *Project settings* head (`ProjectSection`: name, a Memory row (its counts;
  *Manage*: `onMemory`, App's `{ project, tab: 'memory' }`), scripts, env; saved 400 ms after typing and on leaving).
  Global memory (`memory`: `settings.memory` through Project.tsx' `MemoryList` `global`); Release notes only with
  `devMode`; General's Storage has `artifactsIn`, its Pages My Desk, Bird view, Specs & Brainstorms and Workflows (on unless false), Settings › AI the glow's; Appearance's
  Rail `railShells` and `railBrowsers`.
- **`SidePanel.tsx`**: the right panel (⌥⌘B): Info (`PanelTab` `info`, first, any project: App passes `InfoTab` as
  `info`), Files (tree from the daemon's file list, search, new
  file/folder, changed files marked), Changes (the diff by file, each file's row sticky over its diff as it scrolls, Expand all / Collapse all (one button: collapse while any is open), each line with its old and new numbers from the
  hunks; a click opens `CommentBox`: the PR, or the agent; an image, `IMAGE`, is `ImageDiff`: `PanelApi.read` with `base`
  for before, as `<img>`, SVG too, a click for full size), Review (`PRSection` from `Info.tsx` with the open
  threads' count; `ThreadCard`s: file:line, a click previews it there, each comment's author, `ago` of its `at` and its
  body as `Folded` Markdown; resolved ones in a `<details>`; a ```` ```suggestion ```` block (`text.ts` `suggestionOf`: 3+
  backticks or tildes, the first one) as `Suggested`, a small diff of the file's lines now (`linesAt`, `PanelApi.read`
  per file with one) and the suggested ones, with Apply (`editOf`: an open thread, not outdated, `side` RIGHT, `hunk`
  given; what the review saw is `reviewedLines`, the hunk's new-side lines ending at `line`, `startLine..line` long) and
  *Apply all n in <file>* (each open thread's newest, those still as seen): App's `PanelApi.apply`, `fileRead`, then
  `applySuggestions` (bottom-up; refused as "changed since the review" unless each range is what was seen, overlaps
  refused; the replaced lines' endings, the file's last newline as it was), `fileWrite` with `was`, a toast whose Undo
  writes it back the same way; no commit, push or resolve. Tested in `test/suggest.test.ts`), Preview (above; a narrow panel shows the other tabs as icons, a container query); `FilePreview` (a click in Files, or a thread's line; App keeps several, `openFiles`, a tab each over it, `.pv-tabs`,
  by `fileKey`, each with its own `edit`; `shownFile`: each workspace's in front; ⌘W or a middle click closes one, an
  edit asked first; its left edge is a `PanelHandle`, `previewW`), `FileFinder` (⌘P, `findFiles`: a
  basename match first); a right click in Files is App's `fileMenu` (`PanelApi.menu`: default app, browsers for `WEB` files, Open in, Copy path); `RunButton` and `actionMenu` (Run ▾'s Agent and Shell actions, each item's `tip` its text, cut at `ACTION_TIP`; App's `runMenu(w)`, the toolbar's and a sidebar row's *Run ›*). App.tsx passes a `PanelApi` over the daemon.
- **`Tunnel.tsx`**: Expose to the world: the status bar's globe next to each port (`TunnelButton`) and its
  popup: install instructions when cloudflared is missing, who can open it (anyone with the link, the default,
  or only some emails and `*@domain`s), then a QR code and the link; with emails, chips of who gets in, the bad ones flagged, a webmail domain too (`text.ts` `webmail`: anyone can get an address there, a warning line); *Anyone with the link* says localhost-trusting dev tools are reachable. `portsOf`: listening ports plus tunneled ones. App.tsx passes a `TunnelApi`. `QR`: a code
  as SVG, also Remote access's. `SharePop`: Share a tab's popover (for how long, `SHARE_FOR`; then the QR code, the
  link, `timeLeft`, Stop sharing).
- **`Shown.tsx`**: a workflow's Show you window (`ShownDialog`, App's `shown` queue): HTML in a sandboxed `srcDoc`
  frame with a CSP and the app's colors, else Markdown; Close or Next, the run's button.
- **`Compare.tsx`**: a race's page (`Page` `wide`; dialog `{ compare: <race> }`: a race workspace's menu, ⌘K, and
  right after the new-workspace page's *Race* makes one): a column per live workspace of the race with its status,
  diff size, the agent's last answer and the files `diff` lists (again as `stat` moves); *Keep this one* archives
  the others (`wsArchive`, after a confirm) with *Undo* (`wsRestore`). App.tsx passes a `CompareApi`.
- **Laki AI's glow** (`settings.aiGlow`, on unless false, Settings › AI): Laki AI's looks (`shared/tools.ts`' `aiRpc`: its tools' `screen` and
  `browse` with `by: 'ai'`; the OpenRouter backend's `toolsFor`, the claude/codex one's `laki mcp` with `LAKI_AI=1`; the
  chat's `whereNow` screen too) make core's `screen`/`browse` broadcast `peek` (ws, tab). App's `PeekGlow`: over that
  tab's `[data-pane]` when shown, else the window (`.ai-peek`, a conic `--peek-a` edge turning once and inset shadows,
  2.6 s, its own `animationend` clears it); none while `html.away`.
- **`Calendar.tsx`**: Calendar (`settings.calendar`, on unless false; the rail's Calendar after Flows, ⌘K; dialog
  `'calendar'`): a week (Monday first) or a month (`laki.calendar`), scheduled tasks' times to come (`occurrences`: a rule
  with more than `MANY` a day is one line; a once task its `next`), the runs' log in the past, reminders (a tick: done,
  a click: its workspace, ✕ on hover); a day's click or *Reminder* opens the form (`datetime-local`, a workspace). The
  rail's count: rung reminders not ticked off. `Page` `esc={false}`; `.cal-bar` on the page (‹ *Today* ›, the title,
  Week / Month, *+ Reminder*); a day's click: `sel`, `aside.cal-side` (that day's tasks, runs and reminders, *Remind me
  this day*). App.tsx passes a `CalendarApi`.
- **`Desk.tsx`**: My Desk (the user's word; the code's is Desk: `settings.desk`, on unless false (Settings › General › Pages); the rail's My Desk, ⌘K; dialog `'desk'`): the extensions with `desk`
  among their `places` as tiles in a 12-column grid (`DESK_COLS`, rows `DESK_ROW`), `settings.deskTiles` their order and
  sizes (`SETTINGS_KEPT`; one placed here without one: `DESK_TILE`, last), and tabs: `settings.deskTabs` (`DeskTab`,
  `SETTINGS_KEPT`; none: one, `MAIN`), a tile's `tab` (none, or a tab gone: the first), the one shown `laki.deskTab`;
  the tab bar (`.desk-tabs`, shown once there's a tile or a tab): + (`addTab`, its name typed at once), a double-click
  renames, a right click (`tabMenu`) moves it, removes it (its tiles to the first of the others, under the tiles there, in one `save`) or gives it
  an icon (`DeskTab.icon`, before its name: an `ICONS` name, or an emoji typed or pasted in the filter, `emojiOf`, its
  `typed` item *Use 🚀*; ui.tsx' `iconItems`: *Icon…*, a submenu, `setIcon`; *No icon*) or a color (`DeskTab.color`, `TAB_COLORS`,
  `setColor`: its icon in it, else `.desk-dot`), a
  head dropped on a tab moves the tile there (`moveTo`: no cell, so under the tiles there), a tile's ⋯ › *Move to tab*
  too (or *A new tab*); Add puts one on the tab shown; *Fetch* only that tab's. Cells: a tile's `x`, `y` (`shared/types.ts`
  `deskLayout`: the one dragged or resized first, then the placed ones top to bottom, each pushed down past any it
  overlaps, then the unplaced as CSS grid's sparse flow would, under the placed ones: a gap left stays; Desk's `at` pins
  the tab's tiles where they are before one moves, so a tab never arranged keeps its flow); the head's pointer drag
  (`move`, 4 px, `track`: capture, blur, edge scroll, Esc back where it was; none on a phone's one column, `.narrow`) to the cell under it,
  onto a `[data-desk-tab]`: that tab; every tile of the tab saved in its cell after (`keep`, through `ends`: the tiles
  as they are at the drag's end); rendered in the saved order, placed by `grid-column`/`grid-row`, `order` for a phone's
  one column; the corner resizes it (pointer, snapped to cells; it ends at `lostpointercapture`, which a
  release, a cancel and a release the page never got (outside the window, over its title bar: Chromium drops the
  capture at the next move, no pointerup) all bring, or the window's blur or Esc: the size kept; on a phone, its height only); a tile shows the full view when there is
  one (`WidgetBody` `full`), else the preview; Add: the others, turned on with `desk` added; *Take it off*: its only
  place goes to `side`, off. Laki AI's off ones placed here show too (`byAi`), dashed, with their sample and
  `.desk-off` (*Look*: its page, *Turn on*). *Build with AI* (`DeskBuild`, a `Modal`: `PromptInput` with `files`, text files
  inlined by `deskAsk` (`FILE_MAX`), a screenshot through main's `shoot` IPC (`screenshot` with `then`); `DeskApi.build`:
  App's `{ extension: '', back: 'desk', start }`, the page's `Chat` sends `start` once (`started`), back in the box
  if it fails); `whereNow` names the Desk's tiles by id. `pending`
  (and `pendingTabs`): the tiles and tabs just saved (`DeskApi.save`, one `settingsSet`), shown until the settings
  bring them back.
- **`Picker.tsx`**: development mode's element picker (the rail's *Pick*, `data-rail="picker"`, else the side head's
  crosshair beside Help; `settings.pickerKey`, unset: `PICKER_KEY` ⇧⌘C, '' none, App's capture-phase keys (`keyLabel`)
  before everything, so over dialogs too; Settings' `KeyField` records it; `settings.devMode`): a
  shield over the window (`.picker-shield`: frames, webviews and hovers get no pointer; `elementsFromPoint` under it),
  capture-phase listeners (`html.picking`), a box over the element under the pointer with its component and size;
  a click: `inspect` (`selectorOf`, `componentsOf`: React's fiber on the node, classes, attributes, text, box, styles,
  HTML), main's `capture-rect` (the app window's pixels there, after two frames without the box) saved by `imageSave`;
  the dialog (`.overlay:has(.picked)`: over a page too, the Desk's, Settings') with *Copy the context* (`pickedText`,
  Markdown) and *Copy the screenshot* (`copyFile`); the press's own mouseup and click are swallowed too (`swallow`: they'd
  click what was picked). Esc or a right click stops.
- **`Bird.tsx`**: Bird view (`settings.birdView`, on unless false (Settings › General › Pages); the side head's eye beside Help, ⌘K; dialog `'bird'`):
  every live tab (not exited) of each live workspace, Browsers' left out, by workspace in project order, a card each
  with the daemon's `screen` (40 lines, every 2.5 s while open and the page is visible; a `<pre>` whose newest lines
  show), *All* / *Working* / *Needs you* (App's `needsYou`); a click is `selectTab`. App.tsx passes a `BirdApi`.
- **`Achievements.tsx`** (dialog `'achievements'`: the status bar's trophy at its end, `.sb-trophy`, ⌘K,
  Settings › Achievements' *Open achievements*, `laki://achievements`): `shared/achievements.ts`' 54 (`ACHIEVEMENTS`, in
  `ACH_GROUPS`), each with its `how` and `go` (App's `achGo`: a page, Settings' section, the right panel's tab; an
  experimental page that's off: where it's turned on). App's `earn` unlocks one once, only for what's done from now on: a
  call that went well (api.ts `onCall`, `earnedBy`: its `rpc` and `ok`; a `{ held }` or `{ dirty }` answer isn't), a page
  opened (`pageEarns`), a number or value of the view that moved since the last view (`upsOf`/`wentUp`; the first view,
  and the first after a reconnect, only notes them; a value back to unset isn't), or by id (⌘J, timers, the sidebar's
  filter, Changes or the Simulator once it wasn't on screen, a line's comment, a profile: Settings' save with more
  presets than in use, Settings' Resources and Simulators sections, a video played; main's `earn` IPC, preload's `onEarn`:
  the global hotkey, a bubble's click);
  a hidden one never. Kept in `settings.achievements` (`AchievementsKept`: `got`, `hidden`,
  `off`; `SETTINGS_KEPT`), written whole by App (`achSet`; `sent`, shown and built on until the view has it); Settings' own save leaves it out, so an
  unlock while it's open stays. The unlock toast (`.ach-toast`, over pages) groups one action's unlocks. Tested in
  `test/achievements.test.ts`.
- **`Board.tsx`**: the Board page (`Page` `wide`; the rail's Board or the status bar's columns icon, ⌘K, `laki://board`): the
  workspaces (not Terminals' or Browsers') in columns by `columnOf` (`rollup` from `Glyph.tsx`, then the PR's state), cards that open one (a right
  click or `.board-more`: `BoardApi.menu`, App's open, archive, delete; Merged's ⋯: `archiveAll`, one by one), and To
  do (`view.todos`): ▷ or an HTML5 drag onto a column runs `wsNew` with the default agent, then `todoRm`.
- **`Schedules.tsx`**: the Scheduled tasks page (ui.tsx's `Page`; the rail's Schedule or the status bar's clock, ⌘K, a project's ⋯ menu:
  App's `schedulesOf`, the dialog `{ schedules: <project> }`): `.sched-hero` (icon, what it is, filter, New task),
  `.sched-stats` (tasks, on, the next run `soon`, runs ok), a project filter (`only`, starting at `project`, a chip's menu), the form (the
  new-workspace page's `.nw-composer` with the agent's `.nw-pick`, a When field (`.sched-when`; `EXAMPLES` until
  `parseWhen` reads it, then its reading and the next runs), and `.nw-chip`s: project (*Another folder…*: `pick`, the
  folder picker, or a typed path in a browser, then `projectAdd`), where (`WHERE`, or a workspace) and name; the dated
  names), the tasks (`.sched-list`, a row each: its where's icon, name, the rule and a `.sched-next` pill, tags for project,
  agent and where; ▷ and delete on hover; its switch last), the runs' log (`RUNS`, a round mark, `ago`, then
  *Show all*; a click goes to the run's workspace). App.tsx passes a `SchedulesApi`; the clock has a dot (`.ib.dot`) when a run failed after
  `laki.runsSeen` (localStorage: the newest run the page showed).
- **`Usage.tsx`**: the status bar's first item, the plan-limits ring (in the theme's `--accent`, then `--waiting` and `--error`; `UsageButton`: each agent's first window, the shortest: 5-hour; the busier agent's, asked
  every minute; hidden while the daemon has none) and its popup: each agent's windows, bars, when they reset, then
  *Today* (the view's `today`: Meters, above).
  `USAGE_AGENTS` names the agents Settings › Appearance has switches for.
- **`Help.tsx`**: the help page (⌘/, the sidebar's ?, ⌘K): keys (`keysOf`: Settings › Keys' in use, App's `kb`), status glyphs, where things are, the main CLI
  commands and recipes (`cli`: the app's command; `ship`: list `ship`), each section a `Sec` of `Item`s. Laid out
  like Settings (`.settings-nav`, `.help-nav`): a filter (focused as it opens, not on a touch screen; ⌘F or / goes to
  it; Esc clears it, then closes the page) keeps the rows with every word typed in their text (`textOf`) or `find`;
  the sections, the one in view lit (a scroll listener: the last whose top passed, the last at the bottom) with its
  named rows under it (chips on a phone); *The full guide* (`GUIDE`, from panels.tsx' `REPO`). Sections and named
  rows have stable ids, `help-<id>`, for a `laki://help#<id>` later. Keep it in step with the guide's keys and CLI
  recipes.
- **`qr.ts`**: a QR encoder (byte mode, level M, versions 1–40, best mask), for the tunnel's link. Its test
  compares a code with macOS CoreImage's (`test/qr.test.ts`).
- **`panels.tsx`**: the new-workspace page (ui.tsx's `Page`: over the main area, like Settings), laid out as paseo's:
  `.nw-top`, a row of `.nw-pick` menus over the prompt: project and `place` in one menu (each sep indented under its
  project: `MenuItem` `indent`), *New worktree* / *Local* (`whereMenu`: `local`), base (`.nw-base`, typed or picked), name,
  and *More* (a race, and a typed model only after the model menu's *Another model…* or while one it doesn't list is set:
  one picker, not two); at its end (`.nw-top-end`) template and agent (`OTHER_AGENTS` after the presets; each preset's
  line `presetSays`, Settings' default agent as a pill, *Make … the default* in the foot: `settingsSet` `agent`). Then
  the prompt's card (`PromptInput` `lead`: model (`MODEL_SAYS`: claude's words and a cost pill), effort and permission
  mode (`PERMS`) menus; `tools`: ⚡ `.nw-fast` (`FAST`); then the mic and `send`, the round `.nw-send` (a race's count
  on it)); `.nw-foot` under it (the keys, *Clear*);
  the last choices, `laki.newWs`; `images`: the menu bar's screenshots; while it's made, `.busy` fades the cards and
  `.nw-making` says what's happening and the seconds so far), the palette,
  prompt and add-project dialogs (the last only for the web dev renderer, which has no folder picker), and About
  (`SITE`, the version from `package.json`, the build's time: `__BUILT__`, electron.vite.config.ts' `define`, none
  under `dev:web`; *Open-source licenses*: the build's notices through main's `open-path`, else the summary on GitHub;
  the app menu's *About Laki* is a `laki://about` link, main's `openLink`);
  `Ready` (a workspace without tabs: its starts, `TIPS`) and `StarLaki` (the repo, `REPO`); `Fun` (the status bar's
  smiley: `meme`, Next; a right click on it: copy (a PNG drawn on a canvas, the clipboard takes no other),
  download through an `<a download>`, open on Reddit). A PR's branch is `laki new --pr` (the CLI): the page has no PR field.
- **`links.ts`**: `parseLink` and `wsLink` (laki:// links, above).
- **`api.ts`**: the WebSocket client. In Electron the address comes from the preload bridge; in a browser,
  from the URL hash.

Laki was built twice while the stack was picked; the Go + Wails build is now its own repository
and nothing here keeps it in step. Many renderer files were
shared with it: some class and variable names in `look.css` and `themes.ts` are its, and harmless here.

## Files

| file | what |
|---|---|
| `src/main/index.ts` | Electron main (every IPC handler checks its sender: `fromApp`, the token's; `from(e, …pages)`: the app window, else only the pages named, `new`, `ai`, `tab` by `?window=`, `voice` the bubbles'; the bubbles', the editor's and a floated tab's own by their window): single instance, starts the daemon, window (where it was left: `window.json` in userData, `winAt`, bounds, maximized, full screen; else maximized; hiddenInset title bar; traffic lights centered in the 38px header; `glass` IPC: vibrancy and a clear background), menu (with *Quit Laki Completely*: `shutdown`, asking first when an agent is running; File, Edit, View and Go list the renderer's ⌘ keys: `key()`, `registerAccelerator: false`, a click sends `browser-key`; Settings › Keys' through `bound()`, its keys from `keysNow`, the `keys` IPC's (`from(e)`: the app window; `keyMap` checks them; `appMenu` builds it again), a click sends its id; a Browsers page's `before-input-event` takes `newTab`/`closeTab`'s keys by `keyFor`), notifications (with their sound; Allow/Deny actions call `answer`), the agent browser (`browse` IPC: a hidden window per workspace), the Dock badge and menu bar item (`badge` IPC: `Tray`; its *Screenshot … to an agent*: `screenshot`, macOS's `screencapture` `-i` or `-m` (the bubbles hidden meanwhile: `shooting`), then `annotate`'s editor window, sent as `shot` (png, note) once the renderer says `shot-ready`), the floating bubbles (`floats` IPC: `placeFloater`, floater.html's bar and the card, menu and voice windows it opens; `floater-act`, `voice-send`), `pick-folder` IPC, `open-external` (http(s) and mailto only), laki:// links, the preview's webview guard and `capture` |
| `src/main/update.ts` | the app's updates: GitHub's latest release, Squirrel.Mac's download and install (Updates, above) |
| `src/shared/update.ts` | updates' pure parts: `newer`, `releaseOf`, `feedOf`, `RELEASES` |
| `src/preload/index.ts` | `bridge`: conn info, notify, glass, badge, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab, onBrowserTab, onBrowserKey (⌘W/⌘T from a Browsers page), dictate (`startDictation:` to the first responder), dictationSettings, onDeepLink, onShot (the menu bar's screenshot, drawn on, and its note), annotate (the editor window's), floats and floater (the floating bubbles' list and options; their windows': the bar, the card, the + menu, the voice prompt), onNewPrompt and fitNew (the new-workspace window's), shotKey and onAiShot (Screenshot to Laki AI's keys; the AI window's picture), capture, browse |
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, `GET /artifact/…` (the artifacts viewer), shutdown |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, run, ship, archive/fork, view; it re-exports the modules below, so `core.X` reaches them (main.ts' `api`); no module in the cycle reads another's const or let as it loads, so any of them can load first (`test/load-order.test.ts`), and the data folder, `dir`, is `dir.ts`', out of the cycle |
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
