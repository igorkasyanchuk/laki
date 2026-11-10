// R6: the pty host. One small process that owns the terminals (node-pty) and the last 2 MB each one printed, so a
// daemon that crashes, stops or is updated finds them still running: it lists them, attaches and replays the buffer.
// No state.json, no git, no hooks: it reads no file and takes only proto.ts' ops, on a socket of the user's alone
// (0600, no TCP). The daemon starts it when settings.ptyHost is on (daemon/ptyHost.ts); it ends with `quit`, or with
// no live terminal and no daemon for 10 minutes, or no daemon at all for 3 days, or (tests) once LAKI_TEST_PARENT is gone.
// ponytail: a resize isn't kept in the buffer: a replay is drawn at the size the pty has now, and one cut at 2 MB may
// start inside an escape sequence
import pty from '@lydell/node-pty'
import { chmodSync, rmSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { frame, PTY_PROTO, ptySock, reader } from './proto.ts'

const RING = 2 << 20 // characters of output kept per terminal
const IDLE = Number(process.env.LAKI_PTY_IDLE_MS) || 600_000
const ORPHAN = Number(process.env.LAKI_PTY_ORPHAN_MS) || 72 * 3600_000 // no daemon that long: its terminals are ended (Laki not opened again, or removed)
const VERSION = Number(process.env.LAKI_PTY_VERSION) || PTY_PROTO // tests': a host of another version
const SIGNALS = new Set(['SIGHUP', 'SIGKILL', 'SIGINT', 'SIGTERM'])

type P = { id: string; pty: ReturnType<typeof pty.spawn>; cols: number; rows: number; buf: string[]; size: number; start: number; exit?: number; last: number; subs: Set<Socket> }
const ptys = new Map<string, P>()
const socks = new Set<Socket>()
let quiet = Date.now() // when the last daemon left or the last terminal ended
let alone = Date.now() // when the last daemon left
const path = ptySock()
const log = (...a: unknown[]) => console.log(new Date().toISOString(), 'ptyhost', ...a)
const send = (s: Socket, m: unknown) => void (s.destroyed || s.write(frame(m)))
const live = () => [...ptys.values()].filter(p => p.exit === undefined)
const size = (v: unknown, max: number, d: number) => Math.max(1, Math.min(max, Number(v) | 0 || d))

// the whole job: node-pty makes the child a session leader
function signal(p: P, sig: string) {
  try {
    process.kill(-p.pty.pid, sig)
  } catch {}
  try {
    p.pty.kill(sig)
  } catch {}
}
function quit(why: string) {
  log(`quitting: ${why}`)
  for (const p of live()) signal(p, 'SIGHUP')
  server.close()
  rmSync(path, { force: true })
  setTimeout(() => process.exit(0), 200)
}

const ops: Record<string, (s: Socket, m: any) => void> = {
  hello: (s, m) => send(s, { re: m.re, ev: 'hello', version: VERSION, pid: process.pid }),
  list: (s, m) => send(s, { re: m.re, ev: 'list', ptys: [...ptys.values()].map(p => ({ id: p.id, pid: p.pty.pid, cols: p.cols, rows: p.rows, exit: p.exit, start: p.start, end: p.start + p.size, last: p.last })) }),
  spawn(s, m) {
    const id = String(m.id)
    if (ptys.has(id)) return send(s, { ev: 'exit', id, code: 1, error: 'that terminal is there already' })
    const cols = size(m.cols, 1000, 120)
    const rows = size(m.rows, 500, 32)
    let t: P['pty']
    try {
      t = pty.spawn(String(m.file), (Array.isArray(m.args) ? m.args : []).map(String), { name: 'xterm-256color', cols, rows, cwd: String(m.cwd), env: m.env })
    } catch (e) {
      return send(s, { ev: 'exit', id, code: 1, error: (e as Error).message })
    }
    const p: P = { id, pty: t, cols, rows, buf: [], size: 0, start: 0, last: Date.now(), subs: new Set([s]) }
    ptys.set(id, p)
    t.onData(d => {
      const at = p.start + p.size
      p.buf.push(d)
      p.size += d.length
      while (p.size > RING && p.buf.length > 1) {
        const old = p.buf.shift()!
        p.size -= old.length
        p.start += old.length
      }
      p.last = Date.now()
      for (const c of p.subs) send(c, { ev: 'data', id, at, d })
    })
    t.onExit(({ exitCode, signal: sig }) => {
      p.exit = sig ? 128 + sig : exitCode // killed: not a clean exit
      quiet = Date.now()
      for (const c of p.subs) send(c, { ev: 'exit', id, code: p.exit })
    })
    send(s, { ev: 'spawned', id, pid: t.pid })
  },
  // what it printed from an offset on (all that's kept: from 0), then every byte after, in order on this socket
  attach(s, m) {
    const p = ptys.get(String(m.id))
    if (!p) return send(s, { re: m.re, ev: 'attached', id: m.id, gone: true })
    const want = Number(m.from) || 0
    const from = Math.max(p.start, Math.min(want, p.start + p.size))
    p.subs.add(s)
    send(s, { re: m.re, ev: 'attached', id: p.id, at: from, d: p.buf.join('').slice(from - p.start), cut: want < p.start, pid: p.pty.pid, cols: p.cols, rows: p.rows, exit: p.exit })
  },
  write(_, m) {
    const p = ptys.get(String(m.id))
    if (p && p.exit === undefined && typeof m.data === 'string') p.pty.write(m.data)
  },
  resize(_, m) {
    const p = ptys.get(String(m.id))
    if (!p || p.exit !== undefined) return
    p.cols = size(m.cols, 1000, p.cols)
    p.rows = size(m.rows, 500, p.rows)
    try {
      p.pty.resize(p.cols, p.rows)
    } catch {}
  },
  kill(_, m) {
    const p = ptys.get(String(m.id))
    if (p && p.exit === undefined) signal(p, SIGNALS.has(m.signal) ? m.signal : 'SIGHUP')
  },
  // one the daemon is done with: ended if it still runs, its buffer let go
  forget(_, m) {
    const p = ptys.get(String(m.id))
    if (!p) return
    if (p.exit === undefined) signal(p, 'SIGHUP')
    ptys.delete(p.id)
  },
  quit: () => quit('asked to'),
}

// the socket is the user's alone from the moment it's bound (the chmod below is for a umask-less filesystem); only
// around the bind (it's bound in the call): a umask kept would be every terminal's, its files 0600
const listen = () => {
  const was = process.umask(0o077)
  try {
    server.listen(path)
  } finally {
    process.umask(was)
  }
}
const server = createServer(s => {
  // one daemon at a time: while it's connected nothing else gets in (an agent's process could otherwise type into any
  // terminal past the daemon's gates). ponytail: with no daemon up, the first to connect is taken for it, as any
  // process of the user can read daemon.json's token
  if (socks.size) return void s.destroy()
  socks.add(s)
  const feed = reader(m => (typeof m?.op === 'string' && Object.hasOwn(ops, m.op) ? ops[m.op](s, m) : undefined))
  s.on('data', d => {
    try {
      feed(d)
    } catch (e) {
      log(`dropped a connection: ${(e as Error).message}`)
      s.destroy()
    }
  })
  s.on('error', () => {})
  s.on('close', () => {
    socks.delete(s)
    quiet = alone = Date.now()
    for (const p of ptys.values()) p.subs.delete(s)
  })
})
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') return log(e.message), process.exit(1)
  // a socket file there: another host's (it stays, this one goes), or one left by a host that died
  const probe = connect(path)
  probe.once('connect', () => process.exit(0))
  probe.once('error', () => (rmSync(path, { force: true }), listen()))
})
server.on('listening', () => (chmodSync(path, 0o600), log(`listening on ${path} (protocol ${VERSION}, pid ${process.pid})`)))
listen()

const parent = Number(process.env.LAKI_TEST_PARENT)
setInterval(() => {
  if (parent) {
    try {
      process.kill(parent, 0)
    } catch {
      return quit('the test is gone')
    }
  }
  if (!socks.size && !live().length && Date.now() - quiet > IDLE) quit('no terminal and no daemon')
  else if (!socks.size && Date.now() - alone > ORPHAN) quit('no daemon for too long')
}, Math.min(IDLE, 2000))
process.on('SIGTERM', () => quit('SIGTERM'))
process.on('uncaughtException', e => log('uncaught', e))
