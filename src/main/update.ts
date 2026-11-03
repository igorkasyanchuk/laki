// The app's updates (Settings › General › Updates, the app menu's Check for Updates…): the releases repo's newest
// release, at launch and every 4 hours while Settings says so, or when asked. Nothing downloads until you click: on a
// Developer ID signed Mac through Electron's autoUpdater (Squirrel.Mac, the release's update-mac-<arch>.json), then
// Restart to update; anywhere else Download is the release's page. The daemon outlives it: its yellow bar, as before.
// ponytail: no Linux self-update (an AppImage updater is a new dependency), no beta channel
import { app, autoUpdater, net } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { feedName, heldUntil, newer, RELEASES, type Release, releaseOf, UPDATE_EVERY, type UpdateState } from '../shared/update.ts'

// update.json: `told`, the last version the app was told about (one toast each); `skip`, the one Skip the delay once let in
const toldFile = () => join(app.getPath('userData'), 'update.json')
const kept = (): { told?: string; skip?: string } => {
  try {
    return JSON.parse(readFileSync(toldFile(), 'utf8'))
  } catch {
    return {}
  }
}
const keep = (o: { told?: string; skip?: string }) => {
  try {
    writeFileSync(toldFile(), JSON.stringify({ ...kept(), ...o }))
  } catch {} // unwritable: it may be told again, the check still answered
}
// Squirrel.Mac replaces only a signed app: a Developer ID one (an ad-hoc build, a dev run: Download instead)
const bundle = () => join(app.getPath('exe'), '..', '..', '..') // Laki.app/Contents/MacOS/Laki
const signed = (): Promise<boolean> =>
  !app.isPackaged || process.platform !== 'darwin'
    ? Promise.resolve(false)
    : new Promise(r => execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle()], (_e, _out, err) => r(/Authority=Developer ID Application:/.test(String(err)))))

export function updater(send: (s: UpdateState) => void) {
  let s: UpdateState = { version: app.getVersion(), status: 'idle', install: false }
  const set = (next: Partial<UpdateState>) => send((s = { ...s, found: undefined, ...next }))
  const known = signed().then(install => void (s.install = install))
  let soon: ReturnType<typeof setTimeout> | undefined // the launch's check
  let every: ReturnType<typeof setInterval> | undefined
  let autoOn: boolean | undefined
  let launched = false
  let wired = false
  let delay = 0 // Settings' Update delay, days
  let fetched: Release | null | undefined // the last check's newest release (null: none published; undefined: no check yet)

  // auto: a scheduled check, the only kind that announces a version, and only one no check saw before (update.json)
  async function check(auto = false) {
    if (s.status === 'checking' || s.status === 'downloading' || s.status === 'ready') return s
    set({ status: 'checking', error: undefined }) // before any await: a second check meanwhile returns this one's state
    await known
    try {
      const r = await net.fetch(`https://api.github.com/repos/${RELEASES}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) })
      if (!r.ok && r.status !== 404) throw new Error(`GitHub answered ${r.status}`)
      fetched = r.ok ? releaseOf(await r.json(), process.arch) : null // 404: no release published yet
      s.checked = Date.now()
      judge(auto)
    } catch (e) {
      set({ status: 'error', error: `Couldn't check: ${(e as Error).message}` })
    }
    return s
  }

  // the last check's release against this version and the delay: offered, held until it's old enough, or none
  function judge(auto: boolean) {
    const latest = fetched
    if (!latest || !newer(latest.version, s.version)) return set({ status: 'none', latest: undefined, held: undefined })
    const until = kept().skip === latest.version ? undefined : heldUntil(latest.at, delay)
    if (until) return set({ status: 'none', latest: undefined, held: { version: latest.version, until } }) // not told yet: its toast comes when it's offered
    const fresh = kept().told !== latest.version // seen by any check: no toast for it later
    if (fresh) keep({ told: latest.version })
    set({ status: 'available', latest, found: auto && fresh, held: undefined })
  }

  // Settings' Skip the delay once: the held release is offered now (kept by its version, so a restart remembers it)
  function skip() {
    if (!s.held) return s
    keep({ skip: s.held.version })
    judge(false)
    return s
  }

  // only a signed Mac with the release's feed; the renderer opens the release's page otherwise
  function download() {
    if (s.status !== 'available' && s.status !== 'error') return s
    if (!s.latest || !s.install || !s.latest.feed) return s
    if (!wired) {
      wired = true
      autoUpdater.on('update-downloaded', () => set({ status: 'ready' }))
      autoUpdater.on('update-not-available', () => set({ status: 'error', error: `The release has no update for this Mac` }))
      autoUpdater.on('error', e => set({ status: 'error', error: `The download failed: ${e.message}` }))
    }
    try {
      autoUpdater.setFeedURL({ url: `https://github.com/${RELEASES}/releases/download/v${s.latest.version}/${feedName(process.arch)}`, serverType: 'json' })
      set({ status: 'downloading', error: undefined })
      autoUpdater.checkForUpdates() // Squirrel downloads what the feed names, then update-downloaded
    } catch (e) {
      set({ status: 'error', error: `The download failed: ${(e as Error).message}` }) // Squirrel refused it at once
    }
    return s
  }

  // the app quits (its windows close for good: main's before-quit-for-update) and opens again as the new version
  function install() {
    if (s.status !== 'ready') return s
    autoUpdater.quitAndInstall()
    return s
  }

  // Settings' Check for updates: at launch (once, a little after), then every UPDATE_EVERY; off stops both. The
  // same again (a window's reload) keeps the timer. `days`: Settings' Update delay
  function auto(on: boolean, days = 0) {
    if (days !== delay) {
      delay = days // a new delay judges the last check's release again, nothing fetched
      if (fetched !== undefined && (s.status === 'none' || s.status === 'available')) judge(false)
    }
    if (on === autoOn) return
    autoOn = on
    clearTimeout(soon)
    clearInterval(every)
    if (!on) return
    if (!launched) soon = setTimeout(() => ((launched = true), void check(true)), 10_000)
    every = setInterval(() => void check(true), UPDATE_EVERY)
  }

  return { state: () => s, check, download, install, skip, auto }
}
