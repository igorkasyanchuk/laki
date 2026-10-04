// The daemon's model: projects, workspaces (git worktrees), tabs (PTY sessions), agent status from hooks,
// the follow-up queue, ports and PRs. One process owns it all; clients get `View`s pushed on every change.
import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, type Dirent, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { dataDir } from '../shared/conn.ts'
import { API, type Check, type PR, type PRFix, type Preset, type Project, type ProjectConfig, type Remote, type RunAction, type Settings, type State, type Status, type Tab, type TabView, type Tunnel, type View, type Workspace } from '../shared/types.ts'
import { limitReset } from './limits.ts'
import { type Client, Session } from './session.ts'

const run = promisify(execFile)

export const dir = dataDir()
const statePath = join(dir, 'state.json')
const runDir = join(dir, 'run')
export const settingsPath = join(dir, 'claude-settings.json')
export const shell = process.env.SHELL || userInfo().shell || '/bin/zsh'

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

// the agents to start: Settings' presets, or claude and codex as they are
const DEFAULT_PRESETS: Preset[] = [
  { name: 'claude', agent: 'claude' },
  { name: 'codex', agent: 'codex' },
]
export const presets = () => state.settings?.presets ?? DEFAULT_PRESETS
const presetNamed = (name?: string) => (name ? presets().find(p => p.name === name) : undefined)
const presetOf = (t: Tab) => presetNamed(t.profile ?? t.preset)

export let state: State = { projects: [], workspaces: [], tabs: [] }
export const sessions = new Map<string, Session>()
type Runtime = { status: Status; done: boolean; limit?: number; last?: string; seen?: number; escAt?: number }
const rt = new Map<string, Runtime>()
const ports = new Map<string, number[]>()
const prs = new Map<string, PR>()
export type Conn = Client & { view?: { tab: string | null; tabs?: string[]; focused: boolean } }
export const clients = new Set<Conn>()
let lastSize = { cols: 120, rows: 32 } // the newest client size: new tabs start at it

// ---------- persistence

export function load() {
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {}
  state.projects ??= []
  state.workspaces ??= []
  state.tabs ??= []
}

export function save() {
  writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2))
  renameSync(statePath + '.tmp', statePath)
}

// ---------- hooks: how agents report their state (absolute paths: they run from any shell)

const here = dirname(fileURLToPath(import.meta.url))
const cliPath = [join(here, 'cli.js'), join(here, '../cli/main.ts')].find(p => existsSync(p))!
// node (or Electron as node) + the CLI script
export const cliArgv = [process.execPath, ...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), cliPath]
export const cliEnv = process.versions.electron ? ['ELECTRON_RUN_AS_NODE=1'] : []
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const hookCmd = (st: string) => [...cliEnv, ...cliArgv.map(q), 'hook', st].join(' ')

export function writeClaudeSettings() {
  const h = (st: string, matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCmd(st), timeout: 5 }] }]
  const settings = {
    hooks: {
      SessionStart: h('start'),
      UserPromptSubmit: h('running'),
      PreToolUse: h('running', '*'),
      PostToolUse: h('running', '*'),
      // permission prompts and questions, not the 60s idle reminder
      Notification: h('waiting', 'permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input'),
      Stop: h('idle'),
      StopFailure: h('failed'),
    },
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

// A Finder-launched app has a bare PATH: take the login shell's, so git/gh/claude are found.
export function adoptLoginPath() {
  try {
    const out = execFileSync(shell, ['-lic', 'printf "__LAKI__%s__LAKI__" "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    const m = out.match(/__LAKI__(.*)__LAKI__/)
    if (m?.[1]) process.env.PATH = m[1]
  } catch {}
}

// ---------- view and events

const rtOf = (id: string) => {
  let r = rt.get(id)
  if (!r) rt.set(id, (r = { status: 'idle', done: false }))
  return r
}

export const hasHooks = (t: Tab) => t.kind === 'agent' && (t.preset === 'claude' || t.preset === 'codex')

export function view(): View {
  const tabs: TabView[] = state.tabs.map(t => {
    const s = sessions.get(t.id)
    const r = rtOf(t.id)
    const status: Status = !s || s.exited ? 'exited' : hasHooks(t) ? r.status : 'idle'
    return { ...t, status, code: s?.exited ? s.exitCode : undefined, done: r.done, limit: r.limit, last: r.last }
  })
  return {
    projects: state.projects,
    // ponytail: run reads .laki.json per workspace on every view; cache by mtime if many workspaces
    workspaces: state.workspaces.map(w => ({ ...w, setup: existsSync(setupMarker(w)), ports: ports.get(w.id) ?? [], tunnels: tunnelsOf(w.id), pr: prs.get(w.id), run: !!projectConfig(w).run })),
    tabs,
    presets: presets(),
    settings: state.settings ?? {},
    remote: remoteView(),
    api: API,
  }
}

let pending: NodeJS.Timeout | null = null
export function changed() {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const v = view()
    for (const c of clients) c.send({ ev: 'state', view: v })
  }, 30)
}

const broadcast = (msg: unknown) => clients.forEach(c => c.send(msg))

// tabs: every pane on screen; tab: the focused one (older clients send only that)
const shown = (v: { tab: string | null; tabs?: string[] }) => v.tabs ?? (v.tab ? [v.tab] : [])
const viewed = (tab: string) => [...clients].some(c => c.view?.focused && shown(c.view).includes(tab))

export function setView(c: Conn, v: { tab: string | null; tabs?: string[]; focused: boolean }) {
  c.view = v
  if (!v.focused) return
  for (const id of shown(v)) {
    const r = rt.get(id)
    if (r?.done) {
      r.done = false
      changed()
    }
  }
}

// ---------- lookups

export function findProject(ref: string): Project {
  const abs = resolve(ref)
  const p = state.projects.find(p => p.id === ref || p.name === ref || p.path === abs)
  if (!p) throw new Error(`no project ${ref}`)
  return p
}

export function findWs(ref: string): Workspace {
  const w = state.workspaces.find(w => w.id === ref) ?? only(state.workspaces.filter(w => w.id.startsWith(ref)), ref)
  if (!w) throw new Error(`no workspace ${ref}`)
  return w
}

const only = <T>(xs: T[], ref: string) => {
  if (xs.length > 1) throw new Error(`${ref} matches ${xs.length} workspaces`)
  return xs[0]
}

const tabsOf = (ws: string) => state.tabs.filter(t => t.workspace === ws)

export function findTab(id: string): Tab {
  const t = state.tabs.find(t => t.id === id)
  if (!t) throw new Error(`no tab ${id}`)
  return t
}

// resolveTarget reads "<workspace>[/<tab>]": a tab by id, name or 1-based number; default the first agent tab.
export function resolveTarget(ref: string): Tab {
  const direct = state.tabs.find(t => t.id === ref)
  if (direct) return direct
  const [wref, tref] = ref.split('/')
  const ws = findWs(wref)
  const tabs = tabsOf(ws.id)
  const t = !tref ? tabs.find(t => t.kind === 'agent') : (tabs.find(t => t.id === tref || t.name === tref) ?? tabs[Number(tref) - 1])
  if (!t) throw new Error(`no tab ${tref ?? '(agent)'} in ${ws.id}`)
  return t
}

// ---------- git

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 << 20 })
  return stdout.trim()
}

