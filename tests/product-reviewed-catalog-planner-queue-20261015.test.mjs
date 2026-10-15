import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from '../src/domain/reviewedCatalogPlannerQueue.ts'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewedPlannerQueueSummary } from '../scripts/retailer-reviewed-planner-queue.mjs'

const sha = 'a'.repeat(64)
function product(retailerId, productId, overrides = {}) {
  return {
    canonicalKey: retailerId + ':' + productId,
    retailerId, retailerProductId: productId,
    captures: [{
      name: 'Kippendij', currency: 'EUR',
      capturedAt: '2026-09-15T12:00:00Z', snapshotSha256: sha,
      availability: 'available',
      currentPriceCents: 999999,
      sourceUrl: 'https://www.' + (retailerId === 'plus' ? 'plus.nl' : 'dekamarkt.nl') + '/historical',
      pack: { amount: 600, unit: 'g', rawText: '600 g' },
    }],
    consistency: 'consistent',
    currentTrustedPriceCents: null, selectedSnapshotSha256: null,
    sourceRightsVerified: false, publishable: false,
    ...overrides,
  }
}
function catalog(...products) {
  return {
    schemaVersion: 1, model: 'universal-retailer-product-captures',
    status: 'private-review-only',
    productionEnabled: false, publicSavingsClaimEligible: false,
    productCount: products.length, products,
  }
}
function requirements() { return buildObservationSheet().requirements }

test('11x2 canonical planner requirements get review suggestions only, never retailer prices or savings', () => {
  const demand = requirements()
  const source = catalog(product('plus', 'source-chicken'), product('dekamarkt', 'source-chicken'))
  const before = structuredClone(source)
  const queue = buildReviewedCatalogPlannerQueue(source, demand)
  assert.equal(queue.mode, 'historical-catalog-human-review-only')
  assert.equal(queue.completeFieldEvidence, false)
  assert.equal(queue.publicSavingsClaimEligible, false)
  assert.equal(queue.productionEnabled, false)
  assert.equal(queue.rows.length, 22)
  assert.deepEqual(queue.rows.map(r => r.retailerId).filter((v, i) => i === 0 || v !== queue.rows[i - 1].retailerId), ['plus','dekamarkt'])
  const matches = queue.rows.filter(row => row.status === 'suggested-for-manual-review')
  assert.equal(matches.length, 2)
  assert.ok(matches.every(r => r.ingredientId === 'chicken-thigh' && r.candidate.productName === 'Kippendij'))
  assert.ok(queue.rows.filter(r => r.candidate === null).length === 20)
  assert.doesNotMatch(JSON.stringify(queue.rows), /999999|\/historical|sourceUrl|priceCents|savingsCents/i)
  assert.deepEqual(source, before, 'never mutate original private capture data')
  assert.deepEqual(buildObservationSheet().requirements, demand)
})

test('historical conflicts, incomplete availability and unverified multipacks remain unresolved', () => {
  const broken = catalog(
    product('plus', 'review-conflict', { consistency: 'review-required' }),
    product('plus', 'outofstock', { captures: [{ ...product('plus','outofstock').captures[0], availability: 'unknown' }] }),
    product('dekamarkt', 'multipack', { captures: [{
      ...product('dekamarkt','multipack').captures[0],
      pack: { amount: 200, unit: 'ml', rawText: '6 x 200 ml' },
    }] }),
  )
  const result = buildReviewedCatalogPlannerQueue(broken, requirements())
  assert.equal(result.rows.filter(x => x.status === 'suggested-for-manual-review').length, 0)
  assert.equal(result.rows.length, 22)
  assert.equal(result.rows.every(x => x.candidate === null), true)
})

test('duplicate retailer product identities and forged rights/publication flags refuse the entire review', () => {
  const good = product('plus','p1')
  const r = requirements()
  for (const bad of [
    catalog(good, structuredClone(good)),
    catalog(product('plus','p1',{sourceRightsVerified:true})),
    catalog(product('plus','p1',{publishable:true})),
    catalog(product('plus','p1',{currentTrustedPriceCents:1})),
    catalog(product('plus','p1',{selectedSnapshotSha256:sha})),
    { ...catalog(good), productionEnabled:true },
    { ...catalog(good), publicSavingsClaimEligible:true },
    { ...catalog(good), status:'public-live' },
    { ...catalog(good), productCount:999 },
  ]) {
    assert.throws(() => buildReviewedCatalogPlannerQueue(bad,r), /unsupported|refused/)
  }
})

test('invalid planner identities, unknown units and sparse demand refuse the review', () => {
  const valid = requirements()
  const source = catalog(product('plus','p1'))
  for (const bad of [
    [], [{ ...valid[0], id:'../../../secret' }],
    [{ ...valid[0], unit:'pack' }],
    [{ ...valid[0], amount:0 }],
    [valid[0], valid[0]],
  ]) assert.throws(() => buildReviewedCatalogPlannerQueue(source,bad), /refused/)
  const sparse = [valid[0], valid[1]]
  delete sparse[0]
  assert.throws(() => buildReviewedCatalogPlannerQueue(source,sparse), /refused/)
})

test('real six historical offline adapters feed the exact M3 review queue without current-price publication', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.summary.sources, 6)
  const normalized = buildUniversalRetailerCatalog(batch)
  assert.equal(normalized.productionEnabled, false)
  const queue = buildReviewedCatalogPlannerQueue(normalized, requirements())
  const summary = reviewedPlannerQueueSummary(queue)
  assert.deepEqual(summary, {
    mode:'historical-catalog-human-review-only',
    planningNeeds:11,
    retailerRows:22,
    suggestedForManualReview:queue.rows.filter(r=>r.candidate!==null).length,
    unresolved:queue.rows.filter(r=>r.candidate===null).length,
    sources:2,
    livePricesAvailable:false,
    externalRequests:0,
    publicSavingsClaimEligible:false,
  })
  assert.doesNotMatch(JSON.stringify(summary), /www\.|sourceUrl|productName|currentPriceCents|participantKey/i)
  assert.ok(queue.rows.every(row => row.reasons.length && !('priceCents' in row)))
})
