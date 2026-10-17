import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Fictional saved Product JSON-LD only, no retailer contact/actual prices.
const at = '2026-10-15T09:00:00Z'
const nowMs = Date.parse('2026-10-15T10:00:00Z')
const source = (shop) => SOURCES.find((s) => s.id === shop + '-product-halfvolle-melk')
function refOffer(price, value, unitCode) {
  return {
    '@type': 'Offer', availability: 'https://schema.org/InStock',
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price, priceCurrency: 'EUR',
      referenceQuantity: { '@type': 'QuantitativeValue', value, unitCode },
    },
  }
}
function checkoutOffer(price) {
  return {
    '@type': 'Offer', price, priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  }
}
function observed(shop, pack, offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    sku: 'synthetic-multipack', name: 'Halfvolle melk',
    weight: { '@type': 'QuantitativeValue', value: pack }, offers,
  }) + '</script>'
  const snap = parseOfflineRetailerSnapshot({
    source: source(shop), html, capturedAt: at,
  })
  assert.equal(snap.observations.length, 1)
  return snap.observations[0]
}
function comparison(candidate) {
  return compareReviewedCatalogs({
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [
      observed('plus', '2 x 500 ml', checkoutOffer('1.89')),
      candidate,
    ],
    nowMs,
  })
}
test('reference for one inner carton cannot price an entire 2 x 500ml bundle', () => {
  const deka = observed('dekamarkt', '2 x 500 ml',
    refOffer('0.89', 500, 'MLT'))
  assert.equal(deka.currentPriceCents, null)
  const result = comparison(deka)
  assert.equal(result.comparable, false)
  assert.equal(result.stores.dekamarkt.complete, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
})
test('matching complete 1000MLT reference prices the whole bundle, not inner cartons', () => {
  const deka = observed('dekamarkt', '2 x 500 ml',
    refOffer('1.78', 1000, 'MLT'))
  assert.equal(deka.currentPriceCents, 178)
  assert.equal(deka.pack.rawText, '2 x 500 ml')
  assert.equal(deka.pack.amount, 500)
  const r = comparison(deka)
  // Each 2 x 500ml retail bundle contains 1L, requiring two bundles for 1.5L.
  assert.equal(r.comparable, true)
  assert.equal(r.stores.plus.subtotalCents, 378)
  assert.equal(r.stores.dekamarkt.subtotalCents, 356)
  assert.equal(r.savingsCents, 22)
  assert.equal(r.cheaperStore, 'dekamarkt')
  assert.equal(r.claimable, false)
})
test('equivalent 1LTR reference quantity also prices exact 2 x 500ml SKU', () => {
  const deka = observed('dekamarkt', '2 × 500 ml',
    refOffer('1.78', 1, 'LTR'))
  assert.equal(deka.currentPriceCents, 178)
  const r = comparison(deka)
  assert.equal(r.comparable, true)
  assert.equal(r.savingsCents, 22)
})
test('mass or underfilled-reference rates never become multipack volume checkout', () => {
  for (const [value, unit] of [[1,'KGM'],[1500,'MLT'],[0.5,'LTR']]) {
    const row = observed('dekamarkt', '2 x 500 ml',
      refOffer('0.89', value, unit))
    assert.equal(row.currentPriceCents, null)
    assert.equal(comparison(row).comparable, false)
  }
})
test('genuine single 1000ml SKU exact reference pricing remains intact', () => {
  const row = observed('dekamarkt', '1000 ml',
    refOffer('0.85', 1000, 'MLT'))
  assert.equal(row.currentPriceCents, 85)
})
