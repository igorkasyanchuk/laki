# Agents, sessions and projects: how they work

### Profiles and accounts

Settings › *Agents & profiles* (the code's word stays *preset*): each preset can carry `model` and `effort` (`agentCmd`:
the tab's own, from the new-workspace page, wins), for claude and codex `perm` and `fast` (likewise; below; a worker an
agent starts with no `perm` takes its lead's mode now, core.ts `leadMode` (#6): the footer's, else its own, where the
worker's agent has it, never one that never asks or that leaves a sandbox its profile keeps; `permFrom` names the lead,
kept in `pending` for a later start; TabBar's tip says it started in that mode, a ⇧⇥ since being the footer's), and
`account`. `daemon/accounts.ts`: an
`Account` (`settings.accounts`, only through `accountAdd`/`accountSet`/`accountRm`: `settingsSet` drops `accounts`, so an
import never brings folders) is a folder `<data>/accounts/<agent>-<id>` given as `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
(`accountEnv`, in `lakiEnv`, not on a host); `HOME_ACCOUNT` (`home`) is the agent's own sign-in, no env at all (that
variable set to `~/.claude` would read another Keychain item). `linkShared` links `SHARED` (claude: projects, file-history,
todos, plans, skills, plugins, commands, agents, hooks, output-styles, settings.json, CLAUDE.md, keybindings.json; codex: sessions, archived_sessions,
skills, prompts, config.toml, AGENTS.md) from the agent's own folder, at its making and each start, so a chat resumes on
any account (claude's missing folders made in `~/.claude` first; `~/.codex` is never written: only what's there). `spawnTab` keeps `tab.account` (`accountFor`: its own, else its profile's, else `settings.accountUse`, else
home; a removed one: home); `tabAccount` (a tab's right click › *Restart on another account*) sets it and resumes.
An agent can't call `tabAccount` or `accountRm`, nor set `accountUse`, `limitFallback` or `mcpApps` (gates.ts
`AGENT_NO`, `AGENT_SETTINGS_NO`): they'd move work onto an account you never picked.
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
warn on the new-workspace page (panels.tsx `.nw-warn`, its *Update Claude Code*: agentCli.ts' `agentUpdate`, below;
agent-refused, not remote). Tested in `test/fallback.test.ts`.

**The agents' CLIs** (A9, `src/daemon/agentCli.ts`, Settings › Agents & profiles › *Versions*: SettingsAgents.tsx
`AgentVersions`, behind the `agent.versions` cap). `CLIS`: claude, codex, gemini, grok, opencode and cursor
(`cursor-agent`), each with its npm package and its own updater. `agentVersions` finds each on the daemon's PATH, runs
`--version` (8 s), and reads how it was installed off its real path (`howOf`): a global `node_modules` (npm, bun or pnpm:
the package and `npm install -g <pkg>@<the newest shown>`, `@latest` while none is known…), Homebrew's `Cellar` or `Caskroom` (`brew upgrade [--cask] <name>`),
else its installer (`claude update`, `opencode upgrade`, `cursor-agent update`; none known: no Update). The newest:
npm's registry (the package's document `<pkg>`: `dist-tags.latest` and its `time`, one request, its package or the CLI's
known one), kept 6 hours (`fresh` looks now; offline keeps the last); `LAKI_NPM_REGISTRY` is tests' fake, and the rig
without it asks nothing. Settings' `updateDelay` (days) applies to an npm, bun or pnpm install: a newest younger than
that is listed with `newestAt` and `offerAt` (when it's offered; `-1`: the registry gave no date, held back) and not
counted; one with its own updater or Homebrew's gets `noDelay` (it installs what that gives). `outdated` (a CLI with a
newer version out and offered, not updating) is the view's `agentUpdates`: the rail's Settings says which in its tooltip, and has a dot with `settings.updateDot` (off unless set: Agents & profiles › Versions). `agentVersionsTick`
(6 h, and a minute after start). `agentUpdate` runs the command as a `script` tab (it stays when it ends, with its exit
code: a shell's would close) named `update <name>` in the Terminals workspace `update agents` (made once); one at a time
per CLI. The row says running, done (and, with tabs of it running, that they keep their version until restarted) or
failed with the exit code and Retry; *Show* opens the tab (Settings' `openTab`). `test/agent-cli.test.ts`.
`accountLogin` opens a Terminals workspace `sign in: <name>` and types the agent's login there once its prompt is up
(`whenPrompt`, `loginCmd`). `accountView`: claude's email from the folder's `.claude.json` (home: `~/.claude.json`),
signed in when `usage.ts` `claudeCred(dir)` finds a token: the Keychain item `Claude Code-credentials-<sha256(dir)[:8]>`
(`keychainService`, the folder as given) or the folder's `.credentials.json`; codex's from `auth.json`'s id_token.
`usage` takes `usageWho()` (each agent's accounts, `default` marked), cached per folder; the ring shows the defaults,
the popup each (Usage.tsx `mostRoom`: 20 points ahead). `accountRm` (refused while a live tab is on it) removes the folder (one under `<data>/accounts`; the
links, not their targets) and claude's Keychain item. Laki AI's claude/codex backends take the preset's account, else
the default. Tested in `test/accounts.test.ts` (the fake `security` keeps an account's item in `$HOME/keychain-<name>`).

### What it sees (F6)

`sees.ts` `agentContext({ agent, project })`, read only, for claude and codex (refused for an agent's caller, over
remote access, and for a project on an SSH host): `rules`, the files the agent loads in its order, each with its size
and scope: Claude Code's managed CLAUDE.md, the default account's folder's (`configDir`: its `CLAUDE_CONFIG_DIR`, else
`~/.claude`) CLAUDE.md and `rules/*.md`, then for each folder from `/` down to the project's (`chain`) its CLAUDE.md,
`.claude/CLAUDE.md` (the project's own `.claude/rules/*.md`) and CLAUDE.local.md, each with its `@path` imports (`from`;
code spans and fences skipped, 5 deep, each file once by its real path); Codex's folder's `AGENTS.override.md` or
`AGENTS.md`, then one per folder from the repo's root down. `memory`: how many global, yours and learned items, and the
bytes of `memoryNote` (what claude's `--append-system-prompt` and codex's instructions get). `servers`: Claude Code's
`.claude.json` (the project's local ones, then `.mcp.json`'s project ones, then the user's), Codex's `config.toml`
(`tomlServers`: a TOML subset, `[mcp_servers.<name>]` and its `.env`; a project's `.codex/config.toml` too); env and
headers by name only, a token-shaped string, a URL's password and the value after a `--token`/`--api-key`… masked. No
health: `claude mcp list` starts every server, so it's typed for you (*Check health…*), not run. `agentContextOpen`
opens one of the listed files only (core's `openPath`, the editor). The page (SettingsAgents.tsx `WhatItSees`):
Settings › Agents & profiles › Claude Code or Codex › *What it sees*, and a workspace's Info (*What claude sees*: the
dialog `{ sees, in }`); *Add a server…*, *Remove…* and *Check health…* open a terminal in the project with the agent's
`mcp add`, `mcp remove <name> -s <scope>` or `mcp list` typed, not run (App's `termType`, Welcome's way). Never a write
to `~/.claude` or `~/.codex`. Tested in `test/agents.test.ts` (fake files under the test's HOME).
`skills` (`skillsAudit`): every agent's skills, read only: each `skills/<name>/SKILL.md` under claude's and codex's
folders (`configDir`: the account each uses), Antigravity's (`~/.gemini/config`), Grok's, OpenCode's, and with a project
its `.claude/skills` and `.codex/skills`; a link or anything but a plain file skipped (`O_NOFOLLOW`, fstat), 100 at
most, 256 KB read each: its bytes, ~tokens (bytes / 4), its frontmatter's bytes. `skillNotes` (types.ts) marks one over
`SKILL_BIG` (8 KB: it loads whole each time it triggers) and one only one agent has. Settings' *What it sees* lists them
(*Skills*, Open); `laki skills audit [--project p] [--json]` prints them. Tested in `test/cli.test.ts`.

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

Isolation (F7, step 1): `shared/isolation.ts`. A live workspace's `port` is 3100 + 10 × n (`allocPort`: the first block
no live one has), n its slot (`slotOf`; archived: port 0, none). `isolationEnv(port, project)`: `LAKI_SLOT`, `PORT_1`…`9`,
`LAKI_DB_SUFFIX` (`_ws<n>`), `COMPOSE_PROJECT_NAME` (`<project id>-ws<n>`, lowercased, what compose allows), in
`lakiEnv` beside `PORT` (every tab, setup, the Run tab, teardown: before archive zeroes the port) and in verify.ts' and
workflow.ts' scripts. A restored workspace takes the first free block again, so its slot may change. `portClashes` (the
sidebar: a ⚠ chip with the port on both rows, who has it in its tip): a workspace's listening `ports` (resources.ts) in
another live one's block. Settings › a project › *Isolation* lists them, with a compose file, a `DATABASE_URL`, a
setup and a teardown to copy; Teardown is Scripts' (archive and delete, its trust as setup's). Step 2 (a devcontainer
per workspace) isn't built.

`shared/types.ts` `AGENT_VARS`/`agentVars`: `{{workspace}}`, `{{branch}}`, `{{path}}`, `{{port}}`, `{{pr}}` (its URL),
`{{project}}`, `{{base}}`, `{{storage}}`, `{{tab}}`, `{{agent}}`, `{{date}}`, `{{time}}`, filled by `core.ts` `varsIn`
(`fillVars`: only these names; a missing value stays; into a shell tab, one that isn't plain characters goes in quoted for the tab's shell: `shared/shells.ts` `shellWord`, POSIX, fish's or nushell's by the shell it started, `tab.shell`, kept on the tab so an adopted one's is known too) where the caller says `vars`: `send` (before a queue), `addTab`'s
prompt, `wsNew`'s (the new-workspace page with a template, Run ▾'s actions, MCP's `laki_run_action` and
`laki_new_workspace` with a template or an action, scheduled runs). A message as typed never. Workflows add them under
their own (`varsOf`). Settings' chips under an action or a template list them.

### Turns

**Goals (A1).** A claude or codex chat's `/goal` comes from its transcript (`share.ts` `goalIn`, in `meterOf`): claude's
`goal_status` attachments (a `sentinel` as it's set, `met: true` with it as it's cleared; `met` or `failed` at each
check), codex's `thread_goal_updated` events (`goal.status`: active, paused, budget_limited, usage_limited, blocked,
complete; `goal: null` cleared), kept as `Meter.goal` and given as the view's `tab.goal` (`Goal`, `GOAL_SAYS`). A turn
end while it's `working` (`goalOf` reads the transcript on at once) is held (core's `goalHold`): the tab stays running,
no `turn` event, phone push, `turnEnds` (Done check, workflows) or next step; `goalTick` (every 2 s, `LAKI_GOAL_MS`)
lets the newest held end go once the goal stops, its words `Goal reached: …` (`r.goalEnd`). An Esc or a failure ends
the hold; your next prompt (`UserPromptSubmit`) drops it and a reached or failed goal (`goalSeen`). The band
(panels.tsx `GoalStrip`) types `/goal pause`, `/goal resume` (codex) and `/goal clear` through `send`. ponytail: read
with the meters (off when both the context meter and costs are off); Grok's goals aren't read.

**Laki's own goals (A1b).** An agent with no `/goal` (agy, opencode, grok, an ACP agent) gets one from Laki
(verify.ts `goalSet`, the tab's menu › *Set goal › Until test passes…*): `tab.goalRun` (`TabGoal`, kept in state.json)
holds its words, the project's script that says it's met (`check`: format, lint or test), `maxTurns` (unset
`GOAL_TURNS`, 12), `maxUsd`, its turns so far and the chat's cost as it was set (`cost0`). It's sent as a prompt
starting `Goal (Laki): ` (`GOAL_MARK`). Each turn end (`turnEnds`, not a limit or a failure: those stop it, `limit` and
`blocked`) runs the script as the Done check runs one (`step`, not counted as the Done check's own: `own` false), once
per end (`goalBusy`): exit 0 is `reached`; else, under `maxTurns`, `maxUsd` (the meter's cost, an agent Laki prices) and
the same output (its sha-256, `outHash`) `SAME_MAX` (3) turns in a row, the goal and the output (fenced, untrusted)
go back through `send` whenIdle; past one, `failed` or `budget` with `why`. The Done check skips a tab whose goal works
(`wants`), and `checkHooks.will` holds the turn's notification: the goal's end is a `check` event (passed, over), with
its bell and phone push. A prompt the agent takes (core's prompt hook, `checkHooks.prompt`) that doesn't start with
the mark pauses it (`paused`, *you sent it a prompt*); `goalSet` `resume` sends it again. `goalOf` (meters.ts) and
`meterView` give it as `tab.goal` (`ownGoal`: `own`, `turns`, `maxTurns`, `spent`), so the band (panels.tsx
`OwnGoal`: turn n of m, its spend, Resume, Clear) and the tab's target mark draw it; core's `goalHold` never holds
for it. ponytail: maxUsd needs an agent whose chat Laki can price (claude's and codex's meters); gemini's spend isn't
read yet.

`daemon/turns.ts` (main.ts imports it; core's `turnStarts`, claude's UserPromptSubmit, and `turnEnds`), core keeping
what the view shows on the tab's runtime:
- each turn's changes (`settings.turnChanges`, on unless false): the worktree as a tree through an index of its own,
  `<data>/turns/<ws>.index` (`treeOf`: first a copy of the worktree's own index, for git's stat cache; `git add -A`,
  `write-tree`, one at a time per workspace; the worktree's own index never touched; Done check's tree too; Ship's, a
  host's worktree included, there; `turnsTidy`,
  hourly: gone workspaces' indexes, closed tabs' turns), as a claude turn starts (the last turn's card and Undo go then) and as any claude or codex turn ends (codex: the
  last end, or Undo's tree, is its start); a tab's
  `changes` (`TurnChanges`: `n`, `add`, `del`, the first `TURN_FILES` files, git's A/M/D, no renames). The Reader's
  `TurnCard` (Review: Changes' *This turn*, `Scope` `turn`, the `laki-scope` event, `turnDiff`, read only; Undo:
  `turnUndo`, after `ask`: refused while it runs or once one of its files changed since, then `git restore
  --source=<before> --worktree` and its added files removed, `inside`). ponytail: the card is the last turn per tab,
  in memory; this Mac's git workspaces only;
- every turn kept (F1, `settings.turnsKept`: 50 unset, 0 none, 500 at most; `KEEP_DAYS` 14): `turnEnded` hands each
  turn that changed files to `turnKeep`: `<data>/turns/<ws>.json` (`{ repo, next, turns: TurnKept[] }`: n, tab, name,
  the prompt's first line (`rt.asked`), started, ended, the trees, counts, the first `TURN_FILES` files, claude's cost
  from `chatRead`), one change at a time per workspace (`inLine`). The trees stay alive as commits (`commit-tree` on
  the HEAD of then, Laki as author, never signed) under `refs/laki/turns/<ws>/<n>/before` and `/after`: outside
  refs/heads and refs/tags, and every push in the code names its refs (a `git push --mirror` of the user's takes
  them, `git log --all` lists them). A turn past the count or the days loses its
  refs; `turnsTidy` (hourly, and after `wsRm`) drops a gone workspace's list and refs (`turnsGone`; archived ones
  stay). `turnList { ws | tab }`; `turnDiff { n }` (none in memory: the newest kept); `turnRewind { ws, n }`: refused
  while a tab of the workspace runs, `treeOf` now, kept as a turn (`rewind: n`, name You), then `git restore
  --source=<before>` and the files added since removed, every tab's card cleared: rewinding that turn undoes it;
  `turnFork { ws, n }`: `wsNew` with the `after` commit as base, the branch put back to its parent (`reset`: the
  files stay, uncommitted; no commit of Laki's in the branch), then the source's base. Rewind and fork are the user's
  (`AGENT_NO`). `TurnStrip.tsx` (with `turnChanges` on): `TurnButton`, the status bar's
  *Turns* for the focused agent tab (keyed by the tab; its count, the last turn's `turnWords` as its tip, a click: App's
  menu, the newest 30 newest first, each a submenu of the three actions); with the status bar off or in full screen,
  `TurnStrip` in App's pane `foot` instead (a dot
  per kept turn, `turnWords` as its tip and its menu's head); both through `useTurns`, the three actions (`turnApi`: `turnNext.n` and the
  `laki-turn` event open Changes on it); Changes' *This turn* has a `<select>` of the workspace's turns (`PanelApi.turns`,
  `turnChanges(n)`). Tests: `test/turn-history.test.ts`. ponytail: files only, nothing git ignores, no hosts; a turn
  that changed nothing isn't kept; a rewind names every path on one command line;
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
`secretAsk` (`from`'s tab; its storage folder, none on a host) puts `secret` (`{ id, label }`; with `fields`, #7: 2 to 8 `name[:plain]`, `fieldsOf`, one card for a sign-in, none
kept offered, `secretGive`'s `values` a file each, `{ paths }` back) on the tab (waiting while
its command runs: Needs you, a notification, a phone push), panels.tsx `SecretStrip` at the pane's foot, a password
field; `secretGive` (`id`, `value` or `refuse`; refused from an agent) writes `<storage>/.laki-secrets/<slug>-<hex>`, 0600
(hidden: no artifact) and the agent gets its path (S10: only into a real folder of the storage folder, `ownDir`: a
`.laki-secrets` link is refused and never tidied through; the file opened `O_EXCL | O_NOFOLLOW`); `secretsTidy` (hourly) removes those past 24 hours. ponytail: in
memory (a restart drops an ask). Tested in `test/cli-agents.test.ts`.
A kept one (`state.secretsKept`: `{ scope, label, at }`, its value by keychain.ts) also has `given` (each give's
`at`, workspace id and its name as shown then, the newest `GIVEN_MAX`, 20) and `count`, set as `secretGive` gives it (or
keeps it with its first give); never a value or a path. The card (`cardOf`, again on each change: `resaved`) carries
`last` (the newest give's `at` and name) and `first` (none of its gives went to this workspace): the window draws
*Last given … to …* and *First time this workspace asks for it*. `masked` drops `last` with `secretsKept`: an agent,
remote access, a trusted client and Telegram see neither. `test/secrets-kept.test.ts`.

A secret pasted into a prompt box (renderer's `secretHint.tsx`, in `PromptInput` (New workspace, the quick bar, Laki
AI's, the Board's) and the Reader's box, the phone's too): `shared/secrets.ts` `secretsIn` (the share mask's `SECRETS`
plus `PAIR`, the generic `password=` pairs with an entropy check; a UUID, a 40-hex hash, a base64 picture never match)
runs in the window as the text changes; a line under the box names the kind, the value `maskSecret`ed (first 4, last
3), *Send as it is* (that exact text, a `Set` in memory) and *Pass as a secret*: `secretKeep` (`value`, `label`, `ws`;
refused from an agent; a phone's) writes it with `secretGive`'s `writeSecret` into the workspace's `.laki-secrets`
(no `ws`, a new workspace's prompt: `storageRoot()`'s own, tidied with the rest) and `secretLine` replaces the value
with its path. ⏎ with the line showing arms it (`guard`), ⏎ again sends: never blocked. Drafts are kept
`maskSecrets`ed (`useDraft`'s localStorage, `tabDraft`). `fileRead` with `storage` refuses a `.laki-secrets` path:
nobody reads one through Laki. Off: `settings.secretHint === false` (Settings › Agents & profiles; never an agent's).
Tested in `test/cli-agents.test.ts` and `test/units-more.test.ts`.

`daemon/alerts.ts`: `laki alert <text> [--title t] [--choice A]…` (MCP's `laki_alert`; `ALERT_WAIT`, 30 minutes, the
CLI's rpc waits as long): `alertShow` (refused with no app connected, from a workspace Recording mode hides: phone.ts
`hidden`, or past `RATE`, 5 a minute from each tab or from outside one; its words without `HIDDEN`'s characters) broadcasts `alert` (`id`, `title`: yours or the
caller's workspace · tab, a Markdown link's words only, `text`, `choices` up to 6, `tab`, and S10's `origin`: the
daemon's *message from agent · project › workspace › tab* (a terminal's, a script's in no tab, Laki AI's), never the
caller's); App makes it a card on screen (`notify`'s `card.alert`, a button per choice): main's `alert` tone, not an
ask's (ask.ts: its origin the first line, no *Waiting for you*, no choice styled as the main one). Without choices it returns `{ shown }`; with them it waits for `alertAnswer` (`id`, a `choice` of
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
A choice that grants a standing permission (`askScope(choice, agent)`: claude's *don't ask again for: npm init \**,
*always allow access to src/*, *allow all edits*; codex's and gemini's equivalents) is drawn with its rule on its own
line, whole, in the mono font (Diff.tsx `Choice`, `choiceProps`; ask.ts' and floater.ts' `scoped`): in Needs you, the
Reader, the ask bar (never cut there), the cards on screen and the island; `broad` (a wildcard, a folder, a whole tool)
in the warning color with `plain`'s words where they're safe. claude's hook's rule (`permOf`'s `rule`) keeps its
wildcard (`npm init *`, not `npm init`). A notification's action stays *Allow always* (`NotifyAction.scope` carries the
choice to the card); its body names the rule, and the body must fit whole for any action to show. `standing` marks
such a choice (agy's too: *… in this conversation*, *always grant*, *always deny … (Persist to …)*, *Use Auto mode until
you exit*, read from its binary's strings): `bulkPick` (Allow all, Deny all, the global hotkeys) never sends one, Deny
all and `denyOf` take the last plain no (`plainNo`), and `yesNo` refuses a menu whose first choice is one or that has no
plain no.

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
- **A size before the first output** (`begin`): the mirror takes it at once, the PTY as its program first prints (or
  `START_WAIT`, 1 s, for one that prints nothing). A shell still starting reads the size and writes it back as its line
  editor sets up (bash's readline: a get, then a set, before its first prompt), so a size set in between was lost: plain
  node-pty, bash resized 5 to 13 ms after its start, lost 5 of 3,000 under load (none at 0 ms). `test/shells.test.ts`
  resizes 50 new shells at once.
- **Exit**: a signal reports code 128+signal. A shell's exit, or a command's with code 0, closes its tab (`core.ts`
  `onExit`); an AI agent's (`tracked`), any code, leaves it with its screen and *press Enter to start it again* (a
  resume; the tab bar dims it, ✓), unless the daemon ended it: closing, archiving and shutdown drop the session from `sessions`
  first, restarting replaces it.

Kept chats (core.ts `keepChats`, at `wsArchive`): each claude or codex tab's transcript (share.ts `transcriptOf`) as
`<storage>/chats/<tab id>.jsonl`, a hard link where the volume allows (`linkSync`), else a copy; past 50 MB its newest
part from a line's start; a transcript whose real path isn't inside the agent's folder (its own or the account's,
`realpathSync`) isn't copied; `tab.kept` is the chat's id. `chatFile(tab)`: the agent's own file, else that copy (a
plain file, `lstat`: not a link the agent's shell put there), `kept: true`; meters.ts `tailOf` (the Reader, the meters,
shares: a file gone is looked for again at once) and `chatSearch` read through it, and a restored tab's old chat too
(`keptOnly`). `chatRead`'s `kept`: the Reader's *Kept by Laki*. `wsRestore` starts a tab whose chat is only in the copy
as a new session (`resumeId` dropped: resume needs the agent's own file); the Reader shows the copy above its New
session line (`fresh(was)`, `Reader.old`). The copies are in the storage folder: removed with it (`rmStorage`) or in the
trash with it (`trashSaved`); `storageFull` and `storageTidy` leave `chats/` out (Laki's own record); `storageInfo`'s du
counts them. Tested in `test/reader.test.ts`.

### Sleep

`resources.ts` `sleepTick`: an idle agent tab whose chat its next start resumes (`resumable`: claude, codex, grok, opencode and an ACP one by their id, agy by its id or as its workspace's only agy tab, `agy -c`; `sleepy`: `cantSleep` says nothing, no attached client, idle
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
named `"$LAKI_ARG_n"` (sh, bash, zsh and fish expand it whole; fish reads `\'` inside single quotes as an escape); S12:
the line starts with `LAKI_ARG_0= …` (not in fish, nor on a host): sh, bash and zsh expand the words first, so the
agent gets them whole and its own environment has them empty, and its children never inherit the prompt; on an
SSH host the generated `/bin/sh` script exports them. A preset's `args` stay as written. The environment adds:
- `TERM=xterm-256color`, `COLORTERM=truecolor`, `LAKI_APP=true`;
- an agent's `FORCE_HYPERLINK=1` (claude's links as OSC 8; an env may say 0; not shells': piped output would get
  them): `Session` snapshots keep them (`keepLinks`: the serialize addon drops them);
- `LAKI_WORKSPACE`, `LAKI_TAB`, `PORT`; `LAKI_TAB_TOKEN` (S12, a token per start: its `laki` calls' bearer, by which the
  daemon knows an agent tab's caller: `docs/dev/api.md`); `LAKI_HOOK` (a key per start, the Session's `hookKey`: `laki hook` sends it, and
  main.ts' `hookWho` takes a tab's state with its key only, else from a process of that tab or of none (`peerOf`: tests'
  direct `hook` calls), never another tab's; never from remote access, `REMOTE_NO`);
- `LAKI_STORAGE_FOLDER` (`storageOf`; `STORAGE_NOTE`, the start note's and the laki skill's words: files, and a
  link for each thing an agent publishes, kept in its `LINKS`, `.laki-links.json`; a `.url` file it saves is moved in, read by `urlOf`): the workspace's own folder for what its agents keep for you, `<settings.storageDir
  or <data>/storage>/<name>-<id>`, named and made at its first tab, kept as `ws.storage` (a rename doesn't move it); none
  for Terminals, Browsers and hosts. `wsRm` and `projectRm` (and `archivedTidy`) move it to `<storage>/.kept/<name>-<id>`
  (C5, `rmStorage`: only a `…<id>` folder; its `chats/` and `.laki-secrets/` dropped; `.laki-kept.json` its id, name, project, branch and
  when; hidden, so the storage tidy skips it), deleted instead with `wsRm`'s `dropArtifacts` or `settings.keepStorage`
  false (unset: on); archive keeps it in place. artifacts.ts' `keptList`, `keptOpen`, `keptRm` are Settings › Resources'.

B6: a project with `inRepo` (this Mac's state; projectSet's `inRepo`, the user's only) keeps its notes and memory in its
repo: `.laki/notes.md` and `.laki/memory.md` (core's `notesOf`, `memoryOf`, `notesSet`, `memorySet`, `memoryParse` and
`memoryText`: `- <date> · <id> · [learned · ]<text>`, newest first; a line written by hand is the user's, its id a hash
of its text). The view's project `notes` and `memory` are the checkout's files then (`p.notes`, `p.memory` kept as they
were: switching moves nothing). `memoryRoot`: an agent's workspace's own folder for its start (`memoryNote`'s `root`),
`memoryAdd` and `memoryRm` (their `tab`), else the checkout; memory.ts' compaction and Laki AI read and write it too.
`.laki` or a file in it as a link (a branch's `.laki/memory.md -> ~/.zshrc`) is never read or written through
(`repoFile`, `repoWrite`: lstat, one link only (no hard link), then `O_NOFOLLOW` without `O_TRUNC`, emptied once the open
file is still the one checked; a write says it isn't a plain file; `repoRead` the same way: `O_RDONLY | O_NOFOLLOW`,
the open file's fstat a plain one with one link and the same ino and dev as the path's lstat, 1 MB at most, else as if
missing). `test/repo-memory.test.ts`.

Claude and Codex are told about Laki at every start (`LAKI_NOTE` and Settings' global memory, then the project's, `memoryNote`, unless the preset's `laki` is false; then
`PROGRESS_NOTE` with `settings.progress`; one text through `--append-system-prompt` / `-c developer_instructions`, not when
the preset's args set their own, nor for codex when its `config.toml` has `developer_instructions` (`codexOwn`: `-c` would
replace them), not on a host): what Laki is, `laki rename .`, `laki pr .`, `laki new .`, `laki browser`,
`$LAKI_STORAGE_FOLDER` (`STORAGE_NOTE`: files, and a link to what it publishes). The CLI's `rename`/`pr` take `.` for `$LAKI_WORKSPACE` (`wsSet` name, `prAttach`).
The other agents get the same text (its byte cap and control-character filter are `memoryNote`'s), each its own way
(types.ts `MEMORY_HOW`, shown in What it sees): grok by `--rules` ("extra rules to append to the system prompt", from its
`--help`; each start, a resume too: not in the chat), OpenCode by its config's `instructions` (`OPENCODE_CONFIG_CONTENT`,
with a profile's own and its model: a 0600 file of the tab's, `<data>/opencode/notes/<tab>.md`, `memoryFile`, gone with
the tab), and agy, which has no flag or setting for it, in front of a new chat's first message (`memoryFirst`: fenced,
introduced as background rules, the task after it): its `-i` prompt, else the first message Laki types into it (the
tab's `noteDue`: `send` and a queued one's `deliver`, `noteFirst`); a resumed agy chat isn't told again.

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
`$LAKI_WORKSPACE`'s workspace; `allowed-tools` lets it run only that `laki new` unasked); the laki skill's more.md says the same for the other agents.

The skills (skill.ts `files`, A1): a skill loads whole each time it triggers, so each SKILL.md holds what every use
needs (under 8 KB: `test/daemon.test.ts`) and names files beside it, written with it, for the rest: the laki skill's
`commands.md` (USAGE; `laki help <command>` first), `more.md` (PRs, `laki show`, `laki-ui`, secrets, alerts, extensions'
tools, specs, memory, `/laki:new`, SSH, issues and PRs), `workflows.md`, `schedule.md` and `browser.md`; laki-widget's
`widget-json.md` (every key), `ui-kit.md` (the elements) and `widget-html.md`, cut from `widgetFormat` by its `##` heads
(`/laki:extension` and Settings' prompt keep the whole guide). `installed` means every file matches, as before.
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
| PermissionRequest | waiting, and the tab's `perm` (the tool, what it touches, the rule, an Edit's, MultiEdit's or Write's change: `permDiff`, a Write's file read first only inside its workspace, `priorOf`): prints nothing, so claude asks in its own menu. F15: one that touches a glob of the project's `alwaysAsk` (shared/ask.ts `alwaysAskOf`: an Edit, Write or MultiEdit of it, a Bash command naming it) is held from every rule (runtime `held`, the view's `tab.held`: its card's *Asked because it touches*; logged); your Allows in a row of one kind (`streakOf`: a command's first words, a file's folder; never a risky, chained or outside one, nor an interpreter or shell's first word alone, `RUNS_CODE`: `node -e …` would make a rule of `node`) are counted per project in `state.askStreaks` by main.ts' `answer` and a phone's tap (phone.ts) only (a rule's own Allow isn't), and at `STREAK_AT` askStreak.ts shows one notice with choices (Make it a rule: `projectSet`'s allow; No; Don't suggest again: `state.ruleNo`), each logged; a Deny resets its count, `streakReset` (a failed Done check, `turnUndo`, `turnRewind`, `hunkUndo`, `fileUndo`) the project's. F14: one a project rule matches (`project.allow`, shared/ask.ts `allowRuleOf` by tool and what) isn't told (`told`: Do not disturb, clients, phone, turn.waiting); core's `autoAllow` waits up to 3 s for its menu, checks it again with the menu (yes first, no last), then `answer`s the first choice, counts `hits`, logs it (daemon.log, the workspace's) and keeps it on the tab (`allowed`, the last 20: the Reader's *allowed by rule*); one it can't answer is told as any |
| Notification (permission prompts) | waiting |
| Stop | idle, plus the last answer, then delivers the next queued message; with `background_tasks` of agents still going (subagent, workflow, teammate: `bgAgents`), running instead (`Runtime.bg`: no ●, no done notice, no turn's end; sweepRunning leaves it `BG_MAX`): they report back as a new turn |
| StopFailure | usage limit (`limits.ts`) |
| PreCompact | running and `compacting` (the tab and row say *Compacting…*) until its next hook (SessionStart, source compact) |

Codex gets `-c notify=[…,"hook","done"]`, which reports the thread id and the end of a turn.

Looping (`shared/loop.ts`, core.ts `loopCount`): claude's Bash PostToolUse and PostToolUseFailure (not a subagent's,
not a late one, not an Esc's `is_interrupt`) feed `loopFeed` through `setImmediate`, after the hook has its answer. The
command normalized (`loopCmd`: whitespace collapsed, a leading `cd … &&` dropped, numbers in `/tmp` and `/var/folders`
paths masked) failing with the same first 200 characters of error (normalized the same way) 3 times in a row (among
Bash calls) or 5 times in a turn sets `Runtime.loop` `{ cmd, n, since }` once per spell, `n` kept up after; the view's
`tab.loop` while it runs (`needAt` its `since`). A success of that command clears it, `failDismiss` (Needs you's *Let it
work*) clears it and sets `loopLet` (none again this turn), a turn's start or end (`loopEnd`) forgets everything. As it's
set: a line in the workspace's log, the `loop` event (useDaemon: a notification unless `settings.notifyOn.loop` is
false, the tab is on screen and focused, or muted; Quiet: `notify`'s) and `phoneLong(…, 'loop')` (the same switch, drawn
without macOS's disabled state; held at the Mac, `holding`; its title the workspace and tab, the command, redacted,
the push's question: *titles only* drops it). Needs you's card (`failedNeed`, `needsTab`): *Nudge* (askText with the message, then `send`
steer), *Stop* (`stopAll` with its tab), *Let it work*; no ✕ or Snooze (any hook of a running turn ends a snooze). The
sidebar row's `ws-loop` mark says *looping ×n*; the Board puts it under Answer (`boardCol`), its next step is *<tab>
loops* (opens the tab), ⌘K's Needs you item says it loops; a running loop is never stale (`isStale`). Only claude's hooks say a call failed: codex's notify, OpenCode's plugin
(busy, idle, asks, errors), Antigravity and Grok (no hooks) and ACP (its `tool_call_update` failed is the Reader's, not
a hook's) never set it. Tested in `test/loop.test.ts` and `test/loop-daemon.test.ts`.

Hooks not heard (core.ts `hookTick`, every 30 s; `daemon/hookHealth.ts`): a live tab on this Mac of an agent whose hooks
say as a turn starts (`HEARS`: claude, opencode; codex's notify comes only as one ends), its session started
`DEAF_AFTER` (2 minutes) ago, given a prompt (`prompted`, per Session: `typeInto`'s Enter, a typed Enter in `input`, its
start's) that its screen answered (`Session.lastOutput` since), and no hook from this start (`heardIn`, per Session: a restart under a moved app is checked anew): its view's `hookless`
is `hookCause`'s first that holds: `disableAllHooks` or `allowManagedHooksOnly` true in the worktree's
`.claude/settings.local.json`, `.claude/settings.json`, its config folder's (an account's, or `CLAUDE_CONFIG_DIR` from
an env), `~/.claude/settings.json` or the managed one (read only; the file and line as `detail`); the profile's args with
their own `--settings`; `CLAUDE_CONFIG_DIR` in the profile's, project's, Settings' or the daemon's env (no account);
`hookArgv`'s node or script gone or not executable (a moved app under a daemon that outlived it); else unknown. Any hook clears it (`hook`, `heard`: each agent's last, `hooksSeen`). panels.tsx `HookStrip` at
the pane's foot (Details, Copy; Dismiss: App's `hookHid`, per tab, in memory); `doctor`'s `hooks` runs `hookArgv` `hook
ping` (hook.ts exits 0 before any RPC) and `hookFiles` reads `hookFiles(localHooks)`' files back: Welcome's rows. Tested
in `test/hook-health.test.ts` (the fake claude runs no hook with `disableAllHooks` in `$HOME/.claude/settings.json`).

The other agents (`AGENTS` in `shared/types.ts`: the command is the id, `agentBin`, but gemini's `agy`; `presets()` defaults to claude,
codex and those on PATH):
- **Antigravity** (the `gemini` agent, Gemini CLI's successor; the id stays for saved profiles and tabs): `agy -i
  <prompt>` (`-p` answers and exits), `--conversation=<id>` after: the id it prints as it exits (*Resume with -c …: agy
  --conversation=<id>*, `agyResume` on the last 12 lines as the session ends), else `agy -c` (its folder's latest: the
  worktree is the workspace's own). `--model`, `--effort`, permission modes as `--mode accept-edits|auto|plan` and
  `--dangerously-skip-permissions` (`PERMS`). Hooks only from `~/.gemini/config` or the repo's `.agents` (files Laki
  doesn't write), so none: it sends OSC 7501 once the terminal answers its query (Session does), and `programSeen`
  makes the root's state the tab's status (working: running, blocked: waiting, idle, done or error: idle), for any
  agent with no hooks (not `HOOKED`, no `Runtime.hooked`, not an ACP one); `sweepRunning` leaves a tab with a root
  record alone. Its ask's menu is read off the screen. Its version: `agy --version`, its update `agy update` (no npm).
  No plan-limit meter (Gemini CLI's quota went with it).
- **OpenCode**: `opencode --prompt <p>`, `--session <id>`; a model in `OPENCODE_CONFIG_CONTENT` (`{"model": …}` over a
  profile's own of it), never `-m` (some versions' TUI refuses it). `OPENCODE_CONFIG_DIR=<data>/opencode` (on top of the
  user's config) loads `plugin/laki.js` (`OPENCODE_PLUGIN`): session.created (not a subagent's: `parentID`) →
  start, session.status busy/idle (idle with the last answer, from `client.session.messages`),
  permission.asked/question.asked → waiting, session.error → failed (an Esc's `MessageAbortedError`: interrupted), and
  the idle after either says nothing; reports go one at a time, in order.
- **Grok**: `grok --session-id <uuid> <prompt>`: Laki picks the chat's id, `--resume <id>` after. Its TUI takes hooks
  only from `~/.grok` (or `~/.claude/settings.json`), so it has none: Enter or a prompt sets running; `sweepRunning`
  reads its window title (`Session.title`: `BUSY` while it works, `ASKS` "Action Required": waiting) and ends the
  turn after `QUIET` with no `BUSY` text, as a hook would (a done notification; a turn started by Enter only after 8s, `Runtime.since`: likely a menu). An agent whose
  hooks never come too, unless it speaks OSC 7501 (`Runtime.hooked`: a hook came from the tab; `turn` is `hook` without marking it).

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

Settings' MCP servers (#6, `settings.mcp`: every project's; `mcpAll` puts a project's after them, the same name the
project's; `settingsSet` keeps them through `mcpOk` too, `maskSettings` masks their env, `envKeys.ts` keeps a secret's
value out of state.json, and an agent or remote access can't change them: `AGENT_SETTINGS_NO`, `REMOTE_KEYS`). OpenCode
gets them in `OPENCODE_CONFIG_CONTENT`'s `mcp` (`openCodeMcp`; env as `environment`, in its environment, never argv).
`mcpImport` (sees.ts, the user's: AGENT_NO, REMOTE_NO) lists the agents' own (claude's `~/.claude.json` user servers,
codex's `config.toml`, agy's `~/.gemini/settings.json`, opencode's `opencode.json`; `mcpFrom` in Laki's shape) masked,
then copies the picked ones (`pick`: `agent:name`) whole, daemon side; theirs are never written. A claude profile's
`mcpOnly`: `--strict-mcp-config`, Laki's own server (`lakiMcp`) in a file of its own unless one is named `laki`.

A project's MCP servers (`config.mcp`, `shared/mcp.ts`; Settings › the project › *MCP servers*): each a name
(`MCP_NAME`), a command with its args and env or an http(s) URL, and the profiles it's on for (`presets`: none is all).
`projectSet` keeps them through `mcpOk` (a masked env value back is the same-named server's; refused whole otherwise);
agents can't send `config` and remote access's page can't change `mcp` (main.ts `SCRIPT_KEYS`). `agentCmd` passes the
ones on for the tab's profile (`mcpFor`) as it starts, this Mac's tabs only: claude one more `--mcp-config` of a 0600
`<data>/mcp/<tab>.json` (`mcpFile`, gone with the tab), codex `-c mcp_servers.<name>.command|args|url` (`codexMcpArgs`:
TOML strings quoted by `tomlString`); an env's values never on argv: `codexMcpArgs` gives them back as `env`,
`LAKI_MCP_<i>_<NAME>` (the server's index), which `agentCmd` puts in codex's environment, with `env_vars` naming them
(codex 0.171: names forwarded from its environment, not renamed, so the server's command is `/bin/sh -c 'export
NAME="$LAKI_MCP_<i>_<NAME>"; unset …; exec "$0" "$@"' <command> <args…>`, names only). Laki's note
(`developer_instructions`) stays on argv: codex reads it from config only (checked on 0.171: no env var or per-run file;
`-p` reads `$CODEX_HOME/<name>.config.toml`, in `~/.codex`, never written; `model_instructions_file` replaces its own
prompt instead); SECURITY.md says so; gemini, grok and opencode none yet (the page says so). What it sees lists them as
`scope: 'laki'`, *from Laki*.

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
`autoAllowBashIfSandboxed`, `excludedCommands`: `laki *` and `LAKI_CLI`, so the CLI reaches the daemon; S6: the data
folder in `filesystem.denyRead`, `allowRead` giving back `images/`, `files/`, the storage folders and `worktrees/` when
they're in it, and the Read tool's deny rules each other entry of it plus `DATA_SECRETS`: claude's allow rules can't
carve out of a deny; hooks and the status line run outside the sandbox, `laki` calls with the tab's token) and `--add-dir`,
first (it takes every word up to a flag), for each folder `git commit` writes in (`gitWrites`, from `.git` and
`commondir`, realpath'd: a worktree's own folder, the index and HEAD, and the shared `objects`, `refs` and `logs`; never
the shared `hooks` or `config`, which git runs outside the sandbox, Laki's own git included; the repo itself, a local
workspace: its `objects`, `refs` and `logs` only, so its index, HEAD, hooks and config stay read-only and `git commit`
there runs outside the sandbox); codex `codexBox`: `-s workspace-write` unless its mode or flags pick a sandbox (read-only
stays; an approval flag like `-a never` picks none), `sandbox_workspace_write.network_access=true` and `writable_roots`
with those folders, a worktree's own folder as the files git writes there (`OWN_WRITES`: the index, HEAD, a merge's
files, `SQUASH_MSG`, each with its lock, `logs`, `refs`; and the repo's `packed-refs`, its `.lock` (else each commit says it can't lock it) and `.new` (a rewrite: a packed branch deleted, `fetch --prune`)), never the folder: its `commondir`, `gitdir` and `config.worktree` say where git
finds the repo and its config, so one the agent wrote (`core.fsmonitor`, `core.hooksPath`) would run as you in Laki's
scans and your git (a nested repo the agent makes in its worktree has a config of its own, out of reach of all this: `exec`'s and `turns.ts` `g`'s `noNested` keep git out of it by flags, `files.ts` `treeOf` takes gitlinks off its index first, as `add -A` has no flag, putting a submodule never checked out back after, Ship stages `treeOf`'s tree with `read-tree --reset` (a host's worktree too: `treeOf` runs there over ssh, `gAt`, its index `turnIndex`, in `~/.laki-host/<mac>/turns`) and refuses, before its script, a gitlink that isn't both in the merge base with `ws.base` and in your own checkout's index, which the sandbox can't write as it can refs (`nestedRepos`, by path; a submodule new on the base waits until your checkout has it), and a real submodule whose `.git` isn't git's own for it, a file naming a folder under the worktree's git dir's `modules/` (`swapped`: a repo put in its place). Then no git of Ship's goes into a submodule: `gh pr create` always gets `--head` (`<origin's owner>:<branch>` when a repo was picked with `gh repo set-default`; without it gh runs plain `git status`) and `--base` where origin has the workspace's base, `glab mr create` its `--source-branch` and `--target-branch`; the index their git reads, `<data>/turns/<ws>.ship` (Laki's, out of the agent's reach), has its gitlinks taken off, so a status of theirs enters none, whatever its config is by then (a sandboxed claude can write a real submodule's: `modules/` is in the folder `--add-dir` gets); and the script exports `GIT_CONFIG_COUNT`/`KEY`/`VALUE` with `core.fsmonitor=false` for every git it starts, a submodule's child too (git hands them on). Not `core.hooksPath`: Ship runs your pre-commit and pre-push hooks, as before. ponytail: your `push.recurseSubmodules=on-demand` still pushes inside a submodule, under its config. A folder project's git is refused there too, and `boxNo` refuses `projectAdd`); a rebase's or cherry-pick's sequence (`rebase-merge`, `sequencer`: a todo's `exec`) is left out too
and asks, as do `git stash` and `git commit <paths>` (their temp index is named by its pid: `index.stash.<pid>`,
`next-index-<pid>.lock`) (codex keeps that folder and `.git` read-only itself; checked with `codex sandbox`, 0.162.1). claude gets the folder
(`--add-dir` takes folders): its sandbox keeps `.git`, `commondir`, `config.worktree` and `.git/config` read-only itself
(2.1.319, checked with `claude -p`). ponytail: an older claude's isn't checked, and claude's leaves `rebase-merge`,
`sequencer` and `modules/` writable there (a todo's `exec` runs as you when you continue that rebase): Ship and Update
refuse a worktree whose own git folder has one (core.ts `gitTampered`, `gitGuard`: a todo's `exec`/`x` line, a
submodule config's `core.fsmonitor`, `core.hooksPath`, `core.sshCommand` or an include), your own git in a terminal
doesn't. Hooks
and codex's notify run outside the sandbox (the agent's own runner), so `laki hook` isn't touched. ponytail: a host's git
folders aren't added. A new install's default profiles (`presets()` with no saved list) start claude and codex in their
sandbox (claude's network on its list, `net: 'list'`): `settings.sandboxNew`, set by `load` only when there was no state before (a test's daemon only with
`LAKI_TEST_LEAN=1`, as Labs; one from before stays unset, its
profiles as they were; a phone's or an agent's `settingsSet` can't change it: REMOTE_KEYS). A command the sandbox
stopped (`sandboxStop`: claude's `PostToolUseFailure` for Bash whose `error` has the sandbox's words, `SANDBOX_DENIED`,
or its `PermissionRequest` to run one again with `dangerouslyDisableSandbox`) is the tab's `boxed` (`{ cmd, why }`, while
waiting or idle, until its next prompt): its Needs you card says so and offers *Restart without sandbox*, which asks
first, then `tabUnbox` (the user's: AGENT_NO, REMOTE_NO) sets the tab's `sandbox: false` (its profile keeps its own) and
starts it again, its chat resumed. ponytail: codex's denials reach no hook, so it gets no card.
The macOS wrapper sandbox (a profile's `wrap: 'macos'`, `shared/wrap.ts`; Settings' *Wrapper sandbox (macOS)*, `laki
preset set <name> --wrap|--no-wrap`): for an agent whose own sandbox is off or that has none (wrap.ts' header lists each
agent's, from its docs: OpenCode has none; agy's `--sandbox` and Grok's are theirs, off unless a profile's flags (Grok's env too) turn them
on, `ownBoxOn`). core's `wrapped(tab)` (a Mac, this Mac's workspace, not `sandboxed`, not `ownBoxOn`, the tab's
`wrap` not false) makes `agentCmd` return `wrapCmd`: `<sandbox-exec> -p "$LAKI_SB_PROFILE" -D "$LAKI_SB_D0" … /bin/sh -c
"$LAKI_SB_CMD"`, the profile and every path in the tab's env, never in the line. `wrapProfile`: allow default, deny writes
but the worktree, `gitWrites`' folders, /tmp and $TMPDIR's folder, the agent's own (`AGENT_WRITES`), its storage folder, its
account's folder, claude's status line folder; deny reads of Laki's whole data folder (`file-read-data` only: its files
and listings, never a stat, so a worktree or storage folder in it is still walked to; trusted clients' tokens and any
secret added later too), read back what it works in that's in it and `wrapReads` (claude's settings and plugin,
opencode's folder, statusline.sh, pasted `images/` and `files/`), its account's folder and its project's
checkout (a repo in the data folder, the sample: git reads its `.git`); then deny reads of
`SECRET_HOME` and every other agent's folders (as `file-read*` and `file-read-data` both: macOS gives a `file-read-data`
rule the win over a `file-read*` one, wherever it is); each path `realOf` (realpath, or its nearest folder's) and a
`-D P<n>=<path>` (`test/units-more.test.ts` runs the profile under the real sandbox-exec). Its network (`net`, `WRAP_NET`: `all`, unset,
as it is; `list`): `(deny network-outbound)` but `(remote ip "localhost:*")`, a unix socket's denied too (DNS, ssh-agent),
and the tab's env gets `HTTPS_PROXY`, `HTTP_PROXY` (and their lower case, curl's) as `daemon/netProxy.ts`' URL for it,
`NO_PROXY=localhost,127.0.0.1`. netProxy: node:http on 127.0.0.1, one per daemon (`netProxyUp` before `restoreAll`,
main.ts), a CONNECT or a plain http request answered only with the tab's own `Proxy-Authorization` (Basic, its id and a
password new each start: `proxyFor`; another tab's or none: 407) to a host on its list now (core's hook: `netList` as
claude's, its project's `netAllow` read at each request, `hostOn`: the name or a `*.`'s subdomain); else 403 and its
card (`boxed` with `host`, `wrap`: *Allow this domain in this project*, `projectNetAllow`, the user's alone, AGENT_NO).
Any port of a listed host (a list is hosts only, `NET_HOST`); a CONNECT's port outside 1 to 65535 is 400 before
`connect` (which throws there, synchronously: in the listener that was the daemon's uncaughtException), and any other
throw of `connect` is a 502 (plain http's `new URL` refuses a bad port itself: 400). A listed name is looked up once
(`target`: netAddr.ts' `publicAddr`, the hooks' `lookup` in tests) and refused, 403 and no card, when an address is this
Mac's, a private network's, link-local (a cloud's metadata), or none; no such host is 502. The connection then goes to
the address checked (CONNECT's `connect`, plain http's `lookup`), so a second lookup can't rebind it. `localhost` by
name is this Mac's, never looked up, but not the daemon's port (core's `ports` hook) nor the proxy's own.
Its port and passwords in `<data>/net-proxy.json` (0600, `DATA_SECRETS`): the next daemon listens on that port again and
a kept terminal's URL (the pty host's) goes on; `proxyDrop` as a tab closes. `MODEL_HOST` has gemini's, grok's and
codex's sign-in hosts for a wrapped one (OpenCode's provider: its card). `test/net-proxy.test.ts` (the proxy alone),
`test/presets.test.ts` (a wrapped agy's). `LAKI_DAEMON_PORT` in its env: its laki calls go with its
tab's token, daemon.json unread (conn.ts `daemonInfo`). No sandbox-exec (`sandboxBin` on PATH; a test's
`LAKI_TEST_NO_SANDBOX_EXEC`): the tab doesn't start, a notice and the workspace's log say why. A write it refuses
(`wrapRefused` in the tab's output: *Operation not permitted* for a path out of the worktree) is `boxed` with `wrap: true`:
the card's *Restart without the wrapper* (`tabUnbox`: the tab's `wrap: false`). An agent's `presetSave` can't touch `wrap`
(main.ts' `agentNo`); `presetSave` refuses it with the agent's own sandbox on (`test/presets.test.ts`, `test/units-more.test.ts`).
The daemon's own environment is its starter's (conn.ts `ensureDaemon` spawns it with `process.env`), less
`shared/env.ts` `STARTER_ENV`: `daemon/starterEnv.ts`, main.ts' first import, deletes those names from `process.env`
once, before any other module loads (a git hook's `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_PREFIX`, a tool's `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`,
`GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`; `FORCE_COLOR`, `NO_COLOR`, `CI`, `INIT_CWD`, `npm_*`), so its git and gh,
extensions' runs and every tab (`plainEnv` then drops `ELECTRON_*`, `LAKI_*`, `CLAUDECODE`, `CLAUDE_CODE_*`) start
without them; `doctor`'s `starterEnv` names them, never their values (`test/api.test.ts`, daemon start). PATH, HOME,
SSH_AUTH_SOCK, LANG and proxies stay.
`settings.hideSecrets` (Settings › Agents & profiles; a new install's on, `load`, a test's daemon only with
`LAKI_TEST_LEAN=1`; one from before is asked once by a notice, main.ts, `hideSecretsAsked`): an agent tab's environment
(`childEnv`, not shells, setup or Run) is `shared/env.ts` `envSplit` over `plainEnv()`: `SECRET_ENV`'s names held but
`HARMLESS` and `envAllowOf` (`AGENT_KEY_ENV`, the agent's own sign-in key, and the profile's `envAllow`, its *Let
through*); Settings', the project's and the profile's env go on top as ever. `agentContext` (What it sees) gives
`held` (names only) and `profile`, whose *Allow for this profile* is `presetSave`'s `envAllow`; `doctor`'s `secrets`
counts them. An agent's `hideSecrets`, `hideSecretsAsked` (AGENT_SETTINGS_NO, REMOTE_KEYS) and `envAllow` (`agentNo`) are refused.
A sandboxed profile's `net` (`Net`: `all` unset, `list`, `off`; `NET_OK` per agent, `NET_NO` why not; `presetSave` refuses
the rest, an agent's `net` refused by `agentNo`). From the agents' docs (Nov 2026): Claude Code's sandbox routes a
command's connections through a proxy that checks each host against `sandbox.network.allowedDomains` (empty by default:
a new host is asked about) and names a refused host in the command's result; it has no switch for no network at all.
Codex's workspace-write has only `sandbox_workspace_write.network_access` (on or off); its domain list sits behind the
experimental `features.network_proxy`, not used here. So: claude's `list` is `netFile`, `<data>/net/<tab>.json` (0600,
written at each start, out of the sandbox's reach): the `-sandbox` variant with `allowedDomains` from `netList` (the
registries the worktree's files show, `REGISTRIES`, GitHub and its API, the agent's model host, `localhost`, then the
project's `netAllow`); `all` is the variant as it is; codex's `off` is `network_access=false` (`codexBox`). A refused
host (`sandboxStop`: `Connection to <host> blocked`, from PostToolUse's output or PostToolUseFailure's error) is
`boxed.host`; the card's *Allow this domain in this project* is `projectNetAllow` (`{ project, host, rm? }`, `NET_HOST`,
the user's: AGENT_NO, REMOTE_NO). ponytail: a host's tabs (ssh) get the variant without the list; a closed tab's file
stays until the data folder is tidied.
`fast` (`FAST`: claude's `--settings` is `claude-settings-fast.json` (or `-fast-gated`), the same with `fastMode`; codex `-c
service_tier="fast"`); the new-workspace page sets them (a race's agents keep their own). A tab's unset `perm`/`fast`
is its profile's, read at each start; `''` (*Ask first*) and `false` are none over the profile's (`addTab` keeps them):
the page shows the profile's as picked and sends only a change from it (`permSent`, `fastSent`). A profile whose `args`
set a mode (`permInArgs`: claude's `--permission-mode`, `--dangerously-skip-permissions`; codex's `-s`, `-a`,
`--full-auto`…) gets none of Laki's, the page no picker, Settings' select off. `view` gives a running or waiting tab `runAt`, its turn's start (set
there: each change of status comes with `changed()`), for the turn timers (`settings.timers`).

### Interrupts

Esc or ⌃C ends a Claude/Codex turn without any hook. `input` sees the key and `interrupted` checks the
bottom 15 lines for "Interrupted" or claude's "User declined to answer questions" (an Esc on AskUserQuestion's menu),
below any line that says it still works (`BUSY`) and, for a waiting tab, with no menu left (`Session.ask`), a few times
over 12s; a `running` hook in between cancels it. The ask's `perm` goes with it. A turn can also end
with no hook and no key (a resumed chat's recap): `sweepRunning` (every 2s) sets a running tab idle after 4s
without output when its last 15 lines lack "esc to interrupt" (claude and codex show it, and redraw, while
they work).

`send`'s `mode` (#4, core's `sendMode`; `laki send --queue|--steer|--interrupt`, MCP's `laki_send` `mode`): to an agent
at work (running, no limit, awake, under its cap) `queue` is `whenIdle`, `steer` is `send`'s own `steer` where the
tab's agent reads what's typed while it works (claude's and codex's, its profile's `steer` not false: `steerable`;
a queue ahead of it still queues it), else it's interrupted: Esc (`input`), up to 5 s for `idle`, then typed ahead of the
queue (deliver waits 800 ms after a turn's end, and finds it running). An idle agent gets it now; one that asks
something, is at a limit, asleep or over its cap is never stopped (`send`'s rules queue it); a terminal: now.

**Suggested tasks** (#5, `daemon/suggest.ts`): `suggest` (an agent's, `laki suggest`, MCP's `laki_suggest`) adds a
`Suggestion` to its tab's workspace (`Workspace.suggests`; no agent caller: `ws`); the same title while open is that
one (`again`), a dismissed one's title is refused, `withdraw` takes back one not answered. `suggestAnswer` (yours:
AGENT_NO, ANSWER_NO) starts it (`wsNew` in its project with its prompt and title, no `fromTab`), dismisses it, or marks
it `started` with the workspace New workspace made (Edit first: the renderer's `newInit.suggested`). The answered stay,
`SUGGEST_MAX` of each, so neither comes back. The card: panels.tsx `SuggestStrip` under the tab that suggested it (gone:
the workspace's first agent's), a bulb on its row.

A turn that ends on an API error (`turn`'s `failed`, not a limit, a refused model or an Esc) keeps its line in `r.failed` (the view's `failed`, only while idle) until a new turn or `failDismiss`: the Reader, Needs you, One next step and the palette offer Continue, which is `send`'s `continue`. `settings.continueOnError`: `continueLater`, once per turn (`autoContinued`, `contSent`: a UserPromptSubmit that isn't its continue starts over), `LAKI_CONTINUE_MS` later, never in a workflow's tab.

A running claude's permission mode: the footer (`claudeMode`), `tabMode`, the chip (`Reader.tsx` `modeItems`, also the tab's menu). S9: `claudeMode` says `default` only with the footer on screen (`FOOT_SEEN`: the input box's rule or `>` prompt, or `? for shortcuts`); without it (a transcript view, a menu, a start not drawn yet) it's `undefined`: the tab keeps the last mode seen with `modeUnknown` (the chip reads *Mode unknown*, its tip the last one), and `tabMode` refuses to press from a mode it can't read. ponytail: the marks are from Claude Code's screens as known in Nov 2026; a build that draws none of them would read as unknown. Not kept across a restart: a resume starts as `t.perm` says. An agent's `tabMode` is refused, and so is the key itself (main.ts `shiftTabNo`, for `input` and `send`: `SHIFT_TAB`, and `keyTail`, per tab, for an Esc in one call and `[Z` in the next, `queueNow`'s Esc too, moved only by `input` as a `send` may just be queued; a plain Esc goes through; `send`'s own escapes are stripped by `typeInto`, `noKeys`). ponytail: only those bytes: a key rebound in claude's `keybindings.json` or a slash command typed isn't.

### Resume

Settings › Terminal › *Shell* (`settings.termShell`, core.ts `termShell`, `termShellOk`): a local shell tab starts that
shell with `-l` and `$SHELL` set to it; every other tab (agents, setup, dev, script, ship), the editor command, Done
check's and workflows' commands and teardown stay on the login shell (`shell`). Only shells whose quoting Laki knows
(`shared/shells.ts` `SHELL_KINDS`: the POSIX family, fish, nu), an absolute path that is an executable file; checked in
`settingsSet` only as it changes (Settings sends every setting back, one gone since too). Gone at a tab's start: the login
shell, daemon.log's line and once a run a notice. `termShells`: `/etc/shells` and `SHELL_DIRS`' shells that run, the
login one, or `check` one path (Settings' picker checks before it sets, so a bad one never holds back the rest). The
user's alone: AGENT_SETTINGS_NO, REMOTE_KEYS.

`state.json` keeps projects, workspaces, tabs and resume ids (`save`: `v` stamped (`STATE_V`), fsync, rename, the folder
fsynced; `load` copies one that reads as today's `state.json.bak-YYYY-MM-DD` (R7: one a day, the 7 newest kept), and
moves one that doesn't to `state.json.broken-<ms>`, then loads the newest backup that reads (then 0.47's `.bak`): never
empty over it). One with a higher `v` than this build's (a newer Laki's) is copied to `state.json.v<N>` before the first
save, and the view's `newerData` puts a bar over the main area. The other stores (R7, conn.ts): `writeAtomic` writes a
temp file of its own (pid and random), fsyncs it, renames it over (a link followed, the mode there kept) and fsyncs the
folder: AI chats, prompt history, workflow files, extension files and the editor's saves go through it. `readJson` sets
aside one of Laki's own stores that won't parse (`OWN`: the data folder's JSON files, `notes/`, `ai-chats/`,
`widget-data/`, `turns/`) as `<name>.broken-<ms>`, logged once; any other file (an account's `.claude.json`, a repo's
`.laki.json`) is only read. `ai-calls.jsonl` and `memory-compact.jsonl` rotate as `daemon.log` does (`rotateLog`). `daemon.log` goes to `daemon.log.1` past 10 MB when a daemon starts and each hour while it runs (conn.ts `rotateLog`, main.ts' `logTick`: copied and cut there, since the daemon's stdout holds it open). A full disk (R4): core.ts `save` catches `ENOSPC`/`EDQUOT`, keeps the state in memory, sets the view's `diskFull` (`{ free }`: App's bar over the main area, to Settings › Resources) and tries again at each save and every 30 s (`diskTick`); `worktreeAdd` refuses under 500 MB free (`roomFor`, `statfs`). The app's main process has its own `app.log` beside it (`logLine`: uncaught errors, a renderer or helper process gone, a window that stopped responding; after 10 s of that a dialog offers Wait or Reload). Starting the daemon brings every tab back:
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
and neither does a host. A shell tab's screen (#S1, `screens.ts`): `screensSave` every `LAKI_SCREEN_SAVE_MS` (5 min) for a
shell whose `lastOutput` moved since its last save, and with `all` in `shutdown`, writes `Session.saved()` (the serialize
addon's text, colors and scrollback, no modes; none while the alternate screen is up) to `<data>/screens/<tab>.txt`,
0600 (the folder 0700, in `DATA_SECRETS`), its last `SCREEN_MAX` (200 KB) bytes; a Private workspace's or project's
isn't written (one made Private since: removed), `closeTab` removes a tab's (`screenForget`), and each save prunes the
files of tabs gone. `restoreNow` of a shell with no terminal behind it (not ptyAdopt's) writes `screenBack` into its
mirror first (`Session.prelude`, muted: its old queries unanswered): the text dimmed (each SGR followed by `\x1b[2m`),
then `──── before the restart, <time> ────`, then the new shell's output.

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

### Terminals that outlive the daemon (R6, `settings.ptyHost`; on for a new install, R9)

node-pty's children belong to the daemon (session.ts), so a crash or a restart ends every turn. With
*Terminals outlive the daemon* on (Settings › Git & worktrees › In the background), new tabs' terminals live in a pty host.

- **The pty host** (`src/ptyhost/main.ts`, its own build entry `out/main/ptyhost.js`): one small process that owns the
  ptys and the last 2 MB each printed. No state.json, no git, no hooks; it reads no file. The daemon starts it detached
  when missing (`daemon/ptyHost.ts` `ptyUp`: as the setting is turned on, and as a daemon starts with it on: then from
  `daemon/ptyEarly.ts`, main.ts' second import, as the daemon's other modules load, so its ~100 ms run beside theirs and
  `ptyAdopt` dials it; only the daemon's own entry, with state.json's setting on or no state.json, no socket there and no
  other daemon's lock; dialed every 10 ms for its first 200 ms, then every 100, 5 s in all); its log is
  `<data>/ptyhost.log`. It ends with `quit` (a stop), with no live terminal and no daemon for 10 minutes
  (`LAKI_PTY_IDLE_MS`), with no daemon at all for 3 days whatever still runs (`LAKI_PTY_ORPHAN_MS`), or in tests once
  `LAKI_TEST_PARENT` is gone.
- **Protocol** (`src/ptyhost/proto.ts`): a unix socket `<data>/pty.sock` (0600; in the temp folder by the data folder's
  hash when that path is too long for a socket), frames of a 4-byte length and JSON. Ops: `hello`, `list`, `spawn`,
  `attach { id, from }`, `write`, `resize`, `kill { id, signal }`, `forget`, `quit`; events: `spawned`, `data` (`at`: its
  offset in that pty's output), `exit`, and the replies by `re`. Anything else is nothing. A connection's first frame
  must be `hello { token }`, the host's secret (`ptySecret`: `<data>/pty.secret`, 32 random bytes as hex, 0600, written
  atomically as it starts listening, removed as it quits; always in the data folder), compared with `timingSafeEqual`;
  anything else, a wrong token or 64 KB or 5 s without it, closes it before any op runs, and one not in yet holds no
  place. One daemon at a time: while one is connected every other connection is closed at once. A daemon turned away (its `hello` answered with no version) tries again for 3 s (`up`'s tries): the one before it, on its way out (`laki stop --keep`, an update, a crash), lets go a moment after its `daemon.json` goes, and the data folder's lock never has two live.
- **The daemon's side.** `Session` takes a `Pty` (node-pty's, or `HostPty`): `spawnTab` gives it a `HostPty` when the
  setting is on and the host is up; a `HostPty`'s pid is -1 until the host says, and the host signals the job (`group`).
  A host that goes ends its terminals with a line saying so, and is started again for the next ones.
- **A lost connection** (`regain`: a bad frame or a refused one closes it while the host runs on): with terminals open,
  they're kept, nothing told exited, while it's dialed again at 0.1, 0.4, 1.2 and 2.2 s (`GRACE`, 3 s; `up`'s `start`
  false: a host is never started for it). Back on the same host (its pid), each `HostPty` attaches again from its
  `offset` (where its output got to here: the `attach` reply's and every `data` frame's `at`; `again`), what it printed
  meanwhile drawn in order, then what was typed meanwhile (held, 64 KB a terminal, past that dropped and said once in
  daemon.log), the last resize and a kill (a tab closed meanwhile); one the host no longer has ends. Then `orphans`
  forgets what the host runs that this daemon doesn't hold. No host there (refused, its socket gone), another pid, or
  none in 3 s: as before (`gone`). While it's down, new tabs' terminals run in the daemon (`ptyTakes`). A test's
  daemon drops it on SIGUSR2 (main.ts, `inRig` only; test/ptyhost.test.ts).
- **A daemon that starts** (`core.ptyAdopt`, before `restoreAll`): lists the host's terminals; each live one whose tab
  is still here gets its `Session` back (`spawnTab`'s `adopt`: nothing started), the mirror drawn from the host's buffer
  (`Session.replay`: muted, so old queries get no answer and old hooks and OSC 7501 reports aren't heard twice). The
  rest are ended. `restoreAll` leaves adopted tabs alone; the others start again as before (resume). With the setting off,
  a host left from when it was on is quit (`ptyGone`): nothing runs unseen.
- **Keys.** `LAKI_HOOK` and `LAKI_TAB_TOKEN` are per start and live in the program's environment, which survives:
  `<data>/pty.json` (0600) keeps them by tab with the host's id, so hooks and `laki` calls stay the tab's own.
- **Stops.** A crash, a kill, and `shutdown { keep: true }` (`laki stop --keep`, the app's restart of an older daemon
  after an update) leave the host's terminals running. A plain `laki stop`, *Quit Laki Completely* and SIGTERM end them
  and the host, as before.
- **Versions.** `PTY_PROTO` changes only when an older host can't serve a newer daemon (ops are added, never changed).
  A host of another version is quit and started again only when it holds no live terminal; until then it keeps the
  terminals it has, and new ones run in the daemon (R9: `ptyTakes`, the host's own protocol only). One started anew
  that still speaks another (once: `up(false)`, no loop) is kept the same way.
- **R9: the default and its fallback.** `load()` sets `ptyHost: true` and `ptyHostAsked` for a new install (no
  state.json or backup: test worlds too); one from before keeps what it had and, with the key unset, is asked once
  (`askPty`, main.ts: a notice, *Keep terminals alive when Laki restarts?*, *Turn on* or *Not now*; either sets
  `ptyHostAsked`, a timeout neither; a test's daemon only with `LAKI_TEST_ASK_PTY=1`). `ptyHostAsked` is the user's
  (gates.ts `AGENT_SETTINGS_NO`, `REMOTE_KEYS`). A host that can't start (its log can't be opened, no socket in
  5 s, turned away) or speaks another protocol: `ptyWhy()` says why, the view's `ptyHostOff` (only with the setting
  on), one line under the switch in Settings, and `## Pty host` in the diagnostics (on/off, running, pid, protocol,
  terminals kept; `ptyState`). New tabs then run in the daemon as before.
- **Security.** The socket, pty.secret and pty.json are the user's alone, and a sandboxed claude can't read them (its
  settings' deny rules, with daemon.json). A wrapped agent can't read the data folder nor connect to a unix socket in
  it or to the pty host's in the temp folder, whatever its net (wrap.ts' last rules). PTY_PROTO 2 added the secret: a
  daemon meets a host of 1 as any older one (above); a daemon of 1 is turned away by a host of 2.
- **Tests.** `test/ptyhost.test.ts`: the protocol (no hello, a wrong secret: closed, nothing answered); a host that ends when idle; one of another version started again
  only when idle; a daemon killed mid-command and started again (the shell's output whole, an agent's hooks still
  heard, the tab's token still good), `laki stop --keep`, a plain stop.
- **Not built.** A turn's state across the restart (an adopted agent reads idle until its next hook); resizes in the
  buffer (a replay is drawn at the size the pty has now); a terminal that ended while no daemon ran keeps only its
  tab (restored as before, its last output gone); SSH hosts' tabs go through the host like any other, untested.
  Default off until it has run a while.

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

### ACP agents (Labs, `daemon/acp.ts`)

A command profile with `acp: true` (Settings › Agents & profiles, its *Speaks ACP* switch, shown with Labs on) is an
agent spoken to over the Agent Client Protocol, version 1 (agentclientprotocol.com, `protocolVersion: 1`): newline-
delimited JSON-RPC 2.0 on its stdio. Its tabs' preset is `acp` (`addTab`), `tracked` like any agent's, never on an SSH
host or in the pty host. `spawnTab` runs its command with `-lc` (no interactive shell writing to its stdout) and gives
the Session an `AcpPty` for a pty, so the rest of Laki goes as for any agent:

- what's typed (`send`, the Reader's box, a queue's `deliver`, its start's prompt) is a prompt: Enter sends
  `session/prompt`, one at a time (one typed meanwhile waits for it); its start: `initialize` with no client
  capabilities (`fs` and `terminal` false, said outright: Gemini CLI 0.4 refuses an `initialize` without `fs`), then
  `session/new` in the workspace's folder, no MCP servers (C6: `session/load` of `tab.resumeId` instead on a restart, when
  the agent says `loadSession`: its chat replays as `user_message_chunk`s and message chunks, no hooks meanwhile;
  `resumeId` kept only for such an agent, so `tabSleep` takes it). Then the tab's model and effort (else its profile's):
  `session/set_config_option` on configOptions' `model` and `thought_level`, else the older `session/set_model`; one it
  refuses is said, not fatal; the session id is the pty's only after that, so what's typed meanwhile waits. A pasted
  message's lines are one prompt (bracketed paste). A `-32000` (or words of a sign-in) marks the tab signed out when its login is known
  (Cursor's: `signin.ts` `acpSignedOut`), the prompt kept (`acpWaiting`); else said, none run;
- `session/update`: message chunks to the Reader (`acpChat`, `chatRead`'s shapes: you, agent, tool) and the mirror as
  plain text; a tool call a tool line (`failed` counts on it); a plan the live plan (`r.plan`, whole each time);
- `session/request_permission`: an extension's gate first (`toolGate`: its no picks a reject option), then a numbered
  menu on the mirror (`askOf` reads it) and a `PermissionRequest` hook with the tool named as Laki's rules name it
  (execute is Bash, edit Edit…: `TOOLS`), so a project's auto-answer rule, the cards, Needs you and `answer` (its arrows
  and Enter) pick an option, sent back as `selected`;
- the prompt's answer is the turn's end: a `Stop` hook with its words (`stopReason` refusal: failed), so Done check and
  kept turns run; `cancelled` is `interrupted` (no turn end);
- Esc or ⌃C (Stop) is `session/cancel`, a pending permission answered `cancelled` first; an agent's request Laki doesn't
  offer (`fs/*`, `terminal/*`) gets `-32601`.

`sweepRunning` leaves its turns alone (its prompt's answer ends them). The renderer shows such a tab in the Reader only
(`inReader`; no Terminal | Reader switch). Laki's permission modes and sandbox aren't applied (its settings say so);
tried with the fakes in `test/fakes/acp-agent`, `test/fakes/cursor-agent` and Gemini CLI 0.4.1's `--experimental-acp` handshake.

**Cursor** (C6, `shared/install.ts` `CURSOR`, `isCursor`): a ready-made profile, `cursor-agent acp` with `acp: true`, in
a fresh install's list when `cursor-agent` is on PATH (core's `presets`) and in Settings' *Add a profile for…*. Its
models (`accounts.ts` `agentModels` with `agent: 'acp'`: `acpAsk` runs its command, `initialize` and a `session/new` in
the home folder, `acp.ts` `acpModels` reads the model select and `thought_level`'s efforts, kept a day, 5 minutes after
none) fill the new-workspace page's model and effort menus (panels.tsx `acpPro`); `tabSpec` takes a model and effort
for an `acp` tab (its effort unchecked: the agent's own to refuse, said on the tab). Its skills go to `~/.cursor/skills` (skill.ts `AGENTS`; its
MCP server: `~/.cursor/mcp.json`'s `mcpServers`, shown to paste). Not installed: the tab's 127, *Install in a terminal*
(`CURSOR_INSTALL`).

**GitHub Copilot** (`shared/install.ts` `COPILOT`, `isCopilot`): a ready-made profile as Cursor's, `copilot --acp`
with `acp: true`, in a fresh install's list when `copilot` is on PATH and in Settings' *Add a profile for…*. From its
docs (Nov 2026): Copilot CLI's ACP server is `copilot --acp` (stdio by default; public preview,
https://docs.github.com/en/copilot/reference/acp-server); one-shot runs are `-p`, a session resumes with `--resume` /
`--continue`, `--model`, permission flags (`--allow-tool`, `--allow-all-tools`…), hooks only from its own files
(`~/.copilot/hooks/*.json`, a repo's `.github/hooks`: never written by Laki), its version by `copilot version` (agentCli.ts'
`ver`), its update `copilot update`, npm's `@github/copilot` for the newest; skills in `~/.copilot/skills`, its MCP
servers in `~/.copilot/mcp-config.json`'s `mcpServers` (skill.ts). Over ACP it's an ACP tab like any (its turns, asks,
Stop, `session/load` on a restart). ponytail: no sign-in band (its login is in its own TUI: run `copilot` once) and no
model menu until its ACP server says its models. `test/copilot.test.ts` (fake: `test/fakes/copilot`).

### Signed out (A2, C6: `daemon/signin.ts`)

A claude or codex turn that ends signed out (`signedOutIn`: *Not logged in · Please run /login*, an expired or revoked
token, `authentication_error`, codex's *re-run codex login*, a rejected refresh token; on a failed turn's error and
answer, a short claude answer, a codex end with no answer with its screen's last 6 lines: an answer may talk of tokens and logins) isn't an API error (`r.failed` stays
unset, no auto continue, no Done check, its queue waits; an SSH host's tab: an API error as before): `turnSignedOut` first tries Auto fallback (the next account in `limitFallback` not left signed out in the last 10 minutes takes the tab,
`tabAccount`, and its message), else sets `r.signedOut` with the message (`r.asked`) and the account's credentials'
fingerprint (`credOf`: claude's Keychain item or file, codex's `auth.json`). The turn event's kind is `signedout` (the
notification: *Signed out: sign in to …*; a fallback's end is `done`, told as *Signed out on …: it goes on on …*). A tab signed out already that fails again keeps its newest message. `signIn` (the band's buttons, the user's only): `open` runs the agent's own
login for that account (`loginCmd`: `claude auth login` with its `CLAUDE_CONFIG_DIR`, `codex login` with `CODEX_HOME`;
Cursor's `cursor-agent login`) as a script tab in the *sign in* Terminals workspace; `send` restarts as if in; `dismiss`.
`signTick` (every 5 s while a tab waits; `LAKI_SIGNIN_MS`, tests'): the login tab ended with 0, or the account's
credentials changed from the fingerprint (a login elsewhere), and every tab waiting on that agent and account restarts
(`resume`) and gets its message (`whenPrompt`; an ACP tab's waits in its pty for the session). The view's `signedOut`
(`SignedOutView`: out, opened, in; `in` for 8 s then gone) draws panels.tsx `SignInStrip` in the tab's foot.
