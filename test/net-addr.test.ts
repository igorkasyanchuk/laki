// L7: the picture proxy's address check (daemon/netAddr.ts): this Mac's, a private network's, none, by what a name
// resolves to. No daemon: test:fast (api.test.ts has the proxy's refusal of a name that resolves to 127.0.0.1)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { addrPrivate, getFollow, localUrl, publicAddr } from '../src/daemon/netAddr.ts'

test("addrPrivate: loopback, private, link-local, CGNAT, unique local, unspecified, IPv4 in IPv6; the internet's goes", () => {
  for (const a of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'not an address', ''])
    assert.equal(addrPrivate(a), true, a)
  for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2606:4700::1111', '::ffff:8.8.8.8', 'fec0::1'])
    assert.equal(addrPrivate(a), false, a)
})

test('addrPrivate: NAT64 and 6to4 by the IPv4 they carry; Teredo, documentation, multicast and local-use NAT64 refused', () => {
  for (const a of ['64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a00:1', '2002:c0a8:101::', '2002:7f00:1:1::1', '2001::1', '2001:0:4136:e378::1', '2001:db8::1', 'ff02::1', 'ff0e::1', '64:ff9b:1::808:808', '224.0.0.1', '239.255.255.250', '192.0.2.1', '198.51.100.7', '203.0.113.9', '::7f00:1', '::127.0.0.1', '::808:808', '::ffff:0:7f00:1', '::ffff:0:8.8.8.8'])
    assert.equal(addrPrivate(a), true, a)
  for (const a of ['64:ff9b::808:808', '64:ff9b::8.8.8.8', '2002:808:808::', '2002:808:808:1::1', '2001:4860::8888', '64:ff9b:0:1::7f00:1', '223.255.255.255'])
    assert.equal(addrPrivate(a), false, a)
})

test('publicAddr: every address of a name on the internet, or it throws; an IP literal as it is', async () => {
  const dns = (m: Record<string, string[]>) => async (h: string) => (m[h] ?? []).map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
  const look = dns({ 'pics.example': ['93.184.216.34'], 'both.example': ['93.184.216.34', '127.0.0.1'], 'rebind.example': ['::1'], 'v6.example': ['2606:4700::1111'] })
  assert.deepEqual(await publicAddr('pics.example', look), { address: '93.184.216.34', family: 4 })
  assert.deepEqual(await publicAddr('v6.example', look), { address: '2606:4700::1111', family: 6 })
  assert.deepEqual(await publicAddr('[2606:4700::1111]', look), { address: '2606:4700::1111', family: 6 })
  for (const h of ['both.example', 'rebind.example', 'none.example', '127.0.0.1', '[::1]']) await assert.rejects(publicAddr(h, look), /isn't on the internet/, h)
})

test("getFollow: a public host's redirect to this Mac, a private network or plain http is refused; past 5, refused", async () => {
  const hop = (location: string) => async () => Object.assign(new PassThrough(), { statusCode: 302, headers: { location } }) as unknown as IncomingMessage
  const signal = AbortSignal.timeout(5000)
  await assert.rejects(getFollow('https://pub.example/x', signal, {}, hop('https://127.0.0.1:9/')), /127.0.0.1 isn't on the internet/)
  await assert.rejects(getFollow('https://pub.example/x', signal, {}, hop('https://[::1]/')), /isn't on the internet/)
  await assert.rejects(getFollow('https://pub.example/x', signal, {}, hop('https://169.254.169.254/latest/meta-data')), /169.254.169.254 isn't on the internet/)
  await assert.rejects(getFollow('https://pub.example/x', signal, {}, hop('http://8.8.8.8/')), /redirect to http:\/\/ refused: https only/)
  const ok = Object.assign(new PassThrough(), { statusCode: 200, headers: {} }) as unknown as IncomingMessage
  assert.equal(await getFollow('https://pub.example/x', signal, {}, async () => ok), ok, 'no redirect: the answer itself')
})

test("localUrl: this Mac by the URL's parsed host, never a userinfo's localhost@ or a URL that won't parse", () => {
  for (const u of ['http://localhost:3000/x', 'https://127.0.0.1/', 'http://[::1]:8080/a']) assert.equal(localUrl(u), true, u)
  for (const u of ['https://localhost:1@evil.example/', 'https://localhost.evil.example/', 'http://{{config.host}}/', 'file://localhost/etc/hosts', 'localhost:3000']) assert.equal(localUrl(u), false, u)
})
