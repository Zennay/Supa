import assert from 'node:assert/strict'
import test from 'node:test'
import { comparePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health-trend.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Owner-side invariants for trusted, aggregate-only offline fixture reports.
// Independent QA #2998 owns its separate unchanged red-to-green replay.
const original = async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const clock = new Date(Math.max(...batch.results.flatMap(r => r.observations.map(o =>
    Date.parse(o.provenance.capturedAt)))) + 3600000).toISOString()
  return evaluatePrivateAdapterHealth(batch, { referenceTime: clock })
}

function makeValidCompensationFixture(source) {
  const before = structuredClone(source)
  for (const key of ['plus:product', 'dekamarkt:catalog']) {
    const record = before.byShape[key]
    record.sources += 2
    record.accepted++
    record.rejected++
  }
  before.sources += 4
  before.acceptedSources += 2
  before.rejectedSources += 2
  before.sixShapeCoverageComplete = false
  before.operatorActions.unshift('review-rejected-adapter-inputs')
  const after = structuredClone(before)
  after.byShape['plus:product'].accepted--
  after.byShape['plus:product'].rejected++
  after.byShape['dekamarkt:catalog'].accepted++
  after.byShape['dekamarkt:catalog'].rejected--
  return { before, after }
}

test('owner: offsetting retailer source quality must not hide a negative source-kind transition', async () => {
  const { before, after } = makeValidCompensationFixture(await original())
  const beforeSnapshot = structuredClone(before)
  const afterSnapshot = structuredClone(after)
  const trend = comparePrivateAdapterHealth(before, after)
  assert.equal(after.acceptedSources, before.acceptedSources)
  assert.equal(after.rejectedSources, before.rejectedSources)
  assert.equal(trend.datasetRegressionSignalsDetected, true)
  assert.deepEqual(trend.reviewSignals, [
    'fewer-accepted-sources-in-source-shape',
    'more-rejected-sources-in-source-shape',
  ])
  assert.equal(trend.perShape['plus:product'].acceptedDelta, -1)
  assert.equal(trend.perShape['plus:product'].rejectedDelta, 1)
  assert.equal(trend.perShape['dekamarkt:catalog'].acceptedDelta, 1)
  assert.equal(trend.perShape['dekamarkt:catalog'].rejectedDelta, -1)
  assert.deepEqual(before, beforeSnapshot)
  assert.deepEqual(after, afterSnapshot)
  assert.equal(trend.publicSavingsClaimEligible, false)
  assert.equal(trend.productionEnabled, false)
  assert.equal(trend.livePricesAvailable, false)
  assert.equal(trend.permissionVerified, false)
  assert.equal(trend.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(trend.reviewSignals), /plus|dekamarkt|capturedAt|sha256|priceCents|https?:/i)
})

test('owner: stable reports and pure improvements never create compensated-quality false alarms', async () => {
  const { before, after } = makeValidCompensationFixture(await original())
  const stable = comparePrivateAdapterHealth(before, structuredClone(before))
  assert.deepEqual(stable.reviewSignals, [])
  assert.equal(stable.datasetRegressionSignalsDetected, false)
  const recovery = comparePrivateAdapterHealth(after, before)
  // Recovery of one source shape can be accompanied by a deterioration of
  // another: it must be reported, but must never reveal a retailer identity.
  assert.equal(recovery.datasetRegressionSignalsDetected, true)
  assert.ok(recovery.reviewSignals.every(s => !/plus|dekamarkt/.test(s)))
  const realBaseline = await original()
  assert.equal(comparePrivateAdapterHealth(realBaseline, structuredClone(realBaseline)).datasetRegressionSignalsDetected, false)
})
