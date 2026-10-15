import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { ntfyReplies, pushRequest, pushText, replies } from '../src/daemon/push.ts'
import { highlight } from '../src/renderer/src/highlight.ts'
import { keep, move, resize, tabsOf, type Layout } from '../src/shared/layout.ts'
import { parseLink, wsLink } from '../src/renderer/src/links.ts'
import { inline, markdown } from '../src/shared/markdown.ts'
import { actionsFor, importable, splitRows, toCsv, youtubeEmbed } from '../src/renderer/src/text.ts'
import { fillTemplate, isAgent, prAllows, rowsOf, taskTitle } from '../src/shared/types.ts'
import { describeHours, parseHours, parseWhen, stamp } from '../src/shared/when.ts'
import { ago, render, spark } from '../src/shared/widget.ts'

test('widget templates: objects as JSON, this in each, each over an object, bad dates, ago in every unit', () => {
  assert.equal(render('{{o}}|{{n}}|{{z}}', { o: { a: '<b>' }, n: null, z: 0 }), '{&quot;a&quot;:&quot;&lt;b&gt;&quot;}||0')
  assert.equal(render('{{#each xs}}{{@index}}={{this}};{{/each}}', { xs: ['a', 'b'] }), '0=a;1=b;')
  assert.equal(render('{{#each o}}{{@index}}={{this}};{{/each}}', { o: { a: 1, b: 2 } }), '0=1;1=2;')
  assert.equal(render('{{#each s}}x{{else}}none{{/each}}', { s: 'abc' }), 'none', 'a string is no list')
  assert.equal(render('{{date d}}|{{ago d}}', { d: 'soon' }), '|')
  const now = Date.UTC(2026, 0, 1)
  const before = (s: number) => new Date(now - s * 1000).toISOString()
  assert.deepEqual(
    [30, 60, 150, 3600, 3 * 86400, 65 * 86400, 400 * 86400, -100].map(s => ago(before(s), now)),
    ['just now', '1 minute ago', '2 minutes ago', '1 hour ago', '3 days ago', '2 months ago', '1 year ago', 'just now'],
  )
})

test('widget sparks: one point in the middle, a flat line, objects by value, anything else nothing', () => {
  assert.match(spark([7]), /points="50,28\.0"/)
  assert.match(spark([{ value: 2 }, { value: 2 }]), /points="0\.0,28\.0 100\.0,28\.0"/)
  assert.equal(spark('1,2,3'), '')
  assert.equal(spark([{ value: 'x' }]), '')
})

test('markdown: an empty heading, closing hashes, empty and lazy list items, blanks after a list', () => {
  assert.deepEqual(markdown('#'), [{ t: 'h', level: 1, inl: [] }])
  assert.deepEqual(markdown('## Title ##'), [{ t: 'h', level: 2, inl: ['Title'] }])
  const list = (...items: unknown[][]) => ({ t: 'list', ordered: false, start: 1, items: items.map(blocks => ({ task: undefined, blocks })) })
  assert.deepEqual(markdown('-\n  more'), [list([{ t: 'p', inl: ['more'] }])])
  assert.deepEqual(markdown('-\nlazy'), [list([]), { t: 'p', inl: ['lazy'] }], 'an empty item takes no lazy line')
  assert.deepEqual(markdown('- a\nlazy'), [list([{ t: 'p', inl: ['a lazy'] }])])
  assert.deepEqual(markdown('- a\n# h'), [list([{ t: 'p', inl: ['a'] }]), { t: 'h', level: 1, inl: ['h'] }])
  assert.deepEqual(markdown('- a\n\n'), [list([{ t: 'p', inl: ['a'] }])])
  assert.deepEqual(markdown('- a\n\n  b'), [list([{ t: 'p', inl: ['a'] }, { t: 'p', inl: ['b'] }])])
  assert.deepEqual(markdown('- a\n\nb'), [list([{ t: 'p', inl: ['a'] }]), { t: 'p', inl: ['b'] }])
})

