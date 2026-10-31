import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadReviewedRepositoryFixtures,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildUniversalRetailerCatalog,
} from '../scripts/retailer-universal-catalog.mjs'

test('unifies both supermarket capture families with stable retailer scoped IDs and source evidence', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.equal(catalog.schemaVersion, 1)
  assert.equal(catalog.model, 'universal-retailer-product-captures')
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.sourceCount, 6)
  assert.ok(catalog.productCount > 0)
  assert.ok(catalog.productCount <= catalog.captureCount)
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.deepEqual(catalog.products.map(product => product.canonicalKey),
    [...catalog.products.map(product => product.canonicalKey)].sort())
  for (const product of catalog.products) {
    assert.equal(product.canonicalKey,
      product.retailerId + ':' + product.retailerProductId)
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.selectedSnapshotSha256, null)
    assert.ok(product.captures.length > 0)
    assert.ok(['consistent', 'review-required'].includes(product.consistency))
    for (const capture of product.captures) {
      assert.match(capture.snapshotSha256, /^[a-f0-9]{64}$/)
      assert.ok(['product', 'catalog', 'offers'].includes(capture.sourceKind))
      assert.equal(capture.currency, 'EUR')
      // A reviewed source can identify a product without a payable pack price.
      assert.ok(capture.currentPriceCents === null ||
        Number.isSafeInteger(capture.currentPriceCents))
    }
  }
  const second = buildUniversalRetailerCatalog(batch)
  assert.deepEqual(catalog, second)
})

test('never fuzzy-merges identical names or source IDs from different supermarkets', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const plus = batch.results.find(r => r.key === 'plus:product')
  const deka = batch.results.find(r => r.key === 'dekamarkt:product')
  assert.ok(plus && deka)
  const adjusted = structuredClone(batch)
  const plusResult = adjusted.results.find(r => r.key === 'plus:product')
  const dekaResult = adjusted.results.find(r => r.key === 'dekamarkt:product')
  dekaResult.observations[0].sourceProductId = plusResult.observations[0].sourceProductId
  dekaResult.observations[0].name = plusResult.observations[0].name
  const catalog = buildUniversalRetailerCatalog(adjusted)
  assert.ok(catalog.products.some(x => x.canonicalKey === 'plus:' + plusResult.observations[0].sourceProductId))
  assert.ok(catalog.products.some(x => x.canonicalKey === 'dekamarkt:' + plusResult.observations[0].sourceProductId))
})

test('same retailer product with unequal captured price does not silently pick cheaper value', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const one = structuredClone(batch.results.find(r => r.key === 'plus:product'))
  const two = structuredClone(one)
  two.observations[0].currentPriceCents += 77
  two.observations[0].provenance.sha256 = 'b'.repeat(64)
  two.observations[0].provenance.capturedAt = '2026-10-14T11:00:00Z'
  const catalog = buildUniversalRetailerCatalog({
    summary: { mode: 'reviewed-offline-only' },
    results: [one, two],
  })
  const milk = catalog.products.find(p => p.retailerProductId === one.observations[0].sourceProductId)
  assert.equal(milk.captures.length, 2)
  assert.equal(milk.consistency, 'review-required')
  assert.equal(milk.currentTrustedPriceCents, null)
  assert.equal(milk.publishable, false)
})

test('rejects unsupported, corrupted or incomplete batch inputs without building a pretend catalog', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  assert.throws(() => buildUniversalRetailerCatalog({}), /Only bounded/)
  const incomplete = structuredClone(batch)
  incomplete.results[0].accepted = false
  assert.throws(() => buildUniversalRetailerCatalog(incomplete), /incomplete or untrusted/)
  const forged = structuredClone(batch)
  forged.results[0].observations[0].currentPriceCents = 1.99
  assert.throws(() => buildUniversalRetailerCatalog(forged), /integer cent/)
  const wrongKind = structuredClone(batch)
  wrongKind.results[0].key = 'dekamarkt:product'
  assert.throws(() => buildUniversalRetailerCatalog(wrongKind), /adapter/)
  const unsafeId = structuredClone(batch)
  unsafeId.results[0].observations[0].sourceProductId = '../bad'
  assert.throws(() => buildUniversalRetailerCatalog(unsafeId), /Unsafe\/missing/)
})
