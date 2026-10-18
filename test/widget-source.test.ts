// An extension's data from somewhere other than its fetch: a text typed in, a file of this Mac or a URL, picked on its
// card (widgetSet source) or given by widget.json; JSON is its data, anything else { text }
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fresh, until } from './helpers.ts'

const find = async (rig: any, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)

test('sources: static, file and URL, each JSON or { text }; its fetch again; widget.json says the first', async t => {
  const rig = await fresh(t)
  const make = (id: string, m: object) => {
    mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
    writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
  }
  make('n', { name: 'N', fetch: 'echo \'{"n": 1}\'', ui: { type: 'text', value: 'n={{n}} {{text}}' }, sample: { n: 0 } })
  make('note', { name: 'Note', source: { kind: 'static', text: '# Hi\n\nthere' }, ui: { type: 'markdown', value: '{{text}}' } })
  make('bare', { name: 'Bare', ui: { type: 'text', value: '{{n}}' } })
  await rig.rpc('widgetReload')
  // a typed-in text shows off, before anything is fetched or kept
  assert.match(await rig.rpc('widgetRender', { id: 'note' }), /<h1>Hi<\/h1>/)
  assert.match(await rig.rpc('widgetRender', { id: 'note', sample: true }), /<h1>Hi<\/h1>/)
  // a source picked while it's on is read at once (a fetch of its own)
  const shows = (id: string, re: RegExp) => until(async () => re.test(await rig.rpc('widgetRender', { id })), `${id} shows ${re}`)
  const idle = (id: string) => until(async () => !(await find(rig, id)).running, `${id} done fetching`)
  let w = await find(rig, 'n')
  assert.deepEqual([w.source, w.ownFetch], [{ kind: 'fetch' }, true])

  // widget.json's static text: shown with no fetch at all, on or off
  assert.deepEqual((await find(rig, 'note')).source, { kind: 'static', text: '# Hi\n\nthere' })
  await rig.rpc('widgetSet', { id: 'note', on: true })
  assert.match(await rig.rpc('widgetRender', { id: 'note' }), /<h1>Hi<\/h1>/)
  assert.equal((await find(rig, 'note')).every, undefined, 'nothing to fetch on a schedule')

  // typed in on its card: JSON is the data at once, even while off
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'static', text: '{"n": 7}' } })
  assert.match(await rig.rpc('widgetRender', { id: 'n' }), /n=7/)
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'static', text: '{bad' } })
  w = await find(rig, 'n')
  assert.match(w.error, /not JSON/)
  assert.match(await rig.rpc('widgetRender', { id: 'n' }), /n=7/, 'the last good data stays')
  // a note that starts with a link is words, not broken JSON
  await rig.rpc('widgetSet', { id: 'note', source: { kind: 'static', text: '[Runbook](https://x.dev) first' } })
  assert.equal((await find(rig, 'note')).error, undefined)
  assert.match(await rig.rpc('widgetRender', { id: 'note' }), /href="https:\/\/x.dev"/)
  await rig.rpc('widgetSet', { id: 'note', source: null })

  // a file, read as it fetches: relative to its folder, ~ is home; words are { text }
  await rig.rpc('widgetSet', { id: 'n', on: true })
  writeFileSync(join(rig.env.HOME, 'note.md'), 'plain words')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'file', path: '~/note.md' } })
  await shows('n', /n= plain words/)
  writeFileSync(join(rig.data, 'widgets', 'n', 'd.json'), '{"n": 9}')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'file', path: 'd.json' } })
  await shows('n', /n=9/)
  await idle('n')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'file', path: '~/gone.json' } })
  await until(async () => /no file ~\/gone.json/.test((await find(rig, 'n')).error ?? ''), 'no such file: said')

  // a URL: its JSON; an HTTP error says its status, not its query
  const srv = createServer((q, r) => (q.url?.startsWith('/ok') ? r.end('{"n": 42}') : ((r.statusCode = 503), r.end('down'))))
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok))
  t.after(() => srv.close())
  const base = `http://127.0.0.1:${(srv.address() as any).port}`
  await idle('n')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'url', url: `${base}/ok` } })
  await shows('n', /n=42/)
  assert.equal((await find(rig, 'n')).every, 5, 'read again every few minutes')
  await idle('n')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'url', url: `${base}/x?key=SECRET` } })
  const err = await until(async () => (e => /HTTP/.test(e ?? '') && e)((await find(rig, 'n')).error), 'its error')
  assert.match(err, /HTTP 503/)
  assert.doesNotMatch(err, /SECRET/)
  await assert.rejects(rig.rpc('widgetSet', { id: 'n', source: { kind: 'url', url: 'file:///etc/passwd' } }), /http or https/)
  await assert.rejects(rig.rpc('widgetSet', { id: 'n', source: { kind: 'nope' } }), /a source/)
  await assert.rejects(rig.rpc('widgetSet', { id: 'n', source: { kind: 'static', text: 'x'.repeat(70_000) } }), /64 KB/, 'too long: refused, not emptied')
  await assert.rejects(rig.rpc('widgetSet', { id: 'bare', source: { kind: 'fetch' } }), /no fetch of its own/)

  // its own fetch again; null: widget.json's
  await idle('n')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'fetch' } })
  await shows('n', /n=1/)
  await rig.rpc('widgetSet', { id: 'note', source: { kind: 'static', text: 'mine' } })
  await rig.rpc('widgetSet', { id: 'note', source: null })
  assert.equal((await find(rig, 'note')).source.text, '# Hi\n\nthere')

  // the check reads a source too
  await idle('n')
  await rig.rpc('widgetSet', { id: 'n', source: { kind: 'file', path: 'd.json' } })
  await idle('n')
  const check = await rig.cli('widget', 'check', 'n')
  assert.match(check.out, /✓ fetch: read 8 B from its file/)
})

