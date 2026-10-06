// The terminal host: owns PTYs, state and scans; outlives the app. Reached over 127.0.0.1 only:
// POST /rpc (Authorization: Bearer <token>) and a WebSocket at /ws?token=<token>. The token lives in
// <data>/daemon.json (0600); a browser page can't read it, and an Origin that isn't ours is refused anyway.
import { execFileSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { meme } from './fun.ts'
import * as core from './core.ts'
import { skills, skillSet } from './skill.ts'
import { usage } from './usage.ts'

const { dir } = core
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
      rmSync(lockPath, { force: true }) // stale: dead, or its pid now belongs to another program
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

const token = randomBytes(32).toString('hex')
// Browsers always send Origin on a WebSocket; node clients (CLI, hooks, Electron main) send none.
const origins = new Set(['file://', ...(process.env.LAKI_DEV_ORIGIN ? process.env.LAKI_DEV_ORIGIN.split(',') : [])])
// remote access (core.ts) adds its page's origin and its own token while it runs
const originOk = (o: string | undefined) => o === undefined || origins.has(o) || (!!o && o === core.remoteOrigin())
const same = (t: string, want: string | undefined) => !!want && t.length === want.length && timingSafeEqual(Buffer.from(t), Buffer.from(want))
// remote access's token only from its page: a client with no Origin (curl past Cloudflare's sign-in) needs ours
const tokenOk = (t: string | null | undefined, o: string | undefined) => !!t && (same(t, token) || (!!o && o === core.remoteOrigin() && same(t, core.remoteToken())))

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

// ---------- the API: same methods over HTTP and WebSocket

type Handler = (p: any, c?: core.Conn) => unknown
const api: Record<string, Handler> = {
  ping: () => 'pong',
  state: () => core.view(),
  projectAdd: p => core.projectAdd(p.path),
  projectRm: p => core.projectRm(p.id),
  projectSet: p => core.projectSet(p.id, p),
  projectFile: p => core.projectFileConfig(p.id),
  branches: p => core.branches(p.project),
  wsNew: p => core.wsNew(p),
  wsRm: p => core.wsRm(p.id),
  wsArchive: p => core.wsArchive(p.id, { ifClean: !!p.ifClean }),
  doctor: () => core.doctor(),
  wsFan: p => core.wsFan(p),
  answer: p => core.answer(p),
  unread: p => core.unread(p.tab),
  browse: p => core.browse(p),
  browseDone: p => core.browseDone(p),
  wsRestore: p => core.wsRestore(p.id),
  wsFork: p => core.wsFork(p.id),
  tabNew: p => core.addTab(p.ws, p),
  todoAdd: p => core.todoAdd(p),
  todoRm: p => core.todoRm(p),
  tabClose: p => core.closeTab(p.id),
  tabSet: p => core.tabSet(p),
  settingsSet: p => core.settingsSet(p),
  openIn: p => core.openIn(p),
  apps: () => core.apps(),
  wsSet: p => core.wsSet(p),
  reorder: p => core.reorder(p),
  imageSave: p => core.imageSave(p),
  prFix: p => core.prFix(p),
  prRefresh: () => core.scanPRs(), // every PR again now (the status bar's Refresh): one scan at a time, so autoPR never sends twice
  webhookTest: p => core.webhookTest(p),
  portKill: p => core.portKill(p),
  meme: () => meme(),
  send: p => core.send(p),
  queueClear: p => core.clearQueue(p.target),
  hook: p => core.hook(p),
  diff: p => core.diff(p.ws),
  files: p => core.files(p.ws),
  fileNew: p => core.fileNew(p),
  fileRead: p => core.fileRead(p),
  fileWrite: p => core.fileWrite(p),
  skills: () => skills(),
  skillSet: p => skillSet(p),
  prComment: p => core.prComment(p),
  prThreads: p => core.prThreads(p.ws),
  run: p => core.runDev(p.ws),
  cloudflared: (o: { ws?: string }) => core.cloudflared(o),
  usage: () => usage(core.state.settings?.usage),
  tunnelStart: p => core.tunnelStart(p),
  tunnelStop: p => core.tunnelStop(p),
  ship: p => core.ship(p.ws, p.message),
  screen: p => core.screen(p.target, p.lines),
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
  if (req.method === 'GET') return page(new URL(req.url ?? '/', 'http://x').pathname, res) // no secrets: any origin
  if (!originOk(req.headers.origin)) return reply(403, { error: 'origin not allowed' })
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
  if (url.pathname !== '/ws' || !originOk(req.headers.origin) || !tokenOk(url.searchParams.get('token'), req.headers.origin)) {
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
        ws.send(JSON.stringify(msg))
      },
    }
    core.clients.add(c)
    c.send({ ev: 'state', view: core.view() })
    ws.on('message', async raw => {
      let m: { id?: number; method: string; params?: any }
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }
      if (m.method === 'attach') {
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
  const port = typeof addr === 'object' && addr ? addr.port : 0
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
  every(Number(process.env.LAKI_STAT_SCAN_MS || 10000), core.scanStats)
  every(30000, () => core.watchLimits())
  every(15000, () => core.remoteTick())
  every(30000, () => core.scheduleTick())
  setTimeout(() => core.scanPRs().catch(() => {}), 2000)
})

function shutdown() {
  log('shutting down')
  timers.forEach(clearInterval)
  core.stopTunnels()
  core.remoteStop()
  core.stopHosts()
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
