// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links, laki:// links,
// the preview pane's webview (localhost only) and its screenshots.
import { app, BrowserWindow, type BrowserWindowConstructorOptions, clipboard, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, Notification, screen, session, shell, Tray, webContents } from 'electron'
import { execFile } from 'node:child_process'
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDaemon, rpc } from '../shared/conn.ts'
import type { View } from '../shared/types.ts'

const dev = !!process.env.ELECTRON_RENDERER_URL
let win: BrowserWindow | null = null
let pendingTab: string | null = null
let quitting = false
let link: string | null = null // a laki:// link that came before the renderer listened
let linkReady = false // the renderer listens for links
let shot: [string, string] | null = null // a screenshot (a PNG, base64, and its note) from the menu bar, before the renderer listened
let shotReady = false // the renderer listens for screenshots

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => show())
// laki://… (Info.plist names the scheme): the renderer routes it; it only selects and opens pages, never creates
const openLink = (url: string) => {
  if (linkReady && win) win.webContents.send('deep-link', url)
  else link = url
  if (app.isReady()) show()
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (url.startsWith('laki:')) openLink(url)
})
ipcMain.on('shot-ready', () => {
  shotReady = true
  if (shot) win?.webContents.send('shot', ...shot)
  shot = null
})
ipcMain.on('deep-link-ready', () => {
  linkReady = true
  if (link) win?.webContents.send('deep-link', link)
  link = null
})
// the preview pane's <webview>: it starts on this Mac's localhost and can go to any website (the address bar, links),
// in its own session, without node or a preload (and, with no allowpopups, without popups)
const PREVIEW = 'persist:preview'
const BROWSER = 'persist:browser' // the sidebar's Browsers: any site, its sign-ins kept between runs
const local = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true })
    if (params.partition === BROWSER ? !/^(https?:\/\/|about:blank$)/.test(params.src) : !local(params.src) || params.partition !== PREVIEW) e.preventDefault()
  })
  // a Browsers page's link to a new tab opens in that page; a window.open popup (a sign-in's: Google, GitHub) gets a
  // small window of its own, in the same session with its opener kept, sandboxed, no node (else it can't hand back)
  wc.on('did-attach-webview', (_e, guest) => {
    if (guest.session !== session.fromPartition(BROWSER)) return
    // a page's script can call window.open in a loop (no click needed here): at most 5 new tabs or popups in 10 s
    let opened: number[] = []
    const tooMany = () => ((opened = [...opened.filter(t => Date.now() - t < 10000), Date.now()]), opened.length > 5)
    guest.setWindowOpenHandler(({ url, disposition }) => {
      if ((disposition === 'new-window' || disposition === 'foreground-tab' || disposition === 'background-tab') && tooMany()) return { action: 'deny' }
      if (disposition === 'new-window' && /^(https?:\/\/|about:blank$)/.test(url))
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      // a new tab (a middle click or ⌘-click: in the background; target=_blank: in front) is a Browsers workspace of its
      // own, which the app makes (browser-tab); anything else loads here (a failed load shows in the page)
      if (/^https?:\/\//.test(url))
        disposition === 'background-tab' || disposition === 'foreground-tab' ? wc.send('browser-tab', url, disposition === 'foreground-tab') : guest.loadURL(url).catch(() => {})
      return { action: 'deny' }
    })
    // the popup itself opens no more windows: its links to a new one load in it
    guest.on('did-create-window', w => w.webContents.setWindowOpenHandler(({ url }) => (/^https?:\/\//.test(url) && w.webContents.loadURL(url).catch(() => {}), { action: 'deny' })))
    guest.on('context-menu', (_e, p) => pageMenu(guest, p, wc).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined }))
    // ⌘W and ⌘T are the app's (close this page, open another), not the page's: it gets the keys while it has the focus
    guest.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && i.meta && !i.control && !i.alt && !i.shift && /^[tw]$/i.test(i.key)) e.preventDefault(), wc.send('browser-key', i.key.toLowerCase())
    })
  })
})
// a Browsers page's right click: its link, image, selection or field, back, forward, reload, and Inspect Element (the
// page's DevTools). ponytail: no spelling suggestions
function pageMenu(g: Electron.WebContents, p: Electron.ContextMenuParams, app: Electron.WebContents) {
  const items: MenuItemConstructorOptions[] = []
  const add = (...x: MenuItemConstructorOptions[]) => items.push(...x, { type: 'separator' })
  if (/^https?:\/\//.test(p.linkURL))
    add(
      { label: 'Open Link in New Tab', click: () => app.send('browser-tab', p.linkURL, false) },
      { label: 'Open Link in Your Browser', click: () => shell.openExternal(p.linkURL) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) },
    )
  if (p.mediaType === 'image' && p.srcURL) add({ label: 'Copy Image', click: () => g.copyImageAt(p.x, p.y) }, { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) })
  if (p.isEditable)
    add(
      { label: 'Cut', enabled: p.editFlags.canCut, click: () => g.cut() },
      { label: 'Copy', enabled: p.editFlags.canCopy, click: () => g.copy() },
      { label: 'Paste', enabled: p.editFlags.canPaste, click: () => g.paste() },
      { label: 'Select All', click: () => g.selectAll() },
    )
  else if (p.selectionText.trim()) add({ label: 'Copy', click: () => g.copy() })
  const h = g.navigationHistory
  add({ label: 'Back', enabled: h.canGoBack(), click: () => h.goBack() }, { label: 'Forward', enabled: h.canGoForward(), click: () => h.goForward() }, { label: 'Reload', click: () => g.reload() })
  items.push({ label: 'Inspect Element', click: () => g.inspectElement(p.x, p.y) })
  return Menu.buildFromTemplate(items)
}
// Electron grants a page every permission by default: the preview (which links can take anywhere) gets none of the
// sensitive ones (camera, microphone, location, clipboard reads, notifications…)
const PREVIEW_OK = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
app.whenReady().then(() => {
  for (const s of [session.fromPartition(PREVIEW), session.fromPartition(BROWSER)]) {
    s.setPermissionRequestHandler((_wc, perm, cb) => cb(PREVIEW_OK.has(perm)))
    s.setPermissionCheckHandler((_wc, perm) => PREVIEW_OK.has(perm))
  }
  // Browsers: Chrome's user agent without Laki's and Electron's names (sites that turn away an app's web view)
  const b = session.fromPartition(BROWSER)
  b.setUserAgent(b.getUserAgent().replace(/ (laki|Laki|Electron)\/\S+/g, ''))
  // the sidebar's video: YouTube's embed plays only with a Referer, and a file:// page sends none (its Error 153);
  // the app's id, as YouTube asks of apps
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (d, cb) =>
    cb({ requestHeaders: { ...d.requestHeaders, Referer: d.requestHeaders.Referer || 'https://dev.laki.app/' } }),
  )
})

