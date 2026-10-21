import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { QUEUE_MAX, apiQuestions, shellFill, inputVals, branchOf, check, exitsOf, FLOW_ENDED, flowVars, fromApi, holds, jsonFill, lastJson, outsOf, parse, renameBlock, runOf, toFile, varsFill } from '../src/shared/workflow.ts'
import { fresh, sleep, until } from './helpers.ts'

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
  // a pattern that backtracks for ever ends at 200 ms, the run's error way: the daemon still answers
  await rig.rpc('flowSave', { id: 'slow', text: route('- matches "^(a+)+$" → specs\n- equals "x" → fix\n- equals "y" → three\n- else → full').replace('# Route', '# Slow') })
  const run = await rig.rpc('flowStart', { workflow: 'slow', project: p.id, task: `${'a'.repeat(40)}!` })
  const r = await until(async () => (x => x.status !== 'running' && x)(await rig.rpc('flowGet', { id: run.id })), 'its regex stopped', 15000)
  assert.match(r.log.join('\n'), /matches "\^\(a\+\)\+\$": Script execution timed out/)
  assert.equal(await rig.rpc('ping'), 'pong')
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
    if (q.url === '/moved') return res.writeHead(302, { location: 'https://elsewhere.example/' }).end()
    if (q.url === '/huge') return void (res.writeHead(200, { 'content-type': 'text/plain' }), res.write('y'.repeat(5 << 20))) // 5 MB, never ended
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
  // a redirect is its answer, followed nowhere; plain http only to this Mac
  const moved = await rig.rpc('flowTest', { block: { ...hook, url: `${at}/moved` } })
  assert.deepEqual([moved.exit, moved.vars['steps.h.status']], ['error', '302'])
  // a reply past ANSWER_MAX: only that much read, the rest let go (it never ends)
  const huge = await rig.rpc('flowTest', { block: { ...hook, url: `${at}/huge` } })
  assert.deepEqual([huge.exit, huge.vars['steps.h.output'].length], ['ok', 20000])
  const plain = await rig.rpc('flowTest', { block: { ...hook, url: 'http://example.com/hook' } })
  assert.deepEqual([plain.exit, /an https URL \(http only to this Mac\)/.test(JSON.stringify(plain))], ['error', true])
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

const EXT = `# Disk
Its space, then said.

runs in: main · session: new · at once: 3 · turns: 30

## start
input: task
next: disk

## disk
extension: disk
ok: say
error: off

## say
run: echo {{steps.disk.free}} {{steps.disk.vol}}
ok: done

## done
end: success

## off
end: failed
`

test('workflow extension block: fetched now, its data as variables; an off one is its error exit', async t => {
  const { workflow, problems } = parse(EXT, 'disk')
  assert.deepEqual(problems, [])
  assert.deepEqual(check(workflow), [])
  assert.equal(workflow.blocks.find(b => b.id === 'disk')?.extension, 'disk')
  assert.match(toFile(workflow), /## disk\nextension: disk\n/, 'written back')
  assert.match(check({ ...workflow, blocks: workflow.blocks.map(b => (b.id === 'disk' ? { ...b, extension: '' } : b)) }).join(), /extension: which one/)
  assert.ok(flowVars(workflow).some(v => v.name === 'steps.disk.data'))

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const d = join(rig.data, 'widgets', 'disk')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Disk', every: 60, fetch: 'echo \'{"free": 9, "vol": {"a": 1}}\'' }))
  await rig.rpc('widgetReload')
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'disk', text: EXT })
  const first = await rig.rpc('flowStart', { workflow: 'disk', source: 'yours', project: p.id, task: 'check' })
  const failed = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: first.id })), 'the end', 15000)
  assert.equal(failed.status, 'failed')
  assert.match(failed.decisions.find((x: any) => x.block === 'disk').why, /Disk is off/)
  await rig.rpc('widgetSet', { id: 'disk', on: true })
  const run = await rig.rpc('flowStart', { workflow: 'disk', source: 'yours', project: p.id, task: 'check' })
  const r = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: run.id })), 'the end', 15000)
  assert.equal(r.vars['steps.disk.free'], '9')
  assert.equal(r.vars['steps.disk.vol'], '{"a":1}')
  assert.equal(JSON.parse(r.vars['steps.disk.data']).free, 9)
  assert.equal(r.vars['steps.say.output'].trim(), '9 {"a":1}')
})

// retry: a bad exit tries the block again (10 s, then 60 s), its tries kept apart from its visits; a run block's
// retry on: only those exit codes
const RETRY = `# Retry
Tests until they pass, twice more.

runs in: main · session: new

## start
input: task
next: t

## t
name: Tests
run: echo try; exit 1
retry: 2 · retry on: 1, 75
ok: e
fail: bad

## e
end: success

## bad
end: failed
`
test('workflow retries: tries again after a fail (10 s, then 60 s), only on its exit codes; a stop while it waits', async t => {
  const { workflow, problems } = parse(RETRY, 'retry')
  assert.deepEqual([problems, check(workflow)], [[], []])
  assert.equal(toFile(workflow), RETRY, 'round trip')
  assert.deepEqual([workflow.blocks[1].retry, workflow.blocks[1].retryOn], [2, [1, 75]])
  const says = (f: (b: any) => void) => check({ ...workflow, blocks: workflow.blocks.map(b => (b.id === 't' ? (x => (f(x), x))({ ...b }) : b)) }).join('\n')
  assert.match(says(b => (b.retry = 9)), /Tests: retry: 9\? 1 to 5 tries again/)
  assert.match(says(b => (b.kind = 'save')), /retry: is for agent, run, AI call, AI decision and extension blocks/)
  assert.match(says(b => (b.retry = undefined)), /retry on: needs retry:/)
  assert.match(says(b => (b.inputs = [{ name: 'n', kind: 'text' }])), /Tests: inputs: go on the start block/)
  assert.match(parse('## t\nrun: x\nretry: often\nretry on: 0\n', 'x').problems.join('\n'), /retry: how many times[\s\S]*retry on: exit codes, 1 to 255/)

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'retry', text: RETRY })
  const get = (id: string) => rig.rpc('flowGet', { id })
  const run = await rig.rpc('flowStart', { workflow: 'retry', project: p.id, task: 'x' })
  const waits = (n: number) => until(async () => (x => x.wait?.kind === 'retry' && x.decisions.length === n && x)(await get(run.id)), `try ${n}`)
  let r = await waits(2)
  assert.ok(r.wait.until - Date.now() > 8000 && r.wait.until - Date.now() <= 10000, '10 s first')
  assert.ok(r.log.some((l: string) => / Tests: tries again \(2 of 3\) in 10 s: exit 1: try$/.test(l)), r.log.join('\n'))
  await rig.rpc('flowTick', { now: Date.now() + 11000 })
  r = await waits(3)
  assert.ok(r.wait.until - Date.now() > 55000, '60 s after that')
  await rig.rpc('flowTick', { now: Date.now() + 61000 })
  r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get(run.id)), 'the end')
  assert.equal(r.status, 'failed')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 't:retry', 't:retry', 't:fail'])
  assert.deepEqual([r.visits.t, r.tries.t], [1, 2], 'a try again is no visit')

  // exit 1 isn't one of retry on's: its way at once
  await rig.rpc('flowSave', { id: 'retry', text: RETRY.replace('retry on: 1, 75', 'retry on: 75') })
  const once = await rig.rpc('flowStart', { workflow: 'retry', project: p.id, task: 'y' })
  r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get(once.id)), 'the end')
  assert.deepEqual(r.decisions.map((d: any) => d.exit), ['next', 'fail'])

  // stopped while it waits: no try after
  await rig.rpc('flowSave', { id: 'retry', text: RETRY })
  const stop = await rig.rpc('flowStart', { workflow: 'retry', project: p.id, task: 'z' })
  await until(async () => (await get(stop.id)).wait?.kind === 'retry', 'its wait')
  await rig.rpc('flowStop', { id: stop.id })
  await rig.rpc('flowTick', { now: Date.now() + 61000 })
  await sleep(500)
  r = await get(stop.id)
  assert.deepEqual([r.status, r.decisions.map((d: any) => d.exit), r.visits.t], ['stopped', ['next', 'retry'], 1])
})

