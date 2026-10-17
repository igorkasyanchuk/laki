// widget.json in one table (MANIFEST): from it the JSON Schema (WIDGET_SCHEMA, written to docs/widget.schema.json by
// scripts/widget-schema.ts; editors autocomplete and validate a widget.json that names it in "$schema"), laki.d.ts
// (LAKI_DTS: window.laki and the UI kit's elements, for a JS page), and manifestCheck, the checker's widget.json part
// (widgetCheck in daemon/widgets.ts adds the files, the ui against data, the fixtures and a fetch). The ui elements'
// words are the UI kit's own (widgetUi.ts UI), so the schema, the types, the guide and the gallery say the same.
import { REPO, WIDGET_PLACES } from './types.ts'
import { BUTTON, COMMON, type Kind, near, type Prop, UI, UI_TYPES, type UiProblem } from './widgetUi.ts'

export const WIDGET_SCHEMA_URL = `${REPO.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/docs/widget.schema.json`
export const SIZES_ACROSS = [1, 2, 3]
export const SIZES_DOWN = [0.5, 1, 2, 3, 4]
export const VIEWS = ['s', 'm', 'l']
export const SPEC_TYPES = ['text', 'number', 'bool', 'choice', 'list']

type J = Record<string, unknown> // a schema
const str = (description: string, more: J = {}): J => ({ type: 'string', description, ...more })
const SPEC: J = {
  description: 'A setting: its default (text; a number, true/false or a list make that kind), or a spec',
  anyOf: [
    { type: ['string', 'number', 'boolean'] },
    { type: 'array', items: { type: 'string' } },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { enum: SPEC_TYPES, description: 'text, number, bool (a switch), choice (one of choices) or list (chips)' },
        label: str('Its name in Settings'),
        hint: str('A line under it'),
        default: { description: 'Its value until set' },
        choices: { type: 'array', items: { type: 'string' }, description: "A choice's options" },
      },
    },
  ],
}
const PLACE = { enum: WIDGET_PLACES, description: 'side (the sidebar), top or status (a bar, a line high), rail or foot (a button), desk (the Desk)' }

// every key widget.json takes, read by daemon/widgets.ts (test/widget-check.test.ts holds the two in step)
export const MANIFEST: Record<string, J> = {
  $schema: str('This schema, for your editor'),
  name: str('Its name'),
  description: str('A line about it, in Settings'),
  size: { type: 'array', items: [{ enum: SIZES_ACROSS }, { enum: SIZES_DOWN }], minItems: 2, maxItems: 2, description: 'Cells across (1-3) and down (½, 1-4) in the sidebar; across in a bar' },
  every: { type: 'integer', minimum: 1, maximum: 1440, description: 'Minutes between fetches (5 by default)' },
  view: { enum: VIEWS, description: 'Its full view’s size: s, m (the default) or l' },
  place: { anyOf: [PLACE, { type: 'array', items: PLACE }], description: 'Where it shows at first (the user’s choice wins): one place or several' },
  fetch: str('A shell command in its folder; what it prints (JSON) is its data. $WIDGET_<NAME> per setting, $LAKI_WIDGET_CONFIG, $LAKI_REFRESH_REASON'),
  script: str('Or a JS file of its folder: its default export gets { config, last } and returns the data'),
  config: { type: 'object', additionalProperties: SPEC, description: 'Its settings, by name (a letter or _, then letters, digits, _)' },
  actions: { type: 'object', additionalProperties: { type: 'string' }, description: 'Commands its buttons run by name, with $WIDGET_ARG; what one prints as JSON may say { "toast" } or { "modal" }' },
  icon: str('As a button: an icon of Laki’s by name, or an emoji'),
  label: str('As a button: its words, a template over its data'),
  badge: str('As a button: a short count, a template ("{{#if n}}{{n}}{{/if}}")'),
  tip: str('Its tooltip, a template'),
  click: str('One of its actions, run on a click on its button'),
  sample: { description: 'Made-up data in the shape its fetch prints, for its preview before it runs (needed with a fetch)' },
  sampleConfig: { type: 'object', description: 'Settings to show the sample with' },
  ui: { description: 'What it draws with the UI kit (Settings › Extensions › UI kit, laki widget kit): one element, or { "preview", "full" }', allOf: [{ $ref: '#/definitions/ui' }] },
}

