// Extensions' dev mode (laki widget dev): a folder of your own linked, on, shadowing an installed one of its id,
// watched (a change fetches again; a broken file keeps the last good version), runs with their reason and stderr,
// sample data by hand, masked settings, unlinking
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fresh, sleep, until } from './helpers.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const find = async (rig: any, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)

test('widget dev: linked on and first, watched, the last good version kept, runs, sample data, masked settings, unlinked', async t => {
  const rig = await fresh(t)
  // an installed one of the same id, in Laki's folder
  const own = join(rig.data, 'widgets', 'deploys')
  mkdirSync(own, { recursive: true })
  writeFileSync(join(own, 'widget.json'), JSON.stringify({ name: 'Installed', fetch: 'echo {}' }))
  await rig.rpc('widgetReload')
  assert.equal((await find(rig, 'deploys')).name, 'Installed')

  // your code: its fetch says why it ran, and something on stderr
  const code = join(rig.env.HOME, 'code', 'deploys')
  mkdirSync(join(code, 'fixtures'), { recursive: true })
  const manifest = (n: number) => ({ name: 'Deploys', every: 60, fetch: `echo "warn ${n}" >&2; printf '{"n": ${n}, "reason": "%s"}' "$LAKI_REFRESH_REASON"`, config: { apiToken: 'sekret', repo: 'acme/web' }, ui: { type: 'stat', value: '{{n}}', label: 'deploys' } })
  writeFileSync(join(code, 'widget.json'), JSON.stringify(manifest(1)))
  writeFileSync(join(code, 'fixtures', 'busy.json'), JSON.stringify({ n: 99 }))
  const real = realpathSync(code) // the CLI's cwd: /private/var… on macOS

  // laki widget dev: the line it prints, then each run as it comes
  const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'src/cli/main.ts'), 'widget', 'dev'], { cwd: code, env: rig.env })
  t.after(() => p.kill())
  let out = ''
  p.stdout.on('data', d => (out += d))
  p.stderr.on('data', d => (out += d))
  await until(() => out.includes(`Watching ${real} · open Settings › Extensions › Deploys › Inspect`), `dev's first line (${out})`)
  let w = await until(() => find(rig, 'deploys').then(w => w?.at && w), 'fetched as it was linked')
  assert.ok(w.on && w.dev && w.dir === real && w.name === 'Deploys', 'on, and your copy first')
  let runs = await rig.rpc('widgetRuns', { id: 'deploys' })
  assert.equal(runs.runs[0].reason, 'dev')
  assert.equal(runs.runs[0].why, 'linked')
  assert.ok(runs.runs[0].ok && runs.runs[0].ms >= 0 && runs.runs[0].bytes > 0)
  assert.equal(runs.runs[0].stderr, 'warn 1')
  assert.match(await rig.rpc('widgetRender', { id: 'deploys' }), /<div class="k-v">1<\/div>/)
  await until(() => /fetch ok \d+ ms \d+ B \(dev: linked\)/.test(out), `the run's line (${out})`)
  assert.deepEqual(runs.fixtures, ['busy'])
  // the env: the token-like setting masked, in the JSON too
  assert.equal(runs.env.WIDGET_APITOKEN, '••••')
  assert.equal(runs.env.WIDGET_REPO, 'acme/web')
  assert.deepEqual(JSON.parse(runs.env.LAKI_WIDGET_CONFIG), { apiToken: '••••', repo: 'acme/web' })
  assert.ok(runs.env.PATH && runs.env.LAKI_WIDGET === 'deploys' && !('HOME' in runs.env))

  // a change: read again and fetched (reason dev, the file named)
  writeFileSync(join(code, 'widget.json'), JSON.stringify(manifest(2)))
  await until(async () => (await rig.rpc('widgetRender', { id: 'deploys' })).includes('<div class="k-v">2</div>'), 'fetched again after a change', 4000)
  runs = await rig.rpc('widgetRuns', { id: 'deploys' })
  assert.equal(runs.runs[0].reason, 'dev')
  assert.match(runs.runs[0].why, /widget\.json changed/)

  // broken: the last good version runs on, devError says why; fixed: gone
  writeFileSync(join(code, 'widget.json'), '{ "name": "Deploys", ')
  w = await until(() => find(rig, 'deploys').then(w => w.devError && w), 'devError')
  assert.match(w.devError, /^widget\.json: /)
  assert.equal(w.name, 'Deploys')
  assert.match(await rig.rpc('widgetRender', { id: 'deploys' }), /<div class="k-v">2<\/div>/, 'the last good version')
  await until(() => out.includes('✗ last good version kept: widget.json'), `dev says so (${out})`)
  writeFileSync(join(code, 'widget.json'), JSON.stringify({ ...manifest(3), ui: { type: 'stat', value: '{{#each x}}' } }))
  w = await until(() => find(rig, 'deploys').then(w => /^ui: .*isn't closed/.test(w.devError ?? '') && w), 'a template that does not read')
  writeFileSync(join(code, 'widget.json'), JSON.stringify(manifest(3)))
  w = await until(() => find(rig, 'deploys').then(w => !w.devError && w.at && w), 'fixed')
  await until(async () => (await rig.rpc('widgetRender', { id: 'deploys' })).includes('<div class="k-v">3</div>'), 'and fetched')

  // sample data: a fixture, by hand; a schedule skips it, Fetch now / off fetches
  const app = await rig.connect()
  t.after(() => app.ws.close())
  assert.deepEqual(await rig.rpc('widgetMock', { id: 'deploys', fixture: 'busy' }), { ok: true, mock: 'busy' })
  assert.equal((await find(rig, 'deploys')).mock, 'busy')
  assert.match(await rig.rpc('widgetRender', { id: 'deploys' }), /<div class="k-v">99<\/div>/)
  const n = (await rig.rpc('widgetRuns', { id: 'deploys' })).runs.length
  await rig.rpc('widgetTick', { now: Date.now() + 2 * 3600_000 })
  await sleep(300)
  assert.equal((await rig.rpc('widgetRuns', { id: 'deploys' })).runs.length, n, 'a schedule skips it')
  await assert.rejects(rig.rpc('widgetMock', { id: 'deploys', fixture: 'nope' }), /no fixtures\/nope\.json/)
  await rig.rpc('widgetMock', { id: 'deploys', data: { n: 7 } })
  assert.equal((await find(rig, 'deploys')).mock, 'edited')
  assert.match(await rig.rpc('widgetRender', { id: 'deploys' }), /<div class="k-v">7<\/div>/)
  assert.deepEqual(await rig.rpc('widgetMock', { id: 'deploys', off: true }), { ok: true })
  w = await find(rig, 'deploys')
  assert.equal(w.mock, undefined)
  assert.equal((await rig.rpc('widgetRuns', { id: 'deploys' })).runs[0].reason, 'manual')
  assert.match(await rig.rpc('widgetRender', { id: 'deploys' }), /<div class="k-v">3<\/div>/)

  // the CLI's list; Delete refuses your code; unlinked: the watcher stops, the installed one is back
  assert.match((await rig.cli('widget', 'dev', '--list')).out, new RegExp(`${real}  deploys`))
  await assert.rejects(rig.rpc('widgetRm', { id: 'deploys' }), /is your code, linked by laki widget dev/)
  assert.equal((await rig.cli('widget', 'dev', '--off', 'deploys')).out.trim(), 'unlinked deploys')
  assert.equal((await find(rig, 'deploys')).name, 'Installed')
  const before = (await rig.rpc('widgetRuns', { id: 'deploys' })).runs.length
  writeFileSync(join(code, 'widget.json'), JSON.stringify(manifest(4)))
  await sleep(900)
  assert.equal((await rig.rpc('widgetRuns', { id: 'deploys' })).runs.length, before, 'no longer watched')
  assert.equal((await rig.cli('widget', 'dev', '--list')).out.trim(), 'no folders linked: laki widget dev [folder]')
  assert.match((await rig.cli('widget', 'dev', '--off', 'deploys')).err, /isn't linked/)
  mkdirSync(join(rig.env.HOME, 'empty'))
  assert.match((await rig.cli('widget', 'dev', join(rig.env.HOME, 'empty'))).err, /has no widget\.json, nor folders with one/)

  // a one-file extension linked by itself: each save by rename (an editor's) reloads it, not only the first
  const solo = join(realpathSync(rig.env.HOME), 'solo.1m.sh')
  const save = (n: number) => (writeFileSync(`${solo}.tmp`, `#!/bin/sh\n# <laki.name>Solo ${n}</laki.name>\necho '{}'\n`, { mode: 0o755 }), renameSync(`${solo}.tmp`, solo))
  save(1)
  await rig.rpc('widgetDev', { folder: solo })
  for (const n of [2, 3]) {
    save(n)
    await until(() => find(rig, 'solo').then(w => w?.name === `Solo ${n}`), `save ${n} reloaded`)
  }
})

test('widget runs: an action and its fetch after, with their reason; LAKI_REFRESH_REASON per reason', async t => {
  const rig = await fresh(t)
  const d = join(rig.data, 'widgets', 'why')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Why', fetch: 'printf \'{"r": "%s"}\' "$LAKI_REFRESH_REASON"', actions: { poke: 'echo poked >&2; echo "$LAKI_REFRESH_REASON"' } }))
  writeFileSync(join(d, 'widget.html'), '{{data.r}}')
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'why', on: true })
  await until(async () => (await rig.rpc('widgetRender', { id: 'why' })) === 'settings', 'turned on: settings')
  await rig.rpc('widgetRun', { id: 'why' })
  assert.equal(await rig.rpc('widgetRender', { id: 'why' }), 'manual')
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'why', action: 'poke' }), { ok: true, out: 'action:poke' })
  await until(async () => (await rig.rpc('widgetRender', { id: 'why' })) === 'action:poke', 'fetched after the action')
  const { runs } = await rig.rpc('widgetRuns', { id: 'why' })
  assert.deepEqual(
    runs.map((r: any) => [r.reason, r.action ?? 'fetch', r.ok]),
    [
      ['action:poke', 'fetch', true],
      ['action:poke', 'poke', true],
      ['manual', 'fetch', true],
      ['settings', 'fetch', true],
    ],
  )
  assert.equal(runs[1].stderr, 'poked')
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Why', fetch: 'echo oops >&2; exit 3' }))
  await rig.rpc('widgetReload')
  await until(() => rig.rpc('widgetRuns', { id: 'why' }).then(x => x.runs[0].reason === 'reload' && !x.runs[0].ok), 'a failed reload')
  const bad = (await rig.rpc('widgetRuns', { id: 'why' })).runs[0]
  assert.equal(bad.exit, 3)
  assert.equal(bad.stderr, 'oops')
  assert.equal(bad.error, 'oops')
})

