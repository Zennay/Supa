import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Historical, previously reviewed M1 fixtures + explicit fictional mutations.
// Never request live retailer URLs or claim licensed/current prices or savings.
const clock = '2026-10-15T21:00:00.000Z'
const review = (oldBatch, nextBatch) =>
  comparePrivateRetailerFactChanges(oldBatch, nextBatch, { referenceTime: clock })

function revisedCatalog(batch, capturedAt, sha, prefix) {
  const clone = structuredClone(batch)
  const catalog = clone.results.find(x => x.accepted && x.key === 'plus:catalog')
  assert.ok(catalog && catalog.observations.length >= 2)
  for (let i = 0; i < catalog.observations.length; i++) {
    const row = catalog.observations[i]
    row.sourceProductId = prefix + '-' + i
    row.provenance.capturedAt = capturedAt
    row.provenance.sha256 = sha.repeat(64)
  }
  return clone
}

test('product: unrelated six historical source shapes remain identical and private', async () => {
  const before = await loadReviewedRepositoryFixtures()
  const result = review(before, structuredClone(before))
  assert.equal(result.totals.added, 0)
  assert.equal(result.totals.missing, 0)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.sourceRightsVerified, false)
  assert.equal(result.externalRequests, 0)
})

test('product: a later changed-SHA page with zero common catalog IDs is valid private turnover', async () => {
  const before = await loadReviewedRepositoryFixtures()
  const after = revisedCatalog(before, '2026-10-14T12:00:00.000000001Z', 'b', 'fake-later')
  const count = before.results.find(x => x.key === 'plus:catalog').observations.length
  const result = review(before, after)
  assert.equal(result.perShape['plus:catalog'].added, count)
  assert.equal(result.perShape['plus:catalog'].missing, count)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.externalRequests, 0)
})

test('product: an older changed-SHA page with zero common IDs cannot count as additions', async () => {
  const before = await loadReviewedRepositoryFixtures()
  const after = revisedCatalog(before, '2026-10-03T10:00:00.000Z', 'b', 'fake-older')
  assert.throws(() => review(before, after), /Private retailer fact change review refused/)
})

test('product: same physical page instant cannot claim a different SHA and SKU set', async () => {
  const before = await loadReviewedRepositoryFixtures()
  const stamp = before.results.find(x => x.key === 'plus:catalog')
    .observations[0].provenance.capturedAt
  const after = revisedCatalog(before, stamp, 'b', 'fake-same-instant')
  assert.throws(() => review(before, after), /Private retailer fact change review refused/)
})

test('product: nanosecond-reversed captures with disjoint IDs are rejected', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const before = revisedCatalog(original, '2026-10-14T12:00:00.000000002Z', 'b', 'fake-before')
  const after = revisedCatalog(original, '2026-10-14T12:00:00.000000001Z', 'c', 'fake-after')
  assert.throws(() => review(before, after), /Private retailer fact change review refused/)
})

function withAdditionalCatalogCapture(batch, capturedAt, sha, prefix) {
  const copy = structuredClone(batch)
  const catalog = copy.results.find(x => x.accepted && x.key === 'plus:catalog')
  assert.ok(catalog)
  const additional = structuredClone(catalog)
  for (const [i, row] of additional.observations.entries()) {
    row.sourceProductId = prefix + '-' + i
    row.provenance.capturedAt = capturedAt
    row.provenance.sha256 = sha.repeat(64)
  }
  copy.results.push(additional)
  copy.summary.sources++
  copy.summary.acceptedSources++
  copy.summary.observations += additional.observations.length
  copy.summary.retailerCounts.plus += additional.observations.length
  return copy
}

test('product: a multi-event catalog archive cannot rewind its latest physical page capture', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const before = withAdditionalCatalogCapture(
    original, '2026-10-14T12:00:00.000000002Z', 'b', 'fake-event-before')
  const after = withAdditionalCatalogCapture(
    original, '2026-10-14T12:00:00.000000001Z', 'c', 'fake-event-after')
  assert.throws(() => review(before, after), /Private retailer fact change review refused/)
})

test('product: later page event among multiple historical events remains comparable', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const before = withAdditionalCatalogCapture(
    original, '2026-10-13T12:00:00.000000001Z', 'b', 'fake-event-before')
  const after = withAdditionalCatalogCapture(
    original, '2026-10-14T12:00:00.000000001Z', 'c', 'fake-event-after')
  const report = review(before, after)
  assert.ok(report.currentCaptureEvents > 6)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
})
