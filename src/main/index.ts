// Electron main: one window, the daemon started (detached, as node) if it isn't running, and a few
// native services for the renderer: daemon address, notifications, folder picker, external links, laki:// links,
// the preview pane's webview (localhost only) and its screenshots.
import { app, autoUpdater, BrowserWindow, type BrowserWindowConstructorOptions, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, net, Notification, protocol, screen, session, shell, systemPreferences, Tray, webContents } from 'electron'
import { execFile, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appToken, daemonInfo, dataDir, ensureDaemon, logLine, rpc } from '../shared/conn.ts'
import { cardQueue, cardRect, type CardEvent, type CardLife, fullScreen, islandDisplay, lifeStep, type Pin, type PinEv, pillRect, pinStep, type Rect } from '../shared/island.ts'
import { talkDefault } from '../shared/talk.ts'
import { type KeyId, keyFor, keyMap } from '../shared/keys.ts'
import { TRAY_PX, TRAY_STATES, trayBitmap, type TrayInfo, type TrayState, trayTip, trayTitle } from '../shared/tray.ts'
import { type BrowseDid, pageChanges, urlIs, type View } from '../shared/types.ts'
import { AGENT_BROWSER, APP_ORIGIN, APP_SCHEME, appFile, appPage as isAppPage, BROWSER, externalOf, fromApp as senderOk, fromTokenPage, local, pageIs, PREVIEW, web, webviewOk } from './guards.ts'
import { updater } from './update.ts'

// a dev build's: the page its windows load and the daemon's extra origin. An installed app takes neither from its
// environment (launchctl setenv reaches every launch), nor passes them on to the daemon and agents
if (app.isPackaged) delete process.env.ELECTRON_RENDERER_URL, delete process.env.LAKI_DEV_ORIGIN
delete process.env.LAKI_TAB_TOKEN // S12: opened from a Laki tab (open passes the environment on): the app's own calls are yours, not that tab's agent's
const dev = !!process.env.ELECTRON_RENDERER_URL
// the app's own pages, its windows' (built: app://laki/, nothing else serves one), not a site or a frame inside them
const devOrigin = dev ? new URL(process.env.ELECTRON_RENDERER_URL!).origin : ''
const appPage = (url: string | undefined) => isAppPage(url, devOrigin)
const sender = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => ({ type: e.sender.getType(), main: e.senderFrame === e.sender.mainFrame, url: e.senderFrame?.url })
const fromApp = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => senderOk(sender(e), devOrigin)
// S9: the built pages on app://laki/ (out/renderer's files, nothing else; dev: the dev server's), a page by its file
// name and its query or hash: what each window loads
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true, stream: true } }])
const RENDERER = fileURLToPath(new URL('../renderer/', import.meta.url))
const pageURL = (file: string, more = '') => (dev ? `${new URL(file === 'index.html' ? '' : file, `${process.env.ELECTRON_RENDERER_URL}/`).href}${more}` : `${APP_ORIGIN}/${file}${more}`)
// from the app window, or one of the app's other pages by name: new (the new-workspace window), ai, tab (a floated
// tab: ?window=), voice (the bubbles' Say it); nothing else (a site in a webview, a frame, another window)
type Page = 'new' | 'ai' | 'tab' | 'voice' | 'quick' // quick: the quick bar (Q1)
const from = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, ...pages: Page[]) =>
  fromApp(e) && ((!!win && e.sender === win.webContents) || pages.some(p => (p === 'voice' ? !!voice && e.sender === voice.webContents : pageIs(e.senderFrame?.url, p))))
// scripts/pack-smoke.sh's: a screenshot of the window 3s after load, the notifications as posted. Switches, not env:
// none reach a launch from Finder or the Dock
const capture = app.commandLine.getSwitchValue('laki-capture')
const notifyLog = app.commandLine.getSwitchValue('laki-notify-log')
const smoke = app.commandLine.getSwitchValue('laki-smoke') // R8: scripts/ui-smoke.ts' folder

// R8 --laki-smoke=<dir> (npm run test:ui): the real window walked page by page. Each step opens a page (its laki://
// link, a click, a key), waits for something only that page draws, and fails on ui.tsx' Boundary (.boom) or an error
// in the console; a screenshot each, result.json at the end, then the app quits (1: a step failed)
async function uiSmoke(w: BrowserWindow, dir: string) {
  mkdirSync(dir, { recursive: true })
  const errors: string[] = []
  w.webContents.on('console-message', (_e, level, message) => void (level >= 3 && errors.push(message)))
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
  const fakeLog = () => (f => (existsSync(f) ? readFileSync(f, 'utf8') : ''))(join(process.env.HOME ?? '', 'fake.log'))
  const ws: Record<string, View['workspaces'][number]> = {}
  let before = 0 // the quick bar's step: workspaces before it sends
  const cart = () => readFileSync(join(ws.cart.path, 'src/cart.js'), 'utf8')
  const checkout = () => join(ws.co.path, 'src/checkout.js')
  const steps: [string, (() => Promise<unknown>) | null, string | (() => Promise<boolean>)][] = [
    ['projects', null, '.sidebar .ws'],
    ['switch-apart', null, () => apart('.reader-switch', '.pane.active .xterm-screen')], // U2: Terminal | Reader off the terminal's lines
    ['reader', click('.reader-switch button:last-child'), '.reader'],
    ['fab-apart', null, () => apart('.ai-fab', '.rd-box button.primary')], // U2: the AI button off the Reader's Send
    ['review', click('.review-tab'), '.full-review'],
    ['new-workspace', link('laki://new'), '.nw-composer'],
    ['settings', link('laki://settings'), '.settings-page'],
    // U10: Basic shows four heads, each only its cards (Look: Theme first); All again; Layout by its link
    ['settings-basic', async () => { await waitFor(() => has('.settings-view button'), 'Basic | All'); await clickText('.settings-view button', 'Basic'); await waitFor(() => hasText('.settings-nav button', 'Git & PRs'), 'the Basic heads'); await clickText('.settings-nav button', 'Look') }, async () => (await has('.settings-main[data-basic]')) && (await js<string>("document.querySelector('.settings-main .set-group h3')?.textContent ?? ''")) === 'Theme' && !(await hasText('.settings-main h3', 'Rail'))],
    ['settings-layout', async () => (await clickText('.settings-view button', 'All'), await link('laki://settings/layout?spot=Rail')()), async () => !(await has('.settings-main[data-basic]')) && (await hasText('.settings-main h2', 'Layout')) && (await hasText('.settings-main h3', 'Rail'))],
    // All's list is taller than the window: it scrolls, no row squeezed under its text
    ['settings-rows', null, () => js<boolean>(`[...document.querySelectorAll('.settings-nav > button')].every(b => b.scrollHeight <= b.clientHeight + 1)`)],
    ['board', link('laki://board'), '.board'],
    ['schedule', link('laki://schedules'), '.sched-empty, .sched-row, .ghosts'],
    ['ai', link('laki://ai'), '.ai-page'],
    ['workflows', click('[data-rail="workflows"]'), '.wf-page, .sched-empty'],
    ['palette', key('k', true), '.palette-input'],
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
    ['flow-archive-undo', click('.toast-undo'), async () => (await has(row(ws.dark.id))) && !(await named('dark-mode')).archived],
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
      for (const id of agents) await waitFor(async () => (await rpc<string>('screen', { target: id, lines: 10 })).includes('fake claude'), 'its claude started', 15000)
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
      await waitFor(async () => (await rpc<string>('screen', { target: t, lines: 10 })).includes('fake claude'), 'its claude started', 15000)
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
    // U5: the Ship sheet on dark-mode (notes.txt uncommitted): its file with a box, the PR's title drafted, Open PR
    ['ship-sheet', async () => {
      await key('Escape')()
      await click(row(ws.dark.id))()
      await waitFor(() => has('.tabbar [aria-label^="Ship:"]'), 'the Ship button')
      await click('.tabbar [aria-label^="Ship:"]')()
    }, async () => (await hasText('.ship-file', 'notes.txt')) && (await js<string>("document.querySelector('.ship-form input')?.value ?? ''")) !== '' && (await hasText('.ship button.primary', 'Open PR'))],
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
    // U4, last (it empties the world): no project, Welcome; the demo's gh is signed out: its row has Sign in, what passes one line
    ['welcome', async () => {
      for (const w of (await rpc<View>('state')).workspaces) await rpc('wsRm', { id: w.id }).catch(() => {})
      for (const p of (await rpc<View>('state')).projects) await rpc('projectRm', { id: p.id }).catch(() => {})
    }, async () => (await has('.welcome')) && (await hasText('.welcome-checks .check', 'not signed in')) && (await hasText('.welcome-checks button', 'Sign in')) && (await has('.welcome-ready'))],
  ]
  // M1: the rich demo world (LAKI_DEMO_RICH): the README's stills instead of the walk, each in Laki's two themes (dark,
  // then light): Needs you with its answer buttons, a workspace's Done check and Collision radar, the phone's view
  const readme: typeof steps = []
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
      for (const id of askers) await waitFor(async () => (await rpc<string>('screen', { target: id, lines: 10 })).includes('fake claude'), 'its claude started', 15000)
      for (const id of askers) await rpc('send', { target: id, text: 'perm bash :: npm test' })
      // fix-cart-total's agent finishes a turn: its Done check runs
      const tab = v.tabs.find(t => t.workspace === ws.cart.id && t.kind === 'agent')!
      await rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix the cart total rounding' } })
      await nap(300)
      await rpc('hook', { tab: tab.id, state: 'idle', payload: { hook_event_name: 'Stop', last_assistant_message: 'Done: totals round to cents.' } })
      await click(row(ws.co.id))()
      await click('.onboard-bar button')() // Get started's bar: hidden, as most have it by then
    }, () => hasText('.needs-allow-all', 'Allow all (2)')])
    for (const [theme, look] of [['laki', 'dark'], ['laki-light', 'light']]) {
      readme.push([`readme-needs-you-${look}`, async () => (await size(1440, 900), await key('Escape')(), await rpc('settingsSet', { theme, themeAuto: false }), await click(row(ws.co.id))(), await nap(800)), '.needs-cards'])
      readme.push([`readme-check-radar-${look}`, async () => (await click(row(ws.cart.id))(), await waitFor(async () => (await has('.check-strip')) && (await has(`${row(ws.cart.id)} .ws-radar`)), 'its check and the radar', 30000)), '.check-strip'])
      readme.push([`readme-phone-${look}`, async () => (await click(row(ws.co.id))(), await size(390, 844)), '.app.narrow'])
    }
    readme.push(['readme-done', () => size(1440, 900), async () => true])
  }
  const out: { name: string; ok: boolean; ms: number; why?: string }[] = []
  // E8: the page's start to its first sidebar row painted (main.tsx' mark): what a lazy page saves shows here
  const first = await js<number>("performance.getEntriesByName('laki-sidebar')[0]?.startTime ?? -1").catch(() => -1)
  out.push({ name: 'first-row', ok: first >= 0, ms: Math.round(first), ...(first < 0 && { why: 'no laki-sidebar mark' }) })
  for (const [i, [name, go, sel]] of (readme.length ? readme : steps).entries()) {
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
    } catch (e) {
      why = (e as Error).message
    }
    await new Promise(r => setTimeout(r, 250)) // drawn
    writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}-${name}.png`), (await w.webContents.capturePage()).toPNG()) // a failed one's too: what it showed
    out.push({ name, ok: !why, ms: Date.now() - at, ...(why && { why }) })
    writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2)) // so far: a window killed midway shows where
    if (name === 'palette' || name === 'get-started' || name === 'ship-sheet') await key('Escape')()
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

const mac = process.platform === 'darwin' // elsewhere (Linux): the system's title bar, and closing the window quits (no Dock to bring it back)
let win: BrowserWindow | null = null
let pendingTab: string | null = null
let quitting = false
let link: string | null = null // a laki:// link that came before the renderer listened
let linkReady = false // the renderer listens for links
let shot: [string, string] | null = null // a screenshot (a PNG, base64, and its note) from the menu bar, before the renderer listened
let shotReady = false // the renderer listens for screenshots
let folders: string[] = [] // folders dropped on the Dock icon before the renderer listened (a cold launch: before ready)
let foldersReady = false // the renderer listens for them

// Laki.AppImage --headless … (Laki.app/Contents/MacOS/Laki too): laki serve through Electron's own node, before any
// window or display: a server's daemon and remote access, no app (docs/headless.md)
const headless = process.argv.indexOf('--headless')
if (headless > 0) {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url))
  const chromium = /^--(no-sandbox|disable-gpu[\w-]*|in-process-gpu|ozone-platform(-hint)?(=.*)?|enable-features=.*|disable-features=.*|user-data-dir=.*)$/ // a window's switches (the AppImage's --no-sandbox): none here, so not laki serve's
  const r = spawnSync(process.execPath, [cli, 'serve', ...process.argv.slice(headless + 1).filter(a => !chromium.test(a))], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LAKI_HEADLESS_PARENT: String(process.pid) } })
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
// host's terminals go on). ponytail: one another Laki started refuses this shutdown (who's calling); the window then
// stays unconnected until Quit Laki Completely
const ORIGIN_API = 167
let checked = false
async function daemon() {
  const info = await start()
  if (checked) return info
  checked = true
  const r = await rpc<{ api?: number } | string>('ping', { caps: true }).catch(() => undefined)
  if (r === undefined || (typeof r === 'object' && (r.api ?? 0) >= ORIGIN_API)) return info
  appLog(`the daemon (pid ${info.pid}) is older than this app's window: restarted`)
  await rpc('shutdown', { keep: true }).catch(() => {})
  for (let i = 0; i < 60 && running(info.pid); i++) await new Promise(r => setTimeout(r, 250))
  return start()
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

