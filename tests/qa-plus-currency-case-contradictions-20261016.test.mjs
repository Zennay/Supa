import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// QA-only: two different case spellings of a currency field are two explicit
// source claims. Fictional HTML, URL, source grant, price and Response only.
const url = 'https://www.plus.nl/product/fictional-currency-case-consensus'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/offline-only-not-actual-permission',
      finding: 'Invented test authorization; never retailer rights' }],
  })),
}
async function inspect(offers) {
  const jsonLd = {
    '@type': 'Product', url, sku: 'FICTITIOUS-CURRENCY-001',
    name: 'Fictional oat flakes 500 g',
    weight: { value: '500 g' }, offers,
  }
  const html = '<script type="application/ld+json">' +
    JSON.stringify(jsonLd) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true,
      robotsReviewed: true, noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
const euroOffer = () => ({
  '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
function neverPublish(r) {
  assert.equal(r.humanReviewRequired, true)
  assert.equal(r.productionEnabled, false)
  assert.equal(r.published, false)
  assert.equal(r.verifiedCurrentCheckoutPrice, false)
  assert.equal(r.publicSavingsClaimEligible, false)
}
for (const [label, offer] of [
  ['single explicit EUR', euroOffer()],
  ['two corroborating EUR and eur spellings', {
    ...euroOffer(), PriceCurrency: 'eur',
  }],
]) {
  test('PLUS agreed currency evidence yields private-only review: ' + label, async () => {
    const result = await inspect(offer)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    neverPublish(result)
  })
}
for (const [label, offer] of [
  ['Offer priceCurrency EUR contradicts PriceCurrency GBP', {
    ...euroOffer(), PriceCurrency: 'GBP',
  }],
  ['Offer priceCurrency EUR contradicts PRICECURRENCY USD', {
    ...euroOffer(), PRICECURRENCY: 'USD',
  }],
  ['nested PriceSpecification currency EUR contradicts mixed-case GBP', {
    ...euroOffer(), priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: '1.49', priceCurrency: 'EUR', PriceCurrency: 'GBP',
    },
  }],
]) {
  test('PLUS conflicting explicit currency case spellings must abstain: ' + label, async () => {
    const result = await inspect(offer)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    neverPublish(result)
  })
}
