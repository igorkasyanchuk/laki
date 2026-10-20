// Extensions' logs: off by default; on for all (Settings) or one (Keep a log); Laki's lines, runs and stderr with their
// levels, masked; laki widget log / logs (-f); rotated; kept through the trash, not by a remix; the user's switch only
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fresh, until } from './helpers.ts'

const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}
const logs = async (rig: any, id: string, o: object = {}) => {
  await new Promise(r => setTimeout(r, 650)) // written in batches every 500 ms
  return rig.rpc('widgetLogs', { id, ...o })
}

test('logs: nothing while off; Laki’s lines, a run’s line and its stderr with their levels, once on for all or for one', async t => {
  const rig = await fresh(t)
  make(rig, 'x', { name: 'X', fetch: 'echo "warn: careful" >&2; echo "plain line" >&2; echo "error: it broke" >&2; echo \'{"n": 1}\'', actions: { go: 'echo "debug: going" >&2; echo done' } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'x', on: true })
  await rig.rpc('widgetRun', { id: 'x' })
  let r = await logs(rig, 'x')
  assert.deepEqual([r.on, r.lines], [false, []])
  assert.ok(!existsSync(join(rig.data, 'widget-data', 'x.log')), 'no file while off')
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === 'x').log, undefined)

  // for every extension (Settings)
  await rig.rpc('settingsSet', { widgetLogs: true })
  await rig.rpc('widgetRun', { id: 'x' })
  r = await logs(rig, 'x')
  assert.equal(r.on, true)
  const seen = r.lines.map((l: any) => `${l.level} ${l.src} ${l.text}`)
  assert.ok(seen.some((l: string) => /^info laki fetch \(manual\): echo/.test(l)), seen.join('\n'))
  assert.ok(seen.includes('warn fetch careful'), 'a line’s prefix is its level, taken off')
  assert.ok(seen.includes('info fetch plain line'))
  assert.ok(seen.includes('error fetch it broke'))
  assert.ok(seen.some((l: string) => /^info fetch ran \(manual\) in \d+ ms, exit 0, \d+ B$/.test(l)), 'the run’s line, at its end')
  assert.ok(seen.findIndex((l: string) => l.endsWith('it broke')) < seen.findIndex((l: string) => /ran \(manual\)/.test(l)), 'stderr before the run’s line')
  const ns = r.lines.map((l: any) => l.n)
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b))
  assert.equal((statSync(join(rig.data, 'widget-data', 'x.log')).mode & 0o777).toString(8), '600')
  const v = (await rig.rpc('state')).widgets.find((w: any) => w.id === 'x')
  assert.equal(v.log, true)
  assert.ok(v.logErr > 0, 'an error line: Settings’ red tag')

  // from a cursor, a level, a source
  const next = r.next
  await rig.rpc('widgetAction', { id: 'x', action: 'go' })
  r = await logs(rig, 'x', { since: next })
  assert.ok(r.lines.every((l: any) => l.n > next))
  assert.ok(r.lines.some((l: any) => l.src === 'action:go' && l.level === 'debug' && l.text === 'going'))
  assert.deepEqual([...new Set((await logs(rig, 'x', { level: 'warn' })).lines.map((l: any) => l.level))].sort(), ['error', 'warn'])
  assert.ok((await logs(rig, 'x', { src: 'action' })).lines.every((l: any) => l.src === 'action:go'))

  // Settings off: this one only with its own switch; an agent can't set it
  await rig.rpc('settingsSet', { widgetLogs: false })
  assert.equal((await logs(rig, 'x')).on, false)
  await assert.rejects(rig.rpc('widgetSet', { id: 'x', log: true, agent: true }), /only you can change whether it keeps a log/)
  await rig.rpc('widgetSet', { id: 'x', log: true })
  const v2 = (await rig.rpc('state')).widgets.find((w: any) => w.id === 'x')
  assert.deepEqual([v2.log, v2.keepLog], [true, true])
  const before = (await logs(rig, 'x')).next
  await rig.rpc('widgetRun', { id: 'x' })
  assert.ok((await logs(rig, 'x', { since: before })).lines.length > 0)
  // off: the file stays until Clear
  await rig.rpc('widgetSet', { id: 'x', log: false })
  r = await logs(rig, 'x')
  assert.equal(r.on, false)
  assert.ok(r.lines.length > 0, 'kept')
  await rig.rpc('widgetLogClear', { id: 'x' })
  assert.deepEqual((await logs(rig, 'x')).lines, [])
})

