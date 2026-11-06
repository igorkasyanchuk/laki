// Events from outside Laki (workflows' and extensions' on:): issue.labeled, read from each GitHub project's issue
// events, and webhook, a POST to a small server of its own. Both carry outsiders' text (an issue's body, a request's):
// it reaches a prompt only through a workflow's {{event.*}}, and a run they start is refused what an agent's event is
// (workflow.ts fromEvent's agent: commands, webhooks, bypass permissions). No core state of its own but each project's
// issueMark and settings.inHooks; the secrets in <data>/hooks, 0600.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { InHook, Project } from '../shared/types.ts'
import * as cs from './codespace.ts'
import { changed, findProject, firstLine, ghCount, git, log, onGitHub, run, save, state } from './core.ts'
import { dir } from './dir.ts'
import { quotaLow } from './pr.ts'
import { hookPublish } from './remote.ts'
import { register } from './ticks.ts'
import { listened, widgetEvent } from './widgetEvents.ts'

export const BODY_CUT = 8000 // an issue's body in the event, cut there

// ---------- issue.labeled: once a minute (slow while idle), each GitHub project on this Mac, while some workflow or
// extension listens: gh api repos/{o}/{r}/issues/events with If-None-Match (a 304 costs no quota). Each `labeled` event
// on an issue (not a PR) newer than the project's mark emits issue.labeled; the first read only sets the mark, kept in
// state.json, so a restart doesn't fire again. Waits while GitHub's GraphQL quota is low, as the PR scans do.
// ponytail: an SSH host's project isn't read; the newest 50 events a minute
export async function issueTick(now = Date.now()) {
  if (!listened('issue.labeled') || (await quotaLow(now))) return
  for (const p of state.projects) {
    if (p.archived || p.host || p.kind || p.git === false || !onGitHub(p.path)) continue
    await issuesOf(p).catch(e => log(`issue.labeled ${p.name}: ${firstLine(e)}`))
  }
}
async function issuesOf(p: Project) {
  const repo = cs.ghRepo(await git(p, 'remote', 'get-url', 'origin').catch(() => ''))
  if (!repo) return
  const mark = p.issueMark
  const args = ['api', '-i', `repos/${repo}/issues/events?per_page=50`, ...(mark?.etag ? ['-H', `If-None-Match: ${mark.etag}`] : [])]
  ghCount(args)
  const out = await run('gh', args, { cwd: p.path, timeout: 20000, maxBuffer: 16 << 20 }).then(
    r => String(r.stdout),
    e => (/\b304\b/.test(`${e.stdout ?? ''}${e.stderr ?? ''}`) ? '' : Promise.reject(e)), // gh may call a 304 a failure
  )
  const cut = out.search(/\r?\n\r?\n/)
  const head = cut < 0 ? out : out.slice(0, cut)
  if (!out || /^HTTP\/[\d.]+ 304/.test(head)) return // nothing new
  const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1]
  const events = JSON.parse(out.slice(cut).trim() || '[]') as any[]
  if (!Array.isArray(events)) return
  const top = Math.max(mark?.id ?? 0, ...events.map(e => Number(e?.id)).filter(Number.isFinite))
  if (mark)
    for (const e of [...events].reverse()) {
      const i = e?.issue
      if (e?.event !== 'labeled' || !(Number(e.id) > mark.id) || !i || i.pull_request) continue
      widgetEvent('issue.labeled', { project: { id: p.id, name: p.name }, number: i.number, title: String(i.title ?? ''), url: i.html_url, label: String(e.label?.name ?? ''), by: e.actor?.login, body: String(i.body ?? '').slice(0, BODY_CUT) }, undefined, undefined, { from: { agent: 'github' } })
    }
  p.issueMark = { id: top, ...(etag && { etag }) }
  save()
}

// ---------- webhook: a server of its own on 127.0.0.1 and a random port, never the daemon's. Only POST /hook/<name>,
// a body up to 1 MB, RATE a minute per hook; nothing else (no /rpc, no pages). Each request is checked against its
// hook's secret: GitHub's X-Hub-Signature-256 (HMAC-SHA256 of the raw body), Linear's Linear-Signature (the same, in
// hex), else X-Laki-Key. A failed check is a 401, logged once a minute per hook. Then webhook { name, event (X-GitHub-
// Event, else the body's type), body }. Expose: a quick cloudflared tunnel, or tailscale funnel, to that port only
const BODY_MAX = 1 << 20
const RATE = 60
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const secretsDir = () => join(dir, 'hooks')
const secretOf = (name: string) => {
  if (!NAME.test(name)) return // a hook's name only: never a path out of <data>/hooks
  try {
    return readFileSync(join(secretsDir(), name), 'utf8').trim()
  } catch {}
}
const hooks = (): InHook[] => (Array.isArray(state.settings?.inHooks) ? state.settings!.inHooks! : [])
let server: Server | undefined
let port = 0
type Pub = { via: 'cloudflared' | 'tailscale'; url?: string; down?: string; stop: () => void }
let pub: Pub | undefined
const seen = new Map<string, { at: number; n: number }>() // a hook's requests this minute
const told = new Map<string, number>() // a hook's last 401 logged

const eq = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
export function signed(kind: InHook['kind'], secret: string, raw: Buffer, h: IncomingMessage['headers']) {
  const mac = createHmac('sha256', secret).update(raw).digest('hex')
  if (kind === 'github') return eq(String(h['x-hub-signature-256'] ?? ''), `sha256=${mac}`)
  if (kind === 'linear') return eq(String(h['linear-signature'] ?? ''), mac)
  return eq(String(h['x-laki-key'] ?? ''), secret)
}

