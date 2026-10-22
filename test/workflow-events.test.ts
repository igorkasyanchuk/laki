// Workflows on events: custom and agents' events, loops cut at HOPS_MAX, only when, a repo's workflows, a try with an event.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { check, holds, parse, toFile } from '../src/shared/workflow.ts'
import { fresh, sleep, until } from './helpers.ts'
import { neverAsks } from '../src/shared/types.ts'

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

// #3: an agent's event never starts an agent that never asks by its flags either (codex's approvals off, not only
// bypass permissions), and an agent's event for another workspace asks you first, as a send there does
test("#3: an agent's event starts no agent that never asks, by its mode or its flags; one for another workspace asks first", async t => {
  assert.deepEqual(
    [['claude', 'bypassPermissions'], ['claude', undefined, '--dangerously-skip-permissions'], ['claude', 'bypassPermissions', '--permission-mode plan'], ['codex', 'acceptEdits'], ['codex', undefined, '-a never'], ['codex', undefined, '--ask-for-approval=never'], ['codex', 'bypassPermissions', '-c approval_policy="never"'], ['codex', undefined, '-a on-request'], ['codex', 'auto'], ['claude', 'acceptEdits'], ['gemini', 'bypassPermissions']].map(([a, p, x]) => neverAsks(a, p, x)),
    [true, true, false, true, true, true, true, false, false, false, true],
  )
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true, presets: [{ name: 'claude', agent: 'claude' }, { name: 'cx', agent: 'codex', args: '-a never' }, { name: 'cx2', agent: 'codex', args: '-c approval_policy="never"' }, { name: 'cx3', agent: 'codex', perm: 'acceptEdits' }] })
  const flow = (agent: string) => `# Go ${agent}\nruns in: here · on: custom.go\n\n## start\ninput: task\nnext: work\n\n## work\nagent: ${agent}\n> {{event.data.msg}}\nnext: done\nerror: done\n\n## done\nend: success\n`
  for (const a of ['cx', 'cx2', 'cx3']) await rig.rpc('flowSave', { id: a, text: flow(a) })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'aaa' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'bbb' })
  const ag = await rig.rpc('tabNew', { ws: a.id, preset: 'claude' })
  const r = await rig.rpc('widgetEmit', { name: 'go', data: { msg: 'from A' }, ws: a.id, from: { ws: a.id, tab: ag.id } })
  assert.deepEqual(r.flows, [])
  assert.deepEqual((await rig.rpc('widgetEvents'))[0].refused.sort(), ['cx', 'cx2', 'cx3'].map(x => `${x}: an agent sent the event, and it runs commands, a webhook, outward actions or an agent that never asks`).sort())
  assert.equal((await rig.rpc('state')).flows?.length ?? 0, 0)
  // for B: no window, refused; with one, you're asked (a no is a refusal, Allow once sends it)
  const toB = () => rig.rpc('widgetEmit', { name: 'hello', data: { msg: 'from A' }, ws: b.id, from: { ws: a.id, tab: ag.id } })
  await assert.rejects(toB(), /bbb is another workspace: the user allows that in Laki's window, and it isn't open/)
  const app = await rig.connect()
  t.after(() => app.ws.close())
  for (const [allow, said] of [['deny', /custom\.hello is for bbb, another workspace: the user said no/], ['once', null]] as const) {
    const sent = toB()
    const ask = await until(() => app.events.find(m => m.ev === 'toolAsk' && m.cross === 'emit' && !m.seen), 'asked in the app')
    ask.seen = true
    assert.deepEqual([ask.from, ask.to, ask.target, ask.text], ['aaa', 'bbb', 'custom.hello', '{"msg":"from A"}'])
    await rig.rpc('widgetToolAnswer', { req: ask.req, allow })
    if (said) await assert.rejects(sent, said)
    else assert.equal((await sent).ok, true)
  }
  // yours, or into its own workspace: no ask
  assert.equal((await rig.rpc('widgetEmit', { name: 'hello', ws: b.id })).ok, true)
  assert.equal((await rig.rpc('widgetEmit', { name: 'hello', ws: a.id, from: { ws: a.id, tab: ag.id } })).ok, true)
  assert.equal(app.events.filter(m => m.ev === 'toolAsk').length, 2)
})

