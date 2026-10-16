import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Product-core own regressions. All credentials, retailer pages, grant records,
// stock statements and prices are invented. HTTPS transport is injected and
// never makes a real retailer request.
const sourceUrl = 'https://www.plus.nl/product/fictional-conflicting-offers-20261016'
const permissionGate = {
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/offline-fixture-not-actual-permission',
      finding: 'Synthetic source-only test, not a valid retailer grant' }],
  })),
}
const offer = () => ({
  '@type': 'Offer',
  price: '1.49',
  priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})

async function privateCandidate(overrides) {
  const product = {
    '@type': 'Product',
    url: sourceUrl,
    sku: 'FAKE-SKU-CONFLICT-20261016',
    name: 'Synthetic oats 500 g',
    weight: { value: '500 g' },
    offers: { ...offer(), ...overrides },
  }
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    permissionGate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(
      '<script type="application/ld+json">' + JSON.stringify(product) + '</script>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
  })
}
function privateOnly(result) {
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.humanReviewRequired, true)
}
for (const [label, overrides] of [
  ['lowercase price vs lowPrice 99c', { lowPrice: '0.99' }],
  ['lowercase price vs lowPrice 199c', { lowPrice: '1.99' }],
  ['uppercase LOWPRICE vs lowercase price', { LOWPRICE: '0.99' }],
  ['nested UnitPriceSpecification price vs lowPrice', {
    priceSpecification: { '@type': 'UnitPriceSpecification', price: '1.49',
      lowPrice: '0.99', priceCurrency: 'EUR' },
  }],
  ['nested upper LOWPRICE vs lower price', {
    priceSpecification: { '@type': 'UnitPriceSpecification', price: '1.49',
      LOWPRICE: '0.99', priceCurrency: 'EUR' },
  }],
  ['uppercase PRICE conflicts with lowercase price', { PRICE: '1.99' }],
  ['uppercase PriceCurrency conflicts with EUR', { PriceCurrency: 'GBP' }],
  ['uppercase PRICECURRENCY conflicts with EUR', { PRICECURRENCY: 'USD' }],
  ['nested case-spelled currency conflicts with EUR', {
    priceSpecification: { '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', PRICECURRENCY: 'GBP' },
  }],
  ['lowercase InStock contradicts Availability OutOfStock', {
    Availability: 'https://schema.org/OutOfStock',
  }],
  ['lowercase InStock contradicts AVAILABILITY SoldOut', {
    AVAILABILITY: 'https://schema.org/SoldOut',
  }],
  ['unknown upper availability is not proof of stock', {
    AVAILABILITY: 'UnexpectedStockMarker',
  }],
]) {
  test('PLUS source-integrity conflict refuses private quoted price: ' + label, async () => {
    const result = await privateCandidate(overrides)
    assert.equal(result.status, 'review_required', label)
    assert.equal(result.observation, null)
    privateOnly(result)
  })
}
for (const [label, overrides] of [
  ['ordinary concrete Offer', {}],
  ['price and lowPrice agree', { lowPrice: '1.49' }],
  ['PRICE corroborates price', { PRICE: '1.49' }],
  ['LOWPRICE corroborates price', { LOWPRICE: '1.49' }],
  ['same EUR in two cases', { PriceCurrency: 'eur' }],
  ['same InStock in two cases', { AVAILABILITY: 'https://schema.org/InStock' }],
  ['nested price statements corroborate', {
    priceSpecification: { '@type': 'UnitPriceSpecification', price: '1.49',
      lowPrice: '1.49', priceCurrency: 'EUR' },
  }],
]) {
  test('PLUS corroborating evidence remains private-only candidate: ' + label, async () => {
    const result = await privateCandidate(overrides)
    assert.equal(result.status, 'candidate_needs_review', label)
    assert.equal(result.observation?.currentPriceCents, 149)
    privateOnly(result)
  })
}