function answer(res: ServerResponse, code: number, body: object) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
function onRequest(req: IncomingMessage, res: ServerResponse) {
  const name = /^\/hook\/([^/?#]+)$/.exec(new URL(req.url ?? '', 'http://x').pathname)?.[1] ?? ''
  const hook = hooks().find(h => h.name === name)
  if (req.method !== 'POST' || !hook) return void (answer(res, 404, { error: 'not found' }), req.resume())
  const now = Date.now()
  const s = seen.get(name)
  const slot = s && now - s.at < 60000 ? s : { at: now, n: 0 }
  seen.set(name, slot)
  if (++slot.n > RATE) return void (res.setHeader('retry-after', String(Math.ceil((slot.at + 60000 - now) / 1000))), answer(res, 429, { error: 'too many: 60 a minute' }), req.resume())
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > BODY_MAX) return void (answer(res, 413, { error: 'over 1 MB' }), req.destroy())
    chunks.push(c)
  })
  req.on('end', () => {
    if (size > BODY_MAX) return
    const raw = Buffer.concat(chunks)
    const secret = secretOf(name)
    if (!secret || !signed(hook.kind, secret, raw, req.headers)) {
      if (now - (told.get(name) ?? 0) > 60000) told.set(name, now), log(`webhook ${name}: refused a request that failed its ${hook.kind === 'key' ? 'X-Laki-Key' : `${hook.kind} signature`} check`)
      return answer(res, 401, { error: 'signature' })
    }
    let body: unknown = raw.toString('utf8')
    try {
      body = JSON.parse(String(body))
    } catch {
      body = String(body).slice(0, BODY_CUT)
    }
    const event = String(req.headers['x-github-event'] ?? (body && typeof body === 'object' ? ((body as any).type ?? (body as any).action ?? '') : ''))
    const p = hook.project ? state.projects.find(x => x.id === hook.project) : undefined
    widgetEvent('webhook', { name, event, body, ...(p && { project: { id: p.id, name: p.name } }) }, undefined, undefined, { from: { agent: 'webhook' } })
    answer(res, 202, { ok: true })
  })
}
export function hookServe() {
  if (server || !hooks().length) return
  server = createServer(onRequest)
  server.on('error', e => log('webhook server', e))
  server.listen(0, '127.0.0.1', () => {
    const a = server?.address()
    port = typeof a === 'object' && a ? a.port : 0
    log(`webhooks on 127.0.0.1:${port}`)
    changed()
  })
}
export function hookStop() {
  pub?.stop()
  pub = undefined
  server?.close()
  server = undefined
  port = 0
}

// Settings › Webhooks
export function hookList() {
  return { port, ...(pub && { via: pub.via, url: pub.url, down: pub.down }), hooks: hooks().map(h => ({ ...h, local: port ? `http://127.0.0.1:${port}/hook/${h.name}` : undefined, ...(pub?.url && { url: `${pub.url}/hook/${h.name}` }) })) }
}
// a new hook and its secret (shown once here; hookSecret again)
export function hookAdd(o: { name: string; kind?: string; project?: string }) {
  const name = String(o.name ?? '').trim().toLowerCase()
  if (!NAME.test(name)) throw new Error('a name of letters, digits and -, 40 at most')
  if (hooks().some(h => h.name === name)) throw new Error(`a webhook ${name} is there already`)
  const kind = o.kind === 'github' || o.kind === 'linear' ? o.kind : 'key'
  if (o.project) findProject(o.project)
  const secret = randomBytes(24).toString('hex')
  mkdirSync(secretsDir(), { recursive: true, mode: 0o700 })
  writeFileSync(join(secretsDir(), name), secret, { mode: 0o600 })
  chmodSync(join(secretsDir(), name), 0o600)
  state.settings = { ...state.settings, inHooks: [...hooks(), { name, kind, ...(o.project && { project: o.project }) }] }
  save()
  hookServe()
  changed()
  return { name, secret }
}
export const hookSecret = (o: { name: string }) => ({ secret: secretOf(String(o.name)) ?? '' })
export function hookRm(o: { name: string }) {
  const name = String(o.name ?? '')
  state.settings = { ...state.settings, inHooks: hooks().filter(h => h.name !== name) }
  if (existsSync(join(secretsDir(), name)) && NAME.test(name)) rmSync(join(secretsDir(), name), { force: true })
  if (!hooks().length) hookStop()
  save()
  changed()
}
// on: its public address (cloudflared's quick tunnel changes on each start; tailscale funnel keeps the machine's name)
export async function hookExpose(o: { on: boolean; via?: string }) {
  pub?.stop()
  pub = undefined
  changed()
  if (!o.on) return hookList()
  if (!port) throw new Error('add a webhook first')
  const via = o.via === 'tailscale' ? 'tailscale' : 'cloudflared'
  const p: Pub = { via, stop: () => {} }
  pub = p
  try {
    const { cf, url } = await hookPublish(port, via, why => pub === p && ((p.down = why), (p.url = undefined), changed()))
    p.stop = cf.stop
    p.url = await url
  } catch (e) {
    if (pub === p) p.stop(), (pub = undefined), changed() // it never came up: nothing shown as exposed
    throw e
  }
  changed()
  return hookList()
}

export function inboundStart() {
  register('issueTick', Number(process.env.LAKI_ISSUE_TICK_MS) || 60000, () => issueTick(), { idle: 'slow' }) // tests' faster
  hookServe()
}
