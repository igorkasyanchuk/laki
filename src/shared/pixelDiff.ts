// npm run test:sheet's comparison (main's uiSmoke, scripts/ui-sheet.ts): the share of pixels that changed between two
// pictures of one size, 0 to 1: a pixel whose red, green, blue or alpha moved by more than tol. Another size: all of
// it. Pure (raw 4-byte pixels in, either channel order): test/pixel-diff.test.ts. Node's (zlib): main's, the daemon's and
// the scripts', never the window's
import { inflateSync } from 'node:zlib'
export function pixelDiff(a: Uint8Array, aw: number, ah: number, b: Uint8Array, bw: number, bh: number, tol = 8): number {
  if (aw !== bw || ah !== bh || a.length !== b.length || a.length !== aw * ah * 4) return 1
  if (!a.length) return 0
  let n = 0
  for (let i = 0; i < a.length; i += 4)
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol || Math.abs(a[i + 3] - b[i + 3]) > tol) n++
  return n / (aw * ah)
}
// what the sheet calls changed: more than a hair (a clock's minute, a caret)
export const CHANGED = 0.0005

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// a PNG's pixels as RGBA (node's zlib, its five row filters): an 8-bit RGB or RGBA one, not interlaced, as Chromium's
// capturePage writes; anything else, or past 40 million pixels: none (no badge). ponytail: no palette or 16-bit
export function pngPixels(buf: Buffer): { w: number; h: number; px: Uint8Array } | undefined {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return
  let w = 0
  let h = 0
  let ok = false
  let rgba = false
  const idat: Buffer[] = []
  try {
  for (let i = 8; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i)
    const t = buf.toString('latin1', i + 4, i + 8)
    const d = buf.subarray(i + 8, i + 8 + len)
    if (t === 'IHDR') (w = d.readUInt32BE(0)), (h = d.readUInt32BE(4)), (rgba = d[9] === 6), (ok = d[8] === 8 && (d[9] === 6 || d[9] === 2) && d[12] === 0 && w > 0 && h > 0 && w * h <= 40e6)
    else if (t === 'IDAT') idat.push(d)
    else if (t === 'IEND') break
    i += 12 + len
  }
  } catch {
    return // cut short or not a PNG we read: no badge
  }
  if (!ok) return
  const bpp = rgba ? 4 : 3
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return
  }
  const stride = w * bpp
  if (raw.length < h * (stride + 1)) return
  const px = new Uint8Array(w * h * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const at = y * (stride + 1)
    const f = raw[at]
    const cur = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const l = x >= bpp ? cur[x - bpp] : 0
      const u = prev[x]
      const ul = x >= bpp ? prev[x - bpp] : 0
      const pa = Math.abs(u - ul)
      const pb = Math.abs(l - ul)
      const pc = Math.abs(l + u - 2 * ul)
      cur[x] = raw[at + 1 + x] + (f === 1 ? l : f === 2 ? u : f === 3 ? (l + u) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? l : pb <= pc ? u : ul) : 0)
    }
    for (let x = 0; x < w; x++) px.set(bpp === 4 ? cur.subarray(x * 4, x * 4 + 4) : [cur[x * 3], cur[x * 3 + 1], cur[x * 3 + 2], 255], (y * w + x) * 4)
    prev = cur
  }
  return { w, h, px }
}
