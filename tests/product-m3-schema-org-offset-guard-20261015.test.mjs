import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Product-owned regressions, separate from immutable QA #2658/#2664.
// Entirely fictional saved HTML; no HTTP, retailer permission or savings claim.
const capturedAt = '2026-10-15T09:00:00Z'
const nowMs = Date.parse('2026-10-15T10:00:00Z')
const source = (id) => SOURCES.find((s) => s.id === id + '-product-halfvolle-melk')
const quote = (price, dateFields = {}) => ({
  '@type': 'Offer', price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock', ...dateFields,
})
function observed(store, offer) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Halfvolle melk', sku: 'fictional-timezone-milk',
    weight: { value: '1000 ml' }, offers: offer,
  }) + '</script>'
  return parseOfflineRetailerSnapshot({
    source: source(store), html, capturedAt,
  })
}
function study(offer) {
  const plus = observed('plus', quote('1.29', {
    validFrom: '2026-10-14T00:00:00Z',
    priceValidUntil: '2026-10-16T23:59:59Z',
  }))
  const deka = observed('dekamarkt', offer)
  const result = compareReviewedCatalogs({
    nowMs,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [...plus.observations, ...deka.observations],
  })
  return { deka, result }
}
function unavailable(offer) {
  const { deka, result } = study(offer)
  assert.ok(deka.observations.every((row) => row.currentPriceCents === null))
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
}
function known(offer) {
  const { deka, result } = study(offer)
  assert.equal(deka.observations.length, 1)
  assert.equal(deka.observations[0].currentPriceCents, 119)
  assert.equal(result.comparable, true)
  assert.equal(result.stores.plus.subtotalCents, 258)
  assert.equal(result.stores.dekamarkt.subtotalCents, 238)
  assert.equal(result.savingsCents, 20)
  assert.equal(result.claimable, false)
}
test('UTC and extreme legal offsets preserve exact whole-pack comparison', () => {
  for (const [validFrom, priceValidUntil] of [
    ['2026-10-14T00:00:00Z', '2026-10-16T12:00:00Z'],
    ['2026-10-15T10:00:00+14:00', '2026-10-16T12:00:00Z'],
    ['2026-10-14T10:00:00-14:00', '2026-10-16T12:00:00Z'],
    ['2026-10-15T10:00:00+13:59', '2026-10-16T12:00:00Z'],
    ['2026-10-14T10:00:00-13:59', '2026-10-16T12:00:00Z'],
  ]) known(quote('1.19', { validFrom, priceValidUntil }))
})
test('invalid offsets in Offer start never yield exact price or store winner', () => {
  for (const suffix of ['+14:01', '+15:00', '-14:01', '-15:00', '+23:59', '-23:59']) {
    unavailable(quote('1.19', {
      validFrom: '2026-10-15T10:00:00' + suffix,
      priceValidUntil: '2026-10-16T12:00:00Z',
    }))
  }
})
test('invalid offsets in Offer expiry never extend stale prices', () => {
  for (const suffix of ['+14:01', '+15:00', '-14:01', '-15:00', '+23:59', '-23:59']) {
    unavailable(quote('1.19', {
      validFrom: '2026-10-14T00:00:00Z',
      priceValidUntil: '2026-10-15T09:30:00' + suffix,
    }))
  }
})
test('nested PriceSpecification start/expiry invalid offsets cannot mint checkout price', () => {
  for (const [field, value] of [
    ['validFrom', '2026-10-15T10:00:00+23:59'],
    ['validFrom', '2026-10-15T10:00:00-15:00'],
    ['validThrough', '2026-10-15T10:00:00-23:59'],
    ['validThrough', '2026-10-15T10:00:00+15:00'],
  ]) {
    unavailable({
      '@type': 'Offer', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      priceSpecification: {
        '@type': 'PriceSpecification', price: '1.19', priceCurrency: 'EUR',
        ...(field === 'validFrom' ? { validThrough: '2026-10-16T12:00:00Z' } :
          { validFrom: '2026-10-14T00:00:00Z' }), [field]: value,
      },
    })
  }
})
test('valid date-only end remains inclusive throughout the stated day', () => {
  known(quote('1.19', {
    validFrom: '2026-10-14',
    priceValidUntil: '2026-10-15',
  }))
})
