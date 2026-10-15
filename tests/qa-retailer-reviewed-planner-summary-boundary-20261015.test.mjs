import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from '../src/domain/reviewedCatalogPlannerQueue.ts'
import { reviewedPlannerQueueSummary } from '../scripts/retailer-reviewed-planner-queue.mjs'

// Independent QA on immutable product-owner #2910 head ca68ae38.
// The positive control is the actual product API, not a manually invented
// success return. All negative cases are local-only, no retailer HTTP.
function safeQueue() {
  const requirements = buildObservationSheet().requirements
  const emptyCatalog = {
    schemaVersion: 1,
    model: 'universal-retailer-product-captures',
    status: 'private-review-only',
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    productCount: 0,
    products: [],
  }
  return buildReviewedCatalogPlannerQueue(emptyCatalog, requirements)
}

test('independent positive: authentic 11×2 unresolved planner preview stays private, count-only and nonclaimable', () => {
  const queue = safeQueue()
  const summary = reviewedPlannerQueueSummary(queue)
  assert.equal(queue.rows.length, 22)
  assert.deepEqual(queue.rows.filter(row => row.retailerId === 'plus').length, 11)
  assert.deepEqual(queue.rows.filter(row => row.retailerId === 'dekamarkt').length, 11)
  assert.deepEqual(summary, {
    mode: 'historical-catalog-human-review-only',
    planningNeeds: 11,
    retailerRows: 22,
    suggestedForManualReview: 0,
    unresolved: 22,
    sources: 2,
    livePricesAvailable: false,
    externalRequests: 0,
    publicSavingsClaimEligible: false,
  })
  assert.doesNotMatch(JSON.stringify(summary), /sku|https?:\/\/|currentPriceCents|offerPriceCents|productName|ingredientId|email/i)
})

test('private summary must refuse a one-retailer-only queue pretending to cover PLUS and DekaMarkt', () => {
  const forged = structuredClone(safeQueue())
  for (const row of forged.rows) row.retailerId = 'plus'
  assert.throws(
    () => reviewedPlannerQueueSummary(forged),
    /unsafe|refus|retailer|source|row|review/i,
    '2-store coverage must be checked, not inferred from even row count',
  )
})

test('private summary must refuse rows with duplicate demand IDs that omit a required product', () => {
  const forged = structuredClone(safeQueue())
  forged.rows[1].ingredientId = forged.rows[0].ingredientId
  assert.throws(
    () => reviewedPlannerQueueSummary(forged),
    /unsafe|refus|duplicate|require|row|review/i,
    '11 distinct canonical needs per retailer must remain intact',
  )
})

test('private summary must refuse a queue that claims human review or source privacy has been bypassed', () => {
  for (const change of [
    { sourceStatus: 'public-live' },
    { needsHumanSourceReview: false },
  ]) {
    const forged = { ...safeQueue(), ...change }
    assert.throws(
      () => reviewedPlannerQueueSummary(forged),
      /unsafe|refus|source|review/i,
      'this summary must never count an authoritative/current/approved retailer queue',
    )
  }
})

test('private summary must refuse fabricated positive candidate without a real bounded match', () => {
  const forged = structuredClone(safeQueue())
  forged.rows[0].status = 'suggested-for-manual-review'
  forged.rows[0].candidate = { madeUp: 'fictional fake match', currentPriceCents: 999999 }
  assert.throws(
    () => reviewedPlannerQueueSummary(forged),
    /unsafe|refus|candidate|row|review/i,
    'an arbitrary object cannot upgrade an unresolved need to a reviewed match',
  )
})
