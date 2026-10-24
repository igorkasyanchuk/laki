// what goes out through a tunnel: a port exposed to the world, a tab shared as a page, and remote access to the whole
// app (cloudflared or tailscale). core.ts re-exports it.

import { spawn } from 'node:child_process'
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { readJson } from '../shared/conn.ts'
import { type Agent, AGENT_NAMES, type Remote, REMOTE_TRIES, type Tunnel } from '../shared/types.ts'
import { broadcast, changed, dir, findWs, firstLine, log, onPath, projectConfig, resolveTarget, run, save, screen, settingsSet, state } from './core.ts'
import { type Tail, tailOf } from './meters.ts'
import { own } from './resources.ts'
import { chatOf, redact, type Said, shareBody, shareMd, sharePage } from './share.ts'

// ---------- tunnels: a port exposed by cloudflared. A quick one (Cloudflare Quick Tunnels) at a random
// trycloudflare.com URL; with mails, only those addresses (or *@domain) get in, after a one-time code from Cloudflare
// Access. A permanent one (host) at a hostname of your own named tunnel (settings.tunnel: Settings › Tunnels), until you
// stop it. Both are kept in state.json (state.tunnels, keep) and come back after a daemon restart (tunnelsBack), and
// cloudflared starts again when it ends on its own (AGAIN apart, then a minute each time): a quick one at a new address
// (the `tunnel` event says so), a permanent one at its own

type TunnelRun = Tunnel & { ws: string; cf?: Cf; tries: number; was?: string; via?: string; timer?: ReturnType<typeof setTimeout> } // cf: a quick one's cloudflared; was: its address before it went; via: the named tunnel a permanent one's DNS record goes to
const tunnels = new Map<string, TunnelRun>() // by `<ws>:<port>`
export const MAIL_VERSION = '2026.9.3' // the first cloudflared with --allowed-mail
// a quick tunnel's name is random words with dashes: not api. (in cloudflared's errors) or login.
const TUNNEL_URL = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/
const MAIL = /^(?:\*|[^\s@*,]+)@[^\s@*,]+\.[^\s@*,]+$/ // an address, or *@domain: a whole domain
const AGAIN = [2, 5, 15, 30, 60].map(s => s * 1000) // before cloudflared starts again, by how many times in a row
export const tunnelsOf = (ws: string) => [...tunnels.values()].filter(t => t.ws === ws).map(({ port, url, mails, until, host, down }) => ({ port, url, mails, ...(until && { until }), ...(host && { host }), ...(down && { down }) }))
const keyOf = (t: { ws: string; port: number }) => `${t.ws}:${t.port}`
// state.json's copy: what tunnelsBack starts again
function keep() {
  const all = [...tunnels.values()].map(({ ws, port, mails, until, host, via, url, was }) => ({ ws, port, ...(mails?.length && { mails }), ...(until && { until }), ...(host && { host, via }), ...((url ?? was) && { url: url ?? was }) }))
  if (all.length) state.tunnels = all
  else delete state.tunnels
  save()
}
// a < b, for x.y.z versions
const older = (a: string, b: string) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0)
  return false
}
const cfVersion = () => run('cloudflared', ['--version'], { timeout: 10000 }).then(r => /\d+\.\d+\.\d+/.exec(r.stdout + r.stderr)?.[0] ?? '?', () => undefined)

// is cloudflared installed (its version), and who to let in by default: the workspace's project says (expose:
// only those; its settings, else .laki.json), else the popup offers the last list, or git's user.email. named: the
// permanent tunnels' (Settings › Tunnels), when set
export async function cloudflared(o: { ws?: string } = {}): Promise<{ version?: string; mails: string[]; expose?: string; named?: { name: string; domain: string } }> {
  const expose = o.ws ? projectConfig(findWs(o.ws)).expose?.trim() || undefined : undefined
  const version = await cfVersion()
  let mails = state.settings?.tunnelMails ?? []
  if (!mails.length) mails = await run('git', ['config', '--global', '--get', 'user.email'], { timeout: 5000 }).then(r => (r.stdout.trim() ? [r.stdout.trim()] : []), () => [])
  return { version, mails, expose, named: named() }
}

