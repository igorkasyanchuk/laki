# The API and MCP: how they work

### API

`src/daemon/main.ts` `api`: the same methods over HTTP and WebSocket. `API` (`src/shared/types.ts`) is in
every view as `api`; a running daemon below the renderer's (it outlives app updates), or from an older build (the view's `built`:
electron.vite.config.ts' `__BUILT__`, the build's time, in the daemon and the renderer alike; none from source), gets a yellow bar at the
top of the main area, *Restart Laki's daemon* (`StaleDaemon` in `ui.tsx`, `.stale-bar`; two clicks: `shutdown`, then main starts the new one).

Namespaces and caps (`src/shared/caps.ts`, the plan: `docs/rpc-namespaces.md`): `RPC_NAMES` maps a namespaced name to
the flat one the `api` table keeps (`note.list` → `noteList`; Notes only so far). `call()` resolves it first
(`oldName`), before `whoCalls`, `agentNo`, `remoteNo` and `hookWho`, so an alias passes every check its old name does.
`CAPS` (in every view as `caps`, and from `ping { caps: true }`: `{ pong, api, caps }`; a plain `ping` stays `'pong'`)
names the behaviors the renderer gates on and an `ns:<namespace>` per namespace; `hasCap(view, cap)` reads them, and for
a daemon without caps (before 150) the API number `CAP_SINCE` gives. The renderer's `api.call` sends a namespaced name
only when the last view's caps list its namespace, else the old one; the CLI's `rpc` (conn.ts) sends it, and on
`unknown method <it>` once more by the old name, by that one from then on. Achievements match by the old name.

- when everything is done (`settings.whenDone`: sleep, lock, shutdown; unset or off: nothing; Settings › Git &
  worktrees' *When everything is done*): core.ts `whenDone` at each view, beside `keepAwake`: armed by something going
  (an agent running or waiting, a live workflow run, a scheduled task or a workspace's late start due within the hour),
  then, once none is, the view's `whenDone` (`{ act, at }`: App's bar with Cancel, `settingsSet` `whenDone: 'off'`) for
  `WHEN_DONE_WAIT` (`LAKI_WHEN_DONE_MS`: tests'), anything going again cancels it; then `pmset sleepnow`,
  `pmset displaysleepnow` (the lock) or loginwindow's shut down, and the setting goes back to off. `settingsSet` refuses
  a value but those (one already saved is off); an agent can't change it (main.ts' `AGENT_KEYS`, with `doneCheck`,
  `recording`, `nextPrompt`, `keepAwake`, the tidies' `storageDays`, `archivedDays`, `imageDays`, `memoryCompact`,
  `updateCheck`, `updateDelay`, and the global ones of what `projectSet`'s `config` holds: `actions`, `templates`,
  `prPrompts`, `prBots`, `copyIgnored`, `copyUntracked`; nor a workspace's or project's `private`, `bgSet`, `sideNew`,
  `uiReset`, nor `wsSet`'s `important`, nor `updateIdle` while `updateCheck` is off or `updateDelay` set; remote access can: Cancel). Tested with a `pmset`
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
  first in one, or *Out of its group* (before the first), a submenu; groups are made only from the project's ⋯, at the top), each with a `color` of `TAB_COLORS` or none and a `template` (a prompt template's name: the new-workspace page opened from the group starts with it; none set: with no template, never the last one used) and a `sort` (`WS_SORTS`; unset: the project's), and the project's own `sort` (unset: manual; App's `sortedRows`: each group's workspaces in its sort, rows unchanged; last active: `laki.active`), and `rows`: their ids and its workspaces' in order; no seps, no rows), `reorder` (projects or workspaces by id; with a sep's id, its project's `rows` too), `wsSet` (color, `muted`, `important`: its agents' asks and finishes as cards on screen, `pinned`: the sidebar's Pinned, above the projects; `railPin`: the rail's quick access, the time
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
- `noticeShow` (as `alertShow`, and `to`: a tab, `@name` or `<workspace>[/<tab>]`, a workspace without an agent the
  workspace; not refused with no app connected): `laki notice`'s card in the app's windows (the `notice` event, with
  `to: { ws, tab?, name }`), kept until answered or closed and sent to each window as it connects; `alertAnswer` answers
  or closes it (`{ ok }`, `alertDone` to every window).
- `alertShow` (`text`, `title`, `choices` up to 6; `from` the caller's tab; refused with no app connected): `laki alert`'s
  card on screen (the `alert` event; App's card, a browser's dialog); with choices it resolves as `alertAnswer` (`id`,
  a `choice` of its own, or none: closed; refused from an agent) comes, else `timedOut` after `ALERT_WAIT`, then the
  `alertDone` event (daemon/alerts.ts). One without choices from a tab (`tells`) goes (`alertDone`) once a focused
  window's `view` shows that tab (`alertsSeen`, main.ts' `view`). Laki AI's (`aiRpc` adds `by: 'ai'` and its `chat`):
  refused unless ai.ts `aiMayAlert` (its chat's last message or *Your instructions* say alert, or `settings.ai.alerts`).
  An alert card's text is Markdown (ask.ts: `lineBreaks`, `markdownHtml`, `imgsAsLinks`; its links through main's
  window-open handler to the browser); any other card's (an ask's command beside its Allow) stays as written. `timer`'s `important` (Laki AI's `laki_timer`): a timer that ends as a card.
