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
  accordion: {
    group: 'Layout',
    blurb: 'Panels that fold, one open at a time: questions and answers, a release’s notes, details under a title.',
    rows: true,
    props: {
      items: p('items', 'The panels: [{ "title", "subtitle", "icon", "badge", "text", "children" }]'),
      title: p('text', 'With each: a panel’s title'),
      subtitle: p('text', 'With each: muted words beside it'),
      icon: p('icon', 'With each: an icon or emoji before it'),
      badge: p('text', 'With each: a count or word at its end'),
      text: p('text', 'With each: the words inside it'),
      children: p('children', 'With each: the elements inside it, over its row'),
      open: p('number', 'The panel open at first, from 0 (0; -1: none)'),
      multiple: p('bool', 'Several open at once (default: opening one folds the others)'),
      limit: p('number', 'Panels at most (a preview: as many as fit), then +N more'),
      empty: p('text', 'What it says with no panels'),
    },
  },
  header: { group: 'Layout', blurb: 'A title bar: an icon, a title and subtitle, buttons at its end.', props: { title: p('text', 'Its title'), subtitle: p('text', 'A line under it'), icon: p('icon', 'An icon or emoji before it'), color: COLOR, href: p('text', 'A link its title opens'), actions: BUTTONS } },
  footer: { group: 'Layout', blurb: 'A bar along the bottom: muted words, buttons and links at its end.', props: { text: p('text', 'Its words (“updated {{ago at}}”)'), actions: BUTTONS } },
  toolbar: { group: 'Layout', blurb: 'Icon buttons in a row, their words as tooltips.', props: { items: BUTTONS, labels: p('bool', 'Their words beside the icons too'), align: p(['start', 'end', 'between'] as const, 'start (the default), end, or between') } },
  spacer: { group: 'Layout', blurb: 'Room that pushes what follows it in a row to the end.', props: {} },
  divider: { group: 'Layout', blurb: 'A line across.', props: {} },
  hero: { group: 'Layout', blurb: 'A banner: a big title, words, a picture or an icon, buttons, on a soft glow. A welcome, a release, what’s on now.', props: { title: p('text', 'Its title, large'), text: p('text', 'Words under it'), icon: p('icon', 'An icon or emoji beside it (no image)'), image: p('text', 'A picture beside it: data: or https'), align: p(['start', 'center'] as const, 'start (the default) or center'), color: COLOR, actions: BUTTONS, children: p('children', 'Elements under its words') } },
  mockup: { group: 'Layout', blurb: 'A frame around what it shows: a browser with its address, a window, a terminal, a phone. Screenshots, a command.', props: { kind: p(['browser', 'window', 'terminal', 'phone'] as const, 'browser (the default), window, terminal or phone'), url: p('text', 'browser: the address in its bar (a link it opens)'), title: p('text', 'window: its title'), value: p('text', 'terminal: its lines, one each; a line starting $ or > is a command'), image: p('text', 'A picture inside it: data: or https (a screenshot)'), children: p('children', 'Elements inside it') } },
  filter: { group: 'Layout', blurb: 'Chips over elements: a click shows only the rows whose words have it. All · Failing · Passing over a list or a table.', props: { options: p('items', 'The chips: words, or [{ "value", "label" }]: a chip keeps the rows whose words have its value'), all: p('text', 'The first chip, every row (All); "" for none: a chip clicked again lets go'), children: p('children', 'The elements whose rows it filters: a list, a table, status…') } },
  marquee: { group: 'Layout', blurb: 'Words, tags or elements that scroll by in a loop: sponsors, what shipped, live numbers. Hovering stops it.', rows: true, props: { items: p('items', 'What scrolls: words, or [{ "label", "icon", "href", "tone" }]'), label: p('text', 'With each: an item’s words ({{label}} by default)'), icon: p('icon', 'With each: an icon or emoji before it'), href: p('text', 'With each: a link it opens'), children: p('children', 'Or elements that scroll (instead of items)'), seconds: p('number', 'Seconds for one lap (20)'), reverse: p('bool', 'Scroll the other way') } },
  bento: { group: 'Layout', blurb: 'Tiles of different sizes on a grid: a dashboard, a feature overview. Each spans columns and rows.', props: { items: p('items', 'The tiles: [{ "title", "text", "icon", "color", "href", "cols" (1-4), "rows" (1-3), "children" }]'), columns: p('number', 'Columns, 2-6 (4): fewer in a narrow cell, the big tiles too') } },
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
  rotate: { group: 'Text', blurb: 'Words that take turns in one place: Building, Testing, Shipping. A hero’s line, what runs now.', rows: true, props: { items: p('items', 'The words: ["Build", "Test", "Ship"]'), text: p('text', 'With each: a word ({{text}} by default)'), prefix: p('text', 'Words before them'), suffix: p('text', 'Words after them'), seconds: p('number', 'Seconds each shows (2)'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), color: COLOR } },
  snippet: { group: 'Text', blurb: 'A command or code with Copy, in tabs: npm, pnpm, yarn and bun; curl and httpie; a file each.', rows: true, props: { items: p('items', 'The tabs: [{ "label", "value" }] (none: one block of value)'), label: p('text', 'With each: a tab’s name'), value: p('text', 'The code (with each: a tab’s)'), title: p('text', 'A file name or title over one block'), prompt: p('bool', 'A $ before each line: commands to type'), copy: p('bool', 'A copy button: on by default') } },
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
      accessories: p('items', 'At the row’s end: [{ "tag" | "text" | "badge" | "icon" | "avatar" | "ago" | "date" | "progress" (a number: a small bar, + "max", 100), "tone", "color" (a palette name, or a tag’s hex border), "each" (one per item of a row’s list: its labels) }]'),
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
      columns: p('items', 'The columns: [{ "title", "value", "subtitle" (a muted line under it), "image" (a picture before it: data: or https) | "avatar" (a GitHub login’s) | "icon", "tag", "badge", "progress" (a number: a bar, of "max", 100, in "color"; value its words), "spark" (a path to numbers: a line), "copy" (true: a copy button), "actions" (buttons), "tone", "href", "align", "mono", "width", "wrap", "hide": "narrow" }]'),
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
  loading: { group: 'Data', blurb: 'Something under way: a spinner, dots or a moving bar, and its words. Show it with if: while a job runs.', props: { label: p('text', 'What’s under way (“Deploying…”)'), style: p(['spinner', 'dots', 'bar'] as const, 'spinner (the default), dots, or bar: across the cell'), size: p(['sm', 'md', 'lg'] as const, 'sm, md (the default) or lg'), color: COLOR } },
  gauge: { group: 'Data', blurb: 'A dial: a number on a half circle between min and max.', props: { value: p('text', 'The number'), min: p('number', 'The low end (0)'), max: p('number', 'The high end (100)'), label: p('text', 'What it is'), unit: p('text', 'After the number: %, ms'), color: COLOR } },
  heatmap: { group: 'Data', blurb: 'A grid of squares, darker for more: days of activity, GitHub style.', rows: true, props: { x: p('text', 'A square’s label (its tooltip): a date'), value: p('text', 'Its number'), rows: p('number', 'Squares down, 7 by default (a week a column)'), max: p('number', 'The darkest (default: the highest)'), color: COLOR } },
  status: { group: 'Data', blurb: 'Things and their state, a dot each: services, environments, jobs.', rows: true, props: { label: p('text', 'Its name'), state: p('text', 'Its state: up, degraded, down… (its dot and words, colored by tone)'), text: p('text', 'More words beside it'), href: p('text', 'A link a click opens') } },
  checklist: { group: 'Data', blurb: 'Tasks ticked or not, with how many are done.', rows: true, props: { text: p('text', 'A task'), done: p('text', 'A path or template: done when truthy'), count: p('bool', 'Its count above it (3/5): on by default') } },
  avatars: { group: 'Data', blurb: 'GitHub pictures in an overlapping row, then +N.', rows: true, props: { login: p('text', 'A GitHub login'), max: p('number', 'Pictures at most (5), then +N') } },
  tags: { group: 'Data', blurb: 'Pills: labels, states.', rows: true, props: { items: p('items', 'Each one: a word, or { "tag", "tone", "color" }'), tag: p('text', 'With each: a pill’s words'), color: p('text', 'A palette name, or a hex (d73a4a): its border and dot, a GitHub label’s') } },
  badge: { group: 'Data', blurb: 'A count or a short word, filled.', props: { value: p('text', 'The count or word'), color: COLOR } },
  timeline: { group: 'Data', blurb: 'What happened, newest first.', rows: true, props: { time: p('text', 'When (an ISO date or ms: shown as 3 hours ago; else as written)'), title: p('text', 'What happened'), text: p('text', 'More words under it'), icon: p('icon', 'An icon or emoji') } },
  image: { group: 'Data', blurb: 'A picture: a data: image or an https one.', props: { src: p('text', 'A data:image/… or https:// URL'), alt: p('text', 'What it shows'), height: p('number', 'Its height in px') } },
  gallery: { group: 'Data', blurb: 'Pictures in a row that scrolls, a caption under each: screenshots, designs, a carousel.', rows: true, props: { src: p('text', 'A picture: data: or https ({{src}} by default)'), caption: p('text', 'Words under it'), href: p('text', 'A link a click opens'), height: p('number', 'Their height in px (default: as the cell fits; 160 in the full view)'), empty: p('text', 'What it says with no pictures') } },
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
  compare: { group: 'Data', blurb: 'Two pictures, one over the other, a divider to drag between them: before and after, a design and the build.', props: { before: p('text', 'The picture before: data: or https'), after: p('text', 'The picture after'), labels: p('items', 'Words on each side: ["Before", "After"]'), height: p('number', 'Its height in px (default: as the cell fits; 260 in the full view)') } },
  skeleton: { group: 'Data', blurb: 'Gray shapes that shimmer where something will be. Show it with if: while a fetch runs.', props: { lines: p('number', 'Lines of text (3)'), avatar: p('bool', 'A circle before them'), image: p('bool', 'A block over them: a picture’s place'), label: p('text', 'What it waits for, for screen readers (Loading…)') } },
  radial: { group: 'Data', blurb: 'A ring that fills, its number in the middle: a score, a quota, coverage.', props: { value: p('text', 'How much'), max: p('number', 'Of how much (100)'), text: p('text', 'What it says in the middle (default: the percent)'), label: p('text', 'What it is, under it'), size: p(['sm', 'md', 'lg'] as const, 'sm, md (the default) or lg'), color: COLOR } },
  indicator: { group: 'Data', blurb: 'An icon, a picture or a word with a count on its corner: unread mail, reviews waiting.', props: { icon: p('icon', 'An icon or emoji'), avatar: p('text', 'Or a GitHub login: its picture'), label: p('text', 'Or words in a box'), badge: p('text', 'The count or word on its corner (empty or 0: none)'), dot: p('text', 'A path or template: a dot on its corner when truthy (no count)'), color: COLOR, href: p('text', 'A link a click opens') } },
  avatar: { group: 'Data', blurb: 'One picture, any size and shape, a ring, a dot for whether they’re around: who’s on call, a reviewer.', props: { login: p('text', 'A GitHub login: its picture'), image: p('text', 'Or a picture: data: or https'), name: p('text', 'A name: its initials when there’s no picture'), size: p(['sm', 'md', 'lg', 'xl'] as const, 'sm, md (the default), lg or xl'), shape: p(['circle', 'rounded', 'squircle', 'hexagon', 'diamond'] as const, 'circle (the default), rounded, squircle, hexagon or diamond'), ring: p('text', 'A ring around it: a color'), state: p('text', 'online, away, busy, offline…: its dot'), label: p('text', 'Words beside it'), text: p('text', 'A line under them'), href: p('text', 'A link a click opens') } },
  env: { group: 'Data', blurb: 'Environment variables, KEY=value: secrets as dots until a click, a copy button, an environment each.', rows: true, props: { items: p('items', 'The variables: [{ "key", "value", "secret", "tag" }]'), key: p('text', 'With each: its name ({{key}} by default)'), value: p('text', 'With each: its value ({{value}} by default)'), secret: p('text', 'A path or template: dots when truthy (default: names with KEY, TOKEN, SECRET, PASSWORD or PRIVATE)'), tag: p('text', 'With each: a pill: its environment (production, preview)'), copy: p('bool', 'A copy button by each value: on by default') } },
  uptime: { group: 'Data', blurb: 'A bar a day (or an hour), colored by state: up, degraded, down. A status page’s last 90 days.', rows: true, props: { state: p('text', 'A bar’s state ({{state}} by default): up, degraded, down…; none or empty: no data'), x: p('text', 'Its label in the tooltip: a date'), text: p('text', 'More words in its tooltip'), title: p('text', 'Its title, above it'), value: p('text', 'A number by the title: 99.98%'), legend: p('bool', 'The first and last labels under it: on in the full view') } },
  deploys: { group: 'Data', blurb: 'Deployments, Vercel style: a dot for its state, the commit, branch, environment, when and how long.', rows: true, props: { state: p('text', 'ready, building, queued, error, canceled… ({{state}} by default): its dot'), title: p('text', 'What went out: the commit’s message ({{title}} by default)'), branch: p('text', 'Its branch'), env: p('text', 'production, preview…: a pill'), time: p('text', 'When it started (an ISO date or ms: 3 hours ago)'), took: p('text', 'How long it took: 1m 12s'), author: p('text', 'Who: a GitHub login’s picture'), href: p('text', 'A link a click opens ({{url}} by default)') } },
  issues: { group: 'Data', blurb: 'Issues, Linear style: priority bars, the id, a status circle, the title, labels and who has it.', rows: true, props: { id: p('text', 'Its key: ACME-142 ({{id}} by default)'), title: p('text', 'Its title ({{title}} by default)'), state: p('text', 'backlog, todo, in progress, in review, done, canceled ({{state}} by default): its circle'), priority: p('text', 'urgent, high, medium, low or none (or Linear’s 1-4, P0-P4): its bars'), labels: p('path', 'A field with its labels: words, or { "name", "color" }'), assignee: p('text', 'A GitHub login: its picture'), href: p('text', 'A link a click opens ({{url}} by default)') } },
  endpoints: { group: 'Data', blurb: 'API routes: the method in its color, the path, the status, how long and how often. An API’s health, its docs.', rows: true, props: { method: p('text', 'GET, POST, PUT, PATCH, DELETE… ({{method}} by default)'), path: p('text', 'The route: /api/orders/:id ({{path}} by default)'), status: p('text', 'Its status: 200 green, 4xx yellow, 5xx red'), text: p('text', 'Words under it: what it does'), took: p('text', 'How long: 41 ms'), count: p('text', 'How often: 1.2k/min'), href: p('text', 'A link a click opens') } },
  changelog: { group: 'Data', blurb: 'Releases with their changes, each tagged feat, fix, perf or breaking (a conventional commit’s words count).', rows: true, props: { version: p('text', 'Its version ({{version}} by default)'), date: p('text', 'When (an ISO date or ms)'), title: p('text', 'A line by the version: its name'), changes: p('path', 'A field with its changes: "feat: faster search", or { "type", "text" } (changes by default)'), href: p('text', 'A link its version opens') } },
  clock: { group: 'Data', blurb: 'The time in a few places, ticking: a team across time zones, the servers’ regions.', rows: true, props: { items: p('items', 'The places: [{ "label", "zone" }]'), label: p('text', 'With each: its name ({{label}} by default)'), zone: p('text', 'With each: its time zone, as Europe/Kyiv or UTC ({{zone}} by default)'), text: p('text', 'With each: words under its name (default: how far from here)'), hour12: p('bool', '3:05 PM instead of 15:05') } },
  funnel: { group: 'Data', blurb: 'Steps that fewer get through: each one’s bar, its share of the first and what it lost. Sign-ups, a checkout.', rows: true, props: { label: p('text', 'A step’s name ({{label}} by default)'), value: p('text', 'How many got there ({{value}} by default)'), unit: p('text', 'After each number'), color: COLOR } },
  swatches: { group: 'Data', blurb: 'Colors as chips, a click copies one: a design system’s tokens, a brand’s palette.', rows: true, props: { color: p('text', 'Its color: a hex, a palette name or a tone ({{color}} by default)'), label: p('text', 'Its name ({{name}} by default)'), text: p('text', 'A line under it: its token (--accent)'), copy: p('text', 'What a click copies (default: the color as written)') } },
  matrix: { group: 'Data', blurb: 'A grid of states, a row and a column each: a CI matrix (versions × systems), environments × services.', rows: true, props: { row: p('text', 'An item’s row: a template ({{row}} by default)'), column: p('text', 'Its column ({{column}} by default)'), state: p('text', 'Its state: passed, failed, running, skipped… ({{state}} by default)'), rows: p('items', 'The rows in order (default: as first seen)'), columns: p('items', 'The columns in order (default: as first seen)'), href: p('text', 'A link a cell opens') } },
  button: { group: 'Actions', blurb: 'Runs an action or a Laki command, opens a link, refreshes, copies.', props: BUTTON },
  toggle: { group: 'Actions', blurb: 'A switch that runs an action with on or off: a feature flag, maintenance mode.', props: { label: p('text', 'Its words'), text: p('text', 'Words under it'), on: p('text', 'A path or template: on when truthy'), run: p('text', 'One of widget.json’s actions, run with $WIDGET_ARG on or off (what it’s turned to); then it fetches again and shows what’s true'), confirm: p('text', 'A question the app asks first') } },
  segmented: { group: 'Actions', blurb: 'One of a few options, picked: runs an action with it. An environment, a mode, a range.', props: { options: p('items', 'The options: words, or [{ "value", "label" }]'), value: p('text', 'The one picked now ({{env}})'), label: p('text', 'Words before it'), run: p('text', 'One of widget.json’s actions, run with the option’s value as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  stepper: { group: 'Actions', blurb: 'A number with − and +: runs an action with the new one. Replicas, a limit, a budget.', props: { value: p('text', 'The number now'), label: p('text', 'What it is'), unit: p('text', 'After the number'), min: p('number', 'The lowest'), max: p('number', 'The highest'), step: p('number', 'How much a click moves it (1)'), run: p('text', 'One of widget.json’s actions, run with the new number as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  range: { group: 'Actions', blurb: 'A slider: runs an action with where it’s let go. A volume, a threshold, a rollout percent.', props: { value: p('text', 'The number now'), min: p('number', 'The lowest (0)'), max: p('number', 'The highest (100)'), step: p('number', 'How far one notch moves it (1)'), label: p('text', 'What it is'), unit: p('text', 'After the number'), color: COLOR, run: p('text', 'One of widget.json’s actions, run with the number as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  select: { group: 'Actions', blurb: 'A pick from a long list: runs an action with it. A branch, a region, a model.', props: { options: p('items', 'The options: words, or [{ "value", "label" }]'), value: p('text', 'The one picked now'), label: p('text', 'Words before it'), run: p('text', 'One of widget.json’s actions, run with the option’s value as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  input: { group: 'Actions', blurb: 'A box to type in and a button (or Enter): runs an action with the words. Add a to-do, look something up.', props: { placeholder: p('text', 'What the empty box says'), value: p('text', 'What it starts with'), label: p('text', 'Its button’s words (Add)'), icon: p('icon', 'Its button’s icon'), run: p('text', 'One of widget.json’s actions, run with what’s typed as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first'), clear: p('bool', 'Empty the box once sent: on by default') } },
  swap: { group: 'Actions', blurb: 'An icon that flips between two: star and unstar, play and pause. Runs an action with on or off.', props: { on: p('text', 'A path or template: on when truthy'), icons: p('items', 'Its two icons or emoji, off then on: ["bell", "check"]'), labels: p('items', 'Its two words, off then on: ["Watch", "Watching"]'), color: COLOR, run: p('text', 'One of widget.json’s actions, run with $WIDGET_ARG on or off (what it’s turned to)'), confirm: p('text', 'A question the app asks first') } },
  pagination: { group: 'Actions', blurb: 'Pages in a joined row, ‹ 1 … 5 6 7 … 20 ›: runs an action with the page picked.', props: { page: p('text', 'The page now, from 1'), pages: p('text', 'How many pages'), run: p('text', 'One of widget.json’s actions, run with the page as $WIDGET_ARG') } },
  actions: { group: 'Actions', blurb: 'A row of buttons.', props: { items: p('buttons', 'The buttons') } },
  menu: { group: 'Actions', blurb: 'A list of places or commands, one lit as the current, headings between them: a launcher, a sidebar.', rows: true, props: { items: p('items', 'Its rows: [{ "label", "icon", "badge", "on", and a button’s run, open, do… }], or { "title" } for a heading'), ...BUTTON, badge: p('text', 'A count or word at a row’s end'), on: p('text', 'A path or template: the current row, lit'), title: p('text', 'In items: a heading over the rows after it'), limit: p('number', 'Rows at most (a preview: as many as fit), then +N more'), empty: p('text', 'What it says with no rows') } },
  dropdown: { group: 'Actions', blurb: 'A button that opens a menu of more buttons: the actions that don’t fit.', props: { label: p('text', 'Its button’s words'), icon: p('icon', 'Its button’s icon'), style: p(['primary', 'quiet', 'danger'] as const, 'primary, quiet or danger; none: plain'), items: BUTTONS, align: p(['start', 'end'] as const, 'The menu under its start (the default) or its end') } },
  popover: { group: 'Actions', blurb: 'A button that opens a small panel of elements: details, a form, more numbers. hover: a hover card.', props: { label: p('text', 'Its button’s words'), icon: p('icon', 'Its button’s icon'), style: p(['primary', 'quiet', 'danger'] as const, 'primary, quiet or danger; none: plain'), title: p('text', 'The panel’s title'), text: p('text', 'Its words'), children: p('children', 'Its elements'), hover: p('bool', 'Opens as the pointer rests on it too'), align: p(['start', 'end'] as const, 'The panel under its start (the default) or its end') } },
  command: { group: 'Actions', blurb: 'A command palette: a box that narrows the rows as you type, ↑ ↓ and Enter to run one. Shortcuts, places, recent things.', rows: true, props: { items: p('items', 'Its rows: [{ "label", "icon", "badge", "keys", and a button’s run, open, do… }], or { "title" } for a heading'), ...BUTTON, badge: p('text', 'A count or word at a row’s end'), keys: p('text', 'A shortcut at a row’s end: ⌘ K'), title: p('text', 'In items: a heading over the rows after it'), placeholder: p('text', 'What the empty box says (Type a command…)'), limit: p('number', 'Rows at most before you type (a preview: as many as fit)'), empty: p('text', 'What it says when nothing matches') } },
  combobox: { group: 'Actions', blurb: 'A box that suggests from a list as you type, or takes any words: runs an action with them. A branch, a package, a user.', props: { options: p('path', 'The suggestions: a field with them (branches), or a list: words, or [{ "value", "label" }]'), value: p('text', 'What it starts with'), placeholder: p('text', 'What the empty box says'), label: p('text', 'Its button’s words (Go)'), icon: p('icon', 'Its button’s icon'), run: p('text', 'One of widget.json’s actions, run with what’s typed or picked as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  datepicker: { group: 'Actions', blurb: 'A date, a time or a month to pick: runs an action with it. A release date, a freeze, a report’s day.', props: { value: p('text', 'The one picked now: 2026-10-24, 2026-10-24T15:00, 15:00 or 2026-10'), kind: p(['date', 'datetime', 'time', 'month'] as const, 'date (the default), datetime, time or month'), min: p('text', 'The earliest'), max: p('text', 'The latest'), label: p('text', 'Words before it'), run: p('text', 'One of widget.json’s actions, run with what’s picked (as value shows it) as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  split: { group: 'Actions', blurb: 'A button with a ▾ beside it for the other ways to do it: Merge ▾ squash, rebase; Deploy ▾ staging.', props: { ...BUTTON, items: BUTTONS, align: p(['start', 'end'] as const, 'The menu under its end (the default) or its start') } },
  radio: { group: 'Actions', blurb: 'One of a few options as cards, each with a line about it: runs an action with the one picked. A plan, a strategy, a model.', props: { options: p('items', 'The options: [{ "value", "label", "text", "icon", "badge" }]'), value: p('text', 'The one picked now'), label: p('text', 'A heading over them'), columns: p('number', 'Columns, 1-4 (1): fewer in a narrow cell'), run: p('text', 'One of widget.json’s actions, run with the option’s value as $WIDGET_ARG'), confirm: p('text', 'A question the app asks first') } },
  textarea: { group: 'Actions', blurb: 'A box for a few lines and a button (or ⌘ Enter): runs an action with them, or sends them to an agent or Laki AI.', props: { placeholder: p('text', 'What the empty box says'), value: p('text', 'What it starts with'), label: p('text', 'Its button’s words (Send)'), icon: p('icon', 'Its button’s icon'), rows: p('number', 'Lines tall, 2-12 (3)'), run: p('text', 'One of widget.json’s actions, run with what’s typed as $WIDGET_ARG'), do: p(['new', 'send', 'ai'] as const, 'Or a Laki command with what’s typed as its prompt: new (a workspace), send (to the workspace’s agent) or ai (Laki AI); the app asks first'), agent: p('text', 'With do new: an agent or a profile of yours'), project: p('text', 'With do new: a project by name or id'), confirm: p('text', 'A question the app asks first'), clear: p('bool', 'Empty the box once sent: on by default') } },
  breadcrumbs: { group: 'Actions', blurb: 'Where you are: a path of links, › between them. A repo’s folders, a site’s pages.', rows: true, props: { items: p('items', 'Each one: a word, or { "label", "href", "icon" }'), label: p('text', 'With each: its words'), href: p('text', 'With each: a link it opens'), icon: p('icon', 'With each: an icon or emoji before it') } },
  links: { group: 'Actions', blurb: 'Links in a line, a rule between them.', rows: true, props: { items: p('items', 'Each one: { "label", "href" }'), label: p('text', 'With each: a link’s words'), href: p('text', 'With each: where it goes') } },
  form: { group: 'Actions', blurb: 'Fields and a button that runs an action with them.', props: { fields: p('items', 'Its fields: [{ "id", "type": "text" | "number" | "bool" | "choice" | "textarea", "label", "hint", "default", "choices" }]'), submit: p('button', 'Its button: { "label", "run", "confirm" }; the action gets the fields as JSON in $WIDGET_ARG') } },
  empty: { group: 'Actions', blurb: 'Nothing to show, and what to do about it.', props: { text: p('text', 'What it says'), icon: p('icon', 'An icon or emoji over it'), action: p('button', 'A button under it') } },
} satisfies Record<string, Def>

// the elements whose rows are cut (rowsOf, cap) or say so when there are none (empty) without their own words for it
const ROWS = { limit: p('number', 'Rows at most (a preview: as many as fit), then +N more'), empty: p('text', 'What it says with no rows') }
const CUT = ['status', 'checklist', 'timeline', 'people', 'inbox', 'chat', 'prs', 'commits', 'env', 'deploys', 'issues', 'endpoints', 'changelog', 'clock', 'funnel', 'matrix'] as const
for (const t of [...CUT, 'snippet', 'card', 'steps', 'board', 'tree', 'log', 'uptime', 'swatches'] as const) (UI[t].props as Record<string, Prop>).empty ??= ROWS.empty
for (const t of CUT) (UI[t].props as Record<string, Prop>).limit ??= ROWS.limit

export type UiType = keyof typeof UI
export const UI_TYPES = Object.keys(UI) as UiType[]

// the TypeScript types, from the table: one per element (laki.d.ts has them with their words)
type KindType<K> = K extends readonly (infer W)[] ? W : K extends 'number' ? number | string : K extends 'bool' ? boolean : K extends 'children' ? UiElement[] : K extends 'button' ? UiButton : K extends 'buttons' ? UiButton[] : K extends 'path' ? string | unknown[] : K extends 'tone' ? Tone | string | Record<string, Tone> : K extends 'items' ? any[] : K extends 'object' ? Record<string, unknown> : string | number
type PropsOf<P> = { -readonly [K in keyof P]?: P[K] extends { kind: infer Q } ? KindType<Q> : never }
type Common = PropsOf<typeof COMMON>
export type UiButton = PropsOf<typeof BUTTON> & Common
export type UiElement = { [T in UiType]: { type: T } & Common & PropsOf<(typeof UI)[T]['props']> & (T extends (typeof CUT)[number] ? PropsOf<typeof ROWS> : unknown) }[UiType]
export type UiSpec = UiElement | { preview?: UiElement; full?: UiElement }

type El = Record<string, unknown> & { type?: string }
type Scope = Record<string, unknown>
type S = { scopes: Scope[]; full: boolean; single: boolean; cells: [number, number]; line: boolean; ids: { uid: string; n: number }; hide?: { refresh?: boolean; at?: boolean } } // ids: one counter for the whole tree (rows' copies of S share it)
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
// how far along, 0-100: a number of a max (100)
const pctOf = (v: unknown, max: unknown, s: S) => Math.round(Math.min(100, Math.max(0, ((n(v, s) ?? 0) / ((n(max, s) ?? 100) || 1)) * 100)))
// a small bar and its words: a table cell's progress, a row's accessory
const minibar = (pct: number, words: string, cls: string, color: string) => `<span class="k-tbar${cls ? ` ${cls}` : ''}"${color ? ` style="color:${color}"` : ''}><span class="k-bar"><i style="width:${pct}%"></i></span><b>${esc(words)}</b></span>`

// if / unless: an element's, a button's, an accessory's, an item's
const hidden = (x: El, s: S) => (x.if !== undefined && !holds(x.if, s)) || (x.unless !== undefined && holds(x.unless, s))
// when it was fetched, hidden: a plain element (no rows, lists or children) of the top scope whose words name at, "checked
// {{ago at}}" (its words only: a tone or an if over at isn't a line about it)
const AT = /\{\{[^}]*(?<![.\w])at\b[^}]*\}\}/
const SAYS = ['value', 'text', 'label', 'title', 'subtitle', 'caption']
const namesAt = (e: El, s: S) => !!s.hide?.at && s.scopes.length === 1 && e.each === undefined && Object.values(e).every(v => !v || typeof v !== 'object') && SAYS.some(k => typeof e[k] === 'string' && AT.test(e[k] as string))

function node(el: unknown, s: S): string {
  if (!obj(el)) return ''
  try {
    if (hidden(el, s) || namesAt(el, s)) return ''
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
// what a click on a button does, as its attributes: run (+ arg), do, open, refresh, full or copy, then confirm ('': none)
function actOf(b: El, s: S) {
  let act = ''
  if (b.run !== undefined) act = ` data-run="${h(b.run, s)}"${b.arg !== undefined ? ` data-arg="${h(b.arg, s)}"` : ''}`
  else if (b.do !== undefined) act = (c => (c ? ` data-do="${esc(JSON.stringify(c))}"` : ' disabled'))(doOf(b, s))
  else if (b.open !== undefined) act = (u => (u ? ` data-open="${esc(u)}"` : ' disabled'))(safeUrl(txt(b.open, s)))
  else if (b.refresh === true) act = ' data-laki="refresh"'
  else if (b.full === true) act = ' data-laki="full"'
  else if (b.copy !== undefined) act = ` data-copy="${h(b.copy, s)}"`
  return `${act}${b.confirm !== undefined ? ` data-confirm="${h(b.confirm, s)}"` : ''}`
}
// bare: its icon alone, its words the tooltip (a toolbar's)
function button(b: unknown, s: S, small = false, bare = false): string {
  if (!obj(b) || hidden(b, s) || (b.refresh === true && s.hide?.refresh)) return ''
  const label = txt(b.label, s)
  const style = ['primary', 'quiet', 'danger'].includes(String(b.style)) ? ` ${b.style}` : ''
  const iconOnly = bare && b.icon !== undefined && !!icon(b.icon, s, 12)
  return `<button type="button"${at(iconOnly && b.tip === undefined ? { ...b, tip: label } : b, s, `k-btn${style}${small ? ' sm' : ''}${iconOnly ? ' bare' : ''}`, label)}${actOf(b, s)}${iconOnly && label ? ` aria-label="${esc(label)}"` : ''}>${b.icon !== undefined ? icon(b.icon, s, 12) : ''}${label && !iconOnly ? `<span>${esc(label)}</span>` : ''}</button>`
}
// a menu's row (a menu's, a dropdown's): its icon, words and badge, lit when on; nothing to do: disabled
function menuRow(x: El, r: S, tone: unknown, attrs = '') {
  if (x.refresh === true && r.hide?.refresh) return ''
  const label = txt(x.label, r)
  const on = x.on !== undefined && holds(x.on, r)
  const badge = x.badge !== undefined ? txt(x.badge, r) : ''
  const act = (a => (/ data-(run|do|open|laki|copy)=/.test(a) ? a : ''))(actOf(x, r))
  const keys = x.keys !== undefined ? keysOf(txt(x.keys, r).trim()) : [] // a command's shortcut
  return `<button type="button" class="k-mn-i${on ? ' on' : ''}" data-label="${esc(label)}"${act || ' disabled'}${on ? ' aria-current="true"' : ''}${x.tip !== undefined ? ` title="${h(x.tip, r)}"` : ''}${attrs}>${x.icon !== undefined ? icon(x.icon, r, 13) : ''}<span class="k-title ${toneOf({ tone }, label, r)}">${esc(label)}</span>${badge ? `<span class="k-badge">${esc(badge)}</span>` : ''}${keys.length ? `<span class="k-kbd k-mn-k">${keys.map(k => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : ''}</button>`
}
// a segmented's or a select's options: words, or { value, label }
const optsOf = (v: unknown, s: S, max: number) =>
  (Array.isArray(v) ? v : [])
    .filter(o => !obj(o) || !hidden(o, s))
    .map(o => (obj(o) ? { v: txt(o.value ?? o.label, s).trim(), l: txt(o.label ?? o.value, s) } : { v: txt(o, s).trim(), l: txt(o, s) }))
    .filter(o => o.v)
    .slice(0, max)
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
  const key = ['tag', 'badge', 'text', 'icon', 'avatar', 'ago', 'date', 'progress'].find(k => a[k] !== undefined)
  if (!key) return ''
  const v = txt(a[key], s)
  const tone = toneOf(a, v, s)
  const c = hue(a.color, s)
  if (key === 'tag') return v ? `<span class="k-tag ${tone}"${c ? ` style="border-color:${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'badge') return v ? `<span class="k-badge ${tone}${c ? ' c' : ''}"${c ? ` style="color:${c}"` : ''}>${esc(v)}</span>` : ''
  if (key === 'icon') return `<span class="${tone}"${c ? ` style="color:${c}"` : ''}>${icon(a.icon, s, 13)}</span>`
  if (key === 'avatar') return avImg(v)
  if (key === 'progress') return (pct => minibar(pct, `${pct}%`, `sm ${tone}`, c))(pctOf(a.progress, a.max, s))
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
  const max = cap(e, s, cols.some(c => c.subtitle !== undefined) ? 38 : 28)
  const cls = (c: El) => [c.align === 'right' || c.align === 'center' ? `al-${c.align}` : '', c.mono === true ? 'mono' : '', c.wrap === true ? 'wrap' : '', c.hide === 'narrow' ? 'hide-narrow' : ''].filter(Boolean).join(' ')
  const width = (c: El) => (w => (w ? ` style="width:${/^\d+$/.test(w) ? `${w}px` : w}"` : ''))(/^\d{1,4}(px|%)?$/.test(String(c.width ?? '')) ? String(c.width) : '')
  const head = `<thead><tr>${cols.map(c => `<th class="${cls(c)}"${width(c)}>${h(c.title, s)}</th>`).join('')}</tr></thead>`
  // a cell: its words (a tag before them), or a bar; a picture before, a muted line under, a badge, a line, copy and
  // buttons after (none of those: the words alone, as before)
  const cell = (c: El, r: S) => {
    const v = txt(c.value, r)
    const tag = c.tag !== undefined ? txt(c.tag, r) : ''
    const tone = toneOf(c, v || tag, r)
    const pct = c.progress !== undefined ? pctOf(c.progress, c.max, r) : undefined
    const words = pct !== undefined ? '' : `${tag ? `<span class="k-tag ${tone}">${esc(tag)}</span>` : ''}${v ? (tag ? ` ${esc(v)}` : `<span class="${tone}">${esc(v)}</span>`) : ''}`
    const href = c.href !== undefined ? txt(c.href, r) : ''
    const sub = c.subtitle !== undefined ? txt(c.subtitle, r) : ''
    const lead = c.avatar !== undefined ? avImg(txt(c.avatar, r)) : c.image !== undefined ? (u => (imageOk(u) ? `<img class="k-av sq" src="${esc(u)}" alt="">` : ''))(txt(c.image, r).trim()) : c.icon !== undefined ? icon(c.icon, r, 13) : ''
    const bar = pct !== undefined ? minibar(pct, v || `${pct}%`, toneOf(c, v || String(pct), r), hue(c.color, r)) : ''
    const badge = c.badge !== undefined ? (b => (b ? `<span class="k-badge ${toneOf(c, b, r)}">${esc(b)}</span>` : ''))(txt(c.badge, r)) : ''
    const sp = c.spark !== undefined ? spark(valueAt(c.spark, r.scopes)) : ''
    const end = `${badge}${sp ? `<span class="k-tc-sp">${sp}</span>` : ''}${c.copy === true && v ? copyBtn(v) : ''}${buttons(c.actions, r)}`
    if (!lead && !sub && !bar && !end) return `<td class="${cls(c)}">${href && words ? link(href, words, 'link') : words}</td>`
    const head = `${lead}${words || sub ? `<div class="k-main"><span>${words}</span>${sub ? `<span class="k-sub">${esc(sub)}</span>` : ''}</div>` : ''}` // the link: its picture and words
    return `<td class="${cls(c)}"><div class="k-tc">${href && head ? link(href, head, 'link k-tc-a') : head}${bar}${end}</div></td>`
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
  [/^(failed|failing|fail|failure|error|errored|broken|cancell?ed|timed.out)$/i, 'fail'],
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
const presence = (e: El, state: string, r: S) => toneOf(e, state, r) || (w => (w ? `t-${w}` : 't-muted'))(PRESENCE.find(([re]) => re.test(state))?.[1])
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

// a box's button (an input's, a combobox's, a textarea's): act is its data-run or data-do, and what's typed goes with it
const sendBtn = (e: El, s: S, act: string, label: string, extra = '') => `<button type="button" class="k-btn sm primary"${act ? `${act} data-input${extra}${e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''}` : ' disabled'}${label ? '' : ' aria-label="Send"'}>${e.icon !== undefined ? icon(e.icon, s, 12) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`
// a date as a date, datetime-local, time or month input takes it: an ISO date as written, a moment (ms, or with its
// zone) in this Mac's time
function dateIn(kind: string, v: string) {
  const t = v.trim()
  const at = /^\d{10,13}$/.test(t) ? Number(t.length === 10 ? Number(t) * 1000 : t) : /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(t) ? Date.parse(t) : NaN
  const d = new Date(at)
  const local = Number.isFinite(at) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : t.replace(' ', 'T')
  const m = (kind === 'datetime' ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ : kind === 'month' ? /^\d{4}-\d{2}/ : kind === 'time' ? /\d{2}:\d{2}/ : /^\d{4}-\d{2}-\d{2}/).exec(local)
  return m ? m[0] : kind === 'datetime' && /^\d{4}-\d{2}-\d{2}$/.test(local) ? `${local}T00:00` : ''
}
// a variable whose value is dots until a click: by its name
const SECRETS = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|DSN|DATABASE_URL/i
const DEPLOY: [RegExp, Tone][] = [
  [/^(ready|success|succeeded|live|active|deployed|done|promoted|current|healthy)$/i, 'good'],
  [/^(building|deploying|queued|enqueued|pending|new|preparing|processing|uploading|initializing|in.progress|running|started|waiting)$/i, 'warn'],
  [/^(error|errored|failed|failure|crashed|broken)$/i, 'bad'],
]
// an issue's state: its circle, Linear's
const ISSUE: [RegExp, string][] = [
  [/^(backlog|triage|icebox|later)$/i, 'backlog'],
  [/^(in.?progress|doing|started|active|wip|working|in.?development)$/i, 'doing'],
  [/^(in.?review|review|reviewing|qa|testing|ready.for.review)$/i, 'review'],
  [/^(done|closed|completed?|fixed|resolved|shipped|merged)$/i, 'done'],
  [/^(canceled|cancelled|duplicate|won.?t.?(fix|do)|invalid|declined|not.planned)$/i, 'canceled'],
]
const svg14 = (body: string, style = '') => `<svg class="k-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"${style}>${body}</svg>`
const ring = (inner: string, dash = '') => svg14(`<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"${dash}/>${inner}`)
const ISSUE_ICON: Record<string, string> = {
  backlog: ring('', ' stroke-dasharray="1.6 1.9"'),
  todo: ring(''),
  doing: ring('<path d="M7 3.5a3.5 3.5 0 010 7z" fill="currentColor"/>'),
  review: ring('<path d="M7 3.5a3.5 3.5 0 11-3.5 3.5H7z" fill="currentColor"/>'),
  done: svg14('<circle cx="7" cy="7" r="6.25" fill="currentColor"/><path d="M4.4 7.2l1.8 1.8 3.5-3.6" fill="none" stroke="var(--bg, #0f1117)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  canceled: svg14('<circle cx="7" cy="7" r="6.25" fill="currentColor"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--bg, #0f1117)" stroke-width="1.5" stroke-linecap="round"/>'),
}
// a priority: urgent's box, then three bars lit by how high, none's dots
function priorityIcon(p: string) {
  if (/^(urgent|critical|p0|blocker|1)$/.test(p)) return svg14('<rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor"/><path d="M7 3.8v4M7 10v.2" stroke="var(--bg, #0f1117)" stroke-width="1.7" stroke-linecap="round"/>', ' style="color:var(--tc-orange, #ff9e64)"')
  const lv = /^(highest|high|p1|2)$/.test(p) ? 3 : /^(medium|med|normal|p2|3)$/.test(p) ? 2 : /^(low|lowest|p3|p4|4)$/.test(p) ? 1 : 0 // Linear's numbers: 1 urgent … 4 low, 0 none
  if (!lv) return svg14('<path d="M3 7h.01M7 7h.01M11 7h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>')
  return svg14([0, 1, 2].map(i => `<rect x="${1.5 + i * 4}" y="${9 - i * 3}" width="3" height="${3.5 + i * 3}" rx="1" fill="currentColor"${i < lv ? '' : ' opacity="0.3"'}/>`).join(''))
}
// an HTTP method's color, Swagger's
const METHOD: Record<string, string> = { GET: 'blue', POST: 'green', PUT: 'orange', PATCH: 'teal', DELETE: 'red', HEAD: 'purple', OPTIONS: 'gray' }
// a change: "feat(search)!: its words", or { type, text }: its tag, tone and words
const CHANGE: [RegExp, string, Tone][] = [
  [/^(break|breaking|removed?|drop|dropped)$/i, 'breaking', 'bad'],
  [/^(feat|feature|features|add|added|new)$/i, 'feat', 'good'],
  [/^(fix|fixes|fixed|bug|bugfix)$/i, 'fix', 'accent'],
  [/^(perf|performance)$/i, 'perf', 'warn'],
  [/^(security|sec)$/i, 'security', 'bad'],
  [/^(deprecated?)$/i, 'deprecated', 'warn'],
]
function changeOf(c: unknown) {
  let type = obj(c) ? String(c.type ?? '').trim() : ''
  let text = obj(c) ? String(c.text ?? c.title ?? '') : typeof c === 'string' || typeof c === 'number' ? String(c) : ''
  let bang = false
  const m = type ? null : /^(\w+)(?:\([^)]*\))?(!)?:\s+([\s\S]+)$/.exec(text)
  if (m) [type, bang, text] = [m[1], !!m[2], m[3]]
  const k = bang ? CHANGE[0] : CHANGE.find(([re]) => re.test(type))
  return { tag: k ? k[1] : type.toLowerCase().slice(0, 16), tone: k ? k[2] : 'muted', text: text.trim().split('\n')[0] }
}
// a time zone's time now, how far it is from here and whether it's night there; null: no such zone. uiBehave's tick
// formats it with the same options
const CLOCK = (zone: string, h12: boolean): Intl.DateTimeFormatOptions => ({ timeZone: zone || undefined, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23' })
function zoned(zone: string, h12: boolean, now = new Date()) {
  try {
    const time = new Intl.DateTimeFormat('en-US', CLOCK(zone, h12)).format(now)
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone || undefined, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, Number(x.value)]))
    const mins = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())) / 60_000)
    const day = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000)
    const a = Math.abs(mins)
    const off = mins ? `${mins > 0 ? '+' : '−'}${Math.floor(a / 60)}h${a % 60 ? ` ${a % 60}m` : ''} from here` : 'Same time as here'
    return { time, night: p.hour < 7 || p.hour >= 19, from: [off, day > 0 ? 'tomorrow' : day < 0 ? 'yesterday' : ''].filter(Boolean).join(', ') }
  } catch {
    return null
  }
}
// a matrix cell's mark by its step (STEP's words)
const MX: Record<string, [string, string]> = { done: [iconSvg('check', 12), 't-good'], fail: [iconSvg('x', 12), 't-bad'], now: ['<i class="k-mx-run"></i>', 't-warn'], skip: ['<i class="k-mx-skip"></i>', 't-muted'], todo: ['<i class="k-mx-todo"></i>', 't-muted'] }

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
  // panels that fold: one open at a time (details of one name), unless multiple
  accordion: (e, s) => {
    const items = itemsOf(e, s)
    const max = cap(e, s, 28)
    const open = Math.round(n(e.open, s) ?? 0)
    const name = e.multiple === true ? '' : ` name="ka-${s.ids.uid}-${++s.ids.n}"`
    return `<div${at({ tip: e.tip }, s, 'k-accord')} data-rows>${items
      .map(([x, r], i) => {
        if (i >= max && !s.full) return ''
        const title = txt(x.title, r)
        const sub = x.subtitle !== undefined ? txt(x.subtitle, r) : ''
        const badge = x.badge !== undefined ? txt(x.badge, r) : ''
        const body = `${x.text !== undefined ? `<div class="k-ad-t">${h(x.text, r)}</div>` : ''}${kids(x.children, r)}`
        return `<details class="k-ad"${name} data-row${i >= max ? ' data-extra hidden' : ''}${i === open && !s.line ? ' open' : ''}><summary class="k-ad-h">${x.icon !== undefined ? icon(x.icon, r, 13) : ''}<span class="k-title ${toneOf(x === e ? e : { tone: x.tone ?? e.tone }, title, r)}">${esc(title)}</span>${sub ? `<span class="k-sub">${esc(sub)}</span>` : ''}${badge ? `<span class="k-badge">${esc(badge)}</span>` : ''}</summary>${body ? `<div class="k-ad-b">${body}</div>` : ''}</details>`
      })
      .join('')}${empty(e, s, items.length)}${s.line ? '' : more(items.length - Math.min(max, items.length))}</div>`
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
    const pct = pctOf(e.value, e.max, s)
    const label = txt(e.label, s)
    if (e.style === 'ring')
      return `<div${at(e, s, 'k-prog ring', String(pct), e.color)}><svg width="32" height="32" viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4"/><circle class="fg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg><div class="k-prog-h"><b>${pct}%</b><span>${esc(label)}</span></div></div>`
    return `<div${at(e, s, 'k-prog', String(pct), e.color)}><div class="k-prog-h"><span>${esc(label)}</span><b>${pct}%</b></div><div class="k-bar"><i style="width:${pct}%"></i></div></div>`
  },
  loading: (e, s) => {
    const style = ['dots', 'bar'].includes(String(e.style)) ? String(e.style) : 'spinner'
    const label = txt(e.label, s)
    const mark = style === 'dots' ? '<i class="k-ld-d"><i></i><i></i><i></i></i>' : style === 'bar' ? '<i class="k-ld-b"><i></i></i>' : '<i class="k-ld-s"></i>'
    return `<div${at(e, s, `k-load ${style}${['sm', 'lg'].includes(String(e.size)) ? ` s-${e.size}` : ''}`, label, e.color)} role="status">${mark}${label ? `<span>${esc(label)}</span>` : ''}</div>`
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
  gallery: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const tall = Math.round(Math.min(2000, Math.max(12, n(e.height, s) ?? (s.line ? 16 : s.full ? 160 : s.cells[1] * 64 - (e.caption !== undefined ? 32 : 14)))))
    const pics = items
      .map((item, i) => {
        const r = inner(s, item, i)
        const src = (e.src !== undefined ? txt(e.src, r) : typeof item === 'string' ? item : txt('{{src}}', r)).trim()
        if (!imageOk(src)) return ''
        const words = e.caption !== undefined ? txt(e.caption, r) : ''
        return `<figure class="k-gl-i"${e.href !== undefined ? opens(txt(e.href, r)) : ''}${words ? ` title="${esc(words)}"` : ''}><img src="${esc(src)}" alt="${esc(words)}" style="height:${tall}px" loading="lazy">${words && !s.line ? `<figcaption>${esc(words)}</figcaption>` : ''}</figure>`
      })
      .filter(Boolean)
    return pics.length ? `<div${at({ tip: e.tip }, s, 'k-gallery')}>${pics.join('')}</div>` : empty(e, s, 0)
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
      const t = state ? presence(e, state, r) : ''
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
    const opts = optsOf(e.options, s, 8)
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
  breadcrumbs: (e, s) =>
    `<nav${at({ tip: e.tip }, s, 'k-crumbs')} aria-label="Breadcrumbs">${itemsOf(e, s)
      .map(([x, r]) => {
        const label = x.label !== undefined ? txt(x.label, r) : x === e ? (t => (typeof t === 'string' ? t : txt('{{label}}', r)))(r.scopes[0].this) : '' // each: a string item is its words
        const body = `${x.icon !== undefined ? icon(x.icon, r, 12) : ''}${label ? `<span>${esc(label)}</span>` : ''}`
        return body ? `<span class="k-cr">${link(x.href !== undefined ? txt(x.href, r) : '', body)}</span>` : ''
      })
      .join('')}</nav>`,
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
  // after DaisyUI's: a banner, frames, chips that filter, words in turn, pictures to compare, placeholders, a ring, a
  // corner's count, one avatar, a slider, a pick, a box to type in, a flip, pages, a menu and a dropdown
  hero: (e, s) => {
    const title = txt(e.title, s)
    const img = e.image !== undefined ? txt(e.image, s).trim() : ''
    const c = hue(e.color, s)
    const art = imageOk(img) ? `<img class="k-hero-img" src="${esc(img)}" alt="">` : e.icon !== undefined ? `<span class="k-hero-ic">${icon(e.icon, s, 26)}</span>` : ''
    const acts = buttons(e.actions, s, false)
    return `<section${at(e, s, `k-hero${e.align === 'center' ? ' center' : ''}`, title)}${c ? ` style="--hero:${c}"` : ''}>${art}<div class="k-hero-b">${title ? `<div class="k-hero-t">${esc(title)}</div>` : ''}${e.text !== undefined ? `<div class="k-hero-x">${h(e.text, s)}</div>` : ''}${kids(e.children, s)}${acts ? `<div class="k-actions">${acts}</div>` : ''}</div></section>`
  },
  mockup: (e, s) => {
    const kind = ['window', 'terminal', 'phone'].includes(String(e.kind)) ? String(e.kind) : 'browser'
    const img = e.image !== undefined ? txt(e.image, s).trim() : ''
    const lines = e.value !== undefined ? (l => (l.at(-1) === '' ? l.slice(0, -1) : l))(txt(e.value, s).replace(/\r/g, '').split('\n')) : []
    const code = lines.length ? `<div class="k-mk-code">${lines.map(l => (m => (m ? `<div class="cmd"><span class="k-mk-p">${esc(m[1])}</span>${esc(m[2])}</div>` : `<div>${esc(l) || ' '}</div>`))(/^([$>])(?: (.*))?$/.exec(l))).join('')}</div>` : ''
    const url = kind === 'browser' ? txt(e.url, s).trim() : ''
    const head = kind === 'phone' ? '<i class="k-mk-notch"></i>' : `<div class="k-mk-bar"><i></i><i></i><i></i>${url ? `<span class="k-mk-url"${opens(url)} title="${esc(url)}">${esc(url.replace(/^https?:\/\//i, ''))}</span>` : kind === 'window' && e.title !== undefined ? `<span class="k-mk-t">${h(e.title, s)}</span>` : ''}</div>`
    return `<div${at(e, s, `k-mk ${kind}`)}>${head}<div class="k-mk-b">${imageOk(img) ? `<img class="k-mk-img" src="${esc(img)}" alt="">` : ''}${code}${kids(e.children, s)}</div></div>`
  },
  // chips that hide the rows (uiBehave's sift) of the elements under it whose words haven't the chip's value
  // ponytail: only the rows drawn; a preview's past its cap aren't, so a chip there may show none (the full view has all)
  filter: (e, s) => {
    const all = e.all !== undefined ? txt(e.all, s) : 'All'
    const chip = (v: string, l: string, on: boolean) => `<button type="button" class="k-chip${on ? ' on' : ''}" data-chip="${esc(v)}" aria-pressed="${on}">${esc(l)}</button>`
    return `<div${at(e, s, 'k-filt')} data-filt><div class="k-chips" role="group">${all ? chip('', all, true) : ''}${optsOf(e.options, s, 12)
      .map(o => chip(o.v, o.l, false))
      .join('')}</div>${kids(e.children, s)}</div>`
  },
  // ponytail: a jump from word to word (steps), not a slide: a slide needs keyframes per count
  rotate: (e, s) => {
    const words = (e.each !== undefined ? listAt(e.each, s).map((item, i) => (e.text !== undefined ? txt(e.text, inner(s, item, i)) : typeof item === 'string' ? item : txt('{{text}}', inner(s, item, i)))) : (Array.isArray(e.items) ? e.items : []).map(x => txt(x, s)))
      .map(w => w.trim())
      .filter(Boolean)
      .slice(0, 12)
    const sec = Math.min(60, Math.max(0.5, n(e.seconds, s) ?? 2))
    const c = hue(e.color, s)
    const turn = words.length > 1 ? `<span class="k-rot-w"><span class="k-rot-t" style="--n:${words.length};--s:${sec}s">${words.map(w => `<span>${esc(w)}</span>`).join('')}</span></span>` : `<b class="k-rot-1">${esc(words[0] ?? '')}</b>`
    return `<div${at({ tip: e.tip, tone: e.tone }, s, `k-rot${['sm', 'lg', 'xl'].includes(String(e.size)) ? ` s-${e.size}` : ''}`, words[0] ?? '')}${c ? ` style="--rc:${c}"` : ''}>${e.prefix !== undefined ? `<span>${h(e.prefix, s)}</span>` : ''}${turn}${e.suffix !== undefined ? `<span>${h(e.suffix, s)}</span>` : ''}</div>`
  },
  // the after picture under the before one, whose width a resizer sets (CSS resize, scaled up and see-through: no script)
  compare: (e, s) => {
    const a = txt(e.before, s).trim()
    const b = txt(e.after, s).trim()
    if (!imageOk(a) || !imageOk(b)) return empty(e, s, 0)
    const tall = s.line ? 16 : Math.round(Math.min(2000, Math.max(16, n(e.height, s) ?? (s.full ? 260 : s.cells[1] * 64 - 12)))) // a bar's line: 16 whatever its height
    const [l1, l2] = [0, 1].map(i => (Array.isArray(e.labels) && e.labels[i] !== undefined && !s.line ? txt(e.labels[i], s) : ''))
    return `<div${at({ tip: e.tip }, s, 'k-cmp')} style="height:${tall}px"><div class="k-cmp-a"><img src="${esc(b)}" alt="${esc(l2 || 'After')}">${l2 ? `<span class="k-cmp-l r">${esc(l2)}</span>` : ''}</div><div class="k-cmp-b"><img src="${esc(a)}" alt="${esc(l1 || 'Before')}">${l1 ? `<span class="k-cmp-l">${esc(l1)}</span>` : ''}</div><i class="k-cmp-h" aria-hidden="true"></i><div class="k-cmp-r" title="Drag to compare"></div></div>`
  },
  skeleton: (e, s) => {
    const lines = Math.min(12, Math.max(0, Math.round(n(e.lines, s) ?? 3)))
    return `<div${at({ tip: e.tip }, s, 'k-skel')} role="status" aria-busy="true" aria-label="${h(e.label ?? 'Loading…', s)}">${e.image === true ? '<i class="k-sk img"></i>' : ''}<div class="k-sk-r">${e.avatar === true ? '<i class="k-sk av"></i>' : ''}<div class="k-sk-ls">${Array.from({ length: lines }, (_, i) => `<i class="k-sk" style="width:${[100, 86, 64, 92, 74][i % 5]}%"></i>`).join('')}</div></div></div>`
  },
  radial: (e, s) => {
    const pct = pctOf(e.value, e.max, s)
    const inside = e.text !== undefined ? txt(e.text, s) : `${pct}%`
    const label = txt(e.label, s)
    return `<div${at(e, s, `k-radial${['sm', 'lg'].includes(String(e.size)) ? ` s-${e.size}` : ''}`, String(pct), e.color)} role="img" aria-label="${esc(`${label ? `${label}: ` : ''}${inside}`)}"><div class="k-rd-c"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="3.2"/><circle class="fg" cx="18" cy="18" r="15.9155" fill="none" stroke-width="3.2" stroke-linecap="${pct ? 'round' : 'butt'}" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/></svg><b>${esc(inside)}</b></div>${label ? `<span class="k-rd-l">${esc(label)}</span>` : ''}</div>`
  },
  indicator: (e, s) => {
    const label = e.label !== undefined ? txt(e.label, s) : ''
    const thing = e.avatar !== undefined ? avImg(txt(e.avatar, s)) : e.icon !== undefined ? icon(e.icon, s, 18) : ''
    const b = e.badge !== undefined ? txt(e.badge, s).trim() : ''
    const bg = (c => (c ? ` style="background:${c}"` : ''))(hue(e.color, s))
    const mark = b && b !== '0' ? `<b class="k-ind-b ${toneOf(e, b, s)}"${bg}><span>${esc(b)}</span></b>` : e.dot !== undefined && holds(e.dot, s) ? `<i class="k-ind-d ${toneOf(e, '', s)}"${bg}></i>` : ''
    return `<span${at({ tip: e.tip }, s, 'k-ind')}${e.href !== undefined ? opens(txt(e.href, s)) : ''}><span class="k-ind-x${label ? ' box' : ''}">${thing}${label ? `<span>${esc(label)}</span>` : ''}</span>${mark}</span>`
  },
  // its shape clips the picture, and a span under it (the ring's color, a little bigger) draws the ring in any shape
  avatar: (e, s) => {
    const login = e.login !== undefined ? txt(e.login, s).trim() : ''
    const name = e.name !== undefined ? txt(e.name, s) : login
    const img = e.image !== undefined ? txt(e.image, s).trim() : ''
    const src = avatarUrl(login) ? avatarUrl(login).replace(/s=40$/, 's=200') : imageOk(img) ? img : ''
    const shape = ['rounded', 'squircle', 'hexagon', 'diamond'].includes(String(e.shape)) ? String(e.shape) : 'circle'
    const ring = hue(e.ring, s)
    const state = e.state !== undefined ? txt(e.state, s).trim() : ''
    const label = txt(e.label, s)
    const text = e.text !== undefined ? txt(e.text, s) : ''
    const tip = e.tip !== undefined ? txt(e.tip, s) : label ? '' : name
    const face = src ? `<img src="${esc(src)}" alt="${esc(name)}">` : `<span class="k-avt-i">${esc(initialsOf(name || '?'))}</span>`
    return `<div class="k-avatar ${['sm', 'lg', 'xl'].includes(String(e.size)) ? e.size : 'md'}"${tip ? ` title="${esc(tip)}"` : ''}${e.href !== undefined ? opens(txt(e.href, s)) : ''}><span class="k-avt-w"><span class="k-avt sh-${shape}${ring ? ' ring' : ''}"${ring ? ` style="--ring:${ring}"` : ''}><span class="k-avt-f sh-${shape}">${face}</span></span>${state ? `<i class="k-avt-d ${presence(e, state, s)}" title="${esc(state)}"></i>` : ''}</span>${label || text ? `<div class="k-main">${label ? `<span class="k-title">${esc(label)}</span>` : ''}${text ? `<span class="k-sub">${esc(text)}</span>` : ''}</div>` : ''}</div>`
  },
  // a slider and a select run on change (uiBehave's data-change): data-run would run them on a click
  range: (e, s) => {
    const min = n(e.min, s) ?? 0
    const max = Math.max(min, n(e.max, s) ?? 100)
    const step = Math.abs(n(e.step, s) || 1)
    const v = Math.min(max, Math.max(min, n(e.value, s) ?? min))
    const label = txt(e.label, s)
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const c = hue(e.color, s)
    return `<label${at({ tip: e.tip }, s, 'k-range')}><span class="k-rg-h"><span class="k-rg-l">${esc(label)}</span><b class="${toneOf(e, round6(v), s)}"><span data-rv>${esc(round6(v))}</span>${e.unit !== undefined ? `<span class="k-unit">${h(e.unit, s)}</span>` : ''}</b></span><input type="range" min="${round6(min)}" max="${round6(max)}" step="${round6(step)}" value="${round6(v)}" aria-label="${esc(label || 'Value')}"${c ? ` style="accent-color:${c}"` : ''}${run ? ` data-change="${esc(run)}"${e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''}` : ' disabled'}></label>`
  },
  select: (e, s) => {
    const opts = optsOf(e.options, s, 200)
    const cur = txt(e.value, s).trim()
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const label = txt(e.label, s)
    const list = cur && !opts.some(o => o.v === cur) ? [{ v: cur, l: cur }, ...opts] : opts // the one picked now, though the options lack it
    return `<label${at(e, s, 'k-selw', cur)}>${label ? `<span class="k-seg-l">${esc(label)}</span>` : ''}<select aria-label="${esc(label || 'Pick one')}"${run ? ` data-change="${esc(run)}"${e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''}` : ' disabled'}>${cur ? '' : '<option value="" selected disabled>–</option>'}${list.map(o => `<option value="${esc(o.v)}"${o.v === cur ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>`
  },
  // its button's data-input: what's typed is the arg (uiBehave), Enter clicks it
  input: (e, s) => {
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const label = e.label !== undefined ? txt(e.label, s) : e.icon !== undefined ? '' : 'Add'
    const ph = txt(e.placeholder, s)
    return `<div${at(e, s, 'k-input')} data-inbox><input type="text" value="${h(e.value, s)}" placeholder="${esc(ph)}" aria-label="${esc(ph || label || 'Text')}"${run ? '' : ' disabled'}>${sendBtn(e, s, run ? ` data-run="${esc(run)}"` : '', label, e.clear === false ? ' data-keep' : '')}</div>`
  },
  swap: (e, s) => {
    const on = e.on !== undefined && holds(e.on, s)
    const pick = (v: unknown) => (Array.isArray(v) ? (v[on ? 1 : 0] ?? v[0]) : undefined)
    const ic = pick(e.icons)
    const word = (w => (w === undefined ? '' : txt(w, s)))(pick(e.labels))
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const c = on ? hue(e.color, s) : ''
    return `<button type="button" role="switch" aria-checked="${on}"${at(e, s, `k-swap${on ? ' on' : ''}${word ? '' : ' bare'}`, word)}${c ? ` style="color:${c}"` : ''}${run ? ` data-run="${esc(run)}" data-arg="${on ? 'off' : 'on'}"${e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''}` : ' disabled'}${word ? '' : ` aria-label="${on ? 'On' : 'Off'}"`}>${ic !== undefined ? icon(ic, s, 15) : ''}${word ? `<span>${esc(word)}</span>` : ''}</button>`
  },
  pagination: (e, s) => {
    const pages = Math.min(1e6, Math.max(1, Math.round(n(e.pages, s) ?? 1)))
    const page = Math.min(pages, Math.max(1, Math.round(n(e.page, s) ?? 1)))
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const go = (p: number, words: string, label: string, cls: string) => `<button type="button" class="k-pg-b ${cls}"${p === page && cls !== 'arr' ? ' aria-current="page"' : ''} aria-label="${label}"${run && p >= 1 && p <= pages && p !== page ? ` data-run="${esc(run)}" data-arg="${p}"` : ' disabled'}>${words}</button>`
    const near = s.full ? 2 : 1
    const nums = [...new Set([1, pages, ...Array.from({ length: near * 2 + 1 }, (_, i) => page - near + i)])].filter(p => p >= 1 && p <= pages).sort((a, b) => a - b)
    const mid = s.line ? `<span class="k-pg-n">${page}/${pages}</span>` : nums.map((p, i) => `${i && p - nums[i - 1] > 1 ? '<span class="k-pg-gap">…</span>' : ''}${go(p, String(p), `Page ${p}`, p === page ? 'pn on' : 'pn')}`).join('')
    return `<nav${at(e, s, 'k-pg')} aria-label="Pages">${go(page - 1, '‹', 'Previous page', 'arr')}${mid}${go(page + 1, '›', 'Next page', 'arr')}</nav>`
  },
  menu: (e, s) => {
    const items = itemsOf(e, s)
    const head = (x: El) => x !== e && x.title !== undefined && x.label === undefined
    const rows = items.filter(([x]) => !head(x)).length
    const max = cap(e, s, 28)
    let k = 0
    return `<nav${at({ tip: e.tip }, s, 'k-menu')} data-rows>${items
      .map(([x, r]) => {
        if (head(x)) return k >= max && !s.full ? '' : `<div class="k-mn-h" data-sect${k >= max ? ' data-extra hidden' : ''}>${h(x.title, r)}</div>` // past the cut: hidden with its rows
        const i = k++
        const row = x === e && e.label === undefined ? { ...e, label: '{{label}}' } : x // over each: a row's label by default
        return i >= max && !s.full ? '' : menuRow(row, r, x === e ? e.tone : (x.tone ?? e.tone), ` data-row${i >= max ? ' data-extra hidden' : ''}`)
      })
      .join('')}${empty(e, s, rows)}${s.line ? '' : more(rows - Math.min(max, rows))}</nav>`
  },
  // a details: its menu over what's under it (a preview's: over the cell); in a bar, the full view
  dropdown: (e, s) => {
    const label = txt(e.label, s)
    const style = ['primary', 'quiet', 'danger'].includes(String(e.style)) ? ` ${e.style}` : ''
    const rows = (Array.isArray(e.items) ? e.items : []).filter((b): b is El => obj(b) && !hidden(b, s)).map(b => menuRow(b, s, b.tone)).join('')
    return `<details${at({ tip: e.tip }, s, `k-dd${e.align === 'end' ? ' end' : ''}`)}><summary class="k-dd-s${style}"${s.line ? ' data-laki="full"' : ''}${label ? '' : ' aria-label="More"'}>${e.icon !== undefined ? icon(e.icon, s, 12) : ''}${label ? `<span>${esc(label)}</span>` : ''}${iconSvg('chevron', 10)}</summary><div class="k-dd-m">${rows}</div></details>`
  },
  // after shadcn's, and what developers keep open: a panel on a button, a palette, a box that suggests, a date, a split
  // button, cards to pick from, a prompt box; a snippet, env vars, uptime, deploys, issues, routes, a changelog, clocks,
  // a funnel, colors, a matrix; a marquee and a bento grid
  // a native popover (the top layer: no cell or full view clips it), anchored under its button; uiBehave opens a hover
  // card's as the pointer comes
  popover: (e, s) => {
    const label = txt(e.label, s)
    const style = ['primary', 'quiet', 'danger'].includes(String(e.style)) ? ` ${e.style}` : ''
    const title = e.title !== undefined ? txt(e.title, s) : ''
    const id = `kp-${s.ids.uid}-${++s.ids.n}`
    return `<span${at({ tip: e.tip }, s, `k-pop${e.align === 'end' ? ' end' : ''}${e.hover === true && !s.line ? ' hover' : ''}`)}><button type="button" class="k-dd-s${style}"${s.line ? ' data-laki="full"' : ` popovertarget="${id}" style="anchor-name:--${id}"`}${label ? '' : ' aria-label="More"'}>${e.icon !== undefined ? icon(e.icon, s, 12) : ''}${label ? `<span>${esc(label)}</span>` : ''}${iconSvg('chevron', 10)}</button>${s.line ? '' : `<div class="k-pop-b" id="${id}" popover style="position-anchor:--${id}">${title ? `<div class="k-pop-t">${esc(title)}</div>` : ''}${e.text !== undefined ? `<div class="k-pop-x">${h(e.text, s)}</div>` : ''}${kids(e.children, s)}</div>`}</span>`
  },
  // a menu's rows under a box that sifts them (uiBehave: data-filter, ↑ ↓ and Enter); every row drawn, the ones past
  // the cut hidden: typing finds them too
  command: (e, s) => {
    const ph = e.placeholder !== undefined ? txt(e.placeholder, s) : 'Type a command…'
    if (s.line) return `<button type="button"${at({ tip: e.tip }, s, 'k-btn sm k-cmd-l')} data-laki="full">${iconSvg('search', 11)}<span>${esc(ph)}</span></button>`
    const items = itemsOf(e, s).slice(0, 500)
    const head = (x: El) => x !== e && x.title !== undefined && x.label === undefined
    const rows = items.filter(([x]) => !head(x)).length
    const max = cap(e, s, 28)
    let k = 0
    const body = items
      .map(([x, r]) => {
        if (head(x)) return `<div class="k-mn-h" data-sect${k >= max ? ' hidden' : ''}>${h(x.title, r)}</div>`
        const i = k++
        const row = x === e && e.label === undefined ? { ...e, label: '{{label}}' } : x
        return menuRow(row, r, x === e ? e.tone : (x.tone ?? e.tone), ` data-row${i >= max ? ' data-extra hidden' : ''}`)
      })
      .join('')
    return `<div${at({ tip: e.tip }, s, 'k-cmd')} data-rows><label class="k-cmd-q">${iconSvg('search', 12)}<input type="search" data-filter placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off"></label><nav class="k-menu k-cmd-m">${body}</nav>${rows ? `<div class="k-empty small" data-none hidden>${h(e.empty ?? 'Nothing matches', s)}</div>` : empty(e, s, 0)}${more(rows - Math.min(max, rows))}</div>`
  },
  combobox: (e, s) => {
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const label = e.label !== undefined ? txt(e.label, s) : e.icon !== undefined ? '' : 'Go'
    const ph = txt(e.placeholder, s)
    const id = `kc-${s.ids.uid}-${++s.ids.n}`
    // written ones are templates; a field's are the data's own words
    const opts = Array.isArray(e.options) ? optsOf(e.options, s, 500) : listAt(e.options, s).slice(0, 500).map(o => (obj(o) ? { v: String(o.value ?? o.label ?? '').trim(), l: String(o.label ?? o.value ?? '') } : { v: String(o ?? '').trim(), l: String(o ?? '') })).filter(o => o.v)
    return `<div${at(e, s, 'k-input k-combo')} data-inbox><input type="text" list="${id}" value="${h(e.value, s)}" placeholder="${esc(ph)}" aria-label="${esc(ph || label || 'Text')}" autocomplete="off"${run ? '' : ' disabled'}><datalist id="${id}">${opts.map(o => `<option value="${esc(o.v)}"${o.l !== o.v ? ` label="${esc(o.l)}"` : ''}></option>`).join('')}</datalist>${sendBtn(e, s, run ? ` data-run="${esc(run)}"` : '', label, ' data-keep')}</div>`
  },
  datepicker: (e, s) => {
    const kind = ['datetime', 'time', 'month'].includes(String(e.kind)) ? String(e.kind) : 'date'
    const label = txt(e.label, s)
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const lim = (k: string) => (v => (v ? ` ${k}="${esc(v)}"` : ''))(e[k] !== undefined ? dateIn(kind, txt(e[k], s)) : '')
    return `<label${at(e, s, 'k-date')}>${label ? `<span class="k-seg-l">${esc(label)}</span>` : ''}<input type="${kind === 'datetime' ? 'datetime-local' : kind}" value="${esc(dateIn(kind, txt(e.value, s)))}"${lim('min')}${lim('max')} aria-label="${esc(label || kind)}"${run ? ` data-change="${esc(run)}"${e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''}` : ' disabled'}></label>`
  },
  // the button and a dropdown of the others, joined
  split: (e, s) => {
    const style = ['primary', 'quiet', 'danger'].includes(String(e.style)) ? ` ${e.style}` : ''
    const rows = (Array.isArray(e.items) ? e.items : []).filter((b): b is El => obj(b) && !hidden(b, s)).map(b => menuRow(b, s, b.tone)).join('')
    return `<div class="k-split">${button({ ...e, items: undefined }, s)}${rows ? `<details class="k-dd${e.align === 'start' ? '' : ' end'}"><summary class="k-dd-s k-split-s${style}"${s.line ? ' data-laki="full"' : ''} aria-label="More">${iconSvg('chevron', 10)}</summary><div class="k-dd-m">${rows}</div></details>` : ''}</div>`
  },
  radio: (e, s) => {
    const cur = txt(e.value, s).trim()
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const confirm = e.confirm !== undefined ? ` data-confirm="${h(e.confirm, s)}"` : ''
    const label = txt(e.label, s)
    const cols = Math.min(4, Math.max(1, Math.round(n(e.columns, s) ?? 1)))
    const opts = (Array.isArray(e.options) ? e.options : [])
      .filter(o => !obj(o) || !hidden(o, s))
      .slice(0, 12)
      .map(o => (obj(o) ? { v: txt(o.value ?? o.label, s).trim(), l: txt(o.label ?? o.value, s), t: txt(o.text, s), i: o.icon, b: txt(o.badge, s) } : { v: txt(o, s).trim(), l: txt(o, s), t: '', i: undefined, b: '' }))
      .filter(o => o.v)
    const card = (o: (typeof opts)[number], on: boolean) => `<button type="button" role="radio" aria-checked="${on}" class="k-ro${on ? ' on' : ''}" data-label="${esc(o.l)}"${on ? '' : run ? ` data-run="${esc(run)}" data-arg="${esc(o.v)}"${confirm}` : ' disabled'}>${o.i !== undefined ? icon(o.i, s, 14) : ''}<span class="k-main"><span class="k-ro-l"><span class="k-title">${esc(o.l)}</span>${o.b ? `<span class="k-badge">${esc(o.b)}</span>` : ''}</span>${o.t && !s.line ? `<span class="k-ro-t">${esc(o.t)}</span>` : ''}</span><i class="k-ro-d"></i></button>`
    return `<div${at(e, s, 'k-radio', cur)} role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''}>${label && !s.line ? `<div class="k-ro-h">${esc(label)}</div>` : ''}<div class="k-ro-g c-${cols}" style="--cols:${cols}">${opts.map(o => card(o, o.v === cur)).join('')}</div></div>`
  },
  // what's typed is the arg, or a do's prompt (uiBehave's data-input); ⌘ Enter sends
  textarea: (e, s) => {
    const run = e.run !== undefined ? txt(e.run, s) : ''
    const d = !run && ['new', 'send', 'ai'].includes(txt(e.do, s).trim()) ? doOf({ do: e.do, agent: e.agent, project: e.project }, s) : undefined
    const label = e.label !== undefined ? txt(e.label, s) : e.icon !== undefined ? '' : 'Send'
    const ph = txt(e.placeholder, s)
    if (s.line) return `<button type="button"${at({ tip: e.tip }, s, 'k-btn sm')} data-laki="full">${e.icon !== undefined ? icon(e.icon, s, 12) : ''}<span>${esc(ph || label)}</span></button>`
    const act = run ? ` data-run="${esc(run)}"` : d ? ` data-do="${esc(JSON.stringify(d))}"` : ''
    const rows = Math.min(12, Math.max(2, Math.round(n(e.rows, s) ?? 3)))
    return `<div${at(e, s, 'k-area')} data-inbox><textarea rows="${s.full ? rows : Math.min(rows, 2)}" placeholder="${esc(ph)}" aria-label="${esc(ph || label || 'Text')}"${act ? '' : ' disabled'}>${h(e.value, s)}</textarea><div class="k-area-f"><span class="k-sub">⌘ ⏎</span>${sendBtn(e, s, act, label, e.clear === false ? ' data-keep' : '')}</div></div>`
  },
  snippet: (e, s) => {
    const many = Array.isArray(e.items) || e.each !== undefined
    const tabs = (many ? itemsOf(e, s).map(([x, r]) => ({ l: txt(x.label, r), v: txt(x.value, r) })) : [{ l: txt(e.title, s), v: txt(e.value, s) }]).filter(t => t.l || t.v).slice(0, 8)
    if (!tabs.length) return empty(e, s, 0)
    const lines = (v: string) => (e.prompt === true ? v.split('\n').map(l => (l ? `<span class="k-snip-d">$</span>${esc(l)}` : '')).join('\n') : esc(v))
    const block = (v: string) => `<pre><code>${lines(v)}</code></pre>${e.copy !== false && v ? copyBtn(v) : ''}`
    if (s.line) return `<span${at({ tip: e.tip }, s, 'k-snip-l')}><code class="mono">${esc(tabs[0].v.split('\n')[0])}</code>${e.copy !== false && tabs[0].v ? copyBtn(tabs[0].v) : ''}</span>`
    if (!many) return `<div${at({ tip: e.tip }, s, 'k-snip')}>${tabs[0].l ? `<div class="k-snip-bar"><span class="k-snip-f">${iconSvg('file', 11)}<span>${esc(tabs[0].l)}</span></span></div>` : ''}<section class="k-snip-c">${block(tabs[0].v)}</section></div>`
    const name = `ks-${s.ids.uid}-${++s.ids.n}`
    return `<div${at({ tip: e.tip }, s, 'k-snip tabs')}><div class="k-snip-bar" role="tablist">${tabs.map((t, i) => `<label><input type="radio" name="${name}"${i ? '' : ' checked'}><span>${esc(t.l)}</span></label>`).join('')}</div>${tabs.map(t => `<section class="k-snip-c">${block(t.v)}</section>`).join('')}</div>`
  },
  env: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const all: string[] = []
    const list = rowsOf(e, s, 'k-env', 26, (r, item, _i, attrs) => {
      const key = txt(e.key ?? '{{key}}', r).trim()
      const v = txt(e.value ?? '{{value}}', r)
      all.push(`${key}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`)
      const hush = e.secret !== undefined ? holds(e.secret, r) : obj(item) && item.secret !== undefined ? truthy(item.secret) : SECRETS.test(key)
      const tag = e.tag !== undefined ? txt(e.tag, r).trim() : ''
      const shown = hush && v ? `<details class="k-sc"><summary title="Show it"><span class="k-sc-d mono">${'•'.repeat(8)}</span>${iconSvg('eye', 11)}</summary><code class="mono">${esc(v)}</code></details>` : `<code class="k-env-v mono">${esc(v)}</code>`
      return `<div class="k-env-r"${attrs}><code class="k-env-k mono">${esc(key)}</code>${shown}${tag ? `<span class="k-tag ${toneOf(e, tag, r) || (/^prod/i.test(tag) ? 't-accent' : '')}">${esc(tag)}</span>` : ''}${e.copy !== false && v ? copyBtn(v) : ''}</div>`
    })
    return `${list}${s.full && items.length ? `<div class="k-actions"><button type="button" class="k-btn sm quiet" data-copy="${esc(all.join('\n'))}">${iconSvg('copy', 11)}<span>Copy as .env</span></button></div>` : ''}`
  },
  uptime: (e, s) => {
    const items = listAt(e.each ?? e.items, s)
    const from = Math.max(0, items.length - 400)
    const rs = items.slice(from).map((item, i) => inner(s, item, from + i))
    const bar = rs
      .map(r => {
        const st = txt(e.state ?? '{{state}}', r).trim()
        const tip = [txt(e.x, r), st || 'no data', txt(e.text, r)].filter(Boolean).join(' · ')
        return `<i class="k-up-i ${st ? stateTone(e, st, r) : 'none'}" title="${esc(tip)}"></i>`
      })
      .join('')
    const title = txt(e.title, s)
    const value = txt(e.value, s)
    const legend = (e.legend ?? s.full) === true && rs.length > 1 && !s.line ? `<div class="k-up-x"><span>${esc(txt(e.x, rs[0]))}</span><span>${esc(txt(e.x, rs.at(-1)!))}</span></div>` : ''
    return rs.length ? `<div${at({ tip: e.tip }, s, 'k-up')}>${(title || value) && !s.line ? `<div class="k-up-h"><span>${esc(title)}</span><b>${esc(value)}</b></div>` : ''}<div class="k-up-b">${bar}</div>${s.line && value ? `<b>${esc(value)}</b>` : ''}${legend}</div>` : empty(e, s, 0)
  },
  deploys: (e, s) =>
    rowsOf(e, s, 'k-deploys', 36, (r, _item, _i, attrs) => {
      const state = txt(e.state ?? '{{state}}', r).trim()
      const k = DEPLOY.find(([re]) => re.test(state))?.[1] ?? 'muted'
      const branch = e.branch !== undefined ? txt(e.branch, r).trim() : ''
      const env = e.env !== undefined ? txt(e.env, r).trim() : ''
      const tm = e.time !== undefined ? txt(e.time, r).trim() : ''
      const took = e.took !== undefined ? txt(e.took, r).trim() : ''
      const t = timeOf(tm)
      const sub = [branch && `${iconSvg('gitBranch', 10)} ${esc(branch)}`, tm && esc(t !== undefined ? ago(t) : tm), took && esc(took)].filter(Boolean).join(' · ')
      return `<div class="k-dp"${attrs}${opens(txt(e.href ?? '{{url}}', r))}><i class="k-dp-dot ${toneOf(e, state, r) || `t-${k}`}${k === 'warn' ? ' live' : ''}" title="${esc(state || 'unknown')}"></i><div class="k-main"><span class="k-title">${h(e.title ?? '{{title}}', r)}</span>${sub ? `<span class="k-sub">${sub}</span>` : ''}</div>${env ? `<span class="k-tag${/^prod/i.test(env) ? ' t-accent' : ''}">${esc(env)}</span>` : ''}${e.author !== undefined ? avImg(txt(e.author, r).trim()) : ''}</div>`
    }),
  issues: (e, s) =>
    rowsOf(e, s, 'k-issues', 28, (r, _item, _i, attrs) => {
      const id = txt(e.id ?? '{{id}}', r).trim()
      const state = txt(e.state ?? '{{state}}', r).trim()
      const st = ISSUE.find(([re]) => re.test(state))?.[1] ?? 'todo'
      const pr = e.priority !== undefined ? txt(e.priority, r).trim().toLowerCase() : ''
      const labels = (e.labels !== undefined ? (v => (Array.isArray(v) ? v : []))(valueAt(e.labels, r.scopes)) : []).slice(0, 3)
      const tags = labels.map(l => (x => (x.name ? `<span class="k-tag"${x.c ? ` style="border-color:${x.c}"` : ''}>${x.c ? `<i class="k-dotc" style="background:${x.c}"></i>` : ''}${esc(x.name)}</span>` : ''))(obj(l) ? { name: String(l.name ?? l.label ?? ''), c: l.color !== undefined ? colorCss(String(l.color)) : '' } : { name: String(l ?? ''), c: '' })).join('')
      return `<div class="k-is"${attrs}${opens(txt(e.href ?? '{{url}}', r))}>${e.priority !== undefined ? `<span class="k-is-p" title="Priority: ${esc(pr || 'none')}">${priorityIcon(pr)}</span>` : ''}${id ? `<span class="k-is-id">${esc(id)}</span>` : ''}<span class="k-is-s ${st}" title="${esc(state || st)}">${ISSUE_ICON[st]}</span><span class="k-title">${h(e.title ?? '{{title}}', r)}</span>${tags ? `<span class="k-is-ls">${tags}</span>` : ''}${e.assignee !== undefined ? avImg(txt(e.assignee, r).trim()) : ''}</div>`
    }),
  endpoints: (e, s) =>
    rowsOf(e, s, 'k-eps', 28, (r, _item, _i, attrs) => {
      const m = txt(e.method ?? '{{method}}', r).trim().toUpperCase().slice(0, 7)
      const status = e.status !== undefined ? txt(e.status, r).trim() : ''
      const st = toneOf(e, status, r) || (/^2/.test(status) ? 't-good' : /^3/.test(status) ? 't-accent' : /^4/.test(status) ? 't-warn' : /^5/.test(status) ? 't-bad' : 't-muted')
      const path = esc(txt(e.path ?? '{{path}}', r).trim()).replace(/(:[A-Za-z_]\w*|\{[^}/]+\})/g, '<span class="k-ep-v">$1</span>') // its params lit
      const text = e.text !== undefined ? txt(e.text, r) : ''
      const side = (v: unknown) => (w => (w ? `<span class="k-ep-n">${esc(w)}</span>` : ''))(v !== undefined ? txt(v, r).trim() : '')
      return `<div class="k-ep"${attrs}${e.href !== undefined ? opens(txt(e.href, r)) : ''}><span class="k-ep-m" style="color:${colorCss(METHOD[m] ?? 'gray')}">${esc(m)}</span><div class="k-main"><code class="k-ep-p">${path}</code>${text ? `<span class="k-sub">${esc(text)}</span>` : ''}</div>${side(e.count)}${side(e.took)}${status ? `<span class="k-ep-s ${st}">${esc(status)}</span>` : ''}</div>`
    }),
  changelog: (e, s) => {
    const most = s.full ? 200 : 4
    return rowsOf(e, s, 'k-chl', 92, (r, _item, _i, attrs) => {
      const v = txt(e.version ?? '{{version}}', r).trim()
      const d = e.date !== undefined ? txt(e.date, r).trim() : ''
      const t = timeOf(d)
      const title = e.title !== undefined ? txt(e.title, r) : ''
      const all = (v => (Array.isArray(v) ? v : []))(valueAt(e.changes ?? 'changes', r.scopes)).map(changeOf).filter(c => c.text)
      const li = all.slice(0, most).map(c => `<li>${c.tag ? `<span class="k-chl-t t-${c.tone}">${esc(c.tag)}</span>` : ''}<span>${esc(c.text)}</span></li>`).join('')
      return `<div class="k-chl-r"${attrs}><div class="k-chl-h"><b>${e.href !== undefined ? link(txt(e.href, r), esc(v)) : esc(v)}</b>${title ? `<span class="k-sub">${esc(title)}</span>` : ''}${d ? `<span class="k-time"${t !== undefined ? ` title="${esc(new Date(t).toLocaleString())}"` : ''}>${esc(t !== undefined ? date(t) : d)}</span>` : ''}</div>${li && !s.line ? `<ul class="k-chl-l">${li}${all.length > most ? `<li class="k-sub">+${all.length - most} more</li>` : ''}</ul>` : ''}</div>`
    })
  },
  // its time as of the render, then uiBehave's tick (data-clock) keeps it right
  clock: (e, s) =>
    rowsOf(e, s, 'k-clocks', 30, (r, item, _i, attrs) => {
      const zone = txt(e.zone ?? '{{zone}}', r).trim()
      const h12 = e.hour12 === true
      const z = zoned(zone, h12)
      const label = (e.label !== undefined ? txt(e.label, r) : typeof item === 'string' ? item : txt('{{label}}', r)) || zone.split('/').pop()!.replace(/_/g, ' ') || 'Here'
      const sub = e.text !== undefined ? txt(e.text, r) : z ? z.from : 'no such time zone'
      return `<div class="k-clk"${attrs}${z ? '' : ' title="A time zone: Europe/Kyiv, America/New_York, UTC"'}><span class="k-clk-i ${z?.night ? 't-accent' : 't-warn'}">${iconSvg(z?.night ? 'moon' : 'sun', 13)}</span><div class="k-main"><span class="k-title">${esc(label)}</span>${sub ? `<span class="k-sub">${esc(sub)}</span>` : ''}</div><b class="k-clk-t"${z ? ` data-clock="${esc(zone)}"${h12 ? ' data-h12' : ''}` : ''}>${esc(z?.time ?? '–')}</b></div>`
    }),
  funnel: (e, s) => {
    const rs = listAt(e.each ?? e.items, s).map((item, i) => inner(s, item, i))
    const vals = rs.map(r => n(e.value ?? '{{value}}', r) ?? 0)
    const top = vals[0] || 0
    const unit = txt(e.unit, s)
    const c = hue(e.color, s)
    const max = cap(e, s, 22)
    const pct = (v: number, of: number) => (of > 0 ? Math.round((v / of) * 1000) / 10 : 0)
    if (s.line && rs.length > 1) return `<span${at({ tip: e.tip }, s, 'k-fn-line')}><b>${esc(`${num(top)}${unit}`)}</b> → <b>${esc(`${num(vals.at(-1))}${unit}`)}</b><span class="k-sub">${pct(vals.at(-1)!, top)}%</span></span>`
    const rows = rs
      .map((r, i) => {
        if (i >= max && !s.full) return ''
        const lost = i && vals[i - 1] > 0 ? Math.round((1 - vals[i] / vals[i - 1]) * 100) : 0
        return `<div class="k-fn-r" data-row${i >= max ? ' data-extra hidden' : ''}><span class="k-fn-l">${h(e.label ?? '{{label}}', r)}</span><span class="k-fn-t"><i style="width:${f1(Math.min(100, pct(vals[i], top)))}%${c ? `;background:${c}` : ''}"></i></span><b>${esc(`${num(vals[i])}${unit}`)}</b><span class="k-fn-p">${i ? `${pct(vals[i], top)}%` : ''}</span><span class="k-fn-d${lost > 0 ? ' t-bad' : ''}">${i && lost ? `${lost > 0 ? '−' : '+'}${Math.abs(lost)}%` : ''}</span></div>`
      })
      .join('')
    return `<div${at({ tip: e.tip }, s, 'k-funnel')} data-rows>${rows}${empty(e, s, rs.length)}${s.line ? '' : more(rs.length - Math.min(max, rs.length))}</div>`
  },
  swatches: (e, s) => {
    const items = listAt(e.each ?? e.items, s).slice(0, 200)
    const chips = items
      .map((item, i) => {
        const r = inner(s, item, i)
        const word = (e.color !== undefined ? txt(e.color, r) : typeof item === 'string' ? item : txt('{{color}}', r)).trim()
        const css = colorCss(word)
        if (!css) return ''
        const label = e.label !== undefined ? txt(e.label, r) : typeof item === 'string' ? '' : txt('{{name}}', r)
        const copy = e.copy !== undefined ? txt(e.copy, r) : word
        const text = e.text !== undefined ? txt(e.text, r) : label ? word : ''
        return `<button type="button" class="k-sw" data-copy="${esc(copy)}" title="Copy ${esc(copy)}"><i style="background:${css}"></i><span class="k-main"><span class="k-title">${esc(label || word)}</span>${text && !s.line ? `<span class="k-sub">${esc(text)}</span>` : ''}</span></button>`
      })
      .join('')
    return chips ? `<div${at({ tip: e.tip }, s, 'k-sws')}>${chips}</div>` : empty(e, s, 0)
  },
  matrix: (e, s) => {
    const rowK = (Array.isArray(e.rows) ? e.rows : []).map(x => txt(x, s))
    const colK = (Array.isArray(e.columns) ? e.columns : []).map(x => txt(x, s))
    const cells = new Map<string, { k: string; state: string; href: string }>()
    const count: Record<string, number> = {}
    listAt(e.each ?? e.items, s).forEach((item, i) => {
      const r = inner(s, item, i)
      const rk = txt(e.row ?? '{{row}}', r)
      const ck = txt(e.column ?? '{{column}}', r)
      if (!rowK.includes(rk)) rowK.push(rk)
      if (!colK.includes(ck)) colK.push(ck)
      const state = txt(e.state ?? '{{state}}', r).trim()
      const k = STEP.find(([re]) => re.test(state))?.[1] ?? 'todo'
      count[k] = (count[k] ?? 0) + 1
      cells.set(JSON.stringify([rk, ck]), { k, state, href: e.href !== undefined ? safeUrl(txt(e.href, r)) : '' })
    })
    if (!cells.size) return empty(e, s, 0)
    if (s.line) return `<span${at({ tip: e.tip }, s, 'k-mx-line')}>${['done', 'fail', 'now'].filter(k => count[k]).map(k => `<span class="${MX[k][1]}">${MX[k][0]}${count[k]}</span>`).join('')}</span>`
    const max = cap(e, s, 24) - 1 // its head a row too
    const cell = (rk: string, ck: string) => (c => (c ? `<td class="${MX[c.k][1]}"${c.href ? ` data-open="${esc(c.href)}"` : ''} title="${esc(`${rk} · ${ck}: ${c.state || 'to do'}`)}">${MX[c.k][0]}</td>` : '<td></td>'))(cells.get(JSON.stringify([rk, ck])))
    return `<div${at({ tip: e.tip }, s, 'k-mx')} data-rows><table><thead><tr><th></th>${colK.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rowK.map((rk, i) => (i >= max && !s.full ? '' : `<tr data-row${i >= max ? ' data-extra hidden' : ''}><th>${esc(rk)}</th>${colK.map(ck => cell(rk, ck)).join('')}</tr>`)).join('')}</tbody></table>${more(rowK.length - Math.min(Math.max(1, max), rowK.length))}</div>`
  },
  marquee: (e, s) => {
    const sec = Math.min(300, Math.max(2, n(e.seconds, s) ?? 20))
    // drawn once per copy: ids and radio names of its own (a snippet's tabs, a popover's)
    const one = () =>
      e.children !== undefined
        ? kids(e.children, s)
        : itemsOf(e, s)
            .slice(0, 60)
            .map(([x, r]) => {
              const label = x === e ? (e.label !== undefined ? txt(e.label, r) : (t => (typeof t === 'string' ? t : txt('{{label}}', r)))(r.scopes[0].this)) : txt(x.label ?? x.tag, r)
              const body = `${x.icon !== undefined ? icon(x.icon, r, 13) : ''}${label ? `<span>${esc(label)}</span>` : ''}`
              return body ? link(x.href !== undefined ? txt(x.href, r) : '', body, `k-mq-i ${toneOf(x === e ? e : { tone: x.tone ?? e.tone }, label, r)}`.trim()) : ''
            })
            .join('')
    // two copies, the second inert, so a lap ends where it began
    return `<div${at({ tip: e.tip }, s, `k-mq${e.reverse === true ? ' rev' : ''}`)} style="--s:${sec}s"><div class="k-mq-t"><div class="k-mq-g">${one()}</div><div class="k-mq-g" aria-hidden="true" inert>${one()}</div></div></div>`
  },
  bento: (e, s) => {
    const cols = Math.min(6, Math.max(2, Math.round(n(e.columns, s) ?? 4)))
    const tile = (x: El) => {
      const w = Math.min(cols, Math.max(1, Math.round(n(x.cols, s) ?? 1)))
      const tall = Math.min(3, Math.max(1, Math.round(n(x.rows, s) ?? 1)))
      const c = hue(x.color, s)
      const href = x.href !== undefined ? safeUrl(txt(x.href, s)) : ''
      return `<div class="k-bt w-${w}${href ? ' link' : ''}" style="grid-column:span ${w};grid-row:span ${tall}${c ? `;--bt:${c}` : ''}"${href ? ` data-open="${esc(href)}"` : ''}>${x.icon !== undefined ? `<span class="k-bt-i">${icon(x.icon, s, 16)}</span>` : ''}${x.title !== undefined ? `<b class="k-bt-t">${h(x.title, s)}</b>` : ''}${x.text !== undefined ? `<span class="k-bt-x">${h(x.text, s)}</span>` : ''}${kids(x.children, s)}</div>`
    }
    return `<div${at(e, s, `k-bento c-${cols}`)} style="--cols:${cols}">${(Array.isArray(e.items) ? e.items : []).filter((x): x is El => obj(x) && !hidden(x, s)).slice(0, 24).map(tile).join('')}</div>`
  },
  empty: (e, s) => `<div${at(e, s, 'k-empty')}>${e.icon !== undefined ? icon(e.icon, s, 18) : ''}<div>${h(e.text ?? 'Nothing here', s)}</div>${e.action !== undefined ? button(e.action, s, true) : ''}</div>`,
}

// a widget's ui as HTML for its preview or full view, over its context ({ data, config, at, error, full, sample,
// workspace }, the same names as a template's: {{open}} as {{data.open}}); cells: where it shows (across, down; ½ down: a
// bar's line); hide: what the user hid (no refresh buttons; no at, nor what names it). A failed fetch with no data: the
// error and Retry, instead of the tree
export function uiHtml(spec: unknown, ctx: Record<string, unknown>, o: { full?: boolean; cells?: [number, number]; hide?: { refresh?: boolean; at?: boolean } } = {}) {
  const tree = uiTree(spec, !!o.full)
  if (!tree) return ''
  const data = ctx.data
  const top = { ...(obj(data) ? data : {}), ...ctx, full: !!o.full, ...(o.hide?.at && { at: undefined }) }
  const cells: [number, number] = o.cells && o.cells.length === 2 ? [Number(o.cells[0]) || 1, Number(o.cells[1]) || 1] : o.full ? [3, 4] : [1, 1]
  const line = !o.full && cells[1] <= 0.5
  const s: S = { scopes: [top], full: !!o.full, single: isElement(spec), cells, line, ids: { uid: Math.random().toString(36).slice(2, 7), n: 0 }, hide: o.hide }
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

// the names Laki puts beside the data's own at its top: a field of the data's named so is hidden behind Laki's
export const RESERVED = ['at', 'error', 'config', 'full', 'data', 'workspace', 'sample']
export const reservedIn = (data: unknown): UiProblem[] => (obj(data) ? RESERVED.filter(k => Object.hasOwn(data, k)).map(k => ({ level: 'warn' as const, where: 'data', text: `"${k}" is Laki's: rename it or read it as data.${k}` })) : [])
export function uiCheck(spec: unknown, data?: unknown, o: { actions?: string[] } = {}): UiProblem[] {
  const out: UiProblem[] = reservedIn(data)
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
  const noIcon = (v: unknown) => `icon ${v} isn't one of Laki's icons${mean(String(v), Object.keys(ICON_WORDS))} or an emoji`
  const colorOk = (v: unknown) => typeof v !== 'string' || v.includes('{{') || !!colorCss(v)
  const NEEDS: Record<string, string> = { new: 'prompt', send: 'prompt', ai: 'prompt', terminal: 'command', browse: 'url' }
  const runs = (b: unknown, where: string, self = false) => {
    if (!obj(b)) return
    if (typeof b.run === 'string' && !b.run.includes('{{') && o.actions && !o.actions.includes(b.run)) say('error', where, `runs ${b.run}, which isn't one of widget.json's actions${mean(b.run, o.actions)}`)
    if (!self && b.icon !== undefined && !iconOk(b.icon)) say('warn', where, noIcon(b.icon)) // an element's own: its props' check says it
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
      else if (pr.kind === 'icon' && !iconOk(v)) say('warn', here, noIcon(v))
    }
    for (const c of [el.color, el.ring, ...(Array.isArray(el.colors) ? el.colors : []), ...(Array.isArray(el.series) ? el.series.map(x => (obj(x) ? x.color : undefined)) : [])]) if (!colorOk(c)) say('warn', here, `color ${c}: a tone (${TONES.join(', ')}), one of ${COLORS.join(', ')}, or a hex${mean(String(c), [...TONES, ...COLORS])}`)
    if (['button', 'toggle', 'segmented', 'stepper', 'range', 'select', 'input', 'swap', 'pagination', 'menu', 'command', 'combobox', 'datepicker', 'split', 'radio'].includes(type)) runs(el, here, true)
    if (type === 'textarea') runs({ ...el, prompt: '', ...(typeof el.do === 'string' && !['new', 'send', 'ai'].includes(el.do) && { do: undefined }) }, here, true) // what's typed is its prompt; a wrong do: its kind says it
    if ((type === 'menu' || type === 'command') && Array.isArray(el.items)) el.items.forEach((b, i) => runs(b, `${here}.items[${i}]`))
    if (type === 'swap' && Array.isArray(el.icons)) for (const v of el.icons) if (!iconOk(v)) say('warn', here, noIcon(v))
    if (type === 'form') runs(el.submit, `${here}.submit`)
    for (const k of ['action', 'submit']) if (obj(el[k]) && type !== 'form') runs(el[k], `${here}.${k}`)
    for (const k of ['actions', 'items'] as const) if (UI[type as UiType].props[k as never] && (UI[type as UiType].props as Record<string, Prop>)[k].kind === 'buttons') (Array.isArray(el[k]) ? (el[k] as unknown[]) : []).forEach((b, i) => runs(b, `${here}.${k}[${i}]`))
    if (type === 'table' && Array.isArray(el.columns))
      el.columns.forEach((c, i) => {
        if (!obj(c)) return
        if (c.icon !== undefined && !iconOk(c.icon)) say('warn', `${here}.columns[${i}]`, noIcon(c.icon))
        if (!colorOk(c.color)) say('warn', `${here}.columns[${i}]`, `color ${c.color}: a tone (${TONES.join(', ')}), one of ${COLORS.join(', ')}, or a hex`)
        if (c.actions !== undefined && !Array.isArray(c.actions)) say('error', `${here}.columns[${i}]`, 'actions: a list of buttons')
        ;(Array.isArray(c.actions) ? c.actions : []).forEach((b, j) => runs(b, `${here}.columns[${i}].actions[${j}]`))
      })
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
          const skip = new Set(['each', 'items', 'empty', 'limit', 'filter', 'sort', 'kind', 'height', 'min', 'max', 'label', 'unit', 'if', 'unless', 'tip', 'series', 'colors', 'legend', 'rows', 'count', 'nested', 'open', 'wrap', 'placeholder', 'seconds', ...(type === 'board' || type === 'matrix' ? ['columns'] : []), ...(type === 'log' ? ['value'] : []), ...(type === 'meter' ? ['title'] : []), ...(type === 'uptime' ? ['title', 'value'] : [])])
          if (['meter', 'tree', 'steps', 'breadcrumbs', 'links', 'menu', 'command', 'marquee', 'snippet', 'clock', 'funnel', 'swatches'].includes(type)) skip.delete('label') // a row's name there, not a title
          if (type === 'endpoints') skip.delete('count') // a row's calls
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
    if (Array.isArray(el.children)) el.children.forEach((c, i) => walk(c, `${here}.children[${i}]`, rowScopes)) // with each: over its row (an accordion's panel)
    if (type === 'accordion' && Array.isArray(el.items)) el.items.forEach((t, i) => obj(t) && (Array.isArray(t.children) ? t.children.forEach((c, j) => walk(c, `${here}.items[${i}].children[${j}]`, scopes)) : t.children !== undefined && say('error', `${here}.items[${i}]`, 'children: a list of elements')))
    if (type === 'bento' && Array.isArray(el.items)) el.items.forEach((t, i) => obj(t) && (Array.isArray(t.children) ? t.children.forEach((c, j) => walk(c, `${here}.items[${i}].children[${j}]`, scopes)) : t.children !== undefined && say('error', `${here}.items[${i}]`, 'children: a list of elements')))
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
// ninety days of a status page: mostly up, a slow day or two, one outage
const UP = Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 20 + i)).toISOString().slice(0, 10), state: i === 61 ? 'down' : i % 23 === 7 || i === 84 ? 'degraded' : i === 3 ? '' : 'up' }))
const SAMPLES: Record<UiType, { spec: UiElement; data?: unknown }> = {
  stack: { spec: { type: 'stack', gap: 'sm', children: [{ type: 'text', value: '{{repo}}', weight: 'semibold' }, { type: 'text', value: '{{open}} open · {{drafts}} drafts', muted: true }] }, data: { repo: 'acme/web', open: 6, drafts: 1 } },
  row: { spec: { type: 'row', align: 'between', children: [{ type: 'text', value: 'Deploys today' }, { type: 'badge', value: '{{n}}', tone: 'good' }] }, data: { n: 4 } },
  grid: { spec: { type: 'grid', columns: 3, children: [{ type: 'stat', value: '{{open}}', label: 'open' }, { type: 'stat', value: '{{failing}}', label: 'failing', tone: 'bad' }, { type: 'stat', value: '{{merged}}', label: 'merged', tone: 'good' }] }, data: { open: 6, failing: 1, merged: 12 } },
  section: { spec: { type: 'section', title: 'Releases', subtitle: '{{releases.length}}', collapsed: false, children: [{ type: 'tags', each: 'releases', tag: '{{this}}' }] }, data: { releases: ['v2.4.0', 'v2.3.2', 'v2.3.1'] } },
  accordion: { spec: { type: 'accordion', each: 'faq', title: '{{q}}', badge: '{{#if new}}new{{/if}}', text: '{{a}}' }, data: { faq: [{ q: 'How do I deploy?', a: 'Merge to main: CI ships it to staging, then Promote sends it on to production.' }, { q: 'Who is on call?', a: 'Mona Lisa this week, Hubot the next.', new: true }, { q: 'Where are the logs?', a: 'In Grafana, under acme/web: one board per service.' }] } },
  tabs: { spec: { type: 'tabs', tabs: [{ label: 'Mine', badge: '{{mine.length}}', children: [{ type: 'list', each: 'mine', title: '{{title}}' }] }, { label: 'Team', badge: '{{team.length}}', children: [{ type: 'list', each: 'team', title: '{{title}}' }] }] }, data: { mine: [{ title: 'Fix the date picker' }], team: [{ title: 'Retry webhooks' }, { title: 'Spike: exports' }] } },
  header: { spec: { type: 'header', icon: 'github', title: '{{repo}}', subtitle: '{{open}} open pull requests', href: 'https://github.com/{{repo}}', actions: [{ icon: 'refresh', label: 'Refresh', refresh: true, style: 'quiet' }] }, data: { repo: 'acme/web', open: 6 } },
  footer: { spec: { type: 'stack', children: [{ type: 'text', value: '{{open}} open, {{failing}} failing' }, { type: 'footer', text: 'Updated {{ago updated}}', actions: [{ label: 'GitHub', icon: 'github', open: 'https://github.com/{{repo}}', style: 'quiet' }] }] }, data: { repo: 'acme/web', open: 6, failing: 1, updated: '2026-10-17T09:00:00Z' } },
  toolbar: { spec: { type: 'toolbar', align: 'end', items: [{ icon: 'refresh', label: 'Refresh', refresh: true }, { icon: 'github', label: 'Open on GitHub', open: 'https://github.com/{{repo}}' }, { icon: 'copy', label: 'Copy the repo', copy: '{{repo}}' }, { icon: 'ai', label: 'Ask Laki AI about it', do: 'ai', prompt: 'What needs my review in {{repo}}?' }] }, data: { repo: 'acme/web' } },
  spacer: { spec: { type: 'row', children: [{ type: 'text', value: 'Deploys today: {{n}}' }, { type: 'spacer' }, { type: 'button', label: 'Deploy', icon: 'ship', run: 'deploy', style: 'primary' }] }, data: { n: 4 } },
  divider: { spec: { type: 'stack', children: [{ type: 'text', value: 'Above' }, { type: 'divider' }, { type: 'text', value: 'Below', muted: true }] } },
  text: { spec: { type: 'text', value: 'Last deploy {{ago when}} by {{who}}', size: 'md', tone: { failed: 'bad' } }, data: { when: '2026-10-17T09:00:00Z', who: 'octocat' } },
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
  kv: { spec: { type: 'kv', items: [{ key: 'Branch', value: '{{branch}}', mono: true, copy: true }, { key: 'Status', value: '{{status}}', tone: { live: 'good', down: 'bad' } }, { key: 'Updated', value: '{{ago when}}' }] }, data: { branch: 'feat/search', status: 'live', when: '2026-10-17T08:00:00Z' } },
  list: {
    spec: { type: 'list', each: 'prs', title: '#{{number}} {{title}}', subtitle: '{{author}} · {{ago updated}}', avatar: '{{author}}', href: '{{url}}', group: 'state', filter: true, accessories: [{ tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }], actions: [{ label: 'Review', run: 'review', arg: '{{url}}' }], empty: 'No open PRs' },
    data: { prs: PRS },
  },
  table: {
    spec: { type: 'table', each: 'prs', sort: 'number desc', filter: true, columns: [{ title: 'PR', value: '#{{number}} {{title}}', subtitle: '{{author}}', avatar: '{{author}}', href: '{{url}}' }, { title: 'Review', progress: '{{approvals}}', max: 2, value: '{{approvals}}/2', hide: 'narrow' }, { title: 'CI', tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }, { title: 'Updated', value: '{{ago updated}}', align: 'right', hide: 'narrow' }] },
    data: { prs: PRS.map((x, i) => ({ ...x, approvals: [0, 2, 1][i] })) },
  },
  chart: { spec: { type: 'chart', kind: 'area', each: 'days', x: '{{day}}', y: '{{ms}}', unit: ' ms', label: 'p95 latency' }, data: { days: [{ day: 'Mon', ms: 320 }, { day: 'Tue', ms: 280 }, { day: 'Wed', ms: 410 }, { day: 'Thu', ms: 300 }, { day: 'Fri', ms: 260 }] } },
  spark: { spec: { type: 'spark', values: 'cpu', tone: 'accent' }, data: { cpu: [12, 30, 22, 48, 35, 60, 41] } },
  progress: { spec: { type: 'progress', value: '{{done}}', max: '{{total}}', label: 'Sprint 42' }, data: { done: 18, total: 25 } },
  loading: { spec: { type: 'stack', children: [{ type: 'loading', label: 'Deploying {{version}}…' }, { type: 'loading', style: 'dots', label: 'Waiting for CI', color: 'orange' }, { type: 'loading', style: 'bar', label: 'Indexing the repo' }] }, data: { version: 'v2.4.0' } },
  gauge: { spec: { type: 'gauge', value: '{{cpu}}', unit: '%', label: 'CPU', color: 'teal' }, data: { cpu: 72 } },
  heatmap: { spec: { type: 'heatmap', each: 'days', x: '{{date}}', value: '{{n}}', color: 'green' }, data: { days: DAYS } },
  status: { spec: { type: 'status', each: 'services', label: '{{name}}', state: '{{state}}', text: '{{note}}' }, data: { services: [{ name: 'API', state: 'up', note: '99.98%' }, { name: 'Web', state: 'up', note: '99.95%' }, { name: 'Workers', state: 'degraded', note: 'queue 2k' }, { name: 'Search', state: 'down', note: 'since 09:10' }] } },
  checklist: { spec: { type: 'checklist', each: 'steps', text: '{{text}}', done: 'done' }, data: { steps: [{ text: 'Write the migration', done: true }, { text: 'Backfill orders', done: true }, { text: 'Switch reads over', done: false }, { text: 'Drop the old table', done: false }] } },
  avatars: { spec: { type: 'avatars', each: 'reviewers', login: '{{this}}', max: 4 }, data: { reviewers: ['octocat', 'hubot', 'monalisa', 'defunkt', 'mojombo', 'pjhyett'] } },
  tags: { spec: { type: 'tags', each: 'labels', tag: '{{name}}', color: '{{color}}' }, data: { labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'feature', color: '0e8a16' }, { name: 'docs', color: '0075ca' }] } },
  badge: { spec: { type: 'badge', value: '{{failing}} failing', tone: 'bad', if: 'failing' }, data: { failing: 2 } },
  timeline: { spec: { type: 'timeline', each: 'events', time: '{{at}}', title: '{{what}}', text: '{{who}}', tone: { 'Deploy failed': 'bad', Deployed: 'good' } }, data: { events: [{ at: '2026-10-17T09:10:00Z', what: 'Deployed', who: 'v2.4.0 by octocat' }, { at: '2026-10-17T08:40:00Z', what: 'Deploy failed', who: 'v2.4.0-rc1' }, { at: '2026-10-16T17:00:00Z', what: 'Merged #418', who: 'hubot' }] } },
  card: { spec: { type: 'card', each: 'posts', title: '{{title}}', text: '{{blurb}}', icon: '{{icon}}', tag: '{{tag}}', href: '{{url}}', tone: { new: 'accent' } }, data: { posts: [{ title: 'Search, 30% faster', blurb: 'How we cut p95 by moving to the new index.', icon: '⚡', tag: 'new', url: 'https://example.com/blog/search' }, { title: 'Dark mode', blurb: 'The dashboard follows your system now.', icon: '🌙', tag: 'ui', url: 'https://example.com/blog/dark' }] } },
  gallery: { spec: { type: 'gallery', each: 'repos', src: 'https://opengraph.githubassets.com/laki/{{name}}', caption: '{{name}}', href: 'https://github.com/{{name}}' }, data: { repos: [{ name: 'microsoft/vscode' }, { name: 'vercel/next.js' }, { name: 'electron/electron' }, { name: 'vitejs/vite' }] } },
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
  breadcrumbs: { spec: { type: 'breadcrumbs', items: [{ label: 'acme', icon: 'github', href: 'https://github.com/acme' }, { label: 'web', href: 'https://github.com/acme/web' }, { label: 'src', href: 'https://github.com/acme/web/tree/main/src' }, { label: '{{file}}' }] }, data: { file: 'search.ts' } },
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
  hero: { spec: { type: 'hero', icon: 'rocket', title: 'v{{version}} is out', text: 'Faster search, dark mode for the dashboard and {{fixes}} fixes.', color: 'purple', actions: [{ label: 'Release notes', icon: 'externalLink', style: 'primary', open: 'https://github.com/acme/web/releases/tag/v{{version}}' }, { label: 'Refresh', refresh: true, style: 'quiet' }] }, data: { version: '2.4.0', fixes: 12 } },
  mockup: { spec: { type: 'mockup', kind: 'terminal', value: '{{out}}' }, data: { out: '$ npm test\n✓ 128 passed (4.2s)\n$ npm run deploy\nDeployed v2.4.0 to production' } },
  filter: { spec: { type: 'filter', options: ['failing', 'passing', 'pending'], children: [{ type: 'list', each: 'prs', title: '#{{number}} {{title}}', subtitle: '{{author}}', accessories: [{ tag: '{{ci}}', tone: { failing: 'bad', passing: 'good', pending: 'warn' } }] }] }, data: { prs: PRS } },
  rotate: { spec: { type: 'rotate', prefix: 'Now', items: ['building', 'testing', 'shipping'], suffix: '{{repo}}', size: 'lg', color: 'blue' }, data: { repo: 'acme/web' } },
  compare: { spec: { type: 'compare', before: 'https://picsum.photos/id/1018/800/450?grayscale', after: 'https://picsum.photos/id/1018/800/450', labels: ['Before', 'After'] } },
  skeleton: { spec: { type: 'skeleton', avatar: true, lines: 3, label: 'Loading the PRs' } },
  radial: { spec: { type: 'row', align: 'between', children: [{ type: 'radial', value: '{{coverage}}', label: 'Coverage', color: 'green' }, { type: 'radial', value: '{{used}}', max: '{{quota}}', text: '{{used}} GB', label: 'Storage', color: 'orange' }, { type: 'radial', value: 3, max: 10, text: '3/10', label: 'Seats', size: 'sm' }] }, data: { coverage: 82, used: 41, quota: 50 } },
  indicator: { spec: { type: 'row', gap: 'lg', children: [{ type: 'indicator', icon: 'inbox', badge: '{{unread}}', tip: 'Unread' }, { type: 'indicator', avatar: 'octocat', badge: '{{reviews}}', tone: 'warn', tip: 'Reviews waiting' }, { type: 'indicator', label: 'Deploys', dot: 'live', color: 'green' }] }, data: { unread: 12, reviews: 2, live: true } },
  avatar: { spec: { type: 'row', gap: 'lg', children: [{ type: 'avatar', login: 'octocat', size: 'lg', shape: 'squircle', ring: 'green', state: 'online', label: 'The Octocat', text: 'On call' }, { type: 'avatar', login: 'monalisa', shape: 'hexagon' }, { type: 'avatar', name: 'Ada Byron', shape: 'diamond', state: 'away' }] } },
  range: { spec: { type: 'range', label: 'Rollout', value: '{{rollout}}', unit: '%', step: 5, run: 'rollout', color: 'teal' }, data: { rollout: 25 } },
  select: { spec: { type: 'select', label: 'Region', value: '{{region}}', options: [{ value: 'us-east-1', label: 'US East' }, { value: 'eu-west-1', label: 'Europe' }, { value: 'ap-south-1', label: 'Asia' }], run: 'region', confirm: 'Move the deploys to another region?' }, data: { region: 'eu-west-1' } },
  input: { spec: { type: 'input', placeholder: 'Add a to-do…', run: 'add' } },
  swap: { spec: { type: 'row', children: [{ type: 'swap', icons: ['bellOff', 'bell'], labels: ['Watch', 'Watching'], on: 'watching', run: 'watch', color: 'blue' }, { type: 'swap', icons: ['heart', 'heart'], on: 'liked', run: 'like', color: 'red', tip: 'Like' }] }, data: { watching: true, liked: false } },
  pagination: { spec: { type: 'pagination', page: '{{page}}', pages: '{{pages}}', run: 'page' }, data: { page: 6, pages: 20 } },
  menu: { spec: { type: 'menu', items: [{ title: 'Go to' }, { label: 'Board', icon: 'board', open: 'laki://board', on: true }, { label: 'Settings', icon: 'settings', open: 'laki://settings' }, { title: '{{repo}}' }, { label: 'Pull requests', icon: 'pr', badge: '{{prs}}', open: 'https://github.com/{{repo}}/pulls' }, { label: 'Deploy main', icon: 'ship', run: 'deploy', confirm: 'Deploy main to production?' }] }, data: { repo: 'acme/web', prs: 6 } },
  dropdown: { spec: { type: 'row', align: 'between', children: [{ type: 'text', value: '{{env}}', weight: 'semibold' }, { type: 'dropdown', label: 'More', align: 'end', items: [{ label: 'Redeploy', icon: 'refresh', run: 'redeploy', confirm: 'Redeploy {{env}}?' }, { label: 'Logs', icon: 'fileText', open: 'https://dash.example.com/{{env}}/logs' }, { label: 'Roll back', icon: 'undo', run: 'rollback', tone: 'bad', confirm: 'Roll back {{env}}?' }] }] }, data: { env: 'production' } },
  marquee: { spec: { type: 'marquee', each: 'shipped', label: '{{title}}', icon: '{{icon}}', seconds: 24 }, data: { shipped: [{ title: 'v2.4.0 is live', icon: '🚀' }, { title: 'Search, 30% faster', icon: 'zap' }, { title: 'Dark mode for the dashboard', icon: 'moon' }, { title: '#418 merged', icon: 'gitMerge' }, { title: '12 bugs fixed', icon: 'bug' }] } },
  bento: { spec: { type: 'bento', items: [{ title: '{{num visits}} visits', text: 'today, {{change}} on last week', icon: 'barChart', color: 'blue', cols: 2, rows: 2, children: [{ type: 'spark', values: 'week' }] }, { title: '{{deploys}} deploys', icon: 'ship', color: 'green' }, { title: '{{errors}} errors', icon: 'ciFail', color: 'red', href: 'https://sentry.io' }, { title: 'p95 {{p95}} ms', text: 'checkout is the slowest', icon: 'clock', color: 'orange', cols: 2 }] }, data: { visits: 12840, change: '+12%', week: [8, 9, 7, 11, 10, 12, 13], deploys: 4, errors: 3, p95: 260 } },
  snippet: { spec: { type: 'snippet', prompt: true, items: [{ label: 'npm', value: 'npm i @acme/sdk' }, { label: 'pnpm', value: 'pnpm add @acme/sdk' }, { label: 'yarn', value: 'yarn add @acme/sdk' }, { label: 'bun', value: 'bun add @acme/sdk' }] } },
  env: { spec: { type: 'env', each: 'vars', tag: '{{env}}' }, data: { vars: [{ key: 'DATABASE_URL', value: 'postgres://app:hunter2@db.internal:5432/app', env: 'production' }, { key: 'API_BASE', value: 'https://api.acme.com', env: 'production' }, { key: 'STRIPE_SECRET_KEY', value: 'sk_test_51Hx9kQ2eZvKYlo2C0aBcDeF', env: 'preview' }, { key: 'LOG_LEVEL', value: 'info', env: 'preview' }] } },
  uptime: { spec: { type: 'uptime', each: 'days', x: '{{date}}', state: '{{state}}', title: 'API · 90 days', value: '{{uptime}}' }, data: { uptime: '99.94%', days: UP } },
  deploys: { spec: { type: 'deploys', each: 'deploys', branch: '{{branch}}', env: '{{env}}', time: '{{at}}', took: '{{took}}', author: '{{who}}' }, data: { deploys: [{ state: 'building', title: 'Faster search on the orders page', branch: 'feat/search', env: 'preview', at: '2026-10-17T09:58:00Z', took: '40s', who: 'hubot', url: 'https://vercel.com/acme/web' }, { state: 'ready', title: 'Fix the date picker on Safari', branch: 'main', env: 'production', at: '2026-10-17T08:50:00Z', took: '1m 12s', who: 'octocat', url: 'https://vercel.com/acme/web' }, { state: 'error', title: 'Bump the API client to 3.2', branch: 'deps/api', env: 'preview', at: '2026-10-16T16:20:00Z', took: '28s', who: 'monalisa', url: 'https://vercel.com/acme/web' }] } },
  issues: { spec: { type: 'issues', each: 'issues', priority: '{{priority}}', labels: 'labels', assignee: '{{who}}' }, data: { issues: [{ id: 'ACME-142', title: 'Login loops on Safari', state: 'In Progress', priority: 'urgent', labels: [{ name: 'bug', color: 'd73a4a' }], who: 'octocat', url: 'https://linear.app/acme/issue/ACME-142' }, { id: 'ACME-139', title: 'Export orders as CSV', state: 'Todo', priority: 'medium', labels: ['feature'], who: 'hubot', url: 'https://linear.app/acme/issue/ACME-139' }, { id: 'ACME-131', title: 'Dark mode for emails', state: 'In Review', priority: 'low', labels: [], who: 'monalisa', url: 'https://linear.app/acme/issue/ACME-131' }, { id: 'ACME-120', title: 'Faster search', state: 'Done', priority: 'high', labels: ['perf'], who: 'hubot', url: 'https://linear.app/acme/issue/ACME-120' }, { id: 'ACME-118', title: 'Keep the old checkout', state: 'Canceled', priority: 'none', labels: [], who: '', url: 'https://linear.app/acme/issue/ACME-118' }] } },
  endpoints: { spec: { type: 'endpoints', each: 'routes', status: '{{status}}', took: '{{ms}} ms', count: '{{rpm}}/min' }, data: { routes: [{ method: 'GET', path: '/api/orders', status: 200, ms: 41, rpm: '1.2k' }, { method: 'POST', path: '/api/checkout', status: 500, ms: 812, rpm: 84 }, { method: 'GET', path: '/api/orders/:id', status: 200, ms: 23, rpm: 640 }, { method: 'PATCH', path: '/api/users/{id}', status: 422, ms: 57, rpm: 12 }, { method: 'DELETE', path: '/api/sessions/:token', status: 204, ms: 9, rpm: 30 }] } },
  changelog: { spec: { type: 'changelog', each: 'releases', date: '{{date}}', title: '{{name}}', href: 'https://github.com/acme/web/releases/tag/{{version}}' }, data: { releases: [{ version: 'v2.4.0', name: 'Search', date: '2026-10-17', changes: ['feat: search, 30% faster', 'feat(ui): dark mode for the dashboard', 'fix: the date picker on Safari', 'perf: a smaller bundle, 182 KB'] }, { version: 'v2.3.2', name: '', date: '2026-10-09', changes: ['fix: a crash on an empty cart', 'feat!: the v1 API is gone'] }] } },
  clock: { spec: { type: 'clock', items: [{ label: 'Kyiv', zone: 'Europe/Kyiv' }, { label: 'New York', zone: 'America/New_York' }, { label: 'San Francisco', zone: 'America/Los_Angeles' }, { label: 'Tokyo', zone: 'Asia/Tokyo' }] } },
  funnel: { spec: { type: 'funnel', each: 'steps', label: '{{step}}', value: '{{n}}' }, data: { steps: [{ step: 'Visited', n: 12840 }, { step: 'Signed up', n: 2140 }, { step: 'Made a project', n: 1310 }, { step: 'Invited a teammate', n: 480 }, { step: 'Paid', n: 212 }] } },
  swatches: { spec: { type: 'swatches', each: 'tokens', color: '{{hex}}', label: '{{name}}', text: '--{{name}}' }, data: { tokens: [{ name: 'accent', hex: '#7aa2f7' }, { name: 'done', hex: '#9ece6a' }, { name: 'waiting', hex: '#e0af68' }, { name: 'error', hex: '#f7768e' }, { name: 'purple', hex: '#bb9af7' }, { name: 'muted', hex: '#7a8294' }] } },
  matrix: { spec: { type: 'matrix', each: 'jobs', row: 'Node {{node}}', column: '{{os}}', state: '{{state}}', href: '{{url}}' }, data: { jobs: [18, 20, 22].flatMap(node => ['ubuntu', 'macos', 'windows'].map(os => ({ node, os, state: node === 22 && os === 'windows' ? 'failed' : node === 22 && os === 'macos' ? 'running' : node === 18 && os === 'windows' ? 'skipped' : 'passed', url: 'https://github.com/acme/web/actions/runs/4120' }))) } },
  popover: { spec: { type: 'row', align: 'between', children: [{ type: 'text', value: '{{service}}', weight: 'semibold' }, { type: 'popover', label: 'Details', icon: 'info', align: 'end', title: '{{service}}', text: 'Deployed {{ago deployed}} by {{who}}', children: [{ type: 'kv', items: [{ key: 'Version', value: '{{version}}', mono: true }, { key: 'Region', value: '{{region}}' }] }, { type: 'button', label: 'Open the logs', icon: 'fileText', open: 'https://dash.example.com/{{service}}/logs', style: 'quiet' }] }] }, data: { service: 'checkout', deployed: '2026-10-17T09:00:00Z', who: 'octocat', version: 'v2.4.0', region: 'eu-west-1' } },
  command: { spec: { type: 'command', placeholder: 'Search or run a command…', items: [{ title: 'Go to' }, { label: 'Board', icon: 'board', open: 'laki://board' }, { label: 'Settings', icon: 'settings', keys: '⌘ ,', open: 'laki://settings' }, { title: '{{repo}}' }, { label: 'Pull requests', icon: 'pr', badge: '{{prs}}', open: 'https://github.com/{{repo}}/pulls' }, { label: 'Deploy main', icon: 'ship', run: 'deploy', confirm: 'Deploy main to production?' }, { label: 'Run the tests', icon: 'terminal', do: 'terminal', command: 'npm test' }, { label: 'Ask Laki AI', icon: 'ai', keys: '⌘ J', do: 'ai', prompt: 'What needs my review in {{repo}}?' }] }, data: { repo: 'acme/web', prs: 6 } },
  combobox: { spec: { type: 'combobox', placeholder: 'A branch…', options: 'branches', label: 'Check out', icon: 'gitBranch', run: 'checkout' }, data: { branches: ['main', 'feat/search', 'fix/safari-dates', 'deps/api-3.2'] } },
  datepicker: { spec: { type: 'datepicker', label: 'Release on', value: '{{release}}', run: 'release', confirm: 'Move the release to another day?' }, data: { release: '2026-10-24' } },
  split: { spec: { type: 'split', label: 'Squash and merge', icon: 'gitMerge', style: 'primary', run: 'merge', arg: 'squash', confirm: 'Squash and merge #{{pr}}?', items: [{ label: 'Create a merge commit', run: 'merge', arg: 'merge' }, { label: 'Rebase and merge', run: 'merge', arg: 'rebase' }, { label: 'Close the PR', icon: 'x', run: 'close', tone: 'bad', confirm: 'Close #{{pr}}?' }] }, data: { pr: 412 } },
  radio: { spec: { type: 'radio', label: 'Merge with', value: '{{how}}', run: 'strategy', options: [{ value: 'squash', label: 'Squash', text: 'One commit on main per PR', icon: 'gitCommit', badge: 'default' }, { value: 'merge', label: 'Merge commit', text: 'Every commit, and a merge', icon: 'gitMerge' }, { value: 'rebase', label: 'Rebase', text: 'Every commit, replayed on main', icon: 'gitBranch' }] }, data: { how: 'squash' } },
  textarea: { spec: { type: 'textarea', placeholder: 'Ask the agent to…', do: 'send', label: 'Send', icon: 'agent' } },
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
  { title: 'A deploy', blurb: 'A header, the pipeline’s steps, its log’s last lines and a switch for the next ones.', spec: { type: 'stack', children: [{ type: 'header', icon: 'ship', title: 'Deploy {{version}}', subtitle: 'to production · started {{ago started}}' }, { type: 'steps', each: 'stages', label: '{{name}}', state: '{{state}}' }, { type: 'log', each: 'lines', text: '{{text}}', time: '{{at}}', level: '{{level}}', limit: 3 }, { type: 'toggle', label: 'Ship merges at once', on: 'auto', run: 'auto' }] }, data: { version: 'v2.4.0', started: '2026-10-17T09:08:00Z', auto: true, stages: [{ name: 'Build', state: 'done' }, { name: 'Test', state: 'done' }, { name: 'Deploy', state: 'running' }, { name: 'Smoke', state: 'todo' }], lines: LOG } },
  { title: 'Gauges in a grid', blurb: 'A few dials side by side, each its color.', spec: { type: 'grid', columns: 3, children: [{ type: 'gauge', value: '{{cpu}}', unit: '%', label: 'CPU', color: 'teal' }, { type: 'gauge', value: '{{mem}}', unit: '%', label: 'Memory', color: 'purple' }, { type: 'gauge', value: '{{disk}}', unit: '%', label: 'Disk', color: '{{#if diskFull}}bad{{else}}blue{{/if}}' }] }, data: { cpu: 42, mem: 68, disk: 91, diskFull: true } },
  { title: 'A table with pictures and bars', full: true, blurb: 'Columns of more than words: a picture with a name and a line under it, a bar of how far along, a sparkline, a badge, a button.', spec: { type: 'table', each: 'team', columns: [{ title: 'Who', avatar: '{{login}}', value: '{{name}}', subtitle: '{{role}}' }, { title: 'Sprint', progress: '{{done}}', max: '{{total}}', value: '{{done}}/{{total}}', color: '{{#if late}}bad{{else}}accent{{/if}}' }, { title: 'This week', spark: 'week', hide: 'narrow' }, { title: 'State', badge: '{{state}}', tone: { busy: 'warn', away: 'muted', free: 'good' } }, { title: '', align: 'right', actions: [{ label: 'Profile', icon: 'github', open: 'https://github.com/{{login}}', style: 'quiet' }], hide: 'narrow' }] }, data: { team: [{ name: 'Mona Lisa', login: 'monalisa', role: 'Frontend', done: 8, total: 10, week: [2, 3, 1, 4, 3], state: 'busy' }, { name: 'Hubot', login: 'hubot', role: 'Backend', done: 3, total: 9, late: true, week: [1, 0, 2, 1, 0], state: 'free' }, { name: 'The Octocat', login: 'octocat', role: 'Design', done: 5, total: 6, week: [0, 2, 2, 3, 4], state: 'away' }] } },
  { title: 'Rows with progress', blurb: 'A list whose rows end in a small bar: projects, uploads, migrations.', spec: { type: 'list', each: 'projects', title: '{{name}}', subtitle: '{{owner}}', icon: 'folder', accessories: [{ progress: '{{pct}}', tone: '{{#if stuck}}bad{{/if}}' }] }, data: { projects: [{ name: 'Checkout v2', owner: 'Payments', pct: 82 }, { name: 'Search index', owner: 'Platform', pct: 45 }, { name: 'Mobile app', owner: 'Apps', pct: 12, stuck: true }] } },
  { title: 'Folding panels with elements', full: true, blurb: 'An accordion whose panels hold other elements: a release’s notes, its checks, its numbers.', spec: { type: 'accordion', items: [{ title: '{{version}}', subtitle: 'shipped {{ago shipped}}', icon: 'ship', badge: 'new', children: [{ type: 'markdown', value: '{{notes}}' }] }, { title: 'Checks', icon: 'check', badge: '{{checks.length}}', children: [{ type: 'status', each: 'checks', label: '{{name}}', state: '{{state}}' }] }, { title: 'Numbers', icon: 'barChart', children: [{ type: 'progress', value: '{{tests}}', max: '{{testsAll}}', label: 'Tests passing' }, { type: 'kv', items: [{ key: 'Bundle', value: '{{bundle}}' }, { key: 'p95', value: '{{p95}}' }] }] }] }, data: { version: 'v2.4.0', shipped: '2026-10-17T09:00:00Z', notes: '- Search, **30% faster**\n- Dark mode for the dashboard', checks: [{ name: 'Build', state: 'passed' }, { name: 'E2E', state: 'passed' }, { name: 'Lighthouse', state: 'degraded' }], tests: 412, testsAll: 420, bundle: '182 KB', p95: '260 ms' } },
  { title: 'A developer dashboard', full: true, blurb: 'Bento tiles holding other elements: uptime, deploys, the CI matrix and a number.', spec: { type: 'bento', columns: 4, items: [{ title: 'API', text: '{{uptime}} up, 30 days', icon: 'activity', color: 'green', cols: 2, children: [{ type: 'uptime', each: 'days', state: '{{state}}', x: '{{day}}' }] }, { title: '{{errors}} errors today', icon: 'ciFail', color: 'red', href: 'https://sentry.io', children: [{ type: 'spark', values: 'errorsWeek', color: 'red' }] }, { title: 'p95 {{p95}} ms', icon: 'clock', color: 'orange' }, { title: 'Deploys', icon: 'ship', cols: 2, rows: 2, children: [{ type: 'deploys', each: 'deploys', limit: 3, branch: '{{branch}}', env: '{{env}}', time: '{{at}}', author: '{{by}}' }] }, { title: 'CI on main', icon: 'gitBranch', cols: 2, rows: 2, children: [{ type: 'matrix', each: 'jobs' }] }] }, data: { uptime: '99.94%', days: Array.from({ length: 30 }, (_, i) => ({ day: `Oct ${i + 1}`, state: i === 11 ? 'degraded' : 'up' })), errors: 3, errorsWeek: [9, 4, 6, 2, 5, 1, 3], p95: 260, deploys: [{ state: 'building', title: 'Faster search', branch: 'feat/search', env: 'preview', at: '2026-10-17T09:58:00Z', by: 'hubot' }, { state: 'ready', title: 'Fix Safari dates', branch: 'main', env: 'production', at: '2026-10-17T08:12:00Z', by: 'octocat' }, { state: 'error', title: 'API client 3.2', branch: 'deps/api', env: 'preview', at: '2026-10-16T17:40:00Z', by: 'octocat' }], jobs: [{ row: 'Node 20', column: 'ubuntu', state: 'passed' }, { row: 'Node 20', column: 'macos', state: 'passed' }, { row: 'Node 22', column: 'ubuntu', state: 'running' }, { row: 'Node 22', column: 'macos', state: 'failure' }] } },
  { title: 'Ship a release', full: true, blurb: 'A split button to publish it, what changed as conventional commits and how to install it.', spec: { type: 'stack', children: [{ type: 'row', align: 'between', children: [{ type: 'heading', value: '{{version}}', level: 2 }, { type: 'split', label: 'Publish', icon: 'ship', style: 'primary', run: 'publish', confirm: 'Publish {{version}}?', items: [{ label: 'As a pre-release', run: 'publish', arg: 'pre' }, { label: 'As a draft', run: 'publish', arg: 'draft' }] }] }, { type: 'changelog', each: 'releases', date: '{{date}}' }, { type: 'snippet', prompt: true, items: [{ label: 'npm', value: 'npm i @acme/sdk@{{version}}' }, { label: 'pnpm', value: 'pnpm add @acme/sdk@{{version}}' }] }] }, data: { version: 'v2.4.0', releases: [{ version: 'v2.4.0', date: '2026-10-17', changes: ['feat(search): 30% faster', 'feat: dark mode for the dashboard', 'fix(dates): the picker on Safari', 'perf: a smaller bundle'] }, { version: 'v2.3.2', date: '2026-10-09', changes: ['fix: a crash on an empty cart', 'feat(api)!: the v1 API is gone'] }] } },
]
