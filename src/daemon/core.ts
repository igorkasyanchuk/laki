// The daemon's model: projects, workspaces (git worktrees), tabs (PTY sessions), agent status from hooks,
// the follow-up queue, ports and PRs. One process owns it all; clients get `View`s pushed on every change.
import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { askOf } from '../shared/ask.ts'
import { chmodSync, closeSync, copyFileSync, type Dirent, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { dataDir } from '../shared/conn.ts'
import { AGENTS, API, type Agent, type Check, type Doctor, EFFORTS, fillTemplate, type FixWhat, type PR, PR_PROMPTS, PR_SCAN, PR_TRIES, type PRFix, type Preset, type Proc, type Project, type ProjectConfig, REMOTE, type Remote, type RunAction, type Schedule, type ScheduleRun, type Settings, type Stat, type State, type Status, type Tab, type TabView, type Template, type Todo, type Tunnel, type View, type Webhook, type Workspace, isAgent } from '../shared/types.ts'
import { nextRun, parseWhen, stamp, wsTitle } from '../shared/when.ts'
import { limitReset } from './limits.ts'
import { pushTo } from './push.ts'
import { type Client, Session } from './session.ts'

const run = promisify(execFile)

export const dir = dataDir()
const statePath = join(dir, 'state.json')
const runDir = join(dir, 'run')
export const shell = process.env.SHELL || userInfo().shell || '/bin/zsh'

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

// the agents to start: Settings' presets, or each agent as it is: claude and codex, and the others found on PATH
// ponytail: looked for once; one installed later shows after a daemon restart, or added in Settings
let found: Preset[] | undefined
const onPath = (cmd: string) => (process.env.PATH ?? '').split(':').some(d => d && existsSync(join(d, cmd)))
export const presets = (): Preset[] => state.settings?.presets ?? (found ??= AGENTS.filter(a => a === 'claude' || a === 'codex' || onPath(a)).map(a => ({ name: a, agent: a })))
const presetNamed = (name?: string) => (name ? presets().find(p => p.name === name) : undefined)
const presetOf = (t: Tab) => presetNamed(t.profile ?? t.preset)

export let state: State = { projects: [], workspaces: [], tabs: [] }
export const sessions = new Map<string, Session>()
type Runtime = { status: Status; done: boolean; limit?: number; last?: string; seen?: number; escAt?: number; since?: number; hooked?: boolean; runAt?: number; askKey?: string } // askKey: the ask the last pushed view gave
const rt = new Map<string, Runtime>()
const ports = new Map<string, number[]>()
const procs = new Map<string, Record<number, Proc>>() // what listens on each port, by workspace (scanPorts)
const prs = new Map<string, PR>()
export type Conn = Client & { view?: { tab: string | null; tabs?: string[]; focused: boolean; browse?: boolean } } // browse: the app's window, which has the agent browser
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
  state.schedules ??= []
  state.runs ??= []
  state.todos ??= []
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
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/ // what an env var's name may be (settings, projects, a host's script)
const hookCmd = (st: string) => [...cliEnv, ...cliArgv.map(q), 'hook', st].join(' ')

// where an agent's hook files are, and the command its hooks run (`<argv> hook <state>`): this Mac's `laki hook`, or
// an SSH host's script (hostHooks)
type Hooks = { dir: string; argv: string[]; cmd: (st: string) => string }
const localHooks: Hooks = { dir, argv: ['/usr/bin/env', ...cliEnv, ...cliArgv], cmd: hookCmd }

// how an agent's hooks reach `laki hook`: claude's settings file, gemini's, opencode's plugin (by their path in h.dir)
function hookFiles(h: Hooks): Record<string, string> {
  const c = (st: string, matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: h.cmd(st), timeout: 5 }] }]
  const settings = {
    hooks: {
      SessionStart: c('start'),
      UserPromptSubmit: c('running'),
      PreToolUse: c('running', '*'),
      PostToolUse: c('running', '*'),
      // permission prompts and questions, not the 60s idle reminder
      Notification: c('waiting', 'permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input'),
      Stop: c('idle'),
      StopFailure: c('failed'),
    },
  }
  // gemini's (versions with hooks, in a folder it trusts): the same states; a hook must print JSON, or gemini waits on it
  const g = (st: string) => [{ hooks: [{ type: 'command', command: `${h.cmd(st)} >/dev/null 2>&1; echo '{}'` }] }] // laki hook ends within 1s
  const gemini = { hooks: { SessionStart: g('start'), BeforeAgent: g('running'), AfterTool: g('running'), Notification: g('waiting'), AfterAgent: g('idle') } }
  return {
    'claude-settings.json': JSON.stringify(settings, null, 2),
    'gemini-settings.json': JSON.stringify(gemini, null, 2),
    'opencode/plugin/laki.js': OPENCODE_PLUGIN.replace('HOOK', () => JSON.stringify(h.argv)),
  }
}

export function writeHooks() {
  for (const [f, text] of Object.entries(hookFiles(localHooks))) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), text)
  }
}

// opencode's events as claude's hooks: a session (not a subagent's) made, busy, asking, idle
const OPENCODE_PLUGIN = `// Laki's plugin (Laki writes it): tells Laki when this tab's turns start and end
import { execFile } from 'node:child_process'
const hook = HOOK
export const LakiPlugin = async ({ client }) => {
  if (!process.env.LAKI_TAB || globalThis.__laki) return {}
  globalThis.__laki = true
  let last = Promise.resolve() // one report at a time, in order: running then waiting must not arrive swapped
  const report = (state, payload = {}) =>
    (last = last.then(async () => {
      const p = typeof payload === 'function' ? await payload().catch(() => ({})) : payload
      await new Promise(done => execFile(hook[0], [...hook.slice(1), 'hook', state, JSON.stringify(p)], () => done()))
    }))
  // the session's last answer, for the notification
  const answer = async id => {
    const { data = [] } = await client.session.messages({ path: { id } })
    const m = data.findLast(m => m.info?.role === 'assistant')
    return { last_assistant_message: (m?.parts ?? []).filter(x => x.type === 'text').map(x => x.text).join('\\n') }
  }
  const subagents = new Set()
  let now = 'idle'
  // a state once: failed or interrupted end the turn, so the idle that follows them says nothing
  const to = (state, payload) => {
    const k = state === 'running' || state === 'waiting' ? state : 'idle'
    return k !== now && ((now = k), report(state, payload))
  }
  return {
    event: async ({ event }) => {
      const p = event.properties ?? {}
      const id = p.sessionID ?? p.info?.id
      if (event.type === 'session.created') return p.info?.parentID ? subagents.add(id) : report('start', { session_id: id })
      if (!id || subagents.has(id)) return
      const t = event.type === 'session.status' ? 'session.' + p.status?.type : event.type
      if (t === 'session.busy') to('running')
      else if (t === 'session.idle') to('idle', () => answer(id))
      else if (t === 'session.error' && p.error?.name === 'MessageAbortedError') to('interrupted') // Esc
      else if (t === 'session.error') to('failed', { error: p.error?.data?.message ?? p.error?.message })
      else if (t === 'permission.asked' || t === 'question.asked') to('waiting')
    },
    'tool.execute.after': async input => now === 'waiting' && !subagents.has(input?.sessionID) && to('running'), // answered
  }
}
`

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

// an agent whose turns Laki follows: by its hooks (HOOKED), or by its screen (sweepRunning)
export const tracked = (t: Tab) => t.kind === 'agent' && isAgent(t.preset)
// a hook, notify or plugin says when a turn ends; gemini's do in versions that have hooks (Runtime.hooked: one came)
const HOOKED = new Set(['claude', 'codex', 'opencode'])
// what an agent shows while it works, on screen or in its window title: a quiet screen without it means the turn is over
const BUSY: Record<string, RegExp> = {
  claude: /esc to interrupt/i,
  codex: /esc to interrupt/i,
  gemini: /esc to cancel|working…/i,
  grok: /^[^\n]* - (thinking|responding|running|compacting|waiting)\b/i, // its title (the first line): "⠋ - Thinking - <session> - grok"
  opencode: /esc (again to )?interrupt/i,
}
const ASKS = /action required/i // gemini's and grok's title while a permission prompt waits
const QUIET = 4000

export function view(): View {
  const tabs: TabView[] = state.tabs.map(t => {
    const s = sessions.get(t.id)
    const r = rtOf(t.id)
    const status: Status = !s || s.exited ? 'exited' : tracked(t) ? r.status : 'idle'
    // a turn's start, seen here: every change of status comes with changed(), which builds a view within 30 ms
    if (status === 'running' || status === 'waiting') r.runAt ??= Date.now()
    else r.runAt = undefined
    if (status === 'running') pushed.delete(t.id) // its next wait or end pushes again
    const ask = status === 'waiting' && s ? askOf(s.screenText(16)) : undefined
    return { ...t, status, code: s?.exited ? s.exitCode : undefined, done: r.done, limit: r.limit, last: r.last, runAt: r.runAt, ask }
  })
  return {
    projects: state.projects,
    // ponytail: run and portNames read .laki.json per workspace on every view; cache by mtime if many workspaces
    workspaces: state.workspaces.map(w => {
      const c = projectConfig(w)
      const portNames = c.ports && typeof c.ports === 'object' ? Object.fromEntries(Object.entries(c.ports).filter(([, v]) => typeof v === 'string')) : undefined // a repo's file: strings only
      return { ...w, setup: existsSync(setupMarker(w)), ports: ports.get(w.id) ?? [], procs: procs.get(w.id), portNames, tunnels: tunnelsOf(w.id), pr: prs.get(w.id), run: !!c.run, stat: stats.get(w.id) }
    }),
    tabs,
    presets: presets(),
    settings: state.settings ?? {},
    remote: remoteView(),
    schedules: state.schedules,
    runs: state.runs?.slice(0, RUNS_SHOWN),
    todos: state.todos,
    api: API,
  }
}

let pending: NodeJS.Timeout | null = null
export function changed() {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const v = view()
    for (const t of v.tabs) rtOf(t.id).askKey = JSON.stringify(t.ask ?? null) // what the clients were given
    for (const w of state.workspaces) worked(w.id, v.tabs.some(t => t.workspace === w.id && t.status === 'running'))
    for (const c of clients) c.send({ ev: 'state', view: v })
  }, 30)
}

const broadcast = (msg: unknown) => clients.forEach(c => c.send(msg))

// when each workspace's agents worked (the last 50 stretches): comments under your name made then are the agent's
// ponytail: in memory, so a daemon restart forgets them; a comment the agent left just before one may start a round
const busy = new Map<string, { from: number; to?: number }[]>()
function worked(ws: string, on: boolean) {
  const w = busy.get(ws) ?? []
  const open = w.length > 0 && w.at(-1)!.to === undefined
  if (on && !open) busy.set(ws, [...w.slice(-49), { from: Date.now() }])
  else if (!on && open) w.at(-1)!.to = Date.now()
}
const SKEW = 10_000 // GitHub's clock and ours, and a gh call that ends as a permission prompt's wait does
const agentSaid = (ws: string, at: string) => {
  const t = Date.parse(at)
  return (busy.get(ws) ?? []).some(b => t >= b.from - SKEW && t <= (b.to ?? Infinity) + SKEW)
}

// tabs: every pane on screen; tab: the focused one (older clients send only that)
const shown = (v: { tab: string | null; tabs?: string[] }) => v.tabs ?? (v.tab ? [v.tab] : [])
const viewed = (tab: string) => [...clients].some(c => c.view?.focused && shown(c.view).includes(tab))

