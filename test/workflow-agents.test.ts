// Workflows' agent blocks: timeouts and nudges, sessions, permission prompts and modes, a restart mid block.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { check, FLOW_ENDED, parse, toFile } from '../src/shared/workflow.ts'
import { fresh, sleep, until } from './helpers.ts'
import { AGENT } from './flows.ts'

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

  // a block and the head with no mode: its profile's (and its fast mode); a profile that never asks, by its mode or its
  // flags, is the user's to start too
  const profiled = (name: string) => MODES.replace(' · perm: acceptEdits', '').replace('agent: claude\n> build', `agent: ${name}\n> build`)
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'quick', agent: 'claude', perm: 'plan', fast: true }, { name: 'yolo', agent: 'claude', perm: 'bypassPermissions' }, { name: 'skip', agent: 'claude', args: '--dangerously-skip-permissions', perm: 'plan' }] })
  for (const name of ['yolo', 'skip']) {
    await rig.rpc('flowSave', { id: name, text: profiled(name) })
    await assert.rejects(rig.rpc('flowStart', { workflow: name, project: p.id, task: 'x', by: 'agent' }), /never asks \(bypass permissions: build\): start it yourself/, name)
  }
  await rig.rpc('flowSave', { id: 'quick', text: profiled('quick') })
  const q = await rig.rpc('flowStart', { workflow: 'quick', project: p.id, task: 'x' })
  const qr = await until(async () => {
    const x = await rig.rpc('flowGet', { id: q.id })
    return x.status === 'done' && x
  }, 'done', 20000)
  const args: string[] = rig.fakeLog().find(l => l.bin === 'claude' && l.tab === qr.tabs.build).args
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan')
  assert.match(args[args.indexOf('--settings') + 1], /claude-settings-fast\.json$/)
  assert.ok(qr.log.some((l: string) => /build: a new quick tab, .* \(plan mode · fast\)/.test(l)), qr.log.join('\n'))
})

// the paths a user hits first: a restart mid turn, a usage limit, real PR checks, an agent's tab closed
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
