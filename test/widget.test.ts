import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ago, hasFull, hasScript, pageOf, render, sayOf, spark, viewOf } from '../src/shared/widget.ts'
import { fresh, type Rig, until } from './helpers.ts'

test('widget toasts and modals: sayOf keeps what the app can show', () => {
  assert.equal(sayOf(null), null)
  assert.equal(sayOf({ toast: '  ' }), null, 'nothing to show')
  assert.deepEqual(sayOf({ toast: 'hi', modal: { text: 'x' } }), { toast: 'hi', modal: { title: '', text: 'x', buttons: [{ label: 'OK', style: 'primary' }] } }, 'no buttons: OK')
  const m = sayOf({ modal: { title: 'T', buttons: [...Array(8)].map((_, i) => ({ label: `b${i}`, open: i ? 'laki://ws/a' : 'file:///etc', primary: 'yes' })) } })!.modal!
  assert.equal(m.buttons.length, 6, 'six at most')
  assert.deepEqual(m.buttons.slice(0, 2), [{ label: 'b0' }, { label: 'b1', open: 'laki://ws/a' }])
  assert.equal(sayOf({ modal: { title: 'T', buttons: [{ label: 'Go', run: 'open', arg: 42 }] } })!.modal!.buttons[0].arg, '42', 'a number as its text')
  // a rich one: an id, a kit element over its own data, a size, styles and when a button closes it
  const ui = { type: 'table', each: 'rows', columns: [{ value: '{{n}}' }] }
  assert.deepEqual(sayOf({ modal: { id: 'deploy', ui, data: { rows: [{ n: 1 }] }, size: 'l', buttons: [{ label: 'A', style: 'danger', close: false }, { label: 'B', run: 'go', close: 'done' }, { label: 'C', style: 'loud', close: 'yes' }] } }), { modal: { id: 'deploy', title: '', ui, data: { rows: [{ n: 1 }] }, size: 'l', buttons: [{ label: 'A', style: 'danger', close: false }, { label: 'B', run: 'go', close: 'done' }, { label: 'C' }] } })
  assert.equal(sayOf({ modal: { title: 'T', ui: { rows: [] }, data: 1, size: 'xl' } })!.modal!.ui, undefined, 'a ui without a type: dropped, and its data and an unknown size with it')
  assert.deepEqual(sayOf({ modal: { title: 'T', ui: { type: 'stat', big: 'x'.repeat(70_000) } } }), { modal: { title: 'T', buttons: [{ label: 'OK', style: 'primary' }] } }, 'a ui over 64 KB: dropped')
  assert.deepEqual(sayOf({ modal: { title: 'T', buttons: [] } })!.modal!.buttons, [], '[]: no buttons, the ✕ only')
  assert.equal(sayOf({ modal: { ui: { type: 'stat', value: '1' } } })!.modal!.title, '', 'a ui alone is a dialog')
  assert.deepEqual(sayOf({ close: true }), { close: true })
  assert.deepEqual(sayOf({ close: 'deploy', modal: { id: 'next', title: 'Next' } }), { close: 'deploy', modal: { id: 'next', title: 'Next', buttons: [{ label: 'OK', style: 'primary' }] } }, 'a close and a modal together')
  assert.equal(sayOf({ close: false }), null)
  assert.match(pageOf('', {}), /toast: text => say/)
  assert.match(pageOf('', {}), /close: id => say\(\{ laki: 'say', close: id === undefined \? true : String\(id\) \}\)/)
})

