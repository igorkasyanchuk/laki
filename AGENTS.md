# AGENTS.md

Notes for coding agents working on **Laki** (CLI `laki`): how the code works and how to change it
safely. User-facing docs: `README.md` (the short version: features, install, quick start) and `docs/guide.md` (the
full guide); the product, in `requirements/`. Laki is a successor to wb
(`~/projects/specdrop-cli`, tmux + iTerm). That repo is read-only from here; ideas and code are ported
from it (limits, hooks).

## Build, test, run

```bash
npm install
npm run typecheck                 # tsc --noEmit
npm test                          # node:test, ~25s
npm run pack                      # electron-vite build + electron-builder --dir → dist/mac-arm64/Laki.app (Intel: dist/mac)
npm run pack:x64                  # the Intel app from an Apple silicon Mac → dist/mac/Laki.app
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
  window screenshot); `APP=$PWD/dist/mac/Laki.app` checks the Intel build (under Rosetta here). `scripts/mem.sh` measures RSS with 3 workspaces × 2 tabs.
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
4: `usage`; 5: remote access; 6: scheduled tasks, remote access forever; 7: `prComment`, `muted`; 8: a project's
`templates`, kept by `projectSet`; 9: browsers in `apps`, `openIn` `default`; 10: `send` `enter: false`; 11: a tab's `runAt`, `model` and `effort`, the
board's `todoAdd`/`todoRm`; 12: `doctor`, `wsArchive` `ifClean`, a workspace's `stat`; 13: a tab's `ask`, `answer`,
`unread`, `wsFan` and a workspace's `race`, `wsNew` `issue`, `browse`/`browseDone`; 14: settings' `prPrompts`, `prScan`,
`prTries`, which the PR switches' tooltips quote). A
setting the renderer adds needs no bump: `settingsSet` keeps any field.

- state: `ping`, `state`, `hook`, `watchLimits`, `shutdown`, `settingsSet` (merged into `state.settings`), `apps` (installed apps a folder can open in, `APPS`, and browsers, `BROWSERS`, flagged `browser`: only for a file), `openIn` (an app id, `editor`: the one in Settings, or `default`: macOS's for the file; with a `file`, Finder reveals it and a terminal opens its folder);
- projects and workspaces: `projectAdd`/`projectRm`, `projectSet` (name, config), `reorder` (projects or workspaces by id), `wsSet` (color, `muted`), `projectFile` (the repo's `.laki.json`), `branches`, `wsNew`/`wsRm`/`wsArchive`/`wsRestore`/`wsFork`;
- the board's to-dos (`state.todos`, `view.todos`; a project's go with it): `todoAdd` (`project`, `text`), `todoRm`;
- `wsArchive` `ifClean`: archives only with nothing uncommitted (the worktree goes, and that with it), else returns `{ dirty }`;
  `doctor` (the first-run screen's: git, `gh auth status`, which agents are on PATH);
- tabs and agents: `tabNew`/`tabClose`, `tabSet` (name, color, `muted`), `send` (`enter: false`: into the prompt, no Enter, escapes dropped; refused while the agent asks something), `queueClear`;
  `answer` (`tab`, `n` or `pick` first/last: a waiting agent's menu, below), `unread` (its ● again: `done`, until a look clears it);
- a race (`wsFan`: the `NewWs` fields and 2–6 `presets`, agents only, worktrees only): `wsNew` per preset, one after
  another, named `<name>-<preset>`, sharing a random `race` id (the sidebar's flag; the renderer's `Compare.tsx`);
- an issue (`wsNew`/`wsFan` `issue`: a URL or number): `fromIssue` runs `gh issue view <ref> --json number,title,body,url`
  in the project; the prompt is "Work on GitHub issue #n: title", the URL, the body (8,000 characters at most) and the
  prompt given, the name `issue-<n>-<slug>`; the workspace keeps `issue`;
- expose to the world: `cloudflared` (its version, none when missing; the default emails; with `ws`, its project's
  `expose`: what the popup starts from), `tunnelStart`
  (`ws`, `port`, `mails`: resolves with the URL), `tunnelStop`;
- worktree actions: `diff`, `run`, `ship`; the side panel's: `files`, `fileNew`, `fileRead` (text up to 512 KB, an image as a data URL, or binary: size only), `prThreads`, `prComment` (`path`,
  `line`, `side` LEFT/RIGHT, `body`: `gh api …/pulls/<n>/comments` at the PR's head commit; a 422 is "not in the
  PR's diff"), `imageSave` (the preview's screenshots too), `openIn` with a `file` (paths must stay inside the
  workspace: `inside`);
- the agent skill (Settings): `skills` (each with `mcp`: the agent's `mcp add` command, shown, never run; for
  opencode, whose `mcp add` only asks questions, the JSON for `mcpIn`, its config file), `skillSet` with an `agent`
  (claude, codex, gemini, grok, opencode: `skill.ts` `AGENTS`, each one's home and `mcp add`) and `on`;
- scheduled tasks: `scheduleSet` (makes one, or changes one by `id`: name, project, preset, ws, prompt, when, on;
  a new one without ws or preset gets `new`, or `local` without git, and the default agent), `scheduleRm`,
  `scheduleRun` (now), `scheduleTick` (`now`: tests move the clock); the CLI's `laki schedule`;
- plan limits: `usage`; remote access: `remoteStart` (`hours`, `mail`: resolves once there's a link),
  `remoteStop`, `remoteTick` (`now`: tests move the clock);
- terminals: `screen`, `input`, `resize`, `view`, `detach`;
- the agent browser: `browse` (`ws`, `op`: open, screenshot, click, fill, text; `url` (a path: the workspace's
  `$PORT`; localhost only), `selector`, `text`) goes to the newest client whose `view` says `browse` as a `browse`
  event (`req`: its id; an `id` would make it a reply), and waits up to 30 s for its `browseDone` (`id`, `ok`, `result` or `error`); a screenshot's PNG is saved
  (`imageSave`) and its path returned. The CLI's `laki browser`, MCP's `laki_browser`.

WebSocket events:
- `state`: the whole view, debounced 30 ms;
- `data` and `responder`: per tab;
- `turn`: waiting, done or limit, for notifications;
- `browse`: an agent browser op, for the app (above);
- `open` / `close`: the connection's own status.

`view` carries `tab` (the pane with the keyboard), `tabs` (every pane on screen), `focused` and `browse` (the app's
window: it can run the agent browser). Tabs on screen in a focused window get no ● (`viewed`/`setView` in `core.ts`).

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

The other agents (`AGENTS` in `shared/types.ts`: the command is the id; `presets()` defaults to claude, codex and
those on PATH):
- **Gemini**: `gemini -i <prompt>` (0.4.1 answers a bare prompt and exits), `--resume <id>`. Hooks (versions that
  have them, in a folder Gemini trusts) in `<data>/gemini-settings.json`, given as `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`
  (the lowest layer; hook lists add up with the user's): SessionStart (session_id), BeforeAgent/AfterTool (running),
  Notification (waiting), AfterAgent (idle, `prompt_response`); each prints `{}` (gemini wants JSON back). Superset
  puts the same hooks in `~/.gemini/settings.json`; Laki may not. Laki doesn't trust folders for it.
- **OpenCode**: `opencode --prompt <p>`, `--session <id>`. `OPENCODE_CONFIG_DIR=<data>/opencode` (on top of the
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
no branches, diff, PRs or ship). `config` (setup, run, teardown, expose), set in the app, wins field by field over
the repo's `.laki.json` (`projectConfig`).

### Presets

`settings.presets` (default: plain `claude` and `codex`) say how agents start: `agent` (claude, codex,
command), `args` (appended raw before the prompt), `cmd`, `env`. A tab keeps `preset` = what the agent is
(hooks, resume, colors) and `profile` = the preset's name, looked up at every start (`presetOf`), so edits
apply on restart. Env order: process < `settings.env` (global) < project (`.laki.json`, then the app's) <
preset < Laki's own vars.

A tab's `model` and `effort` (`wsNew`, `tabNew`, kept by `wsFork`; `modelCheck` before a worktree is made: a name, an
effort of `EFFORTS`) become flags at every start (`agentCmd`): claude `--model`/`--effort`, codex `-m` and `-c
model_reasoning_effort="…"`, the others `-m`. `view` gives a running or waiting tab `runAt`, its turn's start (set
there: each change of status comes with `changed()`), for the turn timers (`settings.timers`).

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

- Ports: the `ps` process tree of each workspace's tabs, matched against `lsof -iTCP -sTCP:LISTEN`, every 5s. First,
  `syncBranches`: each workspace's `branch` follows its folder's HEAD (`headOf` reads the file, no git run; detached
  stays), so an agent's `git checkout -b` moves the PR lookup, status bar, ship and restore with it, and scans PRs now.
  A turn's end scans PRs 2 s later too (`prSoon`, at most every 20 s): `gh pr create` shows up without the minute's wait.
- Diff size (`scanStats`, every 10 s, `LAKI_STAT_SCAN_MS`; with `settings.diffStat === true`, off by default, and a race's
  always, for Compare): each live git
  workspace's `git diff --numstat` against `diff`'s base, new files' lines (the first 100, up to 1 MB) and `git status`'s
  count as `stat` (`WorkspaceView.stat`: add, del, files, dirty); one scan at a time.
- PRs: `gh pr view <branch> --json …` (`PR_FIELDS`: title, author, checks list, head commit, base
  branch, review decision, mergeable: `PR.conflict`, the sidebar's ⚠, size, body), every `settings.prScan` minutes
  (`PR_SCAN`, 1; `prTick`, each minute; `LAKI_PR_SCAN_MS`: tests' pace instead); one scan at a time (`scanPRs`), so `autoPR` never sends twice.
- `autoPR` (workspace `autoFix` / `autoReview` / `autoMerge`, ported from wb's `review.go`): failing CI on a new head
  commit → `prFix('ci')` (`gh pr checks`, `gh run view --job <id> --log-failed`), at most `settings.prTries` in a row
  (`PR_TRIES`, 3), then status waiting and a notification (`overToYou`, once, as the count goes over); conflicts on a new head commit →
  `prFix('conflict')` (merge the base in, push), `fix.merge`/`fix.merges`, the same tries (mergeable UNKNOWN, as after a
  push, keeps the count); `wsSet` turning a switch on again gives its tries back at the next scan (`retry`: a scan under way
  would write its copy of `ws.fix` over a reset made then). New review threads → `reviewMessage`
  (GraphQL `reviewThreads`; `reviewKey` counts yours too, but not the agent's: it comments as you, so yours made while a
  tab of the workspace was running, `busy`/`agentSaid` from `changed()`, ±`SKEW`, are its, their ids kept as `fix.mine`).
  What was sent is `workspace.fix`.
  Messages go to the first live claude/codex tab with `send({ whenIdle })`. Each starts with `prPrompt`: the
  `settings.prPrompts` text for ci, review or conflict, else `PR_PROMPTS` (`shared/types.ts`), `{{pr}}`, `{{url}}`,
  `{{base}}` filled in; the checks' logs or the threads follow. The info panel's send buttons use the same.
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
`*@domain`; kept as `settings.remoteMail`), for `REMOTE_HOURS` (1, 2, 4, 8, 24, or 0: forever, no `until`). Each start makes a
`remoteToken`; `remoteView` (`view.remote`) gives the link, `<url>/?token=<token>` (a query: Cloudflare's email sign-in drops a
hash), which the renderer (`api.ts`: no port) uses on the page's own origin. While it runs, `main.ts` takes that token as
well as its own and the tunnel's URL as an Origin; `remoteStop` drops both, so an old link is dead. It ends by
`remoteStop`, at `until` (`remoteTick`, every 15 s), when cloudflared exits, or at shutdown.

`main.ts` `page`: any GET serves a file of the built renderer (`out/renderer`, or `LAKI_PAGE`) whatever the
Origin: the files hold no secrets. Paths that leave the folder, or don't decode, are 404. The CSP's
`connect-src 'self'` lets the page reach its own daemon over `wss://`.

