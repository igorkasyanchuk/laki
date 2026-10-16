// Widgets: small pages in the sidebar (a 3-column grid), each a folder with widget.json (name, size, config, a
// fetch command and how often it runs) and widget.html (a template, shared/widget.ts). The daemon runs each
// widget's fetch on its schedule and keeps what it printed (JSON) in the widget's storage, <data>/widget-data/<id>.json,
// with the user's config. Only a list of them stays in memory: the page and the data are read when the app shows one.
import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUTTON_PLACES, type WidgetOption, type WidgetPlace, type WidgetSize, type WidgetView, WIDGET_PLACES } from '../shared/types.ts'
import { hasFull, hasScript, pageOf, render, sayOf, viewOf, type WidgetSay } from '../shared/widget.ts'
import { describeHours, inHours, parseHours } from '../shared/when.ts'
import { WIDGET_EVERY } from '../shared/widgetGuide.ts'
import { changed, cliArgv, cliEnv, clients, devLog, dir, own, plainEnv, q, state } from './core.ts'

// widget.json; config: its settings, each a default (text; a number, true/false or a list make that kind) or a Spec,
// given to fetch as $WIDGET_<NAME>; fetch: a shell command, or script: a JS file of the widget's that Laki's node runs
// (its default export, or what it prints); actions: commands its buttons run by name (data-run="name", data-arg:
// $WIDGET_ARG); view: the full view's size; place: where it shows at first (side, top, status, rail, foot: the user's
// choice wins). As a button (a rail or foot place, or no preview in widget.html): icon (an icon of the app's, or a
// character or two), label, badge and tip (templates over its data, as plain text), click (one of its actions)
type Spec = { type?: string; label?: string; hint?: string; default?: unknown; choices?: unknown[] }
type Manifest = { name?: string; description?: string; size?: [number, number]; every?: number; view?: string; place?: string | string[]; fetch?: string; script?: string; config?: Record<string, unknown>; actions?: Record<string, string>; icon?: string; label?: string; badge?: string; tip?: string; click?: string; sample?: unknown; sampleConfig?: Record<string, unknown> }
// sample: made-up data in the shape its fetch prints (sampleConfig: settings for it), for a preview before it runs (widgetRender sample)
// what's stored per widget: the user's choices over the manifest's (config: each setting as text), and the last fetch
// (at: when it ran; error: why it failed); net: its page may reach https sites (the user's switch, never widget.json's)
type Store = { on?: boolean; size?: [number, number]; every?: number; view?: string; place?: WidgetPlace | WidgetPlace[]; net?: boolean; config?: Record<string, string>; data?: unknown; at?: number; error?: string; by?: 'ai'; aiMay?: number } // by: Laki AI wrote it (widgetWrite); aiMay: when Edit with Laki AI let it rewrite the user's own, once (AI_MAY)
// preview: widget.html has one; face: its button's words, filled from the last data (faceOf)
type Face = { label?: string; badge?: string; tip?: string }
type Entry = { id: string; dir: string; builtin: boolean; m: Manifest; full: boolean; js: boolean; preview: boolean; face: Face; s: Omit<Store, 'data'> }

const here = dirname(fileURLToPath(import.meta.url))
// the app's own (the repo's widgets/, next to out/ when built), off until turned on
export const BUILTIN = [join(here, '../../widgets'), join(here, '../widgets')].find(d => existsSync(d))
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_OUT = 16 << 20

const widgets = new Map<string, Entry>()
const running = new Set<string>()
const again = new Set<string>() // asked to fetch while fetching (settings changed meanwhile): once more, after
let rev = 0 // each reload: the app renders its widgets again
// what a JS widget's page asks for (GET /widget/<id>?key=…): its data is the user's, so not for any page on this Mac
export const widgetKey = randomBytes(16).toString('hex')
const fetches = (w: Entry) => !!(w.m.fetch || w.m.script)
const wLog = (w: { id: string }, text: string | (() => string)) => devLog(`widget:${w.id}`, text) // a function: only in dev mode
const fetchable = (w: Entry) => onOf(w) && fetches(w) && !running.has(w.id) // on, with a fetch, not fetching now
const due = (w: Entry, now: number) => fetchable(w) && now - (w.s.at ?? 0) >= everyOf(w) * 60_000 // and its every minutes since the last try

