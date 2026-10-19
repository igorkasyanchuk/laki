// The terminal host: owns PTYs, state and scans; outlives the app. Reached over 127.0.0.1 only:
// POST /rpc (Authorization: Bearer <token>) and a WebSocket at /ws?token=<token>. The token lives in
// <data>/daemon.json (0600); a browser page can't read it, and an Origin that isn't ours is refused anyway.
import { execFileSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { aiAnswer, aiAsk, aiChatRm, aiChats, aiContinue, aiForget, aiImage, aiKey, aiNew, aiOpen, aiPermission, aiQuestion, aiState, aiStop, aiTick, voiceText } from './ai.ts'
import { planChat } from '../shared/plans.ts'
import { meme } from './fun.ts'
import * as core from './core.ts'
import { refreshSkills, skills, skillSet } from './skill.ts'
import { accountAdd, accountRm, accountSet, accountViews, usageWho } from './accounts.ts'
import { usage } from './usage.ts'
import { planFile, planGet, planList, planNew, planPage, planRm, planSave, planUpload, planWrite } from './plans.ts'
import { noteFile, noteGet, noteList, noteNew, noteRm, noteSave, noteUpload } from './notes.ts'
import { flowAnswer, flowTest, flowForget, flowGet, flowList, flowResume, flowRm, flowSave, flowStart, flowStop, flowStopAll, flowTick } from './workflow.ts'
import { scanWidgets, stopAgents, widgetRemix, widgetRestore, widgetTrash, widgetTrashTidy, widgetSlug, widgetUndo, widgetAction, widgetEvent, widgetGrantRm, widgetPush, widgetStreamStop, widgetAsks, widgetPermission, widgetToolAnswer, widgetToolCall, widgetTools, widgetCheck, widgetDev, widgetFileSave, widgetFiles, widgetKey, widgetMock, widgetNew, widgetPage, widgetReload, widgetRender, widgetRm, widgetRun, widgetRuns, widgetSet, widgetsStop, widgetTick, widgetWrite } from './widgets.ts'
import { memoryCompact, memoryCompactLog, memoryTick } from './memory.ts'
import { device } from './device.ts'

const { dir } = core
// a daemon a tab started (its laki CLI) is no tab's: what it runs (a widget's laki new, Laki AI's agents) comes from no workspace
delete process.env.LAKI_WORKSPACE
delete process.env.LAKI_TAB
mkdirSync(dir, { recursive: true, mode: 0o700 })
chmodSync(dir, 0o700) // state, queued messages and agents' answers live here

// ---------- single instance: a lock file with our pid. It's hard-linked from a file already holding the
// pid, so no one ever reads it empty and takes a starting daemon's lock for a stale one.
// ponytail: two starters that both find the same stale lock can still both remove it; flock if that matters.
const lockPath = join(dir, 'daemon.lock')
// a live process running the daemon (node …/daemon/main.ts, Electron-as-node …/daemon.js, or `laki daemon`)
function isDaemon(pid: number) {
  try {
    return /daemon(\.js|\/main\.ts)|\sdaemon\s*$/m.test(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }))
  } catch {
    return false
  }
}

