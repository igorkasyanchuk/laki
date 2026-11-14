// Finding, starting and calling the daemon from Node (CLI, Electron main, tests).
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { oldName } from './caps.ts'
import { helperBin } from './helper.ts'

// ~/.laki; a Mac that ran Laki as "Laki Electron" keeps its ~/.laki-electron: workspaces' worktrees are in it, and
// agents find their conversations by those paths
export const dataDir = (home = homedir()) =>
  process.env.LAKI_HOME || (!existsSync(join(home, '.laki')) && existsSync(join(home, '.laki-electron')) ? join(home, '.laki-electron') : join(home, '.laki'))

export type DaemonInfo = { port: number; token: string; pid: number }

// S4: in a Laki tab ($LAKI_TAB or $LAKI_TAB_TOKEN, set at all: an empty one too): the CLI only talks to a daemon that
// runs, never starts one (ensureDaemon, laki daemon, laki serve): a sandboxed claude runs laki outside its sandbox, and
// a LAKI_HOME of its own with a state.json it wrote would start a second daemon there, outside it. The launcher on PATH
// pins LAKI_HOME to its daemon's; one pointed elsewhere finds no daemon there and fails
export const inTab = () => 'LAKI_TAB' in process.env || 'LAKI_TAB_TOKEN' in process.env
export const NO_START = "Laki's daemon isn't running, and laki in a Laki tab never starts one: open Laki"

export function daemonInfo(): DaemonInfo | null {
  try {
    return JSON.parse(readFileSync(join(dataDir(), 'daemon.json'), 'utf8'))
  } catch {
    return null
  }
}

// a namespaced name (note.list): an older daemon refuses it as unknown, so it's sent once more by its old name (caps.ts),
// and by that one from then on in this process
const oldOnly = new Set<string>()
export async function rpc<T = any>(method: string, params: any = {}, timeoutMs = 30000): Promise<T> {
  const old = oldName(method)
  if (old === method || oldOnly.has(method)) return post(old, params, timeoutMs)
  try {
    return await post(method, params, timeoutMs)
  } catch (e) {
    if ((e as Error).message !== `unknown method ${method}`) throw e
    oldOnly.add(method)
    return post(old, params, timeoutMs)
  }
}

// S1: the app's own token (main.ts' appToken: the user's), for the daemon whose pid it's of: read on fd 3 from a daemon
// the app started, else asked for (appPair). Never on disk or in a child's env: LAKI_APP_TOKEN (a test's CLI, the UI
// smoke's app) is taken out of this process's env as it's read
let app = process.env.LAKI_APP_TOKEN ? { token: process.env.LAKI_APP_TOKEN, pid: 0 } : undefined
delete process.env.LAKI_APP_TOKEN
let appMode = false // the app's main (ensureDaemon's app): a daemon started again is paired with again
export const appToken = () => app?.token
async function pair(info: DaemonInfo) {
  appMode = true
  if (app && (!app.pid || app.pid === info.pid)) return
  app = undefined
  const r = await fetch(`http://127.0.0.1:${info.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${info.token}` }, body: '{"method":"appPair"}', signal: AbortSignal.timeout(10000) }).then(r => r.json())
  if (r.error) throw new Error(r.error)
  app = { token: r.result.token, pid: info.pid }
}