export async function branches(projectRef: string) {
  const p = findProject(projectRef)
  if (p.git === false) return { current: '', branches: [] }
  const [current, list] = await Promise.all([git(p.path, 'rev-parse', '--abbrev-ref', 'HEAD'), git(p.path, 'branch', '--format=%(refname:short)')])
  return { current, branches: list.split('\n').filter(Boolean) }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')

// uniqueWsId: an id no workspace, worktree dir or kept laki/<id> branch (wsRm keeps branches) uses yet
async function uniqueWsId(want: string, proj?: Project) {
  const base = want || `ws-${randomUUID().slice(0, 4)}`
  const taken = async (id: string) =>
    state.workspaces.some(w => w.id === id) ||
    (!!proj &&
      (existsSync(join(dir, 'worktrees', proj.id, id)) ||
        (await git(proj.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branchPrefix()}${id}`).then(
          () => true,
          () => false,
        ))))
  let id = base
  for (let n = 2; await taken(id); n++) id = `${base}-${n}`
  return id
}

// allocPort: 3100 + n*10, the first not taken by another live workspace
export function allocPort() {
  const used = new Set(state.workspaces.filter(w => !w.archived).map(w => w.port))
  let port = 3100
  while (used.has(port)) port += 10
  return port
}

// .laki.json from the workspace (as checked out), else from the project root (works before it's committed);
// the project's own config (set in the app) wins field by field
export function projectConfig(ws: Workspace): ProjectConfig {
  const proj = state.projects.find(p => p.id === ws.project)
  let file: ProjectConfig = {}
  for (const d of [ws.path, proj?.path]) {
    if (!d) continue
    try {
      file = JSON.parse(readFileSync(join(d, '.laki.json'), 'utf8'))
      break
    } catch {}
  }
  const { env, actions: _, ...cmds } = proj?.config ?? {} // actions: the renderer's (Run ▾)
  const own = Object.fromEntries(Object.entries(cmds).filter(([, v]) => v?.trim()))
  return { ...file, ...own, env: { ...file.env, ...env } }
}

// the .laki.json a project's root has, for the settings dialog's placeholders
export function projectFileConfig(ref: string): ProjectConfig {
  try {
    return JSON.parse(readFileSync(join(findProject(ref).path, '.laki.json'), 'utf8'))
  } catch {
    return {}
  }
}

// a project's actions as kept: for claude, codex or a shell (an unfinished one too, as Settings has it: Run ▾ skips it)
function actionsOk(l: unknown): RunAction[] | undefined {
  const ok = (Array.isArray(l) ? l : []).filter((a): a is RunAction => typeof a?.name === 'string' && typeof a.text === 'string' && ['claude', 'codex', 'shell'].includes(a.target))
  return ok.length ? ok.map(a => ({ name: a.name, target: a.target, text: a.text })) : undefined
}

export function projectSet(ref: string, o: { name?: string; config?: ProjectConfig }) {
  const p = findProject(ref)
  if (o.name?.trim()) p.name = o.name.trim()
  if (o.config) {
    const env = Object.fromEntries(Object.entries(o.config.env ?? {}).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)))
    p.config = {
      setup: o.config.setup?.trim() || undefined,
      teardown: o.config.teardown?.trim() || undefined,
      run: o.config.run?.trim() || undefined,
      expose: o.config.expose?.trim() || undefined,
      actions: actionsOk(o.config.actions),
      env: Object.keys(env).length ? env : undefined,
    }
  }
  save()
  changed()
  return p
}

const setupMarker = (ws: Workspace) => join(runDir, `${ws.id}.setup`)

// ---------- projects

// a git repository (its top level), or any other folder (git: false)
export async function projectAdd(path: string): Promise<Project> {
  const abs = resolve(path)
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${path} is not a folder`)
  const top = await git(abs, 'rev-parse', '--show-toplevel').catch(() => '')
  const root = top || realpathSync(abs)
  const existing = state.projects.find(p => p.path === root)
  if (existing) return existing
  let id = slug(basename(root)) || 'project'
  for (let n = 2; state.projects.some(p => p.id === id); n++) id = `${slug(basename(root))}-${n}`
  const p: Project = { id, name: basename(root), path: root, git: !!top }
  state.projects.push(p)
  save()
  changed()
  return p
}

export function projectRm(ref: string) {
  const p = findProject(ref)
  const live = state.workspaces.filter(w => w.project === p.id && w.kind === 'worktree' && !w.archived)
  if (live.length) throw new Error(`${p.name} has workspaces: delete them first (${live.map(w => w.id).join(', ')})`)
  for (const w of state.workspaces.filter(w => w.project === p.id)) dropWs(w)
  state.projects = state.projects.filter(x => x !== p)
  save()
  changed()
}

// ---------- tabs

function childEnv(ws: Workspace, tab: Tab, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('ELECTRON_') || k.startsWith('LAKI_') || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    env[k] = v
  }
  return {
    ...env,
    ...state.settings?.env, // Settings → General: every session's
    ...projectConfig(ws).env,
    ...presetOf(tab)?.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'laki',
    LAKI_WORKSPACE: ws.id,
    LAKI_TAB: tab.id,
    PORT: String(ws.port),
    LAKI_HOME: dir,
    LAKI_PROJECT_PATH: state.projects.find(p => p.id === ws.project)?.path ?? ws.path, // the repo itself: setup copies .env etc. from it
    ...extra,
  }
}

function agentCmd(tab: Tab, prompt: string | undefined, resume: boolean): string {
  const pr = presetOf(tab)
  let argv: string[]
  if (tab.preset === 'claude') {
    argv = ['claude', '--settings', settingsPath]
    if (resume && tab.resumeId) argv.push('--resume', tab.resumeId)
    else if (tab.forkOf && !tab.resumeId) argv.push('--resume', tab.forkOf, '--fork-session')
  } else if (tab.preset === 'codex') {
    argv = resume && tab.resumeId ? ['codex', 'resume', tab.resumeId] : ['codex']
    // notify runs when a turn ends; a JSON string array is a TOML one too. ~/.codex stays untouched.
    argv.push('-c', 'notify=' + JSON.stringify(['/usr/bin/env', ...cliEnv, ...cliArgv, 'hook', 'done']))
  } else {
    return (pr?.agent === 'command' && pr.cmd?.trim()) || tab.cmd || 'true'
  }
  // a preset's args go in as written (a shell runs the line), before the prompt
  return [argv.map(q).join(' '), pr?.args?.trim(), prompt && !resume ? q(prompt) : ''].filter(Boolean).join(' ')
}

type SpawnOpts = { cmd?: string; prompt?: string; resume?: boolean; env?: Record<string, string> }

export function spawnTab(tab: Tab, o: SpawnOpts = {}) {
  const ws = findWs(tab.workspace)
  if (!existsSync(ws.path)) throw new Error(`${ws.path} is gone`)
  let args: string[]
  if (tab.kind === 'shell') args = ['-l']
  else {
    let cmd = o.cmd ?? (tab.kind === 'agent' ? agentCmd(tab, o.prompt, !!o.resume) : tab.cmd || 'true')
    const marker = setupMarker(ws)
    if (tab.kind === 'agent' && existsSync(marker))
      cmd = `printf '\\033[2mwaiting for the setup script (see the setup tab)…\\033[0m\\r\\n'; while [ -e ${q(marker)} ]; do sleep 0.3; done; ${cmd}`
    args = ['-lic', cmd]
  }
  sessions.get(tab.id)?.kill()
  const s = new Session(tab.id, shell, args, { cwd: ws.path, env: childEnv(ws, tab, o.env), ...lastSize })
  sessions.set(tab.id, s)
  const r = rtOf(tab.id)
  r.status = o.prompt && !o.resume ? 'running' : 'idle'
  r.done = false
  s.onExit = code => {
    if (tab.kind === 'setup') rmSync(setupMarker(ws), { force: true })
    // `exit` closes a shell's tab, a clean exit an agent's; one we ended (close, restart, archive, shutdown) is no longer in sessions
    if ((tab.kind === 'shell' || (tab.kind === 'agent' && code === 0)) && sessions.get(tab.id) === s && state.tabs.includes(tab)) return closeTab(tab.id)
    changed()
    if (tab.kind !== 'agent' && tab.kind !== 'dev') return
    s.term.write('', () => {
      // a chat id claude/codex don't have (e.g. one with no message was never saved): Enter starts a new one
      if (tab.resumeId && code !== 0 && CHAT_GONE.test(s.screenText(8))) {
        tab.resumeId = undefined
        save()
        s.output('\x1b[2m[that chat can\'t be resumed · press Enter to start a new one]\x1b[0m\r\n')
      } else s.output('\x1b[2m[press Enter to start it again]\x1b[0m\r\n')
    })
  }
  changed()
  return s
}

// what claude --resume / codex resume print for a chat id they don't have.
// ponytail: matched by message; a reworded message means Enter retries the dead id.
const CHAT_GONE = /no (conversation|saved session|session|rollout)\b[^\n]*found|(conversation|session|thread)\b[^\n]*not found/i

// why addTab would refuse an agent: checked before wsNew makes a worktree for it
function presetCheck(preset?: string, cmd?: string) {
  if (preset === 'custom' && !cmd?.trim()) throw new Error('custom preset: command missing')
  if (preset && !['claude', 'codex', 'shell', 'custom'].includes(preset) && !presetNamed(preset))
    throw new Error(`unknown preset ${preset} (see Settings: Agent presets)`)
}

export function addTab(wsRef: string, o: { kind?: Tab['kind']; preset?: string; cmd?: string; name?: string; prompt?: string; forkOf?: string }): Tab {
  const ws = findWs(wsRef)
  if (!o.kind) presetCheck(o.preset, o.cmd)
  const pr = o.kind ? undefined : presetNamed(o.preset)
  if (pr?.agent === 'command') o = { ...o, cmd: pr.cmd || 'true' }
  const preset = pr ? (pr.agent === 'command' ? 'custom' : pr.agent) : o.preset || (o.cmd ? 'custom' : 'shell')
  const kind = o.kind ?? (preset === 'shell' && !o.cmd ? 'shell' : 'agent')
  let name = o.name || pr?.name || (kind === 'agent' ? (preset === 'custom' ? basename(o.cmd!.split(/\s/)[0]) : preset) : kind)
  const base = name
  for (let n = 2; tabsOf(ws.id).some(t => t.name === name); n++) name = `${base} ${n}`
  const tab: Tab = { id: randomUUID().slice(0, 8), workspace: ws.id, name, kind, ...(kind === 'agent' ? { preset } : {}), ...(pr ? { profile: pr.name } : {}), ...(o.cmd ? { cmd: o.cmd } : {}), ...(o.forkOf ? { forkOf: o.forkOf } : {}) }
  state.tabs.push(tab)
  save()
  try {
    spawnTab(tab, { prompt: o.prompt })
  } catch (e) {
    state.tabs = state.tabs.filter(t => t !== tab)
    save()
    throw e
  }
  return tab
}

// rename a tab, or color it
export function tabSet(o: { id: string; name?: string; color?: string }) {
  const t = findTab(o.id)
  if (o.name?.trim()) t.name = o.name.trim().slice(0, 40)
  if (o.color !== undefined) t.color = o.color || undefined
  save()
  changed()
  return t
}

// a workspace's sidebar color, name, and whether CI failures and review comments go to its agent
export function wsSet(o: { id: string; color?: string; name?: string; autoFix?: boolean; autoReview?: boolean }) {
  const w = findWs(o.id)
  if (o.color !== undefined) w.color = o.color && o.color !== 'none' ? o.color : undefined
  if (o.name !== undefined) {
    const name = Array.from(o.name.trim()).slice(0, 60).join('') // by character: an emoji stays whole
    w.name = name && name !== w.id ? name : undefined // the id itself: back to it
  }
  if (o.autoFix !== undefined) w.autoFix = o.autoFix || undefined
  if (o.autoReview !== undefined) w.autoReview = o.autoReview || undefined
  save()
  changed()
  if (o.autoFix || o.autoReview) scanPRs().catch(() => {}) // act on the PR as it is now (one scan at a time: no double sends)
  return w
}

// a pasted image, kept for an agent's prompt (by its path)
export function imageSave(o: { data: string; ext?: string }) {
  const ext = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(o.ext ?? '') ? o.ext : 'png'
  const buf = Buffer.from(o.data, 'base64')
  if (!buf.length || buf.length > 20 << 20) throw new Error('an image up to 20 MB')
  const images = join(dir, 'images')
  mkdirSync(images, { recursive: true })
  // ones older than a month go: their prompts are long sent
  for (const f of readdirSync(images)) if (Number(f.split('-')[0]) < Date.now() - 30 * 86400e3) rmSync(join(images, f), { force: true })
  const path = join(images, `${Date.now()}-${randomUUID().slice(0, 6)}.${ext}`)
  writeFileSync(path, buf)
  return path
}

// the sidebar's order: projects, or workspaces (by id; others keep their place after them)
export function reorder(o: { projects?: string[]; workspaces?: string[] }) {
  const by = <T extends { id: string }>(list: T[], ids: string[]) => {
    const at = (x: T) => (ids.includes(x.id) ? ids.indexOf(x.id) : ids.length)
    return [...list].sort((a, b) => at(a) - at(b)) // stable: the rest keep their order
  }
  if (o.projects) state.projects = by(state.projects, o.projects)
  if (o.workspaces) state.workspaces = by(state.workspaces, o.workspaces)
  save()
  changed()
}

export function settingsSet(o: Settings) {
  if (o.env) o = { ...o, env: Object.fromEntries(Object.entries(o.env).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) }
  state.settings = { ...state.settings, ...o }
  save()
  changed()
  return state.settings
}

const branchPrefix = () => state.settings?.branchPrefix?.trim() || 'laki/'

// what a folder can open in, by macOS app name (open -a <app> <folder>)
export const APPS: Record<string, string> = {
  cursor: 'Cursor',
  zed: 'Zed',
  vscode: 'Visual Studio Code',
  windsurf: 'Windsurf',
  sublime: 'Sublime Text',
  webstorm: 'WebStorm',
  intellij: 'IntelliJ IDEA',
  xcode: 'Xcode',
  finder: 'Finder',
  terminal: 'Terminal',
  iterm: 'iTerm',
  warp: 'Warp',
  ghostty: 'Ghostty',
}

// the apps installed (Finder and Terminal always are)
export function apps() {
  const dirs = ['/Applications', '/System/Applications/Utilities', join(homedir(), 'Applications')]
  return Object.entries(APPS)
    .filter(([id, name]) => id === 'finder' || dirs.some(d => existsSync(join(d, `${name}.app`))))
    .map(([id, name]) => ({ id, name }))
}

// open a workspace's (or a project's) folder in an app; 'editor' is the one in Settings
export async function openIn(o: { ws?: string; project?: string; app: string; file?: string }) {
  const path = o.file && o.ws ? inside(findWs(o.ws), o.file) : o.ws ? findWs(o.ws).path : findProject(o.project ?? '').path
  const s = state.settings ?? {}
  const app = o.app === 'editor' ? s.editor || 'cursor' : o.app
  const fail = (e: any) => {
    throw new Error(String(e.stderr || e.message).trim().split('\n')[0])
  }
  if (app === 'custom') {
    if (!s.editorCmd?.trim()) throw new Error('set the editor command in Settings (⌘,)')
    return void (await run(shell, ['-lc', `${s.editorCmd} "$1"`, 'editor', path], { timeout: 20000 }).catch(fail))
  }
  if (!APPS[app]) throw new Error(`no app ${app}`)
  await run('open', app === 'finder' ? [path] : ['-a', APPS[app], path]).catch(fail)
}

export function closeTab(id: string) {
  const t = findTab(id)
  sessions.get(id)?.kill()
  sessions.delete(id)
  rt.delete(id)
  state.tabs = state.tabs.filter(x => x !== t)
  save()
  changed()
}

// ---------- workspaces

export type NewWs = { project: string; base?: string; preset?: string; cmd?: string; prompt?: string; name?: string; local?: boolean; forkOf?: string }

export async function wsNew(o: NewWs): Promise<Workspace> {
  const proj = findProject(o.project)
  const preset = o.preset || (o.cmd?.trim() ? 'custom' : state.settings?.agent || 'claude')
  if (preset !== 'none') presetCheck(preset, o.cmd)
  const current = proj.git === false ? '' : await git(proj.path, 'rev-parse', '--abbrev-ref', 'HEAD')
  let ws: Workspace
  if (o.local || proj.git === false) {
    const have = state.workspaces.find(w => w.project === proj.id && w.kind === 'local')
    if (have) return have
    ws = { id: await uniqueWsId(proj.id), project: proj.id, path: proj.path, branch: current, base: current, kind: 'local', port: allocPort(), created: Date.now() }
  } else {
    const want = slug(o.name || (o.prompt ?? '').split(/\s+/).slice(0, 4).join(' '))
    const id = await uniqueWsId(want, proj)
    const path = join(dir, 'worktrees', proj.id, id)
    const base = o.base || current
    const branch = `${branchPrefix()}${id}`
    mkdirSync(dirname(path), { recursive: true })
    await git(proj.path, 'worktree', 'add', path, '-b', branch, base).catch(e => {
      throw new Error(`git worktree add failed: ${String(e.stderr || e.message).trim()}`)
    })
    ws = { id, project: proj.id, path, branch, base, kind: 'worktree', port: allocPort(), created: Date.now() }
  }
  state.workspaces.push(ws)
  save()
  const cfg = projectConfig(ws)
  if (cfg.setup && ws.kind === 'worktree') {
    writeFileSync(setupMarker(ws), String(Date.now()))
    addTab(ws.id, { kind: 'setup', name: 'setup', cmd: cfg.setup })
  }
  try {
    if (preset !== 'none') addTab(ws.id, { preset, cmd: o.cmd, prompt: o.prompt, forkOf: o.forkOf })
  } finally {
    changed() // the workspace is made, even when its agent didn't start
  }
  return ws
}

async function teardown(ws: Workspace) {
  stopTunnels(ws.id)
  for (const t of tabsOf(ws.id)) {
    sessions.get(t.id)?.kill()
    sessions.delete(t.id)
  }
  const cfg = projectConfig(ws)
  if (cfg.teardown && existsSync(ws.path))
    await run(shell, ['-lc', cfg.teardown], { cwd: ws.path, env: childEnv(ws, { id: '', workspace: ws.id, name: '', kind: 'shell' }), timeout: 60000 }).catch(() => {})
  if (ws.kind === 'worktree') {
    const proj = state.projects.find(p => p.id === ws.project)
    if (proj) await git(proj.path, 'worktree', 'remove', '--force', ws.path).catch(() => {})
    rmSync(ws.path, { recursive: true, force: true })
    // after the dir is gone: drops the registration a failed remove left, which would block re-adding the branch
    if (proj) await git(proj.path, 'worktree', 'prune').catch(() => {})
  }
  rmSync(setupMarker(ws), { force: true })
}

function dropWs(ws: Workspace) {
  stopTunnels(ws.id)
  for (const t of tabsOf(ws.id)) {
    sessions.get(t.id)?.kill()
    sessions.delete(t.id)
    rt.delete(t.id)
  }
  state.tabs = state.tabs.filter(t => t.workspace !== ws.id)
  state.workspaces = state.workspaces.filter(w => w !== ws)
  ports.delete(ws.id)
  prs.delete(ws.id)
}

// wsRm kills its tabs, runs teardown and removes the worktree; the branch stays.
export async function wsRm(ref: string) {
  const ws = findWs(ref)
  await teardown(ws)
  dropWs(ws)
  save()
  changed()
}

// wsArchive is wsRm that keeps the workspace's record (branch, agents' resume ids) for wsRestore.
export async function wsArchive(ref: string) {
  const ws = findWs(ref)
  if (ws.kind !== 'worktree') throw new Error('only worktree workspaces can be archived')
  await teardown(ws)
  ws.archived = true
  ws.port = 0
  stopTunnels(ws.id) // one started during the teardown
  state.tabs = state.tabs.filter(t => t.workspace !== ws.id || t.kind === 'agent' || t.kind === 'shell')
  save()
  changed()
}

export async function wsRestore(ref: string) {
  const ws = findWs(ref)
  if (!ws.archived) return ws
  const proj = findProject(ws.project)
  await git(proj.path, 'worktree', 'add', ws.path, ws.branch).catch(e => {
    throw new Error(`git worktree add failed: ${String(e.stderr || e.message).trim()}`)
  })
  ws.archived = false
  ws.port = allocPort()
  save()
  for (const t of tabsOf(ws.id)) spawnTab(t, { resume: true })
  changed()
  return ws
}

// wsFork: a new workspace from this one's branch, its Claude chat forked (--fork-session).
export async function wsFork(ref: string) {
  const src = findWs(ref)
  const agent = tabsOf(src.id).find(t => t.preset === 'claude' && t.resumeId)
  return wsNew({ project: src.project, base: src.branch, name: `${src.id}-fork`, preset: agent ? (presetNamed(agent.profile) ? agent.profile : 'claude') : 'shell', forkOf: agent?.resumeId })
}

// restoreAll starts every tab of every live workspace after a daemon restart: agents resume their chat.
export function restoreAll() {
  for (const f of readdirSync(runDir)) if (f.endsWith('.setup')) rmSync(join(runDir, f), { force: true })
  state.tabs = state.tabs.filter(t => t.kind === 'agent' || t.kind === 'shell')
  for (const ws of state.workspaces) {
    if (ws.archived) continue
    for (const t of tabsOf(ws.id)) {
      try {
        spawnTab(t, { resume: true })
      } catch (e) {
        console.error(`restore ${t.id}:`, (e as Error).message)
      }
    }
  }
  save()
}

// ---------- agent status (hooks)

export function hook(p: { tab: string; state: string; payload?: any }) {
  const tab = state.tabs.find(t => t.id === p.tab)
  if (!tab) return
  const r = rtOf(tab.id)
  const pl = p.payload ?? {}
  switch (p.state) {
    case 'start':
      if (pl.session_id && pl.session_id !== tab.resumeId) {
        tab.resumeId = pl.session_id
        save()
      }
      return changed()
    case 'running':
      r.status = 'running'
      r.limit = r.escAt = undefined
      break
    case 'waiting':
      r.status = 'waiting'
      r.limit = undefined
      broadcast({ ev: 'turn', tab: tab.id, ws: tab.workspace, kind: 'waiting', text: pl.message ?? '' })
      break
    case 'idle':
    case 'done': // codex notify: {"type":"agent-turn-complete","thread-id":…,"last-assistant-message":…}
    case 'failed': {
      r.status = 'idle'
      r.limit = undefined
      const id = pl['thread-id']
      if (id && id !== tab.resumeId) {
        tab.resumeId = id
        save()
      }
      const last = pl.last_assistant_message ?? pl['last-assistant-message']
      if (last) {
        r.last = String(last)
        writeFileSync(join(runDir, `${tab.id}.last`), r.last)
      }
      if (p.state === 'failed' || tab.preset === 'codex') checkLimit(tab, p.state === 'failed' ? `${last ?? ''}\n${JSON.stringify(pl.error_details ?? pl.error ?? '')}` : '')
      if (!viewed(tab.id)) r.done = true
      broadcast({ ev: 'turn', tab: tab.id, ws: tab.workspace, kind: r.limit ? 'limit' : 'done', text: r.last ?? '' })
      if (!r.limit) setTimeout(() => deliver(tab.id), 800) // after the hook returns: the agent redraws its prompt
      break
    }
    case 'interrupted':
      r.status = 'idle'
      break
  }
  changed()
}

// ---------- typing into agents, queue

// typeInto pastes text and presses Enter. One message at a time per tab: a queued delivery and a send
// at the same moment must not interleave their text and Enters.
const typing = new WeakMap<Session, Promise<void>>()
export function typeInto(s: Session, text: string) {
  const next = (typing.get(s) ?? Promise.resolve()).then(
    () =>
      new Promise<void>(done => {
        s.write(s.term.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text)
        setTimeout(() => {
          s.write('\r') // as a separate key, so it isn't part of the paste
          setTimeout(done, 50)
        }, 150)
      }),
  )
  typing.set(s, next)
  return next
}

export function send(p: { target: string; text: string; whenIdle?: boolean }) {
  const tab = resolveTarget(p.target)
  const s = sessions.get(tab.id)
  if (!s || s.exited) throw new Error(`${tab.name} isn't running`)
  const r = rtOf(tab.id)
  if (p.whenIdle) {
    if (!hasHooks(tab)) throw new Error(`${tab.name} doesn't report when it's done (claude and codex do): send it now`)
    if (r.status !== 'idle' || r.limit || tab.queue?.length) {
      tab.queue = [...(tab.queue ?? []), p.text]
      save()
      changed()
      return { tab: tab.id, queued: tab.queue.length }
    }
  }
  typeInto(s, p.text)
  if (hasHooks(tab)) r.status = 'running'
  changed()
  return { tab: tab.id, sent: true }
}

function deliver(id: string) {
  const tab = state.tabs.find(t => t.id === id)
  const s = sessions.get(id)
  const r = rt.get(id)
  if (!tab?.queue?.length || !s || s.exited || r?.status !== 'idle' || r.limit) return
  const msg = tab.queue.shift()!
  if (!tab.queue.length) delete tab.queue
  save()
  typeInto(s, msg)
  r.status = 'running'
  changed()
}

export function clearQueue(target: string) {
  const tab = resolveTarget(target)
  delete tab.queue
  save()
  changed()
}

// input from a client's keyboard. Codex reports only the end of a turn: Enter starts one.
export function input(id: string, data: string) {
  const s = sessions.get(id)
  if (!s) return
  const tab = state.tabs.find(t => t.id === id)
  if (s.exited && tab && (tab.kind === 'agent' || tab.kind === 'dev') && data.includes('\r')) {
    spawnTab(tab, { resume: true }) // Enter on an ended agent or dev server starts it again
    return
  }
  s.write(data)
  if (tab?.preset === 'codex' && data.includes('\r') && rtOf(id).status === 'idle') {
    rtOf(id).status = 'running' // ponytail: Enter in an idle codex starts a turn; its notify ends it
    changed()
  }
  if (tab && hasHooks(tab) && (data === '\x1b' || data === '\x03')) interrupted(tab.id, s)
}

// Esc or ⌃C stops a turn, and no hook says so: idle once the screen shows "Interrupted" (claude's
// "Interrupted · What should Claude do instead?", codex's "Conversation interrupted").
// ponytail: matched by message, like CHAT_GONE.
function interrupted(id: string, s: Session) {
  const r = rtOf(id)
  if (r.status !== 'running' && r.status !== 'waiting') return
  const at = (r.escAt = Date.now())
  for (const ms of [300, 1000, 2500])
    setTimeout(() => {
      if (r.escAt !== at || (r.status !== 'running' && r.status !== 'waiting')) return // a new turn since
      if (!/interrupted/i.test(s.screenText(6))) return
      r.status = 'idle'
      r.escAt = undefined
      changed()
    }, ms)
}

export function resize(id: string, cols: number, rows: number) {
  lastSize = { cols, rows }
  sessions.get(id)?.resize(cols, rows)
}

// ---------- usage limits (Claude's StopFailure, codex's screen): continue after the reset

function checkLimit(tab: Tab, text: string) {
  const s = sessions.get(tab.id)
  const r = rtOf(tab.id)
  const now = new Date()
  let t = limitReset(text, now)
  // codex: a notice at the bottom of its screen, below the one handled already
  if (!t && tab.preset === 'codex' && s && (t = limitReset(s.screenText(8, r.seen), now))) r.seen = s.lineCount()
  // a time gone by: "9am" at noon is tomorrow's, but "3pm" read at 15:00:01 has just reset
  if (t && t <= now) t = now.getTime() - t.getTime() < 5 * 60e3 ? now : new Date(t.getTime() + 86400000)
  if (t) r.limit = t.getTime()
}

export const RESUME_AFTER = 60_000

export function watchLimits(now = Date.now()) {
  for (const [id, r] of rt) {
    if (!r.limit || now < r.limit + RESUME_AFTER) continue
    r.limit = undefined
    const s = sessions.get(id)
    if (s && !s.exited && r.status === 'idle' && !/continuing automatically/i.test(s.screenText(8))) {
      typeInto(s, 'continue')
      r.status = 'running'
    }
    changed()
  }
}

// ---------- ports (lsof over each workspace's process trees) and PRs (gh)

export async function scanPorts() {
  const root = new Map<number, string>()
  for (const [id, s] of sessions) {
    const t = state.tabs.find(t => t.id === id)
    if (t && !s.exited) root.set(s.pty.pid, t.workspace)
  }
  const next = new Map<string, number[]>()
  if (root.size) {
    const kids = new Map<number, number[]>()
    const { stdout: ps } = await run('ps', ['-axo', 'pid=,ppid=']).catch(() => ({ stdout: '' }))
    for (const l of ps.split('\n')) {
      const [pid, ppid] = l.trim().split(/\s+/).map(Number)
      if (pid) kids.set(ppid, [...(kids.get(ppid) ?? []), pid])
    }
    const owner = new Map<number, string>()
    const walk = (pid: number, ws: string) => {
      owner.set(pid, ws)
      for (const k of kids.get(pid) ?? []) if (!owner.has(k)) walk(k, ws)
    }
    for (const [pid, ws] of root) walk(pid, ws)
    const out = await run('lsof', ['-nP', '-a', '-p', [...owner.keys()].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpn']).then(
      r => r.stdout,
      e => String(e.stdout ?? ''),
    )
    let pid = 0
    for (const l of out.split('\n')) {
      if (l[0] === 'p') pid = Number(l.slice(1))
      else if (l[0] === 'n') {
        const port = Number(l.slice(l.lastIndexOf(':') + 1))
        const ws = owner.get(pid)
        if (ws && port && !next.get(ws)?.includes(port)) next.set(ws, [...(next.get(ws) ?? []), port].sort((a, b) => a - b))
      }
    }
  }
  if (JSON.stringify([...next]) !== JSON.stringify([...ports])) {
    ports.clear()
    for (const [k, v] of next) ports.set(k, v)
    changed()
  }
}

// ---------- tunnels: a port exposed at a trycloudflare.com URL by cloudflared (Cloudflare Quick Tunnels).
// With mails, only those addresses (or *@domain) get in, after a one-time code from Cloudflare Access.
// They live in this process only: a daemon restart ends them.

type TunnelRun = Tunnel & { ws: string; cf: Cf }
const tunnels = new Map<string, TunnelRun>() // by `<ws>:<port>`
export const MAIL_VERSION = '2026.9.3' // the first cloudflared with --allowed-mail
// a quick tunnel's name is random words with dashes: not api. (in cloudflared's errors) or login.
const TUNNEL_URL = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/
const MAIL = /^(?:\*|[^\s@*,]+)@[^\s@*,]+\.[^\s@*,]+$/ // an address, or *@domain: a whole domain
const tunnelsOf = (ws: string) => [...tunnels.values()].filter(t => t.ws === ws).map(({ port, url, mails }) => ({ port, url, mails }))
// a < b, for x.y.z versions
const older = (a: string, b: string) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0)
  return false
}
const cfVersion = () => run('cloudflared', ['--version'], { timeout: 10000 }).then(r => /\d+\.\d+\.\d+/.exec(r.stdout + r.stderr)?.[0] ?? '?', () => undefined)

// is cloudflared installed (its version), and who to let in by default: the workspace's project says (expose:
// only those; its settings, else .laki.json), else the popup offers the last list, or git's user.email
export async function cloudflared(o: { ws?: string } = {}): Promise<{ version?: string; mails: string[]; expose?: string }> {
  const expose = o.ws ? projectConfig(findWs(o.ws)).expose?.trim() || undefined : undefined
  const version = await cfVersion()
  let mails = state.settings?.tunnelMails ?? []
  if (!mails.length) mails = await run('git', ['config', '--global', '--get', 'user.email'], { timeout: 5000 }).then(r => (r.stdout.trim() ? [r.stdout.trim()] : []), () => [])
  return { version, mails, expose }
}

// cloudflared publishing target (with mails: only those, after a one-time code from Cloudflare Access). url resolves
// once it prints one (undefined: stopped first) or fails with its output; ended: it went after giving the URL.
type Cf = { stop: () => void }
function cloudflare(target: string, mails: string[], ended: (why: string) => void): { cf: Cf; url: Promise<string | undefined> } {
  // the values go in as arguments of their own (=), so one starting with - is no flag
  const proc = spawn('cloudflared', ['tunnel', '--url', target, ...mails.map(m => `--allowed-mail=${m}`)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stopped = false
  const cf = { stop: () => ((stopped = true), proc.kill()) }
  const url = new Promise<string | undefined>((resolve, reject) => {
    let out = ''
    let got = false
    const fail = (why: string) => {
      clearTimeout(timer)
      proc.kill()
      if (stopped) return resolve(undefined)
      const tail = out.trim().split('\n').slice(-8).join('\n')
      reject(new Error(tail ? `${why}:\n${tail}` : why))
    }
    const timer = setTimeout(() => fail('cloudflared gave no URL within 60 s'), 60000)
    const read = (b: Buffer) => {
      out = (out + b).slice(-16000)
      const m = !got && TUNNEL_URL.exec(out)
      if (!m) return
      got = true
      clearTimeout(timer)
      resolve(m[0])
    }
    proc.stdout!.on('data', read)
    proc.stderr!.on('data', read)
    proc.on('error', e => fail(`cloudflared didn't start: ${e.message}`))
    proc.on('close', (code, sig) => { // after its output: an error's last line is in
      if (!got) return fail(`cloudflared ended (${sig ?? `exit ${code}`})`)
      if (!stopped) ended(sig ?? `exit ${code}`)
    })
  })
  return { cf, url }
}

// cloudflared's version, failing when it can't limit who gets in (mails) or isn't there
async function cfReady(mails: boolean) {
  const version = await cfVersion()
  if (!version) throw new Error("cloudflared isn't installed: brew install cloudflared")
  if (mails && version !== '?' && older(version, MAIL_VERSION))
    throw new Error(`cloudflared ${version} can't limit who opens a tunnel (that needs ${MAIL_VERSION}): brew upgrade cloudflared`)
}

// tunnelStart resolves once cloudflared prints the URL (or was stopped meanwhile), and fails with its output
export async function tunnelStart(o: { ws: string; port: number; mails?: string[] }): Promise<Tunnel> {
  const ws = findWs(o.ws)
  const live = () => state.workspaces.includes(ws) && !ws.archived
  const port = Number(o.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${o.port}`)
  const mails = [...new Set((o.mails ?? []).map(m => m.trim()).filter(Boolean))]
  const bad = mails.find(m => !MAIL.test(m))
  if (bad) throw new Error(`not an email address or *@domain: ${bad}`)
  const key = `${ws.id}:${port}`
  await cfReady(mails.length > 0)
  if (!live()) throw new Error(`no workspace ${o.ws}`) // archived, or gone while cloudflared answered
  const cur = tunnels.get(key)
  if (cur) return { port, url: cur.url, mails: cur.mails }
  if (mails.length) settingsSet({ tunnelMails: mails })
  const drop = () => {
    if (tunnels.get(key) !== t) return
    tunnels.delete(key)
    changed()
  }
  const { cf, url } = cloudflare(`http://localhost:${port}`, mails, why => (log(`tunnel ${key} ended (${why})`), drop()))
  const t: TunnelRun = { ws: ws.id, port, mails, cf }
  tunnels.set(key, t)
  changed()
  try {
    t.url = await url
  } catch (e) {
    drop()
    throw e
  }
  if (!t.url) return { port, mails } // stopped first (tunnelStop took it out)
  changed()
  return { port, url: t.url, mails }
}

export function tunnelStop(o: { ws: string; port: number }) {
  const t = tunnels.get(`${findWs(o.ws).id}:${Number(o.port)}`)
  if (!t) return
  tunnels.delete(`${t.ws}:${t.port}`)
  t.cf.stop()
  changed()
}

// every tunnel, or a workspace's
export function stopTunnels(ws?: string) {
  for (const t of [...tunnels.values()]) if (!ws || t.ws === ws) tunnelStop({ ws: t.ws, port: t.port })
}

// ---------- remote access: this daemon, and the app's page it serves (main.ts), at a trycloudflare.com URL for the
// one email in Settings: Cloudflare Access sends it a one-time code, and the link carries a token of its own. It
// ends after the hours asked for (remoteTick), on remoteStop, or with the daemon; a new token each time, so a stopped
// link is dead.
export const REMOTE_HOURS = [1, 2, 4, 8, 24]
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/ // one address: no *@domain
type RemoteRun = { mail: string; until: number; token: string; url?: string; cf: Cf }
let remote: RemoteRun | undefined
let daemonPort = 0
export const setDaemonPort = (p: number) => (daemonPort = p)
export const remoteToken = () => remote?.token
export const remoteOrigin = () => remote?.url // the page's origin, once there's a URL
export const remoteView = (): Remote | undefined =>
  remote && { mail: remote.mail, until: remote.until, url: remote.url, link: remote.url && `${remote.url}/#token=${remote.token}` }

export async function remoteStart(o: { hours: number; mail?: string }): Promise<Remote | undefined> {
  const hours = Number(o.hours)
  if (!REMOTE_HOURS.includes(hours)) throw new Error(`for how long: ${REMOTE_HOURS.join(', ')} hours`)
  const mail = (o.mail ?? state.settings?.remoteMail ?? '').trim()
  if (!ONE_MAIL.test(mail)) throw new Error(mail ? `not an email address: ${mail}` : 'the email that may open it: Settings › Remote access')
  if (mail !== state.settings?.remoteMail) settingsSet({ remoteMail: mail })
  if (remote) return remoteView()
  await cfReady(true)
  if (remote) return remoteView() // started meanwhile
  const { cf, url } = cloudflare(`http://127.0.0.1:${daemonPort}`, [mail], why => (log(`remote access ended (${why})`), remoteStop()))
  const r: RemoteRun = { mail, until: Date.now() + hours * 3600e3, token: randomBytes(32).toString('hex'), cf }
  remote = r
  changed()
  try {
    r.url = await url
  } catch (e) {
    if (remote === r) remoteStop()
    throw e
  }
  if (remote !== r) return undefined // stopped meanwhile
  log(`remote access at ${r.url} for ${mail}, until ${new Date(r.until).toISOString()}`)
  changed()
  return remoteView()
}

export function remoteStop() {
  const r = remote
  if (!r) return
  remote = undefined
  r.cf.stop()
  changed()
}

// remote access past its time ends (main.ts asks every 15 s; tests move the clock)
export function remoteTick(now = Date.now()) {
  if (remote && now >= remote.until) remoteStop()
}

// one check of statusCheckRollup: a CheckRun (name, status, conclusion) or a StatusContext (context, state)
function checkOf(c: any): Check {
  const s = String(c.conclusion || c.state || '').toUpperCase()
  const state: Check['state'] = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s)
    ? 'fail'
    : (c.status && c.status !== 'COMPLETED') || s === 'PENDING' || s === 'EXPECTED'
      ? 'pending'
      : ['SKIPPED', 'NEUTRAL', 'STALE'].includes(s)
        ? 'skip'
        : 'pass'
  return { name: c.name || c.context || '?', state, url: c.detailsUrl || c.targetUrl || undefined }
}

// all of a PR's checks in one word: fail if any failed, else pending if any runs, else pass
const checksOf = (list: Check[]): PR['checks'] =>
  !list.length ? '' : list.some(c => c.state === 'fail') ? 'fail' : list.some(c => c.state === 'pending') ? 'pending' : 'pass'

let prScan: Promise<void> | null = null
let prAgain = false
export function scanPRs(): Promise<void> {
  if (prScan) {
    prAgain = true // asked mid-scan (e.g. a ship just opened a PR): scan again when this one ends
    return prScan
  }
  // workspaces in parallel: each gh call may take seconds
  const live = state.workspaces.filter(ws => !ws.archived && ws.kind === 'worktree' && existsSync(ws.path))
  prScan = Promise.all(live.map(scanPR)).then(() => {
    prScan = null
    if (prAgain) {
      prAgain = false
      return scanPRs()
    }
  })
  return prScan
}

const PR_FIELDS = 'number,state,url,title,author,isDraft,headRefOid,reviewDecision,additions,deletions,body,updatedAt,statusCheckRollup'

async function scanPR(ws: Workspace) {
  let pr: PR
  try {
    const { stdout } = await run('gh', ['pr', 'view', ws.branch, '--json', PR_FIELDS], { cwd: ws.path, timeout: 20000 })
    const j = JSON.parse(stdout)
    const list: Check[] = (j.statusCheckRollup ?? []).map(checkOf)
    pr = {
      number: j.number,
      state: j.state,
      url: j.url,
      checks: checksOf(list),
      list,
      title: j.title,
      author: j.author?.login,
      draft: j.isDraft,
      head: j.headRefOid,
      review: j.reviewDecision || undefined,
      additions: j.additions,
      deletions: j.deletions,
      body: typeof j.body === 'string' ? j.body.slice(0, 4000) : undefined,
      updated: j.updatedAt,
    }
  } catch {
    if (prs.delete(ws.id)) changed()
    return
  }
  if (JSON.stringify(prs.get(ws.id)) !== JSON.stringify(pr)) {
    prs.set(ws.id, pr)
    changed()
  }
  await autoPR(ws, pr).catch(e => log(`autoPR ${ws.id}: ${e.message}`))
}

// ---------- PR feedback to the agent: failing CI, review comments (from wb's fix-ci / fix-review)

const MAX_CI_FIXES = 3 // in a row, one per pushed commit; then it's over to you

// autoPR, after each scan of an open PR: with autoFix, failing CI goes to the agent once per commit (3
// times in a row at most); with autoReview, new review comments do. Either way it's asked to push.
async function autoPR(ws: Workspace, pr: PR) {
  if (pr.state !== 'OPEN' || !(ws.autoFix || ws.autoReview)) return
  const f: PRFix = ws.fix?.pr === pr.number ? { ...ws.fix } : { pr: pr.number }
  if (ws.autoFix) {
    if (pr.checks === 'pass') f.tries = 0
    else if (pr.checks === 'fail' && pr.head && pr.head !== f.ci) {
      const tries = (f.tries ?? 0) + 1
      if (tries > MAX_CI_FIXES) {
        const tab = agentOf(ws)
        if (tab && tries === MAX_CI_FIXES + 1) {
          rtOf(tab.id).status = 'waiting' // ◆: over to you, once
          broadcast({ ev: 'turn', tab: tab.id, ws: ws.id, kind: 'waiting', text: `CI still fails after ${MAX_CI_FIXES} fixes` })
        }
        Object.assign(f, { ci: pr.head, tries })
      } else if (await prFix({ ws: ws.id, what: 'ci', push: true }).then(() => true, e => (log(`fix ci ${ws.id}: ${e.message}`), false)))
        Object.assign(f, { ci: pr.head, tries }) // recorded once sent: no agent yet means the next scan tries again
    }
  }
  if (ws.autoReview) {
    const t = await reviewThreads(ws.path, pr.number).catch(() => null)
    const k = t && reviewKey(t.threads, t.me)
    if (t && k !== null && newReview(k, f.review))
      try {
        tellAgent(ws, reviewMessage(pr, t.threads, true))
        f.review = k
      } catch (e) {
        log(`fix review ${ws.id}: ${(e as Error).message}`)
      }
    else if (k !== null) f.review = k // resolved threads drop out of the key
  }
  if (JSON.stringify(f) !== JSON.stringify(ws.fix)) {
    ws.fix = f
    save()
    changed()
  }
}

// the workspace's agent: the first claude or codex tab
const agentOf = (ws: Workspace) => tabsOf(ws.id).find(t => hasHooks(t) && sessions.get(t.id) && !sessions.get(t.id)!.exited)

// tellAgent types text into the workspace's agent, now or when its turn ends
function tellAgent(ws: Workspace, text: string) {
  const tab = agentOf(ws)
  if (!tab) throw new Error(`${ws.id} has no running agent (claude or codex)`)
  return send({ target: tab.id, text, whenIdle: true })
}

const pushAsk = (push: boolean) => (push ? 'commit and push the fix, then say what you changed' : 'say what you changed')

// prFix sends the PR's failing CI (with the end of the failed GitHub Actions logs) or its open review
// comments to the workspace's agent
export async function prFix(o: { ws: string; what: 'ci' | 'review'; push?: boolean }) {
  const ws = findWs(o.ws)
  const pr = prs.get(ws.id)
  if (!pr) throw new Error(`${ws.id} has no PR`)
  if (o.what === 'review') {
    const { threads } = await reviewThreads(ws.path, pr.number)
    const msg = reviewMessage(pr, threads, !!o.push)
    if (!msg) throw new Error(`no open review comments on PR #${pr.number}`)
    return tellAgent(ws, msg)
  }
  // gh exits non-zero while checks fail
  const { stdout } = await run('gh', ['pr', 'checks', String(pr.number), '--json', 'name,bucket,link'], { cwd: ws.path, timeout: 20000 }).catch(e => ({ stdout: String(e.stdout ?? '') }))
  const failing = (JSON.parse(stdout.trim() || '[]') as { name: string; bucket: string; link: string }[]).filter(c => c.bucket === 'fail')
  if (!failing.length) throw new Error(`no failing checks on PR #${pr.number}`)
  let body = ''
  let logs = 0
  for (const c of failing) {
    body += `\n## ${c.name}\n${c.link}\n`
    const job = c.link?.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1]
    if (job && logs < 3) {
      const out = await run('gh', ['run', 'view', '--job', job, '--log-failed'], { cwd: ws.path, timeout: 30000, maxBuffer: 32 << 20 }).then(r => r.stdout, () => '')
      const tail = out
        .trimEnd()
        .split('\n')
        .slice(-80)
        .map(l => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/^[^\t]*\t[^\t]*\t\S+ ?/, ''))
        .join('\n')
        .trim()
      if (tail) {
        logs++
        body += `End of the failed steps' log (all of it: gh run view --job ${job} --log-failed):\n${tail}\n`
      }
    }
  }
  return tellAgent(ws, `CI fails on PR #${pr.number} (${pr.url}). Find the cause and fix it, run what you can locally, then ${pushAsk(!!o.push)}.\n${body}`)
}

type Comment = { author: { login: string; __typename?: string } | null; authorAssociation?: string; body: string }
type Thread = { id: string; isResolved: boolean; isOutdated: boolean; path: string; line: number | null; comments: { nodes: Comment[] } }

// comments an agent may act on: from people with write access to the repo, or bots (review tools). Anyone
// can comment on a public PR, and the agent is told to change code and push.
const trusted = (c: Comment) => c.author?.__typename === 'Bot' || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation ?? '')

