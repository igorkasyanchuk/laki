// Extensions' events (widget.json's on), streams (stream: true) and push (laki widget push)
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}
const on = async (rig: any, ...ids: string[]) => {
  await rig.rpc('widgetReload')
  for (const id of ids) await rig.rpc('widgetSet', { id, on: true })
}
const dataOf = async (rig: any, id: string, ws?: string) => JSON.parse((await rig.rpc('widgetRuns', { id, data: true, ws })).data)

test('events: a turn runs a handler with the event on stdin, its data and toast; refresh; per workspace; the queue', async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  make(rig, 'ev', {
    name: 'Events',
    fetch: 'printf \'{"n": "%s"}\' "$LAKI_REFRESH_REASON"',
    on: { 'turn.done': 'got', 'turn.waiting': 'refresh' },
    actions: { got: `cat > "${home}/got.json"; cp "$LAKI_EVENT_FILE" "${home}/file.json"; printf '{"data": {"said": "%s"}, "toast": "seen", "close": "prog"}' "$LAKI_EVENT"` },
  })
  make(rig, 'mine', { name: 'Mine', scope: 'workspace', fetch: 'echo "{}"', on: { 'turn.done': 'mark' }, actions: { mark: `touch "${home}/mark-$LAKI_WORKSPACE"` } })
  make(rig, 'slow', { name: 'Slow', on: { 'turn.done': 'q' }, actions: { q: `sleep 0.3; cat >> "${home}/q.log"; echo >> "${home}/q.log"` } })
  await on(rig, 'ev', 'mine')
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'two' })
  const ta = await until(() => rig.tab(a.id).then((t: any) => t?.last && t), "a's agent, its first turn over") // the fake's own hooks first
  await until(() => rig.tab(b.id).then((t: any) => t?.last), "b's too")
  await sleep(500) // their first turns' own handlers, still running
  for (const f of ['got.json', 'file.json', `mark-${a.id}`, `mark-${b.id}`]) rmSync(join(home, f), { force: true })

  // turn.done: the handler gets it on stdin and in its file, says data and a toast
  await rig.rpc('hook', { tab: ta.id, state: 'idle', payload: { last_assistant_message: 'all done' } })
  await until(() => existsSync(join(home, 'got.json')), 'the handler ran')
  const got = JSON.parse(readFileSync(join(home, 'got.json'), 'utf8'))
  assert.equal(got.event, 'turn.done')
  assert.equal(got.last, 'all done')
  assert.deepEqual([got.ws.id, got.ws.branch, got.tab.id, got.tab.agent], [a.id, a.branch, ta.id, 'claude'])
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'file.json'), 'utf8')), got)
  assert.deepEqual(await until(() => dataOf(rig, 'ev').then(d => d?.said && d)), { said: 'turn.done' })
  await until(() => app.events.find(e => e.ev === 'widget-say' && e.widget === 'ev' && e.toast === 'seen' && e.close === 'prog'), "the toast and the close, to the app's window")
  const runs = (await rig.rpc('widgetRuns', { id: 'ev' })).runs
  assert.equal(runs.find((r: any) => r.action === 'got').reason, 'event:turn.done')
  // per workspace: only its own workspace's, in that instance
  await until(() => existsSync(join(home, `mark-${a.id}`)), "a's instance")
  assert.ok(!existsSync(join(home, `mark-${b.id}`)))

  // turn.waiting: refresh, with its reason
  await rig.rpc('hook', { tab: ta.id, state: 'waiting', payload: { message: 'Claude needs your permission' } })
  await until(() => dataOf(rig, 'ev').then(d => d?.n === 'event:turn.waiting'), 'fetched for the wait')

  // the queue: one at a time, 20 waiting at most: the oldest past it dropped
  await on(rig, 'slow')
  await Promise.all(Array.from({ length: 25 }, () => rig.rpc('hook', { tab: ta.id, state: 'idle', payload: { last_assistant_message: 'x' } })))
  await until(() => existsSync(join(home, 'q.log')) && readFileSync(join(home, 'q.log'), 'utf8').trim().split('\n').length === 21, '21 handled', 15000)
  await sleep(800)
  assert.equal(readFileSync(join(home, 'q.log'), 'utf8').trim().split('\n').length, 21, '4 dropped')
})

