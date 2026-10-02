import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limitReset } from '../src/daemon/limits.ts'

const now = new Date('2026-10-03T10:00:00Z')
const iso = (d: Date | null) => d?.toISOString()

test('limit notices and their reset times', () => {
  assert.equal(iso(limitReset("⎿ You've hit your limit · resets 3pm (UTC)", now)), '2026-10-03T15:00:00.000Z')
  assert.equal(iso(limitReset("You've hit your limit · resets 3:30pm (Europe/Kyiv)", now)), '2026-10-03T12:30:00.000Z')
  assert.equal(iso(limitReset('■ You\'ve hit your usage limit. Try again in 2 hours 5 minutes.', now)), '2026-10-03T12:05:00.000Z')
  assert.equal(iso(limitReset("You've hit your limit · resets Oct 5, 9am (UTC)", now)), '2026-10-05T09:00:00.000Z')
  // long gone today: tomorrow's
  assert.equal(iso(limitReset("You've hit your limit · resets 7pm (UTC)", new Date('2026-10-03T23:30:00Z'))), '2026-10-03T19:00:00.000Z')
  assert.equal(iso(limitReset("You've hit your limit · resets 9am (UTC)", new Date('2026-10-03T23:30:00Z'))), '2026-10-04T09:00:00.000Z')
  // wrapped onto the next line
  assert.equal(iso(limitReset("You've hit your limit ·\nresets 4pm (UTC)", now)), '2026-10-03T16:00:00.000Z')
  // an answer quoting one doesn't count; no notice, no limit
  assert.equal(limitReset('the docs say "You\'ve hit your limit · resets 3pm"', now), null)
  assert.equal(limitReset('all good', now), null)
})
