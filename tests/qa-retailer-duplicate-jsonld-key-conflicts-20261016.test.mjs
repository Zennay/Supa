import assert from 'node:assert/strict'
import test from 'node:test'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// QA: synthetic, in-memory HTML only. No actual retailer grants/prices/crawl.
const url = 'https://www.plus.nl/product/fictional-duplicate-jsonld-725'
const product = {
  '@type': 'Product', url, sku: '725', name: 'Fictional reviewed 600g',
  weight: { value: '600 g' },
  offers: { '@type': 'Offer', price: '2.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
}
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-test-not-a-permission',
      finding: 'Synthetic in-memory QA fixture only' }],
  })),
}
async function capture(raw) {
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(
      '<script type="application/ld+json">' + raw + '</script>', {
        status: 200, headers: { 'content-type': 'text/html' },
      }),
  })
}
const baseline = JSON.stringify(product)

test('single-price, single-URL active JSON-LD stays strictly private', async () => {
  const result = await capture(baseline)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 249)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('duplicate conflicting Offer.price JSON keys cannot silently choose last cheap price', async () => {
  const raw = baseline.replace('"price":"2.49"',
    '"price":"999.99","price":"2.49"')
  assert.notEqual(raw, baseline)
  const result = await capture(raw)
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
})

test('duplicate conflicting Product.url keys cannot fake source-URL identity', async () => {
  const original = '"url":"' + url + '"'
  const raw = baseline.replace(original,
    '"url":"https://other.invalid/product/foreign-000",' + original)
  assert.notEqual(raw, baseline)
  const result = await capture(raw)
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
})
