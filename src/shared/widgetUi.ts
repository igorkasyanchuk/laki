// The Laki UI kit: a widget's UI as JSON elements (widget.json's "ui"), not HTML. One table (UI) says every element,
// its props and their words; from it: uiHtml (the HTML, every value escaped, the markup fixed), uiCheck (what's wrong
// with a tree, against data too), the JSON Schema and laki.d.ts (widgetSchema.ts), the AI guide's catalog
// (widgetGuide.ts), Settings' gallery and the starters (UI_SAMPLES). The daemon renders a widget's ui for the app
// (widgetRender), the app for a JS page (laki.ui, laki.mount); uiBehave (widget.ts) makes its clicks work.
import { ICONS as ICON_WORDS, iconSvg, type IconName, isIconName } from './icons.ts'
import { markdownHtml } from './markdown.ts'
import { ago, date, esc, fill, num, spark, truthy, UI_CSS, valueAt } from './widget.ts'

export { UI_CSS }

// a prop's kind: text (a template: {{field}}, helpers, #if), path (looked up raw: each, items, values), number, bool,
// children (elements), button (a button's props), icon (a name of Laki's or an emoji), tone, or one of some words
export type Kind = 'text' | 'path' | 'number' | 'bool' | 'children' | 'button' | 'buttons' | 'icon' | 'tone' | 'items' | 'object' | readonly string[]
export type Prop = { kind: Kind; desc: string }
type Def = { group: 'Layout' | 'Text' | 'Data' | 'Actions'; blurb: string; props: Record<string, Prop>; rows?: boolean }
const p = <K extends Kind>(kind: K, desc: string) => ({ kind, desc })

export const TONES = ['good', 'bad', 'warn', 'accent', 'muted'] as const
export type Tone = (typeof TONES)[number]
// a color: a tone, one of Laki's palette by name (the app's tab colors, each theme's own), or a hex (d73a4a, #d73a4a)
export const COLORS = ['blue', 'green', 'red', 'orange', 'yellow', 'purple', 'pink', 'teal', 'lime', 'brown', 'gray'] as const
// what a button may ask Laki to do (the app asks you first, showing what): a new workspace whose agent starts on a
// prompt, a prompt to the workspace's agent or to Laki AI, a command in a new terminal, a page in a Laki browser tab
export const DO = ['new', 'send', 'ai', 'terminal', 'browse'] as const
export const CHARTS = ['line', 'area', 'bars', 'stacked', 'hbars', 'pie', 'donut', 'scatter'] as const
const GAP = ['sm', 'md', 'lg'] as const

// every element takes these
export const COMMON = {
  if: p('text', 'Show it only when this path or template is truthy (an empty list is false)'),
  unless: p('text', 'Show it only when this path or template is falsy'),
  each: p('path', 'Repeat it once per item of this list (or object); inside, the item’s fields, this and @index. A list, table, chart… takes its rows from it instead'),
  tip: p('text', 'A tooltip'),
  tone: p('tone', 'good, bad, warn, accent or muted, or a map from its text to one: { "failed": "bad", "live": "good" }'),
} as const

// a button: one of run (+ arg), open, refresh, full, copy
export const BUTTON = {
  label: p('text', 'Its words'),
  icon: p('icon', 'An icon of Laki’s by name (refresh, check, github…) or an emoji'),
  style: p(['primary', 'quiet', 'danger'] as const, 'primary, quiet or danger; none: plain'),
  run: p('text', 'One of widget.json’s actions, run on a click'),
  arg: p('text', 'What the action gets as $WIDGET_ARG'),
  open: p('text', 'A link to open: http(s), mailto or laki://'),
  refresh: p('bool', 'Fetch again'),
  full: p('bool', 'Open the full view'),
  copy: p('text', 'Text to copy'),
  do: p(DO, 'A Laki command: new (a workspace, its agent starting on prompt), send (prompt to the workspace’s agent), ai (prompt to Laki AI), terminal (command in a new terminal), browse (url in a Laki browser tab). The app shows what and asks first (browse just opens, like a link)'),
  prompt: p('text', 'With do new, send or ai: the prompt'),
  command: p('text', 'With do terminal: the command line'),
  url: p('text', 'With do browse: the page (http or https)'),
  agent: p('text', 'With do new: an agent or a profile of yours (claude, codex…); none: your default'),
  project: p('text', 'With do new: a project by name or id; none: the workspace’s (per workspace), else the selected one’s'),
  confirm: p('text', 'A question the app asks first'),
} as const
const COLOR = p('text', 'A color: a tone (good, bad…), one of Laki’s palette (blue, green, red, orange, yellow, purple, pink, teal, lime, brown, gray) or a hex (d73a4a)')
const STAT = {
  value: p('text', 'The number or word'),
  label: p('text', 'What it counts'),
  delta: p('text', 'A change, +3 or -2%: green when up, red when down (unless tone says)'),
  spark: p('path', 'A list of numbers: a line under it'),
  icon: p('icon', 'An icon or emoji before it'),
  color: p('text', 'A dot by its label: a palette name or a hex (d73a4a, a GitHub label’s)'),
} as const
const BUTTONS = p('buttons', 'Buttons: each a button’s props (run, open, do, refresh, full, copy)')

