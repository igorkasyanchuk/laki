// #G1: Go back (Settings › General › Updates): the version before an update, kept by keepNow as its download finishes
// (ditto to userData/previous/Laki.app; one only, under 1 GB free none) and installing waits for it a few seconds at
// most (keepWait: a copy not done by then is stopped, none kept). goBack checks it (shared/update.ts backRefused:
// its Info.plist's version, codesign --verify --deep --strict, the same Developer ID's Team ID as this copy), swaps it
// in for this bundle and relaunches; the version it leaves is skipped (update.json's pass: Offer it again undoes it).
// The packaged Mac app only. Checked by hand on a packaged app (scripts/pack-smoke.sh's build, docs/release.md)
import { app } from 'electron'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { backRefused, type Kept, keepWhy, STATE_V } from '../shared/update.ts'

const mac = process.platform === 'darwin'
const bundle = () => join(app.getPath('exe'), '..', '..', '..') // Laki.app/Contents/MacOS/Laki
const folder = () => join(app.getPath('userData'), 'previous')
const keptApp = () => join(folder(), 'Laki.app')
const keptFile = () => join(folder(), 'previous.json')
const sh = (cmd: string, args: string[]) => new Promise<{ ok: boolean; err: string }>(r => execFile(cmd, args, { timeout: 120_000 }, (e, _o, err) => r({ ok: !e, err: String(err) })))
export const kept = (): Kept | undefined => {
  try {
    const k = JSON.parse(readFileSync(keptFile(), 'utf8'))
    return typeof k?.version === 'string' ? k : undefined
  } catch {
    return undefined
  }
}
const plistOf = (p: string) => {
  try {
    return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(readFileSync(join(p, 'Contents', 'Info.plist'), 'utf8'))?.[1]
  } catch {
    return undefined
  }
}
// a Developer ID signature's Team ID (none: ad-hoc, unsigned)
const teamOf = async (p: string) => (r => (/Authority=Developer ID Application:/.test(r.err) ? /TeamIdentifier=(\w+)/.exec(r.err)?.[1] : undefined))(await sh('/usr/bin/codesign', ['-dv', '--verbose=2', p]))
// why the copy at p may not replace this one (undefined: it may)
export async function refused(p = keptApp(), k = kept()): Promise<string | undefined> {
  const base = { mac, packaged: app.isPackaged, version: app.getVersion(), kept: k, plist: plistOf(p) }
  const early = backRefused({ ...base, verified: true, team: '-', ownTeam: '-' }) // the cheap ones, before codesign
  if (early) return early
  const [v, team, ownTeam] = await Promise.all([sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', p]), teamOf(p), teamOf(bundle())])
  return backRefused({ ...base, verified: v.ok, team, ownTeam })
}

let copying: Promise<void> | undefined
let child: ChildProcess | undefined
export function keepNow(): Promise<void> {
  if (copying) return copying
  let free = 0
  try {
    const s = statfsSync(app.getPath('userData'))
    free = s.bavail * s.bsize
  } catch {}
  const why = keepWhy({ mac, packaged: app.isPackaged, free })
  if (why) return Promise.resolve()
  const next = join(folder(), 'next')
  copying = new Promise<void>(ok => {
    try {
      rmSync(next, { recursive: true, force: true })
      mkdirSync(next, { recursive: true })
    } catch {
      return ok()
    }
    child = execFile('/usr/bin/ditto', [bundle(), join(next, 'Laki.app')], e => {
      child = undefined
      try {
        if (e) throw e
        rmSync(keptFile(), { force: true }) // the record first: a half swap is never taken for the version it names
        rmSync(keptApp(), { recursive: true, force: true })
        renameSync(join(next, 'Laki.app'), keptApp())
        writeFileSync(keptFile(), JSON.stringify({ version: app.getVersion(), stateV: STATE_V } satisfies Kept))
      } catch {}
      rmSync(next, { recursive: true, force: true })
      ok()
    })
  })
  return copying
}
// installing: the copy's end, ms at most; one still going is stopped (its half copy removed)
export async function keepWait(ms = 5000) {
  if (!copying) return
  await Promise.race([copying, new Promise(r => setTimeout(r, ms))])
  child?.kill()
  await copying
}

// the swap: the kept copy beside this bundle (moved: the same disk; else copied), checked there, then in this one's
// place; this one removed once the new app is starting. Refused or failed: everything as it was
export async function goBack(skip: (version: string) => void): Promise<string | undefined> {
  const k = kept()
  const b = bundle()
  const back = `${b}.back`
  const gone = `${b}.gone`
  const first = await refused(keptApp(), k) // before anything moves
  if (first) return first
  let copied = false // another disk: a copy beside it, the kept one left where it was
  try {
    rmSync(back, { recursive: true, force: true })
    rmSync(gone, { recursive: true, force: true })
    try {
      renameSync(keptApp(), back)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
      if (!(await sh('/usr/bin/ditto', [keptApp(), back])).ok) throw (rmSync(back, { recursive: true, force: true }), new Error("couldn't copy it beside this one"))
      copied = true
    }
  } catch (e) {
    return `Couldn't go back: ${(e as Error).message}`
  }
  const put = () => (copied ? rmSync(back, { recursive: true, force: true }) : existsSync(back) && !existsSync(keptApp()) && renameSync(back, keptApp())) // as it was
  const again = await refused(back, k) // where it runs from: nothing swapped it meanwhile
  if (again) return (put(), again)
  try {
    renameSync(b, gone)
    renameSync(back, b)
  } catch (e) {
    if (!existsSync(b) && existsSync(gone)) renameSync(gone, b)
    put()
    return `Couldn't go back: ${(e as Error).message}`
  }
  rmSync(keptFile(), { force: true })
  if (copied) rmSync(keptApp(), { recursive: true, force: true }) // in use now: no copy of it kept
  skip(app.getVersion())
  spawn('/bin/sh', ['-c', 'sleep 10; rm -rf "$0"', gone], { detached: true, stdio: 'ignore' }).unref() // once this app (and its helpers, still running from it) are gone
  app.relaunch()
  app.exit(0)
  return undefined
}
