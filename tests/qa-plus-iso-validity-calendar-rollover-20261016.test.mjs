import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

/**
 * Independent QA2 of SOURCE calendar-date evidence on frozen product owner
 * #3641. JavaScript Date.parse normalizes some invalid ISO date-times, e.g.
 * February 30 becomes March 1. A normalized but nonexistent source date
 * cannot justify that an Offer was effective when captured or reviewed.
 *
 * ALL retailers, grants, packs, EUR cents and HTML here are fictional. The
 * Response is supplied in-memory: no DNS, HTTP, actual rights or shopper data.
 */
const url = 'https://www.plus.nl/product/fake-calendar-qa-500g'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/synthetic-not-real-retailer-permission',
      finding: 'Fictitious test grant only',
    }],
  })),
}
async function inspect(fields) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url, sku: 'FICTIONAL-ISO-CALENDAR-QA',
    name: 'Fictional flour 500 g', weight: { value: '500 g' },
    offers: {
      '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', ...fields,
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
function neverPublic(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
}

for (const [name, offer] of [
  ['nonexistent Feb 30 beginning in 2020', { validFrom: '2020-02-30T10:00:00Z' }],
  ['nonexistent Feb 30 expiry in 2099', { priceValidUntil: '2099-02-30T23:59:59Z' }],
  ['nonexistent April 31 offset timestamp', { validFrom: '2020-04-31T12:00:00+00:00' }],
  ['nested UnitPriceSpecification Feb 30 validThrough', {
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validThrough: '2099-02-30T10:00:00+00:00',
    },
  }],
]) {
  test('PLUS invalid calendar timestamp must NOT certify private price: ' + name, async () => {
    const result = await inspect(offer)
    assert.equal(result.status, 'review_required',
      'JavaScript Date.parse calendar rollover is not source evidence')
    assert.equal(result.observation, null)
    neverPublic(result)
  })
}

for (const [name, offer] of [
  ['valid Gregorian leap-day endpoints', {
    validFrom: '2020-02-29T00:00:00Z',
    priceValidUntil: '2096-02-29T23:59:59Z',
  }],
  ['valid offset leap-day nested specification', {
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validFrom: '2020-02-29T01:00:00+01:00',
      validThrough: '2096-02-29T23:00:00+00:00',
    },
  }],
]) {
  test('PLUS real leap-day quotation remains private only: ' + name, async () => {
    const result = await inspect(offer)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.currentPriceCents, 149)
    neverPublic(result)
  })
}
