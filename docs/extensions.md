# Laki extensions: the SDK

An extension (also called a widget or a plugin: one and the same) is a small live page in Laki: a count, a chart, a
table or a row of links, with a full view a click away. It is a folder with a `widget.json` (and a `widget.html` only
for a look of its own), and Laki does the rest: runs its fetch on a schedule, keeps what it printed, draws it with the
UI kit and shows it where you put it.

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
| `widget.json` | `name`, `description`, `size` (cells across 1-3 × down ½-4), `every` (minutes), `view` (the full view: `s`, `m`, `l`), `place` (`side`, `top`, `status`, `rail`, `foot`), `config` (its settings), `fetch` (a shell command) or `script` (a JS file), `sample` (made-up data in the shape its fetch prints: needed with a fetch), `sampleConfig` (settings for that preview), `actions` (commands its buttons run), `ui` (what it shows, below); as a button: `icon`, `label`, `badge`, `tip`, `click` |
| `widget.html` | optional: `<template preview>` (where it sits), `<template full>` (the dialog a click opens), shared `<style>` outside both; a view it has wins over `ui`'s |
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
gets `{ config, last }` and returns the data.

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
again. What the action prints as JSON can say more: `{"toast": "Done"}`, or `{"modal": {"title", "text", "buttons"}}`
(up to 4 buttons, each `run`ning another action, `open`ing an http(s), mailto or `laki://` link, or closing).
`data-laki="refresh"` fetches again.

### JS pages (`window.laki`)

A `widget.html` with a `<script>` is a JS extension: a page of its own in a sandboxed frame, with:

| `window.laki.` | what |
|---|---|
| `data`, `config`, `at`, `error`, `full` | what a template sees |
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

## Managing them

- Settings › Extensions: each one's switch; a click opens its page: the preview (live or with its sample), its place,
  size, how often it fetches, its full view's size, its settings, *Network access* for a JS page, its folder, *Delete*
  (its folder and settings, for good, after a confirm; the ones that come with Laki only turn off), and Laki AI's chat
  to change it. *New extension* (in *Yours*) makes one with Laki AI, or gives you the prompt for any AI chat. Search
  for *plugin* finds it too.
- The Desk's *Build with AI*: Laki AI makes one for the Desk in its floating chat; it shows as a tile at once, with its
  sample, off until you turn it on.
- The CLI: `laki widget [ls]`, `laki widget reload`, `laki widget on|off|run <id>`, `laki widget render <id> [--full]`,
  `laki widget action <id> <action> [arg]`.
- Laki AI and `laki mcp` (`laki_extensions`, `laki_extension_guide`, `laki_extension_read`, `laki_extension_write`):
  they make or change extensions in Laki's own folder, saved off: its fetch runs commands, so you look, then turn it on.
  They never delete one.

## Safety

- A fetch and an action are shell commands on your Mac, like a script you run: only turn on what you trust. One that
  Laki AI wrote is saved off and tagged *by Laki AI*.
- A template extension is sanitized (no scripts, frames, forms, `on…` attributes, or links other than http(s) and
  mailto). A JS one runs in a sandboxed frame with an opaque origin, `default-src 'none'`, and only the network you allow.
- Its settings are kept in `<data>/widget-data/<id>.json`, next to its last data.
