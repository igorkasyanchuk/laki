# RPC namespaces and capabilities: the plan (H6.1)

Written 2026-11-06 against API 149. H6.2 (capabilities) and H6.3 (`note.*` as the pilot) are done, in API 150.
What came out differently from the plan below:

- One file, `src/shared/caps.ts`, holds `RPC_NAMES` (with `oldName`), `CAP_SINCE`, `CAPS` and `hasCap`: no
  `rpcNames.ts` of its own.
- The renderer doesn't ask `hasCap('ns:note')` at each call site: its `api.call` keeps the last view's caps and sends a
  namespaced name only when they list its namespace, else the old name (no view yet: the old name too). Notes.tsx just
  calls `note.*`.
- No log line for an old name's use yet: every caller but Notes still uses old names, so it would say nothing useful.

## Today

- **269 flat methods** in `src/daemon/main.ts`' `api` table (`ping`, `wsNew`, `prThreads`, `widgetToolAnswer`…), called
  from about 635 places: the renderer (App.tsx 184, Dialogs.tsx 95, Workflows.tsx 26, menus.ts 24, Specs.tsx 17…), the
  CLI (101), MCP's and Laki AI's tools (`src/shared/tools.ts`, 83), main (12) and the daemon's own Laki AI (10).
- **One version number**, `API` in `src/shared/types.ts` (149), in every `state` view. It's checked in **6 places**, all
  in the renderer:
  1. `App.tsx:175` `staleDaemon`: the yellow *restart Laki's daemon* bar (a lower `api`, or the same with an older
     `built`); it also hides the skills note (`App.tsx:3308`).
  2. `App.tsx:662` `layoutsOn`: `api >= 60` (the daemon keeps panes, `view.layouts`).
  3. `App.tsx:1468` `peekWs`: `api >= 94` (`wsPeek`).
  4. `App.tsx:1536` archive: `api < 12` (an old daemon archives whatever is there).
  5. `App.tsx:2708` `termsOk`: `api >= 107` (a project's + opens a terminal in its folder).
  6. `Dialogs.tsx:163` hooks: `api >= 146` (`hooksSeen`).
  The CLI, MCP and main check nothing: they call and read the error.
- **Checks keyed by a method's name** in main.ts: 21 `method === '…'` tests (`agentNo`, `remoteNo`, `hookWho`…) and the
  sets `REMOTE_NO`, `FROM`, `CALLER`, `AGENT_NO`, plus `AGENT_KEYS` for settings. This is the part a rename can break:
  an alias that reaches a handler without passing the same checks would let an agent or remote access do what the old
  name refuses.

## Namespaces

25 namespaces, `<area>.<verb>`: every method below, its new name after the arrow. The verbs follow what's there (`new`,
`rm`, `set`, `get`, `list`); a few keep their old word where it's clearer (`files.hunkUndo`, `tab.chatRead`).

