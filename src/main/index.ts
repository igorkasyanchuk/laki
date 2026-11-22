// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links, laki:// links,
// the preview pane's webview (localhost only) and its screenshots.
import { app, autoUpdater, BrowserWindow, type BrowserWindowConstructorOptions, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, net, Notification, powerMonitor, protocol, screen, session, ShareMenu, shell, systemPreferences, Tray, webContents } from 'electron'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pixelDiff } from '../shared/pixelDiff.ts'
import { appToken, daemonInfo, dataDir, ensureDaemon, freshDaemon, logLine, NODE_API, pidRunning, pingStep, rpc, stopDaemon } from '../shared/conn.ts'
import { appOf, helperBin } from '../shared/helper.ts'
import { DROP_IMG, DROP_NO, DROP_TEXT_MAX, type DropFile, dropPayload, plainText } from '../shared/talk.ts'
import { type KeyId, keyFor, keyMap } from '../shared/keys.ts'
import { hhmm, quietChoices, TRAY_PX, TRAY_STATES, trayBitmap, type TrayInfo, type TrayState, trayTip, trayTitle } from '../shared/tray.ts'
import { veiled, type View } from '../shared/types.ts'
import { bulkPick, hotkeyAnswer } from '../shared/ask.ts'
import { CONFIRM, type ConfirmWhat } from '../shared/confirm.ts'
import { AGENT_BROWSER, APP_ORIGIN, APP_SCHEME, appFile, appPage as isAppPage, BROWSER, confirmAsk, dblClickAction, dragOk, externalOf, handoffUrl, fromApp as senderOk, fromTokenPage, menuModelOk, type NativeItem, pageIs, PREVIEW, web, webviewOk, dockAgents, dockMenu, recentOk, showAtLaunch, type DockAgent  } from './guards.ts'
import { updater } from './update.ts'
import './agentBrowser.ts' // its IPC (browse): registered as it loads
import { card, floater, floats, guardFloat, pin, pinGo, pinned, protectFloats, setFront, talk, talkW, voice } from './floater.ts'
import { annotate, screenItems, screenshot } from './shots.ts'
import { addCard, barInbox, type Card, cards, cardWin, dropCards, inboxHide, inboxOpen, inboxSet, sendCards } from './cards.ts'

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
const RENDERER = fileURLToPath(new URL('../renderer/', import.meta.url))
export const pageURL = (file: string, more = '') => (dev ? `${new URL(file === 'index.html' ? '' : file, `${process.env.ELECTRON_RENDERER_URL}/`).href}${more}` : `${APP_ORIGIN}/${file}${more}`)
// from the app window, or one of the app's other pages by name: new (the new-workspace window), ai, tab (a floated
// tab: ?window=), voice (the bubbles' Say it); nothing else (a site in a webview, a frame, another window)
type Page = 'new' | 'ai' | 'tab' | 'voice' | 'quick' | 'inbox' // quick: the quick bar (Q1); inbox: the menu bar's Inbox (ask.html)
export const from = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, ...pages: Page[]) =>
  fromApp(e) && ((!!win && e.sender === win.webContents) || pages.some(p => (p === 'voice' ? !!voice && e.sender === voice.webContents : pageIs(e.senderFrame?.url, p))))
// scripts/pack-smoke.sh's: a screenshot of the window 3s after load, the notifications as posted. Switches, not env:
// none reach a launch from Finder or the Dock
const capture = app.commandLine.getSwitchValue('laki-capture')
export const notifyLog = app.commandLine.getSwitchValue('laki-notify-log')
export const smoke = app.commandLine.getSwitchValue('laki-smoke') // R8: scripts/ui-smoke.ts' folder

// R8 --laki-smoke=<dir> (npm run test:ui): the real window walked page by page. Each step opens a page (its laki://
// link, a click, a key), waits for something only that page draws, and fails on ui.tsx' Boundary (.boom) or an error
// in the console; a screenshot each, result.json at the end, then the app quits (1: a step failed)
let smoked = false

// test:sheet: a picture against the last run's (scripts/ui-sheet.ts' LAKI_SHEET_PREV, its folder): the share of its
// pixels that changed (shared/pixelDiff.ts), both read back from their files (one scale), or new
function sheetDiff(png: string, name: string): { diff?: number; new?: true } {
  const prev = process.env.LAKI_SHEET_PREV ? join(process.env.LAKI_SHEET_PREV, `${name}.png`) : ''
  if (!prev || !existsSync(prev)) return { new: true }
  const [a, b] = [nativeImage.createFromPath(png), nativeImage.createFromPath(prev)]
  const [sa, sb] = [a.getSize(), b.getSize()]
  return { diff: pixelDiff(a.toBitmap(), sa.width, sa.height, b.toBitmap(), sb.width, sb.height) }
}

