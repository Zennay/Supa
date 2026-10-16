import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Synthetic QA-only multi-Offer validity acceptance on frozen M3 source.
// Never sends a request to any retailer; grants, article, prices, dates,
// HTML and injected Response are fictional local test values.
const url = 'https://www.plus.nl/product/fictional-multi-offer-validity'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictional-qa-not-source-rights',
      finding: 'In-memory grant only; not real permission',
    }],
  })),
}
const active = () => ({
  '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
  validFrom: '2020-01-01', priceValidUntil: '2099-12-31',
})
async function capture(offers) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url, sku: 'FICTITIOUS-PLUS-MULTI-OFFER',
    name: 'Fictional wholegrain rice 500 g', weight: { value: '500 g' },
    offers,
  }) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true,
      robotsReviewed: true, noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function neverPublic(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
}
for (const [name, offers] of [
  ['single currently active Offer', active()],
  ['two independently active, matching EUR 149c Offers', [active(), active()]],
]) {
  test('PLUS active multi-offer positive remains private: ' + name, async () => {
    const r = await capture(offers)
    assert.equal(r.status, 'candidate_needs_review')
    assert.equal(r.observation?.currentPriceCents, 149)
    neverPublic(r)
  })
}
for (const [name, offers] of [
  ['one matching Offer expired, the other active', [
    active(), { ...active(), priceValidUntil: '2020-01-02' },
  ]],
  ['two same-price InStock Offers both future-effective', [
    { ...active(), validFrom: '2099-01-01' },
    { ...active(), validFrom: '2099-01-01' },
  ]],
  ['one nested UnitPriceSpecification expired, parallel Offer active', [
    active(), {
      ...active(),
      priceSpecification: {
        '@type': 'UnitPriceSpecification', price: '1.49',
        priceCurrency: 'EUR', validThrough: '2020-01-02',
      },
    },
  ]],
]) {
  test('PLUS conflicting time validity across matching price offers must abstain: ' + name, async () => {
    const r = await capture(offers)
    assert.equal(r.status, 'review_required',
      'equal cents and InStock do not validate an expired or future source offer')
    assert.equal(r.observation, null)
    neverPublic(r)
  })
}
