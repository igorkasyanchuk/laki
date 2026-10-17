import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { bytes, dur, num, pageOf, pct, render } from '../src/shared/widget.ts'
import { chartPoints, near, uiCheck, uiHtml, UI_SAMPLES, UI_TYPES } from '../src/shared/widgetUi.ts'
import { fresh, until } from './helpers.ts'

const at = Date.parse('2026-10-17T10:00:00Z')

test('UI kit: every element has a sample, and every sample draws at a 1×1 preview, a bar and in full', () => {
  assert.equal(UI_TYPES.length, 27)
  assert.deepEqual(UI_SAMPLES.map(s => s.type), UI_TYPES, 'a sample per element, in order')
  for (const s of UI_SAMPLES) {
    const ctx = { data: s.data, config: {}, at }
    for (const o of [{ cells: [1, 1] as [number, number] }, { cells: [3, 0.5] as [number, number] }, { full: true }]) {
      const html = uiHtml(s.spec, ctx, o)
      assert.match(html, /^<div class="k" data-kit="(preview|full)"/, s.type)
      assert.doesNotMatch(html, /k-chip-err/, `${s.type}: no error chip`)
    }
    assert.deepEqual(uiCheck(s.spec, s.data, { actions: ['review', 'deploy', 'file'] }), [], `${s.type}'s sample checks clean`)
  }
})

test('UI kit: helpers', () => {
  assert.deepEqual([num(1234), num(999), num(1_500_000), num(2.345), num('x')], ['1.2k', '999', '1.5M', '2.35', ''])
  assert.deepEqual([pct(0.42), pct(42), pct(0.055), pct(1)], ['42%', '42%', '5.5%', '100%'])
  assert.deepEqual([bytes(512), bytes(1536), bytes(5 * 1024 ** 3)], ['512 B', '1.5 KB', '5 GB'])
  assert.deepEqual([dur(450), dur(45_000), dur(123_000), dur(3_723_000), dur(93_600_000)], ['450 ms', '45s', '2m 3s', '1h 2m', '1d 2h'])
  assert.equal(render('{{num n}} {{pct p}} {{upper s}} {{lower s}}', { n: 12840, p: 0.3, s: 'Ab' }), '12.8k 30% AB ab')
})