// an agent block's turn that never ends: its timeout (Esc, error); silent while it works: a nudge, then you
const STALLS = `# Stalls

runs in: main · session: new

## start
input: task
next: a

## a
agent: claude
timeout: 1
> slow {{task}}
next: e
error: bad

## e
end: success

## bad
end: failed
`
test('workflow agents: a timeout Escs the turn and takes error; a silent one is nudged, then asks (Nudge again, Try again, Skip it)', async t => {
  const { workflow, problems } = parse(STALLS, 'stalls')
  assert.deepEqual([problems, check(workflow)], [[], []])
  assert.equal(toFile(workflow), STALLS, 'round trip')
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'stalls', text: STALLS })
  const get = (id: string) => rig.rpc('flowGet', { id })
  // its turn under way: the fake says so (n turns on its screen, wrapped lines joined)
  const working = async (id: string, n = 1) => {
    const r = await until(async () => (x => x.wait?.kind === 'agent' && !x.wait.nudged && x)(await get(id)), 'its turn')
    await until(async () => (await rig.screen(r.wait.tab)).replace(/\n/g, '').split('esc to interrupt').length > n, 'at work')
    await sleep(200) // its keys read (raw mode)
    return r
  }
  const ended = (id: string) => until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get(id)), 'the end', 15000)

  // timeout: 1, a minute on: Esc, then error
  const late = await rig.rpc('flowStart', { workflow: 'stalls', project: p.id, task: 'late' })
  let r = await working(late.id)
  await rig.rpc('flowTick', { now: Date.now() + 30000 })
  assert.equal((await get(late.id)).wait.kind, 'agent', 'not yet')
  await rig.rpc('flowTick', { now: Date.now() + 61000 })
  r = await ended(late.id)
  assert.deepEqual([r.status, r.decisions.at(-1).exit, r.decisions.at(-1).why], ['failed', 'error', 'no answer after 1 min'])
  assert.match(await rig.screen(r.tabs.a), /Interrupted/, 'the agent was stopped')

  // no timeout of its own (60): silent 10 min, a nudge typed in; 10 more, it asks you
  await rig.rpc('flowSave', { id: 'stalls', text: STALLS.replace('timeout: 1\n', '') })
  const run = await rig.rpc('flowStart', { workflow: 'stalls', project: p.id, task: 'quiet' })
  r = await working(run.id)
  const tab = r.wait.tab
  const min = 60000
  await rig.rpc('flowTick', { now: Date.now() + 9 * min })
  assert.equal((await get(run.id)).wait.nudged, undefined, 'not silent long enough')
  await rig.rpc('flowTick', { now: Date.now() + 11 * min })
  assert.ok((await get(run.id)).wait.nudged)
  await until(async () => (await rig.screen(tab)).includes('Laki here: nothing printed for 10 minutes. Finish this step, or say what is blocking you.'), 'the nudge typed in')
  await rig.rpc('flowTick', { now: Date.now() + 22 * min })
  r = await get(run.id)
  assert.deepEqual([r.status, r.wait.kind, r.wait.options, r.wait.tab], ['waiting', 'stuck', ['Nudge again', 'Try again', 'Skip it', 'Stop the run'], tab])
  assert.match(r.wait.question, /^a: its agent printed nothing for 10 minutes, even after Laki checked in$/)
  assert.ok(r.wait.used >= 22 * min, 'what its timeout has had')
  // Nudge again: on again, nudged; silent again: asks again
  await rig.rpc('flowAnswer', { id: run.id, n: 0 })
  r = await get(run.id)
  assert.deepEqual([r.status, r.wait.kind, !!r.wait.nudged], ['running', 'agent', true])
  await rig.rpc('flowTick', { now: Date.now() + 11 * min })
  assert.equal((await get(run.id)).wait.kind, 'stuck')
  // Try again: its turn stopped (Esc), the prompt again
  await rig.rpc('flowAnswer', { id: run.id, n: 1 })
  r = await working(run.id, 2)
  assert.equal(r.wait.tab, tab, 'the same tab')
  assert.match(await rig.screen(tab), /Interrupted/)
  // Skip it: next, with no answer
  await rig.rpc('flowTick', { now: Date.now() + 11 * min })
  await rig.rpc('flowTick', { now: Date.now() + 22 * min })
  await rig.rpc('flowAnswer', { id: run.id, n: 2 })
  r = await ended(run.id)
  assert.equal(r.status, 'done', r.log.join('\n'))
  assert.deepEqual([r.decisions.at(-1).exit, r.decisions.at(-1).why, r.decisions.at(-1).you, r.vars['steps.a.answer']], ['next', 'you skipped it', true, ''])
  assert.equal(r.log.filter((l: string) => / a: nothing printed for 10 min: Laki checked in/.test(l)).length, 3)
})

// a working line that ticks (claude's and codex's seconds) isn't output: the stall clock runs from the screen's last change
test('workflow agents: a turn whose working line only ticks is nudged 10 min after its screen last changed', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'ticks', text: STALLS.replace('timeout: 1\n', '').replace('> slow', '> tick') })
  const run = await rig.rpc('flowStart', { workflow: 'ticks', project: p.id, task: 'on' })
  const get = () => rig.rpc('flowGet', { id: run.id })
  const r = await until(async () => (x => x.wait?.kind === 'agent' && x)(await get()), 'its turn')
  await until(async () => /\d+s · esc to interrupt/.test(await rig.screen(r.wait.tab)), 'its line ticking')
  const t1 = Date.now()
  await rig.rpc('flowTick', { now: t1 + 1000 }) // its screen seen
  await sleep(2500) // ticks meanwhile: the last output 2 s on, the screen the same
  await rig.rpc('flowTick', { now: t1 + 10 * 60000 + 1000 }) // 10 min since it changed, not since it last printed
  assert.ok((await get()).wait.nudged, 'nudged')
})

