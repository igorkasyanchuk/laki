// The app's updates (Settings › General › Updates, the app menu's Check for Updates…): the releases repo's newest
// release, at launch and every 4 hours while Settings says so, or when asked. Nothing downloads until you click: on a
// Developer ID signed Mac through Electron's autoUpdater (Squirrel.Mac, the release's update-mac-<arch>.json), then
// Restart to update; anywhere else Download is the release's page. The daemon outlives it: its yellow bar, as before.
// ponytail: no Linux self-update (an AppImage updater is a new dependency), no beta channel
import { app, autoUpdater, net } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { feedName, newer, RELEASES, releaseOf, UPDATE_EVERY, type UpdateState } from '../shared/update.ts'

const toldFile = () => join(app.getPath('userData'), 'update.json') // the last version the app was told about: one toast each
const told = () => {
  try {
    return String(JSON.parse(readFileSync(toldFile(), 'utf8')).told ?? '')
  } catch {
    return ''
  }
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

  // auto: a scheduled check, the only kind that announces a version, and only one no check saw before (update.json)
  async function check(auto = false) {
    if (s.status === 'checking' || s.status === 'downloading' || s.status === 'ready') return s
    set({ status: 'checking', error: undefined }) // before any await: a second check meanwhile returns this one's state
    await known
    try {
      const r = await net.fetch(`https://api.github.com/repos/${RELEASES}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) })
      if (!r.ok && r.status !== 404) throw new Error(`GitHub answered ${r.status}`)
      const latest = r.ok ? releaseOf(await r.json(), process.arch) : null // 404: no release published yet
      if (!latest || !newer(latest.version, s.version)) {
        set({ status: 'none', checked: Date.now(), latest: undefined })
        return s
      }
      const fresh = told() !== latest.version // seen by any check: no toast for it later
      if (fresh) {
        try {
          writeFileSync(toldFile(), JSON.stringify({ told: latest.version }))
        } catch {} // unwritable: it may be told again, the check still answered
      }
      const found = auto && fresh
      set({ status: 'available', checked: Date.now(), latest, found })
    } catch (e) {
      set({ status: 'error', error: `Couldn't check: ${(e as Error).message}` })
    }
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
  // same again (a window's reload) keeps the timer
  function auto(on: boolean) {
    if (on === autoOn) return
    autoOn = on
    clearTimeout(soon)
    clearInterval(every)
    if (!on) return
    if (!launched) soon = setTimeout(() => ((launched = true), void check(true)), 10_000)
    every = setInterval(() => void check(true), UPDATE_EVERY)
  }

  return { state: () => s, check, download, install, auto }
}
