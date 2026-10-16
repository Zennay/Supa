import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Private offline contract: structured Product->price must never be inferred
// from JSON duplicate keys, including Unicode-escaped collisions.
// Uses an invented grant and injected Response, not real retailer permission.
const url = 'https://www.plus.nl/product/fictional-duplicate-jsonld-725'
const fakeWrittenPermission = {
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket,
    technicalStatus: 'proven',
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-test-not-a-permission',
      finding: 'Private synthetic test, not a real license' }],
  })),
}
const product = {
  '@type': 'Product',
  url, sku: '725', name: 'Fictional test-only 600g pack',
  weight: { value: '600 g' },
  offers: {
    '@type': 'Offer', price: '2.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  },
}
const base = JSON.stringify(product)
const urlField = '"url":' + JSON.stringify(url)
const priceField = '"price":"2.49"'

async function capture(json) {
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: fakeWrittenPermission,
    grant: {
      supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(
      '<script type="application/ld+json">' + json + '</script>', {
        status: 200, headers: { 'content-type': 'text/html' },
      },
    ),
  })
}

function assertPrivateHold(result) {
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.publicSavingsClaimEligible, false)
}

test('ordinary unambiguous JSON-LD remains review-only even with synthetic approval', async () => {
  const result = await capture(base)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 249)
  assertPrivateHold(result)
})

for (const [name, json] of [
  ['escaped duplicate Product.url', base.replace(urlField,
    String.raw`"\u0075rl":"https://foreign.example.test/fake-000",` + urlField)],
  ['escaped duplicate Offer.price', base.replace(priceField,
    String.raw`"\u0070rice":"0.01",` + priceField)],
  ['escaped duplicate unrelated key inside Product', base.replace(urlField,
    String.raw`"a/b":1,"a\/b":2,` + urlField)],
]) {
  test('private candidate refuses ' + name + ' before price selection', async () => {
    assert.notEqual(json, base)
    const result = await capture(json)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    assertPrivateHold(result)
  })
}

test('literal JSON backslash-u name remains distinct, never silently changes price', async () => {
  const json = base.replace(urlField,
    String.raw`"\\u0075rl":"not-a-source-URL",` + urlField)
  const result = await capture(json)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 249)
  assertPrivateHold(result)
})
