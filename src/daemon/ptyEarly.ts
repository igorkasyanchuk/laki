// R6: the pty host started as the daemon starts, before the daemon's other modules load: the host's own start (a
// node process, ~100 ms) then runs beside theirs, and ptyAdopt finds it up instead of waiting for it (main.ts imports
// this second, ptyHost.ts' up dials it rather than starting another; docs/dev/agents.md). Only for the daemon itself
// (its entry script: never a module imported by a test or the CLI), when state.json turns the host on (none there: a
// new install's default, core.load's), no host's socket is there and no other daemon holds the data folder's lock.
// Anything amiss: nothing done here, and ptyAdopt starts it as before
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../shared/conn.ts'
import { ptySock } from '../ptyhost/proto.ts'

const entry = /daemon(\.js|[\\/]main\.ts)$/.test(process.argv[1] ?? '')
const alive = (pid: number) => {
  try {
    return process.kill(pid, 0), true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
function start() {
  const dir = dataDir()
  const state = join(dir, 'state.json')
  const on = existsSync(state) ? (JSON.parse(readFileSync(state, 'utf8')) as { settings?: { ptyHost?: unknown } }).settings?.ptyHost === true : true
  if (!on || existsSync(ptySock())) return false
  const lock = Number((() => {
    try {
      return readFileSync(join(dir, 'daemon.lock'), 'utf8').trim()
    } catch {
      return 0
    }
  })())
  if (lock && lock !== process.pid && alive(lock)) return false // another daemon's: its host, if it has one, is its own
  const here = dirname(fileURLToPath(import.meta.url))
  const script = [join(here, 'ptyhost.js'), join(here, '../ptyhost.js'), join(here, '../ptyhost/main.ts')].find(p => existsSync(p)) // ptyHost.ts' script()
  if (!script) return false
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const out = openSync(join(dir, 'ptyhost.log'), 'a')
  const { LAKI_APP_PIPE: _, ...env } = process.env // main.ts' own (fd 3: the app's token), gone from its env as it loads
  spawn(process.execPath, [...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), script], { detached: true, stdio: ['ignore', out, out], env }).unref()
  return true
}
// whether this daemon started the host here (main.ts tells ptyHost.ts: ptyEarly)
export const earlyHost = (() => {
  if (!entry) return false
  try {
    return start()
  } catch {
    return false
  }
})()