function create() {
  const at = winAt()
  float = !!at?.float
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(at && { x: at.x, y: at.y, width: at.width, height: at.height }),
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#0e1014',
    visualEffectState: 'active', // glass keeps its blur when the window isn't focused
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
    if (smoke) setTimeout(() => win && void uiSmoke(win, smoke), 1500)
  })
  win.loadURL(pageURL('index.html'))
}

// an achievement only main sees (shared/achievements.ts): App's earn, as for a call
const earn = (id: 'hotkey' | 'bubble') => win?.webContents.send('earn', id)

function show(tab?: string, panel?: 'changes') {
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
type Key = 'open' | 'shot' | 'quick' | 'tell' | 'talk' // open: Laki forward; shot: Screenshot to Laki AI (shotAsk); quick: the quick bar (Q1); tell: show and tell (Q7, tellShot); talk: the talk pill (Q2, talk)
const keys: Record<Key, string> = { open: '', shot: '', quick: '', tell: '', talk: '' } // what each holds
const wants: Record<Key, [string, () => void]> = { open: ['', show], shot: ['', show], quick: ['', show], tell: ['', show], talk: ['', show] } // what each asked for
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
const running = (pid: number) => {
  try {
    return process.kill(pid, 0), true
  } catch {
    return false
  }
}
ipcMain.handle('daemon-restart', async e => {
  if (!from(e) || quitting) return false
  const pid = daemonInfo()?.pid
  if (!pid || !/\bout\/main\/daemon\.js\b/.test(spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '')) return false
  logLine(join(dataDir(), 'daemon.log'), `the app restarts the daemon (pid ${pid}): it refused this app's shutdown (another Laki started it)`)
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 60 && running(pid); i++) await new Promise(r => setTimeout(r, 250))
  if (running(pid)) return false
  await daemon()
  return true
})
ipcMain.handle('conn', async e => {
  if (!fromTokenPage(sender(e), devOrigin)) throw new Error('not the app') // the token: index.html's pages only (S9: not a card's, the bubbles' or the editor's)
  if (quitting) throw new Error('quitting') // after Quit Completely: no new daemon
  const { port, token } = await daemon()
  return { port, token: appToken() ?? token } // S1: the app's; daemon.json's only when it couldn't be had (its calls that ask who are refused)
})
// sound: a macOS sound's name (Settings › General), 'none', or unset: the default. actions: buttons (a waiting agent's
// choices, or a permission prompt's Allow and Deny; macOS shows the first with the Alerts style and the rest under
// Options, all under Options with Banners): each answers its menu straight through the daemon (the window may be
// closed by then), by its number and words, or Allow / Deny by first and last. Kept until used or closed: a
// collected Notification's events never come
type NoteAction = { text: string; stop?: boolean; n?: number; label?: string; pick?: 'first' | 'last'; tool?: { req: string; allow: string }; alert?: { id: string; choice: string } } // tool: an extension's tool call, answered (widgetToolAnswer); alert: laki alert's choice (alertAnswer)
const notes = new Set<Notification>()
// card: something marked important (a workspace, a timer, a reminder, laki alert) as a card on screen instead (addCard):
// ask, a waiting agent's (its change's diff with it); alert, laki alert's id (its choices answer it, its × too); tone,
// its edge's color
type CardOpts = { diff?: unknown; ask?: unknown; alert?: unknown; tone?: unknown; origin?: unknown }
ipcMain.on('notify', (e, title: string, body: string, tab: string, sound?: string, actions?: NoteAction[], card?: CardOpts) => {
  if (!fromApp(e)) return
  if (notifyLog) appendFileSync(notifyLog, JSON.stringify({ title, body, tab, sound, actions, ...(card && { card: true }) }) + '\n') // smoke tests
  const named = typeof sound === 'string' && /^[A-Za-z]+$/.test(sound) && sound !== 'none'
  const buttons = (Array.isArray(actions) ? actions : []).filter(a => typeof a?.text === 'string' && (a.stop === true || Number.isInteger(a.n) || a.pick === 'first' || a.pick === 'last' || typeof a.tool?.req === 'string' || (typeof a.alert?.id === 'string' && typeof a.alert.choice === 'string'))).slice(0, 9)
  if (card && typeof card === 'object') {
    if (sound !== 'none') execFile('afplay', [`/System/Library/Sounds/${named ? sound : 'Glass'}.aiff`], () => {})
    const t = typeof tab === 'string' ? tab : ''
    const ask = card.ask === true && !!t
    const alert = typeof card.alert === 'string' && /^[\w-]{1,40}$/.test(card.alert) ? card.alert : ''
    const actions = alert ? buttons.filter(a => a.alert?.id === alert) : buttons.filter(a => !a.tool && !a.alert)
    // S10: a laki alert has a tone of its own, never an ask's (a permission prompt's), and its origin line from the daemon
    const tone = alert ? 'alert' : ask ? 'ask' : ['ok', 'bad'].includes(card.tone as string) ? (card.tone as Card['tone']) : 'info'
    const origin = alert && typeof card.origin === 'string' ? card.origin.slice(0, 200) : undefined
    return addCard({ key: alert ? `alert:${alert}` : t ? `tab:${t}` : `n:${++cardN}`, tab: t, ask, tone, at: Date.now(), title: String(title), body: String(body), ...(typeof card.diff === 'string' && { diff: card.diff }), ...(origin && { origin }), actions })
  }
  const n = new Notification({ title, body, silent: sound === 'none', ...(named && { sound }), actions: buttons.map(a => ({ type: 'button' as const, text: a.text.slice(0, 60) })) })
  const done = () => notes.delete(n)
  n.on('click', () => (done(), show(tab)))
  n.on('action', (_ev, i) => {
    done()
    const a = buttons[i]
    if (a?.tool) rpc('widgetToolAnswer', { req: a.tool.req, allow: a.tool.allow }).catch(() => {})
    else if (a?.stop) rpc('longStop', { tab }).catch(() => show(tab)) // a long turn's Stop: its Esc, if that turn still runs
    else if (a) rpc('answer', { tab, ...(a.n ? { n: a.n, label: typeof a.label === 'string' ? a.label : undefined } : { pick: a.pick }) }).catch(() => show(tab)) // it moved on: look
  })
  n.on('close', done)
  notes.add(n)
  if (notes.size > 50) notes.delete(notes.values().next().value!) // ponytail: the oldest go; Notification Center keeps them for days
  n.show()
})

