// #5 (daemon/picture.ts): a project's badge picture: the best of its logo, icon and favicon files, one folder down only
// when the root has none; sizes read from the files' own headers
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pictureIn, PICTURE_MAX, rankOf, sizeOf } from '../src/daemon/picture.ts'

const png = (w: number, h = w, tag = '') => {
  const b = Buffer.alloc(33 + tag.length)
  b.writeUInt32BE(0x89504e47, 0)
  b.writeUInt32BE(0x0d0a1a0a, 4)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12)
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  b.write(tag, 33)
  return b
}
const ico = (...sizes: number[]) => {
  const b = Buffer.alloc(6 + 16 * sizes.length)
  b.writeUInt16LE(1, 2)
  b.writeUInt16LE(sizes.length, 4)
  sizes.forEach((s, i) => ((b[6 + 16 * i] = s % 256), (b[7 + 16 * i] = s % 256)))
  return b
}
const svg = (w: number, h = w) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"/>`
function folder(t: { after: (f: () => void) => void }, files: Record<string, string | Buffer>) {
  const d = mkdtempSync(join(tmpdir(), 'laki-pic-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  for (const [f, b] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), b)
  }
  return d
}
const of = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')

test('sizeOf: PNG, ICO (0 is 256) and SVG from their headers; anything else none', () => {
  assert.deepEqual(sizeOf(png(512, 256), 'png'), [512, 256])
  assert.deepEqual(sizeOf(ico(16, 48, 0), 'ico'), [256, 256])
  assert.deepEqual(sizeOf(Buffer.from(svg(24, 12)), 'svg'), [24, 12])
  assert.deepEqual(sizeOf(Buffer.from('<svg width="64" height="32" xmlns="http://www.w3.org/2000/svg"/>'), 'svg'), [64, 32])
  assert.deepEqual(sizeOf(Buffer.from('png'), 'png'), [0, 0])
  assert.deepEqual(sizeOf(Buffer.from('<svg/>'), 'svg'), [0, 0])
})

test('rankOf: an SVG, then the smallest of 128 px or more, then the largest under it; maskable or wide ones last', () => {
  const order = [
    rankOf('icon.svg', 'svg', 24, 24),
    rankOf('apple-touch-icon.png', 'png', 180, 180),
    rankOf('icon-512.png', 'png', 512, 512),
    rankOf('favicon-32x32.png', 'png', 32, 32),
    rankOf('favicon.ico', 'ico', 16, 16),
    rankOf('logo.png', 'png', 800, 200),
    rankOf('icon-maskable.png', 'png', 512, 512),
  ]
  const sorted = [...order].sort((a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 })
  assert.deepEqual(sorted, order)
})

test('pictureIn: public/ with every kind of icon gives its SVG; without it the 180 px apple-touch-icon, not the 512 px or the maskable one', t => {
  const d = folder(t, { 'public/favicon.ico': ico(48), 'public/icon-192.png': png(192), 'public/icon-512.png': png(512), 'public/icon-maskable.png': png(512, 512, 'm'), 'public/apple-touch-icon.png': png(180), 'public/icon.svg': svg(32), 'public/manifest.webmanifest': '{}' })
  assert.match(pictureIn(d), /^data:image\/svg\+xml;base64,/)
  rmSync(join(d, 'public/icon.svg'))
  assert.deepEqual(of(pictureIn(d)), png(180))
  rmSync(join(d, 'public/apple-touch-icon.png'))
  assert.deepEqual(of(pictureIn(d)), png(192))
  for (const f of ['icon-192.png', 'icon-512.png']) rmSync(join(d, 'public', f))
  assert.deepEqual(of(pictureIn(d)), ico(48), 'a favicon before a maskable icon')
})

test('pictureIn: one folder down only when the root has none, never two; tests, packages and big files left out', t => {
  const d = folder(t, { 'web/public/icon.png': png(192), 'web/public/favicon.ico': ico(32), 'a/b/public/icon.svg': svg(8), 'node_modules/x/logo.svg': svg(8), 'test/logo.svg': svg(8), 'README.md': '' })
  assert.deepEqual(of(pictureIn(d)), png(192))
  writeFileSync(join(d, 'favicon.ico'), ico(16))
  assert.deepEqual(of(pictureIn(d)), ico(16), "the root's own wins over a better one down")
  const e = folder(t, { 'public/logo.png': Buffer.alloc(PICTURE_MAX + 1), 'x/y/logo.svg': svg(8) })
  assert.equal(pictureIn(e), '')
  assert.equal(pictureIn(join(e, 'missing')), '')
})

test("pictureIn: a new Rails app's red circle is a stand-in, its favicon instead", t => {
  const d = folder(t, { 'public/icon.svg': '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">\n  <circle cx="256" cy="256" r="256" fill="red"/>\n</svg>\n', 'public/favicon-32x32.png': 'png' })
  assert.equal(pictureIn(d), `data:image/png;base64,${Buffer.from('png').toString('base64')}`)
})
