import assert from 'node:assert/strict'
import test from 'node:test'
import { comparePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health-trend.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent postrepair QA over real historical *offline* PLUS/Deka sources.
// Synthetic source-admission count movements are ONLY validation inputs:
// never measured retailer behavior, permission, money or a savings claim.
const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const ISSUE_SIGNALS = ['fewer-accepted-sources-in-source-shape',
  'more-rejected-sources-in-source-shape']
const clone = structuredClone

async function realBaseline() {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.summary.sources, 6)
  const timestamp = Math.max(...batch.results.flatMap(source =>
    source.observations.map(item => Date.parse(item.provenance.capturedAt))))
  return evaluatePrivateAdapterHealth(batch, {
    referenceTime: new Date(timestamp + 60 * 60 * 1000).toISOString(),
  })
}

function augmented(report, keys) {
  const b = clone(report)
  for (const key of keys) {
    const shape = b.byShape[key]
    assert.equal(shape.accepted, 1)
    assert.equal(shape.rejected, 0)
    shape.sources += 2
    shape.accepted += 1
    shape.rejected += 1
  }
  b.sources += 2 * keys.length
  b.acceptedSources += keys.length
  b.rejectedSources += keys.length
  b.sixShapeCoverageComplete = false
  // Exact source-health assessor ordering: source rejection is the first
  // operator action; action list is independent of which retailer is affected.
  b.operatorActions.unshift('review-rejected-adapter-inputs')
  return b
}
function shift(report, key, mode) {
  const shape = report.byShape[key]
  if (mode === 'worse') { shape.accepted--; shape.rejected++ }
  else { shape.accepted++; shape.rejected-- }
  assert.ok(shape.accepted >= 0 && shape.rejected >= 0)
}

function safeOutput(out) {
  assert.equal(out.mode, 'private-adapter-health-trend')
  assert.equal(out.context, 'offline-reviewed-dataset-differences-only')
  assert.equal(out.permissionVerified, false)
  assert.equal(out.productionEnabled, false)
  assert.equal(out.publicSavingsClaimEligible, false)
  assert.equal(out.livePricesAvailable, false)
  assert.equal(out.humanReviewRequired, true)
  assert.equal(out.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(out.reviewSignals),
    /plus|dekamarkt|productId|https?:|sourceUrl|sha256|priceCents|capturedAt|token/i)
}

test('source quality: 30 direction-sensitive six-shape compensation cases never disappear in aggregate totals', async t => {
  const source = await realBaseline()
  assert.deepEqual(Object.keys(source.byShape).sort(), [...SHAPES].sort())
  let checked = 0
  for (const bad of SHAPES) {
    for (const recovered of SHAPES.filter(key => key !== bad)) {
      await t.test('worse ' + bad + ' while recovering ' + recovered, () => {
        const before = augmented(source, [bad, recovered])
        const after = clone(before)
        shift(after, bad, 'worse')
        shift(after, recovered, 'better')
        const beforeBytes = JSON.stringify(before)
        const afterBytes = JSON.stringify(after)
        const output = comparePrivateAdapterHealth(before, after)
        assert.equal(after.sources, before.sources)
        assert.equal(after.acceptedSources, before.acceptedSources)
        assert.equal(after.rejectedSources, before.rejectedSources)
        assert.equal(after.observations, before.observations)
        assert.equal(after.products, before.products)
        assert.deepEqual(after.missingSourceKinds, before.missingSourceKinds)
        assert.deepEqual(after.operatorActions, before.operatorActions)
        assert.equal(output.totalObservationDelta, 0)
        assert.equal(output.totalProductDelta, 0)
        assert.deepEqual(output.reviewSignals, ISSUE_SIGNALS)
        assert.equal(output.datasetRegressionSignalsDetected, true)
        assert.equal(output.perShape[bad].acceptedDelta, -1)
        assert.equal(output.perShape[bad].rejectedDelta, 1)
        assert.equal(output.perShape[recovered].acceptedDelta, 1)
        assert.equal(output.perShape[recovered].rejectedDelta, -1)
        safeOutput(output)
        assert.equal(JSON.stringify(before), beforeBytes, 'no mutation of original evidence')
        assert.equal(JSON.stringify(after), afterBytes, 'no mutation of new evidence')
      })
      checked++
    }
  }
  assert.equal(checked, 30)
})

test('six single-shape repair-only improvements never create false degradation signals', async t => {
  const baseline = await realBaseline()
  for (const shape of SHAPES) {
    await t.test(shape, () => {
      const before = augmented(baseline, [shape, SHAPES.find(s => s !== shape)])
      const after = clone(before)
      shift(after, shape, 'better')
      after.acceptedSources++
      after.rejectedSources--
      // One other rejected source remains, so canonical actions and
      // sixShapeCoverageComplete stay unchanged.
      const trend = comparePrivateAdapterHealth(before, after)
      assert.deepEqual(trend.reviewSignals, [])
      assert.equal(trend.datasetRegressionSignalsDetected, false)
      safeOutput(trend)
    })
  }
})

test('original genuine six-source stable control remains clean and private', async () => {
  const baseline = await realBaseline()
  const trend = comparePrivateAdapterHealth(baseline, clone(baseline))
  assert.deepEqual(trend.reviewSignals, [])
  assert.equal(trend.datasetRegressionSignalsDetected, false)
  safeOutput(trend)
})