test('UI kit: data is escaped everywhere, never a template of its own', () => {
  const bad = '<script>alert(1)</script>"\'{{config.secret}}'
  const d = { t: bad, url: `https://x.test/?a="><script>`, items: [{ t: bad, url: 'javascript:alert(1)' }], md: `${bad} [x](javascript:alert(1))`, ys: [{ x: bad, y: 1 }, { x: bad, y: 2 }] }
  const spec = {
    type: 'stack',
    tip: '{{t}}',
    children: [
      { type: 'text', value: '{{t}}', tip: '{{t}}' },
      { type: 'button', label: '{{t}}', run: 'go', arg: '{{t}}', confirm: '{{t}}' },
      { type: 'button', label: 'c', copy: '{{t}}' },
      { type: 'list', each: 'items', title: '{{t}}', href: '{{url}}', accessories: [{ tag: '{{t}}' }] },
      { type: 'markdown', value: '{{md}}' },
      { type: 'chart', each: 'ys', x: '{{x}}', y: '{{y}}', label: '{{t}}' },
      { type: 'kv', items: [{ key: '{{t}}', value: '{{t}}', copy: true }] },
      { type: 'links', items: [{ label: '{{t}}', href: '{{url}}' }] },
      { type: 'form', fields: [{ id: 'f', label: '{{t}}', default: '{{t}}' }], submit: { label: '{{t}}', run: 'go' } },
    ],
  }
  const html = uiHtml(spec, { data: d, config: { secret: 'S3CRET' } }, { full: true })
  assert.doesNotMatch(html, /<script|javascript:/i)
  assert.match(html, /href="https:\/\/x.test\/\?a=&quot;&gt;&lt;script&gt;"/)
  assert.doesNotMatch(html, /S3CRET/, "data's braces stay text")
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;\{\{config.secret\}\}/)
  assert.match(html, /data-arg="&lt;script&gt;/)
  assert.match(html, /data-confirm="&lt;script&gt;/)
  assert.match(html, /data-copy="&lt;script&gt;/)
  assert.match(html, /<title>&lt;script&gt;/, "a chart point's tooltip")
  assert.doesNotMatch(html, /data-open="javascript/, 'a link only http(s), mailto or laki://')
})

test('UI kit: each, if, unless, tone maps, limits and +N more, groups, sort, forms, confirm', () => {
  const data = { rows: [{ n: 3, s: 'failed', g: 'b' }, { n: 1, s: 'live', g: 'a' }, { n: 2, s: 'live', g: 'b' }], none: [], flag: true }
  const h = (spec: object, o = {}) => uiHtml(spec, { data }, o)
  assert.equal(h({ type: 'text', each: 'rows', value: '{{@index}}:{{n}}' }).match(/k-text/g)?.length, 3, 'each repeats it')
  assert.match(h({ type: 'stack', children: [{ type: 'text', value: 'a', if: 'flag' }, { type: 'text', value: 'b', if: 'none' }, { type: 'text', value: 'c', unless: 'none' }, { type: 'text', value: 'd', if: '{{#if flag}}yes{{/if}}' }] }), /^(?!.*>b<).*>a<.*>c<.*>d</)
  // an item's and an accessory's if / unless too
  assert.doesNotMatch(h({ type: 'stats', items: [{ value: '1', label: 'a' }, { value: '2', label: 'b', if: 'none' }] }), />b</)
  assert.doesNotMatch(h({ type: 'list', each: 'rows', title: 'x', accessories: [{ tag: '{{s}}', unless: 'flag' }] }), /k-tag/)
  assert.match(h({ type: 'badge', value: 'failed', tone: { failed: 'bad' } }), /class="k-badge t-bad"/)
  assert.match(h({ type: 'text', value: 'x', tone: '{{#if flag}}good{{/if}}' }), /t-good/)
  assert.doesNotMatch(h({ type: 'text', value: 'x', tone: 'loud' }), /t-loud/, 'only the five tones')
  // a 1×1 preview fits 2 rows, then +N more (the full view); the full view of one tree shows them all
  const list = { type: 'list', each: 'rows', title: '#{{n}}' }
  assert.equal(h(list, { cells: [1, 1] }).match(/data-row[ >]/g)?.length, 2)
  assert.match(h(list, { cells: [1, 1] }), /<button type="button" class="k-more" data-more>\+1 more<\/button>/)
  assert.equal(h(list, { full: true }).match(/data-row[ >]/g)?.length, 3)
  assert.doesNotMatch(h(list, { full: true }), /k-more/)
  // { preview, full }: the full view's limit holds, the rest hidden until +N more
  const two = uiHtml({ full: { ...list, limit: 1 } }, { data }, { full: true })
  assert.equal(two.match(/data-extra hidden/g)?.length, 2)
  assert.match(two, /\+2 more/)
  assert.equal(h(list, { cells: [3, 0.5] }).match(/data-row[ >]/g)?.length, 1, "a bar's line: the first row")
  assert.match(h({ ...list, filter: true }, { full: true }), /<input class="k-filter" type="search" data-filter/)
  // groups in the order first seen
  const g = h({ ...list, group: 'g' }, { full: true })
  assert.match(g, /k-gh">b<span class="k-sub">2<\/span>.*#3.*#2.*k-gh">a<span class="k-sub">1<\/span>.*#1/)
  // a table sorted, a column's tone map
  const t = h({ type: 'table', each: 'rows', sort: 'n desc', columns: [{ title: 'N', value: '{{n}}' }, { title: 'S', tag: '{{s}}', tone: { failed: 'bad' } }] }, { full: true })
  assert.match(t, /<td class=""><span class="">3<\/span><\/td><td class=""><span class="k-tag t-bad">failed<\/span><\/td>.*>2<.*>1</)
  // a form: fields in a data-form, its button submits them; a confirm goes along
  const f = h({ type: 'form', fields: [{ id: 'title', label: 'Title' }, { id: 'urgent', type: 'bool' }, { id: 'n', type: 'number', default: 2 }, { id: 'pick', type: 'choice', choices: ['a', 'b'], default: 'b' }], submit: { label: 'File', run: 'file', confirm: 'Sure?' } })
  assert.match(f, /<div class="k-form" data-form>/)
  assert.doesNotMatch(f, /<form/)
  assert.match(f, /<input type="text" name="title"/)
  assert.match(f, /<input type="checkbox" name="urgent">/)
  assert.match(f, /<option selected>b<\/option>/)
  assert.match(f, /data-run="file" data-submit data-confirm="Sure\?">File</)
  assert.match(h({ type: 'button', label: 'Go', run: 'go', confirm: 'Really {{rows.length}}?' }), /data-run="go" data-confirm="Really 3\?"/)
})

test('UI kit: charts in SVG, an empty series draws nothing', () => {
  assert.deepEqual(chartPoints([3, 5, 4], 3, 5), [[0, 38], [50, 2], [100, 20]])
  const html = uiHtml({ type: 'chart', each: 'd', x: '{{x}}', y: '{{y}}', unit: 'ms', label: 'p95' }, { data: { d: [{ x: 'a', y: 3 }, { x: 'b', y: 5 }, { x: 'c', y: 4 }] } }, { full: true })
  assert.match(html, /<polyline class="t-accent" points="0.0,38.0 50.0,2.0 100.0,20.0"/)
  assert.match(html, /<title>b: 5ms<\/title>/)
  assert.match(html, /k-ch-dot t-accent" style="left:100.0%;top:50.0%"/, 'the last point marked')
  assert.match(html, /<b>4ms<\/b>/, 'the last value')
  assert.match(html, /<span>5ms<\/span><span>3ms<\/span>/, 'max and min')
  const bars = uiHtml({ type: 'chart', kind: 'bars', each: 'd', y: '{{y}}', tone: '{{#if bad}}bad{{/if}}' }, { data: { d: [{ y: 1 }, { y: 2, bad: true }] } })
  assert.equal(bars.match(/<rect class="t-accent"/g)?.length, 1)
  assert.equal(bars.match(/<rect class="t-bad"/g)?.length, 1, 'a bar toned per point')
  assert.equal(uiHtml({ type: 'chart', each: 'd', y: '{{y}}' }, { data: { d: [] } }), '<div class="k" data-kit="preview"></div>')
  assert.equal(uiHtml({ type: 'chart', each: 'd', y: '{{y}}' }, { data: { d: [{ y: 'x' }] } }), '<div class="k" data-kit="preview"></div>')
})

test('UI kit: a failed fetch with no data, a bad template in one element', () => {
  const failed = uiHtml({ type: 'list', each: 'rows', title: '{{t}}' }, { data: undefined, error: 'gh: not signed in' })
  assert.match(failed, /<div class="k-error"><b>Couldn’t fetch it<\/b><div class="k-sub">gh: not signed in<\/div><button type="button" class="k-btn sm" data-laki="refresh">Retry<\/button>/)
  const one = uiHtml({ type: 'stack', children: [{ type: 'text', value: '{{#if x}}open' }, { type: 'text', value: 'still here' }, { type: 'nope' }] }, { data: {} })
  assert.match(one, /class="k-chip-err" title="\{\{#if\}\} isn&#39;t closed">⚠/)
  assert.match(one, /still here/)
  assert.match(one, /no element nope/)
})

test('UI kit: check finds unknown elements and props, wrong kinds, missing actions, and rows against the data', () => {
  const p = uiCheck({ type: 'stack', children: [{ type: 'lsit' }, { type: 'text', valeu: 'x' }, { type: 'list', each: 'prs', title: '{{titel}}', limit: 'many' }, { type: 'button', run: 'deploy', icon: 'rocketship' }, { type: 'list', each: 'n' }, { type: 'chart', each: 'prs', y: '{{title}}' }] }, { prs: [{ title: 'a' }], n: 3 }, { actions: ['review'] })
  const says = p.map(x => `${x.level}: ${x.text}`)
  assert.ok(says.includes('error: no element lsit (did you mean list?)'), says.join('\n'))
  assert.ok(says.includes('warn: no prop valeu (did you mean value?)'))
  assert.ok(says.includes('warn: title uses titel, which no item of prs has (did you mean title?)'))
  assert.ok(says.includes('error: limit: a number'))
  assert.ok(says.includes("error: runs deploy, which isn't one of widget.json's actions"))
  assert.ok(says.some(s => /^warn: icon rocketship isn't one of Laki's icons/.test(s)))
  assert.ok(says.includes('error: each: n is number, not a list'))
  assert.ok(says.includes("warn: y {{title}}: 1 of 1 rows aren't numbers (a)"))
  assert.equal(near('colr', ['color', 'value']), 'color')
  assert.equal(near('zzzzzz', ['color']), undefined)
  assert.deepEqual(uiCheck({ preview: { type: 'text' }, ful: {} }).map(x => x.text), ['no key ful: ui is an element ({ "type": … }) or { "preview", "full" } (did you mean full?)'])
})

test('UI kit: a JS page gets uiBehave and laki.ui/mount, still with nothing from outside', () => {
  const page = pageOf('<p>x</p>', { data: { n: 1 } })
  assert.match(page, /\(function uiBehave\(root/)
  assert.match(page, /mount: \(el, spec, data\) =>/)
  assert.match(page, /\.k-stats/, "the kit's CSS")
  const js = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>'))
  assert.doesNotThrow(() => new Function(js), 'its script parses')
  assert.doesNotMatch(page.replace(/https:\/\/avatars\.githubusercontent\.com/g, ''), /https?:\/\/|src=/, 'nothing it loads')
})

test('a widget with ui and no widget.html: rendered by the daemon and the CLI; widget.html wins the view it has', async t => {
  const rig = await fresh(t)
  const d = join(rig.data, 'widgets', 'deploys')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Deploys', fetch: 'echo \'{"deploys":[{"app":"web","ok":true},{"app":"api","ok":false}]}\'', ui: { type: 'list', each: 'deploys', title: '{{app}}', tone: '{{#unless ok}}bad{{/unless}}' } }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'deploys', on: true })
  const w = await until(async () => ((await rig.rpc('state')).widgets.find((x: any) => x.id === 'deploys' && x.at) as any), 'fetched')
  assert.deepEqual([w.full, w.button], [true, undefined], 'a ui list gets a full view, and is no button')
  const preview = await rig.rpc('widgetRender', { id: 'deploys', cells: [3, 1] })
  assert.match(preview, /<div class="k" data-kit="preview"><div class="k-list" data-rows><div class="k-li" data-row><div class="k-main"><div class="k-title ">web<\/div>/)
  assert.match(preview, /k-title t-bad">api</)
  assert.match(await rig.rpc('widgetRender', { id: 'deploys', full: true }), /data-kit="full"/)
  assert.match((await rig.cli('widget', 'render', 'deploys')).out, /k-title ">web/)
  assert.match((await rig.cli('widget', 'render', 'deploys', '--full')).out, /data-kit="full"/)
  // widget.html's own preview wins; ui fills the full view it doesn't have
  writeFileSync(join(d, 'widget.html'), '<template preview>{{data.deploys.length}} deploys</template>')
  await rig.rpc('widgetReload')
  assert.equal(await rig.rpc('widgetRender', { id: 'deploys' }), '2 deploys')
  assert.match(await rig.rpc('widgetRender', { id: 'deploys', full: true }), /data-kit="full"/)
})
