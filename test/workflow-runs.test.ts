// Workflow runs: a worktree each, asks past a max, a queued prompt, agent actions, JSON answers, the queue, a workspace you
// have, Run again.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { QUEUE_MAX, check, FLOW_ENDED, flowVars, lastJson, parse, toFile } from '../src/shared/workflow.ts'
import { fresh, sleep, until } from './helpers.ts'
import { AGENT, FLOW } from './flows.ts'

const QUEUE = `# Queue
One at a time.

runs in: worktree · session: new · at once: 1

## start
input: task
next: gate

## gate
ask: Go on?
- Done → end
- Stop → stop

## end
end: success

## stop
end: failed
`

const TWICE = `# Twice
Plan, then check.

runs in: worktree · session: new · when done: keep

## start
input: task
inputs: who=ann
next: plan

## plan
agent: claude
> plan {{task}} for {{inputs.who}}
next: check

## check
run: echo checked: {{steps.plan.answer}}
ok: done
fail: bad

## done
end: success

## bad
end: failed
`

test('workflow runs: on unless turned off, a worktree each, agents, commands, choices, asks, saves, a dry run’s actions', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const own = async () => (await rig.rpc('flowList', {})).filter((w: any) => w.source !== 'builtin') // the templates aside
  assert.deepEqual(await own(), [], 'a fresh state: on with no setting, only the templates')
  assert.equal(typeof (await rig.rpc('state')).flowFiles, 'number', 'the view has them')
  await rig.rpc('settingsSet', { workflows: false })
  await assert.rejects(rig.rpc('flowList', {}), /Workflows are off: turn them on in Settings › General › Pages/)
  assert.equal((await rig.rpc('state')).flowFiles, undefined)
  await rig.rpc('settingsSet', { workflows: true })
  assert.deepEqual(await own(), [])

  // yours, and a project's (in its repo); a built-in is read-only; a run refuses one with problems
  await rig.rpc('flowSave', { id: 'test', text: FLOW })
  assert.equal(readFileSync(join(rig.data, 'workflows', 'test.md'), 'utf8'), FLOW)
  await rig.rpc('flowSave', { id: 'broken', source: 'project', project: p.id, text: '# Broken\n## start\ninput: task\nnext: nowhere\n' })
  const list = await rig.rpc('flowList', { project: p.id })
  assert.deepEqual(list.find((w: any) => w.id === 'broken').problems, ['Start: next goes to nowhere, which isn\'t a block'])
  assert.equal(list.find((w: any) => w.id === 'broken').path, join(p.path, '.laki', 'workflows', 'broken.md'))
  await assert.rejects(rig.rpc('flowSave', { id: 'x', source: 'builtin', text: 'x' }), /x is a template: Use this…/)
  await assert.rejects(rig.rpc('flowSave', { id: '../x', text: 'x' }), /a workflow's id/)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'broken', project: p.id, task: 'x' }), /Broken can't run: Start: next goes to nowhere/)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'test', source: 'yours', project: p.id }), /a task/)

  const run = await rig.rpc('flowStart', { workflow: 'test', source: 'yours', project: p.id, task: 'add CSV', dry: true })
  const ws = (await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws)
  assert.equal(ws.kind, 'worktree')
  assert.equal(ws.flow, run.id, 'its row’s mark')

  // the plan agent's turn, the command, the choice: then the ask, with what it shows
  let r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'waiting' && x
  }, 'the ask', 15000)
  assert.equal(r.cur, 'gate')
  assert.deepEqual(r.wait, { kind: 'ask', question: 'Go on?', show: "fine add CSV", options: ['Build', 'Stop'] })
  assert.equal(r.vars['steps.plan.answer'], 'answer: plan add CSV')
  assert.equal(r.vars['steps.check.code'], '0')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'plan:next', 'check:ok', 'said:Yes'])
  const v = await rig.rpc('state')
  assert.equal(v.flows[0].block, 'gate')
  assert.equal(v.flows[0].status, 'waiting')
  assert.equal(v.flows[0].vars, undefined, 'the view is light: flowGet has the rest')

  // waiting survives a restart
  await rig.stop()
  await rig.start()
  assert.equal((await rig.rpc('flowGet', { id: run.id })).status, 'waiting')
  await assert.rejects(rig.rpc('flowAnswer', { id: run.id, n: 5 }), /choice 5\?/)

  // the answer (typed words are {{answer}}), the same tab's second turn, the file, the approve said not done (dry)
  await rig.rpc('flowAnswer', { id: run.id, n: 0, text: 'ship it' })
  r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'done' && x
  }, 'the end', 20000)
  assert.deepEqual(r.decisions.slice(4).map((d: any) => `${d.block}:${d.exit}`), ['gate:Build', 'build:next', 'keep:ok', 'approve:ok'])
  assert.equal(r.decisions[4].you, true)
  assert.equal(r.decisions.at(-1).why, 'dry run: would approve its pr')
  assert.equal(r.tabs.plan, r.tabs.build, 'session run: one tab')
  assert.match(r.vars['steps.build.answer'], /answer: build it: ship it/)
  const storage = (await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws).storage
  assert.match(readFileSync(join(storage, 'notes', 'out.md'), 'utf8'), /answer: build it: ship it/)
  assert.ok(r.log.some((l: string) => /^\S+ done: done$/.test(l)))
  await assert.rejects(rig.rpc('flowStop', { id: run.id }), /done already/)
  await rig.rpc('flowForget', { id: run.id })
  assert.deepEqual((await rig.rpc('state')).flows, [])
})

