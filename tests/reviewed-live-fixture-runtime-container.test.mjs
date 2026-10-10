import assert from 'node:assert/strict'
import test from 'node:test'

import { validateReviewedLiveProductFixture } from '../src/data/reviewedLiveFixtures.ts'

const malformedFixtures = [
  null,
  undefined,
  true,
  42,
  'fixture',
  [],
]

for (const value of malformedFixtures) {
  test(`reviewed live fixture rejects top-level runtime container ${String(value)}`, () => {
    assert.throws(
      () => validateReviewedLiveProductFixture(value, 'ah'),
      /Reviewed live fixture must be an object/,
    )
  })
}

test('reviewed live fixture requires a source object before source field access', () => {
  for (const source of [null, undefined, 'source', [], 42]) {
    assert.throws(
      () =>
        validateReviewedLiveProductFixture(
          {
            version: 1,
            fixtureType: 'reviewed-live-product-observation',
            source,
            observation: {},
            review: {},
          },
          'ah',
        ),
      /must include a source object/,
    )
  }
})

test('reviewed live fixture requires a review object before review field access', () => {
  for (const review of [null, undefined, 'review', [], 42]) {
    assert.throws(
      () =>
        validateReviewedLiveProductFixture(
          {
            version: 1,
            fixtureType: 'reviewed-live-product-observation',
            source: {},
            observation: {},
            review,
          },
          'ah',
        ),
      /must include a review object/,
    )
  }
})

test('reviewed live fixture rejects malformed review notes metadata', () => {
  assert.throws(
    () =>
      validateReviewedLiveProductFixture(
        {
          version: 1,
          fixtureType: 'reviewed-live-product-observation',
          source: {
            id: 'ah-product-halfvolle-melk',
            supermarket: 'ah',
            kind: 'product',
            url: 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk',
            capturedAt: '2026-10-04T02:00:00.000Z',
            sha256: 'a'.repeat(64),
          },
          observation: {
            supermarket: 'ah',
            sourceProductId: 'wi1525',
            name: 'Halfvolle melk',
            currentPriceCents: 129,
            currency: 'EUR',
            pack: { rawText: null, amount: null, unit: 'unknown' },
            offer: null,
            availability: 'available',
            provenance: {
              supermarket: 'ah',
              kind: 'product',
              url: 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk',
              capturedAt: '2026-10-04T02:00:00.000Z',
              sha256: 'a'.repeat(64),
            },
          },
          review: {
            reviewer: 'm1-review',
            reviewedAt: '2026-10-04T02:05:00.000Z',
            notes: { unexpected: true },
          },
        },
        'ah',
      ),
    /review notes must be null or a string/,
  )
})
