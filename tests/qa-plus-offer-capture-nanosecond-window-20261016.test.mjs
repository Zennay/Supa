import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

/**
 * Independent QA of M3 approved one-page HTML -> PRIVATE price candidate.
 * Date.parse loses ISO fractional seconds past 3 decimals. A window that
 * starts just 1ns AFTER source capture cannot certify a current price at
 * that capture, even if it is valid at review time 30 seconds later.
 *
 * Fictional product/grant/HTML/price; injected Response, no real IO.
 */
const url = 'https://www.plus.nl/product/fake-nanosecond-capture-qa-500g'
const gate = {
  version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-16',
  sources:['plus','dekamarkt'].map(supermarket=>({
    supermarket, technicalStatus:'proven',
    permissionStatus:'permitted',productionEnabled:true,
    evidence:[{
      kind:'written_permission',
      url:'https://example.test/fictional-never-real-grant',
      finding:'Synthetic permission, not an external grant',
    }],
  })),
}
async function inspect(buildWindow) {
  const capturedAt = new Date(Date.now() - 30_000).toISOString()
  // ISO .mmmZ -> .mmm000001Z (exactly 1ns after capture);
  // every test has its own immutable source capture instant.
  const justAfter = capturedAt.slice(0, -1) + '000001Z'
  const farAfter = new Date(Date.parse(capturedAt) + 1).toISOString()
  const exact = capturedAt.slice(0, -1) + '000000Z'
  const window = buildWindow({ justAfter, farAfter, exact })
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type':'Product',url,sku:'FICTIONAL-NANO-CAPTURE-500',
    name:'Fictional oats 500g',weight:{value:'500 g'},
    offers:{
      '@type':'Offer',price:'1.49',priceCurrency:'EUR',
      availability:'https://schema.org/InStock',...window,
    },
  }) + '</script>'
  return captureApprovedProductPriceCandidate({
    source:{supermarket:'plus',kind:'product',url},
    permissionGate:gate,
    grant:{
      supermarket:'plus',kind:'product',sourceUrl:url,
      reviewed:true,termsReviewed:true,robotsReviewed:true,
      noAntiBotBypass:true,
    },
    capturedAt,
    fetchFn:async()=>new Response(html,{
      status:200,headers:{'content-type':'text/html'},
    }),
  })
}
function neverPublic(r) {
  assert.equal(r.humanReviewRequired,true)
  assert.equal(r.productionEnabled,false)
  assert.equal(r.published,false)
  assert.equal(r.verifiedCurrentCheckoutPrice,false)
  assert.equal(r.publicSavingsClaimEligible,false)
}

for (const [description,window] of [
  ['outer Offer validFrom only 1ns AFTER capture', ({justAfter})=>({validFrom:justAfter})],
  ['nested specification validFrom only 1ns AFTER capture',
    ({justAfter})=>({priceSpecification:{
      '@type':'UnitPriceSpecification',price:'1.49',
      priceCurrency:'EUR',validFrom:justAfter,
    }})],
]) {
  test('private PLUS must NOT quote ' + description,async()=>{
    const r=await inspect(window)
    assert.equal(r.status,'review_required',
      'Sub-millisecond source start after capture must not be rounded backwards')
    assert.equal(r.observation,null)
    neverPublic(r)
  })
}
test('real +1ms source start after capture is already refused',async()=>{
  const r=await inspect(({farAfter})=>({validFrom:farAfter}))
  assert.equal(r.status,'review_required')
  assert.equal(r.observation,null)
  neverPublic(r)
})
test('source start EXACTLY at capture remains a private-only candidate',async()=>{
  const r=await inspect(({exact})=>({validFrom:exact}))
  assert.equal(r.status,'candidate_needs_review')
  assert.equal(r.observation?.currentPriceCents,149)
  neverPublic(r)
})
