// The daemon connection: one authenticated WebSocket, requests by id, events to listeners.
// In Electron the preload bridge hands out the address and token; in a plain browser they come in the URL hash:
// http://127.0.0.1:5199/#port=…&token=… (dev), or the token alone in the query on the daemon's own page (remote
// access: Cloudflare's email sign-in sends the browser back with the path and query, without the hash).
import type { UpdateState } from '../../shared/update'

// a notification's button: a waiting agent's choice (n, and its words: refused if the menu changed), or a pick
export type NotifyAction = { text: string; n?: number; label?: string; pick?: 'first' | 'last'; tool?: { req: string; allow: 'once' | 'always' | 'deny' } } // tool: an extension's tool call's answer (widgetToolAnswer)
type Bridge = {
  conn(): Promise<{ port: number; token: string }>
  notify(title: string, body: string, tab: string, sound?: string, actions?: NotifyAction[]): void
  sound?(name: string): void
  browse?(r: object): Promise<unknown>
  onFocusTab(cb: (tab: string) => void): void
  onEarn?(cb: (id: string) => void): void
  onBrowserTab?(cb: (url: string, front: boolean) => void): void // a Browsers page's link to a new tab: front, or in the background
  onBrowserKey?(cb: (key: string) => void): void // a Browsers page's new or close tab (the page gets keys, not the app) or a menu bar item: a shared/keys.ts id, else a ⌘ key
  pickFolder(): Promise<string | null>
  pathOf?(f: File): string
  openExternal(url: string): void
  openPath?(path: string, root?: string): Promise<{ rel: string } | 'opened' | 'missing'> // a ⌘-clicked file:// link (main's open-path)
  onFront?(cb: (on: boolean) => void): void // Laki became the front app, or another app did (main's setFront)
  copyFile?(path: string): Promise<'image' | 'file' | 'missing'> // an artifact to the clipboard: a picture as one, else the file (main's copy-file)
  dictate?(): void
  dictationSettings?(): void
  glass?(on: boolean): void
  fullScreen?(on: boolean): void // ⌘⇧⏎: the window full screen (the tab alone in it), or as it was
  dockIcon?(png: string): void // Settings' Dock icon, a PNG data URL (main's app.dock.setIcon)
  hotkey?(label: string): Promise<boolean> // the global hotkey, keyLabel's text ('' none): false when another app has it (main's globalShortcut)
  keys?(over: Record<string, string>): void // Settings › Keys' (settings.keys): the menu bar's items show them, a Browsers page's ⌘T/⌘W follow them
  shotKey?(label: string | false): Promise<boolean> // Screenshot to Laki AI's ('' none; false: off, no menu bar item either)
  update?(op: 'state' | 'check' | 'download' | 'install'): Promise<UpdateState | null> // main's update.ts
  updateAuto?(on: boolean): void // Settings' Check for updates: at launch, then every 4 hours
  onUpdate?(cb: (s: UpdateState) => void): () => void // its state as it changes; the function stops listening
  onAiShot?(cb: (png: string) => void): void // the AI window's: that screenshot (a PNG, base64)
  floatTab?(tab: string, on?: boolean): void // a tab in a window of its own over every app (main's tabWin), or back (on false)
  floating?(): Promise<string[]> // the tabs floated out
  floatSim?(device: string, ws?: string): void // the side panel's simulator in a window of its own over every app (main's simWins)
  onFloating?(cb: (tabs: string[]) => void): void
  badge?(n: number, items?: { tab: string; label: string }[], tray?: boolean): void // the Dock's count; the menu bar's item
  floats?(items: object[], colors: Record<string, string>, opts?: { style: string; cards: boolean; add: boolean; menu: string; voiceTo: string }): void // the floating bubbles' workspaces (none, no buttons: hidden)
  procs?(): Promise<{ pid: number; name: string; stop?: string }[]>
  procStop?(what: string): void
  onDeepLink?(cb: (url: string) => void): void
  capture?(webContentsId: number): Promise<string>
  captureRect?(r: { x: number; y: number; width: number; height: number }): Promise<string> // the app window's pixels there, a PNG in base64 (the element picker's)
  shoot?(): Promise<string | null> // a part of the screen picked with macOS's screencapture, a PNG in base64; null: cancelled
  onShot?(cb: (png: string, note?: string) => void): void
  onNewPrompt?(cb: (prompt: string) => void): void // the new-workspace window's: a voice prompt while it's open
  fitNew?(height: number): void // the new-workspace window's: its height, as tall as the page
}
export const bridge: Bridge | undefined = (window as any).laki

export type Msg = { ev: string; [k: string]: any }

