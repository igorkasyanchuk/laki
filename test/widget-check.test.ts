// Extensions' starters (laki widget new), the JSON Schema (docs/widget.schema.json), the checker (laki widget check),
// one-file extensions (prs.5m.sh) and fixtures through widgetWrite
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { manifestCheck, WIDGET_SCHEMA } from '../src/shared/widgetSchema.ts'
import { STARTER_KINDS } from '../src/shared/widgetStarters.ts'
import { reservedIn, UI_EXAMPLES, UI_SAMPLES, UI_TYPES, uiCheck } from '../src/shared/widgetUi.ts'
import { fresh, until } from './helpers.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const find = async (rig: any, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)
const errors = (ps: any[]) => ps.filter(p => p.level === 'error')

test('starters: each kind made through the CLI is on, checks out with its fetch, and shows its fixture', async t => {
  const rig = await fresh(t)
  for (const kind of STARTER_KINDS.filter(k => k !== 'workspace' && k !== 'stream' && k !== 'launcher' /* per workspace, a stream: widget-ws and widget-events tests; the launcher: no data, below */)) {
    const made = await rig.cli('widget', 'new', `My ${kind}`, '--kind', kind)
    assert.equal(made.code, 0, made.err)
    const id = `my-${kind}`
    assert.match(made.out, new RegExp(`made ${id} in .*: on`))
    assert.match(made.out, /laki widget dev .*\n.*laki widget check my-/)
    const w = await until(() => find(rig, id).then(w => w?.at && w), `${kind}: fetched as it was made`)
    assert.ok(w.on && !w.byAi && !w.error, `${kind}: on, yours`)
    const check = await rig.cli('widget', 'check', id)
    assert.equal(check.code, 0, `${kind}: ${check.out}${check.err}`)
    assert.doesNotMatch(check.out, /✗/)
    assert.match(check.out, kind === 'note' ? /✓ fetch: read \d+ B from its text/ : /✓ fetch: printed \d+ B of JSON/)
    if (kind === 'button') assert.equal(w.badge, '3', 'its badge from the fixture')
    else assert.ok(await rig.rpc('widgetRender', { id }), `${kind}: a preview`)
  }
  assert.match(await rig.rpc('widgetRender', { id: 'my-number' }), /<div class="k-v">1,284<\/div>|k-v/)
  assert.match(await rig.rpc('widgetRender', { id: 'my-onefile' }), /hello · \d\d:\d\d/)
  assert.match(await rig.rpc('widgetRender', { id: 'my-note' }), /<h2>This week<\/h2>/, 'the note: its text, no fetch')
  // the launcher: buttons only, no data; each asks Laki for something
  assert.equal((await rig.cli('widget', 'new', 'My launcher', '--kind', 'launcher')).code, 0)
  const launch = await rig.rpc('widgetRender', { id: 'my-launcher', sample: true })
  assert.equal(launch.match(/data-do=/g)?.length, 5)
  assert.doesNotMatch((await rig.cli('widget', 'check', 'my-launcher')).out, /✗/)
  const files = (await rig.rpc('widgetFiles', { id: 'my-list' })).files
  assert.deepEqual(Object.keys(files).sort(), ['README.md', 'fetch.sh', 'fixtures/empty.json', 'fixtures/green.json', 'fixtures/many.json', 'fixtures/one.json', 'fixtures/sample.json', 'widget.json'])
  assert.match(files['widget.json'], /"\$schema": "https:\/\/raw\.githubusercontent\.com\/igorkasyanchuk\/laki\/main\/docs\/widget\.schema\.json"/)
  assert.match((await rig.rpc('widgetFiles', { id: 'my-panel' })).files['laki.d.ts'], /declare const laki: Laki/)
  // a second of the same name gets its own id; a folder of yours must be empty
  assert.match((await rig.cli('widget', 'new', 'My list')).out, /made my-list-2 /)
  const mine = join(rig.env.HOME, 'mine')
  assert.match((await rig.cli('widget', 'new', 'Mine', '--dir', mine)).out, /made mine in .*mine\nnext:\n.*laki widget dev .*mine/)
  assert.match((await rig.cli('widget', 'new', 'Mine', '--dir', mine)).err, /isn't an empty folder/)
  assert.match((await rig.cli('widget', 'new', 'X', '--kind', 'nope')).err, /a kind: number, list/)
})

test('the schema: docs/widget.schema.json in step, every manifest key and UI element in it', () => {
  const file = readFileSync(join(root, 'docs/widget.schema.json'), 'utf8')
  assert.equal(file, `${JSON.stringify(WIDGET_SCHEMA, null, 2)}\n`, 'docs/widget.schema.json is out of date: node --experimental-strip-types scripts/widget-schema.ts')
  // the keys widgets.ts reads (its Manifest type): this list, and the schema's
  const KEYS = ['name', 'description', 'size', 'every', 'view', 'place', 'fetch', 'script', 'config', 'actions', 'icon', 'label', 'badge', 'tip', 'click', 'sample', 'sampleConfig', 'ui', 'scope', 'on', 'stream', 'source', 'notify']
  const src = readFileSync(join(root, 'src/daemon/widgets.ts'), 'utf8')
  const manifest = /type Manifest = \{([^\n]*)\}\n/.exec(src)![1]
  assert.deepEqual([...manifest.matchAll(/(\w+)\?:/g)].map(m => m[1]).sort(), [...KEYS].sort(), "widgets.ts' Manifest and this list")
  const props = (WIDGET_SCHEMA as any).properties
  for (const k of KEYS) assert.ok(props[k]?.description, `${k} in the schema, described`)
  const els = JSON.stringify((WIDGET_SCHEMA as any).definitions)
  for (const t of UI_TYPES) assert.ok(els.includes(`"const":"${t}"`), `${t} in the schema`)
})

test('check: unknown keys, places, click, a row field, a fetch that prints no JSON; an AI-written one not run', async t => {
  const rig = await fresh(t)
  const d = join(rig.data, 'widgets', 'bad')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Bad', plcae: 'side', place: 'stauts', click: 'go', fetch: 'echo nope', ui: { type: 'list', each: 'prs', title: '{{titel}}' }, sample: { prs: [{ title: 'a' }] } }))
  await rig.rpc('widgetReload')
  const { problems } = await rig.rpc('widgetCheck', { id: 'bad', run: true }) // off, but yours: an explicit check runs it
  const has = (level: string, where: RegExp, text: RegExp) => assert.ok(problems.some((p: any) => p.level === level && where.test(p.where) && text.test(p.text)), `${level} ${where} ${text} in ${JSON.stringify(problems, null, 1)}`)
  has('warn', /^widget\.json$/, /no key plcae \(did you mean place\?\)/)
  has('error', /widget\.json place/, /"stauts" isn't a place.*\(did you mean status\?\)/)
  has('error', /widget\.json click/, /go isn't one of its actions/)
  has('warn', /^sample · ui \(list\)/, /title uses titel, which no item of prs has \(did you mean title\?\)/)
  has('error', /^fetch$/, /fetch printed no JSON: nope/)
  const cli = await rig.cli('widget', 'check', 'bad', '--no-run')
  assert.equal(cli.code, 1)
  assert.match(cli.out, /✗ widget\.json click: go isn't one of its actions\n/)
  assert.match(cli.out, /! widget\.json: no key plcae/)
  assert.doesNotMatch(cli.out, /fetch/)
  // by its folder too, and a folder Laki doesn't have isn't run
  const away = join(rig.env.HOME, 'away')
  mkdirSync(join(away, 'fixtures'), { recursive: true })
  writeFileSync(join(away, 'widget.json'), JSON.stringify({ name: 'Away', fetch: 'echo {}', ui: { type: 'stat', value: '{{n}}' }, sample: { n: 1 } }))
  writeFileSync(join(away, 'fixtures', 'broken.json'), '{')
  const far = await rig.rpc('widgetCheck', { dir: away, run: true })
  assert.equal(far.id, 'away')
  assert.ok(far.problems.some((p: any) => p.where === 'fetch' && /not run: Laki doesn't have this one/.test(p.text)))
  assert.ok(far.problems.some((p: any) => p.level === 'error' && p.where === 'fixtures/broken.json'))
  assert.ok(far.problems.some((p: any) => p.level === 'ok' && p.where === 'sample'))

  // written by Laki AI and off: no run
  await rig.rpc('widgetWrite', { id: 'ai-one', files: { 'widget.json': JSON.stringify({ name: 'AI', fetch: 'echo {}', ui: { type: 'text', value: 'hi' }, sample: {} }) } })
  const ai = await rig.rpc('widgetCheck', { id: 'ai-one', run: true })
  assert.ok(ai.problems.some((p: any) => p.where === 'fetch' && /Laki AI wrote it and it's off: turn it on first/.test(p.text)))
  assert.deepEqual((await rig.rpc('widgetRuns', { id: 'ai-one' })).runs, [])
  assert.equal(errors(ai.problems).length, 0)
})

test("check: a field of the data's named at, error, config… is hidden behind Laki's own: said, with or without a ui", async t => {
  const ps = uiCheck({ type: 'text', value: 'deployed {{ago at}}' }, { at: '2026-10-17T09:00:00Z', n: 1 })
  assert.ok(ps.some(p => p.level === 'warn' && p.where === 'data' && p.text === `"at" is Laki's: rename it or read it as data.at`), JSON.stringify(ps))
  for (const x of [...UI_SAMPLES, ...UI_EXAMPLES]) assert.deepEqual(reservedIn(x.data), [], `the kit's own ${'type' in x ? x.type : x.title}`)
  const rig = await fresh(t)
  const d = join(rig.data, 'widgets', 'hid')
  mkdirSync(join(d, 'fixtures'), { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Hid', fetch: 'echo {}', sample: { error: 'none', n: 1 } }))
  writeFileSync(join(d, 'widget.html'), '<template preview>{{n}}</template>')
  writeFileSync(join(d, 'fixtures', 'cfg.json'), '{"config": 1}')
  await rig.rpc('widgetReload')
  const { problems } = await rig.rpc('widgetCheck', { id: 'hid' })
  assert.ok(problems.some((p: any) => p.level === 'warn' && p.where === 'sample · data' && /"error" is Laki's/.test(p.text)), JSON.stringify(problems))
  assert.ok(problems.some((p: any) => p.level === 'warn' && p.where === 'fixtures/cfg.json · data' && /"config" is Laki's/.test(p.text)))
})

test('check: a setting marked required: true or false, never on a switch', () => {
  const ps = manifestCheck({ name: 'R', fetch: 'echo {}', config: { repo: { label: 'Repo', required: true }, a: { required: 'yes' }, b: { type: 'bool', required: true } } })
  assert.ok(!ps.some(p => p.where === 'widget.json config.repo'), JSON.stringify(ps))
  assert.ok(ps.some(p => p.level === 'error' && p.where === 'widget.json config.a' && /required: true or false/.test(p.text)))
  assert.ok(ps.some(p => p.level === 'warn' && p.where === 'widget.json config.b' && /never empty/.test(p.text)))
})

test('one-file extensions: found, their interval, settings, place and ui; seconds refused by check; they run', async t => {
  const rig = await fresh(t)
  const home = join(rig.data, 'widgets')
  mkdirSync(home, { recursive: true })
  const script = `#!/bin/sh
# <laki.name>Repo PRs</laki.name>
# <laki.place>status, side</laki.place>
# <laki.size>2x1</laki.size>
# <laki.label>{{n}} open</laki.label>
# <laki.var>text(REPO="acme/web"): Repo</laki.var>
# <laki.var>bool(DRAFTS="true"): Drafts</laki.var>
# <laki.var>choice(open,all)(STATE="all"): State</laki.var>
# <laki.ui>{"type": "text", "value": "{{repo}} {{n}} {{state}}"}</laki.ui>
printf '{"repo": "%s", "n": 3, "state": "%s"}' "$WIDGET_REPO" "$WIDGET_STATE"
`
  writeFileSync(join(home, 'prs.2m.sh'), script)
  chmodSync(join(home, 'prs.2m.sh'), 0o755)
  writeFileSync(join(home, 'fast.30s.sh'), script)
  writeFileSync(join(home, 'notes.5m.txt'), 'not a script') // neither executable nor #!
  await rig.rpc('widgetReload')
  const w = await find(rig, 'prs')
  assert.ok(w, 'found')
  assert.equal(w.name, 'Repo PRs')
  assert.equal(w.every, 2)
  assert.deepEqual(w.places, ['status', 'side'])
  assert.deepEqual(w.size, [2, 1])
  assert.deepEqual(
    w.options.map((o: any) => [o.key, o.type, o.label]),
    [
      ['REPO', 'text', 'Repo'],
      ['DRAFTS', 'bool', 'Drafts'],
      ['STATE', 'choice', 'State'],
    ],
  )
  assert.equal(await find(rig, 'notes'), undefined)
  await rig.rpc('widgetSet', { id: 'prs', on: true })
  await until(async () => (await rig.rpc('widgetRender', { id: 'prs' }))?.includes('acme/web 3 all'), 'it ran')
  assert.equal((await find(rig, 'prs')).label, '3 open')
  assert.deepEqual(Object.keys((await rig.rpc('widgetFiles', { id: 'prs' })).files), ['prs.2m.sh'])
  const fast = await rig.rpc('widgetCheck', { id: 'fast', run: false })
  assert.ok(fast.problems.some((p: any) => p.level === 'error' && /every 30 s: at most once a minute/.test(p.text)))
  const ok = await rig.rpc('widgetCheck', { id: 'prs', run: true })
  assert.deepEqual(errors(ok.problems), [])
  assert.ok(ok.problems.some((p: any) => p.level === 'ok' && p.where === 'fetch'))
  // renamed: its settings stay under the old id, and check says so
  await rig.rpc('widgetSet', { id: 'prs', config: { REPO: 'acme/api' } })
  writeFileSync(join(home, 'repo.2m.sh'), script)
  chmodSync(join(home, 'repo.2m.sh'), 0o755)
  const { rmSync } = await import('node:fs')
  rmSync(join(home, 'prs.2m.sh'))
  await rig.rpc('widgetReload')
  const moved = await rig.rpc('widgetCheck', { id: 'repo', run: false })
  assert.ok(moved.problems.some((p: any) => p.level === 'warn' && /no settings kept for repo; .*prs.* renamed\?/.test(p.text)), JSON.stringify(moved.problems))
  // Delete removes the file only
  await rig.rpc('widgetRm', { id: 'repo' })
  assert.ok(readFileSync(join(home, 'fast.30s.sh'), 'utf8'))
})

test('widgetWrite: fixtures/<name>.json, never another folder, ../ or a link', async t => {
  const rig = await fresh(t)
  const wj = JSON.stringify({ name: 'Fx', fetch: 'cat fixtures/x.json', ui: { type: 'stat', value: '{{n}}' }, sample: { n: 1 } })
  await rig.rpc('widgetWrite', { id: 'fx', files: { 'widget.json': wj, 'fixtures/x.json': '{"n": 2}' } })
  assert.equal((await rig.rpc('widgetFiles', { id: 'fx' })).files['fixtures/x.json'], '{"n": 2}')
  assert.deepEqual((await rig.rpc('widgetRuns', { id: 'fx' })).fixtures, ['x'])
  for (const n of ['a/b.json', '../x', 'fixtures/../x.json', 'fixtures/x.txt', 'fixtures/a/b.json'])
    await assert.rejects(rig.rpc('widgetWrite', { id: 'fx', files: { [n]: '{}' } }), /no folders but fixtures/, n)
  const d = join(rig.data, 'widgets', 'fx')
  symlinkSync(join(rig.env.HOME), join(d, 'fixtures', 'y.json'))
  await assert.rejects(rig.rpc('widgetWrite', { id: 'fx', files: { 'fixtures/y.json': '{}' } }), /is a link or a folder there/)
  await rig.rpc('widgetWrite', { id: 'fx2', files: { 'widget.json': wj } })
  symlinkSync(rig.env.HOME, join(rig.data, 'widgets', 'fx2', 'fixtures'))
  await assert.rejects(rig.rpc('widgetWrite', { id: 'fx2', files: { 'fixtures/z.json': '{}' } }), /fixtures is a link or a file there/)
})

test('check: refresh on an event for every source that fetches; an agent source and a static text refused', () => {
  const at = (source?: object, more: object = {}) => manifestCheck({ name: 'x', ...(source && { source }), on: { 'turn.done': 'refresh' }, sample: {}, ...more }).filter(p => p.where === 'widget.json on.turn.done')
  assert.deepEqual(at({ kind: 'file', path: '~/x.json' }), [])
  assert.deepEqual(at({ kind: 'url', url: 'https://example.com/x' }), [])
  assert.deepEqual(at(undefined, { fetch: 'echo {}' }), [])
  assert.deepEqual(at(undefined, { script: 'f.mjs' }), [])
  assert.match(at({ kind: 'ai', prompt: 'find it' })[0].text, /each run costs/)
  assert.match(at({ kind: 'static', text: '{}' })[0].text, /a static text has nothing to fetch/)
  assert.match(at()[0].text, /it has no fetch, script, file or URL/)
})
