// L7: the picture proxy's address check (daemon/netAddr.ts): this Mac's, a private network's, none, by what a name
// resolves to. No daemon: test:fast (api.test.ts has the proxy's refusal of a name that resolves to 127.0.0.1)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addrPrivate, publicAddr } from '../src/daemon/netAddr.ts'

test("addrPrivate: loopback, private, link-local, CGNAT, unique local, unspecified, IPv4 in IPv6; the internet's goes", () => {
  for (const a of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'not an address', ''])
    assert.equal(addrPrivate(a), true, a)
  for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2606:4700::1111', '::ffff:8.8.8.8', 'fec0::1'])
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
