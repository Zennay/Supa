import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent in-memory QA: two physically conflicting Product fields cannot
// certify one package merely because each uses a plain text amount. Fictional
// permission, product, source URL, EUR price and injected Response throughout.
const sourceUrl = 'https://www.plus.nl/product/fictional-package-identity'
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/in-memory-fiction-not-authorization',
      finding: 'Fake local QA grant only, never a retailer license',
    }],
  })),
}

async function captured(size) {
  const product = {
    '@type': 'Product',
    url: sourceUrl,
    name: 'Invented PLUS oats',
    sku: 'FICTIONAL-PACK-20261016',
    weight: { value: '500 g' },
    ...(size === undefined ? {} : { size: { value: size } }),
    offers: {
      '@type': 'Offer',
      price: '1.49',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
  const html = '<script type="application/ld+json">' +
    JSON.stringify(product) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url: sourceUrl },
    permissionGate: gate,
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
function remainsPrivate(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
}
for (const [label, size] of [
  ['no separate size field', undefined],
  ['two consistent 500-gram declarations', '500 g'],
]) {
  test('unambiguous PLUS package stays private candidate: ' + label, async () => {
    const result = await captured(size)
    assert.equal(result.status, 'candidate_needs_review')
    assert.equal(result.observation?.pack.amount, 500)
    assert.equal(result.observation?.pack.unit, 'g')
    remainsPrivate(result)
  })
}
for (const [label, size] of [
  ['500 g weight vs 1000 g size', '1000 g'],
  ['500 g weight vs 1000 ml size', '1000 ml'],
]) {
  test('PLUS cannot discard contradictory explicit Product.size: ' + label, async () => {
    const result = await captured(size)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    remainsPrivate(result)
  })
}