- the calendar's reminders (`settings.calendar`, on unless false; off: refused, none in the view; done ones in it for 92 days, `REMINDERS_DONE`): `reminderAdd` (`at`: ms or
  `when.ts` `parseAt`'s words, or words that repeat (`whenOf`: its next time and `every`), `every`, `text`, `ws`, `project`, `by`; `REMINDERS_MAX`), `reminderSet` (`text`, `at`: moved later, it
  rings again; `done`; `ws`; `important`, on add too: it rings as a card on screen, on its `reminder` event), `reminderRm`, `reminderTick` (every 30 s and as the first client connects; with no client
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
  `ask` `facts`, `.ask-facts`; each line's `tone` and `chip`, and text.ts `rmVerdict` over them), waited for 1.5 s at most;
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
  --branch <b>` in it (`b`: the head branch, a fork's `<owner>/<branch>`, likewise a PR of another remote's repo on its
  own branch: upstream's `feature` is `acme/feature` beside origin's; refused when a workspace or the repo has it
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
- worktree actions: `diff` (git's text but its last newline: a hunk to revert must match; `from`: the merge base, or
  `HEAD` when it has none with its base: deleted), `baseBranches` and `wsBase` (Changes' base: a worktree's local and
  origin's branches, `gone`; a new `Workspace.base`, local else `origin/<b>`, its own branch refused, agent-refused),
  `run`, `ship`; Changes'
  Revert (not a `git: false` project): `hunkUndo` (`path`, `hunk`: the @@ line and its body as `diff` gave it, refused
  as "changed since you looked" when the diff read again hasn't it, or the file runs into the 4 MB cut; `lines`:
  indexes into its body; a forward patch from the worktree to the base, `git apply --check` then `git apply`: a temp
  file here, stdin over `sshIn` on a host; a new file taken whole goes, a deleted one comes back whole only),
  `fileUndo` (`path`: its status from `--name-status -M`, untracked as A; its content first kept by `hash-object -w`;
  `git restore --source=<base> --worktree`, an A removed, an R's old path restored and the new removed), `hunkRedo`
  (`id`: `git apply -R`, or the blobs written back; `undos`, the last 20 per workspace in memory); nothing staged;
  the side panel's: `files`, `fileNew`, `imageRead` (a picture anywhere on this Mac by its full path, for a terminal link's hover card: an image's extension and bytes, 10 MB; not over remote access), `fileRead` (text up to 512 KB, an image as a data URL, or binary: size only; `lossy`: not UTF-8; `base`: an image as `git show <diffBase>:<path>`, for Changes' before), `fileWrite` (`text`, `was`: the text the edit started from, refused as "changed since you opened it" when the file isn't that any more, unless `force`; only a whole UTF-8 text file; written in place, its mode kept; on a host, `cat >` over `sshIn`), `prThreads` (each thread's `startLine`, `side`: LEFT when a range starts on the old file's, `hunk`: its first
  comment's `diffHunk`; comments hidden on GitHub left out, `prTalk`'s too), `prComment` (`path`,
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
  `archived`: true archives it (`archived` its time, no `next`, never due), false restores it (its `next` again if on),
  no checks, as off and a group;
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
  for mine, each with the workspace that has it by `prUrl` or branch; several GitHub remotes (pr.ts `ghRepos`: `git
  remote -v`, a repo once whatever its URL or case, origin's first): `--repo` each (`eachRepo`: one gh can't read left
  out unless all are), each PR with its `repo`, by branch only when its head is origin's; `issueList` the same, its
  GraphQL's `-f owner= -f name=` per repo), `aiQuestion` (`text`, `options` 2-6 with `looks` (each a UI kit `ui` over its `data`, `size`: Ai.tsx draws the option so, Widgets.tsx' `KitBody`; ai.ts `lookOf`, 16 KB), or `act`:
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
  microsoft/mai-transcribe-2), returns `{ text }` after `voice.fixes` (Word fixes: types.ts `voiceFix`, `heard → meant`
  lines, `VOICE_FIXES` at most, whole words in any case, the longest first; `fixed`: what changed, for the bar); a 429 or 5xx is tried again after `VOICE_AGAIN` (1 s, 2.5 s;
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

- `limits` (`{ agent?, from? }`, `laki limits`, MCP's `laki_limits`): `usage`'s own cache and back-off for each account, only the agents the managed policy allows; no `name` or `account` in Recording mode unless the caller's workspace isn't private.
- `tabDraft` (`{ tab, text? }`): a Reader box's unsent text, read or kept; on the tab (`draft`, never in the view: `drafted`; `tabSet` and `tabReopen` answer without it), moved to `closed` by `closeTab` and back by `tabReopen`; agents refused (`agentNo`, by the peer: `FROM`).
- `tabMode` (`{ tab, mode }`): a running claude's mode by its own ⇧⇥, read back from its footer after each press (`claudeMode`); one at a time per tab; agents refused, and so is their `input` or `send` of that key (`shiftTabNo`). The view's `mode` (kept by `sweepRunning`) and `bypassNo` (why not Bypass: the policy, its sandbox, how it started).
- `failDismiss` (`{ tab }`): clears a tab's `failed`.
- `archiveIdleTick`, `longTurnTick` (`{ now }`: tests', `archiveIdleTick`'s only under the rig's `LAKI_TEST_PARENT`): the loops below.
- `longStop` (`{ tab }`, agents refused): a long turn's notification's Stop, `{ stopped }`: its Esc while the turn it told of runs.

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
`answer`, `widgetFileSave`, `remoteStart`, `memoryCompact`, `prReview`, `prComment`: gh posts them as you; `prAct` approve, close and merge too (S3: a merge puts code in the base unread; `wsSet`'s `autoFix`, `autoReview`, `autoMerge`, `autoLand` are the user's as well); `shutdown`, `laki stop`; `checkAgain`, `checkStop`; each one in `FROM` or `CALLER`, checked as the daemon loads, and `notAgent` reads `from` or `caller`: a `from` the RPC says alone was an agent's to leave out), `projectTrust` with a `hash`, `projectSet` with `config` or
`memory` and `memoryAdd` `auto: false` (`--mine`) (N15: what runs in every new workspace, and the list every agent starts
with; an agent adds learned ones, `by` its found tab), `settingsSet` changing a `REMOTE_KEYS` setting and `input` into a tab that
asks something (`core.asking`); a sandboxed agent's (`boxNo`, `core.boxedCaller`: its tab's `sandboxed`) `tabNew`, `wsNew`
and `wsFan` start sandboxed (`sandbox: true`; `false` refused, an agent with none refused by `modelCheck`), and a shell tab
or workspace, `run`, a `send` or `input` into anything but an agent's tab, and a `!` line (claude's and codex's command
mode) are refused; and `send`/`screen`, `input` (as a send), `tabNew` with a `prompt` (as a send, `target` *a new agent tab*) and a WebSocket's `attach` (as a screen) into
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

More of `agentNo` (teardown S1–S11, `test/agent-gates.test.ts`): `input`'s `data` and `send`'s `text` must be strings for
every caller (`text()`: the gates read `String(x)`, node-pty writes an array as bytes); `wsRm`, `projectRm` and
`scheduleRm` from an agent ask in the app (`rmAsk`: a `toolAsk` with `cross: 'remove'`, once only; a worker the agent
started itself is its own to delete; no window: refused); `fileWrite`, `fileNew`, `fileUndo`, `hunkUndo`, `hunkRedo`
(`FILE_EDITS`) only in the agent's own workspace and never under `.git`; `tabClose` only its own workspace's tabs;
`tabSet` only its own tab; `shareStart` never; `openIn` with `app: 'default'` and a `file` never (a page it wrote would
run outside Laki). A sandboxed agent (`boxNo`) is refused the file edits and the removes outright. `settingsSet`'s
`AGENT_KEYS` also hold `voice`, `ai`, `readerTools`, `keys`, `cmdKeys`. Recording mode (S7): `state` from an agent,
Laki AI's (`aiRpc`) and the state a WebSocket of an agent's process or remote access's page gets go through types.ts'
`recorded` (no private workspace, its tabs, nor a private project); `whoCalls` looks the caller of `state` up only
while that mode hides something.