// a try again of a session: new agent block goes to its own tab, where it can see what went wrong
test('workflow agents: a session new block tries again in the same tab', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'again', text: STALLS.replace('timeout: 1\n', 'timeout: 1\nsession: new\nretry: 1\n') })
  const run = await rig.rpc('flowStart', { workflow: 'again', project: p.id, task: 'x' })
  const get = () => rig.rpc('flowGet', { id: run.id })
  const first = await until(async () => (x => x.wait?.kind === 'agent' && x)(await get()), 'its turn')
  await until(async () => (await rig.screen(first.wait.tab)).includes('esc to interrupt'), 'at work')
  await sleep(200)
  await rig.rpc('flowTick', { now: Date.now() + 61000 }) // past its timeout: Esc, then a try again
  await until(async () => (await get()).wait?.kind === 'retry', 'its try again', 10000)
  await rig.rpc('flowTick', { now: Date.now() + 11000 })
  const r = await until(async () => (x => x.wait?.kind === 'agent' && x.tries?.a === 1 && x)(await get()), 'tried again')
  assert.equal(r.wait.tab, first.wait.tab, 'the same tab')
})

// an agent block's agent asks (the fake's permission menu): the run asks you with its choices, answers through core's
// answer; answered in its tab, the run goes on; one notification (the tab's), none of the run's own
const ASKS = `# Asks

runs in: main · session: new

## start
input: task
next: a

## a
agent: claude
> {{task}} the build
next: e

## e
end: success
`
test('workflow agents: a permission prompt makes the run ask you with its choices; answered here or in its tab, it goes on', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'asks', text: ASKS })
  const c = await rig.connect()
  t.after(() => c.close())
  const get = (id: string) => rig.rpc('flowGet', { id })
  const asked = (id: string) => until(async () => (x => x.wait?.kind === 'agent-ask' && x)(await get(id)), 'it asks', 10000)
  const ended = (id: string) => until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await get(id)), 'the end', 15000)

  // answered here: core's answer picks it in the tab; its turn's end moves the run on
  const run = await rig.rpc('flowStart', { workflow: 'asks', project: p.id, task: 'menu' })
  let r = await asked(run.id)
  assert.equal(r.status, 'waiting')
  assert.deepEqual(r.wait.options, ['Yes', "Yes, and don't ask again for rm commands", 'No, and tell Claude what to do differently (esc)', 'Stop the run'])
  assert.deepEqual(r.wait.ns, [1, 2, 3])
  assert.equal(r.wait.question, 'Claude needs your permission to use Bash')
  assert.equal((await rig.rpc('state')).flows.find((f: any) => f.id === run.id).status, 'waiting', 'the view says so')
  r = await rig.rpc('flowAnswer', { id: run.id, n: 0 })
  assert.deepEqual([r.status, r.wait?.kind], ['running', 'agent'])
  r = await ended(run.id)
  assert.equal(r.status, 'done', r.log.join('\n'))
  assert.equal(r.vars['steps.a.answer'], 'picked: Yes')
  assert.ok(r.log.some((l: string) => / a: you answered Yes$/.test(l)), r.log.join('\n'))
  assert.ok(c.events.some(e => e.ev === 'turn' && e.kind === 'waiting'), 'the tab’s notification')
  assert.ok(!c.events.some(e => e.ev === 'flow' && e.kind === 'waiting'), 'none of the run’s own')

  // answered in the tab: back to running as the agent goes on, then on as its turn ends
  const two = await rig.rpc('flowStart', { workflow: 'asks', project: p.id, task: 'menu' })
  r = await asked(two.id)
  const tab = r.wait.tab
  await rig.rpc('hook', { tab, state: 'running' })
  await rig.rpc('flowTick')
  r = await get(two.id)
  assert.deepEqual([r.status, r.wait.kind, r.wait.tab], ['running', 'agent', tab])
  await rig.rpc('hook', { tab, state: 'waiting', payload: { message: 'Claude needs your permission to use Bash' } })
  r = await asked(two.id)
  await rig.rpc('answer', { tab, n: 3 }) // in the tab: No
  r = await ended(two.id)
  assert.equal(r.vars['steps.a.answer'], 'picked: No, and tell Claude what to do differently (esc)')

  // no menu read: only Stop the run
  const three = await rig.rpc('flowStart', { workflow: 'asks', project: p.id, task: 'ask' })
  r = await asked(three.id)
  assert.deepEqual([r.wait.options, r.wait.ns], [['Stop the run'], []])
  await assert.rejects(rig.rpc('flowAnswer', { id: three.id, n: 1 }), /choice 1\? 0 to 0/)
  r = await rig.rpc('flowAnswer', { id: three.id, n: 0 })
  assert.equal(r.status, 'stopped')
})

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

const INPUTS = `# Fix issue
Fixes one.

runs in: main · session: new

## start
input: task
inputs: issue:number, base:branch=main, reviewer?, size:choice(s|m|l)=m
next: r

## r
run: echo {{inputs.issue}} {{inputs.base}} {{inputs.size}} [{{inputs.reviewer}}]
ok: e
fail: e

## e
end: success
`

test('workflow inputs: the line reads back, check names a bad one, a run fills them; needed, numbers, choices; a schedule needs defaults', async t => {
  const { workflow, problems } = parse(INPUTS, 'fix')
  assert.deepEqual(problems, [])
  assert.deepEqual(check(workflow), [])
  assert.equal(toFile(workflow), INPUTS, 'round trip')
  assert.deepEqual(workflow.blocks[0].inputs, [
    { name: 'issue', kind: 'number' },
    { name: 'base', kind: 'branch', default: 'main' },
    { name: 'reviewer', kind: 'text', optional: true },
    { name: 'size', kind: 'choice', choices: ['s', 'm', 'l'], default: 'm' },
  ])
  assert.deepEqual(inputVals(workflow.blocks[0].inputs, { issue: '7' }), { 'inputs.issue': '7', 'inputs.base': 'main', 'inputs.reviewer': '', 'inputs.size': 'm' })
  const bad = parse(INPUTS.replace('inputs: issue:number,', 'inputs: issue:number, issue, n:float, c:choice(a|b)=z,').replace('[{{inputs.reviewer}}]', '{{inputs.who}}')).workflow
  assert.deepEqual(check(bad), [
    'Start: inputs: issue twice',
    'Start: inputs: n:float? text, number, branch or choice(a|b)',
    'Start: inputs: c=z? not one of its choices',
    "r: {{inputs.who}} isn't one of Start's inputs",
  ])

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'fix', text: INPUTS })
  const start = (inputs?: Record<string, string>) => rig.rpc('flowStart', { workflow: 'fix', project: p.id, task: 'x', inputs })
  await assert.rejects(start(), /what's issue\?/)
  await assert.rejects(start({ issue: '14x' }), /issue: 14x\? a number/)
  await assert.rejects(start({ issue: '1', size: 'xl' }), /size: xl\? one of s, m, l/)
  await assert.rejects(start({ issue: '1', isue: '2' }), /isue\? its inputs are issue, base, reviewer, size/)
  const run = await start({ issue: '1423', size: 'l' })
  assert.equal(run.vars['inputs.issue'], '1423')
  const r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'done' && x
  }, 'done')
  assert.equal(r.vars['steps.r.output'], '1423 main l []')

  // the CLI's --set
  const cli = await rig.cli('flow', 'run', 'fix', p.id, 'y', '--set', 'issue=9', '--set', 'reviewer=ann', '--json')
  assert.equal(JSON.parse(cli.out).vars['inputs.reviewer'], 'ann')

  // a schedule: its run gives no inputs, so each needed one needs a default
  await assert.rejects(rig.rpc('scheduleSet', { project: p.id, workflow: 'fix', prompt: 'x', when: 'every day at 9am' }), /Fix issue can't run on a schedule: what's issue\?/)
  await rig.rpc('flowSave', { id: 'fix', text: INPUTS.replace('issue:number', 'issue:number=1') })
  assert.ok((await rig.rpc('scheduleSet', { project: p.id, workflow: 'fix', prompt: 'x', when: 'every day at 9am' })).id)
})

