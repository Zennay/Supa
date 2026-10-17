import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Entirely fictional offline HTML captures. No retailer HTTP/reuse rights.
const at='2026-10-15T09:00:00Z'
const nowMs=Date.parse('2026-10-15T10:00:00Z')
function observed(shop,validFrom,priceValidUntil) {
  const source=SOURCES.find(x=>x.id===shop+'-product-halfvolle-melk')
  const offers={
    '@type':'Offer',price:shop==='plus'?'1.29':'1.19',
    priceCurrency:'EUR',availability:'https://schema.org/InStock',
    validFrom,priceValidUntil,
  }
  const html='<script type="application/ld+json">'+JSON.stringify({
    '@type':'Product',sku:'fictional-milk',name:'Halfvolle melk',
    weight:{value:'1000 ml'},offers,
  })+'</script>'
  const snap=parseOfflineRetailerSnapshot({source,html,capturedAt:at})
  assert.equal(snap.observations.length,1)
  return snap.observations[0]
}
const plus=observed('plus','2026-10-14T00:00:00Z','2026-10-16T00:00:00Z')
function compare(deka) {
  return compareReviewedCatalogs({
    observations:[plus,deka],
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    nowMs,
  })
}
test('Offer scheduled for AFTER source capture, but active at review, proves no checkout price',()=>{
  const candidate=observed('dekamarkt','2026-10-15T09:30:00Z','2026-10-16T00:00:00Z')
  assert.equal(candidate.currentPriceCents,null)
  const r=compare(candidate)
  assert.equal(r.comparable,false)
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
  assert.equal(r.claimable,false)
})
test('Offer already expired at source capture cannot mint checkout price',()=>{
  const candidate=observed('dekamarkt','2026-10-14T00:00:00Z','2026-10-15T08:59:59Z')
  assert.equal(candidate.currentPriceCents,null)
  const r=compare(candidate)
  assert.equal(r.comparable,false)
  assert.equal(r.savingsCents,null)
})
test('Offer active at capture and review preserves exact fictitious whole-pack arithmetic',()=>{
  const candidate=observed('dekamarkt','2026-10-15T08:00:00Z','2026-10-15T11:00:00Z')
  assert.equal(candidate.currentPriceCents,119)
  const r=compare(candidate)
  assert.equal(r.comparable,true)
  assert.equal(r.stores.plus.subtotalCents,258)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
})
test('Offer effective exactly at capture instant remains permitted',()=>{
  const candidate=observed('dekamarkt','2026-10-15T09:00:00Z','2026-10-15T10:00:00Z')
  assert.equal(candidate.currentPriceCents,119)
  assert.equal(compare(candidate).comparable,true)
})
test('date-only expiry includes source capture and review throughout UTC last day',()=>{
  const candidate=observed('dekamarkt','2026-10-15','2026-10-15')
  assert.equal(candidate.currentPriceCents,119)
  assert.equal(compare(candidate).comparable,true)
})

test('contradictory price validity remains explicit parser-level abstention',()=>{
  const source=SOURCES.find(x=>x.id==='dekamarkt-product-halfvolle-melk')
  const html='<script type="application/ld+json">'+JSON.stringify({
    '@type':'Product',name:'Halfvolle melk',sku:'fictional-milk',
    weight:{value:'1000 ml'},
    offers:{
      '@type':'Offer',price:'1.19',priceCurrency:'EUR',
      availability:'https://schema.org/InStock',
      validFrom:'2026-10-16T00:00:00Z',
      priceValidUntil:'2026-10-14T00:00:00Z',
    },
  })+'</script>'
  const snap=parseOfflineRetailerSnapshot({source,html,capturedAt:at})
  assert.equal(snap.observations.length,0)
  assert.equal(snap.rejected,1)
})
