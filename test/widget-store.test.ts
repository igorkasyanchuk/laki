// M1: an extension's own key-value store: widgetStore's ops, its limits, a per-workspace one's per workspace, a
// script's store helper, laki widget store, the trash taking it, an agent's write asked
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const make = (rig: any, id: string, m: object, files: Record<string, string> = {}) => {
  const d = join(rig.data, 'widgets', id)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify(m))
  for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t)
}

test('the store: get, set, delete, keys, all; on ones only; keys and size checked; a script’s store; the trash takes it', async t => {
  const rig = await fresh(t)
  // a script that counts its runs in its store
  make(rig, 'kv', { name: 'KV', every: 1440, script: 'fetch.mjs' }, { 'fetch.mjs': "export default ({ store }) => { const n = (store.get('runs') ?? 0) + 1; store.set('runs', n); return { n, keys: store.keys() } }\n" })
  await rig.rpc('widgetReload')
  const s = (op: string, o: object = {}) => rig.rpc('widgetStore', { id: 'kv', op, ...o })
  await assert.rejects(s('keys'), /off/i, 'off: none')
  await rig.rpc('widgetSet', { id: 'kv', on: true })
  await until(async () => (await s('get', { key: 'runs' })).value === 1, 'its first run counted')
  // that run over first: a widgetRun while it fetches queues one more (again), so polling it under load never got an ok
  await until(async () => !((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === 'kv')?.running, 'its first run over')
  assert.ok((await rig.rpc('widgetRun', { id: 'kv' })).ok, 'a second fetch')
  assert.equal((await s('get', { key: 'runs' })).value, 2, 'the script read and wrote it')
  await s('set', { key: 'cfg', value: { a: [1, 2] } })
  assert.deepEqual((await s('get', { key: 'cfg' })).value, { a: [1, 2] })
  assert.deepEqual((await s('keys')).keys.sort(), ['cfg', 'runs'])
  assert.deepEqual(await s('get', { key: 'none' }), {}, 'a missing key: no value')
  await s('delete', { key: 'cfg' })
  assert.deepEqual((await s('all')).values, { runs: 2 })
  await assert.rejects(s('set', { key: '', value: 1 }), /1 to 200 characters/)
  await assert.rejects(s('set', { key: '__proto__', value: 1 }), /1 to 200 characters/)
  await assert.rejects(s('set', { key: 'x' }), /a value/)
  await assert.rejects(s('set', { key: 'big', value: 'x'.repeat(1 << 20) }), /store is full: 1 MB/)
  await assert.rejects(s('drop', { key: 'x' }), /no store op drop/)
  // the CLI: its own ($LAKI_WIDGET), JSON or text
  rig.env.LAKI_WIDGET = 'kv'
  t.after(() => delete rig.env.LAKI_WIDGET)
  assert.equal((await rig.cli('widget', 'store', 'set', 'note', 'hello there')).code, 0)
  assert.equal((await rig.cli('widget', 'store', 'get', 'note')).out.trim(), 'hello there', 'text as it is')
  await rig.cli('widget', 'store', 'set', 'obj', '{"b": 2}')
  assert.equal((await rig.cli('widget', 'store', 'get', 'obj')).out.trim(), '{"b":2}')
  assert.equal((await rig.cliIn('[3]', 'widget', 'store', 'set', 'piped', '-')).code, 0)
  assert.deepEqual((await s('get', { key: 'piped' })).value, [3])
  await rig.cli('widget', 'store', 'rm', 'note')
  assert.deepEqual((await rig.cli('widget', 'store', 'keys')).out.trim().split('\n').sort(), ['obj', 'piped', 'runs'])
  assert.match((await rig.cli('widget', 'store', 'nope')).err, /usage: laki widget store/)
  // deleted: its store goes to the trash with it, Restore brings it back
  const kv = join(rig.data, 'widget-data', 'kv.kv.json')
  assert.ok(existsSync(kv))
  const { trash } = await rig.rpc('widgetRm', { id: 'kv' })
  assert.ok(!existsSync(kv), 'gone with it')
  await rig.rpc('widgetRestore', { trash })
  assert.ok(existsSync(kv), 'back with it')
})

test('a per-workspace one’s store is per workspace; an agent’s write is asked (no window: refused)', async t => {
  const rig = await fresh(t)
  make(rig, 'ws-kv', { name: 'WS KV', scope: 'workspace', fetch: 'echo {}' })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'ws-kv', on: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'a' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'b' })
  const s = (op: string, o: object = {}) => rig.rpc('widgetStore', { id: 'ws-kv', op, ...o })
  await assert.rejects(s('keys'), /workspace/i, 'its workspace is needed')
  await s('set', { key: 'k', value: 'in a', ws: a.id })
  assert.deepEqual(await s('get', { key: 'k', ws: b.id }), {}, 'b has its own')
  assert.equal((await s('get', { key: 'k', ws: a.id })).value, 'in a')
  const agent: any = await until(() => rig.tab(b.id), 'its agent tab')
  await assert.rejects(s('set', { key: 'k', value: 'x', ws: b.id, from: { ws: b.id, tab: agent.id } }), /nobody to approve it/)
  assert.equal((await s('get', { key: 'k', ws: b.id, from: { ws: b.id, tab: agent.id } })).value, undefined, 'its reads aren’t asked')
})
