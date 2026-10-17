import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA 2/2: only invented Product JSON-LD, no supermarket network.
// A reference price can equal a checkout price only for the whole physical SKU.
const capturedAt = '2026-10-15T09:00:00Z'
const nowMs = Date.parse('2026-10-15T10:00:00Z')
const source = (store) => SOURCES.find((entry) =>
  entry.id === store + '-product-halfvolle-melk')
const ref = (cents, value, unitCode) => ({
  '@type': 'Offer', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  priceSpecification: {
    '@type': 'UnitPriceSpecification',
    price: (cents / 100).toFixed(2), priceCurrency: 'EUR',
    referenceQuantity: { value, unitCode },
  },
})
const exact = (price) => ({
  '@type': 'Offer', price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
function capture(store, name, pack, offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', '@context': 'https://schema.org',
    name, sku: 'synthetic-multipack-qa',
    weight: { value: pack }, offers,
  }) + '</script>'
  const result = parseOfflineRetailerSnapshot({ source: source(store), html, capturedAt })
  assert.equal(result.observations.length, 1)
  return result.observations[0]
}
test('three inner 200g packs allow exact 600GRM full checkout reference', () => {
  const item = capture('dekamarkt', 'Kipfilet', '3 × 200 g', ref(199, 600, 'GRM'))
  assert.equal(item.currentPriceCents, 199)
  assert.equal(item.pack.amount, 200)
  assert.equal(item.pack.unit, 'g')
  assert.equal(item.pack.rawText, '3 × 200 g')
})
test('whole 600g multipack has equivalent 0.6 KGM reference quantity', () => {
  const item = capture('dekamarkt', 'Kipfilet', '3 x 200 g', ref(199, 0.6, 'KGM'))
  assert.equal(item.currentPriceCents, 199)
})
test('one 200g inner price must not become price of three 200g packs', () => {
  const item = capture('dekamarkt', 'Kipfilet', '3 x 200 g', ref(79, 200, 'GRM'))
  assert.equal(item.currentPriceCents, null)
  assert.equal(item.offer, null)
})
test('partial 400g reference must not price whole 600g three-pack', () => {
  const item = capture('dekamarkt', 'Kipfilet', '3 x 200 g', ref(129, 400, 'GRM'))
  assert.equal(item.currentPriceCents, null)
})
test('wrong mass/volume family cannot become a pack checkout price', () => {
  const item = capture('dekamarkt', 'Kipfilet', '3 x 200 g', ref(99, 0.6, 'LTR'))
  assert.equal(item.currentPriceCents, null)
})
test('positive volume multipack preserves physical bundle arithmetic (not three inner items)', () => {
  const observations = [
    capture('plus', 'Halfvolle melk', '2 x 500 ml', exact('1.89')),
    capture('dekamarkt', 'Halfvolle melk', '2 x 500 ml', ref(178, 1, 'LTR')),
  ]
  const result = compareReviewedCatalogs({
    observations, nowMs,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 2500, unit: 'ml' }],
  })
  assert.equal(result.comparable, true)
  assert.equal(result.lines[0].plus.packs, 3)
  assert.equal(result.lines[0].dekamarkt.packs, 3)
  assert.equal(result.stores.plus.subtotalCents, 567)
  assert.equal(result.stores.dekamarkt.subtotalCents, 534)
  assert.equal(result.savingsCents, 33)
  assert.equal(result.claimable, false)
})
test('positive exact 1L single SKU reference still remains a checkout pack price', () => {
  const item = capture('dekamarkt', 'Halfvolle melk', '1000 ml', ref(85, 1000, 'MLT'))
  assert.equal(item.currentPriceCents, 85)
})
