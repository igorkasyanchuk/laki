# Laki extensions: the SDK

An extension (also called a widget or a plugin: one and the same) is a small live page in Laki: a count, a chart, a
table or a row of links, with a full view a click away. It is a folder with a `widget.json` (and a `widget.html` only
for a look of its own), and Laki does the rest: runs its fetch on a schedule, keeps what it printed, draws it with the
UI kit and shows it where you put it.

The quickest start: `laki widget new "Deploys" --kind list` (or Settings › Extensions › *New ▾*) makes one that runs at
once on sample data; change its fetch and its `ui` from there (below: *Starters*).

This page is the overview. The whole format, with every field and helper, is in Settings › Extensions › *New ▾ ›
With Laki AI…* while Laki AI is off (*Copy the prompt*), in the *Extension creator* agent skill (Settings › Agent skill), and in
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
   One that keeps failing waits longer each time: twice `every`, then 4 and 8 times, until a fetch works. An agent's
   source runs at most every `every` minutes whatever asks (*Run now* anyway): each run costs.
3. What the fetch prints must be JSON: it is kept as `data`. A failure keeps the last data and shows a red dot with why.
   Or its data comes from [somewhere else](#where-its-data-comes-from-source): a text you type, a file, a URL, or an
   agent with your MCP servers (Slack, Linear…) that sums it up.
4. The page is filled from `data`, `config` (your settings), `at` (the last fetch) and `error`: `widget.html`'s view
   when it has one, else `ui`'s. The data's own fields are at the top too (`{{count}}`), but for the names Laki's own
   take: `at`, `error`, `config`, `full`, `data`, `workspace` and `sample`. A field of yours named so is hidden: name it
   otherwise, or read it as `data.at`; *Check* warns at one in the sample, a fixture or what it fetched.

## The files

| file | what |
|---|---|
| `widget.json` | `name`, `description`, `size` (cells across 1-4 × down ½-4), `every` (minutes), `view` (the full view: `s`, `m`, `l`), `place` (`side`, `top`, `status`, `rail`, `foot`, `desk`; a list for several), `config` (its settings), `fetch` (a shell command) or `script` (a JS file), `sample` (made-up data in the shape its fetch prints: needed with a fetch), `sampleConfig` (settings for that preview), `actions` (commands its buttons run), `ui` (what it shows, below), `scope` (`global`, the default, or `workspace`: [one per workspace](#per-workspace-scope)), `on` ([events](#events-on) it answers), `stream` ([a fetch that runs all along](#streams-stream)); as a button: `icon`, `label`, `badge`, `tip`, `click` |
| `widget.html` | optional: `<template preview>` (where it sits), `<template full>` (the dialog a click opens), shared `<style>` outside both; a view it has wins over `ui`'s |
| `fixtures/<name>.json` | sample data (`sample.json`, `empty.json`, and a few more: busy, all good, an odd one): its preview's *Sample* picks one, its Data tab lists them, and *Check* fits `ui` to each |
| anything else | the scripts its fetch and actions run, in any language: `sh fetch.sh`, `python3 fetch.py`, `fetch.mjs` |

### Where its data comes from (`source`)

Each extension's card (Settings › Extensions, its page) has *Data*: pick where its data comes from. `widget.json`'s
`source` is the first pick.

| source | what |
|---|---|
| *Own script* (`{ "kind": "fetch" }`) | its `fetch` command or `script`, every `every` minutes (the default, when it has one) |
| *Static* (`{ "kind": "static", "text": "…" }`) | a text you type there (64 KB): JSON is its data, anything else `{ "text" }`; shown at once, never fetched |
| *File* (`{ "kind": "file", "path": "~/notes/today.md" }`) | a file of this Mac, read every `every` minutes (16 MB); relative: the extension's folder |
| *URL* (`{ "kind": "url", "url": "https://…" }`) | an http(s) address, read every `every` minutes (30 s, 16 MB): a public JSON API needs no fetch |
| *AI* (`{ "kind": "ai", "prompt": "…", "tools": "mcp__slack" }`) | an agent finds it and sums it up, every hour unless `every` says (15 minutes at least: each run costs; 10 minutes a run) |

An AI source runs Settings › Extensions' *Agent profile* (a claude or codex profile of Agents & profiles: its model,
effort, account and env; `"profile"` names another) with your own config, so your MCP servers come along: *"What's new
in #eng on Slack since yesterday: decisions, questions for me, links"*, with `"tools": "mcp__slack"`, is a summary to
read over coffee. Claude may use the tools named in `tools` unasked (comma-separated: `mcp__slack, WebFetch,
Bash(gh pr list:*)`); for any other, Laki asks you (a dialog and a notification): *Allow once*, *Always* (its page
lists them, with Revoke) or *Deny*, and it goes on without it. A server's tools are `mcp__<server>` as claude names it:
a claude.ai connector's are `mcp__claude_ai_<Name>` (`mcp__claude_ai_Slack`). Codex runs in its read-only sandbox. Its prompt may name settings and the
workspace, like a path. The agent is told to change nothing and to end its answer with the data as a json block in the
shape of `sample` (no sample: `{ "text" }` in Markdown, for a `markdown` element); its last json block is the data, an
answer without one `{ "text" }`. Each run is in Laki AI's Calls (Settings › AI) with its cost; `laki widget check` doesn't
run it. A run at work has a Stop on its page (and in Settings › Resources); turning it off, a new source or deleting it
stops it too, and a stopped run keeps the last data.

A file's or URL's JSON is its data; anything else (Markdown, plain text) is `{ "text": "…" }`, which a `markdown`
element shows (`{ "type": "markdown", "value": "{{text}}" }`: the *note* starter). A path or URL may name settings and
the workspace: `{{config.repo}}`, `{{workspace.path}}/TODO.md`. A failed read keeps the last data, as a fetch does.

### Settings (`config`)

Each setting is a default or `{ "type", "label", "hint", "default", "choices", "required" }`, `type` one of `text`, `number`,
`bool`, `choice`, `list`, `secret`. You fill them in Settings › Extensions; the fetch gets them as `$WIDGET_<NAME>` (text) and
`$LAKI_WIDGET_CONFIG` (all of them, typed, as JSON); a page or a script gets them typed as `config`.
`"required": true` is one it can't do without (My PRs' *Repo*): while it's empty its cell says *Set Repo*, and turning
it on opens its page at that field. Its fetch should still fail with a line that says where (`Set Repo in Settings ›
Extensions › My PRs`).

#### Secrets

A token or a key is a `secret`: `"apiToken": { "type": "secret", "label": "API token" }`. Settings shows a password
box (*Set: type to replace* once it has one, and *Clear*). Laki keeps it in `<data>/widget-secrets.json` (0600), not
with the other settings: only its fetch and its actions get it (`$WIDGET_APITOKEN`, `$LAKI_WIDGET_CONFIG`), and a
`script`'s `config`. Its page, templates, `ui`, the app, `laki ls --json` and MCP see it empty; the inspector's Env
shows `••••`. A remix starts without it. A setting called `token`, `key`, `secret` or `password` kept as `text` gets
the checker's warning; a value saved before it became a secret moves to the secrets file.

### The fetch's environment

| variable | what |
|---|---|
| `$WIDGET_<NAME>` | each setting as text (an on/off `1` or empty, a list joined by commas) |
| `$LAKI_WIDGET_CONFIG` | all settings as JSON, typed |
| `$LAKI_WIDGET_FILE` | its storage file (the last `data`) |
| `$LAKI_CLI` | the `laki` command: `"$LAKI_CLI" ls --json` |
| `$WIDGET_ARG` | an action's argument (`data-arg`), never pasted into the command |

It runs in the extension's folder with your PATH (gh, jq, curl…), 2 minutes at most, as a process group of its own: at
the time limit, or a Stop, what it started goes too (a `sleep`, `npm run`, a server). A JS `script`'s default export
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
| `ship.done` | a workspace's Ship ends | `ok`, `exit` (its code), `pr: { url, number }` when there is one by then |
| `flow.ended` | a workflow's run ends | `run`, `workflow: { id, name }`, `status`, `why` |
| `limit.hit` | an agent hits a usage limit (once per limit) | `agent`, `until` (ms) |
| `tab.new` | a tab is opened (not the ones brought back as Laki starts) | `kind` (agent, shell, dev, script, ship) |
| `port.open` | a port starts listening in a workspace (once each time) | `port`, `pid`, `command`, `name` (`.laki.json`'s `ports`) |
| `gate.held` | a [gate](#gates-an-actions-gate) held a ship, a merge or an archive | `gate`, `widget`, `why` |
| `custom.<name>` | `laki widget emit <name>` (below) | `data`, `from: { widget, tab, agent }` |

PR events come from Laki's PR scans: the first scan after the daemon starts only notes where each PR is, so a restart
replays nothing; so do ports a tab brought back at start listens on in its first minute. `laki widget events` lists
the last 50 events, and which extensions and workflows each reached (or why a workflow didn't start).

### Events of your own (`laki widget emit`)

`laki widget emit deploy.done '{"sha": "abc"}' [--ws <id>]` (or the JSON on stdin with `-`; MCP's
`laki_extension_emit`) sends `custom.deploy.done` with that `data` (64 KB at most; a name of letters, digits, `.`, `_`,
`-`). `"on": { "custom.deploy.done": "refresh" }` answers it, `"custom.*"` every custom event. From an extension's own
command (`"$LAKI_CLI" widget emit …`) `from.widget` says which, and it never gets its own; an agent's says
`from.agent`. An agent's event (Laki AI's too) only fetches: a handler that's an action doesn't run for it (its log and
`laki widget events` say so), and what an extension emits while handling one (`$LAKI_EVENT_AGENT`) counts as the
agent's. An emit made while handling an event is a hop more: past 3 hops it's dropped, and said in its log.

A workflow can start on any of these (`on: custom.deploy.done` in its head): see the guide's Workflows. What an action prints can set the data (below); its `toast` or `modal` shows in the app while its
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

## Gates (an action's `gate`)

An action can hold a step: before Laki ships, merges or archives a workspace, each gate for that step runs, and any
that says no holds it, with its reason.

```json
{ "actions": { "tests": { "run": "./check.sh", "gate": ["ship", "merge"] } } }
```

- It gets `{ gate, ws, pr, stat, by }` on stdin and in `$LAKI_EVENT_FILE` (`pr`: number, url, title, state, checks,
  review, or null; `stat`: add, del, files, or null; `by`: you, agent, auto (Merge when green, archive on merge) or
  workflow), `$LAKI_GATE` the step, and the workspace's env (`$LAKI_WORKSPACE`, `$LAKI_BRANCH`, `$LAKI_PATH`…).
- It prints `{"ok": true}`, or `{"ok": false, "why": "the tests fail", "fix": "Make the tests pass"}` (`fix`: a prompt
  for the agent, optional).
- Gates run together, 8 at most for a step, 30 s each, only while the extension is on; a per-workspace one with its
  workspace's instance. A command action only: an agent's action can't be one (each run costs, and it's slow).
- **An error or no answer within 30 s:** the step goes ahead, and Laki says so (a toast, a line in its log). A gate
  that should block on its own error prints `ok: false` itself. Merge when green and archive on merge, which nobody
  watches, are held instead.
- **Held:** the app says *Not shipped* (*Not merged*, *Not archived*), a line per gate, with *Do it anyway* (asked
  first) and, when a gate gave a `fix` and the workspace has an agent, *Ask the agent to fix it*. `laki ship` prints the
  reasons and exits 1; `--force` does it anyway. Doing it anyway is yours only: an agent's is refused.
- Merge when green held: over to you once per head commit, tried again after a push or once the gate's extension
  changes. Archive on merge held: skipped, and said in the workspace's log. A workflow's action block takes its error
  way, the reasons as `{{steps.<id>.output}}`. Each hold sends `gate.held`.
- Not gated: deleting a workspace, and archived workspaces' clean-up.

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
  a push, a merge, a deploy). Laki's window must be open to ask; no answer in 2 minutes refuses it. *Always* is for
  that command and the extension's files as they are: an edit (even while Laki is closed) asks again. A file changed
  while you're asked isn't run, and no *Always* is kept. Turning the extension off, or changing its commands, takes
  the grants back.
- `AGENTS.md` in its folder says when to use its tools (4 KB at most); agents see it with the list.
- Agents get them through `laki widget tools` (the list) and `laki widget tool <id> <action> '<json>'` (a call, in
  their workspace), and in MCP as `ext_<id>_<action>` tools (with `laki_extension_tools` and `laki_extension_call`);
  Laki AI calls them too. A per-workspace one runs in the caller's workspace. Only extensions that are on have tools.
- An agent can't go around the ask: `laki widget action` run in an agent's tab goes through the tool's ask (any other
  action asks you each time, no *Always*), `laki widget on` from one is refused (only you turn an extension on), and
  `laki widget dev` from one links the folder but leaves its extensions off.
