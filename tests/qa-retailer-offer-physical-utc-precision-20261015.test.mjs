import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewPrivateRetailerOffers } from '../scripts/qa-retailer-offer-baseline-corroboration.mjs'

// Only verified historic six-shape M1 fixture facts are loaded. Mutated dates
// are synthetic in-memory trust-boundary probes, NEVER real field evidence.
const asOf = '2026-10-15T00:00:00.000Z'
const reviewed = async () => structuredClone(await loadReviewedRepositoryFixtures())
const review = batch => reviewPrivateRetailerOffers(batch, { asOf })
const source = (batch, key) => {
  const row = batch.results.find(r => r.key === key)
  assert.ok(row)
  return row.observations
}
function replaceClock(batch, key, value) {
  for (const observation of source(batch, key)) observation.provenance.capturedAt = value
}
function offset(iso, hours) {
  const absolute = Date.parse(iso)
  return new Date(absolute + hours * 3_600_000).toISOString().replace(
    /Z$/, (hours < 0 ? '-' : '+') + String(Math.abs(hours)).padStart(2, '0') + ':00',
  )
}
function privateOnly(result) {
  assert.equal(result.mode, 'private-historical-retailer-offer-corroboration')
  assert.equal(result.sourceKinds, 6)
  assert.equal(result.needsHumanReview, true)
  assert.equal(result.historicalOnly, true)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(result), /113651|https?:|offerPriceCents|sourceProductId/i)
}

test('actual unchanged reviewed six-shape historical offer/canonical catalog control', async () => {
  const batch = await reviewed()
  const snapshot = structuredClone(batch)
  const report = review(batch)
  privateOnly(report)
  assert.ok(report.corroboratedHistoricalBaselines >= 1)
  assert.deepEqual(batch, snapshot)
})

test('equivalent positive UTC offset in historical PLUS catalog capture preserves same physical instant', async () => {
  const batch = await reviewed()
  const baseline = review(batch)
  const timestamp = source(batch, 'plus:catalog')[0].provenance.capturedAt
  replaceClock(batch, 'plus:catalog', offset(timestamp, 2))
  const expectedUntouched = structuredClone(batch)
  const report = review(batch)
  assert.deepEqual(report, baseline)
  privateOnly(report)
  assert.deepEqual(batch, expectedUntouched)
})

test('equivalent negative UTC offset in historical PLUS offer capture preserves corroboration', async () => {
  const batch = await reviewed()
  const baseline = review(batch)
  const timestamp = source(batch, 'plus:offers')[0].provenance.capturedAt
  replaceClock(batch, 'plus:offers', offset(timestamp, -2))
  const report = review(batch)
  assert.deepEqual(report, baseline)
  privateOnly(report)
})

test('nine-digit physical UTC fraction with trailing zeros is the exact same historical capture instant', async () => {
  const batch = await reviewed()
  const baseline = review(batch)
  const timestamp = source(batch, 'plus:catalog')[0].provenance.capturedAt
  replaceClock(batch, 'plus:catalog', timestamp.replace(/Z$/, '000000Z'))
  const report = review(batch)
  assert.deepEqual(report, baseline)
  privateOnly(report)
})

test('equivalent offset campaign window in DekaMarkt historical offers is not treated as unknown', async () => {
  const batch = await reviewed()
  const baseline = review(batch)
  for (const observation of source(batch, 'dekamarkt:offers')) {
    for (const key of ['validFrom', 'validTo']) {
      if (observation.offer?.[key] !== null) {
        observation.offer[key] = offset(observation.offer[key], 2)
      }
    }
  }
  const report = review(batch)
  assert.deepEqual(report, baseline)
  privateOnly(report)
})

test('a physical historical cross-channel gap of 24h plus 1ns must not corroborate a baseline', async () => {
  const batch = await reviewed()
  const baseline = review(batch)
  replaceClock(batch, 'plus:catalog', '2026-10-03T18:53:10.645000000Z')
  replaceClock(batch, 'plus:offers', '2026-10-04T18:53:10.645000001Z')
  const report = review(batch)
  assert.ok(report.staleCrossChannelCaptures > baseline.staleCrossChannelCaptures)
  assert.ok(report.corroboratedHistoricalBaselines < baseline.corroboratedHistoricalBaselines)
  privateOnly(report)
})

test('an audit source 1ns after as-of time must be refused, never rounded backwards', async () => {
  const batch = await reviewed()
  replaceClock(batch, 'plus:catalog', '2026-10-15T00:00:00.000000001Z')
  assert.throws(() => review(batch), /Private retailer offer corroboration QA refused/)
})
