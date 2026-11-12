// The daemon connection: one authenticated WebSocket, requests by id, events to listeners.
// In Electron the preload bridge hands out the address and token; in a plain browser they come in the URL hash:
// http://127.0.0.1:5199/#port=…&token=… (dev), or the link's key alone in the hash (#t=…, S11) on the daemon's own page (remote
// access: Cloudflare's email sign-in sends the browser back with the path and query, without the hash).
import type { TrayInfo } from '../../shared/tray'
import type { UpdateState } from '../../shared/update'
import { sendAs } from '../../shared/caps'

// a notification's button: a waiting agent's choice (n, and its words: refused if the menu changed), or a pick
export type NotifyAction = { text: string; reply?: boolean /* U15: a free-text question's Reply field (macOS), not a button */; stop?: boolean; n?: number; label?: string; pick?: 'first' | 'last'; tool?: { req: string; allow: 'once' | 'always' | 'deny' }; alert?: { id: string; choice: string } } // tool: an extension's tool call's answer (widgetToolAnswer)
type Bridge = {
  conn(): Promise<{ port: number; token: string }>
  restartDaemon?(): Promise<boolean> // main stops the daemon by its pid and starts one from this bundle (one that refused this app's shutdown)
  notify(title: string, body: string, tab: string, sound?: string, actions?: NotifyAction[], card?: Card): void
  asking?(tabs: string[]): void // the tabs that wait (cards on screen)
  cardGone?(key: string): void // a laki alert over: its card goes
  sound?(name: string): void
  browse?(r: object): Promise<unknown>
  onFocusTab(cb: (tab: string, panel?: string) => void): void
  onEarn?(cb: (id: string) => void): void
  onBrowserTab?(cb: (url: string, front: boolean) => void): void // a Browsers page's link to a new tab: front, or in the background
  onBrowserKey?(cb: (key: string) => void): void // a Browsers page's new or close tab (the page gets keys, not the app) or a menu bar item: a shared/keys.ts id, else a ⌘ key
  pickFolder(): Promise<string | null>
  pathOf?(f: File): string
  openExternal(url: string): void
  openPath?(path: string, root?: string): Promise<{ rel: string } | 'opened' | 'missing'> // a ⌘-clicked file:// link (main's open-path)
  share?(url: string): void // U15: macOS's Share menu for a link, at the pointer (main's share-menu)
  bounce?(): void // U15: the Dock icon bounces once (informational), when Laki isn't in front
  quickLook?(path: string): void // U14: macOS's Quick Look of a file (main's quick-look; a regular file only, macOS only)
  onFront?(cb: (on: boolean) => void): void // Laki became the front app, or another app did (main's setFront)
  copyFile?(path: string): Promise<'image' | 'file' | 'missing'> // an artifact to the clipboard: a picture as one, else the file (main's copy-file)
  openFile?(path: string, root: string): Promise<'opened' | 'missing' | 'viewer'> // an HTML artifact inside root as a file:// page in the default browser (main's open-file)
  dictate?(): void
  dictationSettings?(): void
  glass?(on: boolean, light?: boolean, float?: boolean, side?: boolean): void // side: V5's sidebar material
  fullScreen?(on: boolean): void // ⌘⇧⏎: the window full screen (the tab alone in it), or as it was
  dockIcon?(png: string): void // Settings' Dock icon, a PNG data URL (main's app.dock.setIcon)
  hotkey?(label: string): Promise<boolean> // the global hotkey, keyLabel's text ('' none): false when another app has it (main's globalShortcut)
  keys?(over: Record<string, string>): void // Settings › Keys' (settings.keys): the menu bar's items show them, a Browsers page's ⌘T/⌘W follow them
  shotKey?(label: string | false): Promise<boolean> // Screenshot to Laki AI's ('' none; false: off, no menu bar item either)
  quickKey?(label: string): Promise<boolean> // Q1: the quick bar's global keys ('' none)
  quickMore?(text: string): void // the quick bar's More: the whole new-workspace page with its text
  quickShot?(): Promise<string> // its screenshot button: a part of the screen ('' cancelled)
  tellKey?(label: string): Promise<boolean> // Q7: show and tell's global keys ('' none)
  talkKey?(label: string): Promise<boolean> // Q2: the talk key ('' none)
  fnWatch?(on: boolean): void // hold Fn: main watches Fn for this page (voice.ts; Chromium drops Fn's key events on macOS)
  onFn?(cb: (down: boolean) => void): void
  onTell?(cb: (t: { png: string; mic?: string; dictation?: boolean; note?: string; edited?: boolean }) => void): void // the quick bar's: show and tell's picture (and the editor's, edited)
  quickAnnotate?(png: string): void // its E: the picture in the editor first, back here
  privacyPane?(which: 'microphone' | 'screen'): void // System Settings › Privacy & Security's pane
  quickHeight?(h: number): void // its window as tall as the page
  update?(op: 'state' | 'check' | 'download' | 'install' | 'skip' | 'pass' | 'unpass'): Promise<UpdateState | null> // main's update.ts
  updateAuto?(on: boolean, days?: number): void // Settings' Check for updates (at launch, then every 4 hours) and Update delay
  onUpdate?(cb: (s: UpdateState) => void): () => void // its state as it changes; the function stops listening
  onAiShot?(cb: (png: string) => void): void // the AI window's: that screenshot (a PNG, base64)
  floatTab?(tab: string, on?: boolean): void // a tab in a window of its own over every app (main's tabWin), or back (on false)
  floating?(): Promise<string[]> // the tabs floated out
  floatSim?(device: string, ws?: string, on?: boolean): void // the side panel's simulator in a window of its own over every app (main's simWins), or back (false)
  simFloating?(): Promise<string[]> // the devices in windows of their own
  onSimFloating?(cb: (devices: string[]) => void): void
  onFloating?(cb: (tabs: string[]) => void): void
  badge?(n: number, items?: { tab: string; label: string }[], tray?: boolean, recording?: boolean, state?: TrayInfo, progress?: number): void // the Dock's count; the menu bar's item (its Recording Mode ticked; state: Q8, its picture, title and tooltip); progress: U15's Dock bar (tray.ts dockProgress)
  floats?(items: object[], colors: Record<string, string>, opts?: { style: string; cards: boolean; add: boolean; menu: string; voiceTo: string }): void // the floating bubbles' workspaces (none, no buttons: hidden)
  procs?(): Promise<{ pid: number; name: string; stop?: string }[]>
  procStop?(what: string): void
  browserMem?(ids: number[]): Promise<{ kb: number } | null>
  browserGuard?(id: number): Promise<string | undefined>
  onDeepLink?(cb: (url: string) => void): void
  onFolders?(cb: (paths: string[]) => void): () => void // folders dropped on the Dock icon: projects, as a drop on the window
  capture?(webContentsId: number): Promise<string>
  pageShot?(webContentsId: number, whole: boolean, save: boolean): Promise<string> // a Browsers page's screenshot: copied (''), or saved (its path)
  captureRect?(r: { x: number; y: number; width: number; height: number }): Promise<string> // the app window's pixels there, a PNG in base64 (the element picker's)
  shoot?(): Promise<string | null> // a part of the screen picked with macOS's screencapture, a PNG in base64; null: cancelled
  onShot?(cb: (png: string, note?: string) => void): void
  onNewPrompt?(cb: (prompt: string, project?: string) => void): void // the new-workspace window's: a voice prompt while it's open
  fitNew?(height: number): void // the new-workspace window's: its height, as tall as the page
}
export const bridge: Bridge | undefined = (window as any).laki

