import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent QA for historical AggregateOffer exact-price concern (#2643).
// All records/permission grants/Response are fictitious and injected offline.
// A range floor is not an observed unit checkout price, even on an in-stock
// product with a verified source URL and explicit EUR.
const url = 'https://www.plus.nl/product/fictional-range-not-actual-unit-price'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/synthetic-only-not-real-source-rights',
      finding: 'Invented offline QA permission, no retailer access' }],
  })),
}
async function capture(offers) {
  const item = {
    '@type': 'Product', url,
    name: 'Invented PLUS product pack 500 g',
    sku: 'FAKE-AGGREGATE-QA',
    weight: { value: '500 g' },
    offers,
  }
  const html = '<script type="application/ld+json">' +
    JSON.stringify(item) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function privateOnly(x) {
  assert.equal(x.productionEnabled, false)
  assert.equal(x.published, false)
  assert.equal(x.humanReviewRequired, true)
  assert.equal(x.publicSavingsClaimEligible, false)
  assert.equal(x.verifiedCurrentCheckoutPrice, false)
}
test('one concrete EUR Offer remains private-only candidate', async () => {
  const result = await capture({
    '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  })
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation?.currentPriceCents, 149)
  privateOnly(result)
})
for (const [label, lowPrice, highPrice] of [
  ['unobserved 149c floor from 149–399c range', '1.49', '3.99'],
  ['unobserved 149c floor even when highPrice is missing', '1.49', undefined],
]) {
  test('AggregateOffer lowPrice is not a single product checkout price: ' + label, async () => {
    const result = await capture({
      '@type': 'AggregateOffer', lowPrice,
      ...(highPrice === undefined ? {} : { highPrice }),
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    })
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    privateOnly(result)
  })
}