test('markdown: table alignment, a lone bar row, underlined headings, backslashes', () => {
  const [table] = markdown('| a | b | c | d |\n|:-:|--:|:--|---|\n| 1 | 2 | 3 | 4 |')
  assert.deepEqual(table, { t: 'table', align: ['center', 'right', 'left', ''], head: [['a'], ['b'], ['c'], ['d']], rows: [[['1'], ['2'], ['3'], ['4']]] })
  assert.deepEqual(markdown('a | b'), [{ t: 'p', inl: ['a | b'] }], 'no delimiter row: a paragraph')
  assert.deepEqual(markdown('a | b\n---'), [{ t: 'h', level: 2, inl: ['a | b'] }], 'cells that differ: an underlined heading')
  assert.deepEqual(markdown('Title\n==='), [{ t: 'h', level: 1, inl: ['Title'] }])
  assert.deepEqual(inline('a\\\nb'), ['a', { t: 'br' }, 'b'])
  assert.deepEqual(inline('\\*not\\* a'), ['*not* a'])
  assert.deepEqual(inline('\\a and a\\'), ['\\a and a\\'], 'a backslash before a letter or at the end stays')
})

test('schedules: minutes past 59, bare numbers that are no time, working hours left without days, 12 on a 12-hour clock', () => {
  assert.deepEqual(parseWhen('at 9:75'), { error: '9:75 isn’t a time' })
  assert.deepEqual(parseWhen('every day for 2 people at 9am'), { days: [0, 1, 2, 3, 4, 5, 6], times: [540] })
  assert.deepEqual(parseWhen('mon at 9 and 17:30'), { days: [1], times: [540, 1050] })
  assert.deepEqual(parseHours('9am-5pm except'), { error: 'Except which days? (except weekends)' })
  assert.deepEqual(parseHours('9am-5pm weekends except weekends'), { error: 'That leaves no days' })
  const h = (days: number[]) => describeHours({ days, from: 540, to: 1020 })
  assert.deepEqual([h([0, 1, 2, 3, 4, 5, 6]), h([1, 2, 3, 4, 5]), h([0, 6]), h([1, 3])], ['Every day, 09:00–17:00', 'Weekdays, 09:00–17:00', 'Weekends, 09:00–17:00', 'Mon, Wed, 09:00–17:00'])
  assert.equal(describeHours({ days: [5], from: 1320, to: 360 }), 'Fri, 22:00–06:00 (the next day)')
  const at = (h: number) => new Date(2026, 9, 5, h, 7).getTime()
  assert.deepEqual([at(0), at(12), at(13)].map(t => stamp('{{hh:mm A}}', t)), ['12:07 AM', '12:07 PM', '01:07 PM'])
})

test("text helpers: a nameless action doesn't replace a named one, YouTube start times, CSV quoting, imported kinds", () => {
  const lint = { name: 'Lint', target: 'shell' as const, text: 'npm run lint' }
  const fix = { name: 'Lint', target: 'claude' as const, text: 'fix the lint' }
  const nameless = { target: 'shell', text: 'x' } as any
  const any = { name: 'Go', target: 'any' as const, text: 'go on' }
  assert.deepEqual(actionsFor([lint, nameless], [nameless, fix, any], [{ id: 's', shell: true }, { id: 'x', agent: 'codex' }, { id: 'c', agent: 'claude' }], 'c'), {
    agent: [{ action: fix, tab: 'c' }, { action: any, tab: 'c' }],
    terminal: [{ action: lint, tab: 's' }],
  })
  assert.deepEqual(actionsFor([lint]), { agent: [], terminal: [{ action: lint, tab: undefined }] }, 'no shell: a new one')
  const e = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
  assert.equal(youtubeEmbed('youtu.be/dQw4w9WgXcQ?t=1h2m3s'), `${e}?start=3723`)
  assert.equal(youtubeEmbed('youtu.be/dQw4w9WgXcQ?start=90'), `${e}?start=90`)
  assert.equal(youtubeEmbed('youtu.be/dQw4w9WgXcQ?t=soon'), e)
  assert.equal(toCsv([['a', 'b']], ',', [[true]]), '"a","b"\n', 'a new column like the cell before')
  assert.equal(toCsv([['a'], ['b']], ',', [[true]]), '"a"\n"b"\n', 'a new row like the one above')
  assert.equal(toCsv([['a']], ',', [[]], false), 'a')
  assert.equal(toCsv([], ','), '')
  assert.deepEqual(importable({ presets: null, templates: null, env: [], prScan: '2', fontSize: 13, other: 'x' }), { ok: { presets: null, fontSize: 13, other: 'x' }, bad: ['templates', 'env', 'prScan'] })
})

