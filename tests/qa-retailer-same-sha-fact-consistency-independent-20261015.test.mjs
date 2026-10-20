import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Independently authored quality-validation on the frozen product #3057 head.
// This never reads a live retailer, substitutes a license, or publishes prices.
const referenceTime = '2026-10-15T21:00:00.000Z'
const compare = (previous, current) =>
  comparePrivateRetailerFactChanges(previous, current, { referenceTime })
const laterCapture = '2026-10-14T12:00:00.000000001Z'
const fakeDigest = 'b'.repeat(64)

function recapture(archived, change, { differentBytes = false } = {}) {
  const next = structuredClone(archived)
  const result = next.results.find(row => row.accepted && row.key === 'plus:product')
  assert.ok(result, 'reviewed PLUS product fixture must remain available')
  assert.ok(result.observations.length > 0)
  // The source URL, retailer, capture kind and source product ID stay EXACTLY
  // identical. Only the fictional capture time advances; the physical source
  // SHA changes solely when differentBytes is explicitly requested.
  for (const observation of result.observations) {
    observation.provenance.capturedAt = laterCapture
    if (differentBytes) observation.provenance.sha256 = fakeDigest
  }
  change(result.observations[0])
  return next
}

test('QA control: identical source bytes and only a new physical capture clock do not imply fact drift', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const unchanged = recapture(archived, () => {})
  const report = compare(archived, unchanged)
  assert.equal(report.totals.priceChanged, 0)
  assert.equal(report.totals.availabilityChanged, 0)
  assert.equal(report.totals.packChanged, 0)
  assert.equal(report.totals.unchanged, report.comparedProducts)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
})

test('QA control: genuinely distinct fictional source bytes can yield private price-change counts', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const changed = recapture(archived, observation => {
    observation.currentPriceCents = (observation.currentPriceCents ?? 159) + 7
  }, { differentBytes: true })
  const report = compare(archived, changed)
  assert.equal(report.perShape['plus:product'].priceChanged, 1)
  assert.equal(report.totals.priceChanged, 1)
  assert.equal(report.sourceRightsVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
})

test('QA fail-closed: same immutable HTML SHA and same source URL cannot create a fictional price change later', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const tampered = recapture(archived, observation => {
    observation.currentPriceCents = (observation.currentPriceCents ?? 159) + 7
  })
  // Same exact SHA represents identical captured source bytes; when a parser
  // or in-memory caller produces different facts, operator review is required,
  // not a trustworthy claim that a retailer changed its source price.
  assert.throws(() => compare(archived, tampered), /Private retailer fact change review refused/)
})

test('QA fail-closed: unchanged source bytes cannot fabricate a stock-status transition', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const tampered = recapture(archived, observation => {
    observation.availability = observation.availability === 'available'
      ? 'unavailable' : 'available'
  })
  assert.throws(() => compare(archived, tampered), /Private retailer fact change review refused/)
})
