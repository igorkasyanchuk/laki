// The daemon connection: one authenticated WebSocket, requests by id, events to listeners.
// In Electron the preload bridge hands out the address and token; in a plain browser (dev) they come
// in the URL hash: http://127.0.0.1:5199/#port=…&token=…
type Bridge = {
  conn(): Promise<{ port: number; token: string }>
  notify(title: string, body: string, tab: string): void
  onFocusTab(cb: (tab: string) => void): void
  pickFolder(): Promise<string | null>
  openExternal(url: string): void
}
export const bridge: Bridge | undefined = (window as any).wbs

export type Msg = { ev: string; [k: string]: any }

async function connInfo() {
  if (bridge) return bridge.conn()
  const h = new URLSearchParams(location.hash.slice(1))
  return { port: Number(h.get('port')), token: h.get('token') ?? '' }
}

class Api {
  private ws: WebSocket | null = null
  private seq = 0
  private waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()
  private listeners = new Set<(m: Msg) => void>()
  connected = false

  async connect() {
    try {
      const { port, token } = await connInfo()
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`)
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
          if (m.error) w?.rej(new Error(m.error))
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

export function notify(title: string, body: string, tab: string, onClick: () => void) {
  if (bridge) return bridge.notify(title, body, tab)
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') Notification.requestPermission()
  if (Notification.permission === 'granted') new Notification(title, { body }).onclick = onClick
}
