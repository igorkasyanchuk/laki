// How to make a widget, in words: the laki-widget skill's body (daemon/skill.ts) and the prompt Settings › Extensions
// copies for any AI chat (widgetPrompt). One text, so both say the same.

import { WIDGET_EVENTS } from './types.ts'
import { WIDGET_SCHEMA_URL } from './widgetSchema.ts'
import { CHARTS, COLORS, DO, TONES, UI, UI_EXAMPLES, UI_SAMPLES } from './widgetUi.ts'

export const WIDGET_EVERY = 5 // minutes between fetches when widget.json doesn't say

// the UI kit's catalog, from its table: each element's props in a line, then its sample
const catalog = () => UI_SAMPLES.map(s => `- \`${s.type}\` (${Object.keys(UI[s.type].props).join(', ') || 'no props'}): ${s.blurb}\n  \`${JSON.stringify(s.spec)}\``).join('\n')
// a few of the kit's examples: every chart kind, Laki's commands, a layout of a few elements
const examples = () => UI_EXAMPLES.filter(x => x.title !== 'Colors').map(x => `- ${x.title}: \`${JSON.stringify(x.spec)}\``).join('\n')

// widget.json, its ui and widget.html: all a widget is
export const widgetFormat = () => `## widget.json

\`\`\`json
{
  "name": "PRs with conflicts",
  "description": "One line: what it shows (Settings › Extensions shows it).",
  "size": [3, 1],
  "every": 5,
  "place": "side",
  "config": {
    "repo": { "label": "Repo", "hint": "owner/name" },
    "drafts": { "type": "bool", "label": "Include drafts", "default": true },
    "project": { "label": "Laki project", "hint": "the project a review opens in" }
  },
  "fetch": "sh fetch.sh",
  "actions": { "review": "\\"$LAKI_CLI\\" new \\"$WIDGET_PROJECT\\" --pr \\"$WIDGET_ARG\\" --prompt 'Review it'" },
  "ui": { "type": "list", "each": "prs", "title": "#{{number}} {{title}}", "subtitle": "{{ago createdAt}}", "href": "{{url}}", "actions": [{ "label": "Review", "run": "review", "arg": "{{url}}" }], "empty": "None" },
  "sample": { "prs": [{ "number": 412, "title": "Move billing to the new API", "url": "https://github.com/acme/web/pull/412", "createdAt": "2026-10-02T10:00:00Z" }] },
  "sampleConfig": { "repo": "acme/web" }
}
\`\`\`

- \`source\`: where its data comes from at first; the user picks another on its card: \`{ "kind": "fetch" }\` (its fetch or
  script, the default), \`{ "kind": "static", "text": "…" }\` (JSON, or words: \`{ text }\`, a Markdown note: \`ui\`
  \`{ "type": "markdown", "value": "{{text}}" }\`, no fetch at all), \`{ "kind": "file", "path": "~/notes/today.md" }\` or
  \`{ "kind": "url", "url": "https://…" }\` (read each \`every\` minutes: JSON is the data, anything else \`{ text }\`; a path
  or URL may say \`{{config.repo}}\`, \`{{workspace.path}}\`). A public JSON API needs no fetch: a URL source.
  \`{ "kind": "ai", "prompt": "Sum up #eng on Slack since yesterday: decisions, questions for me", "tools": "mcp__slack" }\`:
  an agent makes its data (Settings › Extensions' agent profile, claude or codex; \`"profile"\` names another), with the
  user's own MCP servers (Slack, Linear, Gmail…) and the tools named in \`tools\` (claude's, comma-separated: it may use
  them unasked, the rest are refused). It's told to change nothing and to end with the data as a json block in the
  shape of \`sample\` (none: \`{ text }\` in Markdown). Every hour unless \`every\` says (15 at least: each run costs).
  The way to give the user a summary of what an MCP server reaches, with no API key or script.
- \`sample\` (**required** with a \`fetch\`, a \`script\`, a file, a URL or an AI source): made-up data in exactly the shape the data takes, realistic and
  varied (one of each state it shows: a failing one, an approved one…): the user sees it before it ever runs
  (\`window.laki.sample\` is true then, and its buttons do nothing). \`sampleConfig\`: settings for that preview.
- \`size\`: cells [across 1–3, down 0.5 or 1–4]; a cell is about 70×64 px, 0.5 a line 29 px tall. \`every\`: minutes
  between fetches (default ${WIDGET_EVERY}). \`view\`: the full view's size, \`s\`, \`m\` (default) or \`l\`. The user can change them.
- \`place\`: one or a list: \`side\` (the sidebar's grid, the default), \`top\` or \`status\` (a bar: a line high, design it
  ½ high), \`rail\` or \`foot\` (a button, below), \`desk\` (a Desk tile, its full view when it has one).
- \`config\`: the settings the user fills in: a default (text, \`true\`/\`false\`, a number) or \`{ "type": text | number |
  bool | choice | list, "label", "hint", "default", "choices" }\`. Never hard-code a repo, login or token: make it a setting.
- \`fetch\`: a shell command (\`/bin/sh -c\` in the widget's folder: \`sh fetch.sh\`, \`python3 fetch.py\`), or \`script\`: a
  JS file Laki's node runs, \`export default async ({ config, last }) => data\` (\`last\`: the previous data). What it prints
  must be JSON: its data. To fail, exit non-zero with a line on stderr ("Set Repo in Settings › Extensions"): the last
  data stays. 2 minutes at most. Prefer what every Mac has (sh with curl, gh, jq; python3's standard library; a JS
  script) and shape the data there: small, with ready fields (\`"ci": "failing"\`): templates have no comparisons.
- Its env: \`$WIDGET_<NAME>\` per setting (\`repo\`: \`$WIDGET_REPO\`; an on/off \`1\` or empty, a list comma-joined; quote
  them), \`$LAKI_WIDGET_CONFIG\` (all of them, typed JSON), \`$LAKI_WIDGET_FILE\` (its storage: the last \`data\`),
  \`$LAKI_CLI\` (the laki command: \`"$LAKI_CLI" ls --json\`).
- \`actions\`: commands its buttons run by name, the button's arg as \`$WIDGET_ARG\` (never paste it into the command);
  then it fetches again. Its output's last line is a toast, or print JSON: \`{"toast": "Done"}\`, \`{"modal": {"title",
  "text", "buttons": [{"label", "run", "arg", "open", "primary"}]}}\` (4 buttons at most; \`open\`: http(s), mailto, laki://).
  An action may be an agent instead of a command: \`"draft": { "ai": "Draft a short reply to {{arg}}", "tools":
  "mcp__slack__post_message" }\` (\`{{arg}}\`, \`{{config.x}}\`, its data's fields and \`{{workspace.branch}}\` filled in; the
  agent of Settings › Extensions, with the user's MCP servers; \`tools\`: claude's it may use unasked). Its answer shows
  in a dialog, or its json block's \`toast\`, \`modal\` or \`data\` (the extension's new data); no fetch after it.
- \`notify\`: a template over its data, \`"{{#if mentions}}{{mentions}} new mentions{{/if}}"\`: after each fetch, when it
  reads as something new (not empty, not what it last said) Laki posts it as a notification and a toast.
- A **button** (in \`rail\` or \`foot\`, or with no preview at all): \`icon\` (Laki's by name: \`board\`, \`bell\`, \`clock\`,
  \`globe\`, \`github\`, \`pr\`, \`check\`, \`refresh\`, \`spec\`, \`bulb\`, \`timer\`, \`terminal\`, \`link\`, \`file\`, \`folder\`,
  \`smile\`…: \`laki widget kit icons\` lists every one; or an emoji), \`label\`, \`badge\` (a short count) and \`tip\`: templates over its data, as plain text
  (\`"badge": "{{#if open}}{{open}}{{/if}}"\`); \`click\`: one of its actions (none: its full view, else a fetch).
- \`"scope": "workspace"\`: one per workspace, for what's about the selected one (its branch's CI, its server, its PR):
  each workspace its own data, fetched while it's selected. Its fetch and actions get \`$LAKI_WORKSPACE\`,
  \`$LAKI_WORKSPACE_NAME\`, \`$LAKI_PROJECT\`, \`$LAKI_BRANCH\`, \`$LAKI_BASE\`, \`$LAKI_PATH\`, \`$PORT\`, \`$LAKI_PR\` (and
  \`$LAKI_STORAGE_FOLDER\`); a script \`workspace\`; templates and ui \`{{workspace.branch}}\`, \`{{workspace.port}}\`,
  \`{{workspace.pr}}\`, \`{{workspace.path}}\`; a JS page \`laki.workspace\`. Use it (\`--ws <id>\` checks one); the
  default, \`global\`, is one for everything.
- \`"on": { "turn.done": "<action>" | "refresh" }\`: events it answers, the event as JSON on stdin (and
  \`$LAKI_EVENT_FILE\`, \`$LAKI_EVENT\` its name): ${WIDGET_EVENTS.join(', ')}. Each has \`event\`, \`at\`, \`ws\`
  (\`{ id, name, project, branch, pr }\`), \`tab\` and its own fields (\`turn.done\`: \`last\`; \`pr.*\`: \`pr: { number, url, title }\`).
- An action that prints \`{"data": …}\` sets the data (\`"merge": true\`: over it) instead of a fetch.
- \`"stream": true\`: its fetch runs all along, each line of JSON it prints its data (a script: an async generator,
  each \`yield\`); global only, no \`every\`. \`laki widget push <id> '<json>'\` sets its data from outside.
- An action as a tool for agents: \`"go": { "run": "<command>", "tool": { "description": "…", "input": { "name":
  "string" | "number" | "boolean" | "string[]" }, "required": ["name"], "ask": "first" | "always" | "never" } }\`; its
  input as \`$WIDGET_INPUT_<NAME>\` and JSON on stdin, what it prints goes back to the agent. \`AGENTS.md\` in its folder
  says when to use them. Agents call it with \`laki widget tool <id> <action> '<json>'\` or MCP; Laki asks the user
  (first: once per workspace). Never \`never\` for a command that changes things outside this Mac.

## Fixtures and the check

- Write \`fixtures/sample.json\` (the sample, as its fetch would print it), \`fixtures/empty.json\` (nothing to show)
  and, when its data can vary, three more made-up variants a person would want to see it with (\`fixtures/busy.json\`:
  a lot of it; a quiet or all-good one; an odd one: a long title, a huge number, a failure): its preview's Sample ▾ and
  its Data tab show each, and the check fits the ui to each.
- After every write, check it (\`laki_extension_check\`, or \`laki widget check <id> --no-run\`) and fix every ✗ before
  you answer; a ! is a hint (a field no row has, an icon it doesn't know).
- \`"$schema": "${WIDGET_SCHEMA_URL}"\` in widget.json lets an
  editor complete and check it.
- One file is a whole extension too: \`prs.5m.sh\` (its id, how often: \`5m\`, \`1h\`), executable or with a \`#!\` line,
  printing JSON, its widget.json in comment lines: \`<laki.name>PRs</laki.name>\`, \`<laki.place>status</laki.place>\`,
  \`<laki.size>2x1</laki.size>\`, \`<laki.ui>{"type": "text", "value": "{{n}} open"}</laki.ui>\`, \`<laki.sample>{"n": 3}</laki.sample>\`, settings as
  \`<laki.var>text(REPO="acme/web"): Repo</laki.var>\` (text, number, bool, choice(a,b)), \`$WIDGET_REPO\` in it.

## The UI kit: "ui" (prefer it)

\`ui\` is one element (the preview, and the full view with every row) or \`{ "preview": element, "full": element }\`. An
element is \`{ "type", …props }\`; each also takes \`if\` / \`unless\` (a path or a template: shown when truthy or falsy;
an empty list is false), \`each\` (a path: it repeats per item; a list, table, chart… takes its rows from it), \`tip\` and
\`tone\` (good, bad, warn, accent, muted, or a map from its text: \`{"failed": "bad"}\`). String props are templates over
\`{ ...data, data, config, at, error, full }\` (in a row: the item's fields, \`this\`, \`@index\`); paths (each, items,
values) are looked up as they are. It fits every size, bar and theme, a failed fetch shows its error and Retry, and
its links, buttons and filters work. Use widget.html only for a look the kit can't make.

- **Colors**: a \`color\` prop (text, heading, icon, badge, spark, progress, gauge, heatmap, header's icon, stat's and tags' dot)
  takes a tone (${TONES.join(', ')}), one of Laki's palette (${COLORS.join(', ')}: each theme's own) or a hex
  (\`d73a4a\`: a GitHub label's), or a template giving one (\`"{{#if red}}bad{{else}}good{{/if}}"\`). Prefer tones for
  meaning (bad: failing) and the palette for kinds; a hex only for a color that comes with the data.
- **Charts**: \`kind\` ${CHARTS.join(', ')}. One number per row (\`y\`), or \`series\` (\`[{ "label", "y", "color" }]\`: lines,
  bars, stacked); pie, donut and hbars a slice or bar per row, its label \`x\`; scatter \`x\` and \`y\` numbers. \`colors\`: the
  order of colors; a row's \`color\` template or a \`tone\` map over \`x\` colors each; \`legend\`, \`unit\`, \`min\`, \`max\`.
- **Buttons** (\`button\`, \`actions\`, a list's \`actions\`, \`header\` and \`footer\` \`actions\`, \`toolbar\` \`items\`): \`run\`
  (one of its actions), \`open\` (a link), \`refresh\`, \`full\`, \`copy\`, or \`do\`, a Laki command, asked first: ${DO.map(d => `\`${d}\``).join(', ')}
  (\`new\`: a workspace whose agent starts on \`prompt\`, in \`project\` (a name; none: the selected one's) with \`agent\`
  (none: the default); \`send\`: \`prompt\` to the selected workspace's agent; \`ai\`: \`prompt\` to Laki AI; \`terminal\`:
  \`command\` in a new terminal; \`browse\`: \`url\` in a Laki browser tab). A JS page: \`laki.do({ do, prompt… })\`.
  A \`toggle\` is a switch: its \`run\` gets \`on\` or \`off\` (what it's turned to) as \`$WIDGET_ARG\`, its \`on\` reads the state back.
  A \`segmented\` runs its \`run\` with the option picked (\`value\` reads it back); a \`stepper\` with the new number (\`min\`, \`max\`, \`step\`).
- **Layouts**: a \`header\` (icon, title, buttons), the body, a \`footer\` (muted words, buttons) in a \`stack\`; a
  \`toolbar\` of icon buttons; a \`spacer\` pushes what follows it in a \`row\` to the end.

${catalog()}

Examples:

${examples()}

## widget.html (a custom look)

- \`<template preview>…</template>\` (the tile) and \`<template full>…</template>\` (a click away); outside both: shared (a
  \`<style>\`); no templates: all of it is the preview. Its own view wins over \`ui\`'s; \`ui\` fills the one it lacks.
- Templates: \`{{a.b}}\` (escaped; a list's \`.length\`), \`{{#each list}}…{{else}}…{{/each}}\`, \`{{#if x}}…{{else}}…{{/if}}\`,
  \`{{#unless x}}\`, and helpers \`{{date x}}\`, \`{{ago x}}\`, \`{{num x}}\` (1.2k), \`{{pct x}}\` (42%), \`{{bytes x}}\`,
  \`{{dur ms}}\` (2m 3s), \`{{upper x}}\`, \`{{lower x}}\`, \`{{spark list}}\` (an SVG line); ui's props take them too. Names:
  \`data\`, \`config\`, \`at\`, \`error\`, \`full\`, \`sample\`.
- Classes that follow the theme: \`tile\`, \`num\`, \`label\`, \`muted\`, \`small\`, \`bad\`, \`good\`, \`warn\`, \`tag\`, \`badge\`,
  \`row\`, \`col\`, \`grow\`, \`list\`, \`item\`, \`panel\`, \`link\`, \`linkbar\`; buttons \`primary\`, \`quiet\`, \`danger\`, \`sm\`;
  colors \`var(--fg)\`, \`--muted\`, \`--accent\`, \`--error\`, \`--done\`, \`--waiting\`, \`--line\`.
- Links open in the browser; \`data-laki="refresh"\` fetches; \`data-run="review" data-arg="{{url}}"\` runs an action.
  Without a script it's drawn in the app: scripts, frames, forms and \`on…\` attributes are removed.
- With a \`<script>\`: a page in a sandboxed frame with no network (unless the user turns on its Network access) and
  \`window.laki\`: \`data\`, \`config\`, \`at\`, \`error\`, \`full\`, \`refresh()\`, \`open(url)\`, \`expand()\`, \`run(action, arg)\`, \`do(cmd)\`,
  \`toast(text)\`, \`modal({…})\` (these right after a click), \`ui(spec, data)\` and \`mount(el, spec, data)\` (the kit's
  HTML). Inline everything; draw a canvas at a fixed size.
`

// how Laki AI makes one (ai.ts' SYSTEM: questions first); desk: the Desk's Build with Laki AI, so not where it sits
const howMake = (desk?: boolean) =>
  `Before you write anything, ask me at least 2 questions about it, one at a time with laki_ask (each with options to tap): what it shows and where its data comes from (a command, a file, a URL, or text I type), ${desk ? '' : "where it sits (the sidebar, the top bar, the status bar, or a button on the rail or in the sidebar's foot), "}what a click does, how often it refreshes. Then make it: laki_extension_guide, an example with laki_extension_read, laki_extension_write (its ui from the UI kit, with a sample in widget.json: its preview).${desk ? ' It goes on my Desk: "place": "desk" in widget.json, a tile there.' : ''} It's saved off; I look at it and turn it on. Then I may ask for changes: write it again under the same id.`

// the Desk's Build with Laki AI: the ask the floating chat gets
export const widgetAsk = (want: string, desk?: boolean) => `Make me a Laki extension: ${want.trim()}

${howMake(desk)}`

// the Extension page's Laki AI (its chat beside the preview and settings): where the user is, with each ask, for the
// model. w: the one open there (mine: in Laki's folder, so it may rewrite it: widgetSet ai); none: New extension
export const widgetHere = (w?: { id: string; name: string; mine: boolean }) =>
  w
    ? `On the page of my Laki extension "${w.name}" (id ${w.id}): its preview (live, and with its sample data) and its settings are beside this chat. "It" and "this" mean this extension. ${
        w.mine
          ? `To change it: laki_extension_read first (laki_extension_guide for the format), then laki_extension_write the files you change under the same id, its sample in widget.json kept in step with what the fetch prints. Keep what I didn't ask to change; tell me in a line what changed. It's saved off: I look at the preview, then turn it on.`
          : "You can't rewrite this one (it comes with Laki, or it's in a folder of my own): to change it, make a copy under a new id."
      }`
    : `On the New extension page: I describe a Laki extension for you to make; it shows on this page, with its sample data, once written. ${howMake()}`

// the prompt to paste into any AI chat: what's wanted, then all of the format, then how to answer; home: where the
// files go
export const widgetPrompt = (want: string, home: string) => `Make me a widget for Laki, a Mac app for running coding agents: a small live page in its sidebar, with a full view a click away, fed by a shell command or a JS script on a schedule.

What I want: ${want.trim() || '<describe what it should show, where the data comes from, and what a click should do>'}

Everything a widget is, below. Answer with the files (widget.json with its ui, widget.html only for a custom look, and the scripts it runs: its fetch, fetch.sh, fetch.py or fetch.mjs, and any its actions run), each in a code block headed by its file name, and a folder name for it (its id: lowercase, dashes). I'll put them in ${home}/<id>/ and press Reload in Settings › Extensions. Then tell me which settings to fill in, and what it fetches how often.

${widgetFormat()}`
