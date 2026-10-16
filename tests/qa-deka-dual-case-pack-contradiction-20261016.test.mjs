import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent QA: a matching price is not enough to certify a contradictory
// physical pack. These are invented, in-memory source and grant fixtures.
// No retailer HTTP, live permission, checkout prices or production writes.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url),
  'utf8',
))
const sourceUrl = fixture.source.url
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-qa-not-a-real-grant',
      finding: 'Synthetic grant for in-memory regression only' }],
  })),
}

async function capture(weight) {
  const product = structuredClone(fixture.jsonLdProduct)
  product.url = sourceUrl
  product.sku = '115873'
  product.weight = { value: weight }
  // Both JSON-LD case variants agree with the embedded fictional Nuxt 85c.
  // Only the physical pack size changes between the positive and negatives.
  product.offers.price = '0.85'
  product.offers.Price = 0.85
  const html = '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(fixture.nuxtPayload) +
    '</script><script type="application/ld+json">' +
    JSON.stringify(product) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'dekamarkt', kind: 'product', url: sourceUrl },
    permissionGate: gate,
    grant: {
      supermarket: 'dekamarkt', kind: 'product', sourceUrl,
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

test('matching JSON-LD and Nuxt physical 1-liter pack remains a private candidate', async () => {
  const result = await capture('1000 ml')
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation?.currentPriceCents, 85)
  assertNeverPublic(result)
})

for (const [name, size] of [
  ['half-liter mismatch', '500 ml'],
  ['larger 1.5-liter mismatch', '1500 ml'],
]) {
  test('Deka dual-case price cannot launder contradictory physical pack: ' + name, async () => {
    // Nuxt still reports one liter on this synthetic page. If JSON-LD
    // expressly reports another pack, no same-page corroborated price exists.
    const result = await capture(size)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    assertNeverPublic(result)
  })
}