const storePath = (id: string) => join(dir, 'widget-data', `${id}.json`)
const home = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
// where widgets are: Laki's own folder, the ones added in Settings, then the app's; the first of an id wins
export const widgetHome = () => join(dir, 'widgets')
export const widgetRoots = () => [widgetHome(), ...(state.settings?.widgetDirs ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))), ...(BUILTIN ? [BUILTIN] : [])]

function readJson<T>(p: string): T | undefined {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}
const readStore = (id: string): Store => readJson<Store>(storePath(id)) ?? {}
function writeStore(id: string, s: Store) {
  const p = storePath(id)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(`${p}.tmp`, JSON.stringify(s))
  renameSync(`${p}.tmp`, p)
}

// a root is a widget's folder, or a folder of them
function foldersIn(root: string): string[] {
  if (existsSync(join(root, 'widget.json'))) return [root]
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(d => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(root, d.name, 'widget.json')))
      .map(d => join(root, d.name))
      .sort()
  } catch {
    return []
  }
}

// read every folder again (Settings' Reload, `laki widget reload`): new and changed widgets without a restart
export function scanWidgets() {
  widgets.clear()
  rev++
  for (const root of widgetRoots())
    for (const d of foldersIn(root)) {
      const id = d.split('/').pop()!.replace(/[^\w.-]/g, '-')
      if (widgets.has(id)) continue
      const m = readJson<Manifest>(join(d, 'widget.json'))
      if (!m || typeof m !== 'object') continue
      let html = ''
      try {
        html = readFileSync(join(d, 'widget.html'), 'utf8')
      } catch {}
      const { data, ...s } = readStore(id)
      const e: Entry = { id, dir: d, builtin: !!BUILTIN && (d === BUILTIN || d.startsWith(BUILTIN + '/')), m, full: hasFull(html), js: hasScript(html), preview: !!viewOf(html, false)?.trim(), face: {}, s }
      e.face = faceOf(e, data)
      widgets.set(id, e)
    }
  changed()
}

// a button's words: widget.json's label, badge and tip filled from its data (as a preview is), plain text on a line
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENT[e])
    .replace(/\s+/g, ' ')
    .trim()
function faceOf(w: Entry, data: unknown): Face {
  const ctx = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), data, config: typedOf(w), at: w.s.at, error: w.s.error } // {{open}} as {{data.open}}
  const fill = (t: unknown, n: number) => {
    if (typeof t !== 'string' || !t.trim()) return undefined
    try {
      return plain(render(t, ctx)).slice(0, n) || undefined
    } catch {
      return undefined
    }
  }
  return { label: fill(w.m.label, 40), badge: fill(w.m.badge, 6), tip: fill(w.m.tip, 300) }
}
// an icon: a name of the app's (the renderer knows which), or a character or two (an emoji, 👨‍👩‍👧 one too)
const graphemes = new Intl.Segmenter()
const iconOf = (w: Entry) => {
  const s = typeof w.m.icon === 'string' ? w.m.icon.trim() : ''
  return /^[a-zA-Z][\w-]{0,30}$/.test(s) || (!!s && !/\s/.test(s) && [...graphemes.segment(s)].length <= 2) ? s : undefined
}
const clickOf = (w: Entry) => (typeof w.m.click === 'string' && w.m.actions && Object.hasOwn(w.m.actions, w.m.click) ? w.m.click : undefined)