// remote access's token, taken out of the address bar (and this page's history entry: Cloudflare's sign-in page, an
// entry before it, keeps the link) once read; the tab keeps it for its reconnects and reloads
let kept = ''
const keep = (t: string) => {
  kept = t
  try {
    sessionStorage.setItem('laki.token', t)
  } catch {}
}
function pageToken() {
  const q = new URLSearchParams(location.search)
  const t = q.get('token')
  if (t) {
    keep(t)
    q.delete('token')
    const rest = q.toString()
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
  }
  if (!kept)
    try {
      kept = sessionStorage.getItem('laki.token') ?? ''
    } catch {}
  return kept
}

async function wsURL() {
  const { port, token } = bridge ? await bridge.conn() : (h => ({ port: h.get('port'), token: h.get('token') ?? pageToken() }))(new URLSearchParams(location.hash.slice(1)))
  const at = port ? `ws://127.0.0.1:${port}` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` // no port: the page's own daemon
  return { url: `${at}/ws?token=${encodeURIComponent(token)}`, token, remote: !port }
}

// the daemon's address for a frame (a JS widget's page): its port here, or none: the page's own daemon (remote access)
export async function daemonBase() {
  const port = bridge ? (await bridge.conn()).port : new URLSearchParams(location.hash.slice(1)).get('port')
  return port ? `http://127.0.0.1:${port}` : ''
}

