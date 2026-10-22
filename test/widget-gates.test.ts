// Gates: an extension's action can hold a ship, a merge or an archive ({ "ok": false, "why", "fix" }); an error or no
// answer goes ahead (logged), but holds Merge when green; force is yours only; gate.held; a workflow's error way
import { strict as assert } from 'node:assert'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fresh, sleep, until } from './helpers.ts'

const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}
const on = async (rig: any, ...ids: string[]) => {
  await rig.rpc('widgetReload')
  for (const id of ids) await rig.rpc('widgetSet', { id, on: true })
}
// a gate that says what $HOME/<id>.say holds ({"ok": true} unless there's one), keeping what it got
const gate = (rig: any, id: string, steps: string[], extra: object = {}) =>
  make(rig, id, { name: id, icon: '🚦', actions: { check: { run: `cat > "${rig.env.HOME}/${id}.in"; echo "$LAKI_GATE $LAKI_WORKSPACE" >> "${rig.env.HOME}/${id}.ran"; cat "${rig.env.HOME}/${id}.say" 2>/dev/null || echo '{"ok": true}'`, gate: steps } }, ...extra })
const say = (rig: any, id: string, v: object | string) => writeFileSync(join(rig.env.HOME, `${id}.say`), typeof v === 'string' ? v : JSON.stringify(v))
const ranOf = (rig: any, id: string) => (f => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : []))(join(rig.env.HOME, `${id}.ran`))

async function shipRig(t: any, env: Record<string, string> = {}) {
  const rig = await fresh(t, { env: { LAKI_GATE_MS: '1500', ...env } })
  const remote = join(rig.home, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', remote], { env: rig.env })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: rig.repo, env: rig.env })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  return { rig, remote, p }
}
const pushed = (remote: string, branch: string) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', branch], { cwd: remote, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('gates: a no holds a ship (nothing pushed), says why, gate.held; ok lets it through; the CLI exits 1; force is yours only', async t => {
  const { rig, remote, p } = await shipRig(t)
  gate(rig, 'g', ['ship'])
  make(rig, 'seen', { name: 'seen', on: { 'gate.held': 'keep' }, actions: { keep: `cat > "${rig.env.HOME}/held.json"` } })
  await on(rig, 'g', 'seen')
  await rig.rpc('widgetSet', { id: 'g', log: true })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'feature.txt'), 'done\n')

  // no: held, nothing pushed, its why and fix; what it got on stdin
  say(rig, 'g', { ok: false, why: 'the tests fail', fix: 'Make the tests pass' })
  const r = await rig.rpc('ship', { ws: ws.id, message: 'Add it' })
  assert.deepEqual(r, { held: [{ widget: 'g', name: 'g', gate: 'ship', why: 'the tests fail', fix: 'Make the tests pass', icon: '🚦' }] })
  assert.equal((await rig.rpc('state')).tabs.filter((x: any) => x.workspace === ws.id).length, 0, 'no ship tab')
  assert.ok(!pushed(remote, ws.branch))
  const got = JSON.parse(readFileSync(join(rig.env.HOME, 'g.in'), 'utf8'))
  assert.deepEqual([got.gate, got.ws.id, got.ws.branch, got.pr, got.by], ['ship', ws.id, ws.branch, null, 'you'])
  assert.deepEqual(ranOf(rig, 'g'), [`ship ${ws.id}`])
  const held = await until(() => (f => existsSync(f) && JSON.parse(readFileSync(f, 'utf8')))(join(rig.env.HOME, 'held.json')), 'gate.held')
  assert.deepEqual([held.gate, held.widget, held.why, held.ws.id], ['ship', 'g', 'the tests fail', ws.id])
  await sleep(600)
  assert.ok((await rig.rpc('widgetLogs', { id: 'g' })).lines.some((l: any) => l.level === 'warn' && /gate check \(ship, by you\): held: the tests fail/.test(l.text)))
  const v = (await rig.rpc('state')).widgets.find((x: any) => x.id === 'g')
  assert.deepEqual(v.gates, ['ship'])
  assert.match((await rig.rpc('widgetWhat', { id: 'g' })).text, /It can hold a workspace's ship: its gate runs before each\./)

  // the CLI: the reasons, exit 1
  const c = await rig.cli('ship', ws.id, '-m', 'Add it')
  assert.equal(c.code, 1)
  assert.match(c.out, /^Not shipped:\n {2}g: the tests fail\n {4}fix: Make the tests pass/)

  // an agent's force: refused (the daemon's agentCaller), in the CLI too; yours goes
  const ag = await rig.rpc('tabNew', { ws: ws.id, preset: 'claude' })
  await assert.rejects(rig.rpc('ship', { ws: ws.id, message: 'x', force: true, from: { ws: ws.id, tab: ag.id } }), /an agent never overrides a gate/)
  const ca = await new Promise<{ code: number; err: string }>(done => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const c = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'src/cli/main.ts'), 'ship', ws.id, '-m', 'x', '--force'], { env: { ...rig.env, LAKI_WORKSPACE: ws.id, LAKI_TAB: ag.id } })
    let err = ''
    c.stderr.on('data', d => (err += d))
    c.on('exit', code => done({ code: code ?? 1, err }))
  })
  assert.notEqual(ca.code, 0)
  assert.match(ca.err, /an agent never overrides a gate/)
  // an agent's ship without force: its gates run, by agent
  await rig.rpc('ship', { ws: ws.id, message: 'x', from: { ws: ws.id, tab: ag.id } })
  assert.equal(JSON.parse(readFileSync(join(rig.env.HOME, 'g.in'), 'utf8')).by, 'agent')

  // ok: through
  say(rig, 'g', { ok: true })
  const tab = await rig.rpc('ship', { ws: ws.id, message: 'Add it' })
  assert.equal(tab.name, 'ship')
  await until(() => pushed(remote, ws.branch), 'pushed', 15000)

  // yours with force: no gate runs
  const n = ranOf(rig, 'g').length
  say(rig, 'g', { ok: false, why: 'no' })
  writeFileSync(join(ws.path, 'more.txt'), 'more\n')
  const f = await rig.rpc('ship', { ws: ws.id, message: 'More', force: true })
  assert.equal(f.name, 'ship')
  assert.equal(ranOf(rig, 'g').length, n)
})

