// The wbs CLI against a daemon in a temp home.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('cli: project add, new, ls, send, screen, rm (--json)', async t => {
  const rig = await fresh(t)
  let r = await rig.cli('project', 'add', rig.repo, '--json')
  assert.equal(r.code, 0, r.err)
  const proj = JSON.parse(r.out)
  r = await rig.cli('new', proj.id, '--preset', 'shell', '--name', 'cli-ws', '--json')
  assert.equal(r.code, 0, r.err)
  const ws = JSON.parse(r.out)
  assert.equal(ws.branch, 'wb/cli-ws')
  r = await rig.cli('ls', '--json')
  const v = JSON.parse(r.out)
  assert.deepEqual(v.workspaces.map((w: any) => w.id), ['cli-ws'])
  r = await rig.cli('ls')
  assert.match(r.out, /cli-ws {2}wb\/cli-ws {2}:3100/)
  r = await rig.cli('send', 'cli-ws/shell', 'echo', 'from-the-cli')
  assert.match(r.out, /sent/)
  await until(async () => (await rig.cli('screen', 'cli-ws/shell')).out.includes('from-the-cli\n'), 'echoed')
  r = await rig.cli('send', 'cli-ws/shell', '--when-idle', 'x')
  assert.equal(r.code, 1)
  assert.match(r.err, /doesn't report when it's done/)
  r = await rig.cli('new', 'nope')
  assert.equal(r.code, 1)
  assert.match(r.err, /no project nope/)
  r = await rig.cli('rm', 'cli-ws')
  assert.equal(r.code, 0, r.err)
  r = await rig.cli('ls', '--json')
  assert.deepEqual(JSON.parse(r.out).workspaces, [])
})

test('cli: hook never fails, even without a daemon', async t => {
  const rig = await fresh(t)
  await rig.stop()
  const started = Date.now()
  rig.env.WB_TAB = 'nope'
  const r = await rig.cli('hook', 'idle')
  assert.equal(r.code, 0)
  assert.ok(Date.now() - started < 1500)
})
