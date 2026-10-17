import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from '../src/domain/reviewedCatalogPlannerQueue.ts'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Everything is private offline M1 evidence or explicitly fictional integers.
// Unreviewed historical money can never become today's retailer price, an
// authorized publication, or a verified savings effect through this queue.
const needs = buildObservationSheet().requirements
const privateFields = /sourceUrl|snapshotSha256|currentPriceCents|offerPriceCents|sourceRightsVerified|selectedSnapshotSha256|personalCanary|savingsCents|participant/i
const marker = 'FICTIONAL_PRIVATE_REVIEW_TOKEN_20261017'

function assertPriceFree(queue, label) {
  assert.equal(queue.mode, 'historical-catalog-human-review-only', label)
  assert.equal(queue.sourceStatus, 'private-review-only', label)
  assert.equal(queue.productionEnabled, false, label)
  assert.equal(queue.publicSavingsClaimEligible, false, label)
  assert.equal(queue.completeFieldEvidence, false, label)
  assert.equal(queue.needsHumanSourceReview, true, label)
  assert.equal(queue.rows.length, needs.length * 2, label)
  assert.deepEqual(queue.rows.map(row => row.retailerId),
    [...Array(needs.length).fill('plus'), ...Array(needs.length).fill('dekamarkt')], label)
  for (const row of queue.rows) {
    assert.ok(row.reasons.length > 0, label)
    assert.equal('priceCents' in row, false, label)
    assert.equal('totalCents' in row, false, label)
    assert.equal('evidence' in row, false, label)
    assert.equal('availability' in row, false, label)
    if (row.candidate) {
      assert.equal(row.status, 'suggested-for-manual-review', label)
      assert.equal('priceCents' in row.candidate, false, label)
      assert.equal('sourceUrl' in row.candidate, false, label)
      assert.equal('capturedAt' in row.candidate, false, label)
    } else assert.equal(row.status, 'unresolved', label)
  }
  assert.doesNotMatch(JSON.stringify(queue), privateFields, label)
  assert.doesNotMatch(JSON.stringify(queue), /FICTIONAL_PRIVATE_REVIEW_TOKEN_20261017/, label)
}

function syntheticCatalog() {
  const product = retailerId => ({
    canonicalKey: retailerId + ':synthetic-chicken',
    retailerId,
    retailerProductId: 'synthetic-chicken',
    consistency: 'consistent',
    currentTrustedPriceCents: null,
    selectedSnapshotSha256: null,
    sourceRightsVerified: false,
    publishable: false,
    captures: [{
      name: 'Kippendij', currency: 'EUR',
      capturedAt: '2026-09-15T12:00:00Z',
      snapshotSha256: 'a'.repeat(64),
      availability: 'available',
      currentPriceCents: 12345,
      offerPriceCents: 54321,
      sourceUrl: 'https://www.plus.nl/historical-fixture',
      pack: { amount: 600, unit: 'g', rawText: '600 g' },
    }],
  })
  return {
    schemaVersion: 1,
    model: 'universal-retailer-product-captures',
    status: 'private-review-only',
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    productCount: 2,
    products: [product('plus'), product('dekamarkt')],
  }
}

function taintUnpublishableCapture(capture, index) {
  capture.currentPriceCents = index % 2 ? 1 + index : 9_000_000 - index
  capture.offerPriceCents = index % 3 ? 3_333_333 : 0
  capture.sourceUrl = `https://example.invalid/${marker}/${index}`
  capture.personalCanary = `${marker}:private-person:${index}`
  capture.provenanceNote = `${marker}:private-provenance:${index}`
  capture.capturedAt = index % 2
    ? '2025-03-01T06:15:30Z' : '2026-10-04T18:10:00Z'
  capture.snapshotSha256 = (index % 2 ? 'a' : 'b').repeat(64)
}

test('M3 actual six historical source kinds preserve exactly 22 private-only rows without a single published price', async () => {
  const reviewed = await loadReviewedRepositoryFixtures()
  const original = structuredClone(reviewed)
  const catalog = buildUniversalRetailerCatalog(reviewed)
  const sourceBefore = structuredClone(catalog)
  const queue = buildReviewedCatalogPlannerQueue(catalog, needs)
  assertPriceFree(queue, 'actual six reviewed snapshots')
  assert.equal(reviewed.summary.sources, 6)
  assert.ok(catalog.productCount > 0, 'real offline fixture catalog must not be empty')
  assert.equal(queue.rows.filter(row => row.candidate).length +
    queue.rows.filter(row => row.candidate === null).length, 22,
    'catalog growth may legitimately add new suggestions without reducing human review coverage')
  assert.deepEqual(reviewed, original)
  assert.deepEqual(catalog, sourceBefore)
})

test('M3 synthetic PLUS/Deka matched candidates remain strictly price-blind under 180 capture mutations', () => {
  const source = syntheticCatalog()
  const original = structuredClone(source)
  const baseline = buildReviewedCatalogPlannerQueue(source, needs)
  assertPriceFree(baseline, 'canonical synthetic source')
  assert.equal(baseline.rows.filter(row => row.candidate).length, 2)
  for (let i = 0; i < 180; i++) {
    const changed = structuredClone(source)
    const target = changed.products[i % changed.products.length].captures[0]
    taintUnpublishableCapture(target, i)
    const frozenInput = structuredClone(changed)
    const actual = buildReviewedCatalogPlannerQueue(changed, needs)
    assert.deepEqual(actual, baseline, `changing private metadata/prices cannot affect public-facing proposal at variation ${i}`)
    assertPriceFree(actual, `variation ${i}`)
    assert.deepEqual(changed, frozenInput, `variant ${i} mutated its source`)
  }
  assert.deepEqual(source, original, 'reference source must never be mutated')
})

test('M3 each six-source SKU remains insensitive to 8 varied historical price/provenance metadata edits', async () => {
  const reviewed = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(reviewed)
  const baseline = buildReviewedCatalogPlannerQueue(catalog, needs)
  assert.ok(catalog.products.length > 0, 'reviewed fixture catalog must not be empty')
  let cases = 0
  for (let productIndex = 0; productIndex < catalog.products.length; productIndex++) {
    for (let mutation = 0; mutation < 8; mutation++) {
      const copy = structuredClone(catalog)
      copy.products[productIndex].captures.forEach((capture, captureIndex) =>
        taintUnpublishableCapture(capture, (productIndex * 8 + mutation) * 3 + captureIndex))
      const before = structuredClone(copy)
      const queue = buildReviewedCatalogPlannerQueue(copy, needs)
      assertPriceFree(queue, `product=${productIndex},mutation=${mutation}`)
      assert.deepEqual(queue, baseline)
      assert.deepEqual(copy, before, 'historical evidence must not be mutated')
      cases++
    }
  }
  assert.equal(cases, catalog.products.length * 8)
})
