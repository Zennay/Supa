import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA against corrected M3 source, not the product owner's code.
// Date-only '2026-10-15' must be observationally equivalent to a fully
// explicit end-of-day nanosecond, for both direct and nested price quotes.
// All HTML, products and prices are fictional; NO retailer HTTP.
const source = SOURCES.find(s => s.id === 'dekamarkt-product-halfvolle-melk')
assert.ok(source)
const DAY = '2026-10-15'
const LAST_NS = '2026-10-15T23:59:59.999999999Z'
const FIRST_END_NS = '2026-10-15T23:59:59.999000001Z'

function capture(expiry, capturedAt, nested) {
  const price = nested ? {
    '@type': 'Offer',
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    validFrom: '2026-10-14',
    priceSpecification: {
      '@type': 'PriceSpecification',
      price: '1.19',
      priceCurrency: 'EUR',
      validFrom: '2026-10-14',
      validThrough: expiry,
    },
  } : {
    '@type': 'Offer',
    price: '1.19',
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    validFrom: '2026-10-14',
    priceValidUntil: expiry,
  }
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    sku: 'fictional-nanosecond-equivalence',
    name: 'Halfvolle melk',
    weight: { value: '1000 ml' },
    offers: price,
  }) + '</script>'
  const parsed = parseOfflineRetailerSnapshot({ source, html, capturedAt })
  assert.equal(parsed.scriptsInspected, 1)
  assert.equal(parsed.observations.length, 1)
  return parsed.observations[0]
}

for (const nested of [false, true]) {
  const mode = nested ? 'nested PriceSpecification' : 'direct Offer'
  for (const [label, when] of [
    ['first nanosecond after final millisecond begins', FIRST_END_NS],
    ['final UTC nanosecond of expiry day', LAST_NS],
    ['same last nanosecond in +02:00 time zone', '2026-10-16T01:59:59.999999999+02:00'],
  ]) {
    test(mode + ': date-only and explicit last-nanosecond end produce identical checkout/RawOffer at ' + label, () => {
      const dateOnly = capture(DAY, when, nested)
      const explicit = capture(LAST_NS, when, nested)
      assert.equal(dateOnly.currentPriceCents, 119)
      assert.equal(explicit.currentPriceCents, 119)
      assert.deepEqual(dateOnly.offer, explicit.offer,
        'date-only end and its exact final nanosecond must have the same exported validity and price')
      assert.equal(dateOnly.offer?.validTo, LAST_NS,
        'upstream evidence cannot expire earlier than its accepted checkout instant')
    })
  }
  test(mode + ': midnight after date-only and explicit last-ns both reject checkout price', () => {
    const next = '2026-10-16T00:00:00.000000000Z'
    const a = capture(DAY, next, nested)
    const b = capture(LAST_NS, next, nested)
    assert.equal(a.currentPriceCents, null)
    assert.equal(b.currentPriceCents, null)
    assert.equal(a.offer, null)
    assert.equal(b.offer, null)
  })
  test(mode + ': explicit .999Z timed expiry remains strictly narrower than date-only day end', () => {
    const dateOnly = capture(DAY, FIRST_END_NS, nested)
    const timed = capture('2026-10-15T23:59:59.999Z', FIRST_END_NS, nested)
    assert.equal(dateOnly.currentPriceCents, 119)
    assert.equal(timed.currentPriceCents, null)
    assert.equal(timed.offer, null)
  })
}