const clamp = (n: unknown, lo: number, hi: number, def: number) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : def)
const down = (n: unknown) => (Number(n) === 0.5 ? 0.5 : clamp(n, 1, 4, 1)) // cells down: half a cell too (a line of links)
const sizeOf = (w: Entry): [number, number] => {
  const [a, b] = w.s.size ?? w.m.size ?? [1, 1]
  return [clamp(a, 1, 3, 1), down(b)]
}
const everyOf = (w: Entry) => clamp(w.s.every ?? w.m.every, 1, 1440, WIDGET_EVERY)
const onOf = (w: Entry) => !!w.s.on // every extension starts off: Settings › Extensions turns it on
// an off one runs nothing, its fetch nor its actions (its page's clicks and scripts, a preview's too): one Laki AI wrote
// is off until you've looked at it
const OFF = (w: Entry) => `${w.m.name || w.id} is off: turn it on first`
const SIZES: WidgetSize[] = ['s', 'm', 'l']
const isSize = (v: unknown): v is WidgetSize => SIZES.includes(v as WidgetSize)
const viewSize = (w: Entry): WidgetSize => [w.s.view, w.m.view].find(isSize) ?? 'm'
const isPlace = (v: unknown): v is WidgetPlace => WIDGET_PLACES.includes(v as WidgetPlace)
// its places: the user's (one, or a list), else widget.json's, else the sidebar; the first is its place
const placeList = (v: unknown) => [...new Set((Array.isArray(v) ? v : [v]).filter(isPlace))]
const placesOf = (w: Entry): WidgetPlace[] => [w.s.place, w.m.place].map(placeList).find(l => l.length) ?? ['side']
const placeOf = (w: Entry): WidgetPlace => placesOf(w)[0]

const TYPES: WidgetOption['type'][] = ['text', 'number', 'bool', 'choice', 'list']
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
// a setting's value as text, the way it's stored and given to fetch: a bool '1' or '', a list's items joined by commas
function textOf(o: WidgetOption, v: unknown): string {
  if (o.type === 'bool') return v === true || v === '1' || v === 'true' ? '1' : ''
  if (o.type === 'number') return v == null || !String(v).trim() || !Number.isFinite(Number(v)) ? '' : String(Number(v))
  if (o.type === 'list') return [...new Set((Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,\n]/)).map(x => x.trim()).filter(Boolean))].join(',')
  if (o.type === 'choice') return o.choices?.includes(String(v)) ? String(v) : (o.choices?.[0] ?? '')
  return v == null ? '' : String(v)
}
// widget.json's settings: a plain default is a text setting (a boolean: an on/off, a number: a number, a list: a list)
function optionsOf(w: Entry): (WidgetOption & { def: string })[] {
  return Object.entries(w.m.config ?? {})
    .filter(([k]) => KEY.test(k))
    .map(([key, v]) => {
      const sp: Spec = v && typeof v === 'object' && !Array.isArray(v) ? (v as Spec) : { default: v }
      const d = sp.default
      const type = TYPES.find(t => t === sp.type) ?? (typeof d === 'boolean' ? 'bool' : typeof d === 'number' ? 'number' : Array.isArray(d) ? 'list' : 'text')
      const o: WidgetOption = { key, type, label: str(sp.label), hint: str(sp.hint), choices: type === 'choice' && Array.isArray(sp.choices) ? sp.choices.map(String) : undefined }
      return { ...o, def: textOf(o, d) }
    })
}
// each setting's value as text: the user's, or its default
const configOf = (w: Entry) => Object.fromEntries(optionsOf(w).map(o => [o.key, w.s.config && Object.hasOwn(w.s.config, o.key) ? textOf(o, w.s.config[o.key]) : o.def]))
// the same as values a page or a script reads: a bool true or false, a number (null: empty), a list an array of strings
function typedOf(w: Entry) {
  const c = configOf(w)
  return Object.fromEntries(optionsOf(w).map(o => [o.key, ((v: string) => (o.type === 'bool' ? v === '1' : o.type === 'number' ? (v === '' ? null : Number(v)) : o.type === 'list' ? (v ? v.split(',') : []) : v))(c[o.key])]))
}

