// what goes out through a tunnel: a port exposed to the world, a tab shared as a page, and remote access to the whole
// app (cloudflared or tailscale). core.ts imports it, and its users import it directly.

import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { readJson } from '../shared/conn.ts'
import { type Agent, AGENT_NAMES, type Remote, type RemoteDevice, REMOTE_TRIES, type SavedDevice, type Tunnel } from '../shared/types.ts'
import { broadcast, changed, findWs, firstLine, log, onPath, projectConfig, resolveTarget, run, save, screen, settingsSet, state } from './core.ts'
import { dir } from './dir.ts'
import { policyRemote } from './policy.ts'
import { type Tail, tailOf } from './meters.ts'
import { b64u, type Passkey, register, verifyGet } from './passkey.ts'
import { phoneRemote } from './phone.ts'
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

// the webhook server's public address (inbound.ts): a quick cloudflared tunnel to its port, or tailscale funnel (on the
// internet, so GitHub reaches it). ponytail: funnel takes port 443's root, as remote access over tailscale does
export async function hookPublish(port: number, via: 'cloudflared' | 'tailscale', ended: (why: string) => void) {
  policyRemote('a public address for webhooks')
  const who: [string, string] = ['Webhooks', 'hooks:expose']
  if (via === 'tailscale') return tailscale((await tsReady()).bin, `http://127.0.0.1:${port}`, ended, who, true)
  await cfReady(false)
  return cloudflare(`http://localhost:${port}`, [], ended, who)
}