// cards on screen (what's marked important: a workspace's asks and finishes, a timer, a reminder): a card each at the
// bottom right of the screen the pointer was on as the first came, over every app, Space and full-screen app (a panel:
// no focus taken, a click lands at once), stacked, the newest on top. key: one per tab (its ask, its finish: the newer
// replaces it), else its own. An ask stays until it's answered there or anywhere else (asking: the tabs still
// waiting), any card until it's opened or closed (×, Close all)
type Card = { key: string; tab: string; ask: boolean; tone: 'ask' | 'ok' | 'bad' | 'info' | 'alert'; at: number; title: string; body: string; diff?: string; origin?: string; actions: NoteAction[]; error?: string }
const CARD_W = 380
let cards: Card[] = []
let cardN = 0
let cardWin: BrowserWindow | null = null
let cardAt: Electron.Rectangle | null = null // the screen's work area it's in, while it shows
function addCard(c: Card) {
  cards = [c, ...cards.filter(x => x.key !== c.key)].slice(0, 20) // ponytail: the oldest past 20 go
  if (!cardWin || cardWin.isDestroyed()) {
    const w = (cardWin = new BrowserWindow(floatOpts(CARD_W, 120)))
    w.setAlwaysOnTop(true, 'screen-saver') // over other apps' floating windows too
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    w.webContents.on('will-navigate', e => e.preventDefault())
    w.webContents.setWindowOpenHandler(({ url }) => (/^(https?:\/\/|mailto:)/i.test(url) && void shell.openExternal(url), { action: 'deny' })) // a card's link (its Markdown's: target _blank): the browser
    w.webContents.on('did-finish-load', sendCards)
    w.on('closed', () => cardWin === w && ((cardWin = null), (cardAt = null)))
    w.loadURL(pageURL('ask.html'))
  } else sendCards()
}
const sendCards = () => (cards.length ? cardWin?.webContents.send('ask-cards', cards, floats.colors) : (cardWin?.hide(), (cardAt = null)))
const dropCards = (keep: (c: Card) => boolean) => {
  const still = cards.filter(keep)
  if (still.length !== cards.length) (cards = still), sendCards()
}
const cardSender = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!cardWin && !cardWin.isDestroyed() && e.sender === cardWin.webContents
const cardOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, key: unknown) => (cardSender(e) && typeof key === 'string' ? cards.find(x => x.key === key) : undefined)
// its height (the page's, every card in it), kept to the screen; bottom right of the work area
ipcMain.on('ask-size', (e, h: unknown) => {
  if (!cardSender(e) || typeof h !== 'number' || !(h > 0) || !cards.length) return
  cardAt ??= screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const height = Math.round(Math.min(h, cardAt.height - 24))
  cardWin!.setBounds({ x: cardAt.x + cardAt.width - CARD_W - 12, y: cardAt.y + cardAt.height - height - 12, width: CARD_W, height })
  if (!cardWin!.isVisible()) cardWin!.showInactive()
})
// a choice: its menu answered as the notification's would be; refused (it moved on): said on the card
ipcMain.handle('ask-act', async (e, key: unknown, i: unknown) => {
  const c = cardOf(e, key)
  const a = c && typeof i === 'number' ? c.actions[i] : undefined
  if (!c || !a) return
  try {
    if (a.alert) await rpc('alertAnswer', { id: a.alert.id, choice: a.alert.choice })
    else await rpc('answer', { tab: c.tab, ...(a.n ? { n: a.n, label: typeof a.label === 'string' ? a.label : undefined } : { pick: a.pick }) })
    dropCards(x => x !== c)
  } catch (err) {
    c.error = `${(err as Error).message}: open ${c.tab ? 'its tab' : 'Laki'}`
    sendCards()
  }
})
// closed: a laki alert that waits hears it (no choice)
const closed = (c: Card) => c.key.startsWith('alert:') && void rpc('alertAnswer', { id: c.key.slice(6) }).catch(() => {})
ipcMain.on('ask-close', (e, key: unknown) => (c => c && (closed(c), dropCards(x => x !== c)))(cardOf(e, key)))
ipcMain.on('ask-close-all', e => cardSender(e) && (cards.forEach(closed), dropCards(() => false)))
ipcMain.on('ask-open', (e, key: unknown) => {
  const c = cardOf(e, key)
  if (!c) return
  if (!c.actions.length) dropCards(x => x !== c) // one with choices stays: it's answered there
  app.focus({ steal: true })
  show(c.tab || undefined)
})
// a laki alert answered, timed out or gone (alertDone, the app window's): its card goes
ipcMain.on('card-gone', (e, key: unknown) => e.sender === win?.webContents && typeof key === 'string' && dropCards(c => c.key !== key))
// the app window's tabs that wait: an agent's ask whose tab no longer does goes
ipcMain.on('asking', (e, tabs: unknown) => e.sender === win?.webContents && Array.isArray(tabs) && dropCards(c => !c.ask || tabs.includes(c.tab)))

// a timer's end with its dialog (Settings › General › Timers): one of macOS's sounds, whatever notifications say
ipcMain.on('sound', (e, name: string) => {
  if (from(e) && typeof name === 'string' && /^[A-Za-z]+$/.test(name)) execFile('afplay', [`/System/Library/Sounds/${name}.aiff`], () => {})
})

