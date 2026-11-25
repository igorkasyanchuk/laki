// the menus: a native popup for the renderer's (menu-popup, Settings › Layout's Menus: macOS), the menu bar's item
// (its icon by state, its menu, drops on it, Quiet, the badge that feeds it and the Inbox, Hand off), the Dock's icon,
// count, progress, menu and recent folders, and the app menu with Settings › Keys' keys (appMenu, keys); each IPC
// handler checks its sender. index.ts calls appMenu() once everything is defined
import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, powerMonitor, screen, Tray } from 'electron'
import { barInbox, inboxHide, inboxOpen, inboxSet } from './cards.ts'
import { type DockAgent, dockAgents, dockMenu, handoffUrl, menuModelOk, type NativeItem, recentOk } from './guards.ts'
import { hhmm, quietChoices, TRAY_PX, TRAY_STATES, trayBitmap, type TrayInfo, type TrayState, trayTip, trayTitle } from '../shared/tray.ts'
import { join } from 'node:path'
import { type KeyId, keyMap } from '../shared/keys.ts'
import { protectFloats } from './floater.ts'
import { rpc } from '../shared/conn.ts'
import { screenItems, screenshot } from './shots.ts'
import { writeFileSync } from 'node:fs'
import { COMBO, accel, from, keys, mac, openLink, quickWin, quitCompletely, shotAsk, shotOn, show, tellShot, trayDrops, updates, win } from './index.ts'

// Settings › Layout's Menus: macOS: a workspace's or a tab's menu drawn by macOS (the renderer's menuModel, checked by
// guards.ts menuModelOk), popped up at the point; the picked item's id back, or nothing (closed). The app window only
ipcMain.handle('menu-popup', (e, model: unknown, x: unknown, y: unknown) => {
  if (!from(e, 'panel')) return undefined
  const m = menuModelOk(model)
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!m || !w || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return new Promise<string | undefined>(done => {
    let picked: string | undefined
    const build = (items: NativeItem[]): MenuItemConstructorOptions[] =>
      items.map(it =>
        it.separator
          ? { type: 'separator' }
          : { label: it.label, sublabel: it.sublabel, enabled: it.enabled !== false, ...(it.sub ? { submenu: build(it.sub) } : { type: it.checked ? 'checkbox' : 'normal', checked: !!it.checked, click: () => ((picked = it.id), done(picked)) }) },
      )
    Menu.buildFromTemplate(build(m)).popup({ window: w, x: Math.round(x), y: Math.round(y), callback: () => setTimeout(() => done(picked), 50) }) // a click comes before or after the close: whichever is first answers
  })
})

