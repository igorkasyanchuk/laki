// "Expose to the world": a listening port published by cloudflared at a trycloudflare.com URL (Cloudflare Quick
// Tunnels): public, or only for some email addresses and whole domains (--allowed-mail; visitors sign in with a
// one-time code); or, with a named tunnel set in Settings › Tunnels, at a permanent hostname of yours. The daemon runs
// cloudflared (and starts it again when it drops); this is the status bar's button and its popup with a QR code.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { qr, qrPath } from './qr'
import { MAIL_OK, parseMails, webmail } from './text'
import { Icon, IconButton } from './ui'

export type Tunnel = { port: number; url?: string; mails?: string[]; until?: number; host?: string; down?: string } // no url yet: starting; until: when it stops; host: a permanent one's; down: why it's reconnecting
// version: missing when cloudflared isn't installed; mails: who the last tunnel let in (or git's user.email);
// expose: the project's default (Settings › the project, or .laki.json): only those, every time the popup opens
// named: the permanent tunnels' (Settings › Tunnels), when set
export type Cloudflared = { version?: string; mails?: string[]; expose?: string; named?: { name: string; domain: string } }
// name: the workspace's, a permanent address's first word; settings: Settings › Tunnels
export type TunnelApi = {
  check: () => Promise<Cloudflared>
  start: (port: number, mails: string[], hours: number, host?: string) => Promise<unknown>
  name?: string
  settings?: () => void
  stop: (port: number) => Promise<unknown>
  open: (url: string) => void
  copy: (text: string) => void
}

// a link to open on a phone; label: what screen readers say (the default: the text)
export function QR({ text, label = text }: { text: string; label?: string }) {
  const m = useMemo(() => qr(text), [text]) // its popup or page re-renders on every state push
  return (
    <svg className="tunnel-qr" viewBox={`0 0 ${m.length + 8} ${m.length + 8}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${label}`}>
      <rect width="100%" height="100%" fill="#fff" />
      <path d={qrPath(m)} fill="#000" />
    </svg>
  )
}

export const RELEASES = 'https://github.com/cloudflare/cloudflared/releases'

// the ports to list: the listening ones, and any with a tunnel (it stays visible after its server stops)
export const portsOf = (listening: number[] = [], tunnels: Tunnel[] = []) => [...new Set([...listening, ...tunnels.map(t => t.port)])].sort((a, b) => a - b)

export function TunnelButton({ port, tunnel, api }: { port: number; tunnel?: Tunnel; api: TunnelApi }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  const up = !!tunnel?.url && !tunnel.down
  const tip = up ? `exposed at ${tunnel!.url}${tunnel!.host ? ' (permanent)' : ''}` : tunnel?.down ? `reconnecting: ${tunnel.down}` : tunnel ? 'starting the tunnel…' : `expose localhost:${port} to the world`
  return (
    <>
      <button className={`tunnel-btn ${tunnel ? (up ? 'on' : 'starting') : ''}`} data-tip={tip} aria-label={tip} onClick={e => setAt(e.currentTarget.getBoundingClientRect())}>
        <Icon name="globe" size={12} />
      </button>
      {at && <TunnelPop anchor={at} port={port} tunnel={tunnel} api={api} onClose={() => setAt(null)} />}
    </>
  )
}