const daemon = () =>
  ensureDaemon({
    ELECTRON_RUN_AS_NODE: '1',
    LAKI_FROM_APP: '1',
    ...(dev ? { LAKI_DEV_ORIGIN: new URL(process.env.ELECTRON_RENDERER_URL!).origin } : {}),
  })

function create() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0e1014',
    visualEffectState: 'active', // glass keeps its blur when the window isn't focused
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 }, // centered in the 38px sidebar header
    show: false, // shown maximized once ready
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // the preview pane; will-attach-webview locks it down
    },
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url) // a site, or a mail to write (widgets' links)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  // closing hides: the renderer keeps posting notifications for agents while the app runs windowless
  win.on('close', e => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => ((win = null), (linkReady = shotReady = false), app.dock?.setBadge(''), tray?.setTitle(''))) // the count came from the window
  win.webContents.on('did-start-navigation', e => e.isMainFrame && !e.isSameDocument && (linkReady = shotReady = false)) // a reload: links wait for the new page
  win.webContents.on('did-finish-load', () => {
    if (pendingTab) win?.webContents.send('focus-tab', pendingTab)
    pendingTab = null
    // LAKI_CAPTURE=<file.png>: a screenshot of the window 3s after load (checks a build without screen access)
    const out = process.env.LAKI_CAPTURE
    if (out) setTimeout(async () => win && writeFileSync(out, (await win.webContents.capturePage()).toPNG()), 3000)
  })
  if (dev) win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

