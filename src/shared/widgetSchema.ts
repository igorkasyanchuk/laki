// widget.json in one table (MANIFEST): from it the JSON Schema (WIDGET_SCHEMA, written to docs/widget.schema.json by
// scripts/widget-schema.ts; editors autocomplete and validate a widget.json that names it in "$schema"), laki.d.ts
// (LAKI_DTS: window.laki and the UI kit's elements, for a JS page), and manifestCheck, the checker's widget.json part
// (widgetCheck in daemon/widgets.ts adds the files, the ui against data, the fixtures and a fetch). The ui elements'
// words are the UI kit's own (widgetUi.ts UI), so the schema, the types, the guide and the gallery say the same.
import { REPO, WIDGET_EVENTS, WIDGET_PLACES } from './types.ts'
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
// an action's tool: its fields' types, how it asks (toolOf, below)
export const TOOL_TYPES = ['string', 'number', 'boolean', 'string[]'] as const
export const TOOL_ASKS = ['always', 'first', 'never'] as const
export const MANIFEST: Record<string, J> = {
  $schema: str('This schema, for your editor'),
  name: str('Its name'),
  description: str('A line about it, in Settings'),
  size: { type: 'array', items: [{ enum: SIZES_ACROSS }, { enum: SIZES_DOWN }], minItems: 2, maxItems: 2, description: 'Cells across (1-3) and down (½, 1-4) in the sidebar; across in a bar' },
  every: { type: 'integer', minimum: 1, maximum: 1440, description: 'Minutes between fetches (5 by default)' },
  view: { enum: VIEWS, description: 'Its full view’s size: s, m (the default) or l' },
  place: { anyOf: [PLACE, { type: 'array', items: PLACE }], description: 'Where it shows at first (the user’s choice wins): one place or several' },
  scope: { enum: ['global', 'workspace'], description: 'global (the default): one for the app; workspace: one per workspace, its fetch given $LAKI_BRANCH, $PORT, $LAKI_PATH… and its ui {{workspace.branch}}' },
  on: { type: 'object', propertyNames: { enum: [...WIDGET_EVENTS] }, additionalProperties: { type: 'string' }, description: 'Events it answers: { "turn.done": "one of its actions" | "refresh" }; the handler gets the event as JSON on stdin and in $LAKI_EVENT_FILE, its name as $LAKI_EVENT' },
  stream: { type: 'boolean', description: 'Its fetch runs all along: each line of JSON it prints is its data (every is ignored; global only)' },
  fetch: str('A shell command in its folder; what it prints (JSON) is its data. $WIDGET_<NAME> per setting, $LAKI_WIDGET_CONFIG, $LAKI_REFRESH_REASON'),
  script: str('Or a JS file of its folder: its default export gets { config, last, workspace } and returns the data'),
  config: { type: 'object', additionalProperties: SPEC, description: 'Its settings, by name (a letter or _, then letters, digits, _)' },
  actions: {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['run'],
          properties: {
            run: str('The command'),
            tool: {
              type: 'object',
              additionalProperties: false,
              description: 'Agents may call it as a tool (laki widget tool, MCP, Laki AI)',
              properties: {
                description: str('What it does, for the agent'),
                input: { type: 'object', additionalProperties: { anyOf: [{ enum: TOOL_TYPES }, { type: 'object', properties: { type: { enum: TOOL_TYPES }, description: { type: 'string' }, enum: { type: 'array' } }, required: ['type'] }] }, description: 'Its fields: a type (string, number, boolean, string[]) or { type, description, enum }; each as $WIDGET_INPUT_<NAME>, all as $WIDGET_ARG (JSON)' },
                required: { type: 'array', items: { type: 'string' }, description: 'The fields it needs' },
                ask: { enum: TOOL_ASKS, description: 'first (the default): asked once per workspace; always: every call; never' },
              },
            },
          },
        },
      ],
    },
    description: 'Commands its buttons run by name, with $WIDGET_ARG: a command, or { "run", "tool" } (agents may call it); what one prints as JSON may say { "toast" }, { "modal" } or { "data" }',
  },
  icon: str('As a button: an icon of Laki’s by name, or an emoji'),
  label: str('As a button: its words, a template over its data'),
  badge: str('As a button: a short count, a template ("{{#if n}}{{n}}{{/if}}")'),
  tip: str('Its tooltip, a template'),
  click: str('One of its actions, run on a click on its button'),
  source: {
    type: 'object',
    additionalProperties: false,
    required: ['kind'],
    properties: { kind: { enum: ['fetch', 'static', 'file', 'url'], description: 'fetch: its own fetch or script; static: the text below; file: a file read each time (JSON, else { "text" }); url: an http(s) page read each time' }, text: str('With static: JSON, or words (its data: { "text" })'), path: str('With file: its path (~ is home; relative: the extension’s folder; {{config.x}}, {{workspace.path}})'), url: str('With url: the address ({{config.x}} too)') },
    description: 'Where its data comes from at first: the user picks another on its card (Its fetch, Static, File, URL)',
  },
  sample: { description: 'Made-up data in the shape its data takes, for its preview before it runs (needed with a fetch, a script, a file or a URL)' },
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

