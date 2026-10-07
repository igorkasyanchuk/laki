import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ago, hasFull, hasScript, pageOf, render, spark, viewOf } from '../src/shared/widget.ts'
import { fresh, type Rig, until } from './helpers.ts'

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
  assert.deepEqual(builtin.size, [3, 1])
  assert.equal(builtin.view, 'l')
  assert.equal(v.widgets.find((w: any) => w.id === 'team-prs').view, 'l', "widget.json's")
  assert.equal(v.widgetHome, join(rig.data, 'widgets'))

  widget(
    rig,
    'hello',
    { name: 'Hello', size: [5, 0], every: 2, config: { who: 'world', bad_key: 'x' }, fetch: 'echo "{\\"who\\": \\"$WIDGET_WHO\\", \\"n\\": $(date +%s)}"' },
    '<style>.x{}</style><template preview>hi {{data.who}}</template><template full>{{config.who}} full</template>',
  )
  assert.equal(await find(rig, 'hello'), undefined, 'not before a reload')
  await rig.rpc('widgetReload')
  let w = await until(() => find(rig, 'hello').then(w => w?.at && w), 'the first fetch')
  assert.equal(w.on, true, "a user's widget is on")
  assert.deepEqual(w.size, [3, 1], 'clamped to the grid')
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
    { name: 'JS', script: 'fetch.mjs', config: { step: '2' }, actions: { say: 'echo "got $WIDGET_ARG" > said.txt; echo said it', ls: '"$LAKI_CLI" ls --json | head -c 1', fail: 'exit 1' } },
    '<template preview><b id="n"></b><script>document.getElementById("n").textContent = laki.data.n</script></template>',
    { 'fetch.mjs': 'export default ({ config, last }) => ({ n: (last?.n ?? 0) + Number(config.step), end: "</script>" })' },
  )
  await rig.rpc('widgetReload')
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
  res = await fetch(`http://127.0.0.1:${port}/widget/js?key=${v.widgetKey}&theme=${encodeURIComponent('{"--accent":"#123456"}')}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy') ?? '', /^sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:$/)
  assert.equal((await fetch(`http://127.0.0.1:${port}/widget/js?key=${'é'.repeat(32)}`)).status, 401, 'a key of other bytes')
  const page = await res.text()
  assert.match(page, /"n":4/, 'its default export got the last data')
  assert.match(page, /--accent: #123456;/)
  assert.doesNotMatch(page, /"<\/script>"/)
  assert.equal((await fetch(`http://127.0.0.1:${port}/widget/js?key=${v.widgetKey}&full=1`)).status, 404, 'no full view')

  // actions: the arg as $WIDGET_ARG, never in the command; the laki CLI as $LAKI_CLI
  const arg = `x'; touch hacked; echo '`
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'say', arg }), { ok: true, out: 'said it' })
  const dir = join(rig.data, 'widgets', 'js')
  assert.equal(readFileSync(join(dir, 'said.txt'), 'utf8'), `got ${arg}\n`)
  assert.ok(!existsSync(join(dir, 'hacked')))
  assert.deepEqual(await rig.rpc('widgetAction', { id: 'js', action: 'ls' }), { ok: true, out: '{' })
  assert.equal((await rig.rpc('widgetAction', { id: 'js', action: 'fail' })).ok, false)
  assert.match((await rig.rpc('widgetAction', { id: 'js', action: 'constructor' })).error, /has no action constructor/)

  // a script that throws: its message, not node's trailer
  await until(() => find(rig, 'js').then(w => !w.running), 'the fetch after the actions')
  writeFileSync(join(dir, 'fetch.mjs'), 'export default () => { throw new Error("Set Repo in Settings") }')
  assert.deepEqual(await rig.rpc('widgetRun', { id: 'js' }), { ok: false, error: 'Set Repo in Settings' })
  writeFileSync(join(dir, 'fetch.mjs'), 'export default () => { null.x }')
  assert.match((await rig.rpc('widgetRun', { id: 'js' })).error, /^Cannot read properties of null/)
})

