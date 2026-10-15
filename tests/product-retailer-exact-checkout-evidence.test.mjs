import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Entirely synthetic fixtures. No retailer HTTP, scraped/live prices or claimable savings.
const capturedAt = '2026-10-15T09:00:00.000Z'
const nowMs = Date.parse('2026-10-15T10:00:00.000Z')
const source = (store) => SOURCES.find((s) => s.id === store + '-product-halfvolle-melk')
const exactOffer = (price) => ({
  '@type': 'Offer', price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
const localSnapshot = (store, offer) => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product', sku: 'synthetic-milk-1000', name: 'Halfvolle melk',
    weight: { value: '1000 ml' }, offers: offer,
  }) + '</script>'
  return parseOfflineRetailerSnapshot({
    source: source(store), html, capturedAt,
  })
}
const comparison = (candidateOffer) => compareReviewedCatalogs({
  requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
  observations: [
    ...localSnapshot('plus', exactOffer('1.29')).observations,
    ...localSnapshot('dekamarkt', candidateOffer).observations,
  ],
  nowMs,
})
const expectUnknown = (offer) => {
  const r = comparison(offer)
  assert.equal(r.claimable, false)
  assert.equal(r.comparable, false)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.savingsCents, null)
  assert.equal(r.lines[0].dekamarkt.totalCents, null)
}
test('a concrete Offer retains exact two-package cent arithmetic', () => {
  const r = comparison(exactOffer('1.19'))
  assert.equal(r.comparable, true)
  assert.equal(r.stores.plus.subtotalCents, 258)
  assert.equal(r.stores.dekamarkt.subtotalCents, 238)
  assert.equal(r.savingsCents, 20)
  assert.equal(r.claimable, false)
})
test('AggregateOffer minima never become checkout pack prices', () => {
  for (const offer of [
    { '@type': 'AggregateOffer', lowPrice: '0.20', highPrice: '2.59', offerCount: 8 },
    { '@type': 'AggregateOffer', lowPrice: '0.20', offerCount: 8 },
    { '@type': ['AggregateOffer', 'Offer'], price: '0.20', highPrice: '2.59' },
  ]) {
    const candidate = {
      ...offer, priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
    }
    expectUnknown(candidate)
    const snapshot = localSnapshot('dekamarkt', candidate)
    assert.ok(snapshot.observations.every((product) =>
      product.currentPriceCents === null), 'No fixed pack price should be emitted')
  }
})
test('UnitPriceSpecification reference kilograms never become a 1-liter pack price', () => {
  for (const specification of [
    { '@type': 'UnitPriceSpecification', price: '0.99',
      referenceQuantity: { value: 1, unitCode: 'KGM' } },
    { '@type': 'PriceSpecification', price: '0.99',
      referenceQuantity: { value: 1, unitCode: 'LTR' } },
    { '@type': 'UnitPriceSpecification', price: '0.99' },
  ]) {
    expectUnknown({
      '@type': 'Offer', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      priceSpecification: { ...specification, priceCurrency: 'EUR' },
    })
  }
})
test('a concrete checkout Offer.price remains valid when a unit-reference price is not for this pack', () => {
  const candidate = {
    ...exactOffer('1.19'),
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '0.99', priceCurrency: 'EUR',
      referenceQuantity: { value: 500, unitCode: 'MLT' },
    },
  }
  const r = comparison(candidate)
  assert.equal(r.comparable, true)
  assert.equal(r.stores.dekamarkt.subtotalCents, 238)
  assert.equal(r.claimable, false)
})
test('two contradictory exact checkout prices for the same physical pack must withhold savings', () => {
  const candidate = {
    ...exactOffer('1.19'),
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '0.99', priceCurrency: 'EUR',
      referenceQuantity: { value: 1, unitCode: 'LTR' },
    },
  }
  expectUnknown(candidate)
})
test('one exact generic PriceSpecification is supported without referenceQuantity', () => {
  const offer = {
    '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    priceSpecification: { '@type': 'PriceSpecification', price: '1.19',
      priceCurrency: 'EUR' },
  }
  const r = comparison(offer)
  assert.equal(r.comparable, true)
  assert.equal(r.stores.dekamarkt.subtotalCents, 238)
})
test('priceSpecification.lowPrice without a fixed price is not trusted', () => {
  expectUnknown({
    '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    priceSpecification: { '@type': 'PriceSpecification', lowPrice: '0.10',
      priceCurrency: 'EUR' },
  })
})
