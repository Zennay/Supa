import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Owner tests are separate from the independent immutable QA #3203.
async function historicalPlusProduct() {
  const batch = await loadReviewedRepositoryFixtures()
  const result = structuredClone(batch.results.find(row => row.key === 'plus:product'))
  assert.ok(result?.accepted && result.observations.length)
  result.observations = [structuredClone(result.observations[0])]
  return result
}
const group = (...results) => ({
  summary: { mode: 'reviewed-offline-only' }, results,
})
const reversed = object => Object.fromEntries(Object.entries(object).reverse())
const assertPrivate = c => {
  assert.equal(c.status, 'private-review-only')
  assert.equal(c.productionEnabled, false)
  assert.equal(c.publicSavingsClaimEligible, false)
  for (const product of c.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
  }
}

test('same historic physical event and identical pack facts deduplicate regardless of own-key order', async () => {
  const first = await historicalPlusProduct()
  const next = structuredClone(first)
  next.observations[0].pack = reversed(next.observations[0].pack)
  const original = structuredClone(group(first, next))
  assert.deepEqual(next.observations[0].pack, first.observations[0].pack)
  const catalog = buildUniversalRetailerCatalog(group(first, next))
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.captureCount, 1)
  assert.equal(catalog.productCount, 1)
  assert.equal(catalog.conflictCount, 0)
  assert.equal(catalog.products[0].consistency, 'consistent')
  assert.deepEqual(group(first, next), original)
  assertPrivate(catalog)
})

test('synthetic valid offer with same fields but reordered own keys remains single private event', async () => {
  const first = await historicalPlusProduct()
  first.observations[0].offer = {
    label: 'Synthetic historic offer (NOT market price)',
    mechanics: null,
    offerPriceCents: 125,
    originalPriceCents: 155,
    validFrom: '2026-10-10',
    validTo: '2026-10-15',
  }
  const next = structuredClone(first)
  next.observations[0].offer = reversed(next.observations[0].offer)
  next.observations[0].pack = reversed(next.observations[0].pack)
  const output = buildUniversalRetailerCatalog(group(first, next))
  assert.equal(output.sourceCount, 2)
  assert.equal(output.captureCount, 1)
  assert.equal(output.conflictCount, 0)
  assertPrivate(output)
})

test('real price, stock, pack, and offer-fact changes are not silenced by canonical signature', async () => {
  const root = await historicalPlusProduct()
  const mutations = [
    row => { row.currentPriceCents += 1 },
    row => { row.availability = row.availability === 'available' ? 'unknown' : 'available' },
    row => { row.pack.amount = (row.pack.amount ?? 1) + 1 },
    row => { row.offer = {
      label: 'Synthetic historic offer, requires review',
      mechanics: null, offerPriceCents: 125,
      originalPriceCents: 150,
      validFrom: '2026-10-01',
      validTo: '2026-10-02',
    } },
  ]
  for (const mutate of mutations) {
    const second = structuredClone(root)
    mutate(second.observations[0])
    second.observations[0].pack = reversed(second.observations[0].pack)
    const output = buildUniversalRetailerCatalog(group(root, second))
    assert.equal(output.captureCount, 2)
    assert.equal(output.conflictCount, 1)
    assert.equal(output.products[0].consistency, 'review-required')
    assertPrivate(output)
  }
})

test('same values but different SHA or capture time stay independent provenance events', async () => {
  const row = await historicalPlusProduct()
  for (const mutate of [
    second => { second.provenance.sha256 = 'b'.repeat(64) },
    second => { second.provenance.capturedAt = '2026-10-14T11:00:00Z' },
    second => { second.provenance.url = 'https://www.plus.nl/producten/second-historical-page' },
  ]) {
    const second = structuredClone(row)
    mutate(second.observations[0])
    const output = buildUniversalRetailerCatalog(group(row, {
      ...row, observations: [second.observations[0]],
    }))
    assert.equal(output.captureCount, 2)
    assert.equal(output.conflictCount, 0)
    assertPrivate(output)
  }
})

test('canonical signature never merges one-store identity into another retailer', async () => {
  const all = await loadReviewedRepositoryFixtures()
  const plus = structuredClone(all.results.find(r => r.key === 'plus:product'))
  const deka = structuredClone(all.results.find(r => r.key === 'dekamarkt:product'))
  assert.ok(plus && deka)
  plus.observations = [plus.observations[0]]
  deka.observations = [deka.observations[0]]
  deka.observations[0].sourceProductId = plus.observations[0].sourceProductId
  deka.observations[0].pack = reversed(deka.observations[0].pack)
  const output = buildUniversalRetailerCatalog(group(plus, deka))
  assert.equal(output.productCount, 2)
  assert.ok(output.products.some(x => x.canonicalKey.startsWith('plus:')))
  assert.ok(output.products.some(x => x.canonicalKey.startsWith('dekamarkt:')))
  assert.equal(output.conflictCount, 0)
  assertPrivate(output)
})
