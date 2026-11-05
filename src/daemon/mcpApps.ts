// MCP Apps in the Reader: a claude chat's call of an MCP tool that has an app (its _meta.ui.resourceUri: a ui:// page
// of HTML, the MCP Apps extension) shows that app under the call. Laki asks the server itself, as Claude's own config
// says (the account's .claude.json: your servers and this folder's; never a repo's .mcp.json, which Claude asks you
// about first): its tools (tools/list, which ones have an app), the page (resources/read), served at
// /mcp-app/<tab>/<call>?key= with a CSP of the domains it declares; the app's own tool calls (mcpAppCall) go to that
// server once you allow each on a card (the Reader's). A connection stays 10 minutes after its last use.
// ponytail: stdio and streamable HTTP servers; one that needs a sign-in (OAuth), SSE-only servers, plugins' servers and
// ${VAR}s in a config aren't reached (the call shows as a plain tool line)
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJson } from '../shared/conn.ts'
import { type Tab } from '../shared/types.ts'
import { accountNamed } from './accounts.ts'
import { findTab, findWs, log, state } from './core.ts'
import { bumpReader, callsOf, chatRead, type McpCall } from './meters.ts'
import { urlKey, urlKeyOk } from './widgets.ts'

const VERSION = '2025-06-18'
const UI_MIME = 'text/html;profile=mcp-app'
const IDLE = 10 * 60_000
const TIMEOUT = 20_000
type Conn = { req: (method: string, params?: object) => Promise<any>; notify: (method: string, params?: object) => void; close: () => void }
type Server = { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string; headers?: Record<string, string> }

// a JSON-RPC exchange over a server's stdin and stdout, a message a line
function stdio(s: Server, cwd: string, end: () => void): Conn {
  const c = spawn(s.command!, Array.isArray(s.args) ? s.args.map(String) : [], { cwd, env: { ...process.env, ...state.settings?.env, ...s.env }, stdio: ['pipe', 'pipe', 'ignore'] })
  const waiting = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>()
  let n = 0
  let buf = ''
  let gone = false
  const write = (m: object) => c.stdin.write(`${JSON.stringify(m)}\n`)
  const fail = (e: Error) => (waiting.forEach(w => w.no(e)), waiting.clear())
  c.on('error', e => fail(new Error(`${s.command}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed' : e.message}`)))
  c.on('close', () => ((gone = true), end(), fail(new Error(`${s.command} ended`))))
  c.stdin.on('error', () => {})
  c.stdout.setEncoding('utf8').on('data', (d: string) => {
    buf += d
    if (buf.length > 32 << 20) return void (c.kill(), fail(new Error('too much from the server')))
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let m: any
      try {
        m = JSON.parse(line)
      } catch {
        continue
      }
      if (m?.method) {
        if (m.id !== undefined) write({ jsonrpc: '2.0', id: m.id, ...(m.method === 'ping' ? { result: {} } : m.method === 'roots/list' ? { result: { roots: [] } } : { error: { code: -32601, message: 'not supported' } }) }) // the server asks: nothing of yours
        continue // its ask or notice, never an answer to ours (its ids are its own)
      }
      const w = m?.id !== undefined && waiting.get(m.id)
      if (!w) continue
      waiting.delete(m.id)
      m.error ? w.no(new Error(String(m.error.message ?? 'error'))) : w.ok(m.result)
    }
  })
  return {
    req: (method, params) =>
      new Promise((ok, no) => {
        if (gone) return no(new Error(`${s.command} ended`))
        const id = ++n
        const t = setTimeout(() => (waiting.delete(id), no(new Error(`${method}: no answer`))), TIMEOUT)
        waiting.set(id, { ok: v => (clearTimeout(t), ok(v)), no: e => (clearTimeout(t), no(e)) })
        write({ jsonrpc: '2.0', id, method, ...(params && { params }) })
      }),
    notify: (method, params) => void write({ jsonrpc: '2.0', method, ...(params && { params }) }),
    close: () => c.kill(),
  }
}

