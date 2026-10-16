import assert from 'node:assert/strict'
import test from 'node:test'
import { validateRawProductObservation } from '../src/data/ingestion.ts'

// Synthetic private source evidence only. No live retailer price or content.
const observation = () => ({
  supermarket: 'plus',
  sourceProductId: 'offline-historical-001',
  name: 'Synthetic offline source',
  currentPriceCents: null,
  currency: 'EUR',
  pack: { rawText: null, amount: null, unit: 'unknown' },
  availability: 'unknown',
  provenance: {
    supermarket: 'plus', kind: 'offers',
    url: 'https://www.plus.nl/producten/',
    capturedAt: '2026-10-14T10:00:00Z',
    sha256: 'a'.repeat(64),
  },
  offer: {
    label: 'Fictional offline offer',
    mechanics: null,
    offerPriceCents: null,
    originalPriceCents: null,
    validFrom: null,
    validTo: null,
  },
})

const check = (from, to) => {
  const row = observation()
  row.offer.validFrom = from
  row.offer.validTo = to
  const original = structuredClone(row)
  return [() => validateRawProductObservation(row), row, original]
}

test('1ns and nine-digit fractional UTC intervals preserve valid chronology across offsets', () => {
  const good = [
    ['2026-10-14T12:00:00.000000001+02:00', '2026-10-14T10:00:00.000000002Z'],
    ['2026-10-14T12:00:00.000000001+02:00', '2026-10-14T10:00:00.000000001Z'],
    ['2026-10-14T09:59:59.999999999Z', '2026-10-14T10:00:00Z'],
    ['2026-10-14T09:59:59.999999999Z', '2026-10-14T10:00:00.000000001Z'],
    ['2024-02-29T10:00:00Z', '2024-02-29T10:00:00.000000001Z'],
    ['2026-10-14', '2026-10-14'],
    ['2026-10-13', '2026-10-14T00:00:00Z'],
    [null, '2026-10-14T10:00:00Z'],
    ['2026-10-14T10:00:00Z', null],
    [null, null],
  ]
  for (const [start, end] of good) {
    const [validate, row, snapshot] = check(start, end)
    assert.equal(validate(), row, 'valid evidence stays referentially unchanged')
    assert.deepEqual(row, snapshot, 'source observation must not be mutated')
  }
})

test('submillisecond and offset-reversed private offers fail closed before price matching', () => {
  const bad = [
    ['2026-10-14T10:00:00.000000002Z', '2026-10-14T10:00:00.000000001Z'],
    ['2026-10-14T12:00:00.000000002+02:00', '2026-10-14T10:00:00.000000001Z'],
    ['2026-10-14T10:00:00.001000001Z', '2026-10-14T10:00:00.001000000Z'],
    ['2026-10-14T10:00:00Z', '2026-10-14T11:00:00+02:00'],
    ['2026-10-15T00:00:00Z', '2026-10-14T23:59:59.999999999Z'],
    ['2026-10-14T10:00:00Z', '2026-10-13'],
  ]
  for (const [start, end] of bad) {
    const [validate] = check(start, end)
    assert.throws(validate, /Offer validity window cannot end before it starts/)
  }
})

test('impossible civil days and non-leap years are not normalized into valid offers', () => {
  for (const invalid of [
    '2025-02-29T10:00:00Z',
    '2026-02-30T10:00:00Z',
    '2026-04-31',
    '2024-02-30',
    '2026-00-14',
    '2026-13-01',
    '2026-10-00',
    '2026-10-32',
  ]) {
    const [badStart] = check(invalid, '2026-12-31T10:00:00Z')
    const [badEnd] = check('2024-01-01T10:00:00Z', invalid)
    assert.throws(badStart, /Offer validFrom must be null or a valid date\/timestamp/)
    assert.throws(badEnd, /Offer validTo must be null or a valid date\/timestamp/)
  }
})

test('no local/ambiguous timezone, invalid offset or leap second can authorize an offer', () => {
  for (const invalid of [
    '2026-10-14T10:00:00',
    '2026-10-14 10:00:00Z',
    '2026-10-14T10:00:60Z',
    '2026-10-14T24:00:00Z',
    '2026-10-14T10:60:00Z',
    '2026-10-14T10:00:00+15:00',
    '2026-10-14T10:00:00+14:01',
    '2026-10-14T10:00:00+02:60',
    '2026-10-14T10:00:00.1234567890Z',
    '2026-10-14T10:00:00.123456789Z trailing',
    '2026-10-14T10:00:00+0200',
    '2026-10-14Z',
    'october 14, 2026',
    '',
  ]) {
    const [bad] = check(invalid, null)
    assert.throws(bad, /Offer validFrom must be null or a valid date\/timestamp/)
  }
})

test('date-only midnight is physical UTC and cannot outlive an earlier same-date offset', () => {
  // Equal local calendar dates are not necessarily equal physical instants.
  const [bad] = check('2026-10-14', '2026-10-14T00:30:00+02:00')
  assert.throws(bad, /Offer validity window cannot end before it starts/)
  const [good] = check('2026-10-14T00:30:00+02:00', '2026-10-14')
  assert.doesNotThrow(good)
})
