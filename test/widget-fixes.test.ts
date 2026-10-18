// Extensions' fixes (Part B): an agent's source waits out its every, a workspace's last events, one queued refresh,
// failures back off, a notice said only once seen
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}
const find = async (rig: any, id: string) => (await rig.rpc('state')).widgets?.find((w: any) => w.id === id)
const store = (rig: any, id: string) => JSON.parse(readFileSync(join(rig.data, 'widget-data', `${id}.json`), 'utf8'))

test("an agent's source runs at most every its minutes, but on Run now", async t => {
  const rig = await fresh(t)
  make(rig, 'sum', { name: 'Sum', source: { kind: 'ai', prompt: 'quick' }, sample: { text: 'x' }, ui: { type: 'text', value: '{{text}}' } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'sum', on: true })
  await until(async () => (await find(rig, 'sum'))?.at && !(await find(rig, 'sum')).running, 'its first run')
  const calls = () => rig.fakeLog().filter((l: any) => l.bin === 'claude' && l.args.includes('--output-format')).length
  const n = calls()
  for (const reason of ['schedule', 'settings', 'event:turn.done', 'reload']) {
    const r = await rig.rpc('widgetRun', { id: 'sum', reason })
    assert.equal(r.ok, false, reason)
    assert.match(r.error, /an agent's source runs at most every 60 minutes: Run now fetches anyway/)
  }
  await rig.rpc('widgetSet', { id: 'sum', config: {} }) // a setting: not the prompt
  await sleep(300)
  assert.equal(calls(), n, 'no agent ran')
  assert.equal((await rig.rpc('widgetRun', { id: 'sum' })).ok, true, 'Run now: anyway')
  assert.equal(calls(), n + 1)
})

test("a workspace's archive and removal reach its per-workspace extension, which runs on what it was and keeps nothing", async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  make(rig, 'bye', {
    name: 'Bye',
    scope: 'workspace',
    fetch: 'echo "{\\"n\\": 1}"',
    on: { 'workspace.archived': 'note', 'workspace.removed': 'note' },
    actions: { note: `echo "$LAKI_EVENT $LAKI_WORKSPACE $LAKI_BRANCH \${LAKI_WIDGET_FILE:-nofile}" >> "${home}/bye.log"; echo '{"data": {"kept": true}}'` },
  })
  await rig.rpc('settingsSet', { devMode: true }) // its log
  make(rig, 're', { name: 'Re', scope: 'workspace', fetch: 'echo "{}"', on: { 'workspace.archived': 'refresh' } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'bye', on: true })
  await rig.rpc('widgetSet', { id: 're', on: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'two' })
  await rig.rpc('wsArchive', { id: a.id })
  await rig.rpc('wsRm', { id: b.id })
  const lines = await until(() => existsSync(join(home, 'bye.log')) && readFileSync(join(home, 'bye.log'), 'utf8').trim().split('\n').length === 2 && readFileSync(join(home, 'bye.log'), 'utf8').trim().split('\n'), 'both handled')
  assert.deepEqual((lines as string[]).sort(), [`workspace.archived ${a.id} ${a.branch} nofile`, `workspace.removed ${b.id} ${b.branch} nofile`].sort())
  assert.ok(!existsSync(join(rig.data, 'widget-data', 'bye', 'ws', `${a.id}.json`)), 'its data not kept for one archived')
  assert.ok(!existsSync(join(rig.data, 'widget-data', 'bye', 'ws', `${b.id}.json`)), 'nor for one removed')
  await until(async () => ((await rig.rpc('logs', { key: 'widget:re' })) as any[]).some(x => /workspace\.archived: not fetched: one is gone/.test(x.text)), 'a refresh for one archived: said, not fetched')
})

test('events: one refresh waits per extension, not one per event', async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  make(rig, 'busy', { name: 'Busy', fetch: `sleep 0.4; echo x >> "${home}/fetch.log"; echo "{}"`, on: { 'turn.done': 'refresh' } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'busy', on: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const ta = await until(() => rig.tab(a.id).then((t: any) => t?.last && t), 'its first turn over')
  await until(async () => !(await find(rig, 'busy')).running, 'the first fetch done')
  await sleep(600) // the first turn's own refresh, if any
  const before = existsSync(join(home, 'fetch.log')) ? readFileSync(join(home, 'fetch.log'), 'utf8').trim().split('\n').length : 0
  await Promise.all(Array.from({ length: 6 }, () => rig.rpc('hook', { tab: ta.id, state: 'idle', payload: { last_assistant_message: 'x' } })))
  await sleep(2500)
  const after = readFileSync(join(home, 'fetch.log'), 'utf8').trim().split('\n').length
  assert.ok(after - before <= 2, `${after - before} fetches for 6 events: one now, one queued`)
})

test('a fetch that fails waits twice its every, then 4 and 8 times; a good one resets it', async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  make(rig, 'flaky', { name: 'Flaky', every: 1, fetch: `test -f "${home}/ok" && echo "{}" || exit 3` })
  await rig.rpc('widgetReload')
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await rig.rpc('widgetSet', { id: 'flaky', on: true })
  await until(async () => (await find(rig, 'flaky'))?.error && !(await find(rig, 'flaky')).running, 'failed once')
  assert.equal(store(rig, 'flaky').fails, 1)
  const at = store(rig, 'flaky').at
  const tick = async (min: number) => {
    await rig.rpc('widgetTick', { now: at + min * 60_000 + 1000 })
    await sleep(300)
    await until(async () => !(await find(rig, 'flaky')).running, 'idle')
    return store(rig, 'flaky')
  }
  assert.equal((await tick(1)).at, at, 'a minute: not yet (2 after a failure)')
  const s2 = await tick(2)
  assert.notEqual(s2.at, at, 'two minutes: again')
  assert.equal(s2.fails, 2)
  writeFileSync(join(home, 'ok'), '')
  await rig.rpc('widgetRun', { id: 'flaky' })
  assert.equal(store(rig, 'flaky').fails, undefined, 'a good fetch: back to its every')
})

test('a notice is said once a window is open to see it, and only while on', async t => {
  const rig = await fresh(t)
  make(rig, 'tell', { name: 'Tell', fetch: 'echo "{\\"msg\\": \\"build broke\\"}"', notify: '{{msg}}' })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'tell', on: true })
  await until(async () => (await find(rig, 'tell'))?.at && !(await find(rig, 'tell')).running, 'fetched, no window')
  assert.equal(store(rig, 'tell').told, undefined, 'not told: nobody saw it')
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await rig.rpc('widgetRun', { id: 'tell' })
  await until(() => app.events.find((e: any) => e.ev === 'widget-say' && e.widget === 'tell' && e.notify === 'build broke'), 'said, now that a window is open')
  assert.equal(store(rig, 'tell').told, 'build broke')
})

test('laki widget remix: a copy of a built-in, yours and off, with Laki AI off too', async t => {
  const rig = await fresh(t)
  const r = await rig.cli('widget', 'remix', 'links', 'my-links')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /made my-links, a copy of links: yours, off/)
  const w = await find(rig, 'my-links')
  assert.equal(w.on, false)
  assert.ok(!w.builtin && w.dir.endsWith('/widgets/my-links'))
  assert.match((await rig.cli('widget', 'remix')).err, /usage: laki widget remix <id> \[new-id\]/)
})
