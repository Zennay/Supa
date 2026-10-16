import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent M3 source-quality QA: invalid explicitly declared secondary
// prices must not be silently discarded while retaining one valid offer.
// Synthetic HTML, fake grants, local in-memory Response; NEVER retailer HTTP.
const sourceUrl = 'https://www.plus.nl/product/fictitious-offer-consensus'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/qa-fiction-not-supermarket-rights',
      finding: 'Fabricated authorization for in-memory regression ONLY',
    }],
  })),
}
const validOffer = () => ({
  '@type': 'Offer',
  price: '1.49',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})

async function capture(offers) {
  const product = {
    '@type': 'Product',
    url: sourceUrl,
    name: 'Invented PLUS oatmeal 500 g',
    sku: 'FAKE-M3-QA-PRICE-001',
    weight: { value: '500 g' },
    offers,
  }
  const html = '<!doctype html><html><head><script type="application/ld+json">' +
    JSON.stringify(product) + '</script></head><body>synthetic</body></html>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    permissionGate: gate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl,
      reviewed: true, termsReviewed: true,
      robotsReviewed: true, noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  })
}
function neverPublish(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
}
test('single canonical EUR offer is still a private candidate', async () => {
  const result = await capture(validOffer())
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation?.currentPriceCents, 149)
  neverPublish(result)
})
for (const [label, offers] of [
  ['second typed Offer declares an invalid price', [
    validOffer(),
    { ...validOffer(), price: 'UNPARSEABLE_PRICE' },
  ]],
  ['single valid Offer has invalid parallel PriceSpecification', {
    ...validOffer(),
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: 'UNPARSEABLE_PRICE',
      priceCurrency: 'EUR',
    },
  }],
  ['invalid negative PriceSpecification cannot be ignored', {
    ...validOffer(),
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: '-1.00',
      priceCurrency: 'EUR',
    },
  }],
]) {
  test('PLUS explicitly malformed parallel Offer price must fail closed: ' + label, async () => {
    const result = await capture(offers)
    assert.equal(result.status, 'review_required',
      'invalid parallel price evidence must not certify a private priced candidate')
    assert.equal(result.observation, null)
    neverPublish(result)
  })
}