const MODES = `# Modes
Nightly, unattended.

runs in: worktree · session: new · turns: 30 · perm: acceptEdits

## start
input: task
next: plan

## plan
agent: claude · perm: plan · fast: yes · session: new
> plan {{task}}
next: build

## build
agent: claude
> build {{task}}
next: done

## done
end: success
`

test('workflow permission modes: perm and fast per agent block and the head’s default, checked offline and before a workspace; the agent’s flags; bypass is yours to start', async t => {
  const { workflow, problems } = parse(MODES, 'modes')
  assert.deepEqual(problems, [])
  assert.deepEqual(check(workflow), [])
  assert.equal(toFile(workflow), MODES, 'round trip')
  assert.equal(workflow.perm, 'acceptEdits')
  assert.deepEqual([workflow.blocks[1].perm, workflow.blocks[1].fast], ['plan', true])
  // a bad mode, a mode the agent hasn't, two blocks in one tab with different modes
  const bad = (s: string) => check(parse(MODES.replace('agent: claude · perm: plan · fast: yes · session: new', s)).workflow)
  assert.deepEqual(bad('agent: claude · perm: yolo · session: new'), ['plan: permission mode yolo? auto, acceptEdits, plan, bypassPermissions'])
  assert.deepEqual(bad('agent: gemini · perm: auto · fast: yes'), ['plan: gemini has no permission modes', 'plan: gemini has no fast mode'])
  assert.deepEqual(bad('agent: claude · perm: plan'), ["build shares plan's tab, which starts in plan mode: give build session: new for accept edits"])
  assert.deepEqual(check(parse(MODES.replace('perm: acceptEdits', 'perm: yolo')).workflow), ["the workflow's permission mode yolo? auto, acceptEdits, plan, bypassPermissions"])
  assert.deepEqual(bad('agent: gemini'), [], 'the head’s mode skips an agent that has none')

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'modes', text: MODES })
  const run = await rig.rpc('flowStart', { workflow: 'modes', project: p.id, task: 'x' })
  const r = await until(async () => {
    const x = await rig.rpc('flowGet', { id: run.id })
    return x.status === 'done' && x
  }, 'done', 20000)
  const tabs = (await rig.rpc('state')).tabs
  const tab = (id: string) => tabs.find((x: any) => x.id === r.tabs[id])
  assert.deepEqual([tab('plan').perm, tab('plan').fast], ['plan', true])
  assert.deepEqual([tab('build').perm, tab('build').fast], ['acceptEdits', undefined], 'the head’s default')
  const mode = (id: string) => (a => a[a.indexOf('--permission-mode') + 1])(rig.fakeLog().find(l => l.bin === 'claude' && l.tab === r.tabs[id]).args)
  assert.equal(mode('plan'), 'plan')
  assert.equal(mode('build'), 'acceptEdits')
  assert.ok(r.log.some((l: string) => /plan: a new claude tab, .* \(plan mode · fast\)/.test(l)), r.log.join('\n'))

  // a preset whose agent hasn't the mode: refused before any workspace
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'gem', agent: 'gemini' }] })
  await rig.rpc('flowSave', { id: 'gem', text: MODES.replace('agent: claude · perm: plan · fast: yes · session: new', 'agent: gem · perm: plan') })
  const before = (await rig.rpc('state')).workspaces.length
  await assert.rejects(rig.rpc('flowStart', { workflow: 'gem', project: p.id, task: 'x' }), /Modes can't run: plan: gemini has no permission modes/)
  assert.equal((await rig.rpc('state')).workspaces.length, before, 'no workspace made')

  // bypass: an agent (MCP, Laki AI) can't start it; you can; a dry run says it
  await rig.rpc('flowSave', { id: 'yolo', text: MODES.replace('perm: acceptEdits', 'perm: bypassPermissions') })
  await assert.rejects(rig.rpc('flowStart', { workflow: 'yolo', project: p.id, task: 'x', by: 'agent' }), /Modes runs an agent that never asks \(bypass permissions: build\): start it yourself/)
  rig.env.LAKI_TAB = r.tabs.build // the CLI in an agent's tab is an agent too
  const viaCli = await rig.cli('flow', 'run', 'yolo', p.id, 'x')
  delete rig.env.LAKI_TAB
  assert.notEqual(viaCli.code, 0)
  assert.match(viaCli.err, /never asks \(bypass permissions: build\): start it yourself/)
  const dry = await rig.rpc('flowStart', { workflow: 'yolo', project: p.id, task: 'x', dry: true })
  assert.ok((await rig.rpc('flowGet', { id: dry.id })).log.some((l: string) => /dry run: build would run with bypass permissions/.test(l)))
  await rig.rpc('flowStop', { id: dry.id })
})

// the paths a user hits first: a restart mid turn, a usage limit, real PR checks, an agent's tab closed
const AGENT = (agent: string, prompt: string) => `# Agent
One turn.

runs in: worktree · session: new

## start
input: task
next: work

## work
agent: ${agent}
> ${prompt}
next: done
error: bad

## done
end: success

## bad
end: failed
`

