// laki screen's device ops (the CLI, MCP's laki_device): what isn't a web page, on this Mac. The iOS Simulator: a
// screenshot (xcrun simctl), and with idb on PATH (installed by the user, as cloudflared is) its hands: tap, swipe,
// type, and describe (its accessibility tree, each element's frame in points). Any app's window: a screenshot of its
// frontmost one by the app's name (CoreGraphics' window list through JXA, then screencapture -l), and windows, what's
// open. A screenshot goes to images/ (imageSave) and comes back as its path, as the agent browser's does.
// ponytail: the first booted simulator only (no --udid); an app's frontmost window only
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DEVICE_OPS } from '../shared/types.ts'
import { imageSave, onPath } from './core.ts'

const run = promisify(execFile)
const said = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split('\n').slice(-3).join(' ')

// the windows on screen, front to back, with their app: owners need no permission, titles need Screen Recording;
// rec: whether Laki has it (without it, screencapture -l gives the desktop, not the window)
const WINDOWS = `ObjC.import('CoreGraphics')
ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []])
const l = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0))
const out = []
for (let i = 0; i < l.count; i++) {
  const w = l.objectAtIndex(i)
  const v = k => { const x = w.objectForKey(k); return x.isNil() ? undefined : x.js }
  const b = w.objectForKey('kCGWindowBounds')
  if (v('kCGWindowLayer') === 0) out.push({ id: v('kCGWindowNumber'), app: v('kCGWindowOwnerName'), title: v('kCGWindowName') || '', width: b.objectForKey('Width').js, height: b.objectForKey('Height').js })
}
JSON.stringify({ rec: $.CGPreflightScreenCaptureAccess(), wins: out })`
export type Win = { id: number; app: string; title: string; width: number; height: number }
async function windows(): Promise<{ rec: boolean; wins: Win[] }> {
  if (process.platform !== 'darwin') throw new Error("an app's window: macOS only")
  return JSON.parse((await run('osascript', ['-l', 'JavaScript', '-e', WINDOWS], { timeout: 10000 })).stdout)
}

// a PNG a command writes, into images/: at its size in points when known (a Retina capture is 2 or 3 times that), so
// a spot in the picture is where to tap; else at most SHOT_MAX pixels across. sips failing keeps it as it came
const SHOT_MAX = 1400
async function shot(cmd: string, args: (file: string) => string[], fail: (e: unknown) => string, size?: () => Promise<{ width: number; height: number } | undefined>) {
  const tmp = mkdtempSync(join(tmpdir(), 'laki-shot-'))
  const file = join(tmp, 'shot.png')
  try {
    await run(cmd, args(file), { timeout: 30000 }).catch(e => Promise.reject(new Error(fail(e))))
    const pts = await size?.().catch(() => undefined)
    const ok = pts && pts.width > 0 && pts.height > 0
    await run('sips', ok ? ['-z', String(Math.round(pts.height)), String(Math.round(pts.width)), file] : ['-Z', String(SHOT_MAX), file], { timeout: 15000 }).catch(() => {})
    return { path: imageSave({ data: readFileSync(file).toString('base64'), ext: 'png' }), points: !!ok }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const simctl = (args: string[]) => run('xcrun', ['simctl', ...args], { timeout: 30000 })
async function booted(): Promise<{ udid: string; name: string }> {
  const r = await simctl(['list', 'devices', 'booted', '-j']).catch(e => Promise.reject(new Error(`xcrun simctl: ${said(e)} (Xcode, and xcode-select pointing at it)`)))
  const d = Object.values(JSON.parse(r.stdout).devices as Record<string, { udid: string; name: string; state: string }[]>).flat().find(x => x.state === 'Booted')
  if (!d) throw new Error('no iOS Simulator is booted: open Simulator, or xcrun simctl boot <device>')
  return d
}
const num = (v: unknown, what: string) => {
  const n = Number(v)
  if (v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`${what}: a number (points)`)
  return String(Math.round(n)) // whole points: idb's swipe takes no fractions
}
// idb ui <what> on that simulator; what's given after --, so text that starts with - is text
async function idb(what: string, udid: string, ...args: string[]) {
  try {
    return (await run('idb', ['ui', what, '--udid', udid, ...(what === 'describe-all' ? ['--json'] : ['--', ...args])], { timeout: 30000 })).stdout
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') throw new Error("tap, swipe, type and describe need idb: brew install facebook/fb/idb-companion, then pipx install fb-idb (Settings › Agent skill says if it's found)")
    throw new Error(`idb: ${said(e)}`)
  }
}

export async function device(p: { op: string; app?: string; x?: unknown; y?: unknown; x2?: unknown; y2?: unknown; text?: string }) {
  const op = p.op as (typeof DEVICE_OPS)[number]
  if (!DEVICE_OPS.includes(op)) throw new Error(`screen: ${p.op}? one of ${DEVICE_OPS.join(', ')}`)
  const app = p.app?.trim()
  if (op === 'windows') return (await windows()).wins.map(({ id, app, title, width, height }) => ({ id, app, title, width, height }))
  if (op === 'shot' && app) {
    const { rec, wins: all } = await windows()
    if (!rec) throw new Error("Laki can't see other apps' windows: System Settings › Privacy & Security › Screen & System Audio Recording, turn Laki on, then quit and open Laki again")
    const w = all.find(x => x.app.toLowerCase() === app.toLowerCase()) ?? all.find(x => x.app.toLowerCase().includes(app.toLowerCase()) || x.title.toLowerCase().includes(app.toLowerCase()))
    if (!w) throw new Error(`no window of ${app} on screen (laki screen windows lists them)`)
    const s = await shot('screencapture', f => ['-x', '-o', '-l', String(w.id), f], e => `screencapture: ${said(e)}. Laki needs Screen Recording: System Settings › Privacy & Security`, async () => w)
    return { path: s.path, app: w.app, title: w.title, width: w.width, height: w.height }
  }
  const sim = await booted()
  if (op === 'shot') {
    // with idb, the screen's size in points (its accessibility tree's first element, the app): taps go by the picture
    const size = onPath('idb') ? async () => (JSON.parse(await idb('describe-all', sim.udid)) as { frame?: { width: number; height: number } }[])[0]?.frame : undefined
    const s = await shot('xcrun', f => ['simctl', 'io', sim.udid, 'screenshot', f], e => `xcrun simctl: ${said(e)}`, size)
    return { path: s.path, simulator: sim.name, ...(s.points && { note: "the picture's pixels are points: tap where you see it" }) }
  }
  if (op === 'tap') await idb('tap', sim.udid, num(p.x, 'x'), num(p.y, 'y'))
  else if (op === 'swipe') await idb('swipe', sim.udid, num(p.x, 'x'), num(p.y, 'y'), num(p.x2, 'x2'), num(p.y2, 'y2'))
  else if (op === 'type') {
    if (!p.text) throw new Error('type: what text?')
    await idb('text', sim.udid, p.text)
  } else {
    const out = await idb('describe-all', sim.udid)
    try {
      return JSON.parse(out)
    } catch {
      return out // an idb that prints something else
    }
  }
  return { ok: true, simulator: sim.name }
}