// the agent browser (laki browser, MCP's laki_browser): a hidden window per workspace in the preview's session, kept
// to this Mac's localhost as the preview is, gone after 10 idle minutes; ops come from the daemon through the renderer
type Browse = { ws: string; home: string; op: string; url?: string; selector?: string; text?: string; expect?: string } // expect: --expect-url's
// errors, blocked: what the page did during an op (its answer's), 20 of each; turn: the op before (one at a time: two
// at once would mix their clicks and their reports)
type AgentWin = { w: BrowserWindow; idle?: ReturnType<typeof setTimeout>; errors: string[]; blocked: string[]; turn: Promise<unknown> }
const agentWins = new Map<string, AgentWin>()
const pageJs = (f: string, ...args: unknown[]) => `(${f})(${args.map(a => JSON.stringify(a)).join(',')})`
ipcMain.handle('browse', async (e, r: Browse) => {
  if (e.sender !== win?.webContents) throw new Error('not the app window')
  let a = agentWins.get(r.ws)
  if (!a || a.w.isDestroyed()) {
    const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { partition: AGENT_BROWSER, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }) // hidden: its timers at full speed
    const made: AgentWin = { w, errors: [], blocked: [], turn: Promise.resolve() }
    const block = (u: string) => made.blocked.length < 20 && made.blocked.push(u.slice(0, 300))
    w.webContents.setWindowOpenHandler(d => (block(d.url), { action: 'deny' }))
    w.webContents.on('will-navigate', (ev, u) => !local(u) && (ev.preventDefault(), block(u)))
    w.webContents.on('will-redirect', (ev, u) => !local(u) && (ev.preventDefault(), block(u)))
    w.webContents.on('console-message', ev => ev.level === 'error' && made.errors.length < 20 && made.errors.push(ev.message.slice(0, 300)))
    agentWins.set(r.ws, (a = made))
  }
  const entry = a
  clearTimeout(entry.idle)
  entry.idle = setTimeout(() => {
    if (agentWins.get(r.ws) === entry) agentWins.delete(r.ws)
    if (!entry.w.isDestroyed()) entry.w.destroy()
  }, 10 * 60e3)
  const go = entry.turn.then(() => browseOp(entry, r))
  entry.turn = go.catch(() => {})
  return go
})
async function browseOp(entry: AgentWin, r: Browse) {
  entry.errors.length = entry.blocked.length = 0 // this op's only
  const wc = entry.w.webContents
  // what a click starts gets a moment; a page it loads, until it's loaded (5 s at most)
  const settle = async () => {
    await new Promise(ok => setTimeout(ok, 300))
    if (wc.isLoading())
      await new Promise<void>(ok => {
        const done = () => (clearTimeout(t), wc.off('did-stop-loading', done), ok())
        const t = setTimeout(done, 5000)
        wc.once('did-stop-loading', done)
      })
  }
  const lines = () => wc.executeJavaScript(`(document.body?.innerText ?? '').slice(0, 200000)`).then((t: string) => t.split('\n').map(l => l.trim()).filter(Boolean), () => [] as string[])
  const caused = () => ({ ...(entry.errors.length > 0 && { errors: [...entry.errors] }), ...(entry.blocked.length > 0 && { blocked: [...entry.blocked] }) })
  if (r.op === 'open' || !wc.getURL()) {
    const u = r.url ?? r.home
    if (!local(u)) throw new Error(`only this Mac's localhost: ${u}`)
    await wc.loadURL(u).catch(err => {
      throw new Error(/ERR_CONNECTION_REFUSED/.test(String(err)) ? `nothing listens on ${new URL(u).host}: start the dev server (laki run)` : String(err.message ?? err))
    })
  }
  if (r.op === 'open') await settle() // its scripts' first errors
  const page = { url: wc.getURL(), title: wc.getTitle() }
  if (r.expect && !urlIs(page.url, r.expect)) throw new Error(`the agent browser is on ${page.url}, not ${r.expect}: nothing done`)
  if (r.op === 'open') return { ...page, ...caused() }
  if (r.op === 'screenshot') {
    const img = await wc.capturePage()
    if (img.isEmpty()) throw new Error('nothing painted yet: try again')
    return { url: page.url, png: img.toPNG().toString('base64') }
  }
  if (r.op === 'text') return { ...page, text: await wc.executeJavaScript(`(document.body?.innerText ?? '').slice(0, 20000)`) }
  // click, fill: the first element the selector finds, scrolled into sight; fill types as a user would (input events);
  // its answer says what it caused: the page it moved to, popups and links refused, errors, the text that changed
  const was = await lines()
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
  let now = { url: wc.getURL(), title: wc.getTitle() }
  let changed = pageChanges(was, await lines())
  // a click that changed nothing yet, on the same page: a fetch it started may answer a moment later (one more look)
  // ponytail: one second; a slower answer still reads as (no changes)
  if (r.op === 'click' && !changed.length && now.url === page.url) {
    await new Promise(ok => setTimeout(ok, 1000))
    now = { url: wc.getURL(), title: wc.getTitle() }
    changed = pageChanges(was, await lines())
  }
  return { ...now, ...(now.url !== page.url && { nav: now }), ...caused(), changed } satisfies BrowseDid
}
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
let tray: Tray | null = null
let trayTabs: MenuItemConstructorOptions[] = [] // the last badge's, for a menu made again as screens come and go
let recording = false // the last badge's: Recording mode is on (settings.recording), its item ticked
function trayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      ...trayTabs,
      ...(trayTabs.length ? [{ type: 'separator' as const }] : []),
      { label: 'New Task…', click: () => quickWin() }, // the quick bar (Q1), over the app you're in
      { label: 'Recording Mode', type: 'checkbox', checked: recording, click: () => void rpc('settingsSet', { recording: !recording }).catch(() => {}) }, // private workspaces hidden
      { label: 'Screenshot Area…', click: () => screenshot(true) }, // to the new-workspace page, for an agent
      { label: 'Screenshot Screen', ...(screen.getAllDisplays().length > 1 ? { submenu: screenItems() } : { click: () => screenshot(false) }) },
      { label: 'Show and Tell…', ...(keys.tell && { accelerator: keys.tell, registerAccelerator: false }), click: () => tellShot() }, // Q7: a part of the screen, then say what to do with it
      ...(shotOn ? [{ label: 'Screenshot to Laki AI…', ...(keys.shot && { accelerator: keys.shot, registerAccelerator: false }), click: shotAsk }] : []),
      { type: 'separator' },
      { label: `Open ${app.name}`, ...(keys.open && { accelerator: keys.open, registerAccelerator: false }), click: () => show() }, // its global hotkey beside it
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}
app.whenReady().then(() => (screen.on('display-added', trayMenu), screen.on('display-removed', trayMenu), screen.on('display-metrics-changed', trayMenu))) // its sizes
// st (Q8, Settings › General › Menu bar's Show state): the state its picture shows (stateOf's), its title's ! and its
// tooltip's words; none (off, or an older page): the filled mark and the count, as before
ipcMain.on('badge', (e, n: number, items: { tab: string; label: string }[] = [], on = true, rec: unknown = false, st?: Partial<TrayInfo>) => {
  if (!from(e)) return
  recording = rec === true
  const count = Number.isInteger(n) && n > 0 ? String(n) : ''
  app.dock?.setBadge(count)
  if (!on) return void (tray?.destroy(), (tray = null))
  const num = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0)
  const info = st && TRAY_STATES.includes(st.state as TrayState) ? { state: st.state as TrayState, needs: num(n), working: num(st.working), blocked: num(st.blocked) } : undefined
  tray ??= new Tray(trayIcon(info?.state))
  tray.setImage(trayIcon(info?.state)) // a state change swaps the picture (the same one: its cached image, nothing redrawn)
  tray.setTitle(info ? trayTitle(info) : count, { fontType: 'monospacedDigit' })
  tray.setToolTip(info ? trayTip(info, app.name) : count ? `${app.name}: ${count} need${count === '1' ? 's' : ''} you` : app.name)
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
type Float = { tab: string; status?: string; at?: number; ask?: { options: { n: number; label: string }[] }; unseen?: boolean } // unseen: done, not looked at (a stale one shows as idle)
type FloatOpts = { style: string; cards: boolean; add: boolean; menu: 'stack' | 'card'; voiceTo: 'pick' | 'new'; doneAlert: boolean; ai: boolean; at: 'edge' | 'notch'; talk?: Float[]; route?: RouteCfg } // talk: the talk pill's agents, the bubbles' list even with the bubbles off (Q2); route: Q5's Route by first words, on (its projects, Laki AI's word, the word fixes)
type RouteCfg = { projects: { id: string; name: string }[]; aiWord?: string; fixes?: string }
const BAR = 44 // the drop's window width; floater.html's too
const VOICE = { width: 320, height: 186 } // the voice prompt's window; floater.html's #voice too
const MENU = { width: 236, height: 196 } // the +'s menu beside the drop (floaterMenu card); floater.html's #menu too
const menuH = () => MENU.height + 46 + (floats.ai ? 46 : 0) // a row more: Show and tell (Q7), and Ask Laki AI
const STYLES = ['glow', 'gradient', 'arc', 'bricks', 'comet', 'wave', 'still'] // a working agent's circle (Settings' previews: floater.css)
let floats: { items: Float[]; colors: Record<string, string> } & FloatOpts = { items: [], colors: {}, style: 'glow', cards: true, add: false, menu: 'stack', voiceTo: 'pick', doneAlert: true, ai: false, at: 'edge' }
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
// the voice window's agents (none: always a new session), or the one it replies to (replyFor: a circle's Reply…), and
// where it goes: by the bar's end, or under the island's pill
function sendVoice(w: BrowserWindow) {
  const to = replyFor ? floats.items.find(x => x.tab === replyFor) : undefined
  voiceTabs = new Set(to ? [to.tab] : floats.voiceTo === 'new' ? [] : floats.items.map(x => x.tab))
  w.webContents.send('voice', to ? [] : floats.voiceTo === 'new' ? [] : floats.items, floats.colors, floats.voiceTo, to, to ? undefined : routeFor())
  if (floats.at === 'notch' && pill) w.setPosition(Math.round(pill.x + pill.width / 2 - VOICE.width / 2), pill.y + pill.height + 4)
  else if (barAt) (p => w.setPosition(p.x, p.y))(beside(VOICE.width, VOICE.height, barLen() - (across() ? VOICE.width : VOICE.height))) // by the bar's end
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
      w.on('closed', () => card === w && ((card = null), (pinned = { tab: '' })))
      w.on('blur', () => pinned.tab && pinGo({ kind: 'blur' })) // Q4: a click elsewhere unpins it
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
    w.on('closed', () => voice === w && ((voice = null), (replyFor = '')))
    w.webContents.on('did-finish-load', () => {
      sendVoice(w)
      w.show()
      w.focus() // the key window without bringing Laki's own forward (a panel): dictation and the keys go to it
    })
  })
  f.loadURL(pageURL('floater.html', '#bar'))
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
// a screen gone (or, for the island, come or changed: the built-in one with the lid shut, a resolution): placed again
app.whenReady().then(() => {
  const again = () => (floats.at === 'notch' ? floater?.isVisible() && placeFloater() : snap())
  screen.on('display-removed', again)
  screen.on('display-removed', () => cards.length && ((cardAt = null), sendCards())) // the cards: on a screen that's there (their page says its height again)
  screen.on('display-added', () => floats.at === 'notch' && again())
  screen.on('display-metrics-changed', () => floats.at === 'notch' && again())
})
function placeFloater() {
  const notch = floats.at === 'notch'
  const d = notch ? islandDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay()) : undefined
  // hidden: the + closes too, its stack or menu (a hidden panel's page gets no visibilitychange); the island also while
  // nothing runs, waits or is done (idle recent ones don't keep it up) and over a full-screen app
  if ((notch ? !floats.items.some(f => f.status !== 'idle') : !floats.items.length && !floats.add) || front || parked || shooting || (d && fullScreen(d) && !menuBarHides())) return void (fold(), pinned.tab && pinGo({ kind: 'esc' }), floater?.isVisible() && floater.webContents.send('floater-menu', false), floater?.hide(), card?.hide(), menu?.close(), (hover = null))
  if (!floater) {
    try {
      barAt = home ??= JSON.parse(readFileSync(floaterFile(), 'utf8'))
      if (home && !['left', 'right'].includes(home.side as string)) delete home.side // an older file's, or a row's on top or bottom: left or right, by where it is
    } catch {}
    const f = (floater = barWin())
    f.webContents.on('did-finish-load', () => (floats.at === 'notch' ? islandAt() : snap(), sendFloats()))
    f.on('closed', () => floater === f && ((floater = null), (dragFrom = null)))
  } else sendFloats()
  if (notch) islandAt(d)
  if (!floater.isVisible()) floater.showInactive()
}
const sendFloats = () => floater?.webContents.send('floats', floats)
ipcMain.on('floats', (e, items: unknown, colors: unknown, opts: unknown) => {
  if (e.sender !== win?.webContents) return
  const o = (opts && typeof opts === 'object' ? opts : {}) as Partial<FloatOpts>
  const was = floats.at
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
    at: o.at === 'notch' ? 'notch' : 'edge',
    ...(Array.isArray(o.talk) && { talk: o.talk.slice(0, 12) }),
    ...(o.route && typeof o.route === 'object' && Array.isArray(o.route.projects) && { route: { projects: o.route.projects.slice(0, 200), aiWord: typeof o.route.aiWord === 'string' ? o.route.aiWord.slice(0, 40) : undefined, fixes: typeof o.route.fixes === 'string' ? o.route.fixes.slice(0, 20000) : undefined } }),
  }
  if (!floats.cards && hover?.tab !== TIP) (hover = null), card?.hide()
  if (floats.menu !== 'card' || !floats.add || floats.at === 'notch') menu?.close()
  if (parked && floatState() !== parked) parked = ''
  if (floats.at !== was) (fold(), (pinned = { tab: '' }), card?.hide(), card?.setIgnoreMouseEvents(floats.at !== 'notch'), floats.at === 'edge' && floater && snap()) // to the edge again: where it was
  placeFloater()
  islandFloats()
  if (pinned.tab) pinGo({ kind: 'list', waiting: floats.items.filter(x => x.status === 'waiting' || (dropFor?.tab === x.tab)).map(x => x.tab) }), pinned.tab && pinCard() // Q4: answered elsewhere: unpinned; else its new text (Q9: a drop's card stays while its bubble does)
})
// Stop (Settings › Resources): the bubbles' windows closed, until an agent's state changes
let parked = ''
const floatState = () => JSON.stringify(floats.items.map(x => [x.tab, x.status]))

