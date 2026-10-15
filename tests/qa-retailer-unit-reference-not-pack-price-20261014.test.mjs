import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// All stores, permissions, product data and prices here are FICTIONAL.
const AT='2026-10-15T09:00:00.000Z'
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const req=[{id:'rice',query:'zilvervliesrijst',amount:1000,unit:'g'}]
const source=(shop)=>SOURCES.find(x=>x.id===shop+'-product-halfvolle-melk')
const buyable=(price)=>({
  '@type':'Offer',price,priceCurrency:'EUR',
  availability:'https://schema.org/InStock',
})
const onlyReferencePrice=()=>({
  '@type':'Offer',priceCurrency:'EUR',
  availability:'https://schema.org/InStock',
  priceSpecification:{
    '@type':'UnitPriceSpecification',
    price:'0.99',priceCurrency:'EUR',
    referenceQuantity:{'@type':'QuantitativeValue',value:1,unitCode:'KGM'},
  },
})
const html=(offer)=>'<script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'Product',
  sku:'fictional-500g-rice',name:'Zilvervliesrijst',
  weight:{value:'500 g'},offers:offer,
})+'</script>'
const read=(shop,offer)=>parseOfflineRetailerSnapshot({
  source:source(shop),html:html(offer),capturedAt:AT,
})
const compare=(plus,deka)=>compareReviewedCatalogs({
  requirements:req,
  observations:[...read('plus',plus).observations,...read('dekamarkt',deka).observations],
  nowMs:NOW,
})
const assertWithheld=(result)=>{
  assert.equal(result.claimable,false)
  assert.equal(result.comparable,false,'unit-reference euro/kg must not be quoted as exact 500g package cost')
  assert.equal(result.cheaperStore,null)
  assert.equal(result.savingsCents,null)
}
test('real concrete Offer.price produces exact independent two-500g-package baseline',()=>{
  const r=compare(buyable('2.49'),buyable('2.39'))
  assert.equal(r.comparable,true)
  assert.equal(r.claimable,false)
  assert.equal(r.stores.plus.subtotalCents,498)
  assert.equal(r.stores.dekamarkt.subtotalCents,478)
  assert.equal(r.savingsCents,20)
})
test('EXPECTED RED: unit-price per kilogram cannot become Deka 500g purchasable package price',()=>{
  assertWithheld(compare(buyable('2.49'),onlyReferencePrice()))
})
test('EXPECTED RED: actual JSON-LD parser never marks referenceQuantity price as exact currentPriceCents',()=>{
  const snapshot=read('dekamarkt',onlyReferencePrice())
  assert.ok(snapshot.observations.every(o=>
    o.currentPriceCents===null || o.availability!=='available'),
    'PriceSpecification with referenceQuantity is not proof of pack checkout price')
})
test('EXPECTED RED: local PLUS/Deka HTML manifest abstains on Deka unit-reference-only price',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-unit-price-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),html(buyable('2.49')))
  await writeFile(join(dir,'deka.html'),html(onlyReferencePrice()))
  const manifest={version:1,requirements:req,snapshots:[
    {sourceId:source('plus').id,htmlFile:'plus.html',capturedAt:AT},
    {sourceId:source('dekamarkt').id,htmlFile:'deka.html',capturedAt:AT},
  ]}
  const path=join(dir,'manifest.json')
  await writeFile(path,JSON.stringify(manifest))
  const r=await compareLocalRetailerSnapshots(path,NOW)
  assertWithheld(r.comparison)
  assert.equal(r.comparison.provenance,'offline-snapshot-preview')
})
