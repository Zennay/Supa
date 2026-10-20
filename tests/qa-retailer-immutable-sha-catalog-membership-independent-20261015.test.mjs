import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Independently authored QA on frozen product #3066. All inputs are offline,
// historically reviewed M1 adapter output plus explicitly fictional mutations.
const at = '2026-10-15T21:00:00.000Z'
const later = '2026-10-14T12:00:00.000000001Z'
const alternativeDigest = 'b'.repeat(64)
const compare = (a, b) => comparePrivateRetailerFactChanges(a, b, { referenceTime: at })

function recapture(batch, mutate, changedSourceBytes = false) {
  const next = structuredClone(batch)
  const source = next.results.find(x => x.key === 'plus:catalog' && x.accepted)
  assert.ok(source, 'requires the genuine historical reviewed PLUS catalog adapter')
  assert.ok(source.observations.length >= 2, 'requires multiple real fixture identities')
  for (const item of source.observations) {
    item.provenance.capturedAt = later
    if (changedSourceBytes) item.provenance.sha256 = alternativeDigest
  }
  mutate(source, next.summary)
  return next
}

test('QA product-set control: same digest with later capture and identical membership is unchanged', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const current = recapture(archived, () => {})
  const review = compare(archived, current)
  assert.equal(review.totals.missing, 0)
  assert.equal(review.totals.added, 0)
  assert.equal(review.totals.unchanged, review.comparedProducts)
  assert.equal(review.livePricesAvailable, false)
  assert.equal(review.publicSavingsClaimEligible, false)
  assert.equal(review.externalRequests, 0)
})

test('QA product-set control: changed fictional HTML digest may support one historical missing identity', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const current = recapture(archived, (source, summary) => {
    source.observations.pop()
    summary.observations--
    summary.retailerCounts.plus--
  }, true)
  const report = compare(archived, current)
  assert.equal(report.perShape['plus:catalog'].missing, 1)
  assert.equal(report.totals.missing, 1)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.sourceRightsVerified, false)
  assert.equal(report.externalRequests, 0)
})

test('QA fail-closed: same raw HTML SHA+URL cannot lose one parsed catalog identity at a later timestamp', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const current = recapture(archived, (source, summary) => {
    source.observations.pop()
    summary.observations--
    summary.retailerCounts.plus--
  })
  assert.throws(() => compare(archived, current), /Private retailer fact change review refused/)
})

test('QA fail-closed: same raw HTML SHA+URL cannot rename one source product ID into add+missing', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const current = recapture(archived, source => {
    source.observations[0].sourceProductId += '-synthetic-test-only'
  })
  assert.throws(() => compare(archived, current), /Private retailer fact change review refused/)
})
