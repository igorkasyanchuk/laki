// Widgets: small pages in the sidebar (a 3-column grid), each a folder with widget.json (name, size, config, a
// fetch command and how often it runs) and widget.html (a template, shared/widget.ts). The daemon runs each
// widget's fetch on its schedule and keeps what it printed (JSON) in the widget's storage, <data>/widget-data/<id>.json,
// with the user's config. Only a list of them stays in memory: the page and the data are read when the app shows one.
import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFileSync, chmodSync, cpSync, type Dirent, existsSync, type FSWatcher, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { AI_SOURCE_EVERY, BUTTON_PLACES, LOG_LEVELS, type LogLevel, type WidgetLogLine, type Preset, WIDGET_SOURCES, type WidgetSource, type Workspace, type WidgetEvent, CUSTOM_EVENT, type EventSent, type Gate, type GateHeld, type WidgetOption, type WidgetStream, type WidgetTool, type WidgetRun, type WidgetRuns, type WidgetPlace, type WidgetSize, type WidgetView, type WidgetHide, type WidgetCtx, WIDGET_PLACES } from '../shared/types.ts'
import { fill, hasFull, hasScript, pageOf, render, sayOf, templateError, viewOf, type WidgetSay } from '../shared/widget.ts'
import { reservedIn, uiCheck, uiHtml, type UiProblem, uiTree } from '../shared/widgetUi.ts'
import { actionCmd, actionMenu, aiActOf, gateOf, manifestCheck, needsSample, SECRET, SIZES_ACROSS, toolArgs, toolOf, toolSchema } from '../shared/widgetSchema.ts'
import { STARTER_KINDS, STARTERS, type StarterKind } from '../shared/widgetStarters.ts'
import { describeHours, inHours, parseHours } from '../shared/when.ts'
import { WIDGET_EVERY } from '../shared/widgetGuide.ts'
import { aiOnce } from './ai.ts'
import { agentCaller, broadcast, inside, changed, cliArgv, cliEnv, clients, devKeep, devLog, dir, execGroup, killGroup, own, plainEnv, presets, q, save, settingsSet, state, wsVars } from './core.ts'

// widget.json; config: its settings, each a default (text; a number, true/false or a list make that kind) or a Spec,
// given to fetch as $WIDGET_<NAME>; fetch: a shell command, or script: a JS file of the widget's that Laki's node runs
// (its default export, or what it prints); actions: commands its buttons run by name (data-run="name", data-arg:
// $WIDGET_ARG); view: the full view's size; place: where it shows at first (side, top, status, rail, foot: the user's
// choice wins). As a button (a rail or foot place, or no preview in widget.html): icon (an icon of the app's, or a
// character or two), label, badge and tip (templates over its data, as plain text), click (one of its actions).
// ui: the UI kit's elements (widgetUi.ts), one tree or { preview, full }: widget.html's own view wins, ui fills the other
type Spec = { type?: string; label?: string; hint?: string; default?: unknown; choices?: unknown[]; required?: boolean }
type ActionDef = string | { run?: string; tool?: unknown; ai?: string; tools?: string; profile?: string } // a command, or one an agent may call too (widgetSchema.ts' toolOf), or a prompt an agent answers (aiActOf)
type Manifest = { name?: string; description?: string; size?: [number, number]; every?: number; view?: string; place?: string | string[]; scope?: string; on?: Record<string, string>; stream?: boolean; fetch?: string; script?: string; config?: Record<string, unknown>; actions?: Record<string, ActionDef>; icon?: string; label?: string; badge?: string; tip?: string; click?: string; notify?: string; sample?: unknown; sampleConfig?: Record<string, unknown>; ui?: unknown; source?: unknown }
// sample: made-up data in the shape its fetch prints (sampleConfig: settings for it), for a preview before it runs (widgetRender sample)
// what's stored per widget: the user's choices over the manifest's (config: each setting as text), and the last fetch
// (at: when it ran; error: why it failed); net: its page may reach https sites (the user's switch, never widget.json's)
type Store = { fails?: number; log?: boolean; trusted?: string; changed?: boolean; source?: WidgetSource; on?: boolean; size?: [number, number]; every?: number; view?: string; place?: WidgetPlace | WidgetPlace[]; net?: boolean; hide?: WidgetHide; config?: Record<string, string>; data?: unknown; at?: number; error?: string; by?: 'ai'; aiMay?: number; mock?: string; told?: string; allow?: string[] } // trusted: a repo's extension's folder as it was when you turned it on (dirHash); changed: off because it changed since; log: keep a log (its Settings card's Keep a log, the user's only); allow: claude tools its agent may use unasked (Always, when it asked: widgetPermission); told: what its notify last said (keep); by: Laki AI wrote it (widgetWrite); aiMay: when Edit with Laki AI let it rewrite the user's own, once (AI_MAY); mock: data put there by hand (widgetMock: a fixture's name, or edited), not fetched
// preview: widget.html has one; face: its button's words, filled from the last data (faceOf)
type Face = { label?: string; badge?: string; tip?: string }
type Entry = { id: string; dir: string; file?: string; project?: string; builtin: boolean; dev: boolean; devError?: string; m: Manifest; full: boolean; js: boolean; preview: boolean; face: Face; s: Omit<Store, 'data'>; inst: Map<string, InstMeta>; fixtures: string[] } // fixtures: fixtures/<name>.json at its scan, made-up data to preview it with // inst: a scope workspace one's instances (by workspace id), their last fetch // dev: in a folder laki widget dev linked; devError: why its files don't read now (the last good version runs on)
// scope workspace: an instance per live workspace, its data in <data>/widget-data/<id>/ws/<wsId>.json (the settings stay
// the store's, shared); in memory its last fetch and its button's words
type Inst = { data?: unknown; at?: number; error?: string; mock?: string; told?: string; fails?: number } // fails: fetches failed in a row (due backs off)
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
// an agent's runs (an AI source's fetch, an AI action) by extension: stopped by Resources' Stop (agent:<id>), the
// inspector's, turning it off, a new source, deleting it, its folder gone, shutdown. A stopped fetch fails as stopped,
// its last data kept
type AgentRun = { c: AbortController; fetch: boolean } // fetch: its source's, else an action's
const agents = new Map<string, Set<AgentRun>>()
async function agentRun<T>(id: string, fetch: boolean, f: (signal: AbortSignal, stop: string) => Promise<T>): Promise<T> {
  const w = widgets.get(id)
  if (w) trusted(w)
  const c = new AbortController()
  const l = agents.get(id) ?? new Set()
  const run = { c, fetch }
  agents.set(id, l.add(run))
  changed()
  try {
    return await f(c.signal, `agent:${id}`)
  } finally {
    l.delete(run)
    if (!l.size && agents.get(id) === l) agents.delete(id)
    changed()
  }
}
export function stopAgents(id: string, fetches = false) {
  for (const k of [...again]) if (k === id || k.startsWith(`${id}@`)) again.delete(k) // not once more after it
  const l = [...(agents.get(id) ?? [])].filter(r => !r.c.signal.aborted && (!fetches || r.fetch))
  for (const r of l) r.c.abort()
  return { stopped: l.length }
}
let rev = 0 // each reload: the app renders its widgets again
// what a JS widget's page asks for (GET /widget/<id>?key=…): its data is the user's, so not for any page on this Mac
export const widgetKey = randomBytes(16).toString('hex')
// its data's source (the user's pick, else widget.json's, else its fetch); fetches: something to run or read
export function sourceOk(v: unknown): WidgetSource | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const kind = WIDGET_SOURCES.find(k => k === o.kind)
  if (!kind) return undefined
  if (kind === 'ai') {
    // an agent's prompt; claude's tools by name (mcp__slack, WebFetch, Bash(gh pr list:*)), never an option of its own
    const { prompt = '', tools = '', profile = '' } = o
    if (typeof prompt !== 'string' || prompt.length > SOURCE_MAX.prompt || typeof tools !== 'string' || tools.length > SOURCE_MAX.tools || TOOLS_BAD.test(tools) || typeof profile !== 'string' || profile.length > 200) return undefined
    return { kind, prompt, ...(tools.trim() && { tools: tools.trim() }), ...(profile.trim() && { profile: profile.trim() }) }
  }
  const key = kind === 'static' ? 'text' : kind === 'file' ? 'path' : kind === 'url' ? 'url' : ''
  const val = key ? (o[key] ?? '') : ''
  if (typeof val !== 'string' || val.length > SOURCE_MAX[key]) return undefined // too long: refused, never emptied
  return { kind, ...(key && { [key]: key === 'text' ? val : val.trim() }) }
}
// claude's tools as one argument: one starting with - would be an option of claude's ("Bash(git log --oneline:*)" isn't)
export const TOOLS_BAD = /[\n\r]|^\s*-/
const SOURCE_MAX: Record<string, number> = { text: 64 << 10, path: 1024, url: 2048, prompt: 16 << 10, tools: 1024 }
// a typed-in text's own data: what it shows before anything's fetched and kept
const typedData = (w: Entry) => (src => (src.kind === 'static' ? parsed(src.text ?? '', 'static').data : undefined))(sourceOf(w))
const sourceOf = (w: Entry): WidgetSource => w.s.source ?? sourceOk(w.m.source) ?? { kind: 'fetch' }
const ownFetch = (w: Entry) => !!(w.m.fetch || w.m.script)
const fetches = (w: Entry) => sourceOf(w).kind !== 'fetch' || ownFetch(w)
// Laki's own line about it: development mode's log, and its log file while it keeps one (a function: only then)
function wLog(w: { id: string }, text: string | (() => string), level: LogLevel = 'info') {
  const e = widgets.get(w.id)
  const t = e && logOn(e) && typeof text === 'function' ? text() : text
  devLog(`widget:${w.id}`, t)
  if (e && typeof t === 'string') xlog(e, level, 'laki', t)
}
const fetchable = (w: Entry, ws?: string) => onOf(w) && fetches(w) && !running.has(keyOf(w.id, ws)) && !metaOf(w, ws).mock // on, with a fetch, not fetching now, not showing data put there by hand
// and its every minutes since the last try, twice that after a failure, 4 times after two, 8 after three or more in a row
const due = (w: Entry, now: number, ws?: string) => !streaming(w) && sourceOf(w).kind !== 'static' && fetchable(w, ws) && (m => now - (m.at ?? 0) >= everyOf(w) * 60_000 * 2 ** Math.min(m.fails ?? 0, 3))(metaOf(w, ws))

const storePath = (id: string) => join(dir, 'widget-data', `${id}.json`)
const home = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
// where widgets are: Laki's own folder, the ones added in Settings, then the app's; the first of an id wins
export const widgetHome = () => join(dir, 'widgets')
// dev mode's folders (settings.widgetDev, laki widget dev): first, so a copy you work on shadows the installed one
const devRoots = () => [...new Set((state.settings?.widgetDev ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))))]
const under = (d: string, root: string) => d === root || d.startsWith(root + '/')
export const widgetRoots = () => [...devRoots(), widgetHome(), ...(state.settings?.widgetDirs ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))), ...(BUILTIN ? [BUILTIN] : [])]
// each usable project's .laki/extensions (as workflows' .laki/workflows), read from its own folder. ponytail: a
// branch's change to them in a worktree isn't read until it reaches the project's folder
const repoRoots = () => state.projects.filter(p => !p.kind && !p.host).map(p => ({ root: join(p.path, '.laki', 'extensions'), project: p.id }))

function readJson<T>(p: string): T | undefined {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}
const readStore = (id: string): Store => readJson<Store>(storePath(id)) ?? {}
function writeStore(id: string, s: Store) {
  masks.delete(id) // its settings may have changed: masked anew
  const p = storePath(id)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(`${p}.tmp`, JSON.stringify(s))
  renameSync(`${p}.tmp`, p)
}

