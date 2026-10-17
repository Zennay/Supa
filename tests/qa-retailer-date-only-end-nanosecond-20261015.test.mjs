import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA: date-only checkout offer end must cover every nanosecond
// of that UTC day. Product owner's new nanosecond conversion must preserve
// established inclusive-end semantics, not reduce the day to ...999000000Z.
// All HTML and prices are fictional, offline and nonclaimable.
const source = SOURCES.find(s => s.id === 'dekamarkt-product-halfvolle-melk')
assert.ok(source, 'deterministic pre-existing fictional M1 source must exist')
const dateOnly = '2026-10-15'
const nearEnd = '2026-10-15T23:59:59.999999999Z'

const direct = validTo => ({
  '@type': 'Offer',
  price: '1.19',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  validFrom: '2026-10-14',
  priceValidUntil: validTo,
})
const nested = validTo => ({
  '@type': 'Offer',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  priceSpecification: {
    '@type': 'PriceSpecification',
    price: '1.19',
    priceCurrency: 'EUR',
    validFrom: '2026-10-14',
    validThrough: validTo,
  },
})

function observedCents(offers, capturedAt) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    sku: 'fictional-nanosecond-date-only-offer',
    name: 'Halfvolle melk',
    weight: { value: '1000 ml' },
    offers,
  }) + '</script>'
  const parsed = parseOfflineRetailerSnapshot({ source, html, capturedAt })
  assert.equal(parsed.observations.length, 1)
  return parsed.observations[0].currentPriceCents
}

test('positive: date-only Offer remains valid at end-of-day millisecond exactly', () => {
  assert.equal(observedCents(direct(dateOnly), '2026-10-15T23:59:59.999000000Z'), 119)
})
test('positive: explicit timestamp expiry exactly at capture remains valid', () => {
  assert.equal(observedCents(direct('2026-10-15T23:59:59.999Z'), '2026-10-15T23:59:59.999000000Z'), 119)
})
test('positive: explicit timestamp expiry one nanosecond before capture is not valid', () => {
  assert.equal(observedCents(direct('2026-10-15T23:59:59.999Z'), '2026-10-15T23:59:59.999000001Z'), null)
})
test('positive: date-only Offer expires as soon as next UTC day begins', () => {
  assert.equal(observedCents(direct(dateOnly), '2026-10-16T00:00:00.000000000Z'), null)
})
test('EXPECTED RED: date-only Offer must include final nanosecond of valid calendar day', () => {
  assert.equal(observedCents(direct(dateOnly), nearEnd), 119)
})
test('EXPECTED RED: date-only nested PriceSpecification must include final nanosecond', () => {
  assert.equal(observedCents(nested(dateOnly), nearEnd), 119)
})
test('EXPECTED RED: date-only Offer must not lose first submillisecond nanosecond of last ms', () => {
  assert.equal(observedCents(direct(dateOnly), '2026-10-15T23:59:59.999000001Z'), 119)
})
test('EXPECTED RED: date-only nested expiry must not lose 999999ns before midnight', () => {
  assert.equal(observedCents(nested(dateOnly), '2026-10-15T23:59:59.999999998Z'), 119)
})
