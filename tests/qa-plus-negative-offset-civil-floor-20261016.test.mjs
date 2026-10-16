import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

/**
 * Independent QA on fixed owner #3651: present-day civil UTC offsets range
 * -12:00 .. +14:00, NOT symmetrical +/-14:00. A time written as -13:00
 * or -14:00 is syntactically ISO-shaped but not trustworthy as a retail
 * Offer civil time in 2020. Distinct from previously tested -15:00.
 *
 * In-memory invented retailer, grant, HTML and price; no external requests.
 */
const url = 'https://www.plus.nl/product/fake-negative-offset-qa-500g'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{kind: 'written_permission',
      url: 'https://example.test/fictional-not-real-permission',
      finding: 'Fictitious offline test grant only'}],
  })),
}
async function candidate(priceWindow) {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url, sku: 'FICTIONAL-UTC-CIVIL-FLOOR',
    name: 'Fictional flour 500g', weight: {value:'500 g'},
    offers: {'@type':'Offer', price:'1.49', priceCurrency:'EUR',
      availability:'https://schema.org/InStock', ...priceWindow},
  }) + '</script>'
  return captureApprovedProductPriceCandidate({
    source: { supermarket:'plus',kind:'product',url },
    permissionGate,
    grant: {
      supermarket:'plus',kind:'product',sourceUrl:url,
      reviewed:true,termsReviewed:true,robotsReviewed:true,
      noAntiBotBypass:true,
    },
    capturedAt:new Date(Date.now() - 30_000).toISOString(),
    fetchFn:async () => new Response(html,{
      status:200,headers:{'content-type':'text/html'},
    }),
  })
}
function privateOnly(result) {
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.published, false)
}

for (const [label, claim] of [
  ['UTC-13:00 outer Offer validFrom', {validFrom:'2020-01-01T12:00:00-13:00'}],
  ['UTC-14:00 nested specification validFrom', {
    priceSpecification: {
      '@type':'UnitPriceSpecification',price:'1.49',priceCurrency:'EUR',
      validFrom:'2020-01-01T12:00:00-14:00',
    },
  }],
]) {
  test('private PLUS must abstain on nonexistent 2020 civil ' + label, async () => {
    const result = await candidate(claim)
    assert.equal(result.status,'review_required','UTC-13/-14 is not civil time')
    assert.equal(result.observation,null)
    privateOnly(result)
  })
}
test('UTC-12:00 remains the legitimate negative civil boundary, private only', async () => {
  const result = await candidate({validFrom:'2020-01-01T12:00:00-12:00'})
  assert.equal(result.status,'candidate_needs_review')
  assert.equal(result.observation?.currentPriceCents,149)
  privateOnly(result)
})
