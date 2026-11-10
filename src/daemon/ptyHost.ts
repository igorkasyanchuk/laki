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
export const ptyList = async () => (await ask<{ ptys: PtyInfo[] }>({ op: 'list' })).ptys
export const ptyForget = (id: string) => (open.delete(id), post({ op: 'forget', id }))
export const ptyQuit = () => ((wanted = false), post({ op: 'quit' }))
export const ptyClose = () => ((wanted = false), void sock?.destroy()) // tests': the connection dropped, the host left as it is
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
  // everything the host kept of its output; what it prints from here on comes through onData, in order after it
  async attach() {
    const m = await ask<{ gone?: boolean; pid: number; d: string }>({ op: 'attach', id: this.id, from: 0 })
    if (m.gone) throw new Error('that terminal is gone')
    this.pid = m.pid
    return m.d
  }
  got(m: any) {
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
    open.get(m.id)?.got(m)
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
    if (wanted) setTimeout(() => void ptyUp().catch(e => log((e as Error).message)), 1000).unref() // new terminals go to a new one
  })
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
async function up(): Promise<void> {
  if (sock) return
  let s = await dial().catch(() => undefined)
  if (!s) {
    const out = openSync(join(dir, 'ptyhost.log'), 'a')
    spawn(process.execPath, [...process.execArgv.filter(a => a.startsWith('--experimental') || a === '--no-warnings'), script()], { detached: true, stdio: ['ignore', out, out] }).unref()
    for (let i = 0; i < 50 && !s; i++) (await sleep(100), (s = await dial().catch(() => undefined)))
  }
  if (!s) throw new Error("the pty host didn't start: see ptyhost.log")
  wire(s)
  const h = await ask<{ version?: number; pid?: number }>({ op: 'hello', version: PTY_PROTO })
  if (h.version === undefined) throw new Error('the pty host turned this daemon away (another one is connected)')
  hostPid = h.pid ?? 0
  wanted = true
  if (h.version === PTY_PROTO) return
  // another version's: started again only when it holds no live terminal (an update never ends a turn); until then it
  // serves this daemon as it is (the protocol's ops are only ever added to)
  if ((await ptyList()).some(p => p.exit === undefined)) return log(`protocol ${h.version}, this daemon's is ${PTY_PROTO}: kept until its terminals end`)
  log(`protocol ${h.version}, this daemon's is ${PTY_PROTO}: starting it again`)
  const closed = new Promise(r => s.once('close', r))
  ptyQuit()
  wanted = true
  await closed
  await sleep(300)
  return up()
}
let upping: Promise<void> | undefined
export const ptyUp = () => (upping ??= up().finally(() => (upping = undefined)))
