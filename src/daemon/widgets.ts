// Widgets: small pages in the sidebar (a 3-column grid), each a folder with widget.json (name, size, config, a
// fetch command and how often it runs) and widget.html (a template, shared/widget.ts). The daemon runs each
// widget's fetch on its schedule and keeps what it printed (JSON) in the widget's storage, <data>/widget-data/<id>.json,
// with the user's config. Only a list of them stays in memory: the page and the data are read when the app shows one.
import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, type FSWatcher, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUTTON_PLACES, type Workspace, type WidgetOption, type WidgetRun, type WidgetRuns, type WidgetPlace, type WidgetSize, type WidgetView, WIDGET_PLACES } from '../shared/types.ts'
import { hasFull, hasScript, pageOf, render, sayOf, templateError, viewOf, type WidgetSay } from '../shared/widget.ts'
import { uiCheck, uiHtml, type UiProblem, uiTree } from '../shared/widgetUi.ts'
import { manifestCheck } from '../shared/widgetSchema.ts'
import { STARTER_KINDS, STARTERS, type StarterKind } from '../shared/widgetStarters.ts'
import { describeHours, inHours, parseHours } from '../shared/when.ts'
import { WIDGET_EVERY } from '../shared/widgetGuide.ts'
import { changed, cliArgv, cliEnv, clients, devKeep, devLog, dir, own, plainEnv, q, settingsSet, state, wsVars } from './core.ts'

// widget.json; config: its settings, each a default (text; a number, true/false or a list make that kind) or a Spec,
// given to fetch as $WIDGET_<NAME>; fetch: a shell command, or script: a JS file of the widget's that Laki's node runs
// (its default export, or what it prints); actions: commands its buttons run by name (data-run="name", data-arg:
// $WIDGET_ARG); view: the full view's size; place: where it shows at first (side, top, status, rail, foot: the user's
// choice wins). As a button (a rail or foot place, or no preview in widget.html): icon (an icon of the app's, or a
// character or two), label, badge and tip (templates over its data, as plain text), click (one of its actions).
// ui: the UI kit's elements (widgetUi.ts), one tree or { preview, full }: widget.html's own view wins, ui fills the other
type Spec = { type?: string; label?: string; hint?: string; default?: unknown; choices?: unknown[] }
type Manifest = { name?: string; description?: string; size?: [number, number]; every?: number; view?: string; place?: string | string[]; scope?: string; fetch?: string; script?: string; config?: Record<string, unknown>; actions?: Record<string, string>; icon?: string; label?: string; badge?: string; tip?: string; click?: string; sample?: unknown; sampleConfig?: Record<string, unknown>; ui?: unknown }
// sample: made-up data in the shape its fetch prints (sampleConfig: settings for it), for a preview before it runs (widgetRender sample)
// what's stored per widget: the user's choices over the manifest's (config: each setting as text), and the last fetch
// (at: when it ran; error: why it failed); net: its page may reach https sites (the user's switch, never widget.json's)
type Store = { on?: boolean; size?: [number, number]; every?: number; view?: string; place?: WidgetPlace | WidgetPlace[]; net?: boolean; config?: Record<string, string>; data?: unknown; at?: number; error?: string; by?: 'ai'; aiMay?: number; mock?: string } // by: Laki AI wrote it (widgetWrite); aiMay: when Edit with Laki AI let it rewrite the user's own, once (AI_MAY); mock: data put there by hand (widgetMock: a fixture's name, or edited), not fetched
// preview: widget.html has one; face: its button's words, filled from the last data (faceOf)
type Face = { label?: string; badge?: string; tip?: string }
type Entry = { id: string; dir: string; file?: string; builtin: boolean; dev: boolean; devError?: string; m: Manifest; full: boolean; js: boolean; preview: boolean; face: Face; s: Omit<Store, 'data'>; inst: Map<string, InstMeta> } // inst: a scope workspace one's instances (by workspace id), their last fetch // dev: in a folder laki widget dev linked; devError: why its files don't read now (the last good version runs on)
// scope workspace: an instance per live workspace, its data in <data>/widget-data/<id>/ws/<wsId>.json (the settings stay
// the store's, shared); in memory its last fetch and its button's words
type Inst = { data?: unknown; at?: number; error?: string; mock?: string }
type InstMeta = Omit<Inst, 'data'> & { face: Face }
type Run = WidgetRun // what each fetch and action did (widgetRuns, the inspector's Runs, laki widget dev's lines): the last RUNS, newest first

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
const fetchable = (w: Entry, ws?: string) => onOf(w) && fetches(w) && !running.has(keyOf(w.id, ws)) && !metaOf(w, ws).mock // on, with a fetch, not fetching now, not showing data put there by hand
const due = (w: Entry, now: number, ws?: string) => fetchable(w, ws) && now - (metaOf(w, ws).at ?? 0) >= everyOf(w) * 60_000 // and its every minutes since the last try

const storePath = (id: string) => join(dir, 'widget-data', `${id}.json`)
const home = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
// where widgets are: Laki's own folder, the ones added in Settings, then the app's; the first of an id wins
export const widgetHome = () => join(dir, 'widgets')
// dev mode's folders (settings.widgetDev, laki widget dev): first, so a copy you work on shadows the installed one
const devRoots = () => [...new Set((state.settings?.widgetDev ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))))]
const under = (d: string, root: string) => d === root || d.startsWith(root + '/')
export const widgetRoots = () => [...devRoots(), widgetHome(), ...(state.settings?.widgetDirs ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))), ...(BUILTIN ? [BUILTIN] : [])]

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