test('workflow runs: a block past its max asks you, Try again or Stop; at once; a stop', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'fails', text: '# Fails\nruns in: main · at once: 1\n\n## start\ninput: task\nnext: t\n\n## t\nrun: echo nope; exit 3\nok: end\nfail: t\nmax: 2\n\n## end\nend: success\n' })
  const run = await rig.rpc('flowStart', { workflow: 'fails', project: p.id, task: 'x' })
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws).kind, 'local', 'runs in: main')
  const second = await rig.rpc('flowStart', { workflow: 'fails', project: p.id, task: 'y' })
  assert.equal(second.status, 'queued', 'past at once: queued')
  await rig.rpc('flowForget', { id: second.id })
  let r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'waiting' && x
  }, 'stuck')
  assert.equal(r.wait.question, 't ran 2 times')
  assert.equal(r.vars['steps.t.output'], 'nope')
  assert.deepEqual(r.decisions.map((d: any) => d.exit), ['next', 'fail', 'fail', 'after 2'])
  await rig.rpc('flowAnswer', { id: run.id, n: 0 }) // Try again: two more
  r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'waiting' && x.decisions.length > 5 && x
  }, 'stuck again')
  assert.equal(r.visits.t, 2)
  await rig.rpc('flowAnswer', { id: run.id, n: 1 })
  r = await rig.rpc('flowGet', { id: run.id })
  assert.equal(r.status, 'stopped')

  // a stop: its command ends with it
  await rig.rpc('flowSave', { id: 'slow', text: '# Slow\nruns in: main\n\n## start\ninput: task\nnext: s\n\n## s\nrun: sleep 30\nok: e\nfail: e\n\n## e\nend: success\n' })
  const slow = await rig.rpc('flowStart', { workflow: 'slow', project: p.id, task: 'x' })
  await until(async () => (await rig.rpc('flowGet', { id: slow.id })).cur === 's', 'running s')
  await rig.rpc('flowStop', { id: slow.id })
  assert.equal((await rig.rpc('flowGet', { id: slow.id })).status, 'stopped')

  // one an agent wrote (MCP): an agent can't run it until the user saves it in the app
  await rig.rpc('flowSave', { id: 'agents', text: '# Agents\nruns in: main\n\n## start\ninput: task\nnext: e\n\n## e\nend: success\n', by: 'agent' })
  assert.equal((await rig.rpc('flowList', {})).find((w: any) => w.id === 'agents').byAgent, true)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'agents', project: p.id, task: 'x', by: 'agent' }), /an agent wrote Agents: the user runs it first/)
  await rig.rpc('flowSave', { id: 'agents', text: (await rig.rpc('flowList', {})).find((w: any) => w.id === 'agents').text })
  const ok = await rig.rpc('flowStart', { workflow: 'agents', project: p.id, task: 'x', by: 'agent' })
  assert.equal((await until(async () => ((await rig.rpc('flowGet', { id: ok.id })).status === 'done' ? 'done' : ''), 'agents done')), 'done')

  // the CLI
  const ls = await rig.cli('flow')
  assert.match(ls.out, /^fails  yours  Fails  2 runs, 0% ok$/m) // its stats
  assert.match(ls.out, new RegExp(`^${ok.id}  done  Agents: x$`, 'm'))
  assert.match((await rig.cli('flow', 'show', run.id)).out, /^Fails: x  stopped\n\nStart → next: started$/m)
})