// streamable HTTP: a POST each, its answer JSON or an event stream; the session's id as the server gives it
function http(s: Server): Conn {
  let session: string | undefined
  let n = 0
  const post = async (m: object) => {
    const r = await fetch(s.url!, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT), headers: { ...s.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': VERSION, ...(session && { 'mcp-session-id': session }) }, body: JSON.stringify(m) })
    if (r.status === 401 || r.status === 403) throw new Error('it needs a sign-in')
    if (!r.ok && r.status !== 202) throw new Error(`HTTP ${r.status}`)
    session = r.headers.get('mcp-session-id') ?? session
    return r
  }
  return {
    req: async (method, params) => {
      const id = ++n
      const r = await post({ jsonrpc: '2.0', id, method, ...(params && { params }) })
      const text = await r.text()
      const msgs = /event-stream/.test(r.headers.get('content-type') ?? '') ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)) : [text]
      for (const x of msgs) {
        let m: any
        try {
          m = JSON.parse(x)
        } catch {
          continue
        }
        if (m?.id !== id) continue
        if (m.error) throw new Error(String(m.error.message ?? 'error'))
        return m.result
      }
      throw new Error(`${method}: no answer`)
    },
    notify: (method, params) => void post({ jsonrpc: '2.0', method, ...(params && { params }) }).catch(() => {}),
    close: () => {},
  }
}

// a server of the tab's: by the name its tools go by (mcp__<name>__<tool>: other characters as _), from the account's
// .claude.json: this folder's own (local scope) over yours (user scope)
const norm = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_')
type Found = { key: string; server: Server; cwd: string } | undefined
function serversOf(tab: Tab): (name: string) => Found {
  const ws = findWs(tab.workspace)
  if (ws.host) return () => undefined
  const dir = accountNamed(tab.account)?.dir ?? process.env.CLAUDE_CONFIG_DIR
  const file = dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
  const cfg = readJson<{ mcpServers?: Record<string, Server>; projects?: Record<string, { mcpServers?: Record<string, Server> }> }>(file) // read once for all of a chat's calls
  const all = Object.entries({ ...cfg?.mcpServers, ...cfg?.projects?.[ws.path]?.mcpServers })
  return name => {
    const [k, server] = all.find(([k]) => norm(k) === name) ?? []
    if (!k || !server || typeof server !== 'object') return
    if (!(typeof server.command === 'string' && server.command) && !(typeof server.url === 'string' && /^https?:\/\//.test(server.url) && server.type !== 'sse')) return
    return { key: `${file}|${ws.path}|${k}`, server, cwd: ws.path }
  }
}

// each server's connection, its tools that have an app (by name: its page's uri) or why not
type Live = { conn: Promise<Conn>; used: number; apps?: Promise<Map<string, string>> }
const live = new Map<string, Live>()
const failed = new Map<string, number>() // a server that couldn't be asked: not again for AGAIN
const AGAIN = 60_000
function connect(key: string, server: Server, cwd: string): Live {
  const had = live.get(key)
  if (had) return ((had.used = Date.now()), had)
  const end = () => live.get(key) === l && (live.delete(key), seen.delete(key)) // it exited: the next use starts it again
  const conn = (async () => {
    const c = server.command ? stdio(server, cwd, end) : http(server)
    try {
      await c.req('initialize', { protocolVersion: VERSION, capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME] } } }, clientInfo: { name: 'laki', version: '1' } })
      c.notify('notifications/initialized')
      return c
    } catch (e) {
      c.close()
      throw e
    }
  })()
  const l: Live = { conn, used: Date.now() }
  live.set(key, l)
  conn.catch(() => live.delete(key))
  return l
}
setInterval(() => {
  for (const [k, l] of live) if (Date.now() - l.used > IDLE) (live.delete(k), seen.delete(k), void l.conn.then(c => c.close(), () => {})) // its tools asked again next time
}, 60_000).unref()

const uriOf = (t: any) => (x => (typeof x === 'string' && x.startsWith('ui://') ? x : undefined))(t?._meta?.ui?.resourceUri ?? t?._meta?.['ui/resourceUri'])
function appsOf(key: string, l: Live) {
  l.apps ??= l.conn
    .then(c => c.req('tools/list'))
    .then(r => new Map<string, string>((Array.isArray(r?.tools) ? r.tools : []).flatMap((t: any) => (uriOf(t) && typeof t.name === 'string' ? [[t.name, uriOf(t)!]] : []))))
  l.apps.catch(e => (failed.set(key, Date.now()), live.delete(key), log(`mcp app: ${key.split('|').at(-1)}: ${(e as Error).message}`)))
  return l.apps
}

