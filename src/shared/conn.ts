// Finding, starting and calling the daemon from Node (CLI, Electron main, tests).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const dataDir = () => process.env.WBS_HOME || join(homedir(), '.wb-superset')

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
  const log = openSync(join(dataDir(), 'daemon.log'), 'a')
  const args = [...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), daemonScript()]
  spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...env } }).unref()
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100))
    if (await alive()) return daemonInfo()!
  }
  throw new Error(`daemon didn't start; see ${join(dataDir(), 'daemon.log')}`)
}
