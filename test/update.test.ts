import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseLink } from '../src/renderer/src/links.ts'
import { feedName, feedOf, heldUntil, newer, notesOf, RELEASES, releaseOf, verdict } from '../src/shared/update.ts'

test('newer: numbers by part, a pre-release before its release, a leading v', () => {
  assert.equal(newer('0.25.0', '0.24.0'), true)
  assert.equal(newer('0.24.10', '0.24.9'), true)
  assert.equal(newer('1.0.0', '0.99.99'), true)
  assert.equal(newer('v0.25.0', '0.25.0'), false)
  assert.equal(newer('0.24.0', '0.25.0'), false)
  assert.equal(newer('0.25.0', '0.25.0-beta.2'), true)
  assert.equal(newer('0.25.0-beta.10', '0.25.0-beta.2'), true)
  assert.equal(newer('0.25.0-beta.1', '0.25.0'), false)
  assert.equal(newer('1.0.0-rc-2', '1.0.0-rc-1'), true) // a hyphen inside the pre-release
})

test("releaseOf: GitHub's latest release, with this Mac's feed or not", () => {
  const r = { tag_name: 'v0.25.0', body: ' - new things \n', html_url: 'https://github.com/x/y/releases/tag/v0.25.0', assets: [{ name: 'Laki-0.25.0-arm64.zip' }, { name: feedName('arm64') }] }
  assert.deepEqual(releaseOf(r, 'arm64'), { version: '0.25.0', notes: '- new things', url: r.html_url, at: undefined, feed: true })
  assert.equal(releaseOf(r, 'x64')!.feed, false)
  assert.equal(releaseOf({}, 'arm64'), null)
})

test("feedOf: Squirrel.Mac's static feed for one Mac's zip", () => {
  const f = JSON.parse(feedOf('0.25.0', 'x64', 'notes', '2026-10-22T00:00:00.000Z'))
  assert.equal(f.currentRelease, '0.25.0')
  assert.deepEqual(f.releases[0].updateTo, { version: '0.25.0', name: 'Laki 0.25.0', notes: 'notes', pub_date: '2026-10-22T00:00:00Z', url: `https://github.com/${RELEASES}/releases/download/v0.25.0/Laki-0.25.0-x64.zip` })
})

test("the app checks the repo releases go to (package.json's build.publish)", () => {
  const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build.publish
  assert.equal(RELEASES, `${p.owner}/${p.repo}`)
})

test('the app menu\'s Check for Updates… link opens General at its Updates group', () => {
  assert.deepEqual(parseLink('laki://settings/general?spot=Updates'), { to: 'settings', section: 'general', spot: 'Updates' })
  assert.deepEqual(parseLink('laki://settings/general'), { to: 'settings', section: 'general' })
})

test('R7 verdict: a skipped version is not offered, the next one is; the delay holds a release unless let in', () => {
  const rel = (version: string, at = '2026-11-01T00:00:00Z') => ({ version, notes: '', url: '', at, feed: true })
  const now = Date.parse('2026-11-02T00:00:00Z')
  assert.equal(verdict(null, '0.47.0', {}, 0, now), 'none')
  assert.equal(verdict(rel('0.47.0'), '0.47.0', {}, 0, now), 'none')
  assert.equal(verdict(rel('0.48.0'), '0.47.0', {}, 0, now), 'offer')
  assert.equal(verdict(rel('0.48.0'), '0.47.0', { pass: '0.48.0' }, 0, now), 'passed')
  assert.equal(verdict(rel('0.49.0'), '0.47.0', { pass: '0.48.0' }, 0, now), 'offer', 'a newer one')
  assert.equal(verdict(rel('0.48.0'), '0.48.0', { pass: '0.48.0' }, 0, now), 'none', 'installed by hand: nothing to skip')
  assert.equal(typeof verdict(rel('0.48.0'), '0.47.0', {}, 7, now), 'number', 'held by the delay')
  assert.equal(verdict(rel('0.48.0'), '0.47.0', { skip: '0.48.0' }, 7, now), 'offer', 'Skip the delay once')
  assert.equal(verdict(rel('0.48.0'), '0.47.0', { pass: '0.48.0', skip: '0.48.0' }, 7, now), 'passed')
})

test('heldUntil: a release waits out the update delay from its publish date', () => {
  const at = '2026-11-01T12:00:00Z'
  const t = Date.parse(at)
  assert.equal(heldUntil(at, 3, t + 86_400_000), t + 3 * 86_400_000) // a day old, 3 days asked: held
  assert.equal(heldUntil(at, 3, t + 3 * 86_400_000), undefined) // old enough: offered
  assert.equal(heldUntil(at, 0, t), undefined) // no delay
  assert.equal(heldUntil(undefined, 7, t), undefined) // no date: offered, never held for good
  assert.equal(heldUntil('not a date', 7, t), undefined)
})

test("U13: What's new: a version's first three lines, each with its trailing laki:// link apart", () => {
  const md = `<!-- a comment
## 0.9.0 · in a comment -->

## Next

- Not out yet. [Try it](laki://board)

## 0.49.0 · Nov 20, 2026

- The quick bar opens from any app. [Try it](laki://quick)
- A plain line, [a link](https://example.com) inside it.
- Remote access keeps its address. [Open it](laki://settings/remote?spot=Address)
- A fourth line.

## 0.48.0 · Nov 11, 2026

- Older.
`
  assert.deepEqual(notesOf(md, '0.49.0'), [
    { text: 'The quick bar opens from any app.', link: 'laki://quick' },
    { text: 'A plain line, [a link](https://example.com) inside it.' },
    { text: 'Remote access keeps its address.', link: 'laki://settings/remote?spot=Address' },
  ])
  assert.deepEqual(notesOf(md, '0.48.0'), [{ text: 'Older.' }])
  assert.deepEqual(notesOf(md, '0.4.0'), [], 'no section: nothing')
  assert.deepEqual(notesOf(md, '0.9.0'), [], 'a heading in a comment is none')
  assert.deepEqual(notesOf(md, '0.49'), [], 'a version exactly')
  // the real file: every released version's lines parse, a link only ever laki://
  const real = readFileSync(new URL('../docs/release-notes.md', import.meta.url), 'utf8')
  for (const v of [...real.matchAll(/^## (\d+\.\d+\.\d+) ·/gm)].map(m => m[1]).slice(0, 5)) {
    const lines = notesOf(real, v)
    assert.ok(lines.length > 0 && lines.length <= 3, v)
    for (const l of lines) assert.ok(!l.link || l.link.startsWith('laki://'), v)
  }
})
