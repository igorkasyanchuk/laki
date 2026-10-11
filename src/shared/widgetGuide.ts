// How to make a widget, in words: the laki-widget skill's body (daemon/skill.ts) and the prompt Settings › Extensions
// copies for any AI chat (widgetPrompt). One text, so both say the same.

export const WIDGET_EVERY = 5 // minutes between fetches when widget.json doesn't say

// widget.json and widget.html, all a widget is
export const widgetFormat = () => `## widget.json

\`\`\`json
{
  "name": "PRs with conflicts",
  "description": "One line: what it shows (Settings › Extensions shows it).",
  "size": [1, 1],
  "every": 5,
  "view": "m",
  "place": "side",
  "config": {
    "repo": { "label": "Repo", "hint": "owner/name" },
    "user": { "label": "Author", "default": "@me" },
    "labels": { "type": "list", "label": "Only with labels" },
    "drafts": { "type": "bool", "label": "Include drafts", "default": true },
    "limit": { "type": "number", "default": 50 },
    "sort": { "type": "choice", "choices": ["newest", "oldest"] },
    "project": { "label": "Laki project", "hint": "the project a review opens in" }
  },
  "fetch": "sh fetch.sh",
  "actions": { "review": "\\"$LAKI_CLI\\" new \\"$WIDGET_PROJECT\\" --pr \\"$WIDGET_ARG\\" --prompt 'Review it'" }
}
\`\`\`

- \`size\`: cells [across 1–3, down 0.5 or 1–4] in the sidebar's grid; one cell is about 70×64 px, 0.5 a line 29 px tall. The user can change it.
- \`every\`: minutes between fetches (default ${WIDGET_EVERY}); the user can change it. A fetch also runs when the widget is
  turned on, when its settings change, on Reload and from \`laki widget run <id>\`.
- \`place\`: where it shows at first: \`side\` (the sidebar's grid, the default), \`top\` (the top bar) or \`status\` (the
  status bar's right end). The bars are a line high (about 26 px), and it's as wide as its cells across: design it as a
  ½-high one (a number and a word, a few links). The user can move it.
- \`view\`: the full view's dialog, \`s\` (small), \`m\` (medium, the default) or \`l\` (large: for wide tables). The user
  can change it.
- \`config\`: the settings the user fills in (Settings › Extensions). Each is a default (a string: text; \`true\`/\`false\`:
  an on/off; a number) or \`{ "type", "label", "hint", "default", "choices" }\`, \`type\` one of \`text\`, \`number\`, \`bool\`,
  \`choice\` (one of \`choices\`) or \`list\` (words or names, typed as chips: logins, labels). Give each a short \`label\`
  and, when it isn't obvious, a \`hint\`. Never hard-code a user's repo, login or token: make it a setting.
- \`fetch\`: a shell command, run with \`/bin/sh -c\` in the widget's folder, so it can run a script of the widget's in
  any language on the user's PATH: \`sh fetch.sh\`, \`python3 fetch.py\`, \`ruby fetch.rb\`. Or \`script\`: a JS file of
  the widget's (\`fetch.mjs\`) that Laki's node runs; its \`export default async function ({ config, last })\` returns
  the data (\`last\`: what the previous fetch returned, for history), or the script prints JSON itself. A thrown
  error's message is what the user sees.
- Prefer what every Mac has, so there's nothing to install: \`sh\` with \`curl\`/\`gh\`/\`jq\`, \`python3\` with its
  standard library only, or a JS \`script\`. A Python fetch:

\`\`\`python
import json, os, sys, urllib.request
config = json.loads(os.environ["LAKI_WIDGET_CONFIG"])  # the settings, typed
if not config["repo"]:
    sys.exit("Set Repo in Settings › Extensions")  # stderr, exit 1: the error the user sees
with urllib.request.urlopen(f"https://api.github.com/repos/{config['repo']}") as r:
    repo = json.load(r)
print(json.dumps({"stars": repo["stargazers_count"]}))  # stdout: the data
\`\`\`

- What it prints (stdout) must be JSON: it's stored as \`data\`. Exit non-zero (with a line on stderr, e.g.
  "Set Repo in Settings › Extensions") to fail: the widget keeps its last data and shows the error.
- Its environment: \`$WIDGET_<NAME>\` for each setting (\`repo\` is \`$WIDGET_REPO\`; an on/off is \`1\` or empty, a list
  its items joined by commas), \`$LAKI_WIDGET_CONFIG\` (all of them as JSON: an on/off \`true\`/\`false\`, a number a number,
  a list an array), \`$LAKI_WIDGET_FILE\` (its storage, a JSON file with the last \`data\`), \`$LAKI_CLI\` (the laki command:
  \`"$LAKI_CLI" ls --json\`). A script's \`config\` is the JSON one. Quote them: \`gh pr list --repo "$WIDGET_REPO"\`. CLIs on
  the user's PATH work (gh, jq, curl…). 2 minutes at most.
- Shape the data in the fetch (gh's \`--jq\`, jq, JS): small, only what the page shows, with ready-made fields
  (\`"ci": "failing"\`, \`"approved": true\`), since templates have no comparisons.
- \`actions\`: commands a button runs (\`<button data-run="review" data-arg="{{url}}">\`), with \`data-arg\` as \`$WIDGET_ARG\`
  (never paste it into the command itself); then the widget fetches again. While it runs the app shows a toast and the
  button waits; after, its output's last line is a toast, or print JSON (all of it, or its last line) to say more: \`{"toast": "Done"}\`, or
  \`{"modal": {"title": "Review started", "text": "…", "buttons": [{"label": "Close"}, {"label": "Open it", "open":
  "laki://ws/<id>", "primary": true}]}}\` (up to 4 buttons; each runs another action with \`"run"\` and \`"arg"\`, opens
  an http(s), mailto or laki:// link with \`"open"\`, or just closes; no buttons: OK).
  Like \`fetch\`, a shell command in the widget's folder with the same environment, so a script of the widget's works:
  \`"done": "python3 mark_done.py"\`, \`"open": "sh open.sh"\`.

## widget.html

\`\`\`html
<style> .x { color: var(--accent); } </style>
<template preview>
  <div class="tile"><div class="num {{#if data}}bad{{/if}}">{{data.length}}</div><div class="label">PRs with conflicts</div></div>
</template>
<template full>
  <table>
    <tr><th>Title</th><th>Created</th></tr>
    {{#each data}}<tr><td><a href="{{url}}">#{{number}} {{title}}</a></td><td>{{date createdAt}}</td></tr>
    {{else}}<tr><td colspan="2" class="muted">None.</td></tr>{{/each}}
  </table>
</template>
\`\`\`

- \`<template preview>\`: the sidebar's tile (keep it to a number and a word or two, or a chart). \`<template full>\`: the
  dialog a click on the tile opens (optional). Outside both: shared, a \`<style>\`. No templates: it's all the preview.
- Templates: \`{{a.b}}\` (escaped; a list's \`.length\`), \`{{#each list}}…{{else}}…{{/each}}\` (inside: the item's fields,
  \`{{this}}\`, \`{{@index}}\`, and the outer names), \`{{#if x}}…{{else}}…{{/if}}\`, \`{{#unless x}}…{{/unless}}\` (an empty list
  is false), \`{{date x}}\` (Sep 2, 2026), \`{{ago x}}\` (3 hours ago), \`{{spark list}}\` (a line chart of numbers, SVG).
  Names: \`data\` (the fetch's JSON), \`config\` (the settings, as in \`$LAKI_WIDGET_CONFIG\`), \`at\` (the last fetch, ms),
  \`error\`, \`full\`.
- Ready-made classes (use them before your own CSS: they follow the app's theme):
  - a number: \`tile\` (centered), \`num\`, \`label\`; text: \`muted\`, \`small\`, \`nowrap\`, \`ellipsis\`, \`title\`, \`sub\`,
    \`bad\`, \`good\`, \`warn\`; \`tag\` (a pill, for labels), \`badge\` (a count), \`dot\` (a status dot in the current color), \`spark\`;
  - layout: \`row\`, \`col\`, \`grow\`, \`wrap\`, \`fill\`, \`center\`; \`panel\` (a card); \`list\` (a \`<ul>\` of rows) or
    \`item\` rows; \`empty\` (nothing to show);
  - links: \`link\` (one that reads as text), \`linkbar\` (plain links in a line with a rule between them, wrapping;
    \`linkbar spread\`: they share the width);
  - buttons: plain (secondary), \`primary\`, \`quiet\`, \`danger\`, \`sm\`; tables and links are styled too.
- Colors: the app's theme variables, \`var(--fg)\`, \`var(--muted)\`, \`var(--accent)\`, \`var(--error)\`, \`var(--done)\`, \`var(--waiting)\`, \`var(--line)\`, \`var(--bg)\`, \`var(--panel)\`.
- Links open in the browser. \`data-laki="refresh"\` on an element fetches again; \`data-run\` runs an action (above).
- Without a \`<script>\` the widget is drawn inside the app: no scripts, frames, forms or \`on…\` attributes (they're removed).
- With a \`<script>\` it's a JS widget: its page runs in a sandboxed frame with no network (no fetch, no external
  scripts: inline everything) unless the user turns on its *Network access* (Settings › Extensions: then \`fetch()\` and
  images from https sites work, with CORS: the page's origin is \`null\`; get data in the fetch when you can, it always has
  the network, and say in \`description\` when the page needs it), and gets \`window.laki\`: \`data\`, \`config\`, \`at\`, \`error\`, \`full\`, \`refresh()\`,
  \`open(url)\`, \`expand()\` (the full view), \`run(action, arg)\`, \`toast(text)\`, \`modal({ title, text, buttons })\`
  (the same as an action's JSON; these only work right after a click in the widget). Templates are filled first, so both work. Use it for
  canvas charts, sorting, filtering; build HTML with your own escaping. Draw a canvas at a fixed size (its \`width\` and
  \`height\` attributes, CSS stretching it): the frame's size may not be known yet while the page runs.
`

// the prompt to paste into any AI chat: what's wanted, then all of the format, then how to answer; home: where the
// files go
export const widgetPrompt = (want: string, home: string) => `Make me a widget for Laki, a Mac app for running coding agents: a small live page in its sidebar, with a full view a click away, fed by a shell command or a JS script on a schedule.

What I want: ${want.trim() || '<describe what it should show, where the data comes from, and what a click should do>'}

Everything a widget is, below. Answer with the files (widget.json, widget.html, and the scripts it runs: its fetch, fetch.sh, fetch.py or fetch.mjs, and any its actions run), each in a code block headed by its file name, and a folder name for it (its id: lowercase, dashes). I'll put them in ${home}/<id>/ and press Reload in Settings › Extensions. Then tell me which settings to fill in, and what it fetches how often.

${widgetFormat()}`
