import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Synthetic-only independent QA: no real prices, retailer network or release claims.
const capturedAt = '2026-10-15T09:00:00Z'
const nowMs = Date.parse('2026-10-15T10:00:00Z')
const source = (shop) => SOURCES.find((s) => s.id === shop + '-product-halfvolle-melk')
const offer = (price, extra = {}) => ({
  '@type': 'Offer', price, priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock', ...extra,
})
function snapshot(shop, offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', name: 'Halfvolle melk', sku: 'fictional-milk',
    weight: { value: '1000 ml' }, offers,
  }) + '</script>'
  return parseOfflineRetailerSnapshot({ source: source(shop), html, capturedAt })
}
const validPlus = offer('1.29', {
  validFrom: '2026-10-14T00:00:00Z', priceValidUntil: '2026-10-16T00:00:00Z',
})
function compare(offers) {
  return compareReviewedCatalogs({
    nowMs,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [
      ...snapshot('plus', validPlus).observations,
      ...snapshot('dekamarkt', offers).observations,
    ],
  })
}
function expectUnknown(offers) {
  const candidate = snapshot('dekamarkt', offers)
  assert.ok(candidate.observations.every((p) => p.currentPriceCents === null),
    'No exact pack price without currently valid source price evidence')
  const result = compare(offers)
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.lines[0].dekamarkt.totalCents, null)
  assert.equal(result.claimable, false)
}

test('positive: singleton dated Offer gives exact two-pack arithmetic, never public claim', () => {
  for (const offers of [
    offer('1.19', {
      validFrom: '2026-10-14T00:00:00Z',
      priceValidUntil: '2026-10-16T00:00:00Z',
    }),
    [offer('1.19', {
      validFrom: '2026-10-14T00:00:00Z',
      priceValidUntil: '2026-10-16T00:00:00Z',
    })],
  ]) {
    const r = compare(offers)
    assert.equal(r.comparable, true)
    assert.equal(r.stores.plus.subtotalCents, 258)
    assert.equal(r.stores.dekamarkt.subtotalCents, 238)
    assert.equal(r.savingsCents, 20)
    assert.equal(r.claimable, false)
  }
})

test('EXPECTED RED: two expired identically-priced Offers cannot lose expiry via null Offer metadata', () => {
  expectUnknown([
    offer('1.19', { validFrom: '2026-10-01T00:00:00Z', priceValidUntil: '2026-10-10T00:00:00Z' }),
    offer('1.19', { validFrom: '2026-10-01T00:00:00Z', priceValidUntil: '2026-10-12T00:00:00Z' }),
  ])
})

test('EXPECTED RED: two not-yet-active identically-priced Offers cannot imply current checkout price', () => {
  expectUnknown([
    offer('1.19', { validFrom: '2026-10-16T00:00:00Z', priceValidUntil: '2026-10-20T00:00:00Z' }),
    offer('1.19', { validFrom: '2026-10-17T00:00:00Z', priceValidUntil: '2026-10-20T00:00:00Z' }),
  ])
})

test('EXPECTED RED: mutually disjoint Offer validity windows cannot become unbounded price', () => {
  expectUnknown([
    offer('1.19', { validFrom: '2026-10-01T00:00:00Z', priceValidUntil: '2026-10-10T00:00:00Z' }),
    offer('1.19', { validFrom: '2026-10-16T00:00:00Z', priceValidUntil: '2026-10-20T00:00:00Z' }),
  ])
})

const pricedSpecification = (validFrom, validThrough) => ({
  '@type': 'Offer', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  priceSpecification: {
    '@type': 'PriceSpecification', price: '1.19', priceCurrency: 'EUR',
    validFrom, validThrough,
  },
})
test('EXPECTED RED: PriceSpecification expired validThrough must not count as checkout price', () => {
  expectUnknown(pricedSpecification('2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'))
})

test('EXPECTED RED: PriceSpecification future validFrom must not count as checkout price', () => {
  expectUnknown(pricedSpecification('2026-10-16T00:00:00Z', '2026-10-20T00:00:00Z'))
})

test('positive: currently valid nested PriceSpecification keeps its genuine one-pack cents', () => {
  const r = compare(pricedSpecification('2026-10-14T00:00:00Z', '2026-10-16T00:00:00Z'))
  assert.equal(r.comparable, true)
  assert.equal(r.stores.plus.subtotalCents, 258)
  assert.equal(r.stores.dekamarkt.subtotalCents, 238)
  assert.equal(r.savingsCents, 20)
  assert.equal(r.claimable, false)
})
