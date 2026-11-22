// L7: an address on the internet, by what a name resolves to, not by the name: the picture proxy (main.ts imgPage)
// looks a host up, refuses it when any of its addresses is this Mac's, a private network's or none, then connects to the
// address it checked (a second lookup can't answer otherwise: DNS rebinding). Pure but for the lookup: test/net-addr.test.ts
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'
import { inRig } from './dir.ts'

// loopback, private, link-local, CGNAT, unique local, unspecified ("this network"), multicast, documentation, Teredo
// (2001::/32: an IPv4 inside, obfuscated) and NAT64's local-use 64:ff9b:1::/48; BlockList checks an IPv4 mapped in IPv6
// (::ffff:127.0.0.1) by its IPv4 rules too. NAT64's 64:ff9b::/96 and 6to4's 2002::/16 go by the IPv4 they carry: a
// network with a NAT64 gateway or a 6to4 relay reaches its LAN's through them
const NO = new BlockList()
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.2.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4]] as const) NO.addSubnet(a, n, 'ipv4')
for (const [a, n] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001::', 32], ['2001:db8::', 32], ['64:ff9b:1::', 48], ['::', 96], ['::ffff:0:0:0', 96]] as const) NO.addSubnet(a, n, 'ipv6') // ::/96: IPv4-compatible, ::ffff:0:a.b.c.d: IPv4-translated (no public address in either)
// an IPv6 address's eight 16-bit groups (isIP said it's one): :: filled in, a dotted IPv4 at its end as two groups
const groups = (ip: string) => {
  const [l, r] = ip
    .replace(/%.*$/, '')
    .replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`)
    .split('::')
  const L = l ? l.split(':') : []
  const R = r ? r.split(':') : []
  return [...L, ...(r === undefined ? [] : Array(8 - L.length - R.length).fill('0')), ...R].map(h => parseInt(h, 16))
}
const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
export const addrPrivate = (ip: string): boolean => {
  const v = isIP(ip)
  if (!v) return true // not an address: refused too
  if (NO.check(ip, v === 6 ? 'ipv6' : 'ipv4')) return true
  if (v === 4) return false
  const g = groups(ip)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => !x)) return NO.check(v4(g[6], g[7]), 'ipv4') // NAT64: the last 32 bits
  return g[0] === 0x2002 && NO.check(v4(g[1], g[2]), 'ipv4') // 6to4: bits 16 to 48
}

type Look = (host: string) => Promise<LookupAddress[]>
// the rig's resolver (LAKI_TEST_DNS: { name: address }), only in its daemon (dir.ts inRig): a test names a host that
// resolves to this Mac without DNS
const looks: Look = h => {
  const fake = inRig() && process.env.LAKI_TEST_DNS ? (JSON.parse(process.env.LAKI_TEST_DNS) as Record<string, string>)[h] : undefined
  return fake ? Promise.resolve([{ address: fake, family: isIP(fake) }]) : lookup(h, { all: true })
}

// a host's address to connect to, every one it has on the internet, else it throws
export async function publicAddr(host: string, look: Look = looks): Promise<LookupAddress> {
  const h = host.replace(/^\[|\]$/g, '')
  const all = isIP(h) ? [{ address: h, family: isIP(h) }] : await look(h)
  if (!all.length || all.some(a => addrPrivate(a.address))) throw new Error(`${host} isn't on the internet`)
  return all[0]
}

// GET an https URL at the address publicAddr checked: the name stays the TLS server name and the Host header
export async function getPublic(u: string, signal: AbortSignal, headers: Record<string, string>): Promise<IncomingMessage> {
  const url = new URL(u)
  if (url.protocol !== 'https:') throw new Error('https only')
  const at = await publicAddr(url.hostname)
  return new Promise((ok, fail) => {
    const req = request(url, { signal, headers, lookup: (_h, o, cb) => (o.all ? cb(null, [at]) : cb(null, at.address, at.family)) }, ok)
    req.on('error', fail)
    req.end()
  })
}

// getPublic, its redirects followed: at most 5, each to https and its address checked again as the first was (an
// extension's URL source: a public host answering 302 to this Mac, a router or 169.254.169.254 is refused). get: the
// tests' stand-in for the first hop
export async function getFollow(u: string, signal: AbortSignal, headers: Record<string, string>, get = getPublic): Promise<IncomingMessage> {
  let url = u
  for (let hops = 0; ; hops++) {
    const res = await (hops ? getPublic : get)(url, signal, headers)
    const to = res.headers.location
    if (!res.statusCode || res.statusCode < 300 || res.statusCode > 399 || !to) return res
    res.resume()
    if (hops === 5) throw new Error('more than 5 redirects')
    const next = new URL(to, url)
    if (next.protocol !== 'https:') throw new Error(`a redirect to ${next.protocol}// refused: https only`)
    url = next.href
  }
}