test('gates: an error or no answer goes ahead for a step you start (logged, a toast); a per-workspace one in its own; off: none; an agent action as a gate refused by the checker', async t => {
  const { rig, p } = await shipRig(t)
  make(rig, 'err', { name: 'Err', actions: { check: { run: 'echo broken >&2; exit 3', gate: ['archive'] } } })
  make(rig, 'slow', { name: 'Slow', actions: { check: { run: 'sleep 5; echo \'{"ok": false, "why": "late"}\'', gate: ['archive'] } } })
  make(rig, 'junk', { name: 'Junk', actions: { check: { run: 'echo not json', gate: ['archive'] } } })
  gate(rig, 'mine', ['archive'], { scope: 'workspace' })
  gate(rig, 'off', ['archive'])
  await on(rig, 'err', 'slow', 'junk', 'mine')
  await rig.rpc('settingsSet', { widgetLogs: true })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'a' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'b' })

  const t0 = Date.now()
  assert.equal(await rig.rpc('wsArchive', { id: a.id }), null, 'archived')
  assert.ok(Date.now() - t0 < 4500, 'a gate past its time is not waited for')
  assert.equal((await rig.rpc('state')).workspaces.find((x: any) => x.id === a.id).archived, true)
  await sleep(600)
  for (const [id, why] of [['err', /gate check \(archive\) failed: broken: went ahead/], ['slow', /gate check \(archive\) failed: timed out after 1\.5 s: went ahead/], ['junk', /gate check \(archive\) failed: printed no \{"ok": …\}: not json: went ahead/]] as const)
    assert.ok((await rig.rpc('widgetLogs', { id, level: 'error' })).lines.some((l: any) => why.test(l.text)), `${id}: ${why}`)
  await until(() => app.events.some(e => e.ev === 'widget-say' && e.widget === 'err' && /Err's gate failed: broken\. Went ahead/.test(e.toast)), 'a toast')
  // per workspace: in the workspace it gates, with that workspace's env; one that's off: never
  assert.deepEqual(ranOf(rig, 'mine'), [`archive ${a.id}`])
  await rig.rpc('wsArchive', { id: b.id })
  assert.deepEqual(ranOf(rig, 'mine'), [`archive ${a.id}`, `archive ${b.id}`])
  assert.deepEqual(ranOf(rig, 'off'), [])

  // the checker: a gate on an agent's action, an unknown step
  make(rig, 'ai', { name: 'AI', actions: { look: { ai: 'Is it ready?', gate: ['ship'] }, go: { run: 'true', gate: ['shp'] } } })
  await rig.rpc('widgetReload')
  const ps = (await rig.rpc('widgetCheck', { id: 'ai', run: false })).problems.filter((x: any) => x.level === 'error')
  assert.deepEqual(ps.map((x: any) => [x.where, x.text]), [
    ['widget.json actions.look.gate', "an agent's action can't be a gate: each run costs, and it's slow (a command action)"],
    ['widget.json actions.go.gate', '"shp": one of ship, merge, archive (did you mean ship?)'],
  ])
})