const instDir = (id: string) => join(dir, 'widget-data', id, 'ws')
const instPath = (id: string, ws: string) => join(instDir(id), `${ws}.json`)
const readInst = (id: string, ws: string): Inst => readJson<Inst>(instPath(id, ws)) ?? {}
function writeInst(id: string, ws: string, s: Inst) {
  const p = instPath(id, ws)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(`${p}.tmp`, JSON.stringify(s))
  renameSync(`${p}.tmp`, p)
}
const keyOf = (id: string, ws?: string) => (ws ? `${id}@${ws}` : id) // running, again and runs: an instance's own
const scoped = (w: Entry) => w.m.scope === 'workspace'
// a workspace an instance may have: live, not Terminals' or Browsers'. ponytail: none on an SSH host yet
const instOk = (x: Workspace) => !x.archived && !x.host && !state.projects.find(p => p.id === x.project)?.kind
// the workspace a call names: required for a scope workspace one, refused for a global one
function wsOf(w: Entry, ws: unknown): Workspace | undefined {
  const given = typeof ws === 'string' && ws ? ws : undefined
  if (!scoped(w)) {
    if (given) throw new Error(`${w.m.name || w.id} isn't per workspace: no ws`)
    return undefined
  }
  if (!given) throw new Error(`${w.m.name || w.id} is per workspace: which one? (ws)`)
  const x = state.workspaces.find(v => v.id === given)
  if (!x) throw new Error(`no workspace ${given}`)
  if (!instOk(x)) throw new Error(`${given} has no extensions: ${x.archived ? 'archived' : x.host ? `on ${x.host}` : 'a terminal or a browser'}`)
  return x
}
// what an instance knows of its workspace: agentVars' values (the agents' {{branch}}…, core's wsVars), for its fetch's
// env, a script's workspace, and templates' {{workspace.branch}}
function wsInfo(x: Workspace) {
  const v = wsVars(x)
  return { id: x.id, name: v.workspace ?? x.id, project: v.project, branch: v.branch, base: v.base, path: x.path, port: x.port, pr: v.pr, storage: x.storage }
}
const SAMPLE_WS = { id: 'sample', name: 'fix-login', project: 'web', branch: 'fix-login', base: 'main', path: '~/code/web', port: 5173, pr: 'https://github.com/acme/web/pull/412' } // a preview's made-up one
function wsEnv(w: Entry, x?: Workspace): Record<string, string> {
  if (!x) return {}
  const i = wsInfo(x)
  return { LAKI_WORKSPACE: i.id, LAKI_WORKSPACE_NAME: i.name, LAKI_PROJECT: i.project ?? '', LAKI_BRANCH: i.branch ?? '', LAKI_BASE: i.base ?? '', LAKI_PATH: i.path, PORT: String(i.port ?? ''), LAKI_PR: i.pr ?? '', ...(i.storage && { LAKI_STORAGE_FOLDER: i.storage }), LAKI_WIDGET_FILE: instPath(w.id, x.id), LAKI_WIDGET_WS: JSON.stringify(i) } // never makes a storage folder
}
// an instance's (or a global one's) data, and its last fetch kept; the in-memory copy follows (a rescan's entry too)
const dataOf = (w: Entry, ws?: string): Inst => (ws ? readInst(w.id, ws) : readStore(w.id))
const metaOf = (w: Entry, ws?: string): Omit<Inst, 'data'> => (ws ? (w.inst.get(ws) ?? {}) : w.s)
function keep(w: Entry, ws: string | undefined, f: (s: Inst) => void) {
  const s = ws ? readInst(w.id, ws) : readStore(w.id) // its settings may have changed meanwhile
  f(s)
  if (ws) writeInst(w.id, ws, s)
  else writeStore(w.id, s as Store)
  const cur = widgets.get(w.id) ?? w
  if (ws) cur.inst.set(ws, { at: s.at, error: s.error, mock: s.mock, face: faceOf(cur, s.data, ws, s) })
  else (cur.s = { ...cur.s, at: s.at, error: s.error, mock: s.mock }), (cur.face = faceOf(cur, s.data))
}
function instsOf(id: string, w?: Entry): Map<string, InstMeta> {
  const m = new Map<string, InstMeta>()
  let names: string[] = []
  try {
    names = readdirSync(instDir(id)).filter(n => n.endsWith('.json'))
  } catch {}
  for (const n of names) {
    const ws = n.slice(0, -5)
    const { data, ...meta } = readInst(id, ws)
    m.set(ws, { ...meta, face: w ? faceOf(w, data, ws, meta) : {} })
  }
  return m
}
// a workspace gone (wsRm, projectRm, archivedTidy: core's dropWs): its instances' files, every extension's
export function widgetsGone(ws: string) {
  let ids: string[] = []
  try {
    ids = readdirSync(join(dir, 'widget-data'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) // <id>/ws/: beside each <id>.json
  } catch {}
  for (const id of ids) rmSync(instPath(id, ws), { force: true })
  for (const w of widgets.values()) w.inst.delete(ws)
  for (const k of [...runs.keys()]) if (k.endsWith(`@${ws}`)) runs.delete(k)
}

// widget.html, or none ('')
function htmlOf(d: string) {
  try {
    return readFileSync(join(d, 'widget.html'), 'utf8')
  } catch {
    return ''
  }
}

// a one-file extension (SwiftBar's way): <id>.<n><s|m|h>.<ext> (prs.5m.sh), a script (#! or executable) whose name
// says how often it runs and whose comment lines say the rest (oneFile)
const ONE = /^([a-z0-9][\w-]{0,39})\.(\d{1,4})([smh])\.[A-Za-z0-9]{1,8}$/
function isOne(p: string) {
  if (!ONE.test(p.split('/').pop()!)) return false
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size > 256 << 10) return false
    return !!(st.mode & 0o111) || readFileSync(p, 'utf8').startsWith('#!')
  } catch {
    return false
  }
}
type Source = { d: string; file?: string }
const idOf = (x: Source) => (x.file ? x.file.split('.')[0] : x.d.split('/').pop()!.replace(/[^\w.-]/g, '-'))
const pathOf = (x: { dir?: string; d?: string; file?: string }) => (x.file ? join((x.dir ?? x.d)!, x.file) : (x.dir ?? x.d)!)
// a root is a widget's folder, a one-file extension, or a folder of either
function foldersIn(root: string): Source[] {
  if (existsSync(join(root, 'widget.json'))) return [{ d: root }]
  if (isOne(root)) return [{ d: dirname(root), file: root.split('/').pop() }]
  try {
    return readdirSync(root, { withFileTypes: true })
      .flatMap((d): Source[] => ((d.isDirectory() || d.isSymbolicLink()) && existsSync(join(root, d.name, 'widget.json')) ? [{ d: join(root, d.name) }] : isOne(join(root, d.name)) ? [{ d: root, file: d.name }] : []))
      .sort((a, b) => pathOf(a).localeCompare(pathOf(b)))
  } catch {
    return []
  }
}
// a one-file extension's widget.json, from its name and its comment lines: <laki.name>, description, place (one or
// a comma list), scope, icon, label, badge, tip, size (3x1), ui and sample (a line of JSON each), and xbar's settings,
// <laki.var>text(REPO="acme/web"): Repo</laki.var> (text, number, bool, choice(a,b)). Its fetch runs the file
const VAR = /^(text|number|bool|choice)(?:\(([^)]*)\))?\s*\(\s*([A-Za-z_]\w*)\s*=\s*("[^"]*"|[^)]*?)\s*\)\s*(?::\s*(.*))?$/
function oneFile(d: string, file: string): (Manifest & { seconds?: number }) | string {
  const [, , n, unit] = ONE.exec(file)!
  let text: string
  try {
    text = readFileSync(join(d, file), 'utf8')
  } catch (e) {
    return `${file}: ${(e as Error).message}`
  }
  const tag = (k: string) => new RegExp(`<laki\\.${k}>([\\s\\S]*?)</laki\\.${k}>`).exec(text)?.[1].trim()
  const m: Manifest & { seconds?: number } = { name: tag('name') || file.split('.')[0] }
  for (const k of ['description', 'icon', 'label', 'badge', 'tip'] as const) if (tag(k)) m[k] = tag(k)
  if (tag('scope')) m.scope = tag('scope')
  const place = tag('place')
  if (place) m.place = place.includes(',') ? place.split(',').map(x => x.trim()) : place
  const size = /^([1-3])\s*x\s*(0?\.5|[1-4])$/i.exec(tag('size') ?? '')
  if (size) m.size = [Number(size[1]), Number(size[2])]
  m.every = unit === 'h' ? Number(n) * 60 : unit === 'm' ? Number(n) : Math.max(1, Math.round(Number(n) / 60))
  if (unit === 's') m.seconds = Number(n)
  for (const k of ['ui', 'sample'] as const) {
    const v = tag(k)
    if (v)
      try {
        m[k] = JSON.parse(v)
      } catch (e) {
        return `${file} <laki.${k}>: ${(e as Error).message}`
      }
  }
  for (const [, v] of text.matchAll(/<laki\.var>([\s\S]*?)<\/laki\.var>/g)) {
    const x = VAR.exec(v.trim())
    if (!x) return `${file} <laki.var>${v.trim()}</laki.var>: type(NAME="default"): label, the type text, number, bool or choice(a,b)`
    const def = x[4].replace(/^"|"$/g, '')
    ;(m.config ??= {})[x[3]] = { type: x[1], default: x[1] === 'bool' ? def === 'true' : x[1] === 'number' ? Number(def) : def, ...(x[5] && { label: x[5].trim() }), ...(x[1] === 'choice' && { choices: (x[2] ?? '').split(',').map(c => c.trim()).filter(Boolean) }) }
  }
  const shebang = /^#!\s*(\S.*)$/m.exec(text.split('\n')[0] ?? '')?.[1]
  let exe = false
  try {
    exe = !!(statSync(join(d, file)).mode & 0o111)
  } catch {}
  m.fetch = exe || !shebang ? `./${q(file)}` : `${shebang} ./${q(file)}`
  return m
}

// widget.json, or why it doesn't read
function manifestOf(d: string): Manifest | string {
  let m: unknown
  try {
    m = JSON.parse(readFileSync(join(d, 'widget.json'), 'utf8'))
  } catch (e) {
    return `widget.json: ${(e as Error).message}`
  }
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Manifest) : 'widget.json: an object'
}
// a template of widget.html's or ui's that doesn't read (dev mode's check before a reload)
function templatesError(m: Manifest, html: string): string | undefined {
  let bad = templateError(html)
  if (bad) return `widget.html: ${bad}`
  const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
  for (const t of strings(m.ui)) if ((bad = templateError(t))) return `ui: ${bad} in "${t.slice(0, 60)}"`
}

