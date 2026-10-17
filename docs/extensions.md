# Laki extensions: the SDK

An extension (also called a widget or a plugin: one and the same) is a small live page in Laki: a count, a chart, a
table or a row of links, with a full view a click away. It is a folder with a `widget.json` (and a `widget.html` only
for a look of its own), and Laki does the rest: runs its fetch on a schedule, keeps what it printed, draws it with the
UI kit and shows it where you put it.

The quickest start: `laki widget new "Deploys" --kind list` (or Settings › Extensions › *New ▾*) makes one that runs at
once on sample data; change its fetch and its `ui` from there (below: *Starters*).

This page is the overview. The whole format, with every field and helper, is in Settings › Extensions › *New
extension* (*Copy the prompt*), in the *Extension creator* agent skill (Settings › Agent skill), and in
[`src/shared/widgetGuide.ts`](../src/shared/widgetGuide.ts), which both are made from. Two examples come with Laki,
in [`widgets/`](../widgets): `links` (a JS page, no fetch) and `my-prs` (a shell fetch with gh and jq, its `ui`, its
sample).

## How it works

```
widget.json ──▶ fetch (a shell command, or a JS script) ──stdout JSON──▶ <data>/widget-data/<id>.json
                 every N minutes, while the app is open                      { data, at, error, your settings }
                                                                                         │
widget.json's ui (the UI kit) ┐
widget.html ──▶ <template preview> / <template full>, filled with data and config ◀──────┘
                 no <script>: drawn in the app (sanitized) · a <script>: a sandboxed page (window.laki)
```

