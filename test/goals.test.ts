// A1b: a goal Laki runs for an agent with no /goal of its own (verify.ts goalSet, goalEnd): the project's script after each
// turn, its failure sent back, until it passes, maxTurns or the same failure 3 times; yours pauses it; an agent can't set one
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

type Rig = Awaited<ReturnType<typeof fresh>>
const goal = async (rig: Rig, tab: string) => ((await rig.rpc('state')).tabs as any[]).find(t => t.id === tab)?.goal

test('A1b: an agy (gemini) goal reached as its test passes on the third run (three turns); maxTurns 2 fails; yours pauses it; refused for claude and for an agent', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  // passes on its third run (a count in the worktree); its output differs each run
  await rig.rpc('projectSet', { id: p.id, config: { test: 'n=$(cat .goal-n 2>/dev/null || echo 0); n=$((n+1)); echo $n > .goal-n; echo "run $n"; [ "$n" -ge 3 ]', lint: 'echo "lint $(date +%N)"; exit 1' } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'gemini', name: 'g' })
  const tab = (await until(() => rig.tab(ws.id), 'its agy tab')).id
  await until(async () => /fake agy[^]*> $/.test((await rig.rpc('screen', { target: tab, lines: 10 })).trimEnd() + ' '), 'agy at its prompt') // reading its box: a prompt typed sooner is lost
  await assert.rejects(rig.rpc('goalSet', { tab, text: 'x', check: 'deploy' }), /met when which script passes\? format, lint, test/)
  await assert.rejects(rig.rpc('goalSet', { tab, text: 'x', check: 'format' }), /the project has no format script/)
  await assert.rejects(rig.rpc('goalSet', { tab, text: 'x', check: 'test', from: { ws: ws.id, tab } }), /an agent can't set or raise an agent's goal/)
  const set = await rig.rpc('goalSet', { tab, text: 'make the tests pass', check: 'test' })
  assert.deepEqual([set.own, set.state, set.turns, set.maxTurns, set.check], [true, 'working', 0, 12, 'test'])
  await until(async () => (await goal(rig, tab))?.state === 'reached', 'the goal reached', 30000)
  const g = await goal(rig, tab)
  assert.equal(g.turns, 3)
  assert.match(g.why, /test passes, after 3 turns/)
  assert.match(await rig.screen(tab), /answer: Goal \(Laki\): make the tests pass/) // no hooks: no last answer

  // at most 2 turns, never passing: failed with why
  await rig.rpc('goalSet', { tab, text: 'lint clean', check: 'lint', maxTurns: 2 })
  await until(async () => ['failed', 'paused'].includes((await goal(rig, tab))?.state), 'the goal over', 30000)
  const f = await goal(rig, tab)
  assert.deepEqual([f.state, f.turns], ['failed', 2], f.why)
  await assert.rejects(rig.rpc('goalSet', { tab, resume: true }), /its goal stopped: set it again/) // only a paused or blocked one resumes
  assert.match(f.why, /lint still fails after 2 turns, its most/)

  // a prompt of yours pauses it; Resume sends it again; Clear: none
  await rig.rpc('goalSet', { tab, text: 'lint clean again', check: 'lint', maxTurns: 50 })
  await rig.rpc('send', { target: tab, text: 'what are you doing?', whenIdle: true })
  await until(async () => (await goal(rig, tab))?.state === 'paused', 'paused by your prompt', 30000)
  assert.equal((await goal(rig, tab)).why, 'you sent it a prompt')
  await rig.rpc('goalClear', { tab })
  assert.equal(await goal(rig, tab), undefined)

  // claude has its own /goal
  const cw = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'c' })
  const ct = (await until(() => rig.tab(cw.id))).id
  await assert.rejects(rig.rpc('goalSet', { tab: ct, text: 'x', check: 'test' }), /claude has a \/goal of its own/)
})