export function setView(c: Conn, v: { tab: string | null; tabs?: string[]; focused: boolean; browse?: boolean }) {
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
  const p = state.projects.find(p => p.id === ref || p.name === ref || (p.host ? `${p.host}:${p.path}` === ref : p.path === abs))
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

type At = { path: string; host?: string } // a folder on this Mac, or on an SSH host

async function git(at: At, ...args: string[]): Promise<string> {
  const { stdout } = await exec(at, 'git', args)
  return stdout.trim()
}

// a command in a folder: here, or on its SSH host (with the PATH its login shell has)
async function exec(at: At, cmd: string, args: string[], o: { timeout?: number; maxBuffer?: number } = {}) {
  if (!at.host) return run(cmd, args, { cwd: at.path, maxBuffer: 64 << 20, ...o })
  const h = await hostUp(at.host)
  return slot(at.host, () => run('ssh', [...sshOpts(at.host!), at.host!, `export PATH=${q(h.path)}; cd ${q(at.path)} && exec ${[cmd, ...args].map(q).join(' ')}`], { maxBuffer: 64 << 20, ...o }))
}

export async function branches(projectRef: string) {
  const p = findProject(projectRef)
  if (p.git === false) return { current: '', branches: [] }
  const [current, list] = await Promise.all([git(p, 'rev-parse', '--abbrev-ref', 'HEAD'), git(p, 'branch', '--format=%(refname:short)')])
  return { current, branches: list.split('\n').filter(Boolean) }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')

// four random letters or digits: what tells two workspaces of one name apart (fix-login-k3x9)
const tail = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0')

// uniqueWsId: an id no workspace, worktree dir or kept laki/<id> branch (wsRm keeps branches) uses yet; a taken one
// gets a random tail
async function uniqueWsId(want: string, proj?: Project) {
  const base = want || `ws-${tail()}`
  const taken = async (id: string) =>
    state.workspaces.some(w => w.id === id) ||
    (!!proj &&
      ((await hasDir(proj, id)) ||
        (await git(proj, 'rev-parse', '--verify', '--quiet', `refs/heads/${branchPrefix()}${id}`).then(
          () => true,
          () => false,
        ))))
  let id = base
  while (await taken(id)) id = `${base}-${tail()}`
  return id
}

// a worktree's folder there already (one an earlier Laki left)
const hasDir = async (proj: Project, id: string) =>
  proj.host
    ? exec({ host: proj.host, path: '/' }, 'test', ['-e', `${(await hostUp(proj.host)).dir}/worktrees/${proj.id}/${id}`]).then(() => true, () => false)
    : existsSync(join(dir, 'worktrees', proj.id, id))

// allocPort: 3100 + n*10, the first not taken by another live workspace
export function allocPort() {
  const used = new Set(state.workspaces.filter(w => !w.archived).map(w => w.port))
  let port = 3100
  while (used.has(port)) port += 10
  return port
}

// .laki.json from the workspace (as checked out), else from the project root (works before it's committed); a fork's
// PR's never (its setup would run a stranger's code): the root's. The project's own config (set in the app) wins field
// by field
export function projectConfig(ws: Workspace): ProjectConfig {
  const proj = state.projects.find(p => p.id === ws.project)
  let file: ProjectConfig = {}
  for (const d of [ws.fork ? undefined : ws.path, proj?.path]) {
    if (!d) continue
    if (ws.host) {
      const c = hostCfg.get(`${ws.host}:${d}`) // read there (readHostCfg): views ask often
      if (c) {
        file = c
        break
      }
      continue
    }
    try {
      file = JSON.parse(readFileSync(join(d, '.laki.json'), 'utf8'))
      break
    } catch {}
  }
  const { env, actions: _, templates: __, ...cmds } = proj?.config ?? {} // actions, templates: the renderer's (Run ▾, a new workspace's prompt)
  const own = Object.fromEntries(Object.entries(cmds).filter(([, v]) => typeof v === 'string' && v.trim()))
  return { ...file, ...own, env: { ...file.env, ...env } }
}

// the .laki.json a project's root has, for the settings dialog's placeholders
export async function projectFileConfig(ref: string): Promise<ProjectConfig> {
  const p = findProject(ref)
  if (p.host) return (await readHostCfg(p), hostCfg.get(`${p.host}:${p.path}`) ?? {})
  try {
    return JSON.parse(readFileSync(join(p.path, '.laki.json'), 'utf8'))
  } catch {
    return {}
  }
}

// a project's prompt templates as kept: a name and a text each
const templatesOk = (l: unknown): Template[] | undefined => {
  const ok = (Array.isArray(l) ? l : []).filter((t): t is Template => typeof t?.name === 'string' && typeof t.text === 'string')
  return ok.length ? ok.map(t => ({ name: t.name, text: t.text })) : undefined
}

// a project's actions as kept: for an agent or a shell (an unfinished one too, as Settings has it: Run ▾ skips it)
function actionsOk(l: unknown): RunAction[] | undefined {
  const ok = (Array.isArray(l) ? l : []).filter((a): a is RunAction => typeof a?.name === 'string' && typeof a.text === 'string' && (a.target === 'shell' || isAgent(a.target)))
  return ok.length ? ok.map(a => ({ name: a.name, target: a.target, text: a.text })) : undefined
}

export function projectSet(ref: string, o: { name?: string; config?: ProjectConfig }) {
  const p = findProject(ref)
  if (o.name?.trim()) p.name = o.name.trim()
  if (o.config) {
    const env = Object.fromEntries(Object.entries(o.config.env ?? {}).filter(([k]) => ENV_KEY.test(k)))
    p.config = {
      setup: o.config.setup?.trim() || undefined,
      teardown: o.config.teardown?.trim() || undefined,
      run: o.config.run?.trim() || undefined,
      expose: o.config.expose?.trim() || undefined,
      actions: actionsOk(o.config.actions),
      templates: templatesOk(o.config.templates),
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
  const remote = REMOTE.exec(path.trim())
  if (remote && !existsSync(path)) return hostProjectAdd(remote[1], remote[2])
  const abs = resolve(path)
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${path} is not a folder`)
  const top = await git({ path: abs }, 'rev-parse', '--show-toplevel').catch(() => '')
  const root = top || realpathSync(abs)
  const existing = state.projects.find(p => !p.host && p.path === root)
  if (existing) return existing
  return projectPush({ id: '', name: basename(root), path: root, git: !!top })
}

// a folder on an SSH host (host:path; a relative path or ~ is from its home): a repository's top level, or the folder
async function hostProjectAdd(host: string, path: string): Promise<Project> {
  const h = await hostUp(host)
  const want = path.startsWith('/') ? path : `${h.home}/${path.replace(/^~(\/|$)/, '')}`
  const where = 'cd "$1" 2>/dev/null || { echo "no folder $1" >&2; exit 1; }; echo "$(git rev-parse --show-toplevel 2>/dev/null)"; pwd -P'
  const { stdout } = await exec({ host, path: '/' }, 'sh', ['-c', where, 'sh', want], { timeout: 30000 }).catch(e => {
    throw new Error(`${host}:${path}: ${String(e.stderr || e.message).trim().split('\n').at(-1)}`)
  })
  const [top, real] = stdout.split('\n')
  const root = top || real
  if (!root?.startsWith('/')) throw new Error(`${host}:${path} is not a folder`)
  const existing = state.projects.find(p => p.host === host && p.path === root)
  if (existing) return existing
  const p = projectPush({ id: '', name: `${basename(root)} (${host})`, path: root, git: !!top, host }) // told apart from one here in every list
  void readHostCfg(p).then(changed)
  return p
}

function projectPush(p: Project) {
  const base = slug(p.name) || 'project'
  p.id = base
  for (let n = 2; state.projects.some(x => x.id === p.id); n++) p.id = `${base}-${n}`
  state.projects.push(p)
  save()
  changed()
  return p
}

export function projectRm(ref: string) {
  const p = findProject(ref)
  // worktrees, and the folder's sessions scheduled tasks made (their own agents): delete them first
  const live = state.workspaces.filter(w => w.project === p.id && (w.kind === 'worktree' || w.schedule) && !w.archived)
  if (live.length) throw new Error(`${p.name} has workspaces: delete them first (${live.map(w => w.id).join(', ')})`)
  for (const w of state.workspaces.filter(w => w.project === p.id)) dropWs(w)
  state.projects = state.projects.filter(x => x !== p)
  state.schedules = state.schedules?.filter(s => s.project !== p.id) // its tasks go with it
  state.todos = state.todos?.filter(t => t.project !== p.id) // and its board's to-dos
  if (p.host && !state.projects.some(x => x.host === p.host)) void hosts.get(p.host)?.then(h => h.master.kill(), () => {}) // its host's last
  save()
  changed()
}

// ---------- SSH hosts: a project on another machine (host:path, as scp writes it). One ssh connection per host (a
// ControlMaster the daemon keeps) carries git and gh; each tab has its own (ssh -tt). Nothing of Laki's runs there but a hook
// script, which reports a turn as an escape code on the tab's own terminal (spawnTab's onHook): no way back into this
// Mac. Sign-in is ssh's own (keys, agent, ~/.ssh/config), never a prompt (BatchMode). A workspace's $PORT here reaches
// its $PORT there (forward).

type HostRun = { dir: string; home: string; path: string; master: ChildProcess } // dir: this Mac's folder there; path: its login PATH
const hosts = new Map<string, Promise<HostRun>>()
// this Mac's folder on hosts (two Macs on one host keep apart): named once and kept, since macOS's hostname changes
// with the network
let macName: string | undefined
function mac() {
  if (macName) return macName
  const f = join(dir, 'ssh', 'mac')
  try {
    macName = readFileSync(f, 'utf8').trim()
  } catch {}
  if (!macName) {
    macName = slug(hostname().replace(/\.local$/, '')) || 'mac'
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
    writeFileSync(f, macName)
  }
  return macName
}
const ctlOf = (host: string) => join(dir, 'ssh', createHash('sha1').update(host).digest('hex').slice(0, 16)) // a socket's path: short
// ServerAlive: one that connects by itself (the master just gone) still ends when the network does
const sshOpts = (host: string) => ['-S', ctlOf(host), '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
// a tab's own connection: sshd takes 10 sessions per connection (MaxSessions), which tabs on the master would use up
const TAB_SSH = ['-o', 'ControlPath=none', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', '-o', 'LogLevel=ERROR', '-tt'] // LogLevel: no "Connection … closed."

// a host's commands through its connection, 8 at a time (MaxSessions: 10); a finished one hands its slot over
const SLOTS = 8
const slots = new Map<string, { n: number; queue: (() => void)[] }>()
async function slot<T>(host: string, f: () => Promise<T>): Promise<T> {
  let b = slots.get(host)
  if (!b) slots.set(host, (b = { n: 0, queue: [] }))
  if (b.n < SLOTS) b.n++
  else await new Promise<void>(r => b!.queue.push(r))
  try {
    return await f()
  } finally {
    const next = b.queue.shift()
    if (next) next()
    else b.n--
  }
}

// ssh's failure as a line you can act on
function sshSays(host: string, err: string) {
  const last = err.trim().split('\n').filter(l => l.trim() && !/^warning:/i.test(l)).at(-1) ?? ''
  if (/host key verification failed|remote host identification/i.test(err)) return `ssh ${host}: its host key isn't known (or changed): ssh ${host} once in a terminal`
  if (/permission denied/i.test(last)) return `ssh ${host}: ${last}. Laki signs in with your SSH keys or agent, never a password`
  return `ssh ${host}: ${last || "can't connect"}`
}

// the host's connection, made once (a failure stands 10 s: the tabs that asked at once get one answer, and a host
// that's down isn't tried at every scan)
export function hostUp(host: string): Promise<HostRun> {
  let p = hosts.get(host)
  if (!p) {
    hosts.set(host, (p = connect(host)))
    p.catch(() => setTimeout(() => hosts.get(host) === p && hosts.delete(host), 10_000))
  }
  return p
}

async function connect(host: string): Promise<HostRun> {
  const ctl = ctlOf(host)
  mkdirSync(dirname(ctl), { recursive: true, mode: 0o700 })
  await run('ssh', ['-S', ctl, '-O', 'exit', host], { timeout: 5000 }).catch(() => {}) // one a crashed daemon left
  const mine = hosts.get(host) // this connection's (hostUp set it before the first await)
  let up = false
  const master = spawn('ssh', ['-M', '-N', '-S', ctl, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', host], { stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  let gone = false
  master.stderr!.on('data', d => (err = (err + d).slice(-4000)))
  master.on('error', e => ((err += e.message), (gone = true)))
  master.on('close', () => (gone = true))
  master.on('exit', () => {
    if (!up) return // connect's own failure: hostUp keeps it 10 s
    log(`ssh ${host}: disconnected`)
    if (hosts.get(host) === mine) hosts.delete(host) // the next use connects again
  })
  try {
    for (let i = 0; !(await run('ssh', ['-S', ctl, '-O', 'check', host], { timeout: 5000 }).then(() => true, () => false)); i++) {
      if (gone || i > 120) throw new Error(sshSays(host, err))
      await new Promise(r => setTimeout(r, 250))
    }
    const sh = (cmd: string, timeout = 20000) => run('ssh', [...sshOpts(host), host, cmd], { timeout }).then(r => r.stdout)
    const home = (await sh('printf %s "$HOME"')).trim()
    if (!home.startsWith('/')) throw new Error(`ssh ${host}: no home folder there`)
    // its login shell's PATH (gh and agents may be where only a profile says), as adoptLoginPath does here
    const login = await sh(`"$SHELL" -lic 'printf "__LAKI__%s__LAKI__" "$PATH"' </dev/null 2>/dev/null`, 10000).catch(() => '')
    const h: HostRun = { dir: `${home}/.laki-host/${mac()}`, home, path: login.match(/__LAKI__(.*)__LAKI__/)?.[1] || '/usr/local/bin:/usr/bin:/bin', master }
    await sshIn(host, 'sh -s', hostFiles(h.dir))
    if (master.exitCode !== null || master.signalCode !== null) throw new Error(sshSays(host, err || 'disconnected'))
    up = true
    for (const w of state.workspaces) if (w.host === host && !w.archived) forward(w)
    log(`ssh ${host}: connected (${h.dir})`)
    return h
  } catch (e) {
    master.kill()
    throw e
  }
}

export function stopHosts() {
  for (const p of hosts.values()) void p.then(h => h.master.kill(), () => {})
}

// a command on the host with input on its stdin (a script, a file: never on a command line, which ps there shows)
function sshIn(host: string, cmd: string, input: string | Buffer, timeout = 60000): Promise<string> {
  return slot(
    host,
    () =>
      new Promise((resolve, reject) => {
        const p = execFile('ssh', [...sshOpts(host), host, cmd], { timeout, maxBuffer: 16 << 20 }, (e, out, err) => (e ? reject(new Error(sshSays(host, String(err || e.message)))) : resolve(String(out))))
        p.stdin!.on('error', () => {}) // ssh gone early: its exit says why
        p.stdin!.end(input)
      }),
  )
}

// the hook on a host: a turn's state as OSC 7717 on its tab's terminal (LAKI_TTY, LAKI_HOOK: hostTab's), which the
// daemon reads off the stream; as `laki hook`, the payload is an argument (codex, opencode) or stdin (claude, gemini)
const HOST_HOOK = `#!/bin/sh
# Laki's hook (Laki on your Mac writes it): an agent's turn, as an escape code on its tab's terminal, where Laki reads it
[ "$1" = hook ] && shift
[ -n "$LAKI_TTY" ] && [ -n "$LAKI_HOOK" ] || exit 0
# running needs no payload (PreToolUse's holds whole files: too much for a terminal); else stdin read for 1 s at most,
# so a hook never holds the agent up
if [ "$1" = running ]; then p={}; elif [ -n "$2" ]; then p=$2; elif [ ! -t 0 ]; then exec 3<&0; p=$(cat <&3 & c=$!; (sleep 1; kill $c) >/dev/null 2>&1 & wait $c); fi
[ -n "$p" ] || p={}
printf '\\033]7717;%s;%s;%s\\007' "$LAKI_HOOK" "$1" "$(printf %s "$p" | base64 | tr -d '\\n')" >"$LAKI_TTY" 2>/dev/null
exit 0
`
const hostHooks = (d: string): Hooks => ({ dir: d, argv: [`${d}/hook`], cmd: st => `${q(`${d}/hook`)} ${st}` })

// a script that puts the hook and the agents' files that run it in d (heredocs: the files' text never on a command line)
function hostFiles(d: string) {
  const files = { hook: HOST_HOOK, ...hookFiles(hostHooks(d)) }
  const put = Object.entries(files).flatMap(([f, text]) => [`mkdir -p ${q(dirname(`${d}/${f}`))}`, `cat > ${q(`${d}/${f}`)} <<'LAKI_EOF'`, text.replace(/\n$/, ''), 'LAKI_EOF'])
  // tab scripts no tab ran (closed first): they hold env values
  return ['set -e', 'umask 077', ...put, `chmod 700 ${q(`${d}/hook`)}`, `rm -f ${q(`${d}/run`)}/*.sh`, ''].join('\n')
}

// a script for the host's sh: the workspace's folder, Laki's env (exported: its values stay off command lines), then cmd
const hostScript = (ws: Workspace, env: Record<string, string>, cmd: string, pre: string[] = []) =>
  [...pre, `cd ${q(ws.path)} || exit 1`, ...Object.entries(env).filter(([k]) => ENV_KEY.test(k)).map(([k, v]) => `export ${k}=${q(v)}`), cmd, ''].join('\n')

// a tab on an SSH host: what its PTY runs here. Meanwhile the host's connection comes up and the tab's script goes
// there (its folder, env and command); the PTY waits for that (<run>/<key>.go), then runs it with ssh -tt on a
// connection of its own (TAB_SSH), or prints why it can't (<key>.err)
function hostTab(ws: Workspace, tab: Tab, o: SpawnOpts, hookKey: string) {
  const key = `${tab.id}-${randomUUID().slice(0, 6)}`
  const f = join(runDir, key)
  void (async () => {
    const h = await hostUp(ws.host!)
    await readHostCfgs(ws, false) // after a daemon restart: its env and setup
    const prompt = await toHost(ws.host!, h, o.prompt)
    const cmd = tab.kind === 'shell' ? undefined : (o.cmd ?? (tab.kind === 'agent' ? agentCmd(tab, prompt, !!o.resume, hostHooks(h.dir)) : tab.cmd || 'true'))
    const env = { ...lakiEnv(ws, tab, o.env, h.dir), LAKI_HOOK: hookKey }
    const script = hostScript(ws, env, cmd === undefined ? 'exec "$SHELL" -l' : `exec "$SHELL" -lic ${q(cmd)}`, ['rm -f "$0"', 'LAKI_TTY=$(tty) && export LAKI_TTY'])
    await sshIn(ws.host!, `umask 077 && mkdir -p ${q(`${h.dir}/run`)} && cat > ${q(`${h.dir}/run/${key}.sh`)}`, script)
    await spaced(ws.host!)
    writeFileSync(`${f}.go`, '')
  })().catch(e => writeFileSync(`${f}.err`, `\x1b[31m${(e as Error).message}\x1b[0m\r\n`))
  return [
    `f=${q(f)}`,
    'while [ ! -e "$f.go" ]; do [ -e "$f.err" ] && { cat "$f.err"; rm -f "$f.err"; exit 255; }; sleep 0.1; done',
    'rm -f "$f.go"',
    `exec ssh ${[...TAB_SSH, ws.host!, `exec sh "$HOME/.laki-host/${mac()}/run/${key}.sh"`].map(q).join(' ')}`,
  ].join('\n')
}

// tabs' own connections start 300 ms apart per host: sshd drops handshakes past 10 at once (MaxStartups), as a daemon
// restart with many tabs would make. ponytail: a fixed pace, not a count of handshakes under way
const opened = new Map<string, Promise<void>>()
function spaced(host: string) {
  const turn = opened.get(host) ?? Promise.resolve()
  opened.set(host, turn.then(() => new Promise(r => setTimeout(r, 300))))
  return turn
}

// pasted images and the preview's screenshots are files on this Mac: a host's agent gets copies there, by their paths
async function toHost(host: string, h: HostRun, text?: string) {
  const images = `${join(dir, 'images')}/`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const p of new Set(text?.match(new RegExp(`${images}[\\w-]+\\.[A-Za-z]+`, 'g')) ?? [])) {
    const there = `${h.dir}/images/${basename(p)}`
    try {
      await sshIn(host, `umask 077 && mkdir -p ${q(`${h.dir}/images`)} && cat > ${q(there)}`, readFileSync(p))
      text = text!.split(p).join(there)
    } catch (e) {
      log(`ssh ${host}: ${p}: ${(e as Error).message}`)
    }
  }
  return text
}

// a host's workspace's $PORT here reaches its $PORT there, through the connection: its preview, Open in browser,
// Expose to the world and the agent browser work as they do here. ponytail: $PORT only, not ports a dev server picks
// itself (the status bar lists none of a host's)
function forward(ws: Workspace, on = true) {
  if (!ws.host || !ws.port || !hosts.has(ws.host)) return
  const L = `${ws.port}:localhost:${ws.port}`
  run('ssh', ['-S', ctlOf(ws.host), '-O', on ? 'forward' : 'cancel', '-L', L, ws.host], { timeout: 10000 }).catch(e => log(`ssh ${ws.host}: ${on ? 'forward' : 'cancel'} -L ${L}: ${String(e.stderr || e.message).trim()}`))
}

// .laki.json of folders on SSH hosts, read there when a project or workspace comes, a tab starts (once) and at each PR
// scan: projectConfig runs in every view. null: none there (or not JSON)
const hostCfg = new Map<string, ProjectConfig | null>() // by host:path
async function readHostCfg(at: At) {
  const text = await exec(at, 'sh', ['-c', 'cat .laki.json 2>/dev/null; true'], { timeout: 20000 }).then(r => r.stdout, () => undefined)
  if (text === undefined) return // the host unreachable: what was read last stays
  try {
    hostCfg.set(`${at.host}:${at.path}`, text.trim() ? JSON.parse(text) : null)
  } catch {
    hostCfg.set(`${at.host}:${at.path}`, null)
  }
}
// a host workspace's: its folder's and its project's (fresh: again, else only those not read yet)
const readHostCfgs = (ws: Workspace, fresh = true) =>
  Promise.all(
    [...new Set([ws.path, state.projects.find(p => p.id === ws.project)?.path ?? ws.path])]
      .filter(path => fresh || !hostCfg.has(`${ws.host}:${path}`))
      .map(path => readHostCfg({ host: ws.host, path })),
  )

// ---------- tabs

function childEnv(ws: Workspace, tab: Tab, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('ELECTRON_') || k.startsWith('LAKI_') || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    env[k] = v
  }
  return { ...env, ...lakiEnv(ws, tab, extra) }
}

// what Laki adds to a tab's environment: over this Mac's (childEnv), or all of it on an SSH host (hostScript); hooks:
// where its agents' hook files are
function lakiEnv(ws: Workspace, tab: Tab, extra: Record<string, string> = {}, hooks = dir): Record<string, string> {
  return {
    ...state.settings?.env, // Settings → General: every session's
    ...projectConfig(ws).env,
    ...presetOf(tab)?.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'laki',
    LAKI_WORKSPACE: ws.id,
    LAKI_TAB: tab.id,
    PORT: String(ws.port),
    ...(!ws.host && { LAKI_HOME: dir }), // the laki CLI's: there's none on a host
    LAKI_PROJECT_PATH: state.projects.find(p => p.id === ws.project)?.path ?? ws.path, // the repo itself: setup copies .env etc. from it
    // ponytail: these replace one the user set
    ...(tab.preset === 'opencode' && { OPENCODE_CONFIG_DIR: join(hooks, 'opencode') }), // Laki's plugin, on top of the user's config
    ...(tab.preset === 'gemini' && { GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(hooks, 'gemini-settings.json') }), // the lowest layer; hooks add up
    ...extra,
  }
}

function agentCmd(tab: Tab, prompt: string | undefined, resume: boolean, h = localHooks): string {
  const pr = presetOf(tab)
  const again = resume && tab.resumeId // its chat, again
  let argv: string[]
  let ask = prompt && !resume ? [prompt] : [] // how the first prompt goes in: last, or after a flag
  if (tab.preset === 'claude') {
    argv = ['claude', '--settings', join(h.dir, 'claude-settings.json')]
    if (again) argv.push('--resume', again)
    else if (tab.forkOf && !tab.resumeId) argv.push('--resume', tab.forkOf, '--fork-session')
  } else if (tab.preset === 'codex') {
    argv = again ? ['codex', 'resume', again] : ['codex']
    // notify runs when a turn ends; a JSON string array is a TOML one too. ~/.codex stays untouched.
    argv.push('-c', 'notify=' + JSON.stringify([...h.argv, 'hook', 'done']))
  } else if (tab.preset === 'gemini') {
    argv = again ? ['gemini', '--resume', again] : ['gemini']
    if (ask.length) ask = ['-i', ...ask] // a bare prompt would answer it and exit
  } else if (tab.preset === 'grok') {
    // grok takes the id of a new chat, so the tab knows its chat from the start
    if (!again) (tab.resumeId = randomUUID()), save()
    argv = ['grok', again ? '--resume' : '--session-id', tab.resumeId!]
  } else if (tab.preset === 'opencode') {
    argv = again ? ['opencode', '--session', again] : ['opencode']
    if (ask.length) ask = ['--prompt', ...ask] // its positional is a folder
  } else {
    return (pr?.agent === 'command' && pr.cmd?.trim()) || tab.cmd || 'true'
  }
  // the tab's model and effort (only claude and codex take one: EFFORTS), after the preset's args: picked for this
  // workspace, they win over a preset's own
  const flags = [...(tab.model ? [tab.preset === 'claude' ? '--model' : '-m', tab.model] : []), ...(tab.effort ? (tab.preset === 'claude' ? ['--effort', tab.effort] : ['-c', `model_reasoning_effort=${JSON.stringify(tab.effort)}`]) : [])]
  // a preset's args go in as written (a shell runs the line), before the prompt
  return [argv.map(q).join(' '), pr?.args?.trim(), flags.map(q).join(' '), ask.map(q).join(' ')].filter(Boolean).join(' ')
}

type SpawnOpts = { cmd?: string; prompt?: string; resume?: boolean; env?: Record<string, string> }

export function spawnTab(tab: Tab, o: SpawnOpts = {}) {
  const ws = findWs(tab.workspace)
  if (!ws.host && !existsSync(ws.path)) throw new Error(`${ws.path} is gone`)
  const marker = setupMarker(ws)
  const wait = tab.kind === 'agent' && existsSync(marker) ? `printf '\\033[2mwaiting for the setup script (see the setup tab)…\\033[0m\\r\\n'; while [ -e ${q(marker)} ]; do sleep 0.3; done; ` : ''
  let file = shell
  let args: string[]
  const hookKey = ws.host ? randomBytes(12).toString('hex') : undefined // what its hooks' escape codes carry (hostTab)
  if (ws.host) [file, args] = ['/bin/sh', ['-c', wait + hostTab(ws, tab, o, hookKey!)]]
  else if (tab.kind === 'shell') args = ['-l']
  else args = ['-lic', wait + (o.cmd ?? (tab.kind === 'agent' ? agentCmd(tab, o.prompt, !!o.resume) : tab.cmd || 'true'))]
  sessions.get(tab.id)?.kill()
  const s = new Session(tab.id, file, args, { cwd: ws.host ? dir : ws.path, env: childEnv(ws, tab, o.env), ...lastSize })
  sessions.set(tab.id, s)
  const r = rtOf(tab.id)
  // a hook on the host: OSC 7717 ; key ; state ; base64 JSON. Only with this start's key: a file shown in the tab
  // can't make one up
  if (hookKey)
    s.onHook = d => {
      const [key, st, b64 = ''] = d.split(';')
      if (key !== hookKey || !st) return
      let payload = {}
      try {
        payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8') || '{}')
      } catch {}
      hook({ tab: tab.id, state: st, payload })
    }
  // a waiting tab's ask is read off its screen: what it prints (the menu drawn late, moved, answered from the keyboard)
  // is read again 300 ms later, and a view goes out only when the ask isn't the one the last view gave
  let asking: ReturnType<typeof setTimeout> | undefined
  s.onOutput = () => {
    if (r.status !== 'waiting' || asking) return
    asking = setTimeout(() => {
      asking = undefined
      if (r.status === 'waiting' && JSON.stringify(askOf(s.screenText(16)) ?? null) !== r.askKey) changed()
    }, 300)
  }
  r.status = o.prompt && !o.resume ? 'running' : 'idle'
  r.since = undefined // a turn started by a prompt, not by Enter (input): it always notifies
  r.done = false
  s.onExit = code => {
    if (tab.kind === 'setup') rmSync(setupMarker(ws), { force: true })
    // `exit` closes a shell's tab, a clean exit an agent's; one we ended (close, restart, archive, shutdown) is no longer in
    // sessions. A host's shell that lost its connection (ssh's 255) stays: Enter starts it again
    if (((tab.kind === 'shell' && (!ws.host || code !== 255)) || (tab.kind === 'agent' && code === 0)) && sessions.get(tab.id) === s && state.tabs.includes(tab)) return closeTab(tab.id)
    changed()
    if (tab.kind !== 'agent' && tab.kind !== 'dev' && !(ws.host && tab.kind === 'shell')) return
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
const CHAT_GONE = /no (conversation|saved session|session|rollout)\b[^\n]*found|(conversation|session|thread)\b[^\n]*not found|invalid session identifier|session does not exist/i

// why addTab would refuse an agent: checked before wsNew makes a worktree for it
function presetCheck(preset?: string, cmd?: string) {
  if (preset === 'custom' && !cmd?.trim()) throw new Error('custom preset: command missing')
  if (preset && !isAgent(preset) && preset !== 'shell' && preset !== 'custom' && !presetNamed(preset))
    throw new Error(`unknown preset ${preset} (see Settings: Agent presets)`)
}

// a model and effort for an agent's flags: a name (it goes on the command line, quoted), an effort it takes
function modelCheck(agent: string, model?: string, effort?: string) {
  if (model && !/^(?!-)[\w.:/@[\]-]{1,120}$/.test(model)) throw new Error(`model ${model}? a name like opus, or provider/model`) // not a flag either
  if (effort && !EFFORTS[agent as Agent]?.includes(effort)) throw new Error(EFFORTS[agent as Agent] ? `effort ${effort}? ${EFFORTS[agent as Agent]!.join(', ')}` : `${agent} takes no effort`)
}

export function addTab(wsRef: string, o: { kind?: Tab['kind']; preset?: string; cmd?: string; name?: string; prompt?: string; forkOf?: string; model?: string; effort?: string }): Tab {
  const ws = findWs(wsRef)
  if (!o.kind) presetCheck(o.preset, o.cmd)
  const pr = o.kind ? undefined : presetNamed(o.preset)
  if (pr?.agent === 'command') o = { ...o, cmd: pr.cmd || 'true' }
  const preset = pr ? (pr.agent === 'command' ? 'custom' : pr.agent) : o.preset || (o.cmd ? 'custom' : 'shell')
  const kind = o.kind ?? (preset === 'shell' && !o.cmd ? 'shell' : 'agent')
  const model = isAgent(preset) && kind === 'agent' ? o.model?.trim() || undefined : undefined // a shell or a command has no model
  const effort = isAgent(preset) && kind === 'agent' ? o.effort || undefined : undefined
  modelCheck(preset, model, effort)
  let name = o.name || pr?.name || (kind === 'agent' ? (preset === 'custom' ? basename(o.cmd!.split(/\s/)[0]) : preset) : kind)
  const base = name
  for (let n = 2; tabsOf(ws.id).some(t => t.name === name); n++) name = `${base} ${n}`
  const tab: Tab = { id: randomUUID().slice(0, 8), workspace: ws.id, name, kind, ...(kind === 'agent' ? { preset } : {}), ...(pr ? { profile: pr.name } : {}), ...(o.cmd ? { cmd: o.cmd } : {}), ...(o.forkOf ? { forkOf: o.forkOf } : {}), ...(model && { model }), ...(effort && { effort }) }
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

// answer: a choice of the menu a waiting agent shows (n, or the first or last), as its arrows and Enter would pick it;
// one at a time per tab, and not again for a second after (a double click, Allow and a click: the menu isn't redrawn yet)
const answering = new Set<string>()
export async function answer(p: { tab: string; n?: number; pick?: 'first' | 'last' }) {
  const t = findTab(p.tab)
  const s = sessions.get(t.id)
  if (!s || s.exited) throw new Error(`${t.name} isn't running`)
  if (rtOf(t.id).status !== 'waiting') throw new Error(`${t.name} isn't asking anything now`)
  if (answering.has(t.id)) throw new Error(`${t.name} is being answered`)
  answering.add(t.id)
  try {
    await s.flushed()
    const a = askOf(s.screenText(16))
    if (!a) throw new Error(`${t.name} isn't asking anything with choices now`)
    const n = p.n ?? (p.pick === 'last' ? a.options.at(-1)!.n : a.options[0].n)
    if (!a.options.some(o => o.n === n)) throw new Error(`${t.name} has no choice ${n}`)
    const key = `\x1b${s.appCursor ? 'O' : '['}${n > a.at ? 'B' : 'A'}`
    // one key at a time: a TUI reads a burst as one unknown key
    for (let i = 0; i < Math.abs(n - a.at); i++) input(t.id, key), await new Promise(r => setTimeout(r, 40))
    input(t.id, '\r')
    setTimeout(() => answering.delete(t.id), 1000)
    return { picked: a.options.find(o => o.n === n)!.label }
  } catch (e) {
    answering.delete(t.id)
    throw e
  }
}

// mark a tab unread: its ● again, until it's looked at
export function unread(id: string) {
  findTab(id)
  rtOf(id).done = true
  changed()
}

// rename a tab, or color it
export function tabSet(o: { id: string; name?: string; color?: string; muted?: boolean }) {
  const t = findTab(o.id)
  if (o.name?.trim()) t.name = o.name.trim().slice(0, 40)
  if (o.color !== undefined) t.color = o.color || undefined
  if (o.muted !== undefined) t.muted = o.muted || undefined
  save()
  changed()
  return t
}

// a workspace's sidebar color, name, notifications, and whether CI failures and review comments go to its agent
export function wsSet(o: { id: string; color?: string; name?: string; autoFix?: boolean; autoReview?: boolean; autoMerge?: boolean; muted?: boolean }) {
  const w = findWs(o.id)
  if (o.color !== undefined) w.color = o.color && o.color !== 'none' ? o.color : undefined
  if (o.name !== undefined) {
    const name = Array.from(o.name.trim()).slice(0, 60).join('') // by character: an emoji stays whole
    w.name = name && name !== w.id ? name : undefined // the id itself: back to it
  }
  // turned on again: fix CI and fix conflicts get their tries back at the next scan (autoPR: a scan under way would
  // write its own copy of ws.fix over a reset made here)
  if (o.autoFix && !w.autoFix && w.fix) retry.add(`${w.id}:ci`)
  if (o.autoMerge && !w.autoMerge && w.fix) retry.add(`${w.id}:merge`)
  if (o.autoFix !== undefined) w.autoFix = o.autoFix || undefined
  if (o.autoReview !== undefined) w.autoReview = o.autoReview || undefined
  if (o.autoMerge !== undefined) w.autoMerge = o.autoMerge || undefined
  if (o.muted !== undefined) w.muted = o.muted || undefined
  save()
  changed()
  if (o.autoFix || o.autoReview || o.autoMerge) scanPRs().catch(() => {}) // act on the PR as it is now (one scan at a time: no double sends)
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
  if (o.env) o = { ...o, env: Object.fromEntries(Object.entries(o.env).filter(([k]) => ENV_KEY.test(k))) }
  state.settings = { ...state.settings, ...o }
  save()
  changed()
  if ('diffStat' in o) void scanStats() // its numbers now, not at the next scan
  return state.settings
}

const branchPrefix = () => state.settings?.branchPrefix?.trim() || 'laki/'

// what a folder can open in, by macOS app name (open -a <app> <folder>)
export const APPS: Record<string, string> = {
  cursor: 'Cursor',
  zed: 'Zed',
  vscode: 'Visual Studio Code',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity',
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

// what a file can also open in (the Files panel's right click)
export const BROWSERS: Record<string, string> = {
  safari: 'Safari',
  chrome: 'Google Chrome',
  firefox: 'Firefox',
  arc: 'Arc',
  brave: 'Brave Browser',
  edge: 'Microsoft Edge',
}
const TERMINALS = ['terminal', 'iterm', 'warp', 'ghostty'] // a file opens its folder in them

// the apps installed (Finder and Terminal always are); browsers are only for files
export function apps() {
  const dirs = ['/Applications', '/System/Applications/Utilities', join(homedir(), 'Applications')]
  return Object.entries({ ...APPS, ...BROWSERS })
    .filter(([id, name]) => id === 'finder' || dirs.some(d => existsSync(join(d, `${name}.app`))))
    .map(([id, name]) => ({ id, name, ...(BROWSERS[id] && { browser: true }) }))
}

// open a workspace's (or a project's) folder, or a file in it, in an app; 'editor' is the one in Settings, 'default'
// macOS's for the file
export async function openIn(o: { ws?: string; project?: string; app: string; file?: string }) {
  const file = !!(o.file && o.ws)
  const path = file ? inside(findWs(o.ws!), o.file!) : o.ws ? findWs(o.ws).path : findProject(o.project ?? '').path
  const s = state.settings ?? {}
  const app = o.app === 'editor' ? s.editor || 'cursor' : o.app
  const fail = (e: any) => {
    throw new Error(String(e.stderr || e.message).trim().split('\n')[0])
  }
  const host = o.ws ? findWs(o.ws).host : findProject(o.project ?? '').host
  if (host) {
    // a folder or file on an SSH host: the editors with Remote - SSH open it there
    const scheme = ({ vscode: 'vscode', cursor: 'cursor', windsurf: 'windsurf' } as Record<string, string>)[app]
    if (!scheme) throw new Error(`${APPS[app] ?? BROWSERS[app] ?? 'That app'} can't open a folder on ${host}: Cursor, VS Code or Windsurf can (Remote - SSH)`)
    return void (await run('open', [`${scheme}://vscode-remote/ssh-remote+${host}${path.split('/').map(encodeURIComponent).join('/')}`]).catch(fail))
  }
  if (app === 'custom') {
    if (!s.editorCmd?.trim()) throw new Error('set the editor command in Settings (⌘,)')
    return void (await run(shell, ['-lc', `${s.editorCmd} "$1"`, 'editor', path], { timeout: 20000 }).catch(fail))
  }
  const name = APPS[app] ?? BROWSERS[app]
  if (!name && app !== 'default') throw new Error(`no app ${app}`)
  const args = app === 'default' || app === 'finder' ? [...(file && app === 'finder' ? ['-R'] : []), path] : ['-a', name, file && TERMINALS.includes(app) && !statSync(path, { throwIfNoEntry: false })?.isDirectory() ? dirname(path) : path]
  await run('open', args).catch(fail)
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

// another: a local workspace beside the one the folder has (a scheduled task's new session each run: a row of its own)
export type NewWs = { project: string; base?: string; preset?: string; cmd?: string; prompt?: string; name?: string; local?: boolean; another?: boolean; forkOf?: string; model?: string; effort?: string; race?: string; issue?: string; issued?: Workspace['issue']; pr?: string; fork?: boolean }

// gh's failure as a line you can act on: not installed, not signed in, not found
function ghSays(e: any, what: string) {
  const err = String(e.stderr || e.message)
  if (e.code === 'ENOENT') return "gh isn't installed: brew install gh, then gh auth login"
  if (/exec: gh: not found|gh: command not found|command not found: gh/.test(err)) return "gh isn't installed on the SSH host: install it there, then gh auth login" // exec's
  if (/gh auth login|not logged in|authenticat/i.test(err)) return "gh isn't signed in: run gh auth login"
  if (/could not resolve to a pull ?request|no pull requests found|not found/i.test(err)) return `${what} not found`
  return `gh: ${err.trim().split('\n')[0]}`
}

// --pr: a GitHub PR (its URL, or its number in the project's repo), through your gh
type PRHead = { number: number; title: string; url: string; headRefName: string; baseRefName: string; isCrossRepository: boolean; headRepositoryOwner?: { login: string } }
async function prHead(proj: Project, ref: string): Promise<PRHead> {
  const { stdout } = await exec(proj, 'gh', ['pr', 'view', '--json', 'number,title,url,headRefName,baseRefName,isCrossRepository,headRepositoryOwner', '--', ref], { timeout: 20000 }).catch(e => {
    throw new Error(ghSays(e, `PR ${ref}`))
  })
  return JSON.parse(stdout)
}

// --issue: a GitHub issue (its URL, or its number in the project's repo) through gh: the workspace's name, and its
// title, body and link ahead of the prompt
async function fromIssue(proj: Project, o: NewWs): Promise<NewWs> {
  if (!o.issue?.trim() || o.issued) return o
  const { stdout } = await exec(proj, 'gh', ['issue', 'view', '--json', 'number,title,body,url', '--', o.issue.trim()], { timeout: 20000 }).catch(e => {
    throw new Error(`gh issue view ${o.issue}: ${String(e.stderr || e.message).trim().split('\n')[0]}`)
  })
  const i = JSON.parse(stdout) as { number: number; title: string; body?: string; url: string }
  const body = (i.body ?? '').trim()
  const prompt = [`Work on GitHub issue #${i.number}: ${i.title}`, i.url, body.length > 8000 ? `${body.slice(0, 8000)}\n… (cut: the rest is on GitHub)` : body, o.prompt?.trim()].filter(Boolean).join('\n\n')
  return { ...o, prompt, name: o.name || `issue-${i.number}-${slug(i.title).slice(0, 24)}`.replace(/-+$/, ''), issued: { number: i.number, url: i.url, title: i.title } }
}

// a race: one prompt to several agents, each in a worktree of its own (named <name>-<preset>), one after another (git
// takes one worktree add at a time); Compare in the app lays them side by side
export async function wsFan(o: NewWs & { presets: string[] }): Promise<Workspace[]> {
  const proj = findProject(o.project)
  const presets = [...new Set((Array.isArray(o.presets) ? o.presets : []).map(p => String(p).trim()).filter(Boolean))]
  if (presets.length < 2) throw new Error('a race needs two agents or more')
  if (presets.length > 6) throw new Error('six agents at most')
  if (o.local || proj.git === false) throw new Error('a race needs worktrees: a git project, not Local')
  if (o.pr?.trim()) throw new Error("a race can't start from a PR: its branch is checked out once")
  for (const p of presets) {
    if (p === 'none' || p === 'shell') throw new Error(`${p} isn't an agent`)
    presetCheck(p)
    const agent = presetNamed(p)?.agent ?? p
    if (isAgent(agent)) modelCheck(agent, o.model?.trim(), o.effort) // all of them before any worktree
  }
  const base = await fromIssue(proj, o)
  const name = slug(base.name || (base.prompt ?? '').split(/\s+/).slice(0, 4).join(' ')) || 'race'
  const race = randomUUID().slice(0, 8)
  const made: Workspace[] = []
  for (const p of presets) made.push(await wsNew({ ...base, preset: p, name: `${name.slice(0, Math.max(8, 39 - p.length)).replace(/-+$/, '')}-${p}`, race }))
  return made
}

export async function wsNew(o: NewWs): Promise<Workspace> {
  const proj = findProject(o.project)
  const preset = o.preset || (o.cmd?.trim() ? 'custom' : state.settings?.agent || 'claude')
  if (preset !== 'none') presetCheck(preset, o.cmd)
  const agent = presetNamed(preset)?.agent ?? preset
  if (isAgent(agent)) modelCheck(agent, o.model?.trim(), o.effort) // before the worktree: a wrong one makes nothing
  o = await fromIssue(proj, o) // after the checks: they're instant, gh isn't
  const current = proj.git === false ? '' : await git(proj, 'rev-parse', '--abbrev-ref', 'HEAD')
  // a PR: the worktree on its head branch, named after it, its base the PR's, linked to it (by URL) for the PR status
  if (o.pr?.trim() && (o.local || proj.git === false)) throw new Error('a PR needs a worktree: a git project, not Local')
  const pr = o.pr?.trim() ? await prHead(proj, o.pr.trim()) : undefined
  // a fork's branch as <owner>/<branch> (gh's own name for a fork's main): never one of yours of the same name
  const local = pr && (pr.isCrossRepository && pr.headRepositoryOwner?.login ? `${pr.headRepositoryOwner.login}/${pr.headRefName}` : pr.headRefName)
  if (pr) {
    const have = state.workspaces.find(w => w.project === proj.id && !w.archived && w.kind === 'worktree' && w.branch === local)
    if (have) throw new Error(`PR #${pr.number}'s branch ${local} is already checked out in workspace ${have.id}`)
    if (current === local) throw new Error(`PR #${pr.number}'s branch ${local} is checked out in ${proj.path}: switch it to another branch first`)
    o = { ...o, name: o.name || `pr-${pr.number}-${slug(pr.title).slice(0, 24)}`.replace(/-+$/, '') }
  }
  let ws: Workspace
  if (o.local || proj.git === false) {
    const have = state.workspaces.find(w => w.project === proj.id && w.kind === 'local' && !w.schedule) // the folder's own, not a scheduled run's session
    if (have && !o.another) return have
    const id = await uniqueWsId(o.another ? slug(o.name || '') || proj.id : proj.id)
    ws = { id, project: proj.id, path: proj.path, ...(proj.host && { host: proj.host }), branch: current, base: current, kind: 'local', port: allocPort(), created: Date.now() }
  } else {
    const want = slug(o.name || (o.prompt ?? '').split(/\s+/).slice(0, 4).join(' '))
    const id = await uniqueWsId(want, proj)
    const path = proj.host ? `${(await hostUp(proj.host)).dir}/worktrees/${proj.id}/${id}` : join(dir, 'worktrees', proj.id, id)
    const at: At = { path, host: proj.host }
    let base = o.base || current
    let branch = `${branchPrefix()}${id}`
    if (!proj.host) mkdirSync(dirname(path), { recursive: true }) // git makes a host's
    const add = pr ? ['--detach', path] : [path, '-b', branch, base]
    await git(proj, 'worktree', 'add', ...add).catch(e => {
      throw new Error(`git worktree add failed: ${String(e.stderr || e.message).trim()}`)
    })
    if (pr) {
      // gh pr checkout makes the branch (from a fork too, with its remote) where the worktree is; by URL: a number
      // would be gh's default repo's
      await exec(at, 'gh', ['pr', 'checkout', pr.url, '--branch', local!], { timeout: 120000 }).catch(async e => {
        await git(proj, 'worktree', 'remove', '--force', path).catch(() => {})
        throw new Error(`gh pr checkout ${pr.number}: ${ghSays(e, `PR ${pr.number}`)}`)
      })
      branch = (proj.host ? await git(at, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '') : headOf(path)) || local! // as syncBranches reads it (rev-parse may say heads/<b> beside a remote's <b>)
      base = pr.baseRefName
      // a base you have no branch of (a release branch): origin's, for the diff
      const has = (ref: string) => git(at, 'rev-parse', '--verify', '--quiet', ref).then(Boolean, () => false)
      if (!(await has(`refs/heads/${base}`)) && (await has(`refs/remotes/origin/${base}`))) base = `origin/${base}`
    }
    ws = { id, project: proj.id, path, ...(proj.host && { host: proj.host }), branch, base, kind: 'worktree', port: allocPort(), created: Date.now(), ...(pr && { prUrl: pr.url }), ...((pr?.isCrossRepository || o.fork) && { fork: true }) }
    if (!proj.host) await copyIncludes(proj, ws) // before setup and the agent: they may read .env. ponytail: not on a host (setup can copy them from $LAKI_PROJECT_PATH)
  }
  if (proj.host) await readHostCfgs(ws) // its setup, env and ports
  if (o.race) ws.race = o.race
  if (o.issued) ws.issue = o.issued
  state.workspaces.push(ws)
  save()
  forward(ws)
  const cfg = projectConfig(ws)
  if (cfg.setup && ws.kind === 'worktree') {
    writeFileSync(setupMarker(ws), String(Date.now()))
    addTab(ws.id, { kind: 'setup', name: 'setup', cmd: cfg.setup })
  }
  try {
    if (preset !== 'none') addTab(ws.id, { preset, cmd: o.cmd, prompt: o.prompt, forkOf: o.forkOf, model: o.model, effort: o.effort })
  } finally {
    changed() // the workspace is made, even when its agent didn't start
  }
  return ws
}

// a real path (realpathSync's) in a real folder, or the folder itself
const within = (root: string, p: string) => p === root || p.startsWith(root + sep)

// files git doesn't keep (.env…) that a new worktree needs: what .worktreeinclude (gitignore-style, at the repo's root)
// and .laki.json's copy match in the main checkout (git ls-files does the matching), with their modes, before setup
// and the agent start. One already in the worktree stays; a symlink counts only when it points inside the repo. A
// failure is a line in daemon.log, not a failed workspace.
async function copyIncludes(proj: Project, ws: Workspace) {
  const list = projectConfig(ws).copy
  const pats = (Array.isArray(list) ? list : []).filter((p): p is string => typeof p === 'string' && !!p.trim()).map(p => `--exclude=${p.trim()}`)
  const file = join(proj.path, '.worktreeinclude')
  if (existsSync(file)) pats.push(`--exclude-from=${file}`)
  if (!pats.length) return
  const copied: string[] = []
  try {
    const root = realpathSync(proj.path)
    const to = realpathSync(ws.path)
    const out = await git(proj, 'ls-files', '-z', '--others', '--ignored', ...pats)
    for (const rel of out.split('\0').filter(Boolean)) {
      const dst = join(ws.path, rel)
      try {
        if (lstatSync(dst, { throwIfNoEntry: false })) continue
        const src = realpathSync(join(proj.path, rel))
        if (!within(root, src) || !statSync(src).isFile()) {
          log(`copy into ${ws.id}: skipped ${rel} (a link out of the repo, or not a file)`)
          continue
        }
        let up = dirname(dst) // its nearest folder there already: one the worktree links elsewhere gets nothing, not even a folder
        while (!existsSync(up)) up = dirname(up)
        if (!within(to, realpathSync(up))) continue
        mkdirSync(dirname(dst), { recursive: true })
        if (!within(to, realpathSync(dirname(dst)))) continue
        copyFileSync(src, dst)
        chmodSync(dst, statSync(src).mode & 0o7777)
        copied.push(rel)
      } catch (e) {
        log(`copy into ${ws.id}: ${rel}: ${(e as Error).message}`)
      }
    }
  } catch (e) {
    log(`copy into ${ws.id}: ${(e as Error).message}`)
  }
  if (copied.length) log(`copied into ${ws.id}: ${copied.join(', ')}`)
}

async function teardown(ws: Workspace) {
  stopTunnels(ws.id)
  forward(ws, false)
  for (const t of tabsOf(ws.id)) {
    sessions.get(t.id)?.kill()
    sessions.delete(t.id)
  }
  const cfg = projectConfig(ws)
  const none: Tab = { id: '', workspace: ws.id, name: '', kind: 'shell' }
  // a worktree's, as setup is: a local workspace is the project's own folder, which other sessions (and you) still use
  if (cfg.teardown && ws.kind === 'worktree' && ws.host)
    await hostUp(ws.host)
      .then(h => sshIn(ws.host!, 'sh -s', hostScript(ws, lakiEnv(ws, none, {}, h.dir), `exec "$SHELL" -lc ${q(cfg.teardown!)}`)))
      .catch(() => {})
  else if (cfg.teardown && ws.kind === 'worktree' && existsSync(ws.path))
    await run(shell, ['-lc', cfg.teardown], { cwd: ws.path, env: childEnv(ws, none), timeout: 60000 }).catch(() => {})
  if (ws.kind === 'worktree') {
    const proj = state.projects.find(p => p.id === ws.project)
    if (proj) await git(proj, 'worktree', 'remove', '--force', ws.path).catch(() => {})
    if (!ws.host) rmSync(ws.path, { recursive: true, force: true })
    else if (ws.path.includes(`/.laki-host/${mac()}/worktrees/`)) await exec({ host: ws.host, path: '/' }, 'rm', ['-rf', '--', ws.path]).catch(() => {}) // only one Laki made
    // after the dir is gone: drops the registration a failed remove left, which would block re-adding the branch
    if (proj) await git(proj, 'worktree', 'prune').catch(() => {})
  }
  rmSync(setupMarker(ws), { force: true })
}

function dropWs(ws: Workspace) {
  stopTunnels(ws.id)
  forward(ws, false)
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
// ifClean: only with nothing uncommitted (archiving removes the worktree, and that with it), else how many paths are
export async function wsArchive(ref: string, o: { ifClean?: boolean } = {}) {
  const ws = findWs(ref)
  if (ws.kind !== 'worktree') throw new Error('only worktree workspaces can be archived')
  if (ws.host) await hostUp(ws.host) // else teardown leaves the worktree there, and Restore fails on it
  if (o.ifClean && (ws.host || existsSync(ws.path))) {
    const dirty = (await git(ws, '--no-optional-locks', 'status', '--porcelain')).split('\n').filter(Boolean).length
    if (dirty) return { dirty }
  }
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
  await git(proj, 'worktree', 'add', ws.path, ws.branch).catch(e => {
    throw new Error(`git worktree add failed: ${String(e.stderr || e.message).trim()}`)
  })
  if (ws.host) await readHostCfgs(ws)
  else await copyIncludes(proj, ws) // archiving took them with the worktree
  ws.archived = false
  ws.port = allocPort()
  save()
  forward(ws)
  for (const t of tabsOf(ws.id)) spawnTab(t, { resume: true })
  changed()
  return ws
}

// ---------- the board's to-dos (Board.tsx): prompts waiting for a workspace; starting one is wsNew, then todoRm

export function todoAdd(o: { project: string; text: string }) {
  const p = findProject(o.project)
  const text = o.text?.trim()
  if (!text) throw new Error('a to-do needs its text')
  const t: Todo = { id: randomUUID().slice(0, 8), project: p.id, text, at: Date.now() }
  state.todos!.push(t)
  save()
  changed()
  return t
}

export function todoRm(o: { id: string }) {
  state.todos = state.todos!.filter(t => t.id !== o.id)
  save()
  changed()
}

// wsFork: a new workspace from this one's branch, its Claude chat forked (--fork-session).
export async function wsFork(ref: string) {
  const src = findWs(ref)
  const agent = tabsOf(src.id).find(t => t.preset === 'claude' && t.resumeId)
  return wsNew({ project: src.project, base: src.branch, name: `${src.id}-fork`, preset: agent ? (presetNamed(agent.profile) ? agent.profile : 'claude') : 'shell', forkOf: agent?.resumeId, model: agent?.model, effort: agent?.effort, fork: src.fork })
}

// restoreAll starts every tab of every live workspace after a daemon restart: agents resume their chat.
export function restoreAll() {
  for (const f of readdirSync(runDir)) if (/\.(setup|go|err)$/.test(f)) rmSync(join(runDir, f), { force: true }) // hostTab's too
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
  if (state.tabs.some(t => t.id === p.tab)) rtOf(p.tab).hooked = true
  turn(p)
}

// a turn's state, from a hook or from the screen (sweepRunning)
function turn(p: { tab: string; state: string; payload?: any }) {
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
      phone(tab, 'waiting', pl.message ?? '')
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
      const last = pl.last_assistant_message ?? pl['last-assistant-message'] ?? pl.prompt_response // claude's, codex's, gemini's
      if (last) {
        r.last = String(last)
        writeFileSync(join(runDir, `${tab.id}.last`), r.last)
      }
      const err = pl.error_details ?? pl.error ?? '' // a message as it is: quoted, a limit notice isn't read
      if (p.state === 'failed' || tab.preset === 'codex') checkLimit(tab, p.state === 'failed' ? `${last ?? ''}\n${typeof err === 'string' ? err : JSON.stringify(err)}` : '')
      if (!viewed(tab.id)) r.done = true
      broadcast({ ev: 'turn', tab: tab.id, ws: tab.workspace, kind: r.limit ? 'limit' : 'done', text: r.last ?? '' })
      if (!r.limit) phone(tab, 'done', r.last ?? '')
      if (!r.limit) setTimeout(() => deliver(tab.id), 800) // after the hook returns: the agent redraws its prompt
      prSoon()
      break
    }
    case 'interrupted':
      r.status = 'idle'
      break
  }
  changed()
}

// ---------- typing into agents, queue

// typeInto pastes text and presses Enter (enter: false leaves it in the prompt). One message at a time per tab: a
// queued delivery and a send at the same moment must not interleave their text and Enters.
const typing = new WeakMap<Session, Promise<void>>()
export function typeInto(s: Session, text: string | Promise<string>, enter = true) {
  const next = (typing.get(s) ?? Promise.resolve()).then(async () => {
    const t = (await text).replace(/\x1b(\[[0-?]*[ -/]*[@-~])?/g, '') // no escapes: a \x1b[201~ in it would end the paste and type the rest as keys
    await new Promise<void>(done => {
      s.write(s.term.modes.bracketedPasteMode ? `\x1b[200~${t}\x1b[201~` : enter ? t : t.replace(/[\r\n]+/g, ' '))
      if (!enter) return done()
      setTimeout(() => {
        s.write('\r') // as a separate key, so it isn't part of the paste
        setTimeout(done, 50)
      }, 150)
    })
  })
  typing.set(s, next)
  return next
}

// what's typed into a tab: on an SSH host, with the images it names copied there (toHost); never fails
function textFor(tab: Tab, text: string): string | Promise<string> {
  const host = state.workspaces.find(w => w.id === tab.workspace)?.host
  if (!host || !text.includes(join(dir, 'images'))) return text
  return hostUp(host).then(h => toHost(host, h, text).then(t => t ?? text), () => text)
}

// enter: false types it into the prompt for the user to finish (the preview's picked element): no turn starts
export function send(p: { target: string; text: string; whenIdle?: boolean; enter?: boolean }) {
  const tab = resolveTarget(p.target)
  const s = sessions.get(tab.id)
  if (!s || s.exited) throw new Error(`${tab.name} isn't running`)
  const r = rtOf(tab.id)
  if (p.enter === false) {
    if (r.status === 'waiting') throw new Error(`${tab.name} is asking you something: answer it first`) // the text would be keys to its question
    return typeInto(s, textFor(tab, p.text), false), { tab: tab.id, sent: true }
  }
  if (p.whenIdle) {
    if (!tracked(tab)) throw new Error(`${tab.name} doesn't report when it's done (agents do): send it now`)
    if (r.status !== 'idle' || r.limit || tab.queue?.length) {
      tab.queue = [...(tab.queue ?? []), p.text]
      save()
      changed()
      return { tab: tab.id, queued: tab.queue.length }
    }
  }
  typeInto(s, textFor(tab, p.text))
  if (tracked(tab)) r.status = 'running'
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
  typeInto(s, textFor(tab, msg))
  r.status = 'running'
  changed()
}

export function clearQueue(target: string) {
  const tab = resolveTarget(target)
  delete tab.queue
  save()
  changed()
}

// input from a client's keyboard. Agents but claude don't say when a turn starts: Enter does.
export function input(id: string, data: string, c?: Client) {
  const s = sessions.get(id)
  if (!s) return
  if (c) s.follow(c)
  const tab = state.tabs.find(t => t.id === id)
  if (s.exited && tab && (tab.kind === 'agent' || tab.kind === 'dev' || (tab.kind === 'shell' && state.workspaces.find(w => w.id === tab.workspace)?.host)) && data.includes('\r')) {
    spawnTab(tab, { resume: true }) // Enter on an ended agent or dev server (or a host's shell) starts it again
    return
  }
  s.write(data)
  if (tab && tracked(tab) && tab.preset !== 'claude' && data.includes('\r') && rtOf(id).status === 'idle') {
    // ponytail: Enter in an idle agent starts a turn (claude's hook says so itself); codex's notify ends it, the
    // others' quiet screen (sweepRunning)
    Object.assign(rtOf(id), { status: 'running', since: Date.now() })
    changed()
  }
  if (tab && tracked(tab) && (data === '\x1b' || data === '\x03')) interrupted(tab.id, s)
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

export function resize(id: string, cols: number, rows: number, c?: Client) {
  lastSize = { cols, rows }
  const s = sessions.get(id)
  if (c) s?.resizeFor(c, cols, rows)
  else s?.resize(cols, rows)
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

// the branch a workspace's folder is on now (HEAD's file, no git run): an agent may switch it (git checkout -b …), and
// the PR, the status bar, ship and restore follow; detached (a rebase): as it was
function headOf(path: string): string | undefined {
  try {
    let g = join(path, '.git')
    if (statSync(g).isFile()) g = resolve(path, readFileSync(g, 'utf8').match(/^gitdir: (.+)$/m)![1].trim()) // a worktree's
    return readFileSync(join(g, 'HEAD'), 'utf8').match(/^ref: refs\/heads\/(.+)$/m)?.[1].trim()
  } catch {}
}
function syncBranches() {
  let moved = false
  for (const w of state.workspaces) {
    if (w.archived || w.host || state.projects.find(p => p.id === w.project)?.git === false) continue // a host's: hostSync
    const b = headOf(w.path)
    if (!b || b === w.branch) continue
    moveBranch(w, b)
    moved = true
  }
  if (moved) save(), changed(), void scanPRs() // its PR now, not in a minute
}
function moveBranch(w: Workspace, b: string) {
  w.branch = b
  w.prUrl = undefined // nor the PR it started from
  prs.delete(w.id) // the old branch's PR isn't this one's
}

// a host's worktree at each PR scan: its branch (git there; syncBranches reads a HEAD file here) and its .laki.json.
// ponytail: a minute behind, not 5 s; a host's local workspace never moves
async function hostSync(ws: Workspace) {
  const [b] = await Promise.all([git(ws, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => ''), readHostCfg(ws)])
  if (!b || b === ws.branch) return
  moveBranch(ws, b)
  save()
  changed()
}

// a turn's end may have opened a PR (gh pr create): a scan soon, at most every 20 s
let prSoonAt = 0
function prSoon() {
  if (Date.now() - prSoonAt < 20000) return
  prSoonAt = Date.now()
  setTimeout(() => void scanPRs(), 2000)
}

export async function scanPorts() {
  syncBranches()
  const root = new Map<number, string>()
  for (const [id, s] of sessions) {
    const t = state.tabs.find(t => t.id === id)
    if (t && !s.exited) root.set(s.pty.pid, t.workspace)
  }
  const next = new Map<string, number[]>()
  const nextProcs = new Map<string, Record<number, Proc>>()
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
    const out = await run('lsof', ['-nP', '-a', '-p', [...owner.keys()].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpcn']).then(
      r => r.stdout,
      e => String(e.stdout ?? ''),
    )
    let pid = 0
    let cmd = ''
    for (const l of out.split('\n')) {
      if (l[0] === 'p') pid = Number(l.slice(1))
      else if (l[0] === 'c') cmd = l.slice(1)
      else if (l[0] === 'n') {
        const port = Number(l.slice(l.lastIndexOf(':') + 1))
        const ws = owner.get(pid)
        if (!ws || !port) continue
        if (!next.get(ws)?.includes(port)) next.set(ws, [...(next.get(ws) ?? []), port].sort((a, b) => a - b))
        nextProcs.set(ws, { ...nextProcs.get(ws), [port]: { pid, cmd } })
      }
    }
  }
  if (JSON.stringify([...next, ...nextProcs]) !== JSON.stringify([...ports, ...procs])) {
    ports.clear()
    procs.clear()
    for (const [k, v] of next) ports.set(k, v)
    for (const [k, v] of nextProcs) procs.set(k, v)
    changed()
  }
}

// the status bar's ✕ on a port: what listens there, found by the last scan in the workspace's own processes and yours
// (uid), gets SIGTERM, then SIGKILL 3 s later if it's still there; the ports are scanned again after each
export async function portKill(o: { ws: string; port: number }) {
  const ws = findWs(o.ws)
  const p = procs.get(ws.id)?.[Number(o.port)]
  if (!p) throw new Error(`nothing of ${ws.id}'s listens on :${o.port}`)
  // its owner and start time: the SIGKILL goes only to the same process, not one that took its pid since
  const who = () => run('ps', ['-o', 'uid=,lstart=', '-p', String(p.pid)]).then(r => r.stdout.trim(), () => '')
  // and that it still listens there: the scan is up to 5 s old, and a pid may be another process's by now
  const listens = run('lsof', ['-nP', '-a', '-p', String(p.pid), `-iTCP:${Number(o.port)}`, '-sTCP:LISTEN', '-t']).then(r => !!r.stdout.trim(), () => false)
  const [was, still] = await Promise.all([who(), listens])
  if (!still) {
    void scanPorts()
    throw new Error(`${p.cmd} (pid ${p.pid}) no longer listens on :${o.port}`)
  }
  if (was.split(/\s+/)[0] !== String(process.getuid?.())) throw new Error(`${p.cmd} (pid ${p.pid}) isn't yours to stop`)
  try {
    process.kill(p.pid, 'SIGTERM')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e // ESRCH: it ended on its own, as asked
  }
  setTimeout(() => void scanPorts(), 500)
  setTimeout(async () => {
    if ((await who()) === was) {
      try {
        process.kill(p.pid, 'SIGKILL')
        log(`port ${o.port}: ${p.cmd} (pid ${p.pid}) outlived SIGTERM, killed`)
      } catch {}
    }
    void scanPorts()
  }, 3000)
  return p
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
// ends after the hours asked for (remoteTick; 0: forever, no until), on remoteStop, or with the daemon; a new token each
// time, so a stopped link is dead.
export const REMOTE_HOURS = [1, 2, 4, 8, 24, 0]
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/ // one address: no *@domain
type RemoteRun = { mail: string; until?: number; token: string; url?: string; cf: Cf }
let remote: RemoteRun | undefined
let daemonPort = 0
export const setDaemonPort = (p: number) => (daemonPort = p)
export const remoteToken = () => remote?.token
export const remoteOrigin = () => remote?.url // the page's origin, once there's a URL
export const remoteView = (): Remote | undefined =>
  remote && { mail: remote.mail, until: remote.until, url: remote.url, link: remote.url && `${remote.url}/?token=${remote.token}` }

export async function remoteStart(o: { hours: number; mail?: string }): Promise<Remote | undefined> {
  const hours = o.hours // a number: null or '' would be 0, forever
  if (typeof hours !== 'number' || !REMOTE_HOURS.includes(hours)) throw new Error(`for how long: ${REMOTE_HOURS.filter(Boolean).join(', ')} hours, or 0 (until stopped)`)
  const mail = (o.mail ?? state.settings?.remoteMail ?? '').trim()
  if (!ONE_MAIL.test(mail)) throw new Error(mail ? `not an email address: ${mail}` : 'the email that may open it: Settings › Remote access')
  if (mail !== state.settings?.remoteMail) settingsSet({ remoteMail: mail })
  if (remote) return remoteView()
  await cfReady(true)
  if (remote) return remoteView() // started meanwhile
  const { cf, url } = cloudflare(`http://127.0.0.1:${daemonPort}`, [mail], why => (log(`remote access ended (${why})`), remoteStop()))
  const r: RemoteRun = { mail, until: hours ? Date.now() + hours * 3600e3 : undefined, token: randomBytes(32).toString('hex'), cf }
  remote = r
  changed()
  try {
    r.url = await url
  } catch (e) {
    if (remote === r) remoteStop()
    throw e
  }
  if (remote !== r) return undefined // stopped meanwhile
  log(`remote access at ${r.url} for ${mail}, ${r.until ? `until ${new Date(r.until).toISOString()}` : 'until stopped'}`)
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
  if (remote?.until && now >= remote.until) remoteStop()
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

// the timer's scan (every minute): once settings.prScan minutes have gone by (a little early: the timer drifts)
let prLast = 0
export function prTick(now = Date.now()) {
  if (now - prLast < (state.settings?.prScan || PR_SCAN) * 60000 - 5000) return
  prLast = now
  return scanPRs()
}

let prScan: Promise<void> | null = null
let prAgain = false
export function scanPRs(): Promise<void> {
  if (prScan) {
    prAgain = true // asked mid-scan (e.g. a ship just opened a PR): scan again when this one ends
    return prScan
  }
  // workspaces in parallel: each gh call may take seconds
  const live = state.workspaces.filter(ws => !ws.archived && ws.kind === 'worktree' && (ws.host || existsSync(ws.path)))
  prScan = Promise.all(live.map(scanPR)).then(() => {
    prScan = null
    if (prAgain) {
      prAgain = false
      return scanPRs()
    }
  })
  return prScan
}

const PR_FIELDS = 'number,state,url,title,author,isDraft,headRefOid,baseRefName,reviewDecision,mergeable,additions,deletions,body,updatedAt,statusCheckRollup'

async function scanPR(ws: Workspace) {
  if (ws.host) await hostSync(ws)
  let pr: PR
  try {
    const { stdout } = await exec(ws, 'gh', ['pr', 'view', ws.prUrl ?? ws.branch, '--json', PR_FIELDS], { timeout: 20000 })
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
      conflict: j.mergeable === 'CONFLICTING' ? true : j.mergeable === 'MERGEABLE' ? false : undefined, // UNKNOWN for a while after a push
      base: j.baseRefName,
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
  if (pr.state === 'MERGED') await archiveMerged(ws, pr).catch(e => log(`archive merged ${ws.id}: ${e.message}`))
}

// a workspace whose PR merged, archived when Settings say so (archiveMerged): only clean (nothing uncommitted, no
// commit past the PR's head) and with no agent at work, once per PR (autoArchived: an Undo stays undone). The app
// shows it with Undo; one left alone shows "merged" in the sidebar
async function archiveMerged(ws: Workspace, pr: PR) {
  if (!state.settings?.archiveMerged || ws.kind !== 'worktree' || ws.archived || ws.autoArchived === pr.number || !pr.head) return
  if (tabsOf(ws.id).some(t => tracked(t) && rtOf(t.id).status !== 'idle' && sessions.get(t.id) && !sessions.get(t.id)!.exited)) return
  if ((await git(ws, 'rev-list', '--count', `${pr.head}..HEAD`).catch(() => '?')) !== '0') return // unpushed (or git can't tell)
  ws.autoArchived = pr.number // before: wsArchive saves it
  const r = await wsArchive(ws.id, { ifClean: true }).catch(e => {
    ws.autoArchived = undefined // failed: the next scan tries again
    throw e
  })
  if (r?.dirty) return void (ws.autoArchived = undefined)
  log(`archived ${ws.id}: PR #${pr.number} merged`)
  broadcast({ ev: 'archived', ws: ws.id, name: ws.name || ws.id, pr: pr.number })
}

// ---------- PR feedback to the agent: failing CI, review comments (from wb's fix-ci / fix-review)

// autoPR, after each scan of an open PR: with autoFix, failing CI goes to the agent once per commit (settings.prTries
// times in a row at most, then it's over to you); with autoReview, new review comments do; with autoMerge, merge
// conflicts do, the same way. The prompts (PR_PROMPTS, settings.prPrompts) ask it to push.
const retry = new Set<string>() // `<ws>:ci`, `<ws>:merge`: a switch turned on again (wsSet)

async function autoPR(ws: Workspace, pr: PR) {
  if (pr.state !== 'OPEN' || !(ws.autoFix || ws.autoReview || ws.autoMerge)) return
  const f: PRFix = ws.fix?.pr === pr.number ? { ...ws.fix } : { pr: pr.number }
  if (retry.delete(`${ws.id}:ci`)) Object.assign(f, { ci: undefined, tries: 0 }) // and the current commit's failure goes again
  if (retry.delete(`${ws.id}:merge`)) Object.assign(f, { merge: undefined, merges: 0 })
  const max = state.settings?.prTries || PR_TRIES
  if (ws.autoFix) {
    if (pr.checks === 'pass') f.tries = 0
    else if (pr.checks === 'fail' && pr.head && pr.head !== f.ci) {
      const tries = (f.tries ?? 0) + 1
      if (tries > max) {
        if (tries - 1 <= max) overToYou(ws, `CI still fails after ${max} fixes`) // once, as it goes over (max may have changed)
        Object.assign(f, { ci: pr.head, tries })
      } else if (await prFix({ ws: ws.id, what: 'ci' }).then(() => true, e => (log(`fix ci ${ws.id}: ${e.message}`), false)))
        Object.assign(f, { ci: pr.head, tries }) // recorded once sent: no agent yet means the next scan tries again
    }
  }
  if (ws.autoMerge) {
    // ponytail: once per head commit, so a base that moves while the agent merges doesn't queue another; one that
    // conflicts again with the same head waits for a push (or Send merge conflicts)
    const merges = (f.merges ?? 0) + 1
    if (pr.conflict === false) f.merges = 0 // not unknown: that comes after every push, and would undo the limit
    else if (pr.conflict && pr.head && pr.head !== f.merge) {
      if (merges > max) {
        if (merges - 1 <= max) overToYou(ws, `Merge conflicts remain after ${max} tries`)
        Object.assign(f, { merge: pr.head, merges })
      } else if (await prFix({ ws: ws.id, what: 'conflict' }).then(() => true, e => (log(`fix conflicts ${ws.id}: ${e.message}`), false)))
        Object.assign(f, { merge: pr.head, merges })
    }
  }
  if (ws.autoReview) {
    const t = await reviewThreads(ws, pr.number).catch(() => null)
    const ids = new Set(f.mine)
    const mine = (c: Comment) => !!c.id && (ids.has(c.id) || (!!c.createdAt && agentSaid(ws.id, c.createdAt) && !!ids.add(c.id)))
    const k = t && reviewKey(t.threads, t.me, mine)
    if (ids.size) f.mine = [...ids].slice(-200)
    if (t && k !== null && newReview(k, f.review))
      try {
        tellAgent(ws, reviewMessage(pr, t.threads))
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

// ◆ on the workspace's agent: over to you
function overToYou(ws: Workspace, text: string) {
  const tab = agentOf(ws)
  if (!tab) return
  rtOf(tab.id).status = 'waiting'
  broadcast({ ev: 'turn', tab: tab.id, ws: ws.id, kind: 'waiting', text })
  phone(tab, 'waiting', text)
}

// a push to your phone (push.ts) for a turn that waits or is done: once per state change of a tab (pushed: what went
// since it last ran; view() clears it), never for a muted tab or workspace. ponytail: a turn that starts and ends
// within the 30 ms before a view is built looks like the same one, and its end isn't pushed
const pushed = new Map<string, string>()
function phone(tab: Tab, kind: 'waiting' | 'done', text: string) {
  const w = state.settings?.webhook
  const ws = state.workspaces.find(x => x.id === tab.workspace)
  if (!w?.url?.trim() || (kind === 'waiting' ? w.waiting === false : w.done !== true) || pushed.get(tab.id) === kind || tab.muted || ws?.muted) return
  pushed.set(tab.id, kind)
  // a wait's message; a done turn's last line that asks something
  const question = (kind === 'waiting' ? text : text.split('\n').reverse().find(l => l.trim().endsWith('?')) ?? '').trim().slice(0, 500)
  pushTo(w, { event: kind, workspace: ws?.name || tab.workspace, tab: tab.id, agent: tab.name, question: question || undefined }).catch(e => log(`push ${tab.id}: ${e.message}`))
}

// Settings' Send test: the webhook as the page has it, answered (not fired and forgotten)
export const webhookTest = (w: Webhook) => pushTo(w ?? {}, { event: 'test', workspace: '', tab: '', agent: 'Laki' }).then(() => true)

// the workspace's agent: its first live agent tab
const agentOf = (ws: Workspace) => tabsOf(ws.id).find(t => tracked(t) && sessions.get(t.id) && !sessions.get(t.id)!.exited)

// tellAgent types text into the workspace's agent, now or when its turn ends
function tellAgent(ws: Workspace, text: string) {
  const tab = agentOf(ws)
  if (!tab) throw new Error(`${ws.id} has no running agent`)
  return send({ target: tab.id, text, whenIdle: true })
}

// what to tell the agent about a PR: settings.prPrompts' or PR_PROMPTS' text, its {{pr}}, {{url}} and {{base}} filled in
function prPrompt(what: FixWhat, pr: PR) {
  const v: Record<string, string> = { pr: String(pr.number), url: pr.url, base: pr.base ?? 'main' }
  return fillTemplate(String(state.settings?.prPrompts?.[what] ?? '').trim() || PR_PROMPTS[what], v)
}

// prFix sends the PR's failing CI (with the end of the failed GitHub Actions logs), its open review comments or its
// merge conflicts to the workspace's agent
export async function prFix(o: { ws: string; what: FixWhat }) {
  const ws = findWs(o.ws)
  const pr = prs.get(ws.id)
  if (!pr) throw new Error(`${ws.id} has no PR`)
  if (o.what === 'conflict') {
    if (!pr.conflict) throw new Error(`PR #${pr.number} has no merge conflicts`)
    return tellAgent(ws, prPrompt('conflict', pr))
  }
  if (o.what === 'review') {
    const { threads } = await reviewThreads(ws, pr.number)
    const msg = reviewMessage(pr, threads)
    if (!msg) throw new Error(`no open review comments on PR #${pr.number}`)
    return tellAgent(ws, msg)
  }
  // gh exits non-zero while checks fail
  const { stdout } = await exec(ws, 'gh', ['pr', 'checks', String(pr.number), '--json', 'name,bucket,link'], { timeout: 20000 }).catch(e => ({ stdout: String(e.stdout ?? '') }))
  const failing = (JSON.parse(stdout.trim() || '[]') as { name: string; bucket: string; link: string }[]).filter(c => c.bucket === 'fail')
  if (!failing.length) throw new Error(`no failing checks on PR #${pr.number}`)
  let body = ''
  let logs = 0
  for (const c of failing) {
    body += `\n## ${c.name}\n${c.link}\n`
    const job = c.link?.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1]
    if (job && logs < 3) {
      const out = await exec(ws, 'gh', ['run', 'view', '--job', job, '--log-failed'], { timeout: 30000, maxBuffer: 32 << 20 }).then(r => r.stdout, () => '')
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
  return tellAgent(ws, `${prPrompt('ci', pr)}\n${body}`)
}

type Comment = { id?: string; author: { login: string; __typename?: string } | null; authorAssociation?: string; body: string; createdAt?: string }
type Thread = { id: string; isResolved: boolean; isOutdated: boolean; path: string; line: number | null; comments: { nodes: Comment[] } }

// comments an agent may act on: from people with write access to the repo, or bots (review tools). Anyone
// can comment on a public PR, and the agent is told to change code and push.
const trusted = (c: Comment) => c.author?.__typename === 'Bot' || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation ?? '')

const REVIEW_QUERY = `query($owner: String!, $repo: String!, $pr: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) { pullRequest(number: $pr) { reviewThreads(first: 100) { nodes {
    id isResolved isOutdated path line
    comments(first: 30) { nodes { id author { login __typename } authorAssociation body createdAt } }
  } } } }
}`

// a PR's review threads, and who you are on GitHub
async function reviewThreads(at: At, pr: number): Promise<{ threads: Thread[]; me: string }> {
  const { stdout } = await exec(at, 'gh', ['api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `pr=${pr}`, '-f', `query=${REVIEW_QUERY}`], { timeout: 20000 }).catch(e => {
    throw new Error(`gh couldn't read the review comments: ${String(e.stderr || '').trim().split('\n')[0] || 'it failed'}`)
  })
  const d = JSON.parse(stdout).data
  const threads: Thread[] | undefined = d?.repository?.pullRequest?.reviewThreads?.nodes
  if (!threads) throw new Error(`no review threads for PR #${pr} (gh api graphql)`)
  return { threads: threads.map(t => ({ ...t, comments: { nodes: t.comments.nodes.filter(trusted) } })), me: d.viewer.login }
}

// the open threads with how many comments count on each ("id:n id:n"): everyone's but the agent's. It comments as you,
// and its replies must not start another round: yours made while it worked are its own (mine: their ids, kept)
export const reviewKey = (threads: Thread[], me: string, mine: (c: Comment) => boolean) =>
  threads
    .map(t => [t, t.comments.nodes.filter(c => c.author?.login !== me || !mine(c)).length] as const)
    .filter(([t, n]) => !t.isResolved && n > 0)
    .map(([t, n]) => `${t.id}:${n}`)
    .join(' ')

// a thread or reply in key that wasn't there when the last one was sent
export const newReview = (key: string, sent = '') => key.split(' ').some(t => t && !sent.split(' ').includes(t))

// ponytail: inline threads only, not review summaries or plain PR comments
function reviewMessage(pr: PR, threads: Thread[]) {
  const open = threads.filter(t => !t.isResolved && t.comments.nodes.length)
  if (!open.length) return ''
  const items = open.map((t, i) => {
    const where = `${t.path}${t.line ? `:${t.line}` : ''}${t.isOutdated ? ' (outdated: the code moved since)' : ''}`
    const said = t.comments.nodes.map(c => `   @${c.author?.login ?? '?'}: ${c.body.trim().replace(/\n/g, '\n   ')}`).join('\n')
    return `\n${i + 1}. ${where}\n${said}`
  })
  return `${prPrompt('review', pr)}\n${items.join('\n')}`
}

// a turn that ended without a hook (an interrupt, a resumed chat's recap): running, no output for a
// while and no "esc to interrupt" on screen (claude and codex show it while they work) means idle. For an agent
// without hooks it's how every turn ends: done, as a hook would say (ponytail: a turn under 8s, likely Enter on a
// menu, ends without a notification)
export function sweepRunning(now = Date.now()) {
  for (const t of state.tabs) {
    const s = sessions.get(t.id)
    const r = rt.get(t.id)
    const screen = tracked(t) && !HOOKED.has(t.preset!) && !r?.hooked // no hooks: the screen and title are all it says
    if (screen && s && !s.exited && r && r.status !== 'idle') {
      const asks = ASKS.test(s.title)
      if (asks && r.status === 'running') turn({ tab: t.id, state: 'waiting' })
      else if (!asks && r.status === 'waiting') turn({ tab: t.id, state: 'running' }) // answered
    }
    if (!s || s.exited || r?.status !== 'running' || !tracked(t) || now - s.lastOutput < QUIET) continue
    if (BUSY[t.preset!]?.test(`${s.title}\n${s.screenText(15)}`)) continue
    if (screen && now - (r.since ?? 0) > 2 * QUIET) {
      turn({ tab: t.id, state: 'idle' })
      continue
    }
    r.status = 'idle'
    changed()
    if (t.queue?.length) setTimeout(() => deliver(t.id), 800) // what waited for this turn's end (autoPR's too)
  }
}

// ---------- diff, dev server, ship

// what a workspace's changes are against: a worktree's merge base with its base branch, else HEAD
const diffBase = (ws: Workspace) => (ws.kind === 'worktree' ? git(ws, 'merge-base', ws.base, 'HEAD').catch(() => 'HEAD') : Promise.resolve('HEAD'))

export async function diff(ref: string) {
  const ws = findWs(ref)
  const from = await diffBase(ws)
  const [text, numstat, untracked] = await Promise.all([
    git(ws, 'diff', '--no-color', '--no-ext-diff', '-M', from),
    git(ws, 'diff', '--numstat', '-M', from),
    git(ws, 'ls-files', '--others', '--exclude-standard'),
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
  // a host's in one go, each after a NUL (git's diff of a file with one says Binary files … differ)
  const each = 'for f; do printf "\\000"; git diff --no-color --no-index -- /dev/null "$f"; done; true'
  const diffs = !ws.host
    ? await Promise.all(
        newFiles.map(f =>
          run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: ws.path, maxBuffer: 16 << 20 }).then(
            r => r.stdout,
            e => String(e.stdout ?? ''), // exit 1: there are differences
          ),
        ),
      )
    : newFiles.length
      ? await exec(ws, 'sh', ['-c', each, 'sh', ...newFiles]).then(r => r.stdout.split('\0').slice(1), () => [])
      : []
  for (const [i, f] of newFiles.entries()) {
    const d = diffs[i] ?? ''
    out += (out ? '\n' : '') + d.trimEnd()
    files.push({ path: f, add: d.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length, del: 0, status: 'A' })
  }
  const MAX = 4 << 20
  return { base: ws.base, from, files, diff: out.length > MAX ? out.slice(0, MAX) + '\n… (cut)' : out }
}

// the sidebar's +/-: diff's numbers without its text, for each live git workspace; one scan at a time
const stats = new Map<string, Stat>()
let statting = false
let restat = false // asked for while one ran: again after it
async function statOf(w: Workspace): Promise<Stat> {
  // --no-optional-locks: a scan never holds index.lock while an agent or you commit
  const from = await diffBase(w)
  const [numstat, untracked, status] = await Promise.all([
    git(w, '--no-optional-locks', 'diff', '--numstat', '-M', from),
    git(w, '--no-optional-locks', 'ls-files', '--others', '--exclude-standard'),
    git(w, '--no-optional-locks', 'status', '--porcelain'),
  ])
  const st: Stat = { add: 0, del: 0, files: 0, dirty: status.split('\n').filter(Boolean).length }
  for (const l of numstat.split('\n').filter(Boolean)) {
    const [a, d] = l.split('\t')
    st.add += Number(a) || 0 // a binary file: -
    st.del += Number(d) || 0
    st.files++
  }
  // ponytail: new files' lines read here (async: the loop streams terminals), the first 100 up to 1 MB each; a text
  // file's newlines, a binary's none
  const fresh = untracked.split('\n').filter(Boolean)
  st.files += fresh.length
  for (const f of w.host ? [] : fresh.slice(0, 100)) { // ponytail: a host's new files count, not their lines
    try {
      const p = join(w.path, f)
      if ((await stat(p)).size > 1 << 20) continue
      const b = await readFile(p)
      if (!b.subarray(0, 8000).includes(0)) st.add += b.length && b.toString('utf8').split('\n').length - (b[b.length - 1] === 10 ? 1 : 0)
    } catch {}
  }
  return st
}
export async function scanStats(): Promise<void> {
  if (statting) return void (restat = true)
  statting = true
  try {
    // the sidebar's (settings.diffStat, off by default), and a race's always: Compare shows them
    const on = state.settings?.diffStat === true
    const wanted = (w: Workspace) => !w.archived && (on || !!w.race) && state.projects.find(p => p.id === w.project)?.git !== false
    for (const id of stats.keys()) if (!state.workspaces.some(w => w.id === id && wanted(w))) (stats.delete(id), changed())
    for (const w of state.workspaces) {
      if (!wanted(w) || (!w.host && !existsSync(w.path))) continue
      const s = await statOf(w).catch(() => undefined)
      if (JSON.stringify(s) === JSON.stringify(stats.get(w.id))) continue
      s ? stats.set(w.id, s) : stats.delete(w.id)
      changed()
    }
  } finally {
    statting = false
  }
  if (restat) (restat = false), await scanStats()
}

// the agent browser (laki browser, MCP's laki_browser): a hidden window of the app's per workspace (main's), asked
// through the newest connected app window; a page on this Mac only (main checks too). screenshot: a PNG in images/
const BROWSE_OPS = ['open', 'screenshot', 'click', 'fill', 'text']
const browsing = new Map<string, { done: (r: { ok: boolean; result?: any; error?: string }) => void }>()
export async function browse(p: { ws: string; op: string; url?: string; selector?: string; text?: string }) {
  const ws = findWs(p.ws)
  if (!BROWSE_OPS.includes(p.op)) throw new Error(`browser: ${p.op}? one of ${BROWSE_OPS.join(', ')}`)
  if ((p.op === 'click' || p.op === 'fill') && !p.selector?.trim()) throw new Error(`browser ${p.op}: which element? a CSS selector`)
  // a path is on the workspace's $PORT, localhost:3000 gets its http://
  const u = p.url?.trim()
  const url = !u ? undefined : u.startsWith('/') ? `http://localhost:${ws.port}${u}` : /^https?:\/\//.test(u) ? u : `http://${u}`
  if (url && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) throw new Error(`the agent browser opens this Mac's localhost only, not ${url}`)
  const host = [...clients].reverse().find(c => c.view?.browse)
  if (!host) throw new Error("the agent browser needs Laki's window: open the app on this Mac")
  const id = randomUUID()
  const r = await new Promise<{ ok: boolean; result?: any; error?: string }>(done => {
    const t = setTimeout(() => (browsing.delete(id), done({ ok: false, error: "the agent browser didn't answer in 30 s" })), 30000)
    browsing.set(id, { done: r => (clearTimeout(t), browsing.delete(id), done(r)) })
    host.send({ ev: 'browse', req: id, ws: ws.id, home: `http://localhost:${ws.port}/`, op: p.op, url, selector: p.selector, text: p.text })
  })
  if (!r.ok) throw new Error(r.error || 'the agent browser failed')
  if (p.op !== 'screenshot') return r.result
  return { url: r.result.url, path: imageSave({ data: r.result.png, ext: 'png' }) }
}
export function browseDone(p: { id: string; ok: boolean; result?: any; error?: string }) {
  browsing.get(p.id)?.done(p)
}

// the first-run screen's checks
export async function doctor(): Promise<Doctor> {
  const gh = !onPath('gh') ? 'missing' : await run('gh', ['auth', 'status'], { timeout: 8000 }).then(() => 'in' as const, () => 'out' as const)
  return { git: onPath('git'), gh, agents: AGENTS.map(id => ({ id, found: onPath(id) })) }
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

// a path in the workspace, links followed: a tracked link (or a linked folder) may point anywhere. A new file's
// nearest folder there already is what's checked; a dangling link is out. ponytail: on an SSH host by name only
function inside(ws: Workspace, rel: string) {
  const abs = resolve(ws.path, rel)
  if (rel.trim() && abs.startsWith(ws.path + '/'))
    try {
      if (ws.host) return abs
      let up = abs
      while (!lstatSync(up, { throwIfNoEntry: false })) up = dirname(up)
      if (within(realpathSync(ws.path), realpathSync(up))) return abs
    } catch {} // a dangling link, a file as a folder, the workspace gone
  throw new Error(`${rel}: not a path inside the workspace`)
}

const MAX_FILES = 50000

// files lists the workspace's files (git's: tracked and untracked, not ignored; a plain folder's: all
// but dependencies), and how the changed ones changed: M, A (new), D, R
export async function files(ref: string) {
  const ws = findWs(ref)
  if (ws.host && state.projects.find(p => p.id === ws.project)?.git === false) {
    const skip = [...SKIP_DIRS].flatMap((d, i) => [...(i ? ['-o'] : []), '-name', d])
    const { stdout } = await exec(ws, 'find', ['.', '(', ...skip, ')', '-prune', '-o', '-type', 'f', '-print'])
    const out = stdout.split('\n').filter(Boolean).map(l => l.slice(2))
    return { files: out.slice(0, MAX_FILES), changed: {}, cut: out.length > MAX_FILES }
  }
  if (!ws.host && !existsSync(join(ws.path, '.git'))) {
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
  const z = (args: string[]) => exec(ws, 'git', args).then(r => r.stdout.split('\0'))
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

export async function fileNew(o: { ws: string; path: string; dir?: boolean }) {
  const ws = findWs(o.ws)
  const abs = inside(ws, o.path)
  if (ws.host) {
    const make = '[ ! -e "$1" ] || { echo "$3 is there already" >&2; exit 1; }; if [ "$2" = dir ]; then mkdir -p "$1"; else mkdir -p "$(dirname "$1")" && : > "$1"; fi'
    await exec(ws, 'sh', ['-c', make, 'sh', abs, o.dir ? 'dir' : 'file', o.path]).catch(e => {
      throw new Error(String(e.stderr || e.message).trim().split('\n').at(-1))
    })
    return { path: abs.slice(ws.path.length + 1) }
  }
  if (existsSync(abs)) throw new Error(`${o.path} is there already`)
  mkdirSync(o.dir ? abs : dirname(abs), { recursive: true })
  if (!o.dir) writeFileSync(abs, '', { flag: 'wx' })
  return { path: abs.slice(ws.path.length + 1) }
}

const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp' }
const MAX_TEXT = 512 << 10

// fileRead: a file for the preview: text (the first 512 KB), an image (up to 10 MB), or only its size. base: an image
// as it was where the workspace's changes start (diff's base, through git show), for Changes' before and after
export async function fileRead(o: { ws: string; path: string; base?: boolean }) {
  const ws = findWs(o.ws)
  const abs = inside(ws, o.path)
  if (o.base) {
    const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
    if (!mime) throw new Error(`${o.path} isn't an image`)
    const rel = abs.slice(ws.path.length + 1)
    const show = `${await diffBase(ws)}:${rel}`
    const stdout = ws.host
      ? Buffer.from((await exec(ws, 'sh', ['-c', 'git show "$1" | head -c 10485761 | base64', 'sh', show])).stdout, 'base64') // base64: text over ssh
      : (
          await run('git', ['show', show], { cwd: ws.path, encoding: 'buffer', maxBuffer: 10 << 20 }).catch(e => {
            throw new Error(/maxBuffer/i.test(String(e.message)) ? 'over 10 MB' : `not in ${ws.base}`)
          })
        ).stdout
    if (ws.host && !stdout.length) throw new Error(`not in ${ws.base}`)
    if (stdout.length > 10 << 20) throw new Error('over 10 MB')
    return { size: stdout.length, image: `data:${mime};base64,${stdout.toString('base64')}` }
  }
  if (ws.host) return hostFileRead(ws, abs, o.path)
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

// fileRead on an SSH host: the same answers, read there (base64: text over ssh)
async function hostFileRead(ws: Workspace, abs: string, rel: string) {
  const mime = IMAGES[extname(abs).slice(1).toLowerCase()]
  const max = mime ? 10 << 20 : MAX_TEXT
  const read = `[ -f "$1" ] || { echo "$3 isn't a file" >&2; exit 3; }; n=$(wc -c < "$1"); echo $n; if [ "$2" = text ] || [ "$n" -le "$4" ]; then head -c "$4" "$1" | base64; fi`
  const { stdout } = await exec(ws, 'sh', ['-c', read, 'sh', abs, mime ? 'image' : 'text', rel, String(max)]).catch(e => {
    throw new Error(String(e.stderr || e.message).trim().split('\n').at(-1))
  })
  const nl = stdout.indexOf('\n')
  const size = Number(stdout.slice(0, nl).trim())
  const buf = Buffer.from(stdout.slice(nl + 1), 'base64')
  if (mime) return size > max ? { size } : { size, image: `data:${mime};base64,${buf.toString('base64')}` }
  if (buf.subarray(0, 8000).includes(0)) return { size } // binary
  return { size, text: buf.toString('utf8'), cut: size > MAX_TEXT || undefined }
}

// prComment: a review comment on a line of the PR's diff (the side panel's Changes); side LEFT is the old file's line
export async function prComment(o: { ws: string; path: string; line: number; side?: 'LEFT' | 'RIGHT'; body: string }) {
  const ws = findWs(o.ws)
  const pr = prs.get(ws.id)
  if (!pr) throw new Error(`${ws.id} has no PR`)
  if (!pr.head) throw new Error(`PR #${pr.number}'s head commit isn't known yet: try again in a minute`)
  inside(ws, String(o.path ?? ''))
  if (!Number.isInteger(o.line) || o.line < 1) throw new Error('which line?')
  if (!o.body?.trim()) throw new Error('the comment is empty')
  const side = o.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  const args = ['api', `repos/{owner}/{repo}/pulls/${pr.number}/comments`, '-f', `body=${o.body}`, '-f', `commit_id=${pr.head}`, '-f', `path=${o.path}`, '-F', `line=${o.line}`, '-f', `side=${side}`]
  const { stdout } = await exec(ws, 'gh', args, { timeout: 20000 }).catch(e => {
    const why = String(e.stderr || e.stdout || '').trim()
    throw new Error(/422|Unprocessable|could not be resolved|pull_request_review_thread\.line/i.test(why) ? "that line isn't in the PR's diff: commit and push it first" : `gh couldn't comment: ${why.split('\n')[0] || 'it failed'}`)
  })
  const c = JSON.parse(stdout || '{}')
  return { url: c.html_url as string | undefined }
}

// prThreads: the PR's review threads, for the side panel
export async function prThreads(ref: string) {
  const ws = findWs(ref)
  const pr = prs.get(ws.id)
  if (!pr) return []
  const { threads } = await reviewThreads(ws, pr.number)
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

// ---------- scheduled tasks: a prompt to an agent at the times a line of English says (shared/when.ts)

const RUNS_KEPT = 200
const RUNS_SHOWN = 50
// a run this late (the Mac asleep, Laki not running) is skipped, and the log says so
// ponytail: missed runs never catch up; run them on wake if that's what people want
export const MISSED_AFTER = 30 * 60e3

const findSchedule = (id: string) => {
  const s = state.schedules?.find(x => x.id === id)
  if (!s) throw new Error(`no scheduled task ${id}`)
  return s
}

type ScheduleIn = Partial<Pick<Schedule, 'id' | 'name' | 'project' | 'preset' | 'ws' | 'prompt' | 'when' | 'on'>>
const SCHEDULE_IN = ['name', 'project', 'preset', 'ws', 'prompt', 'when', 'on'] as const // what a client sets: the daemon works out the rest

export function scheduleSet(o: ScheduleIn): Schedule {
  const old = o.id ? findSchedule(o.id) : undefined
  const given = Object.fromEntries(SCHEDULE_IN.filter(k => o[k] !== undefined).map(k => [k, o[k]]))
  if (old && given.on === false && Object.keys(given).length === 1) {
    // off takes no checks: a task whose workspace or preset is gone can still be stopped
    Object.assign(old, { on: false, next: undefined })
    save()
    changed()
    return old
  }
  const s: Schedule = { ...(old ?? { id: randomUUID().slice(0, 8), on: true, project: '', preset: '', ws: 'new', prompt: '', when: '', rule: { days: [], times: [] } }), ...given }
  s.on = s.on !== false
  const proj = findProject(s.project)
  s.project = proj.id
  if (!old) {
    // what a new one leaves out (the CLI): a worktree each run, or the folder without git; the default agent
    if (o.ws === undefined) s.ws = proj.git === false ? 'local' : 'new'
    const agent = state.settings?.agent
    s.preset ||= agent && presetNamed(agent) && presetNamed(agent)!.agent !== 'command' ? agent : 'claude'
  }
  const pr = presetNamed(s.preset) // an agent's: a command preset takes no prompt
  if (!(pr ? pr.agent !== 'command' : isAgent(s.preset))) throw new Error(`pick an agent: ${s.preset || 'none'} isn't an agent's preset`)
  if (s.ws === 'new') {
    if (proj.git === false) throw new Error(`${proj.name} isn't a git repository: run it in its folder instead of a new workspace`)
  } else if (s.ws !== 'local' && s.ws !== 'local-new') {
    const ws = findWs(s.ws)
    if (ws.project !== proj.id) throw new Error(`${ws.id} isn't in ${proj.name}`)
    s.ws = ws.id
  }
  s.prompt = s.prompt?.trim() ?? ''
  if (!s.prompt) throw new Error('the prompt is empty')
  s.name = s.name?.trim() || undefined
  if (!old || o.when !== undefined) {
    const r = parseWhen(s.when ?? '')
    if ('error' in r) throw new Error(r.error)
    s.rule = r
  }
  s.next = s.on ? nextRun(s.rule, Date.now()) : undefined
  state.schedules = old ? state.schedules!.map(x => (x === old ? s : x)) : [...state.schedules!, s]
  save()
  changed()
  return s
}

export function scheduleRm(id: string) {
  const s = findSchedule(id)
  state.schedules = state.schedules!.filter(x => x !== s)
  save()
  changed()
}

const runName = (s: Schedule, at: number) => stamp(s.name || s.prompt.split(/\s+/).slice(0, 6).join(' '), at)

const logRun = (r: ScheduleRun) => {
  state.runs = [r, ...(state.runs ?? [])].slice(0, RUNS_KEPT)
  save()
  changed()
  return r
}

// one run: a new workspace with the agent and the prompt, or the prompt to the workspace's agent
export async function runSchedule(s: Schedule, now = Date.now()): Promise<ScheduleRun> {
  s = state.schedules?.find(x => x.id === s.id) ?? s // scheduleSet replaces a task: the current one
  const r: ScheduleRun = { id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, now), at: now, ok: true, what: '' }
  const prompt = stamp(s.prompt, now)
  s.last = now
  try {
    if (s.ws === 'new' || s.ws === 'local-new') {
      // a new worktree, or a new session in the folder: either way a row of its own in the sidebar
      const title = wsTitle(s, now)
      const ws = await wsNew({ project: s.project, preset: s.preset, prompt, name: title, ...(s.ws === 'local-new' && { local: true, another: true }) })
      // told apart in the sidebar, as its id is: Check 05-10-k3x9 (an hourly 'Check {{DD-MM}}'), with the id's tail
      const taken = (n: string) => state.workspaces.some(w => w !== ws && !w.archived && (w.name || w.id) === n)
      const own = ws.id.startsWith(`${slug(title)}-`) ? ws.id.slice(slug(title).length) : ''
      let name = taken(title) ? title + (own || `-${tail()}`) : title
      while (taken(name)) name = `${title}-${tail()}`
      Object.assign(ws, { name, schedule: s.id })
      save()
      changed()
      r.ws = ws.id
      r.tab = tabsOf(ws.id).find(t => t.kind === 'agent')?.id
      r.what = `started in a new ${s.ws === 'new' ? 'workspace' : 'session in its folder'}, ${ws.id}`
    } else {
      // its folder: the project's local workspace, made the first time (no worktree, no agent of its own)
      const ws = s.ws === 'local' ? await wsNew({ project: s.project, local: true, preset: 'none' }) : findWs(s.ws)
      if (ws.archived) throw new Error(`${ws.id} is archived`)
      r.ws = ws.id
      const live = tabsOf(ws.id).find(t => t.kind === 'agent' && (t.profile ?? t.preset) === s.preset && sessions.get(t.id) && !sessions.get(t.id)!.exited)
      if (live) {
        const sent = send({ target: live.id, text: prompt, whenIdle: tracked(live) })
        r.tab = live.id
        r.what = 'queued' in sent ? `queued for ${live.name} (it was working)` : `sent to ${live.name}`
      } else {
        const t = addTab(ws.id, { preset: s.preset, prompt })
        r.tab = t.id
        r.what = `started in a new ${t.name} tab`
      }
    }
  } catch (e) {
    r.ok = false
    r.what = (e as Error).message
  }
  return logRun(r)
}

export function scheduleRun(id: string) {
  return runSchedule(findSchedule(id))
}

// every 30 s (tests pass `now`): what's due runs, what's long overdue is logged as missed; then the next time
export async function scheduleTick(now = Date.now()) {
  // every due one moves on first: a tick while a run is still starting (a worktree takes a while) doesn't start it again
  const due = (state.schedules ?? []).filter(s => s.on && s.next !== undefined && s.next <= now).map(s => ({ s, at: s.next! }))
  for (const { s } of due) {
    s.next = s.rule.once ? undefined : nextRun(s.rule, now)
    if (s.rule.once) s.on = false
  }
  if (!due.length) return
  save()
  changed()
  for (const { s, at } of due) {
    if (!state.schedules?.some(x => x.id === s.id)) continue // deleted while an earlier one started
    if (now - at > MISSED_AFTER) logRun({ id: randomUUID().slice(0, 8), schedule: s.id, project: s.project, name: runName(s, at), at, ok: false, what: "missed: the Mac was asleep or Laki wasn't running" })
    else await runSchedule(s, now)
  }
}
