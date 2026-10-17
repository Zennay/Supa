import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from '../src/domain/reviewedCatalogPlannerQueue.ts'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent M3 review: reversing the ORDER in which the exact same
// privately reviewed facts reach Supa must not silently promote a new price,
// swap retailer identity or lose an ingredient from the 11 x 2 field plan.
const needs = buildObservationSheet().requirements

function normalize(queue) {
  assert.equal(queue.rows.length, 22)
  assert.equal(queue.productionEnabled, false)
  assert.equal(queue.publicSavingsClaimEligible, false)
  assert.equal(queue.completeFieldEvidence, false)
  assert.equal(queue.sourceStatus, 'private-review-only')
  assert.ok(queue.rows.every(row =>
    row.status === (row.candidate ? 'suggested-for-manual-review' : 'unresolved') &&
    row.reasons.length > 0 && !('priceCents' in row) && !('savingsCents' in row)))
  return queue.rows.map(row => ({
    retailerId: row.retailerId,
    ingredientId: row.ingredientId,
    ingredientLabel: row.ingredientLabel,
    required: row.required,
    status: row.status,
    candidate: row.candidate,
    reasons: row.reasons,
  })).sort((left, right) =>
    left.retailerId.localeCompare(right.retailerId) ||
    left.ingredientId.localeCompare(right.ingredientId))
}

function reorder(array, rotation, reversed) {
  const head = rotation % array.length
  const shifted = [...array.slice(head), ...array.slice(0, head)]
  return reversed ? shifted.reverse() : shifted
}

function syntheticCatalog() {
  const products = ['plus', 'dekamarkt'].map(retailerId => ({
    canonicalKey: retailerId + ':synthetic-chicken',
    retailerId, retailerProductId: 'synthetic-chicken',
    consistency: 'consistent',
    currentTrustedPriceCents: null, selectedSnapshotSha256: null,
    sourceRightsVerified: false, publishable: false,
    captures: [{
      name: 'Kippendij', currency: 'EUR',
      capturedAt: '2026-09-15T12:00:00Z',
      snapshotSha256: 'c'.repeat(64),
      availability: 'available',
      currentPriceCents: 999999,
      sourceUrl: 'https://example.invalid/fictional-original',
      pack: { amount: 600, unit: 'g', rawText: '600 g' },
    }],
  }))
  return {
    schemaVersion: 1, model: 'universal-retailer-product-captures',
    status: 'private-review-only',
    productionEnabled: false, publicSavingsClaimEligible: false,
    productCount: products.length, products,
  }
}

test('real M1 six-source catalog: all 22 planner permutations × 13 rotations × 2 source directions preserve 22 mapped human-review rows', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  const frozen = structuredClone(catalog)
  const baseline = normalize(buildReviewedCatalogPlannerQueue(catalog, needs))
  assert.equal(catalog.products.length, 13)
  let examined = 0
  for (let demandRotation = 0; demandRotation < needs.length; demandRotation++) {
    for (const reversedDemand of [false, true]) {
      const changedNeeds = reorder(needs, demandRotation, reversedDemand)
      const needsBefore = structuredClone(changedNeeds)
      for (let catalogRotation = 0; catalogRotation < catalog.products.length; catalogRotation++) {
        for (const reversedCatalog of [false, true]) {
          const changedCatalog = {
            ...catalog,
            products: reorder(catalog.products, catalogRotation, reversedCatalog),
          }
          const actual = buildReviewedCatalogPlannerQueue(changedCatalog, changedNeeds)
          assert.deepEqual(normalize(actual), baseline,
            `demand rotation ${demandRotation}, reverse=${reversedDemand}; source rotation ${catalogRotation}, reverse=${reversedCatalog}`)
          assert.deepEqual(changedNeeds, needsBefore)
          examined++
        }
      }
    }
  }
  assert.equal(examined, 572)
  assert.deepEqual(catalog, frozen)
})

test('synthetic positive suggestions never change identity, retailer or privacy posture over 44 independent week orderings', () => {
  const catalog = syntheticCatalog()
  const original = structuredClone(catalog)
  const baseline = normalize(buildReviewedCatalogPlannerQueue(catalog, needs))
  assert.equal(baseline.filter(row => row.candidate).length, 2)
  for (let rotation = 0; rotation < needs.length; rotation++) {
    for (const reversedDemand of [false, true]) {
      for (const reversedSources of [false, true]) {
        const changedCatalog = {
          ...catalog, products: reversedSources
            ? [...catalog.products].reverse() : [...catalog.products],
        }
        const orderedNeeds = reorder(needs, rotation, reversedDemand)
        const actual = buildReviewedCatalogPlannerQueue(changedCatalog, orderedNeeds)
        assert.deepEqual(normalize(actual), baseline)
        assert.deepEqual(actual.rows.map(row => row.ingredientId),
          [...orderedNeeds.map(x => x.id), ...orderedNeeds.map(x => x.id)],
          'presentation order must follow actual private planner demand')
        assert.equal(actual.rows.filter(row => row.candidate).length, 2)
        assert.doesNotMatch(JSON.stringify(actual), /999999|example.invalid|sourceUrl|currentPriceCents|snapshotSha256/)
      }
    }
  }
  assert.deepEqual(catalog, original)
})

test('two-store review never merges equal ingredient IDs across sources into one candidate', () => {
  const catalog = syntheticCatalog()
  const queue = buildReviewedCatalogPlannerQueue(catalog, needs)
  const suggestions = queue.rows.filter(row => row.candidate)
  assert.equal(suggestions.length, 2)
  assert.deepEqual(suggestions.map(row => row.retailerId), ['plus', 'dekamarkt'])
  assert.deepEqual(suggestions.map(row => row.ingredientId), ['chicken-thigh', 'chicken-thigh'])
  assert.notEqual(suggestions[0].candidate.canonicalKey, suggestions[1].candidate.canonicalKey)
  assert.ok(suggestions.every(row => row.status === 'suggested-for-manual-review'))
  assert.equal(queue.rows.filter(row => row.status === 'unresolved').length, 20)
})
