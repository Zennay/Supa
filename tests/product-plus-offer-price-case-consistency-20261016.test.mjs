import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Pure in-memory synthetic offer metadata. Fictional test grant is not retailer permission.
const url = 'https://www.plus.nl/product/fictional-case-corroboration-qa-42'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fake-permission-no-real-scraping',
      finding: 'Synthetic contract test only' }],
  })),
}
async function inspect(overrides) {
  const product = {
    '@type': 'Product', url,
    name: 'Fictional pasta 500 gram for source-unit tests',
    sku: 'NOT-REAL-42', weight: { value: '500 g' },
    offers: {
      '@type': 'Offer', price: '0.85', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', ...overrides,
    },
  }
  const html = '<script type="application/ld+json">' +
    JSON.stringify(product) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
for (const [label, variants, expected] of [
  ['matching numeric uppercase price', { Price: 0.85 }, 'candidate_needs_review'],
  ['matching uppercase string PRICE', { PRICE: '0.85' }, 'candidate_needs_review'],
  ['three spellings with one conflicting', { Price: 0.85, PRICE: 0.84 }, 'review_required'],
  ['uppercase nonsense string', { Price: 'not-a-price' }, 'review_required'],
  ['uppercase null', { Price: null }, 'review_required'],
  ['alternate non-cent price', { Price: '0.851' }, 'review_required'],
  ['alternate negative amount', { Price: -0.85 }, 'review_required'],
]) {
  test('PLUS same-object Offer price provenance: ' + label, async () => {
    const result = await inspect(variants)
    assert.equal(result.status, expected)
    if (expected === 'review_required') {
      assert.equal(result.observation, null)
    } else {
      assert.equal(result.observation?.currentPriceCents, 85)
    }
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
}
