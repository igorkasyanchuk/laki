// Linux self-update (update.ts on Linux): when Laki runs as an AppImage ($APPIMAGE, the file AppImage's runtime says it
// started from) that it may replace (a file it can write, in a folder it can write), Update downloads the release's
// AppImage for this architecture beside it (.<name>.download), checks it against the same release's SHA256SUMS.txt and
// gives it the running one's mode; Restart to update swaps it in by rename under the same name, the one it replaces
// kept as <name>.previous (one only, for Go back), then starts it. Anything else (not an AppImage, a file or folder it
// can't write, a release with none for this architecture): Download, the release's page, as before.
// ponytail: the trust limit is TLS (GitHub's) plus a checksum from the same release, no signature: someone who could
// publish a release could publish both. docs/trust.md says so; a signature of its own (minisign) is the upgrade.
// No electron here (test/appimage.test.ts runs it on node): update.ts passes Electron's net.fetch
import { createHash } from 'node:crypto'
import { accessSync, chmodSync, closeSync, constants, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { appImageName, type Kept, newer, STATE_V, sumOf } from '../shared/update.ts'

// the AppImage this copy started from, when it's one Laki may replace
export function appImageOf(env: Record<string, string | undefined> = process.env, platform = process.platform): string | undefined {
  const f = env.APPIMAGE
  if (platform !== 'linux' || !f || !f.startsWith('/')) return
  try {
    if (!statSync(f).isFile()) return
    accessSync(f, constants.W_OK)
    accessSync(dirname(f), constants.W_OK)
    return f
  } catch {
    return
  }
}
const partOf = (f: string) => join(dirname(f), `.${basename(f)}.download`)
export const previousOf = (f: string) => `${f}.previous`
// the kept one's version (<keptFile>: written as it's swapped out), while its file is there
export function keptOf(f: string, keptFile: string): Kept | undefined {
  try {
    const k = JSON.parse(readFileSync(keptFile, 'utf8'))
    return typeof k?.version === 'string' && existsSync(previousOf(f)) ? k : undefined
  } catch {
    return undefined
  }
}
// why Go back can't (undefined: it can): only to an older version that's still there
export const backWhy = (version: string, k?: Kept) => (!k ? 'No earlier version is kept' : !newer(version, k.version) ? `Laki ${k.version} isn't older than this one` : undefined)

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>
async function get(fetch: Fetch, url: string, signal: AbortSignal) {
  const r = await fetch(url, { signal, headers: { 'user-agent': 'Laki' } })
  if (!r.ok) throw new Error(`the release answered ${r.status} for ${basename(new URL(url).pathname)}`)
  return r
}
// the release's AppImage for this architecture (base: its download folder's URL), beside f, checked; its path
export async function appImageGet(o: { f: string; base: string; version: string; arch: string; fetch: Fetch; progress?: (got: number, all: number) => void; ms?: number }): Promise<string> {
  const name = appImageName(o.version, o.arch)
  const signal = AbortSignal.timeout(o.ms ?? 30 * 60_000)
  const want = sumOf(await (await get(o.fetch, `${o.base}/SHA256SUMS.txt`, signal)).text(), name)
  if (!want) throw new Error(`the release's SHA256SUMS.txt has no ${name}`)
  const r = await get(o.fetch, `${o.base}/${name}`, signal)
  const all = Number(r.headers.get('content-length')) || 0
  const part = partOf(o.f)
  rmSync(part, { force: true })
  const fd = openSync(part, 'wx', 0o600)
  const hash = createHash('sha256')
  let got = 0
  try {
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      for (let off = 0; off < chunk.length; ) off += writeSync(fd, chunk, off)
      got += chunk.length
      o.progress?.(got, all)
    }
  } catch (e) {
    closeSync(fd)
    rmSync(part, { force: true })
    throw e
  }
  closeSync(fd)
  if (hash.digest('hex') !== want) {
    rmSync(part, { force: true })
    throw new Error(`${name} doesn't match the release's SHA256SUMS.txt: not installed`)
  }
  chmodSync(part, statSync(o.f).mode & 0o7777) // the running one's mode: executable as it was
  return part
}
// Restart to update: the checked download in under f's name, f kept as .previous with its version; the caller starts it
export function appImageSwap(f: string, part: string, version: string, keptFile: string) {
  if (!existsSync(part)) throw new Error('The download is gone: update again')
  renameSync(f, previousOf(f)) // one kept: the one before it goes
  try {
    renameSync(part, f)
  } catch (e) {
    renameSync(previousOf(f), f) // as it was
    throw e
  }
  writeFileSync(keptFile, JSON.stringify({ version, stateV: STATE_V } satisfies Kept)) // this copy's: the data it reads (backOf)
}
// Go back: the kept one in again, this one (version) kept instead; the caller starts it
export function appImageBack(f: string, version: string, keptFile: string) {
  const why = backWhy(version, keptOf(f, keptFile))
  if (why) return why
  const tmp = `${f}.swap`
  renameSync(f, tmp)
  renameSync(previousOf(f), f)
  renameSync(tmp, previousOf(f))
  writeFileSync(keptFile, JSON.stringify({ version, stateV: STATE_V } satisfies Kept))
  return undefined
}
