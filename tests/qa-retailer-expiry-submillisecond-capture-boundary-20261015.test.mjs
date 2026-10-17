import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent, synthetic M3 capture-time expiry matrix. Even 1 nanosecond of
// post-expiry capture means the quoted checkout price was not observed active.
// This is the reverse boundary of the frozen Offer.validFrom regression #2671.
const capturedAt = '2026-10-15T09:00:00.000000999Z'
const source = SOURCES.find(s => s.id === 'dekamarkt-product-halfvolle-melk')
assert.ok(source, 'the existing deterministic M1 fictional observation source is required')

const offer = (validTo) => ({
  '@type': 'Offer',
  price: '1.19',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  validFrom: '2026-10-14T00:00:00Z',
  priceValidUntil: validTo,
})
const nested = (validTo) => ({
  '@type': 'Offer',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  priceSpecification: {
    '@type': 'PriceSpecification',
    price: '1.19',
    priceCurrency: 'EUR',
    validFrom: '2026-10-14T00:00:00Z',
    validThrough: validTo,
  },
})
function parsedPrice(offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    sku: 'fictional-m3-submillisecond-expiry',
    name: 'Halfvolle melk',
    weight: { value: '1000 ml' },
    offers,
  }) + '</script>'
  const result = parseOfflineRetailerSnapshot({ source, html, capturedAt })
  assert.equal(result.observations.length, 1, 'offline fixture should parse one product')
  return result.observations[0].currentPriceCents
}
test('positive: Offer expiry exactly at capture nanosecond is still observed', () => {
  assert.equal(parsedPrice(offer('2026-10-15T09:00:00.000000999Z')), 119)
})
test('positive: Offer expiry one nanosecond after capture is still observed', () => {
  assert.equal(parsedPrice(offer('2026-10-15T09:00:00.000001000Z')), 119)
})
test('positive: nested price expiry exactly at capture is still observed', () => {
  assert.equal(parsedPrice(nested('2026-10-15T09:00:00.000000999Z')), 119)
})
test('EXPECTED RED: Offer expired one nanosecond before capture cannot mint price', () => {
  assert.equal(parsedPrice(offer('2026-10-15T09:00:00.000000998Z')), null)
})
test('EXPECTED RED: Offer expired 998 nanoseconds before capture cannot mint price', () => {
  assert.equal(parsedPrice(offer('2026-10-15T09:00:00.000000001Z')), null)
})
test('EXPECTED RED: nested PriceSpecification expired one ns before capture cannot mint price', () => {
  assert.equal(parsedPrice(nested('2026-10-15T09:00:00.000000998Z')), null)
})
test('EXPECTED RED: +00:00 timezone expired nested quote cannot mint price', () => {
  assert.equal(parsedPrice(nested('2026-10-15T09:00:00.000000001+00:00')), null)
})
