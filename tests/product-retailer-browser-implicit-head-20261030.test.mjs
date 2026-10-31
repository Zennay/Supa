import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { readAuthorizedHtmlScriptEvidence } from '../scripts/retailer-approved-html-script-evidence.mjs'

const sources = [
  {retailerId:'plus',url:'https://www.plus.nl/product/synthetic-browser-head'},
  {retailerId:'dekamarkt',url:'https://www.dekamarkt.nl/producten/synthetic-browser-head'},
]
const ld = JSON.stringify({'@context':'https://schema.org','@type':'Product',name:'SYNTHETIC',offers:{'@type':'Offer',price:'1.99',priceCurrency:'EUR'}})
const observed = '<article class="product-card"><span class="price_value">SYNTHETIC_PRICE</span></article>'
const begin = '<!doctype html><html><head><meta charset="utf-8"><script type="application/ld+json">' + ld + '</script>'
for(const source of sources){
  const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
  test(`${source.retailerId}: omitted head/body boundaries preserve observed price and product script`,()=>{
    for(const opener of ['<main>','<section>','<div>','<custom-product-card>']){
      const html=begin+opener+observed
      const review=proposeOfflineRetailerSelectors({html,origin})
      assert.ok(review.selectors.some(x=>x.field==='price'&&x.selector==='span.price_value'),opener)
      assert.equal(review.structuredSignals.schemaOrgProduct,true)
      const scripts=readAuthorizedHtmlScriptEvidence(html,source.url)
      assert.equal(scripts.invalid,false,opener)
      assert.equal(scripts.jsonLdBlocks.length,1)
      assert.equal(scripts.verifiedSchemaProductContexts,true)
    }
  })
  test(`${source.retailerId}: inert template CSS stays hidden and head noarchive still denies`,()=>{
    const html=begin+'<template><main><span class="price_value">SYNTHETIC_INERT</span></main></template>'+ '<main><span class="name_value">SYNTHETIC_NAME</span>'
    const review=proposeOfflineRetailerSelectors({html,origin})
    assert.equal(review.selectors.some(x=>x.field==='price'),false)
    assert.ok(review.selectors.some(x=>x.field==='name'))
    assert.equal(readAuthorizedHtmlScriptEvidence(html,source.url).invalid,false)
    const denied=begin+'<meta name="robots" content="noarchive"><main>'+observed
    assert.equal(readAuthorizedHtmlScriptEvidence(denied,source.url).invalid,true)
    assert.throws(()=>proposeOfflineRetailerSelectors({html:denied,origin}),/archive|retention/i)
  })
}

// Exercise the real capture -> signed SHA -> private product + selector bridge,
// not just the offline parser. Fetch and authorization are synthetic in-memory.
const {captureApprovedProductReviewBundle} = await import('../scripts/retailer-approved-html-product-price-candidate.mjs')
const {createHash} = await import('node:crypto')
for (const source of sources) {
  test(`${source.retailerId}: one synthetic captured HTML response joins product-price and selector evidence without a body tag`,async()=>{
    const sku = 'synthetic-browser-head'
    const product={'@context':'https://schema.org','@type':'Product',name:'Synthetic milk',sku,url:source.url,
      weight:{value:'500 g'},offers:{'@type':'Offer',price:'2.49',priceCurrency:'EUR',availability:'https://schema.org/InStock'}}
    const html='<!doctype html><html><head><meta charset="utf-8">'+
      '<script type="application/ld+json">'+JSON.stringify(product)+'</script><main>'+observed.replace('price_value','price-value')+'<span class="price&lowbar;value" data-testid="price&lowbar;value" data-test="price&lowbar;value" data-qa="price&lowbar;value">SYNTHETIC_SECOND</span>'
    let count=0
    const result=await captureApprovedProductReviewBundle({
      source:{supermarket:source.retailerId,kind:'product',url:source.url},
      permissionGate:{version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-16',sources:sources.map(({retailerId})=>({
        supermarket:retailerId,technicalStatus:'proven',permissionStatus:'permitted',productionEnabled:true,
        evidence:[{kind:'written_permission',url:'https://example.test/synthetic-only',finding:'FICTIONAL TEST; NOT REAL PERMISSION'}]}))},
      grant:{supermarket:source.retailerId,kind:'product',sourceUrl:source.url,reviewed:true,termsReviewed:true,robotsReviewed:true,noAntiBotBypass:true},
      capturedAt:new Date(Date.now()-30_000).toISOString(),
      fetchFn:async()=>{count++;return new Response(html,{status:200,headers:{'content-type':'text/html'}})},
    })
    assert.equal(count,1)
    assert.equal(result.source.sha256,createHash('sha256').update(html).digest('hex'))
    assert.equal(result.source.sha256,result.priceReview.source.sha256)
    assert.equal(result.priceReview.status,'candidate_needs_review')
    assert.equal(result.priceReview.observation.currentPriceCents,249)
    assert.ok(result.selectorReview.proposals.some(x=>x.field==='price'&&x.selector==='span.price-value'))
    assert.ok(result.selectorReview.proposals.some(x=>x.field==='price'&&x.selector==='span.price_value'))
    assert.ok(result.selectorReview.proposals.some(x=>x.field==='price'&&x.selector==='span[data-testid="price_value"]'))
    for(const attribute of ['data-test','data-qa'])
      assert.ok(result.selectorReview.proposals.some(x=>x.field==='price'&&x.selector===`span[${attribute}="price_value"]`))
    assert.equal(result.actualTransportInvocations,1)
    for(const field of ['published','readyForIngestion','productionEnabled','publicSavingsClaimEligible','sourceRightsForPublicationVerified'])
      assert.equal(result[field],false,field)
  })
}

