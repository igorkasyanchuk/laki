// Workflow blocks: parallel (children at once, join all or any, a restart mid-block) and a workflow run as a block of
// another (its task and values in, outputs back, a restart inside it, Simulate, the run's one budget).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { check, FLOW_ENDED, flowVars, parse, toFile } from '../src/shared/workflow.ts'
import { fresh, until } from './helpers.ts'

// parallel: commands (and AI calls, webhooks) at once, join all or any
const PAR = (join: string, kids: string) => `# Par
At once.

runs in: main

## start
input: task?
next: both

## both
parallel: ${join}
${kids}ok: done
fail: bad

## done
end: success

## bad
end: failed
`
const kid = (id: string, cmd: string) => `  ## ${id}\n  run: ${cmd}\n`

test('workflow parallel: the file reads back; check refuses an agent, an ask or a parallel inside, one alone, a way out of its own', () => {
  const { workflow, problems } = parse(PAR('any', kid('a', 'echo a') + '  ## b\n  name: Bee\n  run: echo b\n  timeout: 3\n  out: n\n'), 'par')
  assert.deepEqual([problems, check(workflow)], [[], []])
  const both = workflow.blocks.find(b => b.id === 'both')!
  assert.deepEqual([both.kind, both.join, both.children!.map(c => [c.id, c.kind, c.cmd, c.timeout])], ['parallel', 'any', [['a', 'run', 'echo a', undefined], ['b', 'run', 'echo b', 3]]])
  assert.match(toFile(workflow), /^## both\nparallel: any\n {2}## a\n {2}run: echo a\n {2}## b\n {2}name: Bee\n {2}run: echo b\n {2}timeout: 3\n {2}out: n\nok: done\nfail: bad$/m)
  assert.equal(toFile(parse(toFile(workflow)).workflow), toFile(workflow))
  assert.ok(flowVars(workflow).some(v => v.name === 'steps.b.n'), 'a child’s outputs are variables too')
  const bad = (kids: string) => check(parse(PAR('all', kids)).workflow)
  assert.deepEqual(bad(kid('a', 'echo a') + '  ## w\n  agent: claude\n  > hi\n'), ["w: an agent block can't run inside a parallel block (yet): commands, AI calls and webhooks can"])
  assert.ok(bad(kid('a', 'echo a') + '  ## q\n  ask: Go?\n  - Yes → done\n  - No → bad\n').includes("q: an ask can't run inside a parallel block (yet): commands, AI calls and webhooks can"))
  assert.ok(bad(kid('a', 'echo a') + '  ## in\n  parallel: all\n').includes("in: a parallel block can't run inside a parallel block (yet): commands, AI calls and webhooks can"))
  assert.deepEqual(bad(kid('a', 'echo a')), ['both: 2 to 6 blocks run together (it has 1)'])
  assert.deepEqual(bad(kid('a', 'echo a') + '  ## b\n  run: echo b\n  ok: done\n'), ["b: a parallel block's blocks have no ways out of their own: its ok: and fail: go on"])
  assert.deepEqual(parse(PAR('all', kid('a', 'echo a') + kid('a', 'echo b'))).problems, ['line 14: two blocks are called a'])
  assert.deepEqual(parse(PAR('some', kid('a', 'echo a') + kid('b', 'echo b'))).problems, ['line 11: parallel: all or any'])
})

test('workflow parallel runs: all ok together, a failure under all stops the rest, any goes on with the first', async t => {
  const srv = createServer(async (q, res) => {
    for await (const _ of q);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ended = async (wf: string) => {
    const run = await rig.rpc('flowStart', { workflow: wf, project: p.id })
    return until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: run.id })), `${wf} ends`, 20000)
  }
  await rig.rpc('flowSave', { id: 'all', text: PAR('all', kid('a', 'echo one') + kid('b', 'sleep 1; echo two') + `  ## hook\n  webhook: http://127.0.0.1:${(srv.address() as AddressInfo).port}/x\n`) })
  let r = await ended('all')
  assert.equal(r.status, 'done')
  assert.deepEqual([r.vars['steps.a.output'], r.vars['steps.b.output'], r.vars['steps.hook.status']], ['one', 'two', '200'])
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}:${d.why}`), ['start:next:started', 'both:ok:every one ok'])
  assert.ok(r.log.some((l: string) => /^\S+ both: a, b, hook at once$/.test(l)))
  assert.ok(r.log.some((l: string) => /^\S+ {3}b → ok: exit 0$/.test(l)), 'each child’s own lines')

  const t0 = Date.now()
  await rig.rpc('flowSave', { id: 'fails', text: PAR('all', kid('slow', 'sleep 20; echo late') + kid('boom', 'echo nope; exit 3')) })
  r = await ended('fails')
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.decisions[1], { ...r.decisions[1], block: 'both', exit: 'fail', why: 'boom failed: exit 3: nope' })
  assert.equal(r.vars['steps.slow.output'], undefined, 'the slow one stopped')
  assert.ok(Date.now() - t0 < 15000)

  await rig.rpc('flowSave', { id: 'any', text: PAR('any', kid('slow', 'sleep 20; echo late') + kid('no', 'exit 1') + kid('quick', 'sleep 1; echo quick')) })
  r = await ended('any')
  assert.equal(r.status, 'done')
  assert.deepEqual([r.decisions[1].exit, r.decisions[1].why, r.vars['steps.no.code'], r.vars['steps.quick.output'], r.vars['steps.slow.output']], ['ok', 'quick first: exit 0', '1', 'quick', undefined])
  await rig.rpc('flowSave', { id: 'none', text: PAR('any', kid('x', 'exit 1') + kid('y', 'exit 2')) })
  r = await ended('none')
  assert.deepEqual([r.status, r.decisions[1].exit, r.decisions[1].why], ['failed', 'fail', 'every one failed'])
})

test('workflow parallel: a restart mid-block runs only the children not done yet', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ran = join(rig.data, 'ran.txt')
  const go = join(rig.data, 'go')
  await rig.rpc('flowSave', { id: 'par', text: PAR('all', kid('fast', `echo x >> "${ran}"`) + kid('wait', `while [ ! -f "${go}" ]; do sleep 0.2; done; echo went`)) })
  const run = await rig.rpc('flowStart', { workflow: 'par', project: p.id })
  const get = () => rig.rpc('flowGet', { id: run.id })
  await until(async () => (await get()).par?.both?.fast === 'ok', 'the fast one done')
  await rig.stop()
  await rig.start()
  writeFileSync(go, '')
  const r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get()), 'it ends', 30000)
  assert.equal(r.status, 'done')
  assert.equal(readFileSync(ran, 'utf8'), 'x\n', 'the finished one ran once')
  assert.equal(r.vars['steps.wait.output'], 'went')
  assert.ok(r.log.some((l: string) => /^\S+ both: wait at once \(1 done before\)$/.test(l)))
})

// a workflow run as a block of another: its task and values in, what its blocks name back
const SUB = `# Sub
Gives a title.

