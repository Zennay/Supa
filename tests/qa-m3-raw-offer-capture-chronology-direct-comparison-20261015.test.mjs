import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// QA 2/2: the pure comparison also accepts RawProductObservation inputs,
// not only parser-produced quotes. A dated price must have ALREADY been
// effective when the underlying snapshot was captured, not merely by review.
// Every HTML/product/price is fictional and local; no retailer network.
const CAPTURE = '2026-10-15T09:00:00.000000000Z'
const NOW = Date.parse('2026-10-15T10:00:00.000Z')
const requirement = { id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }

function make(store, cents) {
  const fixture = SOURCES.find(s => s.id === store + '-product-halfvolle-melk')
  assert.ok(fixture)
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Halfvolle melk', sku: 'fictional-capture-price-' + store,
    weight: { value: '1000 ml' },
    offers: {
      '@type': 'Offer',
      price: (cents / 100).toFixed(2),
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      validFrom: '2026-10-15T08:00:00.000Z',
      priceValidUntil: '2026-10-16T00:00:00.000Z',
    },
  }) + '</script>'
  const parsed = parseOfflineRetailerSnapshot({ source: fixture, html, capturedAt: CAPTURE })
  assert.equal(parsed.observations.length, 1)
  return parsed.observations[0]
}

function compare(candidateStart, candidateCapture = CAPTURE) {
  const plus = make('plus', 129)
  const candidate = structuredClone(make('dekamarkt', 119))
  candidate.provenance.capturedAt = candidateCapture
  candidate.offer.validFrom = candidateStart
  const result = compareReviewedCatalogs({
    requirements: [requirement],
    observations: [plus, candidate],
    nowMs: NOW,
  })
  assert.equal(result.claimable, false, 'offline snapshots must never become public savings evidence')
  return result
}

test('positive: retailer price starting before capture remains valid at review', () => {
  const value = compare('2026-10-15T08:59:59.999999999Z')
  assert.equal(value.comparable, true)
  assert.equal(value.cheaperStore, 'dekamarkt')
  assert.equal(value.savingsCents, 20)
})

test('positive: retailer price starting EXACTLY at capture can be compared', () => {
  const value = compare(CAPTURE)
  assert.equal(value.comparable, true)
  assert.equal(value.savingsCents, 20)
})

test('positive: price start a whole millisecond after review is already rejected', () => {
  const value = compare('2026-10-15T10:00:00.001Z')
  assert.equal(value.comparable, false)
  assert.equal(value.cheaperStore, null)
  assert.equal(value.savingsCents, null)
})

// Source chronology has a second independent exact boundary at review time:
// an Offer that starts +1ns after nowMs cannot be current review evidence.
test('EXPECTED RED: RawOffer start +1ns after review cannot mint a winner', () => {
  const value = compare('2026-10-15T10:00:00.000000001Z')
  assert.equal(value.comparable, false)
  assert.equal(value.cheaperStore, null)
  assert.equal(value.savingsCents, null)
})

for (const [label, start] of [
  ['1ns after capture within same millisecond', '2026-10-15T09:00:00.000000001Z'],
  ['999999ns after capture within same millisecond', '2026-10-15T09:00:00.000999999Z'],
  ['half an hour after capture but before review', '2026-10-15T09:30:00Z'],
  ['equivalent offset timestamp +1ns after capture', '2026-10-15T11:00:00.000000001+02:00'],
]) {
  test('EXPECTED RED: RawOffer ' + label + ' must not create cheapest-store winner', () => {
    const result = compare(start)
    assert.equal(result.comparable, false,
      'an Offer not effective at source capture is not checkout evidence')
    assert.equal(result.cheaperStore, null)
    assert.equal(result.savingsCents, null)
    assert.equal(result.reason, 'invalid_or_stale_source')
  })
}
