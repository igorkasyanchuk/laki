import assert from 'node:assert/strict'
import { test } from 'node:test'
import { langOf, speakable } from '../src/shared/speak.ts'

test('speakable: two sentences of plain prose, no code, links, paths, URLs or secrets, 240 at most', () => {
  assert.equal(speakable('**Done.** The tests pass now. I also renamed the helper.'), 'Done. The tests pass now.')
  assert.equal(speakable('Run it like this:\n```sh\nnpm test\n```\nThat runs every file.'), 'Run it like this: That runs every file.') // a code fence out
  assert.equal(speakable('Set `PORT` in [the config](https://x.test/doc) and see /Users/me/app/.env or src/app.ts.'), 'Set in the config and see or.')
  assert.equal(speakable('Your key is sk-abcdefghijklmnopqrstuv1234 and it works. Second one.'), 'Your key is and it works. Second one.') // a token: never read out
  assert.equal(speakable('# Title\n- one item\n- two items'), 'Title one item two items')
  const long = speakable(`${'word '.repeat(30)}ends here. ${'more '.repeat(60)}`)
  assert.equal(long, `${'word '.repeat(30)}ends here.`.replace(/\s+/g, ' ')) // cut at its sentence's end
  const one = speakable('x'.repeat(10) + ' ' + 'y '.repeat(200))
  assert.ok(one.length <= 241 && one.endsWith('…'), one) // no sentence end: a word's
  assert.equal(speakable('```\nonly code\n```'), '')
})

test('langOf: by its script, the user\'s languages first; Latin: theirs', () => {
  assert.equal(langOf('Привіт, як справи?', ['uk-UA', 'en-US']), 'uk')
  assert.equal(langOf('Привет, как дела?', ['en-US']), 'ru')
  assert.equal(langOf('こんにちは、世界', []), 'ja')
  assert.equal(langOf('你好世界', []), 'zh')
  assert.equal(langOf('Hello there', ['de-DE']), 'de-DE')
  assert.equal(langOf('Hello', []), undefined)
})
