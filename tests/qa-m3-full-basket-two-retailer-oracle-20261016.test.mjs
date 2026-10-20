/**
 * Independent M3 QA: exact canonical 11×2 rows must agree with the private
 * six-source offline preflight, independent of reviewed source enumeration.
 * Previously archived real PLUS/Deka shapes only. Tests use synthetic
 * permutations and fictional money to verify non-public status — never
 * claim present-day retailer price, permission, or observed basket savings.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { assessHistoricalM3FullBasketReadiness } from
  '../scripts/retailer-private-m3-full-basket-preflight.mjs'
import { buildBudgetedPrivateRetailerCatalog } from
  '../scripts/retailer-private-budgeted-catalog.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildReviewedCatalogPlannerQueue } from
  '../src/domain/reviewedCatalogPlannerQueue.ts'
import { reviewedPlannerQueueSummary } from
  '../scripts/retailer-reviewed-planner-queue.mjs'

const NOW = Object.freeze({ referenceTime: '2030-01-01T00:00:00Z', maxAgeHours: 720 })
const historical = async () => structuredClone(await loadReviewedRepositoryFixtures())

function assertAlwaysPrivate(report) {
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.historicalOnly, true)
  assert.equal(report.fullBasketFieldComparisonVerified, false)
  assert.equal(report.actualRetailerPriceOrStockVerified, false)
  assert.equal(report.retailerReuseRightsVerified, false)
  assert.equal(report.humanReviewRequired, true)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
  assert.ok(Object.isFrozen(report))
  assert.ok(Object.isFrozen(report.sourceKinds))
  assert.doesNotMatch(JSON.stringify(report),
    /https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|snapshotSha256|participantKey|sourceUrl/)
}

test('independent canonical demand and two-store row oracle agrees with all aggregate preflight counters', async () => {
  const batch = await historical()
  const preserved = structuredClone(batch)
  const report = assessHistoricalM3FullBasketReadiness(batch, NOW)
  const catalog = buildBudgetedPrivateRetailerCatalog(batch)
  const requirements = buildObservationSheet().requirements
  const queue = buildReviewedCatalogPlannerQueue(catalog, requirements)
  const summary = reviewedPlannerQueueSummary(queue)
  assert.equal(requirements.length, 11)
  assert.equal(queue.rows.length, 22)
  assert.equal(report.canonicalPlannerNeeds, requirements.length)
  assert.equal(report.twoStoreReviewRows, queue.rows.length)
  assert.equal(report.manualSuggestions, summary.suggestedForManualReview)
  assert.equal(report.unresolvedReviewRows, summary.unresolved)
  assert.equal(report.manualSuggestions + report.unresolvedReviewRows, 22)
  assert.equal(report.privateCatalogProducts, catalog.productCount)
  assert.equal(report.privateCatalogCaptures, catalog.captureCount)
  assert.equal(report.conflictingHistoricalProducts, catalog.conflictCount)
  assert.equal(report.observationCount, catalog.captureCount)
  for (const need of requirements) {
    const pair = queue.rows.filter(row => row.ingredientId === need.id)
    assert.equal(pair.length, 2)
    assert.deepEqual(pair.map(row => row.retailerId).sort(), ['dekamarkt', 'plus'])
    for (const row of pair) {
      assert.equal(row.ingredientLabel, need.label)
      assert.deepEqual(row.required, { amount: need.amount, unit: need.unit })
      assert.ok(row.status === 'unresolved' || row.status === 'suggested-for-manual-review')
      if (row.candidate) {
        assert.ok(row.candidate.canonicalKey.startsWith(row.retailerId + ':'))
      }
    }
  }
  assertAlwaysPrivate(report)
  assert.deepEqual(batch, preserved, 'no original archived observation may be altered')
})

test('all six order rotations preserve canonical offline 11×2 totals and full output', async () => {
  const fixture = await historical()
  const baseline = assessHistoricalM3FullBasketReadiness(fixture, NOW)
  for (let k = 0; k < 6; k++) {
    const rotated = structuredClone(fixture)
    rotated.results = rotated.results.slice(k).concat(rotated.results.slice(0, k))
    const report = assessHistoricalM3FullBasketReadiness(rotated, NOW)
    assert.deepEqual(report, baseline, 'source enumeration must not affect private review result')
    assertAlwaysPrivate(report)
  }
})

test('fictional historical cents are never promoted to actual basket prices or public savings', async () => {
  const fixture = await historical()
  for (const row of fixture.results) {
    for (const fact of row.observations) {
      fact.currentPriceCents = 987654
    }
  }
  const report = assessHistoricalM3FullBasketReadiness(fixture, NOW)
  assert.equal(report.sourceCount, 6)
  assert.equal(report.twoStoreReviewRows, 22)
  assertAlwaysPrivate(report)
  assert.doesNotMatch(JSON.stringify(report), /987654|EUR|euro|besparing/i)
})

test('contradictory six-shape source identity cannot be represented as a valid 22-row preflight', async () => {
  const fixture = await historical()
  const corrupted = structuredClone(fixture)
  const plus = corrupted.results.find(row => row.key === 'plus:product')
  const deka = corrupted.results.find(row => row.key === 'dekamarkt:product')
  assert.ok(plus && deka)
  plus.observations[0].supermarket = 'dekamarkt'
  assert.throws(() => assessHistoricalM3FullBasketReadiness(corrupted, NOW),
    /Private M3 offline full-basket preflight refused/)
})