test('events: a PR\'s checks failing and its merge, once per head; nothing replayed after a restart', async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = (head: string, state: string, conclusion: string) =>
    writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 7, state, url: 'https://github.com/o/r/pull/7', title: 'Fix it', headRefOid: head, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion, detailsUrl: 'https://ci.invalid/1' }] }))
  pr('aaa', 'OPEN', 'FAILURE')
  make(rig, 'prs', { name: 'PRs', on: { 'pr.checks.failed': 'log', 'pr.merged': 'log', 'pr.checks.passed': 'log' }, actions: { log: `node -e 'const e = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(e.event, e.pr.number, (e.failing || []).map(f => f.name).join())' >> "${home}/pr.log"` } })
  await on(rig, 'prs')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const head = (h: string) => until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === ws.id)?.pr?.head === h, `head ${h}`)
  const log = () => (existsSync(join(home, 'pr.log')) ? readFileSync(join(home, 'pr.log'), 'utf8') : '')
  await head('aaa')
  await sleep(1200) // a few scans: the first one only noted it
  assert.equal(log(), '')
  pr('bbb', 'OPEN', 'FAILURE')
  await head('bbb')
  await until(() => log() === 'pr.checks.failed 7 test\n', 'failed on bbb')
  await sleep(1200)
  assert.equal(log(), 'pr.checks.failed 7 test\n', 'once per head')
  pr('bbb', 'MERGED', 'SUCCESS')
  await until(() => log().includes('pr.merged'), 'merged')
  await sleep(1200)
  assert.equal(log(), 'pr.checks.failed 7 test\npr.checks.passed 7 \npr.merged 7 \n')
  await rig.stop()
  await rig.start()
  await head('bbb')
  await sleep(1500)
  assert.equal(log(), 'pr.checks.failed 7 test\npr.checks.passed 7 \npr.merged 7 \n', 'a restart replays nothing')
})

