import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {captureApprovedProductReviewBundle as review, captureApprovedRetailerReviewBundle as reviewAny} from '../scripts/retailer-approved-html-product-price-candidate.mjs'
// All pages, grants, prices and responses are SYNTHETIC in-memory inputs.
const urls={plus:'https://www.plus.nl/product/mock-123',dekamarkt:'https://www.dekamarkt.nl/producten/mock-456'}
const grantGate={version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-16',sources:['plus','dekamarkt'].map(supermarket=>({supermarket,technicalStatus:'proven',permissionStatus:'permitted',productionEnabled:true,evidence:[{kind:'written_permission',url:'https://example.test/synthetic',finding:'SYNTHETIC TEST ONLY; NOT A REAL GRANT'}]}))}
const product=(store,stock='InStock')=>({'@context':'https://schema.org','@type':'Product',name:'Fictional milk',sku:store==='plus'?'123':'456',url:urls[store],weight:{value:'500 g'},offers:{'@type':'Offer',price:'2.49',priceCurrency:'EUR',availability:'https://schema.org/'+stock}})
function markup(store,stock){const route=store==='plus'?'/product/mock-123':'/producten/mock-456';return '<html><head><script type="application&sol;ld&plus;json&semi;charset=UTF-8">'+JSON.stringify(product(store,stock))+'</script></head><body><div class="product-card"><span class="price-value">FAKE</span><a href="'+route+'">mock</a></div><!-- NOT_PUBLIC_HTML_MARKER --></body></html>'}
function opts(store,html,extra={}){return{source:{supermarket:store,kind:'product',url:urls[store]},permissionGate:grantGate,grant:{supermarket:store,kind:'product',sourceUrl:urls[store],reviewed:true,termsReviewed:true,robotsReviewed:true,noAntiBotBypass:true},capturedAt:new Date(Date.now()-45000).toISOString(),fetchFn:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),...extra}}

test('one PLUS source transport yields identical SHA-anchored private price and CSS selector review',async()=>{
 const body=markup('plus');let calls=0
 const result=await review(opts('plus',body,{fetchFn:async(url,o)=>{calls++;assert.equal(url,urls.plus);assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return new Response(body,{status:200,headers:{'content-type':'text/html'}})}}))
 assert.equal(calls,1);assert.equal(result.actualTransportInvocations,1)
 assert.equal(result.mode,'private-authorized-one-capture-product-review')
 assert.equal(result.source.sha256,createHash('sha256').update(body).digest('hex'))
 assert.equal(result.source.sha256,result.priceReview.source.sha256)
 assert.equal(result.source.capturedAt,result.priceReview.source.capturedAt)
 assert.equal(result.capturedBytes,Buffer.byteLength(body))
 assert.equal(result.priceReview.status,'candidate_needs_review')
 assert.equal(result.priceReview.observation.currentPriceCents,249)
 assert.ok(result.selectorReview.proposals.some(x=>x.selector==='div.product-card'))
 assert.ok(result.selectorReview.proposals.some(x=>x.selector==='span.price-value'))
 assert.ok(result.selectorReview.proposals.every(x=>x.status==='needs-human-review'))
 assert.equal(result.selectorReview.approvedSelectors,0)
 for(const k of ['readyForIngestion','productionEnabled','published','verifiedCurrentCheckoutPrice','publicSavingsClaimEligible','rawHtmlReturned'])assert.equal(result[k],false,k)
 assert.doesNotMatch(JSON.stringify(result),/NOT_PUBLIC_HTML_MARKER/)
})

test('Deka has one consistent captured product identity across private price and selector results',async()=>{
 const result=await review(opts('dekamarkt',markup('dekamarkt')))
 assert.equal(result.priceReview.status,'candidate_needs_review')
 assert.equal(result.priceReview.observation.currentPriceCents,249)
 assert.ok(result.selectorReview.proposals.some(x=>x.field==='product'))
 assert.equal(result.sourceRightsForPublicationVerified,false)
 assert.equal(result.selectorReview.humanReviewRequired,true)
})

test('out-of-stock page leaves selector suggestions private and refuses price promotion',async()=>{
 const result=await review(opts('plus',markup('plus','OutOfStock')))
 assert.equal(result.priceReview.status,'review_required')
 assert.equal(result.priceReview.observation,null)
 assert.ok(result.selectorReview.proposals.length>0)
 assert.equal(result.readyForIngestion,false)
 assert.equal(result.verifiedCurrentCheckoutPrice,false)
})