### Scheduled tasks

`core.ts` `scheduleSet`, `scheduleTick` (every 30 s), `runSchedule`; the rule comes from `shared/when.ts` `parseWhen`
(a line of English to days of the week and minutes after midnight, in the Mac's time zone; `once` for
`once`/`tomorrow`), kept with the text so "tomorrow" means the day it was saved; `nextRun` gives `next`; `stamp` fills `{{DD-MM-YY}}`-style
dates (only braces of date tokens) in the name and prompt with the run's time. A run (ws) makes a new workspace
(`new`: `wsNew` with the preset and prompt; `wsTitle` names it, with the id's random tail when another workspace has that name; the task's `schedule` id marks
it: the sidebar's clock),
or a new session in the project's own folder (`local-new`: `wsNew` `local` + `another`, a local workspace beside the one
it has, so each run is a sidebar row), or uses that folder (`local`: its local workspace, made by the first run) or a workspace
(its id); in those last two, the prompt goes to the
workspace's running agent of that preset (`send` whenIdle), else a new tab with it. Every run, or a missed one (more
than `MISSED_AFTER`, 30 minutes, late: skipped), goes to `state.runs` (the last 200; the view has 50). A tick moves
every due task on before it runs any, so a slow worktree isn't started twice. Removing a project removes its tasks; a
gone or archived workspace is a failed run.