test('widget templates: values escaped, each, if, unless, helpers, views', () => {
  const ctx = { data: { prs: [{ n: 1, t: '<b>a</b>' }, { n: 2, t: 'b & c' }], none: [], who: { name: 'x' } }, config: { repo: 'o/r' }, at: 0 }
  assert.equal(render('{{config.repo}} {{ data.who.name }} {{data.prs.length}}', ctx), 'o/r x 2')
  assert.equal(render('{{#each data.prs}}[{{@index}}:{{n}} {{t}} {{config.repo}}]{{/each}}', ctx), '[0:1 &lt;b&gt;a&lt;/b&gt; o/r][1:2 b &amp; c o/r]')
  assert.equal(render('{{#each data.none}}x{{else}}none{{/each}}', ctx), 'none')
  assert.equal(render('{{#if data.none}}y{{else}}n{{/if}}{{#unless data.prs}}u{{/unless}}{{#if at}}a{{/if}}', ctx), 'n')
  assert.equal(render('{{#each data.prs}}{{#if n}}{{this.n}}{{/if}}{{/each}}', ctx), '12')
  assert.equal(render('{{missing.deep.path}}|{{constructor}}|{{data.prs.toString}}', ctx), '||', 'only own fields')
  assert.equal(render('{{date d}}', { d: '2026-09-02T10:00:00Z' }), 'Sep 2, 2026')
  assert.equal(ago(Date.now() - 3 * 3600_000), '3 hours ago')
  assert.match(render('{{spark h}}', { h: [3, 5, 4] }), /^<svg class="spark".*points="0.0,28.0 50.0,2.0 100.0,15.0"/)
  assert.equal(spark(['x']), '')
  assert.throws(() => render('{{#each a}}x', {}), /isn't closed/)
  assert.throws(() => render('{{#if a}}x{{/each}}', {}), /doesn't close/)
  assert.throws(() => render('{{#foo a}}x{{/foo}}', {}), /no block/)

  const html = '<style>s</style><template preview>P</template>\n<template full>F</template>'
  assert.equal(viewOf(html, false), '<style>s</style>\nP')
  assert.equal(viewOf(html, true), '<style>s</style>\nF')
  assert.equal(viewOf('<template preview>P</template>', true), undefined, 'no full view')
  assert.equal(viewOf('just this', false), 'just this')
  const nested = '<template full><template id="row"><tr></tr></template><table></table><script>x</script></template><template preview>P</template>'
  assert.equal(viewOf(nested, true), '<template id="row"><tr></tr></template><table></table><script>x</script>')
  assert.equal(viewOf(nested, false), 'P')
  assert.equal(viewOf('<template preview>open', false), 'open', 'unclosed: to the end')
  assert.ok(hasFull(html) && !hasFull('<template preview>P</template>'))
  assert.ok(hasScript('<script>x</script>') && !hasScript('<b>scripts</b>'))

  // a JS page: its data can't end the script; theme values can't end the style
  const page = pageOf('<p>hi</p>', { data: { t: '</script><script>alert(1)</script>' } }, { '--accent': '#fff', '--x': 'red} body{color:red', 'bad key': '1', 'color-scheme': 'dark' })
  assert.doesNotMatch(page, /<\/script><script>alert/)
  assert.match(page, /:root \{ --accent: #fff; color-scheme: dark; \}/)
  assert.doesNotMatch(page, /--x|bad key/)
})

// a widget in Laki's own folder: widget.json, widget.html and any other file
function widget(rig: Rig, id: string, json: object, html = '{{data}}', files: Record<string, string> = {}) {
  const d = join(rig.data, 'widgets', id)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify(json))
  writeFileSync(join(d, 'widget.html'), html)
  for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t)
  return d
}
const find = async (rig: Rig, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)

test('widgets: found in folders, fetched on schedule into storage, rendered, set, reloaded', async t => {
  const rig = await fresh(t)
  // the ones Laki comes with: listed, off
  let v = await rig.rpc('state')
  const builtin = v.widgets.find((w: any) => w.id === 'my-prs')
  assert.ok(builtin?.builtin && !builtin.on && builtin.full && builtin.every === 5)
  assert.deepEqual(builtin.config, { repo: '', author: '@me', label1: '', label2: '', label3: '', only: '', hide: '' })
  assert.deepEqual(
    builtin.options.map((o: any) => [o.key, o.type, o.label]),
    [
      ['repo', 'text', 'Repo'],
      ['author', 'text', 'Author'],
      ['label1', 'text', 'Count label 1'],
      ['label2', 'text', 'Count label 2'],
      ['label3', 'text', 'Count label 3'],
      ['only', 'list', 'Only with labels'],
      ['hide', 'list', 'Hide with labels'],
    ],
  )
  assert.deepEqual(builtin.size, [4, 1])
  assert.equal(builtin.view, 'l')
  assert.equal(v.widgetHome, join(rig.data, 'widgets'))

  widget(
    rig,
    'hello',
    { name: 'Hello', size: [5, 0], every: 2, config: { who: 'world', bad_key: 'x' }, fetch: 'echo "{\\"who\\": \\"$WIDGET_WHO\\", \\"n\\": $(date +%s)}"' },
    '<style>.x{}</style><template preview>hi {{data.who}}</template><template full>{{config.who}} full</template>',
  )
  assert.equal(await find(rig, 'hello'), undefined, 'not before a reload')
  await rig.rpc('widgetReload')
  assert.equal((await find(rig, 'hello')).on, false, 'every extension starts off')
  await rig.rpc('widgetSet', { id: 'hello', on: true })
  let w = await until(() => find(rig, 'hello').then(w => w?.at && w), 'the first fetch')
  assert.equal(w.on, true)
  assert.deepEqual(w.size, [4, 1], 'clamped to the grid')
  assert.equal(w.error, undefined)
  assert.equal(await rig.rpc('widgetRender', { id: 'hello' }), '<style>.x{}</style>hi world')
  assert.equal(await rig.rpc('widgetRender', { id: 'hello', full: true }), '<style>.x{}</style>world full')
  const store = JSON.parse(readFileSync(join(rig.data, 'widget-data', 'hello.json'), 'utf8'))
  assert.equal(store.data.who, 'world')

  // config: kept in its storage, given to the fetch, which runs again; a value is escaped where it's shown
  await rig.rpc('widgetSet', { id: 'hello', config: { who: '<i>you</i>', nope: 'x' }, size: [2, 2], every: 0 })
  w = await until(() => find(rig, 'hello').then(w => !w.running && w.config.who === '<i>you</i>' && w), 'set')
  assert.deepEqual(w.config, { who: '<i>you</i>', bad_key: 'x' })
  assert.deepEqual(w.size, [2, 2])
  assert.equal(w.every, 1, 'at least a minute')
  await until(async () => (await rig.rpc('widgetRender', { id: 'hello' })).includes('&lt;i&gt;you&lt;/i&gt;'), 'refetched with the new config')

  // the schedule: only while the app is open; not due yet, then due
  const at = (await find(rig, 'hello')).at
  await rig.rpc('widgetTick', { now: at + 61_000 })
  assert.equal((await find(rig, 'hello')).at, at, 'no app: no fetch')
  const app = await rig.connect()
  t.after(() => app.ws.close())
  await rig.rpc('widgetTick', { now: at + 30_000 })
  assert.equal((await find(rig, 'hello')).at, at)
  await app.call('view', { tab: null, focused: false, shown: false }) // the window closed: only hidden
  await rig.rpc('widgetTick', { now: at + 61_000 })
  assert.equal((await find(rig, 'hello')).at, at, 'a hidden window: no fetch')
  await app.call('view', { tab: null, focused: true, shown: true }) // shown again (it ticks then too, at the real time)
  await rig.rpc('widgetTick', { now: at + 61_000 })
  await until(() => find(rig, 'hello').then(w => w.at > at), 'a due fetch')

  // a failing fetch keeps the last data and says why; off: no more fetches
  writeFileSync(join(rig.data, 'widgets', 'hello', 'widget.json'), JSON.stringify({ name: 'Hello', fetch: 'echo oops >&2; exit 3', config: { who: '' } }))
  await rig.rpc('widgetReload')
  w = await until(() => find(rig, 'hello').then(w => w.error && w), 'the failure')
  assert.equal(w.error, 'oops')
  assert.match(await rig.rpc('widgetRender', { id: 'hello' }), /&lt;i&gt;you/, 'the last data stays')
  writeFileSync(join(rig.data, 'widgets', 'hello', 'widget.json'), JSON.stringify({ fetch: 'echo not json' }))
  await rig.rpc('widgetReload')
  await until(() => find(rig, 'hello').then(w => w.error === 'fetch printed no JSON: not json'), 'no JSON')
  await rig.rpc('widgetSet', { id: 'hello', on: false })
  const off = (await find(rig, 'hello')).at
  await rig.rpc('widgetTick', { now: Date.now() + 86_400_000 })
  assert.equal((await find(rig, 'hello')).at, off)

  // another folder, from Settings: a folder of widgets, or a widget's own; Laki's own wins an id
  const extra = join(rig.home, 'more')
  mkdirSync(join(extra, 'one'), { recursive: true })
  writeFileSync(join(extra, 'one', 'widget.json'), '{"name":"One"}')
  writeFileSync(join(extra, 'one', 'widget.html'), 'one')
  await rig.rpc('settingsSet', { widgetDirs: ['', ` ${extra} `] })
  v = await rig.rpc('state')
  assert.deepEqual(
    v.widgets.filter((w: any) => !w.builtin).map((w: any) => [w.id, w.every]),
    [
      ['hello', 1],
      ['one', undefined],
    ],
  )
  await assert.rejects(rig.rpc('widgetRender', { id: 'nope' }), /no widget nope/)

  const r = await rig.cli('widget', 'ls')
  assert.match(r.out, /^hello {2}off/m)
  assert.equal((await rig.cli('widget', 'render', 'one')).out.trim(), 'one')

  // its folder, in an app
  await rig.rpc('openIn', { widget: 'one', app: 'finder' })
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), new RegExp(`open ${join(extra, 'one')}$`, 'm'))
})

