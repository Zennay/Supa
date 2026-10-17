import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent M3 QA 2/2: all HTML, supermarket prices, dates, and IDs are
// fictional. These tests only use offline parsing and deterministic time.
const src = (store) => SOURCES.find((s) => s.id === store + '-product-halfvolle-melk')
const exact = (price, dates = {}) => ({
  '@type': 'Offer', price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock', ...dates,
})
function snapshot(store, offers, capturedAt) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product', sku: 'fictional-calendar-qa-milk',
    name: 'Halfvolle melk', weight: { value: '1000 ml' }, offers,
  }) + '</script>'
  return parseOfflineRetailerSnapshot({ source: src(store), html, capturedAt })
}
function comparison(offer, time = '2026-03-01T10:00:00Z') {
  const year = time.slice(0, 4)
  const capturedAt = new Date(Date.parse(time) - 3600000).toISOString()
  const candidate = snapshot('dekamarkt', offer, capturedAt)
  const baseline = snapshot('plus', exact('1.29', {
    validFrom: year + '-01-01',
    priceValidUntil: year + '-12-31',
  }), capturedAt)
  const result = compareReviewedCatalogs({
    nowMs: Date.parse(time),
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [...baseline.observations, ...candidate.observations],
  })
  return { candidate, result }
}
function expectNoTrust(offer, time) {
  const { candidate, result } = comparison(offer, time)
  assert.ok(candidate.observations.every((observation) =>
    observation.currentPriceCents === null),
  'An impossible calendar date must not establish exact checkout cents')
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
}
test('positive: real date-only end on observation day remains inclusive', () => {
  const { result } = comparison(exact('1.19', {
    validFrom: '2026-02-01', priceValidUntil: '2026-03-01',
  }))
  assert.equal(result.comparable, true)
  assert.equal(result.stores.plus.subtotalCents, 258)
  assert.equal(result.stores.dekamarkt.subtotalCents, 238)
  assert.equal(result.savingsCents, 20)
  assert.equal(result.claimable, false)
})
test('positive: a real prior-day expiry is not trusted as current', () => {
  const { result } = comparison(exact('1.19', {
    validFrom: '2026-02-01', priceValidUntil: '2026-02-28',
  }))
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
})
test('positive: actual leap-day 2024-02-29 remains valid through that day', () => {
  const { result } = comparison(exact('1.19', {
    validFrom: '2024-02-01', priceValidUntil: '2024-02-29',
  }), '2024-02-29T10:00:00Z')
  assert.equal(result.comparable, true)
  assert.equal(result.savingsCents, 20)
  assert.equal(result.claimable, false)
})
test('EXPECTED RED: February 30 date-only expiry must not roll forward to March 2', () => {
  expectNoTrust(exact('1.19', {
    validFrom: '2026-02-01', priceValidUntil: '2026-02-30',
  }))
})
test('EXPECTED RED: non-leap February 29 expiry cannot be treated as March 1', () => {
  expectNoTrust(exact('1.19', {
    validFrom: '2026-02-01', priceValidUntil: '2026-02-29',
  }))
})
test('EXPECTED RED: April 31 expiry cannot roll forward to May 1', () => {
  expectNoTrust(exact('1.19', {
    validFrom: '2026-04-01', priceValidUntil: '2026-04-31',
  }), '2026-05-01T10:00:00Z')
})
test('EXPECTED RED: impossible explicit ISO timestamp end cannot roll to March', () => {
  expectNoTrust(exact('1.19', {
    validFrom: '2026-02-01', priceValidUntil: '2026-02-30T23:59:59Z',
  }))
})
test('EXPECTED RED: impossible start date cannot silently become an accepted later date', () => {
  expectNoTrust(exact('1.19', {
    validFrom: '2026-02-30', priceValidUntil: '2026-03-10',
  }), '2026-03-03T10:00:00Z')
})
test('EXPECTED RED: nested PriceSpecification impossible expiry cannot mint pack cents', () => {
  expectNoTrust({
    '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    priceSpecification: {
      '@type': 'PriceSpecification', price: '1.19', priceCurrency: 'EUR',
      validFrom: '2026-02-01', validThrough: '2026-02-30',
    },
  })
})
