import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent source-consistency QA, not a retailer capture. A Deka page can
// present two equivalent JSON-LD price spellings that BOTH disagree with Nuxt.
// The private candidate must not call an uncorroborated price observed.
// All grant and HTML data below are fictional/in-memory, without real I/O.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url),
  'utf8',
))
const url = fixture.source.url
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket,
    technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission', url: 'https://example.test/fictional-only',
      finding: 'In-memory QA only: absolutely no permission implied',
    }],
  })),
}
async function candidate(lowercasePrice, uppercasePrice) {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.url = url
  ld.sku = '115873'
  ld.weight = { value: '1000 ml' }
  ld.offers.price = lowercasePrice
  ld.offers.Price = uppercasePrice
  const html =
    '<script id="__NUXT_DATA__" type="application/json">' +
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
function notPublic(result) {
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
}
test('control: both JSON-LD case prices agree with observed 85c Nuxt', async () => {
  const result = await candidate('0.85', 0.85)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 85)
  notPublic(result)
})
for (const [name, lower, upper] of [
  ['both numeric 84c', 0.84, 0.84],
  ['lowercase string 84c and uppercase numeric 84c', '0.84', 0.84],
]) {
  test('same-page Nuxt disagreement must refuse ' + name, async () => {
    // Nuxt fixture is 85 cents; equivalent 84c JSON-LD prices are NOT enough
    // to corroborate actual source price just because case variants agree.
    const result = await candidate(lower, upper)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    notPublic(result)
  })
}