function TunnelPop({ anchor, port, tunnel, api, onClose }: { anchor: DOMRect; port: number; tunnel?: Tunnel; api: TunnelApi; onClose: () => void }) {
  const [cf, setCf] = useState<Cloudflared | null | 'failed'>(null)
  const [mails, setMails] = useState<string | null>(null) // null: not typed in yet
  const [only, setOnly] = useState(false) // only some emails; else anyone with the link
  const [hours, setHours] = useState(8)
  const [perm, setPerm] = useState(false) // a permanent address (settings.tunnel's named tunnel) instead of a random one
  const [label, setLabel] = useState(() => `${(api.name ?? 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'app'}-${port}`)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const check = () => {
    setCf(null)
    setErr('')
    api.check().then(
      c => (setCf(c), setOnly(!!c.expose), setMails(null)),
      e => (setCf('failed'), setErr(String((e as Error).message ?? e))),
    )
  }
  useEffect(check, [])
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), onClose())
    window.addEventListener('keydown', f, true) // before the terminal under it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])
  // above the status bar, kept inside the window
  useLayoutEffect(() => {
    const el = box.current!
    el.style.left = `${Math.max(8, Math.min(anchor.left - 16, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.bottom = `${window.innerHeight - anchor.top + 6}px`
  })
  const defaults = cf && cf !== 'failed' ? cf.expose || cf.mails?.join(', ') : undefined
  const list = only ? parseMails(mails ?? defaults ?? '') : []
  const bad = list.filter(m => !MAIL_OK.test(m))
  const open = list.map(webmail).filter(Boolean) // *@gmail.com: anyone can get one
  const start = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    await (perm ? api.start(port, [], 0, label) : api.start(port, list, hours)).catch(e => setErr(String((e as Error).message ?? e)))
    setBusy(false)
  }
  const stop = () => api.stop(port).catch(e => setErr(String((e as Error).message ?? e)))
  const code = (text: string) => (
    <div className="tunnel-code">
      <code>{text}</code>
      <IconButton icon="copy" title="Copy" onClick={() => api.copy(text)} />
    </div>
  )
  const named = cf && cf !== 'failed' ? cf.named : undefined
  const labelOk = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  let body
  if (tunnel?.url && !tunnel.down) {
    body = (
      <>
        <QR text={tunnel.url} />
        <div className="tunnel-code">
          <code>{tunnel.url}</code>
          <IconButton icon="copy" title="Copy the link" onClick={() => api.copy(tunnel.url!)} />
          <IconButton icon="link" title="Open" onClick={() => api.open(tunnel.url!)} />
        </div>
        {tunnel.host ? (
          <p className="muted small">
            Permanent: it keeps this address, comes back after Laki restarts and runs until you stop it or the workspace goes. Anyone with the address can open it
            unless you protect it with Cloudflare Access (your dashboard › Zero Trust › Access). Stop takes it off your tunnel; its DNS record stays.
          </p>
        ) : (
          <p className="muted small">
            {tunnel.mails?.length ? `Only ${tunnel.mails.join(', ')}: Cloudflare emails each visitor a one-time code.` : 'Public: anyone with the link can open it.'}{' '}
            {tunnel.until ? `It ends in ${timeLeft(tunnel.until)}, or when you stop it or the workspace goes` : 'It runs until you stop it or the workspace goes'}, with the app closed
            too. If cloudflared drops, Laki starts it again, and after a restart: a random address is new each time.
          </p>
        )}
        <div className="buttons">
          <span className="grow" />
          <button className="danger" onClick={stop}>
            Stop
          </button>
        </div>
      </>
    )
  } else if (tunnel) {
    body = (
      <>
        {tunnel.down ? (
          <p className="muted">
            Reconnecting: {tunnel.down}. Laki starts cloudflared again in a moment{tunnel.host ? `, at ${tunnel.host} as before` : ': a random address comes back new'}.
          </p>
        ) : (
          <p className="muted">Starting the tunnel… it takes a few seconds.</p>
        )}
        <div className="buttons">
          <span className="grow" />
          <button onClick={stop}>{tunnel.down ? 'Stop' : 'Cancel'}</button>
        </div>
      </>
    )
  } else if (!cf) body = <p className="muted">Looking for cloudflared…</p>
  else if (cf === 'failed')
    // e.g. "unknown method": a daemon older than the app, still running (a bar at the top offers a restart)
    body = <p className="muted">Laki's daemon didn't answer. If a yellow bar at the top says to restart it, do (agents resume).</p>
  else if (!cf.version)
    body = (
      <>
        <p>
          This needs <b>cloudflared</b>, Cloudflare's tunnel client. It publishes the port at a random trycloudflare.com address; no Cloudflare account
          needed. Install it with Homebrew:
        </p>
        {code('brew install cloudflared')}
        <p className="muted small">
          No Homebrew?{' '}
          <a href={RELEASES} onClick={e => (e.preventDefault(), api.open(RELEASES))}>
            Download it from GitHub
          </a>{' '}
          and put it on your PATH. Limiting who can open a tunnel needs version 2026.9.3 or newer.
        </p>
        <div className="buttons">
          <span className="grow" />
          <button className="primary" onClick={check}>
            Check again
          </button>
        </div>
      </>
    )
  else
    body = (
      <form
        className="form"
        onSubmit={e => {
          e.preventDefault()
          start()
        }}
      >
        {named && (
          <div className="tunnel-radios" role="radiogroup" aria-label="Address">
            <span className="muted">Address</span>
            <label className="check">
              <input type="radio" name="kind" checked={!perm} onChange={() => setPerm(false)} /> A random one, for a while
            </label>
            <label className="check">
              <input type="radio" name="kind" checked={perm} onChange={() => setPerm(true)} /> Permanent, on {named.domain}
            </label>
          </div>
        )}
        {named && perm ? (
          <>
            <label className="tunnel-host">
              <span className="muted">https://</span>
              <input autoFocus value={label} spellCheck={false} aria-label="Its name" onChange={e => setLabel(e.target.value.toLowerCase().trim())} />
              <span className="muted">.{named.domain}</span>
            </label>
            {!labelOk && <p className="warn small">One word: letters, digits and dashes (Cloudflare's free certificate covers name.{named.domain}, no deeper).</p>}
            <p className="muted small">
              Through your tunnel <b>{named.name}</b>, with a DNS record Laki makes once (never over one that's there). It keeps its address, comes back after
              Laki restarts and runs until you stop it. Anyone can open it, and certificate logs make such names easy to find: protect it with Cloudflare Access
              in your dashboard when it shouldn't be open.
            </p>
          </>
        ) : (
          <>
            <div className="tunnel-radios" role="radiogroup" aria-label="Who can open it">
              <span className="muted">Who can open it</span>
              <label className="check">
                <input type="radio" name="who" checked={!only} onChange={() => setOnly(false)} /> Anyone with the link
              </label>
              <label className="check">
                <input type="radio" name="who" checked={only} onChange={() => setOnly(true)} /> Only these emails
              </label>
            </div>
            {only && <input autoFocus value={mails ?? defaults ?? ''} placeholder="you@example.com, *@yourcompany.com" onChange={e => setMails(e.target.value)} />}
            {only && list.length > 0 && (
              <div className="tunnel-who">
                {list.map(m => (
                  <span key={m} className={`chip ${bad.includes(m) || webmail(m) ? 'bad' : ''}`} data-tip={bad.includes(m) ? 'Not an address or *@domain' : webmail(m) ? `Anyone can get a ${webmail(m)} address` : undefined}>
                    {m.startsWith('*@') ? (
                      <>
                        anyone <b>{m.slice(1)}</b>
                      </>
                    ) : (
                      m
                    )}
                  </span>
                ))}
              </div>
            )}
            {only && open.length > 0 && <p className="warn small">Everyone with {open.map(d => `a ${d}`).join(' or ')} address can open it: name people, or your company's domain.</p>}
            <p className="muted small">
              {only ? (
                <>
                  {cf.expose && 'The project’s default. '}A whole domain: <code>*@yourcompany.com</code> (or just <code>yourcompany.com</code>). Cloudflare emails each
                  visitor a one-time code.
                </>
              ) : (
                "No sign-in: anyone who gets the link can open it, and what the server trusts from localhost too (Vite's /@fs files, a debug console)."
              )}
            </p>
            <div className="tunnel-radios" role="radiogroup" aria-label="For how long">
              <span className="muted">For how long</span>
              {SHARE_FOR.map(([h, label]) => (
                <label key={h} className="check">
                  <input type="radio" name="for" checked={hours === h} onChange={() => setHours(h)} /> {label}
                </label>
              ))}
            </div>
            {!named && api.settings && (
              <p className="muted small">
                An address that stays, on your own domain:{' '}
                <a href="#" onClick={e => (e.preventDefault(), onClose(), api.settings!())}>
                  Settings › Tunnels
                </a>
              </p>
            )}
          </>
        )}
        <div className="buttons">
          <span className="muted small">cloudflared {cf.version}</span>
          <span className="grow" />
          {named && perm ? (
            <button type="submit" className="primary danger" disabled={busy || !labelOk}>
              {busy ? 'Starting…' : 'Expose permanently'}
            </button>
          ) : (
            <button type="submit" className={only ? 'primary' : 'primary danger'} disabled={busy || (only && (!list.length || bad.length > 0))}>
              {busy ? 'Starting…' : only ? 'Expose' : 'Expose publicly'}
            </button>
          )}
        </div>
      </form>
    )
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="tunnel-pop" ref={box} role="dialog" aria-label="Expose to the world">
        <div className="tunnel-head">
          <Icon name="globe" />
          <b>Expose localhost:{port} to the world</b>
          <span className="grow" />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        {body}
        {err && <div className="tunnel-err">{err}</div>}
      </div>
    </div>
  )
}

// Share a tab (a tab's right click): for how long, then its link with a QR code for a phone, Copy, Open and Stop
export type ShareApi = { start: (hours: number) => Promise<unknown>; stop: () => Promise<unknown>; open: (url: string) => void; copy: (text: string) => void }
const SHARE_FOR: [number, string][] = [[1, '1 hour'], [8, '8 hours'], [24, '24 hours'], [0, 'Until I stop it']]
export const timeLeft = (until: number, now = Date.now()) => {
  const m = Math.max(1, Math.round((until - now) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}
export function SharePop({ name, share, api, onClose }: { name: string; share?: { url: string; until?: number }; api: ShareApi; onClose: () => void }) {
  const [hours, setHours] = useState(8)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), onClose())
    window.addEventListener('keydown', f, true) // before the terminal under it
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])
  const fail = (e: unknown) => setErr(String((e as Error).message ?? e))
  const start = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    await api.start(hours).catch(fail)
    setBusy(false)
  }
  let body
  if (share)
    body = (
      <>
        <QR text={share.url} />
        <div className="tunnel-code">
          <code>{share.url}</code>
          <IconButton icon="copy" title="Copy the link" onClick={() => api.copy(share.url)} />
          <IconButton icon="link" title="Open" onClick={() => api.open(share.url)} />
        </div>
        <p className="muted small">
          Anyone with the link reads {name} as it goes on (its chat, or its terminal&rsquo;s text), and can copy or download it as Markdown. Nobody can type in it.{' '}
          {share.until ? `It ends in ${timeLeft(share.until)}.` : 'It runs until you stop it, close the tab or stop Laki.'}
        </p>
        <div className="buttons">
          <span className="grow" />
          <button className="danger" onClick={() => void api.stop().then(onClose, fail)}>
            Stop sharing
          </button>
        </div>
      </>
    )
  else
    body = (
      <form className="form" onSubmit={e => (e.preventDefault(), void start())}>
        <div className="tunnel-radios" role="radiogroup" aria-label="For how long">
          <span className="muted">For how long</span>
          {SHARE_FOR.map(([h, label]) => (
            <label key={h} className="check">
              <input type="radio" name="for" checked={hours === h} onChange={() => setHours(h)} /> {label}
            </label>
          ))}
        </div>
        <p className="muted small">A view-only page of {name} at a random trycloudflare.com link: anyone who gets it watches it live, and can't type into it. Commands and their output are shared as they are; Laki masks what looks like a token or a key, not every secret. Needs cloudflared (brew install cloudflared).</p>
        <div className="buttons">
          <span className="grow" />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Starting…' : 'Share'}
          </button>
        </div>
      </form>
    )
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="tunnel-pop share-pop" role="dialog" aria-label={`Share ${name}`}>
        <div className="tunnel-head">
          <Icon name="globe" />
          <b>Share a live view of {name}</b>
          <span className="grow" />
          <IconButton icon="x" title="Close (Esc)" onClick={onClose} />
        </div>
        {body}
        {err && <div className="tunnel-err">{err}</div>}
      </div>
    </div>
  )
}