async function uiSmoke(w: BrowserWindow, dir: string) {
  mkdirSync(dir, { recursive: true })
  const errors: string[] = []
  // V13: no view transitions in a smoke run (ui.tsx morph): its waits see each page as it lands; marked on every load
  const mark = () => void w.webContents.executeJavaScript("document.documentElement.dataset.smoke = ''").catch(() => {})
  w.webContents.on('dom-ready', mark)
  mark()
  w.webContents.on('console-message', (_e, level, message) => void (level >= 3 && !/^Loading the image 'https:\/\/pics\.invalid\/.*Content Security Policy/.test(message) && errors.push(message))) // S18: view-as-page's outside picture, blocked on purpose
  const js = <T>(code: string) => w.webContents.executeJavaScript(code, true) as Promise<T>
  const has = (sel: string) => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const click = (sel: string) => () => js(`document.querySelector(${JSON.stringify(sel)})?.click()`)
  const link = (url: string) => async () => w.webContents.send('deep-link', url)
  const key = (k: string, meta = false) => () => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, metaKey: ${meta}, bubbles: true, cancelable: true }))`)
  // E3's flows: what you'd do, by its words (a menu's item, a dialog's button), a right click where you'd make one
  const q = JSON.stringify
  const hasText = (sel: string, words: string) => js<boolean>(`[...document.querySelectorAll(${q(sel)})].some(e => e.textContent.includes(${q(words)}))`)
  const clickText = (sel: string, words: string) => js(`[...document.querySelectorAll(${q(sel)})].find(e => e.textContent.includes(${q(words)}))?.click()`)
  const ctx = (sel: string) => js(`(e => e && e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: e.getBoundingClientRect().x + 12, clientY: e.getBoundingClientRect().y + 6 })))(document.querySelector(${q(sel)}))`)
  const typeIn = (sel: string, text: string) => js(`(e => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${q(text)}); e.dispatchEvent(new Event('input', { bubbles: true })) })(document.querySelector(${q(sel)}))`)
  const nap = (ms: number) => new Promise(r => setTimeout(r, ms))
  // U2: two elements both drawn and apart (their boxes don't meet)
  const apart = (a: string, b: string) => js<boolean>(`(() => { const [x, y] = [${q(a)}, ${q(b)}].map(s => document.querySelector(s)?.getBoundingClientRect()); return !!x && !!y && x.width > 0 && y.width > 0 && (x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top) })()`)
  const waitFor = async (f: () => Promise<unknown>, what: string, ms = 8000) => {
    for (const at = Date.now(); !(await f()); await nap(100)) if (Date.now() - at > ms) throw new Error(`no ${what} after ${ms / 1000} s`)
  }
  const pick = async (sel: string, item: string) => (await waitFor(() => has(sel), sel), await ctx(sel), await waitFor(() => hasText('.menu-item', item), `${item} in the menu`), await clickText('.menu-item', item))
  const answer = async (button: string) => (await waitFor(() => hasText('.ask-box button', button), `the dialog's ${button}`), await clickText('.ask-box button', button))
  const named = async (n: string) => (await rpc<View>('state')).workspaces.find(x => x.name === n || x.id === n)!
  const row = (id: string) => `[data-row="ws:${id}"]`
  // a fake claude's tab up: its banner (the demo's scripted one, test/fakes/script.cjs, or the echo)
  const claudeUp = (id: string) => waitFor(async () => /fake claude|Welcome to Claude Code/.test(await rpc<string>('screen', { target: id, lines: 10 })), 'its claude started', 15000)
  const fakeLog = () => (f => (existsSync(f) ? readFileSync(f, 'utf8') : ''))(join(process.env.HOME ?? '', 'fake.log'))
  const ws: Record<string, View['workspaces'][number]> = {}
  let before = 0 // the quick bar's step: workspaces before it sends
  const cart = () => readFileSync(join(ws.cart.path, 'src/cart.js'), 'utf8')
  const checkout = () => join(ws.co.path, 'src/checkout.js')
  const steps: [string, (() => Promise<unknown>) | null, string | (() => Promise<boolean>)][] = [
    // a row's words all or nothing: none visible shows under 8 characters before its ellipsis (styles.css .need-row-line)
    ['projects', null, async () => (await has('.sidebar .ws')) && js<boolean>("[...document.querySelectorAll('.need-row-last')].every(e => { const box = e.closest('.need-row-line')?.getBoundingClientRect(); const r = e.getBoundingClientRect(); return !box || !r.width || r.top >= box.bottom - 1 || e.scrollWidth <= e.clientWidth || e.clientWidth / (e.scrollWidth / e.textContent.length) >= 8 })")],
    ['switch-apart', null, () => apart('.reader-switch', '.pane.active .xterm-screen')], // U2: Terminal | Reader off the terminal's lines
    ['reader', click('.reader-switch button:last-child'), '.reader'],
    // the AI button: in the status bar by default; floated again from its right click, it's off the Reader's Send (U2);
    // its – puts it back
    ['fab-apart', () => pick('.sb-ai', 'Float the button again'), () => apart('.ai-fab', '.rd-box button.primary')],
    ['fab-dock', click('.ai-fab-min'), '.sb-ai'],
    ['review', click('.review-tab'), '.full-review'],
    // T18: two columns (its key's event) once the diff has 900px (the files and the comments folded away): each changed
    // line's row has an old and a new cell; then one again
    ['review-split', async () => {
      await click('.full-review button[aria-label="Hide the files"]')()
      await click('.full-review button[aria-label="Hide the comments"]')()
      await js("localStorage.getItem('laki.diffSplit') === 'split' || window.dispatchEvent(new CustomEvent('laki-diff-split'))")
    }, () => js<boolean>("(c => c.length > 0 && c.some(e => e.dataset.side === 'old') && c.some(e => e.dataset.side === 'new'))([...document.querySelectorAll('.full-review .sp-diff.split [data-side]')])")],
    ['review-unsplit', async () => {
      await js("window.dispatchEvent(new CustomEvent('laki-diff-split'))")
      await js("document.querySelectorAll('.full-review .fr-strip').forEach(b => b.click())") // the files and the comments back (each fold is remembered)
    }, async () => !(await has('.full-review .sp-diff.split')) && (await has('.full-review .sp-row'))],
    ['new-workspace', link('laki://new'), '.nw-composer'],
    ['settings', link('laki://settings'), '.settings-page .settings-nav > button.on'], // its content, not the page's frame: Settings loads as it opens (E8)
    // U10: Basic shows four heads, each only its cards (Look: Theme first); All again; Layout by its link
    ['settings-basic', async () => { await waitFor(() => has('.settings-view button'), 'Basic | All'); await clickText('.settings-view button', 'Basic'); await waitFor(() => hasText('.settings-nav button', 'Git & PRs'), 'the Basic heads'); await clickText('.settings-nav button', 'Look') }, async () => (await has('.settings-main[data-basic]')) && (await js<string>("document.querySelector('.settings-main .set-group h3')?.textContent ?? ''")) === 'Theme' && !(await hasText('.settings-main h3', 'Rail'))],
    ['settings-layout', async () => (await clickText('.settings-view button', 'All'), await link('laki://settings/layout?spot=Rail')()), async () => !(await has('.settings-main[data-basic]')) && (await hasText('.settings-main h2', 'Layout')) && (await hasText('.settings-main h3', 'Rail'))],
    // All's list is taller than the window: it scrolls, no row squeezed under its text
    ['settings-rows', null, () => js<boolean>(`[...document.querySelectorAll('.settings-nav > button')].every(b => b.scrollHeight <= b.clientHeight + 1)`)],
    // Terminal › Shell: the daemon's list came (the login shell first, Another path… last)
    ['settings-shell', link('laki://settings/terminal?spot=Shell'), () => js<boolean>(`[...document.querySelectorAll('.settings-main select')].some(s => s.options[0]?.textContent.startsWith('Your login shell') && s.options[s.options.length - 1].value === '…')`)],
    // Settings › Notifications: an old link to a setting General held lands there, its table drawn (6 rows and more)
    ['settings-notify', link('laki://settings/general?spot=Quiet'), async () => (await hasText('.settings-nav > button.on', 'Notifications')) && (await js<number>("document.querySelectorAll('.nt-table tbody tr').length")) >= 6],
    ['board', link('laki://board'), '.board'],
    // behind a rail page the sidebar is hidden but keeps its box (its scroll with it), the main area over it
    ['board-sidebar', null, () => js<boolean>(`(([s, m]) => getComputedStyle(s).visibility === 'hidden' && s.getBoundingClientRect().width > 0 && Math.abs(s.getBoundingClientRect().height - m.getBoundingClientRect().height) < 2 && m.getBoundingClientRect().left < s.getBoundingClientRect().right)([document.querySelector('.sidebar'), document.querySelector('.main')])`)],
    ['schedule', link('laki://schedules'), '.sched-empty, .sched-row, .ghosts'],
    ['ai', link('laki://ai'), '.ai-page'],
    ['workflows', click('[data-rail="workflows"]'), '.wf-page, .sched-empty'],
    // place more: an extension's item in the foot's ⋯ menu, with Video, Meme and Timer (ui-smoke.ts' Docs)
    ['more-menu', click('.foot-more'), () => hasText('.menu-item', 'Docs')],
    ['palette', async () => (await key('Escape')(), await key('k', true)()), '.palette-input'],
    // F5: the Preview of a workspace's dev server (localhost) has Pick; then the side panel shut again
    ['preview-pick', async () => {
      await key('Escape')()
      await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true, cancelable: true }))")
      await waitFor(() => has('[role=tab][aria-label="Preview"]'), 'the Preview tab')
      await click('[role=tab][aria-label="Preview"]')()
    }, '.web-tools .web-pick-btn'],
    ['preview-shut', () => js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true, cancelable: true }))"), async () => !(await has('.web-tools'))],
    // V9: behind another app the accent's fills and the picked row go neutral (the status colors don't); then back
    ['inactive', async () => (await key('Escape')(), w.webContents.send('front', false)), () => js<boolean>("document.documentElement.classList.contains('away') && getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim() !== getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")],
    ['active', async () => w.webContents.send('front', true), () => js<boolean>("!document.documentElement.classList.contains('away')")],
    // Q1: the quick bar (its laki:// link), a line typed and sent: a new workspace in the demo's project, the bar gone
    ['quick-bar', async () => {
      before = (await rpc<View>('state')).workspaces.filter(x => !x.archived).length
      openLink('laki://quick')
      const q = <T>(code: string) => (quickW && !quickW.isDestroyed() ? (quickW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => q<boolean>("!!document.querySelector('.quick-bar textarea') && !!document.querySelector('.quick-chip')?.textContent.includes('New workspace in')"), 'the quick bar')
      await q(`(e => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, 'Add a dark mode toggle'); e.dispatchEvent(new Event('input', { bubbles: true })) })(document.querySelector('.quick-bar textarea'))`)
      await nap(200)
      if (quickW && !quickW.isDestroyed()) writeFileSync(join(dir, 'quick-bar-window.png'), (await quickW.webContents.capturePage()).toPNG()) // its own window: the main one's screenshot doesn't have it
      await q("document.querySelector('.quick-bar button.primary').click()")
    }, async () => (!quickW || quickW.isDestroyed()) && (await rpc<View>('state')).workspaces.filter(x => !x.archived).length === before + 1],
    // Q7: show and tell, its screencapture skipped (a stub picture: the app's icon): the quick bar with the picture in
    // it and its hint, then Esc drops both
    ['show-and-tell', async () => {
      tellPng = readFileSync(join(RENDERER, 'icon-192.png')).toString('base64')
      quickWin()
      void tellSend()
      const q = <T>(code: string) => (quickW && !quickW.isDestroyed() ? (quickW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => q<boolean>("!!document.querySelector('.quick-bar .prompt-image img') && !!document.querySelector('.quick-tell')"), 'the picture in the quick bar')
      if (quickW && !quickW.isDestroyed()) writeFileSync(join(dir, 'show-and-tell-window.png'), (await quickW.webContents.capturePage()).toPNG())
      await q("document.querySelector('.quick-bar textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    }, async () => !quickW || quickW.isDestroyed()],
    // Q2: the talk key's pill at the pointer (no microphone opened in a smoke run): recording, who gets it; Esc drops it
    ['talk-pill', async () => {
      talk()
      const t = <T>(code: string) => (talkW && !talkW.isDestroyed() ? (talkW.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => t<boolean>("!!document.querySelector('#talk.rec') && document.querySelector('.t-to').textContent.startsWith('→ ')"), 'the talk pill recording')
      if (talkW && !talkW.isDestroyed()) writeFileSync(join(dir, 'talk-pill-window.png'), (await talkW.webContents.capturePage()).toPNG())
      await t("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    }, async () => !talkW || talkW.isDestroyed()],
    // U3: Get started never opened by itself; its bar opens it: the loop's five steps, the rest folded under Explore more
    ['get-started', async () => (await key('Escape')(), await click('.onboard-bar')()), async () => (await js<number>("document.querySelectorAll('.onboard > .ob-steps > .ob-step').length")) === 5 && (await has('.ob-more-head'))],
    // (a) archive with an uncommitted file: the dialog names it; (b) archived, then Undo brings it back
    ['flow-archive-asks', async () => {
      ws.dark = await named('dark-mode')
      writeFileSync(join(ws.dark.path, 'notes.txt'), 'mine\n')
      await pick(row(ws.dark.id), 'Archive workspace')
    }, () => hasText('.ask-box', 'notes.txt')],
    ['flow-archived', () => answer('Archive'), async () => (await has('.toast-undo')) && !(await has(row(ws.dark.id)))],
    ['flow-archive-undo', click('.toast-undo'), async () => (await has(row(ws.dark.id))) && !(await named('dark-mode')).archived && (await nap(1000), !(await has(`${row(ws.dark.id)} [data-fx]`)))], // V7b: its mark's effect gone after a second
    // (c) the Review tab: a file reverted, then Undo
    ['flow-revert', async () => {
      ws.cart = await named('fix-cart-total')
      await click(row(ws.cart.id))()
      if (!(await has('.full-review'))) await click('.review-tab')()
      await pick('.full-review .sp-row[data-tip^="src/cart.js "]', 'Revert this file')
      await answer('Revert')
    }, async () => (await has('.toast-undo')) && !cart().includes('Math.round')],
    ['flow-revert-undo', click('.toast-undo'), async () => cart().includes('Math.round')],
    // (d) F1: a kept turn (one made here when the demo's agent kept none), rewound, then the rewind undone
    ['flow-rewind', async () => {
      if (await has('.full-review')) await click('.review-tab')()
      ws.co = await named('checkout-flow')
      await click(row(ws.co.id))()
      const tab = (await rpc<View>('state')).tabs.find(t => t.workspace === ws.co.id && t.kind === 'agent')!
      if (!(await rpc<unknown[]>('turnList', { tab: tab.id })).length) {
        await rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'add pay()' } }) // a turn as claude's hooks say it
        await nap(300)
        writeFileSync(checkout(), 'export const pay = () => true\n')
        await rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done.' } })
        await waitFor(async () => (await rpc<unknown[]>('turnList', { tab: tab.id })).length, 'a kept turn')
      }
      await waitFor(() => has('.sb-turns'), "its Turns in the status bar")
      await click('.sb-turns')()
      await waitFor(() => hasText('.menu-item', '#'), 'its turns, newest first')
      await js(`document.querySelector('.menu-item')?.click()`) // the newest: its actions beside
      await waitFor(() => hasText('.menu-item', 'Rewind files'), 'Rewind in its menu')
      await clickText('.menu-item', 'Rewind files')
      await answer('Rewind')
    }, async () => !existsSync(checkout()) && (await rpc<{ rewind?: boolean }[]>('turnList', { tab: (await rpc<View>('state')).tabs.find(t => t.workspace === ws.co.id && t.kind === 'agent')!.id })).some(t => t.rewind)],
    ['flow-rewind-undo', async () => {
      await click('.sb-turns')()
      await waitFor(() => hasText('.menu-item', '· rewind'), 'the rewind, newest')
      await clickText('.menu-item', '· rewind')
      await waitFor(() => hasText('.menu-item', 'Undo this rewind'), 'Undo in its menu')
      await clickText('.menu-item', 'Undo this rewind')
      await answer('Undo the rewind')
    }, async () => existsSync(checkout())],
    // (e) a green PR merged from ⌘K: the fake gh's log has the merge
    ['flow-merge', async () => {
      const w = await named('checkout-flow')
      writeFileSync(join(process.env.HOME ?? '', 'gh', `pr-${w.branch!.replace(/\//g, '_')}.json`), JSON.stringify({ number: 63, state: 'OPEN', url: 'https://github.com/acme/shop/pull/63', title: 'One-page checkout', author: { login: 'ann' }, isDraft: false, headRefOid: 'fed321', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviews: [], body: '', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }))
      await rpc('prRefresh', {}).catch(() => {})
      await waitFor(async () => (await named('checkout-flow')).pr?.checks === 'pass', 'its PR green', 20000)
      await click(row(w.id))()
      await key('k', true)()
      await waitFor(() => has('.palette-input'), 'the palette')
      await typeIn('.palette-input', 'Merge')
      await waitFor(() => hasText('.palette-item', 'Merge #63'), 'Merge #63 in ⌘K')
      await clickText('.palette-item', 'Merge #63')
      await answer('Squash and merge')
    }, async () => /gh pr merge/.test(fakeLog())],
    // U8: two agents ask to run npm test: Needs you's Allow all lists it once with both names, then answers both
    ['allow-all-asks', async () => {
      await key('Escape')()
      const v = await rpc<View>('state')
      const ids = ['fix-cart-total', 'checkout-flow'].map(n => v.workspaces.find(x => x.name === n || x.id === n)!.id)
      // a claude tab of its own in each (the demo's have prompts of their own going in), started before it's asked
      const agents = await Promise.all(ids.map(id => rpc<{ id: string }>('tabNew', { ws: id, preset: 'claude' }).then(t => t.id)))
      for (const id of agents) await claudeUp(id)
      for (const id of agents) await rpc('send', { target: id, text: 'perm bash :: npm test' })
      await waitFor(() => hasText('.needs-allow-all', 'Allow all (2)'), 'Allow all (2) in Needs you')
      await click('.needs-allow-all')()
      await waitFor(() => has('.ask-box'), 'its confirm')
    }, async () => (await js<number>(`[...document.querySelectorAll('.ask-box *')].filter(e => !e.children.length && e.textContent.trim() === 'Bash: npm test').length`)) === 1 && (await hasText('.ask-box', 'fix-cart-total')) && (await hasText('.ask-box', 'checkout-flow'))],
    ['allow-all-answered', () => answer('Allow all (2)'), async () => !(await rpc<View>('state')).tabs.some(t => t.status === 'waiting' && t.ask?.what === 'npm test')],
    // Q4: a waiting agent answered from its edge bubble: the bubbles shown (Laki behind another app), its circle's click
    // (main's pinGo, as floater-click: a synthetic pointer can't capture), the pinned card's first option
    ['bubble-answer', async () => {
      const v = await rpc<View>('state')
      const id = v.workspaces.find(x => x.name === 'checkout-flow' || x.id === 'checkout-flow')!.id
      const t = (await rpc<{ id: string }>('tabNew', { ws: id, preset: 'claude' })).id
      await claudeUp(t)
      await rpc('send', { target: t, text: 'perm bash :: npm run lint' })
      await waitFor(async () => floats.items.some(x => x.tab === t && x.status === 'waiting'), 'its bubble waiting')
      setFront(false)
      await waitFor(async () => !!card && !card.isDestroyed(), 'the card window')
      await nap(300)
      pinGo({ kind: 'click', tab: t, waiting: true })
      const c = <T>(code: string) => (card && !card.isDestroyed() ? (card.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => c<boolean>("!!document.querySelector('#card.pinned [data-n]') && document.querySelector('#card.pinned .pin-what').textContent.includes('npm run lint')"), 'the pinned card with its options')
      writeFileSync(join(dir, 'bubble-answer-window.png'), (await card!.webContents.capturePage()).toPNG())
      await c("document.querySelector('#card.pinned [data-n]').click()")
      ws.answered = { id: t } as View['workspaces'][number]
    }, async () => !(await rpc<View>('state')).tabs.some(t => t.id === ws.answered.id && t.status === 'waiting') && !pinned.tab],
    // Q9: text and a picture (a synthetic DataTransfer: no file of its own, so it's saved) dropped on that circle: its
    // card pins with them, a line said, ⏎: the agent's terminal has it
    ['bubble-drop', async () => {
      const t = ws.answered.id
      await waitFor(async () => floats.items.some(x => x.tab === t) && !!floater && !floater.isDestroyed(), 'its bubble')
      const b = <T>(code: string) => (floater && !floater.isDestroyed() ? (floater.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => b<boolean>(`!!document.querySelector('.fl-dot[data-tab="${t}"]')`), 'its circle')
      const png = readFileSync(join(RENDERER, 'icon-192.png')).toString('base64')
      await b(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'see the header'); dt.items.add(new File([Uint8Array.from(atob(${q(png)}), c => c.charCodeAt(0))], 'shot.png', { type: 'image/png' })); const el = document.querySelector('.fl-dot[data-tab="${t}"]'); el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) })()`)
      const c = <T>(code: string) => (card && !card.isDestroyed() ? (card.webContents.executeJavaScript(code, true) as Promise<T>) : Promise.resolve(undefined))
      await waitFor(() => c<boolean>("!!document.querySelector('#card.pinned .drop-what .mono')"), 'the card with what was dropped')
      writeFileSync(join(dir, 'bubble-drop-window.png'), (await card!.webContents.capturePage()).toPNG())
      await c(`(e => { e.value = 'make it like this'; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })(document.querySelector('#card.pinned input'))`)
    }, async () => !pinned.tab && (await rpc<string>('screen', { target: ws.answered.id, lines: 30 })).includes('make it like this')],
    ['bubble-front', async () => setFront(true), async () => !floater?.isVisible()],
    // U5: the Ship sheet on dark-mode (notes.txt uncommitted, its PR #42 open): its file with a box, the PR's title
    // drafted, Push to PR (the main button follows the PR)
    ['ship-sheet', async () => {
      await key('Escape')()
      await click(row(ws.dark.id))()
      await waitFor(() => has('.tabbar [aria-label^="Ship:"]'), 'the Ship button')
      await click('.tabbar [aria-label^="Ship:"]')()
    }, async () => (await hasText('.ship-file', 'notes.txt')) && (await js<string>("document.querySelector('.ship-form input')?.value ?? ''")) !== '' && (await hasText('.ship button.primary', 'Push to PR'))],
    // Ship's Update from <base>: dark-mode one commit behind main (an empty commit on main, the stat scan's ↓1), the
    // button's merge, the banner up to date with main again, the sheet still open
    ['ship-behind', async () => {
      const repo = (await rpc<View>('state')).projects.find(p => p.id === ws.dark.project)!.path
      const r = spawnSync('git', ['-C', repo, '-c', 'user.name=Laki', '-c', 'user.email=smoke@example.invalid', 'commit', '--allow-empty', '-qm', 'On main meanwhile'], { encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`git commit on main: ${r.stderr}`)
      await waitFor(async () => (await named('dark-mode')).stat?.behind === 1, 'dark-mode 1 behind main', 30000) // the stat scan's 10 s: in the act, not the check's 8
    }, async () => (await named('dark-mode')).stat?.behind === 1],
    ['ship-update', async () => {
      // the sheet opened again (the bubble steps' tab focus can close the last one meanwhile)
      await key('Escape')()
      await click(row(ws.dark.id))()
      await waitFor(() => has('.tabbar [aria-label^="Ship:"]'), 'the Ship button')
      await click('.tabbar [aria-label^="Ship:"]')()
      await waitFor(() => has('.ship-update'), 'Update from main in the banner')
      await click('.ship-update')()
    }, async () => (await hasText('.ship-banner', 'up to date with')) && (await has('.ship-file'))],
    // U11: the sidebar from the keyboard: its one tab stop, ↓ to another workspace's row, Enter opens it
    ['tree-keys', async () => {
      await key('Escape')()
      const press = async (keyCode: string) => (w.webContents.sendInputEvent({ type: 'keyDown', keyCode }), w.webContents.sendInputEvent({ type: 'keyUp', keyCode }), await nap(60))
      if ((await js<number>("document.querySelectorAll('.side-scroll [role=treeitem][tabindex=\"0\"]').length")) !== 1) throw new Error('not one tab stop in the tree')
      await js("document.querySelector('.side-scroll [role=treeitem][tabindex=\"0\"]').focus()")
      for (let i = 0; i < 12 && !(await js<boolean>("(e => !!e && e.matches('.ws[data-row]:not(.sel)'))(document.activeElement)")); i++) await press('Down')
      ws.keyed = (await named((await js<string>("document.activeElement?.dataset.row ?? ''")).slice(3)))
      await press('Enter')
    }, async () => !!ws.keyed && (await has(`.ws.sel${row(ws.keyed.id)}`))],
    // U13: What's new after an update (seenVersion another version's): the card with this version's lines and All
    // changes; closed, it's seen: gone, and not back after a reload
    ['whats-new', async () => (await key('Escape')(), await rpc('settingsSet', { seenVersion: '0.0.1' })), async () => (await has('.whats-new li')) && (await hasText('.whats-new button', 'All changes'))],
    ['whats-new-once', async () => {
      await click('.whats-new header button')()
      await waitFor(async () => (await rpc<View>('state')).settings.seenVersion !== '0.0.1', 'seenVersion set')
      w.webContents.reload()
      await nap(1500)
      await waitFor(() => has('.sidebar, .welcome'), 'the window again')
    }, async () => !(await has('.whats-new'))],
    // View as page: a changed HTML file of the worktree by its 🌐 in Changes: the sandboxed frame from GET /worktree,
    // its CSS and script beside it loaded (asked of the frame's own document); Back closes it
    ['view-as-page', async () => {
      await key('Escape')()
      const d = await named('dark-mode')
      mkdirSync(join(d.path, 'emails'), { recursive: true })
      writeFileSync(join(d.path, 'emails/mail.css'), 'body { font: 16px sans-serif; padding: 40px } h1 { color: rgb(1, 2, 3) }')
      writeFileSync(join(d.path, 'emails/mail.js'), 'document.title = "ran"; document.querySelector("p").textContent = "Its script ran."')
      writeFileSync(join(d.path, 'emails/welcome.html'), '<link rel="stylesheet" href="mail.css"><h1>Welcome to Shop</h1><p></p><script src="mail.js"></script><img src="https://pics.invalid/hero.png" alt="">')
      writeFileSync(join(d.path, 'PLAN.md'), '# Dark mode plan\n\n## Goals\n\nShip it.\n\n### Colors\n\nTokens first.\n\n<h2>Rollout</h2>\n\nBehind a flag.\n')
      await click(row(d.id))()
      if (!(await has('[role=tab][aria-label="Changes"]'))) await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true, cancelable: true }))")
      await waitFor(() => has('[role=tab][aria-label="Changes"]'), 'the side panel')
      await click('[role=tab][aria-label="Changes"]')()
      await waitFor(() => has('.sp-change button[aria-label^="View as page"]'), 'its View as page', 15000)
      await click('.sp-change button[aria-label^="View as page"]')()
      await waitFor(() => has('iframe.art-frame[src*="/worktree/"]'), 'the frame')
    }, async () => {
      const f = w.webContents.mainFrame.framesInSubtree.find(f => f.url.includes('/worktree/'))
      return !!f && (await hasText('.modal button', 'Reload')) && (await f.executeJavaScript('document.title === "ran" && getComputedStyle(document.querySelector("h1")).color === "rgb(1, 2, 3)"').then(Boolean, () => false)) && (await hasText('.art-hosts', 'pics.invalid (1 image)')) // S18: its outside picture blocked, the bar says so
    }],
    // S18: Allow for this report: the bar gone, the page loaded again with the host (.invalid: no request leaves)
    ['art-allow', () => clickText('.art-hosts button', 'Allow for this report'), async () => !(await has('.art-hosts')) && (await has('iframe.art-frame[src*="/worktree/"]'))],
    ['view-as-page-back', () => clickText('.modal button', 'Back'), async () => !(await has('iframe.art-frame'))],
    // Outline: a Markdown file in Files, its headings under Go to heading…, a raw <h2> among them
    ['outline', async () => {
      await click('[role=tab][aria-label="Files"]')()
      await waitFor(() => hasText('.side-panel *', 'PLAN.md'), 'PLAN.md in Files', 15000)
      await js(`[...document.querySelectorAll('.side-panel *')].find(e => !e.children.length && e.textContent.trim() === 'PLAN.md')?.click()`)
      await waitFor(() => hasText('.pv-head button', 'Outline'), 'its Outline')
      await clickText('.pv-head button', 'Outline')
    }, async () => (await has('.menu .menu-filter')) && (await hasText('.menu-item', 'Rollout')) && (await hasText('.menu-item', 'Colors'))],
    // the tab bar's overflow: a workspace with 9 tabs in a 1000px window shows +n, and the selected tab among the shown
    ['tab-overflow', async () => {
      const w = await named('checkout-flow')
      for (let i = 0; i < 8; i++) await rpc('tabNew', { ws: w.id, preset: 'shell' })
      await link(`laki://ws/${w.id}`)()
      await size(1000, 800)
    }, async () => (await has('.tab-list > .tab-more')) && (await has('.tab-list > .tab.sel'))],
    ['tab-overflow-off', () => size(1440, 900), '.tab-list'],
    // the phone (390×844): its bottom bar (five columns, each a finger's size, one lit, at the very bottom), nothing wider
    // than the screen; Projects opens the drawer over the whole width (the main area inert) with Needs you's counts, Esc
    // closes it; More's sheet has the rest and Quiet, Esc closes it
    ['phone-bar', async () => (await size(390, 844), await waitFor(() => has('.app.narrow .phone-bar'), 'the bottom bar')), () => js<boolean>("(() => { const bs = [...document.querySelectorAll('.phone-bar .pb-item')]; const r = document.querySelector('.phone-bar').getBoundingClientRect(); return bs.length === 5 && bs.every(b => (x => x.width >= 44 && x.height >= 44)(b.getBoundingClientRect())) && document.querySelectorAll('.phone-bar [aria-current=page]').length === 1 && Math.abs(r.bottom - innerHeight) < 1 && document.scrollingElement.scrollWidth <= innerWidth })()")],
    ['phone-drawer', click('.phone-bar .pb-item'), () => js<boolean>("(() => { const s = document.querySelector('.sidebar')?.getBoundingClientRect(); return !!s && Math.abs(s.width - innerWidth) < 1 && document.querySelector('main.main').inert && (!document.querySelector('.needs-list') || /to answer|failed|finished/.test(document.querySelector('.needs-counts')?.textContent ?? '')) && (c => !c || c.scrollWidth <= c.clientWidth)(document.querySelector('.needs-counts')) && (b => !b || b.getBoundingClientRect().left < 24)(document.querySelector('.side-head button')) })()")], // Needs you's counts whole (their own line, never cut); the sidebar's button at its left, no traffic lights' room
    ['phone-drawer-esc', key('Escape'), async () => !(await has('.sidebar')) && !(await js<boolean>("document.querySelector('main.main').inert"))],
    ['phone-more', click('.phone-bar .pb-item:last-child'), async () => (await hasText('.phone-sheet .ps-row', 'Settings')) && (await has('.phone-sheet .ps-quiet button'))],
    ['phone-more-esc', key('Escape'), async () => !(await has('.phone-sheet'))],
    // T8: the phone's layout with a notched phone's insets (set as styles.css' --safe-*, as env() would): its bottom
    // bar's buttons end 34px over the bottom, clear of the home indicator; the tab bar's sidebar button starts at the left
    // inset (20px here), not past a Mac's traffic lights; then back to the desktop's
    ['phone-safe', async () => {
      await size(390, 844)
      await waitFor(() => has('.app.narrow'), 'the phone layout')
      await js("(s => [['t', 47], ['r', 0], ['b', 34], ['l', 20]].forEach(([k, v]) => s.setProperty(`--safe-${k}`, `${v}px`)))(document.documentElement.style)")
      await nap(300)
    }, () => js<boolean>("(() => { const bs = [...document.querySelectorAll('.status button, .side-foot button, .phone-bar button')].filter(b => b.getBoundingClientRect().height > 0); return bs.length > 0 && bs.every(b => b.getBoundingClientRect().bottom <= innerHeight - 34) && (x => !x || (x.left >= 20 && x.left < 44))(document.querySelector('.tabbar > .side-show')?.getBoundingClientRect()) })()")],
    ['phone-safe-off', async () => (await js("['t', 'r', 'b', 'l'].forEach(k => document.documentElement.style.removeProperty(`--safe-${k}`))"), await size(1440, 900)), () => js<boolean>("!document.querySelector('.app.narrow')")],
    // U4, last (it empties the world): no project, Welcome; the demo's gh is signed out: its row has Sign in, what passes one line
    ['welcome', async () => {
      for (const w of (await rpc<View>('state')).workspaces) await rpc('wsRm', { id: w.id }).catch(() => {})
      for (const p of (await rpc<View>('state')).projects) await rpc('projectRm', { id: p.id }).catch(() => {})
    }, async () => (await has('.welcome')) && (await hasText('.welcome-checks .check', 'not signed in')) && (await hasText('.welcome-checks button', 'Sign in')) && (await has('.welcome-ready'))],
  ]
  // the first run (LAKI_SMOKE_FIRST, ui-smoke.ts' own short launch on an empty data folder, before the demo's): Welcome,
  // then Try it on a sample repo lands on New workspace with the sample's task (0.49.1's fix: it ended on Laki hit an error)
  const firstRun: typeof steps = [
    ['first-welcome', null, '.welcome'],
    ['first-sample', () => clickText('.welcome button', 'Try it on a sample repo'), async () => (await has('.nw-composer')) && (await js<boolean>("[...document.querySelectorAll('.nw-composer textarea')].some(t => t.value.includes('Fix the failing test'))"))],
  ]
  // M1: the rich demo world (LAKI_DEMO_RICH): the README's stills instead of the walk, each in Laki's two themes (dark,
  // then light): Needs you with its answer buttons, a workspace's Done check and Collision radar, the phone's view
  const readme: typeof steps = []
  // the main panel's left edges (--pane-x): the terminal's text, the tab bar's first tab's icon, the check's icon and its
  // rows' marks start within 1px of one another (the words after an icon on --pane-x2)
  const aligned = () => js<boolean>("(() => { const x = s => document.querySelector(s)?.getBoundingClientRect().left; const term = document.querySelector('.check-strip') ? x('.pane.active .xterm-screen') ?? x('.xterm-screen') : undefined; const at = [x('.tab-list > :first-child :is(.icon-svg, .glyph)'), x('.check-strip .queue-head > :first-child'), x('.check-strip .check-mark')]; return term !== undefined && at.every(v => v !== undefined && Math.abs(v - term) <= 1) })()")
  // a still shows none of the demo's insides: the fakes, the temp folder (the page's words, and the terminals of the two
  // workspaces the stills show: canvas, not in its words)
  const leftovers = async () => {
    const tabs = (await rpc<View>('state')).tabs.filter(t => t.workspace === ws.cart?.id || t.workspace === ws.co?.id)
    const texts = [await js<string>('document.body.innerText'), ...(await Promise.all(tabs.map(t => rpc<string>('screen', { target: t.id, lines: 40 }).catch(() => ''))))]
    return texts.map(x => x.match(/fake|\/private\/tmp|laki-ui-/i)?.[0]).find(Boolean)
  }
  const size = (wd: number, h: number) => (w.isMaximized() && w.unmaximize(), w.setMinimumSize(Math.min(wd, 700), 400), w.setSize(wd, h), nap(600))
  if (process.env.LAKI_DEMO_RICH) {
    readme.push(['readme-setup', async () => {
      await size(1440, 900)
      ws.cart = await named('fix-cart-total')
      ws.co = await named('checkout-flow')
      await rpc('settingsSet', { radar: true })
      await rpc('projectSet', { id: ws.cart.project, config: { lint: 'echo "eslint: 0 problems"', test: 'echo "✖ total rounds to cents: 0.30000000000000004 !== 0.3"; exit 1', check: { steps: ['lint', 'test'] } } })
      // a collision: checkout-flow changes the lines fix-cart-total changes
      writeFileSync(join(ws.co.path, 'src/cart.js'), 'export function total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0)\n}\n')
      // two agents ask to run a command: Needs you's cards
      const v = await rpc<View>('state')
      const askers = await Promise.all(['rate-limiter', 'onboarding-screens'].map(async n => (await rpc<{ id: string }>('tabNew', { ws: (await named(n)).id, preset: 'claude' })).id))
      for (const id of askers) await claudeUp(id)
      for (const id of askers) await rpc('send', { target: id, text: 'perm bash :: npm test' })
      // fix-cart-total's agent finishes a turn: its Done check runs
      const tab = v.tabs.find(t => t.workspace === ws.cart.id && t.kind === 'agent')!
      await rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix the cart total rounding' } })
      await nap(300)
      await rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Totals round to cents now, so 0.1 + 0.2 shows as 0.30. Added a test for it.' } })
      await click(row(ws.co.id))()
      await click('.onboard-bar button')() // Get started's bar: hidden, as most have it by then
    }, () => hasText('.needs-allow-all', 'Allow all (2)')])
    for (const [theme, look] of [['laki', 'dark'], ['laki-light', 'light']]) {
      readme.push([`readme-needs-you-${look}`, async () => (await size(1440, 900), await key('Escape')(), await rpc('settingsSet', { theme, themeAuto: false }), await click(row(ws.co.id))(), await js("document.querySelector('.side-scroll').scrollTop = 0"), await nap(800)), '.needs-cards']) // Needs you from its head (the row's click scrolls; a still's sticky head isn't redrawn)
      // T7: the AI button over the check's strip, not on it (nothing docked at the bottom under it: data-dock)
      readme.push([`readme-check-radar-${look}`, async () => (await click(row(ws.cart.id))(), await waitFor(async () => (await has('.check-strip')) && (await has(`${row(ws.cart.id)} .ws-radar`)), 'its check and the radar', 30000)), async () => (await has('.check-strip')) && (await js<boolean>("(f => !!f && [...document.querySelectorAll('[data-dock=\"bottom\"]')].every(d => (a => (b => b.height === 0 || b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom)(d.getBoundingClientRect()))(f.getBoundingClientRect())))(document.querySelector('.ai-fab-wrap'))")) && (await aligned())])
      readme.push([`readme-phone-${look}`, async () => (await click(row(ws.co.id))(), await size(390, 844), await waitFor(() => has('.phone-bar'), 'the bottom bar'), (await has('.sidebar')) || (await click('.phone-bar .pb-item')()), await waitFor(() => has('.side-scroll'), 'the drawer'), await js("document.querySelector('.side-scroll').scrollTop = 0"), await nap(1500)), '.app.narrow']) // the drawer (Projects on the bottom bar), Needs you at its top, its cards settled
    }
    readme.push(['readme-done', () => size(1440, 900), async () => true])
  }
  // test:sheet (scripts/ui-sheet.ts' LAKI_SHEET, JSON: { looks, themes }): the walk's pages in each look and theme at
  // 1440×900, then the phone's (390×844) for PHONE's, each named <look>-<theme>-<page> with its layout facts; no flows.
  // ponytail: PHONE by hand, the pages a phone gets to from the remote page's rail
  const sheet: typeof steps = []
  if (process.env.LAKI_SHEET) {
    const { looks, themes, set } = JSON.parse(process.env.LAKI_SHEET) as { looks: string[]; themes: string[]; set?: Record<string, unknown> } // set: LAKI_SHEET_SET's settings
    const PAGES = ['projects', 'reader', 'review', 'new-workspace', 'settings', 'board', 'schedule', 'ai', 'workflows', 'palette']
    const PHONE = ['projects', 'reader', 'settings', 'board']
    const back = async () => (await key('Escape')(), (ws.cart ??= await named('fix-cart-total')), await click(row(ws.cart.id))(), await click('.reader-switch button:first-child')())
    // every wide one first: a phone's row click hides the sidebar and the rail, which a wide page then lacks
    for (const [wd, h, pages] of [[1440, 900, PAGES], [390, 844, PHONE]] as const)
      for (const look of looks)
        for (const theme of themes)
          for (const n of pages) {
            const [, go, sel] = steps.find(x => x[0] === n)!
            const first = n === pages[0]
            sheet.push([`${look}-${theme}-${wd < 500 ? 'phone-' : ''}${n}`, async () => {
              if (first) await rpc('settingsSet', { ...set, design: look, theme, themeAuto: false }), await size(wd, h)
              if (n === 'projects') return back()
              return go?.()
            }, n === 'projects' ? (wd < 500 ? '.app.narrow' : '.sidebar .ws') : sel])
          }
  }
  // the sheet's layout facts, a report: text cut short where it doesn't fit (text-overflow: clip, its own words wider
  // than its box; a scroller's not), and what reaches past the window's sides unclipped; 20 of each at most
  const facts = () => js<{ clipped: string[]; over: string[] }>(`(() => {
    const name = e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
    const clipped = [], over = []
    const shut = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true; return false } // clipped on the way: not seen past the side
    for (const e of document.querySelectorAll('body *')) {
      if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue
      const cs = getComputedStyle(e), r = e.getBoundingClientRect()
      const words = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      if (words && cs.textOverflow === 'clip' && !/auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) clipped.push(name(e))
      if (r.width && (r.right > innerWidth + 1 || r.left < -1) && !shut(e)) over.push(name(e))
    }
    return { clipped: [...new Set(clipped)].slice(0, 20), over: [...new Set(over)].slice(0, 20) }
  })()`)
  const out: { name: string; ok: boolean; ms: number; why?: string; facts?: { clipped: string[]; over: string[] } }[] = []
  // E8: the page's start to its first sidebar row painted (main.tsx' mark): what a lazy page saves shows here
  const first = await js<number>("performance.getEntriesByName('laki-sidebar')[0]?.startTime ?? -1").catch(() => -1)
  if (!process.env.LAKI_SMOKE_FIRST) out.push({ name: 'first-row', ok: first >= 0, ms: Math.round(first), ...(first < 0 && { why: 'no laki-sidebar mark' }) }) // Welcome has no row
  for (const [i, [name, go, sel]] of (process.env.LAKI_SMOKE_FIRST ? firstRun : sheet.length ? sheet : readme.length ? readme : steps).entries()) {
    const at = Date.now()
    const seen = errors.length
    let why: string | undefined
    try {
      await go?.()
      const ok = () => (typeof sel === 'string' ? has(sel) : sel())
      while (!(await ok()) && !(await has('.boom')) && Date.now() - at < 8000) await new Promise(r => setTimeout(r, 100))
      if (await has('.boom')) why = `the page threw: ${await js<string>("document.querySelector('.boom')?.textContent?.slice(0, 200) ?? ''")}`
      else if (!(await ok())) why = typeof sel === 'string' ? `no ${sel} after 8 s` : 'not done after 8 s'
      else if (errors.length > seen) why = `console: ${errors.slice(seen).join(' | ').slice(0, 300)}`
      else if (/^readme-(needs|check|phone)/.test(name)) why = await leftovers().then(bad => bad && `it shows "${bad}"`)
    } catch (e) {
      why = (e as Error).message
    }
    await new Promise(r => setTimeout(r, 250)) // drawn
    const png = join(dir, sheet.length ? `${name}.png` : `${String(i + 1).padStart(2, '0')}-${name}.png`)
    writeFileSync(png, (await w.webContents.capturePage()).toPNG()) // a failed one's too: what it showed
    out.push({ name, ok: !why, ms: Date.now() - at, ...(why && { why }), ...(sheet.length && { facts: await facts().catch(() => undefined), ...sheetDiff(png, name) }) })
    writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2)) // so far: a window killed midway shows where
    if (/(^|-)(palette|get-started|ship-sheet)$/.test(name)) await key('Escape')()
  }
  writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2))
  app.exit(out.every(s => s.ok) ? 0 : 1)
}
// R2: the main process's own log, <data>/app.log (rotated as daemon.log is): what went wrong here used to leave no
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
const openLink = (url: string) => {
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
const COMBO = /^(⌃?)(⌥?)(⇧?)(⌘?)(.+)$/
const accel = (m: RegExpExecArray, cmd = mac ? 'Command' : 'Super') => [m[1] && 'Control', m[2] && 'Alt', m[3] && 'Shift', m[4] && cmd, ACCEL_KEYS[m[5]] ?? m[5]].filter(Boolean).join('+')
function accelOf(label: string) {
  const m = COMBO.exec(label)
  const mods = [m?.[1], m?.[2], m?.[4]].filter(Boolean).length
  // a key with one of ⌃ ⌥ ⌘ (⌘K, ⌥A) would be taken from every app: two of them, or one with Space or an F key
  if (!m || !mods || (mods < 2 && !/^(Space|F\d{1,2})$/.test(m[5]))) return ''
  return accel(m)
}
type Key = 'open' | 'shot' | 'quick' | 'tell' | 'talk' | 'allow' | 'deny' // allow, deny: the newest ask answered (hotAnswer); open: Laki forward; shot: Screenshot to Laki AI (shotAsk); quick: the quick bar (Q1); tell: show and tell (Q7, tellShot); talk: the talk pill (Q2, talk)
const keys: Record<Key, string> = { open: '', shot: '', quick: '', tell: '', talk: '', allow: '', deny: '' } // what each holds
const wants: Record<Key, [string, () => void]> = { open: ['', show], shot: ['', show], quick: ['', show], tell: ['', show], talk: ['', show], allow: ['', show], deny: ['', show] } // what each asked for
let shotOn = false // Screenshot to Laki AI is on (Settings › General): the menu bar has it too
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
const updates = updater(s => win?.webContents.send('update', s))
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

// Settings › Layout's Menus: macOS: a workspace's or a tab's menu drawn by macOS (the renderer's menuModel, checked by
// guards.ts menuModelOk), popped up at the point; the picked item's id back, or nothing (closed). The app window only
ipcMain.handle('menu-popup', (e, model: unknown, x: unknown, y: unknown) => {
  if (!from(e)) return undefined
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
ipcMain.handle('accent', e => (from(e, 'new', 'ai', 'tab', 'quick') ? sysAccent() : null))
const accentNow = () => {
  const c = sysAccent()
  for (const w of BrowserWindow.getAllWindows()) if (appPage(w.webContents.getURL())) w.webContents.send('accent', c)
}
if (mac) systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', accentNow) // macOS posts this one; Electron's accent-color-changed is Windows'
systemPreferences.on('accent-color-changed', accentNow)
// macOS's Show scroll bars (System Settings › Appearance): 'overlay' (a thumb only while scrolling, hovered or focused:
// styles.css html[data-scrollbars]) unless Always; off a Mac always. A change goes to the app's windows
const sysScroll = () => (mac && systemPreferences.getUserDefault('AppleShowScrollBars', 'string') !== 'Always' ? 'overlay' : 'always')
ipcMain.handle('scrollbars', e => (from(e, 'new', 'ai', 'tab', 'quick') ? sysScroll() : 'always')) // the app's pages only, as accent
if (mac) systemPreferences.subscribeNotification('AppleShowScrollBarsSettingChanged', () => { for (const w of BrowserWindow.getAllWindows()) if (appPage(w.webContents.getURL())) w.webContents.send('scrollbars', sysScroll()) })
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
let trayNow: TrayState | undefined // the last badge's state (its picture), for a drop's highlight and back
let quietUntil = 0 // U8: the last badge's: quiet until (ms), its picture slashed, End Quiet in the menu
const quietOn = () => quietUntil > Date.now()
const quietSet = (o: object) => void rpc('dndSet', o).catch(() => {})
let trayBuilt: Menu | null = null // the menu: the tray's own (a click), or a right click's with Inbox
function trayMenu() {
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
export function tellShot() {
  if (screenOff()) return privacySay('screen')
  const bar = quickW && !quickW.isDestroyed() && quickW.isVisible() ? quickW : null
  bar?.hide() // out of the picture, as its own screenshot button's
  screenshot(true, undefined, png => ((tellPng = png), quickWin(), void tellSend()), () => (bar?.isDestroyed() === false && bar.show(), screenOff(true) && privacySay('screen')))
}
async function tellSend() {
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
function trayDrops(t: Tray) {
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
function shotAsk() {
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


// the menu bar's icon: Laki's mark (a chevron and a dot) as a 32×32 template image (@2x), one per state (Q8: shared/
// tray.ts' trayBitmap: idle, working, waiting, blocked), made once each: macOS colors it for a light or dark menu bar
// and the highlight from its alpha alone
const trayIcons = new Map<string, Electron.NativeImage>()
function trayIcon(state: TrayState = 'waiting', quiet = false, drop = false) {
  const key = `${state}${quiet ? ' quiet' : ''}${drop ? ' drop' : ''}`
  let img = trayIcons.get(key)
  if (!img) {
    img = nativeImage.createFromBitmap(trayBitmap(state, { quiet, drop }), { width: TRAY_PX, height: TRAY_PX, scaleFactor: 2 })
    img.setTemplateImage(true)
    trayIcons.set(key, img)
  }
  return img
}
ipcMain.on('open-external', (e, url: string) => {
  if (!from(e, 'new', 'ai', 'tab')) return
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
  const from = (win && e.sender === win.webContents) || [...tabWins.values()].some(w => !w.isDestroyed() && w.webContents === e.sender)
  if (!from || typeof path !== 'string' || !path.startsWith('/')) return false
  const real = await realpath(path).catch(() => '')
  if (!real) return false
  shell.showItemInFolder(real)
  return true
})
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

// C10: a file's row dragged out (Changes, Files, Artifacts, a turn's files) to Finder, Slack, a mail or an upload box:
// macOS's own file drag, now (it must start while the mouse is down: sync). The app window's or a floated tab's; a
// regular file inside root (its workspace or storage folder: dragOk), never the data folder's own (daemon.json's token,
// keys; its storage/ is the artifacts'). Its icon: its kind's, once
// app.getFileIcon has it (async), a generic document's meanwhile
const dragIcons = new Map<string, Electron.NativeImage>()
ipcMain.on('drag-out', (e, path: unknown, root: unknown) => {
  if (!from(e, 'tab') || typeof path !== 'string' || typeof root !== 'string') return
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
  if (!mac || !from(e, 'tab') || typeof path !== 'string' || !path.startsWith('/')) return
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
  const pid = daemonInfo()?.pid
  const asked = await rpc('shutdown', {}, 10000).then(() => true, () => false) // the daemon first asks who calls (lsof, ps): a busy Mac takes a while, and a call given up is refused
  for (let i = 0; asked && pid && i < 40 && running(pid); i++) await new Promise(r => setTimeout(r, 250))
  if (pid && running(pid)) await stopDaemon(pid) // refused (another Laki, or the app before an update, started it): as the Restart button stops it
  app.quit()
}

// the renderer owns ⌘W/⌘N/⌘T/⌘K…: the menu shows each key without registering it (the key still goes to App's
// keys), and a click sends it there as browser-key, as a Browsers page does: a fixed one's key, or one of Settings ›
// Keys' by its id (bound: its keys in keysNow, from the app window's keys IPC, which builds the menu again)
// ponytail: Toggle Sidebar has one title; Show/Hide by its state would need the renderer to rebuild the menu
let keysNow = keyMap()
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
const appMenu = () => Menu.setApplicationMenu(
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
        { role: 'pasteAndMatchStyle' },
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
