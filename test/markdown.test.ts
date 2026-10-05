// The file preview's Markdown (src/renderer/src/markdown.ts): blocks and inline marks as a tree
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inline, markdown } from '../src/renderer/src/markdown.ts'

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
