// laki screen's device ops (the CLI, MCP's laki_device): what isn't a web page, on this Mac. The iOS Simulator: a
// screenshot (xcrun simctl), and with idb on PATH (installed by the user, as cloudflared is) its hands: tap, swipe,
// type, and describe (its accessibility tree, each element's frame in points). Any app's window: a screenshot of its
// frontmost one by the app's name (CoreGraphics' window list through JXA, then screencapture -l), and windows, what's
// open. A screenshot goes to images/ (imageSave) and comes back as its path, as the agent browser's does.
// ponytail: the first booted simulator only (no --udid); an app's frontmost window only
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DEVICE_OPS, SIM_OPS } from '../shared/types.ts'
import { imageSave } from './core.ts'

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
// a simulator's screen in points: its own env, its pixels over its scale (idb's describe-all names no app on iOS 27's
// home screen, and needs idb)
async function simPoints(udid: string) {
  const [w, h, s] = await Promise.all(['WIDTH', 'HEIGHT', 'SCALE'].map(async k => Number((await simctl(['getenv', udid, `SIMULATOR_MAINSCREEN_${k}`])).stdout)))
  if (!(w > 0 && h > 0 && s > 0)) throw new Error("simctl didn't say the screen's size")
  return { width: w / s, height: h / s }
}
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
    // at the screen's size in points: taps go by the picture
    const s = await shot('xcrun', f => ['simctl', 'io', sim.udid, 'screenshot', f], e => `xcrun simctl: ${said(e)}`, () => simPoints(sim.udid))
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

// The side panel's Simulator (SidePanel.tsx' DeviceTab): a booted iOS Simulator's or an Android emulator's (or a phone
// on adb's) screen, a frame at a time, and taps, swipes, typing and buttons into it. iOS: simctl's screenshot and idb's
// hands (as above); Android: adb's screencap and input. A device is ios:<udid> or android:<serial>; a spot comes as a
// fraction of the picture, made points (iOS: simPoints, kept per device) or pixels (Android: the last
// frame's). On a Mac sips makes each frame a JPEG at most FRAME_MAX tall; elsewhere it goes as it came
// ponytail: a frame per call (the panel asks for the next as one comes, ~3 a second) and input at 0.3-0.6 s a call, a
// drag one swipe at its release; a stream (serve-sim, idb or axe video-stream, scrcpy's server) and live touches next
const FRAME_MAX = 1000
const SIM_ID = /^(ios|android):([\w.:-]{1,200})$/
const adb = (serial: string | null, args: string[]) =>
  run('adb', [...(serial ? ['-s', serial] : []), ...args], { timeout: 30000, encoding: 'buffer', maxBuffer: 64 << 20 }).catch(e =>
    Promise.reject(new Error((e as { code?: string }).code === 'ENOENT' ? "adb isn't on PATH: Android Studio's SDK platform-tools (or brew install android-platform-tools)" : `adb: ${said({ stderr: String((e as { stderr?: Buffer }).stderr ?? ''), message: (e as Error).message })}`)),
  )
const deviceOf = (id: unknown) => {
  const m = SIM_ID.exec(String(id ?? ''))
  if (!m) throw new Error('which device? ios:<udid> or android:<serial>, from sim list')
  return { os: m[1] as 'ios' | 'android', id: m[2], key: m[0] }
}
const iosPts = new Map<string, { width: number; height: number }>() // a simulator's screen in points
const droidPx = new Map<string, { width: number; height: number }>() // an Android screen's pixels, as its last frame
const pngSize = (b: Buffer) => (b.length > 24 && b.readUInt32BE(12) === 0x49484452 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : undefined)
const frac = (v: unknown, what: string) => {
  const n = Number(v)
  if (v === undefined || v === '' || !Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${what}: a fraction of the picture, 0 to 1`)
  return n
}
// adb shell's words go through the device's sh: the text single-quoted, its spaces input text's %s
// ponytail: a literal %s in the text arrives as a space (input text's own escape)
const droidText = (t: string) => `'${t.replace(/'/g, "'\\''").replace(/ /g, '%s')}'`
const DROID_KEYS: Record<string, string> = { home: 'KEYCODE_HOME', back: 'KEYCODE_BACK', apps: 'KEYCODE_APP_SWITCH', lock: 'KEYCODE_POWER', enter: 'KEYCODE_ENTER', delete: 'KEYCODE_DEL' }
const IOS_KEYS: Record<string, string[]> = { home: ['button', 'HOME'], lock: ['button', 'LOCK'], enter: ['key', '40'], delete: ['key', '42'] } // HID codes: Return, Backspace

