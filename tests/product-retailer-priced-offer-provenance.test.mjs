import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// All prices/sources are synthetic. No retailer HTTP, rights, or public claims.
const capturedAt='2026-10-15T09:00:00Z'
const nowMs=Date.parse('2026-10-15T10:00:00Z')
const source=(shop)=>SOURCES.find(x=>x.id===shop+'-product-halfvolle-melk')
const offer=(price, extra={})=>({
  '@type':'Offer',price,priceCurrency:'EUR',
  availability:'https://schema.org/InStock',...extra,
})
function snapshot(shop,offers){
  const html='<script type="application/ld+json">'+JSON.stringify({
    '@type':'Product',sku:'fictional-milk',name:'Halfvolle melk',
    weight:{value:'1000 ml'},offers,
  })+'</script>'
  return parseOfflineRetailerSnapshot({source:source(shop),html,capturedAt})
}
function observed(shop,offers){
  const parsed=snapshot(shop,offers)
  assert.equal(parsed.observations.length,1)
  return parsed.observations[0]
}
const compare=(candidate)=>compareReviewedCatalogs({
  requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
  observations:[observed('plus',offer('1.29')),
    ...snapshot('dekamarkt',candidate).observations],
  nowMs,
})
function assertUnknown(input){
  const rows=snapshot('dekamarkt',input).observations
  assert.ok(rows.every((row)=>row.currentPriceCents===null))
  const r=compare(input)
  assert.equal(r.comparable,false)
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
  assert.equal(r.claimable,false)
}
test('one dated Offer with exact price retains full nonclaimable two-pack arithmetic',()=>{
  const r=compare(offer('1.19',{
    validFrom:'2026-10-14T00:00:00Z',priceValidUntil:'2026-10-16T00:00:00Z',
  }))
  assert.equal(r.comparable,true)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
})
test('duplicate equal-price Offer array does not mint an undated sale price',()=>{
  assertUnknown([
    offer('1.19',{priceValidUntil:'2026-10-10T00:00:00Z'}),
    offer('1.19',{validFrom:'2026-10-16T00:00:00Z'}),
  ])
})
test('expired or future nested PriceSpecification cannot mint pack checkout cents',()=>{
  for(const [from,to] of [
    ['2026-10-01T00:00:00Z','2026-10-10T00:00:00Z'],
    ['2026-10-16T00:00:00Z','2026-10-20T00:00:00Z'],
  ]) assertUnknown({
    '@type':'Offer',priceCurrency:'EUR',availability:'https://schema.org/InStock',
    priceSpecification:{
      '@type':'PriceSpecification',price:'1.19',priceCurrency:'EUR',
      validFrom:from,validThrough:to,
    },
  })
})
test('price valid at capture but expired before comparison cannot determine winner',()=>{
  const r=compare({
    '@type':'Offer',priceCurrency:'EUR',availability:'https://schema.org/InStock',
    priceSpecification:{
      '@type':'PriceSpecification',price:'1.19',priceCurrency:'EUR',
      validFrom:'2026-10-15T08:00:00Z',
      validThrough:'2026-10-15T09:30:00Z',
    },
  })
  assert.equal(r.comparable,false)
  assert.equal(r.savingsCents,null)
})
test('valid dated nested specification preserves both the price and its provenance',()=>{
  const specification={
    '@type':'Offer',priceCurrency:'EUR',availability:'https://schema.org/InStock',
    priceSpecification:{
      '@type':'PriceSpecification',price:'1.19',priceCurrency:'EUR',
      validFrom:'2026-10-14T00:00:00Z',validThrough:'2026-10-16T00:00:00Z',
    },
  }
  const row=observed('dekamarkt',specification)
  assert.equal(row.currentPriceCents,119)
  assert.equal(row.offer.validFrom,'2026-10-14T00:00:00Z')
  assert.equal(row.offer.validTo,'2026-10-16T00:00:00Z')
  const r=compare(specification)
  assert.equal(r.comparable,true)
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
})

test('malformed explicit parent Offer dates cannot silently become unbounded prices',()=>{
  for(const date of [{value:'2026-10-14T00:00:00Z'},12,false,'not-a-date','']) {
    assertUnknown(offer('1.19',{priceValidUntil:date}))
    assertUnknown(offer('1.19',{validFrom:date}))
  }
})

test('malformed typed Offer date is rejected as invalid source evidence, not a normal undated quote',()=>{
  const html='<script type="application/ld+json">'+JSON.stringify({
    '@type':'Product',name:'Halfvolle melk',sku:'fictional-milk',
    weight:{value:'1000 ml'},
    offers:offer('1.19',{validFrom:{date:'2026-10-01'},priceValidUntil:'2026-10-16'}),
  })+'</script>'
  const result=parseOfflineRetailerSnapshot({
    source:source('dekamarkt'),html,capturedAt,
  })
  assert.equal(result.observations.length,0)
  assert.equal(result.rejected,1)
})
