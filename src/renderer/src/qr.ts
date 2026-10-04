// QR codes (ISO/IEC 18004) for a URL to open on a phone: byte mode, error correction level M,
// versions 1–40, the mask with the lowest penalty.
// ponytail: one mode and one level; add others if something other than URLs needs a code.

// per version (index 1–40) at level M: error correction codewords per block, and blocks
const EC_LEN = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]

// modules left for data and error correction once the function patterns are drawn
function rawModules(v: number) {
  let n = (16 * v + 128) * v + 64
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2
    n -= (25 * a - 10) * a - 55
    if (v >= 7) n -= 36
  }
  return n
}
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - EC_LEN[v] * BLOCKS[v]

// GF(256) with the polynomial 0x11d
function mul(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
function rsDivisor(degree: number) {
  const r = new Array<number>(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = mul(r[j], root)
      if (j + 1 < degree) r[j] ^= r[j + 1]
    }
    root = mul(root, 2)
  }
  return r
}
function rsRemainder(data: number[], div: number[]) {
  const r = new Array<number>(div.length).fill(0)
  for (const b of data) {
    const f = b ^ r.shift()!
    r.push(0)
    div.forEach((c, i) => (r[i] ^= mul(c, f)))
  }
  return r
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

// the code for text: rows of modules, true = dark (no quiet zone)
export function qr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  let v = 1
  for (; ; v++) {
    if (v > 40) throw new Error('too long for a QR code')
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break
  }
  // the bit stream: mode, length, bytes, terminator, padding
  const bits: number[] = []
  const put = (x: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((x >>> i) & 1)
  }
  put(4, 4)
  put(bytes.length, v < 10 ? 8 : 16)
  bytes.forEach(b => put(b, 8))
  const cap = dataCodewords(v) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // blocks with their error correction, interleaved
  const nb = BLOCKS[v]
  const ecLen = EC_LEN[v]
  const raw = Math.floor(rawModules(v) / 8)
  const short = nb - (raw % nb)
  const shortLen = Math.floor(raw / nb)
  const div = rsDivisor(ecLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - ecLen + (i < short ? 0 : 1))
    k += d.length
    const ec = rsRemainder(d, div)
    if (i < short) d.push(0)
    blocks.push([...d, ...ec])
  }
  const words: number[] = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => (i !== shortLen - ecLen || j >= short) && words.push(b[i]))

  // function patterns
  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    m[y][x] = dark
    fn[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
  const align: number[] = []
  if (v > 1) {
    const n = Math.floor(v / 7) + 2
    const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
    for (let p = size - 7; align.length < n - 1; p -= step) align.unshift(p)
    align.unshift(6)
  }
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return // the finders
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }),
  )
  const format = (mask: number) => {
    const d = mask // level M's bits are 00
    let r = d
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537)
    const b = ((d << 10) | r) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i))
    set(8, 7, bit(b, 6))
    set(8, 8, bit(b, 7))
    set(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i))
    set(8, size - 8, true)
  }
  format(0) // reserves its modules
  if (v >= 7) {
    let r = v
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const b = (v << 12) | r
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      set(a, c, bit(b, i))
      set(c, a, bit(b, i))
    }
  }

  // the codewords, two columns at a time in a zigzag from the bottom right
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!fn[y][x] && i < words.length * 8) {
          m[y][x] = bit(words[i >>> 3], 7 - (i & 7))
          i++
        }
      }
  }

  // each mask, keeping the one with the lowest penalty
  const masks = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const apply = (k: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[k](x, y)) m[y][x] = !m[y][x]
  }
  let best = 0
  let low = Infinity
  for (let k = 0; k < 8; k++) {
    apply(k)
    format(k)
    const p = penalty(m)
    if (p < low) [best, low] = [k, p]
    apply(k) // undo
  }
  apply(best)
  format(best)
  return m
}

// the standard's penalty: runs of 5+, 2×2 blocks, finder-like patterns, dark/light balance
function penalty(m: boolean[][]) {
  const n = m.length
  let p = 0
  const finder = [true, false, true, true, true, false, true]
  const line = (get: (i: number) => boolean) => {
    for (let i = 0, run = 0; i < n; i++) {
      run = i > 0 && get(i) === get(i - 1) ? run + 1 : 1
      if (run === 5) p += 3
      else if (run > 5) p++
    }
    for (let i = 0; i + 7 <= n; i++) {
      if (!finder.every((d, k) => get(i + k) === d)) continue
      const light = (a: number, b: number) => {
        for (let k = a; k < b; k++) if (k >= 0 && k < n && get(k)) return false
        return true
      }
      if (light(i - 4, i) || light(i + 7, i + 11)) p += 40
    }
  }
  for (let y = 0; y < n; y++) line(i => m[y][i])
  for (let x = 0; x < n; x++) line(i => m[i][x])
  let dark = 0
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (m[y][x]) dark++
      if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
    }
  return p + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10
}

// an SVG path of the dark modules, with a 4-module quiet zone: draw it in a viewBox of (size + 8)²
export function qrPath(m: boolean[][]) {
  let d = ''
  m.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x + 4} ${y + 4}h1v1h-1z`)))
  return d
}