export const UI = {
  stack: { group: 'Layout', blurb: 'Elements one under another.', props: { children: p('children', 'Its elements'), gap: p(GAP, 'Space between them: sm, md (the default) or lg') } },
  row: { group: 'Layout', blurb: 'Elements side by side.', props: { children: p('children', 'Its elements'), gap: p(GAP, 'Space between them'), align: p(['start', 'center', 'end', 'between'] as const, 'start, center (the default), end, or between: spread across'), wrap: p('bool', 'Wrap onto more lines when they don’t fit') } },
  grid: { group: 'Layout', blurb: 'Elements in columns, fewer as the cell narrows.', props: { children: p('children', 'Its elements'), columns: p('number', 'Columns, 1-6 (2 by default): fewer in a narrow cell') } },
  section: { group: 'Layout', blurb: 'A titled group, foldable.', props: { title: p('text', 'Its heading'), subtitle: p('text', 'Words beside the heading'), children: p('children', 'Its elements'), collapsed: p('bool', 'Foldable: true starts it folded, false open') } },
  tabs: { group: 'Layout', blurb: 'Panels behind tabs.', props: { tabs: p('items', 'The tabs: [{ "label", "badge", "children" }]') } },
  header: { group: 'Layout', blurb: 'A title bar: an icon, a title and subtitle, buttons at its end.', props: { title: p('text', 'Its title'), subtitle: p('text', 'A line under it'), icon: p('icon', 'An icon or emoji before it'), color: COLOR, href: p('text', 'A link its title opens'), actions: BUTTONS } },
  footer: { group: 'Layout', blurb: 'A bar along the bottom: muted words, buttons and links at its end.', props: { text: p('text', 'Its words (“updated {{ago at}}”)'), actions: BUTTONS } },
  toolbar: { group: 'Layout', blurb: 'Icon buttons in a row, their words as tooltips.', props: { items: BUTTONS, labels: p('bool', 'Their words beside the icons too'), align: p(['start', 'end', 'between'] as const, 'start (the default), end, or between') } },
  spacer: { group: 'Layout', blurb: 'Room that pushes what follows it in a row to the end.', props: {} },
  divider: { group: 'Layout', blurb: 'A line across.', props: {} },
  text: { group: 'Text', blurb: 'A line of text.', props: { value: p('text', 'The words'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), weight: p(['normal', 'medium', 'semibold', 'bold'] as const, 'How bold'), mono: p('bool', 'In the monospace font'), muted: p('bool', 'Dimmer'), wrap: p('bool', 'Wrap onto more lines (default: one line, cut with …)'), color: COLOR } },
  heading: { group: 'Text', blurb: 'A heading.', props: { value: p('text', 'The words'), level: p('number', '1, 2 (the default) or 3'), color: COLOR } },
  markdown: { group: 'Text', blurb: 'Formatted text: headings, lists, tasks, code, tables, quotes, links and https images.', props: { value: p('text', 'The Markdown (a whole note: “{{text}}” of a file or a typed text)') } },
  code: { group: 'Text', blurb: 'A block of code, with Copy.', props: { value: p('text', 'The code'), copy: p('bool', 'A copy button') } },
  callout: { group: 'Text', blurb: 'A box that stands out: a tip, a warning, an outage.', props: { title: p('text', 'Its first line, bold'), text: p('text', 'More words under it'), icon: p('icon', 'An icon or emoji (default: by its tone)'), action: p('button', 'A button at its end') } },
  icon: { group: 'Text', blurb: 'An icon of Laki’s or an emoji, any size and color.', props: { name: p('icon', 'An icon of Laki’s by name, or an emoji'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), color: COLOR } },
  quote: { group: 'Text', blurb: 'Words someone said, and who.', props: { text: p('text', 'The words'), by: p('text', 'Who said it'), href: p('text', 'Where it’s from: a link its name opens') } },
  diff: { group: 'Text', blurb: 'A diff, git’s: added lines green, removed red, hunks and files marked, how many of each.', props: { value: p('text', 'The unified diff (git diff’s, a patch)'), limit: p('number', 'Lines at most (a preview: as many as fit), then +N more') } },
  countdown: { group: 'Text', blurb: 'Time left until a moment, or since it: a release, a freeze, an on-call shift.', props: { to: p('text', 'When: an ISO date or ms'), label: p('text', 'What happens then (“until the freeze”)'), soon: p('number', 'Hours: it turns warn when it’s this close (24)'), past: p('text', 'What it says once it’s past (default: how long ago)') } },
  kbd: { group: 'Text', blurb: 'A keyboard shortcut, each key in a box: ⌘ K, Ctrl+Shift+P.', props: { keys: p('text', 'The keys, by spaces or + (⌘ ⇧ P, Ctrl+C)'), label: p('text', 'What it does, after the keys') } },
  secret: { group: 'Text', blurb: 'A token, a password, a key: dots until a click shows it, a copy button.', props: { value: p('text', 'The secret'), label: p('text', 'What it is'), copy: p('bool', 'A copy button: on by default') } },
  stat: { group: 'Data', blurb: 'One number with its label, a change and a sparkline.', props: STAT },
  stats: { group: 'Data', blurb: 'A few numbers in a line.', rows: true, props: { items: p('items', 'Each one’s stat props: [{ "value", "label", "delta", "tone" }]'), ...STAT } },
  kv: { group: 'Data', blurb: 'Names and values.', rows: true, props: { items: p('items', 'Each row: [{ "key", "value", "tone", "mono", "copy" }]'), key: p('text', 'With each: a row’s name'), value: p('text', 'With each: a row’s value'), mono: p('bool', 'Values in the monospace font'), copy: p('bool', 'A copy button by each value') } },
  list: {
    group: 'Data',
    blurb: 'Rows with a title, icons, tags and buttons; grouped, filtered, cut with +N more.',
    rows: true,
    props: {
      title: p('text', 'A row’s title'),
      subtitle: p('text', 'A second line'),
      icon: p('icon', 'An icon or emoji before it'),
      avatar: p('text', 'A GitHub login: its picture before it'),
      image: p('text', 'An image before it: data: or https'),
      accessories: p('items', 'At the row’s end: [{ "tag" | "text" | "badge" | "icon" | "avatar" | "ago" | "date", "tone", "color" (a palette name, or a tag’s hex border), "each" (one per item of a row’s list: its labels) }]'),
      actions: p('buttons', 'Buttons at the row’s end'),
      href: p('text', 'A link a click on the row opens'),
      limit: p('number', 'Rows at most (a preview: as many as fit), then +N more'),
      filter: p('bool', 'A filter box in the full view'),
      empty: p('text', 'What it says with no rows'),
      group: p('path', 'A field: rows under a heading per value, in the order first seen'),
    },
  },
  table: {
    group: 'Data',
    blurb: 'Columns of rows, sorted, filtered, narrow-aware.',
    rows: true,
    props: {
      columns: p('items', 'The columns: [{ "title", "value", "tag", "tone", "href", "align", "mono", "width", "wrap", "hide": "narrow" }]'),
      sort: p('text', 'A field to sort by: "age", or "age desc"'),
      limit: p('number', 'Rows at most, then +N more'),
      filter: p('bool', 'A filter box in the full view'),
      empty: p('text', 'What it says with no rows'),
    },
  },
  chart: {
    group: 'Data',
    blurb: 'A chart drawn as SVG: line, area, bars, stacked bars, horizontal bars, pie, donut or scatter.',
    rows: true,
    props: {
      kind: p(CHARTS, 'line (the default), area, bars, stacked (bars, a series on another), hbars (a bar per row, its label beside it), pie, donut, or scatter'),
      x: p('text', 'A row’s label (pie and donut: a slice’s; scatter: a number across)'),
      y: p('text', 'A row’s number'),
      series: p('items', 'Several numbers per row: [{ "label", "y", "color" }] (line, area, bars, stacked, scatter)'),
      color: p('text', 'A row’s color, a template (pie, donut, hbars, bars of one series): {{color}}'),
      colors: p('items', 'The colors in order: a series’, or a slice’s: ["blue", "orange", "#d73a4a"] (default: Laki’s palette)'),
      height: p('number', 'Its height in px'),
      min: p('number', 'The bottom of the scale'),
      max: p('number', 'The top of the scale'),
      unit: p('text', 'After each number: ms, %, $'),
      label: p('text', 'Its title, above it with the last value (a donut: in its middle, with the total)'),
      legend: p('bool', 'A legend: on by default with several series and for pie and donut'),
    },
  },
  spark: { group: 'Data', blurb: 'A small line of numbers.', props: { values: p('path', 'A list of numbers'), color: COLOR } },
  progress: { group: 'Data', blurb: 'How far along: a bar or a ring.', props: { value: p('text', 'How much is done'), max: p('number', 'Of how much (100)'), label: p('text', 'What it is'), style: p(['bar', 'ring'] as const, 'bar (the default) or ring'), color: COLOR } },
  gauge: { group: 'Data', blurb: 'A dial: a number on a half circle between min and max.', props: { value: p('text', 'The number'), min: p('number', 'The low end (0)'), max: p('number', 'The high end (100)'), label: p('text', 'What it is'), unit: p('text', 'After the number: %, ms'), color: COLOR } },
  heatmap: { group: 'Data', blurb: 'A grid of squares, darker for more: days of activity, GitHub style.', rows: true, props: { x: p('text', 'A square’s label (its tooltip): a date'), value: p('text', 'Its number'), rows: p('number', 'Squares down, 7 by default (a week a column)'), max: p('number', 'The darkest (default: the highest)'), color: COLOR } },
  status: { group: 'Data', blurb: 'Things and their state, a dot each: services, environments, jobs.', rows: true, props: { label: p('text', 'Its name'), state: p('text', 'Its state: up, degraded, down… (its dot and words, colored by tone)'), text: p('text', 'More words beside it'), href: p('text', 'A link a click opens') } },
  checklist: { group: 'Data', blurb: 'Tasks ticked or not, with how many are done.', rows: true, props: { text: p('text', 'A task'), done: p('text', 'A path or template: done when truthy'), count: p('bool', 'Its count above it (3/5): on by default') } },
  avatars: { group: 'Data', blurb: 'GitHub pictures in an overlapping row, then +N.', rows: true, props: { login: p('text', 'A GitHub login'), max: p('number', 'Pictures at most (5), then +N') } },
  tags: { group: 'Data', blurb: 'Pills: labels, states.', rows: true, props: { items: p('items', 'Each one: a word, or { "tag", "tone", "color" }'), tag: p('text', 'With each: a pill’s words'), color: p('text', 'A palette name, or a hex (d73a4a): its border and dot, a GitHub label’s') } },
  badge: { group: 'Data', blurb: 'A count or a short word, filled.', props: { value: p('text', 'The count or word'), color: COLOR } },
  timeline: { group: 'Data', blurb: 'What happened, newest first.', rows: true, props: { time: p('text', 'When (an ISO date or ms: shown as 3 hours ago; else as written)'), title: p('text', 'What happened'), text: p('text', 'More words under it'), icon: p('icon', 'An icon or emoji') } },
  image: { group: 'Data', blurb: 'A picture: a data: image or an https one.', props: { src: p('text', 'A data:image/… or https:// URL'), alt: p('text', 'What it shows'), height: p('number', 'Its height in px') } },
  card: { group: 'Data', blurb: 'A box with a picture, a title, words and a tag: a link to open.', rows: true, props: { title: p('text', 'Its title'), text: p('text', 'Its words'), image: p('text', 'A picture: data: or https'), icon: p('icon', 'Or an icon or emoji'), tag: p('text', 'A pill by its title'), href: p('text', 'A link a click opens') } },
  steps: { group: 'Data', blurb: 'Stages in order, each done, running, failed, skipped or to do: a pipeline, a deploy, an onboarding.', rows: true, props: { label: p('text', 'A step’s name'), state: p('text', 'Its state: done, running, failed, skipped or todo (passed, success, current, error… count too)'), text: p('text', 'Words under it: how long, who'), href: p('text', 'A link a click opens') } },
  meter: { group: 'Data', blurb: 'One bar split into parts, a legend under it: disk, a budget, test results.', rows: true, props: { items: p('items', 'Each part: [{ "label", "value", "color" }]'), label: p('text', 'With each: a part’s name'), value: p('text', 'With each: its number'), color: p('text', 'With each: its color (default: the palette’s next)'), title: p('text', 'Its title, above it with the total'), max: p('number', 'The whole (default: the parts’ sum): the rest of the bar stays empty'), unit: p('text', 'After each number: GB, $, %'), legend: p('bool', 'Each part’s name and number under it: on by default') } },
  board: { group: 'Data', blurb: 'Cards in columns by a field, kanban style: issues by state, PRs by review.', rows: true, props: { column: p('text', 'A card’s column: a template over its row ({{state}} by default)'), columns: p('items', 'The columns in order, even empty: ["Todo", "Doing", "Done"] (default: as first seen)'), title: p('text', 'A card’s title ({{title}} by default)'), subtitle: p('text', 'A second line'), tag: p('text', 'A pill on it'), avatar: p('text', 'A GitHub login: its picture'), href: p('text', 'A link a click opens'), limit: p('number', 'Cards per column at most, then +N more') } },
  tree: { group: 'Data', blurb: 'Nested rows that fold: folders and files, tasks and subtasks, a sitemap.', rows: true, props: { label: p('text', 'A node’s words ({{label}} by default)'), text: p('text', 'Muted words beside it'), icon: p('icon', 'An icon or emoji before it: a template too ({{#if children}}folder{{else}}file{{/if}})'), href: p('text', 'A link a click opens'), nested: p('text', 'The field with a node’s children (children by default)'), open: p('number', 'Levels open at first (1; 0: all folded)') } },
  log: { group: 'Data', blurb: 'Log lines in the monospace font, the newest last, errors red and warnings yellow.', rows: true, props: { value: p('text', 'The whole log as text, a line each (instead of each)'), text: p('text', 'With each: a line ({{text}} by default)'), time: p('text', 'With each: when (an ISO date or ms: shown as 09:10:03)'), level: p('text', 'With each: error, warn, info or debug (default: read off the line)'), limit: p('number', 'Lines at most, the newest (a preview: as many as fit), then +N more'), wrap: p('bool', 'Wrap long lines') } },
  json: { group: 'Data', blurb: 'Any value as JSON that folds: what a fetch printed, an API’s answer.', props: { value: p('path', 'What to show: a path (data, data.items); data by default'), open: p('number', 'Levels open at first (1)') } },
  rating: { group: 'Data', blurb: 'Stars: a score out of 5, halves too.', props: { value: p('text', 'The score (4.5)'), max: p('number', 'Stars, 1-10 (5)'), label: p('text', 'Words after it: 128 reviews'), color: COLOR } },
  calendar: { group: 'Data', blurb: 'A month, a dot on each day with something on it: releases, on-call, holidays.', rows: true, props: { date: p('text', 'A row’s day: an ISO date or ms ({{date}} by default)'), title: p('text', 'What’s on then ({{title}} by default)'), color: p('text', 'Its dot’s color (a template over its row)'), href: p('text', 'A link its day opens'), month: p('text', 'Which month, 2026-10 (default: this one)'), list: p('bool', 'The month’s rows under it: in the full view by default') } },
  people: { group: 'Data', blurb: 'People: a picture, a name, a role and whether they’re around.', rows: true, props: { name: p('text', 'A name ({{name}} by default)'), login: p('text', 'A GitHub login: its picture (else the name’s initials)'), text: p('text', 'Words under it: a role, a team'), state: p('text', 'online, away, busy, offline…: its dot'), href: p('text', 'A link a click opens') } },
  inbox: { group: 'Data', blurb: 'Messages: who, a subject, its first words, when, unread in bold.', rows: true, props: { from: p('text', 'Who sent it ({{from}} by default)'), login: p('text', 'A GitHub login: its picture'), subject: p('text', 'Its subject ({{subject}} by default)'), text: p('text', 'Its first words'), time: p('text', 'When (an ISO date or ms: 3 hours ago)'), unread: p('text', 'A path or template: unread when truthy'), href: p('text', 'A link a click opens') } },
  chat: { group: 'Data', blurb: 'A conversation in bubbles, the newest last: a Slack thread, an agent’s answers.', rows: true, props: { from: p('text', 'Who said it ({{from}} by default)'), text: p('text', 'What they said ({{text}} by default)'), login: p('text', 'A GitHub login: its picture'), time: p('text', 'When (an ISO date or ms)'), mine: p('text', 'A path or template: yours when truthy, on the right') } },
  prs: { group: 'Data', blurb: 'Pull requests, GitHub style: state, title, number and author, checks, review.', rows: true, props: { title: p('text', 'Its title ({{title}} by default)'), number: p('text', 'Its number ({{number}} by default)'), author: p('text', 'Its author’s login: a picture ({{author}} by default)'), state: p('text', 'open, draft, merged or closed ({{state}} by default)'), checks: p('text', 'passing, failing or pending: an icon'), review: p('text', 'approved or changes: a tag'), time: p('text', 'When it last changed'), href: p('text', 'A link a click opens ({{url}} by default)') } },
  commits: { group: 'Data', blurb: 'Commits: the short hash (a click copies it), the message’s first line, who and when.', rows: true, props: { sha: p('text', 'Its hash ({{sha}} by default)'), message: p('text', 'Its message ({{message}} by default)'), author: p('text', 'Its author: a GitHub login’s picture and the name'), time: p('text', 'When'), href: p('text', 'A link a click opens') } },
  button: { group: 'Actions', blurb: 'Runs an action or a Laki command, opens a link, refreshes, copies.', props: BUTTON },
  toggle: { group: 'Actions', blurb: 'A switch that runs an action with on or off: a feature flag, maintenance mode.', props: { label: p('text', 'Its words'), text: p('text', 'Words under it'), on: p('text', 'A path or template: on when truthy'), run: p('text', 'One of widget.json’s actions, run with $WIDGET_ARG on or off (what it’s turned to); then it fetches again and shows what’s true'), confirm: p('text', 'A question the app asks first') } },
  segmented: { group: 'Actions', blurb: 'One of a few options, picked: runs an action with it. An environment, a mode, a range.', props: { options: p('items', 'The options: words, or [{ "value", "label" }]'), value: p('text', 'The one picked now ({{env}})'), label: p('text', 'Words before it'), run: p('text', 'One of widget.json’s actions, run with the option’s value as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  stepper: { group: 'Actions', blurb: 'A number with − and +: runs an action with the new one. Replicas, a limit, a budget.', props: { value: p('text', 'The number now'), label: p('text', 'What it is'), unit: p('text', 'After the number'), min: p('number', 'The lowest'), max: p('number', 'The highest'), step: p('number', 'How much a click moves it (1)'), run: p('text', 'One of widget.json’s actions, run with the new number as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  actions: { group: 'Actions', blurb: 'A row of buttons.', props: { items: p('buttons', 'The buttons') } },
  links: { group: 'Actions', blurb: 'Links in a line, a rule between them.', rows: true, props: { items: p('items', 'Each one: { "label", "href" }'), label: p('text', 'With each: a link’s words'), href: p('text', 'With each: where it goes') } },
  form: { group: 'Actions', blurb: 'Fields and a button that runs an action with them.', props: { fields: p('items', 'Its fields: [{ "id", "type": "text" | "number" | "bool" | "choice" | "textarea", "label", "hint", "default", "choices" }]'), submit: p('button', 'Its button: { "label", "run", "confirm" }; the action gets the fields as JSON in $WIDGET_ARG') } },
  empty: { group: 'Actions', blurb: 'Nothing to show, and what to do about it.', props: { text: p('text', 'What it says'), icon: p('icon', 'An icon or emoji over it'), action: p('button', 'A button under it') } },
} satisfies Record<string, Def>

export type UiType = keyof typeof UI
export const UI_TYPES = Object.keys(UI) as UiType[]

// the TypeScript types, from the table: one per element (laki.d.ts has them with their words)
type KindType<K> = K extends readonly (infer W)[] ? W : K extends 'number' ? number | string : K extends 'bool' ? boolean : K extends 'children' ? UiElement[] : K extends 'button' ? UiButton : K extends 'buttons' ? UiButton[] : K extends 'path' ? string | unknown[] : K extends 'tone' ? Tone | string | Record<string, Tone> : K extends 'items' ? any[] : K extends 'object' ? Record<string, unknown> : string | number
type PropsOf<P> = { -readonly [K in keyof P]?: P[K] extends { kind: infer Q } ? KindType<Q> : never }
type Common = PropsOf<typeof COMMON>
export type UiButton = PropsOf<typeof BUTTON> & Common
export type UiElement = { [T in UiType]: { type: T } & Common & PropsOf<(typeof UI)[T]['props']> }[UiType]
export type UiSpec = UiElement | { preview?: UiElement; full?: UiElement }

type El = Record<string, unknown> & { type?: string }
type Scope = Record<string, unknown>
type S = { scopes: Scope[]; full: boolean; single: boolean; cells: [number, number]; line: boolean; ids: { uid: string; n: number } } // ids: one counter for the whole tree (rows' copies of S share it)
const obj = (v: unknown): v is El => !!v && typeof v === 'object' && !Array.isArray(v)

// a widget's ui: one tree (the preview and the full view, which shows every row) or { preview, full }
export const isElement = (spec: unknown): spec is UiElement => obj(spec) && typeof spec.type === 'string'
export const uiTree = (spec: unknown, full: boolean): El | undefined => (isElement(spec) ? (spec as El) : obj(spec) ? ((v => (obj(v) ? v : undefined))(full ? spec.full : spec.preview)) : undefined)

// a prop as text: a template filled over the scopes (plain text: escaped where it goes)
const txt = (v: unknown, s: S): string => (typeof v === 'string' ? fill(v, s.scopes) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')
const h = (v: unknown, s: S) => esc(txt(v, s))
const n = (v: unknown, s: S) => (v === undefined || v === null || v === '' ? undefined : (x => (Number.isFinite(x) ? x : undefined))(Number(typeof v === 'string' ? txt(v, s) : v)))
const holds = (v: unknown, s: S) => (typeof v === 'string' && v.includes('{{') ? (t => !!t && t !== 'false' && t !== '0')(txt(v, s).trim()) : typeof v === 'string' ? truthy(valueAt(v, s.scopes)) : !!v)
const listAt = (v: unknown, s: S): unknown[] => (x => (Array.isArray(x) ? x : obj(x) ? Object.values(x) : []))(valueAt(v, s.scopes))
const inner = (s: S, item: unknown, i: number): S => ({ ...s, scopes: [{ ...(obj(item) ? item : {}), this: item, '@index': i }, ...s.scopes] })

// tone: a word, or a map from the element's main text to one
function toneWord(e: El, main: string, s: S) {
  const t = e.tone
  const v = obj(t) ? (Object.hasOwn(t, main) ? t[main] : Object.hasOwn(t, main.toLowerCase()) ? t[main.toLowerCase()] : undefined) : t
  const w = typeof v === 'string' ? txt(v, s).trim() : ''
  return (TONES as readonly string[]).includes(w) ? w : ''
}
const toneOf = (e: El, main: string, s: S) => (w => (w ? `t-${w}` : ''))(toneWord(e, main, s))
// a color as CSS: a tone's (the theme's), the palette's (the theme's tab colors, these where it has none) or a hex
const TONE_CSS: Record<string, string> = { good: 'var(--done, #9ece6a)', bad: 'var(--error, #f7768e)', warn: 'var(--waiting, #e0af68)', accent: 'var(--accent, #7aa2f7)', muted: 'var(--muted, #7a8294)' }
const TC: Record<string, string> = { red: '#f7768e', orange: '#ff9e64', yellow: '#e0af68', green: '#9ece6a', teal: '#73daca', blue: '#7aa2f7', purple: '#bb9af7', pink: '#f5a3d0', lime: '#b5cf6b', brown: '#99603c', gray: '#7a8294' }
export function colorCss(word: string) {
  const w = word.trim().toLowerCase()
  return Object.hasOwn(TONE_CSS, w) ? TONE_CSS[w] : Object.hasOwn(TC, w) ? `var(--tc-${w}, ${TC[w]})` : (x => (x ? `#${x}` : ''))(hex(w))
}
const hue = (v: unknown, s: S) => (v === undefined ? '' : colorCss(txt(v, s)))
// its class (with its tone), tooltip and color (a color prop: its text and currentColor)
const at = (e: El, s: S, cls: string, main = '', color?: unknown) => {
  const c = [cls, toneOf(e, main, s)].filter(Boolean).join(' ')
  const tip = e.tip !== undefined ? txt(e.tip, s) : ''
  const col = hue(color, s)
  return `${c ? ` class="${c}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}${col ? ` style="color:${col}"` : ''}`
}
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined
const emoji = (t: string) => !!t && !/\s/.test(t) && !/^[a-z]/i.test(t) && (graphemes ? [...graphemes.segment(t)].length : t.length) <= 2
function icon(v: unknown, s: S, size = 14) {
  const t = txt(v, s).trim()
  return isIconName(t) ? iconSvg(t, size) : emoji(t) ? `<span class="k-emoji" style="font-size:${size - 1}px">${esc(t)}</span>` : ''
}
const LINK = /^(https?:|mailto:|laki:\/\/)/i
const safeUrl = (u: string) => (LINK.test(u.trim()) ? u.trim() : '')
// a link: http(s) and mailto as one (the app opens it in the browser); laki:// through data-open (a widget's HTML keeps no other href)
const link = (url: string, inner: string, cls = '') => (u => (!u ? `<span${cls ? ` class="${cls}"` : ''}>${inner}</span>` : /^laki:/i.test(u) ? `<a${cls ? ` class="${cls}"` : ''} data-open="${esc(u)}">${inner}</a>` : `<a${cls ? ` class="${cls}"` : ''} href="${esc(u)}" title="${esc(u)}">${inner}</a>`))(safeUrl(url))
const avatarUrl = (login: string) => (/^[A-Za-z0-9-]{1,39}$/.test(login.trim()) ? `https://avatars.githubusercontent.com/${login.trim()}?s=40` : '')
// a picture: data: or https (a JS page without network access shows none of the latter: the guide says so)
const imageOk = (u: string) => /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(u) || /^https:\/\/[\w.-]+(:\d+)?\/[^\s"'<>\\]*$/.test(u)
const hex = (v: string) => (/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v.trim()) ? v.trim().replace(/^#/, '') : '')
const err = (e: unknown) => `<span class="k-chip-err" title="${esc((e as Error)?.message ?? e)}">⚠ ${esc(String((e as Error)?.message ?? e).slice(0, 80))}</span>`
// a GitHub login's picture (none for anything else)
const avImg = (login: string) => (u => (u ? `<img class="k-av" src="${u}" alt="${esc(login)}" title="${esc(login)}">` : ''))(avatarUrl(login))
// when, as a row says it: how long ago (or the words as given), the whole date in its tooltip
const when = (tm: string, words: (t: number | string) => string = ago) => (t => (tm ? `<span class="k-time"${t !== undefined ? ` title="${esc(new Date(t).toLocaleString())}"` : ''}>${esc(t !== undefined ? words(t) || tm : tm)}</span>` : ''))(timeOf(tm))
const copyBtn = (text: string) => `<button type="button" class="k-copy quiet" data-copy="${esc(text)}" title="Copy">${iconSvg('copy', 11)}</button>`
const timeOf = (t: string) => (/^\d{10,13}$/.test(t) ? Number(t.length === 10 ? Number(t) * 1000 : t) : /^\d{4}-\d{2}-\d{2}/.test(t) ? t : undefined)

// if / unless: an element's, a button's, an accessory's, an item's
const hidden = (x: El, s: S) => (x.if !== undefined && !holds(x.if, s)) || (x.unless !== undefined && holds(x.unless, s))

function node(el: unknown, s: S): string {
  if (!obj(el)) return ''
  try {
    if (hidden(el, s)) return ''
    const def = (UI as Record<string, Def>)[String(el.type)]
    if (!def) return err(`no element ${el.type}`)
    if (el.each !== undefined && !def.rows) return listAt(el.each, s).map((item, i) => one(el, inner(s, item, i))).join('')
    return one(el, s)
  } catch (e) {
    return err(e)
  }
}
function one(e: El, s: S) {
  try {
    return R[e.type as UiType](e, s)
  } catch (x) {
    return err(x) // a bad template in one element: its chip, the rest still draws
  }
}
const kids = (v: unknown, s: S) => (Array.isArray(v) ? v.map(x => node(x, s)).join('') : '')
const gap = (v: unknown) => ` g-${GAP.includes(v as 'sm') ? v : 'md'}`

// how many rows: a bar's line one, a preview as many as fit its cells (rowH px each), a full view of one tree all
function cap(e: El, s: S, rowH: number) {
  if (s.line) return 1
  const l = n(e.limit, s)
  if (s.full) return s.single || l === undefined ? Infinity : Math.max(1, l)
  return Math.max(1, l ?? Math.floor((s.cells[1] * 64 - 10) / rowH))
}
const more = (left: number) => (left > 0 ? `<button type="button" class="k-more" data-more>+${left} more</button>` : '')
const filterBox = (e: El, s: S) => (s.full && e.filter === true ? '<input class="k-filter" type="search" data-filter placeholder="Filter…" aria-label="Filter">' : '')
const empty = (e: El, s: S, rows: number) => (rows ? '' : `<div class="k-empty small">${h(e.empty ?? 'Nothing here', s)}</div>`)

// a Laki command a button asks for (the app shows it and asks first): its words filled in
export type UiDo = { do: (typeof DO)[number]; prompt?: string; command?: string; url?: string; agent?: string; project?: string }
const doOf = (b: El, s: S): UiDo | undefined => {
  const w = txt(b.do, s).trim()
  if (!(DO as readonly string[]).includes(w)) return undefined
  const c: Record<string, string> = { do: w }
  for (const k of ['prompt', 'command', 'url', 'agent', 'project']) if (b[k] !== undefined) c[k] = txt(b[k], s)
  return c as UiDo
}
// bare: its icon alone, its words the tooltip (a toolbar's)
function button(b: unknown, s: S, small = false, bare = false): string {
  if (!obj(b) || hidden(b, s)) return ''
  const label = txt(b.label, s)
  const style = ['primary', 'quiet', 'danger'].includes(String(b.style)) ? ` ${b.style}` : ''
  const iconOnly = bare && b.icon !== undefined && !!icon(b.icon, s, 12)
  let act = ''
  if (b.run !== undefined) act = ` data-run="${h(b.run, s)}"${b.arg !== undefined ? ` data-arg="${h(b.arg, s)}"` : ''}`
  else if (b.do !== undefined) act = (c => (c ? ` data-do="${esc(JSON.stringify(c))}"` : ' disabled'))(doOf(b, s))
  else if (b.open !== undefined) act = (u => (u ? ` data-open="${esc(u)}"` : ' disabled'))(safeUrl(txt(b.open, s)))
  else if (b.refresh === true) act = ' data-laki="refresh"'
  else if (b.full === true) act = ' data-laki="full"'
  else if (b.copy !== undefined) act = ` data-copy="${h(b.copy, s)}"`
  const confirm = b.confirm !== undefined ? ` data-confirm="${h(b.confirm, s)}"` : ''
  return `<button type="button"${at(iconOnly && b.tip === undefined ? { ...b, tip: label } : b, s, `k-btn${style}${small ? ' sm' : ''}${iconOnly ? ' bare' : ''}`, label)}${act}${confirm}${iconOnly && label ? ` aria-label="${esc(label)}"` : ''}>${b.icon !== undefined ? icon(b.icon, s, 12) : ''}${label && !iconOnly ? `<span>${esc(label)}</span>` : ''}</button>`
}
const buttons = (v: unknown, s: S, small = true, bare = false) => (Array.isArray(v) ? v.map(b => button(b, s, small, bare)).join('') : '')

function stat(e: El, s: S) {
  const value = txt(e.value, s)
  const d = txt(e.delta, s).trim()
  const dt = e.tone === undefined && d ? (/^[-−]/.test(d) ? 't-bad' : /^\+/.test(d) ? 't-good' : 't-muted') : toneOf(e, d, s)
  const c = hue(e.color, s)
  const label = txt(e.label, s)
  const sp = e.spark !== undefined ? spark(valueAt(e.spark, s.scopes)) : ''
  return `<div${at(e, s, 'k-stat', value)}>${e.icon !== undefined ? icon(e.icon, s, 16) : ''}<div class="k-v">${esc(value)}${d ? `<span class="k-delta ${dt}">${esc(d)}</span>` : ''}</div>${label || c ? `<div class="k-l">${c ? `<i class="k-dotc" style="background:${c}"></i>` : ''}${esc(label)}</div>` : ''}${sp ? `<div class="k-spark">${sp}</div>` : ''}</div>`
}

function accessory(a: unknown, s: S): string {
  if (!obj(a)) return ''
  if (a.each !== undefined) return listAt(a.each, s).map((x, i) => accessory({ ...a, each: undefined }, inner(s, x, i))).join('') // one per item: a PR's labels
  if (hidden(a, s)) return ''
  const key = ['tag', 'badge', 'text', 'icon', 'avatar', 'ago', 'date'].find(k => a[k] !== undefined)
  if (!key) return ''
  const v = txt(a[key], s)
  const tone = toneOf(a, v, s)
  const c = hue(a.color, s)
  if (key === 'tag') return v ? `<span class="k-tag ${tone}"${c ? ` style="border-color:${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'badge') return v ? `<span class="k-badge ${tone}${c ? ' c' : ''}"${c ? ` style="color:${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'icon') return `<span class="${tone}"${c ? ` style="color:${c}"` : ''}>${icon(a.icon, s, 13)}</span>`
  if (key === 'avatar') return avImg(v)
  const t = key === 'ago' || key === 'date' ? timeOf(v.trim()) : undefined
  const words = key === 'ago' ? (t === undefined ? v : ago(t)) : key === 'date' ? (t === undefined ? v : date(t)) : v
  return words ? `<span class="${tone}"${c ? ` style="color:${c}"` : ''}${t !== undefined ? ` title="${esc(new Date(t).toLocaleString())}"` : ''}>${esc(words)}</span>` : ''
}

// each row of a list
function row(e: El, s: S, extra: boolean) {
  const title = txt(e.title, s)
  const sub = txt(e.subtitle, s)
  const href = e.href !== undefined ? safeUrl(txt(e.href, s)) : ''
  const lead = e.avatar !== undefined ? (u => (u ? `<img class="k-av" src="${u}" alt="">` : ''))(avatarUrl(txt(e.avatar, s))) : e.image !== undefined ? (u => (imageOk(u) ? `<img class="k-av" src="${esc(u)}" alt="">` : ''))(txt(e.image, s).trim()) : e.icon !== undefined ? icon(e.icon, s) : ''
  const acc = Array.isArray(e.accessories) ? e.accessories.map(a => accessory(a, s)).join('') : ''
  const acts = buttons(e.actions, s)
  const tip = e.tip !== undefined ? txt(e.tip, s) : ''
  return `<div class="k-li" data-row${extra ? ' data-extra hidden' : ''}${href ? ` data-open="${esc(href)}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}>${lead}<div class="k-main"><div class="k-title ${toneOf(e, title, s)}">${esc(title)}</div>${sub ? `<div class="k-sub">${esc(sub)}</div>` : ''}</div>${acc ? `<div class="k-acc">${acc}</div>` : ''}${acts ? `<div class="k-acts">${acts}</div>` : ''}</div>`
}

function list(e: El, s: S) {
  const items = listAt(e.each ?? e.items, s)
  const max = cap(e, s, e.subtitle !== undefined ? 36 : 26)
  let shown = 0
  const rows = (idx: number[]) =>
    idx
      .map(i => {
        const k = shown++
        if (k >= max && !s.full) return ''
        return row(e, inner(s, items[i], i), k >= max)
      })
      .join('')
  let body: string
  if (e.group !== undefined) {
    const groups = new Map<string, number[]>()
    items.forEach((item, i) => (g => groups.set(g, [...(groups.get(g) ?? []), i]))(String(valueAt(e.group, inner(s, item, i).scopes) ?? '')))
    body = [...groups]
      .map(([g, idx]) => {
        const start = shown
        const r = rows(idx)
        return start >= max && !s.full ? '' : `<div class="k-group" data-group><div class="k-gh">${esc(g)}<span class="k-sub">${idx.length}</span></div>${r}</div>`
      })
      .join('')
  } else body = rows(items.map((_, i) => i))
  return `<div${at({ tip: e.tip }, s, 'k-list')} data-rows>${filterBox(e, s)}${body}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
}

const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true }))
function table(e: El, s: S) {
  const cols = (Array.isArray(e.columns) ? e.columns : []).filter(obj)
  const items = listAt(e.each ?? e.items, s).map((item, i) => ({ item, i }))
  const [field, dir] = String(e.sort ?? '').trim().split(/\s+/)
  if (field) items.sort((a, b) => cmp(valueAt(field, inner(s, a.item, a.i).scopes), valueAt(field, inner(s, b.item, b.i).scopes)) * (dir === 'desc' ? -1 : 1))
  const max = cap(e, s, 28)
  const cls = (c: El) => [c.align === 'right' || c.align === 'center' ? `al-${c.align}` : '', c.mono === true ? 'mono' : '', c.wrap === true ? 'wrap' : '', c.hide === 'narrow' ? 'hide-narrow' : ''].filter(Boolean).join(' ')
  const width = (c: El) => (w => (w ? ` style="width:${/^\d+$/.test(w) ? `${w}px` : w}"` : ''))(/^\d{1,4}(px|%)?$/.test(String(c.width ?? '')) ? String(c.width) : '')
  const head = `<thead><tr>${cols.map(c => `<th class="${cls(c)}"${width(c)}>${h(c.title, s)}</th>`).join('')}</tr></thead>`
  const cell = (c: El, r: S) => {
    const v = txt(c.value, r)
    const tag = c.tag !== undefined ? txt(c.tag, r) : ''
    const tone = toneOf(c, v || tag, r)
    const inside = `${tag ? `<span class="k-tag ${tone}">${esc(tag)}</span>` : ''}${v ? (tag ? ` ${esc(v)}` : `<span class="${tone}">${esc(v)}</span>`) : ''}`
    const href = c.href !== undefined ? txt(c.href, r) : ''
    return `<td class="${cls(c)}">${href ? link(href, inside, 'link') : inside}</td>`
  }
  const body = items
    .map(({ item, i }, k) => (k >= max && !s.full ? '' : (r => `<tr data-row${k >= max ? ' data-extra hidden' : ''}>${cols.map(c => cell(c, r)).join('')}</tr>`)(inner(s, item, i))))
    .join('')
  return `<div${at({ tip: e.tip }, s, 'k-table')} data-rows>${filterBox(e, s)}<table>${head}<tbody>${body}</tbody></table>${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
}

// a chart: the plot in a 100×40 box stretched to its size (lines keep their width), its labels and dot in HTML
const H = 40
export function chartPoints(ys: number[], lo: number, hi: number) {
  const span = hi - lo || 1
  return ys.map((v, i) => [ys.length === 1 ? 50 : (i / (ys.length - 1)) * 100, 2 + (1 - (v - lo) / span) * (H - 4)] as [number, number])
}
// a chart's colors in order: Laki's palette, or the chart's colors
const PALETTE = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'yellow', 'red']
const numOf = (v: string) => (v.trim() === '' ? NaN : Number(v))
const f1 = (x: number) => x.toFixed(1)
const legendOf = (keys: [string, string, string?][]) => `<div class="k-legend">${keys.map(([label, c, v]) => `<span><i style="background:${c}"></i>${esc(label)}${v ? `<b>${esc(v)}</b>` : ''}</span>`).join('')}</div>`
function chart(e: El, s: S) {
  const rs = listAt(e.each ?? e.items, s).map((item, i) => inner(s, item, i))
  const kind = (CHARTS as readonly string[]).includes(String(e.kind)) ? String(e.kind) : 'line'
  const given = (Array.isArray(e.colors) ? e.colors : []).map(c => hue(c, s)).filter(Boolean)
  const pal = (k: number) => (given.length ? given[k % given.length] : colorCss(PALETTE[k % PALETTE.length]))
  const unit = txt(e.unit, s)
  const fmt = (v: number) => `${num(v)}${unit}`
  const xs = rs.map(r => txt(e.x, r))
  const label = txt(e.label, s)
  const height = s.line ? 18 : (n(e.height, s) ?? (s.full ? 160 : Math.max(24, s.cells[1] * 64 - 34)))
  const wrap = (body: string, head = '', legend = '') => `<div${at({ tip: e.tip }, s, `k-chart k-${kind}`)}>${s.line ? '' : head}${body}${s.line ? '' : legend}</div>`
  const headOf = (v?: string) => (label || v ? `<div class="k-ch-head"><span>${esc(label)}</span>${v ? `<b>${esc(v)}</b>` : ''}</div>` : '')
  // a row's own color (pie, donut, hbars, one series' bars): its color template, its tone, else the palette's next
  const rowColor = (i: number) => hue(e.color, rs[i]) || (w => (w ? colorCss(w) : ''))(toneWord(e, xs[i], rs[i])) || pal(i)

  if (kind === 'pie' || kind === 'donut' || kind === 'hbars') {
    const vals = rs.map(r => numOf(txt(e.y, r)))
    const ok = vals.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v) && v > 0)
    if (!ok.length) return ''
    const total = ok.reduce((a, [v]) => a + v, 0)
    if (kind === 'hbars') {
      const top = n(e.max, s) ?? Math.max(...ok.map(([v]) => v))
      const max = cap(e, s, 18)
      const rows = ok.map(([v, i], k) => (k >= max && !s.full ? '' : `<div class="k-hb" data-row${k >= max ? ' data-extra hidden' : ''} title="${esc(`${xs[i]}: ${fmt(v)}`)}"><span class="k-hb-l">${esc(xs[i])}</span><span class="k-hb-t"><i style="width:${f1(Math.min(100, (v / (top || 1)) * 100))}%;background:${rowColor(i)}"></i></span><b>${esc(fmt(v))}</b></div>`)).join('')
      return wrap(`<div class="k-hbars" data-rows>${rows}${s.line ? '' : more(ok.length - Math.min(max, ok.length))}</div>`, headOf())
    }
    const pie = kind === 'pie'
    const r = pie ? 7.9577 : 15.9155
    let off = 0
    const slices = ok
      .map(([v, i]) => {
        const pct = (v / total) * 100
        const c = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="currentColor" style="color:${rowColor(i)}" stroke-width="${pie ? 15.9155 : 6}" pathLength="100" stroke-dasharray="${f1(pct)} ${f1(100 - pct)}" stroke-dashoffset="${f1(-off)}" transform="rotate(-90 21 21)"><title>${esc(`${xs[i] ? `${xs[i]}: ` : ''}${fmt(v)} (${Math.round(pct)}%)`)}</title></circle>`
        off += pct
        return c
      })
      .join('')
    const size = s.line ? 16 : Math.min(height, s.full ? 180 : height)
    const mid = pie || s.line ? '' : `<div class="k-pie-mid"><b>${esc(fmt(total))}</b>${label ? `<span>${esc(label)}</span>` : ''}</div>`
    const legend = e.legend === false || s.line ? '' : legendOf(ok.map(([v, i]) => [xs[i], rowColor(i), s.full || s.cells[0] > 1 ? `${Math.round((v / total) * 100)}%` : undefined]))
    return wrap(`<div class="k-pie-body"><div class="k-pie-c" style="width:${size}px;height:${size}px"><svg viewBox="0 0 42 42" role="img" aria-label="${esc(label || kind)}">${slices}</svg>${mid}</div>${legend}</div>`, pie ? headOf() : '')
  }

  const series = (Array.isArray(e.series) && e.series.length ? e.series.filter(obj) : [{ y: e.y }]) as El[]
  const ys = series.map(se => rs.map(r => numOf(txt(se.y, r))))
  const all = ys.flat().filter(Number.isFinite)
  if (!all.length) return '' // nothing to draw
  const colorOfSe = (se: El, k: number) => hue(se.color, s) || (w => (w ? colorCss(w) : ''))(toneWord(se, '', s)) || pal(k)
  const stacked = kind === 'stacked'
  const sums = rs.map((_, i) => ys.reduce((a, y) => a + Math.max(0, Number.isFinite(y[i]) ? y[i] : 0), 0))
  let lo = n(e.min, s) ?? (stacked ? 0 : Math.min(...all))
  const hi = n(e.max, s) ?? (stacked ? Math.max(...sums) : Math.max(...all))
  if (kind === 'bars' && e.min === undefined) lo = Math.min(0, lo)
  const yOf = (v: number) => chartPoints([v], lo, hi)[0][1]
  let plot = [2, H / 2, H - 2].map(y => `<line class="grid" x1="0" x2="100" y1="${y}" y2="${y}" vector-effect="non-scaling-stroke"/>`).join('')
  let dots = ''
  const slot = 100 / Math.max(1, rs.length)
  if (kind === 'scatter') {
    // x: a number across when every row's is one, else the row's place
    const xn = rs.map(r => numOf(txt(e.x, r)))
    const byX = xn.every(Number.isFinite) && xn.length > 1
    const [xlo, xhi] = byX ? [Math.min(...xn), Math.max(...xn)] : [0, Math.max(1, rs.length - 1)]
    series.forEach((se, k) =>
      ys[k].forEach((v, i) => {
        if (!Number.isFinite(v)) return
        const x = (((byX ? xn[i] : i) - xlo) / (xhi - xlo || 1)) * 100
        dots += `<i class="k-sc-dot" style="left:${f1(x)}%;top:${f1((yOf(v) / H) * 100)}%;background:${colorOfSe(se, k)}" title="${esc(`${xs[i] ? `${xs[i]}: ` : ''}${series.length > 1 ? `${txt(se.label, s)} ` : ''}${fmt(v)}`)}"></i>`
      }),
    )
  } else if (kind === 'bars' || stacked) {
    const base = yOf(Math.max(lo, Math.min(0, hi)))
    const acc = rs.map(() => 0)
    series.forEach((se, k) => {
      const c = colorOfSe(se, k)
      ys[k].forEach((v, i) => {
        if (!Number.isFinite(v)) return
        const w = stacked ? slot : slot / series.length
        const x = stacked ? i * slot : i * slot + k * w
        const [y0, y1] = stacked ? [yOf(acc[i]), yOf((acc[i] += Math.max(0, v)))] : [base, yOf(v)]
        const col = series.length === 1 && !stacked ? rowColorOr(i, c) : c
        plot += `<rect x="${f1(x + w * 0.15)}" y="${f1(Math.min(y0, y1))}" width="${f1(w * 0.7)}" height="${f1(Math.max(0.5, Math.abs(y0 - y1)))}" fill="currentColor" style="color:${col}"/>`
      })
    })
  } else
    series.forEach((se, k) => {
      const c = colorOfSe(se, k)
      const vals = ys[k]
      const pts = chartPoints(vals.map(v => (Number.isFinite(v) ? v : lo)), lo, hi).filter((_, i) => Number.isFinite(vals[i]))
      const line = pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')
      if (kind === 'area' && pts.length) plot += `<polygon points="${f1(pts[0][0])},${H} ${line} ${f1(pts.at(-1)![0])},${H}" fill="currentColor" fill-opacity="0.15" style="color:${c}"/>`
      plot += `<polyline points="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" style="color:${c}"/>`
      const last = pts.at(-1)
      if (last && k === 0) dots = `<i class="k-ch-dot" style="left:${f1(last[0])}%;top:${f1((last[1] / H) * 100)}%;background:${c}"></i>`
    })
  // each point's tooltip: a slot across the plot
  if (kind !== 'scatter') plot += rs.map((_, i) => `<rect x="${f1(i * slot)}" y="0" width="${f1(slot)}" height="${H}" fill="transparent"><title>${esc(xs[i] ? `${xs[i]}: ` : '')}${esc(series.map((se, k) => `${series.length > 1 ? `${txt(se.label, s)} ` : ''}${Number.isFinite(ys[k][i]) ? fmt(ys[k][i]) : '–'}`).join(', '))}</title></rect>`).join('')
  const lastV = stacked ? sums.at(-1) : ys[0].filter(Number.isFinite).at(-1)
  const legend = (e.legend ?? series.length > 1) === true ? legendOf(series.map((se, k) => [txt(se.label, s) || txt(e.y, s), colorOfSe(se, k)])) : ''
  const xAxis = s.full && xs.some(Boolean) && kind !== 'scatter' ? `<div class="k-ch-x"><span>${esc(xs[0])}</span><span>${esc(xs.at(-1)!)}</span></div>` : ''
  return wrap(`<div class="k-ch-body" style="height:${height}px">${s.line ? '' : `<div class="k-ch-axis"><span>${esc(fmt(hi))}</span><span>${esc(fmt(lo))}</span></div>`}<div class="k-ch-plot"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label || 'chart')}">${plot}</svg>${dots}</div></div>${xAxis}`, kind === 'scatter' ? headOf() : headOf(lastV !== undefined ? fmt(lastV) : undefined), legend)

  // one series' bars: each its own color only when the chart says how (a color template or a tone map)
  function rowColorOr(i: number, c: string) {
    return hue(e.color, rs[i]) || (w => (w ? colorCss(w) : ''))(toneWord(e, String(ys[0][i]), rs[i])) || c
  }
}

// a heatmap's level, 0-4, of the highest
const level = (v: number, top: number) => (!(v > 0) ? 0 : Math.min(4, Math.max(1, Math.ceil((v / (top || 1)) * 4))))
const STATE: [RegExp, Tone][] = [
  [/^(up|ok|okay|operational|healthy|passing|passed|live|online|green|success|succeeded|done|ready|running)$/i, 'good'],
  [/^(degraded|slow|partial|pending|queued|warn|warning|maintenance|yellow|starting|deploying)$/i, 'warn'],
  [/^(down|outage|offline|failing|failed|error|red|broken|crashed|stopped)$/i, 'bad'],
]
const stateTone = (e: El, state: string, s: S) => toneOf(e, state, s) || (t => (t ? `t-${t}` : 't-muted'))(STATE.find(([re]) => re.test(state.trim()))?.[1])
const CALLOUT: Record<string, string> = { good: 'check', bad: 'ciFail', warn: 'bell' }
const SIZE: Record<string, number> = { sm: 12, md: 16, lg: 22, xl: 32 }

// the items of a stats, kv, tags or links: written ones (their props templates), or each row with the element's own
const itemsOf = (e: El, s: S): [El, S][] => (Array.isArray(e.items) ? e.items.filter(x => !obj(x) || !hidden(x, s)).map(x => [obj(x) ? x : { tag: x, value: x, label: x }, s] as [El, S]) : listAt(e.each, s).map((item, i) => [e, inner(s, item, i)] as [El, S]))

// a step's state: its word to done, now, fail, skip, else todo
const STEP: [RegExp, string][] = [
  [/^(done|passed|pass|success|succeeded|ok|complete|completed|finished|shipped)$/i, 'done'],
  [/^(running|current|active|in.progress|doing|building|deploying|started)$/i, 'now'],
  [/^(failed|failing|fail|error|errored|broken|cancell?ed|timed.out)$/i, 'fail'],
  [/^(skipped|skip|n\/a)$/i, 'skip'],
]
// a log line's level: its word, else read off the line
const LEVEL: [RegExp, Tone][] = [
  [/\b(error|err|fatal|critical|panic|exception|failed)\b/i, 'bad'],
  [/\b(warn|warning)\b/i, 'warn'],
  [/\b(debug|trace)\b/i, 'muted'],
]
const levelTone = (lv: string, line: string) => (lv ? (LEVEL.find(([re]) => re.test(lv))?.[1] ?? '') : (LEVEL.find(([re]) => re.test(line))?.[1] ?? ''))
// a rows element's rows: the ones that fit (the rest hidden, +N more), Nothing here when none
function rowsOf(e: El, s: S, cls: string, rowH: number, one: (r: S, item: unknown, i: number, attrs: string) => string) {
  const items = listAt(e.each ?? e.items, s)
  const max = cap(e, s, rowH)
  return `<div${at({ tip: e.tip }, s, cls)} data-rows>${items.map((item, i) => (i >= max && !s.full ? '' : one(inner(s, item, i), item, i, ` data-row${i >= max ? ' data-extra hidden' : ''}`))).join('')}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
}
// a picture: a GitHub login's, else the name's initials in a circle
const face = (login: string, name: string) => avImg(login) || `<span class="k-av k-ini" aria-hidden="true">${esc(initialsOf(name || login))}</span>`
const initialsOf = (t: string) => (w => (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] ?? '?').slice(0, 2)).toUpperCase())(t.trim().split(/[\s._-]+/).filter(Boolean))
const opens = (href: string) => (u => (u ? ` data-open="${esc(u)}"` : ''))(safeUrl(href))
// whether someone's around: their word to a dot
const PRESENCE: [RegExp, Tone][] = [
  [/^(online|available|active|here|in|free|on.?call)$/i, 'good'],
  [/^(away|idle|brb|lunch|later|ooo|out|vacation|holiday)$/i, 'warn'],
  [/^(busy|dnd|do not disturb|meeting|in a meeting|focus|presenting)$/i, 'bad'],
]
// a PR's state: open green, draft muted, merged purple, closed red
const PR_STATE: Record<string, [IconName, string]> = { open: ['pr', 'var(--done, #9ece6a)'], draft: ['pr', 'var(--muted, #7a8294)'], merged: ['gitMerge', 'var(--tc-purple, #bb9af7)'], closed: ['x', 'var(--error, #f7768e)'] }
const CHECKS: [RegExp, IconName, string][] = [
  [/^(pass|passing|passed|success|green|ok)$/i, 'check', 't-good'],
  [/^(fail|failing|failed|failure|error|red)$/i, 'ciFail', 't-bad'],
  [/^(pending|running|queued|in.progress|yellow|expected)$/i, 'clock', 't-warn'],
]
// a day as YYYY-MM-DD in this Mac's time zone: a date stays as written, a time is the day it falls on here
const dayOf = (t: string) => (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : (w => (w === undefined ? '' : (d => (Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''))(new Date(w))))(timeOf(t)))
const pad = (n: number) => String(n).padStart(2, '0')
const keysOf = (t: string) => (t.includes(' ') ? t.split(/\s+/).filter((k, i, l) => k && (k !== '+' || i === l.length - 1)) : (t.match(/\+$|[^+]+/g) ?? [])).slice(0, 8) // Ctrl+Shift+P, ⌘+: ⌘ and +
const round6 = (x: number) => String(Number(x.toFixed(6)))
const howLong = (ms: number) => (m => (d => (d ? `${d}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m ? `${m}m` : 'under a minute'))(Math.floor(m / 1440)))(Math.floor(ms / 60_000))
const clock = (t: number | string) => (d => (Number.isFinite(d.getTime()) ? d.toTimeString().slice(0, 8) : ''))(new Date(t))
// a JSON value that folds: strings cut at 500, 3000 nodes and 40 levels at most
function jsonHtml(v: unknown, open: number) {
  let count = 0
  const leaf = (x: unknown) => (typeof x === 'string' ? `<span class="k-js-s">"${esc(x.length > 500 ? `${x.slice(0, 500)}…` : x)}"</span>` : typeof x === 'number' ? `<span class="k-js-n">${x}</span>` : `<span class="k-js-b">${x === undefined ? 'null' : String(x)}</span>`)
  const walk = (k: string, x: unknown, depth: number): string => {
    if (++count > 3000 || depth > 40) return count === 3001 || depth === 41 ? '<div class="k-js-r k-sub">…</div>' : ''
    const key = k ? `<span class="k-js-k">${esc(k)}</span>: ` : ''
    if (!x || typeof x !== 'object') return `<div class="k-js-r">${key}${leaf(x)}</div>`
    const entries: [string, unknown][] = Array.isArray(x) ? x.map((y, i) => [String(i), y]) : Object.entries(x)
    const sum = Array.isArray(x) ? `[${entries.length}]` : `{${entries.length}}`
    if (!entries.length) return `<div class="k-js-r">${key}<span class="k-sub">${Array.isArray(x) ? '[]' : '{}'}</span></div>`
    return `<details class="k-js-d"${depth < open ? ' open' : ''}><summary class="k-js-r">${key}<span class="k-sub">${sum}</span></summary><div class="k-js-c">${entries.map(([a, b]) => walk(a, b, depth + 1)).join('')}</div></details>`
  }
  return walk('', v, 0)
}

const R: Record<UiType, (e: El, s: S) => string> = {
  stack: (e, s) => `<div${at(e, s, `k-stack${gap(e.gap)}`)}>${kids(e.children, s)}</div>`,
  row: (e, s) => `<div${at(e, s, `k-row${gap(e.gap)} a-${['start', 'center', 'end', 'between'].includes(String(e.align)) ? e.align : 'center'}${e.wrap === true ? ' wrap' : ''}`)}>${kids(e.children, s)}</div>`,
  grid: (e, s) => (c => `<div${at(e, s, `k-grid c-${c}`)} style="--cols:${c}">${kids(e.children, s)}</div>`)(Math.min(6, Math.max(1, Math.round(n(e.columns, s) ?? 2)))),
  section: (e, s) => {
    const head = `${h(e.title, s)}${e.subtitle !== undefined ? `<span class="k-sub">${h(e.subtitle, s)}</span>` : ''}`
    return typeof e.collapsed === 'boolean'
      ? `<details${at(e, s, 'k-section')}${e.collapsed ? '' : ' open'}><summary class="k-sh">${head}</summary>${kids(e.children, s)}</details>`
      : `<section${at(e, s, 'k-section')}>${e.title !== undefined ? `<div class="k-sh">${head}</div>` : ''}${kids(e.children, s)}</section>`
  },
  tabs: (e, s) => {
    const tabs = (Array.isArray(e.tabs) ? e.tabs : []).filter(obj).slice(0, 8)
    const name = `kt-${s.ids.uid}-${++s.ids.n}`
    return `<div${at(e, s, 'k-tabs')}><div class="k-tabbar" role="tablist">${tabs.map((t, i) => `<label><input type="radio" name="${name}"${i ? '' : ' checked'}><span>${h(t.label, s)}</span>${(b => (b ? `<span class="k-badge">${esc(b)}</span>` : ''))(txt(t.badge, s))}</label>`).join('')}</div>${tabs.map(t => `<section class="k-panel">${kids(t.children, s)}</section>`).join('')}</div>`
  },
  header: (e, s) => {
    const title = txt(e.title, s)
    const href = e.href !== undefined ? txt(e.href, s) : ''
    const acts = buttons(e.actions, s)
    return `<div${at(e, s, 'k-header', title)}>${e.icon !== undefined ? `<span class="k-hd-i"${(c => (c ? ` style="color:${c}"` : ''))(hue(e.color, s))}>${icon(e.icon, s, 16)}</span>` : ''}<div class="k-main"><div class="k-hd-t">${href ? link(href, esc(title)) : esc(title)}</div>${e.subtitle !== undefined ? `<div class="k-sub">${h(e.subtitle, s)}</div>` : ''}</div>${acts ? `<div class="k-acts">${acts}</div>` : ''}</div>`
  },
  footer: (e, s) => (acts => `<div${at(e, s, 'k-footer')}><span class="k-ft-t">${h(e.text, s)}</span>${acts ? `<div class="k-acts">${acts}</div>` : ''}</div>`)(buttons(e.actions, s)),
  toolbar: (e, s) => `<div${at(e, s, `k-toolbar a-${['end', 'between'].includes(String(e.align)) ? e.align : 'start'}`)}>${buttons(e.items, s, true, e.labels !== true)}</div>`,
  spacer: () => '<div class="k-spacer"></div>',
  divider: (e, s) => `<hr${at(e, s, 'k-hr')}>`,
  text: (e, s) => (v => `<div${at(e, s, ['k-text', ['sm', 'lg', 'xl'].includes(String(e.size)) ? `s-${e.size}` : '', ['medium', 'semibold', 'bold'].includes(String(e.weight)) ? `w-${e.weight}` : '', e.mono === true ? 'mono' : '', e.muted === true ? 't-muted' : '', e.wrap === true ? 'wrap' : ''].filter(Boolean).join(' '), v, e.color)}>${esc(v)}</div>`)(txt(e.value, s)),
  heading: (e, s) => (l => (v => `<h${l}${at(e, s, 'k-h', v, e.color)}>${esc(v)}</h${l}>`)(txt(e.value, s)))(Math.min(3, Math.max(1, Math.round(n(e.level, s) ?? 2)))),
  callout: (e, s) => {
    const title = txt(e.title, s)
    const tone = toneWord(e, title, s) || 'accent'
    return `<div${at({ ...e, tone }, s, 'k-callout', title)}>${icon(e.icon ?? CALLOUT[tone] ?? 'info', s, 15)}<div class="k-main">${title ? `<b>${esc(title)}</b>` : ''}${e.text !== undefined ? `<div class="k-co-t">${h(e.text, s)}</div>` : ''}</div>${e.action !== undefined ? button(e.action, s, true) : ''}</div>`
  },
  icon: (e, s) => `<span${at(e, s, 'k-ic', '', e.color)}>${icon(e.name, s, SIZE[String(e.size)] ?? 16)}</span>`,
  markdown: (e, s) => `<div${at(e, s, 'k-md')}>${markdownHtml(txt(e.value, s))}</div>`,
  code: (e, s) => (v => `<div${at(e, s, 'k-code')}><pre><code>${esc(v)}</code></pre>${e.copy === true ? copyBtn(v) : ''}</div>`)(txt(e.value, s)),
  quote: (e, s) => (by => `<figure${at(e, s, 'k-quote')}><blockquote>${h(e.text, s)}</blockquote>${by ? `<figcaption>— ${e.href !== undefined ? link(txt(e.href, s), esc(by)) : esc(by)}</figcaption>` : ''}</figure>`)(txt(e.by, s)),
  diff: (e, s) => {
    const lines = txt(e.value, s).replace(/\r/g, '').split('\n')
    while (lines.length && lines.at(-1) === '') lines.pop()
    let hunk = false // in a hunk, --- and +++ are lines removed and added; a file's header comes before its first @@
    const kinds = lines.map(l => (l.startsWith('diff ') ? ((hunk = false), 'f') : l.startsWith('@@') ? ((hunk = true), 'h') : !hunk && /^(index |\+\+\+ |--- |new file|deleted file|rename |similarity |old mode|new mode)/.test(l) ? 'f' : l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : ''))
    const max = cap(e, s, 16)
    const rows = lines.map((l, i) => (i >= max && !s.full ? '' : `<div class="k-dl${kinds[i] ? ` ${kinds[i]}` : ''}" data-row${i >= max ? ' data-extra hidden' : ''}>${esc(l) || ' '}</div>`)).join('')
    return `<div${at({ tip: e.tip }, s, 'k-diff')} data-rows><div class="k-df-h"><span class="t-good">+${kinds.filter(k => k === 'a').length}</span><span class="t-bad">−${kinds.filter(k => k === 'd').length}</span></div>${lines.length ? `<div class="k-df-b">${rows}</div>` : ''}${s.line ? '' : more(lines.length - Math.min(max, lines.length))}</div>`
  },
  // ponytail: its words as of the render (the app draws it again at each fetch): minutes, never seconds ticking
  countdown: (e, s) => {
    const t = timeOf(txt(e.to, s).trim())
    const ms = t === undefined ? NaN : new Date(t).getTime()
    const label = txt(e.label, s)
    const left = ms - Date.now()
    const words = !Number.isFinite(ms) ? '–' : left > 0 ? `in ${howLong(left)}` : e.past !== undefined ? txt(e.past, s) : ago(ms)
    const tone = e.tone !== undefined || !Number.isFinite(ms) ? '' : left <= 0 ? ' t-muted' : left < (n(e.soon, s) ?? 24) * 3_600_000 ? ' t-warn' : ''
    return `<div${at(e, s, `k-cd${tone}`, words)}${Number.isFinite(ms) && e.tip === undefined ? ` title="${esc(new Date(ms).toLocaleString())}"` : ''}><b>${esc(words)}</b>${label ? `<span>${esc(label)}</span>` : ''}</div>`
  },
  stat,
  kbd: (e, s) => (keys => `<span${at(e, s, 'k-kbd')}>${keys.map(k => `<kbd>${esc(k)}</kbd>`).join('')}${e.label !== undefined ? `<span class="k-kbd-l">${h(e.label, s)}</span>` : ''}</span>`)(keysOf(txt(e.keys, s).trim())),
  secret: (e, s) => {
    const v = txt(e.value, s)
    const dots = v ? `${'•'.repeat(8)}${v.length > 16 ? esc(v.slice(-4)) : ''}` : '' // a long one's last 4: which key it is
    return `<div${at(e, s, 'k-secret')}>${e.label !== undefined ? `<span class="k-sc-l">${h(e.label, s)}</span>` : ''}<details class="k-sc"><summary title="Show it"><span class="k-sc-d mono">${dots}</span>${iconSvg('eye', 12)}</summary><code class="mono">${esc(v)}</code></details>${v && e.copy !== false ? copyBtn(v) : ''}</div>`
  },
  stats: (e, s) => `<div${at({ tip: e.each === undefined ? e.tip : undefined }, s, 'k-stats')}>${itemsOf(e, s).map(([x, r]) => stat(x === e ? e : { ...x, tone: x.tone ?? e.tone }, r)).join('')}</div>`,
  kv: (e, s) =>
    `<dl${at({ tip: e.tip }, s, 'k-kv')}>${itemsOf(e, s)
      .map(([x, r]) => {
        const v = txt(x.value, r)
        return `<div data-row><dt>${h(x.key, r)}</dt><dd class="${[x.mono === true || e.mono === true ? 'mono' : '', toneOf(x === e ? e : { tone: x.tone ?? e.tone }, v, r)].filter(Boolean).join(' ')}"><span>${esc(v)}</span>${(x.copy ?? e.copy) === true && v ? copyBtn(v) : ''}</dd></div>`
      })
      .join('')}</dl>`,
  list,
  table,
  chart,
  spark: (e, s) => `<div${at(e, s, 'k-spark', '', e.color)}>${spark(valueAt(e.values, s.scopes))}</div>`,
  gauge: (e, s) => {
    const lo = n(e.min, s) ?? 0
    const hi = n(e.max, s) ?? 100
    const v = n(e.value, s)
    const pct = v === undefined ? 0 : Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100))
    const label = txt(e.label, s)
    const shown = v === undefined ? '–' : `${num(v)}${txt(e.unit, s)}`
    return `<div${at(e, s, 'k-gauge', String(v ?? ''), e.color)}><div class="k-ga-c"><svg viewBox="0 0 100 56" aria-hidden="true"><path class="bg" d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke-width="9" stroke-linecap="round" pathLength="100"/><path class="fg" d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="${f1(pct)} 100"/></svg><b>${esc(shown)}</b></div>${label ? `<span class="k-ga-l">${esc(label)}</span>` : ''}</div>`
  },
  heatmap: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const rs = items.map((item, i) => inner(s, item, i))
    const vals = rs.map(r => n(e.value ?? '{{value}}', r) ?? 0)
    const top = n(e.max, s) ?? Math.max(0, ...vals)
    const down = Math.min(31, Math.max(1, Math.round(n(e.rows, s) ?? 7)))
    return `<div${at({ tip: e.tip, tone: e.tone }, s, 'k-hm')} style="--rows:${down}${(c => (c ? `;color:${c}` : ''))(hue(e.color, s))}">${rs.map((r, i) => `<i class="l${level(vals[i], top)}" title="${esc(`${txt(e.x, r)}${txt(e.x, r) ? ': ' : ''}${num(vals[i])}`)}"></i>`).join('')}</div>`
  },
  status: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const max = cap(e, s, 24)
    return `<div${at({ tip: e.tip }, s, 'k-status')} data-rows>${items
      .map((item, i) => {
        if (i >= max && !s.full) return ''
        const r = inner(s, item, i)
        const state = txt(e.state ?? '{{state}}', r)
        const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
        const t = stateTone(e, state, r)
        return `<div class="k-st" data-row${i >= max ? ' data-extra hidden' : ''}${href ? ` data-open="${esc(href)}"` : ''}><i class="k-st-dot ${t}"></i><span class="k-st-l">${h(e.label ?? '{{label}}', r)}</span>${e.text !== undefined ? `<span class="k-sub">${h(e.text, r)}</span>` : ''}<span class="k-st-s ${t}">${esc(state)}</span></div>`
      })
      .join('')}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
  },
  checklist: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const rs = items.map((item, i) => inner(s, item, i))
    const done = rs.map((r, i) => (e.done !== undefined ? holds(e.done, r) : obj(items[i]) && truthy(items[i].done)))
    const max = cap(e, s, 22)
    const n0 = done.filter(Boolean).length
    const head = e.count === false || !items.length ? '' : `<div class="k-ck-h"><b>${n0}/${items.length}</b><span class="k-bar"><i style="width:${f1((n0 / items.length) * 100)}%"></i></span></div>`
    return `<div${at({ tip: e.tip }, s, 'k-checks')} data-rows>${head}${rs
      .map((r, i) => {
        if (i >= max && !s.full) return ''
        const text = e.text !== undefined ? txt(e.text, r) : typeof items[i] === 'string' ? String(items[i]) : txt('{{text}}', r)
        return `<div class="k-ck${done[i] ? ' on' : ''}" data-row${i >= max ? ' data-extra hidden' : ''}><span class="k-box">${done[i] ? iconSvg('check', 10) : ''}</span><span class="k-ck-t">${esc(text)}</span></div>`
      })
      .join('')}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
  },
  avatars: (e, s) => {
    const logins = listAt(e.each ?? e.items, s).map((item, i) => (e.login !== undefined ? txt(e.login, inner(s, item, i)) : typeof item === 'string' ? item : txt('{{login}}', inner(s, item, i))).trim()).filter(l => avatarUrl(l))
    const max = Math.max(1, Math.round(n(e.max, s) ?? 5))
    return logins.length ? `<div${at({ tip: e.tip }, s, 'k-avs')}>${logins.slice(0, max).map(l => `<img class="k-av" src="${avatarUrl(l)}" alt="${esc(l)}" title="${esc(l)}">`).join('')}${logins.length > max ? `<span class="k-avs-n">+${logins.length - max}</span>` : ''}</div>` : ''
  },
  progress: (e, s) => {
    const max = n(e.max, s) ?? 100
    const pct = Math.round(Math.min(100, Math.max(0, ((n(e.value, s) ?? 0) / (max || 1)) * 100)))
    const label = txt(e.label, s)
    if (e.style === 'ring')
      return `<div${at(e, s, 'k-prog ring', String(pct), e.color)}><svg width="32" height="32" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4"/><circle class="fg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg><div class="k-prog-h"><b>${pct}%</b><span>${esc(label)}</span></div></div>`
    return `<div${at(e, s, 'k-prog', String(pct), e.color)}><div class="k-prog-h"><span>${esc(label)}</span><b>${pct}%</b></div><div class="k-bar"><i style="width:${pct}%"></i></div></div>`
  },
  tags: (e, s) =>
    `<div${at({ tip: e.tip }, s, 'k-tags')}>${itemsOf(e, s)
      .map(([x, r]) => {
        const t = txt(x.tag, r)
        const c = hue(x.color ?? (x === e ? undefined : e.color), r)
        return t ? `<span class="k-tag ${toneOf(x === e ? e : { tone: x.tone ?? e.tone }, t, r)}"${c ? ` style="border-color:${c}"` : ''}>${c ? `<i class="k-dotc" style="background:${c}"></i>` : ''}${esc(t)}</span>` : ''
      })
      .join('')}</div>`,
  badge: (e, s) => (v => (v ? `<span${at(e, s, `k-badge${e.color !== undefined && hue(e.color, s) ? ' c' : ''}`, v, e.color)}>${esc(v)}</span>` : ''))(txt(e.value, s)),
  timeline: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const max = cap(e, s, 34)
    return `<ol${at({ tip: e.tip }, s, 'k-tl')} data-rows>${items
      .map((item, i) => {
        if (i >= max && !s.full) return ''
        const r = inner(s, item, i)
        const tm = txt(e.time, r).trim()
        const title = txt(e.title, r)
        const text = txt(e.text, r)
        return `<li data-row${i >= max ? ' data-extra hidden' : ''}><i class="k-tl-dot ${toneOf(e, title, r)}"></i>${e.icon !== undefined ? icon(e.icon, r, 13) : ''}<div class="k-main"><div class="k-tl-h"><b>${esc(title)}</b>${when(tm)}</div>${text ? `<div class="k-sub">${esc(text)}</div>` : ''}</div></li>`
      })
      .join('')}</ol>${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}`
  },
  card: (e, s) => {
    const one = (r: S) => {
      const title = txt(e.title, r)
      const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
      const img = e.image !== undefined ? txt(e.image, r).trim() : ''
      const tag = e.tag !== undefined ? txt(e.tag, r) : ''
      const top = imageOk(img) ? `<img class="k-card-img" src="${esc(img)}" alt="">` : e.icon !== undefined ? `<span class="k-card-ic">${icon(e.icon, r, 18)}</span>` : ''
      return `<div class="k-card${href ? ' link' : ''}" data-row${href ? ` data-open="${esc(href)}"` : ''}>${top}<div class="k-card-b"><div class="k-card-h"><b>${esc(title)}</b>${tag ? `<span class="k-tag ${toneOf(e, tag, r)}">${esc(tag)}</span>` : ''}</div>${e.text !== undefined ? `<div class="k-card-t">${h(e.text, r)}</div>` : ''}</div></div>`
    }
    if (e.each === undefined && e.items === undefined) return `<div${at({ tip: e.tip }, s, 'k-cards one')}>${one(s)}</div>`
    const items = listAt(e.each ?? e.items, s)
    return `<div${at({ tip: e.tip }, s, 'k-cards')} data-rows>${items.map((item, i) => one(inner(s, item, i))).join('')}${empty(e, s, items.length)}</div>`
  },
  image: (e, s) => (u => (imageOk(u) ? `<img${at(e, s, 'k-img')} src="${esc(u)}" alt="${h(e.alt, s)}"${(x => (x ? ` style="height:${Math.min(2000, x)}px"` : ''))(n(e.height, s))}>` : ''))(txt(e.src, s).trim()),
  steps: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    return `<ol${at({ tip: e.tip }, s, 'k-steps')}>${items
      .map((item, i) => {
        const r = inner(s, item, i)
        const state = txt(e.state ?? '{{state}}', r).trim()
        const k = STEP.find(([re]) => re.test(state))?.[1] ?? 'todo'
        const label = txt(e.label ?? '{{label}}', r)
        const text = e.text !== undefined ? txt(e.text, r) : ''
        const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
        return `<li class="k-sp ${k}"${href ? ` data-open="${esc(href)}"` : ''} title="${esc(`${label}${state ? `: ${state}` : ''}`)}"><i class="k-sp-dot">${k === 'done' ? iconSvg('check', 10) : k === 'fail' ? iconSvg('x', 10) : ''}</i><div class="k-main"><b>${esc(label)}</b>${text ? `<span class="k-sub">${esc(text)}</span>` : ''}</div></li>`
      })
      .join('')}</ol>${empty(e, s, items.length)}`
  },
  meter: (e, s) => {
    const parts = itemsOf(e, s)
      .map(([x, r], i) => ({ label: txt(x.label, r), v: n(x.value, r) ?? 0, c: hue(x.color, r) || colorCss(PALETTE[i % PALETTE.length]) }))
      .filter(x => x.v > 0)
    const unit = txt(e.unit, s)
    const total = parts.reduce((a, x) => a + x.v, 0)
    const whole = Math.max(n(e.max, s) ?? total, total) || 1
    const title = txt(e.title, s)
    const bar = `<div class="k-meter-b">${parts.map(x => `<i style="width:${f1((x.v / whole) * 100)}%;background:${x.c}" title="${esc(`${x.label}: ${num(x.v)}${unit}`)}"></i>`).join('')}</div>`
    const of = n(e.max, s) !== undefined ? ` of ${num(whole)}${unit}` : ''
    return `<div${at({ tip: e.tip }, s, 'k-meter')}>${title ? `<div class="k-ch-head"><span>${esc(title)}</span><b>${esc(`${num(total)}${unit}${of}`)}</b></div>` : ''}${bar}${e.legend === false ? '' : legendOf(parts.map(x => [x.label, x.c, `${num(x.v)}${unit}`]))}</div>`
  },
  board: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const cols = new Map<string, S[]>()
    for (const c of Array.isArray(e.columns) ? e.columns : []) cols.set(txt(c, s), [])
    items.forEach((item, i) => (r => (k => cols.set(k, [...(cols.get(k) ?? []), r]))(txt(e.column ?? '{{state}}', r)))(inner(s, item, i)))
    const max = cap(e, s, 46)
    const card = (r: S, extra: boolean) => {
      const title = txt(e.title ?? '{{title}}', r)
      const sub = e.subtitle !== undefined ? txt(e.subtitle, r) : ''
      const tag = e.tag !== undefined ? txt(e.tag, r) : ''
      const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
      const av = e.avatar !== undefined ? avatarUrl(txt(e.avatar, r)) : ''
      return `<div class="k-bd-c" data-row${extra ? ' data-extra hidden' : ''}${href ? ` data-open="${esc(href)}"` : ''}><div class="k-bd-t ${toneOf(e, title, r)}">${esc(title)}</div>${sub || tag || av ? `<div class="k-bd-m">${av ? `<img class="k-av" src="${av}" alt="">` : ''}${sub ? `<span class="k-sub">${esc(sub)}</span>` : ''}${tag ? `<span class="k-tag ${toneOf(e, tag, r)}">${esc(tag)}</span>` : ''}</div>` : ''}</div>`
    }
    return `<div${at({ tip: e.tip }, s, 'k-board')}>${[...cols]
      .map(([name, rs]) => `<div class="k-bd-col" data-rows><div class="k-gh">${esc(name || '–')}<span class="k-sub">${rs.length}</span></div>${rs.map((r, i) => (i >= max && !s.full ? '' : card(r, i >= max))).join('')}${s.line ? '' : more(rs.length - Math.min(max, rs.length))}</div>`)
      .join('')}</div>${empty(e, s, items.length)}`
  },
  tree: (e, s) => {
    const field = txt(e.nested, s).trim() || 'children'
    const open = Math.max(0, Math.round(n(e.open, s) ?? 1))
    let count = 0
    const nodeOf = (item: unknown, i: number, depth: number): string => {
      if (++count > 2000 || depth > 30) return ''
      const r = inner(s, item, i) // a node's own fields only: never its parent's through the scopes
      const kids = obj(item) && Array.isArray(item[field]) ? (item[field] as unknown[]) : []
      const label = e.label !== undefined ? txt(e.label, r) : typeof item === 'string' ? item : txt('{{label}}', r)
      const side = e.text !== undefined ? txt(e.text, r) : ''
      const href = e.href !== undefined ? safeUrl(txt(e.href, r)) : ''
      const line = `${e.icon !== undefined ? icon(e.icon, r, 13) : ''}<span class="k-tr-l ${toneOf(e, label, r)}">${esc(label)}</span>${side ? `<span class="k-sub">${esc(side)}</span>` : ''}`
      if (!kids.length) return `<div class="k-tr-n" data-row${href ? ` data-open="${esc(href)}"` : ''}>${line}</div>`
      return `<details class="k-tr-d"${depth < open ? ' open' : ''}><summary class="k-tr-n">${line}<span class="k-tr-c">${kids.length}</span></summary><div class="k-tr-k">${kids.map((x, j) => nodeOf(x, j, depth + 1)).join('')}</div></details>`
    }
    const items = listAt(e.each ?? e.items, s)
    return `<div${at({ tip: e.tip }, s, 'k-tree')}>${items.map((x, i) => nodeOf(x, i, 0)).join('')}</div>${empty(e, s, items.length)}`
  },
  log: (e, s) => {
    const lines =
      e.value !== undefined
        ? (l => (l.at(-1) === '' ? l.slice(0, -1) : l))(txt(e.value, s).replace(/\r/g, '').split('\n')).map(text => ({ text, time: '', level: '' }))
        : listAt(e.each ?? e.items, s).map((item, i) => (r => ({ text: e.text !== undefined ? txt(e.text, r) : typeof item === 'string' ? item : txt('{{text}}', r), time: e.time !== undefined ? txt(e.time, r).trim() : '', level: e.level !== undefined ? txt(e.level, r).trim() : '' }))(inner(s, item, i)))
    const max = cap(e, s, 16)
    const from = Math.max(0, lines.length - max) // the newest: the last ones
    const row = (x: (typeof lines)[number], i: number) => {
      const t = levelTone(x.level, x.text)
      const when = x.time ? (w => (w === undefined ? x.time : clock(w) || x.time))(timeOf(x.time)) : ''
      return `<div class="k-lg-l${t ? ` t-${t}` : ''}" data-row${i < from ? ' data-extra hidden' : ''}>${when ? `<span class="k-lg-t">${esc(when)}</span>` : ''}<span class="k-lg-x">${esc(x.text) || ' '}</span></div>`
    }
    return `<div${at({ tip: e.tip }, s, `k-log${e.wrap === true ? ' wrap' : ''}`)} data-rows>${s.line ? '' : more(from)}${lines.map((x, i) => (i < from && !s.full ? '' : row(x, i))).join('')}</div>${empty(e, s, lines.length)}`
  },
  json: (e, s) => (v => (s.line ? `<span${at({ tip: e.tip }, s, 'k-json mono')}>${esc((JSON.stringify(v) ?? 'null').slice(0, 300))}</span>` : `<div${at({ tip: e.tip }, s, 'k-json')}>${jsonHtml(v, Math.max(0, Math.round(n(e.open, s) ?? 1)))}</div>`))(valueAt(e.value ?? 'data', s.scopes)),
  rating: (e, s) => {
    const max = Math.min(10, Math.max(1, Math.round(n(e.max, s) ?? 5)))
    const v = Math.min(max, Math.max(0, n(e.value, s) ?? 0))
    const label = txt(e.label, s)
    const stars = Array.from({ length: max }, (_, i) => `<i style="--f:${Math.round(Math.min(1, Math.max(0, v - i)) * 100)}%"></i>`).join('')
    return `<div${at(e, s, 'k-rate', String(v), e.color)} role="img" aria-label="${esc(`${+v.toFixed(1)} of ${max}`)}"><span class="k-stars">${stars}</span><b>${+v.toFixed(1)}</b>${label ? `<span class="k-sub">${esc(label)}</span>` : ''}</div>`
  },
  calendar: (e, s) => {
    const evs = listAt(e.each ?? e.items, s)
      .map((item, i) => (r => ({ day: dayOf(txt(e.date ?? '{{date}}', r).trim()), title: txt(e.title ?? '{{title}}', r), c: hue(e.color, r), href: e.href !== undefined ? safeUrl(txt(e.href, r)) : '' }))(inner(s, item, i)))
      .filter(x => x.day)
    const now = new Date()
    const today = dayOf(String(now.getTime()))
    const m = /^(\d{4})-(\d{2})/.exec(txt(e.month, s).trim())
    const y = m ? Number(m[1]) : now.getFullYear()
    const mo = m ? Math.min(11, Math.max(0, Number(m[2]) - 1)) : now.getMonth()
    const first = new Date(y, mo, 1)
    const days = new Date(y, mo + 1, 0).getDate()
    const lead = (first.getDay() + 6) % 7 // Monday first, as Laki's Calendar
    const key = (d: number) => `${y}-${pad(mo + 1)}-${pad(d)}`
    const on = (d: number) => evs.filter(x => x.day === key(d))
    const month = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    if (s.line) {
      const next = evs.filter(x => x.day >= today).sort((a, b) => a.day.localeCompare(b.day))[0]
      return `<span${at({ tip: e.tip }, s, 'k-cal-line')}>${iconSvg('calendar', 12)}${next ? `<b>${esc(new Date(`${next.day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }))}</b> ${esc(next.title)}` : `<span class="k-sub">Nothing coming up</span>`}</span>`
    }
    const all = [
      ...Array.from({ length: lead }, () => '<span class="k-cd out"></span>'),
      ...Array.from({ length: days }, (_, i) => {
        const d = i + 1
        const x = on(d)
        const href = x.find(v => v.href)?.href
        return `<span class="k-cd${key(d) === today ? ' today' : ''}${x.length ? ' has' : ''}"${x.length ? ` title="${esc(x.map(v => v.title).join('\n'))}"` : ''}${href ? ` data-open="${esc(href)}"` : ''}><span>${d}</span>${x.length ? `<span class="k-cd-dots">${x.slice(0, 3).map(v => `<i${v.c ? ` style="background:${v.c}"` : ''}></i>`).join('')}</span>` : ''}</span>`
      }),
    ]
    // a preview: the weeks that fit, from today's (a month needs a full view or 3 cells down)
    const weeks = Math.ceil(all.length / 7)
    const fit = s.full ? weeks : Math.max(1, Math.floor((s.cells[1] * 64 - 34) / 20))
    const now0 = key(now.getDate()) === today ? Math.floor((lead + now.getDate() - 1) / 7) : 0
    const from = Math.max(0, Math.min(now0, weeks - fit))
    const cells = all.slice(from * 7, (from + fit) * 7).join('')
    const week = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' })) // 1 Jan 2024: a Monday
    const listed = e.list !== undefined ? e.list === true : s.full
    const mine = evs.filter(x => x.day.startsWith(`${y}-${pad(mo + 1)}`)).sort((a, b) => a.day.localeCompare(b.day))
    const list = listed && mine.length ? `<div class="k-cal-list">${mine.map(x => `<div class="k-cal-ev"${x.href ? ` data-open="${esc(x.href)}"` : ''}><i${x.c ? ` style="background:${x.c}"` : ''}></i><span class="k-time">${esc(new Date(`${x.day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }))}</span><span class="k-title">${esc(x.title)}</span></div>`).join('')}</div>` : ''
    return `<div${at({ tip: e.tip }, s, 'k-cal')}><div class="k-cal-h">${esc(month)}</div><div class="k-cal-g">${week.map(w => `<span class="k-cw">${esc(w)}</span>`).join('')}${cells}</div>${list}</div>`
  },
  people: (e, s) =>
    rowsOf(e, s, 'k-people', 32, (r, item, _i, attrs) => {
      const name = e.name !== undefined ? txt(e.name, r) : typeof item === 'string' ? item : txt('{{name}}', r)
      const login = e.login !== undefined ? txt(e.login, r).trim() : ''
      const state = e.state !== undefined ? txt(e.state, r).trim() : ''
      const t = state ? toneOf(e, state, r) || (w => (w ? `t-${w}` : 't-muted'))(PRESENCE.find(([re]) => re.test(state))?.[1]) : ''
      return `<div class="k-pp"${attrs}${e.href !== undefined ? opens(txt(e.href, r)) : ''}${state ? ` title="${esc(`${name}: ${state}`)}"` : ''}><span class="k-pp-f">${face(login, name)}${state ? `<i class="k-pp-dot ${t}"></i>` : ''}</span><div class="k-main"><span class="k-title">${esc(name)}</span>${e.text !== undefined ? `<span class="k-sub">${h(e.text, r)}</span>` : ''}</div>${state ? `<span class="k-pp-s ${t}">${esc(state)}</span>` : ''}</div>`
    }),
  inbox: (e, s) =>
    rowsOf(e, s, 'k-inbox', 46, (r, _item, _i, attrs) => {
      const from = txt(e.from ?? '{{from}}', r)
      const tm = e.time !== undefined ? txt(e.time, r).trim() : ''
      const unread = e.unread !== undefined && holds(e.unread, r)
      const text = e.text !== undefined ? txt(e.text, r) : ''
      return `<div class="k-ib${unread ? ' on' : ''}"${attrs}${e.href !== undefined ? opens(txt(e.href, r)) : ''}>${face(e.login !== undefined ? txt(e.login, r).trim() : '', from)}<div class="k-main"><div class="k-ib-h"><b>${esc(from)}</b>${when(tm)}</div><div class="k-title">${unread ? '<i class="k-ib-dot"></i>' : ''}${h(e.subject ?? '{{subject}}', r)}</div>${text ? `<div class="k-sub">${esc(text)}</div>` : ''}</div></div>`
    }),
  chat: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const max = cap(e, s, 44)
    const from = Math.max(0, items.length - max) // the newest: the last ones
    return `<div${at({ tip: e.tip }, s, 'k-chat')} data-rows>${s.line ? '' : more(from)}${items
      .map((item, i) => {
        if (i < from && !s.full) return ''
        const r = inner(s, item, i)
        const who = txt(e.from ?? '{{from}}', r)
        const tm = e.time !== undefined ? txt(e.time, r).trim() : ''
        const me = e.mine !== undefined && holds(e.mine, r)
        return `<div class="k-msg${me ? ' me' : ''}" data-row${i < from ? ' data-extra hidden' : ''}>${me ? '' : face(e.login !== undefined ? txt(e.login, r).trim() : '', who)}<div class="k-bub">${me && !tm ? '' : `<div class="k-msg-h">${me ? '' : `<b>${esc(who)}</b>`}${when(tm, t => clock(t).slice(0, 5))}</div>`}<div class="k-msg-t">${h(e.text ?? '{{text}}', r)}</div></div></div>`
      })
      .join('')}${empty(e, s, items.length)}</div>`
  },
  prs: (e, s) =>
    rowsOf(e, s, 'k-prs', 36, (r, _item, _i, attrs) => {
      const state = txt(e.state ?? '{{state}}', r).trim().toLowerCase()
      const [ic, c] = PR_STATE[/merged/.test(state) ? 'merged' : /closed/.test(state) ? 'closed' : /draft/.test(state) ? 'draft' : 'open']
      const num = txt(e.number ?? '{{number}}', r).trim()
      const author = txt(e.author ?? '{{author}}', r).trim()
      const ck = e.checks !== undefined ? (w => CHECKS.find(([re]) => re.test(w)))(txt(e.checks, r).trim()) : undefined
      const rv = e.review !== undefined ? txt(e.review, r).trim() : ''
      const rt = /^approved?$/i.test(rv) ? ['approved', 't-good'] : /changes/i.test(rv) ? ['changes', 't-bad'] : rv ? [rv, ''] : undefined
      const tm = e.time !== undefined ? txt(e.time, r).trim() : ''
      const t = timeOf(tm)
      return `<div class="k-pr"${attrs}${opens(txt(e.href ?? '{{url}}', r))}><span class="k-pr-i" style="color:${c}" title="${esc(state || 'open')}">${iconSvg(ic, 14)}</span><div class="k-main"><span class="k-title">${h(e.title ?? '{{title}}', r)}</span><span class="k-sub">${[num && `#${esc(num)}`, author && esc(author), tm && esc(t !== undefined ? ago(t) : tm)].filter(Boolean).join(' · ')}</span></div>${ck ? `<span class="k-pr-ck ${ck[2]}" title="checks: ${esc(txt(e.checks, r).trim())}">${iconSvg(ck[1], 13)}</span>` : ''}${rt ? `<span class="k-tag ${rt[1]}">${esc(rt[0])}</span>` : ''}${avImg(author)}</div>`
    }),
  commits: (e, s) =>
    rowsOf(e, s, 'k-commits', 26, (r, _item, _i, attrs) => {
      const sha = txt(e.sha ?? '{{sha}}', r).trim()
      const msg = txt(e.message ?? '{{message}}', r).split('\n')[0]
      const author = e.author !== undefined ? txt(e.author, r).trim() : ''
      const tm = e.time !== undefined ? txt(e.time, r).trim() : ''
      return `<div class="k-cm"${attrs}${e.href !== undefined ? opens(txt(e.href, r)) : ''}>${sha ? `<code class="k-sha" data-copy="${esc(sha)}" title="Copy ${esc(sha)}">${esc(sha.slice(0, 7))}</code>` : ''}<span class="k-cm-m">${esc(msg)}</span>${avImg(author) || (author ? `<span class="k-sub">${esc(author)}</span>` : '')}${when(tm)}</div>`
    }),
  button: (e, s) => button(e, s),
  toggle: (e, s) => {
    const on = e.on !== undefined && holds(e.on, s)
    const label = txt(e.label, s)
    const text = e.text !== undefined ? txt(e.text, s) : ''
    const run = e.run !== undefined ? txt(e.run, s) : ''
    return `<button type="button" role="switch" aria-checked="${on}"${at(e, s, `k-toggle${on ? ' on' : ''}`, label)}${run ? ` data-run="${esc(run)}" data-arg="${on ? 'off' : 'on'}"` : ' disabled'}${e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''}><span class="k-main"><span class="k-tg-l">${esc(label)}</span>${text ? `<span class="k-sub">${esc(text)}</span>` : ''}</span><i class="k-tg-s"></i></button>`
  },
  segmented: (e, s) => {
    const opts = (Array.isArray(e.options) ? e.options : []).filter(o => !obj(o) || !hidden(o, s)).map(o => (obj(o) ? { v: txt(o.value ?? o.label, s).trim(), l: txt(o.label ?? o.value, s) } : { v: txt(o, s).trim(), l: txt(o, s) })).filter(o => o.v).slice(0, 8)
    const cur = txt(e.value, s).trim()
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const confirm = e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''
    return `<div${at(e, s, 'k-segw', cur)}>${e.label !== undefined ? `<span class="k-seg-l">${h(e.label, s)}</span>` : ''}<div class="k-seg" role="group">${opts.map(o => (on => `<button type="button" class="k-seg-o${on ? ' on' : ''}" aria-pressed="${on}"${on ? '' : run ? ` data-run="${esc(run)}" data-arg="${esc(o.v)}"${confirm}` : ' disabled'}>${esc(o.l)}</button>`)(o.v === cur)).join('')}</div></div>`
  },
  stepper: (e, s) => {
    const v = n(e.value, s) ?? 0
    const step = Math.abs(n(e.step, s) || 1)
    const min = n(e.min, s)
    const max = n(e.max, s)
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const confirm = e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''
    const go = (x: number, sign: string, label: string) => (to => `<button type="button" class="k-step-b" aria-label="${label}"${run && (min === undefined || to >= min) && (max === undefined || to <= max) ? ` data-run="${esc(run)}" data-arg="${round6(to)}"${confirm}` : ' disabled'}>${sign}</button>`)(Number(round6(x))) // 0.2 + 0.1 is 0.3, not over a max of 0.3
    const label = txt(e.label, s)
    return `<div${at(e, s, 'k-stepper', String(v))}>${label ? `<span class="k-step-l">${esc(label)}</span>` : ''}<div class="k-step">${go(v - step, '−', 'Less')}<b>${esc(round6(v))}${e.unit !== undefined ? `<span class="k-unit">${h(e.unit, s)}</span>` : ''}</b>${go(v + step, '+', 'More')}</div></div>`
  },
  actions: (e, s) => `<div${at(e, s, 'k-actions')}>${buttons(e.items, s, false)}</div>`,
  links: (e, s) => `<div${at(e, s, 'linkbar k-links')}>${itemsOf(e, s).map(([x, r]) => link(txt(x.href, r), h(x.label ?? x.href, r))).join('')}</div>`,
  form: (e, s) => {
    const fields = (Array.isArray(e.fields) ? e.fields : []).filter(obj).filter(f => /^[A-Za-z_][\w-]{0,40}$/.test(String(f.id)))
    const field = (f: El) => {
      const id = esc(f.id)
      const label = h(f.label ?? f.id, s)
      const hint = f.hint !== undefined ? h(f.hint, s) : ''
      const def = txt(f.default, s)
      if (f.type === 'bool') return `<label class="k-check"><input type="checkbox" name="${id}"${def && def !== 'false' ? ' checked' : ''}><span>${label}</span></label>`
      const input =
        f.type === 'choice'
          ? `<select name="${id}">${(Array.isArray(f.choices) ? f.choices : []).map(c => (v => `<option${v === def ? ' selected' : ''}>${esc(v)}</option>`)(txt(c, s))).join('')}</select>`
          : f.type === 'textarea'
            ? `<textarea name="${id}" rows="3" placeholder="${hint}">${esc(def)}</textarea>`
            : `<input type="${f.type === 'number' ? 'number' : 'text'}" name="${id}" value="${esc(def)}" placeholder="${hint}">`
      return `<label class="k-field"><span>${label}</span>${input}</label>`
    }
    const sub = obj(e.submit) ? e.submit : {}
    return `<div${at(e, s, 'k-form')} data-form>${fields.map(field).join('')}<div class="k-form-foot"><button type="button" class="k-btn primary" data-run="${h(sub.run, s)}" data-submit${sub.confirm !== undefined ? ` data-confirm="${h(sub.confirm, s)}"` : ''}>${h(sub.label ?? 'Submit', s)}</button></div></div>`
  },
  empty: (e, s) => `<div${at(e, s, 'k-empty')}>${e.icon !== undefined ? icon(e.icon, s, 18) : ''}<div>${h(e.text ?? 'Nothing here', s)}</div>${e.action !== undefined ? button(e.action, s, true) : ''}</div>`,
}

