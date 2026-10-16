import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Every price, grant, SKU, HTML body and Response below is synthetic.
// There is no live retail I/O, license, customer information or publication.
const sourceUrl = 'https://www.plus.nl/product/fictional-parallel-price-12345'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-consensus-only',
      finding: 'Synthetic injection is not actual supermarket permission' }],
  })),
}
const valid = () => ({
  '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
async function candidate(offers) {
  const product = {
    '@type': 'Product', url: sourceUrl, name: 'Fictional oats 500 gram',
    sku: 'FAKE-12345', weight: { value: '500 g' }, offers,
  }
  const html = '<script type="application/ld+json">' + JSON.stringify(product) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    permissionGate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl,
      reviewed: true, termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
for (const [name, offers, status] of [
  ['single valid Offer', valid(), 'candidate_needs_review'],
  ['two corroborating valid offers', [valid(), valid()], 'candidate_needs_review'],
  ['Offer and matching valid priceSpecification', {
    ...valid(), priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49', priceCurrency: 'EUR',
    },
  }, 'candidate_needs_review'],
  ['one malformed secondary Offer', [valid(), {
    ...valid(), price: 'NOT-A-PRICE',
  }], 'review_required'],
  ['one negative secondary Offer', [valid(), {
    ...valid(), price: '-1.00',
  }], 'review_required'],
  ['bad parallel explicit lowPrice', {
    ...valid(), lowPrice: 'bad-size',
  }, 'review_required'],
  ['zero parallel priceSpecification amount', {
    ...valid(), priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '0.00', priceCurrency: 'EUR',
    },
  }, 'review_required'],
  ['nested malformed secondary PriceSpecification', {
    ...valid(), priceSpecification: [{
      '@type': 'UnitPriceSpecification', price: '1.49', priceCurrency: 'EUR',
    }, {
      '@type': 'UnitPriceSpecification', price: 'not-numeric', priceCurrency: 'EUR',
    }],
  }, 'review_required'],
]) {
  test('PLUS parallel source prices: ' + name, async () => {
    const result = await candidate(offers)
    assert.equal(result.status, status)
    if (status === 'candidate_needs_review') {
      assert.equal(result.observation?.currentPriceCents, 149)
    } else {
      assert.equal(result.observation, null)
    }
    assert.equal(result.humanReviewRequired, true)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
}