function takeLock(): boolean {
  const tmp = `${lockPath}.${process.pid}`
  writeFileSync(tmp, String(process.pid))
  try {
    for (let i = 0; i < 2; i++) {
      try {
        linkSync(tmp, lockPath)
        return true
      } catch {}
      let pid = 0
      try {
        pid = Number(readFileSync(lockPath, 'utf8').trim())
      } catch {}
      if (pid && pid !== process.pid && isDaemon(pid)) return false
      try {
        unlinkSync(lockPath) // stale: dead, or its pid now belongs to another program (a link to nothing too: rmSync follows it)
      } catch {}
    }
    return false
  } finally {
    rmSync(tmp, { force: true })
  }
}
if (!takeLock()) {
  console.log('laki daemon already running')
  process.exit(0)
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

if (process.env.LAKI_FROM_APP) core.adoptLoginPath()
core.load()
core.writeHooks()
core.restoreAll()
flowResume() // workflow runs back at their blocks
scanWidgets()
try {
  refreshSkills()
} catch (e) {
  log(`skills: ${(e as Error).message}`)
}

const token = randomBytes(32).toString('hex')
// Browsers always send Origin on a WebSocket; node clients (CLI, hooks, Electron main) send none.
const origins = new Set(['file://', ...(process.env.LAKI_DEV_ORIGIN ? process.env.LAKI_DEV_ORIGIN.split(',') : [])])
// remote access (core.ts) adds its page's origin and its own token while it runs
const originOk = (o: string | undefined) => o === undefined || origins.has(o) || (!!o && o === core.remoteOrigin())
const { same } = core
// remote access's token only from its page: a client with no Origin (curl past Cloudflare's sign-in) needs ours
const tokenOk = (t: string | null | undefined, o: string | undefined) => !!t && (same(t, token) || (!!o && o === core.remoteOrigin() && same(t, core.remoteToken())))
// the Host a request names: this daemon's own address, or remote access's while it runs. A page on another site whose
// name was pointed at 127.0.0.1 (DNS rebinding) names its own: turned away on every route
let port = 0
const hostOk = (h: string | undefined) => h === `127.0.0.1:${port}` || h === `localhost:${port}` || (!!h && h === (o => o && new URL(o).host)(core.remoteOrigin()))

// the app's page, for remote access: the built renderer (out/renderer, next to the built daemon; from source, after a
// build; LAKI_PAGE: that folder instead, as tests do). Its files hold no secrets: the token comes in the link.
const here = dirname(fileURLToPath(import.meta.url))
const pageDir = process.env.LAKI_PAGE || [join(here, '../renderer'), join(here, '../../out/renderer')].find(d => existsSync(join(d, 'assets'))) // built: from source, ../renderer is the dev page
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
function page(path: string, res: ServerResponse) {
  let file = ''
  let body: Buffer | undefined
  try {
    file = pageDir ? normalize(join(pageDir, path === '/' ? 'index.html' : decodeURIComponent(path))) : ''
    if (file.startsWith(pageDir + sep)) body = readFileSync(file) // nothing outside it
  } catch {}
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end(pageDir ? 'not found' : 'no app page here: build it (npm run build)')
  }
  // the page itself never from the cache (a tab brought back, Back): it goes through Cloudflare's sign-in again, and
  // doesn't load without one, its every other request turned away
  const html = extname(file) === '.html'
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': html ? 'no-store' : 'no-cache', 'x-content-type-options': 'nosniff' })
  res.end(body)
}

