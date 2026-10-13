import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { check, holds, parse, runOf, toFile } from '../src/shared/workflow.ts'
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
