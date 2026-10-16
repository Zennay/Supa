import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Only in-memory fictional retailer data and a synthetic grant are used.
// No store network, credentials, persisted prices or publication.
const sourceUrl = 'https://www.plus.nl/product/fictional-gregorian-boundaries'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/synthetic-grant-not-real',
      finding: 'Entirely fictional and injected product test' }],
  })),
}
async function capture(offerFields) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url: sourceUrl, sku: 'SYNTHETIC-GREGORIAN-123',
    name: 'Imaginary 500g oats', weight: { value: '500 g' },
    offers: {
      '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', ...offerFields,
    },
  }) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    permissionGate,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function privateOnly(result) {
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.humanReviewRequired, true)
}
for (const [label, fields] of [
  ['1900 is not leap', { validFrom: '1900-02-29T12:00:00Z' }],
  ['2100 is not leap', { priceValidUntil: '2100-02-29T12:00:00Z' }],
  ['February cannot have day 30', { validFrom: '2020-02-30T00:00:00+02:00' }],
  ['April cannot have day 31', { priceValidUntil: '2099-04-31T23:59:59Z' }],
  ['November cannot have day 31', { validFrom: '2020-11-31T11:00:00Z' }],
  ['February 29 in 2021 is invalid', { validFrom: '2021-02-29' }],
  ['zero month is invalid', { validFrom: '2020-00-01T00:00:00Z' }],
  ['thirteenth month is invalid', { priceValidUntil: '2099-13-01T00:00:00Z' }],
  ['nested spec cannot claim April 31', {
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validThrough: '2099-04-31T00:00:00+01:00',
    },
  }],
]) {
  test('impossible Gregorian date never gives private priced candidate: ' + label, async () => {
    const result = await capture(fields)
    assert.equal(result.status, 'review_required', label)
    assert.equal(result.observation, null)
    privateOnly(result)
  })
}
for (const [label, fields] of [
  ['2000 is leap', { validFrom: '2000-02-29T00:00:00Z' }],
  ['2020 is leap with timezone', { validFrom: '2020-02-29T12:00:00+01:00' }],
  ['2096 is leap and future expiry', { priceValidUntil: '2096-02-29T23:59:59Z' }],
  ['day-only 2096 leap expiry inclusive', { priceValidUntil: '2096-02-29' }],
  ['far-past 2000 leap start and 2096 leap end', {
    validFrom: '2000-02-29T00:00:00+00:00',
    priceValidUntil: '2096-02-29T23:59:59+00:00',
  }],
]) {
  test('real Gregorian day preserves private review control: ' + label, async () => {
    const result = await capture(fields)
    assert.equal(result.status, 'candidate_needs_review', label)
    assert.equal(result.observation?.currentPriceCents, 149)
    privateOnly(result)
  })
}