export const widgetsView = (): WidgetView[] =>
  [...widgets.values()].map(w => ({
    id: w.id,
    name: w.m.name || w.id,
    description: w.m.description,
    dir: w.dir,
    builtin: w.builtin || undefined,
    on: onOf(w),
    size: sizeOf(w),
    every: fetches(w) ? everyOf(w) : undefined,
    full: w.full,
    view: viewSize(w),
    place: placeOf(w),
    places: placesOf(w),
    net: (w.js && w.s.net) || undefined,
    js: w.js || undefined,
    config: configOf(w),
    options: optionsOf(w).map(({ def: _, ...o }) => o),
    at: w.s.at,
    error: w.s.error,
    running: running.has(w.id) || undefined,
    byAi: w.s.by === 'ai' || undefined,
    sample: w.m.sample !== undefined || (!fetches(w) && w.m.sampleConfig !== undefined) || undefined, // a preview with made-up data
    rev,
    ...((placesOf(w).every(p => BUTTON_PLACES.includes(p)) || !w.preview) && { button: true }), // a tile elsewhere: its preview
    icon: iconOf(w),
    ...w.face,
    click: clickOf(w),
  }))

function find(id: string) {
  const w = widgets.get(id)
  if (!w) throw new Error(`no widget ${id}`)
  return w
}

// the widget's preview or full view as HTML, filled from its storage; null: it has no such view. A JS widget's is a
// whole page (pageOf), for a frame
// sample: with widget.json's made-up data (and sampleConfig over its settings), as it would look; sample in the context
export function widgetRender(o: { id: string; full?: boolean; vars?: Record<string, string>; sample?: boolean }) {
  const w = find(o.id)
  const file = readFileSync(join(w.dir, 'widget.html'), 'utf8')
  const html = viewOf(file, !!o.full)
  if (html === undefined) return null
  const s = readStore(w.id)
  const sc = w.m.sampleConfig && typeof w.m.sampleConfig === 'object' && !Array.isArray(w.m.sampleConfig) ? w.m.sampleConfig : {}
  const ctx = o.sample
    ? { data: w.m.sample, config: { ...typedOf(w), ...sc }, at: Date.now() - 120_000, error: undefined, full: !!o.full, sample: true }
    : { data: s.data, config: typedOf(w), at: s.at, error: s.error, full: !!o.full }
  const body = render(html, ctx)
  return hasScript(file) ? pageOf(body, ctx, o.vars) : body // as the app shows it (js): a script in either view makes both pages
}

// GET /widget/<id>?key=…&full=1&theme=<JSON of CSS variables>: a JS widget's page, sandboxed by its CSP (an origin of
// its own, no requests out, images only as data: URLs): its script sees its data, never the app, the daemon or the web.
// With the user's Network access (net) it may fetch() and show images from https sites, still never the app or the daemon
const netOf = (id: string) => !!widgets.get(id)?.s.net
export function widgetPage(id: string, query: URLSearchParams): { code: number; headers: Record<string, string>; body: string } {
  const key = Buffer.from(query.get('key') ?? '')
  const bad = (code: number, body: string) => ({ code, headers: { 'content-type': 'text/plain' }, body })
  if (key.length !== widgetKey.length || !timingSafeEqual(key, Buffer.from(widgetKey))) return bad(401, 'bad key')
  let html: string | null
  try {
    let vars: Record<string, string> = {}
    try {
      vars = JSON.parse(query.get('theme') || '{}')
    } catch {}
    html = widgetRender({ id, full: query.get('full') === '1', sample: query.get('sample') === '1', vars: vars && typeof vars === 'object' ? vars : {} })
  } catch (e) {
    html = `<!doctype html><p style="color:#f7768e;font:12px system-ui">${String((e as Error).message).replace(/[&<>]/g, '')}</p>`
  }
  if (html === null) return bad(404, 'no such view')
  return {
    code: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; ${netOf(id) ? 'connect-src https:; img-src data: https:; font-src data: https:' : 'img-src data:; font-src data:'}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
    body: html,
  }
}

// Reset the interface: every extension off (its other choices kept)
export function widgetsOff() {
  for (const w of widgets.values()) {
    if (!w.s.on) continue
    writeStore(w.id, { ...readStore(w.id), on: false })
    w.s = { ...w.s, on: false }
  }
  changed()
}