test('workflow runs: a prompt queued behind your message waits for its own turn; this turn’s answer only', async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '1200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'two', text: '# Two\nruns in: main\n\n## start\ninput: task\nnext: one\n\n## one\nagent: claude\n> first\nnext: two\n\n## two\nagent: claude\n> second\nnext: e\n\n## e\nend: success\n' })
  const run = await rig.rpc('flowStart', { workflow: 'two', project: p.id, task: 'x' })
  const tab = await until(async () => (await rig.rpc('flowGet', { id: run.id })).tabs.one, 'one’s tab')
  // yours, while its first turn works: typed in first, so two's prompt waits behind it
  assert.deepEqual(await rig.rpc('send', { target: tab, text: 'mine', whenIdle: true }), { tab, queued: 1 })
  const r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'done' && x
  }, 'done', 15000)
  assert.equal(r.vars['steps.one.answer'], 'answer: first')
  assert.equal(r.vars['steps.two.answer'], 'answer: second', 'not the answer to yours')
  assert.ok(r.log.some((l: string) => /two: to claude \(queued: it was busy\)/.test(l)), r.log.join('\n'))
})

test('workflow runs: agent actions (by name, by slug, the project\'s own), a file and a link into its Artifacts; a run deleted while it waits', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true, actions: [{ name: 'Review', target: 'claude', text: 'review {{task}}' }] })
  // slugs: from the name, unique across Settings' and every project's (the project's own, set in the app)
  await rig.rpc('projectSet', { id: p.id, config: { actions: [{ name: 'xhigh code review', target: 'claude', text: '/code-review xhigh' }, { name: 'Review', target: 'codex', text: 'r' }, { name: 'Mine', target: 'claude', text: 'm', slug: 'review' }] } })
  const st = await rig.rpc('state')
  assert.equal(st.settings.actions[0].slug, 'review', 'kept by the one that had it')
  assert.deepEqual(st.projects[0].config.actions.map((a: any) => a.slug), ['xhigh-code-review', 'review-2', 'review-3'])
  const text = `# Keep

runs in: worktree · session: new

## start
input: task
next: review

## review
agent: claude · use: Review
next: deep

## deep
agent: claude · use: xhigh-code-review
next: report

## report
run: mkdir -p out && echo hi > out/r.txt
ok: copy
fail: e

## copy
save: kept
from: out
ok: link

## link
save: The repo
link: https://example.com/{{task}}
ok: e

## e
end: success
`
  const { workflow, problems } = parse(text, 'keep')
  assert.deepEqual(problems, [])
  assert.deepEqual(check(workflow), [], 'use: needs no prompt of its own')
  assert.equal(toFile(workflow), text, 'round trip')
  assert.deepEqual(check(parse('## start\ninput: task\nnext: s\n\n## s\nsave: x\nfrom: a\nlink: https://x\nok: e\n\n## e\nend: success\n').workflow), ['s: a file or a link, not both'])

  await rig.rpc('flowSave', { id: 'keep', text })
  const run = await rig.rpc('flowStart', { workflow: 'keep', project: p.id, task: 'x1' })
  const r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status !== 'running' && x
  }, 'the end', 20000)
  assert.equal(r.status, 'done', r.log.join('\n'))
  assert.match(r.vars['steps.review.answer'], /^answer: review x1/, "the action's prompt (by its name)")
  assert.match(r.vars['steps.deep.answer'], /^answer: \/code-review xhigh/, "the project's own action, by its slug")
  assert.equal((await rig.rpc('state')).tabs.find((x: any) => x.id === r.tabs.review)?.flow, run.id, 'its session links back to the run')
  assert.ok(r.log.some((l: string) => /review: a new claude tab, .* · Review\nreview x1$/.test(l)), 'the prompt in the log, under its line')
  const ws = (await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws)
  assert.equal(readFileSync(join(ws.storage, 'kept', 'r.txt'), 'utf8'), 'hi\n', 'a folder of the workspace, copied')
  assert.equal(readFileSync(join(ws.storage, 'The repo.url'), 'utf8'), '[InternetShortcut]\r\nURL=https://example.com/x1\r\n')

  // a file from outside the workspace, an action that isn't there: it asks; deleted while it waits, it stops and goes
  await rig.rpc('flowSave', { id: 'out', text: '# Out\nruns in: main\n\n## start\ninput: task\nnext: s\n\n## s\nsave: hosts\nfrom: /etc/hosts\nok: a\n\n## a\nagent: claude · use: Nope\nnext: e\n\n## e\nend: success\n' })
  const out = await rig.rpc('flowStart', { workflow: 'out', project: p.id, task: 'x' })
  let o = await until(async () => {
    const x = await rig.rpc('flowGet', { id: out.id })
    return x.status === 'waiting' && x
  }, 'stuck')
  assert.match(o.wait.question, /\/etc\/hosts: a file or folder in the workspace/)
  await rig.rpc('flowForget', { id: run.id })
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws).flow, undefined, 'its row’s mark goes with it')
  await rig.rpc('flowSave', { id: 'out', text: '# Out\nruns in: main\n\n## start\ninput: task\nnext: a\n\n## a\nagent: claude · use: Nope\nnext: e\n\n## e\nend: success\n' })
  const out2 = await rig.rpc('flowStart', { workflow: 'out', project: p.id, task: 'y' })
  o = await until(async () => {
    const x = await rig.rpc('flowGet', { id: out2.id })
    return x.status === 'waiting' && x
  }, 'stuck on the action')
  assert.match(o.wait.question, /no agent action “Nope”/)
  await rig.rpc('flowForget', { id: out.id })
  await rig.rpc('flowForget', { id: out2.id })
  assert.deepEqual((await rig.rpc('state')).flows, [])
})

