import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseLink } from '../src/renderer/src/links.ts'
import { feedName, feedOf, newer, RELEASES, releaseOf } from '../src/shared/update.ts'

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
