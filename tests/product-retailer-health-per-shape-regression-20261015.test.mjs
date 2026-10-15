import assert from 'node:assert/strict'
import test from 'node:test'
import { comparePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health-trend.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Only archived reviewed shapes; no live retailer requests or price claims.
async function source() {
  const batch = await loadReviewedRepositoryFixtures()
  const latest = Math.max(...batch.results.flatMap(r =>
    r.observations.map(p => Date.parse(p.provenance.capturedAt))))
  return evaluatePrivateAdapterHealth(batch, {
    referenceTime: new Date(latest + 3600000).toISOString(),
  })
}
const copy = x => structuredClone(x)
const privateOutput = r => {
  assert.equal(r.datasetRegressionSignalsDetected, true)
  assert.equal(r.productionEnabled, false)
  assert.equal(r.permissionVerified, false)
  assert.equal(r.publicSavingsClaimEligible, false)
  assert.equal(r.livePricesAvailable, false)
  assert.equal(r.externalRequests, 0)
  assert.equal(r.totalObservationDelta, 0)
  assert.equal(r.totalProductDelta, 0)
  assert.ok(r.reviewSignals.every(signal =>
    !/plus|dekamarkt|https:|priceCents|capturedAt|sha256/i.test(signal)))
}
function freshness(r) {
  r.staleSources = 1
  r.historicalFreshnessWithinWindow = false
  if (!r.operatorActions.includes('review-capture-freshness')) {
    r.operatorActions.unshift('review-capture-freshness')
  }
}
function price(r) {
  r.unknownPriceObservations = 1
  if (!r.operatorActions.includes('review-missing-price-facts')) {
    const where = r.operatorActions.indexOf('obtain-written-retailer-source-rights')
    r.operatorActions.splice(where, 0, 'review-missing-price-facts')
  }
}
test('six historical shapes remain stable, with no fictitious regression or permission', async () => {
  const before = await source()
  const result = comparePrivateAdapterHealth(before, copy(before))
  assert.deepEqual(result.reviewSignals, [])
  assert.equal(result.datasetRegressionSignalsDetected, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})
test('PLUS freshness regression remains flagged despite Deka freshness recovery', async () => {
  const before = await source()
  const after = copy(before)
  before.byShape['dekamarkt:product'].staleCaptures = 1
  after.byShape['plus:product'].staleCaptures = 1
  freshness(before); freshness(after)
  const report = comparePrivateAdapterHealth(before, after)
  privateOutput(report)
  assert.equal(before.staleSources, after.staleSources)
  assert.ok(report.reviewSignals.includes('more-stale-captures-in-source-shape'))
  assert.equal(report.perShape['plus:product'].staleCaptureDelta, 1)
  assert.equal(report.perShape['dekamarkt:product'].staleCaptureDelta, -1)
})
test('PLUS unknown price deterioration is not masked by Deka source recovery', async () => {
  const before = await source()
  const after = copy(before)
  for (const name of Object.keys(before.byShape)) {
    before.byShape[name].unknownPrices = 0
    after.byShape[name].unknownPrices = 0
  }
  before.byShape['dekamarkt:catalog'].unknownPrices = 1
  after.byShape['plus:catalog'].unknownPrices = 1
  price(before); price(after)
  const report = comparePrivateAdapterHealth(before, after)
  privateOutput(report)
  assert.equal(before.unknownPriceObservations, after.unknownPriceObservations)
  assert.ok(report.reviewSignals.includes('more-unpriced-observations-in-source-shape'))
})
test('new unknown source availability and pack size are quality-only regressions', async () => {
  const baseline = await source()
  for (const [key, label] of [
    ['unknownAvailability', 'more-unknown-availability-in-source-shape'],
    ['unknownPacks', 'more-unknown-packs-in-source-shape'],
  ]) {
    const before = copy(baseline)
    const after = copy(baseline)
    const shape = Object.keys(after.byShape).find(k =>
      after.byShape[k][key] < after.byShape[k].observations)
    assert.ok(shape, 'historical reviewed shapes provide known evidence')
    after.byShape[shape][key]++
    const report = comparePrivateAdapterHealth(before, after)
    privateOutput(report)
    assert.ok(report.reviewSignals.includes(label))
    assert.equal(report.newlyMissingShapes.length, 0)
  }
})
test('improving or unchanged source shape does not emit source regression', async () => {
  const before = await source()
  const after = copy(before)
  // A stable state never implies an environmental change.
  const report = comparePrivateAdapterHealth(before, after)
  assert.equal(report.datasetRegressionSignalsDetected, false)
  assert.deepEqual(report.reviewSignals, [])
})
