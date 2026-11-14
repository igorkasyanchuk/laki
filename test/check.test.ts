// Done means checked (daemon/verify.ts): a project's scripts run as an agent's turn ends having changed files; a failure
// goes back to the agent, a pass with a second agent's notes; nothing changed: no check; off: none. The Proof card: what
// Laki saw of a checked turn (each script's end and output in the storage folder's proof/, git's facts), Laki's alone.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  assert.ok(reviewer, 'the reviewer ran')
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

// the proof folders of a workspace's storage, each turn's proof.json
const proofsIn = (storage: string) => {
  try {
    return readdirSync(join(storage, 'proof')).filter(n => existsSync(join(storage, 'proof', n, 'proof.json'))).map(n => JSON.parse(readFileSync(join(storage, 'proof', n, 'proof.json'), 'utf8')))
  } catch {
    return []
  }
}

test('the Proof card: a passing and a failing script, each with its output kept (masked), and what the turn touched', async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '300' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { lint: 'echo API_TOKEN=fake-secret-value; echo linted', test: 'echo boom; exit 3', check: { steps: ['lint', 'test'] } } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'run echo hi > a.txt' })
  const storage = await until(async () => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === ws.id)?.storage, 'its storage folder')
  const proof = await until(() => proofsIn(storage).find(x => x.checks.length === 2), 'the first proof')
  assert.deepEqual(proof.checks.map((c: { name: string; ok: boolean; code: number }) => [c.name, c.ok, c.code]), [['lint', true, 0], ['test', false, 3]])
  assert.match(proof.checks[1].summary, /^exited with 3 in /)
  assert.deepEqual(proof.facts, { files: 1 }, 'a.txt: no test, CI, migration or lockfile')
  assert.equal(proof.tab, (await rig.rpc('state')).tabs.find((x: { workspace: string; kind: string }) => x.workspace === ws.id && x.kind === 'agent').id)
  const lint = readFileSync(join(storage, proof.checks[0].file), 'utf8')
  assert.match(lint, /linted/)
  assert.match(lint, /API_TOKEN=••••/)
  assert.ok(!lint.includes('fake-secret-value'), 'masked as shared tabs are')
  assert.match(readFileSync(join(storage, proof.checks[1].file), 'utf8'), /boom/)
  assert.equal(proof.checks[0].file, `proof/${proof.turn}/lint.md`)
})

test('the Proof card: a migration touched, the folder only Laki writes, gone with the workspace', async t => {
  const rig = await fresh(t, { env: { FAKE_TURN_MS: '300' } })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { lint: 'true', check: { steps: ['lint'] } } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', prompt: 'run mkdir -p db/migrate; echo x > db/migrate/001_init.sql' })
  type Wv = { id: string; storage: string; artifacts?: number; proof?: { turn: number; checks: { ok: boolean }[]; facts: object } }
  const view = async (): Promise<Wv | undefined> => (await rig.rpc('state')).workspaces.find((w: { id: string }) => w.id === ws.id)
  const w = (await until(async () => ((v?: Wv) => (v?.proof?.checks.length ? (v as Wv & { proof: NonNullable<Wv['proof']> }) : undefined))(await view()), 'its proof in the view'))!
  assert.deepEqual(w.proof.facts, { files: 1, migrations: true })
  assert.equal(w.proof.checks[0].ok, true)
  assert.equal(w.artifacts, undefined, "the proof's files aren't the agent's artifacts")
  assert.ok(existsSync(join(w.storage, 'proof', String(w.proof.turn), 'lint.md')))
  // the app's Preview, as the proof came: its picture beside the output; not a PNG, or an older turn's: refused
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake')]).toString('base64')
  await assert.rejects(rig.rpc('proofShot', { ws: ws.id, turn: w.proof.turn, png: Buffer.from('<svg/>').toString('base64') }), /not a PNG/)
  await assert.rejects(rig.rpc('proofShot', { ws: ws.id, turn: 1, png }), /no such proof/)
  assert.deepEqual(await rig.rpc('proofShot', { ws: ws.id, turn: w.proof.turn, png }), { after: `proof/${w.proof.turn}/after.png` })
  assert.ok(existsSync(join(w.storage, 'proof', String(w.proof.turn), 'after.png')))
  // a workflow's save block, Laki's way to write the storage folder: never into proof/
  await rig.rpc('flowSave', { id: 'forge', text: '# Forge\nruns in: main\n\n## start\ninput: task\nnext: s\n\n## s\nsave: proof/1/lint.md\nfrom: a.txt\nok: e\n\n## e\nend: success\n' })
  const run = await rig.rpc('flowStart', { workflow: 'forge', project: p.id, task: 'x' })
  const r = await until(async () => (x => x.status !== 'running' && x)(await rig.rpc('flowGet', { id: run.id })), 'the run stops')
  assert.notEqual(r.status, 'done')
  assert.ok(r.log.some((l: string) => /proof\/ is Laki's own/.test(l)), r.log.join('\n'))
  const main = (await rig.rpc('state')).workspaces.find((x: { id: string }) => x.id === run.ws)
  assert.ok(!main?.storage || !existsSync(join(main.storage, 'proof', '1')), 'nothing written')
  // removed: its storage folder goes, and the proof in it
  await rig.rpc('wsRm', { id: ws.id })
  await until(() => !existsSync(w.storage), 'its storage folder goes')
})