test('gates: a no that exits 1 is a no: it holds a ship, a merge and an archive, and laki archive prints why and exits 1', async t => {
  const { rig, remote, p } = await shipRig(t, { LAKI_PR_SCAN_MS: '3600000' })
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  make(rig, 'no1', { name: 'No1', actions: { check: { run: `echo '{"ok": false, "why": "x", "fix": "do y"}'; exit 1`, gate: ['ship', 'merge', 'archive'] } } })
  await on(rig, 'no1')
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  writeFileSync(join(ws.path, 'feature.txt'), 'done\n')
  const no = [{ widget: 'no1', name: 'No1', gate: 'ship', why: 'x', fix: 'do y' }]
  assert.deepEqual(await rig.rpc('ship', { ws: ws.id, message: 'Add it' }), { held: no })
  assert.ok(!pushed(remote, ws.branch), 'not shipped')
  // merge: a PR on its branch
  writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 5, state: 'OPEN', url: 'https://github.com/o/r/pull/5', headRefOid: 'h1', statusCheckRollup: [], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }))
  await rig.rpc('prRefresh')
  await until(async () => (await rig.rpc('state')).workspaces.find((x: any) => x.id === ws.id).pr, 'its PR')
  assert.deepEqual(await rig.rpc('prAct', { ws: ws.id, act: 'merge' }), { held: [{ ...no[0], gate: 'merge' }] })
  assert.ok(!readFileSync(rig.env.FAKE_LOG, 'utf8').includes('gh pr merge'), 'not merged')
  assert.deepEqual(await rig.rpc('wsArchive', { id: ws.id }), { held: [{ ...no[0], gate: 'archive' }] })
  const c = await rig.cli('archive', ws.id)
  assert.equal(c.code, 1)
  assert.match(c.out, /^Not archived:\n {2}No1: x\n {4}fix: do y\nlaki archive --force does it anyway/)
  assert.equal((await rig.rpc('state')).workspaces.find((x: any) => x.id === ws.id).archived, undefined, 'not archived')
  // exit 1 and no {"ok": …}: a failed gate, which goes ahead for you (with a toast), as before
  make(rig, 'no1', { name: 'No1', actions: { check: { run: 'echo broken >&2; exit 1', gate: ['archive'] } } })
  await rig.rpc('widgetReload')
  assert.equal(await rig.rpc('wsArchive', { id: ws.id }), null, 'archived')
})