const REVIEW_QUERY = `query($owner: String!, $repo: String!, $pr: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) { pullRequest(number: $pr) { reviewThreads(first: 100) { nodes {
    id isResolved isOutdated path line
    comments(first: 30) { nodes { author { login __typename } authorAssociation body } }
  } } } }
}`

// a PR's review threads, and who you are on GitHub
async function reviewThreads(cwd: string, pr: number): Promise<{ threads: Thread[]; me: string }> {
  const { stdout } = await run('gh', ['api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `pr=${pr}`, '-f', `query=${REVIEW_QUERY}`], { cwd, timeout: 20000 }).catch(e => {
    throw new Error(`gh couldn't read the review comments: ${String(e.stderr || '').trim().split('\n')[0] || 'it failed'}`)
  })
  const d = JSON.parse(stdout).data
  const threads: Thread[] | undefined = d?.repository?.pullRequest?.reviewThreads?.nodes
  if (!threads) throw new Error(`no review threads for PR #${pr} (gh api graphql)`)
  return { threads: threads.map(t => ({ ...t, comments: { nodes: t.comments.nodes.filter(trusted) } })), me: d.viewer.login }
}

// the open threads with how many comments others left on each ("id:n id:n"); your own comments don't
// count: the agent comments as you, and its replies must not start another round
export const reviewKey = (threads: Thread[], me: string) =>
  threads
    .map(t => [t, t.comments.nodes.filter(c => c.author?.login !== me).length] as const)
    .filter(([t, n]) => !t.isResolved && n > 0)
    .map(([t, n]) => `${t.id}:${n}`)
    .join(' ')

