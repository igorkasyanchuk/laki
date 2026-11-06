// The terminal host: owns PTYs, state and scans; outlives the app. Reached over 127.0.0.1 only:
// POST /rpc (Authorization: Bearer <token>) and a WebSocket at /ws?token=<token>. The token lives in
// <data>/daemon.json (0600); a browser page can't read it, and an Origin that isn't ours is refused anyway.
import { execFileSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { chatImport, chatList } from './chats.ts'
import { aiAnswer, aiAsk, aiChatRm, aiChats, aiContinue, aiForget, aiImage, aiKey, aiNew, aiOpen, aiPermission, aiQuestion, aiState, aiStop, aiTick, aiUnqueue, studioChatRm, studioChats, voiceText } from './ai.ts'
import { planChat } from '../shared/plans.ts'
import { readCapped } from '../shared/conn.ts'
import { API, HIDDEN } from '../shared/types.ts'
import { CAPS, oldName } from '../shared/caps.ts'
import { meme } from './fun.ts'
import * as core from './core.ts'
import { dir, inRig } from './dir.ts'
import * as scheduleMod from './schedule.ts'
import * as hostsMod from './hosts.ts'
import * as prMod from './pr.ts'
import * as filesMod from './files.ts'
import * as remoteMod from './remote.ts'
import * as resourcesMod from './resources.ts'
import * as artifactsMod from './artifacts.ts'
import * as metersMod from './meters.ts'
import * as phoneMod from './phone.ts'
import { policyTick } from './policy.ts'
import { ticketTick } from './tickets.ts'
import { agentCommands, refreshSkills, skills, skillSet } from './skill.ts'
import { accountAdd, accountRm, accountSet, accountViews, agentModels, usageWho } from './accounts.ts'
import { usage } from './usage.ts'
import { chatWithApps, mcpAppCall, mcpPage } from './mcpApps.ts'
import { planFile, planGet, planList, planNew, planPage, planRm, planSave, planUpload, planWrite } from './plans.ts'
import { noteFile, noteGet, noteList, noteNew, noteRm, noteSave, noteUpload, todoListGet, todoListSave } from './notes.ts'
import { checkAgain, checkStop, checkTidy } from './verify.ts'
import { sideAsk, sideNew, sideState, tabHandover, turnDiff, turnsTidy, turnUndo } from './turns.ts' // turnStarts, turnEnds: each turn's changes, the next prompt
import { alertAnswer, alertShow, noticesTo } from './alerts.ts'
import { secretAsk, secretGive, secretsTidy } from './secrets.ts'
import { flowAnswer, flowEvent, flowTest, flowForget, flowGet, flowHistory, flowList, flowPause, flowRestore, flowResume, flowRevert, flowRm, flowSave, flowStart, flowStop, flowFirst, flowStopAll, flowTick, flowTrash, flowTrashTidy, flowTrust } from './workflow.ts'
import { factsTick, scanWidgets, stopAgents, widgetRemix, widgetRestore, widgetTrash, widgetTrashTidy, widgetSlug, widgetUndo, widgetAction, widgetEvent, widgetGrantRm, widgetPush, widgetStreamStop, widgetAsks, widgetPermission, widgetToolAnswer, answered, widgetToolCall, widgetTools, widgetCheck, widgetDev, widgetFileSave, widgetFiles, urlKeyOk, widgetMock, widgetNew, widgetPage, widgetReload, widgetRender, widgetRm, widgetRun, widgetRuns, widgetSet, widgetsStop, widgetTick, widgetWhat, widgetWrite, widgetLogs, widgetLog, widgetLogClear, widgetEmit, widgetEvents } from './widgets.ts'
import { memoryCompact, memoryCompactLog, memoryTick } from './memory.ts'
import { device, sim } from './device.ts'

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
policyTick() // a managed policy: before any tab starts again (spawnTab checks it), then every 5 minutes
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
// LAKI_DEV_ORIGIN: a dev renderer's, on this Mac only (launchctl setenv reaches a daemon the CLI starts too)
const origins = new Set(['file://', ...(process.env.LAKI_DEV_ORIGIN?.split(',').filter(o => /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o)) ?? [])])
// remote access (core.ts) adds its page's origin and its own token while it runs
const originOk = (o: string | undefined) => o === undefined || origins.has(o) || (!!o && o === remoteMod.remoteOrigin())
const { same } = remoteMod
// remote access's token only from its page: a client with no Origin (curl past Cloudflare's sign-in) needs ours
// ponytail: any program of the same user can read daemon.json's token: a Keychain item or a peer check if that matters
// M5: remote access's Origin takes its token only: ours with it would skip the caller check (whoCalls) as a phone's page
const tokenOk = (t: string | null | undefined, o: string | undefined) => !!t && (!!o && o === remoteMod.remoteOrigin() ? same(t, remoteMod.remoteToken()) : same(t, token))
// the Host a request names: this daemon's own address, or remote access's while it runs. A page on another site whose
// name was pointed at 127.0.0.1 (DNS rebinding) names its own: turned away on every route
let port = 0
const hostOk = (h: string | undefined) => h === `127.0.0.1:${port}` || h === `localhost:${port}` || (!!h && h === (o => o && new URL(o).host)(remoteMod.remoteOrigin()))

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
// own: it reads nothing of the daemon's or other files; https: for a CDN's script, style, font or picture. fetch and
// XHR only to its own folder here (connect-src by path), so a report reads the JSON beside it, never the workspace's
// other artifacts (a picture's URL can still carry words out, as any page's can). ponytail: 50 MB a file
// ponytail: https: scripts and pictures stay, agents' reports load Chart.js and the like from a CDN; 'unsafe-inline'
// lets a page do inline whatever a CDN's script would, so dropping https: from script-src alone keeps nothing out
const ART_TYPES: Record<string, string> = { ...TYPES, '.htm': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf' }
// L7: an extension's https picture for the app window, whose CSP takes none from elsewhere (GitHub's avatars aside):
// fetched here, https all the way, an image's type only, 10 MB at most; the key the view gives (imgKey). An SVG is a
// picture in an <img> (no scripts); opened on its own, its CSP runs none either
const IMG = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)\b/i
// an https address on the internet, by its name: no IP literal of this Mac or a private network, no localhost.
// ponytail: a name that resolves to one (DNS) still goes; a lookup before each fetch if that matters
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i
const webOk = (u: string) => URL.canParse(u) && (x => x.protocol === 'https:' && !PRIVATE_HOST.test(x.hostname))(new URL(u))
async function imgPage(q: URLSearchParams, res: ServerResponse) {
  const no = (code: number, text: string) => (res.writeHead(code, { 'content-type': 'text/plain' }), res.end(text))
  if (!urlKeyOk(q.get('k') ?? '', 'img')) return no(401, 'bad key')
  const u = q.get('u') ?? ''
  if (!webOk(u)) return no(400, 'an https picture only')
  try {
    // redirects one at a time, each https and not this Mac's or the LAN's (a picture's link can't make the daemon ask them)
    let r: Response | undefined
    const signal = AbortSignal.timeout(15000)
    for (let at = u, n = 0; n < 5; n++) {
      r = await fetch(at, { signal, headers: { accept: 'image/*' }, redirect: 'manual' })
      const to = r.status >= 300 && r.status < 400 && r.headers.get('location')
      if (!to) break
      at = new URL(to, at).href
      if (!webOk(at)) return no(502, 'not a picture')
      r = undefined
    }
    const type = r?.headers.get('content-type') ?? ''
    if (!r?.ok || !IMG.test(type)) return no(502, 'not a picture')
    if (Number(r.headers.get('content-length')) > 10 << 20) return no(413, 'over 10 MB')
    const { buf: body, cut } = await readCapped(r, 10 << 20)
    if (cut) return no(413, 'over 10 MB')
    res.writeHead(200, { 'content-type': type, 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
    res.end(body)
  } catch {
    no(502, 'not reached')
  }
}

const ART_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; media-src 'self' data: https:"
function artifactPage(path: string, origin: string | undefined, host: string | undefined, res: ServerResponse) {
  const no = (code: number, text: string) => (res.writeHead(code, { 'content-type': 'text/plain' }), res.end(text))
  const m = /^\/artifact\/([0-9a-f]+)\/([\w.-]+)\/(.+)$/.exec(path)
  if (!m || !urlKeyOk(m[1], `artifact:${m[2]}`)) return no(401, 'bad key') // that workspace's key only
  let body: Buffer
  let file: string
  try {
    file = filesMod.artifactFile(m[2], decodeURIComponent(m[3]))
    if (statSync(file).size > 50 << 20) return no(413, 'over 50 MB')
    body = readFileSync(file)
  } catch {
    return no(404, 'not there')
  }
  res.writeHead(200, {
    'content-type': ART_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    // fetch: its own folder and under it (hostOk checked the host; a raw ; or , in the path can't add a directive), not
    // the rest of the storage folder
    'content-security-policy': host ? `${ART_CSP}; connect-src ${host}${path.slice(0, path.lastIndexOf('/') + 1).replace(/[;,\s]/g, encodeURIComponent)}` : ART_CSP,
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
  ping: p => (p.caps ? { pong: true, api: API, caps: CAPS } : 'pong'), // plain: 'pong', as every CLI's alive() wants
  state: () => core.view(),
  projectAdd: p => core.projectAdd(p.path, !core.agentCaller(p.from)), // an agent's: never out of the archive
  projectRm: p => core.projectRm(p.id),
  projectArchive: p => core.projectArchive({ project: p.project, on: p.on !== false }),
  updateIdle: p => core.updateWhenIdle({ on: p.on, caller: p.caller }),
  agentModels: p => agentModels({ agent: p.agent, preset: p.preset }),
  projectSet: p => core.projectSet(p.id, p),
  memoryAdd: p => core.memoryAdd({ ...p, tab: p.from?.tab ?? p.tab }), // an agent's (auto-memory), or --mine (yours: agentNo); by: the tab found by its process
  memoryRm: p => core.memoryRm(p), // an agent's only
  projectFile: p => core.projectFileConfig(p.id),
  projectTrust: p => core.projectTrust(p),
  branches: p => core.branches(p.project),
  csMachines: p => hostsMod.csMachines(p),
  wsNew: p => core.wsNew(yours(core.byCaller(p))),
  quickNew: p => core.quickNew(p),
  wsRm: p => core.wsRm(p.id),
  wsPeek: p => core.wsPeek(p.id), // what Delete would take with it (the app's question)
  overlapCheck: p => filesMod.overlapCheck(String(p.ws ?? '')), // the workspace menu's Check overlaps: one worktree's now, the radar on or off
  wsStat: p => filesMod.wsStat(p), // a row's hover card: its diff's size now
  wsArchive: p => core.wsArchive(p.id, { ifClean: !!p.ifClean, force: p.force === true, from: p.from }), // { held }: a gate said no (force: yours only)
  doctor: () => core.doctor(),
  hookTick: p => core.hookTick(p?.now), // tests move the clock
  hooksSeen: () => core.hooksSeen(), // Settings › Agents & profiles: each agent's last hook
  wsFan: p => core.wsFan(yours(core.byCaller(p))),
  answer: p => core.answer(p),
  unread: p => core.unread(p.tab),
  seen: p => core.seen(p.tab), // the Needs you list's Seen: its ● cleared, as a look does
  show: p => core.show({ ...p, tab: p.from?.tab ?? p.tab }), // laki show: a card under the caller's own tab (its process's, when it's in one)
  showDone: p => core.showDone(String(p.tab ?? '')), // its ✕
  browse: p => core.browse(p),
  timer: p => core.timer(p),
  browseDone: p => core.browseDone(p),
  wsRestore: p => core.wsRestore(p.id),
  wsFork: p => core.wsFork(p.id),
  tabNew: async ({ caller, from, run: _run, hops: _hops, cwd: _cwd, cwdOf, ...p }) => { // run, hops: a workflow run's (core.Cause), never an RPC's; cwd: only cwdOf's shell's
    const by = core.agentCaller(caller) ?? core.saidFrom(from) // as wsNew's (byCaller)
    // an agent's: no command of its own, but a plain one (an orchestrator's dev server, laki new --tab) once you allow it
    // what addTab would refuse (no such workspace, a preset, a model…): before any question
    const at = core.findWs(String(p.ws ?? ''))
    if (at.archived) throw new Error(`${at.name ?? at.id} is archived: restore it first`)
    const spec = core.tabSpec(at, p)
    await core.modelKnown(spec.preset, spec.kind === 'agent' ? spec.model || spec.pr?.model?.trim() : undefined, at, p.preset)
    const cwd = cwdOf === undefined ? undefined : await core.shellCwd(p.ws, cwdOf)
    if (by && p.cmd?.trim() && (!p.preset || p.preset === 'custom')) await cmdAsk(caller, by, at.id, p.cmd)
    else if (by) core.agentNoCmd(p)
    if (p.prompt) await crossAsk({ ws: p.ws, from: caller }, 'send', null, p.prompt) // a prompt into another workspace: asked, as a send is
    // its tab.new: the agent's (MCP's from alone: its preset unknown; MCP outside Laki and Laki AI say so themselves)
    const t = core.addTab(p.ws, { ...p, cwd, agent: core.callerAgent(caller) ?? (by ? 'agent' : core.agentIn(p.agent)) })
    core.layoutPlace(t, p.beside, p.edge) // beside a pane, or the one you're on (settings.splitNew)
    return t
  },
  layoutSet: p => core.layoutSet(p),
  layoutMove: p => core.layoutMove(p),
  tabFocus: p => core.tabFocus(p),
  todoAdd: p => scheduleMod.todoAdd(p),
  todoRm: p => scheduleMod.todoRm(p),
  memoryCompact: p => memoryCompact(p),
  memoryCompactLog: p => memoryCompactLog(p),
  memoryTick: p => memoryTick(p.now), // tests move the clock
  cliState: () => core.cliState(),
  cliInstall: () => core.cliInstall(),
  cliRemove: () => core.cliRemove(),
  reminderAdd: p => scheduleMod.reminderAdd(p),
  reminderSet: p => scheduleMod.reminderSet(p),
  reminderRm: p => scheduleMod.reminderRm(p),
  reminderTick: p => scheduleMod.reminderTick(p.now), // tests move the clock
  tabClose: p => core.closeTab(p.id),
  tabSet: ({ from: _, ...p }) => core.tabSet(p), // from: whoCalls' (an agent names its own tab only: agentNo)
  settingsSet: ({ from: _, ...p }) => core.settingsSet(p), // from: whoCalls', not a setting
  storageInfo: () => core.storageInfo(), // Settings › General › Storage: its folder and size
  storageTidy: p => core.storageTidy(p.now), // tests move the clock
  presetSave: async p => (await presetAsk(p), core.presetSave(p)), // laki preset: one profile; an agent's asked in the app first
  openIn: p => core.openIn(p),
  apps: () => core.apps(),
  wsSet: p => core.wsSet(p),
  reorder: p => core.reorder(p),
  imageSave: p => core.imageSave(p),
  bgSet: p => core.bgSet(p), // Settings › Appearance › Background image
  bgGet: () => core.bgGet(),
  fileSave: p => core.fileSave(p),
  prFix: p => prMod.prFix(p), // { ws, what, job? }: job: only that check's
  prLog: p => prMod.prLog(p), // { ws, job }: a failing check's log, its steps named (Info's Log)
  logs: p => core.logs(p), // development mode's: ws:<id> or widget:<id>
  scriptLogs: () => core.scriptLogs(), // development mode's setup and teardown runs, the last 30 workspaces'
  progress: p => core.progress(p),
  tabHandover: p => tabHandover(p), // a tab's Continue in Codex / Claude Code
  turnDiff: p => turnDiff(p), // Changes' This turn
  turnUndo: p => turnUndo(p), // the Reader's card's Undo
  sideAsk: p => sideAsk(p), // Side chat: a question about an agent's work beside it (its chat forked)
  sideState: p => sideState(p),
  sideNew: p => sideNew(p),
  alertShow: p => alertShow(p), // laki alert: a card on screen; with choices, resolves as you pick (alerts.ts)
  noticeShow: p => alertShow(p, 'notice'), // laki notice: the same card inside Laki's window, kept until answered or closed
  alertAnswer: p => alertAnswer(p),
  secretAsk: p => secretAsk(p), // laki secret: resolves as you answer (secrets.ts)
  secretGive: p => secretGive(p),
  secretsTidy: p => secretsTidy(p.now), // tests move the clock
  prAttach: p => prMod.prAttach(p), // the app's Attach PR, related's Make primary: { ws, pr: a URL or number }
  prDetach: p => prMod.prDetach(p), // { ws }: its linked PR to related (not its own)
  phoneTick: () => phoneMod.phoneTick(), // answers from the phone now (tests: not every 5 s)
  prList: p => prMod.prList(p), // Laki AI's laki_prs: a project's open PRs
  prRefresh: () => prMod.scanPRs(), // every PR again now (the status bar's Refresh): one scan at a time, so autoPR never sends twice
  webhookTest: p => phoneMod.webhookTest(p),
  uiReset: () => core.uiReset(),
  portKill: p => resourcesMod.portKill(p),
  meme: () => meme(),
  aiAsk: ({ from, ...p }) => (core.agentCaller(from) || core.promptKeep(p.text), aiAsk(p, (method, params) => call(method, params) as Promise<any>)), // Laki's own AI (yours: its text in your prompts' history): its tools call this API here; from: whoCalls'
  aiUnqueue: p => aiUnqueue(p), // a message sent while it answered, taken back before it goes
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
  send: async p => (agentSend(p), await crossAsk(p, 'send'), core.send(p)),
  prompts: () => core.promptList(), // your prompts, newest first: the prompt boxes' history
  chatList: p => chatList(p), // Import chats: Claude Code's and Codex's sessions in the project's folders, outside Laki
  chatImport: p => chatImport(p),
  queueClear: async p => (await crossAsk(p, 'send', p.target, ''), core.clearQueue(p.target)),
  queueSet: async p => (await crossAsk(p, 'send', p.tab, Array.isArray(p.queue) ? p.queue.join('\n\n') : ''), core.queueSet(p)), // the queue strip's edit, reorder, remove
  queueNow: async p => (await crossAsk(p, 'send', p.tab, ''), core.queueNow(p.tab)), // its Send now: the turn stopped, the first one typed
  hook: ({ key: _, ...p }) => core.hook(p), // hookWho's first
  worktreeList: p => core.worktreeList(p.project),
  worktreeImport: p => core.worktreeImport(p),
  diff: p => filesMod.diff(p.ws, p.uncommitted === true), // uncommitted: against HEAD (Changes' and Review's Uncommitted)
  baseBranches: p => filesMod.baseBranches(p.ws), // Changes' base menu
  wsBase: p => filesMod.wsBase(p),
  files: p => filesMod.files(p.ws, p.project),
  fileNew: p => filesMod.fileNew(p),
  fileRead: p => filesMod.fileRead(p),
  artifactList: p => artifactsMod.artifactList(p.ws),
  linkRm: p => (notAgent(p, "take a kept link off (the user's, in the gallery)"), artifactsMod.linkRm(p.ws, String(p.url ?? ''))), // a kept link taken off (the gallery's right click)
  fileWrite: p => filesMod.fileWrite(p),
  hunkUndo: p => filesMod.hunkUndo(p), // Changes' Revert: a hunk or lines of it, a whole file; hunkRedo is its Undo
  fileUndo: p => filesMod.fileUndo(p),
  hunkRedo: p => filesMod.hunkRedo(p),
  skills: () => skills(),
  agentCommands: p => agentCommands(p), // the prompt boxes' / menu
  skillSet: p => skillSet(p),
  prComment: p => prMod.prComment(p),
  prReview: p => prMod.prReview(p),
  issueList: p => prMod.issueList(p),
  prAct: p => prMod.prAct({ ws: p.ws, act: p.act, method: p.method, deleteBranch: p.deleteBranch, force: p.force === true, from: p.from }),
  usageDays: () => metersMod.usageDays(), // the Usage page: tokens and $ by day, agent and model (Laki's claude and codex tabs)
  commits: p => filesMod.commits(p.ws), // the side panel's Commits: what the branch adds, each pushed or not
  commitDiff: p => filesMod.commitDiff(p.ws, p.sha),
  prDraft: p => prMod.prDraft({ ws: p.ws, draft: p.draft === true }), // { ws, draft }: Convert to draft / Ready for review
  prLabels: p => prMod.prLabels(p.ws),
  ghCard: p => prMod.ghCard(p), // a GitHub PR's or issue's card: a link hovered in a terminal
  prLabel: p => prMod.prLabel(p),
  prThreads: p => prMod.prThreads(p.ws, p.all === true), // all: everyone's comments (the full review's)
  prTalk: p => prMod.prTalk(p.ws), // the PR's conversation and review summaries, everyone's
  prSay: p => prMod.prSay(p), // a comment on the PR's conversation, as you (the full review's GitHub tab)
  blame: p => filesMod.blame(p), // the full review's: a file's lines' commits, old (the base's) or new (the worktree's)
  fileWeb: p => filesMod.fileWeb(p), // a file's page on origin's site, at the base or the branch
  prDiff: p => prMod.prDiff(p.ws),
  prFile: p => prMod.prFile(p.ws, p.path), // a file at the PR's head: the full review's expand arrows on PR #n
  prFiles: p => prMod.prFiles(p.ws),
  prViewed: p => prMod.prViewed(p),
  run: p => core.runDev(p.ws, p.script, core.callerAgent(p.caller)), // an agent's: its tab.new the agent's
  device: p => device(p), // laki screen's: the iOS Simulator and apps' windows
  sim: p => sim(p), // the side panel's Simulator: iOS Simulators and Android (adb) devices
  cloudflared: (o: { ws?: string }) => remoteMod.cloudflared(o),
  usage: (p?: { now?: number }) => usage(core.state.settings?.usage, usageWho(), p?.now, metersMod.statusLimits), // claude's status line's, while fresh
  accounts: () => accountViews(),
  accountAdd: p => accountAdd(p),
  accountSet: p => accountSet(p),
  accountRm: p => accountRm(p),
  accountLogin: p => core.accountLogin(p),
  agentUpdate: p => core.agentUpdate(p), // Update Claude Code, from the new-workspace page's warning
  tabAccount: p => core.tabAccount(p),
  resources: () => resourcesMod.resources(),
  shareStart: p => remoteMod.shareStart(p), // a tab's read-only page, for anyone with its link
  shareStop: p => remoteMod.stopShares({ tab: core.resolveTarget(String(p.tab ?? '')).id }),
  // Resources' Stop for what the daemon runs (resources' others): Laki AI's ask, a tunnel, remote access, an extension's stream or agent
  resourceStop: p => {
    const k = String(p.key ?? '')
    const t = k.match(/^tunnel:(.+):(\d+)$/)
    if (k === 'ai') return aiStop()
    if (k === 'remote') return remoteMod.remoteStop()
    if (k === 'share') return remoteMod.stopShares()
    if (k === 'tunnel:named') return remoteMod.stopTunnels(undefined, true) // the permanent tunnels' one cloudflared: all of them
    if (k.startsWith('stream:')) return widgetStreamStop(k.slice(7))
    if (k.startsWith('agent:')) return stopAgents(k.slice(6)) // an extension's agent runs
    if (t) return remoteMod.tunnelStop({ ws: t[1], port: Number(t[2]) })
    throw new Error(`nothing to stop called ${k}`)
  },
  sleepTick: p => resourcesMod.sleepTick(p?.now), // tests move the clock
  tabSleep: p => resourcesMod.sleepNow(p.tab),
  tabWake: p => resourcesMod.wake(p.tab), // a pane already on it: a look doesn't attach again
  tunnelStart: p => remoteMod.tunnelStart(p),
  tunnelStop: p => remoteMod.tunnelStop(p),
  tunnelCheck: p => remoteMod.tunnelCheck(p), // Settings › Tunnels: is the named tunnel ready
  ship: p => core.ship(p.ws, p.message, { force: p.force === true, from: p.from }),
  screen: async p => (await crossAsk(p, 'screen'), core.screen(p.target, p.lines, p.by, p.all === true)),
  input: async (p, c) => (await crossAsk(p, 'send', p.tab, p.data), typed(p, String(p.tab), String(p.data ?? '')), core.input(p.tab, p.data, c)),
  resize: (p, c) => core.resize(p.tab, p.cols, p.rows, c),
  view: (p, c) => c && core.setView(c, p),
  detach: (p, c) => c && core.sessions.get(p.tab)?.detach(c),
  watchLimits: p => core.watchLimits(p.now), // tests move the clock
  scheduleSet: ({ from, ...p }) => scheduleMod.scheduleSet(core.agentCaller(from) ? { ...p, on: false } : p), // an agent's: off, until you turn it on (M5)
  scheduleRm: p => scheduleMod.scheduleRm(p.id),
  scheduleRun: p => (notAgent(p, 'run a scheduled task now'), scheduleMod.scheduleRun(p.id)),
  scheduleTick: p => scheduleMod.scheduleTick(p.now), // tests move the clock
  pendingTick: p => scheduleMod.pendingTick(p.now),
  remoteStart: p => remoteMod.remoteStart(p),
  remoteStop: () => remoteMod.remoteStop(),
  remoteTick: p => remoteMod.remoteTick(p.now), // tests move the clock
  archivedTidy: p => core.archivedTidy(p.now), // tests move the clock
  shareTick: p => remoteMod.shareTick(p.now),
  tunnelTick: p => remoteMod.tunnelTick(p.now), // tests move the clock
  widgetRender: p => widgetRender(p),
  widgetSet: p => widgetSet(p),
  widgetLogs: p => widgetLogs(p), // the Logs tab (every 2 s, from its cursor), laki widget logs, MCP's laki_extension_logs
  widgetLog: p => widgetLog(p), // laki widget log, a JS page's laki.log: nothing while its log is off
  widgetLogClear: p => widgetLogClear(p), // the Logs tab's Clear
  widgetWhat: p => widgetWhat(String(p.id)), // what turning one on runs, in words, and its files' hash (widgetSet's seen): laki widget what, the turn-on sheet
  widgetRun: p => widgetRun(p),
  widgetRm: async p => (r => (aiForget(`widget:${p.id}`), r))(await widgetRm(p)), // Settings' Delete: to the trash (Undo: widgetRestore); never MCP's nor Laki AI's; its studio chat with it, once it's gone
  widgetRestore: p => widgetRestore(p), // Undo of a delete, laki widget restore
  widgetTrash: () => widgetTrash(), // laki widget trash
  widgetUndo: ({ from, ...p }) => widgetUndo({ ...p, agent: !!core.agentCaller(from) }), // the studio's Undo and Undo to here
  widgetRemix: p => widgetRemix(p), // Remix: a copy of any one, yours, Laki AI may change it
  widgetSlug: p => widgetSlug(p), // the studio's first ask: a new one's id
  studioChats: () => studioChats(), // the studio's chats, newest first: the app shows where you left off
  studioChatRm: p => studioChatRm(p),
  widgetAction: p => widgetAction(p),
  widgetReload: () => widgetReload(),
  widgetFiles: p => widgetFiles(p),
  widgetFileSave: p => widgetFileSave(p),
  widgetWrite: ({ from, by, chat, ...p }) => widgetWrite({ ...p, agent: by !== 'ai' || !!core.agentCaller(from), page: by === 'ai' && chat === `widget:${p.id}` }), // Laki AI's (aiRpc's by and chat) and MCP's: a new one saved off; agent: any other writer (an agent's tab, an MCP client outside Laki); page: Laki AI in its page's chat, the user's
  widgetTick: p => widgetTick(p.now), // tests move the clock
  factsTick: () => factsTick(), // tests: workspace facts read now
  widgetTrashTidy: p => widgetTrashTidy(p.now), // tests move the clock
  widgetPush: p => widgetPush(p),
  widgetEmit: async p => (await crossAsk(p, 'emit'), widgetEmit(p)), // laki widget emit, MCP's laki_extension_emit: custom.<name>; an agent's into another workspace asks first (#3)
  widgetEvents: () => widgetEvents(), // laki widget events: the last 50, what each reached
  widgetTools: p => widgetTools({ ws: p.ws }), // ws: the caller's workspace (a repo's only in its project's)
  widgetToolCall: p => widgetToolCall(p),
  widgetToolAnswer: p => widgetToolAnswer(p),
  widgetGrantRm: p => widgetGrantRm(p),
  widgetRuns: p => widgetRuns(p), // the inspector's Runs, Env, fixtures; laki widget dev's lines
  widgetMock: p => widgetMock(p), // the inspector's sample data: by hand or a fixture, off
  widgetDev: p => widgetDev(p), // laki widget dev: link, unlink, list
  widgetNew: p => widgetNew(p), // laki widget new, Settings › Extensions › New ▾: a starter, yours, on
  widgetCheck: p => widgetCheck(p), // laki widget check, the inspector's Check (run: its fetch once), MCP's (never runs)
  noteList: p => noteList(p), // notes: notes.ts
  noteGet: p => noteGet(p),
  noteNew: p => noteNew(p),
  noteSave: p => noteSave(p),
  noteRm: p => noteRm(p),
  noteUpload: p => noteUpload(p),
  noteFile: p => noteFile(p),
  todoListGet: () => todoListGet(), // To-dos: notes.ts
  todoListSave: p => todoListSave(p),
  planList: p => planList(p), // specs and brainstorms: plans.ts
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
  chatRead: p => chatWithApps(p), // Reader view: meters.ts, with its MCP Apps (mcpApps.ts)
  mcpAppCall: p => mcpAppCall(p), // an MCP App's own tool call, once you allowed it
  bgOutput: p => metersMod.bgOutput(p), // the Reader's chips: a background task's output
  checkAgain: p => checkAgain(p), // Done means checked: verify.ts
  checkStop: p => checkStop(p),
  flowList: p => flowList(p), // workflows: workflow.ts
  flowSave: ({ caller, ...p }) => flowSave(core.agentCaller(caller) ? { ...p, by: 'agent' } : p), // an agent's tab: marked, never trusted
  flowTrust: ({ caller, ...p }) => { // the editor's Allow: a project's workflow as the sheet showed it; never an agent's (it'd let its own file run)
    if (core.agentCaller(caller)) throw new Error("an agent can't trust a workflow: it's the user's (ask them)")
    return flowTrust(p)
  },
  flowPause: ({ caller, ...p }) => { // Turn on again (or pause): the user's; an agent's would let a failing one start itself again
    if (core.agentCaller(caller)) throw new Error("an agent can't pause or turn on a workflow: it's the user's (ask them)")
    return flowPause(p)
  },
  flowRm: ({ caller, ...p }) => flowRm(core.agentCaller(caller) ? { ...p, by: 'agent' } : p), // the app's Delete: to the trash, a toast's Undo is flowRestore; an agent's: back as an agent's
  flowRestore: ({ caller, ...p }) => flowRestore(core.agentCaller(caller) ? { ...p, by: 'agent' } : p), // an agent's: marked its own, as its save is
  flowTrash: () => flowTrash(), // laki flow trash
  flowTrashTidy: p => flowTrashTidy(p.now), // tests move the clock
  flowHistory: p => flowHistory(p), // the editor's History…: its versions, or one's text (at)
  flowRevert: ({ caller, ...p }) => flowRevert(core.agentCaller(caller) ? { ...p, by: 'agent' } : p), // #14: an agent's is its save: marked, never trusted
  flowStart: ({ caller, ...p }) => flowStart(core.agentCaller(caller) ? { ...p, by: 'agent', editor: false } : p), // the CLI in an agent's tab is an agent's start
  flowEvent: ({ caller, ...p }) => flowEvent(core.agentCaller(caller) ? { ...p, by: 'agent', editor: false, agent: core.callerAgent(caller) } : p), // tried as if on an event: an agent's try is an agent's event
  flowStop: p => flowStop(p),
  flowFirst: p => (notAgent(p, 'move a workflow run ahead of the queue'), flowFirst(p)), // Run First: a queued run goes next
  flowAnswer: p => (notAgent(p, "answer a workflow's question"), flowAnswer(p)),
  flowTest: p => flowTest(p), // the inspector's Test: one AI call, decision or webhook, alone
  flowGet: p => flowGet(p),
  flowForget: p => flowForget(p),
  flowTick: p => flowTick(p.now), // tests move the clock
  shutdown: () => void setTimeout(shutdown, 50),
}

// remote access's page (a phone): what it needs from there, not what outlives its session or opens Laki wider (M4)
const REMOTE_NO = new Set(['remoteStart', 'cliInstall', 'cliRemove', 'shutdown', 'aiKey', 'skillSet', 'accountAdd', 'accountLogin', 'agentUpdate', 'presetSave', 'hook']) // presetSave: a profile's args and env, as REMOTE_KEYS' presets; hook: agents' own (hookWho)
const REMOTE_KEYS = /^(remote.*|webhook|widgetDirs|widgetDev|presets|env|tunnel|customCss|editorCmd|editors)$/ // settings it may send back unchanged (Settings saves them all), not change; customCss: every window's look (it could hide or fake a button); editorCmd, editors: what Open in editor (⌘E) runs
// a settingsSet that changes one of these (sent back unchanged is fine: Settings saves them all)
const changes = (p: any, keys: RegExp) => Object.keys(p ?? {}).some(k => keys.test(k) && JSON.stringify(p[k]) !== JSON.stringify((core.state.settings as any)?.[k]))
const remoteNo = (method: string, p: any) =>
  REMOTE_NO.has(method) ||
  (method === 'widgetSet' && (p?.on === true || p?.net === true || p?.source !== undefined)) ||
  (method === 'settingsSet' && changes(p, REMOTE_KEYS))

// M5: a local client's caller by its process (core.tabOfPeer), for the methods that ask who: what the CLI and laki mcp
// say (from, caller: $LAKI_TAB) only names a tab; a process in a tab is that tab's, an agent's whatever its env says.
// Every local connection, its Origin or not (any tab can read daemon.json's token and say Origin: file://), but remote
// access's page (its own token, REMOTE_NO): the app's window is Electron's process, in no tab, so yours (a dev app
// started from a Laki tab counts as that tab). Looked up once per connection as a method first needs it (a WebSocket's
// as it opens), a hook's only without its key (hookWho); nothing found, or the client gone before the answer (its port may be another
// process's by then), is refused: it fails closed. ponytail: a process that leaves its tab's tree and its terminal
// (setsid, launchctl submit, open x.command, a tmux server) still counts as you; per-tab tokens are the real fix.
// FROM: from is the caller ({ ws, tab }); CALLER: caller is
const FROM = new Set(['alertShow', 'noticeShow', 'alertAnswer', 'flowFirst', 'wsSet', 'prompts', 'sideAsk', 'chatList', 'chatImport', 'turnUndo', 'tabHandover', 'secretAsk', 'secretGive', 'show', 'linkRm', 'tabSet', 'presetSave', 'wsArchive', 'prAct', 'prDraft', 'ship', 'send', 'screen', 'scheduleSet', 'scheduleRun', 'flowAnswer', 'widgetSet', 'widgetCheck', 'widgetRun', 'widgetAction', 'widgetDev', 'widgetEmit', 'widgetToolCall', 'widgetNew', 'widgetRestore', 'widgetToolAnswer', 'aiAnswer', 'answer', 'input', 'attach', 'widgetFileSave', 'remoteStart', 'settingsSet', 'memoryCompact', 'projectSet', 'projectTrust', 'memoryAdd', 'queueClear', 'queueSet', 'queueNow', 'tunnelStart', 'prReview', 'prComment', 'prSay', 'prThreads', 'prTalk', 'widgetWrite', 'widgetUndo', 'aiAsk', 'chatRead', 'shutdown', 'checkAgain', 'checkStop', 'worktreeImport', 'bgSet', 'sideNew', 'uiReset', 'projectArchive', 'projectAdd', 'wsBase', 'bgOutput', 'mcpAppCall', 'agentUpdate'])
const CALLER = new Set(['updateIdle', 'tabNew', 'wsNew', 'wsFan', 'run', 'flowSave', 'flowStart', 'flowEvent', 'flowTrust', 'flowPause', 'flowRevert', 'flowRm', 'flowRestore'])
const peers = new WeakMap<Socket, ReturnType<typeof core.tabOfPeer>>() // per connection: a CLI call's, laki mcp's, the app's
const trees = new WeakMap<Socket, Promise<void>>() // per connection: its tab's agent looked for (core.treeAgent)
const local = new WeakMap<core.Conn, Socket>() // a WebSocket client but remote access's: its socket
const peerOf = (sock: Socket) => {
  let t = peers.get(sock)
  if (!t) {
    const p = (t = core.tabOfPeer(sock.remotePort ?? 0))
    peers.set(sock, p)
    p.catch(() => peers.get(sock) === p && peers.delete(sock)) // not found: asked again at the next call, not refused for good
  }
  return t
}
async function whoCalls(sock: Socket, method: string, p: any) {
  if (!FROM.has(method) && !CALLER.has(method)) return p
  const tab = await peerOf(sock).catch(() => null)
  if (tab === null || sock.readableEnded || sock.destroyed) {
    log(`${method} refused: ${core.WHO} (port ${sock.remotePort})`) // a legit caller refused shows here
    throw new Error(core.WHO)
  }
  const o = p && typeof p === 'object' ? p : {}
  const said = FROM.has(method) ? o.from : o.caller // a process in no tab: what its env says (the CLI's caller())
  // #14: a shell tab's agent, whatever runs in front; once per connection, as its peer (a window's keys are calls)
  if (!trees.has(sock)) trees.set(sock, core.treeAgent(tab || core.state.tabs.find(t => t.id === said?.tab)))
  await trees.get(sock)
  if (!tab) return p
  const me = { ws: tab.workspace, tab: tab.id }
  return FROM.has(method) ? { ...o, from: { ...(o.from && typeof o.from === 'object' ? o.from : {}), ...me } } : { ...o, caller: me }
}
const notAgent = (p: any, what: string) => {
  if (core.agentCaller(p.from)) throw new Error(`an agent can't ${what}: it's the user's (ask them)`)
}
// M5: the user's alone, from an agent's tab (by its process): answering an ask (an extension's, Laki AI's, an agent's
// menu: its own included), an extension's files, a PR review or comment (gh posts it as you), remote access, memory's compaction (N11: it goes to a model), the settings remote access can't change either, and keys
// into a tab whose agent asks something (they'd answer it). N15: a project's trust and its config (setup, teardown, run,
// env, actions, PR switches: what runs in every new workspace, outside the agent's mode) and the memory list every
// agent starts with (an agent adds learned ones through memoryAdd, never the user's: --mine); its notes, name, groups
// and looks stay an agent's to change, and projectTrust's read (no hash). prThreads' all and prTalk: everyone's
// comments, for you to read; an agent gets only trusted reviewers' (autoPR's rule). laki stop: every session ends; the
// Done check's Check again and Stop: its scripts and its verdict are the user's. ponytail: an agent with a shell can still
// kill the daemon by daemon.json's pid; per-tab tokens and a user of its own are the real fix
const AGENT_NO: Record<string, string> = { prompts: "read the user's prompt history", chatList: "list the user's chats outside Laki", chatImport: "open the user's chats as tabs (the user does, from the project's menu)", sideAsk: "ask in the user's side chat (laki ask asks another agent)", turnUndo: "undo an agent's turn (the user does, from its card)", tabHandover: 'hand its chat to another agent (the user does, from the tab)', secretGive: 'give a secret (the user types it)', alertAnswer: "answer the user's alert (they pick on its card)", widgetToolAnswer: 'answer what Laki asks', aiAnswer: "answer Laki AI's questions", answer: "answer an agent's question", widgetFileSave: "edit an extension's files", remoteStart: 'start remote access', memoryCompact: 'compact memories (they go to a model)', prReview: 'post a PR review as you', prComment: 'comment on a PR as you', prSay: 'comment on a PR as you', prTalk: "read everyone's PR conversation (only trusted reviewers' go to agents)", chatRead: "read a tab's chat (laki screen reads what it shows)", shutdown: "stop Laki's daemon (every agent's session with it)", checkAgain: "run the Done check (its scripts run as the user)", checkStop: 'stop the Done check', worktreeImport: "import worktrees as workspaces (a delete removes their folder; the user does, from the project's menu)", bgSet: "set the app's background picture (it could look like a dialog)", sideNew: "start the user's side chat over", uiReset: "reset the user's settings and turn every extension off", projectArchive: 'archive or bring back a project (the user does, from its menu or Settings)', mcpAppCall: "run an MCP App's tool (the user allows each, in the Reader)", agentUpdate: 'update Claude Code (the user does, from the new-workspace page)', bgOutput: "read a background task's output (laki screen reads what a tab shows)", wsBase: "change a workspace's base branch (what its diff and reviews compare with; the user does, from Changes)", tabAccount: "move a tab to another of the user's accounts (the user does, from the tab)", accountRm: "remove one of the user's accounts (its sign-in goes with it)" }
// settings an agent can't change either (remote access can: they're the user's own on the phone, Cancel's whenDone off
// too): when everything is done (the Mac sleeps, locks or shuts down), the Done check, Recording mode, the next prompt
// guessed (your messages to a model), keep awake; how old the tidies let storage files, archived workspaces and pasted
// images get (a small one deletes them all within the hour); memory's compaction (memories to a model, as
// memoryCompact); the app's updates (Electron's security fixes come with them); and the global ones of what a project's
// config holds (refused in projectSet): Run ▾'s actions, prompt templates, the PR switches' prompts and trusted review
// bots (whose comments go to agents), and the files copied into new worktrees (git's ignored ones: .env); which of your
// accounts new tabs use and Auto fallback's order (work moved onto an account you never picked); MCP Apps (servers of
// yours Laki starts)
const AGENT_KEYS = /^(accountUse|limitFallback|mcpApps|whenDone|doneCheck|recording|nextPrompt|keepAwake|storageDays|archivedDays|imageDays|memoryCompact|updateCheck|updateDelay|actions|templates|prPrompts|prBots|copyIgnored|copyUntracked)$/
function agentNo(method: string, p: any) {
  if (method === 'settingsSet' && (remoteNo(method, p) || changes(p, AGENT_KEYS))) notAgent(p, 'change that setting')
  else if (method === 'updateIdle' && p.on !== false && core.agentCaller(p.caller) && (core.state.settings?.updateCheck === false || (core.state.settings?.updateDelay ?? 0) > 0)) throw new Error("an agent can't update Laki while Check for updates is off or an Update delay is set: it's the user's (ask them)") // its caller, not from (CALLER)
  else if (method === 'projectSet' && (p.config !== undefined || p.memory !== undefined)) notAgent(p, `change a project's ${p.config !== undefined ? 'scripts, env and settings' : 'memory list (laki memory add adds to it)'}`)
  else if ((method === 'wsSet' || method === 'projectSet') && p.private !== undefined) notAgent(p, 'change what Recording mode hides')
  else if (method === 'wsSet' && p.important !== undefined) notAgent(p, 'mark a workspace important (its asks come as cards over every app: the user picks which)')
  else if (method === 'projectTrust' && p.hash !== undefined) notAgent(p, "trust a project's .laki.json")
  else if (method === 'memoryAdd' && p.auto === false) notAgent(p, "add to a project's memory as the user's (laki memory add without --mine keeps it as learned)")
  else if (method === 'input' && core.asking(String(p.tab))) notAgent(p, 'type into a tab that asks something')
  else if (method === 'prAct' && (p.act === 'approve' || p.act === 'close')) notAgent(p, `${p.act} a PR as you`)
  else if (method === 'prDraft' && core.agentCaller(p.from) && core.agentCaller(p.from) !== core.findWs(String(p.ws ?? '')).id) throw new Error("an agent can draft or ready its own workspace's PR only")
  else if (method === 'prThreads' && p.all === true) notAgent(p, "read everyone's PR comments (only trusted reviewers' go to agents)")
  else if ((method === 'wsNew' || method === 'tabNew') && p.sandbox === false) notAgent(p, "start an agent outside its profile's sandbox")
  else if (method === 'aiAsk' && String(p.chat ?? '').startsWith('widget:')) notAgent(p, "ask in an extension's page chat (what Laki AI changes there stays on)")
  else if (method === 'tunnelStart' && p.host !== undefined) notAgent(p, 'make a permanent tunnel (a public address that stays, a DNS record of yours)')
  else if (method === 'tabSet' && p.alias !== undefined && p.from?.tab !== p.id) notAgent(p, "name another agent's tab (laki name names your own)") // else it could take a name and its messages
  else if (AGENT_NO[method]) notAgent(p, AGENT_NO[method])
}
// M5: an agent's send or screen into another workspace's tab: asked in the app first, as an extension's tool is (Always:
// from that workspace into that one, until Laki restarts). ponytail: kept in memory
const crossOk = new Set<string>()
// #1: an agent's send goes to agents (agent: true, as MCP's laki_send), or into a terminal of its own workspace, which is
// then the agent's (core.agentTyped): what it runs there isn't yours. Another workspace's terminal is refused before any
// ask. Yours gives it back
// a new workspace's prompt, yours (no agent's tab asked: byCaller's from; no agent said, as MCP and Laki AI do), into
// your prompts' history
const yours = <T extends { from?: string; agent?: string; prompt?: string }>(p: T) => (p.from || p.agent || core.promptKeep(p.prompt), p)
function agentSend(p: any) {
  const tab = core.resolveTarget(String(p.target ?? ''))
  const by = core.agentCaller(p.from)
  if (by) delete p.steer // into a running turn is your follow-ups' only: an agent's waits its turn (an Enter typed now could answer a menu just drawn)
  if (!by) {
    core.youTyped(tab.id, String(p.text ?? ''))
    if (p.enter !== false && !p.by && core.tracked(tab)) core.promptKeep(p.text, tab.workspace) // a prompt you sent an agent (not an insert, a command, Laki AI's or a side chat's: by)
  }
  else if (core.tracked(tab)) p.agent = true
  else if (tab.workspace !== by) throw new Error(`${tab.name} isn't an agent, and it's in another workspace: an agent's messages go to agents only (ask the user to run it there)`)
  else core.agentTyped(tab.id)
}
// keys: an agent's into a terminal of its own workspace make it the agent's (as a send does); yours give it back
function typed(p: any, tab: string, data: string) {
  if (core.agentCaller(p.from)) core.agentTyped(tab)
  else core.youTyped(tab, data, true)
}
// keys (input) ask as a send does, a terminal attached to as a screen read; an event (emit, #3) with another workspace's
// ws: its workflows and extensions run there, so it asks as a send does (target: the event, text: its data)
// a workspace as findWs takes it (an id's start too), else by its name: the one the call goes to
const wsRef = (ref: string) => {
  try {
    return core.findWs(ref).id
  } catch {
    return core.state.workspaces.find(w => w.name === ref)?.id
  }
}
// laki preset from an agent's tab: a profile's args and env run in every tab started on it (a mode that never asks too),
// so the user says yes in the app first, the whole profile shown; once only (no Always)
async function presetAsk(p: any) {
  const by = core.agentCaller(p.from)
  if (!by) return
  const name = String(p.name ?? '')
  const what = p.rm ? 'remove' : p.add ? 'add' : 'change'
  if (!core.clients.size) throw new Error(`to ${what} a profile the user says yes in Laki's window, and it isn't open: ask them to do it in Settings › Agents & profiles`)
  const was = core.presets().find(x => x.name === name)
  // the whole of it, never cut: a long value (a model's name) would push a mode that never asks out of sight
  const set = p.set && typeof p.set === 'object' ? p.set : {}
  const whole = JSON.stringify(p.rm ? (was ?? { name }) : { ...(was ?? { name, agent: 'claude' }), ...set }, null, 2)
  const text = p.rm || !Object.keys(set).length ? whole : `What changes:\n${JSON.stringify(set, null, 2)}\n\nThe profile then:\n${whole}`
  const agent = core.state.tabs.find(t => t.id === p.from.tab)?.name ?? 'An agent'
  const ws = core.state.workspaces.find(w => w.id === by)?.name ?? by
  const how = await answered({ ev: 'toolAsk', req: randomBytes(8).toString('hex'), cross: 'preset', agent, from: ws, to: '', target: `${what} the profile ${name}`, text, ws: by, tab: p.from.tab })
  if (how !== 'once') throw new Error(`${what} the profile ${name}: ${how === 'deny' ? 'the user said no' : 'no answer from the user'}`)
}
async function crossAsk(p: any, kind: 'send' | 'screen' | 'emit', target: string | null = p.target, text = p.text) {
  const by = core.agentCaller(p.from)
  if (!by) return
  const name = (id: string) => core.state.workspaces.find(w => w.id === id)?.name ?? id
  const tab = kind === 'emit' || target === null ? undefined : core.resolveTarget(String(target ?? '')) // null: a new tab (tabNew's prompt)
  const to = tab ? tab.workspace : wsRef(String(p.ws ?? ''))
  // its own, or one it started (a worker: laki new from its tab, from), whose prompt it wrote anyway: no question
  if (!to || to === by || (kind !== 'emit' && core.state.workspaces.find(w => w.id === to)?.from === by) || crossOk.has(`${kind}:${by}>${to}`)) return
  const what = tab ? tab.name : kind === 'emit' ? `custom.${String(p.name ?? '').replace(/^custom\./, '')}` : 'a new agent tab'
  if (!core.clients.size) throw new Error(`${name(to)} is another workspace: the user allows that in Laki's window, and it isn't open`)
  const agent = core.state.tabs.find(t => t.id === p.from.tab)?.name ?? 'An agent'
  const said = kind === 'send' ? String(text ?? '') : kind === 'emit' ? JSON.stringify(p.data ?? {}) : undefined
  const how = await answered({ ev: 'toolAsk', req: randomBytes(8).toString('hex'), cross: kind, agent, from: name(by), to: name(to), target: what, text: said && said.length > 2000 ? `${said.slice(0, 2000)}\n… and ${said.length - 2000} more characters` : said, ws: by, tab: p.from.tab })
  if (how === 'always') crossOk.add(`${kind}:${by}>${to}`)
  else if (how !== 'once') throw new Error(`${tab ? `${tab.name} is in ${name(to)}` : `${what} is for ${name(to)}`}, another workspace: ${how === 'deny' ? 'the user said no' : 'no answer from the user'}`)
}

// an agent's command in a new terminal tab (tabNew's cmd): it runs as you, past the agent's own permission prompts, so
// you allow it in the app each time (no Always); no window, no answer or a no: refused
const CMD_ASK = 2000
// and padding that would push its end out of the dialog's sight (macOS hides its scrollbar): a blank line, or more rows
// than it shows (each line's, wrapped at about 50 characters: spaces between words count)
const BLANK = /\n[ \t]*\n/
const CMD_ROWS = 20
const rowsOf = (cmd: string) => cmd.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 50)), 0)
async function cmdAsk(from: any, by: string, ws: string, cmd: string) {
  const name = (id: string) => core.state.workspaces.find(w => w.id === id)?.name ?? id
  const to = ws
  if (HIDDEN.test(cmd)) throw new Error("the command has characters the user couldn't see (a control, direction or zero-width one): ask them to run it, or put it in a script") // you allow what you read
  if (cmd.length > CMD_ASK) throw new Error(`the command is longer than ${CMD_ASK} characters, too long to show the user whole: ask them to run it, or put it in a script`) // you allow what you read, all of it
  if (BLANK.test(cmd) || rowsOf(cmd) > CMD_ROWS) throw new Error(`the command has blank lines, or more than the ${CMD_ROWS} rows the ask shows, too much to show the user whole: ask them to run it, or put it in a script`)
  if (!core.clients.size) throw new Error("an agent's command runs once the user allows it in Laki's window, and it isn't open: ask the user to run it")
  const agent = core.state.tabs.find(t => t.id === from?.tab)?.name ?? 'An agent'
  const how = await answered({ ev: 'toolAsk', req: randomBytes(8).toString('hex'), cross: 'cmd', agent, from: name(by), to: name(to), target: 'a command', text: cmd, ws: by, tab: from?.tab })
  if (how !== 'once') throw new Error(`${how === 'deny' ? 'the user said no to' : 'no answer from the user for'} the command: ask them to run it themselves`)
}

// a tab's state (laki hook) comes from that tab's agent: with its start's key (LAKI_HOOK, core's spawnTab), else from a
// process of that tab or of none (yours: laki hook typed, a test's). Another tab's process, or a key that isn't this
// start's, is refused: it would end that agent's turn (its queue delivered, a workflow's block ended with words it chose,
// the Done check), run the tool gates on input it chose and fire tool.call. A hook is looked up only without its key
// (whoCalls never does: one per tool call). ponytail: the key is in the agent's env, which a process of yours can
// read; per-tab users are the real fix
async function hookWho(sock: Socket, p: any) {
  if (p.key !== undefined) {
    if (core.hookOk(String(p.tab ?? ''), p.key)) return
    throw new Error("not this tab's start: a tab's state comes from its own agent")
  }
  const tab = await peerOf(sock).catch(() => null)
  if (tab === null || sock.readableEnded || sock.destroyed) throw new Error(core.WHO)
  if (tab && tab.id !== p.tab) {
    log(`hook refused: ${tab.id} reported ${String(p.tab).slice(0, 40)}'s state`)
    throw new Error("a tab's state comes from its own agent")
  }
}

// the ticks' now (storageTidy, archivedTidy, scheduleTick…): a test's daemon only (dir.ts' inRig); any other caller's
// clock is the Mac's, else a date years ahead deletes every storage folder's files at once
const TEST_CLOCK = inRig() && process.env.LAKI_TEST_CLOCK !== '0' // 0: a test's daemon that takes none (api.test's)

async function call(method: string, params: any, c?: core.Conn, remote = !!c?.remote, sock = c && local.get(c)) {
  method = oldName(method) // note.list → noteList, before every check keyed by the name: an alias passes the same ones
  const h = Object.hasOwn(api, method) ? api[method] : undefined
  if (!h) throw new Error(`unknown method ${method}`)
  if (!TEST_CLOCK && params && typeof params === 'object' && 'now' in params) params = { ...params, now: undefined }
  if (remote && remoteNo(method, params)) throw new Error(`not over remote access: do that on the Mac itself (${method})`)
  if (sock) params = await whoCalls(sock, method, params)
  if (sock) agentNo(method, params ?? {})
  if (sock && method === 'hook') await hookWho(sock, params ?? {})
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
    if (u.pathname.startsWith('/mcp-app/')) return void mcpPage(u.pathname, u.searchParams).then(r => (res.writeHead(r.code, r.headers), res.end(r.body))) // an MCP App's page (mcpApps.ts): its own key, its own CSP
    if (u.pathname.startsWith('/artifact/')) return artifactPage(u.pathname, req.headers.origin, req.headers.host, res) // an artifact in the app's viewer: the key in its path
    if (u.pathname === '/img') return imgPage(u.searchParams, res) // an extension's picture for the app window: the view's key
    if (!w && !plan) return page(u.pathname, res) // no secrets: any origin
    const r = w ? widgetPage(w[1], u.searchParams) : planPage(u.pathname, u.searchParams)
    res.writeHead(r.code, r.headers)
    return res.end(r.body)
  }
  if (!originOk(req.headers.origin)) return reply(403, { error: 'origin not allowed' })
  // remote access's PIN (remoteMod.remotePin): from its page only, with the link's key in the body
  if (req.method === 'POST' && req.url === '/pin') {
    if (!req.headers.origin || req.headers.origin !== remoteMod.remoteOrigin()) return reply(403, { error: 'origin not allowed' })
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 4096) return reply(413, { error: 'too big' })
    }
    try {
      return reply(200, remoteMod.remotePin(JSON.parse(body) ?? {}))
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
    const o = req.headers.origin
    const remote = !!o && o === remoteMod.remoteOrigin()
    reply(200, { result: (await call(method, params, undefined, remote, remote ? undefined : req.socket)) ?? null })
  } catch (e) {
    reply(200, { error: (e as Error).message })
  }
})