// a prop's kind as a schema; a template ({{…}}) is text wherever a word or a number goes
const KIND_SCHEMA: Record<string, J> = {
  text: { type: ['string', 'number', 'boolean'] },
  icon: { type: 'string' },
  number: { type: ['number', 'string'] },
  bool: { type: 'boolean' },
  path: { type: ['string', 'array'] },
  children: { type: 'array', items: { $ref: '#/definitions/element' } },
  button: { $ref: '#/definitions/button' },
  buttons: { type: 'array', items: { $ref: '#/definitions/button' } },
  tone: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }] },
  items: { type: 'array' },
  object: { type: 'object' },
}
const kindSchema = (k: Kind, description: string): J => (Array.isArray(k) ? { anyOf: [{ enum: k }, { type: 'string', pattern: '\\{\\{' }], description } : { ...KIND_SCHEMA[k as string], description })
const propsSchema = (props: Record<string, Prop>) => Object.fromEntries(Object.entries(props).map(([n, p]) => [n, kindSchema(p.kind, p.desc)]))

export const WIDGET_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: WIDGET_SCHEMA_URL,
  title: 'Laki extension (widget.json)',
  description: 'A Laki extension: what it fetches, how often, where it shows and what it draws (ui). https://github.com/igorkasyanchuk/laki/blob/main/docs/extensions.md',
  type: 'object',
  additionalProperties: false,
  properties: MANIFEST,
  definitions: {
    ui: { description: 'What it draws with the UI kit: one element (the preview and the full view), or { "preview", "full" }', anyOf: [{ $ref: '#/definitions/element' }, { type: 'object', additionalProperties: false, properties: { preview: { $ref: '#/definitions/element' }, full: { $ref: '#/definitions/element' } } }] },
    button: { type: 'object', description: 'A button: one of run (+ arg), open, refresh, full or copy', properties: propsSchema({ ...COMMON, ...BUTTON }) },
    element: { oneOf: UI_TYPES.map(t => ({ $ref: `#/definitions/${t}` })) },
    ...Object.fromEntries(UI_TYPES.map(t => [t, { type: 'object', description: `${t}: ${UI[t].blurb}`, required: ['type'], properties: { type: { const: t }, ...propsSchema({ ...COMMON, ...UI[t].props }) } }])),
  },
}

// laki.d.ts: window.laki for a JS page (widget.html with a <script>), and the UI kit's elements as types
const tsOf = (k: Kind): string =>
  Array.isArray(k) ? k.map(w => JSON.stringify(w)).join(' | ') : ({ text: 'Text', icon: 'string', number: 'number | string', bool: 'boolean', path: 'string | unknown[]', children: 'UiElement[]', button: 'UiButton', buttons: 'UiButton[]', tone: 'Tone | string | Record<string, Tone>', items: 'any[]', object: 'Record<string, unknown>' } as Record<string, string>)[k as string]
const fields = (props: Record<string, Prop>, pad = '  ') => Object.entries(props).map(([n, p]) => `${pad}/** ${p.desc} */\n${pad}${n}?: ${tsOf(p.kind)}`).join('\n')
export const LAKI_DTS = `// Laki extensions: window.laki in a JS page (widget.html with a <script>), and the UI kit's elements (widget.json's
// "ui"). Made by Laki (laki widget new --kind panel); docs: ${REPO}/blob/main/docs/extensions.md
type Text = string | number | boolean // a template: {{field}}, {{ago at}}, {{#if x}}…{{/if}}
type Tone = 'good' | 'bad' | 'warn' | 'accent' | 'muted'
interface UiCommon {
${fields(COMMON)}
}
interface UiButton extends UiCommon {
${fields(BUTTON)}
}
${UI_TYPES.map(t => `/** ${UI[t].blurb} */\ninterface Ui_${t} extends UiCommon {\n  type: '${t}'\n${fields(UI[t].props)}\n}`).join('\n')}
type UiElement = ${UI_TYPES.map(t => `Ui_${t}`).join(' | ')}
type UiSpec = UiElement | { preview?: UiElement; full?: UiElement }
type LakiModal = { title: string; text?: string; buttons?: { label: string; run?: string; arg?: string; open?: string }[] }
interface Laki {
  /** what its fetch printed last */
  data: any
  /** its settings, typed: a bool true or false, a number, a list an array */
  config: Record<string, unknown>
  /** when it fetched last (ms) */
  at?: number
  /** why the last fetch failed */
  error?: string
  /** true in its full view */
  full: boolean
  /** fetch again */
  refresh(): void
  /** open a link in the browser: http(s), mailto, laki:// */
  open(url: string): void
  /** its full view */
  expand(): void
  /** one of widget.json's actions, its arg as $WIDGET_ARG */
  run(action: string, arg?: string): void
  toast(text: string): void
  modal(m: LakiModal): void
  /** the UI kit's HTML for an element, filled from data (else the page's) */
  ui(spec: UiSpec, data?: unknown): Promise<string>
  /** the UI kit's element put in el, its buttons, links, filters and tabs working */
  mount(el: Element, spec: UiSpec, data?: unknown): Promise<void>
}
declare const laki: Laki
interface Window {
  laki: Laki
}
`

