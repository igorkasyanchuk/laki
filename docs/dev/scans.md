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
- The Proof card (verify.ts, with the Done check): only what Laki saw of a checked turn, never the agent's words nor a
  model's (the review isn't in it). Each script that ran: name, exit code, time, a `summary` (passed, exited with n,
  took over n minutes) and its last `PROOF_LINES` lines, masked by share.ts `redact`, as `<storage>/proof/<turn>/<name>.md`
  (turn: the check's `at`; `writeAtomic`, 0600); git's facts: the paths between the tree the last check saw (or the
  base) and now (`factsBetween`, `git diff --name-only -z`), `PROOF_FACTS`' patterns for tests, CI config, migrations
  and lockfiles (`factsOf`). `proof.json` beside them, `PROOF_KEEP` turns' folders kept. Core's `proofs`, the view's
  workspace `proof` (the last checked turn's; gone as that tab's next turn starts: `turnStarts`), with the worktree's
  `tree` it checked (Ship's `proofMd`: stale when another ships). The `proof` event:
  SidePanel's Preview, when it's open on a local page that loaded, captures (main's `capture`) and calls `proofShot`
  (the app only: FROM, AGENT_NO, REMOTE_NO): `after.png`, the newest earlier turn's copied as `before.png`, and with both
  `shots.diff`, the percent of pixels that changed (shared/pixelDiff.ts' `pngPixels`, node's zlib: an 8-bit RGB or RGBA
  PNG, Chromium's; then `pixelDiff`). Proof.tsx `ProofList`: a line each under the Reader's last turn and on Needs you's
  finish card (`proof.tab` that tab's), a click opens the file from the storage folder (`openFile`, `storage`); with both
  pictures a *n% changed* tag and *Compare* (`Compare`: the pictures by `fileRead`'s data URLs, the app's `proofImage`;
  Slider: the after over the before, `clip-path: inset(0 X% 0 0)` by a named range; Side by side; Overlay at half). `proof/` is Laki's: core's `proofIn` refuses it to
  workflows' save block; `storageFull` and the Artifacts count leave it out. ponytail: the agent's shell can still write
  there (it's its `LAKI_STORAGE_FOLDER`).
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
- Broken worktrees (T13: files.ts `brokenScan`, at each `scanStats`' start, every live worktree whatever is shown):
  `brokenOf` reads the folder and its `.git` file, no git: `gone` (no folder), `moved` (its `.git` names
  `<repo>/.git/worktrees/<x>` of another repo: the repo moved), `unlinked` (no `.git` link, or the repo's
  `worktrees/<x>/gitdir` doesn't name it back); a project whose `.git` is a file isn't checked. An SSH host's or a
  codespace's (awake): one `sh` there a minute apart, gone or no `.git`, `remote: true`. Kept in hosts.ts' `broken`
  (the view's `WorkspaceView.broken`, a `wsLog` line as it breaks), which `away` reads: the diff size, the radar, PR
  scans and `wsPeek` skip it. `wsRepair` (the user's: AGENT_NO, REMOTE_NO; none on a host): `recreate` (gone: refused
  over any folder at its path, or when its branch is gone; `worktree prune`, then `worktree add <path> <branch>`, the
  archive's saved copy put back, else `lost` says what), `relink` (`worktree repair <path>`, which exits 1 as it
  reports a fix: the link read again decides), `forget` (archived as it is: its terminals stopped, a folder still there
  marked `imported` so teardown and Disk's Tidy never remove it, its branch kept). Each git in the project's repo with
  `-c core.fsmonitor=false -c core.hooksPath=/dev/null`.
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

### Disk (Settings › Resources)

`resources.ts` `diskScan`: for each project's workspaces (not a host's), `du -sk` under `nice -n 10`, one path a call
and two at once at most (`duLimit`), 2 minutes each: a live worktree, the dependency folders in it (`CLONE_DIRS` and
.laki.json's `clone`; `shared` when core's `cloneDirs` cloned it, `ws.cloned`), its storage folder; and `git rev-list
--objects --disk-usage` (git 2.38 on; else left out) of what only its kept turns' refs (`--glob=refs/laki/turns/<ws>/*`)
or an archive's `refs/laki/archived/<ws>` hold (`--not --branches --tags --remotes`). A path gone meanwhile (du fails)
is left out. `diskUsage` keeps the result 10 minutes (`again`: now), measured only when asked (the page, `laki doctor
--disk`); `free` is `statfs` of the data folder. A workspace's `bytes` are its parts but the dependency folders (in its
worktree). turns.ts is imported as each runs (it reads core's as it loads, and core imports resources.ts).
`diskTidy({ what, days, dry })`: `turns`, kept turns that ended over `days` ago of workspaces with no tab running
(turns.ts `turnsDrop`, their refs out of the repo); `storage`, archived workspaces whose PR merged (`ws.merged`, set
as it's archived, or the PR seen merged) with a storage folder of their own (`storageFull`), moved to the trash
(`storageTrash`); `archives`, archived over `days`: `archivedTidy(now, days)`, its notice and trash as archivedDays'
(a noticed one keeps its `soon.days` for the hourly run). `dry` says what would go, by name. Both are the user's
(AGENT_NO); a phone reads `diskUsage` (REMOTE_OK, ANSWER), never `diskTidy`. The page: SettingsResources.tsx `Disk`.

A project's git, weekly (B8, gitTidy.ts): `gitTidyTick` (hourly, `settings.gitTidy` unless false) takes the first
project due (`TIDY_DAYS`, 7, since its `tidied.at`, or never; git, not Terminals or Browsers, not archived) that isn't
busy (an agent of it running, a workspace of it in `making` or its setup running, a tidy of it going), one a tick.
`gitTidy`: skipped, with why, where its git says `maintenance.auto=false` or `maintenance.repo` lists it (`git
maintenance start`'s); else `nice -n 10 git worktree prune` (not while a live worktree of Laki's is missing: a volume
unplugged would lose its record) and `git -c gc.reflogExpire=never -c gc.reflogExpireUnreachable=never maintenance
run --auto` (gc's own grace periods; reflogs, and so stashes, kept; refs never touched), each 10 minutes at most,
through `exec` (an SSH project's on its host). `p.tidied` keeps `at` and `skipped` or `failed`: a failure logged once
and tried again a week on, thrown only to `gitTidy` (*Tidy now*: the user's, AGENT_NO, REMOTE_NO). `gitFacts` (the
Disk page's project row, `DiskUsage.projects[].git`): the git dir's `du`, `git count-objects -v`'s `count` (loose) and
`packs`, `tidied`; `laki doctor` says each project over `LOOSE_MANY` (20,000) loose objects (`gitLoose`: count-objects
alone; core's `gitTidyMod.loose`, main.ts sets it: core doesn't import gitTidy.ts).

### Scheduled tasks

`schedule.ts` `scheduleSet`, `scheduleTick` (every 30 s), `runSchedule`; the rule comes from `shared/when.ts` `parseWhen`
(a line of English to days of the week and minutes after midnight, in the Mac's time zone; `once` for
`once`/`tomorrow`; a cron expression when the words don't read, `@…` always: `parseCron`, kept whole as the rule's
`cron` (its fields as sets, `anyDay`/`anyWeekday` for cron's day-of-month OR day-of-week), `nextRun` day by day for 5
years at most, `describe` in words, `minutesOn` the Calendar's day), kept with the text so "tomorrow" means the day it was saved; `nextRun` gives `next`; `stamp` fills `{{DD-MM-YY}}`-style
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

On an event (T4, `trigger`: `ci.failed`, `pr.opened`, `pr.review`, `issue.opened`, `push`, `comment`, `webhook`; `branch`, `label`, `by`
others|me, `gap` minutes, unset 30, `perDay`, unset 10; an agent's task only): no times (`when` '', an empty `rule`,
no `next`). `webhook` (`hook`: one of `settings.inHooks` by name, `hookEvent` optional; any project, not only a GitHub
one) isn't read: inbound.ts' `onRequest`, past the signature, replay and rate checks, calls `scheduleHook`, which runs
each task on that hook (a project's hook: that project's tasks only; its event, when named) through `onEvent` (gap, runs
a day) with its body (`HOOK_BODY` 8,000 characters) as `TaskEventIn.body`, fenced by `fillEvent` under `untrusted`
(`{{event.body}}`: "(its body, below)"); `eventTick` leaves those tasks out. `eventTick` (3 minutes, slow while idle; `LAKI_EVENT_TICK_MS`; skipped while `quotaLow`, the PR scans'
rule) reads each GitHub project on this Mac once per kind a tick, its tasks sharing the answer (`ask`'s memo): `gh run
list --branch` (completed failures by run id; a `pull_request` run on the branch is a fork's), `gh pr list` (opened: a
number past `marks.pr`; reviewed: a PR's newest `latestReviews` past `marks.reviews`; `branch`: the PR's base), `gh
issue list` (past `marks.issue`, `--label`), `git ls-remote origin` (`push`: the head past `marks.head`); `by` asks `gh
api user` once; `comment` (`logins`, `word`, `reply`): `gh api repos/{owner}/{repo}/issues/comments` (the newest 100,
issue and PR comments alike; past `marks.comment`, a created_at), each whose first line is `/laki` (and `word`:
`commentSays`) by `gh api user`'s login or one of `logins`, then `gh pr view` (its title, branch and
`isCrossRepository`: unread, held as a fork's) or `gh issue view` (its title) for it; `TaskEventIn.body` is the rest of
the comment, `pr` set on a PR. Its run on a PR goes to the workspace linked to it, else a new one on its branch (wsNew
`pr`), for `ws` new or same; `reply` sets the run's `reply` (the number), and `runEnded`'s first `done` posts its agent's
last answer there (`replyOn`: `gh api …/issues/<n>/comments -f body=`, `redact`ed, 4,000 characters), once. main.ts'
`agentNo` refuses an agent's `scheduleSet` that lists a login the task didn't have. A task's first read only sets `marks` and `seen`; a task on a project that isn't on GitHub here is
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
task's `maxMinutes` (unset: `settings.scheduleMaxMinutes`, else 60; 0 none, never an agent's to set: `agentNo`, as both
settings are `AGENT_SETTINGS_NO`; not a workflow's, which has its budget, nor an extension's) its turn gets Esc, as Stop does (the chat stays: a prompt goes on in it; a wait isn't Esc'd, Esc would
answer it), the run is `stopped`, *time limit 45 min* its `said`, told as a failure is (`ranTold`'s `limit`: Tell me's
needs too), and `runEnded` leaves a stopped run as it is. `settings.scheduleAtOnce` (unset 2; 0 no cap; a bad value: the
default, `count`) caps the runs going (`holds`: running, in its first day, its tab still there and not idle after it
was seen working, an Esc by hand; a workflow's until it ends; `begun`: starts under way); a due one over it waits
(`queued`, its due time, the page's *waits its turn*), oldest first, started by `lineTick` (each tick, and `lineNext`
as a run ends: `runEnded` but a wait, `scheduleFlowEnded`, a time limit) with *waited its turn (due 02:00): …*. One
still waiting at its task's next time: a *skipped: queue* entry at its due time, and the new one waits instead. Off or
archived: its place goes. Run now, a retry and a catch-up don't wait; an extension's fetch isn't counted. The form's
clock chip sets the task's limit and, below it, every task's and how many at once (`SchedulesApi.settings`).

After another task (T9, `after: { task, when, perDay }`, instead of times or an event: `when` '', an empty `rule`, no
`next`; `afterOf` as it's saved: the task there, not itself, in its project, not archived, no loop (the chain above it,
walked), `CHAIN_MAX` 5 with the chain below it (`below`); `when: "after <name>"` is when.ts' `parseAfter`, the name or id
found among the project's tasks). `afterEnded(r)` as a run ends: `runEnded` (done, failed: not a wait), `timeTick`'s
stopped, `scheduleFlowEnded`, an extension's run, a failed start with no retry waiting (`settle`'s `again` is not an
end); each task after it that's on (`done`: only a run that ended done; `any`: however) once per run (`afterRun`, the
run's id, set before it starts: a resumed turn's end again doesn't start it twice), `afterGo`: `perDay` (unset
`EVENT_DAY`, 10) by its runs today with `after`, a skipped one logged; then the queue (`full`, `inLine`, one waiting
skipped as the queue's are) or `runSchedule` with *after Nightly deps (done):* before what it did. Only if, its plan
limit, its time limit, retries: as any run. `ws: 'parent'` (after only, an agent's task): `parentWs`, the workspace of
the run in `afterRun`, its agent there told (`send` whenIdle), as a workspace it shares. Deleting or archiving a task
others run after throws unless `dependents: 'off'` (the page asks; the CLI's `--force`): `orphans` turns them off with
`pausedWhy` and `pausedField: 'after'` (Fix, at its chip). The page shows them under that task (`under`, a step in:
`.sched-deps`), *after done* / *after any*; the Calendar on that chain's first timed task's days (`afterOccurrences`,
`untimed`).

### Notifications

Out loud (Settings › Voice › *Speak asks*, *Speak when done*: `voice.speakAsks`, `voice.speakDone`, the user's alone:
`voice` is in gates.ts' AGENT_SETTINGS_NO): a waiting turn's or a finished one's notification (useDaemon's `spoken`)
carries `shared/speak.ts` `spokenNote`'s sentence, "<workspace> asks: <first sentence>" through `speakable` (no code,
links, paths, secrets.ts' shapes), cut at `SPOKEN_WORDS` (20); none in Quiet (api.ts' `quiet` drops it too), Recording
mode, for a private workspace (its own or its project's), or for a tab in view in the focused window. Main's `notify`
sends it back to the app window (`speak`) unless the talk pill is open; renderer `say.ts` reads it (`utter`: the
talk pill's voice pick), two at most waiting (the older dropped), Esc or the talk key (main's `talk`: `speak` '') stops it.
Unit test: test/speak.test.ts.

The renderer posts them (`turn` events, App.tsx): off when `settings.notify === false`, per kind
`settings.notifyOn[waiting|done|limit] === false`, or a muted workspace or tab (`muted`, ⋯ and right-click menus).
Mute project (`project.muted`, projectSet's, the user's: AGENT_NO): core's `wsView` gives each of its workspaces
`muted` and `mutedBy: 'project'`, so every check of a workspace's `muted` (the notify, the counts, the tray, cards) holds
for ones made later too; phone.ts' `mutedWs` reads the project for pushes. Its workspaces' menu offers *Unmute its project*.
T16's one-time bell (`tab.bell`, `tabBell`: the user's or a phone's, AGENT_NO; a workspace's sets its running agents',
none running: its first agent's) rings once at its next ask (`told`), turn end, failure or limit (the `idle` case), or,
when a Done check follows, at the check's end (verify.ts `say`; a failed check leaves it set): core's `ring` clears it
and the event carries `bell`, which the app tells as an important workspace's (a card, its answers) whatever `notify`,
`notifyOn` and a mute say, and `phone(…, bell)` pushes whatever the webhook's `waiting` and `done` say. Do not disturb
holds it (`ring` returns false, the bell stays); Recording mode's hidden workspaces stay quiet (QUIET, `hidden`).
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
`format` ntfy/slack/json/webpush, `waiting` unset on, `done` unset off) and Telegram (below), each by its own When
(`phone.ts` `to`; `send` makes one nonce for both, buttons only where taps come back) on a `turn` that waits or is done, and on
`overToYou`; once per state change of a tab (`pushed`, cleared when `view()` sees it running), never muted. At the Mac
(#1: `presenceSet`, main's `presence` every 15 s and on lock/unlock: the system's idle seconds and the lock; `atMac`:
unlocked, input in the last `settings.pushIdle` s (120), heard from in the last minute) and `pushAtMac` not `push`, a done
turn isn't pushed and a wait goes only after `pushAfter` s (90) if it still waits and is still the tab's latest (`waits`,
numbered from one count; the latest's timer takes its entry out); a bell goes anyway. A wait goes 800 ms
later with `askOf`'s choices as lines (JSON: `options`; `webhook.detail` `titles`: `pushRequest` drops the question,
choices and nonce, Settings' *What it sends*, L8); with `webhook.answer` (Settings' *Answer from the phone*,
off by default) a `nonce` per push: Telegram's `inline_keyboard` (`callback_data` `nonce:n`) and ntfy's JSON publish
to the server's root with `http` actions (3 at most) posting `nonce:n:sig` (`push.ts` `tapSig`: an HMAC of the
nonce and choice with `<data>/tap-key`, 0600; `replies` drops a tap without it) to `ntfyReplies` (`<topic URL>-<replyTopic>`,
the random part Settings makes). `types.ts` `answerOk`: ntfy answers need the server not to be ntfy.sh or the URL to
carry `auth` (a public topic: anyone reads the nonces); `settingsSet` refuses another (`ANSWER_WHY`), `load` turned an old
one off once (`webhook.answerOff`, Settings' note). `awaiting` keeps each nonce with the tab and its choices; while any is there,
`phoneTick` (every 5 s while a webhook's ask waits, `awaiting`'s `hook`; the API's for tests) runs `push.ts` `replies`
(ntfy's `/json?poll=1&since=`) and answers a tap whose
nonce is waiting and whose tab still shows the same choices (`answer` with `label`); a nonce goes as it's used, when
its tab stops waiting, or after a day (`prune`, also run by core's `changed()` as the view changes); none left: the timer stops. ntfy gets a
`Title` header (RFC 2047 past ASCII) and the question as the body; Slack its text escaped; JSON `{event, workspace, tab,
agent, message, ts}`. `https://` only (plain `http://` to localhost: tests' server; Settings flags another). 5 s timeout, a failure logged. `webhookTest` is Settings' *Send test* (answered, not logged).
A workflow's waits (workflow.ts' `ask` and `unsure`: Ask you, confirm, stuck, a decision; not an agent's ask, its tab
pushed) are `flowAsk(run, question, options, show)`: a `waiting` push titled *Workflow <name> in <ws> asks you*
(`webhook.waiting`, a muted workspace's none), the question and `show` in 500 characters, `{ n: i + 1, label }`, and a
nonce (`nonceFor`, the tab's rule) kept in `awaiting` as `flow` (the run) with its options' JSON; `phoneTick` (`stillAsks`)
drops it once `flowHooks.waitKey(id)` (the run's wait's options, none past it) isn't that, and a tap is
`flowHooks.answer({ id, n: n - 1 })` (`flowAnswer`). Tested in `test/push.test.ts`.

Telegram (Settings › Telegram, `telegram.ts`; `state.telegram`, the view's `telegram` by `tgView`: no token, no code, no
ids; `keyed`: a token is kept, so a view or a push never reads the key store) is your own bot, paired with one user in its private chat. The token: `telegramSet { token }` checks it with
`getMe` (BotFullInfo: `username`, `has_topics_enabled`), keeps it by `keychain.ts` `keyWrite('telegram', <data>/telegram-token)`
(the Keychain, else that 0600 file), never in state.json, the view, a log or an error (`scrub`: a URL holds it, `TOKEN`'s
shape is masked anywhere); another bot's token unpairs. Pairing: `telegramPair` makes a code (16 random bytes, base64url:
22 characters of a start parameter's 64) for `LAKI_TG_PAIR_MS` (10 minutes), answers `{ link: t.me/<bot>?start=<code>,
until }` (the window's QR; the view says only `pairing: until`); the first `/start <code>` from a private chat
(`chat.id === from.id`), compared in constant time, pairs that user at `answer` and uses the code; anything else from
anyone else is ignored without a word (`ignore`: a log line a minute). The long poll (`loop`): one `getUpdates`
(`timeout` 50, `allowed_updates` message and callback_query) at a time with its own `AbortController`, run while a code
waits or it's paired, on and at answer or control (`wanted`, `sync` as any of that changes; never at notify); network
errors back off 1 s to 60 s (one log line until it works), a 429 waits `retry_after`, a 409 (another reader, or a
webhook on the bot) stops with a notice to use a bot only for Laki and touches nothing of the other's, a 401 turns it
off with a notice; `telegramSet { off: false }` tries again. A message older than 2 minutes (`date`) is dropped with
*Laki was off*; a callback has no date, so after a gap of 2 minutes (`lastOk`) what waited is read at once
(`timeout: 0`, `behind`, until a batch isn't 100 full) and its taps dropped (*too old*); a long poll's then are fresh.
Unpair, another person or another bot: `phone.ts` `tgDrop` forgets the asks' Telegram message ids. A tap on an ask that
moved on edits its message too. A new workspace's prompt with a `!` line is refused from Telegram and remote access's
answer level (`newOk`, as `sendOk`). Out: `out`, one call at a time, `LAKI_TG_GAP_MS` (1 s) apart, a 429 waited out once. A push (`tgPush`) is HTML
(`tgHtml`: the title bold, every value escaped by `esc`, secrets' shapes by `redact`, over 300 characters folded in a
`blockquote expandable`), `disable_notification` when done, `link_preview_options` off, a button per choice
(`callback_data` `nonce:n`, unsigned: only the paired user's private chat counts) at answer and up unless titles only; its
`message_id` stays with the nonce (`awaiting`'s `msg`), and as it goes (`gone`) `tgDone` edits it
(`editMessageText` with an empty `inline_keyboard`) to say *Picked: …* or *Answered on the Mac, or it moved on*. A tap
from the paired user (level answer and up, and on) is `takeTap(tap, true)`: an agent's ask only (a workflow's ask goes
to Telegram as text, no buttons: its confirm may merge; remote access's Keep never), counted in the minute's limit and
logged, its callback answered with what it did; with no buttons a push lists its choices as lines; a batch
stops as its loop is aborted (the next loop reads the rest from the offset, never twice). Pairing another person
starts at answer and forgets the old chat's messages (`forget`, as Unpair and a new bot do). Remote access's link
(`phoneRemote`: its token and key) never goes to Telegram. P2: each push's
`message_id` → its tab (`remember`, the newest 500 in `<data>/telegram-msgs.json`, 0600, so it outlives a restart); a
message that replies to one (`reply_to_message`; not a workspace Recording mode hides) goes there (`deliver`; a slash
in a reply or a topic is a command only when it's a known one: a path is words): a waiting ask's choice when the text is its
number or its words, only in a reply to that ask's own push (`askOfMsg`: a "yes" to an older one is words, never an
Allow; `answer` with `label`, its push then *Picked*), else `send` with `whenIdle` (and *Queued* when an ask waits), a 👍
(`setMessageReaction`, refused quietly) its receipt, a failure said back (*Not sent: …*); a photo (its biggest size) or a
document: `getFile`, then `/file/bot<token>/<path>` read up to 20 MB (`readCapped`) into core's `imageSave` or `fileSave`,
its path after the caption. 🤖 Laki AI (`focus` `@ai`: `/ai [question]`, the projects view's button, `nav:a`; *Where
should this go?*'s `nav:ta`): `askAi`/`aiGo` hand the words (a photo as `images`) to main.ts' `tgHooks.ai`, aiAsk in the
AI page's chat with `AI_WHERE` as its context and `act` as its rpc, so each tool call is the chat's (TELEGRAM_OK at its
level, the limits, What Telegram did); `sendChatAction` typing every 4.5 s, the answer as `mdToTg` (3,500 characters,
redacted); one ask at a time; its `laki_ask` (`aiQuestion`, TELEGRAM_OK at answer, never one with an `act`: main.ts'
`TG_SAYS`) as a button per answer (`tgHooks.aiAsked`: the chat's open plain question once its turn ends), a tap
(`nav:q:<id>:<n>`) its pick through `tgHooks.aiPick` (`aiAnswer`, with `AI_WHERE`), the question edited to say it. Its backend: types.ts `tgBackend` (settings `tgAi`, Settings › AI › From Telegram; the
user's: AGENT_SETTINGS_NO, REMOTE_KEYS): main.ts marks Telegram's rpc (`tgRpcs`, ai.ts), and aiAsk (its queue and
aiPick's too) takes it over the Mac's, `Opts.backend` to `target`; none (the Mac's claude or codex, tgAi unset) refused
(`aiNo`: their Read and laki mcp act as you), `mac` (a typed FULL ACCESS) runs them anyway; refused with Titles only. A message that replies to nothing and isn't in a topic: a pending ➕ New task's (`newIn`, 10
minutes: `started`, `wsNew` then talked to), else the workspace you talk to (`state.telegram.focus`: a card's 💬 Talk
here, `/talk <workspace>`; `/talk off`; gone with the workspace, Unpair or another bot), else *Where should this go?*
(`whereTo`: the words kept 10 minutes under a key, `pend`; a button per agent's workspace, the newest six, and at
Control ➕ New in each project: `nav:to` sends and talks there, `nav:mk` starts one; refused after a gap). Buttons
(`/menu`, `/help`'s 📂 Projects; `nav:` callbacks, never an ask's `nonce:n`): `projectsView` › `projectView` (a page of
`PAGE` 8, ◀ ▶) › `wsView` (its agents' state, a waiting one's ask, the last thing its agent said by `chatRead` as
Markdown, unless titles only; 💬 Talk here, 📺 Screen, 📝 Diff (`screenOf`, `diffOf`, /screen's and /diff's too), ⬆ ⬇
the workspace before or after, ⬅ its project; at Control ⏹ Stop while an agent's turn runs (`nav:x`, `stopIn`:
`stopAll` with its tab, each one under way) and 🔀 Merge #n on a green PR (`greenPr`: open, no draft, checks passed,
GitHub's `ready`, no conflict, not GitLab's nor a fork's): `nav:m1` edits the card into what it merges with ✅ Merge #n
(`nav:m2:<key>:<n>`, refused once the PR isn't that one or isn't green) and Cancel, then `prAct` merge), each edited in place (`editMessageText`; *not modified* ignored); a
button names a project or workspace by a short key (`kOf`, `nav:<kind>:<key>`, under Telegram's 64 bytes), one from
before a restart says to open /menu again. A voice note or audio (`heard`): `getFile`, through `ffmpeg` to 16 kHz WAV
when this Mac has it (`LAKI_FFMPEG`: tests' none), else as it came (`format` ogg), then `voiceText` (Settings › Voice's
cloud, OpenRouter's key), its words shown back (🎙) and routed as typed. An agent's words (a push's body, a card's last
reply) go as Markdown (`shared/tgmd.ts` `mdToTg`: code, bold, italic, struck, links, headings, lists, quotes; the rest
escaped; a body with code or a quote isn't folded, as a blockquote can't hold them); Telegram refusing the tags (*can't
parse entities*) gets the same words plain (`out`'s `plainOf`). Every action goes through `tgHooks.call`
(main.ts): only `gates.ts` `TELEGRAM_OK`'s methods at their level, with `TG_SAYS`' checks (`stopAll` with a tab, never
every turn; `prAct`'s merge only, no force; `aiQuestion` without an act), else `ANSWER`'s of what they say (`sendOk`: an
agent tab's, the whole message, never a `!` line; `answer` without `say`), then as the user's call. A done push to
Telegram carries the turn's last line and the workspace's diff (`files.ts` `stats`: `+add −del · n files`). P3: the
commands (`COMMANDS`, `setMyCommands` with a `chat` scope as it pairs and as the level changes: the level's only):
`/status` (`state`: Needs you, Working, Done, each with its agent tabs; a waiting one's ask, `redact`ed, unless titles
only), `/screen` and `/diff` (the tab a reply's push was about, else the named workspace's first agent tab, `tabFor`;
none with titles only; `<pre>`, the last 3,500 characters, `redact`ed), `/quiet` (`dndSet`), `/new <project> <task>`
(`wsNew`, control only); `/start` and `/help` list them. Recording mode (`phone.ts` `hidden`) keeps a private workspace
and project out of each. `act` spends trusted clients' limits (`clients.ts` `LIMITS`, `LAKI_TG_LIMITS` for tests): `send`
and `answer` a sliding minute, `wsNew` a sliding hour; and logs each action or refusal (`remoteLog.ts`' `activity`,
`<data>/telegram-log.jsonl`; reads not; `telegramLog`, Settings › Telegram › *What Telegram did*), with pairing, Unpair,
a level and a stop. P4: topics (`state.telegram.topics`, off by default; `telegramSet { topics: true }` asks `getMe` again
and refuses until the bot's `has_topics_enabled`, BotFather's switch): a workspace's first push makes its topic in the
private chat (`threadOf`: `createForumTopic`, its name, one of the six icon colors by its id; one at a time per
workspace, `making`), kept in `threads` (ws → `message_thread_id`); its pushes go there (`message_thread_id`), answers
to a message in a topic go in it (`sayIn`); words in a topic that reply to nothing go to that workspace's first agent tab
(`wsOfThread`), and `/screen` or `/diff` there with no name are that workspace's; `dropWs` (core) deletes it
(`tgWsGone`: `deleteForumTopic`). Telegram refusing to make one (a 400 or 403) turns topics off with a notice; offline
or busy, only that push goes to the chat. A topic deleted in Telegram (`sendMessage`'s "thread not found") is forgotten
and made again for that push. A reply picks a choice only when it answers that ask's own push (`askOfMsg`: its
`awaiting` entry, `tg` where Telegram's push had buttons) with the same menu still on screen (its `key`), and not with
titles only; a tap neither. A token gone from the key store (a backup from another Mac) stops the poll with a notice
and Try again. Unpair, or another person pairing, deletes the old chat's menu (`deleteMyCommands`). Remote access's Keep
never goes there (`tgTaps: false`). Migration (`tgMigrate`, core's `load`): a `settings.webhook` of the old `telegram`
format: its token to the key store, the webhook gone from state.json; a positive `chat_id` (a private chat: its user's)
paired at answer with its When, a group's (or a URL with no token of a bot's shape) only a notice; saved at once (the
token off the disk's state.json); `tgStart` names the bot (`getMe`; offline: again as the poll first works) and sets
the menu; `settingsSet` refuses the format. `telegramSet`,
`telegramPair`, `telegramTest` are the user's: AGENT_NO, REMOTE_NO, ANSWER_NO, no client's scope. `LAKI_TELEGRAM_API`:
tests' fake Bot API (localhost only). Tested in `test/telegram.test.ts`.

Archive on merge (`archiveMerged`, after `autoPR` in `scanPR`; `settings.archiveMerged`, off by default): a worktree
whose PR is MERGED, with no tracked tab other than idle, `rev-list <head>..HEAD` 0 and `wsArchive` `ifClean` (status,
uncommitted work in a submodule, ignored files of its own: `unsaved`, `docs/dev/api.md`; the log names which); once per
PR (`autoArchived`: an Undo stays). It broadcasts `archived`, which App toasts with Undo (`wsRestore`); a merged PR's
row says *merged* while the setting is on.

A turn running long (`turns.ts` `longTurnTick`, 60 s, `settings.longTurn` minutes): only ticks where the tab is `running` and not at a limit add up, each at most `LONG_GAP` (a Mac asleep); once per turn the `long` event (Open, Stop: main's `stop` action, `longStop`: its Esc through `input`, only while that turn runs and asks nothing), `phoneLong` (no Stop on a phone; Do not disturb holds it, as it does a workflow's pushes: `phone.ts` `quiet`, only an important workspace's ask goes) and `turn.long`.

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

Go back (#G1, `src/main/back.ts`; pure parts in `src/shared/update.ts`: `keepWhy`, `backRefused`, `backOf`, in
`test/update.test.ts`): on `update-downloaded`, `keepNow` copies the running bundle with `ditto` to
`userData/previous.noindex/next/Laki.app`, then in place of `previous.noindex/Laki.app` (one kept; `.noindex`: Spotlight leaves it out, so no second Laki shows there to open by mistake), and writes `previous.json`
(`{ version, stateV }`: `STATE_V`, moved to shared/update.ts, core re-exports it); none under `BACK_FREE` (1 GB) free or
off the packaged Mac app. `install` waits for it 5 s at most (`keepWait`: a copy still going is killed, none kept). The
first `update` state ask looks at it 10 s later (`lookBack`): `refused` (the Info.plist's
`CFBundleShortVersionString` equals the record's version, older than this one, `codesign --verify --deep --strict`,
`codesign -dv`'s Team ID for a Developer ID authority, the same as this bundle's) or the state's `back`
(`{ version, newerData }`: the record's `stateV` below this one's). IPC `update-back` (guards.ts `backAsk`: `fromApp`
and the main window's own webContents; `test/main-guards.test.ts`) runs `goBack`: checks, moves the copy beside the bundle
(`Laki.app.back`; `ditto` across disks), checks it again there, renames this bundle to `Laki.app.gone` and the copy into
its place (any failure puts both back), sets update.json's `pass` to this version, removes `.gone` in a detached `rm`,
`app.relaunch()`, `app.exit(0)`. The daemon keeps running from the later build: the earlier app's `newerDaemon`
(AppParts.tsx: its `built` later than this build's, on `app:` only) shows the stale bar with its own words, whose Restart
starts the earlier daemon (an older `STATE_V` then keeps state.json aside, R7's `newerData`). The swap is checked by
hand on a packaged, signed app (scripts/pack-smoke.sh's build), not in tests.

What's new (U13): settings' `seenVersion` is the version whose card was closed (core's `load`: a new install's own
`VERSION`, one from before U13 `''`). While it isn't this app's version (package.json's), App loads the release notes
(`?raw`, only then) and `update.ts` `notesOf` gives that version's first three lines (`## <version> ·`'s bullets), a
line's trailing `[Try it](laki://…)` apart as its link. panels.tsx `WhatsNew` shows them top right: *Try* routes the
link (App's `setLink`), *All changes* opens Settings › Release notes (for everyone now, its ⌘K item too), × or All
changes sets `seenVersion`. A version with no section (a build between releases) shows nothing. ui-smoke's
`whats-new` steps: shown for an old `seenVersion`, closed, gone after a reload.

**After an update** (S9, conn.ts `freshDaemon`, main's `daemon()` once per app start): a daemon whose `ping { caps }` says an API under 167 (`daemonStale`: no app://laki), or a plain `pong`, is asked for `shutdown { keep: true }`; one that refuses (the app before the update started it: this app's token isn't the one it gave) is stopped by SIGTERM (`stopDaemon`, only a pid whose command line runs `out/main/daemon.js`: `isDaemonCmd`), then a current one starts. `test/upgrade.test.ts`: a fake old daemon that refuses, and one another copy started that stops by its shutdown.

### Usage

Laki AI's OpenRouter credits (ai.ts `aiCredits`, `Usage.tsx` `creditsPart`; low: the ring's tip and the popup's tag): `GET /key`
(`usage_daily`, `usage_weekly`, `usage_monthly`, `limit`, `limit_remaining`) and `GET /credits` (`total_credits`,
`total_usage`: a key that may read them) with the key, at most every 5 minutes as the ring asks (each minute); each part
shown when the other is refused; `creditsLow`: under $1 or 10% left of the credits or of the key's own limit.

Plan limits (`usage.ts`, the renderer's `Usage.tsx`). R4: the endpoints below are undocumented and asked only when
`settings.usage[agent] === true` (Settings › Layout › *Ask … for plan limits*, off by default); Codex's own app server and
agy's own /usage unless it's false (`OWN_CMD`). Otherwise each
account's numbers are what the agent reports itself (meters.ts' `statusLimits(w, now, true)`: Claude's status line
`rate_limits`, Codex's transcripts' `token_count` `rate_limits` (share.ts' `meterOf` keeps the newest as `Meter.limits`,
`codexRateWindows`), chosen window by window across the account's tabs (an idle claude rewrites its status line with the
numbers it had, so the newest file can be behind): of a label's readings the later `resets` wins, then the higher
percent (usage never falls inside a window), then the newer; `at` the oldest reading chosen; one past its reset shows 0
(Usage.tsx `live`); `test/statusline.test.ts`. Of any age: `at` says when; past 20 minutes Usage.tsx dims them (`old`) with *As of HH:MM (11h ago)*, what they miss (use since, outside Laki too) and *Ask <host>* (`onAsk`: App's `settingsSet` of `usage[agent]` true, then read again; its tip Layout's words); the ring's tip says *as of*), `source: 'own'`;
none yet: a row with `SAYS`' error. Asked, `source: 'endpoint'`. An install from
before (state.json there, an agent's `usage` unset) gets `settings.usageNote` true once: Settings › Resources' note,
OK sets it false. A delayed start's *after the plan limit* (schedule.ts `pendingTick`) reads the same: an own window
whose reset has passed starts it. With the endpoint on, `usage` reads Claude's `GET api.anthropic.com/api/oauth/usage`
(`Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`; no redirect followed, both; the token is the freshest of `security
find-generic-password [-a $USER] -s "Claude Code-credentials" -w` and `~/.claude/.credentials.json`) and Codex's `GET
chatgpt.com/backend-api/wham/usage` (`$CODEX_HOME/auth.json` `tokens`, `chatgpt-account-id`: `codexWham`, only for a codex
that can't say its own, below). Tokens are read-only: never refreshed (that can sign the agent out), an expired one isn't
sent; `test/usage.test.ts`' guard: turned away (401) with both on, no URL with `oauth/token` or `/token` is asked, and the
fake Keychain item, `~/.claude/.credentials.json` and `$CODEX_HOME/auth.json` are byte for byte as they were.
Codex's (`codex`, unless `usage.codex` is false: Settings › Layout › *Ask Codex for its plan limits*): its own app
server, `codex app-server` (no shell; the account's folder as `CODEX_HOME`, else the agent's own), JSON-RPC on its stdio
(`asked`, shared with accounts.ts' model lists): `initialize`, the `initialized` notification, `account/rateLimits/read`;
killed at its answer or 15 s (`APP_MS`, `LAKI_CODEX_APP_MS`: tests'). Codex reads its own sign-in: Laki reads none.
`codexAppWindows`: `rateLimits`' `primary` and `secondary` (`usedPercent`, `windowDurationMins`, `resetsAt` in seconds,
as `codexRateWindows` reads a transcript's), then each other limit of `rateLimitsByLimitId` by its `limitName`; `plan`
its `planType`. An error naming the method (`-32601`, *unknown variant*: an older codex), a codex that ends without an
answer (one with no `app-server`) or none installed:
`wham/usage` only when `usage.codex` is true, else *This Codex doesn't say its limits* (the popup's *Ask chatgpt.com*
sets it); one saying 429: the back-off. Measured on an M-series MacBook Air (codex 0.171.0): 0.65 s to its answer and
0.15 s of CPU, 3.6 s and 0.3 s the first time in a while (its network). The fake: `test/fakes/codex`'s app-server
(`FAKE_CODEX_LIMITS`: `unknown`, `slow`, `fail`). Each agent's answer is kept 5 minutes
(`USAGE_TTL`; Claude's 7.5, `TTL`: Anthropic turns away faster pollers; a turned-away token too), one that asked no server or failed on the way 1
(`AGAIN`); a 429 (`busy`) its `Retry-After` (`waitOf`), else `BACK_OFF` (10, 20, 40, then 60 minutes, `slows` in a row), the last
answer with numbers (`last`) given meanwhile with the error and `next` (Usage.tsx' `waitText`: from when, checked again when); the RPC's `now` (tests'). The renderer asks every minute (and notifies near a limit: Notifications). Tests set `LAKI_USAGE_API`
(a fake server for both; only `http://127.0.0.1` or `localhost` count: a session's env can reach a daemon the CLI starts) and get a fake `security`
(`test/fakes`) reading `$HOME/keychain`: never the real Keychain. Claude's account whose tab wrote `rate_limits` in its
status line within `STATUS_FRESH` (meters.ts' `statusLimits`, below; main.ts passes it as `usage`'s `own`) shows
its 5-hour and weekly windows (`claudeWindows`' labels), the endpoint's others and plan as `last` had them; the endpoint
is still asked on its TTL (`ask`): only it has the per-model weeks (`limits[]`' `weekly_scoped`: Fable's). The endpoint
off, the popup says so (Usage.tsx' `asks`, Settings' `usage`).
Gemini CLI's quota went with it. Grok and Antigravity (`othersWho`: no accounts in Laki, their own sign-in, listed
once it's on this Mac: `~/.grok/auth.json`; `agy` on PATH with `~/.gemini/antigravity-cli`). Grok, asked only when
`usage.grok` is true (as Claude's and Codex's), as Orca does: `GET cli-chat-proxy.grok.com/v1/billing?format=credits`
with auth.json's token (`grokCred`: xAI's own issuer first, a live one before an expired one; an expired one isn't
sent), `X-XAI-Token-Auth: xai-grok-cli` and `x-userid`; `creditUsagePercent` the week's, `monthlyLimit`/`used` a unified
account's month, else the same without `?format=credits` (`grokWindows`); ponytail: Orca's guesses at a percent the
server leaves out skipped. Antigravity unless `usage.gemini` is false: agy's own `agy -p /usage --output-format json
--print-timeout 20s` (Laki reads no token: agy signs in itself), in the temp folder, stdin closed,
`AGY_CLI_DISABLE_AUTO_UPDATE=true`, 30 s; `agy --version` first (kept 6 hours), under 1.1.11 not run (its /usage took a
model turn then); never `--disable-slash-commands` (that sends /usage as a billed prompt). `agyRead`: the JSON line
among log noise; a reply with turns or a conversation id (`billed`) stops asking until the daemon restarts;
`agyWindows`: a window per group's bucket (`5-hour · Gemini`, `Weekly · Claude and GPT`), disabled ones out, the 5-hour
ones first (the ring reads a row's first). Measured: 3.4 s, 0.6 s of CPU, every 5 minutes while the window asks.
Tests: `test/usage.test.ts`, the fake agy's `--version` and `-p /usage` (`FAKE_AGY_VERSION`, `FAKE_AGY_USAGE`).

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
name `"usage"`, `token_count` or `turn_context`). With it, the chat's other transcripts (`extraFiles`, each a `Sub`
read on by `readOn`, keyed by path; `r.sum` (`meterSum`) the spend of all of them, the view's usage, today's and the days;
never `used`): claude's subagents, every `*.jsonl` in `<its file without .jsonl>/subagents/`; codex's threads it spawned
(`codexKids`, looked for every 30 s): a rollout whose first line's `session_meta` names a parent (`parent_thread_id`,
under `source.subagent.thread_spawn`) in the chat or one of its threads, in the day folders from the chat's own on, each
file's first line read once (`parents`). None for Laki's copy of a chat. Claude: an answer's lines share a `message.id`, the last one's usage
counts (`msg`, `was`); `used` is its `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` (not a
sidechain's; `<synthetic>` skipped); the window `WINDOW` (200K), 1M for a `[1m]` model (the tab's or its preset's
`model`, the preset's args; none named: claude's own settings, `claudeBig`: the workspace's `.claude/settings.local.json`,
`settings.json`, then the account's folder's) or once `used` is past it. Codex: `turn_context`'s model, the last `token_count`'s
`last_token_usage.total_tokens` of `model_context_window`, its `total_token_usage` growing (`total`: a smaller one is
counted anew); claude's answer is a line per block, the largest of each part across its lines counts (a subagent's
output grows as it streams: T3 Code's rule, `partsMax`), once. Tokens as parts by model (`Meter.by`, `days`; `types.ts` `Parts`: `in` (input not from the cache), `out`, `w5` and `w1`
(cache writes kept 5 minutes and an hour: claude's `cache_creation.ephemeral_1h_input_tokens`, the rest 5 minutes; no
split said, all), `rd` (reads); `L` past the model's long line, `F` fast mode: `partsOf`, share.ts `usageParts`), priced as
they're read (`meterCost`: the priced cost, the tokens of each model with no price). Prices: yours first (`settings.prices`,
Settings › Usage › Model prices and the Usage page's *Set price* on a *no price for <model>*: `{ in, out, rd?, w5?, w1? }`
USD per million, or `{ as: '<model>' }` priced as that one, three hops at most; `ownPriceOk` checks them in `settingsSet`;
core.ts sets `priceYours.of`; a kept day re-prices at once, its rows keeping parts), then `shared/prices.json`
(`npm run prices`, scripts/prices.ts: LiteLLM's table, the claude-*, gpt-5*, grok-*, gemini-*, glm-*, kimi-* and MiniMax-*
chat rows, a first party's own (`xai/`, `zai/`, `moonshot/`, `minimax/` dropped) over a reseller's same id, dated), then
`types.ts` `PRICE_OWN` over a row field by field (retired claude ids old chats name, Sonnet 4 and 4.5's rates past 200K,
fast mode's 2x on Opus 5.5, Opus 5, Opus 4.8, Fable 5.2 and Mythos 5.2); by the exact model id, never a family guess: a
model with no row is unpriced. `costOf`: a 1-hour write 2x input and a 5-minute one 1.25x unless the row says; a
request whose whole input (cache too) is past the row's `long.above` (Haiku 5.5's 100K, Sonnet 4/4.5's 200K, gpt-5.4,
5.5 and 5.6's 272K) at those rates, every token of it (codex's: its own request's, `last_token_usage.input_tokens`, not
what the totals grew by, which can be several requests: a rollout read from its middle, its first `token_count` read);
fast (claude's `usage.speed` `fast`) times every rate. Claude's advisor calls (`usage.iterations`' `advisor_message`: the
top-level usage is the executor's alone) each count on their own model at its prices, keyed as the answer's and
`:advisor:<index>`, never in the context. Antigravity's steps keep their parts (field 9's 2 input, 3 output, 4 cache
write, 5 cache read), priced as the API's where its model has a price.

The ledger (meters.ts `ledger`): `<data>/usage-days.json` is the only one, by chat (its session id: claude's transcript
name, codex's `session_meta` id, OpenCode's, agy's and Grok's own; a tab's `resumeId` is that same id for each). Each
answer an agent's API call was billed for counts once: its key (`answerKey`: claude's message id and request id, else
the line's uuid; codex's `token_count` payload, totals and limits, copied as they were; Grok's turn end and model, agy's
conversation and step row, OpenCode's message id: agentUsage.ts; sha-256, 11 characters) is owned by the first chat to
report it (`owners`, kept as each chat's `keys` by day, gone with the day) and its parts are added to that chat's day
and model as it's claimed (`rowAdd`); a forked or resumed chat's copied lines add nothing there, its context still its
own. A tab's file also by its first file (`keyFile`: a spawned codex thread's copy of its parent's turns). Every reader
goes through it: a tab's live read (`ownsOf` in meterOf, `otherRead`'s records) and the machine scan (below); a reader
only reads and hands records (share.ts `UseRec`: chat, key, day, model, parts or `own`, cwd). `grow`: an answer claimed in
the last 10 minutes (`GROW_MS`) and its parts so far, kept in the file: a later line of it adds what grew (over a
restart too); ponytail: one whose lines are further apart counts its earlier ones. `pre` (`LEDGER_V` 2): what 0.68.0
kept that no key backs (rows from before parts, Grok's, agy's and OpenCode's totals), moved aside as the file loads and
shown as it is until the chat is read again (its first record): the recount replaces it outright; a chat whose
transcript is gone keeps it, and a deleted transcript never loses its rows or keys. `skip`: chats Laki's own runs made
(`usageSkip`: Laki AI's claude -p and codex exec chats, their session or thread id; aiOnce's claude runs
`--no-session-persistence`, never resumed): its call log counts them. `usageWs`: a side chat's fork (turns.ts) is its
tab's workspace's.

The machine scan (`usageScan.ts`, `settings.usageAll` on unless false: Settings › Usage › *Count every agent chat on this
Mac*; off: Laki's own tabs only; nothing leaves the Mac): every agent chat on this Mac changed in the last `USAGE_KEEP`
days, read in a worker (`usageScanWorker.ts`, its own build entry beside agyWorker, 512 MB heap, ended at 10 minutes:
what it posted stands) that only reads and parses, its records applied here through `ledger` (no ws: a chat no tab
claimed keeps the folder it ran in, `dir`, its newest line's `cwd`, realpath'd). Claude's `projects/*/<session>.jsonl`
and `<session>/subagents/*.jsonl` under `homeDir('claude')` (CLAUDE_CONFIG_DIR) and each account's folder, Codex's
`sessions/**/rollout-*.jsonl` under `homeDir('codex')` (CODEX_HOME) and each account's (a folder whose `projects` or
`sessions` resolves to one already read: once), a spawned thread's chat its root's (`session_meta`'s
`parent_thread_id`, up; rollouts in name order), Grok's `~/.grok/sessions/<cwd, encoded>/<id>/usage.json` whole,
agy's every `conversations/<id>.db` (its folder from `cache/last_conversations.json`) and OpenCode's `opencode.db` (`ocDb`,
`ocRead` without a session: every one, each under the one it hangs from, its `directory`), only the rows past the last
counted. The oldest first (birth time): a chat before its forks, whose copies are its. When: the Usage page's
`usageDays` (the last scan ended over 5 minutes ago, `LAKI_SCAN_AGAIN_MS`: tests', or Laki's project and worktree
folders changed since), answered at once with what's kept, `changed()` as it ends; and every 15 minutes (`usageScan`
tick, `LAKI_SCAN_MS`). Each file's `{ size, mtime, ctime, ino, pos }` (and a codex rollout's running totals and model at
`pos`, its `session_meta` id and parent; the chat and folder last read) in `<data>/usage-scan-v1.json` (the version in
the name: an older Laki never writes a newer one's), saved every 30 s and as the daemon stops (`usageScanStop`; the
ledger first, so the state is never past what it kept): a quit mid-scan picks up where it stopped. Unchanged: skipped;
the same inode and bigger: read on from `pos`; any other change (same size and a new mtime, a new inode, smaller): read
again from 0, the ledger's keys counting nothing twice; a DB: its rows past `pos` (a rowid). 4 files at a time, paced to
32 MB/s on average (Orca's `UsageScanReadBudget`: a debt past 5 s forgiven, under 50 ms not waited: a small scan never
waits), 8 MB reads of whole lines (a longer line: a bigger read, past 128 MB skipped). Laki's own claude -p chats: the
ledger's `skip` (above). Where each chat shows: a Laki tab's under its workspace (`ws`), as before; any other (`ws` '') by its folder (`dir`):
meters.ts `whereOf`, the Laki project or worktree with the longest folder that holds it (both resolved; a folder gone
since: its nearest one still there, the rest as said) names it (`<project> · <workspace>`, Recording mode: a private one
unnamed), else *Outside Laki · <its last two folders>*, none said *Unknown folder*: `usageDays`' rows' `where`. The
Usage page (Usage.tsx) filters In Laki (Laki's tabs and Laki AI), Outside Laki and All (the default), and by agent; it
reads again as a scan ends (`View.usageScan`: `at`, `running`). Today counts every chat; `todayView`'s `out` is the
outside ones' (the popup's *Outside Laki* row, *Today*'s tip: In Laki and Outside apart); its workspaces Laki's. A
workspace's cap, a goal's and a workflow's budget still count only Laki's tabs (`meterView`). Tested in
`test/usage-scan.test.ts` (the worker's `scan` alone, and the rig: a tab's chat, its fork, a resume, a codex thread
once; where each shows; usageAll off). `meterView`: `TabView.context` `{ used, max }`, `usage`
`{ tokens, cost? }`, `skills` (B7: share.ts `skillsIn`, the lines that name `Skill`, `SKILL.md` or *Base directory for
this skill*: claude's Skill calls (`input.skill`), the message that loads one (its folder; a `/skill` typed has only
that), a Read of a SKILL.md; codex's shell calls that read one; the main chat's, by name in the order loaded, 50 at
most). The status bar's `.sb-ctx` is a button: its menu lists them, a pick calls `skillOpen` (`tab`, `name`: the
folder said, else the workspace's `.claude/skills/<name>` or `.codex/skills/<name>`, else the agent's own; its SKILL.md
in the editor; the user's only). share.ts `toolLine` names a Skill call's skill (the Reader's `.rd-skill` chip). Today's (`dayOf`, by each line's `timestamp`, this Mac's day: the day's parts)
per chat in `<data>/usage-today.json` (`spent`: `day`, `chats` by resume id with its workspace, its name then, `tokens` and
`models` (each a `Row`, the ledger's of today: `todayFlush` copies a chat's as the ledger moves it; one kept before parts
under `''` until the chat's read again), `nameOf`: none for a private one, so a removed one is still named, `gone` in
StatusBar's Today), the view's `today`
(`todayView`: tokens, cost, the 5 workspaces that used most, `unpriced`: the models with no price and their tokens, the
popup's *no price for <model>* lines). The Usage page's days: the ledger (`kept`: by chat its workspace,
agent, `days` (day, model: a `Row`), `keys`, `pre`), written 2 s after a read (`daysLater`, once for a tick's tabs; `daysWrite`
as the daemon stops), 90 days kept. A `Row` (share.ts): `{ p }` parts, priced now; `{ tokens, cost, own }` an agent's own
count (Grok's and OpenCode's price; agy's no cost: no price); `{ tokens, cost }` one kept before parts (old: its cost then).
`usageDays` (`daysRows`): a row per day, agent, model and workspace with `priced` (false: no price), `old`, `read` and
`input` (the cache's share: Usage.tsx *From cache*). `test/meter.test.ts`: the prices, a 1-hour write, fast mode, long
prompts, the fixtures' models all priced (`test/fixtures/transcripts`), a re-price of a kept day (`PRICE_OWN` changed), a
subagent and a spawned codex thread (`test/fixtures/transcripts`), a fork's copy once over a restart.
A workspace's spend cap (`daemon/cap.ts`; `Workspace.cap` as `Cap` `{ usd?, tokens? }`, `{}` none; unset: its first agent
tab's profile's `cap`, else its project's: `capOf`; `capParse`: a number or `$5`, `2M tokens`; `wsNew`'s and `laki new`'s
`cap`, `wsSet`'s, `projectSet`'s, `presetSave`'s): `capView` sums its agent tabs' `meterView` usage (their subagents' and spawned threads' too), dollars of a priced
chat and tokens of an unpriced one, `unpriced` the models with no price (the tip's *no price for …*: `capSpent`) (the view's `spend`: `share`, the larger part spent; `measured` false when nothing it
has counts against it: *not measured*). `capTick` after each `meterTick`: at 80% one notice (`capTold`, reset as the cap
changes), at 100% `capOver`, a push (`flowPhone`) and one notice with *Add $5 again* (the cap doubled), *Leave it
stopped*, *Remove the cap* (`alertShow`'s `mac`: those two refused to remote access at Answer only, main.ts' ANSWER
`alertAnswer`); each running agent turn gets Stop's Esc once as its tool call ends (claude's PostToolUse, `Runtime.inTool`
from its PreToolUse, `capToolEnd`; another agent's, or a call past 60 s, at the tick). While over, `send` queues what it's
given (`over: true`) and `deliver` holds the queue; `capSet` under the cap lets them go (`queueResume`). An agent may set a
lower cap only (`capRaises`, main.ts' `agentNo`), never a project's or profile's; remote access at Answer only can't set
one (`WS_SET`, `NEW_KEYS`). A workflow's budget holds in its runs too: whichever ends first stops it. A closed
tab's cost stays in the sum and the cost warning's: `Workspace.spentClosed`, added in core.ts `closeTab` (the daemon's,
no call sets it), its `ClosedTab.spent` taken off again when ⇧⌘T resumes its chat (its meter counts it then); an
unpriced chat's tokens leave it. ponytail: a host's tabs aren't metered. `test/meter.test.ts`, `test/agent-gates.test.ts`. Grok's, Antigravity's and OpenCode's tabs (`agentUsage.ts`, from `meterTick`'s `otherRead`: this Mac's, read only) hand
the ledger their records under their own chat ids (`agentDays`, a record per turn, step or message, its key its own): Grok's `~/.grok/sessions/<folder>/<id>/usage.json` (each turn's
`endedAt`, per model `totalTokens` and `costUsdTicks`, 1e-10 USD, its own price; the folder `encodeURIComponent` of the
worktree, else any holding the id), agy's `~/.gemini/antigravity-cli/conversations/<id>.db` (its id, else
`cache/last_conversations.json`'s for the worktree; cloned to a temp folder with its WAL (`COPYFILE_FICLONE`: on APFS no
bytes copied, elsewhere node's copy), read with node's own sqlite, at most every 30 s per tab and only the `steps` rows
past the last one with usage that tab counted (`agyRead`'s `last`, kept in `seen`; a
row with no usage yet, a step under way, is read again; the table's rowid going below it is another conversation: read
whole); a DB and its WAL past 32 MB (`AGY_BIG`) are read in a worker (`agyWorker.ts`, its own build entry: 512 MB heap,
ended at 20 s; its records as it answers), past 256 MB not at all: `steps`' metadata, field 1 its time, field 9 its usage, 2+3+4+5 input, output, cache writes
and reads; `gen_metadata`'s 1.3 → 1.19 the model's name; tokens only). OpenCode's: its own `opencode.db` (the `data`
folder `opencode debug paths` names, `ocDb`: asked once, again every 10 minutes while it hasn't said; else
`XDG_DATA_HOME` or `~/.local/share`, then `opencode`; `OPENCODE_DB` when set; else the newest `opencode-<channel>.db`),
cloned with its WAL as agy's (`withClone`), every 30 s at most (`AGY_EVERY`, `LAKI_AGY_EVERY_MS`: tests'): `ocRead`, the
tab's session (its `resumeId`) and each under it (`session.parent_id`, recursive: its subagents), each assistant message's
`data` (`modelID`; `tokens` input, output, reasoning, cache read and write; `cost`, OpenCode's own, USD), by its time and
model, only the rows past the last counted (a message still answering, no `time.completed`, read again, for an hour from
its start: one older was cut off, its opencode killed, and counts as it is; the newest rowid
below it: another database, read whole); past 32 MB in the worker too (`agyWorker.ts`' `session`). Tested in
`test/meter.test.ts` (a fixture DB). ponytail: agy's field numbers are read off its files (Nov 2026), OpenCode's schema
off this Mac's (2026-11-27, OpenCode 1.19.5); their plan limits: Plan limits, above; and
a limit notice on their screen (core's `checkLimit` for every agent but claude: limits.ts' `lineRe` takes Grok's *You
hit your weekly limit*). The renderer (`settings.contextMeter`, `settings.costs`,
on unless false, Settings › Appearance; `contextMeter` `line` (unset, true), `ring` or `status`, App's `ctxLook`): TabBar.tsx' `TabList` `.tab-ctx` (its place: one rule in styles.css, a 2px line
along the tab's bottom edge; a split's fullest), or Usage.tsx' `Ring` there, and tooltip lines, the status bar's `.sb-ctx` (the focused tab's,
`.usage-bar`), `UsageButton`'s `today` (*Today*, *≈ API price*); `Usage.tsx` `level` (amber past 70, red past 90),
`ctxText`, `usageText`. Tested in `test/meter.test.ts`.

Where it went (`wsSpend { ws }`, API 197, cap `ws.spend`): `meters.ts` reads each claude and codex tab's transcript of the
workspace whole (its last 64 MB, `SPEND_READ`) and its subagents' and spawned threads' (`extraFiles`), kept by file and size
(`spendKept`, 200 files; a codex request's id its `token_count` payload, so a thread's copy of its parent's counts once), as `shared/spend.ts`
`spendEntries` (claude: your messages, each `tool_use` and its `tool_result` classed by tool: Read a file by its path from
the worktree, Bash a command by `cmdHead`, Grep/Glob/Web* searches, `mcp__<server>__…`, an answer's `usage` by its id, the
last one counting; codex: `user_message`, `function_call`/`_output` (a `sed -n`, `cat`, `head` of a file: that file's read;
`rg`/`find`: a search), `token_count`'s totals as the meter counts them) and one `spendBreakdown`: input total and output
total from the usage (`exact`), the system prompt and rules (the first request less its message, times the requests), the
conversation carried into each later turn (its first request less its message and the system's, times its requests), the
rest spread over what entered the context by size (4 characters a token); no usage: sizes alone. Files and commands past
the 8 biggest fold into one line each. Hints, fixed rules: a file read 3+ times over 15% of file reads, a command over 25%
of the input, the carried conversation over 50% past 5 turns. The user's, a phone's (REMOTE_OK, ANSWER), an agent's for
its own workspace only (`AGENT_OWN`, `agentNo`). `laki spend <ws> [--json]`; Info's *Where it went* and the Proof card's
*Where its tokens went* (`Spend.tsx` `SpendSection`, read on a click).
