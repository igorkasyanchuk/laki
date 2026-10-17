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