// what has data to show before it runs: a fetch, a script, a file or a URL (a text typed in is its own)
export const needsSample = (m: Record<string, unknown>) => !!(m.fetch || m.script) || ['file', 'url'].includes(String((m.source as { kind?: unknown } | undefined)?.kind))
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
  /** a Laki command (the app shows what and asks first): a new workspace whose agent starts on prompt, a prompt to the workspace's agent or to Laki AI, a command in a new terminal, a page in a Laki browser tab */
  do(cmd: { do: 'new' | 'send' | 'ai' | 'terminal' | 'browse'; prompt?: string; command?: string; url?: string; agent?: string; project?: string }, label?: string): void
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
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// a command that reaches past this Mac: a tool that never asks gets check's warning
const OUTWARD = /\bgit\s+push\b|\bgh\s+(pr|release|issue|api)\b|\bcurl\b[^|;&]*-X\s*(POST|PUT|PATCH|DELETE)|\bdeploy|\bnpm\s+publish\b|\bkubectl\s+(apply|delete)\b/i
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
  if (m.scope !== undefined && m.scope !== 'global' && m.scope !== 'workspace') say('error', 'widget.json scope', `global or workspace, not ${JSON.stringify(m.scope)}`)
  if (needsSample(m) && m.sample === undefined) say('warn', 'widget.json', 'no sample: its preview has nothing to show before it runs')
  if (m.source !== undefined) {
    const src = m.source as Record<string, unknown> | null
    if (!src || typeof src !== 'object' || !['fetch', 'static', 'file', 'url'].includes(String(src.kind))) say('error', 'widget.json source', '{ "kind": "fetch" | "static" | "file" | "url", "text" | "path" | "url" }')
    else if (src.kind === 'fetch' && !m.fetch && !m.script) say('error', 'widget.json source', 'fetch: but no fetch nor script')
    else if (src.kind === 'url' && typeof src.url === 'string' && !/^https?:\/\//i.test(src.url) && !src.url.includes('{{')) say('error', 'widget.json source', 'url: http or https')
    else if (src.kind === 'static' && (typeof (src.text ?? '') !== 'string' || String(src.text ?? '').length > 64 << 10)) say('error', 'widget.json source', 'static: a text, 64 KB at most')
  }
  if (m.stream !== undefined && typeof m.stream !== 'boolean') say('error', 'widget.json stream', `true or false, not ${kindOf(m.stream)}`)
  if (m.stream === true && m.scope === 'workspace') say('error', 'widget.json stream', 'a stream is global only: not with "scope": "workspace"') // ponytail: one process per workspace
  if (m.stream === true && !(m.fetch || m.script)) say('error', 'widget.json stream', 'a stream needs a fetch or a script that runs all along')
  if (m.stream === true && m.every !== undefined) say('warn', 'widget.json every', 'ignored: a stream runs all along')
  const actions = m.actions && typeof m.actions === 'object' && !Array.isArray(m.actions) ? (m.actions as Record<string, unknown>) : undefined
  if (m.actions !== undefined && !actions) say('error', 'widget.json actions', 'an object: { "name": "a command" }')
  for (const [n, c] of Object.entries(actions ?? {})) {
    if (typeof c === 'string') continue
    const where = `widget.json actions.${n}`
    if (!isObj(c) || typeof c.run !== 'string') {
      say('error', where, `a command (text), or { "run": a command, "tool": … }, not ${isObj(c) ? 'an object without run' : kindOf(c)}`)
      continue
    }
    for (const k of Object.keys(c)) if (!['run', 'tool'].includes(k)) say('warn', where, `no key ${k}${(x => (x ? ` (did you mean ${x}?)` : ''))(near(k, ['run', 'tool']))}`)
    if (c.tool === undefined) continue
    const t = c.tool
    if (!isObj(t)) {
      say('error', `${where}.tool`, 'an object: { "description", "input", "required", "ask" }')
      continue
    }
    for (const k of Object.keys(t)) if (!['description', 'input', 'required', 'ask'].includes(k)) say('warn', `${where}.tool`, `no key ${k}${(x => (x ? ` (did you mean ${x}?)` : ''))(near(k, ['description', 'input', 'required', 'ask']))}`)
    if (typeof t.description !== 'string' || !t.description.trim()) say('error', `${where}.tool`, 'a description: what it does, for the agent')
    if (t.input !== undefined && !isObj(t.input)) say('error', `${where}.tool.input`, 'an object: { "name": a type or { "type", "description", "enum" } }')
    for (const [f, v] of Object.entries(isObj(t.input) ? t.input : {})) {
      const type = typeof v === 'string' ? v : isObj(v) ? v.type : v
      if (!KEY.test(f)) say('error', `${where}.tool.input.${f}`, `a name: a letter or _, then letters, digits or _ (it becomes $WIDGET_INPUT_${f.toUpperCase()})`)
      if (!(TOOL_TYPES as readonly unknown[]).includes(type)) say('error', `${where}.tool.input.${f}`, `string, number, boolean or string[], not ${JSON.stringify(type)}`)
      if (isObj(v) && v.enum !== undefined && !(Array.isArray(v.enum) && v.enum.length)) say('error', `${where}.tool.input.${f}`, 'enum: a list of the values it takes')
    }
    if (t.required !== undefined && !(Array.isArray(t.required) && t.required.every(r => typeof r === 'string'))) say('error', `${where}.tool.required`, 'a list of its input’s names')
    else for (const r of (t.required ?? []) as string[]) if (!isObj(t.input) || !Object.hasOwn(t.input, r)) say('error', `${where}.tool.required`, `${r} isn't one of its input`)
    if (t.ask !== undefined && !(TOOL_ASKS as readonly unknown[]).includes(t.ask)) say('error', `${where}.tool.ask`, `always, first or never, not ${JSON.stringify(t.ask)}`)
    if (t.ask === 'never' && OUTWARD.test(c.run)) say('warn', `${where}.tool`, 'ask never, but its command looks outward (a push, a PR, a POST, a deploy): "ask": "first"?')
  }
  const on = m.on
  if (on !== undefined && (!on || typeof on !== 'object' || Array.isArray(on))) say('error', 'widget.json on', 'an object: { "turn.done": "an action" or "refresh" }')
  else
    for (const [e, h] of Object.entries((on ?? {}) as Record<string, unknown>)) {
      const where = `widget.json on.${e}`
      if (!(WIDGET_EVENTS as readonly string[]).includes(e)) say('error', where, `no event ${e}${(n => (n ? ` (did you mean ${n}?)` : `: ${WIDGET_EVENTS.join(', ')}`))(near(e, WIDGET_EVENTS))}`)
      if (h === 'refresh') !(m.fetch || m.script) && say('error', where, 'refresh: it has no fetch or script')
      else if (typeof h !== 'string' || !Object.hasOwn(actions ?? {}, h)) say('error', where, `refresh, or one of its actions${(n => (n ? ` (did you mean ${n}?)` : ''))(near(String(h), Object.keys(actions ?? {})))}`)
    }
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

// ---------- an action's tool (agents call it: laki widget tool, MCP, Laki AI). Its input: a type per field (string,
// number, boolean, string[]) or { type, description, enum }; required; ask: always, first (the default: once per
// workspace) or never
export type ToolField = { type: (typeof TOOL_TYPES)[number]; description?: string; enum?: unknown[] }
export type ToolSpec = { description: string; input: Record<string, ToolField>; required: string[]; ask: (typeof TOOL_ASKS)[number] }
// an action's command: the string, or the object's run
export const actionCmd = (a: unknown) => (typeof a === 'string' ? a : isObj(a) && typeof a.run === 'string' ? a.run : undefined)
// an action's tool as the daemon takes it (what check flags left out); none: not one
export function toolOf(a: unknown): ToolSpec | undefined {
  if (!isObj(a) || typeof a.run !== 'string' || !isObj(a.tool)) return
  const t = a.tool
  const input: Record<string, ToolField> = {}
  for (const [k, v] of Object.entries(isObj(t.input) ? t.input : {})) {
    const f = typeof v === 'string' ? { type: v } : isObj(v) ? v : undefined
    if (f && KEY.test(k) && (TOOL_TYPES as readonly unknown[]).includes(f.type)) input[k] = { type: f.type as ToolField['type'], ...(typeof f.description === 'string' && { description: f.description }), ...(Array.isArray(f.enum) && f.enum.length && { enum: f.enum }) }
  }
  const required = Array.isArray(t.required) ? t.required.filter((r): r is string => typeof r === 'string' && Object.hasOwn(input, r)) : []
  return { description: typeof t.description === 'string' ? t.description.trim() : '', input, required, ask: (TOOL_ASKS as readonly unknown[]).includes(t.ask) ? (t.ask as ToolSpec['ask']) : 'first' }
}
// its input as a JSON Schema: MCP's inputSchema, a model's function parameters
export const toolSchema = (t: ToolSpec) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(t.input).map(([k, f]) => [k, { ...(f.type === 'string[]' ? { type: 'array', items: { type: 'string' } } : { type: f.type }), ...(f.description && { description: f.description }), ...(f.enum && { enum: f.enum }) }])),
  required: t.required,
})
const KIND_WORDS: Record<ToolField['type'], string> = { string: 'text', number: 'a number', boolean: 'true or false', 'string[]': 'a list of text' }
// the input a call gives, checked against its tool before anything runs or asks (throws why not)
export function toolArgs(t: ToolSpec, input: unknown): Record<string, unknown> {
  const a = input === undefined || input === null ? {} : input
  if (!isObj(a)) throw new Error('input: an object of its fields')
  const names = Object.keys(t.input)
  for (const k of Object.keys(a)) if (!Object.hasOwn(t.input, k)) throw new Error(`no input ${k}${(n => (n ? ` (did you mean ${n}?)` : ''))(near(k, names))}: ${names.join(', ') || 'it takes none'}`)
  for (const r of t.required) if (a[r] === undefined || a[r] === null || a[r] === '') throw new Error(`${r} is required`)
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null) continue
    const f = t.input[k]
    const ok = f.type === 'string' ? typeof v === 'string' : f.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : f.type === 'boolean' ? typeof v === 'boolean' : Array.isArray(v) && v.every(x => typeof x === 'string')
    if (!ok) throw new Error(`${k}: ${KIND_WORDS[f.type]}`)
    if (f.enum && !(Array.isArray(v) ? v : [v]).every(x => f.enum!.includes(x))) throw new Error(`${k}: one of ${f.enum.join(', ')}`)
  }
  return a
}