// the user's choices: on, size, every (minutes), view (the full view's size), place (sidebar, top bar or status bar), net
// (its page may reach https sites), config (each setting as text, made what its kind takes); a widget turned on fetches now
const AI_MAY = 3600000 // ms: how long Edit with Laki AI's leave to rewrite one of the user's lasts
export function widgetSet(o: { id: string; on?: boolean; size?: [number, number]; every?: number; view?: WidgetSize; place?: WidgetPlace | WidgetPlace[]; net?: boolean; config?: Record<string, string>; ai?: boolean }) {
  const w = find(o.id)
  const s = readStore(w.id)
  if (o.ai) {
    // Edit with Laki AI (Settings › Extensions): one of the user's in Laki's folder, which widgetWrite may then rewrite
    if (w.builtin || w.dir !== join(widgetHome(), w.id)) throw new Error(`${w.m.name ?? w.id} isn't in Laki's folder: Laki AI can't change it`)
    s.aiMay = Date.now()
  }
  if (o.on !== undefined) s.on = !!o.on
  if (o.size) s.size = [clamp(o.size[0], 1, 3, 1), down(o.size[1])]
  if (o.every !== undefined) s.every = clamp(o.every, 1, 1440, WIDGET_EVERY)
  if (o.view !== undefined) s.view = isSize(o.view) ? o.view : undefined
  if (o.place !== undefined) s.place = (l => (l.length > 1 ? l : l[0]))(placeList(o.place)) // none: widget.json's again
  if (o.net !== undefined) s.net = !!o.net || undefined
  if (o.config) {
    const opts = new Map(optionsOf(w).map(x => [x.key, x]))
    const given = Object.entries(o.config).filter(([k]) => opts.has(k)).map(([k, v]) => [k, textOf(opts.get(k)!, v)])
    s.config = { ...Object.fromEntries(Object.entries(s.config ?? {}).filter(([k]) => opts.has(k))), ...Object.fromEntries(given) }
  }
  writeStore(w.id, s)
  wLog(w, `settings changed: ${[...Object.keys(o).filter(k => k !== 'id' && k !== 'config'), ...Object.keys(o.config ?? {})].join(', ')}`) // names only: a setting may be a key
  const { data, ...meta } = s
  w.s = meta
  w.face = faceOf(w, data) // its config, in its words
  changed()
  if (onOf(w) && (o.on || o.config)) void widgetRun({ id: w.id }) // its data for the new settings
  return widgetsView().find(x => x.id === w.id)
}

// what a failed command said last, past node's own trailer (an uncaught error ends with its version)
const lastLine = (t: string) =>
  t
    .trim()
    .split('\n')
    .filter(l => l.trim() && !/^Node\.js v[\d.]+$/.test(l.trim()) && !/^\s+at /.test(l))
    .pop()
    ?.slice(0, 300)

// $LAKI_CLI: the laki command as one file, for "$LAKI_CLI" ls --json in a fetch (or execFile in a script); written
// once per daemon (its paths are this daemon's)
let cli: string | undefined
function launcher() {
  if (cli && existsSync(cli)) return cli
  const p = join(dir, 'widget-data', 'laki')
  const text = `#!/bin/sh\nexec /usr/bin/env ${[...cliEnv, `LAKI_HOME=${dir}`, ...cliArgv].map(q).join(' ')} "$@"\n`
  let have = ''
  try {
    have = readFileSync(p, 'utf8')
  } catch {}
  if (have !== text) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text, { mode: 0o755 })
  }
  return (cli = p)
}

