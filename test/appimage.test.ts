// Linux self-update (src/main/appimage.ts): the release's AppImage downloaded beside the running one, checked against
// the release's SHA256SUMS.txt, swapped in under the same name and mode with one .previous kept; Go back swaps them;
// a copy that isn't an AppImage it may write is never one. A local server stands in for the release; a temp folder only
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appImageBack, appImageGet, appImageOf, appImageSwap, keptOf, previousOf } from '../src/main/appimage.ts'
import { STATE_V } from '../src/shared/update.ts'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

test('appimage: downloaded and checked beside the running one; a wrong sum or none is never kept; swapped in with its mode, one kept; Go back and only to an older one', async t => {
  const d = mkdtempSync(join(tmpdir(), 'laki-appimage-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  const f = join(d, 'Laki.AppImage')
  writeFileSync(f, 'old build')
  chmodSync(f, 0o755)
  const body = Buffer.alloc(300_000, 7)
  let sums = `${sha(body)}  Laki-0.70.0-x86_64.AppImage\n${'0'.repeat(64)}  Laki-0.70.0-arm64.AppImage\n`
  const srv = createServer((req, res) => {
    if (req.url === '/v0.70.0/SHA256SUMS.txt') return res.end(sums)
    if (req.url === '/v0.70.0/Laki-0.70.0-x86_64.AppImage' || req.url === '/v0.70.0/Laki-0.70.0-arm64.AppImage') return res.writeHead(200, { 'content-length': body.length }), res.end(body)
    res.writeHead(404).end()
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => srv.close())
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v0.70.0`
  const seen: number[] = []
  const part = await appImageGet({ f, base, version: '0.70.0', arch: 'x64', fetch, progress: got => seen.push(got) })
  assert.equal(part, join(d, '.Laki.AppImage.download'))
  assert.deepEqual(readFileSync(part), body)
  assert.equal(statSync(part).mode & 0o777, 0o755, "the running one's mode")
  assert.equal(seen.at(-1), body.length)
  // arm64's sum doesn't match its bytes: refused, nothing left; a release whose sums don't name it: refused
  await assert.rejects(appImageGet({ f, base, version: '0.70.0', arch: 'arm64', fetch }), /doesn't match the release's SHA256SUMS\.txt/)
  assert.ok(!existsSync(join(d, '.Laki.AppImage.download')))
  sums = ''
  await assert.rejects(appImageGet({ f, base, version: '0.70.0', arch: 'x64', fetch }), /has no Laki-0\.70\.0-x86_64\.AppImage/)
  await assert.rejects(appImageGet({ f, base: `${base}x`, version: '0.70.0', arch: 'x64', fetch }), /answered 404/)
  // the swap: the new one under the same name, the old one kept as .previous with its version
  sums = `${sha(body)}  Laki-0.70.0-x86_64.AppImage\n`
  const kept = join(d, 'kept.json')
  appImageSwap(f, await appImageGet({ f, base, version: '0.70.0', arch: 'x64', fetch }), '0.69.0', kept)
  assert.deepEqual(readFileSync(f), body)
  assert.equal(readFileSync(previousOf(f), 'utf8'), 'old build')
  assert.equal(statSync(f).mode & 0o777, 0o755)
  assert.deepEqual(keptOf(f, kept), { version: '0.69.0', stateV: STATE_V })
  assert.deepEqual(readdirSync(d).sort(), ['Laki.AppImage', 'Laki.AppImage.previous', 'kept.json'])
  // Go back: 0.69.0 in again, 0.70.0 kept; from 0.69.0, the newer one is no back
  assert.equal(appImageBack(f, '0.70.0', kept), undefined)
  assert.equal(readFileSync(f, 'utf8'), 'old build')
  assert.deepEqual(readFileSync(previousOf(f)), body)
  assert.match(String(appImageBack(f, '0.69.0', kept)), /0\.70\.0 isn't older than this one/)
  rmSync(previousOf(f))
  assert.equal(keptOf(f, kept), undefined, 'its file gone: none kept')
})

test("appimage: only an AppImage on Linux it may write, in a folder it may write", t => {
  const d = mkdtempSync(join(tmpdir(), 'laki-appimage-'))
  t.after(() => (chmodSync(d, 0o755), rmSync(d, { recursive: true, force: true })))
  const f = join(d, 'Laki.AppImage')
  writeFileSync(f, 'x')
  assert.equal(appImageOf({ APPIMAGE: f }, 'linux'), f)
  assert.equal(appImageOf({ APPIMAGE: f }, 'darwin'), undefined)
  assert.equal(appImageOf({}, 'linux'), undefined)
  assert.equal(appImageOf({ APPIMAGE: 'Laki.AppImage' }, 'linux'), undefined, 'a full path only')
  assert.equal(appImageOf({ APPIMAGE: d }, 'linux'), undefined, 'a file only')
  chmodSync(f, 0o444)
  assert.equal(appImageOf({ APPIMAGE: f }, 'linux'), undefined, 'a file it may not write')
  chmodSync(f, 0o644)
  chmodSync(d, 0o555)
  assert.equal(appImageOf({ APPIMAGE: f }, 'linux'), undefined, 'a folder it may not write')
})