test('an AI source: the agent of Settings › Extensions (or its own profile) answers its prompt, its last json block the data', async t => {
  const rig = await fresh(t)
  const dir = join(rig.data, 'widgets', 'slack')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'widget.json'), JSON.stringify({ name: 'Slack', config: { channel: 'eng' }, source: { kind: 'ai', prompt: 'Sum up #{{config.channel}}', tools: 'mcp__slack, WebFetch' }, sample: { text: 'two decisions' }, ui: { type: 'text', value: '{{text}}|{{tools}}|{{account}}' } }))
  await rig.rpc('settingsSet', { presets: [{ name: 'claude', agent: 'claude' }, { name: 'work', agent: 'claude', env: { TEST_ACCOUNT: 'work' } }, { name: 'cx', agent: 'codex' }] })
  await rig.rpc('widgetReload')
  let w = await find(rig, 'slack')
  assert.equal(w.every, 60, 'an hour unless set: each run costs')
  assert.match(await rig.rpc('widgetRender', { id: 'slack', sample: true }), /two decisions/, 'its sample')
  const shows = (re: RegExp) => until(async () => re.test(await rig.rpc('widgetRender', { id: 'slack' })), `shows ${re}`)
  const idle = () => until(async () => !(await find(rig, 'slack')).running, 'done')

  await rig.rpc('widgetSet', { id: 'slack', on: true }) // turned on: run now, with the prompt filled
  await shows(/Sum up #eng\|mcp__slack, WebFetch\|</)
  const call = rig.fakeLog().filter((l: any) => l.bin === 'claude' && l.args.includes('--output-format')).pop()
  assert.ok(call.args.includes('--allowedTools') && !call.args.includes('--tools'), 'the user’s own tools and MCP servers, the named ones unasked')
  assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1], /Change nothing anywhere[\s\S]*two decisions/, 'told the shape: its sample')

  // Settings › Extensions' agent: its env; the source's own profile wins
  await idle()
  await rig.rpc('settingsSet', { widgetAgent: 'work' })
  await rig.rpc('widgetRun', { id: 'slack' })
  await shows(/\|work</)
  await idle()
  await rig.rpc('widgetSet', { id: 'slack', source: { kind: 'ai', prompt: 'words only', profile: 'claude' } })
  await shows(/Just words: words only\|\|</)
  await idle()
  await rig.rpc('widgetSet', { id: 'slack', source: { kind: 'ai', prompt: 'x', profile: 'gone' } })
  await until(async () => /no claude or codex profile gone/.test((await find(rig, 'slack')).error ?? ''), 'a profile gone: said')
  await idle()
  await rig.rpc('widgetSet', { id: 'slack', source: { kind: 'ai', prompt: 'fail now' } })
  await until(async () => /it broke/.test((await find(rig, 'slack')).error ?? ''), "claude's own error")

  // every 15 minutes at most; tools never an option; the check doesn't spend a run
  await rig.rpc('widgetSet', { id: 'slack', every: 5 })
  w = await find(rig, 'slack')
  assert.equal(w.every, 15)
  await assert.rejects(rig.rpc('widgetSet', { id: 'slack', source: { kind: 'ai', prompt: 'x', tools: '--dangerously-skip-permissions' } }), /a source/, 'one argument: never an option of claude’s')
  await rig.rpc('widgetSet', { id: 'slack', source: { kind: 'ai', prompt: 'x', tools: 'Bash(git log --oneline:*)' } })
  const check = await rig.cli('widget', 'check', 'slack')
  assert.match(check.out, /not run: an agent makes its data/)
})

