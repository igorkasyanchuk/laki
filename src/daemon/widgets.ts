// Widgets: small pages in the sidebar (a 3-column grid), each a folder with widget.json (name, size, config, a
// fetch command and how often it runs) and widget.html (a template, shared/widget.ts). The daemon runs each
// widget's fetch on its schedule and keeps what it printed (JSON) in the widget's storage, <data>/widget-data/<id>.json,
// with the user's config. Only a list of them stays in memory: the page and the data are read when the app shows one.
// Its logs, events (gates, streams), tools, trust, files and dev parts are widgetLogs.ts, widgetEvents.ts,
// widgetTools.ts, widgetTrust.ts, widgetFiles.ts and widgetDev.ts, which it re-exports.
import { type ChildProcess } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { readJson, writeAtomic } from '../shared/conn.ts'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_SOURCE_EVERY, BUTTON_PLACES, type LogLevel, type Preset, WIDGET_SOURCES, type WidgetSource, type Workspace, type WidgetOption, type WidgetTool, type WidgetRun, type WidgetPlace, type WidgetSize, type WidgetView, type WidgetHide, type WidgetCtx, type ActionFile, WIDGET_PLACES } from '../shared/types.ts'
import { fill, hasFull, hasScript, openOk, pageOf, render, sayOf, templateError, viewOf, type WidgetSay } from '../shared/widget.ts'
import { type Tone, TONES, uiHtml, uiTree } from '../shared/widgetUi.ts'
import { actionCmd, actionMenu, aiActOf, type Fact, FACT_NAMES, gateOf, SAMPLE_FACTS, SIZES_ACROSS, toolOf } from '../shared/widgetSchema.ts'
import { describeHours, inHours, parseHours } from '../shared/when.ts'
import { iconTurns } from '../shared/icons.ts'
import { WIDGET_EVERY } from '../shared/widgetGuide.ts'
import { aiOnce } from './ai.ts'
import { dir } from './dir.ts'
import { agentCaller, broadcast, diff, git, headOf, imageSave, inside, within, changed, cliArgv, cliEnv, clients, devKeep, devLog, execGroup, killGroup, own, plainEnv, prOf, presets, procs, q, rt, state, stats, tabStatus, wsVars } from './core.ts'
import { errAt, flushLogs, LOG_RUN, logOn, masker, masks, xlog } from './widgetLogs.ts'
import { gatesOf, stopStream, streaming, streams, streamSync } from './widgetEvents.ts'
import { fixtureNames, fixturesOf } from './widgetDev.ts'
import { aiKey, allowedOf, allowOf, approve, cmdsOf, grantsOf, steering, TOOL_NAME, toolsOf, ungrant, widgetToolCall } from './widgetTools.ts'
import { dirHash, eachHash, filesHash, repoBad, repoFiles } from './widgetTrust.ts'
import { historyOf, snapshot, statOf } from './widgetFiles.ts'
export * from './widgetLogs.ts'
export * from './widgetEvents.ts'
export * from './widgetTools.ts'
export * from './widgetTrust.ts'
export * from './widgetFiles.ts'
export * from './widgetDev.ts'

// widget.json; config: its settings, each a default (text; a number, true/false or a list make that kind) or a Spec,
// given to fetch as $WIDGET_<NAME>; fetch: a shell command, or script: a JS file of the widget's that Laki's node runs
// (its default export, or what it prints); actions: commands its buttons run by name (data-run="name", data-arg:
// $WIDGET_ARG); view: the full view's size; place: where it shows at first (side, top, status, rail, foot: the user's
// choice wins). As a button (a rail or foot place, or no preview in widget.html): icon (an icon of the app's, or a
// character or two), label, badge and tip (templates over its data, as plain text), click (one of its actions).
// ui: the UI kit's elements (widgetUi.ts), one tree or { preview, full }: widget.html's own view wins, ui fills the other
type Spec = { type?: string; label?: string; hint?: string; default?: unknown; choices?: unknown[]; required?: boolean }
type ActionDef = string | { run?: string; tool?: unknown; ai?: string; tools?: string; profile?: string } // a command, or one an agent may call too (widgetSchema.ts' toolOf), or a prompt an agent answers (aiActOf)
export type Manifest = { name?: string; description?: string; size?: [number, number]; every?: number; view?: string; place?: string | string[]; scope?: string; on?: Record<string, string>; stream?: boolean; state?: unknown; fetch?: string; script?: string; config?: Record<string, unknown>; actions?: Record<string, ActionDef>; icon?: string; label?: string; badge?: string; tip?: string | false; click?: string; notify?: string; facts?: string[]; sample?: unknown; sampleConfig?: Record<string, unknown>; ui?: unknown; source?: unknown }
// sample: made-up data in the shape its fetch prints (sampleConfig: settings for it), for a preview before it runs (widgetRender sample)
// what's stored per widget: the user's choices over the manifest's (config: each setting as text), and the last fetch
// (at: when it ran; error: why it failed); net: its page may reach https sites (the user's switch, never widget.json's)
type Store = { fails?: number; log?: boolean; hours?: string; trusted?: string; files?: Record<string, string>; changed?: boolean; source?: WidgetSource; on?: boolean; size?: [number, number]; fit?: boolean; every?: number; view?: string; place?: WidgetPlace | WidgetPlace[]; net?: boolean; hide?: WidgetHide; config?: Record<string, string>; data?: unknown; at?: number; error?: string; by?: 'ai'; aiMay?: number; mock?: string; told?: string; allow?: string[]; allowFor?: string } // hours: its own working hours over Settings' (always: none) // allowFor: aiKey as allow was given // fit: in a bar, as wide as it needs (Auto) // trusted: a repo's extension's folder as it was when you turned it on (dirHash), files: each of its files' (eachHash); changed: off because it changed since; log: keep a log (its Settings card's Keep a log, the user's only); allow: claude tools its agent may use unasked (Always, when it asked: widgetPermission); told: what its notify last said (keep); by: Laki AI wrote it (widgetWrite); aiMay: when an ask in its page's chat let Laki AI rewrite the user's own, once (AI_MAY); mock: data put there by hand (widgetMock: a fixture's name, or edited), not fetched
// preview: widget.html has one; face: its button's words, filled from the last data (faceOf)
type Face = { label?: string; badge?: string; tip?: string; tone?: Tone; hidden?: boolean } // tone: its data's own `tone`, one of the kit's (a row mark's color); hidden: its data's own `hidden: true`, shown nowhere until it isn't
export type Entry = { id: string; dir: string; file?: string; project?: string; builtin: boolean; dev: boolean; devError?: string; agentDev?: boolean; m: Manifest; full: boolean; js: boolean; preview: boolean; face: Face; s: Omit<Store, 'data'>; inst: Map<string, InstMeta>; fixtures: string[] } // fixtures: fixtures/<name>.json at its scan, made-up data to preview it with // inst: a scope workspace one's instances (by workspace id), their last fetch // dev: in a folder laki widget dev linked; devError: why its files don't read now (the last good version runs on); agentDev: one an agent linked (settings.widgetDevAgent): trusted as a repo's
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