// read every folder again (Settings' Reload, `laki widget reload`, a dev folder's change): new and changed widgets
// without a restart. A dev widget whose files don't read keeps its last good version running, with devError
export function scanWidgets() {
  const before = new Map(widgets)
  widgets.clear()
  rev++
  const dev = devRoots()
  for (const root of widgetRoots())
    for (const { d, file } of foldersIn(root)) {
      const id = idOf({ d, file })
      if (widgets.has(id)) continue
      const isDev = dev.some(r => under(pathOf({ d, file }), r))
      const last = before.get(id) && pathOf(before.get(id)!) === pathOf({ d, file }) ? before.get(id) : undefined
      const m = file ? oneFile(d, file) : manifestOf(d)
      const html = typeof m === 'string' || file ? '' : htmlOf(d)
      const bad = typeof m === 'string' ? m : isDev ? templatesError(m, html) : undefined
      if (bad && isDev && last) {
        widgets.set(id, { ...last, devError: bad })
        continue
      }
      if (typeof m === 'string') continue
      const { data, ...s } = readStore(id)
      const e: Entry = { id, dir: d, file, builtin: !!BUILTIN && under(d, BUILTIN), dev: isDev, devError: bad, m, full: hasFull(html) || !!uiTree(m.ui, true), js: hasScript(html), preview: !!viewOf(html, false)?.trim() || !!uiTree(m.ui, false), face: {}, s, inst: new Map() }
      e.face = faceOf(e, data)
      if (scoped(e)) e.inst = instsOf(id, e)
      widgets.set(id, e)
    }
  for (const k of [...devKeep]) if (k.startsWith('widget:')) devKeep.delete(k)
  for (const w of widgets.values()) if (w.dev) devKeep.add(`widget:${w.id}`) // a dev widget's log, dev mode or not
  watchDev(dev)
  changed()
}

// dev mode: each linked folder watched (fs.watch, recursive; not node_modules, .git or dotfiles), 300 ms after the last
// change its widgets read again (scanWidgets: the last good version kept over a broken file) and fetch (reason dev)
const watchers = new Map<string, FSWatcher>()
function watchDev(roots: string[]) {
  for (const [r, w] of watchers) if (!roots.includes(r)) (w.close(), watchers.delete(r))
  for (const r of roots) {
    if (watchers.has(r) || !existsSync(r)) continue
    let timer: NodeJS.Timeout | undefined
    const files = new Set<string>()
    try {
      const w = watch(r, { recursive: statSync(r).isDirectory() }, (_, f) => {
        const name = String(f ?? '')
        if (name.split('/').some(p => p.startsWith('.') || p === 'node_modules')) return
        files.add(name)
        clearTimeout(timer)
        timer = setTimeout(() => {
          const why = `${[...files].slice(0, 3).join(', ') || 'a file'} changed`
          files.clear()
          devChanged(r, why)
        }, 300)
      })
      w.on('error', () => (w.close(), watchers.delete(r))) // the folder went: linked still, watched again at the next scan
      watchers.set(r, w)
    } catch {}
  }
}
function devChanged(root: string, why: string) {
  if (!watchers.has(root)) return // unlinked meanwhile
  scanWidgets()
  for (const w of widgets.values()) {
    if (!w.dev || !under(pathOf(w), root)) continue
    wLog(w, w.devError ? `${why}: last good version kept: ${w.devError}` : `${why}: reloaded`)
    if (!w.devError) refetch(w, 'dev', why)
  }
}
// at shutdown, and in tests
export function widgetsStop() {
  for (const w of watchers.values()) w.close()
  watchers.clear()
}

// a button's words: widget.json's label, badge and tip filled from its data (as a preview is), plain text on a line
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENT[e])
    .replace(/\s+/g, ' ')
    .trim()
