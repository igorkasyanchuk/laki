// screenshots: the menu bar's (macOS's screencapture, a part or a screen, the bubbles out of it: shooting), the editor
// window to draw on one (annotate), a part for a prompt (shoot), the preview's and a page's (capture, page-shot,
// wholePage, capture-rect); each IPC handler checks its sender
import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, screen, webContents } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { floater, placeFloater } from './floater.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { from, pageURL, quickW, sendShot, show, win } from './index.ts'

export let shooting = false // a screenshot under way: the drop and its card stay out of it
// the menu bar's screenshots: macOS's screencapture (a part: drag, or Space and a click for a window; Esc cancels; a
// screen: its rectangle, -R in the same global points as Electron's bounds; none: the main one), then the editor window
// (annotate) to draw on it, then the new-workspace page with it. Needs Screen Recording for Laki (macOS asks once).
// then: where the picture goes (the editor, unless a prompt asked for it: shoot); none: cancelled
export function screenshot(part: boolean, on?: Electron.Rectangle, then: (png: string) => void = annotate, none = () => {}) {
  if (shooting) return none() // one at a time: another would end with the bubbles back in its picture
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
export function screenItems(here?: Electron.Display): MenuItemConstructorOptions[] {
  const first = here ?? screen.getPrimaryDisplay()
  return [first, ...screen.getAllDisplays().filter(d => d.id !== first.id)].map((d, i) => ({
    label: `${d.label || `Screen ${i + 1}`}${here && d.id === here.id ? ' (this one)' : ''}`,
    sublabel: `${d.size.width}×${d.size.height}`,
    click: () => (now => now && screenshot(false, now.bounds))(screen.getAllDisplays().find(x => x.id === d.id)), // gone meanwhile: nothing
  }))
}
// the bubbles' Whole screen: one screen, at once; more, a menu at the pointer
export function screenPick() {
  if (screen.getAllDisplays().length < 2) return screenshot(false)
  Menu.buildFromTemplate([{ label: 'Which screen?', enabled: false }, ...screenItems(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()))]).popup(floater && !floater.isDestroyed() ? { window: floater } : {})
}

// the screenshot's editor (annotate.html): a small window over the others to crop it, draw on it and say what to do
// with it; Add to prompt sends both to the new-workspace page, Esc drops them
export let annot: BrowserWindow | null = null
let annotTo: 'app' | 'quick' = 'app' // where its picture goes: the new-workspace page, or back to the quick bar (Q7)
const quickBack = () => quickW && !quickW.isDestroyed() && (quickW.show(), quickW.focus())
export function annotate(png: string, to: 'app' | 'quick' = 'app') {
  annot?.destroy()
  annotTo = to
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
  w.on('closed', () => (annot === w && (annot = null), to === 'quick' && quickBack())) // the bar back, even when another editor took this one's place
  w.loadURL(pageURL('annotate.html'))
}
ipcMain.on('annotate-done', (e, png: unknown, note: unknown) => {
  if (!annot || e.sender !== annot.webContents || typeof png !== 'string') return
  annot.destroy()
  if (annotTo === 'quick' && quickW && !quickW.isDestroyed()) return void (quickW.webContents.send('quick-tell', { png, note: typeof note === 'string' ? note.slice(0, 4000) : '', edited: true }), quickBack())
  const s: [string, string] = [png, typeof note === 'string' ? note.slice(0, 4000) : '']
  sendShot(s)
  show()
})
ipcMain.on('annotate-cancel', e => annot && e.sender === annot.webContents && annot.destroy())

// the preview pane's screenshot: a webview of this window's (the app window's, or the side panel's own window's), as a
// PNG in base64
ipcMain.handle('capture', async (e, id: number) => {
  if (!from(e, 'panel')) throw new Error('not the app window or the side panel')
  const wc = webContents.fromId(id)
  if (!wc || wc.getType() !== 'webview' || wc.hostWebContents !== e.sender) throw new Error('no such preview')
  const img = await wc.capturePage()
  if (img.isEmpty()) throw new Error('nothing on screen to capture yet')
  return img.toPNG().toString('base64')
})
// a Browsers page's screenshot (its toolbar's camera): what's in sight, or the whole page; copied, or saved in Downloads
// as <host>-<date>-<time>.png (its path back)
ipcMain.handle('page-shot', async (e, id: number, whole: unknown, save: unknown) => {
  if (!win || e.sender !== win.webContents) throw new Error('not the app window')
  const wc = webContents.fromId(id)
  if (!wc || wc.getType() !== 'webview' || wc.hostWebContents !== e.sender) throw new Error('no such page')
  const img = whole ? await wholePage(wc) : await wc.capturePage()
  if (img.isEmpty()) throw new Error('nothing on screen to capture yet')
  if (!save) return await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]), ''
  const host = (() => {
    try {
      return new URL(wc.getURL()).hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '')
    } catch {
      return ''
    }
  })() || 'page'
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `${host}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  let path = join(app.getPath('downloads'), `${name}.png`)
  for (let n = 2; existsSync(path); n++) path = join(app.getPath('downloads'), `${name}-${n}.png`)
  writeFileSync(path, img.toPNG())
  return path
})
// the whole page, past what's in sight, through DevTools' protocol. ponytail: 16384 device pixels tall at most (a longer
// page is cut there); with its DevTools open, attach throws: said
async function wholePage(wc: Electron.WebContents) {
  const d = wc.debugger
  try {
    d.attach('1.3')
  } catch {
    throw new Error('close its developer tools first: they hold the page')
  }
  try {
    const m = await d.sendCommand('Page.getLayoutMetrics')
    const size = m.cssContentSize ?? m.contentSize
    const dpr = m.visualViewport?.clientWidth && m.cssVisualViewport?.clientWidth ? m.visualViewport.clientWidth / m.cssVisualViewport.clientWidth : 1 // Retina: 2
    const clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), Math.floor(16384 / dpr)), scale: 1 } // past the GPU's 16384: tiles repeat
    const r = await d.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
    return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'))
  } finally {
    d.detach()
  }
}
// development mode's element picker: the app window's own pixels in a box (CSS pixels), a PNG in base64
ipcMain.handle('capture-rect', async (e, r: { x: unknown; y: unknown; width: unknown; height: unknown }) => {
  if (!win || e.sender !== win.webContents) throw new Error('not the app window')
  const [x, y, width, height] = [r?.x, r?.y, r?.width, r?.height].map(n => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0))
  if (!width || !height) throw new Error('nothing to capture')
  return (await win.webContents.capturePage({ x, y, width, height })).toPNG().toString('base64')
})
// a part of the screen for a prompt (the Desk's Build with AI): screenshot's, the PNG back in base64; null: cancelled
ipcMain.handle('shoot', e => (!win || e.sender !== win.webContents ? null : new Promise<string | null>(done => screenshot(true, undefined, done, () => done(null)))))
