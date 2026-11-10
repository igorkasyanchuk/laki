// R6: what the pty host and the daemon say to each other over <data>/pty.sock: frames of a 4-byte length (big endian)
// and that many bytes of JSON. The daemon's ops: hello, list, spawn, attach, write, resize, kill, forget, quit; the
// host's events: hello, list, attached (replies, by `re`), spawned, data (`at`: its offset in the pty's output), exit.
// PTY_PROTO changes only when an older host can't serve a newer daemon: ops are added, never changed
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDir } from '../shared/conn.ts'

export const PTY_PROTO = 1
const MAX = 64 << 20

// a unix socket's path holds about 100 bytes: a data folder deeper than that gets one in the temp folder, by its hash
export function ptySock() {
  const p = join(dataDir(), 'pty.sock')
  return Buffer.byteLength(p) < 100 ? p : join(tmpdir(), `laki-pty-${createHash('sha256').update(p).digest('hex').slice(0, 16)}.sock`)
}

export function frame(m: unknown) {
  const body = Buffer.from(JSON.stringify(m))
  const head = Buffer.alloc(4)
  head.writeUInt32BE(body.length)
  return Buffer.concat([head, body])
}

// a socket's bytes as frames; throws on one too long or not JSON (the caller drops the connection)
export function reader(on: (m: any) => void) {
  let buf: Buffer = Buffer.alloc(0)
  return (chunk: Buffer | string) => {
    const d = typeof chunk === 'string' ? Buffer.from(chunk) : chunk // a socket with an encoding set gives strings
    buf = buf.length ? Buffer.concat([buf, d]) : d
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0)
      if (n > MAX) throw new Error('frame too long')
      if (buf.length < 4 + n) return
      const m = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'))
      buf = buf.subarray(4 + n)
      on(m)
    }
  }
}
