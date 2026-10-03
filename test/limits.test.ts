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

test('limit notices: durations, dates, zones, and what is not a time', () => {
  // codex's duration, in any units; an unknown zone falls back to the local one
  assert.equal(iso(limitReset('■ usage limit reached · try again in 1 day 2 hrs 30 mins 15 secs', now)), '2026-10-04T12:30:15.000Z')
  assert.equal(iso(limitReset("You've hit your usage limit. Try again in 2h (Mars/Olympus)", now)), '2026-10-03T12:00:00.000Z')
  assert.equal(iso(limitReset("You've hit your limit · continuing automatically at 13:15 (UTC)", now)), '2026-10-03T13:15:00.000Z')
  // a date with a year; one without that's long gone is next year's
  assert.equal(iso(limitReset("You've hit your limit · resets Jan 5, 2027, 9am (UTC)", now)), '2027-01-05T09:00:00.000Z')
  assert.equal(iso(limitReset("You've hit your limit · resets Feb 1st 6pm (UTC)", now)), '2027-02-01T18:00:00.000Z')
  // a notice without a time, or with one that isn't
  for (const s of ["You've hit your limit", "You've hit your limit · resets 25:00 (UTC)", "You've hit your limit · resets Foo 5, 9am (UTC)", "You've hit your limit · resets Anf 5, 9am (UTC)", "You've hit your limit · resets soon"])
    assert.equal(limitReset(s, now), null, s)
})
