import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent quality-validation on the frozen product owner catalog API.
// All prices/offers below are SYNTHETIC, locally constructed, historical and
// nonpublishable. The real archived PLUS observation supplies only a valid
// reviewed adapter/provenance shape; no retailer network access occurs.
//
// Distinct from price-at-capture corroboration: this probes the *raw offer
// validity interval* accepted by the exported universal catalog itself.
// Date.parse rounds fractional seconds to milliseconds and normalizes some
// impossible civil dates. Neither may establish a trustworthy offer window.
async function syntheticOfferBatch(validFrom, validTo) {
  const archived = await loadReviewedRepositoryFixtures()
  const source = structuredClone(archived.results.find(row => row.key === 'plus:product'))
  assert.ok(source, 'a real historical PLUS product fixture must exist')
  source.observations = [structuredClone(source.observations[0])]
  source.observations[0].offer = {
    label: 'QA-only fictional historical offer; not a retailer price',
    mechanics: null,
    offerPriceCents: 125,
    originalPriceCents: 150,
    validFrom,
    validTo,
  }
  return { summary: { mode: 'reviewed-offline-only' }, results: [source] }
}

function assertPrivateOnly(catalog) {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.ok(catalog.products.length > 0)
  for (const product of catalog.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.selectedSnapshotSha256, null)
  }
}

const invalidOffer = /offer|valid|calendar|timestamp|refus|untrusted|window/i

test('control: a real archived PLUS adapter accepts a valid fictional 1ns offer interval privately', async () => {
  const input = await syntheticOfferBatch(
    '2026-10-14T12:00:00.000000001+02:00',
    '2026-10-14T10:00:00.000000002Z',
  )
  const before = structuredClone(input)
  const catalog = buildUniversalRetailerCatalog(input)
  assertPrivateOnly(catalog)
  assert.deepEqual(input, before, 'QA catalog must not mutate reviewed source material')
  const capture = catalog.products.flatMap(p => p.captures)
    .find(c => c.offer?.label === 'QA-only fictional historical offer; not a retailer price')
  assert.ok(capture)
  assert.equal(capture.offer.validFrom, '2026-10-14T12:00:00.000000001+02:00')
  assert.equal(capture.offer.validTo, '2026-10-14T10:00:00.000000002Z')
})

test('raw offer interval must reject same-millisecond end 1ns before start [EXPECTED RED]', async () => {
  const batch = await syntheticOfferBatch(
    '2026-10-14T10:00:00.000000002Z',
    '2026-10-14T10:00:00.000000001Z',
  )
  assert.throws(() => buildUniversalRetailerCatalog(batch), invalidOffer)
})

test('raw offer interval must reject physical reversal across UTC offsets [EXPECTED RED]', async () => {
  const batch = await syntheticOfferBatch(
    '2026-10-14T12:00:00.000000002+02:00',
    '2026-10-14T10:00:00.000000001Z',
  )
  assert.throws(() => buildUniversalRetailerCatalog(batch), invalidOffer)
})

test('raw offer start must reject impossible non-leap Gregorian February 29 [EXPECTED RED]', async () => {
  const batch = await syntheticOfferBatch(
    '2025-02-29T10:00:00Z',
    '2026-10-14T10:00:00Z',
  )
  assert.throws(() => buildUniversalRetailerCatalog(batch), invalidOffer)
})

test('raw offer end must reject normalized February 30 [EXPECTED RED]', async () => {
  const batch = await syntheticOfferBatch(
    '2026-02-28T10:00:00Z',
    '2026-02-30T10:00:00Z',
  )
  assert.throws(() => buildUniversalRetailerCatalog(batch), invalidOffer)
})
