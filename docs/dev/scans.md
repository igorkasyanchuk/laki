# Scans, schedules, notifications, updates and meters: how they work

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
  menu's item; its box is `send` `whenIdle`, its ask `answer`, with Diff.tsx' `AskDiff` over its buttons for an ask's
  `diff` (App's ask bar: `AskWrap`'s chip; Needs.tsx' card; floater.ts' `diffEl` on the notch's); `@` in its box: PromptInput's `useComplete` with
  `mentions` (text.ts `mentionsOf`, App's `readerApi`), a line each at send (`withMentions`); your long messages
  (`longSaid`: over 12 lines or 1,000 characters) fold under `.rd-fold`. Tested in `test/reader.test.ts`.
  - What it shows (`settings.readerTools`: text.ts `readerShown`; hidden runs as *n steps hidden · Show*, `opened` by
    their first line): a run's `fail` counts its calls whose `tool_result` has `is_error` (`chatOf`'s `ids`, claude's);
    `stopped` marks the line before claude's *[Request interrupted by user…]* (codex's `<turn_aborted>`), a prompt of
    yours with it, the last line, offering *Edit and resend* (its text back in the box). A tab's session changing (a
    `/clear`: SessionStart's new `session_id`) keeps the chat read so far as `past`, ended by a `{ who: 'new' }` line,
    sent before the new chat (`from` then counts back for MCP Apps' `at`); in memory, a daemon restart forgets it.
    The handover and the side chat (turns.ts `sinceNew`) take only what comes after the last `new` line: the chat the agent has.
    `settings.readerScroll` false: a send doesn't pin it to the bottom. `settings.sendKey` (`mod`): keys.ts `sendIs`
    for every chat box (`setSendKey` as each window's settings come).
  - Claude's API retries: share.ts `meterOf` reads `{ type: 'system', subtype: 'api_error' }` lines (`retryAttempt`,
    `maxRetries`, `retryInMs`, `error.formatted`) into the meter's `retry`, cleared by its next answer; `meterView` puts
    it on the tab (`retry`); text.ts `retrying` (only from this turn: `at` ≥ `runAt`) and `retryText`: the Reader's line,
    the tab bar's *Retrying…*. Read with the meters (`meterTick`, every 10 s).
  - Its chips (claude): share.ts `bgOf` reads the transcript on with `chatOf` (`Reader.bg`): an Agent/Task call runs
    until its result (a background one, `toolUseResult.isAsync`, on under its `agentId` with its `outputFile`), a Bash
    `run_in_background` from its result's ID (`backgroundTaskId`, or the text's) and output file, each until a
    `<task-notification>` with an ended `status` (a user line or a `queue-operation`'s), KillShell or TaskStop; chatRead's
    `bg`. `bgOutput` (FROM, agent-refused): the last 64 KB of a listed task's file, never another path. Reader.tsx'
    `.rd-chips` (Subagents, Background), a menu each (*Show output*: `.rd-out`, every 2 s; *Stop*: a `send` asking the
    agent; none for one in the turn, a `toolu_` id). `NOISE` drops claude's task-notification and agent-message lines.
    The meters read it too (`MeterRun.bg`, `bgDone`: `done`, how many ended, the newest 5, the last one's line time):
    `meterView`'s `background` (`TabView.background`: `now`, `done`, `last`, `at`) is the status bar's Background chip
    (BgTasks.tsx `BgButton`: the workspace's claude tabs, while one runs or 10 minutes after the last ended; its card
    lists each with Output and Stop as the chips do, the ended ones as Done, *Run again* on hover or Tab (the agent asked to, a shell with its `cmd`; *Asked* after), *n finished* and *Clear*: each
    tab's `done` kept by its chat in localStorage `laki.bgCleared`, only the ones after it shown: text.ts `bgDoneOf`). None while both meters are off.
  - MCP Apps (`settings.mcpApps`, on unless false; mcpApps.ts): `chatOf`'s `calls` (claude's `mcp__<server>__<tool>`
    calls, their said line `at`, their result: content blocks, `structuredContent`), `callsOf` (the newest 200); main.ts'
    `chatRead` is `chatWithApps`: `appsFor` finds each call's server in the tab's account's `.claude.json` (user and
    local scope by the worktree's path; never `.mcp.json` nor one in that path's `disabledMcpServers`, Claude's /mcp off;
    stdio or streamable HTTP, a name's other characters as `_`), for a call Claude ran (its result in, not an error),
    connects (`initialize` with the `io.modelcontextprotocol/ui` extension, kept `IDLE`; one that exits is dropped at
    once), lists its tools (`_meta.ui.resourceUri`, a `ui://` one; `bumpReader` re-reads the chat; `seen`: again after
    `IDLE` only once the chat called that server since), and adds `apps` by said line (`from`: of
    the newest 400). `GET /mcp-app/<tab>/<call>?key=` (`urlKey('mcp:…')`): `resources/read`'s HTML with a CSP of
    `_meta.ui.csp`'s https origins; `mcpAppCall` (FROM, agent-refused): `tools/call` on that server. Reader.tsx `McpApp`:
    an `allow-scripts` frame, postMessage JSON-RPC (`ui/initialize` with the theme, then `tool-input` and `tool-result`;
    `size-changed`; `ui/open-link` http(s), `tools/call` and `ui/message`, each after an `ask` that shows it whole: past 2,000 characters or with a `HIDDEN` one it's refused, as text.ts `noteWhole`). `.claude.json` is parsed again only as its mtime or size changes (`configOf`). Tested in `test/reader.test.ts`.
  - `laki-ui` blocks: MarkdownView's `UiBlocks` context (unset: the JSON as code); Reader.tsx `UiBlock`: an element or
    `{ ui, data }` passing `uiCheck`, `uiHtml` in a shadow root through Widgets' `clean`, `uiBehave`: a `do: send`
    button's prompt to the agent, copy (at once only for words the block shows, none HIDDEN; else `ask` with the text,
    over 2000 characters or HIDDEN refused), http(s) links; the laki skill's *Show it as UI in your answer*.
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
  (`scanPRs(true)`) skip a branch gh found none for within `NONE_EVERY` (5 minutes), all of them for `LIMITED` (5
  minutes) after gh says rate limit, a quiet PR (`quietAt`: the last scan found it as it was, with no pending check and
  its mergeability known, or not open) within `QUIET` (10 minutes; merged or closed: `SHUT`, 30), and all of them while
  GitHub's GraphQL quota is under `FLOOR` (1000 points: `quotaLow`, `gh api rate_limit`, free, asked at most every 5
  minutes; until its reset, logged with Laki's own gh calls); a turn's end, a branch move and `prRefresh` ask at once.
  Every gh of Laki's is counted by kind (core.ts `ghCount`: `exec`'s, codespace.ts', `ghCard`'s; `ghSaid`), its log
  says the hour's each hour (`ghHour`). `LAKI_PR_BG=1` makes the tests' fast timer scan as the timer does (bg).
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
it has, so each run is a sidebar row), or uses that folder (`local`: its local workspace, made by the first run), the
same workspace (`same`: the first run's is `new`'s, kept as the task's `sameWs`; `sameOf` gone or archived, the next run
makes another; another `ws` or project drops it) or a workspace (its id); in those last three, the prompt goes to the
workspace's running agent of that preset (`send` whenIdle), else a new tab with it; `fresh` (Start fresh: only where a
workspace is shared) always a new tab, the earlier ones left open. Every run, or a missed one (more
than `MISSED_AFTER`, 30 minutes, late: skipped), goes to `state.runs` (the last 200; the view has 50). A tick moves
every due task on before it runs any, so a slow worktree isn't started twice. Removing a project removes its tasks; a
gone or archived workspace is a failed run.

