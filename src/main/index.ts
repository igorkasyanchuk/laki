// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links, laki:// links,
// the preview pane's webview (localhost only) and its screenshots.
import { app, BrowserWindow, type BrowserWindowConstructorOptions, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, Notification, screen, session, shell, Tray, webContents } from 'electron'
import { execFile, spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureDaemon, rpc } from '../shared/conn.ts'
import type { View } from '../shared/types.ts'

// a dev build's: the page its windows load and the daemon's extra origin. An installed app takes neither from its
// environment (launchctl setenv reaches every launch), nor passes them on to the daemon and agents
if (app.isPackaged) delete process.env.ELECTRON_RENDERER_URL, delete process.env.LAKI_DEV_ORIGIN
const dev = !!process.env.ELECTRON_RENDERER_URL
// scripts/pack-smoke.sh's: a screenshot of the window 3s after load, the notifications as posted. Switches, not env:
// none reach a launch from Finder or the Dock
const capture = app.commandLine.getSwitchValue('laki-capture')
const notifyLog = app.commandLine.getSwitchValue('laki-notify-log')
const mac = process.platform === 'darwin' // elsewhere (Linux): the system's title bar, and closing the window quits (no Dock to bring it back)
let win: BrowserWindow | null = null
let pendingTab: string | null = null
let quitting = false
let link: string | null = null // a laki:// link that came before the renderer listened
let linkReady = false // the renderer listens for links
let shot: [string, string] | null = null // a screenshot (a PNG, base64, and its note) from the menu bar, before the renderer listened
let shotReady = false // the renderer listens for screenshots

// Laki.AppImage --headless … (Laki.app/Contents/MacOS/Laki too): laki serve through Electron's own node, before any
// window or display: a server's daemon and remote access, no app (docs/headless.md)
const headless = process.argv.indexOf('--headless')
if (headless > 0) {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url))
  const r = spawnSync(process.execPath, [cli, 'serve', ...process.argv.slice(headless + 1)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LAKI_HEADLESS_PARENT: String(process.pid) } })
  process.exit(r.status ?? 1)
}

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
// Google turns away sign-in in an app's web view ("This browser or app may not be secure"): on its sign-in pages a
// Browsers page says it's Firefox (its user agent, without Chrome's client hints), which Google lets in. Turned
// down anyway (its rejected page), the sign-in opens in your own browser. ponytail: navigator.userAgentData still
// says Chromium; Google may look there one day
const GOOGLE_SIGNIN = /^https:\/\/accounts\.google\.com\//
const GOOGLE_NO = /^https:\/\/accounts\.google\.com\/(v\d\/)?signin\/rejected/
const FIREFOX = (v => `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64'}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`)(120 + Math.floor((Date.now() - Date.UTC(2023, 10, 21)) / (31 * 864e5))) // a current Firefox: 120 came out Nov 2023, one every 4-5 weeks
let chromeUA = '' // the Browsers session's own (Chrome's, without Laki's and Electron's names)
function googleSignIn(wc: Electron.WebContents) {
  const ua = (url: string) => wc.setUserAgent(GOOGLE_SIGNIN.test(url) ? FIREFOX : chromeUA)
  wc.on('did-start-navigation', d => d.isMainFrame && !d.isSameDocument && ua(d.url))
  wc.on('will-redirect', d => d.isMainFrame && ua(d.url))
  wc.on('did-navigate', (_e, url) => {
    if (!GOOGLE_NO.test(url)) return
    const to = new URL(url).searchParams.get('continue')
    void shell.openExternal(to && /^https:\/\//.test(to) ? `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(to)}` : 'https://accounts.google.com/')
    if (wc.getType() === 'window') BrowserWindow.fromWebContents(wc)?.close() // a sign-in popup: the page that opened it says why (BrowserPane)
  })
}
app.on('web-contents-created', (_e, wc) => {
  if (wc.session === session.fromPartition(BROWSER)) googleSignIn(wc)
  wc.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false }) // whatever the tag's webpreferences said
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
  b.setUserAgent((chromeUA = b.getUserAgent().replace(/ (laki|Laki|Electron)\/\S+/g, '')))
  // Google's sign-in: Firefox's user agent in the requests too, and none of Chrome's client hints (googleSignIn)
  b.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d, cb) =>
    cb({ requestHeaders: { ...Object.fromEntries(Object.entries(d.requestHeaders).filter(([k]) => !/^sec-ch-ua/i.test(k))), 'User-Agent': FIREFOX } }),
  )
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

// where the window was left (window.json in userData): its bounds out of maximized and full screen, and whether it
// was either. Only when they're on a screen still there (a monitor unplugged: maximized again, as the first start)
const winFile = () => join(app.getPath('userData'), 'window.json')
type WinAt = { x: number; y: number; width: number; height: number; max?: boolean; full?: boolean }
function winAt(): WinAt | null {
  try {
    const w: WinAt = JSON.parse(readFileSync(winFile(), 'utf8'))
    const a = screen.getDisplayMatching(w).workArea
    const over = Math.min(w.x + w.width, a.x + a.width) - Math.max(w.x, a.x) >= 100 && Math.min(w.y + w.height, a.y + a.height) - Math.max(w.y, a.y) >= 50
    return [w.x, w.y, w.width, w.height].every(Number.isFinite) && over ? { ...w, width: Math.min(w.width, a.width), height: Math.min(w.height, a.height) } : null // from a bigger screen: no larger than this one
  } catch {
    return null
  }
}
let winSave: ReturnType<typeof setTimeout> | undefined
const saveWin = () => {
  clearTimeout(winSave)
  if (!win || win.isDestroyed() || win.isMinimized()) return
  try {
    writeFileSync(winFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized(), full: focusFull ?? win.isFullScreen() }))
  } catch {}
}
const keepWin = () => (clearTimeout(winSave), (winSave = setTimeout(saveWin, 500))) // a drag's moves: once it rests