// tunnelStart resolves once cloudflared prints the URL (a permanent one's: once its connector is up), or was stopped
// meanwhile, and fails with its output. hours: how long a quick one runs, as a shared tab's (SHARE_HOURS; unset: 8, so a
// forgotten one doesn't stay open for good). host: a permanent one at that name under settings.tunnel's domain (a word,
// or the whole hostname), until it's stopped
export async function tunnelStart(o: { ws: string; port: number; mails?: string[]; hours?: number; host?: string }): Promise<Tunnel> {
  policyRemote('a public address (Expose to the world)') // a managed policy's remote: false
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
  exposeRule(ws, mails)
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
// S7: a project's expose (Settings › the project, a trusted .laki.json: who gets in) is the rule for every caller: only
// those addresses and domains (a bare domain is *@ it), never anyone with the link
function exposeRule(ws: { name?: string; id: string }, mails: string[]) {
  const only = (projectConfig(ws as Parameters<typeof projectConfig>[0]).expose ?? '').split(/[\s,;]+/).map(m => m.trim().toLowerCase()).filter(Boolean).map(m => (m.includes('@') ? m : `*@${m}`))
  if (!only.length) return
  const ok = (m: string) => only.includes(m.toLowerCase()) || only.some(x => x.startsWith('*@') && m.toLowerCase().endsWith(x.slice(1)))
  const out = mails.length ? mails.find(m => !ok(m)) : 'anyone with the link'
  if (out) throw new Error(`${ws.name ?? ws.id}'s project lets in only ${only.join(', ')} (its expose), not ${out}`)
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
    if (remote?.host === host) throw new Error(`${host} is taken: remote access's (My domain)`)
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
type Connector = { cf: Cf; key: string; ready: Promise<void>; up?: boolean }
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
  // remote access on My domain (D1): the daemon itself, on this connector too, while its record goes to this tunnel
  const far = remote?.host && n && remote.named === n.name ? remote : undefined
  if (remote?.host && !far) Object.assign(remote, { down: n ? `its DNS record goes to your tunnel ${remote.named}, not ${n.name}: stop remote access and start it again` : 'no named tunnel set: Settings › Tunnels' }), changed()
  const ins = [...list.map(t => [t.host!, `http://localhost:${t.port}`]), ...(far ? [[far.host!, `http://127.0.0.1:${daemonPort}`]] : [])]
  const key = JSON.stringify([n?.name, ins])
  if (conn?.key === key) return conn.ready
  clearTimeout(connTimer)
  conn?.cf.stop()
  conn = undefined
  if (!ins.length) return Promise.resolve()
  if (!n) {
    for (const t of list) t.down = 'no named tunnel set: Settings › Tunnels'
    changed()
    return Promise.reject(new Error('permanent tunnels: set your named tunnel and its domain in Settings › Tunnels first'))
  }
  const folder = join(dir, 'cloudflared')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const file = join(folder, 'ingress.yml')
  writeFileSync(file, `# Laki's permanent tunnels (Settings › Tunnels): written each time one starts or stops\ningress:\n${ins.map(([h, to]) => `  - hostname: ${h}\n    service: ${to}\n`).join('')}  - service: http_status:404\n`, { mode: 0o600 })
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
        me.up = true
        if (far && remote === far) far.down = undefined // up: the page reconnects at its own address
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
  if (remote?.host) remote.down = why
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
  if (permanent && !ws && remote?.host) remoteStop('its tunnel stopped') // the connector's stop: remote access on My domain went with it
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
  policyRemote('sharing a tab') // a managed policy's remote: false
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

// ---------- remote access: this daemon, and the app's page it serves (main.ts), at an address of its own: a quick
// tunnel (a random trycloudflare.com URL, new each start) for the one email in Settings (Cloudflare Access sends it a
// one-time code), and the link carries a token of its own (open: no email, asked for in so many words (Settings' typed
// confirm), the token the only lock: anyone with the link; pin: no email either, the link's key and a PIN Laki shows
// here, typed on the page (remotePin), give the page its token, and a wrong PIN settings.remoteTries times stops it).
// Or a stable one (a bookmark keeps working): your tailnet (tailscale serve), or My domain (D1: a hostname of your named
// tunnel, settings.tunnel, through the permanent tunnels' connector; with a PIN always: cloudflared can't set a Cloudflare
// Access policy, that's the dashboard's). It ends after the hours asked for (remoteTick; 0: forever, no until), on
// remoteStop or a wrong PIN's stop: those are final. Its cloudflared or tailscale ending on its own, or the daemon's
// restart, starts it again (D2: AGAIN apart, then a minute each time; state.remote: how, until when, the page's token's
// hash): a quick tunnel at a new address, with a new link (the old one is dead); a stable one as it was, so the page
// reconnects by itself.
export const REMOTE_HOURS = [1, 2, 4, 8, 12, 24, 48, 72, 0]
const ONE_MAIL = /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/ // one address: no *@domain
// token: the link's, good once, for remotePin only (L3): it gives the page access, the token it connects with (pin: with
// the PIN), and is dead then (used); access: that token's hash (the token itself is the page's alone); left: wrong tries
// left; host, named: My domain's hostname and the named tunnel its DNS record goes to; tries, was, down, timer: started
// again (remoteAgain), its address before, why it's down
type RemoteRun = { mail: string; open?: boolean; until?: number; token: string; url?: string; cf?: Cf; pin?: string; access: string; used?: boolean; left?: number; via?: 'tailscale'; funnel?: boolean; peers?: number; host?: string; named?: string; tries: number; was?: string; moved?: boolean; down?: string; timer?: ReturnType<typeof setTimeout>; keyUntil?: number; lockUntil?: number; locks?: number; wrong?: number[] } // keyUntil: an Add a device link's 10 minutes; lockUntil, locks: D5's wait, how many this start; wrong: today's wrong PINs' times
let remote: RemoteRun | undefined
export let daemonPort = 0
export const setDaemonPort = (p: number) => (daemonPort = p)
const hashOf = (t: string) => createHash('sha256').update(t).digest('hex')
// the page's token (remote access's origin only): the one remotePin gave, while it runs
export const accessOk = (t: unknown) => !!remote?.used && !!remote.access && typeof t === 'string' && !!t && same(hashOf(t), remote.access)
export const remoteOrigin = () => remote?.url // the page's origin, once there's a URL
export const remoteView = (): Remote | undefined =>
  remote && { mail: remote.mail, ...(remote.via && { via: remote.via, funnel: remote.funnel, peers: remote.peers }), ...(remote.host && { host: remote.host }), ...(remote.open && { open: true }), ...(remote.pin && { pin: remote.pin, tries: remote.left }), ...(remote.used && { used: true }), ...(remote.down && { down: remote.down }), ...(remote.moved && remote.was && { was: remote.was }), ...(remote.lockUntil && { locked: remote.lockUntil }), ...(remote.wrong?.length && { wrong: remote.wrong.length }), ...(remote.keyUntil && !remote.used && { pairUntil: remote.keyUntil }), until: remote.until, url: remote.url, link: remote.url && `${remote.url}/#t=${remote.token}` } // S11: in the hash: never sent in a request, so no log or proxy has it
const triesOf = () => (n => (Number.isInteger(n) && n >= 1 && n <= 10 ? n : REMOTE_TRIES))(Number(state.settings?.remoteTries))
const newPin = () => String(randomInt(0, 1e6)).padStart(6, '0')
const hex = () => randomBytes(32).toString('hex')

// state.json's copy (D2): how it runs and until when, and the page's token's hash once it has one (a stable address's
// page reconnects with it after a restart); never a token or the PIN
function keepRemote() {
  const r = remote
  if (!r) return
  state.remote = { mail: r.mail, ...(r.open && { open: true }), ...(r.pin && { pin: true }), ...(r.via && { via: r.via, ...(r.funnel && { funnel: true }) }), ...(r.host && { host: r.host, named: r.named }), ...(r.until && { until: r.until }), ...(r.used && r.access && { access: r.access }), ...((r.url ?? r.was) && { url: r.url ?? r.was }) }
  save()
}
const forget = () => state.remote && (delete state.remote, save())

// via tailscale: tailscale serve instead of cloudflared, the tailnet's devices only, no email (a PIN as well, if asked);
// funnel: tailscale funnel, on the internet, so with a PIN only. host (D1, via cloudflare): My domain, that word (or
// hostname) under settings.tunnel's domain ('': laki), a PIN always
export async function remoteStart(o: { hours: number; mail?: string; open?: boolean; pin?: boolean; via?: string; funnel?: boolean; host?: string }): Promise<Remote | undefined> {
  policyRemote() // a managed policy may turn it off
  const hours = o.hours // a number: null or '' would be 0, forever
  if (typeof hours !== 'number' || !REMOTE_HOURS.includes(hours)) throw new Error(`for how long: ${REMOTE_HOURS.filter(Boolean).join(', ')} hours, or 0 (until stopped)`)
  if (o.via !== undefined && o.via !== 'cloudflare' && o.via !== 'tailscale') throw new Error(`through cloudflare or tailscale, not ${o.via}`)
  const ts = o.via === 'tailscale'
  if (o.host !== undefined && (ts || typeof o.host !== 'string')) throw new Error('My domain is through cloudflare: a name under your named tunnel’s domain')
  const n = o.host === undefined ? undefined : named()
  if (o.host !== undefined && !n) throw new Error('My domain: set your named tunnel and its domain in Settings › Tunnels first')
  const host = n && hostOf(o.host || 'laki', n.domain)
  const pin = o.pin === true || !!host // Laki's PIN, no email; My domain's always
  const funnel = ts && o.funnel === true
  if (funnel && !pin) throw new Error('Funnel puts it on the internet: only with a PIN')
  const open = !ts && !pin && o.open === true && !o.mail?.trim() // no email: only when asked for (an email given wins)
  const mail = ts || open || pin ? '' : (o.mail ?? state.settings?.remoteMail ?? '').trim()
  if (!ts && !open && !pin && !ONE_MAIL.test(mail)) throw new Error(mail ? `not an email address: ${mail}` : 'the email that may open it: Settings › Remote access')
  if (open && (!hours || hours > 24)) throw new Error('without an email, 24 hours at most: anyone with the link gets in')
  if (mail && mail !== state.settings?.remoteMail) settingsSet({ remoteMail: mail }) // open and pin keep the saved one
  if (remote) return remoteView()
  if (host) {
    const t = [...tunnels.values()].find(x => x.host === host)
    if (t) throw new Error(`${host} is taken: ${t.ws}'s :${t.port} (Expose to the world)`)
  }
  await reaping.catch(() => {})
  const { bin, peers } = ts ? await tsReady() : (await cfReady(!!mail), { bin: '', peers: 0 })
  if (host) await routeDns(n!.name, host) // its DNS record: made once, this tunnel's (never over another's)
  if (remote) return remoteView() // started meanwhile
  const r: RemoteRun = { mail, until: hours ? Date.now() + hours * 3600e3 : undefined, token: hex(), access: '', tries: 0, ...(open && { open: true }), ...(ts && { via: 'tailscale' as const, funnel, peers }), ...(host && { host, named: n!.name }) }
  if (pin) Object.assign(r, { pin: newPin(), left: triesOf() })
  remote = r
  changed()
  try {
    r.url = await remoteUp(r, bin)
  } catch (e) {
    if (remote === r) remoteStop()
    throw e
  }
  if (remote !== r) return undefined // stopped meanwhile
  keepRemote()
  phoneRemote(`Laki: remote access is on${r.pin ? ' (its PIN is on your Mac)' : ''}: tap to open it`, { url: remoteView()?.link, open: r.open })
  log(`remote access at ${r.url} for ${ts ? `${funnel ? 'the internet (Tailscale Funnel)' : `the tailnet's devices (${peers} more online)`} with the link${pin ? ' and its PIN' : ''}` : mail || (pin ? `the link and its PIN (${r.left} wrong tries stop it)` : 'anyone with the link (no email)')}, ${r.until ? `until ${new Date(r.until).toISOString()}` : 'until stopped'}`)
  changed()
  return remoteView()
}

// its address: cloudflared's or tailscale's (a child of its own, remoteAgain when it ends), or My domain's through the
// permanent tunnels' connector (connect: its ingress has it; it starts itself again). bin: tailscale's, from
// remoteStart's check (else checked here: a restart's)
async function remoteUp(r: RemoteRun, bin?: string): Promise<string | undefined> {
  const target = `http://127.0.0.1:${daemonPort}`
  if (r.host) {
    await connect()
    if (remote === r && conn) await conn.ready // started again meanwhile (a tunnel's change): this one has it too
    if (remote !== r) return undefined
    if (!conn?.up || !conn.key.includes(JSON.stringify(r.host))) throw new Error(r.down ?? "cloudflared's connector isn't up")
    return `https://${r.host}`
  }
  const what = r.via ? `tailscale ${r.funnel ? 'funnel' : 'serve'}` : 'cloudflared'
  const ended = (why: string) => remoteAgain(r, `${what} ended (${why})`)
  if (r.via && !bin) {
    const ts = await tsReady()
    bin = ts.bin
    r.peers = ts.peers
  }
  if (remote !== r) return undefined
  const p = r.via ? tailscale(bin!, target, ended, ['Remote access', 'remote'], r.funnel) : cloudflare(target, r.mail ? [r.mail] : [], ended, ['Remote access', 'remote'])
  r.cf = p.cf
  return p.url
}

// D2: down on its own (its process ended, or a restart's start failed): started again, AGAIN apart, then once a minute
function remoteAgain(r: RemoteRun, why: string) {
  if (remote !== r) return
  if (r.tries < AGAIN.length) log(`remote access: ${why}; starting it again`) // then quiet: down says why
  Object.assign(r, { was: r.url ?? r.was, url: undefined, down: why, cf: undefined, moved: false })
  changed()
  clearTimeout(r.timer)
  r.timer = setTimeout(() => {
    if (remote !== r) return
    void remoteUp(r).then(
      u => remoteAt(r, u),
      e => remoteAgain(r, firstLine(e)),
    )
  }, AGAIN[Math.min(r.tries++, AGAIN.length - 1)])
  r.timer.unref?.()
}
// up again at u: the same address (stable: Tailscale, My domain) goes on as it was, and the page reconnects; a quick
// tunnel's new one has a new link (and PIN): the old one's page is at an origin that's gone
function remoteAt(r: RemoteRun, u: string | undefined) {
  if (remote !== r || !u) return
  const was = r.was
  Object.assign(r, { url: u, down: undefined, tries: 0, moved: !!was && was !== u })
  if (r.moved) {
    Object.assign(r, { token: hex(), access: '', used: false, ...(r.pin && { pin: newPin(), left: triesOf() }) })
    log(`remote access: back at ${u} (was ${was}): a new link`)
    phoneRemote(`Laki: remote access moved to a new address${r.pin ? ' with a new PIN (on your Mac)' : ''}: tap to open it`, { url: remoteView()?.link, open: r.open })
    broadcast({ ev: 'remote', text: 'Remote access is back at a new address: open its new link from Settings › Remote access (the old one has ended).' })
  } else log(`remote access: back at ${u}`)
  keepRemote()
  changed()
}

// as the daemon starts (main.ts, before tunnelsBack): remote access state.json kept, started again unless its time has
// passed. Stable, its page's token still good; a link not opened yet: a new one (and PIN), as the old one's key went
// with the daemon
export function remoteBack(now = Date.now()) {
  const s = state.remote
  if (!s || remote) return
  try {
    policyRemote()
  } catch {
    return forget()
  }
  const ts = s.via === 'tailscale'
  const mail = typeof s.mail === 'string' ? s.mail : ''
  if ((s.until && s.until <= now) || (!ts && !s.pin && !s.open && !s.host && !ONE_MAIL.test(mail)) || (s.host !== undefined && (typeof s.host !== 'string' || typeof s.named !== 'string'))) return forget()
  const r: RemoteRun = { mail: ts || s.pin || s.open ? '' : mail, until: typeof s.until === 'number' ? s.until : undefined, token: hex(), access: typeof s.access === 'string' ? s.access : '', used: typeof s.access === 'string', tries: 0, was: typeof s.url === 'string' ? s.url : undefined, down: 'starting again after a restart', ...(s.open && { open: true }), ...(ts && { via: 'tailscale' as const, funnel: !!s.funnel }), ...(s.host && { host: s.host, named: s.named }) }
  if (s.pin || s.host) Object.assign(r, { pin: newPin(), left: triesOf() })
  remote = r
  log('remote access: starting again after a restart')
  changed()
  void reaping
    .catch(() => {})
    .then(() => remoteUp(r))
    .then(
      u => remoteAt(r, u),
      e => remoteAgain(r, firstLine(e)),
    )
}

// stopped for good: by you, a wrong PIN's stop, its time up; why: on its own (your phone hears it, D4), not by you
export function remoteStop(why?: string) {
  const r = remote
  if (!r) return
  if (why) phoneRemote(`Laki: remote access stopped: ${why}`, { open: r.open })
  remote = undefined
  clearTimeout(r.timer)
  r.cf?.stop()
  if (r.host) void connect().catch(() => {}) // My domain's off the connector's ingress
  forget()
  changed()
}
// shutdown: its process stopped, state.remote kept for the next start (remoteBack)
export function remoteDown() {
  const r = remote
  remote = undefined
  if (r) clearTimeout(r.timer), r.cf?.stop()
}

// a secret compared in constant time (none wanted: no; main.ts' tokens too), as bytes: a multibyte one as long in
// characters isn't timingSafeEqual's throw
export function same(a: string, b: string | undefined) {
  if (!b) return false
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}
// ---------- trusted devices (D3): at a stable address (Tailscale, My domain) the page that opens a link (after its PIN)
// is paired: a device token of its own (32 random bytes) in an HttpOnly, Secure, SameSite=Strict cookie the daemon sets
// on that origin (no script reads it), kept by the daemon as its hash only (state.remoteDevices: id, name from the user
// agent, added, last seen, until: settings.remoteDeviceDays, 30 by default, 1 to 90). Its WebSocket and /rpc calls get
// in by it (main.ts, with the Origin check as ever), several at once; a closed tab or a restart doesn't matter. Add a
// device (remotePair) makes a new link, 10 minutes and one use. Revoke drops its connections at once (main.ts' onGone);
// remoteStop keeps them (nothing connects meanwhile), Forget devices (revoke all) clears them. A quick tunnel's page keeps
// one tab's token instead (its address is new each start)
const DEVICE_COOKIE = '__Host-laki-device'
const PAIR_MS = 10 * 60e3
const stable = (r: RemoteRun) => !!(r.host || r.via)
const deviceDays = () => (n => (Number.isInteger(n) && n >= 1 && n <= 90 ? n : 30))(Number(state.settings?.remoteDeviceDays))
export const remoteDevices = (): RemoteDevice[] | undefined => (state.remoteDevices?.length ? state.remoteDevices.map(({ hash: _, push, pk, regUntil: __, ...d }) => ({ ...d, ...(push && { notify: true }), ...(pk && { passkey: true }) })) : undefined) // never its hash, its push keys or its passkey
let gone: (ids: string[]) => void = () => {}
export const onGone = (f: (ids: string[]) => void) => void (gone = f) // main.ts: a revoked or expired device's sockets closed
const cookieOf = (header: string | undefined) => {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === DEVICE_COOKIE) return part.slice(at + 1).trim()
  }
}
// its user agent in two words: what it is, its browser (shown, never trusted)
const deviceName = (ua = '') => {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|CrOS/.test(ua) ? 'Linux' : 'A device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return browser ? `${os} · ${browser}` : os
}
// a remote connection's device by its cookie: while remote access runs at a stable address, not expired; its id (every
// remote connection knows it: the activity log's). Its last seen kept a minute apart at most
export function deviceOf(cookie: string | undefined, now = Date.now()): string | undefined {
  const r = remote
  const t = cookieOf(cookie)
  if (!r?.url || !stable(r) || !t || !/^[0-9a-f]{64}$/.test(t)) return undefined
  const h = hashOf(t)
  const d = state.remoteDevices?.find(x => same(h, x.hash))
  if (!d || d.until <= now) return undefined
  if (now - d.seenAt > 60000) (d.seenAt = now), save(), changed()
  return d.id
}
// M4: the page as an app (main.ts' manifest and service worker) only at a stable address: an installed app keeps its
// origin, and its device's cookie is its way back in after each start (a quick tunnel's address is new each time)
export const pwaOn = () => !!remote?.url && stable(remote)
export const remoteOn = () => !!remote?.url
// a paired device's Web Push subscription (push.ts subOk: a browser vendor's push service), kept on it; undefined: off
export function devicePush(id: string, sub: { endpoint: string; p256dh: string; auth: string } | undefined) {
  const d = state.remoteDevices?.find(x => x.id === id)
  if (!d) throw new Error('not a paired device')
  if (sub ? d.push?.endpoint === sub.endpoint && d.push.p256dh === sub.p256dh && d.push.auth === sub.auth : !d.push) return // as it was (the page sends it at each start)
  if (sub) d.push = { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }
  else delete d.push
  save()
  log(`remote access: ${d.name} (${d.id}) turned notifications ${sub ? 'on' : 'off'}`)
  changed()
}
function pair(r: RemoteRun, o: Asker) {
  const t = hex()
  const now = Date.now()
  const d = { id: randomUUID().slice(0, 8), name: deviceName(o.ua), hash: hashOf(t), addedAt: now, seenAt: now, until: now + deviceDays() * 86400e3, ...(passkeyOn() && { regUntil: now + REG_MS }) }
  state.remoteDevices = [...(state.remoteDevices ?? []), d]
  Object.assign(r, { used: true, keyUntil: undefined })
  keepRemote() // saves
  log(`remote access: a new device, ${d.name} (${d.id})${o.ip ? ` from ${o.ip}` : ''}, until ${new Date(d.until).toISOString()}`)
  broadcast({ ev: 'remote', text: `A new device joined remote access: ${d.name}${o.ip ? ` (${o.ip})` : ''}. Settings › Remote access › Devices lists it: Revoke it there if it isn't yours.` })
  phoneRemote(`Laki: a new device joined remote access: ${d.name}${o.ip ? ` (${o.ip})` : ''}. Revoke it on your Mac if it isn't yours`, { open: r.open })
  changed()
  return { need: false, device: true, cookie: `${DEVICE_COOKIE}=${t}; Path=/; Max-Age=${Math.floor((d.until - now) / 1000)}; HttpOnly; Secure; SameSite=Strict` }
}
// ---------- D6: passkeys. At a stable address (a quick tunnel's origin changes each start: a passkey is for one site)
// a just-paired device may set one up (REG_MS); from then on each of its pages starts locked, and locks again after
// remoteIdle minutes without a call (main.ts' Conn.locked: until then only these calls, no state, no events), until a
// passkey's signature (passkey.ts) or, unless turned off, the PIN. Challenges: random, single use, a minute
const REG_MS = 10 * 60_000
const CHALLENGE_MS = 60_000
const challenges = new Map<string, { device: string; kind: 'create' | 'get'; until: number }>()
export const passkeyOn = () => state.settings?.remotePasskey !== false
const deviceById = (id: string) => state.remoteDevices?.find(d => d.id === id)
// whether a device's pages lock: it has a passkey, passkeys are on, at a stable address
export const deviceLocks = (id: string) => passkeyOn() && !!remote?.url && stable(remote) && !!deviceById(id)?.pk
export const idleMs = () => (m => (Number.isFinite(m) && m >= 0 ? m : 15) * 60e3)(Number(state.settings?.remoteIdle ?? 15))
export const pinFallback = () => state.settings?.remotePinFallback !== false && !!remote?.pin
// a just-paired device's offer: set a passkey up now (its page asks)
export const passkeyOffer = (id: string) => (d => passkeyOn() && !!remote?.url && stable(remote) && !!d && !d.pk && (d.regUntil ?? 0) > Date.now())(deviceById(id))
const site = () => {
  if (!remote?.url || !stable(remote)) throw new Error('passkeys need a stable address (Tailscale or My domain)')
  return { origin: remote.url, rpId: new URL(remote.url).hostname }
}
function challengeFor(device: string, kind: 'create' | 'get') {
  const now = Date.now()
  for (const [k, c] of challenges) if (c.until <= now) challenges.delete(k)
  const c = b64u(randomBytes(32))
  challenges.set(c, { device, kind, until: now + CHALLENGE_MS })
  return c
}
// the challenge the browser signed (its clientDataJSON's), taken: used once, whatever the check says next
function taken(r: any, device: string, kind: 'create' | 'get') {
  let c: unknown
  try {
    c = JSON.parse(Buffer.from(String(r?.clientDataJSON ?? ''), 'base64url').toString('utf8'))?.challenge
  } catch {}
  const x = typeof c === 'string' ? challenges.get(c) : undefined
  if (typeof c === 'string') challenges.delete(c)
  if (!x || x.device !== device || x.kind !== kind || x.until <= Date.now()) throw new Error('passkey: that challenge is used or past its minute: try again')
  return c as string
}
const offered = (device: string) => {
  if (!passkeyOffer(device)) throw new Error('a passkey is set up just after pairing: pair this device again (Add a device on the Mac)')
}
export function passkeyOptions(device: string) {
  offered(device)
  const { rpId } = site()
  return { challenge: challengeFor(device, 'create'), rpId, user: { id: b64u(Buffer.from(device)), name: deviceById(device)!.name } }
}
export function passkeyRegister(device: string, r: unknown) {
  offered(device)
  const challenge = taken(r, device, 'create')
  const d = deviceById(device)!
  const pk: Passkey = register(r, { challenge, ...site() })
  d.pk = pk as SavedDevice['pk']
  delete d.regUntil
  save()
  log(`remote access: ${d.name} (${d.id}) unlocks with a passkey now`)
  changed()
  return { ok: true }
}
export function passkeyChallenge(device: string) {
  const d = deviceById(device)
  if (!d?.pk || !deviceLocks(device)) throw new Error('this device has no passkey')
  return { challenge: challengeFor(device, 'get'), rpId: site().rpId, id: d.pk.id, pin: pinFallback() }
}
// true: unlocked (main.ts opens the connection); a throw: why not
export function passkeyUnlock(device: string, r: unknown) {
  const d = deviceById(device)
  if (!d?.pk || !deviceLocks(device)) throw new Error('this device has no passkey')
  const challenge = taken(r, device, 'get')
  d.pk.count = verifyGet(r, { challenge, ...site(), key: d.pk as Passkey })
  save()
  return true
}
// Use PIN instead: remote access's PIN (shown on the Mac), its wrong ones counted as the link's are (D5)
export function passkeyPin(device: string, pin: unknown, o: Asker = {}) {
  const r = remote
  if (!r || !deviceLocks(device)) throw new Error('this device has no passkey')
  if (!pinFallback()) throw new Error('the PIN is off for unlocking: use the passkey')
  const now = Date.now()
  if (r.lockUntil && now < r.lockUntil) throw new Error(`Too many wrong PINs: try again in ${mins(r.lockUntil - now)}`)
  if (r.lockUntil) Object.assign(r, { lockUntil: undefined, left: triesOf() }) // the wait is over, as remotePin's
  if (pinIs(r, pin)) return true
  wrongPin(r, o, now)
}

