// notifications and cards on screen: a notification with its buttons (notify), the cards for what's marked important
// (addCard: ask.html at the bottom right, over every app), the menu bar's Inbox (the same page as a popover), their
// choices (ask-act), Laki AI's words for a command (ask-explain), Open, ×, Close all, a timer's sound; each IPC handler
// checks its sender (the app window, the cards' window, the Inbox's)
import { app, BrowserWindow, ipcMain, nativeTheme, Notification, screen, shell } from 'electron'
import { appendFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { floatOpts, floats, guardFloat } from './floater.ts'
import { rpc } from '../shared/conn.ts'
import { from, fromApp, mac, notifyLog, pageURL, quickWin, show, win } from './index.ts'
import { tray } from './menu.ts'

// sound: a macOS sound's name (Settings › General), 'none', or unset: the default. actions: buttons (a waiting agent's
// choices, or a permission prompt's Allow and Deny; macOS shows the first with the Alerts style and the rest under
// Options, all under Options with Banners): each answers its menu straight through the daemon (the window may be
// closed by then), by its number and words, or Allow / Deny by first and last. Kept until used or closed: a
// collected Notification's events never come
type NoteAction = { text: string; scope?: string /* a standing permission's choice in full: the card draws its rule */; reply?: boolean; stop?: boolean; n?: number; label?: string; pick?: 'first' | 'last'; tool?: { req: string; allow: string }; alert?: { id: string; choice: string } } // tool: an extension's tool call, answered (widgetToolAnswer); alert: laki alert's choice (alertAnswer)
const notes = new Set<Notification>()
// card: something marked important (a workspace, a timer, a reminder, laki alert) as a card on screen instead (addCard):
// ask, a waiting agent's (its change's diff with it); alert, laki alert's id (its choices answer it, its × too); tone,
// its edge's color
type CardOpts = { diff?: unknown; ask?: unknown; alert?: unknown; tone?: unknown; origin?: unknown; explain?: unknown }
ipcMain.on('notify', (e, title: string, body: string, tab: string, sound?: string, actions?: NoteAction[], card?: CardOpts) => {
  if (!fromApp(e)) return
  if (notifyLog) appendFileSync(notifyLog, JSON.stringify({ title, body, tab, sound, actions, ...(card && { card: true }) }) + '\n') // smoke tests
  const named = typeof sound === 'string' && /^[A-Za-z]+$/.test(sound) && sound !== 'none'
  const buttons = (Array.isArray(actions) ? actions : []).filter(a => typeof a?.text === 'string' && (a.reply === true || a.stop === true || Number.isInteger(a.n) || a.pick === 'first' || a.pick === 'last' || typeof a.tool?.req === 'string' || (typeof a.alert?.id === 'string' && typeof a.alert.choice === 'string'))).slice(0, 9).map(a => (a.scope === undefined || typeof a.scope === 'string' ? a : { ...a, scope: undefined }))
  if (card && typeof card === 'object') {
    if (sound !== 'none') execFile('afplay', [`/System/Library/Sounds/${named ? sound : 'Glass'}.aiff`], () => {})
    const t = typeof tab === 'string' ? tab : ''
    const ask = card.ask === true && !!t
    const alert = typeof card.alert === 'string' && /^[\w-]{1,40}$/.test(card.alert) ? card.alert : ''
    const actions = alert ? buttons.filter(a => a.alert?.id === alert) : buttons.filter(a => !a.tool && !a.alert && !a.reply)
    // S10: a laki alert has a tone of its own, never an ask's (a permission prompt's), and its origin line from the daemon
    const tone = alert ? 'alert' : ask ? 'ask' : ['ok', 'bad'].includes(card.tone as string) ? (card.tone as Card['tone']) : 'info'
    const origin = alert && typeof card.origin === 'string' ? card.origin.slice(0, 200) : undefined
    return addCard({ key: alert ? `alert:${alert}` : t ? `tab:${t}` : `n:${++cardN}`, tab: t, ask, tone, at: Date.now(), title: String(title), body: String(body), ...(typeof card.diff === 'string' && { diff: card.diff }), ...(origin && { origin }), ...(ask && card.explain === true && { explain: true }), actions })
  }
  // U15: an agent's free-text question (no menu, not Allow/Deny): a Reply field (macOS), its text sent to the tab as one
  // typed in the window would be (the daemon's send: its rules, Recording mode, the policy), then its card on screen goes
  const reply = mac && !!tab && typeof tab === 'string' && buttons.some(a => a.reply)
  const shown = buttons.filter(a => !a.reply)
  const n = new Notification({ title, body, silent: sound === 'none', ...(named && { sound }), actions: shown.map(a => ({ type: 'button' as const, text: a.text.slice(0, 60) })), ...(reply && { hasReply: true, replyPlaceholder: 'Your answer' }) })
  const done = () => notes.delete(n)
  n.on('click', () => (done(), show(tab)))
  n.on('reply', (_ev, text) => {
    done()
    const t = typeof text === 'string' ? text.trim() : ''
    if (!reply || !t) return // empty: nothing sent
    rpc('send', { target: tab, text: t.slice(0, 20000) }).then(
      () => dropCards(c => c.key !== `tab:${tab}`),
      () => show(tab), // it moved on, or was refused: look
    )
  })
  n.on('action', (_ev, i) => {
    done()
    const a = shown[i]
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
export type Card = { key: string; tab: string; ask: boolean; tone: 'ask' | 'ok' | 'bad' | 'info' | 'alert'; at: number; title: string; body: string; diff?: string; origin?: string; actions: NoteAction[]; error?: string; explain?: boolean; said?: Said } // explain: a command ask's ?; said: what Laki AI made of it (ask-explain)
type Said = 'loading' | { err: string } | { does: string; outside: boolean; undo: string; cut?: boolean }
const CARD_W = 380
export let cards: Card[] = []
let cardN = 0
export let cardWin: BrowserWindow | null = null
export let cardAt: Electron.Rectangle | null = null // the screen's work area it's in, while it shows
export function addCard(c: Card) {
  cards = [c, ...cards.filter(x => x.key !== c.key)].slice(0, 20) // ponytail: the oldest past 20 go
  if (!cardWin || cardWin.isDestroyed()) {
    const w = (cardWin = new BrowserWindow(floatOpts(CARD_W, 120)))
    guardFloat('ask', w)
    w.setAlwaysOnTop(true, 'screen-saver') // over other apps' floating windows too
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    w.webContents.on('will-navigate', e => e.preventDefault())
    w.webContents.setWindowOpenHandler(({ url }) => (/^(https?:\/\/|mailto:)/i.test(url) && void shell.openExternal(url), { action: 'deny' })) // a card's link (its Markdown's: target _blank): the browser
    w.webContents.on('did-finish-load', sendCards)
    w.on('closed', () => cardWin === w && ((cardWin = null), (cardAt = null)))
    w.loadURL(pageURL('ask.html'))
  } else sendCards()
}
export const sendCards = () => (cards.length ? cardWin?.webContents.send('ask-cards', cards, floats.colors) : (cardWin?.hide(), (cardAt = null)))
// a screen gone: the cards on one that's there (the bubbles' own listener places them; neither reads the other's)
app.whenReady().then(() => screen.on('display-removed', () => cards.length && ((cardAt = null), sendCards()))) // their page says its height again
export const dropCards = (keep: (c: Card) => boolean) => {
  const still = cards.filter(keep)
  if (still.length !== cards.length) (cards = still), sendCards()
}
const cardSender = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!cardWin && !cardWin.isDestroyed() && e.sender === cardWin.webContents
const cardOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, key: unknown) => (typeof key === 'string' ? (cardSender(e) ? cards : inboxSender(e) ? inboxList : []).find(x => x.key === key) : undefined)

// the menu bar's Inbox (Settings › General › Menu bar click: Inbox): a left click on the tray opens a panel under it
// (ask.html?window=inbox: the cards' page) with what the app window lists (tray.ts inboxOf, sent with the badge: the
// asks with their choices, then the ones at work), New task… (the quick bar), closed as it loses the focus or on Esc; a
// right click pops the tray's menu. The popover's material, solid with Reduce transparency
const INBOX_W = 360
export let inboxWin: BrowserWindow | null = null
let inboxList: Card[] = []
let inboxShow = false // opened by a click: shown at its next size (the page's), not on every list update
let inboxHid = 0 // when the blur hid it: the tray's own click (which blurred it) doesn't open it again
export let barInbox = false
const inboxSender = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!inboxWin && !inboxWin.isDestroyed() && e.sender === inboxWin.webContents && from(e, 'inbox')
export const inboxHide = () => ((inboxShow = false), inboxWin?.isDestroyed() || inboxWin?.hide())
export const sendInbox = () => inboxWin && !inboxWin.isDestroyed() && inboxWin.webContents.send('ask-cards', inboxList, floats.colors)
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
export function inboxCards(items: unknown): Card[] {
  return (Array.isArray(items) ? items : []).slice(0, 12).flatMap((i): Card[] => {
    if (!i || typeof i !== 'object' || typeof i.tab !== 'string') return []
    const ask = i.kind === 'ask'
    const actions = ask && Array.isArray(i.options) ? i.options.slice(0, 9).filter((o: { n?: unknown; label?: unknown }) => Number.isInteger(o?.n) && typeof o.label === 'string').map((o: { n: number; label: string }) => ({ text: o.label.slice(0, 80), n: o.n, label: o.label.slice(0, 80) })) : []
    return [{ key: `inbox:${i.tab}`, tab: i.tab.slice(0, 80), ask, tone: ask ? 'ask' : 'info', at: Date.now(), title: str(i.title, 90), body: str(i.body, 300), actions }]
  })
}
export function inboxOpen() {
  if (inboxWin?.isVisible() || Date.now() - inboxHid < 300) return inboxHide() // its second click closes it
  inboxShow = true
  if (inboxWin && !inboxWin.isDestroyed()) return sendInbox()
  const solid = nativeTheme.prefersReducedTransparency
  const w = (inboxWin = new BrowserWindow({ ...floatOpts(INBOX_W, 160), hasShadow: true, roundedCorners: true, ...(solid ? { transparent: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2128' : '#f4f5f7' } : { vibrancy: 'popover', visualEffectState: 'active' }) }))
  guardFloat('inbox', w)
  w.setAlwaysOnTop(true, 'pop-up-menu')
  w.on('blur', () => (inboxHide(), (inboxHid = Date.now())))
  w.webContents.on('will-navigate', e => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('did-finish-load', sendInbox)
  w.on('closed', () => inboxWin === w && (inboxWin = null))
  w.loadURL(pageURL('ask.html', `?window=inbox${solid ? '&solid' : ''}`))
}
// the app window's list for the Inbox, with each badge (inbox: none, an older page or Menu bar click isn't Inbox)
export function inboxSet(inbox: unknown) {
  barInbox = mac && Array.isArray(inbox) // Menu bar click: Inbox (macOS: a tray's left and right clicks are its own)
  inboxList = inboxCards(inbox)
  if (inboxWin?.isVisible()) sendInbox()
  else if (!barInbox) inboxHide()
}
// New task…: the quick bar with what was typed
ipcMain.on('inbox-new', (e, text: unknown) => inboxSender(e) && (inboxHide(), quickWin(str(text, 20000).trim() || undefined)))
// its height (the page's, every card in it), kept to the screen; bottom right of the work area
ipcMain.on('ask-size', (e, h: unknown) => {
  if (inboxSender(e) && typeof h === 'number' && h > 0 && tray) {
    const b = tray.getBounds()
    const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea
    const height = Math.round(Math.min(h, wa.height - 24))
    inboxWin!.setBounds({ x: Math.round(Math.max(wa.x + 8, Math.min(b.x + b.width / 2 - INBOX_W / 2, wa.x + wa.width - INBOX_W - 8))), y: Math.max(wa.y, b.y + b.height) + 4, width: INBOX_W, height })
    if (inboxShow && !inboxWin!.isVisible()) inboxWin!.show(), inboxWin!.focus() // its keys: 1-9, Esc
    return
  }
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
    if (inboxSender(e)) (inboxList = inboxList.filter(x => x !== c)), sendInbox()
    else dropCards(x => x !== c)
  } catch (err) {
    c.error = `${(err as Error).message}: open ${c.tab ? 'its tab' : 'Laki'}`
    if (inboxSender(e)) sendInbox()
    else sendCards()
  }
})
// a command ask's ? (or E): Laki AI's words for it, from the daemon (askExplain: kept per command), on the card; it
// answers nothing
ipcMain.handle('ask-explain', async (e, key: unknown) => {
  const c = cardOf(e, key)
  if (!c?.explain || (c.said && !(typeof c.said === 'object' && 'err' in c.said))) return
  const send = () => (inboxSender(e) ? sendInbox() : sendCards())
  c.said = 'loading'
  send()
  try {
    const r = (await rpc('askExplain', { tab: c.tab })) as { does?: unknown; outside?: unknown; undo?: unknown; cut?: unknown }
    c.said = typeof r?.does === 'string' ? { does: r.does.slice(0, 200), outside: r.outside === true, undo: String(r.undo), cut: r.cut === true } : { err: 'no answer' }
  } catch (err) {
    c.said = { err: (err as Error).message }
  }
  send()
})
// closed: a laki alert that waits hears it (no choice)
const closed = (c: Card) => c.key.startsWith('alert:') && void rpc('alertAnswer', { id: c.key.slice(6) }).catch(() => {})
ipcMain.on('ask-close', (e, key: unknown) => (inboxSender(e) ? inboxHide() : (c => c && (closed(c), dropCards(x => x !== c)))(cardOf(e, key))))
ipcMain.on('ask-close-all', e => (inboxSender(e) ? inboxHide() : cardSender(e) && (cards.forEach(closed), dropCards(() => false))))
ipcMain.on('ask-open', (e, key: unknown) => {
  const c = cardOf(e, key)
  if (!c) return
  if (inboxSender(e)) return void (inboxHide(), app.focus({ steal: true }), show(c.tab || undefined))
  if (!c.actions.length) dropCards(x => x !== c) // one with choices stays: it's answered there
  app.focus({ steal: true })
  show(c.tab || undefined)
})
// a laki alert answered, timed out or gone (alertDone, the app window's): its card goes
ipcMain.on('card-gone', (e, key: unknown) => e.sender === win?.webContents && typeof key === 'string' && dropCards(c => c.key !== key))
// the app window's tabs that wait: an agent's ask whose tab no longer does goes
ipcMain.on('asking', (e, tabs: unknown) => e.sender === win?.webContents && Array.isArray(tabs) && dropCards(c => !c.ask || tabs.includes(c.tab)))

// a timer's end with its dialog (Settings › Notifications › A timer ended): one of macOS's sounds, whatever notifications say
ipcMain.on('sound', (e, name: string) => {
  if (from(e) && typeof name === 'string' && /^[A-Za-z]+$/.test(name)) execFile('afplay', [`/System/Library/Sounds/${name}.aiff`], () => {})
})