// N10: an agent's own code never runs unlooked: what laki widget new makes and restore brings back is off, a folder it
// links is trusted as a repo's extensions are (on after a look, off again as it changes, never the on of the one it
// shadows), and /laki:extension is yours to start, running only what reads unasked
test("an agent's extensions: new and restored off; a folder it links trusted as a repo's; /laki:extension yours, read-only unasked", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const from = { ws: ws.id, tab: ((await until(() => rig.tab(ws.id), 'its agent')) as any).id }

  // new: yours on and fetched; an agent's off, nothing run
  const mine = await rig.rpc('widgetNew', { kind: 'number', name: 'Mine' })
  assert.ok((await find(rig, mine.id)).at, 'yours: fetched')
  const its = await rig.rpc('widgetNew', { kind: 'number', name: 'Its', from })
  assert.match(its.note, /made off: only the user turns it on/)
  assert.deepEqual([(await find(rig, its.id)).on, (await find(rig, its.id)).at], [false, undefined])
  // restore: an agent's comes back off
  await rig.rpc('widgetRm', { id: mine.id })
  const [gone] = await rig.rpc('widgetTrash')
  const back = await rig.rpc('widgetRestore', { trash: gone.trash, from })
  assert.deepEqual([back.on, back.note], [false, 'restored off: only the user turns it on (Settings › Extensions)'])

  // an installed one, on; the agent links a folder of its own, then adds one of that id there
  const inst = join(rig.data, 'widgets', 'probe')
  mkdirSync(inst, { recursive: true })
  writeFileSync(join(inst, 'widget.json'), JSON.stringify({ name: 'Installed', fetch: 'echo {}' }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'probe', on: true })
  const code = join(rig.home, 'agent-code')
  mkdirSync(join(code, 'helper'), { recursive: true })
  writeFileSync(join(code, 'helper', 'widget.json'), JSON.stringify({ name: 'Helper', fetch: 'echo {}' }))
  const r = await rig.rpc('widgetDev', { folder: code, from })
  assert.match(r.note, /linked, off/)
  await sleep(500) // the watch starts a moment after (FSEvents): a folder made before it is never seen
  const ran = join(rig.home, 'ran')
  mkdirSync(join(code, 'probe'))
  writeFileSync(join(code, 'probe', 'fetch.sh'), `touch "${ran}"; echo '{}'\n`)
  writeFileSync(join(code, 'probe', 'widget.json'), JSON.stringify({ name: 'Agent probe', fetch: 'sh fetch.sh' }))
  let w = await until(() => find(rig, 'probe').then(w => w?.name === 'Agent probe' && w), 'its copy first')
  await sleep(600) // the watcher's fetch, had it been on
  w = await find(rig, 'probe')
  assert.deepEqual([w.on, w.agentDev, existsSync(ran)], [false, true, false], "never the installed one's on")
  // on only after a look; its run then
  await assert.rejects(rig.rpc('widgetSet', { id: 'probe', on: true }), /is in a folder an agent linked: look at what it runs first/)
  const { hash } = await rig.rpc('widgetWhat', { id: 'probe' })
  await rig.rpc('widgetSet', { id: 'probe', on: true, seen: hash })
  await until(() => existsSync(ran), 'its fetch ran once you looked')
  // its fetch.sh changes: off, nothing of the new runs
  rmSync(ran)
  writeFileSync(join(code, 'probe', 'fetch.sh'), `touch "${ran}"; echo '{"n": 2}'\n`)
  w = await until(() => find(rig, 'probe').then(w => !w.on && w), 'off as it changed')
  assert.equal(w.changed, true)
  assert.match((await rig.rpc('widgetRun', { id: 'probe' })).error, /is in a folder an agent linked/)
  assert.ok(!existsSync(ran))
  // in a git repo whose .gitignore it writes: its files are still all of its folder's
  execFileSync('git', ['init', '-q'], { cwd: code })
  writeFileSync(join(code, '.gitignore'), 'lib.sh\n')
  writeFileSync(join(code, 'probe', 'lib.sh'), 'true\n')
  writeFileSync(join(code, 'probe', 'fetch.sh'), `. ./lib.sh; touch "${ran}"; echo '{}'\n`)
  const look = await until(() => rig.rpc('widgetWhat', { id: 'probe' }).then(x => x.text.includes('lib.sh') && x), 'the ignored file shown')
  await rig.rpc('widgetSet', { id: 'probe', on: true, seen: look.hash })
  await until(() => existsSync(ran), 'on once looked at')
  rmSync(ran)
  writeFileSync(join(code, 'probe', 'lib.sh'), 'echo changed >&2\n')
  await until(() => find(rig, 'probe').then(w => !w.on), 'off as its ignored file changed')
  assert.ok(!existsSync(ran))
  // you link it: yours again, as dev mode always was
  await rig.rpc('widgetDev', { folder: code })
  w = await find(rig, 'probe')
  assert.deepEqual([w.on, w.agentDev, w.changed], [true, undefined, undefined])

  const cmd = readFileSync(join(rig.data, 'claude-plugin', 'commands', 'extension.md'), 'utf8')
  const head = cmd.split('\n---\n')[0]
  assert.match(head, /^disable-model-invocation: true$/m)
  assert.ok(!head.includes('widget:*'), 'no laki widget subcommand pre-allowed wholesale')
  for (const sub of ['ls', 'kit', 'check', 'what', 'logs']) assert.ok(head.includes(` widget ${sub}:*)`), sub)
  for (const sub of ['new', 'dev', 'set', 'on', 'push', 'action', 'tool', 'restore']) assert.ok(!head.includes(` widget ${sub}:*)`), sub)
})