test('widgets: typed settings, the size of the full view', async t => {
  const rig = await fresh(t)
  widget(
    rig,
    'typed',
    {
      name: 'Typed',
      view: 's',
      config: {
        repo: { label: 'Repo', hint: 'owner/name' },
        flag: { type: 'bool', default: true },
        n: 3,
        tags: { type: 'list', default: ['a', 'b'] },
        pick: { type: 'choice', choices: ['x', 'y'], default: 'y' },
        loose: false,
      },
      fetch: 'printf \'{"env": "%s|%s|%s|%s|%s"}\' "$WIDGET_FLAG" "$WIDGET_N" "$WIDGET_TAGS" "$WIDGET_PICK" "$WIDGET_LOOSE"',
    },
    '{{#if config.flag}}on{{/if}} {{config.tags.length}} {{config.n}} {{#unless config.loose}}tight{{/unless}} [{{data.env}}]',
  )
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'typed', on: true })
  let w = await until(() => find(rig, 'typed').then(w => w?.at && !w.running && w), 'fetched')
  assert.deepEqual(w.config, { repo: '', flag: '1', n: '3', tags: 'a,b', pick: 'y', loose: '' })
  assert.deepEqual(
    w.options.map((o: any) => [o.key, o.type]),
    [
      ['repo', 'text'],
      ['flag', 'bool'],
      ['n', 'number'],
      ['tags', 'list'],
      ['pick', 'choice'],
      ['loose', 'bool'],
    ],
  )
  assert.deepEqual(w.options[0], { key: 'repo', type: 'text', label: 'Repo', hint: 'owner/name' })
  assert.deepEqual(w.options[4].choices, ['x', 'y'])
  assert.equal(w.view, 's')
  assert.equal(await rig.rpc('widgetRender', { id: 'typed' }), 'on 2 3 tight [1|3|a,b|y|]', 'typed for the page, text for the fetch')

  // set: each made what its kind takes
  await rig.rpc('widgetSet', { id: 'typed', config: { flag: '', n: 'many', tags: ' c ,\n d ,, ', pick: 'z', loose: 'true' }, view: 'l' })
  w = await until(() => find(rig, 'typed').then(w => !w.running && w.config.tags === 'c,d' && w), 'set')
  assert.deepEqual(w.config, { repo: '', flag: '', n: '', tags: 'c,d', pick: 'x', loose: '1' })
  assert.equal(w.view, 'l')
  await until(async () => (await rig.rpc('widgetRender', { id: 'typed' })) === ' 2   [||c,d|x|1]', 'refetched')
  // settings changed while it fetches: fetched again with them
  await rig.rpc('widgetSet', { id: 'typed', config: { pick: 'y' } })
  await rig.rpc('widgetSet', { id: 'typed', config: { pick: 'x', tags: 'z, z' } })
  await until(async () => (await rig.rpc('widgetRender', { id: 'typed' })).endsWith('[||z|x|1]'), 'the last settings fetched')
  await rig.rpc('widgetSet', { id: 'typed', view: 'huge' })
  assert.equal((await find(rig, 'typed')).view, 's', "back to widget.json's")
})