// #5: a run's own archive (when done: archive) restarted it for good (on: workspace.archived): the events a run causes
// carry its run and one hop more; and two workflows on each other's flow.ended stop after HOPS_MAX hops, said
test("#5: an on: workspace.archived worktree workflow started once runs once; A and B on each other's flow.ended stop after three hops", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const body = '\n\n## start\ninput: task\nnext: e\n\n## e\nend: success\n'
  await rig.rpc('flowSave', { id: 'loop', text: `# Loop\nruns in: worktree · on: workspace.archived${body}` })
  await rig.rpc('flowStart', { workflow: 'loop', project: p.id, task: 'go' })
  await until(async () => (await rig.rpc('state')).workspaces.some((w: any) => w.archived), 'its worktree archived', 20000)
  await sleep(3000)
  const s = await rig.rpc('state')
  assert.equal(s.flows.filter((f: any) => f.workflow === 'loop').length, 1, 'one run')
  assert.equal(s.workspaces.filter((w: any) => w.kind === 'worktree').length, 1)
  const ev = (await rig.rpc('widgetEvents')).find((e: any) => e.event === 'workspace.archived')
  assert.deepEqual([ev.hops, ev.refused], [1, ['loop: its own run sent it']])

  // A on B's flow.ended, B on A's: started once, they stop after HOPS_MAX (3) hops, the refusal listed
  await rig.rpc('flowSave', { id: 'a', text: `# A\nruns in: main · on: flow.ended${body}` })
  await rig.rpc('flowSave', { id: 'b', text: `# B\nruns in: main · on: flow.ended${body}` })
  await rig.rpc('flowSave', { id: 'kick', text: `# Kick\nruns in: main${body}` })
  await rig.rpc('flowStart', { workflow: 'kick', project: p.id, task: 'go' })
  await until(async () => (await rig.rpc('widgetEvents')).some((e: any) => e.event === 'flow.ended' && e.refused?.some((r: string) => /4 hops: a loop of events\? dropped/.test(r))), 'the chain refused', 20000)
  await sleep(2000)
  const n = (await rig.rpc('state')).flows.filter((f: any) => f.workflow === 'a' || f.workflow === 'b').length
  assert.ok(n > 0 && n <= 6, `${n} runs of A and B`)
  await sleep(2000)
  assert.equal((await rig.rpc('state')).flows.filter((f: any) => f.workflow === 'a' || f.workflow === 'b').length, n, 'no more')
})

