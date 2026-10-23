// Finding, starting and calling the daemon from Node (CLI, Electron main, tests).
import { spawn } from 'node:child_process'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ~/.laki; a Mac that ran Laki as "Laki Electron" keeps its ~/.laki-electron: workspaces' worktrees are in it, and
// agents find their conversations by those paths
export const dataDir = (home = homedir()) =>
  process.env.LAKI_HOME || (!existsSync(join(home, '.laki')) && existsSync(join(home, '.laki-electron')) ? join(home, '.laki-electron') : join(home, '.laki'))

export type DaemonInfo = { port: number; token: string; pid: number }

export function daemonInfo(): DaemonInfo | null {
  try {
    return JSON.parse(readFileSync(join(dataDir(), 'daemon.json'), 'utf8'))
  } catch {
    return null
  }
}

export async function rpc<T = any>(method: string, params: any = {}, timeoutMs = 30000): Promise<T> {
  const info = daemonInfo()
  if (!info) throw new Error('daemon not running')
  const res = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await res.json()
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

// ensureDaemon starts the daemon detached (it outlives the caller) unless one answers already.
export async function ensureDaemon(env: Record<string, string> = {}): Promise<DaemonInfo> {
  if (await alive()) return daemonInfo()!
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const logPath = join(dataDir(), 'daemon.log')
  // ponytail: rotated only as a daemon starts; one that runs for months grows until the next start
  try {
    if (statSync(logPath).size > 10e6) renameSync(logPath, logPath + '.1')
  } catch {}
  const log = openSync(logPath, 'a')
  const args = [...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), daemonScript()]
  spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...env } }).unref()
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100))
    if (await alive()) return daemonInfo()!
  }
  throw new Error(`daemon didn't start; see ${logPath}`)
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
export function readJson<T = any>(p: string): T | undefined {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}

// written whole or not at all (a temp file, then a rename): a crash mid-write leaves the last good one. mode: the
// file's, also on a temp file an earlier crash left (a mode only counts for a new file)
export function writeAtomic(p: string, data: string | Buffer, mode?: number) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(`${p}.tmp`, data, mode === undefined ? undefined : { mode })
  if (mode !== undefined) chmodSync(`${p}.tmp`, mode)
  renameSync(`${p}.tmp`, p)
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
