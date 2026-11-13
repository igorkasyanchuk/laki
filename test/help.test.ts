// laki_help's guide search (src/shared/help.ts): the guide in parts under its headings, the ones a question is about
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { helpFind, helpParts } from '../src/shared/help.ts'

test("help: the guide's paragraphs and list items under their headings; a word in an item's lead counts most; a long one cut to its sentences", () => {
  const md = ['# Laki', '', 'Intro words.', '', '## Using it', '', '- **Archive**: closes a workspace; *Archived* in the sidebar restores it.', '- **Delete**: gone for good,', '  with its branch.', '', '```sh', '# not a heading', 'laki archive x', '```', '', '### Keys', '', `A long one. ${'Filler sentence here. '.repeat(120)}The archive key is ⌘⌫. ${'More filler follows. '.repeat(60)}`].join('\n')
  const parts = helpParts(md, 'Guide')
  assert.deepEqual(parts.map(p => [p.at, p.lead, p.text.split('\n')[0].slice(0, 24)]), [['Guide', '', 'Intro words.'], ['Guide › Using it', 'Archive', '- **Archive**: closes a '], ['Guide › Using it', 'Delete', '- **Delete**: gone for g'], ['Guide › Using it', '', '```sh'], ['Guide › Using it › Keys', '', 'A long one. Filler sente']])
  const r = helpFind(parts, 'How do I archive a workspace?')
  assert.equal(r.parts![0].text, '- **Archive**: closes a workspace; *Archived* in the sidebar restores it.', 'its lead has the word')
  const long = r.parts!.find(p => p.at.endsWith('Keys'))!
  assert.ok(long.text.length < 1500 && long.text.includes('The archive key is ⌘⌫.') && long.text.includes('…'), long.text)
  const none = helpFind(parts, 'zebra crossing')
  assert.deepEqual([none.found, none.topics], [0, ['Guide', 'Archive', 'Delete', 'Guide › Using it', 'Guide › Using it › Keys']])
  assert.equal(helpFind(parts, 'the and how').found, 0, 'only words that say nothing')
})

test("help: Laki's real guide answers what people ask, within what a tool's result may be", () => {
  const parts = [...helpParts(readFileSync('docs/guide.md', 'utf8'), 'Guide'), ...helpParts(readFileSync('docs/features.md', 'utf8'), 'Features')]
  for (const [q, has] of [['get an archived workspace back restore', /restore/i], ['merge when green', /merge when green/i], ['scheduled tasks every weekday', /schedul/i], ['remote access phone', /remote access/i], ['what can I do with a PR', /\bPRs?\b/], ['what is ⌘K', /⌘K/]] as const) {
    const r = helpFind(parts, q)
    assert.ok(r.parts!.length >= 2 && r.parts!.some(p => has.test(p.text)), q)
    assert.ok(JSON.stringify(r).length < 9000, `${q}: ${JSON.stringify(r).length}`)
  }
})