test('only when: tests on the event filter its runs; one live run per workspace an event came from; a chain of events stops at HOPS_MAX', async t => {
  // the file: only when: lines after the head, read back; check names what's wrong
  const head = 'runs in: here · on: pr.checks.failed\nonly when: event.pr.draft equals "false"\nonly when: event.ws.branch matches "^(feat|fix)/ · x"'
  const wf = parse(`# F\n${head}\n\n## start\nnext: e\n\n## e\nend: success\n`).workflow
  assert.deepEqual(wf.when, ['event.pr.draft equals "false"', 'event.ws.branch matches "^(feat|fix)/ · x"'])
  assert.equal(wf.on, 'pr.checks.failed')
  assert.match(toFile(wf), /^runs in: here · session: new · on: pr\.checks\.failed\nonly when: event\.pr\.draft equals "false"\nonly when: event\.ws\.branch matches "\^\(feat\|fix\)\/ · x"$/m)
  assert.deepEqual(parse(toFile(wf)).workflow.when, wf.when)
  assert.deepEqual(check(wf), [])
  const bad = (when: string[], on = 'custom.x') => check({ ...wf, on: on || undefined, when }).join('\n')
  assert.match(bad(['js: true']), /no js: or else here/)
  assert.match(bad(['else']), /no js: or else here/)
  assert.match(bad(['steps.x.answer equals "a"']), /test an event field/)
  assert.match(bad(['event.x matches "("']), /isn't a regular expression/)
  assert.match(bad(['nonsense']), /only when: nonsense\? event\.<field> contains/)
  assert.match(bad(['event.x equals "a"'], ''), /only when: tests an event: it needs on: <event>/)

  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'here' })
  const two = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'there' })
  const runsOf = async (id: string) => ((await rig.rpc('state')).flows ?? []).filter((r: any) => r.workflow === id)
  const refused = async () => (await rig.rpc('widgetEvents'))[0].refused ?? []
  const body = (cmd: string) => `\n\n## start\nnext: say\n\n## say\nrun: ${cmd}\nok: e\nfail: e\n\n## e\nend: success\n`

  // a test that doesn't hold: no run, and which one said; one that holds: a run
  await rig.rpc('flowSave', { id: 'gated', text: `# Gated\nruns in: here · on: custom.x\nonly when: event.data.ok equals "yes"\nonly when: event.data.n >= 2${body('echo {{event.data.ok}}')}` })
  let r = await rig.rpc('widgetEmit', { name: 'x', data: { ok: 'no', n: 5 }, ws: ws.id })
  assert.deepEqual(r.flows, [])
  assert.deepEqual(await refused(), ['gated: only when: event.data.ok equals "yes" doesn\'t hold'])
  r = await rig.rpc('widgetEmit', { name: 'x', data: { ok: 'yes', n: 1 }, ws: ws.id })
  assert.deepEqual(await refused(), ['gated: only when: event.data.n >= 2 doesn\'t hold'])
  r = await rig.rpc('widgetEmit', { name: 'x', data: { ok: 'yes', n: 3 }, ws: ws.id })
  assert.deepEqual(r.flows, ['gated'])
  const run = await until(async () => (x => x?.status === 'done' && x)((await runsOf('gated'))[0]), 'its run done')
  assert.equal((await rig.rpc('flowGet', { id: run.id })).vars['steps.say.output'], 'yes')
  assert.equal(run.evWs, ws.id)

  // runs in: worktree: one live run (or queued) per workspace an event came from
  await rig.rpc('flowSave', { id: 'wt', text: `# Wt\nruns in: worktree · at once: 1 · when done: keep · on: custom.w${body('sleep 4')}` })
  r = await rig.rpc('widgetEmit', { name: 'w', ws: ws.id })
  assert.deepEqual(r.flows, ['wt'])
  const first = await until(async () => (x => x?.ws && x)((await runsOf('wt'))[0]), 'its worktree')
  assert.notEqual(first.ws, ws.id)
  r = await rig.rpc('widgetEmit', { name: 'w', ws: ws.id })
  assert.deepEqual(r.flows, [])
  assert.deepEqual(await refused(), ['wt: a run of it is live for here'])
  r = await rig.rpc('widgetEmit', { name: 'w', ws: two.id }) // another workspace: queued behind it (at once: 1)
  assert.deepEqual(r.flows, ['wt'])
  await until(async () => (await runsOf('wt')).some((x: any) => x.status === 'queued' && x.evWs === two.id), 'queued')
  r = await rig.rpc('widgetEmit', { name: 'w', ws: two.id })
  assert.deepEqual(await refused(), ['wt: a run of it is live for there'])
  await until(async () => (await runsOf('wt')).every((x: any) => x.status === 'done'), 'both done', 20000)
  assert.equal((await runsOf('wt')).length, 2)
  await rig.rpc('flowRm', { id: 'wt' })

  // a chain: A's flow.ended starts B, B's starts A, each one hop more, until HOPS_MAX
  for (const id of ['ping', 'pong']) await rig.rpc('flowSave', { id, text: `# ${id}\nruns in: main · on: flow.ended${body('true')}` })
  await rig.rpc('flowStart', { workflow: 'ping', project: p.id, task: 'go' })
  await until(async () => (await rig.rpc('widgetEvents')).some((e: any) => e.refused?.some((x: string) => /4 hops: a loop of events\? dropped/.test(x))), 'dropped past HOPS_MAX', 20000)
  await sleep(1500)
  const chain = [...(await runsOf('ping')), ...(await runsOf('pong'))].sort((a: any, b: any) => a.started - b.started)
  assert.deepEqual(chain.map((x: any) => [x.workflow, x.hops ?? 0]), [['ping', 0], ['pong', 1], ['ping', 2], ['pong', 3]])
  for (const id of ['ping', 'pong']) await rig.rpc('flowRm', { id })

  // a repo's untrusted workflow: refused for trust, its tests not run
  const file = join(rig.repo, '.laki/workflows/repo.md')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `# Repo\nruns in: here · on: custom.y\nonly when: event.data.ok equals "yes"${body('true')}`)
  await rig.rpc('widgetEmit', { name: 'y', data: { ok: 'no' }, ws: ws.id })
  assert.deepEqual(await refused(), ['repo: from the repo, not allowed as it is: open it in Workflows, then Allow or Save it'])
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
  await assert.rejects(rig.rpc('flowStart', { workflow: 'onnew', source: 'project', project: p.id, trigger: 'schedule x' }), /isn't allowed as it is yet/)
  await assert.rejects(rig.rpc('flowStart', { workflow: 'onnew', source: 'project', project: p.id, by: 'agent' }), /isn't allowed as it is yet/)
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

test("a repo's workflow that an event or its schedule didn't start says so once per file version, and counts what it skipped", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('settingsSet', { workflows: true })
  // as git brings it (before any event reads the list)
  const file = join(rig.repo, '.laki/workflows/x.md')
  mkdirSync(dirname(file), { recursive: true })
  const text = '# X\nruns in: here · on: custom.x\n\n## start\nnext: say\n\n## say\nrun: echo hi\nok: e\nfail: e\n\n## e\nend: success\n'
  writeFileSync(file, text)
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'here' })
  const c = await rig.connect()
  t.after(() => c.close())
  const item = () => rig.rpc('flowList', { project: p.id }).then((l: any[]) => l.find(w => w.id === 'x'))
  const told = () => c.events.filter(e => e.ev === 'flow' && e.kind === 'refused')
  const runs = async () => ((await rig.rpc('state')).flows ?? []).filter((r: any) => r.workflow === 'x').length
  await rig.rpc('widgetEmit', { name: 'x', ws: ws.id })
  await rig.rpc('widgetEmit', { name: 'x', ws: ws.id })
  await until(() => told().length === 1, 'told')
  assert.deepEqual(told().map(e => [e.name, e.wf, e.on, e.changed, e.id]), [['X', { id: 'x', source: 'project', project: p.id }, 'custom.x', false, undefined]])
  assert.equal((await item()).skipped, 2)
  // its schedule: refused (the schedule's failed run says why), one more skipped, not told again
  await assert.rejects(rig.rpc('flowStart', { workflow: 'x', source: 'project', project: p.id, trigger: 'schedule x' }), /isn't allowed as it is yet/)
  assert.equal((await item()).skipped, 3)
  await sleep(300)
  assert.equal(told().length, 1)
  // allowed: the count goes, the next event starts it
  await rig.rpc('flowTrust', { id: 'x', project: p.id, text })
  assert.equal((await item()).skipped, undefined)
  await rig.rpc('widgetEmit', { name: 'x', ws: ws.id })
  await until(async () => (await runs()) === 1, 'started')
  await until(async () => ((await rig.rpc('state')).flows ?? []).every((r: any) => r.status === 'done'), 'done')
  // changed in the repo: told again, as changed
  writeFileSync(file, text.replace('echo hi', 'echo changed'))
  await rig.rpc('widgetEmit', { name: 'x', ws: ws.id })
  await until(() => told().length === 2, 'told again')
  assert.equal(told()[1].changed, true)
  // an agent's event counts like any other (trust first)
  const ag = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await rig.rpc('widgetEmit', { name: 'x', ws: ws.id, from: { tab: ag.id } })
  assert.equal((await item()).skipped, 2)
  // trusted, an agent's event refused for its run block: not a skip, nothing told
  await rig.rpc('flowTrust', { id: 'x', project: p.id, text: readFileSync(file, 'utf8') })
  await rig.rpc('widgetEmit', { name: 'x', ws: ws.id, from: { tab: ag.id } })
  assert.match((await rig.rpc('widgetEvents'))[0].refused[0], /an agent sent the event/)
  await sleep(300)
  assert.equal(told().length, 2)
  assert.equal((await item()).skipped, undefined)
  assert.equal(await runs(), 1)
})

