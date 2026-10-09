// A Browsers workspace's page, in the main area instead of terminals: any website in a <webview> of its own session
// (main's persist:browser: sign-ins kept between runs, few permissions, a popup opens here), with back, forward,
// reload and an address bar (text.ts browserUrl: a site, or a search). The page it's on and its title go to the
// workspace (onPage: wsSet's browser and name), so the sidebar names it and a restart opens it again. A right click
// is main's pageMenu (link, image, text, back, forward, reload, Inspect Element); the code button opens DevTools.
// ponytail: ⌘ keys don't reach the app while the page has the focus (the guest gets them), as in the preview; only
// ⌘W and ⌘T do (main's before-input-event sends them as browser-key: App's keys, as if typed there)
import { useEffect, useRef, useState } from 'react'
import { bridge } from './api'
import { browserUrl } from './text'
import { IconButton } from './ui'

const shown = (u: string) => (u === 'about:blank' ? '' : u)

export function BrowserPane({ url, hidden, onPage, onOpen }: { url: string; hidden: boolean; onPage: (url: string, title: string) => void; onOpen: (url: string) => void }) {
  const [addr, setAddr] = useState(shown(url))
  const [err, setErr] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<any>(null) // the webview element
  const input = useRef<HTMLInputElement>(null)
  const page = useRef(onPage)
  page.current = onPage
  // its methods throw until it's attached and ready
  const on = (f: (v: any) => unknown) => {
    try {
      return view.current && f(view.current)
    } catch {}
  }
  useEffect(() => {
    if (!bridge || !host.current) return
    const v = document.createElement('webview') as any
    v.setAttribute('src', url || 'about:blank')
    v.setAttribute('partition', 'persist:browser')
    v.setAttribute('allowpopups', '') // main opens a popup's page here
    v.className = 'web-view'
    let title = ''
    const at = (e: any) => {
      setErr('')
      setAddr(shown(e.url))
      if (/^https?:\/\//.test(e.url)) page.current(e.url, title)
    }
    v.addEventListener('did-navigate', (e: any) => ((title = ''), at(e))) // a new page: its title comes after (page-title-updated)
    v.addEventListener('did-navigate-in-page', (e: any) => e.isMainFrame && at(e))
    v.addEventListener('page-title-updated', (e: any) => {
      title = e.title
      const u = on(x => x.getURL()) as string | undefined
      if (u && /^https?:\/\//.test(u)) page.current(u, title)
    })
    v.addEventListener('did-fail-load', (e: any) => e.isMainFrame && e.errorCode !== -3 && setErr(e.errorDescription || 'It didn’t load'))
    host.current.appendChild(v)
    view.current = v
    if (!url || url === 'about:blank') setTimeout(() => input.current?.focus(), 50) // a new one: type where to
    return () => {
      v.remove()
      view.current = null
    }
  }, [])
  const go = () => {
    const u = browserUrl(addr)
    if (!u) return
    setErr('')
    if (on(v => v.loadURL(u).catch(() => {})) === undefined) view.current?.setAttribute('src', u) // a failure comes as did-fail-load
  }
  return (
    <div className={`browser-pane ${hidden ? 'hidden' : ''}`}>
      <div className="sp-tools web-tools">
        <IconButton icon="back" title="Back" onClick={() => on(v => v.goBack())} />
        <IconButton icon="forward" title="Forward" onClick={() => on(v => v.goForward())} />
        <IconButton icon="refresh" title="Reload" onClick={() => (setErr(''), on(v => v.reload()))} />
        <input ref={input} value={addr} spellCheck={false} placeholder="Search, or type an address" onChange={e => setAddr(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} onFocus={e => e.target.select()} />
        <IconButton icon="link" title="Open in your browser" onClick={() => addr && onOpen(browserUrl(addr))} />
        {bridge && <IconButton icon="code" title="Developer tools (or right click › Inspect Element)" onClick={() => on(v => (v.isDevToolsOpened() ? v.closeDevTools() : v.openDevTools()))} />}
      </div>
      {err && <div className="warn small pad">{err}</div>}
      {!bridge && <div className="muted small pad">The browser runs in the app. <button className="small" onClick={() => addr && onOpen(browserUrl(addr))}>Open it in this browser</button></div>}
      <div className="web-body" ref={host} />
    </div>
  )
}
