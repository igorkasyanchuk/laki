// Extensions' dev mode (laki widget dev): a folder of your own linked, on, shadowing an installed one of its id,
// watched (a change fetches again; a broken file keeps the last good version), runs with their reason and stderr,
// sample data by hand, masked settings, unlinking
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
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