function create() {
  const at = winAt()
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(at && { x: at.x, y: at.y, width: at.width, height: at.height }),
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0e1014',
    visualEffectState: 'active', // glass keeps its blur when the window isn't focused
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } } : { autoHideMenuBar: true }), // centered in the 38px sidebar header; Alt shows the menu
    show: false, // shown once ready: where it was left (winAt), else maximized
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // the preview pane; will-attach-webview locks it down
    },
  })
  win.once('ready-to-show', () => {
    if (!at || at.max) win?.maximize()
    if (at?.full) win?.setFullScreen(true)
    win?.show()
  })
  for (const e of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(e as 'resize', keepWin)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url) // a site, or a mail to write (widgets' links)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  // closing hides: the renderer keeps posting notifications for agents while the app runs windowless
  win.on('close', e => {
    saveWin() // a move just before quitting isn't lost to the timer
    if (quitting || !mac) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => ((win = null), (focusFull = null), (linkReady = shotReady = false), app.dock?.setBadge(''), tray?.setTitle(''))) // the count came from the window
  win.webContents.on('did-start-navigation', e => {
    if (!e.isMainFrame || e.isSameDocument) return
    linkReady = shotReady = false // a reload: links wait for the new page
    if (focusFull !== null) win?.setFullScreen(focusFull) // and comes back out of full-screen mode, as it was before
    focusFull = null
  })
  win.webContents.on('did-finish-load', () => {
    if (pendingTab) win?.webContents.send('focus-tab', pendingTab)
    pendingTab = null
    // --laki-capture=<file.png>: a screenshot of the window 3s after load (checks a build without screen access)
    if (capture) setTimeout(async () => win && writeFileSync(capture, (await win.webContents.capturePage()).toPNG()), 3000)
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

// the global hotkey (Settings › General, ui.tsx keyLabel's text: ⌃⌥⌘L; '' none): Laki forward from any app. False:
// another app (or macOS) has those keys
const ACCEL_KEYS: Record<string, string> = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', '+': 'Plus' }
function accelOf(label: string) {
  const m = /^(⌃?)(⌥?)(⇧?)(⌘?)(.+)$/.exec(label)
  const mods = [m?.[1], m?.[2], m?.[4]].filter(Boolean).length
  // a key with one of ⌃ ⌥ ⌘ (⌘K, ⌥A) would be taken from every app: two of them, or one with Space or an F key
  if (!m || !mods || (mods < 2 && !/^(Space|F\d{1,2})$/.test(m[5]))) return ''
  return [m[1] && 'Control', m[2] && 'Alt', m[3] && 'Shift', m[4] && (mac ? 'Command' : 'Super'), ACCEL_KEYS[m[5]] ?? m[5]].filter(Boolean).join('+')
}
let hotkey = ''
ipcMain.handle('hotkey', (_e, label: unknown) => {
  const a = typeof label === 'string' ? accelOf(label) : ''
  if (a !== hotkey) {
    if (hotkey) globalShortcut.unregister(hotkey)
    hotkey = ''
    try {
      if (a && globalShortcut.register(a, () => (app.focus({ steal: true }), show()))) hotkey = a
    } catch {} // keys Electron can't name
  }
  return a ? hotkey === a : !label // false: another app has them, or they can't be a global hotkey
})
app.on('will-quit', () => globalShortcut.unregisterAll())

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
type NoteAction = { text: string; n?: number; label?: string; pick?: 'first' | 'last'; tool?: { req: string; allow: string } } // tool: an extension's tool call, answered (widgetToolAnswer)
const notes = new Set<Notification>()
ipcMain.on('notify', (_e, title: string, body: string, tab: string, sound?: string, actions?: NoteAction[]) => {
  if (notifyLog) appendFileSync(notifyLog, JSON.stringify({ title, body, tab, sound, actions }) + '\n') // smoke tests
  const named = typeof sound === 'string' && /^[A-Za-z]+$/.test(sound) && sound !== 'none'
  const buttons = (Array.isArray(actions) ? actions : []).filter(a => typeof a?.text === 'string' && (Number.isInteger(a.n) || a.pick === 'first' || a.pick === 'last' || typeof a.tool?.req === 'string')).slice(0, 9)
  const n = new Notification({ title, body, silent: sound === 'none', ...(named && { sound }), actions: buttons.map(a => ({ type: 'button' as const, text: a.text.slice(0, 60) })) })
  const done = () => notes.delete(n)
  n.on('click', () => (done(), show(tab)))
  n.on('action', (_ev, i) => {
    done()
    const a = buttons[i]
    if (a?.tool) rpc('widgetToolAnswer', { req: a.tool.req, allow: a.tool.allow }).catch(() => {})
    else if (a) rpc('answer', { tab, ...(a.n ? { n: a.n, label: typeof a.label === 'string' ? a.label : undefined } : { pick: a.pick }) }).catch(() => show(tab)) // it moved on: look
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
ipcMain.handle('pick-folder', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? win!, { properties: ['openDirectory', 'createDirectory'] }) // createDirectory: macOS's New Folder button
  return r.canceled ? null : r.filePaths[0]
})
// macOS dictation, as Edit › Start Dictation does; its language and microphone are in System Settings
ipcMain.on('dictate', () => Menu.sendActionToFirstResponder('startDictation:'))
ipcMain.on('dictation-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension'))
// Full screen (⌘⇧⏎, the tab bar's ⤢): the tab's content alone in the window, the window full screen too; off: full
// screen only if it was before. focusFull: that, while it's on (what the window's saved state keeps)
let focusFull: boolean | null = null
ipcMain.on('full-screen', (e, on: boolean) => {
  if (!win || e.sender !== win.webContents) return
  if (on && focusFull === null) focusFull = win.isFullScreen()
  win.setFullScreen(on || !!focusFull)
  if (!on) focusFull = null
})
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
let trayTabs: MenuItemConstructorOptions[] = [] // the last badge's, for a menu made again as screens come and go
function trayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      ...trayTabs,
      ...(trayTabs.length ? [{ type: 'separator' as const }] : []),
      { label: 'New Workspace…', click: () => newWsWin() }, // the bubbles' + window: over the app you're in
      { label: 'Screenshot Area…', click: () => screenshot(true) }, // to the new-workspace page, for an agent
      { label: 'Screenshot Screen', ...(screen.getAllDisplays().length > 1 ? { submenu: screenItems() } : { click: () => screenshot(false) }) },
      { type: 'separator' },
      { label: `Open ${app.name}`, click: () => show() },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}
app.whenReady().then(() => (screen.on('display-added', trayMenu), screen.on('display-removed', trayMenu), screen.on('display-metrics-changed', trayMenu))) // its sizes
ipcMain.on('badge', (_e, n: number, items: { tab: string; label: string }[] = [], on = true) => {
  const count = Number.isInteger(n) && n > 0 ? String(n) : ''
  app.dock?.setBadge(count)
  if (!on) return void (tray?.destroy(), (tray = null))
  tray ??= new Tray(trayIcon())
  tray.setTitle(count, { fontType: 'monospacedDigit' })
  tray.setToolTip(count ? `${app.name}: ${count} need${count === '1' ? 's' : ''} you` : app.name)
  trayTabs = (Array.isArray(items) ? items : []).slice(0, 30).map(i => ({ label: String(i.label).slice(0, 90), click: () => show(String(i.tab)) }))
  trayMenu()
})

// the floating bubbles (Settings › Appearance): a drop stuck to the screen's left or right edge, over every app and
// Space, with a circle per workspace whose agent works or waits (and the last ones used: floaterRecent), from the app
// window's list, then a + (floaterNew; with it, the drop stays when no agent is at work) whose click shows New task,
// Say it, Screenshot area and Whole screen (the menu bar's): stacked in the drop over the + (floaterMenu stack: the drop
// grows up, the + stays under the mouse) or as a menu in a window beside it (card: #menu, keys 1-4, gone as it loses the
// focus); hidden while Laki is in front. A circle's click shows its tab; a hover shows its card in a window of its
// own beside the drop, toward the screen's middle, that takes no clicks (the drop never moves under the mouse). The
// Say it's window (#voice) takes a prompt by dictation, for an agent of the list or a new session. The card, the menu and
// the voice window are the bar's window.open: the four share one renderer process. Dragged anywhere (floater-drag: the
// page sends how far the pointer went, so its cursors work; macOS's drag regions take them away), it snaps to the
// edge nearest where it's let go (left, right, top or bottom: a row there, its windows below or above it), and stays there
type Float = { tab: string; status?: string }
type FloatOpts = { style: string; cards: boolean; add: boolean; menu: 'stack' | 'card'; voiceTo: 'pick' | 'new'; doneAlert: boolean; ai: boolean }
const BAR = 44 // the drop's window width; floater.html's too
const VOICE = { width: 320, height: 186 } // the voice prompt's window; floater.html's #voice too
const MENU = { width: 236, height: 196 } // the +'s menu beside the drop (floaterMenu card); floater.html's #menu too
const menuH = () => MENU.height + (floats.ai ? 46 : 0) // a row more: Ask Laki AI
const STYLES = ['glow', 'gradient', 'arc', 'bricks', 'comet', 'wave', 'still'] // a working agent's circle (Settings' previews: floater.css)
let floats: { items: Float[]; colors: Record<string, string> } & FloatOpts = { items: [], colors: {}, style: 'glow', cards: true, add: false, menu: 'stack', voiceTo: 'pick', doneAlert: true, ai: false }
let floater: BrowserWindow | null = null
let card: BrowserWindow | null = null
let voice: BrowserWindow | null = null
let menu: BrowserWindow | null = null
let menuTop = 0 // the +'s top in the bar, as its menu opens
let voiceTabs = new Set<string>() // the agents the voice window offered (one may finish, and leave the list, meanwhile)
let hover: { tab: string; top: number } | null = null // the circle under the mouse: its tab, how far down (or across) the bar it is
let front = false // Laki is the front app (a launch makes it so; one in the background doesn't)
const floaterFile = () => join(app.getPath('userData'), 'floater.json') // where the bar was left: its top left corner
type Side = 'left' | 'right' | 'top' | 'bottom' // the screen edge it's on; top and bottom: a row
type Spot = { x: number; y: number; side?: Side }
let home: Spot | null = null // where it was left (floater.json); barAt: where it is (a screen gone: the main one's default)
let barAt: { x: number; y: number } | null = null
let side: Side = 'right'
let dragFrom: { x: number; y: number } | null = null // the window's spot as a drag started
let stackFrom: Spot | null = null // where the drop was as its stack opened: back there as it closes
let shooting = false // a screenshot under way: the drop and its card stay out of it
const across = () => side === 'top' || side === 'bottom' // a row along the top or bottom edge
const barLen = () => (floater ? floater.getSize()[across() ? 0 : 1] : 0) // its length along the edge
const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(v, hi)))
const sized = (len: number) => (across() ? { width: Math.round(len), height: BAR } : { width: BAR, height: Math.round(len) })
// a window of w by h beside the drop, toward the screen's middle: at along px down (or across) the bar, kept on screen
const beside = (w: number, h: number, along: number) => {
  const d = screen.getDisplayNearestPoint(barAt!).workArea
  if (across()) return { x: clamp(barAt!.x + along, d.x, d.x + d.width - w), y: side === 'bottom' ? barAt!.y - 6 - h : barAt!.y + BAR + 6 }
  return { x: side === 'right' ? barAt!.x - 6 - w : barAt!.x + BAR + 6, y: clamp(barAt!.y + along, d.y, d.y + d.height - h) }
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
// the bar; its page opens the card, the menu and the voice window (#card, #menu, #voice), only those, as one of each
function barWin() {
  const f = new BrowserWindow(floatOpts(BAR, 60))
  pin(f)
  const kind = (url: string) => (url.split('#')[0] === f.webContents.getURL().split('#')[0] ? /#(card|voice|menu)$/.exec(url)?.[1] : undefined)
  f.webContents.setWindowOpenHandler(({ url }) => {
    const k = kind(url)
    if (k === 'voice' && voice && !voice.isDestroyed()) voice.focus()
    if (!k || (k === 'card' ? card : k === 'menu' ? menu : voice)?.isDestroyed() === false) return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: k === 'card' ? floatOpts(280, 60, false) : k === 'menu' ? floatOpts(MENU.width, menuH()) : floatOpts(VOICE.width, VOICE.height) }
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
    if (kind(url) === 'menu') {
      menu = w
      card?.hide()
      hover = null
      w.on('blur', () => w.close()) // a click anywhere else; the + again closes it too (floater.ts: open as the press began)
      w.on('closed', () => menu === w && ((menu = null), floater?.webContents.send('floater-menu', false)))
      w.webContents.on('did-finish-load', () => {
        if (barAt) (p => w.setPosition(p.x, p.y))(beside(MENU.width, menuH(), menuTop + 40 - (across() ? MENU.width : menuH()))) // its end by the +'s
        w.webContents.send('floats', floats) // the theme's colors
        w.show()
        w.focus() // its keys: 1-4, arrows, Esc
        floater?.webContents.send('floater-menu', true)
      })
      return
    }
    voice = w
    w.on('closed', () => voice === w && (voice = null))
    w.webContents.on('did-finish-load', () => {
      voiceTabs = new Set(floats.voiceTo === 'new' ? [] : floats.items.map(x => x.tab))
      w.webContents.send('voice', floats.voiceTo === 'new' ? [] : floats.items, floats.colors, floats.voiceTo) // always a new session: no agents to pick
      if (barAt) (p => w.setPosition(p.x, p.y))(beside(VOICE.width, VOICE.height, barLen() - (across() ? VOICE.width : VOICE.height))) // by the bar's end
      w.show()
      w.focus() // the key window without bringing Laki's own forward (a panel): dictation and the keys go to it
    })
  })
  if (dev) f.loadURL(`${new URL('floater.html', `${process.env.ELECTRON_RENDERER_URL}/`).href}#bar`)
  else f.loadFile(fileURLToPath(new URL('../renderer/floater.html', import.meta.url)), { hash: 'bar' })
  return f
}
// the drop against an edge of the screen it's on (its spot's, or the main one's when that's on no screen: a laptop
// undocked, home kept for its return): home's side, or, let go after a drag (to: the pointer), the edge nearest the
// pointer, left or right (the user's ask: never the top or bottom); inside the screen along it. The page is told the
// side. ponytail: the row on top or bottom (across) stays in the code, unreached. animate: after a drag
function snap(animate = false, len = barLen(), to?: { x: number; y: number }) {
  if (!floater) return
  const at = home ?? { x: Infinity, y: 0 }
  const [w0, h0] = floater.getSize()
  const c = to ?? { x: at.x + w0 / 2, y: at.y + h0 / 2 } // what decides the screen (and, after a drag, the edge)
  const on = screen.getAllDisplays().find(({ bounds: b }) => c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height)
  const d = (on ?? screen.getPrimaryDisplay()).workArea
  const was = across()
  if (!on) side = 'right'
  else if (to) {
    side = c.x - d.x < d.x + d.width - c.x ? 'left' : 'right'
  } else side = home?.side ?? (c.x > d.x + d.width / 2 ? 'right' : 'left') // an older floater.json's: the nearer side
  const turned = !!to && across() !== was // dragged to an edge the other way: centered where it was let go
  if (!on) barAt = { x: d.x + d.width - BAR, y: d.y + Math.round(d.height * 0.6) }
  else if (across()) barAt = { x: clamp(turned ? at.x + w0 / 2 - len / 2 : at.x, d.x, d.x + d.width - len), y: side === 'bottom' ? d.y + d.height - BAR : d.y }
  else barAt = { x: side === 'right' ? d.x + d.width - BAR : d.x, y: clamp(turned ? at.y + h0 / 2 - len / 2 : at.y, d.y, d.y + d.height - len) }
  floater.setBounds({ ...barAt, ...sized(len) }, animate)
  floater.webContents.send('floater-side', side)
}
app.whenReady().then(() => screen.on('display-removed', () => snap()))
function placeFloater() {
  // hidden: the + closes too, its stack or menu (a hidden panel's page gets no visibilitychange)
  if ((!floats.items.length && !floats.add) || front || parked || shooting) return void (floater?.isVisible() && floater.webContents.send('floater-menu', false), floater?.hide(), card?.hide(), menu?.close(), (hover = null))
  if (!floater) {
    try {
      barAt = home ??= JSON.parse(readFileSync(floaterFile(), 'utf8'))
      if (home && !['left', 'right'].includes(home.side as string)) delete home.side // an older file's, or a row's on top or bottom: left or right, by where it is
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
    menu: o.menu === 'card' ? 'card' : 'stack',
    voiceTo: o.voiceTo === 'new' ? 'new' : 'pick',
    doneAlert: o.doneAlert !== false,
    ai: o.ai === true,
  }
  if (!floats.cards && hover?.tab !== TIP) (hover = null), card?.hide()
  if (floats.menu !== 'card' || !floats.add) menu?.close()
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
  for (const f of [floater, card, menu, voice]) if (f && !f.isDestroyed()) add(f.webContents.getOSProcessId(), 'Floating bubbles', 'floater') // one process (the bar's window.open), one row
  if (annot && !annot.isDestroyed()) add(annot.webContents.getOSProcessId(), 'Screenshot editor')
  if (newWin && !newWin.isDestroyed()) add(newWin.webContents.getOSProcessId(), 'New workspace window')
  if (aiW && !aiW.isDestroyed()) add(aiW.webContents.getOSProcessId(), 'Laki AI window')
  for (const w of tabWins.values()) if (!w.isDestroyed()) add(w.webContents.getOSProcessId(), 'Floating tab')
  return out
})
ipcMain.on('proc-stop', (e, what: unknown) => {
  if (e.sender !== win?.webContents || typeof what !== 'string') return
  if (what === 'floater') {
    parked = floatState()
    hover = null
    for (const f of [floater, card, menu, voice]) if (f && !f.isDestroyed()) f.destroy()
  } else if (what.startsWith('browse:')) {
    const a = agentWins.get(what.slice(7))
    if (!a) return
    clearTimeout(a.idle)
    agentWins.delete(what.slice(7))
    if (!a.w.isDestroyed()) a.w.destroy()
  }
})
// its length along the edge (a height; on top or bottom, a width), kept on screen (a drag may be under way); the same:
// nothing, a snap's animation goes on. up: the stack opened or closed, the drop grows or shrinks upward (leftward in a
// row), so the + stays under the mouse
ipcMain.on('floater-size', (e, len: number, up?: boolean) => {
  if (!floater || e.sender !== floater.webContents || !(len > 0 && len < 2400)) return
  const [was, now] = [barLen(), Math.round(len)]
  if (now === was) return
  if (dragFrom) return (s => floater!.setSize(s.width, s.height))(sized(now))
  if (up && barAt && now > was) {
    stackFrom ??= home ?? { ...barAt, side }
    const d = screen.getDisplayNearestPoint(barAt).workArea // on its screen: snap finds it
    home = across() ? { x: Math.max(d.x, barAt.x + was - now), y: barAt.y, side } : { x: barAt.x, y: Math.max(d.y, barAt.y + was - now), side }
  } else if (up && stackFrom) (home = stackFrom), (stackFrom = null) // not saved: a drag saves where it is
  snap(false, now)
})
ipcMain.on('floater-open', (e, tab: string) => floater && e.sender === floater.webContents && typeof tab === 'string' && (app.focus({ steal: true }), show(tab)))
// the +'s actions, from the stack in the drop or the menu beside it: New task (the new-workspace page, in a window of its
// own), Ask Laki AI (the AI page, in one too), the menu bar's screenshots; Say it from the menu: the bar opens its window
// (the stack's opens it itself)
ipcMain.on('floater-act', (e, what: unknown) => {
  if (!(floater && e.sender === floater.webContents) && !(menu && e.sender === menu.webContents)) return
  menu?.close()
  if (what === 'new') newWsWin()
  else if (what === 'ai' && floats.ai) aiWin()
  else if (what === 'area') screenshot(true)
  else if (what === 'screen') screenPick()
  else if (what === 'mic') floater?.webContents.send('floater-voice')
})
ipcMain.on('floater-menu-at', (e, top: unknown) => floater && e.sender === floater.webContents && typeof top === 'number' && Number.isFinite(top) && (menuTop = top))
ipcMain.on('floater-menu-close', e => (e.sender === floater?.webContents || e.sender === menu?.webContents) && menu?.close())

// the bubbles' +, the menu bar's New Workspace… and a voice prompt for a new session: the new-workspace page alone (the renderer's ?window=new), in a
// panel over every app, Space and full-screen app, so the app you're in (and Laki's own window) stays where it is. One
// at a time: another + brings it up, a prompt fills it. As tall as the page (new-fit). It closes once the workspace is
// made, or on Esc.
let newWin: BrowserWindow | null = null
function newWsWin(prompt?: string) {
  if (newWin && !newWin.isDestroyed()) {
    if (prompt) newWin.webContents.send('new-prompt', prompt)
    return void newWin.focus()
  }
  const w = (newWin = panelWin({ window: 'new', ...(prompt && { prompt }) }, 640, 340, { minWidth: 480, minHeight: 200 })) // then new-fit: as tall as the page
  w.on('closed', () => newWin === w && (newWin = null))
}
// the bubbles' Ask Laki AI: the AI page alone (?window=ai), a chat in a panel like the new-workspace one; one at a time
let aiW: BrowserWindow | null = null
function aiWin() {
  if (aiW && !aiW.isDestroyed()) return void aiW.focus()
  const w = (aiW = panelWin({ window: 'ai' }, 560, 680, { minWidth: 420, minHeight: 360 }))
  w.on('closed', () => aiW === w && (aiW = null))
}
// a tab floated out of the app (a tab's right click › Float in its own window): its terminal alone (?window=tab), in a
// panel over every app, Space and full-screen app, resizable; one per tab. Closing it (its ✕) puts it back: the app's
// pane, which says where it went meanwhile (floating), shows it again
const tabWins = new Map<string, BrowserWindow>()
const floating = () => win?.webContents.send('floating', [...tabWins.keys()])
ipcMain.handle('floating', () => [...tabWins.keys()])
ipcMain.on('tab-float', (e, tab: unknown, on: unknown) => {
  if (e.sender !== win?.webContents || typeof tab !== 'string' || !/^[\w-]{1,64}$/.test(tab)) return
  const had = tabWins.get(tab)
  if (on === false) return void had?.close()
  if (had && !had.isDestroyed()) return void had.focus()
  const w = panelWin({ window: 'tab', tab }, 720, 440, { minWidth: 320, minHeight: 160 })
  tabWins.set(tab, w)
  w.on('closed', () => tabWins.get(tab) === w && (tabWins.delete(tab), floating()))
  floating()
})

// a page of the renderer alone in a panel over every app, Space and full-screen app, in the middle of the screen the
// mouse is on, a third down
function panelWin(query: Record<string, string>, width: number, height: number, more: BrowserWindowConstructorOptions) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  ;[width, height] = [Math.min(width, d.width - 40), Math.min(height, d.height - 40)]
  const w = new BrowserWindow({
    x: Math.round(d.x + (d.width - width) / 2),
    y: Math.round(d.y + (d.height - height) / 3),
    width,
    height,
    ...more,
    type: 'panel', // an NSPanel: it takes the keyboard without bringing Laki forward
    frame: false, // the page's head is its title bar (a drag region)
    backgroundColor: '#0e1014',
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    acceptFirstMouse: true,
    show: false,
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  pin(w)
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', e => e.preventDefault()) // a dropped file would load in place, bridge and all
  w.once('ready-to-show', () => (w.show(), w.focus()))
  if (dev) w.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else w.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), { query })
  return w
}
// the new-workspace window's height, as the page grows or shrinks (More, images, a template's preview); its top stays
ipcMain.on('new-fit', (e, h: unknown) => {
  if (!newWin || newWin.isDestroyed() || e.sender !== newWin.webContents || typeof h !== 'number' || !Number.isFinite(h)) return
  const d = screen.getDisplayMatching(newWin.getBounds()).workArea
  newWin.setContentSize(newWin.getContentSize()[0], Math.round(Math.min(Math.max(h, 200), d.y + d.height - newWin.getBounds().y - 20)))
})
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
  newWsWin(text.trim())
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
    stackFrom = null // where it's let go is its place now
    const [x, y] = floater.getPosition()
    home = { x, y }
    snap(true, barLen(), screen.getCursorScreenPoint()) // the edge nearest where it's let go
    home = { ...barAt!, side }
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
// a stacked action's name and what it does, in the card's window beside it (cards on hover or not: the icons alone don't say)
const TIP = '\u0000tip' // never a tab id
ipcMain.on('floater-tip', (e, name: unknown, hint: unknown, top: unknown) => {
  if (!floater || e.sender !== floater.webContents || dragFrom || typeof name !== 'string' || typeof hint !== 'string' || !Number.isFinite(top)) return
  hover = !front && overBar() ? { tab: TIP, top: top as number } : null
  if (hover) card?.webContents.send('card', { tab: TIP, name: name.slice(0, 60), last: hint.slice(0, 120), status: 'tip' }, floats.colors)
  else card?.hide()
})
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
  card.setBounds({ ...beside(Math.round(w), Math.round(h), hover.top - 6), width: Math.round(w), height: Math.round(h) })
  card.showInactive()
})
// in front: one of Laki's own windows has the focus. A press on the drop makes Laki the active app too (its panel
// takes the click), so being active alone isn't it: the drop would hide under the pointer as a drag starts
const own = (w: BrowserWindow | null) => !!w && w !== floater && w !== card && w !== menu && w !== voice && w !== newWin && w !== aiW // the bubbles stay over another app while the new-workspace or AI window is up
const setFront = (on: boolean) => on !== front && ((front = on), placeFloater(), win?.webContents.send('front', on)) // the app window: its animations pause behind another app (App's away)
app.on('browser-window-focus', (_e, w) => own(w) && setFront(true))
app.on('did-become-active', () => setTimeout(() => setFront(own(BrowserWindow.getFocusedWindow())), 100)) // the focus comes after
app.on('did-resign-active', () => setFront(false))
if (!mac) app.on('browser-window-blur', () => setTimeout(() => setFront(own(BrowserWindow.getFocusedWindow())), 100)) // no did-resign-active there: none of Laki's windows has the focus

