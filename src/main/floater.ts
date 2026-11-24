// the floating bubbles (Settings › Appearance): the drop and its windows (the card, the + menu, the voice prompt), the
// island at the notch, the pinned circle, drops on the bar, dragging it, the talk key's pill (Q2) and its dictation,
// whether Laki is in front (setFront), Fn's watch; main's floats IPC and the bubbles' own (each checks its window:
// floater, card, menu, voice, talkW)
import { AI_TO, NOTE_TO, SEL_SKIP, selectionOf, selLabel, talkDefault, talkShot, TODO_TO, withSelection } from '../shared/talk.ts'
import { app, BrowserWindow, type BrowserWindowConstructorOptions, ipcMain, Menu, screen, session, systemPreferences, webContents } from 'electron'
import { BROWSER, floatTimes, local, protectedKind } from './guards.ts'
import { type CardEvent, type CardLife, cardQueue, cardRect, fullScreen, hasNotch, islandDisplay, type IslandOn, lifeStep, pillRect, type Pin, type PinEv, pinStep, type Rect } from '../shared/island.ts'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rpc } from '../shared/conn.ts'
import { speakable } from '../shared/speak.ts'
import { speechLine } from '../shared/speech.ts'
import type { View } from '../shared/types.ts'
import { aiW, aiWin, earn, from, newWin, newWsWin, pageURL, privacySay, quickW, quickWin, screenOff, show, simWins, smoke, tabWins, tellShot, win } from './index.ts'
import { recording } from './menu.ts'
import { agentEnd, agentWins } from './agentBrowser.ts'
import { cardWin, inboxWin } from './cards.ts'
import { annot, screenPick, screenshot, shooting } from './shots.ts'