// a thread or reply in key that wasn't there when the last one was sent
export const newReview = (key: string, sent = '') => key.split(' ').some(t => t && !sent.split(' ').includes(t))

// ponytail: inline threads only, not review summaries or plain PR comments
function reviewMessage(pr: PR, threads: Thread[], push: boolean) {
  const open = threads.filter(t => !t.isResolved && t.comments.nodes.length)
  if (!open.length) return ''
  const items = open.map((t, i) => {
    const where = `${t.path}${t.line ? `:${t.line}` : ''}${t.isOutdated ? ' (outdated: the code moved since)' : ''}`
    const said = t.comments.nodes.map(c => `   @${c.author?.login ?? '?'}: ${c.body.trim().replace(/\n/g, '\n   ')}`).join('\n')
    return `\n${i + 1}. ${where}\n${said}`
  })
  return `Address the open review comments on PR #${pr.number} (${pr.url}). Fix what you agree with; then ${pushAsk(push)}, and what you didn't and why.\n${items.join('\n')}`
}

// a turn that ended without a hook (an interrupt, a resumed chat's recap): running, no output for a
// while and no "esc to interrupt" on screen (claude and codex show it while they work) means idle
export function sweepRunning(now = Date.now()) {
  for (const t of state.tabs) {
    const s = sessions.get(t.id)
    const r = rt.get(t.id)
    if (!s || s.exited || r?.status !== 'running' || !hasHooks(t) || now - s.lastOutput < 4000) continue
    if (/esc to interrupt/i.test(s.screenText(15))) continue
    r.status = 'idle'
    changed()
    if (t.queue?.length) setTimeout(() => deliver(t.id), 800) // what waited for this turn's end (autoPR's too)
  }
}

