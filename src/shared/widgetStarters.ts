// laki widget new <name> --kind <k> (widgetNew, Settings › Extensions › New ▾): an extension that runs at once, with no
// network: its fetch prints fixtures/sample.json (fetch.sh says what to put there instead), fixtures/empty.json beside
// it, "$schema" for the editor, a README with the next steps. The UI kit's samples (widgetUi.ts) are the looks.
import { LAKI_DTS, WIDGET_SCHEMA_URL } from './widgetSchema.ts'
import { UI_SAMPLES, type UiType } from './widgetUi.ts'

type Files = Record<string, string>
type Starter = { title: string; blurb: string; files: (id: string, name: string) => Files }
const sample = (t: UiType) => UI_SAMPLES.find(s => s.type === t)!
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

// fetch.sh: the sample now, the real thing in its comments
const fetchSh = (real: string) => `#!/bin/sh
# What this prints (JSON) is the extension's data; it runs in this folder every few minutes, with
# $WIDGET_<NAME> for each setting and $LAKI_REFRESH_REASON (schedule, dev, manual…).
# Now it prints the sample, so it works at once. The real thing, for example:
${real
  .trim()
  .split('\n')
  .map(l => `#   ${l}`)
  .join('\n')}
cat fixtures/sample.json
`
const readme = (id: string, name: string, more = '') => `# ${name}

A Laki extension. Its data comes from \`fetch.sh\` (now: \`fixtures/sample.json\`); what it shows is \`ui\` in widget.json
(the UI kit: Settings › Extensions › UI kit, or \`laki widget kit\`).${more}

- \`laki widget dev .\` here: on, reloaded as you save, each fetch printed as it runs.
- \`laki widget check ${id}\`: what's wrong with it, its fetch run once.
- Its page (a right click on it › Inspect): its data (try \`fixtures/empty.json\`), runs, env and files.
`
// a starter of a UI kit look: widget.json with its ui, the fetch, the fixtures, the README
function kit(o: { spec: unknown; data: unknown; empty: unknown; real: string; size?: [number, number]; actions?: Record<string, string>; place?: string; extra?: Record<string, unknown> }) {
  return (id: string, name: string): Files => ({
    'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'Made from a starter: change its fetch and its ui', every: 5, size: o.size ?? [3, 2], ...(o.place && { place: o.place }), fetch: 'sh fetch.sh', ...o.extra, ui: o.spec, ...(o.actions && { actions: o.actions }), sample: o.data }),
    'fetch.sh': fetchSh(o.real),
    'fixtures/sample.json': json(o.data),
    'fixtures/empty.json': json(o.empty),
    'README.md': readme(id, name),
  })
}
const toast = (what: string) => `printf '{"toast": "${what}: %s"}' "$WIDGET_ARG"`

export const STARTER_KINDS = ['number', 'list', 'table', 'chart', 'button', 'form', 'panel', 'workspace', 'onefile'] as const
export type StarterKind = (typeof STARTER_KINDS)[number]

