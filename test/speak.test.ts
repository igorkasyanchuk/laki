import assert from 'node:assert/strict'
import { test } from 'node:test'
import { langOf, speakable } from '../src/shared/speak.ts'

test('speakable: two sentences of plain prose, no code, links, paths, URLs or secrets, 240 at most', () => {
  assert.equal(speakable('**Done.** The tests pass now. I also renamed the helper.'), 'Done. The tests pass now.')
  assert.equal(speakable('Run it like this:\n```sh\nnpm test\n```\nThat runs every file.'), 'Run it like this: That runs every file.') // a code fence out
  assert.equal(speakable('Set `PORT` in [the config](https://x.test/doc) and see /Users/me/app/.env or src/app.ts.'), 'Set in the config and see or.')
  assert.equal(speakable('Your key is sk-abcdefghijklmnopqrstuv1234 and it works. Second one.'), 'Your key is and it works. Second one.') // a token: never read out
  assert.equal(speakable('# Title\n- one item\n- two items'), 'Title one item two items')
  assert.equal(speakable('Set max_retry_count to _three_ now.'), 'Set max retry count to three now.') // snake_case isn't emphasis
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

test('spokenNote: "<workspace> asks: <first sentence>", 20 words at most, never quiet, private, recording, dictating or in view', async () => {
  const { spokenNote, SPOKEN_WORDS } = await import('../src/shared/speak.ts')
  const { AGENT_SETTINGS_OK } = await import('../src/daemon/gates.ts')
  const ask = { kind: 'ask' as const, ws: 'web', text: 'May I run the tests? They take a minute.', on: true }
  assert.equal(spokenNote(ask), 'web asks: May I run the tests?')
  assert.equal(spokenNote({ ...ask, kind: 'done', text: 'Added the CSV export. Tests pass.' }), 'web finished: Added the CSV export.')
  assert.equal(spokenNote({ ...ask, text: '' }), 'web asks.')
  for (const k of ['quiet', 'recording', 'private', 'dictating', 'inView'] as const) assert.equal(spokenNote({ ...ask, [k]: true }), '', k)
  assert.equal(spokenNote({ ...ask, on: false }), '', 'off unless on')
  assert.equal(spokenNote({ ...ask, on: undefined }), '', 'unset: off')
  // a secret, code, a path or a link never said
  const s = spokenNote({ ...ask, text: 'Use sk-abcdefghijklmnopqrstuv1234 and `rm -rf /` at /Users/me/x.ts or https://x.dev/a now' })
  assert.doesNotMatch(s, /sk-|abcdef|rm -rf|\/Users|https/)
  // the 20-word cut
  const long = spokenNote({ ...ask, text: Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ') + '.' })
  assert.equal(long.split(' ').length, SPOKEN_WORDS)
  assert.match(long, /^web asks: w0 w1 .* w17…$/)
  assert.ok(!AGENT_SETTINGS_OK.has('voice'), "the settings are the user's: an agent's settingsSet can't turn them on")
})
