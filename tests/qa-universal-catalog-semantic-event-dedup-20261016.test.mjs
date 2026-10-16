import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent QA-only test of semantically identical *in-memory* archived
// captures. JS object property insertion order is not a retailer price,
// packaging or availability fact and must not turn one source event into two.
//
// This file does not change source adapters, actual M1 captures, permissions,
// retailer requests or public savings. The extra offer below is fictional.
const batchOf = (...results) => ({
  summary: { mode: 'reviewed-offline-only' },
  results,
})

async function oneReviewedProduct() {
  const archived = await loadReviewedRepositoryFixtures()
  const row = structuredClone(archived.results.find(result => result.key === 'plus:product'))
  assert.ok(row?.accepted === true, 'expected historical reviewed PLUS product')
  assert.ok(row.observations.length > 0)
  row.observations = [structuredClone(row.observations[0])]
  return row
}

function assertPrivateOnly(catalog) {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  for (const product of catalog.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
  }
}

function reverseOwnKeys(value) {
  return Object.fromEntries(Object.entries(value).reverse())
}

test('control: byte-identical historical captures are deduplicated without publishing', async () => {
  const row = await oneReviewedProduct()
  const catalog = buildUniversalRetailerCatalog(batchOf(row, structuredClone(row)))
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.productCount, 1)
  assert.equal(catalog.captureCount, 1)
  assert.equal(catalog.conflictCount, 0)
  assert.equal(catalog.products[0].consistency, 'consistent')
  assertPrivateOnly(catalog)
})

test('changing only pack own-key insertion order cannot invent a conflicting event [EXPECTED RED]', async () => {
  const original = await oneReviewedProduct()
  const reordered = structuredClone(original)
  const item = reordered.observations[0]
  item.pack = reverseOwnKeys(item.pack)
  assert.deepEqual(item.pack, original.observations[0].pack,
    'pack values must be byte-for-byte semantically equivalent')
  const before = structuredClone(batchOf(original, reordered))
  const catalog = buildUniversalRetailerCatalog(batchOf(original, reordered))
  assert.deepEqual(batchOf(original, reordered), before, 'do not mutate caller captures')
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.captureCount, 1, 'same SHA, URL, clock, source kind and pack facts = one event')
  assert.equal(catalog.conflictCount, 0)
  assert.equal(catalog.products[0].consistency, 'consistent')
  assertPrivateOnly(catalog)
})

test('changing only synthetic offer own-key order cannot create a false price conflict [EXPECTED RED]', async () => {
  const original = await oneReviewedProduct()
  original.observations[0].offer = {
    label: 'Fictional QA-only offer',
    mechanics: null,
    offerPriceCents: 125,
    originalPriceCents: 150,
    validFrom: '2026-10-01T00:00:00Z',
    validTo: '2026-10-15T23:00:00Z',
  }
  const reordered = structuredClone(original)
  reordered.observations[0].offer =
    reverseOwnKeys(reordered.observations[0].offer)
  assert.deepEqual(reordered.observations[0].offer, original.observations[0].offer)
  const catalog = buildUniversalRetailerCatalog(batchOf(original, reordered))
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.captureCount, 1, 'same true source event must be idempotent')
  assert.equal(catalog.conflictCount, 0, 'property ordering is not an offer disagreement')
  assert.equal(catalog.products[0].consistency, 'consistent')
  assertPrivateOnly(catalog)
})

test('control: real synthetic cent disagreement within one SHA event remains review-required', async () => {
  const original = await oneReviewedProduct()
  const altered = structuredClone(original)
  const price = altered.observations[0].currentPriceCents
  altered.observations[0].currentPriceCents = Number.isSafeInteger(price) ? price + 1 : 1
  const catalog = buildUniversalRetailerCatalog(batchOf(original, altered))
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.captureCount, 2)
  assert.equal(catalog.conflictCount, 1)
  assert.equal(catalog.products[0].consistency, 'review-required')
  assertPrivateOnly(catalog)
})