test('workflow failures: a restart mid agent block: its resumed chat told to finish, a new chat the prompt again; a usage limit pauses, its continue goes on', async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '60000' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'agent', text: AGENT('claude', 'think {{task}}') })
  await rig.rpc('flowSave', { id: 'other', text: AGENT('claude', 'ponder {{task}}') })
  const get = (id: string) => rig.rpc('flowGet', { id })
  const turnOf = async (id: string, typed: string) => {
    const tab = (await until(async () => {
      const r = await get(id)
      return r.wait?.kind === 'agent' && r.wait.tab
    }, 'its turn')) as string
    await until(async () => (await rig.screen(tab)).includes(typed), 'the prompt typed')
    await until(() => JSON.parse(readFileSync(join(rig.data, 'state.json'), 'utf8')).tabs.find((x: any) => x.id === tab)?.resumeId, 'its chat (SessionStart)')
    return tab
  }
  const run = await rig.rpc('flowStart', { workflow: 'agent', project: p.id, task: 'hard' })
  const run2 = await rig.rpc('flowStart', { workflow: 'other', project: p.id, task: 'deep' })
  await turnOf(run.id, 'think hard')
  const tab2 = await turnOf(run2.id, 'ponder deep')
  // their turns are cut short: Laki comes back to each block. run2's tab lost its chat meanwhile: a new one starts there
  await rig.stop()
  const file = join(rig.data, 'state.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  delete st.tabs.find((x: any) => x.id === tab2).resumeId
  writeFileSync(file, JSON.stringify(st))
  rig.env.FAKE_TURN_MS = '300'
  await rig.start()
  const done = (id: string) => until(async () => {
    const x = await get(id)
    return x.status === 'done' && x
  }, 'done after the restart', 30000)
  let r = await done(run.id)
  assert.ok(r.log.some((l: string) => / Laki restarted: back at work$/.test(l)))
  assert.ok(r.log.some((l: string) => / work: its chat resumed in .+: told to finish the step$/m.test(l)), r.log.join('\n'))
  assert.equal(r.vars['steps.work.answer'], 'answer: Laki restarted while you were on this step. Finish it, then stop.', 'the short line, not the prompt')
  assert.equal(r.turns, 1, 'no new turn')
  r = await done(run2.id)
  assert.ok(r.log.some((l: string) => / work: a new chat in its tab after the restart: the whole prompt again$/m.test(l)), r.log.join('\n'))
  assert.equal(r.vars['steps.work.answer'], 'answer: ponder deep')
  assert.equal(r.turns, 2)

  // at its usage limit (StopFailure): paused, then on as the limit's continue ends a turn
  await rig.rpc('flowSave', { id: 'limit', text: AGENT('claude', 'limit {{task}}') })
  const lim = await rig.rpc('flowStart', { workflow: 'limit', project: p.id, task: 'x' })
  r = await until(async () => {
    const x = await get(lim.id)
    return x.status === 'paused' && x
  }, 'paused', 15000)
  assert.equal(r.wait.kind, 'limit')
  assert.ok(r.log.some((l: string) => /work: .* hit its usage limit; paused until/.test(l)))
  await rig.rpc('watchLimits', { now: r.wait.until + 61_000 })
  r = await until(async () => {
    const x = await get(lim.id)
    return x.status === 'done' && x
  }, 'on after the limit', 15000)
  assert.equal(r.vars['steps.work.answer'], 'answer: continue')

  // paused at a limit, its tab closed: its error way at the next tick, not paused for good
  const gone = await rig.rpc('flowStart', { workflow: 'limit', project: p.id, task: 'y' })
  r = await until(async () => {
    const x = await get(gone.id)
    return x.status === 'paused' && x
  }, 'paused again', 15000)
  await rig.rpc('tabClose', { id: r.wait.tab })
  await rig.rpc('flowTick', {})
  r = await until(async () => {
    const x = await get(gone.id)
    return x.status === 'failed' && x
  }, 'its error way')
  assert.equal(r.decisions.at(-1).exit, 'error')
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

test('workflow trash and history: a delete goes to the trash and Undo brings it back; each save keeps the one before (20); a revert; tidy after 30 days', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const text = AGENT('claude', 'x')
  await rig.rpc('flowSave', { id: 'gone', text })
  const del = await rig.rpc('flowRm', { id: 'gone' })
  assert.equal(existsSync(join(rig.data, 'workflows', 'gone.md')), false)
  assert.deepEqual((await rig.rpc('flowTrash')).map((x: any) => [x.trash, x.id, x.name]), [[del.trash, 'gone', 'Agent']])
  await rig.rpc('flowRestore', { trash: del.trash })
  assert.equal(readFileSync(join(rig.data, 'workflows', 'gone.md'), 'utf8'), text, 'the same text back')
  assert.deepEqual(await rig.rpc('flowTrash'), [])
  // a project's goes too; its Undo with a new file of that id is refused
  await rig.rpc('flowSave', { id: 'theirs', source: 'project', project: p.id, text })
  const d2 = await rig.rpc('flowRm', { id: 'theirs', source: 'project', project: p.id })
  assert.equal(existsSync(join(p.path, '.laki', 'workflows', 'theirs.md')), false)
  await rig.rpc('flowSave', { id: 'theirs', source: 'project', project: p.id, text: '# New\n' })
  await assert.rejects(rig.rpc('flowRestore', { trash: d2.trash }), /a workflow theirs is there now: not restored/)
  const cli = await rig.cli('flow', 'trash')
  assert.match(cli.out, new RegExp(`^${d2.trash}  Agent  `, 'm'))

  // history: ten saves over it, ten versions (an agent's too), newest first; a revert writes one back
  const v = (n: number) => text.replace('> x', `> version ${n}`)
  for (let n = 1; n <= 10; n++) await rig.rpc('flowSave', { id: 'gone', text: v(n), ...(n === 5 && { by: 'agent' }) })
  let h = await rig.rpc('flowHistory', { id: 'gone' })
  assert.equal(h.length, 10)
  assert.equal((await rig.rpc('flowHistory', { id: 'gone', at: h[0].at })).text, v(9))
  assert.equal((await rig.rpc('flowHistory', { id: 'gone', at: h[9].at })).text, text)
  assert.equal(h[0].first, '# Agent')
  await rig.rpc('flowRevert', { id: 'gone', at: h[9].at })
  assert.equal(readFileSync(join(rig.data, 'workflows', 'gone.md'), 'utf8'), text, 'the old text back')
  h = await rig.rpc('flowHistory', { id: 'gone' })
  assert.equal((await rig.rpc('flowHistory', { id: 'gone', at: h[0].at })).text, v(10), 'the one it replaced kept')
  // past 20: the oldest goes
  for (let n = 11; n <= 20; n++) await rig.rpc('flowSave', { id: 'gone', text: v(n) })
  h = await rig.rpc('flowHistory', { id: 'gone' })
  assert.equal(h.length, 20)
  assert.equal((await rig.rpc('flowHistory', { id: 'gone', at: h[19].at })).text, v(1), 'the first save’s file went')
  await assert.rejects(rig.rpc('flowRevert', { id: 'gone' }), /which version\?/, 'no version: nothing written')
  assert.equal(readFileSync(join(rig.data, 'workflows', 'gone.md'), 'utf8'), v(20))

  // tidy: past 30 days, gone for good, its history too (not theirs: a workflow of that id is there again)
  await rig.rpc('flowRm', { id: 'gone' })
  await rig.rpc('flowTrashTidy', { now: Date.now() + 29 * 86400e3 })
  assert.equal((await rig.rpc('flowTrash')).length, 2)
  assert.ok(existsSync(join(rig.data, 'workflow-history', 'yours-gone')))
  await rig.rpc('flowTrashTidy', { now: Date.now() + 31 * 86400e3 })
  assert.deepEqual(await rig.rpc('flowTrash'), [])
  assert.equal(existsSync(join(rig.data, 'workflow-history', 'yours-gone')), false)
})

