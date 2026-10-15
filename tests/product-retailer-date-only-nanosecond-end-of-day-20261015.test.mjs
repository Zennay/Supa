import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// These are entirely fictional local Product JSON-LD snapshots. Inclusive
// Schema.org date-only expiry must cover the full 24h civil day *at ns scale*.
const source = SOURCES.find(s => s.id === 'dekamarkt-product-halfvolle-melk')
assert.ok(source)
const priced = (capturedAt, expiration, nested = false) => {
  const offers = nested
    ? { '@type': 'Offer', priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        priceSpecification: { '@type': 'PriceSpecification',
          price: '1.19', priceCurrency: 'EUR', validThrough: expiration } }
    : { '@type': 'Offer', price: '1.19', priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock', priceValidUntil: expiration }
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    sku: 'fictional-full-day-inclusion', name: 'Halfvolle melk',
    weight: { value: '1000 ml' }, offers,
  }) + '</script>'
  const parsed = parseOfflineRetailerSnapshot({ source, html, capturedAt })
  assert.equal(parsed.observations.length, 1)
  return parsed.observations[0].currentPriceCents
}
test('date-only Offer includes last nano of stated UTC day', () => {
  assert.equal(priced('2026-10-15T23:59:59.999999999Z', '2026-10-15'), 119)
})
test('date-only nested specification includes final 999,999 ns of day', () => {
  assert.equal(priced('2026-10-15T23:59:59.999999999Z', '2026-10-15', true), 119)
})
test('date-only Offer accepts final nanosecond expressed with civil UTC offset', () => {
  assert.equal(priced('2026-10-16T01:59:59.999999999+02:00', '2026-10-15'), 119)
})
test('date-only Offer rejects next midnight even one nanosecond later', () => {
  assert.equal(priced('2026-10-16T00:00:00.000000000Z', '2026-10-15'), null)
})
test('nested date-only expiry also rejects next UTC day', () => {
  assert.equal(priced('2026-10-16T00:00:00Z', '2026-10-15', true), null)
})
test('explicit .999 timestamp is NOT a date-only expiry', () => {
  assert.equal(priced('2026-10-15T23:59:59.999000001Z',
    '2026-10-15T23:59:59.999Z'), null)
})
test('explicit nested timestamp precision remains exact and exclusive after deadline', () => {
  assert.equal(priced('2026-10-15T23:59:59.999000001Z',
    '2026-10-15T23:59:59.999Z', true), null)
})
