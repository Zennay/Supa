import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Cross-parser invariants for the FIXTURE'S STRUCTURE only. The historical
// Deka M1 fixture does not contain captured HTML. All HTML, grants and
// Responses here are fictional and in-memory; no retailer HTTP occurs.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url),
  'utf8'))
const url = fixture.source.url
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-qa-not-real-retailer-grant',
      finding: 'Synthetic unit test only; absolutely no retailer authorization' }],
  })),
}
async function capture(ld) {
  const html = '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(fixture.nuxtPayload) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
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
function augmentedLd(lowercasePrice, uppercasePrice) {
  const ld = structuredClone(fixture.jsonLdProduct)
  // Supply every field the GENERIC schema.org parser needs, so the common
  // parser can no longer abstain and trigger the independent Deka Nuxt check.
  ld.url = url
  ld.sku = '115873'
  ld.weight = { value: '1000 ml' }
  ld.offers.price = lowercasePrice
  ld.offers.Price = uppercasePrice
  return ld
}

test('consistent genuine historical Nuxt + uppercase Price remains PRIVATE', async () => {
  const candidate = await capture(fixture.jsonLdProduct)
  assert.equal(candidate.status, 'candidate_needs_review')
  assert.equal(candidate.observation.currentPriceCents, 85)
  assert.equal(candidate.publicSavingsClaimEligible, false)
  assert.equal(candidate.verifiedCurrentCheckoutPrice, false)
  assert.equal(candidate.productionEnabled, false)
  assert.equal(candidate.published, false)
})

test('Deka: forged cheaper lowercase price must not bypass conflicting uppercase Price + Nuxt', async () => {
  const result = await capture(augmentedLd('0.01', 0.85))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.productionEnabled, false)
})

test('Deka: consistent lowercase/Nuxt cannot silently ignore conflicting uppercase Price', async () => {
  const result = await capture(augmentedLd('0.85', 0.01))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.productionEnabled, false)
})