export const widgets = new Map<string, Entry>()
export const running = new Set<string>()
const again = new Set<string>() // asked to fetch while fetching (settings changed meanwhile): once more, after
// an agent's runs (an AI source's fetch, an AI action) by extension: stopped by Resources' Stop (agent:<id>), the
// inspector's, turning it off, a new source, deleting it, its folder gone, shutdown. A stopped fetch fails as stopped,
// its last data kept
type AgentRun = { c: AbortController; fetch: boolean } // fetch: its source's, else an action's
export const agents = new Map<string, Set<AgentRun>>()
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
export const widgetKey = randomBytes(16).toString('hex') // the master: never in a URL, the view or a page
// a key per thing a URL opens (artifact:<ws>, plan:<project>/<kind>/<slug>, widget:<id>), derived from the master: a
// leaked URL opens only what it was for
export const urlKey = (scope: string) => createHmac('sha256', widgetKey).update(scope).digest('hex').slice(0, 32)
export const urlKeyOk = (given: string | null | undefined, scope: string) => (a => a.length === 32 && timingSafeEqual(a, Buffer.from(urlKey(scope))))(Buffer.from(given ?? ''))
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
export const sourceOf = (w: Entry): WidgetSource => w.s.source ?? sourceOk(w.m.source) ?? { kind: 'fetch' }
export const ownFetch = (w: Entry) => !!(w.m.fetch || w.m.script)
const fetches = (w: Entry) => sourceOf(w).kind !== 'fetch' || ownFetch(w)
// Laki's own line about it: development mode's log, and its log file while it keeps one (a function: only then)
export function wLog(w: { id: string }, text: string | (() => string), level: LogLevel = 'info') {
  const e = widgets.get(w.id)
  const t = e && logOn(e) && typeof text === 'function' ? text() : text
  devLog(`widget:${w.id}`, t)
  if (e && typeof t === 'string') xlog(e, level, 'laki', t)
}
export const fetchable = (w: Entry, ws?: string) => onOf(w) && fetches(w) && !running.has(keyOf(w.id, ws)) && !metaOf(w, ws).mock // on, with a fetch, not fetching now, not showing data put there by hand
// and its every minutes since the last try, twice that after a failure, 4 times after two, 8 after three or more in a row
const due = (w: Entry, now: number, ws?: string) => !streaming(w) && sourceOf(w).kind !== 'static' && fetchable(w, ws) && (m => now - (m.at ?? 0) >= everyOf(w) * 60_000 * 2 ** Math.min(m.fails ?? 0, 3))(metaOf(w, ws))

export const storePath = (id: string) => join(dir, 'widget-data', `${id}.json`)
export const home = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
// where widgets are: Laki's own folder, the ones added in Settings, then the app's; the first of an id wins
export const widgetHome = () => join(dir, 'widgets')
// dev mode's folders (settings.widgetDev, laki widget dev): first, so a copy you work on shadows the installed one
export const devRoots = () => [...new Set((state.settings?.widgetDev ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))))]
// N10: the ones an agent linked (only widgetDev writes it): their code is the agent's, trusted as a repo's (guarded)
export const agentRoots = () => (state.settings?.widgetDevAgent ?? []).map(d => resolve(home(String(d))))
export const under = (d: string, root: string) => d === root || d.startsWith(root + '/')
export const widgetRoots = () => [...devRoots(), widgetHome(), ...(state.settings?.widgetDirs ?? []).map(d => String(d).trim()).filter(Boolean).map(d => resolve(home(d))), ...(BUILTIN ? [BUILTIN] : [])]
// each usable project's .laki/extensions (as workflows' .laki/workflows), read from its own folder. ponytail: a
// branch's change to them in a worktree isn't read until it reaches the project's folder
export const repoRoots = () => state.projects.filter(p => !p.kind && !p.host).map(p => ({ root: join(p.path, '.laki', 'extensions'), project: p.id }))
// a folder of yours (dev's, Settings') inside a project's .laki/extensions: still that repo's (its id, its trust)
const realOf = (d: string) => {
  try {
    return realpathSync(d)
  } catch {
    return d
  }
}
const repoOf = (root: string) => repoRoots().find(r => under(root, r.root) || under(realOf(root), realOf(r.root)))?.project

export const readStore = (id: string): Store => readJson<Store>(storePath(id)) ?? {}
export function writeStore(id: string, s: Store) {
  masks.delete(id) // its settings may have changed: masked anew
  writeAtomic(storePath(id), JSON.stringify(s))
}

// a secret setting's value (widget.json's "type": "secret"): <data>/widget-secrets.json, 0600, { [id]: { [key]: value } },
// as <data>/ai-key is kept: never in the store, state.json, the view or an export; only its fetch's and actions' env
// (and a script's config) get it. ponytail: a file, not the Keychain: security add-generic-password -w <value> would
// put it on a command line, where ps sees it
const secretsPath = () => join(dir, 'widget-secrets.json')
const readSecrets = () => readJson<Record<string, Record<string, string>>>(secretsPath()) ?? {}
export const secretsOf = (id: string) => readSecrets()[id] ?? {}
export function setSecrets(id: string, f: (s: Record<string, string>) => void) {
  masks.delete(id)
  const all = readSecrets()
  const s = { ...all[id] }
  f(s)
  if (Object.keys(s).length) all[id] = s
  else delete all[id]
  writeAtomic(secretsPath(), JSON.stringify(all), 0o600)
}