// the menu bar's screenshots: macOS's screencapture (a part: drag, or Space and a click for a window; Esc cancels; a
// screen: its rectangle, -R in the same global points as Electron's bounds; none: the main one), then the editor window
// (annotate) to draw on it, then the new-workspace page with it. Needs Screen Recording for Laki (macOS asks once).
// then: where the picture goes (the editor, unless a prompt asked for it: shoot); none: cancelled
function screenshot(part: boolean, on?: Electron.Rectangle, then: (png: string) => void = annotate, none = () => {}) {
  const file = join(tmpdir(), `laki-shot-${process.pid}-${Date.now()}.png`)
  const what = part ? ['-i'] : on ? [`-R${on.x},${on.y},${on.width},${on.height}`] : ['-m']
  shooting = true
  placeFloater() // the bubbles out of the picture, until it's taken or cancelled
  setTimeout(() => // the menu closes first, out of the picture
    execFile('screencapture', [...what, '-x', file], () => {
      shooting = false
      placeFloater()
      let png: string
      try {
        png = readFileSync(file).toString('base64')
      } catch {
        return none() // cancelled, or no permission: no file
      }
      rmSync(file, { force: true })
      then(png)
    }), 250)
}

// with more than one screen, which one: the one under the pointer first (the bubbles' menu, made as it opens), or the
// main one first (the menu bar's, made at the last badge: the pointer was elsewhere then). Its bounds as it's clicked
// (a resolution or arrangement may have changed since)
function screenItems(here?: Electron.Display): MenuItemConstructorOptions[] {
  const first = here ?? screen.getPrimaryDisplay()
  return [first, ...screen.getAllDisplays().filter(d => d.id !== first.id)].map((d, i) => ({
    label: `${d.label || `Screen ${i + 1}`}${here && d.id === here.id ? ' (this one)' : ''}`,
    sublabel: `${d.size.width}×${d.size.height}`,
    click: () => (now => now && screenshot(false, now.bounds))(screen.getAllDisplays().find(x => x.id === d.id)), // gone meanwhile: nothing
  }))
}
// the bubbles' Whole screen: one screen, at once; more, a menu at the pointer
function screenPick() {
  if (screen.getAllDisplays().length < 2) return screenshot(false)
  Menu.buildFromTemplate([{ label: 'Which screen?', enabled: false }, ...screenItems(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()))]).popup(floater && !floater.isDestroyed() ? { window: floater } : {})
}