// ---------- diff, dev server, ship

export async function diff(ref: string) {
  const ws = findWs(ref)
  let from = 'HEAD'
  if (ws.kind === 'worktree') from = await git(ws.path, 'merge-base', ws.base, 'HEAD').catch(() => 'HEAD')
  const [text, numstat, untracked] = await Promise.all([
    git(ws.path, 'diff', '--no-color', '--no-ext-diff', '-M', from),
    git(ws.path, 'diff', '--numstat', '-M', from),
    git(ws.path, 'ls-files', '--others', '--exclude-standard'),
  ])
  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [add, del, ...p] = l.split('\t')
      return { path: p.join('\t'), add: Number(add) || 0, del: Number(del) || 0, status: 'M' }
    })
  let out = text
  const newFiles = untracked.split('\n').filter(Boolean).slice(0, 100)
  const diffs = await Promise.all(
    newFiles.map(f =>
      run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: ws.path, maxBuffer: 16 << 20 }).then(
        r => r.stdout,
        e => String(e.stdout ?? ''), // exit 1: there are differences
      ),
    ),
  )
  for (const [i, f] of newFiles.entries()) {
    const d = diffs[i]
    out += (out ? '\n' : '') + d.trimEnd()
    files.push({ path: f, add: d.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length, del: 0, status: 'A' })
  }
  const MAX = 4 << 20
  return { base: ws.base, from, files, diff: out.length > MAX ? out.slice(0, MAX) + '\n… (cut)' : out }
}

