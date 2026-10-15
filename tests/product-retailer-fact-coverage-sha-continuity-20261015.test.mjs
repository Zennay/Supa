import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// All sources are the six reviewed historical fixtures and deliberately
// fictional in-memory derivatives. No retailer requests or permissions.
const referenceTime = '2026-10-15T21:00:00.000Z'
const review = (before, after) =>
  comparePrivateRetailerFactChanges(before, after, { referenceTime })
const plusProduct = batch => {
  const result = batch.results.find(x => x.key === 'plus:product' && x.accepted)
  assert.ok(result)
  return result
}
function capturedLater(batch, sha = null) {
  const next = structuredClone(batch)
  for (const product of plusProduct(next).observations) {
    product.provenance.capturedAt = '2026-10-14T12:00:00.000000001Z'
    if (sha) product.provenance.sha256 = sha
  }
  return next
}
function discardProductSource(batch, mode) {
  const next = structuredClone(batch)
  const index = next.results.findIndex(x => x.key === 'plus:product')
  const row = next.results[index]
  assert.equal(row.accepted, true)
  const n = row.observations.length
  if (mode === 'rejected') {
    next.results[index] = {
      key: 'plus:product', accepted: false,
      reason: 'adapter-refused', observations: [],
    }
    next.summary.rejectedSources++
  } else {
    next.results.splice(index, 1)
    next.summary.sources--
  }
  next.summary.acceptedSources--
  next.summary.observations -= n
  next.summary.retailerCounts.plus -= n
  return next
}

test('product: all six reviewed sources unchanged -> no false removals or drift', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const result = review(batch, batch)
  assert.equal(result.totals.missing, 0)
  assert.equal(result.totals.priceChanged, 0)
  assert.equal(result.totals.unchanged, result.comparedProducts)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('product: an explicit rejected PLUS source cannot become missing products', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const current = discardProductSource(batch, 'rejected')
  assert.throws(() => review(batch, current), /Private retailer fact change review refused/u)
})

test('product: an omitted PLUS source cannot become missing products', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const current = discardProductSource(batch, 'omitted')
  assert.throws(() => review(batch, current), /Private retailer fact change review refused/u)
})

test('product: a later timestamp with identical HTML SHA and URL preserves unchanged facts', async () => {
  const previous = await loadReviewedRepositoryFixtures()
  const current = capturedLater(previous)
  const report = review(previous, current)
  assert.equal(report.totals.priceChanged, 0)
  assert.equal(report.totals.availabilityChanged, 0)
  assert.equal(report.totals.unchanged, report.comparedProducts)
})

test('product: same immutable HTML digest cannot yield a different cent price later', async () => {
  const previous = await loadReviewedRepositoryFixtures()
  const current = capturedLater(previous)
  const product = plusProduct(current).observations[0]
  product.currentPriceCents = (product.currentPriceCents ?? 100) + 1
  assert.throws(() => review(previous, current), /Private retailer fact change review refused/u)
})

test('product: same immutable HTML digest cannot yield a different stock state later', async () => {
  const previous = await loadReviewedRepositoryFixtures()
  const current = capturedLater(previous)
  const product = plusProduct(current).observations[0]
  product.availability = product.availability === 'available' ? 'unavailable' : 'available'
  assert.throws(() => review(previous, current), /Private retailer fact change review refused/u)
})

test('product: genuinely different hypothetical SHA may report a private price change without any rights', async () => {
  const previous = await loadReviewedRepositoryFixtures()
  const current = capturedLater(previous, 'b'.repeat(64))
  const product = plusProduct(current).observations[0]
  product.currentPriceCents = (product.currentPriceCents ?? 100) + 1
  const result = review(previous, current)
  assert.equal(result.perShape['plus:product'].priceChanged, 1)
  assert.equal(result.permissionVerified, undefined)
  assert.equal(result.sourceRightsVerified, false)
  assert.equal(result.productionEnabled, false)
})
