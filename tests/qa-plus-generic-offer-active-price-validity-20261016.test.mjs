import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

/**
 * QA-only regression of the historical Offer-validity risks (#2638/#2665)
 * at the newer approved HTML -> generic Schema.org -> private candidate path.
 * Fictional PLUS URL/product/grant/prices/HTML; fetchFn is injected memory.
 * There is no real retailer network access, right, checkout or publication.
 */
const url = 'https://www.plus.nl/product/fictional-offer-validity-qa'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictitious-qa-not-real-source-rights',
      finding: 'Local test fixture; not a real retailer licence',
    }],
  })),
}
function normalOffer() {
  return {
    '@type': 'Offer',
    price: '1.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  }
}
async function inspect(offers) {
  const product = {
    '@type': 'Product', url, sku: 'FICTIONAL-PLUS-VALIDITY-149',
    name: 'Fictional oats 500 g', weight: { value: '500 g' },
    offers,
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
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function remainsPrivate(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
}
for (const [label, offers] of [
  ['ordinary undated one-pack Offer', normalOffer()],
  ['Offer effective since 2020 through 2099', {
    ...normalOffer(),
    validFrom: '2020-01-01', priceValidUntil: '2099-12-31',
  }],
  ['nested specification effective since 2020 through 2099', {
    ...normalOffer(),
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validFrom: '2020-01-01',
      validThrough: '2099-12-31',
    },
  }],
]) {
  test('PLUS valid time evidence remains a PRIVATE candidate: ' + label, async () => {
    const result = await inspect(offers)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    remainsPrivate(result)
  })
}
for (const [label, offers] of [
  ['Offer priceValidUntil expired in 2020', {
    ...normalOffer(), priceValidUntil: '2020-01-01',
  }],
  ['Offer validFrom starts in 2099', {
    ...normalOffer(), validFrom: '2099-01-01',
  }],
  ['nested UnitPriceSpecification validThrough expired in 2020', {
    ...normalOffer(), priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validThrough: '2020-01-01',
    },
  }],
  ['nested UnitPriceSpecification validFrom starts in 2099', {
    ...normalOffer(), priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validFrom: '2099-01-01',
    },
  }],
]) {
  test('PLUS explicitly inactive offer must not certify current private price: ' + label, async () => {
    const result = await inspect(offers)
    assert.equal(result.status, 'review_required',
      'A current physical pack price cannot be inferred from explicitly inactive source offer')
    assert.equal(result.observation, null)
    remainsPrivate(result)
  })
}