// Settings' Dock icon: the window's renderer draws it (a PNG data URL), kept in userData so the next start (an
// update too) shows it at once, before the window loads. ponytail: the bundle's own still shows in Finder and in a
// pinned Dock tile while Laki isn't running (changing the bundle would break its signature)
const dockFile = () => join(app.getPath('userData'), 'dock-icon.png')
app.whenReady().then(() => {
  const img = nativeImage.createFromPath(dockFile()) // empty when there's none
  if (!img.isEmpty()) app.dock?.setIcon(img)
})
ipcMain.on('dock-icon', (e, png: unknown) => {
  if (e.sender !== win?.webContents || typeof png !== 'string' || !png.startsWith('data:image/png;base64,') || png.length > 8e6) return
  const img = nativeImage.createFromDataURL(png)
  if (img.isEmpty()) return
  app.dock?.setIcon(img)
  try {
    writeFileSync(dockFile(), img.toPNG())
  } catch {}
})
// the Dock icon's count: agents waiting for you or done while you looked away (none: no badge); and the menu bar's
// item, from the same message so the two never disagree: the count, a menu of those tabs (a click shows one, as a
// notification's does), Open (with the global hotkey) and Quit. tray false: Settings › General › Menu bar hid it
export let tray: Tray | null = null
let trayTabs: MenuItemConstructorOptions[] = [] // the last badge's, for a menu made again as screens come and go
let barWas = -1 // U15: the Dock's progress bar as last set
export let recording = false // the last badge's: Recording mode is on (settings.recording), its item ticked
export let trayNow: TrayState | undefined // the last badge's state (its picture), for a drop's highlight and back
let quietUntil = 0 // U8: the last badge's: quiet until (ms), its picture slashed, End Quiet in the menu
export const quietOn = () => quietUntil > Date.now()
const quietSet = (o: object) => void rpc('dndSet', o).catch(() => {})
let trayBuilt: Menu | null = null // the menu: the tray's own (a click), or a right click's with Inbox
export function trayMenu() {
  trayBuilt = Menu.buildFromTemplate([

      ...trayTabs,
      ...(trayTabs.length ? [{ type: 'separator' as const }] : []),
      { label: 'New Task…', click: () => quickWin() }, // the quick bar (Q1), over the app you're in
      { label: 'Recording Mode', type: 'checkbox', checked: recording, click: () => void rpc('settingsSet', { recording: !recording }).catch(() => {}) }, // private workspaces hidden
      // U8: Quiet (the daemon's dndSet, as the app): no notifications, sounds, cards or pushes but asks and laki alert's
      quietOn() ? { label: `End Quiet (until ${hhmm(quietUntil)})`, click: () => quietSet({ off: true }) } : { label: 'Quiet', submenu: quietChoices().map((c, i) => ({ label: c.label.replace(/\b[a-z]/g, ch => ch.toUpperCase()), click: () => quietSet(quietChoices()[i].o) /* as it's clicked: a menu built at 8:50 and clicked at 9:05 means tomorrow's 9:00 */ })) },
      { label: 'Screenshot Area…', click: () => screenshot(true) }, // to the new-workspace page, for an agent
      { label: 'Screenshot Screen', ...(screen.getAllDisplays().length > 1 ? { submenu: screenItems() } : { click: () => screenshot(false) }) },
      { label: 'Show and Tell…', ...(keys.tell && { accelerator: keys.tell, registerAccelerator: false }), click: () => tellShot() }, // Q7: a part of the screen, then say what to do with it
      ...(shotOn ? [{ label: 'Screenshot to Laki AI…', ...(keys.shot && { accelerator: keys.shot, registerAccelerator: false }), click: shotAsk }] : []),
      { type: 'separator' },
      { label: `Open ${app.name}`, ...(keys.open && { accelerator: keys.open, registerAccelerator: false }), click: () => show() }, // its global hotkey beside it
      { label: 'Quit', click: () => app.quit() },
    ])
  tray?.setContextMenu(barInbox ? null : trayBuilt)
}
// Handoff (macOS, Settings › Remote access › Offer on my nearby devices, off unless on): the remote page's lasting
// address (guards.ts handoffUrl, from the window's view) offered to your nearby Apple devices while Laki is in front;
// dropped as remote access stops or moves, in Recording mode, or with Laki in the background
let handoffWant: string | undefined // what the window says remote access runs at
let handoffSet: string | undefined // what's offered now
function handoffNow() {
  if (!mac) return
  const url = handoffWant && !recording && BrowserWindow.getFocusedWindow() ? handoffWant : undefined
  if (url === handoffSet) return
  handoffSet = url
  if (url) app.setUserActivity('NSUserActivityTypeBrowsingWeb', {}, url)
  else app.invalidateCurrentActivity()
}
ipcMain.on('handoff', (e, r: unknown) => {
  if (!from(e)) return
  handoffWant = handoffUrl(r)
  handoffNow()
})
app.on('browser-window-focus', () => handoffNow())
app.on('browser-window-blur', () => setImmediate(handoffNow)) // another of Laki's windows may take the focus
// D9: remote access that follows the Mac's lock (Settings › Remote access › Start it): the lock and the unlock to the
// daemon, as the app (its token); laki serve has no app, so none
app.whenReady().then(() => {
  powerMonitor.on('lock-screen', () => void rpc('screenLock', { locked: true }).catch(() => {}))
  powerMonitor.on('unlock-screen', () => void rpc('screenLock', { locked: false }).catch(() => {}))
})
app.whenReady().then(() => (screen.on('display-added', trayMenu), screen.on('display-removed', trayMenu), screen.on('display-metrics-changed', trayMenu))) // its sizes
// st (Q8, Settings › General › Menu bar's Show state): the state its picture shows (stateOf's), its title's ! and its
// tooltip's words; none (off, or an older page): the filled mark and the count, as before
ipcMain.on('badge', (e, n: number, items: { tab: string; label: string }[] = [], on = true, rec: unknown = false, st?: Partial<TrayInfo>, progress?: unknown, inbox?: unknown) => {
  if (!from(e)) return
  inboxSet(inbox)
  recording = rec === true
  handoffNow() // Recording mode on: offered nowhere
  protectFloats()
  const count = Number.isInteger(n) && n > 0 ? String(n) : ''
  app.dock?.setBadge(count)
  // U15: a Ship at work or a workflow run going (shared/tray.ts dockProgress): -1 none, 2 unknown, else 0 to 1
  const p = typeof progress === 'number' && Number.isFinite(progress) && (progress === 2 || (progress >= -1 && progress <= 1)) ? progress : -1
  if (p !== barWas) win?.setProgressBar((barWas = p) < 0 ? -1 : p, p === 2 ? { mode: 'indeterminate' } : undefined)
  if (!on) return void (tray?.destroy(), (tray = null), inboxHide())
  const num = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0)
  quietUntil = num(st?.quiet) // sent with Show state off too (no state then)
  const info = st && TRAY_STATES.includes(st.state as TrayState) ? { state: st.state as TrayState, needs: num(n), working: num(st.working), blocked: num(st.blocked), quiet: quietUntil } : undefined
  trayNow = info?.state
  if (!tray) {
    tray = new Tray(trayIcon(info?.state))
    tray.on('click', () => barInbox && inboxOpen())
    tray.on('right-click', () => barInbox && trayBuilt && tray?.popUpContextMenu(trayBuilt))
    if (mac) trayDrops(tray)
  }
  tray.setImage(trayIcon(info?.state, quietOn())) // a state change swaps the picture (the same one: its cached image, nothing redrawn)
  tray.setTitle(info ? trayTitle(info) : count, { fontType: 'monospacedDigit' })
  tray.setToolTip(info ? trayTip(info, app.name) : trayTip({ needs: num(n), working: 0, blocked: 0, quiet: quietUntil }, app.name))
  trayTabs = (Array.isArray(items) ? items : []).slice(0, 30).map(i => ({ label: String(i.label).slice(0, 90), click: () => show(String(i.tab)) }))
  trayMenu()
  dockSet() // Quiet's state comes with it
})
// the Dock's menu (macOS): New Task… (the quick bar, as the menu bar's), up to five agents waiting (the window's list, a
// click shows that tab), Quiet for an Hour or End Quiet (the menu bar's dndSet); built again as either changes
let dockList: DockAgent[] = []
let dockWas = ''
const dockClick = (id: string) => (id === 'new' ? quickWin() : id === 'quiet' ? quietSet({ minutes: 60 }) : id === 'quiet-off' ? quietSet({ off: true }) : id.startsWith('tab:') && show(id.slice(4)))
function dockSet() {
  if (!mac || !app.dock) return
  const items = dockMenu(dockList, quietOn())
  const k = JSON.stringify(items)
  if (k === dockWas) return
  dockWas = k
  app.dock.setMenu(Menu.buildFromTemplate(items.map(i => ('type' in i ? i : { label: i.label, click: () => dockClick(i.id) }))))
}
ipcMain.on('dock-menu', (e, list: unknown) => {
  if (!from(e)) return
  dockList = dockAgents(list)
  dockSet()
})
// the Dock's recent items: the projects you open, this Mac's folders (opened again: open-file, below)
let recentWas = ''
ipcMain.on('recent', (e, path: unknown) => {
  if (!from(e) || !mac || !recentOk(path) || path === recentWas) return
  recentWas = path
  app.addRecentDocument(path)
})