test('streams: each line of JSON is its data, again after an exit with backoff, stopped when off', async t => {
  const rig = await fresh(t)
  make(rig, 'st', { name: 'Stream', stream: true, fetch: 'i=0; while [ $i -lt 3 ]; do i=$((i+1)); echo "{\\"n\\": $i}"; echo "a log line"; sleep 0.2; done; exit 1' })
  await rig.rpc('widgetReload')
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true })
  await rig.rpc('widgetSet', { id: 'st', on: true })
  assert.deepEqual(await until(() => dataOf(rig, 'st').then(d => d?.n === 3 && d), 'its lines'), { n: 3 })
  const ended = (n: number) => until(() => rig.rpc('widgetRuns', { id: 'st' }).then((r: any) => r.stream.restarts === n && r.stream.next && r), `exit ${n}`, 8000)
  let r = await ended(1)
  const gap = (r: any) => r.stream.next - (r.runs[0].at + r.runs[0].ms)
  assert.equal(r.runs[0].reason, 'stream')
  assert.equal(r.runs[0].error, 'exit 1')
  assert.ok(Math.abs(gap(r) - 1000) < 300, `1 s (${gap(r)})`)
  r = await ended(2)
  assert.ok(Math.abs(gap(r) - 2000) < 300, `then 2 s (${gap(r)})`)
  await until(() => rig.rpc('widgetRuns', { id: 'st' }).then((r: any) => r.stream.running), 'running again')
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'widget-data', 'st.json'), 'utf8')).data.n, 3, 'kept in its store')
  // sample data by hand: the stream stops, its lines never write over it; Live starts it again
  await rig.rpc('widgetMock', { id: 'st', data: { n: 99 } })
  assert.equal((await rig.rpc('widgetRuns', { id: 'st' })).stream, undefined, 'mocked: no stream')
  await sleep(700)
  assert.equal((await dataOf(rig, 'st'))?.n, 99, 'the sample data stays')
  await rig.rpc('widgetMock', { id: 'st', off: true })
  await until(() => rig.rpc('widgetRuns', { id: 'st' }).then((r: any) => r.stream?.running), 'Live: streaming again')
  await rig.rpc('widgetSet', { id: 'st', on: false })
  r = await rig.rpc('widgetRuns', { id: 'st' })
  assert.equal(r.stream, undefined, 'off: no stream')
  const at = (await rig.rpc('state')).widgets.find((w: any) => w.id === 'st').at
  await sleep(700)
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === 'st').at, at, 'nothing more')
  // a script's async generator streams too; the starter checks out and streams
  make(rig, 'gen', { name: 'Gen', stream: true, script: 'gen.mjs' })
  writeFileSync(join(rig.data, 'widgets', 'gen', 'gen.mjs'), 'export default async function* () { yield { n: 1 }; await new Promise(r => setTimeout(r, 100)); yield { n: 2 }; await new Promise(r => setTimeout(r, 60000)) }\n')
  await on(rig, 'gen')
  await until(() => dataOf(rig, 'gen').then(d => d?.n === 2), 'yields as lines')
  assert.equal((await rig.cli('widget', 'new', 'Ticks', '--kind', 'stream')).code, 0)
  const check = await rig.cli('widget', 'check', 'ticks')
  assert.equal(check.code, 0, check.out)
  assert.match(check.out, /not run: it streams/)
  await until(() => dataOf(rig, 'ticks').then(d => d?.n >= 1), 'the starter streams')
  // check: a stream is global only; events by name, handlers by action
  make(rig, 'bad', { name: 'Bad', scope: 'workspace', stream: true, fetch: 'echo "{}"', on: { 'turn.don': 'nope', 'pr.merged': 'refresh' } })
  await rig.rpc('widgetReload')
  const ps = (await rig.rpc('widgetCheck', { id: 'bad' })).problems.filter((p: any) => p.level === 'error').map((p: any) => `${p.where}: ${p.text}`)
  assert.ok(ps.some((x: string) => /stream: a stream is global only/.test(x)), ps.join('\n'))
  assert.ok(ps.some((x: string) => /on\.turn\.don: no event turn\.don \(did you mean turn\.done\?\)/.test(x)), ps.join('\n'))
  assert.ok(ps.some((x: string) => /on\.turn\.don: refresh, or one of its actions/.test(x)), ps.join('\n'))
})

test('push: data put there by the CLI, merged, per workspace; refused when off', async t => {
  const rig = await fresh(t)
  make(rig, 'pu', { name: 'Pushed', ui: { type: 'text', value: '{{a}} {{b}}' } })
  make(rig, 'pw', { name: 'Pushed here', scope: 'workspace', ui: { type: 'text', value: '{{a}} on {{workspace.branch}}' } })
  await rig.rpc('widgetReload')
  assert.match((await rig.cli('widget', 'push', 'pu', '{"a": 1}')).err, /is off: turn it on first/)
  await on(rig, 'pu', 'pw')
  assert.equal((await rig.cli('widget', 'push', 'pu', '{"a": 1}')).out.trim(), 'pushed to pu')
  assert.deepEqual(await dataOf(rig, 'pu'), { a: 1 })
  assert.equal((await rig.cliIn('{"b": 2}', 'widget', 'push', 'pu', '-', '--merge')).code, 0)
  assert.deepEqual(await dataOf(rig, 'pu'), { a: 1, b: 2 })
  assert.match(await rig.rpc('widgetRender', { id: 'pu' }), /1 2/)
  assert.equal((await rig.rpc('widgetRuns', { id: 'pu' })).runs[0].reason, 'push')
  assert.match((await rig.cli('widget', 'push', 'pu', 'nope')).err, /not JSON: nope/)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  assert.equal((await rig.cli('widget', 'push', 'pw', '{"a": "hi"}', '--ws', ws.id)).code, 0)
  assert.match(await rig.rpc('widgetRender', { id: 'pw', ws: ws.id }), new RegExp(`hi on ${ws.branch}`))
  assert.match((await rig.cli('widget', 'push', 'pw', '{}')).err, /is per workspace: which one/)
})

