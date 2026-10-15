# Laki extensions: the SDK

An extension (also called a widget or a plugin: one and the same) is a small live page in Laki: a count, a chart, a
table or a row of links, with a full view a click away. It is a folder with two files, and Laki does the rest: runs
its fetch on a schedule, keeps what it printed, fills the page and shows it where you put it.

This page is the overview. The whole format, with every field and helper, is in Settings › Extensions › *Make one with
AI* (the prompt), in the *Extension creator* agent skill (Settings › Agent skill), and in
[`src/shared/widgetGuide.ts`](../src/shared/widgetGuide.ts), which both are made from. Three examples come with Laki,
in [`widgets/`](../widgets): `links` (a JS page, no fetch), `my-prs` (a shell fetch with gh and jq, a template) and
`team-prs` (a JS fetch script and a JS page).

## How it works

```
widget.json ──▶ fetch (a shell command, or a JS script) ──stdout JSON──▶ <data>/widget-data/<id>.json
                 every N minutes, while the app is open                      { data, at, error, your settings }
                                                                                         │
widget.html ──▶ <template preview> / <template full>, filled with data and config ◀──────┘
                 no <script>: drawn in the app (sanitized) · a <script>: a sandboxed page (window.laki)
```

1. Laki finds extensions in `<data>/widgets/<id>/` (Laki's own folder), the folders you add in Settings › Extensions,
   then the ones it comes with. The first folder of an id wins. Each starts off: turn it on in Settings › Extensions.
2. While the app is open (and within *Working hours*, if set), each extension that is on runs its `fetch` every
   `every` minutes, and when it's turned on, when its settings change, on *Reload extensions* and on `laki widget run`.
3. What the fetch prints must be JSON: it is kept as `data`. A failure keeps the last data and shows a red dot with why.
4. The page is filled from `data`, `config` (your settings), `at` (the last fetch) and `error`.

## The files

| file | what |
|---|---|
| `widget.json` | `name`, `description`, `size` (cells across 1-3 × down ½-4), `every` (minutes), `view` (the full view: `s`, `m`, `l`), `place` (`side`, `top`, `status`, `rail`, `foot`), `config` (its settings), `fetch` (a shell command) or `script` (a JS file), `actions` (commands its buttons run); as a button: `icon`, `label`, `badge`, `tip`, `click` |
| `widget.html` | `<template preview>` (where it sits), `<template full>` (the dialog a click opens, optional), shared `<style>` outside both; none for a button that has no full view |
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

### Templates

`{{a.b}}` (escaped), `{{#each list}}…{{else}}…{{/each}}`, `{{#if x}}…{{/if}}`, `{{#unless x}}…{{/unless}}`, `{{date x}}`,
`{{ago x}}`, `{{spark list}}` (a line chart). Ready-made classes follow the app's theme: `tile`, `num`, `label`, `muted`,
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

`widget.json`'s `place` is where it starts; the user moves it in its settings (Settings › Extensions › the extension ›
*Sidebar / Top bar / Status bar / Rail / Sidebar foot*). For the bars, design it ½ high: a number and a word, a few links.

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

- Settings › Extensions: each one's switch, place, size, how often it fetches, its full view's size, its settings,
  *Network access* for a JS page, its folder, *Delete* (its folder and settings, for good, after a confirm; the ones
  that come with Laki only turn off). Search for *plugin* finds it too.
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