function faceOf(w: Entry, data: unknown, ws?: string, meta: Omit<Inst, 'data'> = ws ? (w.inst.get(ws) ?? {}) : w.s): Face {
  const x = ws ? state.workspaces.find(v => v.id === ws) : undefined
  const ctx = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), data, config: typedOf(w), at: meta.at, error: meta.error, workspace: x && wsInfo(x) } // {{open}} as {{data.open}}
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
    ...(scoped(w) && { scope: 'workspace' as const, inst: instView(w) }),
    byAi: w.s.by === 'ai' || undefined,
    dev: w.dev || undefined,
    devError: w.devError,
    mock: w.s.mock,
    sample: w.m.sample !== undefined || (!fetches(w) && w.m.sampleConfig !== undefined) || undefined, // a preview with made-up data
    rev,
    ...((placesOf(w).every(p => BUTTON_PLACES.includes(p)) || !w.preview) && { button: true }), // a tile elsewhere: its preview
    icon: iconOf(w),
    ...w.face,
    click: clickOf(w),
  }))

// a scope workspace one's instances in the view: each live workspace's that has fetched (or fetches now), its last fetch
// and its button's words
function instView(w: Entry) {
  const out: Record<string, { at?: number; error?: string; running?: boolean; mock?: string; label?: string; badge?: string; tip?: string }> = {}
  for (const x of state.workspaces) {
    const m = w.inst.get(x.id)
    const run = running.has(keyOf(w.id, x.id))
    if (!instOk(x) || (!m?.at && !run)) continue
    out[x.id] = { at: m?.at, error: m?.error, running: run || undefined, mock: m?.mock, ...m?.face }
  }
  return out
}

function find(id: string) {
  const w = widgets.get(id)
  if (!w) throw new Error(`no widget ${id}`)
  return w
}

