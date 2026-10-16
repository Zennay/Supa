import assert from 'node:assert/strict'
import test from 'node:test'
import { readAuthorizedHtmlScriptEvidence } from
  '../scripts/retailer-approved-html-script-evidence.mjs'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// INDEPENDENT QA. Every price, page, grant and response below is synthetic,
// created in memory, and never a live PLUS/DekaMarkt retail observation.
const url = 'https://www.plus.nl/product/fictional-qa-inert-script-824'
const mockProduct = {
  '@type': 'Product', url, sku: '824', name: 'Entirely fictional 500g QA pack',
  weight: { value: '500 g' },
  offers: { '@type': 'Offer', price: '0.01', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
}
const markedScript = '<script type="application/ld+json">' +
  JSON.stringify(mockProduct) + '</script>'
const testGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/qa-fiction-not-a-retailer-grant',
      finding: 'Synthetic offline QA, not actual source authorization' }],
  })),
}
function capture(html) {
  return captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate: testGate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt: new Date(Date.now() - 30_000).toISOString(),
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
}

test('genuine active JSON-LD <script> stays a private review candidate', async () => {
  const html = '<!doctype html><html><head>' + markedScript +
    '</head><body>Fictional QA</body></html>'
  const parsed = readAuthorizedHtmlScriptEvidence(html)
  assert.equal(parsed.invalid, false)
  assert.equal(parsed.jsonLdBlocks.length, 1)
  const result = await capture(html)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 1)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
})

// A regexp searching HTML bytes can mistake inert markup for a parsed live
// script element. Comment/template/textarea contents do not authorize price
// evidence, even if the inner JSON and source SHA match byte-for-byte.
for (const [label, html] of [
  ['HTML comment', '<!doctype html><!-- ' + markedScript +
    ' --><main>no structured active product</main>'],
  ['template content', '<!doctype html><template>' + markedScript +
    '</template><main>no active product script</main>'],
  ['textarea text', '<!doctype html><textarea>' + markedScript +
    '</textarea><main>no active product script</main>'],
]) {
  test(label + ' cannot impersonate a live JSON-LD Product script or become a price', async () => {
    const evidence = readAuthorizedHtmlScriptEvidence(html)
    // Only *parsed live script elements* qualify as evidence.
    assert.equal(evidence.jsonLdBlocks.length, 0,
      label + ' must not yield active script metadata')
    const result = await capture(html)
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    assert.equal(result.verifiedCurrentCheckoutPrice, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.published, false)
  })
}