test('workflow agent JSON mode: told to end with JSON, its answer that JSON (else its words, said)', async t => {
  const flow = '# J\nruns in: main\n\n## start\ninput: task\nnext: a\n\n## a\nagent: claude · json: yes\n> {"n": "{{task}}"}\nnext: b\n\n## b\nagent: claude · json: yes\n> words\nnext: e\n\n## e\nend: success\n'
  const { workflow, problems } = parse(flow, 'j')
  assert.deepEqual([problems, check(workflow)], [[], []])
  assert.deepEqual(parse(toFile(workflow), 'j').workflow, workflow, 'written back as it was read')
  assert.match(check(parse('## start\ninput: task\nnext: r\n## r\nrun: true\njson: yes\n', 'x').workflow).join(), /json: is for agent and AI call blocks/)
  assert.deepEqual(['x ```json\n[1, 2]\n``` y', 'a {"k": {"v": 1}} b', 'none', '{"a": 1} then [2]'].map(x => lastJson(x)), [[1, 2], { k: { v: 1 } }, undefined, { a: 1 }])
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'j', text: flow })
  const run = await rig.rpc('flowStart', { workflow: 'j', project: p.id, task: 'x' })
  const r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: run.id })), 'the end', 20000)
  assert.equal(r.status, 'done', r.log.join('\n'))
  assert.equal(r.vars['steps.a.answer'], '{"n":"x"}', 'the JSON it ended with')
  assert.match(r.log.join('\n'), /End your answer with one JSON object or list/)
  assert.match(r.vars['steps.b.answer'], /^answer: words/, 'no JSON: its words')
  assert.match(r.log.join('\n'), /b: no JSON in its answer \(its words kept\)/)
  assert.match(flowVars(workflow).find(v => v.name === 'steps.a.answer')!.what, /JSON mode/)
})

