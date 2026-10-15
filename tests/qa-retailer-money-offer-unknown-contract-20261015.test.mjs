import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independently assert monetary uncertainty at the cross-retailer adapter
// boundary: none of these offline synthetic examples is a verified saving.
async function product() {
  const batch = await loadReviewedRepositoryFixtures()
  return structuredClone(batch.results.find(r => r.key === 'plus:product'))
}
const combine = (...results) => buildUniversalRetailerCatalog({
  summary: { mode: 'reviewed-offline-only' }, results,
})
function newCapture(source) {
  const altered = structuredClone(source)
  for (const obs of altered.observations) {
    obs.provenance.sha256 = 'a'.repeat(64)
    obs.provenance.capturedAt = '2026-10-15T12:00:00.000Z'
  }
  return altered
}

test('a newly unknown item price never becomes zero/free or a published current price', async () => {
  const original = await product()
  const unknown = newCapture(original)
  unknown.observations[0].currentPriceCents = null
  unknown.observations[0].availability = 'unknown'
  const report = combine(original, unknown)
  const id = original.observations[0].sourceProductId
  const item = report.products.find(p => p.retailerProductId === id)
  assert.equal(item.consistency, 'review-required')
  assert.equal(item.captures.length, 2)
  assert.ok(item.captures.some(c => c.currentPriceCents === null))
  assert.ok(item.captures.some(c => c.currentPriceCents === original.observations[0].currentPriceCents))
  assert.equal(item.currentTrustedPriceCents, null)
  assert.equal(item.publishable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('equal product price with unequal offer validity must not silently select a promotion', async () => {
  const first = await product()
  first.observations[0].offer = {
    label: 'Fictional multibuy', mechanics: 'two for one',
    offerPriceCents: 100, originalPriceCents: 200,
    validFrom: '2026-10-01T00:00:00.000Z',
    validTo: '2026-10-08T00:00:00.000Z',
  }
  const second = newCapture(first)
  second.observations[0].offer.validTo = '2026-10-09T00:00:00.000Z'
  const item = combine(first, second).products[0]
  assert.equal(item.captures.length, 2)
  assert.equal(item.consistency, 'review-required')
  assert.equal(item.currentTrustedPriceCents, null)
  assert.equal(item.publishable, false)
  assert.equal(item.captures[0].offer.label, 'Fictional multibuy')
})

test('same snapshot hash with contradictory price facts is not de-duplicated away', async () => {
  const first = await product()
  const contradictory = structuredClone(first)
  contradictory.observations[0].currentPriceCents =
    first.observations[0].currentPriceCents === null ? 100 : first.observations[0].currentPriceCents + 1
  const item = combine(first, contradictory).products[0]
  assert.equal(item.captures.length, 2)
  assert.equal(item.consistency, 'review-required')
  assert.equal(item.currentTrustedPriceCents, null)
  assert.equal(item.selectedSnapshotSha256, null)
  assert.equal(item.publishable, false)
})

test('same price but different package amount is a full-basket comparison conflict', async () => {
  const first = await product()
  const second = newCapture(first)
  second.observations[0].pack = { rawText: '500 ml', amount: 500, unit: 'ml' }
  const item = combine(first, second).products[0]
  assert.equal(item.captures.length, 2)
  assert.equal(item.consistency, 'review-required')
  assert.equal(item.currentTrustedPriceCents, null)
  assert.equal(item.sourceRightsVerified, false)
  assert.equal(item.publishable, false)
})
