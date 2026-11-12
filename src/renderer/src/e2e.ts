// S14: remote access's page half of daemon/e2e.ts, in WebCrypto: a connection's AES-256-GCM key from HKDF-SHA-256 of a
// secret and the daemon's salt; each frame's nonce its direction (0: this page's) and counter; a repeated or lower one
// from the daemon refused. The secrets are CryptoKeys the page can't read back (not extractable), kept in IndexedDB:
// the link's #k= ('link') and a paired device's own key ('device', given inside a sealed connection)
const INFO = new TextEncoder().encode('laki-remote-e2e-v1')
type Name = 'link' | 'device'

export const baseKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveKey'])
export const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

export async function channel(base: CryptoKey, salt: Uint8Array) {
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  let out = 0n
  let last = -1n
  return {
    async seal(text: string) {
      const iv = new Uint8Array(12)
      const v = new DataView(iv.buffer)
      v.setUint32(0, 0)
      v.setBigUint64(4, out++)
      const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
      const f = new Uint8Array(12 + body.length)
      f.set(iv)
      f.set(body, 12)
      return f
    },
    // in the order they came (the caller chains them): the counter checked before, kept after
    async open(data: ArrayBuffer) {
      const f = new Uint8Array(data)
      if (f.length < 28) throw new Error('not a sealed frame')
      const v = new DataView(f.buffer, f.byteOffset, 12)
      if (v.getUint32(0) !== 1) throw new Error('a frame from the wrong side')
      const n = v.getBigUint64(4)
      if (n <= last) throw new Error('a replayed frame')
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f.slice(0, 12) }, key, f.slice(12))
      last = n
      return new TextDecoder().decode(plain)
    },
  }
}
export type Channel = Awaited<ReturnType<typeof channel>>

// IndexedDB's keys: a private window's or a blocked store's: none, said by the caller
function store<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return new Promise(res => {
    try {
      const o = indexedDB.open('laki-e2e', 1)
      o.onupgradeneeded = () => o.result.createObjectStore('keys')
      o.onerror = () => res(undefined)
      o.onsuccess = () => {
        try {
          const q = f(o.result.transaction('keys', mode).objectStore('keys'))
          q.onsuccess = () => res(q.result as T)
          q.onerror = () => res(undefined)
        } catch {
          res(undefined)
        }
      }
    } catch {
      res(undefined)
    }
  })
}
export const keyGet = (name: Name) => store<CryptoKey>('readonly', s => s.get(name))
export const keyPut = (name: Name, k: CryptoKey) => store('readwrite', s => s.put(k, name))