test('widgets: a JS fetch script, a JS page served sandboxed, actions', async t => {
  const rig = await fresh(t)
  widget(
    rig,
    'js',
    { name: 'JS', script: 'fetch.mjs', config: { step: '2' }, actions: { say: 'echo "got $WIDGET_ARG" > said.txt; echo said it', ls: '"$LAKI_CLI" ls --json | head -c 1', fail: 'exit 1', logged: `echo working; echo '{"toast":"after a log line"}'`, tell: `echo '{"toast":"started","modal":{"title":"Done","buttons":[{"label":"Bad","open":"javascript:alert(1)"},{"label":"Again","run":"say","arg":"x"}]}}'`, shut: `echo '{"close":"deploy"}'` } },
    '<template preview><b id="n"></b><script>document.getElementById("n").textContent = laki.data.n</script></template>',
    { 'fetch.mjs': 'export default ({ config, last }) => ({ n: (last?.n ?? 0) + Number(config.step), end: "</script>" })' },
  )
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'js', on: true })
  await until(() => find(rig, 'js').then(w => w?.at), 'the first run')
  await rig.rpc('widgetRun', { id: 'js' })
  const w = await find(rig, 'js')
  assert.equal(w.js, true)
  assert.equal(w.error, undefined)

  // its page: only with the key, sandboxed, no requests out
  const { port } = rig.info()
  const v = await rig.rpc('state')
  let res = await fetch(`http://127.0.0.1:${port}/widget/js?key=nope`)
  assert.equal(res.status, 401)
  const jsKey = v.widgets.find((x: any) => x.id === 'js').key // its own key
  res = await fetch(`http://127.0.0.1:${port}/widget/js?key=${jsKey}&theme=${encodeURIComponent('{"--accent":"#123456"}')}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy') ?? '', /^sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:$/)
  assert.equal((await fetch(`http://127.0.0.1:${port}/widget/js?key=${'é'.repeat(32)}`)).status, 401, 'a key of other bytes')
  const page = await res.text()
  assert.match(page, /"n":4/, 'its default export got the last data')
  assert.match(page, /--accent: #123456;/)
  assert.doesNotMatch(page, /"<\/script>"/)
  assert.equal((await fetch(`http://127.0.0.1:${port}/widget/js?key=${jsKey}&full=1`)).status, 404, 'no full view')

  // actions: the arg as $WIDGET_ARG, never in the command; the laki CLI as $LAKI_CLI
  const arg = `x'; touch hacked; echo '`
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'say', arg }), { ok: true, out: 'said it' })
  const dir = join(rig.data, 'widgets', 'js')
  assert.equal(readFileSync(join(dir, 'said.txt'), 'utf8'), `got ${arg}\n`)
  assert.ok(!existsSync(join(dir, 'hacked')))
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'ls' }), { ok: true, out: '{' })
  assert.equal((await rig.rpc('widgetAction', { id: 'js', action: 'fail' })).ok, false)
  // what an action prints as JSON with toast or modal: what the app shows, links only http(s), mailto, laki://
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'logged' }), { ok: true, toast: 'after a log line' }, 'JSON on the last line')
  assert.equal((await rig.cli('widget', 'action', 'js', 'logged')).out.trim(), 'after a log line', 'the CLI says what the app would')
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'tell' }), { ok: true, toast: 'started', modal: { title: 'Done', buttons: [{ label: 'Bad' }, { label: 'Again', run: 'say', arg: 'x' }] } })
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'shut' }), { ok: true, close: 'deploy' }, 'a close alone')
  assert.match((await rig.rpc('widgetAction', { id: 'js', action: 'constructor' })).error, /has no action constructor/)

  // a script that throws: its message, not node's trailer
  await until(() => find(rig, 'js').then(w => !w.running), 'the fetch after the actions')
  writeFileSync(join(dir, 'fetch.mjs'), 'export default () => { throw new Error("Set Repo in Settings") }')
  assert.deepEqual(await rig.rpc('widgetRun', { id: 'js' }), { ok: false, error: 'Set Repo in Settings' })
  writeFileSync(join(dir, 'fetch.mjs'), 'export default () => { null.x }')
  assert.match((await rig.rpc('widgetRun', { id: 'js' })).error, /^Cannot read properties of null/)
})

test('widgets that come with Laki: My PRs, Links', async t => {
  const rig = await fresh(t)
  mkdirSync(rig.env.FAKE_GH, { recursive: true })
  const pr = (number: number, login: string, mergeable: string, o: object = {}) => ({
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author: { login },
    createdAt: '2026-09-02T10:00:00Z',
    isDraft: false,
    labels: [{ name: 'bug', color: 'd73a4a', id: 'x' }],
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable,
    statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...o,
  })
  writeFileSync(
    join(rig.env.FAKE_GH, 'prlist.json'),
    JSON.stringify([
      pr(1, 'alice', 'CONFLICTING', { reviewDecision: 'APPROVED', statusCheckRollup: [{ state: 'FAILURE' }, { conclusion: 'SUCCESS' }] }),
      pr(2, 'bob', 'MERGEABLE', { statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] }),
      pr(3, 'carol', 'MERGEABLE', { isDraft: true, statusCheckRollup: [] }),
    ]),
  )
  // no repo: says so
  const turned = await rig.rpc('widgetSet', { id: 'my-prs', on: true })
  assert.deepEqual(turned.missing, ['repo'], 'Repo is required: the app opens it there, its cell says Set Repo')
  assert.equal(turned.options.find((o: any) => o.key === 'repo').required, true)
  assert.match((await until(() => find(rig, 'my-prs').then(w => !w.running && w.error && w), 'no repo')).error, /Set Repo \(owner\/name\) in Settings › Extensions › My PRs/)
  const mine = async (config: object) => {
    await rig.rpc('widgetSet', { id: 'my-prs', config })
    await until(() => find(rig, 'my-prs').then(w => !w.running), 'refetched')
    const r = await rig.rpc('widgetRun', { id: 'my-prs' })
    assert.ok(r.ok, r.error)
    const d = JSON.parse(readFileSync(join(rig.data, 'widget-data', 'my-prs.json'), 'utf8')).data
    return { stats: Object.fromEntries(d.stats.map((x: any) => [x.name, x.n])), groups: d.groups.map((g: any) => [g.name, g.prs.map((p: any) => p.number)]), d }
  }
  let my = await mine({ repo: 'https://github.com/o/r/' }) // a link works too
  assert.equal((await find(rig, 'my-prs')).missing, undefined, 'set: nothing missing')
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh pr list --repo o\/r --author @me --state open/)
  // the counts, and each PR in the group of what it needs most
  assert.deepEqual(my.stats, { open: 3, drafts: 1, conflicts: 1 })
  assert.deepEqual(my.groups, [['Conflicts', [1]], ['In review', [2]], ['Drafts', [3]]])
  assert.deepEqual(my.d.groups[0].prs[0], { number: 1, title: 'PR 1', url: 'https://github.com/o/r/pull/1', createdAt: '2026-09-02T10:00:00Z', draft: false, author: 'alice', labels: [{ name: 'bug', color: 'd73a4a' }], ci: 'failing', approved: true, changes: false, conflict: true, group: 'conflict' })
  const tile = await rig.rpc('widgetRender', { id: 'my-prs' })
  assert.match(tile, /<div class="k-stat" title="3 open"><div class="k-v">3<\/div><div class="k-l">open<\/div>/)
  assert.match(tile, /<div class="k-stat t-bad" title="1 conflicts"><div class="k-v">1<\/div><div class="k-l">conflicts<\/div>/)
  const full = await rig.rpc('widgetRender', { id: 'my-prs', full: true })
  assert.match(full, /<div class="k-sh">Conflicts<span class="k-sub">1<\/span>/)
  assert.match(full, /data-open="https:\/\/github.com\/o\/r\/pull\/1"><img class="k-av" src="https:\/\/avatars.githubusercontent.com\/alice\?s=40" alt=""><div class="k-main"><div class="k-title ">#1 PR 1<\/div>/, 'a row: its avatar, opens the PR')
  assert.doesNotMatch(full.split('#1 PR 1')[1].split('data-row')[0], />conflict</, 'its group says conflicts: no tag (a draft gets one)')
  assert.match(full, /border-color:#d73a4a">bug</)
  assert.match(full, /<span class="t-bad">failing<\/span>/)
  assert.match(full, /<span class="t-good">✓ approved<\/span>/)
  assert.match(full, /opened Sep 2, 2026/)
  assert.match(full, /data-open="https:\/\/github.com\/o\/r\/pull\/1"><span>Open<\/span>/, 'an Open button')
  // up to 3 labels counted, any case, with their color
  my = await mine({ label1: ' BUG ', label3: 'docs' })
  assert.deepEqual(my.d.stats.slice(3), [{ name: 'BUG', n: 3, color: 'd73a4a' }, { name: 'docs', n: 0, color: '' }])
  assert.match(await rig.rpc('widgetRender', { id: 'my-prs' }), /<div class="k-v">3<\/div><div class="k-l"><i class="k-dotc" style="background:#d73a4a"><\/i>BUG<\/div>/)
  // someone else's: their login (an @ before it is fine)
  await mine({ author: '@carol' })
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh pr list --repo o\/r --author carol --state open/)
  my = await mine({ author: '' }) // empty: you
  assert.equal(my.stats.open, 3)
  // labels: only with any of these, none of those
  assert.equal((await mine({ only: 'BUG,docs' })).stats.open, 3)
  assert.equal((await mine({ only: 'docs' })).stats.open, 0)
  assert.deepEqual((await mine({ only: '', hide: 'bug' })).groups, [])
  assert.match(await rig.rpc('widgetRender', { id: 'my-prs', full: true }), /No open PRs/)
  await mine({ hide: '' })

  const { port } = rig.info()
  // Links: no fetch, its chips from the settings
  const links = (await rig.rpc('state')).widgets.find((w: { id: string }) => w.id === 'links')
  assert.equal(links.every, undefined)
  await rig.rpc('widgetSet', { id: 'links', on: true, config: { links: 'Lunch: https://food.example/order,https://linear.app' } })
  assert.match(await (await fetch(`http://127.0.0.1:${port}/widget/links?key=${(await rig.rpc('state')).widgets.find((w: { id: string }) => w.id === 'links').key}`)).text(), /"links":\["Lunch: https:\/\/food.example\/order","https:\/\/linear.app"\]/)
})