// Add a device: a new link (and PIN), good for 10 minutes and one use; only at a stable address
export function remotePair(): Remote | undefined {
  const r = remote
  if (!r?.url) throw new Error("remote access isn't running")
  if (!stable(r)) throw new Error("devices need a stable address (Tailscale or My domain): a quick tunnel's link opens once, in one tab")
  Object.assign(r, { token: hex(), used: false, keyUntil: Date.now() + PAIR_MS, ...(r.pin && { pin: newPin(), left: triesOf(), lockUntil: undefined }) })
  changed()
  return remoteView()
}
// Revoke (one, by id) or Revoke all / Forget devices (all): its sockets closed at once (gone)
export function remoteDeviceRm(p: { id?: unknown; all?: unknown }) {
  const all = state.remoteDevices ?? []
  const out = p.all === true ? all : all.filter(d => d.id === p.id)
  if (!out.length && p.all !== true) throw new Error(`no device ${String(p.id)}`)
  const left = all.filter(d => !out.includes(d))
  if (left.length) state.remoteDevices = left
  else delete state.remoteDevices
  save()
  if (out.length) log(`remote access: ${out.map(d => `${d.name} (${d.id})`).join(', ')} revoked`), gone(out.map(d => d.id))
  changed()
  return { revoked: out.length }
}
// past their time: off the list, their sockets closed (remoteTick)
function devicesTidy(now: number) {
  const out = (state.remoteDevices ?? []).filter(d => d.until <= now)
  if (!out.length) return
  const left = (state.remoteDevices ?? []).filter(d => d.until > now)
  if (left.length) state.remoteDevices = left
  else delete state.remoteDevices
  save()
  log(`remote access: ${out.map(d => `${d.name} (${d.id})`).join(', ')} expired`)
  gone(out.map(d => d.id))
  changed()
}

