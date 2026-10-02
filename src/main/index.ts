// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links.
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureDaemon } from '../shared/conn.ts'

const dev = !!process.env.ELECTRON_RENDERER_URL
let win: BrowserWindow | null = null
let pendingTab: string | null = null

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => show())

const daemon = () =>
  ensureDaemon({
    ELECTRON_RUN_AS_NODE: '1',
    WBS_FROM_APP: '1',
    ...(dev ? { WBS_DEV_ORIGIN: new URL(process.env.ELECTRON_RENDERER_URL!).origin } : {}),
  })

function create() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0e1014',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.on('closed', () => (win = null))
  win.webContents.on('did-finish-load', () => {
    if (pendingTab) win?.webContents.send('focus-tab', pendingTab)
    pendingTab = null
    // WBS_CAPTURE=<file.png>: a screenshot of the window 3s after load (checks a build without screen access)
    const out = process.env.WBS_CAPTURE
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
  const { port, token } = await daemon()
  return { port, token }
})
ipcMain.on('notify', (_e, title: string, body: string, tab: string) => {
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => show(tab))
  n.show()
})
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.on('open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
})

// no ⌘W/⌘N/⌘T/⌘K accelerators: the renderer owns those keys
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]),
)

app.whenReady().then(async () => {
  await daemon().catch(e => dialog.showErrorBox('wbs', `The daemon didn't start: ${e.message}`))
  create()
})
app.on('activate', () => show())
// macOS: the app (and always the daemon) keeps running without windows
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
