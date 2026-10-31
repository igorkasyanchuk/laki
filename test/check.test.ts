// Done means checked (daemon/verify.ts): a project's scripts run as an agent's turn ends having changed files; a failure
// goes back to the agent, a pass with a second agent's notes; nothing changed: no check; off: none.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

test('a turn that changed files is checked: a failing test goes back to the agent, then passes; the review notes; an unchanged turn skips', async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '1500' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { test: 'test -f ok.txt', lint: 'true', check: { steps: ['test', 'lint', 'nope'], review: 'claude' } } })
  const proj = (await rig.rpc('state')).projects.find((x: { id: string }) => x.id === p.id)
  assert.deepEqual(proj.config.check, { steps: ['lint', 'test'], review: 'claude' }) // its order, known steps only
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'run echo hi > a.txt' })
  const view = async () => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === ws.id)
  const failed = await until(async () => ((await view()).check?.status === 'failed' ? (await view()).check : undefined), 'the check fails')
  assert.deepEqual(failed.steps.map((s: { name: string; state: string }) => [s.name, s.state]), [['lint', 'pass'], ['test', 'fail']])
  assert.equal(failed.tries, 1)
  assert.equal(failed.review.state, 'wait') // only once the scripts pass
  const tab = failed.tab
  await until(async () => (await rig.rpc('screen', { target: tab, lines: 40 }).then((x: unknown) => JSON.stringify(x))).includes("Laki checked your work before telling the user it's done"), 'sent back to the agent')
  writeFileSync(join(ws.path, 'ok.txt'), 'fixed\n') // the agent's fix, during its turn
  const passed = await until(async () => ((await view()).check?.status === 'passed' ? (await view()).check : undefined), 'the check passes')
  assert.equal(passed.tries, 0)
  assert.equal(passed.review.state, 'note') // the fake reviewer never says LGTM
  assert.match(passed.review.note, /Found it/)
  // the reviewer reads a diff an agent wrote: no tools, no MCP server of the user's
  const reviewer = rig.fakeLog().find(l => l.bin === 'claude' && l.args[0] === '-p' && l.args.includes('--append-system-prompt'))
  assert.equal(reviewer.args[reviewer.args.indexOf('--tools') + 1], '')
  assert.ok(reviewer.args.includes('--strict-mcp-config') && !reviewer.args.includes('--allowedTools'))
  // a turn that changes nothing isn't checked again
  await rig.rpc('send', { target: tab, text: 'just a question' })
  await until(async () => (await rig.rpc('screen', { target: tab, lines: 40 }).then((x: unknown) => JSON.stringify(x))).includes('answer: just a question'), 'its answer')
  await new Promise(r => setTimeout(r, 1500))
  assert.equal((await view()).check.at, passed.at)
  // Check again: now, whatever changed
  await rig.rpc('checkAgain', { ws: ws.id })
  await until(async () => (await view()).check.at !== passed.at && (await view()).check.status === 'passed', 'checked again')
})

test('no check: none ticked, the setting off, or a script missing', async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '200' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { lint: 'false', check: { steps: ['lint', 'test'] } } }) // no test script: lint only
  await rig.rpc('settingsSet', { doneCheck: false })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'run echo hi > a.txt' })
  const view = async () => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === ws.id)
  const tab = await until(async () => (await rig.rpc('state')).tabs.find((x: { workspace: string; kind: string }) => x.workspace === ws.id && x.kind === 'agent')?.id, 'its tab')
  await until(async () => (await rig.rpc('screen', { target: tab, lines: 40 }).then((x: unknown) => JSON.stringify(x))).includes('answer: run echo'), 'its turn ends')
  await new Promise(r => setTimeout(r, 1000))
  assert.equal((await view()).check, undefined)
  await assert.rejects(rig.rpc('checkAgain', { ws: ws.id }), /no check for this workspace/)
  await rig.rpc('settingsSet', { doneCheck: true })
  await rig.rpc('send', { target: tab, text: 'run echo again > b.txt' })
  const c = await until(async () => ((await view()).check?.status === 'failed' ? (await view()).check : undefined), 'lint alone fails')
  assert.deepEqual(c.steps.map((s: { name: string }) => s.name), ['lint'])
})
