// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links, laki:// links,
// the preview pane's webview (localhost only) and its screenshots.
import { app, autoUpdater, BrowserWindow, type BrowserWindowConstructorOptions, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, net, Notification, protocol, screen, session, ShareMenu, shell, systemPreferences, Tray, webContents } from 'electron'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appToken, daemonInfo, dataDir, ensureDaemon, freshDaemon, logLine, NODE_API, pidRunning, pingStep, rpc, stopDaemon } from '../shared/conn.ts'
import { appOf, helperBin } from '../shared/helper.ts'
import { DROP_IMG, DROP_NO, DROP_TEXT_MAX, type DropFile, dropPayload, plainText } from '../shared/talk.ts'
import { keyFor } from '../shared/keys.ts'
import { veiled, type View } from '../shared/types.ts'
import { bulkPick, hotkeyAnswer } from '../shared/ask.ts'
import { CONFIRM, type ConfirmWhat } from '../shared/confirm.ts'
import { AGENT_BROWSER, APP_ORIGIN, APP_SCHEME, appFile, appPage as isAppPage, BROWSER, confirmAsk, dblClickAction, dragOk, externalOf, fromApp as senderOk, fromTokenPage, pageIs, PREVIEW, web, webviewOk, showAtLaunch  } from './guards.ts'
import { updater } from './update.ts'
import './agentBrowser.ts' // its IPC (browse): registered as it loads
import { guardFloat, pin, talk, voice } from './floater.ts'
import { annotate, screenshot } from './shots.ts'
import { addCard, type Card, cards, cardWin, dropCards, sendCards } from './cards.ts'
import { appMenu, keysNow, quietOn, tray, trayIcon, trayMenu, trayNow } from './menu.ts'
import { uiSmoke } from './smoke.ts'

// the app's binary doesn't run as node (its runAsNode fuse is off: docs/dev/helper.md), so a start that asks for it
// (an old launcher, `ELECTRON_RUN_AS_NODE=1 Laki x.js`, open --env) is this window process instead: it says so and ends
// here, before a window or a daemon. Laki Node runs what used to run here; never spawned from here for the caller, as its
// child would be Laki's to macOS (the responsible process) and keep Laki's privacy grants
if (process.env.ELECTRON_RUN_AS_NODE) {
  process.stderr.write("Laki: the app doesn't run scripts. Use the laki command (Settings › General › Command line) or Laki Node in its bundle.\n")
  process.exit(1)
}

// a dev build's: the page its windows load and the daemon's extra origin. An installed app takes neither from its
// environment (launchctl setenv reaches every launch), nor passes them on to the daemon and agents
if (app.isPackaged) delete process.env.ELECTRON_RENDERER_URL, delete process.env.LAKI_DEV_ORIGIN
delete process.env.LAKI_TAB_TOKEN // S12: opened from a Laki tab (open passes the environment on): the app's own calls are yours, not that tab's agent's
const dev = !!process.env.ELECTRON_RENDERER_URL
// the app's own pages, its windows' (built: app://laki/, nothing else serves one), not a site or a frame inside them
const devOrigin = dev ? new URL(process.env.ELECTRON_RENDERER_URL!).origin : ''
const appPage = (url: string | undefined) => isAppPage(url, devOrigin)
const sender = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => ({ type: e.sender.getType(), main: e.senderFrame === e.sender.mainFrame, url: e.senderFrame?.url })
export const fromApp = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => senderOk(sender(e), devOrigin)
// S9: the built pages on app://laki/ (out/renderer's files, nothing else; dev: the dev server's), a page by its file
// name and its query or hash: what each window loads
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true, stream: true } }])
export const RENDERER = fileURLToPath(new URL('../renderer/', import.meta.url))
export const pageURL = (file: string, more = '') => (dev ? `${new URL(file === 'index.html' ? '' : file, `${process.env.ELECTRON_RENDERER_URL}/`).href}${more}` : `${APP_ORIGIN}/${file}${more}`)
// from the app window, or one of the app's other pages by name: new (the new-workspace window), ai, tab (a floated
// tab: ?window=), voice (the bubbles' Say it); nothing else (a site in a webview, a frame, another window)
type Page = 'new' | 'ai' | 'tab' | 'voice' | 'quick' | 'inbox' | 'panel' // quick: the quick bar (Q1); inbox: the menu bar's Inbox (ask.html); panel: the side panel's window
export const from = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, ...pages: Page[]) =>
  fromApp(e) && ((!!win && e.sender === win.webContents) || pages.some(p => (p === 'voice' ? !!voice && e.sender === voice.webContents : pageIs(e.senderFrame?.url, p))))
// scripts/pack-smoke.sh's: a screenshot of the window 3s after load, the notifications as posted. Switches, not env:
// none reach a launch from Finder or the Dock
const capture = app.commandLine.getSwitchValue('laki-capture')
export const notifyLog = app.commandLine.getSwitchValue('laki-notify-log')
export const smoke = app.commandLine.getSwitchValue('laki-smoke') // R8: scripts/ui-smoke.ts' folder

let smoked = false // smoke.ts' walk started (once)

// trace once the window was gone. Errors that nothing caught are logged and the app goes on (Electron's default is a
// dialog with the stack); a helper process that died too
const appLog = (...a: unknown[]) => (console.error('laki:', ...a), logLine(join(dataDir(), 'app.log'), ...a))
process.on('uncaughtException', e => appLog('uncaught:', e))
process.on('unhandledRejection', e => appLog('unhandled rejection:', e))
app.on('child-process-gone', (_, d) => d.reason !== 'clean-exit' && appLog(`a ${d.type} process is gone (${d.reason}, ${d.exitCode}${d.name ? `, ${d.name}` : ''})`))

export const mac = process.platform === 'darwin' // elsewhere (Linux): the system's title bar, and closing the window quits (no Dock to bring it back)
export let win: BrowserWindow | null = null
let pendingTab: string | null = null
let quitting = false
let link: string | null = null // a laki:// link that came before the renderer listened
let linkReady = false // the renderer listens for links
let shot: [string, string] | null = null // a screenshot (a PNG, base64, and its note) from the menu bar, before the renderer listened
export let shotReady = false // the renderer listens for screenshots
let folders: string[] = [] // folders dropped on the Dock icon before the renderer listened (a cold launch: before ready)
let foldersReady = false // the renderer listens for them

// Laki.AppImage --headless … (Laki.app/Contents/MacOS/Laki too): laki serve on the bundle's helper (Electron's node,
// docs/dev/helper.md), before any
// window or display: a server's daemon and remote access, no app (docs/headless.md)
const headless = process.argv.indexOf('--headless')
if (headless > 0) {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url))
  const chromium = /^--(no-sandbox|disable-gpu[\w-]*|in-process-gpu|ozone-platform(-hint)?(=.*)?|enable-features=.*|disable-features=.*|user-data-dir=.*)$/ // a window's switches (the AppImage's --no-sandbox): none here, so not laki serve's
  const r = spawnSync(helperBin(process.execPath, existsSync), [cli, 'serve', ...process.argv.slice(headless + 1).filter(a => !chromium.test(a))], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LAKI_HEADLESS_PARENT: String(process.pid) } })
  process.exit(r.status ?? 1)
}

