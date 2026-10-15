import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewPrivateRetailerOffers, main } from '../scripts/qa-retailer-offer-baseline-corroboration.mjs'

const asOf = '2026-10-15T00:00:00.000Z'
const audit = batch => reviewPrivateRetailerOffers(batch, { asOf })
const denied = /Private retailer offer corroboration QA refused/

async function reviewed() {
  return structuredClone(await loadReviewedRepositoryFixtures())
}
function find(batch, channel, sku) {
  const result = batch.results.find(r => r.key === 'plus:' + channel)
  const observation = result?.observations.find(o => o.sourceProductId === sku)
  assert.ok(observation, 'expected original PLUS banana corroboration sample')
  return observation
}

test('real six M1 shapes reveal only aggregates and never a public historical discount claim', async () => {
  const batch = await reviewed()
  const before = structuredClone(batch)
  const result = audit(batch)
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.sourceKinds, 6)
  assert.equal(result.reviewedObservations, 16)
  assert.ok(result.observedOfferRows >= 2)
  assert.ok(result.priceBackedOfferRows >= 1)
  assert.ok(result.corroboratedHistoricalBaselines >= 1, 'PLUS catalog corroborates banana original price')
  assert.ok(result.unknownOfferWindows >= 1, 'PLUS has no justified promotion validity dates')
  assert.equal(result.historicalOnly, true)
  assert.equal(result.needsHumanReview, true)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.deepEqual(batch, before)
  assert.doesNotMatch(JSON.stringify(result), /Zuivelmeester|Bananen|https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|snapshotSha256/i)
})

test('real PLUS banana catalog baseline corroboration is broken by historical base cents mutation', async () => {
  const batch = await reviewed()
  const original = audit(batch)
  const catalog = find(batch, 'catalog', '113651')
  catalog.currentPriceCents += 77
  const report = audit(batch)
  assert.ok(report.conflictingCatalogBaselines > original.conflictingCatalogBaselines)
  assert.ok(report.corroboratedHistoricalBaselines < original.corroboratedHistoricalBaselines)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('identical SKU with incompatible recorded pack quantities never supports a saving', async () => {
  const batch = await reviewed()
  const original = audit(batch)
  find(batch, 'catalog', '113651').pack.amount += 1000
  const report = audit(batch)
  assert.ok(report.incomparablePackages > original.incomparablePackages)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('offer lacking a retailer-scoped catalog baseline is unresolved, never a guessed saving', async () => {
  const batch = await reviewed()
  const original = audit(batch)
  find(batch, 'offers', '113651').sourceProductId = 'fictional_unlisted_banana'
  const report = audit(batch)
  assert.ok(report.missingCatalogBaselines > original.missingCatalogBaselines)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('two physically captured normal and promotional prices outside 24-hour window cannot corroborate', async () => {
  const batch = await reviewed()
  const original = audit(batch)
  for (const row of batch.results.find(r => r.key === 'plus:catalog').observations) {
    row.provenance.capturedAt = '2026-09-01T12:00:00.000Z'
  }
  const report = audit(batch)
  assert.ok(report.staleCrossChannelCaptures > original.staleCrossChannelCaptures)
  assert.equal(report.captureWindowHours, 24)
})

test('no real discount: synthetic offer original price below current counts as invalid not verified', async () => {
  const batch = await reviewed()
  const original = audit(batch)
  find(batch, 'offers', '113651').offer.originalPriceCents = 90
  const report = audit(batch)
  assert.ok(report.invalidDiscountClaims > original.invalidDiscountClaims)
  assert.ok(report.priceBackedOfferRows < original.priceBackedOfferRows)
})

test('a partial historical promotion with a plausible upcoming end remains unknown, never publishable', async () => {
  const batch = await reviewed()
  find(batch, 'offers', '113651').offer.validTo = '2026-10-20T00:00:00.000Z'
  const report = audit(batch)
  assert.ok(report.unknownOfferWindows >= 1)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
})

test('a listed offer cannot silently disagree with its own observed current price', async () => {
  const batch = await reviewed()
  find(batch, 'offers', '113651').offer.offerPriceCents = 98
  assert.throws(() => audit(batch), denied)
})

test('forged retailer permission, counters, impossible offer dates or futures fail closed', async t => {
  const variants = [
    ['production', b => { b.summary.productionEnabled = true }],
    ['permission', b => { b.summary.permissionVerified = true }],
    ['claim', b => { b.summary.publicSavingsClaimEligible = true }],
    ['source counter', b => { b.summary.sources = 7 }],
    ['retailer counter', b => { b.summary.retailerCounts.plus += 1 }],
    ['future source', b => { find(b, 'catalog', '113651').provenance.capturedAt = '2035-01-01T00:00:00.000Z' }],
    ['invalid calendar offer', b => { find(b, 'offers', '113651').offer.validFrom = '2026-02-30T00:00:00.000Z' }],
    ['future offer', b => { find(b, 'offers', '113651').offer.validTo = '2035-01-01T00:00:00.000Z' }],
    ['credentialed source URL', b => { find(b, 'offers', '113651').provenance.url = 'https://secret:password@www.plus.nl/aanbiedingen' }],
    ['unsafe integer', b => { find(b, 'offers', '113651').currentPriceCents = Number.MAX_SAFE_INTEGER + 1 }],
  ]
  for (const [label, mutation] of variants) {
    await t.test(label, async () => {
      const batch = await reviewed()
      mutation(batch)
      assert.throws(() => audit(batch), denied)
    })
  }
})

test('command-line review reads only bundled reviewed fixtures, emits no retailer values', async () => {
  const chunks = []
  const result = await main([], value => chunks.push(value))
  assert.deepEqual(JSON.parse(chunks.join('')), result)
  assert.doesNotMatch(chunks.join(''), /https?:\/\/|113651|Bananen|price_cents|sourceProductId|offerPriceCents/i)
  await assert.rejects(() => main(['--url', 'https://www.plus.nl'], () => {}), denied)
  const file = new URL('../scripts/qa-retailer-offer-baseline-corroboration.mjs', import.meta.url).pathname
  const cmd = spawnSync(process.execPath, ['--experimental-strip-types', file], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 65536,
  })
  assert.equal(cmd.status, 0, cmd.stderr)
  assert.deepEqual(JSON.parse(cmd.stdout), result)
})