// D5: once the tries are used, no PIN is taken for a while (Wait, settings.remoteWrong's default) instead of stopping
// (Stop: as before, so a link's holder could end it with two requests). 1 minute, then 5, then 30 each time, counted
// per start. Each wrong one is logged and told on the Mac with the time and the address the tunnel reports
// (CF-Connecting-IP, Tailscale's login: shown, never trusted). DAY_CAP: 20 wrong in a day stop it anyway, for every PIN
// mode: at 2 tries per lock and locks of 1, 5, 30, 30… minutes that's at most about 2 × 49 ≈ 98 guesses a day without
// it; with it, 20 a start out of 10^6 PINs (1 in 50,000), and only the Mac starts it again. Devices paired already
// aren't affected
const LOCKS = [1, 5, 30].map(m => m * 60e3)
const DAY_CAP = 20
const mins = (ms: number) => (m => `${m} minute${m === 1 ? '' : 's'}`)(Math.max(1, Math.ceil(ms / 60e3)))
const waits = () => state.settings?.remoteWrong !== 'stop'
type Asker = { cookie?: string; ua?: string; ip?: string } // the /pin request's: its cookie, user agent, the tunnel's address for it
export type PinAnswer = { need: boolean; left?: number; wait?: number; token?: string; device?: boolean; cookie?: string }
// the page's first ask (main.ts' POST /pin, from the page's origin): a paired device's cookie, else the link's key,
// once, for the page's way in (a quick tunnel's: need false and token, the token it connects with; a stable address's:
// device and its cookie, which main.ts sets; with a PIN: need, then the PIN gives it), after which the link is dead
// (need: false, nothing: a key that isn't the link's, a link opened before or past its 10 minutes). A wrong PIN counts
// down, then waits (D5) or stops it (remoteWrong: 'stop')
export function remotePin(p: { token?: unknown; pin?: unknown }, o: Asker = {}): PinAnswer {
  const r = remote
  if (!r) return { need: false }
  if (deviceOf(o.cookie)) return { need: false, device: true } // paired: no link, no PIN, no lock
  const now = Date.now()
  if (r.used || (r.keyUntil && now >= r.keyUntil) || typeof p.token !== 'string' || !same(p.token, r.token)) return { need: false }
  const use = (): PinAnswer => {
    if (stable(r)) return pair(r, o)
    const t = hex()
    Object.assign(r, { used: true, access: hashOf(t) })
    keepRemote()
    changed()
    return { need: false, token: t }
  }
  if (!r.pin) return use()
  if (r.lockUntil && now < r.lockUntil) {
    if (p.pin === undefined) return { need: true, left: 0, wait: r.lockUntil }
    throw new Error(`Too many wrong PINs: try again in ${mins(r.lockUntil - now)}`)
  }
  if (r.lockUntil) Object.assign(r, { lockUntil: undefined, left: triesOf() }) // the wait is over
  if (p.pin === undefined) return { need: true, left: r.left }
  if (pinIs(r, p.pin)) return use()
  wrongPin(r, o, now)
}
const pinIs = (r: RemoteRun, pin: unknown) => typeof pin === 'string' && !!r.pin && same(pin.normalize('NFKC').replace(/\s+/g, ''), r.pin)
// a wrong PIN (the link's, or D6's Use PIN instead): counted down, then a wait (D5) or a stop; always a throw
function wrongPin(r: RemoteRun, o: Asker, now: number): never {
  r.left = (r.left ?? 1) - 1
  r.wrong = [...(r.wrong ?? []).filter(t => now - t < 86400e3), now]
  const from = o.ip ? ` from ${o.ip}` : ''
  const at = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  log(`remote access: a wrong PIN${from} (${r.wrong.length} today)`)
  const end = (why: string, page: string) => {
    log(`remote access ended: ${why}`)
    remoteStop(why)
    broadcast({ ev: 'remote', text: `Remote access stopped: ${why} on its page${from} at ${at}. Start it again for a new link and PIN.` })
    throw new Error(page)
  }
  if (r.wrong.length >= DAY_CAP) end(`${DAY_CAP} wrong PINs today`, 'Too many wrong PINs today: remote access stopped. Start it again on your Mac.')
  if (r.left > 0) {
    broadcast({ ev: 'remote', text: `A wrong PIN was typed on remote access's page${from} at ${at}: ${r.left} more ${r.left === 1 ? 'try' : 'tries'} before ${waits() ? 'it waits' : 'it stops'}.` })
    changed()
    throw new Error(`Wrong PIN: ${r.left} more ${r.left === 1 ? 'try' : 'tries'}, then ${waits() ? `no PIN is taken for ${mins(LOCKS[Math.min(r.locks ?? 0, LOCKS.length - 1)])}` : 'remote access stops'}`)
  }
  if (!waits()) end('a wrong PIN', 'Wrong PIN: remote access stopped. Start it again on your Mac for a new link and PIN.')
  const lock = LOCKS[Math.min(r.locks ?? 0, LOCKS.length - 1)]
  Object.assign(r, { locks: (r.locks ?? 0) + 1, lockUntil: now + lock })
  log(`remote access: no PIN taken for ${mins(lock)} (${triesOf()} wrong${from})`)
  broadcast({ ev: 'remote', text: `Remote access takes no PIN for ${mins(lock)}: ${triesOf()} wrong ${triesOf() === 1 ? 'PIN' : 'PINs'} on its page${from} at ${at}. Paired devices stay in.` })
  changed()
  throw new Error(`Wrong PIN: no PIN is taken for ${mins(lock)}, then try again`)
}

