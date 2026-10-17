import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { bytes, dur, num, pageOf, pct, render, uiBehave } from '../src/shared/widget.ts'
import { CHARTS, chartPoints, colorCss, COLORS, near, TONES, uiCheck, UI_EXAMPLES, uiHtml, UI_SAMPLES, UI_TYPES } from '../src/shared/widgetUi.ts'
import { fresh, until } from './helpers.ts'

const at = Date.parse('2026-10-17T10:00:00Z')

test('UI kit: every element has a sample, and every sample draws at a 1×1 preview, a bar and in full', () => {
  assert.equal(UI_TYPES.length, 39)
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
  // tabs repeated by each: a radio group each; a link's spaces don't make it an href
  const names = [...h({ type: 'tabs', each: 'rows', tabs: [{ label: 'A' }, { label: 'B' }] }, { full: true }).matchAll(/name="(kt-[^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(names).size, 3)
  assert.match(h({ type: 'links', items: [{ label: 'Board', href: ' laki://board' }] }), /<a data-open="laki:\/\/board">/)
})

test('UI kit: charts in SVG, an empty series draws nothing', () => {
  assert.deepEqual(chartPoints([3, 5, 4], 3, 5), [[0, 38], [50, 2], [100, 20]])
  const html = uiHtml({ type: 'chart', each: 'd', x: '{{x}}', y: '{{y}}', unit: 'ms', label: 'p95' }, { data: { d: [{ x: 'a', y: 3 }, { x: 'b', y: 5 }, { x: 'c', y: 4 }] } }, { full: true })
  assert.match(html, /<polyline points="0.0,38.0 50.0,2.0 100.0,20.0"[^>]*style="color:var\(--tc-blue, #7aa2f7\)"/)
  assert.match(html, /<title>b: 5ms<\/title>/)
  assert.match(html, /k-ch-dot" style="left:100.0%;top:50.0%;background:var\(--tc-blue/, 'the last point marked')
  assert.match(html, /<b>4ms<\/b>/, 'the last value')
  assert.match(html, /<span>5ms<\/span><span>3ms<\/span>/, 'max and min')
  const bars = uiHtml({ type: 'chart', kind: 'bars', each: 'd', y: '{{y}}', tone: '{{#if bad}}bad{{/if}}' }, { data: { d: [{ y: 1 }, { y: 2, bad: true }] } })
  assert.equal(bars.match(/<rect [^>]*style="color:var\(--tc-blue/g)?.length, 1)
  assert.equal(bars.match(/<rect [^>]*style="color:var\(--error/g)?.length, 1, 'a bar toned per point')
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

test('UI kit: colors, every chart kind, the examples', () => {
  assert.equal(colorCss('bad'), 'var(--error, #f7768e)')
  assert.equal(colorCss('Blue'), 'var(--tc-blue, #7aa2f7)')
  assert.deepEqual([colorCss('d73a4a'), colorCss('#0e8a16'), colorCss('fff'), colorCss('nope'), colorCss('constructor'), colorCss('red;x')], ['#d73a4a', '#0e8a16', '#fff', '', '', ''])
  for (const c of [...TONES, ...COLORS]) assert.ok(colorCss(c), c)
  assert.match(uiHtml({ type: 'text', value: 'hi', color: 'purple' }, {}), /<div class="k-text" style="color:var\(--tc-purple, #bb9af7\)">hi<\/div>/)
  assert.match(uiHtml({ type: 'badge', value: '3', color: '{{c}}' }, { data: { c: 'teal' } }), /class="k-badge c" style="color:var\(--tc-teal/)
  assert.match(uiHtml({ type: 'tags', each: 'l', tag: '{{n}}', color: '{{c}}' }, { data: { l: [{ n: 'bug', c: 'd73a4a' }] } }), /border-color:#d73a4a.*background:#d73a4a/)
  // a check flags a color it doesn't know
  assert.match(uiCheck({ type: 'text', value: 'x', color: 'bleu' }).map(p => p.text).join(), /color bleu: .*did you mean blue/)
  assert.deepEqual(uiCheck({ type: 'chart', kind: 'pie', each: 'd', x: '{{x}}', y: '{{y}}', colors: ['red', '{{c}}', 'abcdef'] }), [])
  const d = { d: [{ x: 'a', y: 3, z: 1 }, { x: 'b', y: 5, z: 2 }, { x: 'c', y: 2, z: 4 }] }
  for (const kind of CHARTS) {
    const html = uiHtml({ type: 'chart', kind, each: 'd', x: '{{x}}', y: '{{y}}', label: 'L' }, { data: d }, { full: true })
    assert.match(html, new RegExp(`class="k-chart k-${kind}"`), kind)
    assert.doesNotMatch(html, /k-chip-err|NaN|undefined/, kind)
    assert.ok(uiHtml({ type: 'chart', kind, each: 'd', x: '{{x}}', y: '{{y}}' }, { data: d }, { cells: [2, 0.5] }).includes(`k-${kind}`), `${kind} in a bar`)
  }
  const pie = uiHtml({ type: 'chart', kind: 'donut', each: 'd', x: '{{x}}', y: '{{y}}', label: 'tickets', colors: ['green', 'red'] }, { data: d }, { full: true })
  assert.equal(pie.match(/<circle /g)?.length, 3, 'a slice per row')
  assert.match(pie, /stroke-dasharray="30.0 70.0" stroke-dashoffset="0.0"[^>]*><title>a: 3 \(30%\)/, 'its share of the whole')
  assert.match(pie, /color:var\(--tc-green[\s\S]*color:var\(--tc-red[\s\S]*color:var\(--tc-green/, 'colors in order, again from the first')
  assert.match(pie, /<div class="k-pie-mid"><b>10<\/b><span>tickets<\/span>/, 'the total in the middle')
  assert.match(pie, /class="k-legend"><span><i style="background:var\(--tc-green[^>]*><\/i>a<b>30%<\/b>/)
  const stacked = uiHtml({ type: 'chart', kind: 'stacked', each: 'd', x: '{{x}}', series: [{ label: 'y', y: '{{y}}', color: 'blue' }, { label: 'z', y: '{{z}}', color: 'orange' }] }, { data: d }, { full: true })
  assert.equal(stacked.match(/<rect x=[^>]*fill="currentColor"/g)?.length, 6)
  assert.match(stacked, /<b>6<\/b>/, "the last row's total")
  assert.match(stacked, /class="k-legend"><span><i style="background:var\(--tc-blue[^>]*><\/i>y<\/span><span><i style="background:var\(--tc-orange/)
  const hbars = uiHtml({ type: 'chart', kind: 'hbars', each: 'd', x: '{{x}}', y: '{{y}}', unit: '%' }, { data: d }, { full: true })
  assert.match(hbars, /<span class="k-hb-l">b<\/span><span class="k-hb-t"><i style="width:100.0%;background:var\(--tc-orange[^"]*"><\/i><\/span><b>5%<\/b>/)
  const sc = uiHtml({ type: 'chart', kind: 'scatter', each: 'd', x: '{{z}}', y: '{{y}}' }, { data: d }, { full: true })
  assert.match(sc, /class="k-sc-dot" style="left:100.0%;top:[\d.]+%;background:var\(--tc-blue/, 'x by its number')
  assert.equal(uiHtml({ type: 'chart', kind: 'pie', each: 'd', y: '{{y}}' }, { data: { d: [{ y: 0 }, { y: -1 }] } }), '<div class="k" data-kit="preview"></div>', 'nothing above 0: no pie')
  // the examples: more than ten, each draws clean and checks clean
  assert.ok(UI_EXAMPLES.length >= 10)
  for (const x of UI_EXAMPLES) {
    for (const o of [{ cells: [3, 2] as [number, number] }, { cells: [2, 0.5] as [number, number] }, { full: true }]) assert.doesNotMatch(uiHtml(x.spec, { data: x.data, at }, o), /k-chip-err|NaN/, x.title)
    assert.deepEqual(uiCheck(x.spec, x.data).filter(p => p.level === 'error'), [], x.title)
  }
})

test('UI kit: the new elements, and buttons that ask Laki to do things', () => {
  const h = (spec: object, data?: unknown, o: object = { full: true }) => uiHtml(spec, { data, at }, o)
  assert.match(h({ type: 'header', icon: 'github', title: '{{r}}', href: 'https://github.com/{{r}}', actions: [{ icon: 'refresh', label: 'Refresh', refresh: true }] }, { r: 'acme/web' }), /k-header.*<a href="https:\/\/github.com\/acme\/web"[^>]*>acme\/web<\/a>.*data-laki="refresh"/s)
  assert.match(h({ type: 'toolbar', items: [{ icon: 'copy', label: 'Copy it', copy: 'x' }, { label: 'Words' }] }), /<button type="button" class="k-btn sm bare" title="Copy it" data-copy="x" aria-label="Copy it"><svg[\s\S]*?<\/svg><\/button><button type="button" class="k-btn sm"><span>Words<\/span>/, 'icons alone, their words the tooltip; one without an icon keeps its words')
  assert.match(h({ type: 'footer', text: 'Updated {{n}}', actions: [{ label: 'Go', open: 'https://x.test' }] }, { n: 3 }), /k-footer"><span class="k-ft-t">Updated 3<\/span>/)
  assert.match(h({ type: 'callout', tone: 'bad', title: 'Down' }), /class="k-callout t-bad"/)
  assert.match(h({ type: 'callout', title: 'Note' }), /class="k-callout t-accent"/, 'accent unless it says')
  assert.match(h({ type: 'gauge', value: '{{v}}', max: 200, unit: '%' }, { v: 50 }), /stroke-dasharray="25.0 100".*<b>50%<\/b>/s)
  const hm = h({ type: 'heatmap', each: 'd', x: '{{day}}', value: '{{n}}' }, { d: [{ day: 'Mon', n: 0 }, { day: 'Tue', n: 4 }, { day: 'Wed', n: 1 }] })
  assert.deepEqual([...hm.matchAll(/<i class="l(\d)"/g)].map(m => m[1]), ['0', '4', '1'])
  assert.match(hm, /title="Tue: 4"/)
  const st = h({ type: 'status', each: 's', label: '{{name}}', state: '{{state}}' }, { s: [{ name: 'API', state: 'up' }, { name: 'DB', state: 'degraded' }, { name: 'Q', state: 'down' }, { name: 'X', state: 'odd' }] })
  assert.deepEqual([...st.matchAll(/k-st-s (t-\w+)/g)].map(m => m[1]), ['t-good', 't-warn', 't-bad', 't-muted'], 'its state word colors it')
  const ck = h({ type: 'checklist', each: 't', text: '{{text}}', done: 'done' }, { t: [{ text: 'a', done: true }, { text: 'b' }] })
  assert.match(ck, /<b>1\/2<\/b>/)
  assert.equal(ck.match(/k-ck on/g)?.length, 1)
  const av = h({ type: 'avatars', each: 'l', max: 2 }, { l: ['octocat', 'hubot', 'bad login!', 'monalisa'] })
  assert.equal(av.match(/<img /g)?.length, 2)
  assert.match(av, /\+1<\/span>/, 'a bad login left out, the rest counted')
  assert.match(h({ type: 'card', title: 'T', image: 'https://x.test/a.png', href: 'https://x.test' }), /k-cards one.*data-open="https:\/\/x.test".*<img class="k-card-img" src="https:\/\/x.test\/a.png"/s)
  assert.doesNotMatch(h({ type: 'image', src: 'http://x.test/a.png' }), /<img/, 'https only')
  assert.match(h({ type: 'row', children: [{ type: 'text', value: 'a' }, { type: 'spacer' }, { type: 'text', value: 'b' }] }), /<div class="k-spacer"><\/div>/)
  assert.match(h({ type: 'icon', name: 'check', size: 'xl', color: 'good' }), /class="k-ic" style="color:var\(--done[^"]*"><svg[^>]*width="32"/)
  // do: the command filled in, as JSON; one with no command it knows is off
  const b = h({ type: 'button', label: 'Fix', do: 'new', prompt: 'Fix {{t}} "now"', project: 'web', agent: 'codex' }, { t: '<x>' })
  const cmd = JSON.parse(/data-do="([^"]*)"/.exec(b)![1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  assert.deepEqual(cmd, { do: 'new', prompt: 'Fix <x> "now"', agent: 'codex', project: 'web' })
  assert.match(h({ type: 'button', label: 'X', do: 'rm' }), /disabled/)
  const probs = uiCheck({ type: 'stack', children: [{ type: 'button', label: 'a', do: 'terminal' }, { type: 'button', label: 'b', do: 'nuke' }, { type: 'toolbar', items: [{ icon: 'x', run: 'nope', label: 'n' }] }] }, undefined, { actions: ['go'] })
  assert.match(probs.map(p => `${p.level}: ${p.text}`).join('\n'), /warn: do terminal without command[\s\S]*error: do: one of new, send, ai, terminal, browse[\s\S]*error: runs nope/)
})

test('UI kit: a click on a do button asks the app, with the command', () => {
  const sent: any[] = []
  const listeners: Record<string, (e: any) => void> = {}
  const root = { addEventListener: (t: string, f: any) => (listeners[t] = f), removeEventListener: () => {} }
  uiBehave(root, m => sent.push(m))
  // a tiny DOM: a tag, attributes and a parent; matches knows a list of [attr], tag and tag[attr]
  type N = { tag: string; attrs: Record<string, string>; parent?: N; textContent: string; getAttribute: (k: string) => string | null; hasAttribute: (k: string) => boolean; setAttribute: (k: string, v: string) => void; removeAttribute: (k: string) => void; matches: (q: string) => boolean; closest: (q: string) => N | null }
  const el = (tag: string, attrs: Record<string, string>, parent?: N, text = ''): N => {
    const n: N = {
      tag, attrs, parent, textContent: text,
      getAttribute: k => attrs[k] ?? null,
      hasAttribute: k => k in attrs,
      setAttribute: (k, v) => void (attrs[k] = v),
      removeAttribute: k => void delete attrs[k],
      matches: q => q.split(',').some(one => (m => !!m && (!m[1] || m[1] === tag) && (!m[2] || m[2] in attrs))(/^\s*([a-z]*)(?:\[([\w-]+)(?:="[^"]*")?\])?\s*$/.exec(one))),
      closest: q => (n.matches(q) ? n : (parent?.closest(q) ?? null)),
    }
    return n
  }
  listeners.click({ target: el('button', { 'data-do': JSON.stringify({ do: 'ai', prompt: 'hi' }) }, undefined, ' Ask '), preventDefault() {} })
  listeners.click({ target: el('button', { 'data-do': '{not json' }), preventDefault() {} })
  assert.deepEqual(sent, [{ laki: 'do', cmd: { do: 'ai', prompt: 'hi' }, label: 'Ask', confirm: undefined }])
  // the innermost wins: a do button or a copy in a row that runs an action, and the row itself
  sent.length = 0
  const row = el('div', { 'data-run': 'open', 'data-arg': '7' })
  listeners.click({ target: el('span', {}, el('button', { 'data-do': JSON.stringify({ do: 'browse', url: 'https://x.dev' }) }, row, 'Go')), preventDefault() {} })
  listeners.click({ target: el('button', { 'data-copy': 'abc' }, row), preventDefault() {} })
  listeners.click({ target: el('span', {}, row), preventDefault() {} })
  assert.deepEqual(sent.map(m => m.laki), ['do', 'copy', 'run'])
  assert.match(pageOf('', {}), /do: \(cmd, label\) => say\(\{ laki: 'do', cmd/)
})
