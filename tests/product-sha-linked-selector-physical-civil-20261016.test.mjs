import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

// Fully synthetic archived HTML. A matching SHA means unchanged bytes, not
// permission to fetch, publish current prices or claim M3 basket savings.
const html = '<html><body><article class="product-card"><span class="price-value">synthetic</span></article></body></html>'
const sha256 = createHash('sha256').update(html).digest('hex')
const shops = ['plus', 'dekamarkt']
function source(store, time) {
  return {
    id: store + '-private-reviewed-fixture',
    supermarket: store,
    kind: 'catalog',
    url: store === 'plus' ? 'https://www.plus.nl/producten' :
      'https://www.dekamarkt.nl/producten/',
    capturedAt: time,
    sha256,
  }
}
const run = (store, at) => proposeRetailerSelectors(source(store, at), html)

test('reject impossible civil dates even with matching historical SHA', () => {
  const invalid = [
    '2026-02-30T12:00:00.000Z',
    '1900-02-29T10:00:00.000Z',
    '2025-02-29T10:00:00.000Z',
    '2026-04-31T10:00:00.000Z',
    '2026-10-14T24:00:00Z',
    '2026-10-14T12:00:60Z',
  ]
  for (const store of shops) for (const at of invalid) {
    assert.throws(() => run(store, at), /Offline selector review refused:/)
  }
})

test('valid leap instants and all 1–9 nanosecond digits preserve exact provenance', () => {
  for (const store of shops) {
    for (const at of [
      '2000-02-29T12:00:00Z',
      '2024-02-29T12:00:00.1Z',
      '2024-02-29T12:00:00.12Z',
      '2024-02-29T12:00:00.123Z',
      '2024-02-29T12:00:00.123456Z',
      '2024-02-29T12:00:00.123456789Z',
    ]) {
      const original = source(store, at)
      const snapshot = structuredClone(original)
      const result = proposeRetailerSelectors(original, html)
      assert.equal(result.source.sha256, sha256)
      assert.equal(result.source.capturedAt, at)
      assert.equal(result.source.supermarket, store)
      assert.equal(result.readyForScraping, false)
      assert.equal(result.sourcePermissionVerified, false)
      assert.equal(result.currentPricesExtracted, false)
      assert.equal(result.publicationAllowed, false)
      assert.deepEqual(original, snapshot)
      assert.doesNotMatch(JSON.stringify(result), /synthetic|price-value">/i)
    }
  }
})

test('physical nanosecond future instant fails closed at exact audit clock', () => {
  const originalClock = Date.now
  try {
    const reference = Date.parse('2026-10-14T12:00:00.000Z')
    Date.now = () => reference
    for (const store of shops) {
      assert.equal(run(store, '2026-10-14T12:00:00.000000000Z').source.capturedAt,
        '2026-10-14T12:00:00.000000000Z')
      assert.throws(() => run(store, '2026-10-14T12:00:00.000000001Z'),
        /Offline selector review refused:/)
      assert.throws(() => run(store, '2026-10-14T12:00:00.001000000Z'),
        /Offline selector review refused:/)
    }
  } finally {
    Date.now = originalClock
  }
})

test('wrong SHA or invalid greater-than-nanosecond precision remains refused', () => {
  for (const store of shops) {
    const wrong = source(store, '2026-10-14T12:00:00.123456789Z')
    wrong.sha256 = 'f'.repeat(64)
    assert.throws(() => proposeRetailerSelectors(wrong, html), /Offline selector review refused:/)
    assert.throws(() => run(store, '2026-10-14T12:00:00.1234567891Z'),
      /Offline selector review refused:/)
  }
})
