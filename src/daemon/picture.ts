// #5: a project's picture for its badge, found in its folder: its logo, icon or favicon (an SVG, PNG or ICO of 64 KB at
// most) at its root and in the folders a web app keeps them (public/, static/, assets/…); only when those have none, the
// same one folder down (web/public/, an app's own folder in a monorepo), never deeper. The best of them: an SVG, then a
// PNG or ICO of 128 px or more (the smallest such: a 512 px one is many times the bytes for a 20 px badge), else the
// largest under that; a maskable icon (its safe zone's padding) or a wide one (a wordmark) after any other; then logo,
// icon, apple-touch-icon, android-chrome, favicon. ponytail: no web manifest or <link rel=icon> read; a picture's size
// from its header (PNG's IHDR, ICO's entries, SVG's viewBox or width and height), none: the smallest
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NAMES = ['logo', 'icon', 'apple-touch-icon', 'android-chrome', 'favicon']
const NAME = /^(logo|icon|apple-touch-icon|android-chrome|favicon)([-_.@][\w.@-]*)?\.(svg|png|ico)$/i
const SUBS = ['', 'public', 'static', 'assets', 'app', 'src/app', 'app/assets/images', 'docs', '.github', 'build', 'resources', 'web', 'public/icons', 'public/images', 'assets/images', 'src/assets', 'images', 'icons']
const DOWN_SUBS = ['', 'public', 'static', 'assets', 'app', 'src/app', 'resources', 'build']
// one folder down: never these (an installed package's, a build's, a test's or an example's picture isn't the repo's)
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'out', 'target', 'tmp', 'log', 'logs', 'coverage', 'test', 'tests', 'spec', 'fixtures', 'example', 'examples', 'samples', 'Pods'])
const DOWN_MAX = 40
export const PICTURE_MAX = 64 << 10
const GOOD = 128 // px: enough for a badge at any scale
// a new Rails app's public/icon.svg and icon.png: a plain red circle in every one, never the repo's own (its favicon is)
const PLACEHOLDERS = new Set(['ba7398f28422ebe3abbaf1f677afae671c5a65e7', '52f3bfec2798e4cb7ef3e4814ad6e5adb1e71269'])

type Found = { b: Buffer; ext: string; rank: number[] }

// width and height from the file's own header (0 when it doesn't say)
export function sizeOf(b: Buffer, ext: string): [number, number] {
  if (ext === 'png') return b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0]
  if (ext === 'ico') {
    if (b.length < 6 || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return [0, 0]
    let best: [number, number] = [0, 0]
    for (let i = 0, n = b.readUInt16LE(4); i < n && 6 + 16 * i + 2 <= b.length; i++) {
      const w = b[6 + 16 * i] || 256, h = b[7 + 16 * i] || 256 // 0: 256
      if (w * h > best[0] * best[1]) best = [w, h]
    }
    return best
  }
  const head = b.subarray(0, 4096).toString('utf8')
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(head)
  if (vb) return [Number(vb[1]), Number(vb[2])]
  const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(head), h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(head)
  return w && h ? [Number(w[1]), Number(h[1])] : [0, 0]
}

// lower is better, compared item by item
export function rankOf(name: string, ext: string, w: number, h: number): number[] {
  const px = Math.min(w, h)
  const odd = /maskable/i.test(name) || (px > 0 && Math.max(w, h) / px > 1.25) ? 3 : 0
  const tier = ext === 'svg' ? 0 : px >= GOOD ? 1 : 2
  return [odd + tier, tier === 1 ? px : tier === 2 ? -px : 0, NAMES.indexOf(NAME.exec(name)![1].toLowerCase())]
}
const better = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false // a tie: the one found first (the root before public/…)
}

function bestIn(root: string, subs: string[]): Found | undefined {
  let best: Found | undefined
  for (const s of subs) {
    let names: string[]
    try {
      names = readdirSync(join(root, s))
    } catch {
      continue
    }
    for (const f of names.filter(n => NAME.test(n)).sort())
      try {
        const st = statSync(join(root, s, f), { throwIfNoEntry: false })
        if (!st?.isFile() || !st.size || st.size > PICTURE_MAX) continue
        const b = readFileSync(join(root, s, f))
        if (PLACEHOLDERS.has(createHash('sha1').update(b).digest('hex'))) continue // a framework's stand-in, not the repo's
        const ext = f.slice(f.lastIndexOf('.') + 1).toLowerCase()
        const rank = rankOf(f, ext, ...sizeOf(b, ext))
        if (!best || better(rank, best.rank)) best = { b, ext, rank }
      } catch {}
  }
  return best
}

// the folder's picture as a data URL, '' for none
export function pictureIn(root: string): string {
  let got = bestIn(root, SUBS)
  if (!got) {
    let kids: string[] = []
    try {
      kids = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name)).map(d => d.name).sort().slice(0, DOWN_MAX)
    } catch {}
    for (const k of kids) {
      const f = bestIn(join(root, k), DOWN_SUBS)
      if (f && (!got || better(f.rank, got.rank))) got = f
    }
  }
  return got ? `data:image/${got.ext === 'svg' ? 'svg+xml' : got.ext === 'ico' ? 'x-icon' : 'png'};base64,${got.b.toString('base64')}` : ''
}