const TIDY = (cmd: string, head = '') => `# Tidy

runs in: worktree · session: new${head}

## start
input: task
next: work

## work
run: ${cmd}
ok: end
fail: bad

## end
end: success

## bad
end: failed
`

test('workflow when done: a done run’s clean worktree archived; one with changes, a failed run, a workspace it was given and when done: keep stay, the log says which', async t => {
  const KEEP = TIDY('echo hi', ' · when done: keep')
  assert.equal(parse(KEEP).workflow.done, 'keep')
  assert.equal(toFile(parse(KEEP, 'keep').workflow), KEEP, 'round trip')
  assert.deepEqual(check(parse(TIDY('echo hi', ' · when done: later')).workflow), ['when done: later? archive or keep'])
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'clean', text: TIDY('echo hi') })
  await rig.rpc('flowSave', { id: 'dirty', text: TIDY('echo x > new.txt') })
  await rig.rpc('flowSave', { id: 'fails', text: TIDY('exit 3') })
  await rig.rpc('flowSave', { id: 'keep', text: KEEP })
  const mine = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'mine' })
  const end = async (o: object, line: RegExp) => {
    const { id } = await rig.rpc('flowStart', { task: 'x', ...o })
    return until(async () => {
      const r = await rig.rpc('flowGet', { id })
      return r.log.some((l: string) => line.test(l)) && r
    }, `${id}: ${line}`)
  }
  const archived = async (id: string) => (await rig.rpc('state')).workspaces.find((w: any) => w.id === id)?.archived
  const clean = await end({ workflow: 'clean', project: p.id }, / archived: the run is done \(Restore brings it back\)$/)
  assert.equal(clean.status, 'done')
  assert.ok(await archived(clean.ws), 'the clean worktree archived')
  const dirty = await end({ workflow: 'dirty', project: p.id }, / stays: 1 file not committed$/)
  assert.equal(await archived(dirty.ws), undefined)
  const fails = await end({ workflow: 'fails', project: p.id }, / stays: the run failed$/)
  assert.equal(fails.status, 'failed')
  assert.equal(await archived(fails.ws), undefined)
  await end({ workflow: 'clean', ws: mine.id }, /mine stays: the run didn't make it$/)
  assert.equal(await archived(mine.id), undefined)
  const keep = await end({ workflow: 'keep', project: p.id }, / stays: when done: keep$/)
  const dry = await end({ workflow: 'clean', project: p.id, dry: true }, / stays: a dry run: archiving is said, not done$/)
  assert.equal(await archived(dry.ws), undefined)
  assert.equal(await archived(keep.ws), undefined)
})

const CHECKS = `# Checks
Waits for CI.

runs in: worktree · session: new

## start
input: task
next: wait

## wait
wait: checks
pass: ok
fail: fix
max: 3

## fix
run: echo fixing
ok: wait
fail: bad

## ok
end: success

## bad
end: failed
`

test('workflow failures: a wait on real PR checks (fail with their names, not twice on one head, a new head passes); a closed agent tab', async t => {
  const rig = await fresh(t)
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  const pr = (head: string, conclusion: string) =>
    writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 7, state: 'OPEN', url: 'https://example.invalid/pr/7', headRefOid: head, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion, detailsUrl: 'https://ci.invalid/1' }, { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] }))
  pr('h1', 'FAILURE')
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'checks', text: CHECKS })
  const get = (id: string) => rig.rpc('flowGet', { id })
  const run = await rig.rpc('flowStart', { workflow: 'checks', project: p.id, task: 'ci' })
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws)?.pr?.head === 'h1', 'PR scanned')
  let r = await until(async () => {
    await rig.rpc('flowTick', {})
    const x = await get(run.id)
    return x.visits.wait === 2 && x
  }, 'fail, the fix, back at the wait')
  assert.equal(r.vars['steps.wait.output'], 'test https://ci.invalid/1')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'wait:fail', 'fix:ok'])
  // the same head failing: not again
  for (let i = 0; i < 3; i++) await rig.rpc('flowTick', {}), await sleep(200)
  r = await get(run.id)
  assert.equal(r.cur, 'wait')
  assert.equal(r.decisions.length, 3)
  // a new head that passes
  pr('h2', 'SUCCESS')
  await until(async () => (await rig.rpc('state')).workspaces.find((w: any) => w.id === run.ws)?.pr?.head === 'h2', 'the new head scanned')
  r = await until(async () => {
    await rig.rpc('flowTick', {})
    const x = await get(run.id)
    return x.status === 'done' && x
  }, 'pass')
  assert.deepEqual(r.decisions.map((d: any) => `${d.block}:${d.exit}`), ['start:next', 'wait:fail', 'fix:ok', 'wait:pass'])

  // an agent block whose tab is closed: its error way at the next tick
  await rig.rpc('flowSave', { id: 'agent', text: AGENT('claude', 'slow {{task}}') })
  const a = await rig.rpc('flowStart', { workflow: 'agent', project: p.id, task: 'x' })
  const tab = (await until(async () => {
    const x = await get(a.id)
    return x.wait?.kind === 'agent' && x.wait.tab
  }, 'its turn')) as string
  await until(async () => (await rig.screen(tab)).includes('esc to interrupt'), 'working')
  await rig.rpc('tabClose', { id: tab })
  await rig.rpc('flowTick', {})
  r = await until(async () => {
    const x = await get(a.id)
    return x.status === 'failed' && x
  }, 'error')
  assert.equal(r.decisions.at(-1).exit, 'error')
  assert.match(r.decisions.at(-1).why, /stopped$/)
})

test('a Show you and an end tell you as they say: a window, a popover in the corner, a macOS notification', async t => {
  const SHOWS = `# Shows
## start
input: task
next: show
## show
popup: Hi {{task}}
modal: no
popover: yes
> body of {{task}}
next: done
## done
end: success · notify: yes · popover: yes · modal: yes
> all done
`
  const { workflow, problems } = parse(SHOWS, 'shows')
  assert.deepEqual([problems, check(workflow)], [[], []])
  const [show, done] = [workflow.blocks[1], workflow.blocks[2]]
  assert.deepEqual([show.modal, show.popover, done.modal, done.popover, done.notify], [false, true, true, true, true])
  assert.deepEqual(parse(toFile(workflow), 'shows').workflow, workflow, 'written back as it was read')
  const nowhere = parse(SHOWS.replace('popover: yes\n', ''), 'shows').workflow
  assert.match(check(nowhere).join(), /show: shown nowhere/)

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  await rig.rpc('flowSave', { id: 'shows', text: SHOWS })
  const c = await rig.connect()
  t.after(() => c.close())
  const run = await rig.rpc('flowStart', { workflow: 'shows', project: p.id, task: 'x' })
  const r = await until(async () => (x => FLOW_ENDED.includes(x.status) && x)(await rig.rpc('flowGet', { id: run.id })), 'the end', 15000)
  assert.equal(r.status, 'done', r.log.join('\n'))
  const ev = (kind: string) => until(() => c.events.find(e => e.ev === 'flow' && e.kind === kind), kind)
  const s = await ev('show')
  assert.deepEqual([s.text, s.body, s.modal, s.popover, s.notify], ['Hi x', 'body of x', false, true, false])
  const e = await ev('end')
  assert.deepEqual([e.text, e.modal, e.popover, e.notify], ['all done', true, true, true])
  assert.deepEqual(r.shown.map((x: any) => x.title), ['Hi x', 'Shows: done'], 'the end’s window kept with the run too')
})