// a secret setting's value (widget.json's "type": "secret"): <data>/widget-secrets.json, 0600, { [id]: { [key]: value } },
// as <data>/ai-key is kept: never in the store, state.json, the view or an export; only its fetch's and actions' env
// (and a script's config) get it. ponytail: a file, not the Keychain: security add-generic-password -w <value> would
// put it on a command line, where ps sees it
const secretsPath = () => join(dir, 'widget-secrets.json')
const readSecrets = () => readJson<Record<string, Record<string, string>>>(secretsPath()) ?? {}
const secretsOf = (id: string) => readSecrets()[id] ?? {}
function setSecrets(id: string, f: (s: Record<string, string>) => void) {
  masks.delete(id)
  const all = readSecrets()
  const s = { ...all[id] }
  f(s)
  if (Object.keys(s).length) all[id] = s
  else delete all[id]
  const p = secretsPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(`${p}.tmp`, JSON.stringify(all), { mode: 0o600 })
  chmodSync(`${p}.tmp`, 0o600) // a mode only counts for a new file
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
// a repo's extension (.laki/extensions) is its project's only: shown, fetched, run and asked there
const inProj = (w: Entry, x?: Workspace) => !w.project || x?.project === w.project
const projName = (w: Entry) => state.projects.find(p => p.id === w.project)?.name ?? w.project
const repoSays = (w: Entry, what: string) => `${w.m.name || w.id} is in ${projName(w)}'s .laki/extensions: ${what} there`
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
  if (!inProj(w, x)) throw new Error(`${w.m.name || w.id} is ${projName(w)}'s: not in ${given}`)
  return x
}
// what an instance knows of its workspace: agentVars' values (the agents' {{branch}}…, core's wsVars), for its fetch's
// env, a script's workspace, and templates' {{workspace.branch}}
function wsInfo(x: Workspace) {
  const v = wsVars(x)
  return { id: x.id, name: v.workspace ?? x.id, project: v.project, branch: v.branch, base: v.base, path: x.path, port: x.port, pr: v.pr, storage: x.storage }
}
type WsInfo = ReturnType<typeof wsInfo>
const SAMPLE_WS = { id: 'sample', name: 'fix-login', project: 'web', branch: 'fix-login', base: 'main', path: '~/code/web', port: 5173, pr: 'https://github.com/acme/web/pull/412' } // a preview's made-up one
// a workspace's env (never makes a storage folder); gone: one archived or removed (its event's info, taken then): no
// port, storage nor instance file to give
const infoEnv = (i: WsInfo, gone = false): Record<string, string> => ({ LAKI_WORKSPACE: i.id, LAKI_WORKSPACE_NAME: i.name, LAKI_PROJECT: i.project ?? '', LAKI_BRANCH: i.branch ?? '', LAKI_BASE: i.base ?? '', LAKI_PATH: i.path, ...(!gone && { PORT: String(i.port ?? '') }), LAKI_PR: i.pr ?? '', ...(!gone && i.storage && { LAKI_STORAGE_FOLDER: i.storage }), LAKI_WIDGET_WS: JSON.stringify(i) })
function wsEnv(w: Entry, x?: Workspace, gone?: WsInfo): Record<string, string> {
  if (gone) return { ...infoEnv(gone, true), LAKI_WIDGET_FILE: '' }
  return x ? { ...infoEnv(wsInfo(x)), LAKI_WIDGET_FILE: instPath(w.id, x.id) } : {}
}
// where an action was picked in the app (widgetAction ctx): a live workspace (a scope workspace one's: its own), a tab
// of it, a file of it (inside it, links followed). Its env, $LAKI_CTX as JSON, and what an AI action's prompt fills
function ctxOf(w: Entry, c: unknown, x?: Workspace) {
  if (!isObj(c)) return
  const id = typeof c.ws === 'string' && c.ws ? c.ws : x?.id
  const ws = id ? state.workspaces.find(v => v.id === id) : undefined
  if (id && !ws) throw new Error(`no workspace ${id}`)
  if (x && ws !== x) throw new Error(`${w.m.name || w.id} is per workspace: it runs in its own workspace only`)
  if (ws && !instOk(ws)) throw new Error(`${ws.id}: ${ws.archived ? 'archived' : ws.host ? `on ${ws.host}` : 'a terminal or a browser'}`)
  if (ws && !inProj(w, ws)) throw new Error(`${w.m.name || w.id} is ${projName(w)}'s: not in ${ws.id}`)
  const tab = typeof c.tab === 'string' && c.tab ? state.tabs.find(t => t.id === c.tab && t.workspace === ws?.id) : undefined
  if (typeof c.tab === 'string' && c.tab && !tab) throw new Error(`no tab ${c.tab}${ws ? ` in ${ws.id}` : ': which workspace? (ws)'}`)
  if (typeof c.file === 'string' && c.file && !ws) throw new Error('a file: which workspace? (ws)')
  const file = typeof c.file === 'string' && c.file && ws ? { path: c.file, abs: inside(ws, c.file) } : undefined
  const i = ws && wsInfo(ws)
  const info = { ...(i && { ws: i }), ...(tab && { tab: { id: tab.id, name: tab.name, agent: tab.preset } }), ...(file && { file }) }
  return { info, env: { ...(i && !x && infoEnv(i)), ...(tab && { LAKI_TAB: tab.id, LAKI_TAB_NAME: tab.name ?? '' }), ...(file && { LAKI_FILE: file.abs }), LAKI_CTX: JSON.stringify(info) } }
}
// an instance's (or a global one's) data, and its last fetch kept; the in-memory copy follows (a rescan's entry too)
const dataOf = (w: Entry, ws?: string): Inst => (ws ? readInst(w.id, ws) : (st => (st?.data !== undefined ? { ...readStore(w.id), data: st.data, at: w.s.at, error: undefined } : readStore(w.id)))(streams.get(w.id))) // a stream's last line, kept every 5 s
const metaOf = (w: Entry, ws?: string): Omit<Inst, 'data'> => (ws ? (w.inst.get(ws) ?? {}) : w.s)
function keep(w: Entry, ws: string | undefined, f: (s: Inst) => void) {
  const s = ws ? readInst(w.id, ws) : readStore(w.id) // its settings may have changed meanwhile
  const at = s.at
  f(s)
  // its notify, over data just kept (fetched, pushed, an action's: a new at; not sample data, nor a mock let go of):
  // said once each time it reads anew
  if (!s.error) delete s.fails
  const said = s.mock || !w.m.notify ? undefined : faceOf(w, s.data, ws, s, w.m.notify)
  if (said !== s.told && !s.mock && s.at !== at) {
    // told only once someone saw it: on, a window open (else said at its next fetch that has one); empty clears it
    if (!said) s.told = undefined
    else if (onOf(widgets.get(w.id) ?? w) && shown()) broadcast({ ev: 'widget-say', widget: w.id, ws, notify: said }), (s.told = said)
  }
  if (ws) writeInst(w.id, ws, s)
  else writeStore(w.id, s as Store)
  const cur = widgets.get(w.id) ?? w
  if (ws) cur.inst.set(ws, { at: s.at, error: s.error, mock: s.mock, fails: s.fails, face: faceOf(cur, s.data, ws, s) })
  else (cur.s = { ...cur.s, at: s.at, error: s.error, mock: s.mock, fails: s.fails }), (cur.face = faceOf(cur, s.data))
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
  if (state.widgetGrants?.[ws]) delete state.widgetGrants[ws] // its tools' Always (dropWs saves)
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
  const size = /^([1-4])\s*x\s*(0?\.5|[1-4])$/i.exec(tag('size') ?? '')
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

// a setting that's a secret now but still has a value in the store (made a secret since): moved to the secrets file
function moveSecrets(id: string, m: Manifest): Store {
  const st = readStore(id)
  const keys = Object.entries(m.config ?? {}).filter(([k, v]) => st.config && Object.hasOwn(st.config, k) && isObj(v) && v.type === 'secret').map(([k]) => k)
  if (!keys.length) return st
  setSecrets(id, kept => keys.forEach(k => st.config![k] && !kept[k] && (kept[k] = st.config![k])))
  for (const k of keys) delete st.config![k]
  writeStore(id, st)
  return st
}

// read every folder again (Settings' Reload, `laki widget reload`, a dev folder's change): new and changed widgets
// without a restart. A dev widget whose files don't read keeps its last good version running, with devError
export function scanWidgets() {
  const before = new Map(widgets)
  widgets.clear()
  masks.clear() // widget.json's settings read again
  rev++
  const dev = devRoots()
  // yours first, then the repos' (<project>.<id>: never over yours), then Laki's own
  const roots: { root: string; project?: string }[] = [...widgetRoots().filter(r => r !== BUILTIN).map(root => ({ root })), ...repoRoots(), ...(BUILTIN ? [{ root: BUILTIN }] : [])]
  for (const { root, project } of roots)
    for (const { d, file } of foldersIn(root)) {
      const id = project ? `${project}.${idOf({ d, file })}` : idOf({ d, file })
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
      const { data, ...s } = moveSecrets(id, m)
      const e: Entry = { id, dir: d, file, ...(project && { project }), builtin: !project && !!BUILTIN && under(d, BUILTIN), dev: isDev, devError: bad, m, full: hasFull(html) || !!uiTree(m.ui, true), js: hasScript(html), preview: !!viewOf(html, false)?.trim() || !!uiTree(m.ui, false), face: {}, s, inst: new Map(), fixtures: file ? [] : fixtureNames(d).map(n => n.slice(0, -5)) }
      e.face = faceOf(e, data)
      if (scoped(e)) e.inst = instsOf(id, e)
      widgets.set(id, e)
      if (project && e.s.on && e.s.trusted !== dirHash(e, true)) untrust(e) // changed in the repo since you turned it on
    }
  for (const k of [...devKeep]) if (k.startsWith('widget:')) devKeep.delete(k)
  for (const w of widgets.values()) if (w.dev) devKeep.add(`widget:${w.id}`) // a dev widget's log, dev mode or not
  watchDev(dev)
  watchRepos()
  for (const [id, was] of before) if (cmdsOf(was) !== cmdsOf(widgets.get(id))) ungrant(id) // its commands changed (a rewrite, an update): asked again
  const runOf = (w?: Entry) => w && JSON.stringify([pathOf(w), w.m.fetch, w.m.script, w.m.stream, w.m.scope])
  for (const id of [...streams.keys()]) if (runOf(before.get(id)) !== runOf(widgets.get(id))) stopStream(id) // its command changed, or it went: started again as it reads now (the others run on)
  for (const id of [...agents.keys()]) if (!widgets.has(id)) stopAgents(id) // its folder went
  streamSync()
  changed()
}

// a repo's extension that changed since you said yes: off, changed, its streams, agents and grants gone; said once
function untrust(e: Entry) {
  const st = readStore(e.id)
  Object.assign(st, { on: false, changed: true })
  writeStore(e.id, st)
  Object.assign(e.s, { on: false, changed: true })
  stopStream(e.id)
  stopAgents(e.id)
  ungrant(e.id)
  wLog(e, `its files changed in ${projName(e)}'s .laki/extensions: off until you look`, 'warn')
  broadcast({ ev: 'widget-say', widget: e.id, notify: `from ${projName(e)} changed: off until you look` }) // App: a toast and a notification, its name first
}
// each project's .laki/extensions watched (recursive), a second after the last change read again (scanWidgets: a
// changed one goes off). ponytail: a folder made after the scan is read at the next one (a project added, a reload)
const repoWatchers = new Map<string, FSWatcher>()
function watchRepos() {
  const roots = repoRoots().map(r => r.root)
  for (const [r, w] of repoWatchers) if (!roots.includes(r) || !existsSync(r)) (w.close(), repoWatchers.delete(r)) // gone (a branch without it): watched again once a scan finds it
  for (const r of roots) {
    if (repoWatchers.has(r) || !existsSync(r)) continue
    let timer: NodeJS.Timeout | undefined
    try {
      const w = watch(r, { recursive: true }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => repoWatchers.has(r) && scanWidgets(), 1000)
      })
      w.on('error', () => (w.close(), repoWatchers.delete(r)))
      repoWatchers.set(r, w)
    } catch {}
  }
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
      const one = !statSync(r).isDirectory() // a one-file extension: its folder watched, for that name (an editor's save by rename ends a watch of the file)
      const w = watch(one ? dirname(r) : r, { recursive: !one }, (_, f) => {
        const name = String(f ?? '')
        if (one ? name !== basename(r) : name.split('/').some(p => p.startsWith('.') || p === 'node_modules')) return
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
  for (const w of [...watchers.values(), ...repoWatchers.values()]) w.close()
  watchers.clear()
  repoWatchers.clear()
  for (const id of [...streams.keys()]) stopStream(id)
  for (const id of [...agents.keys()]) stopAgents(id)
  for (const p of execs) killGroup(p) // a fetch or an action under way, and what it started
  flushLogs()
}

// a button's words: widget.json's label, badge and tip filled from its data (as a preview is), plain text on a line
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENT[e])
    .replace(/\s+/g, ' ')
    .trim()
function faceOf(w: Entry, data: unknown, ws?: string, meta?: Omit<Inst, 'data'>): Face
function faceOf(w: Entry, data: unknown, ws: string | undefined, meta: Omit<Inst, 'data'>, one: string): string | undefined
function faceOf(w: Entry, data: unknown, ws?: string, meta: Omit<Inst, 'data'> = ws ? (w.inst.get(ws) ?? {}) : w.s, one?: string): Face | string | undefined {
  const x = ws ? state.workspaces.find(v => v.id === ws) : undefined
  data ??= typedData(w)
  const ctx = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), data, config: typedOf(w), at: meta.at, error: meta.error, workspace: x && wsInfo(x) } // {{open}} as {{data.open}}
  const fill = (t: unknown, n: number) => {
    if (typeof t !== 'string' || !t.trim()) return undefined
    try {
      return plain(render(t, ctx)).slice(0, n) || undefined
    } catch {
      return undefined
    }
  }
  if (one !== undefined) return fill(one, 300) // a notify's text
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
const ACROSS = SIZES_ACROSS.length // the sidebar's grid, cells across
const sizeOf = (w: Entry): [number, number] => {
  const [a, b] = w.s.size ?? w.m.size ?? [1, 1]
  return [clamp(a, 1, ACROSS, 1), down(b)]
}
const everyOf = (w: Entry) => (sourceOf(w).kind === 'ai' ? clamp(w.s.every ?? w.m.every, 15, 1440, AI_SOURCE_EVERY) : clamp(w.s.every ?? w.m.every, 1, 1440, WIDGET_EVERY)) // an agent's run costs: every 15 minutes at most
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

const TYPES: WidgetOption['type'][] = ['text', 'number', 'bool', 'choice', 'list', 'secret']
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
      const o: WidgetOption = { key, type, label: str(sp.label), hint: str(sp.hint), choices: type === 'choice' && Array.isArray(sp.choices) ? sp.choices.map(String) : undefined, required: (sp.required === true && type !== 'bool') || undefined }
      return { ...o, def: textOf(o, d) }
    })
}
// each setting's value as text: the user's, or its default. A secret's only with secrets (a fetch's, an action's env):
// '' everywhere else (the view, templates, a page)
function configOf(w: Entry, secrets = false) {
  const kept = secrets ? secretsOf(w.id) : {}
  return Object.fromEntries(optionsOf(w).map(o => [o.key, o.type === 'secret' ? (secrets ? (kept[o.key] ?? o.def) : '') : w.s.config && Object.hasOwn(w.s.config, o.key) ? textOf(o, w.s.config[o.key]) : o.def]))
}
// the same as values a page or a script reads: a bool true or false, a number (null: empty), a list an array of strings
function typedOf(w: Entry, secrets = false) {
  const c = configOf(w, secrets)
  return Object.fromEntries(optionsOf(w).map(o => [o.key, ((v: string) => (o.type === 'bool' ? v === '1' : o.type === 'number' ? (v === '' ? null : Number(v)) : o.type === 'list' ? (v ? v.split(',') : []) : v))(c[o.key])]))
}

