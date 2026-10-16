import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'

// Offline-only selector proposals: no fetchFn, HTTP, retailer permission,
// live price, human field measurement, or public savings eligibility.
const html = '<main><article class="product-card"><span class="price-value">fictional</span></article></main>'
const origins = [
  { retailerId: 'plus', url: 'https://www.plus.nl/producten' },
  { retailerId: 'dekamarkt', url: 'https://www.dekamarkt.nl/producten' },
]
const inspect = (base, capturedAt) =>
  proposeOfflineRetailerSelectors({ html, origin: { ...base, capturedAt } })

test('QA expected RED: impossible Gregorian February 30 never becomes hash-linked PLUS or Deka selector provenance', () => {
  for (const base of origins) {
    assert.throws(
      () => inspect(base, '2026-02-30T12:15:00.000Z'),
      /Invalid or oversized offline retailer snapshot/,
      base.retailerId + ' must refuse impossible February 30',
    )
  }
})

test('QA expected RED: non-leap February 29 and April 31 cannot be normalized into archived source dates', () => {
  for (const base of origins) {
    for (const capturedAt of [
      '2025-02-29T10:00:00.000Z',
      '1900-02-29T10:00:00.000Z',
      '2026-04-31T10:00:00.000Z',
    ]) {
      assert.throws(
        () => inspect(base, capturedAt),
        /Invalid or oversized offline retailer snapshot/,
        base.retailerId + ' accepted invalid civil date ' + capturedAt,
      )
    }
  }
})

test('QA positive: physical leap days 2000 and 2024 remain offline, SHA-linked and never licensed', () => {
  const expectedSha = createHash('sha256').update(html).digest('hex')
  for (const base of origins) {
    for (const capturedAt of ['2000-02-29T10:00:00.000Z', '2024-02-29T10:00:00.000Z']) {
      const result = inspect(base, capturedAt)
      assert.equal(result.source.sha256, expectedSha)
      assert.equal(result.source.capturedAt, capturedAt)
      assert.equal(result.humanReviewRequired, true)
      assert.equal(result.permissionVerified, false)
      assert.equal(result.productionEnabled, false)
      assert.equal(result.readyForIngestion, false)
      assert.equal(result.publicSavingsClaimEligible, false)
      assert.ok(result.selectors.every(s => s.status === 'needs-human-review'))
      assert.doesNotMatch(JSON.stringify(result), /fictional|www\.plus\.nl|www\.dekamarkt\.nl/i)
    }
  }
})

test('QA positive: valid yesterday UTC and future captures retain strict fail-closed boundary', () => {
  for (const base of origins) {
    assert.equal(inspect(base, '2026-10-14T12:00:00.000Z').source.capturedAt,
      '2026-10-14T12:00:00.000Z')
    assert.throws(() => inspect(base, '2999-10-14T12:00:00.000Z'),
      /Invalid or oversized offline retailer snapshot/)
  }
})
