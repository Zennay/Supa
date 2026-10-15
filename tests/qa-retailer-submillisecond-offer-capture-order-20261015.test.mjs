import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA 2/2: entirely fictional Product JSON-LD and offline comparison.
// ISO 8601 9-digit seconds here are intentional: JS Date.parse loses 1-999999 ns.
const capturedAt = '2026-10-15T09:00:00.000000000Z'
const nowMs = Date.parse('2026-10-15T10:00:00Z')
const source = (shop) => SOURCES.find((s) => s.id === shop + '-product-halfvolle-melk')
const offer = (price, validFrom) => ({
  '@type': 'Offer',
  price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  validFrom, priceValidUntil: '2026-10-16T00:00:00Z',
})
const nested = (validFrom) => ({
  '@type': 'Offer',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  priceSpecification: {
    '@type': 'PriceSpecification', price: '1.19',
    priceCurrency: 'EUR', validFrom,
    validThrough: '2026-10-16T00:00:00Z',
  },
})
function capture(shop, offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', '@context': 'https://schema.org',
    sku: 'fictional-nanosecond-milk', name: 'Halfvolle melk',
    weight: { value: '1000 ml' }, offers,
  }) + '</script>'
  return parseOfflineRetailerSnapshot({
    source: source(shop), html, capturedAt,
  })
}
function basket(candidate) {
  const plus = capture('plus', offer('1.29', '2026-10-14T00:00:00Z'))
  const deka = capture('dekamarkt', candidate)
  const result = compareReviewedCatalogs({
    nowMs,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [...plus.observations, ...deka.observations],
  })
  return { deka, result }
}
function expectComparable(candidate) {
  const { deka, result } = basket(candidate)
  assert.equal(deka.observations.length, 1)
  assert.equal(deka.observations[0].currentPriceCents, 119)
  assert.equal(result.comparable, true)
  assert.equal(result.stores.plus.subtotalCents, 258)
  assert.equal(result.stores.dekamarkt.subtotalCents, 238)
  assert.equal(result.savingsCents, 20)
  assert.equal(result.claimable, false)
}
function expectNotProvenAtCapture(candidate) {
  const { deka, result } = basket(candidate)
  assert.ok(deka.observations.every((o) => o.currentPriceCents === null),
    'An Offer not yet valid at the exact 9-digit capture time cannot prove checkout cents')
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
}
test('positive: Offer validFrom exactly equals nanosecond capture instant', () => {
  expectComparable(offer('1.19', '2026-10-15T09:00:00.000000000Z'))
})
test('positive: Offer validFrom 1 nanosecond before capture is valid', () => {
  expectComparable(offer('1.19', '2026-10-15T08:59:59.999999999Z'))
})
test('positive: nested PriceSpecification starting exactly at capture remains valid', () => {
  expectComparable(nested('2026-10-15T09:00:00.000000000Z'))
})
test('positive: same-millisecond earlier millisecond is valid checkout evidence', () => {
  expectComparable(offer('1.19', '2026-10-15T08:59:59.999Z'))
})
test('EXPECTED RED: Offer future +1 nanosecond in the same ms is not observed checkout evidence', () => {
  expectNotProvenAtCapture(offer('1.19', '2026-10-15T09:00:00.000000001Z'))
})
test('EXPECTED RED: Offer future +1 microsecond in the same ms is not observed checkout evidence', () => {
  expectNotProvenAtCapture(offer('1.19', '2026-10-15T09:00:00.000001000Z'))
})
test('EXPECTED RED: Offer future +999999 nanoseconds within same ms is not observed checkout evidence', () => {
  expectNotProvenAtCapture(offer('1.19', '2026-10-15T09:00:00.000999999Z'))
})
test('EXPECTED RED: nested PriceSpecification start +1ns cannot mint current exact checkout cents', () => {
  expectNotProvenAtCapture(nested('2026-10-15T09:00:00.000000001Z'))
})
test('EXPECTED RED: nested PriceSpecification start +1us cannot mint current exact checkout cents', () => {
  expectNotProvenAtCapture(nested('2026-10-15T09:00:00.000001000Z'))
})