// S1: Chromium's debugger switches would hand any program the window's JavaScript, the app's token with it (the fuses
// cover node's --inspect only): a start with one ends here
if (['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address'].some(k => app.commandLine.hasSwitch(k))) app.exit(1)
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => show())
// laki://… (Info.plist names the scheme): the renderer routes it; it only selects and opens pages, never creates
export const openLink = (url: string) => {
  if (/^laki:\/\/quick\/?$/.test(url) && app.isReady()) return quickWin() // Q1: the quick bar, over the app you're in (it only opens: you type and send)
  if (linkReady && win) win.webContents.send('deep-link', url)
  else link = url
  if (app.isReady()) show()
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (url.startsWith('laki:')) openLink(url)
})
// a folder dropped on the Dock icon, or opened with Laki (Info.plist's folder document type): a project, added or
// opened by the renderer (as a drop on the window), the window in front
const sendFolders = () => {
  if (foldersReady && win && folders.length) win.webContents.send('open-folders', folders.splice(0))
  if (app.isReady()) show()
}
app.on('open-file', (e, path) => {
  e.preventDefault()
  folders.push(path)
  sendFolders()
})
ipcMain.on('folders-ready', e => {
  if (!from(e)) return
  foldersReady = true
  sendFolders()
})
// a picture for the window: now, else once it listens (shot-ready)
export const sendShot = (s: [string, string]) => (shotReady && win ? win.webContents.send('shot', ...s) : (shot = s))
ipcMain.on('shot-ready', e => {
  if (!from(e)) return
  shotReady = true
  if (shot) win?.webContents.send('shot', ...shot)
  shot = null
})
ipcMain.on('deep-link-ready', e => {
  if (!from(e)) return
  linkReady = true
  if (link) win?.webContents.send('deep-link', link)
  link = null
})
// the preview pane's <webview>: it starts on this Mac's localhost and can go to any website (the address bar, links),
// in its own session, without node or a preload (and, with no allowpopups, without popups)
// (PREVIEW, BROWSER, AGENT_BROWSER, local: guards.ts)
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
    if (!webviewOk(params.partition, params.src)) e.preventDefault()
  })
  // a Browsers page's link to a new tab opens in that page; a window.open popup (a sign-in's: Google, GitHub) gets a
  // small window of its own, in the same session with its opener kept, sandboxed, no node (else it can't hand back)
  wc.on('did-attach-webview', (_e, guest) => {
    // F5: the Preview's Pick (⌥⌘P, Settings › Keys' previewPick) while its page has the focus: the app's, not the page's
    if (guest.session === session.fromPartition(PREVIEW))
      guest.on('before-input-event', (e, i) => {
        if (i.type === 'keyDown' && keyFor({ key: i.key, code: i.code, metaKey: i.meta, ctrlKey: i.control, altKey: i.alt, shiftKey: i.shift }, keysNow) === 'previewPick') e.preventDefault(), wc.send('browser-key', 'previewPick')
      })
    if (guest.session !== session.fromPartition(BROWSER)) return
    // a page's script can call window.open in a loop (no click needed here): at most 5 new tabs or popups in 10 s
    let opened: number[] = []
    const tooMany = () => ((opened = [...opened.filter(t => Date.now() - t < 10000), Date.now()]), opened.length > 5)
    guest.setWindowOpenHandler(({ url, disposition }) => {
      if ((disposition === 'new-window' || disposition === 'foreground-tab' || disposition === 'background-tab') && tooMany()) return { action: 'deny' }
      if (disposition === 'new-window' && (web(url) || url === 'about:blank'))
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      // a new tab (a middle click or ⌘-click: in the background; target=_blank: in front) is a Browsers workspace of its
      // own, which the app makes (browser-tab); anything else loads here (a failed load shows in the page)
      if (web(url))
        disposition === 'background-tab' || disposition === 'foreground-tab' ? wc.send('browser-tab', url, disposition === 'foreground-tab') : guest.loadURL(url).catch(() => {})
      return { action: 'deny' }
    })
    // the popup itself opens no more windows: its links to a new one load in it
    guest.on('did-create-window', w => w.webContents.setWindowOpenHandler(({ url }) => (web(url) && w.webContents.loadURL(url).catch(() => {}), { action: 'deny' })))
    guest.on('context-menu', (_e, p) => (p.isEditable && (g.typed = true), pageMenu(guest, p, wc).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined }))) // a field's menu has Paste
    // what the memory budget mustn't unload (browser-guard), seen from here, not told by the page
    const g: Guest = { typed: false, media: 0, downloads: 0 }
    guests.set(guest, g)
    guest.on('did-navigate', () => ((g.typed = false), (g.media = 0))) // a new document: what was typed in the last one is gone anyway
    guest.on('media-started-playing', () => g.media++) // per player: one pausing leaves the others
    guest.on('media-paused', () => (g.media = Math.max(0, g.media - 1)))
    guest.on('before-input-event', (_e, i) => {
      if (i.type === 'keyDown' && !NOT_TYPING.test(i.key) && (!(i.meta || i.control) || /^[vxz]$/i.test(i.key))) g.typed = true // IME and dead keys too: uncertain counts
    })
    // new and close tab (⌘T, ⌘W: Settings › Keys') are the app's (open another page, close this one), not the page's:
    // it gets the keys while it has the focus
    guest.on('before-input-event', (e, i) => {
      const id = i.type === 'keyDown' ? keyFor({ key: i.key, code: i.code, metaKey: i.meta, ctrlKey: i.control, altKey: i.alt, shiftKey: i.shift }, keysNow) : undefined
      if (id === 'newTab' || id === 'closeTab') e.preventDefault(), wc.send('browser-key', id)
    })
  })
})
// the memory budget's guards (Settings › Resources; shared/browserBudget.ts). Anything uncertain holds the page: a typed
// key counts as an edit until it navigates, shortcuts too, and a check that fails or takes too long holds it.
// ponytail: the form check is the main frame's: a box ticked in a cross-origin frame with the mouse alone isn't seen
type Guest = { typed: boolean; media: number; downloads: number }
const NOT_TYPING = /^(Shift|Control|Alt|Meta|CapsLock|Tab|Escape|Arrow\w+|PageUp|PageDown|Home|End|F\d+)$/
const guests = new WeakMap<Electron.WebContents, Guest>()
const FORM_EDITED = `[...document.querySelectorAll('input,textarea,select')].some(e => e.tagName === 'SELECT' ? (e.multiple ? [...e.options].some(o => o.selected !== o.defaultSelected) : [...e.options].some(o => o.defaultSelected) ? !e.options[e.selectedIndex]?.defaultSelected : e.selectedIndex > 0) : e.type === 'checkbox' || e.type === 'radio' ? e.checked !== e.defaultChecked : e.type !== 'hidden' && e.value !== e.defaultValue)`
const ISOLATED = 1999 // a world of its own: the page's scripts can't reach what this reads or say what it returns
const guestOf = (id: unknown) => (wc => (wc && !wc.isDestroyed() && guests.has(wc) ? wc : undefined))(typeof id === 'number' ? webContents.fromId(id) : undefined)
// the guests' memory: each process once (pages can share one)
ipcMain.handle('browser-mem', (e, ids: unknown) => {
  if (e.sender !== win?.webContents || !Array.isArray(ids)) return null
  const pids = new Set(ids.map(guestOf).flatMap(wc => wc?.getOSProcessId() || []))
  return { kb: app.getAppMetrics().reduce((n, m) => n + (pids.has(m.pid) ? m.memory.workingSetSize : 0), 0) }
})
ipcMain.handle('browser-guard', async (e, id: unknown) => {
  if (e.sender !== win?.webContents) return 'can’t tell what it’s doing'
  const wc = guestOf(id)
  const g = wc && guests.get(wc)
  if (!wc || !g) return 'can’t tell what it’s doing'
  if (g.media || wc.isCurrentlyAudible()) return 'is playing'
  if (g.downloads) return 'is downloading'
  if (wc.debugger.isAttached() || wc.isDevToolsOpened()) return 'is being inspected or automated'
  if (g.typed) return 'has typing that may be unsaved'
  const edited = await Promise.race([wc.executeJavaScriptInIsolatedWorld(ISOLATED, [{ code: FORM_EDITED }]).catch(() => undefined), new Promise(r => setTimeout(r, 1500))])
  return edited === false ? undefined : edited ? 'has form edits' : 'can’t tell what it’s doing'
})
// a Browsers page's right click: its link, image, selection or field, back, forward, reload, and Inspect Element (the
// page's DevTools). ponytail: no spelling suggestions
function pageMenu(g: Electron.WebContents, p: Electron.ContextMenuParams, app: Electron.WebContents) {
  const items: MenuItemConstructorOptions[] = []
  const add = (...x: MenuItemConstructorOptions[]) => items.push(...x, { type: 'separator' })
  if (web(p.linkURL))
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
// a misspelled word right-clicked in the app's own windows (a spec, a note, any text box; Chromium's checker in macOS's
// languages): its suggestions, Learn, then the edit ones. Any other right click is the renderer's (its menus prevent it)
function spellMenu(wc: Electron.WebContents) {
  wc.on('context-menu', (_e, p) => {
    if (!p.isEditable || !p.misspelledWord) return
    const fix = p.dictionarySuggestions.slice(0, 6).map((w): MenuItemConstructorOptions => ({ label: w, click: () => wc.replaceMisspelling(w) }))
    Menu.buildFromTemplate([
      ...(fix.length ? fix : [{ label: 'No suggestions', enabled: false }]),
      { type: 'separator' },
      { label: `Learn “${p.misspelledWord}”`, click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: p.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste },
    ]).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined })
  })
}
// Electron grants a page every permission by default: the preview (which links can take anywhere) gets none of the
// sensitive ones (camera, microphone, location, clipboard reads, notifications…)
const PREVIEW_OK = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
app.whenReady().then(() => {
  for (const s of [session.fromPartition(PREVIEW), session.fromPartition(BROWSER), session.fromPartition(AGENT_BROWSER)]) {
    s.setPermissionRequestHandler((_wc, perm, cb) => cb(PREVIEW_OK.has(perm)))
    s.setPermissionCheckHandler((_wc, perm) => PREVIEW_OK.has(perm))
  }
  // the app's own session (its windows, and the frames in them: an extension's page, an artifact, the video): the
  // microphone (not the camera) and the fonts' names for its own pages (Settings › Voice's cloud, Appearance's font
  // lists), full screen and a clipboard write for any, nothing else
  const ok = (perm: string, url?: string, video?: boolean) => perm === 'fullscreen' || perm === 'clipboard-sanitized-write' || ((perm === 'media' && !video) || perm === 'local-fonts') && appPage(url) // local-fonts: Settings › Appearance's font lists
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(ok(perm, d.requestingUrl || wc.getURL(), 'mediaTypes' in d && !!d.mediaTypes?.includes('video'))))
  session.defaultSession.setPermissionCheckHandler((wc, perm, _origin, d) => ok(perm, d.requestingUrl || wc?.getURL(), d.mediaType === 'video'))
  // Browsers: Chrome's user agent without Laki's and Electron's names (sites that turn away an app's web view)
  const b = session.fromPartition(BROWSER)
  b.on('will-download', (_e, item, wc) => {
    const g = wc && guests.get(wc)
    if (!g) return
    g.downloads++
    item.once('done', () => g.downloads--)
  })
  b.setUserAgent((chromeUA = b.getUserAgent().replace(/ (laki|Laki|Electron)\/\S+/g, '')))
  // Google's sign-in: Firefox's user agent in the requests too, and none of Chrome's client hints (googleSignIn)
  b.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d, cb) =>
    cb({ requestHeaders: { ...Object.fromEntries(Object.entries(d.requestHeaders).filter(([k]) => !/^sec-ch-ua/i.test(k))), 'User-Agent': FIREFOX } }),
  )
  // the sidebar's video: YouTube's embed plays only with a Referer, and an app:// page sends none (its Error 153);
  // the app's id, as YouTube asks of apps
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (d, cb) =>
    cb({ requestHeaders: { ...d.requestHeaders, Referer: d.requestHeaders.Referer || 'https://dev.laki.app/' } }),
  )
  // PR authors' pictures (Info.tsx Avatar): GitHub says 5 minutes, then each one is asked again (a failure then hid it);
  // kept a day instead. A picture, not an API call: no rate limit either way
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://avatars.githubusercontent.com/*'] }, (d, cb) =>
    cb({ responseHeaders: { ...Object.fromEntries(Object.entries(d.responseHeaders ?? {}).filter(([k]) => k.toLowerCase() !== 'cache-control')), 'Cache-Control': ['public, max-age=86400'] } }),
  )
})