test('logs: laki widget log (exit 0 while off), a secret masked, laki widget logs -f, rotation, the trash, a remix', async t => {
  const rig = await fresh(t, { env: { LAKI_WIDGET_LOG_MAX: '4000' } })
  make(rig, 'y', { name: 'Y', config: { token: { type: 'secret' }, api_key: 'zzzz9999', who: 'me' }, fetch: 'echo "using $WIDGET_TOKEN and $WIDGET_API_KEY for $WIDGET_WHO" >&2; echo {}' })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'y', on: true, config: { token: 'abcd1234' } })

  // off: nothing, and fine for a script
  let c = await rig.cli('widget', 'log', 'y', 'hello')
  assert.equal(c.code, 0, c.err)
  assert.deepEqual((await logs(rig, 'y')).lines, [])

  await rig.rpc('widgetSet', { id: 'y', log: true })
  c = await rig.cli('widget', 'log', 'y', '--level', 'warn', 'disk', 'nearly', 'full')
  assert.equal(c.code, 0, c.err)
  await rig.rpc('widgetRun', { id: 'y' })
  const r = await logs(rig, 'y')
  assert.ok(r.lines.some((l: any) => l.src === 'cli' && l.level === 'warn' && l.text === 'disk nearly full'))
  const line = r.lines.find((l: any) => /^using/.test(l.text))
  assert.equal(line.text, 'using •••• and •••• for me', 'a secret, and a setting named like one, masked')
  assert.ok(!JSON.stringify(r).includes('abcd1234'))

  // laki widget logs: the last lines; -f follows
  const ls = await rig.cli('widget', 'logs', 'y', '-n', '2')
  assert.equal(ls.code, 0, ls.err)
  assert.equal(ls.out.trim().split('\n').length, 2)
  const root = fileURLToPath(new URL('..', import.meta.url))
  const f = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'src/cli/main.ts'), 'widget', 'logs', 'y', '-f'], { env: rig.env })
  t.after(() => f.kill())
  let out = ''
  f.stdout.on('data', d => (out += d))
  await until(() => out.includes('disk nearly full'), 'the last lines first')
  await rig.cli('widget', 'log', 'y', 'a new line')
  await until(() => out.includes('a new line'), '-f gets the new line')
  f.kill()

  // past LOG_MAX: <id>.log.1 and <id>.log, two at most; read across both, in order
  for (let i = 0; i < 6; i++) {
    await rig.rpc('widgetLog', { id: 'y', text: `line ${i} ${'x'.repeat(1900)}` }) // two a file: rotated more than once
    await new Promise(r => setTimeout(r, 550))
  }
  const files = readdirSync(join(rig.data, 'widget-data')).filter(n => n.startsWith('y.log'))
  assert.deepEqual(files.sort(), ['y.log', 'y.log.1'])
  const all = (await logs(rig, 'y')).lines
  assert.ok(all.some((l: any) => l.text.startsWith('line 5')))
  assert.ok(!all.some((l: any) => l.text.startsWith('a new line')), 'the oldest went')

  // deleted: the log goes to the trash with it, and comes back; a remix starts without one
  const del = await rig.rpc('widgetRm', { id: 'y' })
  assert.ok(!existsSync(join(rig.data, 'widget-data', 'y.log')))
  await rig.rpc('widgetRestore', { trash: del.trash })
  assert.ok((await logs(rig, 'y')).lines.some((l: any) => l.text.startsWith('line 5')))
  const rx = await rig.rpc('widgetRemix', { id: 'y' })
  assert.deepEqual((await logs(rig, rx.id)).lines, [])
})
