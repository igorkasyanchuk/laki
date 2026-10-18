// laki widget new <name> --kind <k> (widgetNew, Settings › Extensions › New ▾): an extension that runs at once, with no
// network: its fetch prints fixtures/sample.json (fetch.sh says what to put there instead), fixtures/empty.json and
// three more made-up variants beside it (its page's Sample ▾), "$schema" for the editor, a README with the next steps.
// The UI kit's samples (widgetUi.ts) are the looks.
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
- Its page (a right click on it › Inspect): its data (try \`fixtures/empty.json\` and the other fixtures: made-up
  variants its preview's Sample ▾ shows), runs, env and files.
`
// a starter of a UI kit look: widget.json with its ui, the fetch, the fixtures, the README
function kit(o: { spec: unknown; data: unknown; empty: unknown; more: Record<string, unknown>; real: string; size?: [number, number]; actions?: Record<string, string>; place?: string; extra?: Record<string, unknown> }) {
  return (id: string, name: string): Files => ({
    'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'Made from a starter: change its fetch and its ui', every: 5, size: o.size ?? [3, 2], ...(o.place && { place: o.place }), fetch: 'sh fetch.sh', ...o.extra, ui: o.spec, ...(o.actions && { actions: o.actions }), sample: o.data }),
    'fetch.sh': fetchSh(o.real),
    'fixtures/sample.json': json(o.data),
    'fixtures/empty.json': json(o.empty),
    ...variants(o.more),
    'README.md': readme(id, name),
  })
}
// an API's token: a secret setting (Settings › Extensions keeps it out of the app; the fetch gets $WIDGET_APITOKEN)
const TOKEN = { apiToken: { type: 'secret', label: 'API token', hint: 'Its fetch gets it as $WIDGET_APITOKEN' } }
// made-up variants beside the sample: fixtures/<name>.json, each a case worth a look (busy, quiet, an odd one)
const variants = (more: Record<string, unknown>): Files => Object.fromEntries(Object.entries(more).map(([n, v]) => [`fixtures/${n}.json`, json(v)]))
const pr = (number: number, title: string, author: string, ci: string, state: string, updated: string, labels: string[] = []) => ({ number, title, url: `https://github.com/acme/web/pull/${number}`, author, ci, state, updated: `2026-10-${updated}Z`, labels })
const PRS = {
  many: { prs: [pr(431, 'Split the checkout into steps', 'octocat', 'failing', 'Failing CI', '16T09:00:00', ['feature']), pr(433, 'Upgrade React to 19', 'hubot', 'pending', 'In review', '15T11:00:00'), pr(436, 'Rename orders to purchases', 'monalisa', 'passing', 'Approved', '14T16:00:00', ['refactor']), pr(438, 'Cache the product images', 'octocat', 'passing', 'In review', '17T08:00:00', ['feature']), pr(440, 'Fix the flaky login test', 'defunkt', 'failing', 'Failing CI', '17T07:30:00', ['bug']), pr(442, 'Show tax in the cart', 'hubot', 'passing', 'Approved', '13T10:00:00', ['feature']), pr(444, 'Log slow queries', 'mojombo', 'pending', 'In review', '17T09:10:00'), pr(446, 'Paginate the audit log', 'monalisa', 'passing', 'In review', '12T15:00:00', ['bug'])] },
  green: { prs: [pr(450, 'Show tax in the cart', 'hubot', 'passing', 'Approved', '16T10:00:00', ['feature']), pr(451, 'Fix the date picker on Safari', 'octocat', 'passing', 'Approved', '15T10:00:00', ['bug']), pr(452, 'Retry webhooks with backoff', 'monalisa', 'passing', 'Approved', '17T10:00:00')] },
  one: { prs: [pr(460, 'Hotfix: payments time out after the deploy, roll back the client and add a retry around the charge call', 'defunkt', 'failing', 'Failing CI', '17T09:40:00', ['bug', 'p1'])] },
}
const toast = (what: string) => `printf '{"toast": "${what}: %s"}' "$WIDGET_ARG"`

const NOTE = `## This week

- [x] Ship **search v2**
- [ ] Renew the staging cert

Runbook: [wiki/oncall](https://example.com/wiki/oncall)
`
// the launcher's buttons: Laki's commands (the app asks before each)
const LAUNCH = {
  type: 'stack',
  children: [
    { type: 'header', icon: 'run', title: '{{config.project}}', subtitle: 'Its buttons start things in Laki; it asks first' },
    {
      type: 'grid',
      columns: 2,
      children: [
        { type: 'button', label: 'Fix a flaky test', icon: 'agent', do: 'new', project: '{{config.project}}', prompt: 'Find and fix the flakiest test in this repo' },
        { type: 'button', label: 'Ask the agent', icon: 'run', do: 'send', prompt: 'Run the tests and tell me what fails' },
        { type: 'button', label: 'Ask Laki AI', icon: 'ai', do: 'ai', prompt: 'Which of my workspaces need me now?' },
        { type: 'button', label: 'Disk usage', icon: 'terminal', do: 'terminal', command: 'df -h /' },
        { type: 'button', label: 'Open the docs', icon: 'globe', do: 'browse', url: 'https://github.com/igorkasyanchuk/laki' },
      ],
    },
  ],
}

export const STARTER_KINDS = ['number', 'list', 'table', 'chart', 'note', 'launcher', 'button', 'form', 'panel', 'workspace', 'stream', 'tool', 'onefile'] as const
export type StarterKind = (typeof STARTER_KINDS)[number]

export const STARTERS: Record<StarterKind, Starter> = {
  number: {
    title: 'A number',
    blurb: 'A count with its label, a change and a sparkline',
    files: kit({ spec: sample('stat').spec, data: sample('stat').data, empty: {}, more: { spike: { visits: 48210, change: '+276%', week: [8, 9, 7, 11, 10, 12, 48] }, drop: { visits: 3120, change: '-74%', week: [12, 13, 11, 12, 14, 12, 3] }, flat: { visits: 12000, change: '0%', week: [12, 12, 12, 12, 12, 12, 12] } }, size: [2, 1], extra: { config: TOKEN }, real: `curl -fsS -H "Authorization: Bearer $WIDGET_APITOKEN" "https://api.example.com/stats" | jq '{visits: .today, change: .delta, week: .last7}'` }),
  },
  list: {
    title: 'A list',
    blurb: 'Rows with avatars, tags and a button each; grouped, filtered, +N more',
    files: kit({ spec: sample('list').spec, data: sample('list').data, empty: { prs: [] }, more: PRS, real: `gh pr list --json number,title,author,url,updatedAt,state \\\n  --jq '{prs: [.[] | {number, title, url, updated: .updatedAt, state, author: .author.login, ci: "passing"}]}'`, actions: { review: toast('Review') } }),
  },
  table: {
    title: 'A table',
    blurb: 'Columns, sorted, a filter box; columns that hide when narrow',
    files: kit({ spec: sample('table').spec, data: sample('table').data, empty: { prs: [] }, more: PRS, real: `gh pr list --json number,title,author,url,updatedAt \\\n  --jq '{prs: [.[] | {number, title, url, updated: .updatedAt, author: .author.login, ci: "pending"}]}'` }),
  },
  chart: {
    title: 'A chart',
    blurb: 'Lines, areas, bars, stacked, horizontal, pie, donut or scatter',
    files: kit({ spec: sample('chart').spec, data: sample('chart').data, empty: { days: [] }, more: { spike: { days: [{ day: 'Mon', ms: 310 }, { day: 'Tue', ms: 290 }, { day: 'Wed', ms: 1840 }, { day: 'Thu', ms: 420 }, { day: 'Fri', ms: 300 }] }, steady: { days: [{ day: 'Mon', ms: 250 }, { day: 'Tue', ms: 252 }, { day: 'Wed', ms: 248 }, { day: 'Thu', ms: 251 }, { day: 'Fri', ms: 249 }] }, week: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({ day, ms: [320, 280, 410, 300, 260, 120, 90][i] })) } }, extra: { config: TOKEN }, real: `curl -fsS -H "Authorization: Bearer $WIDGET_APITOKEN" "https://api.example.com/latency?days=5" | jq '{days: [.[] | {day: .label, ms: .p95}]}'` }),
  },
  note: {
    title: 'A note',
    blurb: 'Markdown you type on its card, or from a file or a URL: lists, links, pictures',
    files: (id, name) => ({
      'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'Markdown: its text on its card (Data: Static), or a file or a URL', size: [3, 2], source: { kind: 'static', text: NOTE }, ui: { type: 'markdown', value: '{{text}}' }, sample: { text: NOTE } }),
      'fixtures/sample.json': json({ text: NOTE }),
      ...variants({ todo: { text: '## Today\n\n- [x] Review #412\n- [ ] Answer the API question\n- [ ] Deploy the docs\n- [ ] 1:1 at 15:00' }, table: { text: '## On call\n\n| Week | Who |\n|---|---|\n| 42 | octocat |\n| 43 | hubot |\n| 44 | monalisa |' }, links: { text: '## Links\n\n![octocat](https://avatars.githubusercontent.com/octocat?s=48) [Runbook](https://example.com/runbook) · [Status](https://status.example.com) · [Dashboards](https://example.com/grafana)' } }),
      'README.md': `# ${name}\n\nA Laki extension that shows Markdown. Its card (Settings › Extensions) says where the text comes from: Static (typed there), File (\`~/notes/today.md\`, read each time) or URL. A file or a URL that gives JSON is data for a \`ui\` of your own instead.\n`,
    }),
  },
  launcher: {
    title: 'A launcher',
    blurb: 'Buttons that start Laki things: a workspace, a prompt, Laki AI, a terminal, a page',
    files: (id, name) => ({
      'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'Buttons with do: Laki says what each will do and asks first', size: [3, 2], config: { project: { type: 'text', label: 'Project', hint: 'Its name: where Fix a flaky test starts', default: '' } }, sampleConfig: { project: 'web' }, ui: LAUNCH }),
      'README.md': `# ${name}\n\nA Laki extension of buttons that ask Laki to do things (\`do\`): \`new\` (a workspace, its agent on \`prompt\`), \`send\` (\`prompt\` to the workspace's agent), \`ai\` (\`prompt\` to Laki AI), \`terminal\` (\`command\`), \`browse\` (\`url\`). Laki shows what and asks before each.\n`,
    }),
  },
  button: {
    title: 'A button',
    blurb: 'An icon on the rail with a count; a click runs its action',
    files: (id, name) => ({
      'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'A rail button: its badge from the data, a click runs open', place: 'rail', icon: 'bell', label: name, badge: '{{#if count}}{{count}}{{/if}}', tip: '{{count}} waiting', every: 5, fetch: 'sh fetch.sh', click: 'open', actions: { open: `printf '{"toast": "%s waiting"}' "$(jq -r .count fixtures/sample.json 2>/dev/null || echo some)"` }, sample: { count: 3 } }),
      'fetch.sh': fetchSh(`gh search prs --review-requested @me --state open --json number --jq '{count: length}'`),
      'fixtures/sample.json': json({ count: 3 }),
      'fixtures/empty.json': json({ count: 0 }),
      ...variants({ one: { count: 1 }, many: { count: 27 }, lots: { count: 1200 } }),
      'README.md': readme(id, name, ' As a button it has no ui: its icon, `label`, `badge` and `tip` are templates over its data, and `click` runs one of its actions.'),
    }),
  },
  form: {
    title: 'A form',
    blurb: 'Fields and a button: an action gets them as JSON',
    files: kit({ spec: { type: 'stack', children: [{ type: 'heading', value: 'New issue', level: 3 }, sample('form').spec, { type: 'text', value: 'Last: {{last}}', muted: true, if: 'last' }] }, data: { last: '' }, empty: {}, more: { filed: { last: '#512 Login loops on Safari' }, urgent: { last: '#513 Checkout returns 500 (urgent)' }, long: { last: '#514 The CSV export drops every row after the first thousand when a filter is on, on every browser we tried' } }, size: [3, 3], real: 'echo \'{"last": ""}\'', actions: { file: `# $WIDGET_ARG: the form's fields as JSON ({"title": …, "urgent": …, "team": …})\n${toast('Would file')}` } }),
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
      ...variants({ busy: { stats: [{ name: 'open', n: 24 }, { name: 'drafts', n: 5 }, { name: 'conflicts', n: 4, bad: true }, { name: 'bug', n: 9, color: 'd73a4a' }] }, clean: { stats: [{ name: 'open', n: 3 }, { name: 'drafts', n: 0 }, { name: 'conflicts', n: 0 }] }, labels: { stats: [{ name: 'open', n: 6 }, { name: 'bug', n: 3, color: 'd73a4a' }, { name: 'p1', n: 2, color: 'b60205' }, { name: 'needs-review', n: 4, color: 'fbca04' }] } }),
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
      more: { one: { commits: 1 }, many: { commits: 27 }, lots: { commits: 240 } },
      real: `# per workspace: $LAKI_BRANCH, $LAKI_BASE, $LAKI_PATH, $PORT, $LAKI_PR are the selected workspace's
printf '{"commits": %s}' "$(git -C "$LAKI_PATH" rev-list --count "$LAKI_BASE..HEAD" 2>/dev/null || echo 0)"`,
    }),
  },
  stream: {
    title: 'A stream',
    blurb: 'A command that runs all along: each line of JSON it prints shows at once',
    files: (id, name) => ({
      'widget.json': json({ $schema: WIDGET_SCHEMA_URL, name, description: 'A stream: stream.sh prints a line of JSON every 2 s, each shown as it comes', size: [2, 1], stream: true, fetch: 'sh stream.sh', ui: { type: 'stat', value: '{{n}}', label: 'ticks · {{time}}' }, sample: { n: 42, time: '09:41:07' } }),
      'stream.sh': `#!/bin/sh
# A stream: this runs all along while Laki's window is open (and starts again if it ends). Each line of JSON it prints
# is the extension's data, shown at once; other lines go to its log. The real thing, for example:
#   tail -F /var/log/deploy.log | jq -c --unbuffered '{last: .message, at: .time}'
#   kubectl get pods -w -o json | jq -c --unbuffered '{pod: .metadata.name, phase: .status.phase}'
i=0
while :; do
  i=$((i + 1))
  printf '{"n": %s, "time": "%s"}\n' "$i" "$(date +%H:%M:%S)"
  sleep 2
done
`,
      'fixtures/sample.json': json({ n: 42, time: '09:41:07' }),
      'fixtures/empty.json': json({ n: 0, time: '' }),
      ...variants({ first: { n: 1, time: '09:00:02' }, noon: { n: 2048, time: '12:00:00' }, big: { n: 98231, time: '23:59:58' } }),
      'README.md': readme(id, name, ' It streams (`"stream": true`): `stream.sh` runs all along, each line of JSON it prints its data.'),
    }),
  },
  tool: {
    title: 'A tool for agents',
    blurb: 'Notes your agents add through a tool (laki widget tool, MCP), asked once per workspace',
    files: (id, name) => {
      const notes = { notes: [{ text: 'Ask Dana about the rate limit' }, { text: 'The login test is flaky on CI' }] }
      return {
        'widget.json': json({
          $schema: WIDGET_SCHEMA_URL,
          name,
          description: 'Notes your agents add with its add tool',
          every: 5,
          size: [3, 2],
          fetch: 'sh fetch.sh',
          actions: {
            add: { run: 'sh add.sh', tool: { description: 'Add a note to the Notes list the user sees in Laki', input: { text: { type: 'string', description: 'The note: one short line' } }, required: ['text'], ask: 'first' } },
            clear: 'rm -f notes.txt',
          },
          ui: { type: 'stack', children: [{ type: 'list', each: 'notes', title: '{{text}}', empty: 'No notes yet: an agent adds them with its add tool' }, { type: 'button', label: 'Clear', run: 'clear', confirm: 'Clear every note?', if: 'notes.length' }] },
          sample: notes,
        }),
        'fetch.sh': `#!/bin/sh
# What this prints (JSON) is the extension's data: notes.txt, a note per line (add.sh writes it)
[ -f notes.txt ] || : > notes.txt
awk 'BEGIN { printf "{\\"notes\\": [" } { gsub(/\\\\/, "\\\\\\\\"); gsub(/"/, "\\\\\\""); printf "%s{\\"text\\": \\"%s\\"}", (NR > 1 ? ", " : ""), $0 } END { print "]}" }' notes.txt
`,
        'add.sh': `#!/bin/sh
# The add tool: an agent runs it (laki widget tool ${id} add '{"text": "…"}', or its MCP tool), Laki asks you first. Its
# input comes as $WIDGET_INPUT_<NAME>; what this prints goes back to the agent.
{ printf '%s' "$WIDGET_INPUT_TEXT" | tr -d '\\000-\\037'; echo; } >> notes.txt
echo "Added. $(wc -l < notes.txt | tr -d ' ') notes now."
`,
        'AGENTS.md': `Use **add** when the user asks you to note something for later, or when you finish a step they should look at:
one short line each. Never put secrets in a note.
`,
        'fixtures/sample.json': json(notes),
        'fixtures/empty.json': json({ notes: [] }),
        ...variants({ one: { notes: [{ text: 'Rotate the API keys' }] }, many: { notes: ['Ask Dana about the rate limit', 'The login test is flaky on CI', 'Staging cert renews on the 30th', 'Migrations need a backup first', 'Search v2 behind a flag', 'Billing webhooks retry 5 times', 'Docs: the new env vars', 'Bump Node to 22'].map(text => ({ text })) }, long: { notes: [{ text: 'The checkout test fails only when it runs after the cart tests: they share a user and leave an order behind, so the next run sees two' }] } }),
        'README.md': readme(id, name, ' Its `add` action is a tool for agents (`"tool"` in widget.json, `AGENTS.md` says when to use it): `laki widget tools` lists it, `laki widget tool ' + id + ' add \'{"text": "hi"}\'` runs it, after you allow it.'),
      }
    },
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