export const STARTERS: Record<StarterKind, Starter> = {
  number: {
    title: 'A number',
    blurb: 'A count with its label, a change and a sparkline',
    files: kit({ spec: sample('stat').spec, data: sample('stat').data, empty: {}, size: [2, 1], real: `curl -fsS "https://api.example.com/stats" | jq '{visits: .today, change: .delta, week: .last7}'` }),
  },
  list: {
    title: 'A list',
    blurb: 'Rows with avatars, tags and a button each; grouped, filtered, +N more',
    files: kit({ spec: sample('list').spec, data: sample('list').data, empty: { prs: [] }, real: `gh pr list --json number,title,author,url,updatedAt,state \\\n  --jq '{prs: [.[] | {number, title, url, updated: .updatedAt, state, author: .author.login, ci: "passing"}]}'`, actions: { review: toast('Review') } }),
  },
  table: {
    title: 'A table',
    blurb: 'Columns, sorted, a filter box; columns that hide when narrow',
    files: kit({ spec: sample('table').spec, data: sample('table').data, empty: { prs: [] }, real: `gh pr list --json number,title,author,url,updatedAt \\\n  --jq '{prs: [.[] | {number, title, url, updated: .updatedAt, author: .author.login, ci: "pending"}]}'` }),
  },
  chart: {
    title: 'A chart',
    blurb: 'A line, area or bars from a list of numbers',
    files: kit({ spec: sample('chart').spec, data: sample('chart').data, empty: { days: [] }, real: `curl -fsS "https://api.example.com/latency?days=5" | jq '{days: [.[] | {day: .label, ms: .p95}]}'` }),
  },
  button: {
    title: 'A button',
    blurb: 'An icon on the rail with a count; a click runs its action',
    files: (id, name) => ({
      'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'A rail button: its badge from the data, a click runs open', place: 'rail', icon: 'bell', label: name, badge: '{{#if count}}{{count}}{{/if}}', tip: '{{count}} waiting', every: 5, fetch: 'sh fetch.sh', click: 'open', actions: { open: `printf '{"toast": "%s waiting"}' "$(jq -r .count fixtures/sample.json 2>/dev/null || echo some)"` }, sample: { count: 3 } }),
      'fetch.sh': fetchSh(`gh search prs --review-requested @me --state open --json number --jq '{count: length}'`),
      'fixtures/sample.json': json({ count: 3 }),
      'fixtures/empty.json': json({ count: 0 }),
      'README.md': readme(id, name, ' As a button it has no ui: its icon, `label`, `badge` and `tip` are templates over its data, and `click` runs one of its actions.'),
    }),
  },
  form: {
    title: 'A form',
    blurb: 'Fields and a button: an action gets them as JSON',
    files: kit({ spec: { type: 'stack', children: [{ type: 'heading', value: 'New issue', level: 3 }, sample('form').spec, { type: 'text', value: 'Last: {{last}}', muted: true, if: 'last' }] }, data: { last: '' }, empty: {}, size: [3, 3], real: 'echo \'{"last": ""}\'', actions: { file: `# $WIDGET_ARG: the form's fields as JSON ({"title": …, "urgent": …, "team": …})\n${toast('Would file')}` } }),
  },
  panel: {
    title: 'A JS page',
    blurb: 'A script of your own that draws with the UI kit (laki.mount)',
    files: (id, name) => ({
      'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'A JS page: widget.html’s script draws it with laki.mount', every: 5, size: [3, 2], fetch: 'sh fetch.sh', sample: sample('stats').data }),
      'widget.html': `<template preview><div id="app"></div></template>
<template full><div id="app"></div></template>
<script>
  // window.laki is typed in laki.d.ts (// @ts-check in your editor). The page has no network: its data comes from
  // fetch.sh. laki.mount draws a UI kit element, its buttons and links working. (Don't write double braces in here:
  // widget.html is a template, the daemon would fill them; build the values in JS, as below.)
  const stats = { type: 'stats', items: (laki.data?.stats ?? []).map(s => ({ value: String(s.n), label: s.name, tone: s.bad ? 'bad' : undefined })) }
  const spec = laki.full ? { type: 'stack', children: [{ type: 'heading', value: ${JSON.stringify(name)}, level: 3 }, stats, { type: 'text', value: laki.at ? 'fetched ' + new Date(laki.at).toLocaleTimeString() : 'not fetched yet', muted: true }] } : stats
  laki.mount(document.getElementById('app'), spec)
</script>
`,
      'laki.d.ts': LAKI_DTS,
      'fetch.sh': fetchSh(`gh pr list --json isDraft --jq '{stats: [{name: "open", n: length}, {name: "drafts", n: map(select(.isDraft)) | length}]}'`),
      'fixtures/sample.json': json(sample('stats').data),
      'fixtures/empty.json': json({ stats: [] }),
      'README.md': readme(id, name, ' Its look is `widget.html`: a script that draws with `laki.mount` (types: `laki.d.ts`).'),
    }),
  },
  workspace: {
    title: 'This branch',
    blurb: 'Per workspace: the selected one’s branch, PR, port and path, and a link to its server',
    files: kit({
      extra: { scope: 'workspace' },
      size: [3, 2],
      spec: {
        type: 'stack',
        children: [
          { type: 'kv', mono: true, items: [{ key: 'Branch', value: '{{workspace.branch}}', copy: true }, { key: 'Ahead', value: '{{commits}} commits on {{workspace.base}}' }, { key: 'PR', value: '{{workspace.pr}}', if: 'workspace.pr' }, { key: 'Port', value: '{{workspace.port}}' }, { key: 'Path', value: '{{workspace.path}}', copy: true }] },
          { type: 'links', items: [{ label: 'localhost:{{workspace.port}}', href: 'http://localhost:{{workspace.port}}' }, { label: 'Its PR', href: '{{workspace.pr}}', if: 'workspace.pr' }] },
        ],
      },
      data: { commits: 3 },
      empty: { commits: 0 },
      real: `# per workspace: $LAKI_BRANCH, $LAKI_BASE, $LAKI_PATH, $PORT, $LAKI_PR are the selected workspace's
printf '{"commits": %s}' "$(git -C "$LAKI_PATH" rev-list --count "$LAKI_BASE..HEAD" 2>/dev/null || echo 0)"`,
    }),
  },
  onefile: {
    title: 'One file',
    blurb: 'A script whose name says how often it runs (status.5m.sh), its settings in comments',
    files: id => ({
      [`${id}.5m.sh`]: `#!/bin/sh
# One file is a whole extension: its name says its id and how often it runs (5m: every 5 minutes; 1h…),
# these lines say the rest (sample: made-up data for its preview). What it prints (JSON) is its data. Settings come
# as $WIDGET_<NAME>.
# <laki.name>${id}</laki.name>
# <laki.description>Made from the one-file starter</laki.description>
# <laki.place>status</laki.place>
# <laki.size>2x1</laki.size>
# <laki.label>{{msg}}</laki.label>
# <laki.var>text(GREETING="hello"): Greeting</laki.var>
# <laki.ui>{"type": "text", "value": "{{msg}}"}</laki.ui>
# <laki.sample>{"msg": "hello · 09:41"}</laki.sample>
printf '{"msg": "%s · %s"}' "$WIDGET_GREETING" "$(date +%H:%M)"
`,
    }),
  },
}
