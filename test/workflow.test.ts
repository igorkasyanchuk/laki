import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { apiQuestions, branchOf, check, exitsOf, FLOW_ENDED, flowVars, fromApi, holds, jsonFill, lastJson, outsOf, parse, renameBlock, runOf, toFile, varsFill } from '../src/shared/workflow.ts'
import { fresh, until } from './helpers.ts'

// every kind of block, loops limited by a max and an ask
const LOOPS = `# Loops
Plan, approve, build, test until green, a PR, CI.

runs in: worktree · session: shared · at once: 2 · turns: 12

## start
input: task
next: plan
at: 70,20

## plan
name: Plan
agent: claude · model: opus · effort: high
> Make a plan for: {{task}}
>
> Sum it up.
next: approve

## approve
ask: Build this plan?
show: {{steps.plan.answer}}
- Build it → test
- Change it → plan
- Stop → stopped

## test
run: npm test
timeout: 5
ok: lgtm
fail: fix

## fix
agent: codex · session: new
> Fix: {{steps.test.output}}
next: test
max: 3 → stopped

## lgtm
choice: steps.plan.answer matches "^ok"
- Yes → ship
- No → keep

## keep
save: notes/plan.md
> {{steps.plan.answer}}
ok: ship

## ship
action: ship · ask first: no
> {{task}}
ok: ci
error: stopped

## ci
wait: checks
timeout: 30
pass: done
fail: stopped

## done
end: success · notify: yes

## stopped
end: stopped
`

test('workflow files: read back as they are, checks pass; problems are named', () => {
  for (const text of [LOOPS, FLOW]) {
    const { workflow, problems } = parse(text, 'x')
    assert.deepEqual(problems, [])
    assert.deepEqual(check(workflow), [])
    assert.equal(toFile(workflow), text, 'round trip')
  }
  const { workflow, problems } = parse('# Loop\n\n## start\ninput: task\nnext: a\n\n## a\nrun: true\nok: b\nfail: a\nwhat\n\n## b\nagent: claude\n> again\nnext: a\n\n## c\nend: success\n', 'loop')
  assert.match(problems[0], /line 11: what\?/)
  const c = check(workflow)
  assert.ok(c.includes('nothing leads to c'))
  assert.ok(c.some(p => /the loop through a, b has no limit/.test(p)), c.join('; '))
  assert.deepEqual(check(parse('## a\nend: success\n').workflow), ['no start block (## start)'])
  // a loop that goes round past its ask: still no limit
  const bypass = parse('## start\ninput: task\nnext: c\n\n## c\nchoice: answer contains "x"\n- Yes → s\n- No → a\n\n## s\nsave: f.md\nok: c\n\n## a\nask: Go?\n- Again → c\n- Done → e\n\n## e\nend: success\n').workflow
  assert.deepEqual(check(bypass), ['the loop through c, s has no limit: give one of its blocks a max'])
  assert.match(toFile({ ...bypass, blocks: bypass.blocks.map(b => (b.id === 'a' ? { ...b, question: 'Go\non?' } : b)) }), /^ask: Go on\?$/m, 'one line')
  assert.match(parse('## x\nchoice: answer has "y"\n').problems[0], /choice: <variable> contains/)
  // past 100 blocks: said, before any walk (a chain of thousands would overflow them)
  const huge = Array.from({ length: 5000 }, (_, i) => `## b${i}\nrun: true\nok: b${i + 1}\nfail: b${i + 1}\n`).join('\n')
  assert.deepEqual(check(parse(`## start\ninput: task\nnext: b0\n\n${huge}\n## b5000\nend: success\n`).workflow), ['5002 blocks: 100 at most'])
  // a project's workflow: only that project's runs (two repos may each have a review.md); yours: any project's
  assert.equal(runOf({ workflow: 'review', source: 'project', project: 'a' }, { id: 'review', source: 'project', project: 'b' }), false)
  assert.equal(runOf({ workflow: 'review', source: 'project', project: 'a' }, { id: 'review', source: 'project', project: 'a' }), true)
  assert.equal(runOf({ workflow: 'review', source: 'yours', project: 'a' }, { id: 'review', source: 'yours' }), true)
  assert.deepEqual(check(parse('# M\nruns in: main\n\n## start\ninput: task\nnext: s\n\n## s\naction: ship\nok: e\n\n## e\nend: success\n').workflow), ['s needs a PR: runs in: worktree'])
})

