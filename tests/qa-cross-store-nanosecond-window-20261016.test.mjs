import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { auditPrivateCrossStoreEvidence } from '../scripts/qa-retailer-cross-store-source-coverage.mjs'

const plusAt = '2026-10-04T12:00:00.000000000Z'
const dekaAt = '2026-10-05T12:00:00.000000000Z'
const after24hOneNs = '2026-10-05T12:00:00.000000001Z'
const asOfNow = '2026-10-15T00:00:00.000Z'

async function paired() {
  const original = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  const plus = structuredClone(original.products.find(p => p.retailerId === 'plus'))
  const deka = structuredClone(original.products.find(p => p.retailerId === 'dekamarkt'))
  assert.ok(plus && deka)
  for (const [item, retailer, amount, unit, name] of [
    [plus, 'plus', 1, 'l', 'Fictieve Halfvolle Melk'],
    [deka, 'dekamarkt', 1000, 'ml', 'Melk halfvolle fictieve'],
  ]) {
    const first = structuredClone(item.captures[0])
    first.name = name
    first.currentPriceCents = 123
    first.currency = 'EUR'
    first.pack = { rawText: 'fictional reviewed unit', amount, unit }
    first.offer = null
    first.availability = 'unknown'
    first.sourceUrl = retailer === 'plus'
      ? 'https://www.plus.nl/producten' : 'https://www.dekamarkt.nl/producten'
    first.snapshotSha256 = 'f'.repeat(64)
    const second = structuredClone(first)
    second.sourceKind = first.sourceKind === 'product' ? 'catalog' : 'product'
    item.captures = [first, second]
    item.consistency = 'consistent'
  }
  return {
    ...original,
    products: [plus, deka],
    productCount: 2,
    captureCount: 4,
    conflictCount: 0,
  }
}

function clocks(catalog, plusClock, dekaClock) {
  for (const product of catalog.products) {
    const timestamp = product.retailerId === 'plus' ? plusClock : dekaClock
    for (const capture of product.captures) capture.capturedAt = timestamp
  }
  return catalog
}
function verifyPrivate(report) {
  assert.equal(report.candidatePairs, 1)
  assert.equal(report.humanReviewRequired, true)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.verifiedEquivalentProducts, 0)
  assert.equal(report.verifiedPriceComparisons, 0)
  assert.equal(report.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(report), /https?:|sourceProductId|currentPriceCents/i)
}

test('original sanitized six captures remain historical-only without current price claims', async () => {
  const catalog = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  const report = auditPrivateCrossStoreEvidence(catalog, { asOf: asOfNow })
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
})

test('exact 24 hours with nine-digit UTC captures is an inclusive review boundary', async () => {
  const catalog = clocks(await paired(), plusAt, dekaAt)
  const before = structuredClone(catalog)
  const report = auditPrivateCrossStoreEvidence(catalog, { asOf: dekaAt })
  verifyPrivate(report)
  assert.equal(report.historicallyMultiSourceSupported, 1)
  assert.equal(report.withinHistoricalReviewClock, 1)
  assert.equal(report.misalignedCaptureWindows, 0)
  assert.equal(report.staleRelativeToReviewClock, 0)
  assert.deepEqual(catalog, before)
})

test('physical capture skew at 24 hours PLUS ONE NANOSECOND is never synchronized', async () => {
  const catalog = clocks(await paired(), plusAt, after24hOneNs)
  const report = auditPrivateCrossStoreEvidence(catalog, { asOf: after24hOneNs })
  verifyPrivate(report)
  assert.equal(report.misalignedCaptureWindows, 1)
  assert.equal(report.historicallyMultiSourceSupported, 0)
})

test('age beyond 24 hours by ONE NANOSECOND is stale even with aligned historic capture clocks', async () => {
  const catalog = clocks(await paired(), plusAt, dekaAt)
  const report = auditPrivateCrossStoreEvidence(catalog, { asOf: after24hOneNs })
  verifyPrivate(report)
  assert.equal(report.historicallyMultiSourceSupported, 1)
  assert.equal(report.staleRelativeToReviewClock, 1)
  assert.equal(report.withinHistoricalReviewClock, 0)
})
