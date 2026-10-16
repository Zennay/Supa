import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewPrivateRetailerOffers } from '../scripts/qa-retailer-offer-baseline-corroboration.mjs'

// Independent QA only: six unchanged, locally reviewed historical source types.
// Setting a hypothetical validity interval is NOT proof of an actual campaign.
const asOf = '2026-10-15T00:00:00.000Z'
const day = 24 * 60 * 60 * 1000
const hour = 60 * 60 * 1000
const review = batch => reviewPrivateRetailerOffers(batch, { asOf })

async function reviewed() {
  return structuredClone(await loadReviewedRepositoryFixtures())
}

function plusBanana(batch) {
  const offers = batch.results.find(row => row.key === 'plus:offers')
  const banana = offers?.observations.find(row => row.sourceProductId === '113651')
  const catalog = batch.results.find(row => row.key === 'plus:catalog')
  const baseline = catalog?.observations.find(row => row.sourceProductId === '113651')
  assert.ok(banana && baseline, 'existing reviewed PLUS offer/catalog source pair')
  assert.ok(banana.offer, 'historical banana offer shape')
  assert.equal(banana.offer.originalPriceCents, baseline.currentPriceCents)
  assert.equal(banana.offer.offerPriceCents, banana.currentPriceCents)
  return banana
}

const instant = ms => new Date(ms).toISOString()

test('historical plus catalog-price corroboration control remains unchanged and unpublished', async () => {
  const batch = await reviewed()
  const before = structuredClone(batch)
  const banana = plusBanana(batch)
  assert.equal(banana.offer.validFrom, null)
  assert.equal(banana.offer.validTo, null)
  const report = review(batch)
  assert.ok(report.corroboratedHistoricalBaselines >= 1)
  assert.ok(report.unknownOfferWindows >= 1)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
  assert.deepEqual(batch, before)
})

test('a matching archived catalog price cannot corroborate a promotion BEFORE its start', async () => {
  const batch = await reviewed()
  const original = review(batch)
  const banana = plusBanana(batch)
  const captured = Date.parse(banana.provenance.capturedAt)
  banana.offer.validFrom = instant(captured + hour)
  banana.offer.validTo = instant(captured + day)

  const report = review(batch)
  assert.equal(report.outOfWindowAtCapture, original.outOfWindowAtCapture + 1)
  assert.equal(report.corroboratedHistoricalBaselines,
    original.corroboratedHistoricalBaselines - 1,
    'a future-start campaign is not historically corroborated at capture time')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.productionEnabled, false)
})

test('a matching archived catalog price cannot corroborate an ALREADY EXPIRED promotion', async () => {
  const batch = await reviewed()
  const original = review(batch)
  const banana = plusBanana(batch)
  const captured = Date.parse(banana.provenance.capturedAt)
  banana.offer.validFrom = instant(captured - 2 * day)
  banana.offer.validTo = instant(captured - hour)

  const report = review(batch)
  assert.equal(report.outOfWindowAtCapture, original.outOfWindowAtCapture + 1)
  assert.equal(report.corroboratedHistoricalBaselines,
    original.corroboratedHistoricalBaselines - 1,
    'an already expired campaign is not historically corroborated at capture time')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.productionEnabled, false)
})

test('inclusive start and end time boundaries preserve valid archive corroboration', async () => {
  const originalBatch = await reviewed()
  const original = review(originalBatch)
  for (const edge of ['start', 'end']) {
    const batch = await reviewed()
    const banana = plusBanana(batch)
    const captured = Date.parse(banana.provenance.capturedAt)
    banana.offer.validFrom = instant(captured - (edge === 'start' ? 0 : day))
    banana.offer.validTo = instant(captured + (edge === 'end' ? 0 : day))
    const report = review(batch)
    assert.equal(report.outOfWindowAtCapture, original.outOfWindowAtCapture, edge)
    assert.equal(report.corroboratedHistoricalBaselines,
      original.corroboratedHistoricalBaselines, edge)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(JSON.stringify(report),
      /https?:|sourceProductId|offerPriceCents|currentPriceCents|Zuivelmeester/i)
  }
})