// the secrets file read once, each one's settings once (k: its secrets, c: its settings as text)
export const widgetsView = (): WidgetView[] =>
  (sec => [...widgets.values()].map(w => [w, sec[w.id] ?? {}, configOf(w)] as const))(readSecrets()).map(([w, k, c]) => ({
    id: w.id,
    name: w.m.name || w.id,
    description: w.m.description,
    dir: w.dir,
    builtin: w.builtin || undefined,
    oneFile: !!w.file || undefined,
    allowed: w.s.allow,
    on: onOf(w),
    size: sizeOf(w),
    every: fetches(w) && sourceOf(w).kind !== 'static' ? everyOf(w) : undefined,
    source: sourceOf(w),
    ownFetch: ownFetch(w) || undefined,
    full: w.full,
    view: viewSize(w),
    place: placeOf(w),
    places: placesOf(w),
    net: (w.js && w.s.net) || undefined,
    hide: w.s.hide,
    js: w.js || undefined,
    ...(w.m.actions && Object.keys(w.m.actions).length && { actions: Object.keys(w.m.actions) }), // a scheduled task's picks
    ...(m => m.length && { menus: m })(Object.entries(w.m.actions ?? {}).flatMap(([action, a]) => (m => (m ? [{ action, ...m }] : []))(actionMenu(action, a)))), // offered in the palette, menus, a key, the prompt
    config: c,
    options: optionsOf(w).map(({ def: _, ...o }) => (o.type === 'secret' && k[o.key] ? { ...o, set: true } : o)),
    ...(m => m.length && { missing: m })(optionsOf(w).filter(o => o.required && !(o.type === 'secret' ? k[o.key] : c[o.key]?.trim())).map(o => o.key)), // required ones still empty: Set <label>
    at: w.s.at,
    error: w.s.error,
    running: running.has(w.id) || undefined,
    agent: agents.has(w.id) || undefined,
    ...(scoped(w) && { scope: 'workspace' as const, inst: instView(w) }),
    ...(toolsOf(w).length && { tools: toolsOf(w).map(([action, t]): WidgetTool => ({ action, description: t.description, ask: t.ask, grants: (k => Object.keys(state.widgetGrants ?? {}).filter(ws => state.widgetGrants![ws].includes(k)))(grantKey(w, action)) })) }),
    byAi: w.s.by === 'ai' || undefined,
    log: logOn(w) || undefined,
    keepLog: w.s.log || undefined,
    logErr: errAt.get(w.id),
    gates: (g => (g.length ? g : undefined))([...new Set(gatesOf(w).flatMap(([, x]) => gateOf(x)))]),
    project: w.project,
    repo: w.project && projName(w),
    changed: w.s.changed,
    ...(w.dir === join(widgetHome(), w.id) && (h => h.length && { history: h })(historyOf(w.id))),
    dev: w.dev || undefined,
    devError: w.devError,
    mock: w.s.mock,
    sample: w.m.sample !== undefined || (!fetches(w) && w.m.sampleConfig !== undefined) || undefined, // a preview with made-up data
    fixtures: w.fixtures.length ? w.fixtures : undefined, // more of it: widgetRender's sample by name
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
    if (!instOk(x) || !inProj(w, x) || (!m?.at && !run)) continue
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
export function widgetRender(o: { id: string; full?: boolean; vars?: Record<string, string>; sample?: boolean | string; cells?: [number, number]; ws?: string }) {
  const w = find(o.id)
  // sample: widget.json's, or a fixture's by its name (fixtures/<name>.json: busy, empty…)
  let made: unknown = w.m.sample
  if (typeof o.sample === 'string') {
    if (!fixturesOf(w).includes(o.sample)) throw new Error(`${w.m.name || w.id} has no fixtures/${o.sample}.json`)
    try {
      made = JSON.parse(readFileSync(join(w.dir, 'fixtures', `${o.sample}.json`), 'utf8'))
    } catch (e) {
      throw new Error(`fixtures/${o.sample}.json: ${(e as Error).message}`)
    }
  }
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
    ? { data: made ?? typedData(w), config: { ...typedOf(w), ...sc }, at: Date.now() - 120_000, error: undefined, full: !!o.full, sample: true, workspace }
    : { data: s.data ?? typedData(w), config: typedOf(w), at: s.at, error: s.error, full: !!o.full, workspace }
  const cells = Array.isArray(o.cells) ? (o.cells.map(Number) as [number, number]) : undefined
  const hide = w.s.hide // the user's switches: a template's at gone too ({{ago at}} empty, {{#if at}} not)
  const body = fromUi ? uiHtml(w.m.ui, ctx, { full: !!o.full, cells: cells ?? (o.full ? undefined : sizeOf(w)), hide }) : render(own!, hide?.at ? { ...ctx, at: undefined } : ctx)
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
    html = widgetRender({ id, full: query.get('full') === '1', sample: (v => (v === '1' ? true : v || undefined))(query.get('sample')), vars: vars && typeof vars === 'object' ? vars : {}, cells: cells ? [Number(cells[1]), Number(cells[2])] : undefined, ws: query.get('ws') || undefined })
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
// agent: an agent's change (MCP's laki_extension_set, Laki AI's too; laki widget set in an agent's tab): where it shows,
// its size, every, view, hide and plain settings; never on, network access, its source or a secret: those are the user's
export function widgetSet(o: { id: string; seen?: string; log?: boolean; source?: WidgetSource | null; on?: boolean; size?: [number, number]; every?: number; view?: WidgetSize; place?: WidgetPlace | WidgetPlace[]; net?: boolean; hide?: WidgetHide; config?: Record<string, string>; ai?: boolean; name?: string; allow?: string[]; from?: { ws?: string; tab?: string }; agent?: boolean }) {
  const w = find(o.id)
  if (o.agent === true || agentCaller(o.from)) {
    if (o.on === true) throw new Error('only you can turn an extension on (Settings › Extensions)') // its code would run unlooked at
    if (o.net === true || o.source !== undefined || o.ai || o.allow !== undefined || o.log !== undefined) throw new Error(`only you can change ${o.net === true ? 'its network access' : o.ai ? 'who edits it' : o.allow !== undefined ? 'the tools its agent may use' : o.log !== undefined ? 'whether it keeps a log' : 'its source'} (Settings › Extensions)`)
    const secret = Object.keys(o.config ?? {}).find(k => optionsOf(w).some(x => x.key === k && x.type === 'secret'))
    if (secret) throw new Error(`${secret} is a secret: only you set it (Settings › Extensions)`)
  }
  // seen: the files hash of what the user was shown (the studio's Turn on): on only while it's still that
  if (o.on === true && o.seen !== undefined && o.seen !== filesHash(w, true)) throw new Error(`${w.m.name || w.id} changed since you looked: look again`)
  // a repo's: on only after a look (laki widget what's hash), and trusted as its files are now
  if (o.on === true && w.project && !w.s.on && o.seen === undefined) throw new Error(`${w.m.name || w.id} comes with ${projName(w)}'s repo: look at what it runs first (laki widget what ${w.id})`)
  const s = readStore(w.id)
  if (o.on === true && w.project && o.seen !== undefined) Object.assign(s, { trusted: dirHash(w, true), changed: undefined })
  if (o.ai) {
    // Edit with Laki AI (Settings › Extensions): one of the user's in Laki's folder, which widgetWrite may then rewrite
    if (w.builtin || w.dir !== join(widgetHome(), w.id)) throw new Error(`${w.m.name ?? w.id} isn't in Laki's folder: Laki AI can't change it`)
    s.aiMay = Date.now()
  }
  if (o.on === true && !s.on) s.mock = undefined // turned on: live, not the sample data put there while it was off (the studio's)
  if (o.on !== undefined) s.on = !!o.on
  if (o.on === false) ungrant(w.id), stopAgents(w.id) // off: its tools' Always go, its agents stop
  if (o.source !== undefined) stopAgents(w.id, true) // an answer for the source it had would land over the new one's (its actions run on)
  if (o.size) s.size = [clamp(o.size[0], 1, ACROSS, 1), down(o.size[1])]
  if (o.every !== undefined) s.every = clamp(o.every, 1, 1440, WIDGET_EVERY)
  if (o.view !== undefined) s.view = isSize(o.view) ? o.view : undefined
  const badPlace = o.place === undefined ? undefined : (Array.isArray(o.place) ? o.place : [o.place]).find(x => !isPlace(x)) // a typo would put back widget.json's
  if (badPlace !== undefined) throw new Error(`no place ${badPlace}: ${WIDGET_PLACES.join(', ')}`)
  if (o.place !== undefined && placeList(o.place).includes('row') && !scoped(w)) throw new Error(`${w.m.name || w.id} is one for the app: a row's mark is per workspace`)
  if (o.place !== undefined) s.place = (l => (l.length > 1 ? l : l[0]))(placeList(o.place)) // none: widget.json's again
  if (o.net !== undefined) s.net = !!o.net || undefined
  if (o.log !== undefined) s.log = !!o.log || undefined // off: its file stays until Clear
  const yes = (v: unknown, was?: boolean) => (v === undefined ? was : v === true) || undefined // only true hides
  if (o.hide) s.hide = (h => (h.refresh || h.at ? h : undefined))({ refresh: yes(o.hide.refresh, s.hide?.refresh), at: yes(o.hide.at, s.hide?.at) })
  if (o.source !== undefined) {
    // null: widget.json's again; a fetch of its own only when it has one
    const src = o.source === null ? undefined : sourceOk(o.source)
    if (o.source !== null && !src) throw new Error(`a source: { kind: ${WIDGET_SOURCES.join(' | ')}, text (64 KB at most) | path | url }`)
    if (src?.kind === 'fetch' && !ownFetch(w)) throw new Error(`${w.m.name || w.id} has no fetch of its own: pick static, file or url`)
    if (src?.kind === 'url' && src.url && !/^https?:\/\//i.test(src.url) && !src.url.includes('{{')) throw new Error('a URL: http or https')
    s.source = src
    if (src) s.mock = undefined // its own data from now on, not sample data
  }
  if (o.allow !== undefined) {
    if (!Array.isArray(o.allow) || o.allow.some(t => typeof t !== 'string' || !TOOL_NAME.test(t))) throw new Error('allow: tool names')
    s.allow = o.allow.length ? [...new Set(o.allow)] : undefined
  }
  if (o.config) {
    const opts = new Map(optionsOf(w).map(x => [x.key, x]))
    const given = Object.entries(o.config).filter(([k]) => opts.has(k)).map(([k, v]) => [k, textOf(opts.get(k)!, v)])
    const secret = (k: string) => opts.get(k)!.type === 'secret'
    // a secret to its file: '' clears it, any other value replaces it (the app never has it to send back)
    if (given.some(([k]) => secret(k))) setSecrets(w.id, kept => given.filter(([k]) => secret(k)).forEach(([k, v]) => (v ? (kept[k] = v) : delete kept[k])))
    s.config = { ...Object.fromEntries(Object.entries(s.config ?? {}).filter(([k]) => opts.has(k) && !secret(k))), ...Object.fromEntries(given.filter(([k]) => !secret(k))) }
  }
  writeStore(w.id, s)
  wLog(w, `settings changed: ${[...Object.keys(o).filter(k => k !== 'id' && k !== 'config'), ...Object.keys(o.config ?? {})].join(', ')}`) // names only: a setting may be a key
  const { data, ...meta } = s
  w.s = meta
  w.face = faceOf(w, data) // its config, in its words
  changed()
  if (o.source !== undefined && !streaming(w)) stopStream(w.id) // its last line saved now, not over the new source's data
  if (sourceOf(w).kind === 'static' && o.source !== undefined && !scoped(w))
    keep(w, undefined, st => {
      // typed in: shown at once, on or off (a per-workspace one's instances: as each fetches)
      const p = parsed(sourceOf(w).text ?? '', 'static')
      if (!p.error) (st.data = p.data), (st.mock = undefined)
      st.error = p.error
      st.at = Date.now()
    })
  // its data for the new settings (fetching: once more after; a stream starts again); a new agent's prompt is the user's
  // ask, as Run now: else an agent's source waits out its every (widgetRun)
  const asked = o.source !== undefined && sourceOf(w).kind === 'ai'
  if (onOf(w) && (o.on || o.config || o.source !== undefined)) refetch(w, asked ? 'manual' : 'settings', asked ? 'its prompt changed' : undefined, () => true)
  streamSync() // off: a stream ends
  if (o.name !== undefined && rename(w, o.name)) scanWidgets() // its new name everywhere, nothing fetched
  return widgetsView().find(x => x.id === w.id)
}
// its name, written in widget.json (the page's name field; empty: its id): one of your folders' only (a built-in: Remix it;
// one file: its <laki.name> tag), the studio's Undo first as for any edit
function rename(w: Entry, name: unknown) {
  if (typeof name !== 'string' || name.trim().length > 60) throw new Error('a name, up to 60 characters')
  if (w.builtin) throw new Error(`${w.m.name || w.id} comes with Laki: Remix it to rename a copy`)
  if (w.project) throw new Error(repoSays(w, 'rename it'))
  if (w.file) throw new Error(`${w.m.name || w.id} is one file: rename it in its <laki.name> tag`)
  const p = join(w.dir, 'widget.json')
  if (!statOf(p)?.isFile()) throw new Error('its widget.json is a link there: rename it in its folder')
  const m = manifestOf(w.dir)
  if (typeof m === 'string') throw new Error(m)
  const t = name.trim()
  if ((m.name ?? '') === t) return false
  if (t) m.name = t
  else delete m.name
  if (w.dir === join(widgetHome(), w.id)) snapshot(w.id, w.dir)
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n') // ponytail: its own spacing goes; Laki's (and Laki AI's) are 2 already
  wLog(w, `renamed: ${t || w.id}`)
  return true
}

// what turning one on starts, in words, its command or prompt as a code block (a code span breaks on its backticks or
// lines): Laki AI's Yes / No says it (aiQuestion), and a Yes turns it on only while it still says the same and its
// files are the ones it was asked about (aiAnswer: hash, filesHash; widgetSet's seen)
export function widgetWhat(id: string) {
  const w = find(id)
  const hash = filesHash(w, true) // first: a change while it's read gives a hash a Yes can't match
  const src = sourceOf(w)
  const fetch = w.m.script ? `node ${w.m.script}` : w.m.fetch
  const [runs, code]: [string, string?] =
    src.kind === 'static' ? ['runs nothing: its data is typed in']
    : src.kind === 'file' ? ['reads this file', src.path]
    : src.kind === 'url' ? ['fetches this URL', src.url]
    : src.kind === 'ai' ? [`asks an agent this${src.tools ? `, with ${src.tools.replace(/[`*_[\]]/g, '')}` : ''}`, src.prompt && src.prompt.length > 1500 ? `${src.prompt.slice(0, 1500)}…` : src.prompt]
    : fetch ? [`runs this${w.m.stream ? ' and keeps it running' : ''}`, fetch]
    : ['runs nothing (no fetch)']
  const fence = '`'.repeat(Math.max(3, ...[...(code ?? '').matchAll(/`+/g)].map(m => m[0].length + 1))) // longer than any run in it
  const events = Object.keys(w.m.on ?? {}).map(e => `\`${e.replace(/`/g, '')}\``) // its actions run on these, unclicked
  const holds = [...new Set(gatesOf(w).flatMap(([, a]) => gateOf(a)))] // its gates: it can hold these
  const text = `It ${runs}${code ? `:\n\n${fence}\n${code}\n${fence}` : '.'}${events.length ? `\n\nThese events run its actions too: ${events.join(', ')}.` : ''}${holds.length ? `\n\nIt can hold a workspace's ${holds.join(', ')}: its gate runs before each.` : ''}${w.project ? repoShown(w) : ''}`
  return { name: w.m.name || w.id, on: onOf(w), text, hash }
}

// a repo's (not yours, not Laki's): its actions' commands and its scripts' text too, what you say yes to
function repoShown(w: Entry) {
  const block = (t: string) => (f => `${f}\n${t}\n${f}`)('`'.repeat(Math.max(3, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1))))
  const acts = Object.entries(w.m.actions ?? {}).flatMap(([k, a]) => (c => (c ? [`${k}: ${c}`] : []))(actionCmd(a)))
  let left = 12_000
  const files = (w.file ? [] : filesUnder(w.dir).sort())
    .filter(n => n !== 'widget.json' && !n.startsWith('fixtures/') && !/\.md$/i.test(n))
    .flatMap(n => {
      let t = ''
      try {
        t = readFileSync(join(w.dir, n), 'utf8')
      } catch {
        return []
      }
      if (t.includes('\0')) return [`${n}: not text`]
      const cut = t.length > Math.min(3000, left) ? `${t.slice(0, Math.max(0, Math.min(3000, left)))}\n…` : t
      left -= cut.length
      return [`${n}:\n\n${block(cut.trimEnd())}`]
    })
  const more = w.file ? 0 : filesUnder(w.dir, true, 2000).length - filesUnder(w.dir).length // hidden or in node_modules: not shown, but a change there turns it off too
  return `${acts.length ? `\n\nIts actions run:\n\n${block(acts.join('\n'))}` : ''}${files.length ? `\n\nIts files:\n\n${files.join('\n\n')}` : ''}${more > 0 ? `\n\nAnd ${more} more ${more === 1 ? 'file' : 'files'}, hidden or in node_modules (not shown here).` : ''}`
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
    LAKI_WIDGET_CONFIG: JSON.stringify(typedOf(w, true)),
    ...extra,
  }
  for (const [k, v] of Object.entries(configOf(w, true))) env[`WIDGET_${k.toUpperCase()}`] = v
  return env
}
type Ran = { out: string; err: string }
type Failed = Error & { stderr?: string; stdout?: string; exit?: number }
// a widget's command, in its folder, as a process group (a timeout ends what it started too): stdout and stderr, or why
// it failed (with its stderr and exit code). stdin: an event's JSON (a handler's); else nothing to read
const timeout = () => Number(process.env.LAKI_WIDGET_TIMEOUT_MS) || 120_000 // tests' shorter
const execs = new Set<ChildProcess>() // running now: widgetsStop ends them
// a repo's extension runs only as you said yes to it: its files changed since (a pull, before the watch's scan) turn it
// off here, before anything of the new runs (dirHash: cached by the files' times and sizes)
function trusted(w: Entry) {
  if (!w.project || w.s.trusted === dirHash(w)) return
  if (w.s.on) untrust(w)
  throw new Error(`${w.m.name || w.id} changed in ${projName(w)}'s repo: off until you look`)
}
function exec(w: Entry, cmd: string, args: string[], extra: Record<string, string>, stdin = '', ms?: number) {
  try {
    trusted(w)
  } catch (e) {
    return Promise.reject(Object.assign(e as Error, { stderr: '' }))
  }
  return new Promise<Ran>((ok, no) => {
    const t = ms ?? timeout()
    const p = execGroup(cmd, args, { cwd: w.dir, env: envOf(w, extra), timeout: t, maxBuffer: MAX_OUT, stdin }, (e, stdout, stderr) => {
      execs.delete(p)
      if (!e) return ok({ out: stdout, err: stderr })
      const late = e.message === 'maxBuffer exceeded' ? `printed more than ${MAX_OUT >> 20} MB` : e.killed ? `timed out after ${t >= 60_000 ? `${t / 60_000} minutes` : `${t / 1000} s`}` : undefined
      no(Object.assign(new Error(late ?? (lastLine(stderr) || lastLine(stdout) || e.message)), { stderr, stdout, exit: typeof e.code === 'number' ? e.code : undefined }))
    })
    execs.add(p)
    own(p, `Extension · ${w.m.name || w.id}`)
  })
}

const RUNS = 20
const runs = new Map<string, Run[]>()
const tail = (t?: string) => (t?.trim() ? t.trimEnd().split('\n').slice(-20).join('\n').slice(-4096) : undefined) // stderr's last 20 lines, 4 KB
function ran(id: string, r: Run, stderr?: string) {
  const l = runs.get(id) ?? []
  l.unshift(r)
  if (l.length > RUNS) l.length = RUNS
  runs.set(id, l)
  // its log: the run's stderr (LOG_RUN of it, the end), then a line for the run
  const [wid, ws] = id.split('@')
  const w = widgets.get(wid)
  if (!w || !logOn(w)) return
  const src = r.reason.startsWith('tool:') || r.reason.startsWith('gate:') ? r.reason : r.action ? `action:${r.action}` : ['stream', 'push'].includes(r.reason) ? r.reason : 'fetch'
  if (stderr?.trim()) xlog(w, 'info', src, stderr.length > LOG_RUN ? stderr.slice(-LOG_RUN) : stderr, ws)
  xlog(w, r.ok ? 'info' : 'error', src, `${r.ok ? 'ran' : 'failed'} (${r.reason}${r.why ? `: ${r.why}` : ''}) in ${r.ms} ms, exit ${r.exit ?? 0}, ${r.bytes} B${r.error ? `: ${r.error}` : ''}`.replace(/\s+/g, ' '), ws, true)
}

// ---------- logs (off by default): Settings › Extensions' Keep logs for every extension (settings.widgetLogs), an
// extension's own Keep a log (the store's log), or one laki widget dev links, while linked. <data>/widget-data/<id>.log,
// a JSON line each (WidgetLogLine), 0600, rotated past LOG_MAX to <id>.log.1 (two files at most), written in batches
// every 500 ms and at shutdown. Each line masked first: a secret's value, and a setting's named like one (SECRET)
const LOG_MAX = () => Number(process.env.LAKI_WIDGET_LOG_MAX) || 1 << 20 // tests' smaller
const LOG_RUN = 64 << 10 // a run's stderr, at most
const logPath = (id: string) => join(dir, 'widget-data', `${id}.log`)
const logOn = (w: Entry) => state.settings?.widgetLogs === true || !!w.s.log || w.dev
const pending = new Map<string, WidgetLogLine[]>()
const lastN = new Map<string, number>() // each log's last n, read from its files once
const errAt = new Map<string, number>() // its last error line's time (Settings' red tag): since the daemon started
let flushing: NodeJS.Timeout | undefined
// a line's own level: debug:, info:, warn: or error: at its start (taken off), else info
const leveled = (t: string): [LogLevel, string] => (m => (m ? [m[1].toLowerCase() as LogLevel, t.slice(m[0].length)] : ['info', t]))(/^(debug|info|warn|error):\s?/i.exec(t))
const masks = new Map<string, (t: string) => string>() // each one's, until its secrets or settings are written again
function masker(w: Entry) {
  const m = masks.get(w.id)
  if (m) return m
  const c = configOf(w, true)
  const vals = [...new Set([...Object.values(secretsOf(w.id)), ...optionsOf(w).filter(o => o.type === 'secret' || SECRET.test(o.key)).map(o => c[o.key])])].filter(v => typeof v === 'string' && v.length >= 4).sort((a, b) => b.length - a.length)
  const f = (t: string) => vals.reduce((x, v) => x.split(v).join('••••'), t)
  masks.set(w.id, f)
  return f
}
function readLog(id: string): WidgetLogLine[] {
  const out: WidgetLogLine[] = []
  for (const p of [`${logPath(id)}.1`, logPath(id)]) {
    let text = ''
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    for (const l of text.split('\n'))
      try {
        if (l) out.push(JSON.parse(l))
      } catch {}
  }
  return [...out, ...(pending.get(id) ?? [])]
}
// a line (each line of text) for its log, while it keeps one. A level other than info, Laki's own lines and a run's own
// line (as) are as given; else each line's prefix says
function xlog(w: Entry, level: LogLevel, src: string, text: string, ws?: string, as = false) {
  if (!logOn(w)) return
  const mask = masker(w)
  const l = pending.get(w.id) ?? []
  let n = lastN.get(w.id) ?? readLog(w.id).at(-1)?.n ?? 0
  for (const t of text.split('\n')) {
    if (!t.trim()) continue
    const [lv, rest] = level === 'info' && src !== 'laki' && !as ? leveled(t) : [level, t]
    l.push({ n: ++n, at: Date.now(), level: lv, src, text: mask(rest).slice(0, 2048), ...(ws && { ws }) })
    if (lv === 'error') errAt.set(w.id, Date.now())
  }
  lastN.set(w.id, n)
  pending.set(w.id, l)
  flushing ??= setTimeout(flushLogs, 500)
}
export function flushLogs() {
  clearTimeout(flushing)
  flushing = undefined
  for (const [id, l] of pending) {
    pending.delete(id)
    const p = logPath(id)
    const text = l.map(x => JSON.stringify(x)).join('\n') + '\n'
    try {
      mkdirSync(dirname(p), { recursive: true })
      const size = statSync(p, { throwIfNoEntry: false })?.size
      if (size && size + text.length > LOG_MAX()) renameSync(p, `${p}.1`) // the older one goes
      appendFileSync(p, text, { mode: 0o600 })
    } catch (e) {
      console.error(`widget log ${id}: ${(e as Error).message}`)
    }
  }
}
const rank = (l: string) => LOG_LEVELS.indexOf(l as LogLevel)
// the Logs tab (every 2 s, from its cursor: since), laki widget logs, MCP's laki_extension_logs: the lines after since,
// at least level, of a src (action: every action's), of a workspace; the last limit of them; next: the cursor for the next
export function widgetLogs(o: { id: string; since?: number; limit?: number; level?: string; src?: string; ws?: string }) {
  const w = find(o.id)
  const all = readLog(w.id)
  const since = Number(o.since) || 0
  const min = Math.max(0, rank(String(o.level ?? '')))
  const src = typeof o.src === 'string' && o.src ? o.src : undefined
  const lines = all.filter(l => l.n > since && rank(l.level) >= min && (!src || l.src === src || l.src.startsWith(`${src}:`)) && (!o.ws || l.ws === o.ws))
  return { on: logOn(w), lines: lines.slice(-clamp(o.limit, 1, 5000, 500)), next: all.at(-1)?.n ?? since, file: logPath(w.id) }
}
// a line put there on purpose: laki widget log (a hook, a cron job; src cli) or a JS page's laki.log (page), 50 a second
// at most each, 2 KB a line. Its log off: nothing written, and fine (a script never breaks on it)
const LOG_RATE = 50
const rate = new Map<string, { s: number; n: number }>()
export function widgetLog(o: { id: string; text?: unknown; level?: string; ws?: string; src?: string }) {
  const w = find(o.id)
  const text = String(o.text ?? '').slice(0, 2048)
  if (!text.trim()) throw new Error('some text to log')
  if (!logOn(w)) return { ok: true, kept: false }
  const s = Math.floor(Date.now() / 1000)
  const r = rate.get(w.id)
  if (r?.s === s && r.n >= LOG_RATE) return { ok: true, kept: false, note: `over ${LOG_RATE} lines a second: dropped` }
  rate.set(w.id, r?.s === s ? { s, n: r.n + 1 } : { s, n: 1 })
  const ws = typeof o.ws === 'string' && state.workspaces.some(x => x.id === o.ws) ? o.ws : undefined
  xlog(w, LOG_LEVELS.includes(o.level as LogLevel) ? (o.level as LogLevel) : 'info', o.src === 'page' ? 'page' : 'cli', text, ws)
  return { ok: true, kept: true }
}
// its log's file, for Finder (written now; none yet: an empty one)
export function widgetLogFile(id: string) {
  const w = find(id)
  flushLogs()
  const p = logPath(w.id)
  if (!existsSync(p)) mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, '', { mode: 0o600 })
  return p
}
export function widgetLogClear(o: { id: string }) {
  const w = find(o.id)
  pending.delete(w.id)
  errAt.delete(w.id)
  for (const p of [logPath(w.id), `${logPath(w.id)}.1`]) rmSync(p, { force: true }) // n goes on: a reader's cursor stays good
  changed()
  return { ok: true }
}

// a script's default export gets { config, last, workspace } (a scope workspace one's) and returns the data (an async
// generator: each yield a line, a stream's); one without prints it. What it throws is the
// error, its message alone (node would print the stack, then its version)
const RUN_JS = `import { readFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
try {
  const m = await import(pathToFileURL(process.argv[1]).href)
  if (typeof m.default === 'function') {
    let last
    try { last = JSON.parse(readFileSync(process.env.LAKI_WIDGET_FILE, 'utf8')).data } catch {}
    const r = m.default({ config: JSON.parse(process.env.LAKI_WIDGET_CONFIG || '{}'), last, workspace: process.env.LAKI_WIDGET_WS ? JSON.parse(process.env.LAKI_WIDGET_WS) : undefined })
    if (r && typeof r[Symbol.asyncIterator] === 'function') for await (const x of r) writeSync(1, JSON.stringify(x ?? null) + '\\n') // a stream: a line per yield
    else process.stdout.write(JSON.stringify((await r) ?? null))
  }
} catch (e) {
  writeSync(2, String(e?.message ?? e) + '\\n') // at once: a pipe's write is async on macOS, exit wouldn't wait
  process.exit(1)
}`

// run the widget's fetch now (exec); what it prints must be JSON. A failure keeps the last data and says why.
// reason (RUN_REASONS: manual unless said; $LAKI_REFRESH_REASON), why: what changed (dev mode's file). Data put there by
// hand (widgetMock) stays: only Fetch now (manual) runs then, and its data replaces it
export const RUN_REASONS = ['schedule', 'open', 'settings', 'manual', 'reload', 'dev', 'select', 'push', 'stream', 'workflow'] // and action:<name>, event:<name>
// an event handler's ($LAKI_EVENT, $LAKI_EVENT_FILE, the JSON on stdin) or a tool call's ($WIDGET_INPUT_<NAME>; why: who
// called it and how it was allowed, for its run; full: all its stdout back)
type Ev = { env: Record<string, string>; stdin: string; why?: string; full?: boolean; gone?: WsInfo } // gone: an archived or removed workspace's event, its info then
const AT_ONCE = 4 // a scope workspace one's instances fetching at a time
const INSERT_MAX = 16 << 10 // what an action puts in the prompt
// force: laki widget check's run, an explicit ask, so an off one of the user's runs too (never one Laki AI wrote).
// ws: a scope workspace one's instance (its workspace's env, its own data)
// once: the studio's Try it live, the user's click on what will run: one fetch while it's off (an AI-written one too)
export async function widgetRun(o: { id: string; reason?: string; why?: string; ws?: string; once?: boolean; from?: { ws?: string; tab?: string } }, force = false, ev?: Ev): Promise<{ ok: boolean; error?: string }> {
  const w = find(o.id)
  const x = wsOf(w, o.ws)
  const k = keyOf(w.id, x?.id)
  const meta = metaOf(w, x?.id)
  const reason = typeof o.reason === 'string' && (RUN_REASONS.includes(o.reason) || /^(action|event):[\w.-]{1,40}$/.test(o.reason)) ? o.reason : 'manual'
  const once = o.once === true && !onOf(w)
  if (!onOf(w) && (w.project || (!once && !(force && w.s.by !== 'ai')))) return { ok: false, error: w.project ? `${OFF(w)}: it comes with ${projName(w)}'s repo, look at what it runs (laki widget what ${w.id})` : OFF(w) } // a repo's: never once, unlooked
  if (!fetches(w)) return { ok: false, error: `${w.id} has no fetch or script: give it a source (static, file or url)` }
  const src = sourceOf(w)
  if (once && streaming(w)) return { ok: false, error: 'a stream runs only while it is on' }
  if (streaming(w)) {
    // a stream: started again (a Stop in Resources ends there)
    stopStream(w.id)
    streamSync()
    return streams.get(w.id)?.p ? { ok: true } : { ok: false, error: "a stream runs while Laki's window is open" }
  }
  // an agent's run costs: whatever asks for it (an event, a task, a workflow, a setting, a save), at most every everyOf
  // minutes; your Run now (manual) anyway, an agent's laki widget run not
  if (src.kind === 'ai' && (reason !== 'manual' || agentCaller(o.from)) && meta.at && Date.now() - meta.at < everyOf(w) * 60_000) {
    const why = `an agent's source runs at most every ${everyOf(w)} minutes: Run now on its page fetches anyway`
    return wLog(w, `not fetched (${reason}): ${why}`), { ok: false, error: why }
  }
  if (meta.mock && reason !== 'manual') return wLog(w, `not fetched (${reason}): showing sample data (${meta.mock})`), { ok: false, error: `showing sample data (${meta.mock}): Live in its inspector fetches again` }
  if (running.has(k)) return again.add(k), { ok: false, error: 'already fetching: it fetches again after this one' }
  if (x && [...running].filter(r => r.startsWith(`${w.id}@`)).length >= AT_ONCE) return { ok: false, error: `${AT_ONCE} of its workspaces fetch now: again in a moment` } // ponytail: the next tick's, no queue
  const script = w.m.script ? resolve(w.dir, w.m.script) : undefined
  if (script && !script.startsWith(w.dir + '/')) return { ok: false, error: `${w.m.script} isn't in the widget's folder` }
  running.add(k)
  changed()
  const t0 = Date.now()
  wLog(w, `fetch (${reason}${once ? ', once while off' : ''}${x ? `, ${x.id}` : ''}): ${src.kind !== 'fetch' ? `${src.kind} ${src.path ?? src.url ?? (src.kind === 'ai' ? (src.profile ?? state.settings?.widgetAgent ?? 'claude') : '')}`.trim() : script ? `node ${w.m.script}` : w.m.fetch}`)
  let data: unknown
  let error: string | undefined
  let r: Ran | undefined
  let fail: Failed | undefined
  try {
    if (src.kind !== 'fetch') {
      // a text, a file, a URL or an agent's answer: JSON, else { text }
      r = { out: await sourceText(w, src, x), err: '' }
      const p = parsed(r.out, src.kind)
      if (p.error) throw new Error(p.error)
      data = p.data
    } else {
      // a script on Laki's own node (Electron's, as node, in the app)
      r = await exec(w, script ? process.execPath : '/bin/sh', script ? ['--input-type=module', '-e', RUN_JS, script] : ['-c', w.m.fetch!], { LAKI_REFRESH_REASON: reason, ...wsEnv(w, x), ...ev?.env, ...(script && process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) }, ev?.stdin)
      try {
        data = JSON.parse(r.out)
      } catch {
        throw new Error(`fetch printed no JSON: ${lastLine(r.out) ?? 'nothing'}`)
      }
    }
  } catch (e) {
    fail = e as Failed
    error = fail.message
  }
  running.delete(k)
  const ms = Date.now() - t0
  ran(k, { at: t0, ms, reason, why: o.why ?? (once ? 'once while off: Try it live' : undefined), ok: !error, bytes: r ? Buffer.byteLength(r.out) : 0, error, stderr: tail(fail?.stderr ?? r?.err), exit: error ? (fail?.exit ?? 0) : 0 }, fail?.stderr ?? r?.err)
  wLog(w, () => (error ? `fetch failed after ${ms} ms: ${error}` : `fetched in ${ms} ms: ${JSON.stringify(data)?.length ?? 0} bytes of JSON`), error ? 'error' : 'info')
  const gone = !!x && !state.workspaces.includes(x) // deleted meanwhile: nothing kept
  if (!gone)
    keep(w, x?.id, s => {
      if (!error) (s.data = data), (s.mock = undefined)
      else s.fails = (s.fails ?? 0) + 1
      s.at = Date.now()
      s.error = error
    })
  changed()
  const cur = widgets.get(w.id)
  if (again.delete(k) && cur && onOf(cur) && !gone) soon({ id: w.id, reason, ws: x?.id }) // with the settings as they are now
  return error ? { ok: false, error } : { ok: true }
}

// a source's text: typed in, a file (~ is home, relative: the widget's folder), a URL (30 s), each 16 MB at most, or an
// agent's answer (its last ```json block); a path, URL or prompt may name settings and the workspace: {{config.repo}},
// {{workspace.path}}
const SOURCE_WAIT = 30_000
async function sourceText(w: Entry, src: WidgetSource, x?: Workspace) {
  const at = (t: string) => fill(t, [{ config: typedOf(w), workspace: x ? wsInfo(x) : undefined }]).trim()
  if (src.kind === 'static') return src.text ?? ''
  if (src.kind === 'ai') {
    const prompt = at(src.prompt ?? '')
    if (!prompt) throw new Error('no prompt: say what it should find')
    const preset = agentOf(src)
    const out = await agentRun(w.id, true, (signal, stop) => aiOnce({ preset, tools: allowedOf(w, src.tools), perm: w.id, prompt, system: aiSystem(w), ask: `extension ${w.id}: ${prompt}`, name: `Extension · ${w.m.name || w.id} (AI)`, stop, signal, onCall: aiLog(w, 'fetch', preset.name, prompt, x?.id) }))
    return lastJson(out) // ponytail: no block, its words as { text }
  }
  if (src.kind === 'file') {
    const f = at(src.path ?? '')
    if (!f) throw new Error('no file: give its path')
    const p = resolve(w.dir, home(f))
    const st = statSync(p, { throwIfNoEntry: false })
    if (!st) throw new Error(`no file ${f}`)
    if (!st.isFile()) throw new Error(`${f} isn't a file`)
    if (st.size > MAX_OUT) throw new Error(`${f} is over 16 MB`)
    return readFileSync(p, 'utf8')
  }
  const url = at(src.url ?? '')
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(url ? `${url} isn't an http(s) URL` : 'no URL')
  const res = await fetch(url, { signal: AbortSignal.timeout(SOURCE_WAIT), headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5' } })
  if (!res.ok) throw new Error(`${url.replace(/[?#].*$/, '')}: HTTP ${res.status}`) // its query may hold a key
  if (Number(res.headers.get('content-length') ?? 0) > MAX_OUT) throw new Error('over 16 MB')
  const parts: Buffer[] = []
  let size = 0
  for await (const b of res.body ?? []) {
    size += b.length
    if (size > MAX_OUT) throw new Error('over 16 MB') // the timeout's signal ends the request
    parts.push(Buffer.from(b))
  }
  return Buffer.concat(parts).toString('utf8')
}
// an AI source's agent: its profile, else Settings › Extensions', else the first claude preset, else plain claude
const agentOf = (src: WidgetSource): Preset & { agent: 'claude' | 'codex' } => {
  const ok = (p?: Preset): p is Preset & { agent: 'claude' | 'codex' } => p?.agent === 'claude' || p?.agent === 'codex'
  const named = (n?: string) => (n ? presets().find(p => p.name === n) : undefined)
  if (src.profile) {
    const p = named(src.profile)
    if (!ok(p)) throw new Error(`no claude or codex profile ${src.profile}: Settings › Agents & profiles`)
    return p
  }
  const on = (p?: Preset): p is Preset & { agent: 'claude' | 'codex' } => ok(p) && !p.off // off: out of the pickers, Settings' too
  const p = named(state.settings?.widgetAgent)
  return on(p) ? p : (presets().find(on) as (Preset & { agent: 'claude' }) | undefined) ?? { name: 'claude', agent: 'claude' }
}
// an agent's answer's last ```json block, else all of it
const lastJson = (out: string) => [...out.matchAll(/```json\s*\n([\s\S]*?)```/gi)].pop()?.[1] ?? out
// an AI action: its prompt filled ({{arg}}, settings, its data, the workspace), the agent's answer
async function aiAnswer(w: Entry, action: string, a: { prompt: string; tools?: string; profile?: string }, arg: string, x?: Workspace, ctx?: { ws?: WsInfo; tab?: object; file?: object }) {
  const data = dataOf(w, x?.id).data
  const prompt = fill(a.prompt, [{ ...(isObj(data) ? data : {}), data, arg, config: typedOf(w), workspace: x ? wsInfo(x) : ctx?.ws, tab: ctx?.tab, file: ctx?.file }]).trim() // its data's fields, never over arg or config; where it was picked
  if (!prompt) throw new Error(`${action}: no prompt`)
  const system = `You answer "${action}", a button of "${w.m.name || w.id}", an extension (a small view) in Laki, the app the user runs coding agents in. Do what the prompt asks with the tools you have (their MCP servers among them); change nothing it doesn't ask you to. No one answers questions: decide yourself. Answer in a few short lines of plain text: the user reads it in a small dialog. Or end with a \`\`\`json block: { "toast": "…" }, { "modal": { "title", "text" } }, or { "data": … } (the extension's new data, in the shape of what it shows now).`
  const preset = agentOf(a as WidgetSource)
  return agentRun(w.id, false, (signal, stop) => aiOnce({ preset, tools: allowedOf(w, a.tools), perm: w.id, prompt, system, ask: `extension ${w.id} · ${action}: ${prompt}`, name: `Extension · ${w.m.name || w.id} (${action})`, stop, signal, onCall: aiLog(w, `action:${action}`, preset.name, prompt, x?.id ?? ctx?.ws?.id) }))
}
// an agent's run in its log: the profile, the prompt's first 200 characters, seconds, cost, the answer's size
const aiLog = (w: Entry, src: string, profile: string, prompt: string, ws?: string) => (c: { ms: number; cost?: number; ok: boolean; error?: string }, answer: string) =>
  xlog(w, c.ok ? 'info' : 'error', src, `agent ${profile}: "${prompt.slice(0, 200).replace(/\s+/g, ' ')}" in ${(c.ms / 1000).toFixed(1)} s, ${c.cost !== undefined ? `$${c.cost.toFixed(4)}` : 'no cost said'}, ${c.ok ? `answered ${Buffer.byteLength(answer)} B` : `failed: ${c.error ?? ''}`}`, ws, true)
// what an AI source's agent is told: find, change nothing, end with the data in the shape its views read (the sample's)
const aiSystem = (w: Entry) => {
  const sample = w.m.sample === undefined ? '' : JSON.stringify(w.m.sample).slice(0, 4000)
  return `You make the data for "${w.m.name || w.id}", an extension (a small view) in Laki, the app the user runs coding agents in. Find what the user's prompt asks for with the tools you have (their MCP servers among them). Change nothing anywhere: read, search and fetch only. No one answers questions: decide yourself. End your answer with the data as one JSON object in a \`\`\`json block, ${sample ? `in the same shape as this sample (its keys; values of your own): ${sample}` : 'as { "text": "<what you found, in Markdown>" }'}.`
}
// what a source gave as data: JSON (an object or a list), else the words as { text }
function parsed(out: string, kind: WidgetSource['kind']): { data?: unknown; error?: string } {
  const t = out.trim()
  if (/^\{|^\[[\s\S]*\]$/.test(t)) // JSON's shape: a note that starts with [a link](…) is words
    try {
      return { data: JSON.parse(t) }
    } catch (e) {
      if (kind === 'static') return { error: `not JSON: ${(e as Error).message}` } // typed as JSON: say so
    }
  return { data: { text: out } }
}

// a button's command (widget.json's actions), its data-arg as $WIDGET_ARG (never in the command line); then the widget
// fetches again, to show what it changed. What it prints as JSON with toast or modal (sayOf) is what the app shows
// What it prints as JSON with data replaces the extension's data (its instance's), merge: true over it (shallow); no
// fetch follows then. reason, ev: an event's handler (event:<name>, its JSON on stdin)
// from: who asked (laki widget action's $LAKI_WORKSPACE, $LAKI_TAB): an agent's call (agentCaller) of a tool goes
// through widgetToolCall, its ask; of any other action, the user is asked each time (no Always)
// ctx: where the app's user picked it (a menu, the palette, a key, the prompt): never an agent's
export async function widgetAction(o: { id: string; action: string; arg?: string; ws?: string; from?: { ws?: string; tab?: string }; ctx?: WidgetCtx }, why?: string, ev?: Ev): Promise<{ ok: boolean; out?: string; error?: string; stdout?: string; insert?: string } & WidgetSay> {
  const w = find(o.id)
  const gone = scoped(w) ? ev?.gone : undefined
  const x = gone ? undefined : wsOf(w, o.ws) // a scope workspace one's: the workspace it was clicked in
  const k = keyOf(w.id, gone?.id ?? x?.id)
  if (!onOf(w)) return { ok: false, error: OFF(w) }
  const def = w.m.actions && Object.hasOwn(w.m.actions, o.action) ? w.m.actions[o.action] : undefined
  const cmd = actionCmd(def)
  const ai = aiActOf(def) // an agent answers it
  if (typeof cmd !== 'string' && !ai) return { ok: false, error: `${w.m.name || w.id} has no action ${o.action}` }
  if (ai && ev) return { ok: false, error: `${o.action}: an agent's action runs on a click, not on an event (each run costs)` }
  const ctx = agentCaller(o.from) || ev ? undefined : ctxOf(w, o.ctx, x)
  if (agentCaller(o.from)) {
    const from = { ws: o.ws ?? o.from!.ws, tab: o.from!.tab }
    if (toolOf(def)) {
      let input: unknown
      try {
        input = o.arg?.trim() ? JSON.parse(o.arg) : {}
      } catch {
        return { ok: false, error: `${o.action} is a tool: its input as JSON (laki widget tool ${w.id} ${o.action} '{…}')` }
      }
      const r = await widgetToolCall({ id: w.id, action: o.action, input, from }).catch(e => ({ ok: false, output: '', error: (e as Error).message }))
      return r.ok ? { ok: true, out: lastLine(r.output) } : { ok: false, error: r.error }
    }
    const tab = state.tabs.find(t => t.id === from.tab)
    try {
      await approve(w, o.action, { description: `Its "${o.action}" action, which isn't a tool: asked each time`, ask: 'always', input: o.arg ? { arg: o.arg } : undefined, ws: x?.id ?? (state.workspaces.some(v => v.id === from.ws) ? from.ws : undefined), tab: tab?.id, agent: tab?.name })
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  wLog(w, `action ${o.action}${o.arg ? ` (${String(o.arg).slice(0, 200)})` : ''}`)
  const reason = why ?? `action:${o.action}`
  const t0 = Date.now()
  try {
    const { out, err } = ai ? { out: await aiAnswer(w, o.action, ai, String(o.arg ?? ''), x, ctx?.info), err: '' } : await exec(w, '/bin/sh', ['-c', cmd!], { WIDGET_ARG: String(o.arg ?? ''), LAKI_REFRESH_REASON: reason, ...wsEnv(w, x, gone), ...ctx?.env, ...ev?.env }, ev?.stdin)
    ran(k, { at: t0, ms: Date.now() - t0, reason, why: ev?.why, action: o.action, ok: true, bytes: Buffer.byteLength(out), stderr: tail(err), exit: 0 }, err)
    wLog(w, `action ${o.action} done: ${lastLine(out) ?? 'printed nothing'}`)
    let j: Record<string, unknown> | undefined
    for (const s of ai ? [lastJson(out)] : [out, lastLine(out)]) // all of it, or its last line after some log lines; an agent's json block
      try {
        const v = JSON.parse(s ?? '')
        if (isObj(v)) {
          j = v
          break
        }
      } catch {}
    const live = !gone && (!x || state.workspaces.includes(x)) // a gone one's: nothing kept
    if (j && 'data' in j && live) {
      const d = j.data
      keep(w, x?.id, s => ((s.data = j!.merge === true && isObj(s.data) && isObj(d) ? { ...s.data, ...d } : d), (s.at = Date.now()), (s.error = s.mock = undefined)))
      changed()
    } else if (!ai && fetches(w) && live) soon({ id: w.id, reason: /^[\w.-]{1,40}$/.test(o.action) ? `action:${o.action}` : 'manual', ws: x?.id }) // fetching already: once more after it
    // into the prompt: its JSON's insert, else (insert: true) all it printed, an agent's words too
    const insert = typeof j?.insert === 'string' ? j.insert : actionMenu(o.action, def)?.insert && !j ? out.trim() : undefined
    const say = (j && sayOf(j)) ?? (ai && insert === undefined && !(j && 'data' in j) ? { modal: { title: `${w.m.name || w.id} · ${o.action}`, text: out.trim().slice(0, 2000), buttons: [{ label: 'OK', style: 'primary' as const }] } } : undefined) // an agent's words: a dialog
    return { ok: true, ...(say ?? { out: lastLine(out) }), ...(ev?.full && { stdout: out }), ...(insert !== undefined && { insert: insert.slice(0, INSERT_MAX) }) }
  } catch (e) {
    const f = e as Failed
    ran(k, { at: t0, ms: Date.now() - t0, reason, why: ev?.why, action: o.action, ok: false, bytes: 0, error: f.message, stderr: tail(f.stderr), exit: f.exit }, f.stderr)
    wLog(w, `action ${o.action} failed: ${f.message}`, 'error')
    return { ok: false, error: f.message, ...(ev?.full && { stdout: f.stdout ?? '' }) }
  }
}

// every 30 s, and as the app connects or its window shows again: each widget that's on and due fetches (its every
// minutes since the last try, which a failure counts as), only while the app's window is open (a client whose page is
// visible: closing the window only hides it) and within settings.widgetHours (9am-9pm weekdays; a line that doesn't
// read: always): no API calls nobody sees. Fetch now and a change of settings still fetch
// A scope workspace one fetches only its instances on screen (onScreen): every minutes each, and at once (select) as its
// workspace is selected if it's older than that; one placed in row (a mark on each row) every live workspace's, AT_ONCE
// at a time (the rest at the next ticks)
export function widgetTick(now = Date.now(), reason: 'schedule' | 'open' | 'select' = 'schedule') {
  streamSync(now)
  if (!shown()) return
  const hours = hoursOf()
  if (hours && !('error' in hours) && !inHours(hours, now)) {
    for (const w of widgets.values()) if (scoped(w) ? shownIn(w).some(ws => due(w, now, ws)) : due(w, now)) wLog(w, () => `not fetched: outside the working hours (${describeHours(hours)})`)
    return
  }
  for (const w of widgets.values())
    if (scoped(w)) for (const ws of shownIn(w)) due(w, now, ws) && soon({ id: w.id, reason, ws })
    else if (reason !== 'select' && due(w, now)) soon({ id: w.id, reason })
}
// fetch it now where it shows: a global one, or a scope workspace one's instances on screen (gate: which may)
function refetch(w: Entry, reason: string, why?: string, gate: (w: Entry, ws?: string) => boolean = fetchable) {
  for (const ws of scoped(w) ? shownIn(w) : [undefined]) if (gate(w, ws)) soon({ id: w.id, reason, why, ws })
}
const soon = (o: { id: string; reason: string; why?: string; ws?: string }) => void widgetRun(o).catch(e => wLog(o, `not fetched: ${(e as Error).message}`)) // a workspace gone meanwhile
const shown = () => [...clients].some(c => c.view?.shown !== false) // a window shown (closing one only hides it)
// the workspaces on screen: each shown window's selected one (its view's ws, else the workspace of its tab)
// the workspaces a scope workspace one shows in: on screen, or every live one's row (while a window is shown)
const shownIn = (w: Entry) => (placesOf(w).includes('row') && shown() ? state.workspaces.filter(instOk).map(x => x.id) : onScreen()).filter(id => inProj(w, state.workspaces.find(x => x.id === id)))
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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hoursOf = () => (typeof state.settings?.widgetHours === 'string' && state.settings.widgetHours.trim() ? parseHours(state.settings.widgetHours) : null)

// ---------- events (widget.json's on: { "<event>": "<action>" | "refresh" }): core calls widgetEvent as each happens.
// Every extension that's on and answers it runs that action, or fetches again, with LAKI_EVENT, the event's JSON on
// stdin and in LAKI_EVENT_FILE (deleted after) and reason event:<name>; a scope workspace one only its workspace's, in
// that instance. One at a time per extension, QUEUE_MAX waiting (past it the oldest goes). What a handler's action says
// (toast, modal) goes to the app's windows. Workflows with on: <event> start through eventHooks.flows (workflow.ts sets
// it: no import cycle). The last SENT_MAX events are kept in memory, with what they reached (laki widget events)
const QUEUE_MAX = 20
const EVENT_MAX = 64 << 10
const HOPS_MAX = 3 // an emit made while handling an event is one hop more: past this, dropped (a loop)
const SENT_MAX = 50
type Job = { name: string; json: string; h: string; ws?: string; gone?: WsInfo; hops: number }
type From = { widget?: string; tab?: { id: string; name: string }; agent?: string }
const queues = new Map<string, Job[]>()
const draining = new Set<string>()
const sent: EventSent[] = []
export const eventHooks: { flows?: (name: string, payload: Record<string, unknown>, ws: string | undefined, agent: boolean) => { flows: string[]; refused: string[] } } = {}
// its handler of that event: on[name], or on["custom.*"] for a custom one
function handlerOf(w: Entry, name: string) {
  const on = w.m.on
  const h = !on ? undefined : Object.hasOwn(on, name) ? on[name] : name.startsWith('custom.') && Object.hasOwn(on, 'custom.*') ? on['custom.*'] : undefined
  return typeof h === 'string' ? h : undefined
}
export function widgetEvent(name: WidgetEvent, extra: Record<string, unknown> = {}, ws?: string, tab?: { id: string; name: string; preset?: string }, o: { from?: From; hops?: number } = {}) {
  const hops = o.hops ?? 0
  const x = ws ? state.workspaces.find(v => v.id === ws) : undefined
  const i = x && wsInfo(x)
  const head = { event: name, at: Date.now(), ...(i && { ws: { id: i.id, name: i.name, project: i.project, branch: i.branch, pr: i.pr } }), ...(tab && { tab: { id: tab.id, name: tab.name, agent: tab.preset } }), ...(o.from && { from: o.from }) }
  const rec: EventSent = { at: head.at, event: name, ...(x && { ws: x.id }), ...(o.from && { from: { widget: o.from.widget, tab: o.from.tab?.id, agent: o.from.agent } }), ...(hops && { hops }), widgets: [], flows: [] }
  sent.push(rec)
  if (sent.length > SENT_MAX) sent.shift()
  const flows = eventHooks.flows?.(name, { ...head, ...extra }, x?.id, !!o.from?.agent)
  if (flows) Object.assign(rec, { flows: flows.flows }, flows.refused.length && { refused: flows.refused })
  if (![...widgets.values()].some(w => handlerOf(w, name))) return rec // none answers it: nothing built
  let json = JSON.stringify({ ...head, ...extra })
  if (json.length > EVENT_MAX) json = JSON.stringify({ ...head, cut: true }) // ponytail: past 64 KB its own fields all go
  for (const w of widgets.values()) {
    const h = handlerOf(w, name)
    if (!h || !onOf(w) || w.id === o.from?.widget) continue // never its own emits
    if (w.project && (x ? x.project !== w.project : !(name === 'app.open' || name.startsWith('custom.')))) continue // a repo's: its project's
    // its workspace's only; as one is archived or removed, that one's too (its action runs on what it was, keeps nothing)
    const going = (name === 'workspace.archived' || name === 'workspace.removed') && !!x && instOk({ ...x, archived: false })
    if (scoped(w) && !(x && (instOk(x) || going))) continue
    const q = queues.get(w.id) ?? []
    const at = scoped(w) ? x!.id : undefined
    if (h === 'refresh' && q.some(j => j.h === 'refresh' && j.ws === at && !j.gone)) {
      wLog(w, `event ${name}: a fetch for it waits already`) // one fetch after the burst, not one per event
      continue
    }
    q.push({ name, json, h, ws: at, gone: scoped(w) && going ? i : undefined, hops })
    if (q.length > QUEUE_MAX) wLog(w, `event ${q.shift()!.name}: dropped, ${QUEUE_MAX} more waiting`, 'warn')
    queues.set(w.id, q)
    rec.widgets.push(w.id)
    void drain(w.id)
  }
  return rec
}
// ---------- gates (an action's "gate": ["ship", "merge", "archive"]): before Laki ships, merges or archives a
// workspace, each gate for that step runs: on, a scope workspace one only in a workspace it has (instOk), GATE_MAX at
// most, together, gateWait each. stdin and LAKI_EVENT_FILE: { gate, ws, pr, stat, by }, LAKI_GATE the step, the
// workspace's env. It prints { "ok": false, "why", "fix" } to hold the step. An error or no answer goes ahead, said (a
// log line, a toast), except for an unattended step (by auto: Merge when green, archive on merge): held
const GATE_MAX = 8
const gateWait = () => Number(process.env.LAKI_GATE_MS) || 30_000 // tests' shorter
export type GateBy = 'you' | 'agent' | 'auto' | 'workflow'
const gatesOf = (w: Entry, step?: Gate) => Object.entries(w.m.actions ?? {}).filter(([, a]) => (step ? gateOf(a).includes(step) : gateOf(a).length))
// the gates' extensions as they are now: a hold is tried again once one of them changed (Merge when green)
export const gatesKey = (ids: string[]) => ids.map(id => (w => (w ? `${id}:${onOf(w)}:${filesHash(w)}` : `${id}:gone`))(widgets.get(id))).join(',')
export async function widgetGates(step: Gate, x: Workspace, by: GateBy, facts: { pr: unknown; stat: unknown }): Promise<GateHeld[]> {
  const all = [...widgets.values()].filter(w => onOf(w) && inProj(w, x) && (!scoped(w) || instOk(x))).flatMap(w => gatesOf(w, step).map(([a]) => ({ w, a })))
  if (!all.length) return []
  for (const { w, a } of all.slice(GATE_MAX)) wLog(w, `gate ${a} (${step}): not run, ${GATE_MAX} gates at most for a step`, 'warn')
  const input = JSON.stringify({ gate: step, ws: wsInfo(x), pr: facts.pr ?? null, stat: facts.stat ?? null, by })
  const held: GateHeld[] = []
  await Promise.all(
    all.slice(0, GATE_MAX).map(async ({ w, a }) => {
      const name = w.m.name || w.id
      const hold = (why: string, fix?: string) => void held.push({ widget: w.id, name, gate: step, why, ...(fix && { fix }), ...(w.m.icon && { icon: w.m.icon }) })
      const file = join(tmpdir(), `laki-gate-${randomBytes(8).toString('hex')}.json`)
      writeFileSync(file, input, { mode: 0o600 })
      const k = keyOf(w.id, scoped(w) ? x.id : undefined)
      const reason = `gate:${step}`
      const t0 = Date.now()
      let problem: string | undefined
      try {
        const { out, err } = await exec(w, '/bin/sh', ['-c', actionCmd(w.m.actions![a])!], { LAKI_REFRESH_REASON: reason, ...wsEnv(w, x), LAKI_GATE: step, LAKI_EVENT_FILE: file }, input, gateWait())
        ran(k, { at: t0, ms: Date.now() - t0, reason, why: by, action: a, ok: true, bytes: Buffer.byteLength(out), stderr: tail(err), exit: 0 }, err)
        const j = [out, lastLine(out)].map(t => {
          try {
            return JSON.parse(t ?? '') as unknown
          } catch {
            return undefined
          }
        }).find(isObj)
        if (!j || typeof j.ok !== 'boolean') problem = `printed no {"ok": …}: ${lastLine(out) ?? 'nothing'}`
        else if (j.ok) wLog(w, `gate ${a} (${step}, by ${by}): ok`)
        else {
          const why = typeof j.why === 'string' && j.why.trim() ? j.why.trim().slice(0, 2000) : 'it said no'
          wLog(w, `gate ${a} (${step}, by ${by}): held: ${why}`, 'warn')
          hold(why, typeof j.fix === 'string' && j.fix.trim() ? j.fix.trim().slice(0, 8000) : undefined)
        }
      } catch (e) {
        const f = e as Failed
        ran(k, { at: t0, ms: Date.now() - t0, reason, why: by, action: a, ok: false, bytes: 0, error: f.message, stderr: tail(f.stderr), exit: f.exit }, f.stderr)
        problem = f.message
      } finally {
        rmSync(file, { force: true })
      }
      if (problem === undefined) return
      if (by === 'auto') {
        wLog(w, `gate ${a} (${step}) failed: ${problem}: held, nobody is watching`, 'error')
        return hold(`its gate failed: ${problem}`)
      }
      wLog(w, `gate ${a} (${step}) failed: ${problem}: went ahead`, 'error')
      broadcast({ ev: 'widget-say', widget: w.id, toast: `${name}'s gate failed: ${problem.slice(0, 120)}. Went ahead` })
    }),
  )
  for (const h of held) widgetEvent('gate.held', { gate: h.gate, widget: h.widget, why: h.why }, x.id)
  return held
}

// an event of your own (laki widget emit, MCP's laki_extension_emit): custom.<name> with data (64 KB at most), from an
// extension's command (its LAKI_WIDGET), an agent's tab or you; hops: the event being handled when it was made (its
// handler's LAKI_EVENT_HOPS), one more here
export function widgetEmit(o: { name?: unknown; data?: unknown; ws?: unknown; from?: { widget?: unknown; tab?: unknown; ws?: unknown }; hops?: unknown; ai?: unknown }) {
  const raw = String(o.name ?? '').trim()
  const name = raw.startsWith('custom.') ? raw : `custom.${raw}`
  if (!CUSTOM_EVENT.test(name)) throw new Error(`${raw || '(none)'}: an event's name is letters, digits, . _ - (custom.<name>, 41 at most)`)
  const data = o.data === undefined ? {} : o.data
  if (JSON.stringify(data).length > EVENT_MAX) throw new Error(`its data is over ${EVENT_MAX >> 10} KB`)
  const ws = typeof o.ws === 'string' && o.ws ? state.workspaces.find(x => x.id === o.ws || x.name === o.ws) : undefined
  if (o.ws && !ws) throw new Error(`no workspace ${o.ws}`)
  const t = typeof o.from?.tab === 'string' ? state.tabs.find(x => x.id === o.from!.tab) : undefined
  const agent = agentCaller(o.from) ? t?.preset ?? 'agent' : o.ai === true ? 'Laki AI' : undefined // Laki AI's counts as an agent's
  const widget = typeof o.from?.widget === 'string' && widgets.has(o.from.widget) ? o.from.widget : undefined
  const from: From = { ...(widget && { widget }), ...(t && { tab: { id: t.id, name: t.name } }), ...(agent && { agent }) }
  const hops = o.hops === undefined || o.hops === '' ? 0 : (Number(o.hops) || 0) + 1
  if (hops > HOPS_MAX) {
    const w = widget ? widgets.get(widget) : undefined
    if (w) wLog(w, `emit ${name}: dropped, ${hops} hops (a loop of events?)`, 'warn')
    sent.push({ at: Date.now(), event: name, ...(ws && { ws: ws.id }), from: { widget, tab: t?.id, agent }, hops, widgets: [], flows: [], refused: [`${hops} hops: dropped`] })
    if (sent.length > SENT_MAX) sent.shift()
    return { ok: false, dropped: `${hops} hops: a loop of events? dropped` }
  }
  const rec = widgetEvent(name as WidgetEvent, { data }, ws?.id, undefined, { from, hops })
  return { ok: true, event: name, widgets: rec.widgets, flows: rec.flows }
}
export const widgetEvents = () => [...sent].reverse()
async function drain(id: string) {
  if (draining.has(id)) return
  draining.add(id)
  try {
    for (let j = queues.get(id)?.shift(); j; j = queues.get(id)?.shift()) await handle(id, j).catch(e => wLog({ id }, `event ${j!.name}: ${(e as Error).message}`, 'error'))
  } finally {
    draining.delete(id)
    queues.delete(id)
  }
}
async function handle(id: string, j: Job) {
  const w = widgets.get(id)
  if (!w || !onOf(w)) return
  const file = join(tmpdir(), `laki-event-${randomBytes(8).toString('hex')}.json`)
  writeFileSync(file, j.json, { mode: 0o600 })
  const ev = { env: { LAKI_EVENT: j.name, LAKI_EVENT_FILE: file, LAKI_EVENT_HOPS: String(j.hops) }, stdin: j.json, gone: j.gone }
  try {
    if (j.h === 'refresh' && j.gone) wLog(w, `event ${j.name}: not fetched: ${j.gone.name} is gone, nothing to keep (an action runs on it)`)
    else if (j.h === 'refresh') {
      const r = await widgetRun({ id, reason: `event:${j.name}`, ws: j.ws }, false, ev)
      if (!r.ok) wLog(w, `event ${j.name}: not fetched: ${r.error}`, 'warn')
    } else {
      const r = await widgetAction({ id, action: j.h, ws: j.ws }, `event:${j.name}`, ev)
      if (r.ok && (r.toast || r.modal || r.close)) broadcast({ ev: 'widget-say', widget: id, ws: j.ws, toast: r.toast, modal: r.modal, close: r.close })
    }
  } finally {
    rmSync(file, { force: true })
  }
}

// ---------- streams (widget.json's stream: true; global ones only): its fetch runs all along (spawn), each line of
// JSON it prints its data, other lines its log. The view follows at most every 250 ms, the store every 5 s and as it
// ends. It runs while it's on and a window was shown in the last STREAM_IDLE (and within widgetHours); it stops when
// it's off, gone, reloaded, Stopped in Settings › Resources (until Fetch now, a switch or a reload) and at shutdown;
// after an exit it starts again 1, 2, 4… 60 s later (1 again once it ran a minute)
type Stream = { p?: ChildProcess; since?: number; restarts: number; last?: string; next?: number; wait: number; timer?: NodeJS.Timeout; view?: NodeJS.Timeout; save?: NodeJS.Timeout; data?: unknown; unsaved?: boolean; ending?: boolean; stopped?: boolean; err: string }
const streams = new Map<string, Stream>()
const STREAM_IDLE = 10 * 60_000
let shownAt = 0 // the last time a window was shown
const streaming = (w: Entry) => w.m.stream === true && !scoped(w) && sourceOf(w).kind === 'fetch' && ownFetch(w)
function streamSync(now = Date.now()) {
  if (shown()) shownAt = now
  const hours = hoursOf()
  const ok = now - shownAt < STREAM_IDLE && (!hours || 'error' in hours || inHours(hours, now))
  for (const [id, st] of streams) {
    const w = widgets.get(id)
    if (w && streaming(w) && onOf(w) && !w.s.mock && ok) continue
    if (st.stopped && w && onOf(w)) continue // a Stop stays while it's on: nothing runs
    stopStream(id)
  }
  if (ok) for (const w of widgets.values()) if (streaming(w) && onOf(w) && !w.s.mock && !streams.get(w.id)?.stopped) startStream(w)
}
function startStream(w: Entry) {
  const was = streams.get(w.id)
  if (was?.p || was?.timer) return
  try {
    trusted(w)
  } catch {
    return
  }
  const script = w.m.script ? resolve(w.dir, w.m.script) : undefined
  if (script && !script.startsWith(w.dir + '/')) return
  const st: Stream = was ?? { restarts: 0, wait: 1, err: '' }
  streams.set(w.id, st)
  const p = spawn(script ? process.execPath : '/bin/sh', script ? ['--input-type=module', '-e', RUN_JS, script] : ['-c', w.m.fetch!], { cwd: w.dir, env: envOf(w, { LAKI_REFRESH_REASON: 'stream', ...(script && process.versions.electron && { ELECTRON_RUN_AS_NODE: '1' }) }), stdio: ['ignore', 'pipe', 'pipe'], detached: true }) // its group: a stop ends what it started
  own(p, `Extension · ${w.m.name || w.id} (stream)`, `stream:${w.id}`)
  Object.assign(st, { p, since: Date.now(), next: undefined, ending: false })
  wLog(w, `stream: ${script ? `node ${w.m.script}` : w.m.fetch}`)
  createInterface({ input: p.stdout! }).on('line', line => {
    st.last = line.slice(0, 500)
    let d: unknown
    try {
      d = JSON.parse(line)
    } catch {
      devLog(`widget:${w.id}`, `stream: ${line.slice(0, 300)}`)
      return xlog(w, 'info', 'stream', line)
    }
    st.data = d
    st.unsaved = true
    st.view ??= setTimeout(() => streamView(w.id), 250)
  })
  let part = '' // a line cut between two reads
  p.stderr!.on('data', b => {
    st.err = (st.err + b).slice(-4096)
    const lines = (part + b).split('\n')
    part = lines.pop()!.slice(-LOG_RUN)
    if (lines.length) xlog(w, 'info', 'stream', lines.join('\n'))
  })
  p.stderr!.on('end', () => part && xlog(w, 'info', 'stream', part))
  p.on('error', e => wLog(w, `stream: ${e.message}`, 'error'))
  p.on('exit', (code, sig) => {
    st.p = undefined
    streamView(w.id, true)
    const up = Date.now() - (st.since ?? Date.now())
    ran(w.id, { at: st.since ?? Date.now(), ms: up, reason: 'stream', ok: !code || st.ending === true, bytes: 0, error: code && !st.ending ? lastLine(st.err) || `exit ${code}` : undefined, stderr: tail(st.err), exit: code ?? 0 })
    st.err = ''
    changed()
    if (st.ending || streams.get(w.id) !== st) return // stopped
    if (up >= 60_000) st.wait = 1
    st.restarts++
    st.next = Date.now() + st.wait * 1000
    wLog(w, `stream ended (${sig ?? `exit ${code}`}) after ${Math.round(up / 1000)} s: again in ${st.wait} s`)
    st.timer = setTimeout(() => {
      st.timer = undefined
      if (streams.get(w.id) === st && !st.stopped) streamSync()
    }, st.wait * 1000)
    st.wait = Math.min(60, st.wait * 2)
  })
  changed()
}
// its last line to the view (at), and to the store every 5 s (end: now)
function streamView(id: string, end = false) {
  const st = streams.get(id)
  const w = widgets.get(id)
  if (!st || !w) return
  clearTimeout(st.view)
  st.view = undefined
  if (st.data !== undefined && st.unsaved) {
    w.s = { ...w.s, at: Date.now(), error: undefined }
    w.face = faceOf(w, st.data)
    changed()
  }
  const save = () => {
    clearTimeout(st.save)
    st.save = undefined
    if (!st.unsaved) return
    st.unsaved = false
    keep(w, undefined, s => ((s.data = st.data), (s.at = w.s.at), (s.error = undefined)))
  }
  if (end) save()
  else st.save ??= setTimeout(save, 5000)
}
function stopStream(id: string, park = false) {
  const st = streams.get(id)
  if (!st) return
  clearTimeout(st.timer)
  st.timer = undefined
  st.ending = true
  streamView(id, true)
  if (st.p) killGroup(st.p)
  if (park) (st.stopped = true), (st.next = undefined)
  else streams.delete(id)
  changed()
}
// Settings › Resources' Stop: until Fetch now, a switch or a reload
export const widgetStreamStop = (id: string) => stopStream(find(id).id, true)
const streamOf = (id: string): WidgetStream | undefined => (st => st && { running: !!st.p, since: st.p ? st.since : undefined, restarts: st.restarts, last: st.last, next: st.timer ? st.next : undefined, stopped: st.stopped })(streams.get(id))

// ---------- tools (an action's tool, shared/widgetSchema.ts toolOf): agents call them (laki widget tool, MCP's
// laki_extension_call and ext_<id>_<action>, Laki AI). Only an extension that's on has them; a scope workspace one's
// runs in the caller's workspace. Before it runs, the input is checked (toolArgs), then the user asked in the app as its
// tool says: always, first (once per workspace, Always kept in state.widgetGrants) or never; no window: refused, no
// answer in LAKI_TOOL_WAIT (2 minutes): refused. Its stdout goes back (16 KB), with stderr's last line on a failure
const TOOL_OUT = 16 << 10
const toolWait = () => Number(process.env.LAKI_TOOL_WAIT) || 120_000
const asking = new Map<string, (allow: string) => void>()
const toolsOf = (w: Entry) => Object.entries(w.m.actions ?? {}).flatMap(([a, x]) => (t => (t ? [[a, t] as const] : []))(toolOf(x)))
const cmdsOf = (w?: Entry) => JSON.stringify(Object.entries(w?.m.actions ?? {}).map(([a, x]) => [a, actionCmd(x)]))
const agentsOf = (w: Entry) => {
  if (w.file) return undefined
  try {
    return readFileSync(join(w.dir, 'AGENTS.md'), 'utf8').slice(0, 4096).trim() || undefined
  } catch {
    return undefined
  }
}
// what a Yes holds for (filesHash): the extension's own files (widgetFiles' list, all of them, sorted) and what it runs
// that lives outside them (the store's source; its actions (their commands, prompts, gates), on and stream, as read; net), so an edit asks again, one made
// while Laki was closed too (sh do.sh with do.sh changed). Laki AI's turn-on question, widgetSet's seen, a tool's ask and
// an Always's key (grantKey) all compare it. fresh: read now (a check), else as long as their sizes and times are the
// same (the view's). ponytail: its folder's top level and fixtures only, not a lib/ its script sources
const hashes = new Map<string, { sig: string; hash: string }>()
export function filesHash(w: Entry, fresh = false) {
  const cur = widgets.get(w.id) ?? w // its store as it is now: a source set meanwhile counts
  const out = JSON.stringify([sourceOf(cur), cur.m.actions ?? null, cur.m.on ?? null, cur.m.stream ?? null, !!cur.s.net])
  return createHash('sha256').update(`${dirHash(w, fresh)}\0${out}`).digest('hex')
}
// its own files' hash (cached by their times and sizes): a repo's extension's trust
// every file under its folder, relative, a folder's files before its subfolders (a link as a file): none hidden, no
// node_modules; all (a repo's, whose code may sit there too): those as well, but .git. ponytail: max files at most, a
// change past them isn't seen
const filesUnder = (d: string, all = false, max = 500, rel = '', out: string[] = []) => {
  let es: Dirent[] = []
  try {
    es = readdirSync(join(d, rel), { withFileTypes: true })
  } catch {}
  es = es.filter(x => (all ? x.name !== '.git' : !x.name.startsWith('.') && x.name !== 'node_modules'))
  for (const x of es) if (out.length < max && !x.isDirectory() && (x.isFile() || x.isSymbolicLink())) out.push(rel ? `${rel}/${x.name}` : x.name)
  for (const x of es) if (out.length < max && x.isDirectory()) filesUnder(d, all, max, rel ? `${rel}/${x.name}` : x.name, out)
  return out
}
function dirHash(w: Entry, fresh = false) {
  const names = (w.file ? [w.file] : w.project ? filesUnder(w.dir, true, 2000) : filesUnder(w.dir)).sort() // its subfolders too: a lib/ script a fetch runs
  const sig = JSON.stringify(names.map(n => (st => [n, st?.mtimeMs, st?.size])(statSync(join(w.dir, n), { throwIfNoEntry: false }))))
  let c = hashes.get(w.id)
  if (fresh || c?.sig !== sig) {
    const h = createHash('sha256')
    for (const n of names) {
      h.update(`\0${n}\0`)
      try {
        h.update(readFileSync(join(w.dir, n)))
      } catch {}
    }
    hashes.set(w.id, (c = { sig, hash: h.digest('hex') }))
  }
  return c!.hash
}
// an Always's key: id.action#hash, the hash over the action's command and filesHash
function grantKey(w: Entry, action: string, fresh = false) {
  return `${w.id}.${action}#${createHash('sha256').update(`${actionCmd(w.m.actions?.[action]) ?? ''}\0${filesHash(w, fresh)}`).digest('hex').slice(0, 12)}`
}
// an extension's grants gone: off, its commands changed, Revoke (one action)
function ungrant(id: string, action?: string, ws?: string) {
  const g = state.widgetGrants
  if (!g) return
  let n = 0
  for (const k of Object.keys(g)) {
    if (ws !== undefined && k !== ws) continue
    const keep = g[k].filter(x => !x.startsWith(action ? `${id}.${action}#` : `${id}.`))
    n += g[k].length - keep.length
    if (keep.length) g[k] = keep
    else delete g[k]
  }
  if (n) save(), changed()
}
export const widgetGrantRm = (o: { id: string; action: string; ws: string }) => (ungrant(find(o.id).id, String(o.action), String(o.ws ?? '')), { ok: true })
// each tool of the extensions that are on: its name (id.action), what it does, its input as a JSON Schema, the
// extension's AGENTS.md (when to use them)
export function widgetTools(o: { ws?: unknown } = {}) {
  const x = typeof o.ws === 'string' ? state.workspaces.find(v => v.id === o.ws) : undefined // a repo's only in its project's workspaces
  return [...widgets.values()].filter(w => onOf(w) && inProj(w, x)).flatMap(w => toolsOf(w).map(([action, t]) => ({ tool: `${w.id}.${action}`, id: w.id, action, name: w.m.name || w.id, description: t.description, input: toolSchema(t), ask: t.ask, ...(scoped(w) && { scope: 'workspace' }), ...(a => a && { agents: a })(agentsOf(w)) })))
}
export async function widgetToolCall(o: { id: string; action: string; input?: unknown; from?: { ws?: string; tab?: string; agent?: string } }): Promise<{ ok: boolean; output: string; error?: string }> {
  const w = find(String(o.id))
  if (!onOf(w)) throw new Error(OFF(w))
  const a = w.m.actions && Object.hasOwn(w.m.actions, o.action) ? w.m.actions[o.action] : undefined
  const t = toolOf(a)
  if (!t) throw new Error(`${w.m.name || w.id} has no tool ${o.action}`)
  const input = toolArgs(t, o.input)
  const from = o.from ?? {}
  if (!inProj(w, state.workspaces.find(v => v.id === from.ws))) throw new Error(`${w.m.name || w.id} is ${projName(w)}'s: its tools are for that project's workspaces`)
  const x = wsOf(w, scoped(w) ? from.ws : undefined) // a scope workspace one's: the caller's, refused without one
  const ws = x?.id ?? (state.workspaces.some(v => v.id === from.ws) ? from.ws! : '') // whose Always: '' for none (Laki AI)
  const tab = from.tab ? state.tabs.find(v => v.id === from.tab) : undefined
  const key = grantKey(w, o.action, true) // before the ask: approve refuses a change since, so Always is for what was shown
  let how = t.ask === 'never' ? 'never' : 'always' // 'always': granted before
  if (t.ask === 'always' || (t.ask === 'first' && !state.widgetGrants?.[ws]?.includes(key))) {
    how = await approve(w, o.action, { description: t.description, ask: t.ask, input, ws, tab: tab?.id ?? from.tab, agent: from.agent ?? tab?.name })
    if (how === 'always' && t.ask === 'first') {
      const g = (state.widgetGrants ??= {})
      g[ws] = [...(g[ws] ?? []).filter(k => !k.startsWith(`${w.id}.${o.action}#`)), key] // one made for its older files goes
      save()
      changed()
    }
  }
  const env = Object.fromEntries(Object.entries(input).map(([k, v]) => [`WIDGET_INPUT_${k.toUpperCase()}`, Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? '1' : '') : String(v ?? '')]))
  const why = `${ws || 'no workspace'}${from.tab ? `/${from.tab}` : ''}${from.agent ? ` (${from.agent})` : ''}, allowed ${how}`
  if (ws) devLog(`ws:${ws}`, `${w.m.name || w.id}: tool ${o.action} (${why})`)
  const r = await widgetAction({ id: w.id, action: o.action, arg: JSON.stringify(input), ws: x?.id }, `tool:${o.action}`, { env, stdin: JSON.stringify(input), why, full: true })
  if (r.ok && (r.toast || r.modal || r.close)) broadcast({ ev: 'widget-say', widget: w.id, ws: x?.id, toast: r.toast, modal: r.modal, close: r.close })
  const output = (r.stdout ?? '').slice(0, TOOL_OUT)
  return r.ok ? { ok: true, output } : { ok: false, output, error: r.error }
}
// the user's answer in the app (toolAsk: its dialog and a notification): once, always (a tool that asks first) or deny.
// Refused with no window, no answer in LAKI_TOOL_WAIT, a deny, or the action changed meanwhile (a dev save, a reload):
// only what the user saw runs
async function approve(w: Entry, action: string, o: { description: string; ask: string; input?: unknown; ws?: string; tab?: string; agent?: string }) {
  if (!clients.size) throw new Error("Laki's window isn't open: nobody to approve it")
  const def = w.m.actions?.[action]
  const ai = aiActOf(def)
  const req = randomBytes(8).toString('hex')
  const hash = filesHash(w, true) // what the user is shown: its files as they are now
  const how = await answered({ ev: 'toolAsk', req, widget: w.id, action, name: w.m.name || w.id, ...o, command: actionCmd(def) ?? `an agent answers: ${ai?.prompt ?? ''}`, ws: o.ws || undefined, hash })
  if (how === 'none') throw new Error(`${w.m.name || w.id} ${action}: no answer: not run`)
  if (how === 'deny') throw new Error(`${w.m.name || w.id} ${action}: denied`)
  const now = widgets.get(w.id)
  if (!now || filesHash(now, true) !== hash) throw new Error(`${w.m.name || w.id} ${action}: its files changed while you were asked: not run`)
  return how
}
// an ask sent to the app's windows (and to each one that connects while it waits: widgetAsks), the first answer
// (widgetToolAnswer), 'none' past LAKI_TOOL_WAIT; then the other windows' dialogs close
const asks = new Map<string, { ev: string; req: string }>()
async function answered(msg: { ev: string; req: string; [k: string]: unknown }) {
  const { req } = msg
  asks.set(req, msg)
  broadcast(msg)
  const how = await new Promise<string>(ok => {
    const timer = setTimeout(() => (asking.delete(req), ok('none')), toolWait())
    asking.set(req, allow => (clearTimeout(timer), asking.delete(req), ok(allow)))
  })
  asks.delete(req)
  broadcast({ ev: 'toolDone', req })
  return how
}
export const widgetAsks = (c: { send: (m: unknown) => void }) => asks.forEach(m => c.send(m)) // a window that opened (or came back) meanwhile
// an AI source's or action's claude asking for a tool it may not use unasked (aiOnce's --permission-prompt-tool: laki
// mcp's laki_permission, LAKI_PERM_EXT): asked in the app as a tool call is (toolAsk with perm) and as a notification.
// Always: that tool unasked in its runs from now on (the store's allow; its page lists them, Revoke). Nobody there, no
// answer or a deny: it goes on without it
export async function widgetPermission(p: { ext?: unknown; tool?: unknown; input?: unknown }): Promise<{ allow: boolean; message?: string }> {
  const w = find(String(p.ext ?? ''))
  const tool = String(p.tool ?? '')
  if (!TOOL_NAME.test(tool)) throw new Error('a tool’s name') // it goes into --allowedTools: never an option, nor two names
  if (readStore(w.id).allow?.includes(tool)) return { allow: true }
  if (!clients.size) return { allow: false, message: "Laki's window isn't open, so nobody could allow it: do without it, and say so." }
  const how = await answered({ ev: 'toolAsk', req: randomBytes(8).toString('hex'), widget: w.id, name: w.m.name || w.id, perm: tool, input: p.input ?? {}, ask: 'first' })
  wLog(w, `its agent asked for ${tool}: ${how === 'none' ? 'no answer' : how}`)
  if (how === 'always') {
    const s = readStore(w.id)
    s.allow = [...new Set([...(s.allow ?? []), tool])]
    writeStore(w.id, s)
    const cur = widgets.get(w.id)
    if (cur) cur.s = { ...cur.s, allow: s.allow }
    changed()
  }
  return how === 'once' || how === 'always' ? { allow: true } : { allow: false, message: how === 'deny' ? 'The user said no: do without it, and say so.' : 'No one answered: do without it, and say so.' }
}
const TOOL_NAME = /^\w[\w.-]{0,199}$/ // claude's: Bash, WebFetch, mcp__claude_ai_Slack__slack_read_channel
// the tools an AI source's or action's agent may use unasked: widget.json's (or the source's) and the ones allowed since
const allowedOf = (w: Entry, tools?: string) => [tools, ...(readStore(w.id).allow ?? [])].filter(Boolean).join(',') || undefined
// the app's answer (its dialog, a notification's button): once, always, or deny
export function widgetToolAnswer(o: { req: string; allow: string }) {
  const f = asking.get(String(o.req))
  if (!f) return { ok: false } // answered elsewhere, or timed out
  f(['once', 'always', 'deny'].includes(o.allow) ? o.allow : 'deny')
  return { ok: true }
}

// laki widget push (a cron job, a git hook, CI on this Mac, another app): data put there as a fetch would, none run;
// merge: over its last data, shallow (both objects). An off one refuses it
export const widgetName = (id: string) => (w => w?.m.name || id)(widgets.get(id))

// a scheduled task's check as it's saved: the extension and its action are there (on or off: it may be on by its time)
export function widgetUseCheck(id: string, action?: string) {
  const w = find(id)
  if (action && !(w.m.actions && Object.hasOwn(w.m.actions, action))) throw new Error(`${w.m.name || w.id} has no action ${action}`)
  if (!action && !fetches(w)) throw new Error(`${w.m.name || w.id} has nothing to fetch: pick one of its actions`)
  return { name: w.m.name || w.id, scoped: scoped(w) }
}

// a scheduled task's or a workflow's: one that's on (never an off one, Laki AI's either), fetched now and waited for (one
// fetching already: that fetch), else one of its actions run; its data after. ws: the run's workspace, a scoped one's only
export async function widgetUse(o: { id: string; action?: string; arg?: string; ws?: string }, reason: 'schedule' | 'workflow', why: string): Promise<{ ok: boolean; error?: string; name: string; data?: unknown; out?: string }> {
  const w = find(o.id)
  const name = w.m.name || w.id
  if (!onOf(w)) return { ok: false, name, error: OFF(w) }
  if (scoped(w) && !o.ws) return { ok: false, name, error: `${name} is per workspace: pick a workspace` }
  const ws = scoped(w) ? wsOf(w, o.ws)?.id : undefined
  if (o.action) {
    const r = await widgetAction({ id: w.id, action: o.action, arg: o.arg, ws })
    if (r.ok && (r.toast || r.modal || r.close)) broadcast({ ev: 'widget-say', widget: w.id, ws, toast: r.toast, modal: r.modal, close: r.close })
    return { ok: r.ok, error: r.error, name, out: r.out }
  }
  if (streaming(w)) return { ok: true, name, data: dataOf(w).data } // its live line: a run would restart it
  const k = keyOf(w.id, ws)
  let r = running.has(k) ? { ok: false } : await widgetRun({ id: w.id, reason, why, ws })
  if (!r.ok && running.has(k)) {
    // ponytail: polled, a fetch has its own time limit
    while (running.has(k)) await new Promise(f => setTimeout(f, 300))
    const e = metaOf(w, ws).error
    r = e ? { ok: false, error: e } : { ok: true }
  }
  return { ...r, name, data: r.ok ? dataOf(w, ws).data : undefined }
}

export function widgetPush(o: { id: string; data?: unknown; ws?: string; merge?: boolean }) {
  const w = find(o.id)
  if (!onOf(w)) throw new Error(OFF(w))
  if (!('data' in o)) throw new Error('data: JSON to show')
  const x = wsOf(w, o.ws)
  const t0 = Date.now()
  keep(w, x?.id, s => ((s.data = o.merge && isObj(s.data) && isObj(o.data) ? { ...s.data, ...o.data } : o.data), (s.at = t0), (s.error = s.mock = undefined)))
  const st = streams.get(w.id)
  if (st && !x) st.data = undefined // a stream's line until then: the push shows
  ran(keyOf(w.id, x?.id), { at: t0, ms: 0, reason: 'push', ok: true, bytes: Buffer.byteLength(JSON.stringify(o.data) ?? ''), exit: 0 })
  wLog(w, `pushed${o.merge ? ', merged' : ''}${x ? ` (${x.id})` : ''}`)
  changed()
  return { ok: true }
}

// an extension's files, as text (Laki AI's and MCP's laki_extension_read: an example to copy, or the one to change):
// its folder's own files only, none hidden, and fixtures/*.json, 20 at most; a one-file extension's file
const filesAndDirs = (d: string) => {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}
const filesIn = (d: string) => {
  try {
    return readdirSync(d, { withFileTypes: true }).filter(x => x.isFile() && !x.name.startsWith('.')).map(x => x.name)
  } catch {
    return []
  }
}
export function widgetFiles(o: { id: string }) {
  const w = find(o.id)
  const hash = filesHash(w, true) // before they're read: a change in between gives a hash widgetSet's seen won't take
  const files: Record<string, string> = {}
  for (const n of (w.file ? [w.file] : [...filesIn(w.dir), ...fixturesOf(w).map(f => `fixtures/${f}.json`)]).slice(0, 20)) {
    const p = join(w.dir, n)
    const buf = statSync(p).size > 64 << 10 ? null : readFileSync(p)
    files[n] = !buf ? '(over 64 KB: not shown)' : buf.includes(0) ? '(binary: not shown)' : buf.toString('utf8')
  }
  return { id: w.id, builtin: w.builtin || undefined, files, hash }
}

// the inspector's Files, edited by hand: one of the files widgetFiles lists, written in place (its mode stays). was: the
// text the edit started from (changed meanwhile: refused unless force); a .json one must parse (widget.json: an object),
// so a slip doesn't take the extension away. Not one that comes with Laki (an update would undo it: Remix makes a copy);
// one of Laki's folder is kept for the studio's Undo first. Read again at once (a dev one: its watch does it)
export function widgetFileSave(o: { id: string; path: string; text: string; was?: string; force?: boolean }) {
  const w = find(o.id)
  if (w.builtin) throw new Error(`${w.m.name || w.id} comes with Laki: Remix it to change a copy`)
  if (w.project) throw new Error(repoSays(w, 'change it'))
  const names = w.file ? [w.file] : [...filesIn(w.dir), ...fixturesOf(w).map(f => `fixtures/${f}.json`)]
  if (typeof o.path !== 'string' || !names.includes(o.path)) throw new Error(`${o.path}: not one of its files`)
  if (typeof o.text !== 'string' || Buffer.byteLength(o.text) > 64 << 10) throw new Error('its text, up to 64 KB (more: open its folder)') // widgetFiles shows no more
  if (o.path.startsWith('fixtures/') && !statOf(join(w.dir, 'fixtures'))?.isDirectory()) throw new Error('fixtures is a link there')
  const p = join(w.dir, o.path)
  if (!statOf(p)?.isFile()) throw new Error(`${o.path} is a link or a folder there`)
  const buf = readFileSync(p)
  if (buf.length > 64 << 10 || buf.includes(0)) throw new Error(`${o.path} is over 64 KB or not text: open its folder to edit it`)
  if (!o.force && typeof o.was === 'string' && buf.toString('utf8') !== o.was) throw new Error(`${o.path} changed since you opened it`)
  if (/\.json$/i.test(o.path)) {
    let j: unknown
    try {
      j = JSON.parse(o.text)
    } catch (e) {
      throw new Error(`${o.path}: not JSON: ${(e as Error).message}`)
    }
    if (o.path === 'widget.json' && (!j || typeof j !== 'object' || Array.isArray(j))) throw new Error('widget.json: an object')
  }
  if (w.dir === join(widgetHome(), w.id)) snapshot(w.id, w.dir)
  writeFileSync(p, o.text)
  wLog(w, `edited by hand: ${o.path}`)
  if (!w.dev) {
    scanWidgets()
    const now = widgets.get(w.id)
    if (now) refetch(now, 'reload', `${o.path} edited`)
  }
  return widgetsView().find(x => x.id === w.id)
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
  const repo = widgets.get(String(o.id))
  if (repo?.project) throw new Error(repoSays(repo, 'change it'))
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
    if (needsSample(j) && j.sample === undefined) throw new Error('widget.json: a sample too, made-up data in the shape its data takes, for its preview (laki_extension_guide)') // every extension shows how it looks before it runs
  }
  mkdirSync(widgetHome(), { recursive: true })
  const at = statOf(d)
  if (at && !at.isDirectory()) throw new Error(`${d} isn't a folder`)
  snapshot(o.id, d)
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
  writeStore(o.id, { ...readStore(o.id), on: false, net: undefined, by: theirs ? was.by : 'ai', aiMay: theirs ? was.aiMay : undefined }) // net too: the user allows the network for the page they looked at, not a rewrite; the user's own: its hour's leave stays (a write, a check, a fix)
  scanWidgets()
  wLog({ id: o.id }, `written: ${files.map(([n]) => n).join(', ')}; off until it's turned on`)
  return { ...widgetsView().find(w => w.id === o.id), note: 'Saved turned off: the user looks at it on its page (Settings › Extensions, with its sample) and turns it on' }
}

// ---------- the studio (WidgetStudio.tsx): each write undoable, a copy to change, a name for a new one

// before each write: the folder as it was, <data>/widget-data/<id>.history/<ms>/ (none yet: an empty one with .none),
// the last HISTORY. widgetUndo puts one back
const HISTORY = 20
const KEPT = /^(\.git|node_modules)$/ // a folder's own, never in its versions: a snapshot, Undo and Remix leave them be
const fetching = (id: string) => [...running].some(k => k === id || k.startsWith(`${id}@`)) // it, or one of its instances
const histDir = (id: string) => join(dir, 'widget-data', `${id}.history`)
const hist = new Map<string, number[]>() // read once per id, then kept in step by snapshot, widgetUndo and widgetRm
const historyOf = (id: string) => {
  let h = hist.get(id)
  if (!h) {
    try {
      h = readdirSync(histDir(id)).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b)
    } catch {
      h = []
    }
    hist.set(id, h)
  }
  return h
}
function snapshot(id: string, d: string) {
  const all = historyOf(id)
  const at = Math.max(Date.now(), (all.at(-1) ?? 0) + 1) // two in one ms: still in order
  const to = join(histDir(id), String(at))
  if (statOf(d)?.isDirectory()) cpSync(d, to, { recursive: true, verbatimSymlinks: true, filter: p => dirname(p) !== d || !KEPT.test(basename(p)) })
  else mkdirSync(to, { recursive: true }), writeFileSync(join(to, '.none'), '')
  for (const n of all.slice(0, Math.max(0, all.length + 1 - HISTORY))) rmSync(join(histDir(id), String(n)), { recursive: true, force: true })
  hist.delete(id)
}
// Undo (after: the first one taken after then, a turn's Undo to here; none: the newest): that one back, it and the
// newer ones gone. Laki's own folder only; off again, as a write leaves it
export function widgetUndo(o: { id: string; after?: number }) {
  if (typeof o.id !== 'string' || !ID.test(o.id)) throw new Error('an id: lowercase letters, digits and dashes')
  const all = historyOf(o.id)
  const at = o.after === undefined ? all.at(-1) : all.find(n => n > Number(o.after))
  if (at === undefined) throw new Error('nothing to undo')
  const d = join(widgetHome(), o.id)
  const had = widgets.get(o.id)
  if (had && had.dir !== d) throw new Error(`${o.id} isn't in Laki's folder`)
  if (fetching(o.id)) throw new Error(`${o.id} is fetching: try again in a moment`)
  if (statOf(d)?.isSymbolicLink()) throw new Error(`${d} is a link: not undone`)
  const from = join(histDir(o.id), String(at))
  if (existsSync(join(from, '.none'))) rmSync(d, { recursive: true, force: true })
  else {
    for (const n of filesAndDirs(d)) if (!KEPT.test(n)) rmSync(join(d, n), { recursive: true, force: true }) // its node_modules and .git stay
    cpSync(from, d, { recursive: true, verbatimSymlinks: true })
  }
  for (const n of all.filter(n => n >= at)) rmSync(join(histDir(o.id), String(n)), { recursive: true, force: true })
  hist.delete(o.id)
  if (existsSync(storePath(o.id))) writeStore(o.id, { ...readStore(o.id), on: false })
  scanWidgets()
  wLog({ id: o.id }, `undone: back to before ${new Date(at).toLocaleTimeString()}`)
  return { ok: true, at, gone: !widgets.has(o.id) }
}
// Remix: a copy in Laki's folder under a new id (any one's: built-in, a folder of yours), the user's own (not by Laki
// AI), off, with Laki AI's leave to rewrite it (aiMay). Not a one-file extension's (its file name is its id)
export function widgetRemix(o: { id: string; newId?: string }) {
  const w = find(String(o.id))
  if (w.file) throw new Error(`${w.m.name || w.id} is one file: copy ${w.file} and rename it`)
  const id = o.newId === undefined ? freeId(`${w.project ? w.id.slice(w.project.length + 1) : w.id}-copy`) : String(o.newId) // a repo's: yours now, under its own name
  if (!ID.test(id)) throw new Error('an id: lowercase letters, digits and dashes')
  const d = join(widgetHome(), id)
  if (widgets.has(id) || statOf(d)) throw new Error(`${id} is taken`)
  mkdirSync(widgetHome(), { recursive: true })
  const src = realpathSync(w.dir) // a linked folder: what it links to, not the link
  cpSync(src, d, { recursive: true, verbatimSymlinks: true, filter: p => p === src || !KEPT.test(basename(p)) })
  try {
    const m = JSON.parse(readFileSync(join(d, 'widget.json'), 'utf8'))
    writeFileSync(join(d, 'widget.json'), `${JSON.stringify({ ...m, name: `${m.name || w.id} (copy)` }, null, 2)}\n`)
  } catch {} // its scan says what's wrong
  writeStore(id, { on: false, aiMay: Date.now() })
  scanWidgets()
  wLog({ id }, `a copy of ${w.id}`)
  return { id }
}
// a new one's id from the first words of its first ask: lowercase, dashes, free (no extension, folder or chat of it)
const freeId = (base: string) => {
  const b = base.slice(0, 34).replace(/-+$/, '') || 'extension'
  for (let i = 1; ; i++) {
    const id = i === 1 ? b : `${b}-${i}`
    if (!widgets.has(id) && !statOf(join(widgetHome(), id)) && !statOf(join(dir, 'widget-data', `widget:${id}.chat.json`))) return id
  }
}
export const widgetSlug = (o: { text?: string }) => ({
  id: freeId(
    String(o.text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(x => x && !/^(a|an|the|my|me|show|make|of|for|with|to|and|in|on|i|want|please|that|which|as|is|at|from|by)$/.test(x))
      .slice(0, 3)
      .join('-'),
  ),
})
// a widget chat's file (ai.ts' thread): <data>/widget-data/widget:<id>.chat.json, gone with widgetRm
export const widgetChatFile = (chat: string) => {
  const m = /^widget:([a-z0-9][a-z0-9-]{0,39})$/.exec(chat)
  if (!m) throw new Error(`no chat ${chat}`)
  mkdirSync(join(dir, 'widget-data'), { recursive: true })
  return join(dir, 'widget-data', `${chat}.chat.json`)
}

// Settings › Extensions' Delete: its folder (a link: only the link; a one-file extension: its file), its store, its
// instances, its history, its chat and its secrets go to the trash (widgetRestore puts them back: Undo). Not one that
// comes with Laki (turn it off), nor a folder that holds more than it (your home, Laki's own). Its grants go for good
export async function widgetRm(o: { id: string }) {
  const w = find(o.id)
  if (w.builtin) throw new Error(`${w.m.name || w.id} comes with Laki: turn it off instead`)
  if (w.project) throw new Error(repoSays(w, 'remove it'))
  if (w.dev) throw new Error(`${w.m.name || w.id} is your code, linked by laki widget dev: unlink it instead (laki widget dev --off ${w.id})`)
  if (agents.has(w.id)) {
    stopAgents(w.id) // an agent at work: stopped, and its run ends before its files go
    for (let i = 0; i < 50 && (agents.has(w.id) || fetching(w.id)); i++) await new Promise(r => setTimeout(r, 100))
  }
  if (fetching(w.id)) throw new Error(`${w.m.name || w.id} is fetching: try again in a moment`)
  const d = resolve(pathOf(w))
  if (!w.file && [homedir(), dir, widgetHome(), '/'].includes(d)) throw new Error(`${d} isn't one extension's own folder`) // a widget.json put in one of those
  wLog(w, `deleted: ${d}, to the trash`)
  flushLogs() // its log goes with it, whole
  const at = Date.now()
  const t = join(trashDir(), `${w.id}-${at}`)
  mkdirSync(t, { recursive: true })
  const link = statOf(d)?.isSymbolicLink() ? readlinkSync(d) : undefined // made again on restore, never followed
  if (link) unlinkSync(d)
  else if (statOf(d)) move(d, join(t, 'ext'))
  for (const [from, to] of keptOf(w.id)) if (statOf(from)) move(from, join(t, to))
  const sec = secretsOf(w.id)
  if (Object.keys(sec).length) writeFileSync(join(t, 'secrets.json'), JSON.stringify(sec), { mode: 0o600 }), setSecrets(w.id, s => Object.keys(s).forEach(k => delete s[k]))
  writeFileSync(join(t, 'trash.json'), JSON.stringify({ id: w.id, name: w.m.name || w.id, from: d, ...(link && { link }), ...(w.file && { file: w.file }), at } satisfies Trashed))
  hist.delete(w.id)
  hashes.delete(w.id)
  pending.delete(w.id), lastN.delete(w.id), errAt.delete(w.id)
  ungrant(w.id)
  scanWidgets()
  return { deleted: w.id, trash: basename(t) }
}

// ---------- the trash: <data>/widget-trash/<id>-<ms>/ (ext: its folder or file; store.json, inst/, history/,
// chat.json, secrets.json; trash.json says what and from where). Kept TRASH_DAYS, the newest TRASH_MAX
type Trashed = { id: string; name: string; from: string; link?: string; file?: string; at: number }
const TRASH_DAYS = 30
const TRASH_MAX = 20
const trashDir = () => join(dir, 'widget-trash')
// what of an extension is kept beside its folder, and its name in the trash
const keptOf = (id: string): [string, string][] => [
  [storePath(id), 'store.json'],
  [join(dir, 'widget-data', id), 'inst'], // its workspaces' instances
  [histDir(id), 'history'], // the studio's Undo
  [join(dir, 'widget-data', `widget:${id}.chat.json`), 'chat.json'],
  [logPath(id), 'log'], // its log (flushLogs first)
  [`${logPath(id)}.1`, 'log.1'],
]
// renamed, or copied then removed across volumes (EXDEV)
function move(from: string, to: string) {
  try {
    renameSync(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    rmSync(from, { recursive: true, force: true })
  }
}
export function widgetTrash() {
  let names: string[] = []
  try {
    names = readdirSync(trashDir())
  } catch {}
  return names
    .flatMap(n => (m => (m ? [{ trash: n, ...m }] : []))(readJson<Trashed>(join(trashDir(), n, 'trash.json'))))
    .sort((a, b) => b.at - a.at)
}
// Undo: back where it was (its link made again), on or off as it was; refused when its id or its place is taken now
export function widgetRestore(o: { trash: string }) {
  const n = String(o.trash ?? '')
  const m = /^[\w.-]+-\d+$/.test(n) ? readJson<Trashed>(join(trashDir(), n, 'trash.json')) : undefined
  if (!m) throw new Error(`no ${n} in the trash: laki widget trash lists it`)
  const t = join(trashDir(), n)
  if (widgets.has(m.id) || statOf(storePath(m.id))) throw new Error(`${m.id} is taken now: not restored`)
  if (statOf(m.from)) throw new Error(`${m.from} is there now: not restored`)
  mkdirSync(dirname(m.from), { recursive: true })
  if (m.link) symlinkSync(m.link, m.from)
  else if (statOf(join(t, 'ext'))) move(join(t, 'ext'), m.from)
  for (const [to, from] of keptOf(m.id)) if (statOf(join(t, from))) mkdirSync(dirname(to), { recursive: true }), move(join(t, from), to)
  const sec = readJson<Record<string, string>>(join(t, 'secrets.json'))
  if (sec) setSecrets(m.id, s => Object.assign(s, sec))
  rmSync(t, { recursive: true, force: true })
  hist.delete(m.id)
  lastN.delete(m.id) // its log's n read again from its file
  scanWidgets()
  wLog(m, `restored from the trash: ${m.from}`)
  return widgetsView().find(w => w.id === m.id) ?? { id: m.id }
}
// at start and hourly: past TRASH_DAYS, and past the newest TRASH_MAX, gone for good
export function widgetTrashTidy(now = Date.now()) {
  for (const [i, e] of widgetTrash().entries()) if (i >= TRASH_MAX || now - e.at > TRASH_DAYS * 86400e3) rmSync(join(trashDir(), e.trash), { recursive: true, force: true })
}

// a widget's folder, for Open in (core's openIn)
export const widgetDir = (id: string) => find(id).dir

// Settings' Reload: the folders again, then every widget that's on fetches
export function widgetReload() {
  scanWidgets()
  for (const w of widgets.values()) refetch(w, 'reload')
  return widgetsView()
}

// the inspector's Runs and Env and laki widget dev's lines: the last runs, what a fetch is given (a secret, and a setting
// whose name says token, secret, key or password, masked, in $LAKI_WIDGET_CONFIG too), its fixtures (fixtures/<name>.json)
export function widgetRuns(o: { id: string; data?: boolean; ws?: string }): WidgetRuns {
  const w = find(o.id)
  const x = scoped(w) && !o.ws ? undefined : wsOf(w, o.ws) // a scope workspace one's instance; none: all of theirs (laki widget dev)
  const k = keyOf(w.id, x?.id)
  const list = scoped(w) && !x ? [...runs].flatMap(([r, l]) => (r.startsWith(`${w.id}@`) ? l : [])).sort((a, b) => b.at - a.at).slice(0, RUNS) : (runs.get(k) ?? [])
  const data = o.data ? JSON.stringify(dataOf(w, x?.id).data ?? null, null, 2) : undefined // the inspector's Data: its JSON (256 KB of it at most)
  const c = configOf(w, true)
  const masked = new Set(optionsOf(w).filter(x => (x.type === 'secret' || SECRET.test(x.key)) && c[x.key]).map(x => x.key))
  const env = Object.fromEntries(
    Object.entries(envOf(w, { LAKI_REFRESH_REASON: runs.get(k)?.[0]?.reason ?? 'schedule', ...wsEnv(w, x) }))
      .filter(([k]) => /^(WIDGET_|LAKI_)/.test(k) || k === 'PATH' || k === 'PORT')
      .map(([k, v]) => [k, k === 'LAKI_WIDGET_CONFIG' ? JSON.stringify(Object.fromEntries(Object.entries(typedOf(w, true)).map(([n, x]) => [n, masked.has(n) ? '••••' : x]))) : [...masked].some(n => k === `WIDGET_${n.toUpperCase()}`) ? '••••' : v])
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  return { runs: list, env, fixtures: fixturesOf(w), devError: w.devError, mock: metaOf(w, x?.id).mock, ...(streaming(w) && { stream: streamOf(w.id) }), ...(data !== undefined && { data: data.length > 256 << 10 ? undefined : data, big: data.length > 256 << 10 || undefined }) }
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
  if (!ws) stopStream(w.id) // a stream: its last line kept now, not over this; streamSync starts it again once it's Live
  keep(w, ws, s => Object.assign(s, { data, at: Date.now(), error: undefined, mock }))
  wLog(w, `sample data: ${mock}${ws ? ` (${ws})` : ''}`)
  changed()
  return { ok: true, mock }
}

// laki widget dev: link a folder of your own code (a widget's, or a folder of them): kept in settings.widgetDev,
// scanned first and watched, its widgets turned on (you ran it on your own code) and fetched. off: unlink it (by its
// folder or a widget's id); list: the links
export function widgetDev(o: { folder?: string; off?: string; list?: boolean; from?: { ws?: string; tab?: string } }) {
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
  const agent = !!agentCaller(o.from) // an agent's link: its widgets off until you turn them on (one that shadows an installed one too: they share its store)
  for (const w of mine)
    if (onOf(w) === agent) {
      writeStore(w.id, { ...readStore(w.id), on: !agent })
      w.s = { ...w.s, on: !agent }
      if (agent) ungrant(w.id), stopAgents(w.id)
    }
  streamSync()
  changed()
  for (const w of mine) if (!w.devError) refetch(w, 'dev', 'linked')
  return { folder, widgets: mine.map(w => ({ id: w.id, name: w.m.name || w.id, on: onOf(w), devError: w.devError })), broken: bad.map(([d, m]) => `${d}: ${m}`), ...(agent && { note: 'linked, off: only the user turns them on (Settings › Extensions)' }) }
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
  const real = (d: string) => (statOf(d) ? realpathSync(d) : d)
  const repo = repoRoots().some(r => under(real(folder), real(r.root))) // in a repo's .laki/extensions: the repo's, off until you look
  if (!repo) writeStore(id, { on: true }) // yours, on
  scanWidgets()
  const at = kind === 'onefile' ? join(folder, Object.keys(files)[0]) : folder
  const w = [...widgets.values()].find(x => pathOf(x) === at || (repo && real(pathOf(x)) === real(at))) // in a folder of your own: once laki widget dev links it; a repo's: <project>.<id>
  wLog({ id: w?.id ?? id }, `made from the ${kind} starter in ${folder}`)
  if (w && !repo && scoped(w)) refetch(w, 'manual', 'made')
  else if (w && !repo && fetchable(w)) await widgetRun({ id: w.id, reason: 'manual', why: 'made' })
  return { id: w?.id ?? id, dir: at, files: Object.keys(files), found: !!w, ...(repo && { repo }) }
}

// laki widget check (the inspector's Check, MCP's laki_extension_check): what's wrong with an extension, by its id or a
// folder (a widget's, a one-file one, or a folder of them): widget.json (manifestCheck), widget.html's and ui's
// templates, ui (uiCheck) against its sample and each fixture, a one-file one's interval. run: its fetch once (manual,
// as Fetch now), the ui against what it printed; never one Laki AI wrote while it's off: the user looks at it first
export async function widgetCheck(o: { id?: string; dir?: string; run?: boolean; ws?: string; from?: { ws?: string; tab?: string } }): Promise<{ id?: string; problems: UiProblem[] }> {
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
    const ps = await checkOne(x, !!o.run, o.ws || undefined, !!agentCaller(o.from))
    problems.push(...(srcs.length > 1 ? ps.map(p => ({ ...p, where: `${idOf(x)}: ${p.where}` })) : ps))
  }
  return { id: srcs.length === 1 ? ([...widgets.values()].find(w => pathOf(w) === pathOf(srcs[0]))?.id ?? idOf(srcs[0])) : undefined, problems }
}
// what a scope workspace one should use of its workspace, somewhere in its fetch, its files or its ui
const WS_USE = /\$\{?(LAKI_(WORKSPACE|WORKSPACE_NAME|PROJECT|BRANCH|BASE|PATH|PR|STORAGE_FOLDER|WIDGET_WS)|PORT)\b|\bworkspace\b/
async function checkOne(x: Source, run: boolean, ws?: string, agent = false): Promise<UiProblem[]> {
  const out: UiProblem[] = []
  const say = (level: UiProblem['level'], where: string, text: string) => out.push({ level, where, text })
  const id = [...widgets.values()].find(w => pathOf(w) === pathOf(x))?.id ?? idOf(x) // a repo's is <project>.<id>
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
  // with no ui, only the names Laki's own hide (widget.html's templates read them too)
  const against = (data: unknown, what: string) => {
    const ps = (ui === undefined ? reservedIn(data) : uiCheck(ui, data, { actions })).filter(p => !seen.has(key(p)))
    out.push(...ps.map(p => ({ ...p, where: `${what} · ${p.where}` })))
    if (!ps.length) say('ok', what, ui === undefined ? 'reads' : 'fits the ui')
  }
  if (ui !== undefined) {
    out.push(...alone)
    if (!alone.length) say('ok', 'ui', 'its elements check out')
  }
  if (m.sample !== undefined) against(m.sample, 'sample')
  for (const n of x.file ? [] : fixtureNames(x.d)) {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(join(x.d, 'fixtures', n), 'utf8'))
    } catch (e) {
      say('error', `fixtures/${n}`, (e as Error).message)
      continue
    }
    against(data, `fixtures/${n}`)
  }
  // a one-file extension's id is its name's first part: renamed, its settings stay under the old one
  if (x.file && !existsSync(storePath(id))) {
    const lost = filesIn(join(dir, 'widget-data')).filter(n => n.endsWith('.json') && !n.endsWith('.chat.json') && !widgets.has(n.slice(0, -5))).map(n => n.slice(0, -5))
    if (lost.length) say('warn', head, `no settings kept for ${id}; ${lost.join(', ')} ${lost.length > 1 ? 'have' : 'has'} some, and no extension: renamed? The old name brings them back`)
  }
  if (Object.values(isObj(m.actions) ? m.actions : {}).some(a => toolOf(a))) {
    const agents = x.file ? undefined : join(x.d, 'AGENTS.md')
    if (!agents || !existsSync(agents)) say('warn', 'AGENTS.md', 'none: a few lines on when to use its tools (and when not) help agents pick them')
    else if (statSync(agents).size > 4096) say('warn', 'AGENTS.md', 'over 4 KB: agents get its first 4 KB')
  }
  if (m.scope === 'workspace') {
    const texts = [m.fetch, JSON.stringify(ui ?? ''), JSON.stringify(m.source ?? ''), html, ...(x.file ? [readFileSync(join(x.d, x.file), 'utf8')] : filesIn(x.d).filter(n => /\.(sh|bash|zsh|py|rb|m?js|ts)$/.test(n)).map(n => (statSync(join(x.d, n)).size < 64 << 10 ? readFileSync(join(x.d, n), 'utf8') : '')))]
    if (!texts.some(t => typeof t === 'string' && WS_USE.test(t))) say('warn', head, 'per workspace, but its fetch and ui use nothing of the workspace ($LAKI_BRANCH, $PORT, {{workspace.branch}}…): "scope": "global"?')
  }
  if (run && (m.fetch || m.script || sourceOk(m.source) || widgets.get(id)?.s.source)) {
    const w = widgets.get(id)
    if (!w || pathOf(w) !== pathOf(x)) say('warn', 'fetch', `not run: Laki doesn't have this one (laki widget dev ${pathOf(x)} links it)`)
    else if (!onOf(w) && w.s.by === 'ai') say('warn', 'fetch', "not run: Laki AI wrote it and it's off: turn it on first")
    else if (!onOf(w) && agent) say('warn', 'fetch', "not run: it's off, and an agent asked: the user turns it on first")
    else if (!onOf(w) && w.project) say('warn', 'fetch', `not run: it comes with ${projName(w)}'s repo and it's off: look at what it runs first (laki widget what ${w.id})`)
    else if (scoped(w) && !ws) say('warn', 'fetch', 'not run: per workspace, which one? (--ws <id>)')
    else if (streaming(w)) say('warn', 'fetch', 'not run: it streams (laki widget dev prints its lines as they come)')
    else if (sourceOf(w).kind === 'ai') say('warn', 'fetch', 'not run: an agent makes its data, and each run costs (Run now on its page runs it)')
    else {
      const r = await widgetRun({ id, reason: 'manual', why: 'check', ws }, true).catch(e => ({ ok: false, error: (e as Error).message }))
      const last = runs.get(keyOf(id, scoped(w) ? ws : undefined))?.[0]
      if (!r.ok) say('error', 'fetch', `${r.error}${last && !last.ok && last.exit ? ` (exit ${last.exit})` : ''}`)
      else {
        const kind = sourceOf(w).kind
        say('ok', 'fetch', kind === 'fetch' ? `printed ${last?.bytes ?? 0} B of JSON in ${last?.ms ?? 0} ms` : `read ${last?.bytes ?? 0} B from its ${kind === 'static' ? 'text' : kind === 'ai' ? 'agent' : kind} in ${last?.ms ?? 0} ms`)
        against(dataOf(w, scoped(w) ? ws : undefined).data, 'fetched')
      }
    }
  }
  return out
}