// cloudflared publishing target (with mails: only those, after a one-time code from Cloudflare Access). url resolves
// once it prints one (undefined: stopped first) or fails with its output; ended: it went after giving the URL.
type Cf = { stop: () => void }
function cloudflare(target: string, mails: string[], ended: (why: string) => void, who: [name: string, stop: string]): { cf: Cf; url: Promise<string | undefined> } {
  // the values go in as arguments of their own (=), so one starting with - is no flag
  // --no-autoupdate: cloudflared's own updater (a download from GitHub) restarts it, and a quick tunnel's address with it
  return publisher('cloudflared', 'cloudflared', ['tunnel', '--no-autoupdate', '--url', target, ...mails.map(m => `--allowed-mail=${m}`)], TUNNEL_URL, ended, who)
}
// L14: each publisher's pid and start time in <data>/children.json while it runs: a daemon that died without stopping
// them (a crash, a kill -9) leaves them there, and the next one stops them as it starts (reapChildren); off: what turns
// a tailscale serve or funnel off again
type Kid = { pid: number; start: string; bin: string; off?: string[] }
const kids = new Map<number, Kid>()
const kidsFile = () => join(dir, 'children.json')
const writeKids = () => {
  try {
    writeFileSync(kidsFile(), JSON.stringify([...kids.values()]), { mode: 0o600 })
  } catch (e) {
    log('children.json', e)
  }
}
const lstart = (pid: number) => run('ps', ['-o', 'lstart=,command=', '-p', String(pid)]).then(r => r.stdout.trim(), () => '')
let reaping: Promise<void> = Promise.resolve() // remoteStart waits for it: a tailscale off must come before a new serve
export const reapChildren = () => (reaping = reap())
async function reap() {
  const old = readJson<Kid[]>(kidsFile())
  if (old === undefined) return
  rmSync(kidsFile(), { force: true })
  for (const k of Array.isArray(old) ? old : []) {
    if (!Number.isInteger(k?.pid) || typeof k.start !== 'string' || typeof k.bin !== 'string') continue
    const now = await lstart(k.pid)
    if (now.startsWith(k.start) && now.includes(basename(k.bin))) { // the same process (a pid can be another's by now)
      log(`stopping ${basename(k.bin)} (pid ${k.pid}): left running by a daemon that ended without stopping it`)
      try {
        process.kill(k.pid, 'SIGTERM')
      } catch {}
    }
    if (Array.isArray(k.off) && k.off.every(a => typeof a === 'string')) await run(k.bin, k.off, { timeout: 10000 }).catch(() => {})
  }
}

// a command that publishes something and prints its URL (cloudflared, tailscale serve), as a child of the daemon:
// stopping it unpublishes
function publisher(name: string, bin: string, args: string[], re: RegExp, ended: (why: string) => void, who: [name: string, stop: string], off?: string[]): { cf: Cf; url: Promise<string | undefined> } {
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  own(proc, ...who)
  const pid = proc.pid
  if (pid)
    void lstart(pid).then(now => {
      const start = now.slice(0, 24) // lstart's fixed width: "Tue Oct 21 10:11:07 2026"
      if (start && proc.exitCode === null && proc.signalCode === null) kids.set(pid, { pid, start, bin, ...(off && { off }) }), writeKids()
    })
  proc.on('close', () => pid && kids.delete(pid) && writeKids())
  let stopped = false
  const cf = { stop: () => ((stopped = true), proc.kill()) }
  const url = new Promise<string | undefined>((resolve, reject) => {
    let out = ''
    let got = false
    const fail = (why: string) => {
      clearTimeout(timer)
      proc.kill()
      if (stopped) return resolve(undefined)
      const tail = out.trim().split('\n').slice(-8).join('\n')
      reject(new Error(tail ? `${why}:\n${tail}` : why))
    }
    const timer = setTimeout(() => fail(`${name} gave no URL within 60 s`), 60000)
    const read = (b: Buffer) => {
      out = (out + b).slice(-16000)
      const m = !got && re.exec(out)
      if (!m) return
      got = true
      clearTimeout(timer)
      resolve(m[0])
    }
    proc.stdout!.on('data', read)
    proc.stderr!.on('data', read)
    proc.on('error', e => fail(`${name} didn't start: ${e.message}`))
    proc.on('close', (code, sig) => { // after its output: an error's last line is in
      if (!got) return fail(`${name} ended (${sig ?? `exit ${code}`})`)
      if (!stopped) ended(sig ?? `exit ${code}`)
    })
  })
  return { cf, url }
}

// cloudflared's version, failing when it can't limit who gets in (mails) or isn't there
async function cfReady(mails: boolean) {
  const version = await cfVersion()
  if (!version) throw new Error("cloudflared isn't installed: brew install cloudflared")
  if (mails && version !== '?' && older(version, MAIL_VERSION))
    throw new Error(`cloudflared ${version} can't limit who opens a tunnel (that needs ${MAIL_VERSION}): brew upgrade cloudflared`)
}