test('widget sizes: half a cell down is kept (a thin line), other fractions round; Links comes as one', async t => {
  const rig = await fresh(t)
  const links = async () => (await rig.rpc('state')).widgets.find((w: { id: string }) => w.id === 'links')
  assert.deepEqual((await links()).size, [4, 0.5], 'Links: a line across')
  await rig.rpc('widgetSet', { id: 'links', size: [2, 0.7] })
  assert.deepEqual((await links()).size, [2, 1])
  await rig.rpc('widgetSet', { id: 'links', size: [1, 0.5] })
  assert.deepEqual((await links()).size, [1, 0.5])
  await rig.rpc('widgetSet', { id: 'links', size: [9, 0] })
  assert.deepEqual((await links()).size, [4, 1], 'clamped to the grid')
})

test('extensions Laki AI writes: in its own folder only, saved off, read back; never over another folder’s', async t => {
  const rig = await fresh(t)
  const json = JSON.stringify({ name: 'NY clock', fetch: 'echo "{\\"t\\": 1}"', every: 1, sample: { t: 7 } })
  await assert.rejects(rig.rpc('widgetWrite', { id: 'ny', files: { 'widget.json': JSON.stringify({ name: 'NY clock', fetch: 'date' }) } }), /a sample too/, 'a fetch without made-up data for its preview')
  await assert.rejects(rig.rpc('widgetWrite', { id: 'My Clock', files: { 'widget.json': json } }), /an id/)
  await assert.rejects(rig.rpc('widgetWrite', { id: 'ny', files: { '../x.sh': 'x' } }), /no folders/)
  await assert.rejects(rig.rpc('widgetWrite', { id: 'ny', files: { 'widget.html': 'x' } }), /needs widget.json/)
  await assert.rejects(rig.rpc('widgetWrite', { id: 'ny', files: { 'widget.json': '{nope' } }), /widget.json/)
  await assert.rejects(rig.rpc('widgetWrite', { id: 'my-prs', files: { 'widget.json': json } }), /comes with Laki/)
  const w = await rig.rpc('widgetWrite', { id: 'ny', files: { 'widget.json': json, 'widget.html': '<template preview>{{data.t}}</template>', 'fetch.sh': '#!/bin/sh\necho "{}"' } })
  assert.deepEqual([w.id, w.on, w.byAi, w.every], ['ny', false, true, 1], 'saved off')
  assert.equal(w.sample, true)
  assert.equal(await rig.rpc('widgetRender', { id: 'ny', sample: true }), '7', 'its preview: the sample, never fetched')
  assert.equal(await rig.rpc('widgetRender', { id: 'ny' }), '', 'live: nothing yet')
  const dir = join(rig.data, 'widgets', 'ny')
  assert.equal(readFileSync(join(dir, 'widget.html'), 'utf8'), '<template preview>{{data.t}}</template>')
  assert.ok(statSync(join(dir, 'fetch.sh')).mode & 0o100, 'a script with #! runs')
  await rig.rpc('widgetSet', { id: 'ny', on: true })
  await rig.rpc('widgetWrite', { id: 'ny', files: { 'widget.html': '<template preview>new</template>' } })
  assert.equal((await find(rig, 'ny')).on, false, 'a change turns it off again')
  assert.deepEqual(Object.keys((await rig.rpc('widgetFiles', { id: 'ny' })).files).sort(), ['fetch.sh', 'widget.html', 'widget.json'], 'files left out stay')
  assert.match((await rig.rpc('widgetFiles', { id: 'links' })).files['widget.json'], /"name"/, 'an example that comes with Laki')
  await assert.rejects(rig.rpc('widgetWrite', { id: 'ny', files: ['x'] }), /1 to 20 files/)
  mkdirSync(join(rig.data, 'widgets', 'mine'))
  writeFileSync(join(rig.data, 'widgets', 'mine', 'widget.json'), json)
  await assert.rejects(rig.rpc('widgetWrite', { id: 'mine', files: { 'widget.json': json } }), /the user's own/)
  // Edit with Laki AI: rewrites for its hour (a write, a check, a fix), then it's theirs again
  await rig.rpc('widgetReload')
  await assert.rejects(rig.rpc('widgetSet', { id: 'links', ai: true }), /Laki's folder/, 'one that comes with Laki: never')
  await rig.rpc('widgetSet', { id: 'mine', ai: true })
  await rig.rpc('widgetWrite', { id: 'mine', files: { 'widget.html': '<template preview>new</template>' } })
  await rig.rpc('widgetWrite', { id: 'mine', files: { 'widget.html': '<template preview>fixed</template>' } })
  assert.ok(!(await find(rig, 'mine')).byAi, 'still theirs')
  const store = join(rig.data, 'widget-data', 'mine.json')
  writeFileSync(store, JSON.stringify({ ...JSON.parse(readFileSync(store, 'utf8')), aiMay: Date.now() - 2 * 3600_000 }))
  await assert.rejects(rig.rpc('widgetWrite', { id: 'mine', files: { 'widget.html': 'again' } }), /the user's own/, 'the leave ran out')
})

test('extensions: a place (sidebar, top bar, status bar), network access for a JS page, deleted', async t => {
  const rig = await fresh(t)
  widget(rig, 'net', { name: 'Net', place: 'status' }, '<template preview><script>1</script></template>', {})
  widget(rig, 'plain', { name: 'Plain', place: 'nowhere' }, '<template preview>hi</template>', {})
  await rig.rpc('widgetReload')
  assert.equal((await find(rig, 'net')).place, 'status', "widget.json's place")
  assert.equal((await find(rig, 'plain')).place, 'side', 'one it does not know: the sidebar')
  await rig.rpc('widgetSet', { id: 'plain', place: 'top' })
  assert.equal((await find(rig, 'plain')).place, 'top', "the user's wins")
  await assert.rejects(rig.rpc('widgetSet', { id: 'plain', place: 'bogus' }), /no place bogus/, 'a typo is said, not widget.json\'s again')
  assert.equal((await find(rig, 'plain')).place, 'top')
  await rig.rpc('widgetSet', { id: 'plain', place: [] })
  assert.equal((await find(rig, 'plain')).place, 'side', "none: widget.json's (one it doesn't know: the sidebar)")

  // network: off until the user turns it on, and only a JS page's CSP opens, to https
  const { port } = rig.info()
  const key = (await find(rig, 'net')).key
  const csp = async () => (await fetch(`http://127.0.0.1:${port}/widget/net?key=${key}`)).headers.get('content-security-policy') ?? ''
  assert.equal((await find(rig, 'net')).net, undefined)
  assert.doesNotMatch(await csp(), /connect-src/)
  await rig.rpc('widgetSet', { id: 'net', net: true })
  assert.equal((await find(rig, 'net')).net, true)
  assert.match(await csp(), /connect-src https:; img-src data: https:/)
  await rig.rpc('widgetSet', { id: 'plain', net: true })
  assert.equal((await find(rig, 'plain')).net, undefined, 'a template widget has no page of its own')

  // delete: its folder and its storage go; one that comes with Laki only turns off
  await assert.rejects(rig.rpc('widgetRm', { id: 'links' }), /comes with Laki/)
  const dir = join(rig.data, 'widgets', 'net')
  assert.ok(existsSync(join(rig.data, 'widget-data', 'net.json')))
  assert.equal((await rig.rpc('widgetRm', { id: 'net' })).deleted, 'net')
  assert.ok(!existsSync(dir) && !existsSync(join(rig.data, 'widget-data', 'net.json')))
  assert.equal(await find(rig, 'net'), undefined)
  await assert.rejects(rig.rpc('widgetRm', { id: 'net' }), /no widget net/)
})

test('extensions as buttons: the rail and the foot, an icon, a label, a badge and a tip from the data, a click', async t => {
  const rig = await fresh(t)
  const btn = { name: 'My PRs', place: 'rail', icon: 'pr', label: '{{open}} open', badge: '{{#if open}}{{open}}{{/if}}', tip: 'yours: <b>{{open}}</b> & more', fetch: 'echo "{\\"open\\": $(cat n)}"', click: 'bump', actions: { bump: 'echo $(( $(cat n) + 1 )) > n' } }
  widget(rig, 'prs', btn, '', { n: '3' }) // no preview: a button wherever it is
  widget(rig, 'page', { name: 'Page', place: 'foot', icon: '👨‍👩‍👧', click: 'nope' }, '<template preview>hi</template>')
  widget(rig, 'cell', { name: 'cell', icon: 'not-an-icon!' }, '<template preview>hi</template>')
  await rig.rpc('widgetReload')
  for (const id of ['prs', 'page', 'cell']) await rig.rpc('widgetSet', { id, on: true })
  const prs = await until(async () => (w => w?.at && w)(await find(rig, 'prs')), 'fetched')
  assert.deepEqual([prs.place, prs.button, prs.icon, prs.label, prs.badge, prs.tip, prs.click], ['rail', true, 'pr', '3 open', '3', 'yours: 3 & more', 'bump'])
  const page = await find(rig, 'page')
  assert.deepEqual([page.place, page.button, page.icon, page.click, page.label], ['foot', true, '👨‍👩‍👧', undefined, undefined]) // an emoji of a few, one character; a click that isn't one of its actions: none
  const cell = await find(rig, 'cell')
  assert.deepEqual([cell.place, cell.button, cell.icon], ['side', undefined, undefined]) // a preview in the grid; an icon that's neither: none
  // the click's action, then a fetch: the label follows the data
  assert.equal((await rig.rpc('widgetAction', { id: 'prs', action: 'bump' })).ok, true)
  await until(async () => (await find(rig, 'prs')).label === '4 open', 'its label after the click')
  await rig.rpc('widgetSet', { id: 'cell', place: 'foot' })
  assert.equal((await find(rig, 'cell')).button, true, 'in the foot: a button')
})

test('Reset the interface: every setting at its default but what you set up, the experimental ones too; every extension off', async t => {
  const rig = await fresh(t)
  widget(rig, 'mine', { name: 'Mine', fetch: 'echo "{}"' }, '<template preview>hi</template>')
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'mine', on: true, place: 'top' })
  await rig.rpc('settingsSet', { theme: 'dawn', railLabels: false, workflows: true, specs: true, birdView: true, aiGlow: true, ownAvatar: false, editor: 'zed', env: { A: '1' }, webhook: { url: 'https://ntfy.sh/x' }, branchPrefix: 'me/', voice: { on: false, model: 'm' }, achievements: { got: { board: 1 }, hidden: ['race'] } })
  const s = await rig.rpc('uiReset')
  assert.deepEqual(s, { editor: 'zed', env: { A: '1' }, webhook: { url: 'https://ntfy.sh/x' }, voice: { on: false, model: 'm' }, achievements: { got: { board: 1 }, hidden: ['race'] } }, 'voice kept as you set it, like Laki AI; achievements too')
  assert.deepEqual((await rig.rpc('state')).settings, s, 'kept, and the view says so')
  const w = await find(rig, 'mine')
  assert.deepEqual([w.on, w.place], [false, 'top'], 'off, its other choices kept')
})

test('extensions: a secret setting reaches its fetch only, never the view, a render, a page, ls or the Env; an old value moves; a remix has none', async t => {
  const rig = await fresh(t)
  const SECRET = 'sk-live-very-secret-42'
  widget(rig, 'sec', { name: 'Sec', config: { apiToken: { type: 'secret', label: 'API token' }, repo: 'o/r' }, fetch: 'printf \'%s|%s\' "$WIDGET_APITOKEN" "$LAKI_WIDGET_CONFIG" > seen.txt; echo \'{"n": 1}\'' }, '<template preview>[{{config.apiToken}}]<script>1</script></template>')
  // an older version kept it as text: it moves to the secrets file at the scan, gone from the store
  mkdirSync(join(rig.data, 'widget-data'), { recursive: true })
  writeFileSync(join(rig.data, 'widget-data', 'sec.json'), JSON.stringify({ on: true, config: { apiToken: 'old-plain-value', repo: 'a/b' } }))
  await rig.rpc('widgetReload')
  const store = () => readFileSync(join(rig.data, 'widget-data', 'sec.json'), 'utf8')
  const secrets = join(rig.data, 'widget-secrets.json')
  assert.doesNotMatch(store(), /old-plain-value/)
  assert.deepEqual(JSON.parse(readFileSync(secrets, 'utf8')), { sec: { apiToken: 'old-plain-value' } })
  assert.equal(statSync(secrets).mode & 0o777, 0o600)
  let w = await find(rig, 'sec')
  assert.equal(w.config.apiToken, '')
  assert.equal(w.config.repo, 'a/b', 'the others stay')
  assert.deepEqual(w.options[0], { key: 'apiToken', type: 'secret', label: 'API token', set: true })

  // set: replaced; the fetch sees it, in $WIDGET_<NAME> and $LAKI_WIDGET_CONFIG
  await rig.rpc('widgetSet', { id: 'sec', config: { apiToken: SECRET } })
  const seen = join(rig.data, 'widgets', 'sec', 'seen.txt')
  await until(() => existsSync(seen) && readFileSync(seen, 'utf8').startsWith(SECRET), 'fetched with it')
  assert.equal(JSON.parse(readFileSync(seen, 'utf8').split('|')[1]).apiToken, SECRET)
  assert.doesNotMatch(store(), new RegExp(SECRET))
  w = await find(rig, 'sec')
  assert.equal(w.config.apiToken, '')
  // never: the view, a render, a JS page's config, ls --json, the inspector's Env
  const { port } = rig.info()
  const v = await rig.rpc('state')
  const never = (what: string, text: string) => assert.ok(!text.includes(SECRET) && !text.includes('old-plain-value'), `${what} has it`)
  never('the view', JSON.stringify(v.widgets.find((x: any) => x.id === 'sec').config))
  never('a render', String(await rig.rpc('widgetRender', { id: 'sec' })))
  never('its page', await (await fetch(`http://127.0.0.1:${port}/widget/sec?key=${v.widgets.find((x: any) => x.id === 'sec').key}`)).text())
  never('ls --json', (await rig.cli('ls', '--json')).out)
  const env = (await rig.rpc('widgetRuns', { id: 'sec' })).env
  never('Env', JSON.stringify(env))
  assert.equal(env.WIDGET_APITOKEN, '••••')
  // '' clears it
  await rig.rpc('widgetSet', { id: 'sec', config: { apiToken: '' } })
  assert.equal((await find(rig, 'sec')).options[0].set, undefined)
  assert.deepEqual(JSON.parse(readFileSync(secrets, 'utf8')), {})

  // a remix has no secret
  await rig.rpc('widgetSet', { id: 'sec', config: { apiToken: SECRET } })
  const { id } = await rig.rpc('widgetRemix', { id: 'sec' })
  assert.equal((await find(rig, id)).options[0].set, undefined)
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(secrets, 'utf8'))), ['sec'])

  // the checker: a key kept as text
  widget(rig, 'plain-token', { name: 'P', config: { apiToken: '', other: { type: 'text', default: 'x' } } })
  await rig.rpc('widgetReload')
  const ps = (await rig.rpc('widgetCheck', { id: 'plain-token' })).problems
  assert.ok(ps.some((p: any) => p.level === 'warn' && p.where === 'widget.json config.apiToken' && /make it "type": "secret"/.test(p.text)), JSON.stringify(ps))
  assert.ok(!ps.some((p: any) => p.where === 'widget.json config.other'))
})