test('layouts: nothing has no tabs, moving a tab not there changes nothing, resize down either side', () => {
  assert.deepEqual(tabsOf(null), [])
  assert.equal(keep(null, () => true), null)
  const groups: Layout[] = [{ tab: 'a' }]
  assert.equal(move(groups, 'zzz', true, 'bar'), groups)
  const leaf = { tab: 'a' }
  assert.equal(resize(leaf, '', 0.3), leaf)
  const l: Layout = { dir: 'row', at: 0.5, a: { tab: 'a' }, b: { dir: 'col', at: 0.5, a: { tab: 'b' }, b: { tab: 'c' } } }
  assert.deepEqual(resize(l, 'b', 0.95), { ...l, b: { ...l.b, at: 0.9 } })
  assert.deepEqual(resize(l, 'a', 0.2), l, 'a pane has nothing to resize')
})

test('links: a settings section by path or query; a workspace link with and without a tab', () => {
  assert.deepEqual(parseLink('laki://settings/general'), { to: 'settings', section: 'general' })
  assert.deepEqual(parseLink('laki://settings?section=widgets'), { to: 'settings', section: 'widgets' })
  assert.equal(wsLink('a b'), 'laki://ws/a%20b')
  assert.equal(wsLink('w', 't/1'), 'laki://ws/w?tab=t%2F1')
  assert.deepEqual(parseLink(wsLink('w', 't/1')), { to: 'ws', ws: 'w', tab: 't/1' })
})

test('shared helpers: agents by name, PR permissions, sidebar rows without order, unset template vars kept', () => {
  assert.deepEqual([isAgent('codex'), isAgent('bash'), isAgent(undefined)], [true, false, false])
  assert.deepEqual([prAllows(undefined, 'approve'), prAllows(undefined, 'land'), prAllows({ pr: { land: true } }, 'land'), prAllows({ pr: { merge: false } }, 'merge')], [true, false, true, false])
  const ws = [{ id: 'w1', project: 'p' }, { id: 'x', project: 'q' }, { id: 'w2', project: 'p' }]
  assert.deepEqual(rowsOf({ id: 'p' }, ws).map(r => r.id), ['w1', 'w2'])
  assert.deepEqual(rowsOf({ id: 'p', seps: [{ id: 's1', name: 'S' }], rows: ['w2', 's1'] }, ws).map(r => r.id), ['w2', 's1', 'w1'])
  assert.equal(fillTemplate('{{a}} {{b}}', { a: undefined, b: 'x' }), '{{a}} x')
})

test('syntax tokens: a keyword before a paren, files named by their whole name', () => {
  const of = (path: string, text: string) => highlight(path, text).map(l => l.filter(([c]) => c).map(([c, s]) => `${c}:${s}`))
  assert.deepEqual(of('a.ts', 'if (x) return'), [['hl-k:if', 'hl-k:return']])
  assert.deepEqual(of('q.sql', 'SELECT COUNT(id) WHERE x IN (1)'), [['hl-k:SELECT', 'hl-f:COUNT', 'hl-k:WHERE', 'hl-k:IN', 'hl-n:1']])
  assert.deepEqual(of('Makefile', 'all: # build'), [['hl-c:# build']])
  assert.deepEqual(of('.gitignore', 'key = 1'), [['hl-p:key', 'hl-n:1']])
})

