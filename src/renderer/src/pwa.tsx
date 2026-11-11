// M4: remote access's page as an app on a phone (docs/dev/remote.md): only the page remote access serves (https, no app
// bridge). The daemon answers its manifest only at a stable address (Tailscale, My domain): there it registers the
// service worker and offers Add to Home Screen; at a quick tunnel's it says why not. Installed, Notifications turns on
// Web Push for this device (POST /push: its cookie says which)
import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconButton } from './ui'

const far = typeof window !== 'undefined' && location.protocol === 'https:' && !(window as { bridge?: unknown }).bridge
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
let stable: boolean | undefined // the manifest answered
let offer: { prompt: () => Promise<unknown> } | undefined // Android's beforeinstallprompt, kept for Install
const subs = new Set<() => void>()
const tell = () => subs.forEach(f => f())
let seq = 0 // what useSyncExternalStore compares
const store = { on: (f: () => void) => (subs.add(f), () => void subs.delete(f)), now: () => seq }

export async function pwaStart() {
  if (!far) return
  stable = !!(await fetch('/manifest.webmanifest', { cache: 'no-store' }).catch(() => null))?.ok
  // an app's tags only at a stable address: iOS makes a Home Screen app of any page with apple-mobile-web-app-capable
  const add = (tag: string, attrs: Record<string, string>) => document.head.append(Object.assign(document.createElement(tag), attrs))
  if (stable) {
    add('link', { rel: 'manifest', href: '/manifest.webmanifest' })
    add('link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' })
    add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' })
    add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' })
    add('meta', { name: 'theme-color', content: '#171412' })
    window.addEventListener('beforeinstallprompt', e => (e.preventDefault(), (offer = e as unknown as typeof offer), seq++, tell()))
    if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
  seq++
  tell()
}

const push = (o: object) =>
  fetch('/push', { method: 'POST', body: JSON.stringify(o), credentials: 'same-origin' }).then(async r => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw new Error(j.error ?? `the Mac answered ${r.status}`)
    return j as { key?: string }
  })
async function notifyOn() {
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) throw new Error('this browser has no web notifications: add Laki to the Home Screen first')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error("notifications are off for Laki in this phone's settings")
  const reg = await navigator.serviceWorker.ready
  const { key = '' } = await push({})
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
  await told(s).catch(async e => (await s.unsubscribe().catch(() => {}), Promise.reject(e))) // the Mac said no: not left on as if it took it
}
// this device's subscription to the Mac: again at each start too, as a device paired anew (or one whose subscription
// the Mac dropped) has none there while the browser still does
const told = (s: PushSubscription) => (j => push({ sub: { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth } }))(s.toJSON())
const hid = (k: string) => {
  try {
    return localStorage.getItem(`laki.pwa.${k}`) === '1'
  } catch {
    return false
  }
}

// the bar at the sidebar's foot, the remote page only: Add to Home Screen (stable), why not (a quick tunnel), or,
// installed, Notifications. × hides each for good on this phone
export function PwaBar() {
  useSyncExternalStore(store.on, store.now)
  const [said, setSaid] = useState('')
  const [, redraw] = useState(0)
  const [on, setOn] = useState(false)
  useEffect(() => void (far && installed() && navigator.serviceWorker?.ready.then(r => r.pushManager.getSubscription()).then(s => s && told(s).then(() => setOn(true))).catch(() => {})), [])
  if (!far || stable === undefined) return null
  const kind = installed() ? (on || !('Notification' in window) ? '' : 'notify') : stable ? 'install' : 'unstable'
  if (!kind || hid(kind)) return null
  const off = () => {
    try {
      localStorage.setItem(`laki.pwa.${kind}`, '1')
    } catch {}
    redraw(n => n + 1)
  }
  const ios = /iPhone|iPad/.test(navigator.userAgent)
  return (
    <div className="timer-bar pwa-bar">
      <span className="timer-what">
        {kind === 'unstable'
          ? 'Add to Home Screen works with a stable address (Tailscale or My domain in Settings › Remote access on your Mac)'
          : kind === 'install'
            ? offer
              ? 'Laki as an app on this phone'
              : `Add Laki to your Home Screen: ${ios ? 'Share › Add to Home Screen' : "the browser's menu › Add to Home Screen"}`
            : said || 'Notifications when an agent needs you, with its choices'}
      </span>
      {kind === 'install' && offer && (
        <button type="button" className="btn small" onClick={() => void offer!.prompt().then(() => ((offer = undefined), seq++, tell()))}>
          Install
        </button>
      )}
      {kind === 'notify' && (
        <button type="button" className="btn small" onClick={() => (setSaid('Turning on…'), notifyOn().then(() => (setOn(true), setSaid('')), e => setSaid((e as Error).message)))}>
          Turn on
        </button>
      )}
      <IconButton icon="x" title="Hide it on this phone" onClick={off} />
    </div>
  )
}
