import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { bytes, dur, num, pageOf, pct, render, uiBehave } from '../src/shared/widget.ts'
import { CHARTS, chartPoints, colorCss, COLORS, near, TONES, uiCheck, UI_EXAMPLES, uiHtml, UI_SAMPLES, UI_TYPES } from '../src/shared/widgetUi.ts'
import { tools } from '../src/cli/mcp.ts'
import { fresh, until } from './helpers.ts'

const at = Date.parse('2026-10-17T10:00:00Z')

test('UI kit: every element has a sample, and every sample draws at a 1×1 preview, a bar and in full', () => {
  assert.equal(UI_TYPES.length, 100)
  assert.deepEqual(UI_SAMPLES.map(s => s.type), UI_TYPES, 'a sample per element, in order')
  for (const s of UI_SAMPLES) {
    const ctx = { data: s.data, config: {}, at }
    for (const o of [{ cells: [1, 1] as [number, number] }, { cells: [3, 0.5] as [number, number] }, { full: true }]) {
      const html = uiHtml(s.spec, ctx, o)
      assert.match(html, /^<div class="k" data-kit="(preview|full)"/, s.type)
      assert.doesNotMatch(html, /k-chip-err/, `${s.type}: no error chip`)
    }
    assert.deepEqual(uiCheck(s.spec, s.data, { actions: ['review', 'deploy', 'file', 'maintenance', 'deploys', 'env', 'scale', 'rollout', 'region', 'add', 'watch', 'like', 'page', 'redeploy', 'rollback', 'checkout', 'release', 'merge', 'close', 'strategy'] }), [], `${s.type}'s sample checks clean`)
  }
})