test('pushes: titles, Telegram without a bot path or chat, ntfy reply topics only for a URL', () => {
  const p = { event: 'done', workspace: 'w', tab: 't', agent: 'codex' } as const
  assert.deepEqual(pushText({ ...p, event: 'test' }), { title: 'Laki: pushes reach you', body: '', text: 'Laki: pushes reach you' })
  assert.equal(pushText(p).title, 'codex in w is done')
  assert.equal(pushText({ ...p, title: 'Workflow Triage in w failed' }).title, 'Workflow Triage in w failed') // a workflow's own
  for (const url of ['https://example.com/hook', 'https://api.telegram.org/botT/sendMessage']) assert.equal(JSON.parse(String(pushRequest({ format: 'telegram', url }, p).body)).chat_id, undefined)
  assert.equal(ntfyReplies({ url: 'https://ntfy.sh/mine' }), undefined)
  assert.equal(ntfyReplies({ replyTopic: 'x' }), undefined)
  assert.equal(ntfyReplies({ replyTopic: 'x', url: 'not a url' }), undefined)
  assert.deepEqual(ntfyReplies({ replyTopic: 'x', url: 'https://ntfy.sh/mine/' }), { url: 'https://ntfy.sh/mine-x', query: '' })
})

test('phone taps: nothing to ask without a chat or reply topic; ntfy messages since the cursor; a failing server throws', async t => {
  assert.deepEqual(await replies({ format: 'telegram', url: 'https://api.telegram.org/botT/sendMessage' }, '3'), { taps: [], cursor: '3' })
  assert.deepEqual(await replies({ format: 'ntfy', url: 'https://ntfy.sh/mine' }, 'c'), { taps: [], cursor: 'c' })
  const asked: string[] = []
  const server = createServer((req, res) => {
    asked.push(req.url!)
    if (req.url!.startsWith('/down')) return void res.writeHead(500).end()
    if (req.url!.startsWith('/botE/')) return void res.writeHead(200).end('{"ok":false}')
    if (req.url!.includes('getUpdates')) return void res.writeHead(200).end(JSON.stringify({ result: [{ update_id: 3, callback_query: { id: 'q', message: { chat: { id: 42 } } } }] }))
    const lines = [{ event: 'open', id: 'o' }, { event: 'message', id: 'm1', message: '00112233aabbccdd:3' }, { event: 'message', id: 'm2', message: 42 }, { event: 'keepalive', id: 'k' }]
    res.writeHead(200).end(['', ...lines.map(l => JSON.stringify(l)), ''].join('\n'))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  assert.deepEqual(await replies({ format: 'ntfy', url: `${base}/mine?auth=XYZ`, replyTopic: 'xyz' }, 'c0'), { taps: [{ nonce: '00112233aabbccdd', n: 3 }], cursor: 'm2' })
  assert.equal(asked[0], '/mine-xyz/json?poll=1&since=c0&auth=XYZ')
  assert.deepEqual(await replies({ format: 'telegram', url: `${base}/botT/sendMessage?chat_id=42` }, ''), { taps: [], cursor: '4' }, 'a query without data is no tap')
  assert.deepEqual(await replies({ format: 'telegram', url: `${base}/botE/sendMessage?chat_id=42` }, '7'), { taps: [], cursor: '7' }, 'no result: nothing moves')
  await assert.rejects(replies({ format: 'ntfy', url: `${base}/down`, replyTopic: 'x' }, ''), /answered 500/)
})

// themes.ts paints <html>: a stand-in like template.test.ts' fakeDom, with a sheet of another origin first
function fakeDom(root: Record<string, string>) {
  const props = new Map<string, string>()
  const style = {
    setProperty: (k: string, v: string) => void props.set(k, v),
    removeProperty: (k: string) => void props.delete(k),
    getPropertyValue: (k: string) => props.get(k) ?? '',
    colorScheme: '',
    [Symbol.iterator]: () => props.keys(),
  }
  const html = { style, dataset: {} as Record<string, string>, classList: { toggle: () => {} } }
  class CSSStyleRule {
    selectorText = ':root'
    style = { getPropertyValue: (k: string) => root[k] ?? '' }
  }
  const foreign = {
    get cssRules(): never {
      throw new Error('SecurityError')
    },
  }
  Object.assign(globalThis, { CSSStyleRule, document: { documentElement: html, styleSheets: [foreign, { cssRules: [new CSSStyleRule()] }] }, getComputedStyle: () => style })
  return props
}

test("themes: glass over the stylesheet's colors with alpha or not hex, a gradient theme's glass, text on a dark accent", async () => {
  const { applyTheme, onAccent } = await import('../src/renderer/src/themes.ts')
  const props = fakeDom({ '--bg': '#0e101480', '--side': 'rgb(18, 21, 27)', '--fg': '#d5d9e3' })
  applyTheme({ glass: true, glassWindow: 50, glassSide: 50, glassTerm: 50, glassGlow: false })
  assert.deepEqual([props.get('--app-bg'), props.get('--term-bg'), props.get('--side'), props.get('--tab-sel')], [
    'linear-gradient(#0e101440 0 0)', // half of its own alpha
    '#0e101440',
    'color-mix(in srgb, rgb(18, 21, 27) 50%, transparent)',
    '#0e101440',
  ])
  applyTheme({ theme: 'cyberwave', glass: true, glassWindow: 0, glassGlow: false })
  assert.deepEqual([props.get('--app-bg'), props.get('--term-bg'), props.get('--tab-sel')], ['linear-gradient(135deg, #051937ff, #00577aff)', '#04213f00', '#e6f1ff1a'])
  assert.deepEqual([onAccent('#000000'), onAccent('#ffffff'), onAccent('#0a0aff')], ['#ffffff', '#000000', '#ffffff'])
})

test("taskTitle: a prompt's first words for a tab's name, less links, paths, flags and filler", () => {
  assert.equal(taskTitle('Please fix the cart total rounding in checkout.ts'), 'fix the cart total rounding')
  assert.equal(taskTitle('Can you review https://github.com/o/r/pull/42 and leave comments'), 'review #42 and leave comments')
  assert.equal(taskTitle('/code-review xhigh --fix'), '/code-review xhigh')
  assert.equal(taskTitle('fix src/renderer/src/App.tsx and/or ~/x/y.md'), 'fix App.tsx and/or y.md')
  assert.equal(taskTitle('Look at /Users/me/app/src/App.tsx and make the **sidebar** wider'), 'Look at App.tsx and make')
  assert.equal(taskTitle('ok so now lets add dark mode to the settings page'), 'add dark mode to the settings')
  assert.equal(taskTitle('\n\n  fix it\nmore lines'), 'fix it')
  assert.equal(taskTitle('see https://example.com'), 'see')
  assert.equal(taskTitle('   '), '')
  assert.ok(taskTitle('x'.repeat(80)).endsWith('…') && taskTitle('x'.repeat(80)).length === 36)
})


test("splitRows: a diff side by side, removed lines beside the added ones after them", () => {
  const L = (text: string, old?: number, now?: number) => ({ text, old, new: now })
  const hunk = L('@@ -1,4 +1,4 @@'), ctx = L(' a', 1, 1), d1 = L('-b', 2), d2 = L('-c', 3), a1 = L('+B', undefined, 2), ctx2 = L(' d', 4, 3), a2 = L('+e', undefined, 4), end = L('\\ No newline at end of file')
  assert.deepEqual(splitRows([hunk, ctx, d1, d2, a1, ctx2, a2, end]), [
    { full: hunk },
    { left: ctx, right: ctx },
    { left: d1, right: a1 },
    { left: d2, right: undefined },
    { left: ctx2, right: ctx2 },
    { left: undefined, right: a2 },
    { full: end },
  ])
})
