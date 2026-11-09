# Agents, sessions and projects: how they work

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
An agent can't call `tabAccount` or `accountRm`, nor set `accountUse`, `limitFallback` or `mcpApps` (main.ts
`AGENT_NO`, `AGENT_KEYS`): they'd move work onto an account you never picked.
Auto fallback (`settings.limitFallback`, each agent's account ids in order, SettingsAgents' `.account-fb`): core's
`checkLimit` calls `fallback` a second after a new limit (new by tab and account, `limitSent`; the turn's end told
first: a workflow pauses on it), which
notes the account's reset (`accountAt`), picks the next in the order after this one that isn't at its own, and does
`tabAccount`, clears `limit` and types `continue` once the prompt is up (`whenPrompt`); none left: it waits, and a
timer tries again as the first of the others resets.
A model the installed claude is too old for: a failed claude turn's error with `claude_code_version_too_old`
(limits.ts `tooOld`: the highest version it names is needed, the next the one it has; the tab's model, else the one
it names) is kept in `state.modelNeeds` (`modelRefused`, the turn's `last` in words); `claudeHas` (`claude --version`,
every 10 minutes) drops what an update can run; `agentModels` leaves those out, the view's `modelNeeds` and `claudeHas`
warn on the new-workspace page (panels.tsx `.nw-warn`, its *Update Claude Code*: core's `agentUpdate`, a Terminals
workspace typing `claude update`; agent-refused, not remote). Tested in `test/fallback.test.ts`.
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
  its answers since its last `new` line (`sinceNew`: a `/clear`'s earlier chat stays out, the side chat's too), the newest `HANDOVER_MAX`, and `diff`'s files), then `addTab` of the other agent's first profile told to
  read it (a host's: in the prompt). Its pictures and files (`handoverPics`): Claude's base64 image blocks and Codex's
  `data:` URLs and `local_images` from the tab's transcript (`transcriptOf`), and paths the chat names in `<data>/images`,
  `<data>/files`, the storage folder or the temp folder, copied to `handover-<stamp>/` beside it (0700, files 0600), each
  path in the text rewritten to its copy, listed under *Pictures and files* and named in the prompt; never one inside
  the worktree, a secret's name (`.env`, `*.pem`, `id_*`, `*key*`), over 10 MB, or past the newest 20. ponytail: a host's
  workspace (no storage folder) carries none. Tested in `test/worktrees.test.ts`, `test/ai.test.ts`, `test/reader.test.ts`.

`daemon/secrets.ts`: `laki secret <what>` (MCP's `laki_secret`; `SECRET_WAIT`, the CLI's rpc waits as long):
`secretAsk` (`from`'s tab; its storage folder, none on a host) puts `secret` (`{ id, label }`) on the tab (waiting while
its command runs: Needs you, a notification, a phone push), panels.tsx `SecretStrip` at the pane's foot, a password
field; `secretGive` (`id`, `value` or `refuse`; refused from an agent) writes `<storage>/.laki-secrets/<slug>-<hex>`, 0600
(hidden: no artifact) and the agent gets its path; `secretsTidy` (hourly) removes those past 24 hours. ponytail: in
memory (a restart drops an ask). Tested in `test/cli-agents.test.ts`.

`daemon/alerts.ts`: `laki alert <text> [--title t] [--choice A]…` (MCP's `laki_alert`; `ALERT_WAIT`, 30 minutes, the
CLI's rpc waits as long): `alertShow` (refused with no app connected, from a workspace Recording mode hides: phone.ts
`hidden`, or past `RATE`, 5 a minute from each tab or from outside one; its words without `HIDDEN`'s characters) broadcasts `alert` (`id`, `title`: yours or the
caller's workspace · tab, `text`, `choices` up to 6, `tab`); App makes it a card on screen (`notify`'s `card.alert`,
a button per choice). Without choices it returns `{ shown }`; with them it waits for `alertAnswer` (`id`, a `choice` of
its own, or none: the card's ×, Close all; refused from an agent), else `timedOut`, then broadcasts `alertDone` (the card
goes: main's `card-gone`). The CLI prints the pick, exit 1 when closed or timed out. Tested in `test/alerts.test.ts`.
`laki notice <text> [--title t] [--choice A]… [--to <ref>]` (MCP's `laki_notice`) is `alertShow(p, 'notice')`
(`noticeShow`): the same checks and `RATE` (shared), but no app needed and the `notice` event; the daemon keeps it in
`notices` until it's answered or closed (past `NOTICES`, 20, the oldest without a wait go; one that waits stays, its
caller would hear a close you never made), and `noticesTo` sends them to a window as it connects, none from or about a
workspace Recording mode hides then. `to` (`about`: `resolveTarget`, else a workspace without an agent; Recording mode
hiding it refuses it too) rides as `to: { ws, tab?, name }`. Each window keeps its own (Shown.tsx `useNotices`: a
connection that opens starts over, then the daemon's replay): App's `NoticeCard`s at the top of `ShownPops`' corner
stack, × or a choice calls `alertAnswer`, *Open* leaves any page for `to`'s tab or workspace (else the sender's tab) and
closes one without choices; floated windows (a tab's, Laki AI's, the simulator's: main.tsx' `FloatNotices`) show the
same cards without Open; `alertDone` drops it in every window.

### Asks

A waiting tab's view has `ask` (`shared/ask.ts` `askOf`, over the bottom 16 lines of its screen): numbered options
(`1.`, `2)`…), consecutive, at least two, one of them marked (❯ › > ▶ ● →), box borders stripped; the last such menu
wins (tested in `test/ask.test.ts`). `answer` reads it again, then sends ↑/↓ one at a time, 40 ms apart (a TUI reads
a burst as one key; `Session.appCursor` picks `ESC O` or `ESC [`), then ⏎. The renderer's ask bar (App.tsx) shows
them as buttons for the tab with the keyboard (not in Reader view: the Reader's card has them, with the tool, what and rule (shared/ask.ts `optLabel`), and answers with
the label too; the bar comes back while the full review or a phone's panel covers the Reader); a permission prompt's notification gets *Allow* / *Deny* (main's
`Notification` `actions`; main calls `answer` itself, `pick` first / last, so a closed window doesn't matter). `answer`
needs the tab waiting and takes one at a time (a second after its Enter too). A waiting tab's output has its menu read
again 300 ms later (`spawnTab`'s `onOutput`), and a view goes out when it isn't the ask the last pushed view gave (`askKey`, set in `changed`).

### Sessions

- **Closed tabs** (⇧⌘T): `tabClose` (yours, the app's ⌘W, `laki tab close`) keeps the tab on its workspace's `closed`
  (`ClosedTab`: name, kind, preset, profile, resumeId, model, effort, perm, fast, sandbox, account, cmd, a shell's `cwd`
  from `shellCwd`; newest first, `CLOSED_MAX` 10, in state.json); an exit, a Run ▾ tab's or a workflow's cleanup
  (`closeTab` without `keep`) isn't kept. Archive drops the list. `tabReopen({ ws, index? })` brings one back through
  `addTab` with `resume` (and `account`), taking it off the list; a claude or codex chat whose transcript isn't there
  (`transcriptOf`) starts a new one and says `fresh` (the app's toast); a refusal (a policy, a profile's check) leaves it
  listed. An agent reopens only in its own workspace (`agentNo`), and only what it could start itself (`agentNoCmd`: no
  command of its own, none that never asks; none outside its profile's sandbox), the tab then the agent's (its
  `tab.new` too); a sandboxed one not at all (`boxNo`). ponytail: a
  Browsers page's ⇧⌘T does nothing.

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

Hooks in the background: this Mac's claude runs its PreToolUse and PostToolUse hooks with `"async": true` (claude
2.1.318 has it; it doesn't wait, and it enforces no timeout on them), so a tool call no longer waits for two starts of
`laki hook` (Electron as node: ~45 ms to start, ~60 ms a hook here; 10 tool calls of the fake claude: 1.8 s of hooks a
turn before, ~40 ms after). S8: one started with none on is kept in core.ts' `ungated`; once a gate is on (`toolGateOn`) the view marks it (`ungated`: the tab's *No gate* mark, a count on the extension's page) and `gateRestart` (`{ tab? }`, the user's) starts the idle, not asking ones again, resumed (`{ restarted, left }`). A tab started while a tool gate is on gets `-gated`, whose PreToolUse is waited for (it may
answer); a gate turned on later reaches running tabs as they start again (Turn on says so). `laki hook` sends `at`, its
process's start (`performance.timeOrigin`), and `turn` keeps the newest it took (`Runtime.hookAt`): one that started
before it (a PostToolUse after the turn's Stop, a PreToolUse after the ask PermissionRequest made) changes no state,
`perm`, `bg` or `compacting`, only its plan and published links. A host's hooks stay waited for (its script sends no
`at`). Not done: a node compile cache or an http.request in place of fetch (~5 ms of the ~60), a /bin/sh + curl hook.
Electron's Node snapshot for `ELECTRON_RUN_AS_NODE` children (electron/electron#52873) was merged on Aug 17, 2026 but
isn't in 45.2.3's notes (the newest stable on Nov 6, 2026): no release past 45.2.2 is known to have it.

Claude gets `--settings <data>/claude-settings.json` (`claudeFile`: `-fast` for `fastMode`, `-gated` when an extension's
tool gate is on as the tab starts, `existsSync(toolFlag())`; `hookFiles` writes every mix) and, on this Mac (not a host: no laki CLI there), `--plugin-dir
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
| PermissionRequest | waiting, and the tab's `perm` (the tool, what it touches, the rule, an Edit's, MultiEdit's or Write's change: `permDiff`, a Write's file read first only inside its workspace, `priorOf`): prints nothing, so claude asks in its own menu |
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
`sandbox` (`SANDBOX`, a profile's *Sandbox*, the tab's over it, kept for restarts and forks; `sandboxOff`: none with
bypass permissions, its mode or its flags, refused by `modelCheck`, `tabSpec` and `presetSave` as `SANDBOX_NO`, and an
agent's `sandbox: false` by main.ts' `agentNo`): claude's `--settings` gets `-sandbox` (`sandbox.enabled`,
`autoAllowBashIfSandboxed`, `excludedCommands`: `laki *` and `LAKI_CLI`, so the CLI reaches the daemon) and `--add-dir`,
first (it takes every word up to a flag), for each folder `git commit` writes in (`gitWrites`, from `.git` and
`commondir`, realpath'd: a worktree's own folder, the index and HEAD, and the shared `objects`, `refs` and `logs`; never
the shared `hooks` or `config`, which git runs outside the sandbox, Laki's own git included; the repo itself, a local
workspace: its `objects`, `refs` and `logs` only, so its index, HEAD, hooks and config stay read-only and `git commit`
there runs outside the sandbox); codex `codexBox`: `-s workspace-write` unless its mode or flags pick a sandbox (read-only
stays; an approval flag like `-a never` picks none), `sandbox_workspace_write.network_access=true` and `writable_roots`
with those folders, a worktree's own folder as the files git writes there (`OWN_WRITES`: the index, HEAD, a merge's
files, `SQUASH_MSG`, each with its lock, `logs`, `refs`; and the repo's `packed-refs`, its `.lock` (else each commit says it can't lock it) and `.new` (a rewrite: a packed branch deleted, `fetch --prune`)), never the folder: its `commondir`, `gitdir` and `config.worktree` say where git
finds the repo and its config, so one the agent wrote (`core.fsmonitor`, `core.hooksPath`) would run as you in Laki's
scans and your git (a nested repo the agent makes in its worktree has a config of its own, out of reach of all this: `exec`'s and `turns.ts` `g`'s `noNested` keep git out of it by flags, `files.ts` `treeOf` takes gitlinks off its index first, as `add -A` has no flag, putting a submodule never checked out back after, Ship stages `treeOf`'s tree with `read-tree --reset` (a host's: still `git add -A`) and refuses, before its script, a gitlink that isn't both in the merge base with `ws.base` and in your own checkout's index, which the sandbox can't write as it can refs (`nestedRepos`, by path: `gh pr create --fill` and `glab mr create --fill` without `--head` run plain `git status`, which goes in, so that status also reads an index of Laki's, `<data>/turns/<ws>.ship`, out of the agent's reach; ponytail: the `.git` of a submodule in both can be replaced; a submodule new on the base waits until your checkout has it), a folder project's git is refused there too, and `boxNo` refuses `projectAdd`); a rebase's or cherry-pick's sequence (`rebase-merge`, `sequencer`: a todo's `exec`) is left out too
and asks, as do `git stash` and `git commit <paths>` (their temp index is named by its pid: `index.stash.<pid>`,
`next-index-<pid>.lock`) (codex keeps that folder and `.git` read-only itself; checked with `codex sandbox`, 0.162.1). claude gets the folder
(`--add-dir` takes folders): its sandbox keeps `.git`, `commondir`, `config.worktree` and `.git/config` read-only itself
(2.1.319, checked with `claude -p`). ponytail: an older claude's isn't checked, and claude's leaves `rebase-merge` and
`sequencer` writable there (a todo's `exec` runs as you when you continue that rebase). Hooks
and codex's notify run outside the sandbox (the agent's own runner), so `laki hook` isn't touched. ponytail: a host's git
folders aren't added.
`fast` (`FAST`: claude's `--settings` is `claude-settings-fast.json` (or `-fast-gated`), the same with `fastMode`; codex `-c
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

A turn that ends on an API error (`turn`'s `failed`, not a limit, a refused model or an Esc) keeps its line in `r.failed` (the view's `failed`, only while idle) until a new turn or `failDismiss`: the Reader, Needs you, One next step and the palette offer Continue, which is `send`'s `continue`. `settings.continueOnError`: `continueLater`, once per turn (`autoContinued`, `contSent`: a UserPromptSubmit that isn't its continue starts over), `LAKI_CONTINUE_MS` later, never in a workflow's tab.

A running claude's permission mode: the footer (`claudeMode`), `tabMode`, the chip (`Reader.tsx` `modeItems`, also the tab's menu). S9: `claudeMode` says `default` only with the footer on screen (`FOOT_SEEN`: the input box's rule or `>` prompt, or `? for shortcuts`); without it (a transcript view, a menu, a start not drawn yet) it's `undefined`: the tab keeps the last mode seen with `modeUnknown` (the chip reads *Mode unknown*, its tip the last one), and `tabMode` refuses to press from a mode it can't read. ponytail: the marks are from Claude Code's screens as known in Nov 2026; a build that draws none of them would read as unknown. Not kept across a restart: a resume starts as `t.perm` says. An agent's `tabMode` is refused, and so is the key itself (main.ts `shiftTabNo`, for `input` and `send`: `SHIFT_TAB`, and `keyTail`, per tab, for an Esc in one call and `[Z` in the next, `queueNow`'s Esc too, moved only by `input` as a `send` may just be queued; a plain Esc goes through; `send`'s own escapes are stripped by `typeInto`, `noKeys`). ponytail: only those bytes: a key rebound in claude's `keybindings.json` or a slash command typed isn't.

### Resume

`state.json` keeps projects, workspaces, tabs and resume ids (`save`: fsync, then rename; `load` copies one that
reads as `state.json.bak`, and moves one that doesn't to `state.json.broken-<ms>`, then loads the `.bak`: never
empty over it). `daemon.log` goes to `daemon.log.1` past 10 MB when a daemon starts and each hour while it runs (conn.ts `rotateLog`, main.ts' `logTick`: copied and cut there, since the daemon's stdout holds it open). The app's main process has its own `app.log` beside it (`logLine`: uncaught errors, a renderer or helper process gone, a window that stopped responding; after 10 s of that a dialog offers Wait or Reload). Starting the daemon brings every tab back:
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

A claude chat whose background commands (Bash `run_in_background`: a dev server, a watcher) or background subagents
were running as Laki ended its process (a restart: an update, Update when idle, a crash; or sleep) is told so once
it's back: `bgTell`, from `restoreNow` and resources.ts `wake`, reads its transcript as it resumes (meters.ts `bgLeft`:
share.ts `bgOf` over the last 8 MB, `BG_READ`; what's still open there was killed, nothing saved at shutdown, so a
crash too; a read that fails says nothing and never stops the resume), then `whenPrompt` → `bgGone`: one `send` (when
idle) naming each command (`BgTask.cmd`) and each background subagent (not one in the turn, a `toolu_` id: the turn
ended with it), `bgGoneText` (a restart's words or sleep's). `tab.bgTold` keeps the ids named (their ends never come):
never twice; the view leaves it out. A dormant tab gets it as it wakes (restoreNow then). ponytail: claude only; Update when idle doesn't wait for them (a dev
server never ends).

A resume of a chat claude or codex don't have (`CHAT_GONE`, their words on the screen as it exits) drops the tab's
`resumeId` (Enter starts a new chat) only when it exits within `RESUME_FAIL` (30 s) of starting: later, a chat's own
words ("session not found") don't. In development mode `spawnTab`'s exit logs each agent's end to its workspace's log:
the code, the seconds it ran, its last lines.

### Design: terminals that outlive the daemon (R6, not built)

A proposal, for the maintainer's OK before any code. node-pty's children belong to the daemon (session.ts), so a crash,
`laki stop` or an app update that restarts an older daemon ends every turn. *Update when idle* avoids the last; nothing
avoids the first two.

- **A pty host.** One small process (`src/ptyhost/main.ts`, its own build entry) owns the ptys and a ring buffer of
  each one's output (the last 2 MB). No state.json, no git, no hooks logic: it changes rarely, so app updates seldom
  need it restarted. Started by the daemon when missing, detached, as the daemon is by the app.
- **Protocol.** A unix socket `<data>/pty.sock` (0600, in the 0700 data folder; no TCP listener), length-prefixed JSON
  frames: `spawn { id, file, args, cwd, env, cols, rows }`, `write { id, data }`, `resize`, `kill { id, signal }`,
  `list` (ids, pids, sizes, exit codes), `attach { id, from }` (replays the buffer from an offset, then streams),
  `hello { version }`. Output frames carry an offset so a daemon that reconnects asks for exactly what it missed.
- **The daemon's side.** `Session` talks to the host instead of node-pty. On start it calls `list`, re-attaches every
  id it has a tab for, and rebuilds the headless xterm mirror by replaying the buffer (the same path a snapshot takes
  now). A tab whose pty is gone is restored as today (`restoreAll`, resume).
- **Hooks.** `LAKI_HOOK` is per start and lives in the agent's environment, which survives. The daemon must keep each
  start's key across its own restart: saved with the tab in state.json (0600) rather than in memory.
- **Versions.** `hello` carries the protocol version. A newer daemon speaks to an older host as long as the version
  matches; when it doesn't, the daemon waits for every pty to be idle (the *Update when idle* rule) and restarts the
  host, or does it at once when the user says so.
- **Security.** The socket is the only way in and is the user's alone; the host accepts no command that isn't in the
  list above and never reads files. A sandboxed agent must not reach the socket: deny it in the sandbox profile, with
  daemon.json.
- **Linux and SSH hosts.** The same on Linux (unix sockets, node-pty). A host's tab is an ssh process on this Mac: it
  survives with its pty; the remote side is unchanged.
- **Tests.** `fresh()` starts a host per rig in its temp data folder with `LAKI_TEST_PARENT` (it exits when the test's
  process is gone, as the daemon does). New tests: a daemon killed mid-turn, started again, the turn still running and
  its output complete; a host of another version restarted only when idle.
- **Risks.** Two long-lived processes to reason about; a buffer replay that differs from what xterm saw (resizes mid
  stream: record resize events in the buffer); an orphaned host after an uninstall (it exits when it has no ptys and no
  daemon for 10 minutes); memory (2 MB × tabs, bounded).
- **Rollout.** Behind `settings.ptyHost` (off): first the host and the protocol with tests; then shell tabs only; then
  agents; default on after two releases without a report. Until then, make *Update when idle* the default.

### OSC 7501 (shadow)

An agent can say what it's doing through its own terminal: the Program Status Protocol (`daemon/program.ts`). Only an agent's tab answers
the query (`OSC 7501 ; ?`, `Session.programReport`, straight to the PTY: xterm.js has no OSC 7501, so never twice) and keeps records,
one per id, on its `Session`: a new start has none, and exit, a reset (RIS), a clear and a new shell prompt (OSC 133 A: working and
blocked) end them. A report that breaks a limit is dropped whole; an id out of the grammar too (skipped as a bad pair, it would be the
root's: `state=clear:id=a@b` would clear everything). A child's report never moves its parent. `msg` and `title` are checked, not kept.

Shadow: once a change of the root's state has stood 2 s (`PROGRAM_SETTLE`; a hook and a report of one change never come at once; the same state again, its progress say, restarts nothing) `programSeen`
counts it against the status from hooks (`nativeAgrees`), per agent since the daemon started: `hooksSeen`'s `native`, Settings › Agents &
profiles' line. Nothing else reads the records: a tab's status, notifications, asks and approvals stay with hooks, so a file shown in a tab
can't move them. Next, once the counts say so: a fresh report overriding hooks for working, idle and done, under a written policy.