test('try it with an event: the last one heard, else a sample; its variables and only when: said; a try starts as the event would; the last 5 events keep why; an untrusted repo workflow runs only from the app', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const body = '\n\n## start\ninput: task\nnext: say\n\n## say\nrun: echo got {{event.data.y}} in {{event.ws.name}}\nok: e\nfail: e\n\n## e\nend: success\n'
  await rig.rpc('flowSave', { id: 'ship', text: `# Ship\nruns in: here · on: custom.ship\nonly when: event.data.y equals "go"${body}` })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'here' })

  // before any: a sample, in the workspace picked (none: it can't start, it says so)
  let tr = await rig.rpc('flowEvent', { id: 'ship', project: p.id })
  assert.equal(tr.from, 'sample')
  assert.equal(tr.last, undefined)
  assert.equal(tr.vars['event.data.text'], 'hello')
  assert.deepEqual(tr.when, [{ test: 'event.data.y equals "go"', ok: false }])
  assert.equal(tr.start, false)
  assert.match(tr.why, /no workspace, so no project: pick one/)
  tr = await rig.rpc('flowEvent', { id: 'ship', project: p.id, ws: ws.id, payload: { data: { y: 'stay' } } })
  assert.deepEqual([tr.from, tr.vars['event.ws.name'], tr.start, tr.why], ['given', 'here', false, 'only when: event.data.y equals "go" doesn\'t hold'])
  await assert.rejects(rig.rpc('flowEvent', { id: 'ship', project: p.id, ws: ws.id, payload: { data: { y: 'stay' } }, go: true }), /only when: event.data.y equals "go" doesn't hold/)
  assert.deepEqual((await rig.rpc('state')).flows ?? [], [], 'a try that fails starts nothing')

  // a real one: refused by only when, kept in its last events with why; then flowEvent gives that payload
  const r = await rig.rpc('widgetEmit', { name: 'ship', data: { y: 'later' }, ws: ws.id })
  assert.deepEqual(r.flows, [])
  const item = async (id = 'ship') => (await rig.rpc('flowList', {})).find((w: any) => w.id === id)
  assert.deepEqual((await item()).events.map((e: any) => [e.event, e.ws, e.why]), [['custom.ship', ws.id, 'only when: event.data.y equals "go" doesn\'t hold']])
  tr = await rig.rpc('flowEvent', { id: 'ship', project: p.id })
  assert.deepEqual([tr.from, tr.vars['event.data.y'], tr.last.ws, tr.start], ['last', 'later', 'here', false])
  assert.equal((await rig.rpc('flowEvent', { id: 'ship', project: p.id, use: 'sample' })).from, 'sample', 'a sample when asked')

  // a try that holds: started as the event would be, in the event's workspace, {{event.…}} filled, its trigger a try
  const go = await rig.rpc('flowEvent', { id: 'ship', project: p.id, ws: ws.id, payload: { data: { y: 'go' } }, go: true })
  assert.equal(go.start, true)
  const done = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: go.run })), 'the try done')
  assert.deepEqual([done.ws, done.task, done.trigger, done.vars['steps.say.output']], [ws.id, 'custom.ship', 'try custom.ship', 'got go in here'])
  assert.equal((await item()).events.length, 1, 'a try is no event heard')

  // a repo's workflow not allowed yet: the app's sheet (editor) runs it; the CLI's try is refused as an event is, said nowhere
  mkdirSync(join(rig.repo, '.laki', 'workflows'), { recursive: true })
  writeFileSync(join(rig.repo, '.laki', 'workflows', 'repo.md'), `# Repo\nruns in: here · on: custom.repo${body}`)
  const c = await rig.connect()
  t.after(() => c.close())
  assert.equal((await item('repo')).untrusted, true)
  await assert.rejects(rig.rpc('flowEvent', { id: 'repo', source: 'project', project: p.id, ws: ws.id, payload: { data: { y: 'cli' } }, go: true }), /from the repo, not allowed as it is/)
  const cli = await rig.cli('flow', 'run', 'repo', p.name, '--event', '--ws', ws.id)
  assert.equal(cli.code, 1)
  assert.match(cli.err, /from the repo, not allowed as it is/)
  const app = await rig.rpc('flowEvent', { id: 'repo', source: 'project', project: p.id, ws: ws.id, payload: { data: { y: 'app' } }, go: true, editor: true })
  const ran = await until(async () => (x => x.status === 'done' && x)(await rig.rpc('flowGet', { id: app.run })), 'the app’s try done')
  assert.equal(ran.vars['steps.say.output'], 'got app in here')
  await sleep(300)
  assert.ok(!c.events.some(e => e.ev === 'flow' && e.kind === 'refused'), 'a try is never a skip')
  assert.equal((await item('repo')).skipped, undefined)
  // the CLI's --dry: the variables and the tests
  const dry = await rig.cli('flow', 'run', 'ship', p.name, '--event', 'custom.ship', '--ws', ws.id, '--dry')
  assert.equal(dry.code, 0, dry.err)
  assert.match(dry.out, /^custom\.ship \(the last one heard\)$/m)
  assert.match(dry.out, /^✗ only when: event\.data\.y equals "go"$/m)
  assert.match(dry.out, /^it doesn't start: only when/m)
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