// a widget's command, in its folder: $WIDGET_<NAME> for each setting (and $LAKI_WIDGET_CONFIG, all of them as JSON),
// $LAKI_WIDGET_FILE (its storage, for the last data), $LAKI_CLI (the laki command); stdout, or why it failed
function exec(w: Entry, cmd: string, args: string[], extra: Record<string, string>) {
  const config = configOf(w)
  const env: Record<string, string> = {
    ...plainEnv(),
    LAKI_HOME: dir,
    LAKI_CLI: launcher(),
    LAKI_WIDGET: w.id,
    LAKI_WIDGET_FILE: storePath(w.id),
    LAKI_WIDGET_CONFIG: JSON.stringify(typedOf(w)),
    ...extra,
  }
  for (const [k, v] of Object.entries(config)) env[`WIDGET_${k.toUpperCase()}`] = v
  return new Promise<string>((ok, no) =>
    own(
      execFile(cmd, args, { cwd: w.dir, env, timeout: 120_000, maxBuffer: MAX_OUT }, (e, stdout, stderr) =>
        e ? no(new Error(lastLine(String(stderr)) || lastLine(String(stdout)) || (e.killed ? 'timed out after 2 minutes' : e.message))) : ok(String(stdout)),
      ),
      `Extension · ${w.m.name || w.id}`,
    ),
  )
}

// a script's default export gets { config, last } and returns the data; one without prints it. What it throws is the
// error, its message alone (node would print the stack, then its version)
const RUN_JS = `import { readFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
try {
  const m = await import(pathToFileURL(process.argv[1]).href)
  if (typeof m.default === 'function') {
    let last
    try { last = JSON.parse(readFileSync(process.env.LAKI_WIDGET_FILE, 'utf8')).data } catch {}
    const data = await m.default({ config: JSON.parse(process.env.LAKI_WIDGET_CONFIG || '{}'), last })
    process.stdout.write(JSON.stringify(data ?? null))
  }
} catch (e) {
  writeSync(2, String(e?.message ?? e) + '\\n') // at once: a pipe's write is async on macOS, exit wouldn't wait
  process.exit(1)
}`

