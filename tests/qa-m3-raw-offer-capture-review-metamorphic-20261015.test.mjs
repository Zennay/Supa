import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Independent QA on product-owned cross-layer chronological fix.
// This module intentionally compares normalized raw observations DIRECTLY,
// not only successful Schema.org parser results. All fixtures are fictional,
// no shopper/customer identity, permission grant or retailer requests.
const NOW = Date.parse('2026-10-15T10:00:00.000Z')
const BASE_CAPTURE = '2026-10-15T09:00:00.000000000Z'
const BASE_START = '2026-10-14T08:00:00.000000000Z'
const EXPIRY = '2026-10-16T00:00:00.000Z'
const req = [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }]

function observation(store, price) {
  const source = SOURCES.find(s => s.id === store + '-product-halfvolle-melk')
  assert.ok(source)
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    sku: 'fictional-direct-time-metamer-' + store,
    name: 'Halfvolle melk',
    weight: { value: '1000 ml' },
    offers: {
      '@type': 'Offer', price: (price / 100).toFixed(2),
      priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
      validFrom: BASE_START, priceValidUntil: EXPIRY,
    },
  }) + '</script>'
  const result = parseOfflineRetailerSnapshot({ source, html, capturedAt: BASE_CAPTURE })
  assert.equal(result.observations.length, 1)
  return result.observations[0]
}

function assess({ start = BASE_START, end = EXPIRY, capturedAt = BASE_CAPTURE } = {}) {
  const plus = observation('plus', 129)
  const deka = structuredClone(observation('dekamarkt', 119))
  deka.offer.validFrom = start
  deka.offer.validTo = end
  deka.provenance.capturedAt = capturedAt
  const result = compareReviewedCatalogs({ requirements: req, observations: [plus, deka], nowMs: NOW })
  assert.equal(result.claimable, false, 'synthetic quotes are never publicly claimable')
  return result
}

function assertValid(v) {
  assert.equal(v.comparable, true)
  assert.equal(v.cheaperStore, 'dekamarkt')
  assert.equal(v.savingsCents, 20)
  assert.equal(v.stores.plus.subtotalCents, 258)
  assert.equal(v.stores.dekamarkt.subtotalCents, 238)
}

function assertUnknown(v) {
  assert.equal(v.comparable, false)
  assert.equal(v.cheaperStore, null)
  assert.equal(v.savingsCents, null)
  assert.equal(v.reason, 'invalid_or_stale_source')
}

for (const [label, change] of [
  ['price starts exactly at source capture', { start: BASE_CAPTURE }],
  ['equivalent capture in +02:00 time zone', { start: '2026-10-15T11:00:00.000000000+02:00' }],
  ['legally maximal +14:00 offset at capture', { start: '2026-10-15T23:00:00+14:00' }],
  ['price starts 1ns before source capture', { start: '2026-10-15T08:59:59.999999999Z' }],
  ['price expires exactly at review nowMs', { end: '2026-10-15T10:00:00.000000000Z' }],
  ['price expiry remains later than review', { end: EXPIRY }],
  ['captured exactly 24 hours before review with already-valid Offer', {
    capturedAt: '2026-10-14T10:00:00.000000000Z',
  }],
]) {
  test('positive direct RawOffer chronology: ' + label, () => assertValid(assess(change)))
}

for (const [label, change] of [
  ['price starts +1ns after its source capture', { start: '2026-10-15T09:00:00.000000001Z' }],
  ['price starts +1ns after review nowMs', { start: '2026-10-15T10:00:00.000000001Z' }],
  ['price expired +1ns before review nowMs', { end: '2026-10-15T09:59:59.999999999Z' }],
  ['source captured +1ns after review nowMs', { capturedAt: '2026-10-15T10:00:00.000000001Z' }],
  ['capture older than 24h by exactly 1ns', { capturedAt: '2026-10-14T09:59:59.999999999Z' }],
  ['price start offset +14:01 is impossible', { start: '2026-10-15T23:00:00+14:01' }],
  ['price was expired one ns before its capture', { end: '2026-10-15T08:59:59.999999999Z' }],
]) {
  test('negative direct RawOffer chronology: ' + label, () => assertUnknown(assess(change)))
}