// A browser-decoded generic underscore CSS class/test ID is safe to show in
// the *private* source review, but a SKU-bearing variant never is.
const {safeSelectorProposals}=await import('../scripts/retailer-approved-capture-selector-bridge.mjs')
for(const source of sources){
  test(`${source.retailerId}: source-observed generic underscore selectors survive the private bridge`,()=>{
    const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
    const html='<main><article class="product-card"><span class="price&lowbar;value" data-testid="price&lowbar;value">SYNTHETIC_CURRENT</span>'+
      '<span class="price_249_private" data-testid="price_249_secret">SYNTHETIC_PRIVATE</span>'+
      '<div class="old_price"><span class="price-old">SYNTHETIC_FORMER</span></div></article></main>'
    const raw=proposeOfflineRetailerSelectors({html,origin})
    assert.ok(raw.selectors.some(x=>x.selector==='span.price_value'&&x.field==='price'))
    assert.ok(raw.selectors.some(x=>x.selector==='span[data-testid="price_value"]'&&x.field==='price'))
    const safe=safeSelectorProposals(raw.selectors,source.retailerId)
    for(const selector of ['span.price_value','span[data-testid="price_value"]'])
      assert.ok(safe.some(x=>x.selector===selector&&x.field==='price'),selector)
    assert.equal(safe.some(x=>/249|private|secret/i.test(x.selector)),false)
    assert.equal(safe.some(x=>x.selector==='div.old_price'&&x.field==='price'),false)
  })
}

// The private reviewer must see all six real source-observed generic fields
// for both approved *synthetic* sample pages, never inferred retailer CSS.
for(const source of sources){
  test(`${source.retailerId}: six-field underscore source DOM preserves exact privacy-safe review coverage`,()=>{
    const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
    const html='<main><article class="product_card" data-testid="product_card">'+
      '<h2 class="product_name" data-testid="product_name">SYNTHETIC_NAME</h2>'+
      '<span class="price_value" data-testid="price_value">SYNTHETIC_PRICE</span>'+
      '<span class="pack_size" data-testid="pack_size">SYNTHETIC_PACK</span>'+
      '<strong class="offer_label" data-testid="offer_label">SYNTHETIC_OFFER</strong>'+
      '<span class="stock_availability" data-testid="stock_availability">SYNTHETIC_STOCK</span>'+
      '<span class="private_sku_991">SYNTHETIC_PRIVATE</span></article></main>'
    const raw=proposeOfflineRetailerSelectors({html,origin})
    const safe=safeSelectorProposals(raw.selectors,source.retailerId)
    for(const [field,tag,token] of [
      ['product','article','product_card'],['name','h2','product_name'],
      ['price','span','price_value'],['pack','span','pack_size'],
      ['offer','strong','offer_label'],['availability','span','stock_availability'],
    ]){
      assert.ok(raw.selectors.some(x=>x.field===field&&x.selector===`${tag}.${token}`),`${field} raw class`)
      assert.ok(safe.some(x=>x.field===field&&x.selector===`${tag}.${token}`),`${field} exported class`)
      assert.ok(safe.some(x=>x.field===field&&x.selector===`${tag}[data-testid="${token}"]`),`${field} exported test id`)
    }
    assert.equal(safe.some(x=>x.selector.includes('private_sku_991')),false)
    assert.equal(safe.some(x=>x.selector==='strong.offer_label'&&x.field==='name'),false)
  })
}

