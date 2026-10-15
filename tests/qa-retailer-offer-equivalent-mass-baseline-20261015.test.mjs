import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewPrivateRetailerOffers } from '../scripts/qa-retailer-offer-baseline-corroboration.mjs'

// Independent, offline, historical PLUS banana catalog/offer contract.
// A kilogram and 1000 grams are the same physical pack, not different
// products; a genuinely different amount must remain incomparable.
// No live retailer traffic or source-rights/public-savings promotion.
const asOf = '2026-10-15T00:00:00.000Z'
const review = batch => reviewPrivateRetailerOffers(batch, { asOf })
const reviewed = async () => structuredClone(await loadReviewedRepositoryFixtures())

function banana(batch, kind) {
  const row = batch.results.find(result => result.key === 'plus:' + kind)
  const observation = row?.observations.find(value => value.sourceProductId === '113651')
  assert.ok(observation, 'expected the genuine reviewed PLUS banana source fact')
  return observation
}

function neverPublic(report) {
  assert.equal(report.sourceKinds, 6)
  assert.equal(report.historicalOnly, true)
  assert.equal(report.needsHumanReview, true)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(report),
    /113651|Bananen|https?:|sourceProductId|currentPriceCents|offerPriceCents/i)
}

test('historical control: matching original gram facts corroborate only the private baseline', async () => {
  const batch = await reviewed()
  const before = structuredClone(batch)
  const report = review(batch)
  assert.ok(report.corroboratedHistoricalBaselines >= 1)
  assert.ok(report.unknownOfferWindows >= 1)
  neverPublic(report)
  assert.deepEqual(batch, before, 'quality assessment must not mutate retailer evidence')
})

test('equivalent 1 kg catalog versus 1000 g offer must corroborate the same baseline', async () => {
  const batch = await reviewed()
  const original = review(batch)
  const catalog = banana(batch, 'catalog')
  assert.equal(catalog.pack.unit, 'g')
  assert.equal(catalog.pack.amount, 1000)
  catalog.pack = { rawText: '1 kg', amount: 1, unit: 'kg' }
  const before = structuredClone(batch)
  const report = review(batch)

  assert.equal(report.corroboratedHistoricalBaselines,
    original.corroboratedHistoricalBaselines,
    'the physical package is unchanged despite a different valid mass unit')
  assert.equal(report.incomparablePackages, original.incomparablePackages,
    'exactly equivalent units must not produce a false pack mismatch')
  neverPublic(report)
  assert.deepEqual(batch, before)
})

test('equivalent 1000 g catalog versus 1 kg offer must be symmetric', async () => {
  const batch = await reviewed()
  const original = review(batch)
  const offer = banana(batch, 'offers')
  assert.equal(offer.pack.unit, 'g')
  assert.equal(offer.pack.amount, 1000)
  offer.pack = { rawText: '1 kg', amount: 1, unit: 'kg' }
  const report = review(batch)

  assert.equal(report.corroboratedHistoricalBaselines,
    original.corroboratedHistoricalBaselines)
  assert.equal(report.incomparablePackages, original.incomparablePackages)
  neverPublic(report)
})

test('genuinely different 900 g versus 1000 g cannot corroborate an offer baseline', async () => {
  const batch = await reviewed()
  const original = review(batch)
  banana(batch, 'catalog').pack = { rawText: '900 g', amount: 900, unit: 'g' }
  const report = review(batch)
  assert.ok(report.incomparablePackages > original.incomparablePackages)
  assert.ok(report.corroboratedHistoricalBaselines < original.corroboratedHistoricalBaselines)
  neverPublic(report)
})

test('different physical amount even with kg conversion remains incomparable', async () => {
  const batch = await reviewed()
  const original = review(batch)
  banana(batch, 'catalog').pack = { rawText: '0.9 kg', amount: 0.9, unit: 'kg' }
  const report = review(batch)
  assert.ok(report.incomparablePackages > original.incomparablePackages)
  assert.ok(report.corroboratedHistoricalBaselines < original.corroboratedHistoricalBaselines)
  neverPublic(report)
})

test('matching physical number alone cannot join mass and volume evidence', async () => {
  const batch = await reviewed()
  const original = review(batch)
  // Intentionally synthetic invalid *equivalence*, not a retailer product fact.
  banana(batch, 'catalog').pack = { rawText: '1000 ml', amount: 1000, unit: 'ml' }
  const report = review(batch)
  assert.ok(report.incomparablePackages > original.incomparablePackages)
  assert.ok(report.corroboratedHistoricalBaselines < original.corroboratedHistoricalBaselines)
  neverPublic(report)
})

test('synthetic milk offer: 1 l and 1000 ml must corroborate identically', async () => {
  const batch = await reviewed()
  const catalog = batch.results.find(r => r.key === 'dekamarkt:catalog')
    .observations.find(o => o.sourceProductId === '115873')
  const offer = batch.results.find(r => r.key === 'dekamarkt:offers').observations[0]
  assert.ok(catalog && offer)
  // In-memory contract-only counterfactual on genuine archived shapes. The
  // following imagined milk discount is NOT an observed retailer offer or
  // evidence of real-world savings; source data on disk stays unchanged.
  offer.sourceProductId = catalog.sourceProductId
  offer.name = catalog.name
  offer.currentPriceCents = catalog.currentPriceCents - 1
  offer.offer = {
    label: 'synthetic unit comparison only', mechanics: null,
    offerPriceCents: catalog.currentPriceCents - 1,
    originalPriceCents: catalog.currentPriceCents,
    validFrom: null, validTo: null,
  }
  offer.pack = { rawText: '1 l', amount: 1, unit: 'l' }
  const baseline = review(batch)
  assert.ok(baseline.corroboratedHistoricalBaselines >= 1)
  offer.pack = { rawText: '1000 ml', amount: 1000, unit: 'ml' }
  const report = review(batch)
  assert.equal(report.corroboratedHistoricalBaselines,
    baseline.corroboratedHistoricalBaselines,
    'same liters, retailer, product and baseline cannot become incomparable')
  assert.equal(report.incomparablePackages, baseline.incomparablePackages)
  neverPublic(report)
})
