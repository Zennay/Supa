import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { comparePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health-trend.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent offline QA, NO retailer HTTP, private source content, public
// price claim, or product-core edits. Mutations are synthetic *report* scenarios
// derived from the real six archived reviewed adapter shapes.
const clone = data => structuredClone(data)
async function baseline() {
  const batch = await loadReviewedRepositoryFixtures()
  const latest = Math.max(...batch.results.flatMap(row =>
    row.observations.map(obs => Date.parse(obs.provenance.capturedAt))))
  const referenceTime = new Date(latest + 60 * 60 * 1000).toISOString()
  const report = evaluatePrivateAdapterHealth(batch, { referenceTime })
  assert.equal(report.sixShapeCoverageComplete, true)
  assert.equal(report.acceptedSources, 6)
  assert.equal(report.rejectedSources, 0)
  assert.equal(report.staleSources, 0)
  return report
}
function ensureStaleAction(report) {
  report.staleSources = 1
  report.historicalFreshnessWithinWindow = false
  if (!report.operatorActions.includes('review-capture-freshness')) {
    report.operatorActions.unshift('review-capture-freshness')
  }
}
function ensureUnknownPriceAction(report) {
  report.unknownPriceObservations = 1
  if (!report.operatorActions.includes('review-missing-price-facts')) {
    const at = report.operatorActions.indexOf('obtain-written-retailer-source-rights')
    report.operatorActions.splice(at, 0, 'review-missing-price-facts')
  }
}
function expectReviewSignal(before, after, affectedShape) {
  // Explicit stable totals: a global-only comparison silently hides local
  // deterioration, despite reliable perShape delta and accepted source shape.
  const current = comparePrivateAdapterHealth(before, after)
  assert.equal(current.totalObservationDelta, 0)
  assert.equal(current.totalProductDelta, 0)
  assert.equal(current.productionEnabled, false)
  assert.equal(current.permissionVerified, false)
  assert.equal(current.publicSavingsClaimEligible, false)
  assert.equal(current.externalRequests, 0)
  assert.equal(current.datasetRegressionSignalsDetected, true,
    'worsening ' + affectedShape + ' must not be hidden by another source recovering')
  assert.ok(current.reviewSignals.length > 0,
    'the offline human reviewer needs an explicit change signal for a local regression')
}

test('positive control: six archived real-source shape reports are stable and never imply permission', async () => {
  const before = await baseline()
  const stable = comparePrivateAdapterHealth(before, clone(before))
  assert.deepEqual(stable.reviewSignals, [])
  assert.equal(stable.datasetRegressionSignalsDetected, false)
  assert.equal(stable.externalRequests, 0)
  assert.equal(stable.livePricesAvailable, false)
  assert.equal(stable.publicSavingsClaimEligible, false)
  assert.deepEqual(before, await baseline())
})

test('QA: worsening PLUS capture freshness is not erased by simultaneous Deka freshness recovery', async () => {
  const before = await baseline()
  const after = clone(before)
  before.byShape['dekamarkt:product'].staleCaptures = 1
  after.byShape['plus:product'].staleCaptures = 1
  ensureStaleAction(before)
  ensureStaleAction(after)
  const comparator = comparePrivateAdapterHealth(before, after)
  assert.equal(comparator.perShape['plus:product'].staleCaptureDelta, 1)
  assert.equal(comparator.perShape['dekamarkt:product'].staleCaptureDelta, -1)
  assert.equal(before.staleSources, after.staleSources)
  expectReviewSignal(before, after, 'plus:product freshness')
})

test('QA: more unpriced PLUS facts must be flagged even when Deka source coverage recovers', async () => {
  const before = await baseline()
  const after = clone(before)
  const from = 'dekamarkt:catalog', to = 'plus:catalog'
  assert.ok(before.byShape[from].observations > 0)
  assert.ok(after.byShape[to].observations > 0)
  // Reset only the artificial missing-price distribution, retaining all
  // independently measured archived retailer counters and privacy gates.
  for (const shape of Object.keys(before.byShape)) {
    before.byShape[shape].unknownPrices = 0
    after.byShape[shape].unknownPrices = 0
  }
  before.byShape[from].unknownPrices = 1
  after.byShape[to].unknownPrices = 1
  ensureUnknownPriceAction(before)
  ensureUnknownPriceAction(after)
  // All other original totals stay fixed. This is deliberate balancing:
  // two individually internally valid health reports with identical totals.
  assert.doesNotThrow(() => comparePrivateAdapterHealth(before, clone(before)))
  assert.doesNotThrow(() => comparePrivateAdapterHealth(after, clone(after)))
  const trend = comparePrivateAdapterHealth(before, after)
  assert.equal(trend.perShape[to].unknownPriceDelta, 1)
  assert.equal(trend.perShape[from].unknownPriceDelta, -1)
  assert.equal(before.unknownPriceObservations, after.unknownPriceObservations)
  expectReviewSignal(before, after, 'plus:catalog price evidence')
})

test('QA: newly unknown availability must be diagnosed even if totals and price facts stay unchanged', async () => {
  const before = await baseline()
  const after = clone(before)
  const shape = Object.keys(after.byShape).find(key =>
    after.byShape[key].observations > after.byShape[key].unknownAvailability)
  assert.ok(shape, 'historical fixtures must include at least one known availability')
  after.byShape[shape].unknownAvailability++
  assert.doesNotThrow(() => comparePrivateAdapterHealth(after, clone(after)))
  const trend = comparePrivateAdapterHealth(before, after)
  assert.equal(trend.totalObservationDelta, 0)
  assert.equal(trend.publicSavingsClaimEligible, false)
  assert.equal(trend.datasetRegressionSignalsDetected, true,
    'an accepted historical observation becoming unknown stock is a QA deterioration')
})

test('QA: newly unknown packaging must not disappear from retailer trend quality warnings', async () => {
  const before = await baseline()
  const after = clone(before)
  const shape = Object.keys(after.byShape).find(key =>
    after.byShape[key].observations > after.byShape[key].unknownPacks)
  assert.ok(shape, 'historical fixtures must include at least one known pack')
  after.byShape[shape].unknownPacks++
  assert.doesNotThrow(() => comparePrivateAdapterHealth(after, clone(after)))
  const trend = comparePrivateAdapterHealth(before, after)
  assert.equal(trend.totalObservationDelta, 0)
  assert.equal(trend.externalRequests, 0)
  assert.equal(trend.datasetRegressionSignalsDetected, true,
    'an ambiguous product pack is an offline matching-quality regression, not live savings proof')
})
