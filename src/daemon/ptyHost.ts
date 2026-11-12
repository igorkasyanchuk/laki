// R6: the daemon's side of the pty host (src/ptyhost/main.ts): its connection, started when missing, and a HostPty per
// terminal that Session uses as it uses node-pty's. Only with settings.ptyHost on (core's spawnTab, ptyAdopt).
// No core import: nothing here reads the model
import { spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frame, PTY_PROTO, ptySock, reader } from '../ptyhost/proto.ts'
import { dir } from './dir.ts'

export type PtyInfo = { id: string; pid: number; cols: number; rows: number; exit?: number; start: number; end: number; last: number }
export type PtySpawn = { file: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
type Exit = { exitCode: number; signal?: number }

let sock: Socket | undefined
let wanted = false // it was up: one that goes is started again (not after ptyQuit or ptyClose)
let hostPid = 0
let seq = 0
const waits = new Map<number, (m: any) => void>()
const open = new Map<string, HostPty>()
const log = (...a: unknown[]) => console.log(new Date().toISOString(), 'pty host:', ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const post = (m: object) => void sock?.write(frame(m))
const ask = <T>(m: object) =>
  new Promise<T>((res, rej) => {
    if (!sock) return rej(new Error('no pty host'))
    const re = ++seq
    const t = setTimeout(() => (waits.delete(re), rej(new Error("the pty host didn't answer"))), 5000)
    waits.set(re, x => (clearTimeout(t), res(x)))
    post({ ...m, re })
  })

export const ptyOn = () => !!sock
// R9: new terminals go to the host only when it speaks this daemon's protocol; another's keeps serving the terminals it
// has (an update never ends a turn), the new ones run in the daemon. why: what keeps them out (it didn't start, another
// protocol), for the view's ptyHostOff and the diagnostics
let hostVersion = 0
let why: string | undefined
export const ptyTakes = () => !!sock && hostVersion === PTY_PROTO
export const ptyWhy = () => why
export const ptyVersion = () => hostVersion
export const ptyList = async () => (await ask<{ ptys: PtyInfo[] }>({ op: 'list' })).ptys
export const ptyForget = (id: string) => (open.delete(id), post({ op: 'forget', id }))
export const ptyQuit = () => ((wanted = false), post({ op: 'quit' }))
export const ptyClose = (again = false) => ((wanted = again), void sock?.destroy()) // tests': the connection dropped, the host left as it is; again: as one lost (it's dialed again)
export const ptyPid = () => hostPid

// a terminal in the host, as node-pty's IPty to Session: its pid is -1 until the host says (never 0: a kill of -0 is
// this process's own group, and every process's line of parents ends at 0)
export class HostPty {
  pid = -1
  readonly id: string
  private data: ((d: string) => void)[] = []
  private exits: ((e: Exit) => void)[] = []
  // o: a new one; none: one that's there already (attach)
  constructor(id: string, o?: PtySpawn) {
    this.id = id
    open.set(id, this)
    if (o) post({ op: 'spawn', id, ...o })
  }
  onData(f: (d: string) => void) {
    this.data.push(f)
  }
  onExit(f: (e: Exit) => void) {
    this.exits.push(f)
  }
  write(d: string) {
    post({ op: 'write', id: this.id, data: d })
  }
  resize(cols: number, rows: number) {
    post({ op: 'resize', id: this.id, cols, rows })
  }
  kill(signal = 'SIGHUP') {
    post({ op: 'kill', id: this.id, signal })
  }
  group = (signal: string) => this.kill(signal) // the host signals the whole job
  private held?: any[] // attach: what the host says of it meanwhile, until flow
  private end = 0 // attach: where its buffer ends: a data frame from before that is in it
  // everything the host kept of its output. What it says meanwhile is held (frames read with the reply are handled
  // before the caller has drawn the buffer) until flow(): then onData, in order after it
  async attach() {
    this.held = []
    const m = await ask<{ gone?: boolean; pid: number; d: string; at: number }>({ op: 'attach', id: this.id, from: 0 })
    if (m.gone) throw new Error('that terminal is gone')
    this.pid = m.pid
    this.end = m.at + m.d.length
    return m.d
  }
  flow() {
    const h = this.held ?? []
    this.held = undefined
    for (const m of h) if (m.ev !== 'data' || m.at >= this.end) this.got(m)
  }
  got(m: any) {
    if (this.held) return void this.held.push(m)
    if (m.ev === 'spawned') this.pid = m.pid
    else if (m.ev === 'data') for (const f of this.data) f(m.d)
    else if (m.ev === 'exit') {
      if (!open.delete(this.id)) return
      if (m.error) for (const f of this.data) f(`\r\n\x1b[2m[${m.error}]\x1b[0m\r\n`)
      for (const f of this.exits) f({ exitCode: Number(m.code) || 0 })
      post({ op: 'forget', id: this.id })
    }
  }
}

function wire(s: Socket) {
  sock = s
  const feed = reader(m => {
    const w = m.re ? waits.get(m.re) : undefined
    if (w) return waits.delete(m.re), w(m)
    try {
      open.get(m.id)?.got(m)
    } catch (e) {
      log(`${m.id}: ${(e as Error).message}`) // a terminal's own handler's: not a bad frame, the others go on
    }
  })
  s.on('data', d => {
    try {
      feed(d)
    } catch (e) {
      log(`a bad frame: ${(e as Error).message}`)
      s.destroy()
    }
  })
  s.on('error', () => {})
  s.on('close', () => {
    if (sock !== s) return
    sock = undefined
    if (open.size) log(`gone, ${open.size} terminals with it`)
    for (const p of [...open.values()]) p.got({ ev: 'exit', code: 1, error: 'the pty host is gone' })
    for (const [re, w] of waits) (waits.delete(re), w({ gone: true, ptys: [] }))
    if (wanted) (wanted = false), setTimeout(() => void ptyUp().then(lost).catch(e => log((e as Error).message)), 1000).unref() // new terminals go to a new one; once: a host that turns this daemon away isn't asked every second
  })
}
// back after a connection lost with the host still there: what it still runs was told gone here (the tabs say so, an
// Enter starts them again), so it's ended there too: nothing runs unseen
const lost = async () => {
  for (const p of await ptyList()) if (!open.has(p.id)) post({ op: 'forget', id: p.id })
}
const dial = () =>
  new Promise<Socket>((res, rej) => {
    const s = connect(ptySock())
    s.once('connect', () => (s.removeAllListeners('error'), res(s)))
    s.once('error', rej)
  })
// next to this bundle (out/main/ptyhost.js), or the TS source when run from src/
function script() {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [join(here, 'ptyhost.js'), join(here, '../ptyhost.js'), join(here, '../ptyhost/main.ts')]) if (existsSync(p)) return p
  throw new Error('pty host script not found')
}
async function up(again = true): Promise<void> {
  if (sock) return
  let s = await dial().catch(() => undefined)
  if (!s) {
    let out: number
    try {
      out = openSync(join(dir, 'ptyhost.log'), 'a')
    } catch (e) {
      throw new Error(`the pty host didn't start (${(e as Error).message})`)
    }
    spawn(process.execPath, [...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), script()], { detached: true, stdio: ['ignore', out, out] }).unref()
    for (let i = 0; i < 50 && !s; i++) (await sleep(100), (s = await dial().catch(() => undefined)))
  }
  if (!s) throw new Error("the pty host didn't start: see ptyhost.log")
  wire(s)
  const h = await ask<{ version?: number; pid?: number }>({ op: 'hello', version: PTY_PROTO })
  if (h.version === undefined) throw new Error('the pty host turned this daemon away (another one is connected)')
  hostPid = h.pid ?? 0
  hostVersion = h.version
  wanted = true
  if (h.version === PTY_PROTO) return
  // another version's: started again only when it holds no live terminal (an update never ends a turn); until then it
  // serves this daemon as it is (the protocol's ops are only ever added to)
  if (!again || (await ptyList()).some(p => p.exit === undefined)) return log(`protocol ${h.version}, this daemon's is ${PTY_PROTO}: kept for the terminals it has, new ones run in Laki`) // !again: one started anew speaks it too (it never will: in-daemon terminals)
  log(`protocol ${h.version}, this daemon's is ${PTY_PROTO}: starting it again`)
  const closed = new Promise(r => s.once('close', r))
  ptyQuit()
  wanted = true
  await closed
  await sleep(300)
  return up(false)
}
// the setting off: a host left from when it was on is ended, its terminals with it (their tabs start again as any)
export async function ptyGone() {
  why = undefined
  if (sock) return ptyQuit()
  const s = existsSync(ptySock()) ? await dial().catch(() => undefined) : undefined
  s?.end(frame({ op: 'quit' }))
}
let upping: Promise<void> | undefined
export const ptyUp = () =>
  (upping ??= up()
    .then(
      () => void (why = hostVersion === PTY_PROTO ? undefined : `it speaks protocol ${hostVersion}, this Laki ${PTY_PROTO}: new terminals run in Laki`),
      e => {
        why = (e as Error).message
        throw e
      },
    )
    .finally(() => (upping = undefined)))
