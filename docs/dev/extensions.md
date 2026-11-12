# Extensions (widgets): how they work

### Widgets

`daemon/widgets.ts` (the SDK for people: `docs/extensions.md`): every one off until turned on (`onOf`: the store's `on`). A widget is a folder with `widget.json` (`Manifest`: name, `place` (`WIDGET_PLACES`: side, top,
status, rail, foot; the store's wins, `placeOf`), a button's `icon` (`iconOf`: a name, the renderer's `isIconName`, or an
emoji), `label`, `badge`, `tip` (templates over its data, `faceOf`: plain text, kept as the entry's `face`, filled at scan,
after each fetch and settings change) and `click` (`clickOf`: one of its `actions`); the view's `button`: a
`BUTTON_PLACES` place or no preview in widget.html (`preview`), size in cells (down 1–4 or 0.5: half a cell, `down`; the grid's
rows are half cells, `span size*2`), `every` minutes,
`view` (the full view's dialog: `s`, `m`, `l`, `WidgetSize`; `.modal.widget-modal.<size>`), `config` (each setting a
default or a `Spec`: `type` text, number, bool, choice, list, `label`, `hint`, `choices`; `optionsOf` gives the view's
`options`), `fetch` (a shell command) or `script` (a JS file run by Laki's node through `RUN_JS`: its default export
gets `{ config, last }`; what it throws goes to stderr as its message alone, and `lastLine` skips node's own
trailer), `actions`) and `widget.html`. A setting is kept and given to a fetch as text (`textOf`: a bool `1` or empty,
a list deduped and joined by commas; `configOf`, the view's `config`), and to a page or a script typed (`typedOf`: a boolean, a
number or null, an array). `scanWidgets` reads `widgetRoots()` (`<data>/widgets`,
`settings.widgetDirs`; none come with Laki since 0.44: links and my-prs are `test/widgets/`, tests' fixtures through
helpers.ts' `fixtureWidgets`; the first of an id wins) at start,
on `widgetReload` and when `widgetDirs` changes; only that list stays in memory. Each widget's storage,
`<data>/widget-data/<id>.json` (`Store`): the user's on, size, every, view, config and the last fetch's `data`, `at`, `error`.
`exec` runs a fetch or an action (`/bin/sh -c`: the widget's own scripts in any language, `python3 fetch.py`; the
guide says so) in the widget's folder with `$WIDGET_<NAME>` per setting, `$LAKI_WIDGET_CONFIG`,
`$LAKI_WIDGET_FILE`, `$LAKI_CLI` (`launcher`: `<data>/widget-data/laki`) and an action's `$WIDGET_ARG` (never in the
command); stdout must be JSON; a failure keeps the last data. `widgetTick` (30 s, and as the first client connects)
fetches what's due, only while a client is on the socket (the app is open) and within its working hours (`hoursOf(w)`: the
store's `hours`, `widgetSet` `hours` through `hoursText`, `always` none; else `settings.widgetHours`; `when.ts`
`parseHours`/`inHours`: `9am-9pm weekdays`, `no weekends`, overnight spans; a line that doesn't read: always; streams too).
Workspace facts (widget.json's `facts`, widgetSchema.ts `FACTS`/`SAMPLE_FACTS`, scope workspace only: `factNames`): `readFacts` per
instance (the PR from the scan, `stats`, `diff`'s files and text, `git log <base>..HEAD`, its agent tabs' status and last
answer, `procs`; the git ones read again only as `stats` or HEAD move), kept in `facts` (by `keyOf`); `factsTick` (main.ts,
10 s, `LAKI_FACTS_MS`; the API's for tests) reads each on-screen instance's again and, on a change, sets its `fx` (the view's
`inst[ws].fx`, Widgets.tsx' render key) and fetches it (reason `facts`, why the names); `factsFor` before a run (its
`$LAKI_FACTS`, a script's `facts`, a prompt's `{{facts.…}}`); templates and ui `facts` (`widgetRender`, `faceOf`). An
action's JSON `send` comes back to the app (App's `widgetDo` send: asked, then `send` `whenIdle`); a JS page's
`laki.send`/`laki.ai` are `do`'s. widget.json's `tip: false` (and the store's `hide.tip`): no tooltip (Widgets.tsx' `tipOf`). An action that prints
JSON (all of stdout, or its last line) with `toast`/`modal`/`close` (`shared/widget.ts` `sayOf`: a modal's `title`,
`text`, `ui` (a kit element, 64 KB) over its own `data` (512 KB), `size`, `id`; up to 6 buttons, each `run` (an action,
`arg`), `open` (http(s), mailto, laki://) or nothing, `style` primary/danger/quiet, `close` false or `'done'`; `[]`: none;
`close`: true or an id) returns them; a JS page's `laki.toast`/`laki.modal`/`laki.close` post the same (`say`). The
renderer shows a busy toast while an action runs (the button `data-busy`, cleared by a `done` message to the frame), then
the result: App's `widgetApi.say` (a close first: true, the widget's dialog, else the one with that id; then a modal: one
with the shown one's widget and id keeps its key, `extModal.n`, drawn in place) and Widgets.tsx' `WidgetModal` (z 35:
over pages, under asks; its kit body in a shadow root with `uiBehave` through `act`, full; Esc in the capture phase,
before a full view under it; Enter: the primary button; a button closes it first, `close: false` runs it with the
button busy and stays, `'done'` closes it after a result that isn't false, only while that modal is still shown).

`shared/widget.ts`: the template language (`render`: `{{a.b}}` escaped, `#each`/`#if`/`#unless` with `else`, `date`,
`ago`, `spark`), `viewOf` (`<template preview>` / `<template full>`), `WIDGET_CSS` and `pageOf`. A widget whose HTML
has a `<script>` (`js`) is a page the daemon serves at `GET /widget/<id>?key=<its view's key>` with a CSP of `sandbox
allow-scripts; default-src 'none'` (no network, an opaque origin), the theme's variables from its `theme` query,
`window.laki` and a click bridge that posts `open`, `refresh`, `full` and `run` to the app; the store's `net` (Settings'
*Network access*, a JS widget's only, never widget.json's) adds `connect-src https:` and https images and fonts (`netOf`). The renderer's
`Widgets.tsx`: `WidgetStrip` (`place` top: the tab bar after its spacer; status: the status bar's end; each `Cell` as wide
as its cells across, `--widget-cell`, a line high), `WidgetButtons` (rail: `rail-kind` buttons after the pins; foot: `ib`
buttons after Timer, the rail's too without the rail; a `button` widget in a `Cell` is `CellButton`; a click: `click`'s
action, else the full view, else a fetch), `WidgetGrid` (the sidebar's, `place` side or none: plain values, no tiles, no head; a line between widgets: each `.widget` draws its left and top border over its neighbour's, the grid clips the outer ones), `WidgetDialog` (the full view), `WidgetBody`
(a template widget in a shadow root after `clean`, the sanitizer: no scripts, frames, forms, `on…` attributes or
non-http links; a JS one in an iframe `sandbox="allow-scripts"`, whose messages count only from its own window);
Settings' `WidgetsSection` (the app's word is *Extensions*; the files, ids, CLI and skill keep *widget*; `WidgetList`:
`Group`s, *Yours* (its head's `act`: *New extension*, `WidgetsApi.page('')`) and each repo's, of Scheduled tasks'
`.sched-row`s, each with its switch, a click `page(id)`; past 3 a search (`hay`: name, id, places and their words,
project), the `failing` first in each group (a `devError`, or one that's on with an `error`, a `missing` setting or a
`logErr` in the hour) with a red `.widget-dot` on its icon, `failWhy` its tip; `WidgetCard`: a head (its switch, name, buttons), then `WcSec`s of `WcRow`s (a title and what it does, its control):
Where it shows (places as pills, size, full view, the hide switches), Updates (every, network, the last fetch and Fetch
now), Its settings (`WidgetOptionField` per
setting, a list's `ChipsInput`), Tools for agents; its folder button is App's Open in menu with `widget`). `Extension.tsx`
`ExtensionPage` (App's dialog `{ extension: id ('' a new one), back, start, key }`, `extOf`, keyed by `extKey`; the one
place to make, change and set one up: Settings' rows and New ▾, ⌘K's *New extension…*, links.ts' `extension` and
`studio` (`laki://settings/widgets/new`, `/<id>/studio`), Remix, the Desk's *Build with AI* (`start`: its first ask);
closing, its crumb or Esc with nothing typed: `back`, so Settings › Extensions comes back; a widget's full view,
`{ widget, back }`, and its logs do the same; `WidgetApi.settings(id)`: the page): `Preview` (its first place: a
sidebar cell at its size, a bar, a button or a Desk tile; its full view under it; *Live* / *Sample*, the page's `pick`:
sample by default while it's off or not fetched yet, again at each `rev`), `WidgetCard`, and Laki AI's chat beside
them (`Chat`, `widget:<id>`; '' a new one's until its first ask: `widgetSlug` names it, `onNamed`, Dialogs.tsx' `nameExt`
moves the dialog and its history place to it, `extKey` kept: not drawn again; one of yours: `widgetSet` `ai` first;
its head *New chat* is `aiNew` on that chat; empty: `STARTERS`' chips, `EXAMPLES`, `StudioSessions`' *Where you left
off*; one not yours: *Remix it*; a turn's *Undo to here*; its box focused as it opens, not on a touch screen); the head: *off*, a failed check's chip (`cfg.check`, no run, each `rev`),
*Undo* (yours: `widgetUndo`), *Try it live* and *Turn on* (off: `TrySheet`, below; a repo's or an agent-linked one's
*Turn on* is `extCfg.set`'s `repoSheet`, every file it runs, and no *Try it live*: `widgetRun` `once` refuses it), *Manage ▾* (`manage`: Rename… through `askText` and `widgetSet` `name`, not a repo's or a one-file one's; Edit settings, Edit files, Open folder (`WidgetsApi.folder` at the button's rect), Logs, then `extMenuItems` less its first, Turn on/off: Show in, Size, Remix, Delete). Overview puts *Settings* (`WidgetCard`, its own Remix, folder, log and a red Delete: `.ib.danger`) first, then Preview and Everywhere. A new one's page has `Start` (the
steps, the UI kit's card (SettingsExtensions.tsx' `KitHero`, Settings › Extensions' too: `WidgetsApi.kit`, its crumb back the page's name), and, with Laki AI off (no chat beside it), *Copy the prompt*: `widgetPrompt`, which the laki-widget skill's SKILL.md shares as `widgetFormat`); with
its name and no files yet, *Not saved yet* (a failed first ask, a starter's or Remix's before the next view). App hides the floating chat there. The test fixtures `test/widgets/links` (a JS page, a `links` chip list) and
`test/widgets/my-prs` (shell, gh `--jq`, its `ui` and `sample`) are tested on the fake gh's `pr list` (`$FAKE_GH/prlist.json`) in
`test/widget.test.ts`. The browser pane doesn't paint cross-origin frames: check a JS
widget's page in Chrome (headless `--screenshot`).

The UI kit (`shared/widgetUi.ts`; the SDK's words: `docs/extensions.md` › The UI kit): widget.json's `ui`, one element
(both views; the full one without row limits) or `{ preview, full }`; a view widget.html has wins (`widgetRender`'s
`own`), `ui` fills the other (`uiTree`; scan's `full`/`preview` count it). `UI` (each type's group of
`UI_GROUPS`, by kind: Layout, Navigation, Text, Code, Numbers, Charts, Status, Lists, Media, People, Developer, Buttons,
Inputs, the table in that order: the gallery's sections and chips; blurb, `rows`: it
repeats rows itself with `each`, and its props: the guide's catalog, `laki widget kit`, the checker), `COMMON` (`if`,
`unless`, `each`, `tip`, `tone`: `hidden`, on items and accessories too), `uiHtml(spec, ctx, { full, cells })` (only
`esc`'d values in fixed markup; strings are `fill`'s templates over `{ …data, data, config, at, error, full }`, a path
prop is `valueAt`'s; an error with no data: the error block; one element's throw: a `.k-chip-err`), `uiCheck` (unknown
types and props with `near`'s guess, wrong kinds, a run not in `actions`, a row field not in the data), `UI_SAMPLES` (one
per type: the gallery's, the guide's catalog, the tests'). Rows a preview fits: `cells` down × 64 px (`data-line` at ½:
the first row, a bar's line). `UI_CSS` (`shared/widget.ts`, in `WIDGET_CSS`, so a JS page has it): `.k` is a container
(`kit`), container queries per element, `[data-line]` for the bars, tones last (`.k .t-*`). Icons are `shared/icons.ts`
(`ICONS`, `iconSvg`; ui.tsx's `Icon` reads it). `uiBehave(root, send)` (`shared/widget.ts`, no outer names: `pageOf`
embeds `String(uiBehave)`): +N more, `data-run` (`data-arg`, `data-confirm`, `data-submit`: the nearest `[data-form]`'s
fields as JSON), `data-copy`, links, `data-open`, `data-laki`, `data-filter`, else a click opens the full view;
`Widgets.tsx` `act` asks a confirm (`ask`) and copies through the app. A JS page's `laki.ui(spec, data)` /
`laki.mount(el, …)` post `{ laki: 'ui', req }`, answered with `uiHtml` before the click checks (it only computes HTML).
`UiKit.tsx` `UiKitPage` (App's dialog `{ uikit, icons, back }`, Settings › Extensions › *UI kit* and *Icons*): a card per sample at 1×1,
3×1, 3×2 or full and as a status bar item, its JSON to copy; *Typography* (`TypeView`, `TYPE`: headings, sizes, weights,
styles, inline, blocks, each drawn by the kit beside its JSON, a click copies it) and *Colors* (`ColorView`: the tones,
the palette and `THEME_VARS` as `Swatch`es, each as this theme paints it, read off a canvas pixel; a click copies how an
extension names it; *In use*); *Icons* (`IconGallery`): every `ICONS` name in `GROUPS` (Laki's own, the app's, then
`icons.ts` `ICON_GROUPS`: 252 generic ones for extensions, drawn on the same 16 grid), a filter (`wordsOf`: ciFail is
"ci fail", a group's name too), a click picks it and copies its name, the picked one at four sizes, in each tone, and
as JSON (the icon element, a button, the rail); the CLI's `laki widget kit icons`. Tested in `test/widget-ui.test.ts`.

Dev mode (`laki widget dev`, the CLI's `dev`: `widgetDev` `folder`, then `widgetRuns` every 500 ms, a line per new run
and each `devError` change; `off`, `list`): `settings.widgetDev` (`SETTINGS_KEPT`; `settingsSet` rescans as it changes,
like `widgetDirs`), `devRoots` first in `widgetRoots` (a dev copy shadows the installed one of its id, sharing its
store), linking turns its widgets on and fetches them (`dev`, why `linked`). An agent's link (N10, `agentCaller`; a folder with an id you have installed outside dev refused, *it would cover your …*, its other ids' stores written off before the scan):
`settings.widgetDevAgent` (`SETTINGS_KEPT`; only `widgetDev` writes it: `settingsSet` `own`), its widgets off and an
`Entry`'s `agentDev` (the nearest linked folder's: yours inside an agent's stays yours), trusted as a repo's (`guarded`: on
only with `seen`, `trusted`/`files` over every file of its folder (no git listing, whose .gitignore it writes; hidden ones
and node_modules too), `untrust` as they change, `repoBad`; one that shadows an installed one that's on goes off at its scan, never inheriting it; the view's `agentDev`,
App's `repoSheet`); your own link of it makes it yours again. `watchDev` (from `scanWidgets`):
`fs.watch` recursive per root (a one-file root: its folder, for its name: a save by rename ends a file's watch), 300 ms debounce, `devChanged`: `scanWidgets` again, then each of its widgets fetched
(reason `dev`, why: the files). `scanWidgets` keeps the entry it had (`before`) when a dev widget's `manifestOf` or
`templatesError` (shared/widget.ts `templateError`, widget.html's and every `ui` string) fails, with `devError` (the
view's; Settings' *dev* tag, the tooltip, the page's banner). `widgetsStop` at shutdown. `devKeep` (core.ts): `devLog`
keys kept without dev mode (a dev widget's). Runs: `ran` per fetch and action (`RUNS`, 20, newest first, in memory:
`WidgetRun`, reason `RUN_REASONS` or `action:<name>`, `why`, stderr's `tail`), `exec` keeps stderr and the exit code (stderr, the error, a failure's stdout through `masker` as it ends);
`$LAKI_REFRESH_REASON` (`envOf`: one env for exec and `widgetRuns`' `env`, a secret and `SECRET` setting names masked, in
`LAKI_WIDGET_CONFIG` too); `widgetTick`'s reason `schedule`, the first client's `open`. `widgetMock` (`data`, a
`fixture`: `fixturesOf`, `fixtures/*.json`, or `off`: fetched now): the store's `mock` (the view's; Widgets.tsx'
`.widget-mock` chip), `fetchable` false meanwhile and `widgetRun` skips all but `manual`, whose data clears it; a
stream stops first (`stopStream`: its last line saved, not over the mock); `widgetSet` turning one on (off to on) drops it.
`widgetRm` refuses a dev widget (your code). The inspector is `Extension.tsx`' tabs (`ExtTab`; App's dialog
`{ extension, tab }`): `InspectHead` (Run now, Reload, the watching dot, `devError`'s banner), the head's *Edit* (Overview,
the Settings card scrolled to and lit, `spot`), Overview (`Preview`: *Sample* with a picker of widget.json's `sample` and
the view's `fixtures`, `widgetRender` `sample: <name>`, nothing kept; its *Everywhere* card: a sidebar cell of any size,
both bars, the button), `Inspector` (Data: Source (`SourceField`), its data (`widgetRuns` `data`, Apply `widgetMock`,
Live), `Examples` (the sample and each fixture: *Show it with this*, *Use as its data*: a static source); Runs, every 2 s
while shown; Env; Files: `widgetFiles`' texts, editable (`FileView`: ⌘S, Esc, *Save anyway*; the draft is
`ExtensionPage`'s, asked before it's lost) through `widgetFileSave` (`path` one of `widgetFiles`' names, `was`: refused
as "changed since you opened it" unless `force`; JSON parsed first; never a repo's (Remix it), a link or a file over
64 KB; the history's `snapshot` first, so Undo has it; then `scanWidgets` and a `reload` fetch), Open folder). A
widget's right click (`WidgetApi.menu` over `items`, App's: Fetch now, Inspect, Logs, Edit, then SettingsExtensions.tsx' `extMenuItems`: Turn on/off, *Show in ›* its places ticked, *Size ›* for a cell (App's *Edit* opens its page, Laki AI's chat there), Remix (not one file), *Delete…* (`WidgetsApi.rm`: asked, Undo; not a repo's or a dev link's); on a cell, a `CellButton`, a rail or foot button, a panel, and after a Desk tile's own items, its head's right click and ⋯) and `laki://settings/widgets/<id>[/inspect]`
(links.ts `extension`) open it. Tested in `test/widget-dev.test.ts`.

Starters, the schema, the checker, one file (Part 3; `test/widget-check.test.ts`): `shared/widgetStarters.ts` `STARTERS`
(`STARTER_KINDS`; each `files(id, name)`: widget.json with `$schema`, `fetch.sh` that cats `fixtures/sample.json`, the
real fetch in its comments, `fixtures/empty.json` and three more made-up variants (`variants`; not launcher's nor onefile's), a README; `panel`'s `laki.d.ts`; `onefile`'s `<id>.5m.sh`; `context`'s three menu actions, no fetch, `summary.sh`, `file-stats.sh`, `branch-note.sh`). `widgetNew`:
the id slugged and made unique (`taken`: a widget, a store, a folder or file of it), `<data>/widgets/<id>` (`dir`: an
empty folder of yours; `onefile` in the folder itself), the store `on`, fetched (reason manual, why made); the CLI's `new`,
Settings' *New ▾* (`WidgetsApi.make`: App opens its page on Overview; `ExtensionPage`'s `seen`: one not in the view yet isn't
"deleted meanwhile"). `shared/widgetSchema.ts`: `MANIFEST` (widget.json's keys, each described), `WIDGET_SCHEMA` (draft-07:
`ui`'s elements a `oneOf` by `type` from `UI`'s words), `LAKI_DTS` (`window.laki` and `UiElement` for a JS page),
`manifestCheck` (unknown keys with `near`, kinds, places, sizes, `click`, `config` specs); `WIDGET_SCHEMA_URL` from
`types.ts` `REPO`; `scripts/widget-schema.ts` writes `docs/widget.schema.json` (the test fails while they differ).
`widgetCheck` (`checkOne` per `foldersIn` source): `manifestCheck`, a one-file's `seconds`, `script` inside the folder,
`templatesError`, `uiCheck` alone, then against `sample`, each `fixtures/*.json` and (with `run`) the fetched data, only
what the data adds (`against`); `run` is `widgetRun(…, true)` (`force`: an explicit run of an off one of the user's, never
`by: 'ai'`) and needs the widget in Laki at that path; a renamed one-file's old store said. `UiProblem` `level` ok, warn,
error; the CLI prints ✓ ! ✗ and exits 1 on an error; the inspector's Check tab (`Check`, `WidgetsApi.check`); MCP's
`laki_extension_check` (never runs). One file (`ONE`, `isOne`: `<id>.<n><s|m|h>.<ext>`, executable or `#!`, 256 KB): a
`Source`'s `file`, `oneFile` parses `<laki.*>` tags (`VAR`: xbar's settings) into a `Manifest` whose fetch runs the file
(its shebang when it isn't executable); `pathOf` is its path, `widgetFiles` gives the file only, `widgetRm` removes it
only. `widgetWrite` and `widgetFiles` take `fixtures/<name>.json` (`FIXTURE`; the folder not a link).

Per workspace (Part 4; `test/widget-ws.test.ts`): widget.json's `scope: 'workspace'` (`scoped`) makes an instance per
workspace (`instOk`: live, not Terminals' or Browsers', not on a host: ponytail), its data `<data>/widget-data/<id>/ws/<ws>.json`
(`Inst`: data, at, error, mock; `readInst`/`writeInst`), its meta and face in the entry's `inst`; the store keeps the
settings. `keyOf` (`<id>@<ws>`) keys `running`, `again` and `runs`; `wsOf` resolves a call's `ws` (required when scoped,
refused when not, never an archived one); `keep` writes a fetch's or a mock's result to the store or the instance.
`wsInfo` (core's `wsVars`: `agentVars`' values, as `varsIn`) is templates' and `ui`'s `workspace`, a script's
`workspace` (`LAKI_WIDGET_WS`) and `wsEnv`'s `LAKI_WORKSPACE`, `_NAME`, `LAKI_PROJECT`, `LAKI_BRANCH`, `LAKI_BASE`,
`LAKI_PATH`, `PORT`, `LAKI_PR`, `LAKI_STORAGE_FOLDER` (once `ws.storage`), and `LAKI_WIDGET_FILE` its file; `SAMPLE_WS`
a sample's. Fetched only on screen (`onScreen`: each shown client's `view.ws`, else its tab's workspace): `widgetTick`
per instance (`due`), `select` (core's `setView` as a window's workspace changes) only the scoped ones; `refetch` (dev,
settings, reload, linked) does the same; `AT_ONCE` (4) per extension, more refused till the next tick; `soon` runs one
and logs a refusal. `instView` gives the view's `inst` (the ones fetched, live). `widgetsGone` (core's `dropWs`) deletes
a workspace's files; `widgetRm` the `<id>/` folder; archive keeps them (not in `inst` while archived). `checkOne` warns
when a scoped one uses nothing of the workspace (`WS_USE`) and wants `ws` to run; `manifestCheck` refuses another scope.
The renderer: App's `wsHere` (none under a page over every workspace: `covered`, nor a terminal's, a browser's, a
host's) is the view's `ws` and `Widgets.tsx` `inWs` (an instance over the widget, `here`: null is *Select a workspace*,
`NO_WS`, dimmed `.no-ws`); `WidgetApi`'s render, run, action and say and `WidgetsApi`'s run, runs, mock and check take
`ws` (`w.here`); `ExtensionPage`'s `spots` and `here` (the selected workspace's instance, else the first; the inspector's head names it, `.ext-ws`); Settings' row says *per
workspace*. The `workspace` starter (*This branch*). The `pullmain` starter (*Pull main*): a status bar button per
workspace (no `ui`: a button), its badge the base's commits not in the branch (`fetch.sh`: `git fetch origin <base>` once per repo every 15 minutes,
20 s at most, its mark `laki-fetched-<base>` in the common git dir (FETCH_HEAD is per worktree), a failure said in its
`tip`), its `pull`
action by `how`: `agent` (`laki send <ws> --when-idle`: an action picks by its setting, which the kit's `do: send`
can't), `git` (fetch, merge; conflicts to `claude -p`), `ai` (`claude -p`); `claude -p` runs in the background (an
action has 2 minutes), its last line pushed back as `last` (`laki widget push --merge`), which `notify` says; tested in
`test/widget-check.test.ts` with the fake claude's plain `-p`.

Events, streams, push (Part 5; `test/widget-events.test.ts`): `types.ts` `WIDGET_EVENTS`; core calls `widgetEvent(name,
fields, ws?, tab?)`: `turn()` (`turn.done` with `last` and `seconds`, `turn.failed` on a failure or limit, `turn.long` from `longTurnTick`, `turn.waiting`
800 ms later with `askOf`'s options), `prEvents` after each `scanPR` (`prSeen` per workspace: the first scan only notes it,
null for "no pull requests found"; `failHead`/`passHead`: checks once per head; new logins in approved/changes;
MERGED/CLOSED as the state changes), `makeWs`'s end (`workspace.new`; an agent's, `from.agent`, when an agent made it:
`NewWs.agent`, `byCaller`'s `callerAgent` (its tab's preset; else what the RPC says, `agentIn`: MCP's `agent` or `Laki AI`,
adding one, never taking one off), a run an agent started (`r.by`), else `from` alone: `agent`; its setup and agent tabs'
`tab.new` too, as `addTab` `agent` is for main.ts' `tabNew` from an agent and a run's agent blocks, and `replaceTab`'s for
an agent's `run` (in `CALLER`) and `ship`, whose `ship.done` is the agent's too, as `workspace.archived` is for its
`wsArchive`; a run's ship, dev and archive pass `GateOpts.agent`; `fromAgent`), `wsArchive`, `wsRestore`, `dropWs`
(`workspace.removed`, every way one goes), `runSchedule` (`schedule.ran`), main.ts' first client (`app.open`), `ship`'s
tab's `onExit` after a `scanPRs` (`ship.done`: `ok`, `exit`, `pr`), workflow.ts `finish` (`flow.ended`), `checkLimit`
(`limit.hit`, once per limit: `limitSent`, a reset within a minute the same), `addTab` and `replaceTab` (`tab.new`; not
`restoreAll`'s), `scanPorts` (`port.open`: a port not in the last scan's, `rootTab` its tab; a tab `restoredAt` in its
first `RESTORED_QUIET` minute only notes). `widgetEmit` (`laki widget emit`, MCP's `laki_extension_emit`): `custom.<name>`
(`CUSTOM_EVENT`), `data` (`EVENT_MAX`), `from` (`widget`: the CLI's `LAKI_WIDGET`; `tab`; `agent`: `agentCaller`'s, or
`ai` Laki AI's; MCP's `laki_extension_emit` always an agent's, `LAKI_TAB` or not), `hops` (the handler's `LAKI_EVENT_HOPS`
+ 1, past `HOPS_MAX` 3 dropped and logged), `agent` (an emit `from.widget` while `handling` has that extension at an agent's
event, the daemon's own, else the handler's `LAKI_EVENT_AGENT`: an emit made handling an agent's event is the agent's; the
input adds an agent, never takes one off); a `Job` keeps `agent` and `of` (the event's workspace); `handle` asks before an
action handler of an agent's event (`approve`, `ask: 'first'`: Always is a grant, `grant`, as a tool's, in `of`, listed in the view's `tools` as *On an agent's event* to Revoke; no window,
no answer or Deny: not run, a warn line), a `refresh` unasked; an agent's run (`FlowRun.by`: `flowStart` `by: 'agent'` or
`agent`, an agent's event's) sends `flow.ended` `from.agent`; `handlerOf`:
`on[name]`, else `on['custom.*']`; never to `from.widget`. `sent` (`SENT_MAX` 50, `EventSent`: what each reached,
`refused`) is `widgetEvents` (`laki widget events`). `eventHooks.flows` (workflow.ts): workflows with `on` (`listening`,
read again every 10 s or as `flowFiles.at` moves) start (`flowStart` `event`: `eventVars`, `{{event.<path>}}`) in the
event's workspace's project (`runs in: here`: that workspace, `ws`), a project's own in its project only; refused: no workspace, problems, `byAgent`,
`untrusted`, past `HOPS_MAX` (its 5th argument, `hops`: widgetEvent's, checked here too; a run keeps it as `r.hops`, and
`finish`'s `flow.ended` is `hops + 1`, so A's end starting B and B's starting A stops there; #5: so is every other event a
run causes, with its `run` (core's `Cause`, workflow.ts' `cause`: `wsNew` `hops`, `addTab`, `replaceTab`, `ship`'s and
`wsArchive`'s `GateOpts`: its `workspace.new`, `tab.new`, `ship.done`, `workspace.archived`, `tidy`'s archive too; never an
RPC's: `byCaller` and `tabNew` drop them), so an `on: workspace.archived` run archiving its own worktree is its own), an
agent's event to one with run, webhook, extension or `OUTWARD` blocks, the event of its own run (`r.ws`, or the worktree's
`ws.flow`: `wsNew` `flow`, set in `makeWs` before its `workspace.new` and its setup tab's `tab.new`; never an RPC's, `byCaller`),
an `only when:` test that doesn't hold (`whenFails`: `Workflow.when`, each a Case branch on `eventVars`, through `held`, so a
`matches` stops at 200 ms; a repo's file's as it is at each event), and a live (or queued) run of it whose `evWs` (`Start.evWs`:
the event's workspace; a worktree run's `ws` is its own) is the event's. Its
payload: `event`, `at`, `ws` (`wsInfo`'s id, name, project, branch, pr), `tab` (id, name, agent) and the fields, past
`EVENT_MAX` (64 KB, the fields alone, so `widgetEmit`'s data as `{ data }` up to it arrives whole) the fields dropped (`cut`). Each extension that's on and has it in `on` (`m.on`; a scoped one only
its workspace's, live) gets a `Job` in `queues` (`QUEUE_MAX` 20, the oldest dropped and logged), `drain` runs one at a
time: `handle` writes `LAKI_EVENT_FILE` (tmpdir, 0600, removed after) and runs `widgetRun` (refresh) or `widgetAction`
with `Ev` (`LAKI_EVENT`, the file, the JSON on stdin: `exec`'s `stdin`, ended at once otherwise) and reason
`event:<name>`; an action's toast or modal is broadcast as `widget-say` (`widget`, `ws`; App's `widgetSay` ref). An
action's JSON with `data` (`merge`: shallow over an object) is kept through `keep`, no fetch after. Streams (`streaming`:
`stream: true`, not scoped, with a fetch): `streamSync` (each `widgetTick`, `widgetSet`, `scanWidgets` (which stops one whose
folder, fetch, script, stream or scope changed, or that went: `runOf`)) starts each that's on, not mocked, not `stopped`, while a window was shown within `STREAM_IDLE` (10 min,
`shownAt`) and in `widgetHours`; `startStream` spawns it (`own`, stop key `stream:<id>`: `resourceStop` →
`widgetStreamStop`, `stopped` until Run now, a switch or a reload), each stdout line that parses is `data` (`streamView`:
the view within 250 ms, the store every 5 s and as it ends; `dataOf` reads the in-memory line), others the log; an exit is
a run (reason stream) and `wait` 1, 2, 4… 60 s (1 again after a minute up). `RUN_JS` streams an async generator's yields
as lines. `widgetRun` on a stream starts it again; `due` skips them; `checkOne` doesn't run them; `manifestCheck` checks
`on`'s events (`near`) and handlers (an action or refresh with a fetch) and `stream` (global, with a fetch, `every`
ignored). `widgetPush` (`laki widget push <id> [json|-] [--ws] [--merge]`): `keep`, a `push` run, refused when off. The
`stream` starter. The inspector's Runs shows `WidgetRuns.stream` (`WidgetStream`).

Fixes (`test/widget-fixes.test.ts`): `widgetRun` refuses an `ai` source for any reason but `manual` within
`everyOf` of its last run (a new AI `source` from `widgetSet` is `manual`); `widgetEvent` sends `workspace.archived`
and `workspace.removed` to a scoped one while the workspace is still in `state` (`going`: a `Job`'s `gone`, its `wsInfo`
then; `handle` passes it as `Ev.gone`, `widgetAction` runs on `wsEnv(w, undefined, gone)`, no `LAKI_WIDGET_FILE`, keeps
nothing; a refresh for one is logged, not run) and queues no `refresh` while one for that extension and workspace waits;
`due` backs off `every × 2^min(fails, 3)` (`fails` in the store or instance, cleared by a good fetch); `keep` sets
`told` only while it's on and a client is connected; `uiCheck`/`checkOne` warn at `RESERVED` top-level data names
(`reservedIn`, with or without a `ui`); a config `Spec`'s `required` (`optionsOf`, the view's `missing`: App's `set`
opens the page at that field, `ExtensionPage` `edit`, the field's `data-key`; `Cell` says *Set <label>*); MCP's
`extNames` (a name the same as another's, or cut at 64, gets `_<6 hex>`; list and call build the same map). The
renderer: tool asks wait in a `Line` (text.ts; `toolShow`, a notification's click is `front`), Remix is always there
(`laki widget remix`), `AiPage` `chat` (the Extension page's `widget:<id>`), the Desk shows the selected workspace's
instances (`covered` leaves it out; `DeskPage` `wsName`).

Where you work (Part C; `test/widget-places.test.ts`): `WIDGET_PLACES` adds `panel` (SidePanel's `ext` tabs, `PanelTab`
`ext:<id>`, Widgets.tsx' `WidgetPanel`) and `row` (`RowMarks` on Sidebar.tsx' `wsRow` and `peekCard`, `rowMarks`' filter, an instance's `badge` else `label`, its data's `tone` (`faceOf`: a kit `TONES` word, the face's `tone`) as `t-<tone>`; a click: `click`, else `WidgetApi.full(id, ws)`, the workspace selected and its full view; scope
workspace only: `manifestCheck` and `widgetSet` refuse a global one; `shownIn` fetches every `instOk` workspace's while
a window is shown, `AT_ONCE` at a time). An object action's `MENU` fields (widgetSchema.ts: `ACTION_SHOWS` palette,
workspace, tab, file, prompt; `match` globs, `globMatch`; `key`, `normKey`/`pressOf`, Alt or Ctrl in it, a plain ⌘ one
warned and never taken, a ⌃ one without Alt or ⌘ warned (a terminal's); `menuCheck`) become the view's `menus` (`actionMenu`, `WidgetMenu`). `widgetAction` `ctx`
(`WidgetCtx`, `ctxOf`: a live `instOk` workspace, a scoped one's own; a tab of it; a file `inside` it, or with `storage` inside its storage folder: App's `artMenu`'s `extItems`) adds `$LAKI_CTX`,
`$LAKI_FILE`, `$LAKI_TAB`, the workspace's env for a global one (`infoEnv`, no `LAKI_WIDGET_FILE`) and an AI action's
`{{file.path}}`/`{{tab.name}}`; none from an agent or an event. `insert` (the JSON's, else all of stdout with `insert:
true`, `INSERT_MAX`) comes back for the prompt; `open` (shared/widget.ts `openOk`, a button's rule) and `files` (#26:
`filesOut`, `FILES_OUT` 10, each `within` the workspace, its storage or `pathOf(w)` by realpath, relative from its folder;
an image through `imageSave`; `ActionFile`) with it, neither for an event; what's refused goes to its log. The renderer: App's `extMenus`/`extItems`/`extRun` (confirm (`ask`),
ask (ui.tsx `askText`, AskHost's `field`), `widgetAction`, then insert: the box's `into` (PromptInput `inserts`,
`Inserts`: App's `extInserts(ctx, project)` over Widgets.tsx' `insertMenus` (on, a per-workspace one's with a workspace,
a repo's for its project) for the new-workspace page (the project picked: NewWorkspace's `inserts(project)`), Laki AI's
page and floating chat (`hereCtx`), Send later's box (`SendLaterDialog` `inserts(tab)`: the agent picked, its workspace
and tab; Laki AI: `hereCtx`; the app's one box that sends to an agent: the old send bar went in 60ad53a); NewWindow.tsx'
`windowInserts` for the new-workspace and AI windows (no workspace: global ones and the picked project's, its own
confirm, ask and `widgetAction`); PromptInput's `Inserted`, files as its images and chips (a box without `saveFile`,
Laki AI's: their paths typed), an image's thumbnail by `aiImage`; right after a word, a space first), else
`intoAgent` (files as paths, `withPaths`; the Preview's `toPrompt` too), else the clipboard; `open`: `widgetApi.open`
after it, a widget button's too; `view`: its full view, a file's as a preview tab, `Opened.ext`, `fileKey`'s `ext:<id>:`), in
the palette, `wsMenu`, `tabMenu`, `fileMenu`, `artMenu` and the capture keys (before `act`, Alt or Ctrl only).

Sources (`test/widget-source.test.ts`): `types.ts` `WIDGET_SOURCES`, `WidgetSource`; widget.json's `source` the
default, the store's (`widgetSet` `source`, `sourceOk`: a static text 64 KB, a path, an http(s) URL; `fetch` only with
`ownFetch`) wins, `sourceOf`. `fetches` is a fetch of its own or any other source; `due` skips static; `streaming` only
its own fetch. `widgetRun` reads a source through `sourceText` (static: its text; file: `fill`ed over `{ config,
workspace }`, `~` home, relative to its folder, `MAX_OUT`; URL: `fetch`, `SOURCE_WAIT` 30 s, its status said without
the query) and `parsed` (JSON when it starts with `{` or `[`, else `{ text }`; a static text that doesn't parse is an
error). A static pick is kept at once (`keep`), on or off. `needsSample` (widgetSchema.ts: a fetch, a script, a file
or a URL) is `manifestCheck`'s and `widgetWrite`'s rule. `SourceField`, the page's Data tab: a segment
per kind (its fetch only with `ownFetch`), the text, path or URL saved on blur.
An AI source (`ai`: `prompt` 16 KB, `tools` claude's names, never one starting with `-`, `profile`): `sourceText` fills
the prompt like a path, `agentOf` (its `profile`, refused when gone; else `settings.widgetAgent`, Settings › Extensions'
*Agent profile*, `extAgent`; else the first claude preset; else plain claude), then `ai.ts` `aiOnce` `preset`: that
preset's model, effort, env and account with the user's own config (claude `-p --output-format json --allowedTools
<tools>` (and the store's `allow`: `allowedOf`), no `--tools ''`, and `--mcp-config` with `laki_ask` beside the user's
servers (`mcpWith`: `laki mcp` with `LAKI_PERM_EXT`, which lists only `laki_permission`) as `--permission-prompt-tool`:
`aiPermission` with `ext` is `widgetPermission`, a `toolAsk` with `perm` (App's dialog and notification: Allow once,
*Always for <name>*, Deny; `answered`, `LAKI_TOOL_WAIT`; #6: refused with no `agents` run of it going, no ask), Always
into the store's `allow` with `allowFor` (`aiKey`: the AI source's and AI actions' prompts and tools; `allowOf` drops
`allow` once it differs: a `source` set, a scan of an edited widget.json) (the view's `allowed`,
`WidgetCard`'s *Its agent may use*, Revoke: `widgetSet` `allow`, never an agent's); no window, no answer or a deny: it
goes on without it; codex `exec` without `--ignore-user-config`, read-only), 10 minutes, its own `own` row, a line
in `ai-calls.jsonl` (`extension <id>: …`); `aiSystem` tells it to change nothing and answer in `sample`'s shape; the last
```json block is the data (none: `{ text }`). `everyOf`: `AI_SOURCE_EVERY` (60) unless set, 15 at least; `widgetCheck`
doesn't run one. Its page's Try/Turn on sheet shows its prompt and tools instead of the fetch. Its runs and an AI
action's go through `agentRun` (`agents`: an `AbortController` per run by extension, `aiOnce`'s `signal`, `execFile`'s, and
`stop` `agent:<id>`, its Resources row's Stop: main.ts `resourceStop` → `stopAgents`, which also drops its `again`); the
view's `agent` (the inspector's *Stop*, `WidgetsApi.stop`); `widgetSet` `on: false` and a new `source` stop them,
`widgetRm` stops them and waits (5 s) before its files go, `scanWidgets` when it went, `widgetsStop` at shutdown. A
stopped fetch fails as `claude: stopped`, its last data kept.
The user's switches (`WidgetHide`, the store's `hide`, `widgetSet` merges each; Settings' *Show a refresh button* and *Show when it was
fetched*): `widgetRender` gives `uiHtml` `hide` (`refresh`: no `refresh: true` button; `at`: `at` out of the scope and
`namesAt`, a plain top-scope element whose words name it, dropped; Retry stays) and a template its ctx without `at`; the
renderer's `status` says no *fetched … ago* (`all`: the extension's page still does), the full view no Fetch now. A JS
page draws its own (ponytail). An AI action (`widgetSchema.ts` `aiActOf`: `{ ai, tools, profile }`, no `run`): `widgetAction`'s `aiAnswer` fills the
prompt over `{ arg, config, data, …data, workspace }`, `aiOnce` as a source's, `lastJson` for its JSON (`toast`, `modal`,
`data` as a command's), else its words as a `modal`; no `soon` after it; never an event's handler (`ev`: refused, and
`manifestCheck` says so: each run costs). `TOOLS_BAD`: claude's tools go as one argument, refused only when it starts with
`-` (an option of claude's). `notify` (widget.json): `keep` renders it
(`faceOf`'s `one`) over the data it keeps with a new `at`, not a mock (nor one let go of: Live); a text not `told` before (the store's or instance's) is
broadcast as `widget-say` `notify` (App: a notification, its click the full view or the page, and a toast), `told` kept
(empty clears it). Tested in `test/widget-source.test.ts`.
Settings › Extensions: the UI kit first (`.kit-hero`), New ▾ *With Laki AI…* or *From a starter…* (UiKit.tsx'
`StarterPicker`: each starter's `files` drawn by `KitBody` on its sample, a button (rail, foot, or no look of its own) as one, one file's head, a JS
page's note). Desk's resize (`resize`): the size from the pointer over the tile now (`dx`, `dy`: where on its corner),
the grid's `minHeight` held meanwhile (a shrinking bottom tile would scroll the page up under the pointer), its scroller's
`scroll` counted, its edges scroll it (`edge`, rAF). The Picker: `data-widget`/`data-view`/`data-sample` on an
extension's body, frame and buttons (Widgets.tsx), a shadow root's own `elementsFromPoint`, `extOf` (its id, view, the
kit's element by its root's class, `kitOf` from `UI_SAMPLES`, places, size, source, folder) in the dialog and
`pickedText`.

Laki commands (`widgetUi.ts` `DO`, a button's `do`, `doOf`: `data-do`, its JSON filled; `uiBehave` sends `{ laki:
'do', cmd, label }`, a JS page's `laki.do`): Widgets.tsx' `act` hands it to `WidgetApi.do`, App's `widgetDo`: `browse`
(`quickNew('browsers', url)`, no question), `terminal` (`ask` danger, `quickNew` shells, then `send` to `<ws>/1` 1.5 s
later), `ai` (`aiAsk`, the AI page or the floating chat), `send` (`send` `agent` `whenIdle` to `w.here` or the selected
workspace), `new` (`wsNew` in `project` by id or name, else the workspace's project; `preset: agent`; `model`, `effort`, `perm`
(`DO_PERMS`), `fast`, named in its ask (#30); refused when `neverAsks` by its `perm` or its profile's; a `git: false`
one's `another`), each but browse after `ask` with the words in quotes. `uiCheck` (`NEEDS`) warns at one without its
field, errors at an unknown `do` and at a `do: new` whose `perm` `neverAsks` (its `agent`, else claude).

Colors and charts: `colorCss` (a tone's var, the palette's `var(--tc-<name>, <fallback>)` (`TC`), a hex), `hue` over
a template, `at`'s `color` (a style `color`); Widgets.tsx' `VARS` pass `--tc-*` to a JS page. `chart`: `CHARTS`, pie and
donut as `pathLength` circles, hbars as HTML rows (`data-rows`, *+N more*), stacked, scatter as HTML dots, `PALETTE`,
`legendOf`. The other new elements: header, footer, toolbar (`button` `bare`), spacer, callout (`CALLOUT` icons),
icon (`SIZE`), gauge, heatmap (`level`), status (`STATE` words), checklist, avatars, card; then quote, diff (each line's
kind: file, hunk, added, removed; the counts), countdown (`howLong`, warn within `soon` hours; its words as of the
render), steps (`STEP` words to done, now, fail, skip, todo; vertical in a narrow cell), meter (parts of `max` or their
sum, `legendOf`), board (columns by `column`, `columns` first even empty; `cap` per column), tree (`nested`, `open`
levels, a node's own fields only), log (the newest `cap` lines, `levelTone` by its word or the line's, `clock`), json
(`jsonHtml`: folding, 3000 nodes, one line in a bar) and toggle (`role="switch"`, `data-run` with `data-arg` on/off;
`uiCheck` checks its run). Then kbd (`keysOf`: by spaces, else `+`), secret (dots in a `<details>`, a long one's last 4,
copied whole), rating (stars as `--f` fills), calendar (a month, Monday first, `dayOf` in this Mac's zone; a preview the
weeks that fit from today's; a bar's line the next one; `list` in full), people (`face`: a login's picture, else
`initialsOf`; `PRESENCE` dots), inbox (`unread`), chat (the newest last, `mine` on the right), prs (`PR_STATE`, `CHECKS`,
a review's tag), commits (the hash's `data-copy`), segmented (each option `data-run` with its value, the picked one none)
and stepper (− and + `data-run` with the new number, `round6`, past `min`/`max` disabled); `rowsOf` is their rows' cap,
+N more and empty. Then accordion (`<details>` sharing a `name` per tree: one open at a time, none with `multiple`; a panel's `children`
over its row, uiCheck's walk too), breadcrumbs, gallery (scroll-snap, `imageOk` pictures) and loading (`k-spin`,
`k-blink`, `k-slide`; slower under reduced motion); a table cell's `subtitle`, `image`/`avatar`/`icon`, `progress`
(`pctOf`, `minibar`, a list accessory's too), `badge`, `spark`, `copy` and `actions` (`.k-tc`; none: the words alone). `UI_EXAMPLES`: the UI kit
page's Examples (`UiKit.tsx` `KitCard`), the guide's examples (`widgetGuide.ts` `examples`); `UI_SAMPLES` stays one
per element. After DaisyUI's: hero (`--hero`, a glow), mockup (browser, window, terminal (dark in any theme), phone;
`$ ` lines as commands), filter (`data-filt`, chips `data-chip`: `uiBehave`'s `sift` over its `[data-rows]`, the rows
drawn only), rotate (`k-rot`: `steps()` over the words, no slide), compare (DaisyUI's diff: a CSS `resize` grip scaled
up and see-through over the divider, no script; `.k-cmp` a container), skeleton (`k-shim`), radial, indicator, avatar
(shapes by `border-radius` or `clip-path`, a ring as its padding), range and select (`data-change`: `uiBehave`'s `change`
runs them, never a click, disabled while it runs, back to the data's value when declined or failed: App's `action` gives
false; a range's `[data-rv]` follows it), input (`data-inbox`, its button's `data-input`: the
typed words as the arg, Enter clicks it, cleared once it ran unless `data-keep`; a JS page's busy cleared by `done`
too), swap, pagination (`pn`, not `num`: `WIDGET_CSS`'s), menu (`menuRow`, shared with dropdown; its headings `data-sect`,
which `sift` hides with no row under them shown) and dropdown (a `<details>`; `uiBehave` closes one at a click outside
it or in its menu, or as the focus leaves it (`focusout`: the rest of the app too), scrolls a full view's menu into sight; a
preview's covers the cell, a bar's opens the full view). After shadcn/ui's and developers' tools: popover (the native
Popover API, `popovertarget`, anchored by CSS anchor positioning: the top layer, so no cell or full view clips it; `hover`:
`uiBehave`'s `hover` shows it on `mouseover` and hides it 250 ms after `mouseout` (`kHide`: the pointer crosses the gap
to it), `data-hov` until a click on its button pins it; Esc in `uiBehave`'s `key` closes an open popover or dropdown and
takes the key, so a full view's `Modal` (`escapes`) and a JS page's close stay), command (a palette: a
`data-filter` box over `menuRow`s, `data-none` shown when `sift` leaves no row, a row's `keys` as `kbd` (`said` skips
them); `uiBehave`'s `key`: ↑ ↓ between box and rows, Enter in the box clicks the first shown), combobox (an input's
`<datalist>`; a path's options are the data's words, never templates), datepicker (`dateIn`: the value in its input's
shape; `data-change`), split (`button` and a dropdown of its `items`), radio (cards, `data-run` with each value but the
picked one's), textarea (`data-inbox`; ⌘/Ctrl Enter clicks its button; a `do` (new, send, ai) takes the typed words as
`cmd.prompt`: `uiBehave`'s `do` branch with `data-input`, emptied once App's `widgetDo` returns true), snippet (tabs as
radios, no script), env (`SECRETS` names behind a `k-sc`), uptime, deploys (`DEPLOY`), issues (`ISSUE`, `ISSUE_ICON`,
`priorityIcon`), endpoints (`METHOD`), changelog (`changeOf`: conventional commits), clock (`zoned`; `uiBehave`'s `tick`
every 15 s with `CLOCK`'s options, its interval cleared by the cleanup), funnel, swatches (`colorCss` only), matrix
(`STEP`'s words, `MX`), marquee (two copies, the second `inert`; paused on hover and under reduced motion) and bento.
`menuRow` gives each row `data-label` (its words for a confirm and `run`'s label). The app's CSP takes no `https:` pictures but GitHub's avatars (L7): the kit's images in the window go through
the daemon's `GET /img?k=<imgKey>&u=<https URL>` (main.ts `imgPage`: the view's `imgKey`, `urlKey('img')`; `IMG` types only,
10 MB, 15 s, redirects one at a time, each `webOk`: https, no localhost, LAN or IP-literal host; its own sandbox CSP), Widgets.tsx `clean` rewriting each https `src` by App's `imagesVia` (none set: dropped;
`srcset` dropped; a web address stays only on an `a` or `area`); Markdown's pictures are links. The guide tool's `max`: 60,000. Starters `note` (a static source) and `launcher` (`do` buttons).

Tools for agents (widgetTools.ts; `widgetSchema.ts` `toolOf`, `toolSchema`, `toolArgs`, `actionCmd`): an
action may be `{ run, tool: { description, input, required, ask } }` (`TOOL_TYPES`, `TOOL_ASKS`; `ask` unset: first).
`widgetTools` lists the ones that are on (`tool` `<id>.<action>`, the input as a JSON Schema, `agents`: its folder's
`AGENTS.md`, 4 KB). `widgetToolCall` (`id`, `action`, `input`, `from` `{ ws, tab, agent }`): `toolArgs` checks the input
first, a scope workspace one takes the caller's; `first` without a grant (`state.widgetGrants[ws]`, `<id>.<action>`; '':
no workspace) or `always` broadcasts `toolAsk` (`req`, the command, input, ws, tab, agent; refused with no client) and
waits `LAKI_TOOL_WAIT` (2 min) for `widgetToolAnswer` (`once`, `always`, `deny`; the first counts), then `toolDone`;
`always` keeps the grant (`grantKey`: `<id>.<action>#<hash>`, sha256 of its command and `filesHash`, so an edit, one made while
Laki was closed too, asks again; the view's from a size-and-time cache, a call's read fresh; grants without `#` dropped at `load`).
Logs (widgetLogs.ts, `test/widget-logs.test.ts`): `logOn` (`settings.widgetLogs`, the store's `log` through
`widgetSet` (refused from an agent), or `dev`); `xlog` (`WidgetLogLine`: `n`, `at`, `level` (`LOG_LEVELS`; an info line
of a run's own text takes its `debug:`… prefix: `leveled`), `src`, `text` (2 KB, `masker`: secrets' and `SECRET`-named
settings' values of 4 characters or more as ••••), `ws`) into `pending`, `flushLogs` every 500 ms and at
`widgetsStop`: `<data>/widget-data/<id>.log`, 0600, past `LOG_MAX` (1 MB; `LAKI_WIDGET_LOG_MAX`: tests') renamed to
`.log.1`. Written: `wLog` (Laki's, `src: laki`; a function only when logged), `ran`'s line (with `gh N×`: `exec`'s
`ghShim`, `<data>/gh-shim/gh` first on the run's PATH, a byte per call into its own `$LAKI_GH_COUNT` file, then
`$LAKI_GH`, the gh that PATH has; none without one; `WidgetRun.gh`, the inspector's Runs, `laki widget dev`), a
warning after a run that hit GitHub's rate limit with core's `ghSaid` (Laki's own gh calls this hour, by kind), and the
run's stderr (`LOG_RUN`, 64 KB, its end), a stream's other stdout lines and stderr as they come, `aiLog` (`aiOnce`'s `onCall`:
seconds, cost, the answer's size), `widgetLog` (`laki widget log`, `cli`; a JS page's `laki.log`, `page`; `LOG_RATE`
50 a second; off: `{ kept: false }`). `widgetLogs` (`since`: the cursor, `n`; `level` at least, `src`, `ws`, `limit`;
`next`) for Extension.tsx' `Logs` tab (every 2 s, the filters its own, `cfg.log`), `laki widget logs [-n] [-f]`, MCP's
`laki_extension_logs`, `aboutWidget`'s last 30 warnings. `widgetLogClear`; `widgetLogFile` for `openIn` `log`. `keptOf`
takes both files to the trash. `errAt` is the view's `logErr` (Settings' red `log` tag).
`filesHash` (widgetTrust.ts): the extension's own files (top level, fixtures) and what it runs from outside them (the store's
source, its whole manifest as read, `net`): a Yes holds only for it. `widgetWhat` gives it (`laki widget what`), after
reading widget.json again (one the scan hasn't read yet: `scanWidgets` first, so its text is what the hash covers),
`widgetFiles` too (read first, so a change while they're read can't match), `widgetSet` `on` with `seen` refuses another
(its page's TrySheet, `laki widget on --seen`), `toolAsk` carries it and `approve` compares it after the answer (*its
files changed while you were asked*: not run, no Always).
`approve` (the ask) is shared with `widgetAction`'s `from`: core's `agentCaller` (`from.tab` an agent tab, or a shell tab in
`shellAgents`; `laki new`'s `byCaller` too) makes a tool's action a `widgetToolCall` (its arg as JSON input) and any other
ask each time (`ask: 'always'`: no Always); `widgetSet` `on: true` from one is refused, `widgetDev` from one links but leaves
them off (and guarded: `agentDev`), `widgetNew` and `widgetRestore` from one make them off, `widgetCheck` from one runs no off one. ponytail: the same user can read daemon.json's token. It runs as `widgetAction` would (`$WIDGET_INPUT_<NAME>`, the input as JSON on stdin, a run
`tool:<action>` with who and how), its stdout back (`TOOL_OUT`, 16 KB). Grants go with the extension off, its commands
changed (`cmdsOf` at scan) or a workspace gone; `widgetGrantRm` is Settings' Revoke. App's `toolAsk`: `choose` (Allow
once, *Always in <ws>* for first, Deny; Esc, outside or its time running out: deny; a newer ask covers it and it comes back, a page or dialog opened over it (`AWAY`, App's effect on `dialog`) puts it back in line until that closes) and a notification with the same actions
(main's `tool` action calls `widgetToolAnswer`); `toolDone` closes the dialog (`unchoose`). The CLI's `laki widget
tools|tool`; MCP's `laki_extension_tools`, `laki_extension_call` and an `ext_<id>_<action>` tool per one (listed only
with a daemon up: `alive`); Laki AI has them as MCP's; `LAKI_NOTE` names them while one is on (`TOOLS_NOTE`).
`manifestCheck` checks each tool and warns at `never` with an outward command; `checkOne` at a missing or long
`AGENTS.md`. The `tool` starter. Tested in `test/widget-tools.test.ts`.

Gates (widgetEvents.ts' gates section, `test/widget-gates.test.ts`): an object action's `gate` (`GATES`: ship, merge,
archive; `widgetSchema.ts` `gateOf`, a command action's only: `manifestCheck` refuses it on an AI action or an unknown
step). Core's `gated(step, ws, GateOpts)`, before `ship` (async now: main.ts, workflow.ts, the CLI, App), `prAct`'s
merge, `autoPR`'s Merge when green and `wsArchive` (after `ifClean`'s dirty check; `archiveMerged`'s and a workflow's
too; not `wsRm`, not `archivedTidy`): `force` skips them, refused from `agentCaller` (the CLI's `--force` in an agent's
tab too); `by` you, agent (`agentCaller`), auto, workflow. `widgetGates`: every on extension's gates for the step (a
scoped one where `instOk`), `GATE_MAX` 8 together, `gateWait` 30 s (`LAKI_GATE_MS`: tests'), `exec` with stdin and
`LAKI_EVENT_FILE` `{ gate, ws: wsInfo, pr, stat, by }`, `LAKI_GATE`, `wsEnv`; a run `gate:<step>` in its Runs and log.
`{"ok": false, "why", "fix"}` is a `GateHeld` whatever its exit code (`said`, for both a run that ended well and one that
failed: a no that exits 1 is a no); an error, a timeout or no `ok` holds it, `its gate failed: <problem>`, unless `by`
is you: then it goes ahead (`wLog` error, a `widget-say` toast). A guarded one whose files changed fails so too: in its
run (`trusted` throws, `Failed.changed`), or off already by the watcher's `untrust` (the store's `changed`: `moved`,
its gates still count; yours: *changed* in the toast). The CLI's `laki ship` and `laki archive` (`caller()`, `--force`) print the
reasons and exit 1 (cli `held`). Each hold `gate.held`. Held: `{ held }` back (App's `gated`: *Checking…* on the
button while `gatesOn` (`checking`: Ship's `Prompt` `busy`, Merge's `WsInfo.checking`; an archive's row, `busyWith`), then
`choose` *Not shipped*… (each hold a `Fact` with its icon) with *Do it anyway* (`ask`, then `force`) and *Ask the agent to
fix it* (the fixes in `askText` `multi`, a text box, to change first; ⌘⏎ sends; `send` `whenIdle`) when one has a `fix`
and the workspace a live agent tab); `autoPR`: `overToYou` once, `f.land`
the head and `f.held` its gates' `gatesKey` (on, `filesHash`), tried again when that changes; `archiveMerged`: logged,
`autoArchived` kept; a workflow's block: its error way, `steps.<id>.output` the reasons. The view's `gates` (Settings'
*Can hold*), `widgetWhat`'s text.

Repo extensions (`test/widget-repo.test.ts`): `repoRoots` (each project not `kind` nor `host`: `<path>/.laki/extensions`,
its own folder, not a worktree's: ponytail) after yours in `scanWidgets` (a dev or `widgetDirs` root
under one, `repoOf`, by path or realpath, is that project's too; `widgetDev` leaves them off), each an `Entry` with `project`
and the id `<project>.<id>`; `watchRepos` (`fs.watch` of the project's `.laki`, recursive, a change under `extensions/`; while `.laki` is missing, the project's folder, flat: a branch without it and back reads them again (macOS says nothing to a watch of `.laki/extensions` itself as git removes it); 1 s, then `scanWidgets`; closed by `widgetsStop`), and
core's `projectPush`/`projectRm` scan again (a removed one's go, their stores stay). Trust: `widgetSet` `on` needs `seen`
(`widgetWhat`'s hash; for a repo's it adds `repoShown`: its actions' commands and its files' text, 12k), the store's
`trusted` is `dirHash` and `files` each file's (`eachHash`) over `repoFiles` (#4; S8: `dirHash` reads again only when
a file's name, mtime, size, ctime or inode changed, and widgets.ts' `trusted`, the check before every `exec`, always
reads them whole: a same-size edit with its mtime put back is caught there): every file under the folder (`git
ls-files --stage` and `--others --directory`, ignored ones too; a gitlink (160000), an untracked folder and a nested
repo walked, `.git` left out) but its state: widget.json's `state` (`stateOf`, `stateHas`: a glob without a / by name,
with one by path, a trailing / a folder; `manifestCheck` checks it) and `STATE` (`.DS_Store`, `__pycache__/`, `*.pyc`;
`node_modules/` too, not for an agent's folder), unless it runs it (widget.json, its `script`, a `SCRIPT` or executable
its commands name, an executable: a data file a command cats isn't); git failing (not a repo): the same walk, hidden ones
left out, a link to a folder followed (and listed, as git does) while its realpath stays inside (a loop back to a folder
it's in skipped); `repoBad`: a file or link out of it (realpath)
or past `REPO_MAX` 2000 files is never trusted (`widgetSet` `on` refuses, a scan or `trusted` turns it off); `repoShown`
lists every file and the text of the ones it runs: named in a command, executable, or `SCRIPT` outside node_modules
(S10: a file cut at 3,000 characters, or past 12,000 in all, says *CUT, showing n of m characters*; `widgetWhat`'s
`cut` names them and `widgetSet` `on` refuses until each was opened whole, `widgetFull`, for the files as they are;
the ones it hashes but doesn't show are named under *Not shown here*);
the ones git ignores, `ignoredOf`, and its state),
and a scan that finds an on one with another hash calls `untrust` (off, `changed`, `stopStream`, `stopAgents`,
`ungrant`, a warn line and a `widget-say` `notify` naming the files whose `eachHash` differs, five at most). `inProj` keeps it to its project: `wsOf` (refused elsewhere), `ctxOf`, `instView`, `shownIn`, `widgetEvent`
(no workspace: `app.open` and `custom.*` only), `widgetGates`, `widgetTools` (`ws`: MCP's `ext_*` by
`$LAKI_WORKSPACE`; none: no repo's) and `widgetToolCall`. `repoSays` refuses `widgetRm`, `widgetWrite`,
`widgetFileSave` and a rename; Remix's id drops the project. `widgetNew` in a repo's folder writes no store (off) and
returns its `<project>.<id>`. The renderer: App's `ownWidgets` (every place but the Desk, whose `deskWidgets` name it
`· <project>`), `extOn` and RowMarks by the workspace's project, ⌘K's *Extension:* items; `repoSheet` in
`WidgetsApi.set` (on without `seen`: `widgetWhat`, its needed and secret settings, *Turn on in <project>*); Settings'
*From <project>* groups and a *changed* tag; the page's *From <project>'s .laki/extensions* tag, the changed banner
(*Look…*), Files read-only with Remix.

Making one with Laki AI (Extension.tsx' `ExtensionPage`, above; `WidgetsApi` `remix`,
`undo`, `tryOnce`): `Chat`'s first ask's id from `widgetSlug` (its first words less filler, `freeId`: no widget, folder
or chat of it), then `aiAsk` `chat: 'widget:<id>'`. The preview on its sample (widget.json's `sample` or a fixture),
never a fetch. `TrySheet` (`runsOf` over `widgetFiles`: the fetch, a script's text, the actions' commands, a JS page's
`net`): `widgetRun` `once` (an off one, Laki AI's too: one fetch, `manual`, the run's `why` says so; not a stream; not
a per-workspace one: turn it on, then look in a workspace), the preview on *Live* after it; or `widgetSet` `on` with
`seen` (its files as shown). `widgetWrite` snapshots the folder first
(`snapshot`: `<data>/widget-data/<id>.history/<ms>/`, `.none` when there was none, `HISTORY` 20; never its top-level
`node_modules` or `.git`, `KEPT`, which Undo leaves where they are), the view's `history`
(Laki's folder's only); `widgetUndo` (`after`: the first taken after then, a turn's *Undo to here*; none: the newest)
puts it back, drops it and newer, off; `gone` when it was the first. A user's own written in its `aiMay` hour keeps
`aiMay` (a write, a check, a fix). `widgetRemix` (`newId`, else `<id>-copy` slugged (a repo folder's `My_Ext.v2`: `my-ext-v2-copy`), `freeId`): the folder copied (a linked one's
target, `realpathSync`; no `.git`, `node_modules`; not a one-file one), its name `(copy)`, the store `{ on: false, aiMay }`:
yours (no secrets: they're by id). `widgetRm` (refused while it or an instance fetches; main.ts' `aiForget` once it's gone) moves the history and
the chat to the trash with it. Tested in `test/widget-studio.test.ts`.
