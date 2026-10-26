// The file preview's Markdown (src/renderer/src/markdown.ts): blocks and inline marks as a tree
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inline, markdown } from '../src/shared/markdown.ts'

test('markdown blocks', () => {
  const md = markdown(
    [
      '# Laki',
      '',
      'Agents in **worktrees**,',
      'side by side.',
      '',
      'Setup',
      '-----',
      '- one',
      '- [x] two',
      '  - nested',
      '',
      '- three',
      '1. first',
      '',
      '```ts',
      'const a = 1',
      '',
      'b()',
      '```',
      '> a quote',
      'still it',
      '',
      '| key | does |',
      '|:----|----:|',
      '| ⌘N | new \\| tab |',
      '---',
    ].join('\n'),
  )
  assert.deepEqual(
    md.map(b => b.t),
    ['h', 'p', 'h', 'list', 'list', 'code', 'quote', 'table', 'hr'],
  )
  assert.deepEqual(md[0], { t: 'h', level: 1, inl: ['Laki'] })
  assert.deepEqual(md[1], { t: 'p', inl: ['Agents in ', { t: 'b', kids: ['worktrees'] }, ', side by side.'] })
  assert.deepEqual(md[2], { t: 'h', level: 2, inl: ['Setup'] })
  const list = md[3] as Extract<(typeof md)[number], { t: 'list' }>
  assert.equal(list.ordered, false)
  assert.equal(list.items.length, 3) // the blank before "three" keeps it one list
  assert.equal(list.items[1].task, true)
  assert.deepEqual(
    list.items[1].blocks.map(b => b.t),
    ['p', 'list'],
  )
  assert.deepEqual(md[4], { t: 'list', ordered: true, start: 1, items: [{ task: undefined, blocks: [{ t: 'p', inl: ['first'] }] }] })
  assert.deepEqual(md[5], { t: 'code', lang: 'ts', text: 'const a = 1\n\nb()' })
  assert.deepEqual(md[6], { t: 'quote', blocks: [{ t: 'p', inl: ['a quote still it'] }] })
  assert.deepEqual(md[7], { t: 'table', align: ['left', 'right'], head: [['key'], ['does']], rows: [[['⌘N'], ['new | tab']]] })
  // a pipe in an underlined heading: a heading (the dashes aren't a row of its two cells)
  assert.deepEqual(markdown('Install | Setup\n---'), [{ t: 'h', level: 2, inl: ['Install | Setup'] }])
})

test('markdown inline marks', () => {
  assert.deepEqual(inline('a `b*c*` d'), ['a ', { t: 'code', text: 'b*c*' }, ' d'])
  assert.deepEqual(inline('*a **b** c*'), [{ t: 'i', kids: ['a ', { t: 'b', kids: ['b'] }, ' c'] }])
  assert.deepEqual(inline('***x***'), [{ t: 'b', kids: [{ t: 'i', kids: ['x'] }] }])
  assert.deepEqual(inline('snake_case_name and _it_'), ['snake_case_name and ', { t: 'i', kids: ['it'] }])
  assert.deepEqual(inline('~~old~~ \\*not\\*'), [{ t: 's', kids: ['old'] }, ' *not*'])
  assert.deepEqual(inline('[the **guide**](docs/guide.md) ![logo](icon.svg)'), [
    { t: 'a', href: 'docs/guide.md', kids: ['the ', { t: 'b', kids: ['guide'] }] },
    ' ',
    { t: 'img', src: 'icon.svg', alt: 'logo' },
  ])
  assert.deepEqual(inline('see https://laki.dev/x. or <https://a.b>'), ['see ', { t: 'a', href: 'https://laki.dev/x', kids: ['https://laki.dev/x'] }, '. or ', { t: 'a', href: 'https://a.b', kids: ['https://a.b'] }])
  assert.deepEqual(inline('one  \ntwo\nthree<br>four'), ['one', { t: 'br' }, 'two three', { t: 'br' }, 'four'])
  assert.deepEqual(inline('2 * 3 * 4'), ['2 * 3 * 4'])
})

