# Workflows: how they work

### Workflows

On unless `settings.workflows` is false (`shared/types.ts` `flowsOn`, Settings › General › *Pages*; kept by `uiReset`,
`SETTINGS_KEPT`; off: no rail button, foot button or ⌘K item, the view has no `flows`, every `flow*` method refuses,
and no run starts on an event or a schedule). `shared/workflow.ts`: the model (`BLOCKS`, each kind's
`EXITS`, a choice's and an ask's options as exits, `max` per block), the file (`parse`/`toFile`: `# Name`, a
description, `runs in: · session: · at once: · turns: · perm: · on:` (`on`: an event, `eventOk`, that starts a run; `perm`: its agent blocks' permission mode), a `## id` per block, its first kind key, `> ` text, `- label →
id`, `next:`/`ok:`… lines, `max: 3 → id`, `at: x,y`), `check` (no start, an exit to no block, nothing leads to a block,
no way out, a loop with no `max` and no ask: Tarjan's; a case's `caseProblems`), `fill` (`{{name}}`), `choice` (*If / else*, `if:` the same
key: one test, two options) and `case` (`branchOf`/`branchLabel`: each option's label is its test, `[var] contains|matches|equals
"text"` or `else`, last and needed; `holds`, shared with the daemon's `valueOf`: the first that holds is the exit; the daemon's `held` runs `matches` under
`node:vm`'s 200 ms, as `js`), `MAX_BLOCKS` (100: past it `check` says so), `WORKFLOW_FORMAT` (MCP's words), `FlowRun` and `flowView` (the view's light copy). `daemon/workflow.ts`: the
sources (yours `<data>/workflows/<id>.md`, a project's `.laki/workflows/<id>.md`, not a host's; and `builtin`, the templates
in the repo's `workflows/` (packaged, `build.files`; `BUILTIN` found like widgets.ts'), listed last: `fileOf` refuses them,
so `flowSave`, `flowRm`, `flowHistory`/`flowRevert` do, `flowStart` and `scheduleSet` too, the listener's list leaves them out,
never `untrusted`; the index's *Start from a template* cards (only while you have none: New ▾ has them), the read-only editor's *Use this…*: `UseTemplate`, a
`flowSave` copy, its `on:` dropped when *Start on events* is off; App's `flowItems` leave them out), and the
engine. A run (`state.flows`: live ones and the last 100 ended) copies its workflow (`flow`: pinned), makes its
workspace (`wsNew` `preset: 'none'`: a worktree named by the task, its `flow` the run's id; or `local`, the folder's
own) unless it was given one: `flowStart` `ws` (id or name; `project` then the workspace's; `picked`: live, not a
Terminals', Browsers' or host's, no run going there, checked again in `begin` for a queued one) is the run's `pick`,
no `ws.flow` mark (that means made by the run), whatever `runs in:` says; `runs in: here` refuses to start without
one. The status bar's `.sb-flow` also finds a live run by `r.ws`. App's `flowItems` (`flowList` as `flowFiles`
moves): a workspace's ⋯ › *Run workflow ›* (`flowMenu`) and ⌘K's *Run workflow: <name>* open the page's StartRun
with it fixed (dialog `start`, `FlowStartAt`); StartRun's own *Workspace* for a `here` one without. `flowStart`
`again` (an ended run's id: `rerun`, its workflow's file as it is now, its project, task, inputs from its
`inputs.*` vars that the Start still has, dry or not, its workspace when the file says `runs in: here`; trigger
`again <id>`) and `from` (`{ run, block }`: its workspace, live and not archived, as `pick`; the block in the file
now; its `vars`, `visits`, `tabs` and `resume` copied; `first`, the block `begin` enters, a visit; the worktree's
`ws.flow` moves to it), both `of` the old run, said in the first log line: RunView's *Run again*, a block's right
click *Run from here*, the index row's ⋯, `laki flow again <run> [--from <block>]`. `flowRm` moves the file to
`<data>/workflow-trash/<id>-<ms>/workflow.md` with `trash.json` (id, source, project, name, path, at, byAgent: an agent's, or one an agent deleted); `flowTrash` lists
them newest first, `flowRestore` (`trash`) puts one back where it was (refused when a file of its id is there now; an agent's `caller`: marked its own; `flowRevert`'s and `flowRm`'s too, in `CALLER`),
`flowTrashTidy` (hourly and at start) drops them past 30 days or 20, and with each its history unless its file is back or another of it is still there. `flowSave` keeps the file it replaces first
(`keepOld`: `<data>/workflow-history/yours-<id>` or `project-<project>-<id>`, `<ms>.md`, not when it's the same text,
the last 20); `flowHistory` lists them (`at`, `size`, `first`) or gives one's `text` (`at`), `flowRevert` saves one
through `flowSave` (so the one it replaces is kept too; no `at`: refused). The CLI's `laki flow trash` and `restore`. `finish` then `tidy`: `when done:` (`DONES`; the head's `done`, unset: archive for
`runs in: worktree`, else keep) archives, on `done` only, the worktree the run made (`ws.flow === r.id`) through
`wsArchive` `ifClean` and `by: 'workflow'`; `{ dirty }`, `{ held }`, a failed or stopped run, `keep` and a workspace it
didn't make (`here`, `ws`, the project's folder) and a dry run's stay, a log line each; `tidying` keeps `picked` off one being archived (gates may take a while) (`<name> stays: …` / `archived`); the editor's
*When a run is done*. `laki flow check [file.md… | folder]` (`flowCheck`, before `ensureDaemon`:
no daemon): `parse` and `check` per file (a folder's `*.md`; none given: `./.laki/workflows`), `✓`/`✗ <name>  <file>`
and each problem, `--json` `{file, name, problems}[]`, exit 1 on any; a `use:` slug and a preset aren't known offline. Then `enter`/`work`/`leave` per block: each exit a `decide` (block, exit, why, ms, `you`), each step a `say` (the
log, 1000 entries, each a line and its detail after a newline: the prompt, the answer, the output). Agent blocks: `session` run (`tabs['run:<preset>']`), new, or another block's tab; `send` `whenIdle` to a
live one (`queued`: while the prompt is in the tab's queue, a turn's end is an earlier turn's), else `addTab` with the prompt (a shared session: the last run's live tab
in the same workspace, else `forkOf` its `resume`); a tab that just started waits until drawn (`Session.born`, quiet
500 ms; a run block waits for the setup script, `settingUp`); `use`: an agent action by its slug, else its name
(`findAction` over Settings' and the project's own `config.actions`, the app's as Run ▾ has them; not a shell's), its
text stamped and first, the block's after. An agent block's `perm` and `fast` (`permOf`: its own, else the head's `perm`,
none for an agent without modes; neither: its profile's, as any tab's) go to `addTab`, which keeps them on the tab for restarts and resumes; `flowStart` runs
core's `modelCheck` on each agent block with its preset's agent (`agentOf`) before any workspace; `check` (offline)
names an unknown mode, a mode or fast mode an agent id lacks, and blocks sharing a tab (`tabKey`: session run of one
agent, or `session: <block>`) in different modes; a shared session's last tab in another mode is forked, not reused.
`bypassIn` (its `profile`: a block's profile's `perm` counts, and its `args` when they set the mode; `shared/types.ts`
`neverAsks`, the one rule (core's `agentNoCmd` and the editor's hint too): bypass permissions by a mode or `bypassArgs`, or
codex's approvals off, `-a never`, `approval_policy=never`, its Accept edits; never env): `flowStart` `by: 'agent'` (MCP's; the CLI's `caller` from an agent's tab, main.ts: `agentCaller`) and an agent's event refuse a workflow with a bypassPermissions block; StartRun
names them in red, a dry run's log too. Core's `turnEnds` (in `turn()`'s idle/done/failed) ends the block 900 ms later (after core's
`deliver`): this turn's answer as `steps.<id>.answer`, a
`failed` turn the error exit, a usage limit `paused` (`wait.kind` limit) until `watchLimits`'s continue ends a turn. Run
blocks: `$SHELL -lc` in the workspace with its env (`PORT`, `LAKI_WORKSPACE`, `LAKI_FLOW`, `LAKI_STORAGE_FOLDER`,
`CI=1`), each `{{var}}` an env reference (`shared/workflow.ts` `shellFill`: bare `"$LAKI_V_n"`, in double quotes `$LAKI_V_n""`; in single quotes a `check` problem), its own process group (`kill`), `timeout` (10 min); output's last 80 lines. Actions:
`ship` (its tab's `onExit`), `prAct`, `runDev`, `wsArchive`; outward ones (`OUTWARD`) `ask` `confirm` first unless
`ask first: no`, a dry run says them. Extension blocks (`extension`: an id): `widgetUse` (reason `workflow`, the run's workspace for a scoped one), its data as
`steps.<id>.data` and each top field `steps.<id>.<field>` (`ANSWER_MAX` each), an off one or a failed fetch the error exit. Save blocks (`keep`): text, `from` (a file or folder of the workspace, realpath inside it, `cpSync`) or `link` (http(s): `linkAdd`, its `file` the
title), into `storageOf`. AI call blocks (`llm`): `ai.ts`' `aiComplete` (one OpenRouter `/chat/completions`, no tools, 5 minutes at most with
`aiDecide` (`waitOf`, `LAKI_AI_WAIT_MS`: tests'), memory's compaction too, `model` or
Settings' OpenRouter model, logged in `ai-calls.jsonl` as `<workflow> · <block>`), the answer `steps.<id>.answer`.
Webhook blocks (`hook`): `fill` the URL (https; http only to 127.0.0.1, localhost, [::1]) and `header:` lines with the run's variables and `env.NAME` (Settings'
and the project's env; the log masks them, shows the URL without its query), the body `from` a workspace file (realpath
inside it, 10 MB, `Blob`), the text (a JSON template's values escaped), else `task` and `steps.*` as JSON; `steps.<id>.status`,
`.output` (`readCapped`: `ANSWER_MAX` read, the rest let go), ok on 2xx (a 3xx is the answer: `redirect: 'manual'`); 429, 5xx and network errors again (`TRIES` 3, after `Retry-After` up to 30 s, else 2 s, 6 s).
All three via `request` (`calls`: an `AbortController` per run, `kill0` aborts, `timeout` 2 min) and `sent` (a `Send`'s
`Got`: exit, vars, outs). An llm with `out:` asks for `response_format` json; `system`, `temperature` go along.
Decision blocks (`decide`): `aiDecide` (POST `<api without /v1>/alpha/decisions`, `apiQuestions`: yes/no is the API's
`noul`); the state is the text through `jsonFill` (a bare `{{var}}` raw when it's JSON, else a JSON string; in quotes
escaped), parsed when it's JSON, empty: the block before's answer; each answer `steps.<id>.<q>` (`yes`/`no`, the label,
a score's level index with `.level`), `.p`/`.confidence`, `steps.<id>.answers` the JSON; under `sure` (`SURE` 0.7; 0.5…0.99)
`''` and `unsure` waits (`wait.kind` decide, one question at a time; `flowAnswer` sets it and `.you`). Case branches:
`NUM_TESTS` compare numbers (`''` never holds), `js` runs `node:vm` (200 ms; `vars`, `num`, `json`; not a sandbox: a
workflow runs commands anyway, and runs only once saved). Popup blocks (`popup`): title and body filled (body capped
`SHOWN_MAX`), kept in `r.shown` (last 20, not in `flowView`), `broadcast` `flow` `show` with `modal` (unless `modal: no`),
`popover` and `notify`: App's `ShownDialog` (`Shown.tsx`: HTML in a sandboxed frame without scripts, else Markdown), a
queue of 10, and `ShownPops` (cards at the bottom right, the newest 3, under dialogs; HTML as its words). An end's
`modal`/`popover` (off unless yes) go with its `end` broadcast (`finish`'s `shows`), its window kept in `r.shown` too. `flowTest` (Test it) runs an
llm, decide or webhook block alone with typed vars: exit, why, vars, missing, unsure, log. A decide's `route: <question>`
(`routesOf`: yes/no, a choice's labels, a score's level index) makes its exit that answer (`decideSend`, `routeOf` after
you settle one), each answer's block an option `- <answer> → id` (only those with one written), plus `error`. An llm's
`json` (unset: `!!out`) is `response_format`; an agent's `json` adds `jsonAsk` (unless `out:` asks already) and its
answer becomes `lastJson` of it (none: its words, said). An end's text is its notification (`fill`, else the block's name);
`phone` on an end or popup with `notify` also `flowPhone` (core: `pushTo` Settings' phone webhook, event `done`).
Your own variables: a workflow's `vars` (`var NAME: value` lines in its head, `VAR_NAME`) over `settings.flowVars`
(global, `SETTINGS_KEPT`), `varsFill` as `vars.NAME` under everything else in `varsOf` (and `flowTest`, its `own`).
`flowVars` lists a workflow's variables (yours, the run's, each block's) for the editor sidebar's Variables; `renameBlock` changes an id
and every exit, route, session, `of` and `{{steps.<id>.…}}` (the inspector's ID field). `flowSave`/`flowRm` bump
core's `flowFiles.at` (the view's `flowFiles`): the list refreshes, an open workflow not edited (or written by an agent)
takes the file. `workflowAsk` is *New workflow* ▾ › *With Laki AI…*'s ask (laki_ask questions first; the index keeps
the list's keys then, `awaiting`, and opens the first new one as it's written); the Editor sets api.ts'
`pageNow.workflow` (its id, source, unsaved changes, the file), App's `whereNow` sends it with the floating chat's asks.
`out:` (`OUT_KINDS`: agent, llm, run, webhook; names `OUT_NAME`, not `OUT_TAKEN`): an agent's or llm's prompt gets
`outAsk`, its result (answer, output, response) `outsOf` (the last ```json block, all of it, else the last `{…}` that
parses; non-strings as JSON, a missing name `''` and said) into `steps.<id>.<name>`. An agent's ask (core's `turnWaits`, beside `turnEnds`,
called with `turn()`'s waiting case 800 ms on, `askOf`'s options or none): a run waiting on that tab's turn (not one
queued behind yours) is `waiting` with `{ kind: 'agent-ask', tab, question, options, ns, used }`, the agent's choices
then Stop the run; no `flow` broadcast (core's notification is the one). `flowAnswer` (async) calls core's `answer`
with `n` and `label` (a changed menu throws, the wait stays), then the wait goes back to `agent`; `flowTick` does the same
when `tabStatus` isn't waiting (answered in the tab); `turnEnds` takes its turn's end (No); `flowResume` re-enters it
like a running one (`asks`). RunView's banner: the choices numbered, *Open its tab*, Stop the run.
Agent blocks' clock (`agentTick`, from `flowTick`):
`timeout` (`AGENT_TIMEOUT`, 60 min) counts the wait's `used` plus since `since` (an ask or a stalled stuck carries `used`,
so time it waits for you doesn't count; a limit pauses it), then `esc` (core's `input` Esc, the next step once
`tabStatus` isn't running, 5 s at most) and error; a prompt still queued behind your turn is taken off the queue
instead. `STALL` (10 min) of the same screen (`quiet`: its last 40 lines less the `esc to interrupt` line and digits, which
claude and codex tick every second; a change dated by `Session.lastOutput`) while `tabStatus` says running: `nudge` (core's `send`, not
`whenIdle`, `NUDGE`'s words, `nudged`), then a stuck with `STALLED` (Nudge again, Try again: Esc then the block anew,
Skip it: next with an empty answer, Stop the run last) and the wait's `tab`, whose turn's end `turnEnds` still takes.
Retries (`retry` 1-`RETRY_MAX`
on `RETRY_KINDS`, a run block's `retryOn` exit codes): `leave` hands a bad exit with tries left to `retry`, which keeps the count
in `r.tries` (cleared when the block is entered anew, not on a try), decides `retry`, says it, and waits
(`RETRY_WAIT`: 10 s, then 60 s) as `wait` `{ kind: 'retry', until }`: a timer and `flowTick` (tests move the clock) both
call `again` (`until` must match: an earlier timer never takes a later wait), `enter(r, b, true)` (no visit); `flowResume`
leaves the wait to `flowTick`. Past `at once` (`going`: live and not queued) `flowStart` saves the run `queued`
(no workspace, `QUEUE_MAX` 20 per workflow, then refused) and returns it; `begin` is the `wsNew` and the start;
`next` (from `finish`, `flowFirst` and `flowTick` in case) begins the first queued one of each workflow with a slot
(`queueOrder`: Run First's `promoted`, the newest first, cleared as it starts; then the oldest), its `at once` the
run's own copy. `flowResume` leaves queued ones (one cut short before its workspace: queued again);
`flowStop`/`flowForget` end one without a workspace; a schedule's run queues (core's skip while one is live stays).
Pause after this block (`flowHold` `on: true`, the run page's button, `laki flow pause <run>`): `r.hold` (saved at
once) and nothing else; the block it's on goes on. The next `enter` (a next block, a retry's `again`, Try again, Give it
more) or `leave` with nowhere to go `park`s instead: `sample` first, then `status: 'paused'`, `wait` `{ kind: 'hold' }`
with `cur` the block not entered yet (no visit, nothing of it ran; `again`: a retry's), or `{ kind: 'hold', end }`
before the run's end (finish's words: no `tidy` archive yet). `leave` drops any event while parked. Resume (`on:
false`) clears the wait and sets `clock` before it `enter`s (or `finish`es done), so a second Resume finds no hold; on
a run still pausing it only takes `hold` back. `flowResume` (a restart) leaves a parked run waiting and re-enters a
pausing one's cut-short block with `cut` (`enter`'s 4th argument): it finishes first, then parks. A parked run keeps
its slot. Stop stays Stop: its agents stay in their tabs.
A Start's `inputs` (`FlowInput`: `inputsOf` reads the line, `name[?][:kind][=default]`, `inputText` writes it; `kind` as
written, `INPUT_KINDS` checked by `check`, with duplicates, a choice's default and every `{{inputs.x}}` or `of`/label
`inputs.x` not declared): `flowStart` `inputs` through `inputVals` (defaults, a needed one, a number, a choice; a name it
doesn't have refused) into `r.vars['inputs.<name>']` (an optional one not given: ''), `flowVars` lists them; StartRun a
field each (a branch's from `branches`), the CLI's repeated `--set name=value` (`sets`), MCP's `laki_workflow_run`
`inputs`; `scheduleSet` refuses a workflow whose `inputVals()` throws (flowHooks.find gives its blocks), and a `runs in: here` one. Wait blocks: `flowTick` (5 s) reads `prOf` (core's scan; only one asked for after the block was entered, `looked`: the scan before may miss the push its block before made), a failure on a head
already reported waits for a new one; on a fail `waitTick` sets `output` and `head`, then (`logging`: one per run, no
tick meanwhile) core's `ciLogs` (prFix's loop: each failing check's `## name` and link, `failedLog` of the first 3 with
a job, `fenced` and said to be untrusted; the scan's check `url` is its detailsUrl, so no `gh pr checks`) into
`steps.<id>.log` ('' when none was read; a gh failure said in the run's log), and only then the fail way (a run that
moved on meanwhile drops it). An exit with no block: a bad one `stuck` (*Try again* resets the block's count
and the turns), a good one ends the run. `flowAnswer` (`n`, `text`: `{{answer}}`). `flowForget` deletes a run (a live one finishes stopped first) and its row's mark. `flowResume` at start: each live run
not waiting re-enters its block 8 s later; an agent block's is marked `resumed` (the block, its tab's chat id
as Laki started), and `agent()` sends that chat, when its tab is live with the same `resumeId`, `RESUMED` (*Laki
restarted while you were on this step. Finish it, then stop.*: no new turn) instead of its prompt, else (no chat then,
a new one since, its tab gone) the whole prompt; either way the mark goes and the log says which; with workflows off it waits for `flowTick`
to see them on, and only runs started before the daemon (`boot`) come back. Agents (MCP's `laki_workflow_write`, `by:
'agent'`) mark what they write in `state.flowsByAgent` until the user saves it; `flowStart` refuses those unless
`editor` (StartRun's, the app's; never with `by: 'agent'`): schedules, events, Run again, Run from here, the CLI and MCP
can't; `flowRm` keeps the mark in `trash.json` (`byAgent`), `flowRestore` puts it back. A project's (`.laki/workflows`,
the repo's) is trusted by its text's sha256 (`state.flowTrust`, by `agentKey`), set by `flowSave` (not `by: 'agent'`,
main.ts maps an agent's tab to it) and `flowTrust` (`text`: the file as the sheet showed it, else refused; never from `agentCaller`, main.ts' `CALLER`);
`item`'s `untrusted` otherwise (`changed`: trusted once, another text now): `flowStart` refuses it for `by: 'agent'`, an `event` and a `schedule ` trigger, `eventHooks.flows`
says so in `refused` (reading a project's file again at each event, not the 10 s list); the editor's banner (the `on:`
event it starts on, or that it changed; *Allow…*: `choose` with the file), the index's *not allowed* / *changed* tag,
StartRun's note. `refused(wf, on)` (only at the listener's `untrusted` refusal, with the event's name, and `flowStart`'s
for a `schedule ` trigger, `'schedule'`; never for other reasons, an agent's `flowStart` or a try) counts the skip in
`skipped` (in memory, by `agentKey`; `item` gives an untrusted one's as `WorkflowItem.skipped`, the index's *n events
skipped*; `flowStart` drops it from `r.flow`) and, once per file version (`told`: its `textHash`), broadcasts `flow`
`kind: 'refused'` (`name`, `wf` `{id, source, project}`, `on`, `changed`; no `id`: not a run) and bumps `flowFiles.at`;
`trust()` clears both. App's flow handler: a notification and a toast (*Look…*: the dialog's `wf`, `WorkflowsPage`'s
`at.wf`, its editor; never an Allow there).
Stats (`state.flowStats`, by `agentKey`; `FlowStats` in shared/workflow.ts): `finish`'s `tally` (not a dry run's; a
refusal isn't a run) counts `total`, keeps the last `STATS_RECENT` 50 (`at`, `status`, `ms`, `cost`: `r.cost`, what the
run's AI calls and decisions cost, `Got.cost` from `llmSend`/`decideSend` added up in `sent()`; agents' turns aren't
counted) and `fails` in a row (done starts over, stopped leaves it); the `PAUSE_AFTER`th (5) failed one in a row whose
trigger is `event ` or `schedule ` (not `try `) sets `paused` (`why`), broadcasts `flow` `kind: 'paused'` (`wf`, `text`;
App: a notification, a toast with *Turn on again*), `flowPhone`s and bumps `flowFiles.at`. Paused: the listener refuses
its events (after hops), `flowStart` an `event `/`schedule ` trigger (the schedule's failed run says so); Run, the CLI
and MCP start it. `flowPause` (`on`: clears `paused` and `fails`; refused from an agent, `CALLER`; the CLI's `laki flow
on`), `flowRm` drops its stats. `item`'s `stats` is `statsView` (runs, `ok` of the last 30 days' ended, `ms` a done
run's median, `cost` a run's average when any spent, `fails`, `paused`; dropped from `r.flow`): the index's chips
(`StatChips`, refreshed as a run ends) and red *Paused*, its ⋯ and the settings' *Turn on again*, `laki flow ls`, MCP's
`laki_workflows`.
`broadcast` `flow` (waiting, end with `notify` or a failure, show): App's notification and toast (api.ts reads a
message with `ev` as an event, though it has an `id`: the run's). A tab an agent block sends a
prompt gets `flow` (the run; `flowForget` clears it), and the status bar's `.sb-flow` shows the run of the focused tab, else of the
workspace (`ws.flow`), a click opens it; the run's `openTab` (WorkflowsApi) opens an agent block's tab (`r.tabs[block]`). The renderer's
`Workflows.tsx` (lazy, `workflows.css`; `Page` `esc={false}`: Esc doesn't close it): the index (Scheduled tasks' `.sched-*`:
hero, stats, the workflows' rows, the runs'), then one workflow or run, breadcrumbs back (styles.css' `.crumbs`), `Editor` (`Palette`, its left sidebar: *Blocks*, `picks`' groups as tiles (a click is `addBlock` after the picked block,
else the last; an HTML5 drag, `DRAG`, onto the canvas drops one there, snapped, `Canvas` `onDrop`), and *{{ }} Variables*
(`VarList`: *This workflow's* through `edit`, *Every workflow's* through `WorkflowsApi.setGlobals`; `VarsBody`: a click copies `{{name}}`, a drag carries it as text into a field); a block's *Add a block after it* is
`blockMenu` over the same `picks`; `Canvas`: `geo`'s bezier arrows, drag snaps to 10; `many` (⇧/⌘-click, a box on the
empty canvas, `band`) moved as one (`from`) and the Editor's `remove` (Delete or ⌫ while the canvas, `tabIndex` 0, has
the keyboard; the right click's *Delete these n*; never the start), ⌘A all, Esc none; `past` (50 files) is ⌘Z outside a
field; the head's ⋯ (and a row's on the index): *Make a copy*, *Delete* (no ask: a toast with Undo, `flowRestore`), the head's
*History…* (`HistoryDialog`: `flowHistory`'s list, a version's text, *Put this one back*: `flowRevert`);
`Inspector`, a case's branches as `.wf-branch` cards; File: the Markdown, `FileEdit`: highlight.ts' `highlightWorkflow`
(the keys of `parse`, its `WHOLE` ones' values left whole; plain past `HL_MAX`) in a pre under a clear-text textarea,
`.wf-code` holding both to one box), `StartRun`, `RunView` (the canvas' `Lit`: `taken` arrows, `live`
the one into the working block while it runs (`.wf-e.live` flowing, an `animateMotion` dot), the working block's gear badge
(`.wf-gear`) and shimmer; reduced motion: none; the ask, decisions, state; `RunLog`: the whole log, details folded, a filter; `flowGet` again as the view's
entry moves, every 3 s while the log shows). The CLI's `laki flow`. Tested in `test/workflow.test.ts` (the model, the file, the
blocks), `workflow-runs`, `workflow-agents` and `workflow-events`.
Events from outside (`inbound.ts`): `issue.labeled` (`issueTick`, every `LAKI_ISSUE_TICK_MS` or 60 s, slow while idle,
only while `listened` (an extension that's on, or `eventHooks.listens`: a workflow's `on:`) and the GraphQL quota isn't
low (pr.ts `quotaLow`): `gh api -i repos/{o}/{r}/issues/events?per_page=50` with `If-None-Match`, a 304 nothing; each
`labeled` event on an issue past the project's `issueMark` (state.json; the first read only sets it), oldest first)
and `webhook` (`hookServe`: its own server, below in remote.md). Both are emitted `from: { agent }` ('github',
'webhook'), so `fromEvent` refuses them what an agent's event is; neither has a workspace: `fromEvent` takes the
payload's `project` instead (`pj`; `here` refused), and so do a repo extension's (widgetEvents.ts) and the project's
own workflows. Tested in `test/inbound.test.ts`.

Events (`eventHooks.flows`, after the setting): `heard` keeps each project's newest payload of each event (`HEARD_MAX` 200, the oldest go), `lastEvents`
each workflow's last `FLOW_HEARD` (5) outcomes (`FlowHeard`: at, event, ws, run or why; the item's `events`, its settings'
*Last 5 events*), in memory (`note`, and `refused`'s skip, bump `flowFiles.heard`: the view's `flowHeard`, the page's). `fromEvent(wf, name, payload, ws, o)`, one path for a real
event and a try: the project's file read again, no workspace, problems, `byAgent` and `untrusted` (both unless `editor`;
a real one's untrusted calls `refused`), hops, paused (not a try's), an agent's event, its own run, `only when:`, one
live run per workspace, `here`'s live workspace; its start (`trigger` `event <name>` or `try <name>`, `evWs`, `hops`,
`agent`) or why. `flowEvent` (`event`, else its `on:`, `custom.*`'s `custom.test`; `payload` (an object, 64 KB), else
the last one heard (`use: 'sample'` skips it), else `sampleOf` (`SAMPLE_EVENTS`, core's fields on a made-up PR and
workspace), `ws`: the workspace you picked as its `ws` (`eventWs`)): `from`, `last`, `payload`, `vars`, each `when`
test's `ok`, `start`, `why`; `go` starts it (`dry`, `inputs`: its Start's, as Run's sheet and `--set` give them), `run` its id. main.ts makes an agent's CLI `by: 'agent'`, `editor`
false and its `agent`; `flowStart` takes `editor` with `event` past an untrusted one. StartRun's *As if on an event*
(`Tried`), the CLI's `--event [<name>] [--event-json <file|->]`.
Budget (`budget: 60 min, $5`, `budgetOf`/`budgetText`, either part; a bad one a parse problem, `check` a bad object):
`flowStart` `budget` (a string, '' none) over the file's (an agent's: the file's or tighter, never none or more), the
run's `budget` and `flow.budget` (its first: *Give it more* sets it to half of that more than it used, `flowAnswer`); `spent` is its working time, `sample` (at `enter`, each `flowTick` and `finish`) adding
what passed while `running` since `clock` (not waiting, paused or queued; ponytail: a few seconds off per change);
`spend` (none for a dry run) past `budget.ms` or `cost` past `budget.usd`: `budgetAsk`, a stuck with *Give it <half>
more* and *Stop the run*, at `enter` and in `flowTick` (only what stops and runs again: a command, a checks wait, a
retry's wait; an agent's turn, an AI call, a webhook or ship: the next block asks). `cost`:
`Got.cost` (llm, decide) through `sent`. RunView's `Meter`s (turns, time, cost), StartRun's and the settings' Budget;
the CLI's `--budget`, MCP's `budget`.
ponytail: no fetch/for-each/judge blocks or schedules yet, a run command not on an SSH host; a resume that fails after
`RESUMED` went (core drops the chat within `RESUME_FAIL`) is a closed tab, the block's error way.