// the island (floaterAt notch, shared/island.ts): the bar is a pill at the top of the built-in screen (else the main
// one), in its notch or under its menu bar; no drag, no snap (home and floater.json stay the edge's). It opens a card
// (the #card window, clickable and focusable while it shows) on its own as an agent turns waiting, or done
// (floaterDone): one at a time, asks first, newest first; an ask stays until it's answered or Esc, a finished one folds
// 6 s after unless the pointer is on it, or as the pointer leaves it after being on it. A hover on the pill with no
// card: the session list, until the pointer is on neither
let pill: Rect | null = null
let isl: { tab: string; life: CardLife; list?: boolean; i: number } | null = null // the card that shows
let islTick: NodeJS.Timeout | undefined
let islSent = '' // what the shown card was last sent: the same again isn't (its reply box keeps what you type)
// the menu bar set to hide on its own: every screen's work area is all of it, so a full-screen app can't be told.
// ponytail: then the island shows over full-screen apps too
const menuBarHides = () => process.platform === 'darwin' && systemPreferences.getUserDefault('_HIHideMenuBar', 'boolean') === true
const islSeen = new Map<string, string>() // each float's status at the last list: a turn to waiting or done opens its card
function islandAt(d = islandDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay())) {
  if (!floater) return
  pill = pillRect(d)
  barAt = { x: pill.x, y: pill.y }
  floater.setBounds(pill)
  floater.webContents.send('floater-side', 'notch')
  if (card && !card.isDestroyed() && card.isVisible() && isl) card.setBounds(cardRect(pill, card.getBounds().height)) // the screen changed under it
}
function fold() {
  clearInterval(islTick)
  islTick = undefined
  islSent = ''
  if (!isl) return
  isl = null
  if (floats.at === 'notch' && card && !card.isDestroyed()) card.hide(), card.setFocusable(false)
}
// the card for a tab (list: the sessions), sent to its window, which says its size (island-size), then shown under the pill
function island(tab: string, list = false) {
  if (!card || card.isDestroyed() || !pill) return
  const q = cardQueue(floats.items)
  const f = list ? undefined : floats.items.find(x => x.tab === tab)
  if (!list && !f) return fold()
  const kind = f?.status === 'waiting' ? 'ask' : 'done'
  const same = isl && isl.tab === tab && !!isl.list === list
  isl = { tab, list, i: Math.max(0, q.findIndex(x => x.tab === tab)), life: same ? isl!.life : { kind, shownAt: Date.now(), over: false, touched: false } }
  const msg = list ? { list: floats.items } : { f, i: isl.i, n: q.length }
  if (same && JSON.stringify(msg) === islSent) return
  islSent = JSON.stringify(msg)
  clearInterval(islTick)
  islTick = setInterval(() => islandEv('tick'), 500)
  card.webContents.send('island', msg, floats.colors)
}
function islandEv(ev: CardEvent | 'next' | 'prev') {
  if (!isl) return
  if (ev === 'next' || ev === 'prev') {
    const q = cardQueue(floats.items)
    return q.length && void island(q[(isl.i + (ev === 'next' ? 1 : q.length - 1)) % q.length].tab)
  }
  // the list: until the pointer is on neither the pill nor it
  if (isl.list) return void (ev === 'esc' || (ev !== 'enter' && !overBar() && !overCard()) ? fold() : undefined)
  const r = lifeStep(isl.life, ev, Date.now())
  isl.life = r.life
  if (r.fold) fold()
}
const overCard = () => {
  if (!card || card.isDestroyed() || !card.isVisible()) return false
  const p = screen.getCursorScreenPoint()
  const b = card.getBounds()
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
}
// a new list: a float that turned waiting, or done within the last minute (not one Laki's start finds done an hour ago),
// opens its card (an ask over a finished one); the shown one gone or no longer asking or done: the next ask, else folded
function islandFloats() {
  if (floats.at !== 'notch') return void islSeen.clear()
  let open: Float | undefined
  for (const f of floats.items) {
    const was = islSeen.get(f.tab)
    if (f.status !== was && (f.status === 'waiting' || (f.status === 'done' && floats.doneAlert && Date.now() - (f.at ?? 0) < 60e3)) && (!open || f.status === 'waiting')) open = f
  }
  islSeen.clear()
  for (const f of floats.items) islSeen.set(f.tab, f.status ?? '')
  if (front || !floater?.isVisible()) return
  if (open && !(isl && !isl.list && isl.life.kind === 'ask' && open.status !== 'waiting')) return island(open.tab)
  if (!isl) return
  if (isl.list) return island('', true)
  const now = floats.items.find(x => x.tab === isl!.tab)
  if (now && (now.status === 'waiting' || now.status === 'done')) return island(isl.tab) // its new text
  const next = cardQueue(floats.items).find(x => x.status === 'waiting')
  if (next) island(next.tab)
  else fold()
}
ipcMain.on('island-size', (e, h: unknown) => {
  if (!card || e.sender !== card.webContents || !isl || !pill || typeof h !== 'number' || !(h > 0 && h < 900)) return
  card.setIgnoreMouseEvents(false)
  card.setFocusable(true)
  card.setBounds(cardRect(pill, h))
  if (!card.isVisible()) card.showInactive()
})
ipcMain.on('island-ev', (e, ev: unknown) => {
  if (!(card && e.sender === card.webContents) && !(floater && e.sender === floater.webContents)) return
  if (ev === 'focus') return void (card && !card.isDestroyed() && card.focus()) // the pointer on it: its keys (1-9, Esc) without bringing Laki forward
  if (ev === 'pill') return void (isl || (floats.items.length && island('', true))) // a hover on the pill: the list, unless a card shows
  if (ev === 'enter' || ev === 'leave' || ev === 'esc' || ev === 'next' || ev === 'prev') islandEv(ev)
  if (ev === 'leave' && isl?.list) setTimeout(() => isl?.list && islandEv('tick'), 300) // across the gap from the pill to it
})
// a card's or the reply window's choice of an agent's menu: its n and label (refused once the menu changed)
ipcMain.handle('floater-answer', async (e, tab: unknown, n: unknown, label: unknown) => {
  if (!(card && e.sender === card.webContents) && !(voice && e.sender === voice.webContents)) return { error: 'not a bubble' }
  if (typeof tab !== 'string' || typeof n !== 'number' || typeof label !== 'string') return { error: 'no such choice' }
  if (!floats.items.some(x => x.tab === tab)) return { error: 'that tab is gone' } // only one the bubbles show
  return rpc('answer', { tab, n, label }).then(
    () => (pinned.tab === tab && pinGo({ kind: 'answered' }), {}),
    (err: Error) => ({ error: err.message }),
  )
})
// a circle's right click (edge): Reply…, Open tab, Seen (a finished one's); ⌥-click and Reply…: the reply window
ipcMain.on('floater-menu-tab', (e, tab: unknown) => {
  if (!floater || e.sender !== floater.webContents || typeof tab !== 'string') return
  const f = floats.items.find(x => x.tab === tab)
  if (!f) return
  Menu.buildFromTemplate([
    { label: 'Reply…', toolTip: '⌥-click', click: () => replyTo(tab) },
    { label: 'Open tab', click: () => (app.focus({ steal: true }), show(tab)) },
    ...(f.status === 'done' || f.unseen ? [{ label: 'Seen', click: () => void rpc('seen', { tab }).catch(() => {}) }] : []),
  ]).popup({ window: floater })
})
let replyFor = '' // the tab the voice window answers (a circle's Reply…), until it closes
function replyTo(tab: string) {
  replyFor = tab
  hover = null
  card?.hide()
  if (voice && !voice.isDestroyed()) return void (sendVoice(voice), voice.focus())
  floater?.webContents.send('floater-voice')
}
ipcMain.on('floater-reply', (e, tab: unknown) => floater && e.sender === floater.webContents && typeof tab === 'string' && floats.items.some(x => x.tab === tab) && replyTo(tab))

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
  if (talkW && !talkW.isDestroyed()) add(talkW.webContents.getOSProcessId(), 'Talk pill', 'floater') // Q2: its own
  if (cardWin && !cardWin.isDestroyed()) add(cardWin.webContents.getOSProcessId(), 'Cards on screen')
  if (annot && !annot.isDestroyed()) add(annot.webContents.getOSProcessId(), 'Screenshot editor')
  if (newWin && !newWin.isDestroyed()) add(newWin.webContents.getOSProcessId(), 'New workspace window')
  if (aiW && !aiW.isDestroyed()) add(aiW.webContents.getOSProcessId(), 'Laki AI window')
  for (const w of tabWins.values()) if (!w.isDestroyed()) add(w.webContents.getOSProcessId(), 'Floating tab')
  for (const w of simWins.values()) if (!w.isDestroyed()) add(w.webContents.getOSProcessId(), 'Floating simulator')
  return out
})
ipcMain.on('proc-stop', (e, what: unknown) => {
  if (e.sender !== win?.webContents || typeof what !== 'string') return
  if (what === 'floater') {
    parked = floatState()
    hover = null
    for (const f of [floater, card, menu, voice, talkW]) if (f && !f.isDestroyed()) f.destroy()
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
  if (!floater || e.sender !== floater.webContents || !(len > 0 && len < 2400) || floats.at === 'notch') return
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
ipcMain.on('floater-open', (e, tab: string, panel?: unknown) => ((floater && e.sender === floater.webContents) || (card && e.sender === card.webContents)) && typeof tab === 'string' && (fold(), pinned.tab && pinGo({ kind: 'esc' }), openTab(tab, panel === 'changes' ? 'changes' : undefined)))
const openTab = (tab: string, panel?: 'changes') => (app.focus({ steal: true }), show(tab, panel), earn('bubble'))
// Q4: an edge circle's click (shared/island.ts pinStep): a waiting one's card pinned to answer from, else (or the pinned
// one again) its tab opened, as before
let pinned: Pin = { tab: '' }
let pinTop = 0 // the pinned circle's place along the bar
let pinSent = '' // what the pinned card was last sent: the same again isn't (its reply keeps what's typed)
function pinGo(ev: PinEv) {
  const was = pinned.tab
  const r = pinStep(pinned, ev, Date.now())
  pinned = r.pin
  if (card && !card.isDestroyed()) {
    if (was && !pinned.tab) (pinSent = ''), (dropFor = null), card.setIgnoreMouseEvents(true), card.setFocusable(false), card.hide(), (hover = null)
    if (pinned.tab && pinned.tab !== was) (pinTop = hover?.tab === pinned.tab ? hover.top : pinTop), (hover = null), pinCard()
  }
  if (r.open) openTab(r.open)
}
function pinCard() {
  const f = floats.items.find(x => x.tab === pinned.tab)
  if (!card || card.isDestroyed() || !f) return
  const msg = JSON.stringify([f, floats.colors, dropFor])
  if (msg === pinSent) return
  pinSent = msg
  card.setIgnoreMouseEvents(false)
  card.setFocusable(true)
  card.webContents.send('card', f, floats.colors, true, dropFor?.tab === f.tab ? dropFor.drop : undefined)
}
// Q9: a drop on a circle or the +: files by their paths (preload's pathOf; Laki never reads or uploads one, the agent
// gets the path and has your file access anyway), a picture with no file saved as one (imageSave), text or a link.
// On a circle its card pins with a line for what to do with it; ⏎ sends to that agent (send agent: true: never a
// shell). On the +: the quick bar with it (pictures as their paths too). ponytail: a folder on the + is a path in
// the prompt, never a project added (only the main window's drop does that)
type Drop = { text?: string; paths: string[] }
let dropFor: { tab: string; drop: Drop } | null = null
const dropOk = (d: unknown): Drop | null => {
  if (!d || typeof d !== 'object') return null
  const o = d as { text?: unknown; paths?: unknown }
  const paths = (Array.isArray(o.paths) ? o.paths : []).filter((p): p is string => typeof p === 'string' && p.length < 4096 && p.startsWith('/') && !/[\0\n\r]/.test(p) && existsSync(p)).slice(0, 50)
  const text = typeof o.text === 'string' ? o.text.slice(0, 20000) : undefined
  return paths.length || text?.trim() ? { ...(text?.trim() && { text }), paths } : null
}
ipcMain.on('floater-drop', (e, to: unknown, d: unknown) => {
  if (!floater || e.sender !== floater.webContents || typeof to !== 'string' || floats.at === 'notch') return
  const drop = dropOk(d)
  if (!drop) return
  if (to === '+') return void quickWin([drop.text?.trim(), ...drop.paths.map(p => (/[\s"'\\]/.test(p) ? JSON.stringify(p) : p))].filter(Boolean).join('\n')) // as withPaths: a quoted one when it has a space
  const f = floats.items.find(x => x.tab === to)
  if (!f) return
  dropFor = { tab: to, drop }
  pinTop = hover?.tab === to ? hover.top : pinTop
  pinned = { tab: to }
  hover = null
  pinSent = ''
  pinCard()
})
// a picture dropped with no file of its own (from a page, say): saved as one, its path back
ipcMain.handle('floater-image', async (e, data: unknown, ext: unknown) => {
  if (!floater || e.sender !== floater.webContents || typeof data !== 'string' || data.length > 28 << 20) return { error: 'not a picture' }
  return rpc<string>('imageSave', { data, ext: typeof ext === 'string' ? ext : 'png' }).then(
    path => ({ path }),
    (err: Error) => ({ error: err.message }),
  )
})
ipcMain.handle('floater-drop-send', async (e, tab: unknown, text: unknown) => {
  if (!card || e.sender !== card.webContents || typeof tab !== 'string' || tab !== pinned.tab || dropFor?.tab !== tab) return { error: 'not the dropped-on card' }
  if (typeof text !== 'string' || !text.trim() || text.length > 40000) return { error: 'nothing to send' }
  return rpc('send', { target: tab, text: text.trim(), agent: true, whenIdle: true }).then( // agent: never a shell; whenIdle: after its turn, or its ask (never keys into a menu)
    () => (pinGo({ kind: 'answered' }), {}),
    (err: Error) => ({ error: err.message }),
  )
})
ipcMain.on('floater-click', (e, tab: unknown) => {
  if (!floater || e.sender !== floater.webContents || typeof tab !== 'string' || floats.at === 'notch') return
  const f = floats.items.find(x => x.tab === tab)
  if (f) pinGo({ kind: 'click', tab, waiting: f.status === 'waiting' })
})
ipcMain.on('floater-pin', (e, ev: unknown) => card && e.sender === card.webContents && ev === 'esc' && pinned.tab && pinGo({ kind: 'esc' }))
// the pinned card's one-line reply to an agent that asks in words (no menu): typed in now, as your answer. Not send's
// agent: true, which refuses a tab that asks (only you answer it: this is you); the bubbles' tabs are agents' only, and
// one with a menu gets its options instead (replyOf)
ipcMain.handle('floater-reply-send', async (e, tab: unknown, text: unknown) => {
  if (!card || e.sender !== card.webContents || typeof tab !== 'string' || tab !== pinned.tab) return { error: 'not the pinned card' }
  const f = floats.items.find(x => x.tab === tab)
  if (!f || (f.status === 'waiting' && f.ask?.options.length)) return { error: 'pick one of its options' }
  if (typeof text !== 'string' || !text.trim()) return { error: 'nothing to send' }
  if (text.length > 20000) return { error: 'too long: 20,000 characters at most' }
  return rpc('send', { target: tab, text: text.trim() }).then(
    () => (pinGo({ kind: 'answered' }), {}),
    (err: Error) => ({ error: err.message }),
  )
})
ipcMain.on('floater-seen', (e, tab: string) => floater && e.sender === floater.webContents && typeof tab === 'string' && void rpc('seen', { tab }).catch(() => {}))
// the +'s actions, from the stack in the drop or the menu beside it: New task (the new-workspace page, in a window of its
// own), Ask Laki AI (the AI page, in one too), the menu bar's screenshots; Say it from the menu: the bar opens its window
// (the stack's opens it itself)
ipcMain.on('floater-act', (e, what: unknown) => {
  if (!(floater && e.sender === floater.webContents) && !(menu && e.sender === menu.webContents)) return
  menu?.close()
  if (what === 'new') quickWin() // New task: the quick bar (Q1); its More is the whole page
  else if (what === 'ai' && floats.ai) aiWin()
  else if (what === 'area') screenshot(true)
  else if (what === 'screen') screenPick()
  else if (what === 'tell') tellShot()
  else if (what === 'mic') floater?.webContents.send('floater-voice')
})
ipcMain.on('floater-menu-at', (e, top: unknown) => floater && e.sender === floater.webContents && typeof top === 'number' && Number.isFinite(top) && (menuTop = top))
ipcMain.on('floater-menu-close', e => (e.sender === floater?.webContents || e.sender === menu?.webContents) && menu?.close())

// the bubbles' +, the menu bar's New Workspace… and a voice prompt for a new session: the new-workspace page alone (the renderer's ?window=new), in a
// panel over every app, Space and full-screen app, so the app you're in (and Laki's own window) stays where it is. One
// at a time: another + brings it up, a prompt fills it. As tall as the page (new-fit). It closes once the workspace is
// made, or on Esc.
let newWin: BrowserWindow | null = null
function newWsWin(prompt?: string, project?: string) {
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
let quickW: BrowserWindow | null = null
function quickWin(prompt?: string) {
  if (quickW && !quickW.isDestroyed()) {
    if (prompt) quickW.webContents.send('new-prompt', prompt)
    return void (quickW.show(), quickW.focus())
  }
  quickReady = false
  const w = (quickW = panelWin({ window: 'quick', ...(prompt && { prompt }) }, 640, 132, { minWidth: 440, minHeight: 112, resizable: false }, 0.16))
  w.webContents.on('did-navigate', () => quickW === w && (quickReady = false)) // a reload: it listens again as it's up
  w.on('closed', () => quickW === w && ((quickW = null), (quickReady = false), (tellPng = null)))
}
// Q7: show and tell (its global key, the menu bar's and the bubbles' item): a part of the screen (the bubbles out of it,
// as any shot), then the quick bar with the picture in it and the mic on (the page's: cloud voice, or macOS dictation
// when it's on; neither: a box to type in): ⏎ sends both to its target (an agent tab, a new task, Laki AI), E draws on
// it first (annotate, back to the bar), Esc drops both. Screen Recording refused: said, with its pane; never tried again
let quickReady = false // its page listens for show and tell's picture (quick-tell-ready)
let tellPng: string | null = null // the picture until it does
function tellShot() {
  if (screenOff()) return privacySay('screen')
  const bar = quickW && !quickW.isDestroyed() && quickW.isVisible() ? quickW : null
  bar?.hide() // out of the picture, as its own screenshot button's
  screenshot(true, undefined, png => ((tellPng = png), quickWin(), void tellSend()), () => (bar?.isDestroyed() === false && bar.show(), screenOff(true) && privacySay('screen')))
}
async function tellSend() {
  const w = quickW
  if (!tellPng || !w || w.isDestroyed() || !quickReady) return
  const png = tellPng
  tellPng = null
  w.webContents.send('quick-tell', { png, mic: mac ? systemPreferences.getMediaAccessStatus('microphone') : 'granted', dictation: !smoke && (await dictationOn()) }) // ui-smoke: no real dictation on your Mac
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
const screenOff = (after = false) => mac && (s => (after ? s !== 'granted' : s === 'denied' || s === 'restricted'))(systemPreferences.getMediaAccessStatus('screen'))
const PANES = { screen: ['Screen Recording', 'Privacy_ScreenCapture'], microphone: ['Microphone', 'Privacy_Microphone'] } as const
const paneOpen = (which: keyof typeof PANES) => void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${PANES[which][1]}`)
// which permission is missing, said once per try, a click opens its pane
function privacySay(which: keyof typeof PANES) {
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
let aiW: BrowserWindow | null = null
let aiReady = false // its page listens for screenshots (ai-shot-ready)
let aiShots: string[] = [] // Screenshot to Laki AI's pictures (PNGs, base64) until the page listens
function aiWin() {
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
const tabWins = new Map<string, BrowserWindow>()
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
const simWins = new Map<string, BrowserWindow>()
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
// the voice prompt: to an agent of the list (send, as the app's, queued while it works), or a new session's page
// the island's finished card's reply box too (the card's window); a reply queued (it works again meanwhile): the page
// says so, then closes
ipcMain.handle('voice-send', async (e, tab: unknown, text: unknown, project: unknown) => {
  const fromCard = !!card && e.sender === card.webContents && floats.at === 'notch'
  if ((!voice || e.sender !== voice.webContents) && !fromCard) return { error: 'not a bubble' }
  if (typeof text !== 'string' || !text.trim()) return { error: 'nothing to send' }
  if (text.length > 20000) return { error: 'too long: 20,000 characters at most' }
  if (tab === AI_TO && !fromCard) return (r => ('ai' in r && voice?.close(), r))(aiAsked(text.trim())) // Q5: its name said first
  if (typeof tab === 'string' && tab) {
    if (fromCard ? !floats.items.some(x => x.tab === tab) : !voiceTabs.has(tab)) return { error: 'not an agent this window offered' }
    talkProject = (floats.items as (Float & { pid?: string })[]).find(x => x.tab === tab)?.pid ?? talkProject
    if (!fromCard) talkLast = tab
    const r = await rpc<{ queued?: number }>('send', { target: tab, text: text.trim(), whenIdle: true, agent: true }).catch((err: Error) => ({ error: /no such|not found/i.test(err.message) ? 'that tab is gone' : err.message })) // agent: never a shell
    if ('error' in r) return r
    if (!r?.queued) fromCard ? fold() : voice?.close() // (it may have shut meanwhile); queued: the page says so first
    return { queued: !!r?.queued }
  }
  if (!voice || fromCard) return { error: 'nothing to send' }
  voice.close()
  const pid = typeof project === 'string' && floats.route?.projects.some(p => p.id === project) ? project : undefined
  if (pid) talkProject = pid
  newWsWin(text.trim(), pid)
  return {}
})
ipcMain.on('voice-close', e => voice && e.sender === voice.webContents && voice.close())

// Q2: the talk key's pill: a small focusable panel at the pointer (floater.html #talk, its own renderer), recording at
// once (the cloud engine: voiceText), with a live level, the time and who gets it (talkDefault: the agent that asked
// last, else the one you last sent to, else a new task; Tab changes it). The key again or ⏎: it stops, is written down
// and sent (send whenIdle, as Say it's; a new task: the new-workspace window with it); Esc drops it. The mic is open
// only while it records. ponytail: press to start, press to stop: globalShortcut has no key-up, so holding the key to
// talk needs a native helper (a CGEventTap) later
const TALK = { width: 320, height: 78 }
const AI_TO = '@ai' // Q5: Laki AI as a route's target (its name said first)
// Laki AI asked in the background (its chat has the answer: the AI page); only while it's on
const aiAsked = (text: string) => (floats.ai ? (void rpc('aiAsk', { text }).catch(() => {}), { ai: true }) : { error: 'Laki AI is off: Settings › AI' })
let talkW: BrowserWindow | null = null
let talkTo = new Set<string>() // the agents the pill offered
let talkLast = '' // the one you last sent to (talkDefault's second choice)
let talkUndo: { tab: string; text: string } | null = null // a send that's still in its queue: Undo takes it back
const talkList = () => ((floats.talk ?? floats.items) as (Float & { name?: string; pid?: string; alias?: string })[]).map(f => ({ tab: f.tab, name: f.name ?? f.tab, status: f.status ?? 'idle', ...(f.at && { at: f.at }), ...(f.pid && { project: f.pid }), ...(f.alias && { alias: f.alias }) }))
let talkProject = '' // Q5: the project of the last talk or Say it sent: a route into another one shows a little longer
const routeFor = () => floats.route && { ...floats.route, aiOn: floats.ai, last: talkProject, lastTab: talkLast }
function talk() {
  if (talkW && !talkW.isDestroyed()) return void talkW.webContents.send('talk-key') // the second press: stop, send
  const p = screen.getCursorScreenPoint()
  const d = screen.getDisplayNearestPoint(p).workArea
  const w = (talkW = new BrowserWindow({ ...floatOpts(TALK.width, TALK.height), x: clamp(p.x + 14, d.x, d.x + d.width - TALK.width), y: clamp(p.y + 18, d.y, d.y + d.height - TALK.height) }))
  const url = pageURL('floater.html', '#talk')
  pin(w, url)
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.on('closed', () => talkW === w && ((talkW = null), (talkUndo = null)))
  w.webContents.on('did-finish-load', () => {
    const list = talkList()
    talkTo = new Set(list.map(f => f.tab))
    w.webContents.send('talk', { list, to: talkDefault(list, talkLast), colors: floats.colors, mic: mac ? systemPreferences.getMediaAccessStatus('microphone') : 'granted', smoke: !!smoke, route: routeFor() })
    w.show()
    w.focus() // its keys (Tab, ⏎, Esc) without bringing Laki's window forward (a panel)
  })
  void w.loadURL(url)
}
const fromTalk = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !!talkW && !talkW.isDestroyed() && e.sender === talkW.webContents
// what it heard, written down (the daemon's voiceText: Settings › Voice's cloud model, its word fixes)
ipcMain.handle('talk-text', async (e, audio: unknown) => {
  if (!fromTalk(e)) return { error: 'not the talk pill' }
  if (typeof audio !== 'string' || !audio || audio.length > 24 << 20) return { error: 'no recording' }
  return rpc<{ text: string }>('voiceText', { audio }).catch((err: Error) => ({ error: err.message }))
})
ipcMain.handle('talk-send', async (e, tab: unknown, text: unknown, project: unknown) => {
  if (!fromTalk(e)) return { error: 'not the talk pill' }
  if (typeof text !== 'string' || !text.trim()) return { error: 'nothing to send' }
  if (text.length > 20000) return { error: 'too long: 20,000 characters at most' }
  if (typeof tab !== 'string') return { error: 'who gets it?' }
  const pid = typeof project === 'string' && floats.route?.projects.some(p => p.id === project) ? project : undefined
  if (!tab) return (talkProject = pid ?? talkProject), newWsWin(text.trim(), pid), { new: true }
  if (tab === AI_TO) return aiAsked(text.trim())
  if (!talkTo.has(tab)) return { error: 'not an agent the pill offered' }
  talkProject = ((floats.talk ?? floats.items) as (Float & { pid?: string })[]).find(x => x.tab === tab)?.pid ?? talkProject
  const r = await rpc<{ queued?: number }>('send', { target: tab, text: text.trim(), whenIdle: true, agent: true }).catch((err: Error) => ({ error: /no such|not found/i.test(err.message) ? 'that tab is gone' : err.message })) // agent: never a shell
  if ('error' in r) return r
  talkLast = tab
  talkUndo = r?.queued ? { tab, text: text.trim() } : null
  return { queued: !!r?.queued }
})
// Undo: only a send still in its queue (typed into a terminal, it can't be taken back)
ipcMain.handle('talk-undo', async e => {
  if (!fromTalk(e) || !talkUndo) return { error: 'nothing to take back' }
  const { tab, text } = talkUndo
  talkUndo = null
  const t = (await rpc<View>('state').catch(() => null))?.tabs.find(x => x.id === tab)
  const was = t?.queue ?? []
  const i = was.lastIndexOf(text)
  if (i < 0) return { error: 'it was sent already' }
  return rpc('queueSet', { tab, queue: was.filter((_, j) => j !== i), was }).then(
    () => ({}),
    (err: Error) => ({ error: err.message }),
  )
})
ipcMain.on('talk-close', e => fromTalk(e) && talkW!.close())
ipcMain.on('floater-drag', (e, phase: string, dx: number, dy: number) => {
  if (!floater || e.sender !== floater.webContents || floats.at === 'notch') return
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
  if (!floater || e.sender !== floater.webContents || dragFrom || pinned.tab) return // a pinned card stays (Q4)
  const f = floats.items.find(x => x.tab === tab)
  hover = f && Number.isFinite(top) && floats.cards && !front && overBar() ? { tab, top } : null
  if (hover) card?.webContents.send('card', f, floats.colors)
  else card?.hide()
})
ipcMain.on('floater-card', (e, tab: string, w: number, h: number) => {
  if (card && barAt && e.sender === card.webContents && pinned.tab && pinned.tab === tab && w > 0 && w < 800 && h > 0 && h < 800) {
    card.setBounds({ ...beside(Math.round(w), Math.round(h), pinTop - 6), width: Math.round(w), height: Math.round(h) }) // Q4: pinned, wherever the pointer is
    return void (card.isVisible() || card.show(), card.focus())
  }
  if (!card || !barAt || e.sender !== card.webContents || hover?.tab !== tab || !(w > 0 && w < 800 && h > 0 && h < 800)) return
  if (front || !overBar()) return void ((hover = null), card.hide()) // gone meanwhile (a click that brought Laki forward)
  card.setBounds({ ...beside(Math.round(w), Math.round(h), hover.top - 6), width: Math.round(w), height: Math.round(h) })
  card.showInactive()
})
// in front: one of Laki's own windows has the focus. A press on the drop makes Laki the active app too (its panel
// takes the click), so being active alone isn't it: the drop would hide under the pointer as a drag starts
const own = (w: BrowserWindow | null) => !!w && w !== floater && w !== card && w !== menu && w !== voice && w !== talkW && w !== newWin && w !== aiW // the bubbles stay over another app while the new-workspace or AI window is up
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
let annotTo: 'app' | 'quick' = 'app' // where its picture goes: the new-workspace page, or back to the quick bar (Q7)
const quickBack = () => quickW && !quickW.isDestroyed() && (quickW.show(), quickW.focus())
function annotate(png: string, to: 'app' | 'quick' = 'app') {
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
  if (shotReady && win) win.webContents.send('shot', ...s)
  else shot = s
  show()
})
ipcMain.on('annotate-cancel', e => annot && e.sender === annot.webContents && annot.destroy())

// the menu bar's icon: Laki's mark (a chevron and a dot) as a 32×32 template image (@2x), one per state (Q8: shared/
// tray.ts' trayBitmap: idle, working, waiting, blocked), made once each: macOS colors it for a light or dark menu bar
// and the highlight from its alpha alone
const trayIcons = new Map<TrayState, Electron.NativeImage>()
function trayIcon(state: TrayState = 'waiting') {
  let img = trayIcons.get(state)
  if (!img) {
    img = nativeImage.createFromBitmap(trayBitmap(state), { width: TRAY_PX, height: TRAY_PX, scaleFactor: 2 })
    img.setTemplateImage(true)
    trayIcons.set(state, img)
  }
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
  await rpc('shutdown', {}, 10000).catch(() => {}) // the daemon first asks who calls (lsof, ps): a busy Mac takes a while, and a call given up is refused
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
  create()
})
app.on('before-quit', () => (quitting = true))
app.on('activate', () => show())
// macOS: the app (and always the daemon) keeps running without windows
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !moving) app.quit()
})
