import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA 2/2: fictional offers, fixed timestamps, local HTML only.
// No retailer requests, licences, price claims, or product/source changes.
const capturedAt = '2026-10-15T09:00:00Z'
const nowMs = Date.parse('2026-10-15T10:00:00Z')
const source = (shop) => SOURCES.find((s) => s.id === shop + '-product-halfvolle-melk')
const quote = (price, dates = {}) => ({
  '@type': 'Offer', price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock', ...dates,
})
function capture(shop, offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Halfvolle melk', sku: 'fictional-offset-milk',
    weight: { value: '1000 ml' }, offers,
  }) + '</script>'
  return parseOfflineRetailerSnapshot({ source: source(shop), html, capturedAt })
}
function basket(candidate) {
  const a = capture('plus', quote('1.29', {
    validFrom: '2026-10-14T00:00:00Z',
    priceValidUntil: '2026-10-16T23:59:59Z',
  }))
  const b = capture('dekamarkt', candidate)
  const result = compareReviewedCatalogs({
    nowMs,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [...a.observations, ...b.observations],
  })
  return { parsed: b, result }
}
function expectKnown(offer) {
  const { parsed, result } = basket(offer)
  assert.equal(parsed.observations.length, 1)
  assert.equal(parsed.observations[0].currentPriceCents, 119)
  assert.equal(result.comparable, true)
  assert.equal(result.stores.plus.subtotalCents, 258)
  assert.equal(result.stores.dekamarkt.subtotalCents, 238)
  assert.equal(result.savingsCents, 20)
  assert.equal(result.claimable, false)
}
function expectWithheld(offer) {
  const { parsed, result } = basket(offer)
  assert.ok(parsed.observations.every((p) => p.currentPriceCents === null),
    'Outside ±14:00 is not a real timezone offset and must not establish exact checkout cents')
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
}

test('positive: UTC timestamps retain exact two-pack arithmetic', () => {
  expectKnown(quote('1.19', {
    validFrom: '2026-10-14T00:00:00Z', priceValidUntil: '2026-10-16T23:59:59Z',
  }))
})
test('positive: offset +14:00 is legal and must not be overblocked', () => {
  expectKnown(quote('1.19', {
    validFrom: '2026-10-15T10:00:00+14:00',
    priceValidUntil: '2026-10-16T12:00:00Z',
  }))
})
test('positive: offset -14:00 is legal and must not be overblocked', () => {
  expectKnown(quote('1.19', {
    validFrom: '2026-10-14T10:00:00-14:00',
    priceValidUntil: '2026-10-16T12:00:00Z',
  }))
})
test('EXPECTED RED: invalid Offer start +14:01 cannot become yesterday', () => {
  expectWithheld(quote('1.19', {
    validFrom: '2026-10-15T10:00:00+14:01',
    priceValidUntil: '2026-10-16T12:00:00Z',
  }))
})
test('EXPECTED RED: invalid Offer start +15:00 cannot create a current quote', () => {
  expectWithheld(quote('1.19', {
    validFrom: '2026-10-15T10:00:00+15:00',
    priceValidUntil: '2026-10-16T12:00:00Z',
  }))
})
test('EXPECTED RED: invalid Offer expiry -14:01 cannot extend sale into today', () => {
  expectWithheld(quote('1.19', {
    validFrom: '2026-10-14T00:00:00Z',
    priceValidUntil: '2026-10-15T01:00:00-14:01',
  }))
})
test('EXPECTED RED: invalid Offer expiry -15:00 cannot extend a sale', () => {
  expectWithheld(quote('1.19', {
    validFrom: '2026-10-14T00:00:00Z',
    priceValidUntil: '2026-10-15T01:00:00-15:00',
  }))
})
test('EXPECTED RED: invalid nested PriceSpecification offset +23:59 must not mint price', () => {
  expectWithheld({
    '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    priceSpecification: {
      '@type': 'PriceSpecification', price: '1.19', priceCurrency: 'EUR',
      validFrom: '2026-10-15T10:00:00+23:59',
      validThrough: '2026-10-16T12:00:00Z',
    },
  })
})
test('EXPECTED RED: invalid nested PriceSpecification expiry -23:59 must not mint price', () => {
  expectWithheld({
    '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    priceSpecification: {
      '@type': 'PriceSpecification', price: '1.19', priceCurrency: 'EUR',
      validFrom: '2026-10-14T00:00:00Z',
      validThrough: '2026-10-14T23:00:00-23:59',
    },
  })
})
