import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assessPrivateM3RetailerIngestion } from
  '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import { loadReviewedRepositoryFixtures } from
  '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from
  '../scripts/retailer-private-adapter-health.mjs'

// Immutable historical adapters, no URL fetch, no rewritten fixture,
// no public/checkout/current-stock claims. This independent QA assertion is
// ONLY added on a frozen product-owner HEAD; product source stays untouched.
const AT = '2026-10-16T00:00:00.000Z'
async function original() {
  return {
    rights: JSON.parse(await readFile(
      new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
      'utf8')),
    batch: structuredClone(await loadReviewedRepositoryFixtures()),
  }
}
const result = ({ rights, batch }) =>
  assessPrivateM3RetailerIngestion(rights, batch, { referenceTime: AT })
function rowBy(report, key) {
  return report.perSourceShape.find(row =>
    row.retailer + ':' + row.kind === key)
}
function ensureHold(report) {
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.requiresHumanReview, true)
  assert.equal(report.liveRequests, 0)
}

test('original six historical adapter records keep M3 preflight on hold and immutable', async () => {
  const data = await original()
  const unchanged = structuredClone(data)
  const report = result(data)
  ensureHold(report)
  assert.equal(report.acceptedSourceShapes, 6)
  assert.equal(report.perSourceShape.length, 6)
  assert.deepEqual(data, unchanged)
})

test('integrated M3 per-shape stock UNKNOWN counts must match canonical health', async () => {
  const data = await original()
  const report = result(data)
  const health = evaluatePrivateAdapterHealth(data.batch, { referenceTime: AT })
  let originalUnknown = 0
  for (const [key, bucket] of Object.entries(health.byShape)) {
    const row = rowBy(report, key)
    assert.ok(row, 'canonical source kind must remain visible')
    assert.equal(row.archivedObservations, bucket.observations)
    assert.equal(row.unknownHistoricalAvailability, bucket.unknownAvailability,
      key + ' must not hide source-reported stock uncertainty')
    originalUnknown += bucket.unknownAvailability
  }
  assert.ok(originalUnknown > 0, 'genuine historical fixture has unknown stock')
  ensureHold(report)
})

test('all source facts marked unavailable must be visible as non-purchasable stock', async () => {
  const data = await original()
  for (const source of data.batch.results) {
    for (const ob of source.observations) ob.availability = 'unavailable'
  }
  const report = result(data)
  ensureHold(report)
  assert.equal(report.perSourceShape.length, 6)
  for (const row of report.perSourceShape) {
    assert.equal(row.unavailableHistoricalObservations, row.archivedObservations,
      row.retailer + ':' + row.kind + ' cannot silently omit zero available stock')
  }
})

test('all UNKNOWN source stock cannot appear as available in any M3 shape', async () => {
  const data = await original()
  for (const source of data.batch.results) {
    for (const ob of source.observations) ob.availability = 'unknown'
  }
  const report = result(data)
  ensureHold(report)
  for (const row of report.perSourceShape) {
    assert.equal(row.unknownHistoricalAvailability, row.archivedObservations,
      'an offline unknown field must stay unknown for ' + row.retailer + ':' + row.kind)
    assert.equal(row.unavailableHistoricalObservations, 0)
  }
})

test('forged public permission cannot turn no-stock preflight into an approved release', async () => {
  const data = await original()
  for (const source of data.batch.results) {
    for (const ob of source.observations) ob.availability = 'unavailable'
  }
  data.batch.summary.permissionVerified = true
  assert.throws(() => result(data))
})