test("GitHub's HTML in Markdown (dependabot's bodies, READMEs): its tags as the same tree, folds as details", () => {
  const body = [
    'Updates `@types/node` from 24 to 26',
    '<details>',
    '<summary>Release <b>notes</b></summary>',
    '<p><em>Sourced from <a href="https://x.dev/r?a=1&amp;b=2">releases</a>.</em></p>',
    '<blockquote>',
    '<h2>v26</h2>',
    '<ul>',
    '<li>fix &quot;asar&quot; by <a href="https://github.com/claude"><code>@claude</code></a></li>',
    '<li>nested<ol><li>one</li><li>two</li></ol></li>',
    '</ul>',
    '</blockquote>',
    '<details open><summary>Inner</summary>deep</details>',
    '</details>',
    '<br />',
    '<!-- a template comment GitHub hides -->',
    '<p align="center"><img src="docs/a.gif" alt="the [demo]"></p>',
  ].join('\n')
  const md = markdown(body, true)
  assert.deepEqual(md[0], { t: 'p', inl: ['Updates ', { t: 'code', text: '@types/node' }, ' from 24 to 26'] })
  const d = md[1] as any
  assert.equal(d.t, 'details')
  assert.equal(d.open, false)
  assert.deepEqual(d.summary, ['Release ', { t: 'b', kids: ['notes'] }])
  assert.deepEqual(d.blocks[0], { t: 'p', inl: [{ t: 'i', kids: ['Sourced from ', { t: 'a', href: 'https://x.dev/r?a=1&b=2', kids: ['releases'] }, '.'] }] })
  const q = d.blocks[1]
  assert.equal(q.t, 'quote')
  assert.deepEqual(q.blocks[0], { t: 'h', level: 2, inl: ['v26'] })
  const items = q.blocks[1].items
  assert.deepEqual(items[0].blocks, [{ t: 'p', inl: ['fix "asar" by ', { t: 'a', href: 'https://github.com/claude', kids: [{ t: 'code', text: '@claude' }] }] }])
  assert.deepEqual(items[1].blocks[1], { t: 'list', ordered: true, start: 1, items: [{ task: undefined, blocks: [{ t: 'p', inl: ['one'] }] }, { task: undefined, blocks: [{ t: 'p', inl: ['two'] }] }] })
  assert.deepEqual(d.blocks[2], { t: 'details', open: true, summary: ['Inner'], blocks: [{ t: 'p', inl: ['deep'] }] })
  assert.deepEqual(md.slice(2), [{ t: 'p', inl: [{ t: 'br' }] }, { t: 'p', inl: [{ t: 'img', src: 'docs/a.gif', alt: 'the demo' }] }])
  // code stays as written: a span's tags, a fence's, <code>'s entities as text; prose keeps a tag it doesn't know
  assert.deepEqual(markdown('use `<details>` and `&amp;` in Vec<String>', true), [{ t: 'p', inl: ['use ', { t: 'code', text: '<details>' }, ' and ', { t: 'code', text: '&amp;' }, ' in Vec<String>'] }])
  assert.deepEqual(markdown('```html\n<details><summary>x</summary></details>\n```', true), [{ t: 'code', lang: 'html', text: '<details><summary>x</summary></details>' }])
  assert.deepEqual(markdown('<code>&lt;div&gt;</code> &lt;b&gt;', true), [{ t: 'p', inl: [{ t: 'code', text: '<div>' }, ' <b>'] }])
  assert.deepEqual(markdown('<pre>a &lt; b\n`x`</pre>', true), [{ t: 'code', lang: '', text: 'a < b\n`x`' }])
  assert.deepEqual(markdown('<script>alert(1)</script>hi <span>there</span>', true), [{ t: 'p', inl: ['hi there'] }])
  assert.deepEqual(markdown('<a href="javascript:alert(1)">x</a>', true)[0], { t: 'p', inl: [{ t: 'a', href: 'javascript:alert%281%29', kids: ['x'] }] }) // a link the renderers never follow
  assert.deepEqual(markdown('add <b>CSV</b> <details>'), [{ t: 'p', inl: ['add <b>CSV</b> <details>'] }], 'without html (what people and agents say): tags stay text')
  assert.deepEqual(markdown('<a href="https://x.dev/a b(c)">x</a>', true)[0], { t: 'p', inl: [{ t: 'a', href: 'https://x.dev/a%20b%28c%29', kids: ['x'] }] })
  assert.deepEqual(markdown('see https://x.dev/?a=1&amp;b=2 &amp; <a data-href="no" href="https://y.dev">y</a><code></code>', true), [{ t: 'p', inl: ['see ', { t: 'a', href: 'https://x.dev/?a=1&b=2', kids: ['https://x.dev/?a=1&b=2'] }, ' & ', { t: 'a', href: 'https://y.dev', kids: ['y'] }] }])
  assert.deepEqual(markdown('a\0b', true), [{ t: 'p', inl: ['ab'] }]) // a NUL of its own is no marker
  assert.deepEqual(markdown('</details> <summary>x</summary>\n\ntext', true), [{ t: 'p', inl: ['text'] }]) // strays: nothing
})
