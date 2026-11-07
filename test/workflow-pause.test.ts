// Pause after this block: the block on finishes, the run parks before the next, Resume goes on once; a restart while
// pausing and while paused; the CLI's laki flow pause|resume.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

const HOLD = `# Hold
Two commands.

runs in: worktree · session: new · when done: keep

## start
input: task
next: one

## one
run: sleep 2 && echo one >> ran.txt
ok: two
fail: bad

## two
run: echo two >> ran.txt
ok: done
fail: bad

## done
end: success

## bad
end: failed
`

test('workflow pause after this block: parks before the next, Resume once; a restart while pausing and while paused; the CLI', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'hold', text: HOLD })
  const get = (id: string) => rig.rpc('flowGet', { id })
  const ran = async (id: string) => {
    const at = (await get(id)).ws
    const ws = (await rig.rpc('state')).workspaces.find((w: any) => w.id === at)
    const f = join(ws.path, 'ran.txt')
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  }
  const parked = (id: string) => until(async () => (x => x.wait?.kind === 'hold' && x)(await get(id)), 'parked', 15000)

  const a = await rig.rpc('flowStart', { workflow: 'hold', project: p.id, task: 'first' })
  await until(async () => (await get(a.id)).cur === 'one', 'on one')
  let r = await rig.rpc('flowHold', { id: a.id, on: true })
  assert.ok(r.hold, 'pausing')
  assert.equal(r.status, 'running', 'the block goes on')
  assert.equal((await rig.rpc('flowHold', { id: a.id, on: true })).hold, r.hold, 'asked twice: one pause')
  assert.equal((await rig.rpc('flowHold', { id: a.id, on: false })).hold, undefined, 'Resume while pausing takes it back')
  await rig.rpc('flowHold', { id: a.id, on: true })

  r = await parked(a.id)
  assert.equal(r.status, 'paused')
  assert.equal(r.cur, 'two', 'before the next block, not entered')
  assert.equal(r.visits.two, undefined)
  assert.equal(r.hold, undefined)
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'one:ok'])
  assert.ok(r.log.some((l: string) => / paused before two: Resume goes on from there$/.test(l)))
  await sleep(500)
  assert.equal(await ran(a.id), 'one\n', 'nothing after it ran')
  await assert.rejects(rig.rpc('flowHold', { id: a.id, on: true }), /paused already/)

  // a restart while paused: still parked, nothing ran (RESUME_AFTER passed)
  await rig.stop()
  await rig.start()
  await sleep(9000)
  r = await get(a.id)
  assert.equal(r.wait?.kind, 'hold')
  assert.equal(await ran(a.id), 'one\n')
  assert.ok(!r.log.some((l: string) => /Laki restarted: back at/.test(l)), 'not brought back at a block')

  // Resume, through the CLI: the next block once, then the end; a second Resume refused
  const res = await rig.cli('flow', 'resume', a.id)
  assert.equal(res.code, 0, res.err)
  r = await until(async () => (x => x.status === 'done' && x)(await get(a.id)), 'done', 15000)
  assert.equal(await ran(a.id), 'one\ntwo\n', 'one not run again')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'one:ok', 'two:ok'])
  await assert.rejects(rig.rpc('flowHold', { id: a.id, on: false }), /done already/)

  // a restart while pausing: the block cut short runs again and finishes, then it parks
  const b = await rig.rpc('flowStart', { workflow: 'hold', project: p.id, task: 'second' })
  await until(async () => (await get(b.id)).cur === 'one', 'b on one')
  const cli = await rig.cli('flow', 'pause', b.id)
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, /running at one, pausing after it/)
  await rig.stop()
  await rig.start()
  r = await parked(b.id)
  assert.equal(r.cur, 'two')
  assert.equal(await ran(b.id), 'one\n', 'cut short before its echo, then once')
  assert.match((await rig.cli('flow', 'show', b.id)).out, /paused before two/)
  assert.equal((await rig.rpc('flowStop', { id: b.id })).status, 'stopped', 'Stop still ends a parked run')
  // stopped while pausing: no pause left on it; on must be true or false
  const c = await rig.rpc('flowStart', { workflow: 'hold', project: p.id, task: 'third' })
  await until(async () => (await get(c.id)).cur === 'one', 'c on one')
  await assert.rejects(rig.rpc('flowHold', { id: c.id, on: 'false' }), /on: true pauses, false resumes/)
  await assert.rejects(rig.rpc('flowHold', { id: c.id, on: false }), /isn't paused/)
  await rig.rpc('flowHold', { id: c.id, on: true })
  r = await rig.rpc('flowStop', { id: c.id })
  assert.deepEqual([r.status, r.hold], ['stopped', undefined])
  await assert.rejects(rig.rpc('flowHold', { id: 'nope', on: true }), /no workflow run nope/)
})