export async function sim(p: { op: string; device?: string; x?: unknown; y?: unknown; x2?: unknown; y2?: unknown; text?: string; key?: string }) {
  const op = p.op as (typeof SIM_OPS)[number]
  if (!SIM_OPS.includes(op)) throw new Error(`sim: ${p.op}? one of ${SIM_OPS.join(', ')}`)
  if (op === 'list') {
    const devices: { id: string; name: string; os: 'ios' | 'android' }[] = []
    const why: string[] = [] // what keeps one kind from being listed
    if (process.platform === 'darwin')
      try {
        const r = await simctl(['list', 'devices', 'booted', '-j'])
        for (const d of Object.values(JSON.parse(r.stdout).devices as Record<string, { udid: string; name: string; state: string }[]>).flat()) if (d.state === 'Booted') devices.push({ id: `ios:${d.udid}`, name: d.name, os: 'ios' })
      } catch (e) {
        why.push(`iOS: xcrun simctl: ${said(e)} (it needs Xcode, xcode-select pointing at it, and its license accepted)`)
      }
    try {
      for (const l of String((await adb(null, ['devices', '-l'])).stdout).split('\n').slice(1)) {
        const m = /^(\S+)\s+device\b(.*)$/.exec(l.trim())
        if (m) devices.push({ id: `android:${m[1]}`, name: /model:(\S+)/.exec(m[2])?.[1]?.replace(/_/g, ' ') ?? m[1], os: 'android' })
      }
    } catch (e) {
      why.push(`Android: ${(e as Error).message}`)
    }
    return { devices, why }
  }
  const d = deviceOf(p.device)
  // a simulator's screen in points, kept: taps go by it, and a shot's picture
  const points = async () => {
    let pts = iosPts.get(d.key)
    if (!pts) iosPts.set(d.key, (pts = await simPoints(d.id)))
    return pts
  }
  if (op === 'shot' && d.os === 'ios') return { path: (await shot('xcrun', f => ['simctl', 'io', d.id, 'screenshot', f], e => `xcrun simctl: ${said(e)}`, points)).path } // in points, as laki screen's
  if (op === 'frame' || op === 'shot') {
    const tmp = mkdtempSync(join(tmpdir(), 'laki-sim-'))
    try {
      const raw = join(tmp, d.os === 'ios' ? 'raw.jpg' : 'raw.png')
      if (d.os === 'ios') await simctl(['io', d.id, 'screenshot', '--type=jpeg', raw]).catch(e => Promise.reject(new Error(`xcrun simctl: ${said(e)}`)))
      else {
        const png = (await adb(d.id, ['exec-out', 'screencap', '-p'])).stdout as Buffer
        const px = pngSize(png)
        if (!px) throw new Error("adb screencap gave no picture: is the screen on?")
        droidPx.set(d.key, px)
        writeFileSync(raw, png)
      }
      if (op === 'shot') return { path: imageSave({ data: readFileSync(raw).toString('base64'), ext: 'png' }) } // for an agent's prompt: as it came
      const out = join(tmp, 'frame.jpg')
      const small = process.platform === 'darwin' && (await run('sips', ['-Z', String(FRAME_MAX), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', raw, '--out', out], { timeout: 15000 }).then(() => true, () => false))
      const type = small || d.os === 'ios' ? 'jpeg' : 'png'
      return { frame: `data:image/${type};base64,${readFileSync(small ? out : raw).toString('base64')}` }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
  if (d.os === 'ios') {
    if (op === 'type') {
      if (p.text) await idb('text', d.id, p.text)
      return { ok: true }
    }
    if (op === 'key') {
      const k = IOS_KEYS[String(p.key)]
      if (!k) throw new Error(`key: on iOS, one of ${Object.keys(IOS_KEYS).join(', ')}`)
      await idb(k[0], d.id, k[1])
      return { ok: true }
    }
    const pts = await points()
    const at = (x: unknown, y: unknown) => [String(Math.round(frac(x, 'x') * pts.width)), String(Math.round(frac(y, 'y') * pts.height))]
    if (op === 'tap') await idb('tap', d.id, ...at(p.x, p.y))
    else await idb('swipe', d.id, ...at(p.x, p.y), ...at(p.x2, p.y2))
    return { ok: true }
  }
  if (op === 'type') {
    if (p.text) await adb(d.id, ['shell', 'input', 'text', droidText(p.text)])
    return { ok: true }
  }
  if (op === 'key') {
    const k = DROID_KEYS[String(p.key)]
    if (!k) throw new Error(`key: one of ${Object.keys(DROID_KEYS).join(', ')}`)
    await adb(d.id, ['shell', 'input', 'keyevent', k])
    return { ok: true }
  }
  const px = droidPx.get(d.key)
  if (!px) throw new Error('no frame of it yet: its size comes with one')
  const at = (x: unknown, y: unknown) => [String(Math.round(frac(x, 'x') * (px.width - 1))), String(Math.round(frac(y, 'y') * (px.height - 1)))]
  await adb(d.id, ['shell', 'input', ...(op === 'tap' ? ['tap', ...at(p.x, p.y)] : ['swipe', ...at(p.x, p.y), ...at(p.x2, p.y2), '300'])])
  return { ok: true }
}