export type Msg = { ev: string; [k: string]: any }

// remote access's token, taken out of the address bar (and this page's history entry: Cloudflare's sign-in page, an
// entry before it, keeps the link) once read; the tab keeps it for its reconnects and reloads
let kept = ''
const DEVICE = 'device' // D3: the page of a paired device: its cookie gets it in (sent as its auth: any word does)
const keep = (t: string) => {
  kept = t
  try {
    sessionStorage.setItem('laki.token', t)
  } catch {}
}
// S11: the link's key comes in the hash (#t=…): a browser never sends it, so no proxy or log has it
function pageToken() {
  const h = new URLSearchParams(location.hash.slice(1))
  const t = h.get('t')
  if (t) {
    keep(t)
    h.delete('t')
    const rest = h.toString()
    history.replaceState(history.state, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`)
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
  return { url: port ? `${at}/ws?token=${encodeURIComponent(token)}` : `${at}/ws`, token, remote: !port } // S11: remote's in its first message
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
// device: a paired device (D3, a stable address): its cookie (HttpOnly, the daemon's) is its way in, no token here
async function pinNeed(token: string): Promise<{ need: boolean; left?: number; token?: string; device?: boolean } | null> {
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
  answerOnly = false // D7: a phone at answer only (its view's remote.level): its terminals take no keys
  locked = false // D6: the page waits for its unlock (a passkey device's): its state, once it comes, opens it as a new socket would
  private caps: string[] = [] // the daemon's, from its last view

  private fails = 0 // connects in a row that never opened
  private pinned = false // the remote page: no PIN asked for (or given)

  async connect() {
    try {
      let to = await wsURL()
      if (to.remote && !this.pinned) {
        const p = await pinNeed(to.token)
        if (p?.need) return this.emit({ ev: 'pin', left: p.left }) // the splash asks; pin() connects
        if (p?.token) keep(p.token), (to = await wsURL()) // the link's key, swapped for this tab's: the link is dead now
        else if (p?.device) keep(DEVICE), (to = await wsURL()) // D3: paired (now, or before: a new tab, a restart)
        // S11: no key: Cloudflare's email sign-in sends the browser back without the hash. The link works until it's used
        else if (!to.token) return this.emit({ ev: 'problem', text: "Signed in. Now open the link from Laki on your Mac again: the sign-in doesn't keep its key." })
        this.pinned = !!p
      }
      const ws = new WebSocket(to.url)
      this.ws = ws
      ws.onopen = () => {
        if (to.remote) ws.send(JSON.stringify({ auth: to.token })) // S11: first, before any call
        this.connected = true
        this.fails = 0
        this.emit({ ev: 'open' })
      }
      ws.onmessage = e => {
        const m = JSON.parse(e.data)
        if (m.ev === 'locked') this.locked = true // D6: a passkey device's page, until its state comes
        if (m.ev === undefined && m.id !== undefined) { // a reply; an event may carry an id of its own (a workflow run's)
          const w = this.waiting.get(m.id)
          this.waiting.delete(m.id)
          // unknown method: a daemon older than the app, still running (it outlives updates)
          if (m.error) w?.rej(new Error(/^unknown method /.test(m.error) ? `Laki's daemon is older than the app (no ${m.error.slice(15)}): close this page and restart it from the yellow bar at the top (agents resume)` : m.error))
          else w?.res(m.result)
        } else {
          if (m.ev === 'state') (this.caps = m.view?.caps ?? []), (this.answerOnly = m.view?.remote?.level === 'answer') // the namespaces it takes (caps.ts): call() sends the rest by their old names; D7: this page's access
          const opens = m.ev === 'state' && this.locked
          if (opens) this.locked = false
          this.emit(m)
          if (opens) this.emit({ ev: 'open' }) // D6: unlocked: as a socket that just opened (what it sent while locked was refused): its terminals attach, its view is told, its lists come
        }
      }
      ws.onclose = () => {
        const opened = this.connected
        this.connected = false
        this.locked = false
        this.caps = [] // the next daemon's come with its first view: old names till then
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
    if (!r?.token && !r?.device) throw new Error(r?.error ?? 'Laki on your Mac is out of reach. Try again.')
    keep(r.token ?? DEVICE) // D3: a paired device's way in is its cookie
    this.pinned = true
    void this.connect()
  }

  call<T = any>(method: string, params: object = {}): Promise<T> {
    method = sendAs(method, this.caps) // an older daemon (or no view yet): note.list as noteList
    const id = ++this.seq
    return new Promise((res, rej) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return rej(new Error('not connected'))
      this.waiting.set(id, { res: r => (res(r), this.calls.forEach(f => f(method, params, r))), rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  // fire and forget (keystrokes, resizes)
  send(method: string, params: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: sendAs(method, this.caps), params }))
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

// D6: a paired device's passkey (remote access at a stable address): set up just after pairing, then the unlock of
// each page. ES256 only, user verification required, attestation none: the key comes from getPublicKey() (the daemon
// reads no CBOR: passkey.ts says why). Each part to the daemon as base64url
const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
export const passkeys = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !bridge
// Safari runs WebAuthn only close to the tap: the daemon's challenge is asked for before it (passkeyReady, as the card
// shows), so the tap goes straight to Face ID; one older than 50 s (the daemon's last a minute) is asked again
const early: Partial<Record<'passkeyOptions' | 'passkeyChallenge', { at: number; p: Promise<any> }>> = {}
export const passkeyReady = (m: 'passkeyOptions' | 'passkeyChallenge') => void (early[m] = { at: Date.now(), p: api.call(m) }).p.catch(() => {})
const challenge = <T,>(m: 'passkeyOptions' | 'passkeyChallenge'): Promise<T> => {
  const e = early[m]
  delete early[m]
  return e && Date.now() - e.at < 50_000 ? e.p : api.call<T>(m)
}
export async function passkeySetUp() {
  const o = await challenge<{ challenge: string; rpId: string; user: { id: string; name: string } }>('passkeyOptions')
  const c = (await navigator.credentials.create({
    publicKey: { rp: { id: o.rpId, name: 'Laki' }, user: { id: unb64u(o.user.id), name: o.user.name, displayName: o.user.name }, challenge: unb64u(o.challenge), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' }, attestation: 'none', timeout: 60000 },
  })) as PublicKeyCredential | null
  if (!c) throw new Error('cancelled')
  const r = c.response as AuthenticatorAttestationResponse
  const key = r.getPublicKey()
  if (!key) throw new Error("this browser doesn't give the passkey's key: unlock with the PIN")
  return api.call('passkeyRegister', { id: b64u(c.rawId), clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.getAuthenticatorData()), publicKey: b64u(key), alg: r.getPublicKeyAlgorithm() })
}
export async function passkeyUnlock() {
  const ch = await challenge<{ challenge: string; rpId: string; id: string }>('passkeyChallenge')
  const c = (await navigator.credentials.get({ publicKey: { challenge: unb64u(ch.challenge), rpId: ch.rpId, allowCredentials: [{ type: 'public-key', id: unb64u(ch.id) }], userVerification: 'required', timeout: 60000 } })) as PublicKeyCredential | null
  if (!c) throw new Error('cancelled')
  const r = c.response as AuthenticatorAssertionResponse
  return api.call('passkeyUnlock', { id: b64u(c.rawId), clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature) })
}

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

// card: something you marked important (a workspace, a timer, a reminder) or a laki alert, as a card on screen instead
// (main's addCard; the app only): ask, a waiting agent's (its diff with it); alert, laki alert's id; tone, the edge's
// color (ok: a finish, bad: a limit)
type Card = { diff?: string; ask?: boolean; alert?: string; tone?: 'ok' | 'bad' | 'info'; origin?: string }
// U8: Do not disturb (the view's dnd, App sets it): nothing is sent, no sound, but an important workspace's ask and a
// laki alert (their cards)
let quiet = false
export const setQuiet = (on: boolean) => void (quiet = on)
export function notify(title: string, body: string, tab: string, onClick: () => void, sound?: string, actions?: NotifyAction[], card?: Card) {
  if (quiet && !card?.ask && !card?.alert) return
  if (bridge) return bridge.notify(title, body, tab, sound, actions, card)
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission()
  if (Notification.permission === 'granted') new Notification(title, { body, silent: sound === 'none' }).onclick = onClick
}
