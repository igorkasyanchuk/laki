// L7: an address on the internet, by what a name resolves to, not by the name: the picture proxy (main.ts imgPage)
// looks a host up, refuses it when any of its addresses is this Mac's, a private network's or none, then connects to the
// address it checked (a second lookup can't answer otherwise: DNS rebinding). Pure but for the lookup: test/net-addr.test.ts
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'
import { inRig } from './dir.ts'

// loopback, private, link-local, CGNAT, unique local, unspecified ("this network"); BlockList checks an IPv4 mapped in
// IPv6 (::ffff:127.0.0.1) by its IPv4 rules too. ponytail: NAT64's 64:ff9b::/96 and 6to4's 2002::/16, which carry an
// IPv4 inside, go by their own (public) range: a network with a NAT64 gateway could reach its LAN's through them
const NO = new BlockList()
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) NO.addSubnet(a, n, 'ipv4')
for (const [a, n] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) NO.addSubnet(a, n, 'ipv6')
export const addrPrivate = (ip: string) => {
  const v = isIP(ip)
  return !v || NO.check(ip, v === 6 ? 'ipv6' : 'ipv4') // not an address: refused too
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
