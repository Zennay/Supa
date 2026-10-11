import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseM3TimestampNanos,
  evaluateM3ObservationInterval,
  m3TimestampWithElapsedHours,
} from '../src/domain/m3ObservationClock.ts'

const DAY_NS = 86_400_000_000_000n

test('M3 uses exact nanoseconds for equal, inside and 1ns-over 24-hour intervals', () => {
  const initial = '2026-10-24T16:00:00.000000000Z'
  for (const [later, delta, eligible] of [
    ['2026-10-25T16:00:00.000000000Z', DAY_NS, true],
    ['2026-10-25T15:59:59.999999999Z', DAY_NS - 1n, true],
    ['2026-10-25T16:00:00.000000001Z', DAY_NS + 1n, false],
    ['2026-10-25T16:00:00.000999999Z', DAY_NS + 999_999n, false],
  ]) {
    for (const pair of [[initial, later], [later, initial]]) {
      const observation = evaluateM3ObservationInterval(...pair)
      assert.ok(observation)
      assert.equal(observation.elapsedNanos, delta)
      assert.equal(observation.withinWindow, eligible)
    }
  }
})

test('M3 compares absolute instants across DST, leap days and non-Z UTC offsets', () => {
  const scenarios = [
    ['2026-03-29T01:30:00+01:00', '2026-03-30T02:30:00+02:00', DAY_NS],
    ['2026-10-24T02:30:00+02:00', '2026-10-25T01:30:00+01:00', DAY_NS],
    ['2028-02-29T00:00:00.123456789Z', '2028-03-01T00:00:00.123456788Z', DAY_NS - 1n],
    ['2026-10-24T16:00:00.100000000+02:00', '2026-10-25T15:00:00.100000001+01:00', DAY_NS + 1n],
  ]
  for (const [earlier, later, exact] of scenarios) {
    const observation = evaluateM3ObservationInterval(earlier, later, 24)
    assert.ok(observation)
    assert.equal(observation.elapsedNanos, exact)
    assert.equal(observation.withinWindow, exact <= DAY_NS)
  }
})

test('M3 15m, 1h, 1.5h and decimal-hour windows use exact integer comparison', () => {
  for (const [baseline, valid, tooLate, maxHours] of [
    ['2026-10-24T16:00:00Z', '2026-10-24T16:15:00Z', '2026-10-24T16:15:00.000000001Z', 0.25],
    ['2026-10-24T16:00:00Z', '2026-10-24T17:00:00Z', '2026-10-24T17:00:00.000000001Z', 1],
    ['2026-10-24T16:00:00Z', '2026-10-24T17:30:00Z', '2026-10-24T17:30:00.000000001Z', 1.5],
    ['2026-10-24T16:00:00Z', '2026-10-24T16:06:00Z', '2026-10-24T16:06:00.000000001Z', 0.1],
  ]) {
    assert.equal(evaluateM3ObservationInterval(baseline, valid, maxHours)?.withinWindow, true)
    assert.equal(evaluateM3ObservationInterval(baseline, tooLate, maxHours)?.withinWindow, false)
  }
})

test('M3 rejects malformed timestamps and invalid hour limits without comparing prices', () => {
  for (const invalid of [
    null, 0, {}, '', '2026-02-29T12:00:00Z', '2026-10-24T24:00:00Z',
    '2026-10-24T12:61:00Z', '2026-10-24T12:00:60Z',
    '2026-10-24T12:00:00+24:00', '2026-10-24T12:00:00+01:60',
    '2026-10-24T12:00:00.1234567890Z', '2026-10-24 12:00:00Z',
    '2026-10-24T12:00:00', '99999-01-01T00:00:00Z',
  ]) {
    assert.equal(parseM3TimestampNanos(invalid), null)
    assert.equal(evaluateM3ObservationInterval(invalid, '2026-10-24T12:00:00Z'), null)
  }
  for (const invalid of [0, -1, null, NaN, Infinity, -Infinity, '24', {}, []]) {
    assert.equal(evaluateM3ObservationInterval('2026-10-24T12:00:00Z', '2026-10-25T12:00:00Z', invalid), null)
  }
})

test('M3 retains all 1–9 exact fractional digits including meaningful trailing zeros', () => {
  const epoch = parseM3TimestampNanos('2026-10-24T16:00:00Z')
  assert.equal(typeof epoch, 'bigint')
  for (let width = 1; width <= 9; width++) {
    assert.equal(
      parseM3TimestampNanos(`2026-10-24T16:00:00.${'0'.repeat(width)}Z`),
      epoch,
    )
  }
  assert.equal(parseM3TimestampNanos('2026-10-24T16:00:00.123456789Z'), epoch + 123_456_789n)
  assert.equal(parseM3TimestampNanos('2026-10-24T16:00:00.000000001Z'), epoch + 1n)
})

test('M3 collector deadlines preserve observed subseconds instead of fabricating millisecond precision', () => {
  assert.equal(
    m3TimestampWithElapsedHours('2026-10-24T16:00:00.123456789+02:00', 24),
    '2026-10-25T14:00:00.123456789Z',
  )
  assert.equal(
    m3TimestampWithElapsedHours('2026-10-24T16:00:00Z', 0.25),
    '2026-10-24T16:15:00.000000000Z',
  )
  assert.equal(
    m3TimestampWithElapsedHours('2026-10-24T16:00:00.123456789Z', 0.0000000000001),
    null,
  )
  assert.equal(m3TimestampWithElapsedHours('not-a-clock', 24), null)
})
