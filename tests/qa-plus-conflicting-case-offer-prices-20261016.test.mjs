import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Offline independent QA: a PLUS product cannot treat one case-spelling of
// an Offer price as trustworthy while another explicit spelling contradicts it.
// Fake permission/HTTP/HTML/prices only: no outbound requests or real retailer
// authorization, observations, customer information or published savings.
const sourceUrl = 'https://www.plus.nl/product/fictional-shelf-qa-123'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket,
    technicalStatus: 'proven',
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictional-local-qa-only',
      finding: 'Synthetic in-memory QA evidence, grants no actual rights',
    }],
  })),
}
async function candidate(caseVariants = {}) {
  const product = {
    '@type': 'Product',
    url: sourceUrl,
    name: 'Invented fictional PLUS pasta 500 g',
    sku: 'FAKE-PLUS-123',
    weight: { value: '500 g' },
    offers: {
      '@type': 'Offer',
      price: '0.85',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      ...caseVariants,
    },
  }
  const html = '<!doctype html><html><head><script type="application/ld+json">' +
    JSON.stringify(product) + '</script></head><body>Offline synthetic page</body></html>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    permissionGate,
    grant: {
      supermarket: 'plus',
      kind: 'product', sourceUrl,
      reviewed: true, termsReviewed: true,
      robotsReviewed: true, noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function privateOnly(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
}
test('PLUS one unambiguous lowercase EUR Offer price remains private-only', async () => {
  const result = await candidate()
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.equal(result.observation.pack.amount, 500)
  privateOnly(result)
})
for (const [label, extra] of [
  ['uppercase Price 84c contradicts lowercase price 85c', { Price: 0.84 }],
  ['uppercase PRICE 84c contradicts lowercase price 85c', { PRICE: '0.84' }],
  ['lowercase price 85c contradicts uppercase Price 86c', { Price: 0.86 }],
]) {
  test('PLUS contradictory case-spelled Offer price must abstain: ' + label, async () => {
    const result = await candidate(extra)
    assert.equal(result.status, 'review_required',
      'two distinct on-page case variants are not an independent observed checkout price')
    assert.equal(result.observation, null)
    privateOnly(result)
  })
}
