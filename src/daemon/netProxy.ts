// The wrapper sandbox's network (a wrapped profile's net: list, shared/wrap.ts): sandbox-exec lets the agent reach this
// Mac only, and its HTTPS_PROXY / HTTP_PROXY is this: an HTTP proxy on 127.0.0.1, one per daemon, that lets a tab
// CONNECT (or fetch plain http) only to the hosts on its list, each tab by a user:pass of its own in the proxy URL (one
// tab can't use another's list). The port and the passwords are kept in a 0600 file, so a terminal the pty host kept
// across a daemon restart goes on with its URL. Stdlib only, no Laki import: test/net-proxy.test.ts runs it alone.
// ponytail: the URL is in the agent's environment, which another process of yours can read (as LAKI_HOOK is)
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'

// list: a tab's hosts now (undefined: no such tab, or not one on a list); refused: a host it asked for that isn't
export type ProxyHooks = { list: (tab: string) => string[] | undefined; refused: (tab: string, host: string) => void }
let server: Server | undefined
let file = ''
let hooks: ProxyHooks = { list: () => undefined, refused: () => {} }
const pass = new Map<string, string>()

// a host on a list: the name itself, or a subdomain of a *. one (claude's wildcard); any case, a trailing dot
export function hostOn(host: string, list: readonly string[]) {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  return !!h && list.some(x => (x.startsWith('*.') ? h.endsWith(x.slice(1).toLowerCase()) : h === x.toLowerCase()))
}
// the tab a request's Proxy-Authorization names, with that tab's own password, and its list; else none
function whoOf(req: IncomingMessage) {
  const m = /^Basic\s+([\w+/=]+)$/i.exec(req.headers['proxy-authorization'] ?? '')
  const said = m ? Buffer.from(m[1], 'base64').toString() : ''
  const i = said.indexOf(':')
  const tab = said.slice(0, i)
  const want = i > 0 ? pass.get(tab) : undefined
  const pw = Buffer.from(said.slice(i + 1))
  if (!want || pw.length !== want.length || !timingSafeEqual(pw, Buffer.from(want))) return
  const list = hooks.list(tab)
  return list && { tab, list }
}
const AUTH = 'proxy-authenticate: Basic realm="laki"\r\n'
const no = (s: Socket, code: number, what: string, extra = '') => s.end(`HTTP/1.1 ${code} ${what}\r\n${extra}content-length: 0\r\nconnection: close\r\n\r\n`)
const why = (host: string) => `Laki's wrapper sandbox: ${host} isn't on this profile's list (its card: Allow this domain in this project)`

function onConnect(req: IncomingMessage, sock: Socket, head: Buffer) {
  sock.on('error', () => sock.destroy())
  const who = whoOf(req)
  if (!who) return no(sock, 407, 'Proxy Authentication Required', AUTH)
  const at = /^(\[[0-9a-f:.]+\]|[^:[\]\s]+):(\d{1,5})$/i.exec(req.url ?? '')
  if (!at) return no(sock, 400, 'Bad Request')
  // a port net.connect takes (0 or past 65535 throws in this listener: the agent never answered, the daemon's trouble)
  // ponytail: any port of a listed host: a list is hosts only (claude's allowedDomains, NET_HOST), host:port if one matters
  const port = Number(at[2])
  if (!(port >= 1 && port <= 65535)) return no(sock, 400, 'Bad Request')
  const host = at[1].replace(/^\[|\]$/g, '')
  if (!hostOn(host, who.list)) return hooks.refused(who.tab, host), no(sock, 403, 'Forbidden', `x-laki: ${why(host)}\r\n`)
  let open = false
  let up: Socket
  try {
    up = connect(port, host, () => {
      open = true
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) up.write(head)
      up.pipe(sock)
      sock.pipe(up)
    })
  } catch {
    return no(sock, 502, 'Bad Gateway') // any other throw of connect's (a host it won't take) answered here, not uncaught; no upstream to end
  }
  up.on('error', () => (open ? sock.destroy() : no(sock, 502, 'Bad Gateway')))
  sock.on('close', () => up.destroy())
}
function onRequest(req: IncomingMessage, res: ServerResponse) {
  const who = whoOf(req)
  if (!who) return void res.writeHead(407, { 'proxy-authenticate': 'Basic realm="laki"' }).end()
  const u = URL.canParse(req.url ?? '') ? new URL(req.url!) : undefined
  if (u?.protocol !== 'http:') return void res.writeHead(400).end('a proxy request: http://host/path, or CONNECT for https')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!hostOn(host, who.list)) return hooks.refused(who.tab, host), void res.writeHead(403).end(why(host))
  const { 'proxy-authorization': _a, 'proxy-connection': _c, ...headers } = req.headers
  const up = request(u, { method: req.method, headers }, r => (res.writeHead(r.statusCode ?? 502, r.headers), r.pipe(res)))
  up.on('error', () => (res.headersSent ? res.destroy() : res.writeHead(502).end()))
  res.on('close', () => up.destroy()) // the agent gone (or done): nothing more pulled from the host
  req.pipe(up)
}

const keep = () => {
  try {
    writeFileSync(file, JSON.stringify({ port: (server?.address() as AddressInfo | null)?.port, tabs: Object.fromEntries(pass) }), { mode: 0o600 })
  } catch {}
}
// at the daemon's start, before tabs start again: the port it had (a kept terminal's URL), else a new one
export async function proxyUp(at: string, h: ProxyHooks) {
  file = at
  hooks = h
  let kept: { port?: unknown; tabs?: Record<string, unknown> } = {}
  try {
    kept = JSON.parse(readFileSync(at, 'utf8'))
  } catch {}
  for (const [t, p] of Object.entries(kept.tabs ?? {})) if (typeof p === 'string' && h.list(t)) pass.set(t, p)
  const s = createServer(onRequest).on('connect', onConnect)
  const listen = (port: number) => new Promise<void>((ok, fail) => s.once('error', fail).listen(port, '127.0.0.1', () => (s.off('error', fail), ok())))
  const port = Number(kept.port)
  await (Number.isInteger(port) && port > 1024 && port < 65536 ? listen(port).catch(() => listen(0)) : listen(0))
  server = s
  keep()
}
// a wrapped tab's proxy URL as it starts: a new password each start
export function proxyFor(tab: string): string {
  if (!server) throw new Error("the wrapper sandbox's network proxy isn't running")
  if (!/^[\w-]+$/.test(tab)) throw new Error(`not a tab's id: ${tab}`)
  const pw = randomBytes(18).toString('hex')
  pass.set(tab, pw)
  keep()
  return `http://${tab}:${pw}@127.0.0.1:${(server.address() as AddressInfo).port}`
}
export function proxyDrop(tab: string) {
  if (pass.delete(tab)) keep()
}
export const proxyDown = () => new Promise<void>(ok => (server ? (server.closeAllConnections(), server.close(() => ok()), (server = undefined)) : ok()))