// #10: an agent's link of a folder with the id of one you have on, a stream, started its command with your secrets as the
// rescan ran, before widgetDev turned it off: refused now; a new id's store is written off before the scan, so none starts
test("#10: an agent's dev link over an installed id is refused, nothing starts; a new id's comes in off, nothing run", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', local: true })
  const from = { ws: ws.id, tab: ((await until(() => rig.tab(ws.id), 'its agent')) as any).id }
  const app = await rig.connect() // a window shown: streams start only then
  t.after(() => app.close())
  await app.call('view', { tab: null, focused: true, shown: true })
  const inst = join(rig.data, 'widgets', 'feed')
  mkdirSync(inst, { recursive: true })
  writeFileSync(join(inst, 'widget.json'), JSON.stringify({ name: 'Feed', fetch: 'echo {}' }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'feed', on: true })
  const ran = join(rig.home, 'ran')
  const code = join(rig.home, 'agent-code')
  for (const id of ['feed', 'other']) {
    mkdirSync(join(code, id), { recursive: true })
    writeFileSync(join(code, id, 'widget.json'), JSON.stringify({ name: `Agent ${id}`, stream: true, fetch: `touch "${ran}-${id}"; echo '{}'; sleep 30` }))
  }
  await assert.rejects(rig.rpc('widgetDev', { folder: code, from }), /has feed: it would cover your Feed \(its settings and secrets\)/)
  await sleep(600)
  assert.deepEqual([existsSync(`${ran}-feed`), existsSync(`${ran}-other`)], [false, false])
  assert.equal((await find(rig, 'feed')).name, 'Feed')
  assert.deepEqual((await rig.rpc('widgetDev', { list: true })).links, [])
  // your own dev link counts as yours: an agent's folder with its id is refused, and it stays on
  const yours = join(rig.home, 'my-code')
  mkdirSync(join(yours, 'mine'), { recursive: true })
  writeFileSync(join(yours, 'mine', 'widget.json'), JSON.stringify({ name: 'Mine', fetch: 'echo {}' }))
  await rig.rpc('widgetDev', { folder: yours })
  const theirs = join(rig.home, 'agent-mine')
  mkdirSync(join(theirs, 'mine'), { recursive: true })
  writeFileSync(join(theirs, 'mine', 'widget.json'), JSON.stringify({ name: 'Agent mine', fetch: 'echo {}' }))
  await assert.rejects(rig.rpc('widgetDev', { folder: theirs, from }), /has mine: it would cover your Mine/)
  assert.deepEqual([(await find(rig, 'mine')).name, (await find(rig, 'mine')).on], ['Mine', true])
  await rig.rpc('widgetDev', { off: yours })
  // without it: a new id, whose store says on (one you had once), comes in off
  rmSync(join(code, 'feed'), { recursive: true })
  writeFileSync(join(rig.data, 'widget-data', 'other.json'), JSON.stringify({ on: true }))
  const r = await rig.rpc('widgetDev', { folder: code, from })
  assert.match(r.note, /linked, off/)
  await sleep(600)
  assert.deepEqual([(await find(rig, 'other')).on, existsSync(`${ran}-other`)], [false, false])
})
