import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// In-memory synthetic same-source inspection. Fictional grant is NOT real
// retailer permission, capture or verified grocery/checkout price.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url),
  'utf8',
))
const url = fixture.source.url
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-local-only', finding: 'synthetic' }],
  })),
}

async function inspect(lowercase, uppercase) {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.url = url
  ld.sku = '115873'
  ld.weight = { value: '1000 ml' }
  ld.offers.price = lowercase
  ld.offers.Price = uppercase
  const html = '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(fixture.nuxtPayload) + '</script><script type="application/ld+json">' +
    JSON.stringify(ld) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'dekamarkt', kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: 'dekamarkt', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}

test('equivalent numeric/string case spellings remain a private reviewed candidate', async () => {
  const result = await inspect('0.85', 0.85)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.productionEnabled, false)
})

test('invalid object-valued second price cannot be coerced to fake corroboration', async () => {
  const result = await inspect('0.85', { value: '0.85' })
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.productionEnabled, false)
})

test('same-store price case mismatch cannot produce privately proposed cheap price', async () => {
  const result = await inspect('0.85', '0.84')
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.publicSavingsClaimEligible, false)
})