// S1: as the app: its token too (the user's), which only its windows get (conn)
const start = () =>
  ensureDaemon(
    {
      ELECTRON_RUN_AS_NODE: '1',
      LAKI_FROM_APP: '1',
      ...(dev ? { LAKI_DEV_ORIGIN: devOrigin } : {}),
    },
    true,
  )
// S9: a daemon from before app://laki (API 167, still running after an update) refuses the window's Origin, so the
// window never sees it's stale (App.tsx staleDaemon) to restart it: main does, once, as the window would (keep: the pty
// host's terminals go on). One the app before the update started refuses that shutdown (who's calling: this app's
// token isn't the one it was given), so it's stopped as the Restart button does (stopDaemon); without that the window
// stayed on the splash and Quit Laki Completely left the daemon running (0.49)
const ORIGIN_API = 167
let checked = false
async function daemon() {
  if (checked) return start()
  checked = true
  // a build with Laki Node: a daemon from before it (on the app's binary, its hooks on Laki Hook) too: conn.ts NODE_API
  return freshDaemon(start, helperBin(process.execPath, existsSync) !== process.execPath ? NODE_API : ORIGIN_API, appLog) // conn.ts: the decision and the stop, tested without the app
}
// S9: the built pages (out/renderer) on app://laki/, a file of that folder or a 404; other sessions (the preview,
// Browsers, the agent browser) have no app: scheme at all
function serveApp() {
  protocol.handle(APP_SCHEME, req => {
    const file = appFile(req.url, RENDERER)
    return file && statSync(file, { throwIfNoEntry: false })?.isFile() ? net.fetch(pathToFileURL(file).href) : new Response('not found', { status: 404 }) // a file: never a folder's listing
  })
}
// S9: localStorage (column widths, pins, review drafts, filters) moved from the file:// origin the window had to
// app://laki, once: read in a hidden window on an empty file:// page, written on one of app://laki's (a picture: no
// script of the app runs). A new install has nothing to move
let moving = false // its hidden window gone before the app's opens: no window-all-closed quit (Linux)
async function moveStorage() {
  const mark = join(app.getPath('userData'), 'storage-moved')
  if (dev || existsSync(mark)) return
  moving = true
  const blank = join(app.getPath('userData'), 'storage-moving.html')
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    writeFileSync(blank, '<!doctype html>')
    await w.loadFile(blank)
    const items: [string, string][] = await w.webContents.executeJavaScript('Object.entries(localStorage)')
    if (items.length) {
      await w.loadURL(`${APP_ORIGIN}/icon-192.png`)
      const n: number = await w.webContents.executeJavaScript(`(items => { let n = 0; for (const [k, v] of items) if (localStorage.getItem(k) === null) localStorage.setItem(k, v), n++; return n })(${JSON.stringify(items)})`)
      appLog(`localStorage moved to ${APP_ORIGIN}: ${n} of ${items.length} items`)
    }
    writeFileSync(mark, '')
  } catch (e) {
    appLog(`localStorage not moved: ${(e as Error).message}`)
  } finally {
    w.destroy()
    rmSync(blank, { force: true })
    setTimeout(() => (moving = false), 1000)
  }
}

// where the window was left (window.json in userData): its bounds out of maximized and full screen, and whether it
// was either. Only when they're on a screen still there (a monitor unplugged: maximized again, as the first start)
const winFile = () => join(app.getPath('userData'), 'window.json')
type WinAt = { x: number; y: number; width: number; height: number; max?: boolean; full?: boolean; float?: boolean }
let float = false // the Frosted design (glass IPC), kept beside the bounds: the first frame needs it, before the renderer has the settings
const lights = () => (float ? { x: 22, y: 20 } : { x: 14, y: 13 }) // inside the sidebar's panel, else centered in the 40px sidebar header
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
    writeFileSync(winFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized(), full: focusFull ?? win.isFullScreen(), float }))
  } catch {}
}
const keepWin = () => (clearTimeout(winSave), (winSave = setTimeout(saveWin, 500))) // a drag's moves: once it rests

function create(hidden = false) {
  const at = winAt()
  float = !!at?.float
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(at && { x: at.x, y: at.y, width: at.width, height: at.height }),
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0e1014',
    visualEffectState: 'followWindow', // as macOS's own windows: its material goes inactive with the window (the floating panels' stay active)
    // a see-through window from the start (macOS: the `glass` IPC's blur comes later, with a clear background): an opaque
    // one never clears what it drew where the page is see-through, so the sidebar kept copies of its earlier rows and of
    // the page that was over it, a translucent tint redrawn piled up to solid, and a view transition's fade took the
    // desktop behind the sidebar and the rail with it (seen only on the real screen: Chromium's own frames are right)
    ...(mac && { transparent: true }),
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: lights() } : { autoHideMenuBar: true }), // Alt shows the menu
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
    const place = () => (!at || at.max ? win?.maximize() : undefined, at?.full && win?.setFullScreen(true)) // either shows it
    if (hidden) return void win?.once('show', place) // opened at login: made, not shown (the Dock icon or the menu bar's Open shows it), placed then
    place()
    win?.show()
  })
  for (const e of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(e as 'resize', keepWin)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url) // a site, or a mail to write (widgets' links)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  spellMenu(win.webContents)
  // its renderer crashed or was killed (not a quit): loaded again, at most once a minute (a page that dies as it loads
  // isn't reloaded for good; View › Reload is still there)
  let gone = 0
  win.webContents.on('render-process-gone', (_, d) => {
    appLog(`the window's renderer is gone (${d.reason}, ${d.exitCode})`)
    if (quitting || d.reason === 'clean-exit' || !win || win.isDestroyed() || Date.now() - gone < 60_000) return
    gone = Date.now()
    win?.webContents.reload()
  })
  // R2: a hung renderer (not gone: no event above). After 10 s of it, asked once: wait on, or load the window again.
  // Agents are the daemon's: they keep running either way
  let hung: NodeJS.Timeout | undefined
  win.on('unresponsive', () => {
    appLog("the window isn't responding")
    hung ??= setTimeout(async () => {
      hung = undefined
      if (!win || win.isDestroyed()) return
      const r = await dialog.showMessageBox(win, { type: 'warning', message: "The window isn't responding", detail: 'Your agents keep running in the background. Reload restarts only this window.', buttons: ['Wait', 'Reload'], defaultId: 0, cancelId: 0 })
      if (r.response !== 1 || !win || win.isDestroyed()) return
      appLog('the window reloaded after a hang')
      gone = Date.now() // ours: not the crash handler's reload as well
      win.webContents.forcefullyCrashRenderer() // a hung page takes no reload
      win.webContents.reload()
    }, 10_000)
  })
  win.on('responsive', () => (clearTimeout(hung), (hung = undefined)))
  // closing hides: the renderer keeps posting notifications for agents while the app runs windowless
  win.on('close', e => {
    saveWin() // a move just before quitting isn't lost to the timer
    if (quitting || !mac) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => ((win = null), (focusFull = null), (linkReady = shotReady = foldersReady = false), app.dock?.setBadge(''), tray?.setTitle(''))) // the count came from the window
  win.webContents.on('did-start-navigation', e => {
    if (!e.isMainFrame || e.isSameDocument) return
    linkReady = shotReady = foldersReady = false // a reload: links wait for the new page
    if (focusFull !== null) win?.setFullScreen(focusFull) // and comes back out of full-screen mode, as it was before
    focusFull = null
  })
  win.webContents.on('did-finish-load', () => {
    if (pendingTab) win?.webContents.send('focus-tab', pendingTab)
    pendingTab = null
    // --laki-capture=<file.png>: a screenshot of the window 3s after load (checks a build without screen access)
    if (capture) setTimeout(async () => win && writeFileSync(capture, (await win.webContents.capturePage()).toPNG()), 3000)
    if (smoke && !smoked) (smoked = true), setTimeout(() => win && void uiSmoke(win, smoke), 1500) // once: the walk reloads the window itself (whats-new-once), and a second walk beside the first wrote over its result
  })
  win.loadURL(pageURL('index.html'))
}