function show(tab?: string) {
  if (!win) {
    pendingTab = tab ?? null
    create()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (tab) win.webContents.send('focus-tab', tab)
}

ipcMain.handle('conn', async () => {
  if (quitting) throw new Error('quitting') // after Quit Completely: no new daemon
  const { port, token } = await daemon()
  return { port, token }
})
// sound: a macOS sound's name (Settings › General), 'none', or unset: the default. actions: buttons (a waiting agent's
// choices, or a permission prompt's Allow and Deny; macOS shows the first with the Alerts style and the rest under
// Options, all under Options with Banners): each answers its menu straight through the daemon (the window may be
// closed by then), by its number and words, or Allow / Deny by first and last. Kept until used or closed: a
// collected Notification's events never come
type NoteAction = { text: string; n?: number; label?: string; pick?: 'first' | 'last' }
const notes = new Set<Notification>()
ipcMain.on('notify', (_e, title: string, body: string, tab: string, sound?: string, actions?: NoteAction[]) => {
  if (process.env.LAKI_NOTIFY_LOG) appendFileSync(process.env.LAKI_NOTIFY_LOG, JSON.stringify({ title, body, tab, sound, actions }) + '\n') // smoke tests
  const named = typeof sound === 'string' && /^[A-Za-z]+$/.test(sound) && sound !== 'none'
  const buttons = (Array.isArray(actions) ? actions : []).filter(a => typeof a?.text === 'string' && (Number.isInteger(a.n) || a.pick === 'first' || a.pick === 'last')).slice(0, 9)
  const n = new Notification({ title, body, silent: sound === 'none', ...(named && { sound }), actions: buttons.map(a => ({ type: 'button' as const, text: a.text.slice(0, 60) })) })
  const done = () => notes.delete(n)
  n.on('click', () => (done(), show(tab)))
  n.on('action', (_ev, i) => {
    done()
    const a = buttons[i]
    if (a) rpc('answer', { tab, ...(a.n ? { n: a.n, label: typeof a.label === 'string' ? a.label : undefined } : { pick: a.pick }) }).catch(() => show(tab)) // it moved on: look
  })
  n.on('close', done)
  notes.add(n)
  if (notes.size > 50) notes.delete(notes.values().next().value!) // ponytail: the oldest go; Notification Center keeps them for days
  n.show()
})

// a timer's end with its dialog (Settings › General › Timers): one of macOS's sounds, whatever notifications say
ipcMain.on('sound', (_e, name: string) => {
  if (typeof name === 'string' && /^[A-Za-z]+$/.test(name)) execFile('afplay', [`/System/Library/Sounds/${name}.aiff`], () => {})
})

// the agent browser (laki browser, MCP's laki_browser): a hidden window per workspace in the preview's session, kept
// to this Mac's localhost as the preview is, gone after 10 idle minutes; ops come from the daemon through the renderer
type Browse = { ws: string; home: string; op: string; url?: string; selector?: string; text?: string }
const agentWins = new Map<string, { w: BrowserWindow; idle?: ReturnType<typeof setTimeout> }>()
const pageJs = (f: string, ...args: unknown[]) => `(${f})(${args.map(a => JSON.stringify(a)).join(',')})`
ipcMain.handle('browse', async (e, r: Browse) => {
  if (e.sender !== win?.webContents) throw new Error('not the app window')
  let a = agentWins.get(r.ws)
  if (!a || a.w.isDestroyed()) {
    const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { partition: PREVIEW, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }) // hidden: its timers at full speed
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (ev, u) => !local(u) && ev.preventDefault())
    w.webContents.on('will-redirect', (ev, u) => !local(u) && ev.preventDefault())
    agentWins.set(r.ws, (a = { w }))
  }
  const entry = a
  clearTimeout(entry.idle)
  entry.idle = setTimeout(() => {
    if (agentWins.get(r.ws) === entry) agentWins.delete(r.ws)
    if (!entry.w.isDestroyed()) entry.w.destroy()
  }, 10 * 60e3)
  const wc = entry.w.webContents
  const settle = () => new Promise(ok => setTimeout(ok, 300)) // what a click starts gets a moment
  if (r.op === 'open' || !wc.getURL()) {
    const u = r.url ?? r.home
    if (!local(u)) throw new Error(`only this Mac's localhost: ${u}`)
    await wc.loadURL(u).catch(err => {
      throw new Error(/ERR_CONNECTION_REFUSED/.test(String(err)) ? `nothing listens on ${new URL(u).host}: start the dev server (laki run)` : String(err.message ?? err))
    })
  }
  const page = { url: wc.getURL(), title: wc.getTitle() }
  if (r.op === 'open') return page
  if (r.op === 'screenshot') {
    const img = await wc.capturePage()
    if (img.isEmpty()) throw new Error('nothing painted yet: try again')
    return { url: page.url, png: img.toPNG().toString('base64') }
  }
  if (r.op === 'text') return { ...page, text: await wc.executeJavaScript(`(document.body?.innerText ?? '').slice(0, 20000)`) }
  // click, fill: the first element the selector finds, scrolled into sight; fill types as a user would (input events)
  const found = await wc.executeJavaScript(
    pageJs(
      String((sel: string, op: string, text: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return `no element matches ${sel}`
        el.scrollIntoView({ block: 'center' })
        if (op === 'click') return el.click(), ''
        const f = el as HTMLInputElement
        if (!('value' in f)) return `${sel} isn't a field`
        f.focus()
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), 'value')?.set?.call(f, text)
        f.dispatchEvent(new Event('input', { bubbles: true }))
        f.dispatchEvent(new Event('change', { bubbles: true }))
        return ''
      }),
      r.selector ?? '',
      r.op,
      r.text ?? '',
    ),
  )
  if (found) throw new Error(found)
  await settle()
  return { url: wc.getURL(), title: wc.getTitle() }
})
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] }) // createDirectory: macOS's New Folder button
  return r.canceled ? null : r.filePaths[0]
})
// macOS dictation, as Edit › Start Dictation does; its language and microphone are in System Settings
ipcMain.on('dictate', () => Menu.sendActionToFirstResponder('startDictation:'))
ipcMain.on('dictation-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension'))
// Glass (Settings › Appearance): macOS's blur behind the page, whose backgrounds go see-through
ipcMain.on('glass', (_e, on: boolean) => {
  win?.setVibrancy(on ? 'under-window' : null)
  win?.setBackgroundColor(on ? '#00000000' : '#0e1014')
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
// notification's does), Open and Quit. tray false: Settings › General hid it
let tray: Tray | null = null
ipcMain.on('badge', (_e, n: number, items: { tab: string; label: string }[] = [], on = true) => {
  const count = Number.isInteger(n) && n > 0 ? String(n) : ''
  app.dock?.setBadge(count)
  if (!on) return void (tray?.destroy(), (tray = null))
  tray ??= new Tray(trayIcon())
  tray.setTitle(count, { fontType: 'monospacedDigit' })
  tray.setToolTip(count ? `${app.name}: ${count} need${count === '1' ? 's' : ''} you` : app.name)
  const tabs: MenuItemConstructorOptions[] = (Array.isArray(items) ? items : []).slice(0, 30).map(i => ({ label: String(i.label).slice(0, 90), click: () => show(String(i.tab)) }))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...tabs,
      ...(tabs.length ? [{ type: 'separator' as const }] : []),
      { label: 'Screenshot Area…', click: () => screenshot(true) }, // to the new-workspace page, for an agent
      { label: 'Screenshot Screen', click: () => screenshot(false) },
      { type: 'separator' },
      { label: `Open ${app.name}`, click: () => show() },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
})

// the floating bubbles (Settings › Appearance): a drop stuck to the screen's left or right edge, over every app and
// Space, with a circle per workspace whose agent works or waits (and the last ones used: floaterRecent), from the app
// window's list, then + Session and the microphone (floaterNew, floaterMic; with +, the drop stays when no agent is at
// work); hidden while Laki is in front. A circle's click shows its tab; a hover shows its card in a window of its
// own beside the drop, toward the screen's middle, that takes no clicks (the drop never moves under the mouse). The
// microphone's window (#voice) takes a prompt by dictation, for an agent of the list or a new session. The card and the
// voice window are the bar's window.open: the three share one renderer process. Dragged anywhere (floater-drag: the
// page sends how far the pointer went, so its cursors work; macOS's drag regions take them away), it snaps to the
// nearer edge as it's let go, and stays there
type Float = { tab: string; status?: string }
type FloatOpts = { style: string; cards: boolean; add: boolean; mic: boolean; voiceTo: 'pick' | 'new' }
const BAR = 44 // the drop's window width; floater.html's too
const VOICE = { width: 320, height: 186 } // the voice prompt's window; floater.html's #voice too
const STYLES = ['glow', 'gradient', 'arc', 'bricks', 'comet', 'wave', 'still'] // a working agent's circle (Settings' previews: floater.css)
let floats: { items: Float[]; colors: Record<string, string> } & FloatOpts = { items: [], colors: {}, style: 'glow', cards: true, add: false, mic: false, voiceTo: 'pick' }
let floater: BrowserWindow | null = null
let card: BrowserWindow | null = null
let voice: BrowserWindow | null = null
let voiceTabs = new Set<string>() // the agents the voice window offered (one may finish, and leave the list, meanwhile)
let hover: { tab: string; top: number } | null = null // the circle under the mouse: its tab, its top in the bar
let front = false // Laki is the front app (a launch makes it so; one in the background doesn't)
const floaterFile = () => join(app.getPath('userData'), 'floater.json') // where the bar was left: its top left corner
let home: { x: number; y: number } | null = null // where it was left (floater.json); barAt: where it is (a screen gone: the main one's default)
let barAt: { x: number; y: number } | null = null
let dragFrom: { x: number; y: number } | null = null // the window's spot as a drag started
const barSide = () => { // where the card goes: toward the middle of the bar's screen
  if (!barAt) return 'left'
  const d = screen.getDisplayNearestPoint(barAt).workArea
  return barAt.x + BAR / 2 > d.x + d.width / 2 ? 'left' : 'right'
}
const floatOpts = (width: number, height: number, focusable = true): BrowserWindowConstructorOptions => ({
  ...barAt,
  width,
  height,
  type: 'panel', // an NSPanel: over full-screen apps, and a click doesn't bring Laki forward
  frame: false,
  transparent: true,
  hasShadow: false,
  roundedCorners: false, // macOS rounds a frameless window's corners: the bar's flares sit in them, and the edge showed through
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  hiddenInMissionControl: true,
  acceptFirstMouse: true, // a click while another app is in front lands on the circle
  focusable,
  show: false,
  webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true },
})
// to: a window.open'd one's own page, whose first load is a navigation too (blocked, it stayed about:blank)
const pin = (f: BrowserWindow, to?: string) => {
  f.setAlwaysOnTop(true, 'floating')
  f.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  f.webContents.on('will-navigate', (e, url) => url !== to && e.preventDefault())
}
// the bar; its page opens the card and the voice window (#card, #voice), only those, as one of each
function barWin() {
  const f = new BrowserWindow(floatOpts(BAR, 60))
  pin(f)
  const kind = (url: string) => (url.split('#')[0] === f.webContents.getURL().split('#')[0] ? /#(card|voice)$/.exec(url)?.[1] : undefined)
  f.webContents.setWindowOpenHandler(({ url }) => {
    const k = kind(url)
    if (k === 'voice' && voice && !voice.isDestroyed()) voice.focus()
    if (!k || (k === 'card' ? card : voice)?.isDestroyed() === false) return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: k === 'card' ? floatOpts(280, 60, false) : floatOpts(VOICE.width, VOICE.height) }
  })
  f.webContents.on('did-create-window', (w, { url }) => {
    pin(w, url)
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (kind(url) === 'card') {
      card = w
      w.setIgnoreMouseEvents(true)
      w.on('closed', () => card === w && (card = null))
      return
    }
    voice = w
    w.on('closed', () => voice === w && (voice = null))
    w.webContents.on('did-finish-load', () => {
      voiceTabs = new Set(floats.voiceTo === 'new' ? [] : floats.items.map(x => x.tab))
      w.webContents.send('voice', floats.voiceTo === 'new' ? [] : floats.items, floats.colors, floats.voiceTo) // always a new session: no agents to pick
      if (barAt) {
        const d = screen.getDisplayNearestPoint(barAt).workArea
        const [, h] = f.getSize()
        const y = Math.max(d.y, Math.min(barAt.y + h - VOICE.height, d.y + d.height - VOICE.height))
        w.setPosition(barSide() === 'left' ? barAt.x - 6 - VOICE.width : barAt.x + BAR + 6, Math.round(y))
      }
      w.show()
      w.focus() // the key window without bringing Laki's own forward (a panel): dictation and the keys go to it
    })
  })
  if (dev) f.loadURL(`${new URL('floater.html', `${process.env.ELECTRON_RENDERER_URL}/`).href}#bar`)
  else f.loadFile(fileURLToPath(new URL('../renderer/floater.html', import.meta.url)), { hash: 'bar' })
  return f
}
// the drop against the nearer edge (left or right) of the screen it's on (its spot's, or the main one's when that's on
// no screen: a laptop undocked, home kept for its return), inside it top to bottom; the page told which side, for its
// shape. animate: let go after a drag
function snap(animate = false) {
  if (!floater) return
  const h = floater.getSize()[1]
  const at = home ?? { x: Infinity, y: 0 }
  const on = screen.getAllDisplays().find(({ bounds: b }) => at.x + BAR / 2 >= b.x && at.x + BAR / 2 < b.x + b.width && at.y >= b.y && at.y < b.y + b.height)
  const d = (on ?? screen.getPrimaryDisplay()).workArea
  const right = on ? at.x + BAR / 2 > d.x + d.width / 2 : true
  barAt = { x: right ? d.x + d.width - BAR : d.x, y: on ? Math.max(d.y, Math.min(at.y, d.y + d.height - h)) : d.y + Math.round(d.height * 0.6) }
  floater.setBounds({ ...barAt, width: BAR, height: h }, animate)
  floater.webContents.send('floater-side', right ? 'right' : 'left')
}
app.whenReady().then(() => screen.on('display-removed', () => snap()))
function placeFloater() {
  if ((!floats.items.length && !floats.add) || front || parked) return void (floater?.hide(), card?.hide(), (hover = null))
  if (!floater) {
    try {
      barAt = home ??= JSON.parse(readFileSync(floaterFile(), 'utf8'))
    } catch {}
    const f = (floater = barWin())
    f.webContents.on('did-finish-load', () => (snap(), sendFloats()))
    f.on('closed', () => floater === f && ((floater = null), (dragFrom = null)))
  } else sendFloats()
  if (!floater.isVisible()) floater.showInactive()
}
const sendFloats = () => floater?.webContents.send('floats', floats)
ipcMain.on('floats', (e, items: unknown, colors: unknown, opts: unknown) => {
  if (e.sender !== win?.webContents) return
  const o = (opts && typeof opts === 'object' ? opts : {}) as Partial<FloatOpts>
  floats = {
    items: Array.isArray(items) ? items.slice(0, 12) : [],
    colors: colors && typeof colors === 'object' ? (colors as Record<string, string>) : {},
    style: STYLES.includes(o.style as string) ? o.style! : 'glow',
    cards: o.cards !== false,
    add: o.add === true,
    mic: o.mic === true,
    voiceTo: o.voiceTo === 'new' ? 'new' : 'pick',
  }
  if (!floats.cards) (hover = null), card?.hide()
  if (parked && floatState() !== parked) parked = ''
  placeFloater()
})
// Stop (Settings › Resources): the bubbles' windows closed, until an agent's state changes
let parked = ''
const floatState = () => JSON.stringify(floats.items.map(x => [x.tab, x.status]))

// what each of the app's processes holds, for Settings › Resources (by pid; ps has the memory): the window, the frames
// in it of their own (a JS widget, the video), the preview's page, an agent browser's, the bubbles, the editor. stop:
// what proc-stop frees (the renderer's own: the video, a widget, the preview)
ipcMain.handle('procs', e => {
  if (e.sender !== win?.webContents || !win) return []
  const out: { pid: number; name: string; stop?: string }[] = []
  const add = (pid: number, name: string, stop?: string) => pid > 0 && out.push({ pid, name, ...(stop && { stop }) })
  const mine = win.webContents.getOSProcessId()
  add(mine, 'The window')
  for (const f of win.webContents.mainFrame.framesInSubtree) {
    if (f.osProcessId === mine || !URL.canParse(f.url)) continue
    const u = new URL(f.url)
    const id = /^\/widget\/([^/]+)$/.exec(u.pathname)?.[1]
    if (id && local(f.url)) add(f.osProcessId, `widget:${decodeURIComponent(id)}`, `widget:${decodeURIComponent(id)}`)
    else if (u.hostname.endsWith('youtube-nocookie.com')) add(f.osProcessId, 'The video', 'video')
    else add(f.osProcessId, u.host)
  }
  // a Browsers page (its Stop: the pages you aren't on unloaded, App's laki-stop) or its sign-in popup; the preview
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue
    const page = wc.getType() === 'webview'
    if (wc.session === session.fromPartition(BROWSER)) add(wc.getOSProcessId(), `Browser: ${new URL(wc.getURL() || 'about:blank').host || 'a page'}${page ? '' : ' (sign-in window)'}`, page ? 'browsers' : undefined)
    else if (page) add(wc.getOSProcessId(), 'The preview', 'preview')
  }
  for (const [ws, a] of agentWins) if (!a.w.isDestroyed()) add(a.w.webContents.getOSProcessId(), `browser:${ws}`, `browse:${ws}`)
  for (const f of [floater, card, voice]) if (f && !f.isDestroyed()) add(f.webContents.getOSProcessId(), 'Floating bubbles', 'floater') // one process (the bar's window.open), one row
  if (annot && !annot.isDestroyed()) add(annot.webContents.getOSProcessId(), 'Screenshot editor')
  return out
})
ipcMain.on('proc-stop', (e, what: unknown) => {
  if (e.sender !== win?.webContents || typeof what !== 'string') return
  if (what === 'floater') {
    parked = floatState()
    hover = null
    for (const f of [floater, card, voice]) if (f && !f.isDestroyed()) f.destroy()
  } else if (what.startsWith('browse:')) {
    const a = agentWins.get(what.slice(7))
    if (!a) return
    clearTimeout(a.idle)
    agentWins.delete(what.slice(7))
    if (!a.w.isDestroyed()) a.w.destroy()
  }
})
ipcMain.on('floater-size', (e, h: number) => floater && e.sender === floater.webContents && h > 0 && h < 1200 && Math.round(h) !== floater.getSize()[1] && (floater.setSize(BAR, Math.round(h)), dragFrom || snap())) // where it is, kept on screen (a drag may be under way); the same height: nothing, a snap's animation goes on
ipcMain.on('floater-open', (e, tab: string) => floater && e.sender === floater.webContents && typeof tab === 'string' && (app.focus({ steal: true }), show(tab)))
// its buttons: + Session (the new-workspace page); the microphone's window is the page's own window.open
ipcMain.on('floater-act', (e, what: string) => floater && e.sender === floater.webContents && what === 'new' && (app.focus({ steal: true }), openLink('laki://new')))
// the voice prompt: to an agent of the list (send, as the app's, queued while it works), or a new session's page
ipcMain.handle('voice-send', async (e, tab: unknown, text: unknown) => {
  if (!voice || e.sender !== voice.webContents || typeof text !== 'string' || !text.trim()) return { error: 'nothing to send' }
  if (text.length > 20000) return { error: 'too long: 20,000 characters at most' }
  if (typeof tab === 'string' && tab) {
    if (!voiceTabs.has(tab)) return { error: 'not an agent this window offered' }
    const r = await rpc<{ queued?: number }>('send', { target: tab, text: text.trim(), whenIdle: true }).catch((err: Error) => ({ error: err.message }))
    if ('error' in r) return r
    voice?.close() // (it may have shut meanwhile)
    return { queued: !!r?.queued }
  }
  voice.close()
  app.focus({ steal: true })
  openLink(`laki://new?prompt=${encodeURIComponent(text.trim())}`)
  return {}
})
ipcMain.on('voice-close', e => voice && e.sender === voice.webContents && voice.close())
ipcMain.on('floater-drag', (e, phase: string, dx: number, dy: number) => {
  if (!floater || e.sender !== floater.webContents) return
  if (phase === 'start') {
    const [x, y] = floater.getPosition()
    dragFrom = { x, y }
    hover = null
    card?.hide()
  } else if (phase === 'move' && dragFrom && Number.isFinite(dx) && Number.isFinite(dy)) floater.setPosition(Math.round(dragFrom.x + dx), Math.round(dragFrom.y + dy))
  else if (phase === 'end' && dragFrom) {
    dragFrom = null
    const [x, y] = floater.getPosition()
    home = { x, y }
    snap(true)
    home = barAt
    try {
      writeFileSync(floaterFile(), JSON.stringify(home))
    } catch {} // ponytail: not kept, it comes back at the default spot
  }
})
// a hover: the card's text goes to its window, which says its size; then it's placed beside the circle and shown
// (only while the mouse is over the bar: a page shown again keeps the circle it had under the mouse, which would
// bring a card back by itself)
const overBar = () => {
  if (!floater?.isVisible()) return false
  const p = screen.getCursorScreenPoint()
  const b = floater.getBounds()
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
}
ipcMain.on('floater-hover', (e, tab: string, top: number) => {
  if (!floater || e.sender !== floater.webContents || dragFrom) return
  const f = floats.items.find(x => x.tab === tab)
  hover = f && Number.isFinite(top) && floats.cards && !front && overBar() ? { tab, top } : null
  if (hover) card?.webContents.send('card', f, floats.colors)
  else card?.hide()
})
ipcMain.on('floater-card', (e, tab: string, w: number, h: number) => {
  if (!card || !barAt || e.sender !== card.webContents || hover?.tab !== tab || !(w > 0 && w < 800 && h > 0 && h < 800)) return
  if (front || !overBar()) return void ((hover = null), card.hide()) // gone meanwhile (a click that brought Laki forward)
  const d = screen.getDisplayNearestPoint(barAt).workArea
  const y = Math.max(d.y, Math.min(barAt.y + hover.top - 6, d.y + d.height - h))
  card.setBounds({ x: barSide() === 'left' ? barAt.x - 6 - Math.round(w) : barAt.x + BAR + 6, y: Math.round(y), width: Math.round(w), height: Math.round(h) })
  card.showInactive()
})
// in front: one of Laki's own windows has the focus. A press on the drop makes Laki the active app too (its panel
// takes the click), so being active alone isn't it: the drop would hide under the pointer as a drag starts
const own = (w: BrowserWindow | null) => !!w && w !== floater && w !== card && w !== voice
const setFront = (on: boolean) => on !== front && ((front = on), placeFloater())
app.on('browser-window-focus', (_e, w) => own(w) && setFront(true))
app.on('did-become-active', () => setTimeout(() => setFront(own(BrowserWindow.getFocusedWindow())), 100)) // the focus comes after
app.on('did-resign-active', () => setFront(false))