// GET /artifact/<key>/<ws>/<path>: a file of a workspace's Artifacts for the app's viewer (an HTML report, its CSS,
// scripts and pictures beside it: the key is in the path, so its relative links carry it). Sandboxed, an origin of its
// own: it reads nothing of the daemon's or other files; https: for a CDN's script, style, font or picture (no fetch or
// XHR: connect-src; a picture's URL can still carry words out, as any page's can). ponytail: 50 MB a file
// ponytail: https: scripts and pictures stay, agents' reports load Chart.js and the like from a CDN; 'unsafe-inline'
// lets a page do inline whatever a CDN's script would, so dropping https: from script-src alone keeps nothing out
const ART_TYPES: Record<string, string> = { ...TYPES, '.htm': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf' }
function artifactPage(path: string, origin: string | undefined, res: ServerResponse) {
  const no = (code: number, text: string) => (res.writeHead(code, { 'content-type': 'text/plain' }), res.end(text))
  const m = /^\/artifact\/([0-9a-f]+)\/([\w.-]+)\/(.+)$/.exec(path)
  const key = Buffer.from(m?.[1] ?? '')
  if (!m || key.length !== widgetKey.length || !timingSafeEqual(key, Buffer.from(widgetKey))) return no(401, 'bad key')
  let body: Buffer
  let file: string
  try {
    file = core.artifactFile(m[2], decodeURIComponent(m[3]))
    if (statSync(file).size > 50 << 20) return no(413, 'over 50 MB')
    body = readFileSync(file)
  } catch {
    return no(404, 'not there')
  }
  res.writeHead(200, {
    'content-type': ART_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; media-src 'self' data: https:",
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...(origin === 'null' && !/^text\/html/.test(ART_TYPES[extname(file).toLowerCase()] ?? '') && { 'access-control-allow-origin': 'null' }), // its page's module scripts and fonts: CORS loads, from its opaque origin (sandboxed: Origin null)
  })
  res.end(body)
}

// ---------- the API: same methods over HTTP and WebSocket

type Handler = (p: any, c?: core.Conn) => unknown
const api: Record<string, Handler> = {
  ping: () => 'pong',
  state: () => core.view(),
  projectAdd: p => core.projectAdd(p.path),
  projectRm: p => core.projectRm(p.id),
  projectSet: p => core.projectSet(p.id, p),
  memoryAdd: p => core.memoryAdd(p), // an agent's (auto-memory), or --mine
  memoryRm: p => core.memoryRm(p), // an agent's only
  projectFile: p => core.projectFileConfig(p.id),
  branches: p => core.branches(p.project),
  wsNew: p => core.wsNew(core.byCaller(p)),
  quickNew: p => core.quickNew(p),
  wsRm: p => core.wsRm(p.id),
  wsArchive: p => core.wsArchive(p.id, { ifClean: !!p.ifClean }),
  doctor: () => core.doctor(),
  wsFan: p => core.wsFan(core.byCaller(p)),
  answer: p => core.answer(p),
  unread: p => core.unread(p.tab),
  browse: p => core.browse(p),
  timer: p => core.timer(p),
  browseDone: p => core.browseDone(p),
  wsRestore: p => core.wsRestore(p.id),
  wsFork: p => core.wsFork(p.id),
  tabNew: p => {
    const t = core.addTab(p.ws, p)
    core.layoutPlace(t, p.beside, p.edge) // beside a pane, or the one you're on (settings.splitNew)
    return t
  },
  layoutSet: p => core.layoutSet(p),
  layoutMove: p => core.layoutMove(p),
  tabFocus: p => core.tabFocus(p),
  todoAdd: p => core.todoAdd(p),
  todoRm: p => core.todoRm(p),
  memoryCompact: p => memoryCompact(p),
  memoryCompactLog: p => memoryCompactLog(p),
  memoryTick: p => memoryTick(p.now), // tests move the clock
  cliState: () => core.cliState(),
  cliInstall: () => core.cliInstall(),
  cliRemove: () => core.cliRemove(),
  reminderAdd: p => core.reminderAdd(p),
  reminderSet: p => core.reminderSet(p),
  reminderRm: p => core.reminderRm(p),
  reminderTick: p => core.reminderTick(p.now), // tests move the clock
  tabClose: p => core.closeTab(p.id),
  tabSet: p => core.tabSet(p),
  settingsSet: p => core.settingsSet(p),
  openIn: p => core.openIn(p),
  apps: () => core.apps(),
  wsSet: p => core.wsSet(p),
  reorder: p => core.reorder(p),
  imageSave: p => core.imageSave(p),
  prFix: p => core.prFix(p),
  logs: p => core.logs(p), // development mode's: ws:<id> or widget:<id>
  progress: p => core.progress(p),
  prAttach: p => core.prAttach(p), // the app's Attach PR, related's Make primary: { ws, pr: a URL or number }
  prDetach: p => core.prDetach(p), // { ws }: its linked PR to related (not its own)
  phoneTick: () => core.phoneTick(), // answers from the phone now (tests: not every 5 s)
  prList: p => core.prList(p), // Laki AI's laki_prs: a project's open PRs
  prRefresh: () => core.scanPRs(), // every PR again now (the status bar's Refresh): one scan at a time, so autoPR never sends twice
  webhookTest: p => core.webhookTest(p),
  uiReset: () => core.uiReset(),
  portKill: p => core.portKill(p),
  meme: () => meme(),
  aiAsk: p => aiAsk(p, (method, params) => call(method, params) as Promise<any>), // Laki's own AI: its tools call this API here
  aiState: p => aiState(p), // chat: a spec's or brainstorm's (planChat), else the AI page's
  aiQuestion: p => aiQuestion(p), // the skill's laki_ask and laki_remove: a question with buttons, only while an ask works
  aiPermission: p => (p.ext ? widgetPermission(p) : aiPermission(p)), // laki mcp's laki_permission (claude -p's permission prompt): Allow / Deny in the chat (an extension's: the app's dialog), waited for
  aiAnswer: p => aiAnswer(p, (method, params) => call(method, params) as Promise<any>), // the AI page's buttons: a removal is done here, on Yes
  aiNew: p => aiNew(p), // the AI page's: the chat it ends kept among the earlier ones (aiChats)
  aiChats: () => aiChats(),
  aiOpen: p => aiOpen(p),
  aiChatRm: p => aiChatRm(p),
  aiImage: p => aiImage(p), // a message's pasted image as a data URL
  aiStop: p => aiStop(p),
  aiContinue: p => aiContinue(p), // an ended chat (a spec's, unused 12 hours) taken up again
  aiTick: p => aiTick(p.now), // tests move the clock
  aiKey: p => aiKey(p),
  voiceText: p => voiceText(p), // Settings › Voice's cloud: { audio: WAV in base64 } → { text }
  send: p => core.send(p),
  queueClear: p => core.clearQueue(p.target),
  hook: p => core.hook(p),
  diff: p => core.diff(p.ws),
  files: p => core.files(p.ws),
  fileNew: p => core.fileNew(p),
  fileRead: p => core.fileRead(p),
  artifactList: p => core.artifactList(p.ws),
  fileWrite: p => core.fileWrite(p),
  hunkUndo: p => core.hunkUndo(p), // Changes' Revert: a hunk or lines of it, a whole file; hunkRedo is its Undo
  fileUndo: p => core.fileUndo(p),
  hunkRedo: p => core.hunkRedo(p),
  skills: () => skills(),
  skillSet: p => skillSet(p),
  prComment: p => core.prComment(p),
  prAct: p => core.prAct(p),
  prThreads: p => core.prThreads(p.ws),
  prDiff: p => core.prDiff(p.ws),
  prFiles: p => core.prFiles(p.ws),
  prViewed: p => core.prViewed(p),
  run: p => core.runDev(p.ws, p.script),
  device: p => device(p), // laki screen's: the iOS Simulator and apps' windows
  cloudflared: (o: { ws?: string }) => core.cloudflared(o),
  usage: () => usage(core.state.settings?.usage, usageWho()),
  accounts: () => accountViews(),
  accountAdd: p => accountAdd(p),
  accountSet: p => accountSet(p),
  accountRm: p => accountRm(p),
  accountLogin: p => core.accountLogin(p),
  tabAccount: p => core.tabAccount(p),
  resources: () => core.resources(),
  shareStart: p => core.shareStart(p), // a tab's read-only page, for anyone with its link
  shareStop: p => core.stopShares({ tab: core.resolveTarget(String(p.tab ?? '')).id }),
  // Resources' Stop for what the daemon runs (resources' others): Laki AI's ask, a tunnel, remote access, an extension's stream or agent
  resourceStop: p => {
    const k = String(p.key ?? '')
    const t = k.match(/^tunnel:(.+):(\d+)$/)
    if (k === 'ai') return aiStop()
    if (k === 'remote') return core.remoteStop()
    if (k === 'share') return core.stopShares()
    if (k.startsWith('stream:')) return widgetStreamStop(k.slice(7))
    if (k.startsWith('agent:')) return stopAgents(k.slice(6)) // an extension's agent runs
    if (t) return core.tunnelStop({ ws: t[1], port: Number(t[2]) })
    throw new Error(`nothing to stop called ${k}`)
  },
  sleepTick: p => core.sleepTick(p?.now), // tests move the clock
  tabSleep: p => core.sleepNow(p.tab),
  tabWake: p => core.wake(p.tab), // a pane already on it: a look doesn't attach again
  tunnelStart: p => core.tunnelStart(p),
  tunnelStop: p => core.tunnelStop(p),
  ship: p => core.ship(p.ws, p.message),
  screen: p => core.screen(p.target, p.lines, p.by, p.all === true),
  input: (p, c) => core.input(p.tab, p.data, c),
  resize: (p, c) => core.resize(p.tab, p.cols, p.rows, c),
  view: (p, c) => c && core.setView(c, p),
  detach: (p, c) => c && core.sessions.get(p.tab)?.detach(c),
  watchLimits: p => core.watchLimits(p.now), // tests move the clock
  scheduleSet: p => core.scheduleSet(p),
  scheduleRm: p => core.scheduleRm(p.id),
  scheduleRun: p => core.scheduleRun(p.id),
  scheduleTick: p => core.scheduleTick(p.now), // tests move the clock
  remoteStart: p => core.remoteStart(p),
  remoteStop: () => core.remoteStop(),
  remoteTick: p => core.remoteTick(p.now), // tests move the clock
  archivedTidy: p => core.archivedTidy(p.now), // tests move the clock
  shareTick: p => core.shareTick(p.now),
  tunnelTick: p => core.tunnelTick(p.now), // tests move the clock
  widgetRender: p => widgetRender(p),
  widgetSet: p => widgetSet(p),
  widgetRun: p => widgetRun(p),
  widgetRm: async p => (r => (aiForget(`widget:${p.id}`), r))(await widgetRm(p)), // Settings' Delete: to the trash (Undo: widgetRestore); never MCP's nor Laki AI's; its studio chat with it, once it's gone
  widgetRestore: p => widgetRestore(p), // Undo of a delete, laki widget restore
  widgetTrash: () => widgetTrash(), // laki widget trash
  widgetUndo: p => widgetUndo(p), // the studio's Undo and Undo to here
  widgetRemix: p => widgetRemix(p), // Remix: a copy of any one, yours, Laki AI may change it
  widgetSlug: p => widgetSlug(p), // the studio's first ask: a new one's id
  widgetAction: p => widgetAction(p),
  widgetReload: () => widgetReload(),
  widgetFiles: p => widgetFiles(p),
  widgetFileSave: p => widgetFileSave(p),
  widgetWrite: p => widgetWrite(p), // Laki AI's and MCP's: saved off
  widgetTick: p => widgetTick(p.now), // tests move the clock
  widgetTrashTidy: p => widgetTrashTidy(p.now), // tests move the clock
  widgetPush: p => widgetPush(p),
  widgetTools: () => widgetTools(),
  widgetToolCall: p => widgetToolCall(p),
  widgetToolAnswer: p => widgetToolAnswer(p),
  widgetGrantRm: p => widgetGrantRm(p),
  widgetRuns: p => widgetRuns(p), // the inspector's Runs, Env, fixtures; laki widget dev's lines
  widgetMock: p => widgetMock(p), // the inspector's sample data: by hand or a fixture, off
  widgetDev: p => widgetDev(p), // laki widget dev: link, unlink, list
  widgetNew: p => widgetNew(p), // laki widget new, Settings › Extensions › New ▾: a starter, yours, on
  widgetCheck: p => widgetCheck(p), // laki widget check, the inspector's Check (run: its fetch once), MCP's (never runs)
  noteList: p => noteList(p), // notes (experimental): notes.ts
  noteGet: p => noteGet(p),
  noteNew: p => noteNew(p),
  noteSave: p => noteSave(p),
  noteRm: p => noteRm(p),
  noteUpload: p => noteUpload(p),
  noteFile: p => noteFile(p),
  planList: p => planList(p), // specs and brainstorms (experimental): plans.ts
  planNew: p => planNew(p),
  planGet: p => planGet(p),
  planSave: p => planSave(p),
  planFile: p => planFile(p),
  planUpload: p => planUpload(p),
  planWrite: p => planWrite(p), // MCP's and Laki AI's laki_plan_write: never the editor's own files
  planRm: p => {
    const chat = planChat({ ...p, project: core.findProject(p.project).id }) // chats are by the project's id
    planRm(p) // the app's Delete, after its confirm: never MCP's nor Laki AI's; its chat goes too
    aiForget(chat)
  },
  flowList: p => flowList(p), // workflows (experimental): workflow.ts
  flowSave: p => flowSave(p),
  flowRm: p => flowRm(p), // the app's Delete, after its confirm
  flowStart: p => flowStart(p),
  flowStop: p => flowStop(p),
  flowAnswer: p => flowAnswer(p),
  flowTest: p => flowTest(p), // the inspector's Test: one AI call, decision or webhook, alone
  flowGet: p => flowGet(p),
  flowForget: p => flowForget(p),
  flowTick: p => flowTick(p.now), // tests move the clock
  shutdown: () => void setTimeout(shutdown, 50),
}

async function call(method: string, params: any, c?: core.Conn) {
  const h = Object.hasOwn(api, method) ? api[method] : undefined
  if (!h) throw new Error(`unknown method ${method}`)
  return await h(params ?? {}, c)
}

const server = createServer(async (req, res) => {
  const reply = (code: number, body: unknown) => {
    const text = JSON.stringify(body) // before the head: a body that won't serialize becomes an error reply
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(text)
  }
  if (!hostOk(req.headers.host)) return reply(421, { error: 'host not allowed' })
  if (req.method === 'GET') {
    const u = new URL(req.url ?? '/', 'http://x')
    const w = /^\/widget\/([\w.-]+)$/.exec(u.pathname) // a JS widget's page: its own key, its own CSP
    const plan = u.pathname.startsWith('/plan/') // a brainstorm's prototype: the same
    if (u.pathname.startsWith('/artifact/')) return artifactPage(u.pathname, req.headers.origin, res) // an artifact in the app's viewer: the key in its path
    if (!w && !plan) return page(u.pathname, res) // no secrets: any origin
    const r = w ? widgetPage(w[1], u.searchParams) : planPage(u.pathname, u.searchParams)
    res.writeHead(r.code, r.headers)
    return res.end(r.body)
  }
  if (!originOk(req.headers.origin)) return reply(403, { error: 'origin not allowed' })
  // remote access's PIN (core.remotePin): from its page only, with the link's key in the body
  if (req.method === 'POST' && req.url === '/pin') {
    if (!req.headers.origin || req.headers.origin !== core.remoteOrigin()) return reply(403, { error: 'origin not allowed' })
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 4096) return reply(413, { error: 'too big' })
    }
    try {
      return reply(200, core.remotePin(JSON.parse(body) ?? {}))
    } catch (e) {
      return reply(200, { error: (e as Error).message })
    }
  }
  if (req.method !== 'POST' || req.url !== '/rpc') return reply(404, { error: 'not found' })
  if (!tokenOk(req.headers.authorization?.replace(/^Bearer /, ''), req.headers.origin)) return reply(401, { error: 'bad token' })
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 16 << 20) return reply(413, { error: 'too big' })
  }
  try {
    const { method, params } = JSON.parse(body)
    reply(200, { result: (await call(method, params)) ?? null })
  } catch (e) {
    reply(200, { error: (e as Error).message })
  }
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 << 20 }) // a pasted 20 MB image, in base64
let clientSeq = 0
server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '', 'http://x')
  if (url.pathname !== '/ws' || !hostOk(req.headers.host) || !originOk(req.headers.origin) || !tokenOk(url.searchParams.get('token'), req.headers.origin)) {
    log('refused websocket', req.headers.origin ?? '(no origin)')
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return
  }
  wss.handleUpgrade(req, socket, head, ws => {
    const c: core.Conn = {
      id: ++clientSeq,
      send: msg => {
        if (ws.readyState !== ws.OPEN) return
        // a stalled client (asleep, hung): drop it rather than buffer without bound; it reconnects and
        // re-attaches from a snapshot
        if (ws.bufferedAmount > 32 << 20) return ws.terminate()
        ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)) // a string: JSON already (core's state, made once for all)
      },
    }
    core.clients.add(c)
    core.hello(c)
    widgetAsks(c) // an extension's asks still waiting: this window shows them too
    if (core.clients.size === 1) widgetTick(undefined, 'open'), core.reminderTick(), widgetEvent('app.open') // the app is back: what fell due meanwhile
    ws.on('message', async raw => {
      let m: { id?: number; method: string; params?: any }
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }
      if (m.method === 'attach') {
        try {
          core.wake(m.params?.tab) // a look wakes an agent put to sleep
        } catch (e) {
          log('wake', e) // its folder gone: the old screen, which says so
        }
        const s = core.sessions.get(m.params?.tab)
        if (!s) return c.send({ id: m.id, error: `no session ${m.params?.tab}` })
        if (m.params.cols) core.resize(s.tab, m.params.cols, m.params.rows)
        return s.attach(c, m.params.cols, m.params.rows, r =>
          c.send(r ? { id: m.id, result: { ...r, responder: true, exited: s.exited } } : { id: m.id, error: 'superseded by a newer attach' }),
        )
      }
      try {
        const result = await call(m.method, m.params, c)
        if (m.id !== undefined) c.send({ id: m.id, result: result ?? null })
      } catch (e) {
        if (m.id !== undefined) c.send({ id: m.id, error: (e as Error).message })
      }
    })
    ws.on('close', () => {
      core.clients.delete(c)
      for (const s of core.sessions.values()) s.detach(c)
    })
  })
})

