import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyTree } from '../src/shared/conn.ts'
import { bgDoneOf, pickProject, readerShown, retrying, retryText } from '../src/renderer/src/text.ts'
import { FIND, findKey, freshOf } from '../src/shared/settingsMap.ts'
import { sendIs, setSendKey } from '../src/shared/keys.ts'
import { repoOf } from '../src/daemon/codespace.ts'
import { ntfyReplies, pushRequest, pushText, replies, tapSig } from '../src/daemon/push.ts'
import { highlight } from '../src/renderer/src/highlight.ts'
import { keep, move, resize, tabsOf, type Layout } from '../src/shared/layout.ts'
import { parseLink, wsLink } from '../src/renderer/src/links.ts'
import { inline, markdown } from '../src/shared/markdown.ts'
import { actionsFor, exportable, fileTree, importable, isStale, Line, needsSorted, NOTE_MAX, noteCut, noteWhole, splitRows, toCsv, youtubeEmbed } from '../src/renderer/src/text.ts'
import { type TabView, browseSays, fillTemplate, isAgent, pageChanges, placesOf, prAllows, rowsOf, taskTitle, VOICE_FIXES, voiceFillers, voiceFix } from '../src/shared/types.ts'
import { planRef } from '../src/shared/plans.ts'
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
  assert.deepEqual(importable({ presets: null, templates: null, env: [], prScan: '2', fontSize: 13, other: 'x' }), { ok: { presets: null, fontSize: 13, other: 'x' }, bad: ['templates', 'prScan'] })
  // secrets and private values: never exported, never imported (an older file's: this Mac's stay)
  const all = { fontSize: 13, env: { K: '1' }, webhook: { url: 'https://ntfy.sh/t' }, remoteMail: 'me@x.com', tunnelMails: ['*@x.com'], flowVars: { TOKEN: 'v' }, presets: [{ name: 'a', env: { K: '1' }, agent: 'claude' }] }
  assert.deepEqual(exportable(all), { fontSize: 13, presets: [{ name: 'a', agent: 'claude' }] })
  assert.deepEqual(importable(all).ok, { fontSize: 13, presets: all.presets })
  // presets' env: Export leaves it out, so a preset of the same name keeps this Mac's; the file's own wins
  assert.deepEqual(importable({ presets: [{ name: 'a' }, { name: 'b', env: { X: 'file' } }, { name: 'c' }] }, { presets: [{ name: 'a', env: { K: '1' } }, { name: 'b', env: { X: 'mine' } }] }).ok.presets, [{ name: 'a', env: { K: '1' } }, { name: 'b', env: { X: 'file' } }, { name: 'c' }])
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
    const lines = [{ event: 'open', id: 'o' }, { event: 'message', id: 'm1', message: `00112233aabbccdd:3:${tapSig('k', '00112233aabbccdd', 3)}` }, { event: 'message', id: 'm1b', message: '00112233aabbccdd:2' }, { event: 'message', id: 'm2', message: 42 }, { event: 'keepalive', id: 'k' }]
    res.writeHead(200).end(['', ...lines.map(l => JSON.stringify(l)), ''].join('\n'))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  assert.deepEqual(await replies({ format: 'ntfy', url: `${base}/mine?auth=XYZ`, replyTopic: 'xyz' }, 'c0', 'k'), { taps: [{ nonce: '00112233aabbccdd', n: 3 }], cursor: 'm2' }) // the unsigned one: no tap
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

test("placesOf: an extension's places, else its one place, else the sidebar; planRef: a line naming a plan's README.md", () => {
  assert.deepEqual(placesOf({ places: ['desk', 'side'], place: 'desk' }), ['desk', 'side'])
  assert.deepEqual(placesOf({ places: [], place: 'top' }), ['top'], 'an empty list: its place (an older daemon)')
  assert.deepEqual(placesOf({}), ['side'])
  assert.equal(planRef({ kind: 'spec', path: '/p/specs/login' }), 'Spec: /p/specs/login/README.md (read it, and the files beside it: attachments, diagrams)')
  assert.match(planRef({ kind: 'brainstorm', path: '/p/b/x' }), /^Brainstorm: \/p\/b\/x\/README\.md /)
})

