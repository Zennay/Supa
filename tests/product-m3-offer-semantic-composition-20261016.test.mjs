import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Combined source product-owner acceptance on a real archived six-source
// PLUS adapter. All additional offer cents are fictional, historical,
// never publishable and there is no network activity.
async function sourcePair() {
  const archived = await loadReviewedRepositoryFixtures()
  const result = structuredClone(archived.results.find(x => x.key === 'plus:product'))
  assert.ok(result?.accepted && result.observations.length > 0)
  result.observations = [structuredClone(result.observations[0])]
  result.observations[0].offer = {
    label: 'Synthetic review-only interval',
    mechanics: null,
    offerPriceCents: 125,
    originalPriceCents: 150,
    validFrom: '2026-10-14T12:00:00.000000001+02:00',
    validTo: '2026-10-14T10:00:00.000000002Z',
  }
  const second = structuredClone(result)
  second.observations[0].pack = Object.fromEntries(
    Object.entries(second.observations[0].pack).reverse(),
  )
  second.observations[0].offer = Object.fromEntries(
    Object.entries(second.observations[0].offer).reverse(),
  )
  return [result, second]
}
const catalogOf = (a, b) => buildUniversalRetailerCatalog({
  summary: { mode: 'reviewed-offline-only' },
  results: [a, b],
})
const assertNotPublishable = catalog => {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  for (const product of catalog.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
  }
}

test('one true 1ns-reviewed private offer and reordered JSON keys form one historical event', async () => {
  const [first, second] = await sourcePair()
  const before = structuredClone([first, second])
  const catalog = catalogOf(first, second)
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.captureCount, 1)
  assert.equal(catalog.conflictCount, 0)
  assert.equal(catalog.products[0].consistency, 'consistent')
  assert.deepEqual([first, second], before)
  assertNotPublishable(catalog)
})

test('same SHA/event with impossible one-nanosecond reversed offer is refused rather than counted', async () => {
  const [first, second] = await sourcePair()
  second.observations[0].offer.validFrom = '2026-10-14T10:00:00.000000002Z'
  second.observations[0].offer.validTo = '2026-10-14T10:00:00.000000001Z'
  assert.throws(() => catalogOf(first, second), /Offer validity window cannot end before it starts/)
})

test('valid same instant with different offer cents still requires review and cannot claim savings', async () => {
  const [first, second] = await sourcePair()
  second.observations[0].offer.offerPriceCents = 124
  const catalog = catalogOf(first, second)
  assert.equal(catalog.captureCount, 2)
  assert.equal(catalog.conflictCount, 1)
  assert.equal(catalog.products[0].consistency, 'review-required')
  assertNotPublishable(catalog)
})