function replaceTab(wsRef: string, kind: Tab['kind'], cmd: string, env?: Record<string, string>) {
  const ws = findWs(wsRef)
  for (const t of tabsOf(ws.id).filter(t => t.kind === kind)) closeTab(t.id)
  const tab: Tab = { id: randomUUID().slice(0, 8), workspace: ws.id, name: kind, kind, cmd }
  state.tabs.push(tab)
  save()
  spawnTab(tab, { cmd, env })
  return tab
}

export function runDev(ref: string) {
  const ws = findWs(ref)
  const cmd = projectConfig(ws).run
  if (!cmd) throw new Error('no "run" command: set one in the project settings or .laki.json')
  return replaceTab(ws.id, 'dev', cmd)
}

export function ship(ref: string, message: string) {
  const ws = findWs(ref)
  if (ws.kind !== 'worktree') throw new Error('ship works on worktree workspaces')
  if (!message?.trim()) throw new Error('a commit message is needed')
  const script = [
    'set -e',
    'git add -A',
    'git diff --cached --quiet || git commit -m "$LAKI_MSG"',
    'git push -u origin "$LAKI_BRANCH"',
    'gh pr view "$LAKI_BRANCH" --json url -q .url 2>/dev/null || gh pr create --fill',
  ].join('\n')
  const tab = replaceTab(ws.id, 'ship', script, { LAKI_MSG: message, LAKI_BRANCH: ws.branch })
  sessions.get(tab.id)!.onExit = () => {
    changed()
    scanPRs()
  }
  return tab
}

