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
    /safe integer cent value/,
  )
})

test('source money rejects integers outside JavaScript safe precision', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        currentPriceCents: Number.MAX_SAFE_INTEGER + 1,
      }),
    /safe integer cent value/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        offer: {
          label: 'Bonus',
          mechanics: null,
          offerPriceCents: Number.MAX_SAFE_INTEGER + 1,
          originalPriceCents: 129,
          validFrom: null,
          validTo: null,
        },
      }),
    /Offer price.*safe integer cent value/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        offer: {
          label: 'Bonus',
          mechanics: null,
          offerPriceCents: 99,
          originalPriceCents: Number.MAX_SAFE_INTEGER + 1,
          validFrom: null,
          validTo: null,
        },
      }),
    /Original price.*safe integer cent value/,
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

test('observation supermarket must match provenance supermarket', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        provenance: {
          ...baseObservation.provenance,
          supermarket: 'plus',
        },
      }),
    /match provenance supermarket/,
  )
})

test('provenance host must match the observation supermarket', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        provenance: {
          ...baseObservation.provenance,
          url: 'https://www.plus.nl/producten',
        },
      }),
    /www\.ah\.nl/,
  )
})

test('provenance requires a valid capture timestamp', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        provenance: {
          ...baseObservation.provenance,
          capturedAt: 'not-a-timestamp',
        },
      }),
    /valid capturedAt/,
  )
})

test('offer original price stays integer cents', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        offer: {
          label: 'Bonus',
          mechanics: null,
          offerPriceCents: 99,
          originalPriceCents: 1.29,
          validFrom: null,
          validTo: null,
        },
      }),
    /Original price/,
  )
})

test('runtime gate rejects unsupported supermarket and source kind values', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        supermarket: 'jumbo',
      }),
    /unknown supermarket/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        provenance: {
          ...baseObservation.provenance,
          kind: 'search',
        },
      }),
    /unknown source kind/,
  )
})

test('runtime gate rejects non-EUR currency and unknown availability', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        currency: 'USD',
      }),
    /currency must be EUR/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        availability: 'in-stock',
      }),
    /unknown availability state/,
  )
})

test('pack contract rejects malformed amount, unit and raw text', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        pack: {
          ...baseObservation.pack,
          amount: 0,
        },
      }),
    /positive finite number/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        pack: {
          ...baseObservation.pack,
          unit: 'oz',
        },
      }),
    /supported unit/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        pack: {
          ...baseObservation.pack,
          rawText: '   ',
        },
      }),
    /non-empty string/,
  )
})

test('offer contract validates identity, mechanics and validity window', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        offer: {
          label: '',
          mechanics: null,
          offerPriceCents: 99,
          originalPriceCents: 129,
          validFrom: null,
          validTo: null,
        },
      }),
    /Offer label/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        offer: {
          label: 'Bonus',
          mechanics: '   ',
          offerPriceCents: 99,
          originalPriceCents: 129,
          validFrom: null,
          validTo: null,
        },
      }),
    /Offer mechanics/,
  )

  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        offer: {
          label: 'Bonus',
          mechanics: '25% korting',
          offerPriceCents: 99,
          originalPriceCents: 129,
          validFrom: '2026-10-10',
          validTo: '2026-10-04',
        },
      }),
    /cannot end before it starts/,
  )
})

test('source product id must be null or a non-empty string', () => {
  assert.throws(
    () =>
      validateRawProductObservation({
        ...baseObservation,
        sourceProductId: '',
      }),
    /sourceProductId/,
  )
})