// the widget's preview or full view as HTML, filled from its storage; null: it has no such view. A JS widget's is a
// whole page (pageOf), for a frame. widget.html's view, else its ui's (the UI kit's HTML for the cells it shows in:
// across, down, ½ a bar's line)
// sample: with widget.json's made-up data (and sampleConfig over its settings), as it would look; sample in the context
export function widgetRender(o: { id: string; full?: boolean; vars?: Record<string, string>; sample?: boolean; cells?: [number, number]; ws?: string }) {
  const w = find(o.id)
  const x = o.sample && scoped(w) && !o.ws ? undefined : wsOf(w, o.ws) // a sample: a made-up workspace, unless one's named
  const file = w.file ? '' : htmlOf(w.dir)
  const own = file ? viewOf(file, !!o.full) : undefined // no widget.html: ui's, or no view
  const tree = uiTree(w.m.ui, !!o.full)
  const fromUi = !!tree && !own?.trim()
  if (own === undefined && !fromUi) return null
  const s = dataOf(w, x?.id)
  const sc = w.m.sampleConfig && typeof w.m.sampleConfig === 'object' && !Array.isArray(w.m.sampleConfig) ? w.m.sampleConfig : {}
  const workspace = x ? wsInfo(x) : scoped(w) ? SAMPLE_WS : undefined
  const ctx = o.sample
    ? { data: w.m.sample, config: { ...typedOf(w), ...sc }, at: Date.now() - 120_000, error: undefined, full: !!o.full, sample: true, workspace }
    : { data: s.data, config: typedOf(w), at: s.at, error: s.error, full: !!o.full, workspace }
  const cells = Array.isArray(o.cells) ? (o.cells.map(Number) as [number, number]) : undefined
  const body = fromUi ? uiHtml(w.m.ui, ctx, { full: !!o.full, cells: cells ?? (o.full ? undefined : sizeOf(w)) }) : render(own!, ctx)
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
    const cells = /^(\d)x(\d(?:\.5)?)$/.exec(query.get('cells') ?? '')
    html = widgetRender({ id, full: query.get('full') === '1', sample: query.get('sample') === '1', vars: vars && typeof vars === 'object' ? vars : {}, cells: cells ? [Number(cells[1]), Number(cells[2])] : undefined, ws: query.get('ws') || undefined })
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
  if (onOf(w) && (o.on || o.config)) refetch(w, 'settings', undefined, () => true) // its data for the new settings (fetching: once more after)
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

// what a widget's command gets: $WIDGET_<NAME> for each setting (and $LAKI_WIDGET_CONFIG, all of them as JSON),
// $LAKI_WIDGET_FILE (its storage, for the last data), $LAKI_CLI (the laki command), $LAKI_REFRESH_REASON (why it runs)
function envOf(w: Entry, extra: Record<string, string>) {
  const env: Record<string, string> = {
    ...plainEnv(),
    LAKI_HOME: dir,
    LAKI_CLI: launcher(),
    LAKI_WIDGET: w.id,
    LAKI_WIDGET_FILE: storePath(w.id),
    LAKI_WIDGET_CONFIG: JSON.stringify(typedOf(w)),
    ...extra,
  }
  for (const [k, v] of Object.entries(configOf(w))) env[`WIDGET_${k.toUpperCase()}`] = v
  return env
}
type Ran = { out: string; err: string }
type Failed = Error & { stderr?: string; exit?: number }
// a widget's command, in its folder: stdout and stderr, or why it failed (with its stderr and exit code)
function exec(w: Entry, cmd: string, args: string[], extra: Record<string, string>) {
  return new Promise<Ran>((ok, no) =>
    own(
      execFile(cmd, args, { cwd: w.dir, env: envOf(w, extra), timeout: 120_000, maxBuffer: MAX_OUT }, (e, stdout, stderr) =>
        e
          ? no(Object.assign(new Error(lastLine(String(stderr)) || lastLine(String(stdout)) || (e.killed ? 'timed out after 2 minutes' : e.message)), { stderr: String(stderr), exit: typeof e.code === 'number' ? e.code : undefined }))
          : ok({ out: String(stdout), err: String(stderr) }),
      ),
      `Extension · ${w.m.name || w.id}`,
    ),
  )
}

const RUNS = 20
const runs = new Map<string, Run[]>()
const tail = (t?: string) => (t?.trim() ? t.trimEnd().split('\n').slice(-20).join('\n').slice(-4096) : undefined) // stderr's last 20 lines, 4 KB
function ran(id: string, r: Run) {
  const l = runs.get(id) ?? []
  l.unshift(r)
  if (l.length > RUNS) l.length = RUNS
  runs.set(id, l)
}

// a script's default export gets { config, last, workspace } (a scope workspace one's) and returns the data; one without prints it. What it throws is the
// error, its message alone (node would print the stack, then its version)
const RUN_JS = `import { readFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
try {
  const m = await import(pathToFileURL(process.argv[1]).href)
  if (typeof m.default === 'function') {
    let last
    try { last = JSON.parse(readFileSync(process.env.LAKI_WIDGET_FILE, 'utf8')).data } catch {}
    const data = await m.default({ config: JSON.parse(process.env.LAKI_WIDGET_CONFIG || '{}'), last, workspace: process.env.LAKI_WIDGET_WS ? JSON.parse(process.env.LAKI_WIDGET_WS) : undefined })
    process.stdout.write(JSON.stringify(data ?? null))
  }
} catch (e) {
  writeSync(2, String(e?.message ?? e) + '\\n') // at once: a pipe's write is async on macOS, exit wouldn't wait
  process.exit(1)
}`

// run the widget's fetch now (exec); what it prints must be JSON. A failure keeps the last data and says why.
// reason (RUN_REASONS: manual unless said; $LAKI_REFRESH_REASON), why: what changed (dev mode's file). Data put there by
// hand (widgetMock) stays: only Fetch now (manual) runs then, and its data replaces it
export const RUN_REASONS = ['schedule', 'open', 'settings', 'manual', 'reload', 'dev', 'select'] // and action:<name>
const AT_ONCE = 4 // a scope workspace one's instances fetching at a time
// force: laki widget check's run, an explicit ask, so an off one of the user's runs too (never one Laki AI wrote).
// ws: a scope workspace one's instance (its workspace's env, its own data)
export async function widgetRun(o: { id: string; reason?: string; why?: string; ws?: string }, force = false): Promise<{ ok: boolean; error?: string }> {
  const w = find(o.id)
  const x = wsOf(w, o.ws)
  const k = keyOf(w.id, x?.id)
  const meta = metaOf(w, x?.id)
  const reason = typeof o.reason === 'string' && (RUN_REASONS.includes(o.reason) || /^action:[\w.-]{1,40}$/.test(o.reason)) ? o.reason : 'manual'
  if (!onOf(w) && !(force && w.s.by !== 'ai')) return { ok: false, error: OFF(w) }
  if (!fetches(w)) return { ok: false, error: `${w.id} has no fetch or script` }
  if (meta.mock && reason !== 'manual') return wLog(w, `not fetched (${reason}): showing sample data (${meta.mock})`), { ok: false, error: `showing sample data (${meta.mock}): Live in its inspector fetches again` }
  if (running.has(k)) return again.add(k), { ok: false, error: 'already fetching: it fetches again after this one' }
  if (x && [...running].filter(r => r.startsWith(`${w.id}@`)).length >= AT_ONCE) return { ok: false, error: `${AT_ONCE} of its workspaces fetch now: again in a moment` } // ponytail: the next tick's, no queue
  const script = w.m.script ? resolve(w.dir, w.m.script) : undefined
  if (script && !script.startsWith(w.dir + '/')) return { ok: false, error: `${w.m.script} isn't in the widget's folder` }
  running.add(k)
  changed()
  const t0 = Date.now()
  wLog(w, `fetch (${reason}${x ? `, ${x.id}` : ''}): ${script ? `node ${w.m.script}` : w.m.fetch}`)
  let data: unknown
  let error: string | undefined
  let r: Ran | undefined
  let fail: Failed | undefined
  try {
    // a script on Laki's own node (Electron's, as node, in the app)
    r = await exec(w, script ? process.execPath : '/bin/sh', script ? ['--input-type=module', '-e', RUN_JS, script] : ['-c', w.m.fetch!], { LAKI_REFRESH_REASON: reason, ...wsEnv(w, x), ...(script && process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) })
    try {
      data = JSON.parse(r.out)
    } catch {
      throw new Error(`fetch printed no JSON: ${lastLine(r.out) ?? 'nothing'}`)
    }
  } catch (e) {
    fail = e as Failed
    error = fail.message
  }
  running.delete(k)
  const ms = Date.now() - t0
  ran(k, { at: t0, ms, reason, why: o.why, ok: !error, bytes: r ? Buffer.byteLength(r.out) : 0, error, stderr: tail(fail?.stderr ?? r?.err), exit: error ? (fail?.exit ?? 0) : 0 })
  wLog(w, () => (error ? `fetch failed after ${ms} ms: ${error}` : `fetched in ${ms} ms: ${JSON.stringify(data)?.length ?? 0} bytes of JSON`))
  const gone = !!x && !state.workspaces.includes(x) // deleted meanwhile: nothing kept
  if (!gone)
    keep(w, x?.id, s => {
      if (!error) (s.data = data), (s.mock = undefined)
      s.at = Date.now()
      s.error = error
    })
  changed()
  const cur = widgets.get(w.id)
  if (again.delete(k) && cur && onOf(cur) && !gone) soon({ id: w.id, reason, ws: x?.id }) // with the settings as they are now
  return error ? { ok: false, error } : { ok: true }
}

// a button's command (widget.json's actions), its data-arg as $WIDGET_ARG (never in the command line); then the widget
// fetches again, to show what it changed. What it prints as JSON with toast or modal (sayOf) is what the app shows
export async function widgetAction(o: { id: string; action: string; arg?: string; ws?: string }): Promise<{ ok: boolean; out?: string; error?: string } & WidgetSay> {
  const w = find(o.id)
  const x = wsOf(w, o.ws) // a scope workspace one's: the workspace it was clicked in
  const k = keyOf(w.id, x?.id)
  if (!onOf(w)) return { ok: false, error: OFF(w) }
  const cmd = w.m.actions && Object.hasOwn(w.m.actions, o.action) ? w.m.actions[o.action] : undefined
  if (typeof cmd !== 'string') return { ok: false, error: `${w.m.name || w.id} has no action ${o.action}` }
  wLog(w, `action ${o.action}${o.arg ? ` (${String(o.arg).slice(0, 200)})` : ''}`)
  const reason = `action:${o.action}`
  const t0 = Date.now()
  try {
    const { out, err } = await exec(w, '/bin/sh', ['-c', cmd], { WIDGET_ARG: String(o.arg ?? ''), LAKI_REFRESH_REASON: reason, ...wsEnv(w, x) })
    ran(k, { at: t0, ms: Date.now() - t0, reason, action: o.action, ok: true, bytes: Buffer.byteLength(out), stderr: tail(err), exit: 0 })
    wLog(w, `action ${o.action} done: ${lastLine(out) ?? 'printed nothing'}`)
    if (fetches(w) && (!x || state.workspaces.includes(x))) soon({ id: w.id, reason: /^[\w.-]{1,40}$/.test(o.action) ? reason : 'manual', ws: x?.id }) // fetching already: once more after it
    let say: WidgetSay | null = null
    for (const s of [out, lastLine(out)]) // all of it, or its last line after some log lines
      try {
        if ((say = sayOf(JSON.parse(s ?? '')))) break
      } catch {}
    return say ? { ok: true, ...say } : { ok: true, out: lastLine(out) }
  } catch (e) {
    const f = e as Failed
    ran(k, { at: t0, ms: Date.now() - t0, reason, action: o.action, ok: false, bytes: 0, error: f.message, stderr: tail(f.stderr), exit: f.exit })
    wLog(w, `action ${o.action} failed: ${f.message}`)
    return { ok: false, error: f.message }
  }
}

// every 30 s, and as the app connects or its window shows again: each widget that's on and due fetches (its every
// minutes since the last try, which a failure counts as), only while the app's window is open (a client whose page is
// visible: closing the window only hides it) and within settings.widgetHours (9am-9pm weekdays; a line that doesn't
// read: always): no API calls nobody sees. Fetch now and a change of settings still fetch
// A scope workspace one fetches only its instances on screen (onScreen): every minutes each, and at once (select) as its
// workspace is selected if it's older than that. ponytail: never the others (the sidebar's rows would want them)
export function widgetTick(now = Date.now(), reason: 'schedule' | 'open' | 'select' = 'schedule') {
  if (![...clients].some(c => c.view?.shown !== false)) return
  const here = onScreen()
  const hours = typeof state.settings?.widgetHours === 'string' && state.settings.widgetHours.trim() ? parseHours(state.settings.widgetHours) : null
  if (hours && !('error' in hours) && !inHours(hours, now)) {
    for (const w of widgets.values()) if (scoped(w) ? here.some(ws => due(w, now, ws)) : due(w, now)) wLog(w, () => `not fetched: outside the working hours (${describeHours(hours)})`)
    return
  }
  for (const w of widgets.values())
    if (scoped(w)) for (const ws of here) due(w, now, ws) && soon({ id: w.id, reason, ws })
    else if (reason !== 'select' && due(w, now)) soon({ id: w.id, reason })
}
// fetch it now where it shows: a global one, or a scope workspace one's instances on screen (gate: which may)
function refetch(w: Entry, reason: string, why?: string, gate: (w: Entry, ws?: string) => boolean = fetchable) {
  for (const ws of scoped(w) ? onScreen() : [undefined]) if (gate(w, ws)) soon({ id: w.id, reason, why, ws })
}
const soon = (o: { id: string; reason: string; why?: string; ws?: string }) => void widgetRun(o).catch(e => wLog(o, `not fetched: ${(e as Error).message}`)) // a workspace gone meanwhile
// the workspaces on screen: each shown window's selected one (its view's ws, else the workspace of its tab)
function onScreen() {
  const ids = new Set<string>()
  for (const c of clients) {
    if (c.view?.shown === false) continue
    const id = c.view?.ws === undefined ? state.tabs.find(t => t.id === c.view?.tab)?.workspace : c.view.ws
    const x = id ? state.workspaces.find(v => v.id === id) : undefined
    if (x && instOk(x)) ids.add(x.id)
  }
  return [...ids]
}

// an extension's files, as text (Laki AI's and MCP's laki_extension_read: an example to copy, or the one to change):
// its folder's own files only, none hidden, and fixtures/*.json, 20 at most; a one-file extension's file
const filesIn = (d: string) => {
  try {
    return readdirSync(d, { withFileTypes: true }).filter(x => x.isFile() && !x.name.startsWith('.')).map(x => x.name)
  } catch {
    return []
  }
}
export function widgetFiles(o: { id: string }) {
  const w = find(o.id)
  const files: Record<string, string> = {}
  for (const n of (w.file ? [w.file] : [...filesIn(w.dir), ...fixturesOf(w).map(f => `fixtures/${f}.json`)]).slice(0, 20)) {
    const p = join(w.dir, n)
    const buf = statSync(p).size > 64 << 10 ? null : readFileSync(p)
    files[n] = !buf ? '(over 64 KB: not shown)' : buf.includes(0) ? '(binary: not shown)' : buf.toString('utf8')
  }
  return { id: w.id, builtin: w.builtin || undefined, files }
}

// an extension made or changed by Laki AI or an MCP client (laki_extension_write): its files in Laki's own folder only
// (<data>/widgets/<id>, never another folder's, the user's own there, nor through a link), files left out kept. Saved off: its fetch runs shell
// commands a model wrote, so the user turns it on in Settings › Extensions after a look
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const FILE = /^\w[\w.-]{0,59}$/
const FIXTURE = /^fixtures\/\w[\w.-]{0,59}\.json$/ // the one folder: sample data
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
    if (!(FILE.test(n) || FIXTURE.test(n)) || n.includes('..')) throw new Error(`${n}: a file's name in the extension's folder, no folders but fixtures/<name>.json`)
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
  if (files.some(([n]) => n.startsWith('fixtures/'))) {
    const f = statOf(join(d, 'fixtures'))
    if (f && !f.isDirectory()) throw new Error('fixtures is a link or a file there')
    mkdirSync(join(d, 'fixtures'), { recursive: true })
  }
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
  if (w.dev) throw new Error(`${w.m.name || w.id} is your code, linked by laki widget dev: unlink it instead (laki widget dev --off ${w.id})`)
  if (running.has(w.id)) throw new Error(`${w.m.name || w.id} is fetching: try again in a moment`)
  const d = resolve(pathOf(w))
  if (!w.file && [homedir(), dir, widgetHome(), '/'].includes(d)) throw new Error(`${d} isn't one extension's own folder`) // a widget.json put in one of those
  rmSync(d, { recursive: !w.file, force: true }) // a link: only the link; a one-file extension: its file
  rmSync(storePath(w.id), { force: true })
  rmSync(join(dir, 'widget-data', w.id), { recursive: true, force: true }) // its workspaces' instances
  wLog(w, `deleted: ${d}`)
  scanWidgets()
  return { deleted: w.id }
}

