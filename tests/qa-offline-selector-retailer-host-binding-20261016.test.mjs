import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'

// No fetch, HTTP, real supermarket authorization or actual products.
const html = '<main><article class="product-card">synthetic</article></main>'
const capturedAt = '2026-10-14T12:00:00.000Z'
const run = (retailerId, url) => proposeOfflineRetailerSelectors({
  html, origin: { retailerId, url, capturedAt },
})

test('QA expected RED: a DekaMarkt-origin page cannot be attributed to PLUS', () => {
  assert.throws(() => run('plus', 'https://www.dekamarkt.nl/producten'),
    /Invalid or oversized offline retailer snapshot/)
})

test('QA expected RED: a PLUS-origin page cannot be attributed to DekaMarkt', () => {
  assert.throws(() => run('dekamarkt', 'https://www.plus.nl/producten'),
    /Invalid or oversized offline retailer snapshot/)
})

test('QA expected RED: canonical retailer identity rejects arbitrary lookalike HTTPS hosts', () => {
  for (const [retailerId, url] of [
    ['plus', 'https://plus.example.test/producten'],
    ['plus', 'https://www.plus.nl.example.test/producten'],
    ['dekamarkt', 'https://dekamarkt.example.test/producten'],
    ['dekamarkt', 'https://www.dekamarkt.nl.example.test/producten'],
  ]) {
    assert.throws(() => run(retailerId, url),
      /Invalid or oversized offline retailer snapshot/,
      retailerId + ' must not claim origin from ' + url)
  }
})

test('QA positive: authentic matching retailer hosts remain human-review-only and hash-pinned', () => {
  const expected = createHash('sha256').update(html, 'utf8').digest('hex')
  for (const [id, url] of [
    ['plus', 'https://www.plus.nl/producten'],
    ['dekamarkt', 'https://www.dekamarkt.nl/producten'],
  ]) {
    const report = run(id, url)
    assert.equal(report.source.retailerId, id)
    assert.equal(report.source.sha256, expected)
    assert.equal(report.source.capturedAt, capturedAt)
    assert.equal(report.humanReviewRequired, true)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.readyForIngestion, false)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(JSON.stringify(report), /synthetic|www\.plus\.nl|www\.dekamarkt\.nl/i)
  }
})

test('QA positive: explicitly unknown research retailer remains offline-only, never granted PLUS rights', () => {
  // The existing generic selector tool deliberately supports unknown shops.
  const output = run('fictional-retailer', 'https://fictional.example/catalog')
  assert.equal(output.source.retailerId, 'fictional-retailer')
  assert.equal(output.permissionVerified, false)
  assert.equal(output.productionEnabled, false)
  assert.equal(output.publicSavingsClaimEligible, false)
})