const FLOW = `# Test flow
Plans, checks, asks, builds, saves.

runs in: worktree · session: new

## start
input: task
next: plan

## plan
agent: claude
> plan {{task}}
next: check

## check
run: test -f README.md && echo fine {{task}}
ok: said
fail: bad

## said
choice: steps.plan.answer contains "answer: plan"
- Yes → gate
- No → bad

## gate
ask: Go on?
show: {{steps.check.output}}
- Build → build
- Stop → bad

## build
agent: claude
> build it: {{answer}}
next: keep

## keep
save: notes/out.md
> {{steps.build.answer}}
ok: approve

## approve
action: approve
ok: done
error: bad

## done
end: success · notify: yes

## bad
end: failed
`

test('workflow runs: off until turned on, a worktree each, agents, commands, choices, asks, saves, a dry run’s actions', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await assert.rejects(rig.rpc('flowList', {}), /Workflows are off: turn them on in Settings › General › Experimental/)
  assert.equal((await rig.rpc('state')).flows, undefined)
  await rig.rpc('settingsSet', { workflows: true })
  assert.deepEqual(await rig.rpc('flowList', {}), [], 'none come with Laki')

  // yours, and a project's (in its repo); a built-in is read-only; a run refuses one with problems
  await rig.rpc('flowSave', { id: 'test', text: FLOW })
  assert.equal(readFileSync(join(rig.data, 'workflows', 'test.md'), 'utf8'), FLOW)
  await rig.rpc('flowSave', { id: 'broken', source: 'project', project: p.id, text: '# Broken\n## start\ninput: task\nnext: nowhere\n' })
  const list = await rig.rpc('flowList', { project: p.id })
  assert.deepEqual(list.find((w: any) => w.id === 'broken').problems, ['Start: next goes to nowhere, which isn\'t a block'])
  assert.equal(list.find((w: any) => w.id === 'broken').path, join(p.path, '.laki', 'workflows', 'broken.md'))
  await assert.rejects(rig.rpc('flowSave', { id: 'x', source: 'builtin', text: 'x' }), /builtin\? a workflow is yours or a project's/)
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
  await assert.rejects(rig.rpc('flowStart', { workflow: 'fails', project: p.id, task: 'y' }), /Fails has 1 runs going \(at once: 1\)/)
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
  assert.match(ls.out, /^fails  yours  Fails$/m)
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

test('workflow case: if / elsif / else, a branch testing its own variable; what check says', async t => {
  const route = (branches: string) => `# Route\n\nruns in: main · session: new\n\n## start\ninput: task\nnext: size\n\n## size\nrun: echo 3\nok: route\nfail: full\n\n## route\ncase: task\n${branches}\n\n## specs\nend: success\n\n## fix\nend: success\n\n## three\nend: success\n\n## full\nend: success\n`
  const text = route('- equals "only_specs" → specs\n- matches "^fix" → fix\n- steps.size.output equals "4" → three\n- else → full')
  const { workflow, problems } = parse(text, 'route')
  assert.deepEqual(problems, [])
  assert.deepEqual(check(workflow), [])
  assert.equal(toFile(workflow), text, 'round trip')
  const says = (branches: string) => check(parse(route(branches)).workflow)
  assert.match(says('- equals "a" → specs\n- equals "b" → fix').join('\n'), /needs an else, last/)
  assert.deepEqual(says('- else → full\n- equals "a" → specs').filter(x => x.startsWith('route')), ['route: else goes last'], 'said once')
  assert.match(says('- contains "" → specs\n- else → full').join('\n'), /tests no text/)
  assert.match(says('- matches "(" → specs\n- else → full').join('\n'), /isn't a regular expression/)
  assert.match(says('- is "a" → specs\n- else → full').join('\n'), /a branch is \[variable\]/)
  assert.match(check(parse(route('- equals "a" → specs\n- else → full').replace('case: task', 'case:')).workflow).join('\n'), /names no variable/)
  assert.match(says('- equals "a" → specs\n- equals "a" → fix\n- else → full').join('\n'), /two branches say the same/)
  assert.ok(holds('`only_specs`', 'equals', 'only_specs') && holds('**Only_specs**.', 'equals', 'only_specs') && !holds('only specs', 'equals', 'only_specs'), "equals: an agent's one word, its wrapping aside")

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'route', text })
  const went = async (task: string) => {
    const run = await rig.rpc('flowStart', { workflow: 'route', project: p.id, task })
    const r = await until(async () => {
      const x = await rig.rpc('flowGet', { id: run.id })
      return x.status !== 'running' && x
    }, task, 15000)
    assert.equal(r.status, 'done', r.log.join('\n'))
    return r.decisions.find((d: any) => d.block === 'route')
  }
  assert.equal((await went('only_specs')).exit, 'equals "only_specs"')
  assert.equal((await went('Fix the login')).exit, 'matches "^fix"', 'the first that holds, any case')
  const other = await went('something else')
  assert.equal(other.exit, 'else')
  assert.match(other.why, /nothing above matched/)
})

test('workflow outputs: an AI call (OpenRouter) gives named outputs, a command uses them, a webhook posts them with a secret header', async t => {
  // a fake OpenRouter and a webhook's receiver, both recording
  const asked: any[] = []
  const posted: { headers: any; body: string; url: string }[] = []
  const srv = createServer(async (q, res) => {
    let body = ''
    for await (const c of q) body += c
    if (q.url === '/chat/completions') {
      asked.push(JSON.parse(body))
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'x/fast', choices: [{ message: { content: 'Here:\n```json\n{"title": "Add \\"CSV\\" export", "tags": ["csv", "ui"]}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } }))
    }
    posted.push({ headers: q.headers, body, url: q.url! })
    res.writeHead(q.url === '/bad' ? 422 : 201, { 'content-type': 'application/json' }).end('{"id": 42}')
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const at = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  const rig = await fresh(t, { env: { LAKI_AI_API: at } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true, env: { HOOK_TOKEN: 'sekret', HOOK_PATH: 'p4th' } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const flow = `# Outputs
runs in: main

## start
input: task
next: sum

## sum
llm: x/fast
out: title, tags
> Name this task: {{task}}
ok: count

## count
run: printf '{"n": %s}' "$(printf %s {{steps.sum.tags}} | tr -cd , | wc -c | tr -d ' ')"
out: n
ok: post

## post
webhook: ${at}/hook/{{env.HOOK_PATH}}?n={{steps.count.n}}&t={{steps.sum.title}}
header: Authorization: Bearer {{env.HOOK_TOKEN}}
out: id
> {"title": "{{steps.sum.title}}", "task": "{{task}}"}
ok: bad

## bad
webhook: ${at}/bad
method: PUT
ok: end
error: end

## end
end: success
`
  const { workflow, problems } = parse(flow, 'outputs')
  assert.deepEqual([problems, check(workflow)], [[], []])
  assert.deepEqual(parse(toFile(workflow), 'outputs').workflow, workflow, 'written back as it was read')
  assert.match(check(parse('# X\n## start\ninput: task\nnext: s\n## s\nrun: true\nout: answer, n\nok: e\n## e\nend: success\n', 'x').workflow).join(), /^$/)
  assert.match(parse('## s\nrun: true\nout: answer\n', 'x').problems.join(), /out: answer\? a name/)
  assert.equal(jsonFill('{"l": {{a}}, "s": "<{{b}}>", "t": {{c}}, "u": {{zz}}}', { a: '["x"]', b: 'say "hi"', c: 'plain' }), '{"l": ["x"], "s": "<say \\"hi\\">", "t": "plain", "u": {{zz}}}', 'bare JSON as it is, in a string escaped, words as a string')
  assert.deepEqual(['{"n": 1}', 'x {"n": {"a": 2}} y', '```json\n{"n": "s"}\n```\n{"n": 0}', '{', '} {'].map(x => outsOf(x, ['n']).vars.n), ['1', '{"a":2}', 's', '', ''])
  await rig.rpc('flowSave', { id: 'outputs', text: flow })
  const run = await rig.rpc('flowStart', { workflow: 'outputs', project: p.id, task: 'export "rows"' })
  const r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: run.id })), 'the end', 20000)
  assert.equal(r.status, 'done', r.log.join('\n'))
  // the AI call: its model, the prompt with out:'s ask; its outputs, a list as JSON
  assert.equal(asked[0].model, 'x/fast')
  assert.match(asked[0].messages[0].content, /^Name this task: export "rows"\n\nEnd your answer with a JSON object .* title, tags\./)
  assert.deepEqual([r.vars['steps.sum.title'], r.vars['steps.sum.tags']], ['Add "CSV" export', '["csv","ui"]'])
  assert.equal(r.vars['steps.count.n'], '1', 'a command’s JSON output, its variable quoted in the shell')
  // the webhook: the secret header, a JSON body with its values escaped, its response's out; the log keeps no secret
  const hook = posted.find(x => x.url.startsWith('/hook'))!
  assert.equal(hook.url, '/hook/p4th?n=1&t=Add%20%22CSV%22%20export', 'a value after the ? encoded')
  assert.equal(hook.headers.authorization, 'Bearer sekret')
  assert.equal(hook.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(hook.body), { title: 'Add "CSV" export', task: 'export "rows"' })
  assert.deepEqual([r.vars['steps.post.status'], r.vars['steps.post.id']], ['201', '42'])
  assert.ok(!/sekret|p4th/.test(r.log.join('\n')), 'never in the log, a URL’s path either')
  // a 422: the error exit (no retry: not a 5xx); a PUT with no body: the run's variables as JSON
  const bad = posted.find(x => x.url === '/bad')!
  assert.equal(JSON.parse(bad.body)['steps.sum.title'], 'Add "CSV" export')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'sum:ok', 'count:ok', 'post:ok', 'bad:error'])
  // its cost among Laki AI's calls
  assert.ok((await rig.rpc('aiState')).calls.some((c: any) => c.ask === 'Outputs · sum' && c.cost === 0.0001))
})

test('workflow decisions: a decision model’s answers, one it isn’t sure of asked of you; a case on numbers and JS; Show you; Test; a retried webhook; a scheduled run', async t => {
  // a fake OpenRouter (Decisions API, chat) and a flaky receiver, recording
  const decided: any[] = []
  const chats: any[] = []
  let flaky = 0
  const srv = createServer(async (q, res) => {
    let body = ''
    for await (const c of q) body += c
    if (q.url === '/alpha/decisions') {
      decided.push(JSON.parse(body))
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'typesafe/jev-1.13-20260917', answers: { urgent: { type: 'noul', noul: 0.91 }, team: { type: 'choice', choice: 'payments', confidence: 0.42, probabilities: { payments: 0.5, frontend: 0.3, account: 0.2 } }, level: { type: 'score', score: 1.8, confidence: 0.93, probabilities: { 0: 0.05, 1: 0.1, 2: 0.85 } } }, usage: { input_tokens: 400, output_tokens: 60, cost: 0.00002 } }))
    }
    if (q.url === '/chat/completions') {
      chats.push(JSON.parse(body))
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'x/fast', choices: [{ message: { content: '{"title": "T"}' } }] }))
    }
    if (q.url === '/flaky') return ++flaky < 2 ? res.writeHead(503, { 'retry-after': '1' }).end('busy') : res.writeHead(200).end('{"ok": true}')
    res.writeHead(404).end()
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const at = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  const rig = await fresh(t, { env: { LAKI_AI_API: at } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const flow = `# Triage
runs in: main

## start
input: task
next: msgs

## msgs
run: printf '[{"from": "ann", "text": "prod is down"}]'
out: list
ok: triage

## triage
decide: typesafe/jev-1.13 · sure: 0.8
> {"messages": {{steps.msgs.output}}, "note": "{{task}}"}
question: urgent · yes/no · Does any message need me today?
  yes: someone is blocked, an outage
  no: FYI, chatter
question: team · choice · Who should handle it?
  payments: billing, refunds
  frontend: UI bugs
  account: sign-in
question: level · score · How urgent?
  - Can wait
  - This week
  - Right now
ok: route

## route
case: steps.triage.urgent
- equals "no" → done
- js: vars['steps.triage.team'] === 'frontend' → done
- steps.triage.urgent.p >= 0.9 → show
- else → done

## show
popup: Urgent: {{steps.triage.team}}
notify: yes
> <h1>{{task}}</h1><p>level {{steps.triage.level}}: {{steps.triage.level.level}}</p>
next: done

## done
end: success
`
  const { workflow, problems } = parse(flow, 'triage')
  assert.deepEqual([problems, check(workflow)], [[], []])
  assert.deepEqual(parse(toFile(workflow), 'triage').workflow, workflow, 'written back as it was read')
  const tri = workflow.blocks.find(b => b.id === 'triage')!
  assert.deepEqual(tri.qs!.map(q => [q.name, q.type, q.opts.length]), [['urgent', 'yes/no', 2], ['team', 'choice', 3], ['level', 'score', 3]])
  assert.deepEqual(fromApi(apiQuestions(tri.qs!)), tri.qs, 'the JSON tab reads back what it shows')
  assert.deepEqual(apiQuestions(tri.qs!).urgent, { type: 'noul', instructions: 'Does any message need me today?', criteria: { true: 'someone is blocked, an outage', false: 'FYI, chatter' } })
  assert.match(check(parse('# X\n## start\ninput: task\nnext: d\n## d\ndecide:\nok: e\n## e\nend: success\n', 'x').workflow).join(), /d asks no question/)
  assert.match(check(parse('# X\n## start\ninput: task\nnext: d\n## d\ndecide:\nquestion: a · choice · Which?\n  one: x\nok: e\n## e\nend: success\n', 'x').workflow).join(), /a needs two options at least/)
  assert.deepEqual(['>= 2', 'steps.x.p < 0.5', 'js: num("a") > 1', 'contains "x"'].map(branchOf), [{ test: '>=', value: '2' }, { of: 'steps.x.p', test: '<', value: '0.5' }, { test: 'js', value: 'num("a") > 1' }, { test: 'contains', value: 'x' }])
  assert.deepEqual([holds('0.91', '>=', '0.9'), holds('', '>=', '0'), holds('x', '<', '5'), holds('**3**', '>', '2')], [true, false, false, true])
  const dot = { ...workflow, blocks: workflow.blocks.map(b => (b.id === 'show' ? { ...b, title: 'Build · nightly' } : b)) }
  assert.deepEqual(parse(toFile(dot), 'triage').workflow, dot, 'a title with a · in it, written back')
  const named = { ...workflow, blocks: workflow.blocks.map(b => (b.id === 'triage' ? { ...b, qs: [{ ...b.qs![0], name: 'answers' }] } : b)) }
  assert.match(check(named).join(), /answers\? a question's name/, "the JSON tab's names are checked too")

  await rig.rpc('flowSave', { id: 'triage', text: flow })
  const run = await rig.rpc('flowStart', { workflow: 'triage', project: p.id, task: 'my inbox' })
  // team: 42% sure, under 80%: it asks you, its options the choice's
  const asked = await until(async () => (x => x.status === 'waiting' && x)(await rig.rpc('flowGet', { id: run.id })), 'its ask', 10000)
  assert.deepEqual([asked.wait.kind, asked.wait.key, asked.wait.options, asked.wait.rest], ['decide', 'team', ['payments', 'frontend', 'account'], []])
  assert.match(asked.wait.show, /payments 50%, frontend 30%, account 20%/)
  assert.deepEqual(decided[0].model, 'typesafe/jev-1.13')
  assert.deepEqual(decided[0].state, { messages: [{ from: 'ann', text: 'prod is down' }], note: 'my inbox' }, 'a bare {{var}} that is JSON goes in as JSON')
  assert.equal(decided[0].questions.level.criteria.length, 3)
  assert.deepEqual([asked.vars['steps.triage.urgent'], asked.vars['steps.triage.urgent.p'], asked.vars['steps.triage.level'], asked.vars['steps.triage.level.level']], ['yes', '0.91', '2', 'Right now'])
  await rig.rpc('flowAnswer', { id: run.id, n: 0 })
  const r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: run.id })), 'the end', 10000)
  assert.equal(r.status, 'done', r.log.join('\n'))
  assert.deepEqual([r.vars['steps.triage.team'], r.vars['steps.triage.team.you']], ['payments', 'yes'])
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'msgs:ok', 'triage:ok', 'route:steps.triage.urgent.p >= 0.9', 'show:next'])
  assert.deepEqual(r.shown.map((x: any) => [x.title, x.body]), [['Urgent: payments', '<h1>my inbox</h1><p>level 2: Right now</p>']])
  assert.ok((await rig.rpc('aiState')).calls.some((c: any) => c.ask === 'Triage · triage' && c.cost === 0.00002))

  // Test: one block alone, the values you give; an AI call in JSON mode with its system prompt and temperature
  const tested = await rig.rpc('flowTest', { block: tri, vars: { 'steps.msgs.output': '[]', task: 't' } })
  assert.deepEqual([tested.exit, tested.unsure, tested.vars['steps.triage.urgent']], ['ok', ['team'], 'yes'])
  const llm = parse('## s\nllm: x/fast\nsystem: Be short.\ntemperature: 0.2\nout: title\n> Name {{task}}\n', 'x').workflow.blocks[0]
  const said = await rig.rpc('flowTest', { block: llm, vars: { task: 'CSV' } })
  assert.deepEqual([said.exit, said.vars['steps.s.title']], ['ok', 'T'])
  assert.deepEqual([chats[0].messages[0], chats[0].temperature, chats[0].response_format], [{ role: 'system', content: 'Be short.' }, 0.2, { type: 'json_object' }])
  // a webhook: a 503 (Retry-After: 1) and again
  const hook = parse(`## h\nwebhook: ${at}/flaky\nmethod: GET\n`, 'x').workflow.blocks[0]
  const got = await rig.rpc('flowTest', { block: hook })
  assert.deepEqual([got.exit, got.vars['steps.h.status'], flaky], ['ok', '200', 2])
  assert.match(got.log.join('\n'), /h: 503, again in 1 s/)
  await assert.rejects(rig.rpc('flowTest', { block: { id: 'r', kind: 'run', cmd: 'true' } }), /Test sends an AI call/)

  // a scheduled task runs the workflow on its task; again while that run goes: skipped
  const s = await rig.rpc('scheduleSet', { project: p.id, workflow: 'triage', prompt: 'the inbox', when: 'every day at 9am' })
  assert.deepEqual([s.workflow, s.source], ['triage', 'yours'])
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, workflow: 'nope', prompt: 'x', when: 'every day at 9am' }), /no workflow nope/)
  const first = await rig.rpc('scheduleRun', { id: s.id })
  assert.ok(first.ok, first.what)
  assert.match(first.what, /started a run of triage/)
  const again = await rig.rpc('scheduleRun', { id: s.id })
  assert.deepEqual([again.ok, /skipped: its last run \(\w+\) is still going/.test(again.what)], [false, true])
  const flows = (await rig.rpc('state')).flows
  assert.ok(flows.some((f: any) => f.trigger === `schedule ${s.id}` && f.task === 'the inbox'))
  // back to a prompt
  assert.equal((await rig.rpc('scheduleSet', { id: s.id, workflow: '' })).workflow, undefined)

  // a decision that routes: a line per answer of one question (a score's levels by number); an end's own words
  const routed = `# Routed
runs in: main

## start
input: task
next: d

## d
decide:
question: level · score · How urgent?
  - Can wait
  - This week
  - Right now
route: level
- 0 → calm
- 2 → loud
error: calm

## calm
end: success

## loud
end: failed · notify: yes · phone: yes
> Level {{steps.d.level}}: {{steps.d.level.level}}
`
  const rw = parse(routed, 'routed').workflow
  assert.deepEqual([parse(routed, 'routed').problems, check(rw)], [[], []])
  assert.deepEqual(parse(toFile(rw), 'routed').workflow, rw, 'written back as it was read')
  assert.deepEqual(exitsOf(rw.blocks[1]).map(e => [e.name, e.label, e.to]), [['0', '0: Can wait', 'calm'], ['1', '1: This week', undefined], ['2', '2: Right now', 'loud'], ['error', undefined, 'calm']])
  assert.match(check({ ...rw, blocks: rw.blocks.map(b => (b.id === 'd' ? { ...b, route: 'nope' } : b)) }).join(), /route: nope isn't one of its questions/)
  assert.match(check({ ...rw, blocks: rw.blocks.map(b => (b.id === 'd' ? { ...b, options: [...b.options!, { label: '7', to: 'calm' }] } : b)) }).join(), /- 7 → calm: not an answer of level/)
  assert.match(check({ ...rw, blocks: rw.blocks.map(b => (b.id === 'd' ? { ...b, route: undefined } : b)) }).join(), /a line per answer needs route/)
  assert.equal(parse('## d\ndecide:\nquestion: q · noul · Is it?\n', 'x').workflow.blocks[0].qs![0].type, 'yes/no', "noul, the API's name, is yes/no")
  await rig.rpc('flowSave', { id: 'routed', text: routed })
  const rr = await rig.rpc('flowStart', { workflow: 'routed', project: p.id, task: 'x' })
  const rdone = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: rr.id })), 'the end', 10000)
  assert.deepEqual([rdone.status, rdone.decisions.map((d: any) => `${d.block}:${d.exit}`)], ['failed', ['start:next', 'd:2']])
  assert.ok(rdone.log.some((l: string) => l.includes('failed: Level 2: Right now')), rdone.log.join('\n'))

  // a block's new id: every arrow and {{steps.<id>.…}} to it; the variables list
  const re = renameBlock(JSON.parse(JSON.stringify(workflow)), 'msgs', 'inbox')
  assert.deepEqual([re.blocks[0].to, re.blocks[2].text, check(re)], [{ next: 'inbox' }, '{"messages": {{steps.inbox.output}}, "note": "{{task}}"}', []])
  assert.throws(() => renameBlock(JSON.parse(JSON.stringify(workflow)), 'msgs', 'triage'), /called triage already/)
  const names = flowVars(workflow).map(v => v.name)
  assert.ok(['task', 'steps.msgs.output', 'steps.msgs.list', 'steps.triage.urgent', 'steps.triage.urgent.p', 'steps.triage.level.level', 'steps.triage.answers'].every(n => names.includes(n)), names.join(' '))

  // JSON mode: on by itself with out:, or asked for; off when said
  await rig.rpc('flowTest', { block: parse('## j\nllm: x/fast\njson: yes\n> hi\n', 'x').workflow.blocks[0] })
  assert.deepEqual(chats.at(-1).response_format, { type: 'json_object' })
  await rig.rpc('flowTest', { block: parse('## j\nllm: x/fast\njson: no\nout: title\n> hi\n', 'x').workflow.blocks[0] })
  assert.equal(chats.at(-1).response_format, undefined)
})