// tailscale's CLI: on PATH (Linux, Homebrew), else the Mac app's own
const TAILSCALE_APP = process.env.LAKI_TAILSCALE_APP || '/Applications/Tailscale.app/Contents/MacOS/Tailscale' // tests': none
const tailscaleBin = () => (onPath('tailscale') ? 'tailscale' : process.platform === 'darwin' && existsSync(TAILSCALE_APP) ? TAILSCALE_APP : undefined)
const TAILNET_URL = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d+)?/i
// this machine on its tailnet, or why not; peers: the tailnet's other devices online (none: nothing can open the link,
// since this Mac can't reach its own tailnet address: macOS keeps it to itself, never through Tailscale)
async function tsReady() {
  const bin = tailscaleBin()
  if (!bin) throw new Error("tailscale isn't installed: https://tailscale.com/download (on a Mac, the app; on Linux, its package)")
  const st = await run(bin, ['status', '--json'], { timeout: 10000 }).then(r => JSON.parse(r.stdout) as { BackendState?: string; Peer?: Record<string, { Online?: boolean }> }, e => ({ BackendState: firstLine(e), Peer: undefined }))
  if (st.BackendState !== 'Running') throw new Error(`Tailscale isn't connected (${st.BackendState ?? '?'}): tailscale up`)
  return { bin, peers: Object.values(st.Peer ?? {}).filter(p => p.Online).length }
}
// tailscale serve in the foreground: https on this machine's tailnet name, for the tailnet's devices only, until it's
// stopped; funnel: tailscale funnel, the same on the internet (the tailnet's policy must allow it: its output says
// where to turn it on). ponytail: port 443, its root; another serve of yours there is replaced while it runs
const tailscale = (bin: string, target: string, ended: (why: string) => void, who: [name: string, stop: string], funnel = false) =>
  publisher(`tailscale ${funnel ? 'funnel' : 'serve'}`, bin, [funnel ? 'funnel' : 'serve', '--https=443', target], TAILNET_URL, ended, who, [funnel ? 'funnel' : 'serve', '--https=443', 'off'])