// the menu bar's icon: Laki's mark (a chevron and a dot) as a 32×32 template image (@2x), one per state (Q8: shared/
// tray.ts' trayBitmap: idle, working, waiting, blocked), made once each: macOS colors it for a light or dark menu bar
// and the highlight from its alpha alone
const trayIcons = new Map<string, Electron.NativeImage>()
export function trayIcon(state: TrayState = 'waiting', quiet = false, drop = false) {
  const key = `${state}${quiet ? ' quiet' : ''}${drop ? ' drop' : ''}`
  let img = trayIcons.get(key)
  if (!img) {
    img = nativeImage.createFromBitmap(trayBitmap(state, { quiet, drop }), { width: TRAY_PX, height: TRAY_PX, scaleFactor: 2 })
    img.setTemplateImage(true)
    trayIcons.set(key, img)
  }
  return img
}

// the renderer owns ⌘W/⌘N/⌘T/⌘K…: the menu shows each key without registering it (the key still goes to App's
// keys), and a click sends it there as browser-key, as a Browsers page does: a fixed one's key, or one of Settings ›
// Keys' by its id (bound: its keys in keysNow, from the app window's keys IPC, which builds the menu again)
// ponytail: Toggle Sidebar has one title; Show/Hide by its state would need the renderer to rebuild the menu
export let keysNow = keyMap()
const key = (label: string, accelerator: string, k: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  registerAccelerator: false,
  click: () => (show(), win?.webContents.send('browser-key', k)),
})
const bound = (label: string, id: KeyId): MenuItemConstructorOptions => ({
  label,
  accelerator: (m => (m ? accel(m, 'CmdOrCtrl') : undefined))(COMBO.exec(keysNow[id])), // none: '' (no keys)
  registerAccelerator: false,
  click: () => (show(), win?.webContents.send('browser-key', id)),
})
ipcMain.on('keys', (e, over: unknown) => from(e) && ((keysNow = keyMap(over)), appMenu()))
export const appMenu = () => Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => openLink('laki://about') }, // the renderer's: with the website
        { label: 'Check for Updates…', click: () => (openLink('laki://settings/general?spot=Updates'), void updates.check()) },
        { type: 'separator' },
        bound('Settings…', 'settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
        { label: `Quit ${app.name} Completely`, click: quitCompletely },
      ],
    },
    {
      label: 'File',
      submenu: [
        bound('New Workspace…', 'newWs'),
        bound('New Tab', 'newTab'),
        key('Open Project Folder…', 'CmdOrCtrl+O', 'o'),
        { type: 'separator' },
        bound('Go to File…', 'files'),
        key('Open in Editor', 'CmdOrCtrl+E', 'e'),
        { type: 'separator' },
        bound('Close Tab', 'closeTab'),
        bound('Reopen Closed Tab', 'reopenTab'),
        { type: 'separator' },
        bound('Stop All Agents…', 'stopAll'),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle', accelerator: 'Shift+CommandOrControl+V' }, // #10: a long paste as text in a prompt box, not a file
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        bound('Find…', 'find'),
        bound('Search Chats…', 'chatSearch'),
      ],
    },
    {
      label: 'View',
      submenu: [
        bound('Toggle Sidebar', 'sidebar'),
        bound('Filter the Sidebar', 'filter'),
        bound('Workspace Info', 'info'),
        key('Changes', 'CmdOrCtrl+D', 'd'),
        { type: 'separator' },
        bound('Command Palette…', 'palette'),
        { label: 'Customize Toolbar…', click: () => openLink('laki://toolbar') },
        { type: 'separator' },
        key('Bigger Text in This Tab', 'CmdOrCtrl+Plus', '='),
        key('Smaller Text in This Tab', 'CmdOrCtrl+-', '-'),
        key('Default Text Size in This Tab', 'CmdOrCtrl+0', '0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        bound('Next That Needs You', 'next'),
        key('Previous Workspace', 'CmdOrCtrl+Up', 'ArrowUp'),
        key('Next Workspace', 'CmdOrCtrl+Down', 'ArrowDown'),
        { type: 'separator' },
        { label: 'Board', click: () => openLink('laki://board') },
        { label: 'Scheduled Tasks', click: () => openLink('laki://schedules') },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    {
      role: 'help',
      submenu: [
        bound(`${app.name} Help`, 'help'),
        { label: 'Get Started Again…', click: () => openLink('laki://onboard') }, // the first steps, after Don't show again too
      ],
    },
  ]),
)