// a widget's ui as HTML for its preview or full view, over its context ({ data, config, at, error, full, sample,
// workspace }, the same names as a template's: {{open}} as {{data.open}}); cells: where it shows (across, down; ½ down: a
// bar's line). A failed fetch with no data: the error and Retry, instead of the tree
export function uiHtml(spec: unknown, ctx: Record<string, unknown>, o: { full?: boolean; cells?: [number, number] } = {}) {
  const tree = uiTree(spec, !!o.full)
  if (!tree) return ''
  const data = ctx.data
  const top = { ...(obj(data) ? data : {}), ...ctx, full: !!o.full }
  const cells: [number, number] = o.cells && o.cells.length === 2 ? [Number(o.cells[0]) || 1, Number(o.cells[1]) || 1] : o.full ? [3, 4] : [1, 1]
  const line = !o.full && cells[1] <= 0.5
  const s: S = { scopes: [top], full: !!o.full, single: isElement(spec), cells, line, ids: { uid: Math.random().toString(36).slice(2, 7), n: 0 } }
  const failed = !!ctx.error && (data === undefined || data === null)
  const body = failed ? `<div class="k-error"><b>${line ? '⚠' : 'Couldn’t fetch it'}</b><div class="k-sub">${esc(ctx.error)}</div><button type="button" class="k-btn sm" data-laki="refresh">Retry</button></div>` : node(tree, s)
  return `<div class="k" data-kit="${o.full ? 'full' : 'preview'}"${line ? ' data-line' : ''}>${body}</div>`
}