// your own variables: a workflow's (var lines) over Settings' global ones, {{vars.NAME}} in any block
const VARS = `# Vars
Its own and global variables.

runs in: main · session: new
var REPO: acme/web
var TEAM: mine

## start
input: task
next: say

## say
run: echo {{vars.REPO}} {{vars.TEAM}} {{vars.CHANNEL}}
ok: done
fail: done

## done
end: success
`
test('workflow variables: var lines read back, the workflow’s own over the global ones, filled in a run', async t => {
  const { workflow, problems } = parse(VARS, 'vars')
  assert.deepEqual(problems, [])
  assert.deepEqual(workflow.vars, { REPO: 'acme/web', TEAM: 'mine' })
  assert.equal(toFile(workflow), VARS, 'round trip')
  assert.deepEqual(varsFill(workflow.vars, { TEAM: 'payments', CHANNEL: '#ops', 'bad name': 'x' }), { 'vars.TEAM': 'mine', 'vars.CHANNEL': '#ops', 'vars.REPO': 'acme/web' })
  assert.equal(flowVars(workflow).some(v => v.name.startsWith('vars.')), false, 'yours are listed apart')
  assert.equal(toFile({ ...workflow, vars: { REPO: 'x', '../bad': 'y' } }).includes('var ../bad'), false, 'a bad name is never written')

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true, flowVars: { TEAM: 'payments', CHANNEL: '#ops' } })
  await rig.rpc('flowSave', { id: 'vars', text: VARS })
  const run = await rig.rpc('flowStart', { workflow: 'vars', source: 'yours', project: p.id, task: 'say it' })
  const r = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: run.id })), 'the end', 15000)
  assert.equal(r.vars['steps.say.output'].trim(), 'acme/web mine #ops')
})
