import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent M3 QA. All grants, EUR offers, URLs and HTML are fictional local
// injected evidence. No actual PLUS request, rights, prices or publication.
const url = 'https://www.plus.nl/product/fictional-price-lowprice-consensus'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus','dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/qa-only-no-real-retailer-authorization',
      finding: 'In-memory fake grant; never a supermarket source right' }],
  })),
}
const baseOffer = () => ({
  '@type': 'Offer',
  price: '1.49',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
async function proposed(offers) {
  const ld = {
    '@type': 'Product',
    url,
    sku: 'FICTIONAL-OFFER-149',
    name: 'Fictitious PLUS oats 500 g',
    weight: { value: '500 g' },
    offers,
  }
  const html = '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function privateOnly(x) {
  assert.equal(x.humanReviewRequired, true)
  assert.equal(x.productionEnabled, false)
  assert.equal(x.published, false)
  assert.equal(x.publicSavingsClaimEligible, false)
  assert.equal(x.verifiedCurrentCheckoutPrice, false)
}
for (const [name, offer] of [
  ['one unambiguous EUR price', baseOffer()],
  ['two corroborating amounts price=lowPrice', { ...baseOffer(), lowPrice: '1.49' }],
]) {
  test('PLUS agreed product Offer remains private-only: ' + name, async () => {
    const result = await proposed(offer)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    privateOnly(result)
  })
}
for (const [name, offer] of [
  ['Offer price 149c vs explicit lowPrice 99c', { ...baseOffer(), lowPrice: '0.99' }],
  ['Offer price 149c vs explicit lowPrice 199c', { ...baseOffer(), lowPrice: '1.99' }],
  ['PriceSpecification price 149c vs explicit lowPrice 99c', {
    ...baseOffer(), priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      lowPrice: '0.99', priceCurrency: 'EUR',
    },
  }],
]) {
  test('PLUS contradictory explicit price and lowPrice must abstain: ' + name, async () => {
    const result = await proposed(offer)
    assert.equal(result.status, 'review_required',
      'two explicitly conflicting on-page monetary declarations cannot prove one pack price')
    assert.equal(result.observation, null)
    privateOnly(result)
  })
}