test('a fetch that times out ends what it started; a stream stopped in Resources ends its children too', async t => {
  const rig = await fresh(t, { env: { LAKI_WIDGET_TIMEOUT_MS: '800' } })
  const d = join(rig.data, 'widgets')
  make(rig, 'slow', { name: 'Slow', fetch: 'sleep 300 & echo $! > bg.pid; sleep 30; echo "{}"' })
  make(rig, 'st', { name: 'St', stream: true, fetch: 'sleep 300 & echo $! > bg.pid; while true; do echo \'{"n": 1}\'; sleep 0.3; done' })
  await on(rig, 'slow')
  const pid = (id: string) => until(() => (existsSync(join(d, id, 'bg.pid')) ? Number(readFileSync(join(d, id, 'bg.pid'), 'utf8')) : 0), `${id}'s child`)
  const alive = (p: number) => {
    try {
      process.kill(p, 0)
      return true
    } catch {
      return false
    }
  }
  const t0 = Date.now() // turned on: it fetches
  const w = await until(() => rig.rpc('state').then((v: any) => v.widgets.find((x: any) => x.id === 'slow')).then((x: any) => !x.running && x.error && x), 'timed out', 6000)
  assert.equal(w.error, 'timed out after 0.8 s')
  assert.ok(Date.now() - t0 < 5000, 'not held by the child that keeps its stdout')
  const bg = await pid('slow')
  await until(() => !alive(bg), 'its background sleep gone', 6000)

  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true })
  await rig.rpc('widgetSet', { id: 'st', on: true })
  const child = await pid('st')
  assert.ok(alive(child))
  await rig.rpc('resourceStop', { key: 'stream:st' })
  await until(() => !alive(child), "the stream's child gone", 6000)
  assert.equal((await rig.rpc('widgetRuns', { id: 'st' })).stream.stopped, true)
})