const mac = process.platform === 'darwin' // index.ts' too: this module's own, read as it loads (before index.ts' body runs)

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
type Float = { tab: string; status?: string; at?: number; ask?: { options: { n: number; label: string }[]; tool?: string; what?: string; question?: string; steps?: boolean }; held?: boolean; unseen?: boolean } // held: a waiting one's secret or plan (the talk key never answers those) // unseen: done, not looked at (a stale one shows as idle)
type FloatOpts = { speak?: boolean /* Settings › Voice: Laki AI's answer to a talk-key question read out by the pill (off in Quiet and Recording mode) */; hide?: boolean /* 10c: Settings' Hide bubbles and cards from screen recording */; noAnswers?: boolean /* Settings › Voice: the talk key never answers asks */; speech?: string /* the talk key's on-device engine's locale (Settings › Voice: On this Mac) */; style: string; cards: boolean; add: boolean; menu: 'stack' | 'card'; voiceTo: 'pick' | 'new'; doneAlert: boolean; ai: boolean; at: 'edge' | 'notch'; talk?: Float[]; talkAi?: boolean; aiShow?: boolean; route?: RouteCfg; selection?: boolean /* Q11: the talk key carries the selected text */; islandOn?: IslandOn /* the island's screen (island.ts islandDisplay): unset, the built-in one */
} // talk: the talk pill's agents, the bubbles' list even with the bubbles off (Q2); talkAi: the talk key goes to Laki AI (Q10, Settings › Voice); route: Q5's Route by first words, on (its projects, Laki AI's word, the word fixes)
type RouteCfg = { projects: { id: string; name: string }[]; aiWord?: string; fixes?: string; note?: boolean; todo?: boolean }
const BAR = 44 // the drop's window width; floater.html's too
const VOICE = { width: 320, height: 186 } // the voice prompt's window; floater.html's #voice too
const MENU = { width: 236, height: 196 } // the +'s menu beside the drop (floaterMenu card); floater.html's #menu too
const menuH = () => MENU.height + 46 + (floats.ai ? 46 : 0) // a row more: Show and tell (Q7), and Ask Laki AI
const STYLES = ['glow', 'gradient', 'arc', 'bricks', 'comet', 'wave', 'still'] // a working agent's circle (Settings' previews: floater.css)
export let floats: { items: Float[]; colors: Record<string, string> } & FloatOpts = { items: [], colors: {}, style: 'glow', cards: true, add: false, menu: 'stack', voiceTo: 'pick', doneAlert: true, ai: false, at: 'edge' }
export let floater: BrowserWindow | null = null
export let card: BrowserWindow | null = null
export let voice: BrowserWindow | null = null
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
// 10c: each floating window kept out of screen recording and screenshots (guards.ts protectedKind), as each is made and
// as the setting or Recording mode changes
export const guardFloat = (kind: string, w: BrowserWindow | null) => w && !w.isDestroyed() && w.setContentProtection(protectedKind(kind, { hideFloats: floats.hide }, recording))
let guarded = '' // what protectFloats last set: each window made since got it as it was made (guardFloat)
export function protectFloats() {
  const k = `${floats.hide === true} ${recording}`
  if (k === guarded) return
  guarded = k
  for (const [k, w] of [['bar', floater], ['card', card], ['menu', menu], ['voice', voice], ['ask', cardWin], ['inbox', inboxWin], ['quick', quickW], ['talk', talkW]] as const) guardFloat(k, w)
}
export const floatOpts = (width: number, height: number, focusable = true): BrowserWindowConstructorOptions => ({
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
export const pin = (f: BrowserWindow, to?: string) => {
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
  guardFloat('bar', f)
  const kind = (url: string) => (url.split('#')[0] === f.webContents.getURL().split('#')[0] ? /#(card|voice|menu)$/.exec(url)?.[1] : undefined)
  f.webContents.setWindowOpenHandler(({ url }) => {
    const k = kind(url)
    if (k === 'voice' && voice && !voice.isDestroyed()) voice.focus()
    if (!k || (k === 'card' ? card : k === 'menu' ? menu : voice)?.isDestroyed() === false) return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: k === 'card' ? floatOpts(280, 60, false) : k === 'menu' ? floatOpts(MENU.width, menuH()) : floatOpts(VOICE.width, VOICE.height) }
  })
  f.webContents.on('did-create-window', (w, { url }) => {
    pin(w, url)
    guardFloat(kind(url) ?? 'voice', w)
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
  screen.on('display-added', () => floats.at === 'notch' && again())
  screen.on('display-metrics-changed', () => floats.at === 'notch' && again())
})
export function placeFloater() {
  const notch = floats.at === 'notch'
  const d = notch ? islandScreen() : undefined
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
    items: Array.isArray(items) ? items.slice(0, 12).map(x => (({ started: _s, usual: _u, ...rest }) => ({ ...rest, ...floatTimes(x) }))((x && typeof x === 'object' ? x : {}) as Float & { started?: unknown; usual?: unknown })) : [], // a turn's started and usual: checked (guards.ts)
    colors: colors && typeof colors === 'object' ? (colors as Record<string, string>) : {},
    style: STYLES.includes(o.style as string) ? o.style! : 'glow',
    cards: o.cards !== false,
    add: o.add === true,
    menu: o.menu === 'card' ? 'card' : 'stack',
    voiceTo: o.voiceTo === 'new' ? 'new' : 'pick',
    doneAlert: o.doneAlert !== false,
    ai: o.ai === true,
    at: o.at === 'notch' ? 'notch' : 'edge',
    ...((o.islandOn === 'main' || o.islandOn === 'pointer') && { islandOn: o.islandOn }),
    ...(Array.isArray(o.talk) && { talk: o.talk.slice(0, 12) }),
    ...(o.talkAi === true && { talkAi: true }),
    ...(o.selection === true && { selection: true }),
    ...(typeof o.speech === 'string' && /^[\w-]{2,20}$/.test(o.speech) && { speech: o.speech }),
    ...(o.noAnswers === true && { noAnswers: true }),
    ...(o.speak === true && { speak: true }),
    ...(o.hide === true && { hide: true }),
    ...(o.aiShow === true && { aiShow: true }),
    ...(o.route && typeof o.route === 'object' && Array.isArray(o.route.projects) && { route: { projects: o.route.projects.slice(0, 200), aiWord: typeof o.route.aiWord === 'string' ? o.route.aiWord.slice(0, 40) : undefined, fixes: typeof o.route.fixes === 'string' ? o.route.fixes.slice(0, 20000) : undefined, note: o.route.note !== false, todo: o.route.todo !== false } }),
  }
  if (!floats.cards && hover?.tab !== TIP) (hover = null), card?.hide()
  if (floats.menu !== 'card' || !floats.add || floats.at === 'notch') menu?.close()
  if (parked && floatState() !== parked) parked = ''
  if (floats.at !== was) (fold(), (pinned = { tab: '' }), card?.hide(), card?.setIgnoreMouseEvents(floats.at !== 'notch'), floats.at === 'edge' && floater && snap()) // to the edge again: where it was
  placeFloater()
  islandFloats()
  protectFloats()
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
let flush = false // the island's screen has a notch: its card grows out of the pill, one shape (cardRect)
let isl: { tab: string; life: CardLife; list?: boolean; i: number } | null = null // the card that shows
let islTick: NodeJS.Timeout | undefined
let islSent = '' // what the shown card was last sent: the same again isn't (its reply box keeps what you type)
// the menu bar set to hide on its own: every screen's work area is all of it, so a full-screen app can't be told.
// ponytail: then the island shows over full-screen apps too
const menuBarHides = () => process.platform === 'darwin' && systemPreferences.getUserDefault('_HIHideMenuBar', 'boolean') === true
const islSeen = new Map<string, string>() // each float's status at the last list: a turn to waiting or done opens its card
// the island's screen as Settings say (islandOn): the built-in one, the main one, or the one the pointer is on now
const islandScreen = () => islandDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), floats.islandOn, floats.islandOn === 'pointer' ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : undefined)
function islandAt(d = islandScreen()) {
  if (!floater) return
  pill = pillRect(d)
  flush = hasNotch(d)
  barAt = { x: pill.x, y: pill.y }
  floater.setBounds(pill)
  floater.webContents.send('floater-side', 'notch')
  if (card && !card.isDestroyed() && card.isVisible() && isl) card.setBounds(cardRect(pill, card.getBounds().height, flush)) // the screen changed under it
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
  card.webContents.send('island', msg, floats.colors, flush && pill ? pill.height : 0) // flush: the room its top keeps for the notch
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
  card.setBounds(cardRect(pill, h, flush))
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
  for (const [ws, a] of agentWins) for (const w of a.tabs) if (!w.isDestroyed()) add(w.webContents.getOSProcessId(), `browser:${ws}`, `browse:${ws}`)
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
    agentWins.delete(what.slice(7))
    agentEnd(a)
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
export let pinned: Pin = { tab: '' }
let pinTop = 0 // the pinned circle's place along the bar
let pinSent = '' // what the pinned card was last sent: the same again isn't (its reply keeps what's typed)
export function pinGo(ev: PinEv) {
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
// Laki AI asked in the background (its chat has the answer: the AI page); only while it's on. Settings › AI › Show its
// work (aiShow, on unless off): its window opens with the ask (Q13: what it does, its Yes / No, without the app)
// spoken: the talk pill's (aiTalk): its answer's first sentences to the pill, read out there while it's open (speakable)
const aiAsked = (text: string, images?: string[], spoken = false) => (floats.ai ? (void rpc<{ text?: string }>('aiAsk', { text, ...(images && { images }) }).then(r => (typeof r?.text === 'string' ? speakable(r.text) : ''), () => '').then(s => spoken && floats.speak && talkW && !talkW.isDestroyed() && talkW.webContents.send('talk-speak', s)), floats.aiShow && setTimeout(aiWin, 300), { ai: true, ...(spoken && floats.speak && { speak: true }) }) : { error: 'Laki AI is off: Settings › AI' })
// Q10: the talk pill's ask to Laki AI: words that ask for the screen (talkShot) take the screen under the pill with it
// (the pill and the bubbles out of the picture). No Screen Recording: asked without it, said so
async function aiTalk(said: string, text = said): Promise<{ ai?: boolean; speak?: boolean; shot?: boolean; noShot?: string; error?: string }> {
  if (!floats.ai) return aiAsked(text, undefined, true)
  if (!talkShot(said) || !mac) return aiAsked(text, undefined, true) // the words said ask for the screen, not a selection's
  if (screenOff()) return (privacySay('screen'), { ...aiAsked(text, undefined, true), noShot: 'Laki has no Screen Recording' })
  const w = talkW
  const on = screen.getDisplayMatching(w && !w.isDestroyed() ? w.getBounds() : { ...screen.getCursorScreenPoint(), width: 1, height: 1 }).bounds
  w?.hide()
  const png = await new Promise<string>(done => screenshot(false, on, done, () => done('')))
  if (w && !w.isDestroyed()) w.showInactive()
  if (!png) return (screenOff(true) && privacySay('screen'), { ...aiAsked(text, undefined, true), noShot: 'no picture: Screen Recording for Laki' })
  const path = await rpc<string>('imageSave', { data: png, ext: 'png' }).catch(() => '')
  return path ? { ...aiAsked(text, [path], true), shot: true } : { ...aiAsked(text, undefined, true), noShot: "the picture wasn't saved" }
}
export let talkW: BrowserWindow | null = null
let talkTo = new Set<string>() // the agents the pill offered
let talkLast = '' // the one you last sent to (talkDefault's second choice)
let talkUndo: { tab: string; text: string } | null = null // a send that's still in its queue: Undo takes it back
let talkTakeBack: (() => Promise<unknown>) | null = null // Q5b: a note's line or a Backlog's item just added: Undo removes it
const talkList = () => ((floats.talk ?? floats.items) as (Float & { name?: string; pid?: string; alias?: string })[]).map(f => ({ tab: f.tab, name: f.name ?? f.tab, status: f.status ?? 'idle', ...(f.at && { at: f.at }), ...(f.pid && { project: f.pid }), ...(f.alias && { alias: f.alias }), ...(f.status === 'waiting' && f.ask && { ask: { options: f.ask.options.slice(0, 9), tool: f.ask.tool, what: f.ask.what?.slice(0, 300), question: f.ask.question?.slice(0, 300), steps: f.ask.steps } }), ...(f.held && { held: true }) })) // ask: what a spoken yes or no would answer
let talkProject = '' // Q5: the project of the last talk or Say it sent: a route into another one shows a little longer
// Q11: what was selected as the key was pressed (talk.ts selectionOf: masked, capped), until the pill closes; the pill's
// × drops it from a send. In Laki's window: its page's selection or the focused terminal's (App's lakiSelection); else
// the app in front's, by ⌘C (SEL_JXA: its pasteboard kept and put back, 150 ms for the copy to land; a password manager
// or SEL_SKIP's: not copied; no Accessibility for Laki: the key does nothing, so nothing)
let talkSel = ''
const SEL_JXA = `ObjC.import('AppKit'); ObjC.import('CoreGraphics')
function run(argv) {
  const skip = JSON.parse(argv[0]), front = $.NSWorkspace.sharedWorkspace.frontmostApplication
  const app = front.isNil() ? '' : ObjC.unwrap(front.bundleIdentifier) || ''
  if (!app || skip.some(d => app === d || app.indexOf(d + '.') === 0)) return JSON.stringify({ app, skip: true })
  const pb = $.NSPasteboard.generalPasteboard, was = pb.changeCount, kept = [], items = pb.pasteboardItems
  for (let i = 0; i < items.count; i++) { const it = items.objectAtIndex(i), ts = it.types, k = []; for (let j = 0; j < ts.count; j++) { const t = ts.objectAtIndex(j), d = it.dataForType(t); if (!d.isNil()) k.push([t, d]) } kept.push(k) }
  for (const down of [true, false]) { const e = $.CGEventCreateKeyboardEvent($(), 8, down); $.CGEventSetFlags(e, 0x100000); $.CGEventPost(0, e) }
  for (let n = 0; n < 15 && pb.changeCount === was; n++) delay(0.01)
  if (pb.changeCount === was) return JSON.stringify({ app, text: '' })
  const s = pb.stringForType($.NSPasteboardTypeString), text = s.isNil() ? '' : ObjC.unwrap(s)
  pb.clearContents
  if (kept.length) pb.writeObjects($(kept.map(k => { const it = $.NSPasteboardItem.alloc.init; k.forEach(([t, d]) => it.setDataForType(d, t)); return it })))
  return JSON.stringify({ app, text })
}`
function grabSelection(): Promise<string> {
  if (!mac || !floats.selection) return Promise.resolve('')
  const mine = BrowserWindow.getFocusedWindow()
  if (mine && mine === win) return mine.webContents.executeJavaScript('window.lakiSelection ? window.lakiSelection() : String(getSelection() || "")', true).then(t => selectionOf(typeof t === 'string' ? t : ''), () => '')
  if (mine) return Promise.resolve('') // another of Laki's windows: its own box has what you'd select
  return new Promise(done =>
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SEL_JXA, JSON.stringify(SEL_SKIP)], { timeout: 2000 }, (err, out) => {
      try {
        const r = JSON.parse(String(out)) as { text?: unknown }
        done(!err && typeof r.text === 'string' ? selectionOf(r.text) : '')
      } catch {
        done('')
      }
    }),
  )
}
const routeFor = () => floats.route && { ...floats.route, aiOn: floats.ai, last: talkProject, lastTab: talkLast }
export function talk() {
  if (talkW && !talkW.isDestroyed()) return void talkW.webContents.send('talk-key') // the second press: stop, send
  const sel = grabSelection() // first: the pill takes the focus as it shows
  const p = screen.getCursorScreenPoint()
  const d = screen.getDisplayNearestPoint(p).workArea
  const w = (talkW = new BrowserWindow({ ...floatOpts(TALK.width, TALK.height), x: clamp(p.x + 14, d.x, d.x + d.width - TALK.width), y: clamp(p.y + 18, d.y, d.y + d.height - TALK.height) }))
  const url = pageURL('floater.html', '#talk')
  pin(w, url)
  guardFloat('talk', w)
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.on('closed', () => talkW === w && ((talkW = null), (talkUndo = null), (talkTakeBack = null), (talkSel = ''), listen?.kill(), (listen = null)))
  w.webContents.on('did-finish-load', async () => {
    talkSel = await sel
    if (w.isDestroyed()) return
    const list = talkList()
    talkTo = new Set(list.map(f => f.tab))
    w.webContents.send('talk', { ...(floats.speech && speechBin() && { speech: floats.speech }), answers: !floats.noAnswers, list, to: floats.talkAi && floats.ai ? AI_TO : talkDefault(list, talkLast), ai: floats.ai, colors: floats.colors, mic: mac ? systemPreferences.getMediaAccessStatus('microphone') : 'granted', smoke: !!smoke, route: routeFor(), ...(talkSel && { selection: { label: selLabel(talkSel), head: talkSel.split('\n')[0].slice(0, 120) } }) })
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
ipcMain.handle('talk-send', async (e, tab: unknown, said: unknown, project: unknown, withSel: unknown) => {
  if (!fromTalk(e)) return { error: 'not the talk pill' }
  if (typeof said !== 'string' || !said.trim()) return { error: 'nothing to send' }
  if (said.length > 20000) return { error: 'too long: 20,000 characters at most' }
  if (typeof tab !== 'string') return { error: 'who gets it?' }
  const sel = withSel === true && tab !== TODO_TO ? talkSel : '' // Q11: the pill's × left it out; a to-do is one line
  const text = withSelection(said.trim(), sel, tab === AI_TO)
  const pid = typeof project === 'string' && floats.route?.projects.some(p => p.id === project) ? project : undefined
  if (!tab) return (talkProject = pid ?? talkProject), newWsWin(text, pid), { new: true }
  if (tab === AI_TO) return aiTalk(said.trim(), text)
  if (tab === NOTE_TO) return voiceNote(text)
  if (tab === TODO_TO) return voiceTodo(text, pid)
  if (!talkTo.has(tab)) return { error: 'not an agent the pill offered' }
  talkProject = ((floats.talk ?? floats.items) as (Float & { pid?: string })[]).find(x => x.tab === tab)?.pid ?? talkProject
  const r = await rpc<{ queued?: number }>('send', { target: tab, text: text.trim(), whenIdle: true, agent: true }).catch((err: Error) => ({ error: /no such|not found/i.test(err.message) ? 'that tab is gone' : err.message })) // agent: never a shell
  if ('error' in r) return r
  talkLast = tab
  talkUndo = r?.queued ? { tab, text: text.trim() } : null
  return { queued: !!r?.queued }
})
// Q5b: "Note: …" said first: a line with the local time added to the note named Voice (made on first use; its id
// kept as settings.voiceNote, so a rename keeps it), through the notes' own calls as the app's; Undo takes the line out
async function voiceNote(text: string): Promise<{ kept?: boolean; error?: string }> {
  type N = { id: string; blocks: { id?: string }[]; md: string }
  try {
    const id0 = (await rpc<View>('state')).settings?.voiceNote
    const n = (id0 ? await rpc<N>('noteGet', { id: id0 }).catch(() => null) : null) ?? (await rpc<N>('noteNew', { title: 'Voice' }).then(async m => (await rpc('settingsSet', { voiceNote: m.id }), m)))
    if (!n) return { error: "the note wasn't made" }
    const id = n.id
    const line = `${new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${text}`
    const bid = `voice-${Date.now().toString(36)}`
    await rpc('noteSave', { id, blocks: [...n.blocks, { id: bid, type: 'paragraph', content: [{ type: 'text', text: line, styles: {} }] }], md: n.md ? `${n.md}\n\n${line}` : line })
    talkTakeBack = async () => {
      const now = await rpc<N>('noteGet', { id })
      const i = now.md.lastIndexOf(line)
      await rpc('noteSave', { id, blocks: now.blocks.filter(b => b.id !== bid), md: i < 0 ? now.md : `${now.md.slice(0, i)}${now.md.slice(i + line.length)}`.replace(/\n{3,}/g, '\n\n').trim() })
    }
    return { kept: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}
// Q5b: "To-do [in <project>]: …": an item in that project's Backlog (the Board's To-dos), else the last one talked to;
// Undo removes it
async function voiceTodo(text: string, pid?: string): Promise<{ kept?: boolean; error?: string }> {
  const ps = floats.route?.projects ?? []
  const project = pid ?? (ps.some(p => p.id === talkProject) ? talkProject : ps[0]?.id)
  if (!project) return { error: 'which project? Say “To-do in <project>: …”' }
  return rpc<{ id: string }>('todoAdd', { project, text }).then(
    t => ((talkProject = project), (talkTakeBack = () => rpc('todoRm', { id: t.id })), { kept: true }),
    (err: Error) => ({ error: err.message }),
  )
}
// Undo: only a send still in its queue (typed into a terminal, it can't be taken back)
ipcMain.handle('talk-undo', async e => {
  if (fromTalk(e) && talkTakeBack) return (f => ((talkTakeBack = null), f().then(() => ({}), (err: Error) => ({ error: err.message }))))(talkTakeBack)
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
// the talk key's on-device engine (native/laki-speech.swift, built by after-pack.cjs beside the app's binary): main runs
// it, so its microphone and speech grants are Laki's; its lines (shared/speech.ts) go on to the pill. None (Linux, a dev
// run, a build without swiftc): Cloud only
const speechBin = () => (p => (mac && existsSync(p) ? p : undefined))(join(dirname(process.execPath), 'laki-speech'))
let listen: ChildProcess | null = null
ipcMain.handle('talk-listen', e => {
  if (!fromTalk(e)) return { error: 'not the talk pill' }
  const bin = speechBin()
  if (!bin || !floats.speech) return { error: "On this Mac isn't in this build: Settings › Voice › Talk key, Cloud" }
  listen?.kill()
  const p = (listen = spawn(bin, [floats.speech], { stdio: ['pipe', 'pipe', 'ignore'] }))
  const to = (x: object) => talkW && !talkW.isDestroyed() && talkW.webContents.send('talk-heard', x)
  createInterface({ input: p.stdout! }).on('line', l => (x => x && to(x))(speechLine(l)))
  p.on('error', err => to({ kind: 'error', error: err.message, code: 'start' }))
  p.on('exit', () => (listen === p && (listen = null), to({ kind: 'end' })))
  return {}
})
// a spoken yes or no to a waiting ask the pill offered (spokenMode said it may): the cards' answer, its option by n and label
ipcMain.handle('talk-answer', async (e, tab: unknown, n: unknown, label: unknown) => {
  if (!fromTalk(e)) return { error: 'not the talk pill' }
  if (typeof tab !== 'string' || !talkTo.has(tab) || typeof n !== 'number' || typeof label !== 'string') return { error: 'no such ask' }
  return rpc('answer', { tab, n, label }).then(
    () => ({}),
    (err: Error) => ({ error: err.message }),
  )
})
// stop it: keep, its final text (a line on its stdin); else dropped
ipcMain.on('talk-listen-stop', (e, keep: unknown) => fromTalk(e) && listen && (keep === true ? listen.stdin?.end('\n') : (listen.kill(), (listen = null))))
// what it wrote down, cleaned as Cloud's is (the daemon's voiceText: fillers out, word fixes in)
ipcMain.handle('talk-fix', (e, text: unknown) => {
  if (!fromTalk(e)) return { error: 'not the talk pill' }
  if (typeof text !== 'string') return { error: 'no text' }
  return rpc<{ text: string }>('voiceText', { text: text.slice(0, 20000) }).catch((err: Error) => ({ error: err.message }))
})
// Settings › Voice's: the languages it recognizes on this Mac ({ none }: not in this build)
ipcMain.handle('speech-locales', e => {
  if (!from(e)) return { error: "not Laki's window" }
  const bin = speechBin()
  if (!bin) return { none: true }
  return new Promise(r => execFile(bin, ['--locales'], { timeout: 15000 }, (err, out) => r(err ? { error: err.message } : (x => (x?.kind === 'locales' ? { locales: x.locales } : { error: 'no answer' }))(speechLine(String(out).trim().split('\n').pop() ?? '')))))
})
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
export const setFront = (on: boolean) => on !== front && ((front = on), placeFloater(), fnWatch(), win?.webContents.send('front', on)) // the app window: its animations pause behind another app (App's away)

// hold Fn to talk (Settings › Voice, the cloud; voice.ts): Chromium drops Fn's own key events on macOS (a flagsChanged of
// keyCode 63, as Safari does), so no page ever sees Fn go down. Main watches its flag instead, only while Laki is the
// front app and a page with a prompt asked (fn-watch: the app, the new-workspace and AI windows): osascript's JXA reads
// NSEvent's modifier flags every FN_MS and says each change of Fn's (NSEventModifierFlagFunction); the focused page that
// asked gets 'fn' true or false. Off-Mac Fn never reaches an app. ponytail: a poll (about 2% of a core while Laki is in
// front), a native NSEvent monitor later. In front: the app window's `front`, or a page that asked has the focus (the AI
// or new-workspace window over another app: `own` leaves them out, so `front` stays false there)
const fnFocus = () => (wc => !!wc && fnWant.has(wc))(BrowserWindow.getFocusedWindow()?.webContents)
const FN_MS = 40
const FN_JXA = `ObjC.import('Cocoa'); let was = 0; for (;;) { const f = Number($.NSEvent.modifierFlags) & 0x800000 ? 1 : 0; if (f !== was) { was = f; console.log(f) } delay(${FN_MS / 1000}) }`
const fnWant = new Set<Electron.WebContents>()
let fnProc: ChildProcess | null = null
let fnFails = 0 // quick exits in a row: at 3 it waits until Laki is in front again (osascript refused, say)
function fnWatch() {
  const on = mac && (front || fnFocus()) && fnWant.size > 0
  if (!on) return void (fnProc?.kill(), (fnProc = null), front || fnFocus() || (fnFails = 0))
  if (fnProc || fnFails >= 3) return
  const at = Date.now()
  const p = (fnProc = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FN_JXA], { stdio: ['ignore', 'ignore', 'pipe'] }))
  let buf = ''
  p.stderr!.on('data', (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    const to = BrowserWindow.getFocusedWindow()?.webContents
    for (const l of lines) if ((l === '0' || l === '1') && to && fnWant.has(to)) to.send('fn', l === '1') // JXA's console.log is stderr
  })
  p.on('exit', () => fnProc === p && ((fnProc = null), (fnFails = Date.now() - at < 10e3 ? fnFails + 1 : 0), setTimeout(fnWatch, 2000))) // gone by itself: again in a moment
  p.on('error', () => {})
}
ipcMain.on('fn-watch', (e, on: unknown) => {
  if (!from(e, 'new', 'ai')) return
  const wc = e.sender
  if (on === true && !fnWant.has(wc)) (fnWant.add(wc), wc.once('destroyed', () => (fnWant.delete(wc), fnWatch())))
  else if (on !== true) fnWant.delete(wc)
  fnWatch()
})
app.on('browser-window-focus', (_e, w) => (own(w) ? setFront(true) : fnWatch())) // the AI or new-workspace window: Fn's watch
app.on('browser-window-blur', () => setTimeout(fnWatch, 100)) // after the next window's focus: off once none that asked has it
app.on('did-become-active', () => setTimeout(() => setFront(own(BrowserWindow.getFocusedWindow())), 100)) // the focus comes after
app.on('did-resign-active', () => setFront(false))
if (!mac) app.on('browser-window-blur', () => setTimeout(() => setFront(own(BrowserWindow.getFocusedWindow())), 100)) // no did-resign-active there: none of Laki's windows has the focus