// remote access, when the socket won't open (a browser can't read why): Cloudflare's sign-in ran out (its redirect:
// a reload signs in again, the token stays in the tab), or the link did (remote access stopped or started again)
async function whyNot(token: string): Promise<string | undefined> {
  const page = await fetch(location.pathname, { redirect: 'manual', cache: 'no-store' }).catch(() => null)
  if (!page || page.status >= 500) return 'Laki on your Mac is out of reach: remote access stopped, or the Mac is asleep or offline. Retrying…'
  if (page.type === 'opaqueredirect' || page.status === 401 || page.status === 403) { // the daemon's pages are 200 or 404: Access's
    let last = 0
    try {
      last = Number(sessionStorage.getItem('laki.signin')) || 0
      sessionStorage.setItem('laki.signin', String(Date.now()))
    } catch {}
    if (Date.now() - last > 30000) location.reload() // once in a while: a sign-in that won't stick doesn't loop
    return 'Your Cloudflare sign-in has ended: reload the page to sign in again.'
  }
  const rpc = await fetch('/rpc', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{"method":"ping"}' }).catch(() => null)
  if (rpc?.status === 401 || rpc?.status === 403)
    return 'This link has ended: a link opens once (in one tab), or remote access was stopped or started again. Open a new link from Laki on your Mac (Settings › Remote access).'
}

// remote access's first ask (core.remotePin): the link's key, good once, for this tab's own token, or a PIN first.
// null: no answer (asked again next time)
async function pinNeed(token: string): Promise<{ need: boolean; left?: number; token?: string } | null> {
  const r = await fetch('/pin', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => null)
  return r?.ok ? r.json().catch(() => null) : null
}

class Api {
  private ws: WebSocket | null = null
  private seq = 0
  private waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()
  private listeners = new Set<(m: Msg) => void>()
  private calls = new Set<(method: string, params: any, r: any) => void>() // each call that went well, with its result (App's achievements)
  connected = false

  private fails = 0 // connects in a row that never opened
  private pinned = false // the remote page: no PIN asked for (or given)

  async connect() {
    try {
      let to = await wsURL()
      if (to.remote && !this.pinned) {
        const p = await pinNeed(to.token)
        if (p?.need) return this.emit({ ev: 'pin', left: p.left }) // the splash asks; pin() connects
        if (p?.token) keep(p.token), (to = await wsURL()) // the link's key, swapped for this tab's: the link is dead now
        this.pinned = !!p
      }
      const ws = new WebSocket(to.url)
      this.ws = ws
      ws.onopen = () => {
        this.connected = true
        this.fails = 0
        this.emit({ ev: 'open' })
      }
      ws.onmessage = e => {
        const m = JSON.parse(e.data)
        if (m.ev === undefined && m.id !== undefined) { // a reply; an event may carry an id of its own (a workflow run's)
          const w = this.waiting.get(m.id)
          this.waiting.delete(m.id)
          // unknown method: a daemon older than the app, still running (it outlives updates)
          if (m.error) w?.rej(new Error(/^unknown method /.test(m.error) ? `Laki's daemon is older than the app (no ${m.error.slice(15)}): close this page and restart it from the yellow bar at the top (agents resume)` : m.error))
          else w?.res(m.result)
        } else this.emit(m)
      }
      ws.onclose = () => {
        const opened = this.connected
        this.connected = false
        for (const w of this.waiting.values()) w.rej(new Error('disconnected'))
        this.waiting.clear()
        this.emit({ ev: 'close' })
        if (!opened) this.fails++
        // the remote page waits longer each time (up to 10 s), not a retry a second, and asks why after a second miss
        // (meanwhile: an answer after a reconnect says nothing)
        setTimeout(() => this.connect(), to.remote ? Math.min(1000 * 2 ** Math.max(0, this.fails - 1), 10000) : 1000)
        if (to.remote && this.fails >= 2) void whyNot(to.token).then(text => !this.connected && this.emit({ ev: 'problem', text }))
      }
    } catch {
      setTimeout(() => this.connect(), 1000)
    }
  }

  // the PIN shown in Laki on the Mac, for remote access's page: its token in place of the link's key, then connect
  async pin(code: string) {
    const r = await fetch('/pin', { method: 'POST', body: JSON.stringify({ token: pageToken(), pin: code }) }).then(r => r.json(), () => null).catch(() => null)
    if (!r?.token) throw new Error(r?.error ?? 'Laki on your Mac is out of reach. Try again.')
    keep(r.token)
    this.pinned = true
    void this.connect()
  }

  call<T = any>(method: string, params: object = {}): Promise<T> {
    const id = ++this.seq
    return new Promise((res, rej) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return rej(new Error('not connected'))
      this.waiting.set(id, { res: r => (res(r), this.calls.forEach(f => f(method, params, r))), rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  // fire and forget (keystrokes, resizes)
  send(method: string, params: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method, params }))
  }

  on(f: (m: Msg) => void) {
    this.listeners.add(f)
    return () => void this.listeners.delete(f)
  }

  onCall(f: (method: string, params: any, r: any) => void) {
    this.calls.add(f)
    return () => void this.calls.delete(f)
  }

  private emit(m: Msg) {
    for (const f of this.listeners) f(m)
  }
}

export const api = new Api()

// tell the daemon what this window shows (App's panes, a floated tab's window): it clears their ● and sets none while
// you look. focused and shown (the window isn't hidden: closing it only hides it, so widgets fetch only while it's
// open) are added here, again as they change and as the socket opens. The cleanup, for an effect
export function reportView(what: () => { tab: string | null; tabs: string[]; browse?: boolean; ws?: string | null }) {
  const report = () => api.send('view', { ...what(), focused: document.hasFocus(), shown: document.visibilityState === 'visible' })
  report()
  window.addEventListener('focus', report)
  window.addEventListener('blur', report)
  document.addEventListener('visibilitychange', report)
  const off = api.on(m => m.ev === 'open' && report())
  return () => {
    window.removeEventListener('focus', report)
    window.removeEventListener('blur', report)
    document.removeEventListener('visibilitychange', report)
    off()
  }
}

// a laki:// link (the AI's to a workspace or tab) goes to the app's own router (App's onLakiLink); a window without one
// (the AI window) hands it to main, which shows the app window and routes it there
let lakiLink: ((url: string) => void) | undefined
export const onLakiLink = (f: (url: string) => void) => void (lakiLink = f)
// a file:/// link's path (a .url file's: a page an agent made on this Mac); '' for anything else
// what the page on screen tells Laki AI's floating chat as you ask (App's whereNow): the open workflow, its file
export const pageNow: { workflow?: () => string } = {}
export const fileOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'file:' && !u.host ? decodeURIComponent(u.pathname) : ''
  } catch {
    return ''
  }
}
export const openExternal = (url: string) => {
  if (url.startsWith('laki:') && lakiLink) return lakiLink(url)
  return bridge ? bridge.openExternal(url) : window.open(url, '_blank', 'noopener')
}
// a storage folder's link (a .url file's, Artifacts' and the info panel's): a file:/// one through main's open-path (a
// document in its app, a web page in the browser; anything that could run only shown in Finder), as no other link does
// (a widget's, a web page's); a browser elsewhere can't reach this Mac's files. Rejects when it can't open it
export const openKeptLink = async (url: string) => {
  const path = fileOf(url)
  if (!url.startsWith('file:')) return void openExternal(url)
  if (!path) throw new Error(`Not a file on this Mac: ${url}`) // a host's, or a broken %
  if (!bridge?.openPath) throw new Error('A file on the Mac: open it in Laki there')
  if ((await bridge.openPath(path)) === 'missing') throw new Error(`Not on this Mac any more: ${path}`)
}

export function notify(title: string, body: string, tab: string, onClick: () => void, sound?: string, actions?: NotifyAction[]) {
  if (bridge) return bridge.notify(title, body, tab, sound, actions)
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission()
  if (Notification.permission === 'granted') new Notification(title, { body, silent: sound === 'none' }).onclick = onClick
}
