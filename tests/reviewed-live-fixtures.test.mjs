import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ahReviewedFixtureAdapter,
  plusReviewedFixtureAdapter,
  validateReviewedLiveProductFixture,
} from '../src/data/reviewedLiveFixtures.ts'

function fixture(supermarket = 'ah') {
  const isAh = supermarket === 'ah'
  const source = {
    id: isAh ? 'ah-product-halfvolle-melk' : 'plus-product-halfvolle-melk',
    supermarket,
    kind: 'product',
    url: isAh
      ? 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk'
      : 'https://www.plus.nl/product/zuivelmeester-halfvolle-melk-pak-1000-ml-579010',
    capturedAt: '2026-10-04T02:00:00.000Z',
    sha256: isAh ? 'a'.repeat(64) : 'b'.repeat(64),
  }

  return {
    version: 1,
    fixtureType: 'reviewed-live-product-observation',
    source,
    observation: {
      supermarket,
      sourceProductId: isAh ? 'wi1525' : '579010',
      name: 'Halfvolle melk',
      currentPriceCents: 129,
      currency: 'EUR',
      pack: {
        rawText: null,
        amount: null,
        unit: 'unknown',
      },
      offer: null,
      availability: 'available',
      provenance: {
        supermarket,
        kind: source.kind,
        url: source.url,
        capturedAt: source.capturedAt,
        sha256: source.sha256,
      },
    },
    review: {
      reviewer: 'm1-review',
      reviewedAt: '2026-10-04T02:05:00.000Z',
      notes: 'Reviewed against bounded live capture.',
    },
  }
}

test('AH reviewed-fixture adapter accepts an exactly bound AH product fixture', () => {
  const reviewed = fixture('ah')
  const observation = ahReviewedFixtureAdapter.fromReviewedFixture(reviewed)

  assert.equal(observation.supermarket, 'ah')
  assert.equal(observation.sourceProductId, 'wi1525')
  assert.equal(observation.provenance.sha256, reviewed.source.sha256)
})

test('PLUS reviewed-fixture adapter accepts an exactly bound PLUS product fixture', () => {
  const reviewed = fixture('plus')
  const observation = plusReviewedFixtureAdapter.fromReviewedFixture(reviewed)

  assert.equal(observation.supermarket, 'plus')
  assert.equal(observation.sourceProductId, '579010')
})

test('source adapters reject cross-supermarket fixtures', () => {
  assert.throws(
    () => plusReviewedFixtureAdapter.fromReviewedFixture(fixture('ah')),
    /supermarket mismatch/,
  )
})

test('reviewed fixtures reject source-to-observation provenance drift', () => {
  const reviewed = fixture('ah')
  reviewed.source.sha256 = 'c'.repeat(64)

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /provenance does not exactly match/,
  )
})

test('reviewed fixtures reject non-product source evidence', () => {
  const reviewed = fixture('ah')
  reviewed.source.kind = 'catalog'
  reviewed.observation.provenance.kind = 'catalog'

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /must come from a product source/,
  )
})

test('reviewed fixtures require explicit review identity and timestamp', () => {
  const reviewed = fixture('ah')
  reviewed.review.reviewer = ''

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /identify a reviewer/,
  )

  reviewed.review.reviewer = 'm1-review'
  reviewed.review.reviewedAt = 'not-a-date'

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /valid reviewedAt/,
  )
})

test('reviewed fixtures reject reviews that predate the captured evidence', () => {
  const reviewed = fixture('ah')
  reviewed.review.reviewedAt = '2026-10-04T01:59:59.999Z'

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /cannot predate its capture/,
  )
})

test('reviewed fixtures reject implausibly future-dated review evidence', () => {
  const reviewed = fixture('ah')
  reviewed.review.reviewedAt = '2999-01-01T00:00:00.000Z'

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /implausibly in the future/,
  )
})

test('reviewed fixtures reject unsafe or path-like source ids', () => {
  const reviewed = fixture('ah')
  reviewed.source.id = '../ah-product'

  assert.throws(
    () => validateReviewedLiveProductFixture(reviewed, 'ah'),
    /path-safe source id/,
  )
})
