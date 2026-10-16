import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'

// Product-owner acceptance for offline selector origin integrity. The source
// HTML is entirely fictional, has no network access and never grants rights.
const html = '<main><article class="product-card"><span class="price-value">made-up</span></article></main>'
const baseline = '2026-10-14T12:00:00.000Z'
const stores = [
  ['plus', 'https://www.plus.nl/producten'],
  ['dekamarkt', 'https://www.dekamarkt.nl/producten'],
]
function inspect(retailerId, url, capturedAt = baseline) {
  return proposeOfflineRetailerSelectors({ html, origin: { retailerId, url, capturedAt } })
}
function rejects(retailerId, url, capturedAt) {
  assert.throws(
    () => inspect(retailerId, url, capturedAt),
    /Invalid or oversized offline retailer snapshot/,
  )
}

test('known retailer host must match exact PLUS or DekaMarkt identity', () => {
  for (const [id, url] of [
    ['plus', 'https://www.dekamarkt.nl/producten'],
    ['dekamarkt', 'https://www.plus.nl/producten'],
    ['plus', 'https://plus.example.test/producten'],
    ['plus', 'https://www.plus.nl.example.test/producten'],
    ['dekamarkt', 'https://dekamarkt.example.test/producten'],
    ['dekamarkt', 'https://www.dekamarkt.nl.example.test/producten'],
  ]) rejects(id, url, baseline)
})

test('known-store valid origin retains original immutable hash and private flags', () => {
  const sha = createHash('sha256').update(html, 'utf8').digest('hex')
  for (const [id, url] of stores) {
    const report = inspect(id, url)
    assert.deepEqual(report.source, { retailerId: id, sha256: sha, capturedAt: baseline })
    assert.equal(report.humanReviewRequired, true)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.readyForIngestion, false)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.ok(report.selectors.every(row => row.status === 'needs-human-review'))
    assert.doesNotMatch(JSON.stringify(report), /made-up|www\.plus\.nl|www\.dekamarkt\.nl/i)
  }
})

test('generic unknown research retailer remains private and unlicensed', () => {
  const report = inspect('fictional-retailer', 'https://fictional.example/catalog')
  assert.equal(report.source.retailerId, 'fictional-retailer')
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('reject normalization of impossible calendar dates across both actual retailers', () => {
  const invalid = [
    '2026-02-30T12:00:00.000Z',
    '2025-02-29T12:00:00.000Z',
    '1900-02-29T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z',
    '2026-10-14T24:00:00Z',
    '2026-10-14T12:00:60Z',
    '2026-10-14T12:60:00Z',
  ]
  for (const [id, url] of stores) for (const at of invalid) rejects(id, url, at)
})

test('leap-year valid dates and 0–3 digit UTC fractions preserve source clock', () => {
  for (const [id, url] of stores) {
    for (const at of [
      '2000-02-29T10:00:00Z',
      '2024-02-29T10:00:00.1Z',
      '2024-02-29T10:00:00.12Z',
      '2024-02-29T10:00:00.123Z',
    ]) {
      const result = inspect(id, url, at)
      assert.equal(result.source.capturedAt, at)
      assert.equal(result.readyForIngestion, false)
    }
    rejects(id, url, '2999-10-14T12:00:00.000Z')
  }
})
