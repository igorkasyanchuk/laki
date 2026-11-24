// Laki AI's keys (ai.ts: OpenRouter's, Your endpoint's) in the macOS Keychain where that's safe, else each in its 0600
// file as before. The Keychain only on a Mac, from a Developer ID signed build (codesign -dv on the binary, once: an
// ad-hoc signature is a new one after each update, and the Keychain would ask again every time) and the default data
// folder (~/.laki or ~/.laki-electron, whether or not LAKI_HOME says so: Laki's own launcher and tabs set it; a test's
// or another folder keeps files). A test's daemon forces it with LAKI_KEYCHAIN=1, through the
// `security` its PATH has (the rig's fake). /usr/bin/security: service "Laki AI", the key's name as the account; a
// write goes through `security -i` on stdin (never on a command line: ps shows those), then is read back. Each call
// waits 5 s at most; a value is never logged. A file there is the key to keep (not moved yet, or written when the
// Keychain failed): moved in once it reads back the same, then removed. Read once, then kept in memory (a read the
// Keychain didn't answer: asked again after a minute). A name or value with a line break or a NUL never goes in: on
// security -i's stdin it would end the command there and run the rest as more commands (kcSet false: its file keeps
// it). Widget secrets are kept here too (widgets.ts, one item: their JSON).
// ponytail: the first read is a sync spawn (a few ms; 5 s at worst) on the event loop
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeAtomic } from '../shared/conn.ts'
import { dir, inRig } from './dir.ts'

const SERVICE = 'Laki AI'
const forced = () => inRig() && process.env.LAKI_KEYCHAIN === '1'
let on: boolean | undefined
export function keychainOn() {
  if (on !== undefined) return on
  if (forced()) return (on = true)
  if (process.platform !== 'darwin' || inRig() || ![join(homedir(), '.laki'), join(homedir(), '.laki-electron')].includes(resolve(dir))) return (on = false)
  const r = spawnSync('/usr/bin/codesign', ['-dv', process.execPath], { encoding: 'utf8', timeout: 5000 })
  return (on = /^Authority=Developer ID Application:/m.test(r.stderr ?? ''))
}
const sec = (args: string[], input?: string) => spawnSync(forced() ? 'security' : '/usr/bin/security', args, { encoding: 'utf8', timeout: 5000, ...(input !== undefined && { input }) })
// undefined: the Keychain didn't answer; '': no such item (44: errSecItemNotFound)
export function kcGet(name: string): string | undefined {
  const r = sec(['find-generic-password', '-s', SERVICE, '-a', name, '-w'])
  return r.status === 0 ? r.stdout.replace(/\n$/, '') : r.status === 44 ? '' : undefined
}
const q = (s: string) => `"${s.replace(/[\\"]/g, c => `\\${c}`)}"`
const ONE_LINE = /^[^\r\n\0]*$/ // security -i reads a command a line
export const kcSet = (name: string, value: string) => ONE_LINE.test(name) && ONE_LINE.test(value) && sec(['-i'], `add-generic-password -U -s ${q(SERVICE)} -a ${q(name)} -w ${q(value)}\n`).status === 0 && kcGet(name) === value
export const kcRm = (name: string) => (s => s === 0 || s === 44)(sec(['delete-generic-password', '-s', SERVICE, '-a', name]).status)

const kept = new Map<string, string>()
const retry = new Map<string, number>() // a read the Keychain didn't answer: when to ask it again
const where = new Map<string, string>() // name → Keychain, or file (and why, when the Keychain failed)
const fileOf = (path: string) => {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}
export function keyRead(name: string, path: string): string {
  const k = kept.get(name)
  if (k !== undefined && !((retry.get(name) ?? Infinity) < Date.now())) return k
  retry.delete(name)
  let v = fileOf(path)
  if (!keychainOn()) where.set(name, 'file')
  else if (v) kcSet(name, v) ? (rmSync(path, { force: true }), where.set(name, 'Keychain')) : where.set(name, "file (the Keychain didn't take it)")
  else {
    const got = kcGet(name)
    if (got === undefined) where.set(name, "file (the Keychain didn't answer)"), retry.set(name, Date.now() + (Number(process.env.LAKI_KEYCHAIN_RETRY_MS) || 60_000))
    else (v = got), where.set(name, 'Keychain')
  }
  kept.set(name, v)
  return v
}
// a read the Keychain didn't answer (keyRead gave the file's, likely ''): a store of several values written now would
// lose the rest (widgets.ts' secrets)
export const keyUnread = (name: string) => retry.has(name)
// '': none (removed)
export function keyWrite(name: string, path: string, key: string) {
  if (keychainOn() && (key ? kcSet(name, key) : kcRm(name))) {
    rmSync(path, { force: true })
    where.set(name, 'Keychain')
  } else {
    if (key) writeAtomic(path, `${key}\n`, 0o600) // never half written: a crash keeps the one before
    else rmSync(path, { force: true })
    where.set(name, keychainOn() ? "file (the Keychain didn't take it)" : 'file')
  }
  kept.set(name, key)
  retry.delete(name)
}
// the diagnostics' line: where each key read or written so far is kept
export const keysWhere = () => (keychainOn() ? `the Keychain${where.size ? `: ${[...where].map(([k, w]) => `${k} in ${w}`).join(', ')}` : ''}` : 'files (0600)')