test('extensions: Delete moves to the trash, Undo puts back folder, link and one file with their store, instances, history, chat and secret', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'none', name: 'one' })
  // a folder of Laki's, with a secret, an instance, a history and a chat
  const d = widget(rig, 'del', { name: 'Del', scope: 'workspace', config: { token: { type: 'secret' } }, fetch: 'echo \'{"n": 2}\'' }, '{{n}} {{workspace.branch}}', { 'x.sh': 'echo x\n' })
  // a linked folder (another root), and a one-file extension
  const real = join(rig.home, 'real-ext')
  mkdirSync(real)
  writeFileSync(join(real, 'widget.json'), JSON.stringify({ name: 'Linked' }))
  const roots = join(rig.home, 'exts')
  mkdirSync(roots)
  const { symlinkSync, lstatSync, readlinkSync, chmodSync } = await import('node:fs')
  symlinkSync(real, join(roots, 'linked'))
  writeFileSync(join(roots, 'one.5m.sh'), '#!/bin/sh\necho \'{"n": 1}\'\n')
  chmodSync(join(roots, 'one.5m.sh'), 0o755)
  await rig.rpc('settingsSet', { widgetDirs: [roots] })
  for (const id of ['del', 'linked', 'one']) await rig.rpc('widgetSet', { id, on: id !== 'linked' })
  await rig.rpc('widgetSet', { id: 'del', config: { token: 'sec-123' } })
  await rig.rpc('widgetRun', { id: 'del', ws: ws.id })
  await until(() => find(rig, 'del').then(w => !w.running), 'fetched')
  mkdirSync(join(rig.data, 'widget-data', 'del.history', '1000'), { recursive: true })
  writeFileSync(join(rig.data, 'widget-data', 'widget:del.chat.json'), '{"chat":[]}')
  const snap = () => ({
    files: readFileSync(join(d, 'x.sh'), 'utf8'),
    store: JSON.parse(readFileSync(join(rig.data, 'widget-data', 'del.json'), 'utf8')),
    inst: readFileSync(join(rig.data, 'widget-data', 'del', 'ws', `${ws.id}.json`), 'utf8'),
    hist: existsSync(join(rig.data, 'widget-data', 'del.history', '1000')),
    chat: readFileSync(join(rig.data, 'widget-data', 'widget:del.chat.json'), 'utf8'),
    secret: JSON.parse(readFileSync(join(rig.data, 'widget-secrets.json'), 'utf8')).del,
  })
  const before = snap()

  const del = await rig.rpc('widgetRm', { id: 'del' })
  assert.match(del.trash, /^del-\d+$/)
  for (const f of [d, join(rig.data, 'widget-data', 'del.json'), join(rig.data, 'widget-data', 'del'), join(rig.data, 'widget-data', 'del.history'), join(rig.data, 'widget-data', 'widget:del.chat.json')]) assert.ok(!existsSync(f), `${f} gone`)
  assert.equal(JSON.parse(readFileSync(join(rig.data, 'widget-secrets.json'), 'utf8')).del, undefined)
  const lnk = await rig.rpc('widgetRm', { id: 'linked' })
  assert.ok(!existsSync(join(roots, 'linked')) && existsSync(join(real, 'widget.json')), 'only the link went')
  await until(() => find(rig, 'one').then(w => w.at && !w.running), 'its first fetch over')
  const one = await rig.rpc('widgetRm', { id: 'one' })
  assert.ok(!existsSync(join(roots, 'one.5m.sh')))
  const list = await rig.rpc('widgetTrash')
  assert.deepEqual(list.map((x: any) => x.id).sort(), ['del', 'linked', 'one'])
  assert.match((await rig.cli('widget', 'trash')).out, /del-\d+  Del/)

  // Undo: back as it was, on or off as it was
  const back = await rig.rpc('widgetRestore', { trash: del.trash })
  assert.equal(back.on, true)
  assert.deepEqual(snap(), before)
  assert.equal((await find(rig, 'del')).options[0].set, true)
  assert.match((await rig.cli('widget', 'restore', lnk.trash)).out, /restored linked/)
  assert.equal(readlinkSync(join(roots, 'linked')), real)
  assert.ok(lstatSync(join(roots, 'linked')).isSymbolicLink())
  assert.equal((await find(rig, 'linked')).on, false)
  await rig.rpc('widgetRestore', { trash: one.trash })
  assert.ok(existsSync(join(roots, 'one.5m.sh')))
  assert.equal((await find(rig, 'one')).on, true)
  assert.deepEqual(await rig.rpc('widgetTrash'), [])

  // refused when its id was taken meanwhile; tidy drops the old ones
  const again = await rig.rpc('widgetRm', { id: 'del' })
  widget(rig, 'del', { name: 'Another del' })
  await rig.rpc('widgetReload')
  await assert.rejects(rig.rpc('widgetRestore', { trash: again.trash }), /del is taken now/)
  await assert.rejects(rig.rpc('widgetRestore', { trash: '../x-1' }), /no \.\.\/x-1 in the trash/)
  await rig.rpc('widgetTrashTidy', { now: Date.now() + 29 * 86400e3 })
  assert.equal((await rig.rpc('widgetTrash')).length, 1)
  await rig.rpc('widgetTrashTidy', { now: Date.now() + 31 * 86400e3 })
  assert.deepEqual(await rig.rpc('widgetTrash'), [])
})
