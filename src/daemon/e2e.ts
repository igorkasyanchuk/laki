// S14: remote access end to end (v1): what goes through the tunnel (cloudflared, tailscale) is sealed between the page
// and this daemon, so the tunnel's provider can't read or log it. A connection's key: HKDF-SHA-256 of a secret (the
// link's #k=, never sent; or a paired device's key, given inside a sealed connection) with a salt the daemon sends in
// clear as it opens, info E2E_INFO. Each frame AES-256-GCM, its 96-bit nonce 4 bytes of direction (0: the page's, 1:
// the daemon's) then an 8-byte counter, each side's own: a repeated or lower one is refused. The page's half is
// renderer/src/e2e.ts (WebCrypto, keys it can't read back). ponytail: the page's code still comes through the tunnel,
// so this stops reading and logging, not a provider that changes the script (SECURITY.md)
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export const E2E_INFO = 'laki-remote-e2e-v1'
export const PAGE = 0
export const DAEMON = 1
export const keyOf = (secret: Buffer, salt: Buffer, info = E2E_INFO) => Buffer.from(hkdfSync('sha256', secret, salt, info, 32))

export function seal(key: Buffer, dir: number, n: bigint, plain: Buffer | string): Buffer {
  const iv = Buffer.alloc(12)
  iv.writeUInt32BE(dir, 0)
  iv.writeBigUInt64BE(n, 4)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()])
}
// a frame's plain text and counter; a wrong key, tag or direction throws
export function open(key: Buffer, dir: number, frame: Buffer): { n: bigint; plain: Buffer } {
  if (frame.length < 28) throw new Error('not a sealed frame')
  if (frame.readUInt32BE(0) !== dir) throw new Error('a frame from the wrong side')
  const d = createDecipheriv('aes-256-gcm', key, frame.subarray(0, 12))
  d.setAuthTag(frame.subarray(frame.length - 16))
  return { n: frame.readBigUInt64BE(4), plain: Buffer.concat([d.update(frame.subarray(12, frame.length - 16)), d.final()]) }
}

// one connection's two directions: mine seals with its counter, the other side's opens only a higher one than the last
export function channel(key: Buffer, mine: number) {
  let out = 0n
  let last = -1n
  return {
    seal: (plain: Buffer | string) => seal(key, mine, out++, plain),
    open(frame: Buffer) {
      const { n, plain } = open(key, 1 - mine, frame)
      if (n <= last) throw new Error('a replayed frame')
      last = n
      return plain
    },
  }
}
export type Channel = ReturnType<typeof channel>

// the first frame of a connection, tried with each secret it may be sealed with (the link's, its device's): the one
// that opens it, its channel and what it said; none: undefined
export function first(secrets: Buffer[], salt: Buffer, frame: Buffer) {
  for (const s of secrets) {
    const ch = channel(keyOf(s, salt), DAEMON)
    try {
      return { ch, secret: s, plain: ch.open(frame) }
    } catch {}
  }
  return undefined
}

// a paired device's key at rest: sealed with a key from its cookie's token (state.json has the token's hash only), so
// the file alone opens nothing
const wrapKey = (token: string) => keyOf(Buffer.from(token), Buffer.alloc(16), 'laki-device-key-v1')
export const wrap = (token: string, key: Buffer) => seal(wrapKey(token), 0, randomBytes(8).readBigUInt64BE(), key).toString('base64') // a random nonce: a wrap again never reuses one
export function unwrap(token: string, sealed: string): Buffer | undefined {
  try {
    return open(wrapKey(token), 0, Buffer.from(sealed, 'base64')).plain
  } catch {
    return undefined
  }
}
export const secret = () => randomBytes(32)
export const salt = () => randomBytes(16)