test('widgets that come with Laki: My PRs, Team PRs', async t => {
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
  await rig.rpc('widgetSet', { id: 'my-prs', on: true })
  assert.match((await until(() => find(rig, 'my-prs').then(w => !w.running && w.error && w), 'no repo')).error, /Set Repo/)
  const mine = async (config: object) => {
    await rig.rpc('widgetSet', { id: 'my-prs', config })
    await until(() => find(rig, 'my-prs').then(w => !w.running), 'refetched')
    const r = await rig.rpc('widgetRun', { id: 'my-prs' })
    assert.ok(r.ok, r.error)
    const d = JSON.parse(readFileSync(join(rig.data, 'widget-data', 'my-prs.json'), 'utf8')).data
    return { stats: Object.fromEntries(d.stats.map((x: any) => [x.name, x.n])), groups: d.groups.map((g: any) => [g.name, g.prs.map((p: any) => p.number)]), d }
  }
  let my = await mine({ repo: 'https://github.com/o/r/' }) // a link works too
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /gh pr list --repo o\/r --author @me --state open/)
  // the counts, and each PR in the group of what it needs most
  assert.deepEqual(my.stats, { open: 3, drafts: 1, conflicts: 1 })
  assert.deepEqual(my.groups, [['Conflicts', [1]], ['In review', [2]], ['Drafts', [3]]])
  assert.deepEqual(my.d.groups[0].prs[0], { number: 1, title: 'PR 1', url: 'https://github.com/o/r/pull/1', createdAt: '2026-09-02T10:00:00Z', draft: false, author: 'alice', labels: [{ name: 'bug', color: 'd73a4a' }], ci: 'failing', approved: true, changes: false, conflict: true, group: 'conflict' })
  const tile = await rig.rpc('widgetRender', { id: 'my-prs' })
  assert.match(tile, /<div class="stat" title="3 open"><b>3<\/b><span>open<\/span>/)
  assert.match(tile, /<div class="stat bad" title="1 conflicts"><b>1<\/b><span>conflicts<\/span>/)
  const full = await rig.rpc('widgetRender', { id: 'my-prs', full: true })
  assert.match(full, /<tr class="group"><td colspan="5">Conflicts <span class="muted">1<\/span>/)
  assert.match(full, /<a href="https:\/\/github.com\/o\/r\/pull\/1">#1 PR 1<\/a><\/td>/, 'its group says conflicts: no tag (a draft gets one)')
  assert.match(full, /border-color: #d73a4a">bug</)
  assert.match(full, /ci-failing">failing</)
  assert.match(full, /✓ approved/)
  assert.match(full, /Sep 2, 2026/)
  // up to 3 labels counted, any case, with their color
  my = await mine({ label1: ' BUG ', label3: 'docs' })
  assert.deepEqual(my.d.stats.slice(3), [{ name: 'BUG', n: 3, color: 'd73a4a' }, { name: 'docs', n: 0, color: '' }])
  assert.match(await rig.rpc('widgetRender', { id: 'my-prs' }), /<b>3<\/b><i style="background: #d73a4a"><\/i><span>BUG<\/span>/)
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

  // Team PRs: the team's logins
  await rig.rpc('widgetSet', { id: 'team-prs', on: true, config: { repo: 'o/r' } })
  assert.match((await until(() => find(rig, 'team-prs').then(w => !w.running && w.error && w), 'no logins')).error, /^Set GitHub logins/)
  await rig.rpc('widgetSet', { id: 'team-prs', config: { repo: 'github.com/o/r/pulls', logins: '@Alice, bob' } })
  const team = async () => {
    await until(() => find(rig, 'team-prs').then(w => !w.running && w.at), 'team fetched')
    const w = await find(rig, 'team-prs')
    assert.equal(w.error, undefined)
    return JSON.parse(readFileSync(join(rig.data, 'widget-data', 'team-prs.json'), 'utf8')).data
  }
  let d = await team()
  assert.deepEqual(
    d.prs.map((p: any) => [p.number, p.ci, p.review, p.conflict, p.draft]),
    [
      [2, 'pending', 'waiting', false, false],
      [1, 'failing', 'approved', true, false],
    ],
  )
  assert.equal(d.history.length, 1)
  assert.match(readFileSync(rig.env.FAKE_LOG, 'utf8'), /pr list --repo o\/r --state open --author alice /, 'one list per login')
  await rig.rpc('widgetSet', { id: 'team-prs', config: { logins: 'carol' } })
  await until(async () => (await team()).prs[0]?.number === 3, 'another team')
  d = await team()
  assert.deepEqual(d.team, ['carol'])
  assert.equal(d.history.length, 2, 'the count over time')
  await rig.rpc('widgetSet', { id: 'team-prs', config: { logins: 'alice,bob,carol', hide: 'bug' } })
  await until(async () => (await team()).prs.length === 0, 'all hidden by label')
  await rig.rpc('widgetSet', { id: 'team-prs', config: { hide: '', only: 'Bug' } })
  await until(async () => (await team()).prs.length === 3, 'only with the label')
  const { port } = rig.info()
  const page = await (await fetch(`http://127.0.0.1:${port}/widget/team-prs?key=${(await rig.rpc('state')).widgetKey}&full=1`)).text()
  assert.match(page, /data-run="review"/)
  assert.match(page, />Open PR</)
  assert.match(page, /<select id="who" aria-label="Author">/, 'a filter by author')
  // its action needs a project
  assert.match((await rig.rpc('widgetAction', { id: 'team-prs', action: 'review', arg: 'https://github.com/o/r/pull/3' })).error, /Set Laki project/)
})