test('gates: Merge when green held once per head, its error a hold too; again after a push or a change to the gate; a workflow takes its error way', async t => {
  const rig = await fresh(t, { env: { LAKI_PR_SCAN_MS: '3600000', LAKI_GATE_MS: '1500' } })
  const gh = rig.env.FAKE_GH
  mkdirSync(gh)
  await rig.rpc('settingsSet', { devMode: true, workflows: true })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  await rig.rpc('projectSet', { id: p.id, config: { pr: { land: true } } })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const url = 'https://github.com/o/r/pull/5'
  const check = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }
  const pr = (head: string) => writeFileSync(join(gh, 'pr.json'), JSON.stringify({ number: 5, state: 'OPEN', url, headRefOid: head, statusCheckRollup: [check], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }))
  const merges = () => readFileSync(rig.env.FAKE_LOG, 'utf8').split('\n').filter(l => l.startsWith('gh pr merge')).length
  const logged = async (re: RegExp) => (await rig.rpc('logs', { key: `ws:${ws.id}` })).some((l: any) => re.test(l.text))
  gate(rig, 'g', ['merge'])
  await on(rig, 'g')
  say(rig, 'g', { ok: false, why: 'not on Fridays' })
  pr('h1aaaaaaaa')
  await rig.rpc('prRefresh')
  await rig.rpc('wsSet', { id: ws.id, autoLand: true })
  await rig.rpc('prRefresh')
  await until(() => logged(/^over to you: Merge when green held: g: not on Fridays/), 'over to you')
  assert.equal(JSON.parse(readFileSync(join(rig.env.HOME, 'g.in'), 'utf8')).by, 'auto')
  assert.equal(JSON.parse(readFileSync(join(rig.env.HOME, 'g.in'), 'utf8')).pr.number, 5)
  await rig.rpc('prRefresh')
  assert.ok(await logged(/^merge when green: not yet, tried h1aaaaa already$/), 'once per head')
  assert.equal(ranOf(rig, 'g').length, 1)
  assert.equal(merges(), 0)

  // its error: held too, nobody's watching
  say(rig, 'g', 'nonsense')
  pr('h2bbbbbbbb')
  await rig.rpc('prRefresh')
  await until(() => logged(/^over to you: Merge when green held: g: its gate failed: printed no/), 'an error holds it')
  assert.equal(merges(), 0)

  // the gate changed (its widget.json): tried again on the same head, and it merges
  say(rig, 'g', { ok: true })
  gate(rig, 'g', ['merge'], { description: 'changed' })
  await rig.rpc('widgetReload')
  await rig.rpc('prRefresh')
  await until(() => merges() === 1, 'merged')

  // a workflow's archive: held, its error way, the reasons as its output
  gate(rig, 'ga', ['archive'])
  await on(rig, 'ga')
  say(rig, 'ga', { ok: false, why: 'frozen' })
  await rig.rpc('flowSave', { id: 'a', text: '# A\nruns in: worktree\n\n## start\ninput: task\nnext: go\n\n## go\naction: archive\nask first: no\nok: e\nerror: bad\n\n## e\nend: success\n\n## bad\nend: failed\n' })
  const run = await rig.rpc('flowStart', { workflow: 'a', project: p.id, task: 'x' })
  const r = await until(async () => (x => x.status !== 'running' && x.status !== 'queued' && x)(await rig.rpc('flowGet', { id: run.id })), 'the run ended', 20000)
  assert.equal(r.status, 'failed', JSON.stringify(r.log.slice(-4)))
  assert.equal(r.vars['steps.go.output'], 'ga: frozen')
  assert.equal(JSON.parse(readFileSync(join(rig.env.HOME, 'ga.in'), 'utf8')).by, 'workflow')
  assert.equal((await rig.rpc('state')).workspaces.find((x: any) => x.id === r.ws).archived, undefined, 'not archived')
  assert.match(r.decisions.find((d: any) => d.block === 'go').why, /held by g/)
})