test("an agent's run stops: Resources' Stop, turned off, deleted; a stopped fetch keeps its last data", async t => {
  const rig = await fresh(t)
  const dir = join(rig.data, 'widgets', 'slow')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'widget.json'), JSON.stringify({ name: 'Slow', source: { kind: 'ai', prompt: 'quick' }, sample: { text: 'x' }, ui: { type: 'text', value: '{{text}}' }, actions: { wait: { ai: 'slow action' } } }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'slow', on: true })
  await until(async () => /quick/.test(await rig.rpc('widgetRender', { id: 'slow' })), 'its first data')
  await until(async () => !(await find(rig, 'slow')).running, 'done')
  const working = (on: boolean) => until(async () => !!(await find(rig, 'slow')).agent === on, on ? 'its agent at work' : 'its agent stopped')
  const row = async () => (await rig.rpc('resources')).others?.find((o: any) => o.stop === 'agent:slow')

  // Resources' Stop (the inspector's too): the agent ends, the fetch fails as stopped, its data stays
  await rig.rpc('widgetSet', { id: 'slow', source: { kind: 'ai', prompt: 'slow fetch' } })
  await working(true)
  assert.equal((await row())?.name, 'Extension · Slow (AI)', 'a row in Resources with a Stop')
  await rig.rpc('resourceStop', { key: 'agent:slow' })
  await working(false)
  await until(async () => /claude: stopped/.test((await find(rig, 'slow')).error ?? ''), 'failed as stopped')
  assert.match(await rig.rpc('widgetRender', { id: 'slow' }), /quick/, 'its last data kept')
  await until(async () => !(await row()), 'its process gone')

  // an AI action: a new source leaves it be (only the source's own run stops); Stop ends it
  const act = rig.rpc('widgetAction', { id: 'slow', action: 'wait' })
  await working(true)
  await rig.rpc('widgetSet', { id: 'slow', source: { kind: 'static', text: '{"text": "typed"}' } })
  await new Promise(r => setTimeout(r, 300))
  assert.ok((await find(rig, 'slow')).agent, 'the action runs on')
  await rig.rpc('widgetSet', { id: 'slow', source: { kind: 'ai', prompt: 'quick' } })
  await rig.rpc('resourceStop', { key: 'agent:slow' })
  assert.match((await act).error, /stopped/)
  await working(false)

  // turned off: stopped; deleted while one runs: stopped first, then gone
  void rig.rpc('widgetRun', { id: 'slow' })
  await working(true)
  await rig.rpc('widgetSet', { id: 'slow', on: false })
  await working(false)
  await rig.rpc('widgetSet', { id: 'slow', on: true })
  await working(true)
  const t0 = Date.now()
  assert.deepEqual(await rig.rpc('widgetRm', { id: 'slow' }), { deleted: 'slow' })
  assert.ok(Date.now() - t0 < 5000, 'not the agent’s ten minutes')
  assert.equal(await find(rig, 'slow'), undefined)
  await until(async () => !(await row()), 'its process gone')
})