test('workflows on an event: on: custom.x starts a run in the event’s project with {{event.…}}; flow.ended; the refused ones said', async t => {
  // the file: on: in its head, read back; an unknown event is a problem
  const wf = parse('# On\nruns in: main · on: custom.deploy\n\n## start\ninput: task\nnext: e\n\n## e\nend: success\n').workflow
  assert.equal(wf.on, 'custom.deploy')
  assert.match(toFile(wf), /^runs in: main · session: new · on: custom\.deploy$/m)
  assert.deepEqual(check(wf), [])
  assert.match(check({ ...wf, on: 'pr.merge' }).join(), /on: pr\.merge isn't an event/)

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  mkdirSync(join(rig.data, 'widgets', 'fe'), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', 'fe', 'widget.json'), JSON.stringify({ name: 'fe', on: { 'flow.ended': 'keep' }, actions: { keep: `cat > "${rig.env.HOME}/ended.json"` } }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'fe', on: true })
  const body = '\n\n## start\ninput: task\nnext: say\n\n## say\nrun: echo got {{event.data.y}} in {{event.ws.name}}\nok: e\nfail: e\n\n## e\nend: success\n'
  await rig.rpc('flowSave', { id: 'deploy', text: `# Deploy\nruns in: main · on: custom.deploy${body}` })
  await rig.rpc('flowSave', { id: 'theirs', text: `# Theirs\nruns in: main · on: custom.deploy${body}`, by: 'agent' })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'here' })

  // no workspace: no project to run in
  let r = await rig.rpc('widgetEmit', { name: 'deploy', data: { y: 'no' } })
  assert.deepEqual(r.flows, [])
  assert.ok((await rig.rpc('widgetEvents'))[0].refused.includes('deploy: the event has no workspace, so no project'))

  r = await rig.rpc('widgetEmit', { name: 'deploy', data: { y: 'yes' }, ws: ws.id })
  assert.deepEqual(r.flows, ['deploy'])
  assert.deepEqual((await rig.rpc('widgetEvents'))[0].refused, ['theirs: an agent wrote it: save it in Workflows first'])
  const run = await until(async () => (await rig.rpc('state')).flows?.find((x: any) => x.workflow === 'deploy'), 'a run')
  const done = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: run.id })), 'done')
  assert.deepEqual([done.project, done.task, done.trigger], [p.id, 'custom.deploy', 'event custom.deploy'])
  assert.equal(done.vars['steps.say.output'], 'got yes in here')
  // flow.ended: to the extensions that answer it
  const ended = await until(() => (f => existsSync(f) && JSON.parse(readFileSync(f, 'utf8')))(join(rig.env.HOME, 'ended.json')), 'flow.ended')
  assert.deepEqual([ended.run, ended.workflow, ended.status], [run.id, { id: 'deploy', name: 'Deploy' }, 'done'])
  // runs in: here: in the event's workspace
  await rig.rpc('flowSave', { id: 'inhere', text: `# In here\nruns in: here · on: custom.check${body}` })
  r = await rig.rpc('widgetEmit', { name: 'check', data: { y: 'there' }, ws: ws.id })
  assert.deepEqual(r.flows, ['inhere'])
  const there = await until(async () => (x => x?.status === 'done' && x)((await rig.rpc('state')).flows?.find((x: any) => x.workflow === 'inhere')), 'its run done')
  assert.deepEqual([there.ws, (await rig.rpc('flowGet', { id: there.id })).vars['steps.say.output']], [ws.id, 'got there in here'])

  // an agent's event: not to one that runs commands
  const ag = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  r = await rig.rpc('widgetEmit', { name: 'deploy', ws: ws.id, from: { tab: ag.id } })
  assert.deepEqual(r.flows, [])
  assert.ok((await rig.rpc('widgetEvents'))[0].refused.includes('deploy: an agent sent the event, and it runs commands, a webhook, outward actions or an agent that never asks'))
})

test('run blocks: {{vars}} as env references (bare, in double quotes), never shell text; in single quotes a problem', async t => {
  assert.deepEqual(shellFill(`echo {{a}} "x {{a}} {{b}}" '{{c}}' \\"{{a}}\\" {{none}}`, { a: '1', b: '2', c: '3' }), {
    cmd: `echo "$LAKI_V_0" "x $LAKI_V_0"" $LAKI_V_1""" '{{c}}' \\""$LAKI_V_0"\\" {{none}}`,
    env: { LAKI_V_0: '1', LAKI_V_1: '2' },
    single: ['c'],
  })
  const wf = (cmd: string) => parse(`# R\nruns in: here\n\n## start\nnext: say\n\n## say\nrun: ${cmd}\nok: e\nfail: e\n\n## e\nend: success\n`).workflow
  assert.match(check(wf("echo '{{event.pr.title}}'")).join(), /\{\{event\.pr\.title\}\} is inside single quotes/)
  assert.deepEqual(check(wf('echo "{{event.pr.title}}" {{event.pr.title}}')), [])

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'here' })
  const title = `$(touch ${rig.home}/x1)\`touch ${rig.home}/x2\`;touch ${rig.home}/x3 "'`
  await rig.rpc('flowSave', { id: 'quoted', text: `# Q\nruns in: here · on: custom.t\n\n## start\nnext: say\n\n## say\nrun: echo "[{{event.data.t}}]" {{event.data.t}}\nok: e\nfail: e\n\n## e\nend: success\n` })
  await rig.rpc('widgetEmit', { name: 't', data: { t: title }, ws: ws.id })
  const run = await until(async () => (x => x?.status === 'done' && x)((await rig.rpc('state')).flows?.find((x: any) => x.workflow === 'quoted')), 'its run done')
  assert.equal((await rig.rpc('flowGet', { id: run.id })).vars['steps.say.output'], `[${title}] ${title}`)
  for (const f of ['x1', 'x2', 'x3']) assert.ok(!existsSync(join(rig.home, f)), `${f}: nothing ran`)
})