test('workflow queue: past at once a run is queued, no workspace; it starts as a slot frees; a stop; a restart keeps it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'queue', text: QUEUE })
  const get = (id: string) => rig.rpc('flowGet', { id })
  const a = await rig.rpc('flowStart', { workflow: 'queue', project: p.id, task: 'first' })
  assert.ok(a.ws)
  await until(async () => (await get(a.id)).status === 'waiting', 'a asks')
  const b = await rig.rpc('flowStart', { workflow: 'queue', project: p.id, task: 'second' })
  assert.equal(b.status, 'queued')
  assert.equal(b.ws, undefined, 'no workspace yet')
  assert.ok(b.log.some((l: string) => / queued: 1 going \(at once: 1\)$/.test(l)))
  assert.equal((await rig.rpc('state')).flows.find((r: any) => r.id === b.id).status, 'queued')

  // a stop ends a queued one, no workspace made
  const c = await rig.rpc('flowStart', { workflow: 'queue', project: p.id, task: 'third' })
  assert.ok(c.log.some((l: string) => /1 ahead of it$/.test(l)))
  assert.equal((await rig.rpc('flowStop', { id: c.id })).status, 'stopped')
  assert.equal((await get(c.id)).ws, undefined)

  // QUEUE_MAX waiting their turn, then refused
  const more = []
  for (let i = 1; i < QUEUE_MAX; i++) more.push(await rig.rpc('flowStart', { workflow: 'queue', project: p.id, task: `more ${i}` }))
  await assert.rejects(rig.rpc('flowStart', { workflow: 'queue', project: p.id, task: 'one too many' }), new RegExp(`Queue has ${QUEUE_MAX} runs waiting their turn already \\(at once: 1\\): stop one, or wait`))
  for (const r of more) await rig.rpc('flowForget', { id: r.id })

  // a restart: still queued, a still asks
  await rig.stop()
  await rig.start()
  await sleep(300)
  assert.equal((await get(b.id)).status, 'queued')
  assert.equal((await get(a.id)).status, 'waiting')

  // a ends: b starts in its own worktree
  await rig.rpc('flowAnswer', { id: a.id, n: 0 })
  assert.equal((await get(a.id)).status, 'done')
  const r = await until(async () => {
    const x = await get(b.id)
    return x.status === 'waiting' && x
  }, 'b asks', 15000)
  assert.ok(r.log.some((l: string) => / its turn: a slot freed$/.test(l)))
  const ws = (await rig.rpc('state')).workspaces.find((w: any) => w.id === r.ws)
  assert.equal(ws.kind, 'worktree')
  assert.notEqual(r.ws, a.ws)
  assert.equal(ws.flow, b.id)
})

test('workflow runs in a workspace you have: none made, no mark, one run there at a time; runs in: here needs one; archived refused; the CLI’s --ws', async t => {
  const HERE = AGENT('claude', 'review {{task}}').replace('runs in: worktree', 'runs in: here')
  assert.equal(parse(HERE).workflow.where, 'here')
  assert.equal(toFile(parse(HERE, 'agent').workflow), HERE, 'round trip')
  assert.deepEqual(check(parse(HERE).workflow), [])
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'here', text: HERE })
  await rig.rpc('flowSave', { id: 'tree', text: AGENT('claude', 'fix {{task}}') })
  const mine = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'mine' })
  await assert.rejects(rig.rpc('flowStart', { workflow: 'here', project: p.id, task: 'x' }), /Agent runs in a workspace you have: pick one/)
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, workflow: 'here', prompt: 'x', when: 'every day at 9am' }), /Agent runs in a workspace you pick, not on a schedule/)
  const count = async () => (await rig.rpc('state')).workspaces.length
  const before = await count()
  // no project: the workspace's; a worktree workflow given one runs there too
  const run = await rig.rpc('flowStart', { workflow: 'tree', ws: mine.id, task: 'x' })
  assert.deepEqual([run.ws, run.pick, run.project], [mine.id, mine.id, p.id])
  assert.equal(await count(), before, 'no workspace made')
  await assert.rejects(rig.rpc('flowStart', { workflow: 'here', ws: 'mine', task: 'y' }), /mine has a run going: Agent/)
  const r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'done' && x
  }, 'done', 15000)
  const v = await rig.rpc('state')
  assert.equal(v.tabs.find((x: any) => x.id === r.tabs.work).workspace, mine.id, 'its agent’s tab is there')
  assert.equal(v.workspaces.find((w: any) => w.id === mine.id).flow, undefined, 'no workflow mark: the run didn’t make it')
  assert.ok(r.log.some((l: string) => /in mine \(worktree, branch .*, the one you picked\)/.test(l)), r.log.join('\n'))

  // the CLI: --ws by name, its project then; an archived one refused
  const cli = await rig.cli('flow', 'run', 'here', 'go', 'on', '--ws', 'mine')
  assert.equal(cli.code, 0, cli.err)
  assert.match(cli.out, new RegExp(`in ${mine.id}$`, "m"))
  const id = cli.out.split(/\s+/)[0]
  assert.equal((await rig.rpc('flowGet', { id })).task, 'go on')
  await until(async () => (await rig.rpc('flowGet', { id })).status === 'done', 'its run done', 15000)
  await rig.rpc('wsArchive', { id: mine.id })
  await assert.rejects(rig.rpc('flowStart', { workflow: 'here', ws: mine.id, task: 'x' }), /mine is archived: restore it first/)
})

