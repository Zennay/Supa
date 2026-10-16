import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// QA-only synthetic same-page stock evidence consensus, no actual source rights,
// HTTP request, customer data, checkout price, storage, publication or savings.
const url = 'https://www.plus.nl/product/fictitious-stock-evidence'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fake-in-memory-rights-only',
      finding: 'Synthetic grant not a real license',
    }],
  })),
}
const offer = () => ({
  '@type': 'Offer',
  price: '1.49', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
async function inspect(offers) {
  const product = {
    '@type': 'Product', url, name: 'Invented flakes 500g',
    sku: 'FAKE-PLUS-STOCK-QA', weight: { value: '500 g' }, offers,
  }
  const html = '<script type="application/ld+json">' +
    JSON.stringify(product) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: gate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function neverPublic(r) {
  assert.equal(r.humanReviewRequired, true)
  assert.equal(r.productionEnabled, false)
  assert.equal(r.published, false)
  assert.equal(r.verifiedCurrentCheckoutPrice, false)
  assert.equal(r.publicSavingsClaimEligible, false)
}
for (const [label, o] of [
  ['single InStock', offer()],
  ['corroborating second mixed-case InStock', {
    ...offer(), Availability: 'https://schema.org/InStock',
  }],
]) {
  test('PLUS consistent stock remains a private candidate: ' + label, async () => {
    const result = await inspect(o)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    assert.equal(result.observation?.availability, 'available')
    neverPublic(result)
  })
}
for (const [label, o] of [
  ['InStock contradicts Availability OutOfStock', {
    ...offer(), Availability: 'https://schema.org/OutOfStock',
  }],
  ['InStock contradicts AVAILABILITY SoldOut', {
    ...offer(), AVAILABILITY: 'https://schema.org/SoldOut',
  }],
]) {
  test('PLUS explicit contradictory case-spelled stock blocks private candidate: ' + label, async () => {
    const result = await inspect(o)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    neverPublic(result)
  })
}
