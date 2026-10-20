import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Exact merged P1 catalog. Independent regression for historical SOURCE EVENT
// identity, not product identity. All inputs are immutable offline M1 fixtures.
async function source() {
  const b = await loadReviewedRepositoryFixtures()
  return structuredClone(b.results.find(r => r.key === 'plus:product'))
}
const catalog = (...results) => buildUniversalRetailerCatalog({
  summary: { mode: 'reviewed-offline-only' }, results,
})

test('control: exactly identical repeat source snapshot stays idempotent and private', async () => {
  const one = await source()
  const result = catalog(one, structuredClone(one))
  assert.equal(result.productCount, one.observations.length)
  assert.equal(result.captureCount, one.observations.length)
  assert.ok(result.products.every(p =>
    p.captures.length === 1 &&
    p.currentTrustedPriceCents === null &&
    p.publishable === false
  ))
})

test('same source bytes collected at two distinct instants must preserve BOTH capture timestamps', async () => {
  const one = await source()
  const later = structuredClone(one)
  for (const o of later.observations) {
    o.provenance.capturedAt = '2026-10-14T12:00:00.000Z'
  }
  const result = catalog(one, later)
  const target = result.products.find(p => p.retailerProductId === one.observations[0].sourceProductId)
  assert.ok(target)
  assert.equal(target.captures.length, 2,
    'unchanged SHA/content at a later capture time is new freshness evidence, not an identical event')
  assert.deepEqual(target.captures.map(c => c.capturedAt), [
    one.observations[0].provenance.capturedAt, '2026-10-14T12:00:00.000Z',
  ])
  assert.equal(target.currentTrustedPriceCents, null)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('same source bytes from two explicit retailer URLs must preserve BOTH provenance URLs', async () => {
  const one = await source()
  const alternate = structuredClone(one)
  for (const o of alternate.observations) {
    o.provenance.url = 'https://www.plus.nl/product/fictional-same-byte-alias'
  }
  const result = catalog(one, alternate)
  const target = result.products.find(p => p.retailerProductId === one.observations[0].sourceProductId)
  assert.ok(target)
  assert.equal(target.captures.length, 2,
    'distinct source URL should remain auditable even if content SHA agrees')
  assert.deepEqual(new Set(target.captures.map(c => c.sourceUrl)), new Set([
    one.observations[0].provenance.url,
    'https://www.plus.nl/product/fictional-same-byte-alias',
  ]))
  assert.equal(target.publishable, false)
  assert.equal(result.productionEnabled, false)
})