### MCP

`src/cli/mcp.ts`, `laki mcp`: JSON-RPC 2.0 over stdio, a message per line (`initialize` echoes the client's
protocol version; `tools/list`, `tools/call`, `ping`; notifications get no answer, other methods -32601). Each tool is
one or two `rpc` calls; none deletes, archives or ships. stdout is the protocol's, so the daemon starts at the first
tool call (`ensureDaemon`), never before. Tested in `test/cli.test.ts`.

### Links

`laki://` (electron-builder's `protocols`, `setAsDefaultProtocolClient` when packaged): main's `open-url` queues a
link until the renderer says `deep-link-ready` (preload's `onDeepLink`; a main-frame navigation resets it), then
sends `deep-link`. `links.ts` `parseLink` (tested in `test/links.test.ts`), App routes it once the view is in: a
workspace or tab, the new-workspace page filled in (`initial`), Scheduled tasks, the Board, Settings, Help, About. Links select and fill
in; they never create or run anything.

### Preview

The side panel's Preview: a `<webview>` (`webviewTag`) made by hand in `SidePanel.tsx` `PreviewTab`. Main's
`will-attach-webview` drops any preload, forces no node, sandbox and context isolation, and refuses a `src` that
isn't `http://localhost` or `127.0.0.1`, or a partition other than `persist:preview`, whose session grants only
`PREVIEW_OK` permissions (Electron grants all by default). No `allowpopups`: its popups are blocked. `capture` (IPC) takes a webview of the
asking window by its `webContentsId` and returns a PNG (base64); `ShotBox` saves it (`imageSave`) and sends its path to
the agent. The crosshair (`pick`, the app only) runs `pickElement`'s source in the page (`executeJavaScript`): it
outlines what's under the mouse and resolves the clicked element (a short unique CSS selector, its opening tag, text,
size, its outerHTML up to 1,500 characters, the computed CSS of `CSS_KEYS` that isn't a default, its rect and the
page's width, the URL), or null on Esc (`window.__lakiPick(null)` cancels it from outside); the app then captures the
webview and `crop`s it to the element (a canvas, scaled by the image's width over the page's), saves it, and
`PanelApi.toPrompt` types all of it, with the screenshot's path, into the focused agent tab, else the first live one
(`send` `enter: false`: no Enter, no turn). In a browser on the Mac it's an iframe (the CSP's `frame-src`); elsewhere, a note.

The agent browser (`browse` above) is main's: a hidden `BrowserWindow` per workspace (1280×800, the preview's
partition, sandboxed, no popups, navigation and redirects kept to local URLs), destroyed after 10 idle minutes;
click and fill run in the page (`pageJs`: the first match, scrolled into view; fill sets the value through the
native setter and fires input and change), then wait 300 ms.

