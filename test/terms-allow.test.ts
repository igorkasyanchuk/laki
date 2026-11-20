// S1: the terminals you allowed to act as you (core.ts termList, termRevoke): Settings › Security › Terminals lists them,
// Revoke makes the next call from one ask again; only Laki's window reads or changes them
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { connect, fresh, seen, until } from './helpers.ts'

test('S1: an allowed terminal is listed with its tty, what started it and its last call; Revoke asks it again; only the window lists or revokes', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  const laki = `${process.execPath} --experimental-strip-types --no-warnings ${fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))}`
  const go = join(rig.home, 'go')
  // one terminal (sh under script, its session's leader) for two calls, the second once the test says go
  const c = spawn('script', ['-q', '/dev/null', 'sh', '-c', `${laki} rename ${ws.id} first; while [ ! -f ${go} ]; do sleep 0.1; done; ${laki} rename ${ws.id} second`], { env: rig.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  c.stdout.on('data', d => (out += d))
  const ended = new Promise(ok => c.on('exit', ok))
  t.after(() => c.kill())
  const app = await connect(rig)
  const name = async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id).name
  let ask: any = await seen(app, (e: any) => e.ev === 'termAsk', 'the first call asks')
  await app.call('termAnswer', { req: ask.req, allow: true })
  await until(async () => (await name()) === 'first', 'its first call passed')
  const list: any[] = await app.call('termList')
  const row = list.find(x => x.tty === ask.tty && !x.start)
  assert.ok(row, JSON.stringify(list))
  assert.ok(row.cmd && row.chain.includes('script') && row.at > 0 && row.lastAt >= row.at, JSON.stringify(row))
  // nobody else's to read or change: an agent's, a call with daemon.json's token
  await assert.rejects(rig.rpc('termList', { from: { ws: ws.id, tab } }), /only Laki's window allows a terminal|an agent can't/)
  const { port, token } = rig.info()
  const plain = async (method: string, params = {}) => (await (await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params }) })).json()).error
  assert.match(await plain('termList'), /only Laki's window allows a terminal/)
  assert.match(await plain('termRevoke', { key: row.key }), /only Laki's window allows a terminal/)
  await assert.rejects(app.call('termRevoke', { key: 'nope' }), /no such terminal/)
  for (const s of list.filter(x => x.start)) await assert.rejects(app.call('termRevoke', { key: s.key }), /started Laki stays/)
  // revoked: gone from the list, and the same terminal's next call asks again
  await app.call('termRevoke', { key: row.key })
  assert.ok(!((await app.call('termList')) as any[]).some(x => x.key === row.key))
  const at = app.events.length
  writeFileSync(go, '')
  ask = await until(() => app.events.slice(at).find((e: any) => e.ev === 'termAsk') as any, 'asked again')
  assert.equal(ask.tty, row.tty)
  await app.call('termAnswer', { req: ask.req, allow: false })
  await ended
  assert.match(out, /isn't allowed to act as you yet/)
  assert.equal(await name(), 'first')
  app.close()
})