test('UI kit: kbd, secret, rating, calendar, people, inbox, chat, prs, commits, segmented and stepper', () => {
  const draw = (spec: object, data: object = {}, o: object = { full: true }) => uiHtml(spec, { data, config: {}, at }, o)
  const count = (html: string, re: RegExp) => [...html.matchAll(re)].length
  assert.equal(count(draw({ type: 'kbd', keys: '⌘+K' }), /<kbd>/g), 2)
  assert.equal(count(draw({ type: 'kbd', keys: 'Ctrl + Shift + P' }), /<kbd>/g), 3, 'the + between keys dropped')
  assert.match(draw({ type: 'kbd', keys: '⌘ +' }), /<kbd>\+<\/kbd>/, 'a + key kept')
  assert.match(draw({ type: 'kbd', keys: '⌘+' }), /<kbd>⌘<\/kbd><kbd>\+<\/kbd>/, 'zoom in: ⌘ and +')
  assert.match(draw({ type: 'kbd', keys: 'Ctrl++' }), /<kbd>Ctrl<\/kbd><kbd>\+<\/kbd>/)
  // a secret: dots, a long one's last 4; its text there once opened, copied whole
  const sec = draw({ type: 'secret', value: '{{k}}' }, { k: 'sk_live_0123456789abcdef' })
  assert.match(sec, /••••••••cdef/)
  assert.match(sec, /data-copy="sk_live_0123456789abcdef"/)
  assert.doesNotMatch(draw({ type: 'secret', value: 'short' }), /••••••••s/, 'a short one: dots only')
  assert.match(draw({ type: 'rating', value: '3.5' }), /--f:100%.*--f:100%.*--f:100%.*--f:50%.*--f:0%/)
  // a calendar: the month asked for, Monday first; a day with rows dotted, their titles its tooltip; the list in full
  const cal = draw({ type: 'calendar', each: 'ev', month: '2026-02', href: 'https://example.com/{{title}}' }, { ev: [{ date: '2026-02-10', title: 'Freeze' }, { date: '2026-02-10', title: 'Party' }, { date: '2026-03-01', title: 'Later' }] })
  assert.equal(count(cal, /class="k-cd( today)?( has)?"/g), 28)
  assert.equal(count(cal, /k-cd out/g), 6, '1 Feb 2026 is a Sunday')
  assert.match(cal, /class="k-cd has" title="Freeze\nParty" data-open="https:\/\/example.com\/Freeze"><span>10</)
  assert.match(cal, /k-cal-list.*Freeze.*Party/)
  assert.doesNotMatch(cal, /Later/, 'another month’s rows: not in the list')
  // people: a dot by their word, initials without a login
  const pp = draw({ type: 'people', each: 'p', state: '{{s}}', login: '{{login}}' }, { p: [{ name: 'Ada Byron', s: 'offline' }, { name: 'Hu', login: 'hubot', s: 'busy' }] })
  assert.match(pp, /k-ini" aria-hidden="true">AB</)
  assert.match(pp, /k-pp-dot t-muted/)
  assert.match(pp, /k-pp-dot t-bad/)
  // a chat: the newest last, the rest behind +N more; yours on the right
  const chat = draw({ type: 'chat', each: 'm', mine: 'me', limit: 1 }, { m: [{ from: 'A', text: 'one' }, { from: 'B', text: 'two', me: true }] }, { cells: [3, 1] })
  assert.match(chat, /\+1 more.*k-msg me.*two/)
  assert.doesNotMatch(chat, /one/)
  assert.match(draw({ type: 'inbox', each: 'm', unread: 'u' }, { m: [{ from: 'A', subject: 'Hi', u: true }] }), /k-ib on.*k-ib-dot/)
  // PRs: merged purple, its checks' icon, a review's tag; commits: the short hash, the whole copied
  const prs = draw({ type: 'prs', each: 'p', checks: '{{ci}}', review: '{{r}}' }, { p: [{ number: 1, title: 'A', state: 'MERGED', ci: 'failing', r: 'CHANGES_REQUESTED', url: 'https://github.com/a/b/pull/1' }] })
  assert.match(prs, /data-open="https:\/\/github.com\/a\/b\/pull\/1"/)
  assert.match(prs, /tc-purple.*k-pr-ck t-bad.*k-tag t-bad">changes/)
  assert.match(draw({ type: 'commits', each: 'c' }, { c: [{ sha: 'a3f9c2e81b4d', message: 'Fix it\n\nlong body' }] }), /data-copy="a3f9c2e81b4d" title="Copy a3f9c2e81b4d">a3f9c2e<\/code><span class="k-cm-m">Fix it</)
  // segmented: the picked one runs nothing, the others their value; stepper: past max refused, a step's float rounded
  const seg = draw({ type: 'segmented', options: ['dev', { value: 'prod', label: 'Production' }], value: '{{env}}', run: 'env' }, { env: 'dev' })
  assert.match(seg, /class="k-seg-o on" aria-pressed="true">dev</)
  assert.match(seg, /data-run="env" data-arg="prod">Production</)
  const st = draw({ type: 'stepper', value: '{{n}}', max: 0.3, step: 0.1, run: 'scale' }, { n: 0.2 })
  assert.match(st, /aria-label="Less" data-run="scale" data-arg="0.1"/)
  assert.match(st, /aria-label="More" data-run="scale" data-arg="0.3"/)
  assert.match(draw({ type: 'stepper', value: 3, max: 3, run: 'scale' }), /aria-label="More" disabled/)
  assert.deepEqual(uiCheck({ type: 'segmented', options: ['a'], run: 'nope' }, undefined, { actions: ['env'] }).map(p => p.level), ['error'])
})

test('UI kit: diff, log, steps, board, tree, json, meter, countdown, toggle and quote', () => {
  const draw = (spec: object, data: object, o: object = { full: true }) => uiHtml(spec, { data, config: {}, at }, o)
  // a diff: its counts, each line by its kind; a preview cut with +N more
  const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old <b>\n+new\n same\n'
  const d = draw({ type: 'diff', value: '{{p}}' }, { p: patch })
  assert.match(d, /\+1<\/span><span class="t-bad">−1/)
  assert.match(d, /class="k-dl d" data-row>-old &lt;b&gt;</)
  assert.match(d, /class="k-dl a" data-row>\+new</)
  assert.match(d, /class="k-dl h" data-row>@@/)
  assert.match(draw({ type: 'diff', value: '{{p}}', limit: 2 }, { p: patch }, { cells: [3, 1] }), /\+5 more/)
  assert.match(draw({ type: 'diff', value: '{{p}}' }, { p: '@@ -1 +1 @@\n--- a SQL comment\n+++ big' }), /\+1<\/span><span class="t-bad">−1.*k-dl d" data-row>--- a SQL.*k-dl a" data-row>\+\+\+ big/, 'in a hunk: lines, not headers')
  // a log: the newest lines, the level by its word or the line's
  const lines = [{ text: 'a ok' }, { text: 'b failed hard' }, { text: 'c', level: 'warn' }, { text: 'd', time: '2026-10-17T09:10:03Z' }]
  const lg = draw({ type: 'log', each: 'lines', text: '{{text}}', level: '{{level}}', time: '{{time}}', limit: 3 }, { lines }, { cells: [3, 4] })
  assert.match(lg, /\+1 more.*k-lg-l t-bad" data-row><span class="k-lg-x">b failed/, 'the newest three, the older behind +1 more')
  assert.doesNotMatch(lg, /a ok/)
  assert.match(lg, /k-lg-l t-warn" data-row><span class="k-lg-x">c</)
  assert.match(lg, /k-lg-t">\d\d:\d\d:\d\d</)
  assert.match(uiHtml({ preview: { type: 'log', each: 'lines' }, full: { type: 'log', each: 'lines', limit: 1 } }, { data: { lines }, config: {}, at }, { full: true }), /data-extra hidden><span class="k-lg-x">a ok/, 'a full view with a limit: the older ones a click away')
  assert.match(draw({ type: 'log', value: 'one\ntwo ERROR\n' }, {}), /t-bad" data-row><span class="k-lg-x">two ERROR/)
  // steps: their words to a state
  const st = draw({ type: 'steps', each: 's', label: '{{n}}', state: '{{st}}' }, { s: [{ n: 'A', st: 'passed' }, { n: 'B', st: 'in progress' }, { n: 'C', st: 'error' }, { n: 'D', st: 'skipped' }, { n: 'E', st: '' }] })
  assert.deepEqual([...st.matchAll(/k-sp (\w+)/g)].map(m => m[1]), ['done', 'now', 'fail', 'skip', 'todo'])
  // a board: the columns given first, even empty, then the rest as seen; +N more per column
  const bd = draw({ type: 'board', each: 'i', column: '{{s}}', columns: ['Todo', 'Done'], limit: 1 }, { i: [{ title: 'x', s: 'Doing' }, { title: 'y', s: 'Todo' }, { title: 'z', s: 'Todo' }] })
  assert.deepEqual([...bd.matchAll(/class="k-gh">([^<]*)<span class="k-sub">(\d+)/g)].map(m => `${m[1]} ${m[2]}`), ['Todo 2', 'Done 0', 'Doing 1'])
  assert.match(draw({ type: 'board', each: 'i', column: '{{s}}', limit: 1 }, { i: [{ title: 'y', s: 'Todo' }, { title: 'z', s: 'Todo' }] }, { cells: [3, 4] }), /\+1 more/, 'a preview: its limit per column')
  // a tree: nested, the first level open, a node never takes its parent's fields
  const tr = draw({ type: 'tree', each: 'f', label: '{{name}}', text: '{{size}}' }, { f: [{ name: 'src', size: '9 KB', children: [{ name: 'a.ts' }, { name: 'ui', children: [{ name: 'b.tsx', size: '1 KB' }] }] }] })
  assert.match(tr, /<details class="k-tr-d" open><summary class="k-tr-n"><span class="k-tr-l ">src<\/span><span class="k-sub">9 KB<\/span><span class="k-tr-c">2/)
  assert.match(tr, /<details class="k-tr-d"><summary class="k-tr-n"><span class="k-tr-l ">ui</, 'deeper: folded')
  assert.match(tr, /k-tr-l ">a.ts<\/span><\/div>/, 'no size of its own: none, not src’s')
  // json: escaped, folded past its levels
  const js = draw({ type: 'json', open: 1 }, { a: '<x>', n: 2, deep: { b: [true, null] } })
  assert.match(js, /<span class="k-js-k">a<\/span>: <span class="k-js-s">"&lt;x&gt;"/)
  assert.match(js, /<details class="k-js-d"><summary class="k-js-r"><span class="k-js-k">deep<\/span>: <span class="k-sub">\{1\}/)
  // a meter: each part's share of the whole; past it nothing
  const mt = draw({ type: 'meter', each: 'p', label: '{{n}}', value: '{{v}}', max: 200, title: 'Disk', unit: ' GB' }, { p: [{ n: 'a', v: 50 }, { n: 'b', v: 100 }, { n: 'c', v: 0 }] })
  assert.match(mt, /width:25\.0%.*width:50\.0%/)
  assert.match(mt, /<b>150 GB of 200 GB<\/b>/)
  assert.doesNotMatch(mt, />c</, 'zero: no part')
  // a countdown: in, soon (warn), past (ago, or its words)
  const cd = (to: number, extra = {}) => draw({ type: 'countdown', to: '{{t}}', label: 'go', ...extra }, { t: to })
  assert.match(cd(Date.now() + 3 * 86_400_000 + 7_230_000), /class="k-cd"[^>]*><b>in 3d 2h<\/b><span>go/)
  assert.match(cd(Date.now() + 90 * 60_000 + 30_000), /class="k-cd t-warn"[^>]*><b>in 1h 3\dm/)
  assert.match(cd(Date.now() - 3 * 3_600_000), /class="k-cd t-muted"[^>]*><b>3 hours ago/)
  assert.match(cd(Date.now() - 1000, { past: 'Frozen' }), /<b>Frozen<\/b>/)
  assert.match(draw({ type: 'countdown', to: 'nope' }, {}), /<b>–<\/b>/)
  // a toggle: runs its action with what it's turned to; checked as a run
  assert.match(draw({ type: 'toggle', label: 'Flag', on: 'f', run: 'flag' }, { f: true }), /role="switch" aria-checked="true" class="k-toggle on"[^>]* data-run="flag" data-arg="off"/)
  assert.match(draw({ type: 'toggle', label: 'Flag', on: 'f', run: 'flag' }, { f: false }), /aria-checked="false"[^>]* data-arg="on"/)
  assert.match(uiCheck({ type: 'toggle', label: 'x', run: 'flg' }, {}, { actions: ['flag'] })[0].text, /runs flg, which isn't one of widget.json's actions \(did you mean flag\?\)/)
  // a quote: its source a link only when it's one
  assert.match(draw({ type: 'quote', text: 'hi', by: 'me', href: 'https://x.dev' }, {}), /<figcaption>— <a href="https:\/\/x.dev"/)
  assert.doesNotMatch(draw({ type: 'quote', text: 'hi', by: 'me', href: 'javascript:alert(1)' }, {}), /javascript/)
  // the rows' field check still reads a heatmap's value and a table's columns
  assert.match(uiCheck({ type: 'heatmap', each: 'd', value: '{{nn}}' }, { d: [{ n: 1 }] })[0].text, /value uses nn/)
  assert.match(uiCheck({ type: 'tree', each: 'd', label: '{{nme}}' }, { d: [{ name: 'a' }] })[0].text, /label uses nme/)
})

test('UI kit: table cells with pictures, bars, lines and buttons; accordion, breadcrumbs, gallery, loading', () => {
  const draw = (spec: object, data: object, o: object = { full: true }) => uiHtml(spec, { data, config: {}, at }, o)
  const rows = [{ login: 'octocat', name: 'The <Octocat>', role: 'Design', d: 3, t: 4, week: [1, 3, 2], pic: 'javascript:alert(1)', id: 7 }]
  // a picture with a name and a line under it; a bar of how far along; a badge, a line, copy and a button
  const tb = draw({ type: 'table', each: 'r', columns: [{ title: 'Who', avatar: '{{login}}', value: '{{name}}', subtitle: '{{role}}' }, { title: 'Done', progress: '{{d}}', max: '{{t}}', color: 'bad' }, { title: 'Of', progress: '{{d}}', max: '{{t}}', value: '{{d}}/{{t}}' }, { title: 'Pic', image: '{{pic}}', value: 'x' }, { title: 'More', badge: 'new', spark: 'week', copy: true, value: '{{id}}', actions: [{ label: 'Review', run: 'review', arg: '{{id}}' }] }, { title: 'Plain', value: '{{role}}' }] }, { r: rows })
  assert.match(tb, /<div class="k-tc"><img class="k-av" src="https:\/\/avatars\.githubusercontent\.com\/octocat\?s=40"[^>]*><div class="k-main"><span><span class="">The &lt;Octocat&gt;<\/span><\/span><span class="k-sub">Design<\/span>/)
  assert.match(tb, /<span class="k-tbar" style="color:var\(--error[^"]*"><span class="k-bar"><i style="width:75%"><\/i><\/span><b>75%<\/b>/)
  assert.match(tb, /<i style="width:75%"><\/i><\/span><b>3\/4<\/b>/, 'its value: the bar’s words')
  assert.doesNotMatch(tb, /javascript/, 'a picture that isn’t data: or https: none')
  assert.match(tb, /<span class="k-badge ">new<\/span><span class="k-tc-sp"><svg class="spark"[^]*data-copy="7"[^]*data-run="review" data-arg="7"/)
  assert.match(tb, /<td class=""><span class="">Design<\/span><\/td>/, 'a column of words alone: as before')
  assert.match(draw({ type: 'table', each: 'r', columns: [{ avatar: '{{login}}', href: 'https://github.com/{{login}}' }] }, { r: rows }), /<td class=""><div class="k-tc"><a class="link k-tc-a" href="https:\/\/github\.com\/octocat"[^>]*><img class="k-av"/, 'a picture alone links too')
  assert.match(draw({ type: 'table', each: 'r', columns: [{ progress: '{{d}}', max: 2 }] }, { r: rows }), /width:100%/, 'past its max: full')
  const problems = uiCheck({ type: 'table', each: 'r', columns: [{ title: 'x', icon: 'nope', actions: [{ label: 'Go', run: 'gone' }], color: 'nocolor' }] }, { r: rows }, { actions: ['review'] })
  assert.deepEqual(problems.map(p => p.level).sort(), ['error', 'warn', 'warn'], JSON.stringify(problems))
  // a row's progress at its end
  assert.match(draw({ type: 'list', each: 'r', title: '{{name}}', accessories: [{ progress: '{{d}}', max: '{{t}}', tone: 'good' }] }, { r: rows }), /<span class="k-tbar sm t-good"><span class="k-bar"><i style="width:75%">/)
  // an accordion: one name (one open at a time), the first open; multiple: no name; -1: none open; its panels' elements
  const faq = { f: [{ q: 'A?', a: 'yes' }, { q: 'B?', a: 'no' }, { q: '<C>?', a: 'maybe' }] }
  const ac = draw({ type: 'accordion', each: 'f', title: '{{q}}', text: '{{a}}' }, faq)
  assert.equal([...ac.matchAll(/<details class="k-ad" name="(ka-[\w-]+)"/g)].map(m => m[1]).filter((x, i, l) => l.indexOf(x) === i).length, 1)
  assert.equal([...ac.matchAll(/ open>/g)].length, 1)
  assert.match(ac, /<span class="k-title ">&lt;C&gt;\?<\/span>/)
  assert.doesNotMatch(draw({ type: 'accordion', each: 'f', title: '{{q}}', multiple: true }, faq), /name="ka-/)
  assert.doesNotMatch(draw({ type: 'accordion', each: 'f', title: '{{q}}', open: -1 }, faq), / open>/)
  assert.match(draw({ type: 'accordion', each: 'f', title: '{{q}}' }, faq, { cells: [1, 1] }), /\+2 more/, 'a preview: the panels that fit')
  assert.match(draw({ type: 'accordion', items: [{ title: 'Numbers', badge: '2', children: [{ type: 'progress', value: '{{n}}' }] }] }, { n: 40 }), /<span class="k-badge">2<\/span><\/summary><div class="k-ad-b"><div class="k-prog"/)
  assert.match(JSON.stringify(uiCheck({ type: 'accordion', each: 'f', title: '{{q}}', children: [{ type: 'text', value: '{{nope}}' }] }, faq)), /children uses nope/, 'its children over each panel’s row')
  assert.match(JSON.stringify(uiCheck({ type: 'accordion', items: [{ title: 'x', children: [{ type: 'nope' }] }] })), /items\[0\]\.children\[0\].*no element nope/)
  // breadcrumbs: words, links, a bad link as words
  const bc = draw({ type: 'breadcrumbs', items: ['acme', { label: 'web', href: 'https://github.com/acme/web' }, { label: 'x', href: 'javascript:alert(1)' }] }, {})
  assert.equal([...bc.matchAll(/class="k-cr"/g)].length, 3)
  assert.match(bc, /<a href="https:\/\/github\.com\/acme\/web"[^>]*><span>web<\/span><\/a>/)
  assert.doesNotMatch(bc, /javascript/)
  assert.equal([...draw({ type: 'breadcrumbs', each: 'p' }, { p: ['acme', 'web'], label: 'no' }).matchAll(/<span>(\w+)<\/span>/g)].map(m => m[1]).join(' '), 'acme web', 'each: a string item is its words')
  assert.doesNotMatch(draw({ type: 'breadcrumbs', items: [{ icon: 'github' }] }, { label: 'no' }), />no</, 'a written one takes nothing from the data')
  // a gallery: data: and https pictures only, captions, links; none: Nothing here
  const gl = draw({ type: 'gallery', each: 'p', src: '{{u}}', caption: '{{c}}', href: '{{u}}' }, { p: [{ u: 'https://example.com/a.png', c: '<A>' }, { u: 'javascript:x', c: 'bad' }] })
  assert.match(gl, /<figure class="k-gl-i" data-open="https:\/\/example\.com\/a\.png" title="&lt;A&gt;"><img src="https:\/\/example\.com\/a\.png" alt="&lt;A&gt;" style="height:160px"/)
  assert.doesNotMatch(gl, /bad/)
  assert.match(draw({ type: 'gallery', each: 'p' }, { p: ['javascript:x'] }), /k-empty/)
  // loading: a spinner, dots or a bar, its words
  assert.match(draw({ type: 'loading', label: '<x>' }, {}), /class="k-load spinner" role="status"><i class="k-ld-s"><\/i><span>&lt;x&gt;<\/span>/)
  assert.match(draw({ type: 'loading', style: 'dots', size: 'lg' }, {}), /k-load dots s-lg[^]*k-ld-d/)
  assert.match(draw({ type: 'loading', style: 'bar', color: 'teal' }, {}), /k-load bar" style="color:var\(--tc-teal[^]*k-ld-b/)
})

test('UI kit: the extension guide, its catalog and examples, fits what Laki AI reads of it', async () => {
  const g = tools((() => Promise.reject(new Error('no daemon'))) as never).find(t => t.name === 'laki_extension_guide')!
  const text = String(await g.run({}))
  assert.ok(g.max && text.length <= g.max, `${text.length} of ${g.max}: past it, the guide's last examples are cut`)
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

test('UI kit: a filter matches a row by its words, not its buttons’', () => {
  const listeners: Record<string, (e: any) => void> = {}
  uiBehave({ addEventListener: (t: string, f: any) => (listeners[t] = f), removeEventListener: () => {} }, () => {})
  const text = (data: string) => ({ nodeType: 3, data })
  const node = (localName: string, ...childNodes: object[]) => ({ nodeType: 1, localName, childNodes, hidden: false, hasAttribute: () => false })
  const rows = [node('tr', node('td', text('Mona Lisa')), node('td', node('button', text('Profile')))), node('tr', node('td', text('Hubot')), node('td', node('button', text('Profile'))))]
  const box = { hasAttribute: () => false, querySelector: () => null, querySelectorAll: (q: string) => (q === '[data-row]' ? rows : []) }
  const filter = (value: string) => listeners.input({ target: { closest: (q: string) => (q === '[data-filter]' ? { value, closest: () => box } : null) } })
  filter('pro')
  assert.deepEqual(rows.map(r => r.hidden), [true, true], 'a button’s label matches no row')
  filter('hub')
  assert.deepEqual(rows.map(r => r.hidden), [true, false])
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

test('UI kit: an extension with its refresh button and when it was fetched hidden', async t => {
  const spec = { type: 'stack', children: [{ type: 'row', children: [{ type: 'text', value: 'Disk' }, { type: 'toolbar', items: [{ icon: 'refresh', label: 'Refresh', refresh: true }, { icon: 'copy', label: 'Copy', copy: 'x' }] }] }, { type: 'text', value: 'checked {{ago at}}' }, { type: 'text', value: 'at {{data.at}}' }, { type: 'list', each: 'rows', title: '{{name}}', subtitle: '{{ago at}}' }, { type: 'text', value: 'live now', if: 'at' }, { type: 'text', value: 'toned', tone: '{{#if at}}good{{/if}}' }] }
  const ctx = { data: { at: 'noon', rows: [{ name: 'a', at: at - 60_000 }] }, config: {}, at }
  const shown = uiHtml(spec, ctx, { full: true })
  assert.match(shown, /data-laki="refresh"/)
  assert.match(shown, /checked /)
  assert.match(shown, /live now/)
  const hid = uiHtml(spec, ctx, { full: true, hide: { refresh: true, at: true } })
  assert.doesNotMatch(hid, /data-laki="refresh"/, 'no refresh button')
  assert.match(hid, /data-copy="x"/, 'the other buttons stay')
  assert.doesNotMatch(hid, /checked/, 'a line that names at goes')
  assert.doesNotMatch(hid, /live now/, 'if: at no longer holds')
  assert.match(hid, /at noon/, "its data's own at stays")
  assert.match(hid, /toned/, 'a tone over at is no line about it')
  assert.match(hid, />a</, 'a list of rows stays, their own at too')
  assert.match(uiHtml(spec, { ...ctx, data: null, error: 'boom' }, { hide: { refresh: true } }), /Retry/, 'a failure still has Retry')

  const rig = await fresh(t)
  const d = join(rig.data, 'widgets', 'disk')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'widget.json'), JSON.stringify({ name: 'Disk', fetch: 'echo \'{"free": 9}\'', ui: spec }))
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'disk', on: true })
  await until(async () => (await rig.rpc('state')).widgets.find((x: any) => x.id === 'disk' && x.at), 'fetched')
  assert.match(await rig.rpc('widgetRender', { id: 'disk', full: true }), /checked .*data-laki="refresh"|data-laki="refresh".*checked /s)
  await rig.rpc('widgetSet', { id: 'disk', hide: { refresh: true } })
  await rig.rpc('widgetSet', { id: 'disk', hide: { at: true } })
  assert.deepEqual((await rig.rpc('state')).widgets.find((x: any) => x.id === 'disk').hide, { refresh: true, at: true }, 'each switch kept')
  const html = await rig.rpc('widgetRender', { id: 'disk', full: true })
  assert.doesNotMatch(html, /data-laki="refresh"|checked/)
  await rig.rpc('widgetSet', { id: 'disk', hide: { refresh: false, at: false } })
  assert.equal((await rig.rpc('state')).widgets.find((x: any) => x.id === 'disk').hide, undefined, 'both on again: nothing kept')
})

test('UI kit: hero, mockup, filter, rotate, compare, skeleton, radial, indicator, avatar, range, select, input, swap, pagination, menu, dropdown', () => {
  const draw = (spec: object, data: object = {}, o: object = { full: true }) => uiHtml(spec, { data, config: {}, at }, o)
  const bar = { cells: [3, 0.5] }
  // hero: its words escaped, a picture only data: or https
  const hr = draw({ type: 'hero', title: '{{t}}', image: '{{i}}', icon: 'ship', actions: [{ label: 'Go', run: 'go' }] }, { t: '<b>', i: 'javascript:x' })
  assert.match(hr, /<div class="k-hero-t">&lt;b&gt;<\/div>/)
  assert.match(hr, /k-hero-ic/, 'a bad picture: the icon instead')
  assert.doesNotMatch(hr, /javascript/)
  // mockup: a terminal's prompts, a browser's address (a link it opens), never a bad one
  assert.match(draw({ type: 'mockup', kind: 'terminal', value: '$ ls -la\nREADME.md' }), /<div class="cmd"><span class="k-mk-p">\$<\/span>ls -la<\/div><div>README\.md<\/div>/)
  assert.match(draw({ type: 'mockup', url: 'https://acme.dev/x' }), /<span class="k-mk-url" data-open="https:\/\/acme\.dev\/x" title="https:\/\/acme\.dev\/x">acme\.dev\/x<\/span>/)
  assert.doesNotMatch(draw({ type: 'mockup', url: 'javascript:alert(1)' }), /data-open/, 'its words only')
  // filter: All on, a chip per option
  const fl = draw({ type: 'filter', options: ['bug', { value: 'ui', label: 'Design' }], children: [{ type: 'list', each: 'r', title: '{{t}}' }] }, { r: [{ t: 'a' }] })
  assert.deepEqual([...fl.matchAll(/data-chip="([^"]*)" aria-pressed="(\w+)">([^<]*)/g)].map(m => m.slice(1).join(':')), [':true:All', 'bug:false:bug', 'ui:false:Design'])
  assert.match(fl, /data-filt>[^]*data-rows/)
  // rotate: its words in turn; one word stays
  assert.match(draw({ type: 'rotate', items: ['a', '<b>', ''], seconds: 999 }), /style="--n:2;--s:60s"><span>a<\/span><span>&lt;b&gt;<\/span>/)
  assert.match(draw({ type: 'rotate', each: 'w' }, { w: ['solo'] }), /<b class="k-rot-1">solo<\/b>/)
  // compare: two good pictures, else nothing to compare
  const pic = 'https://example.com/a.png'
  assert.match(draw({ type: 'compare', before: pic, after: 'javascript:x' }), /k-empty/)
  assert.match(draw({ type: 'compare', before: pic, after: pic, labels: ['Old', 'New'] }), /style="height:260px"[^]*<span class="k-cmp-l r">New<\/span>[^]*<span class="k-cmp-l">Old<\/span>[^]*k-cmp-r/)
  assert.match(draw({ type: 'compare', before: pic, after: pic, labels: ['Old'] }, {}, bar), /height:16px(?![^]*k-cmp-l)/, 'a bar: no labels')
  // skeleton, radial
  assert.equal([...draw({ type: 'skeleton', lines: 4, avatar: true }).matchAll(/<i class="k-sk"/g)].length, 4)
  assert.match(draw({ type: 'radial', value: 41, max: 50, label: 'Disk' }), /aria-label="Disk: 82%"[^]*stroke-dasharray="82 100"/)
  assert.match(draw({ type: 'radial', value: 0 }), /stroke-linecap="butt" stroke-dasharray="0 100"/)
  // indicator: no badge at 0 or empty; a dot when it holds
  assert.match(draw({ type: 'indicator', icon: 'inbox', badge: '{{n}}' }, { n: 3 }), /<b class="k-ind-b "><span>3<\/span><\/b>/)
  assert.doesNotMatch(draw({ type: 'indicator', icon: 'inbox', badge: '{{n}}' }, { n: 0 }), /k-ind-b/)
  assert.match(draw({ type: 'indicator', label: 'CI', dot: 'live' }, { live: true }), /<span class="k-ind-x box"><span>CI<\/span><\/span><i class="k-ind-d /)
  // avatar: a login's big picture, initials, a known shape
  assert.match(draw({ type: 'avatar', login: 'octocat', shape: 'hexagon', ring: 'green' }), /k-avt sh-hexagon ring" style="--ring:var\(--tc-green[^]*src="https:\/\/avatars\.githubusercontent\.com\/octocat\?s=200"/)
  assert.match(draw({ type: 'avatar', name: 'Ada Byron', shape: 'blob' }), /sh-circle[^]*<span class="k-avt-i">AB<\/span>/)
  // range and select run on change, never on a click; none to run: disabled
  const rg = draw({ type: 'range', value: 150, max: 100, step: 5, run: 'rollout', label: 'Rollout' })
  assert.match(rg, /<span data-rv>100<\/span>[^]*type="range" min="0" max="100" step="5" value="100" aria-label="Rollout" data-change="rollout"/)
  assert.doesNotMatch(rg, /data-run/)
  assert.match(draw({ type: 'range', value: 3 }), / disabled>/)
  const sl = draw({ type: 'select', options: ['a', 'b'], value: 'z', run: 'pick' })
  assert.match(sl, /data-change="pick"><option value="z" selected>z<\/option><option value="a">a<\/option>/, 'the one picked now, though the options lack it')
  assert.match(draw({ type: 'select', options: ['a'] }), /disabled><option value="" selected disabled>/)
  // input: its button takes what's typed
  assert.match(draw({ type: 'input', placeholder: 'Add', run: 'add', clear: false }), /<input type="text" value="" placeholder="Add"[^>]*><button type="button" class="k-btn sm primary" data-run="add" data-input data-keep>/)
  // swap: on, its arg the other way
  assert.match(draw({ type: 'swap', icons: ['bellOff', 'bell'], on: 'w', run: 'watch' }, { w: true }), /role="switch" aria-checked="true" class="k-swap on bare"[^]*data-arg="off"/)
  // pagination: the pages near this one, the first and last, gaps; a bar's n/m
  const pg = (o: object, page = 6) => draw({ type: 'pagination', page, pages: 20, run: 'page' }, {}, o)
  const nums = (html: string) => [...html.matchAll(/class="k-pg-b pn[^"]*"[^>]*>(\d+)<|k-pg-gap/g)].map(m => m[1] ?? '…').join(' ')
  assert.equal(nums(pg({ full: true })), '1 … 4 5 6 7 8 … 20')
  assert.equal(nums(pg({ cells: [2, 1] })), '1 … 5 6 7 … 20')
  assert.match(pg(bar), /<span class="k-pg-n">6\/20<\/span>/)
  assert.match(pg({ full: true }), /aria-label="Previous page" data-run="page" data-arg="5"[^]*aria-label="Next page" data-run="page" data-arg="7"/)
  assert.match(pg({ full: true }, 1), /aria-label="Previous page" disabled/)
  // menu: headings, the current row, a badge; dropdown: its items, in a bar the full view
  const mn = draw({ type: 'menu', items: [{ title: 'Go' }, { label: 'Board', on: true, open: 'laki://board' }, { label: 'PRs', badge: '{{n}}', run: 'prs' }, { label: 'Nothing' }] }, { n: 4 })
  assert.match(mn, /<div class="k-mn-h" data-sect>Go<\/div><button type="button" class="k-mn-i on" data-label="Board" data-open="laki:\/\/board" aria-current="true" data-row>/)
  assert.match(mn, /data-run="prs" data-row>[^]*<span class="k-badge">4<\/span>/)
  assert.match(mn, /class="k-mn-i" data-label="Nothing" disabled data-row><span class="k-title ">Nothing/)
  assert.match(draw({ type: 'dropdown', items: [{ label: 'Wipe', confirm: 'Sure?' }] }), /class="k-mn-i" data-label="Wipe" disabled>/, 'a confirm with nothing to do: disabled')
  assert.deepEqual(uiCheck({ type: 'menu', limit: 3, empty: 'None', items: [{ label: 'a' }] }), [])
  // past a full view's limit a heading is hidden with its rows; over each, a row's label by default
  const cut = { type: 'menu', limit: 1, items: [{ label: 'a', run: 'x' }, { title: 'Later' }, { label: 'b', run: 'x' }] }
  assert.match(draw({ preview: cut, full: cut }), /<div class="k-mn-h" data-sect data-extra hidden>Later/)
  assert.match(draw({ type: 'menu', each: 'l', open: '{{url}}' }, { l: [{ label: 'Docs', url: 'https://acme.dev' }] }), /<span class="k-title ">Docs<\/span>/)
  assert.match(draw({ type: 'compare', before: 'https://example.com/a.png', after: 'https://example.com/a.png', height: 300 }, {}, { cells: [3, 0.5] }), /height:16px/, 'a bar: one line, whatever its height')
  assert.equal(uiCheck({ type: 'input', icon: 'nope', run: 'a' }).length, 1, 'a bad icon said once')
  const dd = { type: 'dropdown', label: 'More', items: [{ label: 'Redeploy', run: 'redeploy' }, { label: 'Hidden', run: 'x', if: 'no' }] }
  assert.match(draw(dd), /<details class="k-dd"><summary class="k-dd-s"><span>More<\/span>[^]*<div class="k-dd-m"><button[^>]*data-run="redeploy"/)
  assert.doesNotMatch(draw(dd), /Hidden/)
  assert.match(draw(dd, {}, bar), /<summary class="k-dd-s" data-laki="full">/)
  // the checker: their runs, a swap's icons, a ring's color
  const pr = uiCheck({ type: 'stack', children: [{ type: 'range', run: 'nope' }, { type: 'swap', icons: ['bell', 'nope'] }, { type: 'menu', items: [{ label: 'x', run: 'gone' }] }, { type: 'avatar', ring: 'nocolor' }] }, undefined, { actions: ['go'] })
  assert.deepEqual(pr.map(p => `${p.level} ${p.where.replace(/.*\(/, '(')}`), ['error (range)', 'warn (swap)', 'error (menu).items[0]', 'warn (avatar)'])
})

test('UI kit: a filter chip, an input, a slider and a pick, as clicks and keys', () => {
  const sent: any[] = []
  const on: Record<string, (e: any) => void> = {}
  uiBehave({ addEventListener: (t: string, f: any) => (on[t] = f), removeEventListener: () => {} }, m => (sent.push(m), Promise.resolve()))
  // chips: the rows with its words; clicked again, all
  const text = (data: string) => ({ nodeType: 3, data })
  const row = (w: string) => ({ nodeType: 1, localName: 'div', childNodes: [text(w)], hidden: false, hasAttribute: () => false })
  const rows = [row('Fix login: failing'), row('Search: passing')]
  const rowsBox = { hasAttribute: () => false, querySelector: () => null, querySelectorAll: (q: string) => (q === '[data-row]' ? rows : []) }
  const chip = (v: string) => ({ v, attrs: { 'aria-pressed': 'false' } as Record<string, string>, classList: { list: new Set<string>(), contains(c: string) { return this.list.has(c) }, toggle(c: string, x: boolean) { x ? this.list.add(c) : this.list.delete(c) } }, getAttribute(k: string) { return k === 'data-chip' ? this.v : null }, setAttribute(k: string, x: string) { this.attrs[k] = x } })
  const chips = [chip(''), chip('failing')]
  const filt = { querySelectorAll: (q: string) => (q === '[data-chip]' ? chips : q === '[data-rows]' ? [rowsBox] : []) }
  const press = (c: ReturnType<typeof chip>) => on.click({ target: { closest: (q: string) => (q === '[data-chip]' ? { ...c, closest: () => filt, classList: c.classList, getAttribute: c.getAttribute.bind(c) } : null) }, preventDefault() {} })
  press(chips[1])
  assert.deepEqual(rows.map(r => r.hidden), [false, true])
  assert.deepEqual(chips.map(c => c.attrs['aria-pressed']), ['false', 'true'])
  press(chips[1])
  assert.deepEqual(rows.map(r => r.hidden), [false, false], 'the same chip again: every row')
  assert.deepEqual(chips.map(c => c.attrs['aria-pressed']), ['true', 'false'])
  // an input's button: the typed words as its arg, the box emptied once it ran; nothing typed: nothing runs
  const box = { value: '  Buy milk ', focus() { this.focused = true }, focused: false }
  const attrs: Record<string, string> = { 'data-run': 'add', 'data-input': '' }
  const btn: any = { textContent: 'Add', getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs, setAttribute: (k: string, v: string) => (attrs[k] = v), removeAttribute: (k: string) => delete attrs[k], matches: (q: string) => q === '[data-run]', closest: (q: string) => (q === '[data-inbox]' ? { querySelector: () => box } : q.includes('[data-run]') ? btn : null), click: () => on.click({ target: btn, preventDefault() {} }) }
  on.keydown({ key: 'Enter', target: { localName: 'input', closest: (q: string) => (q === '[data-inbox]' ? { querySelector: () => btn } : null) }, preventDefault() {} })
  assert.deepEqual(sent.pop(), { laki: 'run', action: 'add', arg: 'Buy milk', label: 'Add', confirm: undefined })
  return Promise.resolve().then(() => {
    assert.equal(box.value, '')
    on.click({ target: btn, preventDefault() {} })
    assert.equal(sent.length, 0)
    assert.ok(box.focused)
    // a slider let go, an option picked: their action with the value
    on.change({ target: { closest: () => ({ value: 40, getAttribute: (k: string) => ({ 'data-change': 'rollout', 'aria-label': 'Rollout' })[k] ?? null }) } })
    assert.deepEqual(sent, [{ laki: 'run', action: 'rollout', arg: '40', label: 'Rollout 40', confirm: undefined }])
  })
})

test('UI kit: a slider whose run is declined goes back to its value', async () => {
  const on: Record<string, (e: any) => void> = {}
  uiBehave({ addEventListener: (t: string, f: any) => (on[t] = f), removeEventListener: () => {} }, () => Promise.resolve(false))
  const rv = { textContent: '40' }
  const t: any = { localName: 'input', value: '40', defaultValue: '25', getAttribute: (k: string) => (k === 'data-change' ? 'rollout' : null), closest: (q: string) => (q === '[data-change]' ? t : { querySelector: () => rv }) }
  on.change({ target: t })
  assert.equal(t.disabled, true, 'one run at a time')
  await new Promise(r => setTimeout(r, 0))
  assert.equal(t.value, '25')
  assert.equal(rv.textContent, '25')
  assert.equal(t.disabled, false)
  // a dropdown: the focus gone elsewhere closes it; to its own menu, it stays
  const dd: any = { open: true, contains: (x: unknown) => x === inMenu }
  const inMenu = {}
  const summary = { closest: () => dd }
  on.focusout({ target: summary, relatedTarget: inMenu })
  assert.equal(dd.open, true)
  on.focusout({ target: summary, relatedTarget: null })
  assert.equal(dd.open, false)
})

test('UI kit: popover, command, combobox, datepicker, split, radio, textarea and the developer ones', () => {
  const draw = (spec: object, data: object = {}, o: object = { full: true }) => uiHtml(spec, { data, config: {}, at }, o)
  const bar = { cells: [3, 0.5] }
  // popover: a native one its button opens; a bar's opens the full view
  const pop = draw({ type: 'popover', label: 'Details', title: '{{t}}', hover: true, children: [{ type: 'text', value: 'x' }] }, { t: '<b>' })
  const id = /popovertarget="(kp-[^"]+)"/.exec(pop)?.[1]
  assert.ok(id && pop.includes(`id="${id}" popover`), pop)
  assert.match(pop, /class="k-pop hover"[^]*<div class="k-pop-t">&lt;b&gt;<\/div>/)
  assert.match(draw({ type: 'popover', label: 'D', children: [] }, {}, bar), /data-laki="full"(?![^]*popover)/)
  // command: a box that sifts its rows, its words when none is left, a row's keys; a bar's a button to the full view
  const cmd = draw({ type: 'command', items: [{ title: 'Go' }, { label: 'Board', open: 'laki://board', keys: '⌘ B' }, { label: 'Deploy', run: 'deploy' }] })
  assert.match(cmd, /<input type="search" data-filter[^]*<div class="k-mn-h" data-sect>Go<\/div>[^]*data-label="Board"[^]*<kbd>⌘<\/kbd><kbd>B<\/kbd>[^]*data-run="deploy" data-row>[^]*data-none hidden>Nothing matches/)
  assert.match(draw({ type: 'command', items: [] }, {}, bar), /k-cmd-l" data-laki="full"/)
  // combobox: a field's options as they are (never a template), written ones filled; its button keeps the words
  const cb = draw({ type: 'combobox', options: 'b', run: 'checkout' }, { b: ['main', '{{x}}', { value: 'v', label: 'Vee' }], x: 'no' })
  assert.match(cb, /list="(kc-[^"]+)"[^]*<datalist id="\1"><option value="main"><\/option><option value="\{\{x\}\}"><\/option><option value="v" label="Vee"><\/option><\/datalist>/)
  assert.match(cb, /data-run="checkout" data-input data-keep/)
  assert.match(draw({ type: 'combobox', options: ['{{x}}'] }, { x: 'dev' }), /<option value="dev">[^]* disabled>/, 'nothing to run: disabled')
  // datepicker: its kind's input, the value in its shape, on change
  assert.match(draw({ type: 'datepicker', value: '2026-10-24 15:30', kind: 'datetime', min: '2026-10-01', run: 'r' }), /type="datetime-local" value="2026-10-24T15:30" min="2026-10-01T00:00" aria-label="datetime" data-change="r"/)
  assert.match(draw({ type: 'datepicker', value: '2026-10-24T15:30', kind: 'time' }), /type="time" value="15:30"[^>]* disabled/)
  assert.match(draw({ type: 'datepicker', value: 'soon', kind: 'month' }), /type="month" value=""/)
  // split: its button, the others in a menu; a bar's menu is the full view
  const sp = { type: 'split', label: 'Merge', run: 'merge', items: [{ label: 'Rebase', run: 'merge', arg: 'rebase' }, { label: 'No', run: 'x', if: 'no' }] }
  assert.match(draw(sp), /<div class="k-split"><button type="button" class="k-btn" data-run="merge"[^]*<details class="k-dd end">[^]*data-label="Rebase" data-run="merge" data-arg="rebase"/)
  assert.doesNotMatch(draw(sp), /"No"/)
  assert.match(draw(sp, {}, bar), /k-split-s" data-laki="full"/)
  assert.doesNotMatch(draw({ type: 'split', label: 'Go', run: 'go' }), /details/, 'no others: the button alone')
  assert.deepEqual(uiCheck(sp, undefined, { actions: ['merge'] }).map(p => p.where.replace(/.*\(split\)/, '')), ['.items[1]'], 'its others’ actions too')
  // radio: the picked one runs nothing, the others their value
  const ro = draw({ type: 'radio', value: '{{v}}', run: 'pick', options: ['a', { value: 'b', label: 'Bee', text: 'more' }] }, { v: 'a' })
  assert.match(ro, /aria-checked="true" class="k-ro on" data-label="a"><span/)
  assert.match(ro, /aria-checked="false" class="k-ro" data-label="Bee" data-run="pick" data-arg="b">[^]*<span class="k-ro-t">more<\/span>/)
  assert.match(draw({ type: 'radio', options: ['a', 'b'] }), /data-label="b" disabled/)
  // textarea: a run, else a do (the prompt is what's typed), else disabled; rows kept to 2-12, a preview's 2
  assert.match(draw({ type: 'textarea', do: 'new', agent: 'codex', rows: 40 }), /<textarea rows="12"[^]*data-do="\{&quot;do&quot;:&quot;new&quot;,&quot;agent&quot;:&quot;codex&quot;\}" data-input>/)
  assert.match(draw({ type: 'textarea', run: 'note', do: 'ai' }), /data-run="note" data-input>/, 'a run wins')
  assert.match(draw({ type: 'textarea', do: 'rm' }), /<textarea rows="3"[^>]* disabled>[^]*class="k-btn sm primary" disabled/)
  assert.match(draw({ type: 'textarea', run: 'n', rows: 6 }, {}, { cells: [2, 2] }), /rows="2"/)
  assert.match(draw({ type: 'textarea', run: 'n', placeholder: 'Note' }, {}, bar), /data-laki="full"><span>Note<\/span>/)
  assert.deepEqual(uiCheck({ type: 'textarea', do: 'rm' }, undefined, { actions: [] }).map(p => p.level), ['error'])
  // snippet: tabs, a prompt's $, copies the command alone
  assert.match(draw({ type: 'snippet', items: [{ label: 'npm', value: 'npm i x' }, { label: 'bun', value: 'bun add x' }], prompt: true }), /<input type="radio" name="(ks-[^"]+)" checked><span>npm[^]*name="\1"><span>bun[^]*<span class="k-snip-d">\$<\/span>npm i x<\/code><\/pre><button type="button" class="k-copy quiet" data-copy="npm i x"/)
  // env: secrets by their names hidden until a click; the whole list as a .env
  const env = draw({ type: 'env', each: 'v' }, { v: [{ key: 'API_TOKEN', value: 'abc' }, { key: 'HOST', value: 'a b' }, { key: 'DEBUG', value: '1', secret: true }] })
  assert.match(env, /API_TOKEN<\/code><details class="k-sc">[^]*HOST<\/code><code class="k-env-v mono">a b<\/code>[^]*DEBUG<\/code><details class="k-sc">/)
  assert.match(env, /data-copy="API_TOKEN=abc\nHOST=&quot;a b&quot;\nDEBUG=1"><svg[^]*Copy as \.env/)
  // uptime: a tick a day by its state, the gaps none
  assert.match(draw({ type: 'uptime', each: 'd', x: '{{day}}', title: 'API', value: '99%' }, { d: [{ day: 'Mon', state: 'up' }, { day: 'Tue', state: 'down' }, { day: 'Wed' }] }), /<b>99%<\/b>[^]*t-good" title="Mon · up">[^]*t-bad" title="Tue · down">[^]*none" title="Wed · no data">/)
  // deploys, issues, endpoints, changelog
  assert.match(draw({ type: 'deploys', each: 'd', env: '{{env}}' }, { d: [{ state: 'building', title: 'x', env: 'Production' }, { state: 'error', title: 'y' }] }), /t-warn live" title="building"[^]*k-tag t-accent">Production[^]*t-bad" title="error"/)
  assert.match(draw({ type: 'issues', each: 'i', priority: '{{p}}', labels: 'ls' }, { i: [{ id: 'A-1', state: 'In Review', title: '<x>', p: 'High', ls: [{ name: 'bug', color: 'red' }, 'ui'] }] }), /title="Priority: high">[^]*k-is-s review" title="In Review"[^]*&lt;x&gt;[^]*background:var\(--tc-red[^]*>bug<\/span><span class="k-tag">ui<\/span>/)
  assert.match(draw({ type: 'endpoints', each: 'e', status: '{{s}}' }, { e: [{ method: 'delete', path: '/a/:id/{b}', s: 404 }] }), /color:var\(--tc-red[^>]*>DELETE<\/span>[^]*\/a\/<span class="k-ep-v">:id<\/span>\/<span class="k-ep-v">\{b\}<\/span>[^]*k-ep-s t-warn">404/)
  const chl = draw({ type: 'changelog', each: 'r' }, { r: [{ version: 'v2', changes: ['feat(ui)!: no more v1', { type: 'fix', text: 'a crash' }, 'plain words', 'chore: deps'] }] })
  assert.deepEqual([...chl.matchAll(/<li>(?:<span class="k-chl-t t-(\w+)">(\w+)<\/span>)?<span>([^<]*)/g)].map(m => m.slice(1).join(' ').trim()), ['bad breaking no more v1', 'accent fix a crash', 'plain words', 'muted chore deps'])
  // clock: a zone's time, ticked by uiBehave; a zone that isn't one says so
  const ck = draw({ type: 'clock', items: [{ label: 'UTC', zone: 'UTC' }, { label: 'Mars', zone: 'Mars/Base' }] })
  assert.match(ck, /data-clock="UTC">\d{2}:\d{2}<\/b>/)
  assert.match(ck, /Mars<\/span><span class="k-sub">no such time zone<\/span><\/div><b class="k-clk-t">–<\/b>/)
  // funnel: each step of the first and of the one before; a bar's first → last
  const fn = { type: 'funnel', items: [{ label: 'a', value: 200 }, { label: 'b', value: 50 }, { label: 'c', value: 0 }] }
  assert.match(draw(fn), /width:25\.0%[^]*<span class="k-fn-p">25%<\/span><span class="k-fn-d t-bad">−75%<\/span>[^]*k-fn-d t-bad">−100%/)
  assert.match(draw(fn, {}, bar), /<b>200<\/b> → <b>0<\/b><span class="k-sub">0%<\/span>/)
  // swatches: only colors that are colors
  assert.equal([...draw({ type: 'swatches', items: ['#fff', 'red;}x', 'teal'] }).matchAll(/class="k-sw"/g)].length, 2)
  // matrix: a cell per row and column, its mark by state; a bar's counts
  const mx = { type: 'matrix', each: 'j', href: '{{u}}' }
  const jobs = { j: [{ row: 'N18', column: 'linux', state: 'success', u: 'javascript:x' }, { row: 'N20', column: 'mac', state: 'failure' }] }
  assert.match(draw(mx, jobs), /<th>linux<\/th><th>mac<\/th>[^]*<th>N18<\/th><td class="t-good" title="N18 · linux: success">[^]*<\/td><td><\/td><\/tr>/)
  assert.doesNotMatch(draw(mx, jobs), /javascript/)
  assert.match(draw(mx, jobs, bar), /k-mx-line"><span class="t-good">[^]*1<\/span><span class="t-bad">[^]*1<\/span><\/span>/)
  // marquee: twice, the second hidden from readers; bento: spans kept to its columns, a bad link none
  assert.match(draw({ type: 'marquee', items: ['a'], seconds: 1 }), /--s:2s[^]*<div class="k-mq-g" aria-hidden="true" inert>/)
  assert.equal(new Set([...draw({ type: 'marquee', children: [{ type: 'snippet', items: [{ label: 'a', value: 'x' }, { label: 'b', value: 'y' }] }] }).matchAll(/name="([^"]+)"/g)].map(m => m[1])).size, 2, 'each copy its own tabs')
  assert.match(draw({ type: 'bento', columns: 3, items: [{ title: 'x', cols: 9, rows: 9, href: 'javascript:x' }] }), /k-bt w-3" style="grid-column:span 3;grid-row:span 3">/)
})

test('UI kit: a palette’s keys, a textarea’s ⌘ Enter, a prompt box’s do, a hover card', async () => {
  const sent: any[] = []
  const on: Record<string, (e: any) => void> = {}
  let answer: unknown = true
  let opened: any[] = []
  const stop = uiBehave({ addEventListener: (t: string, f: any) => (on[t] = f), removeEventListener: () => {}, querySelectorAll: (q: string) => (q.includes('popover-open') ? opened : []) } as any, m => (sent.push(m), Promise.resolve(answer)))
  // ↓ from the box goes to the first row, ↑ from it back to the box; Enter in the box runs the first row
  const focus: any[] = []
  const el = (name: string, more: object = {}): any => ({ name, localName: 'button', focus: () => focus.push(name), click: () => focus.push(`click ${name}`), closest: (s: string) => (s === '.k-cmd' ? cmd : null), ...more })
  const q = el('q', { localName: 'input' })
  const rows = [el('a'), el('b')]
  const cmd = { querySelectorAll: () => rows, querySelector: () => q }
  const keyIn = (t: any, key: string, more: object = {}) => {
    let stopped = false
    on.keydown({ key, target: t, preventDefault: () => (stopped = true), ...more })
    return stopped
  }
  assert.ok(keyIn(q, 'ArrowDown'))
  keyIn(rows[0], 'ArrowDown')
  keyIn(rows[1], 'ArrowDown')
  keyIn(rows[0], 'ArrowUp')
  keyIn(q, 'Enter')
  assert.deepEqual(focus, ['a', 'b', 'q', 'click a'])
  assert.equal(keyIn(q, 'Enter', { isComposing: true }), false, 'an IME’s Enter')
  // a textarea: Enter is a new line, ⌘ Enter sends
  let clicks = 0
  const area = { localName: 'textarea', closest: (s: string) => (s === '[data-inbox]' ? { querySelector: () => ({ click: () => clicks++ }) } : null) }
  on.keydown({ key: 'Enter', target: area, preventDefault() {} })
  on.keydown({ key: 'Enter', metaKey: true, target: area, preventDefault() {} })
  assert.equal(clicks, 1)
  // a do with a box: what's typed is its prompt, the box emptied once it went, kept when it didn't
  const box = { value: ' fix the login ', focus() {} }
  const attrs: Record<string, string> = { 'data-do': '{"do":"send"}', 'data-input': '' }
  const btn: any = { textContent: 'Send', getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs, setAttribute: (k: string, v: string) => (attrs[k] = v), removeAttribute: (k: string) => delete attrs[k], matches: (s: string) => s === '[data-do]', closest: (s: string) => (s === '[data-inbox]' ? { querySelector: () => box } : s.includes('[data-do]') ? btn : null) }
  const press = () => on.click({ target: btn, preventDefault() {} })
  answer = false
  press()
  assert.deepEqual(sent.pop(), { laki: 'do', cmd: { do: 'send', prompt: 'fix the login' }, label: 'Send', confirm: undefined })
  press()
  assert.equal(sent.length, 0, 'one at a time')
  await new Promise(r => setTimeout(r, 0))
  assert.equal(box.value, ' fix the login ', 'declined: the words stay')
  answer = true
  press()
  await new Promise(r => setTimeout(r, 0))
  assert.equal(box.value, '')
  sent.length = 0
  // a hover card: shown as the pointer comes, hidden as it goes; a click on its button keeps it
  const shown: string[] = []
  const popAttrs = new Set<string>()
  let open = false
  const body = { matches: () => open, showPopover: () => ((open = true), shown.push('show')), hidePopover: () => ((open = false), shown.push('hide')) }
  const pop: any = { querySelector: () => body, contains: (x: unknown) => x === inside, setAttribute: (k: string) => popAttrs.add(k), removeAttribute: (k: string) => popAttrs.delete(k), hasAttribute: (k: string) => popAttrs.has(k) }
  const inside = {}
  const over = (type: string, related: unknown = null) => on[type]({ type, target: { closest: (s: string) => (s === '.k-pop.hover' ? pop : null) }, relatedTarget: related })
  const later = () => new Promise(r => setTimeout(r, 300))
  over('mouseover')
  over('mouseout', inside)
  over('mouseout')
  over('mouseover') // back on it within the moment: it stays
  await later()
  over('mouseout')
  await later()
  over('mouseover')
  let kept = false
  on.click({ target: { closest: (s: string) => (s.startsWith('.k-pop[data-hov]') && popAttrs.has('data-hov') ? { parentNode: pop } : null) }, preventDefault: () => (kept = true) })
  over('mouseout')
  await later()
  assert.deepEqual(shown, ['show', 'hide', 'show'])
  assert.ok(kept && open, 'pinned: it stays as the pointer goes')
  assert.equal(sent.length, 0)
  // Esc: an open popover or dropdown closes first, the full view's dialog stays (its key taken)
  const card = { localName: 'div', shut: false, hidePopover() { this.shut = true } }
  let taken = false
  on.keydown({ key: 'Escape', target: { closest: () => null }, preventDefault: () => (taken = true) })
  assert.ok(!taken, 'nothing open: the dialog’s')
  opened = [card]
  on.keydown({ key: 'Escape', target: { closest: () => null }, preventDefault: () => (taken = true) })
  assert.ok(taken && card.shut)
  stop()
})

test('UI kit: a palette’s “Nothing matches” as a search leaves no row', () => {
  const on: Record<string, (e: any) => void> = {}
  uiBehave({ addEventListener: (t: string, f: any) => (on[t] = f), removeEventListener: () => {} }, () => {})
  const text = (data: string) => ({ nodeType: 3, data })
  const row = (w: string, k: string): any => ({ nodeType: 1, localName: 'button', childNodes: [{ nodeType: 1, localName: 'span', childNodes: [text(w)] }, { nodeType: 1, localName: 'kbd', childNodes: [text(k)] }], hidden: false, hasAttribute: () => false })
  const rows = [row('Deploy', 'D'), row('Board', 'X')]
  const none = { hidden: true }
  const box: any = { hasAttribute: () => false, querySelectorAll: (q: string) => (q === '[data-row]' ? rows : []), querySelector: (q: string) => (q === '[data-none]' ? none : q === '[data-row]:not([hidden])' ? (rows.find(r => !r.hidden) ?? null) : null) }
  const type = (v: string) => on.input({ target: { value: v, closest: (q: string) => (q === '[data-filter]' ? { value: v, closest: () => box } : null) } })
  type('dep')
  assert.deepEqual([rows.map(r => r.hidden), none.hidden], [[false, true], true])
  type('x')
  assert.deepEqual([rows.map(r => r.hidden), none.hidden], [[true, true], false], 'a key’s letter isn’t a row’s word')
  type('')
  assert.deepEqual([rows.map(r => r.hidden), none.hidden], [[false, false], true])
})