// tunnelStart resolves once cloudflared prints the URL (a permanent one's: once its connector is up), or was stopped
// meanwhile, and fails with its output. hours: how long a quick one runs, as a shared tab's (SHARE_HOURS; unset: 8, so a
// forgotten one doesn't stay open for good). host: a permanent one at that name under settings.tunnel's domain (a word,
// or the whole hostname), until it's stopped
export async function tunnelStart(o: { ws: string; port: number; mails?: string[]; hours?: number; host?: string }): Promise<Tunnel> {
  const ws = findWs(o.ws)
  const live = () => state.workspaces.includes(ws) && !ws.archived
  const port = Number(o.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${o.port}`)
  if (port === daemonPort) throw new Error("that's Laki's own port: remote access shares it (Settings › Remote access)")
  const key = `${ws.id}:${port}`
  if (o.host !== undefined) return namedStart(ws.id, port, String(o.host), live)
  const hours = Number(o.hours ?? 8)
  if (!SHARE_HOURS.includes(hours)) throw new Error(`for how long: ${SHARE_HOURS.filter(Boolean).join(', ')} hours, or 0 (until stopped)`)
  const mails = [...new Set((o.mails ?? []).map(m => m.trim()).filter(Boolean))]
  const bad = mails.find(m => !MAIL.test(m))
  if (bad) throw new Error(`not an email address or *@domain: ${bad}`)
  await cfReady(mails.length > 0)
  if (!live()) throw new Error(`no workspace ${o.ws}`) // archived, or gone while cloudflared answered
  const cur = tunnels.get(key)
  if (cur?.host) throw new Error(`:${port} is exposed already at ${cur.host}: stop that first`)
  if (cur) return viewOf(cur)
  if (mails.length) settingsSet({ tunnelMails: mails })
  const t: TunnelRun = { ws: ws.id, port, mails, tries: 0, ...(hours && { until: Date.now() + hours * 3600e3 }) }
  tunnels.set(key, t)
  changed()
  try {
    await quickRun(key, t, true)
  } catch (e) {
    if (tunnels.get(key) === t) tunnels.delete(key), changed()
    throw e
  }
  return t.url ? viewOf(t) : { port, mails } // no url: stopped first (tunnelStop took it out)
}
const viewOf = (t: TunnelRun): Tunnel => ({ port: t.port, url: t.url, mails: t.mails, ...(t.until && { until: t.until }), ...(t.host && { host: t.host }) })

// a quick one's cloudflared, and again (again) when it ends on its own or can't start; first: tunnelStart's, whose
// failure is the caller's to see, not tried again
function quickRun(key: string, t: TunnelRun, first = false): Promise<string | undefined> {
  const w = state.workspaces.find(x => x.id === t.ws)
  const { cf, url } = cloudflare(`http://localhost:${t.port}`, t.mails ?? [], why => again(key, t, `cloudflared ended (${why})`), [`Expose to the world · ${w?.name ?? t.ws} :${t.port}`, `tunnel:${key}`])
  t.cf = cf
  return url.then(
    u => {
      if (tunnels.get(key) !== t || !u) return u
      const was = t.was
      Object.assign(t, { url: u, down: undefined, tries: 0, was: undefined })
      if (was && was !== u) log(`tunnel ${key}: back at ${u} (was ${was})`), broadcast({ ev: 'tunnel', ws: t.ws, port: t.port, url: u, was })
      keep()
      changed()
      return u
    },
    e => {
      if (first) throw e
      again(key, t, firstLine(e))
      return undefined
    },
  )
}
function again(key: string, t: TunnelRun, why: string) {
  if (tunnels.get(key) !== t) return
  if (t.tries < AGAIN.length) log(`tunnel ${key}: ${why}; starting it again`) // then quiet: down says why
  Object.assign(t, { was: t.url ?? t.was, url: undefined, down: why, cf: undefined })
  changed()
  clearTimeout(t.timer)
  t.timer = setTimeout(() => void (tunnels.get(key) === t && quickRun(key, t)), AGAIN[Math.min(t.tries++, AGAIN.length - 1)])
  t.timer.unref?.()
}

// ---------- permanent tunnels: your named tunnel (cloudflared tunnel login, then tunnel create <name>: its cert.pem and
// credentials in ~/.cloudflared), a hostname per workspace port under settings.tunnel's domain, its DNS record made once
// (tunnel route dns: never over one that's there), and one cloudflared for all of them (connect), its ingress in
// <data>/cloudflared/ingress.yml. Who gets in is Cloudflare Access's, in your dashboard: Laki sets none
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const named = (n = state.settings?.tunnel ?? {}) => {
  const name = n.name?.trim()
  const domain = n.domain?.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  return name && NAME.test(name) && domain && DOMAIN.test(domain) ? { name, domain } : undefined
}
// a word under the domain, or the whole hostname: one level (Cloudflare's free certificate covers name.domain, no deeper)
export function hostOf(given: string, domain: string) {
  const h = given.trim().toLowerCase().replace(/\.$/, '')
  const label = h.endsWith(`.${domain}`) ? h.slice(0, -domain.length - 1) : h
  if (!LABEL.test(label)) throw new Error(`not a name for ${domain}: ${given || '(none)'} (one word: letters, digits and dashes)`)
  return `${label}.${domain}`
}
async function namedStart(ws: string, port: number, given: string, live: () => boolean): Promise<Tunnel> {
  const n = named()
  if (!n) throw new Error('permanent tunnels: set your named tunnel and its domain in Settings › Tunnels first')
  const host = hostOf(given, n.domain)
  const key = `${ws}:${port}`
  const cur = tunnels.get(key)
  if (cur) {
    if (cur.host === host) return viewOf(cur)
    throw new Error(`:${port} is exposed already${cur.host ? ` at ${cur.host}` : ''}: stop that first`)
  }
  const taken = () => {
    const o = [...tunnels.values()].find(t => t.host === host)
    if (o) throw new Error(`${host} is taken: ${o.ws}'s :${o.port}`)
  }
  taken()
  await cfReady(false)
  await routeDns(n.name, host)
  if (!live()) throw new Error(`no workspace ${ws}`)
  if (tunnels.has(key)) throw new Error(`:${port} is exposed already: stop that first`) // one started meanwhile
  taken() // on another port meanwhile
  const t: TunnelRun = { ws, port, mails: [], host, via: n.name, tries: 0 }
  tunnels.set(key, t)
  changed()
  try {
    await connect()
    if (tunnels.get(key) === t && !t.url && conn) await conn.ready // another started meanwhile: its connector has this one too
  } catch (e) {
    if (tunnels.get(key) === t) tunnels.delete(key), void connect().catch(() => {}), changed() // the others as they were
    throw e
  }
  if (tunnels.get(key) !== t) return { port, mails: [], host } // stopped meanwhile
  keep()
  return viewOf(t)
}
// its DNS record: a CNAME to the tunnel, made by cloudflared; one there already that's this tunnel's is fine, another
// name's is never replaced (no --overwrite-dns)
async function routeDns(name: string, host: string) {
  await run('cloudflared', ['tunnel', 'route', 'dns', name, host], { timeout: 30000 }).catch(e => {
    const out = String(e.stderr || e.stdout || e.message || e)
    if (/already exists/i.test(out)) throw new Error(`${host} has a DNS record already that isn't this tunnel's: pick another name, or remove that record in Cloudflare's dashboard`)
    throw new Error(`cloudflared couldn't route ${host} to ${name}: ${out.split('\n').filter(l => /ERR|error|failed/i.test(l)).pop()?.trim() ?? firstLine(e)}`)
  })
}
type Connector = { cf: Cf; key: string; ready: Promise<void> }
let conn: Connector | undefined
let connTries = 0
let connTimer: ReturnType<typeof setTimeout> | undefined
// every permanent tunnel through one cloudflared, started again as their list changes (ponytail: cloudflared reads its
// ingress only as it starts, so the others are off the air for a second or two) or when it ends on its own; none: stopped
function connect(): Promise<void> {
  const n = named()
  // one whose DNS record goes to another named tunnel (its name changed in Settings) can't be served by this one
  const list = [...tunnels.values()].filter(t => t.host && (!n || !t.via || t.via === n.name)).sort((a, b) => a.host!.localeCompare(b.host!))
  for (const t of tunnels.values())
    if (t.host && n && t.via && t.via !== n.name) Object.assign(t, { url: undefined, down: `its DNS record goes to your tunnel ${t.via}, not ${n.name}: stop it, remove that record in Cloudflare's dashboard and expose it again` }), changed()
  const key = JSON.stringify([n?.name, list.map(t => [t.host, t.port])])
  if (conn?.key === key) return conn.ready
  clearTimeout(connTimer)
  conn?.cf.stop()
  conn = undefined
  if (!list.length) return Promise.resolve()
  if (!n) {
    for (const t of list) t.down = 'no named tunnel set: Settings › Tunnels'
    changed()
    return Promise.reject(new Error('permanent tunnels: set your named tunnel and its domain in Settings › Tunnels first'))
  }
  const folder = join(dir, 'cloudflared')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const file = join(folder, 'ingress.yml')
  writeFileSync(file, `# Laki's permanent tunnels (Settings › Tunnels): written each time one starts or stops\ningress:\n${list.map(t => `  - hostname: ${t.host}\n    service: http://localhost:${t.port}\n`).join('')}  - service: http_status:404\n`, { mode: 0o600 })
  const me = {} as Connector
  const { cf, url } = publisher('cloudflared', 'cloudflared', ['tunnel', '--no-autoupdate', '--config', file, 'run', n.name], /Registered tunnel connection/, why => connDown(me, `cloudflared ended (${why})`), ['Permanent tunnels', 'tunnel:named'])
  Object.assign(me, {
    cf,
    key,
    ready: url.then(
      up => {
        if (conn !== me || up === undefined) return
        connTries = 0
        for (const t of list) if (tunnels.get(keyOf(t)) === t) Object.assign(t, { url: `https://${t.host}`, down: undefined })
        keep()
        changed()
      },
      e => {
        connDown(me, firstLine(e))
        throw e
      },
    ),
  })
  me.ready.catch(() => {})
  conn = me
  return me.ready
}
function connDown(me: Connector, why: string) {
  if (conn !== me) return
  conn = undefined
  if (connTries < AGAIN.length) log(`permanent tunnels: ${why}; starting cloudflared again`)
  for (const t of tunnels.values()) if (t.host) t.down = why
  changed()
  connTimer = setTimeout(() => void connect().catch(() => {}), AGAIN[Math.min(connTries++, AGAIN.length - 1)])
  connTimer.unref?.()
}

// Settings › Tunnels' check: cloudflared there, signed in (cert.pem), the named tunnel in the account, its credentials
// on this Mac (beside the certificate, or in ~/.cloudflared: where cloudflared looks), a domain. name, domain: the form's
// as typed (Settings saves a moment later), else the settings'
export async function tunnelCheck(o: { name?: string; domain?: string } = {}) {
  const n = o.name !== undefined || o.domain !== undefined ? { name: o.name === undefined ? undefined : String(o.name), domain: o.domain === undefined ? undefined : String(o.domain) } : (state.settings?.tunnel ?? {})
  const version = await cfVersion()
  const cfHome = join(homedir(), '.cloudflared')
  const certAt = process.env.TUNNEL_ORIGIN_CERT || join(cfHome, 'cert.pem')
  const cert = existsSync(certAt)
  let tunnel: { id: string; name: string } | undefined
  let why: string | undefined
  if (version && cert && n.name?.trim())
    tunnel = await run('cloudflared', ['tunnel', 'list', '--output', 'json'], { timeout: 30000 }).then(
      r => (JSON.parse(r.stdout || '[]') as { id: string; name: string }[]).map(x => ({ id: x.id, name: x.name })).find(x => x.name === n.name!.trim() || x.id === n.name!.trim()),
      e => void (why = firstLine(e)),
    )
  const creds = !!tunnel && [dirname(certAt), cfHome].some(d => existsSync(join(d, `${tunnel!.id}.json`)))
  return { version, cert, tunnel, creds, why, ok: !!(version && cert && tunnel && creds && named(n)) }
}

// every 15 s (main.ts): tunnels past their hours stop
export function tunnelTick(now = Date.now()) {
  for (const t of [...tunnels.values()]) if (t.until && now >= t.until) log(`tunnel ${keyOf(t)}: its time is up`), drop(t)
}

export function tunnelStop(o: { ws: string; port: number }) {
  const t = tunnels.get(`${findWs(o.ws).id}:${Number(o.port)}`)
  if (t) drop(t)
}
function drop(t: TunnelRun) {
  if (tunnels.get(keyOf(t)) !== t) return
  tunnels.delete(keyOf(t))
  clearTimeout(t.timer)
  t.cf?.stop()
  if (t.host) void connect().catch(() => {})
  keep()
  changed()
}

// every tunnel, or a workspace's (its teardown), or the permanent ones (Resources' Stop on their cloudflared): stopped
// for good
export function stopTunnels(ws?: string, permanent = false) {
  for (const t of [...tunnels.values()]) if ((!ws || t.ws === ws) && (!permanent || t.host)) drop(t)
}

// shutdown: every cloudflared stopped, state.tunnels kept for the next start (tunnelsBack)
export function tunnelsDown() {
  for (const t of tunnels.values()) clearTimeout(t.timer), t.cf?.stop()
  clearTimeout(connTimer)
  conn?.cf.stop()
  conn = undefined
  tunnels.clear()
}

// as the daemon starts (main.ts, after reapChildren): the tunnels state.json kept, each of a live workspace and not past
// its time, started again; a quick one's address is new (the tunnel event, once it has one)
export function tunnelsBack(now = Date.now()) {
  for (const s of state.tunnels ?? []) {
    const w = state.workspaces.find(x => x.id === s?.ws && !x.archived)
    if (!w || !Number.isInteger(s.port) || s.port === daemonPort || (s.until && s.until <= now) || tunnels.has(keyOf(s))) continue
    const t: TunnelRun = { ws: w.id, port: s.port, mails: Array.isArray(s.mails) ? s.mails.filter(m => typeof m === 'string' && MAIL.test(m)) : [], tries: 0, was: s.url, down: 'starting again after a restart', ...(s.until && { until: s.until }), ...(typeof s.host === 'string' && { host: s.host, ...(typeof s.via === 'string' && { via: s.via }) }) }
    tunnels.set(keyOf(t), t)
    if (!t.host) void quickRun(keyOf(t), t)
  }
  keep()
  if ([...tunnels.values()].some(t => t.host)) void connect().catch(() => {})
  changed()
}

// ---------- shared tabs (share.ts): a tab as a read-only page at <a quick tunnel>/s/<uuid> for anyone with the link,
// kept up to date (the page asks every 2.5 s). The pages have a server of their own on 127.0.0.1, so the tunnel reaches
// them and never the daemon's API; one tunnel for all, both stopped with the last share. Like tunnels, they live in
// this process only: a restart ends them (a quick tunnel's URL is new each time anyway).
type ShareRun = Tail & { id: string; tab: string; ws: string; until?: number; v: number; title: string; sub: string; md: string; body: string; read?: number; key?: string; said?: Said[] }
const shares = new Map<string, ShareRun>()
type Sharing = { server: Server; cf?: Cf; base: Promise<string | undefined> } // base: the tunnel's URL
let sharing: Sharing | undefined
const shareOf = (tab: string) => [...shares.values()].find(s => s.tab === tab)
export const shareLink = (tab: string) => (s => s && sharedAt ? { url: `${sharedAt}/s/${s.id}`, ...(s.until && { until: s.until }) } : undefined)(shareOf(tab))
export const SHARE_HOURS = [1, 8, 24, 0] // how long a link lasts: 0, until you stop it
let sharedAt: string | undefined // the tunnel's URL, once it gave one

export async function shareStart(o: { tab: string; hours?: number }): Promise<{ url: string; until?: number }> {
  const tab = resolveTarget(o.tab)
  const hours = Number(o.hours ?? 0)
  if (!SHARE_HOURS.includes(hours)) throw new Error(`for how long: ${SHARE_HOURS.filter(Boolean).join(', ')} hours, or 0 (until stopped)`)
  await cfReady(false)
  const s: ShareRun = shareOf(tab.id) ?? { id: randomUUID(), tab: tab.id, ws: tab.workspace, v: 0, title: tab.name, sub: '', md: '', body: '' }
  if (o.hours !== undefined) s.until = hours ? Date.now() + hours * 3600e3 : undefined // asked again: from now
  shares.set(s.id, s)
  if (!sharing) {
    // set at once: a second share started meanwhile waits for this one's tunnel
    const server = createServer((q, r) => void shareServe(q, r).catch(e => (log('share', e), r.headersSent || r.writeHead(500).end())))
    const at: Sharing = { server, base: Promise.resolve(undefined) }
    at.base = new Promise<void>((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok)).then(() => {
      if (sharing !== at) return undefined // stopped meanwhile
      const { cf, url } = cloudflare(`http://127.0.0.1:${(server.address() as { port: number }).port}`, [], why => (log(`shared tabs' tunnel ended (${why})`), stopShares()), ['Shared tabs', 'share'])
      at.cf = cf
      return url
    })
    sharing = at
  }
  const at = sharing
  let base: string | undefined
  try {
    base = await at.base
  } catch (e) {
    if (sharing === at) stopShares()
    throw e
  }
  if (!base || !shares.has(s.id)) throw new Error('sharing was stopped')
  sharedAt = base
  changed()
  return { url: `${base}/s/${s.id}`, ...(s.until && { until: s.until }) }
}

// every 15 s (main.ts): links past their hours stop
export function shareTick(now = Date.now()) {
  for (const s of shares.values()) if (s.until && now >= s.until) stopShares({ tab: s.tab })
}

// a tab's share, or every one (Resources' Stop), or a workspace's tabs' and closed tabs' (archived, closed)
export function stopShares(o: { tab?: string; ws?: string } = {}) {
  const n = shares.size
  for (const s of [...shares.values()]) if ((!o.tab && !o.ws) || s.tab === o.tab || s.ws === o.ws || !state.tabs.some(t => t.id === s.tab)) shares.delete(s.id)
  if (shares.size === n) return
  if (!shares.size && sharing) {
    sharing.cf?.stop()
    sharing.server.close()
    sharing.server.closeAllConnections()
    sharing = sharedAt = undefined
  }
  changed()
}

// what the tab shows now: its chat (claude's or codex's transcript, read as it grows), else its terminal's text; at
// most every 1.5 s however many look
async function shareRead(s: ShareRun) {
  const tab = state.tabs.find(t => t.id === s.tab)
  if (!tab || (s.read && Date.now() - s.read < 1500)) return
  s.read = Date.now()
  const agent = tab.preset ?? ''
  const name = AGENT_NAMES[agent as Agent] ?? tab.name
  let said: Said[] | undefined
  let key: string | undefined
  const text = tailOf(tab, s, () => (s.said = []))
  if (text !== undefined) {
    said = chatOf(agent, text, (s.said ??= []))
    key = `${s.file}:${s.pos}`
  } else {
    // the screen until its transcript is found
    const text = await screen(tab.id, 5000)
    said = text.trim() ? [{ who: 'screen', text }] : []
    key = text
  }
  if (key === s.key && s.title === tab.name) return
  const shown = said.map(x => ({ ...x, text: redact(x.text) })) // token-shaped strings masked (L9)
  Object.assign(s, { key, title: tab.name, md: shareMd(tab.name, name, shown), body: shareBody(name, shown), v: s.v + 1 })
}

async function shareServe(q: IncomingMessage, r: ServerResponse) {
  const u = new URL(q.url ?? '/', 'http://x')
  const m = /^\/s\/([0-9a-f-]{36})(\.md|\.json)?$/.exec(u.pathname)
  const s = m && shares.get(m[1])
  if (s?.until && Date.now() >= s.until) stopShares({ tab: s.tab }) // its hours are up: a tick may not have come yet
  const head = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' }
  if (q.method !== 'GET' || !s || !shares.has(s.id)) return void r.writeHead(404, { ...head, 'content-type': 'text/plain' }).end('This share has ended, or never was.')
  await shareRead(s)
  if (!state.tabs.some(t => t.id === s.tab)) s.sub = 'The tab was closed: this is what it showed last'
  else s.sub = 'Live · view-only · updates as it goes'
  if (m[2] === '.md') {
    const file = `${s.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'shared'}.md`
    return void r.writeHead(200, { ...head, 'content-type': 'text/markdown; charset=utf-8', ...(u.searchParams.has('download') && { 'content-disposition': `attachment; filename="${file}"` }) }).end(s.md)
  }
  if (m[2] === '.json') return void r.writeHead(200, { ...head, 'content-type': 'application/json' }).end(JSON.stringify({ v: s.v, title: s.title, sub: s.sub, ...(Number(u.searchParams.get('v')) !== s.v && { body: s.body }) }))
  const nonce = randomBytes(16).toString('base64')
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  r.writeHead(200, { ...head, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp }).end(sharePage({ id: s.id, title: s.title, sub: s.sub, body: s.body, v: s.v, nonce }))
}

// ---------- remote access: this daemon, and the app's page it serves (main.ts), at a trycloudflare.com URL for the
// one email in Settings: Cloudflare Access sends it a one-time code, and the link carries a token of its own (open:
// no email, asked for in so many words (Settings' typed confirm), the token the only lock: anyone with the link; pin:
// no email either, the link's key and a PIN Laki shows here, typed on the page (remotePin), give the page its token,
// and a wrong PIN settings.remoteTries times stops it). It ends after the hours asked for (remoteTick; 0: forever, no
// until), on remoteStop, or with the daemon; a new token each time, so a stopped link is dead.
export const REMOTE_HOURS = [1, 2, 4, 8, 12, 24, 48, 72, 0]
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/ // one address: no *@domain
// token: the link's, good once, for remotePin only (L3): it gives the page access, the token it connects with (pin: with
// the PIN), and is dead then (used); left: wrong tries left
type RemoteRun = { mail: string; until?: number; token: string; url?: string; cf: Cf; pin?: string; access: string; used?: boolean; left?: number; via?: 'tailscale'; funnel?: boolean; peers?: number }
let remote: RemoteRun | undefined
export let daemonPort = 0
export const setDaemonPort = (p: number) => (daemonPort = p)
export const remoteToken = () => (remote?.used ? remote.access : undefined)
export const remoteOrigin = () => remote?.url // the page's origin, once there's a URL
export const remoteView = (): Remote | undefined =>
  remote && { mail: remote.mail, ...(remote.via && { via: remote.via, funnel: remote.funnel, peers: remote.peers }), ...(!remote.mail && !remote.pin && !remote.via && { open: true }), ...(remote.pin && { pin: remote.pin, tries: remote.left }), ...(remote.used && { used: true }), until: remote.until, url: remote.url, link: remote.url && `${remote.url}/?token=${remote.token}` }
const triesOf = () => (n => (Number.isInteger(n) && n >= 1 && n <= 10 ? n : REMOTE_TRIES))(Number(state.settings?.remoteTries))

// via tailscale: tailscale serve instead of cloudflared, the tailnet's devices only, no email (a PIN as well, if asked);
// funnel: tailscale funnel, on the internet, so with a PIN only
export async function remoteStart(o: { hours: number; mail?: string; open?: boolean; pin?: boolean; via?: string; funnel?: boolean }): Promise<Remote | undefined> {
  const hours = o.hours // a number: null or '' would be 0, forever
  if (typeof hours !== 'number' || !REMOTE_HOURS.includes(hours)) throw new Error(`for how long: ${REMOTE_HOURS.filter(Boolean).join(', ')} hours, or 0 (until stopped)`)
  if (o.via !== undefined && o.via !== 'cloudflare' && o.via !== 'tailscale') throw new Error(`through cloudflare or tailscale, not ${o.via}`)
  const ts = o.via === 'tailscale'
  const pin = o.pin === true // Laki's PIN, no email
  const funnel = ts && o.funnel === true
  if (funnel && !pin) throw new Error('Funnel puts it on the internet: only with a PIN')
  const open = !ts && !pin && o.open === true && !o.mail?.trim() // no email: only when asked for (an email given wins)
  const mail = ts || open || pin ? '' : (o.mail ?? state.settings?.remoteMail ?? '').trim()
  if (!ts && !open && !pin && !ONE_MAIL.test(mail)) throw new Error(mail ? `not an email address: ${mail}` : 'the email that may open it: Settings › Remote access')
  if (open && (!hours || hours > 24)) throw new Error('without an email, 24 hours at most: anyone with the link gets in')
  if (mail && mail !== state.settings?.remoteMail) settingsSet({ remoteMail: mail }) // open and pin keep the saved one
  if (remote) return remoteView()
  await reaping.catch(() => {})
  const { bin, peers } = ts ? await tsReady() : (await cfReady(!!mail), { bin: '', peers: 0 })
  if (remote) return remoteView() // started meanwhile
  const target = `http://127.0.0.1:${daemonPort}`
  const ended = (why: string) => (log(`remote access ended (${why})`), remoteStop())
  const { cf, url } = ts ? tailscale(bin, target, ended, ['Remote access', 'remote'], funnel) : cloudflare(target, mail ? [mail] : [], ended, ['Remote access', 'remote'])
  const r: RemoteRun = { mail, until: hours ? Date.now() + hours * 3600e3 : undefined, token: randomBytes(32).toString('hex'), access: randomBytes(32).toString('hex'), cf, ...(ts && { via: 'tailscale' as const, funnel, peers }) }
  if (pin) Object.assign(r, { pin: String(randomInt(0, 1e6)).padStart(6, '0'), left: triesOf() })
  remote = r
  changed()
  try {
    r.url = await url
  } catch (e) {
    if (remote === r) remoteStop()
    throw e
  }
  if (remote !== r) return undefined // stopped meanwhile
  log(`remote access at ${r.url} for ${ts ? `${funnel ? 'the internet (Tailscale Funnel)' : `the tailnet's devices (${peers} more online)`} with the link${pin ? ' and its PIN' : ''}` : mail || (pin ? `the link and its PIN (${r.left} wrong tries stop it)` : 'anyone with the link (no email)')}, ${r.until ? `until ${new Date(r.until).toISOString()}` : 'until stopped'}`)
  changed()
  return remoteView()
}

export function remoteStop() {
  const r = remote
  if (!r) return
  remote = undefined
  r.cf.stop()
  changed()
}

// a secret compared in constant time (none wanted: no; main.ts' tokens too), as bytes: a multibyte one as long in
// characters isn't timingSafeEqual's throw
export function same(a: string, b: string | undefined) {
  if (!b) return false
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}
// the page's first ask (main.ts' POST /pin, from the page's origin): the link's key, once, for the token the page
// connects with (need: false and token; with a PIN: need, then the PIN gives it), after which the link is dead (need:
// false, no token: a token that isn't the link's, the page's own already, or a link opened before). A wrong PIN counts
// down; the last stops remote access, and the app says so
export function remotePin(p: { token?: unknown; pin?: unknown }): { need: boolean; left?: number; token?: string } | { token: string } {
  const r = remote
  if (!r || r.used || typeof p.token !== 'string' || !same(p.token, r.token)) return { need: false }
  const use = () => ((r.used = true), changed(), r.access)
  if (!r.pin) return { need: false, token: use() }
  if (p.pin === undefined) return { need: true, left: r.left }
  if (typeof p.pin === 'string' && same(p.pin.normalize('NFKC').replace(/\s+/g, ''), r.pin)) return { token: use() }
  r.left = (r.left ?? 1) - 1
  if (r.left > 0) {
    changed()
    throw new Error(`Wrong PIN: ${r.left} more ${r.left === 1 ? 'try' : 'tries'}, then remote access stops`)
  }
  log('remote access ended: a wrong PIN')
  remoteStop()
  broadcast({ ev: 'remote', text: 'Remote access stopped: a wrong PIN was typed on its page. Start it again for a new link and PIN.' })
  throw new Error('Wrong PIN: remote access stopped. Start it again on your Mac for a new link and PIN.')
}

// remote access past its time ends (main.ts asks every 15 s; tests move the clock)
export function remoteTick(now = Date.now()) {
  if (remote?.until && now >= remote.until) return remoteStop()
  // the tailnet's other devices online, again: a phone that came online clears Settings' "no other device" note
  const r = remote
  if (r?.via === 'tailscale' && !r.funnel)
    tsReady().then(
      ({ peers }) => r === remote && peers !== r.peers && ((r.peers = peers), changed()),
      () => {},
    )
}
