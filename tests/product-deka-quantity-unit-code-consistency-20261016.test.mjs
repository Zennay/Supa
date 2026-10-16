import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Synthetic unit declarations: no real supermarket requests or permissions.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url), 'utf8',
))
const url = fixture.source.url
const fakePermission = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/offline-only-does-not-grant-permission',
      finding: 'Invented grant, in-memory test only' }],
  })),
}
async function capture(weight) {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.url = url
  ld.sku = '115873'
  ld.weight = weight
  ld.offers.price = '0.85'
  const html = '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(fixture.nuxtPayload) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'dekamarkt', kind: 'product', url },
    permissionGate: fakePermission,
    grant: { supermarket: 'dekamarkt', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, { status: 200,
      headers: { 'content-type': 'text/html' } }),
  })
}
for (const [label, weight, expected] of [
  ['valid matching MLT UN/CEFACT code', {
    value: '1000 ml', unitCode: 'MLT',
  }, 'candidate_needs_review'],
  ['valid equivalent liter and textual liter alias', {
    value: '1 l', unitText: 'liter', unitCode: 'LTR',
  }, 'candidate_needs_review'],
  ['valid both milliliter signals', {
    value: '1000 ml', unitText: 'ml', unitCode: 'MLT',
  }, 'candidate_needs_review'],
  ['contradictory liter vs milliliter same number', {
    value: '1000 ml', unitCode: 'LTR',
  }, 'review_required'],
  ['contradictory gram unitCode alongside ml unitText', {
    value: '1000 ml', unitText: 'ml', unitCode: 'GRM',
  }, 'review_required'],
  ['unsupported explicit unit code', {
    value: '1000 ml', unitCode: 'UNKNOWN',
  }, 'review_required'],
  ['unsupported explicit unitText', {
    value: '1000 ml', unitText: 'vague bottles',
  }, 'review_required'],
  ['nontextual unit code', {
    value: '1000 ml', unitCode: 999,
  }, 'review_required'],
  ['nontextual unitText', {
    value: '1000 ml', unitText: null,
  }, 'review_required'],
]) {
  test('Deka source quantity unit integrity: ' + label, async () => {
    const result = await capture(weight)
    assert.equal(result.status, expected)
    if (expected === 'candidate_needs_review') {
      assert.equal(result.observation?.currentPriceCents, 85)
    } else {
      assert.equal(result.observation, null)
    }
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
}
