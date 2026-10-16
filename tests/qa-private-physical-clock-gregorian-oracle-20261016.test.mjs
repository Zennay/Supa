import assert from 'node:assert/strict'
import test from 'node:test'
import {
  physicalCaptureNanoseconds,
  samePhysicalCaptureInstant,
} from '../scripts/retailer-physical-civil-clock.mjs'

// Independent proleptic-Gregorian civil-day oracle (integer arithmetic only).
// It intentionally does NOT use Date, Date.parse or the product implementation.
const DAY_NS = 86_400_000_000_000n
const SECOND_NS = 1_000_000_000n

function daysSinceUnixEpoch(year, month, day) {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yearOfEra = y - era * 400
  const shiftedMonth = month + (month > 2 ? -3 : 9)
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1
  const yearDay = yearOfEra * 365 + Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + yearDay - 719468
}

function leap(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}
function monthLength(year, month) {
  if (month === 2) return leap(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
function pad(n, width) { return String(n).padStart(width, '0') }
function stamp(y, m, d, hh = 0, mm = 0, ss = 0, frac = '', zone = 'Z') {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}${frac ? '.' + frac : ''}${zone}`
}
function expectedNs(y, m, d, hh = 0, mm = 0, ss = 0, fraction = '', offsetMinutes = 0) {
  return BigInt(daysSinceUnixEpoch(y, m, d)) * DAY_NS +
    BigInt(hh * 3600 + mm * 60 + ss - offsetMinutes * 60) * SECOND_NS +
    BigInt(fraction.padEnd(9, '0') || '0')
}

test('calendar oracle: every date in one full Gregorian 400-year cycle (including all invalid 29-31 days)', () => {
  let valid = 0
  let invalid = 0
  for (let year = 2000; year < 2400; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 31; day++) {
        const input = stamp(year, month, day, 12, 34, 56, '123456789')
        const observed = physicalCaptureNanoseconds(input)
        if (day > monthLength(year, month)) {
          assert.equal(observed, null, `invalid Gregorian date ${input}`)
          invalid++
        } else {
          assert.equal(observed, expectedNs(year, month, day, 12, 34, 56, '123456789'),
            `independent integer oracle mismatch for ${input}`)
          valid++
        }
      }
    }
  }
  assert.equal(valid, 146097)
  assert.equal(invalid, 400 * 12 * 31 - 146097)
})

test('calendar oracle: historical century rules, proleptic calendar, year 0001 and 9999', () => {
  const cases = [
    [1, 1, 1], [4, 2, 29], [99, 12, 31], [100, 2, 28],
    [400, 2, 29], [1582, 10, 15], [1600, 2, 29],
    [1700, 2, 28], [1800, 2, 28], [1900, 2, 28],
    [1970, 1, 1], [1999, 12, 31], [2000, 2, 29],
    [2100, 2, 28], [2400, 2, 29], [9999, 12, 31],
  ]
  for (const [year, month, day] of cases) {
    const input = stamp(year, month, day, 23, 59, 59, '999999999')
    assert.equal(physicalCaptureNanoseconds(input),
      expectedNs(year, month, day, 23, 59, 59, '999999999'), input)
  }
  for (const year of [100, 1700, 1800, 1900, 2100, 2200, 2300]) {
    assert.equal(physicalCaptureNanoseconds(stamp(year, 2, 29)), null,
      `non-leap century ${year}`)
  }
  for (const year of [4, 400, 1600, 2000, 2400]) {
    assert.equal(physicalCaptureNanoseconds(stamp(year, 2, 29)),
      expectedNs(year, 2, 29), `leap century ${year}`)
  }
})

test('calendar oracle: midnight/year boundaries are consecutive by exactly one nanosecond', () => {
  for (const year of [1, 99, 100, 399, 400, 1582, 1899, 1900, 1999, 2000, 2099, 2100, 2399, 9998]) {
    const before = stamp(year, 12, 31, 23, 59, 59, '999999999')
    const after = stamp(year + 1, 1, 1, 0, 0, 0, '000000000')
    const beforeNs = physicalCaptureNanoseconds(before)
    const afterNs = physicalCaptureNanoseconds(after)
    assert.equal(beforeNs, expectedNs(year, 12, 31, 23, 59, 59, '999999999'), before)
    assert.equal(afterNs, expectedNs(year + 1, 1, 1), after)
    assert.equal(afterNs - beforeNs, 1n, `year rollover ${year}`)
    assert.equal(samePhysicalCaptureInstant(before, after), false)
  }
})

test('calendar oracle: legal offsets normalize to independently calculated UTC across era/day edges', () => {
  const offsets = [
    ['+14:00', 14 * 60], ['+13:59', 13 * 60 + 59],
    ['+00:00', 0], ['Z', 0], ['-00:01', -1],
    ['-11:59', -11 * 60 - 59], ['-12:00', -12 * 60],
  ]
  for (const [year, month, day] of [[1, 1, 1], [99, 12, 31], [1900, 3, 1], [1970, 1, 1], [2000, 2, 29], [9999, 12, 31]]) {
    for (const [offset, minutes] of offsets) {
      const input = stamp(year, month, day, 0, 0, 0, '000000001', offset)
      assert.equal(physicalCaptureNanoseconds(input),
        expectedNs(year, month, day, 0, 0, 0, '000000001', minutes), input)
    }
  }
  // -00:00 communicates an unknown local offset; it must not certify source chronology.
  assert.equal(physicalCaptureNanoseconds('2026-10-04T00:00:00-00:00'), null)
})

test('calendar oracle: fractional precision pads rather than rounds, before and after UNIX epoch', () => {
  for (const [y, m, d] of [[1, 1, 1], [1969, 12, 31], [1970, 1, 1], [2026, 10, 16], [9999, 12, 31]]) {
    const base = expectedNs(y, m, d, 23, 59, 59)
    for (const digits of ['1', '12', '123', '1234', '12345', '123456', '1234567', '12345678', '123456789']) {
      const input = stamp(y, m, d, 23, 59, 59, digits)
      assert.equal(physicalCaptureNanoseconds(input), base + BigInt(digits.padEnd(9, '0')), input)
    }
    assert.equal(physicalCaptureNanoseconds(stamp(y, m, d, 23, 59, 59)),
      base)
  }
})