// #2: a gate that fails (past LAKI_GATE_MS here) let an agent's ship or a workflow's archive through; only yours goes
// ahead now, with the toast. A repo gate whose files changed fails the same way (off until you look): it holds an agent's
test("gates: one that fails holds an agent's ship and a workflow's archive; yours goes ahead with a toast; a repo gate changed on disk holds an agent's", async t => {
  const { rig, remote, p } = await shipRig(t)
  make(rig, 'slow', { name: 'Slow', actions: { check: { run: 'sleep 5; echo \'{"ok": true}\'', gate: ['ship', 'archive'] } } })
  await on(rig, 'slow')
  await rig.rpc('settingsSet', { widgetLogs: true, workflows: true })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude', name: 'a' })
  const tab = (await until(async () => (await rig.rpc('state')).tabs.find((x: any) => x.workspace === ws.id), 'its agent')).id
  await until(async () => (await rig.rpc('screen', { target: `${ws.id}/${tab}` })).includes('> '), 'its prompt')
  const laki = [process.execPath, '--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))].join(' ')
  const out = join(rig.home, 'agent-out')
  const agentShip = async () => {
    writeFileSync(out, '')
    await rig.rpc('send', { target: `${ws.id}/${tab}`, text: `run ${laki} ship ${ws.id} -m mine > ${out} 2>&1; echo "exit $?" >> ${out}` })
    return until(() => (s => /exit \d+/.test(s) && s)(readFileSync(out, 'utf8')), 'the agent shipped', 30000) as Promise<string>
  }
  const said = await agentShip()
  assert.match(said, /Not shipped:\n {2}Slow: its gate failed: timed out after 1\.5 s/)
  assert.match(said, /exit 1/)
  assert.ok(!pushed(remote, ws.branch), 'nothing pushed')
  assert.ok((await rig.rpc('widgetLogs', { id: 'slow', level: 'error' })).lines.some((l: any) => /gate check \(ship, by agent\) failed: timed out after 1\.5 s: held/.test(l.text)))

  // yours: goes ahead, said
  const tabOf = await rig.rpc('ship', { ws: ws.id, message: 'yours' })
  assert.ok(tabOf.id, JSON.stringify(tabOf))
  await until(() => app.events.some(e => e.ev === 'widget-say' && e.widget === 'slow' && /Slow's gate failed: timed out after 1\.5 s\. Went ahead/.test(e.toast)), 'a toast')
  await until(() => pushed(remote, ws.branch), 'pushed', 20000)

  // a workflow's archive: held, its error way
  await rig.rpc('flowSave', { id: 'a', text: '# A\nruns in: worktree\n\n## start\ninput: task\nnext: go\n\n## go\naction: archive\nask first: no\nok: e\nerror: bad\n\n## e\nend: success\n\n## bad\nend: failed\n' })
  const run = await rig.rpc('flowStart', { workflow: 'a', project: p.id, task: 'x' })
  const r = await until(async () => (x => x.status !== 'running' && x.status !== 'queued' && x)(await rig.rpc('flowGet', { id: run.id })), 'the run ended', 20000)
  assert.equal(r.status, 'failed', JSON.stringify(r.log.slice(-4)))
  assert.equal(r.vars['steps.go.output'], 'Slow: its gate failed: timed out after 1.5 s')
  assert.equal((await rig.rpc('state')).workspaces.find((x: any) => x.id === r.ws).archived, undefined, 'not archived')

  // a repo's gate, looked at and on, then changed on disk: it fails as changed, and an agent's ship is held
  await rig.rpc('widgetSet', { id: 'slow', on: false })
  const d = join(rig.repo, '.laki', 'extensions', 'rg')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Repo gate', actions: { check: { run: 'echo \'{"ok": true}\'', gate: ['ship'] } } }))
  await rig.rpc('widgetReload')
  const id = `${p.id}.rg`
  await rig.rpc('widgetSet', { id, on: true, seen: (await rig.rpc('widgetWhat', { id })).hash })
  writeFileSync(join(d, 'check.sh'), 'echo pwned\n')
  assert.match(await agentShip(), /Not shipped:\n {2}Repo gate: its gate failed: Repo gate changed .*off until you look/)
})
