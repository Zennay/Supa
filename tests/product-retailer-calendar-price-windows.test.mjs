import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Fixed clocks, fictional prices and offline HTML only. No external transport.
const source=(shop)=>SOURCES.find((s)=>s.id===shop+'-product-halfvolle-melk')
const offer=(price,dates)=>({
  '@type':'Offer',price,priceCurrency:'EUR',availability:'https://schema.org/InStock',
  ...dates,
})
function snap(shop,offers,time){
  const capturedAt=new Date(Date.parse(time)-60*60*1000).toISOString()
  const html='<script type="application/ld+json">'+JSON.stringify({
    '@type':'Product',name:'Halfvolle melk',sku:'fictional-calendar-milk',
    weight:{value:'1000 ml'},offers,
  })+'</script>'
  return parseOfflineRetailerSnapshot({source:source(shop),html,capturedAt})
}
function compare(candidate,time='2026-03-01T10:00:00Z') {
  const year=time.slice(0,4)
  const plus=snap('plus',offer('1.29',{
    validFrom:year+'-01-01',priceValidUntil:year+'-12-31',
  }),time)
  const deka=snap('dekamarkt',candidate,time)
  const r=compareReviewedCatalogs({
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    observations:[...plus.observations,...deka.observations],
    nowMs:Date.parse(time),
  })
  return {r,deka}
}
test('real inclusive end date and a real leap day retain fictional 20-cent difference',()=>{
  for(const [time,dates] of [
    ['2026-03-01T10:00:00Z',{validFrom:'2026-02-01',priceValidUntil:'2026-03-01'}],
    ['2024-02-29T10:00:00Z',{validFrom:'2024-02-01',priceValidUntil:'2024-02-29'}],
  ]) {
    const {r}=compare(offer('1.19',dates),time)
    assert.equal(r.comparable,true)
    assert.equal(r.savingsCents,20)
    assert.equal(r.claimable,false)
  }
})
test('impossible end and start calendar days never produce a price winner',()=>{
  for(const [time,dates] of [
    ['2026-03-01T10:00:00Z',{validFrom:'2026-02-01',priceValidUntil:'2026-02-30'}],
    ['2026-03-01T10:00:00Z',{validFrom:'2026-02-01',priceValidUntil:'2026-02-29'}],
    ['2026-05-01T10:00:00Z',{validFrom:'2026-04-01',priceValidUntil:'2026-04-31'}],
    ['2026-03-03T10:00:00Z',{validFrom:'2026-02-30',priceValidUntil:'2026-03-10'}],
    ['2026-03-01T10:00:00Z',{validFrom:'2026-02-01',priceValidUntil:'2026-02-30T23:59:59Z'}],
  ]) {
    const {r,deka}=compare(offer('1.19',dates),time)
    assert.ok(deka.observations.every((row)=>row.currentPriceCents===null))
    assert.equal(r.comparable,false)
    assert.equal(r.savingsCents,null)
    assert.equal(r.cheaperStore,null)
  }
})
test('impossible calendar day on nested priced specification also refuses checkout cents',()=>{
  const invalid={
    '@type':'Offer',priceCurrency:'EUR',availability:'https://schema.org/InStock',
    priceSpecification:{
      '@type':'PriceSpecification',price:'1.19',priceCurrency:'EUR',
      validFrom:'2026-02-01',validThrough:'2026-02-30',
    },
  }
  const {r,deka}=compare(invalid)
  assert.ok(deka.observations.every((row)=>row.currentPriceCents===null))
  assert.equal(r.comparable,false)
  assert.equal(r.savingsCents,null)
  assert.equal(r.claimable,false)
})
