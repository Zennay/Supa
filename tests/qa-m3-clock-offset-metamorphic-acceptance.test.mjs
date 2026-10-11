import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateM3ObservationInterval,
  m3TimestampWithElapsedHours,
  normalizeM3Timestamp,
  parseM3TimestampNanos,
} from '../src/domain/m3ObservationClock.ts'

// Independent fixed UTC-second anchor: no production parser, formatter, or
// elapsed-time helper participates in calculating the expected timestamp.
const ANCHOR = BigInt(Date.UTC(2026, 9, 24, 16, 0, 0)) * 1_000_000n
const HOUR = 3_600_000_000_000n
const DAY = 24n * HOUR

const equivalentInstants = [
  '2026-10-24T16:00:00Z',
  '2026-10-24T17:00:00+01:00',
  '2026-10-24T18:00:00+02:00',
  '2026-10-24T21:45:00+05:45',
  '2026-10-24T11:30:00-04:30',
]

test('QA M3: fractional seconds retain every digit across five independent UTC offsets', () => {
  const digits = '123456789'
  for (let width = 1; width <= 9; width++) {
    const fraction = digits.slice(0, width)
    const expected = ANCHOR + BigInt(fraction.padEnd(9, '0'))
    for (const clock of equivalentInstants) {
      const input = clock.replace('00Z', '00.' + fraction + 'Z')
        .replace(/:00([+-])/, ':00.' + fraction + '$1')
      assert.equal(parseM3TimestampNanos(input), expected, input)
      const normalized = normalizeM3Timestamp(input)
      assert.ok(normalized, input)
      assert.equal(parseM3TimestampNanos(normalized), expected, input)
      assert.equal(normalizeM3Timestamp(normalized), normalized, input)
    }
  }
})

test('QA M3: one-nanosecond and exact-24h thresholds do not depend on local offset or argument direction', () => {
  const baseline = '2026-10-24T18:00:00.123456789+02:00'
  const scenarios = [
    ['2026-10-25T17:00:00.123456788+01:00', DAY - 1n, true],
    ['2026-10-25T17:00:00.123456789+01:00', DAY, true],
    ['2026-10-25T17:00:00.123456790+01:00', DAY + 1n, false],
    ['2026-10-25T11:30:00.123456790-04:30', DAY + 1n, false],
  ]
  for (const [candidate, expectedNanos, withinWindow] of scenarios) {
    for (const [first, second] of [[baseline, candidate], [candidate, baseline]]) {
      const result = evaluateM3ObservationInterval(first, second)
      assert.ok(result, candidate)
      assert.equal(result.elapsedNanos, expectedNanos, candidate)
      assert.equal(result.withinWindow, withinWindow, candidate)
    }
  }
})

test('QA M3: fractional-hour limits reject the first nanosecond beyond the window', () => {
  const baseline = '2026-10-24T18:00:00.123456789+02:00'
  for (const [exact, outside, hours] of [
    ['2026-10-24T16:15:00.123456789Z', '2026-10-24T16:15:00.123456790Z', 0.25],
    ['2026-10-24T16:06:00.123456789Z', '2026-10-24T16:06:00.123456790Z', 0.1],
    ['2026-10-24T17:30:00.123456789Z', '2026-10-24T17:30:00.123456790Z', 1.5],
  ]) {
    assert.equal(evaluateM3ObservationInterval(baseline, exact, hours)?.withinWindow, true)
    assert.equal(evaluateM3ObservationInterval(baseline, outside, hours)?.withinWindow, false)
  }
})

test('QA M3: normalized deadlines preserve nanoseconds, UTC instant and formatter idempotence', () => {
  const original = '2026-10-24T18:00:00.123456789+02:00'
  const deadline = m3TimestampWithElapsedHours(original, 24)
  assert.equal(deadline, '2026-10-25T16:00:00.123456789Z')
  assert.equal(parseM3TimestampNanos(deadline), parseM3TimestampNanos(original) + DAY)
  assert.equal(normalizeM3Timestamp(deadline), deadline)
  assert.equal(
    m3TimestampWithElapsedHours('2026-10-24T18:00:00.000000001+02:00', 0.25),
    '2026-10-24T16:15:00.000000001Z',
  )
  assert.equal(m3TimestampWithElapsedHours(original, 1e-13), null)
})

test('QA M3: malformed timestamps cannot be rescued by a valid offset or normalization', () => {
  for (const invalid of [
    '2026-10-24T16:00:00.1234567890Z',
    '2026-10-24T16:00:00.123456789+24:00',
    '2026-10-24T16:00:00.123456789-00:60',
    '2026-02-29T16:00:00.123456789Z',
    '2026-04-31T16:00:00.123456789+02:00',
    '0099-10-24T16:00:00.123456789Z',
    '2026-10-24T16:00:60.123456789Z',
    '2026-10-24T16:00:00.123456789',
  ]) {
    assert.equal(parseM3TimestampNanos(invalid), null, invalid)
    assert.equal(normalizeM3Timestamp(invalid), null, invalid)
    assert.equal(evaluateM3ObservationInterval(invalid, equivalentInstants[0]), null, invalid)
  }
})
