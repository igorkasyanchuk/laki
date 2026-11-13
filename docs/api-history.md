# API history

Bump `API` when the renderer starts relying on a new method or daemon behavior (1: the tunnel methods; 2: a
project's `expose`, kept by `projectSet` and returned by `cloudflared`; 3: a project's `actions`, kept by `projectSet`;
4: `usage`; 5: remote access; 6: scheduled tasks, remote access forever; 7: `prComment`, `muted`; 8: a project's
`templates`, kept by `projectSet`; 9: browsers in `apps`, `openIn` `default`; 10: `send` `enter: false`; 11: a tab's `runAt`, `model` and `effort`, the
board's `todoAdd`/`todoRm`; 12: `doctor`, `wsArchive` `ifClean`, a workspace's `stat`; 13: a tab's `ask`, `answer`,
`unread`, `wsFan` and a workspace's `race`, `wsNew` `issue`, `browse`/`browseDone`; 14: settings' `prPrompts`, `prScan`,
`prTries`, which the PR switches' tooltips quote; 15: `webhookTest`, `wsNew` `pr`, the `archived` event; 16: `portKill`, a
workspace's `procs` and `portNames`, `fileRead` `base`; 17: `meme`; 18: `projectAdd` `host:path`, a project's and
workspace's `host`; 19: a workspace's `pinned`, kept by `wsSet`; 20: `fileWrite`, `fileRead` `lossy`; 21: a project's `seps` and `rows`, kept by `projectSet` and `reorder`; 22: `prRefresh`, `doctor`'s `cloudflared`; 23: `wsNew`/`wsFan` `place`; 24: `prAct`, an action's `any`; 25: `prDiff`, a sep's `color`, a PR's `mine`; 26: widgets: `widgetRender`/`widgetSet`/`widgetRun`/`widgetAction`/`widgetReload`, the view's `widgets`, `widgetKey`, `widgetHome`, `skillSet` `skill`; 27: a widget's `options` and `view`, `widgetSet` `view`, `openIn` `widget`; 28: `resources`, `tabSleep`/`tabWake`, a tab's `asleep`; 29: `logs`, settings' `devMode`, `widgetAction`'s `toast`/`modal`; 30: `progress`, a tab's
`progress`; 31: a sep's `template`, kept by `projectSet`; 32: `prAttach`, a project's `notes`, kept by `projectSet`; 33: `prAct` `merge`, a workspace's `autoLand`, a project's `pr` and
`mergeMethod` (`prAct`'s only; `projectSet` keeps it), `answer` `label`, `phoneTick`; 34: `quickNew`, a project's `kind`,
a workspace's `browser`, kept by `wsSet`; a shell tab's `running`; 35: `remoteStart` `open`, a remote's `open`; 36: `quickNew`'s Terminals, `terminal <n>` and a page's host as its name; 37: a project's `sort` and a sep's `sort`, kept by `projectSet`; 38: `prFiles`/`prViewed`, a PR's `approved` and `changes`, a tab's `runs`, a workspace's `artifacts`, `artifactList`, `fileRead` `storage`; 39: a workspace's `links`; 40: `keepPublished`, what agents publish kept as links; 41: `keepShells`, shells brought back after a restart; 42: Laki AI: `aiAsk`, `aiState`, `aiNew`, `aiStop`, `aiKey`, the `ai` event; 43: settings' `ai.preset`, the AI's links to workspaces; 44: `resources`' `others`, `resourceStop`; 45: a project's `memory`, kept by `projectSet`; 46: a PR's `approvedByMe`, `commentedByMe`; 47: `widgetFiles`, `widgetWrite`, a widget's `byAi`; 48: `widgetRm`, a widget's `place` and `net`, `widgetSet` `place`/`net`, `prList`, `aiQuestion`/`aiAnswer`, a chat message's `ask`, settings' `ai.skill` and `ai.hideCost`; 49: specs and brainstorms, `planList`/`planNew`/`planGet`/`planSave`/`planFile`/`planUpload`/`planWrite`/`planRm`, `GET /plan/…`, a project's `plans`; 50: a spec's or brainstorm's chat, `aiAsk`/`aiState`/`aiNew`/`aiStop`/`aiAnswer`
`chat`, `aiContinue`, `aiTick`, the `ai` event's `of` and `ended`, settings' `planTemplates`; 51: a workspace's `railPin`, kept by
`wsSet` (`RAIL_PINS` at most), `branches`' `main`, settings' `syncBase`; 52: a workspace's `related` and `from`, `wsSet` `unrelate`,
`wsNew` `link`/`from`, `prDetach`; 53: workflows, `flowList`/`flowSave`/`flowRm`/`flowStart`/`flowStop`/`flowAnswer`/`flowGet`/`flowForget`/`flowTick`, the view's `flows`, a workspace's `flow`, the `flow` event; 54: the view's `built`, an older build's daemon gets the bar; 55: `memoryAdd`/`memoryRm`, a memory's `auto` and `by`, `MEMORY_MAX` each kind; 56: an action's `slug`, kept by `projectSet`, a workflow's `use:` by it; 57: workflows' `case` block, a tab's `flow`; 58: `aiAsk` `context` (the floating chat's), `timer` (Laki AI's `laki_timer`, done by the app's window); 59: `voiceText`, settings' `voice`; 60: accounts (`accounts`,
`accountAdd`/`accountSet`/`accountRm`/`accountLogin`, `tabAccount`, a tab's `account`, a preset's `model`, `effort` and
`account`, settings' `accountUse`, `usage` per account), layouts (`layoutSet`, `layoutMove`, `tabFocus` and the `focus`
event, the view's `layouts`, `tabNew` `beside`/`edge`, settings' `splitNew`), `send`/`tabNew`/`wsNew` `vars`; 61: `remoteStart` `pin`, a remote's `pin` and `tries`,
`POST /pin`, the `remote` event); 62: workflows' `llm` and `webhook` blocks and `out:`, `shareStart`/`shareStop`, a tab's
`share`; 63: `flowTest`, `shareStart` `hours` and `shareTick`, a tab's `share` as `{url, until}`, schedules'
`workflow`/`source`, workflows' `decide` and `popup` blocks (the `flow` event's `show`), case branches with numbers and JS; 64:
a decide's `route:`, an llm's `json:`, `phone:` on popup and end, the view's `flowFiles`; 65: `uiReset`, `screen`/`browse` `by`, the `peek` event; 66: the AI page's earlier chats (`aiChats`, `aiOpen`, `aiChatRm`, `aiNew` keeping the one it ends), `aiImage`, `widgetSet` `ai` (Edit with Laki AI), `GET /artifact/…` (the artifacts viewer), settings' `imageDays`, `memory` (global), `artifactsIn`; 67: reminders (`reminderAdd`/`reminderSet`/`reminderRm`/`reminderTick`, the view's `reminders`, the `reminder` event), `cliState`/`cliInstall`/`cliRemove`, `memoryCompact`/`memoryCompactLog`/`memoryTick`, a project's `compacted`, a widget's `places` and `widgetSet` `place` as a list, the `desk` place; 68: a widget's `sample` (the view's, `widgetRender` `sample`, `GET /widget/…` `sample=1`), `widgetWrite` refusing a fetch without one, `flowTest` `own`, a workflow's `vars` and `{{vars.NAME}}` (settings' `flowVars`); 69: `todoAdd` `images`; 70: `run` `script` (`RUN_SCRIPTS`), a workspace's `scripts`, `device` (laki screen's), `remoteStart` `via: 'tailscale'`, a remote's `via`, `doctor`'s `idb`, a workspace's `archivedAt`; 71: a widget's `ui` (the UI kit), `widgetRender` `cells`; 72: `widgetDev`, `widgetRuns`, `widgetMock`, a widget's `dev`, `devError` and `mock`; 73: `widgetNew`, `widgetCheck`, one-file extensions, `widgetFiles`/`widgetWrite` `fixtures/<name>.json`; 74: a widget's `scope` and `inst`, `ws` on `widgetRender`/`widgetRun`/`widgetAction`/`widgetMock`/`widgetRuns`/`widgetCheck` and `GET /widget/…`, `view` `ws`; 75: `widgetPush`, the `widget-say` event, `widgetRuns`' `stream`, widget.json's `on` and `stream`; 76: tools (`widgetTools`, `widgetToolCall`, `widgetToolAnswer`, `widgetGrantRm`, the `toolAsk` and `toolDone` events, a widget's `tools`, an action's `{ run, tool }`); 77: the studio (`widgetSlug`, `widgetUndo`, `widgetRemix`, `widgetRun` `once`, a widget's `history`, the `widget:<id>` chat); 78: a widget's `source` and `ownFetch`, `widgetSet`
`source` (null: widget.json's), the inspector's Files from `widgetFiles`' texts; 79: `widgetFileSave`, `widgetRender`
`sample` as a fixture's name, a widget's `fixtures`; 80: an AI source (`widgetSet` `source` `ai`), settings' `widgetAgent`; 81: a widget's `agent`, `resourceStop` `agent:<id>`, `widgetRm` waits; 82: a widget's `hide` (`refresh`, `at`), `widgetSet` `hide`; 83: schedules' `widget`/`action`, workflows' `extension` block, a widget's `actions`; 84: a `secret` setting (the view's
`config` '' and its option's `set`), `widgetRm` to the trash, `widgetRestore`/`widgetTrash`, `from` on `widgetAction`/`widgetSet`/`widgetDev`/`widgetCheck` (an agent's: asked, refused, left off), a
setting's `required` and the view's `missing`, the `panel` and `row` places (a row's instances fetched for every live
workspace), a widget's `menus` (an action's `title`, `show`, `match`, `key`, `ask`, `confirm`, `insert`, `view`),
`widgetAction` `ctx` (`ws`, `tab`, `file`) and its `insert`; 85: `screen` `all`, a skill's `foreign`; 86: workflows' `agent-ask` wait (`turnWaits`, `flowAnswer` through `answer`), a
block's `retry`/`retryOn`, an agent block's `timeout` and stall check (a stuck's `tab`, `used`), a run's `queued` status (`QUEUE_MAX`), a Start's `inputs` (`flowStart` `inputs`, MCP's and the CLI's `--set`); 87: `hunkUndo`, `fileUndo`, `hunkRedo`, a tab's `perm` and `fast` (`wsNew`, `tabNew`); 88: notes
(`noteList`/`noteGet`/`noteNew`/`noteSave`/`noteRm`/`noteUpload`/`noteFile`), `aiPermission`, a chat ask's `perm`; 89: `widgetSet` `name` and `allow`, a widget's `allowed` and `oneFile`, `toolAsk` `perm` (`widgetPermission`); 90: a say's
`close` and its modal's `id`, `ui`, `data`, `size`, buttons' `style` and `close` (the `widget-say` event's `close`); 91: `prLabels`, `prLabel`, a PR's `labels`; 92:
`tunnelStart` `hours`, a tunnel's `until`, `tunnelTick`; 93: `widgetWhat` (an RPC, its `hash`), `widgetSet` `seen`, `widgetFiles`' and `toolAsk`'s `hash`; `widgetLogs`/`widgetLog`/`widgetLogClear`, the store's `log` (`widgetSet` `log`), a widget's `log`, `keepLog` and `logErr`, `settings.widgetLogs`, `openIn` `log`; events `ship.done`, `flow.ended`, `limit.hit`, `tab.new`, `port.open`, `gate.held`, `widgetEmit`, `widgetEvents`, a workflow's `on`; gates: an action's `gate`, `ship`/`prAct`/`wsArchive` `force` and `{ held }`, `ship` async, a widget's `gates`, PRFix's `held`; repo extensions: a widget's `project`, `repo` and `changed`, `widgetTools` `ws`, `widgetNew`'s `repo`.; 94: `wsPeek`, `studioChats`/`studioChatRm`, Laki AI's asks one per chat (`AI_AT_ONCE`), `aiQuestion`/`aiPermission`
`chat`, `aiState` without `elsewhere`; 95: workflows: an agent block's `perm` and `fast`, the head's `perm`; `flowStart` `ws`, `runs in: here`, a run's `pick`; `flowStart` `again` and `from`, a run's `of` and `first`; `flowRm` to the trash (its `trash`), `flowTrash`/`flowRestore`/`flowTrashTidy`, `flowHistory`/`flowRevert`; a run's `resumed` (after a restart: `RESUMED` to its agent's resumed chat); the head's `when done:` (`DONES`); 96: `prLog`, `prFix` `job`; 97: `projectTrust`, a project's `cfgWait`; 98: a key per page (`widgets.ts` `urlKey`, an HMAC of the master `widgetKey`, which no view, page or URL has any more: a workspace's `artKey` for `/artifact/`, `planGet`'s `key` for `/plan/`, a widget's `key` for `/widget/<id>`; each route takes its own only, `urlKeyOk`); 99: the view's `imgKey`, `GET /img`; 100: a workflow item's `changed`, `flowTrust` refused from an agent, a run's `by`, an agent's event's action handler asked first (`toolAsk`); 101: To-dos
(`todoListGet`/`todoListSave`), the side panel's Simulator (`sim`, `check`; settings' `simulator`); 102: a project's `simulator`, kept by `projectSet`; 103: `sim`
`devices`, `start`, `stop`; 104: the meters (a tab's `context` and `usage`, the view's `today`), `prThreads`' `startLine`, `side` and
`hunk`, `wsNew` `noSetup` and a workspace's `noSetup`, a project's `hasSetup` (the view's), `run` `script: 'setup'`, a project's `color`
(`TAB_COLORS`) and `icon` (an `ICONS` name or an emoji), kept by `projectSet`, `fileSave` (`name`, `data`: `<data>/files/<id>/<name>`,
`FILE_MAX`), `todoAdd` `images` taking its paths, the socket's `maxPayload` 34 MB, a preset's `perm` and `fast` (a tab's unset: its
profile's; `''`, `false`: none), Workflows and Specs & Brainstorms on unless `workflows`/`specs` is false (`flowsOn`, `specsOn`; the
view's `flows` by default), cloud workspaces (`settings.cloud`): `wsNew` `codespace` (a machine type), `csMachines`, a workspace's
`codespace`, `csState` and `csError`; 105: workflows' `only when:` (`Workflow.when`, `whenProblem`), a run's `evWs` and `hops`; a failed wait's `steps.<id>.log` (core's `ciLogs`); the `flow` event's `kind: 'refused'`, a workflow item's `skipped`; `flowPause`, a workflow item's `stats`, the `flow` event's `kind: 'paused'`; a workflow's `source` `builtin` (the templates); `flowEvent` (a try as if on an event), a workflow item's `events`; a workflow's asks pushed to the phone (core's `flowAsk`, `flowHooks.waitKey` (its block, question and choices) and `answer`); workflows' `budget:` (`Workflow.budget`, `budgetOf`), `flowStart` `budget`, a run's `budget`, `spent` and `clock`, the view's `flowHeard`; 106 (a review's fixes): an agent's `send` into a shell tab of another workspace refused, `toolAsk` `cross: 'emit'` (an agent's `widgetEmit` into another workspace), `shared/types.ts` `neverAsks` (one rule for an agent that never asks), `treeAgent` (a shell tab's agent by its process tree), `flowRm`/`flowRestore`/`flowRevert` `caller` (an agent's: marked its own), `widgetRestore`'s `note`, `widgetAction`'s `open` and `files` (`ActionFile`), a kit button's `do: new` `model`, `effort`, `perm` and `fast`, a `WidgetInst`'s `tone`, `WidgetCtx` `storage` (an artifact's file), laki:// `desk`, `uikit`, `uikit/icons` and `starters`. 107: `quickNew` `project`/`place` (a project's or group's + › Terminal, its ⋯ › *New terminal*), a workspace's `term` (quickNew's shells: App's `isTerm`, its menus' *Close terminal*, `closeTerm`: asked only while something runs; no branch, PR or workflow items; not on the Board), a widget's `fit` (`widgetSet` `fit`: a bar's
Auto; a JS page's preview says its content's width, `pageOf`'s `{ laki: 'size' }`, Widgets.tsx' `Cell` `--fit-w`), a widget's and an instance's `hidden`; 108: `queueSet` (`tab`, `queue`: the whole list, `was`: the one it started from,
refused as "changed since you opened it" otherwise), `queueNow` (Esc, then the first delivered), both and `queueClear` in `FROM`
(`crossAsk` as a send: panels.tsx' `QueueStrip`, Panes' `foot`); 109: an `Ask`'s `question` (`askOf`'s `questionAt`: the
line or two above the menu), a tab's `needAt` (waiting since, `Runtime.waitAt`; done since, `idleAt`), `seen` (the inverse of
`unread`): the sidebar's Needs you list (Needs.tsx, text.ts `needsSorted`, ⌘J's order too; stale finishes, below); 110: a project's `config.layout` (a saved
layout's name, `settings.layouts`, `SETTINGS_KEPT`), kept by `projectSet`: the tab bar's Layout menu (shared/layout.ts
`LAYOUT_PRESETS`, `fillRoles`, `toRoles`; App's `applyLayout`, `layoutNew`); 111: `prReview` (`ws`, `comments`: `path`, `line`,
`startLine`, `side`, `body`; each line checked against `gh pr diff` (`diffLines`) before anything goes, then one review,
event COMMENT at the PR's head commit, by gh's `comments[][…]` fields), `scanStats` for every live git workspace with
`settings.fullReview`: the full review (FullReview.tsx, the tab bar's first tab, ⌘1; Diff.tsx the pieces Changes shares);
112: `issueList` (`project`: `gh issue list --state open`, a minute per project), `files` `project` (its own folder's): the
prompt boxes' @ # / (PromptInput.tsx `useComplete`, `completeOf`; text.ts `triggerAt`, `completions`, `completeInto`); 113:
`wsNew` `startAt` (ms or `'limit'`, `startCheck`: an agent, not a codespace, limit for claude and codex): the workspace now,
its agent later, `ws.pending` (`Pending`: what `addTab` gets; the view's `pending`, `PendingView`), `pendingTick` (schedule.ts:
every 30 s and at start, `now` for tests; a limit's time `resetOf` its account's `usage` until it passes), `startPending`
(the `started` event, a late one's `late`), `wsSet` `pending` (null cancels, `at`, `prompt`) and `start`; the CLI's `--at`,
`--after-limit`, MCP's `start_at`; the new-workspace page's Start chip (panels.tsx `StartChip`); 114: tunnels that stay
up (`state.tunnels`, `tunnelsBack`, cloudflared started again, a tunnel's `down`, the `tunnel` event: a quick one's new
address) and permanent ones (`settings.tunnel`, `tunnelStart` `host`, a tunnel's `host`, `cloudflared`'s `named`,
`tunnelCheck`: Settings › Tunnels); 115: the full review's `blame` (`ws`, `path`, `side` old: at the diff's base, new:
the worktree's, `git blame --incremental`; shared/types.ts `Blame`), `fileWeb` (`ws`, `path`, `at` base or branch,
`line`: the file's page on origin's site, files.ts `webOf`: GitHub's, GitLab's `-/blob`, Bitbucket's `src`; a branch
not on origin refused), `prThreads` `all` (everyone's comments, not only `trusted`'s: for you to read, never sent to an
agent; an agent's call refused, main.ts' `agentNo`), `prTalk` (the PR's conversation comments and each sent review's summary, oldest first). 116: the Review tab on unless
`settings.fullReview` is false (shown once a workspace has a `stat`, with files or an open PR; useScope's `empty`, its first known: no changes of its own, it and Changes open on *PR #n*; its key the stat and the PR's head), its `stat` scanned for the workspaces a shown window has (files.ts `viewWs`, core's `setView` scans again). 117:
workspace facts (widget.json's `facts`, widgetSchema.ts `FACTS`: a per-workspace one's `{{facts.…}}`, `$LAKI_FACTS`, a script's
`facts`; `factsTick`, an instance's `fx`), `widgetSet` `hours` (an extension's own working hours, `always`; the view's `hours`) and
`hide.tip` (widget.json's `tip: false` too: the view's `tipOff`), an action's JSON `send` (App's `widgetDo` send), `aiQuestion`
`looks` (an `AiAsk`'s, laki_ask's), Calendar, Notes and To-dos on unless false. 118: `prFile` (`ws`, `path`: a text file at the
PR's head commit, `pull/<n>/head` fetched when this clone hasn't it: the expand arrows on *PR #n*), a sep's `preset` (a
group's default agent, kept by `projectSet`; MCP's state's `groupAgents`), `tabNew` `cwdOf` (a shell tab of the workspace:
the new shell starts in its folder, core's `shellCwd`), Laki AI's `profile` act (`laki_profiles`), `prTalk` refused from an agent; 119: a widget's `icons` (icons.ts `iconTurns`: settings' `iconPack`, `iconWidth`,
`iconSize` drawn by the daemon's kit too); 120: `scriptLogs` (development mode's setup and teardown runs, core.ts
`scriptLog`: `<data>/script-logs/<ws>.jsonl`, the newest `SCRIPT_LOGS` 30 workspaces', kept after a delete;
Settings › General › Development's *Setup & teardown*, panels.tsx `ScriptLogs`); 121: `prSay` (`ws`, `body`: `gh pr comment
<url> --body=` as you, the full review's GitHub tab's *Comment*; an agent's refused, `AGENT_NO`), `aiAsk` `queue` (while
the chat works: kept in `Thread.queue`, `QUEUE_MAX` 10, the view's and the `ai` event's `queue`; as the answer ends, any
end, all of it one ask; refused before it asks: said in the chat, not lost) and `aiUnqueue` (`i`), `aiAsk` in `FROM` (an
agent's in a `widget:` chat refused: `agentNo`), `widgetWrite` `chat` (aiRpc's: a write that changes what an extension
runs keeps it on, and its `net`, only from `widget:<its id>`, the page chat; any other Laki AI chat turns it off). 122:
`uncommitted` on `diff`, `hunkUndo`, `fileUndo`, `blame` and `fileRead` (files.ts `diffBase`: HEAD instead of the
merge base: Changes' and the Review tab's *Uncommitted*, Diff.tsx `useScope`/`atHead`/`ScopeSeg`, `laki diff
--uncommitted`, MCP's `laki_diff`), settings' `editors` (a project's own editor by its id: `openIn` `editor` takes it
first; App's `editorOf`, a folder's Open in pick sets it), `customCss` in `REMOTE_KEYS`. 123: `presetSave` (`laki
preset`: one profile by name, `add`, `rm`, `set`; an agent's asked in the app first, main.ts' `presetAsk`, a `toolAsk`
`cross: 'preset'`: its notification has no Allow, the profile is read in the app), `storageInfo` and `storageTidy` (settings' `storageDays`, `STORAGE_DAYS` 0, never (0.35: 90): a storage folder's
file not changed for so long goes, hourly, only `ws.storage` folders), links in one hidden `.laki-links.json` per storage
folder (artifacts.ts `LINKS`: a `.url` file moved into it, `fileUrls`; a `Link`'s `path` is `link:<url>`, not a file;
`artifactList` files only; `linkRm`), `show`/`showDone` (`laki show`: a tab's `card`, `Card`), `prDetach` of a branch's
own PR (a workspace's `prOff`: the scan leaves it out until `prAttach`). 124: `ghCard` (`url`: a GitHub PR's or
issue's link, any repo; `gh pr|issue view <url> --json`, kept a minute per link, a failure not kept; shared/types.ts
`GhCard`): a terminal link's hover card (LinkPeek.tsx). 125: a tab's `alias` (`tabSet` `alias`, `ALIAS`: one live tab each; `resolveTarget` `@name`; the CLI's `laki name`,
`agents`, `ask`, shared/tools.ts `askAgent`, MCP's `laki_name`, `laki_ask_agent`; dropped as its workspace archives), a
workspace's `icon` (`wsSet` `icon`: its rail pin's), the RPC's `now` honored only with `LAKI_TEST_PARENT` and a data folder under /tmp (main.ts `TEST_CLOCK`, `inTemp`; `LAKI_TEST_CLOCK=0`: a test's daemon that takes none), `tabSet` in `FROM` (an agent names its own tab only),
`linkRm` in `FROM` (an agent's refused), `editorCmd`/`editors` in `REMOTE_KEYS`, `STORAGE_DAYS` 0. 126: a workspace's `overlaps` (Collision radar, below). 127: a workspace's `check`, a project's `check` (kept by `projectSet`), `checkAgain`/`checkStop`, the `check` event and `turn`'s `checking` (Done check, below). 128: a tab's `plan` and `planAsk` (the agent's plan, live, below). 129: `chatRead` (`tab`, `v`: Reader view; an agent's refused, `AGENT_NO`). 130: a schedule's `base` (`scheduleSet`
keeps it for `ws` new only, refused for another, '' or null clears it; `runSchedule`: `wsNew` `base`, whose check (below) makes
one gone a failed run, `base <b> not found in <project>`; the CLI's `laki schedule add --base`, MCP's `base`; Schedules.tsx'
base chip, `SchedulesApi.branches`, a new task's the repo's `main`). 131: `projectSet` `name` '' (its folder's name again; Terminals' and Browsers' keep theirs), 80 characters at most. 132: `wsStat` (`ws`: files.ts' `statOf` now, a row's
hover card; none off git, archived, a codespace away), a `Stat`'s `made` and `gone` (`--summary`'s create and delete
lines, untracked files made too), a reminder's `every` (`reminderAdd`/`reminderSet` `every`, or `at` in words that
repeat: when.ts `REPEATS`, `whenOf`; `reminderTick` moves it to `nextRun` instead of `fired`; `every: null` once). 133: `fileRead` `media` (audio or video: its kind, `src` its data URL only with `media: true`, files.ts `MEDIA`, `MEDIA_MAX` 25 MB; ui.tsx `FileCard`: the file preview's and the Artifacts big view's player, else Open, Open in editor, Show in Finder), `openIn` `storage` (a storage folder's file), `agentCommands` (`agent`, `project`: skill.ts, the prompt boxes' / menu after the templates: claude's commands and skills (yours, the project's `.claude`, Laki's plugin's `/laki:…`), codex's prompts as `/prompts:<name>` and skills as `$<name>`; PromptInput's `Complete.commands`, `completeOf` `agent`), `send` `steer` (the app's own follow-ups: Send later, the Reader's box, a reply, a review comment; with the profile's `steer`, claude's and codex's, on unless false: typed into a running turn instead of queued, not while it asks, at a limit, waking or behind a queue; Laki's own sends never), a project's `config.workflows` (*Applicable for Workflows*, off unless true: App's `flowMenu`), kept by `projectSet`. 134: `overlapCheck` (`ws`: files.ts' one worktree against the project's others and its base now, the radar on or off: Workspace › *Check overlaps…*, App's `overlapsAt` dialog), settings' `radar` off unless true, an agent's `tabNew` `cmd` asked in the app (main.ts `cmdAsk`, `toolAsk` `cross: 'cmd'`, once only; `laki new --tab`; refused with a
character you wouldn't see, `HIDDEN` (other spaces than the plain one, Hangul fillers, the braille blank too), or padded past what the ask shows (`BLANK` lines, `rowsOf` over `CMD_ROWS`); the notification's *Run it* only for one line of App's `CMD_NOTIFY`, no run of spaces), opencode's model checked against `opencode models` (core's `modelKnown`). 135: a schedule's `noSetup` (`scheduleSet` keeps it
for `ws` new only, refused for another, false or null clears it; `runSchedule`: `wsNew` `noSetup`; the CLI's `laki schedule add
--no-setup`, MCP's `no_setup`; Schedules.tsx' where menu's *A new workspace each run, no setup*, shown for the project's
`hasSetup`, a row's *no setup* tag). 136: `worktreeList`/`worktreeImport` (a project's ⋯ › *Import worktrees…*), the view's
`whenDone` (settings.whenDone's countdown), a tab's `compacting` (claude's PreCompact), `suggest` (settings.nextPrompt),
`secret` (`secretAsk`/`secretGive`, `secretsTidy`: `laki secret`) and `changes` (`turnDiff`, `turnUndo`), `tabHandover`
(turns.ts, below). 137: `bgSet`/`bgGet` (Settings › Appearance › Background image: `<data>/background/<ms>.<ext>`, the one
before removed, `settings.background` `{ file, dim, blur }`; themes.ts `setBgImage`, `html.has-bg`), `prompts` (your
prompts, newest first, `<data>/prompts.json`, `PROMPTS_MAX`: core's `promptKeep` from main.ts' user sends, `wsNew`/`wsFan`
prompts and Laki AI asks, and claude's UserPromptSubmit after your keys (`keysAt`, 5 s); refused from an agent;
PromptInput.tsx `usePromptHistory`: ↑ in an empty box, Settings › Keys' `history`, the Reader's box too), a workspace's and a
project's `private` (`wsSet`, `projectSet`) with `settings.recording` (Recording mode: shared/types.ts `veiled`, the view
App draws; phone.ts skips their pushes; the status bar's `.sb-rec`, ⌘K, the menu bar's checkbox), a sep's `where`
(`SEP_WHERE`), `perm`, `model`, `effort`, `base` (Edit group: panels.tsx `groupNew` on the new-workspace page),
`chatList`/`chatImport` (daemon/chats.ts: Claude Code's and Codex's chats run in the project's folders outside Laki, a tab
each resuming it, `addTab` `resume`), `sideAsk`/`sideState`/`sideNew` (turns.ts' Side chat: claude's chat forked with
`--fork-session`, read-only tools; others' through Laki AI; SideChat.tsx, the right panel's `side` tab), `browse`
`expect` (`laki browser --expect-url`, MCP's `expect_url`: shared/types.ts `urlIs`, main's `browseOp` refuses another
page), settings' `updateDelay` (main's `updater` `auto(on, days)`, `heldUntil`, `skip`) and `modelEfforts`. 138: `prDraft`
(`ws`, `draft`: `gh pr ready [--undo] -- <url>`, the PR ⋯'s *Mark as draft* / *Ready for review*, `laki pr . --draft|--ready`,
MCP's `laki_pr_draft`; an agent's own workspace's PR only, main.ts' agentNo), `commits` (files.ts: `HEAD --not <base>`,
a folder's own `--not --remotes`, 200, each `pushed` unless `rev-list HEAD --not <base> --remotes` has it: the side
panel's Commits) and `commitDiff` (`sha`: `git show --diff-merges=first-parent`, in `diff`'s shape, pr.ts' `diffFiles`),
`usageDays` (meters.ts: share.ts `meterOf`'s `days` by day and model, kept per chat in `<data>/usage-days.json`,
`USAGE_KEEP` 90 days, the more of kept and read as today's: Usage.tsx' `UsagePage`, the ring popup's *By day and model*,
⌘K), a workspace's `fromTab` (`byCaller`'s `agentTab(caller)`, never an RPC's: shared/types.ts `creatorOf`, the tab bar's
*Created by*, Info, `laki ls`, MCP state's `createdBy`; the parent pane's `WorkerAsks`: its workers' waiting tabs,
answered there), a schedule's `group` (`scheduleSet`: a group or off take no checks) and a workflow's `group:` (its
head; Schedules.tsx' `Grouped`, both pages: fold, drag onto a head, ⌘/⇧-click, on/off, move), settings' `hideEmpty`
(the sidebar leaves out a project with no row: Show › *Empty projects*), the gate `tool` (widgetEvents.ts `toolGate`:
claude's PreToolUse through core's `preTool`, each tool gate in turn within `TOOL_GATE_MS` 3 s, `{ok: false, why}` a
deny, `{input}` an `updatedInput` with `permissionDecision: 'ask'`, never allow; an error or timeout goes; an input past
`TOOL_IN_MAX` (1 MB) shown with its long strings cut (`cutBig`), refused only, never changed; hook.ts waits
`TOOL_WAIT` only while `<data>/tool-gates` is there, `toolGateFlag` at scan, `widgetSet` and each call) and the
`tool.call` event (never a workflow's start). 139: `projectArchive` (`project`, `on`: false brings it back; refused from an agent, `AGENT_NO`;
refused while one of its agents works or asks), a project's `archived`, the view's `archivedProjects` (view leaves an archived
project, its workspaces and their tabs out; its agents sleep, the rest end; restores dormant; `wsNew` and scheduled runs refused;
no PR scans): the project's ⋯ › *Archive project…*, Settings › *Archived projects*; 140: `updateIdle` (`on`; `CALLER`: an agent's tab is `by`), the view's `updateIdle`
(core's `updateWhenIdle`, memory: it ends with the daemon it restarts): App downloads, installs once no agent but `by`
works or asks, then the new app's `shutdown` of the older daemon once none does; `laki update --when-idle [--off]`,
MCP's `laki_update_when_idle`; 141: `agentModels` (`agent` claude or codex, `preset`: its account; accounts.ts: claude's
stream-json initialize handshake, its hooks off and no session kept, or `codex app-server`'s model/list; a day per account,
a failure not kept): the new-workspace page's model menu and its efforts, the fixed `MODELS` the fallback; 142: the view's `managed` (`daemon/policy.ts`: a managed policy from LAKI_POLICY, MDM's
`/Library/Managed Preferences/dev.laki.app.plist` through plutil, `/Library/Application Support/Laki/policy.json` or
`/etc/laki/policy.json`, at start and every 5 minutes, `policyTick`: `settings` locked (`settingsSet` refuses another,
`policySettings`), `remote: false` (`remoteStart`), `bypass: false` and `agents` (core's `tabSpec`, `policyAgent`);
Settings' banner. ponytail: a tab made before a lock restarts as it was); 143: a project's `config.ticket` (kept by `projectSet`),
a workspace's `ticket` (`daemon/tickets.ts`: the script per live local workspace every `LAKI_TICKET_MS` 5 minutes and as
its branch moves, `ticketTick`; JSON or `KEY title`, `ticketFrom`): the row's `.ws-ticket` (rowMarks' `ticket`), the Board's
and the peek card's line. 144: an `Ask`'s `tool`, `what` and `rule` (claude's PermissionRequest hook, core's `Runtime.perm`:
shared/ask.ts `permOf`; cleared by its next hook that isn't a wait; `alwaysOf`, `permVerb`): the ask bar's tool tag and
command, its "don't ask again" button as *Yes, don't ask again for <rule>*, the notification's *<ws> · <tab> wants to
run* and *Always: <rule>*, the bubbles' card (`Float.perm`), the phone's body through share.ts `redact`; a
Notification after it while it waits isn't told again (`again`). 145: Claude's status line (`settings.statusBridge`, on unless false; Meters, below): a tab's
`context` and `usage`'s claude windows from it while fresh. 146: a tab's `hookless` (`hookTick`, every 30 s, `now`: tests'; Hooks not heard, below),
`hooksSeen` (each agent's last hook, live tabs, `deaf`: Settings › Agents & profiles' line), `doctor`'s `hooks` (`laki
hook ping`, 2 s) and `hookFiles`. 147: `flowFirst` (Run First: a queued run's `promoted`, `queueOrder`); `scheduleSet`'s `ws: 'same'` (`sameWs`) and `fresh`; an ask's `diff` (`permDiff`). 148: `wsSet`'s `important` (its asks and finishes as cards on screen); `reminderAdd`/`reminderSet`'s `important`, on the `reminder` event too; `alertShow`, `alertAnswer` (laki alert: the `alert` and `alertDone` events); `timer`'s `important`. 149: `scheduleSet`'s `archived` (a task's `archived` time); `baseBranches` and `wsBase` (Changes' base); `chatRead`'s `bg` (a claude chat's subagents and background shells), `apps` (its MCP Apps) and `from`; `bgOutput`; `mcpAppCall` and `GET /mcp-app/…`; the view's `modelNeeds` and `claudeHas`; `agentUpdate`. 150: the view's `caps` and `ping { caps: true }` (caps.ts: `hasCap`, the five old `api >=` gates by name); `note.*` (`note.list`, `note.get`, `note.new`, `note.save`, `note.rm`, `note.upload`, `note.file`) as aliases of `noteList`… (`RPC_NAMES`, resolved first in `call()`). 151: `imageRead` (a picture by its full path); `fileRead`'s `stat`; `chatRead`'s lines' `fail`, `stopped` and `new` (a /clear's New session line, `from` below 0); a tab's `retry` (claude's API error waited out); `alertShow`'s `by: 'ai'` refused unless asked, and a told alert's `alertDone` once its tab is looked at; an ask's `steps`. 152: `tabReopen` and a workspace's `closed` (the tabs you closed, ⇧⌘T); `tabClose` keeps the tab there. 153: `hookList`, `hookAdd`, `hookRm`, `hookSecret`, `hookExpose` (Settings › Webhooks); the events `issue.labeled` and `webhook`; a project's `issueMark` and `github`; `csMachines`' `cpus`, `memory`, `storage`, `perHour`; doctor's `ghCodespace`; `usage`'s gemini. 154: `flowHold` (Pause after this block and Resume: a run's `hold`, the `hold` wait). A setting the renderer adds
needs no bump: `settingsSet` keeps any field.
155: `tabDraft` (`{ tab, text? }`, a Reader box's unsent text, agents refused), a tab's `drafted` in the view.
156: `tabMode` (`{ tab, mode }`: a running claude's permission mode by its own ⇧⇥, agents refused), a tab's `mode` and `bypassNo` in the view.
157: a tab's `failed` in the view (a turn ended on an API error), `failDismiss`; `longStop`.
158: `gateRestart` and a tab's `ungated`; a tab's `modeUnknown`; the view's `diskFull`, `dnd` and `digest`; `projectClone`; `stopAll`, `queueResume` and a tab's `queueHeld`; `dndSet`; `wsUpdate` and `Stat`'s `behind`, `ahead`, `clean`; an agent's removes ask (`toolAsk` `cross: 'remove'`); `turnList`, `turnRewind`, `turnFork`, `turnDiff`'s `n` (kept turns); a chat line's `at`, `end`, `cost`; `shutdown`'s `keep`.
159: an archive's uncommitted work kept (`refs/laki/archived/<ws>`, back with `wsRestore`; the delete question's `kept`); `wsArchive` `ifClean` forced for an agent; `stateOwn` (the whole view: yours only); the view masked for anyone but your window (`masked`: remote's link and PIN, the webhook, env values), `settingsSet` takes the masks back (`unmasked`); `aiAsk` from an agent runs its tools as that agent, in a chat of its tab's own (`aiState`, `aiNew`, `aiStop` there; your chats' methods and `voiceText` refused); a merge pinned to the head scanned (`--match-head-commit`, glab's `--sha`).
160: `appPair` (the app's own token, S1), `widgetFull` (a repo extension's file in full before Turn on), the remote page's token in its first WebSocket message, `usage`'s `source` and `settings.usageNote` (plan limits from the agents' own numbers), `wsPeek`'s `files`, `doctor`'s agents' `signedIn`, `sampleNew` and `sampleRm` (Welcome's sample repo, a project's `sample`; cap `sample`).
161: `shipDraft` (the Ship sheet's start: the uncommitted files, the commits ahead, a title and body from the workspace's name, first prompt and last answer), `ship`'s `files`, `title`, `body`, `draft`, `base`, `reviewers` and `mode` (cap `ship.sheet`).
162: `sourceGuess` (the files a Preview pick likely comes from: `git grep` of its id, a class, its text).
163: a project's `allow` (auto-answer rules: `projectSet`, yours only) and a tab's `allowed` (asks a rule answered); the view's `managed.allowRules`.
164: remote access's `host` (My domain, D1), `down` and `was` (started again, D2), `locked`, `wrong` (D5) and `pairUntil`; `remotePair` (Add a device) and `remoteDeviceRm` (Revoke, Forget devices), the view's `remoteDevices` (D3).
165: a scheduled task's `notify`, `missed`, `catchUntil`, `onlyIf` (and `lastHead`, `catchup`: the daemon's); a run's `state`, `endedAt`, `said`, `pr`, `cost`, `tokens`, `diff`, `skipped`, `flow`; the `scheduled` event; extensions' `schedule.done` (T1, T2, T3).
166: a scheduled task's `trigger` (on an event: `ci.failed`, `pr.opened`, `pr.review`, `issue.opened`, `push`; and `marks`, `seen`: the daemon's), `keep`, `emptyGone`, `kept`, `fails`, `pausedWhy`, `pausedField`, `again`; a run's `event`, `held`, `retry`, `asked`; `eventTick`, `scheduleRelease` (T4, T5, T6).
167: the app's pages on `app://laki` (S9): the daemon takes that Origin instead of `file://`.
168: remote access's answer level (D7): `remoteDeviceSet`, a device's `level`, a remote page's view `remote.level`, `settings.remoteLevel`.
169: `diagnostics` (R6: `laki doctor --bundle`, Copy diagnostics) and the view's `trouble` (the daemon's uncaught errors).
170: `agentContext`, `agentContextOpen` (F6: what an agent sees, read only).
171: `flowStart`'s `simulate` (`from`, `answers`) and a run's `sim` (W7: a simulated run, nothing run; its `sim` wait).
172: `voiceModels` (Q11: OpenRouter's speech-to-text models and prices now) and Laki AI's `archive` act (Q12: `laki_archive`, `laki_stop`).
173: `uiDo` and its `ui` event (Q13: Laki AI's `laki_ui` moves the window), Laki AI's `delete` act and a `run` act's `ids`, `stopAll`'s `tab`.
174: `remoteCheck` and the view's `remote.check` (D8: remote access reached from outside, its result), `settings.remoteAwake`.
175: `screenLock` and `remoteLog` (D9: remote access while the Mac is locked, its activity log), `settings.remoteWhen`.
176: `termAnswer` and the `termAsk`, `termDone` events (S1: a terminal Laki hasn't seen is allowed once in the window before its calls are yours); `termHeld` over `/rpc` (the CLI's hint).
177: `reviewNotesGet`, `reviewNotesSet` (R10: the Review tab's unsent comments kept by the daemon per workspace).
178: `reviewMark`, `diff`'s `since` and a workspace's `reviewed` (R11: Changes' Since I reviewed).
179: `prAct`'s `revert` (a merged PR undone by a new one; the `pr.revert` cap), a workspace's `wtKey` and `GET /worktree/<wtKey>/<ws>/<path>` (View as page).