test('AI actions answer in a dialog, a toast or new data; notify posts what its data says, once each time it reads anew', async t => {
  const rig = await fresh(t)
  const app = await rig.connect()
  t.after(() => app.ws.close())
  const dir = join(rig.data, 'widgets', 'acts')
  mkdirSync(dir, { recursive: true })
  const m = { name: 'Acts', fetch: `cat ${join(dir, 'n.json')}`, notify: '{{#if n}}{{n}} new{{/if}}', ui: { type: 'stat', value: '{{n}}' }, sample: { n: 1 }, actions: { draft: { ai: 'words: draft for {{arg}} at {{n}}' }, upd: { ai: 'data now' }, ping: { ai: 'toast it', tools: 'mcp__slack__post_message' } } }
  writeFileSync(join(dir, 'widget.json'), JSON.stringify(m))
  writeFileSync(join(dir, 'n.json'), '{"n": 3}')
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'acts', on: true })
  const said = (text: string) => until(() => app.events.find(e => e.ev === 'widget-say' && e.widget === 'acts' && e.notify === text), `notified: ${text}`)
  await said('3 new')
  await until(async () => !(await find(rig, 'acts')).running, 'fetched')

  // a dialog with its words, {{arg}} and the data filled in; no fetch after it (another agent's run would cost)
  const runs = async () => (await rig.rpc('widgetRuns', { id: 'acts' })).runs.length
  const before = await runs()
  const r = await rig.rpc('widgetAction', { id: 'acts', action: 'draft', arg: 'PR 412' })
  assert.equal(r.modal.title, 'Acts · draft')
  assert.equal(r.modal.text, 'Just words: words: draft for PR 412 at 3')
  assert.equal(await runs(), before + 1, 'the action alone, no fetch')
  const ping = await rig.rpc('widgetAction', { id: 'acts', action: 'ping' })
  assert.equal(ping.toast, 'sent')
  const call = rig.fakeLog().filter((l: any) => l.bin === 'claude' && l.args.at(-1) === 'toast it').pop()
  assert.equal(call.args[call.args.indexOf('--allowedTools') + 1], 'mcp__slack__post_message')
  // its json's data is the extension's: kept, said by notify
  await rig.rpc('widgetAction', { id: 'acts', action: 'upd' })
  await said('9 new')
  assert.match(await rig.rpc('widgetRender', { id: 'acts' }), />9</)

  // the same words again: nothing; empty, then words again: said again
  const n = () => app.events.filter(e => e.ev === 'widget-say' && e.notify).length
  const was = n()
  writeFileSync(join(dir, 'n.json'), '{"n": 9}')
  await rig.rpc('widgetRun', { id: 'acts' })
  writeFileSync(join(dir, 'n.json'), '{"n": 0}')
  await rig.rpc('widgetRun', { id: 'acts' })
  assert.equal(n(), was)
  writeFileSync(join(dir, 'n.json'), '{"n": 9}')
  await rig.rpc('widgetRun', { id: 'acts' })
  await until(() => n() === was + 1, 'said again')
  const check = await rig.cli('widget', 'check', 'acts', '--no-run')
  assert.doesNotMatch(check.out, /✗|actions\./)
})