// remote access past its time ends (main.ts asks every 15 s; tests move the clock). The timer's own ask (no now) also
// sees a Mac that slept (a minute or more since the last): a cloudflared address is fetched, and started again if it
// doesn't answer (Cloudflare's 5xx for a tunnel that's gone). Not Tailscale's: this Mac can't reach its own tailnet
// address, and its process ending says so already
let lastTick = 0
export function remoteTick(now?: number) {
  const at = now ?? Date.now()
  const woke = now === undefined && lastTick > 0 && at - lastTick > 60000
  if (now === undefined) lastTick = at
  if (remote?.until && at >= remote.until) return log('remote access ended: its time is up'), remoteStop('its time is up')
  const r = remote
  if (r?.lockUntil && at >= r.lockUntil) Object.assign(r, { lockUntil: undefined, left: triesOf() }), changed() // D5: the wait is over
  devicesTidy(at)
  if (woke && r?.url && !r.via) void awake(r)
  // the tailnet's other devices online, again: a phone that came online clears Settings' "no other device" note
  if (r?.via === 'tailscale' && !r.funnel)
    tsReady().then(
      ({ peers }) => r === remote && peers !== r.peers && ((r.peers = peers), changed()),
      () => {},
    )
}
async function awake(r: RemoteRun) {
  const up = await fetch(r.url!, { redirect: 'manual', signal: AbortSignal.timeout(15000) }).then(
    x => x.status < 500,
    () => false,
  )
  if (up || remote !== r || !r.url) return
  const why = 'not reachable after the Mac slept'
  if (r.host) {
    const c = conn
    if (c) c.cf.stop(), connDown(c, why)
    return
  }
  const cf = r.cf
  remoteAgain(r, why) // before the stop: its close then isn't an end of its own
  cf?.stop()
}
