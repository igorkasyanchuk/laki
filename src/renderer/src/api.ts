// The daemon connection: one authenticated WebSocket, requests by id, events to listeners.
// In Electron the preload bridge hands out the address and token; in a plain browser they come in the URL hash:
// http://127.0.0.1:5199/#port=…&token=… (dev), or the token alone in the query on the daemon's own page (remote
// access: Cloudflare's email sign-in sends the browser back with the path and query, without the hash).
type Bridge = {
  conn(): Promise<{ port: number; token: string }>
  notify(title: string, body: string, tab: string, sound?: string, actions?: string[]): void
  browse?(r: object): Promise<unknown>
  onFocusTab(cb: (tab: string) => void): void
  pickFolder(): Promise<string | null>
  pathOf?(f: File): string
  openExternal(url: string): void
  dictate?(): void
  dictationSettings?(): void
  glass?(on: boolean): void
  badge?(n: number, items?: { tab: string; label: string }[], tray?: boolean): void // the Dock's count; the menu bar's item
  onDeepLink?(cb: (url: string) => void): void
  capture?(webContentsId: number): Promise<string>
}
export const bridge: Bridge | undefined = (window as any).laki

export type Msg = { ev: string; [k: string]: any }

async function wsURL() {
  const { port, token } = bridge ? await bridge.conn() : (h => ({ port: h.get('port'), token: h.get('token') ?? new URLSearchParams(location.search).get('token') ?? '' }))(new URLSearchParams(location.hash.slice(1)))
  const at = port ? `ws://127.0.0.1:${port}` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` // no port: the page's own daemon
  return `${at}/ws?token=${encodeURIComponent(token)}`
}

class Api {
  private ws: WebSocket | null = null
  private seq = 0
  private waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()
  private listeners = new Set<(m: Msg) => void>()
  connected = false

  async connect() {
    try {
      const ws = new WebSocket(await wsURL())
      this.ws = ws
      ws.onopen = () => {
        this.connected = true
        this.emit({ ev: 'open' })
      }
      ws.onmessage = e => {
        const m = JSON.parse(e.data)
        if (m.id !== undefined) {
          const w = this.waiting.get(m.id)
          this.waiting.delete(m.id)
          // unknown method: a daemon older than the app, still running (it outlives updates)
          if (m.error) w?.rej(new Error(/^unknown method /.test(m.error) ? "Laki's daemon is older than the app: restart it from the status bar (agents resume)" : m.error))
          else w?.res(m.result)
        } else this.emit(m)
      }
      ws.onclose = () => {
        this.connected = false
        for (const w of this.waiting.values()) w.rej(new Error('disconnected'))
        this.waiting.clear()
        this.emit({ ev: 'close' })
        setTimeout(() => this.connect(), 1000)
      }
    } catch {
      setTimeout(() => this.connect(), 1000)
    }
  }

  call<T = any>(method: string, params: object = {}): Promise<T> {
    const id = ++this.seq
    return new Promise((res, rej) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return rej(new Error('not connected'))
      this.waiting.set(id, { res, rej })
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

  private emit(m: Msg) {
    for (const f of this.listeners) f(m)
  }
}

export const api = new Api()

export const openExternal = (url: string) => (bridge ? bridge.openExternal(url) : window.open(url, '_blank', 'noopener'))

export function notify(title: string, body: string, tab: string, onClick: () => void, sound?: string, actions?: string[]) {
  if (bridge) return bridge.notify(title, body, tab, sound, actions)
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission()
  if (Notification.permission === 'granted') new Notification(title, { body, silent: sound === 'none' }).onclick = onClick
}