// ---------- files: the side panel's tree, changed files marked

// a path in the workspace; ponytail: by name only, a symlink inside may still point out
function inside(ws: Workspace, rel: string) {
  const abs = resolve(ws.path, rel)
  if (!rel.trim() || !abs.startsWith(ws.path + '/')) throw new Error(`${rel}: not a path inside the workspace`)
  return abs
}

const MAX_FILES = 50000

// files lists the workspace's files (git's: tracked and untracked, not ignored; a plain folder's: all
// but dependencies), and how the changed ones changed: M, A (new), D, R
export async function files(ref: string) {
  const ws = findWs(ref)
  if (!existsSync(join(ws.path, '.git'))) {
    const out: string[] = []
    const walk = (dir: string) => {
      let es: Dirent[]
      try {
        es = readdirSync(join(ws.path, dir), { withFileTypes: true })
      } catch {
        return // unreadable: left out
      }
      for (const e of es) {
        if (out.length >= MAX_FILES) return
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) !SKIP_DIRS.has(e.name) && walk(rel)
        else out.push(rel)
      }
    }
    walk('')
    return { files: out, changed: {}, cut: out.length >= MAX_FILES }
  }
  const z = (args: string[]) => run('git', args, { cwd: ws.path, maxBuffer: 64 << 20 }).then(r => r.stdout.split('\0'))
  const [list, st] = await Promise.all([z(['ls-files', '-z', '--cached', '--others', '--exclude-standard']), z(['status', '--porcelain', '-z', '--untracked-files=all'])])
  const changed: Record<string, string> = {}
  for (let i = 0; i < st.length; i++) {
    const [xy, path] = [st[i].slice(0, 2), st[i].slice(3)]
    if (!path) continue
    changed[path] = xy === '??' ? 'A' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : xy.includes('A') ? 'A' : 'M'
    if (xy.includes('R') || xy.includes('C')) i++ // the old name follows
  }
  const all = [...new Set(list.filter(Boolean))]
  return { files: all.slice(0, MAX_FILES), changed, cut: all.length > MAX_FILES }
}
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'target', 'dist', 'build', '.venv', '__pycache__'])