test('canonical source rights refuse both retailers before any transport',async()=>{
 const production=JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json',import.meta.url),'utf8'))
 let calls=0
 for(const store of ['plus','dekamarkt']){
  await assert.rejects(review(opts(store,markup(store),{permissionGate:production,fetchFn:async()=>{calls++;throw Error('UNAUTHORIZED NETWORK')}})),/Explicit retailer source permission required/)
 }
 assert.equal(calls,0)
})

test('one-shot product bundle does not leak price/SKU-bearing captured selector tokens', async()=>{
 const body=markup('plus').replace('</body>',
  '<div class="price-249-private">Private label</div>'+
  '<span data-testid="price-249-secret">Sensitive source</span>'+
  '<a class="product-mock-sku-123" href="/product/mock-123">Link</a></body>')
 const result=await review(opts('plus',body))
 assert.equal(result.priceReview.status,'candidate_needs_review')
 assert.equal(result.priceReview.observation.currentPriceCents,249)
 assert.equal(result.selectorReview.privateProposalsOmitted>0,true)
 assert.ok(result.selectorReview.proposals.some(x=>x.selector==='div.product-card'))
 assert.ok(result.selectorReview.proposals.some(x=>x.selector==='span.price-value'))
 assert.doesNotMatch(JSON.stringify(result.selectorReview),
  /249-private|249-secret|mock-sku-123|Sensitive source|Private label/)
 assert.equal(result.selectorReview.approvedSelectors,0)
 assert.equal(result.publicSavingsClaimEligible,false)
})

test('M1 PLUS catalog and Deka offers each yield one private SHA-bound selector review, never an invented price',async()=>{
 for(const [store,kind,url] of [
  ['plus','catalog','https://www.plus.nl/producten'],
  ['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
  const html=markup(store)
  let calls=0
  const request=opts(store,html,{source:{supermarket:store,kind,url},grant:{supermarket:store,kind,sourceUrl:url,reviewed:true,termsReviewed:true,robotsReviewed:true,noAntiBotBypass:true},fetchFn:async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})}})
  const result=await reviewAny(request)
  assert.equal(calls,1)
  assert.equal(result.mode,'private-authorized-one-capture-structural-review')
  assert.equal(result.source.kind,kind)
  assert.equal(result.source.sha256,createHash('sha256').update(html).digest('hex'))
  assert.equal(result.priceReview,null)
  assert.ok(result.selectorReview.proposals.some(x=>x.field==='product'))
  assert.equal(result.selectorReview.approvedSelectors,0)
  assert.equal(result.actualTransportInvocations,1)
  assert.equal(result.verifiedCurrentCheckoutPrice,false)
  assert.equal(result.publicSavingsClaimEligible,false)
  assert.equal(result.rawHtmlReturned,false)
 }
})

test('product-only API rejects catalog and offer requests before invoking transport',async()=>{
 let calls=0
 for(const kind of ['catalog','offers']){
  const request=opts('plus',markup('plus'),{source:{supermarket:'plus',kind,url:'https://www.plus.nl/'+(kind==='catalog'?'producten':'aanbiedingen')},fetchFn:async()=>{calls++;throw Error('NO NETWORK')}})
  await assert.rejects(review(request),/requires a product page/)
 }
 const accessor=opts('plus',markup('plus'))
 Object.defineProperty(accessor.source,'kind',{get(){calls++;return 'product'}})
 await assert.rejects(review(accessor),/requires a product page/)
 assert.equal(calls,0)
})

test('canonical actual retailer rights deny catalog and offers before any HTTP request',async()=>{
 const production=JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json',import.meta.url),'utf8'))
 let calls=0
 for(const [store,kind,url] of [['plus','catalog','https://www.plus.nl/producten'],['dekamarkt','offers','https://www.dekamarkt.nl/aanbiedingen']]){
  const request=opts(store,markup(store),{source:{supermarket:store,kind,url},grant:{supermarket:store,kind,sourceUrl:url,reviewed:true,termsReviewed:true,robotsReviewed:true,noAntiBotBypass:true},permissionGate:production,fetchFn:async()=>{calls++;throw Error('NO NETWORK')}})
  await assert.rejects(reviewAny(request),/Explicit retailer source permission required/)
 }
 assert.equal(calls,0)
})