- Each call is a run (reason `tool:<action>`, who called it and how it was allowed) in its page's Runs.

The *A tool for agents* starter (`laki widget new Notes --kind tool`) is one: an `add` tool that keeps notes you see.

## The UI kit (`ui`)

The quickest way to draw one: `widget.json`'s `"ui"`, elements as JSON that follow the app's theme and fit any size
(1-4 cells across, the ½-high bars: a single line). Every element with its sample, at each size, and its JSON to
copy: Settings › Extensions › *UI kit*, or `laki widget kit [element] [--json]` in a terminal. Every icon an
`icon` can name (Laki's own and 252 generic ones: arrows, files, messages, people, media, devices, weather, money,
time, places, tools, shapes), found by name or group, a click to copy it: Settings › Extensions › *Icons* (`laki widget
kit icons`); any emoji works too.

`ui` is one element (the preview and the full view alike; the full view shows every row) or `{ "preview": …, "full": … }`.
An element is `{ "type": "<name>", …props }`, and each also takes `if` / `unless` (a path or a template: shown when
truthy / falsy; an empty list is false), `each` (repeat it per item of a list), `tip` (a tooltip) and `tone` (`good`,
`bad`, `warn`, `accent`, `muted`, or a map from its text to one: `{ "failed": "bad", "live": "good" }`).

