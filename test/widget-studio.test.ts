// The extension studio (WidgetStudio.tsx): its chat (widget:<id>) writes one with fixtures, off; each write undoable;
// Try it live runs it once while off; Remix copies one as yours; a new one's id; its chat goes with it
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

const manifest = (name: string) =>
  JSON.stringify({ name, every: 5, size: [3, 2], fetch: 'echo \'{"prs": [{"title": "Live one", "ci": "passing"}]}\'', ui: { type: 'list', each: 'prs', title: '{{title}}', accessories: [{ tag: '{{ci}}' }] }, sample: { prs: [{ title: 'Fix the date picker', ci: 'failing' }] } })
const files = (name: string) => ({ 'widget.json': manifest(name), 'fixtures/sample.json': '{"prs": [{"title": "Fix the date picker", "ci": "failing"}]}', 'fixtures/empty.json': '{"prs": []}' })

test('studio: its chat writes one off with fixtures, Undo, Try it live once, Remix, a new id, its chat goes with it', async t => {
  const hits: any[] = []
  const answers: object[] = []
  const srv = createServer(async (q, r) => {
    let body = ''
    for await (const c of q) body += c
    hits.push(JSON.parse(body))
    r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answers[hits.length - 1] ?? { error: { message: 'no more' } }))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  t.after(() => (srv.closeAllConnections(), srv.close()))
  const rig = await fresh(t, { env: { LAKI_AI_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` } })
  await rig.rpc('settingsSet', { ai: { on: true } })
  await rig.rpc('aiKey', { key: 'sk-or-v1-abc123' })
  const reply = (message: object) => ({ model: 'm', choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } })
  const call = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  const view = async (id: string) => (await rig.rpc('state')).widgets.find((w: any) => w.id === id)

  // a new one: its id from the first words, the AI told it; written with fixtures, checked, off
  const { id } = await rig.rpc('widgetSlug', { text: 'Show my open PRs as a list with CI status' })
  assert.equal(id, 'open-prs-list')
  answers.push(reply({ content: '', tool_calls: [call('c1', 'laki_extension_write', { id, files: files('Open PRs') })] }), reply({ content: '', tool_calls: [call('c2', 'laki_extension_check', { id })] }), reply({ content: 'Made it: its fetch runs gh pr list.' }))
  assert.deepEqual(await rig.rpc('aiAsk', { chat: `widget:${id}`, text: 'Show my open PRs as a list with CI status' }), { text: 'Made it: its fetch runs gh pr list.' })
  const sys = hits[0].messages[0].content
  assert.match(sys, /extension studio for a new extension: its id is open-prs-list/)
  assert.match(sys, /Always write fixtures\/sample\.json/)
  assert.match(sys, /`list` \(/, 'the kit catalog')
  assert.match(hits[2].messages.at(-1).content, /ok|no problems|✓|\[\]/i, 'the check ran')
  let w = await view(id)
  assert.ok(w && !w.on && w.byAi, 'off, by Laki AI')
  assert.equal(w.history.length, 1, 'a snapshot before the write')
  assert.match(await rig.rpc('widgetRender', { id, sample: true }), /Fix the date picker/, 'its preview from its sample')
  assert.deepEqual((await rig.rpc('widgetRuns', { id })).runs, [], 'nothing ran')
  assert.ok(existsSync(join(rig.data, 'widget-data', `widget:${id}.chat.json`)), 'its chat kept')
  assert.equal((await rig.rpc('aiState', { chat: `widget:${id}` })).chat.at(-1).text, 'Made it: its fetch runs gh pr list.')

  // the next ask sees its files; a second write, then Undo back to the first, then to none
  answers.push(reply({ content: '', tool_calls: [call('c3', 'laki_extension_write', { id, files: { 'widget.json': manifest('PRs v2') } })] }), reply({ content: 'Renamed.' }))
  await rig.rpc('aiAsk', { chat: `widget:${id}`, text: 'Call it PRs v2' })
  assert.match(hits[3].messages[0].content, /<file name="widget\.json">[\s\S]*Open PRs/)
  assert.match(hits[3].messages[0].content, /Its last check/)
  w = await view(id)
  assert.equal(w.name, 'PRs v2')
  assert.equal(w.history.length, 2)
  assert.equal((await rig.rpc('widgetUndo', { id, after: w.history[0] })).gone, false, 'Undo to here: after the first turn')
  w = await view(id)
  assert.equal(w.name, 'Open PRs')
  assert.equal(w.history.length, 1)

  // Try it live: a plain run refuses it while off (Laki AI's), once runs it, logged
  assert.match((await rig.rpc('widgetRun', { id })).error, /is off/)
  await rig.rpc('widgetMock', { id, fixture: 'sample' })
  assert.deepEqual(await rig.rpc('widgetRun', { id, once: true }), { ok: true })
  const run = (await rig.rpc('widgetRuns', { id })).runs[0]
  assert.match(run.why, /once while off/)
  w = await view(id)
  assert.ok(!w.on && !w.mock, 'still off, real data now')
  assert.match(await rig.rpc('widgetRender', { id }), /Live one/)

  assert.equal((await rig.rpc('widgetUndo', { id })).gone, true, 'back to before it was made')
  assert.ok(!(await view(id)))
  await assert.rejects(rig.rpc('widgetUndo', { id }), /nothing to undo/)

  // Remix: a copy of a built-in, yours, off, Laki AI may rewrite it (more than once in its hour)
  const { id: copy } = await rig.rpc('widgetRemix', { id: 'links' })
  assert.equal(copy, 'links-copy')
  w = await view(copy)
  assert.ok(w && !w.on && !w.byAi && !w.builtin && w.name.endsWith('(copy)'))
  await rig.rpc('widgetWrite', { id: copy, files: { 'notes.txt': 'one' } })
  await rig.rpc('widgetWrite', { id: copy, files: { 'notes.txt': 'two' } })
  assert.ok(!(await view(copy)).byAi, 'still yours')
  await assert.rejects(rig.rpc('widgetRemix', { id: 'links', newId: copy }), /is taken/)
  assert.equal((await rig.rpc('widgetSlug', { text: 'links copy' })).id, 'links-copy-2')

  // its chat and history go with it
  answers.push(reply({ content: 'Hi.' }))
  await rig.rpc('aiAsk', { chat: `widget:${copy}`, text: 'hello' })
  assert.ok(existsSync(join(rig.data, 'widget-data', `widget:${copy}.chat.json`)))
  await rig.rpc('widgetRm', { id: copy })
  assert.ok(!existsSync(join(rig.data, 'widget-data', `widget:${copy}.chat.json`)))
  assert.ok(!existsSync(join(rig.data, 'widget-data', `${copy}.history`)))
  assert.deepEqual((await rig.rpc('aiState', { chat: `widget:${copy}` })).chat, [], 'forgotten')
})
