import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m3TimestampWithElapsedHours,
  normalizeM3Timestamp,
  parseM3TimestampNanos,
} from '../src/domain/m3ObservationClock.ts'

// Isolated synthetic-only edge acceptance. A produced canonical UTC timestamp
// must be accepted by the very same public parser that defines valid M3 input.
// Unsupported 4-digit-year bounds must fail closed with null, not manufacture
// an unparseable "normalized" string that downstream consumers might trust.

test('QA M3: normalization never emits an unparseable year-0099 UTC instant', () => {
  const input = '0100-01-01T00:00:00.123456789+14:00'
  assert.notEqual(parseM3TimestampNanos(input), null,
    'year 0100 is a supported input calendar year')
  // The equivalent UTC calendar day belongs to year 0099, which the public
  // M3 parser explicitly rejects. Emitting such a string cannot be canonical.
  assert.equal(normalizeM3Timestamp(input), null)
})

test('QA M3: deadline crossing out of supported four-digit range fails closed', () => {
  const input = '9999-12-31T23:59:59.123456789Z'
  assert.notEqual(parseM3TimestampNanos(input), null)
  assert.equal(m3TimestampWithElapsedHours(input, 1), null)
  // The supported-year boundary should stay usable up to the last instant.
  assert.equal(
    normalizeM3Timestamp('9999-12-31T23:59:59.999999999Z'),
    '9999-12-31T23:59:59.999999999Z',
  )
})

test('QA M3: normal 2026 offset and fractional deadline still round-trip exactly', () => {
  const input = '2026-10-24T18:00:00.123456789+02:00'
  const normalized = normalizeM3Timestamp(input)
  assert.equal(normalized, '2026-10-24T16:00:00.123456789Z')
  assert.equal(parseM3TimestampNanos(normalized), parseM3TimestampNanos(input))
  const deadline = m3TimestampWithElapsedHours(input, 24)
  assert.equal(deadline, '2026-10-25T16:00:00.123456789Z')
  assert.equal(parseM3TimestampNanos(deadline),
    parseM3TimestampNanos(input) + 86_400_000_000_000n)
})