runs in: main
var who: nobody

## start
input: task
next: name

## name
run: printf '{"title": "%s"}' "{{vars.who}} {{task}}"
out: title
ok: ask
fail: bad

## ask
ask: Go on?
- Yes → done
- No → bad

## done
end: success
> sub done

## bad
end: failed
`
const CALLER = `# Caller
Runs Sub.

runs in: main

## start
input: task
next: sub

## sub
workflow: Sub
with task: of {{task}}
with who: {{task}}
ok: after
fail: bad

## after
run: echo got {{steps.sub.title}}, {{steps.sub.output}}
ok: done
fail: bad

## done
end: success

## bad
end: failed
`

test('workflow call: another workflow inside the run, its task and values in, its outputs back; a restart mid-call goes on inside it; its failure the block’s', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const get = (id: string) => rig.rpc('flowGet', { id })
  await rig.rpc('flowSave', { id: 'caller', text: CALLER })
  await assert.rejects(rig.rpc('flowStart', { workflow: 'caller', project: p.id, task: 'ann' }), /Caller can't run: sub: no workflow Sub here/)
  await rig.rpc('flowSave', { id: 'sub', text: SUB })
  const run = await rig.rpc('flowStart', { workflow: 'caller', project: p.id, task: 'ann' })
  let r = await until(async () => (x => x.status === 'waiting' && x)(await get(run.id)), 'its ask')
  assert.equal(r.cur, 'sub/ask')
  assert.equal(r.vars['steps.sub/name.title'], 'ann of ann', 'its own variable, as with: gave it, and its task')
  assert.equal((await rig.rpc('state')).flows.find((f: any) => f.id === run.id).block, 'sub › ask')
  assert.ok(r.log.some((l: string) => /^\S+ sub: runs Sub: of ann$/.test(l)))
  assert.ok(r.log.some((l: string) => /^\S+ {3}sub › name → ok: exit 0$/.test(l)), 'its lines indented')

  await rig.stop()
  await rig.start()
  assert.equal((await get(run.id)).cur, 'sub/ask', 'still in it')
  await rig.rpc('flowAnswer', { id: run.id, n: 0 })
  r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get(run.id)), 'the end')
  assert.equal(r.status, 'done')
  assert.equal(r.vars['steps.after.output'], 'got ann of ann, sub done')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'sub/start:next', 'sub/name:ok', 'sub/ask:Yes', 'sub/done:ok', 'sub:ok', 'after:ok'])

  const no = await rig.rpc('flowStart', { workflow: 'caller', project: p.id, task: 'bo' })
  await until(async () => (await get(no.id)).status === 'waiting', 'its ask')
  await rig.rpc('flowAnswer', { id: no.id, n: 1 })
  r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get(no.id)), 'the end')
  assert.deepEqual([r.status, r.decisions.at(-1).block, r.decisions.at(-1).exit], ['failed', 'sub', 'fail'])
})

test('workflow call: the run’s one budget counts what the called workflow spends', async t => {
  const srv = createServer(async (q, res) => {
    for await (const _ of q);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'x/fast', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.02 } }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  await rig.rpc('flowSave', { id: 'costs', text: '# Costs\nruns in: main\n\n## start\ninput: task?\nnext: sum\n\n## sum\nllm: x/fast\n> {{task}}\nok: more\n\n## more\nrun: echo more\nok: e\n\n## e\nend: success\n' })
  await rig.rpc('flowSave', { id: 'dear', text: '# Dear\nruns in: main · budget: $0.01\n\n## start\ninput: task?\nnext: c\n\n## c\nworkflow: costs\nok: e\nfail: e\n\n## e\nend: success\n' })
  const run = await rig.rpc('flowStart', { workflow: 'dear', project: p.id })
  const r = await until(async () => (x => x.wait?.kind === 'stuck' && x)(await rig.rpc('flowGet', { id: run.id })), 'past $0.01 inside the call')
  assert.deepEqual([r.cur, r.cost, r.wait.question], ['c/more', 0.02, "its budget: $0.01 spent on AI calls and agents' turns"])
})

test('workflow call: Simulate steps through the called blocks, by their <call>/<id>', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('flowSave', { id: 'sub', text: SUB })
  await rig.rpc('flowSave', { id: 'caller', text: CALLER })
  await assert.rejects(rig.rpc('flowStart', { workflow: 'caller', project: p.id, task: 'x', simulate: { answers: { 'sub/nope': 'ok' } } }), /sub\/nope: no such block/)
  const run = await rig.rpc('flowStart', { workflow: 'caller', project: p.id, task: 'x', simulate: { answers: { 'sub/name': 'ok', 'sub/ask': 'Yes', after: 'ok' } } })
  const r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: run.id })), 'the end')
  assert.equal(r.status, 'done')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'sub/start:next', 'sub/name:ok', 'sub/ask:Yes', 'sub/done:ok', 'sub:ok', 'after:ok'])
  assert.ok(r.sim.sent.some((s: any) => s.block === 'sub/name' && s.what === `$ printf '{"title": "%s"}' "x of x"`), "what it would have run, with:'s values in")
})