const timers: NodeJS.Timeout[] = []
server.listen(Number(process.env.LAKI_PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : 0
  const info = join(dir, 'daemon.json')
  writeFileSync(info, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 })
  chmodSync(info, 0o600)
  log(`laki daemon on 127.0.0.1:${port} (pid ${process.pid}, data ${dir})`)
  core.setDaemonPort(port)
  const every = (ms: number, f: () => unknown) => timers.push(setInterval(() => Promise.resolve(f()).catch(e => log(e)), ms))
  every(Number(process.env.LAKI_PORT_SCAN_MS || 5000), core.scanPorts)
  const prMs = Number(process.env.LAKI_PR_SCAN_MS) // tests' pace; else each minute, scanning every settings.prScan minutes
  every(prMs || 60000, () => (prMs ? core.scanPRs() : core.prTick()))
  every(2000, core.sweepRunning)
  every(2000, core.shellTick)
  every(60000, () => core.sleepTick())
  every(Number(process.env.LAKI_STAT_SCAN_MS || 10000), core.scanStats)
  every(30000, () => core.watchLimits())
  every(15000, () => (core.remoteTick(), core.shareTick(), core.tunnelTick()))
  every(30000, () => core.scheduleTick())
  every(30000, () => core.reminderTick())
  every(1800000, () => memoryTick())
  every(30000, () => widgetTick())
  every(5000, () => flowTick())
  every(600000, () => aiTick()) // a spec's or brainstorm's chat unused 12 hours ends
  every(3600000, () => (core.imagesTidy(), core.archivedTidy(), widgetTrashTidy())) // pasted images past settings.imageDays, archived workspaces past archivedDays, deleted extensions past 30 days
  setTimeout(() => (core.archivedTidy(), widgetTrashTidy(), core.state.settings?.bgRefresh !== false && core.scanPRs().catch(() => {})), 2000)
})

function shutdown() {
  log('shutting down')
  timers.forEach(clearInterval)
  core.stopTunnels()
  core.stopShares()
  core.remoteStop()
  flowStopAll() // a run block's command
  aiStop() // its claude -p or codex would go on, and their laki mcp start a daemon again
  core.stopHosts()
  widgetsStop() // dev mode's watchers
  try {
    core.keepShells() // what the shells run, for the next start
  } catch (e) {
    log('keeping shells', e) // the stop goes on
  }
  for (const s of core.sessions.values()) s.kill()
  core.sessions.clear() // their exits aren't ones to act on (onExit)
  rmSync(join(dir, 'daemon.json'), { force: true })
  rmSync(lockPath, { force: true })
  server.close()
  setTimeout(() => process.exit(0), 300)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('uncaughtException', e => log('uncaught', e))
process.on('unhandledRejection', e => log('unhandled', e))
