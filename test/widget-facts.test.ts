// Workspace facts (widget.json's facts) for a per-workspace extension, an extension's own working hours, its tooltip
// off, an action's send to the workspace's agent, and Laki AI's asks drawn as they'd look
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { manifestCheck } from '../src/shared/widgetSchema.ts'
import { fresh, until } from './helpers.ts'

const find = async (rig: any, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)
const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}

test('facts: the checker knows the vocabulary, needs scope workspace, takes tip false', () => {
  const say = (m: object) => manifestCheck(m as Record<string, unknown>).map(p => `${p.level} ${p.text}`)
  assert.deepEqual(say({ scope: 'workspace', facts: ['pr', 'changed_files'], tip: false }), [])
  assert.match(say({ scope: 'workspace', facts: ['changed_file'] }).join(), /isn't a fact.*did you mean changed_files/)
  assert.match(say({ facts: ['pr'] }).join(), /need "scope": "workspace"/)
  assert.match(say({ tip: true }).join(), /text or false/)
})

test("facts: a per-workspace one gets its workspace's facts in its ui and $LAKI_FACTS, and fetches again as they change", async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const a = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  make(rig, 'fx', {
    name: 'Facts',
    scope: 'workspace',
    facts: ['changed_files', 'commits', 'stat', 'pr', 'agents'],
    every: 60,
    fetch: 'printf "%s" "$LAKI_FACTS"',
    ui: { type: 'list', each: 'facts.changed_files', title: '{{path}}' },
    sample: {},
  })
  make(rig, 'shown', { name: 'Shown', scope: 'workspace', facts: ['changed_files'], ui: { type: 'list', each: 'facts.changed_files', title: '{{path}}' } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'fx', on: true })
  await rig.rpc('widgetSet', { id: 'shown', on: true })
  assert.deepEqual((await find(rig, 'fx')).facts, ['pr', 'stat', 'changed_files', 'commits', 'agents'])
  const sample = await rig.rpc('widgetRender', { id: 'fx', sample: true })
  assert.match(sample, /src\/login\.ts/, "a sample's made-up facts")

  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true, ws: a.id })
  const data = () => JSON.parse(readFileSync(join(rig.data, 'widget-data', 'fx', 'ws', `${a.id}.json`), 'utf8')).data
  await until(() => find(rig, 'fx').then(w => w.inst[a.id]?.at), 'its first fetch')
  assert.deepEqual(data().changed_files, [])
  assert.equal(data().pr, null)
  assert.deepEqual(data().agents, [])

  await rig.rpc('factsTick') // the one with no fetch read as it is now
  // a new file: read again (the stat scan sees it), fetched again with it, drawn with it
  writeFileSync(join(a.path, 'new.txt'), 'hi\n')
  await until(async () => (await rig.rpc('factsTick'), data().changed_files?.some((f: any) => f.path === 'new.txt' && f.status === 'A')), 'fetched with the new file')
  // the stat scan may see the file in the same tick or the next: changed_files is in one of its facts runs' why
  assert.ok((await rig.rpc('widgetRuns', { id: 'fx', ws: a.id })).runs.some((r: any) => r.reason === 'facts' && /^changed: .*changed_files/.test(r.why)))
  assert.match(await rig.rpc('widgetRender', { id: 'fx', ws: a.id }), /new\.txt/)
  // one with no fetch: drawn again (its instance's fx), its facts in its ui
  const shown = await until(() => find(rig, 'shown').then(w => w.inst[a.id]?.fx && w), 'drawn again')
  assert.equal(shown.inst[a.id].at, undefined, 'not fetched')
  assert.match(await rig.rpc('widgetRender', { id: 'shown', ws: a.id }), /new\.txt/)

  // a commit: its commits
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: a.path })
  git('add', '.')
  git('commit', '-qm', 'Add the new file')
  await until(async () => (await rig.rpc('factsTick'), data().commits?.[0]?.subject === 'Add the new file'), 'its commit')
})

test("an extension's own working hours: refused when they don't read, always over Settings', shown in the view", async t => {
  const rig = await fresh(t)
  make(rig, 'hr', { name: 'Hours', every: 5, fetch: 'echo "{}"', sample: {} })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'hr', on: true })
  await assert.rejects(rig.rpc('widgetSet', { id: 'hr', hours: 'sometimes' }), /working hours: From when to when/)
  await rig.rpc('widgetSet', { id: 'hr', hours: 'ALWAYS' })
  assert.equal((await find(rig, 'hr')).hours, 'always')
  // Settings' hours say never now; its own always wins
  const h = (n: number) => (x => `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`)((new Date().getHours() + n) % 24)
  await rig.rpc('settingsSet', { widgetHours: `${h(2)}-${h(3)}` })
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await app.call('view', { tab: null, focused: true, shown: true })
  const at = (await find(rig, 'hr')).at
  await rig.rpc('widgetTick', { now: Date.now() + 10 * 60_000 })
  await until(() => find(rig, 'hr').then(w => w.at && w.at !== at), 'fetched: always')
  await rig.rpc('widgetSet', { id: 'hr', hours: '' })
  assert.equal((await find(rig, 'hr')).hours, undefined, "empty: Settings' again")
})

test("the tooltip: the user's switch, or widget.json's tip: false; an action's send comes back for the app", async t => {
  const rig = await fresh(t)
  make(rig, 'tp', { name: 'Tip', tip: false, actions: { ask: 'echo \'{"send": "Fix the failing test"}\'' } })
  make(rig, 'tq', { name: 'Tip 2', tip: 'Hello' })
  await rig.rpc('widgetReload')
  assert.deepEqual([(await find(rig, 'tp')).hide, (await find(rig, 'tp')).tipOff], [{ tip: true }, true])
  await rig.rpc('widgetSet', { id: 'tq', hide: { tip: true } })
  assert.deepEqual((await find(rig, 'tq')).hide, { tip: true })
  await rig.rpc('widgetSet', { id: 'tq', hide: { tip: false } })
  assert.equal((await find(rig, 'tq')).hide, undefined)
  await rig.rpc('widgetSet', { id: 'tp', on: true })
  const r = await rig.rpc('widgetAction', { id: 'tp', action: 'ask' })
  assert.equal(r.send, 'Fix the failing test')
})
