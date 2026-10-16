import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

/**
 * Independent QA: invalid real-world UTC offsets are not a trustworthy
 * retailer Offer price validity source even if JavaScript Date.parse accepts
 * them. This is separate from calendar-day rollover QA #3646.
 * All retailer, permission and price fixtures invented in memory; no DNS/HTTP.
 */
const url = 'https://www.plus.nl/product/fake-offset-qa-500g'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictional-permission-not-real',
      finding: 'Fictional test grant only',
    }],
  })),
}
async function inspect(offerClaims) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url, sku: 'FICTIONAL-OFFSET-QA',
    name: 'Fictional oats 500g', weight: { value: '500 g' },
    offers: {
      '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', ...offerClaims,
    },
  }) + '</script>'
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
function assertNeverPublic(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
}
for (const [name, claims] of [
  ['impossible +15:00 offset in past validFrom', {
    validFrom: '2020-01-01T10:00:00+15:00',
  }],
  ['impossible -15:00 offset in future priceValidUntil', {
    priceValidUntil: '2099-12-01T10:00:00-15:00',
  }],
  ['beyond current civil +14:01 offset nested validThrough', {
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validThrough: '2099-12-01T10:00:00+14:01',
    },
  }],
]) {
  test('private PLUS source must refuse ' + name, async () => {
    const result = await inspect(claims)
    assert.equal(result.status, 'review_required',
      'Unreal-world timezone offset cannot certify a private price')
    assert.equal(result.observation, null)
    assertNeverPublic(result)
  })
}
for (const [name, claims] of [
  ['legal +14:00 source offset', {
    validFrom: '2020-01-01T10:00:00+14:00',
  }],
  ['legal -12:00 source offset', {
    validFrom: '2020-01-01T10:00:00-12:00',
  }],
]) {
  test('private-only PLUS positive control: ' + name, async () => {
    const result = await inspect(claims)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    assertNeverPublic(result)
  })
}
