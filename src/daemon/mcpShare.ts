// #5: an MCP server marked One process for every agent (McpServer.shared, a command's): Laki starts it once and every
// agent talks to it over Streamable HTTP on the daemon (POST /mcp/<name>/<tab>/<key>), instead of each agent starting its
// own copy (ten browsers, ten database connections). The daemon is the server's one MCP client: it initializes it once
// (no roots, no sampling: it may not ask the agents anything), answers each agent's initialize from that, and passes
// every other request through with an id of its own, the answer back to the agent that asked. The tab's key (an HMAC
// of its id under a key kept in <data>/mcp-share.key, 0600) comes as Authorization: Bearer (claude's 0600 config file,
// codex's environment, OpenCode's inline config: never argv): it survives a daemon restart, as the tab does, and names
// who calls. Its process gets the environment an agent's would: Hide secrets' filter when that's on. The server's process: started at the first call, again if it ended, stopped as the
// daemon stops or its command changes. ponytail: its notifications (list_changed, progress) and requests to the client
// are dropped, an agent's GET stream is refused (405, as the spec allows), one stdio pipe serves the calls in turn as
// the server answers them; it counts once in Resources as the daemon's own child, not per tab
import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { writeAtomic } from '../shared/conn.ts'
import type { McpServer } from '../shared/mcp.ts'
import { envSplit } from '../shared/env.ts'
import { log, mcpOf, state } from './core.ts'
import { dir } from './dir.ts'
import { daemonPort } from './remote.ts'

const PROTOCOL = '2025-03-26'
const CALL_MS = 10 * 60_000 // a call's answer, at most (a browser's page load, a long query)
const BODY_MAX = 4 << 20

let secret: Buffer | undefined
const keyOf = () => {
  if (secret) return secret
  const f = join(dir, 'mcp-share.key')
  try {
    if (existsSync(f)) secret = Buffer.from(readFileSync(f, 'utf8').trim(), 'hex')
  } catch {}
  if (!secret || secret.length < 32) (secret = randomBytes(32)), writeAtomic(f, secret.toString('hex'), 0o600)
  return secret
}
export const tabKey = (tab: string) => createHmac('sha256', keyOf()).update(`mcp-share:${tab}`).digest('hex').slice(0, 40)
const keyOk = (tab: string, key: string) => (a => a.length === key.length && timingSafeEqual(Buffer.from(a), Buffer.from(key)))(tabKey(tab))

// a shared server's id: its command, args and env (two projects' servers of one name are two), and the URL an agent's
// config gets for it on the daemon (none yet: the daemon isn't listening)
const sigOf = (s: McpServer) => JSON.stringify([s.command, s.args ?? [], s.env ?? {}])
const idOf = (s: McpServer) => createHash('sha256').update(sigOf(s)).digest('hex').slice(0, 16)
export const shareUrl = (s: McpServer, tab: string) => (daemonPort ? `http://127.0.0.1:${daemonPort}/mcp/${idOf(s)}/${tab}` : undefined)
// an agent tab's servers with the shared ones as URLs and its key (core's agentCmd)
export const sharedFor = (list: McpServer[], tab: string): McpServer[] => list.map(s => (s.shared && s.command && !s.url ? (u => (u ? { name: s.name, url: u, bearer: tabKey(tab), presets: s.presets } : s))(shareUrl(s, tab)) : s))

const isShared = (s: McpServer) => !!s.shared && !!s.command && !s.url
// every server marked shared now: Settings' and each project's own
const allShared = () => [...(state.settings?.mcp ?? []), ...state.projects.flatMap(p => p.config?.mcp ?? [])].filter(isShared)

type Child = { name: string; p: ChildProcess; buf: string; next: number; waits: Map<number, (m: Rpc) => void>; init: Promise<Rpc> }
type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }
const kids = new Map<string, Child>() // by idOf

