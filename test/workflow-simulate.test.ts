// W7: a simulated run: nothing runs (no workspace, tab, process or request); each block's way from your answers, a
// recorded run's, else you pick it; kept out of at once, stats and notifications. workflow.ts' simStart, simWork
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

// fix, then test: 3 tries at most (max), then it asks you
const LOOP = `# Fix loop
Fixes until the tests pass, then asks.

runs in: worktree · session: new

## start
input: task
next: fix

## fix
agent: claude
> fix {{task}}
next: test
error: help
max: 3 → help

## test
run: npm test -- {{task}}
ok: done
fail: fix

## help
ask: Still failing: what now?
- Again → fix
- Give up → bad

## done
end: success · notify: yes · phone: yes

## bad
end: failed
`
// commands only (quick to run for real), in the project's folder
const REPLAY = `# Replay
Probes, counts, decides.

runs in: main · at once: 1

## start
input: task
next: probe

## probe
run: test -f README.md
ok: count
fail: bad

## count
run: test -f nope.txt
ok: done
fail: which

## which
choice: task contains "go"
- Yes → done
- No → bad

## done
end: success

## bad
end: failed
`

test('W7: a simulated loop driven by fail ×3 reaches its ask; nothing runs; a pick goes on; answers checked', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const app = await rig.connect()
  await rig.rpc('flowSave', { id: 'loop', text: LOOP })
  const before = (await rig.rpc('state')).workspaces.length
  await assert.rejects(rig.rpc('flowStart', { workflow: 'loop', project: p.id, simulate: { answers: { test: 'maybe' } } }), /test=maybe\? its ways: ok, fail/)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'loop', project: p.id, simulate: { answers: { nope: 'ok' } } }), /nope: no such block in Fix loop/)

  const sim = await rig.rpc('flowStart', { workflow: 'loop', project: p.id, task: 'the cart', simulate: { answers: { fix: 'next', test: 'fail' } } })
  const r = await until(async () => (x => x.status === 'waiting' && x)(await rig.rpc('flowGet', { id: sim.id })), 'it asks')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'fix:next', 'test:fail', 'fix:next', 'test:fail', 'fix:next', 'test:fail', 'fix:after 3'])
  assert.deepEqual([r.cur, r.wait.kind, r.wait.question, r.wait.options], ['help', 'sim', 'help: which way does it go?', ['Again', 'Give up', 'Stop the run']])
  assert.deepEqual([r.visits.fix, r.visits.test, r.trigger, r.ws], [3, 3, 'simulate', undefined])
  // what each block would have been sent, by visit
  assert.deepEqual(r.sim.sent.map((s: any) => `${s.block}${s.n}`), ['fix1', 'test1', 'fix2', 'test2', 'fix3', 'test3', 'help1'])
  assert.match(r.sim.sent[0].what, /^claude:\n\nfix the cart$/)
  assert.equal(r.sim.sent[1].what, '$ npm test -- the cart')
  assert.match(r.log.join('\n'), /fix would be sent \(simulated\)\nclaude:/)
  // nothing ran: no workspace, no tab, no agent started, no notification
  const v = await rig.rpc('state')
  assert.equal(v.workspaces.length, before)
  assert.equal(v.tabs.length, 0)
  assert.ok(!existsSync(rig.env.FAKE_LOG), 'no agent started: the fakes log every start')
  // a pick: Give up, its way to the failed end; still nothing told, no stats
  await rig.rpc('flowAnswer', { id: sim.id, n: 1 })
  const end = await until(async () => (x => x.status !== 'running' && x.status !== 'waiting' && x)(await rig.rpc('flowGet', { id: sim.id })), 'it ends')
  assert.equal(end.status, 'failed')
  assert.equal(end.decisions.at(-1).why, 'you picked Give up')
  assert.equal(app.events.filter((e: any) => e.ev === 'flow' && e.id === sim.id).length, 0, 'no notification')
  assert.equal((await rig.rpc('flowList', {})).find((w: any) => w.id === 'loop').stats, undefined, 'not in its stats')

  // the CLI: exit 1 where it asks, its path and what each would be sent
  const cli = await rig.cli('flow', 'run', 'loop', p.id, 'the', 'cart', '--simulate', '--answer', 'fix=next', '--answer', 'test=fail', '--answer', 'test=fail', '--answer', 'test=ok')
  assert.equal(cli.code, 0, cli.err) // the third visit's ok (the last answer stands for later visits): done
  assert.match(cli.out, /simulated: done/)
  assert.match(cli.out, /^test → ok: your answer \(visit 3\)$/m)
  assert.match(cli.out, /^fix \(3\): claude: fix the cart$/m)
  const asks = await rig.cli('flow', 'run', 'loop', p.id, 'x', '--simulate', '--answer', 'fix=next', '--answer', 'test=fail')
  assert.equal(asks.code, 1)
  assert.match(asks.out, /asks: help: which way does it go\?\n {2}0\. Again\n {2}1\. Give up\n {2}2\. Stop the run/)
  assert.equal((await rig.rpc('state')).workspaces.length, before)
  assert.ok(!existsSync(`${rig.repo}/node_modules`), 'npm never ran')
  app.close()
})

test('W7: a recorded run replays to the same end; a simulation takes no place in at once', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'replay', text: REPLAY })
  // a simulation with no answers asks at the first block with two ways, and holds no slot (at once: 1)
  const parked = await rig.rpc('flowStart', { workflow: 'replay', project: p.id, task: 'go', simulate: {} })
  await until(async () => (await rig.rpc('flowGet', { id: parked.id })).status === 'waiting', 'it asks at probe')
  assert.equal((await rig.rpc('flowGet', { id: parked.id })).cur, 'probe')
  const real = await rig.rpc('flowStart', { workflow: 'replay', project: p.id, task: 'go' })
  assert.equal(real.status, 'running', 'not queued behind a simulation')
  const done = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: real.id })), 'the real run done')
  const ways = (x: any) => x.decisions.map((d: any) => `${d.block}:${d.exit}`)
  assert.deepEqual(ways(done), ['start:next', 'probe:ok', 'count:fail', 'which:Yes'])
  // replayed: the same ways, the same end, said so
  const sim = await rig.rpc('flowStart', { workflow: 'replay', project: p.id, task: 'go', simulate: { from: real.id } })
  const again = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: sim.id })), 'the replay done')
  assert.deepEqual(ways(again), ways(done))
  assert.equal(again.decisions[1].why, `as run ${real.id} went (visit 1)`)
  // an answer wins over the run's way
  const other = await rig.rpc('flowStart', { workflow: 'replay', project: p.id, task: 'go', simulate: { from: real.id, answers: { which: 'No' } } })
  assert.equal((await until(async () => (x => x.status === 'failed' && x)(await rig.rpc('flowGet', { id: other.id })), 'its own end')).decisions.at(-1).exit, 'No')
  // its CLI: exit 0 at a done end; a run of another workflow refused
  const cli = await rig.cli('flow', 'run', 'replay', p.id, 'go', '--simulate', '--from', real.id)
  assert.equal(cli.code, 0, cli.err)
  await rig.rpc('flowSave', { id: 'other', text: REPLAY.replace('# Replay', '# Other') })
  await assert.rejects(rig.rpc('flowStart', { workflow: 'other', project: p.id, simulate: { from: real.id } }), new RegExp(`run ${real.id} is Replay's, not Other's`))
  // only the real run in the stats
  assert.equal((await rig.rpc('flowList', {})).find((w: any) => w.id === 'replay').stats.runs, 1)
})