// an achievement only main sees (shared/achievements.ts): App's earn, as for a call
export const earn = (id: 'hotkey' | 'bubble') => win?.webContents.send('earn', id)

export function show(tab?: string, panel?: 'changes') {
  if (!win) {
    pendingTab = tab ?? null
    create()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (tab) win.webContents.send('focus-tab', tab, panel)
}

// the global hotkey (Settings › General, ui.tsx keyLabel's text: ⌃⌥⌘L; '' none): Laki forward from any app. False:
// another app (or macOS) has those keys
const ACCEL_KEYS: Record<string, string> = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', '+': 'Plus' }
export const COMBO = /^(⌃?)(⌥?)(⇧?)(⌘?)(.+)$/
export const accel = (m: RegExpExecArray, cmd = mac ? 'Command' : 'Super') => [m[1] && 'Control', m[2] && 'Alt', m[3] && 'Shift', m[4] && cmd, ACCEL_KEYS[m[5]] ?? m[5]].filter(Boolean).join('+')
function accelOf(label: string) {
  const m = COMBO.exec(label)
  const mods = [m?.[1], m?.[2], m?.[4]].filter(Boolean).length
  // a key with one of ⌃ ⌥ ⌘ (⌘K, ⌥A) would be taken from every app: two of them, or one with Space or an F key
  if (!m || !mods || (mods < 2 && !/^(Space|F\d{1,2})$/.test(m[5]))) return ''
  return accel(m)
}
type Key = 'open' | 'shot' | 'quick' | 'tell' | 'talk' | 'allow' | 'deny' // allow, deny: the newest ask answered (hotAnswer); open: Laki forward; shot: Screenshot to Laki AI (shotAsk); quick: the quick bar (Q1); tell: show and tell (Q7, tellShot); talk: the talk pill (Q2, talk)
export const keys: Record<Key, string> = { open: '', shot: '', quick: '', tell: '', talk: '', allow: '', deny: '' } // what each holds
const wants: Record<Key, [string, () => void]> = { open: ['', show], shot: ['', show], quick: ['', show], tell: ['', show], talk: ['', show], allow: ['', show], deny: ['', show] } // what each asked for
export let shotOn = false // Screenshot to Laki AI is on (Settings › General): the menu bar has it too
function grab(which: Key) {
  const [a, fn] = wants[which]
  if (a === keys[which]) return
  if (keys[which]) globalShortcut.unregister(keys[which])
  keys[which] = ''
  try {
    if (a && !Object.values(keys).includes(a) && globalShortcut.register(a, fn)) keys[which] = a // never both on the same keys
  } catch {} // keys Electron can't name
}
function bindKey(which: Key, label: unknown, fn: () => void) {
  const a = typeof label === 'string' ? accelOf(label) : ''
  wants[which] = [a, fn]
  grab(which)
  for (const k of Object.keys(keys) as Key[]) if (k !== which) grab(k) // the keys another one asked for may be free now
  trayMenu() // its items show the keys
  return a ? keys[which] === a : !label // false: another app (or the other hotkey) has them, or they can't be a global hotkey
}
ipcMain.handle('hotkey', (e, label: unknown) => from(e) && bindKey('open', label, () => (app.focus({ steal: true }), show(), earn('hotkey'))))
// Screenshot to Laki AI's keys ('' none); false: it's off (no menu bar item either)
ipcMain.handle('shot-hotkey', (e, label: unknown) => from(e) && ((shotOn = label !== false), bindKey('shot', shotOn ? label : '', shotAsk)))
// Q1: the quick bar's keys ('' none: off until set, Settings › Keys)
ipcMain.handle('quick-hotkey', (e, label: unknown) => from(e) && bindKey('quick', label, () => quickWin()))
// Q7: show and tell's keys ('' none: off until set, Settings › General)
ipcMain.handle('tell-hotkey', (e, label: unknown) => from(e) && bindKey('tell', label, () => tellShot()))
// Q2: the talk key ('' none: off until set, Settings › Voice): the pill at the pointer, recording; again: it sends
ipcMain.handle('talk-hotkey', (e, label: unknown) => from(e) && bindKey('talk', label, () => talk()))
// Allow / Deny the newest ask from any app ('' none: off until set, Settings › General)
ipcMain.handle('answer-hotkey', (e, which: unknown, label: unknown) => from(e) && (which === 'allow' || which === 'deny') && bindKey(which, label, () => void hotAnswer(which === 'allow')))
// the newest waiting ask (by when it began waiting, as Needs you dates them), as a card on screen for HOT_MS with what
// will be answered; Esc meanwhile (a global Esc while it shows) cancels; then the cards' answer (first option: allow,
// last: deny). shared/ask.ts hotkeyAnswer refuses what only Laki's window answers (a risky or chained command, a
// question, a plan, a secret, a private workspace's in Recording mode): its card says so, nothing sent
const HOT_MS = 600
const HOT = 'hotkey:answer'
let hotGo: { t: NodeJS.Timeout } | null = null
let hotLook = false // a press reading the state: another meanwhile is dropped (both would answer, then cancel each other)
const hotDone = () => (hotGo && clearTimeout(hotGo.t), (hotGo = null), globalShortcut.isRegistered('Escape') && globalShortcut.unregister('Escape'))
async function hotAnswer(allow: boolean) {
  if (hotGo || hotLook) return // one at a time
  hotLook = true
  const v = await rpc<View>('state').catch(() => null)
  hotLook = false // from here to hotGo, nothing waits
  if (!v) return
  const t = v.tabs.filter(x => x.status === 'waiting' && x.ask).sort((a, b) => (b.needAt ?? 0) - (a.needAt ?? 0))[0]
  const at = Date.now()
  const mine = (c: Card) => c.key === HOT && c.at === at // this press's card (a later press's replaces it)
  const card = (c: Partial<Card>, ms: number) => (addCard({ key: HOT, tab: '', ask: false, tone: 'info', at, title: '', body: '', actions: [], ...c }), setTimeout(() => dropCards(x => !mine(x)), ms))
  if (!t) return card({ title: 'Nothing is waiting' }, 1500)
  const hidden = !veiled(v).tabs.some(x => x.id === t.id)
  const r = hotkeyAnswer(t, hidden)
  const w = v.workspaces.find(x => x.id === t.workspace)
  const line = `${t.ask!.tool ?? ''}${t.ask!.what ? `: ${t.ask!.what.split('\n')[0].slice(0, 160)}` : t.ask!.question ? `: ${t.ask!.question.split('\n')[0].slice(0, 160)}` : ''}`
  if (r !== 'allow') return card(hidden ? { title: 'An agent is waiting', body: 'Open Laki to answer this one' } : { tab: t.id, tone: 'ask', title: `${w?.name ?? t.workspace} · ${t.name}`, body: `Open Laki to answer this one (${r.slice(7)}).\n${line}` }, 4000)
  const opt = bulkPick(t.ask!, allow)! // hotkeyAnswer's allow: a plain yes … no, never a standing permission
  addCard({ key: HOT, tab: t.id, ask: false, tone: 'ask', at, title: `${allow ? 'Allow' : 'Deny'}: ${w?.name ?? t.workspace} · ${t.name}`, body: `${line}\nEsc: don't`, actions: [] })
  try {
    globalShortcut.register('Escape', () => (hotDone(), dropCards(c => !mine(c))))
  } catch {} // another app holds Esc: the card's own Esc then
  hotGo = {
    t: setTimeout(() => {
      hotDone()
      if (!cards.some(mine)) return // its × meanwhile: not answered
      rpc('answer', { tab: t.id, n: opt.n, label: opt.label }).then(
        () => dropCards(c => !mine(c)),
        (err: Error) => (c => c && ((c.error = `${err.message}: open its tab`), sendCards()))(cards.find(mine)),
      )
    }, HOT_MS),
  }
}
app.on('will-quit', () => globalShortcut.unregisterAll())

// updates (./update.ts): its state to the app window as it changes. Installing quits for good: quitAndInstall emits
// autoUpdater's before-quit-for-update, not app's before-quit, ahead of closing the windows, whose close would only hide them
export const updates = updater(s => win?.webContents.send('update', s))
autoUpdater.on('before-quit-for-update', () => (quitting = true))
ipcMain.handle('update', (e, op: unknown) =>
  !from(e) ? null : op === 'check' ? updates.check() : op === 'download' ? updates.download() : op === 'install' ? updates.install() : op === 'skip' ? updates.skip() : op === 'pass' ? updates.pass() : op === 'unpass' ? updates.pass(false) : updates.state(),
)
// Settings' Check for updates and Update delay (days)
ipcMain.on('update-auto', (e, on: unknown, days: unknown) => from(e) && updates.auto(on === true, typeof days === 'number' && days > 0 && days <= 365 ? days : 0))

// the stale-daemon bar's Restart when the daemon refuses this window's shutdown: one another Laki started (another
// bundle's path: appPair gives the app's token to its own binary only, S1), so it can't tell this app is the user's.
// This app asks it to stop as any of the user's processes can (SIGTERM: its own shutdown), then starts one from this
// bundle. Only daemon.json's pid, and only while that pid is a Laki daemon
const running = pidRunning // conn.ts' stopDaemon: a Laki daemon stopped by SIGTERM (the Restart button's, a daemon from before an update, Quit Laki Completely's)
ipcMain.handle('daemon-restart', async (e, hung?: unknown) => {
  if (!from(e) || quitting) return false
  const pid = daemonInfo()?.pid
  if (!pid || !(await stopDaemon(pid, hung === true))) return false
  await daemon()
  return true
})
// a hung daemon: pinged every 5 s while a window is open (2 s to answer: any answer counts, a refusal too); 3 misses in
// a row tell the window (daemon-hung, again each miss after: a reloaded page hears it), the next answer clears it. No
// restart of its own: the window's Restart is a click. None while no daemon runs (gone isn't hung: the window reconnects)
let pings = { misses: 0, hung: false }
setInterval(async () => {
  if (!win || win.isDestroyed() || quitting) return
  const info = daemonInfo()
  const answered = !info || !pidRunning(info.pid) || (await fetch(`http://127.0.0.1:${info.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${info.token}` }, body: JSON.stringify({ method: 'ping', params: {} }), signal: AbortSignal.timeout(2000) }).then(r => (void r.body?.cancel().catch(() => {}), true), () => false))
  const next = pingStep(pings.misses, answered)
  if (next.hung || pings.hung) win?.webContents.send('daemon-hung', next.hung)
  if (next.hung && !pings.hung) appLog(`the daemon (pid ${info?.pid}) hasn't answered ${next.misses} pings in a row`)
  pings = next
}, 5000).unref()
ipcMain.handle('conn', async e => {
  if (!fromTokenPage(sender(e), devOrigin)) throw new Error('not the app') // the token: index.html's pages only (S9: not a card's, the bubbles' or the editor's)
  if (quitting) throw new Error('quitting') // after Quit Completely: no new daemon
  const { port, token } = await daemon()
  return { port, token: appToken() ?? token } // S1: the app's; daemon.json's only when it couldn't be had (its calls that ask who are refused)
})

