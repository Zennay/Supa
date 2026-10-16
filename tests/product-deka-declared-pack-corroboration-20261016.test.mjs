import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Independent product-core boundary cases. Historical local fixture *shape*
// and entirely injected HTML/Response; fictional permission ONLY for tests.
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
      url: 'https://example.test/fictional-permission-not-real',
      finding: 'Only fictional injected HTML; grants no actual retailer rights' }],
  })),
}

async function capture(weight, { dualPrice = true } = {}) {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.url = url
  ld.sku = '115873'
  if (weight !== undefined) ld.weight = weight
  if (dualPrice) ld.offers.price = '0.85'
  const html = '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(fixture.nuxtPayload) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'dekamarkt', kind: 'product', url },
    permissionGate: gate,
    grant: { supermarket: 'dekamarkt', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}

for (const [name, weight, dualPrice, expected] of [
  ['unit equivalent one liter', { value: '1 l' }, true, 'candidate_needs_review'],
  ['historical absent pack declaration', undefined, false, 'candidate_needs_review'],
  ['unparseable explicit quantity', { value: 'about one liter' }, true, 'review_required'],
  ['wrong physical unit despite matching number', { value: '1000 g' }, true, 'review_required'],
  ['multipack differs from one physical bottle', { value: '2x500 ml' }, true, 'review_required'],
  ['explicit unsupported numeric amount', { value: 1000 }, true, 'review_required'],
  ['explicit null pack evidence', null, true, 'review_required'],
]) {
  test('Deka declared pack source consistency: ' + name, async () => {
    const result = await capture(weight, { dualPrice })
    assert.equal(result.status, expected)
    assert.equal(result.observation === null, expected === 'review_required')
    if (expected === 'candidate_needs_review') {
      assert.equal(result.observation.currentPriceCents, 85)
    }
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
}
