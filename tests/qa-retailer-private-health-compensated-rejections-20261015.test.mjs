import assert from 'node:assert/strict'
import test from 'node:test'
import { comparePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health-trend.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA only: historic fixture-derived, internally consistent aggregate
// reports. The compensated changes below are synthetic offline diagnostics,
// NEVER assertions about live PLUS/DekaMarkt traffic, source rights, or prices.
const clone = structuredClone

async function frozenHistory() {
  const batch = await loadReviewedRepositoryFixtures()
  const latest = Math.max(...batch.results.flatMap(result =>
    result.observations.map(observation => Date.parse(observation.provenance.capturedAt))))
  return evaluatePrivateAdapterHealth(batch, {
    referenceTime: new Date(latest + 3_600_000).toISOString(),
  })
}

function compensatedReviewPair(source, deteriorates, recovers) {
  const before = clone(source)
  for (const key of [deteriorates, recovers]) {
    const shape = before.byShape[key]
    assert.equal(shape.accepted, 1, 'use complete six-source historical fixture')
    assert.equal(shape.rejected, 0, 'start from independently reviewed fixtures')
    // Additional fictional reviewed/rejected events on these two shape slots:
    // maintain the exact source=accepted+rejected contract.
    shape.sources += 2
    shape.accepted += 1
    shape.rejected += 1
  }
  before.sources += 4
  before.acceptedSources += 2
  before.rejectedSources += 2
  before.sixShapeCoverageComplete = false
  // Canonical assessor action order: rejected source quality precedes
  // freshness, conflict and unknown-price diagnostics.
  assert.ok(!before.missingSourceKinds.length)
  before.operatorActions.unshift('review-rejected-adapter-inputs')
  const after = clone(before)
  after.byShape[deteriorates].accepted--
  after.byShape[deteriorates].rejected++
  after.byShape[recovers].accepted++
  after.byShape[recovers].rejected--
  return { before, after }
}

test('control: valid six-source unchanged and compensated-source baselines have no fabricated alert', async () => {
  const baseline = await frozenHistory()
  for (const source of [
    baseline,
    compensatedReviewPair(baseline, 'plus:product', 'dekamarkt:catalog').before,
  ]) {
    const output = comparePrivateAdapterHealth(source, clone(source))
    assert.deepEqual(output.reviewSignals, [])
    assert.equal(output.datasetRegressionSignalsDetected, false)
    assert.equal(output.permissionVerified, false)
    assert.equal(output.productionEnabled, false)
    assert.equal(output.publicSavingsClaimEligible, false)
    assert.equal(output.livePricesAvailable, false)
    assert.equal(output.externalRequests, 0)
  }
})

for (const [label, worsened, recovered] of [
  ['PLUS product fails despite Deka catalog recovery', 'plus:product', 'dekamarkt:catalog'],
  ['Deka offers fails despite PLUS catalog recovery', 'dekamarkt:offers', 'plus:catalog'],
]) {
  test('quality contract: ' + label + ' must remain visible when global counts cancel', async () => {
    const { before, after } = compensatedReviewPair(await frozenHistory(), worsened, recovered)
    const trend = comparePrivateAdapterHealth(before, after)
    assert.equal(after.sources, before.sources)
    assert.equal(after.acceptedSources, before.acceptedSources)
    assert.equal(after.rejectedSources, before.rejectedSources)
    assert.equal(after.observations, before.observations)
    assert.equal(after.products, before.products)
    assert.deepEqual(after.missingSourceKinds, [])
    assert.deepEqual(after.operatorActions, before.operatorActions)
    assert.equal(trend.perShape[worsened].rejectedDelta, 1)
    assert.equal(trend.perShape[worsened].acceptedDelta, -1)
    assert.equal(trend.perShape[recovered].rejectedDelta, -1)
    assert.equal(trend.perShape[recovered].acceptedDelta, 1)
    assert.deepEqual(trend.newlyMissingShapes, [])
    assert.equal(trend.totalObservationDelta, 0)
    assert.equal(trend.totalProductDelta, 0)
    // Actual quality signal must reflect one worsening reviewed input source.
    // A global-net-only comparator silently emits [] and fails this assertion.
    assert.equal(trend.datasetRegressionSignalsDetected, true)
    assert.ok(trend.reviewSignals.length > 0)
    assert.ok(trend.reviewSignals.every(signal =>
      !/plus|dekamarkt|https?:|sha256|priceCents|capturedAt/i.test(signal)))
    assert.equal(trend.permissionVerified, false)
    assert.equal(trend.productionEnabled, false)
    assert.equal(trend.publicSavingsClaimEligible, false)
    assert.equal(trend.externalRequests, 0)
  })
}
