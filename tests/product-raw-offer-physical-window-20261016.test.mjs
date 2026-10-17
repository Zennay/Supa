import assert from 'node:assert/strict'
import test from 'node:test'
import { validateRawProductObservation } from '../src/data/ingestion.ts'

// Product-owner contract tests for #3201. All values are fictional, purely
// in-memory observations; no retailer HTTP, permission or price publication.
const observation = (validFrom, validTo) => ({
  supermarket: 'ah',
  sourceProductId: 'fictional-physical-window',
  name: 'Fictitious test product',
  currentPriceCents: null,
  currency: 'EUR',
  pack: { rawText: '1 st', amount: 1, unit: 'piece' },
  offer: {
    label: 'Fictitious interval',
    mechanics: null,
    offerPriceCents: null,
    originalPriceCents: null,
    validFrom,
    validTo,
  },
  availability: 'unknown',
  provenance: {
    supermarket: 'ah', kind: 'product',
    url: 'https://www.ah.nl/producten/product/fictional',
    capturedAt: '2026-10-04T00:00:00Z',
    sha256: 'a'.repeat(64),
  },
})

test('raw offer keeps inclusive 1ns positive and equal physical instants', () => {
  for (const [start, end] of [
    ['2026-10-16T09:00:00.123456789Z', '2026-10-16T09:00:00.123456790Z'],
    ['2026-10-16T11:00:00.123456789+02:00', '2026-10-16T09:00:00.123456789Z'],
    ['2026-10-16T09:00:00Z', '2026-10-16T09:00:00.000000001Z'],
    ['2026-10-16', '2026-10-17'],
    [null, '2026-10-16T09:00:00Z'],
    ['2026-10-16', null],
  ]) {
    const record = observation(start, end)
    assert.equal(validateRawProductObservation(record), record)
  }
})

test('raw offer refuses reversed UTC and cross-offset 1ns instants', () => {
  for (const [start, end] of [
    ['2026-10-16T09:00:00.123456790Z', '2026-10-16T09:00:00.123456789Z'],
    ['2026-10-16T11:00:00.123456790+02:00', '2026-10-16T09:00:00.123456789Z'],
    ['2026-10-16T09:00:01.000000001Z', '2026-10-16T09:00:01Z'],
    ['2026-10-18', '2026-10-17'],
  ]) {
    assert.throws(() => validateRawProductObservation(observation(start, end)),
      /Offer validity window cannot end before it starts/)
  }
})

test('raw offer refuses normalized impossible civil days and offsets', () => {
  for (const clock of [
    '2025-02-29',
    '2026-02-30T12:00:00Z',
    '2026-13-04',
    '2026-10-16T25:00:00Z',
    '2026-10-16T09:61:00Z',
    '2026-10-16T09:00:61Z',
    '2026-10-16T09:00:00+14:01',
    '2026-10-16T09:00:00-15:00',
    '2026-10-16T09:00:00.1234567890Z',
  ]) {
    assert.throws(() => validateRawProductObservation(observation(clock, null)),
      /Offer validFrom must be null or a valid date\/timestamp/)
    assert.throws(() => validateRawProductObservation(observation(null, clock)),
      /Offer validTo must be null or a valid date\/timestamp/)
  }
})

test('raw offer accepts valid leap day, extreme civil offset and future offers', () => {
  for (const [start, end] of [
    ['2024-02-29', '2024-03-01'],
    ['2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z'],
    ['2026-10-16T14:00:00+14:00', '2026-10-16T00:00:00Z'],
    ['2026-10-16T00:00:00Z', '2026-10-16T14:00:00-14:00'],
  ]) {
    const record = observation(start, end)
    assert.equal(validateRawProductObservation(record), record)
  }
})