// the menu bar's screenshots: macOS's screencapture (a part: drag, or Space and a click for a window; Esc cancels),
// then the editor window (annotate) to draw on it, then the new-workspace page with it. Needs Screen Recording for Laki (macOS asks once).
// ponytail: the whole screen is the main display; screencapture takes a file per display for the others
function screenshot(part: boolean) {
  const file = join(tmpdir(), `laki-shot-${process.pid}-${Date.now()}.png`)
  setTimeout(() => // the menu closes first, out of the picture
    execFile('screencapture', [part ? '-i' : '-m', '-x', file], () => {
      let png: string
      try {
        png = readFileSync(file).toString('base64')
      } catch {
        return // cancelled, or no permission: no file
      }
      rmSync(file, { force: true })
      annotate(png)
    }), 250)
}

// the screenshot's editor (annotate.html): a small window over the others to crop it, draw on it and say what to do
// with it; Add to prompt sends both to the new-workspace page, Esc drops them
let annot: BrowserWindow | null = null
function annotate(png: string) {
  annot?.destroy()
  const { width, height } = nativeImage.createFromBuffer(Buffer.from(png, 'base64')).getSize()
  const d = screen.getPrimaryDisplay()
  const fit = (n: number, extra: number, min: number, max: number) => Math.round(Math.min(Math.max(n / d.scaleFactor + extra, min), max))
  const w = (annot = new BrowserWindow({
    width: fit(width, 48, 720, d.workAreaSize.width * 0.85),
    height: fit(height, 190, 460, d.workAreaSize.height * 0.85),
    title: 'Screenshot',
    backgroundColor: '#0e1014',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    alwaysOnTop: true,
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true },
  }))
  w.setAlwaysOnTop(true, 'floating')
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', e => e.preventDefault())
  w.webContents.once('did-finish-load', () => w.webContents.send('annotate-image', png))
  w.on('closed', () => annot === w && (annot = null))
  if (dev) w.loadURL(new URL('annotate.html', `${process.env.ELECTRON_RENDERER_URL}/`).href)
  else w.loadFile(fileURLToPath(new URL('../renderer/annotate.html', import.meta.url)))
}
ipcMain.on('annotate-done', (e, png: unknown, note: unknown) => {
  if (!annot || e.sender !== annot.webContents || typeof png !== 'string') return
  annot.destroy()
  const s: [string, string] = [png, typeof note === 'string' ? note.slice(0, 4000) : '']
  if (shotReady && win) win.webContents.send('shot', ...s)
  else shot = s
  show()
})
ipcMain.on('annotate-cancel', e => annot && e.sender === annot.webContents && annot.destroy())

