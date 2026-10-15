import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { comparePrivateRetailerCatalogs } from '../scripts/retailer-private-catalog-drift.mjs'

// Independent QA properties for product-core P1 historical drift #2937.
// Only immutable existing six offline fixtures and fictional in-memory events.
async function baseline() {
  return buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
}
function newEvent(catalog, retailer, patch = {}) {
  const item = catalog.products.find(p => p.retailerId === retailer && p.consistency === 'consistent')
  assert.ok(item, 'reviewed six-source pilot must have a consistent ' + retailer + ' product')
  const capture = { ...structuredClone(item.captures[0]), ...patch }
  capture.capturedAt = patch.capturedAt ?? '2026-10-15T12:00:00.000Z'
  item.captures.push(capture)
  catalog.captureCount++
  return item
}
function safe(report) {
  assert.equal(report.mode, 'private-historical-retailer-drift-review')
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.externalRequests, 0)
  assert.equal(report.needsHumanReview, true)
  assert.deepEqual(Object.keys(report.perRetailer).sort(), ['dekamarkt','plus'])
  assert.doesNotMatch(JSON.stringify(report), /https?:\/\/|capturedAt|sourceUrl|currentPriceCents|offerPriceCents|productName|retailerProductId|participantKey/i)
}

test('historical comparison is invariant under unrelated product and capture iteration order', async () => {
  const a = await baseline()
  const b = structuredClone(a)
  b.products.reverse()
  for (const p of b.products) p.captures.reverse()
  const report = comparePrivateRetailerCatalogs(a, b)
  safe(report)
  assert.equal(report.repeatedCaptureEvents, a.captureCount)
  assert.equal(report.newCaptureEvents, 0)
  assert.equal(report.missingCaptureEventsInCandidateDataset, 0)
  assert.equal(report.factSetChangesNeedingReview, 0)
})

test('a second same-SHA capture time is a new event forward and a missing dataset event backward', async () => {
  const a = await baseline()
  const b = structuredClone(a)
  newEvent(b, 'plus')
  const forward = comparePrivateRetailerCatalogs(a, b)
  const reverse = comparePrivateRetailerCatalogs(b, a)
  safe(forward); safe(reverse)
  assert.equal(forward.newCaptureEvents, 1)
  assert.equal(forward.repeatedCaptureEvents, a.captureCount)
  assert.equal(forward.missingCaptureEventsInCandidateDataset, 0)
  assert.equal(forward.factSetChangesNeedingReview, 0)
  assert.equal(reverse.newCaptureEvents, 0)
  assert.equal(reverse.missingCaptureEventsInCandidateDataset, 1)
  assert.equal(reverse.repeatedCaptureEvents, a.captureCount)
})

test('change of source URL with identical hash and capture time changes event identity but not historical facts', async () => {
  const a = await baseline()
  const b = structuredClone(a)
  const item = b.products.find(p => p.retailerId === 'dekamarkt' && p.consistency === 'consistent')
  assert.ok(item)
  item.captures[0].sourceUrl = 'https://www.dekamarkt.nl/producten/fictional-alt-source'
  const report = comparePrivateRetailerCatalogs(a, b)
  safe(report)
  assert.equal(report.newCaptureEvents, 1)
  assert.equal(report.missingCaptureEventsInCandidateDataset, 1)
  assert.equal(report.repeatedCaptureEvents, a.captureCount - 1)
  assert.equal(report.factSetChangesNeedingReview, 0)
})

test('independent PLUS and DekaMarkt same-byte recapture events remain separated by retailer', async () => {
  const a = await baseline()
  const b = structuredClone(a)
  newEvent(b, 'plus')
  newEvent(b, 'dekamarkt')
  const report = comparePrivateRetailerCatalogs(a, b)
  safe(report)
  assert.equal(report.newCaptureEvents, 2)
  assert.equal(report.perRetailer.plus.newCaptureEvents, 1)
  assert.equal(report.perRetailer.dekamarkt.newCaptureEvents, 1)
  assert.equal(report.repeatedCaptureEvents, a.captureCount)
  assert.equal(report.factSetChangesNeedingReview, 0)
})
