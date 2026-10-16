import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Product-core in-memory private-only timestamp trust checks. Fictional source,
// fictional grant and injected Response: no real retailer I/O or publication.
const url = 'https://www.plus.nl/product/fictional-iso-clock-offset-proof'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fake-grant-no-retailer-permission',
      finding: 'Local mock only; real rights are not established',
    }],
  })),
}
async function quote(fields) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url, sku: 'FAKE-CLOCK-001',
    name: 'Synthetic wheat 500g', weight: { value: '500 g' },
    offers: {
      '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', ...fields,
    },
  }) + '</script>'
  const result = await captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  return result
}
for (const [label, fields] of [
  ['normalized 24 hour civil time', { validFrom: '2020-02-29T24:00:00Z' }],
  ['normalized 24 hour with offset', { validFrom: '2020-01-01T24:00:00+01:00' }],
  ['impossible civil minute', { validFrom: '2020-01-01T12:60:00Z' }],
  ['impossible civil second', { validFrom: '2020-01-01T12:01:60Z' }],
  ['impossible offset +15:00', { validFrom: '2020-01-01T10:00:00+15:00' }],
  ['impossible offset +14:01', { validFrom: '2020-01-01T10:00:00+14:01' }],
  ['impossible offset -18:00', { validFrom: '2020-01-01T10:00:00-18:00' }],
  ['unknown negative zero offset', { validFrom: '2020-01-01T10:00:00-00:00' }],
  ['nested impossible future offset', {
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validThrough: '2099-12-31T23:59:59+23:59',
    },
  }],
]) {
  test('malformed or indeterminate Offer civil time abstains: ' + label, async () => {
    const result = await quote(fields)
    assert.equal(result.status, 'review_required', label)
    assert.equal(result.observation, null)
  })
}
for (const [label, fields] of [
  ['exact UTC source start', { validFrom: '2020-01-01T00:00:00Z' }],
  ['UTC plus 14 real zone limit', { validFrom: '2020-01-01T14:00:00+14:00' }],
  ['UTC minus 14 limit', { validFrom: '2020-01-01T08:30:00-14:00' }],
  ['Dutch +02:00 offset', { validFrom: '2020-02-29T12:00:00+02:00' }],
  ['proper positive zero offset', { validFrom: '2020-02-29T00:00:00+00:00' }],
  ['valid nested future price expiry', { priceSpecification: {
    '@type': 'UnitPriceSpecification', price: '1.49',
    priceCurrency: 'EUR', validThrough: '2099-12-31T23:59:59+14:00',
  } }],
]) {
  test('valid RFC3339 Offer timestamp stays review-only: ' + label, async () => {
    const result = await quote(fields)
    assert.equal(result.status, 'candidate_needs_review', label)
    assert.equal(result.observation?.currentPriceCents, 149)
  })
}