// the menu bar's icon: Laki's mark (a chevron and a dot) drawn as a 32×32 template image (@2x): macOS colors it for a
// light or dark menu bar from its alpha alone
function trayIcon() {
  const S = 32
  const px = Buffer.alloc(S * S * 4) // BGRA, black
  const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const [dx, dy] = [bx - ax, by - ay]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - ax - t * dx, y - ay - t * dy)
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const [cx, cy] = [x + 0.5, y + 0.5]
      const d = Math.min(Math.min(seg(cx, cy, 6, 23, 15, 12), seg(cx, cy, 15, 12, 24, 23)) - 2.6, Math.hypot(cx - 25, cy - 7) - 3)
      px[(y * S + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - d))) // antialiased edges
    }
  const img = nativeImage.createFromBitmap(px, { width: S, height: S, scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}
// the preview pane's screenshot: a webview of this window's, as a PNG in base64
ipcMain.handle('capture', async (e, id: number) => {
  const wc = webContents.fromId(id)
  if (!wc || wc.getType() !== 'webview' || wc.hostWebContents !== e.sender) throw new Error('no such preview')
  const img = await wc.capturePage()
  if (img.isEmpty()) throw new Error('nothing on screen to capture yet')
  return img.toPNG().toString('base64')
})
ipcMain.on('open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
})
// a terminal's ⌘-clicked file:// link (claude's paths), the app window's only: { rel } for a file inside root (the
// workspace: the app's preview), a folder in Finder, a document in its app; anything that could run (an app, a script, no
// extension) only shown in Finder. Links followed first: their target's name is what counts
const DOCS = /\.(md|markdown|txt|log|json|jsonl|ya?ml|toml|csv|tsv|xml|html?|pdf|png|jpe?g|gif|webp|svg|heic|mp4|mov|webm|mp3|m4a|wav)$/i
const BUNDLE = /\.(app|bundle|framework|plugin|kext|pkg|mpkg|prefpane|workflow|action|saver|appex)\/?$/i
ipcMain.handle('open-path', async (e, path: unknown, root: unknown) => {
  if (!win || e.sender !== win.webContents || typeof path !== 'string' || !path.startsWith('/')) return 'missing'
  const real = await realpath(path).catch(() => '')
  const st = real && (await stat(real).catch(() => null))
  if (!st) return 'missing'
  const top = typeof root === 'string' && root.startsWith('/') ? await realpath(root).catch(() => '') : ''
  if (st.isFile() && top && real.startsWith(`${top}/`)) return { rel: real.slice(top.length + 1) }
  if (st.isDirectory() ? !BUNDLE.test(real) : st.isFile() && DOCS.test(real)) await shell.openPath(real)
  else shell.showItemInFolder(real)
  return 'opened'
})