// a widget's folder, for Open in (core's openIn)
export const widgetDir = (id: string) => find(id).dir

// Settings' Reload: the folders again, then every widget that's on fetches
export function widgetReload() {
  scanWidgets()
  for (const w of widgets.values()) refetch(w, 'reload')
  return widgetsView()
}

// the inspector's Runs and Env and laki widget dev's lines: the last runs, what a fetch is given (a setting whose name
// says token, secret, key or password masked, in $LAKI_WIDGET_CONFIG too), its fixtures (fixtures/<name>.json)
const SECRET = /token|secret|key|password/i
export function widgetRuns(o: { id: string; data?: boolean; ws?: string }): WidgetRuns {
  const w = find(o.id)
  const x = wsOf(w, o.ws) // a scope workspace one's instance
  const k = keyOf(w.id, x?.id)
  const data = o.data ? JSON.stringify(dataOf(w, x?.id).data ?? null, null, 2) : undefined // the inspector's Data: its JSON (256 KB of it at most)
  const masked = new Set(optionsOf(w).filter(x => SECRET.test(x.key) && configOf(w)[x.key]).map(x => x.key))
  const env = Object.fromEntries(
    Object.entries(envOf(w, { LAKI_REFRESH_REASON: runs.get(k)?.[0]?.reason ?? 'schedule', ...wsEnv(w, x) }))
      .filter(([k]) => /^(WIDGET_|LAKI_)/.test(k) || k === 'PATH' || k === 'PORT')
      .map(([k, v]) => [k, k === 'LAKI_WIDGET_CONFIG' ? JSON.stringify(Object.fromEntries(Object.entries(typedOf(w)).map(([n, x]) => [n, masked.has(n) ? '••••' : x]))) : [...masked].some(n => k === `WIDGET_${n.toUpperCase()}`) ? '••••' : v])
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  return { runs: runs.get(k) ?? [], env, fixtures: fixturesOf(w), devError: w.devError, mock: metaOf(w, x?.id).mock, ...(data !== undefined && { data: data.length > 256 << 10 ? undefined : data, big: data.length > 256 << 10 || undefined }) }
}
const fixtureNames = (d: string) => {
  try {
    return readdirSync(join(d, 'fixtures')).filter(n => /^[\w.-]+\.json$/.test(n)).sort()
  } catch {
    return []
  }
}
const fixturesOf = (w: Entry) => (w.file ? [] : fixtureNames(w.dir).map(n => n.slice(0, -5)))

// sample data by hand (the inspector's Data): data, or a fixture of its folder's, kept as its data (mock: which), not
// fetched meanwhile (a schedule skips it); off: back to live, fetched now. Runs nothing, so an off one takes it too
export async function widgetMock(o: { id: string; data?: unknown; fixture?: string; off?: boolean; ws?: string }) {
  const w = find(o.id)
  const ws = wsOf(w, o.ws)?.id // a scope workspace one's instance
  if (o.off) {
    keep(w, ws, s => (s.mock = undefined))
    changed()
    return fetchable(w, ws) ? widgetRun({ id: w.id, ws }) : { ok: true }
  }
  let data: unknown
  let mock: string
  if (o.fixture !== undefined) {
    const n = String(o.fixture)
    if (!fixturesOf(w).includes(n)) throw new Error(`${w.m.name || w.id} has no fixtures/${n}.json`)
    try {
      data = JSON.parse(readFileSync(join(w.dir, 'fixtures', `${n}.json`), 'utf8'))
    } catch (e) {
      throw new Error(`fixtures/${n}.json: ${(e as Error).message}`)
    }
    mock = n
  } else if ('data' in o) (data = o.data), (mock = 'edited')
  else throw new Error('data, a fixture, or off')
  keep(w, ws, s => Object.assign(s, { data, at: Date.now(), error: undefined, mock }))
  wLog(w, `sample data: ${mock}${ws ? ` (${ws})` : ''}`)
  changed()
  return { ok: true, mock }
}

// laki widget dev: link a folder of your own code (a widget's, or a folder of them): kept in settings.widgetDev,
// scanned first and watched, its widgets turned on (you ran it on your own code) and fetched. off: unlink it (by its
// folder or a widget's id); list: the links
export function widgetDev(o: { folder?: string; off?: string; list?: boolean }) {
  const links = () => devRoots().map(folder => ({ folder, widgets: [...widgets.values()].filter(w => w.dev && under(pathOf(w), folder)).map(w => ({ id: w.id, name: w.m.name || w.id, on: onOf(w), devError: w.devError })) }))
  if (o.list) return { links: links() }
  if (o.off !== undefined) {
    const t = String(o.off)
    const w = widgets.get(t)
    const folder = devRoots().find(r => (w?.dev && under(pathOf(w), r)) || r === resolve(home(t)))
    if (!folder) throw new Error(`${t} isn't linked (laki widget dev --list)`)
    settingsSet({ widgetDev: devRoots().filter(r => r !== folder) })
    return { unlinked: folder, links: links() }
  }
  const folder = resolve(home(String(o.folder ?? '')))
  const found = foldersIn(folder)
  if (!o.folder || !found.length) throw new Error(`${folder} has no widget.json, nor folders with one`)
  const bad = found.map(x => [pathOf(x), x.file ? oneFile(x.d, x.file) : manifestOf(x.d)] as const).filter(([, m]) => typeof m === 'string')
  settingsSet({ widgetDev: [...new Set([...devRoots(), folder])] }) // scans: its widgets first, watched
  const mine = [...widgets.values()].filter(w => w.dev && under(pathOf(w), folder))
  for (const w of mine)
    if (!onOf(w)) {
      writeStore(w.id, { ...readStore(w.id), on: true })
      w.s = { ...w.s, on: true }
    }
  changed()
  for (const w of mine) if (!w.devError) refetch(w, 'dev', 'linked')
  return { folder, widgets: mine.map(w => ({ id: w.id, name: w.m.name || w.id, devError: w.devError })), broken: bad.map(([d, m]) => `${d}: ${m}`) }
}

// laki widget new (Settings › Extensions › New ▾): a starter (widgetStarters.ts) in its own folder, <data>/widgets/<id>
// (dir: another, empty or new, which laki widget dev then links; a one-file one goes in the folder itself), the id from
// its name, made unique. The user's own (not by: 'ai'): on, and fetched at once
export async function widgetNew(o: { kind?: string; name?: string; dir?: string }) {
  const kind = String(o.kind ?? 'list') as StarterKind
  if (!STARTER_KINDS.includes(kind)) throw new Error(`a kind: ${STARTER_KINDS.join(', ')}`)
  const name = String(o.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('a name')
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'extension'
  const own = o.dir === undefined || !String(o.dir).trim()
  const taken = (id: string) => widgets.has(id) || existsSync(storePath(id)) || (own && (existsSync(join(widgetHome(), id)) || filesIn(widgetHome()).some(n => n.startsWith(`${id}.`))))
  let id = slug
  for (let n = 2; taken(id); n++) id = `${slug}-${n}`
  const files = STARTERS[kind].files(id, name)
  const folder = own ? (kind === 'onefile' ? widgetHome() : join(widgetHome(), id)) : resolve(home(String(o.dir).trim()))
  const there = statOf(folder)
  if (!own && there && (!there.isDirectory() || (kind !== 'onefile' && readdirSync(folder).length))) throw new Error(`${folder} isn't an empty folder: a new one, or one with nothing in it`)
  for (const [n, t] of Object.entries(files)) {
    const p = join(folder, n)
    if (statOf(p)) throw new Error(`${p} is there already`)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, t)
    chmodSync(p, t.startsWith('#!') ? 0o755 : 0o644)
  }
  writeStore(id, { on: true }) // yours, on
  scanWidgets()
  const at = kind === 'onefile' ? join(folder, Object.keys(files)[0]) : folder
  const w = widgets.get(id)
  const found = !!w && pathOf(w) === at // in a folder of your own: once laki widget dev links it
  wLog({ id }, `made from the ${kind} starter in ${folder}`)
  if (found && scoped(w)) refetch(w, 'manual', 'made')
  else if (found && fetchable(w)) await widgetRun({ id, reason: 'manual', why: 'made' })
  return { id, dir: at, files: Object.keys(files), found }
}

// laki widget check (the inspector's Check, MCP's laki_extension_check): what's wrong with an extension, by its id or a
// folder (a widget's, a one-file one, or a folder of them): widget.json (manifestCheck), widget.html's and ui's
// templates, ui (uiCheck) against its sample and each fixture, a one-file one's interval. run: its fetch once (manual,
// as Fetch now), the ui against what it printed; never one Laki AI wrote while it's off: the user looks at it first
export async function widgetCheck(o: { id?: string; dir?: string; run?: boolean; ws?: string }): Promise<{ id?: string; problems: UiProblem[] }> {
  let srcs: Source[]
  if (o.id !== undefined) {
    const w = find(String(o.id))
    srcs = [{ d: w.dir, file: w.file }]
  } else {
    const d = resolve(home(String(o.dir ?? '')))
    srcs = o.dir ? foldersIn(d) : []
    if (!srcs.length) throw new Error(`${d} has no widget.json, nor folders with one`)
  }
  const problems: UiProblem[] = []
  for (const x of srcs) {
    const ps = await checkOne(x, !!o.run, o.ws || undefined)
    problems.push(...(srcs.length > 1 ? ps.map(p => ({ ...p, where: `${idOf(x)}: ${p.where}` })) : ps))
  }
  return { id: srcs.length === 1 ? idOf(srcs[0]) : undefined, problems }
}
// what a scope workspace one should use of its workspace, somewhere in its fetch, its files or its ui
const WS_USE = /\$\{?(LAKI_(WORKSPACE|WORKSPACE_NAME|PROJECT|BRANCH|BASE|PATH|PR|STORAGE_FOLDER|WIDGET_WS)|PORT)\b|\bworkspace\b/
async function checkOne(x: Source, run: boolean, ws?: string): Promise<UiProblem[]> {
  const out: UiProblem[] = []
  const say = (level: UiProblem['level'], where: string, text: string) => out.push({ level, where, text })
  const id = idOf(x)
  const head = x.file ?? 'widget.json'
  let m: Record<string, unknown>
  if (x.file) {
    const one = oneFile(x.d, x.file)
    if (typeof one === 'string') return say('error', head, one), out
    const { seconds, ...rest } = one
    if (seconds) say('error', head, `every ${seconds} s: at most once a minute (${id}.1m.${x.file.split('.').pop()})`)
    m = rest
  } else {
    let j: unknown
    try {
      j = JSON.parse(readFileSync(join(x.d, 'widget.json'), 'utf8'))
    } catch (e) {
      return say('error', head, (e as Error).message), out
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return say('error', head, 'an object: { "name": … }'), out
    m = j as Record<string, unknown>
  }
  const mp = manifestCheck(m).map(p => (x.file ? { ...p, where: p.where.replace(/^widget\.json/, x.file), text: p.text.replace('no sample:', 'no <laki.sample>:') } : p))
  out.push(...mp)
  if (!mp.some(p => p.level === 'error')) say('ok', head, 'reads')
  if (typeof m.script === 'string') {
    const p = resolve(x.d, m.script)
    if (!p.startsWith(x.d + '/')) say('error', 'widget.json script', `${m.script} isn't in the extension's folder`)
    else if (!existsSync(p)) say('error', 'widget.json script', `no file ${m.script}`)
  }
  const html = x.file ? '' : htmlOf(x.d)
  const bad = templatesError(m as Manifest, html)
  if (bad) say('error', bad.startsWith('ui:') ? 'ui' : 'widget.html', bad.replace(/^(ui|widget\.html): /, ''))
  else if (html) say('ok', 'widget.html', 'its templates read')
  // ui: alone, then against each set of data (only what the data adds)
  const actions = m.actions && typeof m.actions === 'object' && !Array.isArray(m.actions) ? Object.keys(m.actions) : []
  const ui = m.ui
  const key = (p: UiProblem) => `${p.level}|${p.where}|${p.text}`
  const alone = ui === undefined ? [] : uiCheck(ui, undefined, { actions })
  const seen = new Set(alone.map(key))
  const against = (data: unknown, what: string) => {
    const ps = uiCheck(ui, data, { actions }).filter(p => !seen.has(key(p)))
    out.push(...ps.map(p => ({ ...p, where: `${what} · ${p.where}` })))
    if (!ps.length) say('ok', what, 'fits the ui')
  }
  if (ui !== undefined) {
    out.push(...alone)
    if (!alone.length) say('ok', 'ui', 'its elements check out')
    if (m.sample !== undefined) against(m.sample, 'sample')
  }
  for (const n of x.file ? [] : fixtureNames(x.d)) {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(join(x.d, 'fixtures', n), 'utf8'))
    } catch (e) {
      say('error', `fixtures/${n}`, (e as Error).message)
      continue
    }
    if (ui !== undefined) against(data, `fixtures/${n}`)
    else say('ok', `fixtures/${n}`, 'reads')
  }
  // a one-file extension's id is its name's first part: renamed, its settings stay under the old one
  if (x.file && !existsSync(storePath(id))) {
    const lost = filesIn(join(dir, 'widget-data')).filter(n => n.endsWith('.json') && !widgets.has(n.slice(0, -5))).map(n => n.slice(0, -5))
    if (lost.length) say('warn', head, `no settings kept for ${id}; ${lost.join(', ')} ${lost.length > 1 ? 'have' : 'has'} some, and no extension: renamed? The old name brings them back`)
  }
  if (m.scope === 'workspace') {
    const texts = [m.fetch, JSON.stringify(ui ?? ''), html, ...(x.file ? [readFileSync(join(x.d, x.file), 'utf8')] : filesIn(x.d).filter(n => /\.(sh|bash|zsh|py|rb|m?js|ts)$/.test(n)).map(n => (statSync(join(x.d, n)).size < 64 << 10 ? readFileSync(join(x.d, n), 'utf8') : '')))]
    if (!texts.some(t => typeof t === 'string' && WS_USE.test(t))) say('warn', head, 'per workspace, but its fetch and ui use nothing of the workspace ($LAKI_BRANCH, $PORT, {{workspace.branch}}…): "scope": "global"?')
  }
  if (run && (m.fetch || m.script)) {
    const w = widgets.get(id)
    if (!w || pathOf(w) !== pathOf(x)) say('warn', 'fetch', `not run: Laki doesn't have this one (laki widget dev ${pathOf(x)} links it)`)
    else if (!onOf(w) && w.s.by === 'ai') say('warn', 'fetch', "not run: Laki AI wrote it and it's off: turn it on first")
    else if (scoped(w) && !ws) say('warn', 'fetch', 'not run: per workspace, which one? (--ws <id>)')
    else {
      const r = await widgetRun({ id, reason: 'manual', why: 'check', ws }, true).catch(e => ({ ok: false, error: (e as Error).message }))
      const last = runs.get(keyOf(id, scoped(w) ? ws : undefined))?.[0]
      if (!r.ok) say('error', 'fetch', `${r.error}${last && !last.ok && last.exit ? ` (exit ${last.exit})` : ''}`)
      else {
        say('ok', 'fetch', `printed ${last?.bytes ?? 0} B of JSON in ${last?.ms ?? 0} ms`)
        if (ui !== undefined) against(dataOf(w, scoped(w) ? ws : undefined).data, 'fetched')
      }
    }
  }
  return out
}