// the screenshot's editor (annotate.html): a small window over the others to crop it, draw on it and say what to do
// with it; Add to prompt sends both to the new-workspace page, Esc drops them
let annot: BrowserWindow | null = null
function annotate(png: string) {
  annot?.destroy()
  const { width, height } = nativeImage.createFromBuffer(Buffer.from(png, 'base64')).getSize()
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) // the screen you're on, likely the one shot
  const a = d.workArea
  // the picture at its size in points with the page around it (annotate.html: the bar 46, the stage's padding 24, the
  // note 68); a whole screen's, or near it: the whole work area
  const [pw, ph] = [width / d.scaleFactor + 24, height / d.scaleFactor + 138]
  const big = pw > a.width * 0.8 || ph > a.height * 0.8
  const [ww, wh] = big ? [a.width, a.height] : [Math.round(Math.min(Math.max(pw, 760), a.width)), Math.round(Math.min(Math.max(ph, 400), a.height))]
  const w = (annot = new BrowserWindow({
    x: Math.round(a.x + (a.width - ww) / 2),
    y: Math.round(a.y + (a.height - wh) / 2),
    width: ww,
    height: wh,
    minWidth: 680, // the toolbar's icons and buttons in one row
    minHeight: 360,
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
// development mode's element picker: the app window's own pixels in a box (CSS pixels), a PNG in base64
ipcMain.handle('capture-rect', async (e, r: { x: unknown; y: unknown; width: unknown; height: unknown }) => {
  if (!win || e.sender !== win.webContents) throw new Error('not the app window')
  const [x, y, width, height] = [r?.x, r?.y, r?.width, r?.height].map(n => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0))
  if (!width || !height) throw new Error('nothing to capture')
  return (await win.webContents.capturePage({ x, y, width, height })).toPNG().toString('base64')
})
// a part of the screen for a prompt (the Desk's Build with AI): screenshot's, the PNG back in base64; null: cancelled
ipcMain.handle('shoot', e => (!win || e.sender !== win.webContents ? null : new Promise<string | null>(done => screenshot(true, undefined, done, () => done(null)))))
ipcMain.on('open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
  else if (typeof url === 'string' && url.startsWith('laki:')) openLink(url) // the AI window's link to a tab: the app window, there
})
// a terminal's ⌘-clicked file:// link (claude's paths), the app window's only: { rel } for a file inside root (the
// workspace: the app's preview), a folder in Finder, a document in its app; anything that could run (an app, a script, no
// extension) only shown in Finder. Links followed first: their target's name is what counts
const DOCS = /\.(md|markdown|txt|log|json|jsonl|ya?ml|toml|csv|tsv|xml|html?|pdf|png|jpe?g|gif|webp|svg|heic|mp4|mov|webm|mp3|m4a|wav)$/i
const BUNDLE = /\.(app|bundle|framework|plugin|kext|pkg|mpkg|prefpane|workflow|action|saver|appex)\/?$/i
ipcMain.handle('open-path', async (e, path: unknown, root: unknown) => {
  const from = (win && e.sender === win.webContents) || [...tabWins.values()].some(w => !w.isDestroyed() && w.webContents === e.sender) // the app's window, or a floated tab's
  if (!from || typeof path !== 'string' || !path.startsWith('/')) return 'missing'
  const real = await realpath(path).catch(() => '')
  const st = real && (await stat(real).catch(() => null))
  if (!st) return 'missing'
  const top = typeof root === 'string' && root.startsWith('/') ? await realpath(root).catch(() => '') : ''
  if (st.isFile() && top && real.startsWith(`${top}/`)) return { rel: real.slice(top.length + 1) }
  if (st.isDirectory() ? !BUNDLE.test(real) : st.isFile() && DOCS.test(real)) await shell.openPath(real)
  else shell.showItemInFolder(real)
  return 'opened'
})

// an artifact to the clipboard (the app window's, right click › Copy): a picture as a picture, any other file as the file
// itself (Finder, Slack and mail paste it); its text the renderer copies on its own
const PICS = /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i
ipcMain.handle('copy-file', async (e, path: unknown) => {
  if (!win || e.sender !== win.webContents || typeof path !== 'string' || !path.startsWith('/')) return 'missing'
  const real = await realpath(path).catch(() => '')
  if (!real || !(await stat(real).catch(() => null))?.isFile()) return 'missing'
  const img = PICS.test(real) ? nativeImage.createFromPath(real) : null
  if (img && !img.isEmpty()) return (await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]), 'image')
  if (mac) await clipboard.write([new ClipboardItem({ 'electron application/osclipboard;format="public.file-url"': pathToFileURL(real).href })]) // what Finder's Copy puts there
  else await clipboard.writeText(real) // ponytail: off macOS, its path
  return 'file'
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

// the renderer owns ⌘W/⌘N/⌘T/⌘K…: the menu shows each key without registering it (the key still goes to App's
// keys), and a click sends it there as browser-key, as a Browsers page does
// ponytail: Toggle Sidebar has one title; Show/Hide by its state would need the renderer to rebuild the menu
const key = (label: string, accelerator: string, k: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  registerAccelerator: false,
  click: () => (show(), win?.webContents.send('browser-key', k)),
})
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => openLink('laki://about') }, // the renderer's: with the website
        { type: 'separator' },
        key('Settings…', 'CmdOrCtrl+,', ','),
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
        key('New Workspace…', 'CmdOrCtrl+N', 'n'),
        key('New Tab', 'CmdOrCtrl+T', 't'),
        key('Open Project Folder…', 'CmdOrCtrl+O', 'o'),
        { type: 'separator' },
        key('Go to File…', 'CmdOrCtrl+P', 'p'),
        key('Open in Editor', 'CmdOrCtrl+E', 'e'),
        { type: 'separator' },
        key('Close Tab', 'CmdOrCtrl+W', 'w'),
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
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        key('Find…', 'CmdOrCtrl+F', 'f'),
      ],
    },
    {
      label: 'View',
      submenu: [
        key('Toggle Sidebar', 'CmdOrCtrl+B', 'b'),
        key('Workspace Info', 'CmdOrCtrl+I', 'i'),
        key('Changes', 'CmdOrCtrl+D', 'd'),
        { type: 'separator' },
        key('Command Palette…', 'CmdOrCtrl+K', 'k'),
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
        key('Next That Needs You', 'CmdOrCtrl+J', 'j'),
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
        key(`${app.name} Help`, 'CmdOrCtrl+/', '/'),
        { label: 'Get Started Again…', click: () => openLink('laki://onboard') }, // the first steps, after Don't show again too
      ],
    },
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