// what the Reader draws: the tab's MCP calls whose tool has an app (known: a server's list is asked once, and the
// chat read again as it comes); each with its page's address, what it was called with and its result
export type AppView = { id: string; at: number; server: string; tool: string; src: string; input: unknown; result?: unknown; error?: boolean }
const seen = new Map<string, Map<string, string> | null>() // server key → its tools with an app (null: being asked); kept while its connection is
const on = (tab?: Tab) => tab?.preset === 'claude' && state.settings?.mcpApps !== false
export function appsFor(tab: Tab): AppView[] {
  const calls = on(tab) ? callsOf(tab.id) : []
  if (!calls.length) return []
  const serverOf = serversOf(tab)
  const out: AppView[] = []
  for (const c of calls) {
    const s = serverOf(c.server)
    if (!s) continue
    const apps = seen.get(s.key)
    if (apps === undefined && Date.now() - (failed.get(s.key) ?? 0) > AGAIN) {
      seen.set(s.key, null)
      void appsOf(s.key, connect(s.key, s.server, s.cwd)).then(
        m => (seen.set(s.key, m), m.size && bumpReader(tab.id)),
        () => seen.delete(s.key),
      )
    }
    if (!apps?.has(c.tool) || c.result === undefined) continue
    out.push({ id: c.id, at: c.at, server: c.server, tool: c.tool, src: `/mcp-app/${tab.id}/${c.id}?key=${urlKey(`mcp:${tab.id}/${c.id}`)}`, input: c.input, result: c.result, ...(c.error && { error: true }) })
  }
  return out
}

// the Reader's chat read (meters.ts chatRead) with its MCP Apps, each by the said line it's in (of those sent)
export function chatWithApps(p: { tab: string; v?: number }) {
  const r = chatRead(p)
  if (!r.said) return r
  const apps = appsFor(findTab(p.tab))
    .map(x => ({ ...x, at: x.at - (r.from ?? 0) }))
    .filter(x => x.at >= 0)
  return apps.length ? { ...r, apps } : r
}

// the page: the server's ui:// resource, HTML, with a CSP of what its _meta.ui.csp declares (https origins only)
export async function mcpPage(path: string, q: URLSearchParams): Promise<{ code: number; headers: Record<string, string>; body: string }> {
  const bad = (code: number, body: string) => ({ code, headers: { 'content-type': 'text/plain' }, body })
  const m = /^\/mcp-app\/([\w-]+)\/([\w-]+)$/.exec(path)
  if (!m || !urlKeyOk(q.get('key'), `mcp:${m[1]}/${m[2]}`)) return bad(401, 'bad key')
  const tab = state.tabs.find(t => t.id === m[1])
  const c = on(tab) ? callsOf(tab!.id).find(x => x.id === m[2]) : undefined
  const s = c && serversOf(tab!)(c.server)
  if (!c || !s) return bad(404, 'no such app')
  try {
    const l = connect(s.key, s.server, s.cwd)
    const uri = (await appsOf(s.key, l)).get(c.tool)
    if (!uri) return bad(404, 'no app for that tool')
    const r = await (await l.conn).req('resources/read', { uri })
    const x = (Array.isArray(r?.contents) ? r.contents : []).find((y: any) => typeof y?.text === 'string' || typeof y?.blob === 'string')
    if (!x) return bad(404, 'the server sent no page')
    const html = typeof x.text === 'string' ? x.text : Buffer.from(x.blob, 'base64').toString('utf8')
    const csp = x._meta?.ui?.csp ?? {}
    const doms = (v: unknown) => (Array.isArray(v) ? v : []).filter((d): d is string => typeof d === 'string' && /^https:\/\/[\w.-]+(:\d+)?$/.test(d)).join(' ')
    const res = doms(csp.resourceDomains)
    return {
      code: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${res}; style-src 'unsafe-inline' ${res}; img-src data: ${res}; font-src data: ${res}; media-src data: ${res}; connect-src ${doms(csp.connectDomains) || "'none'"}`.replace(/ +;/g, ';'),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
      body: html,
    }
  } catch (e) {
    return bad(502, `the server: ${(e as Error).message}`)
  }
}

// an app's tool call, once you allowed it (the Reader asks): to the server its own tool is on, nowhere else
export async function mcpAppCall(p: { tab: string; id: string; name: string; arguments?: unknown }) {
  const tab = state.tabs.find(t => t.id === p.tab)
  const c = on(tab) ? callsOf(tab!.id).find(x => x.id === p.id) : undefined
  const s = c && serversOf(tab!)(c.server)
  if (!c || !s) throw new Error('no such app')
  if (typeof p.name !== 'string' || !p.name) throw new Error('which tool?')
  return (await connect(s.key, s.server, s.cwd).conn).req('tools/call', { name: p.name, arguments: p.arguments && typeof p.arguments === 'object' ? p.arguments : {} })
}
export type { McpCall }
