import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent M3 QA: the source parser accepts checkout quotes through the
// final nanosecond of a date-only Offer, but it must not silently publish an
// earlier, already-expired validTo when handing that quote to comparison.
// All products/prices below are fictional, parsed offline; no retailer HTTP.
const source = SOURCES.find(item => item.id === 'dekamarkt-product-halfvolle-melk')
assert.ok(source, 'M1 fictional, offline-only product source fixture required')

const DAY = '2026-10-15'
const LAST_NS = '2026-10-15T23:59:59.999999999Z'
const FIRST_SUBMS = '2026-10-15T23:59:59.999000001Z'

function observed(capturedAt, expiry, nested = false) {
  const offers = nested
    ? { '@type': 'Offer', priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        priceSpecification: { '@type': 'PriceSpecification',
          price: '1.19', priceCurrency: 'EUR',
          validFrom: '2026-10-14', validThrough: expiry } }
    : { '@type': 'Offer', price: '1.19', priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        validFrom: '2026-10-14', priceValidUntil: expiry }
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    sku: 'fictional-date-only-output-boundary', name: 'Halfvolle melk',
    weight: { value: '1000 ml' }, offers,
  }) + '</script>'
  const result = parseOfflineRetailerSnapshot({ source, html, capturedAt })
  assert.equal(result.scriptsInspected, 1)
  assert.equal(result.observations.length, 1)
  return result.observations[0]
}

test('positive: date-only capture 23:59:59.999Z still yields source price', () => {
  const item = observed('2026-10-15T23:59:59.999000000Z', DAY)
  assert.equal(item.currentPriceCents, 119)
  assert.equal(item.offer?.offerPriceCents, 119)
})

test('positive: timestamp Offer expiry keeps exact explicit millisecond boundary', () => {
  const item = observed('2026-10-15T23:59:59.999000000Z',
    '2026-10-15T23:59:59.999Z')
  assert.equal(item.currentPriceCents, 119)
  assert.equal(item.offer?.validTo, '2026-10-15T23:59:59.999Z')
})

test('positive: nested timestamp expiry preserves explicit last nanosecond', () => {
  const item = observed(LAST_NS, LAST_NS, true)
  assert.equal(item.currentPriceCents, 119)
  assert.equal(item.offer?.validTo, LAST_NS)
})

test('positive: date-only Offer must not become a price after next midnight', () => {
  const item = observed('2026-10-16T00:00:00.000000000Z', DAY)
  assert.equal(item.currentPriceCents, null)
  assert.equal(item.offer, null)
})

for (const [label, nested, capturedAt] of [
  ['direct first +1ns of last millisecond', false, FIRST_SUBMS],
  ['direct final valid nanosecond', false, LAST_NS],
  ['nested first +1ns of last millisecond', true, FIRST_SUBMS],
  ['nested final valid nanosecond', true, LAST_NS],
]) {
  test('EXPECTED RED: '+label+' must retain full inclusive expiry in exported RawOffer', () => {
    const item = observed(capturedAt, DAY, nested)
    assert.equal(item.currentPriceCents, 119,
      'capture-time source checkout quote is valid; do not solve by deleting price')
    assert.ok(item.offer, 'price-bearing offer must preserve source validity')
    assert.equal(item.offer.offerPriceCents, 119)
    assert.equal(item.offer.validTo, LAST_NS,
      'handed-off offer must not expire 1-999999ns before its source quote')
  })
}
