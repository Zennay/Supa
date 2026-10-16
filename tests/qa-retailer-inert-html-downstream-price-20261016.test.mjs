import assert from 'node:assert/strict'
import test from 'node:test'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Separate end-to-end downstream acceptance check. The original inert-script
// parser unit tests remain BYTE-IDENTICAL. This mock grants rights only to an
// in-memory fixture URL: NOT a real PLUS permission or actual product price.
const url = 'https://www.plus.nl/product/fictional-inert-qa-824'
const syntheticProduct = {
  '@type': 'Product', url, sku: '824', name: 'Fictional test pack',
  weight: { value: '500 g' },
  offers: { '@type': 'Offer', price: '0.01', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
}
const tag = '<script type="application/ld+json">' +
  JSON.stringify(syntheticProduct) + '</script>'
const syntheticGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/not-a-real-grant-qa',
      finding: 'Artificial test fixture; no real licensed capture' }],
  })),
}
const scenarios = [
  ['commented-out markup', '<!-- ' + tag + ' -->'],
  ['inert template', '<template>' + tag + '</template>'],
  ['textarea literal text', '<textarea>' + tag + '</textarea>'],
]
for (const [label, body] of scenarios) {
  test('inert ' + label + ' cannot become even a private PLUS price candidate', async () => {
    let fetchCalls = 0
    const result = await captureApprovedProductPriceCandidate({
      source: { supermarket: 'plus', kind: 'product', url },
      permissionGate: syntheticGate,
      grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
        reviewed: true, termsReviewed: true, robotsReviewed: true,
        noAntiBotBypass: true },
      capturedAt: new Date(Date.now() - 30_000).toISOString(),
      fetchFn: async () => {
        fetchCalls++
        return new Response('<!doctype html><html><body>' + body + '</body></html>', {
          status: 200, headers: { 'content-type': 'text/html' },
        })
      },
    })
    assert.equal(fetchCalls, 1)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
  })
}
