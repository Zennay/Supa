import assert from 'node:assert/strict'
import test from 'node:test'

import { validateRawProductObservation } from '../src/data/ingestion.ts'

const baseObservation = {
  supermarket: 'ah',
  sourceProductId: 'wi1525',
  name: 'AH Halfvolle melk',
  currentPriceCents: 129,
  currency: 'EUR',
  pack: {
    rawText: '1 l',
    amount: 1,
    unit: 'l',
  },
  offer: null,
  availability: 'available',
  provenance: {
    supermarket: 'ah',
    kind: 'product',
    url: 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk',
    capturedAt: '2026-10-04T00:00:00.000Z',
    sha256: 'a'.repeat(64),
  },
}

test('traceable raw product observation passes the M1 trust gate', () => {
  assert.equal(validateRawProductObservation(baseObservation), baseObservation)
})

test('money stays integer cents', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        currentPriceCents: 1.29,
      }),
    /integer cent value/,
  )
})

test('provenance requires exact snapshot hash', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        provenance: {
          ...baseObservation.provenance,
          sha256: 'not-a-hash',
        },
      }),
    /SHA-256/,
  )
})