// run the widget's fetch now (exec); what it prints must be JSON. A failure keeps the last data and says why.
export async function widgetRun(o: { id: string }): Promise<{ ok: boolean; error?: string }> {
  const w = find(o.id)
  if (!onOf(w)) return { ok: false, error: OFF(w) }
  if (!fetches(w)) return { ok: false, error: `${w.id} has no fetch or script` }
  if (running.has(w.id)) return again.add(w.id), { ok: false, error: 'already fetching: it fetches again after this one' }
  const script = w.m.script ? resolve(w.dir, w.m.script) : undefined
  if (script && !script.startsWith(w.dir + '/')) return { ok: false, error: `${w.m.script} isn't in the widget's folder` }
  running.add(w.id)
  changed()
  const t0 = Date.now()
  wLog(w, `fetch: ${script ? `node ${w.m.script}` : w.m.fetch}`)
  let data: unknown
  let error: string | undefined
  try {
    // a script on Laki's own node (Electron's, as node, in the app)
    const out = await exec(w, script ? process.execPath : '/bin/sh', script ? ['--input-type=module', '-e', RUN_JS, script] : ['-c', w.m.fetch!], script && process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    try {
      data = JSON.parse(out)
    } catch {
      throw new Error(`fetch printed no JSON: ${lastLine(out) ?? 'nothing'}`)
    }
  } catch (e) {
    error = (e as Error).message
  }
  running.delete(w.id)
  const ms = Date.now() - t0
  wLog(w, () => (error ? `fetch failed after ${ms} ms: ${error}` : `fetched in ${ms} ms: ${JSON.stringify(data)?.length ?? 0} bytes of JSON`))
  const s = readStore(w.id) // its settings may have changed meanwhile
  if (!error) s.data = data
  s.at = Date.now()
  s.error = error
  writeStore(w.id, s)
  const cur = widgets.get(w.id)
  if (cur) (cur.s = { ...cur.s, at: s.at, error }), (cur.face = faceOf(cur, s.data))
  changed()
  if (again.delete(w.id) && cur && onOf(cur)) void widgetRun({ id: w.id }) // with the settings as they are now
  return error ? { ok: false, error } : { ok: true }
}

// a button's command (widget.json's actions), its data-arg as $WIDGET_ARG (never in the command line); then the widget
// fetches again, to show what it changed. What it prints as JSON with toast or modal (sayOf) is what the app shows
export async function widgetAction(o: { id: string; action: string; arg?: string }): Promise<{ ok: boolean; out?: string; error?: string } & WidgetSay> {
  const w = find(o.id)
  if (!onOf(w)) return { ok: false, error: OFF(w) }
  const cmd = w.m.actions && Object.hasOwn(w.m.actions, o.action) ? w.m.actions[o.action] : undefined
  if (typeof cmd !== 'string') return { ok: false, error: `${w.m.name || w.id} has no action ${o.action}` }
  wLog(w, `action ${o.action}${o.arg ? ` (${String(o.arg).slice(0, 200)})` : ''}`)
  try {
    const out = await exec(w, '/bin/sh', ['-c', cmd], { WIDGET_ARG: String(o.arg ?? '') })
    wLog(w, `action ${o.action} done: ${lastLine(out) ?? 'printed nothing'}`)
    if (fetches(w)) void widgetRun({ id: w.id }) // fetching already: once more after it
    let say: WidgetSay | null = null
    for (const s of [out, lastLine(out)]) // all of it, or its last line after some log lines
      try {
        if ((say = sayOf(JSON.parse(s ?? '')))) break
      } catch {}
    return say ? { ok: true, ...say } : { ok: true, out: lastLine(out) }
  } catch (e) {
    wLog(w, `action ${o.action} failed: ${(e as Error).message}`)
    return { ok: false, error: (e as Error).message }
  }
}

// every 30 s, and as the app connects or its window shows again: each widget that's on and due fetches (its every
// minutes since the last try, which a failure counts as), only while the app's window is open (a client whose page is
// visible: closing the window only hides it) and within settings.widgetHours (9am-9pm weekdays; a line that doesn't
// read: always): no API calls nobody sees. Fetch now and a change of settings still fetch
export function widgetTick(now = Date.now()) {
  if (![...clients].some(c => c.view?.shown !== false)) return
  const hours = typeof state.settings?.widgetHours === 'string' && state.settings.widgetHours.trim() ? parseHours(state.settings.widgetHours) : null
  if (hours && !('error' in hours) && !inHours(hours, now)) {
    for (const w of widgets.values()) if (due(w, now)) wLog(w, () => `not fetched: outside the working hours (${describeHours(hours)})`)
    return
  }
  for (const w of widgets.values()) if (due(w, now)) void widgetRun({ id: w.id })
}

// an extension's files, as text (Laki AI's and MCP's laki_extension_read: an example to copy, or the one to change):
// its folder's own files only, none hidden, 20 at most
export function widgetFiles(o: { id: string }) {
  const w = find(o.id)
  const files: Record<string, string> = {}
  for (const d of readdirSync(w.dir, { withFileTypes: true }).filter(d => d.isFile() && !d.name.startsWith('.')).slice(0, 20)) {
    const p = join(w.dir, d.name)
    const buf = statSync(p).size > 64 << 10 ? null : readFileSync(p)
    files[d.name] = !buf ? '(over 64 KB: not shown)' : buf.includes(0) ? '(binary: not shown)' : buf.toString('utf8')
  }
  return { id: w.id, builtin: w.builtin || undefined, files }
}

// an extension made or changed by Laki AI or an MCP client (laki_extension_write): its files in Laki's own folder only
// (<data>/widgets/<id>, never another folder's, the user's own there, nor through a link), files left out kept. Saved off: its fetch runs shell
// commands a model wrote, so the user turns it on in Settings › Extensions after a look
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const FILE = /^\w[\w.-]{0,59}$/
const statOf = (p: string) => {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}
export function widgetWrite(o: { id: string; files: Record<string, unknown> }) {
  if (typeof o.id !== 'string' || !ID.test(o.id)) throw new Error('an id: lowercase letters, digits and dashes')
  const files = Object.entries(o.files && typeof o.files === 'object' && !Array.isArray(o.files) ? o.files : {})
  if (!files.length || files.length > 20) throw new Error('1 to 20 files')
  for (const [n, t] of files) {
    if (!FILE.test(n) || n.includes('..')) throw new Error(`${n}: a file's name in the extension's folder, no folders`)
    if (typeof t !== 'string' || t.length > 256 << 10) throw new Error(`${n}: its text, up to 256 KB`)
  }
  const d = join(widgetHome(), o.id)
  const had = widgets.get(o.id)
  if (had && had.dir !== d) throw new Error(`${o.id} is ${had.builtin ? 'one that comes with Laki' : `in ${had.dir}`}: write a new one under another id`)
  const was = readStore(o.id)
  const theirs = !!statOf(d) && was.by !== 'ai' // the user's own: only with a fresh Edit with Laki AI, and it stays theirs
  if (theirs && !(was.aiMay && Date.now() - was.aiMay < AI_MAY)) throw new Error(`${o.id} is the user's own (Laki AI didn't make it): write a new one under another id`) // theirs isn't overwritten
  const json = files.find(([n]) => n === 'widget.json')?.[1] as string | undefined
  if (json === undefined && !statOf(join(d, 'widget.json'))) throw new Error('a new extension needs widget.json')
  if (json !== undefined) {
    let m: unknown
    try {
      m = JSON.parse(json)
    } catch (e) {
      throw new Error(`widget.json: ${(e as Error).message}`)
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('widget.json: an object')
    const j = m as Manifest
    if ((j.fetch || j.script) && j.sample === undefined) throw new Error('widget.json: a sample too, made-up data in the shape its fetch prints, for its preview (laki_extension_guide)') // every extension shows how it looks before it runs
  }
  mkdirSync(widgetHome(), { recursive: true })
  const at = statOf(d)
  if (at && !at.isDirectory()) throw new Error(`${d} isn't a folder`)
  mkdirSync(d, { recursive: true })
  for (const [n, t] of files) {
    const p = join(d, n)
    const was = statOf(p)
    if (was && !was.isFile()) throw new Error(`${n} is a link or a folder there`)
    writeFileSync(p, t as string)
    chmodSync(p, (t as string).startsWith('#!') ? 0o755 : 0o644) // a script with its interpreter's line runs as ./fetch.sh
  }
  writeStore(o.id, { ...readStore(o.id), on: false, net: undefined, by: theirs ? was.by : 'ai', aiMay: undefined }) // net too: the user allows the network for the page they looked at, not a rewrite
  scanWidgets()
  wLog({ id: o.id }, `written: ${files.map(([n]) => n).join(', ')}; off until it's turned on`)
  return { ...widgetsView().find(w => w.id === o.id), note: 'Saved turned off: the user looks at it on its page (Settings › Extensions, with its sample) and turns it on' }
}

// Settings › Extensions' Delete (after the app's confirm): its folder and its storage, for good. Not one that comes with
// Laki (turn it off), nor a folder that holds more than it (your home, Laki's own)
export function widgetRm(o: { id: string }) {
  const w = find(o.id)
  if (w.builtin) throw new Error(`${w.m.name || w.id} comes with Laki: turn it off instead`)
  if (running.has(w.id)) throw new Error(`${w.m.name || w.id} is fetching: try again in a moment`)
  const d = resolve(w.dir)
  if ([homedir(), dir, widgetHome(), '/'].includes(d)) throw new Error(`${d} isn't one extension's own folder`) // a widget.json put in one of those
  rmSync(d, { recursive: true, force: true }) // a link: only the link
  rmSync(storePath(w.id), { force: true })
  wLog(w, `deleted: ${d}`)
  scanWidgets()
  return { deleted: w.id }
}

// a widget's folder, for Open in (core's openIn)
export const widgetDir = (id: string) => find(id).dir

// Settings' Reload: the folders again, then every widget that's on fetches
export function widgetReload() {
  scanWidgets()
  for (const w of widgets.values()) if (fetchable(w)) void widgetRun({ id: w.id })
  return widgetsView()
}