// Touch ID (shared/confirm.ts, Settings › General): the app window asks for one of CONFIRM's actions; main prompts with
// that action's words and, once it passes, has the daemon mint a ticket for it (main's own call: the daemon checks its
// process, appPeer), which the window's call carries. null: no Touch ID here, cancelled, or failed
const touchCan = () => mac && systemPreferences.canPromptTouchID()
ipcMain.handle('touch-id', async e => fromApp(e) && !!win && e.sender === win.webContents && touchCan() && !!(await rpc<{ caps?: string[] }>('ping', { caps: true }).catch(() => undefined))?.caps?.includes('touch.id')) // and a daemon that holds the calls (API 184)
let touchOpen = false // its prompt is up: a drop on the menu bar's item waits (Q12)
ipcMain.handle('confirm', async (e, what: unknown) => {
  if (!confirmAsk(sender(e), !!win && e.sender === win.webContents, what, devOrigin) || !touchCan()) return null
  try {
    touchOpen = true
    await systemPreferences.promptTouchID(CONFIRM[what as ConfirmWhat])
  } catch {
    return null
  } finally {
    touchOpen = false
  }
  return (await rpc<{ ticket: string }>('ticketMint', { what }).catch(() => null))?.ticket ?? null
})
ipcMain.handle('pick-folder', async e => {
  if (!from(e)) return null
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? win!, { properties: ['openDirectory', 'createDirectory'] }) // createDirectory: macOS's New Folder button
  return r.canceled ? null : r.filePaths[0]
})
// macOS dictation, as Edit › Start Dictation does; its language and microphone are in System Settings
ipcMain.on('dictate', e => from(e, 'new', 'ai', 'voice') && Menu.sendActionToFirstResponder('startDictation:'))
ipcMain.on('dictation-settings', e => from(e, 'new', 'ai') && shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension'))
// Full screen (⌘⇧⏎, the tab bar's ⤢): the tab's content alone in the window, the window full screen too; off: full
// screen only if it was before. focusFull: that, while it's on (what the window's saved state keeps)
let focusFull: boolean | null = null
ipcMain.on('full-screen', (e, on: boolean) => {
  if (!win || e.sender !== win.webContents) return
  if (on && focusFull === null) focusFull = win.isFullScreen()
  win.setFullScreen(on || !!focusFull)
  if (!on) focusFull = null
})
// Glass (Settings › Appearance): macOS's blur behind the page, whose backgrounds go see-through; the translucent
// sidebar's (side): the sidebar material under the sidebar and the rail, the main area a card over it
// the title bar's empty room double clicked (the tab bar's, a page's head): what macOS's setting says, as a native title bar does
ipcMain.on('titlebar-dblclick', e => {
  if (!from(e) || !win || win.isDestroyed()) return
  const act = dblClickAction(mac ? systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string') : undefined)
  if (act === 'minimize') win.minimize()
  else if (act === 'zoom') win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('glass', (e, on: boolean, light?: boolean | null, frosted?: boolean, side?: boolean) => {
  if (!from(e)) return
  float = !!frosted
  if (mac) win?.setWindowButtonPosition(lights())
  // the blur takes the window's appearance: a light theme's over a dark Mac's blur is grey under its dark text and icons.
  // ponytail: app-wide, so pages that follow prefers-color-scheme (an artifact, an extension's) follow the theme meanwhile
  nativeTheme.themeSource = on && light != null ? (light ? 'light' : 'dark') : 'system' // B3: no light given: a theme that follows the system, and so does the blur
  win?.setVibrancy(on ? (side === true ? 'sidebar' : 'under-window') : null) // V5's translucent sidebar: the sidebar material
  win?.setBackgroundColor(on ? '#00000000' : '#0e1014')
})
// V9: macOS's accent color (System Settings › Appearance) for Settings › Appearance › Accent color: System; none off a
// Mac (the option is hidden there). A change goes to the app's own windows ('accent'); themes.ts paints them again
const sysAccent = () => (mac ? `#${systemPreferences.getAccentColor().slice(0, 6)}` : null)
ipcMain.handle('accent', e => (from(e, 'new', 'ai', 'tab', 'quick', 'panel') ? sysAccent() : null))
const accentNow = () => {
  const c = sysAccent()
  for (const w of BrowserWindow.getAllWindows()) if (appPage(w.webContents.getURL())) w.webContents.send('accent', c)
}
if (mac) systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', accentNow) // macOS posts this one; Electron's accent-color-changed is Windows'
systemPreferences.on('accent-color-changed', accentNow)
// macOS's Show scroll bars (System Settings › Appearance): 'overlay' (a thumb only while scrolling, hovered or focused:
// styles.css html[data-scrollbars]) unless Always; off a Mac always. A change goes to the app's windows
const sysScroll = () => (mac && systemPreferences.getUserDefault('AppleShowScrollBars', 'string') !== 'Always' ? 'overlay' : 'always')
ipcMain.handle('scrollbars', e => (from(e, 'new', 'ai', 'tab', 'quick', 'panel') ? sysScroll() : 'always')) // the app's pages only, as accent
if (mac) systemPreferences.subscribeNotification('AppleShowScrollBarsSettingChanged', () => { for (const w of BrowserWindow.getAllWindows()) if (appPage(w.webContents.getURL())) w.webContents.send('scrollbars', sysScroll()) })
// Settings › General › Start Laki at login (macOS): a login item; opened by it, the window is made, not shown
ipcMain.handle('login-item', e => (from(e) && mac ? app.getLoginItemSettings().openAtLogin : null))
ipcMain.handle('login-item-set', (e, on: unknown) => {
  if (!from(e) || !mac || typeof on !== 'boolean') return null
  app.setLoginItemSettings({ openAtLogin: on }) // macOS 13+'s SMAppService: no openAsHidden; wasOpenedAtLogin keeps the window hidden instead
  return app.getLoginItemSettings().openAtLogin
})


// the bubbles' +, the menu bar's New Workspace… and a voice prompt for a new session: the new-workspace page alone (the renderer's ?window=new), in a
// panel over every app, Space and full-screen app, so the app you're in (and Laki's own window) stays where it is. One
// at a time: another + brings it up, a prompt fills it. As tall as the page (new-fit). It closes once the workspace is
// made, or on Esc.
export let newWin: BrowserWindow | null = null
export function newWsWin(prompt?: string, project?: string) {
  if (newWin && !newWin.isDestroyed()) {
    if (prompt) newWin.webContents.send('new-prompt', prompt, project)
    return void newWin.focus()
  }
  const w = (newWin = panelWin({ window: 'new', ...(prompt && { prompt }), ...(project && { project }) }, 640, 340, { minWidth: 480, minHeight: 200 })) // then new-fit: as tall as the page; project: Q5's new task in it
  w.on('closed', () => newWin === w && (newWin = null))
}
// Q1: the quick bar (?window=quick: NewWindow.tsx' QuickWindow), its global hotkey, the menu bar's and the bubbles' New
// task: one line to a new workspace, an agent that waits or is idle, or Laki AI, in a panel near the top of the screen
// with the mouse, over every app; one at a time. Sent, or Esc: it closes, and the app you were in has the keyboard again
// (a panel never brought Laki forward). More: the whole new-workspace page with the text
export let quickW: BrowserWindow | null = null
export function quickWin(prompt?: string, add = false) {
  if (quickW && !quickW.isDestroyed()) {
    if (prompt) quickW.webContents.send('new-prompt', prompt, undefined, add) // add: after what's in its box (a drop), not over it
    return void (quickW.show(), quickW.focus())
  }
  quickReady = false
  const w = (quickW = panelWin({ window: 'quick', ...(prompt && { prompt }) }, 640, 132, { minWidth: 440, minHeight: 112, resizable: false }, 0.16))
  guardFloat('quick', w)
  w.webContents.on('did-navigate', () => quickW === w && (quickReady = false)) // a reload: it listens again as it's up
  w.on('closed', () => quickW === w && ((quickW = null), (quickReady = false), (tellPng = null), (dropPngs = [])))
}
// Q7: show and tell (its global key, the menu bar's and the bubbles' item): a part of the screen (the bubbles out of it,
// as any shot), then the quick bar with the picture in it and the mic on (the page's: cloud voice, or macOS dictation
// when it's on; neither: a box to type in): ⏎ sends both to its target (an agent tab, a new task, Laki AI), E draws on
// it first (annotate, back to the bar), Esc drops both. Screen Recording refused: said, with its pane; never tried again
let quickReady = false // its page listens for show and tell's picture (quick-tell-ready)
let tellPng: string | null = null // the picture until it does
// a picture into the quick bar (show and tell's; test:ui's stub)
export const tellWith = (png: string) => ((tellPng = png), quickWin(), void tellSend())
export function tellShot() {
  if (screenOff()) return privacySay('screen')
  const bar = quickW && !quickW.isDestroyed() && quickW.isVisible() ? quickW : null
  bar?.hide() // out of the picture, as its own screenshot button's
  screenshot(true, undefined, tellWith, () => (bar?.isDestroyed() === false && bar.show(), screenOff(true) && privacySay('screen')))
}
export async function tellSend() {
  const w = quickW
  if (w && !w.isDestroyed() && quickReady) for (const png of dropPngs.splice(0)) w.webContents.send('quick-tell', { png, mic: 'granted', dictation: false, quiet: true }) // Q12's: as if pasted, no mic
  if (!tellPng || !w || w.isDestroyed() || !quickReady) return
  const png = tellPng
  tellPng = null
  w.webContents.send('quick-tell', { png, mic: mac ? systemPreferences.getMediaAccessStatus('microphone') : 'granted', dictation: !smoke && (await dictationOn()) }) // ui-smoke: no real dictation on your Mac
}
// Q12: drops on the menu bar's item (macOS; Linux's tray has no drops): while something's dragged over it, the mark
// framed (tray.ts' drop picture); dropped, the quick bar opens with it (talk.ts dropPayload: text quoted, a file in a
// project as its path there, a plain-text one outside as its text, pictures as pictures), nothing sent until ⏎. A file
// it can't take: a notification says so. None while Touch ID asks or an agent's Allow card is up (no drop lands on a
// prompt by mistake)
const dropBusy = () => touchOpen || (!!cardWin && !cardWin.isDestroyed() && cardWin.isVisible() && cards.some(c => c.ask))
let dropPngs: string[] = [] // pictures for the quick bar, until its page is up
export function trayDrops(t: Tray) {
  const lit = (on: boolean) => t.setImage(trayIcon(trayNow, quietOn(), on && !dropBusy()))
  t.on('drag-enter', () => lit(true))
  t.on('drag-leave', () => lit(false))
  t.on('drag-end', () => lit(false))
  t.on('drop-text', (_e, text) => void dropIn({ text }))
  t.on('drop-files', (_e, files) => void dropIn({ files }))
}
async function dropIn(d: { text?: string; files?: string[] }) {
  tray?.setImage(trayIcon(trayNow, quietOn()))
  if (dropBusy()) return
  const projects = ((await rpc<View>('state').catch(() => null))?.projects ?? []).filter(p => !p.kind && p.path).map(p => p.path)
  const files = (d.files ?? []).slice(0, 20).flatMap((path): DropFile[] => {
    try {
      const st = statSync(path)
      if (st.isDirectory()) return [{ path, size: 0, dir: true }]
      const text = st.size <= DROP_TEXT_MAX && !DROP_IMG.test(path) ? plainText(readFileSync(path)) : undefined // a picture: drawn, not read
      return [{ path, size: st.size, ...(text !== undefined && { text }) }]
    } catch {
      return []
    }
  })
  const r = dropPayload({ text: typeof d.text === 'string' ? d.text : undefined, files, projects })
  const pngs = r.images.flatMap(p => {
    let img = nativeImage.createFromPath(p)
    if (img.isEmpty()) return (r.refused.push(p), [])
    if (img.getSize().width > 2400) img = img.resize({ width: 2400 })
    return [img.toPNG().toString('base64')]
  })
  if (r.refused.length) new Notification({ title: "Laki didn't take it", body: `${DROP_NO[0].toUpperCase()}${DROP_NO.slice(1)}: ${r.refused.map(f => basename(f)).join(', ')}` }).show()
  if (!r.prompt && !pngs.length) return
  dropPngs.push(...pngs)
  quickWin(r.prompt || undefined, true)
  void tellSend()
}
ipcMain.on('quick-tell-ready', e => {
  if (!quickW || e.sender !== quickW.webContents || !from(e, 'quick')) return
  quickReady = true
  void tellSend()
})
// macOS dictation turned on (System Settings › Keyboard › Dictation): what the quick bar's mic starts, else it's a box.
// macOS keeps the switch in either of two places, by version
const defaultOn = (domain: string, key: string) => new Promise<boolean>(r => execFile('defaults', ['read', domain, key], { timeout: 2000 }, (err, out) => r(!err && out.trim() === '1')))
const dictationOn = async () => mac && (await Promise.all([defaultOn('com.apple.HIToolbox', 'AppleDictationAutoEnable'), defaultOn('com.apple.assistant.support', 'Dictation Enabled')])).some(Boolean)
// Screen Recording for Laki: refused (denied, restricted), or after a shot that brought no picture, not granted (asked,
// and turned down; an Esc in screencapture leaves it granted)
export const screenOff = (after = false) => mac && (s => (after ? s !== 'granted' : s === 'denied' || s === 'restricted'))(systemPreferences.getMediaAccessStatus('screen'))
const PANES = { screen: ['Screen Recording', 'Privacy_ScreenCapture'], microphone: ['Microphone', 'Privacy_Microphone'] } as const
const paneOpen = (which: keyof typeof PANES) => void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${PANES[which][1]}`)
// which permission is missing, said once per try, a click opens its pane
export function privacySay(which: keyof typeof PANES) {
  const name = PANES[which][0]
  appLog(`show and tell: no ${name} for Laki`)
  const n = new Notification({ title: `Laki needs ${name}`, body: `System Settings › Privacy & Security › ${name}: turn Laki on, then try again. Click to open it.` })
  n.on('click', () => paneOpen(which))
  n.show()
}
ipcMain.on('privacy-pane', (e, which: unknown) => from(e, 'quick', 'new', 'ai') && (which === 'microphone' || which === 'screen') && paneOpen(which))
// its E: the picture in the editor (the bar hidden meanwhile), the drawing back to it (annotate's to)
ipcMain.on('quick-annotate', (e, png: unknown) => {
  if (!quickW || e.sender !== quickW.webContents || !from(e, 'quick') || typeof png !== 'string' || png.length > 40e6) return
  quickW.hide()
  annotate(png, 'quick')
})
ipcMain.on('quick-more', (e, text: unknown) => {
  if (!quickW || e.sender !== quickW.webContents || !fromApp(e)) return
  quickW.close()
  newWsWin(typeof text === 'string' ? text.slice(0, 20000) : undefined)
})
// its screenshot button: a part of the screen, the bar out of the picture meanwhile; '' cancelled
ipcMain.handle('quick-shot', e => {
  const w = quickW
  if (!w || e.sender !== w.webContents || !from(e, 'quick')) return ''
  w.hide()
  return new Promise<string>(done =>
    screenshot(
      true,
      undefined,
      png => (w.isDestroyed() || (w.show(), w.focus()), done(png)),
      () => (w.isDestroyed() || (w.show(), w.focus()), done('')),
    ),
  )
})
ipcMain.on('quick-height', (e, h: unknown) => {
  if (!quickW || quickW.isDestroyed() || e.sender !== quickW.webContents || !fromApp(e) || typeof h !== 'number' || !Number.isFinite(h)) return
  quickW.setContentSize(quickW.getContentSize()[0], Math.round(Math.min(Math.max(h, 100), 520)))
})
// the bubbles' Ask Laki AI: the AI page alone (?window=ai), a chat in a panel like the new-workspace one; one at a time
export let aiW: BrowserWindow | null = null
let aiReady = false // its page listens for screenshots (ai-shot-ready)
let aiShots: string[] = [] // Screenshot to Laki AI's pictures (PNGs, base64) until the page listens
export function aiWin() {
  if (aiW && !aiW.isDestroyed()) return void aiW.focus()
  aiReady = false
  const w = (aiW = panelWin({ window: 'ai' }, 560, 680, { minWidth: 420, minHeight: 360 }))
  w.webContents.on('did-navigate', () => aiW === w && (aiReady = false)) // a reload (the page, not a frame in it): it listens again as it's up
  w.on('closed', () => aiW === w && ((aiW = null), (aiShots = [])))
}
// Screenshot to Laki AI (its global hotkey, the menu bar's item): a part of the screen, then the AI window with it in the
// box and the mic on (the page's: it saves the picture and starts dictation once it has the keyboard); Esc: nothing
export function shotAsk() {
  screenshot(true, undefined, png => {
    if (aiW && !aiW.isDestroyed() && aiReady) aiW.webContents.send('ai-shot', png)
    else aiShots.push(png)
    aiWin()
  })
}
ipcMain.on('ai-shot-ready', e => {
  if (!aiW || e.sender !== aiW.webContents) return
  aiReady = true
  for (const png of aiShots.splice(0)) e.sender.send('ai-shot', png)
})
// a tab floated out of the app (a tab's right click › Float in its own window): its terminal alone (?window=tab), in a
// panel over every app, Space and full-screen app, resizable; one per tab. Closing it (its ✕) puts it back: the app's
// pane, which says where it went meanwhile (floating), shows it again
export const tabWins = new Map<string, BrowserWindow>()
const floating = () => win?.webContents.send('floating', [...tabWins.keys()])
ipcMain.handle('floating', e => (from(e) ? [...tabWins.keys()] : []))
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

// the side panel's simulator floated out (its window button): that device alone (?window=sim), one window per device,
// its screenshots to the workspace it was floated from
// meanwhile the panel shows no second copy of it (simFloating): it says where it went, Show it, Bring it back (on false)
export const simWins = new Map<string, BrowserWindow>()
const simFloating = () => win && !win.isDestroyed() && win.webContents.send('sim-floating', [...simWins.keys()]) // quitting: the app's window may be gone first
ipcMain.handle('sim-floating', e => (from(e) ? [...simWins.keys()] : []))
ipcMain.on('sim-float', (e, device: unknown, ws: unknown, on: unknown) => {
  if (e.sender !== win?.webContents || typeof device !== 'string' || !/^(ios|android):\w[\w.:-]{0,199}$/.test(device) || typeof ws !== 'string' || !/^[\w-]{0,64}$/.test(ws)) return
  const had = simWins.get(device)
  if (on === false) return void had?.close()
  if (had && !had.isDestroyed()) return void had.focus()
  const w = panelWin({ window: 'sim', device, ws }, 400, 820, { minWidth: 240, minHeight: 320 })
  simWins.set(device, w)
  w.on('closed', () => simWins.get(device) === w && (simWins.delete(device), simFloating()))
  simFloating()
})

// the side panel in a window of its own (its head's Move to its own window, ⌘K): the app's page in panel mode
// (?window=panel: App.tsx' PANEL_WIN, the side panel alone, following the app window's workspace), a plain window to
// put on another screen. Its bounds and whether it was open at quit in panel.json (userData): the app window asks
// (panel-floating) as it loads and it opens again then. Closed: the panel is back in the app window
export let panelW: BrowserWindow | null = null
const panelFile = () => join(app.getPath('userData'), 'panel.json')
const panelAt = (): Partial<WinAt> & { open?: boolean } => {
  try {
    const p = JSON.parse(readFileSync(panelFile(), 'utf8'))
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}
const panelSave = (open: boolean) => {
  try {
    writeFileSync(panelFile(), JSON.stringify({ ...(panelW && !panelW.isDestroyed() ? panelW.getNormalBounds() : panelAt()), open }))
  } catch {}
}
const panelFloating = () => win && !win.isDestroyed() && win.webContents.send('panel-floating', !!panelW)
function panelOpen() {
  if (panelW && !panelW.isDestroyed()) return void panelW.focus()
  const at = panelAt()
  const a = [at.x, at.y, at.width, at.height].every(Number.isFinite) ? screen.getDisplayMatching(at as Electron.Rectangle).workArea : null
  const on = a && Math.min(at.x! + at.width!, a.x + a.width) - Math.max(at.x!, a.x) >= 100 && Math.min(at.y! + at.height!, a.y + a.height) - Math.max(at.y!, a.y) >= 50 // a monitor unplugged: macOS places it
  const w = (panelW = new BrowserWindow({
    width: 760,
    height: 900,
    ...(on && { x: at.x, y: at.y, width: Math.min(at.width!, a.width), height: Math.min(at.height!, a.height) }),
    minWidth: 380,
    minHeight: 320,
    title: 'Side panel — Laki',
    backgroundColor: '#0e1014',
    ...(!mac && { autoHideMenuBar: true }),
    show: false,
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true }, // the Preview tab's webview (will-attach-webview's guard)
  }))
  w.webContents.setWindowOpenHandler(({ url }) => (typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url) && shell.openExternal(url), { action: 'deny' }))
  w.webContents.on('will-navigate', e => e.preventDefault())
  spellMenu(w.webContents)
  let keep: ReturnType<typeof setTimeout> | undefined
  for (const ev of ['resize', 'move'] as const) w.on(ev as 'resize', () => (clearTimeout(keep), (keep = setTimeout(() => panelW === w && panelSave(true), 500))))
  w.on('close', () => (clearTimeout(keep), panelSave(quitting))) // at quit: open again at the next start
  w.on('closed', () => panelW === w && ((panelW = null), panelFloating()))
  w.once('ready-to-show', () => w.show())
  w.loadURL(pageURL('index.html', '?window=panel'))
  panelSave(true)
  panelFloating()
}
// the app window as it loads: whether the panel is out (opened again if it was at quit)
ipcMain.handle('panel-floating', e => {
  if (!win || e.sender !== win.webContents) return false
  if (!panelW && panelAt().open === true) panelOpen()
  return !!panelW
})
ipcMain.on('panel-float', (e, on: unknown) => {
  if (!win || e.sender !== win.webContents) return
  if (on === false) return void panelW?.close()
  panelOpen()
})

// a page of the renderer alone in a panel over every app, Space and full-screen app, in the middle of the screen the
// mouse is on, a third down (down: how far, of the room left)
function panelWin(query: Record<string, string>, width: number, height: number, more: BrowserWindowConstructorOptions, down = 1 / 3) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  ;[width, height] = [Math.min(width, d.width - 40), Math.min(height, d.height - 40)]
  const w = new BrowserWindow({
    x: Math.round(d.x + (d.width - width) / 2),
    y: Math.round(d.y + (d.height - height) * down),
    width,
    height,
    ...more,
    type: 'panel', // an NSPanel: it takes the keyboard without bringing Laki forward
    frame: false, // the page's head is its title bar (a drag region)
    // the quick bar and the new-workspace window: macOS's popover material behind the page's tint (NewWindow.tsx'
    // panel-glass), as the inbox's; solid under Reduce transparency and off a Mac
    ...(mac && !nativeTheme.prefersReducedTransparency && (query.window === 'quick' || query.window === 'new') ? { transparent: true, backgroundColor: '#00000000', vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true } : { backgroundColor: '#0e1014' }),
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
  spellMenu(w.webContents) // the new-workspace and AI windows' prompts
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', e => e.preventDefault()) // a dropped file would load in place, bridge and all
  w.once('ready-to-show', () => (w.show(), w.focus()))
  w.loadURL(pageURL('index.html', `?${new URLSearchParams(query)}`))
  return w
}
// the new-workspace window's height, as the page grows or shrinks (More, images, a template's preview); its top stays
ipcMain.on('new-fit', (e, h: unknown) => {
  if (!newWin || newWin.isDestroyed() || e.sender !== newWin.webContents || typeof h !== 'number' || !Number.isFinite(h)) return
  const d = screen.getDisplayMatching(newWin.getBounds()).workArea
  newWin.setContentSize(newWin.getContentSize()[0], Math.round(Math.min(Math.max(h, 200), d.y + d.height - newWin.getBounds().y - 20)))
})


ipcMain.on('open-external', (e, url: string) => {
  if (!from(e, 'new', 'ai', 'tab', 'panel')) return
  const to = externalOf(url)
  if (to === 'web') shell.openExternal(url)
  else if (to === 'laki') openLink(url) // the AI window's link to a tab: the app window, there
})
// a terminal's ⌘-clicked file:// link (claude's paths), the app window's only: { rel } for a file inside root (the
// workspace: the app's preview), a folder in Finder, a document in its app; anything that could run (an app, a script, no
// extension) only shown in Finder. Links followed first: their target's name is what counts
// opened in their app; anything else revealed. Not HTML (L11: a page from a repo runs in the browser as a file: page;
// an artifact's goes through the daemon's sandboxed /artifact/ page instead), nor a bundle that runs or builds
const DOCS = /\.(md|markdown|txt|log|json|jsonl|ya?ml|toml|csv|tsv|xml|pdf|png|jpe?g|gif|webp|svg|heic|mp4|mov|webm|mp3|m4a|wav)$/i
const BUNDLE = /\.(app|bundle|framework|plugin|kext|pkg|mpkg|prefpane|workflow|action|saver|appex|xcodeproj|xcworkspace|playground)\/?$/i
// a file shown in its folder in Finder (a terminal's recent picture's Reveal in Finder): the app's window or a floated
// tab's, an absolute path that's there; it opens nothing
ipcMain.handle('reveal', async (e, path: unknown) => {
  const from = (win && e.sender === win.webContents) || [...tabWins.values(), panelW].some(w => !!w && !w.isDestroyed() && w.webContents === e.sender)
  if (!from || typeof path !== 'string' || !path.startsWith('/')) return false
  const real = await realpath(path).catch(() => '')
  if (!real) return false
  shell.showItemInFolder(real)
  return true
})
ipcMain.handle('open-path', async (e, path: unknown, root: unknown) => {
  const from = (win && e.sender === win.webContents) || [...tabWins.values(), panelW].some(w => !!w && !w.isDestroyed() && w.webContents === e.sender) // the app's window, or a floated tab's
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

// C10: a file's row dragged out (Changes, Files, Artifacts, a turn's files) to Finder, Slack, a mail or an upload box:
// macOS's own file drag, now (it must start while the mouse is down: sync). The app window's or a floated tab's; a
// regular file inside root (its workspace or storage folder: dragOk), never the data folder's own (daemon.json's token,
// keys; its storage/ is the artifacts'). Its icon: its kind's, once
// app.getFileIcon has it (async), a generic document's meanwhile
const dragIcons = new Map<string, Electron.NativeImage>()
ipcMain.on('drag-out', (e, path: unknown, root: unknown) => {
  if (!from(e, 'tab', 'panel') || typeof path !== 'string' || typeof root !== 'string') return
  const real = (p: string) => {
    try {
      return realpathSync(p)
    } catch {
      return ''
    }
  }
  const file = real(path)
  const data = real(dataDir())
  const own = !!data && dragOk(file, [data], homedir()) && !dragOk(file, [join(data, 'storage')], homedir()) // the data folder's own files; its storage/ is the artifacts'
  if (!file || own || !dragOk(file, [real(root)].filter(Boolean), homedir()) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return
  const kind = /\.([\w-]{1,10})$/.exec(file)?.[1]?.toLowerCase() ?? ''
  const icon = dragIcons.get(kind) ?? dragIcons.get('')
  if (!dragIcons.has(kind)) void app.getFileIcon(file, { size: 'normal' }).then(i => !i.isEmpty() && dragIcons.set(kind, i), () => {})
  try {
    e.sender.startDrag({ file, icon: icon && !icon.isEmpty() ? icon : nativeImage.createFromNamedImage('NSDocument').resize({ width: 32 }) })
  } catch {} // no icon to drag with (off a Mac, before any came): no drag
})
app.whenReady().then(() => void app.getFileIcon(join(app.getAppPath(), 'package.json'), { size: 'normal' }).then(i => dragIcons.set('', i), () => {}))

// U14: Space on a file's row (Changes, the full review, Files, Artifacts), or its menu's Quick Look: macOS's own preview
// panel, from the app window or a floated tab's. A regular file only (links followed), off a Mac nothing
ipcMain.on('quick-look', async (e, path: unknown) => {
  if (!mac || !from(e, 'tab', 'panel') || typeof path !== 'string' || !path.startsWith('/')) return
  const real = await realpath(path).catch(() => '')
  if (!real || !(await stat(real).catch(() => null))?.isFile()) return
  BrowserWindow.fromWebContents(e.sender)?.previewFile(real, basename(path))
})

// U15: Share… (a PR's link, a shared tab's): macOS's Share menu at the pointer (Messages, Mail, AirDrop…), a website's
// link only. Kept while it shows (a collected menu closes)
let shareMenu: ShareMenu | null = null
ipcMain.on('share-menu', (e, url: unknown) => {
  if (!mac || !from(e) || !web(url) || url.length > 4096) return
  shareMenu = new ShareMenu({ urls: [url] })
  shareMenu.popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined, callback: () => (shareMenu = null) })
})
// U15: a workspace started waiting on you, Laki not in front (shared/tray.ts bounceOf, Settings' Bounce the Dock icon):
// one bounce, never 'critical' (that one keeps going until Laki is looked at)
ipcMain.on('dock-bounce', e => mac && from(e) && !BrowserWindow.getFocusedWindow() && app.dock?.bounce('informational'))

// an HTML artifact as itself, a file:// page in the default browser (its viewer's and right click's Open file): the app
// window's only, a file inside root (the workspace's storage folder), links followed first. The user's call, asked for
// by name: unlike the daemon's /artifact/ page (L11), its scripts run as a local file and may read others
ipcMain.handle('open-file', async (e, path: unknown, root: unknown) => {
  if (!win || e.sender !== win.webContents || typeof path !== 'string' || typeof root !== 'string' || !path.startsWith('/') || !root.startsWith('/')) return 'missing'
  const [real, top] = await Promise.all([realpath(path).catch(() => ''), realpath(root).catch(() => '')])
  if (!real || !top || !real.startsWith(`${top}/`) || !/\.html?$/i.test(real) || !(await stat(real).catch(() => null))?.isFile()) return 'missing'
  // S11: as file:// in your browser its scripts run outside Laki's viewer (its CSP, no network): asked once per file
  if (!fileOk.has(real)) {
    const r = await dialog.showMessageBox(win, { type: 'question', message: `Open ${basename(real)} in your browser?`, detail: "An agent may have written this page. Opened as a file, its scripts run in your browser, outside Laki's viewer.", buttons: ['Open in the browser', 'Open in the viewer instead', 'Cancel'], defaultId: 1, cancelId: 2 })
    if (r.response === 2) return 'opened' // nothing to say
    if (r.response === 1) return 'viewer'
    fileOk.add(real)
  }
  await shell.openExternal(pathToFileURL(real).href)
  return 'opened'
})
const fileOk = new Set<string>() // pages you said yes to (until Laki quits)

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

// B3: Laki was uninstalled (Settings' Uninstall Laki or laki uninstall: the daemon's uninstalled event, through the
// window): no daemon again, and the app goes: to the Trash on a yes (a Homebrew install: brew's command to copy)
ipcMain.on('uninstalled', async (e, cask: unknown) => {
  if (!from(e) || quitting) return
  quitting = true // the window's reconnect starts no daemon now (conn)
  const bundle = mac && app.isPackaged ? appOf(process.execPath) : undefined // a dev run's is node_modules' Electron.app: never
  const r = await dialog.showMessageBox({
    type: 'info',
    message: `${app.name} is uninstalled`,
    detail: cask ? 'Its pieces are gone. To remove the app: brew uninstall --cask laki' : `Its pieces are gone.${bundle ? ' Move the app to the Trash to finish.' : ''}`,
    buttons: cask ? ['Copy the command and quit', 'Quit'] : bundle ? ['Move to Trash and quit', 'Quit'] : ['Quit'],
    defaultId: 0,
  })
  if (r.response === 0 && cask) clipboard.writeText('brew uninstall --cask laki')
  else if (r.response === 0 && bundle) await shell.trashItem(bundle).catch(err => appLog(`uninstall: the app to the Trash: ${err}`))
  app.quit()
})

// Quit Completely: the daemon too, so every agent stops (they resume when the app opens again)
export async function quitCompletely() {
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
  const pid = daemonInfo()?.pid
  const asked = await rpc('shutdown', {}, 10000).then(() => true, () => false) // the daemon first asks who calls (lsof, ps): a busy Mac takes a while, and a call given up is refused
  for (let i = 0; asked && pid && i < 40 && running(pid); i++) await new Promise(r => setTimeout(r, 250))
  if (pid && running(pid)) await stopDaemon(pid) // refused (another Laki, or the app before an update, started it): as the Restart button stops it
  app.quit()
}

appMenu()

app.whenReady().then(async () => {
  if (app.isPackaged) app.setAsDefaultProtocolClient('laki')
  if (!dev) serveApp()
  await Promise.all([daemon().catch(e => dialog.showErrorBox('Laki', `The daemon didn't start: ${e.message}`)), moveStorage()])
  create(!showAtLaunch({ mac, atLogin: mac && app.getLoginItemSettings().wasOpenedAtLogin, check: !!smoke || !!capture }))
})
app.on('before-quit', () => (quitting = true))
app.on('activate', () => show())
// macOS: the app (and always the daemon) keeps running without windows
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !moving) app.quit()
})