| group | elements |
|---|---|
| Layout | `stack` (`children`, `gap` sm/md/lg), `row` (`align` start/center/end/between, `wrap`), `grid` (`columns` 1-6, fewer as it narrows), `section` (`title`, `subtitle`, `collapsed`), `accordion` (panels that fold, one open at a time: `title`, `subtitle`, `icon`, `badge`, `text` and `children` per panel, written in `items` or with `each`; `open`, `multiple`), `bento` (tiles of different sizes: `items: [{ title, text, icon, color, href, cols, rows, children }]`, `columns` 2-6), `header` (`icon`, `title`, `subtitle`, `href`, `actions`), `footer` (`text`, `actions`), `toolbar` (`items`: icon buttons, their words as tooltips; `labels`), `spacer` (pushes the rest of a `row` to its end), `divider`, `hero` (a banner: `title`, `text`, `icon` or `image`, `actions`, `align`, `color`), `mockup` (a frame: `kind` browser/window/terminal/phone, `url`, `title`, `value`: lines, `$ ` ones as commands, `image`, `children`) |
| Navigation | `tabs` (`tabs: [{ label, badge, children }]`), `breadcrumbs` (a path of links, › between: `label`, `href`, `icon`), `pagination` (`page`, `pages`, `run` gets the page), `links`, `command` (a palette: a box over rows of commands, a button's props each and `keys`, `{ "title" }` headings; ↑ ↓ and Enter; `placeholder`, `empty`) |
| Text | `text` (`value`, `size` sm-xl, `weight`, `mono`, `muted`, `wrap`, `color`), `heading` (`level` 1-3), `markdown` (headings, lists, tasks, tables, code, links, https pictures), `quote` (`text`, `by`, `href`), `callout` (`title`, `text`, `icon`, `action`; its `tone`), `icon` (`name`, `size`, `color`), `kbd` (`keys`: ⌘ K, Ctrl+Shift+P; `label`), `rotate` (words that take turns: `items` or `each` + `text`, `prefix`, `suffix`, `seconds`, `size`, `color`), `marquee` (words or elements that scroll by in a loop, stopping on hover: `items` or `each` + `label`, `icon`, `href`; `children`; `seconds`, `reverse`) |
| Code | `code` (`copy`), `snippet` (a command or code with tabs, npm / pnpm / yarn: `items: [{ label, value }]` or `title` + `value`; `prompt` puts a `$` before each line; `copy`), `diff` (`value`: a unified diff, colored, its counts; `limit`), `json` (`value`: a path, folding; `open` levels), `log` (`text`, `time`, `level`, or `value` a whole log; the newest lines, errors red), `secret` (`value` behind dots, a click shows it; `label`, `copy`), `env` (variables: `key`, `value`, `tag`; a secret's value, by its name (KEY, TOKEN, SECRET, PASSWORD…) or `secret`, behind dots; the full view copies them all as a .env) |
| Numbers | `stat` (`value`, `label`, `delta`, `spark`, `icon`), `stats`, `badge`, `progress` (`style` bar/ring), `rating` (`value` stars of `max`, halves; `label`), `countdown` (`to`, `label`, `soon` hours: warn, `past`), `clock` (the time in places, ticking: `label`, `zone` as Europe/Kyiv, `hour12`) |
| Charts | `chart` (below), `spark`, `gauge` (`value`, `min`, `max`, `unit`), `radial` (a ring that fills: `value`, `max`, `text`, `label`, `size`, `color`), `meter` (one bar in parts: `label`, `value`, `color`, `max`, `unit`, `title`), `heatmap` (`x`, `value`, `rows`: days of activity), `funnel` (steps that narrow: `label`, `value`, `unit`, `color`; each step's share and drop), `uptime` (a tick per day or check: `state` up/degraded/down, `x`, `text`; `title`, `value`) |
| Status | `status` (`label`, `state`: up, degraded, down… colored by its word), `steps` (`label`, `state`: done, running, failed, skipped, todo; `text`), `checklist` (`text`, `done`), `matrix` (a CI matrix: `row`, `column`, `state`, `href`; `rows`, `columns` set the order), `indicator` (a count on a corner: `icon`, `avatar` or `label`, `badge`, `dot`, `href`), `loading` (something under way: `label`, `style` spinner/dots/bar, `size`, `color`), `skeleton` (shapes that shimmer while it loads: `lines`, `avatar`, `image`), `empty` (`text`, `icon`, `action`) |
| Lists | `list`, `table`, `kv`, `tree` (nested rows that fold: `label`, `text`, `icon`, `nested`, `open`), `timeline`, `board` (cards in columns: `column`, `columns`, `title`, `subtitle`, `tag`, `avatar`, `href`, `limit`), `calendar` (a month, its days dotted: `date`, `title`, `color`, `href`, `month`, `list`), `tags`, `filter` (chips over its `children`: a click keeps the rows whose words have it; `options`, `all`) |
| Media | `image`, `gallery` (pictures in a row that scrolls: `src`, `caption`, `href`, `height`), `card` (`title`, `text`, `image`, `icon`, `tag`, `href`), `compare` (two pictures and a divider to drag: `before`, `after`, `labels`, `height`), `swatches` (colors to copy: `color`, `label`, `text`, `copy`) |
| People | `avatar` (one picture: `login` or `image` or `name`'s initials, `size` sm-xl, `shape` circle/rounded/squircle/hexagon/diamond, `ring`, `state`, `label`, `text`), `avatars` (GitHub logins), `people` (`name`, `login`, `text`, `state`: online, away, busy, offline), `chat` (bubbles, the newest last: `from`, `text`, `time`, `login`, `mine`), `inbox` (`from`, `login`, `subject`, `text`, `time`, `unread`) |
| Developer | `prs` (`title`, `number`, `author`, `state` open/draft/merged/closed, `checks`, `review`, `time`, `href`), `commits` (`sha`, a click copies it; `message`, `author`, `time`, `href`), `deploys` (`state`, `title`, `branch`, `env`, `time`, `took`, `author`, `href`), `issues` (Linear's look: `id`, `title`, `state` backlog/todo/in progress/in review/done/canceled, `priority`, `labels`, `assignee`, `href`), `endpoints` (`method`, `path` (its `:params` lit), `status`, `text`, `took`, `count`, `href`), `changelog` (`version`, `date`, `title`, `changes`: words or `feat(ui)!: …` conventional commits, tagged) |
| Buttons | `button` (`run` + `arg`, `open`, `do`, `refresh`, `full` or `copy`; `confirm`; `style` primary/quiet/danger), `actions`, `split` (a button and a ▾ of the other ways: a button's props and `items`), `menu` (rows of places or commands: a button's props each, `icon`, `badge`, `on` lit, `{ "title" }` a heading), `dropdown` (a button that opens a menu of buttons: `label`, `icon`, `style`, `items`, `align`), `popover` (a button that opens a card over everything: `label`, `icon`, `style`, `title`, `text`, `children`; `hover`: as the pointer comes; `align`) |
| Inputs | `form` (`fields`, `submit`: the action gets the fields' JSON as `$WIDGET_ARG`), `input` (a box and a button, or Enter: `placeholder`, `label`, `icon`, `run` gets the words; `clear: false` keeps them), `textarea` (a few lines and a button, or ⌘ Enter: `placeholder`, `rows`, `label`, `icon`, `run` gets the words, or `do` new/send/ai with them as the prompt; `clear: false` keeps them), `select` (`options`, `value`, `label`, `run` gets the option picked), `combobox` (a box that suggests: `options` (a field or a list), `placeholder`, `label`, `icon`, `run` gets the words), `datepicker` (`value`, `kind` date/datetime/time/month, `min`, `max`, `label`, `run` gets what's picked), `radio` (options as cards: `options: [{ value, label, text, icon, badge }]`, `value`, `columns`, `run` gets the one picked), `toggle` (a switch: `label`, `text`, `on`, `run`: its action gets `on` or `off` as `$WIDGET_ARG`, then it fetches again; `confirm`), `segmented` (`options`, `value`: the picked one, `run` gets the option clicked; `label`, `confirm`), `stepper` (`value`, `min`, `max`, `step`, `unit`, `run` gets the new number), `range` (a slider: `value`, `min`, `max`, `step`, `unit`, `run` gets where it's let go), `swap` (flips between two `icons` and `labels`: `on`, `run` gets `on` or `off`) |

**Colors.** A `color` (text, heading, icon, badge, spark, progress, gauge, heatmap, a header's icon, a stat's and a
tag's dot) is a tone (`good`, `bad`, `warn`, `accent`, `muted`), one of Laki's palette (`blue`, `green`, `red`,
`orange`, `yellow`, `purple`, `pink`, `teal`, `lime`, `brown`, `gray`: each theme's own) or a hex (`d73a4a`), or a
template that gives one (`"{{#if late}}bad{{else}}good{{/if}}"`). The UI kit page's *Colors* shows each as your theme
paints it (and the theme's variables a JS page can use), *Typography* every text style with its JSON.

**Charts.** `kind`: `line` (the default), `area`, `bars`, `stacked` (series on each other), `hbars` (a bar per row,
its label beside it), `pie`, `donut` (its total in the middle) and `scatter` (`x` and `y` numbers). One number per row
(`y`) or `series: [{ "label", "y", "color" }]`; `colors: ["blue", "orange", "#d73a4a"]` in order (default: the
palette); a row's own `color` template, or a `tone` map over its `x`, colors a slice or a bar; `legend` (on with
several series, a pie and a donut), `unit`, `min`, `max`, `height`, `label`.

**Laki commands.** A button's `do` asks Laki to do something; Laki says what and asks first:

| `do` | with | what |
|---|---|---|
| `new` | `prompt`, `project` (a name; none: the selected workspace's), `agent` (a profile or agent; none: your default) | a new workspace whose agent starts on the prompt |
| `send` | `prompt` | to the selected workspace's agent (a per-workspace extension: its own), after its turn |
| `ai` | `prompt` | to Laki AI (on) |
| `terminal` | `command` | a new terminal that runs it |
| `browse` | `url` | the page in a Laki browser tab (no question: a link) |

```json
{ "type": "toolbar", "items": [
  { "icon": "agent", "label": "Fix it", "do": "new", "prompt": "Fix the failing test in {{suite}}" },
  { "icon": "ai", "label": "Ask Laki AI", "do": "ai", "prompt": "What changed in {{repo}} today?" },
  { "icon": "terminal", "label": "Logs", "do": "terminal", "command": "tail -f log/development.log" } ] }
```

A JS page: `laki.do({ do: "send", prompt: "Run the tests" })`, right after a click as `laki.run`.

A `list` row has `title`, `subtitle`, `icon`, `avatar` (a GitHub login), `href`, `accessories` (`[{ tag | text | badge
| icon | avatar | ago | date | progress, tone }]`; `progress` a number of `max`, 100: a small bar), `actions`, and the
list `limit` (the preview: as many as fit, then *+N more*), `filter` (a box in the full view), `group` (headings by a
field) and `empty`. A `table` has `columns` and `sort` (`"age desc"`). A column has `title` and `value` (its words),
`tag`, `tone`, `href`, `align`, `mono`, `width`, `wrap`, `hide: "narrow"`, and more in the cell: `subtitle` (a muted
line under the words), `image` (a picture before them, data: or https), `avatar` (a GitHub login's) or `icon`,
`progress` (a number of `max`, 100: a bar, in `color`; `value` its words, else the percent), `badge`, `spark` (a path to
numbers: a line), `copy` (true: a copy button) and `actions` (buttons, each over its row):

```json
{ "type": "table", "each": "team", "columns": [
  { "title": "Who", "avatar": "{{login}}", "value": "{{name}}", "subtitle": "{{role}}" },
  { "title": "Sprint", "progress": "{{done}}", "max": "{{total}}", "value": "{{done}}/{{total}}" },
  { "title": "This week", "spark": "week", "hide": "narrow" },
  { "title": "", "align": "right", "actions": [{ "label": "Profile", "icon": "github", "open": "https://github.com/{{login}}" }] } ] }
```

**Binding.** Strings are templates over `{ …data, data, config, at, error, full }`: `{{open}}` is `{{data.open}}`.
Inside `each` the scope is the item (and `this`, `@index`). A path prop (`each`, `items`, `values`, `group`) is looked
up as is. With an error and no data, the kit shows the error and *Retry*; a template that fails in one element shows
a small chip there, the rest draws.

```json
{
  "name": "Deploys", "every": 5, "size": [4, 2], "fetch": "sh fetch.sh",
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
again. What the action prints as JSON can say more: `{"data": …}` ([its data](#an-actions-data), no fetch then), `{"toast": "Done"}`, or `{"modal": …}`
([a dialog](#dialogs)). `data-laki="refresh"` fetches again.

### Dialogs

An action's `{"modal": …}` (or a JS page's `laki.modal(…)`) opens a dialog of the extension's own:

```json
{"modal": {
  "id": "deploy", "title": "Deploy to staging?", "text": "3 commits since the last one.", "size": "m",
  "ui": {"type": "table", "each": "commits", "columns": [{"title": "Commit", "value": "{{sha}}", "mono": true}, {"title": "", "value": "{{title}}"}]},
  "data": {"commits": [{"sha": "a1b2c3", "title": "Fix login"}]},
  "buttons": [
    {"label": "Cancel", "style": "quiet"},
    {"label": "Dry run", "run": "deploy", "arg": "dry", "close": false},
    {"label": "Deploy", "run": "deploy", "style": "primary", "close": "done"}
  ]
}}
```

- `title`, `text`: its words. `ui` and `data`: a [UI kit](#the-ui-kit-ui) element drawn over its own data (64 KB and
  512 KB at most), its buttons, toggles and fields running the extension's actions as in its full view. `size`: `s`,
  `m` (with a `ui`) or `l`.
- `buttons`: 6 at most, each `run`ning an action (`arg`), `open`ing an http(s), mailto or `laki://` link, or only
  closing it; `style`: `primary` (Enter), `danger` or `quiet`. A button closes the dialog first; `"close": false`
  keeps it open while its action runs, `"close": "done"` closes it once the action is done (not when it failed).
  None given: OK; `[]`: none, only ✕ and Esc.
- `id`: a later `modal` with the same id is drawn in its place, so an action can update the dialog it was run from
  (a progress, the next step). `{"close": "deploy"}` closes that one, `{"close": true}` any of the extension's own;
  a `close` and a `modal` together close first. A JS page's `laki.close(id?)` does the same.

An action can be an agent instead of a command: `"draft": { "ai": "Draft a short reply to {{arg}}", "tools":
"mcp__slack__post_message" }`. Its prompt gets `{{arg}}`, the settings (`{{config.x}}`), the data's fields and the
workspace filled in; the agent is Settings › Extensions' *Agent profile* (`"profile"` names another), with your MCP
servers, and may use the `tools` named (claude's, comma-separated) unasked. Its answer shows in a dialog; a json block at
its end may say `{"toast"}`, `{"modal"}` or `{"data"}` (the extension's new data), like a command's JSON. No fetch
follows an agent's action (its run costs).

### Notifications (`notify`)

`"notify": "{{#if mentions}}{{mentions}} new mentions in Slack{{/if}}"`: a template over the data. After each fetch (a
push, an action's data), when it reads as something new, not empty and not what it last said, Laki posts it as a
notification (a click opens the extension) and a toast. The same words again say nothing; empty, then words again,
say them again. Sample data never does.

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
| `toast(text)`, `modal({ title, text, ui, data, buttons })`, `close(id?)` | as an action's JSON ([dialogs](#dialogs)) |
| `ui(spec, data?)`, `mount(el, spec, data?)` | the UI kit's HTML for an element, or put in `el` (both promises) |
| `log(...args)` | a line in its [log](#logs) (src `page`), any time; 50 a second, 2 KB a line at most |

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
| `desk` | a tile on the Desk page, sized there | its full view, else its preview |
| `panel` | a tab of the right panel (⌥⌘B), after Info, Files, Changes, Review and Preview | its full view, else its preview, the panel's width |
| `row` | a mark on each workspace's row in the sidebar (per workspace only) | its `badge` (else `label`), its `tip` on hover |

`widget.json`'s `place` is where it starts; the user moves it in its settings (Settings › Extensions › the extension ›
*Sidebar / Top bar / Status bar / Rail / Sidebar foot / Desk / Right panel / Workspace rows*, one or several). For the
bars, design it ½ high: a number and a word, a few links.

A `row` extension is fetched for every live workspace, not only the one on screen (4 at a time; the rest at the next
ticks): keep its fetch cheap and its `every` long. A click on its mark runs its `click` action in that workspace, else
selects the workspace. A `panel` one per workspace shows the workspace the panel is for.

## Actions where you work (`show`, `key`)

An action in its object form can be offered where you work, not only on its buttons: in ⌘K, a workspace's, a tab's or
a file's right click, a shortcut, or the new-workspace prompt. A command's or an agent's (`ai`) alike:

```json
"actions": {
  "explain": {
    "run": "./explain.sh",
    "title": "Explain this file",
    "show": ["file", "palette"],
    "match": ["*.ts", "*.tsx"],
    "key": "Alt+Cmd+E",
    "ask": "What should it focus on?",
    "confirm": "Run it on the whole workspace?",
    "insert": true
  }
}
```

| field | what |
|---|---|
| `title` | its label (unset: its name in words, `explain-file` is *Explain file*) |
| `show` | where it's offered: `palette` (⌘K, as *<name>: <title>*), `workspace` (a workspace's ⋯ and right click), `tab` (a tab's right click), `file` (a file's right click in Files), `prompt` (the new-workspace prompt's Insert menu) |
| `match` | with `file`: the files it's for, as globs (`*.ts`, `docs/**/*.md`; one without `/` matches the name); unset: every file |
| `key` | a shortcut, with Alt (⌘ and ⌘⇧ alone are Laki's, ⌃ alone a terminal's: ⌃C, ⌃E): it runs with the workspace and tab you're in |
| `ask` | a question first: the answer is its `$WIDGET_ARG` (Cancel: it doesn't run) |
| `confirm` | a yes or no first |
| `insert` | what it prints (its JSON's `"insert"`, else all of it) goes into the prompt: the box it was picked in, else the workspace's agent's prompt (typed, not sent), else the clipboard |
| `view` | its full view opens after it runs: a **file opener** prints `{"data": …}` about `$LAKI_FILE`, and its full view shows it |

Where it was picked comes with it: `$LAKI_CTX` (JSON: `ws`, the workspace as `$LAKI_WIDGET_WS` has it; `tab`, `{ id,
name, agent }`; `file`, `{ path, abs }`), `$LAKI_FILE` (the file's absolute path), `$LAKI_TAB` and `$LAKI_TAB_NAME`, and
the workspace's `$LAKI_WORKSPACE`, `$LAKI_BRANCH`, `$LAKI_PATH`, `$PORT`… An agent's prompt fills `{{file.path}}`,
`{{tab.name}}` and `{{workspace.branch}}`. Laki checks it first: the workspace live (not a terminal's, a browser's or an
SSH host's), the tab its own, the file inside it (links followed). A per-workspace extension's action runs in its own
workspace only. An agent's `laki widget action` gets no ctx (it has its own `$LAKI_WORKSPACE`), and is asked first as
before.

## Its preview with made-up data (`sample`)

Every extension shows how it looks before it ever runs: its page (Settings › Extensions › the extension) has *Live* and
*Sample*, and a Desk tile Laki AI just made shows its sample until it's turned on. `sample` is what its fetch would
print (the same shape, realistic values), `sampleConfig` the settings to show it with; templates get `sample: true`
meanwhile, and its links and buttons do nothing. Every extension with data has one: Laki AI's `laki_extension_write`
refuses a fetch, a script, a file or a URL source without it, and `laki widget check` says so.

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
| `chart` | lines, areas, bars, stacked, horizontal bars, a pie, a donut or a scatter from a list of numbers |
| `note` | Markdown: typed on its card (*Static*), or a file or a URL; no fetch |
| `launcher` | buttons that ask Laki: a workspace, a prompt to the agent or Laki AI, a terminal, a page |
| `button` | an icon on the rail with a count; a click runs its action |
| `form` | fields and a button: an action gets them as JSON |
| `panel` | a JS page of yours that draws with the UI kit (`laki.mount`), typed by `laki.d.ts` |
| `workspace` | *This branch*: per workspace, its branch, PR, port and path, a link to its server |
| `stream` | a command that runs all along: a line of JSON every 2 s, shown as it comes |
| `tool` | *A tool for agents*: notes your agents add with its `add` tool (asked once per workspace), a Clear button |
| `pullmain` | *Pull main*: per workspace, a status bar button that merges the base branch in (below) |
| `context` | *Context*: actions where you work, in ⌘K (Alt+Cmd+U), a file's right click and the prompt's Insert menu (below) |
| `onefile` | one script, `<id>.5m.sh` (below) |

Each runs at once with no network: its `fetch.sh` prints `fixtures/sample.json`, with a real one (gh, curl) in its
comments to swap in; `fixtures/empty.json` and three more made-up variants beside it (its preview's *Sample* picks one). It has a `README.md`
with the next steps, and `"$schema"`, so VS Code and Cursor complete and check its `widget.json`
([`docs/widget.schema.json`](widget.schema.json), written from `src/shared/widgetSchema.ts` by
`node --experimental-strip-types scripts/widget-schema.ts`). The id comes from the name, made unique. It's yours: on.

### Pull main

`laki widget new "Pull main" --kind pullmain` is a template to copy: a button in the status bar, one per workspace, its
badge how many commits the base branch (origin's, or `$LAKI_BASE`) has that the branch doesn't yet. A click runs
`pull.sh`, its *How* setting the way:

| how | what |
|---|---|
| `agent` (default) | the workspace's agent gets the prompt after its turn (`$LAKI_CLI send <ws> --when-idle`): fetch, merge, fix conflicts, run the tests, commit |
| `git` | `git fetch` and `git merge` in the action: *Up to date* or *Merged main (3 new)*; only on a conflict, `claude -p` resolves it and commits |
| `ai` | `claude -p` does it all |

`claude -p` gets only the tools `TOOLS` names (read and edit files, git, the usual test commands), and runs in the
background: an action has 2 minutes. As it ends it pushes its last line (`laki widget push --merge '{"last": …}'`), which
`"notify": "{{last}}"` shows as a notification and a toast. Its prompt is `prompt()` at the top of `pull.sh`.

### Context

`laki widget new "Context" --kind context` is the one to copy for [actions where you work](#actions-where-you-work-show-key):
a *Context* button in the status bar, no fetch, and three actions, each told where you are (`$LAKI_PATH`,
`$LAKI_BRANCH`, `$LAKI_FILE`, `$LAKI_TAB`, all of it as JSON in `$LAKI_CTX`):

| action | where | what |
|---|---|---|
| `summary` | ⌘K, Alt+Cmd+U | a toast: the branch and how many files changed (*Pick a workspace first* without one) |
| `file-stats` | a text file's right click in Files (`match`) | `{"data": …}`: lines, words, bytes and its most used words; `"view": true` opens its full view |
| `branch-note` | the prompt's Insert menu, a tab's right click | `"insert": true`: *Branch X, N files changed: a, b, c* goes into the prompt, unsent |

Plain `sh`, `awk` and `git`: no jq or node.

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
| Overview | its preview where it sits (*Live* or *Sample*, with a picker of its samples), everywhere else (any sidebar size, the bars, as a button), its full view and settings; the head's *Edit* goes to the settings |
| Data | where its data comes from (its fetch, a text, a file, a URL); its last data as JSON: edit it and *Apply* to see it with that data, *Live* fetches again; its examples (widget.json's `sample`, each `fixtures/<name>.json`): *Show it with this*, or *Use as its data* |
| Runs | the runs, newest first; a click shows one's stderr |
| Logs | its [log](#logs), following as lines come; filters by level, source, words and workspace; *Copy*, *Clear*, *Show in Finder* |
| Env | what its fetch gets (`WIDGET_*`, `LAKI_*`, `PATH`); a setting named like a token, secret, key or password masked |
| Files | its folder's files: *Edit*, then *Save* (⌘S); JSON is checked first, it reloads at once, and the studio's *Undo* has the version before. One that comes with Laki: *Remix it…* makes a copy to change |
| Check | *Check* above: *Check again*, *Check with a fetch* |

Data put there by hand shows a *Sample data* chip wherever the extension is, and its schedule doesn't fetch over it.
A right click on an extension › *Inspect*, or `laki://settings/widgets/<id>/inspect`, opens the Data tab.

## Logs

Off by default. Settings › Extensions › *Keep logs for every extension*, or one's own *Keep a log* (its settings'
*Updates*; a dev-linked one keeps one while linked), turns it on; only you set them, never an agent. While it's on,
`<data>/widget-data/<id>.log` (JSON lines, yours alone, 1 MB then a second file) keeps:

- Laki's own lines about it (`src: laki`): fetches, actions, events, sample data, refusals, tool calls, stream restarts;
  a failure is `error`;
- a line at the end of each run (`fetch`, `action:<name>`, `stream`, `tool:<name>`, `push`): why, how long, its exit
  code and size;
- the run's stderr, whole (64 KB of it): a line that starts with `debug:`, `info:`, `warn:` or `error:` gets that level
  (the prefix taken off), any other is `info`. A `script` logs with `console.error` (its stdout is its data);
- a stream's lines that aren't JSON, and its stderr;
- an AI source's or AI action's run: the profile, its prompt's start, seconds, cost and the answer's size;
- lines you add: `laki widget log <id> [--level warn] [--ws <id>] <text…>` (hooks, cron; it exits 0 and writes nothing
  while the log is off) and a JS page's `laki.log(...)`.

Every secret's value, and every setting's whose name says token, secret, key or password, is `••••` before a line is
written, and wherever what its command printed to stderr shows: its error, Runs, `laki widget dev`. See it on its page's **Logs** tab (or a right click › *Logs*), with `laki widget logs <id> [-n 100] [-f]
[--level error] [--ws <id>] [--json]`, or MCP's `laki_extension_logs` (the studio's Laki AI gets the last warnings and
errors). Settings' list tags the ones that keep one (`log`, red after an error in the last hour). Turning it off keeps
the file until *Clear*; *Delete* takes it to the trash with the extension (*Undo* brings it back); a remix starts
without one.

## The studio

With Laki AI on (Settings › AI), Settings › Extensions › *New ▾ › With Laki AI…* (or ⌘K *New extension…*,
`laki://settings/widgets/new`) opens the studio: a chat with Laki AI on the left, the extension on the right.

- Say what it should show ("Show my open PRs as a list with CI status"), or pick a starter or an example. Laki AI
  writes it with the UI kit, with `fixtures/sample.json` and `fixtures/empty.json`, checks it and fixes what's wrong.
- The preview shows it on its sample data, in each place (sidebar at any size, the bars, a button) and its full view;
  Data, Runs, Check and Files are the inspector's. A check that fails shows as a chip in the head; Laki AI hears of it
  at your next ask.
- Nothing runs by itself. **Try it live** shows exactly what will run (its fetch or script, each action's command, a
  JS page's network switch), then runs its fetch once, while it's still off; *Back to sample* returns. **Turn on**
  shows the same, then turns it on; turned on anywhere (Settings' switch too), it fetches its real data.
- **Undo** puts the version before the last change back (the last 20 are kept); each turn's *Undo to here* goes back to
  how it was after that turn.
- A row's ✨ (*Edit with Laki AI*, one of yours in Laki's folder) opens it in the studio. **Remix** (a row's, or Files'
  *Remix it…*; any one, built-in too; `laki widget remix <id> [new-id]`) makes a copy that's yours, in Laki's folder,
  off, and opens it: the studio with Laki AI on, else its page. Laki AI isn't needed for it.

Each extension's chat is kept beside its settings (`<data>/widget-data/widget:<id>.chat.json`) and goes when you delete
it; an extension's page talks in the same chat. Without Laki AI, *New ▾ › With Laki AI…* opens a page whose *Copy the
prompt* gives any AI chat the whole format with what you typed.

## Share with your team

A repo can ship its team's extensions in `.laki/extensions/`, as it ships workflows in `.laki/workflows/`: clone it, add
it to Laki, and the team's deploy board is there. Make one there with

```bash
laki widget new "Deploys" --kind table --dir .laki/extensions/deploys
```

and commit it. Folders and one-file extensions both work.

- **Its id** is `<project>.<id>` (`shop-web.deploys`), so it never covers yours or another project's.
- **Off until you look.** It always starts off. Turning it on (Settings › Extensions › *From shop-web*) shows what it
  runs first: its fetch, its actions' commands, the text of the scripts it runs, every file it's trusted as (hidden ones
  and `node_modules` too), the events it answers, its settings and what it can hold; *Turn on in shop-web* turns on
  exactly that. A link to a folder inside it counts as that folder; one with a link out of its folder, or more than
  2,000 files, can't be turned on. From the CLI: `laki widget what shop-web.deploys`, then
  `laki widget on shop-web.deploys --seen <hash>`.
- **Off again when it changes.** Any change to its files in the repo (a pull, a branch switched in the project's
  folder) turns it off and marks it *changed*: its streams and agents stop, its tools' *Always* go, and you get a toast
  and a notification. Its page says what changed; turning it on shows you again.
- **Only in its project.** It shows in the sidebar, the bars, the panel, the rows, the rail and the foot only while a
  workspace of that project is selected; on the Desk it's named *Deploys · shop-web*. Its ⌘K items, menus and keys,
  events, gates and tools for agents are that project's only (`app.open` and `custom.*` events with no workspace too).
- **The repo's files, your settings.** Its settings and secrets are yours, kept in `<data>`, never in the repo. It
  can't be deleted, rewritten or edited here (change it in the repo); *Remix* copies it into yours. Removing the project
  hides it; its settings stay.
- Agents never turn it on, nor clear *changed*.
- `laki widget dev` (or Settings' folders) on `.laki/extensions` or a folder inside it keeps it the repo's: its id,
  off until you look.
- It's read from the project's own folder: a branch's change to `.laki/extensions` in a worktree shows once it reaches
  that folder. A project on an SSH host isn't read.

## Managing them

- Settings › Extensions: each one's switch; a click opens its page: the preview (live or with its sample), its place,
  size, how often it fetches, its full view's size, its settings, *Network access* for a JS page, *Show a refresh button* and
  *Show when it was fetched* (off: no ↻ buttons, no "fetched … ago" and no UI kit line or template text that names `at`), its folder, *Delete*
  (its folder, settings, data, history, chat and secrets go to the trash, with *Undo* in the toast; `laki widget trash`
  lists the last 30 days', `laki widget restore <trash-id>` puts one back; the ones that come with Laki only turn off), and Laki AI's chat
  to change it. *New ▾* (in *Yours*) makes one from a starter (its page opens on Overview), or with Laki AI (without
  it: a page with the prompt for any AI chat). Search
  for *plugin* finds it too.
- Scheduled tasks (*New task* › the agent picker's *Extension*: fetch it, or run one of its actions) and workflows (an
  *Extension* block: fetched, its data as `{{steps.<id>.<field>}}`) use the ones that are turned on.
- The Desk's *Build with AI*: a dialog (what it shows, screenshots, text files), then the extension studio, where Laki AI makes one for the Desk; it shows as a tile at once, with its
  sample, off until you turn it on.
- The CLI: `laki widget [ls]`, `laki widget reload`, `laki widget on|off|run <id>`, `laki widget what <id>` (what
  turning it on runs, and the hash `laki widget on <id> --seen <hash>` takes), `laki widget logs|log <id>` ([logs](#logs)), `laki widget render <id> [--full]`,
  `laki widget action <id> <action> [arg]`, `laki widget new <name> [--kind <k>] [--dir <folder>]`, `laki widget check
  [id|folder] [--no-run]`, `laki widget kit [element]`, `laki widget dev [folder]`, `laki widget trash`, `laki widget
  restore <trash-id>`.
- Laki AI and `laki mcp` (`laki_extensions`, `laki_extension_guide`, `laki_extension_read`, `laki_extension_write`,
  `laki_extension_check`; `fixtures/<name>.json` is the one folder they may write):
  they make or change extensions in Laki's own folder, saved off: its fetch runs commands, so you look, then turn it on.
  They never delete one.

## Safety

- A fetch and an action are shell commands on your Mac, like a script you run: only turn on what you trust. One that
  Laki AI wrote is saved off and tagged *by Laki AI*.
- A gate holds a ship, a merge or an archive; only you can do it anyway (an agent's `force` is refused).
- A repo's extension (`.laki/extensions`) is off until you look at what it runs, and off again when its files change
  there ([Share with your team](#share-with-your-team)).
- An agent's tool call shows you the command and its input before it runs, unless the tool says `never` or you chose
  *Always* in that workspace.
- A Yes holds only for the files you were shown. Laki AI's *Turn on …?*, the studio's *Turn on*, a tool's ask and its
  *Always* each keep a hash of everything the extension runs (its files, its source, its actions, events and stream,
  network access); if any of it changes before your Yes, nothing runs: Laki AI asks again with what it says now.
- A template extension is sanitized (no scripts, frames, forms, `on…` attributes, or links other than http(s) and
  mailto). A JS one runs in a sandboxed frame with an opaque origin, `default-src 'none'`, and only the network you allow.
- Its settings are kept in `<data>/widget-data/<id>.json`, next to its last data; its secrets in
  `<data>/widget-secrets.json` (0600), given only to its fetch and actions.
- An agent's `laki widget action` asks you; `laki widget on` is yours only. ponytail: a process of yours can still read
  the daemon's token and call its API directly: these close the CLI's paths, not a determined program.