// ---------- what's wrong with a ui, for laki widget check, the inspector and agents: unknown elements and props,
// props of the wrong kind, actions and icons that aren't there; with data (a fixture, the last fetch), each's lists
// and the fields its rows use
export type UiProblem = { level: 'error' | 'warn' | 'ok'; where: string; text: string } // ok: a check that passed (widgetCheck's)

// the nearest of some words, for "did you mean": within a third of its length (2 at least) of edits
export function near(word: string, words: readonly string[]) {
  const d = (a: string, b: string) => {
    const row = [...Array(b.length + 1).keys()]
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) [prev, row[j]] = [row[j], Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))]
    }
    return row[b.length]
  }
  const best = words.map(w => [w, d(word.toLowerCase(), w.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0]
  return best && best[1] <= Math.max(2, Math.floor(word.length / 3)) ? best[0] : undefined
}
const mean = (w: string, ws: readonly string[]) => (m => (m ? ` (did you mean ${m}?)` : ''))(near(w, ws))
const NAMES = new Set(['data', 'config', 'at', 'error', 'full', 'sample', 'workspace', 'this', '@index', 'else'])

export function uiCheck(spec: unknown, data?: unknown, o: { actions?: string[] } = {}): UiProblem[] {
  const out: UiProblem[] = []
  const say = (level: UiProblem['level'], where: string, text: string) => out.push({ level, where, text })
  const has = data !== undefined
  const top = { ...(obj(data) ? data : {}), data, config: {}, at: 0, error: undefined, full: false, sample: false, workspace: {} }
  const kindOk = (k: Kind, v: unknown) =>
    Array.isArray(k)
      ? typeof v === 'string' && (k.includes(v) || v.includes('{{'))
      : k === 'text' || k === 'icon'
        ? ['string', 'number', 'boolean'].includes(typeof v)
        : k === 'number'
          ? typeof v === 'number' || (typeof v === 'string' && (v.includes('{{') || Number.isFinite(Number(v))))
          : k === 'bool'
            ? typeof v === 'boolean'
            : k === 'path'
              ? typeof v === 'string' || Array.isArray(v)
              : k === 'children' || k === 'buttons' || k === 'items'
                ? Array.isArray(v)
                : k === 'button' || k === 'object'
                  ? obj(v)
                  : k === 'tone'
                    ? typeof v === 'string' || obj(v)
                    : true
  const kindName = (k: Kind) => (Array.isArray(k) ? `one of ${k.join(', ')}` : { text: 'text', icon: 'an icon name or emoji', number: 'a number', bool: 'true or false', path: 'a path (data.items) or a list', children: 'a list of elements', buttons: 'a list of buttons', items: 'a list', button: 'a button ({ "label", "run" })', object: 'an object', tone: 'a tone or a map of them' }[k as string])
  // the names a template uses: {{name}}, {{#if name}}, {{ago name}}
  const refs = (v: unknown, acc: string[] = []): string[] => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{\s*(?:[#/]?\w+\s+)?([A-Za-z_@][\w@]*)[\w.]*\s*\}\}/g)) acc.push(m[1])
    else if (Array.isArray(v)) v.forEach(x => refs(x, acc))
    else if (obj(v) && v.each === undefined) Object.values(v).forEach(x => refs(x, acc)) // one with each of its own: its items' fields
    return acc
  }
  const iconOk = (v: unknown) => typeof v !== 'string' || v.includes('{{') || isIconName(v.trim()) || emoji(v.trim())
  const colorOk = (v: unknown) => typeof v !== 'string' || v.includes('{{') || !!colorCss(v)
  const NEEDS: Record<string, string> = { new: 'prompt', send: 'prompt', ai: 'prompt', terminal: 'command', browse: 'url' }
  const runs = (b: unknown, where: string) => {
    if (!obj(b)) return
    if (typeof b.run === 'string' && !b.run.includes('{{') && o.actions && !o.actions.includes(b.run)) say('error', where, `runs ${b.run}, which isn't one of widget.json's actions${mean(b.run, o.actions)}`)
    if (b.icon !== undefined && !iconOk(b.icon)) say('warn', where, `icon ${b.icon} isn't one of Laki's icons${mean(String(b.icon), Object.keys(ICON_WORDS))} or an emoji`)
    if (typeof b.do === 'string' && !b.do.includes('{{')) {
      if (!(DO as readonly string[]).includes(b.do)) say('error', where, `do: one of ${DO.join(', ')}${mean(b.do, DO)}`)
      else if (b[NEEDS[b.do]] === undefined) say('warn', where, `do ${b.do} without ${NEEDS[b.do]}: the app has nothing to ${b.do === 'browse' ? 'open' : b.do === 'terminal' ? 'run' : 'send'}`)
      if (b.run !== undefined) say('warn', where, 'both run and do: run wins')
    }
  }
  const walk = (el: unknown, where: string, scopes: Scope[] | null) => {
    if (!obj(el)) return say('error', where, 'an element: { "type": … }')
    const type = String(el.type ?? '')
    const def = (UI as Record<string, Def>)[type]
    if (!def) return say('error', where, el.type === undefined ? 'no type' : `no element ${type}${mean(type, UI_TYPES)}`)
    const here = `${where} (${type})`
    const props: Record<string, Prop> = { ...COMMON, ...def.props }
    for (const [k, v] of Object.entries(el)) {
      if (k === 'type') continue
      const pr = props[k]
      if (!pr) {
        say('warn', here, `no prop ${k}${mean(k, Object.keys(props))}`)
        continue
      }
      if (!kindOk(pr.kind, v)) say('error', here, `${k}: ${kindName(pr.kind)}`)
      else if (pr.kind === 'icon' && !iconOk(v)) say('warn', here, `icon ${v} isn't one of Laki's icons${mean(String(v), Object.keys(ICON_WORDS))} or an emoji`)
    }
    for (const c of [el.color, ...(Array.isArray(el.colors) ? el.colors : []), ...(Array.isArray(el.series) ? el.series.map(x => (obj(x) ? x.color : undefined)) : [])]) if (!colorOk(c)) say('warn', here, `color ${c}: a tone (${TONES.join(', ')}), one of ${COLORS.join(', ')}, or a hex${mean(String(c), [...TONES, ...COLORS])}`)
    if (type === 'button' || type === 'toggle' || type === 'segmented' || type === 'stepper') runs(el, here)
    if (type === 'form') runs(el.submit, `${here}.submit`)
    for (const k of ['action', 'submit']) if (obj(el[k]) && type !== 'form') runs(el[k], `${here}.${k}`)
    for (const k of ['actions', 'items'] as const) if (UI[type as UiType].props[k as never] && (UI[type as UiType].props as Record<string, Prop>)[k].kind === 'buttons') (Array.isArray(el[k]) ? (el[k] as unknown[]) : []).forEach((b, i) => runs(b, `${here}.${k}[${i}]`))
    // against the data: each's list, then the fields the rows use
    let rowScopes = scopes
    const path = el.each ?? (def.rows && typeof el.items === 'string' ? el.items : undefined)
    if (scopes && typeof path === 'string' && !path.includes('{{')) {
      const v = valueAt(path, scopes)
      if (v === undefined) say('warn', here, `each: ${path} isn't in the data`)
      else if (!Array.isArray(v) && !obj(v)) say('error', here, `each: ${path} is ${typeof v}, not a list`)
      else {
        const items = Array.isArray(v) ? v : Object.values(v)
        rowScopes = items.length ? [{ ...(obj(items[0]) ? items[0] : {}), this: items[0], '@index': 0 }, ...scopes] : null
        if (items.length && def.rows) {
          const fields = new Set(items.flatMap(x => (obj(x) ? Object.keys(x) : [])))
          const outer = new Set(scopes.flatMap(sc => Object.keys(sc)))
          const skip = new Set(['each', 'items', 'empty', 'limit', 'filter', 'sort', 'kind', 'height', 'min', 'max', 'label', 'unit', 'if', 'unless', 'tip', 'series', 'colors', 'legend', 'rows', 'count', 'nested', 'open', 'wrap', ...(type === 'board' ? ['columns'] : []), ...(type === 'log' ? ['value'] : []), ...(type === 'meter' ? ['title'] : [])])
          if (type === 'meter' || type === 'tree' || type === 'steps') skip.delete('label') // a row's name there, not a title
          for (const [k, val] of Object.entries(el)) {
            if (skip.has(k)) continue
            for (const r of refs(k === 'columns' && Array.isArray(val) ? val.map(c => (obj(c) ? { ...c, title: undefined } : c)) : val)) if (!NAMES.has(r) && !fields.has(r) && !outer.has(r)) say('warn', here, `${k} uses ${r}, which no item of ${path} has${mean(r, [...fields])}`)
          }
          if (type === 'chart')
            for (const y of [el.y, ...(Array.isArray(el.series) ? el.series.map(x => (obj(x) ? x.y : undefined)) : [])])
              if (typeof y === 'string') {
                const bad = items.map((x, i) => fill(y, [{ ...(obj(x) ? x : {}), this: x, '@index': i }, ...scopes])).filter(t => t.trim() === '' || !Number.isFinite(Number(t)))
                if (bad.length) say('warn', here, `y ${y}: ${bad.length} of ${items.length} rows aren't numbers (${bad[0] || 'empty'})`)
              }
        }
      }
    }
    if (Array.isArray(el.children)) el.children.forEach((c, i) => walk(c, `${here}.children[${i}]`, def.rows ? scopes : rowScopes))
    if (type === 'tabs' && Array.isArray(el.tabs)) el.tabs.forEach((t, i) => (obj(t) && Array.isArray(t.children) ? t.children.forEach((c, j) => walk(c, `${here}.tabs[${i}].children[${j}]`, scopes)) : say('error', `${here}.tabs[${i}]`, 'a tab: { "label", "children": [elements] }')))
  }
  if (isElement(spec)) walk(spec, 'ui', has ? [top] : null)
  else if (obj(spec)) {
    for (const k of Object.keys(spec)) if (k !== 'preview' && k !== 'full') say('error', 'ui', `no key ${k}: ui is an element ({ "type": … }) or { "preview", "full" }${mean(k, ['preview', 'full', 'type'])}`)
    for (const k of ['preview', 'full'] as const) if (spec[k] !== undefined) walk(spec[k], `ui.${k}`, has ? [top] : null)
    if (spec.preview === undefined && spec.full === undefined) say('error', 'ui', 'no preview nor full')
  } else say('error', 'ui', 'an element ({ "type": … }) or { "preview", "full" }')
  return out
}
// ---------- one sample per element, with data: the gallery, the tests, the AI guide's catalog and the starters
const PRS = [
  { number: 412, title: 'Move billing to the new API', url: 'https://github.com/acme/web/pull/412', author: 'octocat', ci: 'failing', state: 'Failing CI', updated: '2026-10-16T09:00:00Z', labels: ['bug'] },
  { number: 418, title: 'Faster search on the orders page', url: 'https://github.com/acme/web/pull/418', author: 'hubot', ci: 'passing', state: 'Approved', updated: '2026-10-15T14:00:00Z', labels: ['feature'] },
  { number: 421, title: 'Dark mode for the dashboard', url: 'https://github.com/acme/web/pull/421', author: 'monalisa', ci: 'pending', state: 'In review', updated: '2026-10-17T08:30:00Z', labels: [] },
]
// twelve weeks of activity, the heatmap's sample
const DAYS = Array.from({ length: 84 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 27 + i)).toISOString().slice(0, 10), n: i % 7 > 4 ? (i * 3) % 2 : ((i * 37) % 11) % 6 }))
// a moment a few days after it loads: a countdown's sample ahead of the clock (the daemon's catalog only quotes it)
const SOON = new Date(Date.now() + 2.2 * 86_400_000).toISOString()
// the calendar's sample: a few days of this month, as it loads (its dates relative to today, as a month shows now)
const SOON_DAYS = ((d: Date): [string, string, string][] => {
  const at = (n: number) => (x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`)(new Date(d.getFullYear(), d.getMonth(), Math.min(28, Math.max(1, d.getDate() + n))))
  return [[at(-6), 'Sprint review', 'blue'], [at(-1), 'v2.3.2 shipped', 'green'], [at(2), 'Code freeze', 'orange'], [at(2), 'On call: Hubot', 'purple'], [at(5), 'Release v2.4', 'red']]
})(new Date())
const LOG = [
  { at: '2026-10-17T09:10:01Z', level: 'info', text: 'GET /api/orders 200 41ms' },
  { at: '2026-10-17T09:10:02Z', level: 'info', text: 'GET /api/search?q=shoes 200 88ms' },
  { at: '2026-10-17T09:10:04Z', level: 'warn', text: 'slow query: orders by customer 1.2s' },
  { at: '2026-10-17T09:10:07Z', level: 'error', text: 'POST /api/checkout 500 TypeError: card is undefined' },
  { at: '2026-10-17T09:10:09Z', level: 'info', text: 'GET /api/orders 200 39ms' },
]
const SAMPLES: Record<UiType, { spec: UiElement; data?: unknown }> = {
  stack: { spec: { type: 'stack', gap: 'sm', children: [{ type: 'text', value: '{{repo}}', weight: 'semibold' }, { type: 'text', value: '{{open}} open · {{drafts}} drafts', muted: true }] }, data: { repo: 'acme/web', open: 6, drafts: 1 } },
  row: { spec: { type: 'row', align: 'between', children: [{ type: 'text', value: 'Deploys today' }, { type: 'badge', value: '{{n}}', tone: 'good' }] }, data: { n: 4 } },
  grid: { spec: { type: 'grid', columns: 3, children: [{ type: 'stat', value: '{{open}}', label: 'open' }, { type: 'stat', value: '{{failing}}', label: 'failing', tone: 'bad' }, { type: 'stat', value: '{{merged}}', label: 'merged', tone: 'good' }] }, data: { open: 6, failing: 1, merged: 12 } },
  section: { spec: { type: 'section', title: 'Releases', subtitle: '{{releases.length}}', collapsed: false, children: [{ type: 'tags', each: 'releases', tag: '{{this}}' }] }, data: { releases: ['v2.4.0', 'v2.3.2', 'v2.3.1'] } },
  tabs: { spec: { type: 'tabs', tabs: [{ label: 'Mine', badge: '{{mine.length}}', children: [{ type: 'list', each: 'mine', title: '{{title}}' }] }, { label: 'Team', badge: '{{team.length}}', children: [{ type: 'list', each: 'team', title: '{{title}}' }] }] }, data: { mine: [{ title: 'Fix the date picker' }], team: [{ title: 'Retry webhooks' }, { title: 'Spike: exports' }] } },
  header: { spec: { type: 'header', icon: 'github', title: '{{repo}}', subtitle: '{{open}} open pull requests', href: 'https://github.com/{{repo}}', actions: [{ icon: 'refresh', label: 'Refresh', refresh: true, style: 'quiet' }] }, data: { repo: 'acme/web', open: 6 } },
  footer: { spec: { type: 'stack', children: [{ type: 'text', value: '{{open}} open, {{failing}} failing' }, { type: 'footer', text: 'Updated {{ago updated}}', actions: [{ label: 'GitHub', icon: 'github', open: 'https://github.com/{{repo}}', style: 'quiet' }] }] }, data: { repo: 'acme/web', open: 6, failing: 1, updated: '2026-10-17T09:00:00Z' } },
  toolbar: { spec: { type: 'toolbar', align: 'end', items: [{ icon: 'refresh', label: 'Refresh', refresh: true }, { icon: 'github', label: 'Open on GitHub', open: 'https://github.com/{{repo}}' }, { icon: 'copy', label: 'Copy the repo', copy: '{{repo}}' }, { icon: 'ai', label: 'Ask Laki AI about it', do: 'ai', prompt: 'What needs my review in {{repo}}?' }] }, data: { repo: 'acme/web' } },
  spacer: { spec: { type: 'row', children: [{ type: 'text', value: 'Deploys today: {{n}}' }, { type: 'spacer' }, { type: 'button', label: 'Deploy', icon: 'ship', run: 'deploy', style: 'primary' }] }, data: { n: 4 } },
  divider: { spec: { type: 'stack', children: [{ type: 'text', value: 'Above' }, { type: 'divider' }, { type: 'text', value: 'Below', muted: true }] } },
  text: { spec: { type: 'text', value: 'Last deploy {{ago at}} by {{who}}', size: 'md', tone: { failed: 'bad' } }, data: { at: '2026-10-17T09:00:00Z', who: 'octocat' } },
  heading: { spec: { type: 'heading', value: '{{name}}', level: 2 }, data: { name: 'Production' } },
  markdown: { spec: { type: 'markdown', value: '{{notes}}' }, data: { notes: '**Shipped** the new search.\n\n- 30% faster\n- [Release notes](https://github.com/acme/web/releases)' } },
  code: { spec: { type: 'code', value: '{{cmd}}', copy: true }, data: { cmd: 'gh pr checkout 412' } },
  callout: { spec: { type: 'callout', tone: 'warn', title: 'Staging is slow', text: '{{why}}', action: { label: 'Status', open: 'https://status.example.com' } }, data: { why: 'p95 over 2 s since 09:10' } },
  icon: { spec: { type: 'row', children: [{ type: 'icon', name: 'check', color: 'good', size: 'lg' }, { type: 'icon', name: 'ciFail', color: 'bad', size: 'lg' }, { type: 'icon', name: 'clock', color: 'orange', size: 'lg' }, { type: 'icon', name: 'github', color: 'purple', size: 'lg' }, { type: 'icon', name: '🚀', size: 'lg' }] } },
  quote: { spec: { type: 'quote', text: '{{text}}', by: '{{by}}' }, data: { text: 'Make it work, make it right, make it fast.', by: 'Kent Beck' } },
  diff: { spec: { type: 'diff', value: '{{patch}}' }, data: { patch: 'diff --git a/src/search.ts b/src/search.ts\n@@ -12,6 +12,7 @@ export function search(q: string) {\n   const terms = q.split(/\\s+/)\n-  return db.scan(terms)\n+  const hits = index.find(terms)\n+  return hits.length ? hits : db.scan(terms)\n }' } },
  countdown: { spec: { type: 'countdown', to: '{{freeze}}', label: 'until the code freeze', soon: 72 }, data: { freeze: SOON } },
  stat: { spec: { type: 'stat', value: '{{num visits}}', label: 'visits today', delta: '{{change}}', spark: 'week' }, data: { visits: 12840, change: '+12%', week: [8, 9, 7, 11, 10, 12, 13] } },
  stats: { spec: { type: 'stats', each: 'stats', value: '{{n}}', label: '{{name}}', color: '{{color}}', tone: '{{#if bad}}bad{{/if}}' }, data: { stats: [{ name: 'open', n: 6 }, { name: 'drafts', n: 1 }, { name: 'conflicts', n: 1, bad: true }, { name: 'bug', n: 2, color: 'd73a4a' }] } },
  kv: { spec: { type: 'kv', items: [{ key: 'Branch', value: '{{branch}}', mono: true, copy: true }, { key: 'Status', value: '{{status}}', tone: { live: 'good', down: 'bad' } }, { key: 'Updated', value: '{{ago at}}' }] }, data: { branch: 'feat/search', status: 'live', at: '2026-10-17T08:00:00Z' } },
  list: {
    spec: { type: 'list', each: 'prs', title: '#{{number}} {{title}}', subtitle: '{{author}} · {{ago updated}}', avatar: '{{author}}', href: '{{url}}', group: 'state', filter: true, accessories: [{ tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }], actions: [{ label: 'Review', run: 'review', arg: '{{url}}' }], empty: 'No open PRs' },
    data: { prs: PRS },
  },
  table: {
    spec: { type: 'table', each: 'prs', sort: 'number desc', filter: true, columns: [{ title: 'PR', value: '#{{number}} {{title}}', href: '{{url}}' }, { title: 'Author', value: '{{author}}', hide: 'narrow' }, { title: 'CI', tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }, { title: 'Updated', value: '{{ago updated}}', align: 'right', hide: 'narrow' }] },
    data: { prs: PRS },
  },
  chart: { spec: { type: 'chart', kind: 'area', each: 'days', x: '{{day}}', y: '{{ms}}', unit: ' ms', label: 'p95 latency' }, data: { days: [{ day: 'Mon', ms: 320 }, { day: 'Tue', ms: 280 }, { day: 'Wed', ms: 410 }, { day: 'Thu', ms: 300 }, { day: 'Fri', ms: 260 }] } },
  spark: { spec: { type: 'spark', values: 'cpu', tone: 'accent' }, data: { cpu: [12, 30, 22, 48, 35, 60, 41] } },
  progress: { spec: { type: 'progress', value: '{{done}}', max: '{{total}}', label: 'Sprint 42' }, data: { done: 18, total: 25 } },
  gauge: { spec: { type: 'gauge', value: '{{cpu}}', unit: '%', label: 'CPU', color: 'teal' }, data: { cpu: 72 } },
  heatmap: { spec: { type: 'heatmap', each: 'days', x: '{{date}}', value: '{{n}}', color: 'green' }, data: { days: DAYS } },
  status: { spec: { type: 'status', each: 'services', label: '{{name}}', state: '{{state}}', text: '{{note}}' }, data: { services: [{ name: 'API', state: 'up', note: '99.98%' }, { name: 'Web', state: 'up', note: '99.95%' }, { name: 'Workers', state: 'degraded', note: 'queue 2k' }, { name: 'Search', state: 'down', note: 'since 09:10' }] } },
  checklist: { spec: { type: 'checklist', each: 'steps', text: '{{text}}', done: 'done' }, data: { steps: [{ text: 'Write the migration', done: true }, { text: 'Backfill orders', done: true }, { text: 'Switch reads over', done: false }, { text: 'Drop the old table', done: false }] } },
  avatars: { spec: { type: 'avatars', each: 'reviewers', login: '{{this}}', max: 4 }, data: { reviewers: ['octocat', 'hubot', 'monalisa', 'defunkt', 'mojombo', 'pjhyett'] } },
  tags: { spec: { type: 'tags', each: 'labels', tag: '{{name}}', color: '{{color}}' }, data: { labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'feature', color: '0e8a16' }, { name: 'docs', color: '0075ca' }] } },
  badge: { spec: { type: 'badge', value: '{{failing}} failing', tone: 'bad', if: 'failing' }, data: { failing: 2 } },
  timeline: { spec: { type: 'timeline', each: 'events', time: '{{at}}', title: '{{what}}', text: '{{who}}', tone: { 'Deploy failed': 'bad', Deployed: 'good' } }, data: { events: [{ at: '2026-10-17T09:10:00Z', what: 'Deployed', who: 'v2.4.0 by octocat' }, { at: '2026-10-17T08:40:00Z', what: 'Deploy failed', who: 'v2.4.0-rc1' }, { at: '2026-10-16T17:00:00Z', what: 'Merged #418', who: 'hubot' }] } },
  card: { spec: { type: 'card', each: 'posts', title: '{{title}}', text: '{{blurb}}', icon: '{{icon}}', tag: '{{tag}}', href: '{{url}}', tone: { new: 'accent' } }, data: { posts: [{ title: 'Search, 30% faster', blurb: 'How we cut p95 by moving to the new index.', icon: '⚡', tag: 'new', url: 'https://example.com/blog/search' }, { title: 'Dark mode', blurb: 'The dashboard follows your system now.', icon: '🌙', tag: 'ui', url: 'https://example.com/blog/dark' }] } },
  image: { spec: { type: 'image', src: 'https://avatars.githubusercontent.com/{{login}}?s=80', alt: '{{login}}', height: 40 }, data: { login: 'octocat' } },
  steps: { spec: { type: 'steps', each: 'stages', label: '{{name}}', state: '{{state}}', text: '{{took}}' }, data: { stages: [{ name: 'Build', state: 'done', took: '1m 12s' }, { name: 'Test', state: 'done', took: '3m 40s' }, { name: 'Deploy', state: 'running', took: 'now' }, { name: 'Smoke', state: 'todo', took: '' }] } },
  meter: { spec: { type: 'meter', each: 'disk', label: '{{name}}', value: '{{gb}}', color: '{{color}}', max: 512, unit: ' GB', title: 'Disk' }, data: { disk: [{ name: 'Apps', gb: 120, color: 'blue' }, { name: 'Docker', gb: 96, color: 'purple' }, { name: 'Photos', gb: 74, color: 'orange' }, { name: 'System', gb: 38, color: 'gray' }] } },
  board: {
    spec: { type: 'board', each: 'issues', column: '{{state}}', columns: ['Todo', 'Doing', 'Done'], title: '{{title}}', subtitle: '#{{number}}', avatar: '{{who}}', tag: '{{label}}', tone: { bug: 'bad' } },
    data: { issues: [{ number: 512, title: 'Login loops on Safari', state: 'Doing', who: 'octocat', label: 'bug' }, { number: 498, title: 'Export orders as CSV', state: 'Todo', who: 'hubot', label: 'feature' }, { number: 505, title: 'Dark mode for emails', state: 'Todo', who: 'monalisa', label: 'ui' }, { number: 471, title: 'Faster search', state: 'Done', who: 'hubot', label: 'perf' }] },
  },
  tree: { spec: { type: 'tree', each: 'files', label: '{{name}}', text: '{{size}}', icon: '{{#if children}}folder{{else}}file{{/if}}' }, data: { files: [{ name: 'src', size: '', children: [{ name: 'main.ts', size: '4 KB' }, { name: 'ui', size: '', children: [{ name: 'App.tsx', size: '12 KB' }, { name: 'theme.css', size: '3 KB' }] }] }, { name: 'package.json', size: '1 KB' }, { name: 'README.md', size: '2 KB' }] } },
  log: { spec: { type: 'log', each: 'lines', text: '{{text}}', time: '{{at}}', level: '{{level}}' }, data: { lines: LOG } },
  json: { spec: { type: 'json', value: 'data', open: 2 }, data: { repo: 'acme/web', open: 6, ci: { passing: true, took: 412 }, labels: ['bug', 'docs'], owner: null } },
  toggle: {
    spec: { type: 'stack', children: [{ type: 'toggle', label: 'Maintenance mode', text: 'Shows the banner on {{site}}', on: 'maintenance', run: 'maintenance', confirm: 'Turn maintenance mode {{#if maintenance}}off{{else}}on{{/if}}?' }, { type: 'toggle', label: 'Deploys', text: 'Merges to main ship at once', on: 'deploys', run: 'deploys' }] },
    data: { site: 'acme.com', maintenance: false, deploys: true },
  },
  button: { spec: { type: 'button', label: 'Deploy', icon: 'ship', style: 'primary', run: 'deploy', arg: '{{branch}}', confirm: 'Deploy {{branch}} to production?' }, data: { branch: 'main' } },
  actions: { spec: { type: 'actions', items: [{ label: 'Refresh', icon: 'refresh', refresh: true }, { label: 'GitHub', icon: 'github', open: 'https://github.com/{{repo}}' }, { label: 'Copy repo', copy: '{{repo}}', style: 'quiet' }] }, data: { repo: 'acme/web' } },
  links: { spec: { type: 'links', items: [{ label: 'Linear', href: 'https://linear.app' }, { label: 'Status', href: 'https://status.example.com' }, { label: 'Board', href: 'laki://board' }] } },
  form: { spec: { type: 'form', fields: [{ id: 'title', type: 'text', label: 'Title', hint: 'What broke?' }, { id: 'urgent', type: 'bool', label: 'Urgent' }, { id: 'team', type: 'choice', label: 'Team', choices: ['web', 'api'], default: 'web' }], submit: { label: 'File issue', run: 'file', confirm: 'File it on GitHub?' } } },
  empty: { spec: { type: 'empty', text: 'No deploys yet today', icon: 'ship', action: { label: 'Refresh', refresh: true } } },
  kbd: { spec: { type: 'stack', gap: 'sm', children: [{ type: 'kbd', keys: '⌘ K', label: 'Command palette' }, { type: 'kbd', keys: '⌘ ⇧ N', label: 'New workspace' }, { type: 'kbd', keys: 'Ctrl+Shift+P', label: 'Every command' }] } },
  secret: { spec: { type: 'secret', label: 'Staging API key', value: '{{key}}' }, data: { key: 'sk_test_51Hx9kQ2eZvKYlo2C0aBcDeFgH7a3f' } },
  rating: { spec: { type: 'rating', value: '{{stars}}', label: '{{reviews}} reviews' }, data: { stars: 4.5, reviews: 128 } },
  calendar: { spec: { type: 'calendar', each: 'events', date: '{{date}}', title: '{{title}}', color: '{{color}}' }, data: { events: SOON_DAYS.map(([d, title, color]) => ({ date: d, title, color })) } },
  people: { spec: { type: 'people', each: 'team', name: '{{name}}', login: '{{login}}', text: '{{role}}', state: '{{state}}' }, data: { team: [{ name: 'Mona Lisa', login: 'monalisa', role: 'On call', state: 'online' }, { name: 'Hubot', login: 'hubot', role: 'Backend', state: 'busy' }, { name: 'The Octocat', login: 'octocat', role: 'Design', state: 'away' }, { name: 'Ada Byron', login: '', role: 'Data', state: 'offline' }] } },
  inbox: { spec: { type: 'inbox', each: 'messages', from: '{{from}}', subject: '{{subject}}', text: '{{preview}}', time: '{{at}}', unread: 'unread' }, data: { messages: [{ from: 'Mona Lisa', subject: 'Release v2.4 notes', preview: 'Can you look over the draft before 3?', at: '2026-10-17T09:05:00Z', unread: true }, { from: 'GitHub', subject: '[acme/web] #412 failing', preview: 'CI failed on Move billing to the new API', at: '2026-10-17T08:30:00Z', unread: true }, { from: 'Hubot', subject: 'Deploy done', preview: 'v2.3.2 is live on production', at: '2026-10-16T17:02:00Z', unread: false }] } },
  chat: { spec: { type: 'chat', each: 'thread', from: '{{who}}', text: '{{text}}', time: '{{at}}', mine: 'me' }, data: { thread: [{ who: 'Mona Lisa', text: 'Is the search fix going out today?', at: '2026-10-17T09:01:00Z' }, { who: 'You', text: 'Yes, after the tests: about an hour.', at: '2026-10-17T09:03:00Z', me: true }, { who: 'Mona Lisa', text: 'Great, I’ll tell support.', at: '2026-10-17T09:04:00Z' }] } },
  prs: { spec: { type: 'prs', each: 'prs', state: '{{state}}', checks: '{{ci}}', review: '{{review}}', time: '{{updated}}' }, data: { prs: PRS.map((x, i) => ({ ...x, state: ['open', 'open', 'draft'][i], review: ['', 'approved', ''][i] })).concat({ number: 405, title: 'Remove the old checkout', url: 'https://github.com/acme/web/pull/405', author: 'defunkt', ci: 'passing', state: 'merged', updated: '2026-10-14T10:00:00Z', labels: [], review: 'approved' }) } },
  commits: { spec: { type: 'commits', each: 'commits', author: '{{author}}', time: '{{at}}', href: 'https://github.com/acme/web/commit/{{sha}}' }, data: { commits: [{ sha: 'a3f9c2e81b4d7f60e2c9a1b3d5e7f9a0c2e4b6d8', message: 'Faster search on the orders page', author: 'hubot', at: '2026-10-17T08:50:00Z' }, { sha: '7b1e44d0c9a2f3e5b7d9c1a3e5f7b9d1c3e5a7f9', message: 'Fix the date picker on Safari', author: 'octocat', at: '2026-10-16T16:20:00Z' }, { sha: 'e02d9f13a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5', message: 'Bump the API client to 3.2', author: 'monalisa', at: '2026-10-16T11:05:00Z' }] } },
  segmented: { spec: { type: 'segmented', label: 'Deploy to', options: ['dev', 'staging', 'prod'], value: '{{env}}', run: 'env', confirm: 'Point the deploys at another environment?' }, data: { env: 'staging' } },
  stepper: { spec: { type: 'stepper', label: 'Web replicas', value: '{{replicas}}', min: 1, max: 10, run: 'scale' }, data: { replicas: 3 } },
}
export const UI_SAMPLES = UI_TYPES.map(type => ({ type, group: UI[type].group, blurb: UI[type].blurb, spec: SAMPLES[type].spec, data: SAMPLES[type].data }))

// ---------- more, past one per element: every chart kind, colors, Laki's commands, a note, layouts of a few elements
const LANGS = [{ name: 'TypeScript', pct: 62 }, { name: 'Go', pct: 18 }, { name: 'CSS', pct: 11 }, { name: 'Shell', pct: 6 }, { name: 'Other', pct: 3 }]
const WEEK = [{ day: 'Mon', passed: 41, failed: 3, skipped: 4, p50: 210, p95: 480, red: false }, { day: 'Tue', passed: 38, failed: 7, skipped: 2, p50: 190, p95: 440, red: true }, { day: 'Wed', passed: 45, failed: 1, skipped: 3, p50: 230, p95: 610, red: false }, { day: 'Thu', passed: 40, failed: 5, skipped: 5, p50: 200, p95: 420, red: true }, { day: 'Fri', passed: 47, failed: 0, skipped: 2, p50: 180, p95: 390, red: false }]
export const UI_EXAMPLES: { title: string; blurb: string; spec: UiElement; data?: unknown; full?: boolean }[] = [ // full: the UI kit page shows it in full first
  { title: 'Colors', full: true, blurb: 'Every color a color prop, colors or a series takes: the tones, Laki’s palette (each theme’s own), or a hex.', spec: { type: 'stack', children: [{ type: 'text', value: 'Tones', size: 'sm', muted: true }, { type: 'tags', each: 'tones', tag: '{{this}}', color: '{{this}}' }, { type: 'text', value: 'Palette', size: 'sm', muted: true }, { type: 'tags', each: 'palette', tag: '{{this}}', color: '{{this}}' }, { type: 'text', value: 'Hex', size: 'sm', muted: true }, { type: 'tags', each: 'hexes', tag: '{{this}}', color: '{{this}}' }] }, data: { tones: [...TONES], palette: [...COLORS], hexes: ['d73a4a', '0e8a16', '#0075ca'] } },
  { title: 'Lines: two series', blurb: 'A series per number of a row, each its own color, a legend.', spec: { type: 'chart', kind: 'line', each: 'week', x: '{{day}}', series: [{ label: 'p50', y: '{{p50}}', color: 'teal' }, { label: 'p95', y: '{{p95}}', color: 'orange' }], unit: ' ms', label: 'Latency' }, data: { week: WEEK } },
  { title: 'Bars, colored by row', blurb: 'One series, each bar its color: a template over the row.', spec: { type: 'chart', kind: 'bars', each: 'week', x: '{{day}}', y: '{{failed}}', color: '{{#if red}}red{{else}}green{{/if}}', label: 'Failed tests' }, data: { week: WEEK } },
  { title: 'Stacked bars', blurb: 'Series one on another: a total per row.', spec: { type: 'chart', kind: 'stacked', each: 'week', x: '{{day}}', series: [{ label: 'passed', y: '{{passed}}', color: 'green' }, { label: 'failed', y: '{{failed}}', color: 'red' }, { label: 'skipped', y: '{{skipped}}', color: 'gray' }], label: 'Test runs' }, data: { week: WEEK } },
  { title: 'Horizontal bars', blurb: 'A bar per row with its label and number: rankings, shares.', spec: { type: 'chart', kind: 'hbars', each: 'langs', x: '{{name}}', y: '{{pct}}', unit: '%', label: 'Languages' }, data: { langs: LANGS } },
  { title: 'Pie', blurb: 'Shares of a whole, a legend beside it.', spec: { type: 'chart', kind: 'pie', each: 'langs', x: '{{name}}', y: '{{pct}}', unit: '%', colors: ['blue', 'teal', 'purple', 'yellow', 'gray'] }, data: { langs: LANGS } },
  { title: 'Donut', blurb: 'A pie with its total in the middle.', spec: { type: 'chart', kind: 'donut', each: 'tickets', x: '{{state}}', y: '{{n}}', label: 'tickets', tone: { open: 'warn', closed: 'good', blocked: 'bad' } }, data: { tickets: [{ state: 'open', n: 14 }, { state: 'closed', n: 31 }, { state: 'blocked', n: 3 }] } },
  { title: 'Scatter', blurb: 'Dots by two numbers: x across, y up.', spec: { type: 'chart', kind: 'scatter', each: 'builds', x: '{{files}}', y: '{{secs}}', unit: ' s', label: 'Build time by files changed', colors: ['purple'] }, data: { builds: [{ files: 3, secs: 41 }, { files: 12, secs: 58 }, { files: 7, secs: 47 }, { files: 30, secs: 96 }, { files: 18, secs: 70 }, { files: 2, secs: 39 }, { files: 24, secs: 81 }] } },
  { title: 'Header, body, footer', blurb: 'A card of a few elements: a title bar with buttons, numbers, a footer.', spec: { type: 'stack', children: [{ type: 'header', icon: 'pr', color: 'purple', title: 'Pull requests', subtitle: '{{repo}}', actions: [{ icon: 'refresh', label: 'Refresh', refresh: true, style: 'quiet' }, { icon: 'github', label: 'GitHub', open: 'https://github.com/{{repo}}/pulls', style: 'quiet' }] }, { type: 'stats', items: [{ value: '{{open}}', label: 'open' }, { value: '{{failing}}', label: 'failing', tone: 'bad' }, { value: '{{approved}}', label: 'approved', tone: 'good' }] }, { type: 'footer', text: 'Updated {{ago updated}}', actions: [{ label: 'Review the next', do: 'new', prompt: 'Review the oldest open PR of {{repo}}', style: 'quiet' }] }] }, data: { repo: 'acme/web', open: 6, failing: 1, approved: 2, updated: '2026-10-17T09:00:00Z' } },
  { title: 'Laki commands', blurb: 'Buttons that ask Laki: a new workspace, a prompt to the agent or Laki AI, a terminal, a browser tab. The app shows what and asks first.', spec: { type: 'grid', columns: 2, children: [{ type: 'button', label: 'Fix the flaky test', icon: 'agent', do: 'new', prompt: 'Find and fix the flaky test in {{suite}}' }, { type: 'button', label: 'Ask the agent', icon: 'run', do: 'send', prompt: 'Run the tests and tell me what fails' }, { type: 'button', label: 'Ask Laki AI', icon: 'ai', do: 'ai', prompt: 'Which of my workspaces need me?' }, { type: 'button', label: 'Tail the logs', icon: 'terminal', do: 'terminal', command: 'tail -f log/development.log' }, { type: 'button', label: 'Open staging', icon: 'globe', do: 'browse', url: 'https://staging.example.com' }, { type: 'button', label: 'Copy the URL', icon: 'copy', copy: 'https://staging.example.com', style: 'quiet' }] }, data: { suite: 'checkout' } },
  { title: 'A Markdown note', full: true, blurb: 'Formatted text: headings, lists, tasks, a table, code, links and https pictures.', spec: { type: 'markdown', value: '{{text}}' }, data: { text: '## On call this week\n\n![octocat](https://avatars.githubusercontent.com/octocat?s=48) **@octocat**, then **@hubot**.\n\n- [x] Rotate the API keys\n- [ ] Renew the TLS cert (`staging`)\n\n| Service | Owner |\n|---|---|\n| API | octocat |\n| Web | hubot |\n\nRunbook: [wiki/oncall](https://example.com/wiki/oncall)' } },
  { title: 'A status page', blurb: 'A header, each service’s state colored by its word, a callout for the worst.', spec: { type: 'stack', children: [{ type: 'header', icon: 'server', title: 'Production', subtitle: '{{services.length}} services' }, { type: 'callout', if: 'incident', tone: 'bad', title: '{{incident}}', action: { label: 'Fix it', icon: 'agent', do: 'new', prompt: 'Look into: {{incident}}' } }, { type: 'status', each: 'services', label: '{{name}}', state: '{{state}}' }] }, data: { incident: 'Search is down since 09:10', services: [{ name: 'API', state: 'up' }, { name: 'Workers', state: 'degraded' }, { name: 'Search', state: 'down' }] } },
  { title: 'A deploy', blurb: 'A header, the pipeline’s steps, its log’s last lines and a switch for the next ones.', spec: { type: 'stack', children: [{ type: 'header', icon: 'ship', title: 'Deploy {{version}}', subtitle: 'to production · started {{ago at}}' }, { type: 'steps', each: 'stages', label: '{{name}}', state: '{{state}}' }, { type: 'log', each: 'lines', text: '{{text}}', time: '{{at}}', level: '{{level}}', limit: 3 }, { type: 'toggle', label: 'Ship merges at once', on: 'auto', run: 'auto' }] }, data: { version: 'v2.4.0', at: '2026-10-17T09:08:00Z', auto: true, stages: [{ name: 'Build', state: 'done' }, { name: 'Test', state: 'done' }, { name: 'Deploy', state: 'running' }, { name: 'Smoke', state: 'todo' }], lines: LOG } },
  { title: 'Gauges in a grid', blurb: 'A few dials side by side, each its color.', spec: { type: 'grid', columns: 3, children: [{ type: 'gauge', value: '{{cpu}}', unit: '%', label: 'CPU', color: 'teal' }, { type: 'gauge', value: '{{mem}}', unit: '%', label: 'Memory', color: 'purple' }, { type: 'gauge', value: '{{disk}}', unit: '%', label: 'Disk', color: '{{#if full}}bad{{else}}blue{{/if}}' }] }, data: { cpu: 42, mem: 68, disk: 91, full: true } },
]