// the checker's widget.json part: unknown keys (did you mean), kinds, places, sizes, every, view, settings, click,
// fetch or script. A one-file extension's (from its comment lines) too
const kindOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
export function manifestCheck(m: Record<string, unknown>): UiProblem[] {
  const out: UiProblem[] = []
  const say = (level: UiProblem['level'], where: string, text: string) => out.push({ level, where, text })
  const keys = Object.keys(MANIFEST)
  for (const k of Object.keys(m)) if (!keys.includes(k)) say('warn', 'widget.json', `no key ${k}${(n => (n ? ` (did you mean ${n}?)` : ''))(near(k, keys))}`)
  for (const k of ['name', 'description', 'fetch', 'script', 'icon', 'label', 'badge', 'tip', 'click'])
    if (m[k] !== undefined && typeof m[k] !== 'string') say('error', `widget.json ${k}`, `text, not ${kindOf(m[k])}`)
  if (m.size !== undefined && !(Array.isArray(m.size) && m.size.length === 2 && SIZES_ACROSS.includes(Number(m.size[0])) && SIZES_DOWN.includes(Number(m.size[1]))))
    say('error', 'widget.json size', `[across, down]: across 1-3, down ½ (0.5) or 1-4, not ${JSON.stringify(m.size)}`)
  if (m.every !== undefined && !(Number.isInteger(m.every) && (m.every as number) >= 1 && (m.every as number) <= 1440)) say('error', 'widget.json every', `minutes, 1 to 1440, not ${JSON.stringify(m.every)}`)
  if (m.view !== undefined && !VIEWS.includes(m.view as string)) say('error', 'widget.json view', `s, m or l, not ${JSON.stringify(m.view)}`)
  for (const p of m.place === undefined ? [] : Array.isArray(m.place) ? m.place : [m.place])
    if (!(WIDGET_PLACES as readonly string[]).includes(p as string)) say('error', 'widget.json place', `${JSON.stringify(p)} isn't a place: ${WIDGET_PLACES.join(', ')}${(n => (n ? ` (did you mean ${n}?)` : ''))(near(String(p), WIDGET_PLACES))}`)
  if (m.fetch && m.script) say('error', 'widget.json', 'fetch or script, not both')
  if ((m.fetch || m.script) && m.sample === undefined) say('warn', 'widget.json', 'no sample: its preview has nothing to show before it runs')
  const actions = m.actions && typeof m.actions === 'object' && !Array.isArray(m.actions) ? (m.actions as Record<string, unknown>) : undefined
  if (m.actions !== undefined && !actions) say('error', 'widget.json actions', 'an object: { "name": "a command" }')
  for (const [n, c] of Object.entries(actions ?? {})) if (typeof c !== 'string') say('error', `widget.json actions.${n}`, `a command (text), not ${kindOf(c)}`)
  if (typeof m.click === 'string' && !Object.hasOwn(actions ?? {}, m.click)) say('error', 'widget.json click', `${m.click} isn't one of its actions${(n => (n ? ` (did you mean ${n}?)` : ''))(near(m.click, Object.keys(actions ?? {})))}`)
  const config = m.config
  if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) say('error', 'widget.json config', 'an object: { "name": a default or a spec }')
  else
    for (const [n, v] of Object.entries((config ?? {}) as Record<string, unknown>)) {
      const where = `widget.json config.${n}`
      if (!KEY.test(n)) say('error', where, 'a name: a letter or _, then letters, digits or _ (it becomes $WIDGET_' + n.toUpperCase() + ')')
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      const s = v as Record<string, unknown>
      for (const k of Object.keys(s)) if (!['type', 'label', 'hint', 'default', 'choices'].includes(k)) say('warn', where, `no key ${k}${(x => (x ? ` (did you mean ${x}?)` : ''))(near(k, ['type', 'label', 'hint', 'default', 'choices']))}`)
      if (s.type !== undefined && !SPEC_TYPES.includes(s.type as string)) say('error', where, `type ${JSON.stringify(s.type)}: one of ${SPEC_TYPES.join(', ')}`)
      if (s.type === 'choice' && !(Array.isArray(s.choices) && s.choices.length)) say('error', where, 'a choice needs choices: ["a", "b"]')
      if (s.type === 'choice' && Array.isArray(s.choices) && s.default !== undefined && !s.choices.map(String).includes(String(s.default))) say('warn', where, `default ${JSON.stringify(s.default)} isn't one of its choices`)
    }
  if (m.sampleConfig !== undefined && (typeof m.sampleConfig !== 'object' || m.sampleConfig === null || Array.isArray(m.sampleConfig))) say('error', 'widget.json sampleConfig', 'an object of settings')
  return out
}
