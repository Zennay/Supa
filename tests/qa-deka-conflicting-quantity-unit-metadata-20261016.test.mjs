import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent QA: duplicate quantity evidence can contradict itself. Comparing
// weight.value alone is not corroboration if its explicit unitText/unitCode
// disagrees. All grants, HTML, prices and transports are synthetic in-memory.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url), 'utf8',
))
const url = fixture.source.url
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/in-memory-test-no-actual-retailer-license',
      finding: 'Synthetic offline test grant only' }],
  })),
}
async function inspect(weight) {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.url = url
  ld.sku = '115873'
  ld.weight = weight
  ld.offers.price = '0.85'
  ld.offers.Price = 0.85
  const html = '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(fixture.nuxtPayload) +
    '</script><script type="application/ld+json">' +
    JSON.stringify(ld) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'dekamarkt', kind: 'product', url },
    permissionGate: gate,
    grant: {
      supermarket: 'dekamarkt', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}
function neverPublished(result) {
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
}

test('matching textual quantity and explicit millilitre unit remains private', async () => {
  const result = await inspect({ '@type': 'QuantitativeValue', value: '1000 ml', unitText: 'ml' })
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation?.currentPriceCents, 85)
  neverPublished(result)
})

for (const [name, weight] of [
  ['gram unitText contradicts a 1000 ml quantity', {
    '@type': 'QuantitativeValue', value: '1000 ml', unitText: 'g',
  }],
  ['UN/CEFACT gram unitCode contradicts a 1000 ml quantity', {
    '@type': 'QuantitativeValue', value: '1000 ml', unitCode: 'GRM',
  }],
]) {
  test('Deka cannot ignore conflicting physical-unit evidence: ' + name, async () => {
    const result = await inspect(weight)
    assert.equal(result.status, 'review_required',
      'conflicting JSON-LD fields cannot authorize a proposed physical-pack price')
    assert.equal(result.observation, null)
    neverPublished(result)
  })
}
