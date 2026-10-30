import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent, offline contract for the merged P1 canonical catalog.
// Do not activate collection, promote a price, or modify adapter/product files.
const reviewed = () => loadReviewedRepositoryFixtures()
const only = (batch, key) => structuredClone(batch.results.find(result => result.key === key))

test('all six reviewed capture kinds retain distinct retailer/provenance and a private-only publication boundary', async () => {
  const batch = await reviewed()
  const before = structuredClone(batch)
  const report = buildUniversalRetailerCatalog(batch)
  assert.deepEqual(batch, before, 'normalization cannot mutate evidence')
  assert.equal(report.sourceCount, 6)
  assert.equal(report.productCount, new Set(report.products.map(p => p.canonicalKey)).size)
  assert.equal(report.captureCount, report.products.reduce((n, p) => n + p.captures.length, 0))
  assert.equal(report.conflictCount, report.products.filter(p => p.consistency === 'review-required').length)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.status, 'private-review-only')
  const seen = new Set()
  for (const product of report.products) {
    assert.equal(product.canonicalKey, product.retailerId + ':' + product.retailerProductId)
    assert.ok(['plus', 'dekamarkt'].includes(product.retailerId))
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.selectedSnapshotSha256, null)
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    for (const capture of product.captures) {
      seen.add(product.retailerId + ':' + capture.sourceKind)
      assert.match(capture.snapshotSha256, /^[a-f0-9]{64}$/)
      assert.match(capture.sourceUrl, /^https:\/\/www\.(?:plus|dekamarkt)\.nl\//)
      assert.ok(Number.isSafeInteger(capture.currentPriceCents) || capture.currentPriceCents === null)
      assert.ok(['available', 'unavailable', 'unknown'].includes(capture.availability))
    }
  }
  assert.deepEqual([...seen].sort(), [
    'dekamarkt:catalog', 'dekamarkt:offers', 'dekamarkt:product',
    'plus:catalog', 'plus:offers', 'plus:product',
  ])
})

test('identical duplicated captures are idempotent, never price votes or additional products', async () => {
  const batch = await reviewed()
  const source = only(batch, 'plus:product')
  const report = buildUniversalRetailerCatalog({
    summary: { mode: 'reviewed-offline-only' },
    results: [source, structuredClone(source)],
  })
  assert.equal(report.sourceCount, 2)
  assert.equal(report.productCount, source.observations.length)
  assert.equal(report.captureCount, source.observations.length)
  assert.equal(report.conflictCount, 0)
  assert.ok(report.products.every(p => p.captures.length === 1 && p.publishable === false))
})

test('same product across product and catalog captures preserves both sources but cannot publish a chosen price', async () => {
  const batch = await reviewed()
  const product = only(batch, 'plus:product')
  const catalog = structuredClone(product)
  catalog.key = 'plus:catalog'
  // Synthetic second capture: a product URL cannot masquerade as a catalog
  // source. Retain the same product facts on the reviewed catalog route.
  catalog.observations.forEach(o => {
    o.provenance.kind = 'catalog'
    o.provenance.url = 'https://www.plus.nl/producten'
  })
  const report = buildUniversalRetailerCatalog({
    summary: { mode: 'reviewed-offline-only' },
    results: [product, catalog],
  })
  assert.equal(report.productCount, product.observations.length)
  assert.equal(report.captureCount, product.observations.length * 2)
  for (const p of report.products) {
    assert.deepEqual(p.captures.map(x => x.sourceKind).sort(), ['catalog', 'product'])
    assert.equal(p.consistency, 'consistent')
    assert.equal(p.currentTrustedPriceCents, null)
    assert.equal(p.publishable, false)
  }
})

test('changing only stock status across same-retailer captures is a review conflict, not an implicit available item', async () => {
  const batch = await reviewed()
  const earlier = only(batch, 'dekamarkt:product')
  const later = structuredClone(earlier)
  for (const o of later.observations) {
    o.availability = o.availability === 'unavailable' ? 'available' : 'unavailable'
    o.provenance.sha256 = 'e'.repeat(64)
    o.provenance.capturedAt = '2026-10-15T10:00:00Z'
  }
  const report = buildUniversalRetailerCatalog({
    summary: { mode: 'reviewed-offline-only' },
    results: [earlier, later],
  })
  assert.equal(report.captureCount, earlier.observations.length * 2)
  assert.equal(report.conflictCount, earlier.observations.length)
  assert.ok(report.products.every(p =>
    p.consistency === 'review-required' &&
    p.currentTrustedPriceCents === null &&
    p.publishable === false
  ))
})