async function post(method: string, params: any, timeoutMs: number) {
  const info = daemonInfo()
  if (!info) throw new Error('daemon not running')
  // S1: a terminal Laki hasn't seen before: the daemon holds the call until you allow it in the window; say so here, and
  // wait as long as it does (a minute)
  const stop = new AbortController()
  let limit = setTimeout(() => stop.abort(new Error('The operation was aborted due to timeout')), timeoutMs)
  const hint = !process.stderr.isTTY || inTab() ? undefined : setTimeout(() => void fetch(`http://127.0.0.1:${info.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${info.token}` }, body: '{"method":"termHeld"}', signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(r => { if (r.result === true && !stop.signal.aborted) (process.stderr.write("Approve this terminal in Laki's window…\n"), clearTimeout(limit), (limit = setTimeout(() => stop.abort(new Error('The operation was aborted due to timeout')), Math.max(timeoutMs, 70000)))) }, () => {}), 1000)
  const send = (token: string) =>
    fetch(`http://127.0.0.1:${info.port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: stop.signal,
    })
  // S12: in a Laki tab, with that tab's token (LAKI_TAB_TOKEN, this start's): the daemon knows the caller by it. One
  // of a start that ended (its tab restarted under a process that lives on, another Laki's): the daemon's own, as before
  if (appMode && app?.pid && app.pid !== info.pid) await pair(info).catch(() => {}) // the app's daemon started again
  const mine = process.env.LAKI_TAB_TOKEN || app?.token // a tab's first: a CLI in a tab is that tab's, whatever else it has
  try {
    let res = await send(mine || info.token)
    if (mine && res.status === 401) (await res.arrayBuffer(), (res = await send(info.token)))
    var body = await res.json()
  } finally {
    clearTimeout(limit)
    clearTimeout(hint)
  }
  if (body.error) throw new Error(body.error)
  return body.result
}

export async function alive(): Promise<boolean> {
  try {
    return (await rpc('ping', {}, 1500)) === 'pong'
  } catch {
    return false
  }
}

// The daemon script next to this bundle (out/main/daemon.js), or the TS source when run from src/.
export function daemonScript(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [join(here, 'daemon.js'), join(here, '../daemon.js'), join(here, '../daemon/main.ts')]) if (existsSync(p)) return p
  throw new Error('daemon script not found')
}

// a log past max: what it holds goes to <log>.1 (one kept) and it starts over. live: a process holds it open to append
// (the daemon's stdout, opened by whoever started it): a rename would take its writes along into .1, so it's copied and
// cut to nothing instead, and O_APPEND's next write lands at the new end. ponytail: a line written between the copy and
// the cut is lost
export const LOG_MAX = 10e6
export function rotateLog(path: string, live = false, max = LOG_MAX) {
  try {
    if (statSync(path).size <= max) return false
    if (live) copyFileSync(path, `${path}.1`), truncateSync(path, 0)
    else renameSync(path, `${path}.1`)
    return true
  } catch {
    return false
  }
}

// R2: a dated line in a log of the app's own (main's <data>/app.log), rotated as daemon.log is; it never throws
export function logLine(path: string, ...a: unknown[]) {
  try {
    rotateLog(path)
    appendFileSync(path, `${new Date().toISOString()} ${a.map(x => (x instanceof Error ? (x.stack ?? x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`, { mode: 0o600 })
  } catch {}
}

// ensureDaemon starts the daemon detached (it outlives the caller) unless one answers already, on the bundle's helper
// when it has one (the app's binary doesn't run as node: docs/dev/helper.md). app (the app's main, the
// demo world): the app's token too (S1), on fd 3 from the one it starts, else asked for
export async function ensureDaemon(env: Record<string, string> = {}, asApp = false): Promise<DaemonInfo> {
  const paired = async (info: DaemonInfo) => (asApp && (await pair(info).catch(e => console.error(`laki: no app token: ${(e as Error).message}`))), info)
  if (await alive()) return paired(daemonInfo()!)
  if (inTab()) throw new Error(NO_START)
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const logPath = join(dataDir(), 'daemon.log')
  rotateLog(logPath) // and each hour as it runs (main.ts' logTick)
  const log = openSync(logPath, 'a')
  const args = [...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), daemonScript()]
  const child = spawn(helperBin(process.execPath, existsSync), args, { detached: true, stdio: ['ignore', log, log, ...(asApp ? (['pipe'] as const) : [])], env: { ...process.env, ...env, LAKI_START_PID: String(process.pid), ...(asApp && { LAKI_APP_PIPE: '3' }) } }) // LAKI_START_PID: S1, this terminal is the daemon's own (core.termStart)
  child.unref()
  let said = ''
  const pipe = asApp ? (child.stdio[3] as import('node:net').Socket) : undefined
  pipe?.on('data', d => (said += d)).on('error', () => {}).unref()
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100))
    if (await alive()) {
      const info = daemonInfo()!
      for (let j = 0; asApp && !said.includes('\n') && j < 20 && !pipe!.readableEnded; j++) await new Promise(r => setTimeout(r, 50)) // written after daemon.json
      pipe?.destroy()
      if (/^[0-9a-f]{64}\n/.test(said)) ((app = { token: said.slice(0, 64), pid: info.pid }), (appMode = true))
      return paired(info) // another start's daemon won the lock: asked for
    }
  }
  pipe?.destroy()
  throw new Error(`daemon didn't start; see ${logPath}`)
}

// S9: the app's start (main's daemon()): a daemon from before app://laki (an API under minApi, still running after an
// update) refuses the window's Origin, so the window never sees it's stale; it's restarted once, as the window would
// (keep: the pty host's terminals go on). One the app before the update started refuses that shutdown (who's calling:
// this app's token isn't the one it was given), so it's stopped as the Restart button does (stopDaemon). Without that
// the window stayed on the splash (0.48 to 0.49). test/upgrade.test.ts, with a fake old daemon
// the first API whose daemon runs on Laki Node (docs/dev/helper.md): one under it, as a build with Laki Node opens (after
// an update from 0.50.0 or earlier), is restarted at once by main, as freshDaemon does. Left running, its hooks would go
// to Laki Hook.app (gone) and what it starts as node (the pty host, extensions' scripts, the laki launcher) to the
// app's binary, which no longer runs as node: its agents' turns untracked until a Restart
export const NODE_API = 182
export const daemonStale = (ping: unknown, minApi: number) => ping !== undefined && !(typeof ping === 'object' && ping !== null && Number((ping as { api?: unknown }).api ?? 0) >= minApi) // pure: none (no answer) isn't stale, it's gone
export const isDaemonCmd = (command: string) => /\bout\/main\/daemon\.js\b/.test(command) // a Laki daemon's command line (built), never another process on a reused pid
export const pidRunning = (pid: number) => {
  try {
    return process.kill(pid, 0), true
  } catch {
    return false
  }
}
// a Laki daemon (its command line runs out/main/daemon.js) stopped by SIGTERM, its own whole shutdown; false: not one,
// or still there 15 s on. The Restart button's, a daemon from before an update, Quit Laki Completely's
// hung: it doesn't answer (its event loop blocked: its SIGTERM handler never runs), so SIGKILL after 5 s; the pty host's
// terminals go on either way
export async function stopDaemon(pid: number, hung = false) {
  if (!pidRunning(pid) || !isDaemonCmd(spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '')) return false
  logLine(join(dataDir(), 'daemon.log'), hung ? `the app stops the daemon (pid ${pid}): it didn't answer (the window's Restart)` : `the app stops the daemon (pid ${pid}): it refused this app's shutdown (another Laki, or the one before an update, started it)`)
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < (hung ? 20 : 60) && pidRunning(pid); i++) await new Promise(r => setTimeout(r, 250))
  if (hung && pidRunning(pid)) process.kill(pid, 'SIGKILL')
  for (let i = 0; hung && i < 20 && pidRunning(pid); i++) await new Promise(r => setTimeout(r, 100))
  return !pidRunning(pid)
}
// a hung daemon (main pings it every 5 s while a window is open): this many misses in a row is hung, the next answer
// clears it
export const HUNG_MISSES = 3
export const pingStep = (misses: number, answered: boolean) => (m => ({ misses: m, hung: m >= HUNG_MISSES }))(answered ? 0 : misses + 1)
export async function freshDaemon(start: () => Promise<DaemonInfo>, minApi: number, log: (line: string) => void = () => {}) {
  const info = await start()
  const r = await rpc<unknown>('ping', { caps: true }).catch(() => undefined)
  if (!daemonStale(r, minApi)) return info
  log(`the daemon (pid ${info.pid}) is older than this app's window: restarted`)
  const asked = await rpc('shutdown', { keep: true }).then(() => true, () => false)
  for (let i = 0; asked && i < 60 && pidRunning(info.pid); i++) await new Promise(r => setTimeout(r, 250))
  if (pidRunning(info.pid) && !(await stopDaemon(info.pid))) log(`the daemon (pid ${info.pid}) didn't stop: kill ${info.pid}, then open Laki again`)
  return start()
}

// a response's text (and bytes), at most max bytes read: past it the rest is let go (body.cancel()), the connection
// with it. cut: it had more
export async function readCapped(r: Response, max: number): Promise<{ text: string; buf: Buffer; cut: boolean }> {
  const parts: Buffer[] = []
  let size = 0
  for await (const b of r.body ?? []) {
    parts.push(Buffer.from(b))
    if ((size += b.length) > max) break // for await's break cancels the stream
  }
  const buf = Buffer.concat(parts).subarray(0, max)
  return { text: buf.toString('utf8'), buf, cut: size > max }
}

// a JSON file's value, or undefined when it's missing or doesn't parse
// a Write's file as it is now, for its ask's diff (permDiff): '' a new one; null one not shown (out of its workspace,
// ~/.ssh's, even by a link: its lines never on a card; a host's, read on this Mac it'd look new; one Laki can't read;
// not a plain file, a FIFO's read never ends; over 256 KB)
export function priorOf(pl: any, ws?: { path: string; host?: string }): string | null | undefined {
  const f = pl?.tool_name === 'Write' ? pl.tool_input?.file_path : undefined
  if (typeof f !== 'string') return
  if (!ws || ws.host || !f.startsWith('/')) return null
  let real: string
  try {
    real = realpathSync(f)
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null // not there yet: new
  }
  try {
    const st = statSync(real)
    return real.startsWith(`${realpathSync(ws.path)}/`) && st.isFile() && st.size <= 256 * 1024 ? readFileSync(real, 'utf8') : null
  } catch {
    return null
  }
}

// R7: one of Laki's own stores that won't parse (the data folder's JSON files, notes', AI chats', extensions' data, kept
// turns': what writeAtomic writes, the daemon alone) is set aside as <name>.broken-<time>, logged once, instead of read
// as nothing and then written over. Any other file (an agent's own config, a repo's .laki.json, an account's folder) is
// only read, as it is
const OWN = /^(?:[^/]+|(?:notes|ai-chats|widget-data|turns)\/.+)\.json$/
const setAside = new Set<string>()
export function readJson<T = any>(p: string): T | undefined {
  let text: string
  try {
    text = readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    const rel = relative(dataDir(), p)
    if (!text.trim() || !OWN.test(rel) || rel.startsWith('..') || isAbsolute(rel)) return undefined
    const broken = `${p}.broken-${Date.now()}`
    try {
      renameSync(p, broken)
      if (!setAside.has(p)) setAside.add(p), console.log(new Date().toISOString(), `${p} unreadable (${(e as Error).message}): kept as ${broken}`)
    } catch {}
    return undefined
  }
}

// written whole or not at all: a temp file of its own (this process's, a random name: two writers never share one),
// flushed to disk, renamed over, then the folder flushed (the rename on disk too). A crash leaves the last good one.
// mode: the file's, else the one there keeps its own (an editor's save of a script stays executable). A link is
// followed, as writeFileSync does: its file is written, the link stays
export function writeAtomic(path: string, data: string | Buffer, mode?: number) {
  const p = (() => {
    try {
      return realpathSync(path)
    } catch {
      return path // not there yet
    }
  })()
  const d = dirname(p)
  mkdirSync(d, { recursive: true })
  const keep = mode ?? (st => (st?.isFile() ? st.mode & 0o7777 : undefined))(statSync(p, { throwIfNoEntry: false }))
  const tmp = `${p}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    const fd = openSync(tmp, 'wx', keep ?? 0o666)
    try {
      if (keep !== undefined) fchmodSync(fd, keep) // past the umask
      writeFileSync(fd, data)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, p)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  syncDir(d)
}
export function syncDir(d: string) {
  try {
    const fd = openSync(d, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {} // a file system that can't: the rename stands all the same
}

// a file or folder renamed, or copied then removed across volumes (EXDEV)
export function move(from: string, to: string) {
  try {
    renameSync(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    copyTree(from, to)
    rmSync(from, { recursive: true, force: true })
  }
}

// cpSync's recursive copy (links as they are, modes kept, over what's there), each file read in chunks until it ends:
// node's copyfile spins for ever on a file that shrinks while it's copied (libuv's sendfile counts on the size it saw),
// and an extension's folder or a workspace is written to as it's copied. filter: false leaves a path and what's under it
export function copyTree(from: string, to: string, filter: (path: string) => boolean = () => true) {
  if (!filter(from)) return
  const st = lstatSync(from)
  if (st.isSymbolicLink()) return void (rmSync(to, { force: true }), symlinkSync(readlinkSync(from), to))
  if (st.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const n of readdirSync(from)) copyTree(join(from, n), join(to, n), filter)
    return void chmodSync(to, st.mode & 0o7777)
  }
  if (!st.isFile()) return // a socket or a pipe: nothing to copy
  const i = openSync(from, 'r')
  try {
    const o = openSync(to, 'w')
    try {
      const buf = Buffer.allocUnsafe(1 << 20)
      for (let n; (n = readSync(i, buf, 0, buf.length, null)) > 0; ) writeSync(o, buf, 0, n)
    } finally {
      closeSync(o)
    }
  } finally {
    closeSync(i)
  }
  chmodSync(to, st.mode & 0o7777)
}