// Quit Completely: the daemon too, so every agent stops (they resume when the app opens again)
async function quitCompletely() {
  const v = await rpc<View>('state', {}, 3000).catch(() => null)
  const n = v?.tabs.filter(t => t.status === 'running' && t.kind === 'agent').length ?? 0 // a shell's command isn't a turn
  if (n) {
    const r = await dialog.showMessageBox({
      type: 'question',
      message: `Quit ${app.name} completely?`,
      detail: `${n === 1 ? 'An agent is' : `${n} agents are`} working: stopping the daemon cuts the turn off. Agents resume when ${app.name} opens again.`,
      buttons: ['Quit Completely', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (r.response !== 0) return
  }
  quitting = true
  await rpc('shutdown', {}, 3000).catch(() => {})
  app.quit()
}

// no ⌘W/⌘N/⌘T/⌘K accelerators: the renderer owns those keys
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => openLink('laki://about') }, // the renderer's: with the website
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
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]),
)

app.whenReady().then(async () => {
  if (app.isPackaged) app.setAsDefaultProtocolClient('laki')
  await daemon().catch(e => dialog.showErrorBox('Laki', `The daemon didn't start: ${e.message}`))
  create()
})
app.on('before-quit', () => (quitting = true))
app.on('activate', () => show())
// macOS: the app (and always the daemon) keeps running without windows
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
