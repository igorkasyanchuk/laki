import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { connect, fresh, running, seen, until } from './helpers.ts'

test("B3: Uninstall Laki: the laki command and this Laki's skills removed, another Laki's kept; the daemon and the data last", async t => {
  const spots = mkdtempSync('/tmp/laki-cli-')
  t.after(() => rmSync(spots, { recursive: true, force: true }))
  const rig = await fresh(t, { env: { LAKI_CLI_DIRS: `${spots}/bin` } })
  const cli = (await rig.rpc('cliInstall')).path
  await rig.rpc('skillSet', { agent: 'claude', on: true })
  await rig.rpc('skillSet', { agent: 'codex', on: true, skill: 'laki-widget' })
  // gemini's skill drives another data folder's daemon (a dev build's): kept
  const theirs = join(rig.home, '.gemini/skills/laki')
  await rig.rpc('skillSet', { agent: 'gemini', on: true })
  writeFileSync(join(theirs, 'laki'), readFileSync(join(theirs, 'laki'), 'utf8').replace(/LAKI_HOME=[^']*/, 'LAKI_HOME=/elsewhere'))

  // a look changes nothing; the data only when asked
  const look = await rig.rpc('uninstall', {})
  const by = (rows: any[], id: string) => rows.find(r => r.id === id)
  assert.deepEqual(look.rows.map((r: any) => [r.id, r.state]), [['cli', 'todo'], ['skills', 'todo'], ['daemon', 'todo'], ['worktrees', 'none'], ['data', 'kept'], ['next', 'todo']])
  assert.match(by(look.rows, 'skills').detail, /^Claude Code, Codex; Gemini: another Laki's, kept$/)
  assert.equal(by(look.rows, 'next').detail, 'Quit Laki and move it to the Trash')
  assert.equal(by((await rig.rpc('uninstall', { data: true })).rows, 'data').state, 'todo')
  // laki uninstall without --yes off a terminal: the list and how, nothing removed
  const said = await rig.cli('uninstall')
  assert.equal(said.code, 0, said.err)
  assert.match(said.out, /○ laki command +/)
  assert.match(said.out, /laki uninstall --yes removes them \(--data: your data too\)/)
  assert.ok(existsSync(cli))

  // run: the command and this Laki's skills go now; another Laki's stays; the daemon (no stop) and the data later
  const app = await connect(rig)
  t.after(() => app.close())
  const r = await rig.rpc('uninstall', { run: true })
  assert.deepEqual(r.rows.map((x: any) => [x.id, x.state]), [['cli', 'done'], ['skills', 'done'], ['daemon', 'later'], ['worktrees', 'none'], ['data', 'kept'], ['next', 'todo']])
  assert.ok(!existsSync(cli))
  assert.ok(!existsSync(join(rig.home, '.claude/skills/laki')))
  assert.ok(!existsSync(join(rig.home, '.codex/skills/laki-widget')))
  assert.ok(existsSync(join(theirs, 'SKILL.md')), "another Laki's skill: kept")
  assert.deepEqual((await rig.rpc('uninstall', {})).rows.slice(0, 2).map((x: any) => x.state), ['none', 'kept'])

  // a worktree: said, kept unless picked
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell', name: 'tree' })
  const trees = by((await rig.rpc('uninstall', {})).rows, 'worktrees')
  assert.deepEqual([trees.state, trees.detail], ['kept', '1 worktree Laki made: their uncommitted changes go too'])
  assert.match(by((await rig.rpc('uninstall', { data: true })).rows, 'data').detail, /data\/worktrees stays/)
  // with stop and data: the app is told (it quits), the daemon stops and its data folder goes, but its worktrees/
  const pid = rig.info().pid
  await rig.rpc('uninstall', { run: true, stop: true, data: true })
  await seen(app, (e: any) => e.ev === 'uninstalled', 'the app told')
  await until(() => !running(pid), 'the daemon stops')
  await until(() => !existsSync(join(rig.home, 'data/state.json')), 'the data folder goes')
  assert.deepEqual(readdirSync(join(rig.home, 'data')), ['worktrees'], 'all but the worktrees')
  assert.ok(existsSync(ws.path), 'the worktree stays')
  assert.ok(existsSync(join(rig.home, 'repo')), 'repos stay')
})

test('B3: an agent may not uninstall Laki', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'one' })
  const tab = (await until(() => rig.tab(ws.id))).id
  await assert.rejects(rig.rpc('uninstall', { run: true, from: { ws: ws.id, tab } }), /an agent can't uninstall Laki/)
})