function child(s: McpServer): Child {
  const id = idOf(s)
  const was = kids.get(id)
  if (was && was.p.exitCode === null && !was.p.killed) return was
  const base = state.settings?.hideSecrets ? envSplit(process.env).pass : process.env // as an agent's environment has it
  const p = spawn(s.command!, s.args ?? [], { env: { ...base, ...(s.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
  const c: Child = { name: s.name, p, buf: '', next: 1, waits: new Map(), init: Promise.resolve({}) }
  p.stdout!.setEncoding('utf8')
  p.stdout!.on('data', (d: string) => {
    c.buf += d
    for (let i; (i = c.buf.indexOf('\n')) >= 0; ) {
      const line = c.buf.slice(0, i).trim()
      c.buf = c.buf.slice(i + 1)
      if (!line) continue
      let m: Rpc
      try {
        m = JSON.parse(line)
      } catch {
        continue // a server's stray print
      }
      if (typeof m.id === 'number' && !m.method) (f => f && (c.waits.delete(m.id as number), f(m)))(c.waits.get(m.id))
      else if (m.method && m.id !== undefined) send(c, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Laki shares this server: it takes no requests from it' } }) // roots, sampling, elicitation
    }
  })
  p.stderr!.on('data', () => {}) // ponytail: its log isn't kept
  p.stdin!.on('error', () => {}) // it ended or never started: exit and error answer the calls waiting
  const gone = (why: string) => {
    for (const f of c.waits.values()) f({ error: { code: -32000, message: `the shared MCP server ${s.name} ${why}` } })
    c.waits.clear()
    if (kids.get(id) === c) kids.delete(id)
  }
  p.on('exit', code => gone(`ended (code ${code})`))
  p.on('error', e => (log(`mcp share ${s.name}: ${e.message}`), gone(`couldn't start: ${e.message}`)))
  c.init = ask(c, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'laki', version: '1' } }).then(r => (r.error ? p.kill() : send(c, { jsonrpc: '2.0', method: 'notifications/initialized' }), r)) // refused: stopped, the next call starts it again
  kids.set(id, c)
  log(`mcp share ${s.name}: started (pid ${p.pid})`)
  return c
}
const send = (c: Child, m: Rpc) => void c.p.stdin!.write(`${JSON.stringify(m)}\n`)
function ask(c: Child, method: string, params: unknown): Promise<Rpc> {
  const id = c.next++
  return new Promise(ok => {
    const t = setTimeout(() => c.waits.delete(id) && ok({ error: { code: -32001, message: `no answer in ${CALL_MS / 60000} minutes` } }), CALL_MS)
    c.waits.set(id, m => (clearTimeout(t), ok(m)))
    send(c, { jsonrpc: '2.0', id, method, params })
  })
}

// POST /mcp/<id>/<tab> with its key as Authorization: Bearer: one JSON-RPC message (or a batch) from an agent, answered
// as application/json
export async function mcpShareHttp(req: IncomingMessage, res: ServerResponse, path: string) {
  const out = (code: number, body?: unknown, head: Record<string, string> = {}) => (res.writeHead(code, { ...(body !== undefined && { 'content-type': 'application/json' }), ...head }), res.end(body === undefined ? undefined : JSON.stringify(body)))
  const m = /^\/mcp\/([0-9a-f]{16})\/([\w-]{1,40})$/.exec(path)
  const key = /^Bearer ([0-9a-f]{40})$/.exec(String(req.headers.authorization ?? ''))?.[1]
  const tab = m && key && keyOk(m[2], key) ? state.tabs.find(t => t.id === m[2]) : undefined
  if (!m || !tab) return out(404, { error: 'not found' })
  const s = mcpOf(tab).find(x => isShared(x) && idOf(x) === m[1]) // one this tab's agent is given, as it is now
  if (!s) return out(404, { error: 'no such shared MCP server for this tab (its settings changed: start the agent again)' })
  if (req.method === 'DELETE') return out(200)
  if (req.method !== 'POST') return out(405, undefined, { allow: 'POST, DELETE' })
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > BODY_MAX) return out(413, { error: 'too big' })
  }
  let msg: Rpc | Rpc[]
  try {
    msg = JSON.parse(body)
  } catch {
    return out(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } })
  }
  const c = child(s)
  const init = await c.init
  if (init.error) return out(502, { jsonrpc: '2.0', id: null, error: init.error })
  const one = async (r: Rpc): Promise<Rpc | undefined> => {
    if (r.id === undefined || r.id === null) return undefined // an agent's notification: dropped (a cancel names its own ids, another agent's to the server)
    if (r.method === 'initialize') return { jsonrpc: '2.0', id: r.id, result: init.result }
    if (r.method === 'ping') return { jsonrpc: '2.0', id: r.id, result: {} }
    const a = await ask(c, String(r.method ?? ''), r.params)
    return { jsonrpc: '2.0', id: r.id, ...(a.error ? { error: a.error } : { result: a.result }) }
  }
  const answers = (await Promise.all((Array.isArray(msg) ? msg : [msg]).map(one))).filter(Boolean)
  const head = { 'mcp-session-id': `laki-${m[2]}` }
  if (!answers.length) return out(202, undefined, head)
  return out(200, Array.isArray(msg) ? answers : answers[0], head)
}

// the shared servers' processes: stopped (the daemon's shutdown), or those no longer shared or changed (a settings save)
export function mcpShareStop(all = false) {
  const now = new Set(allShared().map(idOf))
  for (const [id, c] of kids) if (all || !now.has(id)) (c.p.kill(), kids.delete(id), log(`mcp share ${c.name}: stopped`))
}