export function fileNew(o: { ws: string; path: string; dir?: boolean }) {
  const ws = findWs(o.ws)
  const abs = inside(ws, o.path)
  if (existsSync(abs)) throw new Error(`${o.path} is there already`)
  mkdirSync(o.dir ? abs : dirname(abs), { recursive: true })
  if (!o.dir) writeFileSync(abs, '', { flag: 'wx' })
  return { path: abs.slice(ws.path.length + 1) }
}

const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp' }
const MAX_TEXT = 512 << 10

// fileRead: a file for the preview: text (the first 512 KB), an image (up to 10 MB), or only its size
export function fileRead(o: { ws: string; path: string }) {
  const abs = inside(findWs(o.ws), o.path)
  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`${o.path} isn't a file`)
  const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
  if (mime) return st.size > 10 << 20 ? { size: st.size } : { size: st.size, image: `data:${mime};base64,${readFileSync(abs).toString('base64')}` }
  let buf = Buffer.alloc(Math.min(st.size, MAX_TEXT))
  const fd = openSync(abs, 'r')
  try {
    buf = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)) // less when it shrank since statSync
  } finally {
    closeSync(fd)
  }
  if (buf.subarray(0, 8000).includes(0)) return { size: st.size } // binary
  return { size: st.size, text: buf.toString('utf8'), cut: st.size > MAX_TEXT || undefined }
}

// prThreads: the PR's review threads, for the side panel
export async function prThreads(ref: string) {
  const ws = findWs(ref)
  const pr = prs.get(ws.id)
  if (!pr) return []
  const { threads } = await reviewThreads(ws.path, pr.number)
  return threads.map(t => ({
    path: t.path,
    line: t.line ?? undefined,
    resolved: t.isResolved,
    outdated: t.isOutdated,
    comments: t.comments.nodes.map(c => ({ author: c.author?.login ?? 'ghost', body: c.body })),
  }))
}

export function screen(target: string, lines = 30) {
  const tab = resolveTarget(target)
  const s = sessions.get(tab.id)
  return s ? s.flushed().then(() => s.screenText(lines)) : ''
}
