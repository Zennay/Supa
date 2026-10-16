import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent quality-validation only: every permission, URL, product, response,
// amount and availability below is fictitious, in-memory test evidence. There
// are NO external requests, real retailer rights, checkout claims or publication.
const url = 'https://www.plus.nl/product/fictional-generic-case-price-qa'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/not-real-retailer-permission',
      finding: 'QA-only invented permission; explicitly not authorization',
    }],
  })),
}
function offer() {
  return {
    '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  }
}
async function inspect(offers) {
  const product = {
    '@type': 'Product', url, sku: 'FICTIONAL-PLUS-CASE-149',
    name: 'Invented PLUS rice 500 g', weight: { value: '500 g' }, offers,
  }
  const html = '<script type="application/ld+json">' + JSON.stringify(product) + '</script>'
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
function assertPrivate(r) {
  assert.equal(r.humanReviewRequired, true)
  assert.equal(r.productionEnabled, false)
  assert.equal(r.published, false)
  assert.equal(r.verifiedCurrentCheckoutPrice, false)
  assert.equal(r.publicSavingsClaimEligible, false)
}

// Corroboration controls should remain eligible for *private* human review.
for (const [name, offers] of [
  ['single unambiguous lowercase price', offer()],
  ['matching Offer Price 1.49 and price 1.49', { ...offer(), Price: '1.49' }],
  ['matching nested PriceSpecification price and PRICE', {
    ...offer(), priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: '1.49', PRICE: '1.49', priceCurrency: 'EUR',
    },
  }],
]) {
  test('PLUS generic Schema.org matching case-price claims remain private: ' + name, async () => {
    const result = await inspect(offers)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    assertPrivate(result)
  })
}

// A differently capitalized explicit field on the SAME typed Offer or
// PriceSpecification is still a source claim. Choosing the lowercase key
// alone can turn contradictory evidence into an unjustified private price.
for (const [name, offers] of [
  ['Offer.price 149c contradicts Offer.Price 199c', {
    ...offer(), Price: '1.99',
  }],
  ['Offer.price 149c alongside malformed Offer.PRICE', {
    ...offer(), PRICE: 'unavailable',
  }],
  ['nested PriceSpecification price 149c contradicts PRICE 99c', {
    ...offer(), priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: '1.49', PRICE: '0.99', priceCurrency: 'EUR',
    },
  }],
  ['Offer.lowPrice 149c contradicts LOWPRICE 199c', {
    ...offer(), price: undefined, lowPrice: '1.49', LOWPRICE: '1.99',
  }],
]) {
  test('PLUS generic Schema.org conflicting case-price evidence MUST abstain: ' + name, async () => {
    const result = await inspect(offers)
    assert.equal(result.status, 'review_required',
      'all explicit case-equivalent monetary claims must reconcile before private pricing')
    assert.equal(result.observation, null)
    assertPrivate(result)
  })
}
