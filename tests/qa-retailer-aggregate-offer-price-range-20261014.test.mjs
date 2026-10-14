import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Explicitly FICTIONAL Schema.org evidence, NOT actual supermarket data.
const AT='2026-10-15T09:00:00.000Z'
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const req=[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}]
const source=(shop)=>SOURCES.find(s=>s.id===shop+'-product-halfvolle-melk')
const exact=(price)=>({
  '@type':'Offer',price,priceCurrency:'EUR',
  availability:'https://schema.org/InStock',
})
const range=(low,high,count)=>({
  '@type':'AggregateOffer',lowPrice:low,highPrice:high,offerCount:count,
  priceCurrency:'EUR',availability:'https://schema.org/InStock',
})
const jsonLd=(offer)=>'<script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'Product',sku:'fixture-milk',
  name:'Halfvolle melk',weight:{value:'1000 ml'},offers:offer,
})+'</script>'
const inspect=(shop,offers)=>parseOfflineRetailerSnapshot({
  source:source(shop),html:jsonLd(offers),capturedAt:AT,
})
const compare=(pl,de)=>compareReviewedCatalogs({
  requirements:req,
  observations:[...inspect('plus',pl).observations,...inspect('dekamarkt',de).observations],
  nowMs:NOW,
})
function assertNoWinner(r) {
  assert.equal(r.comparable,false,'a price range is not a purchasable pack price')
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
  assert.equal(r.claimable,false)
}
test('single concrete Offer from each shop still yields complete fictional 2-pack basket',()=>{
  const r=compare(exact('1.29'),exact('1.19'))
  assert.equal(r.comparable,true)
  assert.equal(r.claimable,false)
  assert.equal(r.stores.plus.subtotalCents,258)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.savingsCents,20)
})
test('EXPECTED RED: AggregateOffer lowPrice/highPrice is a range, not Deka purchasable package',()=>{
  const r=compare(exact('1.29'),range('0.20','2.59',8))
  assertNoWinner(r)
})
test('EXPECTED RED: AggregateOffer even with one lowPrice and offerCount>1 cannot be exact',()=>{
  const r=compare(exact('1.29'),{
    '@type':'AggregateOffer',lowPrice:'0.20',offerCount:8,
    priceCurrency:'EUR',availability:'https://schema.org/InStock',
  })
  assertNoWinner(r)
})
test('EXPECTED RED: offline parser never emits an available exact cent price for synthetic price range',()=>{
  const x=inspect('dekamarkt',range('0.20','2.59',8))
  assert.ok(x.observations.every(o=>o.currentPriceCents===null || o.availability!=='available'),
    'AggregateOffer minimum must not be ingested as exact usable currentPriceCents')
})
test('EXPECTED RED: local two-HTML manifest must abstain when only Deka AggregateOffer is available',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-aggregate-offer-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),jsonLd(exact('1.29')))
  await writeFile(join(dir,'deka.html'),jsonLd(range('0.20','2.59',8)))
  const manifest={
    version:1,requirements:req,snapshots:[
      {sourceId:source('plus').id,htmlFile:'plus.html',capturedAt:AT},
      {sourceId:source('dekamarkt').id,htmlFile:'deka.html',capturedAt:AT},
    ],
  }
  const path=join(dir,'manifest.json')
  await writeFile(path,JSON.stringify(manifest))
  const result=await compareLocalRetailerSnapshots(path,NOW)
  assertNoWinner(result.comparison)
  assert.equal(result.comparison.provenance,'offline-snapshot-preview')
})