### Notifications

The renderer posts them (`turn` events, App.tsx): off when `settings.notify === false`, per kind
`settings.notifyOn[waiting|done|limit] === false`, or a muted workspace or tab (`muted`, ⋯ and right-click menus).
`settings.notifySound` (a macOS sound's name, `none`, unset: the default) goes to main's `Notification`. A waiting
turn is posted 800 ms later (its menu is often drawn after the hook; none if it isn't waiting by then), with an action
per choice of the tab's `ask` (`NotifyAction`: `n` and `label`, main calls `answer` with both), else, when its text
says "permission", *Allow* / *Deny* (`pick` first / last); none when its body (a permission ask's command) is past
`NOTE_MAX`, 200 characters (text.ts `noteCut`: cut with …, as every notification's body is), or holds a bidi or
character you'd not see (`noteWhole`: types.ts' `HIDDEN`, cmdAsk's rule: macOS draws U+202E and the like, so what you
read isn't what runs; a no-break space, a line separator, a zero-width one): a Yes
would approve a command you can't see as it is; an extension agent's tool ask, the same: no *Allow* then.

Cards on screen: what's marked important notifies as a card instead, its `notify` carrying `card`: a workspace's
(`important`, wsSet; ⋯ › Workspace) turns (`ask` and the ask's `diff` while waiting; `tone` ok for a finish, bad for a
limit or a check that's over to you), a timer's end (`Timer.important`, in place of the dialog), a reminder
(`Reminder.important`, on its `reminder` event; it rings even with notifications off). Main's `addCard` shows it
instead of a `Notification` (its sound through `afplay`, Glass by default): `cardWin`, a panel (`floatOpts`) at the
`screen-saver` level on every Space and over full-screen apps, at the bottom right of the work area of the screen the
pointer was on as the first came (`cardAt`, kept while it shows), sized by its page (ask.html, ask.ts: `ask-size`). A
card per `key` (a tab's: its newer ask or finish replaces it; else its own), the newest on top, 20 at most; `ask-act`
answers its menu as the notification would (`answer`, its n and label: refused once the menu changed, then said on the
card), `ask-open` shows its tab (or Laki), `ask-close` and `ask-close-all` drop them; App sends the tabs that wait
(`asking`, once there's a view), and an ask whose tab no longer waits goes. An extension's tool ask stays a
notification.

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
the dir 0700): `ownStatusLine`, the first `statusLine` `type: command` of the project's own folder's (never a worktree's,
as `.laki.json`: its branch or an agent's edit would pick what runs) `.claude/settings.local.json`, `settings.json`, the
account's folder's, `homeDir('claude')`'s, as the tab starts, none when it names `statusSh`.
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
on unless false, Settings › Appearance; `contextMeter` `line` (unset, true), `ring` or `status`, App's `ctxLook`): TabBar.tsx' `TabList` `.tab-ctx` (its place: one rule in styles.css, a 2px line
along the tab's bottom edge; a split's fullest), or Usage.tsx' `Ring` there, and tooltip lines, the status bar's `.sb-ctx` (the focused tab's,
`.usage-bar`), `UsageButton`'s `today` (*Today*, *≈ API price*); `Usage.tsx` `level` (amber past 70, red past 90),
`ctxText`, `usageText`. Tested in `test/meter.test.ts`.