// Retailer DOMs frequently use data-test / data-qa rather than data-testid.
// Inspect the actual attribute value, never guess vendor selectors or accept
// unbounded SKU-bearing identity tokens in the private export.
for (const source of sources) {
  test(`${source.retailerId}: observed data-test/data-qa six-field tokens reach private source review`,()=>{
    const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
    const fields=[['product','article','product_card'],['name','h2','product_name'],
      ['price','span','price_value'],['pack','span','pack_size'],
      ['offer','strong','offer_label'],['availability','span','stock_availability']]
    const html='<main>'+fields.map(([,tag,token])=>
      `<${tag} data-test="${token}" data-qa="${token}">SYNTHETIC</${tag}>`).join('')+
      '<span data-test="price_249_very_private" data-qa="sku_90210">PRIVATE</span></main>'
    const raw=proposeOfflineRetailerSelectors({html,origin})
    const safe=safeSelectorProposals(raw.selectors,source.retailerId)
    for (const [field,tag,token] of fields)
      for (const attribute of ['data-test','data-qa']) {
        const selector=`${tag}[${attribute}="${token}"]`
        assert.ok(raw.selectors.some(row=>row.field===field&&row.selector===selector),`${field} observed ${attribute}`)
        assert.ok(safe.some(row=>row.field===field&&row.selector===selector),`${field} private ${attribute}`)
      }
    assert.equal(safe.some(row=>/private|90210/.test(row.selector)),false)
  })
}

for (const source of sources) {
  test(`${source.retailerId}: historical price data-test/data-qa never becomes a current quote`,()=>{
    const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
    const html='<main><div data-test="old_price"><span data-test="price_value" data-qa="price_value">SYNTHETIC_OLD</span></div>'+
      '<ins data-test="price_value" data-qa="price_value">SYNTHETIC_CURRENT</ins></main>'
    const result=proposeOfflineRetailerSelectors({html,origin})
    const safe=safeSelectorProposals(result.selectors,source.retailerId)
    assert.equal(safe.some(r=>r.field==='price'&&r.selector.includes('span[')),false)
    for(const attribute of ['data-test','data-qa'])
      assert.ok(safe.some(r=>r.field==='price'&&r.selector===`ins[${attribute}="price_value"]`))
  })
}

for (const source of sources) {
  test(`${source.retailerId}: bare generic observed test attributes preserve all six fields`,()=>{
    const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
    const html='<main><article data-test="product"><h2 data-qa="name">SYNTHETIC</h2>'+
      '<span data-testid="price">SYNTHETIC</span><span data-test="pack">SYNTHETIC</span>'+
      '<strong data-qa="offer">SYNTHETIC</strong><span data-test="stock">SYNTHETIC</span>'+
      '</article></main>'
    const raw=proposeOfflineRetailerSelectors({html,origin})
    const safe=safeSelectorProposals(raw.selectors,source.retailerId)
    for(const [field,selector] of [['product','article[data-test="product"]'],
      ['name','h2[data-qa="name"]'],['price','span[data-testid="price"]'],
      ['pack','span[data-test="pack"]'],['offer','strong[data-qa="offer"]'],
      ['availability','span[data-test="stock"]']]){
      assert.ok(raw.selectors.some(x=>x.field===field&&x.selector===selector),field+' observed')
      assert.ok(safe.some(x=>x.field===field&&x.selector===selector),field+' private export')
    }
  })
}
test('private selector export refuses wrong field for generic token or old price',()=>{
  const bad=['span.price-value','span.price_value','span[data-test="price"]',
    'span[data-testid="price-value"]','span[data-qa="price_value"]',
    'strong.offer-label'].map(selector=>({field:'name',selector,instances:1,status:'needs-human-review'}))
  bad.push({field:'price',selector:'del.price-value',instances:1,status:'needs-human-review'})
  assert.deepEqual(safeSelectorProposals(bad,'plus'),[])
  const former={field:'offer',selector:'del.price-value',instances:1,status:'needs-human-review'}
  assert.equal(safeSelectorProposals([former],'plus').length,1)
})