test('workflow Run again and Run from here: the task and inputs again on the file as it is now; from a block in its workspace, its state kept; refused once archived', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'twice', text: TWICE })
  const done = (id: string) => until(async () => {
    const x = await rig.rpc('flowGet', { id })
    return ['done', 'failed', 'stopped'].includes(x.status) && x
  }, `run ${id} ended`, 20000)
  const first = await done((await rig.rpc('flowStart', { workflow: 'twice', project: p.id, task: 'x', inputs: { who: 'bob' } })).id)
  assert.equal(first.vars['steps.plan.answer'], 'answer: plan x for bob')

  // Run again: the same task and inputs, the workflow as it's saved now, a new worktree
  await rig.rpc('flowSave', { id: 'twice', text: TWICE.replace('> plan {{task}}', '> plan again {{task}}') })
  const again = await done((await rig.rpc('flowStart', { again: first.id })).id)
  assert.deepEqual([again.task, again.vars['inputs.who'], again.trigger, again.status], ['x', 'bob', `again ${first.id}`, 'done'])
  assert.equal(again.vars['steps.plan.answer'], 'answer: plan again x for bob')
  assert.notEqual(again.ws, first.ws)
  assert.match(again.log[0], new RegExp(`\\(again: run ${first.id}\\)$`))

  // Run from here: in the first run's worktree, from check: plan doesn't run again, its answer is the old run's
  const before = rig.fakeLog().filter(l => l.bin === 'claude').length
  await assert.rejects(rig.rpc('flowStart', { from: { run: first.id, block: 'nope' } }), /nope isn't a block of Twice now/)
  const from = await done((await rig.rpc('flowStart', { from: { run: first.id, block: 'check' } })).id)
  assert.equal(from.ws, first.ws, 'no new worktree')
  assert.deepEqual(from.decisions.map((d: any) => `${d.block}:${d.exit}`), ['check:ok'], 'start and plan don’t run')
  assert.equal(from.turns, 0, 'no agent turn')
  assert.equal(rig.fakeLog().filter(l => l.bin === 'claude').length, before, 'no agent started')
  assert.equal(from.vars['steps.check.output'], 'checked: answer: plan x for bob')
  assert.equal(from.visits.plan, 1)
  assert.match(from.log[0], new RegExp(`\\(from run ${first.id}, at check\\)$`))
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === first.ws).flow, from.id, 'its worktree’s mark: the newest run')

  // the CLI; then archived: Run from here is refused, Run again isn't
  const cli = await rig.cli('flow', 'again', first.id, '--from', 'check')
  assert.equal(cli.code, 0, cli.err)
  await done(cli.out.split(/\s+/)[0])
  await rig.rpc('wsArchive', { id: first.ws })
  await assert.rejects(rig.rpc('flowStart', { from: { run: first.id, block: 'check' } }), /is archived: Restore it \(the sidebar's Archived\), or Run again/)
  assert.ok((await rig.rpc('flowStart', { again: first.id })).id)
})