### Notifications

The renderer posts them (`turn` events, App.tsx): off when `settings.notify === false`, per kind
`settings.notifyOn[waiting|done|limit] === false`, or a muted workspace or tab (`muted`, ⋯ and right-click menus).
`settings.notifySound` (a macOS sound's name, `none`, unset: the default) goes to main's `Notification`. A waiting
turn whose text says "permission" gets *Allow* / *Deny* actions (Asks, above).

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
    - `laki.folded`: the projects whose workspaces the sidebar hides (a click on the project's head; `rows.dragged`
      keeps a drag's click from folding it);
    - `laki.panel`, `laki.panelTab`, `laki.panelW`: the right panel;
    - `laki.theme`: the last `Paint` (theme, glass, font), painted before the daemon's settings arrive.
    - `laki.runsSeen`: the newest run the Scheduled tasks page showed (the clock's dot: a failed one after it).
    - `laki.recent`: the palette's last 30 picks, by label: first in it, and ahead of a close match.
    - `laki.md`: the file preview's Markdown mode, `raw` or `rendered`.
  - The Dock's count (`bridge.badge`, main's `app.dock.setBadge`): tabs waiting, or done unseen, outside muted tabs,
    muted and archived workspaces. `TurnTime` (`ui.tsx`'s `Elapsed`, ticking each second) on a tab and a row, with
    `settings.timers`.
  - The theme is applied during render (`applyTheme`), before the terminals' effects read the CSS. Glass also
    goes to main (`bridge.glass`: `setVibrancy`) when it changes.
  - The status bar shows the workspace's path shortened (`shortPath`), with a copy button for the full one.
  - A workspace with a PR gets GitHub's mark in the sidebar (`.ws-pr`, its `prState` and failing checks as colors),
    unless `settings.prIcon === false`. Projects show `fork` (a repo) or `folder` (`git: false`).
  - A project's workspaces are in `.project-ws` (indented on a guide line; a line between projects). A row shows
    `stat` (`.ws-stat`, with `settings.diffStat`) and, on hover, `.ws-acts` (its ⋯ menu) over its marks. The PR mark is red
    for an open PR's failing checks only: a merged one stays purple.
  - ⌘J (`nextNeed`): the next tab of `needsYou` (the Dock count's rule), waiting ones first, in sidebar order.
  - `toast(text, undo?)`: one message at a time (a newer one restarts the timer); `archive` asks `wsArchive` with
    `ifClean` first and offers Undo (`wsRestore`); a dirty one is confirmed (an older daemon's always is).
  - No project: `Welcome` (panels.tsx) with `doctor`'s checks. `settings.dimPanes`: `.dim-panes` on `.app`.
  - `.side-head` (top): hide, open a project, help; `.side-foot` (pinned at the bottom): Scheduled tasks, Board, Settings,
    with words (`IconButton` `label`: Tasks, Board, Settings) unless `settings.sideLook.labels === false`, or the sidebar
    (a `side` container) is under 225px.
  - The project and workspace order is the daemon's (`reorder`).
- **Phones** (`App.tsx`, `useMedia`): `narrow` (≤640px, under the window's minWidth) puts `.narrow` on `.app` (styles.css' last block: the
  sidebar as a drawer, one pane per tab, panels and pages over the main area, terminal font at most 11px);
  `touch` (`pointer: coarse`) shows `KeyBar` (Esc, Tab, ⇧Tab, ⌃C, arrows, ⏎ to the focused pane, ⌨ focuses
  xterm's textarea; its buttons never take the focus). Traffic-light paddings are `.electron` only.
- **`Term.tsx`**: one xterm per pane. In an agent's (`newline`), ⌘⏎ and ⇧⏎ send ⌃J (`\n`): a new line in claude's,
  codex's and opencode's prompt, where xterm would send ⏎. It attaches on mount and detaches on unmount, and swallows terminal
  queries unless it is the responder. xterm takes `allowTransparency` only as it opens, so App keys each
  `Term` on `transparent()`: turning glass on or off remounts the terminals. A keypress whose keydown it didn't see is dropped: Enter that closed a
  dialog (and so focused the terminal) would type a stray ⏎. On window focus or a page turning visible it sends
  its size again, so a look is enough to get it back after a phone. Files dropped on it (`bridge.pathOf`) are
  pasted as their paths, shell-quoted when they need it; its `preventDefault` keeps the window's folder drop out.
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
  that); what floats is nearly opaque, never `backdrop-filter` (over the see-through window Electron repaints it badly:
  flicker, stale tooltips, rectangles around menus); the window's own blur is native
  (`setVibrancy` over IPC). `main.tsx` loads the fonts
  before the first render: a terminal measures its cells once.
- **`highlight.ts`**: the file preview's syntax colors, a regex per language family, up to `HL_MAX` (50 KB);
  tokens become React text, never HTML.
- **`markdown.ts`**: `markdown` (blocks) and `inline`: a Markdown file as a tree (GitHub's common subset), which
  `SidePanel.tsx`'s `Markdown` renders as React nodes (code blocks through `highlight`; links open in the browser,
  images show as links: the preview fetches nothing). `FilePreview` switches Rendered / Raw (`laki.md`; a jump to a
  line opens Raw). Tested in `test/markdown.test.ts`.
- **`text.ts`**: `actionsFor` (Run ▾'s actions as it opens: `settings.actions`, then the project's `config.actions`,
  which replace a global one of the same name and target; an agent's only with a live tab of it, the focused one
  first; a shell's to the focused shell, any, or none: each app's `runAction` opens one), `parseMails` (a tunnel's who-gets-in: `@team.com` and `team.com` become `*@team.com`) and
  `MAIL_OK` (what the daemons take: kept in step with their `MAIL`/`mailRe`); prompt templates (`templated`, `fillTemplate`, from `shared/types.ts`: the daemon's `prPrompt` uses it too; `{{prompt}}`, `{{project}}`, `{{base}}`;
  `settings.templates` and a project's `config.templates`, merged by `templatesFor`: the project's first, replacing a
  global one of the same name; filled in by the new-workspace page; `nameOf`: a templated workspace's name from the typed
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
  sidebar rows dragged into a new order (`useRowDrag`, `moveId`; rows carry `data-row="kind:id"`), `Page`
  (a page over the main area, like Settings: the new-workspace form), and `ask` (a yes/no in the app's own dialog,
  `AskHost` in App: never `confirm()`, the OS's sheet; its keys stay in it, Esc or outside is no).
- **`Settings.tsx`**: the settings page (⌘,), autosaved, zoomed by the terminal font size (its preview cancels
  that); presets, `EnvField` (KEY=value lines), fonts,
  `termLook` (line height, weight, cursor… as xterm options; Term takes it as `look`) with a live preview
  (`TermPreview`, keyed on `transparent()` like `Term`), Actions (`ActionsField`, also in each project's section), Appearance (themes, the current one outlined and checked, scrolled into view, a name filter that stays in sight;
  `PROJECT_LOOK`: the sidebar's project names over the theme, `settings.projectLook`, App's `phAttrs`/`phVars` put them
  on `.sidebar` as `data-ph-*` and `--ph-*`, styles.css overrides any look with `!important`; `SIDE_LOOK`,
  `settings.sideLook`: the sidebar's lines and rows as CSS values, App's `sideVars` sets `--ws-guide`, `--proj-divider`,
  `--ws-indent`, `--ws-h` on `.sidebar`, nearer than the looks' own, set on `[data-look]` at the end of look.css;
  `sideLook.labels === false` hides the bottom buttons' words; interface font, glass: `paint` applies
  them at once, before the save), Prompt templates (`TemplatesField`: `settings.templates`, and each project's), Remote access (`RemoteSection`, shown when App.tsx
  passes `remote`: the email, 1h…24h, then the QR code and link), and `ScriptsField` (a project's
  setup/teardown/run scripts, Import from a file), Pull requests (`PR_KINDS`: the PR switches' prompts over `PR_PROMPTS`,
  each with Reset; `prScan`, `prTries`), and General's Export/Import (`laki-settings.json`: `{ laki:
  'settings', version: 1, settings }`; an import goes through `paint`, so it's painted and autosaved like typing, after
  `KINDS` refuses a field of the wrong kind: add a new list, object or number setting there). *Find a setting* (`FIND`: section, the title as the page writes it, more
  words; add new settings there) opens a section and lights (`.spot`) the first label, row or heading that starts with
  the title. Hovering a theme paints it (`applyTheme`), the chosen one again as the mouse leaves `.themes` or the page closes. A
  setting back at its default is saved as that value: an unset key wouldn't replace the saved one. Projects
  are sections of it (`ProjectSection`: name, scripts, env; saved 400 ms after typing and on leaving).
- **`SidePanel.tsx`**: the right panel (⌥⌘B): Files (tree from the daemon's file list, search, new
  file/folder, changed files marked), Changes (the diff by file, each line with its old and new numbers from the
  hunks; a click opens `CommentBox`: the PR, or the agent), Review (`PRSection` from `Info.tsx`, review
  threads), Preview (above; a narrow panel shows the other tabs as icons, a container query); `FilePreview` (a click in Files, or a thread's line), `FileFinder` (⌘P, `findFiles`: a
  basename match first); a right click in Files is App's `fileMenu` (`PanelApi.menu`: default app, browsers for `WEB` files, Open in, Copy path); `RunButton` and `actionMenu` (Run ▾'s Agent and Terminal actions). App.tsx passes a `PanelApi` over the daemon. One right panel at a time: it or
  the info panel.
- **`Tunnel.tsx`**: Expose to the world: the status bar's globe next to each port (`TunnelButton`) and its
  popup: install instructions when cloudflared is missing, who can open it (anyone with the link, the default,
  or only some emails and `*@domain`s), then a QR code and the link; with emails, chips of who gets in, the bad ones flagged. `portsOf`: listening ports plus tunneled ones. App.tsx passes a `TunnelApi`. `QR`: a code
  as SVG, also Remote access's.
- **`Compare.tsx`**: a race's page (`Page` `wide`; dialog `{ compare: <race> }`: a race workspace's menu, ⌘K, and
  right after the new-workspace page's *Race* makes one): a column per live workspace of the race with its status,
  diff size, the agent's last answer and the files `diff` lists (again as `stat` moves); *Keep this one* archives
  the others (`wsArchive`, after a confirm) with *Undo* (`wsRestore`). App.tsx passes a `CompareApi`.
- **`Board.tsx`**: the Board page (`Page` `wide`; the sidebar foot's columns icon, ⌘K, `laki://board`): the
  workspaces in columns by `columnOf` (`rollup` from `Glyph.tsx`, then the PR's state), cards that open one, and To
  do (`view.todos`): ▷ or an HTML5 drag onto a column runs `wsNew` with the default agent, then `todoRm`.
- **`Schedules.tsx`**: the Scheduled tasks page (ui.tsx's `Page`; the sidebar foot's clock, ⌘K, a project's ⋯ menu:
  App's `schedulesOf`, the dialog `{ schedules: <project> }`): a project filter (`only`, starting at `project`), the form with `parseWhen`'s reading, the next runs and the dated names (*Another folder…*: `pick`, the
  folder picker, or a typed path in a browser, then `projectAdd`), the tasks (switch, Run now, edit, delete), the runs' log (a click goes to
  the run's workspace). App.tsx passes a `SchedulesApi`; the clock has a dot (`.ib.dot`) when a run failed after
  `laki.runsSeen` (localStorage: the newest run the page showed).
- **`Usage.tsx`**: the status bar's first item, the plan-limits ring (in the theme's `--accent`, then `--waiting` and `--error`; `UsageButton`: each agent's first window, the shortest: 5-hour; the busier agent's, asked
  every minute; hidden while the daemon has none) and its popup: each agent's windows, bars, when they reset.
  `USAGE_AGENTS` names the agents Settings › General has switches for.
- **`Help.tsx`**: the help page (⌘/, the sidebar's ?, ⌘K): keys, status glyphs, where things are, the main CLI
  commands and recipes (`cli`: the app's command; `ship`: list `ship`). Keep it in step with
  the guide's keys and CLI recipes.
- **`qr.ts`**: a QR encoder (byte mode, level M, versions 1–40, best mask), for the tunnel's link. Its test
  compares a code with macOS CoreImage's (`test/qr.test.ts`).
- **`panels.tsx`**: the new-workspace page (ui.tsx's `Page`: over the main area, like Settings), the palette,
  prompt and add-project dialogs (the last only for the web dev renderer, which has no folder picker), and About
  (`SITE`, the version from `package.json`; the app menu's *About Laki* is a `laki://about` link, main's `openLink`).
- **`links.ts`**: `parseLink` and `wsLink` (laki:// links, above).
- **`api.ts`**: the WebSocket client. In Electron the address comes from the preload bridge; in a browser,
  from the URL hash.

Laki was built twice while the stack was picked; the Go + Wails build is now its own repository
(`igorkasyanchuk/laki-go`, `~/projects/laki-go`) and nothing here keeps it in step. Many renderer files were
shared with it: some class and variable names in `look.css` and `themes.ts` are its, and harmless here.

## Files

| file | what |
|---|---|
| `src/main/index.ts` | Electron main: single instance, starts the daemon, window (maximized, hiddenInset title bar; traffic lights centered in the 38px header; `glass` IPC: vibrancy and a clear background), menu (with *Quit Laki Completely*: `shutdown`, asking first when an agent is running), notifications (with their sound; Allow/Deny actions call `answer`), the agent browser (`browse` IPC: a hidden window per workspace), the Dock badge (`badge` IPC), `pick-folder` IPC, laki:// links, the preview's webview guard and `capture` |
| `src/preload/index.ts` | `bridge`: conn info, notify, glass, badge, pickFolder, pathOf (a dropped folder's path), openExternal, onFocusTab, dictate (`startDictation:` to the first responder), dictationSettings, onDeepLink, capture, browse |
| `src/daemon/main.ts` | HTTP + WebSocket server, auth (token, Origin), the `api` table, shutdown |
| `src/daemon/core.ts` | the model: projects, workspaces, tabs, hooks, queue, limits, scans, diff, run, ship, archive/fork, view |
| `src/daemon/skill.ts` | the agent skill: SKILL.md and a CLI launcher in each agent's `skills/laki` (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.grok`, `~/.config/opencode`; `skills`, `skillSet`); `src/shared/usage.ts` is the CLI help it quotes |
| `src/daemon/session.ts` | node-pty + headless mirror, snapshot, attach/detach, responder |
| `src/daemon/limits.ts` | usage-limit reset parsing (from wb) |
| `src/daemon/usage.ts` | plan limits: Claude's and Codex's usage endpoints, with the agents' own sign-in, kept 5 minutes |
| `src/shared/conn.ts` | data dir, `daemon.json`, `ensureDaemon` (autostart), `rpc` |
| `src/shared/types.ts` | view types shared by daemon, CLI and renderer |
| `src/shared/when.ts` | scheduled tasks' times: English to a rule, the next run, the rule in words; `stamp` and `wsTitle` (a run's dated names) |
| `src/cli/main.ts` | the `laki` CLI and `laki hook` |
| `src/cli/mcp.ts` | `laki mcp`: the MCP server |
| `bin/laki.js` | CLI entry: the built `out/main/cli.js`, else the TypeScript source |
| `build/icon.icns` | the app icon (electron-builder), rendered from `src/renderer/src/icon.svg` by `scripts/icon.swift` |
| `test/` | fakes for every agent (`claude`, `codex`, `gemini`, `grok`, `opencode`); `daemon`, `api` (errors, edge cases, daemon start, tunnels, remote access), `pr` (PR feedback), `cli`, `e2e`, `snapshot`, `limits`, `layout`, `qr`, `highlight`, `template` (text.ts; theme ids and looks), `ask` (waiting menus), `markdown`, `contrast` (every theme's text, hints and button labels: WCAG ratios), `actions` (Run ▾'s), `usage` (plan limits, a fake server), `schedule` (`when.ts`, scheduled tasks), `links` (laki:// links) tests; `helpers.ts`; `fakes/`; `cloudflared` |
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
- **Intel**: node-pty is `@lydell/node-pty`, a prebuilt binary per platform in an optional package; npm installs only
  this Mac's, so `pack:x64` adds `@lydell/node-pty-darwin-x64` (`--no-save --force`) before `electron-builder --x64`.
  Nothing else is native. The CLI's `open` and the scripts pick `dist/mac-arm64` or `dist/mac` by architecture.
- **User-facing text** is short and plain. When adding commands or keys, update `docs/guide.md` (keys, CLI),
  `README.md` when it's a main one, and the CLI's usage (`src/shared/usage.ts`, which the agent skill quotes).
- **Commits** end with the `Co-Authored-By` trailer. Never push.
