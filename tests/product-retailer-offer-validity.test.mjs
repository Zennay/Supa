import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Only synthetic saved HTML. Never contacts a retailer.
const nowMs = Date.parse('2026-10-15T10:00:00Z')
function observed(store, price, validFrom, priceValidUntil) {
  const source = SOURCES.find((s) => s.id === store + '-product-halfvolle-melk')
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Halfvolle melk',
    sku: 'fictional-milk', weight: { value: '1000 ml' },
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', validFrom, priceValidUntil },
  }) + '</script>'
  const capture = parseOfflineRetailerSnapshot({
    source, html, capturedAt: '2026-10-15T09:00:00Z',
  })
  assert.equal(capture.observations.length, 1)
  return capture.observations[0]
}
const compare = (until, from = '2026-10-14T00:00:00Z') =>
  compareReviewedCatalogs({
    nowMs, requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    observations: [
      observed('plus', '1.29', '2026-10-14T00:00:00Z', '2026-10-16T00:00:00Z'),
      observed('dekamarkt', '1.19', from, until),
    ],
  })
test('two currently valid exact retail offers preserve fictional checkout-price winner', () => {
  const r = compare('2026-10-16T00:00:00Z')
  assert.equal(r.comparable, true)
  assert.equal(r.cheaperStore, 'dekamarkt')
  assert.equal(r.stores.dekamarkt.subtotalCents, 238)
  assert.equal(r.savingsCents, 20)
  assert.equal(r.claimable, false)
})
test('expired retail Offer withholds winner and savings despite a recent HTML capture', () => {
  const r = compare('2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z')
  assert.equal(r.comparable, false)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.savingsCents, null)
  assert.equal(r.claimable, false)
})
test('not-yet-effective Offer cannot establish current comparison', () => {
  const r = compare('2026-10-20T00:00:00Z', '2026-10-16T00:00:00Z')
  assert.equal(r.comparable, false)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.savingsCents, null)
})
test('date-only expiry remains inclusive throughout the stated UTC day', () => {
  const r = compare('2026-10-15')
  assert.equal(r.comparable, true)
  assert.equal(r.savingsCents, 20)
})
test('contradictory offer window is refused at the parser rather than minting an observation', () => {
  const source = SOURCES.find((s) => s.id === 'dekamarkt-product-halfvolle-melk')
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', name: 'Halfvolle melk', sku: 'fictional-milk',
    weight: { value: '1000 ml' },
    offers: {
      '@type': 'Offer', price: '1.19', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      validFrom: '2026-10-16T00:00:00Z',
      priceValidUntil: '2026-10-14T00:00:00Z',
    },
  }) + '</script>'
  const snapshot = parseOfflineRetailerSnapshot({
    source, html, capturedAt: '2026-10-15T09:00:00Z',
  })
  assert.equal(snapshot.observations.length, 0)
  assert.equal(snapshot.rejected, 1)
})