- **widget** (35; extensions): `widgetRender` → `widget.render`, `widgetSet` → `widget.set`, `widgetLogs` → `widget.logs`, `widgetLog` → `widget.log`, `widgetLogClear` → `widget.logClear`, `widgetWhat` → `widget.what`, `widgetRun` → `widget.run`, `widgetRm` → `widget.rm`, `widgetRestore` → `widget.restore`, `widgetTrash` → `widget.trash`, `widgetUndo` → `widget.undo`, `widgetRemix` → `widget.remix`, `widgetSlug` → `widget.slug`, `studioChats` → `widget.studioChats`, `studioChatRm` → `widget.studioChatRm`, `widgetAction` → `widget.action`, `widgetReload` → `widget.reload`, `widgetFiles` → `widget.files`, `widgetFileSave` → `widget.fileSave`, `widgetWrite` → `widget.write`, `widgetTick` → `widget.tick`, `factsTick` → `widget.factsTick`, `widgetTrashTidy` → `widget.trashTidy`, `widgetPush` → `widget.push`, `widgetEmit` → `widget.emit`, `widgetEvents` → `widget.events`, `widgetTools` → `widget.tools`, `widgetToolCall` → `widget.toolCall`, `widgetToolAnswer` → `widget.toolAnswer`, `widgetGrantRm` → `widget.grantRm`, `widgetRuns` → `widget.runs`, `widgetMock` → `widget.mock`, `widgetDev` → `widget.dev`, `widgetNew` → `widget.new`, `widgetCheck` → `widget.check`
- **sys** (33; the daemon itself, the app and this Mac: state, doctor, storage, resources, usage, devices, timers): `ping` → `sys.ping`, `state` → `sys.state`, `updateIdle` → `sys.updateIdle`, `doctor` → `sys.doctor`, `browse` → `sys.browse`, `timer` → `sys.timer`, `browseDone` → `sys.browseDone`, `storageInfo` → `sys.storageInfo`, `storageTidy` → `sys.storageTidy`, `openIn` → `sys.openIn`, `apps` → `sys.apps`, `imageSave` → `sys.imageSave`, `bgSet` → `sys.bgSet`, `bgGet` → `sys.bgGet`, `logs` → `sys.logs`, `phoneTick` → `sys.phoneTick`, `webhookTest` → `sys.webhookTest`, `uiReset` → `sys.uiReset`, `portKill` → `sys.portKill`, `meme` → `sys.meme`, `voiceText` → `sys.voiceText`, `usageDays` → `sys.usageDays`, `run` → `sys.run`, `device` → `sys.device`, `sim` → `sys.sim`, `cloudflared` → `sys.cloudflared`, `usage` → `sys.usage`, `resources` → `sys.resources`, `resourceStop` → `sys.resourceStop`, `sleepTick` → `sys.sleepTick`, `watchLimits` → `sys.watchLimits`, `archivedTidy` → `sys.archivedTidy`, `shutdown` → `sys.shutdown`
- **tab** (24; tabs and their agent: new, send, answer, the terminal's screen and keys, the chat): `agentModels` → `tab.agentModels`, `answer` → `tab.answer`, `tabNew` → `tab.new`, `tabFocus` → `tab.focus`, `tabClose` → `tab.close`, `tabSet` → `tab.set`, `progress` → `tab.progress`, `tabHandover` → `tab.handover`, `send` → `tab.send`, `agentCommands` → `tab.agentCommands`, `agentUpdate` → `tab.agentUpdate`, `tabAccount` → `tab.account`, `shareStart` → `tab.shareStart`, `shareStop` → `tab.shareStop`, `tabSleep` → `tab.sleep`, `tabWake` → `tab.wake`, `screen` → `tab.screen`, `input` → `tab.input`, `resize` → `tab.resize`, `view` → `tab.view`, `detach` → `tab.detach`, `chatRead` → `tab.chatRead`, `mcpAppCall` → `tab.mcpAppCall`, `bgOutput` → `tab.bgOutput`
- **pr** (20; pull requests and GitHub): `prFix` → `pr.fix`, `prLog` → `pr.log`, `prAttach` → `pr.attach`, `prDetach` → `pr.detach`, `prList` → `pr.list`, `prRefresh` → `pr.refresh`, `prComment` → `pr.comment`, `prReview` → `pr.review`, `prAct` → `pr.act`, `prDraft` → `pr.draft`, `prLabels` → `pr.labels`, `ghCard` → `pr.ghCard`, `prLabel` → `pr.label`, `prThreads` → `pr.threads`, `prTalk` → `pr.talk`, `prSay` → `pr.say`, `prDiff` → `pr.diff`, `prFile` → `pr.file`, `prFiles` → `pr.files`, `prViewed` → `pr.viewed`
- **ws** (19; workspaces: new, archive, fork, restore, ship, marks): `csMachines` → `ws.csMachines`, `wsNew` → `ws.new`, `quickNew` → `ws.quickNew`, `wsRm` → `ws.rm`, `wsPeek` → `ws.peek`, `overlapCheck` → `ws.overlapCheck`, `wsStat` → `ws.stat`, `wsArchive` → `ws.archive`, `wsFan` → `ws.fan`, `unread` → `ws.unread`, `seen` → `ws.seen`, `show` → `ws.show`, `showDone` → `ws.showDone`, `wsRestore` → `ws.restore`, `wsFork` → `ws.fork`, `wsSet` → `ws.set`, `reorder` → `ws.reorder`, `wsBase` → `ws.base`, `ship` → `ws.ship`
- **flow** (19; workflows): `flowList` → `flow.list`, `flowSave` → `flow.save`, `flowTrust` → `flow.trust`, `flowPause` → `flow.pause`, `flowRm` → `flow.rm`, `flowRestore` → `flow.restore`, `flowTrash` → `flow.trash`, `flowTrashTidy` → `flow.trashTidy`, `flowHistory` → `flow.history`, `flowRevert` → `flow.revert`, `flowStart` → `flow.start`, `flowEvent` → `flow.event`, `flowStop` → `flow.stop`, `flowFirst` → `flow.first`, `flowAnswer` → `flow.answer`, `flowTest` → `flow.test`, `flowGet` → `flow.get`, `flowForget` → `flow.forget`, `flowTick` → `flow.tick`
- **files** (16; a workspace's files, diff and commits): `fileSave` → `files.save`, `scriptLogs` → `files.scriptLogs`, `diff` → `files.diff`, `files` → `files.list`, `fileNew` → `files.new`, `fileRead` → `files.read`, `artifactList` → `files.artifacts`, `linkRm` → `files.linkRm`, `fileWrite` → `files.write`, `hunkUndo` → `files.hunkUndo`, `fileUndo` → `files.undo`, `hunkRedo` → `files.hunkRedo`, `commits` → `files.commits`, `commitDiff` → `files.commitDiff`, `blame` → `files.blame`, `fileWeb` → `files.web`
- **ai** (15; Laki AI): `aiAsk` → `ai.ask`, `aiUnqueue` → `ai.unqueue`, `aiState` → `ai.state`, `aiQuestion` → `ai.question`, `aiPermission` → `ai.permission`, `aiAnswer` → `ai.answer`, `aiNew` → `ai.new`, `aiChats` → `ai.chats`, `aiOpen` → `ai.open`, `aiChatRm` → `ai.chatRm`, `aiImage` → `ai.image`, `aiStop` → `ai.stop`, `aiContinue` → `ai.continue`, `aiTick` → `ai.tick`, `aiKey` → `ai.key`
- **project** (14; projects: add, set, trust, branches, worktrees, issues, chats outside Laki): `projectAdd` → `project.add`, `projectRm` → `project.rm`, `projectArchive` → `project.archive`, `projectSet` → `project.set`, `projectFile` → `project.file`, `projectTrust` → `project.trust`, `branches` → `project.branches`, `prompts` → `project.prompts`, `chatList` → `project.chatList`, `chatImport` → `project.chatImport`, `worktreeList` → `project.worktreeList`, `worktreeImport` → `project.worktreeImport`, `baseBranches` → `project.baseBranches`, `issueList` → `project.issues`
- **remote** (8; remote access, tunnels, shared tabs): `tunnelStart` → `remote.tunnelStart`, `tunnelStop` → `remote.tunnelStop`, `tunnelCheck` → `remote.tunnelCheck`, `remoteStart` → `remote.start`, `remoteStop` → `remote.stop`, `remoteTick` → `remote.tick`, `shareTick` → `remote.shareTick`, `tunnelTick` → `remote.tunnelTick`
- **plan** (8; Specs & Brainstorms): `planList` → `plan.list`, `planNew` → `plan.new`, `planGet` → `plan.get`, `planSave` → `plan.save`, `planFile` → `plan.file`, `planUpload` → `plan.upload`, `planWrite` → `plan.write`, `planRm` → `plan.rm`
- **settings** (7; settings, profiles, the CLI and skills): `cliState` → `settings.cliState`, `cliInstall` → `settings.cliInstall`, `cliRemove` → `settings.cliRemove`, `settingsSet` → `settings.set`, `presetSave` → `settings.presetSave`, `skills` → `settings.skills`, `skillSet` → `settings.skillSet`
- **note** (7; Notes): `noteList` → `note.list`, `noteGet` → `note.get`, `noteNew` → `note.new`, `noteSave` → `note.save`, `noteRm` → `note.rm`, `noteUpload` → `note.upload`, `noteFile` → `note.file`
- **memory** (5; a project's memory): `memoryAdd` → `memory.add`, `memoryRm` → `memory.rm`, `memoryCompact` → `memory.compact`, `memoryCompactLog` → `memory.compactLog`, `memoryTick` → `memory.tick`
- **account** (5; agents' accounts): `accounts` → `account.list`, `accountAdd` → `account.add`, `accountSet` → `account.set`, `accountRm` → `account.rm`, `accountLogin` → `account.login`
- **schedule** (5; scheduled tasks): `scheduleSet` → `schedule.set`, `scheduleRm` → `schedule.rm`, `scheduleRun` → `schedule.run`, `scheduleTick` → `schedule.tick`, `pendingTick` → `schedule.pendingTick`
- **todo** (4; To-dos): `todoAdd` → `todo.add`, `todoRm` → `todo.rm`, `todoListGet` → `todo.listGet`, `todoListSave` → `todo.listSave`
- **reminder** (4; reminders): `reminderAdd` → `reminder.add`, `reminderSet` → `reminder.set`, `reminderRm` → `reminder.rm`, `reminderTick` → `reminder.tick`
- **turn** (4; a turn's changes and the Done check): `turnDiff` → `turn.diff`, `turnUndo` → `turn.undo`, `checkAgain` → `turn.checkAgain`, `checkStop` → `turn.checkStop`
- **hook** (3; agents' hooks): `hookTick` → `hook.tick`, `hooksSeen` → `hook.seen`, `hook` → `hook.report`
- **side** (3; the side chat): `sideAsk` → `side.ask`, `sideState` → `side.state`, `sideNew` → `side.new`
- **alert** (3; cards on screen): `alertShow` → `alert.show`, `noticeShow` → `alert.notice`, `alertAnswer` → `alert.answer`
- **secret** (3; laki secret): `secretAsk` → `secret.ask`, `secretGive` → `secret.give`, `secretsTidy` → `secret.tidy`
- **queue** (3; a tab's queued messages): `queueClear` → `queue.clear`, `queueSet` → `queue.set`, `queueNow` → `queue.now`
- **layout** (2; panes): `layoutSet` → `layout.set`, `layoutMove` → `layout.move`

## Old names as aliases

- One table, `RPC_NAMES` in `src/shared/rpcNames.ts`: new name → old name (the table above), shared by the daemon,
  the CLI, MCP and the renderer.
- The daemon resolves a new name to the old one **first thing in `call()`**, before `whoCalls`, `agentNo`, `remoteNo`,
  `hookWho` and every set above. So the checks stay keyed by the one old name each, and no alias can skip one. The
  `api` table and every handler stay as they are. A test sends each guarded method by its new name and expects the same
  refusal (`notes`, `agents`, `api` tests).
- Old names keep working for at least three releases after the last caller moves (say to 0.50), then for good if it
  costs nothing: they're the table's keys. The daemon's log notes the first use of an old name per client kind once a
  day (a stale CLI or an old app is the usual one), never per call.
- `docs/dev/api.md` lists the new names with the old in brackets; `docs/api-history.md` gets the entry that adds caps.

## Capabilities

- `caps`: a list of strings, in `state` (the view, beside `api`) and from `ping` when asked: `ping { caps: true }`
  answers `{ pong: true, api, caps }`; a plain `ping` still answers `'pong'`, since every CLI before this checks
  `=== 'pong'` (`conn.ts` `alive`) and would start a second daemon otherwise.
- Names: a namespace's new names, `ns:note`, `ns:ws`…, as each is added; and one per behavior the renderer gates on
  today, named for what it does: `layouts` (60), `ws.peek` (94), `archive.dirty` (12), `project.terminal` (107),
  `hooks.seen` (146). New behaviors get a cap instead of an API bump when only some callers care.
- The renderer: `hasCap(view, 'ws.peek')` in `src/shared/caps.ts`: the view's `caps` when it has them; for an older
  daemon (no `caps`), `api >= CAP_SINCE[cap]` (the table of numbers above), so the five gates keep working against any
  daemon. `staleDaemon` stays on the API number and `built`: it means *this daemon is older than this app*, which caps
  don't say.
- The CLI and MCP (`conn.ts` `rpc`): call by the new name; on `unknown method <new>` from an older daemon, once more
  by the old name (`RPC_NAMES`), and remember that for the process. No extra round trip against a current daemon.

## An older daemon, a newer app (and the other way)

| who calls | daemon | what happens |
|---|---|---|
| new app | older (no caps) | `hasCap` falls back to the API number; new names: the renderer asks `hasCap('ns:note')` and uses the old name without it; the stale bar shows as today |
| new CLI / MCP | older | new name refused as unknown, retried by the old name (once per method, remembered) |
| old app, CLI or MCP | newer | old names are aliases: everything works; the view's extra `caps` is ignored |
| remote access page | same daemon | it's the daemon's own build: always matching |

## Recommendation

- **Do H6.2 now** (caps beside the API number, `hasCap`, the five gates moved to it): small (one list, one helper,
  five call sites), it stops a new feature from forcing an API bump that marks every older daemon stale, and it can't
  break anything (no caps means the API number, as today).
- **Do H6.3 as the pilot** (`note.*`: 7 methods, called from Notes.tsx, achievements.ts and notes.test.ts only, no
  agent or remote checks keyed on them): it proves the alias path, the resolve-first rule and the CLI's fallback on the
  smallest area.
- **Don't rename the other 262 in one go.** Move a namespace when its area is being changed anyway, one commit each,
  callers and docs together. The flat names stay the daemon's canonical keys: the checks never move. If after the
  pilot the names don't make the CLI, MCP or docs clearer to read, stop there: caps alone are most of the value.
