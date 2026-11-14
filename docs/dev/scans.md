# Scans, schedules, notifications, updates and meters: how they work

### Scans

- issue.labeled (`inbound.ts` `issueTick`, 60 s): GitHub's issue events per GitHub project while something listens;
  docs/dev/workflows.md says how.
- The loops (`src/daemon/ticks.ts`, H4): every periodic one goes through `register(name, ms, fn, { idle })`, listed at
  its top with its period and idle class. Idle (main.ts' `setIdle`): no client connected, or no window shown (every
  client's `view.shown` false) and no agent `running`. Then `slow` loops (the scans, meters, PR scans, sleep, hooks,
  tickets, widgets) run every 5th tick (`SLOW`), `pause` ones (`shellTick`, `factsTick`, already quiet with no window)
  not at all, and `keep` ones (anything with a deadline: schedules, pending starts, reminders, remote access, shares,
  tunnels, plan-limit resets, workflows' waits, phone taps; and the rare ones) as ever; the next tick after someone
  looks is full speed. Off in the rig (tests call with no window), `LAKI_IDLE=1` on; `test/ticks.test.ts`.
  `scripts/mem.sh` prints the daemon's idle CPU (its own, not its children's).
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
- Reader view (F6: a line's `at`/`end` are its transcript lines' times, a `you`'s `cost` its turn's claude usage at API
  prices, counted once per message id (`chatOf`'s `spent`); text.ts `readerTimes` makes the small lines
  (`settings.readerTimes`, on unless false), `canRun` says which fenced block gets *▷ Run* (MarkdownView's `RunCode`,
  `runText` what it types (a session's `$ ` lines without the prompt, what they printed left out, npm's `> ` lines too; no `$ ` line: as written, a `> ` taken off only when every line has one); App's `readerApi.run`: `send` with `enter: false` into a new shell tab, ⌥ the last idle one; several lines wait in `typeInto` for the shell's bracketed paste, 2 s, once per terminal)). Reader view (`settings.reader`, on unless false; meters.ts `chatRead`: a `Reader` per tab, `tailOf` and share.ts'
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
  its mergeability known, or not open) within `settings.prQuiet` minutes (`quietMs`, `PR_QUIET`: 5; Settings › Pull requests › *Check a quiet PR every*, Info's tips with it, never under `prScan`'s; merged or closed: `SHUT`, 30), and all of them while
  GitHub's GraphQL quota is under `FLOOR` (1000 points: `quotaLow`, `gh api rate_limit`, free, asked at most every 5
  minutes; until its reset, logged with Laki's own gh calls); a turn's end, a branch move and `prRefresh` ask at once.
  Every gh of Laki's is counted by kind (core.ts `ghCount`: `exec`'s, codespace.ts', `ghCard`'s; `ghSaid`), its log
  says the hour's each hour (`ghHour`). `LAKI_PR_BG=1` makes the tests' fast timer scan as the timer does (bg).
  `prRefresh` (the status bar PR's right click, a workspace's *Refresh PR status*) is `scanPRs` now.
  GitLab (`gitlab.ts`, build prompt 1): `forgeOf` per project (its origin's host: gitlab.com, or one `glab auth status
  --hostname` accepts, asked once a daemon; anything else, a path too, GitHub's), then `glabPR`: `glab mr view <branch
  or !n> --output json` and its head pipeline's jobs (`glab api projects/:id/pipelines/<id>/jobs?per_page=100`, `jobsOf`) in the
  same `PR` shape with `forge: 'gitlab'` (the renderer's `prNo`/`prName`: `!n`, MR). `noMR` is gh's *no pull requests
  found*. Ship's last line `shipMr`, `fromIssue` `glabIssue`, `issueList` `glabIssues`, `prAct`/`merge`/`prDraft`
  `glabAct`/`glabDraft`; `prFile` fetches `merge-requests/<n>/head`. GitHub's only (`githubOnly` says so, or nothing):
  line comments, reviews, `prSay`, `prDiff`, `prThreads`, `prTalk`, Viewed (`prFiles`), `prFromSaid`, `autoPR`, labels.
  ponytail: `mine` isn't asked (Approve shows on your own MR; GitLab refuses it). `test/gitlab.test.ts`, `fakes/glab`. No PR on the
  branch (and no `prUrl`): `prFromSaid`, the one PR link its agent tabs' last answers name (one, of a repo of `git
  remote -v`; each tried once per workspace, `saidTried`), attached as `prAttach` does, marked `prSaid` (one in `related` never: you
  moved it off); a scheduled run's local workspace's at its
  turn's end (scans skip local ones; the project's lasting local one would keep the first PR named). Each check has `took`, a finished one's seconds (`completedAt` − `startedAt`). The checks are
  `newest`'s: statusCheckRollup keeps a re-run's old run, so each check (workflow and name) counts by its latest
  `startedAt` (none, or Go's zero time: queued, the newest; finished, `status` COMPLETED: by its start, else its `completedAt`, else the oldest, so one cancelled before it started never beats its re-run), as `gh pr checks` does. A cancelled check (GitHub's `CANCELLED`, GitLab's `canceled`) is `cancelled`, not a failure and never a pass; `checksOf`: fail, then pending, then cancelled, then pass. No failure event, no Fix CI, no Merge when green; a workflow's Wait stays put (a re-run or a push, else its timeout). The primary PR: a worktree's guessed
  `prUrl` (`prSaid`: its prompt's, `guessed` in `fromPRLink`, or its agent's; never one attached or asked for with `link`)
  gives way to its branch's own once the branch is on a remote (`onRemote`, `git for-each-ref refs/remotes/*/<branch>`:
  no gh call for a branch nobody pushed), then `gh pr view <branch>`: that one is followed, the other `related` (the
  same PR, as `gh pr checkout` gives: unlinked). Not a local workspace's: the folder's branch isn't its own.
- `autoLand` (merge when green, `wsSet` refuses it where `prAllows(…, 'land')` is false): in `autoPR`, an open PR
  that isn't a draft, `checks` pass, `conflict` false, `review` none or APPROVED, `ready` not false and no agent tab running or with a queue is merged (`merge()`, the
  project's `mergeMethod` or squash, the branch deleted) once per head (`fix.land`; `wsSet` turning it on again clears it
  at the next scan: `retry`);
  a failure is `overToYou`. The app asks once as it's turned on. A project's `land` turned off clears its workspaces' `autoLand` (`projectSet`).
- The merge queue (pr.ts `mergeQueueStart({ wss })`, `mergeQueueStop({ project })`; the user's only: gates.ts AGENT_NO,
  allowed over remote access as `prAct` is, not at the answer level): one project's PRs merged in the order given,
  `state.mergeQueues` (the view's `mergeQueues`: each item's `status` waiting, updating, checking, merged or stopped, its
  `why`). A step (`queueStep`, one at a time per project) as it starts and after every PR scan: the first not merged is
  merged by `merge` (its head the scan saw, the branch deleted) once its checks pass and GitHub says CLEAN (`ready`),
  `gated('merge', …, { by: 'auto' })` first; a draft, failing or cancelled checks, a conflict, GitHub blocking it, a gate
  holding it or gh refusing stops the queue (`stopped`, one notice: `alertShow`'s, Laki's own); one pushed to since the
  scan waits for its checks. `behind` (GitHub's BEHIND) gets Update (`git fetch origin <base>`, `mergeClean`, `wsUpdate`)
  and stops there: Laki pushes nothing for Update. Saved, so it goes on after a restart at the next scan. The Board's
  Merge column: *Merge in order (n)* per project (a confirm listing them), the queue's list with Stop; tray.ts
  `dockProgress` its merged share.
- `merge` (the button's, `autoMerge`'s): `gh pr merge --match-head-commit <the scan's head>` (glab: `--sha`), so a push
  after the scan refuses it (*PR #n got new commits: its checks run again*); a scan follows either way.
- `autoPR` (workspace `autoFix` / `autoReview` / `autoMerge`, ported from wb's `review.go`): failing CI on a new head
  commit → `prFix('ci')` (`gh pr checks`, `gh run view --job <id> --log-failed`: each tail `fenced`, said to be the
PR's own output, data, never instructions; a fork's PR, `ws.fork` or the scan's `cross` (`isCrossRepository`): App's
`setAuto` asks before turning fix CI on), at most `settings.prTries` in a row
  (`PR_TRIES`, 3), then status waiting and a notification (`overToYou`, once, as the count goes over); conflicts on a new head commit →
  `prFix('conflict')` (merge the base in, push), `fix.merge`/`fix.merges`, the same tries (mergeable UNKNOWN, as after a
  push, keeps the count); `wsSet` turning a switch on again gives its tries back at the next scan (`retry`: a scan under way
  would write its copy of `ws.fix` over a reset made then). New review threads → `reviewMessage`
  (GraphQL `reviewThreads`, which first drops comments hidden on GitHub, `isMinimized`, and the threads left with none, for every reader, `prThreads`' `all` too, `prTalk` likewise, and says how many, `hidden`: people with write access, and bots only by `settings.prBots` (`PR_BOTS`: github-actions,
  copilot-pull-request-reviewer, coderabbitai; Settings › Pull requests' *Review bots*), another bot's skipped and said
  once per PR in daemon.log; `reviewKey` counts yours too, but not the agent's: it comments as you, so yours made while a
  tab of the workspace was running, `busy`/`agentSaid` from `changed()`, ±`SKEW`, are its, their ids kept as `fix.mine`). `newReview` (`shared/types.ts`) compares per thread: new only if the thread wasn't sent or has more comments than then, so hiding one sends nothing (`t1:2` to `t1:1`) and the next reply is new.
  What was sent is `workspace.fix`. A hidden *changes requested* review still blocks on GitHub: `reviewDecision` and `pr.changes` keep saying so.
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

**Archive when idle** (`pr.ts` `archiveIdleTick`, 30 min, `settings.archiveIdle` days, `archiveIdleKeepPR`): a worktree on this Mac whose last touch (`usedAt`, a client attached or `lookedAt`, `touchedAt`, `created`) and HEAD's commit are that old, kept for a pin, *Important*, a later start, an open PR, a queue, an agent at work (a terminal's too), a program running in a shell tab (`busyShells`), a dev server, script or port, a live workflow run, unpushed commits (`--not --remotes <base>`) or uncommitted ones; each reason logged once (`idleKept`). `wsArchive` with `by: 'auto'`, so gates hold it; the `archived` event's `idle` is the toast's. `wsRestore` sets `touchedAt`: an Undo counts a full period from there.

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
than `MISSED_AFTER`, 30 minutes, late), goes to `state.runs` (the last 200; the view has 50). A tick moves
every due task on before it runs any, so a slow worktree isn't started twice. Removing a project removes its tasks; a
gone or archived workspace is a failed run.

How a run ended (T1): a run that started an agent is `state: 'running'`; `runOutcomes` (main.ts, as the daemon starts:
not as the module loads, load-order.test) adds to core's `turnEnds` (1.5 s later: its usage meter is read by then) and
`turnWaits`; `runEnded` finds the run of that tab (`runOfTab`: its first day, `OUTCOME_MS`) and sets `state` (done,
waiting, failed: an API error or a limit), `endedAt`, `said` (the answer's or question's first line, 200), `pr`
(`prOf`), `tokens` and `cost` (`meterView`, with costs on), `diff` (`wsStat`), all at once. Each end again (resumed)
updates it. A workflow's run (`flow`: its id) ends by workflow.ts' `finish` calling `scheduleFlowEnded`; an extension's
is `done` or `failed` at once. `ranTold`: extensions' `schedule.done` (`task`, `state`, `said`, `pr`, `diff`, `cost`) on
each, and as the state changes, by the task's `notify` (unset `needs`: waiting or failed; `always`: done too; `never`)
a `scheduled` event (App: a notification and a toast, Open goes to its tab) and `flowPhone(…, 'Scheduled')` (not for
a wait: its tab pushes that itself). ponytail: a waiting run's notification may come twice (its tab's and the task's).

A run the Mac slept through (T2): `missed` (a due time over `MISSED_AFTER` late): a task that `catches` (`missed`, unset:
`catchup` for a rule of at most 2 times a day, else `skip`) gets `catchup: { due, until }`: the latest occurrence before
now, until `catchUntil` (minutes after midnight, that day's after the due time) or its next time; past it, or a `skip`
task: a `missed:` run is logged. `catchTick` (each tick, after the due ones) runs the oldest one waiting
(`runSchedule`'s `late`: *after wake (due 02:00): …*), one a tick, so several 30 s apart; one past its `until` is
logged missed. `lowBattery` (pmset: discharging under 20%) holds it a tick; never in tests. ponytail: no per-task
override of the battery rule yet.

A run condition (T3, `onlyIf`, an agent's task only: a workflow or an extension decides for itself; Run now skips it):
`onlyIfCheck` before anything starts: `commits` (the base, else `branches().main`, fetched; its head against
`lastHead`, kept when a run starts an agent), `prs` (`gh pr list` once: `failing` checks, `review` REVIEW_REQUIRED and not
a draft, `any`), `issues` (`gh issue list`, a `label`: created since the task's last run that started an agent), `cmd`
(`/bin/sh -c` in the project's folder, 60 s: exit 0 runs; not a project on another machine, nor one whose
`.laki.json` waits for trust (`cfgWait`): a failed run). A no is a run with `skipped`, `ok`, `what: skipped: …`, no
workspace; the run's `{{check}}` in its prompt is the command's first line, the PRs' or issues' numbers, the head.
main.ts refuses `onlyIf.cmd` from an agent (`agentNo`), and remote access can't `scheduleSet` at all.

On an event (T4, `trigger`: `ci.failed`, `pr.opened`, `pr.review`, `issue.opened`, `push`; `branch`, `label`, `by`
others|me, `gap` minutes, unset 30, `perDay`, unset 10; an agent's task only): no times (`when` '', an empty `rule`,
no `next`). `eventTick` (3 minutes, slow while idle; `LAKI_EVENT_TICK_MS`; skipped while `quotaLow`, the PR scans'
rule) reads each GitHub project on this Mac once per kind a tick, its tasks sharing the answer (`ask`'s memo): `gh run
list --branch` (completed failures by run id; a `pull_request` run on the branch is a fork's), `gh pr list` (opened: a
number past `marks.pr`; reviewed: a PR's newest `latestReviews` past `marks.reviews`; `branch`: the PR's base), `gh
issue list` (past `marks.issue`, `--label`), `git ls-remote origin` (`push`: the head past `marks.head`); `by` asks `gh
api user` once. A task's first read only sets `marks` and `seen`; a task on a project that isn't on GitHub here is
refused. `onEvent`: once per id (`seen`, the last 50), the runs today first (held ones count: `perDay`), then a fork's
is a `held` run (no workspace, a `scheduled` event once a gap at most; kept past the log's cap and the view's 50;
`scheduleRelease`, the page's *Run it*, starts it in its place: yours only), then the gap since `last` (logged skips), then `runSchedule`'s `event`: its words before
what it did (`r.event`), `fillEvent` (shared/fence.ts: `{{event.url}}`, `.number`, `.branch` inline when plain, the
title fenced under `untrusted`'s line, never inline; none named: *What started it: …* appended) and a PR's event's
workspace linked to it (wsNew `linked`, guessed); no other PR is guessed from the prompt (wsNew `outside`: the title may name any). ponytail: an incoming webhook doesn't feed them yet; an SSH host's
project isn't read.

A run's workspaces (T5, `ws: new` only): after a run starts, `keepTidy` archives the task's run workspaces past `keep`
(unset 5, 0 all), oldest first, only when nothing is lost: wsArchive's `ifClean` (R1), no open PR, not pinned, no
agent running or waiting; one tidy at a time per task (`tidying`); the rest are counted in `kept` (the row's *2 older runs kept: they have work*). `emptyGone`
(unset: on): a run whose agent ended `done` with no diff against its base, nothing uncommitted and no PR (its stat read
fresh: `wsStat`'s `fresh`) is archived then, and its log entry says so. Archive only: the branch and Restore stay.

A failed run (T6, `settle`, not Run now's): a transient one (`TRANSIENT`: the network, a fetch, a lock, busy) gets
`again: { at: +5 min }` and `retry` on its entry, run by `scheduleTick` (*tried again: …*) once: a second failure
counts. At its agent's plan limit (`limitOf`: claude's, codex's usage at or past `usageAt`, `resetOf`'s reset) a run
waits for the reset (`again`, why `limit`: *its plan limit reset: …*) if that's before its `deadline` (its next time,
that day's `catchUntil`), else *skipped: plan limit*. `fails` counts failed runs in a row (a failed start, an agent that
ended on an error, a workflow run that failed; a wait, a plan limit's end, a skip and Run now don't; `done` resets it); at 3 the task is off
with `pausedWhy` and `pausedField` (`fieldOf`: base, ws, preset, widget, workflow), a `scheduled` event and a phone push
once. The page shows it on top with *Fix*: its form, at that field. An edit that leaves it on clears them.

A run's time limit and the runs going at once (T8, `timeTick` and `lineTick`, each `scheduleTick` before the due
ones): an agent run's `spent` is its agent's working time, sampled (`sample`, at `clock`) only while its tab is
`running` (a wait for you isn't counted; a step over `STEP`, 2 min, is the Mac asleep, not counted either). Past its
task's `maxMinutes` (unset: `settings.scheduleMaxMinutes`, else 60; 0 none; not a workflow's, which has its budget, nor an
extension's) its turn gets Esc, as Stop does (the chat stays: a prompt goes on in it; a wait isn't Esc'd, Esc would
answer it), the run is `stopped`, *time limit 45 min* its `said`, told as a failure is (`ranTold`'s `limit`: Tell me's
needs too), and `runEnded` leaves a stopped run as it is. `settings.scheduleAtOnce` (unset 2; 0 no cap; a bad value: the
default, `count`) caps the runs going (`holds`: running, in its first day, its tab still there and not idle after it
was seen working, an Esc by hand; a workflow's until it ends; `begun`: starts under way); a due one over it waits
(`queued`, its due time, the page's *waits its turn*), oldest first, started by `lineTick` (each tick, and `lineNext`
as a run ends: `runEnded` but a wait, `scheduleFlowEnded`, a time limit) with *waited its turn (due 02:00): …*. One
still waiting at its task's next time: a *skipped: queue* entry at its due time, and the new one waits instead. Off or
archived: its place goes. Run now, a retry and a catch-up don't wait; an extension's fetch isn't counted. The form's
clock chip sets the task's limit and, below it, every task's and how many at once (`SchedulesApi.settings`).

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

U15, macOS's own touches: a waiting turn with neither a menu nor "permission" (a free-text question) gets
`{ reply: true }` instead: main's `Notification` has `hasReply` (no button), its `reply` event sends the text through
the daemon's `send` (as typed in the window: its rules, the policy; empty: nothing), then drops that tab's card on
screen. The Dock's progress bar: App's `dockProgress` (shared/tray.ts: a running `ship` tab, its `progress.pct` else
unknown; a running workflow, `FlowView.steps` and the blocks in `visits`; their mean, `2` unknown, `-1` none) rides the
`badge` IPC, main's `setProgressBar` only when it changes (`barWas`). *Bounce the Dock icon* (`settings.dockBounce`, on
unless false; Settings › Notifications): `bounceOf` (a workspace waiting the view before didn't: muted, archived and Do
not disturb's non-important ones aside; the first view never), then main's `dock-bounce` (`from(e)`, Laki not focused:
`app.dock.bounce('informational')`, never critical). *Share…* (a PR's ⋯, a shared tab's *Shared live view*): main's
`share-menu` (`from(e)`, a website's link) pops `ShareMenu` at the pointer; off macOS there's no item, Copy link stays.

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
whose PR is MERGED, with no tracked tab other than idle, `rev-list <head>..HEAD` 0 and `wsArchive` `ifClean` (status,
uncommitted work in a submodule, ignored files of its own: `unsaved`, `docs/dev/api.md`; the log names which); once per
PR (`autoArchived`: an Undo stays). It broadcasts `archived`, which App toasts with Undo (`wsRestore`); a merged PR's
row says *merged* while the setting is on.

A turn running long (`turns.ts` `longTurnTick`, 60 s, `settings.longTurn` minutes): only ticks where the tab is `running` and not at a limit add up, each at most `LONG_GAP` (a Mac asleep); once per turn the `long` event (Open, Stop: main's `stop` action, `longStop`: its Esc through `input`, only while that turn runs and asks nothing), `phoneLong` (no Stop on a phone) and `turn.long`.

How long a turn usually takes (`core.ts` `turnTook`, `shared/nextStep.ts` `usual`): `turn` times each turn by its hooks'
`at` (else the daemon's clock): `turnFrom` at its prompt (or its first hook), an ask's wait (`waitFrom` to the next
`running`) added to `waited`; a clean end (not failed, not a limit, not `interrupted`) keeps `now − turnFrom − waited`
in `state.turnTimes[project\tprofile]` when 20 s or more, the newest 20. A `running` tracked tab's view gets `usual`:
their median once 5 are kept. The tab's tooltip and the sidebar's peek card say *4 min · usually 6*; past twice it and
5 minutes (`overUsual`) its timer turns the waiting color, nothing more (`longTurn` stays the only notice). Shells and
agents without turn hooks have none.

### Updates

`src/main/update.ts` (main) and `src/shared/update.ts` (pure, tested in `test/update.test.ts`; R7: `verdict` decides none, passed, held or offer; *Skip this version* keeps `pass` in update.json, the state's `passed`, *Offer it again* clears it; it's main's file, no setting an agent could change): `updater` checks
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

What's new (U13): settings' `seenVersion` is the version whose card was closed (core's `load`: a new install's own
`VERSION`, one from before U13 `''`). While it isn't this app's version (package.json's), App loads the release notes
(`?raw`, only then) and `update.ts` `notesOf` gives that version's first three lines (`## <version> ·`'s bullets), a
line's trailing `[Try it](laki://…)` apart as its link. panels.tsx `WhatsNew` shows them top right: *Try* routes the
link (App's `setLink`), *All changes* opens Settings › Release notes (for everyone now, its ⌘K item too), × or All
changes sets `seenVersion`. A version with no section (a build between releases) shows nothing. ui-smoke's
`whats-new` steps: shown for an old `seenVersion`, closed, gone after a reload.

**After an update** (S9, conn.ts `freshDaemon`, main's `daemon()` once per app start): a daemon whose `ping { caps }` says an API under 167 (`daemonStale`: no app://laki), or a plain `pong`, is asked for `shutdown { keep: true }`; one that refuses (the app before the update started it: this app's token isn't the one it gave) is stopped by SIGTERM (`stopDaemon`, only a pid whose command line runs `out/main/daemon.js`: `isDaemonCmd`), then a current one starts. `test/upgrade.test.ts`: a fake old daemon that refuses, and one another copy started that stops by its shutdown.

### Usage

Plan limits (`usage.ts`, the renderer's `Usage.tsx`). R4: the endpoints below are undocumented and asked only when
`settings.usage[agent] === true` (Settings › Appearance › *Ask … for plan limits*, off by default). Otherwise each
account's numbers are what the agent reports itself (meters.ts' `statusLimits(w, now, true)`: Claude's status line
`rate_limits`, Codex's transcripts' `token_count` `rate_limits` (share.ts' `meterOf` keeps the newest as `Meter.limits`,
`codexRateWindows`), of any age: `at` says when, Usage.tsx shows *As of HH:MM* past 20 minutes), `source: 'own'`;
none yet: a row with `SAYS`' error; Gemini has none, so it isn't listed. Asked, `source: 'endpoint'`. An install from
before (state.json there, an agent's `usage` unset) gets `settings.usageNote` true once: Settings › Resources' note,
OK sets it false. A delayed start's *after the plan limit* (schedule.ts `pendingTick`) reads the same: an own window
whose reset has passed starts it. With the endpoint on, `usage` reads Claude's `GET api.anthropic.com/api/oauth/usage`
(`Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`; no redirect followed, both; the token is the freshest of `security
find-generic-password [-a $USER] -s "Claude Code-credentials" -w` and `~/.claude/.credentials.json`) and Codex's `GET
chatgpt.com/backend-api/wham/usage` (`$CODEX_HOME/auth.json` `tokens`, `chatgpt-account-id`). Tokens are read-only:
never refreshed (that can sign the agent out), an expired one isn't sent. Each agent's answer is kept 5 minutes
(`USAGE_TTL`; Claude's 7.5, `TTL`: Anthropic turns away faster pollers; a turned-away token too), one that asked no server or failed on the way 1
(`AGAIN`); a 429 (`busy`) its `Retry-After` (`waitOf`), else `BACK_OFF` (10, 20, 40, then 60 minutes, `slows` in a row), the last
answer with numbers (`last`) given meanwhile with the error and `next` (Usage.tsx' `waitText`: from when, checked again when); the RPC's `now` (tests'). The renderer asks every minute (and notifies near a limit: Notifications). Tests set `LAKI_USAGE_API`
(a fake server for both; only `http://127.0.0.1` or `localhost` count: a session's env can reach a daemon the CLI starts) and get a fake `security`
(`test/fakes`) reading `$HOME/keychain`: never the real Keychain. Claude's account whose tab wrote `rate_limits` in its
status line within `STATUS_FRESH` (meters.ts' `statusLimits`, below; main.ts passes it as `usage`'s `own`) isn't asked:
its 5-hour and weekly windows (`claudeWindows`' labels), the endpoint's others and plan as `last` had them.
Gemini CLI (`gemini`, CodeNomad's way): only once `~/.gemini/oauth_creds.json` is there (`GEMINI_CLI_HOME`;
`geminiSigned`, accounts.ts' `usageWho`: one `Who`), read only; an expired `access_token` is refreshed at
`oauth2.googleapis.com/token` with Gemini CLI's own client, read from its install (`geminiClient`), the new token in memory
(`geminiToken`, by the refresh token's hash; never the answer's refresh token), nothing written under `~/.gemini`; the
project `GOOGLE_CLOUD_PROJECT`, else `cloudcode-pa`'s `v1internal:loadCodeAssist` (once); then `retrieveUserQuota`
(`{ project }`): each bucket's `remainingFraction` and `resetTime` a window labelled by its model (`geminiWindows`). Its
`settings.json` picking an API key (`gemini-api-key`, `vertex-ai`), or any failure: `Unknown: …`; a 429 as the others.
Kept 5 minutes; one base URL for all of Google's (`base`, `LAKI_USAGE_API`). Usage.tsx sorts its windows by the models
Gemini tabs use (`byUse`; the ring's is the first) and folds all but `MODELS_SHOWN` under *More*.

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
