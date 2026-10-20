import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Original archived six-shape M1 samples + fictional ONE NANOSECOND permutations.
// Physical UTC ordering, not ISO text sort or Date.parse milliseconds, must
// protect product set diff when IDs are 100% changed. Absolutely no HTTP.
const now = '2026-10-15T21:00:00.000Z'
const oldPhysical = '2026-10-14T12:00:00.000000002Z'
const beforeWithOffset = '2026-10-14T14:00:00.000000001+02:00'
const afterWithOffset = '2026-10-14T07:00:00.000000003-05:00'
const review = (a,b) => comparePrivateRetailerFactChanges(a,b, { referenceTime: now })

function asCatalog(batch, timestamp, sha, replaceIds = false, keepFirst = false) {
  const next = structuredClone(batch)
  const row = next.results.find(r => r.key === 'plus:catalog' && r.accepted)
  assert.ok(row && row.observations.length === 4)
  for (const [index, observation] of row.observations.entries()) {
    observation.provenance.capturedAt = timestamp
    observation.provenance.sha256 = sha
    if (replaceIds && !(keepFirst && index === 0)) {
      observation.sourceProductId = 'qa-nano-disjoint-catalog-' + index
    }
  }
  return next
}

test('QA control: original archived six sources remain legitimate historical-only', async () => {
  const initial = await loadReviewedRepositoryFixtures()
  const actual = review(initial, structuredClone(initial))
  assert.equal(actual.totals.missing, 0)
  assert.equal(actual.totals.added, 0)
  assert.equal(actual.historicalOnly, true)
  assert.equal(actual.sourceRightsVerified, false)
  assert.equal(actual.livePricesAvailable, false)
  assert.equal(actual.publicSavingsClaimEligible, false)
  assert.equal(actual.externalRequests, 0)
})

test('QA control: lexically EARLIER -05:00 is physically +1ns LATER, count fictional changed IDs privately', async () => {
  const initial = await loadReviewedRepositoryFixtures()
  const prior = asCatalog(initial, oldPhysical, 'a'.repeat(64))
  const later = asCatalog(initial, afterWithOffset, 'b'.repeat(64), true)
  assert.ok(afterWithOffset < oldPhysical, 'text sort intentionally reverses physical UTC order')
  const result = review(prior, later)
  assert.equal(result.perShape['plus:catalog'].added, 4)
  assert.equal(result.perShape['plus:catalog'].missing, 4)
  assert.equal(result.totals.added, 4)
  assert.equal(result.totals.missing, 4)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.externalRequests, 0)
})

test('QA control: physically 1ns OLDER +02:00 capture with one shared SKU must already be refused', async () => {
  const initial = await loadReviewedRepositoryFixtures()
  const prior = asCatalog(initial, oldPhysical, 'a'.repeat(64))
  const older = asCatalog(initial, beforeWithOffset, 'b'.repeat(64), true, true)
  assert.ok(beforeWithOffset > oldPhysical, 'text sort falsely suggests candidate is newer')
  assert.throws(() => review(prior, older), /Private retailer fact change review refused/)
})

test('QA fail closed: physically 1ns OLDER +02:00 with ZERO shared SKU IDs cannot count as newer catalog', async () => {
  const initial = await loadReviewedRepositoryFixtures()
  const prior = asCatalog(initial, oldPhysical, 'a'.repeat(64))
  const older = asCatalog(initial, beforeWithOffset, 'b'.repeat(64), true)
  // Both parsed stamps share exactly the same physical millisecond; only
  // preserved sub-ms digits and the UTC offset reveal 1ns backwards.
  assert.equal(Date.parse(beforeWithOffset), Date.parse(oldPhysical))
  assert.throws(() => review(prior, older), /Private retailer fact change review refused/)
})
