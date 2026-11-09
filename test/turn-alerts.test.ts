// What a turn tells you by itself: one running too long (settings.longTurn).
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

const MIN = 60000

test('longTurn: told once per turn past the limit, on the phone too; time waiting on you does not count; a new turn starts over', async t => {
  const posts: { title: string; body: string }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      if (req.method === 'POST') posts.push({ title: String(req.headers.title ?? ''), body })
      res.writeHead(200).end()
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const rig = await fresh(t)
  const home = rig.env.HOME
  mkdirSync(join(rig.data, 'widgets', 'lt'), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', 'lt', 'widget.json'), JSON.stringify({ name: 'Long', fetch: 'echo "{}"', on: { 'turn.long': 'got' }, actions: { got: `cat > "${home}/long.json"` } }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'lt', on: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'fix-login' })
  const tab = await until(async () => {
    const x = await rig.tab(ws.id)
    return x?.last && x.status === 'idle' && x
  }, 'first turn')
  await rig.rpc('settingsSet', { webhook: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/topic`, done: false } })
  const c = await rig.connect()
  t.after(() => c.ws.close())
  let now = Date.now()
  const tick = (min = 5) => rig.rpc('longTurnTick', { now: (now += min * MIN) })
  const hook = (state: string) => rig.rpc('hook', { tab: tab.id, state, payload: {} })
  await hook('running')
  assert.deepEqual(await tick(), [], 'off by default')
  await rig.rpc('settingsSet', { longTurn: 30 })

  await tick() // starts counting
  for (let i = 0; i < 5; i++) assert.deepEqual(await tick(), [], 'under the limit')

  // waiting on you stops the clock: long as it may be
  await hook('waiting')
  for (let i = 0; i < 20; i++) assert.deepEqual(await tick(), [], 'an ask')
  await hook('running')
  assert.deepEqual(await tick(), [], 'back: the next tick counts from here')

  assert.deepEqual(await tick(), [tab.id], '30 minutes of work')
  assert.deepEqual(await tick(), [], 'once per turn')
  const ev = await until(() => c.events.find(e => e.ev === 'long'), 'the event')
  assert.equal(ev.text, 'fix-login has been working for 30 min')
  await until(() => posts.find(x => x.title === ev.text), 'the phone')
  const got = await until(() => existsSync(join(home, 'long.json')) && (x => (x ? JSON.parse(x) : undefined))(readFileSync(join(home, 'long.json'), 'utf8')), 'turn.long')
  assert.deepEqual([got.event, got.minutes, got.tab.id], ['turn.long', 30, tab.id])

  // an Esc ends a turn with no hook: the next prompt starts the clock over, and can be told again
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'again' } })
  await tick()
  for (let i = 0; i < 5; i++) assert.deepEqual(await tick(), [], 'from zero')
  assert.deepEqual(await tick(), [tab.id], 'told again')

  // a Mac asleep: a gap counts as five minutes at most
  await hook('idle')
  await hook('running')
  await tick()
  assert.deepEqual(await tick(600), [], 'the lid was closed')
  for (let i = 0; i < 4; i++) assert.deepEqual(await tick(), [], 'a new turn starts over')
  assert.deepEqual(await tick(), [tab.id])
})

const failed = (rig: any, id: string) => until(async () => (await rig.tab(id))?.failed, 'the error')

test('an API error: one line, Continue sends continue to the same chat and clears it; Dismiss; not a limit', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'apierror now', name: 'one', local: true })
  assert.equal(await failed(rig, ws.id), 'API Error: 529 Overloaded')
  const tab = await rig.tab(ws.id)
  assert.equal(tab.status, 'idle')
  await rig.rpc('send', { target: tab.id, text: 'continue' })
  await until(async () => /answer: continue/.test((await rig.tab(ws.id)).last ?? '') && !(await rig.tab(ws.id)).failed, 'continued in its chat')

  await rig.rpc('send', { target: tab.id, text: 'apierror again' })
  await failed(rig, ws.id)
  await rig.rpc('failDismiss', { tab: tab.id })
  assert.equal((await rig.tab(ws.id)).failed, undefined)

  await rig.rpc('send', { target: tab.id, text: 'limit reached' })
  await until(async () => (await rig.tab(ws.id)).limit, 'the limit')
  assert.equal((await rig.tab(ws.id)).failed, undefined, 'a limit has its own wait')
})

test('an API error after your Esc is no error to go on from', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one', local: true })
  await until(async () => /> /.test(await rig.screen((await rig.tab(ws.id)).id)), 'claude up')
  const tab = (await rig.tab(ws.id)).id
  await rig.rpc('send', { target: tab, text: 'slow one' })
  await until(async () => (await rig.tab(ws.id)).status === 'running', 'its turn')
  await rig.rpc('input', { tab, data: '\x1b' })
  await rig.rpc('hook', { tab, state: 'failed', payload: { error: 'server_error' } })
  assert.equal((await rig.tab(ws.id)).failed, undefined)
})

test('continueOnError: once per turn, by itself, after the wait; off, never', async t => {
  const rig = await fresh(t, { env: { LAKI_CONTINUE_MS: '200', FAKE_CONTINUE_FAILS: '1' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one', local: true })
  await until(async () => /> /.test(await rig.screen((await rig.tab(ws.id)).id)), 'claude up')
  const tab = (await rig.tab(ws.id)).id
  const continues = async () => ((await rig.rpc('screen', { target: tab, lines: 200 })) as string).split('\n').filter(l => /^> ?continue/.test(l.trim()) || l.trim() === 'continue').length
  await rig.rpc('send', { target: tab, text: 'apierror off' })
  await failed(rig, ws.id)
  await sleep(600)
  assert.equal(await continues(), 0, 'off by default')

  await rig.rpc('settingsSet', { continueOnError: true })
  await rig.rpc('send', { target: tab, text: 'apierror on' })
  await until(async () => (await continues()) === 1, 'once by itself')
  await failed(rig, ws.id) // the continue failed too
  await sleep(600)
  assert.equal(await continues(), 1, 'once per turn')

  // a new turn of yours: once more
  await rig.rpc('send', { target: tab, text: 'apierror yours' })
  await until(async () => (await continues()) === 2, 'a new turn')
})
