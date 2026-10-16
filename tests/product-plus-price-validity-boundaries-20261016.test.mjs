import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Product-owned extra boundary coverage. All page/permission data fictional,
// fetch transport injected, and outputs remain review-only (never published).
const url = 'https://www.plus.nl/product/synthetic-validity-window-20261016'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/synthetic-non-retailer-grant',
      finding: 'In-memory product-only test, no retailer license' }],
  })),
}
async function propose(extra) {
  const offer = {
    '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock', ...extra,
  }
  const item = {
    '@type': 'Product', url, sku: 'FAKE-PACK-500-G',
    name: 'Synthetic oats 500g', weight: { value: '500 g' },
    offers: offer,
  }
  const result = await captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(
      '<script type="application/ld+json">' + JSON.stringify(item) + '</script>',
      { status: 200, headers: { 'content-type': 'text/html' } }),
  })
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  return result
}
for (const [description, fields] of [
  ['invalid February calendar date', { priceValidUntil: '2026-02-30' }],
  ['non-ISO human date', { validFrom: 'october 15th, 2020' }],
  ['missing timezone in timestamp', { validFrom: '2020-01-01T10:00:00' }],
  ['reversed explicit validity', { validFrom: '2099-01-01',
    priceValidUntil: '2020-01-01' }],
  ['expired uppercased end', { PRICEVALIDUNTIL: '2020-01-01' }],
  ['expired nested untyped spec', { priceSpecification: {
    price: '1.49', priceCurrency: 'EUR', validThrough: '2020-01-01' } }],
  ['future nested typed specification', { priceSpecification: {
    '@type': 'UnitPriceSpecification', price: '1.49', priceCurrency: 'EUR',
    validFrom: '2099-01-01' } }],
]) {
  test('private offer validity abstains on ' + description, async () => {
    const result = await propose(fields)
    assert.equal(result.status, 'review_required', description)
    assert.equal(result.observation, null)
  })
}
for (const [description, fields] of [
  ['undated quotation', {}],
  ['wide day-only bounds', { validFrom: '2020-01-01',
    priceValidUntil: '2099-12-31' }],
  ['wide UTC timestamp bounds', { validFrom: '2020-01-01T00:00:00Z',
    priceValidUntil: '2099-12-31T23:59:59Z' }],
  ['nested corroborated wide bounds', { priceSpecification: {
    '@type': 'UnitPriceSpecification', price: '1.49',
    priceCurrency: 'EUR', validFrom: '2020-01-01',
    validThrough: '2099-12-31' } }],
]) {
  test('valid in-window offers are still private candidates: ' + description, async () => {
    const result = await propose(fields)
    assert.equal(result.status, 'candidate_needs_review', description)
    assert.equal(result.observation?.currentPriceCents, 149)
  })
}