const instDir = (id: string) => join(dir, 'widget-data', id, 'ws')
const instPath = (id: string, ws: string) => join(instDir(id), `${ws}.json`)
const readInst = (id: string, ws: string): Inst => readJson<Inst>(instPath(id, ws)) ?? {}
function writeInst(id: string, ws: string, s: Inst) {
  writeAtomic(instPath(id, ws), JSON.stringify(s))
}
export const keyOf = (id: string, ws?: string) => (ws ? `${id}@${ws}` : id) // running, again and runs: an instance's own
export const scoped = (w: Entry) => w.m.scope === 'workspace'
// a workspace an instance may have: live, not Terminals' or Browsers'. ponytail: none on an SSH host yet
export const instOk = (x: Workspace) => !x.archived && !x.host && !state.projects.find(p => p.id === x.project)?.kind
// a repo's extension (.laki/extensions) is its project's only: shown, fetched, run and asked there
export const inProj = (w: Entry, x?: Workspace) => !w.project || x?.project === w.project
export const projName = (w: Entry) => state.projects.find(p => p.id === w.project)?.name ?? w.project
// on only after a look (seen), off again once its files change: a repo's, or one in a folder an agent linked
export const guarded = (w: Entry) => !!w.project || !!w.agentDev
export const whence = (w: Entry) => (w.project ? `comes with ${projName(w)}'s repo` : 'is in a folder an agent linked')
export const where = (w: Entry) => (w.project ? `in ${projName(w)}'s repo` : 'in the folder an agent linked')
export const repoSays = (w: Entry, what: string) => `${w.m.name || w.id} is in ${projName(w)}'s .laki/extensions: ${what} there`
// the workspace a call names: required for a scope workspace one, refused for a global one
export function wsOf(w: Entry, ws: unknown): Workspace | undefined {
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
export function wsInfo(x: Workspace) {
  const v = wsVars(x)
  return { id: x.id, name: v.workspace ?? x.id, project: v.project, branch: v.branch, base: v.base, path: x.path, port: x.port, pr: v.pr, storage: x.storage }
}
export type WsInfo = ReturnType<typeof wsInfo>
// an event's ws field (widgetEvent's head; a workflow's tried event in a workspace the user picked)
export const eventWs = (x: Workspace) => (i => ({ id: i.id, name: i.name, project: i.project, branch: i.branch, pr: i.pr }))(wsInfo(x))
const SAMPLE_WS = { id: 'sample', name: 'fix-login', project: 'web', branch: 'fix-login', base: 'main', path: '~/code/web', port: 5173, pr: 'https://github.com/acme/web/pull/412' } // a preview's made-up one
// a workspace's env (never makes a storage folder); gone: one archived or removed (its event's info, taken then): no
// port, storage nor instance file to give
const infoEnv = (i: WsInfo, gone = false): Record<string, string> => ({ LAKI_WORKSPACE: i.id, LAKI_WORKSPACE_NAME: i.name, LAKI_PROJECT: i.project ?? '', LAKI_BRANCH: i.branch ?? '', LAKI_BASE: i.base ?? '', LAKI_PATH: i.path, ...(!gone && { PORT: String(i.port ?? '') }), LAKI_PR: i.pr ?? '', ...(!gone && i.storage && { LAKI_STORAGE_FOLDER: i.storage }), LAKI_WIDGET_WS: JSON.stringify(i) })
export function wsEnv(w: Entry, x?: Workspace, gone?: WsInfo): Record<string, string> {
  if (gone) return { ...infoEnv(gone, true), LAKI_WIDGET_FILE: '' }
  return x ? { ...infoEnv(wsInfo(x)), LAKI_WIDGET_FILE: instPath(w.id, x.id), ...(factNames(w).length && { LAKI_FACTS: JSON.stringify(factsIn(w, x.id) ?? {}) }) } : {}
}

// ---------- a workspace's facts (widget.json's facts, widgetSchema.ts' FACTS): read for a per-workspace one's instance
// and kept (facts, by keyOf); factsTick (every 10 s while a window shows) reads them again for each instance on screen
// and, when one it reads changed, fetches it again (reason facts), or draws it again (its instance's fx) when it has no
// fetch. The git ones (changed_files, diff, commits) are read again only as the workspace's stat or HEAD moves
type Facts = { v: Record<string, unknown>; text: string; at: number; key: string; fx?: number }
const facts = new Map<string, Facts>()
const DIFF_MAX = 32 << 10
export const factNames = (w: Entry): Fact[] => (scoped(w) && Array.isArray(w.m.facts) ? FACT_NAMES.filter(f => w.m.facts!.includes(f)) : [])
export const factsIn = (w: Entry, ws: string) => facts.get(keyOf(w.id, ws))?.v
const sampleFacts = (w: Entry) => Object.fromEntries(factNames(w).map(f => [f, SAMPLE_FACTS[f]]))
const GIT_FACTS: Fact[] = ['changed_files', 'diff', 'commits']
// one read at a time per instance: a render, a run and the tick asking at once share it
const reading = new Map<string, Promise<{ now: Facts; was?: Facts }>>()
function readFacts(w: Entry, x: Workspace) {
  const k = keyOf(w.id, x.id)
  const r = reading.get(k) ?? readNow(w, x).finally(() => reading.delete(k))
  reading.set(k, r)
  return r
}
async function readNow(w: Entry, x: Workspace) {
  const names = factNames(w)
  const was = facts.get(keyOf(w.id, x.id))
  const key = JSON.stringify([stats.get(x.id) ?? null, headOf(x.path) ?? ''])
  const v: Record<string, unknown> = {}
  const p = prOf(x.id)
  if (names.includes('pr')) v.pr = p ? { number: p.number, url: p.url, title: p.title ?? '', description: (p.body ?? '').slice(0, 8000), author: p.author ?? '', state: p.state, draft: !!p.draft, checks: p.checks, review: p.review ?? '', approved: p.approved ?? [], changes: p.changes ?? [], conflict: !!p.conflict, base: p.base ?? '', additions: p.additions ?? 0, deletions: p.deletions ?? 0, labels: (p.labels ?? []).map(l => l.name) } : null
  if (names.includes('stat')) v.stat = stats.get(x.id) ?? null
  if (names.some(f => GIT_FACTS.includes(f))) {
    // ponytail: without the stat scan (Review tab and Diff size both off), the git ones are read at every tick; with it,
    // an edit that leaves the counts as they were isn't seen until the next one that changes them (or HEAD)
    if (was && was.key === key && stats.has(x.id) && GIT_FACTS.every(f => !names.includes(f) || f in was.v)) for (const f of GIT_FACTS) f in was.v && (v[f] = was.v[f])
    else {
      const d = names.includes('changed_files') || names.includes('diff') ? await diff(x.id).catch(() => null) : null
      if (names.includes('changed_files')) v.changed_files = (d?.files ?? []).slice(0, 500)
      if (names.includes('diff')) v.diff = d ? (d.diff.length > DIFF_MAX ? `${d.diff.slice(0, DIFF_MAX)}\n… (cut)` : d.diff) : ''
      if (names.includes('commits'))
        v.commits = x.kind === 'worktree' && x.base
          ? await git(x, 'log', '-n', '50', '--format=%h%x09%an%x09%cI%x09%s', `${x.base}..HEAD`).then(
              out => out.split('\n').filter(Boolean).map(l => (([hash, author, at, ...s]) => ({ hash, subject: s.join('\t'), author, at }))(l.split('\t'))),
              () => [],
            )
          : []
    }
  }
  if (names.includes('agents')) v.agents = state.tabs.filter(t => t.workspace === x.id && t.kind === 'agent').map(t => ({ tab: t.id, name: t.name ?? '', agent: t.preset ?? '', status: tabStatus(t.id), last: (rt.get(t.id)?.last ?? '').slice(0, 2000) }))
  if (names.includes('ports')) v.ports = Object.entries(procs.get(x.id) ?? {}).filter(([, p]) => !p.own).map(([port, p]) => ({ port: Number(port), command: p.cmd }))
  const now: Facts = { v, text: JSON.stringify(v), at: Date.now(), key, fx: was?.fx }
  facts.set(keyOf(w.id, x.id), now)
  return { now, was }
}
// a read, 10 s at most: a stuck git gives none (the last ones stay)
const capped = (w: Entry, x: Workspace) => Promise.race([readFacts(w, x).catch(() => undefined), new Promise<undefined>(ok => void setTimeout(() => ok(undefined), 10_000).unref())])
// fresh enough for a run (its $LAKI_FACTS): read again when older than a tick
export const factsFor = async (w: Entry, x?: Workspace) => void (x && factNames(w).length && Date.now() - (facts.get(keyOf(w.id, x.id))?.at ?? 0) > 9000 && (await capped(w, x)))
let factsGoing = false
export async function factsTick() {
  if (!shown() || factsGoing) return
  factsGoing = true
  for (const k of facts.keys()) if (!widgets.has(k.slice(0, k.lastIndexOf('@')))) facts.delete(k) // a removed extension's
  try {
    for (const w of [...widgets.values()]) {
      if (!factNames(w).length || !onOf(w)) continue
      for (const ws of shownIn(w)) {
        const x = state.workspaces.find(v => v.id === ws)
        if (!x || !widgets.has(w.id)) continue
        const got = await capped(w, x) // none: stuck, the next tick tries again
        if (!got?.was || got.was.text === got.now.text) continue
        const { now, was } = got
        const cur = widgets.get(w.id) // a scan meanwhile makes a new entry
        if (!cur) continue
        const why = factNames(cur).filter(f => JSON.stringify(was.v[f]) !== JSON.stringify(now.v[f]))
        now.fx = now.at
        cur.inst.set(ws, { ...cur.inst.get(ws), face: faceOf(cur, dataOf(cur, ws).data, ws) })
        changed()
        if (fetches(cur) && sourceOf(cur).kind !== 'static' && !outside(cur, now.at)) soon({ id: w.id, reason: 'facts', why: `changed: ${why.join(', ')}`, ws })
      }
    }
  } finally {
    factsGoing = false
  }
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
  // storage: one of its Artifacts (the storage folder), by the same check
  if (c.storage === true && ws && !ws.storage) throw new Error(`${ws.id} has no storage folder`)
  const file = typeof c.file === 'string' && c.file && ws ? { path: c.file, abs: inside(c.storage === true ? { ...ws, path: ws.storage! } : ws, c.file), ...(c.storage === true && { storage: true }) } : undefined
  const i = ws && wsInfo(ws)
  const info = { ...(i && { ws: i }), ...(tab && { tab: { id: tab.id, name: tab.name, agent: tab.preset } }), ...(file && { file }) }
  return { info, env: { ...(i && !x && infoEnv(i)), ...(tab && { LAKI_TAB: tab.id, LAKI_TAB_NAME: tab.name ?? '' }), ...(file && { LAKI_FILE: file.abs }), LAKI_CTX: JSON.stringify(info) } }
}
// an instance's (or a global one's) data, and its last fetch kept; the in-memory copy follows (a rescan's entry too)
export const dataOf = (w: Entry, ws?: string): Inst => (ws ? readInst(w.id, ws) : (st => (st?.data !== undefined ? { ...readStore(w.id), data: st.data, at: w.s.at, error: undefined } : readStore(w.id)))(streams.get(w.id))) // a stream's last line, kept every 5 s
export const metaOf = (w: Entry, ws?: string): Omit<Inst, 'data'> => (ws ? (w.inst.get(ws) ?? {}) : w.s)
export function keep(w: Entry, ws: string | undefined, f: (s: Inst) => void) {
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
  for (const k of [...facts.keys()]) if (k.endsWith(`@${ws}`)) facts.delete(k)
  if (state.widgetGrants?.[ws]) delete state.widgetGrants[ws] // its tools' Always (dropWs saves)
}

// widget.html, or none ('')
export function htmlOf(d: string) {
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
export type Source = { d: string; file?: string }
export const idOf = (x: Source) => (x.file ? x.file.split('.')[0] : x.d.split('/').pop()!.replace(/[^\w.-]/g, '-'))
export const pathOf = (x: { dir?: string; d?: string; file?: string }) => (x.file ? join((x.dir ?? x.d)!, x.file) : (x.dir ?? x.d)!)
// a root is a widget's folder, a one-file extension, or a folder of either
export function foldersIn(root: string): Source[] {
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
export function oneFile(d: string, file: string): (Manifest & { seconds?: number }) | string {
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
export function manifestOf(d: string): Manifest | string {
  let m: unknown
  try {
    m = JSON.parse(readFileSync(join(d, 'widget.json'), 'utf8'))
  } catch (e) {
    return `widget.json: ${(e as Error).message}`
  }
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Manifest) : 'widget.json: an object'
}
// a template of widget.html's or ui's that doesn't read (dev mode's check before a reload)
export function templatesError(m: Manifest, html: string): string | undefined {
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
  const roots: { root: string; project?: string }[] = [...widgetRoots().filter(r => r !== BUILTIN).map(root => ({ root, project: repoOf(root) })), ...repoRoots(), ...(BUILTIN ? [{ root: BUILTIN }] : [])]
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
      const own = dev.filter(r => under(pathOf({ d, file }), r)).sort((a, b) => b.length - a.length)[0] // the nearest linked folder decides: yours inside an agent's stays yours
      const agentDev = !!own && !project && agentRoots().includes(own)
      const e: Entry = { id, dir: d, file, ...(project && { project }), ...(agentDev && { agentDev }), builtin: !project && !!BUILTIN && under(d, BUILTIN), dev: isDev, devError: bad, m, full: hasFull(html) || !!uiTree(m.ui, true), js: hasScript(html), preview: !!viewOf(html, false)?.trim() || !!uiTree(m.ui, false), face: {}, s, inst: new Map(), fixtures: file ? [] : fixtureNames(d).map(n => n.slice(0, -5)) }
      e.face = faceOf(e, data)
      if (scoped(e)) e.inst = instsOf(id, e)
      widgets.set(id, e)
      allowOf(e) // #6: its prompts changed: its allowed tools go
      const rf = guarded(e) && e.s.on && !e.file ? repoFiles(e) : undefined
      if (guarded(e) && e.s.on && (e.s.trusted !== dirHash(e, true, rf?.names) || rf?.bad)) untrust(e, rf?.names) // changed since you turned it on; an agent's that shadows one on: never its on
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

// a repo's extension that changed since you said yes: off, changed, its streams, agents and grants gone; said once,
// with the files that changed (by the hashes kept as it was turned on), so you know what to gitignore
function untrust(e: Entry, names?: string[]) {
  const st = readStore(e.id)
  const was = st.files
  const now = was && eachHash(e, names)
  const diff = was && now ? [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(n => was[n] !== now[n]).sort() : []
  const which = diff.length ? ` (${diff.slice(0, 5).join(', ')}${diff.length > 5 ? ` and ${diff.length - 5} more` : ''})` : ''
  Object.assign(st, { on: false, changed: true })
  writeStore(e.id, st)
  Object.assign(e.s, { on: false, changed: true })
  stopStream(e.id)
  stopAgents(e.id)
  ungrant(e.id)
  wLog(e, `its files changed ${e.project ? `in ${projName(e)}'s .laki/extensions` : 'in the folder an agent linked'}${which}: off until you look`, 'warn')
  broadcast({ ev: 'widget-say', widget: e.id, notify: `${e.project ? `from ${projName(e)} changed` : 'changed in the folder an agent linked'}${which}: off until you look` }) // App: a toast and a notification, its name first
}
// each project's .laki watched (recursive; while it's missing, the project's folder, flat), a second after a change
// under extensions/ read again (scanWidgets: a changed one goes off, a branch without it drops them, one back reads
// them). Not .laki/extensions itself: macOS's watch of a folder git removes says nothing, nor when it comes back
const repoWatchers = new Map<string, { w: FSWatcher; at: string }>()
const repoSpot = (r: string) => [dirname(r), dirname(dirname(r))].find(d => existsSync(d))
function watchRepos() {
  const roots = repoRoots().map(r => r.root)
  for (const [r, x] of repoWatchers) if (!roots.includes(r) || x.at !== repoSpot(r)) (x.w.close(), repoWatchers.delete(r)) // gone, or .laki came or went: watched again where it is now
  for (const r of roots) {
    const at = repoSpot(r)
    if (repoWatchers.has(r) || !at) continue
    const flat = at !== dirname(r)
    let timer: NodeJS.Timeout | undefined
    try {
      const w = watch(at, { recursive: !flat }, (_, f) => {
        const n = String(f ?? '')
        if (n && n !== '.laki' && (flat || n.split(/[\\/]/)[0] !== 'extensions')) return // its workflows, the project's other files
        clearTimeout(timer)
        timer = setTimeout(() => repoWatchers.get(r)?.w === w && scanWidgets(), 1000)
      })
      w.on('error', () => (w.close(), repoWatchers.get(r)?.w === w && repoWatchers.delete(r)))
      repoWatchers.set(r, { w, at })
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
  for (const w of [...watchers.values(), ...[...repoWatchers.values()].map(x => x.w)]) w.close()
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
export function faceOf(w: Entry, data: unknown, ws?: string, meta?: Omit<Inst, 'data'>): Face
export function faceOf(w: Entry, data: unknown, ws: string | undefined, meta: Omit<Inst, 'data'>, one: string): string | undefined
export function faceOf(w: Entry, data: unknown, ws?: string, meta: Omit<Inst, 'data'> = ws ? (w.inst.get(ws) ?? {}) : w.s, one?: string): Face | string | undefined {
  const x = ws ? state.workspaces.find(v => v.id === ws) : undefined
  data ??= typedData(w)
  const ctx = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), data, config: typedOf(w), at: meta.at, error: meta.error, workspace: x && wsInfo(x), ...(x && factNames(w).length && { facts: factsIn(w, x.id) ?? {} }) } // {{open}} as {{data.open}}
  const fill = (t: unknown, n: number) => {
    if (typeof t !== 'string' || !t.trim()) return undefined
    try {
      return plain(render(t, ctx)).slice(0, n) || undefined
    } catch {
      return undefined
    }
  }
  if (one !== undefined) return fill(one, 300) // a notify's text
  const { tone, hidden } = ctx as { tone?: unknown; hidden?: unknown }
  return { label: fill(w.m.label, 40), badge: fill(w.m.badge, 6), tip: fill(w.m.tip, 300), ...((TONES as readonly unknown[]).includes(tone) && { tone: tone as Tone }), ...(hidden === true && { hidden }) }
}
// an icon: a name of the app's (the renderer knows which), or a character or two (an emoji, 👨‍👩‍👧 one too)
const graphemes = new Intl.Segmenter()
const iconOf = (w: Entry) => {
  const s = typeof w.m.icon === 'string' ? w.m.icon.trim() : ''
  return /^[a-zA-Z][\w-]{0,30}$/.test(s) || (!!s && !/\s/.test(s) && [...graphemes.segment(s)].length <= 2) ? s : undefined
}
const clickOf = (w: Entry) => (typeof w.m.click === 'string' && w.m.actions && Object.hasOwn(w.m.actions, w.m.click) ? w.m.click : undefined)

export const clamp = (n: unknown, lo: number, hi: number, def: number) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : def)
const down = (n: unknown) => (Number(n) === 0.5 ? 0.5 : clamp(n, 1, 4, 1)) // cells down: half a cell too (a line of links)
const ACROSS = SIZES_ACROSS.length // the sidebar's grid, cells across
const sizeOf = (w: Entry): [number, number] => {
  const [a, b] = w.s.size ?? w.m.size ?? [1, 1]
  return [clamp(a, 1, ACROSS, 1), down(b)]
}
const everyOf = (w: Entry) => (sourceOf(w).kind === 'ai' ? clamp(w.s.every ?? w.m.every, 15, 1440, AI_SOURCE_EVERY) : clamp(w.s.every ?? w.m.every, 1, 1440, WIDGET_EVERY)) // an agent's run costs: every 15 minutes at most
export const onOf = (w: Entry) => !!w.s.on // every extension starts off: Settings › Extensions turns it on
// an off one runs nothing, its fetch nor its actions (its page's clicks and scripts, a preview's too): one Laki AI wrote
// is off until you've looked at it
export const OFF = (w: Entry) => `${w.m.name || w.id} is off: turn it on first`
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
export function optionsOf(w: Entry): (WidgetOption & { def: string })[] {
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
export function configOf(w: Entry, secrets = false) {
  const kept = secrets ? secretsOf(w.id) : {}
  return Object.fromEntries(optionsOf(w).map(o => [o.key, o.type === 'secret' ? (secrets ? (kept[o.key] ?? o.def) : '') : w.s.config && Object.hasOwn(w.s.config, o.key) ? textOf(o, w.s.config[o.key]) : o.def]))
}
// the same as values a page or a script reads: a bool true or false, a number (null: empty), a list an array of strings
export function typedOf(w: Entry, secrets = false) {
  const c = configOf(w, secrets)
  return Object.fromEntries(optionsOf(w).map(o => [o.key, ((v: string) => (o.type === 'bool' ? v === '1' : o.type === 'number' ? (v === '' ? null : Number(v)) : o.type === 'list' ? (v ? v.split(',') : []) : v))(c[o.key])]))
}

// the secrets file read once, each one's settings once (k: its secrets, c: its settings as text)
export const widgetsView = (): WidgetView[] =>
  (sec => [...widgets.values()].map(w => [w, sec[w.id] ?? {}, configOf(w)] as const))(readSecrets()).map(([w, k, c]) => ({
    id: w.id,
    key: urlKey(`widget:${w.id}`), // its page's (GET /widget/<id>)
    name: w.m.name || w.id,
    description: w.m.description,
    dir: w.dir,
    builtin: w.builtin || undefined,
    oneFile: !!w.file || undefined,
    allowed: w.s.allow,
    on: onOf(w),
    size: sizeOf(w),
    fit: w.s.fit || undefined,
    every: fetches(w) && sourceOf(w).kind !== 'static' ? everyOf(w) : undefined,
    source: sourceOf(w),
    ownFetch: ownFetch(w) || undefined,
    full: w.full,
    view: viewSize(w),
    place: placeOf(w),
    places: placesOf(w),
    net: (w.js && w.s.net) || undefined,
    hide: w.m.tip === false ? { ...w.s.hide, tip: true } : w.s.hide, // widget.json's "tip": false hides it too
    tipOff: w.m.tip === false || undefined,
    hours: w.s.hours,
    stream: w.m.stream === true || undefined,
    facts: (f => (f.length ? f : undefined))(factNames(w)),
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
    ...((tools => tools.length && { tools })([
      ...toolsOf(w).map(([action, t]): WidgetTool => ({ action, description: t.description, ask: t.ask, grants: grantsOf(w, action) })),
      // an Always given to an action handler of an agent's event: there to Revoke too
      ...[...new Set(Object.values(w.m.on ?? {}))].filter(a => a !== 'refresh' && !toolOf(w.m.actions?.[a])).flatMap((action): WidgetTool[] => (grants => (grants.length ? [{ action, description: "On an agent's event", ask: 'first', grants }] : []))(grantsOf(w, action))),
    ])),
    byAi: w.s.by === 'ai' || undefined,
    log: logOn(w) || undefined,
    keepLog: w.s.log || undefined,
    logErr: errAt.get(w.id),
    gates: (g => (g.length ? g : undefined))([...new Set(gatesOf(w).flatMap(([, x]) => gateOf(x)))]),
    project: w.project,
    repo: w.project && projName(w),
    agentDev: w.agentDev,
    changed: (guarded(w) && w.s.changed) || undefined,
    ...(w.dir === join(widgetHome(), w.id) && (h => h.length && { history: h })(historyOf(w.id))),
    dev: w.dev || undefined,
    devError: w.devError,
    mock: w.s.mock,
    sample: w.m.sample !== undefined || (!fetches(w) && w.m.sampleConfig !== undefined) || undefined, // a preview with made-up data
    fixtures: w.fixtures.length ? w.fixtures : undefined, // more of it: widgetRender's sample by name
    rev: rev + iconTurns(), // and each change of the icons' pack, width or size: drawn again
    ...((placesOf(w).every(p => BUTTON_PLACES.includes(p)) || !w.preview) && { button: true }), // a tile elsewhere: its preview
    icon: iconOf(w),
    ...w.face,
    click: clickOf(w),
    clickAsk: (a => (typeof a?.confirm === 'string' && a.confirm.trim()) || undefined)(w.m.actions?.[clickOf(w) ?? ''] as { confirm?: unknown } | undefined), // its click action's confirm: asked first
  }))

// a scope workspace one's instances in the view: each live workspace's that has fetched (or fetches now), its last fetch
// and its button's words
function instView(w: Entry) {
  const out: Record<string, { at?: number; error?: string; running?: boolean; mock?: string; fx?: number } & Face> = {}
  for (const x of state.workspaces) {
    const m = w.inst.get(x.id)
    const run = running.has(keyOf(w.id, x.id))
    const fx = facts.get(keyOf(w.id, x.id))?.fx // its facts changed then: drawn again
    if (!instOk(x) || !inProj(w, x) || (!m?.at && !run && !fx)) continue
    out[x.id] = { at: m?.at, error: m?.error, running: run || undefined, mock: m?.mock, fx, ...m?.face }
  }
  return out
}

export function find(id: string) {
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
  // its facts: a sample's made-up ones; an instance's as last read (none yet: read now, then drawn again by its fx)
  const known = x && factNames(w).length ? factsIn(w, x.id) : undefined
  if (x && factNames(w).length && !known && !o.sample) void readFacts(w, x).then(({ now }) => ((now.fx = now.at), changed()), () => {})
  const fx = factNames(w).length ? { facts: o.sample || !x ? sampleFacts(w) : (known ?? {}) } : {}
  const ctx = o.sample
    ? { data: made ?? typedData(w), config: { ...typedOf(w), ...sc }, at: Date.now() - 120_000, error: undefined, full: !!o.full, sample: true, workspace, ...fx }
    : { data: s.data ?? typedData(w), config: typedOf(w), at: s.at, error: s.error, full: !!o.full, workspace, ...fx }
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
  const bad = (code: number, body: string) => ({ code, headers: { 'content-type': 'text/plain' }, body })
  if (!urlKeyOk(query.get('key'), `widget:${id}`)) return bad(401, 'bad key')
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
export const AI_MAY = 3600000 // ms: how long an ask in its page's chat lets Laki AI rewrite one of the user's
// agent: an agent's change (MCP's laki_extension_set, Laki AI's too; laki widget set in an agent's tab): where it shows,
// its size, every, view, hide and plain settings; never on, network access, its source or a secret: those are the user's
export function widgetSet(o: { id: string; seen?: string; log?: boolean; source?: WidgetSource | null; on?: boolean; size?: [number, number]; fit?: boolean; every?: number; view?: WidgetSize; place?: WidgetPlace | WidgetPlace[]; net?: boolean; hide?: WidgetHide; config?: Record<string, string>; ai?: boolean; name?: string; allow?: string[]; hours?: string; from?: { ws?: string; tab?: string }; agent?: boolean }) {
  const w = find(o.id)
  if (o.agent === true || agentCaller(o.from)) {
    if (o.on === true) throw new Error('only you can turn an extension on (Settings › Extensions)') // its code would run unlooked at
    if (o.net === true || o.source !== undefined || o.ai || o.allow !== undefined || o.log !== undefined) throw new Error(`only you can change ${o.net === true ? 'its network access' : o.ai ? 'who edits it' : o.allow !== undefined ? 'the tools its agent may use' : o.log !== undefined ? 'whether it keeps a log' : 'its source'} (Settings › Extensions)`)
    const secret = Object.keys(o.config ?? {}).find(k => optionsOf(w).some(x => x.key === k && x.type === 'secret'))
    if (secret) throw new Error(`${secret} is a secret: only you set it (Settings › Extensions)`)
    const steers = Object.keys(o.config ?? {}).find(k => steering(w).has(k))
    if (steers) throw new Error(`${steers} fills in its source or an AI action's prompt: only you change it (Settings › Extensions)`)
  }
  // seen: the files hash of what the user was shown (an extension page's Turn on): on only while it's still that
  if (o.on === true && o.seen !== undefined && o.seen !== filesHash(w, true)) throw new Error(`${w.m.name || w.id} changed since you looked: look again`)
  // a repo's (an agent-linked one's): on only after a look (laki widget what's hash), and trusted as its files are now
  if (o.on === true && guarded(w) && !w.s.on && o.seen === undefined) throw new Error(`${w.m.name || w.id} ${whence(w)}: look at what it runs first (laki widget what ${w.id})`)
  const badPlace = o.place === undefined ? undefined : (Array.isArray(o.place) ? o.place : [o.place]).find(x => !isPlace(x)) // a typo would put back widget.json's
  if (badPlace !== undefined) throw new Error(`no place ${badPlace}: ${WIDGET_PLACES.join(', ')}`)
  if (o.place !== undefined && placeList(o.place).includes('row') && !scoped(w)) throw new Error(`${w.m.name || w.id} is one for the app: a row's mark is per workspace`)
  const hours = o.hours === undefined ? undefined : hoursText(o.hours) // '': Settings' again; checked before anything changes
  const bad = o.on === true && repoBad(w)
  if (bad) throw new Error(`${w.m.name || w.id} can't be trusted: ${bad}`)
  const s = readStore(w.id)
  if (o.on === true && guarded(w) && o.seen !== undefined) Object.assign(s, { trusted: dirHash(w, true), files: eachHash(w), changed: undefined })
  if (o.ai) {
    // an ask in its page's chat (Extension.tsx): one of the user's in Laki's folder, which widgetWrite may then rewrite
    if (w.builtin || w.dir !== join(widgetHome(), w.id)) throw new Error(`${w.m.name ?? w.id} isn't in Laki's folder: Laki AI can't change it`)
    s.aiMay = Date.now()
  }
  if (o.on === true && !s.on) s.mock = undefined // turned on: live, not the sample data put there while it was off (the studio's)
  if (o.on !== undefined) s.on = !!o.on
  if (o.on === false) ungrant(w.id), stopAgents(w.id) // off: its tools' Always go, its agents stop
  if (o.source !== undefined) stopAgents(w.id, true) // an answer for the source it had would land over the new one's (its actions run on)
  if (o.size) s.size = [clamp(o.size[0], 1, ACROSS, 1), down(o.size[1])]
  if (o.fit !== undefined) s.fit = o.fit === true || undefined
  if (o.every !== undefined) s.every = clamp(o.every, 1, 1440, WIDGET_EVERY)
  if (o.hours !== undefined) s.hours = hours
  if (o.view !== undefined) s.view = isSize(o.view) ? o.view : undefined
  if (o.place !== undefined) s.place = (l => (l.length > 1 ? l : l[0]))(placeList(o.place)) // none: widget.json's again
  if (o.net !== undefined) s.net = !!o.net || undefined
  if (o.log !== undefined) s.log = !!o.log || undefined // off: its file stays until Clear
  const yes = (v: unknown, was?: boolean) => (v === undefined ? was : v === true) || undefined // only true hides
  if (o.hide) s.hide = (h => (h.refresh || h.at || h.tip ? h : undefined))({ refresh: yes(o.hide.refresh, s.hide?.refresh), at: yes(o.hide.at, s.hide?.at), tip: yes(o.hide.tip, s.hide?.tip) })
  if (o.source !== undefined) {
    // null: widget.json's again; a fetch of its own only when it has one
    const src = o.source === null ? undefined : sourceOk(o.source)
    if (o.source !== null && !src) throw new Error(`a source: { kind: ${WIDGET_SOURCES.join(' | ')}, text (64 KB at most) | path | url }`)
    if (src?.kind === 'fetch' && !ownFetch(w)) throw new Error(`${w.m.name || w.id} has no fetch of its own: pick static, file or url`)
    if (src?.kind === 'url' && src.url && !/^https?:\/\//i.test(src.url) && !src.url.includes('{{')) throw new Error('a URL: http or https')
    s.source = src
    if (src) s.mock = undefined // its own data from now on, not sample data
    if (s.allow && s.allowFor !== aiKey(w.m, src ?? sourceOk(w.m.source) ?? { kind: 'fetch' })) (s.allow = undefined), (s.allowFor = undefined), wLog(w, 'its prompt changed: the tools its agent was allowed go (asked again)', 'warn') // #6
  }
  if (o.allow !== undefined) {
    if (!Array.isArray(o.allow) || o.allow.some(t => typeof t !== 'string' || !TOOL_NAME.test(t))) throw new Error('allow: tool names')
    s.allow = o.allow.length ? [...new Set(o.allow)] : undefined
    s.allowFor = s.allow && aiKey(w.m, s.source ?? sourceOk(w.m.source) ?? { kind: 'fetch' })
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

// what a failed command said last, past node's own trailer (an uncaught error ends with its version)
export const lastLine = (t: string) =>
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
export function envOf(w: Entry, extra: Record<string, string>) {
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
export type Failed = Error & { stderr?: string; stdout?: string; exit?: number; changed?: boolean } // changed: a guarded one's files moved (trusted)
// a widget's command, in its folder, as a process group (a timeout ends what it started too): stdout and stderr, or why
// it failed (with its stderr and exit code). stdin: an event's JSON (a handler's); else nothing to read
const timeout = () => Number(process.env.LAKI_WIDGET_TIMEOUT_MS) || 120_000 // tests' shorter
const execs = new Set<ChildProcess>() // running now: widgetsStop ends them
// a repo's extension runs only as you said yes to it: its files changed since (a pull, before the watch's scan) turn it
// off here, before anything of the new runs (dirHash: cached by the files' times and sizes)
export function trusted(w: Entry) {
  const rf = guarded(w) && !w.file ? repoFiles(w) : undefined // one listing for both
  if (!guarded(w) || (w.s.trusted === dirHash(w, false, rf?.names) && !rf?.bad)) return
  if (w.s.on) untrust(w, rf?.names)
  throw new Error(`${w.m.name || w.id} changed ${where(w)}: off until you look`)
}
export function exec(w: Entry, cmd: string, args: string[], extra: Record<string, string>, stdin = '', ms?: number) {
  try {
    trusted(w)
  } catch (e) {
    return Promise.reject(Object.assign(e as Error, { stderr: '', changed: true }))
  }
  return new Promise<Ran>((ok, no) => {
    const t = ms ?? timeout()
    const p = execGroup(cmd, args, { cwd: w.dir, env: envOf(w, extra), timeout: t, maxBuffer: MAX_OUT, stdin }, (e, stdout, stderr) => {
      execs.delete(p)
      // its secrets masked in what it said, before anything keeps or shows it (the view's error, Runs, dev's lines,
      // devLog); its data (a fetch's stdout) is its own, as it printed it
      const mask = masker(w)
      if (!e) return ok({ out: stdout, err: mask(stderr) })
      const late = e.message === 'maxBuffer exceeded' ? `printed more than ${MAX_OUT >> 20} MB` : e.killed ? `timed out after ${t >= 60_000 ? `${t / 60_000} minutes` : `${t / 1000} s`}` : undefined
      no(Object.assign(new Error(mask(late ?? (lastLine(stderr) || lastLine(stdout) || e.message))), { stderr: mask(stderr), stdout: mask(stdout), exit: typeof e.code === 'number' ? e.code : undefined }))
    })
    execs.add(p)
    own(p, `Extension · ${w.m.name || w.id}`)
  })
}

export const RUNS = 20
export const runs = new Map<string, Run[]>()
export const tail = (t?: string) => (t?.trim() ? t.trimEnd().split('\n').slice(-20).join('\n').slice(-4096) : undefined) // stderr's last 20 lines, 4 KB
export function ran(id: string, r: Run, stderr?: string) {
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

// a script's default export gets { config, last, workspace } (a scope workspace one's) and returns the data (an async
// generator: each yield a line, a stream's); one without prints it. What it throws is the
// error, its message alone (node would print the stack, then its version)
export const RUN_JS = `import { readFileSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
try {
  const m = await import(pathToFileURL(process.argv[1]).href)
  if (typeof m.default === 'function') {
    let last
    try { last = JSON.parse(readFileSync(process.env.LAKI_WIDGET_FILE, 'utf8')).data } catch {}
    const r = m.default({ config: JSON.parse(process.env.LAKI_WIDGET_CONFIG || '{}'), last, workspace: process.env.LAKI_WIDGET_WS ? JSON.parse(process.env.LAKI_WIDGET_WS) : undefined, facts: process.env.LAKI_FACTS ? JSON.parse(process.env.LAKI_FACTS) : undefined })
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
export const RUN_REASONS = ['schedule', 'open', 'settings', 'manual', 'reload', 'dev', 'select', 'push', 'stream', 'workflow', 'facts'] // and action:<name>, event:<name>
// an event handler's ($LAKI_EVENT, $LAKI_EVENT_FILE, the JSON on stdin) or a tool call's ($WIDGET_INPUT_<NAME>; why: who
// called it and how it was allowed, for its run; full: all its stdout back)
type Ev = { env: Record<string, string>; stdin: string; why?: string; full?: boolean; gone?: WsInfo } // gone: an archived or removed workspace's event, its info then
const AT_ONCE = 4 // a scope workspace one's instances fetching at a time
const INSERT_MAX = 16 << 10 // what an action puts in the prompt
// force: laki widget check's run, an explicit ask, so an off one of the user's runs too (never one Laki AI wrote).
// ws: a scope workspace one's instance (its workspace's env, its own data)
// once: an extension page's Try it live, the user's click on what will run: one fetch while it's off (an AI-written one too)
export async function widgetRun(o: { id: string; reason?: string; why?: string; ws?: string; once?: boolean; from?: { ws?: string; tab?: string } }, force = false, ev?: Ev): Promise<{ ok: boolean; error?: string }> {
  const w = find(o.id)
  const x = wsOf(w, o.ws)
  const k = keyOf(w.id, x?.id)
  const meta = metaOf(w, x?.id)
  const reason = typeof o.reason === 'string' && (RUN_REASONS.includes(o.reason) || /^(action|event):[\w.-]{1,40}$/.test(o.reason)) ? o.reason : 'manual'
  const once = o.once === true && !onOf(w)
  if (!onOf(w) && (guarded(w) || (!once && !(force && w.s.by !== 'ai')))) return { ok: false, error: guarded(w) ? `${OFF(w)}: it ${whence(w)}, look at what it runs (laki widget what ${w.id})` : OFF(w) } // a repo's: never once, unlooked
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
  await factsFor(w, x) // its $LAKI_FACTS, a script's facts and a prompt's {{facts.…}} as they are now
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
  const at = (t: string) => fill(t, [{ config: typedOf(w), workspace: x ? wsInfo(x) : undefined, facts: x && factNames(w).length ? factsIn(w, x.id) : undefined }]).trim()
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
  const prompt = fill(a.prompt, [{ ...(isObj(data) ? data : {}), data, arg, config: typedOf(w), workspace: x ? wsInfo(x) : ctx?.ws, facts: x && factNames(w).length ? factsIn(w, x.id) : undefined, tab: ctx?.tab, file: ctx?.file }]).trim() // its data's fields, never over arg or config; where it was picked
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
// #26: an action's files (its JSON's files): FILES_OUT at most, each a file inside its workspace, that workspace's storage
// folder or its own folder (a one-file one: the file), links followed; a relative one from its folder, where it runs. An
// image goes as imageSave's copy (the prompt shows it), the rest as their paths. What isn't goes to its log
const FILES_OUT = 10
const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i
function filesOut(w: Entry, raw: unknown, ws: Workspace | undefined, action: string) {
  const roots = [ws?.path, ws?.storage, pathOf(w)].flatMap(r => (r && existsSync(r) ? [realpathSync(r)] : []))
  const out: ActionFile[] = []
  const bad: string[] = Array.isArray(raw) ? [] : [JSON.stringify(raw)]
  for (const f of Array.isArray(raw) ? raw : [])
    try {
      if (typeof f !== 'string' || !f.trim() || out.length >= FILES_OUT) throw 0
      const real = realpathSync(resolve(w.dir, f))
      const st = statSync(real)
      if (!st.isFile() || !roots.some(r => within(r, real))) throw 0
      const ext = IMG_EXT.exec(real)?.[1].toLowerCase()
      out.push(ext && st.size <= 20 << 20 ? { path: imageSave({ data: readFileSync(real).toString('base64'), ext }), image: true, size: st.size } : { path: real, size: st.size })
    } catch {
      bad.push(typeof f === 'string' ? f : JSON.stringify(f))
    }
  if (bad.length) wLog(w, `action ${action}: files refused (${FILES_OUT} at most, each a file inside its workspace, its storage or the extension's folder): ${bad.map(b => String(b).slice(0, 200)).join(', ')}`, 'warn')
  return out
}
export async function widgetAction(o: { id: string; action: string; arg?: string; ws?: string; from?: { ws?: string; tab?: string }; ctx?: WidgetCtx }, why?: string, ev?: Ev): Promise<{ ok: boolean; out?: string; error?: string; stdout?: string; insert?: string; open?: string; files?: ActionFile[] } & WidgetSay> {
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
  if (!gone) await factsFor(w, x)
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
    const say = (j && sayOf(j)) ?? (ai && insert === undefined && !(j && ('data' in j || 'send' in j)) ? { modal: { title: `${w.m.name || w.id} · ${o.action}`, text: out.trim().slice(0, 2000), buttons: [{ label: 'OK', style: 'primary' as const }] } } : undefined) // an agent's words: a dialog
    // #26: a link the app opens after it, and files it attaches where an insert goes
    const open = typeof j?.open === 'string' ? j.open.trim().slice(0, 2000) : j?.open
    if (open !== undefined && !openOk(open)) wLog(w, `action ${o.action}: open refused, not an http(s), mailto or laki:// link: ${String(open).slice(0, 200)}`, 'warn')
    const files = j && 'files' in j && !ev ? filesOut(w, j.files, x ?? state.workspaces.find(v => v.id === ctx?.info.ws?.id), o.action) : undefined
    return { ok: true, ...(say ?? { out: lastLine(out) }), ...(ev?.full && { stdout: out }), ...(insert !== undefined && { insert: insert.slice(0, INSERT_MAX) }), ...(openOk(open) && !ev && { open }), ...(files?.length && { files }), ...(typeof j?.send === 'string' && j.send.trim() && !ev && { send: j.send.trim().slice(0, INSERT_MAX) }) } // send: to the workspace's agent, the app asks first (widgetDo's send)
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
  for (const w of widgets.values()) {
    if (outside(w, now)) {
      if (scoped(w) ? shownIn(w).some(ws => due(w, now, ws)) : due(w, now)) wLog(w, () => `not fetched: outside the working hours (${(h => (h && !('error' in h) ? describeHours(h) : ''))(hoursOf(w))})`)
      continue
    }
    if (scoped(w)) for (const ws of shownIn(w)) due(w, now, ws) && soon({ id: w.id, reason, ws })
    else if (reason !== 'select' && due(w, now)) soon({ id: w.id, reason })
  }
}
// fetch it now where it shows: a global one, or a scope workspace one's instances on screen (gate: which may)
export function refetch(w: Entry, reason: string, why?: string, gate: (w: Entry, ws?: string) => boolean = fetchable) {
  for (const ws of scoped(w) ? shownIn(w) : [undefined]) if (gate(w, ws)) soon({ id: w.id, reason, why, ws })
}
const soon = (o: { id: string; reason: string; why?: string; ws?: string }) => void widgetRun(o).catch(e => wLog(o, `not fetched: ${(e as Error).message}`)) // a workspace gone meanwhile
export const shown = () => [...clients].some(c => c.view?.shown !== false) // a window shown (closing one only hides it)
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

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// when one fetches on its own: its own working hours (always: none), else Settings' (settings.widgetHours); null: always
export function hoursOf(w?: Entry) {
  const own = w?.s.hours?.trim()
  if (own && /^always$/i.test(own)) return null
  const t = own || (typeof state.settings?.widgetHours === 'string' ? state.settings.widgetHours.trim() : '')
  return t ? parseHours(t) : null
}
export const outside = (w: Entry, now: number) => (h => !!h && !('error' in h) && !inHours(h, now))(hoursOf(w))
// an extension's own working hours as typed: '' none, always, or what parseHours reads (else refused, saying how)
function hoursText(v: unknown) {
  const t = typeof v === 'string' ? v.trim().slice(0, 200) : ''
  if (!t || /^always$/i.test(t)) return t ? 'always' : undefined
  const h = parseHours(t)
  if ('error' in h) throw new Error(`working hours: ${h.error}, or always`)
  return t
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

// a widget's folder, for Open in (core's openIn)
export const widgetDir = (id: string) => find(id).dir

// Settings' Reload: the folders again, then every widget that's on fetches
export function widgetReload() {
  scanWidgets()
  for (const w of widgets.values()) refetch(w, 'reload')
  return widgetsView()
}
