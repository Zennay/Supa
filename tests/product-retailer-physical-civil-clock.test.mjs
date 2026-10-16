import assert from 'node:assert/strict'
import test from 'node:test'
import {
  physicalCaptureNanoseconds,
  samePhysicalCaptureInstant,
} from '../scripts/retailer-physical-civil-clock.mjs'

const ORIGINAL = '2026-10-04T18:08:57.837123456Z'

test('accepts exact physical aliases in real civil UTC offset endpoints', () => {
  for (const alias of [
    '2026-10-04T18:08:57.837123456+00:00',
    '2026-10-04T20:08:57.837123456+02:00',
    '2026-10-04T06:08:57.837123456-12:00',
    '2026-10-05T08:08:57.837123456+14:00',
  ]) {
    assert.equal(samePhysicalCaptureInstant(ORIGINAL, alias), true, alias)
  }
})

test('rejects impossible negative UTC civil offsets and positive overflow', () => {
  for (const offset of ['-12:01', '-13:00', '-14:00', '-13:59', '-00:00', '+14:01', '+15:00', '+13:60']) {
    assert.equal(physicalCaptureNanoseconds(`2026-10-04T18:08:57.837123456${offset}`), null, offset)
  }
  assert.notEqual(physicalCaptureNanoseconds('2026-10-04T18:08:57-11:59'), null)
  assert.notEqual(physicalCaptureNanoseconds('2026-10-04T18:08:57+13:59'), null)
})

test('rejects impossible Gregorian and clock inputs without JS rollover', () => {
  for (const input of [
    '2026-02-29T12:00:00Z', '2026-02-30T12:00:00Z',
    '2026-04-31T12:00:00Z', '2026-13-01T12:00:00Z',
    '2026-00-01T12:00:00Z', '0000-01-01T12:00:00Z',
    '2026-10-04T24:00:00Z', '2026-10-04T18:60:00Z',
    '2026-10-04T18:08:60Z', '2026-10-04T18:08:57+14:30',
    '2026-10-04 18:08:57Z', '2026-10-04T18:08Z',
    '2026-10-04T18:08:57.1234567890Z',
  ]) assert.equal(physicalCaptureNanoseconds(input), null, input)
  assert.notEqual(physicalCaptureNanoseconds('2024-02-29T12:00:00Z'), null)
  assert.notEqual(physicalCaptureNanoseconds('0099-12-31T23:59:59Z'), null)
})

test('preserves nine decimal digits and distinguishes one-nanosecond recaptures', () => {
  const first = physicalCaptureNanoseconds(ORIGINAL)
  const second = physicalCaptureNanoseconds('2026-10-04T18:08:57.837123457Z')
  assert.equal(second - first, 1n)
  assert.equal(samePhysicalCaptureInstant(ORIGINAL, '2026-10-04T20:08:57.837123457+02:00'), false)
  assert.equal(samePhysicalCaptureInstant('2026-10-04T18:08:57.837Z', ORIGINAL), false)
  assert.equal(samePhysicalCaptureInstant('2026-10-04T18:08:57.837000000Z', '2026-10-04T18:08:57.837Z'), true)
})

test('rejects forged caller values without invoking getters or coercions', () => {
  let coerced = 0
  const hostile = { toString() { coerced++; throw new Error('not executed') } }
  assert.equal(physicalCaptureNanoseconds(hostile), null)
  assert.equal(samePhysicalCaptureInstant(ORIGINAL, hostile), false)
  assert.equal(physicalCaptureNanoseconds(null), null)
  assert.equal(physicalCaptureNanoseconds('2026-10-04T18:08:57.837Z\\n'), null)
  assert.equal(coerced, 0)
})
