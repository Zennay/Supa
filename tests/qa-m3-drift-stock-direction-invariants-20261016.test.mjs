import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { rehearsePrivateM3RetailerDrift } from '../scripts/retailer-private-m3-capture-drift-rehearsal.mjs'

// QA-owned differential acceptance for the merged offline dual-archive M3
// product engine. No HTTP, new retailer captures, user observations or writes.
const AT = '2026-10-16T00:00:00.000Z'
const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const rights = async () => JSON.parse(await readFile(
  new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
  'utf8'))

async function scenario(previousStatus, nextStatus) {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const first = previous.results.find(row => row.key === 'plus:product')
  assert.ok(first && first.observations.length > 0)
  for (const row of first.observations) row.availability = previousStatus
  const current = structuredClone(previous)
  const changed = current.results.find(row => row.key === 'plus:product')
  const capturedAt = changed.observations[0].provenance.capturedAt
  const later = new Date(Date.parse(capturedAt) + 86_400_000).toISOString()
  for (const row of changed.observations) {
    row.availability = nextStatus
    row.provenance.capturedAt = later
    row.provenance.sha256 = 'd'.repeat(64)
  }
  const pristine = structuredClone({ previous, current })
  const report = rehearsePrivateM3RetailerDrift(
    await rights(), previous, current, { referenceTime: AT })
  assert.deepEqual({ previous, current }, pristine, 'archived data cannot be mutated')
  assert.equal(report.historicalSourceShapes, 6)
  assert.deepEqual(report.perShape.map(x => x.retailer + ':' + x.kind), SHAPES)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.sourceRightsStillNeeded, true)
  assert.equal(report.humanM3BasketEvidenceStillNeeded, true)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.currentPriceVerified, false)
  assert.equal(report.currentAvailabilityVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRequests, 0)
  assert.equal(report.manualSourceReviewRequired, true)
  assert.equal(report.alertShapeCount, 1)
  assert.ok(report.operatorAlertKinds.includes('review-archived-product-fact-changes'))
  for (const row of report.perShape.slice(1)) {
    assert.equal(row.historicalChangedFactFields, 0)
    assert.equal(row.archiveStockUnknownDelta, 0)
    assert.equal(row.archiveStockUnavailableDelta, 0)
    assert.deepEqual(row.reviewSignals, [])
  }
  const json = JSON.stringify(report)
  assert.doesNotMatch(json, /https?:\/\/|sourceProductId|sourceUrl|sha256|priceCents|sourceName|retailerProductId/i)
  for (const source of current.results) {
    for (const row of source.observations) {
      assert.equal(json.includes(row.provenance.sha256), false)
      assert.equal(json.includes(row.provenance.url), false)
      assert.equal(json.includes(row.sourceProductId), false)
    }
  }
  return { report, count: first.observations.length, selected: report.perShape[0] }
}

test('offline archived stock becoming unknown generates exactly the one-source unknown alert', async () => {
  const { report, count, selected } = await scenario('available', 'unknown')
  assert.equal(selected.archiveStockUnknownDelta, count)
  assert.equal(selected.archiveStockUnavailableDelta, 0)
  assert.ok(selected.reviewSignals.includes('more-unknown-archived-availability'))
  assert.ok(report.operatorAlertKinds.includes('more-unknown-archived-availability'))
  assert.ok(!report.operatorAlertKinds.includes('more-unavailable-archived-products'))
})

test('offline archived products becoming unavailable generate stock-out review, not unknown', async () => {
  const { report, count, selected } = await scenario('available', 'unavailable')
  assert.equal(selected.archiveStockUnknownDelta, 0)
  assert.equal(selected.archiveStockUnavailableDelta, count)
  assert.ok(selected.reviewSignals.includes('more-unavailable-archived-products'))
  assert.ok(!report.operatorAlertKinds.includes('more-unknown-archived-availability'))
})

test('historical availability recovery never masquerades as new stock-out evidence or current inventory', async () => {
  const { report, count, selected } = await scenario('unavailable', 'available')
  assert.equal(selected.archiveStockUnavailableDelta, -count)
  assert.equal(selected.archiveStockUnknownDelta, 0)
  assert.deepEqual(report.operatorAlertKinds, ['review-archived-product-fact-changes'])
  assert.deepEqual(selected.reviewSignals, ['review-archived-product-fact-changes'])
  assert.equal(report.currentAvailabilityVerified, false)
})

test('historical unknown becoming unavailable is a stock-out, not an unknown-stock spike', async () => {
  const { report, count, selected } = await scenario('unknown', 'unavailable')
  assert.equal(selected.archiveStockUnknownDelta, -count)
  assert.equal(selected.archiveStockUnavailableDelta, count)
  assert.ok(report.operatorAlertKinds.includes('more-unavailable-archived-products'))
  assert.ok(!report.operatorAlertKinds.includes('more-unknown-archived-availability'))
})

test('future-dated supposedly reviewed source is never accepted as current evidence', async () => {
  const previous = structuredClone(await loadReviewedRepositoryFixtures())
  const current = structuredClone(previous)
  const first = current.results.find(x => x.key === 'plus:product')
  for (const row of first.observations) {
    row.provenance.capturedAt = '2035-01-01T00:00:00.000Z'
    row.provenance.sha256 = 'e'.repeat(64)
  }
  const original = structuredClone(current)
  const gate = await rights()
  assert.throws(() => rehearsePrivateM3RetailerDrift(
    gate, previous, current, { referenceTime: AT }), /refused/i)
  assert.deepEqual(current, original)
})
