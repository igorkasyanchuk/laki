// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links, laki:// links,
// the preview pane's webview (localhost only) and its screenshots.
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell, webContents } from 'electron'
import { appendFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureDaemon, rpc } from '../shared/conn.ts'
import type { View } from '../shared/types.ts'

const dev = !!process.env.ELECTRON_RENDERER_URL
let win: BrowserWindow | null = null
let pendingTab: string | null = null
let quitting = false
let link: string | null = null // a laki:// link that came before the renderer listened
let linkReady = false // the renderer listens for links

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
ipcMain.on('deep-link-ready', () => {
  linkReady = true
  if (link) win?.webContents.send('deep-link', link)
  link = null
})
// the preview pane's <webview>: a page on this Mac, in its own session, without node or a preload (and, with no
// allowpopups, without popups)
const PREVIEW = 'persist:preview'
const local = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true })
    if (!local(params.src) || params.partition !== PREVIEW) e.preventDefault()
  })
})
// Electron grants a page every permission by default: the preview (which links can take anywhere) gets none of the
// sensitive ones (camera, microphone, location, clipboard reads, notifications…)
const PREVIEW_OK = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
app.whenReady().then(() => {
  const s = session.fromPartition(PREVIEW)
  s.setPermissionRequestHandler((_wc, perm, cb) => cb(PREVIEW_OK.has(perm)))
  s.setPermissionCheckHandler((_wc, perm) => PREVIEW_OK.has(perm))
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
      webviewTag: true, // the preview pane; will-attach-webview keeps it to localhost
    },
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  // closing hides: the renderer keeps posting notifications for agents while the app runs windowless
  win.on('close', e => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => ((win = null), (linkReady = false), app.dock?.setBadge(''))) // the badge's count came from the window
  win.webContents.on('did-start-navigation', e => e.isMainFrame && !e.isSameDocument && (linkReady = false)) // a reload: links wait for the new page
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
// sound: a macOS sound's name (Settings › General), 'none', or unset: the default. actions: buttons (a permission
// prompt's Allow and Deny; macOS shows them with the Alerts style, under Options with Banners): Allow picks the menu's
// first choice, Deny its last, straight through the daemon (the window may be closed by then). Kept until used or
// closed: a collected Notification's events never come
const notes = new Set<Notification>()
ipcMain.on('notify', (_e, title: string, body: string, tab: string, sound?: string, actions?: string[]) => {
  if (process.env.LAKI_NOTIFY_LOG) appendFileSync(process.env.LAKI_NOTIFY_LOG, JSON.stringify({ title, body, tab, sound, actions }) + '\n') // smoke tests
  const named = typeof sound === 'string' && /^[A-Za-z]+$/.test(sound) && sound !== 'none'
  const buttons = Array.isArray(actions) ? actions.filter(a => typeof a === 'string').slice(0, 2) : []
  const n = new Notification({ title, body, silent: sound === 'none', ...(named && { sound }), actions: buttons.map(text => ({ type: 'button' as const, text })) })
  const done = () => notes.delete(n)
  n.on('click', () => (done(), show(tab)))
  n.on('action', (_ev, i) => (done(), rpc('answer', { tab, pick: i === 0 ? 'first' : 'last' }).catch(() => show(tab)))) // it moved on: look
  n.on('close', done)
  notes.add(n)
  if (notes.size > 50) notes.delete(notes.values().next().value!) // ponytail: the oldest go; Notification Center keeps them for days
  n.show()
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
// the Dock icon's count: agents waiting for you or done while you looked away (none: no badge)
ipcMain.on('badge', (_e, n: number) => app.dock?.setBadge(Number.isInteger(n) && n > 0 ? String(n) : ''))
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

// Quit Completely: the daemon too, so every agent stops (they resume when the app opens again)
async function quitCompletely() {
  const v = await rpc<View>('state', {}, 3000).catch(() => null)
  const n = v?.tabs.filter(t => t.status === 'running').length ?? 0
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