test('refresh on an event fetches a url source too', async t => {
  let hits = 0
  const srv = createServer((_, r) => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ hits: ++hits })))
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t)
  make(rig, 'u', { name: 'U', source: { kind: 'url', url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/x` }, on: { 'turn.done': 'refresh' }, sample: { hits: 0 } })
  await on(rig, 'u')
  await until(() => dataOf(rig, 'u').then(d => d?.hits === 1), 'fetched as it was turned on')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const ta = await until(() => rig.tab(a.id).then((t: any) => t?.last && t), 'its first turn over')
  const n = (await dataOf(rig, 'u')).hits
  await rig.rpc('hook', { tab: ta.id, state: 'idle', payload: { last_assistant_message: 'done' } })
  await until(() => dataOf(rig, 'u').then(d => d?.hits > n), 'fetched again on turn.done')
  assert.equal((await rig.rpc('widgetRuns', { id: 'u' })).runs[0].reason, 'event:turn.done')
})

// an extension that keeps every event it gets, a line each
const keeper = (rig: any, id: string, events: string[], extra: object = {}) =>
  make(rig, id, { name: id, on: Object.fromEntries(events.map(e => [e, 'keep'])), actions: { keep: `cat >> "${rig.env.HOME}/${id}.log"; echo >> "${rig.env.HOME}/${id}.log"` }, ...extra })
const kept = (rig: any, id: string) => (f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []))(join(rig.env.HOME, `${id}.log`))

test('events: a new tab, a port newly listening (once), a ship, a usage limit; laki widget events lists them', async t => {
  const rig = await fresh(t, { config: { run: `exec node -e 'const s = require("http").createServer().listen(0, "127.0.0.1", () => console.log("listening " + s.address().port))'` } })
  const remote = join(rig.home, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', remote], { env: rig.env })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: rig.repo, env: rig.env })
  keeper(rig, 'all', ['tab.new', 'port.open', 'ship.done', 'limit.hit'])
  await on(rig, 'all')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })

  // tab.new: a shell, the dev server's tab
  const sh = await rig.rpc('tabNew', { ws: ws.id, preset: 'shell' })
  const dev = await rig.rpc('run', { ws: ws.id })
  await until(() => kept(rig, 'all').filter(e => e.event === 'tab.new').length >= 2, 'two tabs')
  const tabs = kept(rig, 'all').filter(e => e.event === 'tab.new')
  assert.deepEqual(tabs.map(e => [e.kind, e.tab.id, e.ws.id]), [['shell', sh.id, ws.id], ['dev', dev.id, ws.id]])

  // port.open: once, while it listens
  const port = Number((await until(async () => (await rig.screen(dev.id)).match(/listening (\d+)/), 'dev server up'))![1])
  const opened = await until(() => kept(rig, 'all').find(e => e.event === 'port.open'), 'port.open', 12000)
  assert.deepEqual([opened.port, opened.ws.id, typeof opened.pid, opened.command], [port, ws.id, 'number', 'node'])
  await sleep(5600) // another scan
  assert.equal(kept(rig, 'all').filter(e => e.event === 'port.open').length, 1, 'once per appearance')

  // ship.done: its exit and the PR
  writeFileSync(join(ws.path, 'feature.txt'), 'done\n')
  const ship = await rig.rpc('ship', { ws: ws.id, message: 'Add it' })
  const shipped = await until(() => kept(rig, 'all').find(e => e.event === 'ship.done'), 'ship.done', 15000)
  assert.deepEqual([shipped.ok, shipped.exit, shipped.tab.id, shipped.ws.id], [true, 0, ship.id, ws.id])
  assert.ok(kept(rig, 'all').some(e => e.event === 'tab.new' && e.kind === 'ship'))

  // limit.hit: once per limit
  const a = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude', prompt: 'limit now' })
  const hit = await until(() => kept(rig, 'all').find(e => e.event === 'limit.hit'), 'limit.hit', 12000)
  assert.deepEqual([hit.agent, hit.tab.id, hit.until > Date.now()], ['claude', a.id, true])
  await rig.rpc('hook', { tab: a.id, state: 'failed', payload: { error: 'rate_limit', error_details: "You've hit your usage limit. Try again in 2 hours." } })
  await sleep(600)
  assert.equal(kept(rig, 'all').filter(e => e.event === 'limit.hit').length, 1, 'the same limit read again: not again')

  // laki widget events: the newest first, with whom each reached
  const ls = await rig.rpc('widgetEvents')
  assert.equal(ls.find((e: any) => e.event === 'ship.done').widgets[0], 'all')
  const c = await rig.cli('widget', 'events')
  assert.match(c.out, /ship\.done {2}ws \S+ {2}→ all/)
})

test('events of your own: emit reaches others not itself, custom.*, workspace, too big, hops stop a loop; the schema takes custom names', async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  keeper(rig, 'one', ['custom.deploy.done'])
  keeper(rig, 'any', ['custom.*'])
  // self emits on what it gets, and answers it too: never its own
  make(rig, 'self', { name: 'self', on: { 'custom.ping': 'go' }, actions: { go: `echo x >> "${home}/self.log"; "$LAKI_CLI" widget emit ping '{"again": true}'` } })
  // ping and pong answer each other: a loop, stopped by hops
  make(rig, 'ping', { name: 'ping', on: { 'custom.pong': 'go' }, actions: { go: `echo "$LAKI_EVENT_HOPS" >> "${home}/ping.log"; "$LAKI_CLI" widget emit ping` } })
  make(rig, 'pong', { name: 'pong', on: { 'custom.ping': 'go' }, actions: { go: `echo "$LAKI_EVENT_HOPS" >> "${home}/pong.log"; "$LAKI_CLI" widget emit pong` } })
  await on(rig, 'one', 'any', 'self')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })

  let c = await rig.cli('widget', 'emit', 'deploy.done', '{"sha": "abc"}', '--ws', ws.id)
  assert.equal(c.code, 0, c.err)
  assert.match(c.out.trim(), /^custom\.deploy\.done: (one, any|any, one)$/)
  const got = await until(() => kept(rig, 'one')[0], 'one got it')
  assert.deepEqual([got.event, got.data, got.ws.id, got.from], ['custom.deploy.done', { sha: 'abc' }, ws.id, {}])
  await until(() => kept(rig, 'any').length === 1, 'custom.* too')
  await rig.rpc('widgetEmit', { name: 'custom.other' })
  await until(() => kept(rig, 'any').length === 2, 'custom.* gets every custom event')
  assert.equal(kept(rig, 'one').length, 1)

  // its own emit: never back to itself
  await rig.cli('widget', 'emit', 'ping')
  await until(() => existsSync(join(home, 'self.log')), 'self ran')
  await until(() => kept(rig, 'any').some(e => e.event === 'custom.ping' && e.from.widget === 'self'), 'its emit reached the others, from it')
  await sleep(1000)
  assert.equal(readFileSync(join(home, 'self.log'), 'utf8').trim().split('\n').length, 1, 'not its own')

  // names and sizes
  for (const bad of ['Deploy', '-x', 'a b', 'x'.repeat(42)]) await assert.rejects(rig.rpc('widgetEmit', { name: bad }), /an event's name is letters/)
  await assert.rejects(rig.rpc('widgetEmit', { name: 'big', data: { s: 'x'.repeat(70000) } }), /its data is over 64 KB/)

  // a loop: each emit made while handling one is a hop more; past 3, dropped (and said in its log)
  await rig.rpc('widgetSet', { id: 'self', on: false })
  await on(rig, 'ping', 'pong')
  await rig.rpc('widgetSet', { id: 'ping', log: true })
  await rig.cli('widget', 'emit', 'ping')
  await until(() => (existsSync(join(home, 'ping.log')) ? readFileSync(join(home, 'ping.log'), 'utf8').trim().split('\n') : []).includes('3'), 'hops counted up')
  await sleep(1500)
  assert.deepEqual(readFileSync(join(home, 'pong.log'), 'utf8').trim().split('\n'), ['0', '2'])
  assert.deepEqual(readFileSync(join(home, 'ping.log'), 'utf8').trim().split('\n'), ['1', '3'])
  assert.ok((await rig.rpc('widgetLogs', { id: 'ping' })).lines.some((l: any) => /emit custom\.ping: dropped, 4 hops/.test(l.text)))
  assert.ok((await rig.rpc('widgetEvents')).some((e: any) => e.refused?.[0] === '4 hops: dropped'))

  // widget.json: custom names and custom.* pass the check; a made-up built-in doesn't
  make(rig, 'chk', { name: 'chk', fetch: 'echo {}', sample: {}, on: { 'custom.a-b.c': 'refresh', 'custom.*': 'refresh', 'turn.don': 'refresh' } })
  await rig.rpc('widgetReload')
  const ps = (await rig.rpc('widgetCheck', { id: 'chk', run: false })).problems
  assert.deepEqual(ps.filter((x: any) => x.level === 'error').map((x: any) => x.where), ['widget.json on.turn.don'])
})

test("an agent's event: an action handler asks first (Always kept), a fetch doesn't; what an extension emits handling it stays the agent's without its env; an agent's run's flow.ended and MCP's emit are agents'", async t => {
  const rig = await fresh(t)
  const home = rig.env.HOME
  make(rig, 'act', { name: 'Act', fetch: 'echo "{}"', on: { 'custom.x': 'act' }, actions: { act: `echo "$LAKI_EVENT $LAKI_EVENT_AGENT" >> "${home}/act.log"` } })
  // relay's fetch drops its env's mark: the daemon knows whose event it handles anyway
  make(rig, 'relay', { name: 'Relay', scope: 'workspace', fetch: `env -u LAKI_EVENT_AGENT "$LAKI_CLI" widget emit relayed >/dev/null; echo "{}"`, on: { 'custom.x': 'refresh' } })
  await on(rig, 'act', 'relay')
  await rig.rpc('widgetSet', { id: 'act', log: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const relays = async () => (await rig.rpc('widgetEvents')).filter((e: any) => e.event === 'custom.relayed')
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'cmd', text: '# Cmd\nruns in: main · on: custom.relayed\n\n## start\nnext: go\n\n## go\nrun: echo hi\nok: e\nfail: e\n\n## e\nend: success\n' })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'one' })
  const tab = await until(() => rig.tab(ws.id))
  const emit = () => rig.rpc('widgetEmit', { name: 'x', ws: ws.id, from: { tab: tab.id, ws: ws.id } })

  // no window to ask in: act's action isn't run, said in its log; relay fetches, and its emit is the agent's: the
  // workflow with a run: block refuses it
  let before = (await relays()).length
  assert.deepEqual((await emit()).widgets.sort(), ['act', 'relay'])
  await until(async () => (await relays()).length > before, 'relay emitted again')
  const relayed = (await relays())[0]
  assert.equal(relayed.from.agent, 'claude')
  assert.match(relayed.refused.join('\n'), /cmd: an agent sent the event, and it runs commands/)
  await until(async () => (await rig.rpc('widgetLogs', { id: 'act' })).lines.some((l: any) => /event custom\.x from claude: action act not run: Laki's window isn't open/.test(l.text)), 'not run, said')
  assert.ok(!existsSync(join(home, 'act.log')))

  // a window: asked first; Deny runs nothing, Always runs it and keeps it for that workspace
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const asked = new Set<string>()
  const ask = () => until(() => (m => m && (asked.add(m.req), m))(app.events.find(e => e.ev === 'toolAsk' && e.widget === 'act' && !asked.has(e.req))), 'asked')
  await emit()
  const a1 = await ask()
  assert.deepEqual([a1.action, a1.agent, a1.ask, a1.ws], ['act', 'claude', 'first', ws.id])
  await rig.rpc('widgetToolAnswer', { req: a1.req, allow: 'deny' })
  await sleep(500)
  assert.ok(!existsSync(join(home, 'act.log')), 'denied: not run')
  await emit()
  await rig.rpc('widgetToolAnswer', { req: (await ask()).req, allow: 'always' })
  await until(() => existsSync(join(home, 'act.log')), 'allowed: run')
  assert.equal(readFileSync(join(home, 'act.log'), 'utf8').trim(), 'custom.x claude')
  await emit()
  await until(() => readFileSync(join(home, 'act.log'), 'utf8').trim().split('\n').length === 2, 'Always: run unasked')
  assert.equal(app.events.filter(e => e.ev === 'toolAsk' && e.widget === 'act').length, 2)
  // yours: never asked
  await rig.cli('widget', 'emit', 'x', '--ws', ws.id)
  await until(() => readFileSync(join(home, 'act.log'), 'utf8').includes('custom.x \n'), 'yours ran')
  assert.equal(app.events.filter(e => e.ev === 'toolAsk' && e.widget === 'act').length, 2, 'yours: not asked')

  // a run an agent started: its flow.ended is the agent's
  await rig.rpc('flowSave', { id: 'plain', text: '# Plain\nruns in: main\n\n## start\ninput: task\nnext: e\n\n## e\nend: success\n' })
  const run = await rig.rpc('flowStart', { workflow: 'plain', project: p.id, task: 'x', by: 'agent' })
  const ended = await until(async () => (await rig.rpc('widgetEvents')).find((e: any) => e.event === 'flow.ended'), 'flow.ended')
  assert.equal(ended.from?.agent, 'agent', JSON.stringify(ended))
  assert.equal((await rig.rpc('flowGet', { id: run.id })).by, 'agent')

  // MCP's emit, with no LAKI_TAB: an agent's
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'laki_extension_emit', arguments: { name: 'viamcp' } } },
  ]
  const r = await rig.cliIn(msgs.map(m => JSON.stringify(m)).join('\n') + '\n', 'mcp')
  assert.equal(r.code, 0, r.err)
  const viaMcp = (await rig.rpc('widgetEvents')).find((e: any) => e.event === 'custom.viamcp')
  assert.equal(viaMcp.from?.agent, 'agent')
})
