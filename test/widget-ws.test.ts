// Extensions per workspace (scope workspace): an instance in each workspace, its own data and env, fetched while it's on
// screen, gone with its workspace
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, sleep, until } from './helpers.ts'

const find = async (rig: any, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)

test('scope workspace: an instance per workspace with its env, fetched on screen, kept and gone with it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  const b = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'two' })
  const make = (id: string, m: object) => {
    mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
    writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
  }
  make('br', {
    name: 'Branch',
    scope: 'workspace',
    every: 5,
    fetch: 'printf \'{"b": "%s", "port": "%s", "ws": "%s"}\' "$LAKI_BRANCH" "$PORT" "$LAKI_WORKSPACE"',
    ui: { type: 'text', value: '{{b}} on {{workspace.branch}}' },
    label: '{{b}}',
    actions: { mark: 'echo "$LAKI_BRANCH $WIDGET_ARG" > "$HOME/marked"' },
  })
  make('glob', { name: 'Global', fetch: 'echo "{}"' })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'br', on: true })
  await rig.rpc('widgetSet', { id: 'glob', on: true })
  let w = await find(rig, 'br')
  assert.equal(w.scope, 'workspace')
  assert.deepEqual(w.inst, {}, 'no app: nothing on screen, nothing fetched')

  // the app shows a: its instance fetches at once, with a's env; b's doesn't
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true, ws: a.id })
  w = await until(() => find(rig, 'br').then(w => w.inst[a.id]?.at && w), "a's instance")
  assert.equal(w.inst[b.id], undefined)
  assert.equal(w.inst[a.id].label, a.branch, "its button's words from its data")
  const file = (ws: string) => join(rig.data, 'widget-data', 'br', 'ws', `${ws}.json`)
  assert.deepEqual(JSON.parse(readFileSync(file(a.id), 'utf8')).data, { b: a.branch, port: String(a.port), ws: a.id })
  assert.equal((await rig.rpc('widgetRuns', { id: 'br', ws: a.id })).runs[0].reason, 'select')

  // b selected: its own, in its own file
  await app.call('view', { tab: null, focused: true, shown: true, ws: b.id })
  w = await until(() => find(rig, 'br').then(w => w.inst[b.id]?.at && w), "b's instance")
  assert.deepEqual(JSON.parse(readFileSync(file(b.id), 'utf8')).data, { b: b.branch, port: String(b.port), ws: b.id })
  assert.notEqual(a.port, b.port)

  // a tick fetches only the one on screen; selecting a, fresh, fetches nothing, stale it does
  const atA = w.inst[a.id].at
  const atB = w.inst[b.id].at
  await rig.rpc('widgetTick', { now: Date.now() + 6 * 60_000 })
  w = await until(() => find(rig, 'br').then(w => w.inst[b.id].at > atB && !w.inst[b.id].running && w), 'b again')
  assert.equal(w.inst[a.id].at, atA, 'a is off screen')
  await app.call('view', { tab: null, focused: true, shown: true, ws: a.id })
  await sleep(300)
  assert.equal((await find(rig, 'br')).inst[a.id].at, atA, 'a is fresh: no fetch')
  const old = JSON.parse(readFileSync(file(a.id), 'utf8'))
  writeFileSync(file(a.id), JSON.stringify({ ...old, at: Date.now() - 10 * 60_000 }))
  await app.call('view', { tab: null, focused: true, shown: true, ws: null }) // the Board: none on screen
  await rig.rpc('widgetReload')
  await app.call('view', { tab: null, focused: true, shown: true, ws: a.id })
  await until(() => find(rig, 'br').then(w => w.inst[a.id].at > atA), 'a, stale, fetched as it is selected')

  // render, run and action name the workspace; a global one refuses one
  const r = await rig.cli('widget', 'render', 'br', '--ws', a.id)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, new RegExp(`${a.branch} on ${a.branch}`))
  assert.match((await rig.cli('widget', 'render', 'br')).err, /is per workspace: which one\? \(ws\)/)
  assert.match(await rig.rpc('widgetRender', { id: 'br', sample: true }), /on fix-login/, 'a sample: a made-up workspace')
  await assert.rejects(rig.rpc('widgetRun', { id: 'glob', ws: a.id }), /isn't per workspace/)
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'br', action: 'mark', arg: 'hi', ws: b.id }), { ok: true })
  assert.equal(readFileSync(join(rig.env.HOME, 'marked'), 'utf8'), `${b.branch} hi\n`)
  const check = await rig.cli('widget', 'check', 'br', '--ws', b.id)
  assert.match(check.out, /✓ fetch: printed/)
  assert.doesNotMatch(check.out, /use nothing of the workspace/)
  assert.match((await rig.cli('widget', 'check', 'br')).out, /not run: per workspace, which one\?/)

  // archived: kept, not shown; back with it; deleted: gone
  await rig.rpc('wsArchive', { id: a.id })
  assert.ok(existsSync(file(a.id)))
  assert.equal((await find(rig, 'br')).inst[a.id], undefined)
  await assert.rejects(rig.rpc('widgetRun', { id: 'br', ws: a.id }), /has no extensions: archived/)
  await rig.rpc('wsRestore', { id: a.id })
  assert.ok((await find(rig, 'br')).inst[a.id]?.at, 'restored: shown again')
  await rig.rpc('wsRm', { id: b.id })
  assert.ok(!existsSync(file(b.id)))
  assert.equal((await find(rig, 'br')).inst[b.id], undefined)
})

test('scope workspace: check warns when nothing uses the workspace, errors on a bad scope; the starter', async t => {
  const rig = await fresh(t)
  const make = (id: string, m: object) => {
    mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
    writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
  }
  make('blind', { name: 'Blind', scope: 'workspace', fetch: 'echo "{}"', ui: { type: 'text', value: 'hi' } })
  make('odd', { name: 'Odd', scope: 'team', fetch: 'echo "{}"' })
  await rig.rpc('widgetReload')
  const blind = await rig.rpc('widgetCheck', { id: 'blind' })
  assert.ok(blind.problems.some((x: any) => x.level === 'warn' && /use nothing of the workspace/.test(x.text)), JSON.stringify(blind))
  const odd = await rig.rpc('widgetCheck', { id: 'odd' })
  assert.ok(odd.problems.some((x: any) => x.level === 'error' && /scope/.test(x.where + x.text)), JSON.stringify(odd))

  // This branch: per workspace, checks out, its fetch run in a workspace
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  assert.match((await rig.cli('widget', 'new', 'Mine', '--kind', 'workspace')).out, /made mine in /)
  assert.equal((await find(rig, 'mine')).scope, 'workspace')
  const check = await rig.cli('widget', 'check', 'mine', '--ws', a.id)
  assert.equal(check.code, 0, check.out + check.err)
  assert.doesNotMatch(check.out, /✗|use nothing/)
  const html = await rig.rpc('widgetRender', { id: 'mine', ws: a.id })
  assert.match(html, new RegExp(a.branch))
  assert.match(html, new RegExp(`http://localhost:${a.port}`))
})
