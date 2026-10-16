import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Local fictional URL, seller, product, permission policy and Response.
// This never contacts a retailer or claims a real checkout price.
const url = 'https://www.plus.nl/product/fictional-aggregate-20261016'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{ kind: 'written_permission',
      url: 'https://example.test/in-memory-fiction-not-real-permission',
      finding: 'Synthetic pack-price test, not retailer authorization' }],
  })),
}
async function capture(offers) {
  const product = {
    '@type': 'Product', url, sku: 'FICTION-AGGREGATE-123',
    name: 'Imaginary oats 500g', weight: { value: '500 g' }, offers,
  }
  const html = '<script type="application/ld+json">' + JSON.stringify(product) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
const concrete = () => ({
  '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock',
})
for (const [label, offers, expected] of [
  ['concrete single Offer', concrete(), 'candidate_needs_review'],
  ['AggregateOffer with equal low/high bounds', {
    '@type': 'AggregateOffer', lowPrice: '1.49', highPrice: '1.49',
    priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
  }, 'review_required'],
  ['AggregateOffer with explicit price', {
    '@type': 'AggregateOffer', price: '1.49',
    priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
  }, 'review_required'],
  ['valid concrete offer plus ambiguous aggregate offer', [
    concrete(), {
      '@type': 'AggregateOffer', lowPrice: '1.49', highPrice: '3.99',
      priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
    },
  ], 'review_required'],
  ['offer typed as both Offer and AggregateOffer', {
    ...concrete(), '@type': ['Offer', 'AggregateOffer'], lowPrice: '1.49',
  }, 'review_required'],
]) {
  test('only observed-looking concrete unit prices admitted privately: ' + label, async () => {
    const result = await capture(offers)
    assert.equal(result.status, expected)
    if (expected === 'review_required') assert.equal(result.observation, null)
    else assert.equal(result.observation?.currentPriceCents, 149)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
}