test("Line: extension tools' asks one at a time; a newer one waits, a click brings one first, an answer elsewhere drops it", () => {
  const l = new Line<{ req: string }>()
  l.add({ req: 'a' })
  l.add({ req: 'b' })
  l.add({ req: 'c' })
  assert.equal(l.first?.req, 'a', 'the first stays on screen: b waits, not closed as Deny')
  assert.equal(l.drop('b'), false, 'b answered on the phone: out of line, a still on screen')
  assert.equal(l.front('c'), true)
  assert.deepEqual(l.items.map(x => x.req), ['c', 'a'], 'c clicked: first, a back to second')
  assert.equal(l.front('c'), false, 'already first')
  assert.equal(l.drop('c'), true, 'the one on screen')
  assert.equal(l.first?.req, 'a')
})

test('copyTree: files read until they end, modes and links as they are, a filter, a pipe left out', t => {
  const d = mkdtempSync(join(tmpdir(), 'laki-copy-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  const a = join(d, 'a')
  mkdirSync(join(a, 'sub', 'node_modules'), { recursive: true })
  writeFileSync(join(a, 'run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 })
  writeFileSync(join(a, 'sub', 'big.bin'), Buffer.alloc(3 << 20, 7)) // past one chunk
  writeFileSync(join(a, 'sub', 'node_modules', 'x.js'), 'x')
  symlinkSync('../run.sh', join(a, 'sub', 'link'))
  execFileSync('mkfifo', [join(a, 'pipe')])
  copyTree(a, join(d, 'b'), p => !p.endsWith('node_modules'))
  assert.equal(readFileSync(join(d, 'b', 'run.sh'), 'utf8'), '#!/bin/sh\necho hi\n')
  assert.equal(statSync(join(d, 'b', 'run.sh')).mode & 0o777, 0o755)
  assert.equal(statSync(join(d, 'b', 'sub', 'big.bin')).size, 3 << 20)
  assert.equal(readlinkSync(join(d, 'b', 'sub', 'link')), '../run.sh', 'verbatim')
  assert.throws(() => statSync(join(d, 'b', 'sub', 'node_modules')), 'filtered')
  assert.throws(() => statSync(join(d, 'b', 'pipe')), 'a pipe is not read')
  writeFileSync(join(a, 'run.sh'), 'new')
  copyTree(a, join(d, 'b'), p => !p.endsWith('node_modules')) // over what's there
  assert.equal(readFileSync(join(d, 'b', 'run.sh'), 'utf8'), 'new')
})

test("laki browser's report: the lines a click added and took away, 20 at most; the CLI's words for it", () => {
  assert.deepEqual(pageChanges(['Cart', 'Pay now', 'Total 3'], ['Cart', 'Paid', 'Total 3']), ['+ Paid', '- Pay now'])
  assert.deepEqual(pageChanges(['a', 'b'], ['b', 'a']), []) // moved: neither
  assert.deepEqual(pageChanges(['x'], ['x', 'x']), ['+ x']) // counted
  const many = pageChanges([], Array.from({ length: 25 }, (_, i) => `row ${i}`))
  assert.deepEqual([many.length, many[19], many[20]], [21, '+ row 19', '… 5 more'])
  assert.equal(pageChanges([], ['y'.repeat(300)])[0].length, 200)
  assert.equal(browseSays({ url: 'http://localhost:3100/', title: 'Shop', changed: [] }), 'http://localhost:3100/  Shop\n(no changes)')
  assert.equal(browseSays({ url: 'http://localhost:3100/done', title: '', nav: { url: 'http://localhost:3100/done', title: '' }, blocked: ['https://pay.example'], errors: ['boom'], changed: ['+ Done'] }), '→ http://localhost:3100/done\nblocked: https://pay.example\nconsole error: boom\n+ Done')
  assert.equal(browseSays({ url: 'http://localhost:3100/', title: 'Shop' }), 'http://localhost:3100/  Shop') // open, or an older app: no changed
})

test("ship's -R: a remote's URL as [HOST/]OWNER/REPO, none for a path", () => {
  assert.equal(repoOf('git@github.com:igor/olauncher-plus.git'), 'github.com/igor/olauncher-plus')
  assert.equal(repoOf('https://github.com/igor/laki.git'), 'github.com/igor/laki')
  assert.equal(repoOf('https://user:tok@ghe.corp.com/team/app/'), 'ghe.corp.com/team/app')
  assert.equal(repoOf('ssh://git@gitlab.com:2222/a/b.git'), 'gitlab.com/a/b')
  assert.equal(repoOf('/Users/me/remote.git'), null)
  assert.equal(repoOf('file:///srv/repo.git'), null)
  assert.equal(repoOf(''), null)
})

test('fileTree: folders first, one-folder chains joined, a folded folder\'s insides left out', () => {
  const f = (path: string) => ({ path })
  const files = ['README.md', 'src/renderer/src/App.tsx', 'src/renderer/src/ui.tsx', 'src/daemon/core.ts', 'docs/a/b/c.md'].map(f)
  const show = (rows: ReturnType<typeof fileTree<{ path: string }>>) => rows.map(r => ('dir' in r ? `${'  '.repeat(r.depth)}${r.name}/ (${r.n})` : `${'  '.repeat(r.depth)}${r.file.path}`))
  assert.deepEqual(show(fileTree(files)), ['docs/a/b/ (1)', '  docs/a/b/c.md', 'src/ (3)', '  daemon/ (1)', '    src/daemon/core.ts', '  renderer/src/ (2)', '    src/renderer/src/App.tsx', '    src/renderer/src/ui.tsx', 'README.md'])
  assert.deepEqual(show(fileTree(files, new Set(['src/renderer/src', 'docs/a/b']))), ['docs/a/b/ (1)', 'src/ (3)', '  daemon/ (1)', '    src/daemon/core.ts', '  renderer/src/ (2)', 'README.md'])
  assert.deepEqual(fileTree([]), [])
})

test('urlIs: --expect-url matches its page or one under it, localhost as 127.0.0.1', async () => {
  const { urlIs } = await import('../src/shared/types.ts')
  assert.equal(urlIs('http://localhost:3000/login', 'http://localhost:3000/login'), true)
  assert.equal(urlIs('http://localhost:3000/login?next=/', 'http://localhost:3000/login'), true)
  assert.equal(urlIs('http://localhost:3000/login/step2', 'http://localhost:3000/login'), true)
  assert.equal(urlIs('http://localhost:3000/login-old', 'http://localhost:3000/login'), false)
  assert.equal(urlIs('http://127.0.0.1:3000/', 'http://localhost:3000'), true)
  assert.equal(urlIs('http://localhost:3001/', 'http://localhost:3000/'), false)
  assert.equal(urlIs('http://localhost:3000/settings', 'http://localhost:3000/login'), false)
  assert.equal(urlIs('http://localhost:3000/login', 'http://localhost:3000/'), false, 'the home page is itself only')
  assert.equal(urlIs('http://localhost:3000/?tab=2', 'http://localhost:3000'), true)
})

test('Needs you and ⌘J: waiting oldest first, fresh finishes newest first, stale ones last; staleAfter 0 never', () => {
  const now = Date.UTC(2026, 10, 4, 12)
  const min = 60e3
  const tab = (id: string, status: TabView['status'], ago?: number) => ({ id, status, ...(ago !== undefined && { needAt: now - ago * min }) }) as TabView
  const tabs = [tab('d-5', 'idle', 5), tab('w-2', 'waiting', 2), tab('d-90', 'idle', 90), tab('d-1', 'idle', 1), tab('w-10', 'waiting', 10), tab('d-40', 'idle', 40), tab('w-none', 'waiting'), tab('d-none', 'idle'), tab('w-120', 'waiting', 120)]
  const ids = (after?: number) => needsSorted(tabs, after, now).map(t => t.id)
  // unset: 30 minutes; a waiting one is never stale, however old
  assert.deepEqual(ids(), ['w-120', 'w-10', 'w-2', 'w-none', 'd-1', 'd-5', 'd-none', 'd-40', 'd-90'])
  assert.deepEqual(ids(5), ['w-120', 'w-10', 'w-2', 'w-none', 'd-1', 'd-none', 'd-5', 'd-40', 'd-90'], 'at 5 minutes it is stale')
  assert.deepEqual(ids(0), ['w-120', 'w-10', 'w-2', 'w-none', 'd-1', 'd-5', 'd-40', 'd-90', 'd-none'], 'never: done ones newest first, none stale')
  assert.deepEqual(tabs.filter(t => isStale(t, undefined, now)).map(t => t.id), ['d-90', 'd-40'])
  assert.deepEqual(tabs.filter(t => isStale(t, 0, now)), [])
  assert.equal(isStale(tab('w', 'waiting', 999), 30, now), false)
  assert.equal(isStale(tab('d', 'idle', 30), 30, now), true, 'exactly staleAfter old')
  assert.equal(isStale(tab('d', 'idle', 29), 30, now), false)
})

test("the test rig only: LAKI_POLICY and the RPC's now need LAKI_TEST_PARENT and a data folder under /tmp (dir.ts inRig)", () => {
  const dirTs = new URL('../src/daemon/dir.ts', import.meta.url).pathname
  const inRig = (env: Record<string, string>) =>
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', `const { inRig } = await import(${JSON.stringify(dirTs)}); process.stdout.write(String(inRig()))`], { env: { PATH: process.env.PATH ?? '', ...env } }).toString()
  const rig = mkdtempSync('/tmp/laki-rig-')
  const away = mkdtempSync('/var/tmp/laki-rig-') // not under /tmp, here or on Linux
  try {
    assert.equal(inRig({ LAKI_HOME: rig, LAKI_TEST_PARENT: '1' }), 'true')
    assert.equal(inRig({ LAKI_HOME: rig }), 'false') // an env var alone: a team's policy stays
    assert.equal(inRig({ LAKI_HOME: away, LAKI_TEST_PARENT: '1' }), 'false')
    assert.equal(inRig({ LAKI_HOME: '/tmp', LAKI_TEST_PARENT: '1' }), 'false')
  } finally {
    rmSync(rig, { recursive: true, force: true })
    rmSync(away, { recursive: true, force: true })
  }
})

test('a notification past NOTE_MAX characters is cut with …, never through an emoji (text.ts noteCut)', () => {
  const fits = 'x'.repeat(NOTE_MAX)
  assert.equal(noteCut(fits), fits, 'exactly NOTE_MAX: whole')
  const cut = noteCut(`${fits}y`)
  assert.equal(cut, `${'x'.repeat(NOTE_MAX - 1)}…`)
  assert.equal(cut.length, NOTE_MAX)
  assert.equal(noteCut(`${'x'.repeat(NOTE_MAX - 2)}😀tail`), `${'x'.repeat(NOTE_MAX - 2)}…`, "the emoji's pair isn't split")
})

test("a Yes on a notification only for text shown as it is: not cut, no bidi or invisible character (text.ts noteWhole)", () => {
  assert.equal(noteWhole('npm test'), true)
  assert.equal(noteWhole('line one\nline two\tand a tab'), true)
  assert.equal(noteWhole('x'.repeat(NOTE_MAX)), true)
  assert.equal(noteWhole('x'.repeat(NOTE_MAX + 1)), false, 'cut')
  assert.equal(noteWhole('echo safe ‮fr- mr'), false, 'a right-to-left override')
  assert.equal(noteWhole('rm​ -rf'), false, 'a zero-width space')
  assert.equal(noteWhole('a\u001Bb'), false, 'an escape')
  assert.equal(noteWhole('rm\u00A0-rf ~'), false, 'a no-break space (HIDDEN: cmdAsk refuses it too)')
  assert.equal(noteWhole('ok\u2028rm -rf ~'), false, 'a line separator')
})

test("the Reader's tool calls (Hide successful, Final answer only), its retry line; the sidebar's project chips; Settings' new ones; Send with", () => {
  const said = [
    { who: 'you' as const, text: 'Fix it' },
    { who: 'agent' as const, text: 'Looking.' },
    { who: 'tool' as const, text: 'Read: a.ts\nEdit: a.ts' },
    { who: 'tool' as const, text: 'Bash: npm test', fail: 1 },
    { who: 'agent' as const, text: 'Fixed.' },
    { who: 'new' as const, text: '' },
    { who: 'you' as const, text: 'Next' },
    { who: 'tool' as const, text: 'Bash: ls' },
  ]
  assert.deepEqual(readerShown(said, undefined, false), said.map(() => true))
  assert.deepEqual(readerShown(said, 'ok', false), [true, true, false, true, true, true, true, false])
  assert.deepEqual(readerShown(said, 'final', false), [true, false, false, false, true, true, true, false])
  assert.equal(readerShown(said, 'final', true).at(-1), true) // the run at work shows

  const r = { n: 2, max: 10, at: 1000, until: 46_000, why: 'Rate limited' }
  assert.equal(retryText(r, 1000), 'Waiting out an API error: try 2 of 10 · next in 45s · Rate limited')
  assert.equal(retryText({ ...r, until: 200_000 }, 1000), 'Waiting out an API error: try 2 of 10 · next in 3m 19s · Rate limited')
  assert.equal(retryText({ at: 0, until: 0 }, 1000), 'Waiting out an API error · retrying now')
  assert.equal(retrying({ status: 'running', retry: r, runAt: 900 }), true)
  assert.equal(retrying({ status: 'running', retry: r, runAt: 2000 }), false) // from before this turn
  assert.equal(retrying({ status: 'idle', retry: r }), false)

  assert.deepEqual(pickProject(undefined, 'a', false), ['a'])
  assert.deepEqual(pickProject(['a'], 'a', false), []) // again: all
  assert.deepEqual(pickProject(['a'], 'b', false), ['b'])
  assert.deepEqual(pickProject(['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(pickProject(['a', 'b'], 'a', true), ['b'])

  assert.deepEqual(freshOf(null), []) // a fresh install: none new
  const known = FIND.map(findKey)
  assert.deepEqual(freshOf(known), [])
  assert.deepEqual(freshOf(known.filter(k => k !== 'keys|Send with')).map(f => f[1]), ['Send with'])

  const k = (key: string, o: Partial<Record<'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey', boolean>> = {}) => ({ key, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...o })
  setSendKey(undefined)
  assert.deepEqual([sendIs(k('Enter')), sendIs(k('Enter', { shiftKey: true })), sendIs(k('Enter', { metaKey: true })), sendIs(k('a'))], [true, false, true, false])
  setSendKey('mod')
  assert.deepEqual([sendIs(k('Enter')), sendIs(k('Enter', { metaKey: true })), sendIs(k('Enter', { ctrlKey: true }))], [false, true, true])
  setSendKey(undefined)
})

test("Background tasks' Clear: a tab's finished ones since, by its chat; a new chat or a lower count starts from 0", () => {
  const t = (resumeId: string, done: number) => ({ id: 'a', resumeId, background: { now: [], done, last: [] } })
  const c = { a: { chat: 's1', n: 3 } }
  assert.equal(bgDoneOf(t('s1', 3), c), 0)
  assert.equal(bgDoneOf(t('s1', 5), c), 2)
  assert.equal(bgDoneOf(t('s2', 1), c), 1) // a /clear's new chat
  assert.equal(bgDoneOf(t('s1', 2), c), 2) // fewer than when cleared: counted anew
  assert.equal(bgDoneOf(t('s1', 4), {}), 4)
})

test('Word fixes (Settings › Voice): heard → meant as whole words in any case, several forms, the longest first; what changed said', () => {
  const fixes = 'lucky, lakey → Laki\nwork tree -> worktree\nnotify = ntfy\nwork → job\n# not a rule\n → nothing\nc++ → C++'
  assert.deepEqual(voiceFix('Open lucky and add a Work  Tree, then notify me', fixes), { text: 'Open Laki and add a worktree, then ntfy me', fixed: ['lucky → Laki', 'Work  Tree → worktree', 'notify → ntfy'] })
  assert.deepEqual(voiceFix('Lakeyside luckyday plucky notifying', fixes), { text: 'Lakeyside luckyday plucky notifying', fixed: [] }, 'whole words only')
  assert.deepEqual(voiceFix('Laki at work, Лакі', fixes), { text: 'Laki at job, Лакі', fixed: ['work → job'] }, 'right already: not said')
  assert.deepEqual(voiceFix('use c++ here', fixes), { text: 'use C++ here', fixed: ['c++ → C++'] }, 'a symbol in it: escaped')
  assert.deepEqual(voiceFix('plain prose stays', ''), { text: 'plain prose stays', fixed: [] })
  assert.deepEqual(voiceFix('a \u017Fs here', 'ss → x'), { text: 'a x here', fixed: ['\u017Fs → x'] }, 'matched by case folding (long s): its own rule, never a throw')
  assert.deepEqual(voiceFix('a b', undefined), { text: 'a b', fixed: [] })
  assert.equal(voiceFix('x', Array(VOICE_FIXES).fill('y → z').concat('x → past the cap').join('\n')).text, 'x', `${VOICE_FIXES} lines at most`)
})

test('voiceFillers: standalone hesitations go in each language, with their comma or space; words that mean something stay', () => {
  const same = (s: string) => assert.deepEqual(voiceFillers(s), { text: s, n: 0 }, s)
  const is = (s: string, text: string, n = 1) => assert.deepEqual(voiceFillers(s), { text, n }, s)
  is('Um, I think we should, uh, ship it', 'I think we should ship it', 2)
  is('um we should ship', 'we should ship')
  is('Ship it, um.', 'Ship it.')
  is('we should uh ship this', 'we should ship this')
  is('Hmm, let me think', 'Let me think')
  is('Uh. Okay, this is it.', 'Okay, this is it.')
  is('It works. Um, what next?', 'It works. What next?')
  is('Um, uh, we can', 'We can', 2)
  is('we can, er, go', 'we can go')
  is('Äh, ich denke schon', 'Ich denke schon')
  is('Ähm, das geht', 'Das geht')
  is('Euh, je pense que oui', 'Je pense que oui')
  is('えーと、明日やります', '明日やります')
  is('嗯，我觉得可以', '我觉得可以')
  is('我觉得，嗯，可以', '我觉得，可以')
  is('Ну, я думаю', 'Я думаю')
  is('Эээ, давай', 'Давай')
  is('Uh', '')
  is('Um, yes please', 'Yes please')
  same('Um')
  same('I like it, so, ship the thing')
  same('uh-huh, that is it')
  same('the umbrella and the error')
  same('er ist müde')
  same('Da steht er, um zu gehen')
  same('Um carro e dois')
  same('Um, dois, três')
  same('ну и что')
  same('We went to the ER, then home and it was fine')
  same('She studied at UM and it is great')
  is('first line\num we can go on', 'first line\nwe can go on')
  same('嗯嗯我知道')
})