// L15: a refused WebSocket logged once per address and Origin, then how many more once a minute: a page that retries
// for good doesn't fill daemon.log. ponytail: daemon.log still rotates only as a daemon starts (conn.ts)
const refused = new Map<string, number>() // the ones since the last minute's line
let refusedTick: NodeJS.Timeout | undefined
function refusedWs(who: string) {
  const n = refused.get(who)
  if (n === undefined) log('refused websocket', who)
  refused.set(who, (n ?? -1) + 1)
  refusedTick ??= setInterval(() => {
    for (const [k, more] of refused) more ? (log(`refused websocket ${k}: ${more} more in the last minute`), refused.set(k, 0)) : refused.delete(k)
    if (!refused.size) clearInterval(refusedTick), (refusedTick = undefined)
  }, 60000).unref()
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 34 << 20 }) // an attached 25 MB file (fileSave), in base64. ponytail: /rpc stays at 16 MB: the app's own go over the socket
let clientSeq = 0
server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '', 'http://x')
  if (url.pathname !== '/ws' || !hostOk(req.headers.host) || !originOk(req.headers.origin) || !tokenOk(url.searchParams.get('token'), req.headers.origin)) {
    refusedWs(`${req.socket.remoteAddress ?? '?'} ${req.headers.origin ?? '(no origin)'}`)
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return
  }
  wss.handleUpgrade(req, socket, head, ws => {
    const c: core.Conn = {
      id: ++clientSeq,
      remote: !!req.headers.origin && req.headers.origin === remoteMod.remoteOrigin(),
      send: msg => {
        if (ws.readyState !== ws.OPEN) return
        // a stalled client (asleep, hung): drop it rather than buffer without bound; it reconnects and
        // re-attaches from a snapshot
        if (ws.bufferedAmount > 32 << 20) return ws.terminate()
        ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)) // a string: JSON already (core's state, made once for all)
      },
    }
    if (!c.remote) local.set(c, req.socket), peerOf(req.socket).catch(() => {}) // looked up as it opens: the app's first keys don't wait
    core.clients.add(c)
    core.hello(c)
    widgetAsks(c) // an extension's asks still waiting: this window shows them too
    noticesTo(c) // and the notices up
    if (core.clients.size === 1) widgetTick(undefined, 'open'), scheduleMod.reminderTick(), widgetEvent('app.open') // the app is back: what fell due meanwhile
    ws.on('message', async raw => {
      let m: { id?: number; method: string; params?: any }
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }
      if (m.method === 'attach') {
        const sock = local.get(c)
        try {
          if (sock) await crossAsk(await whoCalls(sock, 'attach', { target: m.params?.tab }), 'screen') // another workspace's terminal: asked, as a screen read
        } catch (e) {
          return c.send({ id: m.id, error: (e as Error).message })
        }
        try {
          resourcesMod.wake(m.params?.tab) // a look wakes an agent put to sleep
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
const listening = new Promise<void>(r => server.once('listening', () => r()))
void remoteMod
  .reapChildren()
  .catch(e => log('reapChildren', e)) // L14: tunnels a crashed daemon left running
  .then(() => listening) // tunnelsBack skips the daemon's own port: known once it listens
  .then(() => remoteMod.tunnelsBack()) // then the ones state.json kept: after them, so none of theirs is stopped
  .catch(e => log('tunnelsBack', e))
server.listen(Number(process.env.LAKI_PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : 0
  const info = join(dir, 'daemon.json')
  writeFileSync(info, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 })
  chmodSync(info, 0o600)
  log(`laki daemon on 127.0.0.1:${port} (pid ${process.pid}, data ${dir})`)
  remoteMod.setDaemonPort(port)
  const every = (ms: number, f: () => unknown) => timers.push(setInterval(() => Promise.resolve(f()).catch(e => log(e)), ms))
  every(Number(process.env.LAKI_PORT_SCAN_MS || 5000), resourcesMod.scanPorts)
  const prMs = Number(process.env.LAKI_PR_SCAN_MS) // tests' pace; else each minute, scanning every settings.prScan minutes
  every(prMs || 60000, () => (prMs ? prMod.scanPRs(process.env.LAKI_PR_BG === '1') : prMod.prTick())) // LAKI_PR_BG: tests of the timer's own (bg) scans
  every(3_600_000, core.ghHour) // Laki's own gh calls, an hour's, in its log
  every(2000, core.sweepRunning)
  every(30000, () => core.hookTick()) // hooks not heard: a tab's strip says so
  every(2000, core.shellTick)
  every(60000, () => resourcesMod.sleepTick())
  every(Number(process.env.LAKI_TICKET_TICK_MS || 30000), () => ticketTick()) // linked tickets: each due workspace's script
  every(300000, policyTick)
  every(Number(process.env.LAKI_STAT_SCAN_MS || 10000), filesMod.scanStats)
  every(Number(process.env.LAKI_OVERLAP_MS || 15000), filesMod.scanOverlaps) // Collision radar
  every(Number(process.env.LAKI_METER_MS || 10000), metersMod.meterTick) // claude's and codex's transcripts: the tabs' context and usage
  every(30000, () => core.watchLimits())
  every(15000, () => (remoteMod.remoteTick(), remoteMod.shareTick(), remoteMod.tunnelTick()))
  every(30000, () => scheduleMod.scheduleTick())
  every(30000, () => scheduleMod.pendingTick())
  every(30000, () => scheduleMod.reminderTick())
  every(1800000, () => memoryTick())
  every(30000, () => widgetTick())
  every(Number(process.env.LAKI_FACTS_MS) || 10000, () => factsTick()) // workspace facts read again (tests' faster)
  every(5000, () => flowTick())
  every(600000, () => aiTick()) // a spec's or brainstorm's chat unused 12 hours ends
  every(3600000, () => (core.imagesTidy(), core.storageTidy(), core.archivedTidy(), widgetTrashTidy(), flowTrashTidy(), checkTidy(), secretsTidy(), turnsTidy(), metersMod.statusTidy())) // pasted images past settings.imageDays, storage folders' files past storageDays, archived workspaces past archivedDays, deleted extensions past 30 days
  setTimeout(() => (core.archivedTidy(), widgetTrashTidy(), flowTrashTidy(), checkTidy(), void scheduleMod.pendingTick(), core.state.settings?.bgRefresh !== false && prMod.scanPRs().catch(() => {})), 2000)
  // a test's daemon (the rig's LAKI_TEST_PARENT: its test process, which the CLI's autostart passes on too) goes with
  // it, so a test run killed midway leaves none behind
  const parent = Number(process.env.LAKI_TEST_PARENT)
  if (parent)
    every(2000, () => {
      try {
        process.kill(parent, 0)
      } catch {
        shutdown() // ESRCH: gone; EPERM: its pid is another user's process now
      }
    })
})

function shutdown() {
  log('shutting down')
  timers.forEach(clearInterval)
  remoteMod.tunnelsDown() // kept in state.json: they come back with the next daemon
  remoteMod.stopShares()
  remoteMod.remoteStop()
  flowStopAll() // a run block's command
  aiStop() // its claude -p or codex would go on, and their laki mcp start a daemon again
  hostsMod.stopHosts()
  widgetsStop() // dev mode's watchers
  core.queued.clear() // a restart's tabs not started yet: none starts now (each keeps its `again` for the next start)
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