1. Laki finds extensions in `<data>/widgets/<id>/` (Laki's own folder), the folders you add in Settings › Extensions,
   then the ones it comes with. The first folder of an id wins. Each starts off: turn it on in Settings › Extensions.
2. While the app is open (and within *Working hours*, if set), each extension that is on runs its `fetch` every
   `every` minutes, and when it's turned on, when its settings change, on *Reload extensions* and on `laki widget run`.
3. What the fetch prints must be JSON: it is kept as `data`. A failure keeps the last data and shows a red dot with why.
4. The page is filled from `data`, `config` (your settings), `at` (the last fetch) and `error`: `widget.html`'s view
   when it has one, else `ui`'s.

## The files

| file | what |
|---|---|
| `widget.json` | `name`, `description`, `size` (cells across 1-3 × down ½-4), `every` (minutes), `view` (the full view: `s`, `m`, `l`), `place` (`side`, `top`, `status`, `rail`, `foot`), `config` (its settings), `fetch` (a shell command) or `script` (a JS file), `sample` (made-up data in the shape its fetch prints: needed with a fetch), `sampleConfig` (settings for that preview), `actions` (commands its buttons run), `ui` (what it shows, below), `scope` (`global`, the default, or `workspace`: [one per workspace](#per-workspace-scope)), `on` ([events](#events-on) it answers), `stream` ([a fetch that runs all along](#streams-stream)); as a button: `icon`, `label`, `badge`, `tip`, `click` |
| `widget.html` | optional: `<template preview>` (where it sits), `<template full>` (the dialog a click opens), shared `<style>` outside both; a view it has wins over `ui`'s |
| `fixtures/<name>.json` | sample data: its Data tab shows each (*Sample ▾*), and *Check* fits `ui` to each |
| anything else | the scripts its fetch and actions run, in any language: `sh fetch.sh`, `python3 fetch.py`, `fetch.mjs` |

### Settings (`config`)

Each setting is a default or `{ "type", "label", "hint", "default", "choices" }`, `type` one of `text`, `number`,
`bool`, `choice`, `list`. You fill them in Settings › Extensions; the fetch gets them as `$WIDGET_<NAME>` (text) and
`$LAKI_WIDGET_CONFIG` (all of them, typed, as JSON); a page or a script gets them typed as `config`.

### The fetch's environment

| variable | what |
|---|---|
| `$WIDGET_<NAME>` | each setting as text (an on/off `1` or empty, a list joined by commas) |
| `$LAKI_WIDGET_CONFIG` | all settings as JSON, typed |
| `$LAKI_WIDGET_FILE` | its storage file (the last `data`) |
| `$LAKI_CLI` | the `laki` command: `"$LAKI_CLI" ls --json` |
| `$WIDGET_ARG` | an action's argument (`data-arg`), never pasted into the command |

It runs in the extension's folder with your PATH (gh, jq, curl…), 2 minutes at most. A JS `script`'s default export
gets `{ config, last }` (a per-workspace one's `workspace` too) and returns the data.

## Per workspace (`scope`)

`"scope": "workspace"` makes an extension an instance in each workspace: what it shows in the sidebar, the bars and on
its button is the selected workspace's. Its settings are shared; each instance keeps its own data in
`<data>/widget-data/<id>/ws/<workspace>.json`. Its fetch and actions get that workspace's values (the agents'
`{{branch}}`…):

| variable | what |
|---|---|
| `$LAKI_WORKSPACE`, `$LAKI_WORKSPACE_NAME` | its id and name |
| `$LAKI_PROJECT`, `$LAKI_BRANCH`, `$LAKI_BASE` | its project's name, its branch, the branch it came off |
| `$LAKI_PATH`, `$PORT` | its folder, its `$PORT` |
| `$LAKI_PR` | its PR's URL, if it has one |
| `$LAKI_STORAGE_FOLDER` | its storage folder, once it has one |

Templates, `ui` and a JS page (`laki.workspace`) see it as `workspace`: `{{workspace.branch}}`, `{{workspace.port}}`,
`id`, `name`, `project`, `base`, `path`, `pr`, `storage`. A preview with its sample gets a made-up one.

- It fetches only where it shows: the workspace selected in a window that's open, every `every` minutes, and at once
  as you select a workspace whose data is older than that. Others wait until they're selected; four of one extension
  fetch at a time.
- With no workspace on screen (the Board, Scheduled tasks, the AI page) it says *Select a workspace* and its buttons
  are dimmed. Terminals, Browsers and workspaces on an SSH host have none.
- Its data goes with its workspace: deleted with it, kept while it's archived and shown again as it's restored.
- `laki widget run|render|action|check <id> --ws <workspace>` name the instance (a global one refuses `--ws`); its
  inspector has a workspace picker. *Check* warns when a per-workspace one uses nothing of the workspace.
- The `workspace` starter (*This branch*) shows the branch, PR, port and path, and links to `http://localhost:$PORT`.

## Events (`on`)

`"on": { "<event>": "<action>" | "refresh" }` answers what happens in Laki: as it happens, an extension that's on runs
that action, or fetches again (`refresh`). The handler gets `$LAKI_EVENT` (its name), the event as JSON on stdin and in
`$LAKI_EVENT_FILE` (deleted after), and `$LAKI_REFRESH_REASON` `event:<name>`. A per-workspace one gets its own
workspace's events only, in that instance; a global one gets every event once. One handler runs at a time per
extension, 20 wait at most (past that the oldest is dropped); each is a run in its inspector.

```json
{ "on": { "turn.done": "note", "pr.checks.failed": "refresh" },
  "actions": { "note": "jq -r '.last' > last.txt; echo '{\"toast\": \"Done\"}'" } }
```

Each event is `{ event, at, ws: { id, name, project, branch, pr }, tab: { id, name, agent } }` (the workspace and tab
when it has them) and its own fields, 64 KB at most:

| event | when | its fields |
|---|---|---|
| `turn.done` | an agent's turn ends | `last` (its answer, 4,000 characters), `seconds` |
| `turn.failed` | a turn fails, or hits a usage limit | `error`, `limit` (when it resets) |
| `turn.waiting` | an agent asks something | `question`, `options` (its menu's) |
| `pr.opened` | a workspace gets a PR | `pr: { number, url, title, draft }` |
| `pr.checks.failed` | checks fail on a head commit (once per commit) | `pr`, `failing: [{ name, url }]` |
| `pr.checks.passed` | all checks pass on a head commit (once per commit) | `pr` |
| `pr.review` | a new approval or request for changes | `pr`, `approved`, `changes` (logins) |
| `pr.merged`, `pr.closed` | as named | `pr` |
| `workspace.new` | a workspace is made | `prompt` (2,000 characters), `agent` |
| `workspace.archived`, `workspace.restored`, `workspace.removed` | as named | |
| `schedule.ran` | a scheduled task ran or failed | `task: { id, name }`, `ok`, `what` |
| `app.open` | Laki's window comes back | |

PR events come from Laki's PR scans: the first scan after the daemon starts only notes where each PR is, so a restart
replays nothing. What an action prints can set the data (below); its `toast` or `modal` shows in the app while its
window is open.

### An action's data

An action (a button's, or an event's) that prints JSON with `"data"` replaces the extension's data (a per-workspace
one's instance's) instead of fetching again: `{"data": {"count": 3}, "toast": "Saved"}`. With `"merge": true` it goes
over the data it had, key by key.

## Streams (`stream`)

`"stream": true` runs its fetch all along instead of every few minutes: each line of JSON it prints is its data at once
(the view follows within ¼ s, its store every 5 s); other lines go to its log. A JS `script` streams with an async
generator (`export default async function* ({ config }) { … yield data … }`).

- It runs while it's on and Laki's window was shown in the last 10 minutes (and within *Working hours*); it stops when
  it's turned off, reloaded or deleted, and as Laki quits. Settings › Resources lists it, with a Stop (until *Run now*,
  its switch or a reload).
- After it ends, it starts again 1, 2, 4… up to 60 seconds later (1 again once it ran a minute). Its inspector's Runs
  says since when it runs, how many restarts, and its last line.
- Global only (not with `"scope": "workspace"`); `every` is ignored. The `stream` starter prints a line every 2 s.

```sh
#!/bin/sh
tail -F /var/log/deploy.log | jq -c --unbuffered '{last: .message, at: .time}'
```

## Push (`laki widget push`)

Something else can put the data there, with no fetch: a cron job, a git hook, CI on this Mac, another app (as
Übersicht's and SwiftBar's refreshes do).

```sh
laki widget push deploys '{"last": "v1.4.2", "ok": true}'   # its data now
echo '{"ok": false}' | laki widget push deploys - --merge   # over what it has, key by key
laki widget push this-branch '{"tests": "green"}' --ws fix-login
```

An extension that's off refuses it. A git hook that counts today's commits in an extension of yours
(`.git/hooks/post-commit`, made executable):

```sh
#!/bin/sh
laki widget push commits "{\"today\": $(git log --since=midnight --oneline | wc -l)}" >/dev/null 2>&1 || true
```

## Tools for agents (an action's `tool`)

An action can be a tool your agents call: a deploy, a ticket, a note, a query. Give it a `tool` with what it does and
its input; `run` is its command, as a plain action's string is:

```json
"actions": {
  "preview": {
    "run": "./deploy.sh --preview",
    "tool": {
      "description": "Deploy this workspace's branch to a preview URL",
      "input": { "service": { "type": "string", "enum": ["web", "api"], "description": "which app" }, "dry": "boolean" },
      "required": ["service"],
      "ask": "first"
    }
  }
}
```

- `input`: each field `string`, `number`, `boolean` or `string[]` (or `{ "type", "description", "enum" }`); checked
  before anything runs, then given as `$WIDGET_INPUT_<NAME>` (a list joined by commas, `true` or empty) and all of it
  as JSON on stdin. What the command prints goes back to the agent; a failure gives its output and stderr's last line.
- `ask`: `first` (the default) asks you once per workspace (*Always in …* in the dialog; Settings › Extensions lists
  each grant with *Revoke*), `always` every call, `never` not at all (the checker warns when its command looks outward:
  a push, a merge, a deploy). Laki's window must be open to ask; no answer in 2 minutes refuses it. Turning the
  extension off, or changing its commands, takes the grants back.
- `AGENTS.md` in its folder says when to use its tools (4 KB at most); agents see it with the list.
- Agents get them through `laki widget tools` (the list) and `laki widget tool <id> <action> '<json>'` (a call, in
  their workspace), and in MCP as `ext_<id>_<action>` tools (with `laki_extension_tools` and `laki_extension_call`);
  Laki AI calls them too. A per-workspace one runs in the caller's workspace. Only extensions that are on have tools.
- Each call is a run (reason `tool:<action>`, who called it and how it was allowed) in its page's Runs.

The *A tool for agents* starter (`laki widget new Notes --kind tool`) is one: an `add` tool that keeps notes you see.

## The UI kit (`ui`)

The quickest way to draw one: `widget.json`'s `"ui"`, elements as JSON that follow the app's theme and fit any size
(1-3 cells across, the ½-high bars: a single line). Every element with its sample, at each size, and its JSON to
copy: Settings › Extensions › *UI kit*, or `laki widget kit [element] [--json]` in a terminal.

`ui` is one element (the preview and the full view alike; the full view shows every row) or `{ "preview": …, "full": … }`.
An element is `{ "type": "<name>", …props }`, and each also takes `if` / `unless` (a path or a template: shown when
truthy / falsy; an empty list is false), `each` (repeat it per item of a list), `tip` (a tooltip) and `tone` (`good`,
`bad`, `warn`, `accent`, `muted`, or a map from its text to one: `{ "failed": "bad", "live": "good" }`).

| group | elements |
|---|---|
| Layout | `stack` (`children`, `gap` sm/md/lg), `row` (`align` start/center/end/between, `wrap`), `grid` (`columns` 1-6, fewer as it narrows), `section` (`title`, `subtitle`, `collapsed`), `tabs` (`tabs: [{ label, badge, children }]`), `divider` |
| Text | `text` (`value`, `size` sm-xl, `weight`, `mono`, `muted`, `wrap`), `heading` (`level` 1-3), `markdown`, `code` (`copy`) |
| Data | `stat` (`value`, `label`, `delta`, `spark`, `icon`), `stats`, `kv`, `list`, `table`, `chart` (`kind` line/area/bars, `x`, `y`, `series`, `min`, `max`, `unit`), `spark`, `progress` (`style` bar/ring), `tags`, `badge`, `timeline`, `image` |
| Actions | `button` (`run` + `arg`, `open`, `refresh`, `full` or `copy`; `confirm`; `style` primary/quiet/danger), `actions`, `links`, `form` (`fields`, `submit`: the action gets the fields' JSON as `$WIDGET_ARG`), `empty` (`text`, `icon`, `action`) |

A `list` row has `title`, `subtitle`, `icon`, `avatar` (a GitHub login), `href`, `accessories` (`[{ tag | text | badge
| icon | avatar | ago | date, tone }]`), `actions`, and the list `limit` (the preview: as many as fit, then *+N more*),
`filter` (a box in the full view), `group` (headings by a field) and `empty`. A `table` has `columns` (`title`, `value`,
`tag`, `tone`, `align`, `mono`, `width`, `wrap`, `hide: "narrow"`) and `sort` (`"age desc"`).

**Binding.** Strings are templates over `{ …data, data, config, at, error, full }`: `{{open}}` is `{{data.open}}`.
Inside `each` the scope is the item (and `this`, `@index`). A path prop (`each`, `items`, `values`, `group`) is looked
up as is. With an error and no data, the kit shows the error and *Retry*; a template that fails in one element shows
a small chip there, the rest draws.

```json
{
  "name": "Deploys", "every": 5, "size": [3, 2], "fetch": "sh fetch.sh",
  "ui": {
    "preview": { "type": "stats", "items": [{ "value": "{{today}}", "label": "today" }, { "value": "{{failed}}", "label": "failed", "tone": "bad", "if": "failed" }] },
    "full": { "type": "list", "each": "deploys", "title": "{{name}}", "subtitle": "{{ago at}} by {{who}}", "href": "{{url}}",
      "accessories": [{ "tag": "{{state}}", "tone": { "failed": "bad", "live": "good" } }],
      "actions": [{ "label": "Roll back", "run": "rollback", "arg": "{{id}}", "confirm": "Roll back {{name}}?" }] }
  },
  "actions": { "rollback": "sh rollback.sh \"$WIDGET_ARG\"" },
  "sample": { "today": 4, "failed": 1, "deploys": [{ "id": 7, "name": "web", "at": "2026-10-17T08:00:00Z", "who": "octocat", "state": "live", "url": "https://example.com/7" }] }
}
```

A JS page gets the kit too: `await laki.ui(spec, data)` gives its HTML, `await laki.mount(el, spec, data)` puts it in
`el` with its buttons, links, filters and tabs working.

## widget.html: a look of its own

### Templates

`{{a.b}}` (escaped), `{{#each list}}…{{else}}…{{/each}}`, `{{#if x}}…{{/if}}`, `{{#unless x}}…{{/unless}}`, `{{date x}}`,
`{{ago x}}`, `{{num x}}` (1.2k), `{{pct x}}` (42%), `{{bytes x}}`, `{{dur ms}}` (2m 3s), `{{upper x}}`, `{{lower x}}`,
`{{spark list}}` (a line chart); `ui`'s strings take them too. Ready-made classes follow the app's theme: `tile`, `num`, `label`, `muted`,
`tag`, `badge`, `row`, `list`, `linkbar`, `primary`… and the theme's colors as `var(--accent)`, `var(--error)`, `var(--done)`.

### Buttons and actions

`<button data-run="review" data-arg="{{url}}">` runs `actions.review` with `$WIDGET_ARG`; then the extension fetches
again. What the action prints as JSON can say more: `{"data": …}` ([its data](#an-actions-data), no fetch then), `{"toast": "Done"}`, or `{"modal": {"title", "text", "buttons"}}`
(up to 4 buttons, each `run`ning another action, `open`ing an http(s), mailto or `laki://` link, or closing).
`data-laki="refresh"` fetches again.

### JS pages (`window.laki`)

A `widget.html` with a `<script>` is a JS extension: a page of its own in a sandboxed frame, with:

| `window.laki.` | what |
|---|---|
| `data`, `config`, `at`, `error`, `full` | what a template sees |
| `workspace` | a per-workspace one's workspace (`branch`, `port`…) |
| `refresh()` | fetch again |
| `open(url)` | a link, in the browser |
| `expand()` | the full view |
| `run(action, arg)` | one of its actions |
| `toast(text)`, `modal({ title, text, buttons })` | as an action's JSON |
| `ui(spec, data?)`, `mount(el, spec, data?)` | the UI kit's HTML for an element, or put in `el` (both promises) |

These work right after a click in the page. By default the page has no network: everything inline, its data from its
fetch. **Network access** (a switch per extension in Settings › Extensions, off until you turn it on) lets its page
`fetch()` from and show images of https sites (CORS applies: the page's origin is `null`). It never reaches the app or
the daemon either way.

## Where it shows (`place`)

| place | where | size |
|---|---|---|
| `side` (default) | the sidebar's grid, above its buttons | its cells across × down |
| `top` | the top bar, left of its buttons | a line high, its cells across wide |
| `status` | the status bar's right end (a Browsers page has none) | a line high, its cells across wide |
| `rail` | a button among the rail's icons (no rail: the sidebar's foot) | a button |
| `foot` | a button in the sidebar's foot, beside Video, Meme and Timer | a button |
| `desk` | a tile on the Desk page (experimental), sized there | its full view, else its preview |

`widget.json`'s `place` is where it starts; the user moves it in its settings (Settings › Extensions › the extension ›
*Sidebar / Top bar / Status bar / Rail / Sidebar foot / Desk*, one or several). For the bars, design it ½ high: a number and a word, a few links.

## Its preview with made-up data (`sample`)

Every extension shows how it looks before it ever runs: its page (Settings › Extensions › the extension) has *Live* and
*Sample*, and a Desk tile Laki AI just made shows its sample until it's turned on. `sample` is what its fetch would
print (the same shape, realistic values), `sampleConfig` the settings to show it with; templates get `sample: true`
meanwhile, and its links and buttons do nothing. Laki AI's `laki_extension_write` refuses a fetch without a sample.

```json
{ "name": "Open issues", "fetch": "sh fetch.sh", "every": 10,
  "sample": { "open": 12, "issues": [{ "title": "Login fails on Safari", "age": "2d" }] },
  "sampleConfig": { "repo": "acme/web" } }
```

## Buttons

On the rail and in the foot an extension is a button, and so is one with no preview in `widget.html` (or no
`widget.html`) wherever it sits: an icon, a label and a badge, kept up to date by its fetch in the background, and a
click that does something.

| field | what |
|---|---|
| `icon` | one of Laki's icons by name (`pr`, `github`, `bell`, `clock`, `board`, `globe`, `check`, `refresh`, `bulb`, `timer`, `terminal`, `link`, `file`, `folder`…), or an emoji; none: its name's first letter |
| `label` | its words, a template over its data: `"{{open}} open"`; none: its name |
| `badge` | a short count on the icon: `"{{#if failing}}{{failing}}{{/if}}"`; empty: none |
| `tip` | its tooltip, a template too; none: its name |
| `click` | one of its `actions`, run on a click (its toast or dialog as any action's), then it fetches again; none: its full view, else a fetch now |

```json
{
  "name": "My PRs",
  "place": "rail",
  "icon": "pr",
  "label": "PRs",
  "badge": "{{#if open}}{{open}}{{/if}}",
  "every": 5,
  "fetch": "gh search prs --author @me --state open --json number --jq '{open: length}'",
  "click": "github",
  "actions": { "github": "open https://github.com/pulls" }
}
```

## Starters

```sh
laki widget new "Deploys" --kind table          # in Laki's folder (<data>/widgets/deploys), on, fetched
laki widget new "Deploys" --dir ~/code/deploys  # a folder of yours (empty or new): then laki widget dev there
```

| kind | what |
|---|---|
| `number` | a count with its label, a change and a sparkline |
| `list` | rows with avatars, tags and a button each; grouped, filtered, *+N more* |
| `table` | columns, sorted, a filter box; columns that hide when narrow |
| `chart` | a line, area or bars from a list of numbers |
| `button` | an icon on the rail with a count; a click runs its action |
| `form` | fields and a button: an action gets them as JSON |
| `panel` | a JS page of yours that draws with the UI kit (`laki.mount`), typed by `laki.d.ts` |
| `workspace` | *This branch*: per workspace, its branch, PR, port and path, a link to its server |
| `stream` | a command that runs all along: a line of JSON every 2 s, shown as it comes |
| `tool` | *A tool for agents*: notes your agents add with its `add` tool (asked once per workspace), a Clear button |
| `onefile` | one script, `<id>.5m.sh` (below) |

Each runs at once with no network: its `fetch.sh` prints `fixtures/sample.json`, with a real one (gh, curl) in its
comments to swap in; `fixtures/empty.json` beside it (its Data tab's *Sample ▾* shows either). It has a `README.md`
with the next steps, and `"$schema"`, so VS Code and Cursor complete and check its `widget.json`
([`docs/widget.schema.json`](widget.schema.json), written from `src/shared/widgetSchema.ts` by
`node --experimental-strip-types scripts/widget-schema.ts`). The id comes from the name, made unique. It's yours: on.

## Check

```sh
laki widget check deploys        # by its id, or a folder (laki widget check . in it); --no-run: without its fetch
```

```
! widget.json: no key plcae (did you mean place?)
✗ widget.json click: go isn't one of its actions
! sample · ui (list): title uses titel, which no item of prs has (did you mean title?)
✓ fetch: printed 412 B of JSON in 38 ms
```

It reads `widget.json` (unknown keys, the kinds of its fields, `place`, `size`, `every`, `view`, `config`'s specs and
choices, `click`, `script` in the folder, `fetch` or `script`), each template of `widget.html` and `ui`, then `ui`
(unknown elements and props, a `run` that names no action, icons) against its `sample` and each `fixtures/*.json` (each
`each` a list, the fields its rows use in at least one item, a chart's numbers), and runs its fetch once (as *Fetch
now*), checking `ui` against what it printed. ✗ is an error (it exits 1), ! a hint. One Laki AI wrote isn't run while
it's off. Its page's *Check* tab shows the same; Laki AI and agents (`laki_extension_check`) check without the fetch.

## One file

A script named `<id>.<n><m|h>.<ext>` (`prs.5m.sh`, `cpu.1h.py`), executable or with a `#!` line, in Laki's folder, a
folder you added, or linked with `laki widget dev`, is a whole extension: its name gives its id and how often it runs,
what it prints (JSON) is its data, and comment lines give the rest of widget.json:

```sh
#!/bin/sh
# <laki.name>Open PRs</laki.name>
# <laki.place>status</laki.place>
# <laki.size>2x1</laki.size>
# <laki.label>{{n}} open</laki.label>
# <laki.var>text(REPO="acme/web"): Repo</laki.var>
# <laki.ui>{"type": "stat", "value": "{{n}}", "label": "open PRs"}</laki.ui>
# <laki.sample>{"n": 3}</laki.sample>
gh pr list -R "$WIDGET_REPO" --json number --jq '{n: length}'
```

Tags: `name`, `description`, `place` (one or a comma list), `icon`, `label`, `badge`, `tip`, `size`, `ui` and `sample`
(a line of JSON each), and settings as `<laki.var>type(NAME="default"): Label</laki.var>` (`text`, `number`, `bool`,
`choice(a,b)`), given as `$WIDGET_NAME`. Seconds (`.30s.`) are refused: at most once a minute. Renaming the file changes
its id (its settings stay under the old one: *Check* says so).

## Dev mode

```sh
cd ~/code/deploys && laki widget dev      # link it: on, watched; then a line per run until Ctrl-C (the link stays)
laki widget dev --list                    # the linked folders
laki widget dev --off deploys             # unlink it (by its id or its folder)
```

A linked folder (a widget's own, or a folder of them; kept in Settings as `widgetDev`) is read **first**, so your copy
replaces an installed one of the same id while it's linked, and is turned on. Each save (300 ms after the last; not
`node_modules`, `.git` or dotfiles) reads it again and fetches it (`$LAKI_REFRESH_REASON` is `dev`). A `widget.json`
that doesn't parse, or a template of `widget.html` or `ui` that doesn't read, keeps the last good version running: its
page and its tooltip say *Last good version kept* and why, until you fix it. Its log is kept with dev mode off too.

Every fetch and action is recorded (the last 20): when, why (`$LAKI_REFRESH_REASON`: `schedule`, `open`, `settings`,
`manual`, `reload`, `dev` or `action:<name>`), how long, how much it printed, its stderr's last lines and exit code.
Its page's tabs show them:

| tab | what |
|---|---|
| Overview | its preview where it sits, everywhere else (any sidebar size, the bars, as a button), its full view and settings |
| Data | its last data as JSON: edit it and *Apply*, or pick one of its `fixtures/<name>.json` (*Sample ▾*), to see it with that data; *Live* fetches again |
| Runs | the runs, newest first; a click shows one's stderr |
| Env | what its fetch gets (`WIDGET_*`, `LAKI_*`, `PATH`); a setting named like a token, secret, key or password masked |
| Files | its folder's files, and *Open folder* |
| Check | *Check* above: *Check again*, *Check with a fetch* |

Data put there by hand shows a *Sample data* chip wherever the extension is, and its schedule doesn't fetch over it.
A right click on an extension › *Inspect*, or `laki://settings/widgets/<id>/inspect`, opens the Data tab.

## Managing them

- Settings › Extensions: each one's switch; a click opens its page: the preview (live or with its sample), its place,
  size, how often it fetches, its full view's size, its settings, *Network access* for a JS page, its folder, *Delete*
  (its folder and settings, for good, after a confirm; the ones that come with Laki only turn off), and Laki AI's chat
  to change it. *New ▾* (in *Yours*) makes one from a starter (its page opens on Data), or with Laki AI, or gives you
  the prompt for any AI chat. Search
  for *plugin* finds it too.
- The Desk's *Build with AI*: Laki AI makes one for the Desk in its floating chat; it shows as a tile at once, with its
  sample, off until you turn it on.
- The CLI: `laki widget [ls]`, `laki widget reload`, `laki widget on|off|run <id>`, `laki widget render <id> [--full]`,
  `laki widget action <id> <action> [arg]`, `laki widget new <name> [--kind <k>] [--dir <folder>]`, `laki widget check
  [id|folder] [--no-run]`, `laki widget kit [element]`, `laki widget dev [folder]`.
- Laki AI and `laki mcp` (`laki_extensions`, `laki_extension_guide`, `laki_extension_read`, `laki_extension_write`,
  `laki_extension_check`; `fixtures/<name>.json` is the one folder they may write):
  they make or change extensions in Laki's own folder, saved off: its fetch runs commands, so you look, then turn it on.
  They never delete one.

## Safety

- A fetch and an action are shell commands on your Mac, like a script you run: only turn on what you trust. One that
  Laki AI wrote is saved off and tagged *by Laki AI*.
- An agent's tool call shows you the command and its input before it runs, unless the tool says `never` or you chose
  *Always* in that workspace.
- A template extension is sanitized (no scripts, frames, forms, `on…` attributes, or links other than http(s) and
  mailto). A JS one runs in a sandboxed frame with an opaque origin, `default-src 'none'`, and only the network you allow.
- Its settings are kept in `<data>/widget-data/<id>.json`, next to its last data.