test("a repo's workflow (.laki/workflows) starts on an event, a schedule or an agent's ask only once trusted as it is; an edit stops it; the app's Start runs it", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  // as git brings it: never saved in Laki
  const file = join(rig.repo, '.laki/workflows/onnew.md')
  mkdirSync(dirname(file), { recursive: true })
  const text = '# On new\nruns in: here · on: workspace.new\n\n## start\nnext: say\n\n## say\nrun: echo hi\nok: e\nfail: e\n\n## e\nend: success\n'
  writeFileSync(file, text)
  const item = () => rig.rpc('flowList', { project: p.id }).then((l: any[]) => l.find(w => w.id === 'onnew'))
  assert.equal((await item()).untrusted, true)
  const started = async () => ((await rig.rpc('state')).flows ?? []).filter((r: any) => r.workflow === 'onnew').length
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  await until(async () => (await rig.rpc('widgetEvents')).some((e: any) => e.event === 'workspace.new' && e.refused?.includes('onnew: from the repo, not allowed as it is: open it in Workflows, then Allow or Save it')), 'refused, said in laki widget events')
  assert.equal(await started(), 0)
  // a schedule's and an agent's start: refused; the app's own Start: runs it
  await assert.rejects(rig.rpc('flowStart', { workflow: 'onnew', source: 'project', project: p.id, trigger: 'schedule x' }), /isn't trusted as it is yet/)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'onnew', source: 'project', project: p.id, by: 'agent' }), /isn't trusted as it is yet/)
  await rig.rpc('flowStart', { workflow: 'onnew', source: 'project', project: p.id, ws: ws.id, editor: true })
  await until(async () => (await started()) === 1, "the app's Start runs it")
  // trusted as the sheet showed it (another text: refused); then an event starts it
  await assert.rejects(rig.rpc('flowTrust', { id: 'onnew', project: p.id, text: 'nope' }), /changed since you looked/)
  await rig.rpc('flowTrust', { id: 'onnew', project: p.id, text })
  assert.equal((await item()).untrusted, undefined)
  await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'two' })
  await until(async () => (await started()) === 2, 'the event starts it, trusted')
  // an edit: not trusted again
  writeFileSync(file, text.replace('echo hi', 'echo changed'))
  assert.equal((await item()).untrusted, true)
  assert.equal((await item()).changed, true)
  await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'three' })
  await until(async () => (await rig.rpc('widgetEvents')).some((e: any) => e.refused?.includes('onnew: from the repo, changed since you allowed it: open it in Workflows, then Allow or Save it')), 'refused as changed')
  await sleep(1000)
  assert.equal(await started(), 2)
  // an agent can't allow it (its own edit would run): refused, still not trusted
  const ag = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'hi', name: 'four' })
  const at = await until(() => rig.tab(ag.id), 'its agent tab')
  await assert.rejects(rig.rpc('flowTrust', { id: 'onnew', project: p.id, text: (await item()).text, caller: { ws: ag.id, tab: at.id } }), /an agent can't trust a workflow/)
  assert.equal((await item()).untrusted, true)
  // saved in the editor: you read it, trusted
  await rig.rpc('flowSave', { id: 'onnew', source: 'project', project: p.id, text: text.replace('echo hi', 'echo saved') })
  assert.equal((await item()).untrusted, undefined)
})

test("a worktree workflow on workspace.new, or on tab.new with a setup script, never starts itself on its own run's worktree", async t => {
  const rig = await fresh(t, { config: { setup: 'echo set up' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const runsOf = async (id: string) => ((await rig.rpc('state')).flows ?? []).filter((r: any) => r.workflow === id)
  const wf = (on: string) => `# Self\nruns in: worktree · at once: 5 · on: ${on}\nwhen done: keep\n\n## start\nnext: say\n\n## say\nrun: echo hi\nok: e\nfail: e\n\n## e\nend: success\n`
  await rig.rpc('flowSave', { id: 'onws', text: wf('workspace.new') })
  await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'mine' }) // yours: one run, in a worktree of its own (its setup tab too)
  await until(async () => (await runsOf('onws')).length >= 1, 'it starts')
  await sleep(2000)
  const [r] = await runsOf('onws')
  assert.equal((await runsOf('onws')).length, 1, 'its own worktree started no other run')
  assert.equal((await rig.rpc('state')).workspaces.find((w: any) => w.id === r.ws)?.flow, r.id, "the worktree is its run's")
  await rig.rpc('flowRm', { id: 'onws' })
  // on: tab.new: the run's worktree's setup tab is its own
  await rig.rpc('flowSave', { id: 'ontab', text: wf('tab.new') })
  const mine = (await rig.rpc('state')).workspaces.find((w: any) => w.name === 'mine' || w.id === 'mine')
  await rig.rpc('tabNew', { ws: mine.id, preset: 'shell' })
  await until(async () => (await runsOf('ontab')).length >= 1, 'it starts')
  await sleep(2000)
  assert.equal((await runsOf('ontab')).length, 1, 'its setup tab started no other run')
})

test('a workflow an agent wrote runs only from its editor in the app: a schedule, Run again and the CLI are refused; Delete then Undo keeps the mark', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const text = '# Nightly\nruns in: main\n\n## start\ninput: task\nnext: e\n\n## e\nend: success\n'
  await rig.rpc('flowSave', { id: 'nightly', text })
  const s = await rig.rpc('scheduleSet', { project: p.id, workflow: 'nightly', prompt: 'the inbox', when: 'every day at 9am' })
  const ran = await rig.rpc('flowStart', { workflow: 'nightly', project: p.id, task: 'x' })
  await until(async () => ((await rig.rpc('flowGet', { id: ran.id })).status === 'done' ? 'done' : ''), 'first run done')
  // an agent writes over it: the schedule's run, Run again and the CLI are refused
  await rig.rpc('flowSave', { id: 'nightly', text: text.replace('Nightly', 'Nightly (agent)'), by: 'agent' })
  const r = await rig.rpc('scheduleRun', { id: s.id })
  assert.equal(r.ok, false)
  assert.match(r.what, /an agent wrote Nightly \(agent\): the user runs it first, from its editor/)
  await assert.rejects(rig.rpc('flowStart', { again: ran.id }), /an agent wrote/)
  assert.match((await rig.cli('flow', 'run', 'nightly', p.id, 'x')).err, /an agent wrote/)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'nightly', project: p.id, task: 'x', by: 'agent', editor: true }), /an agent wrote/)
  // its editor's Start runs it
  assert.ok((await rig.rpc('flowStart', { workflow: 'nightly', project: p.id, task: 'x', editor: true })).id)
  // Delete, then Undo: still the agent's
  const del = await rig.rpc('flowRm', { id: 'nightly' })
  await rig.rpc('flowRestore', { trash: del.trash })
  assert.equal((await rig.rpc('flowList', {})).find((w: any) => w.id === 'nightly').byAgent, true)
  assert.equal((await rig.rpc('scheduleRun', { id: s.id })).ok, false)
  // saved by the user: the schedule runs it
  await rig.rpc('flowSave', { id: 'nightly', text })
  assert.equal((await rig.rpc('scheduleRun', { id: s.id })).ok, true)
})
